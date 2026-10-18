-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

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
    select case when actor_request.customer_user_id = contexts.user_id then 'customer'::public.account_role else 'cottage_owner'::public.account_role end as role
    from public.booking_requests actor_request
    join public.account_contexts contexts on contexts.user_id = (select auth.uid())
    join auth.users actor_user on actor_user.id = contexts.user_id
    where actor_request.booking_request_reference = target_reference
      and actor_user.phone_confirmed_at is not null
      and (
        (contexts.role in ('customer'::public.account_role, 'cottage_owner'::public.account_role)
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
    'coverMediaId',(select media.opaque_id
      from public.cottage_publication_media media
      where media.publication_id=profiles.current_publication_id
        and public.is_cottage_publicly_discoverable(profiles.id)
      order by media.position limit 1),
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
      then case
        when btrim(customer_user.phone) ~ '^[1-9][0-9]{7,14}$'
          then '+' || btrim(customer_user.phone)
        else nullif(btrim(customer_user.phone), '')
      end end,
    'ownerPhone', case when owner_user.phone_confirmed_at is not null
      then case
        when btrim(owner_user.phone) ~ '^[1-9][0-9]{7,14}$'
          then '+' || btrim(owner_user.phone)
        else nullif(btrim(owner_user.phone), '')
      end end
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

CREATE OR REPLACE FUNCTION public.get_customer_booking_request (
  target_reference text
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select jsonb_build_object('id',requests.id,'bookingRequestReference',requests.booking_request_reference,
    'status',requests.status,'paymentStatus',public.booking_request_payment_status(requests),
    'paymentRequiredWindow',public.booking_request_payment_required_window(requests),
    'paymentRequiredExpiry',public.booking_request_payment_required_expiry_status(requests),
    'paymentRecovery',public.booking_request_payment_recovery_status(requests),
    'coverMediaId',(select media.opaque_id
      from public.owner_application_cottage_profiles profiles
      join public.cottage_publication_media media on media.publication_id=profiles.current_publication_id
      where profiles.id=requests.profile_id and public.is_cottage_publicly_discoverable(profiles.id)
      order by media.position limit 1),
    'cottageName',snapshots.quote_payload->>'cottageName','bookingPeriod',snapshots.quote_payload->'items',
    'partySize',requests.party_size,'bookingPriceIqd',(snapshots.quote_payload->>'bookingPriceIqd')::bigint,
    'serviceFeeIqd',(snapshots.quote_payload->>'serviceFeeIqd')::bigint,
    'customerTotalIqd',(snapshots.quote_payload->>'customerTotalIqd')::bigint,
    'responseDeadline',to_char(requests.response_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'declineReason',requests.decline_reason,'declineNote',requests.decline_note,
    'statusNotifications',coalesce((select jsonb_agg(jsonb_build_object('id',receipts.id,'status',receipts.status,
      'createdAt',to_char(receipts.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by receipts.created_at)
      from public.booking_request_status_notifications receipts where receipts.booking_request_id=requests.id
        and receipts.recipient_user_id=(select auth.uid())),'[]'::jsonb))
  from public.booking_requests requests join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id
  where requests.booking_request_reference=target_reference and requests.customer_user_id=(select auth.uid())
    and exists(select 1 from public.account_contexts contexts where contexts.user_id=(select auth.uid()) and contexts.role in ('customer','cottage_owner'));
$function$;