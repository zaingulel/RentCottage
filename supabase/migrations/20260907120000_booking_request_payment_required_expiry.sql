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
    (owner = 'expiry' and recovery_operation_id is null and provider_operation_id is null)
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
    if old.booking_request_id is distinct from new.booking_request_id
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
  elsif old is distinct from new then
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
  select jsonb_typeof(target_provider_identity) = 'object'
    and target_provider_identity ?& array['provider','environment','merchantId','terminalId']
    and target_provider_identity - array['provider','environment','merchantId','terminalId'] = '{}'::jsonb
    and jsonb_strip_nulls(target_provider_identity) = target_provider_identity
    and jsonb_typeof(target_provider_identity->'provider') = 'string'
    and jsonb_typeof(target_provider_identity->'environment') = 'string'
    and jsonb_typeof(target_provider_identity->'merchantId') = 'string'
    and jsonb_typeof(target_provider_identity->'terminalId') = 'string'
    and (target_provider_identity->>'provider',target_provider_identity->>'environment',
      target_provider_identity->>'merchantId',target_provider_identity->>'terminalId') is not distinct from
      (target_work.provider,target_work.environment,target_work.merchant_id,target_work.terminal_id);
$$;
revoke all on function public.booking_request_payment_required_expiry_provider_matches(
  public.booking_request_capture_work,jsonb
) from public,anon,authenticated,service_role;

create function public.claim_due_booking_request_payment_required_expiries(
  target_limit integer,target_provider_identity jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare provider_work public.booking_request_capture_work;
begin
  if current_setting('role',true) <> 'service_role'
    or target_limit is null or target_limit < 1 or target_limit > 50 then
    raise exception 'Payment Required expiry batch is unavailable' using errcode='42501';
  end if;
  select * into provider_work from public.booking_request_capture_work work
  where work.state='payment_required'
  order by work.booking_request_id limit 1;
  if provider_work.booking_request_id is not null
    and not public.booking_request_payment_required_expiry_provider_matches(
      provider_work,target_provider_identity
    ) then
    raise exception 'Payment Required expiry provider is invalid' using errcode='RC409';
  end if;
  if provider_work.booking_request_id is null and (
    jsonb_typeof(target_provider_identity) <> 'object'
    or target_provider_identity ?& array['provider','environment','merchantId','terminalId'] is not true
    or target_provider_identity - array['provider','environment','merchantId','terminalId'] <> '{}'::jsonb
  ) then
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
  ) due);
end;
$$;
revoke all on function public.claim_due_booking_request_payment_required_expiries(integer,jsonb)
  from public,anon,authenticated;
grant execute on function public.claim_due_booking_request_payment_required_expiries(integer,jsonb)
  to service_role;

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
declare release_count integer;
begin
  if current_setting('role',true) <> 'service_role' or target_booking_request_id is null then
    raise exception 'Payment Required expiry preparation is unavailable' using errcode='42501';
  end if;
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
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
    where ledger.claim_id=(source.work).authorization_claim_id
      and ledger.claim_generation=(source.work).authorization_claim_generation
      and ledger.id is distinct from (source.ledger).id
      and ledger.recovery_attempt_id is null
      and ledger.operation_kind in ('authorization','capture','release')
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

  if unresolved_reason is not null then
    update public.booking_request_payment_required_expiry_work work
      set state='attention_required',diagnostic_reason=unresolved_reason,
        last_evaluated_at=clock_timestamp()
      where work.id=expiry.id;
    return jsonb_build_object('status','attention-required','expiryWorkId',expiry.id,
      'reason',unresolved_reason);
  end if;
  update public.booking_request_payment_required_expiry_work work
    set state='processing',diagnostic_reason=null,last_evaluated_at=clock_timestamp()
    where work.id=expiry.id;
  select count(*) into release_count
  from public.booking_request_payment_required_expiry_operations operations
  where operations.expiry_work_id=expiry.id and operations.owner='expiry';
  return jsonb_build_object('status',case when release_count=0 then 'ready-to-expire'
    else 'release-required' end,'expiryWorkId',expiry.id,'releaseCount',release_count);
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
  ) then return jsonb_build_object('status','expiry-owned'); end if;
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
