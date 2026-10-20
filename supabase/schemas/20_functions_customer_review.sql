SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.reject_customer_review_fact_change()
RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
begin
  raise exception 'Customer review facts are immutable' using errcode='RC409';
end;
$$;

ALTER FUNCTION public.reject_customer_review_fact_change() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.submit_customer_review(
  target_reference text,
  target_rating integer,
  target_original_language public.cottage_profile_source_language,
  target_original_body text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
$$;

ALTER FUNCTION public.submit_customer_review(text,integer,public.cottage_profile_source_language,text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_customer_review(target_reference text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
$$;

ALTER FUNCTION public.get_customer_review(text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.hide_customer_review(
  target_review_id uuid,
  target_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare
  actor uuid:=(select auth.uid());
  review public.customer_reviews;
  existing public.customer_review_hides;
  hidden public.customer_review_hides;
  affected_public_slug text;
  affected_booking_request_reference text;
begin
  if actor is null or public.is_platform_administrator('aal2') is not true then
    raise exception 'Customer review moderation is unavailable' using errcode='42501';
  end if;
  if target_review_id is null
    or target_reason is null
    or target_reason !~ '\S'
    or char_length(btrim(target_reason)) > 2000
  then
    return jsonb_build_object('status','invalid');
  end if;

  select * into review
  from public.customer_reviews reviews
  where reviews.id=target_review_id
  for update;
  if review.id is null then
    return jsonb_build_object('status','invalid');
  end if;

  select * into existing
  from public.customer_review_hides hides
  where hides.review_id=review.id;
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
  from public.booking_requests requests
  join public.cottage_marketplace_listings listings
    on listings.profile_id=review.profile_id
  where requests.id=review.booking_request_id
    and requests.profile_id=review.profile_id;
  if affected_public_slug is null
    or affected_public_slug !~ '^cottage-[0-9a-f]{32}$'
    or affected_booking_request_reference is null
    or affected_booking_request_reference !~ '^RC-REQ-[A-F0-9]{16}$'
  then
    return jsonb_build_object('status','unavailable');
  end if;

  insert into public.customer_review_hides(
    review_id,administrator_user_id,reason
  ) values (review.id,actor,btrim(target_reason))
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
    from public.customer_review_hides hides
    where hides.review_id=target_review_id;
    return jsonb_build_object(
      'status','already-hidden',
      'reviewId',existing.review_id,
      'administratorUserId',existing.administrator_user_id,
      'reason',existing.reason,
      'hiddenAt',existing.hidden_at
    );
end;
$$;

ALTER FUNCTION public.hide_customer_review(uuid,text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.submit_customer_review_reply(
  target_reference text,
  target_original_language public.cottage_profile_source_language,
  target_original_body text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
$$;

ALTER FUNCTION public.submit_customer_review_reply(text,public.cottage_profile_source_language,text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_owner_customer_review(target_reference text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
$$;

ALTER FUNCTION public.get_owner_customer_review(text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.list_owner_customer_reviews(
  target_before_at timestamptz DEFAULT NULL,
  target_before_id uuid DEFAULT NULL,
  target_limit integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
declare
  actor uuid:=(select auth.uid());
  actor_context public.account_contexts;
  entry record;
  items jsonb:='[]'::jsonb;
  next_cursor jsonb:=null;
  last_cursor jsonb;
begin
  select * into actor_context from public.account_contexts where user_id=actor;
  if actor is null
    or actor_context.role is distinct from 'cottage_owner'
    or actor_context.owner_approval_state is distinct from 'approved'
    or not exists(select 1 from auth.users users
      where users.id=actor and users.phone_confirmed_at is not null)
  then
    raise exception 'Customer review reply access is unavailable' using errcode='42501';
  end if;
  if (target_before_at is null) <> (target_before_id is null)
    or target_limit is null or target_limit < 1 or target_limit > 50
  then
    raise exception 'Customer review cursor is invalid' using errcode='22023';
  end if;

  for entry in
    select reviews.id,reviews.submitted_at,requests.booking_request_reference,
      snapshots.quote_payload->'cottageName' cottage_name
    from public.customer_reviews reviews
    join public.booking_requests requests
      on requests.id=reviews.booking_request_id and requests.profile_id=reviews.profile_id
    join public.owner_application_cottage_profiles profiles
      on profiles.id=requests.profile_id and profiles.owner_user_id=requests.owner_user_id
    join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id
    where requests.owner_user_id=actor
      and (target_before_at is null
        or (reviews.submitted_at,reviews.id)<(target_before_at,target_before_id))
    order by reviews.submitted_at desc,reviews.id desc
    limit target_limit+1
  loop
    if jsonb_array_length(items)=target_limit then
      next_cursor:=last_cursor;
      exit;
    end if;
    if jsonb_typeof(entry.cottage_name) is distinct from 'string' then
      return jsonb_build_object('status','unavailable');
    end if;
    items:=items||jsonb_build_array(jsonb_build_object(
      'reviewId',entry.id,'submittedAt',entry.submitted_at,
      'bookingRequestReference',entry.booking_request_reference,
      'cottageName',entry.cottage_name,
      'review',public.get_owner_customer_review(entry.booking_request_reference)
    ));
    last_cursor:=jsonb_build_object('submittedAt',entry.submitted_at,'reviewId',entry.id);
  end loop;
  return jsonb_build_object('status','success','items',items,'nextCursor',next_cursor);
end;
$$;

ALTER FUNCTION public.list_owner_customer_reviews(timestamptz,uuid,integer) OWNER TO postgres;


CREATE OR REPLACE FUNCTION public.hide_customer_review_reply(
  target_review_id uuid,
  target_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
$$;

ALTER FUNCTION public.hide_customer_review_reply(uuid,text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.list_administrator_customer_reviews(
  target_before_at timestamptz DEFAULT NULL,
  target_before_id uuid DEFAULT NULL,
  target_limit integer DEFAULT 50,
  target_state text DEFAULT NULL,
  target_from date DEFAULT NULL,
  target_through date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
declare
  items jsonb;
  has_more boolean;
  next_cursor jsonb;
  total bigint;
  state_counts jsonb;
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
  if target_state is not null and target_state not in ('unhidden','hidden') then
    raise exception 'Customer review state is invalid' using errcode='22023';
  end if;
  if target_from is not null and target_through is not null and target_from > target_through then
    raise exception 'Date range is reversed' using errcode='22023';
  end if;

  with windowed as (
    select reviews.id,reviews.profile_id,reviews.author_user_id,
      reviews.rating,reviews.original_language,reviews.original_body,
      reviews.submitted_at,requests.booking_request_reference,
      hides.administrator_user_id,hides.reason,hides.hidden_at,
      case
        when hides.review_id is null then 'unhidden'
        else 'hidden'
      end moderation_state
    from public.customer_reviews reviews
    join public.booking_requests requests on requests.id=reviews.booking_request_id
    left join public.customer_review_hides hides on hides.review_id=reviews.id
    where (target_from is null or reviews.submitted_at >= (target_from::timestamp at time zone 'Asia/Baghdad'))
      and (target_through is null or reviews.submitted_at < ((target_through + 1)::timestamp at time zone 'Asia/Baghdad'))
  ), filtered as (
    select windowed.*
    from windowed
    where target_state is null or windowed.moderation_state=target_state
  ), page as (
    select filtered.*,
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
        where replies.review_id=filtered.id
      ) reply
    from filtered
    where target_before_at is null
      or (filtered.submitted_at,filtered.id)<(target_before_at,target_before_id)
    order by filtered.submitted_at desc,filtered.id desc
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
        'moderationState',page.moderation_state,
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
    ) filter (where ordinal=target_limit))->0,
    (select count(*) from filtered),
    (
      select jsonb_build_object(
        'unhidden',count(*) filter (where windowed.moderation_state='unhidden'),
        'hidden',count(*) filter (where windowed.moderation_state='hidden')
      )
      from windowed
    )
  into items,has_more,next_cursor,total,state_counts
  from enumerated;

  return jsonb_build_object(
    'status','success',
    'items',items,
    'nextCursor',case when has_more then next_cursor end,
    'total',total,
    'stateCounts',state_counts
  );
end;
$$;

ALTER FUNCTION public.list_administrator_customer_reviews(timestamptz,uuid,integer,text,date,date) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.list_public_customer_reviews(
  target_slug text,
  target_before_at timestamptz DEFAULT NULL,
  target_before_id uuid DEFAULT NULL,
  target_limit integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
          'submittedAt',replies.submitted_at,
          'translations',(
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'translationId',translations.id,
                  'targetLanguage',translations.target_language,
                  'translatedBody',translations.translated_body
                )
                order by translations.created_at,translations.id
              ),
              '[]'::jsonb
            )
            from public.customer_review_translations translations
            where translations.review_id=replies.review_id
              and translations.subject='reply'
          )
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
        'ownerReply',page.owner_reply,
        'translations',(
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'translationId',translations.id,
                'targetLanguage',translations.target_language,
                'translatedBody',translations.translated_body
              )
              order by translations.created_at,translations.id
            ),
            '[]'::jsonb
          )
          from public.customer_review_translations translations
          where translations.review_id=page.id
            and translations.subject='review'
        )
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
$$;

ALTER FUNCTION public.list_public_customer_reviews(text,timestamptz,uuid,integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.customer_review_translation_actor_is_eligible(
  target_actor_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  select exists(
    select 1
    from public.account_contexts contexts
    join auth.users users on users.id=contexts.user_id
    where contexts.user_id=target_actor_user_id
      and contexts.role in ('customer','cottage_owner')
      and users.phone_confirmed_at is not null
  );
$$;

ALTER FUNCTION public.customer_review_translation_actor_is_eligible(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.customer_review_translation_source(
  target_review_id uuid,
  target_subject text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
declare
  source public.customer_reviews;
  target_slug text;
  next_peer_id uuid;
  listed jsonb;
  item jsonb;
begin
  select * into source
  from public.customer_reviews reviews
  where reviews.id=target_review_id;
  if source.id is null then
    return null;
  end if;

  select listings.public_slug into target_slug
  from public.cottage_marketplace_listings listings
  where listings.profile_id=source.profile_id;

  select peers.id into next_peer_id
  from public.customer_reviews peers
  where peers.profile_id=source.profile_id
    and peers.submitted_at=source.submitted_at
    and peers.id>source.id
  order by peers.id limit 1;

  -- The public list is the one home of the visibility rule: this cursor makes the review its
  -- first row when it is public, and any other first row is refused below.
  listed:=public.list_public_customer_reviews(
    target_slug,
    case when next_peer_id is null
      then source.submitted_at+interval '1 microsecond'
      else source.submitted_at end,
    coalesce(next_peer_id,'00000000-0000-0000-0000-000000000000'::uuid),
    1
  );
  item:=listed#>'{items,0}';
  if listed->>'status' is distinct from 'success'
    or item->>'reviewId' is distinct from target_review_id::text
  then
    return null;
  end if;

  if target_subject='review' and item->>'originalBody' is not null then
    return jsonb_build_object(
      'originalLanguage',item->'originalLanguage',
      'originalBody',item->'originalBody'
    );
  end if;
  if target_subject='reply' and jsonb_typeof(item->'ownerReply')='object' then
    return jsonb_build_object(
      'originalLanguage',item#>'{ownerReply,originalLanguage}',
      'originalBody',item#>'{ownerReply,originalBody}'
    );
  end if;
  return null;
end;
$$;

ALTER FUNCTION public.customer_review_translation_source(uuid,text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.prepare_customer_review_translation(
  target_actor_user_id uuid,
  target_review_id uuid,
  target_subject text,
  target_language public.cottage_profile_source_language,
  target_provider text,
  target_model text,
  target_prompt_version text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
declare
  requested_language public.cottage_profile_source_language:=target_language;
  source jsonb;
  cached public.customer_review_translations;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'Customer review translation is unavailable' using errcode='42501';
  end if;
  if target_actor_user_id is null
    or target_review_id is null
    or requested_language is null
    or (target_subject in ('review','reply')) is not true
    or target_provider is distinct from 'fictional-local-test'
    or target_model is distinct from 'deterministic-pairs-v1'
    or target_prompt_version is distinct from 'review-pairs-v1'
  then
    return jsonb_build_object('status','invalid');
  end if;
  if not public.customer_review_translation_actor_is_eligible(target_actor_user_id) then
    return jsonb_build_object('status','access-required');
  end if;

  source:=public.customer_review_translation_source(target_review_id,target_subject);
  if source is null or source->>'originalLanguage'=requested_language::text then
    return jsonb_build_object('status','not-found');
  end if;

  select * into cached
  from public.customer_review_translations translations
  where translations.review_id=target_review_id
    and translations.subject=target_subject
    and translations.target_language=requested_language
    and translations.provider=target_provider
    and translations.model=target_model
    and translations.prompt_version=target_prompt_version;
  if cached.id is not null then
    return jsonb_build_object(
      'status','translated',
      'translationId',cached.id,
      'translatedBody',cached.translated_body
    );
  end if;
  return jsonb_build_object(
    'status','prepared',
    'originalLanguage',source->'originalLanguage',
    'originalBody',source->'originalBody'
  );
end;
$$;

ALTER FUNCTION public.prepare_customer_review_translation(uuid,uuid,text,public.cottage_profile_source_language,text,text,text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.save_customer_review_translation(
  target_actor_user_id uuid,
  target_review_id uuid,
  target_subject text,
  target_language public.cottage_profile_source_language,
  target_provider text,
  target_model text,
  target_prompt_version text,
  target_translated_body text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare
  requested_language public.cottage_profile_source_language:=target_language;
  source jsonb;
  source_after jsonb;
  saved public.customer_review_translations;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'Customer review translation is unavailable' using errcode='42501';
  end if;
  if target_actor_user_id is null
    or target_review_id is null
    or requested_language is null
    or (target_subject in ('review','reply')) is not true
    or target_provider is distinct from 'fictional-local-test'
    or target_model is distinct from 'deterministic-pairs-v1'
    or target_prompt_version is distinct from 'review-pairs-v1'
    or target_translated_body is null
    or char_length(target_translated_body) > 4000
    or target_translated_body !~ '[^\s\uFEFF]'
  then
    return jsonb_build_object('status','invalid');
  end if;
  if not public.customer_review_translation_actor_is_eligible(target_actor_user_id) then
    return jsonb_build_object('status','access-required');
  end if;

  source:=public.customer_review_translation_source(target_review_id,target_subject);
  if source is null or source->>'originalLanguage'=requested_language::text then
    return jsonb_build_object('status','not-found');
  end if;
  if not public.contact_protection_text_is_safe(target_translated_body) then
    return jsonb_build_object('status','blocked');
  end if;

  insert into public.customer_review_translations(
    review_id,subject,target_language,provider,model,prompt_version,translated_body
  ) values (
    target_review_id,target_subject,requested_language,target_provider,target_model,
    target_prompt_version,target_translated_body
  ) on conflict on constraint customer_review_translations_cache_key do nothing;

  select * into saved
  from public.customer_review_translations translations
  where translations.review_id=target_review_id
    and translations.subject=target_subject
    and translations.target_language=requested_language
    and translations.provider=target_provider
    and translations.model=target_model
    and translations.prompt_version=target_prompt_version;

  -- The insert can wait behind a hide or an identical save; text leaves only while the source is still public.
  select public.customer_review_translation_source(target_review_id,target_subject)
  into source_after;
  if source_after is null then
    return jsonb_build_object('status','not-found');
  end if;
  if saved.translated_body is distinct from target_translated_body then
    return jsonb_build_object('status','invalid');
  end if;
  return jsonb_build_object(
    'status','translated',
    'translationId',saved.id,
    'translatedBody',saved.translated_body
  );
end;
$$;

ALTER FUNCTION public.save_customer_review_translation(uuid,uuid,text,public.cottage_profile_source_language,text,text,text,text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.report_customer_review_translation(
  target_actor_user_id uuid,
  target_translation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare
  translation public.customer_review_translations;
  report_id uuid;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'Customer review translation is unavailable' using errcode='42501';
  end if;
  if target_actor_user_id is null or target_translation_id is null then
    return jsonb_build_object('status','invalid');
  end if;
  if not public.customer_review_translation_actor_is_eligible(target_actor_user_id) then
    return jsonb_build_object('status','access-required');
  end if;

  select * into translation
  from public.customer_review_translations translations
  where translations.id=target_translation_id;
  if translation.id is null
    or public.customer_review_translation_source(translation.review_id,translation.subject) is null
  then
    return jsonb_build_object('status','not-found');
  end if;

  insert into public.customer_review_translation_reports(translation_id,reporter_user_id)
  values (target_translation_id,target_actor_user_id)
  on conflict on constraint customer_review_translation_reports_reporter_key do nothing;

  select reports.id into report_id
  from public.customer_review_translation_reports reports
  where reports.translation_id=target_translation_id
    and reports.reporter_user_id=target_actor_user_id;
  return jsonb_build_object('status','reported','reportId',report_id);
end;
$$;

ALTER FUNCTION public.report_customer_review_translation(uuid,uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.list_customer_review_translation_reports(
  target_before_at timestamptz DEFAULT NULL,
  target_before_id uuid DEFAULT NULL,
  target_limit integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
    select reports.id,reports.created_at,
      jsonb_build_object(
        'reportId',reports.id,
        'bookingRequestReference',requests.booking_request_reference,
        'subject',translations.subject,
        'originalLanguage',case
          when translations.subject='reply' then replies.original_language
          else reviews.original_language
        end,
        'originalBody',case
          when translations.subject='reply' then replies.original_body
          else reviews.original_body
        end,
        'targetLanguage',translations.target_language,
        'translatedBody',translations.translated_body,
        'provider',translations.provider,
        'model',translations.model,
        'promptVersion',translations.prompt_version,
        'reportedAt',reports.created_at
      ) item
    from public.customer_review_translation_reports reports
    join public.customer_review_translations translations
      on translations.id=reports.translation_id
    join public.customer_reviews reviews on reviews.id=translations.review_id
    join public.booking_requests requests on requests.id=reviews.booking_request_id
    left join public.customer_review_replies replies on replies.review_id=reviews.id
    where target_before_at is null
      or (reports.created_at,reports.id)<(target_before_at,target_before_id)
    order by reports.created_at desc,reports.id desc
    limit target_limit+1
  ), enumerated as (
    select page.*,
      row_number() over(order by page.created_at desc,page.id desc) ordinal
    from page
  )
  select
    coalesce(
      jsonb_agg(item order by created_at desc,id desc)
        filter (where ordinal<=target_limit),
      '[]'::jsonb
    ),
    count(*)>target_limit,
    (jsonb_agg(
      jsonb_build_object('reportedAt',created_at,'reportId',id)
      order by created_at desc,id desc
    ) filter (where ordinal=target_limit))->0
  into items,has_more,next_cursor
  from enumerated;

  return jsonb_build_object(
    'status','success',
    'items',items,
    'nextCursor',case when has_more then next_cursor end
  );
end;
$$;

ALTER FUNCTION public.list_customer_review_translation_reports(timestamptz,uuid,integer) OWNER TO postgres;
