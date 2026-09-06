-- Forward rollback must disable new admission and dispatch, retaining controlled
-- completion/reconciliation and all capture evidence, commitments and receipts.
-- Never restore acceptance without capture admission or backfill historical requests.
create or replace function public.claim_booking_request_action(
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
declare authorization_claim public.booking_request_authorization_claims;
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

  if target_action = 'accept' then
    select * into target_attempt from public.booking_request_submission_attempts attempts
    where attempts.booking_request_id = target_request.id for update;
    select * into authorization_claim from public.booking_request_authorization_claims claims
    where claims.attempt_id = target_attempt.id and claims.state = 'converted' for update;
    if target_attempt.id is null or target_attempt.state <> 'finalized'
      or authorization_claim.id is null then
      raise exception 'Booking Request capture authorization is unavailable' using errcode = 'RC409';
    end if;
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
    fingerprint := encode(
      extensions.digest(
        convert_to(
          '{"provider":{"provider":' || to_json(authorization_claim.provider)::text
          || ',"environment":' || to_json(authorization_claim.environment)::text
          || ',"merchantId":' || to_json(authorization_claim.merchant_id)::text
          || ',"terminalId":' || to_json(authorization_claim.terminal_id)::text
          || '},"kind":"capture","paymentLifecycleId":'
          || to_json(authorization_claim.payment_lifecycle_id::text)::text
          || ',"logicalOperationId":'
          || to_json((authorization_claim.payment_lifecycle_id::text || ':capture'))::text
          || ',"attemptId":' || to_json((authorization_claim.payment_lifecycle_id::text || ':capture:attempt-2'))::text
          || ',"amountFils":' || authorization_claim.amount_fils::text
          || ',"currency":"IQD"}',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    insert into public.booking_request_capture_work (
      booking_request_id, attempt_id, authorization_claim_id, authorization_claim_generation,
      payment_lifecycle_id, authorization_logical_operation_id, authorization_physical_attempt_id,
      capture_logical_operation_id, capture_physical_attempt_id, amount_fils, currency,
      provider, environment, merchant_id, terminal_id, provider_idempotency_key, request_fingerprint
    ) values (
      target_request.id, target_attempt.id, authorization_claim.id, authorization_claim.generation,
      authorization_claim.payment_lifecycle_id, authorization_claim.logical_operation_id, authorization_claim.physical_attempt_id,
      authorization_claim.payment_lifecycle_id::text || ':capture',
      authorization_claim.payment_lifecycle_id::text || ':capture:attempt-2', authorization_claim.amount_fils, authorization_claim.currency,
      authorization_claim.provider, authorization_claim.environment, authorization_claim.merchant_id, authorization_claim.terminal_id,
      'booking-request-capture:' || target_request.id::text || ':' || authorization_claim.generation::text, fingerprint
    );
    perform public.lock_booking_request_capture_source(target_request.id);
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

create or replace function public.list_due_booking_request_capture_intents(target_limit integer, target_provider_identity jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if target_limit is null or target_limit < 1 or target_limit > 50
    or target_provider_identity is null
    or jsonb_typeof(target_provider_identity) <> 'object'
    or not target_provider_identity ?& array['provider','environment','merchantId','terminalId']
    or target_provider_identity - array['provider','environment','merchantId','terminalId'] <> '{}'::jsonb
    or exists (select 1 from jsonb_each(target_provider_identity) fields
      where jsonb_typeof(fields.value) <> 'string' or btrim(fields.value #>> '{}') = '') then
    raise exception 'Capture intent selection is invalid' using errcode = 'RC409';
  end if;
  return (select coalesce(jsonb_agg(selected.id), '[]'::jsonb) from (
    select requests.id from public.booking_requests requests
    join public.booking_request_capture_work work on work.booking_request_id = requests.id
    where requests.status = 'accepted' and work.state = 'queued'
      and work.provider = target_provider_identity ->> 'provider'
      and work.environment = target_provider_identity ->> 'environment'
      and work.merchant_id = target_provider_identity ->> 'merchantId'
      and work.terminal_id = target_provider_identity ->> 'terminalId'
    order by work.created_at, requests.id limit target_limit
  ) selected);
end;
$$;
revoke all on function public.list_due_booking_request_capture_intents(integer,jsonb) from public, anon, authenticated;
grant execute on function public.list_due_booking_request_capture_intents(integer,jsonb) to service_role;
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
        'providerReference', ledger.provider_reference, 'movementReference', ledger.movement_reference)
    )));
  end loop;
  return results;
end;
$$;
revoke all on function public.claim_due_booking_request_captures(integer,jsonb) from public, anon, authenticated;
grant execute on function public.claim_due_booking_request_captures(integer,jsonb) to service_role;

create or replace function public.get_customer_booking_request(target_reference text)
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
    'paymentStatus', case when requests.status = 'accepted' then case
      when exists (
        select 1 from public.booking_confirmations confirmations
        join public.cottage_booking_period_commitments commitments on commitments.id = confirmations.booking_period_commitment_id
        join public.booking_request_capture_work capture_work on capture_work.booking_request_id = confirmations.booking_request_id
        where confirmations.booking_request_id = requests.id
          and confirmations.booking_snapshot_id = requests.booking_snapshot_id
          and confirmations.booking_period_commitment_id = requests.booking_period_commitment_id
          and commitments.status = 'confirmed_booking' and capture_work.state = 'complete'
      ) then 'paid-confirmed'
      when exists (select 1 from public.booking_request_capture_work capture_work where capture_work.booking_request_id = requests.id)
        then 'capture-processing'
      end end,
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
    'paymentStatus', case when requests.status = 'accepted' then case
      when exists (
        select 1 from public.booking_confirmations confirmations
        join public.cottage_booking_period_commitments commitments on commitments.id = confirmations.booking_period_commitment_id
        join public.booking_request_capture_work capture_work on capture_work.booking_request_id = confirmations.booking_request_id
        where confirmations.booking_request_id = requests.id
          and confirmations.booking_snapshot_id = requests.booking_snapshot_id
          and confirmations.booking_period_commitment_id = requests.booking_period_commitment_id
          and commitments.status = 'confirmed_booking' and capture_work.state = 'complete'
      ) then 'paid-confirmed'
      when exists (select 1 from public.booking_request_capture_work capture_work where capture_work.booking_request_id = requests.id)
        then 'capture-processing'
      end end,
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
