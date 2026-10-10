-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.booking_lifecycle_status (
  target_request_id uuid
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce((select outcome from public.booking_lifecycle_outcomes where booking_request_id=target_request_id),
    case when exists(select 1 from public.booking_cancellations where booking_request_id=target_request_id) then 'cancelled'
      when exists(select 1 from public.booking_incidents where booking_request_id=target_request_id) then 'incident_pending'
      else 'confirmed' end);
$function$;

REVOKE ALL ON FUNCTION public.booking_lifecycle_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.booking_lifecycle_status(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_booking_lifecycle (
  target_reference  text,
  target_actor_role text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=(select auth.uid()); declare context public.account_contexts; declare request public.booking_requests; declare lifecycle record; declare result jsonb;
begin
  select * into context from public.account_contexts where user_id=actor;
  select * into request from public.booking_requests where booking_request_reference=target_reference;
  if request.id is null or actor is null or not (
    (target_actor_role='platform_administrator' and public.is_platform_administrator('aal2')) or
    (target_actor_role='customer' and context.role in ('customer','cottage_owner') and request.customer_user_id=actor) or
    (target_actor_role='cottage_owner' and context.role='cottage_owner' and context.owner_approval_state='approved' and request.owner_user_id=actor)
  ) is true then raise exception 'Booking lifecycle is unavailable' using errcode='42501'; end if;
  if not exists(select 1 from public.booking_confirmations where booking_request_id=request.id) then raise exception 'Confirmed booking source is invalid' using errcode='RC409'; end if;
  select * into lifecycle from public.booking_lifecycle_outcomes where booking_request_id=request.id;
  result:=jsonb_build_object('bookingRequestId',request.id,'status',public.booking_lifecycle_status(request.id));
  if target_actor_role='platform_administrator' then
    result:=result||jsonb_build_object('noShow',case when lifecycle.outcome='no_show' then jsonb_build_object('actorUserId',lifecycle.actor_user_id,'reason',lifecycle.reason,'recordedAt',lifecycle.recorded_at) end);
    result:=result||jsonb_build_object('incidents',(
      select coalesce(jsonb_agg(incident order by recorded_at,id),'[]') from (
        select incidents.id,incidents.recorded_at,jsonb_build_object('id',incidents.id,'source','lifecycle',
          'category',incidents.category,'narrative',incidents.narrative,'actorUserId',incidents.actor_user_id,
          'actorRole',incidents.actor_role,'recordedAt',incidents.recorded_at) incident
        from public.booking_incidents incidents where incidents.booking_request_id=request.id
        union all
        select incidents.id,incidents.recorded_at,jsonb_build_object('id',incidents.id,'source','cancellation',
          'cancellationId',cancellations.id,'category',cancellations.category,'narrative',cancellations.reason,
          'actorUserId',cancellations.actor_user_id,'actorRole',cancellations.actor_role,'recordedAt',incidents.recorded_at)
        from public.booking_cancellation_incidents incidents
        join public.booking_cancellations cancellations on cancellations.id=incidents.cancellation_id
        where cancellations.booking_request_id=request.id
      ) incident_sources));
  end if;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.search_administrator_booking_queue (
  target_queue   text,
  target_state   text,
  target_from    date,
  target_through date,
  after_at       timestamp with time zone,
  after_id       uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  queue_states text[];
  result jsonb;
begin
  if public.is_platform_administrator('aal2') is not true then
    raise exception 'Platform Administrator AAL2 access required' using errcode = '42501';
  end if;
  queue_states := case target_queue
    when 'requests' then array['pending','processing','payment-required','capture-processing','declined','withdrawn','expired','cancelled']
    when 'bookings' then array['confirmed','incident_pending','completed','no_show','cancelled']
    when 'refunds' then array['requested','processing','succeeded','failed','unknown']
    when 'incidents' then array['incident_pending','completed','no_show','cancelled']
  end;
  if queue_states is null then
    raise exception 'Invalid administrator booking queue' using errcode = '22023';
  end if;
  if target_state is not null and target_state <> all (queue_states) then
    raise exception 'Invalid administrator booking queue state' using errcode = '22023';
  end if;
  if target_from is not null and target_through is not null and target_from > target_through then
    raise exception 'Date range is reversed' using errcode = '22023';
  end if;
  if (after_at is null) <> (after_id is null) then
    raise exception 'Cursor requires date and identifier' using errcode = '22023';
  end if;

  with request_access as (
    select requests, confirmations.confirmed_at, access.paid_access
    from public.booking_requests requests
    left join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id
    cross join lateral (select confirmations.id is not null
      and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=requests.id)
      and not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=requests.id and expiry.state='quarantined')
      and (public.booking_request_payment_status(requests)='paid-confirmed' or exists(select 1 from public.booking_cancellations cancellation where cancellation.booking_request_id=requests.id)) paid_access) access
    where target_queue in ('requests','bookings')
  ),
  -- MATERIALIZED keeps the state filter out of the branches, so each lifecycle
  -- status is derived once and shared by the state counts and the filtered page.
  candidates as materialized (
    select (listed.requests).id, (listed.requests).created_at at, (listed.requests).booking_request_reference reference,
      coalesce(case when exists(select 1 from public.booking_cancellations cancellation where cancellation.booking_request_id=(listed.requests).id)
        then 'cancelled' else public.booking_request_payment_status(listed.requests) end, (listed.requests).status) state,
      null::text source, null::text category
    from request_access listed
    where target_queue = 'requests' and listed.paid_access is not true
      and (target_from is null or (listed.requests).created_at >= (target_from::timestamp at time zone 'Asia/Baghdad'))
      and (target_through is null or (listed.requests).created_at < ((target_through + 1)::timestamp at time zone 'Asia/Baghdad'))
    union all
    select (listed.requests).id, listed.confirmed_at, (listed.requests).booking_request_reference,
      public.booking_lifecycle_status((listed.requests).id),
      null::text, null::text
    from request_access listed
    where target_queue = 'bookings' and listed.paid_access
      and (target_from is null or listed.confirmed_at >= (target_from::timestamp at time zone 'Asia/Baghdad'))
      and (target_through is null or listed.confirmed_at < ((target_through + 1)::timestamp at time zone 'Asia/Baghdad'))
    union all
    select intents.id, intents.created_at, requests.booking_request_reference,
      public.booking_refund_intent_state(intents.id), intents.source, null::text
    from public.booking_refund_intents intents
    join public.booking_requests requests on requests.id=intents.booking_request_id
    where target_queue = 'refunds'
      and (target_from is null or intents.created_at >= (target_from::timestamp at time zone 'Asia/Baghdad'))
      and (target_through is null or intents.created_at < ((target_through + 1)::timestamp at time zone 'Asia/Baghdad'))
    union all
    select incident_sources.id, incident_sources.recorded_at, requests.booking_request_reference,
      public.booking_lifecycle_status(requests.id),
      incident_sources.source, incident_sources.category
    from (
      select incidents.id, incidents.recorded_at, incidents.booking_request_id, 'lifecycle'::text source, incidents.category
      from public.booking_incidents incidents
      union all
      select incidents.id, incidents.recorded_at, cancellations.booking_request_id, 'cancellation', cancellations.category
      from public.booking_cancellation_incidents incidents
      join public.booking_cancellations cancellations on cancellations.id=incidents.cancellation_id
    ) incident_sources
    join public.booking_requests requests on requests.id=incident_sources.booking_request_id
    where target_queue = 'incidents'
      and (target_from is null or incident_sources.recorded_at >= (target_from::timestamp at time zone 'Asia/Baghdad'))
      and (target_through is null or incident_sources.recorded_at < ((target_through + 1)::timestamp at time zone 'Asia/Baghdad'))
  ),
  state_counts as (
    select jsonb_object_agg(states.state, coalesce(counted.value, 0)) value
    from unnest(queue_states) states(state)
    left join (select state, count(*) value from candidates group by state) counted on counted.state = states.state
  ),
  filtered as (
    select * from candidates c where target_state is null or c.state = target_state
  ),
  total as (select count(*) value from filtered),
  page as (
    select *, row_number() over (order by at desc, id desc) position
    from filtered
    where after_at is null or (at, id) < (after_at, after_id)
    order by at desc, id desc limit 26
  ),
  page_data as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'at', at, 'reference', reference, 'state', state,
      'source', source, 'category', category
    ) order by at desc, id desc) filter (where position <= 25), '[]'::jsonb) rows,
      count(*) > 25 has_more,
      max(at) filter (where position = 25) cursor_at,
      (max(id::text) filter (where position = 25))::uuid cursor_id
    from page
  )
  select jsonb_build_object(
    'queue', target_queue, 'rows', page_data.rows, 'total', total.value,
    'stateCounts', state_counts.value,
    'nextCursor', case when page_data.has_more then
      jsonb_build_object('at', page_data.cursor_at, 'id', page_data.cursor_id)
      else null end
  ) into result
  from page_data cross join total cross join state_counts;
  return result;
end;
$function$;