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
-- END PAYMENT EVIDENCE FIXTURE
-- BEGIN COMPLETION FIXTURE
create function pg_temp.seed_completion_booking(start_day date, confirm_booking boolean default true) returns void language plpgsql as $seed_function$
declare fixture text := $fixture$
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
'{"cottageName":"Preserved Cottage","bookingPriceIqd":110000,"serviceFeeIqd":5000,"customerTotalIqd":115000,"items":[{"serviceDay":"2101-01-01","kind":"shift","position":1,"startsAt":"2101-01-01T08:00:00+03:00"},{"serviceDay":"2101-01-01","kind":"shift","position":3},{"serviceDay":"2101-01-02","kind":"full_day_bundle"}]}'::jsonb,
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
'{"cottageName":"Preserved Cottage","bookingPriceIqd":110000,"serviceFeeIqd":5000,"customerTotalIqd":115000,"items":[{"serviceDay":"2101-01-01","kind":"shift","position":1,"startsAt":"2101-01-01T08:00:00+03:00"},{"serviceDay":"2101-01-01","kind":"shift","position":3},{"serviceDay":"2101-01-02","kind":"full_day_bundle"}]}'::jsonb,
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
create temp table confirmation_capture_result as select pg_temp.capture_execute((select result->'permit' from confirmation_capture_lease)) result;
reset role;
-- END CONFIRMATION FIXTURE
set local role service_role;
create temp table confirmation_capture as select public.complete_booking_request_capture('60000000-0000-4000-8000-000000001001',1,(select (result#>>'{permit,leaseToken}')::uuid from confirmation_capture_lease),(select result from confirmation_capture_result)) result;
select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',(select result->'snapshot' from confirmation_capture));
reset role;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('10000000-0000-4000-8000-000000003801','authenticated','authenticated','cancellation-admin@example.test',now());
insert into public.account_contexts(user_id,role) values('10000000-0000-4000-8000-000000003801','platform_administrator');

$fixture$;
begin
  fixture:=replace(fixture,'2101-01-02',(start_day+1)::text);
  fixture:=replace(fixture,'2101-01-01',start_day::text);
  fixture:=replace(fixture,'2100-12-31',(start_day-1)::text);
  if not confirm_booking then
    fixture:=replace(fixture,'(select result->''snapshot'' from confirmation_capture));','(select result->''snapshot'' from confirmation_capture)) where false;');
  end if;
  execute fixture;
end;
$seed_function$;
-- END COMPLETION FIXTURE


create function pg_temp.actor(actor_id uuid, assurance text default 'aal1') returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','authenticated','aal',assurance)::text,true);
end $$;
create function pg_temp.no_show_decision() returns jsonb language sql as $$
 select jsonb_build_object('revision',public.get_booking_no_show_facts('60000000-0000-4000-8000-000000001001')->>'revision','refundObligation','{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb);
$$;
create function pg_temp.cancellation_decision(actor_role text, full_refund boolean) returns jsonb language sql as $$
 select jsonb_build_object('revision',public.get_booking_cancellation_facts('60000000-0000-4000-8000-000000001001',actor_role)->>'revision','refundObligation',case when full_refund then '{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb else '{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb end);
$$;
create function pg_temp.source_history() returns jsonb language sql as $$
 select jsonb_build_object(
 'snapshot',(select jsonb_agg(to_jsonb(s) order by id) from public.booking_snapshots s),
 'confirmation',(select jsonb_agg(to_jsonb(c) order by id) from public.booking_confirmations c),
 'receipts',(select jsonb_agg(to_jsonb(r) order by id) from public.booking_receipts r),
 'commitment',(select jsonb_agg(to_jsonb(c) order by id) from public.cottage_booking_period_commitments c),
 'inventory',(select jsonb_agg(to_jsonb(i) order by id) from public.cottage_inventory_commitments i),
 'capture',(select jsonb_agg(to_jsonb(w) order by booking_request_id) from public.booking_request_capture_work w),
 'operations',(select jsonb_agg(to_jsonb(o) order by id) from public.payment_provider_operations o),
 'observations',(select jsonb_agg(to_jsonb(o) order by id) from public.payment_provider_observations o),
 'paymentHistory',(select jsonb_agg(to_jsonb(h) order by id) from public.booking_request_payment_history h));
$$;
select no_plan();
select is(public.booking_completion_is_due('2101-01-02 23:00+00','2101-01-02 22:59:59.999999+00'),false,'completion and maturity are not due one microsecond before original end');
select is(public.booking_completion_is_due('2101-01-02 23:00+00','2101-01-02 23:00+00'),true,'completion and maturity become due exactly at original end');
select is(public.booking_review_is_available('2101-01-02 23:00+00','2101-01-16 23:00+00','2101-01-16 22:59:59.999999+00'),true,'review stays available one microsecond before fourteen-day expiry');
select is(public.booking_review_is_available('2101-01-02 23:00+00','2101-01-16 23:00+00','2101-01-16 23:00+00'),false,'review closes exactly at fourteen-day expiry');
select is(public.booking_review_is_available('2101-01-02 23:00+00',null,'2101-01-03 00:00+00'),false,'no review prerequisite produces false rather than unknown');
savepoint before_fixture;
select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-3);
select is((select public.booking_request_payment_status(requests) from public.booking_requests requests),'paid-confirmed','fixture is a real paid confirmation');
select is((select count(*) from public.booking_receipts),2::bigint,'fixture includes both original participant receipts');
select is((select count(*) from public.payment_provider_observations where result->>'outcome'='succeeded'),1::bigint,'fixture includes authoritative successful capture observation');
create temp table source_before as select pg_temp.source_history() value;
savepoint confirmed;
set local role service_role;
create temp table completion_candidate as select value from public.list_due_booking_completions(50) value;
select is((select count(*) from completion_candidate),1::bigint,'one eligible ended paid booking is admitted');
select is((select value->>'effectivePeriodEnd' from completion_candidate)::timestamptz,(((clock_timestamp() at time zone 'Asia/Baghdad')::date-2)+time '02:00') at time zone 'Asia/Baghdad'+interval '1 day','multi-day overnight period ends at final purchased Iraq-time boundary');
select is(public.commit_booking_completion('60000000-0000-4000-8000-000000001001','stale')->>'status','ineligible','stale completion revision cannot commit');
create temp table completion_receipt as select public.commit_booking_completion('60000000-0000-4000-8000-000000001001',(select value->>'revision' from completion_candidate)) value;
select is((select value->>'status' from completion_receipt),'completed','real paid booking completes');
select is(public.commit_booking_completion('60000000-0000-4000-8000-000000001001',(select value->>'revision' from completion_candidate)),(select value from completion_receipt),'completion replay returns identical receipt');
select is((select count(*) from public.list_due_booking_completions(50)),0::bigint,'completed booking is no longer queued');
reset role;
select is(pg_temp.source_history(),(select value from source_before),'completion preserves snapshots confirmation receipts inventory capture and all payment history exactly');
select is((select count(*) from public.booking_lifecycle_outcomes),1::bigint,'completion records one immutable outcome');
select pg_temp.actor('10000000-0000-4000-8000-000000001002');
set local role authenticated;
select is(public.get_booking_completion_eligibility('RC-REQ-0000000000001001','customer')->>'reviewAvailable','true','delayed completion opens review only within original fourteen-day window');
select is(public.get_booking_completion_eligibility('RC-REQ-0000000000001001','customer')->>'payoutPrerequisiteAvailable','true','completed booking exposes matured lifecycle payout prerequisite');
select lives_ok($$select public.get_booking_financial_view('RC-REQ-0000000000001001','customer')$$,'completed booking retains financial reader and manual-refund source access');
select is(public.get_booking_financial_view('RC-REQ-0000000000001001','customer')#>>'{lifecycle,status}','completed','financial detail publishes explicit completed lifecycle');
select is((select value->>'lifecycleStatus' from public.list_confirmed_booking_history() value),'completed','history navigation carries durable lifecycle status');
select is(public.get_booking_financial_view('RC-REQ-0000000000001001','customer')#>>'{eligibility,reviewAvailable}','true','detail carries downstream review prerequisite');
select throws_ok($$select public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003901','customer',null,null,pg_temp.cancellation_decision('customer',false))$$,'RC409',null,'completion conflicts with subsequent cancellation');
select pg_temp.actor('10000000-0000-4000-8000-000000003801','aal2');
select throws_ok($$select public.get_booking_no_show_facts('60000000-0000-4000-8000-000000001001')$$,'RC409',null,'completion conflicts with later no-show');
select lives_ok($$select public.record_booking_incident('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003902','platform_administrator','safety','Private later incident')$$,'completion permits a later restricted incident');
select pg_temp.actor('10000000-0000-4000-8000-000000001002');
select is(public.get_booking_lifecycle('RC-REQ-0000000000001001','customer')->>'status','completed','later incident preserves completed outcome');
select ok(not public.get_booking_lifecycle('RC-REQ-0000000000001001','customer') ? 'incidents','participant lifecycle excludes restricted narrative');
select is(public.get_booking_completion_eligibility('RC-REQ-0000000000001001','customer')->>'reviewAvailable','true','later incident does not reverse recorded review prerequisite');
reset role;
select is(pg_temp.source_history(),(select value from source_before),'late incident leaves original financial and booking sources unchanged');
select throws_ok($$update public.booking_lifecycle_outcomes set outcome='no_show'$$,'RC409',null,'lifecycle outcome cannot be rewritten');
select throws_ok($$delete from public.booking_completion_maturity$$,'RC409',null,'maturity cannot be removed');
select throws_ok($$update public.booking_incidents set narrative='replacement'$$,'RC409',null,'restricted incident cannot be rewritten');
rollback to confirmed;

-- A prior incident blocks both kinds of finalization, with relationship-derived identity.
select pg_temp.actor('10000000-0000-4000-8000-000000001001');
set local role authenticated;
create temp table incident_receipt as select public.record_booking_incident('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003903','cottage_owner','property_damage','Private owner incident') value;
select is(public.record_booking_incident('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003903','cottage_owner','property_damage','Private owner incident'),(select value from incident_receipt),'identical incident command replays the original receipt');
select throws_ok($$select public.record_booking_incident('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003903','cottage_owner','property_damage','Changed narrative')$$,'RC409',null,'conflicting incident command reuse fails');
select is(public.get_booking_lifecycle('RC-REQ-0000000000001001','cottage_owner')->>'status','incident_pending','owner sees incident-pending status');
select ok(not public.get_booking_lifecycle('RC-REQ-0000000000001001','cottage_owner') ? 'incidents','reporting owner does not receive administrator-only narrative');
select pg_temp.actor('10000000-0000-4000-8000-000000003801','aal2');
select throws_ok($$select public.get_booking_no_show_facts('60000000-0000-4000-8000-000000001001')$$,'RC409',null,'incident-first prevents no-show finalization');
select is(public.get_booking_lifecycle('RC-REQ-0000000000001001','platform_administrator')#>>'{incidents,0,narrative}','Private owner incident','administrator receives restricted original narrative');
reset role;
select ok((select (customer_user_id,owner_user_id,profile_id)=('10000000-0000-4000-8000-000000001002'::uuid,'10000000-0000-4000-8000-000000001001'::uuid,'20000000-0000-4000-8000-000000001001'::uuid) from public.booking_incidents),'incident participants and cottage derive from the booking');
set local role service_role;
select is((select count(*) from public.list_due_booking_completions(50)),0::bigint,'incident-blocked booking is excluded from scheduler');
select is(public.commit_booking_completion('60000000-0000-4000-8000-000000001001','stale')->>'status','ineligible','incident prevents direct completion commit');
reset role;
rollback to confirmed;

-- Staff no-show is attributed, zero-refund, and does not manufacture supplier effects.
select pg_temp.actor('10000000-0000-4000-8000-000000003801','aal2');
set local role authenticated;
select throws_ok($$select public.commit_booking_no_show('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003904',' ',pg_temp.no_show_decision())$$,'22023',null,'no-show requires a nonblank reason');
select is(public.commit_booking_no_show('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003904','Did not arrive','{}')->>'status','stale','forged no-show decision cannot commit');
create temp table no_show_receipt as select public.commit_booking_no_show('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003904','Did not arrive',pg_temp.no_show_decision()) value;
select is((select value->'refundObligation' from no_show_receipt),'{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb,'no-show preserves the literal zero standard refund');
select is(public.get_booking_lifecycle('RC-REQ-0000000000001001','platform_administrator')#>>'{noShow,reason}','Did not arrive','administrator sees no-show attribution in restricted lifecycle section');
select lives_ok($$select public.record_booking_incident('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003905','platform_administrator','conduct','Private late incident')$$,'no-show-first accepts later incident');
select is(public.commit_booking_no_show('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003904','Did not arrive','{}'),(select value from no_show_receipt),'same no-show command replays even after a later incident');
select throws_ok($$select public.commit_booking_no_show('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003904','Different reason','{}')$$,'RC409',null,'no-show conflicting command reuse fails');
select throws_ok($$select public.commit_booking_no_show('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003906','Did not arrive',pg_temp.no_show_decision())$$,'RC409',null,'another no-show command cannot replace final outcome');
reset role;
select ok((select actor_user_id='10000000-0000-4000-8000-000000003801'::uuid and reason='Did not arrive' and recorded_at is not null from public.booking_lifecycle_outcomes),'no-show stores administrator attribution reason and time');
select is(pg_temp.source_history(),(select value from source_before),'no-show preserves complete payment and booking history and creates no refund operation');
set local role service_role;
create temp table maturity_candidate as select value from public.list_due_booking_completions(50) value;
select is((select count(*) from maturity_candidate),1::bigint,'ended no-show is admitted once for maturity');
select is((select value->>'action' from maturity_candidate),'assess_maturity','no-show admission never requests completed outcome');
select is(public.commit_booking_completion_maturity('60000000-0000-4000-8000-000000001001',(select value->>'revision' from maturity_candidate))->>'status','matured','no-show matures after original period end');
reset role;
select pg_temp.actor('10000000-0000-4000-8000-000000001002');
set local role authenticated;
select is(public.get_booking_lifecycle('RC-REQ-0000000000001001','customer')->>'status','no_show','maturity preserves the no-show outcome');
select is(public.get_booking_completion_eligibility('RC-REQ-0000000000001001','customer')->>'reviewAvailable','false','no-show has no review');
select is(public.get_booking_completion_eligibility('RC-REQ-0000000000001001','customer')->>'payoutPrerequisiteAvailable','true','ended no-show exposes payout lifecycle prerequisite');
select lives_ok($$select public.get_booking_financial_view('RC-REQ-0000000000001001','customer')$$,'no-show preserves financial reads');
reset role;
rollback to confirmed;

select pg_temp.actor('10000000-0000-4000-8000-000000001002');
set local role authenticated;
select is(public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003907','customer',null,null,pg_temp.cancellation_decision('customer',false))->>'status','cancelled','late customer cancellation uses actual cancellation authority');
reset role;
set local role service_role;
create temp table late_candidate as select value from public.list_due_booking_completions(50) value;
select is((select count(*) from late_candidate),1::bigint,'ended late zero-refund cancellation is admitted for maturity');
select is(public.commit_booking_completion_maturity('60000000-0000-4000-8000-000000001001',(select value->>'revision' from late_candidate))->>'status','matured','late cancellation matures after original end');
select is(public.commit_booking_completion('60000000-0000-4000-8000-000000001001','stale')->>'status','ineligible','cancelled booking can never become completed');
reset role;
select pg_temp.actor('10000000-0000-4000-8000-000000001002');
set local role authenticated;
select is(public.get_booking_completion_eligibility('RC-REQ-0000000000001001','customer')->>'reviewAvailable','false','late cancellation has no review');
select is(public.get_booking_completion_eligibility('RC-REQ-0000000000001001','customer')->>'payoutPrerequisiteAvailable','true','ended late cancellation exposes lifecycle prerequisite');
select is(public.get_booking_lifecycle('RC-REQ-0000000000001001','customer')->>'status','cancelled','maturity never rewrites cancellation');
reset role;
rollback to confirmed;

select pg_temp.actor('10000000-0000-4000-8000-000000001001');
set local role authenticated;
select lives_ok($$select public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003908','cottage_owner','Unsafe property',null,pg_temp.cancellation_decision('cottage_owner',true))$$,'owner cancellation creates original restricted incident');
select pg_temp.actor('10000000-0000-4000-8000-000000003801','aal2');
select is(public.get_booking_lifecycle('RC-REQ-0000000000001001','platform_administrator')#>>'{incidents,0,narrative}','Unsafe property','administrator projection includes preserved cancellation incident');
select is(public.get_booking_lifecycle('RC-REQ-0000000000001001','platform_administrator')#>>'{incidents,0,source}','cancellation','administrator projection identifies cancellation incident source');
reset role;
set local role service_role;
select is((select count(*) from public.list_due_booking_completions(50)),0::bigint,'full-refund cancellation has no completion or payout maturity');
reset role;
rollback to before_fixture;

select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-3,false);
select is((select count(*) from public.booking_confirmations),0::bigint,'unconfirmed fixture stops before real confirmation finalization');
select pg_temp.actor('10000000-0000-4000-8000-000000001002');
set local role authenticated;
select throws_ok($$select public.get_booking_lifecycle('RC-REQ-0000000000001001','customer')$$,'RC409',null,'unconfirmed source cannot fabricate confirmed lifecycle');
reset role;
rollback to before_fixture;
-- Future and in-progress purchased ranges exercise real commit guards with valid source revisions.
select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date+3);
select pg_temp.actor('10000000-0000-4000-8000-000000003801','aal2');
set local role authenticated;
select throws_ok($$select public.get_booking_no_show_facts('60000000-0000-4000-8000-000000001001')$$,'RC409',null,'no-show cannot be recorded before first purchased shift');
reset role;
create temp table future_revision as select md5(jsonb_build_object('bookingRequestId',r.id,'confirmationId',c.id,'bookingPeriodCommitmentId',b.id,'effectivePeriodEnd',upper(range_merge(b.access_ranges)),'action','complete','lifecycleOutcomeId',null,'cancellationId',null)::text) value from public.booking_requests r join public.booking_confirmations c on c.booking_request_id=r.id join public.cottage_booking_period_commitments b on b.id=r.booking_period_commitment_id;
grant select on future_revision to service_role;
set local role service_role;
select is((select count(*) from public.list_due_booking_completions(50)),0::bigint,'future booking is not admitted');
select is(public.commit_booking_completion('60000000-0000-4000-8000-000000001001',(select value from future_revision))->>'status','ineligible','valid source revision cannot complete before actual database deadline');
reset role;
rollback to before_fixture;

select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-case when (clock_timestamp() at time zone 'Asia/Baghdad')::time<'08:00'::time then 1 else 0 end);
savepoint in_progress;
select pg_temp.actor('10000000-0000-4000-8000-000000003801','aal2');
set local role authenticated;
select is(public.commit_booking_no_show('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003909','Did not arrive',pg_temp.no_show_decision())->>'status','no_show','no-show can be recorded while purchased period is in progress');
reset role;
create temp table early_maturity_revision as select md5(jsonb_build_object('bookingRequestId',r.id,'confirmationId',c.id,'bookingPeriodCommitmentId',b.id,'effectivePeriodEnd',upper(range_merge(b.access_ranges)),'action','assess_maturity','lifecycleOutcomeId',o.id,'cancellationId',null)::text) value from public.booking_requests r join public.booking_confirmations c on c.booking_request_id=r.id join public.cottage_booking_period_commitments b on b.id=r.booking_period_commitment_id join public.booking_lifecycle_outcomes o on o.booking_request_id=r.id;
grant select on early_maturity_revision to service_role;
set local role service_role;
select is((select count(*) from public.list_due_booking_completions(50)),0::bigint,'in-progress no-show is not admitted for maturity');
select is(public.commit_booking_completion_maturity('60000000-0000-4000-8000-000000001001',(select value from early_maturity_revision))->>'status','ineligible','valid no-show revision cannot mature before original end');
reset role;
select pg_temp.actor('10000000-0000-4000-8000-000000001002');
set local role authenticated;
select is(public.get_booking_completion_eligibility('RC-REQ-0000000000001001','customer')->>'payoutPrerequisiteAvailable','false','no-show payout lifecycle prerequisite stays unavailable before original end');
reset role;
rollback to in_progress;
select pg_temp.actor('10000000-0000-4000-8000-000000001002');
set local role authenticated;
select is(public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003910','customer',null,null,pg_temp.cancellation_decision('customer',false))->>'status','cancelled','in-progress late cancellation succeeds');
reset role;
create temp table early_cancellation_revision as select md5(jsonb_build_object('bookingRequestId',r.id,'confirmationId',c.id,'bookingPeriodCommitmentId',b.id,'effectivePeriodEnd',upper(range_merge(b.access_ranges)),'action','assess_maturity','lifecycleOutcomeId',null,'cancellationId',x.id)::text) value from public.booking_requests r join public.booking_confirmations c on c.booking_request_id=r.id join public.cottage_booking_period_commitments b on b.id=r.booking_period_commitment_id join public.booking_cancellations x on x.booking_request_id=r.id;
grant select on early_cancellation_revision to service_role;
set local role service_role;
select is((select count(*) from public.list_due_booking_completions(50)),0::bigint,'in-progress late cancellation is not admitted for maturity');
select is(public.commit_booking_completion_maturity('60000000-0000-4000-8000-000000001001',(select value from early_cancellation_revision))->>'status','ineligible','valid cancellation revision cannot mature before original end');
reset role;
rollback to before_fixture;

select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-21);
set local role service_role;
select is(public.commit_booking_completion('60000000-0000-4000-8000-000000001001',(select value->>'revision' from public.list_due_booking_completions(50) value))->>'status','completed','scheduler may record delayed completion after review window has expired');
reset role;
select pg_temp.actor('10000000-0000-4000-8000-000000001002');
set local role authenticated;
select is(public.get_booking_completion_eligibility('RC-REQ-0000000000001001','customer')->>'reviewAvailable','false','delayed processing cannot restart expired review window');
reset role;
savepoint matured;
insert into public.booking_request_payment_required_expiry_work(id,booking_request_id,payment_required_deadline,state,quarantined_at,quarantine_reason) values('81000000-0000-4000-8000-000000003901','60000000-0000-4000-8000-000000001001',clock_timestamp()-interval '1 day','quarantined',clock_timestamp(),'conflicting-evidence');
select pg_temp.actor('10000000-0000-4000-8000-000000001002');
set local role authenticated;
select is(public.get_booking_completion_eligibility('RC-REQ-0000000000001001','customer')->>'payoutPrerequisiteAvailable','false','current quarantine denies downstream eligibility after maturity');
reset role;
select is((select count(*) from public.booking_completion_maturity),1::bigint,'quarantine preserves recorded maturity');
rollback to matured;
insert into public.booking_request_payment_required_expiry_work(id,booking_request_id,payment_required_deadline) values('81000000-0000-4000-8000-000000003901','60000000-0000-4000-8000-000000001001',clock_timestamp()-interval '1 day');
insert into public.booking_request_confirmation_invalidations(booking_request_id,confirmation_id,expiry_work_id,provider_operation_id,reason)
select booking_request_id,id,'81000000-0000-4000-8000-000000003901',capture_operation_id,'conflicting-evidence' from public.booking_confirmations;
select pg_temp.actor('10000000-0000-4000-8000-000000001002');
set local role authenticated;
select is(public.get_booking_completion_eligibility('RC-REQ-0000000000001001','customer')->>'payoutPrerequisiteAvailable','false','current invalidation denies downstream eligibility after maturity');
reset role;
select is((select count(*) from public.booking_completion_maturity),1::bigint,'invalidation preserves recorded maturity');
rollback to before_fixture;

select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-3);
savepoint valid_source;
insert into public.booking_request_payment_required_expiry_work(id,booking_request_id,payment_required_deadline,state,quarantined_at,quarantine_reason) values('81000000-0000-4000-8000-000000003901','60000000-0000-4000-8000-000000001001',clock_timestamp()-interval '1 day','quarantined',clock_timestamp(),'conflicting-evidence');
set local role service_role;
select is((select count(*) from public.list_due_booking_completions(50)),0::bigint,'quarantined confirmation is excluded from scheduler');
select throws_ok($$select public.commit_booking_completion('60000000-0000-4000-8000-000000001001','stale')$$,'RC409',null,'quarantined confirmation cannot complete directly');
reset role;
rollback to valid_source;
select pg_temp.actor('10000000-0000-4000-8000-000000001002');
set local role authenticated;
select public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003911','customer',null,null,pg_temp.cancellation_decision('customer',false));
reset role;
insert into public.booking_request_payment_required_expiry_work(id,booking_request_id,payment_required_deadline,state,quarantined_at,quarantine_reason) values('81000000-0000-4000-8000-000000003901','60000000-0000-4000-8000-000000001001',clock_timestamp()-interval '1 day','quarantined',clock_timestamp(),'conflicting-evidence');
set local role service_role;
select is((select count(*) from public.list_due_booking_completions(50)),0::bigint,'cancellation does not bypass current quarantine');
select throws_ok($$select public.commit_booking_completion_maturity('60000000-0000-4000-8000-000000001001','stale')$$,'RC409',null,'quarantined cancellation cannot mature directly');
reset role;
rollback to valid_source;

-- Authorization is proved through public function and table privileges, not substituted guards.
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.booking_lifecycle_outcomes'::regclass,'public.booking_incidents'::regclass,'public.booking_completion_maturity'::regclass)),'all lifecycle facts enforce Row Level Security');
select ok(not has_table_privilege('anon','public.booking_incidents','SELECT') and not has_table_privilege('authenticated','public.booking_incidents','SELECT') and not has_table_privilege('service_role','public.booking_incidents','SELECT'),'API roles cannot directly read restricted incidents');
select ok(not has_function_privilege('authenticated','public.list_due_booking_completions(integer)','EXECUTE') and not has_function_privilege('service_role','public.booking_completion_source(uuid)','EXECUTE'),'service admission and internal authority privileges are bounded');
set local role anon;
select throws_ok($$select public.record_booking_incident('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003912','cottage_owner','safety','Private')$$,'42501',null,'anonymous cannot report incidents');
select throws_ok($$select public.get_booking_lifecycle('RC-REQ-0000000000001001','customer')$$,'42501',null,'anonymous cannot read lifecycle');
reset role;
select pg_temp.actor('10000000-0000-4000-8000-000000001003');
set local role authenticated;
select throws_ok($$select public.get_booking_lifecycle('RC-REQ-0000000000001001','customer')$$,'42501',null,'unrelated customer cannot read lifecycle');
select throws_ok($$select public.record_booking_incident('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003912','cottage_owner','safety','Private')$$,'42501',null,'unrelated customer cannot impersonate reporting owner');
select pg_temp.actor('10000000-0000-4000-8000-000000001002');
select throws_ok($$select public.get_booking_no_show_facts('60000000-0000-4000-8000-000000001001')$$,'42501',null,'participant customer cannot mark no-show');
select throws_ok($$select public.record_booking_incident('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003912','platform_administrator','safety','Private')$$,'42501',null,'participant customer cannot impersonate administrator');
select pg_temp.actor('10000000-0000-4000-8000-000000001001');
select throws_ok($$select public.get_booking_no_show_facts('60000000-0000-4000-8000-000000001001')$$,'42501',null,'reporting owner cannot mark no-show');
select pg_temp.actor('10000000-0000-4000-8000-000000003801');
select throws_ok($$select public.get_booking_no_show_facts('60000000-0000-4000-8000-000000001001')$$,'42501',null,'administrator needs second-factor assurance for no-show');
select throws_ok($$select public.get_booking_lifecycle('RC-REQ-0000000000001001','platform_administrator')$$,'42501',null,'administrator needs second-factor assurance for narrative');
select throws_ok($$select public.record_booking_incident('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003912','platform_administrator','safety','Private')$$,'42501',null,'administrator needs second-factor assurance to report');
reset role;
update public.account_contexts set owner_approval_state='prospective' where user_id='10000000-0000-4000-8000-000000001001';
select pg_temp.actor('10000000-0000-4000-8000-000000001001');
set local role authenticated;
select throws_ok($$select public.record_booking_incident('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003912','cottage_owner','safety','Private')$$,'42501',null,'unapproved related owner cannot report');
reset role;
select * from finish();
rollback;
