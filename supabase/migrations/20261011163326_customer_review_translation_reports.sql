-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.list_customer_review_translation_reports (
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
$function$;

REVOKE ALL ON FUNCTION public.list_customer_review_translation_reports(timestamp WITH time zone, uuid, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_customer_review_translation_reports(timestamp WITH time zone, uuid, integer) TO authenticated;

CREATE FUNCTION public.report_customer_review_translation (
  target_actor_user_id  uuid,
  target_translation_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.report_customer_review_translation(uuid, uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.report_customer_review_translation(uuid, uuid) TO service_role;

CREATE TABLE public.customer_review_translation_reports (
  id               uuid                     DEFAULT gen_random_uuid() NOT NULL,
  translation_id   uuid                     NOT NULL,
  reporter_user_id uuid                     NOT NULL,
  created_at       timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.customer_review_translation_reports
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.customer_review_translation_reports
  ADD CONSTRAINT customer_review_translation_reports_pkey PRIMARY KEY (id);

ALTER TABLE public.customer_review_translation_reports
  ADD CONSTRAINT customer_review_translation_reports_reporter_key UNIQUE (translation_id, reporter_user_id);

ALTER TABLE public.customer_review_translation_reports
  ADD CONSTRAINT customer_review_translation_reports_reporter_user_id_fkey FOREIGN KEY (reporter_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.customer_review_translation_reports
  ADD CONSTRAINT customer_review_translation_reports_translation_id_fkey FOREIGN KEY (translation_id) REFERENCES public.customer_review_translations(id) ON DELETE RESTRICT;

CREATE INDEX customer_review_translation_reports_cursor_idx ON public.customer_review_translation_reports (created_at DESC, id DESC);

CREATE TRIGGER customer_review_translation_reports_immutable
  BEFORE DELETE OR UPDATE ON public.customer_review_translation_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_customer_review_fact_change();

REVOKE ALL PRIVILEGES ON TABLE public.customer_review_translation_reports FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.report_customer_review_translation(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_customer_review_translation_reports(timestamp with time zone, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.report_customer_review_translation(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_customer_review_translation_reports(timestamp with time zone, uuid, integer) TO authenticated;