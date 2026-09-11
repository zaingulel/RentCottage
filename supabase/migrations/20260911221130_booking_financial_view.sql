-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.get_booking_financial_view (
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
  return result;
end;
$function$;

REVOKE ALL ON FUNCTION public.get_booking_financial_view(text, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_booking_financial_view(text, text) TO authenticated;