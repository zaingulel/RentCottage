SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
SET default_tablespace = '';
SET default_table_access_method = "heap";

CREATE OR REPLACE FUNCTION "public"."claim_marketplace_role"("requested_role" "public"."account_role") RETURNS "public"."account_contexts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  context public.account_contexts;
begin
  if requested_role is null or requested_role not in ('customer', 'cottage_owner') then
    raise exception 'Only Customer or Cottage Owner access can be claimed publicly'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = (select auth.uid())
      and phone_confirmed_at is not null
  ) then
    raise exception 'A verified phone identity is required'
      using errcode = '42501';
  end if;

  -- The auth identity exists before either first-time claim, so it serializes enrollment even with no context row yet.
  perform 1 from auth.users where id = (select auth.uid()) for update;

  insert into public.account_contexts (user_id, role, owner_approval_state)
  values (
    (select auth.uid()),
    requested_role,
    case
      when requested_role = 'cottage_owner' then 'prospective'::public.owner_approval_state
      else null
    end
  )
  on conflict (user_id) do nothing;

  select * into context
  from public.account_contexts
  where user_id = (select auth.uid())
  for update;

  if context.role = 'platform_administrator' then
    raise exception 'This identity already has a different marketplace role'
      using errcode = 'RC001';
  end if;

  if requested_role = 'cottage_owner' and context.role = 'customer' then
    update public.account_contexts
    set role = 'cottage_owner', owner_approval_state = 'prospective'
    where user_id = context.user_id
    returning * into context;
  end if;

  return context;
end;
$$;

ALTER FUNCTION "public"."claim_marketplace_role"("requested_role" "public"."account_role") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."is_platform_administrator"("required_assurance" "text" DEFAULT 'aal2'::"text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    (select auth.jwt() ->> 'aal') = required_assurance
    and exists (
      select 1
      from public.account_contexts
      where user_id = (select auth.uid())
        and role = 'platform_administrator'
    );
$$;

ALTER FUNCTION "public"."is_platform_administrator"("required_assurance" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."provision_platform_administrator"("target_user_id" "uuid") RETURNS "public"."account_contexts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  context public.account_contexts;
begin
  if not exists (
    select 1
    from auth.users
    where id = target_user_id
      and email_confirmed_at is not null
      and email is not null
  ) then
    raise exception 'A confirmed email identity is required'
      using errcode = '23514';
  end if;

  insert into public.account_contexts (user_id, role)
  values (target_user_id, 'platform_administrator')
  returning * into context;

  return context;
end;
$$;

ALTER FUNCTION "public"."provision_platform_administrator"("target_user_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."record_privileged_sign_in_attempt"("attempted_email" "text", "attempted_email_digest" "text", "attempt_stage" "text", "attempt_outcome" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  normalized_email text := lower(trim(coalesce(attempted_email, '')));
  administrator_user_id uuid;
begin
  if attempted_email_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Privileged sign-in email digest is invalid'
      using errcode = '22023';
  end if;

  if attempt_stage not in ('primary', 'mfa') then
    raise exception 'Unknown privileged sign-in stage'
      using errcode = '22023';
  end if;

  if attempt_outcome not in ('succeeded', 'failed') then
    raise exception 'Unknown privileged sign-in outcome'
      using errcode = '22023';
  end if;

  delete from public.privileged_sign_in_attempts
  where attempted_at < now() - interval '180 days';

  select account_contexts.user_id
  into administrator_user_id
  from public.account_contexts
  join auth.users on auth.users.id = account_contexts.user_id
  where account_contexts.role = 'platform_administrator'
    and lower(auth.users.email) = normalized_email
  limit 1;

  insert into public.privileged_sign_in_attempts (
    actor_user_id,
    email_digest,
    stage,
    outcome
  )
  values (
    administrator_user_id,
    attempted_email_digest,
    attempt_stage,
    attempt_outcome
  );
end;
$_$;

ALTER FUNCTION "public"."record_privileged_sign_in_attempt"("attempted_email" "text", "attempted_email_digest" "text", "attempt_stage" "text", "attempt_outcome" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."save_account_name"("account_first_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_role public.account_role;
begin
  select account_contexts.role into caller_role
  from public.account_contexts
  where account_contexts.user_id = (select auth.uid());

  if caller_role is null then
    raise exception 'A marketplace account is required'
      using errcode = '42501';
  end if;

  if caller_role = 'platform_administrator' and public.is_platform_administrator('aal2') is not true then
    raise exception 'Two-step sign-in is required'
      using errcode = '42501';
  end if;

  insert into public.account_names (user_id, first_name)
  values ((select auth.uid()), account_first_name)
  on conflict (user_id) do update
    set first_name = excluded.first_name, updated_at = now();
end;
$$;

ALTER FUNCTION "public"."save_account_name"("account_first_name" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_authorization_claim_inventory_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare candidate_schedule_revision_id uuid;
declare candidate_unit_kind public.cottage_inventory_unit_kind;
declare candidate_unit_id uuid;
declare candidate_service_day date;
declare candidate_weekday smallint;
begin
  if current_setting('role', true) = 'service_role' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then
    candidate_schedule_revision_id := old.schedule_revision_id;
    candidate_unit_kind := old.unit_kind;
    candidate_unit_id := old.unit_id;
    if tg_table_name in (
      'cottage_inventory_date_price_overrides', 'cottage_inventory_availability'
    ) then candidate_service_day := old.service_day; end if;
    if tg_table_name = 'cottage_inventory_weekday_price_overrides'
      then candidate_weekday := old.weekday; end if;
  else
    candidate_schedule_revision_id := new.schedule_revision_id;
    candidate_unit_kind := new.unit_kind;
    candidate_unit_id := new.unit_id;
    if tg_table_name in (
      'cottage_inventory_date_price_overrides', 'cottage_inventory_availability'
    ) then candidate_service_day := new.service_day; end if;
    if tg_table_name = 'cottage_inventory_weekday_price_overrides'
      then candidate_weekday := new.weekday; end if;
  end if;
  if tg_table_name = 'cottage_inventory_standard_prices'
    and exists (
      select 1
      from public.booking_request_authorization_claim_items items
      join public.booking_request_authorization_claims claims
        on claims.id = items.claim_id
	      where public.booking_request_claim_state_is_active(claims.state)
        and claims.schedule_revision_id = candidate_schedule_revision_id
        and items.unit_kind = candidate_unit_kind
        and items.unit_id = candidate_unit_id
    ) then
    raise exception 'Authorization-claimed Cottage Inventory cannot change'
      using errcode = 'RC204';
  elsif tg_table_name = 'cottage_inventory_weekday_price_overrides'
    and exists (
      select 1
      from public.booking_request_authorization_claim_items items
      join public.booking_request_authorization_claims claims
        on claims.id = items.claim_id
	      where public.booking_request_claim_state_is_active(claims.state)
        and claims.schedule_revision_id = candidate_schedule_revision_id
        and items.unit_kind = candidate_unit_kind
        and items.unit_id = candidate_unit_id
        and extract(dow from items.service_day)::smallint = candidate_weekday
    ) then
    raise exception 'Authorization-claimed Cottage Inventory cannot change'
      using errcode = 'RC204';
  elsif tg_table_name in (
      'cottage_inventory_date_price_overrides', 'cottage_inventory_availability'
    ) and public.booking_request_active_claim_conflicts_unit(
      candidate_schedule_revision_id, candidate_unit_kind,
      candidate_unit_id, candidate_service_day
    ) then
    raise exception 'Authorization-claimed Cottage Inventory cannot change'
      using errcode = 'RC204';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

ALTER FUNCTION "public"."reject_authorization_claim_inventory_mutation"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."send_test_sms"("event" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if event -> 'user' ->> 'phone' is null then
    raise exception 'Phone is required';
  end if;
end;
$$;

ALTER FUNCTION "public"."send_test_sms"("event" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.search_administrator_records(
  target_kind text, target_query text, target_status text, target_from date,
  target_through date, target_owner_id uuid, after_at timestamptz, after_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
declare
  query_text text := btrim(coalesce(target_query, ''));
  query_uuid uuid;
  query_phone text;
  result jsonb;
begin
  if public.is_platform_administrator('aal2') is not true then
    raise exception 'Platform Administrator AAL2 access required' using errcode = '42501';
  end if;
  if target_kind is null or target_kind not in ('customers','owners','cottages','applications','approvals') then
    raise exception 'Invalid administrator record kind' using errcode = '22023';
  end if;
  if target_status is not null and not (
    (target_kind = 'owners' and target_status in ('prospective','approved','suspended','expired')) or
    (target_kind = 'cottages' and target_status in ('draft','submitted_for_content_approval','abandoned')) or
    (target_kind = 'applications' and target_status in ('pending','submitted','under_review','needs_information','approved','rejected','expired','suspended')) or
    (target_kind = 'approvals' and target_status in ('in_review','approved','rejected'))
  ) then
    raise exception 'Invalid administrator record status' using errcode = '22023';
  end if;
  if target_owner_id is not null and target_kind not in ('cottages','applications','approvals') then
    raise exception 'Owner filter is not valid for this kind' using errcode = '22023';
  end if;
  if target_from is not null and target_through is not null and target_from > target_through then
    raise exception 'Date range is reversed' using errcode = '22023';
  end if;
  if (after_at is null) <> (after_id is null) then
    raise exception 'Cursor requires date and identifier' using errcode = '22023';
  end if;
  if query_text <> '' then
    if query_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      query_uuid := query_text::uuid;
    elsif query_text ~* '^[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}$' then
      raise exception 'Invalid account identifier' using errcode = '22023';
    elsif query_text ~ '^\+?964[0-9]{10}$' then
      query_phone := regexp_replace(query_text, '^\+', '');
    elsif length(query_text) < 2 or length(query_text) > 120 then
      raise exception 'Search text must have 2 to 120 characters' using errcode = '22023';
    end if;
  end if;

  with pending_counts as (
    select
      (select count(*) from public.owner_applications where status in ('submitted','under_review')) as applications,
      (select count(*) from public.cottage_profile_review_cycles where state = 'in_review') as approvals
  ),
  candidates as (
    select 'customers'::text kind, contexts.user_id id, contexts.user_id owner_id,
      null::uuid profile_id, application.id application_id,
      contexts.user_id::text label, contexts.role::text status,
      contexts.created_at at, null::integer cycle_number,
      case when users.phone_confirmed_at is not null and users.phone is not null
        then '•••' || right(users.phone, 4) end masked_phone,
      users.phone verified_phone
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    left join lateral (
      select id from public.owner_applications applications
      where applications.owner_user_id = contexts.user_id and applications.status <> 'draft'
      order by applications.submitted_at desc, applications.id desc limit 1
    ) application on true
    where target_kind = 'customers' and contexts.role in ('customer','cottage_owner')
    union all
    select 'owners', contexts.user_id, contexts.user_id, null::uuid, application.id,
      coalesce(application.name, contexts.user_id::text), contexts.owner_approval_state::text,
      contexts.created_at, null::integer,
      case when users.phone_confirmed_at is not null and users.phone is not null
        then '•••' || right(users.phone, 4) end, users.phone
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    left join lateral (
      select applications.id, coalesce(applications.legal_name, applications.company_name) name
      from public.owner_applications applications
      where applications.owner_user_id = contexts.user_id and applications.status <> 'draft'
      order by applications.submitted_at desc, applications.id desc limit 1
    ) application on true
    where target_kind = 'owners' and contexts.role = 'cottage_owner'
    union all
    select 'cottages', profiles.id, profiles.owner_user_id, profiles.id, profiles.application_id,
      coalesce(profiles.name, profiles.id::text), profiles.status::text, profiles.created_at, null::integer,
      null::text, null::text
    from public.owner_application_cottage_profiles profiles
    where target_kind = 'cottages'
    union all
    select 'applications', applications.id, applications.owner_user_id, null::uuid, applications.id,
      coalesce(applications.legal_name, applications.company_name), applications.status::text,
      applications.submitted_at, null::integer, null::text, null::text
    from public.owner_applications applications
    where target_kind = 'applications' and applications.status <> 'draft'
    union all
    select 'approvals', cycles.id, cycles.owner_user_id, cycles.profile_id, null::uuid,
      cycles.name, cycles.state, cycles.created_at, cycles.cycle_number,
      null::text, null::text
    from public.cottage_profile_review_cycles cycles
    where target_kind = 'approvals'
  ),
  filtered as (
    select * from candidates c
    where (target_owner_id is null or c.owner_id = target_owner_id)
      and (target_status is null or c.status = target_status
        or (target_kind = 'applications' and target_status = 'pending' and c.status in ('submitted','under_review')))
      and (target_from is null or c.at >= (target_from::timestamp at time zone 'Asia/Baghdad'))
      and (target_through is null or c.at < ((target_through + 1)::timestamp at time zone 'Asia/Baghdad'))
      and (query_text = '' or
        (query_uuid is not null and (c.id = query_uuid or
          (target_kind in ('cottages','applications','approvals') and c.owner_id = query_uuid) or
          (target_kind = 'approvals' and c.profile_id = query_uuid))) or
        (query_phone is not null and target_kind in ('customers','owners') and
          regexp_replace(c.verified_phone, '^\+', '') = query_phone and c.masked_phone is not null) or
        (query_uuid is null and query_phone is null and target_kind <> 'customers' and
          strpos(lower(coalesce(c.label,'')), lower(query_text)) > 0))
  ),
  total as (select count(*) value from filtered),
  page as (
    select *, row_number() over (order by at desc, id desc) position
    from filtered
    where after_at is null or (at, id) < (after_at, after_id)
    order by at desc, id desc limit 26
  ),
  page_data as (
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'kind', kind, 'id', id, 'ownerId', owner_id, 'profileId', profile_id,
      'applicationId', application_id, 'label', label, 'status', status,
      'at', at, 'cycleNumber', cycle_number, 'maskedPhone', masked_phone
    )) order by at desc, id desc) filter (where position <= 25), '[]'::jsonb) rows,
      count(*) > 25 has_more,
      max(at) filter (where position = 25) cursor_at,
      (max(id::text) filter (where position = 25))::uuid cursor_id
    from page
  )
  select jsonb_build_object(
    'rows', page_data.rows, 'total', total.value,
    'pendingApplications', pending_counts.applications,
    'pendingApprovals', pending_counts.approvals,
    'nextCursor', case when page_data.has_more then
      jsonb_build_object('at', page_data.cursor_at, 'id', page_data.cursor_id)
      else null end
  ) into result
  from page_data cross join total cross join pending_counts;
  return result;
end;
$$;
ALTER FUNCTION public.search_administrator_records(text,text,text,date,date,uuid,timestamptz,uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_administrator_record(target_kind text, target_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
declare result jsonb;
begin
  if public.is_platform_administrator('aal2') is not true then
    raise exception 'Platform Administrator AAL2 access required' using errcode = '42501';
  end if;
  if target_kind not in ('account','approval') or target_kind is null or target_id is null then
    raise exception 'Invalid administrator record target' using errcode = '22023';
  end if;
  if target_kind = 'account' then
    select jsonb_strip_nulls(jsonb_build_object(
      'kind', 'account', 'id', contexts.user_id, 'marketplaceRole', contexts.role,
      'customerCapability', true, 'ownerApprovalState', contexts.owner_approval_state,
      'createdAt', contexts.created_at, 'applicationId', application.id,
      'maskedPhone', case when users.phone_confirmed_at is not null and users.phone is not null
        then '•••' || right(users.phone, 4) end
    )) into result
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    left join lateral (
      select id from public.owner_applications applications
      where applications.owner_user_id = contexts.user_id and applications.status <> 'draft'
      order by applications.submitted_at desc, applications.id desc limit 1
    ) application on true
    where contexts.user_id = target_id and contexts.role in ('customer','cottage_owner');
  else
    select jsonb_build_object(
      'kind', 'approval', 'id', cycles.id, 'profileId', cycles.profile_id,
      'ownerId', cycles.owner_user_id, 'name', cycles.name,
      'approximateLocation', cycles.approximate_location,
      'state', cycles.state, 'cycleNumber', cycles.cycle_number,
      'createdAt', cycles.created_at, 'decidedAt', cycles.decided_at,
      'publicationDecision', (select jsonb_build_object(
        'approved', decisions.approved, 'reason', decisions.reason,
        'administratorId', decisions.administrator_user_id,
        'decidedAt', decisions.decided_at
      ) from public.cottage_profile_publication_decisions decisions
      where decisions.review_cycle_id = cycles.id),
      'localizedDecisions', coalesce((select jsonb_agg(jsonb_build_object(
        'decisionId', decisions.id, 'locale', decisions.locale, 'revisionId', decisions.localized_revision_id,
        'approved', decisions.approved, 'reason', decisions.reason,
        'administratorId', decisions.administrator_user_id,
        'decidedAt', decisions.decided_at
      ) order by decisions.decided_at, decisions.id)
      from public.cottage_profile_localized_decisions decisions
      where decisions.review_cycle_id = cycles.id), '[]'::jsonb)
    ) into result
    from public.cottage_profile_review_cycles cycles
    where cycles.id = target_id;
  end if;
  return result;
end;
$$;
ALTER FUNCTION public.get_administrator_record(text,uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.search_administrator_booking_queue(
  target_queue text, target_state text, target_from date, target_through date,
  after_at timestamptz, after_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
$$;
ALTER FUNCTION public.search_administrator_booking_queue(text,text,date,date,timestamptz,uuid) OWNER TO postgres;

-- Call only behind the Platform Administrator gate; no API role can execute it.
CREATE OR REPLACE FUNCTION public.administrator_booking_money_facts(
  target_state text, target_from date, target_through date, admission_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
declare
  result jsonb;
begin
  if target_state is not null and target_state <> all (array['confirmed','incident_pending','completed','no_show','cancelled']) then
    raise exception 'Invalid booking lifecycle status' using errcode = '22023';
  end if;
  if target_from is not null and target_through is not null and target_from > target_through then
    raise exception 'Date range is reversed' using errcode = '22023';
  end if;

  with request_access as (
    select requests, confirmations.confirmed_at, access.paid_access
    from public.booking_requests requests
    left join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id
    cross join lateral (select confirmations.id is not null
      and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=requests.id)
      and not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=requests.id and expiry.state='quarantined')
      and (public.booking_request_payment_status(requests)='paid-confirmed' or exists(select 1 from public.booking_cancellations cancellation where cancellation.booking_request_id=requests.id)) paid_access) access
  ),
  -- MATERIALIZED derives each lifecycle status once, for the admission count and the result.
  bookings as materialized (
    select confirmed.* from (
      select (listed.requests).id, listed.confirmed_at, (listed.requests).booking_request_reference reference,
        public.booking_lifecycle_status((listed.requests).id) state
      from request_access listed
      where listed.paid_access
        and (target_from is null or listed.confirmed_at >= (target_from::timestamp at time zone 'Asia/Baghdad'))
        and (target_through is null or listed.confirmed_at < ((target_through + 1)::timestamp at time zone 'Asia/Baghdad'))
    ) confirmed
    where target_state is null or confirmed.state = target_state
  ),
  -- A confirmation whose payment is not confirmed belongs to no lifecycle status, so the state filter never hides it.
  missing_payment_evidence as materialized (
    select requests.id, confirmations.confirmed_at, requests.booking_request_reference reference
    from public.booking_requests requests
    join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id
    where not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=requests.id)
      and not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=requests.id and expiry.state='quarantined')
      and not exists(select 1 from public.booking_cancellations cancellation where cancellation.booking_request_id=requests.id)
      and public.booking_request_payment_status(requests) is distinct from 'paid-confirmed'
      and (target_from is null or confirmations.confirmed_at >= (target_from::timestamp at time zone 'Asia/Baghdad'))
      and (target_through is null or confirmations.confirmed_at < ((target_through + 1)::timestamp at time zone 'Asia/Baghdad'))
  )
  -- CASE evaluates the money facts only for an admitted selection.
  select case when (select count(*) from bookings) + (select count(*) from missing_payment_evidence) > admission_limit
    then jsonb_build_object('status', 'too_many', 'limit', admission_limit)
    else jsonb_build_object(
      'status', 'ready',
      'bookings', (select coalesce(jsonb_agg(jsonb_build_object(
        'bookingRequestId', bookings.id, 'reference', bookings.reference,
        'confirmedAt', to_char(bookings.confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'),
        'state', bookings.state,
        'earnings', public.booking_owner_earnings_facts(bookings.id, statement_timestamp()),
        'refundRecords', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', intents.id, 'source', intents.source, 'state', public.booking_refund_intent_state(intents.id),
          'bookingPriceFils', intents.booking_price_fils, 'bookingServiceFeeFils', intents.booking_service_fee_fils,
          'requestedAt', intents.created_at
        ) order by intents.created_at, intents.id), '[]'::jsonb)
          from public.booking_refund_intents intents where intents.booking_request_id = bookings.id),
        'settlementIntentId', (select intents.id from public.booking_settlement_intents intents where intents.booking_request_id = bookings.id)
      ) order by bookings.confirmed_at desc, bookings.id desc), '[]'::jsonb) from bookings),
      'missingPaymentEvidence', (select coalesce(jsonb_agg(jsonb_build_object(
        'bookingRequestId', missing.id, 'reference', missing.reference,
        'confirmedAt', to_char(missing.confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')
      ) order by missing.confirmed_at desc, missing.id desc), '[]'::jsonb) from missing_payment_evidence missing)
    ) end into result;
  return result;
end;
$$;
ALTER FUNCTION public.administrator_booking_money_facts(text,date,date,integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.list_administrator_booking_money(
  target_state text, target_from date, target_through date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
begin
  if public.is_platform_administrator('aal2') is not true then
    raise exception 'Platform Administrator AAL2 access required' using errcode = '42501';
  end if;
  return public.administrator_booking_money_facts(target_state, target_from, target_through, 500);
end;
$$;
ALTER FUNCTION public.list_administrator_booking_money(text,date,date) OWNER TO postgres;
CREATE OR REPLACE FUNCTION private.set_marketplace_suspension_core(
  target_kind text,
  target_id uuid,
  target_action text,
  expected_revision bigint,
  target_reason text,
  target_command_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare administrator public.account_contexts;
declare target public.account_contexts;
declare application public.owner_applications;
declare profile public.owner_application_cottage_profiles;
declare listing public.cottage_marketplace_listings;
declare verification public.owner_application_verification_records;
declare previous private.marketplace_suspension_actions;
declare recorded private.marketplace_suspension_actions;
declare reason text:=regexp_replace(target_reason,'^[[:space:]]+|[[:space:]]+$','','g');
declare request_ids uuid[];
declare request_id uuid;
declare current_revision bigint;
declare from_state text;
declare to_state text;
declare expired_kinds public.owner_verification_document_kind[];
declare target_summary jsonb;
begin
  select * into administrator from public.account_contexts where user_id=(select auth.uid()) for share;
  if not found
    or administrator.role<>'platform_administrator'
    or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    return jsonb_build_object('status','access-required');
  end if;
  if target_kind is null
    or target_kind not in ('customer','owner','cottage')
    or target_id is null
    or target_action is null
    or target_action not in ('suspend','reactivate')
    or expected_revision is null
    or expected_revision<0
    or target_command_id is null
    or reason is null
    or char_length(reason) not between 1 and 1000 then
    return jsonb_build_object('status','invalid');
  end if;
  select * into previous from private.marketplace_suspension_actions where command_id=target_command_id;
  if found then
    if (previous.actor_user_id, previous.target_kind, coalesce(previous.account_user_id, previous.profile_id), previous.action, previous.expected_revision, previous.reason)
      is distinct from (administrator.user_id, target_kind, target_id, target_action, expected_revision, reason) then
      return jsonb_build_object('status','conflict');
    end if;
    return jsonb_build_object('status','completed','actionId', previous.id,'target', public.get_marketplace_suspension(target_kind, target_id));
  end if;
  if target_kind='cottage' then
    select * into profile from public.owner_application_cottage_profiles where id=target_id for update;
    if not found then
      return jsonb_build_object('status','not-found');
    end if;
  else
    if target_kind='owner' then
      select * into application from public.owner_applications where owner_user_id=target_id for update;
      if not found then
        return jsonb_build_object('status','not-found');
      end if;
    end if;
    select * into target from public.account_contexts
    where user_id=target_id and role<>'platform_administrator' for update;
    if not found or target.role='platform_administrator'
      or (target_kind='owner' and target.role<>'cottage_owner') then
      return jsonb_build_object('status','not-found');
    end if;
  end if;
  -- A same-target contender may have committed while this command waited for its target.
  select * into previous from private.marketplace_suspension_actions where command_id=target_command_id;
  if found then
    if (previous.actor_user_id, previous.target_kind, coalesce(previous.account_user_id, previous.profile_id), previous.action, previous.expected_revision, previous.reason)
      is distinct from (administrator.user_id, target_kind, target_id, target_action, expected_revision, reason) then
      return jsonb_build_object('status','conflict');
    end if;
    return jsonb_build_object('status','completed','actionId', previous.id,'target', public.get_marketplace_suspension(target_kind, target_id));
  end if;
  if target_kind='cottage' then
    if profile.status='abandoned' then
      return jsonb_build_object('status','conflict','reason','abandoned-profile');
    end if;
    select * into listing from public.cottage_marketplace_listings where profile_id=target_id for update nowait;
  elsif target_kind='owner' then
    perform 1 from public.owner_application_cottage_profiles profiles
    where profiles.owner_user_id=target_id order by profiles.id for update nowait;
  end if;
  if target_kind='customer' then
    current_revision:=target.customer_suspension_revision;
    from_state:=case when target.customer_suspended then 'suspended' else 'active' end;
    to_state:=case when target_action='suspend' then 'suspended' else 'active' end;
  elsif target_kind='cottage' then
    current_revision:=profile.suspension_revision;
    from_state:=case when profile.business_suspended then 'suspended' else coalesce(listing.state::text,'unpublished') end;
    if (profile.business_suspended and listing.profile_id is not null and listing.state<>'suspended')
      or (not profile.business_suspended and listing.state='suspended')
      or (profile.business_suspended and ((profile.listing_state_before_suspension is null)<>(listing.profile_id is null))) then
      return jsonb_build_object('status','unavailable');
    end if;
    if profile.business_suspended=(target_action='suspend') then
      return jsonb_build_object('status','conflict');
    end if;
    if target_action='suspend' then
      to_state:='suspended';
    else
      target_summary:=public.get_marketplace_suspension(target_kind, target_id);
      if target_summary->>'status'<>'ready' then
        return jsonb_build_object('status','unavailable');
      end if;
      to_state:=target_summary->>'restorationState';
    end if;
  else
    current_revision:=application.version;
    from_state:=application.status::text;
    if target.owner_approval_state::text is distinct from from_state
      and from_state in ('approved','expired','suspended') then
      return jsonb_build_object('status','unavailable');
    end if;
    if target_action='suspend' then
      if from_state not in ('approved','expired') then
        return jsonb_build_object('status','conflict');
      end if;
      to_state:='suspended';
    else
      if from_state<>'suspended' then
        return jsonb_build_object('status','conflict');
      end if;
      select * into verification
      from public.owner_application_verification_records records
      where records.id=application.current_verification_record_id
        and records.application_id=application.id
        and records.decision='approved';
      if not found
        or jsonb_typeof(verification.relevant_expiry_dates) is distinct from 'object'
        or coalesce(cardinality(verification.evidence_version_ids), 0)<1
        or cardinality(verification.evidence_types) is distinct from cardinality(verification.evidence_version_ids) then
        return jsonb_build_object('status','unavailable');
      end if;
      if exists(select 1
      from jsonb_each_text(verification.relevant_expiry_dates) expiry
      where expiry.key not in (select unnest(enum_range(null::public.owner_verification_document_kind))::text)
        or public.owner_application_parse_expiry_date(expiry.value) is null) then
        return jsonb_build_object('status','unavailable');
      end if;
      select array_agg(expiry.key::public.owner_verification_document_kind
      order by expiry.key) into expired_kinds
      from jsonb_each_text(verification.relevant_expiry_dates) expiry
      where public.owner_application_parse_expiry_date(expiry.value)<=current_date;
      to_state:=case when cardinality(expired_kinds)>0 then 'expired' else 'approved' end;
    end if;
  end if;
  if current_revision<>expected_revision or from_state=to_state then
    return jsonb_build_object('status','conflict');
  end if;
  if target_action='suspend' then
    select coalesce(array_agg(selected.id), '{}'::uuid[]) into request_ids
    from (select requests.id
    from public.booking_requests requests
    where requests.status='pending'
      and ((target_kind='customer'
      and requests.customer_user_id=target_id)
      or (target_kind='owner'
      and requests.owner_user_id=target_id)
      or (target_kind='cottage'
      and requests.profile_id=target_id))
    order by requests.id for update nowait) selected;
    perform 1
    from public.booking_request_submission_attempts attempts
    where attempts.booking_request_id=any(request_ids)
    order by attempts.id for update nowait;
    if exists(select 1
    from public.booking_requests requests left join public.booking_request_submission_attempts attempts on attempts.booking_request_id=requests.id
    where requests.id=any(request_ids)
      and (attempts.id is null
      or attempts.state<>'finalized'
      or attempts.customer_user_id<>requests.customer_user_id
      or attempts.profile_id<>requests.profile_id)) then
      return jsonb_build_object('status','unavailable');
    end if;
  end if;
  insert into private.marketplace_suspension_actions(command_id, target_kind, account_user_id, profile_id, actor_user_id, action, expected_revision, resulting_revision, from_state, to_state, reason)
  values(target_command_id, target_kind, case when target_kind<>'cottage' then target_id end, case when target_kind='cottage' then target_id end, administrator.user_id, target_action, expected_revision, expected_revision+1, from_state, to_state, reason)
  on conflict(command_id) do nothing returning * into recorded;
  if not found then
    return jsonb_build_object('status','conflict');
  end if;
  if target_kind='customer' then
    update public.account_contexts set customer_suspended=(target_action='suspend'), customer_suspension_revision=customer_suspension_revision+1, updated_at=clock_timestamp()
    where user_id=target_id;
  elsif target_kind='cottage' then
    update public.owner_application_cottage_profiles
    set business_suspended=(target_action='suspend'), suspension_revision=suspension_revision+1,
      listing_state_before_suspension=case when target_action='suspend' then listing.state else listing_state_before_suspension end,
      updated_at=clock_timestamp()
    where id=target_id;
    if listing.profile_id is not null then
      update public.cottage_marketplace_listings set state=to_state::public.cottage_marketplace_state where profile_id=target_id;
    end if;
  else
    update public.owner_applications set status=to_state::public.owner_application_status, version=version+1, review_due_at=null, review_paused_at=null, updated_at=clock_timestamp()
    where id=application.id;
    update public.account_contexts set owner_approval_state=to_state::public.owner_approval_state, owner_suspension_revision=owner_suspension_revision+1, updated_at=clock_timestamp()
    where user_id=target_id;
    insert into public.owner_application_transitions(application_id, from_status, to_status, application_version, actor_user_id, actor_subject_id, reason) values(application.id, application.status, to_state::public.owner_application_status, application.version+1, administrator.user_id, administrator.user_id::text, reason);
    if target_action='suspend' then
      insert into public.owner_application_notices(application_id, owner_user_id, kind, reason) values(application.id, target_id,'suspended', reason);
    elsif to_state='expired' then
      perform private.prepare_owner_application_renewal(application.id, verification.id, expired_kinds);
    end if;
  end if;
  if target_action='suspend' then
    foreach request_id in array request_ids loop
      perform private.prepare_booking_request_release(request_id, administrator.user_id,'suspend','other', null, recorded.id);
    end loop;
  end if;
  return jsonb_build_object('status','completed','actionId', recorded.id,'target', public.get_marketplace_suspension(target_kind, target_id));
end;
$$;
ALTER FUNCTION private.set_marketplace_suspension_core(text, uuid, text, bigint, text, uuid) OWNER TO postgres;
CREATE OR REPLACE FUNCTION public.set_marketplace_suspension(
  target_kind text,
  target_id uuid,
  target_action text,
  expected_revision bigint,
  target_reason text,
  target_command_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
  return private.set_marketplace_suspension_core(target_kind, target_id, target_action, expected_revision, target_reason, target_command_id);
exception when lock_not_available then
  return jsonb_build_object('status','retry');
end;
$$;
ALTER FUNCTION public.set_marketplace_suspension(text, uuid, text, bigint, text, uuid) OWNER TO postgres;
CREATE OR REPLACE FUNCTION public.get_marketplace_suspension(
  target_kind text, target_id uuid, before_created_at timestamptz DEFAULT NULL,
  before_id uuid DEFAULT NULL, page_size integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare administrator public.account_contexts;
declare facts record;
declare target public.account_contexts;
declare application public.owner_applications;
declare profile public.owner_application_cottage_profiles;
declare listing public.cottage_marketplace_listings;
declare verification public.owner_application_verification_records;
declare current_state text;
declare current_revision bigint;
declare can_suspend boolean;
declare can_reactivate boolean;
declare restriction_reason text;
declare restoration_state text;
declare restoration_restriction text;
declare verification_valid boolean;
declare verification_expired boolean;
begin
  select * into administrator from public.account_contexts
  where user_id=(select auth.uid()) for share;
  if not found or administrator.role<>'platform_administrator'
    or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    return jsonb_build_object('status','access-required');
  end if;
  if get_marketplace_suspension.target_kind is null
    or get_marketplace_suspension.target_kind not in ('customer','owner','cottage')
    or get_marketplace_suspension.target_id is null or page_size is null or page_size not between 1 and 50
    or (before_created_at is null)<>(before_id is null) then
    return jsonb_build_object('status','invalid');
  end if;
  -- Target, immutable history and release counts share one database snapshot.
  with target_actions as materialized (
    select actions.* from private.marketplace_suspension_actions actions
    where actions.target_kind=get_marketplace_suspension.target_kind
      and ((get_marketplace_suspension.target_kind='cottage' and actions.profile_id=get_marketplace_suspension.target_id)
        or (get_marketplace_suspension.target_kind<>'cottage' and actions.account_user_id=get_marketplace_suspension.target_id))
  ), action_counts as materialized (
    select actions.*, count(work.id) as affected,
      count(work.id) filter(where work.state='complete') as resolved,
      count(work.id) filter(where work.state='processing') as processing,
      count(work.id) filter(where work.state='quarantined') as quarantined
    from target_actions actions
    left join public.booking_request_release_work work on work.suspension_action_id=actions.id
    group by actions.id, actions.command_id, actions.target_kind, actions.account_user_id,
      actions.profile_id, actions.actor_user_id, actions.action, actions.expected_revision,
      actions.resulting_revision, actions.from_state, actions.to_state, actions.reason, actions.created_at
  ), page as materialized (
    select actions.*, row_number() over(order by created_at desc, id desc) as ordinal
    from action_counts actions
    where before_created_at is null or (actions.created_at, actions.id)<(before_created_at, before_id)
    order by actions.created_at desc, actions.id desc limit page_size+1
  )
  select contexts as context, applications as application, profiles as profile,
    listings as listing, records as verification,
    exists(select 1 from public.cottage_publication_snapshots publications
      where publications.id=profiles.current_publication_id and publications.profile_id=profiles.id) as publication_matches,
    exists(select 1 from public.cottage_shift_schedule_revisions schedules
      where schedules.id=profiles.current_shift_schedule_id and schedules.profile_id=profiles.id) as schedule_matches,
    (select jsonb_build_object('affected', coalesce(sum(affected), 0),
      'resolved', coalesce(sum(resolved), 0),'processing', coalesce(sum(processing), 0),
      'quarantined', coalesce(sum(quarantined), 0)) from action_counts) as release_summary,
    (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id,'commandId', command_id,'actorUserId', actor_user_id,'action', action,
      'expectedRevision', expected_revision,'resultingRevision', resulting_revision,
      'fromState', from_state,'toState', to_state,'reason', reason,'createdAt', created_at,
      'affected', affected,'resolved', resolved,'processing', processing,'quarantined', quarantined
    ) order by created_at desc, id desc),'[]'::jsonb) from page where ordinal<=page_size) as actions,
    (select jsonb_build_object('createdAt', created_at,'id', id) from page
      where ordinal=page_size and exists(select 1 from page where ordinal>page_size)) as next_cursor
  into facts
  from (select 1) singleton
  left join public.owner_application_cottage_profiles profiles on get_marketplace_suspension.target_kind='cottage'
    and profiles.id=get_marketplace_suspension.target_id
  left join public.account_contexts contexts
    on contexts.user_id=case when get_marketplace_suspension.target_kind='cottage' then profiles.owner_user_id else get_marketplace_suspension.target_id end
      and contexts.role<>'platform_administrator'
  left join public.owner_applications applications on applications.owner_user_id=contexts.user_id
    and get_marketplace_suspension.target_kind in ('owner','cottage')
  left join public.cottage_marketplace_listings listings on listings.profile_id=profiles.id
  left join public.owner_application_verification_records records
    on records.id=applications.current_verification_record_id
      and records.application_id=applications.id;
  target:=facts.context;
  application:=facts.application;
  profile:=facts.profile;
  listing:=facts.listing;
  verification:=facts.verification;
  if (get_marketplace_suspension.target_kind='cottage' and profile.id is null)
    or (get_marketplace_suspension.target_kind<>'cottage' and target.user_id is null)
    or (get_marketplace_suspension.target_kind='owner' and (application.id is null or target.role<>'cottage_owner')) then
    return jsonb_build_object('status','not-found');
  end if;
  if verification.id is not null and verification.decision='approved'
    and jsonb_typeof(verification.relevant_expiry_dates)='object'
    and coalesce(cardinality(verification.evidence_version_ids), 0)>0
    and cardinality(verification.evidence_types)=cardinality(verification.evidence_version_ids) then
    select not exists(select 1 from jsonb_each_text(verification.relevant_expiry_dates) expiry
      where expiry.key not in (select unnest(enum_range(null::public.owner_verification_document_kind))::text)
        or public.owner_application_parse_expiry_date(expiry.value) is null),
      exists(select 1 from jsonb_each_text(verification.relevant_expiry_dates) expiry
        where public.owner_application_parse_expiry_date(expiry.value)<=current_date)
    into verification_valid, verification_expired;
  else
    verification_valid:=false;
  end if;
  if get_marketplace_suspension.target_kind='customer' then
    current_state:=case when target.customer_suspended then 'suspended' else 'active' end;
    current_revision:=target.customer_suspension_revision;
    can_suspend:=not target.customer_suspended;
    can_reactivate:=target.customer_suspended;
    restoration_state:='active';
  elsif get_marketplace_suspension.target_kind='owner' then
    current_state:=application.status::text;
    current_revision:=application.version;
    can_suspend:=application.status in ('approved','expired');
    can_reactivate:=application.status='suspended';
    if current_state in ('approved','expired','suspended')
      and target.owner_approval_state::text is distinct from current_state then
      return jsonb_build_object('status','unavailable');
    end if;
    if not verification_valid then
      restoration_restriction:='verification-unavailable';
      if can_reactivate then
        can_reactivate:=false;restriction_reason:='verification-unavailable';
      end if;
    else
      restoration_state:=case when verification_expired then 'expired' else 'approved' end;
      if verification_expired then
        restoration_restriction:='verification-expired';
      end if;
    end if;
    if not can_suspend
      and not can_reactivate
      and restriction_reason is null then restriction_reason:='owner-application-ineligible';
    end if;
  else
    current_state:=case when profile.business_suspended then 'suspended' else coalesce(listing.state::text,'unpublished') end;
    current_revision:=profile.suspension_revision;
    can_suspend:=not profile.business_suspended;
    can_reactivate:=profile.business_suspended;
    if profile.status='abandoned' then
      can_suspend:=false;can_reactivate:=false;restriction_reason:='abandoned-profile';
    elsif (profile.business_suspended and listing.profile_id is not null and listing.state<>'suspended')
      or (not profile.business_suspended and listing.state='suspended')
      or (profile.business_suspended and ((profile.listing_state_before_suspension is null)<>(listing.profile_id is null))) then
      return jsonb_build_object('status','unavailable');
    end if;
    if profile.listing_state_before_suspension is null then
      restoration_state:='unpublished';
    elsif profile.listing_state_before_suspension='paused' then
      restoration_state:='paused';restoration_restriction:='previously-paused';
    elsif target.role='cottage_owner' and target.owner_approval_state='approved'
      and application.status='approved' and verification_valid and not verification_expired
      and facts.publication_matches and facts.schedule_matches then
      restoration_state:='published';
    else
      restoration_state:='paused';restoration_restriction:='publication-or-owner-ineligible';
    end if;
  end if;
  return jsonb_build_object('status','ready','targetKind', get_marketplace_suspension.target_kind,'targetId', get_marketplace_suspension.target_id,
    'state', current_state,'revision', current_revision,'applicationId', application.id,
    'canSuspend', can_suspend,'canReactivate', can_reactivate,'restrictionReason', restriction_reason,
    'restorationState', restoration_state,'restorationRestriction', restoration_restriction,
    'releaseSummary', facts.release_summary,'actions', facts.actions,'nextCursor', facts.next_cursor);
end;
$$;
ALTER FUNCTION public.get_marketplace_suspension(text, uuid, timestamptz, uuid, integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.record_administrator_booking_money_export(
  target_state text, target_from date, target_through date
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
declare
  selection jsonb;
  export_id uuid;
  recorded_at timestamptz;
begin
  selection:=public.list_administrator_booking_money(target_state,target_from,target_through);
  if selection->>'status'='too_many' then return selection; end if;
  if jsonb_array_length(selection->'bookings')=0 and jsonb_array_length(selection->'missingPaymentEvidence')=0 then
    return jsonb_build_object('status','empty');
  end if;
  insert into private.administrator_booking_money_exports
    (administrator_user_id,recorded_at,filter_state,filter_from,filter_through,booking_request_ids)
  select auth.uid(),statement_timestamp(),target_state,target_from,target_through,
    array_agg(distinct (booking->>'bookingRequestId')::uuid order by (booking->>'bookingRequestId')::uuid)
  from jsonb_array_elements((selection->'bookings')||(selection->'missingPaymentEvidence')) booking
  returning id,administrator_booking_money_exports.recorded_at into export_id,recorded_at;
  return jsonb_build_object('status','recorded','exportId',export_id,
    'recordedAt',to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'),'selection',selection);
end;
$$;
ALTER FUNCTION public.record_administrator_booking_money_export(text,date,date) OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.reject_administrator_booking_money_export_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
begin
  raise exception 'Administrator money export records are immutable' using errcode='RC409';
end;
$$;
ALTER FUNCTION private.reject_administrator_booking_money_export_change() OWNER TO postgres;
