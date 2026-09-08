begin;

select no_plan();

-- Sequence ownership is private independently of table permissions.
select ok(not has_sequence_privilege(role_name,pg_get_serial_sequence('public.booking_request_payment_history','sequence'),privilege_name),
  role_name || ' has no history sequence ' || privilege_name || ' entitlement')
from unnest(array['anon','authenticated','service_role']) roles(role_name)
cross join unnest(array['SELECT','USAGE','UPDATE']) privileges(privilege_name);
select ok(not exists(select 1 from pg_class sequences cross join lateral aclexplode(coalesce(sequences.relacl,acldefault('S',sequences.relowner))) grants
  where sequences.oid=pg_get_serial_sequence('public.booking_request_payment_history','sequence')::regclass and grants.grantee=0),
  'PUBLIC has no history sequence entitlement');


insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values (
  '10000000-0000-4000-8000-000000001370',
  'authenticated',
  'authenticated',
  '+9647500001370',
  now()
);
insert into public.account_contexts (user_id, role)
values (
  '10000000-0000-4000-8000-000000001370',
  'platform_administrator'
);

-- BEGIN HISTORY BROWSER FIXTURE
insert into auth.users (id, aud, role, phone, phone_confirmed_at) values
('10000000-0000-4000-8000-000000001371','authenticated','authenticated','+9647500001371',now()),
('10000000-0000-4000-8000-000000001372','authenticated','authenticated','+9647500001372',now());
insert into public.account_contexts (user_id, role, owner_approval_state) values
('10000000-0000-4000-8000-000000001371','cottage_owner','approved'),
('10000000-0000-4000-8000-000000001372','customer',null);
insert into public.owner_application_cottage_profiles
(id,owner_user_id,name,governorate,approximate_location,exact_address,capacity,bedrooms,bathrooms,amenities,source_language,description,house_rules,status)
values ('20000000-0000-4000-8000-000000001371','10000000-0000-4000-8000-000000001371','History Cottage','Baghdad','Karrada','Sensitive exact address',8,3,2,array['garden'],'en','Fixture description','Fixture rules','draft');
insert into public.cottage_shift_schedule_revisions (id,profile_id,revision,full_day_bundle_id)
values ('30000000-0000-4000-8000-000000001371','20000000-0000-4000-8000-000000001371',1,'31000000-0000-4000-8000-000000001371');
select set_config('rentcottage.shift_schedule_write_revision_id','30000000-0000-4000-8000-000000001371',true);
insert into public.cottage_shifts (id,schedule_revision_id,position,name,start_time,end_time)
values
('32000000-0000-4000-8000-000000001371','30000000-0000-4000-8000-000000001371',1,'Morning','08:00','12:00'),
('32000000-0000-4000-8000-000000001372','30000000-0000-4000-8000-000000001371',2,'Evening','14:00','18:00');
select set_config('rentcottage.shift_schedule_write_revision_id','',true);
insert into public.booking_snapshots
(id,customer_user_id,profile_id,quote_fingerprint,intent_fingerprint,quote_payload,intent_payload,booking_terms_version,booking_terms_locale,booking_terms_body,booking_terms_sha256,cancellation_policy_version,acceptance_locale,acceptance_evidence,acceptance_evidence_fingerprint,marketplace_commission_rate_basis_points,marketplace_commission_amount_fils,created_at)
values ('40000000-0000-4000-8000-000000001371','10000000-0000-4000-8000-000000001372','20000000-0000-4000-8000-000000001371',repeat('a',64),repeat('b',64),
'{"bookingPriceIqd":100000,"serviceFeeIqd":5000,"customerTotalIqd":105000,"items":[{"serviceDay":"2101-01-01","kind":"shift","position":1}]}'::jsonb,
'{"customerName":"Sensitive Customer","partySize":4}'::jsonb,'history-test-v1','en','Fictional terms',repeat('c',64),'fictional-cancellation-v1','en','{}'::jsonb,repeat('d',64),1000,10000000,'2100-12-31 12:00+00');
insert into public.cottage_booking_period_commitments
(id,customer_user_id,profile_id,schedule_revision_id,commitment_reference,status,access_ranges,created_at)
values ('50000000-0000-4000-8000-000000001371','10000000-0000-4000-8000-000000001372','20000000-0000-4000-8000-000000001371','30000000-0000-4000-8000-000000001371','HISTORY-HOLD-137','pending_hold','{["2101-01-01 05:00+00","2101-01-01 09:00+00")}'::tstzmultirange,'2100-12-31 11:59:59+00');
insert into public.cottage_inventory_commitments
(id,unit_kind,unit_id,service_day,committed_price_iqd,booking_period_commitment_id)
values ('51000000-0000-4000-8000-000000001371','shift','32000000-0000-4000-8000-000000001371','2101-01-01',100000,'50000000-0000-4000-8000-000000001371');
insert into public.cottage_booking_period_occupancies
(booking_period_commitment_id,schedule_revision_id,shift_id,service_day,active)
values ('50000000-0000-4000-8000-000000001371','30000000-0000-4000-8000-000000001371','32000000-0000-4000-8000-000000001371','2101-01-01',true);
insert into public.booking_requests
(id,booking_request_reference,customer_user_id,owner_user_id,profile_id,booking_snapshot_id,booking_period_commitment_id,payment_lifecycle_id,customer_name,party_size,status,response_deadline,created_at)
values ('60000000-0000-4000-8000-000000001371','RC-REQ-0000000000000137','10000000-0000-4000-8000-000000001372','10000000-0000-4000-8000-000000001371','20000000-0000-4000-8000-000000001371','40000000-0000-4000-8000-000000001371','50000000-0000-4000-8000-000000001371','73000000-0000-4000-8000-000000001371','Sensitive Customer',4,'pending','2100-12-31 16:00+00','2100-12-31 12:00+00');

select public.append_booking_request_payment_history(
  '73000000-0000-4000-8000-000000001371','60000000-0000-4000-8000-000000001371',
  'physical-attempt','provider-operation','observed','capture','logical-137','physical-137',1,null,null,null,'succeeded','attacker supplied reason',
  '74000000-0000-4000-8000-000000001371','secret-card-reference','merchant-secret-value','raw-provider-token',105000000,
  '2100-12-31 14:00+00',null,'2100-12-31 14:00+00'
);
select public.append_booking_request_payment_history(
  '73000000-0000-4000-8000-000000001371','60000000-0000-4000-8000-000000001371',
  'retry','capture-work','observed','capture','logical-137','physical-137',2,null,'processing','processing','retrying',null,
  null,null,null,null,105000000,'2100-12-31 13:00+00',null,'2100-12-31 15:00+00'
);
-- END HISTORY BROWSER FIXTURE

select has_table(
  'public',
  'booking_request_payment_history',
  'payment support history is retained in its own private table'
);

select has_function(
  'public',
  'get_administrator_booking_request_payment_history',
  array['text'],
  'AAL2 administrators have one support-safe payment history boundary'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000001370","role":"authenticated","aal":"aal1"}',
  true
);
set local role authenticated;

select throws_ok(
  $$select public.get_administrator_booking_request_payment_history('RC-REQ-FFFFFFFFFFFFFFFF')$$,
  '42501',
  'AAL2 Platform Administrator access is required',
  'AAL1 administrators are denied before an unknown reference is looked up'
);

select throws_ok(
  $$select * from public.booking_request_payment_history$$,
  '42501',
  null,
  'authenticated administrators cannot read private base history records'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000001370","role":"authenticated","aal":"aal2"}',
  true
);

select is(
  public.get_administrator_booking_request_payment_history(
    'RC-REQ-FFFFFFFFFFFFFFFF'
  ),
  null::jsonb,
  'AAL2 unknown references return no support history'
);

reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000001370","role":"authenticated","aal":"aal2"}',
  true
);
set local role authenticated;
create temp table visible_history as
select public.get_administrator_booking_request_payment_history('RC-REQ-0000000000000137') result;
reset role;

select is((select result->>'bookingRequestReference' from visible_history),'RC-REQ-0000000000000137','the support result identifies only the opaque Booking Request reference');
select is((select result->>'historyCoverage' from visible_history),'complete','a root created after installation has complete coverage');
select is((select jsonb_array_length(result->'events') from visible_history),3,'earlier events are retained when a retry is appended');
select is((select result#>>'{events,1,providerRequestId}' from visible_history),'reference-unavailable','unsafe provider request references are replaced rather than truncated');
select is((select result#>>'{events,1,reasonCode}' from visible_history),'unclassified-evidence','unknown reason text is replaced by a finite classification');
select is((select result#>>'{events,1,amountFils}' from visible_history),'105000000','money is a decimal string in fils');
select is((select result#>>'{events,1,currency}' from visible_history),'IQD','money carries its fixed currency');
select is((select result#>>'{events,1,providerOccurredAt}' from visible_history),'2100-12-31T14:00:00+00:00','provider occurrence is returned separately from recording time');
select is((select (result#>>'{events,1,id}')::uuid from visible_history),(select id from public.booking_request_payment_history where payment_lifecycle_id='73000000-0000-4000-8000-000000001371' order by sequence offset 1 limit 1),'the immutable event UUID is the support reference');
select ok((select (result#>>'{events,1,providerOccurredAt}')::timestamptz > (result#>>'{events,2,providerOccurredAt}')::timestamptz from visible_history),'sequence order does not change when provider occurrence times are reversed');
select ok((select result::text not like '%Sensitive Customer%' and result::text not like '%merchant-secret-value%' and result::text not like '%raw-provider-token%' and result::text not like '%secret-card-reference%' from visible_history),'the real output excludes customer data, credentials, tokens and unsafe references');

select throws_ok(
  $$update public.booking_request_payment_history set outcome='failed' where logical_operation_id='logical-137'$$,
  'RC204',
  'Booking Request payment history is immutable',
  'earlier history cannot be overwritten'
);



-- Public role boundaries and the complete allowlisted response shape.
set local role anon;
select throws_ok($$select public.get_administrator_booking_request_payment_history('RC-REQ-0000000000000137')$$,'42501',null,'anonymous access is denied');
reset role;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001371","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select throws_ok($$select public.get_administrator_booking_request_payment_history('RC-REQ-FFFFFFFFFFFFFFFF')$$,'42501','AAL2 Platform Administrator access is required','an AAL2 Cottage Owner is denied before reference lookup');
reset role;
set local role service_role;
select throws_ok($$select * from public.booking_request_payment_history$$,'42501',null,'service credentials cannot directly read private history');
select throws_ok($$select public.append_booking_request_payment_history('73000000-0000-4000-8000-000000001371',null,'retry','capture-work','observed')$$,'42501',null,'service credentials cannot append invented support evidence');
reset role;
select is((select result-array['bookingRequestReference','simulated','current','historyCoverage','events'] from visible_history),'{}'::jsonb,'top-level support output has only the allowed fields');
select ok((select bool_and(event-array['id','kind','source','provenance','operationKind','logicalOperationId','physicalAttemptId','operationGeneration','recoveryGeneration','fromState','toState','outcome','reasonCode','providerOperationId','providerRequestId','providerReference','movementReference','amountFils','currency','providerOccurredAt','receivedAt','sourceRecordedAt','recordedAt']='{}'::jsonb) from visible_history,jsonb_array_elements(result->'events') event),'every event has only the finite operational projection fields');
select is((select result#>>'{events,1,logicalOperationId}' from visible_history),'reference-unavailable','noncanonical logical identities cannot leak unbounded source content');
select is((select result#>>'{events,1,physicalAttemptId}' from visible_history),'reference-unavailable','noncanonical physical identities cannot leak unbounded source content');

-- The following fixture and calls reuse the established correction scenario.
-- All writes and any provider facts are local to this rollback transaction.


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


savepoint history_retry;
update public.booking_request_capture_work set lease_expires_at=clock_timestamp()-interval '1 second' where booking_request_id='60000000-0000-4000-8000-000000001001';
set local role service_role;
select public.claim_due_booking_request_captures(20,'{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}');
reset role;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001370","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.get_administrator_booking_request_payment_history('RC-REQ-0000000000001001')->'events') event where event->>'kind'='retry' and event->>'operationKind'='capture' and event->>'operationGeneration'='2'),'real capture reclamation is a retry with its new ownership generation');
reset role;
select is((select count(*) from public.simulated_payment_provider_operations where claim_id='72000000-0000-4000-8000-000000001001'),1::bigint,'capture reclamation does not execute another payment');
rollback to history_retry;
set local role service_role;
create temp table recovery_payment_required as
select public.record_booking_request_capture_failure(
  '60000000-0000-4000-8000-000000001001',
  (select (result#>>'{permit,leaseGeneration}')::bigint from confirmation_capture_lease),
  (select (result#>>'{permit,leaseToken}')::uuid from confirmation_capture_lease),
  (select result from confirmation_capture_result)
) result;
reset role;


savepoint history_payment_required;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select throws_ok($$select public.get_administrator_booking_request_payment_history('RC-REQ-0000000000001001')$$,'42501','AAL2 Platform Administrator access is required','a Customer at AAL2 cannot read support history');
create temp table history_recovery as select public.claim_customer_booking_request_payment_recovery('60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000001001','simulated-replacement') result;
reset role;
grant select on history_recovery to service_role;
set local role service_role;
select public.execute_simulated_booking_request_payment_recovery(public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from history_recovery))->'permit','succeeded');
select public.execute_simulated_booking_request_payment_recovery(public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from history_recovery))->'permit','succeeded');
create temp table history_capture_permit as select public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from history_recovery))->'permit' permit;
select public.execute_simulated_booking_request_payment_recovery((select permit from history_capture_permit),'succeeded');
select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',public.get_booking_request_payment_recovery_confirmation_evidence((select (result->>'attemptId')::uuid from history_recovery)));
reset role;
select is((select count(*) from public.simulated_payment_provider_operations where claim_id='72000000-0000-4000-8000-000000001001'),4::bigint,'capture failure and three recovery steps produce four physical executions');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001370","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
create temp table before_correction_history as select public.get_administrator_booking_request_payment_history('RC-REQ-0000000000001001') result;
reset role;
select is((select count(*) from before_correction_history,jsonb_array_elements(result->'events') event where event->>'kind'='physical-attempt'),4::bigint,'real provider executions appear once under the original request even for replacement lifecycles');
select ok((select exists(select 1 from jsonb_array_elements(result->'events') event where event->>'source'='capture-work' and event->>'fromState'='processing' and event->>'toState'='payment_required' and event->>'operationKind'='capture') from before_correction_history),'capture failure retains its transition and operation identity');
select ok((select exists(select 1 from jsonb_array_elements(result->'events') event where event->>'source'='confirmation' and event->>'kind'='terminal-outcome' and event->>'toState'='confirmed' and event->>'outcome'='succeeded') from before_correction_history),'confirmation retains a meaningful terminal outcome');
create temp table observed_capture as select ledger.id,(select payment_required_deadline from public.booking_request_capture_work) deadline,jsonb_build_object(
  'receiptId','provider-receipt-1','bookingRequestId','60000000-0000-4000-8000-000000001001','providerOperationId',ledger.id,
  'providerIdentity',jsonb_build_object('provider',ledger.provider,'environment',ledger.environment,'merchantId',ledger.merchant_id,'terminalId',ledger.terminal_id),
  'paymentLifecycleId',ledger.payment_lifecycle_id,'logicalOperationId',ledger.logical_operation_id,'physicalAttemptId',ledger.physical_attempt_id,
  'kind','capture','amountFils',115000000,'currency','IQD','providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
  'movementReference',ledger.movement_reference,'outcome','succeeded','occurredAt',to_char(ledger.authoritative_outcome_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) payload
from public.simulated_payment_provider_operations ledger where ledger.operation_kind='capture' and ledger.recovery_attempt_id is not null;
grant select on observed_capture to service_role;

set local role service_role;
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from observed_capture),(select payload from observed_capture))->>'status','recorded','a real canonical receipt is accepted');
reset role;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001370","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
create temp table after_receipt_history as select public.get_administrator_booking_request_payment_history('RC-REQ-0000000000001001') result;
reset role;
select ok((select exists(select 1 from jsonb_array_elements(result->'events') event where event->>'source'='provider-receipt' and event->>'operationKind'='capture' and event->>'physicalAttemptId'=(select payload->>'physicalAttemptId' from observed_capture) and (event->>'providerOccurredAt')::timestamptz=(select (payload->>'occurredAt')::timestamptz from observed_capture) and event ? 'receivedAt') from after_receipt_history),'receipt history preserves canonical operation identity and separate occurrence and arrival clocks');

-- Repeated arrivals are support evidence, not another provider execution or receipt.
create function pg_temp.payment_arrival_sources() returns jsonb language sql as $$
select jsonb_object_agg(name,rows) from (
select 'booking_requests' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_requests rows
union all
select 'booking_snapshots' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_snapshots rows
union all
select 'booking_request_capture_work' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_request_capture_work rows
union all
select 'booking_request_submission_attempts' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_request_submission_attempts rows
union all
select 'booking_request_authorization_claims' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_request_authorization_claims rows
union all
select 'simulated_payment_provider_operations' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.simulated_payment_provider_operations rows
union all
select 'booking_request_payment_recovery_attempts' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_request_payment_recovery_attempts rows
union all
select 'booking_request_payment_recovery_operations' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_request_payment_recovery_operations rows
union all
select 'booking_request_payment_required_expiry_work' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_request_payment_required_expiry_work rows
union all
select 'booking_request_payment_required_expiry_operations' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_request_payment_required_expiry_operations rows
union all
select 'booking_request_release_work' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_request_release_work rows
union all
select 'booking_request_release_operations' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_request_release_operations rows
union all
select 'booking_request_payment_correction_observations' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_request_payment_correction_observations rows
union all
select 'booking_confirmations' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_confirmations rows
union all
select 'booking_receipts' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_receipts rows
union all
select 'booking_request_confirmation_invalidations' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.booking_request_confirmation_invalidations rows
union all
select 'cottage_booking_period_commitments' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.cottage_booking_period_commitments rows
union all
select 'cottage_booking_period_occupancies' name,coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) rows from public.cottage_booking_period_occupancies rows
) sources;
$$;
select is((select count(*) from after_receipt_history,jsonb_array_elements(result->'events') event where event->>'source'='provider-receipt'),1::bigint,'a persisted canonical receipt emits exactly one arrival');
create temp table duplicate_sources as select pg_temp.payment_arrival_sources() result,clock_timestamp() starts_at;
set local role service_role;
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from observed_capture),(select payload from observed_capture))->>'status','duplicate','the first canonical repeat keeps the duplicate decision');
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from observed_capture),(select payload from observed_capture))->>'status','duplicate','another canonical repeat keeps the duplicate decision');
reset role;
select is(pg_temp.payment_arrival_sources(),(select result from duplicate_sources),'duplicate arrivals preserve all eighteen payment source tables exactly');
set local role authenticated;
create temp table after_duplicates_history as select public.get_administrator_booking_request_payment_history('RC-REQ-0000000000001001') result;
reset role;
select is((select count(*) from after_duplicates_history,jsonb_array_elements(result->'events') event where event->>'source'='provider-receipt' and event->>'outcome'='duplicate'),2::bigint,'every canonical repeat has its own support arrival');
select is((select count(*) from after_duplicates_history,jsonb_array_elements(result->'events') event where event->>'source'='provider-receipt'),3::bigint,'one canonical receipt and two repeats are three arrivals without double recording');
select is((select count(distinct event->>'id') from after_duplicates_history,jsonb_array_elements(result->'events') event where event->>'outcome'='duplicate'),2::bigint,'repeated arrivals have distinct immutable support identities');
select is((select jsonb_agg(event order by ordinal) from after_duplicates_history,jsonb_array_elements(result->'events') with ordinality events(event,ordinal) where ordinal <= (select jsonb_array_length(result->'events') from after_receipt_history)),(select result->'events' from after_receipt_history),'duplicate arrivals append without rewriting the canonical history prefix');
select ok((select bool_and(event->>'providerOperationId'=(select id::text from observed_capture) and event->>'logicalOperationId'=(select payload->>'logicalOperationId' from observed_capture) and event->>'physicalAttemptId'=(select payload->>'physicalAttemptId' from observed_capture) and event->>'amountFils'='115000000' and event->>'currency'='IQD' and not(event ? 'providerOccurredAt') and not(event ? 'sourceRecordedAt') and (event->>'receivedAt')::timestamptz >= (select starts_at from duplicate_sources) and (event->>'recordedAt')::timestamptz >= (event->>'receivedAt')::timestamptz) from after_duplicates_history,jsonb_array_elements(result->'events') event where event->>'outcome'='duplicate'),'duplicate arrivals use canonical source identity and actual arrival clocks without inventing occurrence');

savepoint malformed_arrivals;
create temp table malformed_window as select clock_timestamp() starts_at;
set local role service_role;
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from observed_capture),(select payload||'{"signature":"arrival-private-signature","logicalOperationId":"arrival-private-logical","physicalAttemptId":"arrival-private-attempt","providerReference":"arrival-private-reference","amountFils":1,"occurredAt":"1900-01-01T00:00:00Z"}'::jsonb from observed_capture))->>'status','quarantined','a malformed arrival preserves the existing quarantine decision');
reset role;
create temp table malformed_sources as select pg_temp.payment_arrival_sources() result;
set local role service_role;
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from observed_capture),(select payload||'{"signature":"arrival-private-signature","logicalOperationId":"arrival-private-logical","physicalAttemptId":"arrival-private-attempt","providerReference":"arrival-private-reference","amountFils":1,"occurredAt":"1900-01-01T00:00:00Z"}'::jsonb from observed_capture))->>'status','quarantined','a repeated malformed arrival preserves sticky quarantine');
reset role;
select is(pg_temp.payment_arrival_sources(),(select result from malformed_sources),'repeated malformed arrivals preserve all eighteen quarantined payment source tables exactly');
set local role authenticated;
create temp table after_malformed_history as select public.get_administrator_booking_request_payment_history('RC-REQ-0000000000001001') result;
reset role;
select is((select count(*) from after_malformed_history,jsonb_array_elements(result->'events') event where event->>'source'='provider-receipt' and event->>'outcome'='malformed'),2::bigint,'every malformed repeat has one visible arrival even after quarantine');
select is((select result#>>'{current,reasonCode}' from after_malformed_history),'malformed-provider-observation','current support state retains the safe malformed reason');
select ok((select bool_and(event->>'reasonCode'='malformed-provider-observation' and event->>'providerOperationId'=(select id::text from observed_capture) and event->>'logicalOperationId'=(select payload->>'logicalOperationId' from observed_capture) and event->>'physicalAttemptId'=(select payload->>'physicalAttemptId' from observed_capture) and event->>'amountFils'='115000000' and not(event ? 'providerOccurredAt') and not(event ? 'sourceRecordedAt') and (event->>'receivedAt')::timestamptz >= (select starts_at from malformed_window) and (event->>'recordedAt')::timestamptz >= (event->>'receivedAt')::timestamptz) from after_malformed_history,jsonb_array_elements(result->'events') event where event->>'outcome'='malformed'),'malformed arrivals retain a safe reason and canonical identity instead of attacker fields or clocks');
select ok((select result::text not like '%arrival-private-%' and result::text not like '%1900-01-01%' from after_malformed_history),'malformed payload signatures references and claimed occurrence never enter the support response');
select is((select jsonb_agg(event order by ordinal) from after_malformed_history,jsonb_array_elements(result->'events') with ordinality events(event,ordinal) where ordinal <= (select jsonb_array_length(result->'events') from after_duplicates_history)),(select result->'events' from after_duplicates_history),'malformed arrivals and quarantine preserve the entire previous immutable prefix');
select is((select count(*) from public.booking_request_payment_correction_observations where booking_request_id='60000000-0000-4000-8000-000000001001'),1::bigint,'malformed arrivals do not create persisted canonical receipts');
select is((select count(*) from public.simulated_payment_provider_operations where claim_id='72000000-0000-4000-8000-000000001001'),4::bigint,'malformed arrivals never cause another physical payment execution');
select is((select count(*) from public.booking_receipts),2::bigint,'quarantine retains the original two booking receipts');
rollback to malformed_arrivals;

set local role service_role;
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from observed_capture),(select payload||'{"outcome":"failed","movementReference":null,"occurredAt":"1900-01-01T00:00:00Z"}'::jsonb from observed_capture))->>'status','quarantined','conflicting receipt quarantines the confirmed payment');
reset role;
set local role authenticated;
create temp table after_conflict_history as select public.get_administrator_booking_request_payment_history('RC-REQ-0000000000001001') result;
reset role;
select is((select count(*) from public.simulated_payment_provider_operations where claim_id='72000000-0000-4000-8000-000000001001'),4::bigint,'receipt observations do not execute another payment');
select is((select jsonb_agg(event order by ordinal) from after_conflict_history,jsonb_array_elements(result->'events') with ordinality events(event,ordinal) where ordinal <= (select jsonb_array_length(result->'events') from before_correction_history)),(select result->'events' from before_correction_history),'new receipt and quarantine evidence never changes or reorders earlier history');
select ok((select exists(select 1 from jsonb_array_elements(result->'events') event where event->>'kind'='quarantine' and event->>'toState'='quarantined' and event->>'reasonCode'='conflicting-provider-observation') from after_conflict_history),'real quarantine keeps its actionable reason');
select ok((select exists(select 1 from jsonb_array_elements(result->'events') event where event->>'source'='confirmation-invalidation' and event->>'reasonCode'='conflicting-evidence' and event->>'toState'='invalidated') from after_conflict_history),'historical confirmation and its terminal invalidation remain visible');
select ok((select exists(select 1 from jsonb_array_elements(result->'events') event where event->>'source'='provider-receipt' and event->>'outcome'='conflicting' and not(event ? 'providerOccurredAt')) from after_conflict_history),'conflicting evidence does not invent a trusted occurrence time');


select is((select count(*) from after_conflict_history,jsonb_array_elements(result->'events') event where event->>'source'='provider-receipt' and event->>'outcome'='conflicting'),1::bigint,'a newly persisted conflicting receipt emits exactly one arrival');
create temp table conflict_sources as select pg_temp.payment_arrival_sources() result;
set local role service_role;
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from observed_capture),(select payload||'{"outcome":"failed","movementReference":null,"occurredAt":"1900-01-01T00:00:00Z"}'::jsonb from observed_capture))->>'status','duplicate','an exact repeated conflict keeps the duplicate decision');
select is(public.observe_booking_request_payment_correction('60000000-0000-4000-8000-000000001001',(select id from observed_capture),(select payload||'{"outcome":"failed","movementReference":null,"occurredAt":"1900-01-01T00:00:00Z"}'::jsonb from observed_capture))->>'status','duplicate','every repeated conflict remains decision-idempotent');
reset role;
select is(pg_temp.payment_arrival_sources(),(select result from conflict_sources),'repeated conflicts preserve all payment decisions amounts movements receipts and holds');
set local role authenticated;
create temp table after_repeated_conflict_history as select public.get_administrator_booking_request_payment_history('RC-REQ-0000000000001001') result;
reset role;
select is((select count(*) from after_repeated_conflict_history,jsonb_array_elements(result->'events') event where event->>'source'='provider-receipt'),6::bigint,'canonical conflict and all four repeats retain exactly six arrival events');
select is((select count(*) from public.booking_request_payment_correction_observations where booking_request_id='60000000-0000-4000-8000-000000001001'),2::bigint,'repeated conflicts preserve the original two persisted receipts');
select ok((select result::text not like '%1900-01-01%' and not exists(select 1 from jsonb_array_elements(result->'events') event where event->>'outcome'='duplicate' and event ? 'providerOccurredAt') from after_repeated_conflict_history),'repeated conflicting receipts never acquire an attacker-supplied trusted occurrence');
select is((select jsonb_agg(event order by ordinal) from after_repeated_conflict_history,jsonb_array_elements(result->'events') with ordinality events(event,ordinal) where ordinal <= (select jsonb_array_length(result->'events') from after_conflict_history)),(select result->'events' from after_conflict_history),'repeated conflicts preserve the entire existing history prefix');


rollback to history_payment_required;
-- The established payment fixture clock moves the expiry boundary deterministically.
-- History recording keeps the real database clock; the outer rollback restores every function.
create table public.payment_history_test_clock(instant timestamptz not null);
insert into public.payment_history_test_clock select payment_required_deadline from public.booking_request_capture_work where booking_request_id='60000000-0000-4000-8000-000000001001';
create function public.payment_history_test_now() returns timestamptz language sql volatile security definer set search_path='' as $$ select instant from public.payment_history_test_clock $$;
select replace(pg_get_functiondef(procedures.oid),'clock_timestamp()','public.payment_history_test_now()')
from pg_proc procedures join pg_namespace namespaces on namespaces.oid=procedures.pronamespace
where namespaces.nspname='public' and procedures.prokind='f' and procedures.prosrc like '%clock_timestamp()%'
  and procedures.proname like '%booking_request%' and procedures.proname not like '%payment_history%' \gexec
set local role service_role;
create temp table history_expiry as select public.prepare_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}') result;
savepoint history_expiry_ready;
select public.execute_simulated_booking_request_payment_required_expiry((select result->'permit' from history_expiry),'failed');
reset role;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001370","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
create temp table history_failed_expiry as select public.get_administrator_booking_request_payment_history('RC-REQ-0000000000001001') result;
select is((select result#>>'{current,reasonCode}' from history_failed_expiry),'expiry-release-failed','a real failed expiry release retains its actionable current reason');
select ok((select exists(select 1 from jsonb_array_elements(result->'events') event where event->>'reasonCode'='expiry-release-failed' and event->>'kind'='quarantine') from history_failed_expiry),'a real failed expiry release retains its actionable history reason');
rollback to history_expiry_ready;
select public.execute_simulated_booking_request_payment_required_expiry((select result->'permit' from history_expiry),'succeeded');
select is(public.finalize_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001')->>'status','expired','real expiry releases the unpaid authorization');
reset role;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001370","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
create temp table history_expired as select public.get_administrator_booking_request_payment_history('RC-REQ-0000000000001001') result;
reset role;
select ok((select exists(select 1 from jsonb_array_elements(result->'events') event where event->>'source'='expiry-work' and event->>'operationKind'='expiry' and event->>'toState'='complete') from history_expired),'real expiry completion remains in ordered support evidence');
select ok((select exists(select 1 from jsonb_array_elements(result->'events') event where event->>'source'='booking-request' and event->>'fromState'='accepted' and event->>'toState'='expired') from history_expired),'expiry preserves the terminal Booking Request transition');
select is((select count(*) from history_expired,jsonb_array_elements(result->'events') event where event->>'kind'='physical-attempt'),2::bigint,'expiry support history distinguishes the failed capture from one physical release');


-- Enumerated production reasons remain meaningful; unrecognized text stays redacted.
create temp table history_known_reasons(reason text primary key);
insert into history_known_reasons values
('replacement-capture-succeeded'),
('source-evidence-invalid'),
('capture-occurrence-unknown'),
('original-capture-unresolved'),
('recovery-evidence-invalid'),
('unexplained-recovery-provider-operation'),
('recovery-operation-indeterminate'),
('corrective-capture-invalid'),
('unexplained-provider-operation'),
('original-release-indeterminate'),
('original-release-failed'),
('replacement-authorization-invalid'),
('replacement-release-indeterminate'),
('replacement-release-failed'),
('expiry-evidence-invalid'),
('expiry-release-failed'),
('expiry-release-indeterminate'),
('expiry-refund-failed'),
('expiry-refund-indeterminate'),
('inventory-evidence-invalid'),
('legacy-unresolved-money'),
('legacy-confirmation-evidence-invalid'),
('unsafe-recovery-original-release-indeterminate'),
('unsafe-recovery-original-release-failed'),
('unsafe-recovery-replacement-authorization-indeterminate'),
('unsafe-recovery-replacement-capture-indeterminate'),
('unsafe-recovery-replacement-release-indeterminate'),
('unsafe-recovery-replacement-release-failed');

select public.append_booking_request_payment_history(
 '73000000-0000-4000-8000-000000001371','60000000-0000-4000-8000-000000001371',
 'quarantine','expiry-work','observed',target_reason_code=>reason)
from history_known_reasons;
set local role authenticated;
create temp table history_reason_display as select public.get_administrator_booking_request_payment_history('RC-REQ-0000000000000137') result;
reset role;
select ok(exists(select 1 from history_reason_display,jsonb_array_elements(result->'events') event where event->>'reasonCode'=reason),
 'canonical support reason remains visible: '||reason) from history_known_reasons;

create temp table history_reference_cases(value text,allowed boolean);
insert into history_reference_cases
select prefix||suffix,true from unnest(array['sim-request-','sim-capture-request-','sim-recovery-request-','sim-expiry-request-']) prefixes(prefix)
cross join unnest(array['1234567890abcdef1234567890abcdef','12345678-90ab-4def-8123-567890abcdef']) suffixes(suffix);
insert into history_reference_cases values
 ('sim-request-1234567890abcdef1234567890abcde',false),
 ('sim-request-1234567890abcdef1234567890abcdef0',false),
 ('private-sim-request-1234567890abcdef1234567890abcdef',false),
 ('sim-other-request-1234567890abcdef1234567890abcdef',false),
 ('sim-request-1234567890abcdef1234567890abcdef-private',false);
select public.append_booking_request_payment_history(
 '73000000-0000-4000-8000-000000001371','60000000-0000-4000-8000-000000001371',
 'state-transition','provider-operation','observed',target_provider_request_id=>value,
 target_provider_reference=>replace(value,'request','reference'),target_movement_reference=>replace(value,'request','movement'))
from history_reference_cases;
set local role authenticated;
create temp table history_reference_display as select public.get_administrator_booking_request_payment_history('RC-REQ-0000000000000137') result;
reset role;
select is((select count(*) from history_reference_display,jsonb_array_elements(result->'events') event
 where event->>'providerRequestId'=cases.value and event->>'providerReference'=replace(cases.value,'request','reference')
 and event->>'movementReference'=replace(cases.value,'request','movement')),
 case when cases.allowed then 1 else 0 end::bigint,'exact bounded reconciliation reference: '||cases.value)
from history_reference_cases cases;

select * from finish();
rollback;
