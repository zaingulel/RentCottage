-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.list_confirmed_booking_history();

CREATE FUNCTION public.list_booking_history (
  target_actor_role text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=(select auth.uid()); declare context public.account_contexts;
begin
  select * into context from public.account_contexts where user_id=actor;
  if actor is null or context.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null)
    or target_actor_role not in ('customer','cottage_owner')
    or (target_actor_role='customer' and context.role not in ('customer','cottage_owner'))
    or (target_actor_role='cottage_owner' and (context.role<>'cottage_owner' or context.owner_approval_state<>'approved'))
  then raise exception 'Booking History unavailable' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(source.item order by source.created_at desc,source.booking_request_id,source.actor_role),'[]'::jsonb) from (
    select requests.created_at,requests.id booking_request_id,target_actor_role actor_role,
      jsonb_strip_nulls(jsonb_build_object(
        'bookingRequestId',requests.id,'bookingRequestReference',requests.booking_request_reference,
        'bookingReference',case when access.paid_access then commitments.commitment_reference end,
        'receiptId',case when access.paid_access then receipts.id end,'cottageName',snapshots.quote_payload->>'cottageName','createdAt',requests.created_at,
        'confirmedAt',case when access.paid_access then confirmations.confirmed_at end,'firstStartsAt',(select min(lower(period)) from unnest(commitments.access_ranges) period),
        'lastEndsAt',(select max(upper(period)) from unnest(commitments.access_ranges) period),'actorRole',target_actor_role,
        'status',case when access.paid_access
          then public.get_booking_lifecycle(requests.booking_request_reference,target_actor_role)->>'status'
          else coalesce(public.booking_request_payment_status(requests),requests.status) end)) item
    from public.booking_requests requests
    join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id
    join public.cottage_booking_period_commitments commitments on commitments.id=requests.booking_period_commitment_id
    left join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id
    left join public.booking_receipts receipts on receipts.booking_confirmation_id=confirmations.id and receipts.recipient_role=target_actor_role
    cross join lateral (select confirmations.id is not null
      and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=requests.id)
      and not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=requests.id and expiry.state='quarantined')
      and (public.booking_request_payment_status(requests)='paid-confirmed' or exists(select 1 from public.booking_cancellations cancellation where cancellation.booking_request_id=requests.id)) paid_access) access
    where (target_actor_role='customer' and requests.customer_user_id=actor)
      or (target_actor_role='cottage_owner' and requests.owner_user_id=actor)
  ) source);
end $function$;

REVOKE ALL ON FUNCTION public.list_booking_history(text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_booking_history(text) TO authenticated;
