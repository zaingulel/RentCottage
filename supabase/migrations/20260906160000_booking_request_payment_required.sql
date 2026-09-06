alter table public.booking_request_capture_work
  add column payment_required_recorded_at timestamptz,
  add column payment_required_deadline timestamptz;

do $$
declare state_constraint text;
begin
  select constraints.conname into state_constraint
  from pg_constraint constraints
  where constraints.conrelid = 'public.booking_request_capture_work'::regclass
    and constraints.contype = 'c'
    and pg_get_constraintdef(constraints.oid) like '%state = ''queued''%';
  if state_constraint is null then
    raise exception 'Booking Request capture-work state constraint is missing';
  end if;
  execute format('alter table public.booking_request_capture_work drop constraint %I', state_constraint);
end;
$$;

alter table public.booking_request_capture_work
  add constraint booking_request_capture_work_state_shape check (
    (state = 'queued'
      and lease_generation = 0 and lease_token is null and lease_expires_at is null
      and outcome is null and completed_at is null
      and payment_required_recorded_at is null and payment_required_deadline is null)
    or (state = 'processing'
      and lease_generation > 0 and lease_token is not null and lease_expires_at is not null
      and outcome is null and completed_at is null
      and payment_required_recorded_at is null and payment_required_deadline is null)
    or (state = 'complete'
      and lease_generation > 0 and lease_token is null and lease_expires_at is null
      and outcome is not null and outcome = 'succeeded' and completed_at is not null
      and payment_required_recorded_at is null and payment_required_deadline is null)
    or (state = 'payment_required'
      and lease_generation > 0 and lease_token is not null and lease_expires_at is not null
      and outcome is not null and outcome = 'failed' and completed_at is not null
      and payment_required_recorded_at is not null and payment_required_deadline is not null
      and payment_required_deadline = payment_required_recorded_at + interval '20 minutes')
  );

drop trigger enforce_booking_request_capture_work on public.booking_request_capture_work;
create trigger enforce_booking_request_capture_work_insert
before insert on public.booking_request_capture_work
for each row execute function public.enforce_booking_request_capture_work();
create trigger enforce_booking_request_capture_work_update
before update on public.booking_request_capture_work
for each row when (old.state <> 'payment_required' and new.state <> 'payment_required')
execute function public.enforce_booking_request_capture_work();

create function public.enforce_booking_request_payment_required()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.state = 'payment_required' and new is distinct from old then
    raise exception 'Payment Required capture work is immutable' using errcode = 'RC204';
  end if;
  if old.state <> 'processing' or new.state <> 'payment_required'
    or (to_jsonb(new) - array['state','outcome','completed_at','payment_required_recorded_at','payment_required_deadline'])
      is distinct from
      (to_jsonb(old) - array['state','outcome','completed_at','payment_required_recorded_at','payment_required_deadline'])
    or new.outcome <> 'failed'
    or new.completed_at is distinct from new.payment_required_recorded_at
    or new.payment_required_recorded_at is distinct from date_trunc('milliseconds', new.payment_required_recorded_at)
    or new.payment_required_deadline is distinct from new.payment_required_recorded_at + interval '20 minutes' then
    raise exception 'Payment Required capture transition is invalid' using errcode = 'RC204';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_booking_request_payment_required()
  from public, anon, authenticated, service_role;
create trigger enforce_booking_request_payment_required
before update on public.booking_request_capture_work
for each row when (old.state = 'payment_required' or new.state = 'payment_required')
execute function public.enforce_booking_request_payment_required();

alter table public.booking_request_status_notifications
  drop constraint booking_request_status_notifications_status_check,
  add constraint booking_request_status_notifications_status_check
    check (status in ('accepted','declined','withdrawn','expired','payment-required'));

create or replace function public.complete_booking_request_capture(
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
  if ledger.original_outcome is distinct from 'succeeded'
    or ledger.current_outcome is distinct from 'succeeded'
    or ledger.movement_reference is null then
    raise exception 'Booking Request successful Capture evidence is invalid' using errcode = 'RC409';
  end if;
  expected_result := jsonb_build_object('outcome', 'succeeded',
    'providerRequestId', ledger.provider_request_id, 'providerReference', ledger.provider_reference,
    'movementReference', ledger.movement_reference);
  if not (
    (work.state = 'complete' and target_lease_generation is null and target_lease_token is null and target_provider_result is null)
    or (target_lease_generation is not null and target_lease_token is not null
      and target_lease_generation = work.lease_generation
      and (
        (work.recovery_operation_id is null
          and target_lease_generation = (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint
          and target_lease_token::text = ledger.capture_execution_permit ->> 'leaseToken')
        or (work.state = 'processing' and work.recovery_operation_id = ledger.id
          and target_lease_token = work.lease_token
          and work.lease_generation > (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint)
      )
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
    if work.recovery_operation_id is null and ledger.capture_execution_permit is distinct from expected_permit then
      raise exception 'Booking Request capture lease is stale' using errcode = 'RC409';
    end if;
  elsif work.state <> 'complete' then
    raise exception 'Booking Request capture work is not processing' using errcode = 'RC409';
  end if;
  if (work.recovery_operation_id is null and (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint is distinct from work.lease_generation)
    or (work.recovery_operation_id is not null and (work.recovery_operation_id <> ledger.id
      or work.lease_generation <= (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint))
    or (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint < 1
    or (ledger.capture_execution_permit ->> 'leaseToken')::uuid is null
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

create or replace function public.lock_booking_request_capture_source(target_booking_request_id uuid)
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
      ledger.amount_fils, ledger.currency, ledger.request_fingerprint) is distinct from
      (work.authorization_claim_id, work.authorization_claim_generation, 'capture'::text,
      work.payment_lifecycle_id, work.capture_logical_operation_id, work.capture_physical_attempt_id,
      work.amount_fils, work.currency, work.request_fingerprint)
    or not (
      (ledger.original_outcome = 'succeeded' and ledger.current_outcome = 'succeeded'
        and ledger.movement_reference is not null)
      or (ledger.original_outcome = 'failed' and ledger.current_outcome = 'failed'
        and ledger.movement_reference is null)
    )
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



create function public.execute_simulated_booking_request_capture(
  target_permit jsonb, target_outcome text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.simulated_payment_provider_operations;
declare expected_permit jsonb;
declare executed_at timestamptz;
declare execution_id uuid;
begin
  if target_outcome is null or target_outcome not in ('succeeded', 'failed') then
    raise exception 'Booking Request capture outcome is invalid' using errcode = 'RC409';
  end if;
  select * into source from public.lock_booking_request_capture_source(
    (target_permit ->> 'bookingRequestId')::uuid
  );
  if not found then raise exception 'Booking Request capture permit is invalid' using errcode = 'RC409'; end if;
  work := source.work;
  ledger := source.ledger;
  expected_permit := source.binding || jsonb_build_object(
    'purpose', 'booking-request-capture', 'workId', work.booking_request_id,
    'leaseGeneration', work.lease_generation, 'leaseToken', work.lease_token,
    'notAfter', to_char(work.lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  if work.state <> 'processing' or target_permit is distinct from expected_permit
    or expected_permit -> 'providerIdentity' is distinct from
      '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    or (ledger.id is not null and ledger.capture_execution_permit is distinct from target_permit) then
    raise exception 'Booking Request capture permit is invalid' using errcode = 'RC409';
  end if;
  executed_at := clock_timestamp();
  if executed_at >= work.lease_expires_at then
    return jsonb_build_object('outcome', 'not-executed');
  end if;
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
      work.currency, target_outcome, target_outcome,
      'sim-capture-request-' || execution_id::text, 'sim-capture-reference-' || execution_id::text,
      case when target_outcome = 'succeeded' then 'sim-capture-movement-' || execution_id::text end,
      target_permit, executed_at, executed_at
    ) returning * into ledger;
  end if;
  if ledger.original_outcome = 'failed' then
    return jsonb_build_object('outcome', 'failed', 'providerRequestId', ledger.provider_request_id,
      'providerReference', ledger.provider_reference, 'retrySafe', false);
  end if;
  return jsonb_build_object('outcome', 'succeeded', 'providerRequestId', ledger.provider_request_id,
    'providerReference', ledger.provider_reference, 'movementReference', ledger.movement_reference);
end;
$$;
revoke all on function public.execute_simulated_booking_request_capture(jsonb,text)
  from public, anon, authenticated;
grant execute on function public.execute_simulated_booking_request_capture(jsonb,text) to service_role;

create or replace function public.execute_simulated_booking_request_capture(target_permit jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select public.execute_simulated_booking_request_capture(target_permit, 'succeeded');
$$;
revoke all on function public.execute_simulated_booking_request_capture(jsonb)
  from public, anon, authenticated;
grant execute on function public.execute_simulated_booking_request_capture(jsonb) to service_role;

create or replace function public.query_simulated_booking_request_capture(
  target_operation jsonb, target_provider_request_id text, target_provider_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare request_id uuid;
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.simulated_payment_provider_operations;
declare expected_operation jsonb;
begin
  select booking_request_id into request_id from public.booking_request_capture_work
  where payment_lifecycle_id::text = target_operation ->> 'paymentLifecycleId';
  select * into source from public.lock_booking_request_capture_source(request_id);
  if not found then raise exception 'Capture query binding is invalid' using errcode = 'RC409'; end if;
  work := source.work;
  ledger := source.ledger;
  expected_operation := jsonb_build_object(
    'providerIdentity', source.binding -> 'providerIdentity', 'requestFingerprint', work.request_fingerprint,
    'paymentLifecycleId', work.payment_lifecycle_id, 'logicalOperationId', work.capture_logical_operation_id,
    'physicalAttemptId', work.capture_physical_attempt_id, 'operationKind', 'capture',
    'amountFils', work.amount_fils, 'currency', work.currency
  );
  if target_operation is distinct from expected_operation or ledger.id is null
    or target_provider_request_id is distinct from ledger.provider_request_id
    or target_provider_reference is distinct from ledger.provider_reference
    or (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint < 1
    or (ledger.capture_execution_permit ->> 'leaseToken')::uuid is null
    or ledger.created_at >= (ledger.capture_execution_permit ->> 'notAfter')::timestamptz
    or ledger.created_at < (source.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz then
    raise exception 'Capture query evidence is invalid' using errcode = 'RC409';
  end if;
  if ledger.original_outcome = 'failed' then
    return jsonb_build_object('outcome', 'failed', 'providerRequestId', ledger.provider_request_id,
      'providerReference', ledger.provider_reference, 'retrySafe', false);
  end if;
  return jsonb_build_object('outcome', 'succeeded', 'providerRequestId', ledger.provider_request_id,
    'providerReference', ledger.provider_reference, 'movementReference', ledger.movement_reference);
end;
$$;

create function public.record_booking_request_capture_failure(
  target_booking_request_id uuid, target_lease_generation bigint,
  target_lease_token uuid, target_provider_result jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare target_request public.booking_requests;
declare work public.booking_request_capture_work;
declare target_attempt public.booking_request_submission_attempts;
declare target_claim public.booking_request_authorization_claims;
declare ledger public.simulated_payment_provider_operations;
declare target_commitment public.cottage_booking_period_commitments;
declare recorded_at timestamptz;
begin
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  if not found then raise exception 'Booking Request definitive Capture failure evidence is invalid' using errcode='RC409'; end if;
  work := source.work;
  ledger := source.ledger;
  select * into target_request from public.booking_requests requests
  where requests.id = target_booking_request_id;
  select * into target_attempt from public.booking_request_submission_attempts attempts
  where attempts.id = work.attempt_id;
  select * into target_claim from public.booking_request_authorization_claims claims
  where claims.id = work.authorization_claim_id;
  select * into target_commitment from public.cottage_booking_period_commitments commitments
  where commitments.id = target_request.booking_period_commitment_id for update of commitments;
  perform 1 from public.cottage_inventory_commitments inventory
  where inventory.booking_period_commitment_id = target_commitment.id
  order by inventory.service_day, inventory.unit_kind, inventory.unit_id for update of inventory;
  perform 1 from public.cottage_booking_period_occupancies occupancies
  where occupancies.booking_period_commitment_id = target_commitment.id
  order by occupancies.service_day, occupancies.shift_id for update of occupancies;

  if ledger.id is null or ledger.original_outcome is distinct from 'failed'
    or ledger.current_outcome is distinct from 'failed' or ledger.movement_reference is not null
    or (ledger.capture_execution_permit->>'leaseGeneration')::bigint < 1
    or (ledger.capture_execution_permit->>'leaseToken')::uuid is null
    or ledger.created_at >= (ledger.capture_execution_permit ->> 'notAfter')::timestamptz
    or ledger.created_at < (target_attempt.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz then
    raise exception 'Booking Request definitive Capture failure evidence is invalid' using errcode = 'RC409';
  end if;
  if work.state = 'payment_required' then
    if target_lease_generation is distinct from work.lease_generation
      or target_lease_token is distinct from work.lease_token
      or target_provider_result is distinct from jsonb_build_object('outcome','failed',
        'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,'retrySafe',false) then
      raise exception 'Payment Required replay evidence is invalid' using errcode = 'RC409';
    end if;
    return jsonb_build_object('status','payment-required','paymentRequiredWindow',jsonb_build_object(
      'recordedAt',to_char(work.payment_required_recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deadline',to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  end if;

  if target_request.id is null or target_request.status <> 'accepted'
    or work.state <> 'processing' or target_attempt.id is null or target_claim.id is null
    or target_lease_generation is distinct from work.lease_generation
    or target_lease_token is distinct from work.lease_token
    or clock_timestamp() >= work.lease_expires_at
    or (ledger.claim_id,ledger.claim_generation,ledger.operation_kind,ledger.payment_lifecycle_id,
      ledger.logical_operation_id,ledger.physical_attempt_id,ledger.amount_fils,ledger.currency,
      ledger.request_fingerprint) is distinct from
      (work.authorization_claim_id,work.authorization_claim_generation,'capture'::text,work.payment_lifecycle_id,
      work.capture_logical_operation_id,work.capture_physical_attempt_id,work.amount_fils,work.currency,
      work.request_fingerprint)
    or (work.recovery_operation_id is null and (
      work.lease_generation is distinct from (ledger.capture_execution_permit->>'leaseGeneration')::bigint
      or work.lease_token::text is distinct from ledger.capture_execution_permit->>'leaseToken'
      or ledger.capture_execution_permit is distinct from source.binding || jsonb_build_object(
        'purpose','booking-request-capture','workId',work.booking_request_id,
        'leaseGeneration',work.lease_generation,'leaseToken',work.lease_token,
        'notAfter',to_char(work.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
    or (work.recovery_operation_id is not null and (
      work.recovery_operation_id <> ledger.id
      or work.lease_generation <= (ledger.capture_execution_permit->>'leaseGeneration')::bigint))
    or target_provider_result is distinct from jsonb_build_object('outcome','failed',
      'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,'retrySafe',false)
    or target_attempt.booking_request_id is distinct from target_request.id
    or not target_attempt.intent_dedupe_active
    or target_attempt.payment_snapshot -> 'capture' is distinct from 'null'::jsonb
    or jsonb_array_length(target_attempt.payment_snapshot -> 'movements') <> 1
    or target_claim.attempt_id <> target_attempt.id or target_claim.state <> 'converted'
    or target_commitment.id is null or target_commitment.status <> 'pending_hold'
    or exists (select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id = target_request.id)
    or exists (select 1 from public.booking_request_provider_operation_identities identities
      where identities.attempt_id = target_attempt.id and identities.operation_kind = 'capture')
    or (select count(*) from public.simulated_payment_provider_operations operations
      where operations.payment_lifecycle_id = work.payment_lifecycle_id
        and operations.logical_operation_id = work.capture_logical_operation_id) <> 1
    or not exists (
      select 1 from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
    )
    or not exists (
      select 1 from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
    )
    or exists (
      select claim_items.unit_kind, claim_items.unit_id, claim_items.service_day, claim_items.price_iqd
      from public.booking_request_authorization_claim_items claim_items where claim_items.claim_id = target_claim.id
      except
      select inventory.unit_kind, inventory.unit_id, inventory.service_day, inventory.committed_price_iqd
      from public.cottage_inventory_commitments inventory where inventory.booking_period_commitment_id = target_commitment.id)
    or exists (
      select inventory.unit_kind, inventory.unit_id, inventory.service_day, inventory.committed_price_iqd
      from public.cottage_inventory_commitments inventory where inventory.booking_period_commitment_id = target_commitment.id
      except
      select claim_items.unit_kind, claim_items.unit_id, claim_items.service_day, claim_items.price_iqd
      from public.booking_request_authorization_claim_items claim_items where claim_items.claim_id = target_claim.id)
    or exists (
      select claim_occupancies.schedule_revision_id, claim_occupancies.shift_id, claim_occupancies.service_day
      from public.booking_request_authorization_claim_occupancies claim_occupancies where claim_occupancies.claim_id = target_claim.id
      except
      select occupancies.schedule_revision_id, occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id and occupancies.active)
    or exists (
      select occupancies.schedule_revision_id, occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id and occupancies.active
      except
      select claim_occupancies.schedule_revision_id, claim_occupancies.shift_id, claim_occupancies.service_day
      from public.booking_request_authorization_claim_occupancies claim_occupancies where claim_occupancies.claim_id = target_claim.id)
    or exists (
      select target_claim.schedule_revision_id, expected.shift_id,
        claim_items.service_day
      from public.booking_request_authorization_claim_items claim_items
      cross join lateral (
        select claim_items.unit_id as shift_id
        where claim_items.unit_kind = 'shift'
        union all
        select shifts.id
        from public.cottage_shifts shifts
        where claim_items.unit_kind = 'full_day_bundle'
          and shifts.schedule_revision_id = target_claim.schedule_revision_id
      ) expected
      where claim_items.claim_id = target_claim.id
      except
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
    )
    or exists (
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
      except
      select target_claim.schedule_revision_id, expected.shift_id,
        claim_items.service_day
      from public.booking_request_authorization_claim_items claim_items
      cross join lateral (
        select claim_items.unit_id as shift_id
        where claim_items.unit_kind = 'shift'
        union all
        select shifts.id
        from public.cottage_shifts shifts
        where claim_items.unit_kind = 'full_day_bundle'
          and shifts.schedule_revision_id = target_claim.schedule_revision_id
      ) expected
      where claim_items.claim_id = target_claim.id
    )
    or exists (select 1 from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id and not occupancies.active) then
    raise exception 'Booking Request definitive Capture failure evidence is invalid' using errcode = 'RC409';
  end if;

  recorded_at := date_trunc('milliseconds', clock_timestamp());
  update public.booking_request_capture_work capture_work
  set state = 'payment_required', outcome = 'failed', completed_at = recorded_at,
    payment_required_recorded_at = recorded_at,
    payment_required_deadline = recorded_at + interval '20 minutes'
  where capture_work.booking_request_id = work.booking_request_id returning * into work;
  insert into public.booking_request_status_notifications(
    booking_request_id, recipient_user_id, status, created_at
  ) values (target_request.id, target_request.customer_user_id, 'payment-required', recorded_at)
  on conflict do nothing;
  return jsonb_build_object('status','payment-required','paymentRequiredWindow',jsonb_build_object(
    'recordedAt',to_char(work.payment_required_recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deadline',to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
end;
$$;
revoke all on function public.record_booking_request_capture_failure(uuid,bigint,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_booking_request_capture_failure(uuid,bigint,uuid,jsonb) to service_role;

create or replace function public.claim_due_booking_request_captures(target_limit integer, target_provider_identity jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare candidate record;
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.simulated_payment_provider_operations;
declare claimed_at timestamptz;
declare results jsonb := '[]'::jsonb;
begin
  if target_limit is null or target_limit < 1 or target_limit > 50
    or target_provider_identity is null
    or jsonb_typeof(target_provider_identity) <> 'object'
    or not target_provider_identity ?& array['provider','environment','merchantId','terminalId']
    or target_provider_identity - array['provider','environment','merchantId','terminalId'] <> '{}'::jsonb
    or exists (select 1 from jsonb_each(target_provider_identity) fields
      where jsonb_typeof(fields.value) <> 'string' or btrim(fields.value #>> '{}') = '') then
    raise exception 'Capture recovery selection is invalid' using errcode = 'RC409';
  end if;
  for candidate in
    select requests.id from public.booking_requests requests
    join public.booking_request_capture_work capture_work on capture_work.booking_request_id = requests.id
    where requests.status = 'accepted'
      and capture_work.provider = target_provider_identity ->> 'provider'
      and capture_work.environment = target_provider_identity ->> 'environment'
      and capture_work.merchant_id = target_provider_identity ->> 'merchantId'
      and capture_work.terminal_id = target_provider_identity ->> 'terminalId'
      and (capture_work.state = 'complete' or (capture_work.state = 'processing' and capture_work.lease_expires_at <= clock_timestamp()))
      and not exists (select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id = requests.id)
    -- Existing execution evidence must progress beyond unavailable crash-window rows.
    order by case when capture_work.state = 'complete' or exists (
      select 1 from public.simulated_payment_provider_operations operations
      where (operations.provider, operations.environment, operations.merchant_id, operations.terminal_id,
        operations.provider_idempotency_key, operations.claim_id, operations.claim_generation,
        operations.payment_lifecycle_id, operations.logical_operation_id, operations.physical_attempt_id,
        operations.operation_kind, operations.request_fingerprint, operations.amount_fils, operations.currency) =
        (capture_work.provider, capture_work.environment, capture_work.merchant_id, capture_work.terminal_id,
        capture_work.provider_idempotency_key, capture_work.authorization_claim_id, capture_work.authorization_claim_generation,
        capture_work.payment_lifecycle_id, capture_work.capture_logical_operation_id, capture_work.capture_physical_attempt_id,
        'capture', capture_work.request_fingerprint, capture_work.amount_fils, capture_work.currency)
    ) then 0 else 1 end, capture_work.created_at, requests.id
    limit target_limit for update of requests skip locked
  loop
    select * into source from public.lock_booking_request_capture_source(candidate.id);
    work := source.work;
    ledger := source.ledger;
    claimed_at := date_trunc('milliseconds', clock_timestamp());
    if exists (select 1 from public.booking_confirmations where booking_request_id = candidate.id) then continue; end if;
    if work.state = 'complete' then
      results := results || jsonb_build_array(public.complete_booking_request_capture(candidate.id, null, null, null));
      continue;
    end if;
    if work.state <> 'processing' or work.lease_expires_at > claimed_at then continue; end if;
    if ledger.id is null then
      results := results || jsonb_build_array(jsonb_build_object('status', 'unavailable'));
      continue;
    end if;
    if (work.recovery_operation_id is null and (
        work.lease_generation is distinct from (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint
        or work.lease_token::text is distinct from ledger.capture_execution_permit ->> 'leaseToken'))
      or (work.recovery_operation_id is not null and (
        work.recovery_operation_id <> ledger.id
        or work.lease_generation <= (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint))
      or (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint < 1
      or (ledger.capture_execution_permit ->> 'leaseToken')::uuid is null
      or ledger.created_at >= (ledger.capture_execution_permit ->> 'notAfter')::timestamptz
      or ledger.created_at < (source.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz then
      raise exception 'Capture recovery execution evidence is invalid' using errcode = 'RC409';
    end if;
    update public.booking_request_capture_work capture_work
    set lease_generation = capture_work.lease_generation + 1, lease_token = gen_random_uuid(),
      lease_expires_at = claimed_at + interval '30 seconds', recovery_operation_id = ledger.id
    where capture_work.booking_request_id = candidate.id returning * into work;
    results := results || jsonb_build_array(jsonb_build_object('status', 'reconcile', 'lease', source.binding || jsonb_build_object(
      'workId', work.booking_request_id, 'leaseGeneration', work.lease_generation,
      'leaseToken', work.lease_token,
      'notAfter', to_char(work.lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'recoveryOperationId', work.recovery_operation_id,
      'providerResult', jsonb_build_object('providerRequestId', ledger.provider_request_id,
        'providerReference', ledger.provider_reference) || case when ledger.original_outcome = 'succeeded'
          then jsonb_build_object('movementReference', ledger.movement_reference) else '{}'::jsonb end
    )));
  end loop;
  return results;
end;
$$;

create or replace function public.lease_booking_request_capture_work(
  target_booking_request_id uuid, target_provider_identity jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record; declare work public.booking_request_capture_work; declare leased_at timestamptz;
begin
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  if not found then return jsonb_build_object('status','unavailable'); end if;
  work := source.work;
  if target_provider_identity is distinct from source.binding -> 'providerIdentity' then
    raise exception 'Booking Request capture provider is invalid' using errcode = 'RC409';
  end if;
  if work.state = 'payment_required' then
    return jsonb_build_object('status','payment-required','paymentRequiredWindow',jsonb_build_object(
      'recordedAt',to_char(work.payment_required_recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deadline',to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  end if;
  if work.state = 'complete' then return public.complete_booking_request_capture(target_booking_request_id,null,null,null); end if;
  leased_at := date_trunc('milliseconds',clock_timestamp());
  if work.state = 'processing' then
    return jsonb_build_object('status',case when leased_at < work.lease_expires_at then 'processing' else 'expired' end);
  end if;
  update public.booking_request_capture_work capture_work
  set state='processing',lease_generation=1,lease_token=gen_random_uuid(),lease_expires_at=leased_at+interval '30 seconds'
  where capture_work.booking_request_id=work.booking_request_id returning * into work;
  return jsonb_build_object('status','leased','permit',source.binding || jsonb_build_object(
    'purpose','booking-request-capture','workId',work.booking_request_id,'leaseGeneration',work.lease_generation,
    'leaseToken',work.lease_token,'notAfter',to_char(work.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
end;
$$;

create or replace function public.booking_request_payment_status(target_request public.booking_requests)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case when target_request.status = 'accepted' then case
      when exists (
        select 1 from public.booking_confirmations confirmations
        join public.cottage_booking_period_commitments commitments on commitments.id = confirmations.booking_period_commitment_id
        join public.booking_request_capture_work capture_work on capture_work.booking_request_id = confirmations.booking_request_id
        where confirmations.booking_request_id = target_request.id
          and confirmations.booking_snapshot_id = target_request.booking_snapshot_id
          and confirmations.booking_period_commitment_id = target_request.booking_period_commitment_id
          and commitments.status = 'confirmed_booking' and capture_work.state = 'complete'
      ) then 'paid-confirmed'
      when exists (select 1 from public.booking_request_capture_work capture_work
        where capture_work.booking_request_id = target_request.id and capture_work.state = 'payment_required')
        then 'payment-required'
      when exists (select 1 from public.booking_request_capture_work capture_work where capture_work.booking_request_id = target_request.id)
        then 'capture-processing'
      end end;
$$;

create function public.booking_request_payment_required_window(target_request public.booking_requests)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when target_request.status='accepted' and work.state='payment_required' then jsonb_build_object(
    'recordedAt',to_char(work.payment_required_recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deadline',to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'databaseNow',to_char(date_trunc('milliseconds',clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end
  from public.booking_request_capture_work work where work.booking_request_id=target_request.id;
$$;
revoke all on function public.booking_request_payment_required_window(public.booking_requests)
  from public, anon, authenticated, service_role;

create or replace function public.get_customer_booking_request(target_reference text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',requests.id,'bookingRequestReference',requests.booking_request_reference,
    'status',requests.status,'paymentStatus',public.booking_request_payment_status(requests),
    'paymentRequiredWindow',public.booking_request_payment_required_window(requests),
    'cottageName',snapshots.quote_payload->>'cottageName','bookingPeriod',snapshots.quote_payload->'items',
    'partySize',requests.party_size,'bookingPriceIqd',(snapshots.quote_payload->>'bookingPriceIqd')::bigint,
    'serviceFeeIqd',(snapshots.quote_payload->>'serviceFeeIqd')::bigint,
    'customerTotalIqd',(snapshots.quote_payload->>'customerTotalIqd')::bigint,
    'responseDeadline',to_char(requests.response_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'declineReason',requests.decline_reason,'declineNote',requests.decline_note,
    'statusNotifications',coalesce((select jsonb_agg(jsonb_build_object('id',receipts.id,'status',receipts.status,
      'createdAt',to_char(receipts.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by receipts.created_at)
      from public.booking_request_status_notifications receipts where receipts.booking_request_id=requests.id
        and receipts.recipient_user_id=(select auth.uid())),'[]'::jsonb))
  from public.booking_requests requests join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id
  where requests.booking_request_reference=target_reference and requests.customer_user_id=(select auth.uid())
    and exists(select 1 from public.account_contexts contexts where contexts.user_id=(select auth.uid()) and contexts.role='customer');
$$;

create or replace function public.list_owner_booking_request_notifications()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',requests.id,'bookingRequestReference',requests.booking_request_reference,
    'status',requests.status,'paymentStatus',public.booking_request_payment_status(requests),
    'paymentRequiredWindow',public.booking_request_payment_required_window(requests),
    'customerName',requests.customer_name,'partySize',requests.party_size,'bookingNote',requests.booking_note,
    'cottageName',snapshots.quote_payload->>'cottageName','bookingPeriod',snapshots.quote_payload->'items',
    'bookingPriceIqd',(snapshots.quote_payload->>'bookingPriceIqd')::bigint,
    'marketplaceCommissionFils',snapshots.marketplace_commission_amount_fils,
    'ownerNetFils',(snapshots.quote_payload->>'bookingPriceIqd')::bigint*1000-snapshots.marketplace_commission_amount_fils,
    'houseRules',snapshots.quote_payload->>'houseRules','bookingTermsVersion',snapshots.booking_terms_version,
    'cancellationPolicyVersion',snapshots.cancellation_policy_version,
    'statusNotifications',coalesce((select jsonb_agg(jsonb_build_object('id',receipts.id,'status',receipts.status,
      'createdAt',to_char(receipts.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by receipts.created_at)
      from public.booking_request_status_notifications receipts where receipts.booking_request_id=requests.id
        and receipts.recipient_user_id=(select auth.uid())),'[]'::jsonb),
    'responseDeadline',to_char(requests.response_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt',to_char(notifications.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by notifications.created_at desc),'[]'::jsonb)
  from public.owner_request_notifications notifications
  join public.booking_requests requests on requests.id=notifications.booking_request_id
  join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id
  where notifications.owner_user_id=(select auth.uid()) and exists(select 1 from public.account_contexts contexts
    where contexts.user_id=(select auth.uid()) and contexts.role='cottage_owner' and contexts.owner_approval_state='approved');
$$;
