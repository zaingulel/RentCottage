-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.hide_customer_review (
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