begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000749', 'authenticated', 'authenticated', '+9647500000749', now()),
  ('00000000-0000-0000-0000-000000000750', 'authenticated', 'authenticated', '+9647500000750', now());
insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000000749', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000000750', 'cottage_owner', 'approved');

create temporary table progress_cases (id uuid, missing text);
grant all on progress_cases to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000749","role":"authenticated","aal":"aal1"}', true);
select set_config('test.progress_profile_id', (public.create_owner_cottage_profile_draft()).id::text, true);

select results_eq(
  $$select completed_requirements, next_requirement, submission_allowed
    from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$,
  $$values (0, 'name'::text, true)$$,
  'draft progress matches content submission requirements'
);

select public.update_owner_cottage_profile_draft(
  current_setting('test.progress_profile_id')::uuid, 1,
  'Cottage', 'Erbil', 'Near Shaqlawa', null, 36.4, 44.3, 'Private directions',
  8, 2, 1, array['garden'], 'en', 'Description', 'House Rules'
);
select results_eq(
  $$select profile_version, completed_requirements, next_requirement from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$,
  $$values (2::bigint, 12, 'photos'::text)$$,
  'all saved fields without photos complete twelve requirements'
);
select public.prepare_cottage_profile_photo_upload(current_setting('test.progress_profile_id')::uuid, 'cottage.webp', 'image/webp', 128);
select results_eq(
  $$select completed_requirements, next_requirement from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$,
  $$values (12, 'photos'::text)$$,
  'a pending upload never completes the photo requirement'
);

do $$
declare missing_key text;
declare profile public.owner_application_cottage_profiles;
begin
  foreach missing_key in array array['name', 'governorate', 'approximateLocation', 'capacity', 'bedrooms', 'bathrooms', 'amenities', 'exactPoint', 'privateDirections', 'sourceLanguage', 'description', 'houseRules', 'photos'] loop
    profile := public.create_owner_cottage_profile_draft();
    perform public.update_owner_cottage_profile_draft(
      profile.id, profile.version,
      case when missing_key = 'name' then null else 'Cottage' end,
      case when missing_key = 'governorate' then null else 'Erbil' end,
      case when missing_key = 'approximateLocation' then null else 'Near Shaqlawa' end,
      null,
      case when missing_key = 'exactPoint' then null else 36.4 end,
      case when missing_key = 'exactPoint' then null else 44.3 end,
      case when missing_key = 'privateDirections' then null else 'Private directions' end,
      case when missing_key = 'capacity' then null else 8 end,
      case when missing_key = 'bedrooms' then null else 2 end,
      case when missing_key = 'bathrooms' then null else 1 end,
      case when missing_key = 'amenities' then '{}'::text[] else array['garden'] end,
      case when missing_key = 'sourceLanguage' then null else 'en'::public.cottage_profile_source_language end,
      case when missing_key = 'description' then null else 'Description' end,
      case when missing_key = 'houseRules' then null else 'House Rules' end
    );
    insert into progress_cases values (profile.id, missing_key);
    if missing_key <> 'photos' then
      perform public.prepare_cottage_profile_photo_upload(profile.id, 'cottage.webp', 'image/webp', 128);
    end if;
  end loop;
end;
$$;

reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select public.cottage_profile_photo_bucket_name(), object_path, owner_user_id,
  jsonb_build_object('size', size_bytes, 'mimetype', media_type)
from public.cottage_profile_photos where owner_user_id = '00000000-0000-0000-0000-000000000749';
set local role service_role;
select public.register_cottage_profile_photo(id) from public.cottage_profile_photos
where owner_user_id = '00000000-0000-0000-0000-000000000749';
set local role authenticated;

select results_eq(
  $$select completed_requirements, next_requirement from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$,
  $$values (13, null::text)$$,
  'matching registered storage completes all thirteen requirements'
);
select results_eq(
  $$select report.completed_requirements, report.next_requirement
    from public.read_owner_cottage_profile_draft_progress((select array_agg(id) from progress_cases)) report
    order by report.next_requirement$$,
  $$select 12, missing from (values ('amenities'), ('approximateLocation'), ('bathrooms'), ('bedrooms'), ('capacity'), ('description'), ('exactPoint'), ('governorate'), ('houseRules'), ('name'), ('photos'), ('privateDirections'), ('sourceLanguage')) expected(missing) order by missing$$,
  'each missing requirement gives twelve and its exact next key'
);
select throws_ok(
  format('select public.submit_cottage_profile_for_content_approval(%L, 2)', id),
  'RC203', null, 'actual submission rejects the missing ' || missing || ' requirement'
) from progress_cases order by missing;
select public.update_owner_cottage_profile_draft(
  (select id from progress_cases where missing = 'capacity'), 2,
  'Cottage', 'Erbil', 'Near Shaqlawa', null, 36.4, 44.3, 'Private directions',
  null, 2, 1, '{}'::text[], null, 'Description', 'House Rules'
);
select results_eq(
  $$select completed_requirements, next_requirement from public.read_owner_cottage_profile_draft_progress(array[(select id from progress_cases where missing = 'capacity')])$$,
  $$values (10, 'capacity'::text)$$,
  'multiple missing requirements select the first in editor order'
);
select results_eq(
  $$select jsonb_object_keys(to_jsonb(report)) from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid]) report order by 1$$,
  $$values ('completed_requirements'::text), ('next_requirement'), ('profile_id'), ('profile_version'), ('submission_allowed')$$,
  'progress exposes only count, key, identity, version and permission facts'
);

select public.prepare_cottage_profile_photo_upload(current_setting('test.progress_profile_id')::uuid, 'second.webp', 'image/webp', 128);
select results_eq(
  $$select completed_requirements, next_requirement from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$,
  $$values (12, 'photos'::text)$$,
  'one ready photo plus one pending photo remains incomplete'
);
select public.prepare_cottage_profile_photo_deletion(id) from public.cottage_profile_photos
where profile_id = current_setting('test.progress_profile_id')::uuid and original_filename = 'second.webp';
select results_eq(
  $$select completed_requirements, next_requirement from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$,
  $$values (12, 'photos'::text)$$,
  'a deletion-pending active photo remains incomplete'
);
reset role;
set local role service_role;
select public.complete_cottage_profile_photo_deletion(id) from public.cottage_profile_photos
where profile_id = current_setting('test.progress_profile_id')::uuid and original_filename = 'second.webp';
reset role;

create temporary table progress_object_backup as
select * from storage.objects where name = (select object_path from public.cottage_profile_photos where profile_id = current_setting('test.progress_profile_id')::uuid);
update storage.objects set metadata = '{"size":128,"mimetype":"image/jpeg"}' where id in (select id from progress_object_backup);
set local role authenticated;
select results_eq(
  $$select completed_requirements, next_requirement from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$,
  $$values (12, 'photos'::text)$$,
  'a ready row with mismatched stored MIME type remains incomplete'
);
reset role;
update storage.objects set metadata = '{"size":127,"mimetype":"image/webp"}' where id in (select id from progress_object_backup);
set local role authenticated;
select results_eq(
  $$select completed_requirements, next_requirement from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$,
  $$values (12, 'photos'::text)$$,
  'a ready row with mismatched stored byte size remains incomplete'
);
reset role;
update storage.objects set metadata = '{"size":"invalid","mimetype":"image/webp"}' where id in (select id from progress_object_backup);
set local role authenticated;
select results_eq(
  $$select completed_requirements, next_requirement from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$,
  $$values (12, 'photos'::text)$$,
  'malformed stored size never becomes ready'
);
reset role;
update storage.objects set name = name || '.missing' where id in (select id from progress_object_backup);
set local role authenticated;
select results_eq(
  $$select completed_requirements, next_requirement from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$,
  $$values (12, 'photos'::text)$$,
  'a missing stored object never becomes ready'
);
reset role;
update storage.objects objects set name = backup.name, metadata = backup.metadata
from progress_object_backup backup where objects.id = backup.id;
set local role authenticated;

select is_empty($$select * from public.read_owner_cottage_profile_draft_progress('{}'::uuid[])$$, 'an empty request returns no rows');
select throws_ok($$select * from public.read_owner_cottage_profile_draft_progress(null)$$, '22023', null, 'null arrays are invalid');
select throws_ok($$select * from public.read_owner_cottage_profile_draft_progress(array[null::uuid])$$, '22023', null, 'null identifiers are invalid');
select throws_ok($$select * from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid,current_setting('test.progress_profile_id')::uuid])$$, '22023', null, 'duplicate identifiers are invalid');
select throws_ok($$select * from public.read_owner_cottage_profile_draft_progress(array[[current_setting('test.progress_profile_id')::uuid]])$$, '22023', null, 'multidimensional arrays are invalid');
select throws_ok($$select * from public.read_owner_cottage_profile_draft_progress(array(select ('70000000-0000-4000-8000-' || lpad(value::text,12,'0'))::uuid from generate_series(1,101) value))$$, '22023', null, 'more than one hundred identifiers are invalid');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000750","role":"authenticated","aal":"aal1"}', true);
select set_config('test.foreign_progress_id', (public.create_owner_cottage_profile_draft()).id::text, true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000749","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select * from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.foreign_progress_id')::uuid])$$,
  '42501', 'Cottage Profile access is denied',
  'draft progress is visible only to its owning permitted account'
);
select throws_ok($$select * from private.read_owner_cottage_profile_draft_progress(array[current_setting('test.foreign_progress_id')::uuid])$$, '42501', 'Cottage Profile access is denied', 'direct private calls enforce ownership');
select throws_ok($$select * from public.read_owner_cottage_profile_draft_progress(array['70000000-0000-4000-8000-000000000000'::uuid])$$, '42501', 'Cottage Profile access is denied', 'missing identifiers receive the same denial as foreign identifiers');
select throws_ok($$select * from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid,current_setting('test.foreign_progress_id')::uuid])$$, '42501', 'Cottage Profile access is denied', 'a mixed batch fails atomically');

reset role;
update public.account_contexts set owner_approval_state = 'expired' where user_id = '00000000-0000-0000-0000-000000000749';
set local role authenticated;
select results_eq($$select completed_requirements, submission_allowed from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$, $$values (13, false)$$, 'expired owners may read progress without submission permission');
reset role;
update public.account_contexts set owner_approval_state = 'suspended' where user_id = '00000000-0000-0000-0000-000000000749';
set local role authenticated;
select results_eq($$select completed_requirements, submission_allowed from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$, $$values (13, false)$$, 'suspended owners may read progress without submission permission');

reset role;
update public.account_contexts set owner_approval_state = 'prospective' where user_id = '00000000-0000-0000-0000-000000000749';
set local role authenticated;
select throws_ok($$select * from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$, '42501', null, 'prospective owners cannot read draft progress');
reset role;
update public.account_contexts set role = 'customer', owner_approval_state = null where user_id = '00000000-0000-0000-0000-000000000749';
set local role authenticated;
select throws_ok($$select * from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$, '42501', null, 'customers cannot read draft progress');
reset role;
update public.account_contexts set role = 'platform_administrator' where user_id = '00000000-0000-0000-0000-000000000749';
set local role authenticated;
select throws_ok($$select * from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$, '42501', null, 'administrators cannot read owner draft progress');
reset role;
update public.account_contexts set role = 'cottage_owner', owner_approval_state = 'approved' where user_id = '00000000-0000-0000-0000-000000000749';

select ok(not has_schema_privilege('authenticated', 'private', 'CREATE') and has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated can use but cannot create private objects');
select ok(not has_function_privilege(denied.role, namespace.name || '.read_owner_cottage_profile_draft_progress(uuid[])', 'EXECUTE'), denied.role || ' cannot execute ' || namespace.name || ' progress')
from (values ('anon'), ('service_role')) denied(role) cross join (values ('public'), ('private')) namespace(name);
select ok(not exists (select 1 from pg_proc functions cross join lateral aclexplode(coalesce(functions.proacl, acldefault('f', functions.proowner))) privilege where functions.oid in ('public.read_owner_cottage_profile_draft_progress(uuid[])'::regprocedure, 'private.read_owner_cottage_profile_draft_progress(uuid[])'::regprocedure) and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'), 'PUBLIC has no progress execute grant');
select ok((select prosecdef and provolatile = 's' and proconfig = array['search_path=""'] from pg_proc where oid = 'private.read_owner_cottage_profile_draft_progress(uuid[])'::regprocedure), 'private progress is stable with a restricted definer search path');
select ok((select not prosecdef and provolatile = 's' and proconfig = array['search_path=""'] from pg_proc where oid = 'public.read_owner_cottage_profile_draft_progress(uuid[])'::regprocedure), 'public progress is a stable invoker with restricted search path');
set local role anon;
select throws_ok($$select * from public.read_owner_cottage_profile_draft_progress('{}'::uuid[])$$, '42501', null, 'anonymous calls are denied');
set local role service_role;
select throws_ok($$select * from public.read_owner_cottage_profile_draft_progress('{}'::uuid[])$$, '42501', null, 'service-role calls are denied');
set local role authenticated;
select lives_ok($$select public.submit_cottage_profile_for_content_approval(current_setting('test.progress_profile_id')::uuid, 2)$$, 'actual submission succeeds only for the complete approved fixture');
select is_empty($$select * from public.read_owner_cottage_profile_draft_progress(array[current_setting('test.progress_profile_id')::uuid])$$, 'submitted profiles return no draft progress');
select public.abandon_owner_cottage_profile_draft(id, 2) from progress_cases where missing = 'photos';
select is_empty($$select * from public.read_owner_cottage_profile_draft_progress(array[(select id from progress_cases where missing = 'photos')])$$, 'abandoned profiles return no draft progress');

select * from finish();
rollback;
