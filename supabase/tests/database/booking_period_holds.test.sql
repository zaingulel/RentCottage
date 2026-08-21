begin;

select plan(36);

select has_table(
  'public', 'cottage_booking_period_commitments',
  'Booking Period commitments have one canonical parent record'
);
select has_table(
  'public', 'cottage_booking_period_occupancies',
  'Booking Period commitments expand to physical Cottage Shift occupancy'
);
select has_function(
  'public', 'create_pending_booking_period_hold',
  array['uuid', 'uuid', 'text', 'jsonb'],
  'the service creates one atomic Pending Hold through a database boundary'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_pending_booking_period_hold(uuid,uuid,text,jsonb)',
    'execute'
  )
    and not has_function_privilege(
      'authenticated',
      'public.create_pending_booking_period_hold(uuid,uuid,text,jsonb)',
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.create_pending_booking_period_hold(uuid,uuid,text,jsonb)',
      'execute'
    ),
  'only the service role can create a Pending Hold'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_class relations
    where relations.oid in (
      'public.cottage_booking_period_commitments'::regclass,
      'public.cottage_inventory_commitments'::regclass,
      'public.cottage_booking_period_occupancies'::regclass
    )
      and relations.relrowsecurity
  ),
  3::bigint,
  'every private Booking Period table keeps Row Level Security enabled'
);
select ok(
  not exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
    cross join (values
      ('public.cottage_booking_period_commitments'),
      ('public.cottage_inventory_commitments'),
      ('public.cottage_booking_period_occupancies')
    ) relations(table_name)
    cross join (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
    ) privileges(privilege_name)
    where has_table_privilege(
      roles.role_name,
      relations.table_name,
      privileges.privilege_name
    )
  ),
  'application roles have no direct read or write privilege on private Booking Period tables'
);
select ok(
  to_regprocedure('public.lock_cottage_inventory_commitment_profile()') is null,
  'the removed child-table profile lock has no orphan function'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_constraint constraints
    join pg_catalog.pg_attribute attributes
      on attributes.attrelid = constraints.conrelid
      and attributes.attnum = any(constraints.conkey)
    where constraints.conrelid = 'public.cottage_booking_period_commitments'::regclass
      and constraints.contype = 'f'
      and constraints.confrelid = 'public.account_contexts'::regclass
      and constraints.confdeltype = 'r'
      and attributes.attname = 'customer_user_id'
  ),
  1::bigint,
  'the Booking Period Customer references Account Context with restricted deletion'
);

insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values
  (
    '00000000-0000-0000-0000-000000003101', 'authenticated', 'authenticated',
    '+9647500003101', now()
  ),
  (
    '00000000-0000-0000-0000-000000003102', 'authenticated', 'authenticated',
    '+9647500003102', now()
  ),
  (
    '00000000-0000-0000-0000-000000003103', 'authenticated', 'authenticated',
    '+9647500003103', now()
  );
insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000003101', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000003102', 'customer', null),
  ('00000000-0000-0000-0000-000000003103', 'customer', null);
insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, amenities, source_language, description,
  house_rules, status
) values (
  '30000000-0000-4000-8000-000000003101',
  '00000000-0000-0000-0000-000000003101',
  'Atomic Hold Cottage', 'Baghdad', 'Karrada', 'Private address',
  8, 3, 2, array['pool'], 'en', 'Description', 'Rules', 'draft'
);
insert into public.cottage_shift_schedule_revisions (
  id, profile_id, revision, full_day_bundle_id
) values (
  '60000000-0000-4000-8000-000000003101',
  '30000000-0000-4000-8000-000000003101',
  1,
  '61000000-0000-4000-8000-000000003101'
);
select set_config(
  'rentcottage.shift_schedule_write_revision_id',
  '60000000-0000-4000-8000-000000003101',
  true
);
insert into public.cottage_shifts (
  id, schedule_revision_id, position, name, start_time, end_time
) values
  (
    '62000000-0000-4000-8000-000000003101',
    '60000000-0000-4000-8000-000000003101',
    1, 'Morning', '08:00', '12:00'
  ),
  (
    '62000000-0000-4000-8000-000000003102',
    '60000000-0000-4000-8000-000000003101',
    2, 'Evening', '12:00', '23:00'
  ),
  (
    '62000000-0000-4000-8000-000000003103',
    '60000000-0000-4000-8000-000000003101',
    3, 'Overnight', '23:00', '02:00'
  );
select set_config('rentcottage.shift_schedule_write_revision_id', '', true);
update public.owner_application_cottage_profiles
set current_shift_schedule_id = '60000000-0000-4000-8000-000000003101'
where id = '30000000-0000-4000-8000-000000003101';

insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules, revision
) values (
  '63000000-0000-4000-8000-000000003101',
  '30000000-0000-4000-8000-000000003101',
  '00000000-0000-0000-0000-000000003101',
  'en', 'Description', 'Rules', 1
);
insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
) values (
  '64000000-0000-4000-8000-000000003101',
  '30000000-0000-4000-8000-000000003101',
  '00000000-0000-0000-0000-000000003101',
  '63000000-0000-4000-8000-000000003101',
  'Atomic Hold Cottage', 'Baghdad', 'Karrada', 8, 3, 2,
  array['pool'], 1, 'approved', now()
);
insert into public.cottage_profile_localized_revisions (
  id, review_cycle_id, locale, revision, origin, description, house_rules
) values (
  '65000000-0000-4000-8000-000000003101',
  '64000000-0000-4000-8000-000000003101',
  'en', 1, 'owner_source', 'Description', 'Rules'
);
insert into public.cottage_profile_publication_decisions (
  review_cycle_id, administrator_user_id, approved, reason
) values (
  '64000000-0000-4000-8000-000000003101',
  '00000000-0000-0000-0000-000000003103',
  true, 'Approved fixture'
);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
) values (
  '66000000-0000-4000-8000-000000003101',
  '30000000-0000-4000-8000-000000003101',
  '64000000-0000-4000-8000-000000003101',
  1, 'Atomic Hold Cottage', 'Baghdad', 'Karrada', 8, 3, 2, array['pool']
);
insert into public.cottage_publication_localizations (
  publication_id, locale, localized_revision_id, description, house_rules
) values (
  '66000000-0000-4000-8000-000000003101',
  'en', '65000000-0000-4000-8000-000000003101', 'Description', 'Rules'
);
update public.owner_application_cottage_profiles
set current_publication_id = '66000000-0000-4000-8000-000000003101'
where id = '30000000-0000-4000-8000-000000003101';

insert into public.cottage_inventory_standard_prices (
  schedule_revision_id, unit_kind, unit_id, price_iqd
) values
  (
    '60000000-0000-4000-8000-000000003101', 'shift',
    '62000000-0000-4000-8000-000000003101', 100000
  ),
  (
    '60000000-0000-4000-8000-000000003101', 'shift',
    '62000000-0000-4000-8000-000000003102', 110000
  ),
  (
    '60000000-0000-4000-8000-000000003101', 'shift',
    '62000000-0000-4000-8000-000000003103', 120000
  ),
  (
    '60000000-0000-4000-8000-000000003101', 'full_day_bundle',
    '61000000-0000-4000-8000-000000003101', 250000
  );
insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select schedule_revision_id, unit_kind, unit_id, service_day, 'open'
from public.cottage_inventory_standard_prices
cross join (values ('2099-08-20'::date), ('2099-08-21'::date)) days(service_day)
where schedule_revision_id = '60000000-0000-4000-8000-000000003101';

insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, amenities, source_language, description,
  house_rules, status
) values (
  '30000000-0000-4000-8000-000000003102',
  '00000000-0000-0000-0000-000000003101',
  'Cross-Cottage Conflict Fixture', 'Baghdad', 'Mansour', 'Private address',
  8, 3, 2, array['pool'], 'en', 'Description', 'Rules', 'draft'
);
insert into public.cottage_shift_schedule_revisions (
  id, profile_id, revision, full_day_bundle_id
) values (
  '60000000-0000-4000-8000-000000003102',
  '30000000-0000-4000-8000-000000003102',
  1,
  '61000000-0000-4000-8000-000000003102'
);
select set_config(
  'rentcottage.shift_schedule_write_revision_id',
  '60000000-0000-4000-8000-000000003102',
  true
);
insert into public.cottage_shifts (
  id, schedule_revision_id, position, name, start_time, end_time
) values
  (
    '62000000-0000-4000-8000-000000003104',
    '60000000-0000-4000-8000-000000003102',
    1, 'Early', '01:00', '04:00'
  ),
  (
    '62000000-0000-4000-8000-000000003105',
    '60000000-0000-4000-8000-000000003102',
    2, 'Overnight gap', '04:00', '06:00'
  ),
  (
    '62000000-0000-4000-8000-000000003106',
    '60000000-0000-4000-8000-000000003102',
    3, 'Midday', '12:00', '16:00'
  );
select set_config('rentcottage.shift_schedule_write_revision_id', '', true);
update public.owner_application_cottage_profiles
set current_shift_schedule_id = '60000000-0000-4000-8000-000000003102'
where id = '30000000-0000-4000-8000-000000003102';
insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules, revision
) values (
  '63000000-0000-4000-8000-000000003102',
  '30000000-0000-4000-8000-000000003102',
  '00000000-0000-0000-0000-000000003101',
  'en', 'Description', 'Rules', 1
);
insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
) values (
  '64000000-0000-4000-8000-000000003102',
  '30000000-0000-4000-8000-000000003102',
  '00000000-0000-0000-0000-000000003101',
  '63000000-0000-4000-8000-000000003102',
  'Cross-Cottage Conflict Fixture', 'Baghdad', 'Mansour', 8, 3, 2,
  array['pool'], 1, 'approved', now()
);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
) values (
  '66000000-0000-4000-8000-000000003102',
  '30000000-0000-4000-8000-000000003102',
  '64000000-0000-4000-8000-000000003102',
  1, 'Cross-Cottage Conflict Fixture', 'Baghdad', 'Mansour',
  8, 3, 2, array['pool']
);
update public.owner_application_cottage_profiles
set current_publication_id = '66000000-0000-4000-8000-000000003102'
where id = '30000000-0000-4000-8000-000000003102';
insert into public.cottage_inventory_standard_prices (
  schedule_revision_id, unit_kind, unit_id, price_iqd
) values
  (
    '60000000-0000-4000-8000-000000003102', 'shift',
    '62000000-0000-4000-8000-000000003104', 90000
  ),
  (
    '60000000-0000-4000-8000-000000003102', 'shift',
    '62000000-0000-4000-8000-000000003105', 95000
  ),
  (
    '60000000-0000-4000-8000-000000003102', 'shift',
    '62000000-0000-4000-8000-000000003106', 100000
  ),
  (
    '60000000-0000-4000-8000-000000003102', 'full_day_bundle',
    '61000000-0000-4000-8000-000000003102', 170000
  );
insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select schedule_revision_id, unit_kind, unit_id, service_day, 'open'
from public.cottage_inventory_standard_prices
cross join (
  values ('2099-08-20'::date), ('2099-08-21'::date), ('2099-08-22'::date)
) days(service_day)
where schedule_revision_id = '60000000-0000-4000-8000-000000003102';

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temporary table first_hold as
select public.create_pending_booking_period_hold(
  '00000000-0000-0000-0000-000000003102',
  '30000000-0000-4000-8000-000000003101',
  'RC-HOLD-3101',
  '{"from":"2099-08-20","to":"2099-08-20","guests":4,"selections":[{"serviceDay":"2099-08-20","kind":"shift","position":1}]}'::jsonb
) as result;
reset role;

select results_eq(
  $$select result ->> 'status', result ->> 'commitmentReference',
      (result ->> 'bookingPriceIqd')::bigint
    from first_hold$$,
  $$values ('pending_hold'::text, 'RC-HOLD-3101'::text, 100000::bigint)$$,
  'one service call creates a priced Pending Hold'
);
select results_eq(
  $$select count(*)::integer,
      (select count(*)::integer from public.cottage_booking_period_occupancies)
    from public.cottage_inventory_commitments$$,
  $$values (1::integer, 1::integer)$$,
  'one selected Shift persists one priced item and one physical occupancy'
);
select results_eq(
  $$select lower(access_range), upper(access_range)
    from public.cottage_booking_period_commitments commitments
    cross join lateral unnest(commitments.access_ranges) access_range$$,
  $$values (
    '2099-08-20 05:00:00+00'::timestamptz,
    '2099-08-20 09:00:00+00'::timestamptz
  )$$,
  'a Cottage Shift occupies its half-open Iraq-time access range'
);

select ok(
  not has_table_privilege('anon', 'public.cottage_booking_period_commitments', 'select')
    and not has_table_privilege('authenticated', 'public.cottage_booking_period_commitments', 'select')
    and not has_table_privilege('service_role', 'public.cottage_booking_period_commitments', 'select')
    and not has_table_privilege('anon', 'public.cottage_inventory_commitments', 'select')
    and not has_table_privilege('authenticated', 'public.cottage_inventory_commitments', 'select')
    and not has_table_privilege('service_role', 'public.cottage_inventory_commitments', 'select')
    and not has_table_privilege('anon', 'public.cottage_booking_period_occupancies', 'select')
    and not has_table_privilege('authenticated', 'public.cottage_booking_period_occupancies', 'select')
    and not has_table_privilege('service_role', 'public.cottage_booking_period_occupancies', 'select'),
  'application roles cannot read customer identity or commitment tables directly'
);

set local role service_role;
select throws_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003103',
    '30000000-0000-4000-8000-000000003101',
    'RC-INVALID-3101',
    '{"from":"2099-08-20","to":"2099-08-20","guests":4,"selections":[]}'::jsonb
  )$$,
  '22023', null,
  'malformed Booking Period input is rejected at the service boundary'
);
reset role;
select results_eq(
  $$select count(*)::integer,
      (select count(*)::integer from public.cottage_inventory_commitments),
      (select count(*)::integer from public.cottage_booking_period_occupancies)
    from public.cottage_booking_period_commitments$$,
  $$values (1::integer, 1::integer, 1::integer)$$,
  'rejected malformed input leaves no partial Booking Period rows'
);

set local role service_role;
select throws_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003103',
    '30000000-0000-4000-8000-000000003101',
    'RC-BUNDLE-CONFLICT-3101',
    '{"from":"2099-08-20","to":"2099-08-20","guests":4,"selections":[{"serviceDay":"2099-08-20","kind":"full-day"}]}'::jsonb
  )$$,
  'RC409', null,
  'a Full-Day Bundle is rejected when one component Shift is held'
);
reset role;
select is(
  (select count(*) from public.cottage_booking_period_commitments),
  1::bigint,
  'a rejected Full-Day Bundle creates no parent or component rows'
);

delete from public.cottage_booking_period_commitments;
set local role service_role;
select lives_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003102',
    '30000000-0000-4000-8000-000000003101',
    'RC-BUNDLE-3101',
    '{"from":"2099-08-20","to":"2099-08-20","guests":4,"selections":[{"serviceDay":"2099-08-20","kind":"full-day"}]}'::jsonb
  )$$,
  'one Full-Day Bundle creates one priced selection atomically'
);
reset role;
select results_eq(
  $$select
      (select count(*)::integer from public.cottage_inventory_commitments),
      (select count(*)::integer from public.cottage_booking_period_occupancies)$$,
  $$values (1::integer, 3::integer)$$,
  'a Full-Day Bundle expands to every physical Cottage Shift'
);
set local role service_role;
select throws_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003103',
    '30000000-0000-4000-8000-000000003101',
    'RC-SHIFT-CONFLICT-3101',
    '{"from":"2099-08-20","to":"2099-08-20","guests":4,"selections":[{"serviceDay":"2099-08-20","kind":"shift","position":2}]}'::jsonb
  )$$,
  'RC409', null,
  'a component Shift is rejected when its Full-Day Bundle is held'
);
select results_eq(
  $$select count(*)::integer
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000003101',
      '60000000-0000-4000-8000-000000003101',
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'calendarState' = 'pending_hold'
      and item ->> 'commitmentReference' = 'RC-BUNDLE-3101'$$,
  $$values (4::integer)$$,
  'the Owner Calendar derives one bundle reference from its canonical parent'
);
reset role;
select lives_ok(
  $$update public.cottage_booking_period_commitments
    set status = 'confirmed_booking'
    where commitment_reference = 'RC-BUNDLE-3101'$$,
  'a Pending Hold can become a Confirmed Booking on its parent only'
);
set local role service_role;
select throws_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003103',
    '30000000-0000-4000-8000-000000003101',
    'RC-CONFIRMED-CONFLICT-3101',
    '{"from":"2099-08-20","to":"2099-08-20","guests":4,"selections":[{"serviceDay":"2099-08-20","kind":"shift","position":3}]}'::jsonb
  )$$,
  'RC409', null,
  'a Confirmed Booking continues to block every bundle component Shift'
);
reset role;

delete from public.cottage_booking_period_commitments;
set local role service_role;
select lives_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003102',
    '30000000-0000-4000-8000-000000003101',
    'RC-TOUCH-FIRST-3101',
    '{"from":"2099-08-20","to":"2099-08-20","guests":4,"selections":[{"serviceDay":"2099-08-20","kind":"shift","position":1}]}'::jsonb
  )$$,
  'the first half-open customer access range can be held'
);
select lives_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003102',
    '30000000-0000-4000-8000-000000003102',
    'RC-TOUCH-SECOND-3101',
    '{"from":"2099-08-20","to":"2099-08-20","guests":4,"selections":[{"serviceDay":"2099-08-20","kind":"shift","position":3}]}'::jsonb
  )$$,
  'the same Customer may hold another Cottage when the ranges only touch'
);
reset role;
select is(
  (select count(*) from public.cottage_booking_period_commitments),
  2::bigint,
  'touching endpoint holds persist as two non-overlapping Booking Periods'
);

delete from public.cottage_booking_period_commitments;
set local role service_role;
select lives_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003102',
    '30000000-0000-4000-8000-000000003101',
    'RC-OVERNIGHT-3101',
    '{"from":"2099-08-20","to":"2099-08-20","guests":4,"selections":[{"serviceDay":"2099-08-20","kind":"shift","position":3}]}'::jsonb
  )$$,
  'a cross-midnight Cottage Shift can be held'
);
reset role;
select results_eq(
  $$select lower(access_range), upper(access_range)
    from public.cottage_booking_period_commitments periods
    cross join lateral unnest(periods.access_ranges) access_range$$,
  $$values (
    '2099-08-20 20:00:00+00'::timestamptz,
    '2099-08-20 23:00:00+00'::timestamptz
  )$$,
  'a cross-midnight Shift ends on the next Iraq-local Service Day'
);
set local role service_role;
select throws_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003102',
    '30000000-0000-4000-8000-000000003102',
    'RC-OVERNIGHT-CONFLICT-3101',
    '{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]}'::jsonb
  )$$,
  'RC409', null,
  'cross-midnight access conflicts with the same Customer at another Cottage'
);
reset role;

delete from public.cottage_booking_period_commitments;
set local role service_role;
select lives_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003102',
    '30000000-0000-4000-8000-000000003101',
    'RC-CROSS-COTTAGE-3101',
    '{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":2}]}'::jsonb
  )$$,
  'the first Cottage accepts an otherwise available Customer range'
);
select throws_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003102',
    '30000000-0000-4000-8000-000000003102',
    'RC-CROSS-COTTAGE-CONFLICT-3101',
    '{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":3}]}'::jsonb
  )$$,
  'RC409', null,
  'the same Customer cannot hold overlapping active ranges at different Cottages'
);
reset role;

delete from public.cottage_booking_period_commitments;
set local role service_role;
select lives_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003102',
    '30000000-0000-4000-8000-000000003101',
    'RC-CONFIRMED-CROSS-COTTAGE-3101',
    '{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":2}]}'::jsonb
  )$$,
  'the first Cottage accepts the Customer range before confirmation'
);
reset role;
update public.cottage_booking_period_commitments
set status = 'confirmed_booking'
where commitment_reference = 'RC-CONFIRMED-CROSS-COTTAGE-3101';
set local role service_role;
select throws_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003102',
    '30000000-0000-4000-8000-000000003102',
    'RC-CONFIRMED-CROSS-COTTAGE-CONFLICT-3101',
    '{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":3}]}'::jsonb
  )$$,
  'RC409', null,
  'a Confirmed Booking blocks the same Customer at an overlapping different Cottage'
);
reset role;

delete from public.cottage_booking_period_commitments;
set local role service_role;
select lives_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003102',
    '30000000-0000-4000-8000-000000003101',
    'RC-CONSECUTIVE-BUNDLES-3101',
    '{"from":"2099-08-20","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-20","kind":"full-day"},{"serviceDay":"2099-08-21","kind":"full-day"}]}'::jsonb
  )$$,
  'consecutive Full-Day Bundles create one Booking Period atomically'
);
reset role;
select results_eq(
  $$select lower(access_range), upper(access_range),
      (select count(*)::integer from public.cottage_inventory_commitments),
      (select count(*)::integer from public.cottage_booking_period_occupancies)
    from public.cottage_booking_period_commitments periods
    cross join lateral unnest(periods.access_ranges) access_range$$,
  $$values (
    '2099-08-20 05:00:00+00'::timestamptz,
    '2099-08-21 23:00:00+00'::timestamptz,
    2::integer,
    6::integer
  )$$,
  'consecutive bundles merge across the overnight gap and expand every component'
);
set local role service_role;
select throws_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003102',
    '30000000-0000-4000-8000-000000003102',
    'RC-CONSECUTIVE-GAP-CONFLICT-3101',
    '{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":2}]}'::jsonb
  )$$,
  'RC409', null,
  'consecutive Full-Day Bundles block the intervening overnight gap for the Customer'
);
select throws_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003101',
    '30000000-0000-4000-8000-000000003102',
    'RC-NOT-CUSTOMER-3101',
    '{"from":"2099-08-22","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-22","kind":"shift","position":1}]}'::jsonb
  )$$,
  '42501', null,
  'the service rejects an identity that is not a verified Customer'
);
reset role;

select * from finish();
rollback;
