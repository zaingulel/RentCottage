begin;
select plan(105);

select has_table(
  'public', 'cottage_marketplace_listings',
  'Cottage marketplace lifecycle is separate from publication history'
);
select has_function(
  'public', 'search_public_cottages',
  array['public.cottage_profile_source_language', 'jsonb', 'text', 'integer'],
  'anonymous Cottage discovery has one validated search boundary'
);
select hasnt_function(
  'public', 'search_public_cottages', array['public.cottage_profile_source_language', 'jsonb'],
  'the unpaged Cottage search signature is gone'
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
  has_function_privilege('anon', 'public.search_public_cottages(public.cottage_profile_source_language,jsonb,text,integer)', 'execute')
    and not has_table_privilege('anon', 'public.cottage_marketplace_listings', 'select'),
  'anonymous callers execute discovery without direct lifecycle-table access'
);
select ok(
  has_function_privilege('authenticated', 'public.search_public_cottages(public.cottage_profile_source_language,jsonb,text,integer)', 'execute'),
  'authenticated callers execute paged discovery'
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

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(format(
  'select public.search_public_cottages(''en'', %L::jsonb, null, 12)', requested_search
), '22023', null, 'discovery rejects malformed input: ' || label) from (values
  (null::text, 'SQL NULL'),
  ('null', 'JSON null'),
  ('[]', 'top-level array'),
  ('4', 'top-level scalar'),
  ('{}', 'missing required fields'),
  ('{"from":null,"to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]}', 'null from'),
  ('{"from":["2099-08-21"],"to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]}', 'array from'),
  ('{"from":"2099-02-31","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]}', 'invalid date'),
  ('{"from":"2099-08-21","to":"2099-08-20","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]}', 'reversed dates'),
  ('{"from":"2099-08-21","to":"2100-09-25","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]}', 'oversized range'),
  ('{"from":"2099-08-21","to":"2099-09-21","guests":4}', '32 Service Days'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":null,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]}', 'null guests'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":"4","selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]}', 'string guests'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":{},"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]}', 'object guests'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":0,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]}', 'zero guests'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":101,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]}', 'too many guests'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":null}', 'null selections'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":"shift"}', 'scalar selections'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":{}}', 'object selections'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[null]}', 'null selection'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[4]}', 'scalar selection'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"unknown","position":1}]}', 'unknown kind'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift"}]}', 'missing shift position'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":4}]}', 'out-of-range shift position'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"full-day","position":1}]}', 'bundle with a position'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-22","kind":"shift","position":1}]}', 'selection outside range'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1},{"serviceDay":"2099-08-21","kind":"shift","position":1}]}', 'duplicate selections'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1},{"serviceDay":"2099-08-21","kind":"full-day"}]}', 'overlapping bundle and shift'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1,"privateAddress":"private"}]}', 'unknown selection key'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}],"amenities":null}', 'null amenities'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}],"amenities":"pool"}', 'scalar amenities'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}],"amenities":[null]}', 'null amenity'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}],"amenities":["private"]}', 'unknown amenity'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}],"amenities":["pool","pool"]}', 'duplicate amenities'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}],"governorate":null}', 'null governorate'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}],"area":null}', 'null area'),
  ('{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}],"exactAddress":"private"}', 'unknown query key')
) inputs(requested_search, label);
select throws_ok(format(
  'select public.search_public_cottages(''en'', ''{"from":"2099-08-21","to":"2099-08-21","guests":4}''::jsonb, %L, %s)',
  target_after_slug, target_limit
), '22023', 'Public Cottage search input is invalid', 'discovery rejects malformed paging: ' || label) from (values
  (null::text, '0', 'zero limit'),
  (null, '13', 'limit 13'),
  (null, 'null', 'null limit'),
  ('cottage-2811', '12', 'malformed continuation'),
  ('', '12', 'empty continuation'),
  ('cottage-ABCDEF00000040008000000000002811', '12', 'uppercase continuation')
) inputs(target_after_slug, target_limit, label);
select lives_ok(format(
  'select public.search_public_cottages(''en'', %L::jsonb, null, 12)',
  jsonb_build_object('from', '2099-08-21', 'to', '2099-09-20', 'guests', 100, 'selections', (
    select jsonb_agg(jsonb_build_object(
      'serviceDay', to_char(service_day, 'YYYY-MM-DD'), 'kind', 'shift', 'position', shift_position
    ))
    from generate_series('2099-08-21'::date, '2099-09-20'::date, interval '1 day') service_day
    cross join generate_series(1, 3) shift_position
  ))
), 'discovery accepts the largest permitted search');
select throws_ok(
  $$select public.get_public_cottage_profile('en', 'cottage-30000000000040008000000000002801',
    '{"from":"2099-08-21","to":"2099-09-21","guests":4}'::jsonb)$$,
  '22023', 'Public Cottage search input is invalid',
  'the Cottage Profile refuses inventory for 32 Service Days'
);
reset role;

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

select set_config(
  'rentcottage.test_schedule_id',
  (select current_shift_schedule_id::text
    from public.owner_application_cottage_profiles
    where id = '30000000-0000-4000-8000-000000002801'), true
);
select set_config('rentcottage.test_pricing', (
  select jsonb_build_object('units', jsonb_agg(jsonb_build_object(
    'unitKind', unit_kind, 'unitId', unit_id,
    'standardPriceIqd', standard_price,
    'dateOverrides', jsonb_build_array(jsonb_build_object(
      'serviceDay', '2099-08-22', 'priceIqd', second_day_price
    ))
  )))::text from (
    select 'shift' as unit_kind, shifts.id as unit_id,
      case position when 1 then 60000 else 80000 end as standard_price,
      case position when 1 then 65000 else 90000 end as second_day_price
    from public.cottage_shifts shifts
    where schedule_revision_id = current_setting('rentcottage.test_schedule_id')::uuid
    union all
    select 'full_day_bundle', full_day_bundle_id, 110000, 120000
    from public.cottage_shift_schedule_revisions
    where id = current_setting('rentcottage.test_schedule_id')::uuid
  ) units
), true);
select set_config('rentcottage.test_open_states', (
  select jsonb_agg(jsonb_build_object(
    'unitKind', unit -> 'unitKind', 'unitId', unit -> 'unitId', 'state', 'open'
  ))::text from jsonb_array_elements(current_setting('rentcottage.test_pricing')::jsonb -> 'units') unit
), true);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002801","role":"authenticated","aal":"aal1"}', true);
select lives_ok($$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000002801',
    current_setting('rentcottage.test_schedule_id')::uuid,
    current_setting('rentcottage.test_pricing')::jsonb
  ); select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000002801',
    current_setting('rentcottage.test_schedule_id')::uuid, day,
    current_setting('rentcottage.test_open_states')::jsonb
  ) from (values ('2099-08-21'::date), ('2099-08-22'::date), ('2099-08-23'::date),
    ((now() at time zone 'Asia/Baghdad')::date + 1)) days(day)$$,
  'the two-day inventory fixture uses production pricing and availability transitions');
reset role;

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
    from jsonb_object_keys(public.search_public_cottages('en', '{
      "from":"2099-08-21","to":"2099-08-21","guests":6,
      "amenities":["pool"],"selections":[
        {"serviceDay":"2099-08-21","kind":"shift","position":1},
        {"serviceDay":"2099-08-21","kind":"shift","position":2}
      ]
    }'::jsonb, null, 12) -> 'items' -> 0) keys(key)$$,
  $$values (array['amenities','approximateLocation','capacity','governorate',
    'inventory','mediaIds','name','slug']::text[])$$,
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
    }'::jsonb, null, 12) result),
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
    'capacity','description','governorate','houseRules','inventory','mediaIds','name',
    'slug']::text[])$$,
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
  $$select result -> 'items' -> 0 -> 'inventory'
    from public.search_public_cottages('en', '{
      "from":"2099-08-21","to":"2099-08-21","guests":6,
      "amenities":["pool"],"selections":[
        {"serviceDay":"2099-08-21","kind":"shift","position":1},
        {"serviceDay":"2099-08-21","kind":"shift","position":2}
      ]
    }'::jsonb, null, 12) result$$,
  $$values ('[
    {"serviceDay":"2099-08-21","kind":"shift","position":1,"name":"Morning","startTime":"08:00","endTime":"14:00","priceIqd":60000,"available":true},
    {"serviceDay":"2099-08-21","kind":"shift","position":2,"name":"Evening","startTime":"18:00","endTime":"23:00","priceIqd":80000,"available":true},
    {"serviceDay":"2099-08-21","kind":"full-day","name":"Full-day bundle","startTime":"08:00","endTime":"23:00","priceIqd":110000,"available":true}
  ]'::jsonb)$$,
  'same-day multiple Cottage Shifts require all filters and project every offered option without a total'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002801","role":"authenticated","aal":"aal1"}', true);
select public.set_cottage_inventory_availability(
  '30000000-0000-4000-8000-000000002801', current_setting('rentcottage.test_schedule_id')::uuid,
  '2099-08-21', (
    select jsonb_agg(jsonb_build_object('unitKind', unit -> 'unitKind', 'unitId', unit -> 'unitId', 'state', 'closed'))
    from jsonb_array_elements(current_setting('rentcottage.test_pricing')::jsonb -> 'units') unit
    where unit ->> 'standardPriceIqd' in ('80000', '110000')
  )
);
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq(
  $$select result -> 'items' -> 0 -> 'inventory' from public.search_public_cottages('en',
    '{"from":"2099-08-21","to":"2099-08-22","guests":4}'::jsonb, null, 12) result$$,
  $$values ('[
    {"serviceDay":"2099-08-21","kind":"shift","position":1,"name":"Morning","startTime":"08:00","endTime":"14:00","priceIqd":60000,"available":true},
    {"serviceDay":"2099-08-21","kind":"shift","position":2,"name":"Evening","startTime":"18:00","endTime":"23:00","priceIqd":80000,"available":false},
    {"serviceDay":"2099-08-21","kind":"full-day","name":"Full-day bundle","startTime":"08:00","endTime":"23:00","priceIqd":110000,"available":false},
    {"serviceDay":"2099-08-22","kind":"shift","position":1,"name":"Morning","startTime":"08:00","endTime":"14:00","priceIqd":65000,"available":true},
    {"serviceDay":"2099-08-22","kind":"shift","position":2,"name":"Evening","startTime":"18:00","endTime":"23:00","priceIqd":90000,"available":true},
    {"serviceDay":"2099-08-22","kind":"full-day","name":"Full-day bundle","startTime":"08:00","endTime":"23:00","priceIqd":120000,"available":true}
  ]'::jsonb)$$,
  'day-first discovery projects exact two-day prices and safe partial availability'
);
select results_eq(format(
  'select jsonb_array_length(public.search_public_cottages(''en'', %L::jsonb, null, 12) -> ''items'')', requested_search
), $$values (1)$$, label) from (values
  ('{"from":"2099-08-21","to":"2099-08-22","guests":4}', 'discovery accepts absent period filters'),
  ('{"from":"2099-08-21","to":"2099-08-22","guests":4,"selections":[]}', 'discovery accepts empty period filters'),
  ('{"from":"2099-08-21","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]}', 'discovery accepts filters on only some Service Days')
) inputs(requested_search, label);
select results_eq(format(
  'select jsonb_array_length(public.search_public_cottages(''en'', %L::jsonb, null, 12) -> ''items'')', requested_search
), $$values (0)$$, label) from (values
  ('{"from":"2099-08-21","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1},{"serviceDay":"2099-08-21","kind":"shift","position":2}]}', 'every explicit shift filter must be available'),
  ('{"from":"2099-08-21","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"full-day"}]}', 'an unavailable bundle filter excludes the cottage'),
  ('{"from":"2099-08-21","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":3}]}', 'a missing offered position excludes the cottage')
) inputs(requested_search, label);
select results_eq(
  $$select jsonb_array_length(public.get_public_cottage_profile('en',
    'cottage-30000000000040008000000000002801',
    '{"from":"2099-08-21","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":3}]}'::jsonb
  ) -> 'inventory')$$, $$values (6)$$,
  'a stale missing selection retains all safe profile inventory for correction'
);
select throws_ok(format(
  'select public.get_public_booking_quote(''en'', ''cottage-30000000000040008000000000002801'', %L::jsonb)', requested_search
), '22023', null, label) from (values
  ('{"from":"2099-08-21","to":"2099-08-22","guests":4,"selections":[]}', 'the quote boundary rejects empty booking selections'),
  ('{"from":"2099-08-21","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]}', 'the quote boundary rejects partial booking selections')
) inputs(requested_search, label);
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(format(
  'select public.create_pending_booking_period_hold(''00000000-0000-0000-0000-000000002802'', ''30000000-0000-4000-8000-000000002801'', ''DAY-FIRST-HOLD'', %L::jsonb)', requested_search
), '22023', null, label) from (values
  ('{"from":"2099-08-21","to":"2099-08-22","guests":4,"selections":[]}', 'the Pending Hold boundary rejects empty booking selections'),
  ('{"from":"2099-08-21","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]}', 'the Pending Hold boundary rejects partial booking selections')
) inputs(requested_search, label);
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002801","role":"authenticated","aal":"aal1"}', true);
select public.set_cottage_inventory_availability(
  '30000000-0000-4000-8000-000000002801', current_setting('rentcottage.test_schedule_id')::uuid,
  '2099-08-22', (select jsonb_agg(unit || '{"state":"closed"}'::jsonb)
    from jsonb_array_elements(current_setting('rentcottage.test_open_states')::jsonb) unit)
);
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq(
  $$select jsonb_array_length(public.search_public_cottages('en',
    '{"from":"2099-08-21","to":"2099-08-23","guests":4}'::jsonb, null, 12) -> 'items')$$,
  $$values (0)$$,
  'an intermediate wholly closed Service Day excludes a cottage despite available first and last days'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002801","role":"authenticated","aal":"aal1"}', true);
select public.set_cottage_inventory_availability(
  '30000000-0000-4000-8000-000000002801', current_setting('rentcottage.test_schedule_id')::uuid,
  '2099-08-22', current_setting('rentcottage.test_open_states')::jsonb
);
select public.save_cottage_inventory_pricing(
  '30000000-0000-4000-8000-000000002801', current_setting('rentcottage.test_schedule_id')::uuid,
  jsonb_build_object('units', (select jsonb_agg(unit)
    from jsonb_array_elements(current_setting('rentcottage.test_pricing')::jsonb -> 'units') unit
    where unit ->> 'standardPriceIqd' <> '80000'))
);
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq(
  $$select item -> 'priceIqd', item -> 'available', item ? 'priceIqd'
    from jsonb_array_elements(public.get_public_cottage_profile('en',
      'cottage-30000000000040008000000000002801',
      '{"from":"2099-08-21","to":"2099-08-21","guests":4}'::jsonb
    ) -> 'inventory') item where item ->> 'kind' = 'shift' and item ->> 'position' = '2'$$,
  $$values ('null'::jsonb, 'false'::jsonb, true)$$,
  'unpriced profile inventory retains explicit null price and unavailable state'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002801","role":"authenticated","aal":"aal1"}', true);
select public.save_cottage_inventory_pricing(
  '30000000-0000-4000-8000-000000002801', current_setting('rentcottage.test_schedule_id')::uuid,
  current_setting('rentcottage.test_pricing')::jsonb
);
reset role;

update public.cottage_inventory_availability set state = 'closed'
where schedule_revision_id = (
  select current_shift_schedule_id from public.owner_application_cottage_profiles
  where id = '30000000-0000-4000-8000-000000002801'
) and service_day = '2099-08-21';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(jsonb_array_length(public.search_public_cottages('en', '{
  "from":"2099-08-21","to":"2099-08-21","guests":1,"amenities":[],
  "selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]
}'::jsonb, null, 12) -> 'items'), 0,'an all-closed published Cottage stays out of search');
select is(
  public.get_public_cottage_profile('en',
    'cottage-30000000000040008000000000002801', '{
      "from":"2099-08-21","to":"2099-08-21","guests":1,"amenities":[],
      "selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]
    }'::jsonb
  ) -> 'inventory' -> 0 ->> 'available',
  'false',
  'the same all-closed Cottage Profile remains visible with safe unavailable inventory'
);
reset role;
update public.cottage_inventory_availability set state = 'open'
where schedule_revision_id = (
  select current_shift_schedule_id from public.owner_application_cottage_profiles
  where id = '30000000-0000-4000-8000-000000002801'
) and service_day = '2099-08-21';

savepoint inventory_unit_rows;
insert into public.cottage_inventory_weekday_price_overrides (
  schedule_revision_id, unit_kind, unit_id, weekday, price_iqd
)
select shifts.schedule_revision_id, 'shift', shifts.id,
  extract(dow from weekdays.service_day)::smallint, weekdays.price_iqd
from public.cottage_shifts shifts
cross join (values
  ('2099-08-22'::date, 71000), ('2099-08-23'::date, 70000)
) weekdays(service_day, price_iqd)
where shifts.schedule_revision_id = current_setting('rentcottage.test_schedule_id')::uuid
  and shifts.position = 1;
update public.cottage_inventory_availability availability set state = 'closed'
from public.cottage_shifts shifts
where shifts.schedule_revision_id = current_setting('rentcottage.test_schedule_id')::uuid
  and shifts.position = 2
  and availability.schedule_revision_id = shifts.schedule_revision_id
  and availability.unit_kind = 'shift' and availability.unit_id = shifts.id
  and availability.service_day = '2099-08-23';
insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select availability.schedule_revision_id, availability.unit_kind, availability.unit_id,
  (now() at time zone 'Asia/Baghdad')::date - 1, 'open'
from public.cottage_inventory_availability availability
where availability.schedule_revision_id = current_setting('rentcottage.test_schedule_id')::uuid
  and availability.service_day = '2099-08-22';
prepare inventory_units_from_helpers(date, date) as
  with units as (
    select shifts.id as unit_id,
      'shift'::public.cottage_inventory_unit_kind as unit_kind,
      shifts.position, shifts.name, shifts.start_time, shifts.end_time
    from public.cottage_shifts shifts
    where shifts.schedule_revision_id = current_setting('rentcottage.test_schedule_id')::uuid
    union all
    select schedules.full_day_bundle_id,
      'full_day_bundle'::public.cottage_inventory_unit_kind,
      null::smallint, 'Full-day bundle'::text,
      (select shifts.start_time from public.cottage_shifts shifts
        where shifts.schedule_revision_id = schedules.id order by shifts.position limit 1),
      (select shifts.end_time from public.cottage_shifts shifts
        where shifts.schedule_revision_id = schedules.id order by shifts.position desc limit 1)
    from public.cottage_shift_schedule_revisions schedules
    where schedules.id = current_setting('rentcottage.test_schedule_id')::uuid
  )
  select days.service_day::date, units.unit_kind, units.position, units.name,
    units.start_time, units.end_time,
    public.public_cottage_effective_price(
      current_setting('rentcottage.test_schedule_id')::uuid,
      units.unit_kind, units.unit_id, days.service_day::date
    ),
    coalesce(public.public_cottage_unit_is_available(
      current_setting('rentcottage.test_schedule_id')::uuid,
      units.unit_kind, units.unit_id, days.service_day::date
    ), false)
  from generate_series($1::timestamp, $2::timestamp, interval '1 day') days(service_day)
  cross join units;
select set_eq(
  $$select * from public.public_cottage_inventory_units(
    current_setting('rentcottage.test_schedule_id')::uuid, '2099-08-21', '2099-08-23'
  )$$,
  $$execute inventory_units_from_helpers('2099-08-21', '2099-08-23')$$,
  'set-based inventory unit rows match the unit helpers across date, weekday and standard prices and a closed shift'
);
delete from public.cottage_inventory_standard_prices prices
using public.cottage_shifts shifts
where shifts.schedule_revision_id = current_setting('rentcottage.test_schedule_id')::uuid
  and shifts.position = 2
  and prices.schedule_revision_id = shifts.schedule_revision_id
  and prices.unit_kind = 'shift' and prices.unit_id = shifts.id;
select set_eq(
  $$select * from public.public_cottage_inventory_units(
    current_setting('rentcottage.test_schedule_id')::uuid,
    (now() at time zone 'Asia/Baghdad')::date - 1, (now() at time zone 'Asia/Baghdad')::date + 1
  )$$,
  $$execute inventory_units_from_helpers(
    (now() at time zone 'Asia/Baghdad')::date - 1, (now() at time zone 'Asia/Baghdad')::date + 1
  )$$,
  'set-based inventory unit rows match the unit helpers for past, missing and unpriced open inventory'
);
select ok(
  not has_function_privilege('anon', 'public.public_cottage_inventory_units(uuid, date, date)', 'execute')
  and not has_function_privilege('authenticated', 'public.public_cottage_inventory_units(uuid, date, date)', 'execute')
  and not has_function_privilege('service_role', 'public.public_cottage_inventory_units(uuid, date, date)', 'execute'),
  'no API role can execute the set-based inventory unit rows'
);
select ok(
  not has_function_privilege('anon', 'public.validate_public_cottage_discovery_admission(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.validate_public_cottage_discovery_admission(jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.validate_public_cottage_discovery_admission(jsonb)', 'execute'),
  'no API role can execute the discovery admission validator'
);
rollback to savepoint inventory_unit_rows;

update public.cottage_marketplace_listings set state = 'paused'
where profile_id = '30000000-0000-4000-8000-000000002801';
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
select is(jsonb_array_length(public.search_public_cottages('en', '{
  "from":"2099-08-21","to":"2099-08-21","guests":1,"amenities":[],
  "selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]
}'::jsonb, null, 12) -> 'items'), 0,'a paused Cottage is excluded from anonymous search');
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
select is(jsonb_array_length(public.search_public_cottages('en', '{
  "from":"2099-08-21","to":"2099-08-21","guests":1,"amenities":[],
  "selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]
}'::jsonb, null, 12) -> 'items'), 0,'a suspended Cottage is excluded from anonymous search');
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
select is(jsonb_array_length(public.search_public_cottages('en', '{
  "from":"2099-08-21","to":"2099-08-21","guests":1,"amenities":[],
  "selections":[{"serviceDay":"2099-08-21","kind":"shift","position":1}]
}'::jsonb, null, 12) -> 'items'), 0,'an unapproved Cottage Owner excludes every Cottage from anonymous search');
reset role;

update public.owner_application_cottage_profiles
set current_publication_id = '34000000-0000-4000-8000-000000002801'
where id = '30000000-0000-4000-8000-000000002802';
select is((select count(*) from public.cottage_marketplace_listings
  where profile_id = '30000000-0000-4000-8000-000000002802'), 0::bigint,
  'registration rejects a current-publication pointer that belongs to another Cottage Profile');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select public.validate_public_cottage_discovery(
  '{"from":"2099-08-21","to":"2099-08-21","guests":4}'::jsonb
)$$, '42501', null, 'anonymous callers cannot execute the private discovery validator');
select throws_ok($$select public.resolve_public_cottage_inventory(
  current_setting('rentcottage.test_schedule_id')::uuid, '2099-08-21', '2099-08-22'
)$$, '42501', null, 'anonymous callers cannot enumerate inventory through the private helper');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002801","role":"authenticated","aal":"aal1"}', true);
select throws_ok($$select public.validate_public_cottage_discovery(
  '{"from":"2099-08-21","to":"2099-08-21","guests":4}'::jsonb
)$$, '42501', null, 'authenticated callers cannot execute the private discovery validator');
select throws_ok($$select public.resolve_public_cottage_inventory(
  current_setting('rentcottage.test_schedule_id')::uuid, '2099-08-21', '2099-08-22'
)$$, '42501', null, 'authenticated callers cannot enumerate inventory through the private helper');
reset role;

insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values (
  '00000000-0000-0000-0000-000000002803', 'authenticated', 'authenticated',
  '+9647500002803', now()
);
insert into public.account_contexts (user_id, role, owner_approval_state)
values ('00000000-0000-0000-0000-000000002803', 'cottage_owner', 'approved');
insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  exact_latitude, exact_longitude, private_directions, capacity, bedrooms,
  bathrooms, amenities, source_language, description, house_rules, status
)
select ('30000000-0000-4000-8000-00000000' || cottage)::uuid,
  '00000000-0000-0000-0000-000000002803', 'Paged Cottage ' || cottage, 'Erbil',
  'Shaqlawa', 'Paged private address', 36.2, 44.3, 'Paged private directions',
  4, 2, 1, array['wifi'], 'en', 'Paged description', 'Paged rules', 'draft'
from (values ('2811'), ('2812'), ('2813'), ('2814')) cottages(cottage);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002803","role":"authenticated","aal":"aal1"}', true);
select public.replace_cottage_shift_schedule(
  ('30000000-0000-4000-8000-00000000' || cottage)::uuid, 0,
  '[{"name":"Morning","startTime":"08:00","endTime":"14:00"},{"name":"Evening","startTime":"18:00","endTime":"23:00"}]'
) from (values ('2811'), ('2812'), ('2813'), ('2814')) cottages(cottage);
reset role;
insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules, revision
)
select ('31000000-0000-4000-8000-00000000' || cottage)::uuid,
  ('30000000-0000-4000-8000-00000000' || cottage)::uuid,
  '00000000-0000-0000-0000-000000002803', 'en', 'Paged description', 'Paged rules', 1
from (values ('2811'), ('2812'), ('2813'), ('2814')) cottages(cottage);
insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
)
select ('32000000-0000-4000-8000-00000000' || cottage)::uuid,
  ('30000000-0000-4000-8000-00000000' || cottage)::uuid,
  '00000000-0000-0000-0000-000000002803',
  ('31000000-0000-4000-8000-00000000' || cottage)::uuid,
  'Paged Cottage ' || cottage, 'Erbil', 'Shaqlawa', 4, 2, 1, array['wifi'], 1, 'approved', now()
from (values ('2811'), ('2812'), ('2813'), ('2814')) cottages(cottage);
insert into public.cottage_profile_localized_revisions (
  id, review_cycle_id, locale, revision, origin, description, house_rules
)
select ('33000000-0000-4000-8000-00000000' || cottage)::uuid,
  ('32000000-0000-4000-8000-00000000' || cottage)::uuid,
  'en', 1, 'owner_source', 'Paged description', 'Paged rules'
from (values ('2811'), ('2812'), ('2813'), ('2814')) cottages(cottage);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
)
select ('34000000-0000-4000-8000-00000000' || cottage)::uuid,
  ('30000000-0000-4000-8000-00000000' || cottage)::uuid,
  ('32000000-0000-4000-8000-00000000' || cottage)::uuid, 1,
  'Paged Cottage ' || cottage, 'Erbil', 'Shaqlawa', 4, 2, 1, array['wifi']
from (values ('2811'), ('2812'), ('2813'), ('2814')) cottages(cottage);
insert into public.cottage_publication_localizations (
  publication_id, locale, localized_revision_id, description, house_rules
)
select ('34000000-0000-4000-8000-00000000' || cottage)::uuid, 'en',
  ('33000000-0000-4000-8000-00000000' || cottage)::uuid, 'Paged description', 'Paged rules'
from (values ('2811'), ('2812'), ('2813'), ('2814')) cottages(cottage);
update public.owner_application_cottage_profiles
set current_publication_id = ('34' || substr(id::text, 3))::uuid
where owner_user_id = '00000000-0000-0000-0000-000000002803';
select set_config('rentcottage.test_paged_inventory', (
  select jsonb_agg(jsonb_build_object(
    'profileId', profiles.id, 'scheduleId', profiles.current_shift_schedule_id,
    'pricing', jsonb_build_object('units', shifts.prices), 'openStates', shifts.open_states
  ))::text
  from public.owner_application_cottage_profiles profiles
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
        'unitKind', 'shift', 'unitId', cottage_shifts.id, 'standardPriceIqd', 50000
      )) as prices,
      jsonb_agg(jsonb_build_object(
        'unitKind', 'shift', 'unitId', cottage_shifts.id, 'state', 'open'
      )) as open_states
    from public.cottage_shifts
    where cottage_shifts.schedule_revision_id = profiles.current_shift_schedule_id
  ) shifts
  where profiles.owner_user_id = '00000000-0000-0000-0000-000000002803'
), true);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002803","role":"authenticated","aal":"aal1"}', true);
select public.save_cottage_inventory_pricing(
    (cottage ->> 'profileId')::uuid, (cottage ->> 'scheduleId')::uuid, cottage -> 'pricing'
  ), public.set_cottage_inventory_availability(
    (cottage ->> 'profileId')::uuid, (cottage ->> 'scheduleId')::uuid, '2099-08-21',
    cottage -> 'openStates'
  )
from jsonb_array_elements(current_setting('rentcottage.test_paged_inventory')::jsonb) cottage;
reset role;
update public.cottage_marketplace_listings set state = 'paused'
where profile_id = '30000000-0000-4000-8000-000000002812';

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq(
  $$with first_page as (
      select public.search_public_cottages('en',
        '{"from":"2099-08-21","to":"2099-08-21","guests":1}'::jsonb, null, 2) as page
    ), second_page as (
      select public.search_public_cottages('en',
        '{"from":"2099-08-21","to":"2099-08-21","guests":1}'::jsonb,
        first_page.page ->> 'nextCursor', 2) as page
      from first_page
    )
    select jsonb_path_query_array(first_page.page, '$.items[*].slug'),
      first_page.page -> 'nextCursor',
      jsonb_path_query_array(second_page.page, '$.items[*].slug'),
      second_page.page -> 'nextCursor'
    from first_page, second_page$$,
  $$values (
    '["cottage-30000000000040008000000000002811","cottage-30000000000040008000000000002813"]'::jsonb,
    '"cottage-30000000000040008000000000002813"'::jsonb,
    '["cottage-30000000000040008000000000002814"]'::jsonb,
    'null'::jsonb
  )$$,
  'paged search returns every eligible cottage exactly once across pages'
);
select results_eq(
  $$select jsonb_path_query_array(public.search_public_cottages('en',
      '{"from":"2099-08-21","to":"2099-08-21","guests":1}'::jsonb, pages.target_after_slug, 2
    ), '$.items[*].slug')
    from (values
      (1, null),
      (2, 'cottage-30000000000040008000000000002811'),
      (3, 'cottage-30000000000040008000000000002812')
    ) pages(page_order, target_after_slug)
    order by pages.page_order$$,
  $$values
    ('["cottage-30000000000040008000000000002811","cottage-30000000000040008000000000002813"]'::jsonb),
    ('["cottage-30000000000040008000000000002813","cottage-30000000000040008000000000002814"]'::jsonb),
    ('["cottage-30000000000040008000000000002813","cottage-30000000000040008000000000002814"]'::jsonb)$$,
  'paged search never returns an undiscoverable cottage on any page'
);
reset role;
update public.cottage_marketplace_listings set state = 'paused'
where profile_id = '30000000-0000-4000-8000-000000002813';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq(
  $$select jsonb_path_query_array(page, '$.items[*].slug'), page -> 'nextCursor'
    from public.search_public_cottages('en',
      '{"from":"2099-08-21","to":"2099-08-21","guests":1}'::jsonb,
      'cottage-30000000000040008000000000002813', 2) page$$,
  $$values ('["cottage-30000000000040008000000000002814"]'::jsonb, 'null'::jsonb)$$,
  'paged search continues past a cottage that stops matching'
);
select is(
  public.search_public_cottages('en',
    '{"from":"2099-08-21","to":"2099-08-21","guests":1}'::jsonb,
    'cottage-30000000000040008000000000002814', 2),
  '{"items":[],"nextCursor":null}'::jsonb,
  'a continuation past the last cottage returns an empty final page'
);
reset role;

select * from finish();
rollback;
