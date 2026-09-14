-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.admit_messaging_message (
  target_actor_user_id     uuid,
  target_conversation_id   uuid,
  target_command_id        uuid,
  target_original_language public.cottage_profile_source_language,
  target_original_body     text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare candidate_request_id uuid;
declare current_request_id uuid;
declare target_conversation public.messaging_conversations;
declare target_request public.booking_requests;
declare prior_attempt public.messaging_send_attempts;
declare created_attempt public.messaging_send_attempts;
declare created_message public.messaging_messages;
declare valid_payment boolean := false;
declare ever_confirmed boolean := false;
declare period_ends_at timestamptz;
declare evaluated_at timestamptz;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'Message admission is unavailable' using errcode = '42501';
  end if;
  if target_actor_user_id is null
    or target_conversation_id is null
    or target_command_id is null
    or target_original_body is null
    or target_original_body <> btrim(target_original_body)
    or char_length(target_original_body) not between 1 and 2000 then
    return jsonb_build_object('status', 'invalid');
  end if;

  if not exists (
    select 1
    from public.messaging_conversations conversations
    join public.account_contexts contexts
      on contexts.user_id = target_actor_user_id
    join auth.users users on users.id = contexts.user_id
    where conversations.id = target_conversation_id
      and users.phone_confirmed_at is not null
      and (
        target_actor_user_id = conversations.customer_user_id
          and contexts.role in ('customer'::public.account_role, 'cottage_owner'::public.account_role)
        or target_actor_user_id = conversations.owner_user_id
          and contexts.role = 'cottage_owner'::public.account_role
          and contexts.owner_approval_state = 'approved'::public.owner_approval_state
      )
  ) then
    return jsonb_build_object('status', 'access-required');
  end if;

  select links.booking_request_id into candidate_request_id
  from public.messaging_conversation_booking_requests links
  where links.conversation_id = target_conversation_id
  order by links.linked_at desc, links.booking_request_id desc
  limit 1;
  if candidate_request_id is not null then
    select * into target_request
    from public.booking_requests requests
    where requests.id = candidate_request_id
    for update of requests;
  end if;
  select * into target_conversation
  from public.messaging_conversations conversations
  where conversations.id = target_conversation_id
  for update of conversations;
  if target_conversation.id is null then
    return jsonb_build_object('status', 'access-required');
  end if;
  select links.booking_request_id into current_request_id
  from public.messaging_conversation_booking_requests links
  where links.conversation_id = target_conversation_id
  order by links.linked_at desc, links.booking_request_id desc
  limit 1;
  if candidate_request_id is distinct from current_request_id then
    return jsonb_build_object('status', 'retry');
  end if;

  evaluated_at := clock_timestamp();
  if not exists (
    select 1
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    where contexts.user_id = target_actor_user_id
      and users.phone_confirmed_at is not null
      and (
        target_actor_user_id = target_conversation.customer_user_id
          and contexts.role in ('customer'::public.account_role, 'cottage_owner'::public.account_role)
        or target_actor_user_id = target_conversation.owner_user_id
          and contexts.role = 'cottage_owner'::public.account_role
          and contexts.owner_approval_state = 'approved'::public.owner_approval_state
      )
  ) then
    return jsonb_build_object('status', 'access-required');
  end if;

  select * into prior_attempt
  from public.messaging_send_attempts attempts
  where attempts.conversation_id = target_conversation_id
    and attempts.command_id = target_command_id;
  if prior_attempt.id is not null then
    if prior_attempt.actor_user_id <> target_actor_user_id then
      return jsonb_build_object('status', 'invalid');
    end if;
    if prior_attempt.outcome = 'blocked' then
      return jsonb_build_object(
        'status', 'blocked', 'reason', 'contact-restricted'
      );
    end if;
    select * into created_message
    from public.messaging_messages messages
    where messages.send_attempt_id = prior_attempt.id;
    if created_message.id is null
      or created_message.original_language <> target_original_language
      or created_message.original_body <> target_original_body then
      return jsonb_build_object('status', 'invalid');
    end if;
    return jsonb_build_object(
      'status', 'sent', 'messageId', created_message.id
    );
  end if;

  if current_request_id is not null then
    select exists (
      select 1 from public.booking_confirmations confirmations
      where confirmations.booking_request_id = current_request_id
    ) into ever_confirmed;
    select exists (
      select 1 from public.booking_confirmations confirmations
      where confirmations.booking_request_id = current_request_id
        and not exists (
          select 1 from public.booking_request_confirmation_invalidations invalidations
          where invalidations.booking_request_id = current_request_id
        )
        and not exists (
          select 1 from public.booking_request_payment_required_expiry_work expiry
          where expiry.booking_request_id = current_request_id
            and expiry.state = 'quarantined'
        )
        and (
          public.booking_request_payment_status(target_request) = 'paid-confirmed'
          or exists (
            select 1 from public.booking_cancellations cancellations
            where cancellations.booking_request_id = current_request_id
          )
        )
    ) into valid_payment;
    if ever_confirmed then
      select max(upper(periods.period)) into period_ends_at
      from public.cottage_booking_period_commitments commitments,
        unnest(commitments.access_ranges) periods(period)
      where commitments.id = target_request.booking_period_commitment_id;
      if period_ends_at is null
        or public.messaging_writing_is_closed(period_ends_at, evaluated_at) then
        return jsonb_build_object('status', 'read-only');
      end if;
    end if;
  end if;

  if not valid_payment
    and not public.contact_protection_text_is_safe(target_original_body) then
    insert into public.messaging_send_attempts (
      conversation_id, command_id, actor_user_id, outcome, blocked_category,
      occurred_at
    ) values (
      target_conversation_id, target_command_id, target_actor_user_id,
      'blocked', 'contact', evaluated_at
    ) returning * into created_attempt;
    return jsonb_build_object(
      'status', 'blocked', 'reason', 'contact-restricted'
    );
  end if;

  insert into public.messaging_send_attempts (
    conversation_id, command_id, actor_user_id, outcome, occurred_at
  ) values (
    target_conversation_id, target_command_id, target_actor_user_id,
    'sent', evaluated_at
  ) returning * into created_attempt;
  insert into public.messaging_messages (
    conversation_id, send_attempt_id, sender_user_id, original_language,
    original_body, contact_protected, sent_at
  ) values (
    target_conversation_id, created_attempt.id, target_actor_user_id,
    target_original_language, target_original_body, not valid_payment,
    evaluated_at
  ) returning * into created_message;
  return jsonb_build_object(
    'status', 'sent', 'messageId', created_message.id
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.admit_messaging_message(uuid, uuid, uuid, public.cottage_profile_source_language, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.admit_messaging_message(uuid, uuid, uuid, public.cottage_profile_source_language, text) TO service_role;

CREATE OR REPLACE FUNCTION public.booking_request_content_is_safe (
  target_value text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select public.contact_protection_text_is_safe(target_value);
$function$;

CREATE FUNCTION public.contact_protection_text_is_safe (
  target_value text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.contact_protection_text_is_safe(text) FROM PUBLIC;

CREATE FUNCTION public.create_messaging_conversation (
  target_actor_user_id uuid,
  target_profile_id    uuid,
  target_command_id    uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare target_owner_user_id uuid;
declare created_conversation public.messaging_conversations;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'Messaging conversation creation is unavailable'
      using errcode = '42501';
  end if;
  if target_actor_user_id is null
    or target_profile_id is null
    or target_command_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not exists (
    select 1
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    where contexts.user_id = target_actor_user_id
      and contexts.role in ('customer'::public.account_role, 'cottage_owner'::public.account_role)
      and users.phone_confirmed_at is not null
  ) then
    return jsonb_build_object('status', 'access-required');
  end if;
  select profiles.owner_user_id into target_owner_user_id
  from public.owner_application_cottage_profiles profiles
  join public.cottage_marketplace_listings listings
    on listings.profile_id = profiles.id
  join public.account_contexts owner_context
    on owner_context.user_id = profiles.owner_user_id
  where profiles.id = target_profile_id
    and listings.state = 'published'::public.cottage_marketplace_state
    and owner_context.role = 'cottage_owner'::public.account_role
    and owner_context.owner_approval_state = 'approved'::public.owner_approval_state;
  if target_owner_user_id is null
    or target_owner_user_id = target_actor_user_id then
    return jsonb_build_object('status', 'access-required');
  end if;
  select * into created_conversation
  from public.messaging_conversations conversations
  where conversations.customer_user_id = target_actor_user_id
    and conversations.creation_command_id = target_command_id;
  if created_conversation.id is not null then
    if created_conversation.profile_id <> target_profile_id then
      return jsonb_build_object('status', 'invalid');
    end if;
    return jsonb_build_object(
      'status', 'created', 'conversationId', created_conversation.id
    );
  end if;
  insert into public.messaging_conversations (
    customer_user_id, profile_id, owner_user_id, creation_command_id
  ) values (
    target_actor_user_id, target_profile_id, target_owner_user_id,
    target_command_id
  ) on conflict do nothing returning * into created_conversation;
  if created_conversation.id is null then
    select * into created_conversation
    from public.messaging_conversations conversations
    where conversations.customer_user_id = target_actor_user_id
      and conversations.creation_command_id = target_command_id;
    if created_conversation.profile_id is distinct from target_profile_id then
      return jsonb_build_object('status', 'invalid');
    end if;
  end if;
  return jsonb_build_object(
    'status', 'created', 'conversationId', created_conversation.id
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.create_messaging_conversation(uuid, uuid, uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_messaging_conversation(uuid, uuid, uuid) TO service_role;

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

CREATE FUNCTION public.messaging_conversation_is_readable (
  target_conversation_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.messaging_conversations conversations
    join public.account_contexts contexts on contexts.user_id = auth.uid()
    where conversations.id = target_conversation_id
      and (
        conversations.customer_user_id = auth.uid()
          and contexts.role in ('customer'::public.account_role, 'cottage_owner'::public.account_role)
        or conversations.owner_user_id = auth.uid()
          and contexts.role = 'cottage_owner'::public.account_role
          and contexts.owner_approval_state = 'approved'::public.owner_approval_state
        or public.is_platform_administrator('aal2')
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.messaging_conversation_is_readable(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.messaging_conversation_is_readable(uuid) TO authenticated;

CREATE FUNCTION public.messaging_submission_attempt_is_resolved (
  target_attempt_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select exists (
      select 1
      from public.booking_request_submission_attempts attempts
      where attempts.id = target_attempt_id
        and attempts.state in ('authorization_failed','released','expired','finalized')
        and (
          attempts.booking_request_id is null
          or exists (
            select 1
            from public.booking_requests requests
            where requests.id = attempts.booking_request_id
              and requests.status in ('declined','withdrawn','expired')
              and (
                exists (
                  select 1
                  from public.booking_request_release_work release_work
                  where release_work.booking_request_id = requests.id
                    and release_work.state = 'complete'
                )
                or requests.status = 'expired' and exists (
                  select 1
                  from public.booking_request_payment_required_expiry_work expiry
                  where expiry.booking_request_id = requests.id
                    and expiry.state = 'complete'
                )
              )
          )
        )
    )
    and not exists (
      select 1
      from public.booking_request_authorization_claims claims
      left join public.booking_request_authorization_reconciliation_outbox outbox
        on outbox.claim_id = claims.id
        and outbox.claim_generation = claims.generation
      where claims.attempt_id = target_attempt_id
        and (
          not public.booking_request_claim_state_is_terminal(claims.state)
          or outbox.claim_id is null
          or outbox.state <> 'complete'
          or outbox.observed_state_revision <> claims.state_revision
          or exists (
            select 1
            from public.payment_provider_operations operations
            where operations.claim_id = claims.id
              and (
                operations.current_outcome is null
                or operations.current_outcome = 'indeterminate'
              )
          )
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.messaging_submission_attempt_is_resolved(uuid) FROM PUBLIC;

CREATE FUNCTION public.messaging_writing_is_closed (
  target_period_ends_at timestamp with time zone,
  target_evaluated_at   timestamp with time zone
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select target_evaluated_at >= target_period_ends_at + interval '720 hours';
$function$;

REVOKE ALL ON FUNCTION public.messaging_writing_is_closed(timestamp WITH time zone, timestamp WITH time zone) FROM PUBLIC;

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
      left join public.booking_requests requests
        on requests.id = attempts.booking_request_id
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

CREATE FUNCTION public.reject_messaging_history_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  raise exception 'Messaging history is immutable' using errcode = 'RC204';
end;
$function$;

REVOKE ALL ON FUNCTION public.reject_messaging_history_change() FROM PUBLIC;

ALTER TABLE public.booking_request_submission_attempts
  ADD COLUMN conversation_id uuid;

CREATE INDEX booking_request_submission_conversation_idx ON public.booking_request_submission_attempts (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

CREATE TABLE public.messaging_conversation_booking_requests (
  conversation_id       uuid                     NOT NULL,
  booking_request_id    uuid                     NOT NULL,
  submission_attempt_id uuid                     NOT NULL,
  linked_at             timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.messaging_conversation_booking_requests
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.messaging_conversation_booking_requests
  ADD CONSTRAINT messaging_conversation_booking_requests_attempt_id_fkey FOREIGN KEY (submission_attempt_id) REFERENCES public.booking_request_submission_attempts(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.messaging_conversation_booking_requests
  ADD CONSTRAINT messaging_conversation_booking_requests_attempt_key UNIQUE (submission_attempt_id);

ALTER TABLE public.messaging_conversation_booking_requests
  ADD CONSTRAINT messaging_conversation_booking_requests_pkey PRIMARY KEY (booking_request_id);

ALTER TABLE public.messaging_conversation_booking_requests
  ADD CONSTRAINT messaging_conversation_booking_requests_request_id_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id) ON DELETE RESTRICT;

GRANT SELECT ON public.messaging_conversation_booking_requests TO authenticated;

CREATE INDEX messaging_conversation_requests_history_idx ON public.messaging_conversation_booking_requests (conversation_id, linked_at DESC, booking_request_id DESC);

CREATE TRIGGER messaging_conversation_booking_requests_immutable
  BEFORE DELETE OR UPDATE ON public.messaging_conversation_booking_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_messaging_history_change();

CREATE POLICY "Authorized readers see messaging links" ON public.messaging_conversation_booking_requests
  FOR SELECT
  TO authenticated
  USING (( SELECT public.messaging_conversation_is_readable(messaging_conversation_booking_requests.conversation_id) AS messaging_conversation_is_readable));

CREATE TABLE public.messaging_conversations (
  id                  uuid                     DEFAULT gen_random_uuid() NOT NULL,
  customer_user_id    uuid                     NOT NULL,
  profile_id          uuid                     NOT NULL,
  owner_user_id       uuid                     NOT NULL,
  creation_command_id uuid                     NOT NULL,
  created_at          timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.messaging_conversations
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.messaging_conversations
  ADD CONSTRAINT messaging_conversations_creation_command_key UNIQUE (customer_user_id, creation_command_id);

ALTER TABLE public.messaging_conversations
  ADD CONSTRAINT messaging_conversations_customer_user_id_fkey FOREIGN KEY (customer_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;

ALTER TABLE public.messaging_conversations
  ADD CONSTRAINT messaging_conversations_distinct_participants CHECK (customer_user_id <> owner_user_id);

ALTER TABLE public.messaging_conversations
  ADD CONSTRAINT messaging_conversations_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;

ALTER TABLE public.messaging_conversations
  ADD CONSTRAINT messaging_conversations_pkey PRIMARY KEY (id);

ALTER TABLE public.booking_request_submission_attempts
  ADD CONSTRAINT booking_request_submission_attempts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.messaging_conversations(id) ON DELETE RESTRICT;

ALTER TABLE public.messaging_conversation_booking_requests
  ADD CONSTRAINT messaging_conversation_booking_requests_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.messaging_conversations(id) ON DELETE RESTRICT;

ALTER TABLE public.messaging_conversations
  ADD CONSTRAINT messaging_conversations_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.owner_application_cottage_profiles(id) ON DELETE RESTRICT;

GRANT SELECT ON public.messaging_conversations TO authenticated;

CREATE INDEX messaging_conversations_customer_idx ON public.messaging_conversations (customer_user_id, created_at DESC);

CREATE INDEX messaging_conversations_owner_idx ON public.messaging_conversations (owner_user_id, created_at DESC);

CREATE TRIGGER messaging_conversations_immutable
  BEFORE DELETE OR UPDATE ON public.messaging_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_messaging_history_change();

CREATE POLICY "Authorized readers see messaging conversations" ON public.messaging_conversations
  FOR SELECT
  TO authenticated
  USING (( SELECT public.messaging_conversation_is_readable(messaging_conversations.id) AS messaging_conversation_is_readable));

CREATE TABLE public.messaging_messages (
  id                uuid                                   DEFAULT gen_random_uuid() NOT NULL,
  conversation_id   uuid                                   NOT NULL,
  send_attempt_id   uuid                                   NOT NULL,
  sender_user_id    uuid                                   NOT NULL,
  original_language public.cottage_profile_source_language NOT NULL,
  original_body     text                                   NOT NULL,
  contact_protected boolean                                NOT NULL,
  "position"        bigint                                 GENERATED ALWAYS AS IDENTITY NOT NULL,
  sent_at           timestamp with time zone               DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.messaging_messages
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.messaging_messages
  ADD CONSTRAINT messaging_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.messaging_conversations(id) ON DELETE RESTRICT;

ALTER TABLE public.messaging_messages
  ADD CONSTRAINT messaging_messages_original_body CHECK (original_body = btrim(original_body) AND char_length(original_body) >= 1 AND char_length(original_body) <= 2000);

ALTER TABLE public.messaging_messages
  ADD CONSTRAINT messaging_messages_pkey PRIMARY KEY (id);

ALTER TABLE public.messaging_messages
  ADD CONSTRAINT messaging_messages_send_attempt_id_key UNIQUE (send_attempt_id);

ALTER TABLE public.messaging_messages
  ADD CONSTRAINT messaging_messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;

GRANT SELECT ON public.messaging_messages TO authenticated;

CREATE INDEX messaging_messages_history_idx ON public.messaging_messages (conversation_id, "position");

CREATE TRIGGER messaging_messages_immutable
  BEFORE DELETE OR UPDATE ON public.messaging_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_messaging_history_change();

CREATE POLICY "Authorized readers see messaging history" ON public.messaging_messages
  FOR SELECT
  TO authenticated
  USING (( SELECT public.messaging_conversation_is_readable(messaging_messages.conversation_id) AS messaging_conversation_is_readable));

CREATE TABLE public.messaging_send_attempts (
  id               uuid                     DEFAULT gen_random_uuid() NOT NULL,
  conversation_id  uuid                     NOT NULL,
  command_id       uuid                     NOT NULL,
  actor_user_id    uuid                     NOT NULL,
  outcome          text                     NOT NULL,
  blocked_category text,
  occurred_at      timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.messaging_send_attempts
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.messaging_send_attempts
  ADD CONSTRAINT messaging_send_attempts_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;

ALTER TABLE public.messaging_send_attempts
  ADD CONSTRAINT messaging_send_attempts_command_key UNIQUE (conversation_id, command_id);

ALTER TABLE public.messaging_send_attempts
  ADD CONSTRAINT messaging_send_attempts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.messaging_conversations(id) ON DELETE RESTRICT;

ALTER TABLE public.messaging_send_attempts
  ADD CONSTRAINT messaging_send_attempts_outcome CHECK (outcome = 'sent'::text AND blocked_category IS NULL OR outcome = 'blocked'::text AND blocked_category = 'contact'::text);

ALTER TABLE public.messaging_send_attempts
  ADD CONSTRAINT messaging_send_attempts_pkey PRIMARY KEY (id);

ALTER TABLE public.messaging_messages
  ADD CONSTRAINT messaging_messages_send_attempt_id_fkey FOREIGN KEY (send_attempt_id) REFERENCES public.messaging_send_attempts(id) ON DELETE RESTRICT;

GRANT SELECT ON public.messaging_send_attempts TO authenticated;

CREATE INDEX messaging_blocked_attempts_review_idx ON public.messaging_send_attempts (occurred_at DESC, id)
  WHERE outcome = 'blocked'::text;

CREATE TRIGGER messaging_send_attempts_immutable
  BEFORE DELETE OR UPDATE ON public.messaging_send_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_messaging_history_change();

CREATE POLICY "MFA administrator reads messaging moderation attempts" ON public.messaging_send_attempts
  FOR SELECT
  TO authenticated
  USING (( SELECT public.is_platform_administrator('aal2'::text) AS is_platform_administrator));