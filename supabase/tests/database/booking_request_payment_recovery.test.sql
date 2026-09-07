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

select plan(49);
select has_table('public','booking_request_payment_recovery_attempts','recovery attempts are durable');
select has_table('public','booking_request_payment_recovery_operations','recovery operations are durable');
select function_privs_are('public','claim_customer_booking_request_payment_recovery',
  array['uuid','uuid','text'],'authenticated',array['EXECUTE'],
  'authenticated Customer may request recovery');
select table_privs_are('public','booking_request_payment_recovery_attempts','authenticated',
  array[]::text[],'authenticated callers cannot inspect private recovery rows');

create function pg_temp.recovery_graph() returns jsonb language sql as $$ select jsonb_build_object('booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_requests rows),
'booking_snapshots',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_snapshots rows),
'booking_request_capture_work',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_capture_work rows),
'booking_request_submission_attempts',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_submission_attempts rows),
'booking_request_authorization_claims',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_authorization_claims rows),
'booking_request_authorization_claim_items',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_authorization_claim_items rows),
'booking_request_authorization_claim_occupancies',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_authorization_claim_occupancies rows),
'booking_request_provider_operation_identities',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_provider_operation_identities rows),
'simulated_payment_provider_operations',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.simulated_payment_provider_operations rows),
'booking_request_payment_recovery_attempts',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_payment_recovery_attempts rows),
'booking_request_payment_recovery_operations',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_payment_recovery_operations rows),
'booking_confirmations',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_confirmations rows),
'booking_receipts',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_receipts rows),
'booking_request_status_notifications',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_status_notifications rows),
'owner_request_notifications',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.owner_request_notifications rows),
'cottage_booking_period_commitments',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.cottage_booking_period_commitments rows),
'cottage_inventory_commitments',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.cottage_inventory_commitments rows),
'cottage_booking_period_occupancies',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.cottage_booking_period_occupancies rows)); $$;
create temp table recovery_before_denial as select pg_temp.recovery_graph() graph;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001003',true);
set local role authenticated;
select throws_ok($$select public.claim_customer_booking_request_payment_recovery(
  '60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000001001',
  'simulated-replacement')$$,'RC404',null,'another Customer receives the same unavailable denial');
reset role;
select is(pg_temp.recovery_graph(),(select graph from recovery_before_denial),'cross-account denial preserves the complete payment, booking, receipt and inventory graph');
select is((select count(*) from public.booking_request_payment_recovery_attempts),0::bigint,
  'cross-account denial writes no recovery attempt');
select is((select count(*) from public.simulated_payment_provider_operations),1::bigint,
  'cross-account denial leaves payment history unchanged');
select is((select status::text from public.cottage_booking_period_commitments),
  'pending_hold','cross-account denial leaves held inventory unchanged');

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
create temp table admitted_recovery as
select public.claim_customer_booking_request_payment_recovery(
  '60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000001001',
  'simulated-replacement') result;
reset role;
select is((select result->>'status' from admitted_recovery),'processing',
  'owning Customer starts recovery before the fixed deadline');
select is((select (result->>'deadline')::timestamptz from admitted_recovery),
  (select payment_required_deadline from public.booking_request_capture_work),
  'recovery preserves the original Payment Required deadline');

select id::text as recovery_attempt_id
from public.booking_request_payment_recovery_attempts \gset

create table public.recovery_expiry_test_clock(instant timestamptz not null);
insert into public.recovery_expiry_test_clock
select payment_required_deadline - interval '1 millisecond'
from public.booking_request_capture_work
where booking_request_id='60000000-0000-4000-8000-000000001001';
create function public.recovery_expiry_test_now()
returns timestamptz language sql volatile security definer set search_path = '' as $$
  select instant from public.recovery_expiry_test_clock;
$$;
create temp table recovery_expiry_original_functions as
select signature,pg_get_functiondef(signature::regprocedure) definition
from (values
  ('public.claim_due_booking_request_payment_required_expiries(integer,jsonb)'),
  ('public.prepare_booking_request_payment_required_expiry(uuid,jsonb)'),
  ('public.claim_customer_booking_request_payment_recovery(uuid,uuid,text)'),
  ('public.lease_booking_request_payment_recovery_step(uuid)'),
  ('public.execute_simulated_booking_request_payment_recovery(jsonb,text)')
) functions(signature);
select replace(
  definition,
  'clock_timestamp()',
  'public.recovery_expiry_test_now()'
)
from recovery_expiry_original_functions \gexec

set local role service_role;
select is(
  public.claim_due_booking_request_payment_required_expiries(
    20,
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ),
  '[]'::jsonb,
  'Payment Required expiry is not admitted one instant before the fixed deadline'
);
create temp table recovery_permit_before_expiry as
select public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid) result;
select is(
  public.prepare_booking_request_payment_required_expiry(
    '60000000-0000-4000-8000-000000001001',
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  )->>'status',
  'not-due',
  'preparation rechecks database time before the fixed deadline'
);
reset role;

savepoint late_replacement_authorization;
set local role service_role;
select public.execute_simulated_booking_request_payment_recovery(
  (select result->'permit' from recovery_permit_before_expiry),'succeeded'
);
create temp table replacement_authorization_before_deadline as
select public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid) result;
reset role;
update public.recovery_expiry_test_clock set instant=(
  select payment_required_deadline from public.booking_request_capture_work
  where booking_request_id='60000000-0000-4000-8000-000000001001'
);
set local role service_role;
select is(
  public.execute_simulated_booking_request_payment_recovery(
    (select result->'permit' from replacement_authorization_before_deadline),'succeeded'
  )->>'outcome',
  'not-executed',
  'replacement Authorization rechecks the deadline at physical execution'
);
reset role;
select is(
  (select count(*) from public.simulated_payment_provider_operations ledger
    where ledger.recovery_attempt_id=:'recovery_attempt_id'::uuid
      and ledger.operation_kind='authorization'),
  0::bigint,
  'late replacement Authorization creates no provider movement'
);
rollback to savepoint late_replacement_authorization;

savepoint expiry_ownership_fence;
set local role service_role;
select public.execute_simulated_booking_request_payment_recovery(
  (select result->'permit' from recovery_permit_before_expiry),'succeeded'
);
select public.execute_simulated_booking_request_payment_recovery(
  public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid)->'permit','succeeded'
);
select public.execute_simulated_booking_request_payment_recovery(
  public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid)->'permit','failed'
);
create temp table replacement_release_before_expiry_ownership as
select public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid) result;
reset role;
update public.recovery_expiry_test_clock set instant=(
  select payment_required_deadline from public.booking_request_capture_work
  where booking_request_id='60000000-0000-4000-8000-000000001001'
);
set local role service_role;
select is(
  jsonb_array_length(public.claim_due_booking_request_payment_required_expiries(
    20,
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  )),
  1,
  'the exact fixed deadline admits due Payment Required expiry work'
);
select is(
  public.prepare_booking_request_payment_required_expiry(
    '60000000-0000-4000-8000-000000001001',
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  )->>'status',
  'release',
  'complete evidence creates one canonical expiry-owned original release target'
);
reset role;
select is(
  (select count(*) from public.booking_request_payment_required_expiry_operations
    where booking_request_id='60000000-0000-4000-8000-000000001001' and owner='expiry'),
  1::bigint,
  'expiry persists one release owner for the original successful Authorization'
);
set local role service_role;
select is(
  public.execute_simulated_booking_request_payment_recovery(
    (select result->'permit' from replacement_release_before_expiry_ownership),'succeeded'
  )->>'outcome',
  'not-executed',
  'a recovery permit issued before the deadline cannot move money after expiry owns release'
);
reset role;
select is(
  (select count(*) from public.simulated_payment_provider_operations
    where recovery_attempt_id=:'recovery_attempt_id'::uuid and operation_kind='release'),
  1::bigint,
  'the fenced replacement release creates no second physical release operation'
);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select throws_ok(
  format(
    'select public.claim_customer_booking_request_payment_recovery(%L,%L,%L)',
    '60000000-0000-4000-8000-000000001001',
    '81000000-0000-4000-8000-000000001002',
    'simulated-replacement'
  ),
  'RC409',null,
  'expiry preparation fences new recovery admission'
);
reset role;
rollback to savepoint expiry_ownership_fence;

savepoint indeterminate_expiry_evidence;
set local role service_role;
select public.execute_simulated_booking_request_payment_recovery(
  public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid)->'permit',
  'indeterminate'
);
reset role;
update public.recovery_expiry_test_clock set instant=(
  select payment_required_deadline from public.booking_request_capture_work
  where booking_request_id='60000000-0000-4000-8000-000000001001'
);
set local role service_role;
select is(
  public.prepare_booking_request_payment_required_expiry(
    '60000000-0000-4000-8000-000000001001',
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  )->>'status',
  'reconcile-recovery',
  'indeterminate release evidence retains inventory for reconciliation'
);
reset role;
select is(
  (select count(*) from public.booking_request_payment_required_expiry_operations
    where booking_request_id='60000000-0000-4000-8000-000000001001' and owner='recovery'),
  1::bigint,
  'expiry reuses the exact indeterminate recovery release identity'
);
rollback to savepoint indeterminate_expiry_evidence;

savepoint all_generation_expiry_evidence;
set local role service_role;
select public.execute_simulated_booking_request_payment_recovery(
  public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid)->'permit','succeeded'
);
select public.execute_simulated_booking_request_payment_recovery(
  public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid)->'permit','succeeded'
);
select public.execute_simulated_booking_request_payment_recovery(
  public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid)->'permit','failed'
);
select public.execute_simulated_booking_request_payment_recovery(
  public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid)->'permit','succeeded'
);
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select public.claim_customer_booking_request_payment_recovery(
  '60000000-0000-4000-8000-000000001001',
  '81000000-0000-4000-8000-000000001002','simulated-replacement'
);
reset role;
select is(
  (select count(*) from public.booking_request_payment_recovery_attempts),
  2::bigint,
  'fixture contains two recovery generations before expiry evaluation'
);
update public.recovery_expiry_test_clock set instant=(
  select payment_required_deadline from public.booking_request_capture_work
  where booking_request_id='60000000-0000-4000-8000-000000001001'
);
set local role service_role;
select is(
  public.prepare_booking_request_payment_required_expiry(
    '60000000-0000-4000-8000-000000001001',
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  )->>'status',
  'ready',
  'complete evidence across all generations proves every Authorization released'
);
reset role;
select is(
  (select count(*) from public.booking_request_payment_required_expiry_operations
    where booking_request_id='60000000-0000-4000-8000-000000001001' and owner='recovery'),
  2::bigint,
  'expiry inventories original and earlier-generation replacement release identities'
);
select is(
  (select count(distinct authorization_payment_lifecycle_id)
    from public.booking_request_payment_required_expiry_operations
    where booking_request_id='60000000-0000-4000-8000-000000001001'),
  2::bigint,
  'the complete inventory keeps both original and replacement Authorization identities'
);
rollback to savepoint all_generation_expiry_evidence;

select throws_ok(
  $$select public.claim_due_booking_request_payment_required_expiries(
    0,'{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  )$$,
  '42501',null,
  'due processing rejects an unbounded batch size'
);
reset role;
set local role service_role;
select is(
  public.claim_due_booking_request_payment_required_expiries(
    20,'{"provider":"foreign","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ),
  '[]'::jsonb,
  'due processing returns no work for a nonmatching provider identity'
);
reset role;

select definition from recovery_expiry_original_functions order by signature \gexec
drop function public.recovery_expiry_test_now();
drop table public.recovery_expiry_test_clock;

savepoint unresolved_release;
set local role service_role;
select public.execute_simulated_booking_request_payment_recovery(
  public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid)->'permit','indeterminate');
select is(public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid)->>'status',
  'reconcile','an unresolved original release is reconciled without another execution');
create temp table reconciling_release as select public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid) result;
select is(public.query_simulated_booking_request_payment_recovery(
  (select result->'permit' from reconciling_release),(select result->>'providerRequestId' from reconciling_release),
  (select result->>'providerReference' from reconciling_release),'succeeded')->>'outcome','succeeded',
  'authoritative reconciliation resolves the persisted original release');
reset role;
select ok((select authoritative_outcome_at > created_at and physical_execution_count=1
  from public.simulated_payment_provider_operations where recovery_attempt_id=:'recovery_attempt_id'::uuid),
  'resolution records its authoritative outcome time without a second physical execution');
set local role service_role;
select is(public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid)#>>'{permit,step}',
  'replacement-authorization','release reconciliation permits the next replacement step');
reset role;
rollback to savepoint unresolved_release;

set local role service_role;
create temp table recovery_release as
select public.lease_booking_request_payment_recovery_step(
  :'recovery_attempt_id'::uuid) result;
select public.execute_simulated_booking_request_payment_recovery(
  (select result->'permit' from recovery_release),'succeeded');
savepoint forged_predecessor;
reset role;
update public.simulated_payment_provider_operations set amount_fils=115000001
where recovery_attempt_id=:'recovery_attempt_id'::uuid;
set local role service_role;
select throws_ok(format('select public.lease_booking_request_payment_recovery_step(%L)',
  :'recovery_attempt_id'::uuid),'RC409',null,'replacement authorization requires exactly bound original release evidence');
rollback to savepoint forged_predecessor;
create temp table recovery_authorize as
select public.lease_booking_request_payment_recovery_step(
  :'recovery_attempt_id'::uuid) result;
select public.execute_simulated_booking_request_payment_recovery(
  (select result->'permit' from recovery_authorize),'succeeded');
create temp table recovery_capture as
select public.lease_booking_request_payment_recovery_step(
  :'recovery_attempt_id'::uuid) result;
savepoint failed_cleanup;
select public.execute_simulated_booking_request_payment_recovery(
  (select result->'permit' from recovery_capture),'failed');
select public.execute_simulated_booking_request_payment_recovery(
  public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid)->'permit','failed');
select is(public.lease_booking_request_payment_recovery_step(:'recovery_attempt_id'::uuid)->>'status',
  'blocked','a failed replacement release never proves the authorization was released');
rollback to savepoint failed_cleanup;
select public.execute_simulated_booking_request_payment_recovery(
  (select result->'permit' from recovery_capture),'succeeded');
reset role;

select results_eq(
  $$select step from public.booking_request_payment_recovery_operations order by created_at,id$$,
  $$values ('original-release'::text),('replacement-authorization'::text),('replacement-capture'::text)$$,
  'provider evidence proves release before replacement authorization and capture');
select is((select state from public.booking_request_payment_recovery_attempts),'succeeded',
  'strictly pre-deadline authoritative replacement success is retained');
select is((select count(*) from public.simulated_payment_provider_operations
  where recovery_attempt_id is not null and amount_fils=115000000),3::bigint,
  'each replacement movement binds the independently worked 115000000 fils total');
select is((select count(*) from public.simulated_payment_provider_operations
  where recovery_attempt_id is not null and physical_execution_count=1),3::bigint,
  'each physical recovery operation executes once');

savepoint broken_inventory;
alter table public.cottage_inventory_commitments disable trigger reject_cottage_inventory_commitment_snapshot_update;
update public.cottage_inventory_commitments set committed_price_iqd=30001
where id='51000000-0000-4000-8000-000000001001';
set local role service_role;
select throws_ok(format('select public.finalize_booking_request_confirmation(''60000000-0000-4000-8000-000000001001'',public.get_booking_request_payment_recovery_confirmation_evidence(%L))',
  :'recovery_attempt_id'::uuid),'RC409',null,
  'recovery rejects inventory prices that differ from the authorization claim');
reset role;
rollback to savepoint broken_inventory;

savepoint exact_deadline;
update public.simulated_payment_provider_operations ledger
set authoritative_outcome_at=work.payment_required_deadline
from public.booking_request_capture_work work
where ledger.recovery_attempt_id is not null and ledger.operation_kind='capture';
update public.booking_request_payment_recovery_operations operations
set authoritative_outcome_at=work.payment_required_deadline
from public.booking_request_capture_work work
where operations.recovery_attempt_id is not null and operations.step='replacement-capture';
set local role service_role;
select throws_ok(format('select public.finalize_booking_request_confirmation(''60000000-0000-4000-8000-000000001001'',public.get_booking_request_payment_recovery_confirmation_evidence(%L))',
  :'recovery_attempt_id'::uuid),'RC409',null,
  'authoritative success exactly at the deadline never confirms');
reset role;
select is((select count(*) from public.booking_confirmations),0::bigint,
  'late authoritative evidence is retained without confirmation');
rollback to savepoint exact_deadline;

set local role service_role;
select lives_ok(format('select public.finalize_booking_request_confirmation(''60000000-0000-4000-8000-000000001001'',public.get_booking_request_payment_recovery_confirmation_evidence(%L))',
  :'recovery_attempt_id'::uuid),
  'pre-deadline authoritative success uses the shared confirmation transaction');
reset role;
select is((select count(*) from public.booking_confirmations),1::bigint,
  'recovery creates one confirmation');
select is((select count(*) from public.booking_receipts),2::bigint,
  'recovery creates the two existing recipient receipts');
select is((select status::text from public.cottage_booking_period_commitments),
  'confirmed_booking','recovery confirms the existing held inventory commitment');
select is(public.booking_request_payment_required_window((select requests from public.booking_requests requests)),null::jsonb,
  'confirmed recovery closes the active Payment Required window');

select throws_ok($$update public.booking_request_payment_recovery_attempts set state='admitted'$$,
  'RC204',null,'completed recovery attempts cannot be reopened');
select is(
  pg_temp.recovery_graph()-array['booking_request_payment_recovery_attempts','booking_request_payment_recovery_operations',
    'simulated_payment_provider_operations','booking_confirmations','booking_receipts','cottage_booking_period_commitments'],
  (select graph from recovery_before_denial)-array['booking_request_payment_recovery_attempts','booking_request_payment_recovery_operations',
    'simulated_payment_provider_operations','booking_confirmations','booking_receipts','cottage_booking_period_commitments'],
  'recovery preserves original submission, snapshots, claims, capture history, notifications, selected units and occupancies');

select * from finish();
rollback;
