-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

ALTER TABLE public.booking_request_release_work
  DROP CONSTRAINT booking_request_release_work_state_check;

CREATE OR REPLACE FUNCTION public.accept_payment_provider_observation (
  target_operation_id uuid,
  target_result       jsonb
)
  RETURNS public.payment_provider_operations
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare ledger public.payment_provider_operations;
declare accepted public.payment_provider_observations;
declare evidence jsonb:=target_result->'evidence';
declare execution_time timestamptz;
declare occurrence_time timestamptz;
declare closure_time timestamptz;
begin
  select * into ledger from public.payment_provider_operations operations where operations.id=target_operation_id for update of operations;
  if not found then raise exception 'Payment admission is missing' using errcode='RC409'; end if;
  perform public.validate_payment_provider_observation(target_result,ledger.id);
  select * into accepted from public.payment_provider_observations observations where
    (observations.provider,observations.environment,observations.merchant_id,observations.terminal_id,observations.event_id)=
    (ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,evidence->>'eventId');
  if found then
    if accepted.operation_id<>ledger.id or accepted.result is distinct from target_result then
      raise exception 'Payment event conflicts with accepted evidence' using errcode='RC409'; end if;
    return ledger;
  end if;
  if evidence->>'provenance'='legacy-simulated' and (ledger.current_outcome is null or ledger.evidence_provenance<>'legacy-simulated') then raise exception 'Historical evidence cannot be invented' using errcode='RC409'; end if;
  execution_time:=(evidence->>'executedAt')::timestamptz;
  occurrence_time:=(evidence->>'occurredAt')::timestamptz;
  closure_time:=(evidence->>'closedAt')::timestamptz;
  if ledger.evidence_provenance<>'legacy-simulated' and ((execution_time is not null and (not isfinite(execution_time) or execution_time<ledger.created_at
      or execution_time<(ledger.admission->>'notBefore')::timestamptz
      or execution_time>=(ledger.admission->>'notAfter')::timestamptz))
    or occurrence_time<execution_time or closure_time<ledger.created_at
    or (target_result->>'outcome'<>'not-executed' and evidence->>'originalOutcome'<>'indeterminate'
      and (evidence->>'originalOutcome' is distinct from target_result->>'outcome' or occurrence_time is distinct from execution_time))) then
    raise exception 'Payment observation violates its admitted execution window' using errcode='RC409'; end if;
  if ledger.current_outcome is not null and (
    (ledger.current_outcome<>'indeterminate' and ledger.current_outcome is distinct from target_result->>'outcome')
    or (ledger.admission->>'purpose'='booking-request-release' and ledger.current_outcome='failed'
      and public.payment_provider_recorded_result(ledger)->'retrySafe' is distinct from target_result->'retrySafe')
    or ledger.original_outcome is distinct from coalesce(evidence->>'originalOutcome','not-executed')
    or ledger.executed_at is distinct from execution_time
    or (ledger.provider_request_id,ledger.provider_reference) is distinct from
      (target_result->>'providerRequestId',target_result->>'providerReference')
    or (target_result->>'outcome' in ('succeeded','indeterminate') and ledger.movement_reference is distinct from target_result->>'movementReference')
    or (ledger.authoritative_outcome_at is not null and ledger.authoritative_outcome_at is distinct from occurrence_time)
  ) then raise exception 'Payment observation conflicts with admitted evidence' using errcode='RC409'; end if;
  insert into public.payment_provider_observations(operation_id,provider,environment,merchant_id,terminal_id,event_id,result,occurred_at,provenance)
    values(ledger.id,ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,evidence->>'eventId',target_result,occurrence_time,evidence->>'provenance')
    on conflict(provider,environment,merchant_id,terminal_id,event_id) do nothing returning * into accepted;
  if not found then
    select * into accepted from public.payment_provider_observations observations where
      (observations.provider,observations.environment,observations.merchant_id,observations.terminal_id,observations.event_id)=
      (ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,evidence->>'eventId');
    if accepted.operation_id is distinct from ledger.id or accepted.result is distinct from target_result then
      raise exception 'Payment event conflicts with accepted evidence' using errcode='RC409'; end if;
    return ledger;
  end if;
  update public.payment_provider_operations operations set
    original_outcome=coalesce(operations.original_outcome,evidence->>'originalOutcome','not-executed'),
    original_outcome_at=case when operations.current_outcome is null and evidence->>'originalOutcome'<>'indeterminate' then execution_time else operations.original_outcome_at end,
    executed_at=execution_time,current_outcome=target_result->>'outcome',provider_request_id=target_result->>'providerRequestId',
    provider_reference=target_result->>'providerReference',movement_reference=target_result->>'movementReference',
    authoritative_outcome_at=occurrence_time,recorded_at=accepted.received_at,updated_at=accepted.received_at,evidence_provenance=evidence->>'provenance'
    where operations.id=ledger.id returning * into ledger;
  return ledger;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_due_booking_request_releases (
  target_limit integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare target_request record;
declare work public.booking_request_release_work;
declare projected jsonb := '[]'::jsonb;
begin
  if target_limit is null or target_limit not between 1 and 50 then
    raise exception 'Booking Request release batch limit is invalid' using errcode = '22023';
  end if;
  for target_request in
    select requests.id, requests.status from public.booking_requests requests
    where (requests.status = 'processing'
       or (requests.status = 'pending' and requests.response_deadline <= clock_timestamp()))
      and not exists (select 1 from public.booking_request_release_work release_work
        where release_work.booking_request_id = requests.id and release_work.state = 'quarantined')
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
$function$;

CREATE OR REPLACE FUNCTION public.finalize_booking_request_release (
  target_work_id          uuid,
  target_lease_generation bigint,
  target_lease_token      uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
  if work.state <> 'processing'
    or work.lease_token is null or work.lease_expires_at is null
    or work.lease_generation <> target_lease_generation
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
$function$;

CREATE OR REPLACE FUNCTION public.lease_booking_request_release_work (
  target_work_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
  if work.state = 'quarantined' or public.quarantine_booking_request_release_work(work.id) then
    return jsonb_build_object('status', 'processing',
      'bookingRequestReference', target_request.booking_request_reference);
  end if;
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
$function$;

CREATE FUNCTION public.quarantine_booking_request_release_work (
  target_work_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare work public.booking_request_release_work;
declare operation public.booking_request_release_operations;
declare ledger public.payment_provider_operations;
declare quarantined_time timestamptz := clock_timestamp();
begin
  select * into work from public.booking_request_release_work release_work where release_work.id=target_work_id for update;
  if not found or work.state='complete' then return false; end if;
  if work.state='quarantined' then return true; end if;
  perform 1 from public.booking_request_submission_attempts attempts where attempts.id=work.attempt_id for update;
  perform 1 from public.booking_request_authorization_claims claims where claims.attempt_id=work.attempt_id for update;
  -- Retained provider evidence, never the retry flag in a historical snapshot, fences admission.
  select provider_ledger.* into ledger from public.payment_provider_operations provider_ledger
    join public.booking_request_release_operations operations on operations.work_id=work.id
      and provider_ledger.admission#>>'{permit,operationId}'=operations.id::text
      and provider_ledger.admission#>>'{permit,workId}'=work.id::text
      and operations.attempt_id=work.attempt_id
      and (provider_ledger.provider,provider_ledger.environment,provider_ledger.merchant_id,provider_ledger.terminal_id,
        provider_ledger.provider_idempotency_key,provider_ledger.request_fingerprint,provider_ledger.payment_lifecycle_id,
        provider_ledger.logical_operation_id,provider_ledger.physical_attempt_id,provider_ledger.amount_fils,provider_ledger.currency)
      is not distinct from (operations.provider,operations.environment,operations.merchant_id,operations.terminal_id,
        operations.provider_idempotency_key,operations.request_fingerprint,operations.payment_lifecycle_id,
        operations.logical_operation_id,operations.physical_attempt_id,operations.amount_fils,operations.currency)
    join public.booking_request_authorization_claims claims on claims.id=provider_ledger.claim_id and claims.attempt_id=work.attempt_id
    where provider_ledger.admission->>'purpose'='booking-request-release' and provider_ledger.current_outcome='failed'
      and public.payment_provider_recorded_result(provider_ledger)->'retrySafe'='false'::jsonb
    order by operations.operation_generation limit 1;
  if not found or exists (
    select 1 from public.payment_provider_operations provider_ledger
    join public.booking_request_release_operations operations on operations.work_id=work.id
      and provider_ledger.admission#>>'{permit,operationId}'=operations.id::text
      and provider_ledger.admission#>>'{permit,workId}'=work.id::text
      and (provider_ledger.provider,provider_ledger.environment,provider_ledger.merchant_id,provider_ledger.terminal_id,
        provider_ledger.provider_idempotency_key,provider_ledger.request_fingerprint,provider_ledger.payment_lifecycle_id,
        provider_ledger.logical_operation_id,provider_ledger.physical_attempt_id,provider_ledger.amount_fils,provider_ledger.currency)
      is not distinct from (operations.provider,operations.environment,operations.merchant_id,operations.terminal_id,
        operations.provider_idempotency_key,operations.request_fingerprint,operations.payment_lifecycle_id,
        operations.logical_operation_id,operations.physical_attempt_id,operations.amount_fils,operations.currency)
    where provider_ledger.admission->>'purpose'='booking-request-release' and provider_ledger.current_outcome='succeeded'
      and public.payment_provider_recorded_result(provider_ledger)->>'outcome'='succeeded'
  ) then return false; end if;
  select * into operation from public.booking_request_release_operations operations
    where operations.id=(ledger.admission#>>'{permit,operationId}')::uuid for update;
  if operation.id=work.active_operation_id and operation.state in ('executing','reconcile_required') then
    update public.booking_request_release_operations set state='reconcile_required',provider_outcome='failed',retry_safe=false,
      provider_request_id=ledger.provider_request_id,provider_reference=ledger.provider_reference,movement_reference=null,
      result_recorded_at=ledger.recorded_at,updated_at=quarantined_time where id=operation.id;
    update public.booking_request_submission_attempts set payment_snapshot=jsonb_set(payment_snapshot,'{release}',
      (payment_snapshot->'release')||jsonb_build_object('status','failed','retrySafe',false,'reconciliationRequired',false,
        'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,'movementReference',null))
      where id=work.attempt_id and payment_snapshot#>>'{release,attemptId}'=operation.physical_attempt_id
        and payment_snapshot#>>'{release,logicalOperationId}'=operation.logical_operation_id;
  end if;
  update public.booking_request_submission_attempts set state='reconciliation_required',updated_at=quarantined_time where id=work.attempt_id;
  update public.booking_request_release_work set state='quarantined',quarantined_at=quarantined_time,
    quarantine_reason='failed-release-observation',lease_token=null,lease_expires_at=null where id=work.id;
  return true;
end;
$function$;

REVOKE ALL ON FUNCTION public.quarantine_booking_request_release_work(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.record_booking_request_provider_operation_observation (
  target_operation_id uuid,
  target_result       jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare ledger public.payment_provider_operations;
declare result jsonb;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-request-authorization','booking-request-submission-cleanup','booking-request-release']);
  if ledger.admission->>'purpose' = 'booking-request-release'
    and target_result->>'outcome' = 'failed' and target_result->'retrySafe' = 'false'::jsonb then
    raise exception 'Ordinary release refusal requires an explicit quarantine consequence' using errcode = 'RC409';
  end if;
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  if ledger.admission->>'purpose'='booking-request-release' and ledger.current_outcome='not-executed' then
    update public.booking_request_release_operations operations set state='retryable',provider_outcome='not_executed',retry_safe=true,
      result_recorded_at=clock_timestamp(),updated_at=clock_timestamp()
      where operations.id=(ledger.admission#>>'{permit,operationId}')::uuid
        and operations.state in ('executing','reconcile_required');
  end if;
  result:=public.payment_provider_recorded_result(ledger);
  if ledger.current_outcome='failed' and ledger.admission->>'purpose'<>'booking-request-release' then
    result:=result||jsonb_build_object('retrySafe',ledger.operation_kind='release');
  end if;
  return result;
end;
$function$;

CREATE FUNCTION public.record_booking_request_release_observation (
  target_operation_id       uuid,
  target_result             jsonb,
  target_quarantine_release boolean
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare ledger public.payment_provider_operations;
declare unsafe_release boolean;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-request-release']);
  perform public.validate_payment_provider_observation(target_result,ledger.id);
  unsafe_release:=target_result->>'outcome'='failed' and target_result->'retrySafe'='false'::jsonb;
  if target_quarantine_release is null or target_quarantine_release is distinct from coalesce(unsafe_release,false) then
    raise exception 'Ordinary release consequence contradicts provider evidence' using errcode='RC409';
  end if;
  if not exists (
    select 1 from public.booking_request_release_operations operations
    join public.booking_request_release_work work on work.id=operations.work_id and work.attempt_id=operations.attempt_id
    join public.booking_request_authorization_claims claims on claims.attempt_id=work.attempt_id and claims.id=ledger.claim_id
    where operations.id=(ledger.admission#>>'{permit,operationId}')::uuid and work.id=(ledger.admission#>>'{permit,workId}')::uuid
      and (ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,ledger.provider_idempotency_key,
        ledger.request_fingerprint,ledger.payment_lifecycle_id,ledger.logical_operation_id,ledger.physical_attempt_id,ledger.amount_fils,ledger.currency)
      is not distinct from (operations.provider,operations.environment,operations.merchant_id,operations.terminal_id,operations.provider_idempotency_key,
        operations.request_fingerprint,operations.payment_lifecycle_id,operations.logical_operation_id,operations.physical_attempt_id,operations.amount_fils,operations.currency)
  ) then raise exception 'Ordinary release observation binding is invalid' using errcode='RC409'; end if;
  if not target_quarantine_release then
    return public.record_booking_request_provider_operation_observation(ledger.id,target_result);
  end if;
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  perform public.quarantine_booking_request_release_work((ledger.admission#>>'{permit,workId}')::uuid);
  return public.payment_provider_recorded_result(ledger);
end;
$function$;

REVOKE ALL ON FUNCTION public.record_booking_request_release_observation(uuid, jsonb, boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_booking_request_release_observation(uuid, jsonb, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.reload_booking_request_payment_operation (
  target_operation           jsonb,
  target_provider_request_id text,
  target_provider_reference  text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare ledger public.payment_provider_operations;
declare expected jsonb;
declare release_operation public.booking_request_release_operations;
declare work public.booking_request_release_work;
declare attempt public.booking_request_submission_attempts;
declare claim public.booking_request_authorization_claims;
declare cutoff timestamptz;
declare release_ids uuid[];
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Payment inquiry unavailable' using errcode='42501'; end if;
  select * into ledger from public.payment_provider_operations operations where
    (operations.provider,operations.environment,operations.merchant_id,operations.terminal_id,operations.payment_lifecycle_id::text,operations.logical_operation_id,operations.physical_attempt_id,operations.operation_kind)=
    (target_operation#>>'{providerIdentity,provider}',target_operation#>>'{providerIdentity,environment}',target_operation#>>'{providerIdentity,merchantId}',target_operation#>>'{providerIdentity,terminalId}',
      target_operation->>'paymentLifecycleId',target_operation->>'logicalOperationId',target_operation->>'physicalAttemptId',target_operation->>'operationKind');
  if ledger.id is null and target_operation->>'operationKind'='release'
    and target_provider_request_id is null and target_provider_reference is null then
    -- A crashed caller may have persisted its business intent before shared admission.
    -- Reconstruct only that exact relinquished intent, with no executable window.
    select array_agg(operations.id) into release_ids from public.booking_request_release_operations operations where
      (operations.provider,operations.environment,operations.merchant_id,operations.terminal_id,operations.payment_lifecycle_id::text,operations.logical_operation_id,operations.physical_attempt_id)=
      (target_operation#>>'{providerIdentity,provider}',target_operation#>>'{providerIdentity,environment}',target_operation#>>'{providerIdentity,merchantId}',target_operation#>>'{providerIdentity,terminalId}',
        target_operation->>'paymentLifecycleId',target_operation->>'logicalOperationId',target_operation->>'physicalAttemptId');
    if cardinality(release_ids)>1 then raise exception 'Payment inquiry release identity is ambiguous' using errcode='RC409'; end if;
    if cardinality(release_ids)=1 then
      select * into release_operation from public.booking_request_release_operations operations where operations.id=release_ids[1];
      select * into work from public.booking_request_release_work release_work where release_work.id=release_operation.work_id for update;
      select * into attempt from public.booking_request_submission_attempts attempts where attempts.id=work.attempt_id for update;
      select * into claim from public.booking_request_authorization_claims claims where claims.attempt_id=attempt.id for update;
      select * into release_operation from public.booking_request_release_operations operations where operations.id=release_operation.id for update;
      -- Ordinary admission may have won while this reader waited for source locks.
      select * into ledger from public.payment_provider_operations operations where
        (operations.provider,operations.environment,operations.merchant_id,operations.terminal_id,operations.provider_idempotency_key)=
        (release_operation.provider,release_operation.environment,release_operation.merchant_id,release_operation.terminal_id,release_operation.provider_idempotency_key) for update;
      if ledger.id is null then
        if work.id is null or attempt.id is null or claim.id is null or work.state<>'processing'
          or work.active_operation_id is distinct from release_operation.id or release_operation.state<>'reconcile_required'
          or release_operation.provider_outcome<>'unknown' or release_operation.provider_request_id is not null or release_operation.provider_reference is not null
          or release_operation.attempt_id is distinct from attempt.id
          or release_operation.payment_lifecycle_id is distinct from attempt.payment_lifecycle_id
          or release_operation.payment_lifecycle_id is distinct from claim.payment_lifecycle_id
          or (release_operation.amount_fils,release_operation.currency,release_operation.provider,release_operation.environment,release_operation.merchant_id,release_operation.terminal_id)
            is distinct from (claim.amount_fils,claim.currency,claim.provider,claim.environment,claim.merchant_id,claim.terminal_id)
          or release_operation.amount_fils is distinct from (target_operation->>'amountFils')::bigint
          or release_operation.currency is distinct from target_operation->>'currency'
          or release_operation.request_fingerprint is distinct from public.booking_request_release_fingerprint(release_operation.provider,release_operation.environment,
            release_operation.merchant_id,release_operation.terminal_id,release_operation.payment_lifecycle_id,release_operation.logical_operation_id,
            release_operation.physical_attempt_id,release_operation.amount_fils,release_operation.currency)
          or release_operation.provider_idempotency_key is distinct from 'booking-request-release:'||work.id::text||':'||release_operation.operation_generation::text
          or attempt.payment_snapshot#>>'{authorization,status}' is distinct from 'succeeded' or attempt.payment_snapshot->'capture' is distinct from 'null'::jsonb then
          raise exception 'Payment inquiry does not match a relinquished release intent' using errcode='RC409'; end if;
        cutoff:=date_trunc('milliseconds',clock_timestamp());
        insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
          provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,admission,evidence_provenance)
        values(gen_random_uuid(),claim.id,claim.generation,'release',release_operation.provider,release_operation.environment,release_operation.merchant_id,release_operation.terminal_id,
          release_operation.provider_idempotency_key,release_operation.request_fingerprint,release_operation.payment_lifecycle_id,release_operation.logical_operation_id,
          release_operation.physical_attempt_id,release_operation.amount_fils,release_operation.currency,
          jsonb_build_object('purpose','booking-request-release','reconciliationOnly',true,'permit',jsonb_build_object('workId',work.id,'operationId',release_operation.id),
            'notBefore',null,'notAfter',cutoff),'admitted') returning * into ledger;
      end if;
    end if;
  end if;
  if ledger.id is null or (target_provider_request_id is null)<>(target_provider_reference is null)
    or (target_provider_request_id is not null and (ledger.provider_request_id,ledger.provider_reference) is distinct from (target_provider_request_id,target_provider_reference))
    or (target_operation->>'requestFingerprint' is not null and target_operation->>'requestFingerprint' is distinct from ledger.request_fingerprint)
    or (target_operation->>'requestFingerprint' is null and ledger.operation_kind not in ('release','refund'))
    or (ledger.admission->>'purpose'='booking-request-capture' and (
      ledger.admission->'permit' is distinct from ledger.capture_execution_permit
      or coalesce((ledger.capture_execution_permit->>'leaseGeneration')::bigint,0)<1
      or ledger.capture_execution_permit->>'leaseToken' is null))
    or ledger.amount_fils is distinct from (target_operation->>'amountFils')::bigint or ledger.currency is distinct from target_operation->>'currency' then
    raise exception 'Payment inquiry does not match an admitted operation' using errcode='RC409'; end if;
  expected:=jsonb_build_object('providerIdentity',(public.payment_operation_admission(ledger))->'providerIdentity',
    'requestFingerprint',target_operation->'requestFingerprint','paymentLifecycleId',ledger.payment_lifecycle_id,
    'logicalOperationId',ledger.logical_operation_id,'physicalAttemptId',ledger.physical_attempt_id,
    'operationKind',ledger.operation_kind,'amountFils',ledger.amount_fils,'currency',ledger.currency);
  if expected is distinct from target_operation then raise exception 'Payment inquiry binding is invalid' using errcode='RC409'; end if;
  if ledger.admission->>'purpose' in ('booking-request-payment-recovery','booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund')
    and public.booking_request_payment_quarantined((ledger.admission#>>'{permit,binding,bookingRequestId}')::uuid) then
    return jsonb_build_object('status','not-admitted');
  end if;
  if ledger.admission->>'purpose' = 'booking-request-release' and exists (
    select 1 from public.booking_request_release_work release_work
    where release_work.id = (ledger.admission#>>'{permit,workId}')::uuid
      and release_work.state = 'quarantined') then
    return jsonb_build_object('status','not-admitted');
  end if;
  return public.payment_operation_admission(ledger);
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_booking_request_release_snapshot (
  target_work_id           uuid,
  target_lease_generation  bigint,
  target_lease_token       uuid,
  target_payment_snapshot  jsonb,
  target_provider_identity jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare work public.booking_request_release_work;
declare attempt public.booking_request_submission_attempts;
declare claim public.booking_request_authorization_claims;
declare operation public.booking_request_release_operations;
declare provider_operation public.payment_provider_operations;
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
    or jsonb_typeof(next_release -> 'retrySafe') is distinct from 'boolean' then
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
  if work.state = 'quarantined' then
    if target_payment_snapshot is not distinct from attempt.payment_snapshot
      and target_provider_identity is not distinct from jsonb_build_object(
        'provider', attempt.authorization_provider, 'environment', attempt.authorization_environment,
        'merchantId', attempt.authorization_merchant_id, 'terminalId', attempt.authorization_terminal_id) then
      return null;
    end if;
    raise exception 'Quarantined Booking Request release evidence cannot change' using errcode = 'RC409';
  end if;
  if public.quarantine_booking_request_release_work(work.id) then
    raise exception 'Unsafe Booking Request release cannot be retried' using errcode = 'RC409';
  end if;
  if work.state <> 'processing'
    or work.lease_token is null or work.lease_expires_at is null
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
    from public.payment_provider_operations provider_operations
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
    and provider_operation.current_outcome='not-executed'
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
    and public.payment_provider_recorded_result(provider_operation) -> 'retrySafe' = 'true'::jsonb
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
        and provider_operation.current_outcome is null
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
$function$;

ALTER TABLE public.booking_request_release_work
  ADD CONSTRAINT booking_request_release_work_state_check CHECK (state = ANY (ARRAY['processing'::text, 'quarantined'::text, 'complete'::text]));

ALTER TABLE public.booking_request_release_work
  ADD COLUMN quarantined_at timestamp with time zone;

ALTER TABLE public.booking_request_release_work
  ADD COLUMN quarantine_reason text;

ALTER TABLE public.booking_request_release_work
  ADD CONSTRAINT booking_request_release_quarantine_shape CHECK (state = 'quarantined'::text AND quarantined_at IS NOT NULL AND quarantine_reason IS
    NOT NULL AND quarantine_reason = 'failed-release-observation'::text AND completed_at IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL OR state <>
    'quarantined'::text AND quarantined_at IS NULL AND quarantine_reason IS NULL);