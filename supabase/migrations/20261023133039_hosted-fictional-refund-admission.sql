-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.admit_booking_refund (
  target_permit jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare intent public.booking_refund_intents; declare attempt public.booking_refund_attempts; declare capture public.payment_provider_operations;
declare ledger public.payment_provider_operations; declare expected jsonb; declare source jsonb;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Refund admission unavailable' using errcode='42501'; end if;
  source:=public.lock_booking_refund_source((target_permit#>>'{binding,bookingRequestId}')::uuid);
  select * into attempt from public.booking_refund_attempts where id=(target_permit->>'attemptId')::uuid;
  select * into intent from public.booking_refund_intents where id=attempt.refund_intent_id;
  select * into capture from public.payment_provider_operations where id=intent.capture_operation_id;
  expected:=public.booking_refund_execution_permit(attempt);
  if attempt.id is null or target_permit is distinct from expected or intent.booking_request_id::text<>source->>'bookingRequestId'
    or capture.id::text<>source->>'captureOperationId'
    or (expected#>'{binding,providerIdentity}' is distinct from '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
      and expected#>'{binding,providerIdentity}' is distinct from '{"provider":"fictional-payments","environment":"hosted-demo-yvibcyqtyihpzpmomnzg","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb) then
    raise exception 'Refund admission binding is invalid' using errcode='RC409'; end if;
  select * into ledger from public.payment_provider_operations where admission->>'purpose'='booking-refund' and admission#>>'{permit,attemptId}'=attempt.id::text;
  if found then return public.payment_operation_admission(ledger); end if;
  if public.booking_settlement_has_unresolved_execution(intent.booking_request_id) then return jsonb_build_object('status','not-admitted'); end if;
  if attempt.not_after<=clock_timestamp() or exists(select 1 from public.booking_refund_attempts newer where newer.refund_intent_id=intent.id and newer.generation>attempt.generation) then
    return jsonb_build_object('status','not-admitted'); end if;
  perform public.booking_capture_refund_totals(capture.id,source->'captured');
  insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,admission,evidence_provenance)
    values(gen_random_uuid(),capture.claim_id,capture.claim_generation,'refund',capture.provider,capture.environment,capture.merchant_id,capture.terminal_id,
      expected->>'idempotencyKey',intent.command_fingerprint,capture.payment_lifecycle_id,expected#>>'{binding,logicalOperationId}',expected#>>'{binding,attemptId}',
      intent.booking_price_fils+intent.booking_service_fee_fils,capture.currency,
      jsonb_build_object('purpose','booking-refund','permit',expected,'notBefore',attempt.created_at,'notAfter',attempt.not_after),'admitted') returning * into ledger;
  return public.payment_operation_admission(ledger,true);
end;
$function$;