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
create function pg_temp.seed_completion_booking(
  start_day date,
  confirm_booking boolean default true,
  target_namespace text default '10'
) returns void language plpgsql as $seed_function$
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
declare suffix text;
declare lifecycle_id text;
declare capture_fingerprint text;
begin
  if target_namespace !~ '^[0-9]{2}$' then
    raise exception 'Review fixture namespace is invalid';
  end if;
  if target_namespace <> '10' then
    suffix:='00000000'||target_namespace;
    fixture:=replace(fixture,'000000001001',suffix||'01');
    fixture:=replace(fixture,'000000001002',suffix||'02');
    fixture:=replace(fixture,'000000001003',suffix||'03');
    fixture:=replace(fixture,'000000003801',suffix||'81');
    fixture:=replace(fixture,'0000000000001001','000000000000'||target_namespace||'01');
    fixture:=replace(fixture,'+9647500001001','+964750000'||target_namespace||'01');
    fixture:=replace(fixture,'+9647500001002','+964750000'||target_namespace||'02');
    fixture:=replace(fixture,'+9647500001003','+964750000'||target_namespace||'03');
    fixture:=replace(fixture,'CONFIRMATION-HOLD-1','REVIEW-HOLD-'||target_namespace);
    fixture:=replace(fixture,'confirmation-cottage','review-cottage-'||target_namespace);
    fixture:=replace(fixture,'confirmation-auth-request-1','review-'||target_namespace||'-auth-request');
    fixture:=replace(fixture,'confirmation-auth-reference-1','review-'||target_namespace||'-auth-reference');
    fixture:=replace(fixture,'confirmation-auth-movement-1','review-'||target_namespace||'-auth-movement');
    fixture:=replace(fixture,'cancellation-admin@example.test','review-'||target_namespace||'-admin@example.test');
    fixture:=replace(fixture,'confirmation_capture_lease','review_'||target_namespace||'_capture_lease');
    fixture:=replace(fixture,'confirmation_capture_result','review_'||target_namespace||'_capture_result');
    fixture:=replace(fixture,'confirmation_capture','review_'||target_namespace||'_capture');
    lifecycle_id:='73000000-0000-4000-8000-'||suffix||'01';
    capture_fingerprint:=encode(extensions.digest(convert_to(
      '{"provider":{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"},"kind":"capture","paymentLifecycleId":"'
      ||lifecycle_id||'","logicalOperationId":"'||lifecycle_id
      ||':capture","attemptId":"'||lifecycle_id
      ||':capture:attempt-2","amountFils":115000000,"currency":"IQD"}',
      'UTF8'),'sha256'),'hex');
    fixture:=replace(
      fixture,
      '6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d',
      capture_fingerprint
    );
  end if;
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

select pg_temp.seed_completion_booking(
  ((clock_timestamp() at time zone 'Asia/Baghdad')::date - 3)
);

set local role service_role;
select public.commit_booking_completion(
  '60000000-0000-4000-8000-000000001001',
  (
    select value->>'revision'
    from public.list_due_booking_completions(50) value
    where value->>'bookingRequestId'='60000000-0000-4000-8000-000000001001'
  )
);
reset role;

select no_plan();

select pg_temp.seed_completion_booking(
  ((clock_timestamp() at time zone 'Asia/Baghdad')::date - 3),true,'11'
);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001101',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001101","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select public.record_booking_incident(
  '60000000-0000-4000-8000-000000001101',
  '90000000-0000-4000-8000-000000001101',
  'cottage_owner','safety','Authoritative review admission fixture incident'
);
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001102',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001102","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(
  public.submit_customer_review(
    'RC-REQ-0000000000001101',5,'en','Incident-pending review'
  )->>'status',
  'ineligible','an authoritative incident-pending booking cannot publish a review'
);
reset role;

select pg_temp.seed_completion_booking(
  ((clock_timestamp() at time zone 'Asia/Baghdad')::date - 3),true,'12'
);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001281',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001281","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
create temp table review_no_show_result as
with facts as materialized (
  select public.get_booking_no_show_facts(
    '60000000-0000-4000-8000-000000001201'
  ) value
)
select public.commit_booking_no_show(
  '60000000-0000-4000-8000-000000001201',
  '90000000-0000-4000-8000-000000001201',
  'Did not arrive',
  jsonb_build_object(
    'revision',value->>'revision',
    'refundObligation','{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb
  )
) value
from facts;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001202',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001202","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(
  public.submit_customer_review(
    'RC-REQ-0000000000001201',5,'en','No-show review'
  )->>'status',
  'ineligible','an authoritative no-show booking cannot publish a review'
);
reset role;

select pg_temp.seed_completion_booking(
  ((clock_timestamp() at time zone 'Asia/Baghdad')::date - 3),true,'13'
);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001302',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001302","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
create temp table review_cancellation_result as
with facts as materialized (
  select public.get_booking_cancellation_facts(
    '60000000-0000-4000-8000-000000001301','customer'
  ) value
)
select public.commit_booking_cancellation(
  '60000000-0000-4000-8000-000000001301',
  '90000000-0000-4000-8000-000000001301',
  'customer',null,null,
  jsonb_build_object(
    'revision',value->>'revision',
    'refundObligation','{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb
  )
) value
from facts;
select is(
  public.submit_customer_review(
    'RC-REQ-0000000000001301',5,'en','Cancelled review'
  )->>'status',
  'ineligible','an authoritative cancelled booking cannot publish a review'
);
reset role;

select pg_temp.seed_completion_booking(
  ((clock_timestamp() at time zone 'Asia/Baghdad')::date - 3),false,'14'
);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001402',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001402","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(
  public.submit_customer_review(
    'RC-REQ-0000000000001401',5,'en','Unconfirmed review'
  )->>'status',
  'ineligible','a booking without paid confirmation cannot publish a review'
);
reset role;

select pg_temp.seed_completion_booking(
  ((clock_timestamp() at time zone 'Asia/Baghdad')::date - 18),true,'15'
);
set local role service_role;
select public.commit_booking_completion(
  '60000000-0000-4000-8000-000000001501',
  (
    select value->>'revision'
    from public.list_due_booking_completions(50) value
    where value->>'bookingRequestId'='60000000-0000-4000-8000-000000001501'
  )
);
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001502',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001502","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(
  public.submit_customer_review(
    'RC-REQ-0000000000001501',5,'en','Expired review'
  )->>'status',
  'ineligible','late completion assessment never extends the authoritative review deadline'
);
reset role;

insert into public.cottage_profile_source_revisions(
  id,profile_id,owner_user_id,source_language,description,house_rules,revision
) values (
  '47000000-0000-4000-8000-000000001001',
  '20000000-0000-4000-8000-000000001001',
  '10000000-0000-4000-8000-000000001001',
  'en','Review fixture description','Review fixture rules',1
);
insert into public.cottage_profile_review_cycles(
  id,profile_id,owner_user_id,source_revision_id,name,governorate,
  approximate_location,capacity,bedrooms,bathrooms,amenities,cycle_number,state,decided_at
) values (
  '47100000-0000-4000-8000-000000001001',
  '20000000-0000-4000-8000-000000001001',
  '10000000-0000-4000-8000-000000001001',
  '47000000-0000-4000-8000-000000001001',
  'Review Cottage','Baghdad','Karrada',8,3,2,array['garden'],1,'approved',clock_timestamp()
);
insert into public.cottage_profile_localized_revisions(
  id,review_cycle_id,locale,revision,origin,description,house_rules,
  provider,model,effort,prompt_version
) values
  ('47200000-0000-4000-8000-000000001001','47100000-0000-4000-8000-000000001001','en',1,'owner_source','English description','English rules',null,null,null,null),
  ('47200000-0000-4000-8000-000000001002','47100000-0000-4000-8000-000000001001','ar',1,'generated','وصف عربي','قواعد عربية','fictional','fixture-model','low','fixture-v1'),
  ('47200000-0000-4000-8000-000000001003','47100000-0000-4000-8000-000000001001','ckb',1,'generated','وەسفی کوردی','یاساکانی کوردی','fictional','fixture-model','low','fixture-v1');
insert into public.cottage_profile_publication_decisions(
  review_cycle_id,administrator_user_id,approved,reason
) values (
  '47100000-0000-4000-8000-000000001001',
  '10000000-0000-4000-8000-000000003801',true,'Approved fictional review fixture'
);
insert into public.cottage_publication_snapshots(
  id,profile_id,review_cycle_id,publication_number,name,governorate,
  approximate_location,capacity,bedrooms,bathrooms,amenities
) values (
  '47300000-0000-4000-8000-000000001001',
  '20000000-0000-4000-8000-000000001001',
  '47100000-0000-4000-8000-000000001001',1,
  'Review Cottage','Baghdad','Karrada',8,3,2,array['garden']
);
insert into public.cottage_publication_localizations(
  publication_id,locale,localized_revision_id,description,house_rules
) values
  ('47300000-0000-4000-8000-000000001001','en','47200000-0000-4000-8000-000000001001','English description','English rules'),
  ('47300000-0000-4000-8000-000000001001','ar','47200000-0000-4000-8000-000000001002','وصف عربي','قواعد عربية'),
  ('47300000-0000-4000-8000-000000001001','ckb','47200000-0000-4000-8000-000000001003','وەسفی کوردی','یاساکانی کوردی');
update public.owner_application_cottage_profiles
set current_shift_schedule_id='30000000-0000-4000-8000-000000001001',
  current_publication_id='47300000-0000-4000-8000-000000001001'
where id='20000000-0000-4000-8000-000000001001';
update public.cottage_marketplace_listings
set public_slug='cottage-deadbeefdeadbeefdeadbeefdead1001'
where profile_id='20000000-0000-4000-8000-000000001001';

insert into auth.users(id,aud,role,phone) values
  ('10000000-0000-4000-8000-000000001004','authenticated','authenticated','+9647500001004');
insert into public.account_contexts(user_id,role) values
  ('10000000-0000-4000-8000-000000001004','customer');
insert into auth.users(id,aud,role,email,email_confirmed_at) values
  ('10000000-0000-4000-8000-000000003802','authenticated','authenticated','second-review-admin@example.test',clock_timestamp());
insert into public.account_contexts(user_id,role) values
  ('10000000-0000-4000-8000-000000003802','platform_administrator');

select ok(
  (select public.booking_request_payment_status(requests)='paid-confirmed'
    from public.booking_requests requests
    where requests.id='60000000-0000-4000-8000-000000001001')
  and public.booking_completion_eligibility_at(
    '60000000-0000-4000-8000-000000001001',clock_timestamp()
  )->>'status'='completed'
  and public.is_cottage_publicly_discoverable('20000000-0000-4000-8000-000000001001'),
  'the fixture is authoritatively paid, completed and publicly discoverable before reviews are observed'
);

select ok(
  public.booking_review_is_available(
    '2101-01-02 23:00+00','2101-01-16 23:00+00','2101-01-02 23:00+00'
  )
  and public.booking_review_is_available(
    '2101-01-02 23:00+00','2101-01-16 23:00+00','2101-01-16 22:59:59.999999+00'
  )
  and not public.booking_review_is_available(
    '2101-01-02 23:00+00','2101-01-16 23:00+00','2101-01-16 23:00+00'
  ),
  'review admission uses the hand-computed half-open fourteen-day window'
);

select ok(
  public.contact_protection_text_is_safe('A peaceful stay.')
  and public.contact_protection_text_is_safe('إقامة هادئة وجميلة')
  and public.contact_protection_text_is_safe('شوێنێکی ئارام و جوان بوو')
  and not public.contact_protection_text_is_safe('+964 (750) 123-4567')
  and not public.contact_protection_text_is_safe('٠٧٥٠ ١٢٣ ٤٥٦٧')
  and not public.contact_protection_text_is_safe('۰۷۵۰ ۱۲۳ ۴۵۶۷')
  and not public.contact_protection_text_is_safe('0' || U&'\200B' || '7501234567')
  and not public.contact_protection_text_is_safe('reviewer@example.test')
  and not public.contact_protection_text_is_safe('https://example.test')
  and not public.contact_protection_text_is_safe('example.test')
  and not public.contact_protection_text_is_safe('@reviewer')
  and not public.contact_protection_text_is_safe('WhatsApp me')
  and not public.contact_protection_text_is_safe('seven five zero one two three four'),
  'the existing contact filter covers fixed multilingual, separator, invisible, link, email, handle and obfuscation examples'
);

select ok(
  not has_table_privilege('anon','public.customer_reviews','SELECT')
  and not has_table_privilege('authenticated','public.customer_reviews','INSERT')
  and not has_table_privilege('service_role','public.customer_reviews','SELECT')
  and not has_table_privilege('authenticated','public.customer_review_hides','SELECT')
  and has_function_privilege('anon','public.list_public_customer_reviews(text,timestamptz,uuid,integer)','EXECUTE')
  and not has_function_privilege('anon','public.submit_customer_review(text,integer,public.cottage_profile_source_language,text)','EXECUTE')
  and not has_function_privilege('service_role','public.hide_customer_review(uuid,text)','EXECUTE'),
  'direct table access is denied and only narrow RPC execution is granted'
);

set local role anon;
select is(
  public.list_public_customer_reviews('missing-cottage', null, null, 20)->>'status',
  'not-found',
  'anonymous public review reading distinguishes a missing cottage without requiring an identity'
);
reset role;

select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select throws_ok(
  $$select public.submit_customer_review('RC-REQ-0000000000001001',5,'en','Safe')$$,
  '42501',null,'review submission denies missing identity'
);
select throws_ok(
  $$select public.get_customer_review('RC-REQ-0000000000001001')$$,
  '42501',null,'the own-review reader denies missing identity'
);
select throws_ok(
  $$select public.list_administrator_customer_reviews(null,null,50)$$,
  '42501',null,'the administrator reader denies missing identity'
);
select throws_ok(
  $$select public.hide_customer_review(gen_random_uuid(),'Reason')$$,
  '42501',null,'review hiding denies missing identity'
);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001003',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001003","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok(
  $$select public.submit_customer_review('RC-REQ-0000000000001001',5,'en','Safe')$$,
  '42501',null,'another Customer cannot submit against an unrelated booking'
);
select throws_ok(
  $$select public.get_customer_review('RC-REQ-0000000000001001')$$,
  '42501',null,'another Customer cannot read an unrelated review state'
);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001004',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001004","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok(
  $$select public.submit_customer_review('RC-REQ-0000000000001001',5,'en','Safe')$$,
  '42501',null,'review submission requires a phone-confirmed identity'
);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1"}',
  true
);
set local role authenticated;
select is(
  public.submit_customer_review('RC-REQ-0000000000001001',0,'en','Safe')->>'status',
  'invalid','ratings outside one to five are rejected'
);
select is(
  public.submit_customer_review('RC-REQ-0000000000001001',5,'en',repeat('x',2001))->>'status',
  'invalid','review bodies over two thousand Unicode characters are rejected'
);
select is(
  public.submit_customer_review('RC-REQ-0000000000001001',5,'ar','اتصل ٠٧٥٠ ١٢٣ ٤٥٦٧')->>'status',
  'prohibited-content','contact-bearing review text is rejected before insertion'
);
reset role;
select is(
  (select count(*)::integer from public.customer_reviews),0,
  'invalid and prohibited submissions publish no review'
);

delete from public.cottage_marketplace_listings
where profile_id='20000000-0000-4000-8000-000000001001';
set local role authenticated;
select is(
  public.submit_customer_review(
    'RC-REQ-0000000000001001',5,'en','Missing-listing attempt'
  )->>'status',
  'unavailable',
  'submission refuses to insert when its authoritative marketplace listing is missing'
);
reset role;
select is(
  (select count(*)::integer from public.customer_reviews),0,
  'missing mutation targets leave no review behind'
);
insert into public.cottage_marketplace_listings(profile_id,public_slug,state)
values(
  '20000000-0000-4000-8000-000000001001',
  'cottage-deadbeefdeadbeefdeadbeefdead1001','paused'
);
set local role authenticated;
create temp table submitted_review_result as
select public.submit_customer_review(
    'RC-REQ-0000000000001001',5,'en','A peaceful stay with a lovely garden.'
  ) value;
select ok(
  (select value->>'status'='submitted'
    and value->>'affectedPublicSlug'='cottage-deadbeefdeadbeefdeadbeefdead1001'
    and (select array_agg(key order by key) from jsonb_object_keys(value) key)
      =array['affectedPublicSlug','reviewId','status','submittedAt']
  from submitted_review_result),
  'new submission returns the exact stored mutation target even while the listing is paused'
);
select is(
  public.submit_customer_review(
    'RC-REQ-0000000000001001',1,'ckb','Different replay body'
  )->>'status',
  'duplicate',
  'a replay returns duplicate without changing the original review'
);
select ok(
  (
    with replay as (
      select public.submit_customer_review(
        'RC-REQ-0000000000001001',1,'ckb','Different replay body'
      ) value
    )
    select (select array_agg(key order by key) from jsonb_object_keys(value) key)
      =array['reviewId','status','submittedAt']
    from replay
  ),
  'submission replay omits mutation target metadata'
);
reset role;

update public.cottage_marketplace_listings
set state='published'
where profile_id='20000000-0000-4000-8000-000000001001';

set local role anon;
select ok(
  (
    with result as (
      select public.list_public_customer_reviews(
        'cottage-deadbeefdeadbeefdeadbeefdead1001',null,null,20
      ) value
    )
    select value->>'status'='success'
      and jsonb_array_length(value->'items')=1
      and (value#>>'{items,0,rating}')::integer=5
      and value#>>'{items,0,originalBody}'='A peaceful stay with a lovely garden.'
      and (select array_agg(key order by key) from jsonb_object_keys(value#>'{items,0}') key)
        =array['originalBody','originalLanguage','rating','reviewId','submittedAt']
    from result
  ),
  'anonymous public review reading returns only the admitted public projection'
);
reset role;

create or replace function public.contact_protection_text_is_safe(target_value text)
returns boolean language sql immutable set search_path='' as $$select false$$;

set local role anon;
select is(
  jsonb_array_length(public.list_public_customer_reviews(
    'cottage-deadbeefdeadbeefdeadbeefdead1001',null,null,20
  )->'items'),
  1,
  'later contact-filter changes do not silently alter public review visibility'
);
reset role;

create temp table own_review_expected as
select jsonb_build_object(
  'status','submitted',
  'reviewId',reviews.id,
  'rating',5,
  'originalLanguage','en',
  'originalBody','A peaceful stay with a lovely garden.',
  'submittedAt',reviews.submitted_at,
  'moderationState','unhidden'
) value
from public.customer_reviews reviews
where reviews.booking_request_id='60000000-0000-4000-8000-000000001001';
grant select on own_review_expected to authenticated;

set local role authenticated;
select is(
  public.get_customer_review('RC-REQ-0000000000001001'),
  (select value from own_review_expected),
  'the Customer reader returns the immutable original and moderation state for its own review'
);
reset role;

update public.account_contexts
set role='cottage_owner',owner_approval_state='approved'
where user_id='10000000-0000-4000-8000-000000001002';
set local role authenticated;
select ok(
  public.submit_customer_review(
    'RC-REQ-0000000000001001',5,'en','Safe owner-capable replay'
  )->>'status'='duplicate'
  and public.get_customer_review('RC-REQ-0000000000001001')->>'status'='submitted',
  'an Owner Account retains Customer capability for another Cottage Owners booking'
);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003801',true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000003801","role":"authenticated","aal":"aal1"}',
  true
);
set local role authenticated;
select throws_ok(
  format(
    'select public.hide_customer_review(%L,%L)',
    (select value->>'reviewId' from own_review_expected),'Reason'
  ),
  '42501',null,'an AAL1 administrator cannot hide a review'
);
select throws_ok(
  $$select public.list_administrator_customer_reviews(null,null,50)$$,
  '42501',null,'an AAL1 administrator cannot list private review facts'
);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003801',true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000003801","role":"authenticated","aal":"aal2"}',
  true
);
reset role;
delete from public.cottage_marketplace_listings
where profile_id='20000000-0000-4000-8000-000000001001';
set local role authenticated;
select is(
  public.hide_customer_review(
    ((select value from own_review_expected)->>'reviewId')::uuid,
    'Missing-listing moderation attempt'
  )->>'status',
  'unavailable',
  'hiding refuses to insert when authoritative mutation targets are missing'
);
reset role;
select is(
  (select count(*)::integer from public.customer_review_hides),0,
  'missing moderation targets leave no hide behind'
);
insert into public.cottage_marketplace_listings(profile_id,public_slug,state)
values(
  '20000000-0000-4000-8000-000000001001',
  'cottage-deadbeefdeadbeefdeadbeefdead1001','paused'
);
set local role authenticated;
create temp table hidden_review_result as
select public.hide_customer_review(
    ((select value from own_review_expected)->>'reviewId')::uuid,
    'Contains prohibited contact details'
  ) value;
select ok(
  (select value->>'status'='hidden'
    and value->>'affectedPublicSlug'='cottage-deadbeefdeadbeefdeadbeefdead1001'
    and value->>'affectedBookingRequestReference'='RC-REQ-0000000000001001'
    and (select array_agg(key order by key) from jsonb_object_keys(value) key)
      =array[
        'administratorUserId','affectedBookingRequestReference',
        'affectedPublicSlug','hiddenAt','reason','reviewId','status'
      ]
  from hidden_review_result),
  'new hide returns exact stored targets and first attribution while the listing is paused'
);

select ok(
  (
    with result as (
      select public.list_administrator_customer_reviews(null,null,50) value
    )
    select value->>'status'='success'
      and jsonb_array_length(value->'items')=1
      and value#>>'{items,0,originalBody}'='A peaceful stay with a lovely garden.'
      and value#>>'{items,0,authorUserId}'='10000000-0000-4000-8000-000000001002'
      and value#>>'{items,0,bookingRequestReference}'='RC-REQ-0000000000001001'
      and value#>>'{items,0,moderationState}'='hidden'
      and value#>>'{items,0,hide,administratorUserId}'='10000000-0000-4000-8000-000000003801'
      and value#>>'{items,0,hide,reason}'='Contains prohibited contact details'
    from result
  ),
  'the AAL2 administrator list retains the original and first hide attribution'
);
reset role;

update public.cottage_marketplace_listings
set state='published'
where profile_id='20000000-0000-4000-8000-000000001001';

set session_replication_role=replica;
insert into public.booking_requests
select (jsonb_populate_record(
  null::public.booking_requests,
  to_jsonb(requests)||jsonb_build_object(
    'id','86000000-0000-4000-8000-000000001002',
    'booking_request_reference','RC-REQ-0000000000001002',
    'booking_snapshot_id','84000000-0000-4000-8000-000000001002',
    'booking_period_commitment_id','85000000-0000-4000-8000-000000001002',
    'payment_lifecycle_id','83000000-0000-4000-8000-000000001002'
  )
)).*
from public.booking_requests requests
where requests.id='60000000-0000-4000-8000-000000001001';
insert into public.customer_reviews(
  id,booking_request_id,booking_confirmation_id,profile_id,author_user_id,
  rating,original_language,original_body,submitted_at
)
select
  '88000000-0000-4000-8000-000000001002',
  '86000000-0000-4000-8000-000000001002',
  '87000000-0000-4000-8000-000000001002',
  reviews.profile_id,reviews.author_user_id,4,'ar','مراجعة ثانية آمنة',
  reviews.submitted_at
from public.customer_reviews reviews
where reviews.booking_request_id='60000000-0000-4000-8000-000000001001';
set session_replication_role=origin;

set local role authenticated;
select ok(
  (
    with first_page as (
      select public.list_administrator_customer_reviews(null,null,1) value
    ), second_page as (
      select public.list_administrator_customer_reviews(
        (value#>>'{nextCursor,submittedAt}')::timestamptz,
        (value#>>'{nextCursor,reviewId}')::uuid,
        1
      ) value
      from first_page
    ), observed as (
      select value#>>'{items,0,reviewId}' review_id from first_page
      union all
      select value#>>'{items,0,reviewId}' from second_page
    )
    select count(*)=2
      and count(distinct review_id)=2
      and array_agg(review_id order by review_id)=array(
        select value
        from unnest(array[
          (select value->>'reviewId' from own_review_expected),
          '88000000-0000-4000-8000-000000001002'
        ]::text[]) value
        order by value
      )
    from observed
  ),
  'equal-timestamp administrator cursor pages neither skip nor duplicate reviews'
);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003802',true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000003802","role":"authenticated","aal":"aal2"}',
  true
);
set local role authenticated;
select ok(
  public.hide_customer_review(
    ((select value from own_review_expected)->>'reviewId')::uuid,
    'Replacement reason'
  )->>'status'='already-hidden'
  and public.hide_customer_review(
    ((select value from own_review_expected)->>'reviewId')::uuid,
    'Replacement reason'
  )->>'administratorUserId'='10000000-0000-4000-8000-000000003801'
  and public.hide_customer_review(
    ((select value from own_review_expected)->>'reviewId')::uuid,
    'Replacement reason'
  )->>'reason'='Contains prohibited contact details',
  'hide replay retains the first administrator and reason'
);
select ok(
  (
    with replay as (
      select public.hide_customer_review(
        ((select value from own_review_expected)->>'reviewId')::uuid,
        'Replacement reason'
      ) value
    )
    select (select array_agg(key order by key) from jsonb_object_keys(value) key)
      =array['administratorUserId','hiddenAt','reason','reviewId','status']
    from replay
  ),
  'hide replay omits mutation target metadata'
);
reset role;

set local role anon;
select is(
  jsonb_array_length(public.list_public_customer_reviews(
    'cottage-deadbeefdeadbeefdeadbeefdead1001',null,null,20
  )->'items'),
  0,
  'an audited hide removes the review from every public RPC projection'
);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(
  public.get_customer_review('RC-REQ-0000000000001001')->>'moderationState',
  'hidden','the Customer reader retains its submitted review with hidden moderation state'
);
reset role;

select throws_ok(
  $$update public.customer_reviews set original_body='overwritten'$$,
  'RC409',null,'review originals cannot be updated'
);
select throws_ok(
  $$delete from public.customer_reviews$$,
  'RC409',null,'review originals cannot be deleted'
);
select throws_ok(
  $$update public.customer_review_hides set reason='overwritten'$$,
  'RC409',null,'hide attribution cannot be updated'
);
select throws_ok(
  $$delete from public.customer_review_hides$$,
  'RC409',null,'hide attribution cannot be deleted'
);

select ok(
  (select count(*)=1 from pg_constraint where conname='customer_reviews_booking_request_id_key')
  and (select count(*)=6 from pg_constraint where conname in (
    'customer_reviews_booking_request_id_fkey',
    'customer_reviews_booking_confirmation_id_fkey',
    'customer_reviews_profile_id_fkey',
    'customer_reviews_author_user_id_fkey',
    'customer_review_hides_review_id_fkey',
    'customer_review_hides_administrator_user_id_fkey'
  ))
  and (select indexdef like '%(profile_id, submitted_at DESC, id DESC)'
    from pg_indexes where indexname='customer_reviews_profile_cursor_idx')
  and (select indexdef like '%(submitted_at DESC, id DESC)'
    from pg_indexes where indexname='customer_reviews_administrator_cursor_idx'),
  'review keys and both deterministic cursor indexes are present'
);

select * from finish();
rollback;
