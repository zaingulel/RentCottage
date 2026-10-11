-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.customer_review_translation_actor_is_eligible (
  target_actor_user_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists(
    select 1
    from public.account_contexts contexts
    join auth.users users on users.id=contexts.user_id
    where contexts.user_id=target_actor_user_id
      and contexts.role in ('customer','cottage_owner')
      and users.phone_confirmed_at is not null
  );
$function$;

REVOKE ALL ON FUNCTION public.customer_review_translation_actor_is_eligible(uuid) FROM PUBLIC;

CREATE FUNCTION public.customer_review_translation_source (
  target_review_id uuid,
  target_subject   text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.customer_review_translation_source(uuid, text) FROM PUBLIC;

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
$function$;

CREATE FUNCTION public.prepare_customer_review_translation (
  target_actor_user_id  uuid,
  target_review_id      uuid,
  target_subject        text,
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
$function$;

REVOKE ALL ON FUNCTION public.prepare_customer_review_translation(uuid, uuid, text, public.cottage_profile_source_language, text, text, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.prepare_customer_review_translation(uuid, uuid, text, public.cottage_profile_source_language, text, text, text) TO service_role;

CREATE FUNCTION public.save_customer_review_translation (
  target_actor_user_id   uuid,
  target_review_id       uuid,
  target_subject         text,
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
$function$;

REVOKE ALL ON FUNCTION public.save_customer_review_translation(uuid, uuid, text, public.cottage_profile_source_language, text, text, text, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.save_customer_review_translation(uuid, uuid, text, public.cottage_profile_source_language, text, text, text, text) TO service_role;

CREATE TABLE public.customer_review_translations (
  id              uuid                                   DEFAULT gen_random_uuid() NOT NULL,
  review_id       uuid                                   NOT NULL,
  subject         text                                   NOT NULL,
  target_language public.cottage_profile_source_language NOT NULL,
  provider        text                                   NOT NULL,
  model           text                                   NOT NULL,
  prompt_version  text                                   NOT NULL,
  translated_body text                                   NOT NULL,
  created_at      timestamp with time zone               DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.customer_review_translations
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.customer_review_translations
  ADD CONSTRAINT customer_review_translations_cache_key UNIQUE (review_id, subject, target_language, PROVIDER, model, prompt_version);

ALTER TABLE public.customer_review_translations
  ADD CONSTRAINT customer_review_translations_pkey PRIMARY KEY (id);

ALTER TABLE public.customer_review_translations
  ADD CONSTRAINT customer_review_translations_provenance_check
    CHECK
    (provider = btrim(provider) AND char_length(provider) >= 1 AND char_length(provider) <= 80 AND model = btrim(model) AND char_length(model) >= 1 AND char_length(model) <= 120
    AND prompt_version = btrim(prompt_version) AND char_length(prompt_version) >= 1 AND char_length(prompt_version) <= 120);

ALTER TABLE public.customer_review_translations
  ADD CONSTRAINT customer_review_translations_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.customer_reviews(id) ON DELETE RESTRICT;

ALTER TABLE public.customer_review_translations
  ADD CONSTRAINT customer_review_translations_subject_check CHECK (subject = ANY (ARRAY['review'::text, 'reply'::text]));

ALTER TABLE public.customer_review_translations
  ADD CONSTRAINT customer_review_translations_translated_body_check CHECK (char_length(translated_body) <= 4000 AND translated_body ~ '[^\s\uFEFF]'::text);

CREATE TRIGGER customer_review_translations_immutable
  BEFORE DELETE OR UPDATE ON public.customer_review_translations
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_customer_review_fact_change();

REVOKE ALL PRIVILEGES ON TABLE public.customer_review_translations FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.customer_review_translation_actor_is_eligible(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.customer_review_translation_source(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_customer_review_translation(uuid, uuid, text, public.cottage_profile_source_language, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_customer_review_translation(uuid, uuid, text, public.cottage_profile_source_language, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.prepare_customer_review_translation(uuid, uuid, text, public.cottage_profile_source_language, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_customer_review_translation(uuid, uuid, text, public.cottage_profile_source_language, text, text, text, text) TO service_role;