-- Owner decisions, Customer withdrawal and deadline expiry are forward-only.
-- Existing release work must remain drainable during a rollback.

alter table public.booking_request_submission_attempts
  add column intent_dedupe_active boolean not null default true;
alter table public.booking_request_submission_attempts
  drop constraint booking_request_submission_at_customer_user_id_intent_finge_key;
create unique index booking_request_submission_active_intent_unique
  on public.booking_request_submission_attempts (
    customer_user_id, intent_fingerprint
  ) where intent_dedupe_active;

alter table public.booking_requests
  drop constraint booking_requests_status_check,
  add constraint booking_requests_status_check check (status in (
    'pending', 'processing', 'accepted', 'declined', 'withdrawn', 'expired'
  )),
  add column outcome_actor_user_id uuid
    references public.account_contexts (user_id) on delete restrict,
  add column decline_reason text check (decline_reason in (
    'cottage_unavailable', 'cannot_accommodate_request', 'other'
  )),
  add column decline_note text check (
    decline_note is null or (
      decline_note = btrim(decline_note)
      and char_length(decline_note) between 1 and 500
      and public.booking_request_content_is_safe(decline_note)
    )
  ),
  add column outcome_fingerprint text check (
    outcome_fingerprint is null or outcome_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  add column settled_at timestamptz;

alter table public.cottage_booking_period_occupancies
  add column active boolean not null default true;
alter table public.cottage_booking_period_occupancies
  drop constraint cottage_booking_period_occupa_schedule_revision_id_shift_id_key;
create unique index cottage_booking_period_active_occupancy_unique
  on public.cottage_booking_period_occupancies (
    schedule_revision_id, shift_id, service_day
  ) where active;

drop trigger reject_cottage_booking_period_occupancy_update
  on public.cottage_booking_period_occupancies;
create or replace function public.reject_cottage_booking_period_occupancy_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.booking_period_commitment_id is distinct from old.booking_period_commitment_id
    or new.schedule_revision_id is distinct from old.schedule_revision_id
    or new.shift_id is distinct from old.shift_id
    or new.service_day is distinct from old.service_day
    or new.created_at is distinct from old.created_at
    or (old.active is false and new.active is true) then
    raise exception 'Booking Period occupancy snapshots are immutable'
      using errcode = 'RC204';
  end if;
  return new;
end;
$$;
create trigger reject_cottage_booking_period_occupancy_update
before update on public.cottage_booking_period_occupancies
for each row execute function public.reject_cottage_booking_period_occupancy_update();

create or replace function public.enforce_cottage_booking_period_commitment_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.customer_user_id is distinct from old.customer_user_id
    or new.profile_id is distinct from old.profile_id
    or new.schedule_revision_id is distinct from old.schedule_revision_id
    or new.access_ranges is distinct from old.access_ranges
    or new.created_at is distinct from old.created_at then
    raise exception 'Booking Period commitment snapshots are immutable'
      using errcode = 'RC204';
  end if;
  if new.status is distinct from old.status and not (
    old.status = 'pending_hold'::public.cottage_inventory_commitment_status
    and new.status in (
      'confirmed_booking'::public.cottage_inventory_commitment_status,
      'released_hold'::public.cottage_inventory_commitment_status
    )
  ) then
    raise exception 'A Booking Period commitment cannot move backwards'
      using errcode = 'RC204';
  end if;
  if new.commitment_reference is distinct from old.commitment_reference
    and not (
      old.status = 'pending_hold'::public.cottage_inventory_commitment_status
      and new.status = 'confirmed_booking'::public.cottage_inventory_commitment_status
    ) then
    raise exception 'A Booking Period reference can change only when its Pending Hold is confirmed'
      using errcode = 'RC204';
  end if;
  return new;
end;
$$;

create table public.booking_request_release_work (
  id uuid primary key default gen_random_uuid(),
  booking_request_id uuid not null unique
    references public.booking_requests (id) on delete restrict,
  attempt_id uuid not null unique
    references public.booking_request_submission_attempts (id) on delete restrict,
  outcome text not null check (outcome in ('declined', 'withdrawn', 'expired')),
  actor_user_id uuid references public.account_contexts (user_id) on delete restrict,
  decline_reason text check (decline_reason in (
    'cottage_unavailable', 'cannot_accommodate_request', 'other'
  )),
  decline_note text check (
    decline_note is null or (
      decline_note = btrim(decline_note)
      and char_length(decline_note) between 1 and 500
      and public.booking_request_content_is_safe(decline_note)
    )
  ),
  outcome_fingerprint text not null check (outcome_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null default 'processing' check (state in ('processing', 'complete')),
  lease_generation bigint not null default 0 check (lease_generation >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  active_operation_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((outcome = 'declined') = (decline_reason is not null)),
  check ((state = 'complete') = (completed_at is not null)),
  check ((lease_token is null) = (lease_expires_at is null)),
  check (state = 'processing' or lease_token is null),
  unique (id, attempt_id)
);

alter table public.booking_request_submission_attempts
  add constraint booking_request_submission_attempt_lifecycle_unique
  unique (id, payment_lifecycle_id);

create table public.booking_request_release_operations (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null,
  attempt_id uuid not null,
  operation_generation integer not null check (operation_generation > 0),
  payment_lifecycle_id uuid not null,
  logical_operation_id text not null,
  physical_attempt_id text not null,
  amount_fils bigint not null check (amount_fils > 0),
  currency text not null check (currency = 'IQD'),
  provider text not null,
  environment text not null,
  merchant_id text not null,
  terminal_id text not null,
  provider_idempotency_key text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null check (state in (
    'executing', 'reconcile_required', 'retryable', 'succeeded'
  )),
  provider_outcome text not null check (provider_outcome in (
    'unknown', 'not_executed', 'failed', 'indeterminate', 'succeeded'
  )),
  provider_request_id text,
  provider_reference text,
  movement_reference text,
  retry_safe boolean not null default false,
  execution_started_at timestamptz not null,
  result_recorded_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (work_id, attempt_id)
    references public.booking_request_release_work (id, attempt_id)
    on delete restrict,
  foreign key (attempt_id, payment_lifecycle_id)
    references public.booking_request_submission_attempts (id, payment_lifecycle_id)
    on delete restrict,
  unique (work_id, id),
  unique (work_id, operation_generation),
  unique (work_id, physical_attempt_id),
  unique (provider, environment, merchant_id, terminal_id, provider_idempotency_key),
  unique (provider, environment, merchant_id, terminal_id, provider_request_id),
  unique (provider, environment, merchant_id, terminal_id, provider_reference),
  unique (provider, environment, merchant_id, terminal_id, movement_reference)
);

alter table public.booking_request_release_work
  add constraint booking_request_release_work_active_operation_fkey
  foreign key (id, active_operation_id)
  references public.booking_request_release_operations (work_id, id)
  on delete restrict;

create function public.enforce_booking_request_release_operation_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.work_id is distinct from old.work_id
    or new.attempt_id is distinct from old.attempt_id
    or new.operation_generation is distinct from old.operation_generation
    or new.payment_lifecycle_id is distinct from old.payment_lifecycle_id
    or new.logical_operation_id is distinct from old.logical_operation_id
    or new.physical_attempt_id is distinct from old.physical_attempt_id
    or new.amount_fils is distinct from old.amount_fils
    or new.currency is distinct from old.currency
    or new.provider is distinct from old.provider
    or new.environment is distinct from old.environment
    or new.merchant_id is distinct from old.merchant_id
    or new.terminal_id is distinct from old.terminal_id
    or new.provider_idempotency_key is distinct from old.provider_idempotency_key
    or new.request_fingerprint is distinct from old.request_fingerprint
    or new.execution_started_at is distinct from old.execution_started_at
  ) then
    raise exception 'Booking Request release operation bindings are immutable'
      using errcode = 'RC204';
  end if;
  if tg_op = 'UPDATE' and old.state in ('retryable', 'succeeded')
    and new is distinct from old then
    raise exception 'Terminal Booking Request release operation cannot change'
      using errcode = 'RC204';
  end if;
  if tg_op = 'UPDATE' and new.state is distinct from old.state and not (
    (old.state = 'executing' and new.state in (
      'reconcile_required', 'retryable', 'succeeded'
    )) or
    (old.state = 'reconcile_required' and new.state in (
      'reconcile_required', 'retryable', 'succeeded'
    ))
  ) then
    raise exception 'Booking Request release operation cannot move backwards'
      using errcode = 'RC204';
  end if;
  if not (
    (new.state = 'executing' and new.provider_outcome = 'unknown'
      and new.provider_request_id is null and new.provider_reference is null
      and new.movement_reference is null and not new.retry_safe
      and new.result_recorded_at is null)
    or (new.state = 'reconcile_required' and new.provider_outcome = 'unknown'
      and new.provider_request_id is null and new.provider_reference is null
      and new.movement_reference is null and not new.retry_safe)
    or (new.state = 'reconcile_required' and new.provider_outcome = 'failed'
      and new.provider_request_id is not null and new.provider_reference is not null
      and new.movement_reference is null and not new.retry_safe
      and new.result_recorded_at is not null)
    or (new.state = 'reconcile_required' and new.provider_outcome = 'indeterminate'
      and new.provider_request_id is not null and new.provider_reference is not null
      and new.movement_reference is not null and not new.retry_safe
      and new.result_recorded_at is not null)
    or (new.state = 'retryable' and new.provider_outcome = 'not_executed'
      and new.provider_request_id is null and new.provider_reference is null
      and new.movement_reference is null and new.retry_safe
      and new.result_recorded_at is not null)
    or (new.state = 'retryable' and new.provider_outcome = 'failed'
      and new.provider_request_id is not null and new.provider_reference is not null
      and new.movement_reference is null and new.retry_safe
      and new.result_recorded_at is not null)
    or (new.state = 'succeeded' and new.provider_outcome = 'succeeded'
      and new.provider_request_id is not null and new.provider_reference is not null
      and new.movement_reference is not null and not new.retry_safe
      and new.result_recorded_at is not null)
  ) then
    raise exception 'Booking Request release operation result shape is invalid'
      using errcode = 'RC204';
  end if;
  return new;
end;
$$;
create trigger enforce_booking_request_release_operation_transition
before insert or update on public.booking_request_release_operations
for each row execute function public.enforce_booking_request_release_operation_transition();

create function public.booking_request_release_fingerprint(
  target_provider text,
  target_environment text,
  target_merchant_id text,
  target_terminal_id text,
  target_payment_lifecycle_id uuid,
  target_logical_operation_id text,
  target_physical_attempt_id text,
  target_amount_fils bigint,
  target_currency text
)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(concat_ws(E'\n',
    target_provider, target_environment, target_merchant_id, target_terminal_id,
    'release', target_payment_lifecycle_id::text, target_logical_operation_id,
    target_physical_attempt_id, target_amount_fils::text, target_currency
  ), 'UTF8'), 'sha256'), 'hex');
$$;
revoke all on function public.booking_request_release_fingerprint(
  text, text, text, text, uuid, text, text, bigint, text
) from public, anon, authenticated, service_role;

create function public.booking_request_submission_cleanup_fingerprint(
  target_attempt_id uuid,
  target_claim_id uuid,
  target_claim_generation integer,
  target_state_revision bigint,
  target_provider text,
  target_environment text,
  target_merchant_id text,
  target_terminal_id text,
  target_payment_lifecycle_id uuid,
  target_logical_operation_id text,
  target_physical_attempt_id text,
  target_amount_fils bigint,
  target_currency text
)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(concat_ws(E'\n',
    'booking-request-submission-cleanup', target_attempt_id::text,
    target_claim_id::text, target_claim_generation::text,
    target_state_revision::text, target_provider, target_environment,
    target_merchant_id, target_terminal_id, target_payment_lifecycle_id::text,
    target_logical_operation_id, target_physical_attempt_id,
    target_amount_fils::text, target_currency
  ), 'UTF8'), 'sha256'), 'hex');
$$;
revoke all on function public.booking_request_submission_cleanup_fingerprint(
  uuid, uuid, integer, bigint, text, text, text, text,
  uuid, text, text, bigint, text
) from public, anon, authenticated, service_role;

create function public.begin_booking_request_submission_cleanup_release(
  target_attempt_id uuid,
  target_payment_snapshot jsonb,
  target_provider_identity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare attempt public.booking_request_submission_attempts;
declare claim public.booking_request_authorization_claims;
declare release_operation jsonb := target_payment_snapshot -> 'release';
declare permit_not_after timestamptz;
declare permit_key text;
declare permit_fingerprint text;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'Booking Request cleanup release is private'
      using errcode = '42501';
  end if;
  if target_attempt_id is null
    or target_payment_snapshot is null
    or coalesce(jsonb_typeof(target_payment_snapshot), '') <> 'object'
    or target_provider_identity is null
    or coalesce(jsonb_typeof(target_provider_identity), '') <> 'object'
    or release_operation is null
    or coalesce(jsonb_typeof(release_operation), '') <> 'object'
    or not (release_operation ?& array[
      'paymentLifecycleId', 'kind', 'logicalOperationId', 'attemptId', 'status',
      'amountFils', 'providerRequestId', 'providerReference',
      'movementReference', 'reconciliationRequired', 'retrySafe'
    ])
    or release_operation -> 'paymentLifecycleId' = 'null'::jsonb
    or release_operation -> 'kind' = 'null'::jsonb
    or release_operation -> 'logicalOperationId' = 'null'::jsonb
    or release_operation -> 'attemptId' = 'null'::jsonb
    or release_operation -> 'status' = 'null'::jsonb
    or release_operation -> 'amountFils' = 'null'::jsonb
    or release_operation -> 'reconciliationRequired' = 'null'::jsonb
    or release_operation -> 'retrySafe' = 'null'::jsonb then
    raise exception 'Booking Request cleanup release is invalid'
      using errcode = 'RC409';
  end if;
  select * into attempt from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id for update;
  select * into claim from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id for update;
  if attempt.id is null or claim.id is null
    or attempt.booking_request_id is not null
    or exists (select 1 from public.booking_requests requests
      where requests.payment_lifecycle_id = attempt.payment_lifecycle_id)
    or exists (select 1 from public.booking_request_release_work work
      where work.attempt_id = attempt.id)
    or claim.state = 'converted'
    or claim.payment_lifecycle_id is distinct from attempt.payment_lifecycle_id
    or target_provider_identity is distinct from jsonb_build_object(
      'provider', claim.provider, 'environment', claim.environment,
      'merchantId', claim.merchant_id, 'terminalId', claim.terminal_id
    )
    or target_payment_snapshot -> 'authorization' ->> 'status'
      is distinct from 'succeeded'
    or target_payment_snapshot -> 'capture' is distinct from 'null'::jsonb
    or release_operation ->> 'status' is distinct from 'pending'
    or release_operation ->> 'paymentLifecycleId'
      is distinct from claim.payment_lifecycle_id::text
    or release_operation ->> 'logicalOperationId'
      is distinct from claim.payment_lifecycle_id::text || ':release'
    or coalesce(release_operation ->> 'attemptId', '')
      !~ ('^' || claim.payment_lifecycle_id::text || ':release:attempt-[1-9][0-9]*$')
    or (release_operation ->> 'amountFils')::bigint
      is distinct from claim.amount_fils
    or release_operation -> 'providerRequestId' is distinct from 'null'::jsonb
    or release_operation -> 'providerReference' is distinct from 'null'::jsonb
    or release_operation -> 'movementReference' is distinct from 'null'::jsonb
    or (release_operation ->> 'reconciliationRequired')::boolean
      is distinct from false
    or (release_operation ->> 'retrySafe')::boolean is distinct from false then
    raise exception 'Booking Request cleanup release is invalid'
      using errcode = 'RC409';
  end if;
  if attempt.payment_snapshot is distinct from target_payment_snapshot then
    perform public.save_booking_request_payment_snapshot(
      attempt.id, target_payment_snapshot, target_provider_identity
    );
  end if;
  select * into claim from public.booking_request_authorization_claims claims
  where claims.attempt_id = attempt.id for update;
  if claim.state <> 'releasing' then
    raise exception 'Booking Request cleanup release was not persisted'
      using errcode = 'RC409';
  end if;
  permit_not_after := date_trunc(
    'milliseconds', claim.updated_at + interval '30 seconds'
  );
  permit_key := 'booking-request-submission-cleanup:' || attempt.id::text
    || ':' || claim.state_revision::text;
  permit_fingerprint := public.booking_request_submission_cleanup_fingerprint(
    attempt.id, claim.id, claim.generation, claim.state_revision,
    claim.provider, claim.environment, claim.merchant_id, claim.terminal_id,
    claim.payment_lifecycle_id, release_operation ->> 'logicalOperationId',
    release_operation ->> 'attemptId', claim.amount_fils, claim.currency
  );
  return jsonb_build_object(
    'status', 'ready',
    'executionPermit', jsonb_build_object(
      'purpose', 'booking-request-submission-cleanup',
      'attemptId', attempt.id,
      'claimId', claim.id,
      'generation', claim.generation,
      'stateRevision', claim.state_revision,
      'idempotencyKey', permit_key,
      'requestFingerprint', permit_fingerprint,
      'notAfter', to_char(permit_not_after at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
end;
$$;
revoke all on function public.begin_booking_request_submission_cleanup_release(
  uuid, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.begin_booking_request_submission_cleanup_release(
  uuid, jsonb, jsonb
) to service_role;

create table public.booking_request_status_notifications (
  id uuid primary key default gen_random_uuid(),
  booking_request_id uuid not null
    references public.booking_requests (id) on delete restrict,
  recipient_user_id uuid not null
    references public.account_contexts (user_id) on delete restrict,
  status text not null check (status in ('accepted', 'declined', 'withdrawn', 'expired')),
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  unique (booking_request_id, recipient_user_id, status)
);

alter table public.booking_request_release_work enable row level security;
alter table public.booking_request_release_operations enable row level security;
alter table public.booking_request_status_notifications enable row level security;
revoke all on public.booking_request_release_work,
  public.booking_request_release_operations,
  public.booking_request_status_notifications
from public, anon, authenticated, service_role;

create function public.project_booking_request_release_work(
  target_work public.booking_request_release_work
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', 'release-required',
    'workId', target_work.id,
    'attemptId', attempts.id,
    'leaseGeneration', target_work.lease_generation,
    'leaseToken', target_work.lease_token,
    'leaseExpiresAt', to_char(target_work.lease_expires_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'bookingRequestReference', requests.booking_request_reference,
    'paymentLifecycleId', attempts.payment_lifecycle_id,
    'authorizedAmountFils', claims.amount_fils,
    'paymentSnapshot', attempts.payment_snapshot,
    'paymentProviderIdentity', jsonb_build_object(
      'provider', attempts.authorization_provider,
      'environment', attempts.authorization_environment,
      'merchantId', attempts.authorization_merchant_id,
      'terminalId', attempts.authorization_terminal_id
    )
  )
  from public.booking_request_submission_attempts attempts
  join public.booking_requests requests on requests.id = target_work.booking_request_id
  join public.booking_request_authorization_claims claims
    on claims.payment_lifecycle_id = attempts.payment_lifecycle_id
  where attempts.id = target_work.attempt_id;
$$;
revoke all on function public.project_booking_request_release_work(
  public.booking_request_release_work
) from public, anon, authenticated, service_role;

create function public.lease_booking_request_release_work(target_work_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare work public.booking_request_release_work;
declare operation public.booking_request_release_operations;
declare attempt public.booking_request_submission_attempts;
declare target_request public.booking_requests;
declare leased_at timestamptz := date_trunc('milliseconds', clock_timestamp());
begin
  select * into work from public.booking_request_release_work release_work
  where release_work.id = target_work_id for update;
  if not found then return jsonb_build_object('status', 'unavailable'); end if;
  select * into target_request from public.booking_requests requests
  where requests.id = work.booking_request_id for update;
  if work.state = 'complete' then return jsonb_build_object(
    'status', work.outcome,
    'bookingRequestReference', target_request.booking_request_reference
  ); end if;
  if work.lease_token is not null and leased_at < work.lease_expires_at then
    return jsonb_build_object(
      'status', 'processing',
      'bookingRequestReference', target_request.booking_request_reference
    );
  end if;
  if work.active_operation_id is not null then
    select * into operation from public.booking_request_release_operations operations
    where operations.id = work.active_operation_id
      and operations.work_id = work.id
    for update;
    if not found then
      raise exception 'Booking Request active release operation is unavailable'
        using errcode = 'RC409';
    end if;
    if operation.state = 'executing' then
      update public.booking_request_release_operations
      set state = 'reconcile_required', updated_at = leased_at
      where id = operation.id;
      select * into attempt from public.booking_request_submission_attempts attempts
      where attempts.id = work.attempt_id for update;
      update public.booking_request_submission_attempts
      set payment_snapshot = jsonb_set(
          payment_snapshot,
          '{release,reconciliationRequired}',
          'true'::jsonb
        ),
        state = 'reconciliation_required',
        updated_at = leased_at
      where id = attempt.id
        and payment_snapshot -> 'release' ->> 'status' = 'pending';
    end if;
  end if;
  update public.booking_request_release_work
  set lease_generation = lease_generation + 1,
    lease_token = gen_random_uuid(),
    lease_expires_at = leased_at + interval '30 seconds'
  where id = work.id
  returning * into work;
  return public.project_booking_request_release_work(work);
end;
$$;
revoke all on function public.lease_booking_request_release_work(uuid)
  from public, anon, authenticated, service_role;

create function public.claim_booking_request_action(
  target_actor_user_id uuid,
  target_booking_request_id uuid,
  target_action text,
  target_decline_reason text default null,
  target_decline_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_request public.booking_requests;
declare actor_context public.account_contexts;
declare target_attempt public.booking_request_submission_attempts;
declare work public.booking_request_release_work;
declare effective_action text;
declare outcome text;
declare evaluated_at timestamptz;
declare normalized_note text := nullif(btrim(target_decline_note), '');
declare fingerprint text;
begin
  if target_actor_user_id is null or target_action is null then
    return jsonb_build_object('status', 'access-required');
  end if;
  select * into target_request from public.booking_requests requests
  where requests.id = target_booking_request_id for update;
  if not found then return jsonb_build_object('status', 'access-required'); end if;

  if target_action not in ('accept', 'decline', 'withdraw') then
    return jsonb_build_object('status', 'access-required');
  end if;
  if target_action in ('accept', 'decline') then
    select * into actor_context
    from public.account_contexts contexts
    where contexts.user_id = target_actor_user_id
    for update;
    if not found
      or actor_context.role <> 'cottage_owner'::public.account_role
      or actor_context.owner_approval_state <>
        'approved'::public.owner_approval_state
      or target_request.owner_user_id <> target_actor_user_id then
      return jsonb_build_object('status', 'access-required');
    end if;
  elsif target_request.customer_user_id <> target_actor_user_id then
    return jsonb_build_object('status', 'access-required');
  end if;

  if target_decline_reason is not null and target_decline_reason not in (
    'cottage_unavailable', 'cannot_accommodate_request', 'other'
  ) then
    raise exception 'Booking Request decline reason is invalid'
      using errcode = '22023';
  end if;

  if target_request.status in ('accepted', 'declined', 'withdrawn', 'expired') then
    return jsonb_build_object(
      'status', target_request.status,
      'bookingRequestReference', target_request.booking_request_reference
    );
  end if;
  if target_request.status = 'processing' then
    select * into work from public.booking_request_release_work release_work
    where release_work.booking_request_id = target_request.id;
    return public.lease_booking_request_release_work(work.id);
  end if;

  evaluated_at := clock_timestamp();
  effective_action := case
    when evaluated_at >= target_request.response_deadline then 'expire'
    else target_action
  end;
  if effective_action = 'decline' and (
    target_decline_reason is null
    or char_length(coalesce(normalized_note, '')) > 500
    or not public.booking_request_content_is_safe(coalesce(normalized_note, ''))
  ) then return jsonb_build_object('status', 'invalid'); end if;

  if effective_action = 'accept' then
    update public.booking_requests set status = 'accepted',
      outcome_actor_user_id = target_actor_user_id, settled_at = evaluated_at
    where id = target_request.id;
    insert into public.booking_request_status_notifications (
      booking_request_id, recipient_user_id, status, created_at
    ) values
      (target_request.id, target_request.owner_user_id, 'accepted', evaluated_at),
      (target_request.id, target_request.customer_user_id, 'accepted', evaluated_at)
    on conflict do nothing;
    return jsonb_build_object(
      'status', 'accepted',
      'bookingRequestReference', target_request.booking_request_reference
    );
  end if;

  outcome := case effective_action
    when 'decline' then 'declined'
    when 'withdraw' then 'withdrawn'
    else 'expired'
  end;
  select * into target_attempt from public.booking_request_submission_attempts attempts
  where attempts.booking_request_id = target_request.id for update;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'bookingRequestId', target_request.id,
    'outcome', outcome,
    'actorUserId', case when effective_action = 'expire' then null else target_actor_user_id end,
    'declineReason', case when outcome = 'declined' then target_decline_reason else null end,
    'declineNote', case when outcome = 'declined' then normalized_note else null end
  )::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.booking_request_release_work (
    booking_request_id, attempt_id, outcome, actor_user_id,
    decline_reason, decline_note, outcome_fingerprint, created_at
  ) values (
    target_request.id, target_attempt.id, outcome,
    case when effective_action = 'expire' then null else target_actor_user_id end,
    case when outcome = 'declined' then target_decline_reason end,
    case when outcome = 'declined' then normalized_note end,
    fingerprint, evaluated_at
  ) returning * into work;
  update public.booking_requests set status = 'processing',
    outcome_actor_user_id = work.actor_user_id,
    decline_reason = work.decline_reason, decline_note = work.decline_note,
    outcome_fingerprint = work.outcome_fingerprint
  where id = target_request.id;
  return public.lease_booking_request_release_work(work.id);
end;
$$;
revoke all on function public.claim_booking_request_action(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.claim_booking_request_action(
  uuid, uuid, text, text, text
) to service_role;

create function public.claim_booking_request_expiry(target_booking_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_request public.booking_requests;
declare target_attempt public.booking_request_submission_attempts;
declare work public.booking_request_release_work;
declare evaluated_at timestamptz;
declare fingerprint text;
begin
  select * into target_request
  from public.booking_requests requests
  where requests.id = target_booking_request_id
  for update;
  if not found then return jsonb_build_object('status', 'access-required'); end if;
  if target_request.status = 'processing' then
    select * into work from public.booking_request_release_work release_work
    where release_work.booking_request_id = target_request.id;
    return public.lease_booking_request_release_work(work.id);
  end if;
  if target_request.status in ('accepted', 'declined', 'withdrawn', 'expired') then
    return jsonb_build_object(
      'status', target_request.status,
      'bookingRequestReference', target_request.booking_request_reference
    );
  end if;
  evaluated_at := clock_timestamp();
  if target_request.status <> 'pending'
      or evaluated_at < target_request.response_deadline then
    return jsonb_build_object('status', 'not-due');
  end if;
  select * into target_attempt from public.booking_request_submission_attempts attempts
  where attempts.booking_request_id = target_request.id for update;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'bookingRequestId', target_request.id,
    'outcome', 'expired',
    'actorUserId', null,
    'declineReason', null,
    'declineNote', null
  )::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.booking_request_release_work (
    booking_request_id, attempt_id, outcome, actor_user_id,
    decline_reason, decline_note, outcome_fingerprint, created_at
  ) values (
    target_request.id, target_attempt.id, 'expired', null,
    null, null, fingerprint, evaluated_at
  ) returning * into work;
  update public.booking_requests set status = 'processing',
    outcome_actor_user_id = null,
    decline_reason = null, decline_note = null,
    outcome_fingerprint = work.outcome_fingerprint
  where id = target_request.id;
  return public.lease_booking_request_release_work(work.id);
end;
$$;
revoke all on function public.claim_booking_request_expiry(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_booking_request_expiry(uuid)
  to service_role;

create function public.claim_due_booking_request_releases(target_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_request record;
declare work public.booking_request_release_work;
declare projected jsonb := '[]'::jsonb;
begin
  if target_limit is null or target_limit not between 1 and 50 then
    raise exception 'Booking Request release batch limit is invalid' using errcode = '22023';
  end if;
  for target_request in
    select requests.id, requests.status from public.booking_requests requests
    where requests.status = 'processing'
       or (requests.status = 'pending' and requests.response_deadline <= clock_timestamp())
    order by requests.response_deadline, requests.id
    limit target_limit
    for update of requests skip locked
  loop
    if target_request.status = 'processing' then
      select * into work from public.booking_request_release_work release_work
      where release_work.booking_request_id = target_request.id;
      projected := projected || jsonb_build_array(
        public.lease_booking_request_release_work(work.id)
      );
    else
      projected := projected || jsonb_build_array(
        public.claim_booking_request_expiry(target_request.id)
      );
    end if;
  end loop;
  return projected;
end;
$$;
revoke all on function public.claim_due_booking_request_releases(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_booking_request_releases(integer)
  to service_role;

-- Reconciliation does not reuse an expired admission permit. It proves the
-- exact immutable operation against the owning domain rows and the provider
-- ledger before returning absence or a stored outcome.
create or replace function public.query_simulated_payment_provider_operation(
  target_operation jsonb,
  target_provider_request_id text,
  target_provider_reference text,
  target_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare provider_identity jsonb := target_operation -> 'providerIdentity';
declare attempt public.booking_request_submission_attempts;
declare claim public.booking_request_authorization_claims;
declare work public.booking_request_release_work;
declare release_operation public.booking_request_release_operations;
declare stored public.simulated_payment_provider_operations;
declare expected_fingerprint text;
declare cleanup_revision bigint;
declare lifecycle_release boolean := false;
begin
  if current_setting('role', true) <> 'service_role'
    or target_outcome is null
    or target_outcome not in ('succeeded', 'failed', 'indeterminate')
    or target_operation is null
    or coalesce(jsonb_typeof(target_operation), '') <> 'object' then
    raise exception 'Fictional provider query is invalid' using errcode = '22023';
  end if;
  if not (target_operation ?& array[
      'providerIdentity', 'requestFingerprint', 'paymentLifecycleId',
      'logicalOperationId', 'physicalAttemptId', 'operationKind',
      'amountFils', 'currency'
    ])
    or provider_identity is null
    or coalesce(jsonb_typeof(provider_identity), '') <> 'object'
    or (select count(*) from jsonb_object_keys(provider_identity)) <> 4
    or provider_identity ->> 'environment' is distinct from 'local-test'
    or coalesce(provider_identity ->> 'provider', '') = ''
    or coalesce(provider_identity ->> 'merchantId', '') = ''
    or coalesce(provider_identity ->> 'terminalId', '') = ''
    or coalesce(target_operation ->> 'paymentLifecycleId', '') = ''
    or coalesce(target_operation ->> 'logicalOperationId', '') = ''
    or coalesce(target_operation ->> 'physicalAttemptId', '') = ''
    or coalesce(target_operation ->> 'operationKind', '')
      not in ('authorization', 'release')
    or target_operation -> 'amountFils' = 'null'::jsonb
    or coalesce(target_operation ->> 'currency', '') <> 'IQD'
    or (target_operation -> 'requestFingerprint' is distinct from 'null'::jsonb
      and coalesce(target_operation ->> 'requestFingerprint', '')
        !~ '^[0-9a-f]{64}$')
    or ((target_provider_request_id is null)
      <> (target_provider_reference is null)) then
    raise exception 'Fictional provider query is invalid' using errcode = '22023';
  end if;

  if target_operation ->> 'operationKind' = 'authorization' then
    select * into claim from public.booking_request_authorization_claims claims
    where claims.payment_lifecycle_id =
      (target_operation ->> 'paymentLifecycleId')::uuid
    for update;
    expected_fingerprint := target_operation ->> 'requestFingerprint';
    if claim.id is null or expected_fingerprint is null
      or claim.provider <> provider_identity ->> 'provider'
      or claim.environment <> provider_identity ->> 'environment'
      or claim.merchant_id <> provider_identity ->> 'merchantId'
      or claim.terminal_id <> provider_identity ->> 'terminalId'
      or claim.payment_lifecycle_id <>
        (target_operation ->> 'paymentLifecycleId')::uuid
      or claim.logical_operation_id <> target_operation ->> 'logicalOperationId'
      or claim.physical_attempt_id <> target_operation ->> 'physicalAttemptId'
      or claim.amount_fils <> (target_operation ->> 'amountFils')::bigint
      or claim.currency <> target_operation ->> 'currency' then
      raise exception 'Fictional provider query does not match its authorization'
        using errcode = 'RC409';
    end if;
  elsif exists (
    select 1 from public.booking_request_release_operations operations
    where operations.payment_lifecycle_id =
        (target_operation ->> 'paymentLifecycleId')::uuid
      and operations.logical_operation_id = target_operation ->> 'logicalOperationId'
      and operations.physical_attempt_id = target_operation ->> 'physicalAttemptId'
  ) then
    lifecycle_release := true;
    select release_work.* into work
    from public.booking_request_release_work release_work
    join public.booking_request_release_operations operations
      on operations.work_id = release_work.id
    where operations.payment_lifecycle_id =
        (target_operation ->> 'paymentLifecycleId')::uuid
      and operations.logical_operation_id = target_operation ->> 'logicalOperationId'
      and operations.physical_attempt_id = target_operation ->> 'physicalAttemptId'
    for update of release_work;
    select * into attempt from public.booking_request_submission_attempts attempts
    where attempts.id = work.attempt_id for update;
    select * into claim from public.booking_request_authorization_claims claims
    where claims.attempt_id = attempt.id for update;
    select * into release_operation
    from public.booking_request_release_operations operations
    where operations.work_id = work.id
      and operations.payment_lifecycle_id =
        (target_operation ->> 'paymentLifecycleId')::uuid
      and operations.logical_operation_id = target_operation ->> 'logicalOperationId'
      and operations.physical_attempt_id = target_operation ->> 'physicalAttemptId'
    for update;
    expected_fingerprint := public.booking_request_release_fingerprint(
      release_operation.provider, release_operation.environment,
      release_operation.merchant_id, release_operation.terminal_id,
      release_operation.payment_lifecycle_id,
      release_operation.logical_operation_id,
      release_operation.physical_attempt_id,
      release_operation.amount_fils, release_operation.currency
    );
    if work.id is null or attempt.id is null or claim.id is null
      or release_operation.id is null
      or work.active_operation_id <> release_operation.id
      or release_operation.state not in (
        'executing', 'reconcile_required', 'retryable', 'succeeded'
      )
      or release_operation.attempt_id <> attempt.id
      or release_operation.payment_lifecycle_id <> attempt.payment_lifecycle_id
      or release_operation.payment_lifecycle_id <> claim.payment_lifecycle_id
      or release_operation.provider <> provider_identity ->> 'provider'
      or release_operation.environment <> provider_identity ->> 'environment'
      or release_operation.merchant_id <> provider_identity ->> 'merchantId'
      or release_operation.terminal_id <> provider_identity ->> 'terminalId'
      or release_operation.amount_fils <>
        (target_operation ->> 'amountFils')::bigint
      or release_operation.currency <> target_operation ->> 'currency'
      or release_operation.request_fingerprint <> expected_fingerprint
      or (target_operation -> 'requestFingerprint' <> 'null'::jsonb
        and target_operation ->> 'requestFingerprint' <> expected_fingerprint)
      or attempt.payment_snapshot -> 'authorization' ->> 'status' <> 'succeeded'
      or attempt.payment_snapshot -> 'capture' <> 'null'::jsonb then
      raise exception 'Fictional provider query does not match its release operation'
        using errcode = 'RC409';
    end if;
  else
    select * into attempt from public.booking_request_submission_attempts attempts
    where attempts.payment_lifecycle_id =
      (target_operation ->> 'paymentLifecycleId')::uuid
    for update;
    select * into claim from public.booking_request_authorization_claims claims
    where claims.attempt_id = attempt.id for update;
    select * into stored
    from public.simulated_payment_provider_operations operations
    where operations.provider = provider_identity ->> 'provider'
      and operations.environment = provider_identity ->> 'environment'
      and operations.merchant_id = provider_identity ->> 'merchantId'
      and operations.terminal_id = provider_identity ->> 'terminalId'
      and operations.payment_lifecycle_id = attempt.payment_lifecycle_id
      and operations.logical_operation_id = target_operation ->> 'logicalOperationId'
      and operations.physical_attempt_id = target_operation ->> 'physicalAttemptId'
      and operations.operation_kind = 'release'
      and operations.amount_fils = (target_operation ->> 'amountFils')::bigint
      and operations.currency = target_operation ->> 'currency'
      and (target_provider_request_id is null
        or operations.provider_request_id = target_provider_request_id)
      and (target_provider_reference is null
        or operations.provider_reference = target_provider_reference)
    for update;
    cleanup_revision := case when stored.id is null then claim.state_revision
      else substring(stored.provider_idempotency_key from ':([0-9]+)$')::bigint end;
    expected_fingerprint := public.booking_request_submission_cleanup_fingerprint(
      attempt.id, claim.id, claim.generation, cleanup_revision,
      claim.provider, claim.environment, claim.merchant_id, claim.terminal_id,
      claim.payment_lifecycle_id, target_operation ->> 'logicalOperationId',
      target_operation ->> 'physicalAttemptId', claim.amount_fils, claim.currency
    );
    if attempt.id is null or claim.id is null
      or attempt.booking_request_id is not null
      or exists (select 1 from public.booking_requests requests
        where requests.payment_lifecycle_id = attempt.payment_lifecycle_id)
      or exists (select 1 from public.booking_request_release_work release_work
        where release_work.attempt_id = attempt.id)
      or claim.state not in ('releasing', 'reconciliation_required')
      or claim.payment_lifecycle_id <> attempt.payment_lifecycle_id
      or target_operation ->> 'logicalOperationId'
        <> claim.payment_lifecycle_id::text || ':release'
      or target_operation ->> 'physicalAttemptId'
        <> attempt.payment_snapshot -> 'release' ->> 'attemptId'
      or attempt.payment_snapshot -> 'authorization' ->> 'status' <> 'succeeded'
      or attempt.payment_snapshot -> 'capture' <> 'null'::jsonb
      or claim.amount_fils <> (target_operation ->> 'amountFils')::bigint
      or claim.currency <> target_operation ->> 'currency'
      or claim.provider <> provider_identity ->> 'provider'
      or claim.environment <> provider_identity ->> 'environment'
      or claim.merchant_id <> provider_identity ->> 'merchantId'
      or claim.terminal_id <> provider_identity ->> 'terminalId'
      or cleanup_revision > claim.state_revision
      or claim.state_revision - cleanup_revision > 1
      or (target_operation -> 'requestFingerprint' <> 'null'::jsonb
        and target_operation ->> 'requestFingerprint' <> expected_fingerprint)
      or (stored.id is not null and (
        stored.claim_id <> claim.id
        or stored.claim_generation <> claim.generation
        or stored.provider_idempotency_key <>
          'booking-request-submission-cleanup:' || attempt.id::text
            || ':' || cleanup_revision::text
        or stored.request_fingerprint <> expected_fingerprint
      )) then
      raise exception 'Fictional provider query does not match its cleanup release'
        using errcode = 'RC409';
    end if;
  end if;

  if stored.id is null then
    select * into stored
    from public.simulated_payment_provider_operations operations
    where operations.provider = provider_identity ->> 'provider'
      and operations.environment = provider_identity ->> 'environment'
      and operations.merchant_id = provider_identity ->> 'merchantId'
      and operations.terminal_id = provider_identity ->> 'terminalId'
      and operations.request_fingerprint = expected_fingerprint
      and operations.payment_lifecycle_id =
        (target_operation ->> 'paymentLifecycleId')::uuid
      and operations.logical_operation_id = target_operation ->> 'logicalOperationId'
      and operations.physical_attempt_id = target_operation ->> 'physicalAttemptId'
      and operations.operation_kind = target_operation ->> 'operationKind'
      and operations.amount_fils = (target_operation ->> 'amountFils')::bigint
      and operations.currency = target_operation ->> 'currency'
      and (target_provider_request_id is null
        or operations.provider_request_id = target_provider_request_id)
      and (target_provider_reference is null
        or operations.provider_reference = target_provider_reference)
    for update;
  end if;
  if stored.id is null then
    if target_provider_request_id is null and target_provider_reference is null then
      if lifecycle_release then
        if release_operation.state in ('executing', 'reconcile_required') then
          update public.booking_request_release_operations operations
          set state = 'retryable', provider_outcome = 'not_executed',
            retry_safe = true, result_recorded_at = clock_timestamp(),
            updated_at = clock_timestamp()
          where operations.id = release_operation.id;
        elsif release_operation.state <> 'retryable'
          or release_operation.provider_outcome <> 'not_executed' then
          raise exception 'Fictional provider absence conflicts with release state'
            using errcode = 'RC409';
        end if;
      end if;
      return jsonb_build_object('outcome', 'not-executed');
    end if;
    raise exception 'Fictional provider query does not match its operation'
      using errcode = 'RC409';
  end if;
  if stored.request_fingerprint <> expected_fingerprint
    or stored.payment_lifecycle_id <>
      (target_operation ->> 'paymentLifecycleId')::uuid
    or stored.logical_operation_id <> target_operation ->> 'logicalOperationId'
    or stored.physical_attempt_id <> target_operation ->> 'physicalAttemptId'
    or stored.operation_kind <> target_operation ->> 'operationKind'
    or stored.amount_fils <> (target_operation ->> 'amountFils')::bigint
    or stored.currency <> target_operation ->> 'currency' then
    raise exception 'Fictional provider query does not match its operation'
      using errcode = 'RC409';
  end if;
  if stored.current_outcome = 'indeterminate'
    and target_outcome <> 'indeterminate' then
    update public.simulated_payment_provider_operations operations
    set current_outcome = target_outcome,
      movement_reference = case when target_outcome = 'failed'
        then null else movement_reference end,
      updated_at = clock_timestamp()
    where operations.id = stored.id
    returning * into stored;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'outcome', stored.current_outcome,
    'providerRequestId', stored.provider_request_id,
    'providerReference', stored.provider_reference,
    'movementReference', stored.movement_reference,
    'retrySafe', stored.operation_kind = 'release'
      and stored.current_outcome = 'failed'
  ));
end;
$$;
create or replace function public.execute_simulated_payment_provider_operation(
  target_operation jsonb,
  target_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare provider_identity jsonb := target_operation -> 'providerIdentity';
declare permit_purpose text := target_operation ->> 'permitPurpose';
declare claim public.booking_request_authorization_claims;
declare attempt public.booking_request_submission_attempts;
declare work public.booking_request_release_work;
declare release_operation public.booking_request_release_operations;
declare operation_id uuid := gen_random_uuid();
declare effective_idempotency_key text;
declare expected_fingerprint text;
declare expected_not_after timestamptz;
declare stored public.simulated_payment_provider_operations;
begin
  if current_setting('role', true) <> 'service_role'
    or target_outcome is null
    or target_outcome not in ('succeeded', 'failed', 'indeterminate')
    or target_operation is null
    or coalesce(jsonb_typeof(target_operation), '') <> 'object' then
    raise exception 'Fictional provider operation is invalid' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(target_operation)) <> 20
    or not (target_operation ?& array[
      'providerIdentity', 'requestFingerprint', 'paymentLifecycleId',
      'logicalOperationId', 'physicalAttemptId', 'operationKind',
      'amountFils', 'currency', 'permitPurpose', 'idempotencyKey', 'notAfter',
      'claimId', 'claimGeneration', 'stateRevision', 'cleanupAttemptId',
      'workId', 'leaseGeneration', 'leaseToken', 'operationId',
      'operationGeneration'
    ])
    or provider_identity is null
    or coalesce(jsonb_typeof(provider_identity), '') <> 'object'
    or (select count(*) from jsonb_object_keys(provider_identity)) <> 4
    or provider_identity ->> 'environment' is distinct from 'local-test'
    or coalesce(provider_identity ->> 'provider', '') = ''
    or coalesce(provider_identity ->> 'merchantId', '') = ''
    or coalesce(provider_identity ->> 'terminalId', '') = ''
    or coalesce(target_operation ->> 'paymentLifecycleId', '') = ''
    or coalesce(target_operation ->> 'logicalOperationId', '') = ''
    or coalesce(target_operation ->> 'physicalAttemptId', '') = ''
    or coalesce(target_operation ->> 'operationKind', '')
      not in ('authorization', 'release')
    or target_operation -> 'amountFils' = 'null'::jsonb
    or coalesce(target_operation ->> 'currency', '') <> 'IQD'
    or coalesce(target_operation ->> 'permitPurpose', '') = ''
    or coalesce(target_operation ->> 'idempotencyKey', '') = ''
    or coalesce(target_operation ->> 'notAfter', '') = ''
    or coalesce(target_operation ->> 'requestFingerprint', '')
      !~ '^[0-9a-f]{64}$' then
    raise exception 'Fictional provider operation is invalid' using errcode = '22023';
  end if;

  if permit_purpose = 'booking-request-submission-cleanup' then
    if target_operation -> 'cleanupAttemptId' = 'null'::jsonb
      or target_operation -> 'claimId' = 'null'::jsonb
      or target_operation -> 'claimGeneration' = 'null'::jsonb
      or target_operation -> 'stateRevision' = 'null'::jsonb then
      raise exception 'Fictional provider operation is invalid' using errcode = '22023';
    end if;
    if target_operation ->> 'operationKind' is distinct from 'release'
      or target_operation -> 'workId' is distinct from 'null'::jsonb
      or target_operation -> 'leaseGeneration' is distinct from 'null'::jsonb
      or target_operation -> 'leaseToken' is distinct from 'null'::jsonb
      or target_operation -> 'operationId' is distinct from 'null'::jsonb
      or target_operation -> 'operationGeneration' is distinct from 'null'::jsonb then
      raise exception 'Fictional cleanup permit has foreign-purpose fields'
        using errcode = 'RC409';
    end if;
    select * into attempt from public.booking_request_submission_attempts attempts
    where attempts.id = (target_operation ->> 'cleanupAttemptId')::uuid
    for update;
    select * into claim from public.booking_request_authorization_claims claims
    where claims.attempt_id = attempt.id for update;
    expected_not_after := date_trunc(
      'milliseconds', claim.updated_at + interval '30 seconds'
    );
    expected_fingerprint := public.booking_request_submission_cleanup_fingerprint(
      attempt.id, claim.id, claim.generation, claim.state_revision,
      claim.provider, claim.environment, claim.merchant_id, claim.terminal_id,
      claim.payment_lifecycle_id, target_operation ->> 'logicalOperationId',
      target_operation ->> 'physicalAttemptId', claim.amount_fils, claim.currency
    );
    effective_idempotency_key := 'booking-request-submission-cleanup:'
      || attempt.id::text || ':' || claim.state_revision::text;
    if attempt.id is null or claim.id is null
      or attempt.booking_request_id is not null
      or exists (select 1 from public.booking_requests requests
        where requests.payment_lifecycle_id = attempt.payment_lifecycle_id)
      or exists (select 1 from public.booking_request_release_work release_work
        where release_work.attempt_id = attempt.id)
      or claim.state <> 'releasing'
      or claim.state = 'converted'
      or claim.id <> (target_operation ->> 'claimId')::uuid
      or claim.generation <> (target_operation ->> 'claimGeneration')::integer
      or claim.state_revision <> (target_operation ->> 'stateRevision')::bigint
      or claim.payment_lifecycle_id <> attempt.payment_lifecycle_id
      or claim.payment_lifecycle_id <>
        (target_operation ->> 'paymentLifecycleId')::uuid
      or claim.logical_operation_id = target_operation ->> 'logicalOperationId'
      or target_operation ->> 'logicalOperationId'
        <> claim.payment_lifecycle_id::text || ':release'
      or target_operation ->> 'physicalAttemptId'
        <> attempt.payment_snapshot -> 'release' ->> 'attemptId'
      or attempt.payment_snapshot -> 'release' ->> 'status' <> 'pending'
      or attempt.payment_snapshot -> 'authorization' ->> 'status' <> 'succeeded'
      or attempt.payment_snapshot -> 'capture' <> 'null'::jsonb
      or claim.amount_fils <> (target_operation ->> 'amountFils')::bigint
      or claim.currency <> target_operation ->> 'currency'
      or claim.provider <> provider_identity ->> 'provider'
      or claim.environment <> provider_identity ->> 'environment'
      or claim.merchant_id <> provider_identity ->> 'merchantId'
      or claim.terminal_id <> provider_identity ->> 'terminalId'
      or target_operation ->> 'idempotencyKey' <> effective_idempotency_key
      or target_operation ->> 'requestFingerprint' <> expected_fingerprint
      or (target_operation ->> 'notAfter')::timestamptz <> expected_not_after
      or clock_timestamp() >= expected_not_after then
      raise exception 'Fictional cleanup permit is invalid or expired'
        using errcode = 'RC409';
    end if;
  elsif permit_purpose = 'booking-request-release' then
    if target_operation -> 'workId' = 'null'::jsonb
      or target_operation -> 'leaseGeneration' = 'null'::jsonb
      or target_operation -> 'leaseToken' = 'null'::jsonb
      or target_operation -> 'operationId' = 'null'::jsonb
      or target_operation -> 'operationGeneration' = 'null'::jsonb then
      raise exception 'Fictional provider operation is invalid' using errcode = '22023';
    end if;
    if target_operation ->> 'operationKind' is distinct from 'release'
      or target_operation -> 'claimId' is distinct from 'null'::jsonb
      or target_operation -> 'claimGeneration' is distinct from 'null'::jsonb
      or target_operation -> 'stateRevision' is distinct from 'null'::jsonb
      or target_operation -> 'cleanupAttemptId' is distinct from 'null'::jsonb then
      raise exception 'Fictional lifecycle permit has foreign-purpose fields'
        using errcode = 'RC409';
    end if;
    select * into work from public.booking_request_release_work release_work
    where release_work.id = (target_operation ->> 'workId')::uuid
    for update;
    select * into attempt from public.booking_request_submission_attempts attempts
    where attempts.id = work.attempt_id for update;
    select * into claim from public.booking_request_authorization_claims claims
    where claims.attempt_id = attempt.id for update;
    select * into release_operation
    from public.booking_request_release_operations operations
    where operations.id = (target_operation ->> 'operationId')::uuid
      and operations.work_id = work.id
    for update;
    expected_fingerprint := public.booking_request_release_fingerprint(
      release_operation.provider, release_operation.environment,
      release_operation.merchant_id, release_operation.terminal_id,
      release_operation.payment_lifecycle_id,
      release_operation.logical_operation_id,
      release_operation.physical_attempt_id,
      release_operation.amount_fils, release_operation.currency
    );
    effective_idempotency_key := release_operation.provider_idempotency_key;
    if work.id is null or attempt.id is null or claim.id is null
      or release_operation.id is null
      or work.state <> 'processing'
      or work.lease_generation <> (target_operation ->> 'leaseGeneration')::bigint
      or work.lease_token <> (target_operation ->> 'leaseToken')::uuid
      or work.lease_expires_at <> (target_operation ->> 'notAfter')::timestamptz
      or clock_timestamp() >= work.lease_expires_at
      or work.active_operation_id <> release_operation.id
      or release_operation.state <> 'executing'
      or release_operation.operation_generation <>
        (target_operation ->> 'operationGeneration')::integer
      or release_operation.attempt_id <> attempt.id
      or release_operation.payment_lifecycle_id <> attempt.payment_lifecycle_id
      or release_operation.payment_lifecycle_id <> claim.payment_lifecycle_id
      or release_operation.logical_operation_id <>
        target_operation ->> 'logicalOperationId'
      or release_operation.physical_attempt_id <>
        target_operation ->> 'physicalAttemptId'
      or release_operation.amount_fils <>
        (target_operation ->> 'amountFils')::bigint
      or release_operation.currency <> target_operation ->> 'currency'
      or release_operation.provider <> provider_identity ->> 'provider'
      or release_operation.environment <> provider_identity ->> 'environment'
      or release_operation.merchant_id <> provider_identity ->> 'merchantId'
      or release_operation.terminal_id <> provider_identity ->> 'terminalId'
      or release_operation.provider_idempotency_key <>
        target_operation ->> 'idempotencyKey'
      or release_operation.request_fingerprint <> expected_fingerprint
      or target_operation ->> 'requestFingerprint' <> expected_fingerprint
      or attempt.payment_snapshot -> 'authorization' ->> 'status' <> 'succeeded'
      or attempt.payment_snapshot -> 'capture' <> 'null'::jsonb then
      raise exception 'Fictional lifecycle release permit is invalid or expired'
        using errcode = 'RC409';
    end if;
  elsif permit_purpose = 'booking-request-authorization' then
    if target_operation -> 'claimId' = 'null'::jsonb
      or target_operation -> 'claimGeneration' = 'null'::jsonb then
      raise exception 'Fictional provider operation is invalid' using errcode = '22023';
    end if;
    if target_operation ->> 'operationKind' is distinct from 'authorization'
      or target_operation -> 'stateRevision' is distinct from 'null'::jsonb
      or target_operation -> 'cleanupAttemptId' is distinct from 'null'::jsonb
      or target_operation -> 'workId' is distinct from 'null'::jsonb
      or target_operation -> 'leaseGeneration' is distinct from 'null'::jsonb
      or target_operation -> 'leaseToken' is distinct from 'null'::jsonb
      or target_operation -> 'operationId' is distinct from 'null'::jsonb
      or target_operation -> 'operationGeneration' is distinct from 'null'::jsonb then
      raise exception 'Fictional authorization permit has foreign-purpose fields'
        using errcode = 'RC409';
    end if;
    select * into claim from public.booking_request_authorization_claims claims
    where claims.id = (target_operation ->> 'claimId')::uuid for update;
    effective_idempotency_key := claim.provider_idempotency_key;
    if claim.id is null
      or claim.generation <> (target_operation ->> 'claimGeneration')::integer
      or claim.payment_lifecycle_id <>
        (target_operation ->> 'paymentLifecycleId')::uuid
      or claim.logical_operation_id <> target_operation ->> 'logicalOperationId'
      or claim.physical_attempt_id <> target_operation ->> 'physicalAttemptId'
      or claim.amount_fils <> (target_operation ->> 'amountFils')::bigint
      or claim.currency <> target_operation ->> 'currency'
      or claim.provider <> provider_identity ->> 'provider'
      or claim.environment <> provider_identity ->> 'environment'
      or claim.merchant_id <> provider_identity ->> 'merchantId'
      or claim.terminal_id <> provider_identity ->> 'terminalId'
      or target_operation ->> 'idempotencyKey' <> effective_idempotency_key
      or (target_operation ->> 'notAfter')::timestamptz <> claim.not_after
      or not public.booking_request_claim_state_allows_authorization(claim.state)
      or clock_timestamp() >= claim.not_after then
      raise exception 'Fictional authorization permit is invalid or expired'
        using errcode = 'RC409';
    end if;
  else
    raise exception 'Fictional provider permit purpose is invalid'
      using errcode = 'RC409';
  end if;

  insert into public.simulated_payment_provider_operations (
    id, claim_id, claim_generation, operation_kind,
    provider, environment, merchant_id, terminal_id,
    provider_idempotency_key, request_fingerprint,
    payment_lifecycle_id, logical_operation_id, physical_attempt_id,
    amount_fils, currency, original_outcome, current_outcome,
    provider_request_id, provider_reference, movement_reference
  ) values (
    operation_id, claim.id, claim.generation,
    target_operation ->> 'operationKind',
    claim.provider, claim.environment, claim.merchant_id, claim.terminal_id,
    effective_idempotency_key, target_operation ->> 'requestFingerprint',
    claim.payment_lifecycle_id, target_operation ->> 'logicalOperationId',
    target_operation ->> 'physicalAttemptId', claim.amount_fils, claim.currency,
    target_outcome, target_outcome,
    'sim-request-' || replace(operation_id::text, '-', ''),
    'sim-reference-' || replace(operation_id::text, '-', ''),
    case when target_outcome = 'failed' then null
      else 'sim-movement-' || replace(operation_id::text, '-', '') end
  ) on conflict (
    provider, environment, merchant_id, terminal_id, provider_idempotency_key
  ) do nothing;

  select * into stored
  from public.simulated_payment_provider_operations operations
  where operations.provider = claim.provider
    and operations.environment = claim.environment
    and operations.merchant_id = claim.merchant_id
    and operations.terminal_id = claim.terminal_id
    and operations.provider_idempotency_key = effective_idempotency_key
  for update;
  if stored.request_fingerprint <> target_operation ->> 'requestFingerprint'
    or stored.claim_id <> claim.id
    or stored.claim_generation <> claim.generation
    or stored.operation_kind <> target_operation ->> 'operationKind'
    or stored.payment_lifecycle_id <> claim.payment_lifecycle_id
    or stored.logical_operation_id <> target_operation ->> 'logicalOperationId'
    or stored.physical_attempt_id <> target_operation ->> 'physicalAttemptId'
    or stored.amount_fils <> claim.amount_fils
    or stored.currency <> claim.currency then
    raise exception 'Fictional provider idempotency binding changed'
      using errcode = 'RC409';
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'outcome', stored.current_outcome,
    'providerRequestId', stored.provider_request_id,
    'providerReference', stored.provider_reference,
    'movementReference', stored.movement_reference,
    'retrySafe', stored.operation_kind = 'release'
      and stored.current_outcome = 'failed'
  ));
end;
$$;

revoke all on function public.execute_simulated_payment_provider_operation(
  jsonb, text
) from public, anon, authenticated;
grant execute on function public.execute_simulated_payment_provider_operation(
  jsonb, text
) to service_role;


create function public.save_booking_request_release_snapshot(
  target_work_id uuid,
  target_lease_generation bigint,
  target_lease_token uuid,
  target_payment_snapshot jsonb,
  target_provider_identity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare work public.booking_request_release_work;
declare attempt public.booking_request_submission_attempts;
declare claim public.booking_request_authorization_claims;
declare operation public.booking_request_release_operations;
declare provider_operation public.simulated_payment_provider_operations;
declare next_release jsonb := nullif(target_payment_snapshot -> 'release', 'null'::jsonb);
declare existing_release jsonb;
declare expected_total bigint;
declare expected_generation integer;
declare expected_attempt_number integer;
declare expected_logical_id text;
declare expected_physical_id text;
declare expected_idempotency_key text;
declare expected_fingerprint text;
declare recorded_at timestamptz := clock_timestamp();
declare next_state text;
declare existing_movements jsonb;
declare release_movement jsonb;
begin
  if target_work_id is null
    or target_lease_generation is null
    or target_lease_token is null then
    raise exception 'Booking Request release lease is stale or expired'
      using errcode = 'RC409';
  end if;
  if target_payment_snapshot is null
    or coalesce(jsonb_typeof(target_payment_snapshot), '') <> 'object'
    or not target_payment_snapshot ? 'movements'
    or coalesce(jsonb_typeof(target_payment_snapshot -> 'movements'), '') <> 'array'
    or target_provider_identity is null
    or coalesce(jsonb_typeof(target_provider_identity), '') <> 'object'
    or next_release is null
    or coalesce(jsonb_typeof(next_release), '') <> 'object'
    or not (next_release ?& array[
      'paymentLifecycleId', 'kind', 'logicalOperationId', 'attemptId', 'status',
      'amountFils', 'providerRequestId', 'providerReference',
      'movementReference', 'reconciliationRequired', 'retrySafe'
    ])
    or next_release -> 'paymentLifecycleId' = 'null'::jsonb
    or next_release -> 'kind' = 'null'::jsonb
    or next_release -> 'logicalOperationId' = 'null'::jsonb
    or next_release -> 'attemptId' = 'null'::jsonb
    or next_release -> 'status' = 'null'::jsonb
    or next_release -> 'amountFils' = 'null'::jsonb
    or next_release -> 'reconciliationRequired' = 'null'::jsonb
    or next_release -> 'retrySafe' = 'null'::jsonb then
    raise exception 'Booking Request release evidence is invalid'
      using errcode = '22023';
  end if;
  select * into work from public.booking_request_release_work release_work
  where release_work.id = target_work_id for update;
  if not found then raise exception 'Booking Request release work is unavailable'
    using errcode = 'RC404'; end if;
  select * into attempt from public.booking_request_submission_attempts attempts
  where attempts.id = work.attempt_id for update;
  select * into claim from public.booking_request_authorization_claims claims
  where claims.attempt_id = attempt.id for update;
  if work.state <> 'processing'
    or work.lease_generation <> target_lease_generation
    or work.lease_token <> target_lease_token
    or recorded_at >= work.lease_expires_at then
    raise exception 'Booking Request release lease is stale or expired'
      using errcode = 'RC409';
  end if;
  if work.active_operation_id is not null then
    select * into operation from public.booking_request_release_operations operations
    where operations.id = work.active_operation_id
      and operations.work_id = work.id
      and operations.attempt_id = attempt.id
    for update;
    select * into provider_operation
    from public.simulated_payment_provider_operations provider_operations
    where provider_operations.provider = operation.provider
      and provider_operations.environment = operation.environment
      and provider_operations.merchant_id = operation.merchant_id
      and provider_operations.terminal_id = operation.terminal_id
      and provider_operations.provider_idempotency_key =
        operation.provider_idempotency_key
    for update;
  end if;
  expected_total := claim.amount_fils;
  expected_logical_id := attempt.payment_lifecycle_id::text || ':release';
  existing_release := nullif(attempt.payment_snapshot -> 'release', 'null'::jsonb);
  existing_movements := attempt.payment_snapshot -> 'movements';
  if coalesce(jsonb_typeof(existing_movements), '') <> 'array' then
    raise exception 'Stored Booking Request payment movements are invalid'
      using errcode = 'RC409';
  end if;
  release_movement := target_payment_snapshot -> 'movements'
    -> jsonb_array_length(existing_movements);
  if claim.id is null
    or claim.payment_lifecycle_id <> attempt.payment_lifecycle_id
    or claim.amount_fils <> expected_total
    or claim.state <> 'converted'
    or attempt.payment_snapshot -> 'authorization' ->> 'status' <> 'succeeded'
    or attempt.payment_snapshot -> 'capture' <> 'null'::jsonb
    or target_payment_snapshot -> 'authorization'
      is distinct from attempt.payment_snapshot -> 'authorization'
    or target_payment_snapshot - 'release' - 'movements'
      is distinct from attempt.payment_snapshot - 'release' - 'movements'
    or target_provider_identity is distinct from jsonb_build_object(
      'provider', attempt.authorization_provider,
      'environment', attempt.authorization_environment,
      'merchantId', attempt.authorization_merchant_id,
      'terminalId', attempt.authorization_terminal_id
    )
    or next_release is null
    or next_release ->> 'paymentLifecycleId' <> attempt.payment_lifecycle_id::text
    or next_release ->> 'kind' <> 'release'
    or next_release ->> 'logicalOperationId' <> expected_logical_id
    or (next_release ->> 'amountFils')::bigint <> expected_total then
    raise exception 'Booking Request release evidence is invalid'
      using errcode = '22023';
  end if;
  if next_release ->> 'status' <> 'succeeded'
    and target_payment_snapshot -> 'movements'
      is distinct from existing_movements then
    raise exception 'Booking Request release movement evidence is invalid'
      using errcode = '22023';
  end if;

  if next_release ->> 'status' = 'pending'
    and next_release -> 'providerRequestId' = 'null'::jsonb
    and next_release -> 'providerReference' = 'null'::jsonb
    and next_release -> 'movementReference' = 'null'::jsonb
    and not (next_release ->> 'reconciliationRequired')::boolean
    and not (next_release ->> 'retrySafe')::boolean then
    if operation.id is not null and operation.state <> 'retryable' then
      raise exception 'Prior Booking Request release operation is not retryable'
        using errcode = 'RC409';
    end if;
    if operation.id is null and existing_release is not null then
      raise exception 'Booking Request release operation linkage is invalid'
        using errcode = 'RC409';
    end if;
    if operation.id is not null and (
      existing_release ->> 'status' <> 'failed'
      or not (existing_release ->> 'retrySafe')::boolean
    ) then
      raise exception 'Prior Booking Request release evidence is not retryable'
        using errcode = 'RC409';
    end if;
    expected_generation := coalesce(operation.operation_generation + 1, 1);
    expected_attempt_number :=
      split_part(claim.physical_attempt_id, ':attempt-', 2)::integer
      + expected_generation;
    expected_physical_id := expected_logical_id || ':attempt-'
      || expected_attempt_number::text;
    expected_idempotency_key := 'booking-request-release:' || work.id::text
      || ':' || expected_generation::text;
    expected_fingerprint := public.booking_request_release_fingerprint(
      claim.provider, claim.environment, claim.merchant_id, claim.terminal_id,
      attempt.payment_lifecycle_id, expected_logical_id, expected_physical_id,
      expected_total, claim.currency
    );
    if next_release ->> 'attemptId' <> expected_physical_id then
      raise exception 'Booking Request release generation does not match its attempt'
        using errcode = 'RC409';
    end if;
    insert into public.booking_request_release_operations (
      work_id, attempt_id, operation_generation, payment_lifecycle_id,
      logical_operation_id, physical_attempt_id, amount_fils, currency,
      provider, environment, merchant_id, terminal_id,
      provider_idempotency_key, request_fingerprint,
      state, provider_outcome, execution_started_at, updated_at
    ) values (
      work.id, attempt.id, expected_generation, attempt.payment_lifecycle_id,
      expected_logical_id, expected_physical_id, expected_total, claim.currency,
      claim.provider, claim.environment, claim.merchant_id, claim.terminal_id,
      expected_idempotency_key, expected_fingerprint,
      'executing', 'unknown', recorded_at, recorded_at
    ) returning * into operation;
    update public.booking_request_release_work
    set active_operation_id = operation.id where id = work.id;
    update public.booking_request_submission_attempts
    set payment_snapshot = target_payment_snapshot,
      state = 'releasing', updated_at = recorded_at
    where id = attempt.id;
    return jsonb_build_object(
      'purpose', 'booking-request-release',
      'workId', work.id,
      'leaseGeneration', work.lease_generation,
      'leaseToken', work.lease_token,
      'operationId', operation.id,
      'operationGeneration', operation.operation_generation,
      'idempotencyKey', operation.provider_idempotency_key,
      'requestFingerprint', operation.request_fingerprint,
      'notAfter', to_char(work.lease_expires_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  end if;

  if operation.id is null
    or next_release ->> 'attemptId' <> operation.physical_attempt_id
    or next_release ->> 'logicalOperationId' <> operation.logical_operation_id
    or (next_release ->> 'amountFils')::bigint <> operation.amount_fils then
    raise exception 'Booking Request release result does not match its active operation'
      using errcode = 'RC409';
  end if;
  if next_release ->> 'status' = 'succeeded'
    and coalesce(next_release ->> 'providerRequestId', '') <> ''
    and coalesce(next_release ->> 'providerReference', '') <> ''
    and coalesce(next_release ->> 'movementReference', '') <> ''
    and not (next_release ->> 'reconciliationRequired')::boolean
    and not (next_release ->> 'retrySafe')::boolean
    and operation.state in ('executing', 'reconcile_required')
    and provider_operation.current_outcome = 'succeeded'
    and provider_operation.request_fingerprint = operation.request_fingerprint
    and provider_operation.payment_lifecycle_id = operation.payment_lifecycle_id
    and provider_operation.logical_operation_id = operation.logical_operation_id
    and provider_operation.physical_attempt_id = operation.physical_attempt_id
    and provider_operation.amount_fils = operation.amount_fils
    and provider_operation.currency = operation.currency
    and provider_operation.provider_request_id = next_release ->> 'providerRequestId'
    and provider_operation.provider_reference = next_release ->> 'providerReference'
    and provider_operation.movement_reference = next_release ->> 'movementReference'
    and coalesce(release_movement ->> 'recordedAt', '') <> ''
    and target_payment_snapshot -> 'movements' is not distinct from
      existing_movements || jsonb_build_array(jsonb_build_object(
        'kind', 'release',
        'logicalOperationId', next_release ->> 'logicalOperationId',
        'attemptId', next_release ->> 'attemptId',
        'amountFils', expected_total,
        'movementReference', next_release ->> 'movementReference',
        'recordedAt', release_movement ->> 'recordedAt'
      )) then
    next_state := 'released';
    update public.booking_request_release_operations set
      state = 'succeeded', provider_outcome = 'succeeded',
      provider_request_id = next_release ->> 'providerRequestId',
      provider_reference = next_release ->> 'providerReference',
      movement_reference = next_release ->> 'movementReference',
      retry_safe = false, result_recorded_at = recorded_at, updated_at = recorded_at
    where id = operation.id;
  elsif next_release ->> 'status' = 'failed'
    and (next_release ->> 'retrySafe')::boolean
    and not (next_release ->> 'reconciliationRequired')::boolean
    and next_release -> 'movementReference' = 'null'::jsonb
    and next_release -> 'providerRequestId' = 'null'::jsonb
    and next_release -> 'providerReference' = 'null'::jsonb
    and provider_operation.id is null
    and operation.state = 'retryable'
    and operation.provider_outcome = 'not_executed'
    and operation.retry_safe then
    next_state := 'reconciliation_required';
  elsif next_release ->> 'status' = 'failed'
    and (next_release ->> 'retrySafe')::boolean
    and not (next_release ->> 'reconciliationRequired')::boolean
    and next_release -> 'movementReference' = 'null'::jsonb
    and operation.state in ('executing', 'reconcile_required')
    and provider_operation.current_outcome = 'failed'
    and provider_operation.request_fingerprint = operation.request_fingerprint
    and provider_operation.payment_lifecycle_id = operation.payment_lifecycle_id
    and provider_operation.logical_operation_id = operation.logical_operation_id
    and provider_operation.physical_attempt_id = operation.physical_attempt_id
    and provider_operation.amount_fils = operation.amount_fils
    and provider_operation.currency = operation.currency
    and provider_operation.provider_request_id = next_release ->> 'providerRequestId'
    and provider_operation.provider_reference = next_release ->> 'providerReference' then
    next_state := 'reconciliation_required';
    update public.booking_request_release_operations set
      state = 'retryable', provider_outcome = 'failed',
      provider_request_id = next_release ->> 'providerRequestId',
      provider_reference = next_release ->> 'providerReference',
      movement_reference = null, retry_safe = true,
      result_recorded_at = recorded_at, updated_at = recorded_at
    where id = operation.id;
  elsif next_release ->> 'status' = 'pending'
    and (next_release ->> 'reconciliationRequired')::boolean
    and operation.state in ('executing', 'reconcile_required')
    and (
      (next_release -> 'providerRequestId' = 'null'::jsonb
        and next_release -> 'providerReference' = 'null'::jsonb
        and next_release -> 'movementReference' = 'null'::jsonb
        and provider_operation.id is null
        and operation.state = 'reconcile_required')
      or
      (provider_operation.current_outcome = 'indeterminate'
        and provider_operation.request_fingerprint = operation.request_fingerprint
        and provider_operation.payment_lifecycle_id = operation.payment_lifecycle_id
        and provider_operation.logical_operation_id = operation.logical_operation_id
        and provider_operation.physical_attempt_id = operation.physical_attempt_id
        and provider_operation.amount_fils = operation.amount_fils
        and provider_operation.currency = operation.currency
        and provider_operation.provider_request_id = next_release ->> 'providerRequestId'
        and provider_operation.provider_reference = next_release ->> 'providerReference'
        and provider_operation.movement_reference = next_release ->> 'movementReference')
    ) then
    next_state := 'reconciliation_required';
    update public.booking_request_release_operations set
      state = 'reconcile_required',
      provider_outcome = case
        when next_release -> 'providerRequestId' = 'null'::jsonb then 'unknown'
        else 'indeterminate' end,
      provider_request_id = nullif(next_release ->> 'providerRequestId', ''),
      provider_reference = nullif(next_release ->> 'providerReference', ''),
      movement_reference = nullif(next_release ->> 'movementReference', ''),
      retry_safe = false,
      result_recorded_at = case
        when next_release -> 'providerRequestId' = 'null'::jsonb then null
        else recorded_at end,
      updated_at = recorded_at
    where id = operation.id;
  else
    raise exception 'Booking Request release result shape is invalid'
      using errcode = '22023';
  end if;
  update public.booking_request_submission_attempts
  set payment_snapshot = target_payment_snapshot,
    state = next_state,
    release_provider_request_id = case when next_state = 'released'
      then next_release ->> 'providerRequestId' else release_provider_request_id end,
    release_provider_reference = case when next_state = 'released'
      then next_release ->> 'providerReference' else release_provider_reference end,
    release_movement_reference = case when next_state = 'released'
      then next_release ->> 'movementReference' else release_movement_reference end,
    updated_at = recorded_at
  where id = attempt.id;
  return null;
end;
$$;
revoke all on function public.save_booking_request_release_snapshot(
  uuid, bigint, uuid, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.save_booking_request_release_snapshot(
  uuid, bigint, uuid, jsonb, jsonb
) to service_role;
create function public.finalize_booking_request_release(
  target_work_id uuid,
  target_lease_generation bigint,
  target_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare work public.booking_request_release_work;
declare target_request public.booking_requests;
declare attempt public.booking_request_submission_attempts;
declare operation public.booking_request_release_operations;
declare finalized_at timestamptz := clock_timestamp();
begin
  if target_work_id is null
    or target_lease_generation is null
    or target_lease_token is null then
    raise exception 'Booking Request release lease is stale or expired'
      using errcode = 'RC409';
  end if;
  select * into work from public.booking_request_release_work release_work
  where release_work.id = target_work_id for update;
  if not found then return jsonb_build_object('status', 'unavailable'); end if;
  select * into target_request from public.booking_requests requests
  where requests.id = work.booking_request_id for update;
  if work.state = 'complete' then return jsonb_build_object(
    'status', work.outcome,
    'bookingRequestReference', target_request.booking_request_reference
  ); end if;
  if work.lease_generation <> target_lease_generation
    or work.lease_token <> target_lease_token
    or finalized_at >= work.lease_expires_at then
    raise exception 'Booking Request release lease is stale or expired'
      using errcode = 'RC409';
  end if;
  select * into attempt from public.booking_request_submission_attempts attempts
  where attempts.id = work.attempt_id for update;
  select * into operation from public.booking_request_release_operations operations
  where operations.id = work.active_operation_id
    and operations.work_id = work.id
    and operations.attempt_id = attempt.id
    and operations.payment_lifecycle_id = attempt.payment_lifecycle_id
  for update;
  if operation.id is null
    or operation.state <> 'succeeded'
    or operation.provider_outcome <> 'succeeded'
    or attempt.payment_snapshot -> 'release' ->> 'status'
      is distinct from 'succeeded'
    or attempt.payment_snapshot -> 'release' ->> 'attemptId'
      is distinct from operation.physical_attempt_id
    or attempt.payment_snapshot -> 'release' ->> 'logicalOperationId'
      is distinct from operation.logical_operation_id
    or (attempt.payment_snapshot -> 'release' ->> 'amountFils')::bigint
      is distinct from operation.amount_fils
    or attempt.payment_snapshot -> 'release' ->> 'providerRequestId'
      is distinct from operation.provider_request_id
    or attempt.payment_snapshot -> 'release' ->> 'providerReference'
      is distinct from operation.provider_reference
    or attempt.payment_snapshot -> 'release' ->> 'movementReference'
      is distinct from operation.movement_reference then
    return jsonb_build_object(
      'status', 'processing',
      'bookingRequestReference', target_request.booking_request_reference
    );
  end if;
  update public.cottage_booking_period_commitments set status = 'released_hold'
  where id = target_request.booking_period_commitment_id and status = 'pending_hold';
  update public.cottage_booking_period_occupancies set active = false
  where booking_period_commitment_id = target_request.booking_period_commitment_id
    and active;
  update public.booking_requests set status = work.outcome,
    settled_at = finalized_at where id = target_request.id;
  update public.booking_request_release_work set state = 'complete',
    completed_at = finalized_at, lease_token = null, lease_expires_at = null
  where id = work.id;
  update public.booking_request_submission_attempts
  set intent_dedupe_active = false, updated_at = finalized_at
  where id = attempt.id;
  insert into public.booking_request_status_notifications (
    booking_request_id, recipient_user_id, status, created_at
  ) values
    (target_request.id, target_request.owner_user_id, work.outcome, finalized_at),
    (target_request.id, target_request.customer_user_id, work.outcome, finalized_at)
  on conflict do nothing;
  return jsonb_build_object(
    'status', work.outcome,
    'bookingRequestReference', target_request.booking_request_reference
  );
end;
$$;
revoke all on function public.finalize_booking_request_release(
  uuid, bigint, uuid
) from public, anon, authenticated;
grant execute on function public.finalize_booking_request_release(
  uuid, bigint, uuid
) to service_role;
create function public.get_customer_booking_request(target_reference text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', requests.id,
    'bookingRequestReference', requests.booking_request_reference,
    'status', requests.status,
    'cottageName', snapshots.quote_payload ->> 'cottageName',
    'bookingPeriod', snapshots.quote_payload -> 'items',
    'partySize', requests.party_size,
    'bookingPriceIqd', (snapshots.quote_payload ->> 'bookingPriceIqd')::bigint,
    'serviceFeeIqd', (snapshots.quote_payload ->> 'serviceFeeIqd')::bigint,
    'customerTotalIqd', (snapshots.quote_payload ->> 'customerTotalIqd')::bigint,
    'responseDeadline', to_char(requests.response_deadline at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'declineReason', requests.decline_reason,
    'declineNote', requests.decline_note,
    'statusNotifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', receipts.id, 'status', receipts.status,
        'createdAt', to_char(receipts.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) order by receipts.created_at)
      from public.booking_request_status_notifications receipts
      where receipts.booking_request_id = requests.id
        and receipts.recipient_user_id = (select auth.uid())
    ), '[]'::jsonb)
  )
  from public.booking_requests requests
  join public.booking_snapshots snapshots on snapshots.id = requests.booking_snapshot_id
  where requests.booking_request_reference = target_reference
    and requests.customer_user_id = (select auth.uid())
    and exists (select 1 from public.account_contexts contexts
      where contexts.user_id = (select auth.uid())
        and contexts.role = 'customer'::public.account_role);
$$;
revoke all on function public.get_customer_booking_request(text) from public, anon;
grant execute on function public.get_customer_booking_request(text) to authenticated;

create or replace function public.cottage_inventory_component_available_without_auth_claim(
  target_schedule_revision_id uuid,
  target_shift_id uuid,
  target_service_day date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cottage_shifts shifts
    join public.cottage_inventory_availability availability
      on availability.schedule_revision_id = shifts.schedule_revision_id
      and availability.unit_kind = 'shift'::public.cottage_inventory_unit_kind
      and availability.unit_id = shifts.id
      and availability.service_day = target_service_day
      and availability.state = 'open'::public.cottage_inventory_availability_state
    where shifts.schedule_revision_id = target_schedule_revision_id
      and shifts.id = target_shift_id
      and public.public_cottage_effective_price(
        shifts.schedule_revision_id, 'shift'::public.cottage_inventory_unit_kind,
        shifts.id, target_service_day
      ) is not null
      and not exists (
        select 1 from public.cottage_booking_period_occupancies occupancies
        where occupancies.schedule_revision_id = shifts.schedule_revision_id
          and occupancies.shift_id = shifts.id
          and occupancies.service_day = target_service_day
          and occupancies.active
      )
  );
$$;

create or replace function public.public_cottage_unit_is_available_without_authorization_claim(
  target_schedule_revision_id uuid,
  target_unit_kind public.cottage_inventory_unit_kind,
  target_unit_id uuid,
  target_service_day date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.public_cottage_effective_price(
      target_schedule_revision_id, target_unit_kind, target_unit_id, target_service_day
    ) is not null
    and exists (
      select 1 from public.cottage_inventory_availability availability
      where availability.schedule_revision_id = target_schedule_revision_id
        and availability.unit_kind = target_unit_kind
        and availability.unit_id = target_unit_id
        and availability.service_day = target_service_day
        and availability.state = 'open'::public.cottage_inventory_availability_state
    )
    and not exists (
      select 1
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.schedule_revision_id = target_schedule_revision_id
        and occupancies.service_day = target_service_day
        and occupancies.active
        and (
          target_unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
          or occupancies.shift_id = target_unit_id
        )
    )
    and case target_unit_kind
      when 'shift'::public.cottage_inventory_unit_kind then exists (
        select 1 from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
          and shifts.id = target_unit_id
          and ((target_service_day + shifts.start_time) at time zone 'Asia/Baghdad') > now()
      )
      else exists (
        select 1 from public.cottage_shift_schedule_revisions schedules
        where schedules.id = target_schedule_revision_id
          and schedules.full_day_bundle_id = target_unit_id
          and not exists (
            select 1 from public.cottage_shifts shifts
            where shifts.schedule_revision_id = schedules.id
              and not public.cottage_inventory_component_is_effectively_available(
                schedules.id, shifts.id, target_service_day
              )
          )
          and ((target_service_day + (
            select shifts.start_time from public.cottage_shifts shifts
            where shifts.schedule_revision_id = schedules.id
            order by shifts.position limit 1
          )) at time zone 'Asia/Baghdad') > now()
      )
    end;
$$;

create or replace function public.list_owner_booking_request_notifications()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', requests.id,
    'bookingRequestReference', requests.booking_request_reference,
    'status', requests.status,
    'customerName', requests.customer_name,
    'partySize', requests.party_size,
    'bookingNote', requests.booking_note,
    'cottageName', snapshots.quote_payload ->> 'cottageName',
    'bookingPeriod', snapshots.quote_payload -> 'items',
    'bookingPriceIqd', (snapshots.quote_payload ->> 'bookingPriceIqd')::bigint,
    'marketplaceCommissionFils', snapshots.marketplace_commission_amount_fils,
    'ownerNetFils', (snapshots.quote_payload ->> 'bookingPriceIqd')::bigint * 1000
      - snapshots.marketplace_commission_amount_fils,
    'houseRules', snapshots.quote_payload ->> 'houseRules',
    'bookingTermsVersion', snapshots.booking_terms_version,
    'cancellationPolicyVersion', snapshots.cancellation_policy_version,
    'statusNotifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', receipts.id, 'status', receipts.status,
        'createdAt', to_char(receipts.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) order by receipts.created_at)
      from public.booking_request_status_notifications receipts
      where receipts.booking_request_id = requests.id
        and receipts.recipient_user_id = (select auth.uid())
    ), '[]'::jsonb),
    'responseDeadline', to_char(requests.response_deadline at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt', to_char(notifications.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) order by notifications.created_at desc), '[]'::jsonb)
  from public.owner_request_notifications notifications
  join public.booking_requests requests on requests.id = notifications.booking_request_id
  join public.booking_snapshots snapshots on snapshots.id = requests.booking_snapshot_id
  where notifications.owner_user_id = (select auth.uid())
    and exists (select 1 from public.account_contexts contexts
      where contexts.user_id = (select auth.uid())
        and contexts.role = 'cottage_owner'::public.account_role
        and contexts.owner_approval_state = 'approved'::public.owner_approval_state);
$$;
-- Forward-only permit shape upgrade for the historical authorization claim RPC.
create or replace function public.begin_booking_request_authorization_claim(
  target_attempt_id uuid,
  target_payment_snapshot jsonb,
  target_provider_identity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare attempt public.booking_request_submission_attempts;
declare existing_claim public.booking_request_authorization_claims;
declare claim_id uuid := gen_random_uuid();
declare claim_generation integer := 1;
declare provider_idempotency_key text;
declare current_quote jsonb;
declare policy_evaluated_at timestamptz;
declare claim_created_at timestamptz;
declare first_starts_at timestamptz;
declare claim_not_after timestamptz;
declare selection jsonb;
declare resolved_selection jsonb;
declare resolved_selections jsonb := '[]'::jsonb;
declare selection_day date;
declare target_unit_kind public.cottage_inventory_unit_kind;
declare target_unit_id uuid;
declare target_schedule_revision_id uuid;
declare target_price_iqd bigint;
declare target_start_time time without time zone;
declare target_end_time time without time zone;
declare target_starts_at timestamptz;
declare target_ends_at timestamptz;
declare claim_access_ranges tstzmultirange := '{}'::tstzmultirange;
declare booking_price_iqd bigint := 0;
declare authorization_operation jsonb;
begin
  if target_attempt_id is null
    or target_payment_snapshot is null
    or coalesce(jsonb_typeof(target_payment_snapshot), '') <> 'object'
    or target_provider_identity is null
    or coalesce(jsonb_typeof(target_provider_identity), '') <> 'object'
    or (select count(*) from jsonb_object_keys(target_provider_identity)) <> 4
    or coalesce(target_provider_identity ->> 'provider', '') = ''
    or coalesce(target_provider_identity ->> 'environment', '') = ''
    or coalesce(target_provider_identity ->> 'merchantId', '') = ''
    or coalesce(target_provider_identity ->> 'terminalId', '') = '' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into attempt
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id
  for update;
  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;
  authorization_operation := target_payment_snapshot -> 'authorization';
  if authorization_operation is null
    or coalesce(jsonb_typeof(authorization_operation), '') <> 'object'
    or not (authorization_operation ?& array[
      'paymentLifecycleId', 'kind', 'logicalOperationId', 'attemptId', 'status',
      'amountFils', 'providerRequestId', 'providerReference',
      'movementReference', 'reconciliationRequired', 'retrySafe'
    ])
    or authorization_operation -> 'paymentLifecycleId' = 'null'::jsonb
    or authorization_operation -> 'kind' = 'null'::jsonb
    or authorization_operation -> 'logicalOperationId' = 'null'::jsonb
    or authorization_operation -> 'attemptId' = 'null'::jsonb
    or authorization_operation -> 'status' = 'null'::jsonb
    or authorization_operation -> 'amountFils' = 'null'::jsonb
    or authorization_operation -> 'reconciliationRequired' = 'null'::jsonb
    or authorization_operation -> 'retrySafe' = 'null'::jsonb then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into existing_claim
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id
  for update;
  if authorization_operation ->> 'kind' is distinct from 'authorization'
    or authorization_operation ->> 'paymentLifecycleId'
      is distinct from attempt.payment_lifecycle_id::text
    or authorization_operation ->> 'status' is distinct from 'pending'
    or authorization_operation -> 'providerRequestId' is distinct from 'null'::jsonb
    or authorization_operation -> 'providerReference' is distinct from 'null'::jsonb
    or authorization_operation -> 'movementReference' is distinct from 'null'::jsonb
    or (authorization_operation ->> 'reconciliationRequired')::boolean
      is distinct from false
    or (authorization_operation ->> 'retrySafe')::boolean is distinct from false
    or target_payment_snapshot -> 'capture' is distinct from 'null'::jsonb
    or target_payment_snapshot -> 'release' is distinct from 'null'::jsonb then
    return jsonb_build_object('status', 'invalid');
  end if;
  if found then
    if existing_claim.payment_lifecycle_id is distinct from attempt.payment_lifecycle_id
      or existing_claim.logical_operation_id
        is distinct from authorization_operation ->> 'logicalOperationId'
      or existing_claim.physical_attempt_id
        is distinct from authorization_operation ->> 'attemptId'
      or existing_claim.amount_fils
        is distinct from (authorization_operation ->> 'amountFils')::bigint
      or existing_claim.provider is distinct from target_provider_identity ->> 'provider'
      or existing_claim.environment is distinct from target_provider_identity ->> 'environment'
      or existing_claim.merchant_id is distinct from target_provider_identity ->> 'merchantId'
      or existing_claim.terminal_id is distinct from target_provider_identity ->> 'terminalId'
      or existing_claim.quote_fingerprint is distinct from attempt.quote_fingerprint
      or existing_claim.intent_fingerprint is distinct from attempt.intent_fingerprint then
      return jsonb_build_object('status', 'invalid');
    end if;
    if public.booking_request_claim_state_allows_authorization(existing_claim.state)
      and attempt.payment_snapshot -> 'release' = 'null'::jsonb
      and clock_timestamp() < existing_claim.not_after then
      return jsonb_build_object(
        'status', 'ready',
        'executionPermit', jsonb_build_object(
          'purpose', 'booking-request-authorization',
          'claimId', existing_claim.id,
          'generation', existing_claim.generation,
          'idempotencyKey', existing_claim.provider_idempotency_key,
          'notAfter', to_char(existing_claim.not_after at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
      );
    end if;
    return jsonb_build_object('status', 'too-late');
  end if;

  perform contexts.user_id
  from public.account_contexts contexts
  where contexts.user_id = attempt.customer_user_id
  for update;
  select profiles.current_shift_schedule_id into target_schedule_revision_id
  from public.owner_application_cottage_profiles profiles
  where profiles.id = attempt.profile_id
  for update;
  if target_schedule_revision_id is null then
    return jsonb_build_object('status', 'unavailable');
  end if;

  if attempt.payment_snapshot is not null
    or attempt.state <> 'authorizing' then
    return jsonb_build_object('status', 'invalid');
  end if;

  policy_evaluated_at := clock_timestamp();
  current_quote := public.get_public_booking_quote_with_fingerprint(
    attempt.locale, attempt.public_slug, attempt.requested_search
  );
  if current_quote ->> 'status' <> 'quoted'
    or current_quote ->> 'quoteFingerprint' <> attempt.quote_fingerprint
    or current_quote - 'status' <> attempt.quote_payload then
    return jsonb_build_object('status', 'quote-stale');
  end if;
  first_starts_at := (current_quote -> 'items' -> 0 ->> 'startsAt')::timestamptz;
  claim_not_after := first_starts_at - interval '6 hours';
  if (attempt.intent_payload ->> 'acceptedInside48HourNoRefund')::boolean
    is not true then
    claim_not_after := least(
      claim_not_after, first_starts_at - interval '48 hours'
    );
  end if;
  if policy_evaluated_at >= claim_not_after then
    return jsonb_build_object(
      'status', case
        when policy_evaluated_at >= first_starts_at - interval '6 hours'
          then 'too-late'
        else 'invalid'
      end
    );
  end if;

  for selection in
    select value
    from jsonb_array_elements(attempt.requested_search -> 'selections') selections(value)
    order by value ->> 'serviceDay', coalesce((value ->> 'position')::integer, 32767)
  loop
    selection_day := (selection ->> 'serviceDay')::date;
    if selection ->> 'kind' = 'shift' then
      target_unit_kind := 'shift'::public.cottage_inventory_unit_kind;
      select shifts.id, shifts.start_time, shifts.end_time
        into target_unit_id, target_start_time, target_end_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id
        and shifts.position = (selection ->> 'position')::smallint;
    else
      target_unit_kind := 'full_day_bundle'::public.cottage_inventory_unit_kind;
      select schedules.full_day_bundle_id,
        (select shifts.start_time from public.cottage_shifts shifts
          where shifts.schedule_revision_id = schedules.id
          order by shifts.position limit 1),
        (select shifts.end_time from public.cottage_shifts shifts
          where shifts.schedule_revision_id = schedules.id
          order by shifts.position desc limit 1)
        into target_unit_id, target_start_time, target_end_time
      from public.cottage_shift_schedule_revisions schedules
      where schedules.id = target_schedule_revision_id;
    end if;
    target_price_iqd := public.public_cottage_effective_price(
      target_schedule_revision_id,
      target_unit_kind, target_unit_id, selection_day
    );
    if target_unit_id is null
      or target_price_iqd is null
      or not coalesce(public.public_cottage_unit_is_available(
        target_schedule_revision_id,
        target_unit_kind, target_unit_id, selection_day
      ), false) then
      return jsonb_build_object('status', 'unavailable');
    end if;
    target_starts_at := (selection_day + target_start_time)
      at time zone 'Asia/Baghdad';
    target_ends_at := (
      selection_day + target_end_time
      + case when target_end_time < target_start_time
        then interval '1 day' else interval '0 days' end
    ) at time zone 'Asia/Baghdad';
    if target_unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      and exists (
        select 1
        from jsonb_array_elements(attempt.requested_search -> 'selections') next_selection(value)
        where value ->> 'kind' = 'full-day'
          and (value ->> 'serviceDay')::date = selection_day + 1
      ) then
      target_ends_at := (selection_day + 1 + target_start_time)
        at time zone 'Asia/Baghdad';
    end if;
    claim_access_ranges := claim_access_ranges
      + tstzmultirange(tstzrange(target_starts_at, target_ends_at, '[)'));
    resolved_selections := resolved_selections || jsonb_build_array(
      jsonb_build_object(
        'serviceDay', selection_day, 'unitKind', target_unit_kind,
        'unitId', target_unit_id, 'priceIqd', target_price_iqd
      )
    );
    booking_price_iqd := booking_price_iqd + target_price_iqd;
  end loop;
  if booking_price_iqd <> (attempt.quote_payload ->> 'bookingPriceIqd')::bigint
    or exists (
      select 1
      from public.cottage_booking_period_commitments commitments
      where commitments.customer_user_id = attempt.customer_user_id
        and commitments.status in ('pending_hold', 'confirmed_booking')
        and commitments.access_ranges && claim_access_ranges
    ) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  claim_created_at := clock_timestamp();
  provider_idempotency_key := 'booking-request:' || claim_id::text || ':1';
  begin
    insert into public.booking_request_authorization_claims (
      id, attempt_id, generation, state, customer_user_id, profile_id,
      schedule_revision_id, payment_lifecycle_id, logical_operation_id,
      physical_attempt_id, amount_fils, currency,
      provider, environment, merchant_id, terminal_id,
      provider_idempotency_key, quote_fingerprint, intent_fingerprint,
      access_ranges, not_after, reconciliation_expires_at,
      created_at, updated_at
    ) values (
      claim_id, attempt.id, claim_generation, 'starting',
      attempt.customer_user_id, attempt.profile_id,
      target_schedule_revision_id,
      attempt.payment_lifecycle_id,
      authorization_operation ->> 'logicalOperationId',
      authorization_operation ->> 'attemptId',
      (authorization_operation ->> 'amountFils')::bigint, 'IQD',
      target_provider_identity ->> 'provider',
      target_provider_identity ->> 'environment',
      target_provider_identity ->> 'merchantId',
      target_provider_identity ->> 'terminalId',
      provider_idempotency_key, attempt.quote_fingerprint,
      attempt.intent_fingerprint, claim_access_ranges, claim_not_after,
      least(claim_not_after, claim_created_at + interval '5 minutes'),
      claim_created_at, claim_created_at
    );
    for resolved_selection in
      select value from jsonb_array_elements(resolved_selections) selections(value)
    loop
      insert into public.booking_request_authorization_claim_items (
        claim_id, unit_kind, unit_id, service_day, price_iqd
      ) values (
        claim_id,
        (resolved_selection ->> 'unitKind')::public.cottage_inventory_unit_kind,
        (resolved_selection ->> 'unitId')::uuid,
        (resolved_selection ->> 'serviceDay')::date,
        (resolved_selection ->> 'priceIqd')::bigint
      );
      if resolved_selection ->> 'unitKind' = 'shift' then
        insert into public.booking_request_authorization_claim_occupancies (
          claim_id, schedule_revision_id, shift_id, service_day
        ) values (
          claim_id, target_schedule_revision_id,
          (resolved_selection ->> 'unitId')::uuid,
          (resolved_selection ->> 'serviceDay')::date
        );
      else
        insert into public.booking_request_authorization_claim_occupancies (
          claim_id, schedule_revision_id, shift_id, service_day
        ) select claim_id,
          target_schedule_revision_id,
          shifts.id, (resolved_selection ->> 'serviceDay')::date
        from public.cottage_shifts shifts
        where shifts.schedule_revision_id =
          target_schedule_revision_id;
      end if;
    end loop;
  exception when unique_violation or exclusion_violation then
    return jsonb_build_object('status', 'unavailable');
  end;

  perform public.save_booking_request_payment_snapshot(
    attempt.id, target_payment_snapshot, target_provider_identity
  );
  update public.booking_request_submission_attempts attempts
  set payment_snapshot = jsonb_set(
      attempts.payment_snapshot,
      '{authorization,reconciliationRequired}', 'true'::jsonb
    ),
    state = 'reconciliation_required',
    updated_at = clock_timestamp()
  where attempts.id = attempt.id;
  insert into public.booking_request_authorization_reconciliation_outbox (
    claim_id, claim_generation, observed_state_revision, state
  ) values (claim_id, claim_generation, 1, 'pending');

  return jsonb_build_object(
    'status', 'ready',
    'executionPermit', jsonb_build_object(
      'purpose', 'booking-request-authorization',
      'claimId', claim_id,
      'generation', claim_generation,
      'idempotencyKey', provider_idempotency_key,
      'notAfter', to_char(claim_not_after at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
end;
$$;

revoke all on function public.begin_booking_request_authorization_claim(
  uuid, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.begin_booking_request_authorization_claim(
  uuid, jsonb, jsonb
) to service_role;
