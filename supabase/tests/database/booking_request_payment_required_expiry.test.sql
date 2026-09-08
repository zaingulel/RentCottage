begin;

select no_plan();

select has_table(
  'public', 'booking_request_payment_required_expiry_work',
  'Payment Required expiry work is durable'
);
select has_table(
  'public', 'booking_request_payment_required_expiry_operations',
  'Payment Required expiry release ownership is durable'
);
select has_function(
  'public', 'claim_due_booking_request_payment_required_expiries', array['integer', 'jsonb'],
  'service processing has a bounded due interface'
);
select has_function(
  'public', 'prepare_booking_request_payment_required_expiry', array['uuid', 'jsonb'],
  'service processing has a complete-evidence preparation interface'
);
select function_privs_are(
  'public', 'claim_due_booking_request_payment_required_expiries', array['integer', 'jsonb'],
  'service_role', array['EXECUTE'],
  'only the service role receives due processing access'
);
select function_privs_are(
  'public', 'claim_due_booking_request_payment_required_expiries', array['integer', 'jsonb'],
  'authenticated', array[]::text[],
  'authenticated callers cannot claim expiry work'
);
select function_privs_are(
  'public', 'prepare_booking_request_payment_required_expiry', array['uuid', 'jsonb'],
  'service_role', array['EXECUTE'],
  'only the service role receives preparation access'
);
select function_privs_are(
  'public', 'prepare_booking_request_payment_required_expiry', array['uuid', 'jsonb'],
  'authenticated', array[]::text[],
  'authenticated callers cannot inspect expiry evidence'
);
select table_privs_are(
  'public', 'booking_request_payment_required_expiry_work', 'service_role', array[]::text[],
  'service callers use the narrow expiry functions instead of private rows'
);
select table_privs_are(
  'public', 'booking_request_payment_required_expiry_operations', 'service_role', array[]::text[],
  'service callers use the narrow release functions instead of private rows'
);
select ok(
  coalesce((select classes.relrowsecurity from pg_class classes
    join pg_namespace namespaces on namespaces.oid = classes.relnamespace
    where namespaces.nspname = 'public'
      and classes.relname = 'booking_request_payment_required_expiry_work'), false),
  'expiry work has Row Level Security enabled'
);
select ok(
  coalesce((select classes.relrowsecurity from pg_class classes
    join pg_namespace namespaces on namespaces.oid = classes.relnamespace
    where namespaces.nspname = 'public'
      and classes.relname = 'booking_request_payment_required_expiry_operations'), false),
  'expiry operations have Row Level Security enabled'
);



select function_privs_are('public',function_name,arguments,'anon',array[]::text[],
  'anonymous callers cannot run '||function_name)
from (values
  ('execute_simulated_booking_request_payment_required_expiry',array['jsonb','text']),
  ('query_simulated_booking_request_payment_required_expiry',array['jsonb','text','text','text']),
  ('finalize_booking_request_payment_required_expiry',array['uuid'])
) functions(function_name,arguments);
select function_privs_are('public',function_name,arguments,'authenticated',array[]::text[],
  'owning and unrelated participants cannot run '||function_name)
from (values
  ('execute_simulated_booking_request_payment_required_expiry',array['jsonb','text']),
  ('query_simulated_booking_request_payment_required_expiry',array['jsonb','text','text','text']),
  ('finalize_booking_request_payment_required_expiry',array['uuid'])
) functions(function_name,arguments);

select function_privs_are('public','booking_request_payment_required_expiry_status',array['public.booking_requests'],role,array[]::text[],
  role||' cannot read the private expiry projection helper directly') from unnest(array['anon','authenticated','service_role']) roles(role);

set local role service_role;
create temp table invalid_expiry_provider_identities(label,identity) as values
  ('SQL null',null::jsonb),
  ('JSON null','null'::jsonb),
  ('scalar','"provider"'::jsonb),
  ('array','[]'::jsonb),
  ('missing field','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant"}'::jsonb),
  ('extra field','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal","extra":"value"}'::jsonb),
  ('null field','{"provider":"fictional-payments","environment":"local-test","merchantId":null,"terminalId":"fictional-terminal"}'::jsonb),
  ('non-string field','{"provider":"fictional-payments","environment":"local-test","merchantId":1,"terminalId":"fictional-terminal"}'::jsonb),
  ('blank field','{"provider":"fictional-payments","environment":"local-test","merchantId":" ","terminalId":"fictional-terminal"}'::jsonb);
select throws_ok(format('select public.claim_due_booking_request_payment_required_expiries(1,%L::jsonb)',identity),
  'RC409','Payment Required expiry provider is invalid','empty expiry queue rejects '||label)
from invalid_expiry_provider_identities;
select is(public.claim_due_booking_request_payment_required_expiries(1,
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'),
  '[]'::jsonb,'a valid provider receives an empty batch when no Payment Required work exists');
reset role;

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


create table public.payment_required_expiry_test_clock(instant timestamptz not null);
insert into public.payment_required_expiry_test_clock
select payment_required_deadline from public.booking_request_capture_work;
create function public.payment_required_expiry_test_now()
returns timestamptz language sql volatile security definer set search_path = '' as $$
  select instant from public.payment_required_expiry_test_clock;
$$;
create temp table expiry_original_functions as
select signature,pg_get_functiondef(signature::regprocedure) definition
from (values
  ('public.claim_due_booking_request_payment_required_expiries(integer,jsonb)'),
  ('public.prepare_booking_request_payment_required_expiry(uuid,jsonb)'),
  ('public.execute_simulated_booking_request_payment_required_expiry(jsonb,text)'),
  ('public.query_simulated_booking_request_payment_required_expiry(jsonb,text,text,text)'),
  ('public.finalize_booking_request_payment_required_expiry(uuid)'),
  ('public.booking_request_payment_required_expiry_completed(uuid)'),
  ('public.claim_customer_booking_request_payment_recovery(uuid,uuid,text)'),
  ('public.lease_booking_request_payment_recovery_step(uuid)'),
  ('public.execute_simulated_booking_request_payment_recovery(jsonb,text)'),
  ('public.query_simulated_booking_request_payment_recovery(jsonb,text,text,text)'),
  ('public.finalize_booking_request_confirmation(uuid,jsonb)')
) functions(signature);
select replace(definition,'clock_timestamp()','public.payment_required_expiry_test_now()')
from expiry_original_functions \gexec
insert into public.owner_request_notifications(booking_request_id,owner_user_id) values('60000000-0000-4000-8000-000000001001','10000000-0000-4000-8000-000000001001');
savepoint clean_slate;
set local role service_role;
select throws_ok(format('select public.claim_due_booking_request_payment_required_expiries(1,%L::jsonb)',identity),
  'RC409','Payment Required expiry provider is invalid','populated expiry queue rejects '||label)
from invalid_expiry_provider_identities;
select is(public.claim_due_booking_request_payment_required_expiries(1,
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')->0->>'bookingRequestId',
  '60000000-0000-4000-8000-000000001001','the matching provider receives its due request at the fixed deadline');
select lives_ok($probe$do $check$ begin
  if public.claim_due_booking_request_payment_required_expiries(1,
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-other-merchant","terminalId":"fictional-terminal"}') <> '[]'::jsonb then
    raise exception 'The provider batch included a foreign request';
  end if;
end $check$;$probe$,'a valid nonmatching provider receives an empty batch despite another provider having due work');
reset role;
select set_config('expiry.expected_projection',('null'::jsonb)::text,true);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->'paymentRequiredExpiry',current_setting('expiry.expected_projection')::jsonb,'Customer receives only the absent expiry state and fixed deadline');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
set local role authenticated;
select is(public.list_owner_booking_request_notifications()->0->'paymentRequiredExpiry',current_setting('expiry.expected_projection')::jsonb,'Owner receives only the absent expiry state and fixed deadline');
reset role;
set local role service_role;
set local role service_role;
create temp table prepared_expiry as select public.prepare_booking_request_payment_required_expiry(
  '60000000-0000-4000-8000-000000001001',
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) result;
select is((select result->>'status' from prepared_expiry),'release',
  'deadline preparation selects one bound original authorisation release');

select is((select (result#>>'{permit,binding,amountFils}')::bigint from prepared_expiry),115000000::bigint,
  'the release covers the full IQD 110000 price plus IQD 5000 fee in fils');
select is((select result#>>'{permit,binding,predecessorMovementReference}' from prepared_expiry),
  'confirmation-auth-movement-1','the release binds the exact original authorisation movement');
reset role;
select set_config('expiry.expected_projection',(jsonb_build_object('status','processing','deadline',(select to_char(payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from public.booking_request_capture_work)))::text,true);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->'paymentRequiredExpiry',current_setting('expiry.expected_projection')::jsonb,'Customer receives only the processing expiry state and fixed deadline');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
set local role authenticated;
select is(public.list_owner_booking_request_notifications()->0->'paymentRequiredExpiry',current_setting('expiry.expected_projection')::jsonb,'Owner receives only the processing expiry state and fixed deadline');
reset role;
set local role service_role;
select is(public.finalize_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001')->>'status',
  'processing','an undispatched release is not safe expiry proof');
reset role;
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,
  'the component shifts, cross-midnight shift and full-day bundle remain held before release');
savepoint failed_release;
set local role service_role;
select public.execute_simulated_booking_request_payment_required_expiry((select result->'permit' from prepared_expiry),'failed');
select is(public.finalize_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001')->>'status',
  'quarantined','a failed release never expires the request');
select is(public.execute_simulated_booking_request_payment_required_expiry((select result->'permit' from prepared_expiry),'succeeded')->>'outcome',
  'not-executed','a failed release cannot be retried under its existing physical identity');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined',
  'failed release attention is durable');
reset role;
select set_config('expiry.expected_projection',(jsonb_build_object('status','quarantined','deadline',(select to_char(payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from public.booking_request_capture_work)))::text,true);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->'paymentRequiredExpiry',current_setting('expiry.expected_projection')::jsonb,'Customer receives only the attention-required expiry state and fixed deadline');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
set local role authenticated;
select is(public.list_owner_booking_request_notifications()->0->'paymentRequiredExpiry',current_setting('expiry.expected_projection')::jsonb,'Owner receives only the attention-required expiry state and fixed deadline');
reset role;

select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,
  'failed release retains every held occupancy');
select is((select count(*) from public.booking_request_status_notifications where status='expired'),0::bigint,
  'failed release creates no expiry notification');
rollback to failed_release;

set local role service_role;
select throws_ok(format('select public.execute_simulated_booking_request_payment_required_expiry(%L::jsonb,%L)',
  (select jsonb_set(result->'permit','{binding,predecessorMovementReference}','"foreign-authorization"'::jsonb) from prepared_expiry),'succeeded'),
  'RC409',null,'a substituted predecessor cannot dispatch a release');
select throws_ok(format('select public.execute_simulated_booking_request_payment_required_expiry(%L::jsonb,%L)',
  (select jsonb_set(result->'permit','{binding,amountFils}','110000000'::jsonb) from prepared_expiry),'succeeded'),
  'RC409',null,'a partial-amount permit cannot dispatch a release');
reset role;
savepoint uncertain_release;
set local role service_role;
create temp table expiry_release_result as select public.execute_simulated_booking_request_payment_required_expiry(
  (select result->'permit' from prepared_expiry),'indeterminate') result;
select is(public.finalize_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001')->>'status',
  'quarantined','an indeterminate release cannot expire the request');
select is(public.prepare_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001',
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb)->>'status',
  'quarantined','uncertainty permanently prevents automatic release queries');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined',
  'indeterminate release attention is durable');
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,
  'an uncertain release still blocks every held shift');
update public.payment_required_expiry_test_clock set instant=instant+interval '1 second';
set local role service_role;
select is(public.query_simulated_booking_request_payment_required_expiry((select result->'permit' from prepared_expiry),
  (select result->>'providerRequestId' from expiry_release_result),(select result->>'providerReference' from expiry_release_result),'succeeded')->>'outcome',
  'not-executed','quarantine prevents provider queries even with a stale valid permit');
reset role;
select is((select authoritative_outcome_at from public.simulated_payment_provider_operations where operation_kind='release'),null::timestamptz,'quarantine cannot invent resolution time');
rollback to uncertain_release;
set local role service_role;
create temp table expiry_release_result as select public.execute_simulated_booking_request_payment_required_expiry(
  (select result->'permit' from prepared_expiry),'succeeded') result;
reset role;
savepoint invalid_release_amount;
update public.simulated_payment_provider_operations set amount_fils=110000000 where operation_kind='release';
set local role service_role;
select is(public.finalize_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001')->>'status',
  'quarantined','finalization revalidates the complete amount in persisted provider release evidence');
reset role;
rollback to invalid_release_amount;
savepoint invalid_inventory;
update public.cottage_booking_period_occupancies set active=false
  where shift_id='32000000-0000-4000-8000-000000001002';
set local role service_role;
select is(public.finalize_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001')->>'status',
  'quarantined','finalization rejects an incomplete occupancy set even after successful release');
reset role;
rollback to invalid_inventory;
set local role service_role;
select is(public.finalize_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001')->>'status',
  'expired','full release proof atomically expires the unpaid request');
reset role;
select is((select status::text from public.booking_requests),'expired','the request is durably expired');
select is((select status::text from public.cottage_booking_period_commitments),'released_hold','only the request Pending Hold is released');
select is((select count(*) from public.cottage_booking_period_occupancies where active),0::bigint,'all five occupancies are deactivated');
select is((select count(*) from public.cottage_inventory_commitments),3::bigint,'selected inventory history remains intact');
select is((select count(*) from public.booking_request_submission_attempts where intent_dedupe_active),0::bigint,'the expired request no longer reserves its submission intent');
select is((select count(*) from public.booking_confirmations),0::bigint,'safe unpaid expiry creates no Confirmed Booking');
reset role;
select set_config('expiry.expected_projection',(jsonb_build_object('status','expired','deadline',(select to_char(payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from public.booking_request_capture_work)))::text,true);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->'paymentRequiredExpiry',current_setting('expiry.expected_projection')::jsonb,'Customer receives only the expired expiry state and fixed deadline');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
set local role authenticated;
select is(public.list_owner_booking_request_notifications()->0->'paymentRequiredExpiry',current_setting('expiry.expected_projection')::jsonb,'Owner receives only the expired expiry state and fixed deadline');
reset role;

select is((select count(*) from public.simulated_payment_provider_operations where operation_kind='capture' and current_outcome='succeeded'),0::bigint,
  'safe expiry creates no successful capture');
select is((select count(*) from public.booking_request_status_notifications where status='expired' and recipient_user_id='10000000-0000-4000-8000-000000001002'),1::bigint,
  'the Customer receives exactly one expiry notification');
select is((select count(*) from public.booking_request_status_notifications where status='expired' and recipient_user_id='10000000-0000-4000-8000-000000001001'),1::bigint,
  'the Cottage Owner receives exactly one expiry notification');
create temp table terminal_expiry_graph as select jsonb_build_object(
  'request',(select to_jsonb(requests) from public.booking_requests requests),
  'work',(select to_jsonb(work) from public.booking_request_payment_required_expiry_work work),
  'ledger',(select jsonb_agg(to_jsonb(ledger) order by id) from public.simulated_payment_provider_operations ledger),
  'notices',(select jsonb_agg(to_jsonb(notices) order by id) from public.booking_request_status_notifications notices)) graph;
set local role service_role;
select is(public.finalize_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001')->>'status','expired',
  'terminal finalization replay returns the completed expiry');
select is(public.execute_simulated_booking_request_payment_required_expiry((select result->'permit' from prepared_expiry),'failed')->>'outcome','succeeded',
  'a delayed duplicate dispatch replays its terminal provider success');
select is(public.query_simulated_booking_request_payment_required_expiry((select result->'permit' from prepared_expiry),
  (select result->>'providerRequestId' from expiry_release_result),(select result->>'providerReference' from expiry_release_result),'failed')->>'outcome','succeeded',
  'out-of-order terminal evidence cannot replace successful release');
reset role;
select is(jsonb_build_object(
  'request',(select to_jsonb(requests) from public.booking_requests requests),
  'work',(select to_jsonb(work) from public.booking_request_payment_required_expiry_work work),
  'ledger',(select jsonb_agg(to_jsonb(ledger) order by id) from public.simulated_payment_provider_operations ledger),
  'notices',(select jsonb_agg(to_jsonb(notices) order by id) from public.booking_request_status_notifications notices)),
  (select graph from terminal_expiry_graph),'terminal replays preserve all provider identities, times, expiry and notifications');
reset role;
rollback to clean_slate;
update public.payment_required_expiry_test_clock set instant=(select payment_required_deadline-interval '1 millisecond' from public.booking_request_capture_work);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
create temp table recovery_before_expiry as select public.claim_customer_booking_request_payment_recovery(
  '60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000001001','simulated-replacement') result;
reset role;
grant select on recovery_before_expiry to service_role;
set local role service_role;
create temp table recovery_release_permit as select public.lease_booking_request_payment_recovery_step(
  (select (result->>'attemptId')::uuid from recovery_before_expiry)) result;
create temp table recovery_release_result as select public.execute_simulated_booking_request_payment_recovery(
  (select result->'permit' from recovery_release_permit),'succeeded') result;
reset role;
update public.payment_required_expiry_test_clock set instant=(select payment_required_deadline from public.booking_request_capture_work);
set local role service_role;
select is(public.prepare_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001',
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb)->>'status',
  'ready','expiry reuses the existing successful recovery-owned release');
select public.query_simulated_booking_request_payment_recovery((select result->'permit' from recovery_release_permit),
  (select result->>'providerRequestId' from recovery_release_result),(select result->>'providerReference' from recovery_release_result),'succeeded');
select is(public.finalize_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001')->>'status',
  'expired','resolved recovery-owned release permits safe expiry');
reset role;
create temp table recovery_terminal_graph as select jsonb_build_object(
  'attempts',(select jsonb_agg(to_jsonb(attempts) order by id) from public.booking_request_payment_recovery_attempts attempts),
  'operations',(select jsonb_agg(to_jsonb(operations) order by id) from public.booking_request_payment_recovery_operations operations),
  'work',(select to_jsonb(work) from public.booking_request_payment_required_expiry_work work),
  'ledger',(select jsonb_agg(to_jsonb(ledger) order by id) from public.simulated_payment_provider_operations ledger),
  'notices',(select jsonb_agg(to_jsonb(notices) order by id) from public.booking_request_status_notifications notices)) graph;
set local role service_role;
select lives_ok(format('select public.query_simulated_booking_request_payment_recovery(%L::jsonb,%L,%L,%L)',
  (select result->'permit' from recovery_release_permit),(select result->>'providerRequestId' from recovery_release_result),
  (select result->>'providerReference' from recovery_release_result),'failed'),
  'a delayed recovery query replays a terminal release after another worker completed expiry');
select lives_ok(format('select public.execute_simulated_booking_request_payment_recovery(%L::jsonb,%L)',
  (select result->'permit' from recovery_release_permit),'failed'),
  'a delayed recovery dispatch replays its stored terminal release after safe expiry');
select throws_ok(format('select public.query_simulated_booking_request_payment_recovery(%L::jsonb,%L,%L,%L)',
  (select result->'permit' from recovery_release_permit),'wrong-request',
  (select result->>'providerReference' from recovery_release_result),'succeeded'),
  'RC409',null,'completed-expiry recovery replay still rejects the wrong provider request');
select is(public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from recovery_before_expiry))->>'status',
  'deadline-elapsed','a stale recovery selection after completed expiry terminates before the accepted-only helper');
reset role;
select is(jsonb_build_object(
  'attempts',(select jsonb_agg(to_jsonb(attempts) order by id) from public.booking_request_payment_recovery_attempts attempts),
  'operations',(select jsonb_agg(to_jsonb(operations) order by id) from public.booking_request_payment_recovery_operations operations),
  'work',(select to_jsonb(work) from public.booking_request_payment_required_expiry_work work),
  'ledger',(select jsonb_agg(to_jsonb(ledger) order by id) from public.simulated_payment_provider_operations ledger),
  'notices',(select jsonb_agg(to_jsonb(notices) order by id) from public.booking_request_status_notifications notices)),
  (select graph from recovery_terminal_graph),'delayed recovery replay changes no operation, outcome time, expiry or notification');
reset role;

rollback to clean_slate;
update public.payment_required_expiry_test_clock set instant=(select payment_required_deadline-interval '1 millisecond' from public.booking_request_capture_work);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
create temp table confirming_attempt as select public.claim_customer_booking_request_payment_recovery(
  '60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000001009','simulated-replacement') result;
reset role;
grant select on confirming_attempt to service_role;
set local role service_role;
select public.execute_simulated_booking_request_payment_recovery(public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from confirming_attempt))->'permit','succeeded');
select public.execute_simulated_booking_request_payment_recovery(public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from confirming_attempt))->'permit','succeeded');
select public.execute_simulated_booking_request_payment_recovery(public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from confirming_attempt))->'permit','succeeded');
reset role;
update public.payment_required_expiry_test_clock set instant=(select payment_required_deadline from public.booking_request_capture_work);
set local role service_role;
select is(public.prepare_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001',
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')->>'status','processing','expiry waits for a valid pre-deadline capture to confirm');
select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001', public.get_booking_request_payment_recovery_confirmation_evidence((select (result->>'attemptId')::uuid from confirming_attempt)));
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'processing','historical expiry work remains durable after recovery confirms');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->>'paymentStatus','paid-confirmed','Customer sees confirmed payment after the deadline');
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->'paymentRequiredExpiry','null'::jsonb,'Customer confirmation takes precedence over historical expiry attention');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
set local role authenticated;
select is(public.list_owner_booking_request_notifications()->0->>'paymentStatus','paid-confirmed','Owner sees confirmed payment after the deadline');
select is(public.list_owner_booking_request_notifications()->0->'paymentRequiredExpiry','null'::jsonb,'Owner confirmation takes precedence over historical expiry attention');
reset role;
select definition from expiry_original_functions \gexec

select * from finish();
rollback;
