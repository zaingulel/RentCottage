-- Keep every Booking Request release path on the same row-lock order:
-- request -> release work -> submission attempt -> release operation.
create or replace function public.lease_booking_request_release_work(
  target_work_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare work public.booking_request_release_work;
declare operation public.booking_request_release_operations;
declare attempt public.booking_request_submission_attempts;
declare target_request public.booking_requests;
declare target_booking_request_id uuid;
declare leased_at timestamptz := date_trunc('milliseconds', clock_timestamp());
begin
  select release_work.booking_request_id into target_booking_request_id
  from public.booking_request_release_work release_work
  where release_work.id = target_work_id;
  if not found then return jsonb_build_object('status', 'unavailable'); end if;
  select * into target_request from public.booking_requests requests
  where requests.id = target_booking_request_id
  for update of requests;
  if not found then return jsonb_build_object('status', 'unavailable'); end if;
  select * into work from public.booking_request_release_work release_work
  where release_work.id = target_work_id
    and release_work.booking_request_id = target_booking_request_id
  for update of release_work;
  if not found then return jsonb_build_object('status', 'unavailable'); end if;
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
    select * into attempt from public.booking_request_submission_attempts attempts
    where attempts.id = work.attempt_id
    for update of attempts;
    select * into operation from public.booking_request_release_operations operations
    where operations.id = work.active_operation_id
      and operations.work_id = work.id
    for update of operations;
    if not found then
      raise exception 'Booking Request active release operation is unavailable'
        using errcode = 'RC409';
    end if;
    if operation.state = 'executing' then
      update public.booking_request_release_operations
      set state = 'reconcile_required', updated_at = leased_at
      where id = operation.id;
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

create or replace function public.finalize_booking_request_release(
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
declare target_booking_request_id uuid;
declare finalized_at timestamptz := clock_timestamp();
begin
  if target_work_id is null
    or target_lease_generation is null
    or target_lease_token is null then
    raise exception 'Booking Request release lease is stale or expired'
      using errcode = 'RC409';
  end if;
  select release_work.booking_request_id into target_booking_request_id
  from public.booking_request_release_work release_work
  where release_work.id = target_work_id;
  if not found then return jsonb_build_object('status', 'unavailable'); end if;
  select * into target_request from public.booking_requests requests
  where requests.id = target_booking_request_id
  for update of requests;
  if not found then return jsonb_build_object('status', 'unavailable'); end if;
  select * into work from public.booking_request_release_work release_work
  where release_work.id = target_work_id
    and release_work.booking_request_id = target_booking_request_id
  for update of release_work;
  if not found then return jsonb_build_object('status', 'unavailable'); end if;
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
  where attempts.id = work.attempt_id
  for update of attempts;
  select * into operation from public.booking_request_release_operations operations
  where operations.id = work.active_operation_id
    and operations.work_id = work.id
    and operations.attempt_id = attempt.id
    and operations.payment_lifecycle_id = attempt.payment_lifecycle_id
  for update of operations;
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
