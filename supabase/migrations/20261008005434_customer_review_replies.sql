-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.get_owner_customer_review (
  target_reference text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor uuid:=(select auth.uid());
  actor_context public.account_contexts;
  request public.booking_requests;
  review public.customer_reviews;
  reply jsonb;
begin
  select * into actor_context
  from public.account_contexts
  where user_id=actor;
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

  select requests.* into request
  from public.booking_requests requests
  join public.owner_application_cottage_profiles profiles
    on profiles.id=requests.profile_id
    and profiles.owner_user_id=requests.owner_user_id
  where requests.booking_request_reference=target_reference;
  if request.id is null or request.owner_user_id is distinct from actor then
    raise exception 'Customer review reply access is unavailable' using errcode='42501';
  end if;

  select * into review
  from public.customer_reviews reviews
  where reviews.booking_request_id=request.id;
  if review.id is null then
    return jsonb_build_object('status','no-review');
  end if;

  select jsonb_build_object(
    'originalLanguage',replies.original_language,
    'originalBody',replies.original_body,
    'submittedAt',replies.submitted_at,
    'moderationState',case
      when exists(
        select 1 from public.customer_review_reply_hides reply_hides
        where reply_hides.review_id=replies.review_id
      ) then 'hidden'
      else 'unhidden'
    end
  ) into reply
  from public.customer_review_replies replies
  where replies.review_id=review.id;

  if exists(
    select 1 from public.customer_review_hides hides
    where hides.review_id=review.id
  ) then
    return jsonb_build_object('status','review-hidden','reply',reply);
  end if;

  return jsonb_build_object(
    'status','reviewed',
    'rating',review.rating,
    'originalLanguage',review.original_language,
    'originalBody',review.original_body,
    'submittedAt',review.submitted_at,
    'reply',reply
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.get_owner_customer_review(text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_owner_customer_review(text) TO authenticated;

CREATE FUNCTION public.hide_customer_review_reply (
  target_review_id uuid,
  target_reason    text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor uuid:=(select auth.uid());
  existing public.customer_review_reply_hides;
  hidden public.customer_review_reply_hides;
  affected_public_slug text;
  affected_booking_request_reference text;
begin
  if actor is null or public.is_platform_administrator('aal2') is not true then
    raise exception 'Customer review moderation is unavailable' using errcode='42501';
  end if;
  if target_review_id is null
    or target_reason is null
    or target_reason !~ '[^\s\uFEFF]'
    or char_length(btrim(target_reason)) > 2000
  then
    return jsonb_build_object('status','invalid');
  end if;

  if not exists(
    select 1 from public.customer_review_replies replies
    where replies.review_id=target_review_id
  ) then
    return jsonb_build_object('status','invalid');
  end if;

  select * into existing
  from public.customer_review_reply_hides reply_hides
  where reply_hides.review_id=target_review_id;
  if existing.review_id is not null then
    return jsonb_build_object(
      'status','already-hidden',
      'reviewId',existing.review_id,
      'administratorUserId',existing.administrator_user_id,
      'reason',existing.reason,
      'hiddenAt',existing.hidden_at
    );
  end if;

  select listings.public_slug,requests.booking_request_reference
  into affected_public_slug,affected_booking_request_reference
  from public.customer_reviews reviews
  join public.booking_requests requests
    on requests.id=reviews.booking_request_id
    and requests.profile_id=reviews.profile_id
  join public.cottage_marketplace_listings listings
    on listings.profile_id=reviews.profile_id
  where reviews.id=target_review_id;
  if affected_public_slug is null
    or affected_public_slug !~ '^cottage-[0-9a-f]{32}$'
    or affected_booking_request_reference is null
    or affected_booking_request_reference !~ '^RC-REQ-[A-F0-9]{16}$'
  then
    return jsonb_build_object('status','unavailable');
  end if;

  insert into public.customer_review_reply_hides(
    review_id,administrator_user_id,reason
  ) values (target_review_id,actor,btrim(target_reason))
  returning * into hidden;
  return jsonb_build_object(
    'status','hidden',
    'reviewId',hidden.review_id,
    'administratorUserId',hidden.administrator_user_id,
    'reason',hidden.reason,
    'hiddenAt',hidden.hidden_at,
    'affectedPublicSlug',affected_public_slug,
    'affectedBookingRequestReference',affected_booking_request_reference
  );
exception
  when unique_violation then
    select * into existing
    from public.customer_review_reply_hides reply_hides
    where reply_hides.review_id=target_review_id;
    return jsonb_build_object(
      'status','already-hidden',
      'reviewId',existing.review_id,
      'administratorUserId',existing.administrator_user_id,
      'reason',existing.reason,
      'hiddenAt',existing.hidden_at
    );
end;
$function$;

REVOKE ALL ON FUNCTION public.hide_customer_review_reply(uuid, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.hide_customer_review_reply(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_administrator_customer_reviews (
  target_before_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  target_before_id uuid                     DEFAULT NULL::uuid,
  target_limit     integer                  DEFAULT 50
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  items jsonb;
  has_more boolean;
  next_cursor jsonb;
begin
  if (select auth.uid()) is null
    or public.is_platform_administrator('aal2') is not true
  then
    raise exception 'Customer review administration is unavailable' using errcode='42501';
  end if;
  if (target_before_at is null) <> (target_before_id is null)
    or target_limit is null
    or target_limit < 1
    or target_limit > 50
  then
    raise exception 'Customer review cursor is invalid' using errcode='22023';
  end if;

  with page as (
    select reviews.id,reviews.profile_id,reviews.author_user_id,
      reviews.rating,reviews.original_language,reviews.original_body,
      reviews.submitted_at,requests.booking_request_reference,
      hides.administrator_user_id,hides.reason,hides.hidden_at,
      (
        select jsonb_build_object(
          'authorUserId',replies.author_user_id,
          'originalLanguage',replies.original_language,
          'originalBody',replies.original_body,
          'submittedAt',replies.submitted_at,
          'moderationState',case
            when reply_hides.review_id is null then 'unhidden'
            else 'hidden'
          end,
          'hide',case
            when reply_hides.review_id is null then null
            else jsonb_build_object(
              'administratorUserId',reply_hides.administrator_user_id,
              'reason',reply_hides.reason,
              'hiddenAt',reply_hides.hidden_at
            )
          end
        )
        from public.customer_review_replies replies
        left join public.customer_review_reply_hides reply_hides
          on reply_hides.review_id=replies.review_id
        where replies.review_id=reviews.id
      ) reply
    from public.customer_reviews reviews
    join public.booking_requests requests on requests.id=reviews.booking_request_id
    left join public.customer_review_hides hides on hides.review_id=reviews.id
    where target_before_at is null
      or (reviews.submitted_at,reviews.id)<(target_before_at,target_before_id)
    order by reviews.submitted_at desc,reviews.id desc
    limit target_limit+1
  ), enumerated as (
    select page.*,
      row_number() over(order by page.submitted_at desc,page.id desc) ordinal,
      jsonb_build_object(
        'reviewId',page.id,
        'bookingRequestReference',page.booking_request_reference,
        'profileId',page.profile_id,
        'authorUserId',page.author_user_id,
        'rating',page.rating,
        'originalLanguage',page.original_language,
        'originalBody',page.original_body,
        'submittedAt',page.submitted_at,
        'moderationState',case
          when page.administrator_user_id is null then 'unhidden'
          else 'hidden'
        end,
        'hide',case
          when page.administrator_user_id is null then null
          else jsonb_build_object(
            'administratorUserId',page.administrator_user_id,
            'reason',page.reason,
            'hiddenAt',page.hidden_at
          )
        end,
        'reply',page.reply
      ) item
    from page
  )
  select
    coalesce(
      jsonb_agg(item order by submitted_at desc,id desc)
        filter (where ordinal<=target_limit),
      '[]'::jsonb
    ),
    count(*)>target_limit,
    (jsonb_agg(
      jsonb_build_object('submittedAt',submitted_at,'reviewId',id)
      order by submitted_at desc,id desc
    ) filter (where ordinal=target_limit))->0
  into items,has_more,next_cursor
  from enumerated;

  return jsonb_build_object(
    'status','success',
    'items',items,
    'nextCursor',case when has_more then next_cursor end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_public_customer_reviews (
  target_slug      text,
  target_before_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  target_before_id uuid                     DEFAULT NULL::uuid,
  target_limit     integer                  DEFAULT 20
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target_profile_id uuid;
  items jsonb;
  has_more boolean;
  next_cursor jsonb;
begin
  if (target_before_at is null) <> (target_before_id is null)
    or target_limit is null
    or target_limit < 1
    or target_limit > 50
  then
    raise exception 'Customer review cursor is invalid' using errcode='22023';
  end if;

  select listings.profile_id into target_profile_id
  from public.cottage_marketplace_listings listings
  where listings.public_slug=target_slug
    and public.is_cottage_publicly_discoverable(listings.profile_id);

  if target_profile_id is null then
    return jsonb_build_object('status','not-found');
  end if;

  with page as (
    select reviews.id,reviews.rating,reviews.original_language,
      reviews.original_body,reviews.submitted_at,
      (
        select jsonb_build_object(
          'originalLanguage',replies.original_language,
          'originalBody',replies.original_body,
          'submittedAt',replies.submitted_at
        )
        from public.customer_review_replies replies
        where replies.review_id=reviews.id
          and not exists(
            select 1 from public.customer_review_reply_hides reply_hides
            where reply_hides.review_id=replies.review_id
          )
      ) owner_reply
    from public.customer_reviews reviews
    join public.booking_requests requests
      on requests.id=reviews.booking_request_id
      and requests.profile_id=reviews.profile_id
      and requests.customer_user_id=reviews.author_user_id
    join public.booking_confirmations confirmations
      on confirmations.id=reviews.booking_confirmation_id
      and confirmations.booking_request_id=requests.id
    join public.cottage_booking_period_commitments commitments
      on commitments.id=requests.booking_period_commitment_id
      and commitments.status='confirmed_booking'
    join public.booking_completion_maturity maturity
      on maturity.booking_request_id=requests.id
      and maturity.outcome='completed'
    join public.booking_lifecycle_outcomes outcomes
      on outcomes.id=maturity.lifecycle_outcome_id
      and outcomes.booking_request_id=requests.id
      and outcomes.outcome='completed'
    where reviews.profile_id=target_profile_id
      and public.booking_request_payment_status(requests)='paid-confirmed'
      and not exists(
        select 1 from public.booking_request_confirmation_invalidations invalidations
        where invalidations.booking_request_id=requests.id
      )
      and not exists(
        select 1 from public.booking_request_payment_required_expiry_work expiry
        where expiry.booking_request_id=requests.id and expiry.state='quarantined'
      )
      and not exists(
        select 1 from public.customer_review_hides hides
        where hides.review_id=reviews.id
      )
      and (
        target_before_at is null
        or (reviews.submitted_at,reviews.id)<(target_before_at,target_before_id)
      )
    order by reviews.submitted_at desc,reviews.id desc
    limit target_limit+1
  ), enumerated as (
    select page.*,
      row_number() over(order by page.submitted_at desc,page.id desc) ordinal,
      jsonb_build_object(
        'reviewId',page.id,
        'rating',page.rating,
        'originalLanguage',page.original_language,
        'originalBody',page.original_body,
        'submittedAt',page.submitted_at,
        'ownerReply',page.owner_reply
      ) item
    from page
  )
  select
    coalesce(
      jsonb_agg(item order by submitted_at desc,id desc)
        filter (where ordinal<=target_limit),
      '[]'::jsonb
    ),
    count(*)>target_limit,
    (jsonb_agg(
      jsonb_build_object('submittedAt',submitted_at,'reviewId',id)
      order by submitted_at desc,id desc
    ) filter (where ordinal=target_limit))->0
  into items,has_more,next_cursor
  from enumerated;

  return jsonb_build_object(
    'status','success',
    'items',items,
    'nextCursor',case when has_more then next_cursor end
  );
end;
$function$;

CREATE FUNCTION public.submit_customer_review_reply (
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
  select * into actor_context
  from public.account_contexts
  where user_id=actor;
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

REVOKE ALL ON FUNCTION public.submit_customer_review_reply(text, public.cottage_profile_source_language, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.submit_customer_review_reply(text, public.cottage_profile_source_language, text) TO authenticated;

CREATE TABLE public.customer_review_replies (
  review_id         uuid                                   NOT NULL,
  author_user_id    uuid                                   NOT NULL,
  original_language public.cottage_profile_source_language NOT NULL,
  original_body     text                                   NOT NULL,
  submitted_at      timestamp with time zone               DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.customer_review_replies
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.customer_review_replies
  ADD CONSTRAINT customer_review_replies_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.customer_review_replies
  ADD CONSTRAINT customer_review_replies_original_body_check
    CHECK (char_length(original_body) <= 2000 AND original_body ~ '[^\s\uFEFF]');

ALTER TABLE public.customer_review_replies
  ADD CONSTRAINT customer_review_replies_pkey PRIMARY KEY (review_id);

ALTER TABLE public.customer_review_replies
  ADD CONSTRAINT customer_review_replies_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.customer_reviews(id) ON DELETE RESTRICT;

CREATE TRIGGER customer_review_replies_immutable
  BEFORE DELETE OR UPDATE ON public.customer_review_replies
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_customer_review_fact_change();

CREATE TABLE public.customer_review_reply_hides (
  review_id             uuid                     NOT NULL,
  administrator_user_id uuid                     NOT NULL,
  reason                text                     NOT NULL,
  hidden_at             timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.customer_review_reply_hides
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.customer_review_reply_hides
  ADD CONSTRAINT customer_review_reply_hides_administrator_user_id_fkey FOREIGN KEY (administrator_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.customer_review_reply_hides
  ADD CONSTRAINT customer_review_reply_hides_pkey PRIMARY KEY (review_id);

ALTER TABLE public.customer_review_reply_hides
  ADD CONSTRAINT customer_review_reply_hides_reason_check CHECK (reason ~ '[^\s\uFEFF]' AND char_length(btrim(reason)) <= 2000);

ALTER TABLE public.customer_review_reply_hides
  ADD CONSTRAINT customer_review_reply_hides_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.customer_review_replies(review_id) ON DELETE RESTRICT;

CREATE TRIGGER customer_review_reply_hides_immutable
  BEFORE DELETE OR UPDATE ON public.customer_review_reply_hides
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_customer_review_fact_change();

REVOKE ALL PRIVILEGES ON TABLE public.customer_review_replies FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.customer_review_reply_hides FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_customer_review_reply(text, public.cottage_profile_source_language, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_owner_customer_review(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hide_customer_review_reply(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.submit_customer_review_reply(text, public.cottage_profile_source_language, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_owner_customer_review(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hide_customer_review_reply(uuid, text) TO authenticated;
