begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, aud, role, phone, phone_confirmed_at, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000006411', 'authenticated', 'authenticated', '+9647500006411', now(), null, null),
  ('00000000-0000-0000-0000-000000006412', 'authenticated', 'authenticated', null, null, 'reconciliation-admin@example.test', now());

insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000006411', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000006412', 'platform_administrator', null);

update public.cottage_translation_runtime_control
set production_ready = true,
    approved_evaluation_artifact_digest = repeat('a', 64),
    production_approval_digest = repeat('b', 64),
    provider_terms_approval_reference = 'test-provider-terms',
    native_review_approval_reference = 'test-native-review',
    quality_threshold_approval_reference = 'test-quality-threshold',
    ordinary_model = 'test-luna', ordinary_effort = 'none', ordinary_prompt_version = 'v1',
    stronger_model = 'test-terra', stronger_effort = 'none', stronger_prompt_version = 'v1',
    judge_model = 'test-sol', judge_effort = 'medium', judge_prompt_version = 'judge-v1',
    monthly_request_limit = 100, monthly_token_limit = 100000,
    monthly_spend_microusd_limit = 1000000,
    updated_at = now()
where singleton;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006411","role":"authenticated","aal":"aal1"}', true);
do $$
declare profile public.owner_application_cottage_profiles;
begin
  select * into profile from public.create_owner_cottage_profile_draft();
  perform set_config('test.reconciliation_profile_id', profile.id::text, true);
  perform public.update_owner_cottage_profile_draft(
    profile.id, 1, 'Reconciliation Garden', 'Erbil', 'Near Shaqlawa',
    'Private reconciliation address', 36.4, 44.3, 'Private reconciliation directions',
    8, 3, 2, array['garden'], 'en',
    'Submitted garden description', 'Submitted quiet hours'
  );
  perform public.replace_cottage_shift_schedule(
    profile.id, 0,
    '[{"name":"Day","startTime":"08:00","endTime":"14:00"},{"name":"Evening","startTime":"18:00","endTime":"23:00"}]'
  );
  perform public.prepare_cottage_profile_photo_upload(
    profile.id, 'reconciliation.webp', 'image/webp', 128
  );
end;
$$;

reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select public.cottage_profile_photo_bucket_name(), photos.object_path,
  photos.owner_user_id::text, '{"size":128,"mimetype":"image/webp"}'::jsonb
from public.cottage_profile_photos photos
where photos.profile_id = current_setting('test.reconciliation_profile_id')::uuid;

set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006412","role":"service_role","aal":"aal2"}', true);
do $$
begin
  perform public.register_cottage_profile_photo(
    (select id from public.cottage_profile_photos
      where profile_id = current_setting('test.reconciliation_profile_id')::uuid)
  );
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006411","role":"authenticated","aal":"aal1"}', true);
do $$
begin
  perform public.submit_cottage_profile_for_content_approval(
    current_setting('test.reconciliation_profile_id')::uuid, 2
  );
  perform set_config('test.reconciliation_cycle_id', (
    select id::text from public.cottage_profile_review_cycles
    where profile_id = current_setting('test.reconciliation_profile_id')::uuid
  ), true);
end;
$$;

set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006412","role":"service_role","aal":"aal2"}', true);
do $$
declare translated record;
declare attempt public.cottage_profile_translation_attempts;
begin
  for translated in
    select * from (values
      ('ar'::public.cottage_profile_source_language, 'حديقة هادئة', 'الهدوء في المساء'),
      ('ckb'::public.cottage_profile_source_language, 'باخچەیەکی ئارام', 'ئارامی لە ئێوارەدا')
    ) content(locale, description, house_rules)
  loop
    select * into attempt from public.begin_cottage_profile_translation_execution(
      current_setting('test.reconciliation_cycle_id')::uuid, translated.locale, 'ordinary', 50000
    );
    perform public.complete_cottage_profile_translation_execution(
      attempt.id, attempt.lease_token, translated.description, translated.house_rules,
      'test-provider', 'test-luna', 'none', 'v1'
    );
  end loop;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006412","role":"authenticated","aal":"aal2"}', true);
do $$
begin
  perform public.correct_cottage_profile_localization(
    current_setting('test.reconciliation_cycle_id')::uuid, 'en',
    'Approved garden description', 'Approved quiet hours', 'Clarify source wording'
  );
  perform public.decide_cottage_profile_localization(
    current_setting('test.reconciliation_cycle_id')::uuid, locale, true, 'Reviewed for publication'
  ) from unnest(array['en', 'ar', 'ckb']::public.cottage_profile_source_language[]) locale;
  perform public.approve_cottage_profile_publication(
    current_setting('test.reconciliation_cycle_id')::uuid, 'Publish corrected source wording'
  );
end;
$$;

select results_eq(
  $$select source_language::text, description, house_rules
    from public.owner_application_cottage_profiles
    where id = current_setting('test.reconciliation_profile_id')::uuid$$,
  $$values ('en'::text, 'Approved garden description'::text, 'Approved quiet hours'::text)$$,
  'approval reconciles approved source words into the saved copy');
select results_eq(
  $$select version, status::text, submitted_source_revision_id
    from public.owner_application_cottage_profiles
    where id = current_setting('test.reconciliation_profile_id')::uuid$$,
  $$values (4::bigint, 'draft'::text, null::uuid)$$,
  'approval advances the saved version once and clears the submission');
select results_eq(
  $$select has_unpublished_content_change, profile_version
    from public.list_cottage_profile_unpublished_content_changes(
      array[current_setting('test.reconciliation_profile_id')::uuid]
    )$$,
  $$values (false, 4::bigint)$$,
  'the administrator sees no unpublished Content Change after source reconciliation');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006411","role":"authenticated","aal":"aal1"}', true);
select results_eq(
  $$select has_unpublished_content_change, profile_version
    from public.list_cottage_profile_unpublished_content_changes(
      array[current_setting('test.reconciliation_profile_id')::uuid]
    )$$,
  $$values (false, 4::bigint)$$,
  'the owner sees no unpublished Content Change after source reconciliation');

reset role;
select results_eq(
  $$select localizations.locale::text, revisions.origin,
      localizations.description, localizations.house_rules
    from public.owner_application_cottage_profiles profiles
    join public.cottage_publication_snapshots publications
      on publications.id = profiles.current_publication_id
    join public.cottage_publication_localizations localizations
      on localizations.publication_id = publications.id
    join public.cottage_profile_localized_revisions revisions
      on revisions.id = localizations.localized_revision_id
    where profiles.id = current_setting('test.reconciliation_profile_id')::uuid
    order by localizations.locale::text$$,
  $$values
    ('ar'::text, 'generated'::text, 'حديقة هادئة'::text, 'الهدوء في المساء'::text),
    ('ckb', 'generated', 'باخچەیەکی ئارام', 'ئارامی لە ئێوارەدا'),
    ('en', 'administrator_correction', 'Approved garden description', 'Approved quiet hours')$$,
  'real approval publishes corrected source words and retains generated reportable locales');
select results_eq(
  $$select revision, source_language::text, description, house_rules
    from public.cottage_profile_source_revisions
    where profile_id = current_setting('test.reconciliation_profile_id')::uuid$$,
  $$values (1, 'en'::text, 'Submitted garden description'::text, 'Submitted quiet hours'::text)$$,
  'approval retains the original immutable submitted source words');
select results_eq(
  $$select revision, origin, description, house_rules, administrator_user_id, correction_reason
    from public.cottage_profile_localized_revisions
    where review_cycle_id = current_setting('test.reconciliation_cycle_id')::uuid
      and locale = 'en'
    order by revision$$,
  $$values
    (1, 'owner_source'::text, 'Submitted garden description'::text, 'Submitted quiet hours'::text,
      null::uuid, null::text),
    (2, 'administrator_correction', 'Approved garden description', 'Approved quiet hours',
      '00000000-0000-0000-0000-000000006412'::uuid, 'Clarify source wording')$$,
  'approval retains both source and administrator correction history');

create function pg_temp.save_reconciliation_words(
  requested_language public.cottage_profile_source_language,
  requested_description text, requested_rules text
) returns void language plpgsql as $$
declare profile public.owner_application_cottage_profiles;
begin
  select * into profile from public.owner_application_cottage_profiles
    where id = current_setting('test.reconciliation_profile_id')::uuid;
  perform public.update_owner_cottage_profile_draft(
    profile.id, profile.version, profile.name, profile.governorate,
    profile.approximate_location, profile.exact_address,
    profile.exact_latitude, profile.exact_longitude, profile.private_directions,
    profile.capacity, profile.bedrooms, profile.bathrooms, profile.amenities,
    requested_language, requested_description, requested_rules
  );
end;
$$;

create function pg_temp.read_reconciliation_report_target()
returns void language plpgsql as $$
declare publication public.cottage_publication_snapshots;
begin
  select snapshots.* into publication
    from public.cottage_publication_snapshots snapshots
    join public.owner_application_cottage_profiles profiles
      on profiles.current_publication_id = snapshots.id
    where profiles.id = current_setting('test.reconciliation_profile_id')::uuid;
  perform set_config('test.reconciliation_report_cycle_id', publication.review_cycle_id::text, true);
  perform set_config('test.reconciliation_report_revision_id', (
    select localized_revision_id::text from public.cottage_publication_localizations
    where publication_id = publication.id and locale = 'ar'
  ), true);
end;
$$;

create function pg_temp.open_reconciliation_remediation()
returns uuid language plpgsql as $$
declare report public.cottage_translation_quality_reports;
begin
  select * into report from public.report_current_cottage_translation(
    current_setting('test.reconciliation_report_cycle_id')::uuid,
    current_setting('test.reconciliation_report_revision_id')::uuid,
    'Review this generated Arabic wording'
  );
  return report.remediation_review_cycle_id;
end;
$$;

create function pg_temp.approve_reconciliation_source(
  target_cycle uuid, target_locale public.cottage_profile_source_language,
  target_description text, target_rules text
) returns void language plpgsql as $$
begin
  perform public.correct_cottage_profile_localization(
    target_cycle, target_locale, target_description, target_rules, 'Clarify reviewed source wording'
  );
  perform public.decide_cottage_profile_localization(
    target_cycle, locale, true, 'Reviewed for publication'
  ) from unnest(array['en', 'ar', 'ckb']::public.cottage_profile_source_language[]) locale;
  perform public.approve_cottage_profile_publication(target_cycle, 'Publish reviewed correction');
end;
$$;

create function pg_temp.original_reconciliation_history()
returns table(kind text, contents jsonb) language sql as $$
  select 'source', to_jsonb(source) from public.cottage_profile_source_revisions source
    where source.profile_id = current_setting('test.reconciliation_profile_id')::uuid
  union all
  select 'localization', to_jsonb(revision) from public.cottage_profile_localized_revisions revision
    where revision.review_cycle_id = current_setting('test.reconciliation_cycle_id')::uuid
  union all
  select 'locale decision', to_jsonb(decision) from public.cottage_profile_localized_decisions decision
    where decision.review_cycle_id = current_setting('test.reconciliation_cycle_id')::uuid
  union all
  select 'publication decision', to_jsonb(decision) from public.cottage_profile_publication_decisions decision
    where decision.review_cycle_id = current_setting('test.reconciliation_cycle_id')::uuid
  union all
  select 'cycle', to_jsonb(cycle) from public.cottage_profile_review_cycles cycle
    where cycle.id = current_setting('test.reconciliation_cycle_id')::uuid
  union all
  select 'publication', to_jsonb(publication) from public.cottage_publication_snapshots publication
    where publication.review_cycle_id = current_setting('test.reconciliation_cycle_id')::uuid
  union all
  select 'published localization', to_jsonb(localization)
    from public.cottage_publication_localizations localization
    join public.cottage_publication_snapshots publication on publication.id = localization.publication_id
    where publication.review_cycle_id = current_setting('test.reconciliation_cycle_id')::uuid
  union all
  select 'published media', to_jsonb(media) from public.cottage_publication_media media
    join public.cottage_publication_snapshots publication on publication.id = media.publication_id
    where publication.review_cycle_id = current_setting('test.reconciliation_cycle_id')::uuid;
$$;

create temporary table reconciliation_history as
select * from pg_temp.original_reconciliation_history();

select pg_temp.read_reconciliation_report_target();
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006411","role":"authenticated","aal":"aal1"}', true);
select set_config('test.reconciliation_remediation_id', pg_temp.open_reconciliation_remediation()::text, true);
select pg_temp.save_reconciliation_words('en', 'Later owner description', 'Approved quiet hours');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006412","role":"authenticated","aal":"aal2"}', true);
select pg_temp.approve_reconciliation_source(
  current_setting('test.reconciliation_remediation_id')::uuid, 'en',
  'Second approved description', 'Second approved rules'
);
select results_eq(
  $$select description, house_rules, version from public.owner_application_cottage_profiles
    where id = current_setting('test.reconciliation_profile_id')::uuid$$,
  $$values ('Later owner description'::text, 'Second approved rules'::text, 6::bigint)$$,
  'remediation preserves a later owner description and reconciles untouched House Rules');
reset role;
select results_eq(
  $$select localizations.description, localizations.house_rules
    from public.cottage_publication_localizations localizations
    join public.owner_application_cottage_profiles profiles
      on profiles.current_publication_id = localizations.publication_id
    where profiles.id = current_setting('test.reconciliation_profile_id')::uuid
      and localizations.locale = 'en'$$,
  $$values ('Second approved description'::text, 'Second approved rules'::text)$$,
  'remediation publishes the approved pair while preserving the later saved description');
set local role authenticated;
select results_eq(
  $$select has_unpublished_content_change, profile_version
    from public.list_cottage_profile_unpublished_content_changes(
      array[current_setting('test.reconciliation_profile_id')::uuid])$$,
  $$values (true, 6::bigint)$$,
  'the administrator sees the preserved description as an unpublished Content Change');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006411","role":"authenticated","aal":"aal1"}', true);
select results_eq(
  $$select has_unpublished_content_change, profile_version
    from public.list_cottage_profile_unpublished_content_changes(
      array[current_setting('test.reconciliation_profile_id')::uuid])$$,
  $$values (true, 6::bigint)$$,
  'the owner sees the same preserved description as an unpublished Content Change');

select pg_temp.save_reconciliation_words('en', 'Second approved description', 'Second approved rules');
reset role;
select pg_temp.read_reconciliation_report_target();
set local role authenticated;
select set_config('test.reconciliation_remediation_id', pg_temp.open_reconciliation_remediation()::text, true);
select pg_temp.save_reconciliation_words('en', 'Second approved description', 'Later owner House Rules');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006412","role":"authenticated","aal":"aal2"}', true);
select pg_temp.approve_reconciliation_source(
  current_setting('test.reconciliation_remediation_id')::uuid, 'en',
  'Third approved description', 'Third approved rules'
);
select results_eq(
  $$select description, house_rules, version from public.owner_application_cottage_profiles
    where id = current_setting('test.reconciliation_profile_id')::uuid$$,
  $$values ('Third approved description'::text, 'Later owner House Rules'::text, 9::bigint)$$,
  'remediation preserves a later owner House Rules edit and reconciles untouched description');
reset role;
select results_eq(
  $$select localizations.description, localizations.house_rules
    from public.cottage_publication_localizations localizations
    join public.owner_application_cottage_profiles profiles
      on profiles.current_publication_id = localizations.publication_id
    where profiles.id = current_setting('test.reconciliation_profile_id')::uuid
      and localizations.locale = 'en'$$,
  $$values ('Third approved description'::text, 'Third approved rules'::text)$$,
  'the remediation publishes the administrator-approved source pair');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006411","role":"authenticated","aal":"aal1"}', true);
select pg_temp.save_reconciliation_words('en', 'Third approved description', 'Third approved rules');
reset role;
select pg_temp.read_reconciliation_report_target();
set local role authenticated;
select set_config('test.reconciliation_remediation_id', pg_temp.open_reconciliation_remediation()::text, true);
select pg_temp.save_reconciliation_words('en', 'Third approved description', 'Third approved rules');
select pg_temp.save_reconciliation_words('en', 'Temporary owner description', 'Temporary owner rules');
select pg_temp.save_reconciliation_words('en', 'Third approved description', 'Third approved rules');
do $$
declare profile public.owner_application_cottage_profiles;
begin
  select * into profile from public.owner_application_cottage_profiles
    where id = current_setting('test.reconciliation_profile_id')::uuid;
  perform public.update_owner_cottage_profile_draft(
    profile.id, profile.version, profile.name, profile.governorate,
    profile.approximate_location, profile.exact_address, profile.exact_latitude,
    profile.exact_longitude, 'Later private approach', profile.capacity,
    profile.bedrooms, profile.bathrooms, profile.amenities, 'en',
    'Third approved description', 'Third approved rules'
  );
end;
$$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006412","role":"authenticated","aal":"aal2"}', true);
select pg_temp.approve_reconciliation_source(
  current_setting('test.reconciliation_remediation_id')::uuid, 'en',
  'Fourth approved description', 'Fourth approved rules'
);
select results_eq(
  $$select description, house_rules, private_directions, version
    from public.owner_application_cottage_profiles
    where id = current_setting('test.reconciliation_profile_id')::uuid$$,
  $$values ('Fourth approved description'::text, 'Fourth approved rules'::text,
    'Later private approach'::text, 15::bigint)$$,
  'no-op saves and restored baseline text remain eligible for reconciliation');
select results_eq(
  $$select has_unpublished_content_change, profile_version
    from public.list_cottage_profile_unpublished_content_changes(
      array[current_setting('test.reconciliation_profile_id')::uuid])$$,
  $$values (false, 15::bigint)$$,
  'an unrelated private save leaves no administrator-visible Content Change after reconciliation');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006411","role":"authenticated","aal":"aal1"}', true);
select results_eq(
  $$select has_unpublished_content_change, profile_version
    from public.list_cottage_profile_unpublished_content_changes(
      array[current_setting('test.reconciliation_profile_id')::uuid])$$,
  $$values (false, 15::bigint)$$,
  'the owner agrees that restored public words have no unpublished Content Change');

reset role;
select pg_temp.read_reconciliation_report_target();
set local role authenticated;
select set_config('test.reconciliation_remediation_id', pg_temp.open_reconciliation_remediation()::text, true);
select pg_temp.save_reconciliation_words('ar', 'Fourth approved description', 'Fourth approved rules');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006412","role":"authenticated","aal":"aal2"}', true);
select pg_temp.approve_reconciliation_source(
  current_setting('test.reconciliation_remediation_id')::uuid, 'en',
  'Fifth approved description', 'Fifth approved rules'
);
select results_eq(
  $$select source_language::text, description, house_rules, version
    from public.owner_application_cottage_profiles
    where id = current_setting('test.reconciliation_profile_id')::uuid$$,
  $$values ('ar'::text, 'Fourth approved description'::text, 'Fourth approved rules'::text, 17::bigint)$$,
  'source-language divergence preserves both saved fields');
select results_eq(
  $$select has_unpublished_content_change, profile_version
    from public.list_cottage_profile_unpublished_content_changes(
      array[current_setting('test.reconciliation_profile_id')::uuid])$$,
  $$values (true, 17::bigint)$$,
  'the administrator sees a changed saved source language as unpublished');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006411","role":"authenticated","aal":"aal1"}', true);
select results_eq(
  $$select has_unpublished_content_change, profile_version
    from public.list_cottage_profile_unpublished_content_changes(
      array[current_setting('test.reconciliation_profile_id')::uuid])$$,
  $$values (true, 17::bigint)$$,
  'the owner sees the same source-language divergence as unpublished');

select pg_temp.save_reconciliation_words('en', 'Fifth approved description', 'Fifth approved rules');
reset role;
select pg_temp.read_reconciliation_report_target();
set local role authenticated;
select set_config('test.reconciliation_remediation_id', pg_temp.open_reconciliation_remediation()::text, true);
select pg_temp.save_reconciliation_words('en', null, '');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006412","role":"authenticated","aal":"aal2"}', true);
select pg_temp.approve_reconciliation_source(
  current_setting('test.reconciliation_remediation_id')::uuid, 'en',
  'Sixth approved description', 'Sixth approved rules'
);
select results_eq(
  $$select description, house_rules, version from public.owner_application_cottage_profiles
    where id = current_setting('test.reconciliation_profile_id')::uuid$$,
  $$values (null::text, null::text, 20::bigint)$$,
  'remediation preserves intentionally cleared draft fields');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006411","role":"authenticated","aal":"aal1"}', true);
select pg_temp.save_reconciliation_words('en', 'Post-approval owner description', 'Post-approval owner rules');
select throws_ok(
  $$select public.update_owner_cottage_profile_draft(
    current_setting('test.reconciliation_profile_id')::uuid, 20,
    'Reconciliation Garden', 'Erbil', 'Near Shaqlawa', 'Private reconciliation address',
    36.4, 44.3, 'Later private approach', 8, 3, 2, array['garden'], 'en',
    'Stale owner description', 'Stale owner rules'
  )$$,
  'RC409', null, 'a stale save cannot replace a real post-approval owner edit');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006412","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.approve_cottage_profile_publication(
    current_setting('test.reconciliation_remediation_id')::uuid, 'Replay old approval'
  )$$,
  'RC204', null, 'replayed approval cannot replace a real post-approval owner edit');
reset role;
select results_eq(
  $$select profiles.description, profiles.house_rules, profiles.version,
      localizations.description, localizations.house_rules
    from public.owner_application_cottage_profiles profiles
    join public.cottage_publication_localizations localizations
      on localizations.publication_id = profiles.current_publication_id and localizations.locale = 'en'
    where profiles.id = current_setting('test.reconciliation_profile_id')::uuid$$,
  $$values ('Post-approval owner description'::text, 'Post-approval owner rules'::text, 21::bigint,
    'Sixth approved description'::text, 'Sixth approved rules'::text)$$,
  'refused stale saves and replays retain the later saved pair and approved publication');
select results_eq(
  $$select kind, contents from pg_temp.original_reconciliation_history() order by kind, contents::text$$,
  $$select kind, contents from reconciliation_history order by kind, contents::text$$,
  'approval preserves submitted and corrected history');

create function pg_temp.prepare_reconciliation_profile(
  requested_language public.cottage_profile_source_language,
  requested_description text, requested_rules text
) returns uuid language plpgsql as $$
declare profile public.owner_application_cottage_profiles;
begin
  select * into profile from public.create_owner_cottage_profile_draft();
  perform public.update_owner_cottage_profile_draft(
    profile.id, 1, 'Source language garden', 'Erbil', 'Near Shaqlawa',
    'Private source language address', 36.4, 44.3, 'Private source language directions',
    8, 3, 2, array['garden'], requested_language, requested_description, requested_rules
  );
  perform public.replace_cottage_shift_schedule(
    profile.id, 0,
    '[{"name":"Day","startTime":"08:00","endTime":"14:00"},{"name":"Evening","startTime":"18:00","endTime":"23:00"}]'
  );
  perform public.prepare_cottage_profile_photo_upload(profile.id, 'source.webp', 'image/webp', 128);
  return profile.id;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006411","role":"authenticated","aal":"aal1"}', true);
select set_config('test.reconciliation_ar_profile_id', pg_temp.prepare_reconciliation_profile(
  'ar', 'وصف عربي مقدم', 'قواعد عربية مقدمة'
)::text, true);
select set_config('test.reconciliation_ckb_profile_id', pg_temp.prepare_reconciliation_profile(
  'ckb', 'وەسفی پێشکەشکراو', 'یاسای پێشکەشکراو'
)::text, true);
select set_config('test.reconciliation_bad_profile_id', pg_temp.prepare_reconciliation_profile(
  'en', 'Malformed submitted description', 'Malformed submitted rules'
)::text, true);

reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select public.cottage_profile_photo_bucket_name(), photos.object_path,
  photos.owner_user_id::text, '{"size":128,"mimetype":"image/webp"}'::jsonb
from public.cottage_profile_photos photos
where photos.profile_id = any(array[
  current_setting('test.reconciliation_ar_profile_id')::uuid,
  current_setting('test.reconciliation_ckb_profile_id')::uuid,
  current_setting('test.reconciliation_bad_profile_id')::uuid
]);
set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006412","role":"service_role","aal":"aal2"}', true);
do $$
begin
  perform public.register_cottage_profile_photo(id) from public.cottage_profile_photos
    where profile_id = any(array[
      current_setting('test.reconciliation_ar_profile_id')::uuid,
      current_setting('test.reconciliation_ckb_profile_id')::uuid,
      current_setting('test.reconciliation_bad_profile_id')::uuid
    ]);
end;
$$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006411","role":"authenticated","aal":"aal1"}', true);
do $$
begin
  perform public.submit_cottage_profile_for_content_approval(profile_id, 2)
    from unnest(array[
      current_setting('test.reconciliation_ar_profile_id')::uuid,
      current_setting('test.reconciliation_ckb_profile_id')::uuid,
      current_setting('test.reconciliation_bad_profile_id')::uuid
    ]) profile_id;
end;
$$;
set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006412","role":"service_role","aal":"aal2"}', true);
do $$
declare translated record;
declare attempt public.cottage_profile_translation_attempts;
begin
  for translated in
    select cycles.id as cycle_id, content.*
    from public.cottage_profile_review_cycles cycles
    join public.cottage_profile_source_revisions source on source.id = cycles.source_revision_id
    cross join (values
      ('en'::public.cottage_profile_source_language, 'Generated garden description', 'Generated quiet hours'),
      ('ar'::public.cottage_profile_source_language, 'حديقة هادئة', 'الهدوء في المساء'),
      ('ckb'::public.cottage_profile_source_language, 'باخچەیەکی ئارام', 'ئارامی لە ئێوارەدا')
    ) content(locale, description, house_rules)
    where cycles.profile_id = any(array[
      current_setting('test.reconciliation_ar_profile_id')::uuid,
      current_setting('test.reconciliation_ckb_profile_id')::uuid,
      current_setting('test.reconciliation_bad_profile_id')::uuid
    ]) and content.locale <> source.source_language
  loop
    select * into attempt from public.begin_cottage_profile_translation_execution(
      translated.cycle_id, translated.locale, 'ordinary', 50000
    );
    perform public.complete_cottage_profile_translation_execution(
      attempt.id, attempt.lease_token, translated.description, translated.house_rules,
      'test-provider', 'test-luna', 'none', 'v1'
    );
  end loop;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006412","role":"authenticated","aal":"aal2"}', true);
select pg_temp.approve_reconciliation_source(
  (select id from public.cottage_profile_review_cycles
    where profile_id = current_setting('test.reconciliation_ar_profile_id')::uuid),
  'ar', 'وصف عربي معتمد', 'قواعد عربية معتمدة'
);
select pg_temp.approve_reconciliation_source(
  (select id from public.cottage_profile_review_cycles
    where profile_id = current_setting('test.reconciliation_ckb_profile_id')::uuid),
  'ckb', 'وەسفی پەسەندکراو', 'یاسای پەسەندکراو'
);
reset role;
select results_eq(
  $$select profiles.source_language::text, profiles.description, profiles.house_rules, profiles.version,
      localizations.description, localizations.house_rules
    from public.owner_application_cottage_profiles profiles
    join public.cottage_publication_localizations localizations
      on localizations.publication_id = profiles.current_publication_id
      and localizations.locale = profiles.source_language
    where profiles.id = any(array[
      current_setting('test.reconciliation_ar_profile_id')::uuid,
      current_setting('test.reconciliation_ckb_profile_id')::uuid
    ]) order by profiles.source_language::text$$,
  $$values
    ('ar'::text, 'وصف عربي معتمد'::text, 'قواعد عربية معتمدة'::text, 4::bigint,
      'وصف عربي معتمد'::text, 'قواعد عربية معتمدة'::text),
    ('ckb', 'وەسفی پەسەندکراو', 'یاسای پەسەندکراو', 4,
      'وەسفی پەسەندکراو', 'یاسای پەسەندکراو')$$,
  'Arabic and Sorani source approvals reconcile their approved source words');
set local role authenticated;
select results_eq(
  $$select has_unpublished_content_change, profile_version
    from public.list_cottage_profile_unpublished_content_changes(array[
      current_setting('test.reconciliation_ar_profile_id')::uuid,
      current_setting('test.reconciliation_ckb_profile_id')::uuid
    ]) order by profile_id$$,
  $$values (false, 4::bigint), (false, 4::bigint)$$,
  'the administrator sees both non-English source profiles as reconciled');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006411","role":"authenticated","aal":"aal1"}', true);
select results_eq(
  $$select has_unpublished_content_change, profile_version
    from public.list_cottage_profile_unpublished_content_changes(array[
      current_setting('test.reconciliation_ar_profile_id')::uuid,
      current_setting('test.reconciliation_ckb_profile_id')::uuid
    ]) order by profile_id$$,
  $$values (false, 4::bigint), (false, 4::bigint)$$,
  'the owner sees both non-English source profiles as reconciled');

-- An incomplete persisted publication is the negative fixture, never positive construction evidence.
reset role;
do $$
declare cycle public.cottage_profile_review_cycles;
declare publication public.cottage_publication_snapshots;
begin
  select * into cycle from public.cottage_profile_review_cycles
    where profile_id = current_setting('test.reconciliation_bad_profile_id')::uuid;
  insert into public.cottage_publication_snapshots (
    profile_id, review_cycle_id, publication_number, name, governorate,
    approximate_location, capacity, bedrooms, bathrooms, amenities
  ) values (
    cycle.profile_id, cycle.id, 1, cycle.name, cycle.governorate,
    cycle.approximate_location, cycle.capacity, cycle.bedrooms, cycle.bathrooms, cycle.amenities
  ) returning * into publication;
  perform set_config('test.reconciliation_bad_publication_id', publication.id::text, true);
  perform set_config('test.reconciliation_bad_cycle_id', cycle.id::text, true);
  insert into public.cottage_publication_localizations (
    publication_id, locale, localized_revision_id, description, house_rules
  ) select publication.id, heads.locale, revisions.id, revisions.description, revisions.house_rules
    from public.cottage_profile_localized_heads heads
    join public.cottage_profile_localized_revisions revisions on revisions.id = heads.localized_revision_id
    where heads.review_cycle_id = cycle.id and heads.locale <> 'en';
  perform set_config('test.reconciliation_bad_report_revision_id', (
    select localized_revision_id::text from public.cottage_publication_localizations
    where publication_id = publication.id and locale = 'ar'
  ), true);
  insert into public.cottage_publication_media (publication_id, photo_id, object_path, media_type, position)
    select publication.id, photos.id, photos.object_path, photos.media_type, review_photos.position
    from public.cottage_profile_review_photos review_photos
    join public.cottage_profile_photos photos on photos.id = review_photos.photo_id
    where review_photos.review_cycle_id = cycle.id;
  update public.cottage_profile_review_cycles set state = 'approved', decided_at = now() where id = cycle.id;
  update public.owner_application_cottage_profiles
    set current_publication_id = publication.id, status = 'draft',
      submitted_source_revision_id = null, version = version + 1
    where id = cycle.profile_id;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006411","role":"authenticated","aal":"aal1"}', true);
do $$
declare report public.cottage_translation_quality_reports;
begin
  select * into report from public.report_current_cottage_translation(
    current_setting('test.reconciliation_bad_cycle_id')::uuid,
    current_setting('test.reconciliation_bad_report_revision_id')::uuid,
    'Report the incomplete publication through the real remediation transition'
  );
  perform set_config('test.reconciliation_bad_remediation_id', report.remediation_review_cycle_id::text, true);
end;
$$;
reset role;
do $$
declare revision public.cottage_profile_localized_revisions;
begin
  insert into public.cottage_profile_localized_revisions (
    review_cycle_id, locale, revision, origin, description, house_rules
  ) values (
    current_setting('test.reconciliation_bad_remediation_id')::uuid, 'en', 1, 'owner_source',
    'Malformed submitted description', 'Malformed submitted rules'
  ) returning * into revision;
  insert into public.cottage_profile_localized_heads (review_cycle_id, locale, localized_revision_id)
    values (revision.review_cycle_id, revision.locale, revision.id);
end;
$$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000006412","role":"authenticated","aal":"aal2"}', true);
do $$
begin
  perform public.correct_cottage_profile_localization(
    current_setting('test.reconciliation_bad_remediation_id')::uuid, 'en',
    'Malformed approved description', 'Malformed approved rules', 'Complete the current review source head'
  );
  perform public.decide_cottage_profile_localization(
    current_setting('test.reconciliation_bad_remediation_id')::uuid, locale, true, 'Current head approved'
  ) from unnest(array['en', 'ar', 'ckb']::public.cottage_profile_source_language[]) locale;
end;
$$;
select results_eq(
  $$select
    (select count(*) from public.cottage_profile_localized_heads
      where review_cycle_id = current_setting('test.reconciliation_bad_remediation_id')::uuid),
    (select count(*) from public.cottage_profile_localized_revisions
      where review_cycle_id = current_setting('test.reconciliation_bad_remediation_id')::uuid
        and origin = 'generated'),
    (select count(*) from public.cottage_profile_localized_decisions
      where review_cycle_id = current_setting('test.reconciliation_bad_remediation_id')::uuid and approved),
    (select count(*) from public.cottage_profile_review_photos
      where review_cycle_id = current_setting('test.reconciliation_bad_remediation_id')::uuid)$$,
  $$values (3::bigint, 2::bigint, 3::bigint, 1::bigint)$$,
  'the malformed-baseline review satisfies existing head, provenance, decision and photo gates');
select throws_ok(
  $$select public.approve_cottage_profile_publication(
    current_setting('test.reconciliation_bad_remediation_id')::uuid, 'Reject missing baseline evidence'
  )$$,
  'RC203', 'Remediation source baseline is unavailable',
  'missing remediation source baseline rolls approval back');
reset role;
select results_eq(
  $$select profiles.version, profiles.status::text,
      profiles.current_publication_id = current_setting('test.reconciliation_bad_publication_id')::uuid,
      cycles.state,
      (select count(*) from public.cottage_publication_snapshots snapshots
        where snapshots.profile_id = profiles.id),
      (select count(*) from public.cottage_profile_publication_decisions decisions
        where decisions.review_cycle_id = cycles.id)
    from public.owner_application_cottage_profiles profiles
    join public.cottage_profile_review_cycles cycles on cycles.profile_id = profiles.id
    where cycles.id = current_setting('test.reconciliation_bad_remediation_id')::uuid$$,
  $$values (4::bigint, 'draft'::text, true, 'in_review'::text, 1::bigint, 0::bigint)$$,
  'missing baseline evidence leaves the saved profile, publication and review decision unchanged');

select * from finish();
rollback;
