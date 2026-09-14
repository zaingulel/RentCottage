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

CREATE OR REPLACE FUNCTION "public"."messaging_writing_is_closed"(
  "target_period_ends_at" timestamp with time zone,
  "target_evaluated_at" timestamp with time zone
) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select target_evaluated_at >= target_period_ends_at + interval '720 hours';
$$;

ALTER FUNCTION "public"."messaging_writing_is_closed"(
  timestamp with time zone, timestamp with time zone
) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_messaging_conversation"(
  "target_actor_user_id" "uuid",
  "target_profile_id" "uuid",
  "target_command_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."create_messaging_conversation"("uuid", "uuid", "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_messaging_conversation_for_cottage"(
  "target_actor_user_id" "uuid",
  "target_public_slug" "text",
  "target_command_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare target_profile_id uuid;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'Messaging conversation creation is unavailable'
      using errcode = '42501';
  end if;
  select listings.profile_id into target_profile_id
  from public.cottage_marketplace_listings listings
  where listings.public_slug = target_public_slug
    and listings.state = 'published';
  if target_profile_id is null then
    return jsonb_build_object('status', 'access-required');
  end if;
  return public.create_messaging_conversation(
    target_actor_user_id, target_profile_id, target_command_id
  );
end;
$$;

ALTER FUNCTION "public"."create_messaging_conversation_for_cottage"(
  "uuid", "text", "uuid"
) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."open_messaging_conversation_for_booking"(
  "target_actor_user_id" "uuid",
  "target_booking_request_reference" "text",
  "target_command_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare target_request public.booking_requests;
declare target_attempt public.booking_request_submission_attempts;
declare target_conversation public.messaging_conversations;
declare target_link public.messaging_conversation_booking_requests;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'Existing booking messaging is unavailable'
      using errcode = '42501';
  end if;
  if target_actor_user_id is null
    or target_booking_request_reference is null
    or target_booking_request_reference !~ '^RC-REQ-[A-F0-9]{16}$'
    or target_command_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  select requests.* into target_request
  from public.booking_requests requests
  where requests.booking_request_reference = target_booking_request_reference;
  if target_request.id is null
    or not exists (
      select 1
      from public.account_contexts contexts
      join auth.users users on users.id = contexts.user_id
      where contexts.user_id = target_actor_user_id
        and users.phone_confirmed_at is not null
        and (
          contexts.user_id = target_request.customer_user_id
            and contexts.role in (
              'customer'::public.account_role,
              'cottage_owner'::public.account_role
            )
          or contexts.user_id = target_request.owner_user_id
            and contexts.role = 'cottage_owner'::public.account_role
            and contexts.owner_approval_state = 'approved'::public.owner_approval_state
        )
    ) then
    return jsonb_build_object('status', 'access-required');
  end if;

  select requests.* into target_request
  from public.booking_requests requests
  where requests.id = target_request.id
  for update of requests;
  if not exists (
    select 1
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    where contexts.user_id = target_actor_user_id
      and users.phone_confirmed_at is not null
      and (
        contexts.user_id = target_request.customer_user_id
          and contexts.role in (
            'customer'::public.account_role,
            'cottage_owner'::public.account_role
          )
        or contexts.user_id = target_request.owner_user_id
          and contexts.role = 'cottage_owner'::public.account_role
          and contexts.owner_approval_state = 'approved'::public.owner_approval_state
      )
  ) then
    return jsonb_build_object('status', 'access-required');
  end if;

  select attempts.* into target_attempt
  from public.booking_request_submission_attempts attempts
  where attempts.booking_request_id = target_request.id
  for update of attempts;
  if target_attempt.id is null
    or target_attempt.customer_user_id <> target_request.customer_user_id
    or target_attempt.profile_id <> target_request.profile_id
    or target_attempt.booking_request_id <> target_request.id then
    return jsonb_build_object('status', 'unavailable');
  end if;

  if target_attempt.conversation_id is not null then
    select conversations.* into target_conversation
    from public.messaging_conversations conversations
    where conversations.id = target_attempt.conversation_id;
    select links.* into target_link
    from public.messaging_conversation_booking_requests links
    where links.booking_request_id = target_request.id;
    if target_conversation.id is null
      or target_link.booking_request_id is null
      or target_conversation.customer_user_id <> target_request.customer_user_id
      or target_conversation.profile_id <> target_request.profile_id
      or target_conversation.owner_user_id <> target_request.owner_user_id
      or target_link.conversation_id <> target_conversation.id
      or target_link.submission_attempt_id <> target_attempt.id then
      return jsonb_build_object('status', 'unavailable');
    end if;
    return jsonb_build_object(
      'status', 'created', 'conversationId', target_conversation.id
    );
  end if;

  if exists (
    select 1 from public.messaging_conversations conversations
    where conversations.customer_user_id = target_request.customer_user_id
      and conversations.creation_command_id = target_command_id
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;
  insert into public.messaging_conversations (
    customer_user_id, profile_id, owner_user_id, creation_command_id
  ) values (
    target_request.customer_user_id, target_request.profile_id,
    target_request.owner_user_id, target_command_id
  ) returning * into target_conversation;
  update public.booking_request_submission_attempts attempts
  set conversation_id = target_conversation.id,
      updated_at = clock_timestamp()
  where attempts.id = target_attempt.id
    and attempts.conversation_id is null;
  if not found then
    raise exception 'Existing booking messaging association changed'
      using errcode = 'RC409';
  end if;
  insert into public.messaging_conversation_booking_requests (
    conversation_id, booking_request_id, submission_attempt_id, linked_at
  ) values (
    target_conversation.id, target_request.id, target_attempt.id,
    clock_timestamp()
  );
  return jsonb_build_object(
    'status', 'created', 'conversationId', target_conversation.id
  );
end;
$$;

ALTER FUNCTION "public"."open_messaging_conversation_for_booking"(
  "uuid", "text", "uuid"
) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."messaging_booking_has_paid_access"(
  "target_booking_request_id" "uuid"
) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.booking_requests requests
    join public.booking_confirmations confirmations
      on confirmations.booking_request_id = requests.id
    where requests.id = target_booking_request_id
      and not exists (
        select 1
        from public.booking_request_confirmation_invalidations invalidations
        where invalidations.booking_request_id = requests.id
      )
      and not exists (
        select 1
        from public.booking_request_payment_required_expiry_work expiry
        where expiry.booking_request_id = requests.id
          and expiry.state = 'quarantined'
      )
      and (
        public.booking_request_payment_status(requests) = 'paid-confirmed'
        or exists (
          select 1
          from public.booking_cancellations cancellations
          where cancellations.booking_request_id = requests.id
        )
      )
  );
$$;

ALTER FUNCTION "public"."messaging_booking_has_paid_access"("uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admit_messaging_message"(
  "target_actor_user_id" "uuid",
  "target_conversation_id" "uuid",
  "target_command_id" "uuid",
  "target_original_language" "public"."cottage_profile_source_language",
  "target_original_body" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    valid_payment := public.messaging_booking_has_paid_access(current_request_id);
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
$$;

ALTER FUNCTION "public"."admit_messaging_message"(
  "uuid", "uuid", "uuid", "public"."cottage_profile_source_language", "text"
) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."messaging_conversation_is_readable"(
  "target_conversation_id" "uuid"
) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."messaging_conversation_is_readable"("uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."messaging_actor_can_use_conversation"(
  "target_conversation_id" "uuid",
  "target_actor_user_id" "uuid"
) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.messaging_conversations conversations
    join public.account_contexts contexts
      on contexts.user_id = target_actor_user_id
    join auth.users users on users.id = contexts.user_id
    where conversations.id = target_conversation_id
      and users.phone_confirmed_at is not null
      and (
        conversations.customer_user_id = target_actor_user_id
          and contexts.role in (
            'customer'::public.account_role,
            'cottage_owner'::public.account_role
          )
        or conversations.owner_user_id = target_actor_user_id
          and contexts.role = 'cottage_owner'::public.account_role
          and contexts.owner_approval_state = 'approved'::public.owner_approval_state
      )
  );
$$;

ALTER FUNCTION "public"."messaging_actor_can_use_conversation"("uuid", "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_messaging_translation"(
  "target_actor_user_id" "uuid",
  "target_message_id" "uuid",
  "target_language" "public"."cottage_profile_source_language",
  "target_provider" "text",
  "target_model" "text",
  "target_prompt_version" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source public.messaging_messages;
declare cached public.messaging_translations;
declare requested_language public.cottage_profile_source_language := target_language;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'Message translation is unavailable' using errcode = '42501';
  end if;
  if target_actor_user_id is null or target_message_id is null
    or requested_language is null or target_provider is null
    or target_model is null or target_prompt_version is null
    or target_provider <> 'fictional-local-test'
    or target_model <> 'deterministic-pairs-v1'
    or target_prompt_version <> 'message-pairs-v1' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select messages.* into source
  from public.messaging_messages messages
  where messages.id = target_message_id;
  if source.id is null
    or requested_language = source.original_language
    or not public.messaging_actor_can_use_conversation(
      source.conversation_id, target_actor_user_id
    ) then
    return jsonb_build_object('status', 'access-required');
  end if;
  select translations.* into cached
  from public.messaging_translations translations
  where translations.message_id = target_message_id
    and translations.target_language = requested_language
    and translations.provider = target_provider
    and translations.model = target_model
    and translations.prompt_version = target_prompt_version;
  if cached.id is not null then
    return jsonb_build_object(
      'status', 'translated',
      'translationId', cached.id,
      'translatedBody', cached.translated_body,
      'targetLanguage', cached.target_language,
      'provider', cached.provider,
      'model', cached.model,
      'promptVersion', cached.prompt_version
    );
  end if;
  return jsonb_build_object(
    'status', 'prepared',
    'messageId', source.id,
    'originalLanguage', source.original_language,
    'originalBody', source.original_body,
    'contactProtected', source.contact_protected
  );
end;
$$;

ALTER FUNCTION "public"."prepare_messaging_translation"(
  "uuid", "uuid", "public"."cottage_profile_source_language",
  "text", "text", "text"
) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."save_messaging_translation"(
  "target_actor_user_id" "uuid",
  "target_message_id" "uuid",
  "target_language" "public"."cottage_profile_source_language",
  "target_provider" "text",
  "target_model" "text",
  "target_prompt_version" "text",
  "target_translated_body" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source public.messaging_messages;
declare saved public.messaging_translations;
declare requested_language public.cottage_profile_source_language := target_language;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'Message translation is unavailable' using errcode = '42501';
  end if;
  if target_actor_user_id is null or target_message_id is null
    or requested_language is null or target_provider is null
    or target_model is null or target_prompt_version is null
    or target_provider <> 'fictional-local-test'
    or target_model <> 'deterministic-pairs-v1'
    or target_prompt_version <> 'message-pairs-v1'
    or target_translated_body is null
    or target_translated_body <> btrim(target_translated_body)
    or char_length(target_translated_body) not between 1 and 2000 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select messages.* into source
  from public.messaging_messages messages
  where messages.id = target_message_id;
  if source.id is null
    or requested_language = source.original_language
    or not public.messaging_actor_can_use_conversation(
      source.conversation_id, target_actor_user_id
    ) then
    return jsonb_build_object('status', 'access-required');
  end if;
  if source.contact_protected
    and not public.contact_protection_text_is_safe(target_translated_body) then
    return jsonb_build_object('status', 'blocked');
  end if;
  insert into public.messaging_translations (
    message_id, target_language, provider, model, prompt_version,
    translated_body
  ) values (
    target_message_id, requested_language, target_provider, target_model,
    target_prompt_version, target_translated_body
  ) on conflict on constraint messaging_translations_cache_key do nothing;
  select translations.* into saved
  from public.messaging_translations translations
  where translations.message_id = target_message_id
    and translations.target_language = requested_language
    and translations.provider = target_provider
    and translations.model = target_model
    and translations.prompt_version = target_prompt_version;
  if saved.id is null or saved.translated_body <> target_translated_body then
    return jsonb_build_object('status', 'invalid');
  end if;
  return jsonb_build_object(
    'status', 'translated',
    'translationId', saved.id,
    'translatedBody', saved.translated_body,
    'targetLanguage', saved.target_language,
    'provider', saved.provider,
    'model', saved.model,
    'promptVersion', saved.prompt_version
  );
end;
$$;

ALTER FUNCTION "public"."save_messaging_translation"(
  "uuid", "uuid", "public"."cottage_profile_source_language",
  "text", "text", "text", "text"
) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."report_messaging_translation"(
  "target_actor_user_id" "uuid",
  "target_translation_id" "uuid",
  "target_command_id" "uuid",
  "target_category" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare target_translation public.messaging_translations;
declare conversation_id uuid;
declare prior public.messaging_translation_reports;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'Translation reporting is unavailable' using errcode = '42501';
  end if;
  if target_actor_user_id is null or target_translation_id is null
    or target_command_id is null
    or target_category is null
    or target_category not in ('incorrect', 'unclear', 'inappropriate') then
    return jsonb_build_object('status', 'invalid');
  end if;
  select translations.* into target_translation
  from public.messaging_translations translations
  where translations.id = target_translation_id;
  select messages.conversation_id into conversation_id
  from public.messaging_messages messages
  where messages.id = target_translation.message_id;
  if target_translation.id is null
    or not public.messaging_actor_can_use_conversation(
      conversation_id, target_actor_user_id
    ) then
    return jsonb_build_object('status', 'access-required');
  end if;
  insert into public.messaging_translation_reports (
    translation_id, reporter_user_id, command_id, category
  ) values (
    target_translation_id, target_actor_user_id, target_command_id,
    target_category
  ) on conflict (reporter_user_id, command_id) do nothing;
  select reports.* into prior
  from public.messaging_translation_reports reports
  where reports.reporter_user_id = target_actor_user_id
    and reports.command_id = target_command_id;
  if prior.id is null
    or prior.translation_id <> target_translation_id
    or prior.category <> target_category then
    return jsonb_build_object('status', 'invalid');
  end if;
  return jsonb_build_object('status', 'reported', 'reportId', prior.id);
end;
$$;

ALTER FUNCTION "public"."report_messaging_translation"(
  "uuid", "uuid", "uuid", "text"
) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."messaging_conversation_header"(
  "target_conversation_id" "uuid",
  "target_evaluated_at" timestamp with time zone
) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'conversationId', conversations.id,
    'cottage', jsonb_build_object(
      'profileId', conversations.profile_id,
      'name', coalesce(snapshots.quote_payload ->> 'cottageName', profiles.name),
      'publicSlug', coalesce(attempts.public_slug, listings.public_slug)
    ),
    'actorRole', case
      when conversations.customer_user_id = auth.uid() then 'customer'
      when conversations.owner_user_id = auth.uid() then 'cottage_owner'
      else 'platform_administrator'
    end,
    'createdAt', conversations.created_at,
    'canContinueBookingRequest', not exists (
      select 1
      from public.messaging_conversation_booking_requests binding_links
      join public.booking_confirmations binding_confirmations
        on binding_confirmations.booking_request_id = binding_links.booking_request_id
      where binding_links.conversation_id = conversations.id
    ) and not exists (
      select 1
      from public.messaging_conversation_booking_requests unresolved_links
      where unresolved_links.conversation_id = conversations.id
        and not public.messaging_submission_attempt_is_resolved(
          unresolved_links.submission_attempt_id
        )
    ),
    'booking', case when requests.id is null then null else
      jsonb_build_object(
        'bookingRequestReference', requests.booking_request_reference,
        'requestStatus', requests.status,
        'paymentStatus', public.booking_request_payment_status(requests),
        'responseDeadline', requests.response_deadline,
        'firstStartsAt', periods.first_starts_at,
        'lastEndsAt', periods.last_ends_at,
        'writingClosesAt', case
          when confirmations.id is not null and periods.last_ends_at is not null
            then periods.last_ends_at + interval '720 hours' end,
        'writingClosed', case when confirmations.id is not null
          then periods.last_ends_at is null or public.messaging_writing_is_closed(
            periods.last_ends_at, target_evaluated_at
          ) else false end,
        'contactAllowed', public.messaging_booking_has_paid_access(requests.id)
      ) end,
    'bookingHistory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bookingRequestReference', history_requests.booking_request_reference,
        'requestStatus', history_requests.status,
        'paymentStatus', public.booking_request_payment_status(history_requests),
        'responseDeadline', history_requests.response_deadline,
        'firstStartsAt', history_periods.first_starts_at,
        'lastEndsAt', history_periods.last_ends_at,
        'writingClosesAt', case
          when history_confirmations.id is not null
            and history_periods.last_ends_at is not null
            then history_periods.last_ends_at + interval '720 hours' end,
        'writingClosed', case when history_confirmations.id is not null
          then history_periods.last_ends_at is null
            or public.messaging_writing_is_closed(
              history_periods.last_ends_at, target_evaluated_at
            ) else false end,
        'contactAllowed', public.messaging_booking_has_paid_access(
          history_requests.id
        )
      ) order by history_links.linked_at, history_links.booking_request_id)
      from public.messaging_conversation_booking_requests history_links
      join public.booking_requests history_requests
        on history_requests.id = history_links.booking_request_id
      join public.cottage_booking_period_commitments history_commitments
        on history_commitments.id = history_requests.booking_period_commitment_id
      left join public.booking_confirmations history_confirmations
        on history_confirmations.booking_request_id = history_requests.id
      left join lateral (
        select min(lower(period)) first_starts_at,
          max(upper(period)) last_ends_at
        from unnest(history_commitments.access_ranges) period
      ) history_periods on true
      where history_links.conversation_id = conversations.id
    ), '[]'::jsonb),
    'messageCount', (
      select count(*)
      from public.messaging_messages messages
      where messages.conversation_id = conversations.id
    )
  )
  from public.messaging_conversations conversations
  join public.owner_application_cottage_profiles profiles
    on profiles.id = conversations.profile_id
  left join public.cottage_marketplace_listings listings
    on listings.profile_id = conversations.profile_id
  left join lateral (
    select links.*
    from public.messaging_conversation_booking_requests links
    where links.conversation_id = conversations.id
    order by links.linked_at desc, links.booking_request_id desc
    limit 1
  ) current_link on true
  left join public.booking_request_submission_attempts attempts
    on attempts.id = current_link.submission_attempt_id
  left join public.booking_requests requests
    on requests.id = current_link.booking_request_id
  left join public.booking_snapshots snapshots
    on snapshots.id = requests.booking_snapshot_id
  left join public.cottage_booking_period_commitments commitments
    on commitments.id = requests.booking_period_commitment_id
  left join public.booking_confirmations confirmations
    on confirmations.booking_request_id = requests.id
  left join lateral (
    select min(lower(period)) first_starts_at,
      max(upper(period)) last_ends_at
    from unnest(commitments.access_ranges) period
  ) periods on true
  where conversations.id = target_conversation_id;
$$;

ALTER FUNCTION "public"."messaging_conversation_header"(
  "uuid", timestamp with time zone
) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_messaging_conversation"(
  "target_conversation_id" "uuid",
  "target_before_position" bigint,
  "target_limit" integer
) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare result jsonb;
begin
  if target_conversation_id is null
    or target_limit is null
    or target_limit not between 1 and 100
    or (target_before_position is not null and target_before_position < 1)
    or not public.messaging_conversation_is_readable(target_conversation_id) then
    raise exception 'Messaging conversation is unavailable'
      using errcode = '42501';
  end if;
  result := public.messaging_conversation_header(
    target_conversation_id, statement_timestamp()
  );
  if result is null then
    raise exception 'Messaging conversation is unavailable'
      using errcode = '42501';
  end if;
  return result || (
    with page as (
      select messages.*, conversations.customer_user_id
      from public.messaging_messages messages
      join public.messaging_conversations conversations
        on conversations.id = messages.conversation_id
      where messages.conversation_id = target_conversation_id
        and (
          target_before_position is null
          or messages.position < target_before_position
        )
      order by messages.position desc
      limit target_limit + 1
    ), numbered as (
      select page.*, row_number() over (order by page.position desc) row_number
      from page
    )
    select jsonb_build_object(
      'messages', coalesce(jsonb_agg(jsonb_build_object(
        'messageId', numbered.id,
        'senderRole', case
          when numbered.sender_user_id = numbered.customer_user_id
            then 'customer' else 'cottage_owner' end,
        'originalLanguage', numbered.original_language,
        'originalBody', numbered.original_body,
        'contactProtected', numbered.contact_protected,
        'translations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'translationId', translations.id,
            'targetLanguage', translations.target_language,
            'translatedBody', translations.translated_body,
            'provider', translations.provider,
            'model', translations.model,
            'promptVersion', translations.prompt_version
          ) order by translations.created_at, translations.id)
          from public.messaging_translations translations
          where translations.message_id = numbered.id
        ), '[]'::jsonb),
        'sentAt', numbered.sent_at
      ) order by numbered.position) filter (
        where numbered.row_number <= target_limit
      ), '[]'::jsonb),
      'nextMessageCursor', case when max(numbered.row_number) > target_limit
        then min(numbered.position) filter (
          where numbered.row_number <= target_limit
        ) else null end
    ) from numbered
  );
end;
$$;

ALTER FUNCTION "public"."get_messaging_conversation"(
  "uuid", bigint, integer
) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_messaging_conversations"(
  "target_cursor_activity_at" timestamp with time zone,
  "target_cursor_conversation_id" "uuid",
  "target_limit" integer,
  "target_public_slug" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare actor_context public.account_contexts;
declare result jsonb;
begin
  select contexts.* into actor_context
  from public.account_contexts contexts
  where contexts.user_id = auth.uid();
  if auth.uid() is null
    or actor_context.user_id is null
    or target_limit is null
    or target_limit not between 1 and 50
    or ((target_cursor_activity_at is null) <> (target_cursor_conversation_id is null))
    or (target_public_slug is not null and target_public_slug !~ '^cottage-[0-9a-f]{32}$')
    or not (
      actor_context.role in (
        'customer'::public.account_role,
        'cottage_owner'::public.account_role
      )
      or public.is_platform_administrator('aal2')
    ) then
    raise exception 'Messaging inbox is unavailable' using errcode = '42501';
  end if;
  with candidates as (
    select conversations.id,
      greatest(conversations.created_at, coalesce(latest.sent_at, conversations.created_at)) activity_at,
      latest.original_body preview_body,
      latest.original_language preview_language
    from public.messaging_conversations conversations
    left join lateral (
      select messages.sent_at, messages.original_body, messages.original_language
      from public.messaging_messages messages
      where messages.conversation_id = conversations.id
      order by messages.position desc
      limit 1
    ) latest on true
    where public.messaging_conversation_is_readable(conversations.id)
      and (
        target_public_slug is null
        or exists (
          select 1 from public.cottage_marketplace_listings listings
          where listings.profile_id = conversations.profile_id
            and listings.public_slug = target_public_slug
        )
      )
  ), page as (
    select candidates.*
    from candidates
    where target_cursor_activity_at is null
      or (candidates.activity_at, candidates.id)
        < (target_cursor_activity_at, target_cursor_conversation_id)
    order by candidates.activity_at desc, candidates.id desc
    limit target_limit + 1
  ), numbered as (
    select page.*, row_number() over (
      order by page.activity_at desc, page.id desc
    ) row_number
    from page
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(
      public.messaging_conversation_header(numbered.id, statement_timestamp())
      || jsonb_build_object(
        'activityAt', numbered.activity_at,
        'preview', case when numbered.preview_body is null then null else
          jsonb_build_object(
            'originalBody', numbered.preview_body,
            'originalLanguage', numbered.preview_language
          ) end
      ) order by numbered.activity_at desc, numbered.id desc
    ) filter (where numbered.row_number <= target_limit), '[]'::jsonb),
    'nextCursor', case when max(numbered.row_number) > target_limit then (
      select jsonb_build_object(
        'activityAt', cursor_row.activity_at,
        'conversationId', cursor_row.id
      )
      from numbered cursor_row
      where cursor_row.row_number = target_limit
    ) else null end
  ) into result
  from numbered;
  return result;
end;
$$;

ALTER FUNCTION "public"."list_messaging_conversations"(
  timestamp with time zone, "uuid", integer, text
) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_messaging_moderation"(
  "target_cursor_at" timestamp with time zone,
  "target_cursor_id" "uuid",
  "target_cursor_type" "text",
  "target_limit" integer
) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if target_limit is null or target_limit not between 1 and 100
    or ((target_cursor_at is null) <> (target_cursor_id is null))
    or ((target_cursor_at is null) <> (target_cursor_type is null))
    or (target_cursor_type is not null
      and target_cursor_type not in ('blocked', 'translation-report'))
    or public.is_platform_administrator('aal2') is not true then
    raise exception 'Messaging moderation is unavailable' using errcode = '42501';
  end if;
  return (
    with events as (
      select attempts.occurred_at event_at, attempts.id event_id,
        'blocked'::text event_type,
        jsonb_build_object(
        'type', 'blocked',
        'attemptId', attempts.id,
        'conversationId', attempts.conversation_id,
        'category', attempts.blocked_category,
        'actorRole', case
          when attempts.actor_user_id = conversations.customer_user_id
            then 'customer' else 'cottage_owner' end,
        'conversationBlockedAttemptCount', (
          select count(*) from public.messaging_send_attempts repeated
          where repeated.conversation_id = attempts.conversation_id
            and repeated.outcome = 'blocked'
        ),
        'occurredAt', attempts.occurred_at
      ) item
      from public.messaging_send_attempts attempts
      join public.messaging_conversations conversations
        on conversations.id = attempts.conversation_id
      where attempts.outcome = 'blocked'
      union all
      select reports.created_at, reports.id, 'translation-report'::text,
        jsonb_build_object(
        'type', 'translation-report',
        'reportId', reports.id,
        'conversationId', messages.conversation_id,
        'category', reports.category,
        'originalLanguage', messages.original_language,
        'originalBody', messages.original_body,
        'targetLanguage', translations.target_language,
        'translatedBody', translations.translated_body,
        'provider', translations.provider,
        'model', translations.model,
        'promptVersion', translations.prompt_version,
        'reportedAt', reports.created_at
      )
      from public.messaging_translation_reports reports
      join public.messaging_translations translations
        on translations.id = reports.translation_id
      join public.messaging_messages messages
        on messages.id = translations.message_id
    ), page as (
      select * from events
      where target_cursor_at is null
        or (event_at,event_id,event_type)
          < (target_cursor_at,target_cursor_id,target_cursor_type)
      order by event_at desc,event_id desc,event_type desc
      limit target_limit + 1
    ), numbered as (
      select page.*,row_number() over (
        order by event_at desc,event_id desc,event_type desc
      ) row_number from page
    )
    select jsonb_build_object(
      'items',coalesce(jsonb_agg(item order by event_at desc,event_id desc,event_type desc)
        filter (where row_number <= target_limit),'[]'::jsonb),
      'nextCursor',case when max(row_number) > target_limit then (
        select jsonb_build_object(
          'at',cursor_row.event_at,
          'id',cursor_row.event_id,
          'type',cursor_row.event_type
        ) from numbered cursor_row where cursor_row.row_number = target_limit
      ) else null end
    ) from numbered
  );
end;
$$;

ALTER FUNCTION "public"."get_messaging_moderation"(
  timestamp with time zone,uuid,text,integer
) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_messaging_history_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'Messaging history is immutable' using errcode = 'RC204';
end;
$$;

ALTER FUNCTION "public"."reject_messaging_history_change"() OWNER TO "postgres";
