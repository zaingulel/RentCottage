-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.list_owner_booking_request_notifications()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id',requests.id,'bookingRequestReference',requests.booking_request_reference,
    'status',requests.status,'cancellationStatus',case when cancellation.cancelled then 'cancelled' end,
    'paymentStatus',case when not cancellation.cancelled then public.booking_request_payment_status(requests) end,
    'paymentRequiredWindow',case when not cancellation.cancelled then public.booking_request_payment_required_window(requests) end,
    'paymentRequiredExpiry',case when not cancellation.cancelled then public.booking_request_payment_required_expiry_status(requests) end,
    'customerName',requests.customer_name,'partySize',requests.party_size,'bookingNote',requests.booking_note,
    'cottageName',snapshots.quote_payload->>'cottageName','bookingPeriod',snapshots.quote_payload->'items',
    'bookingPriceIqd',(snapshots.quote_payload->>'bookingPriceIqd')::bigint,
    'marketplaceCommissionFils',snapshots.marketplace_commission_amount_fils,
    'ownerNetFils',(snapshots.quote_payload->>'bookingPriceIqd')::bigint*1000-snapshots.marketplace_commission_amount_fils,
    'houseRules',snapshots.quote_payload->>'houseRules','bookingTermsVersion',snapshots.booking_terms_version,
    'cancellationPolicyVersion',snapshots.cancellation_policy_version,
    'statusNotifications',coalesce((select jsonb_agg(jsonb_build_object('id',receipts.id,'status',receipts.status,
      'createdAt',to_char(receipts.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by receipts.created_at)
      from public.booking_request_status_notifications receipts where receipts.booking_request_id=requests.id
        and receipts.recipient_user_id=(select auth.uid())),'[]'::jsonb),
    'responseDeadline',to_char(requests.response_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt',to_char(notifications.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'coverMediaId',(select media.opaque_id
      from public.owner_application_cottage_profiles profiles
      join public.cottage_publication_media media on media.publication_id=profiles.current_publication_id
      join public.cottage_profile_photos photos on photos.id=media.photo_id and not photos.public_hidden
      where profiles.id=requests.profile_id and public.is_cottage_publicly_discoverable(profiles.id)
      order by media.position limit 1),
    'databaseNow',to_char(date_trunc('milliseconds',clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by notifications.created_at desc),'[]'::jsonb)
  from public.owner_request_notifications notifications
  join public.booking_requests requests on requests.id=notifications.booking_request_id
  join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id
  cross join lateral (select exists(select 1 from public.booking_cancellations cancellations
    where cancellations.booking_request_id=requests.id) cancelled) cancellation
  where notifications.owner_user_id=(select auth.uid())
    and exists(select 1 from auth.users users where users.id=(select auth.uid()) and users.phone_confirmed_at is not null)
    and exists(select 1 from public.account_contexts contexts
    where contexts.user_id=(select auth.uid()) and contexts.role='cottage_owner' and contexts.owner_approval_state='approved');
$function$;