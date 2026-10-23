-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.approve_cottage_profile_publication (
  target_review_cycle_id uuid,
  target_reason          text
)
  RETURNS public.cottage_publication_snapshots
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare cycle public.cottage_profile_review_cycles;
declare profile public.owner_application_cottage_profiles;
declare owner_context public.account_contexts;
declare publication public.cottage_publication_snapshots;
declare submitted_source public.cottage_profile_source_revisions;
declare baseline_description text;
declare baseline_house_rules text;
declare approved_description text;
declare approved_house_rules text;
declare reconciled_description text;
declare reconciled_house_rules text;
declare publication_mode text;
begin
  if (select public.is_platform_administrator('aal2')) IS NOT TRUE then raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501'; end if;
  perform 1 from public.cottage_translation_runtime_control where singleton for share;
  perform 1 from public.cottage_demo_translation_control where singleton for share;
  select * into cycle from public.cottage_profile_review_cycles where id = target_review_cycle_id for update;
  if not found or cycle.state <> 'in_review' then raise exception 'Cottage review cycle is unavailable' using errcode = 'RC204'; end if;
  select * into profile from public.owner_application_cottage_profiles where id = cycle.profile_id for update;
  if profile.business_suspended then
    raise exception 'Cottage publication is unavailable while activity is suspended' using errcode='RC204';
  end if;
  select * into owner_context from public.account_contexts
    where user_id = profile.owner_user_id for update;
  if not found or owner_context.role <> 'cottage_owner'
    or owner_context.owner_approval_state <> 'approved' then
    raise exception 'Approved Cottage Owner access is required' using errcode = '42501';
  end if;
  publication_mode := public.cottage_translation_runtime_mode();
  if publication_mode = 'unavailable' then
    raise exception 'Translation and publication are disabled by runtime control' using errcode = 'RC246';
  end if;
  if cycle.name is null or cycle.governorate is null or cycle.approximate_location is null
    or cycle.capacity is null or cycle.bedrooms is null or cycle.bathrooms is null
    or cardinality(cycle.amenities) < 1 then raise exception 'Reviewed public Cottage Profile fields are incomplete' using errcode = 'RC203'; end if;
  if public.reads_as_coordinate_pair(cycle.approximate_location) then raise exception 'Reviewed Approximate Location reads as a coordinate pair' using errcode = 'RC203'; end if;
  if (select count(*) from public.cottage_profile_localized_heads where review_cycle_id = cycle.id) <> 3 then raise exception 'All three localized heads are required' using errcode = 'RC203'; end if;
  if (select count(distinct revisions.locale)
      from public.cottage_profile_localized_revisions revisions
      join public.cottage_profile_source_revisions source on source.id = cycle.source_revision_id
      where revisions.review_cycle_id = cycle.id and revisions.origin = 'generated'
        and revisions.locale <> source.source_language
        and revisions.translation_environment is not distinct from
          (case when publication_mode = 'fictional' then 'hosted-demo-yvibcyqtyihpzpmomnzg' end)) <> 2 then
    raise exception 'Both non-source languages require generated provenance' using errcode = 'RC203';
  end if;
  if (publication_mode = 'production' and exists (
    select 1 from public.cottage_profile_localized_revisions revisions
    where revisions.review_cycle_id = cycle.id and revisions.translation_environment is not null
  )) or exists (
    select 1 from public.cottage_profile_localized_heads heads
    join public.cottage_profile_localized_revisions revisions on revisions.id = heads.localized_revision_id
    join public.cottage_profile_source_revisions source on source.id = cycle.source_revision_id
    where heads.review_cycle_id = cycle.id and revisions.locale <> source.source_language
      and revisions.translation_environment is distinct from
        (case when publication_mode = 'fictional' then 'hosted-demo-yvibcyqtyihpzpmomnzg' end)
  ) then
    raise exception 'Current localized provenance does not match publication mode' using errcode = 'RC203';
  end if;
  if exists (
    select 1 from public.cottage_profile_localized_heads heads
    where heads.review_cycle_id = cycle.id and (
      select decisions.approved
      from public.cottage_profile_localized_decisions decisions
      where decisions.review_cycle_id = heads.review_cycle_id
        and decisions.locale = heads.locale
        and decisions.localized_revision_id = heads.localized_revision_id
      order by decisions.decided_at desc, decisions.id desc
      limit 1
    ) is distinct from true
  ) then raise exception 'Every current localized head requires approval' using errcode = 'RC203'; end if;
  if not exists (select 1 from public.cottage_profile_review_photos where review_cycle_id = cycle.id) then raise exception 'Approved publication photos are required' using errcode = 'RC203'; end if;
  if not exists (
    select 1 from public.cottage_profile_review_photos reviewed
    join public.cottage_profile_photos photos on photos.id = reviewed.photo_id
    where reviewed.review_cycle_id = cycle.id and photos.state = 'ready' and not photos.public_hidden
  ) then raise exception 'At least one approved photo must remain visible' using errcode = 'RC203'; end if;
  select * into submitted_source from public.cottage_profile_source_revisions
    where id = cycle.source_revision_id and profile_id = profile.id;
  if not found then
    raise exception 'Submitted Cottage source evidence is unavailable' using errcode = 'RC203';
  end if;
  if cycle.remediation_publication_id is null then
    baseline_description := submitted_source.description;
    baseline_house_rules := submitted_source.house_rules;
  else
    select localizations.description, localizations.house_rules
      into baseline_description, baseline_house_rules
    from public.cottage_publication_snapshots snapshots
    join public.cottage_publication_localizations localizations
      on localizations.publication_id = snapshots.id
      and localizations.locale = submitted_source.source_language
    where snapshots.id = cycle.remediation_publication_id and snapshots.profile_id = profile.id;
    if not found then
      raise exception 'Remediation source baseline is unavailable' using errcode = 'RC203';
    end if;
  end if;
  insert into public.cottage_publication_snapshots (
    profile_id, review_cycle_id, publication_number, name, governorate,
    approximate_location, capacity, bedrooms, bathrooms, amenities
  ) values (
    profile.id, cycle.id,
    coalesce((select max(publication_number) from public.cottage_publication_snapshots where profile_id = profile.id), 0) + 1,
    cycle.name, cycle.governorate, cycle.approximate_location,
    cycle.capacity, cycle.bedrooms, cycle.bathrooms, cycle.amenities
  ) returning * into publication;
  insert into public.cottage_publication_localizations (
    publication_id, locale, localized_revision_id, description, house_rules
  ) select publication.id, heads.locale, revisions.id, revisions.description, revisions.house_rules
    from public.cottage_profile_localized_heads heads
    join public.cottage_profile_localized_revisions revisions on revisions.id = heads.localized_revision_id
    where heads.review_cycle_id = cycle.id;
  select description, house_rules into approved_description, approved_house_rules
    from public.cottage_publication_localizations
    where publication_id = publication.id and locale = submitted_source.source_language;
  reconciled_description := profile.description;
  reconciled_house_rules := profile.house_rules;
  if profile.source_language = submitted_source.source_language then
    if profile.description is not distinct from baseline_description then
      reconciled_description := approved_description;
    end if;
    if profile.house_rules is not distinct from baseline_house_rules then
      reconciled_house_rules := approved_house_rules;
    end if;
  end if;
  insert into public.cottage_publication_media (publication_id, photo_id, object_path, media_type, position)
    select publication.id, photos.id, photos.object_path, photos.media_type, review_photos.position
    from public.cottage_profile_review_photos review_photos
    join public.cottage_profile_photos photos on photos.id = review_photos.photo_id
    where review_photos.review_cycle_id = cycle.id and photos.state = 'ready';
  if (select count(*) from public.cottage_publication_media where publication_id = publication.id)
      <> (select count(*) from public.cottage_profile_review_photos where review_cycle_id = cycle.id) then
    raise exception 'Approved publication photos are incomplete' using errcode = 'RC203';
  end if;
  insert into public.cottage_profile_publication_decisions (
    review_cycle_id, administrator_user_id, approved, reason
  ) values (cycle.id, (select auth.uid()), true, btrim(target_reason));
  update public.cottage_profile_review_cycles set state = 'approved', decided_at = now() where id = cycle.id;
  update public.owner_application_cottage_profiles
    set current_publication_id = publication.id, status = 'draft',
      submitted_source_revision_id = null, version = version + 1, updated_at = now()
    where id = profile.id;
  -- Source protection examines OLD.status, so reconciliation follows the draft transition.
  if (reconciled_description, reconciled_house_rules)
      is distinct from (profile.description, profile.house_rules) then
    update public.owner_application_cottage_profiles
      set description = reconciled_description, house_rules = reconciled_house_rules
      where id = profile.id;
  end if;
  return publication;
end;
$function$;

CREATE OR REPLACE FUNCTION public.begin_cottage_profile_translation_execution (
  target_review_cycle_id    uuid,
  target_language           public.cottage_profile_source_language,
  target_route              text,
  target_lease_milliseconds integer
)
  RETURNS public.cottage_profile_translation_attempts
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare cycle public.cottage_profile_review_cycles;
declare source public.cottage_profile_source_revisions;
declare attempt public.cottage_profile_translation_attempts;
declare expected_head uuid;
declare publication_mode text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  if target_route not in ('ordinary', 'stronger_model') then
    raise exception 'Translation route is invalid' using errcode = '22023';
  end if;
  if target_lease_milliseconds not between 1000 and 900000 then
    raise exception 'Translation execution lease is invalid' using errcode = '22023';
  end if;
  perform 1 from public.cottage_translation_runtime_control where singleton for share;
  perform 1 from public.cottage_demo_translation_control where singleton for share;
  publication_mode := public.cottage_translation_runtime_mode();
  if publication_mode = 'unavailable' then
    raise exception 'Translation and publication are disabled by runtime control' using errcode = 'RC246';
  end if;
  select * into cycle
  from public.cottage_profile_review_cycles
  where id = target_review_cycle_id
  for update;
  if not found or cycle.state <> 'in_review' then
    raise exception 'Cottage review cycle is unavailable' using errcode = 'RC204';
  end if;
  select * into source
  from public.cottage_profile_source_revisions
  where id = cycle.source_revision_id;
  if target_language = source.source_language then
    raise exception 'The source language does not require translation' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.cottage_profile_translation_human_reviews reviews
    where reviews.review_cycle_id = cycle.id
      and reviews.locale = target_language
      and reviews.state = 'active'
  ) then
    raise exception 'The current localization is routed to human review' using errcode = 'RC204';
  end if;
  select * into attempt
  from public.cottage_profile_translation_attempts attempts
  where attempts.review_cycle_id = cycle.id
    and attempts.target_language = begin_cottage_profile_translation_execution.target_language
    and attempts.state = 'pending'
  for update;
  if found and attempt.lease_expires_at > now() then
    raise exception 'Translation execution is already leased' using errcode = 'RC409';
  end if;
  if found then
    update public.cottage_profile_translation_attempts
    set state = 'superseded', completed_at = now()
    where id = attempt.id;
  end if;
  select localized_revision_id into expected_head
  from public.cottage_profile_localized_heads
  where review_cycle_id = cycle.id and locale = target_language;
  insert into public.cottage_profile_translation_attempts (
    review_cycle_id, source_revision_id, target_language,
    expected_localized_revision_id, attempt_number, route,
    lease_token, lease_expires_at, translation_environment
  ) values (
    cycle.id, source.id, target_language, expected_head,
    coalesce((
      select max(attempt_number)
      from public.cottage_profile_translation_attempts existing
      where existing.review_cycle_id = cycle.id
        and existing.target_language = begin_cottage_profile_translation_execution.target_language
    ), 0) + 1,
    target_route, gen_random_uuid(),
    now() + target_lease_milliseconds * interval '1 millisecond',
    case when publication_mode = 'fictional' then 'hosted-demo-yvibcyqtyihpzpmomnzg' end
  ) returning * into attempt;
  return attempt;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_cottage_profile_translation_execution (
  target_attempt_id       uuid,
  target_lease_token      uuid,
  translated_description  text,
  translated_house_rules  text,
  returned_provider       text,
  returned_model          text,
  returned_effort         text,
  returned_prompt_version text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare attempt public.cottage_profile_translation_attempts;
declare publication_mode text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  perform 1 from public.cottage_translation_runtime_control where singleton for share;
  perform 1 from public.cottage_demo_translation_control where singleton for share;
  publication_mode := public.cottage_translation_runtime_mode();
  if publication_mode = 'unavailable' then
    raise exception 'Translation and publication are disabled by runtime control' using errcode = 'RC246';
  end if;
  select * into attempt
  from public.cottage_profile_translation_attempts
  where id = target_attempt_id
  for update;
  if not found or attempt.state <> 'pending'
    or attempt.lease_token <> target_lease_token then return false; end if;
  if attempt.lease_expires_at <= now() or exists (
    select 1 from public.cottage_profile_translation_human_reviews reviews
    where reviews.review_cycle_id = attempt.review_cycle_id
      and reviews.locale = attempt.target_language
      and reviews.state = 'active'
  ) then
    update public.cottage_profile_translation_attempts
    set state = 'superseded', completed_at = now()
    where id = attempt.id;
    return false;
  end if;
  return public.complete_cottage_profile_translation(
    target_attempt_id, translated_description, translated_house_rules,
    returned_provider, returned_model, returned_effort, returned_prompt_version
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_cottage_profile_translation (
  target_attempt_id       uuid,
  translated_description  text,
  translated_house_rules  text,
  returned_provider       text,
  returned_model          text,
  returned_effort         text,
  returned_prompt_version text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare attempt public.cottage_profile_translation_attempts;
declare localized_id uuid;
declare cycle public.cottage_profile_review_cycles;
declare current_head uuid;
declare cycle_available boolean;
declare publication_mode text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  perform 1 from public.cottage_translation_runtime_control where singleton for share;
  perform 1 from public.cottage_demo_translation_control where singleton for share;
  publication_mode := public.cottage_translation_runtime_mode();
  if publication_mode = 'unavailable' then
    raise exception 'Translation and publication are disabled by runtime control' using errcode = 'RC246';
  end if;
  select * into attempt from public.cottage_profile_translation_attempts where id = target_attempt_id for update;
  if not found or attempt.state <> 'pending' then return false; end if;
  if attempt.translation_environment is distinct from
      (case when publication_mode = 'fictional' then 'hosted-demo-yvibcyqtyihpzpmomnzg' end)
    or (publication_mode = 'fictional' and (
      btrim(returned_provider), btrim(returned_model), btrim(returned_effort), btrim(returned_prompt_version)
    ) is distinct from (
      'fictional-cottage-translations', 'catalog-v1', 'none', 'fictional-cottage-catalog-v1'
    ))
    or (publication_mode = 'production' and (
      btrim(returned_provider) = 'fictional-cottage-translations'
      and btrim(returned_model) = 'catalog-v1'
      and btrim(returned_effort) = 'none'
      and btrim(returned_prompt_version) = 'fictional-cottage-catalog-v1'
    )) then
    raise exception 'Translation result does not match runtime provenance' using errcode = 'RC246';
  end if;
  select * into cycle from public.cottage_profile_review_cycles
    where id = attempt.review_cycle_id for update;
  cycle_available := found;
  select localized_revision_id into current_head
    from public.cottage_profile_localized_heads
    where review_cycle_id = attempt.review_cycle_id
      and locale = attempt.target_language;
  if not cycle_available or cycle.state <> 'in_review'
    or current_head is distinct from attempt.expected_localized_revision_id
    or exists (select 1 from public.cottage_profile_translation_attempts newer
      where newer.review_cycle_id = attempt.review_cycle_id and newer.target_language = attempt.target_language
        and newer.attempt_number > attempt.attempt_number) then
    update public.cottage_profile_translation_attempts set state = 'superseded', completed_at = now()
      where id = attempt.id;
    return false;
  end if;
  if char_length(btrim(coalesce(translated_description, ''))) not between 1 and 2000
    or char_length(btrim(coalesce(translated_house_rules, ''))) not between 1 and 1500
    or char_length(btrim(coalesce(returned_provider, ''))) < 1
    or char_length(btrim(coalesce(returned_model, ''))) < 1
    or char_length(btrim(coalesce(returned_effort, ''))) < 1
    or char_length(btrim(coalesce(returned_prompt_version, ''))) < 1 then
    raise exception 'Translation result is invalid' using errcode = '22023';
  end if;
  insert into public.cottage_profile_localized_revisions (
    review_cycle_id, locale, revision, origin, description, house_rules,
    provider, model, effort, prompt_version, translation_environment
  ) values (
    attempt.review_cycle_id, attempt.target_language,
    coalesce((select max(revision) from public.cottage_profile_localized_revisions
      where review_cycle_id = attempt.review_cycle_id and locale = attempt.target_language), 0) + 1,
    'generated', btrim(translated_description), btrim(translated_house_rules),
    btrim(returned_provider), btrim(returned_model), btrim(returned_effort), btrim(returned_prompt_version), attempt.translation_environment
  ) returning id into localized_id;
  insert into public.cottage_profile_localized_heads (review_cycle_id, locale, localized_revision_id)
  values (attempt.review_cycle_id, attempt.target_language, localized_id)
  on conflict (review_cycle_id, locale) do update set localized_revision_id = excluded.localized_revision_id;
  update public.cottage_profile_translation_attempts set state = 'completed',
    provider = btrim(returned_provider), model = btrim(returned_model), effort = btrim(returned_effort),
    prompt_version = btrim(returned_prompt_version), completed_at = now() where id = attempt.id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.correct_cottage_profile_localization (
  target_review_cycle_id uuid,
  target_locale          public.cottage_profile_source_language,
  corrected_description  text,
  corrected_house_rules  text,
  target_reason          text
)
  RETURNS public.cottage_profile_localized_revisions
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare revision public.cottage_profile_localized_revisions;
declare cycle public.cottage_profile_review_cycles;
declare source public.cottage_profile_source_revisions;
declare current_revision public.cottage_profile_localized_revisions;
begin
  if not (select public.is_platform_administrator('aal2')) then raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501'; end if;
  select * into cycle from public.cottage_profile_review_cycles
    where id = target_review_cycle_id for update;
  if not found or cycle.state <> 'in_review' then raise exception 'Cottage review cycle is unavailable' using errcode = 'RC204'; end if;
  select * into source from public.cottage_profile_source_revisions where id = cycle.source_revision_id;
  select revisions.* into current_revision
    from public.cottage_profile_localized_heads heads
    join public.cottage_profile_localized_revisions revisions on revisions.id = heads.localized_revision_id
    where heads.review_cycle_id = target_review_cycle_id and heads.locale = target_locale;
  if not found or (target_locale <> source.source_language and not exists (
    select 1 from public.cottage_profile_localized_revisions generated
    where generated.review_cycle_id = target_review_cycle_id
      and generated.locale = target_locale and generated.origin = 'generated'
  )) then
    raise exception 'A generated localized revision is required before correction' using errcode = 'RC204';
  end if;
  insert into public.cottage_profile_localized_revisions (
    review_cycle_id, locale, revision, origin, description, house_rules,
    administrator_user_id, correction_reason, translation_environment
  ) values (
    target_review_cycle_id, target_locale,
    coalesce((select max(localized.revision) from public.cottage_profile_localized_revisions localized
      where localized.review_cycle_id = target_review_cycle_id and localized.locale = target_locale), 0) + 1,
    'administrator_correction', btrim(corrected_description), btrim(corrected_house_rules),
    (select auth.uid()), btrim(target_reason), current_revision.translation_environment
  ) returning * into revision;
  insert into public.cottage_profile_localized_heads (review_cycle_id, locale, localized_revision_id)
  values (target_review_cycle_id, target_locale, revision.id)
  on conflict (review_cycle_id, locale) do update set localized_revision_id = excluded.localized_revision_id;
  return revision;
end;
$function$;

CREATE FUNCTION public.cottage_translation_runtime_mode()
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare production public.cottage_translation_runtime_control;
declare demo public.cottage_demo_translation_control;
begin
  select * into production from public.cottage_translation_runtime_control where singleton;
  if not found then
    raise exception 'Translation runtime control is unavailable' using errcode = 'RC246';
  end if;
  select * into demo from public.cottage_demo_translation_control where singleton;
  if not found or demo.environment is distinct from 'hosted-demo-yvibcyqtyihpzpmomnzg'
    or (production.production_ready and demo.enabled) then
    raise exception 'Translation runtime admission is invalid' using errcode = 'RC246';
  end if;
  if production.production_ready then return 'production'; end if;
  if demo.enabled then return 'fictional'; end if;
  return 'unavailable';
end;
$function$;

REVOKE ALL ON FUNCTION public.cottage_translation_runtime_mode() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.cottage_translation_runtime_mode() TO service_role;

CREATE OR REPLACE FUNCTION public.get_cottage_translation_administration()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare control public.cottage_translation_runtime_control;
declare month_start date := date_trunc('month', now())::date;
begin
  if not (select public.is_platform_administrator('aal2')) then
    raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501';
  end if;
  select * into control
  from public.cottage_translation_runtime_control
  where singleton;
  if not found then
    raise exception 'Translation runtime control is unavailable' using errcode = 'RC246';
  end if;
  return jsonb_build_object(
    'productionReady', control.production_ready,
    'publicationMode', public.cottage_translation_runtime_mode(),
    'approvedEvaluationArtifactDigest', control.approved_evaluation_artifact_digest,
    'productionApprovalDigest', control.production_approval_digest,
    'providerTermsApproved', control.provider_terms_approval_reference is not null,
    'nativeReviewApproved', control.native_review_approval_reference is not null,
    'qualityThresholdApproved', control.quality_threshold_approval_reference is not null,
    'ordinaryModel', control.ordinary_model,
    'ordinaryEffort', control.ordinary_effort,
    'strongerModel', control.stronger_model,
    'strongerEffort', control.stronger_effort,
    'judgeModel', control.judge_model,
    'judgeEffort', control.judge_effort,
    'monthlyRequestLimit', control.monthly_request_limit,
    'monthlyTokenLimit', control.monthly_token_limit,
    'monthlySpendMicrousdLimit', control.monthly_spend_microusd_limit,
    'monthRequests', (
      select count(*) from public.cottage_translation_usage_reservations usage
      where usage.billing_month = month_start
    ),
    'monthReservedTokens', (
      select coalesce(sum(usage.reserved_tokens), 0)
      from public.cottage_translation_usage_reservations usage
      where usage.billing_month = month_start
    ),
    'monthReservedMicrousd', (
      select coalesce(sum(usage.reserved_microusd), 0)
      from public.cottage_translation_usage_reservations usage
      where usage.billing_month = month_start
    ),
    'monthActualMicrousd', (
      select coalesce(sum(results.actual_microusd), 0)
      from public.cottage_translation_usage_results results
      join public.cottage_translation_usage_reservations usage
        on usage.id = results.reservation_id
      where usage.billing_month = month_start
    ),
    'qualityReportCount', (select count(*) from public.cottage_translation_quality_reports)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.report_current_cottage_translation (
  target_review_cycle_id       uuid,
  target_localized_revision_id uuid,
  target_reason                text
)
  RETURNS public.cottage_translation_quality_reports
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare cycle public.cottage_profile_review_cycles;
declare revision public.cottage_profile_localized_revisions;
declare report public.cottage_translation_quality_reports;
declare profile public.owner_application_cottage_profiles;
declare publication public.cottage_publication_snapshots;
declare remediation public.cottage_profile_review_cycles;
declare current_head_visible boolean;
declare published_visible boolean;
declare published_head record;
declare witness public.cottage_profile_localized_revisions;
declare copied_head_id uuid;
declare copied_head_revision integer;
declare source_language public.cottage_profile_source_language;
begin
  if char_length(btrim(coalesce(target_reason, ''))) not between 1 and 1000 then
    raise exception 'A translation report reason is required' using errcode = '22023';
  end if;
  select * into cycle
  from public.cottage_profile_review_cycles
  where id = target_review_cycle_id
  for update;
  if not found or cycle.owner_user_id <> (select auth.uid())
    or not exists (
      select 1 from public.account_contexts contexts
      where contexts.user_id = (select auth.uid())
        and contexts.role = 'cottage_owner'
        and contexts.owner_approval_state = 'approved'
    ) then
    raise exception 'Cottage translation report access is denied' using errcode = '42501';
  end if;
  select * into revision
  from public.cottage_profile_localized_revisions
  where id = target_localized_revision_id
    and review_cycle_id = cycle.id
  for share;
  if not found or revision.origin <> 'generated' then
    raise exception 'A generated localization is required' using errcode = 'RC204';
  end if;
  select * into profile
  from public.owner_application_cottage_profiles
  where id = cycle.profile_id
  for update;
  current_head_visible := cycle.state = 'in_review' and exists (
    select 1 from public.cottage_profile_localized_heads heads
    where heads.review_cycle_id = cycle.id
      and heads.locale = revision.locale
      and heads.localized_revision_id = revision.id
  );
  select snapshots.* into publication
  from public.cottage_publication_snapshots snapshots
  where snapshots.id = profile.current_publication_id
    and snapshots.profile_id = profile.id;
  published_visible := found and exists (
    select 1 from public.cottage_publication_localizations localizations
    where localizations.publication_id = publication.id
      and localizations.locale = revision.locale
      and localizations.localized_revision_id = revision.id
  );
  if not current_head_visible and not published_visible then
    raise exception 'The generated localization is no longer current' using errcode = 'RC409';
  end if;

  select * into report
  from public.cottage_translation_quality_reports reports
  where reports.localized_revision_id = revision.id
    and reports.reporter_user_id = (select auth.uid());
  if found then return report; end if;

  if published_visible then
    select * into remediation
    from public.cottage_profile_review_cycles cycles
    where cycles.profile_id = profile.id and cycles.state = 'in_review'
    for update;
    if found and remediation.remediation_publication_id is distinct from publication.id then
      raise exception 'A different Cottage review cycle is already active' using errcode = 'RC409';
    end if;
    if not found then
      insert into public.cottage_profile_review_cycles (
        profile_id, owner_user_id, source_revision_id, name, governorate,
        approximate_location, capacity, bedrooms, bathrooms, amenities,
        cycle_number, remediation_publication_id
      ) values (
        profile.id, cycle.owner_user_id, cycle.source_revision_id,
        publication.name, publication.governorate,
        publication.approximate_location, publication.capacity,
        publication.bedrooms, publication.bathrooms, publication.amenities,
        coalesce((
          select max(cycles.cycle_number)
          from public.cottage_profile_review_cycles cycles
          where cycles.profile_id = profile.id
        ), 0) + 1,
        publication.id
      ) returning * into remediation;

      select source.source_language into source_language
      from public.cottage_profile_source_revisions source where source.id = cycle.source_revision_id;
      for published_head in
        select published.*, localizations.description as published_description,
          localizations.house_rules as published_house_rules
        from public.cottage_publication_localizations localizations
        join public.cottage_profile_localized_revisions published
          on published.id = localizations.localized_revision_id
        where localizations.publication_id = publication.id
      loop
        copied_head_revision := 1;
        if published_head.origin = 'administrator_correction' and published_head.locale <> source_language then
          select generated.* into witness
          from public.cottage_profile_localized_revisions generated
          where generated.review_cycle_id = published_head.review_cycle_id
            and generated.locale = published_head.locale and generated.origin = 'generated'
            and generated.revision < published_head.revision
            and generated.translation_environment is not distinct from published_head.translation_environment
          order by generated.revision desc, generated.id desc limit 1;
          if not found then
            raise exception 'Corrected publication generated provenance is unavailable' using errcode = 'RC203';
          end if;
          insert into public.cottage_profile_localized_revisions (
            review_cycle_id, locale, revision, origin, description, house_rules,
            provider, model, effort, prompt_version, translation_environment
          ) values (
            remediation.id, witness.locale, 1, witness.origin, witness.description, witness.house_rules,
            witness.provider, witness.model, witness.effort, witness.prompt_version, witness.translation_environment
          );
          copied_head_revision := 2;
        end if;
        insert into public.cottage_profile_localized_revisions (
          review_cycle_id, locale, revision, origin, description, house_rules,
          provider, model, effort, prompt_version, administrator_user_id, correction_reason,
          translation_environment
        ) values (
          remediation.id, published_head.locale, copied_head_revision, published_head.origin,
          published_head.published_description, published_head.published_house_rules,
          published_head.provider, published_head.model, published_head.effort, published_head.prompt_version,
          published_head.administrator_user_id, published_head.correction_reason, published_head.translation_environment
        ) returning id into copied_head_id;
        insert into public.cottage_profile_localized_heads (review_cycle_id, locale, localized_revision_id)
        values (remediation.id, published_head.locale, copied_head_id);
      end loop;

      insert into public.cottage_profile_review_photos (
        review_cycle_id, photo_id, position
      )
      select remediation.id, media.photo_id, media.position
      from public.cottage_publication_media media
      where media.publication_id = publication.id;
    end if;
  else
    remediation := cycle;
  end if;

  insert into public.cottage_translation_quality_reports (
    review_cycle_id, remediation_review_cycle_id, localized_revision_id,
    locale, reporter_user_id, reason
  ) values (
    cycle.id, remediation.id, revision.id, revision.locale,
    (select auth.uid()), btrim(target_reason)
  ) returning * into report;
  return report;
end;
$function$;

CREATE TABLE public.cottage_demo_translation_control (
  singleton   boolean DEFAULT true NOT NULL,
  environment text    DEFAULT 'hosted-demo-yvibcyqtyihpzpmomnzg'::text NOT NULL,
  enabled     boolean DEFAULT false NOT NULL
);

ALTER TABLE public.cottage_demo_translation_control
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cottage_demo_translation_control
  ADD CONSTRAINT cottage_demo_translation_control_environment CHECK (environment = 'hosted-demo-yvibcyqtyihpzpmomnzg'::text);

ALTER TABLE public.cottage_demo_translation_control
  ADD CONSTRAINT cottage_demo_translation_control_pkey PRIMARY KEY (singleton);

ALTER TABLE public.cottage_demo_translation_control
  ADD CONSTRAINT cottage_demo_translation_control_singleton CHECK (singleton);

REVOKE ALL ON TABLE public.cottage_demo_translation_control FROM PUBLIC, anon, authenticated, service_role;
REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.cottage_demo_translation_control FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.cottage_demo_translation_control (singleton, environment, enabled)
VALUES (true, 'hosted-demo-yvibcyqtyihpzpmomnzg', false);

ALTER TABLE public.cottage_profile_localized_revisions
  ADD COLUMN translation_environment text;

ALTER TABLE public.cottage_profile_localized_revisions
  ADD CONSTRAINT cottage_profile_localized_revision_environment CHECK (translation_environment IS NULL OR translation_environment = 'hosted-demo-yvibcyqtyihpzpmomnzg'::text);

ALTER TABLE public.cottage_profile_localized_revisions
  ADD CONSTRAINT cottage_profile_localized_revision_provenance
    CHECK
    (origin = 'owner_source'::text AND translation_environment IS NULL OR origin = 'administrator_correction'::text OR origin = 'generated'::text AND
    COALESCE(translation_environment IS NULL AND
    NOT (provider = 'fictional-cottage-translations'::text AND model = 'catalog-v1'::text AND effort = 'none'::text AND prompt_version = 'fictional-cottage-catalog-v1'::text) OR
    translation_environment = 'hosted-demo-yvibcyqtyihpzpmomnzg'::text AND provider = 'fictional-cottage-translations'::text AND model = 'catalog-v1'::text AND effort =
    'none'::text AND prompt_version = 'fictional-cottage-catalog-v1'::text, false));

GRANT SELECT(translation_environment) ON TABLE public.cottage_profile_localized_revisions TO authenticated;

ALTER TABLE public.cottage_profile_translation_attempts
  ADD COLUMN translation_environment text;

ALTER TABLE public.cottage_profile_translation_attempts
  ADD CONSTRAINT cottage_profile_translation_attempt_environment CHECK (translation_environment IS NULL OR translation_environment = 'hosted-demo-yvibcyqtyihpzpmomnzg'::text);

ALTER TABLE public.cottage_profile_translation_attempts
  ADD CONSTRAINT cottage_profile_translation_attempt_provenance
    CHECK (provider IS NULL AND model IS NULL AND effort IS NULL AND prompt_version IS NULL OR COALESCE(translation_environment IS NULL AND
    NOT (provider = 'fictional-cottage-translations'::text AND model = 'catalog-v1'::text AND effort = 'none'::text AND prompt_version = 'fictional-cottage-catalog-v1'::text) OR
    translation_environment = 'hosted-demo-yvibcyqtyihpzpmomnzg'::text AND provider = 'fictional-cottage-translations'::text AND model = 'catalog-v1'::text AND effort =
    'none'::text AND prompt_version = 'fictional-cottage-catalog-v1'::text, false));