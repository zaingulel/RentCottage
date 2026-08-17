begin;

create extension if not exists pgtap with schema extensions;

select plan(78);

insert into auth.users (
  id, aud, role, phone, phone_confirmed_at, email, email_confirmed_at
)
values
  ('00000000-0000-0000-0000-000000000701', 'authenticated', 'authenticated', '+9647500000701', now(), null, null),
  ('00000000-0000-0000-0000-000000000702', 'authenticated', 'authenticated', '+9647500000702', now(), null, null),
  ('00000000-0000-0000-0000-000000000703', 'authenticated', 'authenticated', '+9647500000703', now(), null, null),
  ('00000000-0000-0000-0000-000000000705', 'authenticated', 'authenticated', '+9647500000705', now(), null, null),
  ('00000000-0000-0000-0000-000000000704', 'authenticated', 'authenticated', null, null, 'cottage-reviewer@example.test', now());

insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000000701', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000000702', 'cottage_owner', 'prospective'),
  ('00000000-0000-0000-0000-000000000703', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000000705', 'customer', null),
  ('00000000-0000-0000-0000-000000000704', 'platform_administrator', null);

insert into public.owner_applications (
  id, owner_user_id, applicant_kind, legal_name, licensing_basis, status,
  submitted_at, review_started_at, review_due_at, decided_at
) values (
  '20000000-0000-4000-8000-000000000701',
  '00000000-0000-0000-0000-000000000701',
  'individual', 'Approved Owner', 'licence', 'approved', now(), now(), null,
  now()
), (
  '20000000-0000-4000-8000-000000000702',
  '00000000-0000-0000-0000-000000000702',
  'individual', 'Prospective Owner', 'licence', 'draft', null, null, null, null
);

insert into public.owner_application_cottage_profiles (
  application_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, amenities, description, house_rules
) values (
  '20000000-0000-4000-8000-000000000701', 'Application Cottage', 'Erbil',
  'Near Shaqlawa', 'Private application address', 8, 3, 2,
  array['garden', 'parking'], 'Application source description',
  'Application source rules'
), (
  '20000000-0000-4000-8000-000000000702', 'Prospective Cottage', 'Duhok',
  'Near Amedi', 'Private prospective address', 6, 2, 2,
  array['garden'], 'Prospective description', 'Prospective rules'
);

select throws_ok(
  $$delete from public.owner_applications
    where id = '20000000-0000-4000-8000-000000000701'$$,
  '23503', null,
  'an application cannot be deleted out from under its promoted Cottage Profile'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated","aal":"aal1"}',
  true
);

select results_eq(
  $$select name from public.list_owner_cottage_profiles() order by created_at, id$$,
  array['Application Cottage'::text],
  'approval exposes the exact application Cottage Profile in Owner Backoffice'
);

select lives_ok(
  $$select public.create_owner_cottage_profile_draft()$$,
  'an approved Cottage Owner can create another private draft'
);

select throws_ok(
  $$select public.update_owner_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    1, 'Half coordinate write', 'Erbil', 'Near Shaqlawa', 'Private address',
    36.408333, null, 'Directions', 10, 4, 3,
    array['wifi'], 'en', 'Description', 'Rules'
  )$$,
  '23514', null,
  'a Cottage Profile rejects latitude without longitude at the database boundary'
);

select throws_ok(
  $$select public.update_owner_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles
      where application_id is null and owner_user_id = auth.uid()),
    1, 'Half coordinate write', 'Erbil', 'Near Shaqlawa', 'Private address',
    null, 44.385834, 'Directions', 10, 4, 3,
    array['wifi'], 'en', 'Description', 'Rules'
  )$$,
  '23514', null,
  'a Cottage Profile rejects longitude without latitude at the database boundary'
);

select throws_ok(
  $$select public.apply_cottage_profile_working_copy(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    'Direct helper write', 'Erbil', 'Near Shaqlawa', 'Private address',
    36.408333, 44.385834, 'Directions', 10, 4, 3,
    array['wifi'], 'en', 'Description', 'Rules'
  )$$,
  '42501', null,
  'authenticated callers cannot bypass authorization wrappers through the working-copy helper'
);

select throws_ok(
  $$select public.update_owner_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    null, 'Null version write', 'Erbil', 'Near Shaqlawa', 'Private address',
    36.408333, 44.385834, 'Directions', 10, 4, 3,
    array['wifi'], 'en', 'Description', 'Rules'
  )$$,
  '22023', null,
  'an owner save rejects a null expected version at the database boundary'
);

select throws_ok(
  $$select public.update_owner_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    0, 'Non-positive version write', 'Erbil', 'Near Shaqlawa', 'Private address',
    36.408333, 44.385834, 'Directions', 10, 4, 3,
    array['wifi'], 'en', 'Description', 'Rules'
  )$$,
  '22023', null,
  'an owner save rejects a non-positive expected version at the database boundary'
);

select lives_ok(
  $$select public.update_owner_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    1, 'Continued Application Cottage', 'Erbil', 'Near Shaqlawa',
    'Private exact address', 36.408333, 44.385834,
    'Continue past the orchard gate.', 10, 4, 3,
    array['garden', 'parking', 'wifi'], 'en',
    'Owner working-copy description', 'Owner working-copy House Rules'
  )$$,
  'the approved owner completes the application-linked working copy in place'
);

select results_eq(
  $$select name, exact_address, exact_latitude, exact_longitude,
      private_directions, capacity, bedrooms, bathrooms, amenities,
      source_language::text, description, house_rules, version
    from public.owner_application_cottage_profiles
    where application_id = '20000000-0000-4000-8000-000000000701'$$,
  $$values (
    'Continued Application Cottage'::text, 'Private exact address'::text,
    36.408333::numeric, 44.385834::numeric,
    'Continue past the orchard gate.'::text, 10::smallint, 4::smallint,
    3::smallint, array['garden', 'parking', 'wifi']::text[], 'en'::text,
    'Owner working-copy description'::text,
    'Owner working-copy House Rules'::text, 2::bigint
  )$$,
  'the structured public and private fields are persisted with a new version'
);

select throws_ok(
  $$select public.update_owner_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    1, 'Stale write', 'Erbil', 'Near Shaqlawa', 'Stale private address',
    36.408333, 44.385834, 'Stale directions', 10, 4, 3,
    array['wifi'], 'en', 'Stale description', 'Stale rules'
  )$$,
  'RC409', null,
  'a stale draft update cannot overwrite the current owner working copy'
);

select lives_ok(
  $$select public.prepare_cottage_profile_photo_upload(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    'shaqlawa-cottage.webp', 'image/webp', 128
  )$$,
  'the authenticated owner prepares an exact private photo path before storage work'
);

select results_eq(
  $$select state::text, media_type, size_bytes,
      object_path ~ (
        '^00000000-0000-0000-0000-000000000701/' || profile_id::text
        || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
      )
    from public.cottage_profile_photos$$,
  $$values ('pending'::text, 'image/webp'::text, 128, true)$$,
  'photo metadata is pending at the non-overwriting server-generated path'
);

reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select public.cottage_profile_photo_bucket_name(), object_path, owner_user_id,
  jsonb_build_object('size', size_bytes, 'mimetype', media_type)
from public.cottage_profile_photos;
select set_config(
  'test.cottage_photo_id',
  (select id::text from public.cottage_profile_photos limit 1),
  true
);

set local role service_role;
select lives_ok(
  $$select public.register_cottage_profile_photo(
    current_setting('test.cottage_photo_id')::uuid
  )$$,
  'a matching private storage object reconciles the prepared photo to ready'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated","aal":"aal1"}',
  true
);
select results_eq(
  $$select state::text from public.cottage_profile_photos$$,
  array['ready'::text],
  'the owner observes only the durable ready photo state'
);

select lives_ok(
  $$select public.prepare_cottage_profile_photo_preview(
    current_setting('test.cottage_photo_id')::uuid
  )$$,
  'the owning account can prepare a short-lived private photo preview'
);
select set_config(
  'test.cottage_profile_id',
  (select id::text from public.owner_application_cottage_profiles
   where application_id = '20000000-0000-4000-8000-000000000701'),
  true
);

select throws_ok(
  $$update public.owner_application_cottage_profiles
    set name = 'Direct owner write'
    where application_id = '20000000-0000-4000-8000-000000000701'$$,
  '42501', null,
  'authenticated owners cannot write Cottage Profile tables directly'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000703","role":"authenticated","aal":"aal1"}',
  true
);
select results_eq(
  $$select
      (select count(*)::integer from public.owner_application_cottage_profiles),
      (select count(*)::integer from public.cottage_profile_photos)$$,
  $$values (0, 0)$$,
  'another approved owner sees no unpublished profiles or photos'
);

select throws_ok(
  $$select public.update_owner_cottage_profile_draft(
    current_setting('test.cottage_profile_id')::uuid, 2,
    'Other owner write', 'Erbil', 'Near Shaqlawa', 'Private address',
    36.408333, 44.385834, 'Directions', 10, 4, 3, array['garden'],
    'en', 'Description', 'Rules'
  )$$,
  '42501', null,
  'another owner cannot use the Cottage Profile update definer path'
);
select throws_ok(
  $$select public.submit_cottage_profile_for_content_approval(
    current_setting('test.cottage_profile_id')::uuid, 2
  )$$,
  '42501', null,
  'another owner cannot use the Cottage Profile submission definer path'
);
select throws_ok(
  $$select public.prepare_cottage_profile_photo_upload(
    current_setting('test.cottage_profile_id')::uuid,
    'other-owner.webp', 'image/webp', 128
  )$$,
  '42501', null,
  'another owner cannot use the Cottage Profile photo upload definer path'
);
select throws_ok(
  $$select public.prepare_cottage_profile_photo_preview(
    current_setting('test.cottage_photo_id')::uuid
  )$$,
  '42501', null,
  'another owner cannot use the Cottage Profile photo preview definer path'
);
select throws_ok(
  $$select public.prepare_cottage_profile_photo_deletion(
    current_setting('test.cottage_photo_id')::uuid
  )$$,
  '42501', null,
  'another owner cannot use the Cottage Profile photo deletion definer path'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000705","role":"authenticated","aal":"aal1"}',
  true
);
select results_eq(
  $$select
      (select count(*)::integer from public.owner_application_cottage_profiles),
      (select count(*)::integer from public.cottage_profile_photos)$$,
  $$values (0, 0)$$,
  'a Customer sees no unpublished profiles or photos'
);

select throws_ok(
  $$select public.update_owner_cottage_profile_draft(
    current_setting('test.cottage_profile_id')::uuid, 2,
    'Customer write', 'Erbil', 'Near Shaqlawa', 'Private address',
    36.408333, 44.385834, 'Directions', 10, 4, 3, array['garden'],
    'en', 'Description', 'Rules'
  )$$,
  '42501', null,
  'a Customer cannot use the Cottage Profile update definer path'
);
select throws_ok(
  $$select public.submit_cottage_profile_for_content_approval(
    current_setting('test.cottage_profile_id')::uuid, 2
  )$$,
  '42501', null,
  'a Customer cannot use the Cottage Profile submission definer path'
);
select throws_ok(
  $$select public.prepare_cottage_profile_photo_upload(
    current_setting('test.cottage_profile_id')::uuid,
    'customer.webp', 'image/webp', 128
  )$$,
  '42501', null,
  'a Customer cannot use the Cottage Profile photo upload definer path'
);
select throws_ok(
  $$select public.prepare_cottage_profile_photo_preview(
    current_setting('test.cottage_photo_id')::uuid
  )$$,
  '42501', null,
  'a Customer cannot use the Cottage Profile photo preview definer path'
);
select throws_ok(
  $$select public.prepare_cottage_profile_photo_deletion(
    current_setting('test.cottage_photo_id')::uuid
  )$$,
  '42501', null,
  'a Customer cannot use the Cottage Profile photo deletion definer path'
);

reset role;
set local role anon;
select throws_ok(
  $$select count(*) from public.owner_application_cottage_profiles$$,
  '42501', null,
  'anonymous access has no Cottage Profile table grant'
);

select throws_ok(
  $$select count(*) from public.cottage_profile_photos$$,
  '42501', null,
  'anonymous access has no Cottage Profile photo table grant'
);

select throws_ok(
  $$select count(*) from public.cottage_profile_source_revisions$$,
  '42501', null,
  'anonymous access has no submitted source table grant'
);

select throws_ok(
  $$select count(*) from public.cottage_profile_administrator_audit$$,
  '42501', null,
  'anonymous access has no administrator audit table grant'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated","aal":"aal1"}',
  true
);

select throws_ok(
  $$select public.submit_cottage_profile_for_content_approval(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    null
  )$$,
  '22023', null,
  'submission rejects a null expected version at the database boundary'
);

select throws_ok(
  $$select public.submit_cottage_profile_for_content_approval(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    -1
  )$$,
  '22023', null,
  'submission rejects a non-positive expected version at the database boundary'
);

reset role;
update public.owner_application_cottage_profiles
set amenities = '{}'
where application_id = '20000000-0000-4000-8000-000000000701';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated","aal":"aal1"}',
  true
);

select throws_ok(
  $$select public.submit_cottage_profile_for_content_approval(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    2
  )$$,
  'RC203', null,
  'submission requires at least one canonical Cottage Profile amenity'
);

select results_eq(
  $$select status::text, version, submitted_source_revision_id,
      (select count(*)::integer
       from public.cottage_profile_source_revisions revisions
       where revisions.profile_id = profiles.id)
    from public.owner_application_cottage_profiles profiles
    where application_id = '20000000-0000-4000-8000-000000000701'$$,
  $$values ('draft'::text, 2::bigint, null::uuid, 0)$$,
  'a rejected no-amenity submission rolls back status, version, and source history'
);

reset role;
update public.owner_application_cottage_profiles
set amenities = array['garden', 'parking', 'wifi']
where application_id = '20000000-0000-4000-8000-000000000701';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated","aal":"aal1"}',
  true
);

select lives_ok(
  $$select public.submit_cottage_profile_for_content_approval(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    2
  )$$,
  'a complete owned draft with a ready stored photo submits atomically'
);

select results_eq(
  $$select profiles.status::text, profiles.version, revisions.revision,
      revisions.owner_user_id = profiles.owner_user_id,
      revisions.source_language::text, revisions.description,
      revisions.house_rules
    from public.owner_application_cottage_profiles profiles
    join public.cottage_profile_source_revisions revisions
      on revisions.id = profiles.submitted_source_revision_id
    where profiles.application_id = '20000000-0000-4000-8000-000000000701'$$,
  $$values (
    'submitted_for_content_approval'::text, 3::bigint, 1,
    true, 'en'::text, 'Owner working-copy description'::text,
    'Owner working-copy House Rules'::text
  )$$,
  'submission binds the same cottage to its attributed immutable source revision'
);

select lives_ok(
  $$select public.submit_cottage_profile_for_content_approval(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    2
  )$$,
  'a repeated submission response is idempotent'
);

select results_eq(
  $$select count(*)::integer, max(revision)
    from public.cottage_profile_source_revisions
    where profile_id = (
      select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'
    )$$,
  $$values (1, 1)$$,
  'a repeated submission cannot duplicate or advance immutable source history'
);

select throws_ok(
  $$select public.update_owner_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    3, 'Changed after submission', 'Erbil', 'Near Shaqlawa',
    'Private exact address', 36.408333, 44.385834, 'Directions',
    10, 4, 3, array['wifi'], 'en', 'Changed source', 'Changed rules'
  )$$,
  'RC202', null,
  'owner working-copy edits freeze after Cottage Profile submission'
);

reset role;
select throws_ok(
  $$update public.cottage_profile_source_revisions
    set description = 'Mutated source'$$,
  'RC208', null,
  'submitted Cottage Profile source cannot be mutated'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000704","role":"authenticated","aal":"aal1"}',
  true
);
select is_empty(
  $$select id from public.owner_application_cottage_profiles$$,
  'an AAL1 administrator sees no private Cottage Profile rows'
);

select throws_ok(
  $$select public.update_administrator_cottage_profile(
    (select id from public.owner_application_cottage_profiles limit 1),
    3, 'AAL1 edit', 'Erbil', 'Near Shaqlawa', 'Private exact address',
    36.408333, 44.385834, 'Directions', 10, 4, 3, array['wifi'],
    'en', 'AAL1 description', 'AAL1 rules'
  )$$,
  '42501', null,
  'an AAL1 administrator cannot edit private Cottage Profile data'
);

select throws_ok(
  $$select public.submit_cottage_profile_for_content_approval(
    current_setting('test.cottage_profile_id')::uuid, 3
  )$$,
  '42501', null,
  'an AAL1 administrator cannot use the Cottage Profile submission definer path'
);
select throws_ok(
  $$select public.prepare_cottage_profile_photo_upload(
    current_setting('test.cottage_profile_id')::uuid,
    'aal1-administrator.webp', 'image/webp', 128
  )$$,
  '42501', null,
  'an AAL1 administrator cannot use the Cottage Profile photo upload definer path'
);
select throws_ok(
  $$select public.prepare_cottage_profile_photo_preview(
    current_setting('test.cottage_photo_id')::uuid
  )$$,
  '42501', null,
  'an AAL1 administrator cannot use the Cottage Profile photo preview definer path'
);
select throws_ok(
  $$select public.prepare_cottage_profile_photo_deletion(
    current_setting('test.cottage_photo_id')::uuid
  )$$,
  '42501', null,
  'an AAL1 administrator cannot use the Cottage Profile photo deletion definer path'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000704","role":"authenticated","aal":"aal2"}',
  true
);
select results_eq(
  $$select count(*)::integer from public.owner_application_cottage_profiles$$,
  array[3],
  'an AAL2 Platform Administrator can read every private Cottage Profile'
);

select throws_ok(
  $$select public.update_administrator_cottage_profile(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    null, 'Null administrator version', 'Erbil', 'Near Shaqlawa',
    'Private exact address', 36.408333, 44.385834, 'Directions',
    10, 4, 3, array['wifi'], 'en', 'Description', 'Rules'
  )$$,
  '22023', null,
  'administrator save rejects a null expected version at the database boundary'
);

select throws_ok(
  $$select public.update_administrator_cottage_profile(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    0, 'Non-positive administrator version', 'Erbil', 'Near Shaqlawa',
    'Private exact address', 36.408333, 44.385834, 'Directions',
    10, 4, 3, array['wifi'], 'en', 'Description', 'Rules'
  )$$,
  '22023', null,
  'administrator save rejects a non-positive expected version at the database boundary'
);

select throws_ok(
  $$select public.update_administrator_cottage_profile(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    3, 'Incomplete administrator copy', 'Erbil', 'Near Shaqlawa',
    'Private exact address', 36.408333, 44.385834, 'Directions',
    10, 4, 3, array['wifi'], null, 'Description', 'Rules'
  )$$,
  'RC203', null,
  'an administrator cannot make a submitted Cottage Profile incomplete'
);

select results_eq(
  $$select profiles.version, profiles.description,
      (select count(*)::integer
       from public.cottage_profile_administrator_audit audit
       where audit.profile_id = profiles.id)
    from public.owner_application_cottage_profiles profiles
    where profiles.application_id = '20000000-0000-4000-8000-000000000701'$$,
  $$values (3::bigint, 'Owner working-copy description'::text, 0)$$,
  'a rejected incomplete administrator edit rolls back its working copy and audit'
);

select lives_ok(
  $$select public.update_administrator_cottage_profile(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    3, 'Administrator working copy', 'Erbil', 'Near Shaqlawa',
    'Private exact address', 36.408333, 44.385834, 'Administrator directions',
    10, 4, 3, array['garden', 'wifi'], 'en',
    'Administrator working-copy description', 'Administrator working-copy rules'
  )$$,
  'an AAL2 Platform Administrator can edit the unpublished working copy'
);

select results_eq(
  $$select profiles.version, profiles.description, revisions.description,
      audit.administrator_user_id, audit.changed_fields
    from public.owner_application_cottage_profiles profiles
    join public.cottage_profile_source_revisions revisions
      on revisions.id = profiles.submitted_source_revision_id
    join public.cottage_profile_administrator_audit audit
      on audit.profile_id = profiles.id
    where profiles.application_id = '20000000-0000-4000-8000-000000000701'$$,
  $$values (
    4::bigint, 'Administrator working-copy description'::text,
    'Owner working-copy description'::text,
    '00000000-0000-0000-0000-000000000704'::uuid,
    array['name', 'private_directions', 'amenities', 'description',
      'house_rules']::text[]
  )$$,
  'administrator edits are attributed without changing submitted source'
);

select lives_ok(
  $$select public.update_administrator_cottage_profile(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    4, 'Administrator working copy', 'Erbil', 'Near Shaqlawa',
    'Private exact address', 36.408333, 44.385834,
    'Administrator directions', 10, 4, 3, array['garden', 'wifi'], 'en',
    'Administrator working-copy description',
    'Administrator working-copy rules'
  )$$,
  'an administrator no-op save remains a valid optimistic-concurrency action'
);

select results_eq(
  $$select changed_fields
    from public.cottage_profile_administrator_audit
    where previous_version = 4$$,
  $$values ('{}'::text[])$$,
  'an administrator no-op audit does not overstate changed fields'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated","aal":"aal1"}',
  true
);
select results_eq(
  $$select
      (select count(*)::integer from public.cottage_profile_photos),
      (select count(*)::integer from public.cottage_profile_source_revisions),
      (select count(*)::integer from public.cottage_profile_administrator_audit)$$,
  $$values (1, 1, 0)$$,
  'the owning account sees its photos and submitted source but no administrator audit'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000703","role":"authenticated","aal":"aal1"}',
  true
);
select results_eq(
  $$select
      (select count(*)::integer from public.cottage_profile_photos),
      (select count(*)::integer from public.cottage_profile_source_revisions),
      (select count(*)::integer from public.cottage_profile_administrator_audit)$$,
  $$values (0, 0, 0)$$,
  'another owner sees no Cottage Profile photos, submitted source, or administrator audit'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000705","role":"authenticated","aal":"aal1"}',
  true
);
select results_eq(
  $$select
      (select count(*)::integer from public.cottage_profile_photos),
      (select count(*)::integer from public.cottage_profile_source_revisions),
      (select count(*)::integer from public.cottage_profile_administrator_audit)$$,
  $$values (0, 0, 0)$$,
  'a Customer sees no Cottage Profile photos, submitted source, or administrator audit'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000704","role":"authenticated","aal":"aal1"}',
  true
);
select results_eq(
  $$select
      (select count(*)::integer from public.cottage_profile_photos),
      (select count(*)::integer from public.cottage_profile_source_revisions),
      (select count(*)::integer from public.cottage_profile_administrator_audit)$$,
  $$values (0, 0, 0)$$,
  'an AAL1 administrator sees no Cottage Profile photos, submitted source, or administrator audit'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000704","role":"authenticated","aal":"aal2"}',
  true
);
select results_eq(
  $$select
      (select count(*)::integer from public.cottage_profile_photos),
      (select count(*)::integer from public.cottage_profile_source_revisions),
      (select count(*)::integer from public.cottage_profile_administrator_audit)$$,
  $$values (1, 1, 2)$$,
  'an AAL2 administrator sees only the existing private photo, source, and attributed audit rows'
);

select lives_ok(
  $$select public.prepare_cottage_profile_photo_preview(
    current_setting('test.cottage_photo_id')::uuid
  )$$,
  'an AAL2 Platform Administrator can prepare a private photo preview'
);

select throws_ok(
  $$select public.prepare_cottage_profile_photo_deletion(
    current_setting('test.cottage_photo_id')::uuid
  )$$,
  'RC203', null,
  'a submitted Cottage Profile cannot lose its only ready photo'
);

select lives_ok(
  $$select public.prepare_cottage_profile_photo_upload(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    'shaqlawa-cottage-second.jpg', 'image/jpeg', 256
  )$$,
  'an AAL2 Platform Administrator can prepare a second submitted-profile photo'
);

select results_eq(
  $$select event_kind, administrator_user_id, previous_version,
      resulting_version, changed_fields, object_path is not null
    from public.cottage_profile_administrator_audit
    where event_kind = 'photo_upload_prepared'$$,
  $$values (
    'photo_upload_prepared'::text,
    '00000000-0000-0000-0000-000000000704'::uuid,
    5::bigint, 5::bigint, array['photos']::text[], true
  )$$,
  'administrator photo upload preparation appends an attributed audit event'
);

reset role;
select set_config(
  'test.cottage_second_photo_id',
  (select id::text from public.cottage_profile_photos
   where id <> current_setting('test.cottage_photo_id')::uuid),
  true
);
insert into storage.objects (bucket_id, name, owner_id, metadata)
select public.cottage_profile_photo_bucket_name(), object_path, owner_user_id,
  jsonb_build_object('size', size_bytes, 'mimetype', media_type)
from public.cottage_profile_photos
where id = current_setting('test.cottage_second_photo_id')::uuid;
set local role service_role;
select lives_ok(
  $$select public.register_cottage_profile_photo(
    current_setting('test.cottage_second_photo_id')::uuid
  )$$,
  'the second matching private object reconciles to ready'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000704","role":"authenticated","aal":"aal2"}',
  true
);
select lives_ok(
  $$select public.prepare_cottage_profile_photo_deletion(
    current_setting('test.cottage_photo_id')::uuid
  )$$,
  'an AAL2 Platform Administrator can remove one photo when another ready photo remains'
);

select results_eq(
  $$select audit.event_kind, audit.administrator_user_id,
      audit.previous_version, audit.resulting_version, audit.changed_fields,
      audit.object_path = photos.object_path
    from public.cottage_profile_administrator_audit audit
    join public.cottage_profile_photos photos
      on photos.id = current_setting('test.cottage_photo_id')::uuid
    where audit.event_kind = 'photo_deletion_prepared'$$,
  $$values (
    'photo_deletion_prepared'::text,
    '00000000-0000-0000-0000-000000000704'::uuid,
    5::bigint, 5::bigint, array['photos']::text[], true
  )$$,
  'administrator photo deletion preparation appends an attributed audit event'
);

select results_eq(
  $$select state::text from public.cottage_profile_photos
    where id = current_setting('test.cottage_photo_id')::uuid$$,
  array['deletion_pending'::text],
  'photo deletion remains durable until storage reconciliation completes'
);

reset role;
set local session_replication_role = replica;
delete from storage.objects
where bucket_id = public.cottage_profile_photo_bucket_name()
  and name = (
    select object_path from public.cottage_profile_photos
    where id = current_setting('test.cottage_photo_id')::uuid
  );
set local session_replication_role = origin;
set local role service_role;
select lives_ok(
  $$select public.complete_cottage_profile_photo_deletion(
    current_setting('test.cottage_photo_id')::uuid
  )$$,
  'service reconciliation completes only after the private object is absent'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000704","role":"authenticated","aal":"aal2"}',
  true
);
select is_empty(
  $$select id from public.cottage_profile_photos
    where id = current_setting('test.cottage_photo_id')::uuid$$,
  'completed photo deletion removes the reconciled metadata row'
);

select results_eq(
  $$select count(*)::integer, bool_and(object_path is not null)
    from public.cottage_profile_administrator_audit
    where event_kind in ('photo_upload_prepared', 'photo_deletion_prepared')$$,
  $$values (2, true)$$,
  'administrator photo audit events remain immutable after photo metadata deletion'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated","aal":"aal1"}',
  true
);

reset role;
update public.account_contexts
set owner_approval_state = 'expired'
where user_id = '00000000-0000-0000-0000-000000000701';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated","aal":"aal1"}',
  true
);

select throws_ok(
  $$select public.update_owner_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles
      where application_id = '20000000-0000-4000-8000-000000000701'),
    2, 'Expired write', 'Erbil', 'Near Shaqlawa', 'Private exact address',
    36.408333, 44.385834, 'Directions', 10, 4, 3,
    array['wifi'], 'en', 'Description', 'Rules'
  )$$,
  '42501', null,
  'an expired owner retains private read access but cannot change a draft'
);

reset role;
update public.account_contexts
set owner_approval_state = 'approved'
where user_id = '00000000-0000-0000-0000-000000000701';
set local role authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000702","role":"authenticated","aal":"aal1"}',
  true
);

select throws_ok(
  $$select public.list_owner_cottage_profiles()$$,
  '42501', null,
  'a prospective owner cannot use the approved Owner Backoffice list seam'
);

select results_eq(
  $$select count(*)::integer from public.owner_application_cottage_profiles$$,
  array[1],
  'a prospective owner can still read only the application-linked first profile'
);

select throws_ok(
  $$select public.create_owner_cottage_profile_draft()$$,
  '42501', null,
  'a prospective owner cannot use the approved-owner draft seam'
);

select * from finish();
rollback;
