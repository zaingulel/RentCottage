-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.admit_messaging_message (
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
$function$;

CREATE FUNCTION public.create_messaging_conversation_for_cottage (
  target_actor_user_id uuid,
  target_public_slug   text,
  target_command_id    uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.create_messaging_conversation_for_cottage(uuid, text, uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_messaging_conversation_for_cottage(uuid, text, uuid) TO service_role;

CREATE FUNCTION public.get_messaging_conversation (
  target_conversation_id uuid,
  target_before_position bigint,
  target_limit           integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.get_messaging_conversation(uuid, bigint, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_messaging_conversation(uuid, bigint, integer) TO authenticated;

CREATE FUNCTION public.get_messaging_moderation (
  target_cursor_at   timestamp with time zone,
  target_cursor_id   uuid,
  target_cursor_type text,
  target_limit       integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.get_messaging_moderation(timestamp WITH time zone, uuid, text, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_messaging_moderation(timestamp WITH time zone, uuid, text, integer) TO authenticated;

CREATE FUNCTION public.list_messaging_conversations (
  target_cursor_activity_at     timestamp with time zone,
  target_cursor_conversation_id uuid,
  target_limit                  integer,
  target_public_slug            text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.list_messaging_conversations(timestamp WITH time zone, uuid, integer, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_messaging_conversations(timestamp WITH time zone, uuid, integer, text) TO authenticated;

CREATE FUNCTION public.messaging_actor_can_use_conversation (
  target_conversation_id uuid,
  target_actor_user_id   uuid
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
$function$;

REVOKE ALL ON FUNCTION public.messaging_actor_can_use_conversation(uuid, uuid) FROM PUBLIC;

CREATE FUNCTION public.messaging_booking_has_paid_access (
  target_booking_request_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.messaging_booking_has_paid_access(uuid) FROM PUBLIC;

CREATE FUNCTION public.messaging_conversation_header (
  target_conversation_id uuid,
  target_evaluated_at    timestamp with time zone
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.messaging_conversation_header(uuid, timestamp WITH time zone) FROM PUBLIC;

CREATE FUNCTION public.open_messaging_conversation_for_booking (
  target_actor_user_id             uuid,
  target_booking_request_reference text,
  target_command_id                uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.open_messaging_conversation_for_booking(uuid, text, uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.open_messaging_conversation_for_booking(uuid, text, uuid) TO service_role;

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

CREATE FUNCTION public.prepare_messaging_translation (
  target_actor_user_id  uuid,
  target_message_id     uuid,
  target_language       public.cottage_profile_source_language,
  target_provider       text,
  target_model          text,
  target_prompt_version text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.prepare_messaging_translation(uuid, uuid, public.cottage_profile_source_language, text, text, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.prepare_messaging_translation(uuid, uuid, public.cottage_profile_source_language, text, text, text) TO service_role;

CREATE FUNCTION public.report_messaging_translation (
  target_actor_user_id  uuid,
  target_translation_id uuid,
  target_command_id     uuid,
  target_category       text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.report_messaging_translation(uuid, uuid, uuid, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.report_messaging_translation(uuid, uuid, uuid, text) TO service_role;

CREATE FUNCTION public.save_messaging_translation (
  target_actor_user_id   uuid,
  target_message_id      uuid,
  target_language        public.cottage_profile_source_language,
  target_provider        text,
  target_model           text,
  target_prompt_version  text,
  target_translated_body text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.save_messaging_translation(uuid, uuid, public.cottage_profile_source_language, text, text, text, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.save_messaging_translation(uuid, uuid, public.cottage_profile_source_language, text, text, text, text) TO service_role;

CREATE TABLE public.messaging_translation_reports (
  id               uuid                     DEFAULT gen_random_uuid() NOT NULL,
  translation_id   uuid                     NOT NULL,
  reporter_user_id uuid                     NOT NULL,
  command_id       uuid                     NOT NULL,
  category         text                     NOT NULL,
  created_at       timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.messaging_translation_reports
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.messaging_translation_reports
  ADD CONSTRAINT messaging_translation_reports_category CHECK (category = ANY (ARRAY['incorrect'::text, 'unclear'::text, 'inappropriate'::text]));

ALTER TABLE public.messaging_translation_reports
  ADD CONSTRAINT messaging_translation_reports_command_key UNIQUE (reporter_user_id, command_id);

ALTER TABLE public.messaging_translation_reports
  ADD CONSTRAINT messaging_translation_reports_pkey PRIMARY KEY (id);

ALTER TABLE public.messaging_translation_reports
  ADD CONSTRAINT messaging_translation_reports_reporter_user_id_fkey FOREIGN KEY (reporter_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;

GRANT SELECT ON public.messaging_translation_reports TO authenticated;

CREATE INDEX messaging_translation_reports_review_idx ON public.messaging_translation_reports (created_at DESC, id DESC);

CREATE TRIGGER messaging_translation_reports_immutable
  BEFORE DELETE OR UPDATE ON public.messaging_translation_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_messaging_history_change();

CREATE TABLE public.messaging_translations (
  id              uuid                                   DEFAULT gen_random_uuid() NOT NULL,
  message_id      uuid                                   NOT NULL,
  target_language public.cottage_profile_source_language NOT NULL,
  provider        text                                   NOT NULL,
  model           text                                   NOT NULL,
  prompt_version  text                                   NOT NULL,
  translated_body text                                   NOT NULL,
  created_at      timestamp with time zone               DEFAULT clock_timestamp() NOT NULL
);

CREATE POLICY "Reporter or MFA administrator reads translation reports" ON public.messaging_translation_reports
  FOR SELECT
  TO authenticated
  USING ((((reporter_user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT public.messaging_conversation_is_readable(( SELECT messages.conversation_id
           FROM (public.messaging_translations translations
             JOIN public.messaging_messages messages ON ((messages.id = translations.message_id)))
          WHERE (translations.id = messaging_translation_reports.translation_id))) AS messaging_conversation_is_readable)) OR
            ( SELECT public.is_platform_administrator('aal2'::text) AS is_platform_administrator)));

ALTER TABLE public.messaging_translations
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.messaging_translations
  ADD CONSTRAINT messaging_translations_body CHECK (translated_body = btrim(translated_body) AND char_length(translated_body) >= 1 AND char_length(translated_body) <= 2000);

ALTER TABLE public.messaging_translations
  ADD CONSTRAINT messaging_translations_cache_key UNIQUE (message_id, target_language, PROVIDER, model, prompt_version);

ALTER TABLE public.messaging_translations
  ADD CONSTRAINT messaging_translations_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messaging_messages(id) ON DELETE RESTRICT;

ALTER TABLE public.messaging_translations
  ADD CONSTRAINT messaging_translations_pkey PRIMARY KEY (id);

ALTER TABLE public.messaging_translation_reports
  ADD CONSTRAINT messaging_translation_reports_translation_id_fkey FOREIGN KEY (translation_id) REFERENCES public.messaging_translations(id) ON DELETE RESTRICT;

ALTER TABLE public.messaging_translations
  ADD CONSTRAINT messaging_translations_provenance
    CHECK
    (provider = btrim(provider) AND char_length(provider) >= 1 AND char_length(provider) <= 80 AND model = btrim(model) AND char_length(model) >= 1 AND char_length(model) <= 120
    AND prompt_version = btrim(prompt_version) AND char_length(prompt_version) >= 1 AND char_length(prompt_version) <= 120);

GRANT SELECT ON public.messaging_translations TO authenticated;

CREATE INDEX messaging_translations_message_idx ON public.messaging_translations (message_id, created_at, id);

CREATE TRIGGER messaging_translations_immutable
  BEFORE DELETE OR UPDATE ON public.messaging_translations
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_messaging_history_change();

CREATE POLICY "Authorized readers see saved message translations" ON public.messaging_translations
  FOR SELECT
  TO authenticated
  USING (( SELECT public.messaging_conversation_is_readable(( SELECT messages.conversation_id
           FROM public.messaging_messages messages
          WHERE (messages.id = messaging_translations.message_id))) AS messaging_conversation_is_readable));