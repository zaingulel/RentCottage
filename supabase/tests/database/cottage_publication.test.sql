begin;

create extension if not exists pgtap with schema extensions;
select plan(93);

insert into auth.users (id, aud, role, phone, phone_confirmed_at, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000002401', 'authenticated', 'authenticated', '+9647500002401', now(), null, null),
  ('00000000-0000-0000-0000-000000002402', 'authenticated', 'authenticated', null, null, 'publication-admin@example.test', now()),
  ('00000000-0000-0000-0000-000000002403', 'authenticated', 'authenticated', '+9647500002403', now(), null, null);

insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000002401', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000002402', 'platform_administrator', null),
  ('00000000-0000-0000-0000-000000002403', 'cottage_owner', 'approved');

insert into public.owner_applications (
  id, owner_user_id, applicant_kind, legal_name, licensing_basis, status,
  submitted_at, review_started_at, decided_at
) values (
  '20000000-0000-4000-8000-000000002401',
  '00000000-0000-0000-0000-000000002401',
  'individual', 'Publication Owner', 'licence', 'approved', now(), now(), now()
);

insert into public.owner_application_cottage_profiles (
  id, application_id, owner_user_id, name, governorate,
  approximate_location, exact_address, exact_latitude, exact_longitude,
  private_directions, capacity, bedrooms, bathrooms, amenities,
  source_language, description, house_rules
) values (
  '30000000-0000-4000-8000-000000002401',
  '20000000-0000-4000-8000-000000002401',
  '00000000-0000-0000-0000-000000002401',
  'Shaqlawa Garden', 'Erbil', 'Near Shaqlawa', 'private address', 36.4, 44.3,
  'private directions', 8, 3, 2, array['garden'], 'en',
  'Quiet cottage', 'No smoking'
);

insert into public.cottage_profile_photos (
  id, profile_id, owner_user_id, actor_user_id, object_path,
  original_filename, media_type, size_bytes, state
) values (
  '40000000-0000-4000-8000-000000002401',
  '30000000-0000-4000-8000-000000002401',
  '00000000-0000-0000-0000-000000002401',
  '00000000-0000-0000-0000-000000002401',
  'private/profile/photo.webp', 'photo.webp', 'image/webp', 128, 'ready'
);
insert into storage.objects (bucket_id, name, owner_id, metadata)
values (
  public.cottage_profile_photo_bucket_name(), 'private/profile/photo.webp',
  '00000000-0000-0000-0000-000000002401',
  '{"size":128,"mimetype":"image/webp"}'::jsonb
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002401","role":"authenticated","aal":"aal1"}', true);
do $$
begin
  perform public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002401', 0,
    '[{"name":"Day","startTime":"08:00","endTime":"14:00"},{"name":"Evening","startTime":"18:00","endTime":"23:00"}]'
  );
end;
$$;
select lives_ok(
  $$select public.submit_cottage_profile_for_content_approval(
    '30000000-0000-4000-8000-000000002401', 1
  )$$,
  'an approved owner submits one immutable review cycle'
);
select is((select count(*) from public.cottage_profile_review_cycles), 1::bigint,
  'submission creates exactly one review cycle');
select results_eq(
  $$select name, approximate_location, amenities
    from public.cottage_profile_review_cycles$$,
  $$values ('Shaqlawa Garden'::text, 'Near Shaqlawa'::text, array['garden']::text[])$$,
  'submission snapshots all structured public fields into the immutable review cycle');
select results_eq(
  $$select locale::text, origin from public.cottage_profile_localized_revisions$$,
  $$values ('en'::text, 'owner_source'::text)$$,
  'the source language starts as the preserved localized head'
);
select is((select count(*) from public.cottage_profile_review_photos), 1::bigint,
  'review photo membership is snapshotted separately from the working set');
select throws_ok(
  $$select public.update_owner_cottage_profile_draft(
    '30000000-0000-4000-8000-000000002401', 2,
    'Changed', 'Erbil', 'Near Shaqlawa', 'private address', 36.4, 44.3,
    'private directions', 8, 3, 2, array['garden'], 'en', 'Changed', 'Changed'
  )$$,
  'RC202', null, 'the owner cannot bypass an active review cycle'
);

set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"service_role","aal":"aal2"}', true);
select throws_ok(
  $$select public.begin_cottage_profile_translation(
    (select id from public.cottage_profile_review_cycles), 'ar'
  )$$,
  'RC246', null, 'translation attempts fail closed while production is disabled'
);
select is((select count(*) from public.cottage_profile_translation_attempts), 0::bigint,
  'a disabled translation begin makes no durable change');
update public.cottage_translation_runtime_control set production_ready = true;
select lives_ok(
  $$select public.begin_cottage_profile_translation(
    (select id from public.cottage_profile_review_cycles), 'ar'
  )$$,
  'the service boundary starts an Arabic attempt'
);
select is((select count(*) from public.cottage_profile_translation_attempts), 1::bigint,
  'the attempt has one durable identifier');
select lives_ok(
  $$select public.begin_cottage_profile_translation(
    (select id from public.cottage_profile_review_cycles), 'ar'
  )$$,
  'retrying an active target is idempotent'
);
select is((select count(*) from public.cottage_profile_translation_attempts), 1::bigint,
  'idempotency does not create a second active attempt');
select lives_ok(
  $$select public.complete_cottage_profile_translation(
    (select id from public.cottage_profile_translation_attempts where target_language = 'ar'),
    'كوخ هادئ', 'ممنوع التدخين', 'provider', 'returned-model',
    'returned-effort', 'returned-prompt'
  )$$,
  'a current attempt records its provider-returned result'
);
select results_eq(
  $$select provider, model, effort, prompt_version
    from public.cottage_profile_translation_attempts where state = 'completed'$$,
  $$values ('provider'::text, 'returned-model'::text, 'returned-effort'::text, 'returned-prompt'::text)$$,
  'only returned translation provenance is persisted');
select lives_ok(
  $$select public.begin_cottage_profile_translation(
    (select id from public.cottage_profile_review_cycles), 'ckb'
  )$$,
  'the service starts a Sorani attempt against an absent localized head');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.update_administrator_cottage_profile(
    '30000000-0000-4000-8000-000000002401', 2,
    'Shaqlawa Garden', 'Erbil', 'Near Shaqlawa', 'private address', 36.4, 44.3,
    'private directions', 8, 3, 2, array['garden'], 'en', 'Bypassed', 'Bypassed'
  )$$,
  'RC208', null, 'administrator working-copy edits cannot bypass localized history'
);
select lives_ok(
  $$select public.update_administrator_cottage_profile(
    '30000000-0000-4000-8000-000000002401', 2,
    'Unreviewed Working Name', 'Erbil', 'Unreviewed working location',
    'private address', 36.4, 44.3, 'private directions', 8, 3, 2,
    array['garden','wifi'], 'en', 'Quiet cottage', 'No smoking'
  )$$,
  'structured working-copy changes remain private during the active review');
select throws_ok(
  $$select public.correct_cottage_profile_localization(
    (select id from public.cottage_profile_review_cycles), 'ckb',
    'کۆتێجێکی ئارام', 'جگەرەکێشان قەدەغەیە', 'Human Sorani draft'
  )$$,
  'RC204', null, 'an administrator cannot create a missing non-source language head');
select lives_ok(
  $$select public.correct_cottage_profile_localization(
    (select id from public.cottage_profile_review_cycles), 'ar',
    'كوخ هادئ مصحح', 'ممنوع التدخين', 'Language correction'
  )$$,
  'an administrator correction appends a localized revision'
);
select is((select count(*) from public.cottage_profile_localized_revisions where locale = 'ar'), 2::bigint,
  'the generated Arabic revision remains in history');
set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"service_role","aal":"aal2"}', true);
update public.cottage_translation_runtime_control set production_ready = false;
select throws_ok(
  $$select public.complete_cottage_profile_translation(
    (select id from public.cottage_profile_translation_attempts where target_language = 'ckb'),
    'کۆتێجی سەرەتایی', 'یاسای سەرەتایی', 'provider', 'model', 'high', 'v1'
  )$$,
  'RC246', null, 'translation completion fails closed when runtime becomes disabled');
reset role;
select results_eq(
  $$select state, (select count(*) from public.cottage_profile_localized_heads where locale = 'ckb')
    from public.cottage_profile_translation_attempts where target_language = 'ckb'$$,
  $$values ('pending'::text, 0::bigint)$$,
  'a disabled completion leaves both attempt and localized head unchanged');
set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"service_role","aal":"aal2"}', true);
update public.cottage_translation_runtime_control set production_ready = true;
select results_eq(
  $$select public.complete_cottage_profile_translation(
    (select id from public.cottage_profile_translation_attempts where target_language = 'ckb'),
    'کۆتێجی سەرەتایی', 'یاسای سەرەتایی', 'provider', 'model', 'high', 'v1'
  )$$,
  array[true], 'the enabled provider completion creates the initial Sorani head');
select lives_ok(
  $$select public.begin_cottage_profile_translation(
    (select id from public.cottage_profile_review_cycles), 'ckb'
  )$$,
  'a later Sorani attempt records the generated head it expects');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
select lives_ok(
  $$select public.correct_cottage_profile_localization(
    (select id from public.cottage_profile_review_cycles), 'ckb',
    'کۆتێجێکی ئارام', 'جگەرەکێشان قەدەغەیە', 'Human Sorani correction'
  )$$,
  'an administrator can correct Sorani only after generated provenance exists');
set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"service_role","aal":"aal2"}', true);
select results_eq(
  $$select public.complete_cottage_profile_translation(
    (select id from public.cottage_profile_translation_attempts
      where target_language = 'ckb' and state = 'pending'),
    'کۆتێجی کۆن', 'یاسای کۆن', 'provider', 'late-model', 'high', 'v1'
  )$$,
  array[false],
  'a provider completion loses compare-and-swap after an administrator advances the head');
update public.cottage_translation_runtime_control set production_ready = false;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
select results_eq(
  $$select revisions.origin, revisions.description
    from public.cottage_profile_localized_heads heads
    join public.cottage_profile_localized_revisions revisions
      on revisions.id = heads.localized_revision_id
    where heads.locale = 'ckb'$$,
  $$values ('administrator_correction'::text, 'کۆتێجێکی ئارام'::text)$$,
  'the administrator correction remains current after the late provider result');
select lives_ok(
  $$select public.decide_cottage_profile_localization(
    (select id from public.cottage_profile_review_cycles), 'en', true, 'Source approved'
  ), public.decide_cottage_profile_localization(
    (select id from public.cottage_profile_review_cycles), 'ar', true, 'Arabic approved'
  ), public.decide_cottage_profile_localization(
    (select id from public.cottage_profile_review_cycles), 'ckb', true, 'Sorani approved'
  )$$,
  'one administrator approves all three current heads with reasons');
select throws_ok(
  $$select public.approve_cottage_profile_publication(
    (select id from public.cottage_profile_review_cycles), 'Ready'
  )$$,
  'RC246', null, 'production publication fails loudly until issue #46 enables the adapter');

reset role;
delete from public.cottage_translation_runtime_control;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.approve_cottage_profile_publication(
    (select id from public.cottage_profile_review_cycles), 'Ready'
  )$$,
  'RC246', null,
  'missing runtime configuration also fails closed before publication');
reset role;
insert into public.cottage_translation_runtime_control (singleton, production_ready)
values (true, false);

set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"service_role","aal":"aal2"}', true);
update public.cottage_translation_runtime_control set production_ready = true;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
select lives_ok(
  $$select public.approve_cottage_profile_publication(
    (select id from public.cottage_profile_review_cycles), 'Ready'
  )$$,
  'the complete three-language review publishes atomically when production is enabled');
set local role service_role;
select is((select count(*) from public.cottage_publication_snapshots), 1::bigint,
  'one immutable public snapshot is created');
select is((select count(*) from public.cottage_publication_localizations), 3::bigint,
  'all three localized versions belong to that snapshot');
select is((select count(*) from public.cottage_publication_media), 1::bigint,
  'approved media belongs immutably to that snapshot');
select results_eq(
  $$select name, approximate_location, amenities from public.cottage_publication_snapshots$$,
  $$values ('Shaqlawa Garden'::text, 'Near Shaqlawa'::text, array['garden']::text[])$$,
  'publication uses reviewed structured fields rather than later working-copy changes');
select ok(
  lower(pg_get_functiondef('public.approve_cottage_profile_publication(uuid,text)'::regprocedure))
    like '%from public.account_contexts%for update%',
  'publication approval locks the authoritative owner eligibility row before checking it');
select results_eq(
  $$select table_name, has_column_privilege('authenticated', format('public.%I', table_name), 'administrator_user_id', 'select')
    from unnest(array[
      'cottage_profile_localized_revisions', 'cottage_profile_localized_decisions',
      'cottage_profile_publication_decisions'
    ]) table_name order by table_name$$,
  $$values
    ('cottage_profile_localized_decisions'::text, false),
    ('cottage_profile_localized_revisions', false),
    ('cottage_profile_publication_decisions', false)$$,
  'authenticated owners cannot select stable administrator identifiers');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002401","role":"authenticated","aal":"aal1"}', true);
select lives_ok(
  $$select approved, reason, decided_at from public.cottage_profile_localized_decisions$$,
  'the owner can still read privacy-safe decision outcome history');
reset role;
select results_eq(
  $$select role_name, function_name, allowed from (
    values
      ('anon', 'begin', has_function_privilege('anon', 'public.begin_cottage_profile_translation(uuid,public.cottage_profile_source_language)', 'execute')),
      ('anon', 'complete', has_function_privilege('anon', 'public.complete_cottage_profile_translation(uuid,text,text,text,text,text,text)', 'execute')),
      ('anon', 'fail', has_function_privilege('anon', 'public.fail_cottage_profile_translation(uuid,text)', 'execute')),
      ('anon', 'resolve', has_function_privilege('anon', 'public.resolve_current_cottage_publication_media(uuid)', 'execute')),
      ('authenticated', 'begin', has_function_privilege('authenticated', 'public.begin_cottage_profile_translation(uuid,public.cottage_profile_source_language)', 'execute')),
      ('authenticated', 'complete', has_function_privilege('authenticated', 'public.complete_cottage_profile_translation(uuid,text,text,text,text,text,text)', 'execute')),
      ('authenticated', 'fail', has_function_privilege('authenticated', 'public.fail_cottage_profile_translation(uuid,text)', 'execute')),
      ('authenticated', 'resolve', has_function_privilege('authenticated', 'public.resolve_current_cottage_publication_media(uuid)', 'execute')),
      ('service_role', 'begin', has_function_privilege('service_role', 'public.begin_cottage_profile_translation(uuid,public.cottage_profile_source_language)', 'execute')),
      ('service_role', 'complete', has_function_privilege('service_role', 'public.complete_cottage_profile_translation(uuid,text,text,text,text,text,text)', 'execute')),
      ('service_role', 'fail', has_function_privilege('service_role', 'public.fail_cottage_profile_translation(uuid,text)', 'execute')),
      ('service_role', 'resolve', has_function_privilege('service_role', 'public.resolve_current_cottage_publication_media(uuid)', 'execute'))
  ) grants(role_name, function_name, allowed) order by role_name, function_name$$,
  $$values
    ('anon'::text, 'begin'::text, false), ('anon', 'complete', false), ('anon', 'fail', false), ('anon', 'resolve', false),
    ('authenticated', 'begin', false), ('authenticated', 'complete', false), ('authenticated', 'fail', false), ('authenticated', 'resolve', false),
    ('service_role', 'begin', true), ('service_role', 'complete', true), ('service_role', 'fail', true), ('service_role', 'resolve', true)$$,
  'translation and media RPC grants belong only to service_role');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select public.begin_cottage_profile_translation('10000000-0000-4000-8000-000000000024', 'ar')$$, '42501', null, 'anon cannot begin translation');
select throws_ok($$select public.complete_cottage_profile_translation('10000000-0000-4000-8000-000000000024', 'x', 'x', 'x', 'x', 'x', 'x')$$, '42501', null, 'anon cannot complete translation');
select throws_ok($$select public.fail_cottage_profile_translation('10000000-0000-4000-8000-000000000024', 'x')$$, '42501', null, 'anon cannot fail translation');
select throws_ok($$select public.resolve_current_cottage_publication_media('10000000-0000-4000-8000-000000000024')$$, '42501', null, 'anon cannot resolve publication media');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002401","role":"authenticated","aal":"aal1"}', true);
select throws_ok($$select public.begin_cottage_profile_translation('10000000-0000-4000-8000-000000000024', 'ar')$$, '42501', null, 'authenticated cannot begin translation');
select throws_ok($$select public.complete_cottage_profile_translation('10000000-0000-4000-8000-000000000024', 'x', 'x', 'x', 'x', 'x', 'x')$$, '42501', null, 'authenticated cannot complete translation');
select throws_ok($$select public.fail_cottage_profile_translation('10000000-0000-4000-8000-000000000024', 'x')$$, '42501', null, 'authenticated cannot fail translation');
select throws_ok($$select public.resolve_current_cottage_publication_media('10000000-0000-4000-8000-000000000024')$$, '42501', null, 'authenticated cannot resolve publication media');
set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"service_role","aal":"aal2"}', true);
select results_eq(
  $$select public.resolve_current_cottage_publication_media((select opaque_id from public.cottage_publication_media))$$,
  array['private/profile/photo.webp'::text], 'service_role resolves only current publication media');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002403","role":"authenticated","aal":"aal1"}', true);
select results_eq(
  $$select relation_name, row_count from (
    values
      ('cycles', (select count(*) from public.cottage_profile_review_cycles)),
      ('revisions', (select count(*) from public.cottage_profile_localized_revisions)),
      ('heads', (select count(*) from public.cottage_profile_localized_heads)),
      ('photos', (select count(*) from public.cottage_profile_review_photos)),
      ('locale_decisions', (select count(*) from public.cottage_profile_localized_decisions)),
      ('publication_decisions', (select count(*) from public.cottage_profile_publication_decisions))
  ) as isolation(relation_name, row_count) order by relation_name$$,
  $$values
    ('cycles'::text, 0::bigint), ('heads', 0::bigint), ('locale_decisions', 0::bigint),
    ('photos', 0::bigint), ('publication_decisions', 0::bigint), ('revisions', 0::bigint)$$,
  'a foreign owner cannot read another Cottage Profile review or decision history');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal1"}', true);
select results_eq(
  $$select relation_name, row_count from (
    values
      ('cycles', (select count(*) from public.cottage_profile_review_cycles)),
      ('revisions', (select count(*) from public.cottage_profile_localized_revisions)),
      ('heads', (select count(*) from public.cottage_profile_localized_heads)),
      ('photos', (select count(*) from public.cottage_profile_review_photos)),
      ('locale_decisions', (select count(*) from public.cottage_profile_localized_decisions)),
      ('publication_decisions', (select count(*) from public.cottage_profile_publication_decisions))
  ) as assurance(relation_name, row_count) order by relation_name$$,
  $$values
    ('cycles'::text, 0::bigint), ('heads', 0::bigint), ('locale_decisions', 0::bigint),
    ('photos', 0::bigint), ('publication_decisions', 0::bigint), ('revisions', 0::bigint)$$,
  'an AAL1 administrator is denied by every new administrator read policy');
select throws_ok(
  $$select public.correct_cottage_profile_localization(
    (select id from public.cottage_profile_review_cycles limit 1), 'en', 'No', 'No', 'No'
  )$$,
  '42501', null, 'an AAL1 administrator cannot call the correction RPC');
select throws_ok(
  $$select public.decide_cottage_profile_localization(
    (select id from public.cottage_profile_review_cycles limit 1), 'en', true, 'No'
  )$$,
  '42501', null, 'an AAL1 administrator cannot call the locale-decision RPC');
select throws_ok(
  $$select public.approve_cottage_profile_publication(
    (select id from public.cottage_profile_review_cycles limit 1), 'No'
  )$$,
  '42501', null, 'an AAL1 administrator cannot call the approval RPC');
select throws_ok(
  $$select public.reject_cottage_profile_publication(
    (select id from public.cottage_profile_review_cycles limit 1), 'No'
  )$$,
  '42501', null, 'an AAL1 administrator cannot call the rejection RPC');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
reset role;
select throws_ok(
  $$update public.cottage_profile_localized_revisions set description = 'mutated'$$,
  'RC208', null, 'localized revisions reject direct updates');
select throws_ok(
  $$delete from public.cottage_profile_localized_revisions$$,
  'RC208', null, 'localized revisions reject direct deletes');
select throws_ok(
  $$update public.cottage_profile_localized_decisions set reason = 'mutated'$$,
  'RC208', null, 'localized decisions reject direct updates');
select throws_ok(
  $$delete from public.cottage_profile_localized_decisions$$,
  'RC208', null, 'localized decisions reject direct deletes');
select throws_ok(
  $$update public.cottage_profile_publication_decisions set reason = 'mutated'$$,
  'RC208', null, 'publication decisions reject direct updates');
select throws_ok(
  $$delete from public.cottage_profile_publication_decisions$$,
  'RC208', null, 'publication decisions reject direct deletes');
select throws_ok(
  $$update public.cottage_publication_snapshots set name = 'mutated'$$,
  'RC208', null, 'publication snapshots reject direct updates');
select throws_ok(
  $$delete from public.cottage_publication_snapshots$$,
  'RC208', null, 'publication snapshots reject direct deletes');
select throws_ok(
  $$update public.cottage_publication_localizations set description = 'mutated'$$,
  'RC208', null, 'publication localizations reject direct updates');
select throws_ok(
  $$delete from public.cottage_publication_localizations$$,
  'RC208', null, 'publication localizations reject direct deletes');
select throws_ok(
  $$update public.cottage_publication_media set position = 2$$,
  'RC208', null, 'publication media reject direct updates');
select throws_ok(
  $$delete from public.cottage_publication_media$$,
  'RC208', null, 'publication media reject direct deletes');
select throws_ok(
  $$update public.cottage_profile_review_photos set position = 2$$,
  'RC208', null, 'review media membership rejects direct updates');
select throws_ok(
  $$delete from public.cottage_profile_review_photos$$,
  'RC208', null, 'review media membership rejects direct deletes');
select throws_ok(
  $$update public.cottage_profile_photos set state = 'deletion_pending'
    where id = '40000000-0000-4000-8000-000000002401'$$,
  'RC210', null, 'published media cannot be prepared for storage deletion');

select set_config(
  'test.first_publication_media_id',
  (select media.opaque_id::text
    from public.cottage_publication_media media
    join public.owner_application_cottage_profiles profiles
      on profiles.current_publication_id = media.publication_id
    where profiles.id = '30000000-0000-4000-8000-000000002401'),
  true
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002401","role":"authenticated","aal":"aal1"}', true);
select lives_ok(
  $$select public.update_owner_cottage_profile_draft(
    '30000000-0000-4000-8000-000000002401', 4,
    'Later Private Name', 'Erbil', 'Later private location', 'private address', 36.4, 44.3,
    'new private directions', 8, 3, 2, array['garden','wifi'], 'en',
    'A private later Content Change', 'New private rules'
  )$$,
  'an owner can prepare a later private Content Change after publication');
select lives_ok(
  $$select public.prepare_cottage_profile_photo_deletion(
    '40000000-0000-4000-8000-000000002401'
  )$$,
  'an approved historical photo can leave the later working copy');
reset role;
select results_eq(
  $$select is_active, state::text
    from public.cottage_profile_photos
    where id = '40000000-0000-4000-8000-000000002401'$$,
  $$values (false, 'ready'::text)$$,
  'working-copy removal deactivates historical media without preparing storage deletion');
select results_eq(
  $$select count(*)::integer,
      (select count(*)::integer from storage.objects
        where bucket_id = public.cottage_profile_photo_bucket_name()
          and name = 'private/profile/photo.webp')
    from public.cottage_profile_photos
    where id = '40000000-0000-4000-8000-000000002401'$$,
  $$values (1, 1)$$,
  'historical photo metadata and its private object remain retained');
set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"service_role","aal":"aal2"}', true);
select results_eq(
  $$select public.resolve_current_cottage_publication_media(
    current_setting('test.first_publication_media_id')::uuid
  )$$,
  array['private/profile/photo.webp'::text],
  'the previous publication keeps serving retained media until replacement approval');
reset role;
insert into public.cottage_profile_photos (
  id, profile_id, owner_user_id, actor_user_id, object_path,
  original_filename, media_type, size_bytes, state
) values (
  '40000000-0000-4000-8000-000000002402',
  '30000000-0000-4000-8000-000000002401',
  '00000000-0000-0000-0000-000000002401',
  '00000000-0000-0000-0000-000000002401',
  'private/profile/replacement.webp', 'replacement.webp', 'image/webp', 256, 'ready'
);
insert into storage.objects (bucket_id, name, owner_id, metadata)
values (
  public.cottage_profile_photo_bucket_name(), 'private/profile/replacement.webp',
  '00000000-0000-0000-0000-000000002401',
  '{"size":256,"mimetype":"image/webp"}'::jsonb
);
select results_eq(
  $$select count(*)::integer, public.cottage_profile_ready_photo_count(
      '30000000-0000-4000-8000-000000002401'
    )
    from public.cottage_profile_photos
    where profile_id = '30000000-0000-4000-8000-000000002401' and is_active$$,
  $$values (1, 1)$$,
  'only the replacement photo counts in the active working set');
select results_eq(
  $$select descriptions.description, profiles.description <> descriptions.description
    from public.owner_application_cottage_profiles profiles
    join public.cottage_publication_snapshots publications
      on publications.id = profiles.current_publication_id
    join public.cottage_publication_localizations descriptions
      on descriptions.publication_id = publications.id and descriptions.locale = 'en'
    where profiles.id = '30000000-0000-4000-8000-000000002401'$$,
  $$values ('Quiet cottage'::text, true)$$,
  'the prior public snapshot remains current while private content changes');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002401","role":"authenticated","aal":"aal1"}', true);
select lives_ok(
  $$select public.submit_cottage_profile_for_content_approval(
    '30000000-0000-4000-8000-000000002401', 5
  )$$,
  'the later Content Change starts a separate immutable review cycle');
select results_eq(
  $$select name, approximate_location, amenities
    from public.cottage_profile_review_cycles where cycle_number = 2$$,
  $$values ('Later Private Name'::text, 'Later private location'::text, array['garden','wifi']::text[])$$,
  'later structured changes require and receive a new immutable review cycle');
select results_eq(
  $$select photos.photo_id
    from public.cottage_profile_review_photos photos
    join public.cottage_profile_review_cycles cycles
      on cycles.id = photos.review_cycle_id
    where cycles.cycle_number = 2$$,
  array['40000000-0000-4000-8000-000000002402'::uuid],
  'the later review snapshots only active replacement media');

set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"service_role","aal":"aal2"}', true);
update public.cottage_translation_runtime_control set production_ready = true;
select lives_ok(
  $$select public.begin_cottage_profile_translation(
    (select id from public.cottage_profile_review_cycles where cycle_number = 2), 'ar'
  ), public.begin_cottage_profile_translation(
    (select id from public.cottage_profile_review_cycles where cycle_number = 2), 'ckb'
  )$$,
  'the provider starts both non-source translations for the later cycle');
select lives_ok(
  $$select public.complete_cottage_profile_translation(
    (select attempts.id from public.cottage_profile_translation_attempts attempts
      join public.cottage_profile_review_cycles cycles on cycles.id = attempts.review_cycle_id
      where cycles.cycle_number = 2 and attempts.target_language = 'ar'),
    'تغيير خاص آلي', 'قواعد آلية', 'provider', 'model', 'high', 'v2'
  ), public.complete_cottage_profile_translation(
    (select attempts.id from public.cottage_profile_translation_attempts attempts
      join public.cottage_profile_review_cycles cycles on cycles.id = attempts.review_cycle_id
      where cycles.cycle_number = 2 and attempts.target_language = 'ckb'),
    'گۆڕانکاری دروستکراو', 'یاسای دروستکراو', 'provider', 'model', 'high', 'v2'
  )$$,
  'both later non-source heads originate in completed provider attempts');
update public.cottage_translation_runtime_control set production_ready = false;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
select lives_ok(
  $$select public.correct_cottage_profile_localization(
    (select id from public.cottage_profile_review_cycles where cycle_number = 2), 'ar',
    'تغيير خاص لاحق', 'قواعد خاصة جديدة', 'Arabic review'
  ), public.correct_cottage_profile_localization(
    (select id from public.cottage_profile_review_cycles where cycle_number = 2), 'ckb',
    'گۆڕانکاری تایبەتی دواتر', 'یاسای تایبەتی نوێ', 'Sorani review'
  )$$,
  'the later cycle receives its own Arabic and Sorani revisions');
select lives_ok(
  $$select public.decide_cottage_profile_localization(
    (select id from public.cottage_profile_review_cycles where cycle_number = 2), 'en', true, 'English approved'
  ), public.decide_cottage_profile_localization(
    (select id from public.cottage_profile_review_cycles where cycle_number = 2), 'ar', true, 'Arabic approved'
  ), public.decide_cottage_profile_localization(
    (select id from public.cottage_profile_review_cycles where cycle_number = 2), 'ckb', true, 'Sorani approved'
  )$$,
  'the later cycle can be moderated without changing the prior publication');

reset role;
update public.account_contexts set owner_approval_state = 'expired'
where user_id = '00000000-0000-0000-0000-000000002401';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.approve_cottage_profile_publication(
    (select id from public.cottage_profile_review_cycles where cycle_number = 2), 'Cannot publish expired owner'
  )$$,
  '42501', null, 'an expired owner blocks a new publication decision');
reset role;
update public.account_contexts set owner_approval_state = 'suspended'
where user_id = '00000000-0000-0000-0000-000000002401';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.approve_cottage_profile_publication(
    (select id from public.cottage_profile_review_cycles where cycle_number = 2), 'Cannot publish suspended owner'
  )$$,
  '42501', null, 'a suspended owner blocks a new publication decision');
reset role;
select results_eq(
  $$select publications.publication_number
    from public.owner_application_cottage_profiles profiles
    join public.cottage_publication_snapshots publications
      on publications.id = profiles.current_publication_id
    where profiles.id = '30000000-0000-4000-8000-000000002401'$$,
  array[1], 'blocked later approvals do not change the prior public pointer');

reset role;
update public.account_contexts set owner_approval_state = 'approved'
where user_id = '00000000-0000-0000-0000-000000002401';
set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"service_role","aal":"aal2"}', true);
update public.cottage_translation_runtime_control set production_ready = true;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
select lives_ok(
  $$select public.approve_cottage_profile_publication(
    (select id from public.cottage_profile_review_cycles where cycle_number = 2),
    'Replacement publication approved'
  )$$,
  'an eligible owner replacement publishes atomically');
reset role;
select results_eq(
  $$select publications.publication_number
    from public.owner_application_cottage_profiles profiles
    join public.cottage_publication_snapshots publications
      on publications.id = profiles.current_publication_id
    where profiles.id = '30000000-0000-4000-8000-000000002401'$$,
  array[2],
  'replacement approval advances the current publication pointer');
set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"service_role","aal":"aal2"}', true);
select throws_ok(
  $$select public.resolve_current_cottage_publication_media(
    current_setting('test.first_publication_media_id')::uuid
  )$$,
  'RC204', null,
  'the old opaque media identifier is unavailable after pointer replacement');
select results_eq(
  $$select public.resolve_current_cottage_publication_media(media.opaque_id)
    from public.cottage_publication_media media
    join public.cottage_publication_snapshots publications
      on publications.id = media.publication_id
    where publications.profile_id = '30000000-0000-4000-8000-000000002401'
      and publications.publication_number = 2$$,
  array['private/profile/replacement.webp'::text],
  'only the replacement publication opaque media identifier resolves');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq(
  $$select table_name, has_table_privilege('anon', format('public.%I', table_name), 'select')
    from unnest(array[
      'cottage_profile_review_cycles', 'cottage_profile_localized_revisions',
      'cottage_profile_localized_heads', 'cottage_profile_review_photos',
      'cottage_profile_translation_attempts', 'cottage_profile_localized_decisions',
      'cottage_profile_publication_decisions', 'cottage_publication_snapshots',
      'cottage_publication_localizations', 'cottage_publication_media'
    ]) table_name order by table_name$$,
  $$values
    ('cottage_profile_localized_decisions'::text, false),
    ('cottage_profile_localized_heads', false),
    ('cottage_profile_localized_revisions', false),
    ('cottage_profile_publication_decisions', false),
    ('cottage_profile_review_cycles', false),
    ('cottage_profile_review_photos', false),
    ('cottage_profile_translation_attempts', false),
    ('cottage_publication_localizations', false),
    ('cottage_publication_media', false),
    ('cottage_publication_snapshots', false)$$,
  'anonymous callers have no direct SELECT privilege on any publication table');
select results_eq(
  $$select name, description, house_rules, cardinality(media_ids)
    from public.get_current_cottage_publication('30000000-0000-4000-8000-000000002401', 'ar')$$,
  $$values ('Later Private Name'::text, 'تغيير خاص لاحق'::text, 'قواعد خاصة جديدة'::text, 1)$$,
  'anonymous projection returns only approved current localized content and opaque media identifiers');
select throws_ok(
  $$select object_path from public.cottage_publication_media$$,
  '42501', null, 'anonymous callers cannot read private storage paths');

select * from finish();
rollback;
