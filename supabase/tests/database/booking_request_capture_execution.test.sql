begin;
select plan(99);

-- BEGIN CAPTURE EXECUTION FIXTURE
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
      'recordedAt', '2026-01-01T12:00:00.000Z'
    ))
  ),
  'fictional-payments', 'local-test', 'fictional-merchant', 'fictional-terminal',
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
  'fictional-merchant', 'fictional-terminal',
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
    '6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d',
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
    '73000000-0000-4000-8000-000000001001:capture:attempt-2',
    target_amount_fils, target_currency, target_provider, 'local-test',
    'fictional-merchant', 'fictional-terminal',
    target_idempotency_key, target_fingerprint
  );
$$;

select pg_temp.insert_capture_work();
update public.booking_request_submission_attempts
set payment_snapshot = payment_snapshot || jsonb_build_object('currency', 'IQD', 'bookingPriceFils', 110000000, 'bookingServiceFeeFils', 5000000, 'customerTotalFils', 115000000)
where id = '70000000-0000-4000-8000-000000001001';
insert into public.booking_request_provider_operation_identities (attempt_id, operation_kind, provider, environment, merchant_id, terminal_id, provider_request_id, provider_reference, movement_reference)
select id, 'authorization', authorization_provider, authorization_environment, authorization_merchant_id, authorization_terminal_id, authorization_provider_request_id, authorization_provider_reference, authorization_movement_reference
from public.booking_request_submission_attempts where id = '70000000-0000-4000-8000-000000001001';
insert into public.cottage_booking_period_occupancies (booking_period_commitment_id, schedule_revision_id, shift_id, service_day, active)
values ('50000000-0000-4000-8000-000000001001', '30000000-0000-4000-8000-000000001001', '32000000-0000-4000-8000-000000001001', '2101-01-01', true);
-- END CAPTURE EXECUTION FIXTURE


select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = signature::regprocedure), 'Capture RPC is security-definer with an empty search path: ' || signature)
from (values ('public.lease_booking_request_capture_work(uuid,jsonb)'), ('public.execute_simulated_booking_request_capture(jsonb)'), ('public.complete_booking_request_capture(uuid,bigint,uuid,jsonb)'), ('public.lock_booking_request_capture_source(uuid)')) functions(signature);
select ok(has_function_privilege(role_name, signature, 'EXECUTE') = (role_name = 'service_role'), role_name || ' has only the intended Capture entry-point privilege: ' || signature)
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
cross join (values ('public.lease_booking_request_capture_work(uuid,jsonb)'), ('public.execute_simulated_booking_request_capture(jsonb)'), ('public.complete_booking_request_capture(uuid,bigint,uuid,jsonb)')) functions(signature);
select ok(not has_function_privilege(role_name, 'public.lock_booking_request_capture_source(uuid)', 'EXECUTE'), role_name || ' cannot invoke the private locking helper') from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name);
select ok(not exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privileges where p.oid in ('public.lease_booking_request_capture_work(uuid,jsonb)'::regprocedure, 'public.execute_simulated_booking_request_capture(jsonb)'::regprocedure, 'public.complete_booking_request_capture(uuid,bigint,uuid,jsonb)'::regprocedure, 'public.lock_booking_request_capture_source(uuid)'::regprocedure) and privileges.grantee = 0), 'PUBLIC has no Capture execution privilege');
set local role anon;
select throws_ok($$select public.lease_booking_request_capture_work(null, null)$$, '42501', null, 'anonymous callers cannot lease capture work');
select throws_ok($$select public.execute_simulated_booking_request_capture(null)$$, '42501', null, 'anonymous callers cannot execute Capture');
select throws_ok($$select public.complete_booking_request_capture(null, null, null, null)$$, '42501', null, 'anonymous callers cannot complete Capture');
reset role;
set local role authenticated;
select throws_ok($$select public.lease_booking_request_capture_work(null, null)$$, '42501', null, 'authenticated callers cannot lease capture work');
select throws_ok($$select public.execute_simulated_booking_request_capture(null)$$, '42501', null, 'authenticated callers cannot execute Capture');
select throws_ok($$select public.complete_booking_request_capture(null, null, null, null)$$, '42501', null, 'authenticated callers cannot complete Capture');
reset role;

set local role service_role;
select is(public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000009999', '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'), '{"status":"unavailable"}'::jsonb, 'service role can call the private capture entry point');
select throws_ok($$select public.query_simulated_payment_provider_operation('{"providerIdentity":{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"},"requestFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","paymentLifecycleId":"73000000-0000-4000-8000-000000001001","logicalOperationId":"73000000-0000-4000-8000-000000001001:capture","physicalAttemptId":"73000000-0000-4000-8000-000000001001:capture:attempt-2","operationKind":"capture","amountFils":115000000,"currency":"IQD"}', null, null, 'succeeded')$$, '22023', null, 'existing reconciliation RPC remains closed to Capture');
reset role;

create temp table capture_preservation as select
  (select to_jsonb(r) from public.booking_requests r where id = '60000000-0000-4000-8000-000000001001') as request,
  (select to_jsonb(c) from public.cottage_booking_period_commitments c where id = '50000000-0000-4000-8000-000000001001') as commitment,
  (select jsonb_agg(to_jsonb(o)) from public.cottage_booking_period_occupancies o where booking_period_commitment_id = '50000000-0000-4000-8000-000000001001') as occupancies,
  (select payment_snapshot from public.booking_request_submission_attempts where id = '70000000-0000-4000-8000-000000001001') as payment;
select throws_ok($$select public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001', '{"provider":"fictional-payments","environment":"local-test","merchantId":"wrong","terminalId":"fictional-terminal"}')$$, 'RC409', null, 'leasing rejects a provider mismatch');


savepoint invalid_capture_source;
update public.booking_requests set status = 'pending' where id = '60000000-0000-4000-8000-000000001001';
select throws_ok($$select public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001', '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')$$, 'RC409', null, 'leasing revalidates accepted request state');
rollback to savepoint invalid_capture_source;
savepoint invalid_capture_source;
update public.booking_request_submission_attempts set payment_snapshot = jsonb_set(payment_snapshot, '{authorization,amountFils}', '1') where id = '70000000-0000-4000-8000-000000001001';
select throws_ok($$select public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001', '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')$$, 'RC409', null, 'leasing revalidates Authorization amount');
rollback to savepoint invalid_capture_source;
savepoint invalid_capture_source;
update public.booking_request_submission_attempts set payment_snapshot = jsonb_set(payment_snapshot, '{authorization,status}', '"failed"') where id = '70000000-0000-4000-8000-000000001001';
select throws_ok($$select public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001', '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')$$, 'RC409', null, 'leasing revalidates Authorization success');
rollback to savepoint invalid_capture_source;
savepoint invalid_capture_source;
update public.booking_request_submission_attempts set payment_snapshot = jsonb_set(payment_snapshot, '{authorization,providerReference}', '"wrong"') where id = '70000000-0000-4000-8000-000000001001';
select throws_ok($$select public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001', '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')$$, 'RC409', null, 'leasing revalidates Authorization reference');
rollback to savepoint invalid_capture_source;
savepoint invalid_capture_source;
update public.booking_request_submission_attempts set payment_snapshot = jsonb_set(payment_snapshot, '{movements,0,movementReference}', '"wrong"') where id = '70000000-0000-4000-8000-000000001001';
select throws_ok($$select public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001', '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')$$, 'RC409', null, 'leasing revalidates Authorization movement');
rollback to savepoint invalid_capture_source;
savepoint invalid_capture_source;
update public.booking_request_submission_attempts set payment_snapshot = jsonb_set(payment_snapshot, '{customerTotalFils}', '1') where id = '70000000-0000-4000-8000-000000001001';
select throws_ok($$select public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001', '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')$$, 'RC409', null, 'leasing revalidates Customer Total');
rollback to savepoint invalid_capture_source;
savepoint invalid_capture_source;
update public.booking_request_submission_attempts set payment_snapshot = jsonb_set(payment_snapshot, '{currency}', '"USD"') where id = '70000000-0000-4000-8000-000000001001';
select throws_ok($$select public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001', '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')$$, 'RC409', null, 'leasing revalidates currency');
rollback to savepoint invalid_capture_source;
savepoint invalid_capture_source;
update public.booking_request_authorization_claims set state = 'authorized' where id = '72000000-0000-4000-8000-000000001001';
select throws_ok($$select public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001', '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')$$, 'RC409', null, 'leasing revalidates converted Authorization claim');
rollback to savepoint invalid_capture_source;

create temp table capture_lease as select public.lease_booking_request_capture_work(
  '60000000-0000-4000-8000-000000001001',
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as result;
select is((select result ->> 'status' from capture_lease), 'leased', 'one seeded capture work is leased');
select is((select count(*) from public.simulated_payment_provider_operations where operation_kind = 'capture'), 0::bigint, 'leasing does not execute the provider');

select is((select state || ':' || lease_generation::text from public.booking_request_capture_work where booking_request_id = '60000000-0000-4000-8000-000000001001'), 'processing:1', 'lease is durably persisted once');
select is((select result #>> '{permit,requestFingerprint}' from capture_lease), '6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d', 'permit carries the independently worked operation fingerprint');
select is(public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001', (select result #> '{permit,providerIdentity}' from capture_lease)), '{"status":"processing"}'::jsonb, 'a repeated lease returns processing without another permit');
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), '{"outcome":"succeeded","providerRequestId":"forged","providerReference":"forged","movementReference":"forged"}'), 'RC409', null, 'completion refuses a supplied success with no provider ledger');
select throws_ok(format('select public.execute_simulated_booking_request_capture(%L)', (select (result -> 'permit') || replacement from capture_lease)), 'RC409', null, 'provider rejects substituted ' || label)
from (values
  ('Booking Request', '{"bookingRequestId":"60000000-0000-4000-8000-000000009999"}'::jsonb),
  ('submission attempt', '{"submissionAttemptId":"70000000-0000-4000-8000-000000009999"}'::jsonb),
  ('claim', '{"authorizationClaimId":"72000000-0000-4000-8000-000000009999"}'::jsonb),
  ('claim generation', '{"authorizationClaimGeneration":2}'::jsonb),
  ('amount', '{"amountFils":1}'::jsonb), ('currency', '{"currency":"USD"}'::jsonb),
  ('provider', '{"providerIdentity":{"provider":"fictional-payments","environment":"local-test","merchantId":"wrong","terminalId":"fictional-terminal"}}'::jsonb),
  ('idempotency', '{"idempotencyKey":"wrong"}'::jsonb), ('fingerprint', '{"requestFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb),
  ('work', '{"workId":"60000000-0000-4000-8000-000000009999"}'::jsonb), ('lease generation', '{"leaseGeneration":2}'::jsonb),
  ('lease token', '{"leaseToken":"80000000-0000-4000-8000-000000009999"}'::jsonb), ('expiry', '{"notAfter":"2100-01-01T00:00:00.000Z"}'::jsonb),
  ('extra field', '{"customerName":"forbidden"}'::jsonb)
) mutations(label, replacement);


savepoint expired_capture;
update public.booking_request_capture_work set lease_expires_at = '2026-02-01T12:00:30.000Z' where booking_request_id = '60000000-0000-4000-8000-000000001001';
select is(public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001', (select result #> '{permit,providerIdentity}' from capture_lease)), '{"status":"expired"}'::jsonb, 'expired work stops without a new permit or lease renewal');
select is(public.execute_simulated_booking_request_capture((select (result -> 'permit') || '{"notAfter":"2026-02-01T12:00:30.000Z"}' from capture_lease)), '{"outcome":"not-executed"}'::jsonb, 'provider admission after expiry creates no movement');
select is((select lease_generation from public.booking_request_capture_work where booking_request_id = '60000000-0000-4000-8000-000000001001'), 1::bigint, 'expired work is not renewed');
rollback to savepoint expired_capture;

create temp table capture_result as select public.execute_simulated_booking_request_capture((select result -> 'permit' from capture_lease)) as result;
select is((select result ->> 'outcome' from capture_result), 'succeeded', 'the durable simulator has one fixed successful outcome');
select is((select capture_execution_permit from public.simulated_payment_provider_operations where operation_kind = 'capture'), (select result -> 'permit' from capture_lease), 'the provider ledger retains the exact durable admission permit');
select is((select count(*) from public.simulated_payment_provider_operations where operation_kind = 'capture'), 1::bigint, 'one capture has one physical provider row');

select is(public.execute_simulated_booking_request_capture((select result -> 'permit' from capture_lease)), (select result from capture_result), 'exact provider replay returns byte-equivalent evidence');
select is((select physical_execution_count::integer from public.simulated_payment_provider_operations where operation_kind = 'capture'), 1, 'provider replay retains one physical execution');
select throws_ok(format('update public.simulated_payment_provider_operations set capture_execution_permit = %L where operation_kind = %L', replacement, 'capture'), '23514', null, 'capture receipt rejects malformed permit ' || label)
from (values ('null', 'null'::jsonb), ('array', '[]'::jsonb), ('missing purpose', '{}'::jsonb), ('null purpose', '{"purpose":null}'::jsonb), ('incomplete shape', '{"purpose":"booking-request-capture"}'::jsonb)) mutations(label, replacement);
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), (select result || '{"movementReference":"forged"}'::jsonb from capture_result)), 'RC409', null, 'completion verifies supplied success against authoritative ledger identity');


savepoint late_completion;
update public.booking_request_capture_work set lease_expires_at = '2026-02-01T12:00:30.000Z' where booking_request_id = '60000000-0000-4000-8000-000000001001';
update public.simulated_payment_provider_operations set created_at = '2026-02-01T12:00:00.000Z', capture_execution_permit = capture_execution_permit || '{"notAfter":"2026-02-01T12:00:30.000Z"}' where operation_kind = 'capture';
select is(public.complete_booking_request_capture('60000000-0000-4000-8000-000000001001', 1, (select (result #>> '{permit,leaseToken}')::uuid from capture_lease), (select result from capture_result)) #>> '{snapshot,movements,1,recordedAt}', '2026-02-01T12:00:00.000000Z', 'late completion accepts proven pre-expiry execution and preserves occurrence time');
rollback to savepoint late_completion;

savepoint exact_expiry;
update public.booking_request_capture_work set lease_expires_at = '2026-02-01T12:00:30.000Z' where booking_request_id = '60000000-0000-4000-8000-000000001001';
update public.simulated_payment_provider_operations set created_at = '2026-02-01T12:00:30.000Z', capture_execution_permit = capture_execution_permit || '{"notAfter":"2026-02-01T12:00:30.000Z"}' where operation_kind = 'capture';
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), (select result from capture_result)), 'RC409', null, 'provider occurrence exactly at expiry is rejected');
update public.simulated_payment_provider_operations set created_at = '2026-02-01T12:00:30.000001Z' where operation_kind = 'capture';
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), (select result from capture_result)), 'RC409', null, 'provider occurrence after expiry is rejected');
select is((select count(*) from public.booking_request_provider_operation_identities where operation_kind = 'capture'), 0::bigint, 'expired evidence leaves no normalized Capture');
select is((select state from public.booking_request_capture_work where booking_request_id = '60000000-0000-4000-8000-000000001001'), 'processing', 'expired evidence leaves work incomplete');
rollback to savepoint exact_expiry;
savepoint replaced_lease;
update public.booking_request_capture_work set lease_generation = 2 where booking_request_id = '60000000-0000-4000-8000-000000001001';
select throws_ok(format('select public.complete_booking_request_capture(%L, %s, %L, %L)', '60000000-0000-4000-8000-000000001001', (select lease_generation from public.booking_request_capture_work where booking_request_id = '60000000-0000-4000-8000-000000001001'), (select lease_token::text from public.booking_request_capture_work where booking_request_id = '60000000-0000-4000-8000-000000001001'), (select result from capture_result)), 'RC409', null, 'new lease generation cannot adopt the old successful ledger');
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), (select result from capture_result)), 'RC409', null, 'old lease generation cannot complete replaced work');
rollback to savepoint replaced_lease;
savepoint replaced_lease;
update public.booking_request_capture_work set lease_token = '80000000-0000-4000-8000-000000009999' where booking_request_id = '60000000-0000-4000-8000-000000001001';
select throws_ok(format('select public.complete_booking_request_capture(%L, %s, %L, %L)', '60000000-0000-4000-8000-000000001001', (select lease_generation from public.booking_request_capture_work where booking_request_id = '60000000-0000-4000-8000-000000001001'), (select lease_token::text from public.booking_request_capture_work where booking_request_id = '60000000-0000-4000-8000-000000001001'), (select result from capture_result)), 'RC409', null, 'new lease token cannot adopt the old successful ledger');
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), (select result from capture_result)), 'RC409', null, 'old lease token cannot complete replaced work');
rollback to savepoint replaced_lease;
savepoint altered_ledger;
update public.simulated_payment_provider_operations set amount_fils = 1 where operation_kind = 'capture';
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), (select result from capture_result)), 'RC409', null, 'completion rejects an authoritative ledger bound to the wrong amount');
rollback to savepoint altered_ledger;
savepoint altered_authorization;
update public.booking_request_submission_attempts set payment_snapshot = jsonb_set(payment_snapshot, '{authorization,providerReference}', '"wrong"') where id = '70000000-0000-4000-8000-000000001001';
select throws_ok(format('select public.execute_simulated_booking_request_capture(%L)', (select result -> 'permit' from capture_lease)), 'RC409', null, 'provider revalidates Authorization on replay');
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), (select result from capture_result)), 'RC409', null, 'completion revalidates Authorization evidence');
rollback to savepoint altered_authorization;

create function pg_temp.fail_capture_snapshot() returns trigger language plpgsql as $$begin raise exception 'forced atomic failure' using errcode = 'RC499'; end;$$;
create trigger fail_capture_snapshot before update of payment_snapshot on public.booking_request_submission_attempts for each row execute function pg_temp.fail_capture_snapshot();
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), (select result from capture_result)), 'RC499', null, 'a failure after normalized identity and work writes aborts completion');
select is((select state from public.booking_request_capture_work where booking_request_id = '60000000-0000-4000-8000-000000001001'), 'processing', 'work completion rolls back after injected failure');
select is((select count(*) from public.booking_request_provider_operation_identities where operation_kind = 'capture'), 0::bigint, 'normalized identity rolls back after injected failure');
select is((select payment_snapshot from public.booking_request_submission_attempts where id = '70000000-0000-4000-8000-000000001001'), (select payment from capture_preservation), 'payment evidence remains unchanged after injected failure');
drop trigger fail_capture_snapshot on public.booking_request_submission_attempts;

create temp table capture_completion as select public.complete_booking_request_capture(
  '60000000-0000-4000-8000-000000001001', 1,
  (select (result #>> '{permit,leaseToken}')::uuid from capture_lease),
  (select result from capture_result)
) as result;
select is((select result ->> 'status' from capture_completion), 'complete', 'successful provider evidence completes capture work');
select is((select payment_snapshot -> 'capture' ->> 'status' from public.booking_request_submission_attempts where id = '70000000-0000-4000-8000-000000001001'), 'succeeded', 'the payment snapshot stores successful Capture');
select is((select count(*) from public.booking_request_provider_operation_identities where operation_kind = 'capture'), 1::bigint, 'Capture has one normalized provider identity');
select is((select jsonb_array_length(payment_snapshot -> 'movements') from public.booking_request_submission_attempts where id = '70000000-0000-4000-8000-000000001001'), 2, 'one Capture movement follows the preserved Authorization');

select is(public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001', (select result #> '{permit,providerIdentity}' from capture_lease)), (select result from capture_completion), 'completed work replays byte-equivalent immutable capture evidence');
select is(public.complete_booking_request_capture('60000000-0000-4000-8000-000000001001', 1, (select (result #>> '{permit,leaseToken}')::uuid from capture_lease), (select result from capture_result)), (select result from capture_completion), 'duplicate completion does not append another movement');
select is((select to_jsonb(r) from public.booking_requests r where id = '60000000-0000-4000-8000-000000001001'), (select request from capture_preservation), 'capture leaves the accepted Booking Request byte-for-byte unchanged');
select is((select to_jsonb(c) from public.cottage_booking_period_commitments c where id = '50000000-0000-4000-8000-000000001001'), (select commitment from capture_preservation), 'capture preserves the Pending Hold byte-for-byte');
select is((select jsonb_agg(to_jsonb(o)) from public.cottage_booking_period_occupancies o where booking_period_commitment_id = '50000000-0000-4000-8000-000000001001'), (select occupancies from capture_preservation), 'capture preserves existing active occupancies byte-for-byte');
select is((select payment_snapshot - array['capture','movements'] from public.booking_request_submission_attempts where id = '70000000-0000-4000-8000-000000001001'), (select payment - array['capture','movements'] from capture_preservation), 'capture preserves every unrelated payment field');
select is((select payment_snapshot #> '{movements,0}' from public.booking_request_submission_attempts where id = '70000000-0000-4000-8000-000000001001'), (select payment #> '{movements,0}' from capture_preservation), 'Authorization movement identity and timestamp are preserved exactly');
select is((select (result #>> '{snapshot,movements,1,recordedAt}')::timestamptz from capture_completion), (select created_at from public.simulated_payment_provider_operations where operation_kind = 'capture'), 'Capture occurrence is provider ledger time rather than completion time');
select ok(not exists (select 1 from public.booking_request_status_notifications) and not exists (select 1 from public.owner_request_notifications) and not exists (select 1 from public.booking_request_release_work) and not exists (select 1 from public.booking_request_authorization_reconciliation_outbox), 'capture creates no notification, release or recovery work');
select is((select count(*) from public.simulated_payment_provider_operations where operation_kind = 'capture'), 1::bigint, 'completion replay retains exactly one physical capture');
select is((select jsonb_array_length(payment_snapshot -> 'movements') from public.booking_request_submission_attempts where id = '70000000-0000-4000-8000-000000001001'), 2, 'completion replay retains exactly one Capture movement');

select * from finish();
rollback;
