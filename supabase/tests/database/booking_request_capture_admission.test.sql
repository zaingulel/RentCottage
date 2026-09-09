begin;
select plan(34);

select ok((select not prosecdef and provolatile = 's' and proconfig = array['search_path=""']
  from pg_proc where oid = 'public.booking_request_payment_status(public.booking_requests)'::regprocedure),
  'The shared payment projection is stable and invoker-only with an empty search path');
select ok(not exists (
  select 1 from pg_proc functions, lateral aclexplode(coalesce(functions.proacl, acldefault('f', functions.proowner))) privileges
  where functions.oid = 'public.booking_request_payment_status(public.booking_requests)'::regprocedure
    and privileges.grantee = 0 and privileges.privilege_type = 'EXECUTE'
), 'PUBLIC has no shared payment projection execution grant');
select ok(not has_function_privilege('anon', 'public.booking_request_payment_status(public.booking_requests)', 'execute'),
  'anon cannot execute the private payment projection');
set local role anon;
select throws_ok($$select public.booking_request_payment_status(null::public.booking_requests)$$,
  '42501', 'permission denied for function booking_request_payment_status',
  'anon direct calls are denied at the private function boundary');
reset role;
select ok(not has_function_privilege('authenticated', 'public.booking_request_payment_status(public.booking_requests)', 'execute'),
  'authenticated cannot execute the private payment projection');
set local role authenticated;
select throws_ok($$select public.booking_request_payment_status(null::public.booking_requests)$$,
  '42501', 'permission denied for function booking_request_payment_status',
  'authenticated direct calls are denied at the private function boundary');
reset role;
select ok(not has_function_privilege('service_role', 'public.booking_request_payment_status(public.booking_requests)', 'execute'),
  'service_role cannot execute the private payment projection');
set local role service_role;
select throws_ok($$select public.booking_request_payment_status(null::public.booking_requests)$$,
  '42501', 'permission denied for function booking_request_payment_status',
  'service_role direct calls are denied at the private function boundary');
reset role;

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

update public.booking_request_submission_attempts
set payment_snapshot = payment_snapshot || jsonb_build_object('currency', 'IQD', 'bookingPriceFils', 110000000, 'bookingServiceFeeFils', 5000000, 'customerTotalFils', 115000000)
where id = '70000000-0000-4000-8000-000000001001';
insert into public.booking_request_provider_operation_identities (attempt_id, operation_kind, provider, environment, merchant_id, terminal_id, provider_request_id, provider_reference, movement_reference)
select id, 'authorization', authorization_provider, authorization_environment, authorization_merchant_id, authorization_terminal_id, authorization_provider_request_id, authorization_provider_reference, authorization_movement_reference
from public.booking_request_submission_attempts where id = '70000000-0000-4000-8000-000000001001';
insert into public.cottage_booking_period_occupancies (booking_period_commitment_id, schedule_revision_id, shift_id, service_day, active)
values ('50000000-0000-4000-8000-000000001001', '30000000-0000-4000-8000-000000001001', '32000000-0000-4000-8000-000000001001', '2101-01-01', true);

update public.booking_requests set status = 'pending';

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000001002', true);
set local role authenticated;
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->'paymentStatus', 'null'::jsonb, 'Pending request has no payment confirmation claim');
reset role;
update public.booking_requests set status = 'accepted';
set local role authenticated;
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->'paymentStatus', 'null'::jsonb, 'Historical acceptance without intent remains legacy accepted');
reset role;
update public.booking_requests set status = 'pending';
update public.account_contexts set role = 'customer' , owner_approval_state = null where user_id = '10000000-0000-4000-8000-000000001001';
select is(public.claim_booking_request_action('10000000-0000-4000-8000-000000001001',
  '60000000-0000-4000-8000-000000001001', 'accept')->>'status', 'access-required',
  'Ownership does not replace the Cottage Owner role');
update public.account_contexts set role = 'cottage_owner', owner_approval_state = 'prospective'
  where user_id = '10000000-0000-4000-8000-000000001001';
select is(public.claim_booking_request_action('10000000-0000-4000-8000-000000001001',
  '60000000-0000-4000-8000-000000001001', 'accept')->>'status', 'access-required', 'Unapproved owner cannot admit capture');
update public.account_contexts set owner_approval_state = 'approved' where user_id = '10000000-0000-4000-8000-000000001001';
update public.booking_request_submission_attempts set payment_snapshot = jsonb_set(payment_snapshot, '{authorization,providerReference}', '"wrong"');
select throws_ok($$select public.claim_booking_request_action('10000000-0000-4000-8000-000000001001',
  '60000000-0000-4000-8000-000000001001', 'accept')$$, 'RC409', null, 'Malformed stored authorization rejects acceptance');
select is((select status from public.booking_requests), 'pending', 'Malformed source rolls back the owner decision');
select is((select count(*)::integer from public.booking_request_capture_work), 0, 'Malformed source rolls back capture admission');
update public.booking_request_submission_attempts set payment_snapshot = jsonb_set(payment_snapshot, '{authorization,providerReference}', '"capture-auth-reference-1"');
set local role service_role;
select is(public.claim_booking_request_action(
  '10000000-0000-4000-8000-000000001001',
  '60000000-0000-4000-8000-000000001001', 'accept')->>'status', 'accepted',
  'The approved owner accepts a pending request');
reset role;
select is((select count(*)::integer from public.booking_request_capture_work), 1,
  'Acceptance commits one capture intent');
select is((select amount_fils from public.booking_request_capture_work), 115000000::bigint,
  'The admitted capture collects IQD 110000 plus IQD 5000 in fils');
select is((select request_fingerprint from public.booking_request_capture_work),
  '6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d',
  'Capture binding preserves the hand-worked provider fingerprint');
select is((select provider_idempotency_key from public.booking_request_capture_work),
  'booking-request-capture:60000000-0000-4000-8000-000000001001:1', 'Capture has one stable replay identity');
select is((select count(*)::integer from public.payment_provider_operations where operation_kind = 'capture'), 0,
  'Acceptance never executes a provider');
select is(public.claim_booking_request_action(
  '10000000-0000-4000-8000-000000001001',
  '60000000-0000-4000-8000-000000001001', 'accept')->>'status', 'accepted',
  'Repeated acceptance returns the admitted outcome');
select is((select count(*)::integer from public.booking_request_status_notifications where status = 'accepted'), 2,
  'Repeated acceptance preserves exactly the two status notifications');
select is(public.claim_booking_request_action('10000000-0000-4000-8000-000000001001',
  '60000000-0000-4000-8000-000000001001', 'decline', 'other')->>'status', 'accepted', 'Admitted acceptance fences decline');
select is(public.claim_booking_request_action('10000000-0000-4000-8000-000000001002',
  '60000000-0000-4000-8000-000000001001', 'withdraw')->>'status', 'accepted', 'Admitted acceptance fences withdrawal');
select is(public.claim_booking_request_expiry('60000000-0000-4000-8000-000000001001')->>'status', 'accepted', 'Admitted acceptance fences expiry');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000001002', true);
set local role authenticated;
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->>'paymentStatus', 'capture-processing', 'Admission projects pending confirmation to the Customer');
reset role;
insert into public.owner_request_notifications (booking_request_id, owner_user_id)
values ('60000000-0000-4000-8000-000000001001', '10000000-0000-4000-8000-000000001001');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000001001', true);
set local role authenticated;
select is(public.list_owner_booking_request_notifications()#>>'{0,paymentStatus}', 'capture-processing', 'Owner sees authoritative admission');
select is(public.get_customer_booking_request('RC-REQ-0000000000001001'), null::jsonb, 'Owner cannot use the Customer projection');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000001002', true);
select is(public.list_owner_booking_request_notifications(), '[]'::jsonb, 'Customer cannot use the Owner projection');
reset role;
select ok(has_function_privilege('service_role', 'public.list_due_booking_request_capture_intents(integer,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.list_due_booking_request_capture_intents(integer,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.list_due_booking_request_capture_intents(integer,jsonb)', 'execute'),
  'Only service role may select admitted capture intents');
select throws_ok($$select public.list_due_booking_request_capture_intents(51, '{}'::jsonb)$$, 'RC409', null, 'Queued selection rejects invalid bounds and provider binding');
select is(public.list_due_booking_request_capture_intents(20, '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'),
  '["60000000-0000-4000-8000-000000001001"]'::jsonb, 'Queued selection returns only admitted request identities');
select is(public.list_due_booking_request_capture_intents(20, '{"provider":"fictional-payments","environment":"local-test","merchantId":"other-merchant","terminalId":"fictional-terminal"}'),
  '[]'::jsonb, 'Queued selection cannot cross the provider binding');
select * from finish();
rollback;
