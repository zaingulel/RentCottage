begin;
select plan(208);
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
select throws_ok($$select public.list_booking_history('cottage_owner')$$,'42501',null,'suspended owner cannot forge the owner workspace');
reset role;
update public.account_contexts set owner_approval_state='approved' where user_id='10000000-0000-4000-8000-000000003501';
set local role authenticated;

reset role;
set local role service_role;
drop table owner_lease;
create temp table owner_lease as select public.lease_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003501') result;
-- Scope cases reuse this live lease and roll back their own effects and attempts.
-- This projection fixture does not prove public booking construction.
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg'))) result;
select is((select result->>'status' from scope_effect),'delivered','hosted notification execute admits the approved scope');
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='hosted-demo-yvibcyqtyihpzpmomnzg') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'hosted execution stores one scoped effect under the valid lease');
select ok(exists(select 1 from public.fictional_booking_confirmation_notification_effects e
join public.booking_confirmation_notification_work w using(notification_id) cross join owner_lease l cross join scope_effect r
where e.notification_id='82000000-0000-4000-8000-000000003501' and e.supplier='fictional-notifications' and e.environment='hosted-demo-yvibcyqtyihpzpmomnzg'
and (e.logical_id,e.receipt_id,e.event_id,e.booking_request_id,e.booking_request_reference,e.booking_reference,e.recipient_user_id,e.recipient_role,e.notice_locale,e.template_version,e.payload,e.payload_sha256,e.execution_lease_generation,e.execution_lease_token)
is not distinct from (w.logical_id,w.receipt_id,w.event_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256,(l.result->>'leaseGeneration')::bigint,(l.result->>'leaseToken')::uuid)
and e.payload->'fictional'='true'::jsonb and e.executed_at>=transaction_timestamp() and e.executed_at<=clock_timestamp()
and e.executed_at=(r.result->>'executedAt')::timestamptz and e.id=(r.result->>'effectId')::uuid
and e.supplier_delivery_reference=r.result->>'supplierDeliveryReference'), 'hosted execution preserves the frozen tuple, fictional payload and database time');
set local role service_role;
create temp table scope_query as select public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg'))) result;
select is((select result->>'status' from scope_query),'found','hosted query finds its matching effect');
select is((select result-'status' from scope_query),(select result-'status' from scope_effect),'hosted query returns identical effect evidence');
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg'))),(select result from scope_effect),'hosted execute replays identical evidence');
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg')),(select (result->>'effectId')::uuid from scope_effect)),'{"status":"delivered","historical":false}'::jsonb,'hosted completion reports a final fictional outcome');
reset role;
select ok((select state='delivered' and lease_token is null and lease_expires_at is null and supplier_delivery_reference=(select result->>'supplierDeliveryReference' from scope_effect) and delivered_at=(select (result->>'executedAt')::timestamptz from scope_effect) from public.booking_confirmation_notification_work where notification_id='82000000-0000-4000-8000-000000003501') and (select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501') and (select count(*)=3 from public.booking_confirmation_notification_attempts where receipt_id='82000000-0000-4000-8000-000000003501' and lease_generation=(select (result->>'leaseGeneration')::bigint from owner_lease) and outcome='delivered'), 'hosted completion retains one effect and three delivered attempt facts');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
select is((select result->>'status' from scope_effect),'delivered','notification execute admits legacy local scope');
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'legacy execution stores one scoped effect under the valid lease');
select ok(exists(select 1 from public.fictional_booking_confirmation_notification_effects e
join public.booking_confirmation_notification_work w using(notification_id) cross join owner_lease l cross join scope_effect r
where e.notification_id='82000000-0000-4000-8000-000000003501' and e.supplier='fictional-notifications' and e.environment='local-test'
and (e.logical_id,e.receipt_id,e.event_id,e.booking_request_id,e.booking_request_reference,e.booking_reference,e.recipient_user_id,e.recipient_role,e.notice_locale,e.template_version,e.payload,e.payload_sha256,e.execution_lease_generation,e.execution_lease_token)
is not distinct from (w.logical_id,w.receipt_id,w.event_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256,(l.result->>'leaseGeneration')::bigint,(l.result->>'leaseToken')::uuid)
and e.payload->'fictional'='true'::jsonb and e.executed_at>=transaction_timestamp() and e.executed_at<=clock_timestamp()
and e.executed_at=(r.result->>'executedAt')::timestamptz and e.id=(r.result->>'effectId')::uuid
and e.supplier_delivery_reference=r.result->>'supplierDeliveryReference'), 'legacy execution preserves the frozen tuple, fictional payload and database time');
set local role service_role;
create temp table scope_query as select public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
select is((select result->>'status' from scope_query),'found','legacy query finds its matching effect');
select is((select result-'status' from scope_query),(select result-'status' from scope_effect),'legacy query returns identical effect evidence');
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))),(select result from scope_effect),'legacy execute replays identical evidence');
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)),(select (result->>'effectId')::uuid from scope_effect)),'{"status":"delivered","historical":false}'::jsonb,'legacy completion reports a final fictional outcome');
reset role;
select ok((select state='delivered' and lease_token is null and lease_expires_at is null and supplier_delivery_reference=(select result->>'supplierDeliveryReference' from scope_effect) and delivered_at=(select (result->>'executedAt')::timestamptz from scope_effect) from public.booking_confirmation_notification_work where notification_id='82000000-0000-4000-8000-000000003501') and (select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501') and (select count(*)=3 from public.booking_confirmation_notification_attempts where receipt_id='82000000-0000-4000-8000-000000003501' and lease_generation=(select (result->>'leaseGeneration')::bigint from owner_lease) and outcome='delivered'), 'legacy completion retains one effect and three delivered attempt facts');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test'))) result;
select is((select result->>'status' from scope_effect),'delivered','notification execute admits explicit local scope');
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'local execution stores one scoped effect under the valid lease');
select ok(exists(select 1 from public.fictional_booking_confirmation_notification_effects e
join public.booking_confirmation_notification_work w using(notification_id) cross join owner_lease l cross join scope_effect r
where e.notification_id='82000000-0000-4000-8000-000000003501' and e.supplier='fictional-notifications' and e.environment='local-test'
and (e.logical_id,e.receipt_id,e.event_id,e.booking_request_id,e.booking_request_reference,e.booking_reference,e.recipient_user_id,e.recipient_role,e.notice_locale,e.template_version,e.payload,e.payload_sha256,e.execution_lease_generation,e.execution_lease_token)
is not distinct from (w.logical_id,w.receipt_id,w.event_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256,(l.result->>'leaseGeneration')::bigint,(l.result->>'leaseToken')::uuid)
and e.payload->'fictional'='true'::jsonb and e.executed_at>=transaction_timestamp() and e.executed_at<=clock_timestamp()
and e.executed_at=(r.result->>'executedAt')::timestamptz and e.id=(r.result->>'effectId')::uuid
and e.supplier_delivery_reference=r.result->>'supplierDeliveryReference'), 'local execution preserves the frozen tuple, fictional payload and database time');
set local role service_role;
create temp table scope_query as select public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test'))) result;
select is((select result->>'status' from scope_query),'found','local query finds its matching effect');
select is((select result-'status' from scope_query),(select result-'status' from scope_effect),'local query returns identical effect evidence');
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test'))),(select result from scope_effect),'local execute replays identical evidence');
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test')),(select (result->>'effectId')::uuid from scope_effect)),'{"status":"delivered","historical":false}'::jsonb,'local completion reports a final fictional outcome');
reset role;
select ok((select state='delivered' and lease_token is null and lease_expires_at is null and supplier_delivery_reference=(select result->>'supplierDeliveryReference' from scope_effect) and delivered_at=(select (result->>'executedAt')::timestamptz from scope_effect) from public.booking_confirmation_notification_work where notification_id='82000000-0000-4000-8000-000000003501') and (select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501') and (select count(*)=3 from public.booking_confirmation_notification_attempts where receipt_id='82000000-0000-4000-8000-000000003501' and lease_generation=(select (result->>'leaseGeneration')::bigint from owner_lease) and outcome='delivered'), 'local completion retains one effect and three delivered attempt facts');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test'))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'query local to hosted refusal has one effect and a valid lease');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
savepoint notification_scope_control;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test')))->>'status','found','notification query same-scope control local to hosted');
rollback to savepoint notification_scope_control;
release savepoint notification_scope_control;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg')))->>'status','stale','notification query rejects an opposite-scope stored effect: local to hosted');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification query opposite-scope refusal preserves work, effect and attempts: local to hosted');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg'))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='hosted-demo-yvibcyqtyihpzpmomnzg') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'query hosted to legacy refusal has one effect and a valid lease');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
savepoint notification_scope_control;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg')))->>'status','found','notification query same-scope control hosted to legacy');
rollback to savepoint notification_scope_control;
release savepoint notification_scope_control;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)))->>'status','stale','notification query rejects an opposite-scope stored effect: hosted to legacy');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification query opposite-scope refusal preserves work, effect and attempts: hosted to legacy');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg'))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='hosted-demo-yvibcyqtyihpzpmomnzg') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'query hosted to local refusal has one effect and a valid lease');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
savepoint notification_scope_control;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg')))->>'status','found','notification query same-scope control hosted to local');
rollback to savepoint notification_scope_control;
release savepoint notification_scope_control;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test')))->>'status','stale','notification query rejects an opposite-scope stored effect: hosted to local');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification query opposite-scope refusal preserves work, effect and attempts: hosted to local');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test'))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'execute local to hosted refusal has one effect and a valid lease');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
savepoint notification_scope_control;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test')))->>'status','delivered','notification execute same-scope control local to hosted');
rollback to savepoint notification_scope_control;
release savepoint notification_scope_control;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg')))->>'status','stale','notification execute rejects an opposite-scope stored effect: local to hosted');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification execute opposite-scope refusal preserves work, effect and attempts: local to hosted');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg'))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='hosted-demo-yvibcyqtyihpzpmomnzg') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'execute hosted to legacy refusal has one effect and a valid lease');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
savepoint notification_scope_control;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg')))->>'status','delivered','notification execute same-scope control hosted to legacy');
rollback to savepoint notification_scope_control;
release savepoint notification_scope_control;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)))->>'status','stale','notification execute rejects an opposite-scope stored effect: hosted to legacy');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification execute opposite-scope refusal preserves work, effect and attempts: hosted to legacy');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg'))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='hosted-demo-yvibcyqtyihpzpmomnzg') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'execute hosted to local refusal has one effect and a valid lease');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
savepoint notification_scope_control;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg')))->>'status','delivered','notification execute same-scope control hosted to local');
rollback to savepoint notification_scope_control;
release savepoint notification_scope_control;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test')))->>'status','stale','notification execute rejects an opposite-scope stored effect: hosted to local');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification execute opposite-scope refusal preserves work, effect and attempts: hosted to local');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test'))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'completion local to hosted refusal has one effect and a valid lease');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
savepoint notification_scope_control;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test')),(select (result->>'effectId')::uuid from scope_effect))->>'status','delivered','notification completion same-scope control local to hosted');
rollback to savepoint notification_scope_control;
release savepoint notification_scope_control;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg')),(select (result->>'effectId')::uuid from scope_effect))->>'status','stale','notification completion rejects an opposite-scope stored effect: local to hosted');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification completion opposite-scope refusal preserves work, effect and attempts: local to hosted');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg'))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='hosted-demo-yvibcyqtyihpzpmomnzg') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'completion hosted to legacy refusal has one effect and a valid lease');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
savepoint notification_scope_control;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg')),(select (result->>'effectId')::uuid from scope_effect))->>'status','delivered','notification completion same-scope control hosted to legacy');
rollback to savepoint notification_scope_control;
release savepoint notification_scope_control;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)),(select (result->>'effectId')::uuid from scope_effect))->>'status','stale','notification completion rejects an opposite-scope stored effect: hosted to legacy');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification completion opposite-scope refusal preserves work, effect and attempts: hosted to legacy');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg'))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='hosted-demo-yvibcyqtyihpzpmomnzg') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'completion hosted to local refusal has one effect and a valid lease');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
savepoint notification_scope_control;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-yvibcyqtyihpzpmomnzg')),(select (result->>'effectId')::uuid from scope_effect))->>'status','delivered','notification completion same-scope control hosted to local');
rollback to savepoint notification_scope_control;
release savepoint notification_scope_control;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test')),(select (result->>'effectId')::uuid from scope_effect))->>'status','stale','notification completion rejects an opposite-scope stored effect: hosted to local');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification completion opposite-scope refusal preserves work, effect and attempts: hosted to local');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'query malformed null starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment',null)))->>'status','stale','notification query refuses optional scope null');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification query optional scope null leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'query malformed number starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment',7)))->>'status','stale','notification query refuses optional scope number');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification query optional scope number leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'query malformed boolean starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment',true)))->>'status','stale','notification query refuses optional scope boolean');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification query optional scope boolean leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'query malformed object starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','{}'::jsonb)))->>'status','stale','notification query refuses optional scope object');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification query optional scope object leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'query malformed array starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','[]'::jsonb)))->>'status','stale','notification query refuses optional scope array');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification query optional scope array leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'query malformed unknown starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-foreign')))->>'status','stale','notification query refuses optional scope unknown');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification query optional scope unknown leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'query malformed extra field starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test','unexpected',true)))->>'status','stale','notification query refuses optional scope extra field');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification query optional scope extra field leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'execute malformed null starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment',null)))->>'status','stale','notification execute refuses optional scope null');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification execute optional scope null leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'execute malformed number starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment',7)))->>'status','stale','notification execute refuses optional scope number');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification execute optional scope number leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'execute malformed boolean starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment',true)))->>'status','stale','notification execute refuses optional scope boolean');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification execute optional scope boolean leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'execute malformed object starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','{}'::jsonb)))->>'status','stale','notification execute refuses optional scope object');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification execute optional scope object leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'execute malformed array starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','[]'::jsonb)))->>'status','stale','notification execute refuses optional scope array');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification execute optional scope array leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'execute malformed unknown starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-foreign')))->>'status','stale','notification execute refuses optional scope unknown');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification execute optional scope unknown leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'execute malformed extra field starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test','unexpected',true)))->>'status','stale','notification execute refuses optional scope extra field');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification execute optional scope extra field leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'completion malformed null starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment',null)),(select (result->>'effectId')::uuid from scope_effect))->>'status','stale','notification completion refuses optional scope null');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification completion optional scope null leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'completion malformed number starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment',7)),(select (result->>'effectId')::uuid from scope_effect))->>'status','stale','notification completion refuses optional scope number');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification completion optional scope number leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'completion malformed boolean starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment',true)),(select (result->>'effectId')::uuid from scope_effect))->>'status','stale','notification completion refuses optional scope boolean');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification completion optional scope boolean leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'completion malformed object starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','{}'::jsonb)),(select (result->>'effectId')::uuid from scope_effect))->>'status','stale','notification completion refuses optional scope object');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification completion optional scope object leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'completion malformed array starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','[]'::jsonb)),(select (result->>'effectId')::uuid from scope_effect))->>'status','stale','notification completion refuses optional scope array');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification completion optional scope array leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'completion malformed unknown starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','hosted-demo-foreign')),(select (result->>'effectId')::uuid from scope_effect))->>'status','stale','notification completion refuses optional scope unknown');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification completion optional scope unknown leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select ok((select count(*)=1 from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501' and environment='local-test') and exists(select 1 from public.booking_confirmation_notification_work w,owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501' and w.state='processing' and w.lease_generation=(l.result->>'leaseGeneration')::bigint and w.lease_token=(l.result->>'leaseToken')::uuid and w.lease_expires_at>clock_timestamp() and public.booking_confirmation_notification_binding(w)=l.result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt'), 'completion malformed extra field starts from a valid same-scope effect');
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('fictionalEnvironment','local-test','unexpected',true)),(select (result->>'effectId')::uuid from scope_effect))->>'status','stale','notification completion refuses optional scope extra field');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification completion optional scope extra field leaves no mutation');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),'00000000-0000-4000-8000-000000009999'::uuid,((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)))->>'status','stale','notification query refuses wrong lease directly');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification query wrong lease preserves all evidence');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('templateVersion','changed')))->>'status','stale','notification query refuses corrupt tuple directly');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification query corrupt tuple preserves all evidence');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.query_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),(jsonb_set((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease),'{payload,fictional}','false'::jsonb)))->>'status','stale','notification query refuses corrupt payload directly');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification query corrupt payload preserves all evidence');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select throws_ok(format('set local role anon; select public.query_fictional_booking_confirmation_notification_effect(%L::uuid,%L::bigint,%L::uuid,%L::jsonb)','82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),(select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)),'42501',null,'anon cannot call notification query directly');
reset role;
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select throws_ok(format('set local role authenticated; select public.query_fictional_booking_confirmation_notification_effect(%L::uuid,%L::bigint,%L::uuid,%L::jsonb)','82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),(select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)),'42501',null,'authenticated cannot call notification query directly');
reset role;
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),'00000000-0000-4000-8000-000000009999'::uuid,((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)))->>'status','stale','notification execute refuses wrong lease directly');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification execute wrong lease preserves all evidence');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('templateVersion','changed')))->>'status','stale','notification execute refuses corrupt tuple directly');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification execute corrupt tuple preserves all evidence');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),(jsonb_set((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease),'{payload,fictional}','false'::jsonb)))->>'status','stale','notification execute refuses corrupt payload directly');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification execute corrupt payload preserves all evidence');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select throws_ok(format('set local role anon; select public.execute_fictional_booking_confirmation_notification_effect(%L::uuid,%L::bigint,%L::uuid,%L::jsonb)','82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),(select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)),'42501',null,'anon cannot call notification execute directly');
reset role;
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select throws_ok(format('set local role authenticated; select public.execute_fictional_booking_confirmation_notification_effect(%L::uuid,%L::bigint,%L::uuid,%L::jsonb)','82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),(select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)),'42501',null,'authenticated cannot call notification execute directly');
reset role;
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),'00000000-0000-4000-8000-000000009999'::uuid,((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)),(select (result->>'effectId')::uuid from scope_effect))->>'status','stale','notification completion refuses wrong lease directly');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification completion wrong lease preserves all evidence');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease)||jsonb_build_object('templateVersion','changed')),(select (result->>'effectId')::uuid from scope_effect))->>'status','stale','notification completion refuses corrupt tuple directly');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification completion corrupt tuple preserves all evidence');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
create temp table scope_before as select jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')) snapshot;
set local role service_role;
select is(public.complete_booking_confirmation_notification_delivery('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),(jsonb_set((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease),'{payload,fictional}','false'::jsonb)),(select (result->>'effectId')::uuid from scope_effect))->>'status','stale','notification completion refuses corrupt payload directly');
reset role;
select is(jsonb_build_object(
  'work',(select to_jsonb(w) from public.booking_confirmation_notification_work w where notification_id='82000000-0000-4000-8000-000000003501'),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects e where notification_id='82000000-0000-4000-8000-000000003501'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.booking_confirmation_notification_attempts a where coalesce(event_id,receipt_id)='82000000-0000-4000-8000-000000003501')),(select snapshot from scope_before),'notification completion corrupt payload preserves all evidence');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select throws_ok(format('set local role anon; select public.complete_booking_confirmation_notification_delivery(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::uuid)','82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),(select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease),(select result->>'effectId' from scope_effect)),'42501',null,'anon cannot call notification completion directly');
reset role;
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
create temp table scope_effect as select public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),((select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease))) result;
reset role;
select throws_ok(format('set local role authenticated; select public.complete_booking_confirmation_notification_delivery(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::uuid)','82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from owner_lease),(select (result->>'leaseToken')::uuid from owner_lease),(select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from owner_lease),(select result->>'effectId' from scope_effect)),'42501',null,'authenticated cannot call notification completion directly');
reset role;
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
reset role;
select throws_ok($table$insert into public.fictional_booking_confirmation_notification_effects(
id,supplier,environment,logical_id,receipt_id,event_id,booking_request_id,booking_request_reference,booking_reference,recipient_user_id,recipient_role,notice_locale,template_version,payload,payload_sha256,execution_lease_generation,execution_lease_token,supplier_delivery_reference)
select '92000000-0000-4000-8000-000000003501','fictional-notifications','hosted-demo-foreign',w.logical_id,w.receipt_id,w.event_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256,(l.result->>'leaseGeneration')::bigint,(l.result->>'leaseToken')::uuid,'fictional-constraint-3501'
from public.booking_confirmation_notification_work w cross join owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501'$table$,'23514','new row for relation "fictional_booking_confirmation_notification_effects" violates check constraint "fictional_booking_confirmation_notification_effect_identity"','notification effect constraint rejects an unknown environment');
select is((select count(*) from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501'),0::bigint,'constraint unknown environment writes no effect');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;
savepoint notification_scope_case;
set local role service_role;
reset role;
select throws_ok($table$insert into public.fictional_booking_confirmation_notification_effects(
id,supplier,environment,logical_id,receipt_id,event_id,booking_request_id,booking_request_reference,booking_reference,recipient_user_id,recipient_role,notice_locale,template_version,payload,payload_sha256,execution_lease_generation,execution_lease_token,supplier_delivery_reference)
select '92000000-0000-4000-8000-000000003501','other-notifications','hosted-demo-yvibcyqtyihpzpmomnzg',w.logical_id,w.receipt_id,w.event_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256,(l.result->>'leaseGeneration')::bigint,(l.result->>'leaseToken')::uuid,'fictional-constraint-3501'
from public.booking_confirmation_notification_work w cross join owner_lease l where w.notification_id='82000000-0000-4000-8000-000000003501'$table$,'23514','new row for relation "fictional_booking_confirmation_notification_effects" violates check constraint "fictional_booking_confirmation_notification_effect_identity"','notification effect constraint rejects a wrong supplier');
select is((select count(*) from public.fictional_booking_confirmation_notification_effects where notification_id='82000000-0000-4000-8000-000000003501'),0::bigint,'constraint wrong supplier writes no effect');
rollback to savepoint notification_scope_case;
release savepoint notification_scope_case;
set local role service_role;

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

-- Preparation reminder intents exist before work and become candidates only at
-- their immutable database deadline. Shift this isolated fixture around the
-- real database clock without weakening the production deadline calculation.
set session_replication_role=replica;
delete from public.booking_request_confirmation_invalidations where booking_request_id='60000000-0000-4000-8000-000000003501';
delete from public.booking_request_payment_required_expiry_work where booking_request_id='60000000-0000-4000-8000-000000003501';
insert into public.booking_notification_events(id,booking_request_id,receipt_id,event_kind,recipient_user_id,recipient_role,notice_locale,due_at,first_starts_at,created_at) values
  ('90000000-0000-4000-8000-000000003571','60000000-0000-4000-8000-000000003501','82000000-0000-4000-8000-000000003502','preparation_reminder','10000000-0000-4000-8000-000000003502','customer','en','2100-12-31 05:00+00','2101-01-01 05:00+00',clock_timestamp()),
  ('90000000-0000-4000-8000-000000003572','60000000-0000-4000-8000-000000003501','82000000-0000-4000-8000-000000003501','preparation_reminder','10000000-0000-4000-8000-000000003501','cottage_owner','en','2100-12-31 05:00+00','2101-01-01 05:00+00',clock_timestamp());
set session_replication_role=origin;
set local role service_role;
select is((select count(*) from public.list_due_booking_confirmation_notifications(50) candidate where candidate#>>'{event,kind}'='preparation_reminder'),0::bigint,'future reminder intents create no work or early candidates');
reset role;
select is((select count(*) from public.booking_confirmation_notification_work where event_id in ('90000000-0000-4000-8000-000000003571','90000000-0000-4000-8000-000000003572')),0::bigint,'future reminder tick creates no work');
set session_replication_role=replica;
update public.cottage_booking_period_commitments set access_ranges=tstzmultirange(tstzrange(now()+interval '23 hours',now()+interval '27 hours','[)')) where id='50000000-0000-4000-8000-000000003501';
update public.booking_notification_events set due_at=now()-interval '1 hour',first_starts_at=now()+interval '23 hours' where id in ('90000000-0000-4000-8000-000000003571','90000000-0000-4000-8000-000000003572');
set session_replication_role=origin;
set local role service_role;
select is((select count(*) from public.list_due_booking_confirmation_notifications(50) candidate where candidate#>>'{event,kind}'='preparation_reminder'),2::bigint,'due workless reminders are selected for bounded reconciliation');
create temp table reminder_candidate as select candidate from public.list_due_booking_confirmation_notifications(50) candidate where candidate#>>'{event,id}'='90000000-0000-4000-8000-000000003571';
select lives_ok($$select public.ensure_booking_confirmation_notification_work((candidate->>'receiptId')::uuid,candidate->>'locale','booking-event-v1',jsonb_build_object('kind','preparation_reminder','title','Prepare','body','Open authenticated details','bookingReference',candidate->>'bookingReference','detailsPath','/en/booking-requests/'||(candidate->>'bookingRequestReference'),'linkLabel','View booking','fictional',true,'dueAt',candidate#>>'{event,dueAt}','firstStartsAt',candidate#>>'{event,firstStartsAt}'),(candidate#>>'{event,id}')::uuid) from reminder_candidate$$,'due customer reminder freezes one immutable binding');
create temp table reminder_lease as select public.lease_booking_confirmation_notification_work((candidate->>'receiptId')::uuid,(candidate#>>'{event,id}')::uuid) result from reminder_candidate;
create temp table reminder_execution as select public.execute_fictional_booking_confirmation_notification_effect((candidate->>'receiptId')::uuid,(result->>'leaseGeneration')::bigint,(result->>'leaseToken')::uuid,result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt',(candidate#>>'{event,id}')::uuid) result from reminder_candidate,reminder_lease;
select is((select result->>'status' from reminder_execution),'delivered','eligible due reminder records one fictional effect');
reset role;
select is((select count(*) from public.fictional_booking_confirmation_notification_effects where event_id='90000000-0000-4000-8000-000000003571'),1::bigint,'repeated processing cannot duplicate the reminder effect');
set local role service_role;
create temp table owner_reminder_candidate as select candidate from public.list_due_booking_confirmation_notifications(50) candidate where candidate#>>'{event,id}'='90000000-0000-4000-8000-000000003572';
select lives_ok($$select public.ensure_booking_confirmation_notification_work((candidate->>'receiptId')::uuid,candidate->>'locale','booking-event-v1',jsonb_build_object('kind','preparation_reminder','title','Prepare','body','Open authenticated details','bookingReference',candidate->>'bookingReference','detailsPath','/en/owner/booking-requests/'||(candidate->>'bookingRequestReference'),'linkLabel','View booking','fictional',true,'dueAt',candidate#>>'{event,dueAt}','firstStartsAt',candidate#>>'{event,firstStartsAt}'),(candidate#>>'{event,id}')::uuid) from owner_reminder_candidate$$,'due owner reminder freezes one immutable binding');
create temp table owner_reminder_lease as select public.lease_booking_confirmation_notification_work((candidate->>'receiptId')::uuid,(candidate#>>'{event,id}')::uuid) result from owner_reminder_candidate;
reset role;
update public.account_contexts set owner_approval_state='suspended' where user_id='10000000-0000-4000-8000-000000003501';
set local role service_role;
create temp table owner_reminder_execution as select public.execute_fictional_booking_confirmation_notification_effect((candidate->>'receiptId')::uuid,(result->>'leaseGeneration')::bigint,(result->>'leaseToken')::uuid,result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt',(candidate#>>'{event,id}')::uuid) result from owner_reminder_candidate,owner_reminder_lease;
select is((select result->>'status' from owner_reminder_execution),'suppressed','revoked owner capability suppresses due work after leasing');
reset role;
select is((select state from public.booking_confirmation_notification_work where event_id='90000000-0000-4000-8000-000000003572'),'suppressed','revoked due reminder reaches a durable terminal state');
select is((select count(*) from public.fictional_booking_confirmation_notification_effects where event_id='90000000-0000-4000-8000-000000003572'),0::bigint,'revoked reminder creates no supplier effect');

-- Revocation before work exists still receives a durable outcome at due.
set session_replication_role=replica;
delete from public.booking_confirmation_notification_attempts where event_id='90000000-0000-4000-8000-000000003572';
delete from public.booking_confirmation_notification_work where event_id='90000000-0000-4000-8000-000000003572';
set session_replication_role=origin;
set local role service_role;
select is((select count(*) from public.list_due_booking_confirmation_notifications(50) candidate where candidate#>>'{event,id}'='90000000-0000-4000-8000-000000003572'),1::bigint,'revoked due intent without work is selected rather than silently skipped');
select lives_ok($$select public.ensure_booking_confirmation_notification_work((candidate->>'receiptId')::uuid,candidate->>'locale','booking-event-v1',jsonb_build_object('kind','preparation_reminder','title','Prepare','body','Open authenticated details','bookingReference',candidate->>'bookingReference','detailsPath','/en/owner/booking-requests/'||(candidate->>'bookingRequestReference'),'linkLabel','View booking','fictional',true,'dueAt',candidate#>>'{event,dueAt}','firstStartsAt',candidate#>>'{event,firstStartsAt}'),(candidate#>>'{event,id}')::uuid) from owner_reminder_candidate$$,'revoked due intent can prepare its immutable work');
create temp table workless_revoked_lease as select public.lease_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003501','90000000-0000-4000-8000-000000003572') result;
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from workless_revoked_lease),(select (result->>'leaseToken')::uuid from workless_revoked_lease),(select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from workless_revoked_lease),'90000000-0000-4000-8000-000000003572')->>'status','suppressed','revoked workless intent reaches durable suppression');
reset role;
select is((select count(*) from public.fictional_booking_confirmation_notification_effects where event_id='90000000-0000-4000-8000-000000003572'),0::bigint,'revoked workless reconciliation creates no effect');

-- A manually prepared future reminder still cannot lease early. Once due, an
-- eligible retryable reminder waits for participant action, while revocation
-- makes that same retryable row selectable and leaseable for suppression.
set session_replication_role=replica;
delete from public.booking_confirmation_notification_attempts where event_id='90000000-0000-4000-8000-000000003572';
delete from public.fictional_booking_confirmation_notification_effects where event_id='90000000-0000-4000-8000-000000003572';
delete from public.booking_confirmation_notification_work where event_id='90000000-0000-4000-8000-000000003572';
update public.account_contexts set owner_approval_state='approved' where user_id='10000000-0000-4000-8000-000000003501';
update public.cottage_booking_period_commitments set access_ranges='{["2101-01-02 05:00+00","2101-01-02 09:00+00")}'::tstzmultirange where id='50000000-0000-4000-8000-000000003501';
update public.booking_notification_events set due_at='2101-01-01 05:00+00',first_starts_at='2101-01-02 05:00+00' where id='90000000-0000-4000-8000-000000003572';
set session_replication_role=origin;
set local role service_role;
select lives_ok($$select public.ensure_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003501','en','booking-event-v1','{"kind":"preparation_reminder","title":"Prepare","body":"Open authenticated details","bookingReference":"CONFIRMED-BOOKING-35","detailsPath":"/en/owner/booking-requests/RC-REQ-0000000000003501","linkLabel":"View booking","fictional":true,"dueAt":"2101-01-01T05:00:00+00:00","firstStartsAt":"2101-01-02T05:00:00+00:00"}'::jsonb,'90000000-0000-4000-8000-000000003572')$$,'a manually prepared future reminder retains immutable work');
select is(public.lease_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003501','90000000-0000-4000-8000-000000003572'),null::jsonb,'a future reminder cannot lease before its due boundary');
reset role;
create temp table due_reminder_anchor as select clock_timestamp()+interval '23 hours' first_starts_at;
set session_replication_role=replica;
update public.booking_confirmation_notification_work set state='pending',lease_token=null,lease_expires_at=null where event_id='90000000-0000-4000-8000-000000003572';
update public.cottage_booking_period_commitments set access_ranges=tstzmultirange(tstzrange(anchor.first_starts_at,anchor.first_starts_at+interval '4 hours','[)')) from due_reminder_anchor anchor where id='50000000-0000-4000-8000-000000003501';
update public.booking_notification_events set due_at=anchor.first_starts_at-interval '24 hours',first_starts_at=anchor.first_starts_at from due_reminder_anchor anchor where id='90000000-0000-4000-8000-000000003572';
set session_replication_role=origin;
set local role service_role;
create temp table due_retry_lease as select public.lease_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003501','90000000-0000-4000-8000-000000003572') result;
select is(public.record_booking_confirmation_notification_failure('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from due_retry_lease),(select (result->>'leaseToken')::uuid from due_retry_lease),'failed','90000000-0000-4000-8000-000000003572')->>'status','retryable','a due preparation reminder records a known retryable failure');
select is((select count(*) from public.list_due_booking_confirmation_notifications(50) candidate where candidate#>>'{event,id}'='90000000-0000-4000-8000-000000003572'),0::bigint,'an eligible retryable reminder waits for participant action');
reset role;
update public.account_contexts set owner_approval_state='suspended' where user_id='10000000-0000-4000-8000-000000003501';
set local role service_role;
select is((select count(*) from public.list_due_booking_confirmation_notifications(50) candidate where candidate#>>'{event,id}'='90000000-0000-4000-8000-000000003572'),1::bigint,'an ineligible retryable reminder remains selected for durable suppression');
create temp table revoked_retry_lease as select public.lease_booking_confirmation_notification_work('82000000-0000-4000-8000-000000003501','90000000-0000-4000-8000-000000003572') result;
select isnt((select result from revoked_retry_lease),null::jsonb,'an ineligible retryable reminder leases for suppression');
select is(public.execute_fictional_booking_confirmation_notification_effect('82000000-0000-4000-8000-000000003501',(select (result->>'leaseGeneration')::bigint from revoked_retry_lease),(select (result->>'leaseToken')::uuid from revoked_retry_lease),(select result-'leaseGeneration'-'leaseToken'-'leaseExpiresAt' from revoked_retry_lease),'90000000-0000-4000-8000-000000003572')->>'status','suppressed','the ineligible retryable reminder reaches durable suppression without an effect');
reset role;
select * from finish();
rollback;
