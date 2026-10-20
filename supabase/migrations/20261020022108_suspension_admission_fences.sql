-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.admit_booking_request_provider_operation (
  target_operation jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare provider_identity jsonb := target_operation -> 'providerIdentity';
declare permit_purpose text := target_operation ->> 'permitPurpose';
declare claim public.booking_request_authorization_claims;
declare attempt public.booking_request_submission_attempts;
declare customer_context public.account_contexts;
declare current_profile public.owner_application_cottage_profiles;
declare owner_revision bigint;
declare work public.booking_request_release_work;
declare release_operation public.booking_request_release_operations;
declare operation_id uuid := gen_random_uuid();
declare effective_idempotency_key text;
declare expected_fingerprint text;
declare expected_not_after timestamptz;
declare stored public.payment_provider_operations;
begin
  if current_setting('role', true) <> 'service_role'
    or target_operation is null
    or coalesce(jsonb_typeof(target_operation), '') <> 'object' then
    raise exception 'Payment admission operation is invalid' using errcode = '22023';
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
    or coalesce(btrim(provider_identity ->> 'environment'),'') = ''
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
    raise exception 'Payment admission operation is invalid' using errcode = '22023';
  end if;

  if permit_purpose = 'booking-request-submission-cleanup' then
    if target_operation -> 'cleanupAttemptId' = 'null'::jsonb
      or target_operation -> 'claimId' = 'null'::jsonb
      or target_operation -> 'claimGeneration' = 'null'::jsonb
      or target_operation -> 'stateRevision' = 'null'::jsonb then
      raise exception 'Payment admission operation is invalid' using errcode = '22023';
    end if;
    if target_operation ->> 'operationKind' is distinct from 'release'
      or target_operation -> 'workId' is distinct from 'null'::jsonb
      or target_operation -> 'leaseGeneration' is distinct from 'null'::jsonb
      or target_operation -> 'leaseToken' is distinct from 'null'::jsonb
      or target_operation -> 'operationId' is distinct from 'null'::jsonb
      or target_operation -> 'operationGeneration' is distinct from 'null'::jsonb then
      raise exception 'Payment cleanup permit has foreign-purpose fields'
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
      raise exception 'Payment cleanup permit is invalid or expired'
        using errcode = 'RC409';
    end if;
  elsif permit_purpose = 'booking-request-release' then
    if target_operation -> 'workId' = 'null'::jsonb
      or target_operation -> 'leaseGeneration' = 'null'::jsonb
      or target_operation -> 'leaseToken' = 'null'::jsonb
      or target_operation -> 'operationId' = 'null'::jsonb
      or target_operation -> 'operationGeneration' = 'null'::jsonb then
      raise exception 'Payment admission operation is invalid' using errcode = '22023';
    end if;
    if target_operation ->> 'operationKind' is distinct from 'release'
      or target_operation -> 'claimId' is distinct from 'null'::jsonb
      or target_operation -> 'claimGeneration' is distinct from 'null'::jsonb
      or target_operation -> 'stateRevision' is distinct from 'null'::jsonb
      or target_operation -> 'cleanupAttemptId' is distinct from 'null'::jsonb then
      raise exception 'Payment lifecycle permit has foreign-purpose fields'
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
      raise exception 'Payment lifecycle release permit is invalid or expired'
        using errcode = 'RC409';
    end if;
  elsif permit_purpose = 'booking-request-authorization' then
    if target_operation -> 'claimId' = 'null'::jsonb
      or target_operation -> 'claimGeneration' = 'null'::jsonb then
      raise exception 'Payment admission operation is invalid' using errcode = '22023';
    end if;
    if target_operation ->> 'operationKind' is distinct from 'authorization'
      or target_operation -> 'stateRevision' is distinct from 'null'::jsonb
      or target_operation -> 'cleanupAttemptId' is distinct from 'null'::jsonb
      or target_operation -> 'workId' is distinct from 'null'::jsonb
      or target_operation -> 'leaseGeneration' is distinct from 'null'::jsonb
      or target_operation -> 'leaseToken' is distinct from 'null'::jsonb
      or target_operation -> 'operationId' is distinct from 'null'::jsonb
      or target_operation -> 'operationGeneration' is distinct from 'null'::jsonb then
      raise exception 'Payment authorization permit has foreign-purpose fields'
        using errcode = 'RC409';
    end if;
    select * into attempt
    from public.booking_request_submission_attempts attempts
    where attempts.id = (
      select claims.attempt_id from public.booking_request_authorization_claims claims
      where claims.id = (target_operation ->> 'claimId')::uuid
    ) for update;
    select * into claim from public.booking_request_authorization_claims claims
    where claims.id = (target_operation ->> 'claimId')::uuid
      and claims.attempt_id = attempt.id for update;
    select * into customer_context from public.account_contexts contexts
    where contexts.user_id = attempt.customer_user_id for update;
    select * into current_profile from public.owner_application_cottage_profiles profiles
    where profiles.id = attempt.profile_id for update;
    select contexts.owner_suspension_revision into owner_revision
    from public.account_contexts contexts
    where contexts.user_id = current_profile.owner_user_id;
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
      raise exception 'Payment authorization permit is invalid or expired'
        using errcode = 'RC409';
    end if;
    if not exists (
      select 1 from public.payment_provider_operations operations
      where operations.provider = claim.provider
        and operations.environment = claim.environment
        and operations.merchant_id = claim.merchant_id
        and operations.terminal_id = claim.terminal_id
        and operations.provider_idempotency_key = effective_idempotency_key
    ) and (
      customer_context.customer_suspended
      or current_profile.business_suspended
      or attempt.customer_suspension_revision
        is distinct from customer_context.customer_suspension_revision
      or attempt.owner_suspension_revision is distinct from owner_revision
      or attempt.cottage_suspension_revision
        is distinct from current_profile.suspension_revision
    ) then
      raise exception 'Payment authorization eligibility changed'
        using errcode = 'RC409';
    end if;
  else
    raise exception 'Payment admission permit purpose is invalid'
      using errcode = 'RC409';
  end if;

  insert into public.payment_provider_operations (
    id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,admission,evidence_provenance
  ) values(operation_id,claim.id,claim.generation,target_operation->>'operationKind',
    claim.provider,claim.environment,claim.merchant_id,claim.terminal_id,effective_idempotency_key,target_operation->>'requestFingerprint',
    claim.payment_lifecycle_id,target_operation->>'logicalOperationId',target_operation->>'physicalAttemptId',claim.amount_fils,claim.currency,
    jsonb_build_object('purpose',permit_purpose,'permit',target_operation,'notBefore',null,'notAfter',target_operation->>'notAfter'),'admitted')
  on conflict(provider,environment,merchant_id,terminal_id,provider_idempotency_key) do nothing;

  select * into stored
  from public.payment_provider_operations operations
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
    raise exception 'Payment admission idempotency binding changed'
      using errcode = 'RC409';
  end if;
  return public.payment_operation_admission(stored,stored.id=operation_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.begin_booking_request_authorization_claim (
  target_attempt_id        uuid,
  target_payment_snapshot  jsonb,
  target_provider_identity jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare attempt public.booking_request_submission_attempts;
declare existing_claim public.booking_request_authorization_claims;
declare customer_context public.account_contexts;
declare current_profile public.owner_application_cottage_profiles;
declare owner_revision bigint;
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
  end if;

  select * into customer_context
  from public.account_contexts contexts
  where contexts.user_id = attempt.customer_user_id
  for update;
  select * into current_profile
  from public.owner_application_cottage_profiles profiles
  where profiles.id = attempt.profile_id
  for update;
  target_schedule_revision_id := current_profile.current_shift_schedule_id;
  select contexts.owner_suspension_revision into owner_revision
  from public.account_contexts contexts
  where contexts.user_id = current_profile.owner_user_id;
  if customer_context.customer_suspended then
    return jsonb_build_object('status', 'customer-suspended');
  end if;
  if target_schedule_revision_id is null
    or customer_context.customer_suspension_revision is null
    or customer_context.customer_suspension_revision < 0
    or owner_revision is null or owner_revision < 0
    or current_profile.suspension_revision is null
    or current_profile.suspension_revision < 0
    or attempt.customer_suspension_revision is null
    or attempt.customer_suspension_revision < 0
    or attempt.owner_suspension_revision is null
    or attempt.owner_suspension_revision < 0
    or attempt.cottage_suspension_revision is null
    or attempt.cottage_suspension_revision < 0 then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if current_profile.business_suspended
    or attempt.customer_suspension_revision
      is distinct from customer_context.customer_suspension_revision
    or attempt.owner_suspension_revision is distinct from owner_revision
    or attempt.cottage_suspension_revision
      is distinct from current_profile.suspension_revision then
    return jsonb_build_object('status', 'quote-stale');
  end if;

  if existing_claim.id is not null then
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

  if attempt.payment_snapshot is not null
    or attempt.state <> 'authorizing' then
    return jsonb_build_object('status', 'invalid');
  end if;

  policy_evaluated_at := clock_timestamp();
  current_quote := public.resolve_booking_quote_with_fingerprint(
    attempt.locale, attempt.public_slug, attempt.requested_search, false
  );
  if current_quote ->> 'status' <> 'quoted'
    or current_quote ->> 'quoteFingerprint' <> attempt.quote_fingerprint
    or current_quote - 'status' <> attempt.quote_payload then
    perform public.retire_unusable_prepared_booking_request_submission(attempt.id);
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
          or (target_unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
            and target_end_time = target_start_time)
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
$function$;

CREATE OR REPLACE FUNCTION public.finalize_booking_request_submission (
  target_attempt_id       uuid,
  target_payment_snapshot jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare attempt public.booking_request_submission_attempts;
declare customer_context public.account_contexts;
declare current_profile public.owner_application_cottage_profiles;
declare owner_revision bigint;
declare current_quote jsonb;
declare first_starts_at timestamptz;
declare owner_user_id uuid;
declare request_id uuid := gen_random_uuid();
declare snapshot_id uuid := gen_random_uuid();
declare request_reference text;
declare hold jsonb;
declare submission_created_at timestamptz;
declare response_deadline timestamptz;
declare authorization_operation jsonb;
declare policy jsonb;
declare expected_acceptance_evidence jsonb;
declare authorization_claim public.booking_request_authorization_claims;
declare authorization_claim_found boolean;
begin
  select * into attempt
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id
  for update;
  if not found then
    raise exception 'Booking Request submission attempt was not found'
      using errcode = 'RC404';
  end if;
  if attempt.state = 'finalized' then
    return public.lookup_booking_request_submission(target_attempt_id);
  end if;
  authorization_operation := target_payment_snapshot -> 'authorization';
  select * into authorization_claim
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = attempt.id
  for update;
  authorization_claim_found := found;
  select * into customer_context
  from public.account_contexts contexts
  where contexts.user_id = attempt.customer_user_id
  for update;
  select * into current_profile
  from public.owner_application_cottage_profiles profiles
  where profiles.id = attempt.profile_id
  for update;
  owner_user_id := current_profile.owner_user_id;
  if owner_user_id is null then
    raise exception 'Published Cottage was not found' using errcode = 'RC404';
  end if;
  select contexts.owner_suspension_revision into owner_revision
  from public.account_contexts contexts
  where contexts.user_id = current_profile.owner_user_id;
  if customer_context.customer_suspended
    or current_profile.business_suspended
    or attempt.customer_suspension_revision
      is distinct from customer_context.customer_suspension_revision
    or attempt.owner_suspension_revision is distinct from owner_revision
    or attempt.cottage_suspension_revision
      is distinct from current_profile.suspension_revision then
    raise exception 'Booking Request submission eligibility changed'
      using errcode = 'RC409';
  end if;
  perform public.save_booking_request_payment_snapshot(
    target_attempt_id,
    target_payment_snapshot,
    jsonb_build_object(
      'provider', attempt.authorization_provider,
      'environment', attempt.authorization_environment,
      'merchantId', attempt.authorization_merchant_id,
      'terminalId', attempt.authorization_terminal_id
    )
  );
  select * into attempt
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id;
  if attempt.state <> 'authorized'
    or attempt.payment_snapshot <> target_payment_snapshot
    or authorization_operation ->> 'status' <> 'succeeded'
    or (authorization_operation ->> 'amountFils')::bigint
      <> (attempt.quote_payload ->> 'customerTotalIqd')::bigint * 1000
    or target_payment_snapshot ->> 'capture' is not null
    or target_payment_snapshot ->> 'release' is not null
    or attempt.authorization_provider_request_id is null
    or attempt.authorization_provider_reference is null
    or attempt.authorization_movement_reference is null then
    raise exception 'Successful exact Payment Authorization is required'
      using errcode = 'RC402';
  end if;

  if not authorization_claim_found
    or authorization_claim.state <> 'authorized'
    or authorization_claim.payment_lifecycle_id <> attempt.payment_lifecycle_id
    or authorization_claim.logical_operation_id
      <> authorization_operation ->> 'logicalOperationId'
    or authorization_claim.physical_attempt_id
      <> authorization_operation ->> 'attemptId'
    or authorization_claim.amount_fils
      <> (authorization_operation ->> 'amountFils')::bigint
    or authorization_claim.currency <> 'IQD'
    or authorization_claim.provider <> attempt.authorization_provider
    or authorization_claim.environment <> attempt.authorization_environment
    or authorization_claim.merchant_id <> attempt.authorization_merchant_id
    or authorization_claim.terminal_id <> attempt.authorization_terminal_id
    or authorization_claim.quote_fingerprint <> attempt.quote_fingerprint
    or authorization_claim.intent_fingerprint <> attempt.intent_fingerprint then
    raise exception 'Authorization Claim does not match the Payment evidence'
      using errcode = 'RC409';
  end if;

  update public.booking_request_authorization_claims
  set state = 'converted', state_revision = state_revision + 1,
    updated_at = clock_timestamp()
  where id = authorization_claim.id;
  update public.booking_request_authorization_claim_occupancies
  set active = false
  where claim_id = authorization_claim.id and active;
  update public.booking_request_authorization_reconciliation_outbox
  set state = 'complete',
    observed_state_revision = authorization_claim.state_revision + 1,
    lease_token = null,
    lease_expires_at = null,
    updated_at = clock_timestamp()
  where claim_id = authorization_claim.id;

  current_quote := public.resolve_booking_quote_with_fingerprint(
    attempt.locale, attempt.public_slug, attempt.requested_search, false
  );
  if current_quote ->> 'status' <> 'quoted'
    or current_quote ->> 'quoteFingerprint' <> attempt.quote_fingerprint
    or current_quote - 'status' <> attempt.quote_payload then
    raise exception 'Booking Quote changed before finalization'
      using errcode = 'RC409';
  end if;
  first_starts_at := (current_quote -> 'items' -> 0 ->> 'startsAt')::timestamptz;
  request_reference := 'RC-REQ-' || upper(substr(replace(request_id::text, '-', ''), 1, 16));
  hold := public.create_pending_booking_period_hold(
    attempt.customer_user_id,
    attempt.profile_id,
    request_reference,
    attempt.requested_search
  );
  if (hold ->> 'bookingPriceIqd')::bigint
    <> (current_quote ->> 'bookingPriceIqd')::bigint then
    raise exception 'Pending Hold price does not match the Booking Quote'
      using errcode = 'RC409';
  end if;
  submission_created_at := clock_timestamp();
  policy := public.booking_request_policy_at(
    first_starts_at, submission_created_at
  );
  if (policy ->> 'insideCutoff')::boolean then
    raise exception 'Booking Request Cut-Off has passed'
      using errcode = 'RC409';
  end if;
  expected_acceptance_evidence := public.booking_request_acceptance_evidence(
    attempt.locale,
    (policy ->> 'requiresInside48HourNoRefundAcceptance')::boolean
  );
  if attempt.intent_payload -> 'acceptanceEvidence'
      is distinct from expected_acceptance_evidence
    or encode(
      extensions.digest(convert_to(attempt.intent_payload::text, 'UTF8'), 'sha256'),
      'hex'
    ) <> attempt.intent_fingerprint then
    raise exception 'Booking acceptance evidence changed before finalization'
      using errcode = 'RC409';
  end if;
  if (policy ->> 'requiresInside48HourNoRefundAcceptance')::boolean
    and (attempt.intent_payload ->> 'acceptedInside48HourNoRefund')::boolean
      is not true then
    raise exception 'Inside-48-hour acceptance is required'
      using errcode = 'RC409';
  end if;

  insert into public.booking_snapshots (
    id, customer_user_id, profile_id, quote_fingerprint, intent_fingerprint,
    quote_payload, intent_payload, booking_terms_version,
    booking_terms_locale, booking_terms_body, booking_terms_sha256,
    cancellation_policy_version, acceptance_locale, acceptance_evidence,
    acceptance_evidence_fingerprint,
    marketplace_commission_rate_basis_points,
    marketplace_commission_amount_fils, created_at
  ) values (
    snapshot_id, attempt.customer_user_id, attempt.profile_id,
    attempt.quote_fingerprint, attempt.intent_fingerprint,
    attempt.quote_payload, attempt.intent_payload,
    current_quote ->> 'termsVersion',
    (current_quote -> 'marketplaceTerms' ->> 'locale')::public.cottage_profile_source_language,
    current_quote -> 'marketplaceTerms' ->> 'body',
    current_quote -> 'marketplaceTerms' ->> 'sha256',
    attempt.intent_payload ->> 'cancellationPolicyVersion', attempt.locale,
    attempt.intent_payload -> 'acceptanceEvidence',
    encode(extensions.digest(
      convert_to((attempt.intent_payload -> 'acceptanceEvidence')::text, 'UTF8'),
      'sha256'
    ), 'hex'),
    1000,
    (current_quote ->> 'bookingPriceIqd')::bigint * 100,
    submission_created_at
  );
  response_deadline := submission_created_at + interval '4 hours';
  insert into public.booking_requests (
    id, booking_request_reference, customer_user_id, owner_user_id, profile_id,
    booking_snapshot_id, booking_period_commitment_id, payment_lifecycle_id,
    customer_name, party_size, booking_note, status,
    response_deadline, created_at
  ) values (
    request_id, request_reference, attempt.customer_user_id, owner_user_id,
    attempt.profile_id, snapshot_id,
    (hold ->> 'bookingPeriodCommitmentId')::uuid,
    attempt.payment_lifecycle_id,
    attempt.intent_payload ->> 'customerName',
    (attempt.intent_payload ->> 'partySize')::smallint,
    attempt.intent_payload ->> 'bookingNote',
    'pending', response_deadline, submission_created_at
  );
  insert into public.owner_request_notifications (
    booking_request_id, owner_user_id, created_at
  ) values (request_id, owner_user_id, submission_created_at);
  update public.booking_request_submission_attempts
  set state = 'finalized', booking_request_id = request_id,
    updated_at = submission_created_at
  where id = target_attempt_id;
  if attempt.conversation_id is not null then
    insert into public.messaging_conversation_booking_requests (
      conversation_id, booking_request_id, submission_attempt_id, linked_at
    ) values (
      attempt.conversation_id, request_id, attempt.id, submission_created_at
    );
  end if;

  return jsonb_build_object(
    'status', 'pending',
    'bookingRequestReference', request_reference,
    'responseDeadline', to_char(
      response_deadline at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_booking_request_submission (
  target_customer_user_id uuid,
  target_idempotency_key  uuid,
  target_submission       jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare target_locale public.cottage_profile_source_language;
declare target_slug text;
declare target_search jsonb;
declare target_conversation_id uuid;
declare displayed_fingerprint text;
declare current_quote jsonb;
declare current_profile_id uuid;
declare first_starts_at timestamptz;
declare policy_evaluated_at timestamptz;
declare policy jsonb;
declare expected_acceptance_evidence jsonb;
declare intent jsonb;
declare target_intent_fingerprint text;
declare existing_attempt public.booking_request_submission_attempts;
declare key_attempt public.booking_request_submission_attempts;
declare inserted_attempt public.booking_request_submission_attempts;
declare existing_projection jsonb;
declare target_conversation public.messaging_conversations;
declare locked_attempt_ids uuid[] := '{}'::uuid[];
declare locked_attempt_id uuid;
declare customer_context public.account_contexts;
declare current_profile public.owner_application_cottage_profiles;
declare owner_revision bigint;
begin
  if target_customer_user_id is null
    or target_idempotency_key is null
    or target_submission is null
    or jsonb_typeof(target_submission) <> 'object' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not exists (
    select 1
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    where contexts.user_id = target_customer_user_id
      and contexts.role in ('customer'::public.account_role, 'cottage_owner'::public.account_role)
      and users.phone_confirmed_at is not null
  ) then
    return jsonb_build_object('status', 'access-required');
  end if;

  begin
    target_locale := (target_submission ->> 'locale')::public.cottage_profile_source_language;
    target_slug := target_submission ->> 'publicSlug';
    target_search := target_submission -> 'discoveryQuery';
    displayed_fingerprint := target_submission ->> 'quoteFingerprint';
    intent := target_submission -> 'intent';
    if target_submission ? 'conversationId' then
      target_conversation_id := (target_submission ->> 'conversationId')::uuid;
      if intent ->> 'conversationId' is distinct from target_conversation_id::text then
        return jsonb_build_object('status', 'invalid');
      end if;
    elsif intent ? 'conversationId' then
      return jsonb_build_object('status', 'invalid');
    end if;
    if target_slug is null
      or target_search is null
      or intent is null
      or jsonb_typeof(intent) <> 'object'
      or displayed_fingerprint !~ '^[0-9a-f]{64}$'
      or intent ->> 'customerName' <> btrim(intent ->> 'customerName')
      or char_length(intent ->> 'customerName') not between 2 and 120
      or not public.booking_request_content_is_safe(intent ->> 'customerName')
      or (intent ->> 'partySize')::integer not between 1 and 1000
      or (intent ->> 'partySize')::integer <> (target_search ->> 'guests')::integer
      or (intent ? 'bookingNote' and (
        intent ->> 'bookingNote' is null
        or intent ->> 'bookingNote' <> btrim(intent ->> 'bookingNote')
        or char_length(intent ->> 'bookingNote') not between 1 and 500
        or not public.booking_request_content_is_safe(intent ->> 'bookingNote')
      ))
      or (intent ->> 'acceptedHouseRules')::boolean is not true
      or (intent ->> 'acceptedCancellationPolicy')::boolean is not true
      or (intent ->> 'acceptedMarketplaceTerms')::boolean is not true
      or intent ->> 'cancellationPolicyVersion' <> 'rentcottage-mvp-2026-08-04'
      or jsonb_typeof(intent -> 'acceptanceEvidence') is distinct from 'object' then
      return jsonb_build_object('status', 'invalid');
    end if;
  exception when others then
    return jsonb_build_object('status', 'invalid');
  end;

  if exists (
    select 1 from public.cottage_marketplace_listings listings
    join public.owner_application_cottage_profiles profiles on profiles.id = listings.profile_id
    where listings.public_slug = target_slug and profiles.owner_user_id = target_customer_user_id
  ) then
    return jsonb_build_object('status', 'self-booking-not-allowed');
  end if;

  intent := intent || jsonb_build_object(
    'customerUserId', target_customer_user_id,
    'publicSlug', target_slug,
    'locale', target_locale,
    'discoveryQuery', target_search,
    'quoteFingerprint', displayed_fingerprint,
    'contentVersion', target_submission -> 'contentVersion',
    'termsVersion', target_submission -> 'termsVersion',
    'bookingPriceIqd', target_submission -> 'bookingPriceIqd',
    'serviceFeeIqd', target_submission -> 'serviceFeeIqd',
    'customerTotalIqd', target_submission -> 'customerTotalIqd',
    'firstStartsAt', target_submission -> 'firstStartsAt'
  );
  target_intent_fingerprint := encode(
    extensions.digest(convert_to(intent::text, 'UTF8'), 'sha256'),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_customer_user_id::text || ':' || target_intent_fingerprint, 0
    )
  );

  for locked_attempt_id in
    select attempts.id
    from public.booking_request_submission_attempts attempts
    where attempts.customer_user_id = target_customer_user_id
      and (
        attempts.idempotency_key = target_idempotency_key
        or (attempts.intent_fingerprint = target_intent_fingerprint
          and attempts.intent_dedupe_active)
        or (attempts.conversation_id = target_conversation_id
          and attempts.state = 'authorizing' and attempts.payment_snapshot is null)
      )
    order by attempts.id
    for update
  loop
    locked_attempt_ids := array_append(locked_attempt_ids, locked_attempt_id);
  end loop;

  select * into key_attempt
  from public.booking_request_submission_attempts attempts
  where attempts.customer_user_id = target_customer_user_id
    and attempts.idempotency_key = target_idempotency_key;
  if found and (
    key_attempt.intent_fingerprint <> target_intent_fingerprint
    or key_attempt.intent_payload <> intent
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if key_attempt.id is not null then
    existing_projection := public.project_existing_booking_request_submission_attempt(
      key_attempt, target_intent_fingerprint, intent, false
    );
    if existing_projection ->> 'status' <> 'continue' then
      return existing_projection;
    end if;
  end if;

  select * into existing_attempt
  from public.booking_request_submission_attempts attempts
  where attempts.customer_user_id = target_customer_user_id
    and attempts.intent_fingerprint = target_intent_fingerprint
    and attempts.intent_dedupe_active;
  if found then
    existing_projection := public.project_existing_booking_request_submission_attempt(
      existing_attempt, target_intent_fingerprint, intent, false
    );
    if existing_projection ->> 'status' <> 'continue' then
      return existing_projection;
    end if;
  end if;

  select * into customer_context
  from public.account_contexts contexts
  where contexts.user_id = target_customer_user_id
  for no key update;

  select profiles.id into current_profile_id
  from public.cottage_marketplace_listings listings
  join public.owner_application_cottage_profiles profiles
    on profiles.id = listings.profile_id
  where listings.public_slug = target_slug
  for update of profiles;
  if current_profile_id is null then
    perform public.retire_unusable_prepared_booking_request_submission(existing_attempt.id);
    return jsonb_build_object('status', 'quote-stale');
  end if;
  select * into current_profile from public.owner_application_cottage_profiles
  where id = current_profile_id;
  select contexts.owner_suspension_revision into owner_revision
  from public.account_contexts contexts where contexts.user_id = current_profile.owner_user_id;
  if customer_context.customer_suspended then
    return jsonb_build_object('status', 'customer-suspended');
  end if;
  if customer_context.customer_suspension_revision is null
    or customer_context.customer_suspension_revision < 0
    or owner_revision is null or owner_revision < 0
    or current_profile.suspension_revision is null or current_profile.suspension_revision < 0 then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if current_profile.business_suspended
    or (existing_attempt.id is not null and (
      existing_attempt.customer_suspension_revision is distinct from customer_context.customer_suspension_revision
      or existing_attempt.owner_suspension_revision is distinct from owner_revision
      or existing_attempt.cottage_suspension_revision is distinct from current_profile.suspension_revision
    )) then
    return jsonb_build_object('status', 'quote-stale');
  end if;
  if target_conversation_id is not null then
    select * into target_conversation
    from public.messaging_conversations conversations
    where conversations.id = target_conversation_id
    for update of conversations;
    if target_conversation.id is null
      or target_conversation.customer_user_id <> target_customer_user_id
      or target_conversation.profile_id <> current_profile_id
      or target_conversation.owner_user_id is distinct from (
        select profiles.owner_user_id
        from public.owner_application_cottage_profiles profiles
        where profiles.id = current_profile_id
      ) then
      return jsonb_build_object('status', 'invalid');
    end if;
    if exists (
      select 1
      from public.messaging_conversation_booking_requests links
      join public.booking_confirmations confirmations
        on confirmations.booking_request_id = links.booking_request_id
      where links.conversation_id = target_conversation_id
    ) then
      return jsonb_build_object('status', 'invalid');
    end if;
    for locked_attempt_id in
      select attempts.id
      from public.booking_request_submission_attempts attempts
      where attempts.id = any(locked_attempt_ids)
        and attempts.conversation_id = target_conversation_id
        and attempts.id is distinct from key_attempt.id
        and attempts.id is distinct from existing_attempt.id
        and attempts.state = 'authorizing' and attempts.payment_snapshot is null
      order by attempts.id
    loop
      perform public.retire_unusable_prepared_booking_request_submission(locked_attempt_id);
    end loop;
    if exists (
      select 1
      from public.booking_request_submission_attempts attempts
      where attempts.conversation_id = target_conversation_id
        and attempts.id is distinct from key_attempt.id
        and attempts.id is distinct from existing_attempt.id
        and not public.messaging_submission_attempt_is_resolved(attempts.id)
    ) then
      return jsonb_build_object('status', 'invalid');
    end if;
  end if;
  policy_evaluated_at := clock_timestamp();

  current_quote := public.get_public_booking_quote_with_fingerprint(
    target_locale, target_slug, target_search
  );
  if current_quote ->> 'status' <> 'quoted'
    or current_quote ->> 'quoteFingerprint' <> displayed_fingerprint
    or (current_quote ->> 'contentVersion')::integer
      <> (target_submission ->> 'contentVersion')::integer
    or current_quote ->> 'termsVersion' <> target_submission ->> 'termsVersion'
    or (current_quote ->> 'bookingPriceIqd')::bigint
      <> (target_submission ->> 'bookingPriceIqd')::bigint
    or (current_quote ->> 'serviceFeeIqd')::bigint
      <> (target_submission ->> 'serviceFeeIqd')::bigint
    or (current_quote ->> 'customerTotalIqd')::bigint
      <> (target_submission ->> 'customerTotalIqd')::bigint
    or current_quote -> 'items' -> 0 ->> 'startsAt'
      <> target_submission ->> 'firstStartsAt' then
    perform public.retire_unusable_prepared_booking_request_submission(existing_attempt.id);
    return jsonb_build_object('status', 'quote-stale');
  end if;
  first_starts_at := (current_quote -> 'items' -> 0 ->> 'startsAt')::timestamptz;
  policy := public.booking_request_policy_at(
    first_starts_at, policy_evaluated_at
  );
  if (policy ->> 'insideCutoff')::boolean then
    return jsonb_build_object('status', 'too-late');
  end if;
  expected_acceptance_evidence := public.booking_request_acceptance_evidence(
    target_locale,
    (policy ->> 'requiresInside48HourNoRefundAcceptance')::boolean
  );
  if intent -> 'acceptanceEvidence' is distinct from expected_acceptance_evidence then
    return jsonb_build_object('status', 'invalid');
  end if;
  if (policy ->> 'requiresInside48HourNoRefundAcceptance')::boolean
    and (intent ->> 'acceptedInside48HourNoRefund')::boolean is not true then
    return jsonb_build_object('status', 'invalid');
  end if;

  if existing_attempt.id is not null then
    if existing_attempt.profile_id <> current_profile_id
      or existing_attempt.quote_payload <> current_quote - 'status' then
      perform public.retire_unusable_prepared_booking_request_submission(existing_attempt.id);
      return jsonb_build_object('status', 'quote-stale');
    end if;
    return public.project_existing_booking_request_submission_attempt(
      existing_attempt, target_intent_fingerprint, intent, true
    );
  end if;

  insert into public.booking_request_submission_attempts (
    customer_user_id, idempotency_key, payment_lifecycle_id,
    profile_id, conversation_id, locale, public_slug, requested_search,
    quote_fingerprint, quote_payload, intent_fingerprint, intent_payload,
    state, customer_suspension_revision, owner_suspension_revision, cottage_suspension_revision
  ) values (
    target_customer_user_id, target_idempotency_key, gen_random_uuid(),
    current_profile_id, target_conversation_id, target_locale, target_slug, target_search,
    displayed_fingerprint, current_quote - 'status', target_intent_fingerprint, intent,
    'authorizing', customer_context.customer_suspension_revision, owner_revision, current_profile.suspension_revision
  )
  on conflict do nothing
  returning * into inserted_attempt;

  if inserted_attempt.id is not null then
    return jsonb_build_object(
      'status', 'ready',
      'attemptId', inserted_attempt.id,
      'paymentLifecycleId', inserted_attempt.payment_lifecycle_id,
      'paymentSnapshot', null,
      'providerIdentity', null
    );
  end if;

  return jsonb_build_object('status', 'invalid');
end;
$function$;

CREATE OR REPLACE FUNCTION public.replace_cottage_shift_schedule (
  target_profile_id        uuid,
  target_expected_revision integer,
  requested_shifts         jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare profile public.owner_application_cottage_profiles;
declare current_revision public.cottage_shift_schedule_revisions;
declare saved_revision public.cottage_shift_schedule_revisions;
declare requested_shift jsonb;
declare requested_name text;
declare requested_start_text text;
declare requested_end_text text;
declare requested_names text[] := '{}';
declare requested_starts time without time zone[] := '{}';
declare requested_ends time without time zone[] := '{}';
declare saved_shifts jsonb;
begin
  if target_expected_revision is null or target_expected_revision < 0 then
    raise exception 'A non-negative Shift Schedule revision is required'
      using errcode = '22023';
  end if;
  if jsonb_typeof(requested_shifts) is distinct from 'array' then
    raise exception 'A Shift Schedule requires exactly two Cottage Shifts'
      using errcode = 'RC205';
  end if;
  if jsonb_array_length(requested_shifts) <> 2 then
    raise exception 'A Shift Schedule requires exactly two Cottage Shifts'
      using errcode = 'RC205';
  end if;
  if not exists (
    select 1 from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required'
      using errcode = '42501';
  end if;

  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id
  for update;

  if not found or profile.owner_user_id <> (select auth.uid()) then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required'
      using errcode = '42501';
  end if;
  if profile.status <> 'draft' then
    raise exception 'A submitted Cottage Profile Shift Schedule is read-only'
      using errcode = 'RC202';
  end if;

  if profile.current_shift_schedule_id is not null then
    select * into current_revision
    from public.cottage_shift_schedule_revisions
    where id = profile.current_shift_schedule_id;
  end if;
  if (target_expected_revision = 0 and current_revision.id is not null)
    or (target_expected_revision > 0 and (
      current_revision.id is null
      or current_revision.revision <> target_expected_revision
    )) then
    raise exception 'The Shift Schedule changed before this save'
      using errcode = 'RC409';
  end if;

  for requested_shift in select value from jsonb_array_elements(requested_shifts)
  loop
    if jsonb_typeof(requested_shift) is distinct from 'object'
      or jsonb_typeof(requested_shift -> 'name') is distinct from 'string'
      or jsonb_typeof(requested_shift -> 'startTime') is distinct from 'string'
      or jsonb_typeof(requested_shift -> 'endTime') is distinct from 'string' then
      raise exception 'The Cottage Shift is invalid' using errcode = 'RC205';
    end if;
    requested_name := btrim(coalesce(requested_shift ->> 'name', ''));
    requested_start_text := coalesce(requested_shift ->> 'startTime', '');
    requested_end_text := coalesce(requested_shift ->> 'endTime', '');
    if requested_name = ''
      or requested_start_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or requested_end_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or requested_start_text = requested_end_text then
      raise exception 'The Cottage Shift is invalid' using errcode = 'RC205';
    end if;
    requested_names := array_append(requested_names, requested_name);
    requested_starts := array_append(requested_starts, requested_start_text::time);
    requested_ends := array_append(requested_ends, requested_end_text::time);
  end loop;

  if requested_starts[1] >= requested_starts[2] then
    raise exception 'Morning must start before Evening' using errcode = 'RC205';
  end if;

  insert into public.cottage_shift_schedule_revisions (profile_id, revision)
  values (profile.id, coalesce(current_revision.revision, 0) + 1)
  returning * into saved_revision;

  perform set_config(
    'rentcottage.shift_schedule_write_revision_id',
    saved_revision.id::text,
    true
  );

  insert into public.cottage_shifts (
    schedule_revision_id, position, name, start_time, end_time
  )
  select saved_revision.id, requested.position::smallint,
    requested.name, requested.start_time, requested.end_time
  from unnest(requested_names, requested_starts, requested_ends) with ordinality
    as requested(name, start_time, end_time, position)
  order by requested.position;

  perform set_config(
    'rentcottage.shift_schedule_write_revision_id', '', true
  );

  update public.owner_application_cottage_profiles
  set current_shift_schedule_id = saved_revision.id
  where id = profile.id;

  select jsonb_agg(jsonb_build_object(
    'id', shifts.id,
    'name', shifts.name,
    'startTime', to_char(shifts.start_time, 'HH24:MI'),
    'endTime', to_char(shifts.end_time, 'HH24:MI'),
    'position', shifts.position,
    'crossesMidnight', shifts.end_time < shifts.start_time
  ) order by shifts.position) into saved_shifts
  from public.cottage_shifts shifts
  where shifts.schedule_revision_id = saved_revision.id;

  return jsonb_build_object(
    'profileId', saved_revision.profile_id,
    'revision', saved_revision.revision,
    'fullDayBundleId', saved_revision.full_day_bundle_id,
    'shifts', saved_shifts
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_cottage_inventory_pricing_unchecked_dates (
  target_profile_id           uuid,
  target_schedule_revision_id uuid,
  requested_prices            jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare profile public.owner_application_cottage_profiles;
declare requested_unit jsonb;
declare requested_override jsonb;
declare requested_unit_id uuid;
declare requested_kind public.cottage_inventory_unit_kind;
declare requested_price bigint;
declare standard_price bigint;
declare requested_weekday smallint;
declare requested_day date;
declare unit_start_time time without time zone;
declare seen_unit_ids uuid[] := '{}';
begin
  if not exists (
    select 1
    from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required' using errcode = '42501';
  end if;
  if jsonb_typeof(requested_prices) <> 'object'
    or jsonb_typeof(requested_prices -> 'units') <> 'array' then
    raise exception 'Cottage Inventory pricing input is invalid' using errcode = '22023';
  end if;

  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id
  for update;
  if not found or profile.owner_user_id <> (select auth.uid()) then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required' using errcode = '42501';
  end if;
  if profile.current_shift_schedule_id is distinct from target_schedule_revision_id then
    raise exception 'The Shift Schedule revision is no longer current' using errcode = 'RC409';
  end if;

  for requested_unit in
    select value from jsonb_array_elements(requested_prices -> 'units')
  loop
    if jsonb_typeof(requested_unit) <> 'object'
      or (requested_unit ->> 'unitId') !~ '^[0-9a-fA-F-]{36}$'
      or (requested_unit ->> 'unitKind') not in ('shift', 'full_day_bundle')
      or jsonb_typeof(requested_unit -> 'standardPriceIqd') <> 'number' then
      raise exception 'Cottage Inventory pricing input is invalid' using errcode = '22023';
    end if;
    requested_unit_id := (requested_unit ->> 'unitId')::uuid;
    requested_kind := (requested_unit ->> 'unitKind')::public.cottage_inventory_unit_kind;
    requested_price := (requested_unit ->> 'standardPriceIqd')::bigint;
    if requested_price <= 0
      or (requested_unit ->> 'standardPriceIqd')::numeric <> requested_price then
        raise exception 'Cottage Inventory prices must be positive whole IQD amounts'
        using errcode = '22023';
    end if;
    standard_price := requested_price;
    if requested_unit_id = any(seen_unit_ids) then
      raise exception 'Cottage Inventory pricing contains a duplicate unit'
        using errcode = '22023';
    end if;
    seen_unit_ids := array_append(seen_unit_ids, requested_unit_id);

    if requested_kind = 'shift'::public.cottage_inventory_unit_kind then
      select shifts.start_time into unit_start_time
      from public.cottage_shifts shifts
      where shifts.id = requested_unit_id
        and shifts.schedule_revision_id = target_schedule_revision_id;
    else
      select min(shifts.start_time) into unit_start_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id;
    end if;
    if unit_start_time is null then
      raise exception 'The Cottage Inventory unit is not part of the Shift Schedule revision'
        using errcode = 'RC205';
    end if;

    delete from public.cottage_inventory_weekday_price_overrides
    where schedule_revision_id = target_schedule_revision_id
      and unit_kind = requested_kind
      and unit_id = requested_unit_id;
    delete from public.cottage_inventory_date_price_overrides prices
    where schedule_revision_id = target_schedule_revision_id
      and unit_kind = requested_kind
      and unit_id = requested_unit_id
      and ((prices.service_day + unit_start_time) at time zone 'Asia/Baghdad') > now();

    for requested_override in
      select value from jsonb_array_elements(coalesce(requested_unit -> 'weekdayOverrides', '[]'::jsonb))
    loop
      if jsonb_typeof(requested_override) <> 'object'
        or (requested_override ->> 'weekday') !~ '^[0-6]$'
        or jsonb_typeof(requested_override -> 'priceIqd') <> 'number' then
        raise exception 'Cottage Inventory weekday pricing input is invalid'
          using errcode = '22023';
      end if;
      requested_weekday := (requested_override ->> 'weekday')::smallint;
      requested_price := (requested_override ->> 'priceIqd')::bigint;
      if requested_price <= 0
        or (requested_override ->> 'priceIqd')::numeric <> requested_price then
        raise exception 'Cottage Inventory prices must be positive whole IQD amounts'
          using errcode = '22023';
      end if;
      insert into public.cottage_inventory_weekday_price_overrides (
        schedule_revision_id, unit_kind, unit_id, weekday, price_iqd
      ) values (
        target_schedule_revision_id, requested_kind, requested_unit_id,
        requested_weekday, requested_price
      );
    end loop;

    for requested_override in
      select value from jsonb_array_elements(coalesce(requested_unit -> 'dateOverrides', '[]'::jsonb))
    loop
      if jsonb_typeof(requested_override) <> 'object'
        or (requested_override ->> 'serviceDay') !~ '^\d{4}-\d{2}-\d{2}$'
        or jsonb_typeof(requested_override -> 'priceIqd') <> 'number' then
        raise exception 'Cottage Inventory date pricing input is invalid'
          using errcode = '22023';
      end if;
      requested_day := (requested_override ->> 'serviceDay')::date;
      requested_price := (requested_override ->> 'priceIqd')::bigint;
      if requested_price <= 0
        or (requested_override ->> 'priceIqd')::numeric <> requested_price then
        raise exception 'Cottage Inventory prices must be positive whole IQD amounts'
          using errcode = '22023';
      end if;
      if ((requested_day + unit_start_time) at time zone 'Asia/Baghdad') <= now() then
        raise exception 'Only future Cottage Inventory can be changed'
          using errcode = 'RC204';
      end if;
      insert into public.cottage_inventory_date_price_overrides (
        schedule_revision_id, unit_kind, unit_id, service_day, price_iqd
      ) values (
        target_schedule_revision_id, requested_kind, requested_unit_id,
        requested_day, requested_price
      );
    end loop;

    insert into public.cottage_inventory_standard_prices (
      schedule_revision_id, unit_kind, unit_id, price_iqd
    ) values (
      target_schedule_revision_id, requested_kind, requested_unit_id, standard_price
    ) on conflict (schedule_revision_id, unit_kind, unit_id)
    do update set price_iqd = excluded.price_iqd;
  end loop;

  delete from public.cottage_inventory_standard_prices
  where schedule_revision_id = target_schedule_revision_id
    and not (unit_kind, unit_id) in (
      select (value ->> 'unitKind')::public.cottage_inventory_unit_kind,
        (value ->> 'unitId')::uuid
      from jsonb_array_elements(requested_prices -> 'units')
    );
  delete from public.cottage_inventory_weekday_price_overrides
  where schedule_revision_id = target_schedule_revision_id
    and not (unit_kind, unit_id) in (
      select (value ->> 'unitKind')::public.cottage_inventory_unit_kind,
        (value ->> 'unitId')::uuid
      from jsonb_array_elements(requested_prices -> 'units')
    );
  delete from public.cottage_inventory_date_price_overrides prices
  where prices.schedule_revision_id = target_schedule_revision_id
    and not (prices.unit_kind, prices.unit_id) in (
      select (value ->> 'unitKind')::public.cottage_inventory_unit_kind,
        (value ->> 'unitId')::uuid
      from jsonb_array_elements(requested_prices -> 'units')
    )
    and ((
      prices.service_day + case prices.unit_kind
        when 'shift'::public.cottage_inventory_unit_kind then (
          select shifts.start_time
          from public.cottage_shifts shifts
          where shifts.schedule_revision_id = prices.schedule_revision_id
            and shifts.id = prices.unit_id
        )
        when 'full_day_bundle'::public.cottage_inventory_unit_kind then (
          select min(shifts.start_time)
          from public.cottage_shifts shifts
          where shifts.schedule_revision_id = prices.schedule_revision_id
        )
      end
    ) at time zone 'Asia/Baghdad') > now();

  return jsonb_build_object(
    'profileId', target_profile_id,
    'scheduleRevisionId', target_schedule_revision_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_cottage_inventory_availability_changed_units (
  target_profile_id           uuid,
  target_schedule_revision_id uuid,
  target_service_day          date,
  requested_states            jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare profile public.owner_application_cottage_profiles;
declare requested_unit jsonb;
declare requested_unit_id uuid;
declare requested_kind public.cottage_inventory_unit_kind;
declare requested_state public.cottage_inventory_availability_state;
declare unit_start_time time without time zone;
begin
  if not exists (
    select 1 from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required' using errcode = '42501';
  end if;
  if jsonb_typeof(requested_states) <> 'array' then
    raise exception 'Cottage Inventory availability input is invalid' using errcode = '22023';
  end if;
  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id
  for update;
  if not found or profile.owner_user_id <> (select auth.uid()) then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required' using errcode = '42501';
  end if;
  if profile.current_shift_schedule_id is distinct from target_schedule_revision_id then
    raise exception 'The Shift Schedule revision is no longer current' using errcode = 'RC409';
  end if;

  for requested_unit in select value from jsonb_array_elements(requested_states)
  loop
    if jsonb_typeof(requested_unit) <> 'object'
      or (requested_unit ->> 'unitId') !~ '^[0-9a-fA-F-]{36}$'
      or (requested_unit ->> 'unitKind') not in ('shift', 'full_day_bundle')
      or (requested_unit ->> 'state') not in ('open', 'closed', 'private_blocked') then
      raise exception 'Cottage Inventory availability input is invalid' using errcode = '22023';
    end if;
    requested_unit_id := (requested_unit ->> 'unitId')::uuid;
    requested_kind := (requested_unit ->> 'unitKind')::public.cottage_inventory_unit_kind;
    requested_state := (requested_unit ->> 'state')::public.cottage_inventory_availability_state;
    if requested_kind = 'shift'::public.cottage_inventory_unit_kind then
      select shifts.start_time into unit_start_time
      from public.cottage_shifts shifts
      where shifts.id = requested_unit_id
        and shifts.schedule_revision_id = target_schedule_revision_id;
    else
      select shifts.start_time into unit_start_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id
      order by shifts.position limit 1;
    end if;
    if unit_start_time is null then
      raise exception 'The Cottage Inventory unit is not part of the Shift Schedule revision'
        using errcode = 'RC205';
    end if;
    if ((target_service_day + unit_start_time) at time zone 'Asia/Baghdad') <= now() then
      raise exception 'Only future Cottage Inventory can be changed' using errcode = 'RC204';
    end if;
    if requested_state = 'open'::public.cottage_inventory_availability_state
      and profile.current_publication_id is null then
      raise exception 'A Cottage must be published before inventory can open'
        using errcode = 'RC203';
    end if;
    if exists (
      select 1
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.schedule_revision_id = target_schedule_revision_id
        and occupancies.service_day = target_service_day
        and occupancies.active
        and (
          requested_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
          or occupancies.shift_id = requested_unit_id
        )
    ) then
      raise exception 'Committed Cottage Inventory cannot be changed by its owner'
        using errcode = 'RC204';
    end if;
  end loop;

  for requested_unit in select value from jsonb_array_elements(requested_states)
  loop
    insert into public.cottage_inventory_availability (
      schedule_revision_id, unit_kind, unit_id, service_day, state
    ) values (
      target_schedule_revision_id,
      (requested_unit ->> 'unitKind')::public.cottage_inventory_unit_kind,
      (requested_unit ->> 'unitId')::uuid,
      target_service_day,
      (requested_unit ->> 'state')::public.cottage_inventory_availability_state
    ) on conflict (schedule_revision_id, unit_kind, unit_id, service_day)
    do update set state = excluded.state;
  end loop;

  if exists (
    select 1
    from public.cottage_inventory_availability bundles
    where bundles.schedule_revision_id = target_schedule_revision_id
      and bundles.service_day = target_service_day
      and bundles.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      and bundles.state = 'open'::public.cottage_inventory_availability_state
      and not exists (
        select 1 from public.cottage_booking_period_occupancies occupancies
        where occupancies.schedule_revision_id = target_schedule_revision_id
          and occupancies.service_day = target_service_day
          and occupancies.active
      )
      and exists (
        select 1
        from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
          and not public.cottage_inventory_component_is_effectively_available(
            shifts.schedule_revision_id, shifts.id, target_service_day
          )
      )
  ) then
    raise exception 'A Full-Day Bundle requires every component Cottage Shift to be open'
      using errcode = 'RC205';
  end if;
  return jsonb_build_object(
    'profileId', target_profile_id,
    'scheduleRevisionId', target_schedule_revision_id,
    'serviceDay', target_service_day
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_cottage_profile_for_content_approval (
  target_profile_id       uuid,
  target_expected_version bigint
)
  RETURNS public.owner_application_cottage_profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  profile public.owner_application_cottage_profiles;
  source_revision public.cottage_profile_source_revisions;
  photo_count integer;
  ready_object_count integer;
begin
  if not exists (
    select 1 from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required'
      using errcode = '42501';
  end if;
  if target_expected_version is null or target_expected_version < 1 then
    raise exception 'A positive Cottage Profile version is required'
      using errcode = '22023';
  end if;

  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id
  for update;

  if not found or profile.owner_user_id <> (select auth.uid()) then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required'
      using errcode = '42501';
  end if;
  if profile.status = 'submitted_for_content_approval' then
    return profile;
  end if;
  if profile.version <> target_expected_version then
    raise exception 'The Cottage Profile changed before submission'
      using errcode = 'RC409';
  end if;
  if not public.cottage_profile_required_data_is_complete(profile.id) then
    raise exception 'The Cottage Profile is incomplete' using errcode = 'RC203';
  end if;

  select count(*)::integer into photo_count
  from public.cottage_profile_photos photos
  where photos.profile_id = profile.id and photos.is_active;
  ready_object_count := public.cottage_profile_ready_photo_count(profile.id);

  if photo_count not between 1 and 12 or ready_object_count <> photo_count then
    raise exception 'One to twelve ready Cottage Profile photos are required'
      using errcode = 'RC203';
  end if;

  insert into public.cottage_profile_source_revisions (
    profile_id, owner_user_id, source_language, description, house_rules,
    revision
  ) values (
    profile.id, profile.owner_user_id, profile.source_language,
    profile.description, profile.house_rules,
    coalesce((
      select max(revision) from public.cottage_profile_source_revisions
      where profile_id = profile.id
    ), 0) + 1
  ) returning * into source_revision;

  update public.owner_application_cottage_profiles
  set submitted_source_revision_id = source_revision.id,
      status = 'submitted_for_content_approval',
      version = version + 1,
      updated_at = now()
  where id = profile.id
  returning * into profile;

  return profile;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_owner_cottage_profile_draft (
  target_profile_id              uuid,
  target_expected_version        bigint,
  requested_name                 text,
  requested_governorate          text,
  requested_approximate_location text,
  requested_exact_address        text,
  requested_exact_latitude       numeric,
  requested_exact_longitude      numeric,
  requested_private_directions   text,
  requested_capacity             integer,
  requested_bedrooms             integer,
  requested_bathrooms            integer,
  requested_amenities            text[],
  requested_source_language      public.cottage_profile_source_language,
  requested_description          text,
  requested_house_rules          text
)
  RETURNS public.owner_application_cottage_profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  profile public.owner_application_cottage_profiles;
begin
  if not exists (
    select 1
    from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required'
      using errcode = '42501';
  end if;
  if target_expected_version is null or target_expected_version < 1 then
    raise exception 'A positive Cottage Profile version is required'
      using errcode = '22023';
  end if;

  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id
  for update;

  if not found or profile.owner_user_id <> (select auth.uid()) then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required'
      using errcode = '42501';
  end if;
  if profile.status <> 'draft' then
    raise exception 'A submitted Cottage Profile cannot be changed by its owner'
      using errcode = 'RC202';
  end if;
  if profile.version <> target_expected_version then
    raise exception 'The Cottage Profile changed before this save'
      using errcode = 'RC409';
  end if;

  select * into profile
  from public.apply_cottage_profile_working_copy(
    profile.id, requested_name, requested_governorate,
    requested_approximate_location, requested_exact_address,
    requested_exact_latitude, requested_exact_longitude,
    requested_private_directions, requested_capacity, requested_bedrooms,
    requested_bathrooms, requested_amenities, requested_source_language,
    requested_description, requested_house_rules
  );

  return profile;
end;
$function$;

ALTER TABLE public.booking_request_submission_attempts
  ADD COLUMN customer_suspension_revision bigint DEFAULT 0 NOT NULL;

ALTER TABLE public.booking_request_submission_attempts
  ADD COLUMN owner_suspension_revision bigint DEFAULT 0 NOT NULL;

ALTER TABLE public.booking_request_submission_attempts
  ADD COLUMN cottage_suspension_revision bigint DEFAULT 0 NOT NULL;

ALTER TABLE public.booking_request_submission_attempts
  ADD CONSTRAINT booking_request_submission_suspension_revisions_check
    CHECK (customer_suspension_revision >= 0 AND owner_suspension_revision >= 0 AND cottage_suspension_revision >= 0);