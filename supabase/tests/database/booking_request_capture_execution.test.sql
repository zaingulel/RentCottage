begin;
-- BEGIN PAYMENT EVIDENCE FIXTURE
-- Test arrangement: admission, isolated effect, and explicit recording.
create or replace function pg_temp.payment_fixture_result(admission jsonb, outcome text) returns jsonb language plpgsql as $$
declare effect_binding jsonb:=admission-array['purpose','binding','mode'];
declare observed jsonb;
declare proposed jsonb;
declare recorder text;
declare operation_id text:=admission->>'operationId';
begin
  if admission->>'status'='not-admitted' then return jsonb_build_object('outcome','not-executed'); end if;
  if operation_id is null then return admission; end if;
  proposed:=jsonb_build_object('outcome',outcome,'providerRequestId','fixture-request-'||operation_id,'providerReference','fixture-reference-'||operation_id,
    'evidence',jsonb_build_object('operationId',operation_id,'eventId','fixture-'||operation_id||'-'||outcome,'provenance','fictional-provider',
      'originalOutcome',outcome,'executedAt',clock_timestamp(),'occurredAt',case when outcome<>'indeterminate' then clock_timestamp() end,'closedAt',null))
    ||case when outcome='failed' then jsonb_build_object('retrySafe',false) else jsonb_build_object('movementReference','fixture-movement-'||operation_id) end;
  if admission->>'mode'='execute' then observed:=public.persist_simulated_payment_effect(effect_binding,proposed);
  else
    observed:=public.seal_simulated_payment_absence(effect_binding);
    if observed->>'outcome'='indeterminate' and outcome<>'indeterminate' then
      proposed:=jsonb_set(proposed,'{evidence,originalOutcome}',observed#>'{evidence,originalOutcome}');
      proposed:=jsonb_set(proposed,'{evidence,executedAt}',observed#>'{evidence,executedAt}');
      proposed:=proposed||jsonb_build_object('providerRequestId',observed->>'providerRequestId','providerReference',observed->>'providerReference');
      if outcome='succeeded' then proposed:=proposed||jsonb_build_object('movementReference',observed->>'movementReference'); end if;
      observed:=public.resolve_simulated_payment_effect(effect_binding,observed#>>'{evidence,eventId}',proposed);
    end if;
  end if;
  recorder:=case admission->>'purpose' when 'booking-request-capture' then 'record_booking_request_capture_observation'
    when 'booking-request-payment-recovery' then 'record_booking_request_payment_recovery_observation'
    when 'booking-request-payment-required-expiry' then 'record_booking_request_payment_required_expiry_observation'
    when 'booking-request-payment-required-corrective-refund' then 'record_booking_request_payment_required_expiry_observation'
    else 'record_booking_request_provider_operation_observation' end;
  execute format('select public.%I($1,$2)',recorder) into observed using operation_id::uuid,observed;
  return observed-'evidence';
end;
$$;
create or replace function pg_temp.payment_fixture_execute(routine text,permit jsonb,outcome text) returns jsonb language plpgsql as $$
declare prior_role text:=current_setting('role'); declare admission jsonb; declare result jsonb;
begin
  if prior_role='none' then perform set_config('role','service_role',true); end if;
  execute format('select public.%I($1)',routine) into admission using permit;
  result:=pg_temp.payment_fixture_result(admission,outcome);
  perform set_config('role',prior_role,true);
  return result;
end;
$$;
create or replace function pg_temp.capture_execute(permit jsonb,outcome text default 'succeeded') returns jsonb language sql as $$
  select pg_temp.payment_fixture_execute('admit_booking_request_capture',permit,outcome);
$$;
create or replace function pg_temp.payment_query(operation jsonb,request_id text,reference text,outcome text) returns jsonb language plpgsql as $$
declare prior_role text:=current_setting('role'); declare result jsonb;
begin
  if prior_role='none' then perform set_config('role','service_role',true); end if;
  result:=pg_temp.payment_fixture_result(public.reload_booking_request_payment_operation(operation-array['permitPurpose','claimId','claimGeneration','notAfter','idempotencyKey','cleanupAttemptId','workId','leaseGeneration','leaseToken','stateRevision','operationId','operationGeneration'],request_id,reference),outcome);
  perform set_config('role',prior_role,true);
  return result;
end;
$$;
create or replace function pg_temp.capture_query(operation jsonb,request_id text,reference text) returns jsonb language sql as $$
  select pg_temp.payment_query(operation,request_id,reference,'succeeded');
$$;
-- END PAYMENT EVIDENCE FIXTURE
select plan(263);

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
    '2101-01-01 22:00:00+03'::timestamptz, '[)'
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
    '2101-01-01 22:00:00+03'::timestamptz, '[)'
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
values
  ('50000000-0000-4000-8000-000000001001', '30000000-0000-4000-8000-000000001001', '32000000-0000-4000-8000-000000001001', '2101-01-01', true),
  ('50000000-0000-4000-8000-000000001001', '30000000-0000-4000-8000-000000001001', '32000000-0000-4000-8000-000000001002', '2101-01-01', true);
insert into public.cottage_inventory_commitments
  (id, unit_kind, unit_id, service_day, committed_price_iqd, booking_period_commitment_id)
values ('51000000-0000-4000-8000-000000001001', 'full_day_bundle',
  '31000000-0000-4000-8000-000000001001', '2101-01-01', 115000,
  '50000000-0000-4000-8000-000000001001');
insert into public.booking_request_authorization_claim_items
  (claim_id, unit_kind, unit_id, service_day, price_iqd)
values ('72000000-0000-4000-8000-000000001001', 'full_day_bundle',
  '31000000-0000-4000-8000-000000001001', '2101-01-01', 115000);
insert into public.booking_request_authorization_claim_occupancies
  (claim_id, schedule_revision_id, shift_id, service_day, active)
values ('72000000-0000-4000-8000-000000001001',
  '30000000-0000-4000-8000-000000001001',
  '32000000-0000-4000-8000-000000001001', '2101-01-01', false),
  ('72000000-0000-4000-8000-000000001001',
  '30000000-0000-4000-8000-000000001001',
  '32000000-0000-4000-8000-000000001002', '2101-01-01', false);
-- END CAPTURE EXECUTION FIXTURE


select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = signature::regprocedure), 'Capture RPC is security-definer with an empty search path: ' || signature)
from (values ('public.lease_booking_request_capture_work(uuid,jsonb)'), ('public.admit_booking_request_capture(jsonb)'), ('public.complete_booking_request_capture(uuid,bigint,uuid,jsonb)'), ('public.lock_booking_request_capture_source(uuid)'), ('public.claim_due_booking_request_captures(integer,jsonb)'), ('public.reload_booking_request_payment_operation(jsonb,text,text)')) functions(signature);
select ok(has_function_privilege(role_name, signature, 'EXECUTE') = (role_name = 'service_role'), role_name || ' has only the intended Capture entry-point privilege: ' || signature)
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
cross join (values ('public.lease_booking_request_capture_work(uuid,jsonb)'), ('public.admit_booking_request_capture(jsonb)'), ('public.complete_booking_request_capture(uuid,bigint,uuid,jsonb)'), ('public.claim_due_booking_request_captures(integer,jsonb)'), ('public.reload_booking_request_payment_operation(jsonb,text,text)')) functions(signature);
select ok(not has_function_privilege(role_name, 'public.lock_booking_request_capture_source(uuid)', 'EXECUTE'), role_name || ' cannot invoke the private locking helper') from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name);
select ok(not exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privileges where p.oid in ('public.lease_booking_request_capture_work(uuid,jsonb)'::regprocedure, 'public.admit_booking_request_capture(jsonb)'::regprocedure, 'public.complete_booking_request_capture(uuid,bigint,uuid,jsonb)'::regprocedure, 'public.lock_booking_request_capture_source(uuid)'::regprocedure, 'public.claim_due_booking_request_captures(integer,jsonb)'::regprocedure, 'public.reload_booking_request_payment_operation(jsonb,text,text)'::regprocedure) and privileges.grantee = 0), 'PUBLIC has no Capture execution privilege');
set local role anon;
select throws_ok($$select public.claim_due_booking_request_captures(20,null)$$, '42501', null, 'anon cannot reclaim Capture');
select throws_ok($$select pg_temp.capture_query(null,null,null)$$, '42501', null, 'anon cannot query Capture');
select throws_ok($$select public.lease_booking_request_capture_work(null, null)$$, '42501', null, 'anonymous callers cannot lease capture work');
select throws_ok($$select public.admit_booking_request_capture(null)$$, '42501', null, 'anonymous callers cannot execute Capture');
select throws_ok($$select public.complete_booking_request_capture(null, null, null, null)$$, '42501', null, 'anonymous callers cannot complete Capture');
reset role;
set local role authenticated;
select throws_ok($$select public.claim_due_booking_request_captures(20,null)$$, '42501', null, 'authenticated cannot reclaim Capture');
select throws_ok($$select pg_temp.capture_query(null,null,null)$$, '42501', null, 'authenticated cannot query Capture');
select throws_ok($$select public.lease_booking_request_capture_work(null, null)$$, '42501', null, 'authenticated callers cannot lease capture work');
select throws_ok($$select public.admit_booking_request_capture(null)$$, '42501', null, 'authenticated callers cannot execute Capture');
select throws_ok($$select public.complete_booking_request_capture(null, null, null, null)$$, '42501', null, 'authenticated callers cannot complete Capture');
reset role;

set local role service_role;
select is(public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000009999', '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'), '{"status":"unavailable"}'::jsonb, 'service role can call the private capture entry point');
select throws_ok($$select pg_temp.payment_query('{"providerIdentity":{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"},"requestFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","paymentLifecycleId":"73000000-0000-4000-8000-000000001001","logicalOperationId":"73000000-0000-4000-8000-000000001001:capture","physicalAttemptId":"73000000-0000-4000-8000-000000001001:capture:attempt-2","operationKind":"capture","amountFils":115000000,"currency":"IQD"}', null, null, 'succeeded')$$, 'RC409', null, 'shared inquiry requires a durable admitted Capture');
reset role;

select is(public.claim_due_booking_request_captures(20, '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'), '[]'::jsonb, 'queued Capture cannot be selected for recovery');
select throws_ok(format('select public.claim_due_booking_request_captures(%s, %L)', coalesce(limit_value::text,'null'), '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'), 'RC409', null, 'database rejects invalid recovery limit') from (values (null::integer),(0),(51)) limits(limit_value);
select throws_ok(format('select public.claim_due_booking_request_captures(20, %L)', identity), 'RC409', null, 'database rejects malformed recovery provider identity') from (values ('null'::jsonb), ('{}'::jsonb), ('{"provider":true,"environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb)) identities(identity);

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
select is((select count(*) from public.payment_provider_operations where operation_kind = 'capture'), 0::bigint, 'leasing does not execute the provider');

select is((select state || ':' || lease_generation::text from public.booking_request_capture_work where booking_request_id = '60000000-0000-4000-8000-000000001001'), 'processing:1', 'lease is durably persisted once');
select is((select result #>> '{permit,requestFingerprint}' from capture_lease), '6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d', 'permit carries the independently worked operation fingerprint');
select is(public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001', (select result #> '{permit,providerIdentity}' from capture_lease)), '{"status":"processing"}'::jsonb, 'a repeated lease returns processing without another permit');
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), '{"outcome":"succeeded","providerRequestId":"forged","providerReference":"forged","movementReference":"forged"}'), 'RC409', null, 'completion refuses a supplied success with no provider ledger');
select throws_ok(format('select pg_temp.capture_execute(%L)', (select (result -> 'permit') || replacement from capture_lease)), 'RC409', null, 'provider rejects substituted ' || label)
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
select is(pg_temp.capture_execute((select (result -> 'permit') || '{"notAfter":"2026-02-01T12:00:30.000Z"}' from capture_lease)), '{"outcome":"not-executed"}'::jsonb, 'provider admission after expiry creates no movement');
select is((select lease_generation from public.booking_request_capture_work where booking_request_id = '60000000-0000-4000-8000-000000001001'), 1::bigint, 'expired work is not renewed');
rollback to savepoint expired_capture;

savepoint missing_failure_ledger;
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  '{"outcome":"failed","providerRequestId":"missing-request","providerReference":"missing-reference","retrySafe":false}'::jsonb), 'RC409', null, 'a failed response without durable execution cannot open Payment Required');
rollback to savepoint missing_failure_ledger;

savepoint missing_recovery_evidence;
update public.booking_request_capture_work set lease_expires_at = '2026-02-01T00:00:00Z';
select is(public.claim_due_booking_request_captures(20, (select result #> '{permit,providerIdentity}' from capture_lease)), '[{"status":"unavailable"}]'::jsonb, 'missing execution evidence is visibly unavailable');
select is((select lease_generation from public.booking_request_capture_work), 1::bigint, 'missing execution evidence cannot renew ownership');
rollback to savepoint missing_recovery_evidence;

savepoint explicit_capture_recording;
create temp table observation_admission as select public.admit_booking_request_capture((select result->'permit' from capture_lease)) admission;
select ok((select current_outcome is null and original_outcome is null and executed_at is null and recorded_at is null
  and provider_request_id is null and provider_reference is null from public.payment_provider_operations where operation_kind='capture'),
  'durable capture admission invents no result, references, execution or receipt');
select is((select count(*) from public.simulated_payment_effects),0::bigint,'capture admission makes no fictional effect');
select is((select count(*) from public.booking_request_payment_history where source='provider-operation'),0::bigint,'capture admission invents no physical execution history');
create temp table observation_proposal as select jsonb_build_object('outcome','failed','providerRequestId','observed-request','providerReference','observed-reference','retrySafe',false,
  'evidence',jsonb_build_object('operationId',admission->>'operationId','eventId','observed-event','provenance','fictional-provider','originalOutcome','failed',
    'executedAt',clock_timestamp(),'occurredAt',clock_timestamp(),'closedAt',null)) result from observation_admission;
grant select on observation_admission,observation_proposal to service_role;
set local role service_role;
create temp table isolated_observation as select public.persist_simulated_payment_effect(
  (select admission-array['purpose','binding','mode'] from observation_admission),(select result from observation_proposal)) result;
reset role;
select ok((select current_outcome is null and recorded_at is null from public.payment_provider_operations where operation_kind='capture'),
  'provider effect alone leaves shared admission unrecorded');
select is((select state from public.booking_request_capture_work),'processing','provider effect alone cannot open Payment Required');
update public.booking_request_capture_work set lease_expires_at=clock_timestamp()-interval '1 second';
create temp table observation_recovery as select public.claim_due_booking_request_captures(20,(select admission->'providerIdentity' from observation_admission)) result;
select is((select result#>>'{0,status}' from observation_recovery),'reconcile','fresh owner reclaims the admitted capture before response recording');
select ok((select result#>'{0,lease,providerResult}'='{"providerRequestId":null,"providerReference":null}'::jsonb from observation_recovery),
  'fresh owner inquiries use original admission with no known provider references');
set local role service_role;
select throws_ok($$select public.record_booking_request_provider_operation_observation((select (admission->>'operationId')::uuid from observation_admission),(select result from isolated_observation))$$,
  'RC409',null,'a capture observation cannot use another purpose recorder');
select throws_ok($$select public.record_booking_request_capture_observation((select (admission->>'operationId')::uuid from observation_admission),
  (select jsonb_set(jsonb_set(result,'{evidence,executedAt}','"2020-01-01T00:00:00Z"'),'{evidence,occurredAt}','"2020-01-01T00:00:00Z"') from isolated_observation))$$,
  'RC409',null,'provider evidence cannot invent a pre-admission execution time');
select lives_ok($$select public.record_booking_request_capture_observation((select (admission->>'operationId')::uuid from observation_admission),(select result from isolated_observation))$$,
  'late response records against original admission after ownership takeover');
select lives_ok($$select public.record_booking_request_capture_observation((select (admission->>'operationId')::uuid from observation_admission),(select result from isolated_observation))$$,
  'exact provider event duplicate is accepted idempotently');
select throws_ok($$select public.record_booking_request_capture_observation((select (admission->>'operationId')::uuid from observation_admission),
  (select result||'{"providerReference":"conflicting-reference"}'::jsonb from isolated_observation))$$,'RC409',null,
  'same provider event cannot replace its accepted payload');
reset role;
select is((select count(*) from public.payment_provider_observations),1::bigint,'duplicate and conflict leave one accepted event');
select ok((select original_outcome='failed' and current_outcome='failed' and provider_reference='observed-reference'
  and executed_at=authoritative_outcome_at and recorded_at>=executed_at from public.payment_provider_operations where operation_kind='capture'),
  'recording preserves original outcome and execution separately from receipt time');
select is((select state from public.booking_request_capture_work),'processing','explicit evidence recording does not bypass Capture completion');
select throws_ok($$update public.payment_provider_observations set result='{}'$$,'RC409',null,'accepted child observations are append-only');
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result#>>'{permit,leaseToken}' from capture_lease),(select result-'evidence' from isolated_observation)),
  'RC409',null,'late evidence does not restore superseded worker authority');
select is(public.record_booking_request_capture_failure('60000000-0000-4000-8000-000000001001',
  (select lease_generation from public.booking_request_capture_work),(select lease_token from public.booking_request_capture_work),
  (select result-'evidence' from isolated_observation))->>'status','payment-required','current recovery owner completes the one recorded effect');
rollback to savepoint explicit_capture_recording;

savepoint indeterminate_capture_succeeded;
create temp table unknown_capture_result as select pg_temp.capture_execute((select result->'permit' from capture_lease),'indeterminate') result;
select lives_ok($$select public.lock_booking_request_capture_source('60000000-0000-4000-8000-000000001001')$$,
  'recorded unknown Capture remains valid source evidence before succeeded resolution');
select is((select state from public.booking_request_capture_work),'processing','unknown Capture retains processing before succeeded resolution');
select is((select count(*) from public.booking_request_provider_operation_identities where operation_kind='capture'),0::bigint,'unknown Capture creates no business identity before succeeded resolution');
update public.booking_request_capture_work set lease_expires_at=clock_timestamp()-interval '1 second';
create temp table unknown_capture_recovery as select public.claim_due_booking_request_captures(20,(select result#>'{permit,providerIdentity}' from capture_lease)) result;
select ok((select result#>'{0,lease,providerResult}' ? 'movementReference' is false from unknown_capture_recovery),
  'unresolved Capture inquiry excludes provisional movement before succeeded resolution');
select throws_ok($$select public.complete_booking_request_capture('60000000-0000-4000-8000-000000001001',null,null,null)$$,
  'RC409',null,'unknown Capture grants no successful receipt before succeeded resolution');
-- A receipt clock distinct from both actual execution and success occurrence cannot date the movement.
alter table public.payment_provider_observations alter column received_at set default '2025-01-01T00:00:00Z'::timestamptz;
create temp table resolved_capture_result as select pg_temp.payment_query((select jsonb_build_object('providerIdentity',result#>'{permit,providerIdentity}',
  'requestFingerprint',result#>'{permit,requestFingerprint}','paymentLifecycleId',result#>'{permit,paymentLifecycleId}',
  'logicalOperationId',result#>'{permit,captureLogicalOperationId}','physicalAttemptId',result#>'{permit,capturePhysicalAttemptId}',
  'operationKind','capture','amountFils',result#>'{permit,amountFils}','currency','IQD') from capture_lease),
  (select result->>'providerRequestId' from unknown_capture_result),(select result->>'providerReference' from unknown_capture_result),'succeeded') result;
select is((select original_outcome||':'||current_outcome from public.payment_provider_operations where operation_kind='capture'),'indeterminate:succeeded',
  'Capture succeeded resolution preserves immutable original unknown outcome');
select is((select physical_execution_count::integer from public.simulated_payment_effects),1,'Capture succeeded resolution retains one physical execution');
select is((select count(*) from public.payment_provider_observations),2::bigint,'Capture succeeded resolution appends one accepted observation');
select throws_ok(format('select public.complete_booking_request_capture(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result#>>'{permit,leaseToken}' from capture_lease),(select result from resolved_capture_result)),
  'RC409',null,'original superseded Capture owner cannot complete after succeeded resolution');
update public.booking_request_capture_work set lease_expires_at=clock_timestamp()-interval '1 second';
create temp table resolved_capture_reclaim as select public.claim_due_booking_request_captures(20,(select result#>'{permit,providerIdentity}' from capture_lease)) result;
select is((select result#>>'{0,lease,providerResult,movementReference}' from resolved_capture_reclaim),
  (select movement_reference from public.payment_provider_operations where operation_kind='capture'),
  'reclaim of already-resolved unknown Capture success includes its accepted movement');
savepoint missing_capture_success_occurrence;
-- Deliberate superuser fixture corruption isolates the successful receipt boundary;
-- restore the guard before observing rejection and roll the fixture change back.
ALTER TABLE public.payment_provider_operations DISABLE TRIGGER guard_payment_provider_admission;
update public.payment_provider_operations set authoritative_outcome_at=null where operation_kind='capture';
ALTER TABLE public.payment_provider_operations ENABLE TRIGGER guard_payment_provider_admission;
select throws_ok(format('select public.complete_booking_request_capture(%L,%L,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select lease_generation from public.booking_request_capture_work),
  (select lease_token from public.booking_request_capture_work),(select result from resolved_capture_result)),
  'RC409',null,'resolved unknown Capture cannot invent a missing authoritative success occurrence');
rollback to savepoint missing_capture_success_occurrence;
create temp table resolved_capture_completion as select public.complete_booking_request_capture('60000000-0000-4000-8000-000000001001',
  (select lease_generation from public.booking_request_capture_work),(select lease_token from public.booking_request_capture_work),
  (select result from resolved_capture_result)) result;
select is((select result->>'status' from resolved_capture_completion),'complete','current owner completes resolved unknown Capture success');
select is((select (result#>>'{snapshot,movements,1,recordedAt}')::timestamptz from resolved_capture_completion),
  (select authoritative_outcome_at from public.payment_provider_operations where operation_kind='capture'),'successful Capture movement uses authoritative success occurrence');
select is((select (result#>>'{expectation,captureRecordedAt}')::timestamptz from resolved_capture_completion),
  (select authoritative_outcome_at from public.payment_provider_operations where operation_kind='capture'),'Capture confirmation expectation preserves authoritative success occurrence');
select ok((select authoritative_outcome_at>executed_at and authoritative_outcome_at<>recorded_at
  and recorded_at='2025-01-01T00:00:00Z'::timestamptz from public.payment_provider_operations where operation_kind='capture'),
  'success occurrence is distinct from original unknown execution and query receipt clock');
select is(public.complete_booking_request_capture('60000000-0000-4000-8000-000000001001',null,null,null),
  (select result from resolved_capture_completion),'resolved unknown Capture completion replays its exact accepted snapshot');
rollback to savepoint indeterminate_capture_succeeded;

savepoint indeterminate_capture_failed;
create temp table unknown_capture_result as select pg_temp.capture_execute((select result->'permit' from capture_lease),'indeterminate') result;
select lives_ok($$select public.lock_booking_request_capture_source('60000000-0000-4000-8000-000000001001')$$,
  'recorded unknown Capture remains valid source evidence before failed resolution');
select is((select state from public.booking_request_capture_work),'processing','unknown Capture retains processing before failed resolution');
select is((select count(*) from public.booking_request_provider_operation_identities where operation_kind='capture'),0::bigint,'unknown Capture creates no business identity before failed resolution');
update public.booking_request_capture_work set lease_expires_at=clock_timestamp()-interval '1 second';
create temp table unknown_capture_recovery as select public.claim_due_booking_request_captures(20,(select result#>'{permit,providerIdentity}' from capture_lease)) result;
select ok((select result#>'{0,lease,providerResult}' ? 'movementReference' is false from unknown_capture_recovery),
  'unresolved Capture inquiry excludes provisional movement before failed resolution');
select throws_ok($$select public.complete_booking_request_capture('60000000-0000-4000-8000-000000001001',null,null,null)$$,
  'RC409',null,'unknown Capture grants no successful receipt before failed resolution');
create temp table resolved_capture_result as select pg_temp.payment_query((select jsonb_build_object('providerIdentity',result#>'{permit,providerIdentity}',
  'requestFingerprint',result#>'{permit,requestFingerprint}','paymentLifecycleId',result#>'{permit,paymentLifecycleId}',
  'logicalOperationId',result#>'{permit,captureLogicalOperationId}','physicalAttemptId',result#>'{permit,capturePhysicalAttemptId}',
  'operationKind','capture','amountFils',result#>'{permit,amountFils}','currency','IQD') from capture_lease),
  (select result->>'providerRequestId' from unknown_capture_result),(select result->>'providerReference' from unknown_capture_result),'failed') result;
select is((select original_outcome||':'||current_outcome from public.payment_provider_operations where operation_kind='capture'),'indeterminate:failed',
  'Capture failed resolution preserves immutable original unknown outcome');
select is((select physical_execution_count::integer from public.simulated_payment_effects),1,'Capture failed resolution retains one physical execution');
select is((select count(*) from public.payment_provider_observations),2::bigint,'Capture failed resolution appends one accepted observation');
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result#>>'{permit,leaseToken}' from capture_lease),(select result from resolved_capture_result)),
  'RC409',null,'original superseded Capture owner cannot record failure after failed resolution');
create temp table resolved_capture_failure as select public.record_booking_request_capture_failure('60000000-0000-4000-8000-000000001001',
  (select lease_generation from public.booking_request_capture_work),(select lease_token from public.booking_request_capture_work),
  (select result from resolved_capture_result)) result;
select is((select result->>'status' from resolved_capture_failure),'payment-required','current owner records definitive failure after original unknown Capture');
select is(public.record_booking_request_capture_failure('60000000-0000-4000-8000-000000001001',
  (select lease_generation from public.booking_request_capture_work),(select lease_token from public.booking_request_capture_work),
  (select result from resolved_capture_result)),(select result from resolved_capture_failure),'resolved unknown Capture failure replays one fixed window');
create function pg_temp.unknown_capture_expiry_now() returns timestamptz language sql as $$select payment_required_deadline from public.booking_request_capture_work$$;
do $$begin execute replace(pg_get_functiondef('public.prepare_booking_request_payment_required_expiry(uuid,jsonb)'::regprocedure),
  'clock_timestamp()','pg_temp.unknown_capture_expiry_now()');end$$;
grant select on capture_lease to service_role;
set local role service_role;
select is(public.prepare_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001',
  (select result#>'{permit,providerIdentity}' from capture_lease))->>'status','release','resolved unknown Capture failure remains safely eligible for expiry release');
reset role;
rollback to savepoint indeterminate_capture_failed;

savepoint regressed_receipt_clock;
-- Isolate receipt-clock regression through the column default; execution and
-- provider occurrence retain the actual effect clock throughout this observer.
alter table public.payment_provider_observations alter column received_at set default '2026-01-01T00:00:00Z'::timestamptz;
create temp table initial_unknown_observation as select pg_temp.capture_execute((select result->'permit' from capture_lease),'indeterminate') result;
alter table public.payment_provider_observations alter column received_at set default '2025-01-01T00:00:00Z'::timestamptz;
select is(pg_temp.capture_query((select jsonb_build_object('providerIdentity',result#>'{permit,providerIdentity}',
  'requestFingerprint',result#>'{permit,requestFingerprint}','paymentLifecycleId',result#>'{permit,paymentLifecycleId}',
  'logicalOperationId',result#>'{permit,captureLogicalOperationId}','physicalAttemptId',result#>'{permit,capturePhysicalAttemptId}',
  'operationKind','capture','amountFils',result#>'{permit,amountFils}','currency','IQD') from capture_lease),null,null)->>'outcome',
  'succeeded','accepted terminal result survives a backwards recording clock');
select ok((select original_outcome='indeterminate' and current_outcome='succeeded' and executed_at<=authoritative_outcome_at
  and recorded_at='2025-01-01T00:00:00Z'::timestamptz from public.payment_provider_operations where operation_kind='capture'),
  'resolution preserves original execution and authoritative occurrence independently of receipt ordering');
select is((select physical_execution_count::integer from public.simulated_payment_effects),1,'receipt clock regression never repeats the provider effect');
rollback to savepoint regressed_receipt_clock;

savepoint payment_required_capture;
create temp table failed_capture_result as select pg_temp.capture_execute(
  (select result -> 'permit' from capture_lease), 'failed'
) as result;
select is((select result from failed_capture_result), jsonb_build_object(
  'outcome','failed','providerRequestId',(select provider_request_id from public.payment_provider_operations where operation_kind='capture'),
  'providerReference',(select provider_reference from public.payment_provider_operations where operation_kind='capture'),'retrySafe',false
), 'selected definitive failure returns movement-free provider evidence');
select throws_ok($$delete from public.payment_provider_operations where operation_kind='capture'$$,'RC409',null,'accepted Capture evidence cannot be deleted');
select is(pg_temp.capture_execute((select result -> 'permit' from capture_lease), 'succeeded'),
  (select result from failed_capture_result), 'provider replay cannot rewrite the first failed outcome');
select is((select (select effects.physical_execution_count from public.simulated_payment_effects effects where effects.operation_id=payment_provider_operations.id)::integer from public.payment_provider_operations where operation_kind='capture'), 1,
  'failed Capture has exactly one physical execution');

savepoint failed_success_completion;
select throws_ok(format('select public.complete_booking_request_capture(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  (select (result - 'retrySafe') || '{"outcome":"succeeded","movementReference":null}'::jsonb from failed_capture_result)),
  'RC409', 'Booking Request successful Capture evidence is invalid',
  'success completion explicitly rejects authoritative failed Capture before constructing a paid snapshot');
rollback to savepoint failed_success_completion;

savepoint replaced_failure_permit;
-- Deliberately corrupt superuser fixture evidence to exercise the completion boundary.
ALTER TABLE public.payment_provider_operations DISABLE TRIGGER guard_payment_provider_admission;
update public.payment_provider_operations set capture_execution_permit =
  capture_execution_permit || jsonb_build_object('notAfter', '2099-01-01T00:00:00.000Z') where operation_kind='capture';
ALTER TABLE public.payment_provider_operations ENABLE TRIGGER guard_payment_provider_admission;
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  (select result from failed_capture_result)), 'RC409', null,
  'direct failure completion requires the exact original execution deadline');
rollback to savepoint replaced_failure_permit;

select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  (select result || replacement from failed_capture_result)), 'RC409', null,
  'failure finalization rejects ' || label)
from (values
  ('pending response', '{"outcome":"pending"}'::jsonb),
  ('indeterminate response', '{"outcome":"indeterminate"}'::jsonb),
  ('substituted provider identity', '{"providerReference":"substituted"}'::jsonb),
  ('conflicting movement', '{"movementReference":"unexpected-movement"}'::jsonb),
  ('retry authority', '{"retrySafe":true}'::jsonb)
) mutations(label,replacement);



savepoint indeterminate_failure_ledger;
-- Deliberately corrupt superuser fixture evidence to exercise the completion boundary.
ALTER TABLE public.payment_provider_operations DISABLE TRIGGER guard_payment_provider_admission;
update public.payment_provider_operations set original_outcome='indeterminate',current_outcome='indeterminate',movement_reference='unknown-capture-movement',authoritative_outcome_at=null where operation_kind='capture';
ALTER TABLE public.payment_provider_operations ENABLE TRIGGER guard_payment_provider_admission;
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  (select result from failed_capture_result)), 'RC409', null, 'indeterminate provider evidence cannot open Payment Required');
select is((select state from public.booking_request_capture_work), 'processing', 'indeterminate evidence remains capture processing');
rollback to savepoint indeterminate_failure_ledger;

savepoint late_failure_ledger;
-- Deliberately corrupt superuser fixture evidence to exercise the completion boundary.
ALTER TABLE public.payment_provider_operations DISABLE TRIGGER guard_payment_provider_admission;
update public.payment_provider_operations set executed_at=(capture_execution_permit->>'notAfter')::timestamptz where operation_kind='capture';
ALTER TABLE public.payment_provider_operations ENABLE TRIGGER guard_payment_provider_admission;
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  (select result from failed_capture_result)), 'RC409', null, 'failed execution at its original deadline cannot open Payment Required');
rollback to savepoint late_failure_ledger;

savepoint preauthorization_failure_ledger;
-- Deliberately corrupt superuser fixture evidence to exercise the completion boundary.
ALTER TABLE public.payment_provider_operations DISABLE TRIGGER guard_payment_provider_admission;
update public.payment_provider_operations set executed_at='2020-01-01T00:00:00Z' where operation_kind='capture';
ALTER TABLE public.payment_provider_operations ENABLE TRIGGER guard_payment_provider_admission;
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  (select result from failed_capture_result)), 'RC409', null, 'failed execution before Authorization cannot open Payment Required');
rollback to savepoint preauthorization_failure_ledger;

savepoint expired_failure_fence;
update public.booking_request_capture_work set lease_expires_at=clock_timestamp();
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  (select result from failed_capture_result)), 'RC409', null, 'expired direct failure ownership cannot open Payment Required');
rollback to savepoint expired_failure_fence;
select is((select count(*) from public.booking_request_status_notifications), 0::bigint, 'refused failure evidence emits no recovery notification');

savepoint missing_failure_occupancy;
delete from public.booking_request_authorization_claim_occupancies
where claim_id='72000000-0000-4000-8000-000000001001';
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  (select result from failed_capture_result)), 'RC409', null,
  'failure finalization rejects a changed retained occupancy set');
rollback to savepoint missing_failure_occupancy;

savepoint failure_bundle_hold;

savepoint failure_missing_bundle_component;
delete from public.booking_request_authorization_claim_occupancies where shift_id='32000000-0000-4000-8000-000000001002';
delete from public.cottage_booking_period_occupancies where shift_id='32000000-0000-4000-8000-000000001002';
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  (select result from failed_capture_result)), 'RC409', null,
  'failure rejects the same missing Full-Day Bundle component in both occupancy sets');
select ok((select state='processing' and payment_required_recorded_at is null and payment_required_deadline is null
  from public.booking_request_capture_work) and not exists(select 1 from public.booking_request_status_notifications),
  'missing bundle component leaves no Payment Required window or notification');
rollback to savepoint failure_missing_bundle_component;

savepoint failure_unselected_occupancy;
insert into public.booking_request_authorization_claim_occupancies(claim_id,schedule_revision_id,shift_id,service_day,active)
values ('72000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001',
  '32000000-0000-4000-8000-000000001001','2101-01-02',false);
insert into public.cottage_booking_period_occupancies(booking_period_commitment_id,schedule_revision_id,shift_id,service_day,active)
values ('50000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001',
  '32000000-0000-4000-8000-000000001001','2101-01-02',true);
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  (select result from failed_capture_result)), 'RC409', null,
  'failure rejects an unselected occupancy present in both sets');
select ok((select state='processing' and payment_required_recorded_at is null and payment_required_deadline is null
  from public.booking_request_capture_work) and not exists(select 1 from public.booking_request_status_notifications),
  'unselected occupancy leaves no Payment Required window or notification');
rollback to savepoint failure_unselected_occupancy;

savepoint failure_empty_hold;
delete from public.booking_request_authorization_claim_items;
delete from public.cottage_inventory_commitments;
delete from public.booking_request_authorization_claim_occupancies;
delete from public.cottage_booking_period_occupancies;
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  (select result from failed_capture_result)), 'RC409', null,
  'failure rejects empty selected-item and occupancy evidence');
select ok((select state='processing' and payment_required_recorded_at is null and payment_required_deadline is null
  from public.booking_request_capture_work) and not exists(select 1 from public.booking_request_status_notifications),
  'empty hold leaves no Payment Required window or notification');
rollback to savepoint failure_empty_hold;

select is(public.record_booking_request_capture_failure('60000000-0000-4000-8000-000000001001',1,
  (select (result #>> '{permit,leaseToken}')::uuid from capture_lease),
  (select result from failed_capture_result))->>'status','payment-required', 'complete Full-Day Bundle failure opens Payment Required');
select results_eq($$select shift_id,service_day from public.cottage_booking_period_occupancies where active order by shift_id$$,
  $$values ('32000000-0000-4000-8000-000000001001'::uuid,'2101-01-01'::date),
    ('32000000-0000-4000-8000-000000001002'::uuid,'2101-01-01'::date)$$,
  'complete failed bundle retains exactly every selected component');
rollback to savepoint failure_bundle_hold;

create function pg_temp.fail_payment_required_notification() returns trigger language plpgsql as $$begin raise exception 'forced notification failure' using errcode='RC499'; end;$$;
create trigger fail_payment_required_notification before insert on public.booking_request_status_notifications
for each row when (new.status='payment-required') execute function pg_temp.fail_payment_required_notification();
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  (select result from failed_capture_result)), 'RC499', null, 'notification failure aborts Payment Required atomically');
select is((select state from public.booking_request_capture_work), 'processing', 'failed notification leaves capture processing');
select is((select count(*) from public.booking_request_status_notifications), 0::bigint, 'failed transaction leaves no recovery notification');
drop trigger fail_payment_required_notification on public.booking_request_status_notifications;

create temp table failure_recording_boundary as select date_trunc('milliseconds',clock_timestamp()) started_at;
create temp table payment_required_result as select public.record_booking_request_capture_failure(
  '60000000-0000-4000-8000-000000001001', 1,
  (select (result #>> '{permit,leaseToken}')::uuid from capture_lease),
  (select result from failed_capture_result)
) as result;
select is((select result ->> 'status' from payment_required_result), 'payment-required', 'definitive failed Capture opens Payment Required');
select is((select extract(epoch from payment_required_deadline-payment_required_recorded_at)::integer from public.booking_request_capture_work),
  1200, 'Payment Required deadline is exactly 1,200 seconds');
select is((select completed_at from public.booking_request_capture_work),
  (select payment_required_recorded_at from public.booking_request_capture_work), 'durable Customer-action and completion times are one clock reading');
select ok((select payment_required_recorded_at >= started_at from public.booking_request_capture_work cross join failure_recording_boundary),
  'Customer-action time comes from failure recording rather than transaction start or prior evidence');
select is((select count(*) from public.booking_request_status_notifications where status='payment-required'
  and recipient_user_id='10000000-0000-4000-8000-000000001002'), 1::bigint, 'Customer receives one Payment Required notification');
savepoint payment_required_projection;
insert into public.owner_request_notifications(booking_request_id,owner_user_id)
values ('60000000-0000-4000-8000-000000001001','10000000-0000-4000-8000-000000001001');
insert into auth.users(id,aud,role,phone,phone_confirmed_at) values
  ('10000000-0000-4000-8000-000000001003','authenticated','authenticated','+9647500001003',now()),
  ('10000000-0000-4000-8000-000000001004','authenticated','authenticated','+9647500001004',now());
insert into public.account_contexts(user_id,role,owner_approval_state) values
  ('10000000-0000-4000-8000-000000001003','customer',null),
  ('10000000-0000-4000-8000-000000001004','cottage_owner','approved');
grant select on payment_required_result to authenticated;
set local role authenticated;
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000001002';
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->>'paymentStatus','payment-required',
  'authenticated Customer sees Payment Required');
select is((public.get_customer_booking_request('RC-REQ-0000000000001001')->'paymentRequiredWindow')-'databaseNow',
  (select result->'paymentRequiredWindow' from payment_required_result), 'Customer projection preserves the original recorded window');
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')#>'{statusNotifications,0,status}',
  '"payment-required"'::jsonb, 'Customer projection includes the Payment Required notification');
select ok(not (public.get_customer_booking_request('RC-REQ-0000000000001001') ?|
  array['paymentSnapshot','provider','exactAddress','phone','accessDetails']), 'Customer Payment Required projection excludes private evidence and access details');
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000001001';
select is(public.list_owner_booking_request_notifications()#>>'{0,paymentStatus}','payment-required',
  'approved owning Owner sees Payment Required');
select is(public.list_owner_booking_request_notifications()#>'{0,statusNotifications}','[]'::jsonb,
  'Owner projection does not expose the Customer payment notification');
select ok(not ((public.list_owner_booking_request_notifications()->0) ?|
  array['paymentSnapshot','provider','exactAddress','phone','accessDetails']), 'Owner Payment Required projection excludes private evidence and access details');
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000001003';
select is(public.get_customer_booking_request('RC-REQ-0000000000001001'),null::jsonb,
  'unrelated Customer cannot read Payment Required or its notification');
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000001004';
select is(public.list_owner_booking_request_notifications(),'[]'::jsonb,
  'unrelated approved Owner cannot read Payment Required or its notification');
reset role;
rollback to savepoint payment_required_projection;
select is(public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001',
  (select result #> '{permit,providerIdentity}' from capture_lease)), (select result from payment_required_result),
  'terminal work replays the original window without another Capture');
select is((select count(*) from public.booking_confirmations), 0::bigint, 'Payment Required creates no Confirmed Booking');
select is((select status from public.cottage_booking_period_commitments), 'pending_hold', 'Payment Required retains the Pending Hold');
select ok((select bool_and(active) from public.cottage_booking_period_occupancies), 'Payment Required retains every selected occupancy');
select ok((select intent_dedupe_active from public.booking_request_submission_attempts), 'Payment Required retains the active Booking Request intent');
select is((select jsonb_array_length(payment_snapshot -> 'movements') from public.booking_request_submission_attempts), 1,
  'Payment Required adds no Capture money movement');
select is((select count(*) from public.booking_request_provider_operation_identities where operation_kind='capture'), 0::bigint,
  'Payment Required creates no successful Capture identity');
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  (select result || '{"providerReference":"replaced"}'::jsonb from failed_capture_result)), 'RC409', null,
  'changed failure evidence cannot replay or replace the window');
select is(public.record_booking_request_capture_failure(
  '60000000-0000-4000-8000-000000001001',1,
  (select (result #>> '{permit,leaseToken}')::uuid from capture_lease),(select result from failed_capture_result)),
  (select result from payment_required_result), 'exact failure replay returns the original durable window');
select throws_ok(format('update public.booking_request_capture_work set %s', mutation), 'RC204', null,
  'terminal failure cannot ' || label)
from (values
  ('extend the deadline', 'payment_required_deadline=payment_required_deadline+interval ''1 minute'''),
  ('replace the period', 'payment_required_recorded_at=payment_required_recorded_at+interval ''1 minute'',payment_required_deadline=payment_required_deadline+interval ''1 minute'',completed_at=completed_at+interval ''1 minute'''),
  ('clear the deadline', 'payment_required_deadline=null'),
  ('requeue capture', 'state=''queued''')
) mutations(label,mutation);
select is(public.claim_due_booking_request_captures(20,(select result #> '{permit,providerIdentity}' from capture_lease)),
  '[]'::jsonb, 'terminal failure is never scheduled for another Capture');
select is((select count(*) from public.booking_request_status_notifications where status='payment-required'),1::bigint,
  'replay and scheduling retain exactly one recovery notification');
select is((select count(*) from public.booking_receipts),0::bigint, 'Payment Required never creates paid receipts');
savepoint conflicting_terminal_failure;
-- Deliberately corrupt superuser fixture evidence to exercise the completion boundary.
ALTER TABLE public.payment_provider_operations DISABLE TRIGGER guard_payment_provider_admission;
update public.payment_provider_operations set original_outcome='succeeded',current_outcome='succeeded',movement_reference='conflicting-capture-movement' where operation_kind='capture';
ALTER TABLE public.payment_provider_operations ENABLE TRIGGER guard_payment_provider_admission;
select throws_ok(format('select public.record_booking_request_capture_failure(%L,1,%L,%L)',
  '60000000-0000-4000-8000-000000001001',(select result #>> '{permit,leaseToken}' from capture_lease),
  (select result from failed_capture_result)), 'RC409', null, 'terminal replay still rejects conflicting provider money movement');
rollback to savepoint conflicting_terminal_failure;
rollback to savepoint payment_required_capture;

create temp table capture_result as select pg_temp.capture_execute((select result -> 'permit' from capture_lease)) as result;
select is((select result ->> 'outcome' from capture_result), 'succeeded', 'the durable simulator has one fixed successful outcome');
select is((select capture_execution_permit from public.payment_provider_operations where operation_kind = 'capture'), (select result -> 'permit' from capture_lease), 'the provider ledger retains the exact durable admission permit');
select is((select count(*) from public.payment_provider_operations where operation_kind = 'capture'), 1::bigint, 'one capture has one physical provider row');

select is(pg_temp.capture_execute((select result -> 'permit' from capture_lease)), (select result from capture_result), 'exact provider replay returns byte-equivalent evidence');
select is((select (select effects.physical_execution_count from public.simulated_payment_effects effects where effects.operation_id=payment_provider_operations.id)::integer from public.payment_provider_operations where operation_kind = 'capture'), 1, 'provider replay retains one physical execution');
select throws_ok(format('update public.payment_provider_operations set capture_execution_permit = %L where operation_kind = %L', replacement, 'capture'), 'RC409', null, 'capture admission is immutable against malformed permit ' || label)
from (values ('null', 'null'::jsonb), ('array', '[]'::jsonb), ('missing purpose', '{}'::jsonb), ('null purpose', '{"purpose":null}'::jsonb), ('incomplete shape', '{"purpose":"booking-request-capture"}'::jsonb)) mutations(label, replacement);
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), (select result || '{"movementReference":"forged"}'::jsonb from capture_result)), 'RC409', null, 'completion verifies supplied success against authoritative ledger identity');


savepoint late_completion;
update public.booking_request_capture_work set lease_expires_at = '2026-02-01T12:00:30.000Z' where booking_request_id = '60000000-0000-4000-8000-000000001001';
-- Deliberately corrupt superuser fixture evidence to exercise the completion boundary.
ALTER TABLE public.payment_provider_operations DISABLE TRIGGER guard_payment_provider_admission;
update public.payment_provider_operations set executed_at = '2026-02-01T12:00:00.000Z', capture_execution_permit = capture_execution_permit || '{"notAfter":"2026-02-01T12:00:30.000Z"}' where operation_kind = 'capture';
ALTER TABLE public.payment_provider_operations ENABLE TRIGGER guard_payment_provider_admission;
select is(public.complete_booking_request_capture('60000000-0000-4000-8000-000000001001', 1, (select (result #>> '{permit,leaseToken}')::uuid from capture_lease), (select result from capture_result)) #>> '{snapshot,movements,1,recordedAt}', '2026-02-01T12:00:00.000000Z', 'late completion accepts proven pre-expiry execution and preserves occurrence time');
rollback to savepoint late_completion;

savepoint exact_expiry;
update public.booking_request_capture_work set lease_expires_at = '2026-02-01T12:00:30.000Z' where booking_request_id = '60000000-0000-4000-8000-000000001001';
-- Deliberately corrupt superuser fixture evidence to exercise the completion boundary.
ALTER TABLE public.payment_provider_operations DISABLE TRIGGER guard_payment_provider_admission;
update public.payment_provider_operations set executed_at = '2026-02-01T12:00:30.000Z', capture_execution_permit = capture_execution_permit || '{"notAfter":"2026-02-01T12:00:30.000Z"}' where operation_kind = 'capture';
ALTER TABLE public.payment_provider_operations ENABLE TRIGGER guard_payment_provider_admission;
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), (select result from capture_result)), 'RC409', null, 'provider occurrence exactly at expiry is rejected');
-- Deliberately corrupt superuser fixture evidence to exercise the completion boundary.
ALTER TABLE public.payment_provider_operations DISABLE TRIGGER guard_payment_provider_admission;
update public.payment_provider_operations set executed_at = '2026-02-01T12:00:30.000001Z' where operation_kind = 'capture';
ALTER TABLE public.payment_provider_operations ENABLE TRIGGER guard_payment_provider_admission;
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), (select result from capture_result)), 'RC409', null, 'provider occurrence after expiry is rejected');
select is((select count(*) from public.booking_request_provider_operation_identities where operation_kind = 'capture'), 0::bigint, 'expired evidence leaves no normalized Capture');
select is((select state from public.booking_request_capture_work where booking_request_id = '60000000-0000-4000-8000-000000001001'), 'processing', 'expired evidence leaves work incomplete');
rollback to savepoint exact_expiry;
create temp table capture_query as select jsonb_build_object(
  'providerIdentity', result #> '{permit,providerIdentity}', 'requestFingerprint', result #> '{permit,requestFingerprint}',
  'paymentLifecycleId', result #> '{permit,paymentLifecycleId}', 'logicalOperationId', result #> '{permit,captureLogicalOperationId}',
  'physicalAttemptId', result #> '{permit,capturePhysicalAttemptId}', 'operationKind', 'capture',
  'amountFils', result #> '{permit,amountFils}', 'currency', 'IQD') operation from capture_lease;
select is(pg_temp.capture_query((select operation from capture_query), (select result ->> 'providerRequestId' from capture_result), (select result ->> 'providerReference' from capture_result)), (select result from capture_result), 'query returns the original capture result');
select throws_ok(format('select pg_temp.capture_query(%L, %L, %L)', (select operation from capture_query), 'replaced-request', (select result ->> 'providerReference' from capture_result)), 'RC409', null, 'query refuses a replaced provider request');
select throws_ok(format('select pg_temp.capture_query(%L, %L, %L)', (select operation from capture_query), (select result ->> 'providerRequestId' from capture_result), 'replaced-reference'), 'RC409', null, 'query refuses a replaced provider reference');
select throws_ok(format('select pg_temp.capture_query(%L, %L, %L)', (select operation from capture_query) || replacement, (select result ->> 'providerRequestId' from capture_result), (select result ->> 'providerReference' from capture_result)), 'RC409', null, 'query validates ' || label)
from (values ('lifecycle', '{"paymentLifecycleId":"73000000-0000-4000-8000-000000009999"}'::jsonb),
('operation','{"logicalOperationId":"replaced"}'::jsonb), ('attempt','{"physicalAttemptId":"replaced"}'::jsonb),
('kind','{"operationKind":"release"}'::jsonb), ('amount','{"amountFils":1}'::jsonb), ('currency','{"currency":"USD"}'::jsonb),
('fingerprint','{"requestFingerprint":"replaced"}'::jsonb), ('provider','{"providerIdentity":{}}'::jsonb), ('extra fields','{"unexpected":true}'::jsonb)) mutations(label,replacement);

savepoint invalid_query_generation;
-- Deliberately corrupt superuser fixture evidence to exercise the completion boundary.
ALTER TABLE public.payment_provider_operations DISABLE TRIGGER guard_payment_provider_admission;
update public.payment_provider_operations set capture_execution_permit =
  capture_execution_permit || '{"leaseGeneration":0}'::jsonb where operation_kind='capture';
ALTER TABLE public.payment_provider_operations ENABLE TRIGGER guard_payment_provider_admission;
select throws_ok(format('select pg_temp.capture_query(%L,%L,%L)',
  (select operation from capture_query),(select result ->> 'providerRequestId' from capture_result),
  (select result ->> 'providerReference' from capture_result)), 'RC409', null,
  'query rejects an original execution permit with no admitted generation');
rollback to savepoint invalid_query_generation;



savepoint recovery;
update public.booking_request_capture_work set lease_expires_at = '2026-02-01T00:00:00Z' where booking_request_id = '60000000-0000-4000-8000-000000001001';
savepoint invalid_historical_execution;
-- Deliberately corrupt superuser fixture evidence to exercise the completion boundary.
ALTER TABLE public.payment_provider_operations DISABLE TRIGGER guard_payment_provider_admission;
update public.payment_provider_operations set executed_at = (capture_execution_permit ->> 'notAfter')::timestamptz where operation_kind = 'capture';
ALTER TABLE public.payment_provider_operations ENABLE TRIGGER guard_payment_provider_admission;
select throws_ok(format('select public.claim_due_booking_request_captures(20, %L)', (select result #> '{permit,providerIdentity}' from capture_lease)), 'RC409', null, 'reclaim cannot legitimize capture at the original admission deadline');
rollback to savepoint invalid_historical_execution;
create temp table recovered as select public.claim_due_booking_request_captures(20, (select result #> '{permit,providerIdentity}' from capture_lease)) result;
select is((select result #>> '{0,status}' from recovered), 'reconcile', 'expired successful Capture is reclaimed for reconciliation');
select is((select lease_generation from public.booking_request_capture_work), 2::bigint, 'recovery advances the ownership generation');
select isnt((select lease_token::text from public.booking_request_capture_work), (select result #>> '{permit,leaseToken}' from capture_lease), 'recovery replaces the ownership token');
select is((select capture_execution_permit from public.payment_provider_operations where operation_kind = 'capture'), (select result -> 'permit' from capture_lease), 'reclaim preserves the original execution permit exactly');
select is((select recovery_operation_id from public.booking_request_capture_work), (select id from public.payment_provider_operations where operation_kind = 'capture'), 'recovery records the original physical operation');
select ok(not (select result #> '{0,lease}' ? 'purpose' from recovered), 'recovery lease carries no execution permit purpose');
select is(public.claim_due_booking_request_captures(20, (select result #> '{permit,providerIdentity}' from capture_lease)), '[]'::jsonb, 'an active recovery lease is excluded from another drain');
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), (select result from capture_result)), 'RC409', null, 'the original executor cannot complete reclaimed work');
select throws_ok(format('select pg_temp.capture_execute(%L)', (select result -> 'permit' from capture_lease)), 'RC409', null, 'recovery cannot use the original permit to execute again');
select throws_ok(format('select pg_temp.capture_execute(%L)', (select result #> '{0,lease}' from recovered)), 'RC409', null, 'a recovery lease cannot authorize provider execution');
savepoint superseded_recovery;
update public.booking_request_capture_work set lease_expires_at = '2026-02-01T00:00:00Z';
select is(public.claim_due_booking_request_captures(20, (select result #> '{permit,providerIdentity}' from capture_lease)) #>> '{0,lease,leaseGeneration}', '3', 'an expired recovery owner can itself be reclaimed');
select throws_ok(format('select public.complete_booking_request_capture(%L, 2, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{0,lease,leaseToken}' from recovered), (select result from capture_result)), 'RC409', null, 'superseded recovery token cannot complete');
select is((select state from public.booking_request_capture_work), 'processing', 'superseded completion cannot persist capture');
rollback to savepoint superseded_recovery;
select throws_ok(format('select public.complete_booking_request_capture(%L, 2, %L, %L)', '60000000-0000-4000-8000-000000001001', '80000000-0000-4000-8000-000000009999', (select result from capture_result)), 'RC409', null, 'the current recovery generation still requires its exact ownership token');
savepoint invalid_recovered_occurrence;
-- Deliberately corrupt superuser fixture evidence to exercise the completion boundary.
ALTER TABLE public.payment_provider_operations DISABLE TRIGGER guard_payment_provider_admission;
update public.payment_provider_operations set executed_at = (capture_execution_permit ->> 'notAfter')::timestamptz where operation_kind = 'capture';
ALTER TABLE public.payment_provider_operations ENABLE TRIGGER guard_payment_provider_admission;
select throws_ok(format('select public.complete_booking_request_capture(%L, 2, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{0,lease,leaseToken}' from recovered), (select result from capture_result)), 'RC409', null, 'completion independently checks the original execution deadline after recovery');
rollback to savepoint invalid_recovered_occurrence;
create temp table recovered_completion as select public.complete_booking_request_capture(
  '60000000-0000-4000-8000-000000001001', (select (result #>> '{0,lease,leaseGeneration}')::bigint from recovered),
  (select (result #>> '{0,lease,leaseToken}')::uuid from recovered), (select result from capture_result)) result;
select is((select result ->> 'status' from recovered_completion), 'complete', 'the current recovery owner completes original successful evidence');
select is(public.complete_booking_request_capture('60000000-0000-4000-8000-000000001001', null, null, null), (select result from recovered_completion), 'completed recovery has exact null-lease evidence replay');
select throws_ok(format('select public.complete_booking_request_capture(%L, 2, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{0,lease,leaseToken}' from recovered), (select result from capture_result)), 'RC409', null, 'completed recovery cannot replay a cleared historical recovery token');
select is(public.claim_due_booking_request_captures(20, (select result #> '{permit,providerIdentity}' from capture_lease)) #>> '{0,status}', 'complete', 'complete-but-unconfirmed evidence remains due without a new lease');
rollback to savepoint recovery;

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
-- Deliberately corrupt superuser fixture evidence to exercise the completion boundary.
ALTER TABLE public.payment_provider_operations DISABLE TRIGGER guard_payment_provider_admission;
update public.payment_provider_operations set amount_fils = 1 where operation_kind = 'capture';
ALTER TABLE public.payment_provider_operations ENABLE TRIGGER guard_payment_provider_admission;
select throws_ok(format('select public.complete_booking_request_capture(%L, 1, %L, %L)', '60000000-0000-4000-8000-000000001001', (select result #>> '{permit,leaseToken}' from capture_lease), (select result from capture_result)), 'RC409', null, 'completion rejects an authoritative ledger bound to the wrong amount');
rollback to savepoint altered_ledger;
savepoint altered_authorization;
update public.booking_request_submission_attempts set payment_snapshot = jsonb_set(payment_snapshot, '{authorization,providerReference}', '"wrong"') where id = '70000000-0000-4000-8000-000000001001';
select throws_ok(format('select pg_temp.capture_execute(%L)', (select result -> 'permit' from capture_lease)), 'RC409', null, 'provider revalidates Authorization on replay');
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
select is((select (result #>> '{snapshot,movements,1,recordedAt}')::timestamptz from capture_completion), (select executed_at from public.payment_provider_operations where operation_kind = 'capture'), 'Capture occurrence is provider ledger time rather than completion time');
select ok(not exists (select 1 from public.booking_request_status_notifications) and not exists (select 1 from public.owner_request_notifications) and not exists (select 1 from public.booking_request_release_work) and not exists (select 1 from public.booking_request_authorization_reconciliation_outbox), 'capture creates no notification, release or recovery work');
select is((select count(*) from public.payment_provider_operations where operation_kind = 'capture'), 1::bigint, 'completion replay retains exactly one physical capture');
select is((select jsonb_array_length(payment_snapshot -> 'movements') from public.booking_request_submission_attempts where id = '70000000-0000-4000-8000-000000001001'), 2, 'completion replay retains exactly one Capture movement');

select * from finish();
rollback;
