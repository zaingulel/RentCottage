begin;

create extension if not exists pgtap with schema extensions;
select plan(49);

insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values (
  '00000000-0000-0000-0000-000000002601', 'authenticated', 'authenticated',
  '+9647500002601', now()
);
insert into public.account_contexts (user_id, role, owner_approval_state)
values ('00000000-0000-0000-0000-000000002601', 'cottage_owner', 'approved');
insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, amenities, source_language, description,
  house_rules, status
) values (
  '30000000-0000-4000-8000-000000002601',
  '00000000-0000-0000-0000-000000002601',
  'Pricing Cottage', 'Erbil', 'Near Shaqlawa', 'Private address',
  8, 3, 2, array['garden'], 'en', 'Description', 'Rules', 'draft'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select lives_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002601', 0,
    '[{"name":"Morning","startTime":"08:00","endTime":"12:00"},{"name":"Evening","startTime":"18:00","endTime":"22:00"}]'
  )$$,
  'an approved owner can create a schedule for pricing'
);
create temporary table pricing_revision_before_replace as
select current_shift_schedule_id as revision_id,
  (select id from public.cottage_shifts order by position limit 1) as shift_id
from public.owner_application_cottage_profiles
where id = '30000000-0000-4000-8000-000000002601';
select throws_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    jsonb_build_object('units', jsonb_build_array(jsonb_build_object(
      'unitId', (select id from public.cottage_shifts order by position limit 1),
      'unitKind', 'shift',
      'standardPriceIqd', 0
    )))
  )$$,
  '22023', null,
  'zero IQD pricing is rejected before persistence'
);
reset role;
select is(
  (select count(*) from public.cottage_inventory_standard_prices),
  0::bigint,
  'rejected pricing creates no standard price row'
);

select lives_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    jsonb_build_object('units', jsonb_build_array(jsonb_build_object(
      'unitId', (select id from public.cottage_shifts order by position limit 1),
      'unitKind', 'shift',
      'standardPriceIqd', 100000,
      'weekdayOverrides', jsonb_build_array(jsonb_build_object(
        'weekday', 4, 'priceIqd', 150000
      )),
      'dateOverrides', jsonb_build_array(jsonb_build_object(
        'serviceDay', '2099-08-20', 'priceIqd', 180000
      ))
    ), jsonb_build_object(
      'unitId', (select full_day_bundle_id
        from public.cottage_shift_schedule_revisions
        where id = (select revision_id from pricing_revision_before_replace)),
      'unitKind', 'full_day_bundle',
      'standardPriceIqd', 250000
    )))
  )$$,
  'an owner can save positive whole-IQD standard and override prices'
);
select results_eq(
  $$select (item ->> 'priceIqd')::bigint
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'id' = (select shift_id::text from pricing_revision_before_replace)$$,
  $$values (180000::bigint)$$,
  'a specific-date price overrides weekday and standard pricing'
);
select results_eq(
  $$select (item ->> 'priceIqd')::bigint
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-27'
    ) -> 'units') item
    where item ->> 'id' = (select shift_id::text from pricing_revision_before_replace)$$,
  $$values (150000::bigint)$$,
  'a weekday price overrides the standard price'
);
select results_eq(
  $$select (item ->> 'priceIqd')::bigint
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-21'
    ) -> 'units') item
    where item ->> 'id' = (select id::text from public.cottage_shifts order by position limit 1)$$,
  $$values (100000::bigint)$$,
  'the standard price applies when no override matches'
);
reset role;
insert into public.cottage_inventory_date_price_overrides (
  schedule_revision_id, unit_kind, unit_id, service_day, price_iqd
) values (
  (select revision_id from pricing_revision_before_replace),
  'shift', (select shift_id from pricing_revision_before_replace),
  '2000-01-01', 99000
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select results_eq(
  $$select jsonb_array_length(item -> 'dateOverrides')
    from jsonb_array_elements(public.load_cottage_inventory_owner_editor_state(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      null
    ) -> 'units') item
    where item ->> 'id' = (select shift_id::text from pricing_revision_before_replace)$$,
  $$values (1)$$,
  'the owner editor exposes the future date override but not immutable elapsed history'
);
select lives_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    jsonb_build_object('units', jsonb_build_array(jsonb_build_object(
      'unitId', (select id from public.cottage_shifts order by position limit 1),
      'unitKind', 'shift',
      'standardPriceIqd', 125000,
      'weekdayOverrides', jsonb_build_array(jsonb_build_object(
        'weekday', 4, 'priceIqd', 160000
      ))
    ), jsonb_build_object(
      'unitId', (select full_day_bundle_id
        from public.cottage_shift_schedule_revisions
        where id = (select revision_id from pricing_revision_before_replace)),
      'unitKind', 'full_day_bundle',
      'standardPriceIqd', 250000
    )))
  )$$,
  'a repeated pricing save updates a retained unit and accepts removed overrides'
);
select results_eq(
  $$select (item ->> 'priceIqd')::bigint
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'id' = (select shift_id::text from pricing_revision_before_replace)$$,
  $$values (160000::bigint)$$,
  'a repeated save replaces the specific-date price with the retained weekday price'
);
select results_eq(
  $$select (item ->> 'priceIqd')::bigint
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-21'
    ) -> 'units') item
    where item ->> 'id' = (select shift_id::text from pricing_revision_before_replace)$$,
  $$values (125000::bigint)$$,
  'a repeated save replaces the retained standard price'
);
select results_eq(
  $$select (item ->> 'priceIqd')::bigint
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2000-01-01'
    ) -> 'units') item
    where item ->> 'id' = (select shift_id::text from pricing_revision_before_replace)$$,
  $$values (99000::bigint)$$,
  'a future pricing replacement preserves the elapsed date override unchanged'
);
select results_eq(
  $$select item ->> 'standardPriceIqd',
      (item -> 'weekdayOverrides' -> 0 ->> 'priceIqd')::bigint,
      jsonb_array_length(item -> 'dateOverrides')
    from jsonb_array_elements(public.load_cottage_inventory_owner_editor_state(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      null
    ) -> 'units') item
    where item ->> 'id' = (select shift_id::text from pricing_revision_before_replace)$$,
  $$values ('125000'::text, 160000::bigint, 0)$$,
  'the owner editor read boundary returns persisted standard and override pricing'
);
reset role;
update public.account_contexts
set owner_approval_state = 'expired'
where user_id = '00000000-0000-0000-0000-000000002601';
set local role authenticated;
select lives_ok(
  $$select public.load_cottage_inventory_owner_editor_state(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    null
  )$$,
  'an expired Cottage Owner can read their persisted inventory state'
);
select throws_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    jsonb_build_object('units', jsonb_build_array(jsonb_build_object(
      'unitId', (select shift_id from pricing_revision_before_replace),
      'unitKind', 'shift', 'standardPriceIqd', 130000
    )))
  )$$,
  '42501', null,
  'an expired Cottage Owner cannot write pricing'
);
reset role;
update public.account_contexts
set owner_approval_state = 'suspended'
where user_id = '00000000-0000-0000-0000-000000002601';
set local role authenticated;
select lives_ok(
  $$select public.load_cottage_inventory_owner_editor_state(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    null
  )$$,
  'a suspended Cottage Owner can read their persisted inventory state'
);
select throws_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20', '[]'::jsonb
  )$$,
  '42501', null,
  'a suspended Cottage Owner cannot write availability'
);
reset role;
update public.account_contexts
set owner_approval_state = 'prospective'
where user_id = '00000000-0000-0000-0000-000000002601';
set local role authenticated;
select throws_ok(
  $$select public.load_cottage_inventory_owner_editor_state(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    null
  )$$,
  '42501', null,
  'a prospective Cottage Owner cannot read persisted approved-owner inventory'
);
reset role;
update public.account_contexts
set owner_approval_state = 'approved'
where user_id = '00000000-0000-0000-0000-000000002601';
insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values (
  '00000000-0000-0000-0000-000000002603', 'authenticated', 'authenticated',
  '+9647500002603', now()
);
insert into public.account_contexts (user_id, role, owner_approval_state)
values ('00000000-0000-0000-0000-000000002603', 'cottage_owner', 'approved');
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002603","role":"authenticated","aal":"aal1"}',
  true
);
select throws_ok(
  $$select public.load_cottage_inventory_owner_editor_state(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    null
  )$$,
  '42501', null,
  'another approved Cottage Owner cannot read this Cottage Profile inventory'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
reset role;
set local role authenticated;
select throws_ok(
  $$insert into public.cottage_inventory_standard_prices (
    schedule_revision_id, unit_kind, unit_id, price_iqd
  ) values (
    (select revision_id from pricing_revision_before_replace),
    'shift', (select id from public.cottage_shifts order by position limit 1), 200000
  )$$,
  '42501', null,
  'authenticated owners cannot write standard price tables directly'
);

select throws_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20',
    jsonb_build_array(jsonb_build_object(
      'unitId', (select id from public.cottage_shifts order by position limit 1),
      'unitKind', 'shift', 'state', 'open'
    ))
  )$$,
  'RC203', null,
  'an owner cannot open inventory before publication'
);

reset role;
insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules,
  revision
) values (
  '40000000-0000-4000-8000-000000002601',
  '30000000-0000-4000-8000-000000002601',
  '00000000-0000-0000-0000-000000002601', 'en', 'Description', 'Rules', 1
);
insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
) values (
  '50000000-0000-4000-8000-000000002601',
  '30000000-0000-4000-8000-000000002601',
  '00000000-0000-0000-0000-000000002601',
  '40000000-0000-4000-8000-000000002601', 'Pricing Cottage', 'Erbil',
  'Near Shaqlawa', 8, 3, 2, array['garden'], 1, 'approved', now()
);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
) values (
  '60000000-0000-4000-8000-000000002601',
  '30000000-0000-4000-8000-000000002601',
  '50000000-0000-4000-8000-000000002601', 1, 'Pricing Cottage', 'Erbil',
  'Near Shaqlawa', 8, 3, 2, array['garden']
);
select lives_ok(
  $$update public.owner_application_cottage_profiles
    set current_publication_id = '60000000-0000-4000-8000-000000002601'
    where id = '30000000-0000-4000-8000-000000002601'$$,
  'publication enables future inventory operations'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select lives_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20',
    jsonb_build_array(jsonb_build_object(
      'unitId', (select id from public.cottage_shifts order by position limit 1),
      'unitKind', 'shift', 'state', 'open'
    ))
  )$$,
  'an owner can open an uncommitted future Cottage Shift after publication'
);
select results_eq(
  $$select (item ->> 'available')::boolean
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'id' = (select id::text from public.cottage_shifts order by position limit 1)$$,
  $$values (true)$$,
  'an opened future shift resolves as available when it has a price'
);
select throws_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20',
    jsonb_build_array(jsonb_build_object(
      'unitId', (select full_day_bundle_id from public.cottage_shift_schedule_revisions
        where id = (select current_shift_schedule_id from public.owner_application_cottage_profiles
          where id = '30000000-0000-4000-8000-000000002601')),
      'unitKind', 'full_day_bundle', 'state', 'open'
    ))
  )$$,
  'RC205', null,
  'a Full-Day Bundle cannot open while a component shift is closed'
);
select lives_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000002601',
    (select current_shift_schedule_id from public.owner_application_cottage_profiles
      where id = '30000000-0000-4000-8000-000000002601'),
    '2099-08-20',
    jsonb_build_array(jsonb_build_object(
      'unitId', (select id from public.cottage_shifts order by position offset 1 limit 1),
      'unitKind', 'shift', 'state', 'open'
    ))
  )$$,
  'an owner can store an open component state before its price is configured'
);
select throws_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000002601',
    (select current_shift_schedule_id from public.owner_application_cottage_profiles
      where id = '30000000-0000-4000-8000-000000002601'),
    '2099-08-20',
    jsonb_build_array(jsonb_build_object(
      'unitId', (select full_day_bundle_id from public.cottage_shift_schedule_revisions
        where id = (select current_shift_schedule_id from public.owner_application_cottage_profiles
          where id = '30000000-0000-4000-8000-000000002601')),
      'unitKind', 'full_day_bundle', 'state', 'open'
    ))
  )$$,
  'RC205', null,
  'a priced Full-Day Bundle cannot open while an open component has no price'
);
reset role;
select lives_ok(
  $$insert into public.cottage_inventory_availability (
    schedule_revision_id, unit_kind, unit_id, service_day, state
  ) values (
    (select revision_id from pricing_revision_before_replace),
    'full_day_bundle',
    (select full_day_bundle_id from public.cottage_shift_schedule_revisions
      where id = (select revision_id from pricing_revision_before_replace)),
    '2099-08-20', 'open'
  )$$,
  'a privileged fixture can seed an open bundle for resolver coverage'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select results_eq(
  $$select (item ->> 'available')::boolean
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'kind' = 'full_day_bundle'$$,
  $$values (false)$$,
  'a bundle resolves unavailable when an open component has no price'
);
select lives_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    jsonb_build_object('units', jsonb_build_array(
      jsonb_build_object(
        'unitId', (select id from public.cottage_shifts order by position limit 1),
        'unitKind', 'shift', 'standardPriceIqd', 125000,
        'weekdayOverrides', jsonb_build_array(jsonb_build_object(
          'weekday', 4, 'priceIqd', 160000
        ))
      ),
      jsonb_build_object(
        'unitId', (select id from public.cottage_shifts order by position offset 1 limit 1),
        'unitKind', 'shift', 'standardPriceIqd', 115000
      ),
      jsonb_build_object(
        'unitId', (select full_day_bundle_id
          from public.cottage_shift_schedule_revisions
          where id = (select revision_id from pricing_revision_before_replace)),
        'unitKind', 'full_day_bundle', 'standardPriceIqd', 250000
      )
    ))
  )$$,
  'an owner can price the previously unpriced component without changing the revision'
);
select lives_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000002601',
    (select current_shift_schedule_id from public.owner_application_cottage_profiles
      where id = '30000000-0000-4000-8000-000000002601'),
    '2099-08-20',
    jsonb_build_array(
      jsonb_build_object(
        'unitId', (select id from public.cottage_shifts order by position limit 1),
        'unitKind', 'shift', 'state', 'open'
      ),
      jsonb_build_object(
        'unitId', (select id from public.cottage_shifts order by position offset 1 limit 1),
        'unitKind', 'shift', 'state', 'open'
      ),
      jsonb_build_object(
        'unitId', (select full_day_bundle_id from public.cottage_shift_schedule_revisions
          where id = (select current_shift_schedule_id from public.owner_application_cottage_profiles
            where id = '30000000-0000-4000-8000-000000002601')),
        'unitKind', 'full_day_bundle', 'state', 'open'
      )
    )
  )$$,
  'all component shifts and the Full-Day Bundle can open together when future'
);
select lives_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000002601',
    (select current_shift_schedule_id from public.owner_application_cottage_profiles
      where id = '30000000-0000-4000-8000-000000002601'),
    '2099-08-20',
    jsonb_build_array(
      jsonb_build_object(
        'unitId', (select id from public.cottage_shifts order by position limit 1),
        'unitKind', 'shift', 'state', 'private_blocked'
      ),
      jsonb_build_object(
        'unitId', (select full_day_bundle_id from public.cottage_shift_schedule_revisions
          where id = (select current_shift_schedule_id from public.owner_application_cottage_profiles
            where id = '30000000-0000-4000-8000-000000002601')),
        'unitKind', 'full_day_bundle', 'state', 'closed'
      )
    )
  )$$,
  'an owner can private-block a future shift without a cause field'
);
select results_eq(
  $$select item ->> 'ownerState'
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'id' = (select id::text from public.cottage_shifts order by position limit 1)$$,
  $$values ('private_blocked'::text)$$,
  'the owner sees the explicit private-blocked operational state'
);
select results_eq(
  $$select item ->> 'ownerState'
    from jsonb_array_elements(public.load_cottage_inventory_owner_editor_state(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'id' = (select shift_id::text from pricing_revision_before_replace)$$,
  $$values ('private_blocked'::text)$$,
  'the owner editor read boundary returns authoritative dated availability'
);

reset role;
select lives_ok(
  $$insert into public.cottage_inventory_commitments (
    schedule_revision_id, unit_kind, unit_id, service_day,
    commitment_reference, committed_price_iqd
  ) values (
    (select revision_id from pricing_revision_before_replace),
    'shift', (select id from public.cottage_shifts order by position limit 1),
    '2099-08-20', 'RC-BOOKING-2601', 125000
  )$$,
  'a privileged fixture can seed a system-owned committed price marker'
);
insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values (
  '00000000-0000-0000-0000-000000002602', 'authenticated', 'authenticated',
  '+9647500002602', now()
);
insert into public.account_contexts (user_id, role, owner_approval_state)
values ('00000000-0000-0000-0000-000000002602', 'customer', null);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002602","role":"authenticated","aal":"aal1"}',
  true
);
select ok(
  position('ownerState' in public.resolve_cottage_inventory(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )::text) = 0
  and position('private_blocked' in public.resolve_cottage_inventory(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )::text) = 0
  and position('committed' in public.resolve_cottage_inventory(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )::text) = 0
  and position('commitmentReference' in public.resolve_cottage_inventory(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )::text) = 0
  and position('RC-BOOKING-2601' in public.resolve_cottage_inventory(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )::text) = 0,
  'customer resolution redacts private-block and commitment status and references'
);
select results_eq(
  $$select (item ->> 'priceIqd')::bigint, (item ->> 'available')::boolean
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'id' = (select shift_id::text from pricing_revision_before_replace)$$,
  $$values (160000::bigint, false)$$,
  'customer commitment conflict is generic and does not replace the current public price'
);
select throws_ok(
  $$select public.load_cottage_inventory_owner_editor_state(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )$$,
  '42501', null,
  'a customer cannot call the owner pricing and operational-state read boundary'
);

reset role;
update public.account_contexts
set owner_approval_state = 'prospective'
where user_id = '00000000-0000-0000-0000-000000002601';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select ok(
  position('ownerState' in public.resolve_cottage_inventory(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )::text) = 0
  and position('private_blocked' in public.resolve_cottage_inventory(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )::text) = 0
  and position('committed' in public.resolve_cottage_inventory(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )::text) = 0
  and position('commitmentReference' in public.resolve_cottage_inventory(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )::text) = 0
  and position('RC-BOOKING-2601' in public.resolve_cottage_inventory(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )::text) = 0,
  'a prospective Cottage Owner with a retained profile receives only generic inventory state'
);
select results_eq(
  $$select (item ->> 'priceIqd')::bigint
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'id' = (select shift_id::text from pricing_revision_before_replace)$$,
  $$values (160000::bigint)$$,
  'a prospective Cottage Owner with a retained profile cannot read the committed price'
);

reset role;
update public.account_contexts
set owner_approval_state = 'approved'
where user_id = '00000000-0000-0000-0000-000000002601';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select results_eq(
  $$select (item ->> 'priceIqd')::bigint
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select current_shift_schedule_id from public.owner_application_cottage_profiles
        where id = '30000000-0000-4000-8000-000000002601'),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'id' = (select shift_id::text from pricing_revision_before_replace)$$,
  $$values (125000::bigint)$$,
  'a committed shift preserves its committed price after owner pricing changes'
);
select results_eq(
  $$select (item ->> 'committed')::boolean
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select current_shift_schedule_id from public.owner_application_cottage_profiles
        where id = '30000000-0000-4000-8000-000000002601'),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'kind' = 'full_day_bundle'$$,
  $$values (true)$$,
  'a committed component makes its Full-Day Bundle mutually unavailable'
);
select throws_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000002601',
    (select current_shift_schedule_id from public.owner_application_cottage_profiles
      where id = '30000000-0000-4000-8000-000000002601'),
    '2099-08-20',
    jsonb_build_array(jsonb_build_object(
      'unitId', (select id from public.cottage_shifts order by position limit 1),
      'unitKind', 'shift', 'state', 'closed'
    ))
  )$$,
  'RC204', null,
  'an owner cannot change availability for committed inventory'
);
select throws_ok(
  $$insert into public.cottage_inventory_commitments (
    schedule_revision_id, unit_kind, unit_id, service_day,
    commitment_reference, committed_price_iqd
  ) values (
    (select current_shift_schedule_id from public.owner_application_cottage_profiles
      where id = '30000000-0000-4000-8000-000000002601'),
    'shift', (select id from public.cottage_shifts order by position offset 1 limit 1),
    '2099-08-20', 'RC-BOOKING-2602', 125000
  )$$,
  '42501', null,
  'an authenticated owner cannot create a system commitment marker directly'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select lives_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002601', 1,
    '[{"name":"Replacement Morning","startTime":"07:00","endTime":"11:00"},{"name":"Replacement Evening","startTime":"18:00","endTime":"22:00"}]'
  )$$,
  'replacing the current schedule creates a fresh revision'
);
select results_eq(
  $$select count(*)::integer
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select current_shift_schedule_id from public.owner_application_cottage_profiles
        where id = '30000000-0000-4000-8000-000000002601'),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'priceIqd' is null
      and item ->> 'ownerState' = 'closed'$$,
  $$values (3::integer)$$,
  'a replacement revision inherits neither prices nor availability'
);
reset role;
insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, amenities, source_language, description,
  house_rules, status
) values (
  '30000000-0000-4000-8000-000000002602',
  '00000000-0000-0000-0000-000000002601',
  'Other Cottage', 'Erbil', 'Elsewhere', 'Private address',
  4, 2, 1, array['garden'], 'en', 'Description', 'Rules', 'draft'
);
grant select on pricing_revision_before_replace to service_role;
set local role service_role;
select results_eq(
  $$select (item ->> 'priceIqd')::bigint
    from jsonb_array_elements(public.resolve_cottage_inventory(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'id' = (select shift_id::text from pricing_revision_before_replace)$$,
  $$values (125000::bigint)$$,
  'the prior revision retains its committed price for historical resolution'
);
select throws_ok(
  $$select public.resolve_cottage_inventory(
    '30000000-0000-4000-8000-000000002602',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )$$,
  '42501', null,
  'service-role resolution rejects a Shift Schedule revision from another Cottage Profile'
);

reset role;
create temporary table pricing_equality_fixture on commit drop as
select gen_random_uuid() as revision_id,
  gen_random_uuid() as shift_id,
  gen_random_uuid() as second_shift_id,
  (now() at time zone 'Asia/Baghdad')::date as service_day;
insert into public.cottage_shift_schedule_revisions (id, profile_id, revision)
select revision_id, '30000000-0000-4000-8000-000000002601', 3
from pricing_equality_fixture;
select set_config(
  'rentcottage.shift_schedule_write_revision_id',
  (select revision_id::text from pricing_equality_fixture),
  true
);
insert into public.cottage_shifts (
  id, schedule_revision_id, position, name, start_time, end_time
)
select shift_id, revision_id, 1, 'Exact now',
  (now() at time zone 'Asia/Baghdad')::time,
  ((now() at time zone 'Asia/Baghdad')::time + interval '1 hour')::time
from pricing_equality_fixture
union all
select second_shift_id, revision_id, 2, 'Later',
  ((now() at time zone 'Asia/Baghdad')::time + interval '2 hours')::time,
  ((now() at time zone 'Asia/Baghdad')::time + interval '3 hours')::time
from pricing_equality_fixture;
select set_config('rentcottage.shift_schedule_write_revision_id', '', true);
update public.owner_application_cottage_profiles
set current_shift_schedule_id = (select revision_id from pricing_equality_fixture)
where id = '30000000-0000-4000-8000-000000002601';
select set_config(
  'rentcottage.equality_revision_id',
  (select revision_id::text from pricing_equality_fixture),
  true
);
select set_config(
  'rentcottage.equality_shift_id',
  (select shift_id::text from pricing_equality_fixture),
  true
);
select set_config(
  'rentcottage.equality_service_day',
  (select service_day::text from pricing_equality_fixture),
  true
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select throws_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000002601',
    current_setting('rentcottage.equality_revision_id')::uuid,
    current_setting('rentcottage.equality_service_day')::date,
    jsonb_build_array(jsonb_build_object(
      'unitId', current_setting('rentcottage.equality_shift_id')::uuid,
      'unitKind', 'shift', 'state', 'open'
    ))
  )$$,
  'RC204', null,
  'inventory exactly at the Service Day start is not editable'
);

select * from finish();
rollback;
