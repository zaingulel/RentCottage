begin;

create extension if not exists pgtap with schema extensions;
select plan(39);

select ok(
  lower(pg_get_functiondef(
    'public.replace_cottage_shift_schedule(uuid,integer,jsonb)'::regprocedure
  )) like '%for update%',
  'the atomic replacement takes the Cottage Profile row lock before comparing revision zero'
);

insert into auth.users (id, aud, role, phone, phone_confirmed_at, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000002501', 'authenticated', 'authenticated', '+9647500002501', now(), null, null),
  ('00000000-0000-0000-0000-000000002502', 'authenticated', 'authenticated', '+9647500002502', now(), null, null),
  ('00000000-0000-0000-0000-000000002503', 'authenticated', 'authenticated', '+9647500002503', now(), null, null),
  ('00000000-0000-0000-0000-000000002504', 'authenticated', 'authenticated', null, null, 'schedule-admin@example.test', now()),
  ('00000000-0000-0000-0000-000000002505', 'authenticated', 'authenticated', '+9647500002505', now(), null, null);

insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000002501', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000002502', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000002503', 'customer', null),
  ('00000000-0000-0000-0000-000000002504', 'platform_administrator', null),
  ('00000000-0000-0000-0000-000000002505', 'cottage_owner', 'prospective');

insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, amenities, source_language, description,
  house_rules, status
) values (
  '30000000-0000-4000-8000-000000002501',
  '00000000-0000-0000-0000-000000002501',
  'Schedule Cottage', 'Erbil', 'Near Shaqlawa', 'Private address',
  8, 3, 2, array['garden'], 'en', 'Description', 'Rules', 'draft'
), (
  '30000000-0000-4000-8000-000000002502',
  '00000000-0000-0000-0000-000000002502',
  'Other Cottage', 'Duhok', 'Near Amedi', 'Private address',
  6, 2, 2, array['parking'], 'en', 'Description', 'Rules', 'draft'
), (
  '30000000-0000-4000-8000-000000002503',
  '00000000-0000-0000-0000-000000002501',
  'Submitted Cottage', 'Erbil', 'Near Soran', 'Private address',
  4, 2, 1, array['garden'], 'en', 'Description', 'Rules',
  'draft'
);

insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules,
  revision
) values (
  '40000000-0000-4000-8000-000000002503',
  '30000000-0000-4000-8000-000000002503',
  '00000000-0000-0000-0000-000000002501',
  'en', 'Description', 'Rules', 1
);
update public.owner_application_cottage_profiles
set submitted_source_revision_id = '40000000-0000-4000-8000-000000002503',
    status = 'submitted_for_content_approval'
where id = '30000000-0000-4000-8000-000000002503';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002501","role":"authenticated","aal":"aal1"}', true);

select lives_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002501', 0,
    '[{"name":"Evening","startTime":"18:00","endTime":"02:00"},{"name":"Morning","startTime":"08:00","endTime":"12:00"}]'
  )$$,
  'an approved owner atomically saves the first Shift Schedule'
);
select is((select count(*) from public.cottage_shift_schedule_revisions), 1::bigint,
  'bootstrap creates exactly one immutable revision');
select results_eq(
  $$select name from public.cottage_shifts order by position$$,
  $$values ('Morning'::text), ('Evening'::text)$$,
  'the database persists Cottage Shifts in canonical local start-time order'
);
select results_eq(
  $$select name, end_time < start_time from public.cottage_shifts order by position$$,
  $$values ('Morning'::text, false), ('Evening'::text, true)$$,
  'a cross-midnight shift belongs to the Service Day on which it starts'
);
select ok(
  (select full_day_bundle_id is not null from public.cottage_shift_schedule_revisions),
  'the first revision receives a stable Full-Day Bundle identity'
);
create temporary table revision_one_shift_snapshot on commit drop as
select shifts.id, shifts.position, shifts.name, shifts.start_time, shifts.end_time
from public.cottage_shifts shifts
join public.cottage_shift_schedule_revisions revisions
  on revisions.id = shifts.schedule_revision_id
where revisions.profile_id = '30000000-0000-4000-8000-000000002501'
  and revisions.revision = 1;

select lives_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002501', 1,
    '[{"name":"Night","startTime":"23:00","endTime":"01:00"},{"name":"Early","startTime":"01:00","endTime":"04:00"}]'
  )$$,
  'half-open Cottage Shifts may touch at an endpoint across midnight'
);
select is((select max(revision) from public.cottage_shift_schedule_revisions), 2,
  'a replacement advances the profile to revision two');
select results_eq(
  $$select shifts.id, shifts.position, shifts.name, shifts.start_time, shifts.end_time
    from public.cottage_shifts shifts
    join public.cottage_shift_schedule_revisions revisions
      on revisions.id = shifts.schedule_revision_id
    where revisions.profile_id = '30000000-0000-4000-8000-000000002501'
      and revisions.revision = 1
    order by shifts.position$$,
  $$select id, position, name, start_time, end_time
    from revision_one_shift_snapshot order by position$$,
  'replacement leaves every revision-one Cottage Shift identity and value unchanged'
);
select isnt(
  (select full_day_bundle_id from public.cottage_shift_schedule_revisions where revision = 1),
  (select full_day_bundle_id from public.cottage_shift_schedule_revisions where revision = 2),
  'each immutable revision has its own Full-Day Bundle identity'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002502","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002501', 2,
    '[{"name":"Foreign one","startTime":"08:00","endTime":"12:00"},{"name":"Foreign two","startTime":"18:00","endTime":"22:00"}]'
  )$$,
  '42501', null, 'an approved Cottage Owner cannot replace another owner schedule'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002503","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002501', 2,
    '[{"name":"Customer one","startTime":"08:00","endTime":"12:00"},{"name":"Customer two","startTime":"18:00","endTime":"22:00"}]'
  )$$,
  '42501', null, 'a Customer cannot replace a Shift Schedule'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002504","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002501', 2,
    '[{"name":"Admin one","startTime":"08:00","endTime":"12:00"},{"name":"Admin two","startTime":"18:00","endTime":"22:00"}]'
  )$$,
  '42501', null, 'a Platform Administrator cannot replace a Shift Schedule'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002505","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002501', 2,
    '[{"name":"Prospective one","startTime":"08:00","endTime":"12:00"},{"name":"Prospective two","startTime":"18:00","endTime":"22:00"}]'
  )$$,
  '42501', null, 'a prospective Cottage Owner cannot replace a Shift Schedule'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002501","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002503', 0,
    '[{"name":"Submitted one","startTime":"08:00","endTime":"12:00"},{"name":"Submitted two","startTime":"18:00","endTime":"22:00"}]'
  )$$,
  'RC202', null, 'an approved owner cannot replace a submitted Cottage Profile schedule'
);
reset role;
select results_eq(
  $$select profiles.id, revisions.revision
    from public.owner_application_cottage_profiles profiles
    left join public.cottage_shift_schedule_revisions revisions
      on revisions.id = profiles.current_shift_schedule_id
    where profiles.id in (
      '30000000-0000-4000-8000-000000002501',
      '30000000-0000-4000-8000-000000002503'
    ) order by profiles.id$$,
  $$values
    ('30000000-0000-4000-8000-000000002501'::uuid, 2::integer),
    ('30000000-0000-4000-8000-000000002503'::uuid, null::integer)$$,
  'denied replacements leave both current schedule pointers unchanged'
);
select is((select count(*) from public.cottage_shift_schedule_revisions), 2::bigint,
  'denied replacements create no schedule revisions or Cottage Shifts');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002501","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002501', 1,
    '[{"name":"Stale one","startTime":"08:00","endTime":"12:00"},{"name":"Stale two","startTime":"18:00","endTime":"22:00"}]'
  )$$,
  'RC409', null, 'a stale expected revision cannot overwrite the current schedule'
);
select is((select count(*) from public.cottage_shift_schedule_revisions), 2::bigint,
  'a stale save leaves no orphan schedule revision');
select throws_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002501', 2,
    '[{"name":"Prior night","startTime":"23:00","endTime":"02:00"},{"name":"Today early","startTime":"01:00","endTime":"04:00"}]'
  )$$,
  'RC207', null,
  'yesterday cross-midnight occupancy cannot overlap today early occupancy'
);
select is((select count(*) from public.cottage_shift_schedule_revisions), 2::bigint,
  'a circular-overlap failure rolls back its revision and shifts');
select throws_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002501', 2,
    '[{"name":"One","startTime":"08:00","endTime":"13:00"},{"name":"Two","startTime":"12:00","endTime":"16:00"}]'
  )$$,
  'RC207', null, 'same-day Cottage Shift overlap is rejected'
);
select lives_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002501', 2,
    '[{"name":"Same","startTime":"06:00","endTime":"09:00"},{"name":"Same","startTime":"12:00","endTime":"15:00"},{"name":"Late","startTime":"20:00","endTime":"23:00"}]'
  )$$,
  'arbitrary turnaround gaps and duplicate shift names are allowed'
);
select is((select count(*) from public.cottage_shifts where schedule_revision_id =
  (select id from public.cottage_shift_schedule_revisions where revision = 3)), 3::bigint,
  'a valid schedule may contain exactly three Cottage Shifts');

select is((select count(*) from public.cottage_shift_schedule_revisions), 3::bigint,
  'the owning Cottage Owner reads all own schedule revisions through RLS');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002502","role":"authenticated","aal":"aal1"}', true);
select is((select count(*) from public.cottage_shift_schedule_revisions), 0::bigint,
  'another Cottage Owner cannot read a foreign Shift Schedule');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002503","role":"authenticated","aal":"aal1"}', true);
select is((select count(*) from public.cottage_shifts), 0::bigint,
  'a Customer cannot read private Cottage Shifts');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002504","role":"authenticated","aal":"aal1"}', true);
select is((select count(*) from public.cottage_shift_schedule_revisions), 0::bigint,
  'an AAL1 administrator cannot read private Shift Schedules');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002504","role":"authenticated","aal":"aal2"}', true);
select is((select count(*) from public.cottage_shift_schedule_revisions), 3::bigint,
  'an AAL2 administrator can read private Shift Schedule history');
select throws_ok(
  $$insert into public.cottage_shift_schedule_revisions (profile_id, revision)
    values ('30000000-0000-4000-8000-000000002501', 4)$$,
  '42501', null, 'authenticated actors cannot write schedule tables directly'
);

reset role;
select throws_ok(
  $$update public.cottage_shifts set name = 'Rewritten' where true$$,
  'RC208', null, 'Cottage Shift history cannot be updated'
);
select throws_ok(
  $$delete from public.cottage_shifts where true$$,
  'RC208', null, 'Cottage Shift history cannot be deleted'
);
select throws_ok(
  $$update public.cottage_shift_schedule_revisions set revision = 9 where revision = 1$$,
  'RC208', null, 'Shift Schedule revision history cannot be updated'
);
select throws_ok(
  $$insert into public.cottage_shifts (
      schedule_revision_id, position, name, start_time, end_time
    ) values (
      (select id from public.cottage_shift_schedule_revisions where revision = 1),
      3, 'Late append', '14:00', '16:00'
    )$$,
  'RC208', null, 'a Cottage Shift cannot be appended after its revision transaction'
);
select throws_ok(
  $$update public.owner_application_cottage_profiles
    set current_shift_schedule_id = (
      select id from public.cottage_shift_schedule_revisions
      where profile_id = '30000000-0000-4000-8000-000000002501'
      order by revision desc limit 1
    )
    where id = '30000000-0000-4000-8000-000000002502'$$,
  '23503', null, 'the composite pointer cannot select another cottage schedule'
);
select throws_ok(
  $$do $block$
    declare incomplete_id uuid;
    begin
      insert into public.cottage_shift_schedule_revisions (profile_id, revision)
      values ('30000000-0000-4000-8000-000000002502', 1)
      returning id into incomplete_id;
      perform set_config(
        'rentcottage.shift_schedule_write_revision_id',
        incomplete_id::text,
        true
      );
      insert into public.cottage_shifts (
        schedule_revision_id, position, name, start_time, end_time
      ) values (incomplete_id, 1, 'Only shift', '08:00', '12:00');
      set constraints require_complete_cottage_shift_schedule immediate;
    end
  $block$;$$,
  'RC205', null, 'deferred integrity rejects a revision with fewer than two shifts'
);

insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules,
  revision
) values (
  '40000000-0000-4000-8000-000000002502',
  '30000000-0000-4000-8000-000000002502',
  '00000000-0000-0000-0000-000000002502', 'en', 'Description', 'Rules', 1
);
insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
) values (
  '50000000-0000-4000-8000-000000002502',
  '30000000-0000-4000-8000-000000002502',
  '00000000-0000-0000-0000-000000002502',
  '40000000-0000-4000-8000-000000002502', 'Other Cottage', 'Duhok',
  'Near Amedi', 6, 2, 2, array['parking'], 1, 'approved', now()
);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
) values (
  '60000000-0000-4000-8000-000000002502',
  '30000000-0000-4000-8000-000000002502',
  '50000000-0000-4000-8000-000000002502', 1, 'Other Cottage', 'Duhok',
  'Near Amedi', 6, 2, 2, array['parking']
);
select throws_ok(
  $$update public.owner_application_cottage_profiles
    set current_publication_id = '60000000-0000-4000-8000-000000002502'
    where id = '30000000-0000-4000-8000-000000002502'$$,
  'RC205', null, 'a cottage cannot be newly published without a current Shift Schedule'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000002502","role":"authenticated","aal":"aal1"}', true);
select lives_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002502', 0,
    '[{"name":"Day","startTime":"08:00","endTime":"14:00"},{"name":"Night","startTime":"18:00","endTime":"23:00"}]'
  )$$,
  'the second approved owner creates a current valid schedule'
);
reset role;
select lives_ok(
  $$update public.owner_application_cottage_profiles
    set current_publication_id = '60000000-0000-4000-8000-000000002502'
    where id = '30000000-0000-4000-8000-000000002502'$$,
  'publication may advance after the cottage has a current valid schedule'
);

select * from finish();
rollback;
