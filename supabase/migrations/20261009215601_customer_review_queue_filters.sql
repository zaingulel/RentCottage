-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.list_administrator_customer_reviews(target_before_at timestamp WITH time zone, target_before_id uuid, target_limit integer);

CREATE FUNCTION public.list_administrator_customer_reviews (
  target_before_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  target_before_id uuid                     DEFAULT NULL::uuid,
  target_limit     integer                  DEFAULT 50,
  target_state     text                     DEFAULT NULL::text,
  target_from      date                     DEFAULT NULL::date,
  target_through   date                     DEFAULT NULL::date
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
$function$;

REVOKE ALL ON FUNCTION public.list_administrator_customer_reviews(timestamp WITH time zone, uuid, integer, text, date, date) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_administrator_customer_reviews(timestamp WITH time zone, uuid, integer, text, date, date) TO authenticated;

REVOKE ALL ON FUNCTION public.list_administrator_customer_reviews(timestamptz, uuid, integer, text, date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_administrator_customer_reviews(timestamptz, uuid, integer, text, date, date) TO authenticated;
