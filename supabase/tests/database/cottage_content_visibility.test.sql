begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.configure_translation_runtime(target_ready boolean)
returns void language sql as $$
  update public.cottage_translation_runtime_control
  set production_ready = target_ready,
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
$$;

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
), (
  '40000000-0000-4000-8000-000000002402',
  '30000000-0000-4000-8000-000000002401',
  '00000000-0000-0000-0000-000000002401',
  '00000000-0000-0000-0000-000000002401',
  'private/profile/second.webp', 'second.webp', 'image/webp', 128, 'ready'
);
insert into storage.objects (bucket_id, name, owner_id, metadata)
values (
  public.cottage_profile_photo_bucket_name(), 'private/profile/photo.webp',
  '00000000-0000-0000-0000-000000002401',
  '{"size":128,"mimetype":"image/webp"}'::jsonb
), (
  public.cottage_profile_photo_bucket_name(), 'private/profile/second.webp',
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
do $$ begin
  perform public.submit_cottage_profile_for_content_approval('30000000-0000-4000-8000-000000002401', 1);
end $$;
set local role service_role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"service_role","aal":"aal2"}', true);
select pg_temp.configure_translation_runtime(true);
do $$
declare target_locale public.cottage_profile_source_language;
declare attempt public.cottage_profile_translation_attempts;
begin
  foreach target_locale in array array['ar','ckb']::public.cottage_profile_source_language[] loop
    perform public.begin_cottage_profile_translation_execution(
      (select id from public.cottage_profile_review_cycles), target_locale, 'ordinary', 50000);
    select * into attempt from public.cottage_profile_translation_attempts where target_language = target_locale;
    perform public.complete_cottage_profile_translation_execution(
      attempt.id, attempt.lease_token, 'Translated description ' || target_locale::text,
      'Translated rules ' || target_locale::text, 'provider', 'model', 'none', 'v1');
  end loop;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
do $$
declare target_locale public.cottage_profile_source_language;
begin
  foreach target_locale in array array['en','ar','ckb']::public.cottage_profile_source_language[] loop
    perform public.decide_cottage_profile_localization(
      (select id from public.cottage_profile_review_cycles), target_locale, true, 'Reviewed language');
  end loop;
end $$;
select set_config('test.visibility_cycle_id', (select id::text from public.cottage_profile_review_cycles), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated"}', true);
select throws_ok(
  $$select public.approve_cottage_profile_publication(
    current_setting('test.visibility_cycle_id')::uuid, 'Valid publication approval')$$,
  '42501', null, 'publication approval rejects missing assurance without writing publication or decisions');
reset role;
select is((select count(*) from public.cottage_publication_snapshots), 0::bigint,
  'missing assurance creates no publication rows');
select is((select current_publication_id from public.owner_application_cottage_profiles), null::uuid,
  'missing assurance leaves the current publication pointer unchanged');
select is((select state from public.cottage_profile_review_cycles), 'in_review',
  'missing assurance leaves the valid review cycle in review');
select is((select count(*) from public.cottage_profile_publication_decisions), 0::bigint,
  'missing assurance creates no publication decisions');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
select public.approve_cottage_profile_publication(current_setting('test.visibility_cycle_id')::uuid, 'Approved fixture');
select set_config('test.visibility_publication_id', (select current_publication_id::text from public.owner_application_cottage_profiles where id='30000000-0000-4000-8000-000000002401'), true);
reset role;
select set_config('test.visibility_history', jsonb_build_object(
  'snapshot', (select to_jsonb(row) from public.cottage_publication_snapshots row),
  'localizations', (select jsonb_agg(to_jsonb(row) order by locale) from public.cottage_publication_localizations row),
  'media', (select jsonb_agg(to_jsonb(row) order by position) from public.cottage_publication_media row),
  'profile', (select to_jsonb(row) - 'description_hidden' from public.owner_application_cottage_profiles row)
)::text, true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated"}', true);
select throws_ok(
  $$select public.set_administrator_cottage_description_hidden(
    '30000000-0000-4000-8000-000000002401', current_setting('test.visibility_publication_id')::uuid, true, 'Reviewed removal')$$,
  '42501', null, 'only current AAL2 administrators can change published content visibility');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
select lives_ok($$select public.set_administrator_cottage_photo_hidden(
  '30000000-0000-4000-8000-000000002401', current_setting('test.visibility_publication_id')::uuid,
  '40000000-0000-4000-8000-000000002401', true, '  Reviewed photo removal  ')$$,
  'a current administrator hides one of two approved photos');
select throws_ok($$select public.set_administrator_cottage_photo_hidden(
  '30000000-0000-4000-8000-000000002401', current_setting('test.visibility_publication_id')::uuid,
  '40000000-0000-4000-8000-000000002402', true, 'Reviewed second removal')$$,
  'RC203', null, 'the last visible approved photo cannot be hidden or republished away');

select public.set_administrator_cottage_description_hidden(
  '30000000-0000-4000-8000-000000002401', current_setting('test.visibility_publication_id')::uuid, true, 'Description review');
reset role;
select set_config('test.visibility_visible_media', opaque_id::text, true)
  from public.cottage_publication_media where photo_id = '40000000-0000-4000-8000-000000002402';
select set_config('test.visibility_hidden_media', opaque_id::text, true)
  from public.cottage_publication_media where photo_id = '40000000-0000-4000-8000-000000002401';
select set_config('test.visibility_slug', public_slug, true) from public.cottage_marketplace_listings
  where profile_id = '30000000-0000-4000-8000-000000002401';
insert into public.cottage_inventory_standard_prices(schedule_revision_id, unit_kind, unit_id, price_iqd)
  select schedule_revision_id, 'shift', id, 60000 from public.cottage_shifts
    where schedule_revision_id = (select current_shift_schedule_id from public.owner_application_cottage_profiles);
insert into public.cottage_inventory_availability(schedule_revision_id, service_day, unit_kind, unit_id, state)
  select schedule_revision_id, '2099-08-21', 'shift', id, 'open' from public.cottage_shifts
    where schedule_revision_id = (select current_shift_schedule_id from public.owner_application_cottage_profiles);
select set_config('test.visibility_search', '{"from":"2099-08-21","to":"2099-08-21","guests":4}', true);
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select ok((select description is null and media_ids = array[current_setting('test.visibility_visible_media')::uuid]
  from public.get_current_cottage_publication('30000000-0000-4000-8000-000000002401', 'en')),
  'hidden content is absent from every public projection and media resolution');
select ok((select description is null and description_hidden
  and media_ids=array[current_setting('test.visibility_visible_media')::uuid]
  from public.get_current_cottage_publication('30000000-0000-4000-8000-000000002401', locale)),
  'independently public publication output suppresses hidden content with an explicit flag in ' || locale::text)
  from unnest(array['en','ar','ckb']::public.cottage_profile_source_language[]) locale;
select ok(projection.result @> jsonb_build_object(
    'description', null, 'descriptionHidden', true,
    'name', 'Shaqlawa Garden', 'capacity', 8,
    'houseRules', case locale when 'en' then 'No smoking' else 'Translated rules ' || locale::text end)
  and projection.result->'mediaIds' = jsonb_build_array(current_setting('test.visibility_visible_media')),
  'detail suppresses hidden text and photo while retaining facts in ' || locale::text)
  from unnest(array['en','ar','ckb']::public.cottage_profile_source_language[]) locale
  cross join lateral public.get_public_cottage_profile(
    locale, current_setting('test.visibility_slug'), current_setting('test.visibility_search')::jsonb) as projection(result);
select is(public.search_public_cottages('en', current_setting('test.visibility_search')::jsonb, null, 12)
  -> 'items' -> 0 -> 'mediaIds', jsonb_build_array(current_setting('test.visibility_visible_media')),
  'search omits the hidden approved photo');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$select public.resolve_current_cottage_publication_media(current_setting('test.visibility_hidden_media')::uuid)$$,
  'RC204', null, 'a captured hidden opaque media ID cannot resolve');
select is(public.resolve_current_cottage_publication_media(current_setting('test.visibility_visible_media')::uuid),
  'private/profile/second.webp', 'the remaining visible photo still resolves');

reset role;
create function pg_temp.try_hidden_only_publication() returns text language plpgsql as $test$
begin
  execute $setup$
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002401","role":"authenticated","aal":"aal1"}', true);
select public.prepare_cottage_profile_photo_deletion('40000000-0000-4000-8000-000000002402');
select public.submit_cottage_profile_for_content_approval('30000000-0000-4000-8000-000000002401', 3);
select set_config('test.visibility_next_cycle', id::text, true) from public.cottage_profile_review_cycles where state='in_review';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare target_locale public.cottage_profile_source_language;
declare attempt public.cottage_profile_translation_attempts;
begin
  foreach target_locale in array array['ar','ckb']::public.cottage_profile_source_language[] loop
    select * into attempt from public.begin_cottage_profile_translation_execution(
      current_setting('test.visibility_next_cycle')::uuid, target_locale, 'ordinary', 50000);
    perform public.complete_cottage_profile_translation_execution(
      attempt.id, attempt.lease_token, 'New translated description ' || target_locale::text,
      'New translated rules ' || target_locale::text, 'provider', 'model', 'none', 'v1');
  end loop;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
do $$
declare target_locale public.cottage_profile_source_language;
begin
  foreach target_locale in array array['en','ar','ckb']::public.cottage_profile_source_language[] loop
    perform public.decide_cottage_profile_localization(current_setting('test.visibility_next_cycle')::uuid, target_locale, true, 'Reviewed language');
  end loop;
end $$;
select public.approve_cottage_profile_publication(current_setting('test.visibility_next_cycle')::uuid, 'Complete review');
$setup$;
  return '00000';
exception when others then return SQLSTATE;
end;
$test$;
select is(pg_temp.try_hidden_only_publication(), 'RC203',
  'publication refuses an otherwise valid reviewed set containing only hidden photos');


set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
select is(public.get_administrator_cottage_content_visibility('30000000-0000-4000-8000-000000002499'), null::jsonb,
  'an unpublished or absent profile returns SQL NULL rather than an empty panel');
select is(public.get_administrator_cottage_content_visibility('30000000-0000-4000-8000-000000002401') -> 'photos',
  '[{"photoId":"40000000-0000-4000-8000-000000002401","originalFilename":"photo.webp","hidden":true},{"photoId":"40000000-0000-4000-8000-000000002402","originalFilename":"second.webp","hidden":false}]'::jsonb,
  'the private visibility read includes every approved source photo in publication order');
select throws_ok(format($sql$select public.set_administrator_cottage_description_hidden(%s, %s, %s, %s)$sql$,
  profile_id, publication_id, hidden, reason), code, null, 'description visibility rejects ' || label)
from (values
  ('null', quote_literal(current_setting('test.visibility_publication_id')), 'true', quote_literal('Reason'), '22023', 'NULL profile'),
  (quote_literal('30000000-0000-4000-8000-000000002401'), 'null', 'true', quote_literal('Reason'), '22023', 'NULL publication'),
  (quote_literal('30000000-0000-4000-8000-000000002401'), quote_literal(current_setting('test.visibility_publication_id')), 'null', quote_literal('Reason'), '22023', 'NULL state'),
  (quote_literal('30000000-0000-4000-8000-000000002401'), quote_literal(current_setting('test.visibility_publication_id')), 'true', 'null', '22023', 'NULL reason'),
  (quote_literal('30000000-0000-4000-8000-000000002401'), quote_literal(current_setting('test.visibility_publication_id')), 'true', quote_literal(E' \t\n '), '22023', 'blank reason'),
  (quote_literal('30000000-0000-4000-8000-000000002401'), quote_literal(current_setting('test.visibility_publication_id')), 'true', quote_literal(repeat('x',1001)), '22023', 'overlong reason'),
  (quote_literal('30000000-0000-4000-8000-000000002401'), quote_literal('50000000-0000-4000-8000-000000002499'), 'true', quote_literal('Reason'), 'RC409', 'stale publication'),
  (quote_literal('30000000-0000-4000-8000-000000002499'), quote_literal(current_setting('test.visibility_publication_id')), 'true', quote_literal('Reason'), 'RC204', 'absent profile')
) inputs(profile_id, publication_id, hidden, reason, code, label);
select throws_ok(format($sql$select public.set_administrator_cottage_photo_hidden(
  '30000000-0000-4000-8000-000000002401', %s, %s, %s, %s)$sql$,
  publication_id, photo_id, hidden, reason), code, null, 'photo visibility rejects ' || label)
from (values
  ('null', quote_literal('40000000-0000-4000-8000-000000002401'), 'true', quote_literal('Reason'), '22023', 'NULL publication'),
  (quote_literal(current_setting('test.visibility_publication_id')), 'null', 'true', quote_literal('Reason'), '22023', 'NULL photo'),
  (quote_literal(current_setting('test.visibility_publication_id')), quote_literal('40000000-0000-4000-8000-000000002401'), 'null', quote_literal('Reason'), '22023', 'NULL state'),
  (quote_literal(current_setting('test.visibility_publication_id')), quote_literal('40000000-0000-4000-8000-000000002401'), 'true', 'null', '22023', 'NULL reason'),
  (quote_literal(current_setting('test.visibility_publication_id')), quote_literal('40000000-0000-4000-8000-000000002401'), 'true', quote_literal('  '), '22023', 'blank reason'),
  (quote_literal(current_setting('test.visibility_publication_id')), quote_literal('40000000-0000-4000-8000-000000002401'), 'true', quote_literal(repeat('x',1001)), '22023', 'overlong reason'),
  (quote_literal('50000000-0000-4000-8000-000000002499'), quote_literal('40000000-0000-4000-8000-000000002401'), 'true', quote_literal('Reason'), 'RC409', 'stale publication'),
  (quote_literal(current_setting('test.visibility_publication_id')), quote_literal('40000000-0000-4000-8000-000000002499'), 'false', quote_literal('Reason'), 'RC204', 'nonmember photo')
) inputs(publication_id, photo_id, hidden, reason, code, label);
select public.set_administrator_cottage_description_hidden('30000000-0000-4000-8000-000000002401', current_setting('test.visibility_publication_id')::uuid, true, 'Valid repeated description');
select public.set_administrator_cottage_photo_hidden('30000000-0000-4000-8000-000000002401', current_setting('test.visibility_publication_id')::uuid, '40000000-0000-4000-8000-000000002401', true, 'Valid repeated photo');
reset role;
select is((select count(*) from public.cottage_profile_administrator_audit), 2::bigint,
  'validated identical states and refused mutations create no duplicate audit');
select ok((select bool_and(administrator_user_id = '00000000-0000-0000-0000-000000002402' and occurred_at is not null
  and previous_version = resulting_version and reason is not null) from public.cottage_profile_administrator_audit)
  and (select reason = 'Reviewed photo removal' and object_path='private/profile/photo.webp' from public.cottage_profile_administrator_audit where event_kind='photo_hidden'),
  'visibility transitions carry the normalized reason, actor, time, unchanged version and photo identity');
select is(jsonb_build_object(
  'snapshot', (select to_jsonb(row) from public.cottage_publication_snapshots row),
  'localizations', (select jsonb_agg(to_jsonb(row) order by locale) from public.cottage_publication_localizations row),
  'media', (select jsonb_agg(to_jsonb(row) order by position) from public.cottage_publication_media row),
  'profile', (select to_jsonb(row) - 'description_hidden' from public.owner_application_cottage_profiles row)
), current_setting('test.visibility_history')::jsonb,
  'visibility changes retain immutable publication and audit history');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal1"}', true);
select throws_ok($$select public.get_administrator_cottage_content_visibility('30000000-0000-4000-8000-000000002401')$$, '42501', null, 'AAL1 cannot read private visibility');
select throws_ok($$select public.set_administrator_cottage_photo_hidden('30000000-0000-4000-8000-000000002401', current_setting('test.visibility_publication_id')::uuid, '40000000-0000-4000-8000-000000002401', false, 'Valid reason')$$, '42501', null, 'AAL1 cannot restore a photo');
select throws_ok($$update public.cottage_profile_photos set public_hidden=false where id='40000000-0000-4000-8000-000000002401'$$, '42501', null, 'authenticated callers cannot write visibility flags directly');
reset role;
update public.account_contexts set role='customer' where user_id='00000000-0000-0000-0000-000000002402';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$select public.set_administrator_cottage_description_hidden('30000000-0000-4000-8000-000000002401', current_setting('test.visibility_publication_id')::uuid, false, 'Valid reason')$$, '42501', null, 'a revoked administrator cannot restore descriptions');
select throws_ok($$select public.set_administrator_cottage_photo_hidden('30000000-0000-4000-8000-000000002401', current_setting('test.visibility_publication_id')::uuid, '40000000-0000-4000-8000-000000002401', false, 'Valid reason')$$, '42501', null, 'a revoked administrator cannot restore photos');
reset role;
update public.account_contexts set role='platform_administrator' where user_id='00000000-0000-0000-0000-000000002402';
select set_config('test.visibility_report_revision', (select localized_revision_id::text from public.cottage_publication_localizations where locale='ar'), true);
select set_config('test.visibility_prior_audit', (select jsonb_agg(to_jsonb(a) order by id)::text from public.cottage_profile_administrator_audit a), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002401","role":"authenticated","aal":"aal1"}', true);
do $$
declare report public.cottage_translation_quality_reports;
begin
  select * into report from public.report_current_cottage_translation(
    current_setting('test.visibility_cycle_id')::uuid,
    current_setting('test.visibility_report_revision')::uuid,
    'Review published wording');
  perform set_config('test.visibility_remediation', report.remediation_review_cycle_id::text, true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
do $$
declare target_locale public.cottage_profile_source_language;
begin
  foreach target_locale in array array['en','ar','ckb']::public.cottage_profile_source_language[] loop
    perform public.decide_cottage_profile_localization(current_setting('test.visibility_remediation')::uuid, target_locale, true, 'Reapproved current language');
  end loop;
  perform public.approve_cottage_profile_publication(current_setting('test.visibility_remediation')::uuid, 'Publish reviewed update');
end $$;
select set_config('test.visibility_republished_id', current_publication_id::text, true)
  from public.owner_application_cottage_profiles where id='30000000-0000-4000-8000-000000002401';
select ok(public.get_administrator_cottage_content_visibility('30000000-0000-4000-8000-000000002401') @>
  '{"descriptionHidden":true,"photos":[{"photoId":"40000000-0000-4000-8000-000000002401","hidden":true}]}'::jsonb
  and current_setting('test.visibility_republished_id')<>current_setting('test.visibility_publication_id'),
  'hides persist through republication until explicit restoration');
select throws_ok($$select public.set_administrator_cottage_photo_hidden('30000000-0000-4000-8000-000000002401',
  current_setting('test.visibility_publication_id')::uuid, '40000000-0000-4000-8000-000000002401', false, 'Restore inspected old photo')$$,
  'RC409', null, 'a stale publication photo action cannot change a replacement publication');
select throws_ok($$select public.set_administrator_cottage_description_hidden('30000000-0000-4000-8000-000000002401',
  current_setting('test.visibility_publication_id')::uuid, false, 'Restore inspected old description')$$,
  'RC409', null, 'a stale publication description action cannot change a replacement publication');
select public.set_administrator_cottage_photo_hidden('30000000-0000-4000-8000-000000002401', current_setting('test.visibility_republished_id')::uuid,
  '40000000-0000-4000-8000-000000002401', false, 'Restore reviewed photo');
select public.set_administrator_cottage_description_hidden('30000000-0000-4000-8000-000000002401', current_setting('test.visibility_republished_id')::uuid,
  false, 'Restore reviewed description');
select ok(public.get_administrator_cottage_content_visibility('30000000-0000-4000-8000-000000002401') @>
  '{"descriptionHidden":false,"photos":[{"photoId":"40000000-0000-4000-8000-000000002401","hidden":false}]}'::jsonb,
  'explicit administrator restoration returns both content kinds to visible');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$select public.resolve_current_cottage_publication_media(current_setting('test.visibility_hidden_media')::uuid)$$,
  'RC204', null, 'restoring source content never revives a stale opaque publication ID');
reset role;
select is(jsonb_build_object(
  'snapshot', (select to_jsonb(row) from public.cottage_publication_snapshots row where id=current_setting('test.visibility_publication_id')::uuid),
  'localizations', (select jsonb_agg(to_jsonb(row) order by locale) from public.cottage_publication_localizations row where publication_id=current_setting('test.visibility_publication_id')::uuid),
  'media', (select jsonb_agg(to_jsonb(row) order by position) from public.cottage_publication_media row where publication_id=current_setting('test.visibility_publication_id')::uuid)
), current_setting('test.visibility_history')::jsonb - 'profile',
  'republication and restoration retain the complete previous immutable publication rows');
select is((select jsonb_agg(to_jsonb(a) order by id) from public.cottage_profile_administrator_audit a
    where event_kind in ('description_hidden','photo_hidden')),
  current_setting('test.visibility_prior_audit')::jsonb,
  'restoration appends events without rewriting prior visibility audit rows');
select is((select count(*) from public.cottage_profile_administrator_audit), 4::bigint,
  'two hides and two restorations produce exactly four attributed audit events');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select ok((select not description_hidden and description='Quiet cottage' and cardinality(media_ids)=2
  from public.get_current_cottage_publication('30000000-0000-4000-8000-000000002401','en')),
  'restoration exposes the reviewed text and both current photo identities');
reset role;
insert into public.owner_application_cottage_profiles(id,owner_user_id)
values ('30000000-0000-4000-8000-000000002499','00000000-0000-0000-0000-000000002401');
insert into public.cottage_profile_photos(id,profile_id,owner_user_id,actor_user_id,object_path,original_filename,media_type,size_bytes,state)
values ('40000000-0000-4000-8000-000000002499','30000000-0000-4000-8000-000000002499',
  '00000000-0000-0000-0000-000000002401','00000000-0000-0000-0000-000000002401','private/other/photo.webp','other.webp','image/webp',128,'ready');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$select public.set_administrator_cottage_photo_hidden('30000000-0000-4000-8000-000000002401',
  current_setting('test.visibility_republished_id')::uuid,'40000000-0000-4000-8000-000000002499', true,'Cross-profile attempt')$$,
  'RC204', null, 'a cross-profile photo is not current publication membership');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated"}', true);
select throws_ok($$select public.get_administrator_cottage_content_visibility('30000000-0000-4000-8000-000000002401')$$,
  '42501', null, 'missing assurance cannot read private visibility');
select throws_ok($$select public.set_administrator_cottage_photo_hidden('30000000-0000-4000-8000-000000002401',
  current_setting('test.visibility_republished_id')::uuid,'40000000-0000-4000-8000-000000002401', true,'Valid attempt')$$,
  '42501', null, 'missing assurance cannot change photo visibility');
reset role;
select ok(not has_function_privilege('anon','public.get_administrator_cottage_content_visibility(uuid)','execute')
  and not has_function_privilege('service_role','public.get_administrator_cottage_content_visibility(uuid)','execute')
  and not has_function_privilege('anon','public.set_administrator_cottage_description_hidden(uuid,uuid,boolean,text)','execute')
  and not has_function_privilege('service_role','public.set_administrator_cottage_description_hidden(uuid,uuid,boolean,text)','execute')
  and not has_function_privilege('anon','public.set_administrator_cottage_photo_hidden(uuid,uuid,uuid,boolean,text)','execute')
  and not has_function_privilege('service_role','public.set_administrator_cottage_photo_hidden(uuid,uuid,uuid,boolean,text)','execute'),
  'visibility RPC grants exclude anonymous and service-role access');
select * from finish();
rollback;
