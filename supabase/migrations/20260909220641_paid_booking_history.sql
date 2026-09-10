-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.get_booking_confirmation_notification_status (
  target_receipt_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare r public.booking_receipts; declare role public.account_contexts; declare actor uuid:=(select auth.uid());
begin
  select * into w from public.booking_confirmation_notification_work where receipt_id=target_receipt_id;
  select * into r from public.booking_receipts where id=target_receipt_id;
  select requests.* into q from public.booking_requests requests join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id where confirmations.id=r.booking_confirmation_id;
  select * into role from public.account_contexts where user_id=actor;
  if actor is null or role.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null) or r.id is null or r.recipient_user_id is distinct from actor or role.role::text is distinct from r.recipient_role or (r.recipient_role='cottage_owner' and role.owner_approval_state::text is distinct from 'approved') or (w.receipt_id is null and public.booking_request_payment_status(q) is distinct from 'paid-confirmed') then raise exception 'Notification status unavailable' using errcode='42501'; end if;
  if w.receipt_id is null then return jsonb_build_object('receiptId',r.id,'state','pending','lastOutcome',null,'supplierDeliveryReference',null,'deliveredAt',null,'suppressedAt',null,'historical',false); end if;
  return jsonb_build_object('receiptId',w.receipt_id,'state',w.state,'lastOutcome',w.last_outcome,'supplierDeliveryReference',w.supplier_delivery_reference,'deliveredAt',w.delivered_at,'suppressedAt',w.suppressed_at,'historical',w.state='delivered' and public.booking_request_payment_status(q)<>'paid-confirmed');
end $function$;

CREATE OR REPLACE FUNCTION public.get_confirmed_booking_access (
  target_reference text
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with actor as (
    select contexts.role
    from public.booking_requests actor_request
    join public.account_contexts contexts on contexts.user_id = (select auth.uid())
    join auth.users actor_user on actor_user.id = contexts.user_id
    where actor_request.booking_request_reference = target_reference
      and actor_user.phone_confirmed_at is not null
      and (
        (contexts.role = 'customer'::public.account_role
          and actor_request.customer_user_id = contexts.user_id)
        or
        (contexts.role = 'cottage_owner'::public.account_role
          and contexts.owner_approval_state = 'approved'::public.owner_approval_state
          and actor_request.owner_user_id = contexts.user_id)
      )
  )
  select jsonb_build_object(
    'receiptId', receipts.id,
    'bookingRequestReference', requests.booking_request_reference,
    'bookingReference', commitments.commitment_reference,
    'confirmedAt', to_char(confirmations.confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'actorRole', actor.role,
    'customerName', requests.customer_name,
    'cottageName', snapshots.quote_payload ->> 'cottageName',
    'bookingPeriod', snapshots.quote_payload -> 'items',
    'partySize', requests.party_size,
    'pricing', case actor.role
      when 'customer'::public.account_role then jsonb_build_object(
        'bookingPriceIqd', (snapshots.quote_payload ->> 'bookingPriceIqd')::bigint,
        'serviceFeeIqd', (snapshots.quote_payload ->> 'serviceFeeIqd')::bigint,
        'customerTotalIqd', (snapshots.quote_payload ->> 'customerTotalIqd')::bigint
      )
      when 'cottage_owner'::public.account_role then jsonb_build_object(
        'bookingPriceIqd', (snapshots.quote_payload ->> 'bookingPriceIqd')::bigint,
        'marketplaceCommissionFils', snapshots.marketplace_commission_amount_fils,
        'ownerNetFils',
          (snapshots.quote_payload ->> 'bookingPriceIqd')::bigint * 1000
            - snapshots.marketplace_commission_amount_fils
      )
    end,
    'houseRules', snapshots.quote_payload ->> 'houseRules',
    'bookingTermsVersion', snapshots.booking_terms_version,
    'bookingTermsBody', snapshots.booking_terms_body,
    'cancellationPolicyVersion', snapshots.cancellation_policy_version,
    'exactAddress', nullif(btrim(profiles.exact_address), ''),
    'privateDirections', nullif(btrim(profiles.private_directions), ''),
    'mapPin', case
      when profiles.exact_latitude is not null and profiles.exact_longitude is not null
        then jsonb_build_object(
          'latitude', profiles.exact_latitude,
          'longitude', profiles.exact_longitude
        )
      else null
    end,
    'customerPhone', case when customer_user.phone_confirmed_at is not null
      then nullif(btrim(customer_user.phone), '') end,
    'ownerPhone', case when owner_user.phone_confirmed_at is not null
      then nullif(btrim(owner_user.phone), '') end
  )
  from public.booking_requests requests
  join actor on true
  join public.booking_snapshots snapshots
    on snapshots.id = requests.booking_snapshot_id
    and snapshots.customer_user_id = requests.customer_user_id
    and snapshots.profile_id = requests.profile_id
  join public.cottage_booking_period_commitments commitments
    on commitments.id = requests.booking_period_commitment_id
    and commitments.customer_user_id = requests.customer_user_id
    and commitments.profile_id = requests.profile_id
  join public.booking_confirmations confirmations
    on confirmations.booking_request_id = requests.id
    and confirmations.booking_snapshot_id = snapshots.id
    and confirmations.booking_period_commitment_id = commitments.id
  join public.booking_receipts receipts
    on receipts.booking_confirmation_id = confirmations.id
    and receipts.booking_snapshot_id = snapshots.id
    and receipts.recipient_user_id = (select auth.uid())
    and receipts.recipient_role = actor.role::text
  join public.owner_application_cottage_profiles profiles
    on profiles.id = requests.profile_id
    and profiles.owner_user_id = requests.owner_user_id
  join auth.users customer_user on customer_user.id = requests.customer_user_id
  join auth.users owner_user on owner_user.id = requests.owner_user_id
  where requests.booking_request_reference = target_reference
    and public.booking_request_payment_status(requests) = 'paid-confirmed';
$function$;

CREATE FUNCTION public.list_confirmed_booking_history()
  RETURNS SETOF jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=(select auth.uid()); declare context public.account_contexts;
begin
  select * into context from public.account_contexts where user_id=actor;
  if actor is null or context.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null) or (context.role='cottage_owner' and context.owner_approval_state::text is distinct from 'approved') then raise exception 'Booking History unavailable' using errcode='42501'; end if;
  return query select jsonb_build_object('receiptId',receipts.id,'bookingRequestReference',requests.booking_request_reference,'bookingReference',commitments.commitment_reference,'cottageName',snapshots.quote_payload->>'cottageName','confirmedAt',confirmations.confirmed_at,'actorRole',receipts.recipient_role)
  from public.booking_receipts receipts join public.booking_confirmations confirmations on confirmations.id=receipts.booking_confirmation_id join public.booking_requests requests on requests.id=confirmations.booking_request_id join public.booking_snapshots snapshots on snapshots.id=receipts.booking_snapshot_id join public.cottage_booking_period_commitments commitments on commitments.id=confirmations.booking_period_commitment_id
  where receipts.recipient_user_id=actor and receipts.recipient_role=context.role::text and public.booking_request_payment_status(requests)='paid-confirmed' order by confirmations.confirmed_at desc,receipts.id;
end $function$;

REVOKE ALL ON FUNCTION public.list_confirmed_booking_history() FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_confirmed_booking_history() TO authenticated;
