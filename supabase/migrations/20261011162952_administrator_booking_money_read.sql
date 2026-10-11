-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.administrator_booking_money_facts (
  target_state    text,
  target_from     date,
  target_through  date,
  admission_limit integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE FUNCTION public.list_administrator_booking_money (
  target_state   text,
  target_from    date,
  target_through date
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if public.is_platform_administrator('aal2') is not true then
    raise exception 'Platform Administrator AAL2 access required' using errcode = '42501';
  end if;
  return public.administrator_booking_money_facts(target_state, target_from, target_through, 500);
end;
$function$;

REVOKE ALL ON FUNCTION public.administrator_booking_money_facts(text, date, date, integer), public.list_administrator_booking_money(text, date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_administrator_booking_money(text, date, date) TO authenticated;
