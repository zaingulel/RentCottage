-- Recovery ownership refers to the original execution; it never grants execution authority.
-- Rollback stops/revokes recovery entry points; retain this completion authority for already recovered evidence.
alter table public.booking_request_capture_work
  add column recovery_operation_id uuid references public.simulated_payment_provider_operations(id) on delete restrict;

create function public.claim_due_booking_request_captures(target_limit integer, target_provider_identity jsonb)
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
    order by capture_work.created_at, requests.id
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
        'providerReference', ledger.provider_reference, 'movementReference', ledger.movement_reference)
    )));
  end loop;
  return results;
end;
$$;
revoke all on function public.claim_due_booking_request_captures(integer,jsonb) from public, anon, authenticated;
grant execute on function public.claim_due_booking_request_captures(integer,jsonb) to service_role;

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
revoke all on function public.complete_booking_request_capture(uuid,bigint,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.complete_booking_request_capture(uuid,bigint,uuid,jsonb) to service_role;

create function public.query_simulated_booking_request_capture(
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
  return jsonb_build_object('outcome', 'succeeded', 'providerRequestId', ledger.provider_request_id,
    'providerReference', ledger.provider_reference, 'movementReference', ledger.movement_reference);
end;
$$;
revoke all on function public.query_simulated_booking_request_capture(jsonb,text,text) from public, anon, authenticated;
grant execute on function public.query_simulated_booking_request_capture(jsonb,text,text) to service_role;
