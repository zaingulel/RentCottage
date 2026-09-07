create table public.booking_request_payment_required_expiry_work (
  id uuid primary key default gen_random_uuid(),
  booking_request_id uuid not null unique
    references public.booking_requests(id) on delete restrict,
  payment_required_deadline timestamptz not null,
  state text not null default 'processing'
    check (state in ('processing','attention_required','complete')),
  diagnostic_reason text check (
    diagnostic_reason is null or (
      diagnostic_reason = btrim(diagnostic_reason)
      and char_length(diagnostic_reason) between 1 and 120
    )
  ),
  created_at timestamptz not null default clock_timestamp(),
  last_evaluated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check ((state = 'complete') = (completed_at is not null)),
  check (state <> 'processing' or diagnostic_reason is null)
);

create index booking_request_payment_required_expiry_due
  on public.booking_request_payment_required_expiry_work(last_evaluated_at,booking_request_id)
  where state <> 'complete';

create table public.booking_request_payment_required_expiry_operations (
  id uuid primary key default gen_random_uuid(),
  expiry_work_id uuid not null
    references public.booking_request_payment_required_expiry_work(id) on delete restrict,
  booking_request_id uuid not null references public.booking_requests(id) on delete restrict,
  owner text not null check (owner in ('expiry','recovery')),
  recovery_operation_id uuid unique
    references public.booking_request_payment_recovery_operations(id) on delete restrict,
  provider_operation_id uuid unique
    references public.simulated_payment_provider_operations(id) on delete restrict,
  authorization_claim_id uuid not null,
  authorization_claim_generation integer not null check (authorization_claim_generation > 0),
  authorization_payment_lifecycle_id uuid not null,
  authorization_logical_operation_id text not null,
  authorization_physical_attempt_id text not null,
  predecessor_movement_reference text not null,
  predecessor_outcome_at timestamptz not null,
  release_logical_operation_id text not null,
  release_physical_attempt_id text not null,
  provider_idempotency_key text not null,
  amount_fils bigint not null check (amount_fils > 0),
  currency text not null check (currency = 'IQD'),
  provider text not null,
  environment text not null,
  merchant_id text not null,
  terminal_id text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (expiry_work_id,id),
  unique (
    booking_request_id, authorization_payment_lifecycle_id,
    authorization_logical_operation_id, authorization_physical_attempt_id
  ),
  unique (provider,environment,merchant_id,terminal_id,provider_idempotency_key),
  check (
    (owner = 'expiry' and recovery_operation_id is null)
    or (owner = 'recovery' and recovery_operation_id is not null and provider_operation_id is not null)
  )
);

alter table public.booking_request_payment_required_expiry_work enable row level security;
alter table public.booking_request_payment_required_expiry_operations enable row level security;
revoke all on public.booking_request_payment_required_expiry_work,
  public.booking_request_payment_required_expiry_operations
from public,anon,authenticated,service_role;

create function public.reject_booking_request_payment_required_expiry_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'booking_request_payment_required_expiry_work' then
    if old.id is distinct from new.id
      or old.booking_request_id is distinct from new.booking_request_id
      or old.payment_required_deadline is distinct from new.payment_required_deadline
      or old.created_at is distinct from new.created_at
      or old.state = 'complete'
      or (old.state,new.state) not in (
        ('processing','processing'),('processing','attention_required'),
        ('attention_required','attention_required'),('attention_required','processing'),
        ('processing','complete'),('attention_required','complete')
      ) then
      raise exception 'Payment Required expiry work is immutable' using errcode='RC204';
    end if;
  elsif old is distinct from new and not (
    old.owner='expiry' and old.provider_operation_id is null and new.provider_operation_id is not null
    and to_jsonb(old)-'provider_operation_id'=to_jsonb(new)-'provider_operation_id'
  ) then
    raise exception 'Payment Required expiry operation is immutable' using errcode='RC204';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_booking_request_payment_required_expiry_change()
  from public,anon,authenticated,service_role;
create trigger enforce_booking_request_payment_required_expiry_work
before update on public.booking_request_payment_required_expiry_work
for each row execute function public.reject_booking_request_payment_required_expiry_change();
create trigger enforce_booking_request_payment_required_expiry_operation
before update on public.booking_request_payment_required_expiry_operations
for each row execute function public.reject_booking_request_payment_required_expiry_change();

create function public.booking_request_payment_required_expiry_provider_matches(
  target_work public.booking_request_capture_work,target_provider_identity jsonb
)
returns boolean language sql immutable security definer set search_path = '' as $$
  select coalesce(jsonb_typeof(target_provider_identity) = 'object'
    and target_provider_identity ?& array['provider','environment','merchantId','terminalId']
    and target_provider_identity - array['provider','environment','merchantId','terminalId'] = '{}'::jsonb
    and jsonb_strip_nulls(target_provider_identity) = target_provider_identity
    and jsonb_typeof(target_provider_identity->'provider') = 'string'
    and jsonb_typeof(target_provider_identity->'environment') = 'string'
    and jsonb_typeof(target_provider_identity->'merchantId') = 'string'
    and jsonb_typeof(target_provider_identity->'terminalId') = 'string'
    and (target_provider_identity->>'provider',target_provider_identity->>'environment',
      target_provider_identity->>'merchantId',target_provider_identity->>'terminalId') is not distinct from
      (target_work.provider,target_work.environment,target_work.merchant_id,target_work.terminal_id),false);
$$;
revoke all on function public.booking_request_payment_required_expiry_provider_matches(
  public.booking_request_capture_work,jsonb
) from public,anon,authenticated,service_role;

create function public.claim_due_booking_request_payment_required_expiries(
  target_limit integer,target_provider_identity jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role',true) <> 'service_role'
    or target_limit is null or target_limit < 1 or target_limit > 50 then
    raise exception 'Payment Required expiry batch is unavailable' using errcode='42501';
  end if;
  if target_provider_identity is null
    or jsonb_typeof(target_provider_identity) <> 'object'
    or target_provider_identity ?& array['provider','environment','merchantId','terminalId'] is not true
    or target_provider_identity - array['provider','environment','merchantId','terminalId'] <> '{}'::jsonb
    or exists(select 1 from jsonb_each(target_provider_identity) entry
      where jsonb_typeof(entry.value) <> 'string' or btrim(entry.value#>>'{}')='')
  then
    raise exception 'Payment Required expiry provider is invalid' using errcode='RC409';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'bookingRequestId',due.booking_request_id,'deadline',
    to_char(due.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) order by due.payment_required_deadline,due.booking_request_id),'[]'::jsonb)
  from (
    select work.booking_request_id,work.payment_required_deadline,
      coalesce(expiry.last_evaluated_at,work.payment_required_deadline) evaluation_order
    from public.booking_request_capture_work work
    join public.booking_requests requests on requests.id=work.booking_request_id
    left join public.booking_request_payment_required_expiry_work expiry
      on expiry.booking_request_id=work.booking_request_id
    where work.state='payment_required'
      and requests.status='accepted'
      and work.payment_required_deadline <= clock_timestamp()
      and public.booking_request_payment_required_expiry_provider_matches(work,target_provider_identity)
      and not exists(select 1 from public.booking_confirmations confirmations
        where confirmations.booking_request_id=work.booking_request_id)
      and coalesce(expiry.state,'processing') <> 'complete'
    order by evaluation_order,work.payment_required_deadline,work.booking_request_id
    limit target_limit
    for update of requests skip locked
  ) due);
end;
$$;
revoke all on function public.claim_due_booking_request_payment_required_expiries(integer,jsonb)
  from public,anon,authenticated;
grant execute on function public.claim_due_booking_request_payment_required_expiries(integer,jsonb)
  to service_role;

create function public.booking_request_payment_required_expiry_permit(
  target public.booking_request_payment_required_expiry_operations,
  deadline timestamptz
)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'purpose','booking-request-payment-required-expiry','expiryWorkId',target.expiry_work_id,
    'expiryOperationId',target.id,'idempotencyKey',target.provider_idempotency_key,
    'notBefore',to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'binding',jsonb_build_object(
      'bookingRequestId',target.booking_request_id,
      'authorizationClaimId',target.authorization_claim_id,
      'authorizationClaimGeneration',target.authorization_claim_generation,
      'authorizationPaymentLifecycleId',target.authorization_payment_lifecycle_id,
      'authorizationLogicalOperationId',target.authorization_logical_operation_id,
      'authorizationPhysicalAttemptId',target.authorization_physical_attempt_id,
      'predecessorMovementReference',target.predecessor_movement_reference,
      'predecessorOutcomeAt',to_char(target.predecessor_outcome_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'releaseLogicalOperationId',target.release_logical_operation_id,
      'releasePhysicalAttemptId',target.release_physical_attempt_id,
      'amountFils',target.amount_fils,'currency',target.currency,
      'requestFingerprint',target.request_fingerprint,
      'providerIdentity',jsonb_build_object('provider',target.provider,'environment',target.environment,
        'merchantId',target.merchant_id,'terminalId',target.terminal_id)));
$$;
revoke all on function public.booking_request_payment_required_expiry_permit(
  public.booking_request_payment_required_expiry_operations,timestamptz
) from public,anon,authenticated,service_role;

create function public.validate_booking_request_payment_required_expiry_target(
  target public.booking_request_payment_required_expiry_operations,
  work public.booking_request_capture_work,payment_snapshot jsonb
)
returns public.simulated_payment_provider_operations
language plpgsql security definer set search_path = '' as $$
declare authorization_evidence public.simulated_payment_provider_operations;
declare ledger public.simulated_payment_provider_operations;
declare recovery public.booking_request_payment_recovery_attempts;
declare operation public.booking_request_payment_recovery_operations;
declare predecessor text;
declare predecessor_time timestamptz;
declare logical_identity text;
declare physical_identity text;
declare release_identity text;
begin
  if target.authorization_payment_lifecycle_id=work.payment_lifecycle_id then
    predecessor := payment_snapshot#>>'{authorization,movementReference}';
    predecessor_time := (payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz;
    logical_identity := work.authorization_logical_operation_id;
    physical_identity := work.authorization_physical_attempt_id;
    release_identity := target.expiry_work_id::text||':original-release';
  else
    select * into recovery from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=target.authorization_payment_lifecycle_id
        and attempts.booking_request_id=work.booking_request_id;
    select * into operation from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=recovery.id and operations.step='replacement-authorization';
    authorization_evidence := public.validate_booking_request_recovery_operation(operation,
      public.booking_request_recovery_execution_permit(recovery,work,payment_snapshot,'replacement-authorization'));
    if authorization_evidence.current_outcome is distinct from 'succeeded' then
      raise exception 'Expiry authorisation is invalid' using errcode='RC409'; end if;
    predecessor := authorization_evidence.movement_reference;
    predecessor_time := authorization_evidence.authoritative_outcome_at;
    logical_identity := authorization_evidence.logical_operation_id;
    physical_identity := authorization_evidence.physical_attempt_id;
    release_identity := target.expiry_work_id::text||':replacement-release:'||recovery.generation::text;
  end if;
  if (target.booking_request_id,target.authorization_claim_id,target.authorization_claim_generation,
      target.authorization_logical_operation_id,target.authorization_physical_attempt_id,
      target.predecessor_movement_reference,target.predecessor_outcome_at,
      target.amount_fils,target.currency,target.provider,target.environment,target.merchant_id,target.terminal_id,
      target.request_fingerprint) is distinct from
    (work.booking_request_id,work.authorization_claim_id,work.authorization_claim_generation,
      logical_identity,physical_identity,predecessor,predecessor_time,
      work.amount_fils,work.currency,work.provider,work.environment,work.merchant_id,work.terminal_id,
      work.request_fingerprint)
    or predecessor is null or predecessor_time is null
    or not exists(select 1 from public.booking_request_payment_required_expiry_work expiry
      where expiry.id=target.expiry_work_id and expiry.booking_request_id=work.booking_request_id
        and expiry.payment_required_deadline=work.payment_required_deadline) then
    raise exception 'Expiry release target is invalid' using errcode='RC409'; end if;
  if target.owner='recovery' then
    select * into operation from public.booking_request_payment_recovery_operations operations
      where operations.id=target.recovery_operation_id;
    select * into recovery from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=operation.recovery_attempt_id and attempts.booking_request_id=work.booking_request_id;
    if operation.step is distinct from (case when target.authorization_payment_lifecycle_id=work.payment_lifecycle_id
      then 'original-release' else 'replacement-release' end) then
      raise exception 'Expiry recovery release is invalid' using errcode='RC409'; end if;
    ledger := public.validate_booking_request_recovery_operation(operation,
      public.booking_request_recovery_execution_permit(recovery,work,payment_snapshot,operation.step));
  else
    if target.release_logical_operation_id is distinct from release_identity
      or target.release_physical_attempt_id is distinct from release_identity||':1'
      or target.provider_idempotency_key is distinct from release_identity||':1'
      or target.recovery_operation_id is not null then
      raise exception 'Expiry release identity is invalid' using errcode='RC409'; end if;
    if target.provider_operation_id is null then return null; end if;
    select * into ledger from public.simulated_payment_provider_operations operations
      where operations.id=target.provider_operation_id for update of operations;
    if ledger.recovery_attempt_id is not null or ledger.capture_execution_permit is not null
      or ledger.created_at < work.payment_required_deadline then
      raise exception 'Expiry provider ownership is invalid' using errcode='RC409'; end if;
  end if;
  if ledger.id is null or ledger.id is distinct from target.provider_operation_id
    or (ledger.operation_kind,ledger.claim_id,ledger.claim_generation,ledger.payment_lifecycle_id,
      ledger.logical_operation_id,ledger.physical_attempt_id,ledger.provider_idempotency_key,
      ledger.amount_fils,ledger.currency,ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,
      ledger.request_fingerprint) is distinct from
    ('release',target.authorization_claim_id,target.authorization_claim_generation,target.authorization_payment_lifecycle_id,
      target.release_logical_operation_id,target.release_physical_attempt_id,target.provider_idempotency_key,
      target.amount_fils,target.currency,target.provider,target.environment,target.merchant_id,target.terminal_id,
      target.request_fingerprint)
    or ledger.physical_execution_count <> 1
    or (ledger.original_outcome <> 'indeterminate' and ledger.current_outcome <> ledger.original_outcome)
    or (ledger.current_outcome='indeterminate') is distinct from (ledger.authoritative_outcome_at is null)
    or (ledger.current_outcome='failed') is distinct from (ledger.movement_reference is null)
    or ledger.authoritative_outcome_at < ledger.created_at
    or ledger.created_at < predecessor_time then
    raise exception 'Expiry provider evidence is invalid' using errcode='RC409'; end if;
  return ledger;
end;
$$;
revoke all on function public.validate_booking_request_payment_required_expiry_target(
  public.booking_request_payment_required_expiry_operations,public.booking_request_capture_work,jsonb
) from public,anon,authenticated,service_role;

create function public.booking_request_payment_required_expiry_completed(target_booking_request_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare request public.booking_requests;
declare expiry public.booking_request_payment_required_expiry_work;
begin
  select * into request from public.booking_requests requests
    where requests.id=target_booking_request_id for update of requests;
  select * into expiry from public.booking_request_payment_required_expiry_work work
    where work.booking_request_id=target_booking_request_id;
  return request.id is not null and request.status='expired' and expiry.state='complete'
    and request.settled_at=expiry.completed_at
    and exists(select 1 from public.booking_request_capture_work work
      where work.booking_request_id=request.id and work.state='payment_required'
        and work.payment_required_deadline=expiry.payment_required_deadline
        and expiry.completed_at >= work.payment_required_deadline)
    and exists(select 1 from public.cottage_booking_period_commitments commitment
      where commitment.id=request.booking_period_commitment_id and commitment.status='released_hold')
    and not exists(select 1 from public.cottage_booking_period_occupancies occupancy
      where occupancy.booking_period_commitment_id=request.booking_period_commitment_id and occupancy.active)
    and not exists(select 1 from public.booking_confirmations confirmation where confirmation.booking_request_id=request.id);
end;
$$;
revoke all on function public.booking_request_payment_required_expiry_completed(uuid)
  from public,anon,authenticated,service_role;

create function public.prepare_booking_request_payment_required_expiry(
  target_booking_request_id uuid,target_provider_identity jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare expiry public.booking_request_payment_required_expiry_work;
declare recovery record;
declare recovery_attempt public.booking_request_payment_recovery_attempts;
declare release_operation public.booking_request_payment_recovery_operations;
declare release_ledger public.simulated_payment_provider_operations;
declare authorization_ledger public.simulated_payment_provider_operations;
declare expected_permit jsonb;
declare unresolved_reason text;
declare target public.booking_request_payment_required_expiry_operations;
declare instruction jsonb;
declare request public.booking_requests;
declare capture_work public.booking_request_capture_work;
begin
  if current_setting('role',true) <> 'service_role' or target_booking_request_id is null then
    raise exception 'Payment Required expiry preparation is unavailable' using errcode='42501';
  end if;
  if public.booking_request_payment_required_expiry_completed(target_booking_request_id) then
    return jsonb_build_object('status','expired','bookingRequestId',target_booking_request_id);
  end if;
  select * into request from public.booking_requests requests where requests.id=target_booking_request_id;
  select * into capture_work from public.booking_request_capture_work work where work.booking_request_id=target_booking_request_id;
  if request.status is distinct from 'accepted' or capture_work.state is distinct from 'payment_required'
    or public.booking_request_payment_required_expiry_provider_matches(capture_work,target_provider_identity) is not true then
    raise exception 'Payment Required expiry source is invalid' using errcode='RC409'; end if;
  begin
    select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  exception when sqlstate 'RC409' or invalid_text_representation or numeric_value_out_of_range then
    if clock_timestamp() < capture_work.payment_required_deadline then
      return jsonb_build_object('status','not-due'); end if;
    insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline,
      state,diagnostic_reason) values(target_booking_request_id,capture_work.payment_required_deadline,
        'attention_required','source-evidence-invalid')
      on conflict(booking_request_id) do update set state='attention_required',
        diagnostic_reason='source-evidence-invalid',last_evaluated_at=clock_timestamp();
    return jsonb_build_object('status','attention-required');
  end;
  if not found or (source.work).state <> 'payment_required'
    or not public.booking_request_payment_required_expiry_provider_matches(source.work,target_provider_identity) then
    raise exception 'Payment Required expiry source is invalid' using errcode='RC409';
  end if;
  if exists(select 1 from public.booking_confirmations confirmations
    where confirmations.booking_request_id=target_booking_request_id) then
    return jsonb_build_object('status','confirmed');
  end if;
  if clock_timestamp() < (source.work).payment_required_deadline then
    return jsonb_build_object('status','not-due','deadline',
      to_char((source.work).payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;
  insert into public.booking_request_payment_required_expiry_work(
    booking_request_id,payment_required_deadline
  ) values(target_booking_request_id,(source.work).payment_required_deadline)
  on conflict(booking_request_id) do nothing;
  select * into expiry from public.booking_request_payment_required_expiry_work work
    where work.booking_request_id=target_booking_request_id for update of work;
  if expiry.payment_required_deadline is distinct from (source.work).payment_required_deadline then
    raise exception 'Payment Required expiry deadline binding is invalid' using errcode='RC409';
  end if;
  if expiry.state='complete' then
    return jsonb_build_object('status','expired','expiryWorkId',expiry.id);
  end if;

  if (source.ledger).id is null or (source.ledger).operation_kind <> 'capture'
    or (source.ledger).current_outcome <> 'failed'
    or (source.ledger).movement_reference is not null
    or (source.ledger).original_outcome <> 'failed' then
    unresolved_reason := 'original-capture-unresolved';
  end if;

  if unresolved_reason is null then
    for recovery in
      select attempts as attempt,operations as operation
      from public.booking_request_payment_recovery_attempts attempts
      join public.booking_request_payment_recovery_operations operations
        on operations.recovery_attempt_id=attempts.id
      where attempts.booking_request_id=target_booking_request_id
      order by attempts.generation,
        case operations.step when 'original-release' then 1
          when 'replacement-authorization' then 2 when 'replacement-capture' then 3 else 4 end
    loop
      begin
        expected_permit := public.booking_request_recovery_execution_permit(
          recovery.attempt,source.work,source.payment_snapshot,(recovery.operation).step
        );
        perform public.validate_booking_request_recovery_operation(
          recovery.operation,expected_permit
        );
      exception when sqlstate 'RC409' then
        unresolved_reason := 'recovery-evidence-invalid';
      end;
      exit when unresolved_reason is not null;
    end loop;
  end if;

  if unresolved_reason is null and exists(
    select 1
    from public.simulated_payment_provider_operations ledger
    join public.booking_request_payment_recovery_attempts attempts
      on attempts.id=ledger.recovery_attempt_id
    where attempts.booking_request_id=target_booking_request_id
      and not exists(
        select 1 from public.booking_request_payment_recovery_operations operations
        where operations.provider_operation_id=ledger.id
          and operations.recovery_attempt_id=attempts.id
      )
  ) then unresolved_reason := 'unexplained-recovery-provider-operation'; end if;

  if unresolved_reason is null and exists(
    select 1 from public.booking_request_payment_recovery_operations operations
    join public.booking_request_payment_recovery_attempts attempts
      on attempts.id=operations.recovery_attempt_id
    where attempts.booking_request_id=target_booking_request_id
      and operations.step in ('replacement-authorization','replacement-capture')
      and operations.outcome='indeterminate'
  ) then unresolved_reason := 'recovery-operation-indeterminate'; end if;

  if unresolved_reason is null and exists(
    select 1 from public.booking_request_payment_recovery_operations operations
    join public.booking_request_payment_recovery_attempts attempts
      on attempts.id=operations.recovery_attempt_id
    join public.simulated_payment_provider_operations ledger
      on ledger.id=operations.provider_operation_id
    where attempts.booking_request_id=target_booking_request_id
      and operations.step='replacement-capture' and ledger.current_outcome='succeeded'
  ) then unresolved_reason := 'replacement-capture-succeeded'; end if;

  if unresolved_reason is null and exists(
    select 1 from public.simulated_payment_provider_operations ledger
    where (ledger.claim_id=(source.work).authorization_claim_id
      or ledger.payment_lifecycle_id=(source.work).payment_lifecycle_id
      or exists(select 1 from public.booking_request_payment_recovery_attempts attempts
        where attempts.booking_request_id=target_booking_request_id and attempts.id=ledger.payment_lifecycle_id))
      and ledger.id is distinct from (source.ledger).id
      and not exists(select 1 from public.booking_request_payment_recovery_operations operations
        join public.booking_request_payment_recovery_attempts attempts on attempts.id=operations.recovery_attempt_id
        where attempts.booking_request_id=target_booking_request_id and operations.provider_operation_id=ledger.id)
      and ledger.operation_kind in ('authorization','capture','release')
      and not exists(select 1 from public.booking_request_payment_required_expiry_operations owned
        where owned.expiry_work_id=expiry.id and owned.provider_operation_id=ledger.id)
      and not (ledger.operation_kind='authorization'
        and (ledger.payment_lifecycle_id,ledger.logical_operation_id,ledger.physical_attempt_id,
          ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,
          ledger.amount_fils,ledger.currency,ledger.provider_request_id,ledger.provider_reference,ledger.movement_reference)
          is not distinct from
        ((source.work).payment_lifecycle_id,(source.work).authorization_logical_operation_id,
          (source.work).authorization_physical_attempt_id,(source.work).provider,(source.work).environment,
          (source.work).merchant_id,(source.work).terminal_id,(source.work).amount_fils,(source.work).currency,
          source.payment_snapshot#>>'{authorization,providerRequestId}',
          source.payment_snapshot#>>'{authorization,providerReference}',
          source.payment_snapshot#>>'{authorization,movementReference}')
        and ledger.current_outcome='succeeded' and ledger.original_outcome in ('succeeded','indeterminate')
        and ledger.physical_execution_count=1)
  ) then unresolved_reason := 'unexplained-provider-operation'; end if;

  if unresolved_reason is null then
    select operations.* into release_operation
    from public.booking_request_payment_recovery_operations operations
    join public.booking_request_payment_recovery_attempts attempts
      on attempts.id=operations.recovery_attempt_id
    where attempts.booking_request_id=target_booking_request_id
      and operations.step='original-release'
    order by attempts.generation limit 1;
    if release_operation.id is not null then
      select * into recovery_attempt
      from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=release_operation.recovery_attempt_id;
      expected_permit := public.booking_request_recovery_execution_permit(
        recovery_attempt,source.work,source.payment_snapshot,'original-release'
      );
      release_ledger := public.validate_booking_request_recovery_operation(
        release_operation,expected_permit
      );
      insert into public.booking_request_payment_required_expiry_operations(
        expiry_work_id,booking_request_id,owner,recovery_operation_id,provider_operation_id,
        authorization_claim_id,authorization_claim_generation,
        authorization_payment_lifecycle_id,authorization_logical_operation_id,
        authorization_physical_attempt_id,predecessor_movement_reference,
        predecessor_outcome_at,release_logical_operation_id,release_physical_attempt_id,
        provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
        request_fingerprint
      ) values(expiry.id,target_booking_request_id,'recovery',release_operation.id,release_ledger.id,
        (source.work).authorization_claim_id,(source.work).authorization_claim_generation,
        (source.work).payment_lifecycle_id,(source.work).authorization_logical_operation_id,
        (source.work).authorization_physical_attempt_id,
        source.payment_snapshot#>>'{authorization,movementReference}',
        (source.payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz,
        release_ledger.logical_operation_id,release_ledger.physical_attempt_id,
        release_ledger.provider_idempotency_key,(source.work).amount_fils,(source.work).currency,
        (source.work).provider,(source.work).environment,(source.work).merchant_id,
        (source.work).terminal_id,(source.work).request_fingerprint)
      on conflict do nothing;
      if release_ledger.current_outcome <> 'succeeded' then
        unresolved_reason := case when release_ledger.current_outcome='indeterminate'
          then 'original-release-indeterminate' else 'original-release-failed' end;
      end if;
    else
      insert into public.booking_request_payment_required_expiry_operations(
        expiry_work_id,booking_request_id,owner,
        authorization_claim_id,authorization_claim_generation,
        authorization_payment_lifecycle_id,authorization_logical_operation_id,
        authorization_physical_attempt_id,predecessor_movement_reference,
        predecessor_outcome_at,release_logical_operation_id,release_physical_attempt_id,
        provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
        request_fingerprint
      ) values(
        expiry.id,target_booking_request_id,'expiry',(source.work).authorization_claim_id,
        (source.work).authorization_claim_generation,(source.work).payment_lifecycle_id,
        (source.work).authorization_logical_operation_id,(source.work).authorization_physical_attempt_id,
        source.payment_snapshot#>>'{authorization,movementReference}',
        (source.payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz,
        expiry.id::text||':original-release',expiry.id::text||':original-release:1',
        expiry.id::text||':original-release:1',(source.work).amount_fils,(source.work).currency,
        (source.work).provider,(source.work).environment,(source.work).merchant_id,(source.work).terminal_id,
        (source.work).request_fingerprint
      ) on conflict do nothing;
    end if;
  end if;

  if unresolved_reason is null then
    for recovery in
      select attempts as attempt,operations as operation
      from public.booking_request_payment_recovery_attempts attempts
      join public.booking_request_payment_recovery_operations operations
        on operations.recovery_attempt_id=attempts.id
      where attempts.booking_request_id=target_booking_request_id
        and operations.step='replacement-authorization'
        and operations.outcome='succeeded'
      order by attempts.generation
    loop
      expected_permit := public.booking_request_recovery_execution_permit(
        recovery.attempt,source.work,source.payment_snapshot,'replacement-authorization'
      );
      authorization_ledger := public.validate_booking_request_recovery_operation(
        recovery.operation,expected_permit
      );
      if authorization_ledger.current_outcome <> 'succeeded' then
        unresolved_reason := 'replacement-authorization-invalid';
        exit;
      end if;
      select operations.* into release_operation
      from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=(recovery.attempt).id
        and operations.step='replacement-release';
      if release_operation.id is not null then
        expected_permit := public.booking_request_recovery_execution_permit(
          recovery.attempt,source.work,source.payment_snapshot,'replacement-release'
        );
        release_ledger := public.validate_booking_request_recovery_operation(
          release_operation,expected_permit
        );
        insert into public.booking_request_payment_required_expiry_operations(
          expiry_work_id,booking_request_id,owner,recovery_operation_id,provider_operation_id,
          authorization_claim_id,authorization_claim_generation,
          authorization_payment_lifecycle_id,authorization_logical_operation_id,
          authorization_physical_attempt_id,predecessor_movement_reference,
          predecessor_outcome_at,release_logical_operation_id,release_physical_attempt_id,
          provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
          request_fingerprint
        ) values(expiry.id,target_booking_request_id,'recovery',release_operation.id,release_ledger.id,
          authorization_ledger.claim_id,authorization_ledger.claim_generation,
          authorization_ledger.payment_lifecycle_id,authorization_ledger.logical_operation_id,
          authorization_ledger.physical_attempt_id,authorization_ledger.movement_reference,
          authorization_ledger.authoritative_outcome_at,release_ledger.logical_operation_id,
          release_ledger.physical_attempt_id,release_ledger.provider_idempotency_key,
          authorization_ledger.amount_fils,authorization_ledger.currency,
          authorization_ledger.provider,authorization_ledger.environment,
          authorization_ledger.merchant_id,authorization_ledger.terminal_id,
          authorization_ledger.request_fingerprint)
        on conflict do nothing;
        if release_ledger.current_outcome <> 'succeeded' then
          unresolved_reason := case when release_ledger.current_outcome='indeterminate'
            then 'replacement-release-indeterminate' else 'replacement-release-failed' end;
          exit;
        end if;
      else
        insert into public.booking_request_payment_required_expiry_operations(
          expiry_work_id,booking_request_id,owner,
          authorization_claim_id,authorization_claim_generation,
          authorization_payment_lifecycle_id,authorization_logical_operation_id,
          authorization_physical_attempt_id,predecessor_movement_reference,
          predecessor_outcome_at,release_logical_operation_id,release_physical_attempt_id,
          provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
          request_fingerprint
        ) values(expiry.id,target_booking_request_id,'expiry',authorization_ledger.claim_id,
          authorization_ledger.claim_generation,authorization_ledger.payment_lifecycle_id,
          authorization_ledger.logical_operation_id,authorization_ledger.physical_attempt_id,
          authorization_ledger.movement_reference,authorization_ledger.authoritative_outcome_at,
          expiry.id::text||':replacement-release:'||(recovery.attempt).generation::text,
          expiry.id::text||':replacement-release:'||(recovery.attempt).generation::text||':1',
          expiry.id::text||':replacement-release:'||(recovery.attempt).generation::text||':1',
          authorization_ledger.amount_fils,authorization_ledger.currency,
          authorization_ledger.provider,authorization_ledger.environment,
          authorization_ledger.merchant_id,authorization_ledger.terminal_id,
          authorization_ledger.request_fingerprint)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  if unresolved_reason is null then
    for target in select operations.* from public.booking_request_payment_required_expiry_operations operations
      where operations.expiry_work_id=expiry.id order by operations.created_at,operations.id
    loop
      begin
        release_ledger := public.validate_booking_request_payment_required_expiry_target(target,source.work,source.payment_snapshot);
      exception when sqlstate 'RC409' then unresolved_reason := 'expiry-evidence-invalid'; end;
      exit when unresolved_reason is not null;
      if release_ledger.id is null then
        if instruction is null then
          expected_permit := public.booking_request_payment_required_expiry_permit(target,expiry.payment_required_deadline);
          instruction := jsonb_build_object('status','release','permit',expected_permit,'binding',expected_permit->'binding');
        end if;
      elsif release_ledger.current_outcome='failed' then
        unresolved_reason := 'expiry-release-failed'; exit;
      elsif release_ledger.current_outcome='indeterminate' then
        unresolved_reason := 'expiry-release-indeterminate';
        expected_permit := public.booking_request_payment_required_expiry_permit(target,expiry.payment_required_deadline);
        instruction := jsonb_build_object('status','reconcile-expiry','permit',expected_permit,'binding',expected_permit->'binding',
          'providerRequestId',release_ledger.provider_request_id,'providerReference',release_ledger.provider_reference);
        exit;
      end if;
    end loop;
  end if;
  if unresolved_reason in ('recovery-operation-indeterminate','original-release-indeterminate','replacement-release-indeterminate') then
    select operations.* into release_operation from public.booking_request_payment_recovery_operations operations
      join public.booking_request_payment_recovery_attempts attempts on attempts.id=operations.recovery_attempt_id
      where attempts.booking_request_id=target_booking_request_id and operations.outcome='indeterminate'
      order by attempts.generation,operations.created_at,operations.id limit 1;
    select * into recovery_attempt from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=release_operation.recovery_attempt_id;
    expected_permit := public.booking_request_recovery_execution_permit(recovery_attempt,source.work,source.payment_snapshot,release_operation.step);
    release_ledger := public.validate_booking_request_recovery_operation(release_operation,expected_permit);
    instruction := jsonb_build_object('status','reconcile-recovery','permit',expected_permit,'binding',expected_permit->'binding',
      'providerRequestId',release_ledger.provider_request_id,'providerReference',release_ledger.provider_reference);
  end if;
  update public.booking_request_payment_required_expiry_work work
    set state=case when unresolved_reason is null then 'processing' else 'attention_required' end,
      diagnostic_reason=unresolved_reason,last_evaluated_at=clock_timestamp()
    where work.id=expiry.id;
  if unresolved_reason is not null and coalesce(instruction->>'status','') not in ('reconcile-expiry','reconcile-recovery') then
    return jsonb_build_object('status','attention-required','reason',unresolved_reason);
  end if;
  return coalesce(instruction,jsonb_build_object('status','ready'));

end;
$$;
revoke all on function public.prepare_booking_request_payment_required_expiry(uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.prepare_booking_request_payment_required_expiry(uuid,jsonb)
  to service_role;

create or replace function public.claim_customer_booking_request_payment_recovery(
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
    or exists (select 1 from public.booking_request_payment_required_expiry_work expiry
      where expiry.booking_request_id=request.id)
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

create or replace function public.lease_booking_request_payment_recovery_step(target_attempt_id uuid)
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
  if public.booking_request_payment_required_expiry_completed((
    select attempts.booking_request_id from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=target_attempt_id
  )) then return jsonb_build_object('status','deadline-elapsed'); end if;
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
  if exists(
    select 1 from public.booking_request_payment_required_expiry_operations expiry_operations
    where expiry_operations.booking_request_id=attempt.booking_request_id
      and expiry_operations.owner='expiry'
      and expiry_operations.authorization_payment_lifecycle_id=
        (permit#>>'{binding,paymentLifecycleId}')::uuid
      and expiry_operations.predecessor_movement_reference=
        permit#>>'{binding,predecessorMovementReference}'
  ) then return jsonb_build_object('status','deadline-elapsed'); end if;
  -- Check the clock after every source, recovery and expiry-ownership lock.
  if step <> 'replacement-release' and clock_timestamp() >= (source.work).payment_required_deadline then
    return jsonb_build_object('status','deadline-elapsed'); end if;
  return jsonb_build_object('status','leased','permit',permit,'binding',permit->'binding');
end;
$$;

create or replace function public.execute_simulated_booking_request_payment_recovery(
  target_permit jsonb,target_outcome text
)
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
  if public.booking_request_payment_required_expiry_completed((
    select attempts.booking_request_id from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=(target_permit->>'attemptId')::uuid
  )) then
    select * into attempt from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=(target_permit->>'attemptId')::uuid;
    select * into source from public.lock_booking_request_payment_required_expiry_source(attempt.booking_request_id);
    work := source.work;
    expected := public.booking_request_recovery_execution_permit(attempt,work,source.payment_snapshot,recovery_step);
    if target_permit is distinct from expected then raise exception 'Recovery permit is invalid' using errcode='RC409'; end if;
    select * into previous from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=attempt.id and operations.step=recovery_step;
    if previous.id is null then return jsonb_build_object('outcome','not-executed'); end if;
    ledger := public.validate_booking_request_recovery_operation(previous,expected);
    if ledger.current_outcome='indeterminate' then raise exception 'Completed expiry evidence is invalid' using errcode='RC409'; end if;
    return jsonb_strip_nulls(jsonb_build_object('outcome',ledger.current_outcome,
      'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
      'movementReference',ledger.movement_reference,'retrySafe',attempt.state='safely_failed'));
  end if;
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
  -- Revalidate ownership and the deadline while still holding the request-first source lock.
  if exists(
    select 1 from public.booking_request_payment_required_expiry_operations expiry_operations
    where expiry_operations.booking_request_id=attempt.booking_request_id
      and expiry_operations.owner='expiry'
      and expiry_operations.authorization_payment_lifecycle_id=
        (expected#>>'{binding,paymentLifecycleId}')::uuid
      and expiry_operations.predecessor_movement_reference=
        expected#>>'{binding,predecessorMovementReference}'
  ) or (recovery_step <> 'replacement-release' and clock_timestamp() >= work.payment_required_deadline) then
    return jsonb_build_object('outcome','not-executed');
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

create or replace function public.due_booking_request_payment_recoveries(target_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role',true) <> 'service_role' or target_limit is null or target_limit < 1 or target_limit > 50 then
    raise exception 'Recovery batch is unavailable' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(id),'[]'::jsonb) from (
    select attempts.id from public.booking_request_payment_recovery_attempts attempts
    join public.booking_requests requests on requests.id=attempts.booking_request_id
    where requests.status='accepted' and
      (attempts.state='succeeded' or attempts.state='capture_failed'
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

create function public.lock_booking_request_payment_required_expiry_source(target_booking_request_id uuid)
returns table(work public.booking_request_capture_work,payment_snapshot jsonb,
  expiry public.booking_request_payment_required_expiry_work)
language plpgsql security definer set search_path = '' as $$
declare source record;
begin
  if public.booking_request_payment_required_expiry_completed(target_booking_request_id) then
    select * into work from public.booking_request_capture_work capture_work
      where capture_work.booking_request_id=target_booking_request_id for update of capture_work;
    select attempts.payment_snapshot into payment_snapshot from public.booking_request_submission_attempts attempts
      where attempts.id=work.attempt_id for update of attempts;
  else
    select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
    work := source.work; payment_snapshot := source.payment_snapshot;
  end if;
  select * into expiry from public.booking_request_payment_required_expiry_work expiry_work
    where expiry_work.booking_request_id=target_booking_request_id for update of expiry_work;
  if work.booking_request_id is null or work.state <> 'payment_required' or expiry.id is null
    or expiry.payment_required_deadline is distinct from work.payment_required_deadline then
    raise exception 'Expiry execution source is invalid' using errcode='RC409'; end if;
  return next;
end;
$$;
revoke all on function public.lock_booking_request_payment_required_expiry_source(uuid)
  from public,anon,authenticated,service_role;

create function public.execute_simulated_booking_request_payment_required_expiry(target_permit jsonb,target_outcome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare target public.booking_request_payment_required_expiry_operations;
declare ledger public.simulated_payment_provider_operations;
declare expected jsonb;
declare prepared jsonb;
declare operation_id uuid := gen_random_uuid();
declare outcome_time timestamptz;
begin
  if current_setting('role',true) <> 'service_role' or target_outcome is null
    or target_outcome not in ('succeeded','failed','indeterminate') then
    raise exception 'Expiry execution is unavailable' using errcode='42501'; end if;
  select * into source from public.lock_booking_request_payment_required_expiry_source((target_permit#>>'{binding,bookingRequestId}')::uuid);
  select * into target from public.booking_request_payment_required_expiry_operations operations
    where operations.id=(target_permit->>'expiryOperationId')::uuid
      and operations.expiry_work_id=(source.expiry).id for update of operations;
  expected := public.booking_request_payment_required_expiry_permit(target,(source.expiry).payment_required_deadline);
  if target.id is null or target.owner <> 'expiry' or target_permit is distinct from expected then
    raise exception 'Expiry permit is invalid' using errcode='RC409'; end if;
  ledger := public.validate_booking_request_payment_required_expiry_target(target,source.work,source.payment_snapshot);
  if ledger.id is null then
    if (source.expiry).state='complete' or clock_timestamp() < (source.work).payment_required_deadline then
      return jsonb_build_object('outcome','not-executed'); end if;
    prepared := public.prepare_booking_request_payment_required_expiry((source.work).booking_request_id,
      expected#>'{binding,providerIdentity}');
    if prepared->>'status' <> 'release' or prepared->'permit' is distinct from expected then
      return jsonb_build_object('outcome','not-executed'); end if;
    outcome_time := clock_timestamp();
    if outcome_time < (source.work).payment_required_deadline then
      return jsonb_build_object('outcome','not-executed'); end if;
    insert into public.simulated_payment_provider_operations(
      id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
      provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,
      amount_fils,currency,original_outcome,current_outcome,provider_request_id,provider_reference,
      movement_reference,authoritative_outcome_at,created_at,updated_at
    ) values(operation_id,target.authorization_claim_id,target.authorization_claim_generation,'release',
      target.provider,target.environment,target.merchant_id,target.terminal_id,target.provider_idempotency_key,
      target.request_fingerprint,target.authorization_payment_lifecycle_id,target.release_logical_operation_id,
      target.release_physical_attempt_id,target.amount_fils,target.currency,target_outcome,target_outcome,
      'sim-expiry-request-'||operation_id,'sim-expiry-reference-'||operation_id,
      case when target_outcome='failed' then null else 'sim-expiry-movement-'||operation_id end,
      case when target_outcome='indeterminate' then null else outcome_time end,outcome_time,outcome_time)
      returning * into ledger;
    update public.booking_request_payment_required_expiry_operations operations set provider_operation_id=ledger.id
      where operations.id=target.id;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('outcome',ledger.current_outcome,
    'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
    'movementReference',ledger.movement_reference,'retrySafe',false));
end;
$$;
revoke all on function public.execute_simulated_booking_request_payment_required_expiry(jsonb,text)
  from public,anon,authenticated;
grant execute on function public.execute_simulated_booking_request_payment_required_expiry(jsonb,text) to service_role;

create function public.query_simulated_booking_request_payment_required_expiry(
  target_permit jsonb,target_provider_request_id text,target_provider_reference text,target_outcome text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare target public.booking_request_payment_required_expiry_operations;
declare ledger public.simulated_payment_provider_operations;
declare expected jsonb;
declare outcome_time timestamptz;
begin
  if current_setting('role',true) <> 'service_role' or target_outcome is null
    or target_outcome not in ('succeeded','failed','indeterminate') then
    raise exception 'Expiry query is unavailable' using errcode='42501'; end if;
  select * into source from public.lock_booking_request_payment_required_expiry_source((target_permit#>>'{binding,bookingRequestId}')::uuid);
  select * into target from public.booking_request_payment_required_expiry_operations operations
    where operations.id=(target_permit->>'expiryOperationId')::uuid
      and operations.expiry_work_id=(source.expiry).id for update of operations;
  expected := public.booking_request_payment_required_expiry_permit(target,(source.expiry).payment_required_deadline);
  if target.id is null or target.owner <> 'expiry' or target_permit is distinct from expected then
    raise exception 'Expiry query binding is invalid' using errcode='RC409'; end if;
  ledger := public.validate_booking_request_payment_required_expiry_target(target,source.work,source.payment_snapshot);
  if ledger.id is null or ledger.provider_request_id is distinct from target_provider_request_id
    or ledger.provider_reference is distinct from target_provider_reference then
    raise exception 'Expiry query binding is invalid' using errcode='RC409'; end if;
  if ledger.current_outcome='indeterminate' and target_outcome <> 'indeterminate' then
    if (source.expiry).state='complete' then raise exception 'Completed expiry evidence is invalid' using errcode='RC409'; end if;
    outcome_time := clock_timestamp();
    update public.simulated_payment_provider_operations operations set current_outcome=target_outcome,
      authoritative_outcome_at=outcome_time,updated_at=outcome_time,
      movement_reference=case when target_outcome='failed' then null else ledger.movement_reference end
      where operations.id=ledger.id returning * into ledger;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('outcome',ledger.current_outcome,
    'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
    'movementReference',ledger.movement_reference,'retrySafe',false));
end;
$$;
revoke all on function public.query_simulated_booking_request_payment_required_expiry(jsonb,text,text,text)
  from public,anon,authenticated;
grant execute on function public.query_simulated_booking_request_payment_required_expiry(jsonb,text,text,text) to service_role;

create function public.finalize_booking_request_payment_required_expiry(target_booking_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  select * into work from public.booking_request_capture_work capture_work where capture_work.booking_request_id=target_booking_request_id;
  prepared := public.prepare_booking_request_payment_required_expiry(target_booking_request_id,
    jsonb_build_object('provider',work.provider,'environment',work.environment,'merchantId',work.merchant_id,'terminalId',work.terminal_id));
  if prepared->>'status' <> 'ready' then
    return jsonb_build_object('status',case when prepared->>'status' in ('release') then 'processing'
      when prepared->>'status' in ('reconcile-expiry','reconcile-recovery') then 'attention-required'
      else prepared->>'status' end,'bookingRequestId',target_booking_request_id);
  end if;
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
    update public.booking_request_payment_required_expiry_work expiry set state='attention_required',
      diagnostic_reason='inventory-evidence-invalid',last_evaluated_at=clock_timestamp() where expiry.booking_request_id=request.id;
    return jsonb_build_object('status','attention-required','bookingRequestId',request.id);
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
$$;
revoke all on function public.finalize_booking_request_payment_required_expiry(uuid) from public,anon,authenticated;
grant execute on function public.finalize_booking_request_payment_required_expiry(uuid) to service_role;

create or replace function public.query_simulated_booking_request_payment_recovery(
  target_permit jsonb,target_provider_request_id text,target_provider_reference text,target_outcome text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare previous public.booking_request_payment_recovery_operations;
declare ledger public.simulated_payment_provider_operations;
declare expected jsonb;
declare outcome_time timestamptz;
declare request_id uuid;
declare replay_attempt public.booking_request_payment_recovery_attempts;
declare replay_source record;
begin
  if current_setting('role',true) <> 'service_role' or target_outcome is null
    or target_outcome not in ('succeeded','failed','indeterminate') then
    raise exception 'Recovery query is unavailable' using errcode='42501'; end if;
  select attempts.booking_request_id into request_id from public.booking_request_payment_recovery_attempts attempts
    where attempts.id=(target_permit->>'attemptId')::uuid;
  if public.booking_request_payment_required_expiry_completed(request_id) then
    select * into replay_source from public.lock_booking_request_payment_required_expiry_source(request_id);
    select * into replay_attempt from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=(target_permit->>'attemptId')::uuid for update of attempts;
    expected := public.booking_request_recovery_execution_permit(replay_attempt,replay_source.work,
      replay_source.payment_snapshot,target_permit->>'step');
    select * into previous from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=replay_attempt.id and operations.step=target_permit->>'step';
    ledger := public.validate_booking_request_recovery_operation(previous,expected);
    if target_permit is distinct from expected or ledger.current_outcome='indeterminate'
      or ledger.provider_request_id is distinct from target_provider_request_id
      or ledger.provider_reference is distinct from target_provider_reference then
      raise exception 'Recovery query binding is invalid' using errcode='RC409'; end if;
    return jsonb_strip_nulls(jsonb_build_object('outcome',ledger.current_outcome,
      'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
      'movementReference',ledger.movement_reference,'retrySafe',replay_attempt.state='safely_failed'));
  end if;
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


-- Participants receive only verified expiry state and the original payment deadline.
create function public.booking_request_payment_required_expiry_status(target_request public.booking_requests)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when capture.state='payment_required'
    and expiry.payment_required_deadline=capture.payment_required_deadline
    and not exists(select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id=target_request.id)
    and ((target_request.status='accepted' and expiry.state in ('processing','attention_required'))
      or (target_request.status='expired' and expiry.state='complete'))
  then jsonb_build_object('status',case expiry.state when 'complete' then 'expired'
    when 'attention_required' then 'attention-required' else 'processing' end,
    'deadline',to_char(capture.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end
  from public.booking_request_capture_work capture
  join public.booking_request_payment_required_expiry_work expiry on expiry.booking_request_id=capture.booking_request_id
  where capture.booking_request_id=target_request.id;
$$;
revoke all on function public.booking_request_payment_required_expiry_status(public.booking_requests)
  from public,anon,authenticated,service_role;

create or replace function public.get_customer_booking_request(target_reference text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',requests.id,'bookingRequestReference',requests.booking_request_reference,
    'status',requests.status,'paymentStatus',public.booking_request_payment_status(requests),
    'paymentRequiredWindow',public.booking_request_payment_required_window(requests),
    'paymentRequiredExpiry',public.booking_request_payment_required_expiry_status(requests),
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

create or replace function public.list_owner_booking_request_notifications()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',requests.id,'bookingRequestReference',requests.booking_request_reference,
    'status',requests.status,'paymentStatus',public.booking_request_payment_status(requests),
    'paymentRequiredWindow',public.booking_request_payment_required_window(requests),
    'paymentRequiredExpiry',public.booking_request_payment_required_expiry_status(requests),
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
