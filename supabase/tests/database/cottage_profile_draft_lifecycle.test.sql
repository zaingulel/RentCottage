begin;

create extension if not exists pgtap with schema extensions;
select plan(60);

select enum_has_labels(
  'public', 'cottage_profile_status',
  array['draft', 'submitted_for_content_approval', 'abandoned'],
  'Cottage Profile status includes the soft-abandoned lifecycle state'
);

insert into auth.users (id, aud, role, phone, phone_confirmed_at, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000871', 'authenticated', 'authenticated', '+9647500000871', now(), null, null),
  ('00000000-0000-0000-0000-000000000872', 'authenticated', 'authenticated', '+9647500000872', now(), null, null),
  ('00000000-0000-0000-0000-000000000873', 'authenticated', 'authenticated', '+9647500000873', now(), null, null),
  ('00000000-0000-0000-0000-000000000874', 'authenticated', 'authenticated', '+9647500000874', now(), null, null),
  ('00000000-0000-0000-0000-000000000875', 'authenticated', 'authenticated', '+9647500000875', now(), null, null),
  ('00000000-0000-0000-0000-000000000876', 'authenticated', 'authenticated', '+9647500000876', now(), null, null),
  ('00000000-0000-0000-0000-000000000877', 'authenticated', 'authenticated', '+9647500000877', now(), null, null),
  ('00000000-0000-0000-0000-000000000878', 'authenticated', 'authenticated', '+9647500000878', now(), null, null),
  ('00000000-0000-0000-0000-000000000879', 'authenticated', 'authenticated', null, null, 'draft-lifecycle-admin@example.test', now());

insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000000871', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000000872', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000000873', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000000874', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000000875', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000000876', 'cottage_owner', 'expired'),
  ('00000000-0000-0000-0000-000000000877', 'cottage_owner', 'suspended'),
  ('00000000-0000-0000-0000-000000000878', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000000879', 'platform_administrator', null);

insert into public.owner_applications (
  id, owner_user_id, applicant_kind, legal_name, licensing_basis, status,
  submitted_at, review_started_at, decided_at
)
select
  ('28000000-0000-4000-8000-0000000008' || suffix)::uuid,
  ('00000000-0000-0000-0000-0000000008' || suffix)::uuid,
  'individual', 'Lifecycle Owner ' || suffix, 'licence', 'approved', now(), now(), now()
from unnest(array['71', '72', '73', '74', '75', '76', '77', '78']) suffix;

insert into public.owner_application_cottage_profiles (application_id, name)
select
  ('28000000-0000-4000-8000-0000000008' || suffix)::uuid,
  'Application Cottage ' || suffix
from unnest(array['71', '72', '73', '74', '75', '76', '77', '78']) suffix;

insert into public.owner_application_cottage_profiles (owner_user_id)
select '00000000-0000-0000-0000-000000000871'::uuid from generate_series(1, 18);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000871","role":"authenticated","aal":"aal1"}', true);

select is(
  (select count(*)::integer from public.owner_application_cottage_profiles
    where owner_user_id = auth.uid() and current_publication_id is null and status <> 'abandoned'),
  19, 'the application-linked first profile counts toward open capacity'
);
select lives_ok(
  $$select public.create_owner_cottage_profile_draft()$$,
  'creation succeeds immediately below the exact 20-profile open limit'
);
select is(
  (select count(*)::integer from public.owner_application_cottage_profiles
    where owner_user_id = auth.uid() and current_publication_id is null and status <> 'abandoned'),
  20, 'the successful creation reaches exactly 20 open profiles'
);
select throws_ok(
  $$select public.create_owner_cottage_profile_draft()$$,
  'RC420', null, 'creation above the open-profile limit has a stable capacity code'
);
select is(
  (select count(*)::integer from public.owner_application_cottage_profiles
    where owner_user_id = auth.uid()),
  20, 'a refused capacity creation leaves no row behind'
);

reset role;
insert into public.owner_application_cottage_profiles (
  owner_user_id, status, created_at, abandoned_at
)
select '00000000-0000-0000-0000-000000000872', 'abandoned', now(), now()
from generate_series(1, 20);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000872","role":"authenticated","aal":"aal1"}', true);

select is(
  (select count(*)::integer from public.owner_application_cottage_profiles
    where owner_user_id = auth.uid() and application_id is null
      and created_at > now() - interval '24 hours'),
  20, 'abandoned additional profiles still count toward the rolling creation rate'
);
select is(
  (select count(*)::integer from public.owner_application_cottage_profiles
    where owner_user_id = auth.uid() and current_publication_id is null and status <> 'abandoned'),
  1, 'abandoned profiles release open capacity'
);
select throws_ok(
  $$select public.create_owner_cottage_profile_draft()$$,
  'RC429', null, 'a rate-only refusal has its own stable database code'
);

reset role;
insert into public.owner_application_cottage_profiles (owner_user_id)
select '00000000-0000-0000-0000-000000000873' from generate_series(1, 20);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000873","role":"authenticated","aal":"aal1"}', true);
select is(
  (select count(*)::integer from public.owner_application_cottage_profiles where owner_user_id = auth.uid()),
  21, '21 legacy open profiles remain preserved above the new limit'
);
select throws_ok(
  $$select public.create_owner_cottage_profile_draft()$$,
  'RC420', null, 'a legacy over-limit owner cannot create another profile'
);
select is(
  (select count(*)::integer from public.owner_application_cottage_profiles where owner_user_id = auth.uid()),
  21, 'capacity enforcement does not rewrite legacy rows'
);

reset role;
insert into public.owner_application_cottage_profiles (
  owner_user_id, name, governorate, approximate_location, exact_address,
  exact_latitude, exact_longitude, private_directions, capacity, bedrooms,
  bathrooms, amenities, source_language, description, house_rules
) values (
  '00000000-0000-0000-0000-000000000874', 'Additional lifecycle draft',
  'Erbil', 'Shaqlawa', 'Private orchard gate', 36.4, 44.3,
  'Turn after the old bridge', 6, 3, 2, array['garden', 'wifi'], 'en',
  'Preserved private description', 'Preserved private rules'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000874","role":"authenticated","aal":"aal1"}', true);
select lives_ok(
  $$select public.replace_cottage_shift_schedule(
    (select id from public.owner_application_cottage_profiles where owner_user_id = auth.uid() and application_id is null),
    0, '[{"name":"Morning","startTime":"08:00","endTime":"12:00"},{"name":"Evening","startTime":"18:00","endTime":"23:00"}]'
  )$$,
  'the active draft has a Shift Schedule before abandonment'
);
reset role;
insert into public.cottage_profile_photos (
  profile_id, owner_user_id, actor_user_id, object_path, original_filename,
  media_type, size_bytes, state
) select id, owner_user_id, owner_user_id,
  owner_user_id::text || '/' || id::text || '/ready.webp',
  'ready.webp', 'image/webp', 128, 'pending'
from public.owner_application_cottage_profiles
where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000874","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.abandon_owner_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = auth.uid() and application_id is null), 1
  )$$,
  'RC202', null, 'pending photo upload blocks abandonment'
);
reset role;
update public.cottage_profile_photos set state = 'deletion_pending'
where owner_user_id = '00000000-0000-0000-0000-000000000874';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000874","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.abandon_owner_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = auth.uid() and application_id is null), 1
  )$$,
  'RC202', null, 'deletion-pending photo blocks abandonment'
);
reset role;
update public.cottage_profile_photos set state = 'ready'
where owner_user_id = '00000000-0000-0000-0000-000000000874';
insert into storage.objects (bucket_id, name, owner_id, metadata)
select public.cottage_profile_photo_bucket_name(), object_path, owner_user_id,
  jsonb_build_object('size', size_bytes, 'mimetype', media_type)
from public.cottage_profile_photos
where owner_user_id = '00000000-0000-0000-0000-000000000874';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000874","role":"authenticated","aal":"aal1"}', true);
select lives_ok(
  $$select public.abandon_owner_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = auth.uid() and application_id is null), 1
  )$$,
  'an approved owner can soft-abandon an additional unpublished draft'
);
select results_eq(
  $$select status::text, version, abandoned_at is not null,
      abandoned_at = updated_at
    from public.owner_application_cottage_profiles
    where owner_user_id = auth.uid() and application_id is null$$,
  $$values ('abandoned'::text, 2::bigint, true, true)$$,
  'abandonment preserves the row, timestamps it, and increments version once'
);
select throws_ok(
  $$select public.abandon_owner_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = auth.uid() and application_id is not null), 1
  )$$,
  'RC202', null, 'the application-linked first profile cannot be abandoned'
);
select throws_ok(
  $$select public.update_owner_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = auth.uid() and application_id is null),
    2, 'Bypass', '', '', '', null, null, '', null, null, null, '{}', null, '', ''
  )$$,
  'RC202', null, 'owner profile edits fail closed after abandonment'
);
select throws_ok(
  $$select public.prepare_cottage_profile_photo_upload(
    (select id from public.owner_application_cottage_profiles where owner_user_id = auth.uid() and application_id is null),
    'blocked.webp', 'image/webp', 128
  )$$,
  '42501', null, 'photo mutation fails closed after abandonment'
);
select throws_ok(
  $$select public.replace_cottage_shift_schedule(
    (select id from public.owner_application_cottage_profiles where owner_user_id = auth.uid() and application_id is null),
    1, '[{"name":"Morning","startTime":"09:00","endTime":"13:00"},{"name":"Evening","startTime":"18:00","endTime":"23:00"}]'
  )$$,
  'RC202', null, 'Shift Schedule mutation fails closed after abandonment'
);
select throws_ok(
  $$select public.save_cottage_inventory_pricing(
    (select id from public.owner_application_cottage_profiles where owner_user_id = auth.uid() and application_id is null),
    (select current_shift_schedule_id from public.owner_application_cottage_profiles where owner_user_id = auth.uid() and application_id is null),
    '{}'
  )$$,
  'RC202', null, 'pricing mutation fails closed after abandonment'
);
select throws_ok(
  $$select public.set_cottage_inventory_availability(
    (select id from public.owner_application_cottage_profiles where owner_user_id = auth.uid() and application_id is null),
    (select current_shift_schedule_id from public.owner_application_cottage_profiles where owner_user_id = auth.uid() and application_id is null),
    current_date + 7, '[]'
  )$$,
  'RC202', null, 'availability mutation fails closed after abandonment'
);
select set_config(
  'rentcottage.cottage_profile_lifecycle_id',
  (select id::text from public.owner_application_cottage_profiles
    where owner_user_id = auth.uid() and application_id is null), true
);
select throws_ok(
  $$select public.submit_cottage_profile_for_content_approval(
    (select id from public.owner_application_cottage_profiles where owner_user_id = auth.uid() and application_id is null), 2
  )$$,
  'RC202', null, 'an authenticated owner cannot use a custom GUC to submit an abandoned profile'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000879","role":"authenticated","aal":"aal2"}', true);
select set_config(
  'rentcottage.cottage_profile_lifecycle_id',
  (select id::text from public.owner_application_cottage_profiles
    where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null), true
);
select throws_ok(
  $$select public.update_administrator_cottage_profile(
    (select id from public.owner_application_cottage_profiles where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null),
    2, 'Bypass edit', 'Erbil', 'Shaqlawa', 'Private orchard gate', 36.4, 44.3,
    'Turn after the old bridge', 6, 3, 2, array['garden', 'wifi'], 'en',
    'Preserved private description', 'Preserved private rules'
  )$$,
  'RC202', null, 'an AAL2 administrator cannot use a custom GUC to edit an abandoned profile'
);
select throws_ok(
  $$select public.restore_administrator_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null),
    2, '   '
  )$$,
  '22023', null, 'an administrator lifecycle reason must be nonblank'
);
select lives_ok(
  $$select public.restore_administrator_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null),
    2, '  Owner confirmed restoration  '
  )$$,
  'an AAL2 administrator can restore an eligible abandoned draft'
);
select results_eq(
  $$select status::text, version from public.owner_application_cottage_profiles
    where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null$$,
  $$values ('draft'::text, 3::bigint)$$,
  'administrator restoration returns the profile to draft with version plus one'
);
select results_eq(
  $$select name, exact_address, private_directions, description, house_rules,
      abandoned_at is null,
      (select count(*) from public.cottage_profile_photos photos
        where photos.profile_id = profiles.id and photos.state = 'ready')::integer,
      (select count(*) from public.cottage_shift_schedule_revisions revisions
        where revisions.profile_id = profiles.id)::integer,
      (select count(*) from public.cottage_shifts shifts
        where shifts.schedule_revision_id = profiles.current_shift_schedule_id)::integer
    from public.owner_application_cottage_profiles profiles
    where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null$$,
  $$values ('Additional lifecycle draft'::text, 'Private orchard gate'::text,
    'Turn after the old bridge'::text, 'Preserved private description'::text,
    'Preserved private rules'::text, true, 1, 1, 2)$$,
  'abandon and restore preserve private content, ready photos, and Shift Schedule history'
);
select results_eq(
  $$select event_kind, lifecycle_reason, previous_status::text, resulting_status::text,
      previous_version, resulting_version, changed_fields
    from public.cottage_profile_administrator_audit
    where profile_id = (select id from public.owner_application_cottage_profiles
      where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null)$$,
  $$values ('draft_restored'::text, 'Owner confirmed restoration'::text,
    'abandoned'::text, 'draft'::text, 2::bigint, 3::bigint, array['status']::text[])$$,
  'administrator restoration records the trimmed reason and exact atomic transition'
);
select lives_ok(
  $$select public.abandon_administrator_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null),
    3, 'Duplicate draft'
  )$$,
  'an AAL2 administrator can abandon the same eligible draft'
);
select is(
  (select count(*)::integer from public.cottage_profile_administrator_audit
    where profile_id = (select id from public.owner_application_cottage_profiles
      where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null)
      and event_kind in ('draft_abandoned', 'draft_restored')),
  2, 'each administrator lifecycle change has one audit record'
);

select throws_ok(
  $$select public.abandon_administrator_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null),
    4, 'Repeated transition'
  )$$,
  'RC202', null, 'a repeated administrator transition is refused'
);
select throws_ok(
  $$select public.restore_administrator_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null),
    4, null
  )$$,
  '22023', null, 'a null administrator lifecycle reason is refused'
);
select throws_ok(
  $$select public.restore_administrator_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null),
    4, E'\t\n\r '
  )$$,
  '22023', null, 'a PostgreSQL-whitespace-only lifecycle reason is refused'
);
select throws_ok(
  $$select public.restore_administrator_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null),
    4, repeat('x', 1001)
  )$$,
  '22023', null, 'a 1001-character lifecycle reason is refused'
);
select is(
  (select count(*)::integer from public.cottage_profile_administrator_audit
    where profile_id = (select id from public.owner_application_cottage_profiles
      where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null)
      and event_kind in ('draft_abandoned', 'draft_restored')),
  2, 'failed and repeated lifecycle transitions create no audit records'
);
select lives_ok(
  $$select public.restore_administrator_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null),
    4, 'x'
  )$$,
  'a one-character canonical administrator reason is accepted'
);
select lives_ok(
  $$select public.abandon_administrator_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null),
    5, repeat('y', 1000)
  )$$,
  'a 1000-character canonical administrator reason is accepted'
);
select lives_ok(
  $$select public.restore_administrator_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null),
    6, E'\t Canonical reason \n'
  )$$,
  'surrounding PostgreSQL whitespace is canonicalized before storage'
);
select results_eq(
  $$select lifecycle_reason, administrator_user_id, occurred_at is not null,
      previous_version, resulting_version, previous_status::text, resulting_status::text
    from public.cottage_profile_administrator_audit
    where profile_id = (select id from public.owner_application_cottage_profiles
      where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null)
      and resulting_version = 7$$,
  $$values ('Canonical reason'::text, '00000000-0000-0000-0000-000000000879'::uuid,
    true, 6::bigint, 7::bigint, 'abandoned'::text, 'draft'::text)$$,
  'audit records canonical reason, actor, timestamp, exact versions and statuses'
);
reset role;
select throws_ok(
  $$insert into public.cottage_profile_administrator_audit (
      profile_id, administrator_user_id, previous_version, resulting_version,
      changed_fields, event_kind
    ) values (
      (select id from public.owner_application_cottage_profiles where owner_user_id = '00000000-0000-0000-0000-000000000874' and application_id is null),
      '00000000-0000-0000-0000-000000000879', 7, 8,
      array['status'], 'draft_abandoned'
    )$$,
  '23514', null, 'audit constraints reject lifecycle events with null lifecycle fields'
);

reset role;
insert into public.owner_application_cottage_profiles (id, owner_user_id, name)
values
  ('38000000-0000-4000-8000-000000000875', '00000000-0000-0000-0000-000000000875', 'Cross-owner draft'),
  ('38000000-0000-4000-8000-000000000876', '00000000-0000-0000-0000-000000000876', 'Expired-owner draft');
insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, status, abandoned_at, updated_at
) values (
  '38000000-0000-4000-8000-000000000877', '00000000-0000-0000-0000-000000000877',
  'Suspended-owner abandoned draft', 'abandoned', statement_timestamp(), statement_timestamp()
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000874","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.abandon_owner_cottage_profile_draft('38000000-0000-4000-8000-000000000875', 1)$$,
  '42501', null, 'an owner cannot abandon another owner profile'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000876","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.abandon_owner_cottage_profile_draft('38000000-0000-4000-8000-000000000876', 1)$$,
  '42501', null, 'an expired owner cannot abandon a draft'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000877","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.create_owner_cottage_profile_draft()$$,
  '42501', null, 'a suspended owner cannot create a draft'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000879","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.abandon_administrator_cottage_profile_draft(
    '38000000-0000-4000-8000-000000000875', 1, 'AAL1 bypass'
  )$$,
  '42501', null, 'an AAL1 administrator cannot abandon a draft'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000879","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.abandon_administrator_cottage_profile_draft(
    '38000000-0000-4000-8000-000000000876', 1, 'Expired owner'
  )$$,
  'RC202', null, 'an administrator cannot abandon an expired-owner draft'
);
select throws_ok(
  $$select public.restore_administrator_cottage_profile_draft(
    '38000000-0000-4000-8000-000000000877', 1, 'Suspended owner'
  )$$,
  'RC202', null, 'an administrator cannot restore a suspended-owner draft'
);
select throws_ok(
  $$select public.abandon_administrator_cottage_profile_draft(
    '38000000-0000-4000-8000-000000000875', 2, 'Stale administrator version'
  )$$,
  'RC409', null, 'an administrator cannot abandon with a stale expected version'
);
select throws_ok(
  $$select public.abandon_administrator_cottage_profile_draft(
    (select id from public.owner_application_cottage_profiles
      where application_id = '28000000-0000-4000-8000-000000000875'),
    1, 'Application-linked first profile'
  )$$,
  'RC202', null, 'an administrator cannot abandon an application-linked first profile'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000875","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.abandon_owner_cottage_profile_draft('38000000-0000-4000-8000-000000000875', 2)$$,
  'RC409', null, 'a stale lifecycle version is refused'
);

reset role;
insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  exact_latitude, exact_longitude, private_directions, capacity, bedrooms,
  bathrooms, amenities, source_language, description, house_rules
) values
  ('38000000-0000-4000-8000-000000000881', '00000000-0000-0000-0000-000000000878',
    'Submitted additional', 'Erbil', 'Shaqlawa', 'Private submitted address',
    36.4, 44.3, 'Submitted directions', 4, 2, 1, array['garden'], 'en',
    'Submitted description', 'Submitted rules'),
  ('38000000-0000-4000-8000-000000000882', '00000000-0000-0000-0000-000000000878',
    'Published additional', 'Erbil', 'Shaqlawa', 'Private published address',
    36.4, 44.3, 'Published directions', 4, 2, 1, array['garden'], 'en',
    'Published description', 'Published rules');
insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules, revision
) values
  ('38000000-0000-4000-8000-000000000981', '38000000-0000-4000-8000-000000000881', '00000000-0000-0000-0000-000000000878', 'en', 'Submitted description', 'Submitted rules', 1),
  ('38000000-0000-4000-8000-000000000982', '38000000-0000-4000-8000-000000000882', '00000000-0000-0000-0000-000000000878', 'en', 'Published description', 'Published rules', 1);
update public.owner_application_cottage_profiles
set status = 'submitted_for_content_approval',
    submitted_source_revision_id = '38000000-0000-4000-8000-000000000981'
where id = '38000000-0000-4000-8000-000000000881';
insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities, cycle_number,
  state, decided_at
) values (
  '38000000-0000-4000-8000-000000001082', '38000000-0000-4000-8000-000000000882',
  '00000000-0000-0000-0000-000000000878', '38000000-0000-4000-8000-000000000982',
  'Published additional', 'Erbil', 'Shaqlawa', 4, 2, 1, array['garden'], 1,
  'approved', now()
);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
) values (
  '38000000-0000-4000-8000-000000001182', '38000000-0000-4000-8000-000000000882',
  '38000000-0000-4000-8000-000000001082', 1, 'Published additional',
  'Erbil', 'Shaqlawa', 4, 2, 1, array['garden']
);
insert into public.cottage_shift_schedule_revisions (
  id, profile_id, revision, full_day_bundle_id
) values (
  '38000000-0000-4000-8000-000000001282',
  '38000000-0000-4000-8000-000000000882', 1,
  '38000000-0000-4000-8000-000000001382'
);
select set_config(
  'rentcottage.shift_schedule_write_revision_id',
  '38000000-0000-4000-8000-000000001282', true
);
insert into public.cottage_shifts (
  schedule_revision_id, position, name, start_time, end_time
) values
  ('38000000-0000-4000-8000-000000001282', 1, 'Morning', '08:00', '12:00'),
  ('38000000-0000-4000-8000-000000001282', 2, 'Evening', '18:00', '22:00');
update public.owner_application_cottage_profiles
set current_publication_id = '38000000-0000-4000-8000-000000001182',
    current_shift_schedule_id = '38000000-0000-4000-8000-000000001282'
where id = '38000000-0000-4000-8000-000000000882';
select throws_ok(
  $$update public.owner_application_cottage_profiles
    set abandoned_at = statement_timestamp()
    where id = '38000000-0000-4000-8000-000000000875'$$,
  '23514', null, 'an abandonment timestamp cannot be present outside abandoned status'
);
select throws_ok(
  $$update public.owner_application_cottage_profiles
    set status = 'abandoned', version = version + 1,
        updated_at = statement_timestamp(), abandoned_at = statement_timestamp()
    where application_id = '28000000-0000-4000-8000-000000000874'$$,
  '23514', null, 'the application-linked profile cannot satisfy abandoned row shape'
);
select throws_ok(
  $$update public.owner_application_cottage_profiles
    set status = 'abandoned', version = version + 1,
        updated_at = statement_timestamp(), abandoned_at = statement_timestamp()
    where id = '38000000-0000-4000-8000-000000000882'$$,
  '23514', null, 'a currently published profile cannot satisfy abandoned row shape'
);
insert into public.owner_application_cottage_profiles (
  owner_user_id, name, status, abandoned_at, updated_at
)
select '00000000-0000-0000-0000-000000000878', 'Recent abandoned ' || n,
  'abandoned', statement_timestamp(), statement_timestamp()
from generate_series(1, 18) n;

select is(
  (select count(*)::integer from public.owner_application_cottage_profiles
    where owner_user_id = '00000000-0000-0000-0000-000000000878'
      and current_publication_id is null and status <> 'abandoned'),
  2, 'submitted profiles count as open while published and abandoned profiles do not'
);
select is(
  (select count(*)::integer from public.owner_application_cottage_profiles
    where owner_user_id = '00000000-0000-0000-0000-000000000878'
      and application_id is null and created_at > now() - interval '24 hours'),
  20, 'recent submitted, published, and abandoned additional rows all count toward the rolling rate'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000878","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.create_owner_cottage_profile_draft()$$,
  'RC429', null, 'the submitted, published, and abandoned recent-row mix enforces the rate limit'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000879","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.abandon_administrator_cottage_profile_draft(
    '38000000-0000-4000-8000-000000000881', 1, 'Submitted profile'
  )$$,
  'RC202', null, 'an administrator cannot abandon a submitted profile'
);
select throws_ok(
  $$select public.abandon_administrator_cottage_profile_draft(
    '38000000-0000-4000-8000-000000000882', 1, 'Published profile'
  )$$,
  'RC202', null, 'an administrator cannot abandon a published profile'
);
reset role;
insert into public.owner_application_cottage_profiles (
  id, owner_user_id, status, abandoned_at, updated_at
) values (
  '38000000-0000-4000-8000-000000000883', '00000000-0000-0000-0000-000000000873',
  'abandoned', statement_timestamp(), statement_timestamp()
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000879","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.restore_administrator_cottage_profile_draft(
    '38000000-0000-4000-8000-000000000883', 1, 'Capacity bypass'
  )$$,
  'RC420', null, 'administrator restoration cannot bypass open capacity'
);

select * from finish();
rollback;
