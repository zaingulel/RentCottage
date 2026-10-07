-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.booking_request_acceptance_evidence(target_locale public.cottage_profile_source_language, target_terms_version text, requires_inside_48 boolean);

CREATE FUNCTION public.booking_request_acceptance_evidence (
  target_locale      public.cottage_profile_source_language,
  requires_inside_48 boolean
)
  RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select case target_locale
    when 'en' then jsonb_build_object(
      'locale', 'en',
      'cancellationPolicy', 'Cancel at least 48 hours before the first shift for a full refund. Cancellation inside 48 hours and no-shows receive no refund.',
      'cancellationAcceptance', 'I accept the cancellation policy.',
      'marketplaceTermsAcceptance', 'I accept the marketplace booking terms.',
      'inside48Warning', case when requires_inside_48 then 'This request begins inside 48 hours and will be non-refundable immediately if accepted.' else null end,
      'inside48Acceptance', case when requires_inside_48 then 'I understand and accept the inside-48-hours no-refund rule.' else null end
    )
    when 'ar' then jsonb_build_object(
      'locale', 'ar',
      'cancellationPolicy', 'الإلغاء قبل 48 ساعة على الأقل يعيد المبلغ كاملاً. لا استرداد عند الإلغاء خلال 48 ساعة أو عدم الحضور.',
      'cancellationAcceptance', 'أوافق على سياسة الإلغاء.',
      'marketplaceTermsAcceptance', 'أوافق على شروط الحجز في المنصة.',
      'inside48Warning', case when requires_inside_48 then 'يبدأ هذا الطلب خلال 48 ساعة وسيصبح غير قابل للاسترداد فور قبوله.' else null end,
      'inside48Acceptance', case when requires_inside_48 then 'أفهم وأوافق على عدم الاسترداد خلال 48 ساعة.' else null end
    )
    when 'ckb' then jsonb_build_object(
      'locale', 'ckb',
      'cancellationPolicy', 'هەڵوەشاندنەوە لانیکەم 48 کاتژمێر پێش شەفت پارەکە بە تەواوی دەگەڕێنێتەوە. لە ناو 48 کاتژمێر یان نەهاتندا پارە ناگەڕێتەوە.',
      'cancellationAcceptance', 'سیاسەتی هەڵوەشاندنەوە قبوڵ دەکەم.',
      'marketplaceTermsAcceptance', 'مەرجەکانی حجزکردنی پلاتفۆرم قبوڵ دەکەم.',
      'inside48Warning', case when requires_inside_48 then 'ئەم داواکارییە لە ناو 48 کاتژمێردا دەست پێدەکات و دوای پەسەندکردن پارەکە ناگەڕێتەوە.' else null end,
      'inside48Acceptance', case when requires_inside_48 then 'یاسای نەگەڕاندنەوەی پارە لە ناو 48 کاتژمێردا قبوڵ دەکەم.' else null end
    )
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
    state
  ) values (
    target_customer_user_id, target_idempotency_key, gen_random_uuid(),
    current_profile_id, target_conversation_id, target_locale, target_slug, target_search,
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
$function$;

REVOKE ALL ON FUNCTION public.booking_request_acceptance_evidence(public.cottage_profile_source_language,boolean) FROM PUBLIC,anon,authenticated,service_role;
