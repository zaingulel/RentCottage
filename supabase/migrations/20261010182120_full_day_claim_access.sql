-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

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
  current_quote := public.resolve_booking_quote_with_fingerprint(
    attempt.locale, attempt.public_slug, attempt.requested_search, false
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