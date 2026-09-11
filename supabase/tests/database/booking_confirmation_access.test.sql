begin;
select plan(40);

select has_function(
  'public',
  'get_confirmed_booking_access',
  array['text'],
  'paid access is exposed through one private projection'
);
select ok(
  (
    select prosecdef and proconfig = array['search_path=""']
    from pg_proc
    where oid = 'public.get_confirmed_booking_access(text)'::regprocedure
  ),
  'paid access projection is security-definer with an empty search path'
);
select ok(
  has_function_privilege('authenticated', 'public.list_confirmed_booking_history()', 'execute')
    and not has_function_privilege('anon', 'public.list_confirmed_booking_history()', 'execute'),
  'only authenticated actors can list their minimal paid Booking History'
);
select ok(
  has_function_privilege('authenticated', 'public.get_confirmed_booking_access(text)', 'execute')
    and not has_function_privilege('anon', 'public.get_confirmed_booking_access(text)', 'execute')
    and not has_function_privilege('service_role', 'public.get_confirmed_booking_access(text)', 'execute'),
  'only authenticated participants can call the private projection'
);

-- Build only the already-confirmed graph this projection consumes. The existing
-- confirmation test owns the full transition, foreign-key, trigger and replay proof.
set session_replication_role = replica;
insert into auth.users (id, aud, role, phone, phone_confirmed_at) values
  ('10000000-0000-4000-8000-000000003501', 'authenticated', 'authenticated', '9647500003501', now()),
  ('10000000-0000-4000-8000-000000003502', 'authenticated', 'authenticated', '9647500003502', now()),
  ('10000000-0000-4000-8000-000000003503', 'authenticated', 'authenticated', '+9647500003503', now());
insert into public.account_contexts (user_id, role, owner_approval_state) values
  ('10000000-0000-4000-8000-000000003501', 'cottage_owner', 'approved'),
  ('10000000-0000-4000-8000-000000003502', 'customer', null),
  ('10000000-0000-4000-8000-000000003503', 'customer', null);
insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  exact_latitude, exact_longitude, private_directions, capacity, bedrooms,
  bathrooms, amenities, source_language, description, house_rules, status
) values (
  '20000000-0000-4000-8000-000000003501',
  '10000000-0000-4000-8000-000000003501',
  'Changed current Cottage name', 'Baghdad', 'Karrada', 'Current private address',
  33.315241, 44.366067, 'Current private directions', 8, 3, 2,
  array['garden'], 'en', 'Current description', 'Changed current rules', 'draft'
);
insert into public.booking_snapshots (
  id, customer_user_id, profile_id, quote_fingerprint, intent_fingerprint,
  quote_payload, intent_payload, booking_terms_version, booking_terms_locale,
  booking_terms_body, booking_terms_sha256, cancellation_policy_version,
  acceptance_locale, acceptance_evidence, acceptance_evidence_fingerprint,
  marketplace_commission_rate_basis_points, marketplace_commission_amount_fils,
  created_at
) values (
  '40000000-0000-4000-8000-000000003501',
  '10000000-0000-4000-8000-000000003502',
  '20000000-0000-4000-8000-000000003501', repeat('a', 64), repeat('b', 64),
  '{"cottageName":"Preserved Cottage name","houseRules":"Preserved House Rules","bookingPriceIqd":110000,"serviceFeeIqd":5000,"customerTotalIqd":115000,"items":[{"serviceDay":"2101-01-01","displayName":"Morning","startsAt":"2101-01-01T08:00:00+03:00","endsAt":"2101-01-01T12:00:00+03:00","crossesMidnight":false,"priceIqd":110000,"kind":"shift","position":1}]}'::jsonb,
  '{"customerName":"Fictional Customer","partySize":4}'::jsonb,
  'confirmation-access-v1', 'en', 'Fictional terms', repeat('c', 64),
  'fictional-cancellation-v1', 'en', '{}'::jsonb, repeat('d', 64),
  1000, 11000000, '2100-12-31 12:00+00'
);
insert into public.cottage_booking_period_commitments (
  id, customer_user_id, profile_id, schedule_revision_id, commitment_reference,
  status, access_ranges, created_at
) values (
  '50000000-0000-4000-8000-000000003501',
  '10000000-0000-4000-8000-000000003502',
  '20000000-0000-4000-8000-000000003501',
  '30000000-0000-4000-8000-000000003501', 'CONFIRMED-BOOKING-35',
  'confirmed_booking', '{["2101-01-01 05:00+00","2101-01-01 09:00+00")}'::tstzmultirange,
  '2100-12-31 12:00+00'
);
insert into public.booking_requests (
  id, booking_request_reference, customer_user_id, owner_user_id, profile_id,
  booking_snapshot_id, booking_period_commitment_id, payment_lifecycle_id,
  customer_name, party_size, status, response_deadline, created_at, settled_at
) values (
  '60000000-0000-4000-8000-000000003501', 'RC-REQ-0000000000003501',
  '10000000-0000-4000-8000-000000003502',
  '10000000-0000-4000-8000-000000003501',
  '20000000-0000-4000-8000-000000003501',
  '40000000-0000-4000-8000-000000003501',
  '50000000-0000-4000-8000-000000003501',
  '73000000-0000-4000-8000-000000003501', 'Fictional Customer', 4,
  'accepted', '2100-12-31 16:00+00', '2100-12-31 12:00+00', '2100-12-31 13:00+00'
);
insert into public.booking_request_capture_work (
  booking_request_id, attempt_id, authorization_claim_id,
  authorization_claim_generation, payment_lifecycle_id,
  authorization_logical_operation_id, authorization_physical_attempt_id,
  capture_logical_operation_id, capture_physical_attempt_id, amount_fils,
  currency, provider, environment, merchant_id, terminal_id,
  provider_idempotency_key, request_fingerprint, state, lease_generation,
  outcome, completed_at
) values (
  '60000000-0000-4000-8000-000000003501',
  '70000000-0000-4000-8000-000000003501',
  '72000000-0000-4000-8000-000000003501', 1,
  '73000000-0000-4000-8000-000000003501',
  '73000000-0000-4000-8000-000000003501:authorization',
  '73000000-0000-4000-8000-000000003501:authorization:attempt-1',
  '73000000-0000-4000-8000-000000003501:capture',
  '73000000-0000-4000-8000-000000003501:capture:attempt-2',
  115000000, 'IQD', 'fictional-payments', 'local-test', 'fictional-merchant',
  'fictional-terminal', 'booking-request-capture:35', repeat('e', 64),
  'complete', 1, 'succeeded', '2100-12-31 13:00+00'
);
insert into public.booking_confirmations (
  id, booking_request_id, booking_snapshot_id, booking_period_commitment_id,
  capture_operation_id, confirmed_at
) values (
  '80000000-0000-4000-8000-000000003501',
  '60000000-0000-4000-8000-000000003501',
  '40000000-0000-4000-8000-000000003501',
  '50000000-0000-4000-8000-000000003501',
  '81000000-0000-4000-8000-000000003501', '2100-12-31 13:00+00'
);
insert into public.booking_receipts (
  id, booking_confirmation_id, booking_snapshot_id, recipient_role,
  recipient_user_id, created_at
) values
  ('82000000-0000-4000-8000-000000003501', '80000000-0000-4000-8000-000000003501', '40000000-0000-4000-8000-000000003501', 'cottage_owner', '10000000-0000-4000-8000-000000003501', '2100-12-31 13:00+00'),
  ('82000000-0000-4000-8000-000000003502', '80000000-0000-4000-8000-000000003501', '40000000-0000-4000-8000-000000003501', 'customer', '10000000-0000-4000-8000-000000003502', '2100-12-31 13:00+00');
set session_replication_role = origin;

set local role anon;
select throws_ok(
  $$select public.get_confirmed_booking_access('RC-REQ-0000000000003501')$$,
  '42501', null, 'anonymous callers cannot invoke the private projection'
);
reset role;
set local role service_role;
select throws_ok(
  $$select public.get_confirmed_booking_access('RC-REQ-0000000000003501')$$,
  '42501', null, 'service code cannot bypass participant authentication'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000003502', true);
set local role authenticated;
select is((public.claim_marketplace_role('cottage_owner')).user_id::text, '10000000-0000-4000-8000-000000003502', 'customer enrolls as owner without changing identity');
create temp table customer_access as
  select public.get_confirmed_booking_access('RC-REQ-0000000000003501') result;
select is((select count(*)::text from public.list_confirmed_booking_history()), '1', 'prospective owner retains their customer receipt');
reset role;
update public.account_contexts set owner_approval_state='suspended' where user_id='10000000-0000-4000-8000-000000003502';
set local role authenticated;
select is(public.get_confirmed_booking_access('RC-REQ-0000000000003501')->>'actorRole', 'customer', 'suspended owner keeps their customer participation');
select is((select count(*)::text from public.list_confirmed_booking_history()), '1', 'suspended owner keeps customer history');
select is(public.get_booking_confirmation_notification_status('82000000-0000-4000-8000-000000003502')->>'state', 'pending', 'suspended owner keeps customer notification status');
reset role;
update public.account_contexts set owner_approval_state='expired' where user_id='10000000-0000-4000-8000-000000003502';
set local role authenticated;
select is(public.get_confirmed_booking_access('RC-REQ-0000000000003501')->>'actorRole', 'customer', 'expired owner keeps their customer participation');
select is((select result->>'actorRole' from customer_access), 'customer', 'the actual Customer receives Customer access');
select is((select result->>'receiptId' from customer_access), '82000000-0000-4000-8000-000000003502', 'the Customer receives only their receipt identity');
select is((select result->>'bookingReference' from customer_access), 'CONFIRMED-BOOKING-35', 'the stable commitment reference is retained');
select is((select result->>'cottageName' from customer_access), 'Preserved Cottage name', 'commercial Cottage facts come from the immutable snapshot');
select is((select result->>'houseRules' from customer_access), 'Preserved House Rules', 'House Rules come from the immutable snapshot');
select is((select result->>'bookingTermsBody' from customer_access), 'Fictional terms', 'readable Booking Terms come from the immutable snapshot');
select is((select result#>>'{pricing,customerTotalIqd}' from customer_access), '115000', 'the Customer receives preserved Customer pricing');
select ok(not ((select result from customer_access)->'pricing' ? 'ownerNetFils'), 'the Customer does not receive Cottage Owner commercial data');
select is((select result->>'exactAddress' from customer_access), 'Current private address', 'private address comes from the current Cottage Profile');
select is((select result#>>'{mapPin,latitude}' from customer_access), '33.315241', 'current private map coordinates are released');
select is((select result->>'customerPhone' from customer_access), '+9647500003502', 'the verified Customer phone is released');
select is((select result->>'ownerPhone' from customer_access), '+9647500003501', 'the verified Cottage Owner phone is released');
select is(public.get_confirmed_booking_access('82000000-0000-4000-8000-000000003502'), null, 'receipt possession does not authorize access');
select is(public.get_booking_confirmation_notification_status('82000000-0000-4000-8000-000000003502')->>'state', 'pending', 'paid details remain available with truthful pending notice status before first drain');
select is((select count(*)::text from public.list_confirmed_booking_history()), '1', 'the Customer history contains only their paid receipt');
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000003501', true);
set local role authenticated;
select is(public.get_confirmed_booking_access('RC-REQ-0000000000003501')->>'actorRole', 'cottage_owner', 'the approved actual Cottage Owner receives Owner access');
select is(public.get_confirmed_booking_access('RC-REQ-0000000000003501')#>>'{pricing,ownerNetFils}', '99000000', 'the Cottage Owner receives preserved Owner pricing');
select ok(not (public.get_confirmed_booking_access('RC-REQ-0000000000003501')->'pricing' ? 'customerTotalIqd'), 'the Cottage Owner does not receive Customer fee data');
select is((select value->>'actorRole' from public.list_confirmed_booking_history() value), 'cottage_owner', 'the Cottage Owner history links through the Owner role');
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000003503', true);
set local role authenticated;
select is(public.get_confirmed_booking_access('RC-REQ-0000000000003501'), null, 'an authenticated non-participant receives no private facts');
select is((select count(*)::text from public.list_confirmed_booking_history()), '0', 'an authenticated non-participant has no paid history rows');
reset role;

set session_replication_role = replica;
delete from public.booking_receipts where booking_confirmation_id = '80000000-0000-4000-8000-000000003501';
delete from public.booking_confirmations where id = '80000000-0000-4000-8000-000000003501';
set session_replication_role = origin;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000003502', true);
set local role authenticated;
select is(public.get_confirmed_booking_access('RC-REQ-0000000000003501'), null, 'Owner acceptance without paid confirmation releases nothing');
reset role;
set session_replication_role = replica;
insert into public.booking_confirmations (
  id, booking_request_id, booking_snapshot_id, booking_period_commitment_id,
  capture_operation_id, confirmed_at
) values (
  '80000000-0000-4000-8000-000000003501',
  '60000000-0000-4000-8000-000000003501',
  '40000000-0000-4000-8000-000000003501',
  '50000000-0000-4000-8000-000000003501',
  '81000000-0000-4000-8000-000000003501', '2100-12-31 13:00+00'
);
insert into public.booking_receipts (
  id, booking_confirmation_id, booking_snapshot_id, recipient_role,
  recipient_user_id, created_at
) values
  ('82000000-0000-4000-8000-000000003501', '80000000-0000-4000-8000-000000003501', '40000000-0000-4000-8000-000000003501', 'cottage_owner', '10000000-0000-4000-8000-000000003501', '2100-12-31 13:00+00'),
  ('82000000-0000-4000-8000-000000003502', '80000000-0000-4000-8000-000000003501', '40000000-0000-4000-8000-000000003501', 'customer', '10000000-0000-4000-8000-000000003502', '2100-12-31 13:00+00');
set session_replication_role = origin;

set session_replication_role = replica;
insert into public.booking_request_payment_required_expiry_work (
  id, booking_request_id, payment_required_deadline, state
) values (
  '83000000-0000-4000-8000-000000003501',
  '60000000-0000-4000-8000-000000003501', '2100-12-31 14:00+00', 'processing'
);
insert into public.booking_request_confirmation_invalidations (
  booking_request_id, confirmation_id, expiry_work_id, provider_operation_id, reason
) values (
  '60000000-0000-4000-8000-000000003501',
  '80000000-0000-4000-8000-000000003501',
  '83000000-0000-4000-8000-000000003501',
  '81000000-0000-4000-8000-000000003501', 'late-capture'
);
set session_replication_role = origin;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000003502', true);
set local role authenticated;
select is(public.get_confirmed_booking_access('RC-REQ-0000000000003501'), null, 'an invalidated confirmation releases nothing');
select is((select count(*)::text from public.list_confirmed_booking_history()), '0', 'an invalidated confirmation leaves paid Booking History');
reset role;
set session_replication_role = replica;
delete from public.booking_request_confirmation_invalidations
where booking_request_id = '60000000-0000-4000-8000-000000003501';
delete from public.booking_request_payment_required_expiry_work
where id = '83000000-0000-4000-8000-000000003501';
set session_replication_role = origin;

set session_replication_role = replica;
insert into public.booking_request_payment_required_expiry_work (
  id, booking_request_id, payment_required_deadline, state, diagnostic_reason,
  quarantined_at, quarantine_reason
) values (
  '83000000-0000-4000-8000-000000003502',
  '60000000-0000-4000-8000-000000003501', '2100-12-31 14:00+00',
  'quarantined', 'conflicting-evidence', now(), 'conflicting-evidence'
);
set session_replication_role = origin;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000003502', true);
set local role authenticated;
select is(public.get_confirmed_booking_access('RC-REQ-0000000000003501'), null, 'a quarantined payment releases nothing');
select is((select count(*)::text from public.list_confirmed_booking_history()), '0', 'a quarantined payment leaves paid Booking History');
reset role;
set session_replication_role = replica;
delete from public.booking_request_payment_required_expiry_work
where id = '83000000-0000-4000-8000-000000003502';
set session_replication_role = origin;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000003501', true);
set session_replication_role = replica;
update public.account_contexts set owner_approval_state = 'suspended'
where user_id = '10000000-0000-4000-8000-000000003501';
set session_replication_role = origin;
set local role authenticated;
select is(public.get_confirmed_booking_access('RC-REQ-0000000000003501'), null, 'an unapproved Cottage Owner receives no private facts');
reset role;
set session_replication_role = replica;
update public.account_contexts set owner_approval_state = 'approved'
where user_id = '10000000-0000-4000-8000-000000003501';
set session_replication_role = origin;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000003502', true);
update auth.users set phone_confirmed_at = null
where id = '10000000-0000-4000-8000-000000003501';
set local role authenticated;
select is(public.get_confirmed_booking_access('RC-REQ-0000000000003501')->>'ownerPhone', null, 'an unverified counterpart phone is omitted truthfully');
reset role;
update auth.users set phone_confirmed_at = now()
where id = '10000000-0000-4000-8000-000000003501';

select * from finish();
rollback;
