-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.lease_booking_request_payment_recovery_step(target_attempt_id uuid);

DROP FUNCTION public.observe_booking_request_payment_correction(target_booking_request_id uuid, target_provider_operation_id uuid, target_receipt jsonb);

DROP FUNCTION public.prepare_booking_request_payment_required_expiry(target_booking_request_id uuid, target_provider_identity jsonb);

DROP FUNCTION public.record_booking_request_payment_recovery_observation(target_operation_id uuid, target_result jsonb);

DROP FUNCTION public.record_booking_request_payment_required_expiry_observation(target_operation_id uuid, target_result jsonb);

DROP FUNCTION public.record_booking_request_recovery_outcome(target_attempt_id uuid, target_step text, target_ledger public.payment_provider_operations, target_deadline timestamp
  WITH time zone);

CREATE OR REPLACE FUNCTION public.admit_booking_request_payment_recovery (
  target_permit jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare source record;
declare expected jsonb;

declare ledger public.payment_provider_operations;
declare operation_id uuid:=gen_random_uuid();
declare recovery_step text:=target_permit->>'step';
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Recovery admission unavailable' using errcode='42501'; end if;
  select * into ledger from public.payment_provider_operations operations
    where operations.recovery_attempt_id=(target_permit->>'attemptId')::uuid and operations.logical_operation_id=target_permit->>'operationId';
  if found then
    ledger:=public.lock_payment_observation_source(ledger.id,array['booking-request-payment-recovery']);
    if ledger.admission->'permit' is distinct from target_permit then raise exception 'Recovery admission binding changed' using errcode='RC409'; end if;
    if public.booking_request_payment_quarantined((ledger.admission#>>'{permit,binding,bookingRequestId}')::uuid) then return jsonb_build_object('status','not-admitted'); end if;
    return public.payment_operation_admission(ledger);
  end if;
  select * into source from public.lock_booking_request_payment_recovery_source((target_permit->>'attemptId')::uuid);
  expected:=public.booking_request_recovery_execution_permit(source.attempt,source.work,source.payment_snapshot,recovery_step);
  if target_permit is distinct from expected then raise exception 'Recovery admission permit is invalid' using errcode='RC409'; end if;
  select * into ledger from public.payment_provider_operations operations
    where operations.recovery_attempt_id=(source.attempt).id and operations.logical_operation_id=expected->>'operationId' for update of operations;
  if found then
    if ledger.admission->'permit' is distinct from target_permit then raise exception 'Recovery admission binding changed' using errcode='RC409'; end if;
    return public.payment_operation_admission(ledger);
  end if;
  if public.booking_request_payment_quarantined((source.work).booking_request_id)
    or public.booking_request_payment_required_expiry_completed((source.work).booking_request_id)
    or exists(select 1 from public.booking_request_payment_required_expiry_operations operations
      where operations.booking_request_id=(source.work).booking_request_id and operations.owner='expiry'
        and operations.authorization_payment_lifecycle_id=(expected#>>'{binding,paymentLifecycleId}')::uuid
        and operations.predecessor_movement_reference=expected#>>'{binding,predecessorMovementReference}') then
    return jsonb_build_object('status','not-admitted'); end if;
  if not ((recovery_step='original-release' and (source.attempt).state='admitted')
    or (recovery_step='replacement-authorization' and (source.attempt).state='original_released')
    or (recovery_step='replacement-capture' and (source.attempt).state='replacement_authorized')
    or (recovery_step='replacement-release' and (source.attempt).state='capture_failed'))
    or exists(select 1 from public.payment_provider_operations operations where operations.recovery_attempt_id=(source.attempt).id and operations.current_outcome is null)
    or (recovery_step<>'replacement-release' and clock_timestamp()>=(source.work).payment_required_deadline) then
    return jsonb_build_object('status','not-admitted'); end if;
  insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,
    recovery_attempt_id,capture_execution_permit,admission,evidence_provenance)
  values(operation_id,(source.work).authorization_claim_id,(source.work).authorization_claim_generation,
    case recovery_step when 'replacement-authorization' then 'authorization' when 'replacement-capture' then 'capture' else 'release' end,
    (source.work).provider,(source.work).environment,(source.work).merchant_id,(source.work).terminal_id,
    expected->>'idempotencyKey',(source.work).request_fingerprint,(expected#>>'{binding,paymentLifecycleId}')::uuid,
    expected->>'operationId',expected#>>'{binding,physicalAttemptId}',(source.work).amount_fils,(source.work).currency,
    (source.attempt).id,case when recovery_step='replacement-capture' then expected end,
    jsonb_build_object('purpose','booking-request-payment-recovery','permit',expected,
      'notBefore',expected#>>'{binding,predecessorOutcomeAt}','notAfter',case when recovery_step<>'replacement-release' then expected->>'notAfter' end),'admitted')
    returning * into ledger;
  return public.payment_operation_admission(ledger,true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admit_booking_request_payment_required_expiry (
  target_permit jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare source record;
declare target public.booking_request_payment_required_expiry_operations;
declare expected jsonb;
declare ledger public.payment_provider_operations;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Expiry admission unavailable' using errcode='42501'; end if;
  select * into source from public.lock_booking_request_payment_required_expiry_source((target_permit#>>'{binding,bookingRequestId}')::uuid);
  select * into target from public.booking_request_payment_required_expiry_operations operations
    where operations.id=(target_permit->>'expiryOperationId')::uuid and operations.expiry_work_id=(source.expiry).id for update of operations;
  expected:=public.booking_request_payment_required_expiry_permit(target,(source.expiry).payment_required_deadline);
  if target.id is null or target.owner<>'expiry' or target_permit is distinct from expected then raise exception 'Expiry admission permit is invalid' using errcode='RC409'; end if;
  perform public.validate_booking_request_payment_required_expiry_target(target,source.work,source.payment_snapshot);
  if public.booking_request_payment_quarantined((source.work).booking_request_id) then return jsonb_build_object('status','not-admitted'); end if;
  select * into ledger from public.payment_provider_operations operations where
    (operations.provider,operations.environment,operations.merchant_id,operations.terminal_id,operations.provider_idempotency_key)=
    (target.provider,target.environment,target.merchant_id,target.terminal_id,target.provider_idempotency_key) for update of operations;
  if found then
    if ledger.admission->'permit' is distinct from target_permit then raise exception 'Expiry admission binding changed' using errcode='RC409'; end if;
    return public.payment_operation_admission(ledger);
  end if;
  if public.booking_request_payment_quarantined((source.work).booking_request_id) or (source.expiry).state='complete'
    or clock_timestamp()<(source.work).payment_required_deadline then raise exception 'Expiry admission is not allowed' using errcode='RC409'; end if;
  if exists(select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id=(source.work).booking_request_id
    and not exists(select 1 from public.booking_request_confirmation_invalidations invalidations where invalidations.booking_request_id=(source.work).booking_request_id))
    or (target.operation_kind='release' and exists(select 1 from public.payment_provider_operations captures
      where captures.claim_id=target.authorization_claim_id and captures.payment_lifecycle_id=target.authorization_payment_lifecycle_id
        and captures.operation_kind='capture' and (captures.current_outcome is null or captures.current_outcome in ('succeeded','indeterminate'))))
    then raise exception 'Expiry admission has lost ownership' using errcode='RC409'; end if;
  insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,admission,evidence_provenance)
  values(gen_random_uuid(),target.authorization_claim_id,target.authorization_claim_generation,target.operation_kind,target.provider,target.environment,target.merchant_id,target.terminal_id,
    target.provider_idempotency_key,target.request_fingerprint,target.authorization_payment_lifecycle_id,target.release_logical_operation_id,target.release_physical_attempt_id,target.amount_fils,target.currency,
    jsonb_build_object('purpose',expected->>'purpose','permit',expected,'notBefore',expected->>'notBefore','notAfter',null),'admitted') returning * into ledger;
  return public.payment_operation_admission(ledger,true);
end;
$function$;

CREATE FUNCTION public.booking_request_payment_expiry_is_safe (
  facts jsonb
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare operation jsonb;
declare owned jsonb;
begin
  if (facts->>'sourceValid')::boolean is not true or (facts->>'quarantined')::boolean or (facts->>'confirmationValid')::boolean
    or clock_timestamp()<(facts->>'deadline')::timestamptz then return false; end if;
  if not exists(select 1 from jsonb_array_elements(facts->'expiryOperations') entry where entry->>'authorizationLifecycleId'=facts->>'originalLifecycleId') then return false; end if;
  for operation in select * from jsonb_array_elements(facts->'operations') loop
    if (operation->>'valid')::boolean is not true or operation->>'outcome' is null or operation->>'outcome'='indeterminate' then return false; end if;
    if operation->>'outcome'='not-executed' then continue; end if;
    if operation->>'id' is distinct from facts->>'originalAuthorizationId' and operation->>'id' is distinct from facts->>'originalCaptureId'
      and operation->>'recoveryOperationId' is null and not exists(select 1 from jsonb_array_elements(facts->'expiryOperations') entry where entry->>'providerOperationId'=operation->>'id') then return false; end if;
    if operation->>'kind'='capture' and operation->>'outcome'='succeeded' then
      if operation->>'occurredAt' is null or (operation->>'occurredAt')::timestamptz<(facts->>'deadline')::timestamptz
        or operation->>'originalOutcome'='failed' or not exists(select 1 from jsonb_array_elements(facts->'expiryOperations') entry
          where entry->>'captureId'=operation->>'id' and entry->>'kind'='refund') then return false; end if;
    end if;
    if operation->>'kind'='authorization' and operation->>'outcome'='succeeded' and not exists(select 1 from jsonb_array_elements(facts->'expiryOperations') entry
      where entry->>'authorizationLifecycleId'=operation->>'lifecycleId') then return false; end if;
    if operation->>'kind' in ('release','refund') and operation->>'outcome'<>'succeeded' then return false; end if;
  end loop;
  if facts->>'originalCaptureId' is null then return false; end if;
  for owned in select * from jsonb_array_elements(facts->'expiryOperations') loop
    if (owned->>'valid')::boolean is not true or not exists(select 1 from jsonb_array_elements(facts->'operations') entry
      where entry->>'id'=owned->>'providerOperationId' and entry->>'outcome'='succeeded') then return false; end if;
  end loop;
  return true;
end;
$function$;

REVOKE ALL ON FUNCTION public.booking_request_payment_expiry_is_safe(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.finalize_booking_request_payment_required_expiry (
  target_booking_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare request public.booking_requests;
declare work public.booking_request_capture_work;
declare claim public.booking_request_authorization_claims;
declare commitment public.cottage_booking_period_commitments;
declare snapshot public.booking_snapshots;
declare attempt public.booking_request_submission_attempts;
declare prepared jsonb;
declare finalized_at timestamptz;
begin
  if current_setting('role',true) <> 'service_role' or target_booking_request_id is null then
    raise exception 'Expiry finalization is unavailable' using errcode='42501'; end if;
  if public.booking_request_payment_required_expiry_completed(target_booking_request_id) then
    return jsonb_build_object('status','expired','bookingRequestId',target_booking_request_id); end if;
  prepared:=public.get_booking_request_payment_facts(target_booking_request_id);
  if (prepared->>'quarantined')::boolean then return jsonb_build_object('status','quarantined','bookingRequestId',target_booking_request_id); end if;
  if (prepared->>'confirmationValid')::boolean then return jsonb_build_object('status','confirmed','bookingRequestId',target_booking_request_id); end if;
  select * into work from public.booking_request_capture_work capture_work where capture_work.booking_request_id=target_booking_request_id;
  if clock_timestamp()<work.payment_required_deadline then return jsonb_build_object('status','not-due','bookingRequestId',target_booking_request_id); end if;
  if not public.booking_request_payment_expiry_is_safe(prepared) then return jsonb_build_object('status','processing','bookingRequestId',target_booking_request_id); end if;
  select * into request from public.booking_requests requests where requests.id=target_booking_request_id;
  select * into claim from public.booking_request_authorization_claims claims where claims.id=work.authorization_claim_id;
  select * into attempt from public.booking_request_submission_attempts attempts where attempts.id=work.attempt_id;
  select * into snapshot from public.booking_snapshots snapshots where snapshots.id=request.booking_snapshot_id;
  select * into commitment from public.cottage_booking_period_commitments commitments
    where commitments.id=request.booking_period_commitment_id for update of commitments;
  perform 1 from public.cottage_inventory_commitments inventory where inventory.booking_period_commitment_id=commitment.id
    order by inventory.service_day,inventory.unit_kind,inventory.unit_id for update of inventory;
  perform 1 from public.cottage_booking_period_occupancies occupancies where occupancies.booking_period_commitment_id=commitment.id
    order by occupancies.service_day,occupancies.shift_id for update of occupancies;
  if request.status is distinct from 'accepted' or commitment.status is distinct from 'pending_hold'
    or not attempt.intent_dedupe_active
    or (commitment.customer_user_id,commitment.profile_id,commitment.schedule_revision_id,commitment.access_ranges)
      is distinct from (request.customer_user_id,request.profile_id,claim.schedule_revision_id,claim.access_ranges)
    or (claim.customer_user_id,claim.profile_id) is distinct from (request.customer_user_id,request.profile_id)
    or request.owner_user_id is distinct from (select profiles.owner_user_id from public.owner_application_cottage_profiles profiles where profiles.id=request.profile_id)
    or snapshot.id is null or (snapshot.customer_user_id,snapshot.profile_id,snapshot.quote_fingerprint,snapshot.intent_fingerprint,
      snapshot.quote_payload,snapshot.intent_payload) is distinct from
      (request.customer_user_id,request.profile_id,attempt.quote_fingerprint,attempt.intent_fingerprint,attempt.quote_payload,attempt.intent_payload)
    or not exists(select 1 from public.booking_request_authorization_claim_items items where items.claim_id=claim.id)
    or not exists(select 1 from public.booking_request_authorization_claim_occupancies occupancies where occupancies.claim_id=claim.id)
    or exists(
      (select unit_kind,unit_id,service_day,price_iqd from public.booking_request_authorization_claim_items where claim_id=claim.id
       except select unit_kind,unit_id,service_day,committed_price_iqd from public.cottage_inventory_commitments where booking_period_commitment_id=commitment.id)
      union all
      (select unit_kind,unit_id,service_day,committed_price_iqd from public.cottage_inventory_commitments where booking_period_commitment_id=commitment.id
       except select unit_kind,unit_id,service_day,price_iqd from public.booking_request_authorization_claim_items where claim_id=claim.id)
    )
    or exists(
      (select schedule_revision_id,shift_id,service_day from public.booking_request_authorization_claim_occupancies where claim_id=claim.id
       except select schedule_revision_id,shift_id,service_day from public.cottage_booking_period_occupancies where booking_period_commitment_id=commitment.id and active)
      union all
      (select schedule_revision_id,shift_id,service_day from public.cottage_booking_period_occupancies where booking_period_commitment_id=commitment.id and active
       except select schedule_revision_id,shift_id,service_day from public.booking_request_authorization_claim_occupancies where claim_id=claim.id)
    ) then
    perform public.quarantine_booking_request_payment(request.id,'inventory-evidence-invalid');
    return jsonb_build_object('status','quarantined','bookingRequestId',request.id);
  end if;
  finalized_at := clock_timestamp();
  if finalized_at < work.payment_required_deadline then
    return jsonb_build_object('status','not-due','bookingRequestId',request.id); end if;
  update public.cottage_booking_period_commitments set status='released_hold' where id=commitment.id;
  update public.cottage_booking_period_occupancies set active=false where booking_period_commitment_id=commitment.id and active;
  update public.booking_requests set status='expired',settled_at=finalized_at where id=request.id;
  update public.booking_request_submission_attempts set intent_dedupe_active=false,updated_at=finalized_at where id=attempt.id;
  update public.booking_request_payment_required_expiry_work set state='complete',diagnostic_reason=null,
    completed_at=finalized_at,last_evaluated_at=finalized_at where booking_request_id=request.id;
  insert into public.booking_request_status_notifications(booking_request_id,recipient_user_id,status,created_at)
    values(request.id,request.customer_user_id,'expired',finalized_at),(request.id,request.owner_user_id,'expired',finalized_at)
    on conflict do nothing;
  return jsonb_build_object('status','expired','bookingRequestId',request.id);
end;
$function$;

CREATE FUNCTION public.get_booking_request_payment_facts (
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
  if request.id is null or work.payment_required_deadline is null then raise exception 'Payment facts source is invalid' using errcode='RC409'; end if;
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

REVOKE ALL ON FUNCTION public.get_booking_request_payment_facts(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_booking_request_payment_facts(uuid) TO service_role;

CREATE FUNCTION public.get_booking_request_payment_observation_facts (
  target_operation_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  return public.get_booking_request_payment_facts((select work.booking_request_id from public.booking_request_capture_work work
    join public.payment_provider_operations ledger on ledger.claim_id=work.authorization_claim_id where ledger.id=target_operation_id));
end;
$function$;

REVOKE ALL ON FUNCTION public.get_booking_request_payment_observation_facts(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_booking_request_payment_observation_facts(uuid) TO service_role;

CREATE FUNCTION public.get_booking_request_payment_recovery_facts (
  target_attempt_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  return public.get_booking_request_payment_facts((select attempts.booking_request_id from public.booking_request_payment_recovery_attempts attempts where attempts.id=target_attempt_id));
end;
$function$;

REVOKE ALL ON FUNCTION public.get_booking_request_payment_recovery_facts(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_booking_request_payment_recovery_facts(uuid) TO service_role;

CREATE FUNCTION public.lease_booking_request_payment_recovery_step (
  target_attempt_id     uuid,
  target_step           text,
  target_expected_state text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare source record;
declare permit jsonb;
declare ledger public.payment_provider_operations;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Recovery processing is unavailable' using errcode='42501'; end if;
  if public.booking_request_payment_quarantined((select attempts.booking_request_id from public.booking_request_payment_recovery_attempts attempts where attempts.id=target_attempt_id)) then return jsonb_build_object('status','quarantined'); end if;
  if public.booking_request_payment_required_expiry_completed((select attempts.booking_request_id from public.booking_request_payment_recovery_attempts attempts where attempts.id=target_attempt_id)) then return jsonb_build_object('status','deadline-elapsed'); end if;
  select * into source from public.lock_booking_request_payment_recovery_source(target_attempt_id);
  if (source.attempt).state is distinct from target_expected_state then return jsonb_build_object('status','stale'); end if;
  if not ((target_step='original-release' and target_expected_state='admitted')
    or (target_step='replacement-authorization' and target_expected_state='original_released')
    or (target_step='replacement-capture' and target_expected_state='replacement_authorized')
    or (target_step='replacement-release' and target_expected_state='capture_failed')) then
    raise exception 'Recovery step is invalid for current state' using errcode='RC409'; end if;
  permit:=public.booking_request_recovery_execution_permit(source.attempt,source.work,source.payment_snapshot,target_step);
  if exists(select 1 from public.booking_request_payment_required_expiry_operations owned
    where owned.booking_request_id=(source.work).booking_request_id and owned.owner='expiry'
      and owned.authorization_payment_lifecycle_id=(permit#>>'{binding,paymentLifecycleId}')::uuid
      and owned.predecessor_movement_reference=permit#>>'{binding,predecessorMovementReference}') then
    return jsonb_build_object('status','deadline-elapsed'); end if;
  select * into ledger from public.payment_provider_operations operations where operations.recovery_attempt_id=target_attempt_id
    and operations.logical_operation_id=permit->>'operationId' for update of operations;
  if ledger.id is not null then
    if ledger.admission->'permit' is distinct from permit then raise exception 'Recovery admission binding changed' using errcode='RC409'; end if;
    return jsonb_build_object('status','reconcile','permit',permit,'binding',permit->'binding',
      'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference);
  end if;
  if exists(select 1 from public.payment_provider_operations operations where operations.recovery_attempt_id=target_attempt_id
    and operations.current_outcome is null) then return jsonb_build_object('status','stale'); end if;
  if target_step<>'replacement-release' and clock_timestamp()>=(source.work).payment_required_deadline then
    return jsonb_build_object('status','deadline-elapsed'); end if;
  return jsonb_build_object('status','leased','permit',permit,'binding',permit->'binding');
end;
$function$;

REVOKE ALL ON FUNCTION public.lease_booking_request_payment_recovery_step(uuid, text, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.lease_booking_request_payment_recovery_step(uuid, text, text) TO service_role;

CREATE FUNCTION public.observe_booking_request_payment_correction (
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
    array['booking-request-capture','booking-request-payment-recovery','booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund']);
  select * into work from public.booking_request_capture_work capture where capture.booking_request_id=target_booking_request_id for update of capture;
  facts:=public.get_booking_request_payment_observation_facts(ledger.id);
  if facts->>'revision' is distinct from target_command->>'revision' then return jsonb_build_object('status','stale'); end if;
  if work.payment_required_deadline is null or ledger.id is null or ledger.operation_kind not in ('capture','release','refund')
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
      is distinct from (work.authorization_claim_generation,work.amount_fils,work.currency,work.provider,work.environment,work.merchant_id,work.terminal_id)
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

REVOKE ALL ON FUNCTION public.observe_booking_request_payment_correction(uuid, uuid, jsonb, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.observe_booking_request_payment_correction(uuid, uuid, jsonb, jsonb) TO service_role;

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

CREATE FUNCTION public.prepare_booking_request_payment_required_expiry (
  target_booking_request_id uuid,
  target_provider_identity  jsonb,
  target_command            jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare facts jsonb;
declare source record;
declare expiry public.booking_request_payment_required_expiry_work;
declare target public.booking_request_payment_required_expiry_operations;
declare recovery public.booking_request_payment_recovery_attempts;
declare authorization_ledger public.payment_provider_operations;
declare released public.payment_provider_operations;
declare recovery_operation public.booking_request_payment_recovery_operations;
declare lifecycle uuid:=(target_command->>'authorizationLifecycleId')::uuid;
declare logical_identity text;
declare authorization_logical text;
declare authorization_physical text;
declare predecessor text;
declare predecessor_time timestamptz;
declare permit jsonb;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Payment Required expiry preparation is unavailable' using errcode='42501'; end if;
  facts:=public.get_booking_request_payment_facts(target_booking_request_id);
  if facts->>'revision' is distinct from target_command->>'revision' then return jsonb_build_object('status','stale'); end if;
  if facts->'providerIdentity' is distinct from target_provider_identity then raise exception 'Payment Required expiry provider is invalid' using errcode='RC409'; end if;
  if (facts->>'quarantined')::boolean then return jsonb_build_object('status','quarantined'); end if;
  if (facts->>'expired')::boolean then return jsonb_build_object('status','expired'); end if;
  if target_command->>'action'='quarantine' then
    if target_command->>'reason' is null then raise exception 'Quarantine reason is required' using errcode='RC409'; end if;
    return public.quarantine_booking_request_payment(target_booking_request_id,target_command->>'reason');
  end if;
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  if (source.work).state<>'payment_required' or clock_timestamp()<(source.work).payment_required_deadline then return jsonb_build_object('status','not-due'); end if;
  if (facts->>'confirmationValid')::boolean then return jsonb_build_object('status','confirmed'); end if;
  insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline)
    values(target_booking_request_id,(source.work).payment_required_deadline) on conflict do nothing;
  select * into expiry from public.booking_request_payment_required_expiry_work work where work.booking_request_id=target_booking_request_id for update of work;
  if expiry.payment_required_deadline is distinct from (source.work).payment_required_deadline then raise exception 'Payment Required expiry deadline binding is invalid' using errcode='RC409'; end if;
  if target_command->>'action'='refund' then
    perform public.prepare_booking_request_corrective_refund(target_booking_request_id,(target_command->>'captureId')::uuid);
    select * into target from public.booking_request_payment_required_expiry_operations owned where owned.expiry_work_id=expiry.id and owned.capture_provider_operation_id=(target_command->>'captureId')::uuid;
  elsif target_command->>'action'='release' then
    if lifecycle is null or exists(select 1 from public.payment_provider_operations ledger where ledger.claim_id=(source.work).authorization_claim_id
      and ledger.operation_kind='capture' and (ledger.current_outcome is null or ledger.current_outcome in ('succeeded','indeterminate'))
      and ledger.payment_lifecycle_id=lifecycle) then raise exception 'Captured or unresolved authorization cannot be released' using errcode='RC409'; end if;
    if lifecycle=(source.work).payment_lifecycle_id then
      if (source.ledger).current_outcome is distinct from 'failed' or (source.ledger).movement_reference is not null then raise exception 'Original capture is unresolved' using errcode='RC409'; end if;
      authorization_logical:=(source.work).authorization_logical_operation_id;
      authorization_physical:=(source.work).authorization_physical_attempt_id;
      predecessor:=source.payment_snapshot#>>'{authorization,movementReference}';
      predecessor_time:=(source.payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz;
      logical_identity:=expiry.id::text||':original-release';
    else
      select * into recovery from public.booking_request_payment_recovery_attempts attempts where attempts.id=lifecycle and attempts.booking_request_id=target_booking_request_id for update of attempts;
      select * into recovery_operation from public.booking_request_payment_recovery_operations owned where owned.recovery_attempt_id=recovery.id and owned.step='replacement-authorization';
      authorization_ledger:=public.validate_booking_request_recovery_operation(recovery_operation,public.booking_request_recovery_execution_permit(recovery,source.work,source.payment_snapshot,'replacement-authorization'));
      if authorization_ledger.current_outcome is distinct from 'succeeded' then raise exception 'Expiry authorization is invalid' using errcode='RC409'; end if;
      authorization_logical:=authorization_ledger.logical_operation_id; authorization_physical:=authorization_ledger.physical_attempt_id;
      predecessor:=authorization_ledger.movement_reference; predecessor_time:=authorization_ledger.authoritative_outcome_at;
      logical_identity:=expiry.id::text||':replacement-release:'||recovery.generation::text;
    end if;
    select * into recovery_operation from public.booking_request_payment_recovery_operations owned
      where owned.id=(target_command->>'recoveryOperationId')::uuid;
    if recovery_operation.id is not null then
      select * into recovery from public.booking_request_payment_recovery_attempts attempts where attempts.id=recovery_operation.recovery_attempt_id and attempts.booking_request_id=target_booking_request_id;
      if recovery.id is null or recovery_operation.step is distinct from (case when lifecycle=(source.work).payment_lifecycle_id then 'original-release' else 'replacement-release' end)
        or (lifecycle<>(source.work).payment_lifecycle_id and recovery.id<>lifecycle) then raise exception 'Expiry release owner is invalid' using errcode='RC409'; end if;
      released:=public.validate_booking_request_recovery_operation(recovery_operation,public.booking_request_recovery_execution_permit(recovery,source.work,source.payment_snapshot,recovery_operation.step));
      if released.current_outcome is distinct from 'succeeded' then raise exception 'Recovery release is unresolved' using errcode='RC409'; end if;
      logical_identity:=released.logical_operation_id;
    elsif target_command->>'recoveryOperationId' is not null or exists(select 1 from public.payment_provider_operations ledger
      where ledger.recovery_attempt_id is not null and ledger.payment_lifecycle_id=lifecycle and ledger.operation_kind='release'
      and ledger.current_outcome is distinct from 'not-executed') then raise exception 'Recovery already owns authorization release' using errcode='RC409'; end if;
    insert into public.booking_request_payment_required_expiry_operations(expiry_work_id,booking_request_id,owner,recovery_operation_id,provider_operation_id,
      authorization_claim_id,authorization_claim_generation,authorization_payment_lifecycle_id,authorization_logical_operation_id,authorization_physical_attempt_id,
      predecessor_movement_reference,predecessor_outcome_at,release_logical_operation_id,release_physical_attempt_id,provider_idempotency_key,amount_fils,currency,
      provider,environment,merchant_id,terminal_id,request_fingerprint)
    values(expiry.id,target_booking_request_id,case when recovery_operation.id is null then 'expiry' else 'recovery' end,recovery_operation.id,released.id,
      (source.work).authorization_claim_id,(source.work).authorization_claim_generation,lifecycle,authorization_logical,authorization_physical,
      predecessor,predecessor_time,logical_identity,coalesce(released.physical_attempt_id,logical_identity||':1'),coalesce(released.provider_idempotency_key,logical_identity||':1'),(source.work).amount_fils,(source.work).currency,
      (source.work).provider,(source.work).environment,(source.work).merchant_id,(source.work).terminal_id,(source.work).request_fingerprint) on conflict do nothing;
    select * into target from public.booking_request_payment_required_expiry_operations owned where owned.expiry_work_id=expiry.id and owned.authorization_payment_lifecycle_id=lifecycle;
    if target.operation_kind<>'release' or target.recovery_operation_id is distinct from recovery_operation.id then raise exception 'Expiry release ownership changed' using errcode='RC409'; end if;
  else raise exception 'Explicit expiry action is invalid' using errcode='RC409';
  end if;
  perform public.validate_booking_request_payment_required_expiry_target(target,source.work,source.payment_snapshot);
  update public.booking_request_payment_required_expiry_work set last_evaluated_at=clock_timestamp() where id=expiry.id;
  return jsonb_build_object('status','prepared');
end;
$function$;

REVOKE ALL ON FUNCTION public.prepare_booking_request_payment_required_expiry(uuid, jsonb, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.prepare_booking_request_payment_required_expiry(uuid, jsonb, jsonb) TO service_role;

CREATE FUNCTION public.record_booking_request_payment_observation (
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
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-request-capture','booking-request-payment-recovery','booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund']);
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

REVOKE ALL ON FUNCTION public.record_booking_request_payment_observation(uuid, jsonb, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_booking_request_payment_observation(uuid, jsonb, jsonb) TO service_role;

CREATE FUNCTION public.record_booking_request_payment_recovery_observation (
  target_operation_id uuid,
  target_result       jsonb,
  target_command      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform public.lock_payment_observation_source(target_operation_id,array['booking-request-payment-recovery']);
  return public.record_booking_request_payment_observation(target_operation_id,target_result,target_command);
end;
$function$;

REVOKE ALL ON FUNCTION public.record_booking_request_payment_recovery_observation(uuid, jsonb, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_booking_request_payment_recovery_observation(uuid, jsonb, jsonb) TO service_role;

CREATE FUNCTION public.record_booking_request_payment_required_expiry_observation (
  target_operation_id uuid,
  target_result       jsonb,
  target_command      jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform public.lock_payment_observation_source(target_operation_id,array['booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund']);
  return public.record_booking_request_payment_observation(target_operation_id,target_result,target_command);
end;
$function$;

REVOKE ALL ON FUNCTION public.record_booking_request_payment_required_expiry_observation(uuid, jsonb, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_booking_request_payment_required_expiry_observation(uuid, jsonb, jsonb) TO service_role;