-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

ALTER TABLE public.booking_notification_events
  DROP CONSTRAINT booking_notification_events_event_kind_check;

CREATE FUNCTION public.admit_booking_refund (
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
    or expected#>'{binding,providerIdentity}' is distinct from '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb then
    raise exception 'Refund admission binding is invalid' using errcode='RC409'; end if;
  select * into ledger from public.payment_provider_operations where admission->>'purpose'='booking-refund' and admission#>>'{permit,attemptId}'=attempt.id::text;
  if found then return public.payment_operation_admission(ledger); end if;
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

REVOKE ALL ON FUNCTION public.admit_booking_refund(jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.admit_booking_refund(jsonb) TO service_role;

CREATE FUNCTION public.booking_capture_refund_totals (
  target_capture_id uuid,
  target_captured   jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare capture public.payment_provider_operations;
declare owned record;
declare state text;
declare refunded_price bigint:=0; declare refunded_fee bigint:=0;
declare reserved_price bigint:=0; declare reserved_fee bigint:=0;
begin
  select * into capture from public.payment_provider_operations where id=target_capture_id for update;
  if capture.id is null or capture.operation_kind<>'capture' or capture.current_outcome<>'succeeded'
    or capture.amount_fils<>(target_captured->>'bookingPriceFils')::bigint+(target_captured->>'bookingServiceFeeFils')::bigint then
    raise exception 'Refund capacity capture is invalid' using errcode='RC409'; end if;
  for owned in select * from public.booking_refund_intents where capture_operation_id=capture.id order by created_at,id loop
    state:=public.booking_refund_intent_state(owned.id);
    if state='succeeded' then refunded_price:=refunded_price+owned.booking_price_fils; refunded_fee:=refunded_fee+owned.booking_service_fee_fils;
    elsif state<>'failed' then reserved_price:=reserved_price+owned.booking_price_fils; reserved_fee:=reserved_fee+owned.booking_service_fee_fils; end if;
  end loop;
  for owned in select corrective.*,ledger.current_outcome from public.booking_request_payment_required_expiry_operations corrective
    left join public.payment_provider_operations ledger on ledger.id=corrective.provider_operation_id
      or (corrective.provider_operation_id is null and ledger.provider_idempotency_key=corrective.provider_idempotency_key
        and (ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id)=(corrective.provider,corrective.environment,corrective.merchant_id,corrective.terminal_id))
    where corrective.capture_provider_operation_id=capture.id and corrective.operation_kind='refund' loop
    if owned.amount_fils<>capture.amount_fils then raise exception 'Corrective refund allocation is invalid' using errcode='RC409'; end if;
    if owned.current_outcome='succeeded' then
      refunded_price:=refunded_price+(target_captured->>'bookingPriceFils')::bigint; refunded_fee:=refunded_fee+(target_captured->>'bookingServiceFeeFils')::bigint;
    elsif owned.current_outcome is null or owned.current_outcome='indeterminate' then
      reserved_price:=reserved_price+(target_captured->>'bookingPriceFils')::bigint; reserved_fee:=reserved_fee+(target_captured->>'bookingServiceFeeFils')::bigint;
    end if;
  end loop;
  if refunded_price+reserved_price>(target_captured->>'bookingPriceFils')::bigint or refunded_fee+reserved_fee>(target_captured->>'bookingServiceFeeFils')::bigint then
    raise exception 'Refund allocations exceed the captured components' using errcode='RC409'; end if;
  return jsonb_build_object('refunded',jsonb_build_object('bookingPriceFils',refunded_price,'bookingServiceFeeFils',refunded_fee),
    'reserved',jsonb_build_object('bookingPriceFils',reserved_price,'bookingServiceFeeFils',reserved_fee));
end;
$function$;

REVOKE ALL ON FUNCTION public.booking_capture_refund_totals(uuid, jsonb) FROM PUBLIC;

CREATE FUNCTION public.booking_refund_intent_state (
  target_intent_id uuid
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce((select case ledger.current_outcome when 'succeeded' then 'succeeded' when 'failed' then 'failed'
      when 'indeterminate' then 'unknown' when 'not-executed' then 'requested' else case when ledger.id is null then 'requested' else 'processing' end end
    from public.booking_refund_attempts attempts left join public.payment_provider_operations ledger
      on ledger.admission#>>'{permit,attemptId}'=attempts.id::text and ledger.admission->>'purpose'='booking-refund'
    where attempts.refund_intent_id=target_intent_id order by attempts.generation desc limit 1),'requested');
$function$;

REVOKE ALL ON FUNCTION public.booking_refund_intent_state(uuid) FROM PUBLIC;

CREATE FUNCTION public.claim_booking_refund (
  target_intent_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare intent public.booking_refund_intents; declare attempt public.booking_refund_attempts;
declare ledger public.payment_provider_operations; declare permit jsonb; declare source jsonb; declare next_generation integer;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Refund work unavailable' using errcode='42501'; end if;
  select * into intent from public.booking_refund_intents where id=target_intent_id;
  source:=public.lock_booking_refund_source(intent.booking_request_id);
  perform public.booking_capture_refund_totals(intent.capture_operation_id,source->'captured');
  select * into attempt from public.booking_refund_attempts where refund_intent_id=intent.id order by generation desc limit 1;
  select * into ledger from public.payment_provider_operations where admission->>'purpose'='booking-refund' and admission#>>'{permit,attemptId}'=attempt.id::text;
  if ledger.current_outcome in ('succeeded','failed') then return jsonb_build_object('status','stale'); end if;
  if ledger.id is not null and ledger.current_outcome is distinct from 'not-executed' then
    permit:=public.booking_refund_execution_permit(attempt);
    return jsonb_build_object('status','query','query',((permit->'binding')-array['bookingRequestId','refundIntentId','captureOperationId','requestFingerprint','providerIdentity'])||
      jsonb_build_object('refundPermit',permit,'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference));
  end if;
  if ledger.id is null and attempt.not_after>clock_timestamp() then return jsonb_build_object('status','processing'); end if;
  next_generation:=coalesce(attempt.generation,0)+1;
  insert into public.booking_refund_attempts(refund_intent_id,generation,not_after) values(intent.id,next_generation,clock_timestamp()+interval '30 seconds') returning * into attempt;
  permit:=public.booking_refund_execution_permit(attempt);
  return jsonb_build_object('status','execute','request',((permit->'binding')-array['bookingRequestId','refundIntentId','captureOperationId','requestFingerprint','providerIdentity'])||jsonb_build_object('executionPermit',permit));
end;
$function$;

REVOKE ALL ON FUNCTION public.claim_booking_refund(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.claim_booking_refund(uuid) TO service_role;

CREATE FUNCTION public.due_booking_refunds (
  target_limit integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Refund batch unavailable' using errcode='42501'; end if;
  if target_limit<1 or target_limit>50 then raise exception 'Refund batch size is invalid' using errcode='22023'; end if;
  return (select coalesce(jsonb_agg(candidate.id),'[]') from (
    select requests.id from public.booking_requests requests where
      exists(select 1 from public.booking_refund_intents intent where intent.booking_request_id=requests.id and public.booking_refund_intent_state(intent.id) in ('requested','processing','unknown'))
      or (exists(select 1 from public.booking_cancellations cancelled where cancelled.booking_request_id=requests.id and cancelled.refund_booking_price_fils+cancelled.refund_booking_service_fee_fils>0)
        and not exists(select 1 from public.booking_refund_intents intent where intent.booking_request_id=requests.id and intent.source='cancellation' and public.booking_refund_intent_state(intent.id)='failed')
        and (select coalesce(sum(intent.booking_price_fils+intent.booking_service_fee_fils),0) from public.booking_refund_intents intent where intent.booking_request_id=requests.id and public.booking_refund_intent_state(intent.id)='succeeded')
          <(select cancelled.refund_booking_price_fils+cancelled.refund_booking_service_fee_fils from public.booking_cancellations cancelled where cancelled.booking_request_id=requests.id))
    order by requests.created_at,requests.id limit target_limit) candidate);
end;
$function$;

REVOKE ALL ON FUNCTION public.due_booking_refunds(integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.due_booking_refunds(integer) TO service_role;

CREATE FUNCTION public.get_booking_refund_facts (
  target_booking_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare source jsonb; declare cancellation public.booking_cancellations; declare projected jsonb;
begin
  if current_setting('role',true)<>'service_role' and not public.is_platform_administrator('aal2') then raise exception 'Refund facts unavailable' using errcode='42501'; end if;
  source:=public.lock_booking_refund_source(target_booking_request_id);
  select * into cancellation from public.booking_cancellations where booking_request_id=target_booking_request_id;
  projected:=source||public.booking_capture_refund_totals((source->>'captureOperationId')::uuid,source->'captured')||jsonb_build_object(
    'obligation',jsonb_build_object('bookingPriceFils',coalesce(cancellation.refund_booking_price_fils,0),'bookingServiceFeeFils',coalesce(cancellation.refund_booking_service_fee_fils,0)),
    'intents',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'state',public.booking_refund_intent_state(id),'automatic',intents.source='cancellation') order by created_at,id),'[]') from public.booking_refund_intents intents where booking_request_id=target_booking_request_id));
  return projected||jsonb_build_object('revision',md5(projected::text));
end;
$function$;

REVOKE ALL ON FUNCTION public.get_booking_refund_facts(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_booking_refund_facts(uuid) TO authenticated;

GRANT ALL ON FUNCTION public.get_booking_refund_facts(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_booking_request_payment_facts (
  target_booking_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare request public.booking_requests;
declare work public.booking_request_capture_work;
declare submission public.booking_request_submission_attempts;
declare source record;
declare source_valid boolean:=true;
declare evidence_valid boolean;
declare operation public.payment_provider_operations;
declare recovery_operation public.booking_request_payment_recovery_operations;
declare recovery public.booking_request_payment_recovery_attempts;
declare expiry_operation public.booking_request_payment_required_expiry_operations;
declare projected jsonb;
declare operations_json jsonb:='[]';
declare expiry_json jsonb:='[]';
declare capture_id uuid;
declare authorization_id uuid;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Payment facts unavailable' using errcode='42501'; end if;
  select * into request from public.booking_requests requests where requests.id=target_booking_request_id for update of requests;
  select * into work from public.booking_request_capture_work capture where capture.booking_request_id=request.id for update of capture;
  if request.id is null or (work.payment_required_deadline is null and not exists(select 1 from public.booking_confirmations where booking_request_id=request.id)) then raise exception 'Payment facts source is invalid' using errcode='RC409'; end if;
  select * into submission from public.booking_request_submission_attempts attempts where attempts.id=work.attempt_id;
  if not public.booking_request_payment_required_expiry_completed(request.id) then
    begin
      select * into source from public.lock_booking_request_capture_source(request.id);
      source_valid:=found;
      capture_id:=(source.ledger).id;
    exception when sqlstate 'RC409' or invalid_text_representation or numeric_value_out_of_range then source_valid:=false;
    end;
  end if;
  select ledger.id into authorization_id from public.payment_provider_operations ledger
    where (ledger.claim_id,ledger.claim_generation,ledger.payment_lifecycle_id,ledger.logical_operation_id,ledger.physical_attempt_id,
      ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,ledger.amount_fils,ledger.currency,
      ledger.provider_request_id,ledger.provider_reference,ledger.movement_reference) is not distinct from
      (work.authorization_claim_id,work.authorization_claim_generation,work.payment_lifecycle_id,work.authorization_logical_operation_id,work.authorization_physical_attempt_id,
      work.provider,work.environment,work.merchant_id,work.terminal_id,work.amount_fils,work.currency,
      submission.payment_snapshot#>>'{authorization,providerRequestId}',submission.payment_snapshot#>>'{authorization,providerReference}',submission.payment_snapshot#>>'{authorization,movementReference}')
      and ledger.operation_kind='authorization' and ledger.current_outcome='succeeded' and ledger.original_outcome in ('succeeded','indeterminate') and ledger.recorded_at is not null;
  perform 1 from public.booking_request_payment_recovery_attempts attempts where attempts.booking_request_id=request.id order by attempts.generation for update of attempts;
  perform 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=request.id for update of expiry;
  for operation in select ledger.* from public.payment_provider_operations ledger
    where ledger.claim_id=work.authorization_claim_id or ledger.payment_lifecycle_id=work.payment_lifecycle_id
      or exists(select 1 from public.booking_request_payment_recovery_attempts attempts where attempts.booking_request_id=request.id and attempts.id=ledger.payment_lifecycle_id)
    order by ledger.created_at,ledger.id for update of ledger
  loop
    select * into recovery_operation from public.booking_request_payment_recovery_operations owned where owned.provider_operation_id=operation.id;
    evidence_valid:=true;
    if recovery_operation.id is not null then
      select * into recovery from public.booking_request_payment_recovery_attempts attempts where attempts.id=recovery_operation.recovery_attempt_id;
      begin
        perform public.validate_booking_request_recovery_operation(recovery_operation,
          public.booking_request_recovery_execution_permit(recovery,work,submission.payment_snapshot,recovery_operation.step));
      exception when sqlstate 'RC409' then evidence_valid:=false;
      end;
    end if;
    operations_json:=operations_json||jsonb_build_object('id',operation.id,'kind',operation.operation_kind,'lifecycleId',operation.payment_lifecycle_id,
      'logicalOperationId',operation.logical_operation_id,'physicalAttemptId',operation.physical_attempt_id,
      'bookingRefund',case when operation.admission->>'purpose'='booking-refund' then (select jsonb_build_object('intentId',intent.id,'captureOperationId',intent.capture_operation_id,'amountFils',intent.booking_price_fils+intent.booking_service_fee_fils)
        from public.booking_refund_attempts refund_attempt join public.booking_refund_intents intent on intent.id=refund_attempt.refund_intent_id where refund_attempt.id=(operation.admission#>>'{permit,attemptId}')::uuid
        and operation.admission->'permit'=public.booking_refund_execution_permit(refund_attempt)) end,
      'outcome',operation.current_outcome,'originalOutcome',operation.original_outcome,'occurredAt',operation.authoritative_outcome_at,
      'executedAt',operation.executed_at,'recordedAt',operation.recorded_at,'provenance',operation.evidence_provenance,'movementReference',operation.movement_reference,
      'providerRequestId',operation.provider_request_id,'providerReference',operation.provider_reference,
      'recoveryAttemptId',operation.recovery_attempt_id,'recoveryOperationId',recovery_operation.id,
      'recoveryStep',coalesce(recovery_operation.step,operation.admission#>>'{permit,step}'),'valid',evidence_valid,
      'permit',case when operation.admission->>'purpose' in ('booking-request-payment-recovery','booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund') then operation.admission->'permit' end);
  end loop;
  for expiry_operation in select owned.* from public.booking_request_payment_required_expiry_operations owned
    where owned.booking_request_id=request.id order by owned.created_at,owned.id for update of owned
  loop
    evidence_valid:=true;
    begin perform public.validate_booking_request_payment_required_expiry_target(expiry_operation,work,submission.payment_snapshot);
    exception when sqlstate 'RC409' then evidence_valid:=false; end;
    expiry_json:=expiry_json||jsonb_build_object('id',expiry_operation.id,'owner',expiry_operation.owner,
      'authorizationLifecycleId',expiry_operation.authorization_payment_lifecycle_id,'kind',expiry_operation.operation_kind,
      'captureId',expiry_operation.capture_provider_operation_id,'providerOperationId',expiry_operation.provider_operation_id,
      'valid',evidence_valid,'permit',public.booking_request_payment_required_expiry_permit(expiry_operation,work.payment_required_deadline));
  end loop;
  projected:=jsonb_build_object('bookingRequestId',request.id,'deadline',work.payment_required_deadline,'amountFils',work.amount_fils,
    'providerIdentity',jsonb_build_object('provider',work.provider,'environment',work.environment,'merchantId',work.merchant_id,'terminalId',work.terminal_id),
    'sourceValid',source_valid,'quarantined',public.booking_request_payment_quarantined(request.id),
    'expired',public.booking_request_payment_required_expiry_completed(request.id),
    'confirmationValid',exists(select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id=request.id
      and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=request.id)),
    'originalLifecycleId',work.payment_lifecycle_id,'originalAuthorizationId',authorization_id,'originalCaptureId',capture_id,
    'attempts',(select coalesce(jsonb_agg(jsonb_build_object('id',attempts.id,'generation',attempts.generation,'state',attempts.state) order by attempts.generation),'[]') from public.booking_request_payment_recovery_attempts attempts where attempts.booking_request_id=request.id),
    'operations',operations_json,'expiryOperations',expiry_json,
    'receipts',(select coalesce(jsonb_agg(jsonb_build_object('operationId',observations.provider_operation_id,'receiptId',observations.receipt_identity,'payload',observations.payload) order by observations.id),'[]') from public.booking_request_payment_correction_observations observations where observations.booking_request_id=request.id));
  return projected||jsonb_build_object('revision',md5(projected::text),'observedAt',clock_timestamp());
end;
$function$;

CREATE FUNCTION public.lock_booking_refund_source (
  target_booking_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare request public.booking_requests;
declare confirmation public.booking_confirmations;
declare snapshot public.booking_snapshots;
declare capture public.payment_provider_operations;
begin
  select * into request from public.booking_requests where id=target_booking_request_id for update;
  perform 1 from public.booking_request_capture_work where booking_request_id=request.id for update;
  select * into confirmation from public.booking_confirmations where booking_request_id=request.id;
  select * into snapshot from public.booking_snapshots where id=request.booking_snapshot_id;
  select * into capture from public.payment_provider_operations where id=confirmation.capture_operation_id for update;
  if request.id is null or confirmation.id is null or snapshot.id is null or capture.id is null
    or capture.operation_kind is distinct from 'capture' or capture.current_outcome is distinct from 'succeeded'
    or capture.recorded_at is null or capture.movement_reference is null or capture.authoritative_outcome_at is null
    or (confirmation.booking_snapshot_id,confirmation.booking_period_commitment_id) is distinct from (snapshot.id,request.booking_period_commitment_id)
    or capture.amount_fils is distinct from ((snapshot.quote_payload->>'bookingPriceIqd')::bigint+(snapshot.quote_payload->>'serviceFeeIqd')::bigint)*1000
    or exists(select 1 from public.booking_request_confirmation_invalidations where booking_request_id=request.id)
    or public.booking_request_payment_quarantined(request.id) then
    raise exception 'Refund capture source is invalid' using errcode='RC409'; end if;
  return jsonb_build_object('bookingRequestId',request.id,'captureOperationId',capture.id,
    'captured',jsonb_build_object('bookingPriceFils',(snapshot.quote_payload->>'bookingPriceIqd')::bigint*1000,'bookingServiceFeeFils',(snapshot.quote_payload->>'serviceFeeIqd')::bigint*1000));
end;
$function$;

REVOKE ALL ON FUNCTION public.lock_booking_refund_source(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.lock_payment_observation_source (
  target_operation_id uuid,
  target_purposes     text[]
)
  RETURNS public.payment_provider_operations
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare ledger public.payment_provider_operations;
declare submission public.booking_request_submission_attempts;
declare request_id uuid;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Payment recording unavailable' using errcode='42501'; end if;
  select * into ledger from public.payment_provider_operations operations where operations.id=target_operation_id;
  if not found or ledger.admission->>'purpose'=any(target_purposes) is not true then
    raise exception 'Payment recording purpose is invalid' using errcode='RC409'; end if;
  select attempts.* into submission from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims on claims.attempt_id=attempts.id where claims.id=ledger.claim_id;
  request_id:=submission.booking_request_id;
  if ledger.admission->>'purpose' in ('booking-request-capture','booking-request-payment-recovery','booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund','booking-refund') then
    perform 1 from public.booking_requests requests where requests.id=request_id for update of requests;
    perform 1 from public.booking_request_capture_work work where work.booking_request_id=request_id for update of work;
  elsif ledger.admission->>'purpose'='booking-request-release' then
    perform 1 from public.booking_request_release_work work where work.id=(ledger.admission#>>'{permit,workId}')::uuid for update of work;
  end if;
  perform 1 from public.booking_request_submission_attempts attempts where attempts.id=submission.id for update of attempts;
  perform 1 from public.booking_request_authorization_claims claims where claims.id=ledger.claim_id for update of claims;
  if ledger.recovery_attempt_id is not null then
    perform 1 from public.booking_request_payment_recovery_attempts attempts where attempts.id=ledger.recovery_attempt_id for update of attempts;
  end if;
  if ledger.admission->>'purpose'='booking-request-release' then
    perform 1 from public.booking_request_release_operations operations where operations.id=(ledger.admission#>>'{permit,operationId}')::uuid for update of operations;
  elsif ledger.admission->>'purpose' in ('booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund') then
    perform 1 from public.booking_request_payment_required_expiry_work work where work.booking_request_id=request_id for update of work;
    perform 1 from public.booking_request_payment_required_expiry_operations operations where operations.id=(ledger.admission#>>'{permit,expiryOperationId}')::uuid for update of operations;
  end if;
  select * into ledger from public.payment_provider_operations operations where operations.id=target_operation_id for update of operations;
  return ledger;
end;
$function$;

CREATE OR REPLACE FUNCTION public.observe_booking_request_payment_correction (
  target_booking_request_id    uuid,
  target_provider_operation_id uuid,
  target_receipt               jsonb,
  target_command               jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare work public.booking_request_capture_work;
declare ledger public.payment_provider_operations;
declare expected jsonb;
declare conflicting boolean;
declare observed_at timestamptz;
declare provider_result jsonb;
declare facts jsonb;
declare recorded jsonb;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Payment observation unavailable' using errcode='42501'; end if;
  select * into work from public.booking_request_capture_work capture where capture.booking_request_id=target_booking_request_id;
  select * into ledger from public.payment_provider_operations operations where operations.id=target_provider_operation_id;
  if ledger.claim_id is distinct from work.authorization_claim_id then raise exception 'Payment observation source is invalid' using errcode='RC409'; end if;
  ledger:=public.lock_payment_observation_source(target_provider_operation_id,
    array['booking-request-capture','booking-request-payment-recovery','booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund','booking-refund']);
  select * into work from public.booking_request_capture_work capture where capture.booking_request_id=target_booking_request_id for update of capture;
  facts:=public.get_booking_request_payment_observation_facts(ledger.id);
  if facts->>'revision' is distinct from target_command->>'revision' then return jsonb_build_object('status','stale'); end if;
  if (work.payment_required_deadline is null and ledger.admission->>'purpose'<>'booking-refund') or ledger.id is null or ledger.operation_kind not in ('capture','release','refund')
    or ledger.claim_id is distinct from work.authorization_claim_id then raise exception 'Payment observation source is invalid' using errcode='RC409'; end if;
  if target_receipt is null or jsonb_typeof(target_receipt)<>'object'
    or target_receipt ?& array['receiptId','bookingRequestId','providerOperationId','providerIdentity','paymentLifecycleId','logicalOperationId','physicalAttemptId','kind','amountFils','currency','providerRequestId','providerReference','movementReference','outcome','occurredAt'] is not true
    or target_receipt-array['receiptId','bookingRequestId','providerOperationId','providerIdentity','paymentLifecycleId','logicalOperationId','physicalAttemptId','kind','amountFils','currency','providerRequestId','providerReference','movementReference','outcome','occurredAt','evidence']<>'{}'
    or jsonb_typeof(target_receipt->'receiptId')<>'string' or length(target_receipt->>'receiptId') not between 1 and 200 then
    perform public.append_booking_request_payment_history(
      work.payment_lifecycle_id, work.booking_request_id,
      'receipt-observation', 'provider-receipt', 'observed',
      target_operation_kind => ledger.operation_kind,
      target_logical_operation_id => ledger.logical_operation_id,
      target_physical_attempt_id => ledger.physical_attempt_id,
      target_outcome => 'malformed',
      target_reason_code => 'malformed-provider-observation',
      target_provider_operation_id => ledger.id,
      target_provider_request_id => ledger.provider_request_id,
      target_provider_reference => ledger.provider_reference,
      target_movement_reference => ledger.movement_reference,
      target_amount_fils => ledger.amount_fils,
      target_received_at => clock_timestamp()
    );
    if target_command->>'quarantineReason' is distinct from 'malformed-provider-observation' then raise exception 'Selected receipt consequence is invalid' using errcode='RC409'; end if;
    return public.quarantine_booking_request_payment(target_booking_request_id,target_command->>'quarantineReason'); end if;
  if exists(select 1 from public.booking_request_payment_correction_observations observations
    where observations.provider_operation_id=ledger.id and observations.receipt_identity=target_receipt->>'receiptId' and observations.payload=target_receipt) then
    perform public.append_booking_request_payment_history(
      work.payment_lifecycle_id, work.booking_request_id,
      'receipt-observation', 'provider-receipt', 'observed',
      target_operation_kind => ledger.operation_kind,
      target_logical_operation_id => ledger.logical_operation_id,
      target_physical_attempt_id => ledger.physical_attempt_id,
      target_outcome => 'duplicate',
      target_provider_operation_id => ledger.id,
      target_provider_request_id => ledger.provider_request_id,
      target_provider_reference => ledger.provider_reference,
      target_movement_reference => ledger.movement_reference,
      target_amount_fils => ledger.amount_fils,
      target_received_at => clock_timestamp()
    );
    return jsonb_build_object('status','duplicate'); end if;
  expected := jsonb_build_object('bookingRequestId',target_booking_request_id,'providerOperationId',ledger.id,
    'providerIdentity',jsonb_build_object('provider',ledger.provider,'environment',ledger.environment,'merchantId',ledger.merchant_id,'terminalId',ledger.terminal_id),
    'paymentLifecycleId',ledger.payment_lifecycle_id,'logicalOperationId',ledger.logical_operation_id,'physicalAttemptId',ledger.physical_attempt_id,
    'kind',ledger.operation_kind,'amountFils',ledger.amount_fils,'currency',ledger.currency,'providerRequestId',coalesce(ledger.provider_request_id,target_receipt->>'providerRequestId'),'providerReference',coalesce(ledger.provider_reference,target_receipt->>'providerReference'));
  conflicting := (ledger.claim_generation,ledger.amount_fils,ledger.currency,ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id)
      is distinct from (work.authorization_claim_generation,case when ledger.admission->>'purpose'='booking-refund' then ledger.amount_fils else work.amount_fils end,work.currency,work.provider,work.environment,work.merchant_id,work.terminal_id)
    or target_receipt-array['receiptId','movementReference','outcome','occurredAt','evidence'] is distinct from expected
    or target_receipt->>'outcome' not in ('succeeded','failed','indeterminate')
    or (ledger.current_outcome is null and not (target_receipt ? 'evidence'))
    or jsonb_typeof(target_receipt->'outcome') is distinct from 'string'
    or (ledger.current_outcome is not null and ledger.current_outcome<>'indeterminate' and target_receipt->>'outcome' is distinct from ledger.current_outcome)
    or (ledger.current_outcome is not null and target_receipt->>'outcome'<>'failed' and target_receipt->>'movementReference' is distinct from ledger.movement_reference)
    or (target_receipt->>'outcome'='failed' and target_receipt->'movementReference' is distinct from 'null'::jsonb)
    or exists(select 1 from public.booking_request_payment_correction_observations observations where observations.provider_operation_id=ledger.id
      and (observations.receipt_identity=target_receipt->>'receiptId' or observations.payload-'receiptId' is distinct from target_receipt-'receiptId'));
  begin
    observed_at := (target_receipt->>'occurredAt')::timestamptz;
    if (target_receipt->>'outcome'='indeterminate') is distinct from (observed_at is null)
      or not isfinite(observed_at) or observed_at > clock_timestamp() or (ledger.evidence_provenance<>'legacy-simulated' and observed_at < ledger.executed_at)
      or (ledger.authoritative_outcome_at is not null and ledger.authoritative_outcome_at is distinct from observed_at)
      then conflicting := true; end if;
  exception when invalid_datetime_format or datetime_field_overflow then conflicting:=true; end;
  if conflicting is false then
    begin
      provider_result:=jsonb_build_object('outcome',target_receipt->>'outcome','providerRequestId',target_receipt->>'providerRequestId','providerReference',target_receipt->>'providerReference',
          'evidence',coalesce(target_receipt->'evidence',jsonb_build_object('operationId',ledger.id,'eventId',target_receipt->>'receiptId',
            'provenance',ledger.evidence_provenance,'originalOutcome',ledger.original_outcome,'executedAt',ledger.executed_at,
            'occurredAt',observed_at,'closedAt',null)))
        ||case when target_receipt->>'outcome'='failed' then jsonb_build_object('retrySafe',false)
          else jsonb_build_object('movementReference',target_receipt->>'movementReference') end;
      perform public.validate_payment_provider_observation(provider_result,ledger.id);
      if (provider_result#>>'{evidence,occurredAt}')::timestamptz is distinct from observed_at then
        raise exception 'Correction occurrence conflicts with provider evidence' using errcode='RC409'; end if;
      recorded:=public.record_booking_request_payment_observation(ledger.id,provider_result,target_command);
      if recorded->>'status'='stale' then return recorded; end if;
      select * into ledger from public.payment_provider_operations operations where operations.id=ledger.id;
    exception when sqlstate 'RC409' then conflicting:=true;
    end;
  end if;
  insert into public.booking_request_payment_correction_observations(booking_request_id,provider_operation_id,receipt_identity,payload,conflict)
    values(target_booking_request_id,ledger.id,target_receipt->>'receiptId',target_receipt,coalesce(conflicting,true));
  if conflicting is not false then
    if target_command->>'quarantineReason' is distinct from 'conflicting-provider-observation' then raise exception 'Selected receipt consequence is invalid' using errcode='RC409'; end if;
    return public.quarantine_booking_request_payment(target_booking_request_id,target_command->>'quarantineReason'); end if;
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  return jsonb_build_object('status','recorded');
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_booking_request_corrective_refund (
  target_booking_request_id uuid,
  target_capture_id         uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare source record;
declare expiry public.booking_request_payment_required_expiry_work;
declare capture public.payment_provider_operations;
declare authorization_ledger public.payment_provider_operations;
declare recovery public.booking_request_payment_recovery_attempts;
declare logical_id text;
declare authorization_logical text;
declare authorization_physical text;
declare predecessor text;
declare predecessor_at timestamptz;
begin
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  select * into expiry from public.booking_request_payment_required_expiry_work work where work.booking_request_id=target_booking_request_id for update of work;
  select * into capture from public.payment_provider_operations ledger where ledger.id=target_capture_id for update of ledger;
  if expiry.id is null or expiry.state in ('complete','quarantined')
    or (capture.claim_id,capture.claim_generation,capture.provider,capture.environment,capture.merchant_id,capture.terminal_id,capture.amount_fils,capture.currency)
      is distinct from ((source.work).authorization_claim_id,(source.work).authorization_claim_generation,(source.work).provider,(source.work).environment,(source.work).merchant_id,(source.work).terminal_id,(source.work).amount_fils,(source.work).currency)
    or capture.operation_kind is distinct from 'capture' or capture.current_outcome is distinct from 'succeeded'
    or capture.authoritative_outcome_at is null or capture.authoritative_outcome_at < (source.work).payment_required_deadline
    or capture.original_outcome='failed' or capture.amount_fils<>(source.work).amount_fils
    or capture.currency<>(source.work).currency or capture.claim_id<>(source.work).authorization_claim_id
    or capture.recorded_at is null or capture.movement_reference is null then
    raise exception 'Corrective capture evidence is invalid' using errcode='RC409'; end if;
  if capture.payment_lifecycle_id=(source.work).payment_lifecycle_id then
    authorization_logical := (source.work).authorization_logical_operation_id;
    authorization_physical := (source.work).authorization_physical_attempt_id;
    predecessor := source.payment_snapshot#>>'{authorization,movementReference}';
    predecessor_at := (source.payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz;
  else
    select * into recovery from public.booking_request_payment_recovery_attempts attempts where attempts.id=capture.recovery_attempt_id and attempts.booking_request_id=target_booking_request_id;
    select ledger.* into authorization_ledger from public.booking_request_payment_recovery_operations operations
      join public.payment_provider_operations ledger on ledger.id=operations.provider_operation_id
      where operations.recovery_attempt_id=recovery.id and operations.step='replacement-authorization';
    if authorization_ledger.current_outcome is distinct from 'succeeded' or authorization_ledger.authoritative_outcome_at is null then
      raise exception 'Corrective authorization evidence is invalid' using errcode='RC409'; end if;
    authorization_logical:=authorization_ledger.logical_operation_id; authorization_physical:=authorization_ledger.physical_attempt_id;
    predecessor:=authorization_ledger.movement_reference; predecessor_at:=authorization_ledger.authoritative_outcome_at;
  end if;
  if exists(select 1 from public.booking_refund_intents intents where intents.capture_operation_id=capture.id and public.booking_refund_intent_state(intents.id)<>'failed') then
    raise exception 'Capture refund capacity is already reserved' using errcode='RC409'; end if;
  logical_id:=expiry.id::text||':corrective-refund:'||capture.id::text;
  insert into public.booking_request_payment_required_expiry_operations(
    expiry_work_id,booking_request_id,owner,authorization_claim_id,authorization_claim_generation,authorization_payment_lifecycle_id,
    authorization_logical_operation_id,authorization_physical_attempt_id,predecessor_movement_reference,predecessor_outcome_at,
    release_logical_operation_id,release_physical_attempt_id,provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
    request_fingerprint,operation_kind,capture_provider_operation_id,capture_occurred_at)
  values(expiry.id,target_booking_request_id,'expiry',(source.work).authorization_claim_id,(source.work).authorization_claim_generation,
    capture.payment_lifecycle_id,authorization_logical,authorization_physical,predecessor,predecessor_at,
    logical_id,logical_id||':1',logical_id||':1',(source.work).amount_fils,(source.work).currency,(source.work).provider,(source.work).environment,
    (source.work).merchant_id,(source.work).terminal_id,(source.work).request_fingerprint,'refund',capture.id,capture.authoritative_outcome_at)
    on conflict do nothing;
  if not exists(select 1 from public.booking_request_payment_required_expiry_operations operations
    where operations.expiry_work_id=expiry.id and operations.capture_provider_operation_id=capture.id and operations.operation_kind='refund') then
    raise exception 'Captured authorization has conflicting release ownership' using errcode='RC409'; end if;
  perform public.invalidate_booking_request_payment_confirmation(target_booking_request_id,capture.id,'late-capture');
end;
$function$;

CREATE FUNCTION public.record_booking_refund_notification (
  target_intent_id  uuid,
  target_event_kind text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare intent public.booking_refund_intents;
begin
  select * into intent from public.booking_refund_intents where id=target_intent_id;
  if intent.id is null or target_event_kind not in ('refund_requested','refund_returned','refund_attention') then raise exception 'Refund notification fact is invalid' using errcode='RC409'; end if;
  insert into public.booking_notification_events(booking_request_id,refund_intent_id,receipt_id,event_kind,recipient_user_id,recipient_role,notice_locale,created_at)
    select intent.booking_request_id,intent.id,receipts.id,target_event_kind,receipts.recipient_user_id,receipts.recipient_role,snapshots.acceptance_locale,clock_timestamp()
      from public.booking_receipts receipts join public.booking_snapshots snapshots on snapshots.id=receipts.booking_snapshot_id join public.booking_confirmations confirmations on confirmations.id=receipts.booking_confirmation_id
      where confirmations.booking_request_id=intent.booking_request_id on conflict(refund_intent_id,event_kind,recipient_role) do nothing;
  if (select count(*) from public.booking_notification_events where refund_intent_id=intent.id and event_kind=target_event_kind)<>2 then
    raise exception 'Refund recipient facts are incomplete' using errcode='RC409'; end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.record_booking_refund_notification(uuid, text) FROM PUBLIC;

CREATE FUNCTION public.record_booking_refund_observation (
  target_operation_id uuid,
  target_result       jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare ledger public.payment_provider_operations; declare attempt public.booking_refund_attempts; declare intent public.booking_refund_intents;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-refund']);
  select * into attempt from public.booking_refund_attempts where id=(ledger.admission#>>'{permit,attemptId}')::uuid;
  select * into intent from public.booking_refund_intents where id=attempt.refund_intent_id;
  perform public.lock_booking_refund_source(intent.booking_request_id);
  if intent.id is null or ledger.admission->'permit' is distinct from public.booking_refund_execution_permit(attempt)
    or ledger.amount_fils<>intent.booking_price_fils+intent.booking_service_fee_fils then raise exception 'Refund observation binding is invalid' using errcode='RC409'; end if;
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  if ledger.current_outcome='succeeded' then perform public.record_booking_refund_notification(intent.id,'refund_returned');
  elsif ledger.current_outcome in ('failed','indeterminate') then perform public.record_booking_refund_notification(intent.id,'refund_attention'); end if;
  return public.payment_provider_recorded_result(ledger);
end;
$function$;

REVOKE ALL ON FUNCTION public.record_booking_refund_observation(uuid, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_booking_refund_observation(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.record_booking_request_payment_observation (
  target_operation_id uuid,
  target_result       jsonb,
  target_command      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare ledger public.payment_provider_operations;
declare attempt public.booking_request_payment_recovery_attempts;
declare work public.booking_request_capture_work;
declare target public.booking_request_payment_required_expiry_operations;
declare facts jsonb;
declare recovery_step text;
declare next_state text:=target_command->>'recoveryState';
declare quarantine_reason text:=target_command->>'quarantineReason';
declare corrective_capture uuid:=(target_command->>'correctiveCaptureId')::uuid;
declare transition_required boolean;
declare quarantine_required boolean;
declare late_capture boolean;
declare result jsonb;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-request-capture','booking-request-payment-recovery','booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund','booking-refund']);
  facts:=public.get_booking_request_payment_observation_facts(ledger.id);
  if facts->>'revision' is distinct from target_command->>'revision' then return jsonb_build_object('status','stale'); end if;
  select * into work from public.booking_request_capture_work capture where capture.booking_request_id=(facts->>'bookingRequestId')::uuid;
  select * into attempt from public.booking_request_payment_recovery_attempts attempts where attempts.id=ledger.recovery_attempt_id;
  recovery_step:=ledger.admission#>>'{permit,step}';
  if ledger.admission->>'purpose' in ('booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund') then
    select * into target from public.booking_request_payment_required_expiry_operations owned where owned.id=(ledger.admission#>>'{permit,expiryOperationId}')::uuid for update of owned;
    if target.id is null or target.owner<>'expiry' or target.booking_request_id<>work.booking_request_id or (target.provider_operation_id is not null and target.provider_operation_id<>ledger.id)
      or ledger.admission->'permit' is distinct from public.booking_request_payment_required_expiry_permit(target,work.payment_required_deadline) then
      raise exception 'Expiry observation targets another operation' using errcode='RC409'; end if;
  end if;
  if ledger.admission->>'purpose'='booking-refund' then
    if target_command-array['revision'] is distinct from '{"recoveryState":null,"quarantineReason":null,"correctiveCaptureId":null}'::jsonb then raise exception 'Refund observation consequence is invalid' using errcode='RC409'; end if;
    return public.record_booking_refund_observation(ledger.id,target_result);
  end if;
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  transition_required:=recovery_step is not null and ledger.current_outcome<>'not-executed' and not (facts->>'quarantined')::boolean
    and (attempt.state='blocked' or (recovery_step='original-release' and attempt.state='admitted')
      or (recovery_step='replacement-authorization' and attempt.state='original_released')
      or (recovery_step='replacement-capture' and attempt.state='replacement_authorized')
      or (recovery_step='replacement-release' and attempt.state='capture_failed'));
  if transition_required then
    if next_state is null or not (
      (next_state='blocked' and (ledger.current_outcome='indeterminate' or (recovery_step in ('original-release','replacement-release') and ledger.current_outcome='failed')))
      or (next_state='original_released' and recovery_step='original-release' and ledger.current_outcome='succeeded')
      or (next_state='replacement_authorized' and recovery_step='replacement-authorization' and ledger.current_outcome='succeeded')
      or (next_state='safely_failed' and ((recovery_step='replacement-authorization' and ledger.current_outcome='failed') or (recovery_step='replacement-release' and ledger.current_outcome='succeeded')))
      or (next_state='capture_failed' and recovery_step='replacement-capture' and ledger.current_outcome='failed')
      or (next_state='succeeded' and recovery_step='replacement-capture' and ledger.current_outcome='succeeded' and ledger.authoritative_outcome_at<work.payment_required_deadline)
      or (next_state='late_succeeded' and recovery_step='replacement-capture' and ledger.current_outcome='succeeded' and (ledger.authoritative_outcome_at>=work.payment_required_deadline or ledger.authoritative_outcome_at is null))
    ) then raise exception 'Selected recovery consequence is invalid' using errcode='RC409'; end if;
  elsif next_state is not null then raise exception 'Selected recovery consequence is stale' using errcode='RC409'; end if;
  quarantine_required:=(recovery_step is not null and (ledger.current_outcome='indeterminate' or (recovery_step in ('original-release','replacement-release') and ledger.current_outcome='failed')))
    or (target.id is not null and ledger.current_outcome<>'succeeded')
    or (ledger.operation_kind='capture' and ledger.current_outcome='succeeded' and ledger.authoritative_outcome_at is null);
  late_capture:=ledger.operation_kind='capture' and ledger.current_outcome='succeeded' and ledger.authoritative_outcome_at>=work.payment_required_deadline;
  if quarantine_required and quarantine_reason is null then raise exception 'Payment observation requires quarantine' using errcode='RC409'; end if;
  if quarantine_reason is not null and not quarantine_required and not late_capture then raise exception 'Selected quarantine consequence is invalid' using errcode='RC409'; end if;
  if corrective_capture is not null and (not late_capture or corrective_capture<>ledger.id or ledger.original_outcome='failed') then raise exception 'Selected corrective capture is invalid' using errcode='RC409'; end if;
  if late_capture and not (facts->>'quarantined')::boolean and quarantine_reason is null and corrective_capture is distinct from ledger.id then
    raise exception 'Late capture requires atomic correction ownership' using errcode='RC409'; end if;
  if recovery_step is not null and ledger.current_outcome<>'not-executed' then
    insert into public.booking_request_payment_recovery_operations(recovery_attempt_id,step,provider_operation_id,outcome,authoritative_outcome_at,execution_permit)
      values(attempt.id,recovery_step,ledger.id,ledger.current_outcome,ledger.authoritative_outcome_at,ledger.admission->'permit')
      on conflict(recovery_attempt_id,step,operation_generation) do update set outcome=excluded.outcome,authoritative_outcome_at=excluded.authoritative_outcome_at,updated_at=clock_timestamp()
        where booking_request_payment_recovery_operations.provider_operation_id=excluded.provider_operation_id
          and (booking_request_payment_recovery_operations.outcome,booking_request_payment_recovery_operations.authoritative_outcome_at) is distinct from (excluded.outcome,excluded.authoritative_outcome_at);
    if not exists(select 1 from public.booking_request_payment_recovery_operations owned where owned.recovery_attempt_id=attempt.id and owned.step=recovery_step and owned.operation_generation=1 and owned.provider_operation_id=ledger.id) then
      raise exception 'Recovery observation targets another operation' using errcode='RC409'; end if;
  end if;
  if transition_required then update public.booking_request_payment_recovery_attempts set state=next_state,updated_at=clock_timestamp() where id=attempt.id; end if;
  if target.id is not null then update public.booking_request_payment_required_expiry_operations set provider_operation_id=ledger.id where id=target.id; end if;
  if quarantine_reason is not null then perform public.quarantine_booking_request_payment(work.booking_request_id,quarantine_reason); end if;
  if corrective_capture is not null and quarantine_reason is null and not (facts->>'quarantined')::boolean then
    insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline) values(work.booking_request_id,work.payment_required_deadline) on conflict do nothing;
    perform public.prepare_booking_request_corrective_refund(work.booking_request_id,corrective_capture);
  end if;
  if late_capture then perform public.invalidate_booking_request_payment_confirmation(work.booking_request_id,ledger.id,'late-capture'); end if;
  result:=public.payment_provider_recorded_result(ledger);
  if ledger.current_outcome='failed' and recovery_step is not null then result:=result||jsonb_build_object('retrySafe',exists(select 1 from public.booking_request_payment_recovery_attempts attempts where attempts.id=attempt.id and attempts.state='safely_failed')); end if;
  return result;
end;
$function$;

CREATE FUNCTION public.request_automatic_booking_refund (
  target_booking_request_id uuid,
  target_revision           text,
  target_allocation         jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare facts jsonb; declare expected jsonb; declare intent public.booking_refund_intents;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Automatic refund unavailable' using errcode='42501'; end if;
  facts:=public.get_booking_refund_facts(target_booking_request_id);
  if facts->>'revision' is distinct from target_revision then return jsonb_build_object('status','stale'); end if;
  expected:=jsonb_build_object('bookingPriceFils',greatest(0,(facts#>>'{obligation,bookingPriceFils}')::bigint-(facts#>>'{refunded,bookingPriceFils}')::bigint),
    'bookingServiceFeeFils',greatest(0,(facts#>>'{obligation,bookingServiceFeeFils}')::bigint-(facts#>>'{refunded,bookingServiceFeeFils}')::bigint));
  if target_allocation is distinct from expected or (expected->>'bookingPriceFils')::bigint+(expected->>'bookingServiceFeeFils')::bigint=0
    or facts->'reserved'<>'{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb
    or exists(select 1 from public.booking_refund_intents where booking_request_id=target_booking_request_id and source='cancellation' and public.booking_refund_intent_state(id)='failed') then
    raise exception 'Automatic refund selection is invalid' using errcode='RC409'; end if;
  insert into public.booking_refund_intents(booking_request_id,capture_operation_id,cancellation_id,command_id,command_fingerprint,source,booking_price_fils,booking_service_fee_fils)
    select target_booking_request_id,(facts->>'captureOperationId')::uuid,id,gen_random_uuid(),encode(extensions.digest(convert_to(facts::text,'UTF8'),'sha256'),'hex'),'cancellation',
      (expected->>'bookingPriceFils')::bigint,(expected->>'bookingServiceFeeFils')::bigint from public.booking_cancellations where booking_request_id=target_booking_request_id returning * into intent;
  if intent.id is null then raise exception 'Cancellation obligation is missing' using errcode='RC409'; end if;
  perform public.record_booking_refund_notification(intent.id,'refund_requested');
  return jsonb_build_object('status','requested');
end;
$function$;

REVOKE ALL ON FUNCTION public.request_automatic_booking_refund(uuid, text, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.request_automatic_booking_refund(uuid, text, jsonb) TO service_role;

CREATE FUNCTION public.request_booking_refund_exception (
  target_booking_request_id uuid,
  target_command_id         uuid,
  target_reason             text,
  target_allocation         jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare facts jsonb; declare fingerprint text; declare intent public.booking_refund_intents;
declare price bigint; declare fee bigint;
begin
  if not public.is_platform_administrator('aal2') then raise exception 'Refund exception unavailable' using errcode='42501'; end if;
  facts:=public.get_booking_refund_facts(target_booking_request_id);
  if target_command_id is null or target_reason is null or length(btrim(target_reason)) not between 1 and 2000
    or jsonb_typeof(target_allocation) is distinct from 'object' or target_allocation-array['bookingPriceFils','bookingServiceFeeFils']<>'{}'
    or jsonb_typeof(target_allocation->'bookingPriceFils') is distinct from 'number' or jsonb_typeof(target_allocation->'bookingServiceFeeFils') is distinct from 'number'
    or (target_allocation->>'bookingPriceFils')::numeric<>trunc((target_allocation->>'bookingPriceFils')::numeric)
    or (target_allocation->>'bookingServiceFeeFils')::numeric<>trunc((target_allocation->>'bookingServiceFeeFils')::numeric) then
    raise exception 'Refund exception attribution or allocation is invalid' using errcode='22023'; end if;
  price:=(target_allocation->>'bookingPriceFils')::bigint; fee:=(target_allocation->>'bookingServiceFeeFils')::bigint;
  if price<0 or fee<0 or price%10<>0 or price+fee<=0 then raise exception 'Refund allocation is invalid' using errcode='22023'; end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('bookingRequestId',target_booking_request_id,'actorUserId',(select auth.uid()),'reason',target_reason,'allocation',target_allocation)::text,'UTF8'),'sha256'),'hex');
  select * into intent from public.booking_refund_intents where command_id=target_command_id;
  if found then
    if intent.command_fingerprint is distinct from fingerprint then raise exception 'Refund command identity was reused' using errcode='RC409'; end if;
    return jsonb_build_object('status','requested','intentId',intent.id);
  end if;
  if price>(facts#>>'{captured,bookingPriceFils}')::bigint-(facts#>>'{refunded,bookingPriceFils}')::bigint-(facts#>>'{reserved,bookingPriceFils}')::bigint
    or fee>(facts#>>'{captured,bookingServiceFeeFils}')::bigint-(facts#>>'{refunded,bookingServiceFeeFils}')::bigint-(facts#>>'{reserved,bookingServiceFeeFils}')::bigint then
    raise exception 'Refund allocation exceeds available capacity' using errcode='RC409'; end if;
  insert into public.booking_refund_intents(booking_request_id,capture_operation_id,command_id,command_fingerprint,source,actor_user_id,reason,booking_price_fils,booking_service_fee_fils)
    values(target_booking_request_id,(facts->>'captureOperationId')::uuid,target_command_id,fingerprint,'administrator',(select auth.uid()),target_reason,price,fee) returning * into intent;
  perform public.record_booking_refund_notification(intent.id,'refund_requested');
  return jsonb_build_object('status','requested','intentId',intent.id);
end;
$function$;

REVOKE ALL ON FUNCTION public.request_booking_refund_exception(uuid, uuid, text, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.request_booking_refund_exception(uuid, uuid, text, jsonb) TO authenticated;

ALTER TABLE public.booking_notification_events
  ALTER COLUMN cancellation_id DROP NOT NULL;

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_event_kind_check
    CHECK (event_kind = ANY (ARRAY['cancelled'::text, 'refund_requested'::text, 'refund_returned'::text, 'refund_attention'::text]));

ALTER TABLE public.booking_notification_events
  ADD COLUMN refund_intent_id uuid;

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_check CHECK (event_kind = 'cancelled'::text AND cancellation_id IS
    NOT NULL AND refund_intent_id IS NULL OR event_kind <> 'cancelled'::text AND cancellation_id IS NULL AND refund_intent_id IS NOT NULL);

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_refund_intent_id_event_kind_rec_key UNIQUE (refund_intent_id, event_kind, recipient_role);

CREATE TABLE public.booking_refund_attempts (
  id               uuid                     DEFAULT gen_random_uuid() NOT NULL,
  refund_intent_id uuid                     NOT NULL,
  generation       integer                  NOT NULL,
  lease_token      uuid                     DEFAULT gen_random_uuid() NOT NULL,
  created_at       timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  not_after        timestamp with time zone NOT NULL
);

CREATE FUNCTION public.booking_refund_execution_permit (
  target public.booking_refund_attempts
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select jsonb_build_object('purpose','booking-refund','attemptId',target.id,'generation',target.generation,'leaseToken',target.lease_token,
    'idempotencyKey',intent.id::text||':refund:'||target.generation::text,'notBefore',target.created_at,'notAfter',target.not_after,
    'binding',jsonb_build_object('bookingRequestId',intent.booking_request_id,'refundIntentId',intent.id,'captureOperationId',capture.id,
      'kind','refund','paymentLifecycleId',capture.payment_lifecycle_id,'logicalOperationId',intent.id::text||':refund',
      'attemptId',intent.id::text||':refund:'||target.generation::text,'amountFils',intent.booking_price_fils+intent.booking_service_fee_fils,'currency',capture.currency,
      'requestFingerprint',intent.command_fingerprint,'providerIdentity',jsonb_build_object('provider',capture.provider,'environment',capture.environment,'merchantId',capture.merchant_id,'terminalId',capture.terminal_id)))
    from public.booking_refund_intents intent join public.payment_provider_operations capture on capture.id=intent.capture_operation_id where intent.id=target.refund_intent_id;
$function$;

REVOKE ALL ON FUNCTION public.booking_refund_execution_permit(public.booking_refund_attempts) FROM PUBLIC;

ALTER TABLE public.booking_refund_attempts
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_refund_attempts
  ADD CONSTRAINT booking_refund_attempts_check CHECK (not_after > created_at);

ALTER TABLE public.booking_refund_attempts
  ADD CONSTRAINT booking_refund_attempts_generation_check CHECK (generation > 0);

ALTER TABLE public.booking_refund_attempts
  ADD CONSTRAINT booking_refund_attempts_pkey PRIMARY KEY (id);

ALTER TABLE public.booking_refund_attempts
  ADD CONSTRAINT booking_refund_attempts_refund_intent_id_generation_key UNIQUE (refund_intent_id, generation);

CREATE TRIGGER booking_refund_attempts_immutable
  BEFORE DELETE OR UPDATE ON public.booking_refund_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_booking_cancellation_fact_change();

CREATE TABLE public.booking_refund_intents (
  id                       uuid                     DEFAULT gen_random_uuid() NOT NULL,
  booking_request_id       uuid                     NOT NULL,
  capture_operation_id     uuid                     NOT NULL,
  cancellation_id          uuid,
  command_id               uuid                     NOT NULL,
  command_fingerprint      text                     NOT NULL,
  source                   text                     NOT NULL,
  actor_user_id            uuid,
  reason                   text,
  booking_price_fils       bigint                   NOT NULL,
  booking_service_fee_fils bigint                   NOT NULL,
  created_at               timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.booking_refund_intents
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_actor_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id);

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_booking_price_fils_check CHECK (booking_price_fils >= 0 AND (booking_price_fils % 10::bigint) = 0);

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_booking_service_fee_fils_check CHECK (booking_service_fee_fils >= 0);

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_cancellation_fkey FOREIGN KEY (cancellation_id) REFERENCES public.booking_cancellations(id);

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_capture_fkey FOREIGN KEY (capture_operation_id) REFERENCES public.payment_provider_operations(id);

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_check CHECK ((booking_price_fils + booking_service_fee_fils) > 0);

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_check1 CHECK (source = 'cancellation'::text AND cancellation_id IS
    NOT NULL AND actor_user_id IS NULL AND reason IS NULL OR source = 'administrator'::text AND actor_user_id IS NOT NULL AND reason IS
    NOT NULL AND length(btrim(reason)) >= 1 AND length(btrim(reason)) <= 2000);

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_command_fingerprint_check CHECK (length(command_fingerprint) = 64);

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_command_id_key UNIQUE (command_id);

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_pkey PRIMARY KEY (id);

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_refund_fkey FOREIGN KEY (refund_intent_id) REFERENCES public.booking_refund_intents(id);

ALTER TABLE public.booking_refund_attempts
  ADD CONSTRAINT booking_refund_attempts_intent_fkey FOREIGN KEY (refund_intent_id) REFERENCES public.booking_refund_intents(id);

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_request_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id);

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_source_check CHECK (source = ANY (ARRAY['cancellation'::text, 'administrator'::text]));

CREATE TRIGGER booking_refund_intents_immutable
  BEFORE DELETE OR UPDATE ON public.booking_refund_intents
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_booking_cancellation_fact_change();

REVOKE ALL ON TABLE public.booking_refund_intents,public.booking_refund_attempts FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.lock_booking_refund_source(uuid),public.booking_refund_intent_state(uuid),public.booking_capture_refund_totals(uuid,jsonb),public.get_booking_refund_facts(uuid),public.record_booking_refund_notification(uuid,text),public.request_booking_refund_exception(uuid,uuid,text,jsonb),public.request_automatic_booking_refund(uuid,text,jsonb),public.booking_refund_execution_permit(public.booking_refund_attempts),public.claim_booking_refund(uuid),public.admit_booking_refund(jsonb),public.record_booking_refund_observation(uuid,jsonb),public.due_booking_refunds(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_refund_facts(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.request_booking_refund_exception(uuid,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_automatic_booking_refund(uuid,text,jsonb),public.claim_booking_refund(uuid),public.admit_booking_refund(jsonb),public.record_booking_refund_observation(uuid,jsonb),public.due_booking_refunds(integer) TO service_role;
