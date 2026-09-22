-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

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