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

  perform 1 from public.account_contexts contexts
  where contexts.user_id = target_actor_user_id
  for share of contexts;

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

  if target_actor_user_id = target_conversation.customer_user_id and exists (
    select 1 from public.account_contexts contexts
    where contexts.user_id = target_actor_user_id and contexts.customer_suspended
  ) then
    return jsonb_build_object('status', 'suspended');
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

CREATE OR REPLACE FUNCTION public.create_messaging_conversation_for_cottage (
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
  where listings.public_slug = target_public_slug;
  if target_profile_id is null then
    return jsonb_build_object('status', 'access-required');
  end if;
  return public.create_messaging_conversation(
    target_actor_user_id, target_profile_id, target_command_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_messaging_conversation (
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
  perform 1 from public.account_contexts contexts
  where contexts.user_id = target_actor_user_id
  for share of contexts;

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
  select profiles.owner_user_id into target_owner_user_id
  from public.owner_application_cottage_profiles profiles
  where profiles.id = target_profile_id
  for update of profiles;
  if exists (
    select 1 from public.account_contexts contexts
    where contexts.user_id = target_actor_user_id and contexts.customer_suspended
  ) then
    return jsonb_build_object('status', 'suspended');
  end if;
  if target_owner_user_id is null
    or target_owner_user_id = target_actor_user_id
    or not public.is_cottage_publicly_discoverable(target_profile_id) then
    return jsonb_build_object('status', 'access-required');
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

CREATE OR REPLACE FUNCTION public.get_customer_review (
  target_reference text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor uuid:=(select auth.uid());
  actor_context public.account_contexts;
  request public.booking_requests;
  review public.customer_reviews;
  eligibility jsonb;
begin
  select * into actor_context
  from public.account_contexts
  where user_id=actor;
  if actor is null
    or (actor_context.role in ('customer','cottage_owner')) is not true
    or not exists(
      select 1 from auth.users users
      where users.id=actor and users.phone_confirmed_at is not null
    )
  then
    raise exception 'Customer review access is unavailable' using errcode='42501';
  end if;

  select * into request
  from public.booking_requests requests
  where requests.booking_request_reference=target_reference;
  if request.id is null or request.customer_user_id is distinct from actor then
    raise exception 'Customer review access is unavailable' using errcode='42501';
  end if;

  select * into review
  from public.customer_reviews reviews
  where reviews.booking_request_id=request.id;
  if review.id is not null then
    return jsonb_build_object(
      'status','submitted',
      'reviewId',review.id,
      'rating',review.rating,
      'originalLanguage',review.original_language,
      'originalBody',review.original_body,
      'submittedAt',review.submitted_at,
      'moderationState',case
        when exists(
          select 1 from public.customer_review_hides hides
          where hides.review_id=review.id
        ) then 'hidden'
        else 'unhidden'
      end
    );
  end if;

  if actor_context.customer_suspended then
    return jsonb_build_object('status','suspended');
  end if;

  if public.booking_request_payment_status(request) is distinct from 'paid-confirmed' then
    return jsonb_build_object('status','ineligible');
  end if;
  eligibility:=public.booking_completion_eligibility_at(
    request.id,clock_timestamp()
  );
  if eligibility->>'status'='completed'
    and (eligibility->>'reviewAvailable')::boolean is true
  then
    return jsonb_build_object(
      'status','eligible','reviewExpiresAt',eligibility->'reviewExpiresAt'
    );
  end if;
  if eligibility->>'status'='unavailable' then
    if not exists(
      select 1 from public.booking_lifecycle_outcomes outcomes
      where outcomes.booking_request_id=request.id
        and outcomes.outcome='completed'
    ) then
      return jsonb_build_object('status','ineligible');
    end if;
    return jsonb_build_object('status','unavailable');
  end if;
  return jsonb_build_object('status','ineligible');
end;
$function$;

CREATE OR REPLACE FUNCTION public.messaging_conversation_header (
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
    'sendRestriction', case
      when conversations.customer_user_id = auth.uid() and actor_context.customer_suspended
        then 'customer-suspended' else null end,
    'createdAt', conversations.created_at,
    'canContinueBookingRequest', public.is_cottage_publicly_discoverable(conversations.profile_id)
      and not coalesce(actor_context.customer_suspended
        and conversations.customer_user_id = auth.uid(), false) and not exists (
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
        'lifecycleStatus', case when public.messaging_booking_has_paid_access(requests.id)
          then public.booking_lifecycle_status(requests.id) else null end,
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
        'lifecycleStatus', case when public.messaging_booking_has_paid_access(history_requests.id)
          then public.booking_lifecycle_status(history_requests.id) else null end,
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
  left join public.account_contexts actor_context
    on actor_context.user_id = auth.uid()
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

CREATE OR REPLACE FUNCTION public.open_messaging_conversation_for_booking (
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

  perform 1 from public.account_contexts contexts
  where contexts.user_id = target_actor_user_id
  for share of contexts;
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

  if target_actor_user_id = target_request.customer_user_id and exists (
    select 1 from public.account_contexts contexts
    where contexts.user_id = target_actor_user_id and contexts.customer_suspended
  ) then
    return jsonb_build_object('status', 'suspended');
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

CREATE OR REPLACE FUNCTION public.submit_customer_review_reply (
  target_reference         text,
  target_original_language public.cottage_profile_source_language,
  target_original_body     text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor uuid:=(select auth.uid());
  actor_context public.account_contexts;
  request public.booking_requests;
  review public.customer_reviews;
  existing public.customer_review_replies;
  replied public.customer_review_replies;
  affected_public_slug text;
begin
  select requests.* into request
  from public.booking_requests requests
  join public.owner_application_cottage_profiles profiles
    on profiles.id=requests.profile_id
    and profiles.owner_user_id=requests.owner_user_id
  where requests.booking_request_reference=target_reference;
  if request.id is null or request.owner_user_id is distinct from actor then
    raise exception 'Customer review reply access is unavailable' using errcode='42501';
  end if;

  -- The share lock waits for an uncommitted hide; the lookups below then see it.
  select * into review
  from public.customer_reviews reviews
  where reviews.booking_request_id=request.id
  for share;
  select * into actor_context
  from public.account_contexts
  where user_id=actor
  for share;
  if actor is null
    or actor_context.role is distinct from 'cottage_owner'
    or actor_context.owner_approval_state is distinct from 'approved'
    or not exists(
      select 1 from auth.users users
      where users.id=actor and users.phone_confirmed_at is not null
    )
  then
    raise exception 'Customer review reply access is unavailable' using errcode='42501';
  end if;

  if review.id is null then
    return jsonb_build_object('status','ineligible');
  end if;

  select * into existing
  from public.customer_review_replies replies
  where replies.review_id=review.id;
  if existing.review_id is not null then
    return jsonb_build_object(
      'status','duplicate',
      'reviewId',existing.review_id,
      'submittedAt',existing.submitted_at
    );
  end if;

  if exists(
    select 1 from public.customer_review_hides hides
    where hides.review_id=review.id
  ) then
    return jsonb_build_object('status','ineligible');
  end if;

  if target_original_language is null
    or target_original_body is null
    or char_length(target_original_body) > 2000
    or target_original_body !~ '[^\s\uFEFF]'
  then
    return jsonb_build_object('status','invalid');
  end if;

  if not public.contact_protection_text_is_safe(target_original_body) then
    return jsonb_build_object('status','prohibited-content');
  end if;

  select listings.public_slug into affected_public_slug
  from public.cottage_marketplace_listings listings
  where listings.profile_id=review.profile_id;
  if affected_public_slug is null
    or affected_public_slug !~ '^cottage-[0-9a-f]{32}$'
  then
    return jsonb_build_object('status','unavailable');
  end if;

  insert into public.customer_review_replies(
    review_id,author_user_id,original_language,original_body
  ) values (
    review.id,actor,target_original_language,target_original_body
  ) returning * into replied;

  return jsonb_build_object(
    'status','replied',
    'reviewId',replied.review_id,
    'submittedAt',replied.submitted_at,
    'affectedPublicSlug',affected_public_slug
  );
exception
  when unique_violation then
    select * into existing
    from public.customer_review_replies replies
    where replies.review_id=review.id;
    return jsonb_build_object(
      'status','duplicate',
      'reviewId',existing.review_id,
      'submittedAt',existing.submitted_at
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_customer_review (
  target_reference         text,
  target_rating            integer,
  target_original_language public.cottage_profile_source_language,
  target_original_body     text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor uuid:=(select auth.uid());
  actor_context public.account_contexts;
  request public.booking_requests;
  confirmation public.booking_confirmations;
  eligibility jsonb;
  existing public.customer_reviews;
  submitted public.customer_reviews;
  admitted_body text;
  affected_public_slug text;
begin
  select * into request
  from public.booking_requests requests
  where requests.booking_request_reference=target_reference
  for update;

  if request.id is null or request.customer_user_id is distinct from actor then
    raise exception 'Customer review access is unavailable' using errcode='42501';
  end if;

  select * into actor_context
  from public.account_contexts
  where user_id=actor
  for share;

  if actor is null
    or (actor_context.role in ('customer','cottage_owner')) is not true
    or not exists(
      select 1 from auth.users users
      where users.id=actor and users.phone_confirmed_at is not null
    )
  then
    raise exception 'Customer review access is unavailable' using errcode='42501';
  end if;

  select * into existing
  from public.customer_reviews reviews
  where reviews.booking_request_id=request.id;
  if existing.id is not null then
    return jsonb_build_object(
      'status','duplicate','reviewId',existing.id,'submittedAt',existing.submitted_at
    );
  end if;

  if actor_context.customer_suspended then
    return jsonb_build_object('status','suspended');
  end if;

  if target_rating is null
    or target_rating not between 1 and 5
    or target_original_language is null
    or (
      target_original_body is not null
      and char_length(target_original_body) > 2000
    )
  then
    return jsonb_build_object('status','invalid');
  end if;

  admitted_body:=case
    when coalesce(target_original_body,'') !~ '\S' then null
    else target_original_body
  end;
  if not public.contact_protection_text_is_safe(coalesce(admitted_body,'')) then
    return jsonb_build_object('status','prohibited-content');
  end if;

  eligibility:=public.booking_completion_eligibility_at(
    request.id,clock_timestamp()
  );
  select * into confirmation
  from public.booking_confirmations confirmations
  where confirmations.booking_request_id=request.id;
  if public.booking_request_payment_status(request) is distinct from 'paid-confirmed'
    or confirmation.id is null
    or eligibility->>'status' is distinct from 'completed'
    or (eligibility->>'reviewAvailable')::boolean is distinct from true
  then
    return jsonb_build_object('status','ineligible');
  end if;

  select listings.public_slug into affected_public_slug
  from public.cottage_marketplace_listings listings
  where listings.profile_id=request.profile_id;
  if affected_public_slug is null
    or affected_public_slug !~ '^cottage-[0-9a-f]{32}$'
  then
    return jsonb_build_object('status','unavailable');
  end if;

  insert into public.customer_reviews(
    booking_request_id,booking_confirmation_id,profile_id,author_user_id,
    rating,original_language,original_body
  ) values (
    request.id,confirmation.id,request.profile_id,actor,
    target_rating,target_original_language,admitted_body
  ) returning * into submitted;

  return jsonb_build_object(
    'status','submitted',
    'reviewId',submitted.id,
    'submittedAt',submitted.submitted_at,
    'affectedPublicSlug',affected_public_slug
  );
exception
  when unique_violation then
    select * into existing
    from public.customer_reviews reviews
    where reviews.booking_request_id=request.id;
    return jsonb_build_object(
      'status','duplicate','reviewId',existing.id,'submittedAt',existing.submitted_at
    );
end;
$function$;