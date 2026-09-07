create table public.booking_request_payment_recovery_attempts (
  id uuid primary key default gen_random_uuid(),
  booking_request_id uuid not null references public.booking_requests(id) on delete restrict,
  command_key uuid not null,
  generation integer not null check (generation > 0),
  replacement_method text not null check (replacement_method = 'simulated-replacement'),
  state text not null check (state in (
    'admitted','original_released','replacement_authorized','capture_failed',
    'blocked','safely_failed','succeeded','late_succeeded'
  )),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (booking_request_id, command_key),
  unique (booking_request_id, generation)
);

create unique index booking_request_payment_recovery_one_active
  on public.booking_request_payment_recovery_attempts(booking_request_id)
  where state not in ('safely_failed');

alter table public.simulated_payment_provider_operations
  add column recovery_attempt_id uuid
    references public.booking_request_payment_recovery_attempts(id) on delete restrict,
  add column authoritative_outcome_at timestamptz;

alter table public.simulated_payment_provider_operations
  drop constraint simulated_capture_execution_permit_check,
  add constraint simulated_capture_execution_permit_check check (
    (operation_kind='capture' and capture_execution_permit is not null
      and jsonb_typeof(capture_execution_permit)='object' and (
        (capture_execution_permit @> '{"purpose":"booking-request-capture"}'::jsonb
          and capture_execution_permit ?& array[
            'purpose','bookingRequestId','submissionAttemptId','authorizationClaimId',
            'authorizationClaimGeneration','paymentLifecycleId','authorizationLogicalOperationId',
            'authorizationPhysicalAttemptId','captureLogicalOperationId','capturePhysicalAttemptId',
            'amountFils','currency','providerIdentity','idempotencyKey','requestFingerprint',
            'workId','leaseGeneration','leaseToken','notAfter']
          and capture_execution_permit - array[
            'purpose','bookingRequestId','submissionAttemptId','authorizationClaimId',
            'authorizationClaimGeneration','paymentLifecycleId','authorizationLogicalOperationId',
            'authorizationPhysicalAttemptId','captureLogicalOperationId','capturePhysicalAttemptId',
            'amountFils','currency','providerIdentity','idempotencyKey','requestFingerprint',
            'workId','leaseGeneration','leaseToken','notAfter']='{}'::jsonb
          and jsonb_strip_nulls(capture_execution_permit)=capture_execution_permit
          and jsonb_typeof(capture_execution_permit->'providerIdentity')='object'
          and capture_execution_permit->'providerIdentity' ?& array['provider','environment','merchantId','terminalId']
          and (capture_execution_permit->'providerIdentity')-array['provider','environment','merchantId','terminalId']='{}'::jsonb)
        or (capture_execution_permit @> '{"purpose":"booking-request-payment-recovery","step":"replacement-capture"}'::jsonb
          and capture_execution_permit ?& array['purpose','attemptId','generation','step','operationId','idempotencyKey','notAfter','binding']
          and capture_execution_permit-array['purpose','attemptId','generation','step','operationId','idempotencyKey','notAfter','binding']='{}'::jsonb
          and jsonb_strip_nulls(capture_execution_permit)=capture_execution_permit)
      )) or (operation_kind<>'capture' and capture_execution_permit is null)
  );

create table public.booking_request_payment_recovery_operations (
  id uuid primary key default gen_random_uuid(),
  recovery_attempt_id uuid not null
    references public.booking_request_payment_recovery_attempts(id) on delete restrict,
  step text not null check (step in (
    'original-release','replacement-authorization','replacement-capture','replacement-release'
  )),
  operation_generation integer not null default 1 check (operation_generation = 1),
  provider_operation_id uuid not null unique
    references public.simulated_payment_provider_operations(id) on delete restrict,
  outcome text not null check (outcome in ('succeeded','failed','indeterminate')),
  authoritative_outcome_at timestamptz,
  execution_permit jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint recovery_operation_identity_unique
    unique (recovery_attempt_id, step, operation_generation),
  check ((outcome = 'indeterminate') = (authoritative_outcome_at is null))
);

alter table public.booking_request_payment_recovery_attempts enable row level security;
alter table public.booking_request_payment_recovery_operations enable row level security;
revoke all on public.booking_request_payment_recovery_attempts,
  public.booking_request_payment_recovery_operations
from public, anon, authenticated, service_role;

create function public.reject_booking_request_payment_recovery_history_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.state in ('safely_failed','succeeded','late_succeeded') and old is distinct from new then
    raise exception 'Completed payment recovery attempts are immutable' using errcode='RC204'; end if;
  if old.booking_request_id is distinct from new.booking_request_id
    or old.command_key is distinct from new.command_key
    or old.generation is distinct from new.generation
    or old.replacement_method is distinct from new.replacement_method
    or old.created_at is distinct from new.created_at then
    raise exception 'Booking Request payment recovery history is immutable'
      using errcode = 'RC204';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_booking_request_payment_recovery_history_change()
  from public, anon, authenticated, service_role;
create trigger enforce_booking_request_payment_recovery_history
before update on public.booking_request_payment_recovery_attempts
for each row execute function public.reject_booking_request_payment_recovery_history_change();

create function public.claim_customer_booking_request_payment_recovery(
  target_booking_request_id uuid,
  target_command_key uuid,
  target_replacement_method text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
declare request public.booking_requests;
declare work public.booking_request_capture_work;
declare existing public.booking_request_payment_recovery_attempts;
declare created public.booking_request_payment_recovery_attempts;
declare next_generation integer;
declare initial_state text;
begin
  if actor is null or target_booking_request_id is null or target_command_key is null
    or target_replacement_method <> 'simulated-replacement'
    or not exists (select 1 from public.account_contexts contexts
      where contexts.user_id = actor and contexts.role = 'customer') then
    raise exception 'Booking Request payment recovery is unavailable' using errcode = 'RC404';
  end if;

  select * into request from public.booking_requests requests
  where requests.id = target_booking_request_id
    and requests.customer_user_id = actor
  for update of requests;
  if request.id is null then
    raise exception 'Booking Request payment recovery is unavailable' using errcode = 'RC404';
  end if;

  select * into work from public.booking_request_capture_work capture_work
  where capture_work.booking_request_id = request.id
  for update of capture_work;

  select * into existing from public.booking_request_payment_recovery_attempts attempts
  where attempts.booking_request_id = request.id
    and attempts.command_key = target_command_key;
  if existing.id is not null then
    return jsonb_build_object('status', case when existing.state = 'safely_failed' then 'retryable'
      when existing.state in ('succeeded','late_succeeded') then replace(existing.state,'_','-') else 'processing' end,
      'attemptId', existing.id, 'deadline', to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;

  if request.status <> 'accepted' or work.booking_request_id is null
    or work.state <> 'payment_required'
    or exists (select 1 from public.booking_confirmations confirmations
      where confirmations.booking_request_id = request.id)
    or clock_timestamp() >= work.payment_required_deadline then
    raise exception 'Booking Request payment recovery is unavailable' using errcode = 'RC409';
  end if;
  if exists (select 1 from public.booking_request_payment_recovery_attempts attempts
    where attempts.booking_request_id = request.id
      and attempts.state not in ('safely_failed')) then
    raise exception 'Booking Request payment recovery is already processing' using errcode = 'RC409';
  end if;

  select coalesce(max(attempts.generation), 0) + 1 into next_generation
  from public.booking_request_payment_recovery_attempts attempts
  where attempts.booking_request_id = request.id;
  initial_state := case when exists (
    select 1 from public.booking_request_payment_recovery_operations operations
    join public.booking_request_payment_recovery_attempts attempts
      on attempts.id = operations.recovery_attempt_id
    where attempts.booking_request_id = request.id
      and operations.step = 'original-release' and operations.outcome = 'succeeded'
  ) then 'original_released' else 'admitted' end;
  insert into public.booking_request_payment_recovery_attempts(
    booking_request_id, command_key, generation, replacement_method, state
  ) values (request.id, target_command_key, next_generation,
    target_replacement_method, initial_state)
  returning * into created;
  return jsonb_build_object('status','processing','attemptId',created.id,
    'deadline',to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;
revoke all on function public.claim_customer_booking_request_payment_recovery(uuid,uuid,text)
  from public, anon;
grant execute on function public.claim_customer_booking_request_payment_recovery(uuid,uuid,text)
  to authenticated;

-- The provider ledger is the authority for physical execution and outcome time.
create function public.validate_booking_request_recovery_operation(
  target_operation public.booking_request_payment_recovery_operations, target_permit jsonb
)
returns public.simulated_payment_provider_operations
language plpgsql security definer set search_path = '' as $$
declare ledger public.simulated_payment_provider_operations;
declare binding jsonb := target_permit->'binding';
begin
  select * into ledger from public.simulated_payment_provider_operations operations
    where operations.id=target_operation.provider_operation_id for update of operations;
  if target_operation.id is null or ledger.id is null
    or target_operation.execution_permit is distinct from target_permit
    or target_operation.recovery_attempt_id::text is distinct from target_permit->>'attemptId'
    or target_operation.step is distinct from target_permit->>'step'
    or (ledger.recovery_attempt_id::text,ledger.claim_id::text,ledger.claim_generation,
      ledger.operation_kind,ledger.payment_lifecycle_id::text,ledger.logical_operation_id,
      ledger.physical_attempt_id,ledger.amount_fils,ledger.currency,
      ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,
      ledger.provider_idempotency_key,ledger.request_fingerprint) is distinct from
      (target_permit->>'attemptId',binding->>'authorizationClaimId',
      (binding->>'authorizationClaimGeneration')::integer,
      case target_permit->>'step' when 'replacement-authorization' then 'authorization'
        when 'replacement-capture' then 'capture' else 'release' end,
      binding->>'paymentLifecycleId',binding->>'logicalOperationId',binding->>'physicalAttemptId',
      (binding->>'amountFils')::bigint,binding->>'currency',
      binding#>>'{providerIdentity,provider}',binding#>>'{providerIdentity,environment}',
      binding#>>'{providerIdentity,merchantId}',binding#>>'{providerIdentity,terminalId}',
      target_permit->>'idempotencyKey',binding->>'requestFingerprint')
    or ledger.physical_execution_count <> 1
    or ledger.current_outcome is distinct from target_operation.outcome
    or (ledger.original_outcome <> 'indeterminate' and ledger.current_outcome <> ledger.original_outcome)
    or ledger.authoritative_outcome_at is distinct from target_operation.authoritative_outcome_at
    or (ledger.current_outcome='indeterminate') is distinct from (ledger.authoritative_outcome_at is null)
    or (ledger.current_outcome='failed') is distinct from (ledger.movement_reference is null)
    or ledger.authoritative_outcome_at < ledger.created_at
    or ledger.created_at < (binding->>'predecessorOutcomeAt')::timestamptz
    or ledger.capture_execution_permit is distinct from
      (case when ledger.operation_kind='capture' then target_permit end) then
    raise exception 'Recovery provider evidence is invalid' using errcode='RC409';
  end if;
  return ledger;
end;
$$;
revoke all on function public.validate_booking_request_recovery_operation(public.booking_request_payment_recovery_operations,jsonb)
  from public,anon,authenticated,service_role;

create function public.booking_request_recovery_execution_permit(
  target_attempt public.booking_request_payment_recovery_attempts,
  target_work public.booking_request_capture_work,
  target_payment_snapshot jsonb, target_step text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous public.booking_request_payment_recovery_operations;
declare previous_attempt public.booking_request_payment_recovery_attempts;
declare previous_ledger public.simulated_payment_provider_operations;
declare predecessor text;
declare predecessor_time timestamptz;
declare previous_step text;
declare operation_identity text := target_attempt.id::text||':'||target_step;
declare binding jsonb;
begin
  if target_step='original-release' then
    predecessor := target_payment_snapshot#>>'{authorization,movementReference}';
    predecessor_time := (target_payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz;
  else
    previous_step := case target_step when 'replacement-authorization' then 'original-release'
      when 'replacement-capture' then 'replacement-authorization'
      when 'replacement-release' then 'replacement-authorization' end;
    if previous_step is null then raise exception 'Recovery step is invalid' using errcode='RC409'; end if;
    select operations.* into previous
    from public.booking_request_payment_recovery_operations operations
    join public.booking_request_payment_recovery_attempts attempts on attempts.id=operations.recovery_attempt_id
    where attempts.booking_request_id=target_attempt.booking_request_id
      and operations.step=previous_step and operations.outcome='succeeded'
      and (previous_step='original-release' or attempts.id=target_attempt.id)
    order by attempts.generation limit 1 for update of operations,attempts;
    select * into previous_attempt from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=previous.recovery_attempt_id;
    previous_ledger := public.validate_booking_request_recovery_operation(previous,
      public.booking_request_recovery_execution_permit(previous_attempt,target_work,target_payment_snapshot,previous_step));
    if previous_ledger.current_outcome is distinct from 'succeeded'
      or previous_ledger.authoritative_outcome_at is null then
      raise exception 'Recovery predecessor is unresolved' using errcode='RC409';
    end if;
    predecessor := previous_ledger.movement_reference;
    predecessor_time := previous_ledger.authoritative_outcome_at;
  end if;
  if predecessor is null then raise exception 'Recovery predecessor is missing' using errcode='RC409'; end if;
  binding := jsonb_build_object('bookingRequestId',target_attempt.booking_request_id,
    'recoveryAttemptId',target_attempt.id,'generation',target_attempt.generation,'step',target_step,
    'authorizationClaimId',target_work.authorization_claim_id,
    'authorizationClaimGeneration',target_work.authorization_claim_generation,
    'predecessorMovementReference',predecessor,
    'predecessorOutcomeAt',to_char(predecessor_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'paymentLifecycleId',case when target_step='original-release' then target_work.payment_lifecycle_id else target_attempt.id end,
    'logicalOperationId',operation_identity,'physicalAttemptId',operation_identity||':1',
    'amountFils',target_work.amount_fils,'currency',target_work.currency,
    'requestFingerprint',target_work.request_fingerprint,
    'providerIdentity',jsonb_build_object('provider',target_work.provider,'environment',target_work.environment,
      'merchantId',target_work.merchant_id,'terminalId',target_work.terminal_id));
  return jsonb_build_object('purpose','booking-request-payment-recovery','attemptId',target_attempt.id,
    'generation',target_attempt.generation,'step',target_step,'operationId',operation_identity,
    'idempotencyKey',operation_identity||':1','binding',binding,
    'notAfter',to_char(target_work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;
revoke all on function public.booking_request_recovery_execution_permit(public.booking_request_payment_recovery_attempts,public.booking_request_capture_work,jsonb,text)
  from public,anon,authenticated,service_role;

create function public.lock_booking_request_payment_recovery_source(target_attempt_id uuid)
returns table(attempt public.booking_request_payment_recovery_attempts,work public.booking_request_capture_work,payment_snapshot jsonb)
language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
declare source record;
begin
  select attempts.booking_request_id into request_id from public.booking_request_payment_recovery_attempts attempts
    where attempts.id=target_attempt_id;
  select * into source from public.lock_booking_request_capture_source(request_id);
  if not found then raise exception 'Recovery source is unavailable' using errcode='RC409'; end if;
  work := source.work;
  payment_snapshot := source.payment_snapshot;
  select * into attempt from public.booking_request_payment_recovery_attempts attempts
    where attempts.id=target_attempt_id for update of attempts;
  if attempt.id is null or attempt.booking_request_id is distinct from work.booking_request_id
    or work.state <> 'payment_required'
    or not exists(select 1 from public.booking_request_submission_attempts submissions
      where submissions.id=work.attempt_id and submissions.intent_dedupe_active)
    or exists(select 1 from public.booking_request_release_work releases
      where releases.booking_request_id=work.booking_request_id) then
    raise exception 'Recovery source is invalid' using errcode='RC409';
  end if;
  return next;
end;
$$;
revoke all on function public.lock_booking_request_payment_recovery_source(uuid) from public,anon,authenticated,service_role;

create function public.lease_booking_request_payment_recovery_step(target_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare attempt public.booking_request_payment_recovery_attempts;
declare previous public.booking_request_payment_recovery_operations;
declare ledger public.simulated_payment_provider_operations;
declare step text;
declare permit jsonb;
begin
  if current_setting('role',true) <> 'service_role' then
    raise exception 'Recovery processing is unavailable' using errcode='42501'; end if;
  select * into source from public.lock_booking_request_payment_recovery_source(target_attempt_id);
  attempt := source.attempt;
  if attempt.state='blocked' then
    select * into previous from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=attempt.id and operations.outcome='indeterminate';
    if previous.id is null then return jsonb_build_object('status','blocked'); end if;
    permit := public.booking_request_recovery_execution_permit(attempt,source.work,source.payment_snapshot,previous.step);
    ledger := public.validate_booking_request_recovery_operation(previous,permit);
    return jsonb_build_object('status','reconcile','permit',permit,'binding',permit->'binding',
      'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference);
  end if;
  if attempt.state in ('safely_failed','succeeded','late_succeeded') then
    return jsonb_build_object('status',case when attempt.state='safely_failed' then 'retryable'
      else replace(attempt.state,'_','-') end);
  end if;
  step := case attempt.state when 'admitted' then 'original-release'
    when 'original_released' then 'replacement-authorization'
    when 'replacement_authorized' then 'replacement-capture'
    when 'capture_failed' then 'replacement-release' end;
  permit := public.booking_request_recovery_execution_permit(attempt,source.work,source.payment_snapshot,step);
  -- Check the clock after every source and predecessor lock has been acquired.
  if step <> 'replacement-release' and clock_timestamp() >= (source.work).payment_required_deadline then
    return jsonb_build_object('status','deadline-elapsed'); end if;
  return jsonb_build_object('status','leased','permit',permit,'binding',permit->'binding');
end;
$$;
revoke all on function public.lease_booking_request_payment_recovery_step(uuid) from public,anon,authenticated;
grant execute on function public.lease_booking_request_payment_recovery_step(uuid) to service_role;

create function public.record_booking_request_recovery_outcome(
  target_attempt_id uuid,target_step text,target_ledger public.simulated_payment_provider_operations,
  target_deadline timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare next_state text;
begin
  next_state := case
    when target_ledger.current_outcome='indeterminate' then 'blocked'
    when target_step='original-release' and target_ledger.current_outcome='succeeded' then 'original_released'
    when target_step='original-release' then 'blocked'
    when target_step='replacement-authorization' and target_ledger.current_outcome='succeeded' then 'replacement_authorized'
    when target_step='replacement-authorization' then 'safely_failed'
    when target_step='replacement-capture' and target_ledger.current_outcome='succeeded'
      and target_ledger.authoritative_outcome_at < target_deadline then 'succeeded'
    when target_step='replacement-capture' and target_ledger.current_outcome='succeeded' then 'late_succeeded'
    when target_step='replacement-capture' then 'capture_failed'
    when target_step='replacement-release' and target_ledger.current_outcome='succeeded' then 'safely_failed'
    else 'blocked' end;
  update public.booking_request_payment_recovery_attempts attempts set state=next_state,updated_at=clock_timestamp()
    where attempts.id=target_attempt_id;
  return jsonb_strip_nulls(jsonb_build_object('outcome',target_ledger.current_outcome,
    'providerRequestId',target_ledger.provider_request_id,'providerReference',target_ledger.provider_reference,
    'movementReference',target_ledger.movement_reference,'retrySafe',next_state='safely_failed'));
end;
$$;
revoke all on function public.record_booking_request_recovery_outcome(uuid,text,public.simulated_payment_provider_operations,timestamptz)
  from public,anon,authenticated,service_role;

create function public.execute_simulated_booking_request_payment_recovery(target_permit jsonb,target_outcome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare work public.booking_request_capture_work;
declare attempt public.booking_request_payment_recovery_attempts;
declare previous public.booking_request_payment_recovery_operations;
declare ledger public.simulated_payment_provider_operations;
declare expected jsonb;
declare dispatched jsonb;
declare operation_id uuid := gen_random_uuid();
declare outcome_time timestamptz;
declare recovery_step text := target_permit->>'step';
begin
  if current_setting('role',true) <> 'service_role'
    or target_outcome is null or target_outcome not in ('succeeded','failed','indeterminate') then
    raise exception 'Recovery execution is unavailable' using errcode='42501'; end if;
  select * into source from public.lock_booking_request_payment_recovery_source((target_permit->>'attemptId')::uuid);
  work := source.work; attempt := source.attempt;
  expected := public.booking_request_recovery_execution_permit(attempt,work,source.payment_snapshot,recovery_step);
  if target_permit is distinct from expected then
    raise exception 'Recovery permit is invalid' using errcode='RC409'; end if;
  select * into previous from public.booking_request_payment_recovery_operations operations
    where operations.recovery_attempt_id=attempt.id and operations.step=recovery_step;
  if previous.id is not null then
    ledger := public.validate_booking_request_recovery_operation(previous,expected);
    return jsonb_strip_nulls(jsonb_build_object('outcome',ledger.current_outcome,
      'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
      'movementReference',ledger.movement_reference,'retrySafe',attempt.state='safely_failed'));
  end if;
  dispatched := public.lease_booking_request_payment_recovery_step(attempt.id);
  if dispatched->>'status' <> 'leased' or dispatched->'permit' is distinct from expected then
    return jsonb_build_object('outcome','not-executed'); end if;
  outcome_time := clock_timestamp();
  if recovery_step <> 'replacement-release' and outcome_time >= work.payment_required_deadline then
    return jsonb_build_object('outcome','not-executed'); end if;
  insert into public.simulated_payment_provider_operations(
    id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,
    physical_attempt_id,amount_fils,currency,original_outcome,current_outcome,
    provider_request_id,provider_reference,movement_reference,recovery_attempt_id,
    authoritative_outcome_at,capture_execution_permit,created_at,updated_at
  ) values(operation_id,work.authorization_claim_id,work.authorization_claim_generation,
    case recovery_step when 'replacement-authorization' then 'authorization' when 'replacement-capture' then 'capture' else 'release' end,
    work.provider,work.environment,work.merchant_id,work.terminal_id,expected->>'idempotencyKey',work.request_fingerprint,
    (expected#>>'{binding,paymentLifecycleId}')::uuid,expected->>'operationId',expected#>>'{binding,physicalAttemptId}',
    work.amount_fils,work.currency,target_outcome,target_outcome,'sim-recovery-request-'||operation_id,
    'sim-recovery-reference-'||operation_id,case when target_outcome='failed' then null else 'sim-recovery-movement-'||operation_id end,
    attempt.id,case when target_outcome='indeterminate' then null else outcome_time end,
    case when recovery_step='replacement-capture' then expected end,outcome_time,outcome_time) returning * into ledger;
  insert into public.booking_request_payment_recovery_operations(recovery_attempt_id,step,provider_operation_id,
    outcome,authoritative_outcome_at,execution_permit)
  values(attempt.id,recovery_step,ledger.id,ledger.current_outcome,ledger.authoritative_outcome_at,expected);
  return public.record_booking_request_recovery_outcome(attempt.id,recovery_step,ledger,work.payment_required_deadline);
end;
$$;
revoke all on function public.execute_simulated_booking_request_payment_recovery(jsonb,text) from public,anon,authenticated;
grant execute on function public.execute_simulated_booking_request_payment_recovery(jsonb,text) to service_role;

create function public.query_simulated_booking_request_payment_recovery(
  target_permit jsonb,target_provider_request_id text,target_provider_reference text,target_outcome text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare previous public.booking_request_payment_recovery_operations;
declare ledger public.simulated_payment_provider_operations;
declare expected jsonb;
declare outcome_time timestamptz;
begin
  if current_setting('role',true) <> 'service_role' or target_outcome is null
    or target_outcome not in ('succeeded','failed','indeterminate') then
    raise exception 'Recovery query is unavailable' using errcode='42501'; end if;
  select * into source from public.lock_booking_request_payment_recovery_source((target_permit->>'attemptId')::uuid);
  expected := public.booking_request_recovery_execution_permit(source.attempt,source.work,source.payment_snapshot,target_permit->>'step');
  select * into previous from public.booking_request_payment_recovery_operations operations
    where operations.recovery_attempt_id=(source.attempt).id and operations.step=target_permit->>'step';
  ledger := public.validate_booking_request_recovery_operation(previous,expected);
  if target_permit is distinct from expected
    or ledger.provider_request_id is distinct from target_provider_request_id
    or ledger.provider_reference is distinct from target_provider_reference then
    raise exception 'Recovery query binding is invalid' using errcode='RC409'; end if;
  if ledger.current_outcome='indeterminate' and target_outcome <> 'indeterminate' then
    -- Resolution time is new authoritative evidence, never the earlier dispatch time.
    outcome_time := clock_timestamp();
    update public.simulated_payment_provider_operations operations set current_outcome=target_outcome,
      authoritative_outcome_at=outcome_time,updated_at=outcome_time,
      movement_reference=case when target_outcome='failed' then null else ledger.movement_reference end
      where operations.id=ledger.id returning * into ledger;
    update public.booking_request_payment_recovery_operations operations set outcome=ledger.current_outcome,
      authoritative_outcome_at=ledger.authoritative_outcome_at,updated_at=outcome_time where operations.id=previous.id;
    return public.record_booking_request_recovery_outcome((source.attempt).id,previous.step,ledger,(source.work).payment_required_deadline);
  end if;
  update public.booking_request_payment_recovery_attempts attempts set updated_at=clock_timestamp()
    where attempts.id=(source.attempt).id and attempts.state='blocked' and ledger.current_outcome='indeterminate';
  return jsonb_strip_nulls(jsonb_build_object('outcome',ledger.current_outcome,
    'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
    'movementReference',ledger.movement_reference,'retrySafe',(source.attempt).state='safely_failed'));
end;
$$;
revoke all on function public.query_simulated_booking_request_payment_recovery(jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.query_simulated_booking_request_payment_recovery(jsonb,text,text,text) to service_role;

create function public.due_booking_request_payment_recoveries(target_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role',true) <> 'service_role' or target_limit is null or target_limit < 1 or target_limit > 50 then
    raise exception 'Recovery batch is unavailable' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(id),'[]'::jsonb) from (
    select attempts.id from public.booking_request_payment_recovery_attempts attempts
    where (attempts.state='succeeded' or attempts.state='capture_failed'
      or (attempts.state='blocked' and exists(select 1 from public.booking_request_payment_recovery_operations operations
        where operations.recovery_attempt_id=attempts.id and operations.outcome='indeterminate'))
      or (attempts.state in ('admitted','original_released','replacement_authorized')
        and exists(select 1 from public.booking_request_capture_work work
          where work.booking_request_id=attempts.booking_request_id and clock_timestamp() < work.payment_required_deadline)))
      and not exists(select 1 from public.booking_confirmations confirmations
        where confirmations.booking_request_id=attempts.booking_request_id)
    order by attempts.updated_at,attempts.id limit target_limit) due);
end;
$$;
revoke all on function public.due_booking_request_payment_recoveries(integer) from public,anon,authenticated;
grant execute on function public.due_booking_request_payment_recoveries(integer) to service_role;

create function public.booking_request_payment_recovery_status(target_request public.booking_requests)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when target_request.status='accepted' and work.state='payment_required' then
    jsonb_build_object('status',case
      when confirmation.id is not null then 'confirmed'
      when attempt.state='succeeded' then 'processing'
      when clock_timestamp() >= work.payment_required_deadline then 'deadline-elapsed'
      when attempt.state='safely_failed' then 'retryable'
      when attempt.state in ('blocked','admitted','original_released','replacement_authorized','capture_failed') then 'processing'
      when attempt.state='late_succeeded' then 'deadline-elapsed'
      else 'available' end)
  end
  from public.booking_request_capture_work work
  left join lateral (select attempts.* from public.booking_request_payment_recovery_attempts attempts
    where attempts.booking_request_id=target_request.id order by attempts.generation desc limit 1) attempt on true
  left join public.booking_confirmations confirmation on confirmation.booking_request_id=target_request.id
  where work.booking_request_id=target_request.id;
$$;
revoke all on function public.booking_request_payment_recovery_status(public.booking_requests)
  from public, anon, authenticated, service_role;

-- Recovery evidence is validated independently; the confirmation transaction below
-- keeps the original source, snapshot, inventory, occupancy and receipt checks.
create function public.validate_booking_request_payment_recovery_confirmation(
  target_booking_request_id uuid,target_evidence jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare attempt public.booking_request_payment_recovery_attempts;
declare work public.booking_request_capture_work;
declare operation public.booking_request_payment_recovery_operations;
declare capture public.simulated_payment_provider_operations;
declare permit jsonb;
begin
  select * into source from public.lock_booking_request_payment_recovery_source((target_evidence->>'recoveryAttemptId')::uuid);
  attempt := source.attempt; work := source.work;
  permit := public.booking_request_recovery_execution_permit(attempt,work,source.payment_snapshot,'replacement-capture');
  select * into operation from public.booking_request_payment_recovery_operations operations
    where operations.recovery_attempt_id=attempt.id and operations.step='replacement-capture';
  capture := public.validate_booking_request_recovery_operation(operation,permit);
  if attempt.booking_request_id is distinct from target_booking_request_id or attempt.state <> 'succeeded'
    or capture.current_outcome <> 'succeeded' or capture.authoritative_outcome_at is null
    or capture.authoritative_outcome_at >= work.payment_required_deadline
    or target_evidence is distinct from jsonb_build_object(
      'purpose','booking-request-payment-recovery','bookingRequestId',work.booking_request_id,
      'recoveryAttemptId',attempt.id,'capturePhysicalAttemptId',capture.physical_attempt_id,
      'capture',jsonb_build_object('movementReference',capture.movement_reference)) then
    raise exception 'Recovery confirmation evidence is invalid' using errcode='RC409'; end if;
  return jsonb_build_object('submissionAttemptId',work.attempt_id,'authorizationClaimId',work.authorization_claim_id,
    'amountFils',work.amount_fils,'capturePhysicalAttemptId',capture.physical_attempt_id,
    'capture',jsonb_build_object('movementReference',capture.movement_reference));
end;
$$;
revoke all on function public.validate_booking_request_payment_recovery_confirmation(uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.finalize_booking_request_confirmation(
  target_booking_request_id uuid,
  target_capture_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare capture_result jsonb;
declare target_request public.booking_requests;
declare target_attempt public.booking_request_submission_attempts;
declare target_claim public.booking_request_authorization_claims;
declare target_snapshot public.booking_snapshots;
declare target_commitment public.cottage_booking_period_commitments;
declare target_capture public.simulated_payment_provider_operations;
declare existing_confirmation public.booking_confirmations;
declare customer_receipt public.booking_receipts;
declare owner_receipt public.booking_receipts;
declare created_confirmation public.booking_confirmations;
declare outcome_time timestamptz;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'Booking Request confirmation is unavailable' using errcode = '42501';
  end if;
  if target_capture_snapshot ->> 'purpose' = 'booking-request-payment-recovery' then
    target_capture_snapshot := public.validate_booking_request_payment_recovery_confirmation(
      target_booking_request_id, target_capture_snapshot
    );
  else
    capture_result := public.complete_booking_request_capture(
      target_booking_request_id, null, null, null
    );
    if capture_result -> 'snapshot' is distinct from target_capture_snapshot then
      raise exception 'Booking Request confirmation Capture evidence is invalid'
        using errcode = 'RC409';
    end if;
  end if;

  select * into target_request from public.booking_requests requests
  where requests.id = target_booking_request_id;
  select * into target_attempt from public.booking_request_submission_attempts attempts
  where attempts.id = (target_capture_snapshot ->> 'submissionAttemptId')::uuid;
  select * into target_claim from public.booking_request_authorization_claims claims
  where claims.id = (target_capture_snapshot ->> 'authorizationClaimId')::uuid;
  select * into target_snapshot from public.booking_snapshots snapshots
  where snapshots.id = target_request.booking_snapshot_id;
  select * into target_commitment from public.cottage_booking_period_commitments commitments
  where commitments.id = target_request.booking_period_commitment_id
  for update of commitments;
  select * into target_capture from public.simulated_payment_provider_operations operations
  where operations.claim_id = target_claim.id
    and operations.claim_generation = target_claim.generation
    and operations.operation_kind = 'capture'
    and operations.physical_attempt_id = target_capture_snapshot ->> 'capturePhysicalAttemptId'
  for update of operations;
  perform 1 from public.cottage_inventory_commitments inventory
  where inventory.booking_period_commitment_id = target_commitment.id
  order by inventory.service_day, inventory.unit_kind, inventory.unit_id
  for update of inventory;
  perform 1 from public.cottage_booking_period_occupancies occupancies
  where occupancies.booking_period_commitment_id = target_commitment.id
  order by occupancies.service_day, occupancies.shift_id
  for update of occupancies;

  if target_request.id is null
    or target_request.status <> 'accepted'
    or target_attempt.id is null
    or target_attempt.booking_request_id is distinct from target_request.id
    or target_claim.id is null
    or target_claim.attempt_id is distinct from target_attempt.id
    or target_snapshot.id is null
    or (target_snapshot.customer_user_id, target_snapshot.profile_id,
      target_snapshot.quote_fingerprint, target_snapshot.intent_fingerprint,
      target_snapshot.quote_payload, target_snapshot.intent_payload) is distinct from
      (target_request.customer_user_id, target_request.profile_id,
      target_attempt.quote_fingerprint, target_attempt.intent_fingerprint,
      target_attempt.quote_payload, target_attempt.intent_payload)
    or target_commitment.id is null
    or (target_commitment.customer_user_id, target_commitment.profile_id,
      target_commitment.schedule_revision_id) is distinct from
      (target_request.customer_user_id, target_request.profile_id,
      target_claim.schedule_revision_id)
    or target_claim.customer_user_id is distinct from target_request.customer_user_id
    or target_claim.profile_id is distinct from target_request.profile_id
    or target_claim.access_ranges is distinct from target_commitment.access_ranges
    or target_request.owner_user_id is distinct from (
      select profiles.owner_user_id
      from public.owner_application_cottage_profiles profiles
      where profiles.id = target_request.profile_id
    )
    or (target_snapshot.quote_payload ->> 'bookingPriceIqd')::bigint * 1000
      is distinct from (target_attempt.payment_snapshot ->> 'bookingPriceFils')::bigint
    or (target_snapshot.quote_payload ->> 'customerTotalIqd')::bigint * 1000
      is distinct from (target_capture_snapshot ->> 'amountFils')::bigint
    or (target_attempt.payment_snapshot ->> 'customerTotalFils')::bigint
      is distinct from (target_capture_snapshot ->> 'amountFils')::bigint
    or target_capture.id is null
    or target_capture.movement_reference
      is distinct from target_capture_snapshot #>> '{capture,movementReference}'
    or not exists (
      select 1 from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
    )
    or not exists (
      select 1 from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
    )
    or exists (
      select claim_items.unit_kind, claim_items.unit_id,
        claim_items.service_day, claim_items.price_iqd
      from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
      except
      select inventory.unit_kind, inventory.unit_id,
        inventory.service_day, inventory.committed_price_iqd
      from public.cottage_inventory_commitments inventory
      where inventory.booking_period_commitment_id = target_commitment.id
    )
    or exists (
      select inventory.unit_kind, inventory.unit_id,
        inventory.service_day, inventory.committed_price_iqd
      from public.cottage_inventory_commitments inventory
      where inventory.booking_period_commitment_id = target_commitment.id
      except
      select claim_items.unit_kind, claim_items.unit_id,
        claim_items.service_day, claim_items.price_iqd
      from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
    )
    or exists (
      select claim_occupancies.schedule_revision_id,
        claim_occupancies.shift_id, claim_occupancies.service_day
      from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
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
      select claim_occupancies.schedule_revision_id,
        claim_occupancies.shift_id, claim_occupancies.service_day
      from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
    )
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
    or exists (
      select 1 from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and not occupancies.active
    )
    or exists (
      select 1 from public.booking_request_release_work release_work
      where release_work.booking_request_id = target_request.id
    ) then
    raise exception 'Booking Request confirmation source graph is invalid'
      using errcode = 'RC409';
  end if;

  select * into existing_confirmation from public.booking_confirmations confirmations
  where confirmations.booking_request_id = target_request.id
  for update of confirmations;
  if existing_confirmation.id is not null then
    select * into customer_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'customer';
    select * into owner_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'cottage_owner';
    if (existing_confirmation.booking_snapshot_id,
      existing_confirmation.booking_period_commitment_id,
      existing_confirmation.capture_operation_id) is distinct from
      (target_snapshot.id, target_commitment.id, target_capture.id)
      or target_commitment.status <> 'confirmed_booking'
      or customer_receipt.id is null
      or owner_receipt.id is null
      or (customer_receipt.booking_snapshot_id, customer_receipt.recipient_user_id,
        customer_receipt.created_at) is distinct from
        (target_snapshot.id, target_request.customer_user_id,
        existing_confirmation.confirmed_at)
      or (owner_receipt.booking_snapshot_id, owner_receipt.recipient_user_id,
        owner_receipt.created_at) is distinct from
        (target_snapshot.id, target_request.owner_user_id,
        existing_confirmation.confirmed_at)
      or (select count(*) from public.booking_receipts receipts
        where receipts.booking_confirmation_id = existing_confirmation.id) <> 2 then
      raise exception 'Stored Booking Request confirmation is incomplete'
        using errcode = 'RC409';
    end if;
  else
    if target_commitment.status <> 'pending_hold' then
      raise exception 'Booking Request confirmation commitment is invalid'
        using errcode = 'RC409';
    end if;
    outcome_time := clock_timestamp();
    insert into public.booking_confirmations (
      booking_request_id, booking_snapshot_id, booking_period_commitment_id,
      capture_operation_id, confirmed_at
    ) values (
      target_request.id, target_snapshot.id, target_commitment.id,
      target_capture.id, outcome_time
    ) returning * into created_confirmation;
    update public.cottage_booking_period_commitments commitments
    set status = 'confirmed_booking'
    where commitments.id = target_commitment.id;
    insert into public.booking_receipts (
      booking_confirmation_id, booking_snapshot_id, recipient_role,
      recipient_user_id, created_at
    ) values
      (created_confirmation.id, target_snapshot.id, 'customer',
        target_request.customer_user_id, outcome_time),
      (created_confirmation.id, target_snapshot.id, 'cottage_owner',
        target_request.owner_user_id, outcome_time);
    existing_confirmation := created_confirmation;
    select * into customer_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'customer';
    select * into owner_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'cottage_owner';
  end if;

  return jsonb_build_object(
    'bookingRequestId', target_request.id,
    'commitmentId', target_commitment.id,
    'bookingReference', target_commitment.commitment_reference,
    'confirmedAt', to_char(existing_confirmation.confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'capturePhysicalAttemptId', target_capture.physical_attempt_id,
    'captureMovementReference', target_capture.movement_reference,
    'receipts', jsonb_build_object(
      'customer', jsonb_build_object(
        'id', customer_receipt.id, 'recipientId', customer_receipt.recipient_user_id
      ),
      'cottageOwner', jsonb_build_object(
        'id', owner_receipt.id, 'recipientId', owner_receipt.recipient_user_id
      )
    )
  );
end;
$$;

revoke all on function public.finalize_booking_request_confirmation(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_booking_request_confirmation(uuid,jsonb)
  to service_role;

create function public.get_booking_request_payment_recovery_confirmation_evidence(target_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare evidence jsonb;
begin
  select jsonb_build_object(
    'purpose','booking-request-payment-recovery','bookingRequestId',attempts.booking_request_id,
    'recoveryAttemptId',attempts.id,'capturePhysicalAttemptId',ledger.physical_attempt_id,
    'capture',jsonb_build_object('movementReference',ledger.movement_reference)) into evidence
  from public.booking_request_payment_recovery_attempts attempts
  join public.booking_request_payment_recovery_operations operations on operations.recovery_attempt_id=attempts.id
    and operations.step='replacement-capture'
  join public.simulated_payment_provider_operations ledger on ledger.id=operations.provider_operation_id
  where attempts.id=target_attempt_id;
  if current_setting('role',true) <> 'service_role' or evidence is null then
    raise exception 'Recovery confirmation evidence is unavailable' using errcode='RC409'; end if;
  return evidence;
end;
$$;
revoke all on function public.get_booking_request_payment_recovery_confirmation_evidence(uuid) from public,anon,authenticated;
grant execute on function public.get_booking_request_payment_recovery_confirmation_evidence(uuid) to service_role;

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
          and commitments.status = 'confirmed_booking' and (capture_work.state = 'complete' or (
            capture_work.state='payment_required' and exists (
              select 1 from public.booking_request_payment_recovery_attempts attempts
              join public.booking_request_payment_recovery_operations operations on operations.recovery_attempt_id=attempts.id
                and operations.step='replacement-capture' and operations.outcome='succeeded'
              join public.simulated_payment_provider_operations ledger on ledger.id=operations.provider_operation_id
              where attempts.booking_request_id=target_request.id and attempts.state='succeeded'
                and operations.provider_operation_id=confirmations.capture_operation_id
                and ledger.current_outcome='succeeded' and ledger.recovery_attempt_id=attempts.id
                and ledger.authoritative_outcome_at=operations.authoritative_outcome_at
                and ledger.authoritative_outcome_at < capture_work.payment_required_deadline
            )))
      ) then 'paid-confirmed'
      when exists (select 1 from public.booking_request_capture_work capture_work
        where capture_work.booking_request_id = target_request.id and capture_work.state = 'payment_required')
        then 'payment-required'
      when exists (select 1 from public.booking_request_capture_work capture_work where capture_work.booking_request_id = target_request.id)
        then 'capture-processing'
      end end;
$$;

create or replace function public.booking_request_payment_required_window(target_request public.booking_requests)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when target_request.status='accepted' and work.state='payment_required'
    and not exists(select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id=target_request.id)
  then jsonb_build_object(
    'recordedAt',to_char(work.payment_required_recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deadline',to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'databaseNow',to_char(date_trunc('milliseconds',clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end
  from public.booking_request_capture_work work where work.booking_request_id=target_request.id;
$$;

create or replace function public.get_customer_booking_request(target_reference text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',requests.id,'bookingRequestReference',requests.booking_request_reference,
    'status',requests.status,'paymentStatus',public.booking_request_payment_status(requests),
    'paymentRequiredWindow',public.booking_request_payment_required_window(requests),
    'paymentRecovery',public.booking_request_payment_recovery_status(requests),
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
