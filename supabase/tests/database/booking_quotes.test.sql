begin;
select plan(20);

select is(
  (select prosecdef from pg_proc where oid =
    'public.get_public_booking_quote(public.cottage_profile_source_language,text,jsonb)'::regprocedure),
  true,
  'the anonymous Booking Quote boundary is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc where oid =
    'public.get_public_booking_quote(public.cottage_profile_source_language,text,jsonb)'::regprocedure),
  array['search_path=""'],
  'the Booking Quote boundary has an empty search_path'
);
select function_privs_are(
  'public', 'get_public_booking_quote',
  array['cottage_profile_source_language', 'text', 'jsonb'],
  'anon', array['EXECUTE'],
  'anonymous callers receive only the narrow Quote RPC grant'
);
select function_privs_are(
  'public', 'get_public_booking_quote',
  array['cottage_profile_source_language', 'text', 'jsonb'],
  'authenticated', array['EXECUTE'],
  'authenticated callers receive only the narrow Quote RPC grant'
);
select function_privs_are(
  'public', 'get_public_booking_quote',
  array['cottage_profile_source_language', 'text', 'jsonb'],
  'public', array[]::text[],
  'PUBLIC cannot execute the Quote RPC'
);

insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values (
  '00000000-0000-0000-0000-000000002901', 'authenticated', 'authenticated',
  '+9647500002901', now()
), (
  '00000000-0000-0000-0000-000000002902', 'authenticated', 'authenticated',
  '+9647500002902', now()
);
insert into public.account_contexts (user_id, role, owner_approval_state)
values ('00000000-0000-0000-0000-000000002901', 'cottage_owner', 'approved');
insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, amenities, source_language, description,
  house_rules, status
) values (
  '30000000-0000-4000-8000-000000002901',
  '00000000-0000-0000-0000-000000002901',
  'Quote Cottage', 'Baghdad', 'Karrada', 'Private Quote address',
  8, 3, 2, array['pool'], 'en', 'Approved Quote description',
  'Approved Quote rules', 'draft'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002901","role":"authenticated","aal":"aal1"}',
  true
);
select public.replace_cottage_shift_schedule(
  '30000000-0000-4000-8000-000000002901', 0,
  '[{"name":"Morning","startTime":"08:00","endTime":"14:00"},
    {"name":"Evening","startTime":"18:00","endTime":"23:00"}]'
);
reset role;
insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules, revision
) values (
  '31000000-0000-4000-8000-000000002901',
  '30000000-0000-4000-8000-000000002901',
  '00000000-0000-0000-0000-000000002901',
  'en', 'Approved Quote description', 'Approved Quote rules', 1
);
insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
) values (
  '32000000-0000-4000-8000-000000002901',
  '30000000-0000-4000-8000-000000002901',
  '00000000-0000-0000-0000-000000002901',
  '31000000-0000-4000-8000-000000002901',
  'Quote Cottage', 'Baghdad', 'Karrada', 8, 3, 2, array['pool'],
  1, 'approved', now()
);
insert into public.cottage_profile_localized_revisions (
  id, review_cycle_id, locale, revision, origin, description, house_rules
) values (
  '33000000-0000-4000-8000-000000002901',
  '32000000-0000-4000-8000-000000002901',
  'en', 1, 'owner_source', 'Approved Quote description', 'Approved Quote rules'
);
insert into public.cottage_profile_publication_decisions (
  review_cycle_id, administrator_user_id, approved, reason
) values (
  '32000000-0000-4000-8000-000000002901',
  '00000000-0000-0000-0000-000000002902', true,
  'Private Quote moderation reason'
);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
) values (
  '34000000-0000-4000-8000-000000002901',
  '30000000-0000-4000-8000-000000002901',
  '32000000-0000-4000-8000-000000002901', 1,
  'Quote Cottage', 'Baghdad', 'Karrada', 8, 3, 2, array['pool']
);
insert into public.cottage_publication_localizations (
  publication_id, locale, localized_revision_id, description, house_rules
) values (
  '34000000-0000-4000-8000-000000002901', 'en',
  '33000000-0000-4000-8000-000000002901',
  'Approved Quote description', 'Approved Quote rules'
);
update public.owner_application_cottage_profiles
set current_publication_id = '34000000-0000-4000-8000-000000002901'
where id = '30000000-0000-4000-8000-000000002901';

insert into public.cottage_inventory_standard_prices (
  schedule_revision_id, unit_kind, unit_id, price_iqd
)
select profiles.current_shift_schedule_id,
  'shift'::public.cottage_inventory_unit_kind, shifts.id,
  case shifts.position when 1 then 100000 else 110000 end
from public.owner_application_cottage_profiles profiles
join public.cottage_shifts shifts
  on shifts.schedule_revision_id = profiles.current_shift_schedule_id
where profiles.id = '30000000-0000-4000-8000-000000002901'
union all
select profiles.current_shift_schedule_id,
  'full_day_bundle'::public.cottage_inventory_unit_kind,
  schedules.full_day_bundle_id, 250000
from public.owner_application_cottage_profiles profiles
join public.cottage_shift_schedule_revisions schedules
  on schedules.id = profiles.current_shift_schedule_id
where profiles.id = '30000000-0000-4000-8000-000000002901';
insert into public.cottage_inventory_date_price_overrides (
  schedule_revision_id, unit_kind, unit_id, service_day, price_iqd
)
select profiles.current_shift_schedule_id,
  'full_day_bundle'::public.cottage_inventory_unit_kind,
  schedules.full_day_bundle_id, '2099-08-22', 260000
from public.owner_application_cottage_profiles profiles
join public.cottage_shift_schedule_revisions schedules
  on schedules.id = profiles.current_shift_schedule_id
where profiles.id = '30000000-0000-4000-8000-000000002901';
insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select prices.schedule_revision_id, prices.unit_kind, prices.unit_id,
  service_days.value, 'open'::public.cottage_inventory_availability_state
from public.cottage_inventory_standard_prices prices
cross join (values ('2099-08-21'::date), ('2099-08-22'::date)) service_days(value)
where prices.schedule_revision_id = (
  select current_shift_schedule_id
  from public.owner_application_cottage_profiles
  where id = '30000000-0000-4000-8000-000000002901'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$select * from public.cottage_inventory_commitments$$,
  '42501', null,
  'anonymous Quote callers cannot inspect commitments directly'
);
select throws_ok(
  $$select * from public.cottage_marketplace_listings$$,
  '42501', null,
  'anonymous Quote callers cannot inspect public lifecycle tables directly'
);
select throws_ok(
  $$select public.get_public_booking_quote(
    'en', 'cottage-00000000000040008000000000000029',
    '{"from":"2099-08-21","to":"2099-08-21","guests":1,
      "amenities":[],"selections":[],"internalId":"private"}'::jsonb
  )$$,
  '22023', null,
  'malformed and extra search input fails closed'
);
select throws_ok(
  $$select public.get_public_booking_quote(
    null, 'cottage-30000000000040008000000000002901',
    '{"from":"2099-08-21","to":"2099-08-21","guests":1,
      "amenities":[],"selections":[
        {"serviceDay":"2099-08-21","kind":"shift","position":1}
      ]}'::jsonb
  )$$,
  '22023', 'Booking Quote locale is required',
  'a null Quote locale fails closed at the RPC entry'
);
select throws_ok(
  $$select public.get_public_booking_quote(
    'en', null,
    '{"from":"2099-08-21","to":"2099-08-21","guests":1,
      "amenities":[],"selections":[
        {"serviceDay":"2099-08-21","kind":"shift","position":1}
      ]}'::jsonb
  )$$,
  '22023', 'Invalid public Cottage slug',
  'a null public Cottage slug fails closed at the RPC entry'
);
select throws_ok(
  $$select public.get_public_booking_quote(
    'en', 'cottage-30000000000040008000000000002901', null
  )$$,
  '22023', 'Booking Quote search is required',
  'a null Quote search fails closed at the RPC entry'
);
select throws_ok(
  $$select public.get_public_booking_quote(
    'en', 'cottage-ABCDEF00000000000000000000000000',
    '{"from":"2099-08-21","to":"2099-08-21","guests":1,
      "amenities":[],"selections":[
        {"serviceDay":"2099-08-21","kind":"shift","position":1}
      ]}'::jsonb
  )$$,
  '22023', null,
  'a malformed public Cottage slug fails closed at the RPC entry'
);
select throws_ok(
  $$select public.get_public_booking_quote(
    'en', 'cottage-0000000000000000000000000000000000000000000000000000000000000000',
    '{"from":"2099-08-21","to":"2099-08-21","guests":1,
      "amenities":[],"selections":[
        {"serviceDay":"2099-08-21","kind":"shift","position":1}
      ]}'::jsonb
  )$$,
  '22023', null,
  'an oversized public Cottage slug fails closed at the RPC entry'
);
select results_eq(
  $$select array_agg(key order by key)
    from jsonb_object_keys(public.get_public_booking_quote(
      'en', 'cottage-00000000000040008000000000000029',
      '{"from":"2099-08-21","to":"2099-08-21","guests":1,
        "amenities":[],"selections":[
          {"serviceDay":"2099-08-21","kind":"shift","position":1}
        ]}'::jsonb
    )) keys(key)$$,
  $$values (array['status']::text[])$$,
  'not-found returns no partial Cottage or money fields'
);
select is(
  public.get_public_booking_quote(
    'en', 'cottage-00000000000040008000000000000029',
    '{"from":"2099-08-21","to":"2099-08-21","guests":1,
      "amenities":[],"selections":[
        {"serviceDay":"2099-08-21","kind":"shift","position":1}
      ]}'::jsonb
  ) ->> 'status',
  'not-found',
  'an unknown opaque Cottage slug is distinguished from unavailable inventory'
);
select results_eq(
  $$select array_agg(key order by key)
    from jsonb_object_keys(public.get_public_booking_quote(
      'en', 'cottage-30000000000040008000000000002901',
      '{"from":"2099-08-21","to":"2099-08-22","guests":4,
        "amenities":[],"selections":[
          {"serviceDay":"2099-08-21","kind":"full-day"},
          {"serviceDay":"2099-08-22","kind":"full-day"}
        ]}'::jsonb
    )) keys(key)$$,
  $$values (array['bookingPriceIqd','contentVersion','cottageName',
    'customerTotalIqd','houseRules','items','serviceFeeIqd','slug','status',
    'termsVersion']::text[])$$,
  'an anonymous quote exposes only customer Booking Quote fields'
);
select results_eq(
  $$select result ->> 'status', (result ->> 'bookingPriceIqd')::bigint,
      (result ->> 'serviceFeeIqd')::bigint,
      (result ->> 'customerTotalIqd')::bigint,
      jsonb_array_length(result -> 'items')
    from (select public.get_public_booking_quote(
      'en', 'cottage-30000000000040008000000000002901',
      '{"from":"2099-08-21","to":"2099-08-22","guests":4,
        "amenities":[],"selections":[
          {"serviceDay":"2099-08-21","kind":"full-day"},
          {"serviceDay":"2099-08-22","kind":"full-day"}
        ]}'::jsonb
    ) result) quote$$,
  $$values ('quoted'::text, 510000::bigint, 5000::bigint, 515000::bigint, 2)$$,
  'two consecutive separately priced Full-Day Bundles produce exact customer totals'
);
select results_eq(
  $$select item ->> 'serviceDay', item ->> 'kind', item ->> 'displayName',
      item ->> 'startsAt', item ->> 'endsAt', (item ->> 'priceIqd')::bigint
    from jsonb_array_elements(public.get_public_booking_quote(
      'en', 'cottage-30000000000040008000000000002901',
      '{"from":"2099-08-21","to":"2099-08-22","guests":4,
        "amenities":[],"selections":[
          {"serviceDay":"2099-08-21","kind":"full-day"},
          {"serviceDay":"2099-08-22","kind":"full-day"}
        ]}'::jsonb
    ) -> 'items') item$$,
  $$values
    ('2099-08-21'::text, 'full-day'::text, 'Full-day bundle'::text,
      '2099-08-21T08:00:00+03:00'::text, '2099-08-21T23:00:00+03:00'::text,
      250000::bigint),
    ('2099-08-22'::text, 'full-day'::text, 'Full-day bundle'::text,
      '2099-08-22T08:00:00+03:00'::text, '2099-08-22T23:00:00+03:00'::text,
      260000::bigint)$$,
  'the Quote preserves ordered Full-Day Bundle dates, access bounds, and applied prices'
);
reset role;
select is(
  (select count(*) from public.cottage_inventory_commitments),
  0::bigint,
  'loading an anonymous Quote creates no inventory commitment'
);
select is(
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name like '%booking_quote%'),
  0::bigint,
  'Booking Quotes have no anonymous persistence table'
);

select * from finish();
rollback;
