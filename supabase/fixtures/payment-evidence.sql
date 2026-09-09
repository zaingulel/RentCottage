-- Database test arrangement only. Production executes its fictional provider in TypeScript.
-- Each fixture call visibly composes durable admission, isolated effect, and trusted recording.
create or replace function pg_temp.payment_fixture_result(admission jsonb, outcome text, target_command jsonb default null) returns jsonb language plpgsql as $$
declare effect_binding jsonb:=admission-array['purpose','binding','mode'];
declare observed jsonb;
declare proposed jsonb;
declare recorder text;
declare operation_id text:=admission->>'operationId';
begin
  if admission->>'status'='not-admitted' then return jsonb_build_object('outcome','not-executed'); end if;
  if operation_id is null then return admission; end if;
  proposed:=jsonb_build_object('outcome',outcome,'providerRequestId','fixture-request-'||operation_id,'providerReference','fixture-reference-'||operation_id,
    'evidence',jsonb_build_object('operationId',operation_id,'eventId','fixture-'||operation_id||'-'||outcome,'provenance','fictional-provider',
      'originalOutcome',outcome,'executedAt',clock_timestamp(),'occurredAt',case when outcome<>'indeterminate' then clock_timestamp() end,'closedAt',null))
    ||case when outcome='failed' then jsonb_build_object('retrySafe',false) else jsonb_build_object('movementReference','fixture-movement-'||operation_id) end;
  if admission->>'mode'='execute' then observed:=public.persist_simulated_payment_effect(effect_binding,proposed);
  else
    observed:=public.seal_simulated_payment_absence(effect_binding);
    if observed->>'outcome'='indeterminate' and outcome<>'indeterminate' then
      proposed:=jsonb_set(proposed,'{evidence,originalOutcome}',observed#>'{evidence,originalOutcome}');
      proposed:=jsonb_set(proposed,'{evidence,executedAt}',observed#>'{evidence,executedAt}');
      proposed:=proposed||jsonb_build_object('providerRequestId',observed->>'providerRequestId','providerReference',observed->>'providerReference');
      if outcome='succeeded' then proposed:=proposed||jsonb_build_object('movementReference',observed->>'movementReference'); end if;
      observed:=public.resolve_simulated_payment_effect(effect_binding,observed#>>'{evidence,eventId}',proposed);
    end if;
  end if;
  recorder:=case admission->>'purpose' when 'booking-request-capture' then 'record_booking_request_capture_observation'
    when 'booking-request-payment-recovery' then 'record_booking_request_payment_recovery_observation'
    when 'booking-request-payment-required-expiry' then 'record_booking_request_payment_required_expiry_observation'
    when 'booking-request-payment-required-corrective-refund' then 'record_booking_request_payment_required_expiry_observation'
    else 'record_booking_request_provider_operation_observation' end;
  if recorder in ('record_booking_request_payment_recovery_observation','record_booking_request_payment_required_expiry_observation') then
    if target_command is null then raise exception 'Fixture must name observation consequences'; end if;
    execute format('select public.%I($1,$2,$3)',recorder) into observed using operation_id::uuid,observed,
      target_command||jsonb_build_object('revision',public.get_booking_request_payment_observation_facts(operation_id::uuid)->>'revision');
  else execute format('select public.%I($1,$2)',recorder) into observed using operation_id::uuid,observed; end if;
  return observed-'evidence';
end;
$$;
create or replace function pg_temp.payment_fixture_execute(routine text,permit jsonb,outcome text,target_command jsonb default null) returns jsonb language plpgsql as $$
declare prior_role text:=current_setting('role'); declare admission jsonb; declare result jsonb;
begin
  if prior_role='none' then perform set_config('role','service_role',true); end if;
  execute format('select public.%I($1)',routine) into admission using permit;
  result:=pg_temp.payment_fixture_result(admission,outcome,target_command);
  perform set_config('role',prior_role,true);
  return result;
end;
$$;
create or replace function pg_temp.payment_execute(operation jsonb,outcome text) returns jsonb language sql as $$
  select pg_temp.payment_fixture_execute('admit_booking_request_provider_operation',operation,outcome);
$$;
create or replace function pg_temp.capture_execute(permit jsonb,outcome text default 'succeeded') returns jsonb language sql as $$
  select pg_temp.payment_fixture_execute('admit_booking_request_capture',permit,outcome);
$$;
create or replace function pg_temp.recovery_execute(permit jsonb,outcome text,target_state text,target_quarantine text default null,target_capture uuid default null) returns jsonb language sql as $$
  select pg_temp.payment_fixture_execute('admit_booking_request_payment_recovery',permit,outcome,jsonb_build_object('recoveryState',target_state,'quarantineReason',target_quarantine,'correctiveCaptureId',target_capture));
$$;
create or replace function pg_temp.expiry_execute(permit jsonb,outcome text,target_quarantine text default null) returns jsonb language sql as $$
  select pg_temp.payment_fixture_execute('admit_booking_request_payment_required_expiry',permit,outcome,jsonb_build_object('recoveryState',null,'quarantineReason',target_quarantine,'correctiveCaptureId',null));
$$;
create or replace function pg_temp.payment_query(operation jsonb,request_id text,reference text,outcome text,target_command jsonb default null) returns jsonb language plpgsql as $$
declare prior_role text:=current_setting('role'); declare result jsonb;
begin
  if prior_role='none' then perform set_config('role','service_role',true); end if;
  result:=pg_temp.payment_fixture_result(public.reload_booking_request_payment_operation(operation-array['permitPurpose','claimId','claimGeneration','notAfter','idempotencyKey','cleanupAttemptId','workId','leaseGeneration','leaseToken','stateRevision','operationId','operationGeneration'],request_id,reference),outcome,target_command);
  perform set_config('role',prior_role,true);
  return result;
end;
$$;
create or replace function pg_temp.capture_query(operation jsonb,request_id text,reference text) returns jsonb language sql as $$
  select pg_temp.payment_query(operation,request_id,reference,'succeeded');
$$;
create or replace function pg_temp.permit_query(permit jsonb,request_id text,reference text,outcome text,target_state text default null,target_quarantine text default null,target_capture uuid default null) returns jsonb language sql as $$
  select pg_temp.payment_query(jsonb_build_object('providerIdentity',permit#>'{binding,providerIdentity}',
    'requestFingerprint',permit#>'{binding,requestFingerprint}','paymentLifecycleId',coalesce(permit#>'{binding,paymentLifecycleId}',permit#>'{binding,authorizationPaymentLifecycleId}'),
    'logicalOperationId',coalesce(permit#>'{binding,logicalOperationId}',permit#>'{binding,releaseLogicalOperationId}',permit#>'{binding,refundLogicalOperationId}'),'physicalAttemptId',coalesce(permit#>'{binding,physicalAttemptId}',permit#>'{binding,releasePhysicalAttemptId}',permit#>'{binding,refundPhysicalAttemptId}'),
    'operationKind',case permit->>'step' when 'replacement-authorization' then 'authorization' when 'replacement-capture' then 'capture'
      else case when permit->>'purpose'='booking-request-payment-required-corrective-refund' then 'refund' else 'release' end end,
    'amountFils',permit#>'{binding,amountFils}','currency',permit#>'{binding,currency}'),request_id,reference,outcome,jsonb_build_object('recoveryState',target_state,'quarantineReason',target_quarantine,'correctiveCaptureId',target_capture));
$$;
create or replace function pg_temp.payment_fixture_operation_json(operation public.payment_provider_operations) returns jsonb language sql as $$
  select to_jsonb(operation)||jsonb_build_object('physical_execution_count',
    coalesce((select physical_execution_count from public.simulated_payment_effects where operation_id=operation.id),0));
$$;

create or replace function pg_temp.expiry_prepare(request_id uuid,identity jsonb,command jsonb) returns jsonb language plpgsql as $$
declare result jsonb; declare target jsonb; declare prior_role text:=current_setting('role');
begin
  if prior_role='none' then perform set_config('role','service_role',true); end if;
  result:=public.prepare_booking_request_payment_required_expiry(request_id,identity,command||jsonb_build_object('revision',public.get_booking_request_payment_facts(request_id)->>'revision'));
  if result->>'status'='prepared' then
    select owned into target from jsonb_array_elements(public.get_booking_request_payment_facts(request_id)->'expiryOperations') owned
      where (command->>'action'='release' and owned->>'authorizationLifecycleId'=command->>'authorizationLifecycleId')
        or (command->>'action'='refund' and owned->>'captureId'=command->>'captureId');
    result:=jsonb_build_object('status',command->>'action','permit',target->'permit','binding',target#>'{permit,binding}');
  end if;
  perform set_config('role',prior_role,true);
  return result;
end;
$$;
create or replace function pg_temp.correction_observe(request_id uuid,operation_id uuid,receipt jsonb,target_state text,target_quarantine text,target_capture uuid default null) returns jsonb language sql as $$
  select public.observe_booking_request_payment_correction(request_id,operation_id,receipt,jsonb_build_object('revision',public.get_booking_request_payment_observation_facts(operation_id)->>'revision',
    'recoveryState',target_state,'quarantineReason',target_quarantine,'correctiveCaptureId',target_capture));
$$;
