-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.get_confirmed_booking_access (
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

REVOKE ALL ON FUNCTION public.get_confirmed_booking_access(text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_confirmed_booking_access(text) TO authenticated;