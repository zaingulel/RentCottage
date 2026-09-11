-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.list_confirmed_booking_history()
  RETURNS SETOF jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=(select auth.uid()); declare context public.account_contexts;
begin
  select * into context from public.account_contexts where user_id=actor;
  if actor is null or context.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null) or context.role not in ('customer','cottage_owner') then raise exception 'Booking History unavailable' using errcode='42501'; end if;
  return query select jsonb_build_object('receiptId',receipts.id,'bookingRequestReference',requests.booking_request_reference,'bookingReference',commitments.commitment_reference,'cottageName',snapshots.quote_payload->>'cottageName','confirmedAt',confirmations.confirmed_at,'cancelled',exists(select 1 from public.booking_cancellations cancellations where cancellations.booking_request_id=requests.id),'actorRole',receipts.recipient_role)
  from public.booking_receipts receipts join public.booking_confirmations confirmations on confirmations.id=receipts.booking_confirmation_id join public.booking_requests requests on requests.id=confirmations.booking_request_id join public.booking_snapshots snapshots on snapshots.id=receipts.booking_snapshot_id join public.cottage_booking_period_commitments commitments on commitments.id=confirmations.booking_period_commitment_id
  where receipts.recipient_user_id=actor and ((receipts.recipient_role='customer' and requests.customer_user_id=actor and context.role in ('customer','cottage_owner')) or (receipts.recipient_role='cottage_owner' and requests.owner_user_id=actor and context.role='cottage_owner' and context.owner_approval_state='approved')) and (public.booking_request_payment_status(requests)='paid-confirmed' or exists(select 1 from public.booking_cancellations cancellations where cancellations.booking_request_id=requests.id)) order by confirmations.confirmed_at desc,receipts.id;
end $function$;