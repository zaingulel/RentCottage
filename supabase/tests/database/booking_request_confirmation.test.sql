begin;
select plan(38);

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
create temp table confirmation_capture_result as select public.execute_simulated_booking_request_capture((select result->'permit' from confirmation_capture_lease)) result;
reset role;
-- END CONFIRMATION FIXTURE

select has_function('public','finalize_booking_request_confirmation',array['uuid','jsonb'],'confirmation uses one transaction');
select ok((select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.finalize_booking_request_confirmation(uuid,jsonb)'::regprocedure),'confirmation is security-definer with empty search path');
select ok(has_function_privilege('service_role','public.finalize_booking_request_confirmation(uuid,jsonb)','EXECUTE') and not has_function_privilege('anon','public.finalize_booking_request_confirmation(uuid,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.finalize_booking_request_confirmation(uuid,jsonb)','EXECUTE'),'only service role can finalize');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.booking_confirmations'::regclass,'public.booking_receipts'::regclass)),'outcome relations have RLS');
select ok(not has_table_privilege('service_role','public.booking_confirmations','SELECT') and not has_table_privilege('service_role','public.booking_receipts','SELECT'),'application roles have no direct outcome access');
set local role anon;
select throws_ok($$select public.finalize_booking_request_confirmation(null,null)$$,'42501',null,'anonymous callers cannot finalize');
select throws_ok($$select count(*) from public.booking_confirmations cross join public.booking_receipts$$,'42501',null,'anonymous callers cannot read private outcomes');
reset role;
set local role authenticated;
select throws_ok($$select public.finalize_booking_request_confirmation(null,null)$$,'42501',null,'authenticated callers cannot finalize');
select throws_ok($$select count(*) from public.booking_confirmations cross join public.booking_receipts$$,'42501',null,'authenticated callers cannot read private outcomes');
reset role;

set local role service_role;
select throws_ok($$select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001','{}'::jsonb)$$,'RC409',null,'provider success before completed Capture persistence cannot finalize');
reset role;
select ok((select state from public.booking_request_capture_work)='processing' and (select status from public.cottage_booking_period_commitments)='pending_hold' and not exists(select 1 from public.booking_confirmations) and not exists(select 1 from public.booking_receipts),'out-of-order evidence leaves Capture and booking outcome unchanged');
set local role service_role;
create temp table confirmation_capture as select public.complete_booking_request_capture('60000000-0000-4000-8000-000000001001',1,(select (result#>>'{permit,leaseToken}')::uuid from confirmation_capture_lease),(select result from confirmation_capture_result)) result;
reset role;

set local role service_role;
select throws_ok($$select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',(select (result->'snapshot')||'{"capturePhysicalAttemptId":"replaced:capture:attempt-2"}'::jsonb from confirmation_capture))$$,'RC409',null,'replaced Capture identity is rejected');
select throws_ok($$select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',(select jsonb_set(result->'snapshot','{providerIdentity,merchantId}','"replaced-merchant"') from confirmation_capture))$$,'RC409',null,'caller Capture snapshot must match authoritative provider binding exactly');
reset role;
select is((select count(*) from public.booking_confirmations),0::bigint,'rejected Capture writes no outcome');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000001002', true);
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->>'paymentStatus', 'capture-processing', 'Capture complete without confirmation still projects pending confirmation');
savepoint substituted_snapshot;
insert into public.booking_snapshots select '40000000-0000-4000-8000-000000001002'::uuid,'10000000-0000-4000-8000-000000001003'::uuid,profile_id,quote_fingerprint,intent_fingerprint,quote_payload,intent_payload,booking_terms_version,booking_terms_locale,booking_terms_body,booking_terms_sha256,cancellation_policy_version,acceptance_locale,acceptance_evidence,acceptance_evidence_fingerprint,marketplace_commission_rate_basis_points,marketplace_commission_amount_fils,created_at from public.booking_snapshots where id='40000000-0000-4000-8000-000000001001';
update public.booking_requests set booking_snapshot_id='40000000-0000-4000-8000-000000001002' where id='60000000-0000-4000-8000-000000001001';
set local role service_role;
select throws_ok($$select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',(select result->'snapshot' from confirmation_capture))$$,'RC409',null,'valid but substituted Booking Snapshot is rejected');
reset role;
select is((select count(*) from public.booking_confirmations),0::bigint,'substituted graph writes no outcome');
rollback to savepoint substituted_snapshot;

savepoint substituted_commitment;
insert into public.cottage_booking_period_commitments
(id,customer_user_id,profile_id,schedule_revision_id,commitment_reference,status,access_ranges)
values ('50000000-0000-4000-8000-000000001002','10000000-0000-4000-8000-000000001003','20000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001','SUBSTITUTED-HOLD-2','pending_hold','{["2101-01-01 05:00+00","2101-01-01 09:00+00")}'::tstzmultirange);
update public.booking_requests set booking_period_commitment_id='50000000-0000-4000-8000-000000001002' where id='60000000-0000-4000-8000-000000001001';
set local role service_role;
select throws_ok($$select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',(select result->'snapshot' from confirmation_capture))$$,'RC409',null,'valid but substituted commitment is rejected');
reset role;
select is((select count(*) from public.booking_confirmations),0::bigint,'substituted commitment writes no outcome');
rollback to savepoint substituted_commitment;

savepoint substituted_total;
alter table public.booking_snapshots disable trigger reject_booking_snapshot_update;
update public.booking_snapshots set quote_payload=jsonb_set(quote_payload,'{customerTotalIqd}','114999') where id='40000000-0000-4000-8000-000000001001';
update public.booking_request_submission_attempts set quote_payload=jsonb_set(quote_payload,'{customerTotalIqd}','114999') where id='70000000-0000-4000-8000-000000001001';
set local role service_role;
select throws_ok($$select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',(select result->'snapshot' from confirmation_capture))$$,'RC409',null,'preserved Booking Snapshot Customer Total must equal captured amount');
reset role;
select is((select count(*) from public.booking_confirmations),0::bigint,'substituted Customer Total writes no outcome');
rollback to savepoint substituted_total;

savepoint missing_bundle_component;
delete from public.cottage_booking_period_occupancies where shift_id='32000000-0000-4000-8000-000000001002' and service_day='2101-01-02';
delete from public.booking_request_authorization_claim_occupancies where shift_id='32000000-0000-4000-8000-000000001002' and service_day='2101-01-02';
set local role service_role;
select throws_ok($$select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',(select result->'snapshot' from confirmation_capture))$$,'RC409',null,'missing Full-Day Bundle component is rejected while other shifts remain active');
reset role;
rollback to savepoint missing_bundle_component;

create function pg_temp.fail_owner_receipt() returns trigger language plpgsql as $$begin
  if new.recipient_role='cottage_owner' then raise exception 'injected second receipt failure'; end if;
  return new;
end$$;
create trigger fail_owner_receipt before insert on public.booking_receipts for each row execute function pg_temp.fail_owner_receipt();
set local role service_role;
select throws_ok($$select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',(select result->'snapshot' from confirmation_capture))$$,'P0001','injected second receipt failure','second receipt failure rolls back the complete outcome');
reset role;
select ok((select status from public.cottage_booking_period_commitments)='pending_hold' and not exists(select 1 from public.booking_confirmations) and not exists(select 1 from public.booking_receipts),'receipt failure leaves no partial outcome');
drop trigger fail_owner_receipt on public.booking_receipts;

set local role service_role;
create temp table confirmation_outcome as select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',(select result->'snapshot' from confirmation_capture)) result;
reset role;
select is((select status::text from public.cottage_booking_period_commitments),'confirmed_booking','existing Pending Hold becomes Confirmed Booking');
select is((select count(*) from public.cottage_booking_period_commitments),1::bigint,'confirmation creates no second commitment');
select is((select count(*) from public.booking_confirmations),1::bigint,'one confirmation is persisted');
select is((select count(*) from public.booking_receipts),2::bigint,'exactly two receipts are persisted');
select results_eq($$select recipient_role,recipient_user_id from public.booking_receipts order by recipient_role$$,$$values ('cottage_owner'::text,'10000000-0000-4000-8000-000000001001'::uuid),('customer'::text,'10000000-0000-4000-8000-000000001002'::uuid)$$,'receipts bind Customer and Cottage Owner');
select results_eq($$select shift_id,service_day from public.cottage_booking_period_occupancies where active order by service_day,shift_id$$,$$values ('32000000-0000-4000-8000-000000001001'::uuid,'2101-01-01'::date),('32000000-0000-4000-8000-000000001003'::uuid,'2101-01-01'::date),('32000000-0000-4000-8000-000000001001'::uuid,'2101-01-02'::date),('32000000-0000-4000-8000-000000001002'::uuid,'2101-01-02'::date),('32000000-0000-4000-8000-000000001003'::uuid,'2101-01-02'::date)$$,'all individual, bundle, and cross-midnight occupancies remain active');
select throws_ok($$insert into public.cottage_booking_period_commitments (customer_user_id,profile_id,schedule_revision_id,commitment_reference,status,access_ranges) values ('10000000-0000-4000-8000-000000001002','20000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001','OVERLAPPING-CUSTOMER','pending_hold','{["2101-01-02 06:00+00","2101-01-02 07:00+00")}'::tstzmultirange)$$,'23P01',null,'confirmed Customer access continues to reject overlap');
insert into public.cottage_booking_period_commitments (id,customer_user_id,profile_id,schedule_revision_id,commitment_reference,status,access_ranges) values ('50000000-0000-4000-8000-000000001003','10000000-0000-4000-8000-000000001003','20000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001','COMPETING-COTTAGE','pending_hold','{["2101-02-01 05:00+00","2101-02-01 06:00+00")}'::tstzmultirange);
select throws_ok($$insert into public.cottage_booking_period_occupancies (booking_period_commitment_id,schedule_revision_id,shift_id,service_day,active) values ('50000000-0000-4000-8000-000000001003','30000000-0000-4000-8000-000000001001','32000000-0000-4000-8000-000000001001','2101-01-01',true)$$,'23505',null,'confirmed Cottage Shift occupancy continues to reject competition');
select is((select result->>'bookingReference' from confirmation_outcome),'CONFIRMATION-HOLD-1','existing unique booking reference is retained');
select is((select result->>'capturePhysicalAttemptId' from confirmation_outcome),'73000000-0000-4000-8000-000000001001:capture:attempt-2','outcome returns authoritative Capture identity');
select is((select result->>'captureMovementReference' from confirmation_outcome),(select movement_reference from public.simulated_payment_provider_operations where operation_kind='capture'),'outcome returns authoritative movement');
set local role service_role;
select is(public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',(select result->'snapshot' from confirmation_capture)),(select result from confirmation_outcome),'replay returns exact stored outcome');
reset role;
select ok((select count(*) from public.booking_confirmations)=1 and (select count(*) from public.booking_receipts)=2 and not exists(select 1 from public.booking_request_release_work),'replay creates no duplicates or release work');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000001002', true);
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->>'paymentStatus', 'paid-confirmed', 'Confirmed capture and promoted commitment project paid confirmation');
select * from finish();
rollback;
