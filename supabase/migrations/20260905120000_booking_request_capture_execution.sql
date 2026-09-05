-- Capture ledger entries retain the exact admission permit after completed work clears its lease.
alter table public.simulated_payment_provider_operations
  drop constraint simulated_payment_provider_operations_operation_kind_check,
  add constraint simulated_payment_provider_operations_operation_kind_check
    check (operation_kind in ('authorization', 'release', 'capture')),
  add column capture_execution_permit jsonb,
  add constraint simulated_capture_execution_permit_check check (
    (operation_kind = 'capture' and capture_execution_permit is not null
      and jsonb_typeof(capture_execution_permit) = 'object'
      and capture_execution_permit @> '{"purpose":"booking-request-capture"}'::jsonb
      and capture_execution_permit ?& array[
        'purpose', 'bookingRequestId', 'submissionAttemptId', 'authorizationClaimId',
        'authorizationClaimGeneration', 'paymentLifecycleId', 'authorizationLogicalOperationId',
        'authorizationPhysicalAttemptId', 'captureLogicalOperationId', 'capturePhysicalAttemptId',
        'amountFils', 'currency', 'providerIdentity', 'idempotencyKey', 'requestFingerprint',
        'workId', 'leaseGeneration', 'leaseToken', 'notAfter'
      ]
      and capture_execution_permit - array[
        'purpose', 'bookingRequestId', 'submissionAttemptId', 'authorizationClaimId',
        'authorizationClaimGeneration', 'paymentLifecycleId', 'authorizationLogicalOperationId',
        'authorizationPhysicalAttemptId', 'captureLogicalOperationId', 'capturePhysicalAttemptId',
        'amountFils', 'currency', 'providerIdentity', 'idempotencyKey', 'requestFingerprint',
        'workId', 'leaseGeneration', 'leaseToken', 'notAfter'
      ] = '{}'::jsonb
      and jsonb_strip_nulls(capture_execution_permit) = capture_execution_permit
      and jsonb_typeof(capture_execution_permit -> 'providerIdentity') = 'object'
      and capture_execution_permit -> 'providerIdentity' ?& array['provider','environment','merchantId','terminalId']
      and (capture_execution_permit -> 'providerIdentity') - array['provider','environment','merchantId','terminalId'] = '{}'::jsonb)
    or (operation_kind <> 'capture' and capture_execution_permit is null)
  );
alter table public.booking_request_provider_operation_identities
  drop constraint booking_request_provider_operation_identit_operation_kind_check,
  add constraint booking_request_provider_operation_identit_operation_kind_check
    check (operation_kind in ('authorization', 'release', 'capture'));

-- Entry points share this lock prefix; provider and normalized identity locks follow it.
create function public.lock_booking_request_capture_source(target_booking_request_id uuid)
returns table(work public.booking_request_capture_work, payment_snapshot jsonb, binding jsonb, ledger public.simulated_payment_provider_operations)
language plpgsql
security definer
set search_path = ''
as $$
declare target_request public.booking_requests;
declare target_attempt public.booking_request_submission_attempts;
declare target_claim public.booking_request_authorization_claims;
declare authorization_identity public.booking_request_provider_operation_identities;
declare expected_fingerprint text;
declare expected_authorization jsonb;
declare expected_movement jsonb;
begin
  select * into target_request from public.booking_requests requests
  where requests.id = target_booking_request_id for update of requests;
  select * into work from public.booking_request_capture_work capture_work
  where capture_work.booking_request_id = target_booking_request_id for update of capture_work;
  if work.booking_request_id is null then return; end if;
  select * into target_attempt from public.booking_request_submission_attempts attempts
  where attempts.id = work.attempt_id for update of attempts;
  select * into target_claim from public.booking_request_authorization_claims claims
  where claims.id = work.authorization_claim_id for update of claims;
  expected_fingerprint := encode(
    extensions.digest(
      convert_to(
        '{"provider":{"provider":' || to_json(work.provider)::text
        || ',"environment":' || to_json(work.environment)::text
        || ',"merchantId":' || to_json(work.merchant_id)::text
        || ',"terminalId":' || to_json(work.terminal_id)::text
        || '},"kind":"capture","paymentLifecycleId":'
        || to_json(work.payment_lifecycle_id::text)::text
        || ',"logicalOperationId":'
        || to_json(work.capture_logical_operation_id)::text
        || ',"attemptId":' || to_json(work.capture_physical_attempt_id)::text
        || ',"amountFils":' || work.amount_fils::text
        || ',"currency":"IQD"}',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if target_request.id is null
    or target_request.status <> 'accepted'
    or target_request.payment_lifecycle_id <> work.payment_lifecycle_id
    or target_attempt.id is null
    or target_attempt.state <> 'finalized'
    or target_attempt.booking_request_id is distinct from target_request.id
    or target_attempt.payment_lifecycle_id <> work.payment_lifecycle_id
    or target_attempt.authorization_provider is distinct from work.provider
    or target_attempt.authorization_environment is distinct from work.environment
    or target_attempt.authorization_merchant_id is distinct from work.merchant_id
    or target_attempt.authorization_terminal_id is distinct from work.terminal_id
    or target_attempt.payment_snapshot ->> 'paymentLifecycleId'
      is distinct from work.payment_lifecycle_id::text
    or target_attempt.payment_snapshot -> 'authorization' ->> 'paymentLifecycleId'
      is distinct from work.payment_lifecycle_id::text
    or target_attempt.payment_snapshot -> 'authorization' ->> 'kind'
      is distinct from 'authorization'
    or target_attempt.payment_snapshot -> 'authorization' ->> 'status'
      is distinct from 'succeeded'
    or target_attempt.payment_snapshot -> 'authorization' ->> 'logicalOperationId'
      is distinct from work.authorization_logical_operation_id
    or target_attempt.payment_snapshot -> 'authorization' ->> 'attemptId'
      is distinct from work.authorization_physical_attempt_id
    or (target_attempt.payment_snapshot -> 'authorization' ->> 'amountFils')::bigint
      is distinct from work.amount_fils
    or target_attempt.authorization_provider_request_id is null
    or target_attempt.authorization_provider_reference is null
    or target_attempt.authorization_movement_reference is null
    or target_attempt.payment_snapshot -> 'authorization'
      ->> 'providerRequestId'
      is distinct from target_attempt.authorization_provider_request_id
    or target_attempt.payment_snapshot -> 'authorization'
      ->> 'providerReference'
      is distinct from target_attempt.authorization_provider_reference
    or target_attempt.payment_snapshot -> 'authorization'
      ->> 'movementReference'
      is distinct from target_attempt.authorization_movement_reference
    or target_attempt.payment_snapshot -> 'release'
      is distinct from 'null'::jsonb
    or target_claim.id is null
    or target_claim.attempt_id <> target_attempt.id
    or target_claim.generation <> work.authorization_claim_generation
    or target_claim.state <> 'converted'
    or target_claim.payment_lifecycle_id <> work.payment_lifecycle_id
    or target_claim.logical_operation_id
      <> work.authorization_logical_operation_id
    or target_claim.physical_attempt_id
      <> work.authorization_physical_attempt_id
    or target_claim.amount_fils <> work.amount_fils
    or target_claim.currency <> work.currency
    or target_claim.provider <> work.provider
    or target_claim.environment <> work.environment
    or target_claim.merchant_id <> work.merchant_id
    or target_claim.terminal_id <> work.terminal_id
    or work.capture_logical_operation_id
      <> work.payment_lifecycle_id::text || ':capture'
    or work.capture_physical_attempt_id
      <> work.capture_logical_operation_id || ':attempt-2'
    or work.capture_logical_operation_id = work.authorization_logical_operation_id
    or work.capture_physical_attempt_id = work.authorization_physical_attempt_id
    or work.provider_idempotency_key
      <> 'booking-request-capture:' || work.booking_request_id::text
        || ':' || work.authorization_claim_generation::text
    or work.request_fingerprint <> expected_fingerprint then
    raise exception 'Booking Request capture-work binding is invalid'
      using errcode = 'RC409';
  end if;

  select * into ledger from public.simulated_payment_provider_operations operations
  where operations.provider = work.provider and operations.environment = work.environment
    and operations.merchant_id = work.merchant_id and operations.terminal_id = work.terminal_id
    and operations.provider_idempotency_key = work.provider_idempotency_key
  for update of operations;
  -- The held submission-attempt lock serializes normalized Authorization writes.
  select * into authorization_identity from public.booking_request_provider_operation_identities identities
  where identities.attempt_id = target_attempt.id and identities.operation_kind = 'authorization';
  expected_authorization := jsonb_build_object(
    'paymentLifecycleId', work.payment_lifecycle_id, 'kind', 'authorization',
    'logicalOperationId', work.authorization_logical_operation_id,
    'attemptId', work.authorization_physical_attempt_id, 'status', 'succeeded',
    'amountFils', work.amount_fils,
    'providerRequestId', target_attempt.authorization_provider_request_id,
    'providerReference', target_attempt.authorization_provider_reference,
    'movementReference', target_attempt.authorization_movement_reference,
    'reconciliationRequired', false, 'retrySafe', false
  );
  expected_movement := jsonb_build_object(
    'kind', 'authorization', 'logicalOperationId', work.authorization_logical_operation_id,
    'attemptId', work.authorization_physical_attempt_id, 'amountFils', work.amount_fils,
    'movementReference', target_attempt.authorization_movement_reference,
    'recordedAt', target_attempt.payment_snapshot #>> '{movements,0,recordedAt}'
  );
  if target_attempt.payment_snapshot -> 'authorization' is distinct from expected_authorization
    or target_attempt.payment_snapshot #> '{movements,0}' is distinct from expected_movement
    or (target_attempt.payment_snapshot #>> '{movements,0,recordedAt}') is null
    or (target_attempt.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz is null
    or target_attempt.payment_snapshot ->> 'currency' is distinct from work.currency
    or (target_attempt.payment_snapshot ->> 'customerTotalFils')::bigint is distinct from work.amount_fils
    or authorization_identity.attempt_id is null
    or (authorization_identity.provider, authorization_identity.environment,
      authorization_identity.merchant_id, authorization_identity.terminal_id,
      authorization_identity.provider_request_id, authorization_identity.provider_reference,
      authorization_identity.movement_reference) is distinct from
      (work.provider, work.environment, work.merchant_id, work.terminal_id,
       target_attempt.authorization_provider_request_id, target_attempt.authorization_provider_reference,
       target_attempt.authorization_movement_reference)
    or (work.state <> 'complete' and (
      target_attempt.payment_snapshot -> 'capture' is distinct from 'null'::jsonb
      or jsonb_array_length(target_attempt.payment_snapshot -> 'movements') <> 1
    )) then
    raise exception 'Booking Request capture Authorization evidence is invalid' using errcode = 'RC409';
  end if;
  payment_snapshot := target_attempt.payment_snapshot;
  binding := jsonb_build_object(
    'bookingRequestId', work.booking_request_id, 'submissionAttemptId', work.attempt_id,
    'authorizationClaimId', work.authorization_claim_id,
    'authorizationClaimGeneration', work.authorization_claim_generation,
    'paymentLifecycleId', work.payment_lifecycle_id,
    'authorizationLogicalOperationId', work.authorization_logical_operation_id,
    'authorizationPhysicalAttemptId', work.authorization_physical_attempt_id,
    'captureLogicalOperationId', work.capture_logical_operation_id,
    'capturePhysicalAttemptId', work.capture_physical_attempt_id,
    'amountFils', work.amount_fils, 'currency', work.currency,
    'providerIdentity', jsonb_build_object('provider', work.provider,
      'environment', work.environment, 'merchantId', work.merchant_id, 'terminalId', work.terminal_id),
    'idempotencyKey', work.provider_idempotency_key, 'requestFingerprint', work.request_fingerprint
  );
  if ledger.id is not null and (
    (ledger.claim_id, ledger.claim_generation, ledger.operation_kind,
      ledger.payment_lifecycle_id, ledger.logical_operation_id, ledger.physical_attempt_id,
      ledger.amount_fils, ledger.currency, ledger.request_fingerprint,
      ledger.original_outcome, ledger.current_outcome) is distinct from
      (work.authorization_claim_id, work.authorization_claim_generation, 'capture'::text,
      work.payment_lifecycle_id, work.capture_logical_operation_id, work.capture_physical_attempt_id,
      work.amount_fils, work.currency, work.request_fingerprint, 'succeeded'::text, 'succeeded'::text)
    or ledger.movement_reference is null
    or ledger.capture_execution_permit - array['purpose', 'workId', 'leaseGeneration', 'leaseToken', 'notAfter']
      is distinct from binding
    or ledger.capture_execution_permit ->> 'purpose' is distinct from 'booking-request-capture'
    or ledger.capture_execution_permit ->> 'workId' is distinct from work.booking_request_id::text
  ) then
    raise exception 'Booking Request capture provider ledger is invalid' using errcode = 'RC409';
  end if;
  return next;
end;
$$;
revoke all on function public.lock_booking_request_capture_source(uuid)
  from public, anon, authenticated, service_role;

create function public.lease_booking_request_capture_work(
  target_booking_request_id uuid, target_provider_identity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare source record;
declare work public.booking_request_capture_work;
declare leased_at timestamptz;
begin
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  if not found then return jsonb_build_object('status', 'unavailable'); end if;
  work := source.work;
  if target_provider_identity is distinct from source.binding -> 'providerIdentity' then
    raise exception 'Booking Request capture provider is invalid' using errcode = 'RC409';
  end if;
  if work.state = 'complete' then
    return public.complete_booking_request_capture(target_booking_request_id, null, null, null);
  end if;
  leased_at := date_trunc('milliseconds', clock_timestamp());
  if work.state = 'processing' then
    return jsonb_build_object('status', case when leased_at < work.lease_expires_at then 'processing' else 'expired' end);
  end if;
  update public.booking_request_capture_work capture_work
  set state = 'processing', lease_generation = 1, lease_token = gen_random_uuid(),
    lease_expires_at = leased_at + interval '30 seconds'
  where capture_work.booking_request_id = work.booking_request_id
  returning * into work;
  return jsonb_build_object('status', 'leased', 'permit', source.binding || jsonb_build_object(
    'purpose', 'booking-request-capture', 'workId', work.booking_request_id,
    'leaseGeneration', work.lease_generation, 'leaseToken', work.lease_token,
    'notAfter', to_char(work.lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ));
end;
$$;
revoke all on function public.lease_booking_request_capture_work(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.lease_booking_request_capture_work(uuid,jsonb) to service_role;

create function public.execute_simulated_booking_request_capture(target_permit jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.simulated_payment_provider_operations;
declare expected_permit jsonb;
declare executed_at timestamptz;
declare execution_id uuid;
begin
  select * into source from public.lock_booking_request_capture_source((target_permit ->> 'bookingRequestId')::uuid);
  if not found then raise exception 'Booking Request capture permit is invalid' using errcode = 'RC409'; end if;
  work := source.work;
  ledger := source.ledger;
  expected_permit := source.binding || jsonb_build_object(
    'purpose', 'booking-request-capture', 'workId', work.booking_request_id,
    'leaseGeneration', work.lease_generation, 'leaseToken', work.lease_token,
    'notAfter', to_char(work.lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  if work.state <> 'processing' or target_permit is distinct from expected_permit
    or source.binding -> 'providerIdentity' is distinct from
      '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    or (ledger.id is not null and ledger.capture_execution_permit is distinct from target_permit) then
    raise exception 'Booking Request capture permit is invalid' using errcode = 'RC409';
  end if;
  executed_at := clock_timestamp();
  if executed_at >= work.lease_expires_at then return jsonb_build_object('outcome', 'not-executed'); end if;
  if ledger.id is null then
    execution_id := gen_random_uuid();
    insert into public.simulated_payment_provider_operations (
      id, claim_id, claim_generation, operation_kind, provider, environment, merchant_id, terminal_id,
      provider_idempotency_key, request_fingerprint, payment_lifecycle_id, logical_operation_id,
      physical_attempt_id, amount_fils, currency, original_outcome, current_outcome,
      provider_request_id, provider_reference, movement_reference,
      capture_execution_permit, created_at, updated_at
    ) values (
      execution_id, work.authorization_claim_id, work.authorization_claim_generation, 'capture',
      work.provider, work.environment, work.merchant_id, work.terminal_id,
      work.provider_idempotency_key, work.request_fingerprint, work.payment_lifecycle_id,
      work.capture_logical_operation_id, work.capture_physical_attempt_id, work.amount_fils,
      work.currency, 'succeeded', 'succeeded',
      'sim-capture-request-' || execution_id::text, 'sim-capture-reference-' || execution_id::text,
      'sim-capture-movement-' || execution_id::text, target_permit, executed_at, executed_at
    ) returning * into ledger;
  end if;
  return jsonb_build_object('outcome', 'succeeded', 'providerRequestId', ledger.provider_request_id,
    'providerReference', ledger.provider_reference, 'movementReference', ledger.movement_reference);
end;
$$;
revoke all on function public.execute_simulated_booking_request_capture(jsonb) from public, anon, authenticated;
grant execute on function public.execute_simulated_booking_request_capture(jsonb) to service_role;

create function public.complete_booking_request_capture(
  target_booking_request_id uuid, target_lease_generation bigint,
  target_lease_token uuid, target_provider_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.simulated_payment_provider_operations;
declare capture_identity public.booking_request_provider_operation_identities;
declare expected_permit jsonb;
declare expected_result jsonb;
declare capture_operation jsonb;
declare capture_movement jsonb;
declare movements jsonb;
declare captured_at text;
declare finalized_at timestamptz;
begin
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  if not found then raise exception 'Booking Request capture work is unavailable' using errcode = 'RC409'; end if;
  work := source.work;
  ledger := source.ledger;
  if ledger.id is null then raise exception 'Booking Request capture provider evidence is missing' using errcode = 'RC409'; end if;
  expected_result := jsonb_build_object('outcome', 'succeeded',
    'providerRequestId', ledger.provider_request_id, 'providerReference', ledger.provider_reference,
    'movementReference', ledger.movement_reference);
  if not (
    (work.state = 'complete' and target_lease_generation is null and target_lease_token is null and target_provider_result is null)
    or (target_lease_generation is not null and target_lease_token is not null
      and target_lease_generation = work.lease_generation
      and target_lease_generation = (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint
      and target_lease_token::text = ledger.capture_execution_permit ->> 'leaseToken'
      and target_provider_result is not distinct from expected_result)
  ) then
    raise exception 'Booking Request capture lease or result is invalid' using errcode = 'RC409';
  end if;
  if work.state = 'processing' then
    expected_permit := source.binding || jsonb_build_object(
      'purpose', 'booking-request-capture', 'workId', work.booking_request_id,
      'leaseGeneration', work.lease_generation, 'leaseToken', work.lease_token,
      'notAfter', to_char(work.lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
    if ledger.capture_execution_permit is distinct from expected_permit then
      raise exception 'Booking Request capture lease is stale' using errcode = 'RC409';
    end if;
  elsif work.state <> 'complete' then
    raise exception 'Booking Request capture work is not processing' using errcode = 'RC409';
  end if;
  if (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint is distinct from work.lease_generation
    or ledger.created_at >= (ledger.capture_execution_permit ->> 'notAfter')::timestamptz
    or ledger.created_at < (source.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz then
    raise exception 'Booking Request capture occurrence is invalid' using errcode = 'RC409';
  end if;
  captured_at := to_char(ledger.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  capture_operation := jsonb_build_object(
    'paymentLifecycleId', work.payment_lifecycle_id, 'kind', 'capture',
    'logicalOperationId', work.capture_logical_operation_id,
    'attemptId', work.capture_physical_attempt_id, 'status', 'succeeded',
    'amountFils', work.amount_fils, 'providerRequestId', ledger.provider_request_id,
    'providerReference', ledger.provider_reference, 'movementReference', ledger.movement_reference,
    'reconciliationRequired', false, 'retrySafe', false
  );
  capture_movement := jsonb_build_object(
    'kind', 'capture', 'logicalOperationId', work.capture_logical_operation_id,
    'attemptId', work.capture_physical_attempt_id, 'amountFils', work.amount_fils,
    'movementReference', ledger.movement_reference, 'recordedAt', captured_at
  );
  movements := jsonb_build_array(source.payment_snapshot #> '{movements,0}', capture_movement);
  select * into capture_identity from public.booking_request_provider_operation_identities identities
  where identities.attempt_id = work.attempt_id and identities.operation_kind = 'capture'
  for update of identities;
  if work.state = 'complete' then
    if source.payment_snapshot -> 'capture' is distinct from capture_operation
      or source.payment_snapshot -> 'movements' is distinct from movements
      or capture_identity.attempt_id is null
      or (capture_identity.provider, capture_identity.environment, capture_identity.merchant_id,
        capture_identity.terminal_id, capture_identity.provider_request_id,
        capture_identity.provider_reference, capture_identity.movement_reference) is distinct from
        (work.provider, work.environment, work.merchant_id, work.terminal_id,
        ledger.provider_request_id, ledger.provider_reference, ledger.movement_reference) then
      raise exception 'Completed Booking Request capture evidence is invalid' using errcode = 'RC409';
    end if;
  else
    insert into public.booking_request_provider_operation_identities (
      attempt_id, operation_kind, provider, environment, merchant_id, terminal_id,
      provider_request_id, provider_reference, movement_reference
    ) values (work.attempt_id, 'capture', work.provider, work.environment, work.merchant_id,
      work.terminal_id, ledger.provider_request_id, ledger.provider_reference, ledger.movement_reference);
    finalized_at := clock_timestamp();
    -- The existing work trigger validates uncaptured Authorization; both writes commit atomically.
    update public.booking_request_capture_work capture_work
    set state = 'complete', outcome = 'succeeded', completed_at = finalized_at,
      lease_token = null, lease_expires_at = null
    where capture_work.booking_request_id = work.booking_request_id;
    update public.booking_request_submission_attempts attempts
    set payment_snapshot = source.payment_snapshot || jsonb_build_object('capture', capture_operation, 'movements', movements),
      updated_at = finalized_at
    where attempts.id = work.attempt_id;
  end if;
  return jsonb_build_object('status', 'complete',
    'snapshot', source.binding || jsonb_build_object(
      'authorization', source.payment_snapshot -> 'authorization', 'capture', capture_operation, 'movements', movements),
    'expectation', source.binding || jsonb_build_object(
      'authorizationProviderResult', jsonb_build_object(
        'providerRequestId', source.payment_snapshot #>> '{authorization,providerRequestId}',
        'providerReference', source.payment_snapshot #>> '{authorization,providerReference}',
        'movementReference', source.payment_snapshot #>> '{authorization,movementReference}'),
      'captureProviderResult', expected_result - 'outcome',
      'authorizationRecordedAt', source.payment_snapshot #>> '{movements,0,recordedAt}',
      'captureRecordedAt', captured_at)
  );
end;
$$;
revoke all on function public.complete_booking_request_capture(uuid,bigint,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.complete_booking_request_capture(uuid,bigint,uuid,jsonb) to service_role;
