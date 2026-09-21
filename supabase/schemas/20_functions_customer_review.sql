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
begin
  select * into actor_context
  from public.account_contexts
  where user_id=actor;

  if actor is null
    or actor_context.role not in ('customer','cottage_owner')
    or not exists(
      select 1 from auth.users users
      where users.id=actor and users.phone_confirmed_at is not null
    )
  then
    raise exception 'Customer review access is unavailable' using errcode='42501';
  end if;

  select * into request
  from public.booking_requests requests
  where requests.booking_request_reference=target_reference
  for update;

  if request.id is null or request.customer_user_id is distinct from actor then
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
    when char_length(btrim(coalesce(target_original_body,'')))=0 then null
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

  insert into public.customer_reviews(
    booking_request_id,booking_confirmation_id,profile_id,author_user_id,
    rating,original_language,original_body
  ) values (
    request.id,confirmation.id,request.profile_id,actor,
    target_rating,target_original_language,admitted_body
  ) returning * into submitted;

  return jsonb_build_object(
    'status','submitted','reviewId',submitted.id,'submittedAt',submitted.submitted_at
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
    or actor_context.role not in ('customer','cottage_owner')
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
begin
  if actor is null or public.is_platform_administrator('aal2') is not true then
    raise exception 'Customer review moderation is unavailable' using errcode='42501';
  end if;
  if target_review_id is null
    or target_reason is null
    or char_length(btrim(target_reason)) not between 1 and 2000
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

  insert into public.customer_review_hides(
    review_id,administrator_user_id,reason
  ) values (review.id,actor,btrim(target_reason))
  returning * into hidden;
  return jsonb_build_object(
    'status','hidden',
    'reviewId',hidden.review_id,
    'administratorUserId',hidden.administrator_user_id,
    'reason',hidden.reason,
    'hiddenAt',hidden.hidden_at
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

CREATE OR REPLACE FUNCTION public.list_administrator_customer_reviews(
  target_before_at timestamptz DEFAULT NULL,
  target_before_id uuid DEFAULT NULL,
  target_limit integer DEFAULT 50
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
    select reviews.id,reviews.profile_id,reviews.author_user_id,
      reviews.rating,reviews.original_language,reviews.original_body,
      reviews.submitted_at,requests.booking_request_reference,
      hides.administrator_user_id,hides.reason,hides.hidden_at
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
        end
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

ALTER FUNCTION public.list_administrator_customer_reviews(timestamptz,uuid,integer) OWNER TO postgres;

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
      reviews.original_body,reviews.submitted_at
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
        'submittedAt',page.submitted_at
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
