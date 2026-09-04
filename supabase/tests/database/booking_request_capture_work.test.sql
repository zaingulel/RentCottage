begin;

select plan(27);

select has_table(
  'public', 'booking_request_capture_work',
  'accepted Booking Requests can own one private capture-work record'
);
select ok(
  (select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.booking_request_capture_work'::regclass)
  and not exists (
    select 1
    from pg_catalog.pg_policy policies
    where policies.polrelid = 'public.booking_request_capture_work'::regclass
  ),
  'capture work has Row Level Security enabled with no direct policies'
);
select ok(
  not exists (
    select 1
    from (values
      ('anon'), ('authenticated'), ('service_role')
    ) roles(role_name)
    cross join (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) privileges(privilege_name)
    where has_table_privilege(
      roles.role_name,
      'public.booking_request_capture_work',
      privileges.privilege_name
    )
  )
  and not exists (
    select 1
    from pg_catalog.pg_class relations
    cross join lateral aclexplode(coalesce(
      relations.relacl,
      acldefault('r', relations.relowner)
    )) privileges
    where relations.oid = 'public.booking_request_capture_work'::regclass
      and privileges.grantee = 0
  ),
  'no public or application role has any direct capture-work privilege'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc functions
    cross join lateral aclexplode(coalesce(
      functions.proacl,
      acldefault('f', functions.proowner)
    )) privileges
    where functions.oid =
      'public.enforce_booking_request_capture_work()'::regprocedure
      and privileges.grantee = 0
      and privileges.privilege_type = 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.enforce_booking_request_capture_work()', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'public.enforce_booking_request_capture_work()', 'execute'
  )
  and not has_function_privilege(
    'service_role', 'public.enforce_booking_request_capture_work()', 'execute'
  )
  and (
    select functions.proconfig = array['search_path=""']
    from pg_catalog.pg_proc functions
    where functions.oid =
      'public.enforce_booking_request_capture_work()'::regprocedure
  ),
  'the private binding trigger is schema-isolated and not directly executable'
);

insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values
  (
    '10000000-0000-4000-8000-000000001001',
    'authenticated', 'authenticated', '+9647500001001', now()
  ),
  (
    '10000000-0000-4000-8000-000000001002',
    'authenticated', 'authenticated', '+9647500001002', now()
  );
insert into public.account_contexts (user_id, role, owner_approval_state)
values
  (
    '10000000-0000-4000-8000-000000001001',
    'cottage_owner', 'approved'
  ),
  ('10000000-0000-4000-8000-000000001002', 'customer', null);
insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location,
  exact_address, capacity, bedrooms, bathrooms, amenities,
  source_language, description, house_rules, status
) values (
  '20000000-0000-4000-8000-000000001001',
  '10000000-0000-4000-8000-000000001001',
  'Capture Work Cottage', 'Baghdad', 'Karrada', 'Private test address',
  4, 2, 1, array['garden'], 'en',
  'Capture work fixture description', 'Capture work fixture rules', 'draft'
);
insert into public.cottage_shift_schedule_revisions (
  id, profile_id, revision, full_day_bundle_id
) values (
  '30000000-0000-4000-8000-000000001001',
  '20000000-0000-4000-8000-000000001001', 1,
  '31000000-0000-4000-8000-000000001001'
);
select set_config(
  'rentcottage.shift_schedule_write_revision_id',
  '30000000-0000-4000-8000-000000001001', true
);
insert into public.cottage_shifts (
  id, schedule_revision_id, position, name, start_time, end_time
) values
  (
    '32000000-0000-4000-8000-000000001001',
    '30000000-0000-4000-8000-000000001001',
    1, 'Morning', '08:00', '12:00'
  ),
  (
    '32000000-0000-4000-8000-000000001002',
    '30000000-0000-4000-8000-000000001001',
    2, 'Evening', '16:00', '22:00'
  );
select set_config('rentcottage.shift_schedule_write_revision_id', '', true);

insert into public.booking_snapshots (
  id, customer_user_id, profile_id, quote_fingerprint, intent_fingerprint,
  quote_payload, intent_payload, booking_terms_version,
  booking_terms_locale, booking_terms_body, booking_terms_sha256,
  cancellation_policy_version, acceptance_locale, acceptance_evidence,
  acceptance_evidence_fingerprint, marketplace_commission_rate_basis_points,
  marketplace_commission_amount_fils
) values (
  '40000000-0000-4000-8000-000000001001',
  '10000000-0000-4000-8000-000000001002',
  '20000000-0000-4000-8000-000000001001',
  repeat('a', 64), repeat('b', 64), '{}'::jsonb, '{}'::jsonb,
  'capture-work-test-v1', 'en', 'Fictional test terms', repeat('c', 64),
  'fictional-cancellation-v1', 'en', '{}'::jsonb, repeat('d', 64),
  1000, 11000000
);
insert into public.cottage_booking_period_commitments (
  id, customer_user_id, profile_id, schedule_revision_id,
  commitment_reference, status, access_ranges
) values (
  '50000000-0000-4000-8000-000000001001',
  '10000000-0000-4000-8000-000000001002',
  '20000000-0000-4000-8000-000000001001',
  '30000000-0000-4000-8000-000000001001',
  'CAPTURE-WORK-HOLD-1', 'pending_hold',
  tstzmultirange(tstzrange(
    '2101-01-01 08:00:00+03'::timestamptz,
    '2101-01-01 12:00:00+03'::timestamptz, '[)'
  ))
);
insert into public.booking_requests (
  id, booking_request_reference, customer_user_id, owner_user_id,
  profile_id, booking_snapshot_id, booking_period_commitment_id,
  payment_lifecycle_id, customer_name, party_size, status,
  response_deadline, created_at
) values (
  '60000000-0000-4000-8000-000000001001', 'RC-REQ-0000000000001001',
  '10000000-0000-4000-8000-000000001002',
  '10000000-0000-4000-8000-000000001001',
  '20000000-0000-4000-8000-000000001001',
  '40000000-0000-4000-8000-000000001001',
  '50000000-0000-4000-8000-000000001001',
  '73000000-0000-4000-8000-000000001001',
  'Fictional Customer', 4, 'accepted',
  '2100-12-31 16:00:00+00', '2100-12-31 12:00:00+00'
);
insert into public.booking_request_submission_attempts (
  id, customer_user_id, idempotency_key, payment_lifecycle_id, profile_id,
  locale, public_slug, requested_search, quote_fingerprint, quote_payload,
  intent_fingerprint, intent_payload, payment_snapshot,
  authorization_provider, authorization_environment,
  authorization_merchant_id, authorization_terminal_id,
  authorization_provider_request_id, authorization_provider_reference,
  authorization_movement_reference, state, booking_request_id
) values (
  '70000000-0000-4000-8000-000000001001',
  '10000000-0000-4000-8000-000000001002',
  '71000000-0000-4000-8000-000000001001',
  '73000000-0000-4000-8000-000000001001',
  '20000000-0000-4000-8000-000000001001',
  'en', 'capture-work-cottage', '{}'::jsonb,
  repeat('a', 64), '{}'::jsonb, repeat('b', 64), '{}'::jsonb,
  jsonb_build_object(
    'paymentLifecycleId', '73000000-0000-4000-8000-000000001001',
    'authorization', jsonb_build_object(
      'paymentLifecycleId', '73000000-0000-4000-8000-000000001001',
      'kind', 'authorization',
      'logicalOperationId',
        '73000000-0000-4000-8000-000000001001:authorization',
      'attemptId',
        '73000000-0000-4000-8000-000000001001:authorization:attempt-1',
      'status', 'succeeded', 'amountFils', 115000000,
      'providerRequestId', 'capture-auth-request-1',
      'providerReference', 'capture-auth-reference-1',
      'movementReference', 'capture-auth-movement-1',
      'reconciliationRequired', false, 'retrySafe', false
    ),
    'capture', null,
    'release', null,
    'movements', jsonb_build_array(jsonb_build_object(
      'kind', 'authorization',
      'logicalOperationId',
        '73000000-0000-4000-8000-000000001001:authorization',
      'attemptId',
        '73000000-0000-4000-8000-000000001001:authorization:attempt-1',
      'amountFils', 115000000,
      'movementReference', 'capture-auth-movement-1',
      'recordedAt', '2100-12-31T12:00:00.000Z'
    ))
  ),
  'fictional-payments', 'local-test', 'capture-merchant', 'capture-terminal',
  'capture-auth-request-1', 'capture-auth-reference-1',
  'capture-auth-movement-1', 'finalized',
  '60000000-0000-4000-8000-000000001001'
);
insert into public.booking_request_authorization_claims (
  id, attempt_id, generation, state_revision, state, customer_user_id,
  profile_id, schedule_revision_id, payment_lifecycle_id,
  logical_operation_id, physical_attempt_id, amount_fils, currency,
  provider, environment, merchant_id, terminal_id, provider_idempotency_key,
  quote_fingerprint, intent_fingerprint, access_ranges,
  not_after, reconciliation_expires_at
) values (
  '72000000-0000-4000-8000-000000001001',
  '70000000-0000-4000-8000-000000001001', 1, 2, 'converted',
  '10000000-0000-4000-8000-000000001002',
  '20000000-0000-4000-8000-000000001001',
  '30000000-0000-4000-8000-000000001001',
  '73000000-0000-4000-8000-000000001001',
  '73000000-0000-4000-8000-000000001001:authorization',
  '73000000-0000-4000-8000-000000001001:authorization:attempt-1',
  115000000, 'IQD', 'fictional-payments', 'local-test',
  'capture-merchant', 'capture-terminal',
  'booking-request:72000000-0000-4000-8000-000000001001:1',
  repeat('a', 64), repeat('b', 64),
  tstzmultirange(tstzrange(
    '2101-01-01 08:00:00+03'::timestamptz,
    '2101-01-01 12:00:00+03'::timestamptz, '[)'
  )),
  '2101-01-01 00:00:00+00', '2100-12-31 23:59:00+00'
);

create function pg_temp.insert_capture_work(
  target_amount_fils bigint default 115000000,
  target_provider text default 'fictional-payments',
  target_idempotency_key text default
    'booking-request-capture:60000000-0000-4000-8000-000000001001:1',
  target_fingerprint text default
    'ff1be0d836d449f5ccb77e4803fa203e3f043533afb74ca085bced2e1bf47f7f',
  target_capture_logical_id text default
    '73000000-0000-4000-8000-000000001001:capture',
  target_currency text default 'IQD'
)
returns void
language sql
set search_path = ''
as $$
  insert into public.booking_request_capture_work (
    booking_request_id, attempt_id,
    authorization_claim_id, authorization_claim_generation,
    payment_lifecycle_id,
    authorization_logical_operation_id, authorization_physical_attempt_id,
    capture_logical_operation_id, capture_physical_attempt_id,
    amount_fils, currency, provider, environment, merchant_id, terminal_id,
    provider_idempotency_key, request_fingerprint
  ) values (
    '60000000-0000-4000-8000-000000001001',
    '70000000-0000-4000-8000-000000001001',
    '72000000-0000-4000-8000-000000001001', 1,
    '73000000-0000-4000-8000-000000001001',
    '73000000-0000-4000-8000-000000001001:authorization',
    '73000000-0000-4000-8000-000000001001:authorization:attempt-1',
    target_capture_logical_id,
    '73000000-0000-4000-8000-000000001001:capture:attempt-1',
    target_amount_fils, target_currency, target_provider, 'local-test',
    'capture-merchant', 'capture-terminal',
    target_idempotency_key, target_fingerprint
  );
$$;

select lives_ok(
  $$select pg_temp.insert_capture_work()$$,
  'one exact accepted-request graph can create queued capture work'
);
select results_eq(
  $$select state, lease_generation, lease_token is null,
      lease_expires_at is null, outcome, completed_at is null,
      provider_idempotency_key, request_fingerprint
    from public.booking_request_capture_work$$,
  $$values (
    'queued'::text, 0::bigint, true, true, null::text, true,
    'booking-request-capture:60000000-0000-4000-8000-000000001001:1'::text,
    'ff1be0d836d449f5ccb77e4803fa203e3f043533afb74ca085bced2e1bf47f7f'::text
  )$$,
  'queued capture work stores the independently worked replay identity'
);
select throws_ok(
  $$select pg_temp.insert_capture_work()$$,
  '23505', null,
  'one Booking Request cannot own duplicate capture work'
);

savepoint invalid_capture_binding;
delete from public.booking_request_capture_work;
select throws_ok(
  $$select pg_temp.insert_capture_work(115000001)$$,
  'RC409', null,
  'capture work cannot change the authorized Customer Total'
);
select throws_ok(
  $$select pg_temp.insert_capture_work(target_currency => 'USD')$$,
  'RC409', null,
  'capture work requires Iraqi dinars'
);
select throws_ok(
  $$select pg_temp.insert_capture_work(
    115000000, 'other-provider'
  )$$,
  'RC409', null,
  'capture work cannot change the authorization provider identity'
);
select throws_ok(
  $$select pg_temp.insert_capture_work(
    115000000, 'fictional-payments', 'wrong-replay-key'
  )$$,
  'RC409', null,
  'capture work uses the exact request and authorization-generation replay key'
);
select throws_ok(
  $$select pg_temp.insert_capture_work(
    115000000, 'fictional-payments',
    'booking-request-capture:60000000-0000-4000-8000-000000001001:1',
    repeat('e', 64)
  )$$,
  'RC409', null,
  'capture work rejects a fingerprint outside the ordered provider operation payload'
);
select throws_ok(
  $$select pg_temp.insert_capture_work(
    115000000, 'fictional-payments',
    'booking-request-capture:60000000-0000-4000-8000-000000001001:1',
    'ff1be0d836d449f5ccb77e4803fa203e3f043533afb74ca085bced2e1bf47f7f',
    '73000000-0000-4000-8000-000000001001:authorization'
  )$$,
  'RC409', null,
  'capture identity is in the same lifecycle and distinct from authorization'
);
rollback to savepoint invalid_capture_binding;

savepoint invalid_capture_source_graph;
delete from public.booking_request_capture_work;
update public.booking_requests set status = 'pending';
select throws_ok(
  $$select pg_temp.insert_capture_work()$$,
  'RC409', null,
  'capture work cannot exist before Cottage Owner acceptance'
);
rollback to savepoint invalid_capture_source_graph;

savepoint mismatched_authorization_amount;
delete from public.booking_request_capture_work;
update public.booking_request_authorization_claims set amount_fils = 115000001;
select throws_ok(
  $$select pg_temp.insert_capture_work()$$,
  'RC409', null,
  'the exact replay payload cannot substitute a differently valued authorization claim'
);
rollback to savepoint mismatched_authorization_amount;

savepoint unconverted_authorization_claim;
delete from public.booking_request_capture_work;
update public.booking_request_authorization_claims set state = 'authorized';
select throws_ok(
  $$select pg_temp.insert_capture_work()$$,
  'RC409', null,
  'capture work requires a converted authorization claim'
);
rollback to savepoint unconverted_authorization_claim;

savepoint missing_capture_source_binding;
delete from public.booking_request_capture_work;
update public.booking_request_submission_attempts set booking_request_id = null;
select throws_ok(
  $$select pg_temp.insert_capture_work()$$,
  'RC409', null,
  'capture work requires the authorized attempt to belong to the exact request'
);
rollback to savepoint missing_capture_source_binding;

savepoint missing_capture_provider_binding;
delete from public.booking_request_capture_work;
update public.booking_request_submission_attempts
set authorization_provider = null, authorization_environment = null,
  authorization_merchant_id = null, authorization_terminal_id = null;
select throws_ok(
  $$select pg_temp.insert_capture_work()$$,
  'RC409', null,
  'capture work requires the full provider identity on the authorized attempt'
);
rollback to savepoint missing_capture_provider_binding;

savepoint mismatched_authorization_lifecycle;
delete from public.booking_request_capture_work;
update public.booking_request_submission_attempts
set payment_snapshot = jsonb_set(
  payment_snapshot, '{authorization,paymentLifecycleId}',
  '"73000000-0000-4000-8000-000000001002"'::jsonb
);
select throws_ok(
  $$select pg_temp.insert_capture_work()$$,
  'RC409', null,
  'capture work cannot bind authorization evidence from another payment lifecycle'
);
rollback to savepoint mismatched_authorization_lifecycle;

savepoint capture_evidence_already_exists;
delete from public.booking_request_capture_work;
update public.booking_request_submission_attempts
set payment_snapshot = jsonb_set(
  payment_snapshot, '{capture}', '{"status":"succeeded"}'::jsonb
);
select throws_ok(
  $$select pg_temp.insert_capture_work()$$,
  'RC409', null,
  'new capture work requires absent capture and release evidence'
);
update public.booking_request_submission_attempts
set payment_snapshot = payment_snapshot - 'capture';
select throws_ok(
  $$select pg_temp.insert_capture_work()$$,
  'RC409', null,
  'new capture work rejects missing capture or release evidence fields'
);
rollback to savepoint capture_evidence_already_exists;

select throws_ok(
  $$update public.booking_request_capture_work
    set lease_generation = 1$$,
  '23514', null,
  'queued capture work cannot hold a partial lease'
);
select lives_ok(
  $$update public.booking_request_capture_work
    set state = 'processing', lease_generation = 1,
      lease_token = '80000000-0000-4000-8000-000000001001',
      lease_expires_at = clock_timestamp() - interval '1 second'$$,
  'processing capture work requires a complete lease and may retain an expired lease'
);
select throws_ok(
  $$update public.booking_request_capture_work set amount_fils = 1$$,
  'RC204', null,
  'capture-work identity and money bindings are immutable'
);
savepoint missing_capture_outcome;
select throws_ok(
  $$update public.booking_request_capture_work
    set state = 'complete', lease_token = null, lease_expires_at = null,
      completed_at = clock_timestamp()$$,
  '23514', null,
  'completed capture work requires an explicit successful outcome'
);
rollback to savepoint missing_capture_outcome;
select lives_ok(
  $$update public.booking_request_capture_work
    set state = 'complete', lease_token = null, lease_expires_at = null,
      outcome = 'succeeded', completed_at = clock_timestamp()$$,
  'successful capture work completes only with cleared lease and outcome time'
);
select throws_ok(
  $$update public.booking_request_capture_work
    set state = 'processing', outcome = null, completed_at = null,
      lease_token = '80000000-0000-4000-8000-000000001002',
      lease_expires_at = clock_timestamp() + interval '1 minute'$$,
  'RC204', null,
  'completed capture work cannot move backwards'
);

select * from finish();

rollback;
