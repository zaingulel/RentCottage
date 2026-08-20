begin;
select plan(31);

select has_table(
  'public', 'cottage_marketplace_listings',
  'Cottage marketplace lifecycle is separate from publication history'
);
select has_function(
  'public', 'search_public_cottages', array['public.cottage_profile_source_language', 'jsonb'],
  'anonymous Cottage discovery has one validated search boundary'
);
select has_function(
  'public', 'get_default_public_cottage_search', array['text'],
  'direct Cottage Profiles resolve a safe default Booking Period'
);
select has_function(
  'public', 'get_public_cottage_profile', array['public.cottage_profile_source_language', 'text', 'jsonb'],
  'anonymous Cottage Profile reads use the same validated Booking Period'
);
select has_function(
  'public', 'get_public_cottage_facets', array['public.cottage_profile_source_language'],
  'anonymous facets are projected through a safe boundary'
);

select ok(
  has_function_privilege('anon', 'public.search_public_cottages(public.cottage_profile_source_language,jsonb)', 'execute')
    and not has_table_privilege('anon', 'public.cottage_marketplace_listings', 'select'),
  'anonymous callers execute discovery without direct lifecycle-table access'
);
select ok(
  has_function_privilege('anon', 'public.get_public_cottage_profile(public.cottage_profile_source_language,text,jsonb)', 'execute'),
  'anonymous callers can load an eligible public Cottage Profile'
);
select ok(
  has_function_privilege('anon', 'public.get_public_cottage_facets(public.cottage_profile_source_language)', 'execute'),
  'anonymous callers can load privacy-safe discovery facets'
);
select is(
  (select production_ready from public.cottage_translation_runtime_control where singleton),
  false,
  'Cottage discovery does not silently open the production translation launch gate'
);

insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values (
  '00000000-0000-0000-0000-000000002801', 'authenticated', 'authenticated',
  '+9647500002801', now()
), (
  '00000000-0000-0000-0000-000000002802', 'authenticated', 'authenticated',
  '+9647500002802', now()
);
insert into public.account_contexts (user_id, role, owner_approval_state)
values ('00000000-0000-0000-0000-000000002801', 'cottage_owner', 'approved');
insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  exact_latitude, exact_longitude, private_directions, capacity, bedrooms,
  bathrooms, amenities, source_language, description, house_rules, status
) values (
  '30000000-0000-4000-8000-000000002801',
  '00000000-0000-0000-0000-000000002801',
  'Discovery Cottage', 'Baghdad', 'Abu Ghraib', 'Private address sentinel',
  36.123456, 44.654321, 'Private directions sentinel',
  8, 3, 2, array['pool','wifi'], 'en', 'Approved description',
  'Approved rules', 'draft'
), (
  '30000000-0000-4000-8000-000000002802',
  '00000000-0000-0000-0000-000000002801',
  'Cross-wired Cottage', 'Baghdad', 'Karkh', 'Other private address',
  35.123456, 43.654321, 'Other private directions',
  4, 2, 1, array['wifi'], 'en', 'Private description',
  'Private rules', 'draft'
);
insert into public.cottage_profile_photos (
  id, profile_id, owner_user_id, actor_user_id, object_path,
  original_filename, media_type, size_bytes, state
) values (
  '40000000-0000-4000-8000-000000002801',
  '30000000-0000-4000-8000-000000002801',
  '00000000-0000-0000-0000-000000002801',
  '00000000-0000-0000-0000-000000002801',
  'private/discovery/photo.webp', 'photo.webp', 'image/webp', 128, 'ready'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002801","role":"authenticated","aal":"aal1"}',
  true
);
select lives_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002801', 0,
    '[{"name":"Morning","startTime":"08:00","endTime":"14:00"},{"name":"Evening","startTime":"18:00","endTime":"23:00"}]'
  ), public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002802', 0,
    '[{"name":"Day","startTime":"09:00","endTime":"14:00"},{"name":"Night","startTime":"19:00","endTime":"23:00"}]'
  )$$,
  'approved owners create the current schedules used by discovery'
);
reset role;

insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules, revision
) values (
  '31000000-0000-4000-8000-000000002801',
  '30000000-0000-4000-8000-000000002801',
  '00000000-0000-0000-0000-000000002801',
  'en', 'Approved description', 'Approved rules', 1
);
insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
) values (
  '32000000-0000-4000-8000-000000002801',
  '30000000-0000-4000-8000-000000002801',
  '00000000-0000-0000-0000-000000002801',
  '31000000-0000-4000-8000-000000002801',
  'Discovery Cottage', 'Baghdad', 'Abu Ghraib', 8, 3, 2,
  array['pool','wifi'], 1, 'approved', now()
);
insert into public.cottage_profile_localized_revisions (
  id, review_cycle_id, locale, revision, origin, description, house_rules
) values (
  '33000000-0000-4000-8000-000000002801',
  '32000000-0000-4000-8000-000000002801',
  'en', 1, 'owner_source', 'Approved description', 'Approved rules'
);
insert into public.cottage_profile_publication_decisions (
  review_cycle_id, administrator_user_id, approved, reason
) values (
  '32000000-0000-4000-8000-000000002801',
  '00000000-0000-0000-0000-000000002802', true,
  'Private moderation reason sentinel'
);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
) values (
  '34000000-0000-4000-8000-000000002801',
  '30000000-0000-4000-8000-000000002801',
  '32000000-0000-4000-8000-000000002801', 1,
  'Discovery Cottage', 'Baghdad', 'Abu Ghraib', 8, 3, 2,
  array['pool','wifi']
);
insert into public.cottage_publication_localizations (
  publication_id, locale, localized_revision_id, description, house_rules
) values (
  '34000000-0000-4000-8000-000000002801', 'en',
  '33000000-0000-4000-8000-000000002801',
  'Approved description', 'Approved rules'
);
insert into public.cottage_publication_media (
  publication_id, photo_id, opaque_id, object_path, media_type, position
) values (
  '34000000-0000-4000-8000-000000002801',
  '40000000-0000-4000-8000-000000002801',
  '41000000-0000-4000-8000-000000002801',
  'private/discovery/photo.webp', 'image/webp', 1
);
update public.owner_application_cottage_profiles
set current_publication_id = '34000000-0000-4000-8000-000000002801'
where id = '30000000-0000-4000-8000-000000002801';

insert into public.cottage_inventory_standard_prices (
  schedule_revision_id, unit_kind, unit_id, price_iqd
)
select profiles.current_shift_schedule_id,
  'shift'::public.cottage_inventory_unit_kind, shifts.id,
  case shifts.position when 1 then 100000 else 110000 end
from public.owner_application_cottage_profiles profiles
join public.cottage_shifts shifts
  on shifts.schedule_revision_id = profiles.current_shift_schedule_id
where profiles.id = '30000000-0000-4000-8000-000000002801'
union all
select profiles.current_shift_schedule_id,
  'full_day_bundle'::public.cottage_inventory_unit_kind,
  schedules.full_day_bundle_id, 180000
from public.owner_application_cottage_profiles profiles
join public.cottage_shift_schedule_revisions schedules
  on schedules.id = profiles.current_shift_schedule_id
where profiles.id = '30000000-0000-4000-8000-000000002801';
insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select prices.schedule_revision_id, prices.unit_kind, prices.unit_id,
  '2099-08-21'::date, 'open'::public.cottage_inventory_availability_state
from public.cottage_inventory_standard_prices prices
where prices.schedule_revision_id = (
  select current_shift_schedule_id from public.owner_application_cottage_profiles
  where id = '30000000-0000-4000-8000-000000002801'
);
insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select prices.schedule_revision_id, prices.unit_kind, prices.unit_id,
  ((now() at time zone 'Asia/Baghdad')::date + 1),
  'open'::public.cottage_inventory_availability_state
from public.cottage_inventory_standard_prices prices
where prices.schedule_revision_id = (
  select current_shift_schedule_id from public.owner_application_cottage_profiles
  where id = '30000000-0000-4000-8000-000000002801'
);

select results_eq(
  $$select state::text from public.cottage_marketplace_listings
    where profile_id = '30000000-0000-4000-8000-000000002801'$$,
  $$values ('published'::text)$$,
  'a valid current publication registers a separately published marketplace listing'
);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  public.resolve_current_cottage_publication_media(
    '41000000-0000-4000-8000-000000002801'
  ),
  'private/discovery/photo.webp',
  'service-role media resolution exposes the current published snapshot only'
);
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$select * from public.cottage_marketplace_listings$$,
  '42501', null,
  'an anonymous caller cannot bypass the lifecycle RPC boundary'
);
select results_eq(
  $$select array_agg(key order by key)
    from jsonb_object_keys((select result from public.search_public_cottages('en', '{
      "from":"2099-08-21","to":"2099-08-21","guests":6,
      "amenities":["pool"],"selections":[
        {"serviceDay":"2099-08-21","kind":"shift","position":1},
        {"serviceDay":"2099-08-21","kind":"shift","position":2}
      ]
    }'::jsonb) result)) keys(key)$$,
  $$values (array['amenities','approximateLocation','capacity','governorate',
    'mediaIds','name','selectedInventory','slug','totalPriceIqd']::text[])$$,
  'anonymous search returns only its exact safe projection'
);
select ok(
  (select position('Private address sentinel' in result::text) = 0
      and position('36.123456' in result::text) = 0
      and position('44.654321' in result::text) = 0
      and position('Private directions sentinel' in result::text) = 0
      and position('00000000-0000-0000-0000-000000002801' in result::text) = 0
      and position('Private moderation reason sentinel' in result::text) = 0
    from public.search_public_cottages('en', '{
      "from":"2099-08-21","to":"2099-08-21","guests":6,
      "amenities":["pool"],"selections":[
        {"serviceDay":"2099-08-21","kind":"shift","position":1},
        {"serviceDay":"2099-08-21","kind":"shift","position":2}
      ]
    }'::jsonb) result),
  'anonymous search omits private location, owner and moderation sentinels'
);
select results_eq(
  $$select array_agg(key order by key)
    from jsonb_object_keys(public.get_public_cottage_profile(
      'en', 'cottage-30000000000040008000000000002801', '{
        "from":"2099-08-21","to":"2099-08-21","guests":1,
        "amenities":[],"selections":[
          {"serviceDay":"2099-08-21","kind":"shift","position":1}
        ]
      }'::jsonb
    )) keys(key)$$,
  $$values (array['amenities','approximateLocation','bathrooms','bedrooms',
    'capacity','description','governorate','houseRules','mediaIds','name',
    'selectedInventory','slug','totalPriceIqd']::text[])$$,
  'anonymous Cottage Profiles return only their exact safe projection'
);
select ok(
  position('Private address sentinel' in public.get_public_cottage_profile(
    'en', 'cottage-30000000000040008000000000002801', '{
      "from":"2099-08-21","to":"2099-08-21","guests":1,
      "amenities":[],"selections":[
        {"serviceDay":"2099-08-21","kind":"shift","position":1}
      ]
    }'::jsonb
  )::text) = 0
  and position('36.123456' in public.get_public_cottage_profile(
    'en', 'cottage-30000000000040008000000000002801', '{
      "from":"2099-08-21","to":"2099-08-21","guests":1,
      "amenities":[],"selections":[
        {"serviceDay":"2099-08-21","kind":"shift","position":1}
      ]
    }'::jsonb
  )::text) = 0
  and position('Private directions sentinel' in public.get_public_cottage_profile(
    'en', 'cottage-30000000000040008000000000002801', '{
      "from":"2099-08-21","to":"2099-08-21","guests":1,
      "amenities":[],"selections":[
        {"serviceDay":"2099-08-21","kind":"shift","position":1}
      ]
    }'::jsonb
  )::text) = 0
  and position('Private moderation reason sentinel' in public.get_public_cottage_profile(
    'en', 'cottage-30000000000040008000000000002801', '{
      "from":"2099-08-21","to":"2099-08-21","guests":1,
      "amenities":[],"selections":[
        {"serviceDay":"2099-08-21","kind":"shift","position":1}
      ]
    }'::jsonb
  )::text) = 0,
  'anonymous Cottage Profiles omit private location and moderation sentinels'
);
select results_eq(
  $$select array_agg(key order by key)
    from jsonb_object_keys(public.get_public_cottage_facets('en')) keys(key)$$,
  $$values (array['amenities','areas','governorates']::text[])$$,
  'anonymous facets return only their exact safe projection'
);
select results_eq(
  $$with default_search as (
      select public.get_default_public_cottage_search(
        'cottage-30000000000040008000000000002801'
      ) as value
    )
    select (selection ->> 'position')::integer
    from default_search,
      jsonb_array_elements(default_search.value -> 'selections') selection
    order by (selection ->> 'position')::integer$$,
  $$with default_search as (
      select public.get_default_public_cottage_search(
        'cottage-30000000000040008000000000002801'
      ) as value
    )
    select shifts.position::integer
    from default_search
    cross join (values
      (1, '08:00'::time),
      (2, '18:00'::time)
    ) shifts(position, start_time)
    where (((default_search.value ->> 'from')::date + shifts.start_time)
      at time zone 'Asia/Baghdad') > now()
    order by shifts.position$$,
  'a direct Cottage Profile defaults to every remaining Shift on its Service Day'
);
select results_eq(
  $$select (result ->> 'totalPriceIqd')::bigint,
      jsonb_array_length(result -> 'selectedInventory'),
      result -> 'selectedInventory' -> 0 ->> 'name'
    from public.search_public_cottages('en', '{
      "from":"2099-08-21","to":"2099-08-21","guests":6,
      "amenities":["pool"],"selections":[
        {"serviceDay":"2099-08-21","kind":"shift","position":1},
        {"serviceDay":"2099-08-21","kind":"shift","position":2}
      ]
    }'::jsonb) result$$,
  $$values (210000::bigint, 2, 'Morning'::text)$$,
  'same-day multiple Cottage Shifts require all components and expose names and effective prices'
);
reset role;

update public.cottage_inventory_availability set state = 'closed'
where schedule_revision_id = (
  select current_shift_schedule_id from public.owner_application_cottage_profiles
  where id = '30000000-0000-4000-8000-000000002801'
) and service_day = '2099-08-21';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*) from public.search_public_cottages('en', '{
  "from":"2099-08-21","to":"2099-08-21","guests":1,"amenities":[],
  "selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]
}'::jsonb)), 0::bigint, 'an all-closed published Cottage stays out of search');
select is(
  public.get_public_cottage_profile('en',
    'cottage-30000000000040008000000000002801', '{
      "from":"2099-08-21","to":"2099-08-21","guests":1,"amenities":[],
      "selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]
    }'::jsonb
  ) -> 'selectedInventory' -> 0 ->> 'available',
  'false',
  'the same all-closed Cottage Profile remains visible with safe unavailable inventory'
);
reset role;
update public.cottage_inventory_availability set state = 'open'
where schedule_revision_id = (
  select current_shift_schedule_id from public.owner_application_cottage_profiles
  where id = '30000000-0000-4000-8000-000000002801'
) and service_day = '2099-08-21';

update public.cottage_marketplace_listings set state = 'paused'
where profile_id = '30000000-0000-4000-8000-000000002801';
select set_config(
  'rentcottage.test_schedule_id',
  (select current_shift_schedule_id::text
    from public.owner_application_cottage_profiles
    where id = '30000000-0000-4000-8000-000000002801'),
  true
);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(
  $$select public.resolve_current_cottage_publication_media(
    '41000000-0000-4000-8000-000000002801'
  )$$,
  'RC204', null,
  'pausing a Cottage immediately revokes its opaque publication-media URL'
);
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*) from public.search_public_cottages('en', '{
  "from":"2099-08-21","to":"2099-08-21","guests":1,"amenities":[],
  "selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]
}'::jsonb)), 0::bigint, 'a paused Cottage is excluded from anonymous search');
select throws_ok(
  $$select public.resolve_cottage_inventory_public_availability(
    '30000000-0000-4000-8000-000000002801',
    current_setting('rentcottage.test_schedule_id')::uuid, '2099-08-21'
  )$$,
  'RC204', null, 'legacy public availability also excludes a paused Cottage'
);
select is((select count(*) from public.get_current_cottage_publication(
  '30000000-0000-4000-8000-000000002801', 'en'
)), 0::bigint, 'legacy publication projection also excludes a paused Cottage');
reset role;

insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
) values (
  '32000000-0000-4000-8000-000000002802',
  '30000000-0000-4000-8000-000000002801',
  '00000000-0000-0000-0000-000000002801',
  '31000000-0000-4000-8000-000000002801',
  'Discovery Cottage', 'Baghdad', 'Abu Ghraib', 8, 3, 2,
  array['pool','wifi'], 2, 'approved', now()
);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
) values (
  '34000000-0000-4000-8000-000000002802',
  '30000000-0000-4000-8000-000000002801',
  '32000000-0000-4000-8000-000000002802', 2,
  'Discovery Cottage', 'Baghdad', 'Abu Ghraib', 8, 3, 2,
  array['pool','wifi']
);
update public.owner_application_cottage_profiles
set current_publication_id = '34000000-0000-4000-8000-000000002802'
where id = '30000000-0000-4000-8000-000000002801';
select is(
  (select state::text from public.cottage_marketplace_listings
    where profile_id = '30000000-0000-4000-8000-000000002801'),
  'paused',
  'republication preserves an existing paused marketplace decision'
);

update public.cottage_marketplace_listings set state = 'suspended'
where profile_id = '30000000-0000-4000-8000-000000002801';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*) from public.search_public_cottages('en', '{
  "from":"2099-08-21","to":"2099-08-21","guests":1,"amenities":[],
  "selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]
}'::jsonb)), 0::bigint, 'a suspended Cottage is excluded from anonymous search');
reset role;

insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
) values (
  '32000000-0000-4000-8000-000000002803',
  '30000000-0000-4000-8000-000000002801',
  '00000000-0000-0000-0000-000000002801',
  '31000000-0000-4000-8000-000000002801',
  'Discovery Cottage', 'Baghdad', 'Abu Ghraib', 8, 3, 2,
  array['pool','wifi'], 3, 'approved', now()
);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
) values (
  '34000000-0000-4000-8000-000000002803',
  '30000000-0000-4000-8000-000000002801',
  '32000000-0000-4000-8000-000000002803', 3,
  'Discovery Cottage', 'Baghdad', 'Abu Ghraib', 8, 3, 2,
  array['pool','wifi']
);
update public.owner_application_cottage_profiles
set current_publication_id = '34000000-0000-4000-8000-000000002803'
where id = '30000000-0000-4000-8000-000000002801';
select is(
  (select state::text from public.cottage_marketplace_listings
    where profile_id = '30000000-0000-4000-8000-000000002801'),
  'suspended',
  'republication preserves an existing suspended marketplace decision'
);

update public.cottage_marketplace_listings set state = 'published'
where profile_id = '30000000-0000-4000-8000-000000002801';
update public.account_contexts set owner_approval_state = 'suspended'
where user_id = '00000000-0000-0000-0000-000000002801';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*) from public.search_public_cottages('en', '{
  "from":"2099-08-21","to":"2099-08-21","guests":1,"amenities":[],
  "selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]
}'::jsonb)), 0::bigint, 'an unapproved Cottage Owner excludes every Cottage from anonymous search');
reset role;

update public.owner_application_cottage_profiles
set current_publication_id = '34000000-0000-4000-8000-000000002801'
where id = '30000000-0000-4000-8000-000000002802';
select is((select count(*) from public.cottage_marketplace_listings
  where profile_id = '30000000-0000-4000-8000-000000002802'), 0::bigint,
  'registration rejects a current-publication pointer that belongs to another Cottage Profile');

select * from finish();
rollback;
