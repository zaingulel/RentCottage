begin;

create extension if not exists pgtap with schema extensions;
select plan(56);

select results_eq(
  $$select signature, position(
      'disabled by runtime control'
      in pg_get_functiondef(signature::regprocedure)
    ) > 0 as upgraded
    from (values
      ('public.begin_cottage_profile_translation(uuid,public.cottage_profile_source_language)'),
      ('public.complete_cottage_profile_translation(uuid,text,text,text,text,text,text)'),
      ('public.approve_cottage_profile_publication(uuid,text)')
    ) functions(signature)
    order by signature$$,
  $$values
      ('public.approve_cottage_profile_publication(uuid,text)'::text, true),
      ('public.begin_cottage_profile_translation(uuid,public.cottage_profile_source_language)', true),
      ('public.complete_cottage_profile_translation(uuid,text,text,text,text,text,text)', true)$$,
  'the issue 46 migration upgrades every inherited runtime-control message'
);

insert into auth.users (id, aud, role, phone, phone_confirmed_at, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000004601', 'authenticated', 'authenticated', '+9647500004601', now(), null, null),
  ('00000000-0000-0000-0000-000000004602', 'authenticated', 'authenticated', '+9647500004602', now(), null, null),
  ('00000000-0000-0000-0000-000000004603', 'authenticated', 'authenticated', null, null, 'translation-admin@example.test', now());

insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000004601', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000004602', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000004603', 'platform_administrator', null);

insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, amenities, source_language, description,
  house_rules
) values (
  '30000000-0000-4000-8000-000000004601',
  '00000000-0000-0000-0000-000000004601',
  'Translation Cottage', 'Erbil', 'Near Shaqlawa', 'Private address',
  8, 3, 2, array['garden'], 'en', 'Quiet cottage', 'No smoking'
);

insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules, revision
) values (
  '40000000-0000-4000-8000-000000004601',
  '30000000-0000-4000-8000-000000004601',
  '00000000-0000-0000-0000-000000004601',
  'en', 'Quiet cottage', 'No smoking', 1
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000004601","role":"authenticated","aal":"aal1"}', true);
select lives_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000004601', 0,
    '[
      {"name":"Day","startTime":"08:00","endTime":"16:00"},
      {"name":"Night","startTime":"16:00","endTime":"00:00"}
    ]'::jsonb
  )$$,
  'the published remediation fixture uses a current valid Shift Schedule'
);
reset role;

update public.owner_application_cottage_profiles
set status = 'submitted_for_content_approval',
  submitted_source_revision_id = '40000000-0000-4000-8000-000000004601'
where id = '30000000-0000-4000-8000-000000004601';

select throws_ok(
  $$update public.cottage_translation_runtime_control set production_ready = true$$,
  '23514', null,
  'production cannot be enabled without every approved launch-gate input'
);

update public.cottage_translation_runtime_control
set approved_evaluation_artifact_digest = repeat('a', 64),
  production_approval_digest = repeat('b', 64),
  provider_terms_approval_reference = 'terms-approval-46',
  native_review_approval_reference = 'native-review-46',
  quality_threshold_approval_reference = 'quality-threshold-46',
  ordinary_model = 'gpt-5.6-luna', ordinary_effort = 'none', ordinary_prompt_version = 'v1',
  stronger_model = 'gpt-5.6-terra', stronger_effort = 'none', stronger_prompt_version = 'v1',
  judge_model = 'gpt-5.6-sol', judge_effort = 'medium', judge_prompt_version = 'judge-v1',
  monthly_request_limit = 2, monthly_token_limit = 1000,
  monthly_spend_microusd_limit = 20000,
  production_ready = true;

select ok(
  (select production_ready from public.cottage_translation_runtime_control),
  'complete approved evidence can enable production translation explicitly'
);

set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000004603","role":"service_role","aal":"aal2"}', true);

select is(
  (public.reserve_cottage_translation_usage(
    repeat('c', 64), 'gpt-5.6-luna', 'none', 'v1', 100, 10000,
    repeat('b', 64), 2, 1000, 20000
  ) ->> 'granted')::boolean,
  true,
  'one physical provider call receives one durable reservation'
);

select is(
  (public.reserve_cottage_translation_usage(
    repeat('d', 64), 'gpt-5.6-luna', 'none', 'v1', 100, 10000,
    repeat('b', 64), 1, 1000, 20000
  ) ->> 'granted')::boolean,
  false,
  'the stricter application request ceiling fails loudly'
);

select throws_ok(
  $$select public.reserve_cottage_translation_usage(
    repeat('d', 64), 'gpt-5.6-luna', 'none', 'v1', 100, 10000,
    repeat('e', 64), 2, 1000, 20000
  )$$,
  'RC246', null,
  'usage reservation is bound to the approved production configuration digest'
);

select lives_ok(
  $$select public.record_cottage_translation_usage(
    (select id from public.cottage_translation_usage_reservations), 60, 20, 80, 5000
  )$$,
  'actual usage is appended against its immutable physical-call reservation'
);

select throws_ok(
  $$update public.cottage_translation_usage_reservations set reserved_tokens = 999$$,
  '42501', null,
  'service_role cannot update physical-call reservations'
);

select throws_ok(
  $$update public.cottage_translation_usage_results set total_tokens = 1$$,
  '42501', null,
  'service_role cannot update reported physical-call usage'
);

select lives_ok(
  $$insert into public.cottage_translation_cache (cache_key, result)
    values (repeat('f', 64), '{"segments":[]}'::jsonb)$$,
  'the service can save a private immutable cache result'
);

select throws_ok(
  $$update public.cottage_translation_cache set result = '{}'::jsonb$$,
  '42501', null,
  'service_role cannot rewrite cached translation results'
);

select lives_ok(
  $$select public.begin_cottage_profile_translation_execution(
    (select id from public.cottage_profile_review_cycles), 'ar', 'ordinary', 50000
  )$$,
  'the approved service claims one current translation target'
);

select is(
  (select count(*) from public.cottage_profile_translation_attempts where state = 'pending'),
  1::bigint,
  'the target has one active execution lease'
);

select is(
  (select lease_expires_at - created_at
   from public.cottage_profile_translation_attempts where state = 'pending'),
  interval '50 seconds',
  'the execution lease covers the complete bounded retry budget'
);

select throws_ok(
  $$select public.begin_cottage_profile_translation_execution(
    (select id from public.cottage_profile_review_cycles), 'ar', 'ordinary', 50000
  )$$,
  'RC409', null,
  'a concurrent claimant cannot receive the active execution lease token'
);

select is(
  (select count(*) from public.cottage_profile_translation_attempts),
  1::bigint,
  'idempotent claim recovery does not duplicate physical target work'
);

select throws_ok(
  $$select public.begin_cottage_profile_translation_execution(
    (select id from public.cottage_profile_review_cycles), 'ar', 'stronger_model', 50000
  )$$,
  'RC409', null,
  'route escalation cannot steal a live ordinary execution lease'
);

select is(
  public.complete_cottage_profile_translation_execution(
    (select id from public.cottage_profile_translation_attempts where state = 'pending'),
    '50000000-0000-4000-8000-000000004699',
    'غير صالح', 'غير صالح', 'openai', 'gpt-5.6-luna', 'none', 'v1'
  ),
  false,
  'a caller without the exclusive lease token cannot complete provider work'
);

select throws_ok(
  $$select public.fail_cottage_profile_translation_execution(
    (select id from public.cottage_profile_translation_attempts where state = 'pending'),
    (select lease_token from public.cottage_profile_translation_attempts where state = 'pending'),
    'arbitrary_internal_state'
  )$$,
  '22023', null,
  'persistence accepts only the shared translation failure-code allow-list'
);

select is(
  public.fail_cottage_profile_translation_execution(
    (select id from public.cottage_profile_translation_attempts where state = 'pending'),
    '50000000-0000-4000-8000-000000004698',
    'provider_timeout'
  ),
  false,
  'a caller without the lease token cannot claim that failure was persisted'
);

select results_eq(
  $$select public.complete_cottage_profile_translation_execution(
    (select id from public.cottage_profile_translation_attempts where state = 'pending'),
    (select lease_token from public.cottage_profile_translation_attempts where state = 'pending'),
    'كوخ هادئ', 'ممنوع التدخين', 'openai', 'gpt-5.6-luna', 'none', 'v1'
  )$$,
  array[true],
  'only the current ordinary lease owner appends a generated localization'
);

select lives_ok(
  $$select public.begin_cottage_profile_translation_execution(
    (select id from public.cottage_profile_review_cycles), 'ar', 'stronger_model', 50000
  )$$,
  'stronger reprocessing can claim the target after ordinary work completes'
);

select results_eq(
  $$select public.complete_cottage_profile_translation_execution(
    (select id from public.cottage_profile_translation_attempts where state = 'pending'),
    (select lease_token from public.cottage_profile_translation_attempts where state = 'pending'),
    'كوخ أدق', 'ممنوع التدخين', 'openai', 'gpt-5.6-terra', 'none', 'v1'
  )$$,
  array[true],
  'the stronger lease owner appends the replacement generated localization'
);

select lives_ok(
  $$select public.begin_cottage_profile_translation_execution(
    (select id from public.cottage_profile_review_cycles), 'ckb', 'ordinary', 50000
  )$$,
  'the second non-source locale receives its own bounded execution lease'
);

select results_eq(
  $$select public.complete_cottage_profile_translation_execution(
    (select id from public.cottage_profile_translation_attempts where state = 'pending'),
    (select lease_token from public.cottage_profile_translation_attempts where state = 'pending'),
    'کۆتێجی ئارام', 'جگەرەکێشان قەدەغەیە', 'openai', 'gpt-5.6-luna', 'none', 'v1'
  )$$,
  array[true],
  'the second locale is ready for a complete published-remediation fixture'
);

reset role;

select lives_ok(
  $$
    update public.cottage_profile_review_cycles
    set state = 'approved', decided_at = now();
    insert into public.cottage_profile_photos (
      id, profile_id, owner_user_id, actor_user_id, object_path,
      original_filename, media_type, size_bytes, state
    ) values (
      '60000000-0000-4000-8000-000000004601',
      '30000000-0000-4000-8000-000000004601',
      '00000000-0000-0000-0000-000000004601',
      '00000000-0000-0000-0000-000000004601',
      'published/remediation.png', 'remediation.png', 'image/png', 100, 'ready'
    );
    insert into public.cottage_publication_snapshots (
      id, profile_id, review_cycle_id, publication_number, name, governorate,
      approximate_location, capacity, bedrooms, bathrooms, amenities
    ) select
      '70000000-0000-4000-8000-000000004601', profile_id, id, 1, name,
      governorate, approximate_location, capacity, bedrooms, bathrooms, amenities
    from public.cottage_profile_review_cycles;
    insert into public.cottage_publication_localizations (
      publication_id, locale, localized_revision_id, description, house_rules
    ) select
      '70000000-0000-4000-8000-000000004601', revisions.locale, revisions.id,
      revisions.description, revisions.house_rules
    from public.cottage_profile_localized_heads heads
    join public.cottage_profile_localized_revisions revisions
      on revisions.id = heads.localized_revision_id;
    insert into public.cottage_publication_media (
      publication_id, photo_id, object_path, media_type, position
    ) values (
      '70000000-0000-4000-8000-000000004601',
      '60000000-0000-4000-8000-000000004601',
      'published/remediation.png', 'image/png', 1
    );
    update public.owner_application_cottage_profiles
    set current_publication_id = '70000000-0000-4000-8000-000000004601';
  $$,
  'an immutable published Cottage fixture is ready for owner remediation'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000004601","role":"authenticated","aal":"aal1"}', true);

select lives_ok(
  $$select public.report_current_cottage_translation(
    (select id from public.cottage_profile_review_cycles),
    (select localized_revision_id from public.cottage_profile_localized_heads where locale = 'ar'),
    'The Arabic meaning is poor'
  )$$,
  'the Cottage Owner can report their currently visible generated localization'
);

select is(
  (select count(*) from public.cottage_translation_quality_reports),
  1::bigint,
  'the report is tied to one immutable localized revision'
);

select is(
  (select count(*) from public.cottage_profile_review_cycles where state = 'in_review'),
  1::bigint,
  'the published report atomically opens one remediation review cycle'
);

select is(
  (select source_revision_id from public.cottage_profile_review_cycles where state = 'in_review'),
  '40000000-0000-4000-8000-000000004601'::uuid,
  'the remediation cycle reuses the immutable published source revision'
);

select is(
  (select current_publication_id from public.owner_application_cottage_profiles),
  '70000000-0000-4000-8000-000000004601'::uuid,
  'opening remediation leaves the current publication intact'
);

select is(
  (select remediation_review_cycle_id from public.cottage_translation_quality_reports),
  (select id from public.cottage_profile_review_cycles where state = 'in_review'),
  'the immutable report links to its active remediation cycle'
);

select throws_ok(
  $$select public.report_current_cottage_translation(
    (select id from public.cottage_profile_review_cycles where state = 'approved'),
    (select heads.localized_revision_id
     from public.cottage_profile_localized_heads heads
     join public.cottage_profile_review_cycles cycles on cycles.id = heads.review_cycle_id
     where cycles.state = 'approved' and heads.locale = 'en'),
    'Source report'
  )$$,
  'RC204', null,
  'the owner cannot misclassify source text as generated translation'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000004602","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.report_current_cottage_translation(
    (select id from public.cottage_profile_review_cycles where state = 'approved'),
    (select heads.localized_revision_id
     from public.cottage_profile_localized_heads heads
     join public.cottage_profile_review_cycles cycles on cycles.id = heads.review_cycle_id
     where cycles.state = 'approved' and heads.locale = 'ar'),
    'Foreign report'
  )$$,
  '42501', null,
  'another Cottage Owner cannot report a foreign localization'
);

select throws_ok(
  $$select public.route_current_cottage_translation_to_human_review(
    (select id from public.cottage_profile_review_cycles where state = 'in_review'), 'ar', 'Needs review'
  )$$,
  '42501', null,
  'a non-administrator cannot route translation to human review'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000004603","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.route_current_cottage_translation_to_human_review(
    (select id from public.cottage_profile_review_cycles where state = 'in_review'), 'ar', 'Needs review'
  )$$,
  '42501', null,
  'an AAL1 administrator cannot route translation to human review'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000004603","role":"authenticated","aal":"aal2"}', true);
select lives_ok(
  $$
    select public.decide_cottage_profile_localization(
      (select id from public.cottage_profile_review_cycles where state = 'in_review'),
      locale, true, 'Approved before owner-report remediation route'
    )
    from unnest(array['en', 'ar', 'ckb']::public.cottage_profile_source_language[]) locale;
  $$,
  'all cloned remediation heads can hold prior administrator approval'
);

select lives_ok(
  $$select public.route_current_cottage_translation_to_human_review(
    (select id from public.cottage_profile_review_cycles where state = 'in_review'), 'ar', 'Native review required'
  )$$,
  'an AAL2 Platform Administrator atomically routes the current generated head'
);

select lives_ok(
  $$select public.route_current_cottage_translation_to_human_review(
    (select id from public.cottage_profile_review_cycles where state = 'in_review'), 'ar', 'Repeated request'
  )$$,
  'routing the same current generated head is idempotent'
);

select is(
  (select count(*) from public.cottage_profile_translation_human_reviews),
  1::bigint,
  'idempotent routing preserves one active human-review record'
);

select throws_ok(
  $$select public.route_current_cottage_translation_to_human_review(
    (select id from public.cottage_profile_review_cycles where state = 'in_review'), 'en', 'Invalid source route'
  )$$,
  '22023', null,
  'the immutable owner source cannot be routed as a translation'
);

select throws_ok(
  $$select public.decide_cottage_profile_localization(
    (select id from public.cottage_profile_review_cycles where state = 'in_review'), 'ar', true,
    'Bypass active review'
  )$$,
  'RC409', null,
  'an active human-review route blocks localization approval atomically'
);

select throws_ok(
  $$select public.approve_cottage_profile_publication(
    (select id from public.cottage_profile_review_cycles where state = 'in_review'),
    'Prior approvals cannot bypass the active human-review route'
  )$$,
  'RC409', null,
  'prior localization approval then human routing still blocks publication atomically'
);

select lives_ok(
  $$select public.get_cottage_translation_administration()$$,
  'the AAL2 Platform Administrator can inspect gate, usage, and report visibility'
);

select is(
  (public.get_cottage_translation_administration() ->> 'monthActualMicrousd')::bigint,
  5000::bigint,
  'administrator usage distinguishes actual provider spend from reservations'
);

select lives_ok(
  $$select public.reject_cottage_profile_publication(
    (select id from public.cottage_profile_review_cycles where state = 'in_review'),
    'Publication rejected after native review route'
  )$$,
  'publication rejection atomically closes active translation work'
);

select results_eq(
  $$select state from public.cottage_profile_translation_human_reviews$$,
  $$values ('superseded'::text)$$,
  'publication rejection leaves no orphaned active human-review route'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000004601","role":"authenticated","aal":"aal1"}', true);
select results_eq(
  $$select (replayed).id, (replayed).remediation_review_cycle_id, (replayed).reason
    from (
      select public.report_current_cottage_translation(
        (select review_cycle_id from public.cottage_translation_quality_reports),
        (select localized_revision_id from public.cottage_translation_quality_reports),
        'A replay must not replace the immutable report reason'
      ) as replayed
    ) replay$$,
  $$select id, remediation_review_cycle_id, reason
    from public.cottage_translation_quality_reports$$,
  'replaying an immutable report returns its original remediation link and reason'
);

select is(
  (select count(*) from public.cottage_profile_review_cycles where state = 'in_review'),
  0::bigint,
  'replaying after remediation rejection does not create an orphan active cycle'
);

select throws_ok(
  $$select public.get_cottage_translation_administration()$$,
  '42501', null,
  'a Cottage Owner cannot read platform translation usage and launch-gate evidence'
);

reset role;
select results_eq(
  $$select role_name, function_name, allowed from (
    values
      ('anon', 'begin_execution', has_function_privilege('anon', 'public.begin_cottage_profile_translation_execution(uuid,public.cottage_profile_source_language,text,integer)', 'execute')),
      ('anon', 'complete_execution', has_function_privilege('anon', 'public.complete_cottage_profile_translation_execution(uuid,uuid,text,text,text,text,text,text)', 'execute')),
      ('authenticated', 'begin_execution', has_function_privilege('authenticated', 'public.begin_cottage_profile_translation_execution(uuid,public.cottage_profile_source_language,text,integer)', 'execute')),
      ('authenticated', 'complete_execution', has_function_privilege('authenticated', 'public.complete_cottage_profile_translation_execution(uuid,uuid,text,text,text,text,text,text)', 'execute')),
      ('service_role', 'begin_execution', has_function_privilege('service_role', 'public.begin_cottage_profile_translation_execution(uuid,public.cottage_profile_source_language,text,integer)', 'execute')),
      ('service_role', 'complete_execution', has_function_privilege('service_role', 'public.complete_cottage_profile_translation_execution(uuid,uuid,text,text,text,text,text,text)', 'execute'))
  ) grants(role_name, function_name, allowed) order by role_name, function_name$$,
  $$values
    ('anon'::text, 'begin_execution'::text, false),
    ('anon', 'complete_execution', false),
    ('authenticated', 'begin_execution', false),
    ('authenticated', 'complete_execution', false),
    ('service_role', 'begin_execution', true),
    ('service_role', 'complete_execution', true)$$,
  'lease-guarded provider execution belongs only to service_role'
);

select results_eq(
  $$select role_name, column_name, allowed from (
    values
      ('authenticated', 'locale', has_column_privilege('authenticated', 'public.cottage_profile_translation_human_reviews', 'locale', 'select')),
      ('authenticated', 'reason', has_column_privilege('authenticated', 'public.cottage_profile_translation_human_reviews', 'reason', 'select')),
      ('service_role', 'locale', has_column_privilege('service_role', 'public.cottage_profile_translation_human_reviews', 'locale', 'select')),
      ('service_role', 'reason', has_column_privilege('service_role', 'public.cottage_profile_translation_human_reviews', 'reason', 'select'))
  ) privileges(role_name, column_name, allowed) order by role_name, column_name$$,
  $$values
    ('authenticated'::text, 'locale'::text, true),
    ('authenticated', 'reason', false),
    ('service_role', 'locale', true),
    ('service_role', 'reason', true)$$,
  'the owner-safe human-review surface omits administrator rationale'
);

create temp table visibility_expectations (
  actor text not null,
  database_role name not null,
  subject uuid,
  assurance text,
  relation_name name not null,
  visible_column name not null,
  expected_visible bigint not null
);

insert into visibility_expectations
  (actor, database_role, subject, assurance, relation_name, visible_column, expected_visible)
select actors.actor, actors.database_role, actors.subject, actors.assurance,
  relations.relation_name, relations.visible_column,
  case
    when actors.actor = 'service role' then 1
    when relations.relation_name in (
      'cottage_profile_translation_human_reviews',
      'cottage_translation_quality_reports'
    ) and actors.actor in ('owning owner', 'AAL2 administrator') then 1
    when relations.relation_name in (
      'cottage_profile_translation_human_reviews',
      'cottage_translation_quality_reports'
    ) and actors.actor in ('foreign owner', 'AAL1 administrator') then 0
    else -1
  end
from (values
  ('anonymous'::text, 'anon'::name, null::uuid, null::text),
  ('owning owner', 'authenticated', '00000000-0000-0000-0000-000000004601'::uuid, 'aal1'),
  ('foreign owner', 'authenticated', '00000000-0000-0000-0000-000000004602'::uuid, 'aal1'),
  ('AAL1 administrator', 'authenticated', '00000000-0000-0000-0000-000000004603'::uuid, 'aal1'),
  ('AAL2 administrator', 'authenticated', '00000000-0000-0000-0000-000000004603'::uuid, 'aal2'),
  ('service role', 'service_role', '00000000-0000-0000-0000-000000004603'::uuid, 'aal2')
) actors(actor, database_role, subject, assurance)
cross join (values
  ('cottage_profile_translation_human_reviews'::name, 'id'::name),
  ('cottage_translation_quality_reports', 'id'),
  ('cottage_translation_cache', 'cache_key'),
  ('cottage_translation_usage_reservations', 'id'),
  ('cottage_translation_usage_results', 'reservation_id')
) relations(relation_name, visible_column);

create temp table visibility_observations (
  actor text not null,
  relation_name name not null,
  visible bigint not null
);

do $$
declare test_case record;
declare observed bigint;
begin
  for test_case in select * from visibility_expectations loop
    perform set_config(
      'request.jwt.claims',
      jsonb_strip_nulls(jsonb_build_object(
        'sub', test_case.subject,
        'role', test_case.database_role,
        'aal', test_case.assurance
      ))::text,
      true
    );
    execute format('set local role %I', test_case.database_role);
    begin
      execute format(
        'select count(%I)::bigint from public.%I',
        test_case.visible_column,
        test_case.relation_name
      ) into observed;
    exception when insufficient_privilege then
      observed := -1;
    end;
    reset role;
    insert into visibility_observations values (
      test_case.actor, test_case.relation_name, observed
    );
  end loop;
end;
$$;

select results_eq(
  $$select actor, relation_name::text, visible
    from visibility_observations order by actor, relation_name$$,
  $$select actor, relation_name::text, expected_visible
    from visibility_expectations order by actor, relation_name$$,
  'direct RLS data visibility matches every actor across reviews, reports, cache, and usage'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$select count(*) from public.cottage_translation_cache$$,
  '42501', null,
  'anonymous users cannot read the private translation cache'
);
select throws_ok(
  $$select public.report_current_cottage_translation(
    (select id from public.cottage_profile_review_cycles),
    (select id from public.cottage_profile_localized_revisions where locale = 'ar'),
    'Anonymous report'
  )$$,
  '42501', null,
  'anonymous users cannot report Cottage translations'
);

select * from finish();
rollback;
