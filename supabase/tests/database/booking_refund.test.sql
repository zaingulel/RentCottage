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
-- BEGIN CANCELLATION FIXTURE
create function pg_temp.seed_cancellation_booking(start_day date,supplier_environment text default 'local-test') returns void language plpgsql as $seed_function$
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
declare lifecycle text:='73000000-0000-4000-8000-000000001001';
declare fingerprint text;
begin
  fingerprint:=encode(extensions.digest('{"provider":{"provider":"fictional-payments","environment":"'||supplier_environment||'","merchantId":"fictional-merchant","terminalId":"fictional-terminal"},"kind":"capture","paymentLifecycleId":"'||lifecycle||'","logicalOperationId":"'||lifecycle||':capture","attemptId":"'||lifecycle||':capture:attempt-2","amountFils":115000000,"currency":"IQD"}','sha256'),'hex');
  fixture:=replace(fixture,'6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d',fingerprint);
  fixture:=replace(fixture,'local-test',supplier_environment);
  fixture:=replace(fixture,'2101-01-02',(start_day+1)::text);
  fixture:=replace(fixture,'2101-01-01',start_day::text);
  fixture:=replace(fixture,'2100-12-31',(start_day-1)::text);
  execute fixture;
end;
$seed_function$;
-- END CANCELLATION FIXTURE
select no_plan();
-- The oracle reads the stored intent as the test owner; API roles cannot.
create function pg_temp.refund_intent_day(target_command_id uuid) returns date language sql security definer as $$
 select (created_at at time zone 'Asia/Baghdad')::date from public.booking_refund_intents where command_id=target_command_id;
$$;
savepoint hosted_refund;
select pg_temp.seed_cancellation_booking('2101-01-01','hosted-demo-yvibcyqtyihpzpmomnzg');
select is((select request_fingerprint from public.payment_provider_operations where payment_lifecycle_id='73000000-0000-4000-8000-000000001001' and operation_kind='capture'),
  'f71cf4b10a334a8ead3094ea8ed0c5f5974d84c7999f26b015074d9fc7d1dd31','hosted refund fixture uses the independently verified capture fingerprint');
select is((select amount_fils from public.payment_provider_operations where payment_lifecycle_id='73000000-0000-4000-8000-000000001001' and operation_kind='capture'),
  115000000::bigint,'hosted refund retains the original captured total');
create temp table hosted_refund_capture as select to_jsonb(operations) original from public.payment_provider_operations operations
  where payment_lifecycle_id='73000000-0000-4000-8000-000000001001' and operation_kind='capture';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003801',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003801","aal":"aal2"}',true);
create temp table hosted_refund_intent as select public.request_booking_refund_exception(
  '60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003819','Hosted compensation',
  '{"bookingPriceFils":30000000,"bookingServiceFeeFils":1000000}') result;
grant select on hosted_refund_intent to service_role;
set local role service_role;
create temp table hosted_refund_claim as select public.claim_booking_refund((result->>'intentId')::uuid) result from hosted_refund_intent;
grant select on hosted_refund_claim to anon,authenticated;
select is((select result->>'status' from hosted_refund_claim),'execute','hosted refund command obtains a fenced execution permit');
select is((select result#>'{request,executionPermit,binding,providerIdentity}' from hosted_refund_claim),
  '{"provider":"fictional-payments","environment":"hosted-demo-yvibcyqtyihpzpmomnzg","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb,
  'hosted refund permit retains the authoritative capture identity');
select throws_ok(format('select public.admit_booking_refund(%L::jsonb)',invalid.permit),
  'RC409','Refund admission binding is invalid',invalid.description)
from (select jsonb_set(result#>'{request,executionPermit}','{binding,captureOperationId}','"80000000-0000-4000-8000-000000000000"') permit,'hosted refund rejects forged capture' description from hosted_refund_claim
  union all select jsonb_set(result#>'{request,executionPermit}','{binding,amountFils}','31000010'),'hosted refund rejects forged amount' from hosted_refund_claim
  union all select jsonb_set(result#>'{request,executionPermit}','{generation}','2'),'hosted refund rejects forged generation' from hosted_refund_claim
  union all select jsonb_set(result#>'{request,executionPermit}','{leaseToken}','"90000000-0000-4000-8000-000000003899"'),'hosted refund rejects forged lease' from hosted_refund_claim
  union all select jsonb_set(result#>'{request,executionPermit}','{binding,providerIdentity,provider}','"foreign-provider"'),'hosted refund rejects foreign provider' from hosted_refund_claim
  union all select jsonb_set(result#>'{request,executionPermit}','{binding,providerIdentity,environment}','"local-test"'),'hosted refund rejects a mismatched local environment' from hosted_refund_claim
  union all select jsonb_set(result#>'{request,executionPermit}','{binding,providerIdentity,environment}','"unknown"'),'hosted refund rejects unknown environment' from hosted_refund_claim
  union all select jsonb_set(result#>'{request,executionPermit}','{binding,providerIdentity,merchantId}','"foreign-merchant"'),'hosted refund rejects foreign merchant' from hosted_refund_claim
  union all select jsonb_set(result#>'{request,executionPermit}','{binding,providerIdentity,terminalId}','"foreign-terminal"'),'hosted refund rejects foreign terminal' from hosted_refund_claim
  union all select jsonb_set(result#>'{request,executionPermit}','{binding,providerIdentity}','null'),'hosted refund rejects null identity' from hosted_refund_claim
  union all select (result#>'{request,executionPermit}')#-'{binding,providerIdentity}','hosted refund rejects missing identity' from hosted_refund_claim) invalid;
set local role anon;
select throws_ok($$select public.admit_booking_refund((select result#>'{request,executionPermit}' from hosted_refund_claim))$$,
  '42501',null,'anonymous callers cannot admit a hosted refund');
set local role authenticated;
select throws_ok($$select public.admit_booking_refund((select result#>'{request,executionPermit}' from hosted_refund_claim))$$,
  '42501',null,'authenticated callers cannot admit a hosted refund');
set local role service_role;
create temp table hosted_refund_admission(result jsonb);
select lives_ok($$insert into hosted_refund_admission select public.admit_booking_refund(result#>'{request,executionPermit}') from hosted_refund_claim$$,
  'approved hosted fictional refund admission preserves its capture binding');
select is((select result->>'mode' from hosted_refund_admission),'execute','first hosted refund admission authorizes execution');
create temp table hosted_refund_replay(result jsonb);
select lives_ok($$insert into hosted_refund_replay select public.admit_booking_refund(result#>'{request,executionPermit}') from hosted_refund_claim$$,
  'hosted refund permit can be replayed without a second admission');
select is((select result->>'mode' from hosted_refund_replay),'reconcile','duplicate hosted refund permit grants inquiry only');
select is((select result->>'operationId' from hosted_refund_replay),(select result->>'operationId' from hosted_refund_admission),
  'hosted refund replay retains the same operation identity');
create temp table hosted_refund_effect(result jsonb);
select lives_ok($$insert into hosted_refund_effect select public.persist_simulated_payment_effect(result-array['purpose','binding','mode'],
  jsonb_build_object('outcome','succeeded','providerRequestId','hosted-refund-request','providerReference','hosted-refund-reference','movementReference','hosted-refund-movement',
    'evidence',jsonb_build_object('operationId',result->>'operationId','eventId','hosted-refund-event','provenance','fictional-provider',
      'originalOutcome','succeeded','executedAt',clock_timestamp(),'occurredAt',clock_timestamp(),'closedAt',null))) from hosted_refund_admission$$,
  'hosted refund executes through the durable effect store');
create temp table hosted_refund_recorded(result jsonb);
select lives_ok($$insert into hosted_refund_recorded select public.record_booking_request_payment_observation((admission.result->>'operationId')::uuid,effect.result,
  jsonb_build_object('revision',public.get_booking_request_payment_observation_facts((admission.result->>'operationId')::uuid)->>'revision',
    'recoveryState',null,'quarantineReason',null,'correctiveCaptureId',null)) from hosted_refund_admission admission cross join hosted_refund_effect effect$$,
  'hosted refund records authoritative receipt and application consequences');
select is(public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')->'refunded',
  '{"bookingPriceFils":30000000,"bookingServiceFeeFils":1000000}'::jsonb,'hosted refund records the exact permitted allocation');
select lives_ok($$select public.persist_simulated_payment_effect(admission.result-array['purpose','binding','mode'],effect.result)
  from hosted_refund_admission admission cross join hosted_refund_effect effect$$,'hosted refund effect replay preserves the original execution');
reset role;
select is((select jsonb_build_object('provider',provider,'environment',environment,'merchantId',merchant_id,'terminalId',terminal_id)
  from public.payment_provider_operations where id=(select (result->>'operationId')::uuid from hosted_refund_admission)),
  '{"provider":"fictional-payments","environment":"hosted-demo-yvibcyqtyihpzpmomnzg","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb,
  'hosted refund ledger retains the exact capture supplier identity');
select ok((select ledger.amount_fils=31000000 and ledger.current_outcome='succeeded' and ledger.movement_reference='hosted-refund-movement'
  and ledger.admission->'permit'=claim.result#>'{request,executionPermit}'
  and ledger.admission#>>'{permit,binding,captureOperationId}'=(select original->>'id' from hosted_refund_capture)
  from public.payment_provider_operations ledger cross join hosted_refund_claim claim
  where ledger.id=(select (result->>'operationId')::uuid from hosted_refund_admission)),
  'hosted refund preserves the full permit, capture linkage, amount and recorded outcome');
select is((select physical_execution_count::integer from public.simulated_payment_effects
  where operation_id=(select (result->>'operationId')::uuid from hosted_refund_admission)),1,'hosted refund replay has one physical execution');
select is((select result from public.payment_provider_observations where operation_id=(select (result->>'operationId')::uuid from hosted_refund_admission)),
  (select result from hosted_refund_effect),'hosted refund observation preserves its authoritative supplier receipt');
select is((select count(*)::integer from public.booking_request_payment_history where provider_operation_id=(select (result->>'operationId')::uuid from hosted_refund_admission)
  and operation_kind='refund' and outcome='succeeded'),1,'hosted refund has one authoritative successful history entry');
select is((select count(*)::integer from public.booking_notification_events where refund_intent_id=(select (result->>'intentId')::uuid from hosted_refund_intent)
  and event_kind='refund_returned'),2,'hosted refund retains one returned event for each original receipt recipient');
select is((select to_jsonb(operations) from public.payment_provider_operations operations
  where payment_lifecycle_id='73000000-0000-4000-8000-000000001001' and operation_kind='capture'),
  (select original from hosted_refund_capture),'hosted refund never rewrites the original capture evidence');
rollback to hosted_refund;
select pg_temp.seed_cancellation_booking('2101-01-01');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
select throws_ok($$select public.request_booking_refund_exception('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003810','Compensation','{"bookingPriceFils":30000000,"bookingServiceFeeFils":1000000}')$$,'42501',null,'customer cannot authorize an exception');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003801',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003801","aal":"aal2"}',true);
select lives_ok($$select public.request_booking_refund_exception('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003810','Compensation','{"bookingPriceFils":30000000,"bookingServiceFeeFils":1000000}')$$,'administrator explicitly reserves price and fee');
select is(public.search_administrator_booking_queue('refunds',null,null,null,null,null)->>'total','1','refund queue holds the one requested exception');
select is((public.search_administrator_booking_queue('refunds',null,null,null,null,null)#>'{rows,0}')-array['id','at'],'{"reference":"RC-REQ-0000000000001001","state":"requested","source":"administrator","category":null}'::jsonb,'refund row carries its derived state and source, and no reason or amount');
select is(public.search_administrator_booking_queue('refunds',null,null,null,null,null)#>>'{stateCounts,requested}','1','refund queue counts the requested exception');
select is(public.search_administrator_booking_queue('refunds',null,pg_temp.refund_intent_day('90000000-0000-4000-8000-000000003810')+1,null,null,null),'{"queue":"refunds","rows":[],"total":0,"stateCounts":{"requested":0,"processing":0,"succeeded":0,"failed":0,"unknown":0},"nextCursor":null}'::jsonb,'refund queue window starting the day after the request has no rows and zero counts');
select throws_ok($$select public.request_booking_refund_exception('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003811','Excess','{"bookingPriceFils":80000010,"bookingServiceFeeFils":4000000}')$$,'RC409',null,'pending allocation cannot be spent twice');

select throws_ok($$select public.request_booking_refund_exception('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003810','Changed reason','{"bookingPriceFils":30000000,"bookingServiceFeeFils":1000000}')$$,'RC409',null,'changed payload cannot reuse the exception command');
select lives_ok($$select public.request_booking_refund_exception('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003810','Compensation','{"bookingPriceFils":30000000,"bookingServiceFeeFils":1000000}')$$,'same command replays the original intent');
select throws_ok($$select public.request_booking_refund_exception('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003812',' ','{"bookingPriceFils":10,"bookingServiceFeeFils":0}')$$,'22023',null,'blank administrator reason is denied');
select throws_ok($$select public.request_booking_refund_exception('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003812','Fractional commission','{"bookingPriceFils":11,"bookingServiceFeeFils":0}')$$,'22023',null,'commission must remain exact in fils');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003801","aal":"aal1"}',true);
select throws_ok($$select public.request_booking_refund_exception('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003812','Weak assurance','{"bookingPriceFils":10,"bookingServiceFeeFils":0}')$$,'42501',null,'administrator requires strong authentication');
reset role;
select is((select count(*)::integer from public.booking_refund_intents where booking_request_id='60000000-0000-4000-8000-000000001001'),1,'one immutable reservation survives command replay');
select ok((select actor_user_id='10000000-0000-4000-8000-000000003801' and reason='Compensation' and source='administrator' from public.booking_refund_intents where command_id='90000000-0000-4000-8000-000000003810'),'exception retains administrator attribution and reason');
select throws_ok($$update public.booking_refund_intents set booking_price_fils=10$$,'RC409',null,'allocation history cannot be rewritten');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.booking_refund_intents'::regclass,'public.booking_refund_attempts'::regclass)),'refund tables enforce Row Level Security');
select ok(not has_table_privilege('authenticated','public.booking_refund_intents','SELECT') and not has_table_privilege('service_role','public.booking_refund_intents','INSERT'),'refund facts cannot bypass command authority');
create temp table refund_test_values(key text primary key,value jsonb);
grant all on refund_test_values to service_role,authenticated;
insert into refund_test_values select 'first-intent',to_jsonb(id) from public.booking_refund_intents where command_id='90000000-0000-4000-8000-000000003810';
create function pg_temp.refund_value(key text) returns jsonb language sql as $$select value from refund_test_values where refund_test_values.key=$1$$;
create function pg_temp.refund_proposal(admission jsonb,outcome text) returns jsonb language sql as $$
  select jsonb_build_object('outcome',outcome,'providerRequestId','refund-request-'||(admission->>'operationId'),'providerReference','refund-reference-'||(admission->>'operationId'),
    'evidence',jsonb_build_object('operationId',admission->>'operationId','eventId','refund-event-'||(admission->>'operationId')||'-'||outcome,'provenance','fictional-provider','originalOutcome',outcome,'executedAt',clock_timestamp(),'occurredAt',case when outcome<>'indeterminate' then clock_timestamp() end,'closedAt',null))
    ||case when outcome='failed' then jsonb_build_object('retrySafe',false) else jsonb_build_object('movementReference','refund-movement-'||(admission->>'operationId')) end;
$$;
create function pg_temp.refund_record(admission jsonb,result jsonb) returns jsonb language sql as $$
  select public.record_booking_request_payment_observation((admission->>'operationId')::uuid,result,
    jsonb_build_object('revision',public.get_booking_request_payment_observation_facts((admission->>'operationId')::uuid)->>'revision','recoveryState',null,'quarantineReason',null,'correctiveCaptureId',null));
$$;
set local role service_role;
insert into refund_test_values values('first-claim',public.claim_booking_refund((pg_temp.refund_value('first-intent')#>>'{}')::uuid));
select is(pg_temp.refund_value('first-claim')->>'status','execute','first worker receives a fenced execution request');
select is(public.claim_booking_refund((pg_temp.refund_value('first-intent')#>>'{}')::uuid)->>'status','processing','concurrent claim cannot execute before admission');
select throws_ok($$select public.admit_booking_refund(jsonb_set(pg_temp.refund_value('first-claim')#>'{request,executionPermit}','{binding,captureOperationId}','"80000000-0000-4000-8000-000000000000"'))$$,'RC409',null,'forged capture binding cannot be admitted');
savepoint closed_refund_attempt;
insert into refund_test_values values('closed-admission',public.admit_booking_refund(pg_temp.refund_value('first-claim')#>'{request,executionPermit}'));
insert into refund_test_values values('closed-effect',public.seal_simulated_payment_absence(pg_temp.refund_value('closed-admission')-array['purpose','binding','mode']));
select pg_temp.refund_record(pg_temp.refund_value('closed-admission'),pg_temp.refund_value('closed-effect'));
select is(public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')->'reserved','{"bookingPriceFils":30000000,"bookingServiceFeeFils":1000000}'::jsonb,'closed attempt preserves the logical refund reservation');
insert into refund_test_values values('replacement-claim',public.claim_booking_refund((pg_temp.refund_value('first-intent')#>>'{}')::uuid));
select is(pg_temp.refund_value('replacement-claim')#>>'{request,executionPermit,generation}','2','verified absence permits a new physical generation for the same intent');
select isnt(pg_temp.refund_value('replacement-claim')#>>'{request,attemptId}',pg_temp.refund_value('first-claim')#>>'{request,attemptId}','replacement generation has a different physical identity');
select is(public.admit_booking_refund(pg_temp.refund_value('first-claim')#>'{request,executionPermit}')->>'mode','reconcile','stale admitted generation can only inquire about its original identity');
select is(public.persist_simulated_payment_effect(pg_temp.refund_value('closed-admission')-array['purpose','binding','mode'],pg_temp.refund_proposal(pg_temp.refund_value('closed-admission'),'succeeded'))->>'outcome','not-executed','stale supplier execution cannot reopen a closed refund attempt');
select is(public.admit_booking_refund(pg_temp.refund_value('replacement-claim')#>'{request,executionPermit}')->>'mode','execute','only the replacement generation has new execution authority');
rollback to closed_refund_attempt;
insert into refund_test_values values('first-admission',public.admit_booking_refund(pg_temp.refund_value('first-claim')#>'{request,executionPermit}'));
insert into refund_test_values values('first-effect',public.persist_simulated_payment_effect(pg_temp.refund_value('first-admission')-array['purpose','binding','mode'],pg_temp.refund_proposal(pg_temp.refund_value('first-admission'),'succeeded')));
select is(public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')#>>'{refunded,bookingPriceFils}','0','supplier effect is not presented as returned before verified local recording');
select is(public.claim_booking_refund((pg_temp.refund_value('first-intent')#>>'{}')::uuid)->>'status','query','restart discovers original admission rather than a new execute');
select is(public.admit_booking_refund(pg_temp.refund_value('first-claim')#>'{request,executionPermit}')->>'mode','reconcile','duplicate execution permit becomes inquiry');
select lives_ok($$select pg_temp.refund_record(pg_temp.refund_value('first-admission'),public.seal_simulated_payment_absence(pg_temp.refund_value('first-admission')-array['purpose','binding','mode']))$$,'restart records the supplier effect under original operation identity');
select is(public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')->'refunded','{"bookingPriceFils":30000000,"bookingServiceFeeFils":1000000}'::jsonb,'verified partial allocation is exact');
select ok((public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')->>'bookingRequestId')='60000000-0000-4000-8000-000000001001','valid partial refund is recognized by shared observation');
select lives_ok($$select public.persist_simulated_payment_effect(pg_temp.refund_value('first-admission')-array['purpose','binding','mode'],pg_temp.refund_proposal(pg_temp.refund_value('first-admission'),'succeeded'))$$,'replayed supplier execution returns the same effect');
reset role;
select is((select physical_execution_count::integer from public.simulated_payment_effects where operation_id=(pg_temp.refund_value('first-admission')->>'operationId')::uuid),1,'interruption and replay cause exactly one physical execution');
select is((select count(*)::integer from public.booking_notification_events where refund_intent_id=(pg_temp.refund_value('first-intent')#>>'{}')::uuid and event_kind='refund_returned'),2,'verified refund has one event per original recipient');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003801","aal":"aal2"}',true);
insert into refund_test_values values('second-intent',public.request_booking_refund_exception('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003813','Second partial','{"bookingPriceFils":20000000,"bookingServiceFeeFils":1000000}')->'intentId');
select is(public.search_administrator_booking_queue('refunds',null,null,null,null,null)->>'total','2','refund queue holds both exceptions');
select is(public.search_administrator_booking_queue('refunds',null,null,null,null,null)->'stateCounts','{"requested":1,"processing":0,"succeeded":1,"failed":0,"unknown":0}'::jsonb,'refund queue counts the verified and the requested exception separately');
select is(public.search_administrator_booking_queue('refunds','succeeded',null,null,null,null)->>'total','1','refund queue filters by derived state');
select is(public.search_administrator_booking_queue('refunds','succeeded',null,null,null,null)#>>'{rows,0,id}',pg_temp.refund_value('first-intent')#>>'{}','the succeeded refund row is the first intent');
create temp table refund_queue_after_newest as select public.search_administrator_booking_queue('refunds',null,null,null,(newest.result#>>'{rows,0,at}')::timestamptz,(newest.result#>>'{rows,0,id}')::uuid) result from (select public.search_administrator_booking_queue('refunds',null,null,null,null,null) result) newest;
select is((select jsonb_array_length(result->'rows') from refund_queue_after_newest),1,'a cursor at the newest refund leaves one older row');
select is((select result->>'total' from refund_queue_after_newest),'2','the refund total ignores the cursor');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001001","aal":"aal1"}',true);
select public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003814','cottage_owner','Unavailable',null,
  jsonb_build_object('revision',public.get_booking_cancellation_facts('60000000-0000-4000-8000-000000001001','cottage_owner')->>'revision','refundObligation','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb));
set local role service_role;
insert into refund_test_values values('second-claim',public.claim_booking_refund((pg_temp.refund_value('second-intent')#>>'{}')::uuid));
insert into refund_test_values values('second-admission',public.admit_booking_refund(pg_temp.refund_value('second-claim')#>'{request,executionPermit}'));
insert into refund_test_values values('second-effect',public.persist_simulated_payment_effect(pg_temp.refund_value('second-admission')-array['purpose','binding','mode'],pg_temp.refund_proposal(pg_temp.refund_value('second-admission'),'indeterminate')));
select pg_temp.refund_record(pg_temp.refund_value('second-admission'),pg_temp.refund_value('second-effect'));
select is(public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')->'reserved','{"bookingPriceFils":20000000,"bookingServiceFeeFils":1000000}'::jsonb,'unknown partial reserves its explicit components');
select is(public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')->'obligation','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb,'full original obligation survives a successful and an uncertain partial');
select throws_ok($$select public.request_automatic_booking_refund('60000000-0000-4000-8000-000000001001',public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')->>'revision','{"bookingPriceFils":60000000,"bookingServiceFeeFils":3000000}')$$,'RC409',null,'available capacity cannot trigger a top-up before uncertainty settles');
savepoint uncertain_partial;
insert into refund_test_values values('resolved',public.resolve_simulated_payment_effect(pg_temp.refund_value('second-admission')-array['purpose','binding','mode'],pg_temp.refund_value('second-effect')#>>'{evidence,eventId}',
  jsonb_set(jsonb_set(pg_temp.refund_proposal(pg_temp.refund_value('second-admission'),'succeeded'),'{evidence,originalOutcome}','"indeterminate"'),'{evidence,executedAt}',pg_temp.refund_value('second-effect')#>'{evidence,executedAt}')));
select pg_temp.refund_record(pg_temp.refund_value('second-admission'),pg_temp.refund_value('resolved'));
select lives_ok($$select public.request_automatic_booking_refund('60000000-0000-4000-8000-000000001001',public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')->>'revision','{"bookingPriceFils":60000000,"bookingServiceFeeFils":3000000}')$$,'resolved partial success permits only the remaining 60m price and 3m fee');
rollback to uncertain_partial;
insert into refund_test_values values('resolved',public.resolve_simulated_payment_effect(pg_temp.refund_value('second-admission')-array['purpose','binding','mode'],pg_temp.refund_value('second-effect')#>>'{evidence,eventId}',
  jsonb_set(jsonb_set(pg_temp.refund_proposal(pg_temp.refund_value('second-admission'),'failed'),'{evidence,originalOutcome}','"indeterminate"'),'{evidence,executedAt}',pg_temp.refund_value('second-effect')#>'{evidence,executedAt}')));
select pg_temp.refund_record(pg_temp.refund_value('second-admission'),pg_temp.refund_value('resolved'));
select is(public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')->'reserved','{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb,'verified failure releases only its unused reservation');
select lives_ok($$select public.request_automatic_booking_refund('60000000-0000-4000-8000-000000001001',public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')->>'revision','{"bookingPriceFils":80000000,"bookingServiceFeeFils":4000000}')$$,'resolved partial failure preserves full 80m price and 4m fee top-up');
reset role;
select is((select count(*)::integer from public.booking_refund_intents where booking_request_id='60000000-0000-4000-8000-000000001001'),3,'failed intent remains in immutable audit beside successful partial and full top-up');
select is((select refund_booking_price_fils+refund_booking_service_fee_fils from public.booking_cancellations where booking_request_id='60000000-0000-4000-8000-000000001001'),115000000::bigint,'refund processing never edits the original cancellation obligation');
insert into refund_test_values select 'topup-intent',to_jsonb(id) from public.booking_refund_intents where source='cancellation' and booking_request_id='60000000-0000-4000-8000-000000001001';
set local role service_role;
insert into refund_test_values values('topup-claim',public.claim_booking_refund((pg_temp.refund_value('topup-intent')#>>'{}')::uuid));
insert into refund_test_values values('topup-admission',public.admit_booking_refund(pg_temp.refund_value('topup-claim')#>'{request,executionPermit}'));
select pg_temp.refund_record(pg_temp.refund_value('topup-admission'),public.persist_simulated_payment_effect(pg_temp.refund_value('topup-admission')-array['purpose','binding','mode'],pg_temp.refund_proposal(pg_temp.refund_value('topup-admission'),'succeeded')));
select is(public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')->'refunded','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb,'completed top-up returns the full original price and fee after partial failure');
select is(public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')->'reserved','{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb,'verified full return leaves no reserved capacity');
select is(public.claim_due_booking_refunds(50),'[]'::jsonb,'fully returned cancellation has no further automatic provider work');
reset role;
select * from finish();
rollback;
