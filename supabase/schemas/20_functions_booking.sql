SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
SET default_tablespace = '';
SET default_table_access_method = "heap";

CREATE OR REPLACE FUNCTION "public"."append_booking_request_payment_history"("target_payment_lifecycle_id" "uuid", "target_booking_request_id" "uuid", "target_kind" "text", "target_source" "text", "target_provenance" "text", "target_operation_kind" "text" DEFAULT NULL::"text", "target_logical_operation_id" "text" DEFAULT NULL::"text", "target_physical_attempt_id" "text" DEFAULT NULL::"text", "target_operation_generation" bigint DEFAULT NULL::bigint, "target_recovery_generation" bigint DEFAULT NULL::bigint, "target_from_state" "text" DEFAULT NULL::"text", "target_to_state" "text" DEFAULT NULL::"text", "target_outcome" "text" DEFAULT NULL::"text", "target_reason_code" "text" DEFAULT NULL::"text", "target_provider_operation_id" "uuid" DEFAULT NULL::"uuid", "target_provider_request_id" "text" DEFAULT NULL::"text", "target_provider_reference" "text" DEFAULT NULL::"text", "target_movement_reference" "text" DEFAULT NULL::"text", "target_amount_fils" bigint DEFAULT NULL::bigint, "target_provider_occurred_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "target_received_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "target_source_recorded_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.booking_request_payment_history(
    payment_lifecycle_id, booking_request_id, kind, source, provenance, operation_kind,
    logical_operation_id, physical_attempt_id, operation_generation, recovery_generation,
    from_state, to_state, outcome, reason_code, provider_operation_id, provider_request_id,
    provider_reference, movement_reference, amount_fils, provider_occurred_at, received_at,
    source_recorded_at
  ) values(
    target_payment_lifecycle_id, target_booking_request_id, target_kind, target_source,
    target_provenance, target_operation_kind, target_logical_operation_id,
    target_physical_attempt_id, target_operation_generation, target_recovery_generation,
    target_from_state, target_to_state, target_outcome, target_reason_code,
    target_provider_operation_id, target_provider_request_id, target_provider_reference,
    target_movement_reference, target_amount_fils, target_provider_occurred_at,
    target_received_at, target_source_recorded_at
  );
end;
$$;

ALTER FUNCTION "public"."append_booking_request_payment_history"("target_payment_lifecycle_id" "uuid", "target_booking_request_id" "uuid", "target_kind" "text", "target_source" "text", "target_provenance" "text", "target_operation_kind" "text", "target_logical_operation_id" "text", "target_physical_attempt_id" "text", "target_operation_generation" bigint, "target_recovery_generation" bigint, "target_from_state" "text", "target_to_state" "text", "target_outcome" "text", "target_reason_code" "text", "target_provider_operation_id" "uuid", "target_provider_request_id" "text", "target_provider_reference" "text", "target_movement_reference" "text", "target_amount_fils" bigint, "target_provider_occurred_at" timestamp with time zone, "target_received_at" timestamp with time zone, "target_source_recorded_at" timestamp with time zone) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."begin_booking_request_authorization_claim"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."begin_booking_request_authorization_claim"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."begin_booking_request_submission_cleanup_release"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;

ALTER FUNCTION "public"."begin_booking_request_submission_cleanup_release"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_acceptance_evidence"("target_locale" "public"."cottage_profile_source_language", "target_terms_version" "text", "requires_inside_48" boolean) RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case target_locale
    when 'en' then jsonb_build_object(
      'locale', 'en',
      'cancellationPolicy', 'Cancel at least 48 hours before the first shift for a full refund. Cancellation inside 48 hours and no-shows receive no refund.',
      'cancellationAcceptance', 'I accept the cancellation policy.',
      'marketplaceTermsAcceptance', 'I accept the marketplace booking terms. (' || target_terms_version || ')',
      'inside48Warning', case when requires_inside_48 then 'This request begins inside 48 hours and will be non-refundable immediately if accepted.' else null end,
      'inside48Acceptance', case when requires_inside_48 then 'I understand and accept the inside-48-hours no-refund rule.' else null end
    )
    when 'ar' then jsonb_build_object(
      'locale', 'ar',
      'cancellationPolicy', 'الإلغاء قبل 48 ساعة على الأقل يعيد المبلغ كاملاً. لا استرداد عند الإلغاء خلال 48 ساعة أو عدم الحضور.',
      'cancellationAcceptance', 'أوافق على سياسة الإلغاء.',
      'marketplaceTermsAcceptance', 'أوافق على شروط الحجز في المنصة. (' || target_terms_version || ')',
      'inside48Warning', case when requires_inside_48 then 'يبدأ هذا الطلب خلال 48 ساعة وسيصبح غير قابل للاسترداد فور قبوله.' else null end,
      'inside48Acceptance', case when requires_inside_48 then 'أفهم وأوافق على عدم الاسترداد خلال 48 ساعة.' else null end
    )
    when 'ckb' then jsonb_build_object(
      'locale', 'ckb',
      'cancellationPolicy', 'هەڵوەشاندنەوە لانیکەم 48 کاتژمێر پێش شەفت پارەکە بە تەواوی دەگەڕێنێتەوە. لە ناو 48 کاتژمێر یان نەهاتندا پارە ناگەڕێتەوە.',
      'cancellationAcceptance', 'سیاسەتی هەڵوەشاندنەوە قبوڵ دەکەم.',
      'marketplaceTermsAcceptance', 'مەرجەکانی حجزکردنی پلاتفۆرم قبوڵ دەکەم. (' || target_terms_version || ')',
      'inside48Warning', case when requires_inside_48 then 'ئەم داواکارییە لە ناو 48 کاتژمێردا دەست پێدەکات و دوای پەسەندکردن پارەکە ناگەڕێتەوە.' else null end,
      'inside48Acceptance', case when requires_inside_48 then 'یاسای نەگەڕاندنەوەی پارە لە ناو 48 کاتژمێردا قبوڵ دەکەم.' else null end
    )
  end;
$$;

ALTER FUNCTION "public"."booking_request_acceptance_evidence"("target_locale" "public"."cottage_profile_source_language", "target_terms_version" "text", "requires_inside_48" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_active_claim_conflicts_unit"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.booking_request_authorization_claim_occupancies occupancies
    where occupancies.active
      and occupancies.schedule_revision_id = target_schedule_revision_id
      and occupancies.service_day = target_service_day
      and (
        target_unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
        or occupancies.shift_id = target_unit_id
      )
  );
$$;

ALTER FUNCTION "public"."booking_request_active_claim_conflicts_unit"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_claim_state_after_payment"("current_state" "public"."booking_request_authorization_claim_state", "next_attempt_state" "text", "authorization_has_provider_request" boolean, "release_status" "text") RETURNS "public"."booking_request_authorization_claim_state"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case
    when public.booking_request_claim_state_is_terminal(current_state)
      then current_state
    when next_attempt_state = 'authorized' then 'authorized'
    when next_attempt_state = 'authorization_failed'
      and not authorization_has_provider_request then 'not_started'
    when next_attempt_state = 'authorization_failed' then 'failed'
    when next_attempt_state = 'released' then 'released'
    when release_status = 'failed' then 'reconciliation_required'
    when next_attempt_state = 'releasing' then 'releasing'
    when next_attempt_state = 'reconciliation_required'
      then 'reconciliation_required'
    else current_state
  end::public.booking_request_authorization_claim_state;
$$;

ALTER FUNCTION "public"."booking_request_claim_state_after_payment"("current_state" "public"."booking_request_authorization_claim_state", "next_attempt_state" "text", "authorization_has_provider_request" boolean, "release_status" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_claim_state_allows_authorization"("target_state" "public"."booking_request_authorization_claim_state") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO ''
    AS $$
  select target_state in ('starting', 'reconciliation_required');
$$;

ALTER FUNCTION "public"."booking_request_claim_state_allows_authorization"("target_state" "public"."booking_request_authorization_claim_state") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_claim_state_is_active"("target_state" "public"."booking_request_authorization_claim_state") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO ''
    AS $$
  select target_state in (
    'starting', 'reconciliation_required', 'authorized', 'releasing'
  );
$$;

ALTER FUNCTION "public"."booking_request_claim_state_is_active"("target_state" "public"."booking_request_authorization_claim_state") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_claim_state_is_reconcilable"("target_state" "public"."booking_request_authorization_claim_state") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO ''
    AS $$
  select target_state in (
    'starting', 'reconciliation_required', 'authorized', 'releasing'
  );
$$;

ALTER FUNCTION "public"."booking_request_claim_state_is_reconcilable"("target_state" "public"."booking_request_authorization_claim_state") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_claim_state_is_terminal"("target_state" "public"."booking_request_authorization_claim_state") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO ''
    AS $$
  select target_state in (
    'not_started', 'failed', 'released', 'expired', 'converted'
  );
$$;

ALTER FUNCTION "public"."booking_request_claim_state_is_terminal"("target_state" "public"."booking_request_authorization_claim_state") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_content_is_safe"("target_value" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
  with normalized as (
    select regexp_replace(
      target_value,
      U&'[\00AD\034F\061C\115F-\1160\17B4-\17B5\180B-\180F\200B-\200F\202A-\202E\2060-\206F\3164\FE00-\FE0F\FEFF\FFA0\FFF0-\FFF8\+013430-\+01343F\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0000-\+0E0FFF]',
      '',
      'g'
    ) as value
  )
  select target_value is not null
    and length(regexp_replace(value, '[^[:digit:]]', '', 'g')) < 7
    and value !~* '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+'
    and value !~* '[^[:space:]@.]+[[:space:]]*@[[:space:]]*[^[:space:]@.]+[[:space:]]*\.[[:space:]]*[[:alpha:]]{2,63}([^[:alnum:]]|$)'
    and value !~* '(https?://|www\.|[[:alnum:]][[:alnum:]-]*\.[[:alpha:]]{2,63}([^[:alnum:]]|$))'
    and value !~* '(^|[^[:alnum:]_])@[[:alnum:]_][[:alnum:]_.-]{1,31}([^[:alnum:]_.-]|$)'
    and value !~* '(whats?app|telegram|instagram|facebook|snapchat|tiktok)'
    and value !~* '(^|[^[:alpha:]])(zero|one|two|three|four|five|six|seven|eight|nine|صفر|واحد|اثنان|اثنين|ثلاثة|أربعة|اربعة|خمسة|ستة|سبعة|ثمانية|تسعة|سفر|یەک|یەك|دوو|سێ|چوار|پێنج|شەش|حەوت|هەشت|نۆ)([[:space:][:punct:]]+(zero|one|two|three|four|five|six|seven|eight|nine|صفر|واحد|اثنان|اثنين|ثلاثة|أربعة|اربعة|خمسة|ستة|سبعة|ثمانية|تسعة|سفر|یەک|یەك|دوو|سێ|چوار|پێنج|شەش|حەوت|هەشت|نۆ)){6}'
    and value !~* '(^|[^[:alnum:]_])[[:alnum:]][[:alnum:]-]*[[:space:][:punct:]]+(at|ات|آت|ئەت)[[:space:][:punct:]]+[[:alnum:]][[:alnum:]-]*[[:space:][:punct:]]+(dot|دوت|نقطة|دۆت)[[:space:][:punct:]]+[[:alpha:]]{2,63}([^[:alnum:]]|$)'
    and value !~* '(^|[^[:alnum:]_])([[:alnum:]][[:alnum:]-]*|[[:alpha:]]([[:space:][:punct:]]+[[:alpha:]])+)[[:space:][:punct:]]+(at|ات|آت|ئەت)[[:space:][:punct:]]+([[:alnum:]][[:alnum:]-]*|[[:alpha:]]([[:space:][:punct:]]+[[:alpha:]])+)[[:space:][:punct:]]+(dot|دوت|نقطة|دۆت)[[:space:][:punct:]]+([[:alpha:]]{2,63}|[[:alpha:]]([[:space:][:punct:]]+[[:alpha:]])+)([^[:alnum:]_]|$)'
    and value !~* '(^|[^[:alnum:]_])[[:alnum:]][[:alnum:]-]*[[:space:][:punct:]]+(dot|دوت|نقطة|دۆت)[[:space:][:punct:]]+[[:alpha:]]{2,63}([^[:alnum:]]|$)'
  from normalized;
$_$;

ALTER FUNCTION "public"."booking_request_content_is_safe"("target_value" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_marketplace_terms"("target_locale" "public"."cottage_profile_source_language") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
declare terms_body text;
declare terms_version constant text := 'fictional-local-test-2026-08-22-v1';
begin
  terms_body := case target_locale
    when 'en' then $terms$FICTIONAL LOCAL TEST TERMS — NOT A LEGAL AGREEMENT

1. This is a local software test only. No real cottage, public booking, payment, authorization, contract, or reservation is created.
2. The test simulates authorization of the full displayed Customer Total in Iraqi dinars. It is not a charge, transfers no money, and uses no real payment provider.
3. The Booking Request remains pending until the fictional Cottage Owner accepts or declines it within the displayed four-hour response deadline. A successfully finalized simulated authorization remains reserved through that deadline.
4. The displayed House Rules, fictional cancellation policy, Booking Price, service fee, Customer Total, selected period, warnings, and acceptances are preserved with the test request.
5. The fictional cancellation and no-show wording is test content only. It demonstrates the displayed full-refund and no-refund cases but cannot create a real cancellation, refund, fee, or debt.
6. Do not share phone numbers, email addresses, social handles, or links in names or notes. The fictional Owner sees only contact-safe request details, never the Customer phone or simulated provider identity. No direct contact or public booking is enabled.
7. Do not use this fixture for a real booking. It has not been approved by legal counsel, is non-operative, and creates no rights or obligations.$terms$
    when 'ar' then $terms$شروط اختبار محلية خيالية — ليست اتفاقاً قانونياً

1. هذا اختبار برمجي محلي فقط. لا ينشئ بيتاً أو حجزاً عاماً أو دفعاً أو تفويضاً أو عقداً أو حجزاً حقيقياً.
2. يحاكي الاختبار تفويض إجمالي العميل المعروض كاملاً بالدينار العراقي. ليس خصماً مالياً ولا ينقل أموالاً ولا يستخدم مزود دفع حقيقياً.
3. يبقى الطلب قيد الانتظار حتى يقبل مالك البيت الخيالي أو يرفض خلال مهلة الرد المعروضة البالغة أربع ساعات. يبقى التفويض المحاكى المكتمل محفوظاً حتى نهاية تلك المهلة.
4. تُحفظ قواعد البيت المعروضة وسياسة الإلغاء الخيالية وسعر الحجز ورسوم الخدمة وإجمالي العميل والفترة المختارة والتحذيرات والقبولات مع طلب الاختبار.
5. نص الإلغاء الخيالي وعدم الحضور هو محتوى اختباري فقط. يوضح حالات الاسترداد الكامل وعدم الاسترداد المعروضة، لكنه لا ينشئ إلغاءً أو استرداداً أو رسماً أو ديناً حقيقياً.
6. لا تشارك أرقام الهواتف أو عناوين البريد الإلكتروني أو معرفات التواصل الاجتماعي أو الروابط في الأسماء أو الملاحظات. يرى المالك الخيالي تفاصيل آمنة للتواصل فقط، ولا يرى هاتف العميل أو هوية مزود المحاكاة. لا يتاح اتصال مباشر أو حجز عام.
7. لا تستخدم هذا النص لحجز حقيقي. لم يعتمدها مستشار قانوني، وهي غير نافذة ولا تنشئ أي حقوق أو التزامات.$terms$
    when 'ckb' then $terms$مەرجە خەیاڵییەکانی تاقیکردنەوەی ناوخۆیی — ڕێککەوتنێکی یاسایی نییە

1. ئەمە تەنها تاقیکردنەوەی نەرمامێری ناوخۆییە. هیچ کۆتێج، حجزکردنی گشتی، پارەدان، ڕێگەپێدان، گرێبەست یان حجزێکی ڕاستەقینە دروست ناکات.
2. تاقیکردنەوەکە ڕێگەپێدانی تەواوی کۆی گشتی کڕیار بە دیناری عێراقی دەخاتە ڕوو. پارە وەرناگرێت، هیچ پارەیەک ناگوازێتەوە و دابینکەری پارەدانی ڕاستەقینە بەکارناهێنێت.
3. داواکارییەکە بە چاوەڕوانی دەمێنێتەوە تا خاوەنی کۆتێجی خەیاڵی لە ماوەی چوار کاتژمێری دیاریکراودا قبوڵی بکات یان ڕەتی بکاتەوە. ڕێگەپێدانی ساختەی تەواوکراو تا کۆتایی ئەو ماوەیە پارێزراو دەمێنێتەوە.
4. یاساکانی کۆتێج، سیاسەتی خەیاڵی هەڵوەشاندنەوە، نرخی حجز، کرێی خزمەتگوزاری، کۆی گشتی کڕیار، ماوەی هەڵبژێردراو، ئاگادارکردنەوە و قبوڵکردنەکان لەگەڵ داواکارییە تاقیکارییەکەدا پارێزراو دەبن.
5. دەقی هەڵوەشاندنەوە و نەهاتنی خەیاڵی تەنها ناوەڕۆکی تاقیکردنەوەیە. حاڵەتە پیشاندراوەکانی گەڕاندنەوەی تەواوی پارە و نەگەڕاندنەوە ڕوون دەکاتەوە، بەڵام هیچ هەڵوەشاندنەوە، گەڕاندنەوەی پارە، کرێ یان قەرزێکی ڕاستەقینە دروست ناکات.
6. ژمارەی تەلەفۆن هاوبەش مەکە، هەروەها ناونیشانی ئیمەیڵ، ناوی تۆڕی کۆمەڵایەتی یان بەستەر لە ناو یان تێبینیدا مەنووسە. خاوەنی خەیاڵی تەنها وردەکارییە بێ‌مەترسییەکان دەبینێت، نە ژمارەی کڕیار یان ناسنامەی دابینکەری ساختە. هیچ پەیوەندییەکی ڕاستەوخۆ یان حجزکردنی گشتی بەردەست نییە.
7. ئەم دەقە بۆ حجزێکی ڕاستەقینە بەکارمەهێنە. لەلایەن ڕاوێژکاری یاساییەوە پەسەند نەکراوە، کاریگەری یاسایی نییە و هیچ ماف یان ئەرکێک دروست ناکات.$terms$
  end;
  return jsonb_build_object(
    'version', terms_version,
    'locale', target_locale,
    'body', terms_body,
    'sha256', encode(
      extensions.digest(convert_to(terms_body, 'UTF8'), 'sha256'), 'hex'
    ),
    'operative', false
  );
end;
$_$;

ALTER FUNCTION "public"."booking_request_marketplace_terms"("target_locale" "public"."cottage_profile_source_language") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_payment_quarantined"("target_booking_request_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform 1 from public.booking_requests requests where requests.id=target_booking_request_id for update of requests;
  return exists(select 1 from public.booking_request_payment_required_expiry_work expiry
    where expiry.booking_request_id=target_booking_request_id and expiry.state='quarantined');
end;
$$;

ALTER FUNCTION "public"."booking_request_payment_quarantined"("target_booking_request_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_payment_recovery_status"("target_request" "public"."booking_requests") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select case when target_request.status='accepted' and work.state='payment_required' then
    jsonb_build_object('status',case
      when exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=target_request.id and expiry.state='quarantined') then 'quarantined'
      when confirmation.id is not null then 'confirmed'
      when attempt.state='succeeded' then 'processing'
      when clock_timestamp() >= work.payment_required_deadline then 'deadline-elapsed'
      when attempt.state='safely_failed' then 'retryable'
      when attempt.state in ('blocked','admitted','original_released','replacement_authorized','capture_failed') then 'processing'
      when attempt.state='late_succeeded' then 'deadline-elapsed'
      else 'available' end)
  end
  from public.booking_request_capture_work work
  left join lateral (select attempts.* from public.booking_request_payment_recovery_attempts attempts
    where attempts.booking_request_id=target_request.id order by attempts.generation desc limit 1) attempt on true
  left join public.booking_confirmations confirmation on confirmation.booking_request_id=target_request.id and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=target_request.id)
  where work.booking_request_id=target_request.id;
$$;

ALTER FUNCTION "public"."booking_request_payment_recovery_status"("target_request" "public"."booking_requests") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_payment_required_expiry_completed"("target_booking_request_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    and not exists(select 1 from public.booking_confirmations confirmation where confirmation.booking_request_id=request.id and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=request.id));
end;
$$;

ALTER FUNCTION "public"."booking_request_payment_required_expiry_completed"("target_booking_request_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_payment_required_expiry_permit"("target" "public"."booking_request_payment_required_expiry_operations", "deadline" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select case when target.operation_kind='refund' then jsonb_build_object(
    'purpose','booking-request-payment-required-corrective-refund','expiryWorkId',target.expiry_work_id,
    'expiryOperationId',target.id,'idempotencyKey',target.provider_idempotency_key,
    'notBefore',to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'binding',jsonb_build_object('bookingRequestId',target.booking_request_id,'captureProviderOperationId',target.capture_provider_operation_id,
      'paymentLifecycleId',target.authorization_payment_lifecycle_id,
      'captureLogicalOperationId',(select ledger.logical_operation_id from public.payment_provider_operations ledger where ledger.id=target.capture_provider_operation_id),
      'capturePhysicalAttemptId',(select ledger.physical_attempt_id from public.payment_provider_operations ledger where ledger.id=target.capture_provider_operation_id),
      'captureMovementReference',(select ledger.movement_reference from public.payment_provider_operations ledger where ledger.id=target.capture_provider_operation_id),
      'captureOccurredAt',to_char(target.capture_occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'refundLogicalOperationId',target.release_logical_operation_id,'refundPhysicalAttemptId',target.release_physical_attempt_id,
      'amountFils',target.amount_fils,'currency',target.currency,'providerIdentity',jsonb_build_object('provider',target.provider,
        'environment',target.environment,'merchantId',target.merchant_id,'terminalId',target.terminal_id)))
  else jsonb_build_object(
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
        'merchantId',target.merchant_id,'terminalId',target.terminal_id))) end;
$$;

ALTER FUNCTION "public"."booking_request_payment_required_expiry_permit"("target" "public"."booking_request_payment_required_expiry_operations", "deadline" timestamp with time zone) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_payment_required_expiry_provider_matches"("target_work" "public"."booking_request_capture_work", "target_provider_identity" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."booking_request_payment_required_expiry_provider_matches"("target_work" "public"."booking_request_capture_work", "target_provider_identity" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_payment_required_expiry_status"("target_request" "public"."booking_requests") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select case when capture.state='payment_required'
    and expiry.payment_required_deadline=capture.payment_required_deadline
    and not exists(select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id=target_request.id and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=target_request.id))
    and ((target_request.status='accepted' and expiry.state in ('processing','attention_required','quarantined'))
      or (target_request.status='expired' and expiry.state in ('complete','quarantined')))
  then jsonb_build_object('status',case expiry.state when 'complete' then case when exists(select 1 from public.booking_request_payment_required_expiry_operations operations where operations.expiry_work_id=expiry.id and operations.operation_kind='refund') then 'refunded-expired' else 'expired' end
    when 'quarantined' then case when target_request.status='expired' then 'quarantined-released' else 'quarantined' end
    when 'attention_required' then 'attention-required' else case when exists(select 1 from public.booking_request_payment_required_expiry_operations operations where operations.expiry_work_id=expiry.id and operations.operation_kind='refund') then 'refunding' else 'processing' end end,
    'deadline',to_char(capture.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end
  from public.booking_request_capture_work capture
  join public.booking_request_payment_required_expiry_work expiry on expiry.booking_request_id=capture.booking_request_id
  where capture.booking_request_id=target_request.id;
$$;

ALTER FUNCTION "public"."booking_request_payment_required_expiry_status"("target_request" "public"."booking_requests") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_payment_required_window"("target_request" "public"."booking_requests") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select case when target_request.status='accepted' and work.state='payment_required'
    and not exists(select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id=target_request.id)
  then jsonb_build_object(
    'recordedAt',to_char(work.payment_required_recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deadline',to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'databaseNow',to_char(date_trunc('milliseconds',clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end
  from public.booking_request_capture_work work where work.booking_request_id=target_request.id;
$$;

ALTER FUNCTION "public"."booking_request_payment_required_window"("target_request" "public"."booking_requests") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_payment_status"("target_request" "public"."booking_requests") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select case when target_request.status = 'accepted' then case
      when exists (
        select 1 from public.booking_confirmations confirmations
        join public.cottage_booking_period_commitments commitments on commitments.id = confirmations.booking_period_commitment_id
        join public.booking_request_capture_work capture_work on capture_work.booking_request_id = confirmations.booking_request_id
        where confirmations.booking_request_id = target_request.id
            and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=target_request.id)
          and not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=target_request.id and expiry.state='quarantined')
          and confirmations.booking_snapshot_id = target_request.booking_snapshot_id
          and confirmations.booking_period_commitment_id = target_request.booking_period_commitment_id
          and commitments.status = 'confirmed_booking' and (capture_work.state = 'complete' or (
            capture_work.state='payment_required' and exists (
              select 1 from public.booking_request_payment_recovery_attempts attempts
              join public.booking_request_payment_recovery_operations operations on operations.recovery_attempt_id=attempts.id
                and operations.step='replacement-capture' and operations.outcome='succeeded'
              join public.payment_provider_operations ledger on ledger.id=operations.provider_operation_id
              where attempts.booking_request_id=target_request.id and attempts.state='succeeded'
                and operations.provider_operation_id=confirmations.capture_operation_id
                and ledger.current_outcome='succeeded' and ledger.recovery_attempt_id=attempts.id
                and ledger.authoritative_outcome_at=operations.authoritative_outcome_at
                and ledger.authoritative_outcome_at < capture_work.payment_required_deadline
            )))
      ) then 'paid-confirmed'
      when exists (select 1 from public.booking_request_capture_work capture_work
        where capture_work.booking_request_id = target_request.id and capture_work.state = 'payment_required')
        then 'payment-required'
      when exists (select 1 from public.booking_request_capture_work capture_work where capture_work.booking_request_id = target_request.id)
        then 'capture-processing'
      end end;
$$;

ALTER FUNCTION "public"."booking_request_payment_status"("target_request" "public"."booking_requests") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_policy_at"("first_starts_at" timestamp with time zone, "evaluated_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'insideCutoff', first_starts_at < evaluated_at + interval '6 hours',
    'requiresInside48HourNoRefundAcceptance',
      first_starts_at < evaluated_at + interval '48 hours'
  );
$$;

ALTER FUNCTION "public"."booking_request_policy_at"("first_starts_at" timestamp with time zone, "evaluated_at" timestamp with time zone) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_recovery_execution_permit"("target_attempt" "public"."booking_request_payment_recovery_attempts", "target_work" "public"."booking_request_capture_work", "target_payment_snapshot" "jsonb", "target_step" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare previous public.booking_request_payment_recovery_operations;
declare previous_attempt public.booking_request_payment_recovery_attempts;
declare previous_ledger public.payment_provider_operations;
declare predecessor text;
declare predecessor_time timestamptz;
declare previous_step text;
declare operation_identity text := target_attempt.id::text||':'||target_step;
declare binding jsonb;
begin
  if target_step='original-release' then
    predecessor := target_payment_snapshot#>>'{authorization,movementReference}';
    predecessor_time := (target_payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz;
  else
    previous_step := case target_step when 'replacement-authorization' then 'original-release'
      when 'replacement-capture' then 'replacement-authorization'
      when 'replacement-release' then 'replacement-authorization' end;
    if previous_step is null then raise exception 'Recovery step is invalid' using errcode='RC409'; end if;
    select operations.* into previous
    from public.booking_request_payment_recovery_operations operations
    join public.booking_request_payment_recovery_attempts attempts on attempts.id=operations.recovery_attempt_id
    where attempts.booking_request_id=target_attempt.booking_request_id
      and operations.step=previous_step and operations.outcome='succeeded'
      and (previous_step='original-release' or attempts.id=target_attempt.id)
    order by attempts.generation limit 1 for update of operations,attempts;
    select * into previous_attempt from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=previous.recovery_attempt_id;
    previous_ledger := public.validate_booking_request_recovery_operation(previous,
      public.booking_request_recovery_execution_permit(previous_attempt,target_work,target_payment_snapshot,previous_step));
    if previous_ledger.current_outcome is distinct from 'succeeded'
      or previous_ledger.authoritative_outcome_at is null then
      raise exception 'Recovery predecessor is unresolved' using errcode='RC409';
    end if;
    predecessor := previous_ledger.movement_reference;
    predecessor_time := previous_ledger.authoritative_outcome_at;
  end if;
  if predecessor is null then raise exception 'Recovery predecessor is missing' using errcode='RC409'; end if;
  binding := jsonb_build_object('bookingRequestId',target_attempt.booking_request_id,
    'recoveryAttemptId',target_attempt.id,'generation',target_attempt.generation,'step',target_step,
    'authorizationClaimId',target_work.authorization_claim_id,
    'authorizationClaimGeneration',target_work.authorization_claim_generation,
    'predecessorMovementReference',predecessor,
    'predecessorOutcomeAt',to_char(predecessor_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'paymentLifecycleId',case when target_step='original-release' then target_work.payment_lifecycle_id else target_attempt.id end,
    'logicalOperationId',operation_identity,'physicalAttemptId',operation_identity||':1',
    'amountFils',target_work.amount_fils,'currency',target_work.currency,
    'requestFingerprint',target_work.request_fingerprint,
    'providerIdentity',jsonb_build_object('provider',target_work.provider,'environment',target_work.environment,
      'merchantId',target_work.merchant_id,'terminalId',target_work.terminal_id));
  return jsonb_build_object('purpose','booking-request-payment-recovery','attemptId',target_attempt.id,
    'generation',target_attempt.generation,'step',target_step,'operationId',operation_identity,
    'idempotencyKey',operation_identity||':1','binding',binding,
    'notAfter',to_char(target_work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;

ALTER FUNCTION "public"."booking_request_recovery_execution_permit"("target_attempt" "public"."booking_request_payment_recovery_attempts", "target_work" "public"."booking_request_capture_work", "target_payment_snapshot" "jsonb", "target_step" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_release_fingerprint"("target_provider" "text", "target_environment" "text", "target_merchant_id" "text", "target_terminal_id" "text", "target_payment_lifecycle_id" "uuid", "target_logical_operation_id" "text", "target_physical_attempt_id" "text", "target_amount_fils" bigint, "target_currency" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select encode(extensions.digest(convert_to(concat_ws(E'\n',
    target_provider, target_environment, target_merchant_id, target_terminal_id,
    'release', target_payment_lifecycle_id::text, target_logical_operation_id,
    target_physical_attempt_id, target_amount_fils::text, target_currency
  ), 'UTF8'), 'sha256'), 'hex');
$$;

ALTER FUNCTION "public"."booking_request_release_fingerprint"("target_provider" "text", "target_environment" "text", "target_merchant_id" "text", "target_terminal_id" "text", "target_payment_lifecycle_id" "uuid", "target_logical_operation_id" "text", "target_physical_attempt_id" "text", "target_amount_fils" bigint, "target_currency" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."booking_request_submission_cleanup_fingerprint"("target_attempt_id" "uuid", "target_claim_id" "uuid", "target_claim_generation" integer, "target_state_revision" bigint, "target_provider" "text", "target_environment" "text", "target_merchant_id" "text", "target_terminal_id" "text", "target_payment_lifecycle_id" "uuid", "target_logical_operation_id" "text", "target_physical_attempt_id" "text", "target_amount_fils" bigint, "target_currency" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select encode(extensions.digest(convert_to(concat_ws(E'\n',
    'booking-request-submission-cleanup', target_attempt_id::text,
    target_claim_id::text, target_claim_generation::text,
    target_state_revision::text, target_provider, target_environment,
    target_merchant_id, target_terminal_id, target_payment_lifecycle_id::text,
    target_logical_operation_id, target_physical_attempt_id,
    target_amount_fils::text, target_currency
  ), 'UTF8'), 'sha256'), 'hex');
$$;

ALTER FUNCTION "public"."booking_request_submission_cleanup_fingerprint"("target_attempt_id" "uuid", "target_claim_id" "uuid", "target_claim_generation" integer, "target_state_revision" bigint, "target_provider" "text", "target_environment" "text", "target_merchant_id" "text", "target_terminal_id" "text", "target_payment_lifecycle_id" "uuid", "target_logical_operation_id" "text", "target_physical_attempt_id" "text", "target_amount_fils" bigint, "target_currency" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."claim_booking_request_action"("target_actor_user_id" "uuid", "target_booking_request_id" "uuid", "target_action" "text", "target_decline_reason" "text" DEFAULT NULL::"text", "target_decline_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."claim_booking_request_action"("target_actor_user_id" "uuid", "target_booking_request_id" "uuid", "target_action" "text", "target_decline_reason" "text", "target_decline_note" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."claim_booking_request_expiry"("target_booking_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."claim_booking_request_expiry"("target_booking_request_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."claim_customer_booking_request_payment_recovery"("target_booking_request_id" "uuid", "target_command_key" "uuid", "target_replacement_method" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined','bookingRequestId',target_booking_request_id); end if;
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

ALTER FUNCTION "public"."claim_customer_booking_request_payment_recovery"("target_booking_request_id" "uuid", "target_command_key" "uuid", "target_replacement_method" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."claim_due_booking_request_captures"("target_limit" integer, "target_provider_identity" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare candidate record;
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.payment_provider_operations;
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
    where not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=capture_work.booking_request_id and expiry.state='quarantined') and requests.status = 'accepted'
      and capture_work.provider = target_provider_identity ->> 'provider'
      and capture_work.environment = target_provider_identity ->> 'environment'
      and capture_work.merchant_id = target_provider_identity ->> 'merchantId'
      and capture_work.terminal_id = target_provider_identity ->> 'terminalId'
      and (capture_work.state = 'complete' or (capture_work.state = 'processing' and capture_work.lease_expires_at <= clock_timestamp()))
      and not exists (select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id = requests.id)
    -- Existing execution evidence must progress beyond unavailable crash-window rows.
    order by case when capture_work.state = 'complete' or exists (
      select 1 from public.payment_provider_operations operations
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
      or ledger.executed_at >= (ledger.capture_execution_permit ->> 'notAfter')::timestamptz
      or ledger.executed_at < (source.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz then
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
        'providerReference', ledger.provider_reference) || case when ledger.current_outcome = 'succeeded'
          then jsonb_build_object('movementReference', ledger.movement_reference) else '{}'::jsonb end
    )));
  end loop;
  return results;
end;
$$;

ALTER FUNCTION "public"."claim_due_booking_request_captures"("target_limit" integer, "target_provider_identity" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."claim_due_booking_request_payment_required_expiries"("target_limit" integer, "target_provider_identity" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
        where confirmations.booking_request_id=work.booking_request_id and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=work.booking_request_id))
      and coalesce(expiry.state,'processing') not in ('complete','quarantined')
    order by evaluation_order,work.payment_required_deadline,work.booking_request_id
    limit target_limit
    for update of requests skip locked
  ) due);
end;
$$;

ALTER FUNCTION "public"."claim_due_booking_request_payment_required_expiries"("target_limit" integer, "target_provider_identity" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."claim_due_booking_request_releases"("target_limit" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."claim_due_booking_request_releases"("target_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."classify_booking_request_authorization_claim_persistence"("target_attempt_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare attempt public.booking_request_submission_attempts;
declare claim public.booking_request_authorization_claims;
begin
  select * into attempt
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id
  for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  select * into claim
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id
  for update;
  if not found then
    if attempt.state = 'authorizing' and attempt.payment_snapshot is null then
      return jsonb_build_object('status', 'absent');
    end if;
    return jsonb_build_object('status', 'unknown');
  end if;
  if exists (
    select 1
    from public.booking_request_authorization_reconciliation_outbox outbox
    where outbox.claim_id = claim.id
      and outbox.claim_generation = claim.generation
  ) and attempt.payment_snapshot is not null then
    return jsonb_build_object('status', 'persisted');
  end if;
  return jsonb_build_object('status', 'unknown');
end;
$$;

ALTER FUNCTION "public"."classify_booking_request_authorization_claim_persistence"("target_attempt_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."complete_booking_request_authorization_reconciliation"("target_claim_id" "uuid", "target_generation" integer, "target_state_revision" bigint, "target_lease_token" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare target_attempt_id uuid;
declare claim public.booking_request_authorization_claims;
declare outbox public.booking_request_authorization_reconciliation_outbox;
begin
  select claims.attempt_id into target_attempt_id
  from public.booking_request_authorization_claims claims
  where claims.id = target_claim_id;
  if target_attempt_id is null then
    return jsonb_build_object('status', 'conflict');
  end if;
  perform attempts.id
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id
  for update;
  if not found then
    return jsonb_build_object('status', 'conflict');
  end if;
  select * into claim
  from public.booking_request_authorization_claims claims
  where claims.id = target_claim_id
  for update;
  select * into outbox
  from public.booking_request_authorization_reconciliation_outbox rows
  where rows.claim_id = target_claim_id
    and rows.claim_generation = target_generation
  for update;
  if not found
    or claim.generation <> target_generation
    or claim.state_revision <> target_state_revision
    or not public.booking_request_claim_state_is_reconcilable(claim.state)
    or outbox.state <> 'pending'
    or outbox.lease_token is distinct from target_lease_token
    or outbox.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'conflict');
  end if;
  if claim.state = 'authorized' then
    perform public.finalize_booking_request_submission(
      claim.attempt_id, target_payment_snapshot
    );
  else
    perform public.save_booking_request_payment_snapshot(
      claim.attempt_id, target_payment_snapshot, target_provider_identity
    );
  end if;
  select * into claim
  from public.booking_request_authorization_claims claims
  where claims.id = target_claim_id;
  update public.booking_request_authorization_reconciliation_outbox rows
  set observed_state_revision = claim.state_revision,
    state = case
      when public.booking_request_claim_state_is_reconcilable(claim.state)
        then 'pending'
      else 'complete'
    end,
    lease_token = null,
    lease_expires_at = null,
    updated_at = clock_timestamp()
  where rows.claim_id = claim.id
    and rows.claim_generation = target_generation;
  return jsonb_build_object(
    'status', 'applied',
    'claimState', claim.state,
    'stateRevision', claim.state_revision
  );
end;
$$;

ALTER FUNCTION "public"."complete_booking_request_authorization_reconciliation"("target_claim_id" "uuid", "target_generation" integer, "target_state_revision" bigint, "target_lease_token" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."complete_booking_request_capture"("target_booking_request_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_provider_result" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.payment_provider_operations;
declare capture_identity public.booking_request_provider_operation_identities;
declare expected_permit jsonb;
declare expected_result jsonb;
declare capture_operation jsonb;
declare capture_movement jsonb;
declare movements jsonb;
declare captured_at text;
declare finalized_at timestamptz;
begin
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  if not found then raise exception 'Booking Request capture work is unavailable' using errcode = 'RC409'; end if;
  work := source.work;
  ledger := source.ledger;
  if ledger.id is null then raise exception 'Booking Request capture provider evidence is missing' using errcode = 'RC409'; end if;
  if (ledger.original_outcome in ('succeeded', 'indeterminate')) is not true
    or ledger.current_outcome is distinct from 'succeeded'
    or ledger.movement_reference is null
    or (ledger.original_outcome = 'indeterminate' and ledger.authoritative_outcome_at is null) then
    raise exception 'Booking Request successful Capture evidence is invalid' using errcode = 'RC409';
  end if;
  expected_result := jsonb_build_object('outcome', 'succeeded',
    'providerRequestId', ledger.provider_request_id, 'providerReference', ledger.provider_reference,
    'movementReference', ledger.movement_reference);
  if not (
    (work.state = 'complete' and target_lease_generation is null and target_lease_token is null and target_provider_result is null)
    or (target_lease_generation is not null and target_lease_token is not null
      and target_lease_generation = work.lease_generation
      and (
        (work.recovery_operation_id is null
          and target_lease_generation = (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint
          and target_lease_token::text = ledger.capture_execution_permit ->> 'leaseToken')
        or (work.state = 'processing' and work.recovery_operation_id = ledger.id
          and target_lease_token = work.lease_token
          and work.lease_generation > (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint)
      )
      and target_provider_result is not distinct from expected_result)
  ) then
    raise exception 'Booking Request capture lease or result is invalid' using errcode = 'RC409';
  end if;
  if work.state = 'processing' then
    expected_permit := source.binding || jsonb_build_object(
      'purpose', 'booking-request-capture', 'workId', work.booking_request_id,
      'leaseGeneration', work.lease_generation, 'leaseToken', work.lease_token,
      'notAfter', to_char(work.lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
    if work.recovery_operation_id is null and ledger.capture_execution_permit is distinct from expected_permit then
      raise exception 'Booking Request capture lease is stale' using errcode = 'RC409';
    end if;
  elsif work.state <> 'complete' then
    raise exception 'Booking Request capture work is not processing' using errcode = 'RC409';
  end if;
  if (work.recovery_operation_id is null and (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint is distinct from work.lease_generation)
    or (work.recovery_operation_id is not null and (work.recovery_operation_id <> ledger.id
      or work.lease_generation <= (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint))
    or (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint < 1
    or (ledger.capture_execution_permit ->> 'leaseToken')::uuid is null
    or ledger.executed_at >= (ledger.capture_execution_permit ->> 'notAfter')::timestamptz
    or ledger.executed_at < (source.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz then
    raise exception 'Booking Request capture occurrence is invalid' using errcode = 'RC409';
  end if;
  captured_at := to_char((case when ledger.original_outcome = 'indeterminate'
    then ledger.authoritative_outcome_at else ledger.executed_at end)
    at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  capture_operation := jsonb_build_object(
    'paymentLifecycleId', work.payment_lifecycle_id, 'kind', 'capture',
    'logicalOperationId', work.capture_logical_operation_id,
    'attemptId', work.capture_physical_attempt_id, 'status', 'succeeded',
    'amountFils', work.amount_fils, 'providerRequestId', ledger.provider_request_id,
    'providerReference', ledger.provider_reference, 'movementReference', ledger.movement_reference,
    'reconciliationRequired', false, 'retrySafe', false
  );
  capture_movement := jsonb_build_object(
    'kind', 'capture', 'logicalOperationId', work.capture_logical_operation_id,
    'attemptId', work.capture_physical_attempt_id, 'amountFils', work.amount_fils,
    'movementReference', ledger.movement_reference, 'recordedAt', captured_at
  );
  movements := jsonb_build_array(source.payment_snapshot #> '{movements,0}', capture_movement);
  select * into capture_identity from public.booking_request_provider_operation_identities identities
  where identities.attempt_id = work.attempt_id and identities.operation_kind = 'capture'
  for update of identities;
  if work.state = 'complete' then
    if source.payment_snapshot -> 'capture' is distinct from capture_operation
      or source.payment_snapshot -> 'movements' is distinct from movements
      or capture_identity.attempt_id is null
      or (capture_identity.provider, capture_identity.environment, capture_identity.merchant_id,
        capture_identity.terminal_id, capture_identity.provider_request_id,
        capture_identity.provider_reference, capture_identity.movement_reference) is distinct from
        (work.provider, work.environment, work.merchant_id, work.terminal_id,
        ledger.provider_request_id, ledger.provider_reference, ledger.movement_reference) then
      raise exception 'Completed Booking Request capture evidence is invalid' using errcode = 'RC409';
    end if;
  else
    insert into public.booking_request_provider_operation_identities (
      attempt_id, operation_kind, provider, environment, merchant_id, terminal_id,
      provider_request_id, provider_reference, movement_reference
    ) values (work.attempt_id, 'capture', work.provider, work.environment, work.merchant_id,
      work.terminal_id, ledger.provider_request_id, ledger.provider_reference, ledger.movement_reference);
    finalized_at := clock_timestamp();
    -- The existing work trigger validates uncaptured Authorization; both writes commit atomically.
    update public.booking_request_capture_work capture_work
    set state = 'complete', outcome = 'succeeded', completed_at = finalized_at,
      lease_token = null, lease_expires_at = null
    where capture_work.booking_request_id = work.booking_request_id;
    update public.booking_request_submission_attempts attempts
    set payment_snapshot = source.payment_snapshot || jsonb_build_object('capture', capture_operation, 'movements', movements),
      updated_at = finalized_at
    where attempts.id = work.attempt_id;
  end if;
  return jsonb_build_object('status', 'complete',
    'snapshot', source.binding || jsonb_build_object(
      'authorization', source.payment_snapshot -> 'authorization', 'capture', capture_operation, 'movements', movements),
    'expectation', source.binding || jsonb_build_object(
      'authorizationProviderResult', jsonb_build_object(
        'providerRequestId', source.payment_snapshot #>> '{authorization,providerRequestId}',
        'providerReference', source.payment_snapshot #>> '{authorization,providerReference}',
        'movementReference', source.payment_snapshot #>> '{authorization,movementReference}'),
      'captureProviderResult', expected_result - 'outcome',
      'authorizationRecordedAt', source.payment_snapshot #>> '{movements,0,recordedAt}',
      'captureRecordedAt', captured_at)
  );
end;
$$;

ALTER FUNCTION "public"."complete_booking_request_capture"("target_booking_request_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_provider_result" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_pending_booking_period_hold"("target_customer_user_id" "uuid", "target_profile_id" "uuid", "target_commitment_reference" "text", "requested_search" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform contexts.user_id
  from public.account_contexts contexts
  where contexts.user_id = target_customer_user_id
  for update;
  return public.create_pending_booking_period_hold_without_authorization_claim(
    target_customer_user_id, target_profile_id, target_commitment_reference,
    requested_search
  );
end;
$$;

ALTER FUNCTION "public"."create_pending_booking_period_hold"("target_customer_user_id" "uuid", "target_profile_id" "uuid", "target_commitment_reference" "text", "requested_search" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_pending_booking_period_hold_without_authorization_claim"("target_customer_user_id" "uuid", "target_profile_id" "uuid", "target_commitment_reference" "text", "requested_search" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare target_profile public.owner_application_cottage_profiles;
declare target_schedule_revision_id uuid;
declare selection jsonb;
declare resolved_selection jsonb;
declare resolved_selections jsonb := '[]'::jsonb;
declare selection_day date;
declare target_unit_kind public.cottage_inventory_unit_kind;
declare target_unit_id uuid;
declare target_price_iqd bigint;
declare target_start_time time without time zone;
declare target_end_time time without time zone;
declare target_starts_at timestamptz;
declare target_ends_at timestamptz;
declare access_ranges tstzmultirange := '{}'::tstzmultirange;
declare target_access_range tstzrange;
declare booking_period_commitment_id uuid := gen_random_uuid();
declare booking_price_iqd bigint := 0;
declare selected_item_count integer := 0;
declare occupied_shift_count integer := 0;
declare inserted_occupancy_count integer;
begin
  if target_customer_user_id is null
    or target_profile_id is null
    or target_commitment_reference is null
    or target_commitment_reference <> btrim(target_commitment_reference)
    or target_commitment_reference !~ '^[A-Z0-9][A-Z0-9-]{0,119}$' then
    raise exception 'Pending Hold input is invalid' using errcode = '22023';
  end if;
  perform public.validate_public_cottage_search(requested_search);
  if not exists (
    select 1
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    where contexts.user_id = target_customer_user_id
      and contexts.role = 'customer'::public.account_role
      and users.phone_confirmed_at is not null
  ) then
    raise exception 'A verified Customer is required' using errcode = '42501';
  end if;

  select * into target_profile
  from public.owner_application_cottage_profiles profiles
  where profiles.id = target_profile_id
  for update;
  if not found then
    raise exception 'Published Cottage was not found' using errcode = 'RC404';
  end if;
  target_schedule_revision_id := target_profile.current_shift_schedule_id;
  if target_schedule_revision_id is null
    or not public.is_cottage_publicly_discoverable(target_profile_id)
    or not exists (
      select 1
      from public.cottage_publication_snapshots publications
      where publications.id = target_profile.current_publication_id
        and publications.profile_id = target_profile.id
        and publications.capacity >= (requested_search ->> 'guests')::integer
        and (not requested_search ? 'governorate'
          or lower(publications.governorate) = lower(btrim(requested_search ->> 'governorate')))
        and (not requested_search ? 'area'
          or lower(publications.approximate_location) = lower(btrim(requested_search ->> 'area')))
        and array(
          select value
          from jsonb_array_elements_text(
            coalesce(requested_search -> 'amenities', '[]'::jsonb)
          ) values(value)
        ) <@ publications.amenities
    ) then
    raise exception 'Pending Hold selection is unavailable' using errcode = 'RC409';
  end if;

  for selection in
    select value
    from jsonb_array_elements(requested_search -> 'selections') selections(value)
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
      target_unit_kind,
      target_unit_id,
      selection_day
    );
    if target_unit_id is null
      or target_price_iqd is null
      or not coalesce(public.public_cottage_unit_is_available(
        target_schedule_revision_id,
        target_unit_kind,
        target_unit_id,
        selection_day
      ), false) then
      raise exception 'Pending Hold selection is unavailable' using errcode = 'RC409';
    end if;

    target_starts_at := (selection_day + target_start_time) at time zone 'Asia/Baghdad';
    target_ends_at := (
      selection_day + target_end_time
      + case when target_end_time < target_start_time then interval '1 day' else interval '0 days' end
    ) at time zone 'Asia/Baghdad';
    if target_unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      and exists (
        select 1
        from jsonb_array_elements(requested_search -> 'selections') next_selection(value)
        where value ->> 'kind' = 'full-day'
          and (value ->> 'serviceDay')::date = selection_day + 1
      ) then
      target_ends_at := (
        selection_day + 1 + target_start_time
      ) at time zone 'Asia/Baghdad';
    end if;
    target_access_range := tstzrange(target_starts_at, target_ends_at, '[)');
    access_ranges := access_ranges + tstzmultirange(target_access_range);
    resolved_selections := resolved_selections || jsonb_build_array(jsonb_build_object(
      'serviceDay', selection_day,
      'unitKind', target_unit_kind,
      'unitId', target_unit_id,
      'priceIqd', target_price_iqd
    ));
    booking_price_iqd := booking_price_iqd + target_price_iqd;
    selected_item_count := selected_item_count + 1;
  end loop;

  begin
    insert into public.cottage_booking_period_commitments (
      id, customer_user_id, profile_id, schedule_revision_id,
      commitment_reference, status, access_ranges
    ) values (
      booking_period_commitment_id,
      target_customer_user_id,
      target_profile_id,
      target_schedule_revision_id,
      target_commitment_reference,
      'pending_hold',
      access_ranges
    );
  exception when exclusion_violation then
    raise exception 'The Customer already has an overlapping active Booking Period'
      using errcode = 'RC409';
  end;

  for resolved_selection in
    select value
    from jsonb_array_elements(resolved_selections) selections(value)
  loop
    selection_day := (resolved_selection ->> 'serviceDay')::date;
    target_unit_kind :=
      (resolved_selection ->> 'unitKind')::public.cottage_inventory_unit_kind;
    target_unit_id := (resolved_selection ->> 'unitId')::uuid;
    target_price_iqd := (resolved_selection ->> 'priceIqd')::bigint;
    insert into public.cottage_inventory_commitments (
      booking_period_commitment_id, unit_kind, unit_id,
      service_day, committed_price_iqd
    ) values (
      booking_period_commitment_id, target_unit_kind, target_unit_id,
      selection_day, target_price_iqd
    );
    begin
      if target_unit_kind = 'shift'::public.cottage_inventory_unit_kind then
        insert into public.cottage_booking_period_occupancies (
          booking_period_commitment_id, schedule_revision_id, shift_id, service_day
        ) values (
          booking_period_commitment_id, target_schedule_revision_id,
          target_unit_id, selection_day
        );
        occupied_shift_count := occupied_shift_count + 1;
      else
        insert into public.cottage_booking_period_occupancies (
          booking_period_commitment_id, schedule_revision_id, shift_id, service_day
        )
        select booking_period_commitment_id, target_schedule_revision_id,
          shifts.id, selection_day
        from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
        order by shifts.position;
        get diagnostics inserted_occupancy_count = row_count;
        occupied_shift_count := occupied_shift_count + inserted_occupancy_count;
      end if;
    exception when unique_violation then
      raise exception 'Pending Hold selection is unavailable' using errcode = 'RC409';
    end;
  end loop;

  return jsonb_build_object(
    'bookingPeriodCommitmentId', booking_period_commitment_id,
    'commitmentReference', target_commitment_reference,
    'status', 'pending_hold',
    'bookingPriceIqd', booking_price_iqd,
    'selectedItemCount', selected_item_count,
    'occupiedShiftCount', occupied_shift_count
  );
end;
$_$;

ALTER FUNCTION "public"."create_pending_booking_period_hold_without_authorization_claim"("target_customer_user_id" "uuid", "target_profile_id" "uuid", "target_commitment_reference" "text", "requested_search" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."dequeue_booking_request_authorization_reconciliation"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare attempt public.booking_request_submission_attempts;
declare claim public.booking_request_authorization_claims;
declare leased_outbox public.booking_request_authorization_reconciliation_outbox;
declare worker_lease_token uuid := gen_random_uuid();
declare lease_started_at timestamptz := clock_timestamp();
declare leased_until timestamptz := lease_started_at + interval '30 seconds';
declare operation jsonb;
declare operation_kind text;
declare recovery_action text;
declare next_release_attempt integer;
declare retry_snapshot jsonb;
begin
  select attempts.* into attempt
  from public.booking_request_submission_attempts attempts
  join public.booking_request_authorization_claims claims
    on claims.attempt_id = attempts.id
  join public.booking_request_authorization_reconciliation_outbox outbox
    on outbox.claim_id = claims.id
    and outbox.claim_generation = claims.generation
  where outbox.state = 'pending'
    and (outbox.lease_expires_at is null
      or outbox.lease_expires_at <= clock_timestamp())
    and public.booking_request_claim_state_is_reconcilable(claims.state)
  order by outbox.updated_at, outbox.claim_id
  for update of attempts skip locked
  limit 1;
  if not found then
    return jsonb_build_object('status', 'empty');
  end if;

  select * into claim
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = attempt.id
  for update;
  select * into leased_outbox
  from public.booking_request_authorization_reconciliation_outbox rows
  where rows.claim_id = claim.id
    and rows.claim_generation = claim.generation
  for update;
  if not found
    or leased_outbox.state <> 'pending'
    or (leased_outbox.lease_expires_at is not null
      and leased_outbox.lease_expires_at > clock_timestamp())
    or not public.booking_request_claim_state_is_reconcilable(claim.state) then
    return jsonb_build_object('status', 'empty');
  end if;

  if claim.state = 'authorized' then
    operation := attempt.payment_snapshot -> 'authorization';
    operation_kind := 'finalization';
  else
    operation := nullif(attempt.payment_snapshot -> 'release', 'null'::jsonb);
    if operation is null then
      operation := attempt.payment_snapshot -> 'authorization';
      operation_kind := 'authorization';
    else
      operation_kind := 'release';
    end if;
  end if;

  if operation_kind = 'release'
    and operation ->> 'status' = 'failed'
    and (operation ->> 'retrySafe')::boolean then
    next_release_attempt :=
      substring(operation ->> 'attemptId' from ':attempt-([1-9][0-9]*)$')::integer
      + 1;
    retry_snapshot := attempt.payment_snapshot || jsonb_build_object(
      'release', operation || jsonb_build_object(
        'attemptId', operation ->> 'logicalOperationId'
          || ':attempt-' || next_release_attempt::text,
        'status', 'pending',
        'providerRequestId', null,
        'providerReference', null,
        'movementReference', null,
        'reconciliationRequired', false,
        'retrySafe', false
      )
    );
    perform public.save_booking_request_payment_snapshot(
      claim.attempt_id,
      retry_snapshot,
      jsonb_build_object(
        'provider', claim.provider,
        'environment', claim.environment,
        'merchantId', claim.merchant_id,
        'terminalId', claim.terminal_id
      )
    );
    select * into attempt
    from public.booking_request_submission_attempts attempts
    where attempts.id = claim.attempt_id;
    select * into claim
    from public.booking_request_authorization_claims claims
    where claims.attempt_id = attempt.id;
    select * into leased_outbox
    from public.booking_request_authorization_reconciliation_outbox rows
    where rows.claim_id = claim.id
      and rows.claim_generation = claim.generation;
    operation := attempt.payment_snapshot -> 'release';
  end if;
  if operation is null
    or operation_kind = 'finalization' and operation ->> 'status' <> 'succeeded'
    or operation_kind <> 'finalization' and operation ->> 'status' <> 'pending' then
    return jsonb_build_object('status', 'empty');
  end if;

  recovery_action := case
    when operation_kind = 'finalization' then 'finalize'
    when (operation ->> 'reconciliationRequired')::boolean then 'query'
    else 'execute'
  end;

  update public.booking_request_authorization_reconciliation_outbox rows
  set lease_token = worker_lease_token,
    lease_expires_at = leased_until,
    updated_at = lease_started_at
  where rows.claim_id = claim.id;

  return jsonb_build_object(
    'status', 'work',
    'claimId', claim.id,
    'generation', claim.generation,
    'stateRevision', claim.state_revision,
    'leaseToken', worker_lease_token,
    'leaseExpiresAt', to_char(
      leased_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'operationKind', operation_kind,
    'recoveryAction', recovery_action,
    'paymentLifecycleId', claim.payment_lifecycle_id,
    'logicalOperationId', operation ->> 'logicalOperationId',
    'physicalAttemptId', operation ->> 'attemptId',
    'amountFils', claim.amount_fils,
    'currency', claim.currency,
    'providerIdentity', jsonb_build_object(
      'provider', claim.provider,
      'environment', claim.environment,
      'merchantId', claim.merchant_id,
      'terminalId', claim.terminal_id
    ),
    'providerIdempotencyKey', claim.provider_idempotency_key,
    'notAfter', to_char(
      claim.not_after at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'paymentSnapshot', attempt.payment_snapshot
  );
end;
$_$;

ALTER FUNCTION "public"."dequeue_booking_request_authorization_reconciliation"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."due_booking_request_payment_recoveries"("target_limit" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if current_setting('role',true) <> 'service_role' or target_limit is null or target_limit < 1 or target_limit > 50 then
    raise exception 'Recovery batch is unavailable' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(id),'[]'::jsonb) from (
    select attempts.id from public.booking_request_payment_recovery_attempts attempts
    join public.booking_requests requests on requests.id=attempts.booking_request_id
    where not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=attempts.booking_request_id and expiry.state='quarantined') and requests.status='accepted' and
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

ALTER FUNCTION "public"."due_booking_request_payment_recoveries"("target_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."enforce_booking_request_capture_work"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."enforce_booking_request_capture_work"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."enforce_booking_request_payment_required"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if old.state = 'payment_required' and new is distinct from old then
    raise exception 'Payment Required capture work is immutable' using errcode = 'RC204';
  end if;
  if old.state <> 'processing' or new.state <> 'payment_required'
    or (to_jsonb(new) - array['state','outcome','completed_at','payment_required_recorded_at','payment_required_deadline'])
      is distinct from
      (to_jsonb(old) - array['state','outcome','completed_at','payment_required_recorded_at','payment_required_deadline'])
    or new.outcome <> 'failed'
    or new.completed_at is distinct from new.payment_required_recorded_at
    or new.payment_required_recorded_at is distinct from date_trunc('milliseconds', new.payment_required_recorded_at)
    or new.payment_required_deadline is distinct from new.payment_required_recorded_at + interval '20 minutes' then
    raise exception 'Payment Required capture transition is invalid' using errcode = 'RC204';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."enforce_booking_request_payment_required"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."enforce_booking_request_release_operation_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."enforce_booking_request_release_operation_transition"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."enforce_cottage_booking_period_commitment_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    (old.status='confirmed_booking' and new.status='pending_hold'
      and exists(select 1 from public.booking_request_confirmation_invalidations invalidation
        join public.booking_requests requests on requests.id=invalidation.booking_request_id
        join public.booking_request_payment_required_expiry_work expiry on expiry.id=invalidation.expiry_work_id
        where requests.booking_period_commitment_id=old.id and expiry.state in ('processing','quarantined')))
    or (
    old.status = 'pending_hold'::public.cottage_inventory_commitment_status
    and new.status in (
      'confirmed_booking'::public.cottage_inventory_commitment_status,
      'released_hold'::public.cottage_inventory_commitment_status
    )
  )) then
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

ALTER FUNCTION "public"."enforce_cottage_booking_period_commitment_transition"() OWNER TO "postgres";






CREATE OR REPLACE FUNCTION "public"."expire_booking_request_authorization_claims"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare candidate record;
declare attempt public.booking_request_submission_attempts;
declare claim public.booking_request_authorization_claims;
declare authorization_ledger public.payment_provider_operations;
declare release_ledger public.payment_provider_operations;
declare authorization_found boolean;
declare release_found boolean;
declare authorization_snapshot jsonb;
declare release_snapshot jsonb;
declare reconciled_snapshot jsonb;
declare provider_identity jsonb;
declare recorded_at text;
declare expired_count integer := 0;
begin
  for candidate in
    select attempts.id as attempt_id, claims.id as claim_id
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    where public.booking_request_claim_state_is_active(claims.state)
      and claims.reconciliation_expires_at <= statement_timestamp()
    order by attempts.id
    for update of attempts skip locked
  loop
    select * into attempt
    from public.booking_request_submission_attempts attempts
    where attempts.id = candidate.attempt_id
    for update;
    select * into claim
    from public.booking_request_authorization_claims claims
    where claims.id = candidate.claim_id
      and public.booking_request_claim_state_is_active(claims.state)
      and claims.reconciliation_expires_at <= statement_timestamp()
    for update;
    if not found then continue; end if;

    authorization_snapshot := attempt.payment_snapshot -> 'authorization';
    release_snapshot := nullif(attempt.payment_snapshot -> 'release', 'null'::jsonb);
    provider_identity := jsonb_build_object(
      'provider', claim.provider,
      'environment', claim.environment,
      'merchantId', claim.merchant_id,
      'terminalId', claim.terminal_id
    );
    select * into authorization_ledger
    from public.payment_provider_operations operations
    where operations.claim_id = claim.id
      and operations.claim_generation = claim.generation
      and operations.operation_kind = 'authorization'
    for update;
    authorization_found := found;

    if authorization_found and authorization_ledger.current_outcome is null then continue; end if;
    if not authorization_found or authorization_ledger.current_outcome='not-executed' then
      if claim.state in ('starting', 'reconciliation_required')
        and authorization_snapshot ->> 'status' = 'pending'
        and authorization_snapshot -> 'providerRequestId' = 'null'::jsonb
        and authorization_snapshot -> 'providerReference' = 'null'::jsonb
        and release_snapshot is null then
        update public.booking_request_submission_attempts attempts
        set state = 'expired', updated_at = statement_timestamp()
        where attempts.id = claim.attempt_id;
        update public.booking_request_authorization_claims claims
        set state = 'expired', state_revision = state_revision + 1,
          updated_at = statement_timestamp()
        where claims.id = claim.id;
        update public.booking_request_authorization_claim_occupancies occupancies
        set active = false
        where occupancies.claim_id = claim.id and occupancies.active;
        update public.booking_request_authorization_reconciliation_outbox outbox
        set state = 'complete', observed_state_revision = claim.state_revision + 1,
          lease_token = null, lease_expires_at = null,
          updated_at = statement_timestamp()
        where outbox.claim_id = claim.id;
        expired_count := expired_count + 1;
      end if;
      continue;
    end if;

    if authorization_ledger.provider <> claim.provider
      or authorization_ledger.environment <> claim.environment
      or authorization_ledger.merchant_id <> claim.merchant_id
      or authorization_ledger.terminal_id <> claim.terminal_id
      or authorization_ledger.payment_lifecycle_id <> claim.payment_lifecycle_id
      or authorization_ledger.logical_operation_id <> claim.logical_operation_id
      or authorization_ledger.physical_attempt_id <> claim.physical_attempt_id
      or authorization_ledger.amount_fils <> claim.amount_fils
      or authorization_ledger.currency <> claim.currency
      or authorization_ledger.current_outcome = 'indeterminate' then
      continue;
    end if;

    if authorization_ledger.current_outcome = 'failed' then
      if authorization_snapshot ->> 'status' = 'pending'
        and release_snapshot is null then
        reconciled_snapshot := attempt.payment_snapshot || jsonb_build_object(
          'authorization', authorization_snapshot || jsonb_build_object(
            'status', 'failed',
            'providerRequestId', authorization_ledger.provider_request_id,
            'providerReference', authorization_ledger.provider_reference,
            'movementReference', null,
            'reconciliationRequired', false,
            'retrySafe', false
          ),
          'movements', '[]'::jsonb
        );
        perform public.save_booking_request_payment_snapshot(
          claim.attempt_id, reconciled_snapshot, provider_identity
        );
        expired_count := expired_count + 1;
      end if;
      continue;
    end if;

    if authorization_ledger.movement_reference is null then
      continue;
    end if;
    if authorization_snapshot ->> 'status' <> 'succeeded' then
      if authorization_snapshot ->> 'status' <> 'pending'
        or release_snapshot is not null then
        continue;
      end if;
      recorded_at := to_char(
        authorization_ledger.updated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      );
      reconciled_snapshot := attempt.payment_snapshot || jsonb_build_object(
        'authorization', authorization_snapshot || jsonb_build_object(
          'status', 'succeeded',
          'providerRequestId', authorization_ledger.provider_request_id,
          'providerReference', authorization_ledger.provider_reference,
          'movementReference', authorization_ledger.movement_reference,
          'reconciliationRequired', false,
          'retrySafe', false
        ),
        'movements', jsonb_build_array(jsonb_build_object(
          'kind', 'authorization',
          'logicalOperationId', authorization_snapshot ->> 'logicalOperationId',
          'attemptId', authorization_snapshot ->> 'attemptId',
          'amountFils', claim.amount_fils,
          'movementReference', authorization_ledger.movement_reference,
          'recordedAt', recorded_at
        ))
      );
      perform public.save_booking_request_payment_snapshot(
        claim.attempt_id, reconciled_snapshot, provider_identity
      );
      select * into attempt
      from public.booking_request_submission_attempts attempts
      where attempts.id = claim.attempt_id;
      select * into claim
      from public.booking_request_authorization_claims claims
      where claims.id = claim.id;
      authorization_snapshot := attempt.payment_snapshot -> 'authorization';
      release_snapshot := nullif(attempt.payment_snapshot -> 'release', 'null'::jsonb);
    end if;

    if release_snapshot is null then
      if (public.booking_request_policy_at(
        (attempt.quote_payload -> 'items' -> 0 ->> 'startsAt')::timestamptz,
        clock_timestamp()
      ) ->> 'insideCutoff')::boolean then
        reconciled_snapshot := attempt.payment_snapshot || jsonb_build_object(
          'release', jsonb_build_object(
            'paymentLifecycleId', claim.payment_lifecycle_id,
            'kind', 'release',
            'logicalOperationId', claim.payment_lifecycle_id::text || ':release',
            'attemptId', claim.payment_lifecycle_id::text || ':release:attempt-1',
            'status', 'pending',
            'amountFils', claim.amount_fils,
            'providerRequestId', null,
            'providerReference', null,
            'movementReference', null,
            'reconciliationRequired', false,
            'retrySafe', false
          )
        );
        perform public.save_booking_request_payment_snapshot(
          claim.attempt_id, reconciled_snapshot, provider_identity
        );
        continue;
      end if;
      perform public.finalize_booking_request_submission(
        claim.attempt_id, attempt.payment_snapshot
      );
      expired_count := expired_count + 1;
      continue;
    end if;

    select * into release_ledger
    from public.payment_provider_operations operations
    where operations.claim_id = claim.id
      and operations.claim_generation = claim.generation
      and operations.operation_kind = 'release'
      and operations.logical_operation_id = release_snapshot ->> 'logicalOperationId'
      and operations.physical_attempt_id = release_snapshot ->> 'attemptId'
    for update;
    release_found := found;
    if not release_found
      or release_ledger.current_outcome <> 'succeeded'
      or release_ledger.movement_reference is null
      or release_ledger.provider <> claim.provider
      or release_ledger.environment <> claim.environment
      or release_ledger.merchant_id <> claim.merchant_id
      or release_ledger.terminal_id <> claim.terminal_id
      or release_ledger.payment_lifecycle_id <> claim.payment_lifecycle_id
      or release_ledger.logical_operation_id
        <> claim.payment_lifecycle_id::text || ':release'
      or release_ledger.amount_fils <> claim.amount_fils
      or release_ledger.currency <> claim.currency then
      continue;
    end if;
    recorded_at := to_char(
      release_ledger.updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    reconciled_snapshot := attempt.payment_snapshot || jsonb_build_object(
      'release', release_snapshot || jsonb_build_object(
        'status', 'succeeded',
        'providerRequestId', release_ledger.provider_request_id,
        'providerReference', release_ledger.provider_reference,
        'movementReference', release_ledger.movement_reference,
        'reconciliationRequired', false,
        'retrySafe', false
      ),
      'movements', (attempt.payment_snapshot -> 'movements') ||
        jsonb_build_array(jsonb_build_object(
          'kind', 'release',
          'logicalOperationId', release_snapshot ->> 'logicalOperationId',
          'attemptId', release_snapshot ->> 'attemptId',
          'amountFils', claim.amount_fils,
          'movementReference', release_ledger.movement_reference,
          'recordedAt', recorded_at
        ))
    );
    perform public.save_booking_request_payment_snapshot(
      claim.attempt_id, reconciled_snapshot, provider_identity
    );
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;

ALTER FUNCTION "public"."expire_booking_request_authorization_claims"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."finalize_booking_request_confirmation"("target_booking_request_id" "uuid", "target_capture_snapshot" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare capture_result jsonb;
declare target_request public.booking_requests;
declare target_attempt public.booking_request_submission_attempts;
declare target_claim public.booking_request_authorization_claims;
declare target_snapshot public.booking_snapshots;
declare target_commitment public.cottage_booking_period_commitments;
declare target_capture public.payment_provider_operations;
declare existing_confirmation public.booking_confirmations;
declare customer_receipt public.booking_receipts;
declare owner_receipt public.booking_receipts;
declare created_confirmation public.booking_confirmations;
declare outcome_time timestamptz;
begin
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  if current_setting('role', true) <> 'service_role' then
    raise exception 'Booking Request confirmation is unavailable' using errcode = '42501';
  end if;
  if exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=target_booking_request_id) then return jsonb_build_object('status','correction-required'); end if;
  if target_capture_snapshot ->> 'purpose' = 'booking-request-payment-recovery' then
    target_capture_snapshot := public.validate_booking_request_payment_recovery_confirmation(
      target_booking_request_id, target_capture_snapshot
    );
  else
    capture_result := public.complete_booking_request_capture(
      target_booking_request_id, null, null, null
    );
    if capture_result -> 'snapshot' is distinct from target_capture_snapshot then
      raise exception 'Booking Request confirmation Capture evidence is invalid'
        using errcode = 'RC409';
    end if;
  end if;

  select * into target_request from public.booking_requests requests
  where requests.id = target_booking_request_id;
  select * into target_attempt from public.booking_request_submission_attempts attempts
  where attempts.id = (target_capture_snapshot ->> 'submissionAttemptId')::uuid;
  select * into target_claim from public.booking_request_authorization_claims claims
  where claims.id = (target_capture_snapshot ->> 'authorizationClaimId')::uuid;
  select * into target_snapshot from public.booking_snapshots snapshots
  where snapshots.id = target_request.booking_snapshot_id;
  select * into target_commitment from public.cottage_booking_period_commitments commitments
  where commitments.id = target_request.booking_period_commitment_id
  for update of commitments;
  select * into target_capture from public.payment_provider_operations operations
  where operations.claim_id = target_claim.id
    and operations.claim_generation = target_claim.generation
    and operations.operation_kind = 'capture'
    and operations.physical_attempt_id = target_capture_snapshot ->> 'capturePhysicalAttemptId'
  for update of operations;
  perform 1 from public.cottage_inventory_commitments inventory
  where inventory.booking_period_commitment_id = target_commitment.id
  order by inventory.service_day, inventory.unit_kind, inventory.unit_id
  for update of inventory;
  perform 1 from public.cottage_booking_period_occupancies occupancies
  where occupancies.booking_period_commitment_id = target_commitment.id
  order by occupancies.service_day, occupancies.shift_id
  for update of occupancies;

  if target_request.id is null
    or target_request.status <> 'accepted'
    or target_attempt.id is null
    or target_attempt.booking_request_id is distinct from target_request.id
    or target_claim.id is null
    or target_claim.attempt_id is distinct from target_attempt.id
    or target_snapshot.id is null
    or (target_snapshot.customer_user_id, target_snapshot.profile_id,
      target_snapshot.quote_fingerprint, target_snapshot.intent_fingerprint,
      target_snapshot.quote_payload, target_snapshot.intent_payload) is distinct from
      (target_request.customer_user_id, target_request.profile_id,
      target_attempt.quote_fingerprint, target_attempt.intent_fingerprint,
      target_attempt.quote_payload, target_attempt.intent_payload)
    or target_commitment.id is null
    or (target_commitment.customer_user_id, target_commitment.profile_id,
      target_commitment.schedule_revision_id) is distinct from
      (target_request.customer_user_id, target_request.profile_id,
      target_claim.schedule_revision_id)
    or target_claim.customer_user_id is distinct from target_request.customer_user_id
    or target_claim.profile_id is distinct from target_request.profile_id
    or target_claim.access_ranges is distinct from target_commitment.access_ranges
    or target_request.owner_user_id is distinct from (
      select profiles.owner_user_id
      from public.owner_application_cottage_profiles profiles
      where profiles.id = target_request.profile_id
    )
    or (target_snapshot.quote_payload ->> 'bookingPriceIqd')::bigint * 1000
      is distinct from (target_attempt.payment_snapshot ->> 'bookingPriceFils')::bigint
    or (target_snapshot.quote_payload ->> 'customerTotalIqd')::bigint * 1000
      is distinct from (target_capture_snapshot ->> 'amountFils')::bigint
    or (target_attempt.payment_snapshot ->> 'customerTotalFils')::bigint
      is distinct from (target_capture_snapshot ->> 'amountFils')::bigint
    or target_capture.id is null
    or target_capture.movement_reference
      is distinct from target_capture_snapshot #>> '{capture,movementReference}'
    or not exists (
      select 1 from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
    )
    or not exists (
      select 1 from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
    )
    or exists (
      select claim_items.unit_kind, claim_items.unit_id,
        claim_items.service_day, claim_items.price_iqd
      from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
      except
      select inventory.unit_kind, inventory.unit_id,
        inventory.service_day, inventory.committed_price_iqd
      from public.cottage_inventory_commitments inventory
      where inventory.booking_period_commitment_id = target_commitment.id
    )
    or exists (
      select inventory.unit_kind, inventory.unit_id,
        inventory.service_day, inventory.committed_price_iqd
      from public.cottage_inventory_commitments inventory
      where inventory.booking_period_commitment_id = target_commitment.id
      except
      select claim_items.unit_kind, claim_items.unit_id,
        claim_items.service_day, claim_items.price_iqd
      from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
    )
    or exists (
      select claim_occupancies.schedule_revision_id,
        claim_occupancies.shift_id, claim_occupancies.service_day
      from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
      except
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
    )
    or exists (
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
      except
      select claim_occupancies.schedule_revision_id,
        claim_occupancies.shift_id, claim_occupancies.service_day
      from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
    )
    or exists (
      select target_claim.schedule_revision_id, expected.shift_id,
        claim_items.service_day
      from public.booking_request_authorization_claim_items claim_items
      cross join lateral (
        select claim_items.unit_id as shift_id
        where claim_items.unit_kind = 'shift'
        union all
        select shifts.id
        from public.cottage_shifts shifts
        where claim_items.unit_kind = 'full_day_bundle'
          and shifts.schedule_revision_id = target_claim.schedule_revision_id
      ) expected
      where claim_items.claim_id = target_claim.id
      except
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
    )
    or exists (
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
      except
      select target_claim.schedule_revision_id, expected.shift_id,
        claim_items.service_day
      from public.booking_request_authorization_claim_items claim_items
      cross join lateral (
        select claim_items.unit_id as shift_id
        where claim_items.unit_kind = 'shift'
        union all
        select shifts.id
        from public.cottage_shifts shifts
        where claim_items.unit_kind = 'full_day_bundle'
          and shifts.schedule_revision_id = target_claim.schedule_revision_id
      ) expected
      where claim_items.claim_id = target_claim.id
    )
    or exists (
      select 1 from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and not occupancies.active
    )
    or exists (
      select 1 from public.booking_request_release_work release_work
      where release_work.booking_request_id = target_request.id
    ) then
    raise exception 'Booking Request confirmation source graph is invalid'
      using errcode = 'RC409';
  end if;

  select * into existing_confirmation from public.booking_confirmations confirmations
  where confirmations.booking_request_id = target_request.id
  for update of confirmations;
  if existing_confirmation.id is not null then
    select * into customer_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'customer';
    select * into owner_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'cottage_owner';
    if (existing_confirmation.booking_snapshot_id,
      existing_confirmation.booking_period_commitment_id,
      existing_confirmation.capture_operation_id) is distinct from
      (target_snapshot.id, target_commitment.id, target_capture.id)
      or target_commitment.status <> 'confirmed_booking'
      or customer_receipt.id is null
      or owner_receipt.id is null
      or (customer_receipt.booking_snapshot_id, customer_receipt.recipient_user_id,
        customer_receipt.created_at) is distinct from
        (target_snapshot.id, target_request.customer_user_id,
        existing_confirmation.confirmed_at)
      or (owner_receipt.booking_snapshot_id, owner_receipt.recipient_user_id,
        owner_receipt.created_at) is distinct from
        (target_snapshot.id, target_request.owner_user_id,
        existing_confirmation.confirmed_at)
      or (select count(*) from public.booking_receipts receipts
        where receipts.booking_confirmation_id = existing_confirmation.id) <> 2 then
      raise exception 'Stored Booking Request confirmation is incomplete'
        using errcode = 'RC409';
    end if;
  else
    if target_commitment.status <> 'pending_hold' then
      raise exception 'Booking Request confirmation commitment is invalid'
        using errcode = 'RC409';
    end if;
    outcome_time := clock_timestamp();
    insert into public.booking_confirmations (
      booking_request_id, booking_snapshot_id, booking_period_commitment_id,
      capture_operation_id, confirmed_at
    ) values (
      target_request.id, target_snapshot.id, target_commitment.id,
      target_capture.id, outcome_time
    ) returning * into created_confirmation;
    update public.cottage_booking_period_commitments commitments
    set status = 'confirmed_booking'
    where commitments.id = target_commitment.id;
    insert into public.booking_receipts (
      booking_confirmation_id, booking_snapshot_id, recipient_role,
      recipient_user_id, created_at
    ) values
      (created_confirmation.id, target_snapshot.id, 'customer',
        target_request.customer_user_id, outcome_time),
      (created_confirmation.id, target_snapshot.id, 'cottage_owner',
        target_request.owner_user_id, outcome_time);
    existing_confirmation := created_confirmation;
    select * into customer_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'customer';
    select * into owner_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'cottage_owner';
  end if;

  return jsonb_build_object(
    'bookingRequestId', target_request.id,
    'commitmentId', target_commitment.id,
    'bookingReference', target_commitment.commitment_reference,
    'confirmedAt', to_char(existing_confirmation.confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'capturePhysicalAttemptId', target_capture.physical_attempt_id,
    'captureMovementReference', target_capture.movement_reference,
    'receipts', jsonb_build_object(
      'customer', jsonb_build_object(
        'id', customer_receipt.id, 'recipientId', customer_receipt.recipient_user_id
      ),
      'cottageOwner', jsonb_build_object(
        'id', owner_receipt.id, 'recipientId', owner_receipt.recipient_user_id
      )
    )
  );
end;
$$;

ALTER FUNCTION "public"."finalize_booking_request_confirmation"("target_booking_request_id" "uuid", "target_capture_snapshot" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."finalize_booking_request_payment_required_expiry"("target_booking_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    return jsonb_build_object('status',case when prepared->>'status' in ('release','refund') then 'processing'
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
    perform public.quarantine_booking_request_payment(request.id,'inventory-evidence-invalid');
    return jsonb_build_object('status','quarantined','bookingRequestId',request.id);
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

ALTER FUNCTION "public"."finalize_booking_request_payment_required_expiry"("target_booking_request_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."finalize_booking_request_release"("target_work_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."finalize_booking_request_release"("target_work_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."finalize_booking_request_submission"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

  current_quote := public.get_public_booking_quote_with_fingerprint(
    attempt.locale, attempt.public_slug, attempt.requested_search
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
    current_quote ->> 'termsVersion',
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

  return jsonb_build_object(
    'status', 'pending',
    'bookingRequestReference', request_reference,
    'responseDeadline', to_char(
      response_deadline at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
end;
$$;

ALTER FUNCTION "public"."finalize_booking_request_submission"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_administrator_booking_request_payment_history"("target_reference" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare request public.booking_requests;
declare events jsonb;
declare expiry public.booking_request_payment_required_expiry_work;
begin
  if public.is_platform_administrator('aal2') is not true then
    raise exception 'AAL2 Platform Administrator access is required' using errcode='42501';
  end if;
  select * into request from public.booking_requests requests where requests.booking_request_reference=target_reference;
  if request.id is null then return null; end if;
  select * into expiry from public.booking_request_payment_required_expiry_work work where work.booking_request_id=request.id;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id',history.id,'kind',history.kind,'source',history.source,'provenance',history.provenance,
    'operationKind',history.operation_kind,'logicalOperationId',case when history.logical_operation_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(authorization|capture|release|original-release|replacement-authorization|replacement-capture|replacement-release(:[1-9][0-9]*)?|corrective-refund:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then history.logical_operation_id when history.logical_operation_id is not null then 'reference-unavailable' end,
    'physicalAttemptId',case when history.physical_attempt_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:((authorization|capture|release):attempt-[1-9][0-9]*|(original-release|replacement-authorization|replacement-capture|replacement-release(:[1-9][0-9]*)?|corrective-refund:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):[1-9][0-9]*)$' then history.physical_attempt_id when history.physical_attempt_id is not null then 'reference-unavailable' end,'operationGeneration',history.operation_generation,
    'recoveryGeneration',history.recovery_generation,'fromState',history.from_state,'toState',history.to_state,
    'outcome',history.outcome,
    'reasonCode',case when history.reason_code in ('replacement-capture-succeeded','source-evidence-invalid','capture-occurrence-unknown','original-capture-unresolved','recovery-evidence-invalid','unexplained-recovery-provider-operation','recovery-operation-indeterminate','corrective-capture-invalid','unexplained-provider-operation','original-release-indeterminate','original-release-failed','replacement-authorization-invalid','replacement-release-indeterminate','replacement-release-failed','expiry-evidence-invalid','expiry-release-failed','expiry-release-indeterminate','expiry-refund-failed','expiry-refund-indeterminate','inventory-evidence-invalid','legacy-unresolved-money','legacy-confirmation-evidence-invalid','unsafe-recovery-original-release-indeterminate','unsafe-recovery-original-release-failed','unsafe-recovery-replacement-authorization-indeterminate','unsafe-recovery-replacement-capture-indeterminate','unsafe-recovery-replacement-release-indeterminate','unsafe-recovery-replacement-release-failed','cottage_unavailable','cannot_accommodate_request','other','capture-failed','payment-required-expired','late-capture','conflicting-evidence','unresolved-evidence','conflicting-provider-observation','unresolved-provider-observation','failed-release-observation','failed-refund-observation','malformed-provider-observation') then history.reason_code when history.reason_code is not null then 'unclassified-evidence' end,
    'providerOperationId',history.provider_operation_id,
    'providerRequestId',case when history.provider_request_id ~ '^sim(-capture|-recovery|-expiry)?-request-([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then history.provider_request_id when history.provider_request_id is not null and exists(select 1 from public.payment_provider_observations accepted where accepted.operation_id=support_operation.id and accepted.result->>'providerRequestId'=history.provider_request_id) then 'internal-request:'||support_operation.id when history.provider_request_id is not null then 'reference-unavailable' end,
    'providerReference',case when history.provider_reference ~ '^sim(-capture|-recovery|-expiry)?-reference-([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then history.provider_reference when history.provider_reference is not null and exists(select 1 from public.payment_provider_observations accepted where accepted.operation_id=support_operation.id and accepted.result->>'providerReference'=history.provider_reference) then 'internal-reference:'||support_operation.id when history.provider_reference is not null then 'reference-unavailable' end,
    'movementReference',case when history.movement_reference ~ '^sim(-capture|-recovery|-expiry)?-movement-([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then history.movement_reference when history.movement_reference is not null and exists(select 1 from public.payment_provider_observations accepted where accepted.operation_id=support_operation.id and accepted.result->>'movementReference'=history.movement_reference) then 'internal-movement:'||support_operation.id when history.movement_reference is not null then 'reference-unavailable' end,
    'amountFils',history.amount_fils::text,'currency',case when history.amount_fils is not null then 'IQD' end,
    'providerOccurredAt',history.provider_occurred_at,'receivedAt',history.received_at,
    'sourceRecordedAt',history.source_recorded_at,'recordedAt',history.recorded_at
  )) order by history.sequence),'[]'::jsonb) into events
  from public.booking_request_payment_history history
  left join public.payment_provider_operations support_operation on support_operation.id=history.provider_operation_id
    and (history.booking_request_id is null or history.booking_request_id=request.id)
    and exists(select 1 from public.booking_request_authorization_claims claim
      join public.booking_request_submission_attempts attempt on attempt.id=claim.attempt_id
      where claim.id=support_operation.claim_id and attempt.booking_request_id=request.id)
  where history.payment_lifecycle_id=request.payment_lifecycle_id and history.source<>'history-boundary';
  return jsonb_build_object(
    'bookingRequestReference',request.booking_request_reference,'simulated',true,
    'current',jsonb_build_object('requestStatus',request.status,'paymentStatus',public.booking_request_payment_status(request),
      'expiryStatus',expiry.state,'reasonCode',case when coalesce(expiry.quarantine_reason,expiry.diagnostic_reason) in ('replacement-capture-succeeded','source-evidence-invalid','capture-occurrence-unknown','original-capture-unresolved','recovery-evidence-invalid','unexplained-recovery-provider-operation','recovery-operation-indeterminate','corrective-capture-invalid','unexplained-provider-operation','original-release-indeterminate','original-release-failed','replacement-authorization-invalid','replacement-release-indeterminate','replacement-release-failed','expiry-evidence-invalid','expiry-release-failed','expiry-release-indeterminate','expiry-refund-failed','expiry-refund-indeterminate','inventory-evidence-invalid','legacy-unresolved-money','legacy-confirmation-evidence-invalid','unsafe-recovery-original-release-indeterminate','unsafe-recovery-original-release-failed','unsafe-recovery-replacement-authorization-indeterminate','unsafe-recovery-replacement-capture-indeterminate','unsafe-recovery-replacement-release-indeterminate','unsafe-recovery-replacement-release-failed','cottage_unavailable','cannot_accommodate_request','other','capture-failed','payment-required-expired','late-capture','conflicting-evidence','unresolved-evidence','conflicting-provider-observation','unresolved-provider-observation','failed-release-observation','failed-refund-observation','malformed-provider-observation') then coalesce(expiry.quarantine_reason,expiry.diagnostic_reason) when coalesce(expiry.quarantine_reason,expiry.diagnostic_reason) is not null then 'unclassified-evidence' end,
      'paymentRequiredDeadline',to_jsonb((select work from public.booking_request_capture_work work where work.booking_request_id=request.id))->>'payment_required_deadline'),
    'historyCoverage',case when exists(select 1 from public.booking_request_payment_history history where history.payment_lifecycle_id=request.payment_lifecycle_id and history.source='history-boundary' and history.provenance='imported') then 'retained-evidence-only' else 'complete' end,
    'events',events
  );
end;
$_$;

ALTER FUNCTION "public"."get_administrator_booking_request_payment_history"("target_reference" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_booking_request_payment_recovery_confirmation_evidence"("target_attempt_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare evidence jsonb;
begin
  select jsonb_build_object(
    'purpose','booking-request-payment-recovery','bookingRequestId',attempts.booking_request_id,
    'recoveryAttemptId',attempts.id,'capturePhysicalAttemptId',ledger.physical_attempt_id,
    'capture',jsonb_build_object('movementReference',ledger.movement_reference)) into evidence
  from public.booking_request_payment_recovery_attempts attempts
  join public.booking_request_payment_recovery_operations operations on operations.recovery_attempt_id=attempts.id
    and operations.step='replacement-capture'
  join public.payment_provider_operations ledger on ledger.id=operations.provider_operation_id
  where attempts.id=target_attempt_id;
  if current_setting('role',true) <> 'service_role' or evidence is null then
    raise exception 'Recovery confirmation evidence is unavailable' using errcode='RC409'; end if;
  return evidence;
end;
$$;

ALTER FUNCTION "public"."get_booking_request_payment_recovery_confirmation_evidence"("target_attempt_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_customer_booking_request"("target_reference" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."get_customer_booking_request"("target_reference" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_public_booking_quote"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;

ALTER FUNCTION "public"."get_public_booking_quote"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_public_booking_quote_with_fingerprint"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare quote jsonb;
declare fingerprint text;
declare marketplace_terms jsonb;
begin
  quote := public.get_public_booking_quote(
    target_locale, target_slug, requested_search
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
$$;

ALTER FUNCTION "public"."get_public_booking_quote_with_fingerprint"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."invalidate_booking_request_payment_confirmation"("target_booking_request_id" "uuid", "target_provider_operation_id" "uuid", "target_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare request public.booking_requests;
declare confirmation public.booking_confirmations;
declare expiry public.booking_request_payment_required_expiry_work;
begin
  select * into request from public.booking_requests requests where requests.id=target_booking_request_id for update of requests;
  select * into confirmation from public.booking_confirmations confirmations where confirmations.booking_request_id=request.id;
  if confirmation.id is null then return; end if;
  select * into expiry from public.booking_request_payment_required_expiry_work work where work.booking_request_id=request.id;
  insert into public.booking_request_confirmation_invalidations(booking_request_id,confirmation_id,expiry_work_id,provider_operation_id,reason)
    values(request.id,confirmation.id,expiry.id,target_provider_operation_id,target_reason) on conflict do nothing;
  update public.cottage_booking_period_commitments set status='pending_hold'
    where id=request.booking_period_commitment_id and status='confirmed_booking';
end;
$$;

ALTER FUNCTION "public"."invalidate_booking_request_payment_confirmation"("target_booking_request_id" "uuid", "target_provider_operation_id" "uuid", "target_reason" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."lease_booking_request_capture_work"("target_booking_request_id" "uuid", "target_provider_identity" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record; declare work public.booking_request_capture_work; declare leased_at timestamptz;
begin
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  if not found then return jsonb_build_object('status','unavailable'); end if;
  work := source.work;
  if target_provider_identity is distinct from source.binding -> 'providerIdentity' then
    raise exception 'Booking Request capture provider is invalid' using errcode = 'RC409';
  end if;
  if work.state = 'payment_required' then
    return jsonb_build_object('status','payment-required','paymentRequiredWindow',jsonb_build_object(
      'recordedAt',to_char(work.payment_required_recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deadline',to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  end if;
  if work.state = 'complete' then return public.complete_booking_request_capture(target_booking_request_id,null,null,null); end if;
  leased_at := date_trunc('milliseconds',clock_timestamp());
  if work.state = 'processing' then
    return jsonb_build_object('status',case when leased_at < work.lease_expires_at then 'processing' else 'expired' end);
  end if;
  update public.booking_request_capture_work capture_work
  set state='processing',lease_generation=1,lease_token=gen_random_uuid(),lease_expires_at=leased_at+interval '30 seconds'
  where capture_work.booking_request_id=work.booking_request_id returning * into work;
  return jsonb_build_object('status','leased','permit',source.binding || jsonb_build_object(
    'purpose','booking-request-capture','workId',work.booking_request_id,'leaseGeneration',work.lease_generation,
    'leaseToken',work.lease_token,'notAfter',to_char(work.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
end;
$$;

ALTER FUNCTION "public"."lease_booking_request_capture_work"("target_booking_request_id" "uuid", "target_provider_identity" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."lease_booking_request_payment_recovery_step"("target_attempt_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record;
declare attempt public.booking_request_payment_recovery_attempts;
declare previous public.booking_request_payment_recovery_operations;
declare ledger public.payment_provider_operations;
declare step text;
declare permit jsonb;
begin
  if public.booking_request_payment_quarantined((select attempts.booking_request_id from public.booking_request_payment_recovery_attempts attempts where attempts.id=target_attempt_id)) then return jsonb_build_object('status','quarantined'); end if;
  if current_setting('role',true) <> 'service_role' then
    raise exception 'Recovery processing is unavailable' using errcode='42501'; end if;
  if public.booking_request_payment_required_expiry_completed((
    select attempts.booking_request_id from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=target_attempt_id
  )) then return jsonb_build_object('status','deadline-elapsed'); end if;
  select * into source from public.lock_booking_request_payment_recovery_source(target_attempt_id);
  attempt := source.attempt;
  select * into ledger from public.payment_provider_operations operations where operations.recovery_attempt_id=attempt.id
    and operations.current_outcome is null order by operations.created_at,operations.id for update of operations limit 1;
  if found then
    permit:=ledger.admission->'permit';
    return jsonb_build_object('status','reconcile','permit',permit,'binding',permit->'binding',
      'providerRequestId',null,'providerReference',null);
  end if;
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

ALTER FUNCTION "public"."lease_booking_request_payment_recovery_step"("target_attempt_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."lease_booking_request_release_work"("target_work_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."lease_booking_request_release_work"("target_work_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_due_booking_request_capture_intents"("target_limit" integer, "target_provider_identity" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."list_due_booking_request_capture_intents"("target_limit" integer, "target_provider_identity" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_owner_booking_request_notifications"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."list_owner_booking_request_notifications"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."lock_booking_request_capture_source"("target_booking_request_id" "uuid") RETURNS TABLE("work" "public"."booking_request_capture_work", "payment_snapshot" "jsonb", "binding" "jsonb", "ledger" "public"."payment_provider_operations")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare target_request public.booking_requests;
declare target_attempt public.booking_request_submission_attempts;
declare target_claim public.booking_request_authorization_claims;
declare authorization_identity public.booking_request_provider_operation_identities;
declare expected_fingerprint text;
declare expected_authorization jsonb;
declare expected_movement jsonb;
begin
  select * into target_request from public.booking_requests requests
  where requests.id = target_booking_request_id for update of requests;
  select * into work from public.booking_request_capture_work capture_work
  where capture_work.booking_request_id = target_booking_request_id for update of capture_work;
  if work.booking_request_id is null then return; end if;
  select * into target_attempt from public.booking_request_submission_attempts attempts
  where attempts.id = work.attempt_id for update of attempts;
  select * into target_claim from public.booking_request_authorization_claims claims
  where claims.id = work.authorization_claim_id for update of claims;
  expected_fingerprint := encode(
    extensions.digest(
      convert_to(
        '{"provider":{"provider":' || to_json(work.provider)::text
        || ',"environment":' || to_json(work.environment)::text
        || ',"merchantId":' || to_json(work.merchant_id)::text
        || ',"terminalId":' || to_json(work.terminal_id)::text
        || '},"kind":"capture","paymentLifecycleId":'
        || to_json(work.payment_lifecycle_id::text)::text
        || ',"logicalOperationId":'
        || to_json(work.capture_logical_operation_id)::text
        || ',"attemptId":' || to_json(work.capture_physical_attempt_id)::text
        || ',"amountFils":' || work.amount_fils::text
        || ',"currency":"IQD"}',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if target_request.id is null
    or target_request.status <> 'accepted'
    or target_request.payment_lifecycle_id <> work.payment_lifecycle_id
    or target_attempt.id is null
    or target_attempt.state <> 'finalized'
    or target_attempt.booking_request_id is distinct from target_request.id
    or target_attempt.payment_lifecycle_id <> work.payment_lifecycle_id
    or target_attempt.authorization_provider is distinct from work.provider
    or target_attempt.authorization_environment is distinct from work.environment
    or target_attempt.authorization_merchant_id is distinct from work.merchant_id
    or target_attempt.authorization_terminal_id is distinct from work.terminal_id
    or target_attempt.payment_snapshot ->> 'paymentLifecycleId'
      is distinct from work.payment_lifecycle_id::text
    or target_attempt.payment_snapshot -> 'authorization' ->> 'paymentLifecycleId'
      is distinct from work.payment_lifecycle_id::text
    or target_attempt.payment_snapshot -> 'authorization' ->> 'kind'
      is distinct from 'authorization'
    or target_attempt.payment_snapshot -> 'authorization' ->> 'status'
      is distinct from 'succeeded'
    or target_attempt.payment_snapshot -> 'authorization' ->> 'logicalOperationId'
      is distinct from work.authorization_logical_operation_id
    or target_attempt.payment_snapshot -> 'authorization' ->> 'attemptId'
      is distinct from work.authorization_physical_attempt_id
    or (target_attempt.payment_snapshot -> 'authorization' ->> 'amountFils')::bigint
      is distinct from work.amount_fils
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
    or target_attempt.payment_snapshot -> 'release'
      is distinct from 'null'::jsonb
    or target_claim.id is null
    or target_claim.attempt_id <> target_attempt.id
    or target_claim.generation <> work.authorization_claim_generation
    or target_claim.state <> 'converted'
    or target_claim.payment_lifecycle_id <> work.payment_lifecycle_id
    or target_claim.logical_operation_id
      <> work.authorization_logical_operation_id
    or target_claim.physical_attempt_id
      <> work.authorization_physical_attempt_id
    or target_claim.amount_fils <> work.amount_fils
    or target_claim.currency <> work.currency
    or target_claim.provider <> work.provider
    or target_claim.environment <> work.environment
    or target_claim.merchant_id <> work.merchant_id
    or target_claim.terminal_id <> work.terminal_id
    or work.capture_logical_operation_id
      <> work.payment_lifecycle_id::text || ':capture'
    or work.capture_physical_attempt_id
      <> work.capture_logical_operation_id || ':attempt-2'
    or work.capture_logical_operation_id = work.authorization_logical_operation_id
    or work.capture_physical_attempt_id = work.authorization_physical_attempt_id
    or work.provider_idempotency_key
      <> 'booking-request-capture:' || work.booking_request_id::text
        || ':' || work.authorization_claim_generation::text
    or work.request_fingerprint <> expected_fingerprint then
    raise exception 'Booking Request capture-work binding is invalid'
      using errcode = 'RC409';
  end if;

  select * into ledger from public.payment_provider_operations operations
  where operations.provider = work.provider and operations.environment = work.environment
    and operations.merchant_id = work.merchant_id and operations.terminal_id = work.terminal_id
    and operations.provider_idempotency_key = work.provider_idempotency_key
  for update of operations;
  -- The held submission-attempt lock serializes normalized Authorization writes.
  select * into authorization_identity from public.booking_request_provider_operation_identities identities
  where identities.attempt_id = target_attempt.id and identities.operation_kind = 'authorization';
  expected_authorization := jsonb_build_object(
    'paymentLifecycleId', work.payment_lifecycle_id, 'kind', 'authorization',
    'logicalOperationId', work.authorization_logical_operation_id,
    'attemptId', work.authorization_physical_attempt_id, 'status', 'succeeded',
    'amountFils', work.amount_fils,
    'providerRequestId', target_attempt.authorization_provider_request_id,
    'providerReference', target_attempt.authorization_provider_reference,
    'movementReference', target_attempt.authorization_movement_reference,
    'reconciliationRequired', false, 'retrySafe', false
  );
  expected_movement := jsonb_build_object(
    'kind', 'authorization', 'logicalOperationId', work.authorization_logical_operation_id,
    'attemptId', work.authorization_physical_attempt_id, 'amountFils', work.amount_fils,
    'movementReference', target_attempt.authorization_movement_reference,
    'recordedAt', target_attempt.payment_snapshot #>> '{movements,0,recordedAt}'
  );
  if target_attempt.payment_snapshot -> 'authorization' is distinct from expected_authorization
    or target_attempt.payment_snapshot #> '{movements,0}' is distinct from expected_movement
    or (target_attempt.payment_snapshot #>> '{movements,0,recordedAt}') is null
    or (target_attempt.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz is null
    or target_attempt.payment_snapshot ->> 'currency' is distinct from work.currency
    or (target_attempt.payment_snapshot ->> 'customerTotalFils')::bigint is distinct from work.amount_fils
    or authorization_identity.attempt_id is null
    or (authorization_identity.provider, authorization_identity.environment,
      authorization_identity.merchant_id, authorization_identity.terminal_id,
      authorization_identity.provider_request_id, authorization_identity.provider_reference,
      authorization_identity.movement_reference) is distinct from
      (work.provider, work.environment, work.merchant_id, work.terminal_id,
       target_attempt.authorization_provider_request_id, target_attempt.authorization_provider_reference,
       target_attempt.authorization_movement_reference)
    or (work.state <> 'complete' and (
      target_attempt.payment_snapshot -> 'capture' is distinct from 'null'::jsonb
      or jsonb_array_length(target_attempt.payment_snapshot -> 'movements') <> 1
    )) then
    raise exception 'Booking Request capture Authorization evidence is invalid' using errcode = 'RC409';
  end if;
  payment_snapshot := target_attempt.payment_snapshot;
  binding := jsonb_build_object(
    'bookingRequestId', work.booking_request_id, 'submissionAttemptId', work.attempt_id,
    'authorizationClaimId', work.authorization_claim_id,
    'authorizationClaimGeneration', work.authorization_claim_generation,
    'paymentLifecycleId', work.payment_lifecycle_id,
    'authorizationLogicalOperationId', work.authorization_logical_operation_id,
    'authorizationPhysicalAttemptId', work.authorization_physical_attempt_id,
    'captureLogicalOperationId', work.capture_logical_operation_id,
    'capturePhysicalAttemptId', work.capture_physical_attempt_id,
    'amountFils', work.amount_fils, 'currency', work.currency,
    'providerIdentity', jsonb_build_object('provider', work.provider,
      'environment', work.environment, 'merchantId', work.merchant_id, 'terminalId', work.terminal_id),
    'idempotencyKey', work.provider_idempotency_key, 'requestFingerprint', work.request_fingerprint
  );
  if ledger.id is not null and (
    (ledger.claim_id, ledger.claim_generation, ledger.operation_kind,
      ledger.payment_lifecycle_id, ledger.logical_operation_id, ledger.physical_attempt_id,
      ledger.amount_fils, ledger.currency, ledger.request_fingerprint) is distinct from
      (work.authorization_claim_id, work.authorization_claim_generation, 'capture'::text,
      work.payment_lifecycle_id, work.capture_logical_operation_id, work.capture_physical_attempt_id,
      work.amount_fils, work.currency, work.request_fingerprint)
    or (
      (ledger.original_outcome is null and ledger.current_outcome is null
        and ledger.evidence_provenance = 'admitted' and ledger.movement_reference is null)
      or (ledger.original_outcome = 'not-executed' and ledger.current_outcome = 'not-executed'
        and ledger.movement_reference is null)
      or (ledger.original_outcome in ('succeeded', 'indeterminate') and ledger.current_outcome = 'succeeded'
        and ledger.movement_reference is not null)
      or (ledger.original_outcome in ('failed', 'indeterminate') and ledger.current_outcome = 'failed'
        and ledger.movement_reference is null)
      or (ledger.original_outcome = 'indeterminate' and ledger.current_outcome = 'indeterminate'
        and ledger.movement_reference is not null)
    ) is not true
    or ledger.capture_execution_permit - array['purpose', 'workId', 'leaseGeneration', 'leaseToken', 'notAfter']
      is distinct from binding
    or ledger.capture_execution_permit ->> 'purpose' is distinct from 'booking-request-capture'
    or ledger.capture_execution_permit ->> 'workId' is distinct from work.booking_request_id::text
  ) then
    raise exception 'Booking Request capture provider ledger is invalid' using errcode = 'RC409';
  end if;
  return next;
end;
$$;

ALTER FUNCTION "public"."lock_booking_request_capture_source"("target_booking_request_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."lock_booking_request_payment_recovery_source"("target_attempt_id" "uuid") RETURNS TABLE("attempt" "public"."booking_request_payment_recovery_attempts", "work" "public"."booking_request_capture_work", "payment_snapshot" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare request_id uuid;
declare source record;
begin
  select attempts.booking_request_id into request_id from public.booking_request_payment_recovery_attempts attempts
    where attempts.id=target_attempt_id;
  select * into source from public.lock_booking_request_capture_source(request_id);
  if not found then raise exception 'Recovery source is unavailable' using errcode='RC409'; end if;
  work := source.work;
  payment_snapshot := source.payment_snapshot;
  select * into attempt from public.booking_request_payment_recovery_attempts attempts
    where attempts.id=target_attempt_id for update of attempts;
  if attempt.id is null or attempt.booking_request_id is distinct from work.booking_request_id
    or work.state <> 'payment_required'
    or not exists(select 1 from public.booking_request_submission_attempts submissions
      where submissions.id=work.attempt_id and submissions.intent_dedupe_active)
    or exists(select 1 from public.booking_request_release_work releases
      where releases.booking_request_id=work.booking_request_id) then
    raise exception 'Recovery source is invalid' using errcode='RC409';
  end if;
  return next;
end;
$$;

ALTER FUNCTION "public"."lock_booking_request_payment_recovery_source"("target_attempt_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."lock_booking_request_payment_required_expiry_source"("target_booking_request_id" "uuid") RETURNS TABLE("work" "public"."booking_request_capture_work", "payment_snapshot" "jsonb", "expiry" "public"."booking_request_payment_required_expiry_work")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."lock_booking_request_payment_required_expiry_source"("target_booking_request_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."lookup_booking_request_submission"("target_attempt_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare attempt public.booking_request_submission_attempts;
declare request public.booking_requests;
begin
  select attempts.* into attempt
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id
  for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if attempt.booking_request_id is null then
    return jsonb_build_object('status', 'absent');
  end if;
  select requests.* into request
  from public.booking_requests requests
  where requests.id = attempt.booking_request_id;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  return jsonb_build_object(
    'status', 'pending',
    'bookingRequestReference', request.booking_request_reference,
    'responseDeadline', to_char(
      request.response_deadline at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
end;
$$;

ALTER FUNCTION "public"."lookup_booking_request_submission"("target_attempt_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."mark_booking_request_reconciliation_required"("target_attempt_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform attempts.id
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id
  for update;
  perform claims.id
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id
  for update;
  if exists (
    select 1
    from public.booking_request_submission_attempts attempts
    where attempts.id = target_attempt_id
      and attempts.state in (
        'finalized', 'released', 'authorization_failed', 'expired'
      )
  ) then
    return;
  end if;
  update public.booking_request_submission_attempts
  set state = 'reconciliation_required',
    updated_at = now()
  where id = target_attempt_id;
  update public.booking_request_authorization_claims claims
  set state = 'reconciliation_required',
    state_revision = state_revision + 1,
    updated_at = clock_timestamp()
  where claims.attempt_id = target_attempt_id
    and claims.state = 'starting';
  update public.booking_request_authorization_reconciliation_outbox outbox
  set state = 'pending', observed_state_revision = claims.state_revision,
    lease_token = null, lease_expires_at = null,
    updated_at = clock_timestamp()
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id
    and outbox.claim_id = claims.id;
end;
$$;

ALTER FUNCTION "public"."mark_booking_request_reconciliation_required"("target_attempt_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."observe_booking_request_payment_correction"("target_booking_request_id" "uuid", "target_provider_operation_id" "uuid", "target_receipt" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare work public.booking_request_capture_work;
declare ledger public.payment_provider_operations;
declare expected jsonb;
declare conflicting boolean;
declare observed_at timestamptz;
declare provider_result jsonb;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Payment observation unavailable' using errcode='42501'; end if;
  select * into work from public.booking_request_capture_work capture where capture.booking_request_id=target_booking_request_id;
  select * into ledger from public.payment_provider_operations operations where operations.id=target_provider_operation_id;
  if ledger.claim_id is distinct from work.authorization_claim_id then raise exception 'Payment observation source is invalid' using errcode='RC409'; end if;
  ledger:=public.lock_payment_observation_source(target_provider_operation_id,
    array['booking-request-capture','booking-request-payment-recovery','booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund']);
  select * into work from public.booking_request_capture_work capture where capture.booking_request_id=target_booking_request_id for update of capture;
  if work.payment_required_deadline is null or ledger.id is null or ledger.operation_kind not in ('capture','release','refund')
    or ledger.claim_id is distinct from work.authorization_claim_id then raise exception 'Payment observation source is invalid' using errcode='RC409'; end if;
  if target_receipt is null or jsonb_typeof(target_receipt)<>'object'
    or target_receipt ?& array['receiptId','bookingRequestId','providerOperationId','providerIdentity','paymentLifecycleId','logicalOperationId','physicalAttemptId','kind','amountFils','currency','providerRequestId','providerReference','movementReference','outcome','occurredAt'] is not true
    or target_receipt-array['receiptId','bookingRequestId','providerOperationId','providerIdentity','paymentLifecycleId','logicalOperationId','physicalAttemptId','kind','amountFils','currency','providerRequestId','providerReference','movementReference','outcome','occurredAt','evidence']<>'{}'
    or jsonb_typeof(target_receipt->'receiptId')<>'string' or length(target_receipt->>'receiptId') not between 1 and 200 then
    perform public.append_booking_request_payment_history(
      work.payment_lifecycle_id, work.booking_request_id,
      'receipt-observation', 'provider-receipt', 'observed',
      target_operation_kind => ledger.operation_kind,
      target_logical_operation_id => ledger.logical_operation_id,
      target_physical_attempt_id => ledger.physical_attempt_id,
      target_outcome => 'malformed',
      target_reason_code => 'malformed-provider-observation',
      target_provider_operation_id => ledger.id,
      target_provider_request_id => ledger.provider_request_id,
      target_provider_reference => ledger.provider_reference,
      target_movement_reference => ledger.movement_reference,
      target_amount_fils => ledger.amount_fils,
      target_received_at => clock_timestamp()
    );
    return public.quarantine_booking_request_payment(target_booking_request_id,'malformed-provider-observation'); end if;
  if exists(select 1 from public.booking_request_payment_correction_observations observations
    where observations.provider_operation_id=ledger.id and observations.receipt_identity=target_receipt->>'receiptId' and observations.payload=target_receipt) then
    perform public.append_booking_request_payment_history(
      work.payment_lifecycle_id, work.booking_request_id,
      'receipt-observation', 'provider-receipt', 'observed',
      target_operation_kind => ledger.operation_kind,
      target_logical_operation_id => ledger.logical_operation_id,
      target_physical_attempt_id => ledger.physical_attempt_id,
      target_outcome => 'duplicate',
      target_provider_operation_id => ledger.id,
      target_provider_request_id => ledger.provider_request_id,
      target_provider_reference => ledger.provider_reference,
      target_movement_reference => ledger.movement_reference,
      target_amount_fils => ledger.amount_fils,
      target_received_at => clock_timestamp()
    );
    return jsonb_build_object('status','duplicate'); end if;
  expected := jsonb_build_object('bookingRequestId',target_booking_request_id,'providerOperationId',ledger.id,
    'providerIdentity',jsonb_build_object('provider',ledger.provider,'environment',ledger.environment,'merchantId',ledger.merchant_id,'terminalId',ledger.terminal_id),
    'paymentLifecycleId',ledger.payment_lifecycle_id,'logicalOperationId',ledger.logical_operation_id,'physicalAttemptId',ledger.physical_attempt_id,
    'kind',ledger.operation_kind,'amountFils',ledger.amount_fils,'currency',ledger.currency,'providerRequestId',coalesce(ledger.provider_request_id,target_receipt->>'providerRequestId'),'providerReference',coalesce(ledger.provider_reference,target_receipt->>'providerReference'));
  conflicting := (ledger.claim_generation,ledger.amount_fils,ledger.currency,ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id)
      is distinct from (work.authorization_claim_generation,work.amount_fils,work.currency,work.provider,work.environment,work.merchant_id,work.terminal_id)
    or target_receipt-array['receiptId','movementReference','outcome','occurredAt','evidence'] is distinct from expected
    or target_receipt->>'outcome' not in ('succeeded','failed','indeterminate')
    or (ledger.current_outcome is null and not (target_receipt ? 'evidence'))
    or jsonb_typeof(target_receipt->'outcome') is distinct from 'string'
    or (ledger.current_outcome is not null and ledger.current_outcome<>'indeterminate' and target_receipt->>'outcome' is distinct from ledger.current_outcome)
    or (ledger.current_outcome is not null and target_receipt->>'outcome'<>'failed' and target_receipt->>'movementReference' is distinct from ledger.movement_reference)
    or (target_receipt->>'outcome'='failed' and target_receipt->'movementReference' is distinct from 'null'::jsonb)
    or exists(select 1 from public.booking_request_payment_correction_observations observations where observations.provider_operation_id=ledger.id
      and (observations.receipt_identity=target_receipt->>'receiptId' or observations.payload-'receiptId' is distinct from target_receipt-'receiptId'));
  begin
    observed_at := (target_receipt->>'occurredAt')::timestamptz;
    if (target_receipt->>'outcome'='indeterminate') is distinct from (observed_at is null)
      or not isfinite(observed_at) or observed_at > clock_timestamp() or (ledger.evidence_provenance<>'legacy-simulated' and observed_at < ledger.executed_at)
      or (ledger.authoritative_outcome_at is not null and ledger.authoritative_outcome_at is distinct from observed_at)
      then conflicting := true; end if;
  exception when invalid_datetime_format or datetime_field_overflow then conflicting:=true; end;
  if conflicting is false then
    begin
      provider_result:=jsonb_build_object('outcome',target_receipt->>'outcome','providerRequestId',target_receipt->>'providerRequestId','providerReference',target_receipt->>'providerReference',
          'evidence',coalesce(target_receipt->'evidence',jsonb_build_object('operationId',ledger.id,'eventId',target_receipt->>'receiptId',
            'provenance',ledger.evidence_provenance,'originalOutcome',ledger.original_outcome,'executedAt',ledger.executed_at,
            'occurredAt',observed_at,'closedAt',null)))
        ||case when target_receipt->>'outcome'='failed' then jsonb_build_object('retrySafe',false)
          else jsonb_build_object('movementReference',target_receipt->>'movementReference') end;
      perform public.validate_payment_provider_observation(provider_result,ledger.id);
      if (provider_result#>>'{evidence,occurredAt}')::timestamptz is distinct from observed_at then
        raise exception 'Correction occurrence conflicts with provider evidence' using errcode='RC409'; end if;
      case ledger.admission->>'purpose'
        when 'booking-request-payment-recovery' then perform public.record_booking_request_payment_recovery_observation(ledger.id,provider_result);
        when 'booking-request-capture' then perform public.record_booking_request_capture_observation(ledger.id,provider_result);
        else perform public.record_booking_request_payment_required_expiry_observation(ledger.id,provider_result);
      end case;
      select * into ledger from public.payment_provider_operations operations where operations.id=ledger.id;
    exception when sqlstate 'RC409' then conflicting:=true;
    end;
  end if;
  insert into public.booking_request_payment_correction_observations(booking_request_id,provider_operation_id,receipt_identity,payload,conflict)
    values(target_booking_request_id,ledger.id,target_receipt->>'receiptId',target_receipt,coalesce(conflicting,true));
  if conflicting is not false then return public.quarantine_booking_request_payment(target_booking_request_id,'conflicting-provider-observation'); end if;
  if target_receipt->>'outcome'='indeterminate' then return public.quarantine_booking_request_payment(target_booking_request_id,'unresolved-provider-observation'); end if;
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  if ledger.operation_kind in ('release','refund') and ledger.current_outcome='failed' then
    return public.quarantine_booking_request_payment(target_booking_request_id,'failed-'||ledger.operation_kind||'-observation'); end if;
  if ledger.operation_kind='capture' and ledger.current_outcome='succeeded' and observed_at >= work.payment_required_deadline then
    insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline)
      values(work.booking_request_id,work.payment_required_deadline) on conflict do nothing;
    perform public.invalidate_booking_request_payment_confirmation(work.booking_request_id,ledger.id,'late-capture');
  end if;
  return jsonb_build_object('status','recorded');
end;
$$;

ALTER FUNCTION "public"."observe_booking_request_payment_correction"("target_booking_request_id" "uuid", "target_provider_operation_id" "uuid", "target_receipt" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."observe_booking_request_payment_history"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare current_row jsonb := to_jsonb(new);
declare prior_row jsonb := case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
declare lifecycle_id uuid;
declare request_id uuid;
declare source_name text;
declare event_kind text := 'state-transition';
declare operation_name text;
declare current_state text;
declare prior_state text;
declare current_outcome text;
declare prior_outcome text;
declare reason text;
declare source_time timestamptz;
declare occurrence_time timestamptz;
declare provider_row public.payment_provider_operations;
begin
  source_name := case tg_table_name
    when 'booking_request_authorization_claims' then 'authorization-claim'
    when 'payment_provider_operations' then 'provider-operation'
    when 'booking_request_release_work' then 'release-work'
    when 'booking_request_release_operations' then 'release-operation'
    when 'booking_request_capture_work' then 'capture-work'
    when 'booking_request_payment_recovery_attempts' then 'recovery-attempt'
    when 'booking_request_payment_recovery_operations' then 'recovery-operation'
    when 'booking_request_payment_required_expiry_work' then 'expiry-work'
    when 'booking_request_payment_required_expiry_operations' then 'expiry-operation'
    when 'booking_requests' then 'booking-request'
    when 'booking_confirmations' then 'confirmation'
    when 'booking_request_confirmation_invalidations' then 'confirmation-invalidation'
    when 'booking_request_payment_correction_observations' then 'provider-receipt'
  end;
  request_id := nullif(current_row->>'booking_request_id','')::uuid;
  lifecycle_id := nullif(coalesce(current_row->>'payment_lifecycle_id', current_row->>'authorization_payment_lifecycle_id'),'')::uuid;
  if tg_table_name='booking_requests' then
    request_id := (current_row->>'id')::uuid;
  elsif tg_table_name='payment_provider_operations' then
    select claims.payment_lifecycle_id into lifecycle_id from public.booking_request_authorization_claims claims where claims.id=(current_row->>'claim_id')::uuid;
  elsif tg_table_name='booking_request_release_work' then
    select attempts.payment_lifecycle_id into lifecycle_id from public.booking_request_submission_attempts attempts where attempts.id=(current_row->>'attempt_id')::uuid;
  elsif tg_table_name='booking_request_payment_recovery_operations' then
    select requests.id, requests.payment_lifecycle_id into request_id,lifecycle_id
      from public.booking_request_payment_recovery_attempts attempts join public.booking_requests requests on requests.id=attempts.booking_request_id
      where attempts.id=(current_row->>'recovery_attempt_id')::uuid;
  elsif tg_table_name='booking_request_payment_correction_observations' then
    select requests.payment_lifecycle_id into lifecycle_id from public.booking_requests requests where requests.id=request_id;
  end if;
  if request_id is null and lifecycle_id is not null then
    select requests.id into request_id from public.booking_requests requests where requests.payment_lifecycle_id=lifecycle_id;
  end if;
  if request_id is not null then
    select requests.payment_lifecycle_id into lifecycle_id from public.booking_requests requests where requests.id=request_id;
  end if;
  if lifecycle_id is null then raise exception 'Payment history source has no original lifecycle' using errcode='RC409'; end if;

  -- Admission alone has no execution or payment history. The first accepted
  -- executed observation records the physical attempt; later results retain its identity.
  if tg_table_name='payment_provider_operations' and current_row->>'current_outcome' is null then return new; end if;
  if tg_table_name='payment_provider_operations' and tg_op='UPDATE'
    and (current_row->>'current_outcome',current_row->>'authoritative_outcome_at',current_row->>'movement_reference')
      is not distinct from (prior_row->>'current_outcome',prior_row->>'authoritative_outcome_at',prior_row->>'movement_reference') then
    return new;
  end if;

  current_state := coalesce(current_row->>'state', current_row->>'status');
  prior_state := coalesce(prior_row->>'state', prior_row->>'status');
  current_outcome := coalesce(current_row->>'current_outcome', current_row->>'provider_outcome', current_row->>'outcome');
  prior_outcome := coalesce(prior_row->>'current_outcome', prior_row->>'provider_outcome', prior_row->>'outcome');
  operation_name := coalesce(current_row->>'operation_kind', current_row->>'step',
    case source_name when 'capture-work' then 'capture' when 'release-work' then 'release'
      when 'release-operation' then 'release' when 'authorization-claim' then 'authorization'
      when 'expiry-work' then 'expiry' when 'confirmation' then 'confirmation'
      when 'confirmation-invalidation' then 'invalidation' end);
  reason := coalesce(current_row->>'quarantine_reason', current_row->>'diagnostic_reason', current_row->>'reason', current_row->>'decline_reason');
  source_time := nullif(coalesce(current_row->>'completed_at',current_row->>'result_recorded_at',current_row->>'settled_at',current_row->>'invalidated_at',current_row->>'confirmed_at',current_row->>'updated_at',current_row->>'created_at'),'')::timestamptz;
  occurrence_time := nullif(current_row->>'authoritative_outcome_at','')::timestamptz;

  if tg_table_name='payment_provider_operations' then
    if (tg_op='INSERT' or prior_row->>'current_outcome' is null) and current_row->>'current_outcome'<>'not-executed' then event_kind:='physical-attempt';
    else prior_state:=prior_outcome; current_state:=current_outcome; end if;
  end if;
  if tg_table_name in ('booking_request_release_work','booking_request_capture_work') then event_kind:='logical-operation'; end if;
  if tg_table_name in ('booking_confirmations','booking_request_confirmation_invalidations') then event_kind:='terminal-outcome'; end if;
  if tg_table_name='booking_confirmations' then
    current_state := 'confirmed'; current_outcome := 'succeeded';
  elsif tg_table_name='booking_request_confirmation_invalidations' then
    current_state := 'invalidated';
  end if;
  if tg_op='UPDATE' and tg_table_name in ('booking_request_release_work','booking_request_capture_work')
    and (current_row->>'lease_generation')::bigint > (prior_row->>'lease_generation')::bigint
    and (prior_row->>'lease_generation')::bigint > 0 then
    event_kind := 'retry';
  end if;
  if tg_table_name='booking_request_payment_correction_observations' then
    select * into strict provider_row from public.payment_provider_operations where id=(current_row->>'provider_operation_id')::uuid;
    operation_name := provider_row.operation_kind;
    current_row := current_row || jsonb_build_object('logical_operation_id',provider_row.logical_operation_id,
      'physical_attempt_id',provider_row.physical_attempt_id,'provider_request_id',provider_row.provider_request_id,
      'provider_reference',provider_row.provider_reference,'movement_reference',provider_row.movement_reference,
      'amount_fils',provider_row.amount_fils);
    event_kind := 'receipt-observation';
    current_outcome := case when (current_row->>'conflict')::boolean then 'conflicting' else current_row#>>'{payload,outcome}' end;
    reason := case when (current_row->>'conflict')::boolean then 'conflicting-provider-observation' end;
    occurrence_time := case when not (current_row->>'conflict')::boolean and current_row#>>'{payload,occurredAt}' is not null then (current_row#>>'{payload,occurredAt}')::timestamptz end;
  end if;
  if coalesce(current_state,'') in ('quarantined','blocked') then event_kind:='quarantine'; end if;
  if tg_op='UPDATE' and tg_table_name<>'payment_provider_operations'
    and (current_state,current_outcome,reason,current_row->>'lease_generation',current_row->>'generation',current_row->>'provider_operation_id')
    is not distinct from (prior_state,prior_outcome,coalesce(prior_row->>'quarantine_reason',prior_row->>'diagnostic_reason',prior_row->>'reason',prior_row->>'decline_reason'),prior_row->>'lease_generation',prior_row->>'generation',prior_row->>'provider_operation_id') then
    return new;
  end if;
  perform public.append_booking_request_payment_history(
    lifecycle_id, request_id, event_kind, source_name, 'observed', operation_name,
    coalesce(current_row->>'logical_operation_id',current_row->>'release_logical_operation_id',current_row->>'capture_logical_operation_id'),
    coalesce(current_row->>'physical_attempt_id',current_row->>'release_physical_attempt_id',current_row->>'capture_physical_attempt_id'),
    nullif(coalesce(current_row->>'operation_generation',current_row->>'lease_generation',
      case when tg_table_name='booking_request_authorization_claims' then current_row->>'generation' end),'')::bigint,
    case when tg_table_name='booking_request_payment_recovery_attempts' then nullif(current_row->>'generation','')::bigint end,
    prior_state, current_state, current_outcome, reason,
    nullif(coalesce(current_row->>'provider_operation_id',case when tg_table_name='payment_provider_operations' then current_row->>'id' end),'')::uuid,
    current_row->>'provider_request_id',current_row->>'provider_reference',current_row->>'movement_reference',
    nullif(current_row->>'amount_fils','')::bigint,occurrence_time,
    nullif(current_row->>'received_at','')::timestamptz,source_time
  );
  return new;
end;
$$;

ALTER FUNCTION "public"."observe_booking_request_payment_history"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_booking_request_corrective_refund"("target_booking_request_id" "uuid", "target_capture_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record;
declare expiry public.booking_request_payment_required_expiry_work;
declare capture public.payment_provider_operations;
declare authorization_ledger public.payment_provider_operations;
declare recovery public.booking_request_payment_recovery_attempts;
declare logical_id text;
declare authorization_logical text;
declare authorization_physical text;
declare predecessor text;
declare predecessor_at timestamptz;
begin
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  select * into expiry from public.booking_request_payment_required_expiry_work work where work.booking_request_id=target_booking_request_id for update of work;
  select * into capture from public.payment_provider_operations ledger where ledger.id=target_capture_id for update of ledger;
  if capture.operation_kind is distinct from 'capture' or capture.current_outcome is distinct from 'succeeded'
    or capture.authoritative_outcome_at is null or capture.authoritative_outcome_at < (source.work).payment_required_deadline
    or capture.original_outcome='failed' or capture.amount_fils<>(source.work).amount_fils
    or capture.currency<>(source.work).currency or capture.claim_id<>(source.work).authorization_claim_id
    or capture.recorded_at is null or capture.movement_reference is null then
    raise exception 'Corrective capture evidence is invalid' using errcode='RC409'; end if;
  if capture.payment_lifecycle_id=(source.work).payment_lifecycle_id then
    authorization_logical := (source.work).authorization_logical_operation_id;
    authorization_physical := (source.work).authorization_physical_attempt_id;
    predecessor := source.payment_snapshot#>>'{authorization,movementReference}';
    predecessor_at := (source.payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz;
  else
    select * into recovery from public.booking_request_payment_recovery_attempts attempts where attempts.id=capture.recovery_attempt_id and attempts.booking_request_id=target_booking_request_id;
    select ledger.* into authorization_ledger from public.booking_request_payment_recovery_operations operations
      join public.payment_provider_operations ledger on ledger.id=operations.provider_operation_id
      where operations.recovery_attempt_id=recovery.id and operations.step='replacement-authorization';
    if authorization_ledger.current_outcome is distinct from 'succeeded' or authorization_ledger.authoritative_outcome_at is null then
      raise exception 'Corrective authorization evidence is invalid' using errcode='RC409'; end if;
    authorization_logical:=authorization_ledger.logical_operation_id; authorization_physical:=authorization_ledger.physical_attempt_id;
    predecessor:=authorization_ledger.movement_reference; predecessor_at:=authorization_ledger.authoritative_outcome_at;
  end if;
  logical_id:=expiry.id::text||':corrective-refund:'||capture.id::text;
  insert into public.booking_request_payment_required_expiry_operations(
    expiry_work_id,booking_request_id,owner,authorization_claim_id,authorization_claim_generation,authorization_payment_lifecycle_id,
    authorization_logical_operation_id,authorization_physical_attempt_id,predecessor_movement_reference,predecessor_outcome_at,
    release_logical_operation_id,release_physical_attempt_id,provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
    request_fingerprint,operation_kind,capture_provider_operation_id,capture_occurred_at)
  values(expiry.id,target_booking_request_id,'expiry',(source.work).authorization_claim_id,(source.work).authorization_claim_generation,
    capture.payment_lifecycle_id,authorization_logical,authorization_physical,predecessor,predecessor_at,
    logical_id,logical_id||':1',logical_id||':1',(source.work).amount_fils,(source.work).currency,(source.work).provider,(source.work).environment,
    (source.work).merchant_id,(source.work).terminal_id,(source.work).request_fingerprint,'refund',capture.id,capture.authoritative_outcome_at)
    on conflict do nothing;
  if not exists(select 1 from public.booking_request_payment_required_expiry_operations operations
    where operations.expiry_work_id=expiry.id and operations.capture_provider_operation_id=capture.id and operations.operation_kind='refund') then
    raise exception 'Captured authorization has conflicting release ownership' using errcode='RC409'; end if;
  perform public.invalidate_booking_request_payment_confirmation(target_booking_request_id,capture.id,'late-capture');
end;
$$;

ALTER FUNCTION "public"."prepare_booking_request_corrective_refund"("target_booking_request_id" "uuid", "target_capture_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_booking_request_payment_required_expiry"("target_booking_request_id" "uuid", "target_provider_identity" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record;
declare expiry public.booking_request_payment_required_expiry_work;
declare recovery record;
declare recovery_attempt public.booking_request_payment_recovery_attempts;
declare release_operation public.booking_request_payment_recovery_operations;
declare release_ledger public.payment_provider_operations;
declare authorization_ledger public.payment_provider_operations;
declare expected_permit jsonb;
declare unresolved_reason text;
declare target public.booking_request_payment_required_expiry_operations;
declare instruction jsonb;
declare request public.booking_requests;
declare capture_work public.booking_request_capture_work;
declare captured record;
begin
  if current_setting('role',true) <> 'service_role' or target_booking_request_id is null then
    raise exception 'Payment Required expiry preparation is unavailable' using errcode='42501';
  end if;
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
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
    return public.quarantine_booking_request_payment(target_booking_request_id,'source-evidence-invalid');
  end;
  if not found or (source.work).state <> 'payment_required'
    or not public.booking_request_payment_required_expiry_provider_matches(source.work,target_provider_identity) then
    raise exception 'Payment Required expiry source is invalid' using errcode='RC409';
  end if;
  for captured in select operations.* from public.payment_provider_operations operations
    where operations.claim_id=(source.work).authorization_claim_id and operations.current_outcome is null
      and operations.admission->>'purpose' in ('booking-request-payment-recovery','booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund')
    order by operations.created_at,operations.id for update of operations
  loop
    expected_permit:=captured.admission->'permit';
    return jsonb_build_object('status',case when captured.admission->>'purpose'='booking-request-payment-recovery' then 'reconcile-recovery' else 'reconcile-expiry' end,
      'permit',expected_permit,'binding',expected_permit->'binding','providerRequestId',null,'providerReference',null);
  end loop;
  for captured in select ledger.* from public.payment_provider_operations ledger
    where ledger.claim_id=(source.work).authorization_claim_id and ledger.operation_kind='capture' and ledger.current_outcome='succeeded'
    order by ledger.created_at,ledger.id
  loop
    if captured.authoritative_outcome_at is null then
      return public.quarantine_booking_request_payment(target_booking_request_id,'capture-occurrence-unknown');
    elsif captured.authoritative_outcome_at >= (source.work).payment_required_deadline then
      insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline)
        values(target_booking_request_id,(source.work).payment_required_deadline) on conflict do nothing;
      perform public.invalidate_booking_request_payment_confirmation(target_booking_request_id,captured.id,'late-capture');
    end if;
  end loop;
  if exists(select 1 from public.booking_confirmations confirmations
    where confirmations.booking_request_id=target_booking_request_id and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=target_booking_request_id)) then
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

  if (source.ledger).current_outcome='succeeded' and (source.ledger).original_outcome<>'failed'
    and (source.ledger).authoritative_outcome_at >= (source.work).payment_required_deadline then
    perform public.prepare_booking_request_corrective_refund(target_booking_request_id,(source.ledger).id);
  elsif (source.ledger).id is null or (source.ledger).operation_kind <> 'capture'
    or (source.ledger).current_outcome <> 'failed'
    or (source.ledger).movement_reference is not null
    or ((source.ledger).original_outcome in ('failed', 'indeterminate')) is not true then
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
    from public.payment_provider_operations ledger
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

  if unresolved_reason is null then
    for captured in select ledger.* from public.booking_request_payment_recovery_operations operations
      join public.booking_request_payment_recovery_attempts attempts on attempts.id=operations.recovery_attempt_id
      join public.payment_provider_operations ledger on ledger.id=operations.provider_operation_id
      where attempts.booking_request_id=target_booking_request_id and operations.step='replacement-capture' and ledger.current_outcome='succeeded'
      order by attempts.generation,ledger.id
    loop
      if captured.authoritative_outcome_at is null then unresolved_reason:='capture-occurrence-unknown'; exit;
      elsif captured.authoritative_outcome_at < (source.work).payment_required_deadline then
        return jsonb_build_object('status','processing');
      else
        begin perform public.prepare_booking_request_corrective_refund(target_booking_request_id,captured.id);
        exception when sqlstate 'RC409' then unresolved_reason:='corrective-capture-invalid'; end;
      end if;
    end loop;
  end if;

  if unresolved_reason is null and exists(
    select 1 from public.payment_provider_operations ledger
    where (ledger.claim_id=(source.work).authorization_claim_id
      or ledger.payment_lifecycle_id=(source.work).payment_lifecycle_id
      or exists(select 1 from public.booking_request_payment_recovery_attempts attempts
        where attempts.booking_request_id=target_booking_request_id and attempts.id=ledger.payment_lifecycle_id))
      and ledger.id is distinct from (source.ledger).id
      and not exists(select 1 from public.booking_request_payment_recovery_operations operations
        join public.booking_request_payment_recovery_attempts attempts on attempts.id=operations.recovery_attempt_id
        where attempts.booking_request_id=target_booking_request_id and operations.provider_operation_id=ledger.id)
      and ledger.current_outcome is distinct from 'not-executed'
      and ledger.operation_kind in ('authorization','capture','release','refund','settlement')
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
        and ledger.recorded_at is not null)
  ) then unresolved_reason := 'unexplained-provider-operation'; end if;

  if unresolved_reason is null and not exists(select 1 from public.booking_request_payment_required_expiry_operations owned
    where owned.expiry_work_id=expiry.id and owned.authorization_payment_lifecycle_id=(source.work).payment_lifecycle_id and owned.operation_kind='refund') then
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
        and not exists(select 1 from public.booking_request_payment_required_expiry_operations owned where owned.expiry_work_id=expiry.id and owned.authorization_payment_lifecycle_id=attempts.id and owned.operation_kind='refund')
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
          instruction := jsonb_build_object('status',case target.operation_kind when 'refund' then 'refund' else 'release' end,'permit',expected_permit,'binding',expected_permit->'binding');
        end if;
      elsif release_ledger.current_outcome='failed' then
        unresolved_reason := 'expiry-release-failed'; exit;
      elsif release_ledger.current_outcome='indeterminate' then
        unresolved_reason := 'expiry-release-indeterminate';
        exit;
      end if;
    end loop;
  end if;
  if unresolved_reason is not null then
    return public.quarantine_booking_request_payment(target_booking_request_id,unresolved_reason);
  end if;
  update public.booking_request_payment_required_expiry_work set state='processing',diagnostic_reason=null,last_evaluated_at=clock_timestamp()
    where id=expiry.id;
  return coalesce(instruction,jsonb_build_object('status','ready'));

end;
$$;

ALTER FUNCTION "public"."prepare_booking_request_payment_required_expiry"("target_booking_request_id" "uuid", "target_provider_identity" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_booking_request_submission"("target_customer_user_id" "uuid", "target_idempotency_key" "uuid", "target_submission" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare target_locale public.cottage_profile_source_language;
declare target_slug text;
declare target_search jsonb;
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
      and contexts.role = 'customer'::public.account_role
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

  select * into key_attempt
  from public.booking_request_submission_attempts attempts
  where attempts.customer_user_id = target_customer_user_id
    and attempts.idempotency_key = target_idempotency_key
  for update;
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
    and attempts.intent_dedupe_active
  for update;
  if found then
    existing_projection := public.project_existing_booking_request_submission_attempt(
      existing_attempt, target_intent_fingerprint, intent, false
    );
    if existing_projection ->> 'status' <> 'continue' then
      return existing_projection;
    end if;
  end if;

  select profiles.id into current_profile_id
  from public.cottage_marketplace_listings listings
  join public.owner_application_cottage_profiles profiles
    on profiles.id = listings.profile_id
  where listings.public_slug = target_slug
  for update of profiles;
  if current_profile_id is null then
    return jsonb_build_object('status', 'quote-stale');
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
    current_quote ->> 'termsVersion',
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
      return jsonb_build_object('status', 'quote-stale');
    end if;
    return public.project_existing_booking_request_submission_attempt(
      existing_attempt, target_intent_fingerprint, intent, true
    );
  end if;

  insert into public.booking_request_submission_attempts (
    customer_user_id, idempotency_key, payment_lifecycle_id,
    profile_id, locale, public_slug, requested_search,
    quote_fingerprint, quote_payload, intent_fingerprint, intent_payload,
    state
  ) values (
    target_customer_user_id, target_idempotency_key, gen_random_uuid(),
    current_profile_id, target_locale, target_slug, target_search,
    displayed_fingerprint, current_quote - 'status', target_intent_fingerprint, intent,
    'authorizing'
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

  select * into existing_attempt
  from public.booking_request_submission_attempts attempts
  where attempts.customer_user_id = target_customer_user_id
    and (
      attempts.intent_fingerprint = target_intent_fingerprint
        and attempts.intent_dedupe_active
      or attempts.idempotency_key = target_idempotency_key
    )
  for update;
  if existing_attempt.quote_payload <> current_quote - 'status' then
    return jsonb_build_object('status', 'invalid');
  end if;
  return public.project_existing_booking_request_submission_attempt(
    existing_attempt, target_intent_fingerprint, intent, true
  );
end;
$_$;

ALTER FUNCTION "public"."prepare_booking_request_submission"("target_customer_user_id" "uuid", "target_idempotency_key" "uuid", "target_submission" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."project_booking_request_release_work"("target_work" "public"."booking_request_release_work") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."project_booking_request_release_work"("target_work" "public"."booking_request_release_work") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."project_existing_booking_request_submission_attempt"("target_attempt" "public"."booking_request_submission_attempts", "expected_intent_fingerprint" "text", "expected_intent_payload" "jsonb", "null_snapshot_is_ready" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare existing_request public.booking_requests;
begin
  if target_attempt.intent_fingerprint <> expected_intent_fingerprint
    or target_attempt.intent_payload <> expected_intent_payload then
    return jsonb_build_object('status', 'invalid');
  end if;
  if target_attempt.booking_request_id is not null then
    select * into existing_request
    from public.booking_requests requests
    where requests.id = target_attempt.booking_request_id;
    if found then
      return jsonb_build_object(
        'status', existing_request.status,
        'bookingRequestReference', existing_request.booking_request_reference,
        'responseDeadline', to_char(
          existing_request.response_deadline at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      );
    end if;
    return jsonb_build_object('status', 'reconciliation-required');
  end if;
  if target_attempt.state = 'authorization_failed' then
    return jsonb_build_object('status', 'authorization-failed');
  end if;
  if target_attempt.state in ('released', 'expired') then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if exists (
    select 1
    from public.booking_request_authorization_claims claims
    where claims.attempt_id = target_attempt.id
      and claims.state <> 'authorized'
      and public.booking_request_claim_state_is_reconcilable(claims.state)
  ) then
    return jsonb_build_object('status', 'reconciliation-required');
  end if;
  if target_attempt.state in (
      'authorizing', 'authorized', 'reconciliation_required', 'releasing'
    ) and target_attempt.payment_snapshot is not null then
    return jsonb_build_object(
      'status', 'ready',
      'attemptId', target_attempt.id,
      'paymentLifecycleId', target_attempt.payment_lifecycle_id,
      'paymentSnapshot', target_attempt.payment_snapshot,
      'providerIdentity', case
        when target_attempt.authorization_provider is null then null
        else jsonb_build_object(
          'provider', target_attempt.authorization_provider,
          'environment', target_attempt.authorization_environment,
          'merchantId', target_attempt.authorization_merchant_id,
          'terminalId', target_attempt.authorization_terminal_id
        )
      end
    );
  end if;
  if target_attempt.state = 'authorizing'
    and target_attempt.payment_snapshot is null then
    if not null_snapshot_is_ready then
      return jsonb_build_object('status', 'continue');
    end if;
    return jsonb_build_object(
      'status', 'ready',
      'attemptId', target_attempt.id,
      'paymentLifecycleId', target_attempt.payment_lifecycle_id,
      'paymentSnapshot', null,
      'providerIdentity', null
    );
  end if;
  return jsonb_build_object('status', 'reconciliation-required');
end;
$$;

ALTER FUNCTION "public"."project_existing_booking_request_submission_attempt"("target_attempt" "public"."booking_request_submission_attempts", "expected_intent_fingerprint" "text", "expected_intent_payload" "jsonb", "null_snapshot_is_ready" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."quarantine_booking_request_payment"("target_booking_request_id" "uuid", "target_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare work public.booking_request_capture_work;
declare capture_id uuid;
begin
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  select * into work from public.booking_request_capture_work capture where capture.booking_request_id=target_booking_request_id for update of capture;
  if work.payment_required_deadline is null then raise exception 'Payment Required quarantine source is invalid' using errcode='RC409'; end if;
  insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline)
    values(target_booking_request_id,work.payment_required_deadline) on conflict do nothing;
  update public.booking_request_payment_required_expiry_work set state='quarantined',diagnostic_reason=target_reason,last_evaluated_at=clock_timestamp()
    where booking_request_id=target_booking_request_id;
  select ledger.id into capture_id from public.payment_provider_operations ledger
    where ledger.claim_id=work.authorization_claim_id and ledger.operation_kind='capture' order by exists(select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id=target_booking_request_id and confirmations.capture_operation_id=ledger.id) desc,ledger.created_at desc,ledger.id limit 1;
  if capture_id is not null then perform public.invalidate_booking_request_payment_confirmation(target_booking_request_id,capture_id,'conflicting-evidence'); end if;
  return jsonb_build_object('status','quarantined');
end;
$$;

ALTER FUNCTION "public"."quarantine_booking_request_payment"("target_booking_request_id" "uuid", "target_reason" "text") OWNER TO "postgres";





CREATE OR REPLACE FUNCTION "public"."record_booking_request_capture_failure"("target_booking_request_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_provider_result" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record;
declare target_request public.booking_requests;
declare work public.booking_request_capture_work;
declare target_attempt public.booking_request_submission_attempts;
declare target_claim public.booking_request_authorization_claims;
declare ledger public.payment_provider_operations;
declare target_commitment public.cottage_booking_period_commitments;
declare recorded_at timestamptz;
begin
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  if not found then raise exception 'Booking Request definitive Capture failure evidence is invalid' using errcode='RC409'; end if;
  work := source.work;
  ledger := source.ledger;
  select * into target_request from public.booking_requests requests
  where requests.id = target_booking_request_id;
  select * into target_attempt from public.booking_request_submission_attempts attempts
  where attempts.id = work.attempt_id;
  select * into target_claim from public.booking_request_authorization_claims claims
  where claims.id = work.authorization_claim_id;
  select * into target_commitment from public.cottage_booking_period_commitments commitments
  where commitments.id = target_request.booking_period_commitment_id for update of commitments;
  perform 1 from public.cottage_inventory_commitments inventory
  where inventory.booking_period_commitment_id = target_commitment.id
  order by inventory.service_day, inventory.unit_kind, inventory.unit_id for update of inventory;
  perform 1 from public.cottage_booking_period_occupancies occupancies
  where occupancies.booking_period_commitment_id = target_commitment.id
  order by occupancies.service_day, occupancies.shift_id for update of occupancies;

  if ledger.id is null or (ledger.original_outcome in ('failed', 'indeterminate')) is not true
    or ledger.current_outcome is distinct from 'failed' or ledger.movement_reference is not null
    or (ledger.capture_execution_permit->>'leaseGeneration')::bigint < 1
    or (ledger.capture_execution_permit->>'leaseToken')::uuid is null
    or ledger.executed_at >= (ledger.capture_execution_permit ->> 'notAfter')::timestamptz
    or ledger.executed_at < (target_attempt.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz then
    raise exception 'Booking Request definitive Capture failure evidence is invalid' using errcode = 'RC409';
  end if;
  if work.state = 'payment_required' then
    if target_lease_generation is distinct from work.lease_generation
      or target_lease_token is distinct from work.lease_token
      or target_provider_result is distinct from jsonb_build_object('outcome','failed',
        'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,'retrySafe',false) then
      raise exception 'Payment Required replay evidence is invalid' using errcode = 'RC409';
    end if;
    return jsonb_build_object('status','payment-required','paymentRequiredWindow',jsonb_build_object(
      'recordedAt',to_char(work.payment_required_recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deadline',to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  end if;

  if target_request.id is null or target_request.status <> 'accepted'
    or work.state <> 'processing' or target_attempt.id is null or target_claim.id is null
    or target_lease_generation is distinct from work.lease_generation
    or target_lease_token is distinct from work.lease_token
    or clock_timestamp() >= work.lease_expires_at
    or (ledger.claim_id,ledger.claim_generation,ledger.operation_kind,ledger.payment_lifecycle_id,
      ledger.logical_operation_id,ledger.physical_attempt_id,ledger.amount_fils,ledger.currency,
      ledger.request_fingerprint) is distinct from
      (work.authorization_claim_id,work.authorization_claim_generation,'capture'::text,work.payment_lifecycle_id,
      work.capture_logical_operation_id,work.capture_physical_attempt_id,work.amount_fils,work.currency,
      work.request_fingerprint)
    or (work.recovery_operation_id is null and (
      work.lease_generation is distinct from (ledger.capture_execution_permit->>'leaseGeneration')::bigint
      or work.lease_token::text is distinct from ledger.capture_execution_permit->>'leaseToken'
      or ledger.capture_execution_permit is distinct from source.binding || jsonb_build_object(
        'purpose','booking-request-capture','workId',work.booking_request_id,
        'leaseGeneration',work.lease_generation,'leaseToken',work.lease_token,
        'notAfter',to_char(work.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
    or (work.recovery_operation_id is not null and (
      work.recovery_operation_id <> ledger.id
      or work.lease_generation <= (ledger.capture_execution_permit->>'leaseGeneration')::bigint))
    or target_provider_result is distinct from jsonb_build_object('outcome','failed',
      'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,'retrySafe',false)
    or target_attempt.booking_request_id is distinct from target_request.id
    or not target_attempt.intent_dedupe_active
    or target_attempt.payment_snapshot -> 'capture' is distinct from 'null'::jsonb
    or jsonb_array_length(target_attempt.payment_snapshot -> 'movements') <> 1
    or target_claim.attempt_id <> target_attempt.id or target_claim.state <> 'converted'
    or target_commitment.id is null or target_commitment.status <> 'pending_hold'
    or exists (select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id = target_request.id)
    or exists (select 1 from public.booking_request_provider_operation_identities identities
      where identities.attempt_id = target_attempt.id and identities.operation_kind = 'capture')
    or (select count(*) from public.payment_provider_operations operations
      where operations.payment_lifecycle_id = work.payment_lifecycle_id
        and operations.logical_operation_id = work.capture_logical_operation_id) <> 1
    or not exists (
      select 1 from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
    )
    or not exists (
      select 1 from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
    )
    or exists (
      select claim_items.unit_kind, claim_items.unit_id, claim_items.service_day, claim_items.price_iqd
      from public.booking_request_authorization_claim_items claim_items where claim_items.claim_id = target_claim.id
      except
      select inventory.unit_kind, inventory.unit_id, inventory.service_day, inventory.committed_price_iqd
      from public.cottage_inventory_commitments inventory where inventory.booking_period_commitment_id = target_commitment.id)
    or exists (
      select inventory.unit_kind, inventory.unit_id, inventory.service_day, inventory.committed_price_iqd
      from public.cottage_inventory_commitments inventory where inventory.booking_period_commitment_id = target_commitment.id
      except
      select claim_items.unit_kind, claim_items.unit_id, claim_items.service_day, claim_items.price_iqd
      from public.booking_request_authorization_claim_items claim_items where claim_items.claim_id = target_claim.id)
    or exists (
      select claim_occupancies.schedule_revision_id, claim_occupancies.shift_id, claim_occupancies.service_day
      from public.booking_request_authorization_claim_occupancies claim_occupancies where claim_occupancies.claim_id = target_claim.id
      except
      select occupancies.schedule_revision_id, occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id and occupancies.active)
    or exists (
      select occupancies.schedule_revision_id, occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id and occupancies.active
      except
      select claim_occupancies.schedule_revision_id, claim_occupancies.shift_id, claim_occupancies.service_day
      from public.booking_request_authorization_claim_occupancies claim_occupancies where claim_occupancies.claim_id = target_claim.id)
    or exists (
      select target_claim.schedule_revision_id, expected.shift_id,
        claim_items.service_day
      from public.booking_request_authorization_claim_items claim_items
      cross join lateral (
        select claim_items.unit_id as shift_id
        where claim_items.unit_kind = 'shift'
        union all
        select shifts.id
        from public.cottage_shifts shifts
        where claim_items.unit_kind = 'full_day_bundle'
          and shifts.schedule_revision_id = target_claim.schedule_revision_id
      ) expected
      where claim_items.claim_id = target_claim.id
      except
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
    )
    or exists (
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
      except
      select target_claim.schedule_revision_id, expected.shift_id,
        claim_items.service_day
      from public.booking_request_authorization_claim_items claim_items
      cross join lateral (
        select claim_items.unit_id as shift_id
        where claim_items.unit_kind = 'shift'
        union all
        select shifts.id
        from public.cottage_shifts shifts
        where claim_items.unit_kind = 'full_day_bundle'
          and shifts.schedule_revision_id = target_claim.schedule_revision_id
      ) expected
      where claim_items.claim_id = target_claim.id
    )
    or exists (select 1 from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id and not occupancies.active) then
    raise exception 'Booking Request definitive Capture failure evidence is invalid' using errcode = 'RC409';
  end if;

  recorded_at := date_trunc('milliseconds', clock_timestamp());
  update public.booking_request_capture_work capture_work
  set state = 'payment_required', outcome = 'failed', completed_at = recorded_at,
    payment_required_recorded_at = recorded_at,
    payment_required_deadline = recorded_at + interval '20 minutes'
  where capture_work.booking_request_id = work.booking_request_id returning * into work;
  insert into public.booking_request_status_notifications(
    booking_request_id, recipient_user_id, status, created_at
  ) values (target_request.id, target_request.customer_user_id, 'payment-required', recorded_at)
  on conflict do nothing;
  return jsonb_build_object('status','payment-required','paymentRequiredWindow',jsonb_build_object(
    'recordedAt',to_char(work.payment_required_recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deadline',to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
end;
$$;

ALTER FUNCTION "public"."record_booking_request_capture_failure"("target_booking_request_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_provider_result" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."record_booking_request_recovery_outcome"("target_attempt_id" "uuid", "target_step" "text", "target_ledger" "public"."payment_provider_operations", "target_deadline" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare next_state text;
declare request_id uuid;
begin
  select attempts.booking_request_id into request_id from public.booking_request_payment_recovery_attempts attempts where attempts.id=target_attempt_id;
  perform 1 from public.booking_requests requests where requests.id=request_id for update of requests;
  next_state := case
    when target_ledger.current_outcome='indeterminate' then 'blocked'
    when target_step='original-release' and target_ledger.current_outcome='succeeded' then 'original_released'
    when target_step='original-release' then 'blocked'
    when target_step='replacement-authorization' and target_ledger.current_outcome='succeeded' then 'replacement_authorized'
    when target_step='replacement-authorization' then 'safely_failed'
    when target_step='replacement-capture' and target_ledger.current_outcome='succeeded'
      and target_ledger.authoritative_outcome_at < target_deadline then 'succeeded'
    when target_step='replacement-capture' and target_ledger.current_outcome='succeeded' then 'late_succeeded'
    when target_step='replacement-capture' then 'capture_failed'
    when target_step='replacement-release' and target_ledger.current_outcome='succeeded' then 'safely_failed'
    else 'blocked' end;
  update public.booking_request_payment_recovery_attempts attempts set state=next_state,updated_at=clock_timestamp()
    where attempts.id=target_attempt_id;
  if target_ledger.current_outcome='indeterminate'
    or (target_step in ('original-release','replacement-release') and target_ledger.current_outcome='failed') then
    perform public.quarantine_booking_request_payment(request_id,'unsafe-recovery-'||target_step||'-'||target_ledger.current_outcome);
  end if;
  return jsonb_strip_nulls(jsonb_build_object('outcome',target_ledger.current_outcome,
    'providerRequestId',target_ledger.provider_request_id,'providerReference',target_ledger.provider_reference,
    'movementReference',target_ledger.movement_reference,'retrySafe',next_state='safely_failed'));
end;
$$;

ALTER FUNCTION "public"."record_booking_request_recovery_outcome"("target_attempt_id" "uuid", "target_step" "text", "target_ledger" "public"."payment_provider_operations", "target_deadline" timestamp with time zone) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_booking_confirmation_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'Booking confirmation outcomes are immutable' using errcode = 'RC204';
end;
$$;

ALTER FUNCTION "public"."reject_booking_confirmation_change"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_booking_period_overlap_with_authorization_claim"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exists (
    select 1
    from public.booking_request_authorization_claims claims
    where claims.customer_user_id = new.customer_user_id
	      and public.booking_request_claim_state_is_active(claims.state)
      and claims.access_ranges && new.access_ranges
  ) then
    raise exception 'The Customer has an overlapping Authorization Claim'
      using errcode = 'RC409';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."reject_booking_period_overlap_with_authorization_claim"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_booking_request_payment_history_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'Booking Request payment history is immutable' using errcode = 'RC204';
end;
$$;

ALTER FUNCTION "public"."reject_booking_request_payment_history_change"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_booking_request_payment_recovery_history_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if old.state in ('safely_failed','succeeded','late_succeeded') and old is distinct from new then
    raise exception 'Completed payment recovery attempts are immutable' using errcode='RC204'; end if;
  if old.booking_request_id is distinct from new.booking_request_id
    or old.command_key is distinct from new.command_key
    or old.generation is distinct from new.generation
    or old.replacement_method is distinct from new.replacement_method
    or old.created_at is distinct from new.created_at then
    raise exception 'Booking Request payment recovery history is immutable'
      using errcode = 'RC204';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."reject_booking_request_payment_recovery_history_change"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_booking_request_payment_required_expiry_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_table_name = 'booking_request_payment_required_expiry_work' then
    if old.id is distinct from new.id
      or old.booking_request_id is distinct from new.booking_request_id
      or old.payment_required_deadline is distinct from new.payment_required_deadline
      or old.created_at is distinct from new.created_at
      or (old.state = 'complete' and new.state <> 'quarantined')
      or old.quarantined_at is not null
      or (old.state,new.state) not in (
        ('processing','processing'),('processing','attention_required'),
        ('attention_required','attention_required'),('attention_required','processing'),
        ('processing','complete'),('attention_required','complete'),
        ('processing','quarantined'),('attention_required','quarantined'),('complete','quarantined')
      ) then
      raise exception 'Payment Required expiry work is immutable' using errcode='RC204';
    end if;
  elsif old is distinct from new and not (
    old.owner='expiry' and old.provider_operation_id is null and new.provider_operation_id is not null
    and to_jsonb(old)-'provider_operation_id'=to_jsonb(new)-'provider_operation_id'
  ) then
    raise exception 'Payment Required expiry operation is immutable' using errcode='RC204';
  end if;
  if tg_table_name = 'booking_request_payment_required_expiry_work' then
    if new.state='quarantined' then
      new.quarantined_at := clock_timestamp(); new.quarantine_reason := new.diagnostic_reason;
      new.completed_at := null;
    elsif new.quarantined_at is not null or new.quarantine_reason is not null then
      raise exception 'Quarantine identity is invalid' using errcode='RC204';
    end if;
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."reject_booking_request_payment_required_expiry_change"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_booking_snapshot_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'Booking Snapshots are immutable' using errcode = 'RC204';
end;
$$;

ALTER FUNCTION "public"."reject_booking_snapshot_change"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_cottage_booking_period_occupancy_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."reject_cottage_booking_period_occupancy_update"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."save_booking_request_payment_snapshot"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare attempt public.booking_request_submission_attempts;
declare authorization_operation jsonb;
declare authorization_status text;
declare release_operation jsonb;
declare existing_authorization_operation jsonb;
declare existing_release_operation jsonb;
declare stored_operation_identity public.booking_request_provider_operation_identities;
declare next_state text;
declare expected_total_fils bigint;
declare expected_booking_price_fils bigint;
declare expected_commission_fils bigint;
declare locked_claim public.booking_request_authorization_claims;
declare next_claim_state public.booking_request_authorization_claim_state;
begin
  select * into attempt
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id
  for update;
  if not found then
    raise exception 'Booking Request submission attempt was not found'
      using errcode = 'RC404';
  end if;
  select * into locked_claim
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id
  for update;
  authorization_operation := target_payment_snapshot -> 'authorization';
  release_operation := nullif(
    target_payment_snapshot -> 'release',
    'null'::jsonb
  );
  expected_total_fils := (attempt.quote_payload ->> 'customerTotalIqd')::bigint * 1000;
  expected_booking_price_fils := (attempt.quote_payload ->> 'bookingPriceIqd')::bigint * 1000;
  expected_commission_fils := expected_booking_price_fils / 10;
  if target_payment_snapshot ->> 'paymentLifecycleId' <> attempt.payment_lifecycle_id::text
    or target_payment_snapshot ->> 'currency' <> 'IQD'
    or (select count(*) from jsonb_object_keys(target_payment_snapshot)) <> 15
    or not (target_payment_snapshot ?& array[
      'paymentLifecycleId', 'currency', 'bookingPriceFils',
      'bookingServiceFeeFils', 'customerTotalFils', 'authorization',
      'capture', 'release', 'refunds', 'financials', 'payout', 'holds',
      'dispute', 'audits', 'movements'
    ])
    or (target_payment_snapshot ->> 'bookingPriceFils')::bigint <> expected_booking_price_fils
    or (target_payment_snapshot ->> 'bookingServiceFeeFils')::bigint
      <> (attempt.quote_payload ->> 'serviceFeeIqd')::bigint * 1000
    or (target_payment_snapshot ->> 'customerTotalFils')::bigint <> expected_total_fils
    or authorization_operation is null
    or (select count(*) from jsonb_object_keys(authorization_operation)) <> 11
    or not (authorization_operation ?& array[
      'paymentLifecycleId', 'kind', 'logicalOperationId', 'attemptId', 'status',
      'amountFils', 'providerRequestId', 'providerReference',
      'movementReference', 'reconciliationRequired', 'retrySafe'
    ])
    or authorization_operation ->> 'kind' <> 'authorization'
    or authorization_operation ->> 'paymentLifecycleId' <> attempt.payment_lifecycle_id::text
    or authorization_operation ->> 'logicalOperationId'
      <> (attempt.payment_lifecycle_id::text || ':authorization')
    or authorization_operation ->> 'attemptId'
      !~ ('^' || attempt.payment_lifecycle_id::text || ':authorization:attempt-[1-9][0-9]*$')
    or (authorization_operation ->> 'amountFils')::bigint <> expected_total_fils
    or authorization_operation ->> 'status' not in ('pending', 'succeeded', 'failed')
    or jsonb_typeof(authorization_operation -> 'reconciliationRequired') <> 'boolean'
    or jsonb_typeof(authorization_operation -> 'retrySafe') <> 'boolean'
    or target_payment_snapshot -> 'capture' <> 'null'::jsonb
    or target_payment_snapshot -> 'refunds' <> '[]'::jsonb
    or target_payment_snapshot -> 'dispute' <> 'null'::jsonb
    or target_payment_snapshot -> 'audits' <> '[]'::jsonb
    or target_payment_snapshot -> 'holds'
      <> '{"administrator":false,"dispute":false}'::jsonb
    or target_payment_snapshot -> 'financials' <> jsonb_build_object(
      'refundedBookingPriceFils', 0,
      'refundedBookingServiceFeeFils', 0,
      'remainingBookingPriceFils', expected_booking_price_fils,
      'remainingBookingServiceFeeFils',
        (attempt.quote_payload ->> 'serviceFeeIqd')::bigint * 1000,
      'marketplaceCommissionFils', expected_commission_fils,
      'ownerEntitlementFils', expected_booking_price_fils - expected_commission_fils
    )
    or target_payment_snapshot -> 'payout' <> jsonb_build_object(
      'status', 'not_eligible',
      'eligibleFils', expected_booking_price_fils - expected_commission_fils,
      'paidFils', 0, 'providerFeeFils', 0, 'providerReserveFils', 0,
      'recoveryExposureFils', 0, 'recoveryBalanceFils', 0,
      'automaticOwnerDebitFils', 0, 'paidWhileBlocked', false,
      'settlement', null
    ) then
    raise exception 'Stored Payment Lifecycle does not match the Booking Request intent'
      using errcode = '22023';
  end if;
  authorization_status := authorization_operation ->> 'status';
  if authorization_status = 'succeeded' and (
    coalesce(authorization_operation ->> 'providerRequestId', '') = ''
    or coalesce(authorization_operation ->> 'providerReference', '') = ''
    or coalesce(authorization_operation ->> 'movementReference', '') = ''
    or (authorization_operation ->> 'reconciliationRequired')::boolean
    or (authorization_operation ->> 'retrySafe')::boolean
    or jsonb_array_length(target_payment_snapshot -> 'movements') < 1
    or (
      release_operation is null
      and jsonb_array_length(target_payment_snapshot -> 'movements') <> 1
    )
    or target_payment_snapshot -> 'movements' -> 0 <> jsonb_build_object(
      'kind', 'authorization',
      'logicalOperationId', authorization_operation ->> 'logicalOperationId',
      'attemptId', authorization_operation ->> 'attemptId',
      'amountFils', expected_total_fils,
      'movementReference', authorization_operation ->> 'movementReference',
      'recordedAt', target_payment_snapshot -> 'movements' -> 0 ->> 'recordedAt'
    )
    or coalesce(target_payment_snapshot -> 'movements' -> 0 ->> 'recordedAt', '') = ''
  ) then
    raise exception 'Successful Payment Authorization evidence is invalid'
      using errcode = '22023';
  end if;
  if authorization_status = 'failed' and (
    not (
      (
        coalesce(authorization_operation ->> 'providerRequestId', '') <> ''
        and coalesce(authorization_operation ->> 'providerReference', '') <> ''
      ) or (
        authorization_operation -> 'providerRequestId' = 'null'::jsonb
        and authorization_operation -> 'providerReference' = 'null'::jsonb
      )
    )
    or authorization_operation -> 'movementReference' <> 'null'::jsonb
    or (authorization_operation ->> 'reconciliationRequired')::boolean
    or jsonb_array_length(target_payment_snapshot -> 'movements') <> 0
  ) then
    raise exception 'Failed Payment Authorization evidence is invalid'
      using errcode = '22023';
  end if;
  if authorization_status = 'pending' and (
    (authorization_operation ->> 'retrySafe')::boolean
    or (
      authorization_operation -> 'providerRequestId' = 'null'::jsonb
      and authorization_operation -> 'providerReference' = 'null'::jsonb
      and authorization_operation -> 'movementReference' = 'null'::jsonb
      and (authorization_operation ->> 'reconciliationRequired')::boolean
    )
    or (
      coalesce(authorization_operation ->> 'providerRequestId', '') <> ''
      and coalesce(authorization_operation ->> 'providerReference', '') <> ''
      and coalesce(authorization_operation ->> 'movementReference', '') <> ''
      and not (authorization_operation ->> 'reconciliationRequired')::boolean
    )
    or not (
      (
        authorization_operation -> 'providerRequestId' = 'null'::jsonb
        and authorization_operation -> 'providerReference' = 'null'::jsonb
        and authorization_operation -> 'movementReference' = 'null'::jsonb
      )
      or (
        coalesce(authorization_operation ->> 'providerRequestId', '') <> ''
        and coalesce(authorization_operation ->> 'providerReference', '') <> ''
        and coalesce(authorization_operation ->> 'movementReference', '') <> ''
      )
    )
    or jsonb_array_length(target_payment_snapshot -> 'movements') <> 0
  ) then
    raise exception 'Pending Payment Authorization evidence is invalid'
      using errcode = '22023';
  end if;
  if release_operation is not null then
    if authorization_status <> 'succeeded'
      or (select count(*) from jsonb_object_keys(release_operation)) <> 11
      or not (release_operation ?& array[
        'paymentLifecycleId', 'kind', 'logicalOperationId', 'attemptId', 'status',
        'amountFils', 'providerRequestId', 'providerReference',
        'movementReference', 'reconciliationRequired', 'retrySafe'
      ])
      or release_operation ->> 'paymentLifecycleId' <> attempt.payment_lifecycle_id::text
      or release_operation ->> 'kind' <> 'release'
      or release_operation ->> 'logicalOperationId'
        <> (attempt.payment_lifecycle_id::text || ':release')
      or release_operation ->> 'attemptId'
        !~ ('^' || attempt.payment_lifecycle_id::text || ':release:attempt-[1-9][0-9]*$')
      or (release_operation ->> 'amountFils')::bigint <> expected_total_fils
      or release_operation ->> 'status' not in ('pending', 'succeeded', 'failed')
      or jsonb_typeof(release_operation -> 'reconciliationRequired') <> 'boolean'
      or jsonb_typeof(release_operation -> 'retrySafe') <> 'boolean' then
      raise exception 'Authorization Release does not match the Customer Total'
        using errcode = '22023';
    end if;
    if release_operation ->> 'status' = 'succeeded' and (
      coalesce(release_operation ->> 'providerRequestId', '') = ''
      or coalesce(release_operation ->> 'providerReference', '') = ''
      or coalesce(release_operation ->> 'movementReference', '') = ''
      or (release_operation ->> 'reconciliationRequired')::boolean
      or (release_operation ->> 'retrySafe')::boolean
      or jsonb_array_length(target_payment_snapshot -> 'movements') <> 2
      or target_payment_snapshot -> 'movements' -> 1 <> jsonb_build_object(
        'kind', 'release',
        'logicalOperationId', release_operation ->> 'logicalOperationId',
        'attemptId', release_operation ->> 'attemptId',
        'amountFils', expected_total_fils,
        'movementReference', release_operation ->> 'movementReference',
        'recordedAt', target_payment_snapshot -> 'movements' -> 1 ->> 'recordedAt'
      )
      or coalesce(target_payment_snapshot -> 'movements' -> 1 ->> 'recordedAt', '') = ''
    ) then
      raise exception 'Successful Authorization Release evidence is invalid'
        using errcode = '22023';
    end if;
    if release_operation ->> 'status' = 'failed' and (
      coalesce(release_operation ->> 'providerRequestId', '') = ''
      or coalesce(release_operation ->> 'providerReference', '') = ''
      or release_operation -> 'movementReference' <> 'null'::jsonb
      or (release_operation ->> 'reconciliationRequired')::boolean
      or not (release_operation ->> 'retrySafe')::boolean
      or jsonb_array_length(target_payment_snapshot -> 'movements') <> 1
    ) then
      raise exception 'Failed Authorization Release evidence is invalid'
        using errcode = '22023';
    end if;
    if release_operation ->> 'status' = 'pending' and (
      (release_operation ->> 'retrySafe')::boolean
      or (
        release_operation -> 'providerRequestId' = 'null'::jsonb
        and release_operation -> 'providerReference' = 'null'::jsonb
        and release_operation -> 'movementReference' = 'null'::jsonb
        and (release_operation ->> 'reconciliationRequired')::boolean
      )
      or (
        coalesce(release_operation ->> 'providerRequestId', '') <> ''
        and coalesce(release_operation ->> 'providerReference', '') <> ''
        and coalesce(release_operation ->> 'movementReference', '') <> ''
        and not (release_operation ->> 'reconciliationRequired')::boolean
      )
      or not (
        (
          release_operation -> 'providerRequestId' = 'null'::jsonb
          and release_operation -> 'providerReference' = 'null'::jsonb
          and release_operation -> 'movementReference' = 'null'::jsonb
        )
        or (
          coalesce(release_operation ->> 'providerRequestId', '') <> ''
          and coalesce(release_operation ->> 'providerReference', '') <> ''
          and coalesce(release_operation ->> 'movementReference', '') <> ''
        )
      )
      or jsonb_array_length(target_payment_snapshot -> 'movements') <> 1
    ) then
      raise exception 'Pending Authorization Release evidence is invalid'
        using errcode = '22023';
    end if;
    next_state := case
      when release_operation ->> 'status' = 'succeeded' then 'released'
      when release_operation ->> 'status' = 'failed' then 'reconciliation_required'
      when (release_operation ->> 'reconciliationRequired')::boolean then 'reconciliation_required'
      else 'releasing'
    end;
  else
    next_state := case
      when authorization_status = 'succeeded' then 'authorized'
      when authorization_status = 'failed' then 'authorization_failed'
      when (authorization_operation ->> 'reconciliationRequired')::boolean then 'reconciliation_required'
      else 'authorizing'
    end;
  end if;
  if attempt.state = 'finalized' then
    raise exception 'A finalized Booking Request payment snapshot cannot change'
      using errcode = 'RC204';
  end if;
  if target_provider_identity is null
    or (select count(*) from jsonb_object_keys(target_provider_identity)) <> 4
    or coalesce(target_provider_identity ->> 'provider', '') = ''
    or coalesce(target_provider_identity ->> 'environment', '') = ''
    or coalesce(target_provider_identity ->> 'merchantId', '') = ''
    or coalesce(target_provider_identity ->> 'terminalId', '') = '' then
    raise exception 'Payment provider identity is invalid' using errcode = '22023';
  end if;
  if attempt.authorization_provider is not null and (
    attempt.authorization_provider <> target_provider_identity ->> 'provider'
    or attempt.authorization_environment <> target_provider_identity ->> 'environment'
    or attempt.authorization_merchant_id <> target_provider_identity ->> 'merchantId'
    or attempt.authorization_terminal_id <> target_provider_identity ->> 'terminalId'
  ) then
    raise exception 'Payment provider identity does not match the durable attempt'
      using errcode = 'RC409';
  end if;

  existing_authorization_operation := attempt.payment_snapshot -> 'authorization';
  existing_release_operation := nullif(
    attempt.payment_snapshot -> 'release',
    'null'::jsonb
  );
  if attempt.state = 'expired' then
    raise exception 'Terminal Payment evidence cannot regress'
      using errcode = 'RC409';
  end if;
  if attempt.payment_snapshot is not null
    and attempt.payment_snapshot <> target_payment_snapshot then
    if attempt.state in ('released', 'authorization_failed') then
      raise exception 'Terminal Payment evidence cannot regress'
        using errcode = 'RC409';
    end if;
    if existing_release_operation is not null then
      if release_operation is null
        or existing_release_operation ->> 'logicalOperationId'
          <> release_operation ->> 'logicalOperationId'
        or existing_release_operation ->> 'status' = 'succeeded'
        or existing_release_operation ->> 'status' = 'failed' and (
          not (existing_release_operation ->> 'retrySafe')::boolean
          or release_operation ->> 'status' <> 'pending'
          or release_operation -> 'providerRequestId' <> 'null'::jsonb
          or release_operation -> 'providerReference' <> 'null'::jsonb
          or release_operation -> 'movementReference' <> 'null'::jsonb
          or (release_operation ->> 'attemptId') !~
            ('^' || attempt.payment_lifecycle_id::text || ':release:attempt-[1-9][0-9]*$')
          or substring(release_operation ->> 'attemptId' from ':attempt-([1-9][0-9]*)$')::integer
            <> substring(existing_release_operation ->> 'attemptId' from ':attempt-([1-9][0-9]*)$')::integer + 1
        )
        or existing_release_operation ->> 'status' <> 'failed'
          and existing_release_operation ->> 'attemptId'
            <> release_operation ->> 'attemptId' then
        raise exception 'Authorization Release evidence cannot regress'
          using errcode = 'RC409';
      end if;
    elsif existing_authorization_operation ->> 'status' = 'succeeded' then
      if authorization_operation <> existing_authorization_operation
        or release_operation is null then
        raise exception 'Successful Payment Authorization evidence cannot regress'
          using errcode = 'RC409';
      end if;
    elsif existing_authorization_operation ->> 'status' = 'failed' then
      raise exception 'Failed Payment Authorization evidence cannot change'
        using errcode = 'RC409';
    elsif authorization_operation ->> 'logicalOperationId'
        <> existing_authorization_operation ->> 'logicalOperationId'
      or authorization_operation ->> 'attemptId'
        <> existing_authorization_operation ->> 'attemptId'
      or release_operation is not null then
      raise exception 'Pending Payment Authorization evidence cannot be replaced'
        using errcode = 'RC409';
    end if;
  end if;

  if attempt.authorization_provider_request_id is not null
      and nullif(authorization_operation ->> 'providerRequestId', '')
        is distinct from attempt.authorization_provider_request_id
    or attempt.authorization_provider_reference is not null
      and nullif(authorization_operation ->> 'providerReference', '')
        is distinct from attempt.authorization_provider_reference
    or attempt.authorization_movement_reference is not null
      and nullif(authorization_operation ->> 'movementReference', '')
        is distinct from attempt.authorization_movement_reference
    or attempt.release_provider_request_id is not null
      and nullif(release_operation ->> 'providerRequestId', '')
        is distinct from attempt.release_provider_request_id
    or attempt.release_provider_reference is not null
      and nullif(release_operation ->> 'providerReference', '')
        is distinct from attempt.release_provider_reference
    or attempt.release_movement_reference is not null
      and nullif(release_operation ->> 'movementReference', '')
        is distinct from attempt.release_movement_reference then
    raise exception 'External Payment identity cannot change'
      using errcode = 'RC409';
  end if;
  if nullif(authorization_operation ->> 'providerRequestId', '') is not null then
    insert into public.booking_request_provider_operation_identities (
      attempt_id, operation_kind, provider, environment, merchant_id, terminal_id,
      provider_request_id, provider_reference, movement_reference
    ) values (
      target_attempt_id, 'authorization',
      target_provider_identity ->> 'provider',
      target_provider_identity ->> 'environment',
      target_provider_identity ->> 'merchantId',
      target_provider_identity ->> 'terminalId',
      authorization_operation ->> 'providerRequestId',
      authorization_operation ->> 'providerReference',
      nullif(authorization_operation ->> 'movementReference', '')
    ) on conflict (attempt_id, operation_kind) do nothing;
    select * into stored_operation_identity
    from public.booking_request_provider_operation_identities identities
    where identities.attempt_id = target_attempt_id
      and identities.operation_kind = 'authorization';
    if stored_operation_identity.provider <> target_provider_identity ->> 'provider'
      or stored_operation_identity.environment <> target_provider_identity ->> 'environment'
      or stored_operation_identity.merchant_id <> target_provider_identity ->> 'merchantId'
      or stored_operation_identity.terminal_id <> target_provider_identity ->> 'terminalId'
      or stored_operation_identity.provider_request_id <> authorization_operation ->> 'providerRequestId'
      or stored_operation_identity.provider_reference <> authorization_operation ->> 'providerReference'
      or stored_operation_identity.movement_reference is distinct from
        nullif(authorization_operation ->> 'movementReference', '') then
      raise exception 'External Payment identity cannot change'
        using errcode = 'RC409';
    end if;
  end if;
  if release_operation is not null
    and release_operation ->> 'status' = 'succeeded' then
    insert into public.booking_request_provider_operation_identities (
      attempt_id, operation_kind, provider, environment, merchant_id, terminal_id,
      provider_request_id, provider_reference, movement_reference
    ) values (
      target_attempt_id, 'release',
      target_provider_identity ->> 'provider',
      target_provider_identity ->> 'environment',
      target_provider_identity ->> 'merchantId',
      target_provider_identity ->> 'terminalId',
      release_operation ->> 'providerRequestId',
      release_operation ->> 'providerReference',
      nullif(release_operation ->> 'movementReference', '')
    ) on conflict (attempt_id, operation_kind) do nothing;
    select * into stored_operation_identity
    from public.booking_request_provider_operation_identities identities
    where identities.attempt_id = target_attempt_id
      and identities.operation_kind = 'release';
    if stored_operation_identity.provider <> target_provider_identity ->> 'provider'
      or stored_operation_identity.environment <> target_provider_identity ->> 'environment'
      or stored_operation_identity.merchant_id <> target_provider_identity ->> 'merchantId'
      or stored_operation_identity.terminal_id <> target_provider_identity ->> 'terminalId'
      or stored_operation_identity.provider_request_id <> release_operation ->> 'providerRequestId'
      or stored_operation_identity.provider_reference <> release_operation ->> 'providerReference'
      or stored_operation_identity.movement_reference is distinct from
        nullif(release_operation ->> 'movementReference', '') then
      raise exception 'External Payment identity cannot change'
        using errcode = 'RC409';
    end if;
  end if;
  update public.booking_request_submission_attempts
  set payment_snapshot = target_payment_snapshot,
    state = next_state,
    authorization_provider = coalesce(
      authorization_provider, target_provider_identity ->> 'provider'
    ),
    authorization_environment = coalesce(
      authorization_environment, target_provider_identity ->> 'environment'
    ),
    authorization_merchant_id = coalesce(
      authorization_merchant_id, target_provider_identity ->> 'merchantId'
    ),
    authorization_terminal_id = coalesce(
      authorization_terminal_id, target_provider_identity ->> 'terminalId'
    ),
    authorization_provider_request_id = coalesce(
      authorization_provider_request_id,
      nullif(authorization_operation ->> 'providerRequestId', '')
    ),
    authorization_provider_reference = coalesce(
      authorization_provider_reference,
      nullif(authorization_operation ->> 'providerReference', '')
    ),
    authorization_movement_reference = coalesce(
      authorization_movement_reference,
      nullif(authorization_operation ->> 'movementReference', '')
    ),
    release_provider_request_id = coalesce(release_provider_request_id,
      case when release_operation ->> 'status' = 'succeeded'
        then nullif(release_operation ->> 'providerRequestId', '') end),
    release_provider_reference = coalesce(release_provider_reference,
      case when release_operation ->> 'status' = 'succeeded'
        then nullif(release_operation ->> 'providerReference', '') end),
    release_movement_reference = coalesce(release_movement_reference,
      case when release_operation ->> 'status' = 'succeeded'
        then nullif(release_operation ->> 'movementReference', '') end),
    updated_at = now()
  where id = target_attempt_id;

  if locked_claim.id is not null then
    next_claim_state := public.booking_request_claim_state_after_payment(
      locked_claim.state,
      next_state,
      authorization_operation -> 'providerRequestId' <> 'null'::jsonb,
      release_operation ->> 'status'
    );
  end if;
  update public.booking_request_authorization_claims claims
  set state = next_claim_state,
    state_revision = state_revision + 1,
    updated_at = clock_timestamp()
  where claims.attempt_id = target_attempt_id
    and claims.state is distinct from next_claim_state;
  update public.booking_request_authorization_claim_occupancies occupancies
  set active = public.booking_request_claim_state_is_active(claims.state)
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id
    and occupancies.claim_id = claims.id
    and occupancies.active is distinct from
      public.booking_request_claim_state_is_active(claims.state);
  update public.booking_request_authorization_reconciliation_outbox outbox
  set observed_state_revision = claims.state_revision,
    state = case
      when public.booking_request_claim_state_is_terminal(claims.state)
        then 'complete'
      else 'pending'
    end,
    lease_token = null,
    lease_expires_at = null,
    updated_at = clock_timestamp()
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id
    and outbox.claim_id = claims.id;
end;
$_$;

ALTER FUNCTION "public"."save_booking_request_payment_snapshot"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."save_booking_request_release_snapshot"("target_work_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."save_booking_request_release_snapshot"("target_work_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."validate_booking_request_payment_recovery_confirmation"("target_booking_request_id" "uuid", "target_evidence" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record;
declare attempt public.booking_request_payment_recovery_attempts;
declare work public.booking_request_capture_work;
declare operation public.booking_request_payment_recovery_operations;
declare capture public.payment_provider_operations;
declare permit jsonb;
begin
  select * into source from public.lock_booking_request_payment_recovery_source((target_evidence->>'recoveryAttemptId')::uuid);
  attempt := source.attempt; work := source.work;
  permit := public.booking_request_recovery_execution_permit(attempt,work,source.payment_snapshot,'replacement-capture');
  select * into operation from public.booking_request_payment_recovery_operations operations
    where operations.recovery_attempt_id=attempt.id and operations.step='replacement-capture';
  capture := public.validate_booking_request_recovery_operation(operation,permit);
  if attempt.booking_request_id is distinct from target_booking_request_id or attempt.state <> 'succeeded'
    or capture.current_outcome <> 'succeeded' or capture.authoritative_outcome_at is null
    or capture.authoritative_outcome_at >= work.payment_required_deadline
    or target_evidence is distinct from jsonb_build_object(
      'purpose','booking-request-payment-recovery','bookingRequestId',work.booking_request_id,
      'recoveryAttemptId',attempt.id,'capturePhysicalAttemptId',capture.physical_attempt_id,
      'capture',jsonb_build_object('movementReference',capture.movement_reference)) then
    raise exception 'Recovery confirmation evidence is invalid' using errcode='RC409'; end if;
  return jsonb_build_object('submissionAttemptId',work.attempt_id,'authorizationClaimId',work.authorization_claim_id,
    'amountFils',work.amount_fils,'capturePhysicalAttemptId',capture.physical_attempt_id,
    'capture',jsonb_build_object('movementReference',capture.movement_reference));
end;
$$;

ALTER FUNCTION "public"."validate_booking_request_payment_recovery_confirmation"("target_booking_request_id" "uuid", "target_evidence" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."validate_booking_request_payment_required_expiry_target"("target" "public"."booking_request_payment_required_expiry_operations", "work" "public"."booking_request_capture_work", "payment_snapshot" "jsonb") RETURNS "public"."payment_provider_operations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare capture_evidence public.payment_provider_operations;
declare authorization_evidence public.payment_provider_operations;
declare ledger public.payment_provider_operations;
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
  if target.operation_kind='refund' then
    select * into capture_evidence from public.payment_provider_operations operations where operations.id=target.capture_provider_operation_id for update of operations;
    if capture_evidence.current_outcome is distinct from 'succeeded' or capture_evidence.original_outcome='failed'
      or capture_evidence.operation_kind is distinct from 'capture' or capture_evidence.movement_reference is null
      or capture_evidence.authoritative_outcome_at is distinct from target.capture_occurred_at
      or target.capture_occurred_at < work.payment_required_deadline
      or (capture_evidence.payment_lifecycle_id,capture_evidence.claim_id,capture_evidence.claim_generation,capture_evidence.amount_fils,
          capture_evidence.currency,capture_evidence.provider,capture_evidence.environment,capture_evidence.merchant_id,capture_evidence.terminal_id)
        is distinct from (target.authorization_payment_lifecycle_id,target.authorization_claim_id,target.authorization_claim_generation,target.amount_fils,
          target.currency,target.provider,target.environment,target.merchant_id,target.terminal_id)
      or capture_evidence.recorded_at is null then raise exception 'Corrective refund capture is invalid' using errcode='RC409'; end if;
    release_identity:=target.expiry_work_id::text||':corrective-refund:'||capture_evidence.id::text;
  end if;
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
    select * into ledger from public.payment_provider_operations operations
      where operations.id=target.provider_operation_id for update of operations;
    if ledger.recovery_attempt_id is not null or ledger.capture_execution_permit is not null
      or ledger.executed_at < work.payment_required_deadline then
      raise exception 'Expiry provider ownership is invalid' using errcode='RC409'; end if;
  end if;
  if ledger.id is null or ledger.id is distinct from target.provider_operation_id
    or (ledger.operation_kind,ledger.claim_id,ledger.claim_generation,ledger.payment_lifecycle_id,
      ledger.logical_operation_id,ledger.physical_attempt_id,ledger.provider_idempotency_key,
      ledger.amount_fils,ledger.currency,ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,
      ledger.request_fingerprint) is distinct from
    (target.operation_kind,target.authorization_claim_id,target.authorization_claim_generation,target.authorization_payment_lifecycle_id,
      target.release_logical_operation_id,target.release_physical_attempt_id,target.provider_idempotency_key,
      target.amount_fils,target.currency,target.provider,target.environment,target.merchant_id,target.terminal_id,
      target.request_fingerprint)
    or ledger.recorded_at is null
    or (ledger.original_outcome <> 'indeterminate' and ledger.current_outcome <> ledger.original_outcome)
    or (ledger.current_outcome='indeterminate') is distinct from (ledger.authoritative_outcome_at is null)
    or (ledger.current_outcome='failed') is distinct from (ledger.movement_reference is null)
    or ledger.authoritative_outcome_at < ledger.executed_at
    or ledger.executed_at < predecessor_time then
    raise exception 'Expiry provider evidence is invalid' using errcode='RC409'; end if;
  return ledger;
end;
$$;

ALTER FUNCTION "public"."validate_booking_request_payment_required_expiry_target"("target" "public"."booking_request_payment_required_expiry_operations", "work" "public"."booking_request_capture_work", "payment_snapshot" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."validate_booking_request_recovery_operation"("target_operation" "public"."booking_request_payment_recovery_operations", "target_permit" "jsonb") RETURNS "public"."payment_provider_operations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare ledger public.payment_provider_operations;
declare binding jsonb := target_permit->'binding';
begin
  select * into ledger from public.payment_provider_operations operations
    where operations.id=target_operation.provider_operation_id for update of operations;
  if target_operation.id is null or ledger.id is null
    or target_operation.execution_permit is distinct from target_permit
    or target_operation.recovery_attempt_id::text is distinct from target_permit->>'attemptId'
    or target_operation.step is distinct from target_permit->>'step'
    or (ledger.recovery_attempt_id::text,ledger.claim_id::text,ledger.claim_generation,
      ledger.operation_kind,ledger.payment_lifecycle_id::text,ledger.logical_operation_id,
      ledger.physical_attempt_id,ledger.amount_fils,ledger.currency,
      ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,
      ledger.provider_idempotency_key,ledger.request_fingerprint) is distinct from
      (target_permit->>'attemptId',binding->>'authorizationClaimId',
      (binding->>'authorizationClaimGeneration')::integer,
      case target_permit->>'step' when 'replacement-authorization' then 'authorization'
        when 'replacement-capture' then 'capture' else 'release' end,
      binding->>'paymentLifecycleId',binding->>'logicalOperationId',binding->>'physicalAttemptId',
      (binding->>'amountFils')::bigint,binding->>'currency',
      binding#>>'{providerIdentity,provider}',binding#>>'{providerIdentity,environment}',
      binding#>>'{providerIdentity,merchantId}',binding#>>'{providerIdentity,terminalId}',
      target_permit->>'idempotencyKey',binding->>'requestFingerprint')
    or ledger.recorded_at is null
    or ledger.current_outcome is distinct from target_operation.outcome
    or (ledger.original_outcome <> 'indeterminate' and ledger.current_outcome <> ledger.original_outcome)
    or ledger.authoritative_outcome_at is distinct from target_operation.authoritative_outcome_at
    or (ledger.current_outcome='indeterminate') is distinct from (ledger.authoritative_outcome_at is null)
    or (ledger.current_outcome='failed') is distinct from (ledger.movement_reference is null)
    or ledger.authoritative_outcome_at < ledger.executed_at
    or ledger.executed_at < (binding->>'predecessorOutcomeAt')::timestamptz
    or ledger.capture_execution_permit is distinct from
      (case when ledger.operation_kind='capture' then target_permit end) then
    raise exception 'Recovery provider evidence is invalid' using errcode='RC409';
  end if;
  return ledger;
end;
$$;

ALTER FUNCTION "public"."validate_booking_request_recovery_operation"("target_operation" "public"."booking_request_payment_recovery_operations", "target_permit" "jsonb") OWNER TO "postgres";
CREATE OR REPLACE FUNCTION public.payment_operation_admission(target public.payment_provider_operations, execute_allowed boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  select jsonb_build_object('operationId',target.id,'purpose',target.admission->>'purpose',
    'providerIdentity',jsonb_build_object('provider',target.provider,'environment',target.environment,'merchantId',target.merchant_id,'terminalId',target.terminal_id),
    'idempotencyKey',target.provider_idempotency_key,'requestFingerprint',target.request_fingerprint,
    'binding',jsonb_build_object('kind',target.operation_kind,'paymentLifecycleId',target.payment_lifecycle_id,
      'logicalOperationId',target.logical_operation_id,'attemptId',target.physical_attempt_id,'amountFils',target.amount_fils,'currency',target.currency),
    'notBefore',target.admission->'notBefore','notAfter',target.admission->'notAfter','mode',case when execute_allowed then 'execute' else 'reconcile' end);
$$;

CREATE OR REPLACE FUNCTION public.validate_payment_provider_observation(target_result jsonb,target_operation_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare evidence jsonb := target_result->'evidence';
declare occurrence timestamptz;
declare closure timestamptz;
begin
  if target_result is null or jsonb_typeof(target_result)<>'object' or evidence is null or jsonb_typeof(evidence)<>'object'
    or evidence ?& array['operationId','eventId','provenance','originalOutcome','executedAt','occurredAt','closedAt'] is not true
    or evidence-array['operationId','eventId','provenance','originalOutcome','executedAt','occurredAt','closedAt']<>'{}'
    or evidence->>'operationId' is distinct from target_operation_id::text
    or jsonb_typeof(evidence->'eventId') is distinct from 'string' or length(evidence->>'eventId') not between 1 and 200
    or (evidence->>'provenance' in ('fictional-provider','provider-event','legacy-simulated')) is not true then
    raise exception 'Payment observation identity is invalid' using errcode='RC409'; end if;
  occurrence := (evidence->>'occurredAt')::timestamptz;
  closure := (evidence->>'closedAt')::timestamptz;
  if (occurrence is not null and (not isfinite(occurrence) or occurrence>clock_timestamp()))
    or (closure is not null and (not isfinite(closure) or closure>clock_timestamp())) then
    raise exception 'Payment observation clock is invalid' using errcode='RC409'; end if;
  if target_result->>'outcome'='not-executed' then
    if target_result-array['outcome','evidence']<>'{}' or occurrence is not null or closure is null
      or evidence->'originalOutcome' is distinct from 'null'::jsonb or evidence->'executedAt' is distinct from 'null'::jsonb then
      raise exception 'Payment absence receipt is invalid' using errcode='RC409'; end if;
  elsif target_result->>'outcome' in ('succeeded','failed','indeterminate') then
    if closure is not null
      or coalesce(evidence->>'originalOutcome','') not in ('succeeded','failed','indeterminate')
      or ((evidence->>'executedAt')::timestamptz is null and evidence->>'provenance'<>'legacy-simulated')
      or (evidence->>'executedAt')::timestamptz>clock_timestamp()
      or jsonb_typeof(target_result->'providerRequestId') is distinct from 'string'
      or length(target_result->>'providerRequestId')=0 or jsonb_typeof(target_result->'providerReference') is distinct from 'string'
      or length(target_result->>'providerReference')=0
      or (target_result->>'outcome'='indeterminate' and occurrence is not null)
      or (target_result->>'outcome'<>'indeterminate' and occurrence is null and evidence->>'provenance'<>'legacy-simulated') then
      raise exception 'Payment observation references or occurrence are invalid' using errcode='RC409'; end if;
    if target_result->>'outcome'='failed' then
      if target_result-array['outcome','providerRequestId','providerReference','retrySafe','evidence']<>'{}'
        or jsonb_typeof(target_result->'retrySafe') is distinct from 'boolean' then
        raise exception 'Failed payment observation is invalid' using errcode='RC409'; end if;
    elsif target_result-array['outcome','providerRequestId','providerReference','movementReference','evidence']<>'{}'
      or jsonb_typeof(target_result->'movementReference') is distinct from 'string' or length(target_result->>'movementReference')=0 then
      raise exception 'Payment movement observation is invalid' using errcode='RC409'; end if;
  else raise exception 'Payment observation outcome is invalid' using errcode='RC409'; end if;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
  raise exception 'Payment observation is invalid' using errcode='RC409';
end;
$$;

CREATE OR REPLACE FUNCTION public.validate_simulated_payment_binding(target_binding jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Fictional effect unavailable' using errcode='42501'; end if;
  if target_binding is null or jsonb_typeof(target_binding)<>'object'
    or target_binding ?& array['operationId','providerIdentity','idempotencyKey','requestFingerprint','notBefore','notAfter'] is not true
    or target_binding-array['operationId','providerIdentity','idempotencyKey','requestFingerprint','notBefore','notAfter']<>'{}'
    or target_binding->'providerIdentity' is distinct from '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    or (target_binding->>'operationId')::uuid is null or coalesce(length(target_binding->>'idempotencyKey'),0)=0
    or coalesce(target_binding->>'requestFingerprint','') !~ '^[0-9a-f]{64}$'
    or (target_binding->>'notBefore' is not null and not isfinite((target_binding->>'notBefore')::timestamptz))
    or (target_binding->>'notAfter' is not null and not isfinite((target_binding->>'notAfter')::timestamptz)) then
    raise exception 'Fictional effect binding is invalid' using errcode='RC409'; end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.simulated_payment_absence_receipt(target_binding jsonb,closed_at timestamptz) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  select jsonb_build_object('outcome','not-executed','evidence',jsonb_build_object(
    'operationId',target_binding->>'operationId','eventId','sim-closed-'||(target_binding->>'operationId'),
    'provenance','fictional-provider','originalOutcome',null,'executedAt',null,'occurredAt',null,'closedAt',closed_at));
$$;

CREATE OR REPLACE FUNCTION public.persist_simulated_payment_effect(target_binding jsonb,target_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare winner public.simulated_payment_effects;
declare inserted_id uuid;
declare checked_at timestamptz;
declare proposed jsonb;
begin
  perform public.validate_simulated_payment_binding(target_binding);
  -- Host clocks describe a fictional proposal; only the database stamps the effect.
  if jsonb_typeof(target_result#>'{evidence,executedAt}') is distinct from 'string'
    or isfinite((target_result#>>'{evidence,executedAt}')::timestamptz) is not true
    or (target_result->>'outcome'<>'indeterminate' and (
      jsonb_typeof(target_result#>'{evidence,occurredAt}') is distinct from 'string'
      or isfinite((target_result#>>'{evidence,occurredAt}')::timestamptz) is not true))
    or (target_result->>'outcome'='indeterminate' and target_result#>'{evidence,occurredAt}' is distinct from 'null'::jsonb) then
    raise exception 'Fictional proposal clock shape is invalid' using errcode='RC409'; end if;
  proposed:=jsonb_set(jsonb_set(target_result,'{evidence,executedAt}',to_jsonb(clock_timestamp())),
    '{evidence,occurredAt}',case when target_result->>'outcome'='indeterminate' then 'null'::jsonb else to_jsonb(clock_timestamp()) end);
  perform public.validate_payment_provider_observation(proposed,(target_binding->>'operationId')::uuid);
  if target_result->>'outcome'='not-executed' or target_result#>>'{evidence,provenance}'<>'fictional-provider'
    or target_result#>>'{evidence,originalOutcome}' is distinct from target_result->>'outcome' then
    raise exception 'Fictional execution proposal is invalid' using errcode='RC409'; end if;
  insert into public.simulated_payment_effects(operation_id,provider,environment,merchant_id,terminal_id,idempotency_key,binding,state,physical_execution_count)
    values((target_binding->>'operationId')::uuid,target_binding#>>'{providerIdentity,provider}',target_binding#>>'{providerIdentity,environment}',
      target_binding#>>'{providerIdentity,merchantId}',target_binding#>>'{providerIdentity,terminalId}',target_binding->>'idempotencyKey',target_binding,'reserved',0)
    on conflict(provider,environment,merchant_id,terminal_id,idempotency_key) do nothing returning operation_id into inserted_id;
  select * into winner from public.simulated_payment_effects effects where
    (effects.provider,effects.environment,effects.merchant_id,effects.terminal_id,effects.idempotency_key)=
    (target_binding#>>'{providerIdentity,provider}',target_binding#>>'{providerIdentity,environment}',target_binding#>>'{providerIdentity,merchantId}',target_binding#>>'{providerIdentity,terminalId}',target_binding->>'idempotencyKey')
    for update of effects;
  if not found then raise exception 'Fictional arbitration winner unavailable' using errcode='55P03'; end if;
  if winner.binding is distinct from target_binding then raise exception 'Fictional effect binding changed' using errcode='RC409'; end if;
  if inserted_id is null then
    if winner.state='reserved' then raise exception 'Fictional effect unresolved' using errcode='55P03'; end if;
    return winner.result;
  end if;
  -- Contention has ended. Only this clock may authorize the new fictional effect.
  checked_at := clock_timestamp();
  if checked_at >= (target_binding->>'notAfter')::timestamptz then
    update public.simulated_payment_effects set state='closed-not-executed',result=public.simulated_payment_absence_receipt(target_binding,checked_at),updated_at=checked_at
      where operation_id=winner.operation_id returning * into winner;
  elsif checked_at < (target_binding->>'notBefore')::timestamptz then
    raise exception 'Fictional effect is not yet admitted' using errcode='RC409';
  else
    proposed:=jsonb_set(jsonb_set(target_result,'{evidence,executedAt}',to_jsonb(checked_at)),
      '{evidence,occurredAt}',case when target_result->>'outcome'='indeterminate' then 'null'::jsonb else to_jsonb(checked_at) end);
    perform public.validate_payment_provider_observation(proposed,winner.operation_id);
    update public.simulated_payment_effects set state='executed',physical_execution_count=1,
      result=proposed,updated_at=checked_at
      where operation_id=winner.operation_id returning * into winner;
  end if;
  return winner.result;
exception when unique_violation then raise exception 'Fictional operation identity changed' using errcode='RC409';
  when invalid_datetime_format or datetime_field_overflow then raise exception 'Fictional proposal clock is invalid' using errcode='RC409';
end;
$$;

CREATE OR REPLACE FUNCTION public.seal_simulated_payment_absence(target_binding jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare winner public.simulated_payment_effects;
begin
  perform public.validate_simulated_payment_binding(target_binding);
  insert into public.simulated_payment_effects(operation_id,provider,environment,merchant_id,terminal_id,idempotency_key,binding,state,result,physical_execution_count)
    values((target_binding->>'operationId')::uuid,target_binding#>>'{providerIdentity,provider}',target_binding#>>'{providerIdentity,environment}',
      target_binding#>>'{providerIdentity,merchantId}',target_binding#>>'{providerIdentity,terminalId}',target_binding->>'idempotencyKey',target_binding,
      'closed-not-executed',public.simulated_payment_absence_receipt(target_binding,clock_timestamp()),0)
    on conflict(provider,environment,merchant_id,terminal_id,idempotency_key) do nothing;
  select * into winner from public.simulated_payment_effects effects where
    (effects.provider,effects.environment,effects.merchant_id,effects.terminal_id,effects.idempotency_key)=
    (target_binding#>>'{providerIdentity,provider}',target_binding#>>'{providerIdentity,environment}',target_binding#>>'{providerIdentity,merchantId}',target_binding#>>'{providerIdentity,terminalId}',target_binding->>'idempotencyKey')
    for update of effects;
  if not found or winner.state='reserved' then raise exception 'Fictional arbitration winner unavailable' using errcode='55P03'; end if;
  if winner.binding is distinct from target_binding then raise exception 'Fictional effect binding changed' using errcode='RC409'; end if;
  return winner.result;
exception when unique_violation then raise exception 'Fictional operation identity changed' using errcode='RC409';
end;
$$;

CREATE OR REPLACE FUNCTION public.resolve_simulated_payment_effect(target_binding jsonb,target_event_id text,target_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare winner public.simulated_payment_effects;
declare checked_at timestamptz;
declare proposed jsonb;
begin
  perform public.validate_simulated_payment_binding(target_binding);
  select * into winner from public.simulated_payment_effects effects where effects.operation_id=(target_binding->>'operationId')::uuid for update of effects;
  if not found or winner.binding is distinct from target_binding then raise exception 'Fictional resolution binding is invalid' using errcode='RC409'; end if;
  if winner.state='closed-not-executed' or winner.result->>'outcome'<>'indeterminate' then return winner.result; end if;
  if winner.result#>>'{evidence,eventId}' is distinct from target_event_id then return winner.result; end if;
  if jsonb_typeof(target_result#>'{evidence,occurredAt}') is distinct from 'string'
    or isfinite((target_result#>>'{evidence,occurredAt}')::timestamptz) is not true then
    raise exception 'Fictional resolution clock shape is invalid' using errcode='RC409'; end if;
  -- Original execution is immutable; this resolution's occurrence is database-owned.
  proposed:=jsonb_set(target_result,'{evidence,occurredAt}',to_jsonb(clock_timestamp()));
  perform public.validate_payment_provider_observation(proposed,winner.operation_id);
  if target_result->>'outcome' not in ('succeeded','failed') or target_result#>>'{evidence,provenance}'<>'fictional-provider'
    or target_result#>'{evidence,originalOutcome}' is distinct from winner.result#>'{evidence,originalOutcome}'
    or target_result#>'{evidence,executedAt}' is distinct from winner.result#>'{evidence,executedAt}'
    or (target_result->>'providerRequestId',target_result->>'providerReference') is distinct from
      (winner.result->>'providerRequestId',winner.result->>'providerReference')
    or (target_result->>'outcome'='succeeded' and target_result->>'movementReference' is distinct from winner.result->>'movementReference') then
    raise exception 'Fictional resolution result is invalid' using errcode='RC409'; end if;
  checked_at:=clock_timestamp();
  proposed:=jsonb_set(target_result,'{evidence,occurredAt}',to_jsonb(checked_at));
  perform public.validate_payment_provider_observation(proposed,winner.operation_id);
  update public.simulated_payment_effects set result=proposed,updated_at=checked_at
    where operation_id=winner.operation_id returning * into winner;
  return winner.result;
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'Fictional resolution clock is invalid' using errcode='RC409';
end;
$$;

CREATE OR REPLACE FUNCTION "public"."admit_booking_request_provider_operation"("target_operation" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
      raise exception 'Payment authorization permit is invalid or expired'
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
$_$;

CREATE OR REPLACE FUNCTION "public"."admit_booking_request_capture"("target_permit" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.payment_provider_operations;
declare expected_permit jsonb;
declare executed_at timestamptz;
declare execution_id uuid;
begin
  if public.booking_request_payment_quarantined((target_permit->>'bookingRequestId')::uuid) then return jsonb_build_object('outcome','not-executed'); end if;
  select * into source from public.lock_booking_request_capture_source(
    (target_permit ->> 'bookingRequestId')::uuid
  );
  if not found then raise exception 'Booking Request capture permit is invalid' using errcode = 'RC409'; end if;
  work := source.work;
  ledger := source.ledger;
  expected_permit := source.binding || jsonb_build_object(
    'purpose', 'booking-request-capture', 'workId', work.booking_request_id,
    'leaseGeneration', work.lease_generation, 'leaseToken', work.lease_token,
    'notAfter', to_char(work.lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  if work.state <> 'processing' or target_permit is distinct from expected_permit

    or (ledger.id is not null and ledger.capture_execution_permit is distinct from target_permit) then
    raise exception 'Booking Request capture permit is invalid' using errcode = 'RC409';
  end if;
  executed_at := clock_timestamp();
  if executed_at >= work.lease_expires_at then
    return jsonb_build_object('outcome', 'not-executed');
  end if;
  if ledger.id is null then
    execution_id:=gen_random_uuid();
    insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
      provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,
      capture_execution_permit,admission,evidence_provenance)
    values(execution_id,work.authorization_claim_id,work.authorization_claim_generation,'capture',work.provider,work.environment,work.merchant_id,work.terminal_id,
      work.provider_idempotency_key,work.request_fingerprint,work.payment_lifecycle_id,work.capture_logical_operation_id,work.capture_physical_attempt_id,work.amount_fils,work.currency,
      target_permit,jsonb_build_object('purpose','booking-request-capture','permit',target_permit,
        'notBefore',source.payment_snapshot#>>'{movements,0,recordedAt}','notAfter',target_permit->>'notAfter'),'admitted') returning * into ledger;
  end if;
  return public.payment_operation_admission(ledger,ledger.id=execution_id);
end;
$$;

CREATE OR REPLACE FUNCTION public.admit_booking_request_payment_recovery(target_permit jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare source record;
declare expected jsonb;
declare dispatched jsonb;
declare ledger public.payment_provider_operations;
declare operation_id uuid:=gen_random_uuid();
declare recovery_step text:=target_permit->>'step';
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Recovery admission unavailable' using errcode='42501'; end if;
  select * into ledger from public.payment_provider_operations operations
    where operations.recovery_attempt_id=(target_permit->>'attemptId')::uuid and operations.logical_operation_id=target_permit->>'operationId';
  if found then
    ledger:=public.lock_payment_observation_source(ledger.id,array['booking-request-payment-recovery']);
    if ledger.admission->'permit' is distinct from target_permit then raise exception 'Recovery admission binding changed' using errcode='RC409'; end if;
    if public.booking_request_payment_quarantined((ledger.admission#>>'{permit,binding,bookingRequestId}')::uuid) then return jsonb_build_object('status','not-admitted'); end if;
    return public.payment_operation_admission(ledger);
  end if;
  select * into source from public.lock_booking_request_payment_recovery_source((target_permit->>'attemptId')::uuid);
  expected:=public.booking_request_recovery_execution_permit(source.attempt,source.work,source.payment_snapshot,recovery_step);
  if target_permit is distinct from expected then raise exception 'Recovery admission permit is invalid' using errcode='RC409'; end if;
  select * into ledger from public.payment_provider_operations operations
    where operations.recovery_attempt_id=(source.attempt).id and operations.logical_operation_id=expected->>'operationId' for update of operations;
  if found then
    if ledger.admission->'permit' is distinct from target_permit then raise exception 'Recovery admission binding changed' using errcode='RC409'; end if;
    return public.payment_operation_admission(ledger);
  end if;
  if public.booking_request_payment_quarantined((source.work).booking_request_id)
    or public.booking_request_payment_required_expiry_completed((source.work).booking_request_id)
    or exists(select 1 from public.booking_request_payment_required_expiry_operations operations
      where operations.booking_request_id=(source.work).booking_request_id and operations.owner='expiry'
        and operations.authorization_payment_lifecycle_id=(expected#>>'{binding,paymentLifecycleId}')::uuid
        and operations.predecessor_movement_reference=expected#>>'{binding,predecessorMovementReference}') then
    return jsonb_build_object('status','not-admitted'); end if;
  dispatched:=public.lease_booking_request_payment_recovery_step((source.attempt).id);
  if dispatched->>'status'<>'leased' or dispatched->'permit' is distinct from expected
    or (recovery_step<>'replacement-release' and clock_timestamp()>=(source.work).payment_required_deadline) then
    return jsonb_build_object('status','not-admitted'); end if;
  insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,
    recovery_attempt_id,capture_execution_permit,admission,evidence_provenance)
  values(operation_id,(source.work).authorization_claim_id,(source.work).authorization_claim_generation,
    case recovery_step when 'replacement-authorization' then 'authorization' when 'replacement-capture' then 'capture' else 'release' end,
    (source.work).provider,(source.work).environment,(source.work).merchant_id,(source.work).terminal_id,
    expected->>'idempotencyKey',(source.work).request_fingerprint,(expected#>>'{binding,paymentLifecycleId}')::uuid,
    expected->>'operationId',expected#>>'{binding,physicalAttemptId}',(source.work).amount_fils,(source.work).currency,
    (source.attempt).id,case when recovery_step='replacement-capture' then expected end,
    jsonb_build_object('purpose','booking-request-payment-recovery','permit',expected,
      'notBefore',expected#>>'{binding,predecessorOutcomeAt}','notAfter',case when recovery_step<>'replacement-release' then expected->>'notAfter' end),'admitted')
    returning * into ledger;
  return public.payment_operation_admission(ledger,true);
end;
$$;

CREATE OR REPLACE FUNCTION public.admit_booking_request_payment_required_expiry(target_permit jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare source record;
declare target public.booking_request_payment_required_expiry_operations;
declare expected jsonb;
declare prepared jsonb;
declare ledger public.payment_provider_operations;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Expiry admission unavailable' using errcode='42501'; end if;
  select * into source from public.lock_booking_request_payment_required_expiry_source((target_permit#>>'{binding,bookingRequestId}')::uuid);
  select * into target from public.booking_request_payment_required_expiry_operations operations
    where operations.id=(target_permit->>'expiryOperationId')::uuid and operations.expiry_work_id=(source.expiry).id for update of operations;
  expected:=public.booking_request_payment_required_expiry_permit(target,(source.expiry).payment_required_deadline);
  if target.id is null or target.owner<>'expiry' or target_permit is distinct from expected then raise exception 'Expiry admission permit is invalid' using errcode='RC409'; end if;
  perform public.validate_booking_request_payment_required_expiry_target(target,source.work,source.payment_snapshot);
  if public.booking_request_payment_quarantined((source.work).booking_request_id) then return jsonb_build_object('status','not-admitted'); end if;
  select * into ledger from public.payment_provider_operations operations where
    (operations.provider,operations.environment,operations.merchant_id,operations.terminal_id,operations.provider_idempotency_key)=
    (target.provider,target.environment,target.merchant_id,target.terminal_id,target.provider_idempotency_key) for update of operations;
  if found then
    if ledger.admission->'permit' is distinct from target_permit then raise exception 'Expiry admission binding changed' using errcode='RC409'; end if;
    return public.payment_operation_admission(ledger);
  end if;
  if public.booking_request_payment_quarantined((source.work).booking_request_id) or (source.expiry).state='complete'
    or clock_timestamp()<(source.work).payment_required_deadline then raise exception 'Expiry admission is not allowed' using errcode='RC409'; end if;
  prepared:=public.prepare_booking_request_payment_required_expiry((source.work).booking_request_id,expected#>'{binding,providerIdentity}');
  if prepared->>'status' not in ('release','refund') or prepared->'permit' is distinct from expected then raise exception 'Expiry admission has lost ownership' using errcode='RC409'; end if;
  insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,admission,evidence_provenance)
  values(gen_random_uuid(),target.authorization_claim_id,target.authorization_claim_generation,target.operation_kind,target.provider,target.environment,target.merchant_id,target.terminal_id,
    target.provider_idempotency_key,target.request_fingerprint,target.authorization_payment_lifecycle_id,target.release_logical_operation_id,target.release_physical_attempt_id,target.amount_fils,target.currency,
    jsonb_build_object('purpose',expected->>'purpose','permit',expected,'notBefore',expected->>'notBefore','notAfter',null),'admitted') returning * into ledger;
  return public.payment_operation_admission(ledger,true);
end;
$$;

CREATE OR REPLACE FUNCTION public.reload_booking_request_payment_operation(target_operation jsonb,target_provider_request_id text,target_provider_reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  return public.payment_operation_admission(ledger);
end;
$$;

-- Caller holds the purpose's business-source locks before entering this recorder.
CREATE OR REPLACE FUNCTION public.accept_payment_provider_observation(target_operation_id uuid,target_result jsonb) RETURNS public.payment_provider_operations
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.payment_provider_recorded_result(target public.payment_provider_operations) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  select observations.result from public.payment_provider_observations observations where observations.operation_id=target.id
    and observations.result->>'outcome'=target.current_outcome
    and (observations.result->>'providerRequestId',observations.result->>'providerReference',observations.result->>'movementReference',observations.occurred_at)
      is not distinct from (target.provider_request_id,target.provider_reference,target.movement_reference,target.authoritative_outcome_at)
    and observations.provenance=target.evidence_provenance
    order by observations.id limit 1;
$$;

-- These locks remain usable after an ordinary worker lease expires. They protect
-- immutable source identity; the existing completion routines fence business receipts.
CREATE OR REPLACE FUNCTION public.lock_payment_observation_source(target_operation_id uuid,target_purposes text[]) RETURNS public.payment_provider_operations
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare ledger public.payment_provider_operations;
declare submission public.booking_request_submission_attempts;
declare request_id uuid;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Payment recording unavailable' using errcode='42501'; end if;
  select * into ledger from public.payment_provider_operations operations where operations.id=target_operation_id;
  if not found or ledger.admission->>'purpose'=any(target_purposes) is not true then
    raise exception 'Payment recording purpose is invalid' using errcode='RC409'; end if;
  select attempts.* into submission from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims on claims.attempt_id=attempts.id where claims.id=ledger.claim_id;
  request_id:=submission.booking_request_id;
  if ledger.admission->>'purpose' in ('booking-request-capture','booking-request-payment-recovery','booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund') then
    perform 1 from public.booking_requests requests where requests.id=request_id for update of requests;
    perform 1 from public.booking_request_capture_work work where work.booking_request_id=request_id for update of work;
  elsif ledger.admission->>'purpose'='booking-request-release' then
    perform 1 from public.booking_request_release_work work where work.id=(ledger.admission#>>'{permit,workId}')::uuid for update of work;
  end if;
  perform 1 from public.booking_request_submission_attempts attempts where attempts.id=submission.id for update of attempts;
  perform 1 from public.booking_request_authorization_claims claims where claims.id=ledger.claim_id for update of claims;
  if ledger.recovery_attempt_id is not null then
    perform 1 from public.booking_request_payment_recovery_attempts attempts where attempts.id=ledger.recovery_attempt_id for update of attempts;
  end if;
  if ledger.admission->>'purpose'='booking-request-release' then
    perform 1 from public.booking_request_release_operations operations where operations.id=(ledger.admission#>>'{permit,operationId}')::uuid for update of operations;
  elsif ledger.admission->>'purpose' in ('booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund') then
    perform 1 from public.booking_request_payment_required_expiry_work work where work.booking_request_id=request_id for update of work;
    perform 1 from public.booking_request_payment_required_expiry_operations operations where operations.id=(ledger.admission#>>'{permit,expiryOperationId}')::uuid for update of operations;
  end if;
  select * into ledger from public.payment_provider_operations operations where operations.id=target_operation_id for update of operations;
  return ledger;
end;
$$;

CREATE OR REPLACE FUNCTION public.record_booking_request_provider_operation_observation(target_operation_id uuid,target_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare ledger public.payment_provider_operations;
declare result jsonb;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-request-authorization','booking-request-submission-cleanup','booking-request-release']);
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  if ledger.admission->>'purpose'='booking-request-release' and ledger.current_outcome='not-executed' then
    update public.booking_request_release_operations operations set state='retryable',provider_outcome='not_executed',retry_safe=true,
      result_recorded_at=clock_timestamp(),updated_at=clock_timestamp()
      where operations.id=(ledger.admission#>>'{permit,operationId}')::uuid
        and operations.state in ('executing','reconcile_required');
  end if;
  result:=public.payment_provider_recorded_result(ledger);
  if ledger.current_outcome='failed' then result:=result||jsonb_build_object('retrySafe',ledger.operation_kind='release'); end if;
  return result;
end;
$$;

CREATE OR REPLACE FUNCTION public.record_booking_request_capture_observation(target_operation_id uuid,target_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare ledger public.payment_provider_operations;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-request-capture']);
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  return public.payment_provider_recorded_result(ledger);
end;
$$;

CREATE OR REPLACE FUNCTION public.record_booking_request_payment_recovery_observation(target_operation_id uuid,target_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare ledger public.payment_provider_operations;
declare attempt public.booking_request_payment_recovery_attempts;
declare work public.booking_request_capture_work;
declare recovery_step text;
declare result jsonb;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-request-payment-recovery']);
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  select * into attempt from public.booking_request_payment_recovery_attempts attempts where attempts.id=ledger.recovery_attempt_id;
  select * into work from public.booking_request_capture_work capture_work where capture_work.booking_request_id=attempt.booking_request_id;
  recovery_step:=ledger.admission#>>'{permit,step}';
  -- A closed admission is evidence, not an executed recovery operation.
  if ledger.current_outcome<>'not-executed' then
    insert into public.booking_request_payment_recovery_operations(recovery_attempt_id,step,provider_operation_id,outcome,authoritative_outcome_at,execution_permit)
      values(attempt.id,recovery_step,ledger.id,ledger.current_outcome,ledger.authoritative_outcome_at,ledger.admission->'permit')
      on conflict(recovery_attempt_id,step,operation_generation) do update set outcome=excluded.outcome,authoritative_outcome_at=excluded.authoritative_outcome_at,updated_at=clock_timestamp()
        where booking_request_payment_recovery_operations.provider_operation_id=excluded.provider_operation_id
          and (booking_request_payment_recovery_operations.outcome,booking_request_payment_recovery_operations.authoritative_outcome_at)
            is distinct from (excluded.outcome,excluded.authoritative_outcome_at);
    if not exists(select 1 from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=attempt.id and operations.step=recovery_step and operations.operation_generation=1 and operations.provider_operation_id=ledger.id) then
      raise exception 'Recovery observation targets another operation' using errcode='RC409'; end if;
    if not public.booking_request_payment_quarantined(work.booking_request_id) and (attempt.state='blocked' or attempt.state=(case recovery_step when 'original-release' then 'admitted'
      when 'replacement-authorization' then 'original_released' when 'replacement-capture' then 'replacement_authorized' when 'replacement-release' then 'capture_failed' end)) then
      perform public.record_booking_request_recovery_outcome(attempt.id,recovery_step,ledger,work.payment_required_deadline);
    end if;
    if ledger.operation_kind='capture' and ledger.current_outcome='succeeded' and ledger.authoritative_outcome_at>=work.payment_required_deadline then
      perform public.invalidate_booking_request_payment_confirmation(work.booking_request_id,ledger.id,'late-capture');
    end if;
  end if;
  result:=public.payment_provider_recorded_result(ledger);
  if ledger.current_outcome='failed' then result:=result||jsonb_build_object('retrySafe',exists(select 1 from public.booking_request_payment_recovery_attempts attempts where attempts.id=attempt.id and attempts.state='safely_failed')); end if;
  return result;
end;
$$;

CREATE OR REPLACE FUNCTION public.record_booking_request_payment_required_expiry_observation(target_operation_id uuid,target_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare ledger public.payment_provider_operations;
declare target public.booking_request_payment_required_expiry_operations;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund']);
  select * into target from public.booking_request_payment_required_expiry_operations operations where operations.id=(ledger.admission#>>'{permit,expiryOperationId}')::uuid;
  if target.id is null or (target.provider_operation_id is not null and target.provider_operation_id<>ledger.id) then
    raise exception 'Expiry observation targets another operation' using errcode='RC409'; end if;
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  update public.booking_request_payment_required_expiry_operations operations set provider_operation_id=ledger.id where operations.id=target.id;
  if ledger.current_outcome<>'succeeded' then
    perform public.quarantine_booking_request_payment(target.booking_request_id,'expiry-'||target.operation_kind||'-'||ledger.current_outcome);
  end if;
  return public.payment_provider_recorded_result(ledger);
end;
$$;

CREATE OR REPLACE FUNCTION public.guard_payment_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
  if tg_op='DELETE' or tg_table_name='payment_provider_observations' then
    raise exception 'Accepted payment evidence is immutable' using errcode='RC409'; end if;
  if (to_jsonb(new)-array['original_outcome','current_outcome','provider_request_id','provider_reference','movement_reference','original_outcome_at','executed_at','recorded_at','authoritative_outcome_at','updated_at','evidence_provenance'])
      is distinct from (to_jsonb(old)-array['original_outcome','current_outcome','provider_request_id','provider_reference','movement_reference','original_outcome_at','executed_at','recorded_at','authoritative_outcome_at','updated_at','evidence_provenance'])
    or (old.current_outcome is not null and (new.original_outcome,new.original_outcome_at,new.executed_at,new.provider_request_id,new.provider_reference)
      is distinct from (old.original_outcome,old.original_outcome_at,old.executed_at,old.provider_request_id,old.provider_reference)) then
    raise exception 'Payment admission identity is immutable' using errcode='RC409'; end if;
  return new;
end;
$$;

ALTER FUNCTION public.payment_operation_admission(public.payment_provider_operations,boolean) OWNER TO postgres;

ALTER FUNCTION public.validate_payment_provider_observation(jsonb,uuid) OWNER TO postgres;

ALTER FUNCTION public.validate_simulated_payment_binding(jsonb) OWNER TO postgres;

ALTER FUNCTION public.simulated_payment_absence_receipt(jsonb,timestamptz) OWNER TO postgres;

ALTER FUNCTION public.persist_simulated_payment_effect(jsonb,jsonb) OWNER TO postgres;

ALTER FUNCTION public.seal_simulated_payment_absence(jsonb) OWNER TO postgres;

ALTER FUNCTION public.resolve_simulated_payment_effect(jsonb,text,jsonb) OWNER TO postgres;

ALTER FUNCTION public.admit_booking_request_provider_operation(jsonb) OWNER TO postgres;

ALTER FUNCTION public.admit_booking_request_capture(jsonb) OWNER TO postgres;

ALTER FUNCTION public.admit_booking_request_payment_recovery(jsonb) OWNER TO postgres;

ALTER FUNCTION public.admit_booking_request_payment_required_expiry(jsonb) OWNER TO postgres;

ALTER FUNCTION public.reload_booking_request_payment_operation(jsonb,text,text) OWNER TO postgres;

ALTER FUNCTION public.accept_payment_provider_observation(uuid,jsonb) OWNER TO postgres;

ALTER FUNCTION public.payment_provider_recorded_result(public.payment_provider_operations) OWNER TO postgres;

ALTER FUNCTION public.lock_payment_observation_source(uuid,text[]) OWNER TO postgres;

ALTER FUNCTION public.record_booking_request_provider_operation_observation(uuid,jsonb) OWNER TO postgres;

ALTER FUNCTION public.record_booking_request_capture_observation(uuid,jsonb) OWNER TO postgres;

ALTER FUNCTION public.record_booking_request_payment_recovery_observation(uuid,jsonb) OWNER TO postgres;

ALTER FUNCTION public.record_booking_request_payment_required_expiry_observation(uuid,jsonb) OWNER TO postgres;

ALTER FUNCTION public.guard_payment_evidence() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.pending_booking_request_authorization_observations() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Payment inquiry unavailable' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(public.payment_operation_admission(pending) order by pending.created_at,pending.id),'[]'::jsonb)
    from (select operations.* from public.payment_provider_operations operations
      join public.booking_request_authorization_claims claims on claims.id=operations.claim_id
      where public.booking_request_claim_state_is_active(claims.state) and claims.reconciliation_expires_at<=clock_timestamp()
        and operations.admission->>'purpose' in ('booking-request-authorization','booking-request-submission-cleanup')
        and (operations.current_outcome is null or operations.current_outcome='indeterminate')
      order by operations.created_at,operations.id limit 50) pending);
end;
$$;
ALTER FUNCTION public.pending_booking_request_authorization_observations() OWNER TO postgres;
