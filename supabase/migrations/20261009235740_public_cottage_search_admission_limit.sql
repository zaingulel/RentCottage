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
  perform contexts.user_id
  from public.account_contexts contexts
  where contexts.user_id = attempt.customer_user_id
  for update;
  select profiles.owner_user_id into owner_user_id
  from public.owner_application_cottage_profiles profiles
  where profiles.id = attempt.profile_id
  for update;
  if owner_user_id is null then
    raise exception 'Published Cottage was not found' using errcode = 'RC404';
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

CREATE OR REPLACE FUNCTION public.get_public_booking_quote_with_fingerprint (
  target_locale    public.cottage_profile_source_language,
  target_slug      text,
  requested_search jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  return public.resolve_booking_quote_with_fingerprint(target_locale, target_slug, requested_search, true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_booking_quote (
  target_locale    public.cottage_profile_source_language,
  target_slug      text,
  requested_search jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  return public.resolve_booking_quote(target_locale, target_slug, requested_search, true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_cottage_profile (
  target_locale    public.cottage_profile_source_language,
  target_slug      text,
  requested_search jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare result jsonb;
begin
  perform public.validate_public_cottage_discovery(requested_search);
  perform public.validate_public_cottage_discovery_admission(requested_search);
  with target as (
    select listing.public_slug, profile.current_shift_schedule_id as schedule_id,
      publication.*, localization.description, localization.house_rules
    from public.cottage_marketplace_listings listing
    join public.owner_application_cottage_profiles profile on profile.id = listing.profile_id
    join public.cottage_publication_snapshots publication on publication.id = profile.current_publication_id
    join public.cottage_publication_localizations localization
      on localization.publication_id = publication.id and localization.locale = target_locale
    where listing.public_slug = target_slug
      and public.is_cottage_publicly_discoverable(profile.id)
  )
  select jsonb_build_object(
    'slug', target.public_slug,
    'name', target.name,
    'governorate', target.governorate,
    'approximateLocation', target.approximate_location,
    'capacity', target.capacity,
    'bedrooms', target.bedrooms,
    'bathrooms', target.bathrooms,
    'amenities', target.amenities,
    'description', target.description,
    'houseRules', target.house_rules,
    'mediaIds', coalesce((
      select jsonb_agg(media.opaque_id order by media.position)
      from public.cottage_publication_media media
      where media.publication_id = target.id
    ), '[]'::jsonb),
    'inventory', inventory.value
  ) into result
  from target
  cross join lateral (
    select public.resolve_public_cottage_inventory(
      target.schedule_id, (requested_search ->> 'from')::date, (requested_search ->> 'to')::date
    ) as value
  ) inventory;
  return result;
end;
$function$;

CREATE FUNCTION public.resolve_booking_quote_with_fingerprint (
  target_locale            public.cottage_profile_source_language,
  target_slug              text,
  requested_search         jsonb,
  requires_admission_limit boolean
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare quote jsonb;
declare fingerprint text;
declare marketplace_terms jsonb;
begin
  quote := public.resolve_booking_quote(
    target_locale, target_slug, requested_search, requires_admission_limit
  );
  if quote ->> 'status' <> 'quoted' then
    return quote;
  end if;
  marketplace_terms := public.booking_request_marketplace_terms(target_locale);
  quote := quote || jsonb_build_object(
    'termsVersion', marketplace_terms ->> 'version',
    'marketplaceTerms', marketplace_terms
  );
  fingerprint := encode(
    extensions.digest(
      convert_to((quote - 'status')::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  return quote || jsonb_build_object('quoteFingerprint', fingerprint);
end;
$function$;

REVOKE ALL ON FUNCTION public.resolve_booking_quote_with_fingerprint(public.cottage_profile_source_language, text, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.resolve_booking_quote (
  target_locale            public.cottage_profile_source_language,
  target_slug              text,
  requested_search         jsonb,
  requires_admission_limit boolean
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare target record;
declare booking_price numeric;
declare quoted_items jsonb;
begin
  if target_locale is null then
    raise exception 'Booking Quote locale is required' using errcode = '22023';
  end if;
  if target_slug is null
    or octet_length(target_slug) <> 40
    or target_slug !~ '^cottage-[0-9a-f]{32}$' then
    raise exception 'Invalid public Cottage slug' using errcode = '22023';
  end if;
  if requested_search is null then
    raise exception 'Booking Quote search is required' using errcode = '22023';
  end if;
  perform public.validate_public_cottage_search(requested_search);
  -- A stored attempt is re-quoted without the admission limit, so an admitted request still finalizes.
  if requires_admission_limit then
    perform public.validate_public_cottage_discovery_admission(requested_search);
  end if;

  select listings.public_slug, profiles.current_shift_schedule_id as schedule_id,
    publications.name, publications.publication_number,
    localizations.house_rules,
    publications.capacity >= (requested_search ->> 'guests')::integer
      and (not requested_search ? 'governorate'
        or lower(publications.governorate) = lower(btrim(requested_search ->> 'governorate')))
      and (not requested_search ? 'area'
        or lower(publications.approximate_location) = lower(btrim(requested_search ->> 'area')))
      and array(
        select value
        from jsonb_array_elements_text(
          coalesce(requested_search -> 'amenities', '[]'::jsonb)
        ) values(value)
      ) <@ publications.amenities as matches_search,
    public.resolve_public_cottage_selection(
      profiles.current_shift_schedule_id, requested_search
    ) as inventory
  into target
  from public.cottage_marketplace_listings listings
  join public.owner_application_cottage_profiles profiles
    on profiles.id = listings.profile_id
  join public.cottage_publication_snapshots publications
    on publications.id = profiles.current_publication_id
    and publications.profile_id = profiles.id
  join public.cottage_publication_localizations localizations
    on localizations.publication_id = publications.id
    and localizations.locale = target_locale
  where listings.public_slug = target_slug
    and public.is_cottage_publicly_discoverable(profiles.id);

  if not found then
    return jsonb_build_object('status', 'not-found');
  end if;
  if not target.matches_search
    or (target.inventory ->> 'allAvailable')::boolean is not true
    or target.inventory ->> 'totalPriceIqd' is null then
    return jsonb_build_object('status', 'selection-unavailable');
  end if;

  booking_price := (target.inventory ->> 'totalPriceIqd')::numeric;
  if booking_price <= 0
    or booking_price + 5000 > 9007199254740991 then
    raise exception 'Booking Quote money exceeds the safe range'
      using errcode = '22003';
  end if;

  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'serviceDay', item.value ->> 'serviceDay',
    'kind', item.value ->> 'kind',
    'position', (item.value ->> 'position')::smallint,
    'displayName', item.value ->> 'name',
    'startsAt', (item.value ->> 'serviceDay') || 'T'
      || (item.value ->> 'startTime') || ':00+03:00',
    'endsAt', to_char(
      (item.value ->> 'serviceDay')::date
        + case
            when (item.value ->> 'endTime')::time
              < (item.value ->> 'startTime')::time then 1
            else 0
          end,
      'YYYY-MM-DD'
    ) || 'T' || (item.value ->> 'endTime') || ':00+03:00',
    'crossesMidnight', (item.value ->> 'endTime')::time
      < (item.value ->> 'startTime')::time,
    'priceIqd', (item.value ->> 'priceIqd')::bigint
  )) order by item.ordinality)
  into quoted_items
  from jsonb_array_elements(target.inventory -> 'selectedInventory')
    with ordinality as item(value, ordinality);

  return jsonb_build_object(
    'status', 'quoted',
    'slug', target.public_slug,
    'cottageName', target.name,
    'contentVersion', target.publication_number,
    'houseRules', target.house_rules,
    'termsVersion', 'rentcottage-mvp-2026-08-04',
    'items', quoted_items,
    'bookingPriceIqd', booking_price::bigint,
    'serviceFeeIqd', 5000,
    'customerTotalIqd', (booking_price + 5000)::bigint
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.resolve_booking_quote(public.cottage_profile_source_language, text, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.search_public_cottages (
  target_locale     public.cottage_profile_source_language,
  requested_search  jsonb,
  target_after_slug text,
  target_limit      integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  from_day date;
  to_day date;
  items jsonb;
  next_cursor text;
begin
  perform public.validate_public_cottage_discovery(requested_search);
  perform public.validate_public_cottage_discovery_admission(requested_search);
  if target_limit is null or target_limit < 1 or target_limit > 12
    or target_after_slug !~ '^cottage-[0-9a-f]{32}$' then
    raise exception 'Public Cottage search input is invalid' using errcode = '22023';
  end if;
  from_day := (requested_search ->> 'from')::date;
  to_day := (requested_search ->> 'to')::date;
  with candidates as (
    select profiles.id as profile_id, profiles.current_shift_schedule_id as schedule_id,
      listings.public_slug, publications.*, localizations.description,
      localizations.house_rules
    from public.owner_application_cottage_profiles profiles
    join public.cottage_marketplace_listings listings on listings.profile_id = profiles.id
    join public.cottage_publication_snapshots publications
      on publications.id = profiles.current_publication_id
    join public.cottage_publication_localizations localizations
      on localizations.publication_id = publications.id and localizations.locale = target_locale
    where public.is_cottage_publicly_discoverable(profiles.id)
      and listings.public_slug > coalesce(target_after_slug, '')
      and publications.capacity >= (requested_search ->> 'guests')::integer
      and (not requested_search ? 'governorate'
        or lower(publications.governorate) = lower(btrim(requested_search ->> 'governorate')))
      and (not requested_search ? 'area'
        or lower(publications.approximate_location) = lower(btrim(requested_search ->> 'area')))
      and array(
        select value from jsonb_array_elements_text(coalesce(requested_search -> 'amenities', '[]'::jsonb)) values(value)
      ) <@ publications.amenities
  ), selections as (
    select filters.value ->> 'serviceDay' as service_day, filters.value ->> 'kind' as kind,
      filters.value ->> 'position' as unit_position
    from jsonb_array_elements(coalesce(requested_search -> 'selections', '[]'::jsonb)) filters(value)
  ), page as (
    select ordered.id, ordered.schedule_id, ordered.public_slug, ordered.name, ordered.governorate,
      ordered.approximate_location, ordered.capacity, ordered.amenities
    from (
      select candidates.* from candidates
      -- offset 0 keeps the availability check above candidate assembly and ordering.
      order by candidates.public_slug offset 0
    ) ordered
    where (
      select count(distinct units.service_day) filter (where units.available) = (to_day - from_day + 1)
        and count(*) filter (where units.available and selections.service_day is not null)
          = (select count(*) from selections)
      from public.public_cottage_inventory_units(ordered.schedule_id, from_day, to_day) units
      left join selections
        on selections.service_day = to_char(units.service_day, 'YYYY-MM-DD')
        and selections.kind = case units.unit_kind
          when 'shift'::public.cottage_inventory_unit_kind then 'shift' else 'full-day' end
        and (selections.kind = 'full-day' or selections.unit_position = units.unit_position::text)
    )
    order by ordered.public_slug
    limit target_limit + 1
  ), enumerated as (
    select page.*, row_number() over (order by page.public_slug) as ordinal
    from page
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'slug', enumerated.public_slug,
      'name', enumerated.name,
      'governorate', enumerated.governorate,
      'approximateLocation', enumerated.approximate_location,
      'capacity', enumerated.capacity,
      'amenities', enumerated.amenities,
      'mediaIds', coalesce((
        select jsonb_agg(media.opaque_id order by media.position)
        from public.cottage_publication_media media
        where media.publication_id = enumerated.id
      ), '[]'::jsonb),
      'inventory', public.resolve_public_cottage_inventory(enumerated.schedule_id, from_day, to_day)
    ) order by enumerated.public_slug) filter (where enumerated.ordinal <= target_limit), '[]'::jsonb),
    case when count(*) > target_limit
      then max(enumerated.public_slug) filter (where enumerated.ordinal = target_limit) end
  into items, next_cursor
  from enumerated;

  return jsonb_build_object('items', items, 'nextCursor', next_cursor);
end;
$function$;

CREATE FUNCTION public.validate_public_cottage_discovery_admission (
  requested_search jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
begin
  -- Callers validate the search first; this adds only the admission limit.
  if (requested_search ->> 'to')::date - (requested_search ->> 'from')::date + 1 > 31 then
    raise exception 'Public Cottage search input is invalid' using errcode = '22023';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.validate_public_cottage_discovery_admission(jsonb) FROM PUBLIC, anon, authenticated, service_role;