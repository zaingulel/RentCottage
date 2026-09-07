begin;

-- BEGIN CONFIRMATION FIXTURE
-- BEGIN CAPTURE RECOVERY SOURCE
insert into auth.users (id, aud, role, phone, phone_confirmed_at) values
('10000000-0000-4000-8000-000000001001','authenticated','authenticated','+9647500001001',now()),
('10000000-0000-4000-8000-000000001002','authenticated','authenticated','+9647500001002',now()),
('10000000-0000-4000-8000-000000001003','authenticated','authenticated','+9647500001003',now());
insert into public.account_contexts (user_id, role, owner_approval_state) values
('10000000-0000-4000-8000-000000001001','cottage_owner','approved'),
('10000000-0000-4000-8000-000000001002','customer',null),
('10000000-0000-4000-8000-000000001003','customer',null);
insert into public.owner_application_cottage_profiles
(id,owner_user_id,name,governorate,approximate_location,exact_address,capacity,bedrooms,bathrooms,amenities,source_language,description,house_rules,status)
values ('20000000-0000-4000-8000-000000001001','10000000-0000-4000-8000-000000001001','Confirmation Cottage','Baghdad','Karrada','Private address',8,3,2,array['garden'],'en','Fixture description','Fixture rules','draft');
insert into public.cottage_shift_schedule_revisions (id,profile_id,revision,full_day_bundle_id)
values ('30000000-0000-4000-8000-000000001001','20000000-0000-4000-8000-000000001001',1,'31000000-0000-4000-8000-000000001001');
select set_config('rentcottage.shift_schedule_write_revision_id','30000000-0000-4000-8000-000000001001',true);
insert into public.cottage_shifts (id,schedule_revision_id,position,name,start_time,end_time) values
('32000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001',1,'Morning','08:00','12:00'),
('32000000-0000-4000-8000-000000001002','30000000-0000-4000-8000-000000001001',2,'Evening','14:00','18:00'),
('32000000-0000-4000-8000-000000001003','30000000-0000-4000-8000-000000001001',3,'Night','20:00','02:00');
select set_config('rentcottage.shift_schedule_write_revision_id','',true);
insert into public.booking_snapshots
(id,customer_user_id,profile_id,quote_fingerprint,intent_fingerprint,quote_payload,intent_payload,booking_terms_version,booking_terms_locale,booking_terms_body,booking_terms_sha256,cancellation_policy_version,acceptance_locale,acceptance_evidence,acceptance_evidence_fingerprint,marketplace_commission_rate_basis_points,marketplace_commission_amount_fils,created_at)
values ('40000000-0000-4000-8000-000000001001','10000000-0000-4000-8000-000000001002','20000000-0000-4000-8000-000000001001',repeat('a',64),repeat('b',64),
'{"bookingPriceIqd":110000,"serviceFeeIqd":5000,"customerTotalIqd":115000,"items":[{"serviceDay":"2101-01-01","kind":"shift","position":1},{"serviceDay":"2101-01-01","kind":"shift","position":3},{"serviceDay":"2101-01-02","kind":"full_day_bundle"}]}'::jsonb,
'{"customerName":"Fictional Customer","partySize":4}'::jsonb,'confirmation-test-v1','en','Fictional terms',repeat('c',64),'fictional-cancellation-v1','en','{}'::jsonb,repeat('d',64),1000,11000000,'2100-12-31 12:00+00');
insert into public.cottage_booking_period_commitments
(id,customer_user_id,profile_id,schedule_revision_id,commitment_reference,status,access_ranges,created_at)
values ('50000000-0000-4000-8000-000000001001','10000000-0000-4000-8000-000000001002','20000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001','CONFIRMATION-HOLD-1','pending_hold','{["2101-01-01 05:00+00","2101-01-01 09:00+00"),["2101-01-01 17:00+00","2101-01-01 23:00+00"),["2101-01-02 05:00+00","2101-01-02 23:00+00")}'::tstzmultirange,'2100-12-31 11:59:59+00');
insert into public.cottage_inventory_commitments
(id,unit_kind,unit_id,service_day,committed_price_iqd,booking_period_commitment_id) values
('51000000-0000-4000-8000-000000001001','shift','32000000-0000-4000-8000-000000001001','2101-01-01',30000,'50000000-0000-4000-8000-000000001001'),
('51000000-0000-4000-8000-000000001002','shift','32000000-0000-4000-8000-000000001003','2101-01-01',30000,'50000000-0000-4000-8000-000000001001'),
('51000000-0000-4000-8000-000000001003','full_day_bundle','31000000-0000-4000-8000-000000001001','2101-01-02',50000,'50000000-0000-4000-8000-000000001001');
insert into public.cottage_booking_period_occupancies
(booking_period_commitment_id,schedule_revision_id,shift_id,service_day,active) values
('50000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001','32000000-0000-4000-8000-000000001001','2101-01-01',true),
('50000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001','32000000-0000-4000-8000-000000001003','2101-01-01',true),
('50000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001','32000000-0000-4000-8000-000000001001','2101-01-02',true),
('50000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001','32000000-0000-4000-8000-000000001002','2101-01-02',true),
('50000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001','32000000-0000-4000-8000-000000001003','2101-01-02',true);
insert into public.booking_requests
(id,booking_request_reference,customer_user_id,owner_user_id,profile_id,booking_snapshot_id,booking_period_commitment_id,payment_lifecycle_id,customer_name,party_size,status,response_deadline,created_at,settled_at)
values ('60000000-0000-4000-8000-000000001001','RC-REQ-0000000000001001','10000000-0000-4000-8000-000000001002','10000000-0000-4000-8000-000000001001','20000000-0000-4000-8000-000000001001','40000000-0000-4000-8000-000000001001','50000000-0000-4000-8000-000000001001','73000000-0000-4000-8000-000000001001','Fictional Customer',4,'accepted','2100-12-31 16:00+00','2100-12-31 12:00+00','2100-12-31 13:00+00');
insert into public.booking_request_submission_attempts
(id,customer_user_id,idempotency_key,payment_lifecycle_id,profile_id,locale,public_slug,requested_search,quote_fingerprint,quote_payload,intent_fingerprint,intent_payload,payment_snapshot,authorization_provider,authorization_environment,authorization_merchant_id,authorization_terminal_id,authorization_provider_request_id,authorization_provider_reference,authorization_movement_reference,state,booking_request_id)
values ('70000000-0000-4000-8000-000000001001','10000000-0000-4000-8000-000000001002','71000000-0000-4000-8000-000000001001','73000000-0000-4000-8000-000000001001','20000000-0000-4000-8000-000000001001','en','confirmation-cottage','{}'::jsonb,repeat('a',64),
'{"bookingPriceIqd":110000,"serviceFeeIqd":5000,"customerTotalIqd":115000,"items":[{"serviceDay":"2101-01-01","kind":"shift","position":1},{"serviceDay":"2101-01-01","kind":"shift","position":3},{"serviceDay":"2101-01-02","kind":"full_day_bundle"}]}'::jsonb,
repeat('b',64),'{"customerName":"Fictional Customer","partySize":4}'::jsonb,
jsonb_build_object('paymentLifecycleId','73000000-0000-4000-8000-000000001001','currency','IQD','bookingPriceFils',110000000,'bookingServiceFeeFils',5000000,'customerTotalFils',115000000,
'authorization',jsonb_build_object('paymentLifecycleId','73000000-0000-4000-8000-000000001001','kind','authorization','logicalOperationId','73000000-0000-4000-8000-000000001001:authorization','attemptId','73000000-0000-4000-8000-000000001001:authorization:attempt-1','status','succeeded','amountFils',115000000,'providerRequestId','confirmation-auth-request-1','providerReference','confirmation-auth-reference-1','movementReference','confirmation-auth-movement-1','reconciliationRequired',false,'retrySafe',false),
'capture',null,'release',null,'movements',jsonb_build_array(jsonb_build_object('kind','authorization','logicalOperationId','73000000-0000-4000-8000-000000001001:authorization','attemptId','73000000-0000-4000-8000-000000001001:authorization:attempt-1','amountFils',115000000,'movementReference','confirmation-auth-movement-1','recordedAt','2026-01-01T12:00:00.000Z'))),
'fictional-payments','local-test','fictional-merchant','fictional-terminal','confirmation-auth-request-1','confirmation-auth-reference-1','confirmation-auth-movement-1','finalized','60000000-0000-4000-8000-000000001001');
insert into public.booking_request_authorization_claims
(id,attempt_id,generation,state_revision,state,customer_user_id,profile_id,schedule_revision_id,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,provider,environment,merchant_id,terminal_id,provider_idempotency_key,quote_fingerprint,intent_fingerprint,access_ranges,not_after,reconciliation_expires_at)
values ('72000000-0000-4000-8000-000000001001','70000000-0000-4000-8000-000000001001',1,2,'converted','10000000-0000-4000-8000-000000001002','20000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001','73000000-0000-4000-8000-000000001001','73000000-0000-4000-8000-000000001001:authorization','73000000-0000-4000-8000-000000001001:authorization:attempt-1',115000000,'IQD','fictional-payments','local-test','fictional-merchant','fictional-terminal','booking-request:72000000-0000-4000-8000-000000001001:1',repeat('a',64),repeat('b',64),'{["2101-01-01 05:00+00","2101-01-01 09:00+00"),["2101-01-01 17:00+00","2101-01-01 23:00+00"),["2101-01-02 05:00+00","2101-01-02 23:00+00")}'::tstzmultirange,'2101-01-01 00:00+00','2100-12-31 23:59+00');
insert into public.booking_request_authorization_claim_items
(claim_id,unit_kind,unit_id,service_day,price_iqd) values
('72000000-0000-4000-8000-000000001001','shift','32000000-0000-4000-8000-000000001001','2101-01-01',30000),
('72000000-0000-4000-8000-000000001001','shift','32000000-0000-4000-8000-000000001003','2101-01-01',30000),
('72000000-0000-4000-8000-000000001001','full_day_bundle','31000000-0000-4000-8000-000000001001','2101-01-02',50000);
insert into public.booking_request_authorization_claim_occupancies
(claim_id,schedule_revision_id,shift_id,service_day,active)
select '72000000-0000-4000-8000-000000001001',schedule_revision_id,shift_id,service_day,false
from public.cottage_booking_period_occupancies where booking_period_commitment_id='50000000-0000-4000-8000-000000001001';
insert into public.booking_request_provider_operation_identities
(attempt_id,operation_kind,provider,environment,merchant_id,terminal_id,provider_request_id,provider_reference,movement_reference)
values ('70000000-0000-4000-8000-000000001001','authorization','fictional-payments','local-test','fictional-merchant','fictional-terminal','confirmation-auth-request-1','confirmation-auth-reference-1','confirmation-auth-movement-1');
insert into public.booking_request_capture_work
(booking_request_id,attempt_id,authorization_claim_id,authorization_claim_generation,payment_lifecycle_id,authorization_logical_operation_id,authorization_physical_attempt_id,capture_logical_operation_id,capture_physical_attempt_id,amount_fils,currency,provider,environment,merchant_id,terminal_id,provider_idempotency_key,request_fingerprint)
values ('60000000-0000-4000-8000-000000001001','70000000-0000-4000-8000-000000001001','72000000-0000-4000-8000-000000001001',1,'73000000-0000-4000-8000-000000001001','73000000-0000-4000-8000-000000001001:authorization','73000000-0000-4000-8000-000000001001:authorization:attempt-1','73000000-0000-4000-8000-000000001001:capture','73000000-0000-4000-8000-000000001001:capture:attempt-2',115000000,'IQD','fictional-payments','local-test','fictional-merchant','fictional-terminal','booking-request-capture:60000000-0000-4000-8000-000000001001:1','6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d');
-- END CAPTURE RECOVERY SOURCE
set local role service_role;
create temp table confirmation_capture_lease as select public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb) result;
create temp table confirmation_capture_result as select public.execute_simulated_booking_request_capture((select result->'permit' from confirmation_capture_lease),'failed') result;
reset role;
-- END CONFIRMATION FIXTURE


set local role service_role;
create temp table recovery_payment_required as
select public.record_booking_request_capture_failure(
  '60000000-0000-4000-8000-000000001001',
  (select (result#>>'{permit,leaseGeneration}')::bigint from confirmation_capture_lease),
  (select (result#>>'{permit,leaseToken}')::uuid from confirmation_capture_lease),
  (select result from confirmation_capture_result)
) result;
reset role;

select no_plan();
create table public.payment_correction_test_clock(instant timestamptz not null);
insert into public.payment_correction_test_clock select payment_required_deadline-interval '1 millisecond' from public.booking_request_capture_work;
create function public.payment_correction_now() returns timestamptz language sql volatile security definer set search_path='' as $$ select instant from public.payment_correction_test_clock $$;
select replace(pg_get_functiondef(procedures.oid),'clock_timestamp()','public.payment_correction_now()')
from pg_proc procedures join pg_namespace namespaces on namespaces.oid=procedures.pronamespace
where namespaces.nspname='public' and procedures.prokind='f' and procedures.prosrc like '%clock_timestamp()%'
  and procedures.proname like '%booking_request%' \gexec
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
create temp table correction_attempt as select public.claim_customer_booking_request_payment_recovery(
 '60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000001001','simulated-replacement') result;
reset role;
grant select on correction_attempt to service_role;
set local role service_role;
select public.execute_simulated_booking_request_payment_recovery(public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from correction_attempt))->'permit','succeeded');
select public.execute_simulated_booking_request_payment_recovery(public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from correction_attempt))->'permit','succeeded');
create temp table correction_capture_permit as select public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from correction_attempt))->'permit' permit;
reset role;
savepoint before_capture;
set local role service_role;
create temp table correction_capture_result as select public.execute_simulated_booking_request_payment_recovery((select permit from correction_capture_permit),'indeterminate') result;
reset role;
update public.payment_correction_test_clock set instant=(select payment_required_deadline from public.booking_request_capture_work);
set local role service_role;
select public.query_simulated_booking_request_payment_recovery((select permit from correction_capture_permit),
 (select result->>'providerRequestId' from correction_capture_result),(select result->>'providerReference' from correction_capture_result),'succeeded');
create temp table correction_prepared as select public.prepare_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001',
 '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}') result;
select is((select result->>'status' from correction_prepared),'refund','capture at the fixed deadline creates a full corrective refund');
select is((select result#>>'{permit,binding,amountFils}' from correction_prepared),'115000000','corrective refund includes booking price and the entire service fee');
reset role;
select is((select count(*) from public.booking_confirmations),0::bigint,'a late capture cannot confirm');
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'every selected Cottage Shift remains held before corrective refund proof');
savepoint late_capture;
set local role service_role;
select public.execute_simulated_booking_request_payment_required_expiry((select result->'permit' from correction_prepared),'succeeded');
select is(public.finalize_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001')->>'status','expired','exact refund and release of the uncaptured original authorization safely expire');
reset role;
select is((select count(*) from public.simulated_payment_provider_operations where operation_kind='refund'),1::bigint,'one refund physical effect');
select is((select count(*) from public.simulated_payment_provider_operations where operation_kind='release'),1::bigint,'captured replacement authorization is consumed, never released after capture');
select is((select count(*) from public.cottage_booking_period_occupancies where active),0::bigint,'safe correction releases the full occupancy set');
-- Late contradictory evidence after release changes money presentation, never inventory ownership.
create temp table released_request as select to_jsonb(requests) snapshot from public.booking_requests requests;
create temp table released_occupancies as select jsonb_agg(to_jsonb(occupancies) order by shift_id,service_day) snapshot from public.cottage_booking_period_occupancies occupancies;
create temp table contradictory_refund_receipt as select ledger.id,jsonb_build_object(
  'receiptId','contradictory-refund','bookingRequestId','60000000-0000-4000-8000-000000001001','providerOperationId',ledger.id,
  'providerIdentity',jsonb_build_object('provider',ledger.provider,'environment',ledger.environment,'merchantId',ledger.merchant_id,'terminalId',ledger.terminal_id),
  'paymentLifecycleId',ledger.payment_lifecycle_id,'logicalOperationId',ledger.logical_operation_id,'physicalAttemptId',ledger.physical_attempt_id,
  'kind','refund','amountFils',115000000,'currency','IQD','providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
  'movementReference',null,'outcome','failed','occurredAt',ledger.authoritative_outcome_at) payload
from public.simulated_payment_provider_operations ledger where ledger.operation_kind='refund';
grant select on contradictory_refund_receipt to service_role;
set local role service_role;
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from contradictory_refund_receipt),(select payload from contradictory_refund_receipt))->>'status','quarantined','contradictory evidence after safe expiry enters durable review');
reset role;
select is((select to_jsonb(requests) from public.booking_requests requests),(select snapshot from released_request),'late evidence does not rewrite the historical expired request');
select is((select jsonb_agg(to_jsonb(occupancies) order by shift_id,service_day) from public.cottage_booking_period_occupancies occupancies),(select snapshot from released_occupancies),'late evidence never reactivates released occupancies');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')#>>'{paymentRequiredExpiry,status}','quarantined-released','released request exposes review without claiming inventory remains held');
reset role;
rollback to late_capture;
set local role service_role;
select public.execute_simulated_booking_request_payment_required_expiry((select result->'permit' from correction_prepared),'indeterminate');
select is(public.finalize_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001')->>'status','quarantined','uncertain refund quarantines permanently');
select is(public.prepare_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001',
 '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')->>'status','quarantined','scheduled retry cannot restart quarantine');
select is(public.execute_simulated_booking_request_payment_required_expiry((select result->'permit' from correction_prepared),'succeeded')->>'outcome','not-executed','stale refund execution is fenced');
select is(public.query_simulated_booking_request_payment_recovery((select permit from correction_capture_permit),
 (select result->>'providerRequestId' from correction_capture_result),(select result->>'providerReference' from correction_capture_result),'succeeded')->>'outcome','not-executed','stale recovery query is fenced');
select is(public.claim_due_booking_request_payment_required_expiries(20,
 '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'),'[]'::jsonb,'quarantine is omitted from scheduled expiry selection');
reset role;
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'quarantine retains every selected Cottage Shift');
select throws_ok($sql$update public.booking_request_payment_required_expiry_work set state='processing',diagnostic_reason=null$sql$,'RC204',null,'quarantine cannot be reset');
select throws_ok($sql$update public.booking_request_payment_required_expiry_work set state=state$sql$,'RC204',null,'even a no-op update cannot rewrite the first quarantine occurrence');
rollback to before_capture;
set local role service_role;
select public.execute_simulated_booking_request_payment_recovery((select permit from correction_capture_permit),'succeeded');
select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',
  public.get_booking_request_payment_recovery_confirmation_evidence((select (result->>'attemptId')::uuid from correction_attempt)));
reset role;
create temp table immutable_confirmation as select to_jsonb(confirmations) snapshot from public.booking_confirmations confirmations;
create temp table immutable_receipts as select jsonb_agg(to_jsonb(receipts) order by receipts.id) snapshot from public.booking_receipts receipts;
create temp table observed_capture as select ledger.id,(select payment_required_deadline from public.booking_request_capture_work) deadline,jsonb_build_object(
  'receiptId','provider-receipt-1','bookingRequestId','60000000-0000-4000-8000-000000001001','providerOperationId',ledger.id,
  'providerIdentity',jsonb_build_object('provider',ledger.provider,'environment',ledger.environment,'merchantId',ledger.merchant_id,'terminalId',ledger.terminal_id),
  'paymentLifecycleId',ledger.payment_lifecycle_id,'logicalOperationId',ledger.logical_operation_id,'physicalAttemptId',ledger.physical_attempt_id,
  'kind','capture','amountFils',115000000,'currency','IQD','providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
  'movementReference',ledger.movement_reference,'outcome','succeeded','occurredAt',to_char(ledger.authoritative_outcome_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) payload
from public.simulated_payment_provider_operations ledger where ledger.operation_kind='capture' and ledger.recovery_attempt_id is not null;
grant select on observed_capture to service_role;
update public.payment_correction_test_clock set instant=(select payment_required_deadline+interval '1 second' from public.booking_request_capture_work);
set local role service_role;
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from observed_capture),(select payload from observed_capture))->>'status','recorded','authoritative D minus 1ms occurrence remains coherent when received after D');
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from observed_capture),(select payload from observed_capture))->>'status','duplicate','identical receipt is idempotent');
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from observed_capture),(select payload||'{"receiptId":"provider-receipt-2"}' from observed_capture))->>'status','recorded','new receipt identity for identical facts is coherent');
reset role;
select is((select count(*) from public.booking_request_payment_correction_observations),2::bigint,'duplicate receipt does not create a second observation or rewrite receipt time');
select is((select status::text from public.cottage_booking_period_commitments),'confirmed_booking','coherent on-time capture retains its active confirmation');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->>'paymentStatus','paid-confirmed','later receipt time does not replace authoritative occurrence time');
reset role;
set local role service_role;
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from observed_capture),
 (select payload||jsonb_build_object('occurredAt',deadline) from observed_capture))->>'status','quarantined','changed receipt with late occurrence quarantines historical confirmation');
reset role;
select is((select to_jsonb(confirmations) from public.booking_confirmations confirmations),(select snapshot from immutable_confirmation),'historical confirmation is preserved byte for byte');
select is((select jsonb_agg(to_jsonb(receipts) order by receipts.id) from public.booking_receipts receipts),(select snapshot from immutable_receipts),'historical receipts remain immutable');
select is((select count(*) from public.booking_request_confirmation_invalidations),1::bigint,'one append-only invalidation removes active confirmation');
select is((select status::text from public.cottage_booking_period_commitments),'pending_hold','invalidated booking is an unconfirmed hold');
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'invalidation retains every selected shift');
select is((select count(*) from public.booking_request_payment_correction_observations where conflict),1::bigint,'changed receipt is preserved as conflict');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->>'paymentStatus','payment-required','Customer active projection is unconfirmed despite immutable confirmation history');
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')#>>'{paymentRequiredExpiry,status}','quarantined','Customer sees review-required state');
select is(public.claim_customer_booking_request_payment_recovery('60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000001001','simulated-replacement')->>'status','quarantined','Customer cannot replay a previous admitted recovery command');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001003',true);
set local role authenticated;
select throws_ok($sql$select public.claim_customer_booking_request_payment_recovery('60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000001001','simulated-replacement')$sql$,'RC404',null,'quarantine fence does not reveal another Customer request');
reset role;
set local role service_role;
select is(public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001','{}')->>'status','quarantined','historical confirmation cannot replay through quarantine');
reset role;

rollback to before_capture;
set local role service_role;
select public.execute_simulated_booking_request_payment_recovery((select permit from correction_capture_permit),'indeterminate');
reset role;
create temp table delayed_observation as select ledger.id,jsonb_build_object(
  'receiptId','delayed-provider-receipt','bookingRequestId','60000000-0000-4000-8000-000000001001','providerOperationId',ledger.id,
  'providerIdentity',jsonb_build_object('provider',ledger.provider,'environment',ledger.environment,'merchantId',ledger.merchant_id,'terminalId',ledger.terminal_id),
  'paymentLifecycleId',ledger.payment_lifecycle_id,'logicalOperationId',ledger.logical_operation_id,'physicalAttemptId',ledger.physical_attempt_id,
  'kind','capture','amountFils',115000000,'currency','IQD','providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
  'movementReference',ledger.movement_reference,'outcome','succeeded','occurredAt',(select payment_required_deadline-interval '1 millisecond' from public.booking_request_capture_work)) payload
from public.simulated_payment_provider_operations ledger where ledger.operation_kind='capture' and ledger.recovery_attempt_id is not null;
grant select on delayed_observation to service_role;
update public.payment_correction_test_clock set instant=(select payment_required_deadline+interval '1 second' from public.booking_request_capture_work);
savepoint unresolved_observation;
set local role service_role;
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from delayed_observation),(select payload from delayed_observation))->>'status','recorded','delayed authoritative success can resolve a previously indeterminate capture with C before D');
select lives_ok($sql$select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',public.get_booking_request_payment_recovery_confirmation_evidence((select (result->>'attemptId')::uuid from correction_attempt)))$sql$,'C before D confirms despite receipt after D');
reset role;
select is((select count(*) from public.booking_confirmations),1::bigint,'delayed coherent success produces one confirmation');
select is((select authoritative_outcome_at from public.simulated_payment_provider_operations where operation_kind='capture' and recovery_attempt_id is not null),(select payment_required_deadline-interval '1 millisecond' from public.booking_request_capture_work),'provider occurrence is retained independently of database receipt');
rollback to unresolved_observation;
set local role service_role;
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from delayed_observation),(select payload||'{"outcome":"indeterminate","occurredAt":null}' from delayed_observation))->>'status','quarantined','unresolved passive observation enters quarantine in its own transaction');
select is(public.query_simulated_booking_request_payment_recovery((select permit from correction_capture_permit),
  (select payload->>'providerRequestId' from delayed_observation),(select payload->>'providerReference' from delayed_observation),'succeeded')->>'outcome','not-executed','unresolved observation immediately fences stale provider reconciliation');
reset role;
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'unresolved observation retains every selected shift');
rollback to before_capture;
reset role;
update public.payment_correction_test_clock set instant=(select payment_required_deadline+interval '1 second' from public.booking_request_capture_work);
create temp table original_capture_conflict as select ledger.id,jsonb_build_object(
  'receiptId','late-original-success','bookingRequestId','60000000-0000-4000-8000-000000001001','providerOperationId',ledger.id,
  'providerIdentity',jsonb_build_object('provider',ledger.provider,'environment',ledger.environment,'merchantId',ledger.merchant_id,'terminalId',ledger.terminal_id),
  'paymentLifecycleId',ledger.payment_lifecycle_id,'logicalOperationId',ledger.logical_operation_id,'physicalAttemptId',ledger.physical_attempt_id,
  'kind','capture','amountFils',115000000,'currency','IQD','providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
  'movementReference','unexpected-late-original-capture','outcome','succeeded','occurredAt',(select payment_required_deadline from public.booking_request_capture_work)) payload
from public.simulated_payment_provider_operations ledger where ledger.operation_kind='capture' and ledger.recovery_attempt_id is null;
grant select on original_capture_conflict to service_role;
set local role service_role;
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from original_capture_conflict),(select payload from original_capture_conflict))->>'status','quarantined','original definitive failure followed by success is a contradiction, never an automatic refund');
reset role;
select is((select current_outcome from public.simulated_payment_provider_operations where id=(select id from original_capture_conflict)),'failed','original definitive failure remains immutable evidence');
select is((select count(*) from public.booking_request_payment_correction_observations where conflict),1::bigint,'contradictory original success is retained alongside the failure');
select is((select count(*) from public.simulated_payment_provider_operations where operation_kind='refund'),0::bigint,'contradictory original capture never creates a refund effect');
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'original conflict retains every selected shift');
select * from finish();
rollback;
