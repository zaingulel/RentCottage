-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.booking_settlement_recovery (
  target_booking_request_id uuid,
  captured                  jsonb,
  refunded                  jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare intent public.booking_settlement_intents; declare ledger public.payment_provider_operations; declare receipt public.booking_settlement_receipts;
declare entitlement bigint; declare balance bigint; declare blocked boolean; declare later_refund boolean;
begin
  select * into intent from public.booking_settlement_intents where booking_request_id=target_booking_request_id;
  select operation.* into ledger from public.payment_provider_operations operation join public.booking_settlement_attempts attempt on attempt.id::text=operation.admission#>>'{permit,attemptId}'
    where attempt.settlement_intent_id=intent.id and operation.admission->>'purpose'='booking-settlement' and operation.current_outcome='succeeded';
  if ledger.id is null then return '{"status":"unsettled"}'::jsonb; end if;
  select r.* into receipt from public.booking_settlement_receipts r
    join public.payment_provider_observations observation on observation.id=r.observation_id and observation.operation_id=ledger.id and observation.result->>'outcome'='succeeded'
    join public.booking_request_payment_history history on history.sequence=r.history_sequence and history.provider_operation_id=ledger.id and history.outcome='succeeded'
    where r.settlement_intent_id=intent.id and r.operation_id=ledger.id;
  if receipt.settlement_intent_id is null or ledger.amount_fils is distinct from intent.amount_fils then return '{"status":"unavailable"}'::jsonb; end if;
  entitlement:=((captured->>'bookingPriceFils')::bigint-(refunded->>'bookingPriceFils')::bigint)*9/10;
  blocked:=cardinality(receipt.active_hold_ids)>0 or cardinality(receipt.active_dispute_ids)>0;
  -- A completed refund refreshes recovery under #30. Use serialized history order,
  -- never provider occurrence time or potentially equal received timestamps.
  select exists(select 1 from public.booking_request_payment_history history join public.payment_provider_operations operation on operation.id=history.provider_operation_id
    where history.sequence>receipt.history_sequence and history.source='provider-operation' and history.outcome='succeeded' and operation.current_outcome='succeeded' and operation.operation_kind='refund'
    and ((operation.admission->>'purpose'='booking-refund' and operation.admission#>>'{permit,binding,captureOperationId}'=intent.capture_operation_id::text)
      or exists(select 1 from public.booking_request_payment_required_expiry_operations corrective where corrective.capture_provider_operation_id=intent.capture_operation_id
        and (corrective.provider_operation_id=operation.id or (corrective.provider,corrective.environment,corrective.merchant_id,corrective.terminal_id,corrective.provider_idempotency_key)
          =(operation.provider,operation.environment,operation.merchant_id,operation.terminal_id,operation.provider_idempotency_key))))) into later_refund;
  balance:=case when blocked and not later_refund then ledger.amount_fils else greatest(ledger.amount_fils-entitlement,0) end;
  return jsonb_build_object('status','paid','ownerEntitlementFils',entitlement,'paidFils',ledger.amount_fils,'paidWhileBlocked',blocked,
    'recoveryExposureFils',greatest(case when blocked then ledger.amount_fils else 0 end,balance),'recoveryBalanceFils',balance,'automaticOwnerDebitFils',0);
end;
$function$;

REVOKE ALL ON FUNCTION public.booking_settlement_recovery(uuid, jsonb, jsonb) FROM PUBLIC;

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
    'notifications',(select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('eventId',e.id,'receiptId',e.receipt_id,'kind',e.event_kind,'dueAt',e.due_at,'recipientRole',e.recipient_role,'state',coalesce(w.state,'pending'),'deliveredAt',w.delivered_at,'outcome',w.last_outcome,'retryAllowed',coalesce(target_actor_role<>'platform_administrator' and w.state='retryable' and public.booking_notification_is_deliverable(w),false))) order by e.created_at,e.id),'[]') from public.booking_notification_events e left join public.booking_confirmation_notification_work w on w.event_id=e.id where e.booking_request_id=request.id and (target_actor_role='platform_administrator' or (e.recipient_user_id=(select auth.uid()) and e.recipient_role=target_actor_role))));
  if target_actor_role='platform_administrator' then
    result:=result||jsonb_build_object('payout',public.get_booking_settlement_facts(request.id),'audit',jsonb_build_object('cancellation',case when cancellation.id is not null then jsonb_build_object('reason',cancellation.reason,'category',cancellation.category,'actorUserId',cancellation.actor_user_id,'actorRole',cancellation.actor_role) end,
      'refunds',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'reason',reason,'actorUserId',actor_user_id) order by created_at,id),'[]') from public.booking_refund_intents where booking_request_id=request.id and source='administrator')));
  end if;
  if target_actor_role in ('cottage_owner','platform_administrator') then result:=result||jsonb_build_object('ownerPayout',public.booking_settlement_recovery(request.id,facts->'captured',totals->'refunded')); end if;
  result:=result||jsonb_build_object('lifecycle',public.get_booking_lifecycle(target_reference,target_actor_role),'eligibility',public.get_booking_completion_eligibility(target_reference,target_actor_role));
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_booking_settlement_facts (
  target_booking_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare source jsonb; declare projected jsonb; declare snapshot public.booking_snapshots;
declare intent public.booking_settlement_intents; declare attempt public.booking_settlement_attempts; declare ledger public.payment_provider_operations;
begin
  source:=public.get_booking_payout_facts(target_booking_request_id);
  select snapshots.* into snapshot from public.booking_snapshots snapshots join public.booking_requests request on request.booking_snapshot_id=snapshots.id where request.id=target_booking_request_id;
  if snapshot.marketplace_commission_rate_basis_points is distinct from 1000
    or snapshot.marketplace_commission_amount_fils is distinct from (source#>>'{captured,bookingPriceFils}')::bigint/10
    or (source#>>'{captured,bookingPriceFils}')::bigint%10<>0 then
    raise exception 'Original settlement allocation is unavailable' using errcode='RC409'; end if;
  select * into intent from public.booking_settlement_intents where booking_request_id=target_booking_request_id;
  select * into attempt from public.booking_settlement_attempts where settlement_intent_id=intent.id order by generation desc limit 1;
  select * into ledger from public.payment_provider_operations where admission->>'purpose'='booking-settlement' and admission#>>'{permit,attemptId}'=attempt.id::text;
  projected:=source||jsonb_build_object('recovery',public.booking_settlement_recovery(target_booking_request_id,source->'captured',source->'refunded'),'maturity',public.booking_completion_eligibility(target_booking_request_id),
    'settlement',case when intent.id is not null then jsonb_build_object('id',intent.id,'commandId',intent.command_id,'amountFils',intent.amount_fils,'actorUserId',intent.actor_user_id,'reason',intent.reason,'requestedAt',intent.created_at,
      'receipt',(select jsonb_build_object('observationId',r.observation_id,'historySequence',r.history_sequence,'recordedAt',o.received_at,'activeHoldIds',to_jsonb(r.active_hold_ids),'activeDisputeIds',to_jsonb(r.active_dispute_ids)) from public.booking_settlement_receipts r join public.payment_provider_observations o on o.id=r.observation_id where r.settlement_intent_id=intent.id),
      'state',case when ledger.id is null then 'requested' else coalesce(ledger.current_outcome,'processing') end,
      'retrySafe',coalesce((public.payment_provider_recorded_result(ledger)->>'retrySafe')::boolean,false)) end);
  return projected||jsonb_build_object('revision',md5(projected::text));
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_booking_settlement_observation (
  target_operation_id uuid,
  target_result       jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare ledger public.payment_provider_operations; declare attempt public.booking_settlement_attempts; declare intent public.booking_settlement_intents; declare facts jsonb; declare was_succeeded boolean;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-settlement']);
  select * into attempt from public.booking_settlement_attempts where id=(ledger.admission#>>'{permit,attemptId}')::uuid;
  select * into intent from public.booking_settlement_intents where id=attempt.settlement_intent_id;
  perform public.lock_booking_refund_source(intent.booking_request_id);
  if intent.id is null or ledger.admission->'permit' is distinct from public.booking_settlement_execution_permit(attempt)
    or ledger.amount_fils is distinct from intent.amount_fils then raise exception 'Settlement observation binding is invalid' using errcode='RC409'; end if;
  facts:=public.get_booking_payout_facts(intent.booking_request_id);
  was_succeeded:=ledger.current_outcome is not distinct from 'succeeded';
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  if ledger.current_outcome='succeeded' and not was_succeeded then
    insert into public.booking_settlement_receipts(settlement_intent_id,operation_id,observation_id,history_sequence,active_hold_ids,active_dispute_ids)
    select intent.id,ledger.id,observation.id,history.sequence,
      array(select value::uuid from jsonb_array_elements_text(facts->'activeHoldIds')),
      array(select value::uuid from jsonb_array_elements_text(facts->'activeDisputeIds'))
    from public.payment_provider_observations observation
      join public.booking_request_payment_history history on history.provider_operation_id=ledger.id and history.source='provider-operation' and history.outcome='succeeded'
    where observation.operation_id=ledger.id and observation.event_id=target_result#>>'{evidence,eventId}'
    order by history.sequence limit 1;
    if not found then raise exception 'Settlement success context is unavailable' using errcode='RC409'; end if;
  end if;
  return public.payment_provider_recorded_result(ledger);
end;
$function$;

CREATE TABLE public.booking_settlement_receipts (
  settlement_intent_id uuid   NOT NULL,
  operation_id         uuid   NOT NULL,
  observation_id       uuid   NOT NULL,
  history_sequence     bigint NOT NULL,
  active_hold_ids      uuid[] NOT NULL,
  active_dispute_ids   uuid[] NOT NULL
);

ALTER TABLE public.booking_settlement_receipts
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_settlement_receipts
  ADD CONSTRAINT booking_settlement_receipts_history_fkey FOREIGN KEY (history_sequence) REFERENCES public.booking_request_payment_history(SEQUENCE) ON DELETE RESTRICT;

ALTER TABLE public.booking_settlement_receipts
  ADD CONSTRAINT booking_settlement_receipts_history_sequence_key UNIQUE (history_sequence);

ALTER TABLE public.booking_settlement_receipts
  ADD CONSTRAINT booking_settlement_receipts_intent_fkey FOREIGN KEY (settlement_intent_id) REFERENCES public.booking_settlement_intents(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_settlement_receipts
  ADD CONSTRAINT booking_settlement_receipts_observation_fkey FOREIGN KEY (observation_id) REFERENCES public.payment_provider_observations(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_settlement_receipts
  ADD CONSTRAINT booking_settlement_receipts_observation_id_key UNIQUE (observation_id);

ALTER TABLE public.booking_settlement_receipts
  ADD CONSTRAINT booking_settlement_receipts_operation_fkey FOREIGN KEY (operation_id) REFERENCES public.payment_provider_operations(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_settlement_receipts
  ADD CONSTRAINT booking_settlement_receipts_operation_id_key UNIQUE (operation_id);

ALTER TABLE public.booking_settlement_receipts
  ADD CONSTRAINT booking_settlement_receipts_pkey PRIMARY KEY (settlement_intent_id);

CREATE TRIGGER reject_booking_settlement_receipts_change
  BEFORE DELETE OR UPDATE ON public.booking_settlement_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_booking_cancellation_fact_change();
REVOKE ALL ON TABLE public.booking_settlement_receipts FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.booking_settlement_recovery(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
