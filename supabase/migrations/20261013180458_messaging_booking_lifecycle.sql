-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

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