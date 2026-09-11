begin;
select plan(36);
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
  ('10000000-0000-4000-8000-000000003501', 'authenticated', 'authenticated', '+9647500003501', now()),
  ('10000000-0000-4000-8000-000000003502', 'authenticated', 'authenticated', '+9647500003502', now()),
  ('10000000-0000-4000-8000-000000003503', 'authenticated', 'authenticated', '+9647500003503', now());
insert into public.account_contexts (user_id, role, owner_approval_state) values
  ('10000000-0000-4000-8000-000000003501', 'cottage_owner', 'approved'),
  ('10000000-0000-4000-8000-000000003502', 'cottage_owner', 'suspended'),
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
create temp table customer_access as
  select public.get_confirmed_booking_access('RC-REQ-0000000000003501') result;
select is((select result->>'actorRole' from customer_access), 'customer', 'the actual Customer receives Customer access');
select is((select result->>'receiptId' from customer_access), '82000000-0000-4000-8000-000000003502', 'the Customer receives only their receipt identity');
select is((select result->>'bookingReference' from customer_access), 'CONFIRMED-BOOKING-35', 'the stable commitment reference is retained');

set local role service_role;
select throws_ok($$select public.list_due_booking_confirmation_notifications(null)$$,'22023',null,'a null limit cannot unbound the scheduled drain');
create temp table due as select public.list_due_booking_confirmation_notifications(10) result;
select is((select count(*)::integer from due),2,'both existing paid receipt intents are discovered');
select ok(not exists(select 1 from due where result::text ~* 'address|direction|phone'),'candidate selection contains no private access facts');
select throws_ok($$select public.ensure_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003502','en','paid-confirmation-v1','{"kind":"paid-confirmation","title":"Booking confirmed","body":"Paid","bookingReference":"CONFIRMED-BOOKING-35","linkLabel":"View","fictional":true}'::jsonb)$$,'RC409',null,'a missing details path cannot bypass binding validation');
select lives_ok($$select public.ensure_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003502','en','paid-confirmation-v1','{"kind":"paid-confirmation","title":"Booking confirmed","body":"Paid CONFIRMED-BOOKING-35","bookingReference":"CONFIRMED-BOOKING-35","detailsPath":"/en/booking-requests/RC-REQ-0000000000003501","linkLabel":"View confirmed booking","fictional":true}'::jsonb)$$,'the customer binding is frozen');
select throws_ok($$select public.ensure_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003502','ar','paid-confirmation-v1','{"kind":"paid-confirmation","title":"Changed","body":"Changed","bookingReference":"CONFIRMED-BOOKING-35","detailsPath":"/ar/booking-requests/RC-REQ-0000000000003501","linkLabel":"Changed","fictional":true}'::jsonb)$$,'RC409',null,'frozen locale and payload cannot be replayed with changed binding');
create temp table leased as select public.lease_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003502') result;
select is((select result->>'locale' from leased),'en','lease returns frozen locale');
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003502',null,null,(select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from leased))->>'status','stale','null lease identity fails closed');
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003502',(select (result->>'leaseGeneration')::bigint from leased),(select (result->>'leaseToken')::uuid from leased),(select jsonb_set(result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt','{templateVersion}','"changed"') from leased))->>'status','stale','changed frozen binding is stale');
select public.record_booking_confirmation_notification_failure('82000000-0000-4000-8000-000000003502',(select (result->>'leaseGeneration')::bigint from leased),(select (result->>'leaseToken')::uuid from leased),'failed');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003502',true);
select is(public.retry_booking_confirmation_notification('82000000-0000-4000-8000-000000003502')->>'status','queued','suspended owner retains retry of their customer receipt');
reset role;
set local role service_role;
update leased set result=public.lease_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003502');
create temp table expired_lease as select result from leased;
reset role;
update public.booking_confirmation_notification_work set lease_expires_at=clock_timestamp()-interval '1 second' where receipt_id='82000000-0000-4000-8000-000000003502';
set role service_role;
update leased set result=public.lease_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003502');
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003502',(select (result->>'leaseGeneration')::bigint from expired_lease),(select (result->>'leaseToken')::uuid from expired_lease),(select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from expired_lease))->>'status','stale','a previously valid lease cannot execute after replacement');
reset role;
set session_replication_role=replica;
insert into public.booking_request_payment_required_expiry_work(id,booking_request_id,payment_required_deadline,state) values('83000000-0000-4000-8000-000000003501','60000000-0000-4000-8000-000000003501','2100-12-31 14:00+00','processing');
insert into public.booking_request_confirmation_invalidations(booking_request_id,confirmation_id,expiry_work_id,provider_operation_id,reason) values('60000000-0000-4000-8000-000000003501','80000000-0000-4000-8000-000000003501','83000000-0000-4000-8000-000000003501','81000000-0000-4000-8000-000000003501','late-capture');
set session_replication_role=origin;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003502',(select (result->>'leaseGeneration')::bigint from leased),(select (result->>'leaseToken')::uuid from leased),(select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from leased))->>'status','suppressed','invalidation first suppresses execution');
reset role;
select is((select count(*)::integer from public.fictional_booking_confirmation_notification_effects),0,'suppression writes no supplier effect');
set session_replication_role=replica;
delete from public.booking_request_confirmation_invalidations where booking_request_id='60000000-0000-4000-8000-000000003501';
delete from public.booking_request_payment_required_expiry_work where id='83000000-0000-4000-8000-000000003501';
set session_replication_role=origin;
set local role service_role;
select lives_ok($$select public.ensure_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003501','en','paid-confirmation-v1','{"kind":"paid-confirmation","title":"Booking confirmed","body":"Paid CONFIRMED-BOOKING-35","bookingReference":"CONFIRMED-BOOKING-35","detailsPath":"/en/owner/booking-requests/RC-REQ-0000000000003501","linkLabel":"View confirmed booking","fictional":true}'::jsonb)$$,'the owner binding is frozen');
create temp table owner_lease as select public.lease_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003501') result;
select is(public.record_booking_confirmation_notification_failure('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),'failed')->>'status','retryable','known failure waits for participant action');
select is(public.lease_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003501'),null,'retryable work cannot be leased automatically');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003501',true);
set local role authenticated;
select is(public.retry_booking_confirmation_notification('82000000-0000-4000-8000-000000003501')->>'status','queued','the verified paid participant queues the retry');
reset role;
update public.account_contexts set owner_approval_state='suspended' where user_id='10000000-0000-4000-8000-000000003501';
set local role authenticated;
select throws_ok($$select public.retry_booking_confirmation_notification('82000000-0000-4000-8000-000000003501')$$,'42501',null,'suspended owner cannot retry their owner receipt');
select throws_ok($$select public.get_booking_confirmation_notification_status('82000000-0000-4000-8000-000000003501')$$,'42501',null,'suspended owner cannot read their owner notification status');
select is((select count(*)::integer from public.list_confirmed_booking_history()),0,'suspended owner sees no owner receipts in history');
reset role;
update public.account_contexts set owner_approval_state='approved' where user_id='10000000-0000-4000-8000-000000003501';
set local role authenticated;

reset role;
set local role service_role;
drop table owner_lease;
create temp table owner_lease as select public.lease_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003501') result;
create temp table executed as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),(select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)) result;
select is((select result->>'status' from executed),'delivered','execute first persists one effect');
reset role;
select is((select count(*)::integer from public.fictional_booking_confirmation_notification_effects),1,'supplier effect is unique');
select throws_ok($$update public.fictional_booking_confirmation_notification_effects set payload='{}'$$,'RC204',null,'supplier effect is immutable');
set session_replication_role=replica;
insert into public.booking_request_payment_required_expiry_work(id,booking_request_id,payment_required_deadline,state) values('83000000-0000-4000-8000-000000003502','60000000-0000-4000-8000-000000003501','2100-12-31 14:00+00','processing');
insert into public.booking_request_confirmation_invalidations(booking_request_id,confirmation_id,expiry_work_id,provider_operation_id,reason) values('60000000-0000-4000-8000-000000003501','80000000-0000-4000-8000-000000003501','83000000-0000-4000-8000-000000003502','81000000-0000-4000-8000-000000003501','late-capture');
set session_replication_role=origin;
set local role service_role;
create temp table completed as select public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),(select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease),(select (result->>'effectId')::uuid from executed)) result;
select is((select result->>'status' from completed),'delivered','application completion reconciles the effect');
select is((select result->>'historical' from completed),'true','post-effect invalidation is reported as historical delivery');
reset role;
select is((select count(*)::integer from public.fictional_booking_confirmation_notification_effects),1,'completion does not duplicate the supplier effect');
set local role service_role;
select is(public.record_booking_confirmation_notification_failure('82000000-0000-4000-8000-000000003501',null,null,'unknown')->>'status','stale','null stale failure identity cannot mutate terminal delivery');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003503',true);
set local role authenticated;
select throws_ok($$select public.get_booking_confirmation_notification_status('82000000-0000-4000-8000-000000003501')$$,'42501',null,'a non-participant cannot read notification status');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select throws_ok($$select public.get_booking_confirmation_notification_status('82000000-0000-4000-8000-000000003501')$$,'42501',null,'missing actor identity fails closed');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003501',true);
set local role authenticated;
select is(public.get_booking_confirmation_notification_status('82000000-0000-4000-8000-000000003501')->>'historical','true','the paid participant sees truthful historic delivery');
reset role;
select * from finish();
rollback;
