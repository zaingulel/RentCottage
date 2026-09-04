create table public.booking_request_capture_work (
  booking_request_id uuid primary key
    references public.booking_requests (id) on delete restrict,
  attempt_id uuid not null,
  authorization_claim_id uuid not null,
  authorization_claim_generation integer not null
    check (authorization_claim_generation > 0),
  payment_lifecycle_id uuid not null,
  authorization_logical_operation_id text not null,
  authorization_physical_attempt_id text not null,
  capture_logical_operation_id text not null,
  capture_physical_attempt_id text not null,
  amount_fils bigint not null check (amount_fils > 0),
  currency text not null check (currency = 'IQD'),
  provider text not null,
  environment text not null,
  merchant_id text not null,
  terminal_id text not null,
  provider_idempotency_key text not null,
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null default 'queued'
    check (state in ('queued', 'processing', 'complete')),
  lease_generation bigint not null default 0 check (lease_generation >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  outcome text check (outcome = 'succeeded'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (attempt_id, payment_lifecycle_id)
    references public.booking_request_submission_attempts (
      id, payment_lifecycle_id
    ) on delete restrict,
  foreign key (authorization_claim_id, authorization_claim_generation)
    references public.booking_request_authorization_claims (id, generation)
    on delete restrict,
  check (
    (state = 'queued'
      and lease_generation = 0
      and lease_token is null
      and lease_expires_at is null
      and outcome is null
      and completed_at is null)
    or (state = 'processing'
      and lease_generation > 0
      and lease_token is not null
      and lease_expires_at is not null
      and outcome is null
      and completed_at is null)
    or (state = 'complete'
      and lease_generation > 0
      and lease_token is null
      and lease_expires_at is null
      and outcome is not null
      and outcome = 'succeeded'
      and completed_at is not null)
  )
);

create function public.enforce_booking_request_capture_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_request public.booking_requests;
declare target_attempt public.booking_request_submission_attempts;
declare target_claim public.booking_request_authorization_claims;
declare expected_fingerprint text;
begin
  if tg_op = 'UPDATE' and (
    new.booking_request_id is distinct from old.booking_request_id
    or new.attempt_id is distinct from old.attempt_id
    or new.authorization_claim_id is distinct from old.authorization_claim_id
    or new.authorization_claim_generation
      is distinct from old.authorization_claim_generation
    or new.payment_lifecycle_id is distinct from old.payment_lifecycle_id
    or new.authorization_logical_operation_id
      is distinct from old.authorization_logical_operation_id
    or new.authorization_physical_attempt_id
      is distinct from old.authorization_physical_attempt_id
    or new.capture_logical_operation_id
      is distinct from old.capture_logical_operation_id
    or new.capture_physical_attempt_id
      is distinct from old.capture_physical_attempt_id
    or new.amount_fils is distinct from old.amount_fils
    or new.currency is distinct from old.currency
    or new.provider is distinct from old.provider
    or new.environment is distinct from old.environment
    or new.merchant_id is distinct from old.merchant_id
    or new.terminal_id is distinct from old.terminal_id
    or new.provider_idempotency_key
      is distinct from old.provider_idempotency_key
    or new.request_fingerprint is distinct from old.request_fingerprint
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Booking Request capture-work bindings are immutable'
      using errcode = 'RC204';
  end if;

  if tg_op = 'UPDATE' and new.state is distinct from old.state and not (
    (old.state = 'queued' and new.state = 'processing')
    or (old.state = 'processing' and new.state = 'complete')
  ) then
    raise exception 'Booking Request capture work cannot move backwards'
      using errcode = 'RC204';
  end if;
  if tg_op = 'UPDATE' and old.state = 'complete'
    and new is distinct from old then
    raise exception 'Completed Booking Request capture work is immutable'
      using errcode = 'RC204';
  end if;

  select * into target_request
  from public.booking_requests requests
  where requests.id = new.booking_request_id;
  select * into target_attempt
  from public.booking_request_submission_attempts attempts
  where attempts.id = new.attempt_id;
  select * into target_claim
  from public.booking_request_authorization_claims claims
  where claims.id = new.authorization_claim_id;

  expected_fingerprint := encode(
    extensions.digest(
      convert_to(
        '{"provider":{"provider":' || to_json(new.provider)::text
        || ',"environment":' || to_json(new.environment)::text
        || ',"merchantId":' || to_json(new.merchant_id)::text
        || ',"terminalId":' || to_json(new.terminal_id)::text
        || '},"kind":"capture","paymentLifecycleId":'
        || to_json(new.payment_lifecycle_id::text)::text
        || ',"logicalOperationId":'
        || to_json(new.capture_logical_operation_id)::text
        || ',"attemptId":' || to_json(new.capture_physical_attempt_id)::text
        || ',"amountFils":' || new.amount_fils::text
        || ',"currency":"IQD"}',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if target_request.id is null
    or target_request.status <> 'accepted'
    or target_request.payment_lifecycle_id <> new.payment_lifecycle_id
    or target_attempt.id is null
    or target_attempt.state <> 'finalized'
    or target_attempt.booking_request_id is distinct from target_request.id
    or target_attempt.payment_lifecycle_id <> new.payment_lifecycle_id
    or target_attempt.authorization_provider is distinct from new.provider
    or target_attempt.authorization_environment is distinct from new.environment
    or target_attempt.authorization_merchant_id is distinct from new.merchant_id
    or target_attempt.authorization_terminal_id is distinct from new.terminal_id
    or target_attempt.payment_snapshot ->> 'paymentLifecycleId'
      is distinct from new.payment_lifecycle_id::text
    or target_attempt.payment_snapshot -> 'authorization' ->> 'paymentLifecycleId'
      is distinct from new.payment_lifecycle_id::text
    or target_attempt.payment_snapshot -> 'authorization' ->> 'kind'
      is distinct from 'authorization'
    or target_attempt.payment_snapshot -> 'authorization' ->> 'status'
      is distinct from 'succeeded'
    or target_attempt.payment_snapshot -> 'authorization' ->> 'logicalOperationId'
      is distinct from new.authorization_logical_operation_id
    or target_attempt.payment_snapshot -> 'authorization' ->> 'attemptId'
      is distinct from new.authorization_physical_attempt_id
    or (target_attempt.payment_snapshot -> 'authorization' ->> 'amountFils')::bigint
      is distinct from new.amount_fils
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
    or target_attempt.payment_snapshot -> 'capture'
      is distinct from 'null'::jsonb
    or target_attempt.payment_snapshot -> 'release'
      is distinct from 'null'::jsonb
    or target_claim.id is null
    or target_claim.attempt_id <> target_attempt.id
    or target_claim.generation <> new.authorization_claim_generation
    or target_claim.state <> 'converted'
    or target_claim.payment_lifecycle_id <> new.payment_lifecycle_id
    or target_claim.logical_operation_id
      <> new.authorization_logical_operation_id
    or target_claim.physical_attempt_id
      <> new.authorization_physical_attempt_id
    or target_claim.amount_fils <> new.amount_fils
    or target_claim.currency <> new.currency
    or target_claim.provider <> new.provider
    or target_claim.environment <> new.environment
    or target_claim.merchant_id <> new.merchant_id
    or target_claim.terminal_id <> new.terminal_id
    or new.capture_logical_operation_id
      <> new.payment_lifecycle_id::text || ':capture'
    or new.capture_physical_attempt_id
      <> new.capture_logical_operation_id || ':attempt-2'
    or new.capture_logical_operation_id = new.authorization_logical_operation_id
    or new.capture_physical_attempt_id = new.authorization_physical_attempt_id
    or new.provider_idempotency_key
      <> 'booking-request-capture:' || new.booking_request_id::text
        || ':' || new.authorization_claim_generation::text
    or new.request_fingerprint <> expected_fingerprint then
    raise exception 'Booking Request capture-work binding is invalid'
      using errcode = 'RC409';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_booking_request_capture_work()
  from public, anon, authenticated, service_role;

create trigger enforce_booking_request_capture_work
before insert or update on public.booking_request_capture_work
for each row execute function public.enforce_booking_request_capture_work();

alter table public.booking_request_capture_work enable row level security;

revoke all on public.booking_request_capture_work
  from public, anon, authenticated, service_role;
