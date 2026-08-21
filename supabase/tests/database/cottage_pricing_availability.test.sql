begin;

create extension if not exists pgtap with schema extensions;
select plan(121);

select col_type_is(
  'public', 'cottage_booking_period_commitments', 'status',
  'cottage_inventory_commitment_status',
  'system commitments classify Pending Holds separately from Confirmed Bookings'
);
select has_function(
  'public', 'resolve_cottage_inventory_public_availability',
  array['uuid', 'uuid', 'date'],
  'public availability has its own narrow resolver'
);
select has_function(
  'public', 'resolve_cottage_inventory_owner_calendar',
  array['uuid', 'uuid', 'date'],
  'the owner calendar has a separate privileged resolver'
);
select function_privs_are(
  'public', 'resolve_cottage_inventory_owner_calendar',
  array['uuid', 'uuid', 'date'], 'authenticated', array['EXECUTE'],
  'only authenticated callers receive the owner calendar entry point'
);
select has_function(
  'public', 'cottage_inventory_commitment_end_at',
  array['uuid', 'cottage_inventory_unit_kind', 'uuid', 'date'],
  'commitment history has one Iraq-local inventory end-instant resolver'
);

insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values
(
  '00000000-0000-0000-0000-000000002601', 'authenticated', 'authenticated',
  '+9647500002601', now()
),
(
  '00000000-0000-0000-0000-000000002699', 'authenticated', 'authenticated',
  '+9647500002699', now()
);
insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000002601', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000002699', 'customer', null);
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
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
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
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
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
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-21'
    ) -> 'units') item
    where item ->> 'id' = (select id::text from public.cottage_shifts order by position limit 1)$$,
  $$values (100000::bigint)$$,
  'the standard price applies when no override matches'
);
reset role;
create function pg_temp.create_test_inventory_commitment(
  target_schedule_revision_id uuid,
  target_unit_kind public.cottage_inventory_unit_kind,
  target_unit_id uuid,
  target_service_day date,
  target_reference text,
  expected_price_iqd bigint,
  target_status public.cottage_inventory_commitment_status
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_profile_id uuid;
declare target_position smallint;
declare requested_selection jsonb;
declare result jsonb;
declare period_id uuid;
declare actual_price_iqd bigint;
begin
  select revisions.profile_id into target_profile_id
  from public.cottage_shift_schedule_revisions revisions
  where revisions.id = target_schedule_revision_id;
  if target_unit_kind = 'shift'::public.cottage_inventory_unit_kind then
    select shifts.position into target_position
    from public.cottage_shifts shifts
    where shifts.schedule_revision_id = target_schedule_revision_id
      and shifts.id = target_unit_id;
    requested_selection := jsonb_build_object(
      'serviceDay', target_service_day,
      'kind', 'shift',
      'position', target_position
    );
  else
    requested_selection := jsonb_build_object(
      'serviceDay', target_service_day,
      'kind', 'full-day'
    );
  end if;
  result := public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000002699',
    target_profile_id,
    target_reference,
    jsonb_build_object(
      'from', target_service_day,
      'to', target_service_day,
      'guests', 1,
      'selections', jsonb_build_array(requested_selection)
    )
  );
  period_id := (result ->> 'bookingPeriodCommitmentId')::uuid;
  select selected.committed_price_iqd into actual_price_iqd
  from public.cottage_inventory_commitments selected
  where selected.booking_period_commitment_id = period_id;
  if actual_price_iqd is distinct from expected_price_iqd then
    raise exception 'A Cottage Inventory commitment must snapshot its exact effective price'
      using errcode = 'RC204';
  end if;
  if target_status = 'confirmed_booking'::public.cottage_inventory_commitment_status then
    update public.cottage_booking_period_commitments
    set status = target_status
    where id = period_id;
  end if;
  return period_id;
end;
$$;

create function pg_temp.insert_test_inventory_snapshot_unchecked(
  target_schedule_revision_id uuid,
  target_unit_kind public.cottage_inventory_unit_kind,
  target_unit_id uuid,
  target_service_day date,
  target_reference text,
  target_price_iqd bigint,
  target_status public.cottage_inventory_commitment_status
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare target_profile_id uuid;
declare target_start_time time without time zone;
declare target_end_time time without time zone;
declare period_id uuid := gen_random_uuid();
begin
  select revisions.profile_id into target_profile_id
  from public.cottage_shift_schedule_revisions revisions
  where revisions.id = target_schedule_revision_id;
  if target_unit_kind = 'shift'::public.cottage_inventory_unit_kind then
    select shifts.start_time, shifts.end_time
      into target_start_time, target_end_time
    from public.cottage_shifts shifts
    where shifts.schedule_revision_id = target_schedule_revision_id
      and shifts.id = target_unit_id;
  else
    select
      (select shifts.start_time from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
        order by shifts.position limit 1),
      (select shifts.end_time from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
        order by shifts.position desc limit 1)
      into target_start_time, target_end_time;
  end if;
  insert into public.cottage_booking_period_commitments (
    id, customer_user_id, profile_id, schedule_revision_id,
    commitment_reference, status, access_ranges
  ) values (
    period_id,
    '00000000-0000-0000-0000-000000002699',
    target_profile_id,
    target_schedule_revision_id,
    target_reference,
    target_status,
    tstzmultirange(tstzrange(
      (target_service_day + target_start_time) at time zone 'Asia/Baghdad',
      (
        target_service_day + target_end_time
        + case when target_end_time < target_start_time
          then interval '1 day' else interval '0 days' end
      ) at time zone 'Asia/Baghdad',
      '[)'
    ))
  );
  insert into public.cottage_inventory_commitments (
    booking_period_commitment_id, unit_kind, unit_id,
    service_day, committed_price_iqd
  ) values (
    period_id, target_unit_kind, target_unit_id,
    target_service_day, target_price_iqd
  );
  if target_unit_kind = 'shift'::public.cottage_inventory_unit_kind then
    insert into public.cottage_booking_period_occupancies (
      booking_period_commitment_id, schedule_revision_id, shift_id, service_day
    ) values (
      period_id, target_schedule_revision_id, target_unit_id, target_service_day
    );
  else
    insert into public.cottage_booking_period_occupancies (
      booking_period_commitment_id, schedule_revision_id, shift_id, service_day
    )
    select period_id, target_schedule_revision_id, shifts.id, target_service_day
    from public.cottage_shifts shifts
    where shifts.schedule_revision_id = target_schedule_revision_id;
  end if;
  return period_id;
end;
$$;

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
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
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
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
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
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
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
    jsonb_build_object('units', jsonb_build_array(
      jsonb_build_object(
        'unitId', (select shift_id from pricing_revision_before_replace),
        'unitKind', 'shift', 'standardPriceIqd', 130000
      ),
      jsonb_build_object(
        'unitId', (select full_day_bundle_id
          from public.cottage_shift_schedule_revisions
          where id = (select revision_id from pricing_revision_before_replace)),
        'unitKind', 'full_day_bundle', 'standardPriceIqd', 250000
      )
    ))
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
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
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
insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select revision_id, 'shift',
  (select id from public.cottage_shifts order by position limit 1),
  '2099-08-23', 'open'
from pricing_revision_before_replace;
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
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
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
  $$select item ->> 'calendarState'
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
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
insert into public.cottage_inventory_date_price_overrides (
  schedule_revision_id, unit_kind, unit_id, service_day, price_iqd
) values (
  (select revision_id from pricing_revision_before_replace),
  'shift', (select shift_id from pricing_revision_before_replace),
  '2099-08-20', 175000
);
select throws_ok(
  $$select pg_temp.create_test_inventory_commitment(
    (select revision_id from pricing_revision_before_replace),
    'shift', (select id from public.cottage_shifts order by position limit 1),
    '2099-08-20', 'RC-BOOKING-2601', 125000, 'confirmed_booking'
  )$$,
  'RC409', null,
  'a system commitment cannot claim privately blocked inventory'
);
select throws_ok(
  $$select pg_temp.create_test_inventory_commitment(
    (select revision_id from pricing_revision_before_replace),
    'shift', (select shift_id from pricing_revision_before_replace),
    '2099-08-21', 'RC-CLOSED-2601', 125000, 'pending_hold'
  )$$,
  'RC409', null,
  'a system commitment cannot claim closed inventory'
);
delete from public.cottage_inventory_standard_prices
where schedule_revision_id = (select revision_id from pricing_revision_before_replace)
  and unit_kind = 'shift'
  and unit_id = (select id from public.cottage_shifts order by position offset 1 limit 1);
select throws_ok(
  $$select pg_temp.create_test_inventory_commitment(
    (select revision_id from pricing_revision_before_replace),
    'shift', (select id from public.cottage_shifts order by position offset 1 limit 1),
    '2099-08-20', 'RC-UNPRICED-2601', 125000, 'pending_hold'
  )$$,
  'RC409', null,
  'a system commitment cannot claim unpriced inventory'
);
insert into public.cottage_inventory_standard_prices (
  schedule_revision_id, unit_kind, unit_id, price_iqd
) values (
  (select revision_id from pricing_revision_before_replace), 'shift',
  (select id from public.cottage_shifts order by position offset 1 limit 1), 115000
);
insert into public.cottage_inventory_weekday_price_overrides (
  schedule_revision_id, unit_kind, unit_id, weekday, price_iqd
) values (
  (select revision_id from pricing_revision_before_replace), 'shift',
  (select id from public.cottage_shifts order by position offset 1 limit 1),
  extract(dow from date '2099-08-20')::smallint, 165000
);
select throws_ok(
  $$select pg_temp.create_test_inventory_commitment(
    (select revision_id from pricing_revision_before_replace),
    'shift', (select id from public.cottage_shifts order by position offset 1 limit 1),
    '2099-08-20', 'RC-WRONG-WEEKDAY-2601', 115000, 'pending_hold'
  )$$,
  'RC204', null,
  'a system commitment cannot snapshot the Standard price over an effective weekday price'
);
select lives_ok(
  $$select pg_temp.create_test_inventory_commitment(
    (select revision_id from pricing_revision_before_replace),
    'shift', (select id from public.cottage_shifts order by position offset 1 limit 1),
    '2099-08-20', 'RC-WEEKDAY-2601', 165000, 'pending_hold'
  )$$,
  'the effective weekday price can be snapshotted exactly'
);
delete from public.cottage_booking_period_commitments
where commitment_reference = 'RC-WEEKDAY-2601';
delete from public.cottage_inventory_weekday_price_overrides
where schedule_revision_id = (select revision_id from pricing_revision_before_replace)
  and unit_kind = 'shift'
  and unit_id = (select id from public.cottage_shifts order by position offset 1 limit 1);
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
    '2099-08-22',
    jsonb_build_array(jsonb_build_object(
      'unitId', (select id from public.cottage_shifts order by position offset 1 limit 1),
      'unitKind', 'shift', 'state', 'open'
    ))
  )$$,
  'an owner can open a future Shift for commitment lifecycle coverage'
);
reset role;
select lives_ok(
  $$select pg_temp.create_test_inventory_commitment(
    (select revision_id from pricing_revision_before_replace),
    'shift', (select id from public.cottage_shifts order by position offset 1 limit 1),
    '2099-08-22', 'RC-LIFECYCLE-HOLD-2601', 115000, 'pending_hold'
  )$$,
  'a Pending Hold snapshots the exact effective Standard price'
);
select throws_ok(
  $$update public.cottage_inventory_commitments selected
    set unit_id = (select id from public.cottage_shifts order by position limit 1),
      service_day = '2099-08-23',
      committed_price_iqd = 125000
    from public.cottage_booking_period_commitments periods
    where periods.id = selected.booking_period_commitment_id
      and periods.commitment_reference = 'RC-LIFECYCLE-HOLD-2601'$$,
  'RC204', null,
  'a Pending Hold cannot move to another open, future, exactly priced Shift'
);
select results_eq(
  $$select periods.schedule_revision_id, selected.unit_kind::text, selected.unit_id,
      selected.service_day, selected.committed_price_iqd
    from public.cottage_inventory_commitments selected
    join public.cottage_booking_period_commitments periods
      on periods.id = selected.booking_period_commitment_id
    where periods.commitment_reference = 'RC-LIFECYCLE-HOLD-2601'$$,
  $$select revision_id, 'shift'::text,
      (select id from public.cottage_shifts order by position offset 1 limit 1),
      date '2099-08-22', 115000::bigint
    from pricing_revision_before_replace$$,
  'a rejected reschedule preserves every Pending Hold snapshot field'
);
do $$
begin
  update public.cottage_inventory_commitments selected
  set unit_id = (select id from public.cottage_shifts order by position offset 1 limit 1),
    service_day = '2099-08-22',
    committed_price_iqd = 115000
  from public.cottage_booking_period_commitments periods
  where periods.id = selected.booking_period_commitment_id
    and periods.commitment_reference = 'RC-LIFECYCLE-HOLD-2601'
    and selected.service_day = '2099-08-23';
end;
$$;
select throws_ok(
  $$update public.cottage_booking_period_commitments
    set commitment_reference = 'RC-LIFECYCLE-RENAMED-HOLD-2601'
    where commitment_reference = 'RC-LIFECYCLE-HOLD-2601'$$,
  'RC204', null,
  'a Pending Hold reference cannot change without confirmation'
);
select results_eq(
  $$select periods.status::text, periods.commitment_reference,
      selected.committed_price_iqd
    from public.cottage_booking_period_commitments periods
    join public.cottage_inventory_commitments selected
      on selected.booking_period_commitment_id = periods.id
    where selected.service_day = '2099-08-22'$$,
  $$values ('pending_hold'::text, 'RC-LIFECYCLE-HOLD-2601'::text, 115000::bigint)$$,
  'a rejected Pending Hold reference change preserves the row'
);
do $$
begin
  update public.cottage_booking_period_commitments
  set commitment_reference = 'RC-LIFECYCLE-HOLD-2601'
  where commitment_reference = 'RC-LIFECYCLE-RENAMED-HOLD-2601';
end;
$$;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select throws_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    jsonb_build_object('units', jsonb_build_array(jsonb_build_object(
      'unitId', (select id from public.cottage_shifts order by position limit 1),
      'unitKind', 'shift', 'standardPriceIqd', 130000,
      'weekdayOverrides', jsonb_build_array(jsonb_build_object(
        'weekday', 4, 'priceIqd', 160000
      )),
      'dateOverrides', jsonb_build_array(jsonb_build_object(
        'serviceDay', '2099-08-20', 'priceIqd', 175000
      ))
    )))
  )$$,
  'RC204', null,
  'a partial unrelated pricing replacement cannot omit protected inventory'
);
reset role;
select results_eq(
  $$select
      (select prices.price_iqd
       from public.cottage_inventory_date_price_overrides prices
       where prices.schedule_revision_id = fixture.revision_id
         and prices.unit_kind = 'shift'
         and prices.unit_id = (select id from public.cottage_shifts order by position limit 1)
         and prices.service_day = '2099-08-20'),
      (select prices.price_iqd
       from public.cottage_inventory_standard_prices prices
       where prices.schedule_revision_id = fixture.revision_id
         and prices.unit_kind = 'shift'
         and prices.unit_id = (select id from public.cottage_shifts order by position offset 1 limit 1)),
      (select selected.committed_price_iqd
       from public.cottage_inventory_commitments selected
       join public.cottage_booking_period_commitments periods
         on periods.id = selected.booking_period_commitment_id
       where periods.commitment_reference = 'RC-LIFECYCLE-HOLD-2601'),
      (select prices.price_iqd
       from public.cottage_inventory_standard_prices prices
       where prices.schedule_revision_id = fixture.revision_id
         and prices.unit_kind = 'shift'
         and prices.unit_id = (select id from public.cottage_shifts order by position limit 1))
    from pricing_revision_before_replace fixture$$,
  $$values (175000::bigint, 115000::bigint, 115000::bigint, 125000::bigint)$$,
  'a rejected partial replacement preserves override, snapshot, and both Shift prices'
);
set local role authenticated;
select lives_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    jsonb_build_object('units', jsonb_build_array(
      jsonb_build_object(
        'unitId', (select id from public.cottage_shifts order by position limit 1),
        'unitKind', 'shift', 'standardPriceIqd', 130000,
        'weekdayOverrides', jsonb_build_array(jsonb_build_object(
          'weekday', 4, 'priceIqd', 160000
        )),
        'dateOverrides', jsonb_build_array(jsonb_build_object(
          'serviceDay', '2099-08-20', 'priceIqd', 175000
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
  'a complete replacement can edit an unrelated Shift while preserving protected prices'
);
reset role;
select results_eq(
  $$select
      (select prices.price_iqd
       from public.cottage_inventory_standard_prices prices
       where prices.schedule_revision_id = fixture.revision_id
         and prices.unit_kind = 'shift'
         and prices.unit_id = (select id from public.cottage_shifts order by position limit 1)),
      (select prices.price_iqd
       from public.cottage_inventory_standard_prices prices
       where prices.schedule_revision_id = fixture.revision_id
         and prices.unit_kind = 'shift'
         and prices.unit_id = (select id from public.cottage_shifts order by position offset 1 limit 1)),
      (select prices.price_iqd
       from public.cottage_inventory_standard_prices prices
       where prices.schedule_revision_id = fixture.revision_id
         and prices.unit_kind = 'full_day_bundle')
    from pricing_revision_before_replace fixture$$,
  $$values (130000::bigint, 115000::bigint, 250000::bigint)$$,
  'the unrelated edit persists without changing direct or overlapping protected prices'
);
select pg_temp.insert_test_inventory_snapshot_unchecked(
  (select revision_id from pricing_revision_before_replace),
  'shift', (select shift_id from pricing_revision_before_replace),
  '2000-01-01', 'RC-HISTORICAL-PRICE-2601', 99000, 'confirmed_booking'
);
set local role authenticated;
select lives_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    jsonb_build_object('units', jsonb_build_array(
      jsonb_build_object(
        'unitId', (select shift_id from pricing_revision_before_replace),
        'unitKind', 'shift', 'standardPriceIqd', 135000,
        'weekdayOverrides', jsonb_build_array(jsonb_build_object(
          'weekday', 4, 'priceIqd', 160000
        )),
        'dateOverrides', jsonb_build_array(jsonb_build_object(
          'serviceDay', '2099-08-20', 'priceIqd', 175000
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
  'elapsed committed pricing can be omitted from an unrelated future pricing save'
);
reset role;
select results_eq(
  $$select
      (select prices.price_iqd
       from public.cottage_inventory_date_price_overrides prices
       where prices.schedule_revision_id = fixture.revision_id
         and prices.unit_kind = 'shift'
         and prices.unit_id = fixture.shift_id
         and prices.service_day = '2000-01-01'),
      (select selected.committed_price_iqd
       from public.cottage_inventory_commitments selected
       join public.cottage_booking_period_commitments periods
         on periods.id = selected.booking_period_commitment_id
       where periods.commitment_reference = 'RC-HISTORICAL-PRICE-2601'),
      (select prices.price_iqd
       from public.cottage_inventory_standard_prices prices
       where prices.schedule_revision_id = fixture.revision_id
         and prices.unit_kind = 'shift'
         and prices.unit_id = fixture.shift_id)
    from pricing_revision_before_replace fixture$$,
  $$values (99000::bigint, 99000::bigint, 135000::bigint)$$,
  'future repricing preserves the elapsed override and historical commitment snapshot'
);
set local role authenticated;
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
        )),
        'dateOverrides', jsonb_build_array(jsonb_build_object(
          'serviceDay', '2099-08-20', 'priceIqd', 175000
        ))
      ),
      jsonb_build_object(
        'unitId', (select id from public.cottage_shifts order by position offset 1 limit 1),
        'unitKind', 'shift', 'standardPriceIqd', 145000
      ),
      jsonb_build_object(
        'unitId', (select full_day_bundle_id
          from public.cottage_shift_schedule_revisions
          where id = (select revision_id from pricing_revision_before_replace)),
        'unitKind', 'full_day_bundle', 'standardPriceIqd', 250000
      )
    ))
  )$$,
  'a prospective Standard price change does not rewrite a Pending Hold snapshot'
);
reset role;
select lives_ok(
  $$update public.cottage_booking_period_commitments
    set status = 'confirmed_booking',
      commitment_reference = 'RC-LIFECYCLE-CONFIRMED-2601'
    where commitment_reference = 'RC-LIFECYCLE-HOLD-2601'$$,
  'a lifecycle-only confirmation preserves the admitted price snapshot'
);
select results_eq(
  $$select periods.status::text, periods.commitment_reference,
      selected.committed_price_iqd
    from public.cottage_booking_period_commitments periods
    join public.cottage_inventory_commitments selected
      on selected.booking_period_commitment_id = periods.id
    where selected.service_day = '2099-08-22'$$,
  $$values ('confirmed_booking'::text, 'RC-LIFECYCLE-CONFIRMED-2601'::text, 115000::bigint)$$,
  'confirmation retains the original Pending Hold price after prospective repricing'
);
select lives_ok(
  $$update public.cottage_booking_period_commitments
    set status = 'confirmed_booking',
      commitment_reference = 'RC-LIFECYCLE-CONFIRMED-2601'
    where commitment_reference = 'RC-LIFECYCLE-CONFIRMED-2601'$$,
  'an idempotent same-state and same-reference update remains allowed'
);
select throws_ok(
  $$update public.cottage_booking_period_commitments
    set commitment_reference = 'RC-LIFECYCLE-RENAMED-CONFIRMED-2601'
    where commitment_reference = 'RC-LIFECYCLE-CONFIRMED-2601'$$,
  'RC204', null,
  'a Confirmed Booking reference cannot change in the same state'
);
select results_eq(
  $$select periods.status::text, periods.commitment_reference,
      selected.committed_price_iqd
    from public.cottage_booking_period_commitments periods
    join public.cottage_inventory_commitments selected
      on selected.booking_period_commitment_id = periods.id
    where selected.service_day = '2099-08-22'$$,
  $$values ('confirmed_booking'::text, 'RC-LIFECYCLE-CONFIRMED-2601'::text, 115000::bigint)$$,
  'a rejected Confirmed Booking reference change preserves the row'
);
do $$
begin
  update public.cottage_booking_period_commitments
  set commitment_reference = 'RC-LIFECYCLE-CONFIRMED-2601'
  where commitment_reference = 'RC-LIFECYCLE-RENAMED-CONFIRMED-2601';
end;
$$;
select throws_ok(
  $$update public.cottage_booking_period_commitments
    set status = 'pending_hold'
    where commitment_reference = 'RC-LIFECYCLE-CONFIRMED-2601'$$,
  'RC204', null,
  'a Confirmed Booking cannot return to Pending Hold'
);
select results_eq(
  $$select periods.status::text, periods.commitment_reference,
      selected.committed_price_iqd
    from public.cottage_booking_period_commitments periods
    join public.cottage_inventory_commitments selected
      on selected.booking_period_commitment_id = periods.id
    where commitment_reference = 'RC-LIFECYCLE-CONFIRMED-2601'$$,
  $$values ('confirmed_booking'::text, 'RC-LIFECYCLE-CONFIRMED-2601'::text, 115000::bigint)$$,
  'a rejected status downgrade preserves the Confirmed Booking row'
);
do $$
begin
  update public.cottage_booking_period_commitments
  set status = 'confirmed_booking'
  where commitment_reference = 'RC-LIFECYCLE-CONFIRMED-2601'
    and status = 'pending_hold';
end;
$$;
select throws_ok(
  $$update public.cottage_inventory_commitments selected
    set committed_price_iqd = 145000
    from public.cottage_booking_period_commitments periods
    where periods.id = selected.booking_period_commitment_id
      and periods.commitment_reference = 'RC-LIFECYCLE-CONFIRMED-2601'$$,
  'RC204', null,
  'a Confirmed Booking cannot replace its snapshot with the newly effective exact price'
);
select results_eq(
  $$select periods.schedule_revision_id, selected.unit_kind::text, selected.unit_id,
      selected.service_day, selected.committed_price_iqd
    from public.cottage_inventory_commitments selected
    join public.cottage_booking_period_commitments periods
      on periods.id = selected.booking_period_commitment_id
    where periods.commitment_reference = 'RC-LIFECYCLE-CONFIRMED-2601'$$,
  $$select revision_id, 'shift'::text,
      (select id from public.cottage_shifts order by position offset 1 limit 1),
      date '2099-08-22', 115000::bigint
    from pricing_revision_before_replace$$,
  'a rejected price replacement preserves every Confirmed Booking snapshot field'
);
do $$
begin
  update public.cottage_inventory_commitments selected
  set committed_price_iqd = 115000
  from public.cottage_booking_period_commitments periods
  where periods.id = selected.booking_period_commitment_id
    and periods.commitment_reference = 'RC-LIFECYCLE-CONFIRMED-2601'
    and selected.committed_price_iqd = 145000;
end;
$$;
delete from public.cottage_booking_period_commitments
where commitment_reference = 'RC-LIFECYCLE-CONFIRMED-2601';
update public.cottage_inventory_standard_prices
set price_iqd = 115000
where schedule_revision_id = (select revision_id from pricing_revision_before_replace)
  and unit_kind = 'shift'
  and unit_id = (select id from public.cottage_shifts order by position offset 1 limit 1);
update public.owner_application_cottage_profiles
set current_publication_id = null
where id = '30000000-0000-4000-8000-000000002601';
select throws_ok(
  $$select pg_temp.create_test_inventory_commitment(
    (select revision_id from pricing_revision_before_replace),
    'shift', (select id from public.cottage_shifts order by position offset 1 limit 1),
    '2099-08-22', 'RC-UNPUBLISHED-2601', 115000, 'pending_hold'
  )$$,
  'RC409', null,
  'a Pending Hold cannot be admitted after the Cottage is unpublished'
);
select results_eq(
  $$select count(*)::integer
    from public.cottage_booking_period_commitments
    where commitment_reference = 'RC-UNPUBLISHED-2601'$$,
  $$values (0::integer)$$,
  'unpublish-first admission leaves no Cottage Inventory commitment'
);
delete from public.cottage_booking_period_commitments
where commitment_reference = 'RC-UNPUBLISHED-2601';
update public.owner_application_cottage_profiles
set current_publication_id = '60000000-0000-4000-8000-000000002601'
where id = '30000000-0000-4000-8000-000000002601';
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
      'unitId', (select shift_id from pricing_revision_before_replace),
      'unitKind', 'shift', 'state', 'open'
    ))
  )$$,
  'the owner can reopen uncommitted inventory before a system commitment'
);
reset role;
select throws_ok(
  $$select pg_temp.create_test_inventory_commitment(
    (select revision_id from pricing_revision_before_replace),
    'shift', (select shift_id from pricing_revision_before_replace),
    '2099-08-20', 'RC-WRONG-PRICE-2601', 125000, 'confirmed_booking'
  )$$,
  'RC204', null,
  'a system commitment must snapshot the effective specific-date price'
);
select lives_ok(
  $$select pg_temp.create_test_inventory_commitment(
    (select revision_id from pricing_revision_before_replace),
    'shift', (select shift_id from pricing_revision_before_replace),
    '2099-08-20', 'RC-BOOKING-2601', 175000, 'confirmed_booking'
  )$$,
  'open priced current inventory accepts a system commitment'
);
select throws_ok(
  $$update public.cottage_inventory_commitments selected
    set committed_price_iqd = 125000
    from public.cottage_booking_period_commitments periods
    where periods.id = selected.booking_period_commitment_id
      and periods.commitment_reference = 'RC-BOOKING-2601'$$,
  'RC204', null,
  'a system commitment update cannot replace its effective price snapshot with a mismatch'
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
select throws_ok(
  $$select public.resolve_cottage_inventory(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )$$,
  '42501', null,
  'an authenticated customer cannot execute the legacy price resolver'
);
select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.resolve_cottage_inventory_public_availability(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where (select array_agg(key order by key) from jsonb_object_keys(item) key)
      <> array['available', 'id', 'kind']::text[]
  ),
  'an authenticated customer receives only exact public availability keys'
);
select throws_ok(
  $$select public.resolve_cottage_inventory_owner_calendar(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )$$,
  '42501', null,
  'a customer cannot resolve the privileged Owner Calendar'
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
grant select on pricing_revision_before_replace to anon;
set local role anon;
select throws_ok(
  $$select public.resolve_cottage_inventory(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )$$,
  '42501', null,
  'an anonymous visitor cannot execute the legacy price resolver'
);
select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.resolve_cottage_inventory_public_availability(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where (select array_agg(key order by key) from jsonb_object_keys(item) key)
      <> array['available', 'id', 'kind']::text[]
  ),
  'an anonymous visitor receives only exact public availability keys'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002603","role":"authenticated","aal":"aal1"}',
  true
);
select throws_ok(
  $$select public.resolve_cottage_inventory_owner_calendar(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )$$,
  '42501', null,
  'a different approved Cottage Owner cannot resolve a foreign Owner Calendar'
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
select throws_ok(
  $$select public.resolve_cottage_inventory_owner_calendar(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20'
  )$$,
  '42501', null,
  'a prospective Cottage Owner cannot resolve the privileged Owner Calendar'
);
select throws_ok(
  $$select public.resolve_cottage_inventory_public_availability(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    )$$,
  'RC204', null,
  'a prospective Cottage Owner cannot expose public availability'
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
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000002601',
      (select current_shift_schedule_id from public.owner_application_cottage_profiles
        where id = '30000000-0000-4000-8000-000000002601'),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'id' = (select shift_id::text from pricing_revision_before_replace)$$,
  $$values (175000::bigint)$$,
  'a committed shift preserves its committed price after owner pricing changes'
);
select results_eq(
  $$select item ->> 'calendarState'
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000002601',
      (select current_shift_schedule_id from public.owner_application_cottage_profiles
        where id = '30000000-0000-4000-8000-000000002601'),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'kind' = 'full_day_bundle'$$,
  $$values ('component_unavailable'::text)$$,
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
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20',
    jsonb_build_array(
      jsonb_build_object(
        'unitId', (select full_day_bundle_id
          from public.cottage_shift_schedule_revisions
          where id = (select revision_id from pricing_revision_before_replace)),
        'unitKind', 'full_day_bundle', 'state', 'open'
      ),
      jsonb_build_object(
        'unitId', (select id from public.cottage_shifts order by position offset 1 limit 1),
        'unitKind', 'shift', 'state', 'closed'
      )
    )
  )$$,
  'RC204', null,
  'a component-blocked bundle rejects the whole availability edit'
);
select results_eq(
  $$select item ->> 'calendarState'
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'id' = (select id::text from public.cottage_shifts order by position offset 1 limit 1)$$,
  $$values ('open'::text)$$,
  'a rejected component-blocked bundle edit leaves unrelated inventory unchanged'
);
select throws_ok(
  $$insert into public.cottage_booking_period_commitments (
    customer_user_id, profile_id, schedule_revision_id,
    commitment_reference, status, access_ranges
  ) values (
    '00000000-0000-0000-0000-000000002602',
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    'RC-BOOKING-2602', 'pending_hold',
    '{["2099-08-20 15:00:00+00","2099-08-20 19:00:00+00")}'::tstzmultirange
  )$$,
  '42501', null,
  'an authenticated owner cannot create a system commitment marker directly'
);

select results_eq(
  $$select item ->> 'calendarState', item ->> 'commitmentReference'
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'id' = (select shift_id::text from pricing_revision_before_replace)$$,
  $$values ('confirmed_booking'::text, 'RC-BOOKING-2601'::text)$$,
  'a direct Shift commitment exposes its confirmed state and authorized reference'
);
select results_eq(
  $$select item ->> 'calendarState', item ->> 'commitmentReference'
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'kind' = 'full_day_bundle'$$,
  $$values ('component_unavailable'::text, null::text)$$,
  'a component commitment makes the bundle read-only without borrowing its reference'
);
reset role;
update public.cottage_inventory_availability
set state = 'open'
where schedule_revision_id = (select revision_id from pricing_revision_before_replace)
  and service_day = '2099-08-20';
select throws_ok(
  $$select pg_temp.create_test_inventory_commitment(
    (select revision_id from pricing_revision_before_replace),
    'full_day_bundle',
    (select full_day_bundle_id from public.cottage_shift_schedule_revisions
     where id = (select revision_id from pricing_revision_before_replace)),
    '2099-08-20', 'RC-OVERLAP-2601', 250000, 'pending_hold'
  )$$,
  'RC409', null,
  'a Full-Day Bundle commitment cannot overlap a component commitment'
);
delete from public.cottage_booking_period_commitments
where schedule_revision_id = (select revision_id from pricing_revision_before_replace);
select lives_ok(
  $$select pg_temp.create_test_inventory_commitment(
    (select revision_id from pricing_revision_before_replace),
    'full_day_bundle',
    (select full_day_bundle_id from public.cottage_shift_schedule_revisions
     where id = (select revision_id from pricing_revision_before_replace)),
    '2099-08-20', 'RC-BUNDLE-2601', 250000, 'pending_hold'
  )$$,
  'open priced components accept a direct Full-Day Bundle Pending Hold'
);
select throws_ok(
  $$select pg_temp.create_test_inventory_commitment(
    (select revision_id from pricing_revision_before_replace),
    'shift', (select shift_id from pricing_revision_before_replace),
    '2099-08-20', 'RC-OVERLAP-2602', 175000, 'pending_hold'
  )$$,
  'RC409', null,
  'a component Shift commitment cannot overlap a direct Full-Day Bundle commitment'
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
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20',
    jsonb_build_array(
      jsonb_build_object(
        'unitId', (select full_day_bundle_id
          from public.cottage_shift_schedule_revisions
          where id = (select revision_id from pricing_revision_before_replace)),
        'unitKind', 'full_day_bundle', 'state', 'closed'
      ),
      jsonb_build_object(
        'unitId', (select shift_id from pricing_revision_before_replace),
        'unitKind', 'shift', 'state', 'closed'
      )
    )
  )$$,
  'RC204', null,
  'a direct bundle commitment blocks both itself and its component Shifts atomically'
);
reset role;
select results_eq(
  $$select count(*)::integer
    from public.cottage_inventory_availability
    where schedule_revision_id = (select revision_id from pricing_revision_before_replace)
      and service_day = '2099-08-20'
      and state = 'open'$$,
  $$values (3::integer)$$,
  'a rejected direct-bundle edit leaves every persisted availability state unchanged'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select results_eq(
  $$select count(*)::integer
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'calendarState' = 'pending_hold'
      and item ->> 'commitmentReference' = 'RC-BUNDLE-2601'$$,
  $$values (3::integer)$$,
  'a direct bundle Pending Hold propagates its state and reference to every Shift'
);
reset role;
select lives_ok(
  $$update public.cottage_booking_period_commitments
    set status = 'confirmed_booking', commitment_reference = 'RC-BUNDLE-2601-C'
    where schedule_revision_id = (select revision_id from pricing_revision_before_replace)$$,
  'a direct Full-Day Bundle commitment can become confirmed'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select results_eq(
  $$select count(*)::integer
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'calendarState' = 'confirmed_booking'
      and item ->> 'commitmentReference' = 'RC-BUNDLE-2601-C'$$,
  $$values (3::integer)$$,
  'a direct confirmed bundle propagates its state and reference to every Shift'
);
reset role;
delete from public.cottage_booking_period_commitments
where schedule_revision_id = (select revision_id from pricing_revision_before_replace);
select lives_ok(
  $$select pg_temp.create_test_inventory_commitment(
    (select revision_id from pricing_revision_before_replace),
    'shift', (select shift_id from pricing_revision_before_replace),
    '2099-08-20', 'RC-BOOKING-2601', 175000, 'confirmed_booking'
  )$$,
  'the component commitment fixture is restored for mutation protections'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.resolve_cottage_inventory_public_availability(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where (select array_agg(key order by key) from jsonb_object_keys(item) key)
      <> array['available', 'id', 'kind']::text[]
  ),
  'public availability contains correlation identity and availability only'
);
select lives_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    '2099-08-20',
    jsonb_build_array(
      jsonb_build_object(
        'unitId', (select shift_id from pricing_revision_before_replace),
        'unitKind', 'shift', 'state', 'open'
      ),
      jsonb_build_object(
        'unitId', (select id from public.cottage_shifts order by position offset 1 limit 1),
        'unitKind', 'shift', 'state', 'closed'
      )
    )
  )$$,
  'an unchanged committed Shift is a no-op while an unrelated Shift changes'
);
select results_eq(
  $$select item ->> 'calendarState'
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000002601',
      (select revision_id from pricing_revision_before_replace),
      '2099-08-20'
    ) -> 'units') item
    where item ->> 'id' = (select id::text from public.cottage_shifts order by position offset 1 limit 1)$$,
  $$values ('closed'::text)$$,
  'the unrelated Shift change persists beside the unchanged commitment'
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
  'RC204', null,
  'removing a specific-date price from committed inventory is rejected'
);
select lives_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000002601',
    (select revision_id from pricing_revision_before_replace),
    jsonb_build_object('units', jsonb_build_array(
      jsonb_build_object(
        'unitId', (select shift_id from pricing_revision_before_replace),
        'unitKind', 'shift', 'standardPriceIqd', 130000,
        'dateOverrides', jsonb_build_array(jsonb_build_object(
          'serviceDay', '2099-08-20', 'priceIqd', 175000
        ))
      ),
      jsonb_build_object(
        'unitId', (select full_day_bundle_id
          from public.cottage_shift_schedule_revisions
          where id = (select revision_id from pricing_revision_before_replace)),
        'unitKind', 'full_day_bundle', 'standardPriceIqd', 250000
      )
    ))
  )$$,
  'a prospective standard price can change while the committed date price stays identical'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select throws_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002601', 1,
    '[{"name":"Replacement Morning","startTime":"07:00","endTime":"11:00"},{"name":"Replacement Evening","startTime":"18:00","endTime":"22:00"}]'
  )$$,
  'RC204', null,
  'a Shift Schedule with committed inventory cannot be replaced'
);
reset role;
select results_eq(
  $$select profiles.current_shift_schedule_id = fixture.revision_id,
      (select count(*)::integer from public.cottage_shift_schedule_revisions revisions
       where revisions.profile_id = profiles.id),
      (select count(*)::integer from public.cottage_booking_period_commitments periods
       where periods.schedule_revision_id = fixture.revision_id)
    from public.owner_application_cottage_profiles profiles
    cross join pricing_revision_before_replace fixture
    where profiles.id = '30000000-0000-4000-8000-000000002601'$$,
  $$values (true, 1::integer, 1::integer)$$,
  'a denied replacement preserves the current pointer, old revision, and commitment snapshot'
);
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
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select lives_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002602', 0,
    '[{"name":"Old Morning","startTime":"08:00","endTime":"12:00"},{"name":"Old Evening","startTime":"18:00","endTime":"22:00"}]'
  )$$,
  'an uncommitted draft Cottage can create its first Shift Schedule'
);
create temporary table stale_schedule_fixture as
select current_shift_schedule_id as revision_id,
  (select id from public.cottage_shifts shifts
   where shifts.schedule_revision_id = profiles.current_shift_schedule_id
   order by position limit 1) as shift_id
from public.owner_application_cottage_profiles profiles
where profiles.id = '30000000-0000-4000-8000-000000002602';
select lives_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002602', 1,
    '[{"name":"New Morning","startTime":"07:00","endTime":"11:00"},{"name":"New Evening","startTime":"17:00","endTime":"21:00"}]'
  )$$,
  'an uncommitted draft Cottage can replace its Shift Schedule'
);
reset role;
create temporary table replacement_schedule_fixture as
select profiles.current_shift_schedule_id as revision_id,
  revisions.full_day_bundle_id,
  (select id from public.cottage_shifts shifts
   where shifts.schedule_revision_id = profiles.current_shift_schedule_id
   order by position limit 1) as shift_id
from public.owner_application_cottage_profiles profiles
join public.cottage_shift_schedule_revisions revisions
  on revisions.id = profiles.current_shift_schedule_id
where profiles.id = '30000000-0000-4000-8000-000000002602';
insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules, revision
) values (
  '68000000-0000-4000-8000-000000002602',
  '30000000-0000-4000-8000-000000002602',
  '00000000-0000-0000-0000-000000002601',
  'en', 'Description', 'Rules', 1
);
insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
) values (
  '68100000-0000-4000-8000-000000002602',
  '30000000-0000-4000-8000-000000002602',
  '00000000-0000-0000-0000-000000002601',
  '68000000-0000-4000-8000-000000002602',
  'Other Cottage', 'Erbil', 'Elsewhere', 4, 2, 1, array['garden'],
  1, 'approved', now()
);
insert into public.cottage_profile_localized_revisions (
  id, review_cycle_id, locale, revision, origin, description, house_rules
) values (
  '68200000-0000-4000-8000-000000002602',
  '68100000-0000-4000-8000-000000002602',
  'en', 1, 'owner_source', 'Description', 'Rules'
);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
) values (
  '68300000-0000-4000-8000-000000002602',
  '30000000-0000-4000-8000-000000002602',
  '68100000-0000-4000-8000-000000002602',
  1, 'Other Cottage', 'Erbil', 'Elsewhere', 4, 2, 1, array['garden']
);
insert into public.cottage_publication_localizations (
  publication_id, locale, localized_revision_id, description, house_rules
) values (
  '68300000-0000-4000-8000-000000002602',
  'en', '68200000-0000-4000-8000-000000002602', 'Description', 'Rules'
);
update public.owner_application_cottage_profiles
set current_publication_id = '68300000-0000-4000-8000-000000002602'
where id = '30000000-0000-4000-8000-000000002602';
insert into public.cottage_inventory_standard_prices (
  schedule_revision_id, unit_kind, unit_id, price_iqd
)
select fixture.revision_id, units.unit_kind, units.unit_id, units.price_iqd
from replacement_schedule_fixture fixture
cross join lateral (
  select 'shift'::public.cottage_inventory_unit_kind, shifts.id, 100000::bigint
  from public.cottage_shifts shifts
  where shifts.schedule_revision_id = fixture.revision_id
  union all
  select 'full_day_bundle'::public.cottage_inventory_unit_kind,
    fixture.full_day_bundle_id, 170000::bigint
) units(unit_kind, unit_id, price_iqd);
insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select prices.schedule_revision_id, prices.unit_kind, prices.unit_id,
  '2099-08-22', 'open'
from public.cottage_inventory_standard_prices prices
join replacement_schedule_fixture fixture on fixture.revision_id = prices.schedule_revision_id;
set local role service_role;
create temporary table stale_boundary_hold as
select public.create_pending_booking_period_hold(
  '00000000-0000-0000-0000-000000002699',
  '30000000-0000-4000-8000-000000002602',
  'RC-CURRENT-SCHEDULE-2602',
  '{"from":"2099-08-22","to":"2099-08-22","guests":1,"selections":[{"serviceDay":"2099-08-22","kind":"shift","position":1}]}'::jsonb
) as result;
reset role;
select results_eq(
  $$select periods.schedule_revision_id = current_fixture.revision_id,
      periods.schedule_revision_id <> stale_fixture.revision_id,
      selected.unit_id = current_fixture.shift_id,
      selected.unit_id <> stale_fixture.shift_id
    from public.cottage_booking_period_commitments periods
    join public.cottage_inventory_commitments selected
      on selected.booking_period_commitment_id = periods.id
    cross join replacement_schedule_fixture current_fixture
    cross join stale_schedule_fixture stale_fixture
    where periods.commitment_reference = 'RC-CURRENT-SCHEDULE-2602'$$,
  $$values (true, true, true, true)$$,
  'the profile-only Pending Hold boundary persists only the current replacement Schedule'
);
delete from public.cottage_booking_period_commitments
where commitment_reference = 'RC-CURRENT-SCHEDULE-2602';
create temporary table historical_schedule_fixture as
select profiles.current_shift_schedule_id as revision_id,
  revisions.revision,
  (select id from public.cottage_shifts shifts
   where shifts.schedule_revision_id = profiles.current_shift_schedule_id
   order by position limit 1) as shift_id
from public.owner_application_cottage_profiles profiles
join public.cottage_shift_schedule_revisions revisions
  on revisions.id = profiles.current_shift_schedule_id
where profiles.id = '30000000-0000-4000-8000-000000002602';
select pg_temp.insert_test_inventory_snapshot_unchecked(
  revision_id,
  'shift',
  shift_id,
  (now() at time zone 'Asia/Baghdad')::date - 1,
  'RC-HISTORICAL-2602',
  100000,
  'confirmed_booking'
)
from historical_schedule_fixture;
grant select on historical_schedule_fixture to authenticated;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select lives_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002602',
    (select revision from historical_schedule_fixture),
    '[{"name":"Prospective Morning","startTime":"06:00","endTime":"10:00"},{"name":"Prospective Evening","startTime":"16:00","endTime":"20:00"}]'
  )$$,
  'a historical commitment does not permanently freeze prospective Shift Schedule replacement'
);
reset role;
select results_eq(
  $$select profiles.current_shift_schedule_id <> fixture.revision_id,
      (select count(*)::integer from public.cottage_booking_period_commitments periods
       where periods.schedule_revision_id = fixture.revision_id
         and periods.commitment_reference = 'RC-HISTORICAL-2602')
    from public.owner_application_cottage_profiles profiles
    cross join historical_schedule_fixture fixture
    where profiles.id = '30000000-0000-4000-8000-000000002602'$$,
  $$values (true, 1::integer)$$,
  'prospective replacement preserves the historical revision commitment snapshot'
);
insert into public.cottage_shift_schedule_revisions (
  id, profile_id, revision, full_day_bundle_id
) values (
  '63000000-0000-4000-8000-000000002602',
  '30000000-0000-4000-8000-000000002602',
  99,
  '64000000-0000-4000-8000-000000002602'
);
select set_config(
  'rentcottage.shift_schedule_write_revision_id',
  '63000000-0000-4000-8000-000000002602',
  true
);
insert into public.cottage_shifts (
  id, schedule_revision_id, position, name, start_time, end_time
) values
  (
    '65000000-0000-4000-8000-000000002601',
    '63000000-0000-4000-8000-000000002602',
    1, 'Evening', '20:00', '23:00'
  ),
  (
    '65000000-0000-4000-8000-000000002602',
    '63000000-0000-4000-8000-000000002602',
    2, 'Overnight', '23:30', '02:00'
  );
select results_eq(
  $$select public.cottage_inventory_commitment_end_at(
    '63000000-0000-4000-8000-000000002602',
    'shift',
    '65000000-0000-4000-8000-000000002602',
    '2099-08-20'
  )$$,
  $$values (timestamptz '2099-08-21 02:00:00 Asia/Baghdad')$$,
  'a cross-midnight Shift commitment ends on the next Iraq-local calendar day'
);
select results_eq(
  $$select public.cottage_inventory_commitment_end_at(
      '63000000-0000-4000-8000-000000002602',
      'full_day_bundle',
      '64000000-0000-4000-8000-000000002602',
      '2099-08-20'
    ),
    public.cottage_inventory_commitment_end_at(
      '63000000-0000-4000-8000-000000002602',
      'full_day_bundle',
      '64000000-0000-4000-8000-000000002602',
      '2099-08-20'
    ) > timestamptz '2099-08-21 01:00:00 Asia/Baghdad'$$,
  $$values (
    timestamptz '2099-08-21 02:00:00 Asia/Baghdad',
    true
  )$$,
  'a Full-Day Bundle remains active until its last cross-midnight component ends'
);
select results_eq(
  $$select role_name, allowed
    from (values
      ('public', has_function_privilege('public',
        'public.cottage_inventory_commitment_end_at(uuid,public.cottage_inventory_unit_kind,uuid,date)',
        'execute')),
      ('anon', has_function_privilege('anon',
        'public.cottage_inventory_commitment_end_at(uuid,public.cottage_inventory_unit_kind,uuid,date)',
        'execute')),
      ('authenticated', has_function_privilege('authenticated',
        'public.cottage_inventory_commitment_end_at(uuid,public.cottage_inventory_unit_kind,uuid,date)',
        'execute')),
      ('service_role', has_function_privilege('service_role',
        'public.cottage_inventory_commitment_end_at(uuid,public.cottage_inventory_unit_kind,uuid,date)',
        'execute'))
    ) privileges(role_name, allowed)
    order by role_name$$,
  $$values
    ('anon', false),
    ('authenticated', false),
    ('public', false),
    ('service_role', false)$$,
  'the internal end-instant resolver is unavailable to application roles'
);
create temporary table current_schedule_fixture as
select profiles.current_shift_schedule_id as revision_id,
  revisions.revision,
  (select id from public.cottage_shifts shifts
   where shifts.schedule_revision_id = profiles.current_shift_schedule_id
   order by position limit 1) as shift_id
from public.owner_application_cottage_profiles profiles
join public.cottage_shift_schedule_revisions revisions
  on revisions.id = profiles.current_shift_schedule_id
where profiles.id = '30000000-0000-4000-8000-000000002602';
select pg_temp.insert_test_inventory_snapshot_unchecked(
  revision_id,
  'shift',
  shift_id,
  (now() at time zone 'Asia/Baghdad')::date + 1,
  'RC-FUTURE-2602',
  100000,
  'confirmed_booking'
)
from current_schedule_fixture;
grant select on current_schedule_fixture to authenticated;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated","aal":"aal1"}',
  true
);
select throws_ok(
  $$select public.replace_cottage_shift_schedule(
    '30000000-0000-4000-8000-000000002602',
    (select revision from current_schedule_fixture),
    '[{"name":"Blocked Morning","startTime":"05:00","endTime":"09:00"},{"name":"Blocked Evening","startTime":"15:00","endTime":"19:00"}]'
  )$$,
  'RC204', null,
  'a future Service Day commitment prevents Shift Schedule replacement'
);
reset role;
select results_eq(
  $$select profiles.current_shift_schedule_id = fixture.revision_id,
      (select count(*)::integer from public.cottage_booking_period_commitments periods
       where periods.schedule_revision_id = fixture.revision_id
         and periods.commitment_reference = 'RC-FUTURE-2602')
    from public.owner_application_cottage_profiles profiles
    cross join current_schedule_fixture fixture
    where profiles.id = '30000000-0000-4000-8000-000000002602'$$,
  $$values (true, 1::integer)$$,
  'a denied future replacement preserves its pointer and commitment snapshot'
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
  $$values (175000::bigint)$$,
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
delete from public.cottage_booking_period_commitments
where schedule_revision_id = (select revision_id from pricing_revision_before_replace);
create temporary table pricing_equality_fixture on commit drop as
select gen_random_uuid() as revision_id,
  gen_random_uuid() as shift_id,
  gen_random_uuid() as second_shift_id,
  gen_random_uuid() as bundle_id,
  (now() at time zone 'Asia/Baghdad')::date as service_day;
insert into public.cottage_shift_schedule_revisions (
  id, profile_id, revision, full_day_bundle_id
)
select revision_id, '30000000-0000-4000-8000-000000002601', 3, bundle_id
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
select set_config(
  'rentcottage.equality_second_shift_id',
  (select second_shift_id::text from pricing_equality_fixture),
  true
);
select set_config(
  'rentcottage.equality_bundle_id',
  (select bundle_id::text from pricing_equality_fixture),
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
reset role;
insert into public.cottage_inventory_standard_prices (
  schedule_revision_id, unit_kind, unit_id, price_iqd
) values
  (
    current_setting('rentcottage.equality_revision_id')::uuid,
    'shift', current_setting('rentcottage.equality_shift_id')::uuid, 100000
  ),
  (
    current_setting('rentcottage.equality_revision_id')::uuid,
    'shift', current_setting('rentcottage.equality_second_shift_id')::uuid, 120000
  ),
  (
    current_setting('rentcottage.equality_revision_id')::uuid,
    'full_day_bundle', current_setting('rentcottage.equality_bundle_id')::uuid, 250000
  );
insert into public.cottage_inventory_date_price_overrides (
  schedule_revision_id, unit_kind, unit_id, service_day, price_iqd
) values
  (
    current_setting('rentcottage.equality_revision_id')::uuid,
    'shift', current_setting('rentcottage.equality_shift_id')::uuid,
    current_setting('rentcottage.equality_service_day')::date, 180000
  ),
  (
    current_setting('rentcottage.equality_revision_id')::uuid,
    'full_day_bundle', current_setting('rentcottage.equality_bundle_id')::uuid,
    current_setting('rentcottage.equality_service_day')::date, 260000
  );
select pg_temp.insert_test_inventory_snapshot_unchecked(
  current_setting('rentcottage.equality_revision_id')::uuid,
  'shift', current_setting('rentcottage.equality_shift_id')::uuid,
  current_setting('rentcottage.equality_service_day')::date,
  'RC-ACTIVE-PRICE-2601', 180000, 'confirmed_booking'
);
set local role authenticated;
select throws_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000002601',
    current_setting('rentcottage.equality_revision_id')::uuid,
    jsonb_build_object('units', jsonb_build_array(
      jsonb_build_object(
        'unitId', current_setting('rentcottage.equality_second_shift_id')::uuid,
        'unitKind', 'shift', 'standardPriceIqd', 130000
      ),
      jsonb_build_object(
        'unitId', current_setting('rentcottage.equality_bundle_id')::uuid,
        'unitKind', 'full_day_bundle', 'standardPriceIqd', 250000
      )
    ))
  )$$,
  'RC204', null,
  'a started but active committed Shift cannot be omitted from pricing'
);
select lives_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000002601',
    current_setting('rentcottage.equality_revision_id')::uuid,
    jsonb_build_object('units', jsonb_build_array(
      jsonb_build_object(
        'unitId', current_setting('rentcottage.equality_shift_id')::uuid,
        'unitKind', 'shift', 'standardPriceIqd', 100000
      ),
      jsonb_build_object(
        'unitId', current_setting('rentcottage.equality_second_shift_id')::uuid,
        'unitKind', 'shift', 'standardPriceIqd', 130000
      ),
      jsonb_build_object(
        'unitId', current_setting('rentcottage.equality_bundle_id')::uuid,
        'unitKind', 'full_day_bundle', 'standardPriceIqd', 250000
      )
    ))
  )$$,
  'a started active Shift can omit its hidden date override during unrelated repricing'
);
reset role;
select results_eq(
  $$select
      (select prices.price_iqd
       from public.cottage_inventory_date_price_overrides prices
       where prices.schedule_revision_id = fixture.revision_id
         and prices.unit_kind = 'shift'
         and prices.unit_id = fixture.shift_id
         and prices.service_day = fixture.service_day),
      (select selected.committed_price_iqd
       from public.cottage_inventory_commitments selected
       join public.cottage_booking_period_commitments periods
         on periods.id = selected.booking_period_commitment_id
       where periods.commitment_reference = 'RC-ACTIVE-PRICE-2601'),
      (select prices.price_iqd
       from public.cottage_inventory_date_price_overrides prices
       where prices.schedule_revision_id = fixture.revision_id
         and prices.unit_kind = 'full_day_bundle'
         and prices.unit_id = fixture.bundle_id
         and prices.service_day = fixture.service_day),
      (select prices.price_iqd
       from public.cottage_inventory_standard_prices prices
       where prices.schedule_revision_id = fixture.revision_id
         and prices.unit_kind = 'shift'
         and prices.unit_id = fixture.second_shift_id)
    from pricing_equality_fixture fixture$$,
  $$values (180000::bigint, 180000::bigint, 260000::bigint, 130000::bigint)$$,
  'active Shift and bundle pricing history stay immutable while the unrelated price persists'
);

select * from finish();
rollback;
