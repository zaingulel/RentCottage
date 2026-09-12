-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.get_booking_financial_view (
  target_reference  text,
  target_actor_role text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare request public.booking_requests; declare snapshot public.booking_snapshots; declare commitment public.cottage_booking_period_commitments;
declare cancellation public.booking_cancellations; declare facts jsonb; declare totals jsonb; declare result jsonb;
begin
  select * into request from public.booking_requests where booking_request_reference=target_reference;
  if request.id is null or not exists(select 1 from public.booking_confirmations where booking_request_id=request.id)
    or (public.booking_request_payment_status(request) is distinct from 'paid-confirmed' and not exists(select 1 from public.booking_cancellations where booking_request_id=request.id)) then return null; end if;
  -- Reuse the same role, participant, approval and administrator MFA authority as cancellation.
  facts:=public.get_booking_cancellation_facts(request.id,target_actor_role);
  perform public.lock_booking_refund_source(request.id);
  totals:=public.booking_capture_refund_totals((facts->>'captureOperationId')::uuid,facts->'captured');
  select * into snapshot from public.booking_snapshots where id=request.booking_snapshot_id;
  select * into commitment from public.cottage_booking_period_commitments where id=request.booking_period_commitment_id;
  select * into cancellation from public.booking_cancellations where booking_request_id=request.id;
  result:=jsonb_build_object('bookingRequestId',request.id,'bookingRequestReference',request.booking_request_reference,'bookingReference',commitment.commitment_reference,
    'actorRole',target_actor_role,'cottageName',snapshot.quote_payload->>'cottageName','firstStartsAt',facts->'firstStartsAt','bookingTermsBody',snapshot.booking_terms_body,
    'captured',facts->'captured','refunded',totals->'refunded','reserved',totals->'reserved',
    'cancellation',case when cancellation.id is not null then jsonb_build_object('occurredAt',cancellation.occurred_at,'obligation',jsonb_build_object('bookingPriceFils',cancellation.refund_booking_price_fils,'bookingServiceFeeFils',cancellation.refund_booking_service_fee_fils)) end,
    'refunds',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'occurredAt',created_at,'source',source,'state',public.booking_refund_intent_state(id),'allocation',jsonb_build_object('bookingPriceFils',booking_price_fils,'bookingServiceFeeFils',booking_service_fee_fils)) order by created_at,id),'[]') from public.booking_refund_intents where booking_request_id=request.id),
    'notifications',(select coalesce(jsonb_agg(jsonb_build_object('eventId',e.id,'receiptId',e.receipt_id,'kind',e.event_kind,'state',coalesce(w.state,'pending')) order by e.created_at,e.id),'[]') from public.booking_notification_events e left join public.booking_confirmation_notification_work w on w.event_id=e.id where e.booking_request_id=request.id and e.recipient_user_id=(select auth.uid()) and e.recipient_role=target_actor_role));
  if target_actor_role='platform_administrator' then
    result:=result||jsonb_build_object('audit',jsonb_build_object('cancellation',case when cancellation.id is not null then jsonb_build_object('reason',cancellation.reason,'category',cancellation.category,'actorUserId',cancellation.actor_user_id,'actorRole',cancellation.actor_role) end,
      'refunds',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'reason',reason,'actorUserId',actor_user_id) order by created_at,id),'[]') from public.booking_refund_intents where booking_request_id=request.id and source='administrator')));
  end if;
  result:=result||jsonb_build_object('lifecycle',public.get_booking_lifecycle(target_reference,target_actor_role),'eligibility',public.get_booking_completion_eligibility(target_reference,target_actor_role));
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_booking_lifecycle (
  target_reference  text,
  target_actor_role text
)
  RETURNS jsonb
  LANGUAGE plpgsql
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
  result:=jsonb_build_object('bookingRequestId',request.id,'status',case when lifecycle.id is not null then lifecycle.outcome when exists(select 1 from public.booking_cancellations where booking_request_id=request.id) then 'cancelled' when exists(select 1 from public.booking_incidents where booking_request_id=request.id) then 'incident_pending' else 'confirmed' end);
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
  return query select jsonb_build_object('receiptId',receipts.id,'bookingRequestReference',requests.booking_request_reference,'bookingReference',commitments.commitment_reference,'cottageName',snapshots.quote_payload->>'cottageName','confirmedAt',confirmations.confirmed_at,'cancelled',exists(select 1 from public.booking_cancellations cancellations where cancellations.booking_request_id=requests.id),'actorRole',receipts.recipient_role,'lifecycleStatus',public.get_booking_lifecycle(requests.booking_request_reference,receipts.recipient_role)->>'status')
  from public.booking_receipts receipts join public.booking_confirmations confirmations on confirmations.id=receipts.booking_confirmation_id join public.booking_requests requests on requests.id=confirmations.booking_request_id join public.booking_snapshots snapshots on snapshots.id=receipts.booking_snapshot_id join public.cottage_booking_period_commitments commitments on commitments.id=confirmations.booking_period_commitment_id
  where receipts.recipient_user_id=actor and ((receipts.recipient_role='customer' and requests.customer_user_id=actor and context.role in ('customer','cottage_owner')) or (receipts.recipient_role='cottage_owner' and requests.owner_user_id=actor and context.role='cottage_owner' and context.owner_approval_state='approved')) and (public.booking_request_payment_status(requests)='paid-confirmed' or exists(select 1 from public.booking_cancellations cancellations where cancellations.booking_request_id=requests.id)) order by confirmations.confirmed_at desc,receipts.id;
end $function$;