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

CREATE OR REPLACE FUNCTION "public"."reject_messaging_history_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'Messaging history is immutable' using errcode = 'RC204';
end;
$$;

ALTER FUNCTION "public"."reject_messaging_history_change"() OWNER TO "postgres";
