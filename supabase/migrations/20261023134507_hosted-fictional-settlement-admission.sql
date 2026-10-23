-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.admit_booking_settlement (
  target_permit jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare intent public.booking_settlement_intents; declare attempt public.booking_settlement_attempts; declare capture public.payment_provider_operations;
declare ledger public.payment_provider_operations; declare expected jsonb; declare facts jsonb; declare remaining bigint;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Settlement admission unavailable' using errcode='42501'; end if;
  facts:=public.get_booking_settlement_facts((target_permit#>>'{binding,bookingRequestId}')::uuid);
  select * into attempt from public.booking_settlement_attempts where id=(target_permit->>'attemptId')::uuid;
  select * into intent from public.booking_settlement_intents where id=attempt.settlement_intent_id;
  select * into capture from public.payment_provider_operations where id=intent.capture_operation_id;
  expected:=public.booking_settlement_execution_permit(attempt);
  if attempt.id is null or target_permit is distinct from expected or intent.booking_request_id::text is distinct from facts->>'bookingRequestId'
    or capture.id::text is distinct from facts->>'captureOperationId'
    or (expected#>'{binding,providerIdentity}' is distinct from '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
      and expected#>'{binding,providerIdentity}' is distinct from '{"provider":"fictional-payments","environment":"hosted-demo-yvibcyqtyihpzpmomnzg","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb) then
    raise exception 'Settlement admission binding is invalid' using errcode='RC409'; end if;
  select * into ledger from public.payment_provider_operations where admission->>'purpose'='booking-settlement' and admission#>>'{permit,attemptId}'=attempt.id::text;
  if found then return public.payment_operation_admission(ledger); end if;
  remaining:=(facts#>>'{captured,bookingPriceFils}')::bigint-(facts#>>'{refunded,bookingPriceFils}')::bigint;
  if attempt.not_after<=clock_timestamp() or exists(select 1 from public.booking_settlement_attempts newer where newer.settlement_intent_id=intent.id and newer.generation>attempt.generation)
    or not public.booking_settlement_admission_is_eligible(facts) or intent.amount_fils is distinct from remaining-remaining/10
    or exists(select 1 from public.payment_provider_operations prior join public.booking_settlement_attempts prior_attempt on prior_attempt.id::text=prior.admission#>>'{permit,attemptId}'
      where prior.admission->>'purpose'='booking-settlement' and prior_attempt.settlement_intent_id=intent.id
        and (prior.current_outcome is null or prior.current_outcome in ('indeterminate','succeeded') or (prior.current_outcome='failed' and (public.payment_provider_recorded_result(prior)->>'retrySafe')::boolean is not true))) then
    return jsonb_build_object('status','not-admitted'); end if;
  insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,admission,evidence_provenance)
    values(gen_random_uuid(),capture.claim_id,capture.claim_generation,'settlement',capture.provider,capture.environment,capture.merchant_id,capture.terminal_id,
      expected->>'idempotencyKey',intent.command_fingerprint,capture.payment_lifecycle_id,expected#>>'{binding,logicalOperationId}',expected#>>'{binding,attemptId}',intent.amount_fils,capture.currency,
      jsonb_build_object('purpose','booking-settlement','permit',expected,'notBefore',attempt.created_at,'notAfter',attempt.not_after),'admitted') returning * into ledger;
  return public.payment_operation_admission(ledger,true);
end;
$function$;