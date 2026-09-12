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

-- Expand the preserved confirmation fixture into independently bound bookings.
create function pg_temp.seed_refund_booking(slot integer) returns void language plpgsql as $seed_function$
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
declare suffix text:=lpad(slot::text,3,'0');
declare lifecycle text:='73000000-0000-4000-8000-000000'||suffix||'001';
declare fingerprint text;
begin
  fixture:=regexp_replace(fixture,'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-)[0-9a-f]{9}([0-9a-f]{3})', '\1'||'000000'||suffix||'\2','g');
  fingerprint:=encode(extensions.digest('{"provider":{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"},"kind":"capture","paymentLifecycleId":"'||lifecycle||'","logicalOperationId":"'||lifecycle||':capture","attemptId":"'||lifecycle||':capture:attempt-2","amountFils":115000000,"currency":"IQD"}','sha256'),'hex');
  fixture:=replace(fixture,'6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d',fingerprint);
  fixture:=replace(fixture,'RC-REQ-0000000000001001','RC-REQ-'||lpad(slot::text,16,'0'));
  fixture:=replace(fixture,'CONFIRMATION-HOLD-1','SCHEDULING-'||slot);
  fixture:=replace(fixture,'confirmation-auth-request-1','scheduling-auth-request-'||slot);
  fixture:=replace(fixture,'confirmation-auth-reference-1','scheduling-auth-reference-'||slot);
  fixture:=replace(fixture,'confirmation-auth-movement-1','scheduling-auth-movement-'||slot);
  fixture:=replace(fixture,'cancellation-admin@example.test','scheduling-admin-'||slot||'@example.test');
  fixture:=replace(fixture,'+964750000100','+964750'||lpad(slot::text,6,'0'));
  fixture:=replace(fixture,'confirmation_capture_lease','scheduling_lease_'||slot);
  fixture:=replace(fixture,'confirmation_capture_result','scheduling_result_'||slot);
  fixture:=replace(fixture,'confirmation_capture','scheduling_capture_'||slot);
  execute fixture;
end;
$seed_function$;

create function pg_temp.refund_proposal(admission jsonb,outcome text) returns jsonb language sql as $$
  select jsonb_build_object('outcome',outcome,'providerRequestId','refund-request-'||(admission->>'operationId'),'providerReference','refund-reference-'||(admission->>'operationId'),
    'evidence',jsonb_build_object('operationId',admission->>'operationId','eventId','refund-event-'||(admission->>'operationId')||'-'||outcome,'provenance','fictional-provider','originalOutcome',outcome,'executedAt',clock_timestamp(),'occurredAt',case when outcome<>'indeterminate' then clock_timestamp() end,'closedAt',null))
    ||case when outcome='failed' then jsonb_build_object('retrySafe',false) else jsonb_build_object('movementReference','refund-movement-'||(admission->>'operationId')) end;
$$;
create function pg_temp.refund_record(admission jsonb,result jsonb) returns jsonb language sql as $$
  select public.record_booking_request_payment_observation((admission->>'operationId')::uuid,result,
    jsonb_build_object('revision',public.get_booking_request_payment_observation_facts((admission->>'operationId')::uuid)->>'revision','recoveryState',null,'quarantineReason',null,'correctiveCaptureId',null));
$$;

select no_plan();
create temp table scheduling_ids(slot integer primary key, request uuid, intent uuid, admission jsonb);
create temp table scheduling_batches(sequence integer primary key, ids jsonb);
grant all on scheduling_ids,scheduling_batches to authenticated,service_role;
create function pg_temp.request_exception(slot integer) returns uuid language plpgsql as $$
declare actor text:='10000000-0000-4000-8000-000000'||lpad(slot::text,3,'0')||'801';
declare request uuid:=('60000000-0000-4000-8000-000000'||lpad(slot::text,3,'0')||'001')::uuid;
declare result jsonb;
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claim.sub',actor,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'aal','aal2')::text,true);
  result:=public.request_booking_refund_exception(request,gen_random_uuid(),'Scheduling compensation','{"bookingPriceFils":1000,"bookingServiceFeeFils":0}');
  perform set_config('role','none',true);
  return (result->>'intentId')::uuid;
end;
$$;
do $$ begin
  for slot in 101..151 loop
    perform pg_temp.seed_refund_booking(slot);
    insert into scheduling_ids values(slot,('60000000-0000-4000-8000-000000'||slot||'001')::uuid,pg_temp.request_exception(slot),null);
  end loop;
end $$;
set local role service_role;
do $$ declare item record; claim jsonb; admitted jsonb; effect jsonb; begin
  for item in select * from scheduling_ids where slot<151 order by slot loop
    claim:=public.claim_booking_refund(item.intent);
    admitted:=public.admit_booking_refund(claim#>'{request,executionPermit}');
    effect:=public.persist_simulated_payment_effect(admitted-array['purpose','binding','mode'],pg_temp.refund_proposal(admitted,'indeterminate'));
    perform pg_temp.refund_record(admitted,effect);
    update scheduling_ids set admission=admitted where slot=item.slot;
  end loop;
end $$;
select throws_ok($$select public.claim_due_booking_refunds(null)$$,'22023',null,'null cannot claim an unbounded batch');
select throws_ok($$select public.claim_due_booking_refunds(0)$$,'22023',null,'zero batch size is denied');
select throws_ok($$select public.claim_due_booking_refunds(51)$$,'22023',null,'oversized batch is denied');
reset role;
select ok((select bool_and(refund_last_scheduled_at is null) from public.booking_requests),'invalid batches change no scheduling metadata');
select ok(not has_function_privilege('authenticated','public.claim_due_booking_refunds(integer)','EXECUTE') and not has_function_privilege('anon','public.claim_due_booking_refunds(integer)','EXECUTE'),'only service scheduling authority can select a batch');
create function pg_temp.business_fingerprint() returns text language sql as $$
  select md5(jsonb_build_object(
    'requests',(select jsonb_agg(to_jsonb(r)-'refund_last_scheduled_at' order by id) from public.booking_requests r),
    'intents',(select jsonb_agg(to_jsonb(r) order by id) from public.booking_refund_intents r),
    'attempts',(select jsonb_agg(to_jsonb(r) order by id) from public.booking_refund_attempts r),
    'operations',(select jsonb_agg(to_jsonb(r) order by id) from public.payment_provider_operations r),
    'observations',(select jsonb_agg(to_jsonb(r) order by id) from public.payment_provider_observations r),
    'effects',(select jsonb_agg(to_jsonb(r) order by operation_id) from public.simulated_payment_effects r),
    'history',(select jsonb_agg(to_jsonb(r) order by id) from public.booking_request_payment_history r)
  )::text)
$$;
create temp table scheduling_business_before as select pg_temp.business_fingerprint() as fingerprint;
set local role service_role;
insert into scheduling_batches values(1,public.claim_due_booking_refunds(50));
reset role;
select is(pg_temp.business_fingerprint(),(select fingerprint from scheduling_business_before),'selection alone preserves allocations, identities, results, attempts and history');
select is((select count(*)::integer from public.booking_requests where refund_last_scheduled_at is not null),50,'exactly the selected fifty timestamps advance');
set local role service_role;
select is(jsonb_array_length((select ids from scheduling_batches where sequence=1)),50,'batch is bounded to fifty');
select ok(not (select ids from scheduling_batches where sequence=1) @> jsonb_build_array((select request from scheduling_ids where slot=151)),'first fifty older unknown refunds are selected first');
do $$ declare item record; claim jsonb; result jsonb; begin
  for item in select * from scheduling_ids where (select ids from scheduling_batches where sequence=1) @> jsonb_build_array(request) loop
    claim:=public.claim_booking_refund(item.intent);
    if claim->>'status'<>'query' then raise exception 'Expected inquiry'; end if;
    result:=public.seal_simulated_payment_absence(item.admission-array['purpose','binding','mode']);
    perform pg_temp.refund_record(item.admission,result);
  end loop;
end $$;
insert into scheduling_batches values(2,public.claim_due_booking_refunds(50));
select ok((select ids from scheduling_batches where sequence=2) @> jsonb_build_array((select request from scheduling_ids where slot=151)),'fifty repeated unknown inquiries cannot starve booking fifty-one');
-- Repeated selection without any processing models a crash or unavailable runtime.
insert into scheduling_batches values(3,public.claim_due_booking_refunds(50)),(4,public.claim_due_booking_refunds(50));
select is((select count(distinct id)::integer from scheduling_batches cross join lateral jsonb_array_elements_text(ids) id where sequence in (3,4)),51,'every unresolved booking returns after selection without processing');
select ok((select bool_and(jsonb_array_length(ids)=50 and (select count(distinct id) from jsonb_array_elements_text(ids) id)=50) from scheduling_batches),'each batch remains bounded and has no duplicate booking');
reset role;
-- Processing leases are eligible, but cannot monopolize later cancellations.
select pg_temp.seed_refund_booking(152);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000152001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000152001","aal":"aal1"}',true);
select public.commit_booking_cancellation('60000000-0000-4000-8000-000000152001',gen_random_uuid(),'cottage_owner','Unavailable',null,
  jsonb_build_object('revision',public.get_booking_cancellation_facts('60000000-0000-4000-8000-000000152001','cottage_owner')->>'revision','refundObligation','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb));
set local role service_role;
create temp table active_claim as select public.claim_booking_refund((select intent from scheduling_ids where slot=151)) as claim;
select is(public.claim_booking_refund((select intent from scheduling_ids where slot=151))->>'status','processing','existing lease is genuinely still processing');
insert into scheduling_batches values(5,public.claim_due_booking_refunds(50)),(6,public.claim_due_booking_refunds(50));
select ok(exists(select 1 from scheduling_batches where sequence in (5,6) and ids @> '["60000000-0000-4000-8000-000000152001"]'::jsonb),'unknown and active processing cannot starve a new automatic cancellation obligation');
select ok(exists(select 1 from scheduling_batches where sequence in (5,6) and ids @> jsonb_build_array((select request from scheduling_ids where slot=151))),'active processing remains eligible for later recovery');
-- Resolve 151 and the cancellation, then create a genuinely new exception on 151.
create temp table completed_admission as select public.admit_booking_refund((select claim#>'{request,executionPermit}' from active_claim)) as admission;
select pg_temp.refund_record(admission,public.persist_simulated_payment_effect(admission-array['purpose','binding','mode'],pg_temp.refund_proposal(admission,'succeeded'))) from completed_admission;
create temp table automatic_intent as select public.request_automatic_booking_refund('60000000-0000-4000-8000-000000152001',public.get_booking_refund_facts('60000000-0000-4000-8000-000000152001')->>'revision','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}') as result;
create temp table automatic_claim as select public.claim_booking_refund((public.get_booking_refund_facts('60000000-0000-4000-8000-000000152001')#>>'{intents,0,id}')::uuid) as claim;
create temp table automatic_admission as select public.admit_booking_refund((select claim#>'{request,executionPermit}' from automatic_claim)) as admission;
select pg_temp.refund_record(admission,public.persist_simulated_payment_effect(admission-array['purpose','binding','mode'],pg_temp.refund_proposal(admission,'succeeded'))) from automatic_admission;
insert into scheduling_batches values(7,public.claim_due_booking_refunds(50));
select is(jsonb_array_length((select ids from scheduling_batches where sequence=7)),50,'completed partial and full obligation leave only the fifty unknown refunds due');
reset role;
select pg_temp.request_exception(151);
set local role service_role;
insert into scheduling_batches values(8,public.claim_due_booking_refunds(1));
select is((select ids->>0 from scheduling_batches where sequence=8),'60000000-0000-4000-8000-000000101001','old retry precedes the new due time of a previously completed booking');
reset role;
select pg_temp.seed_refund_booking(153);
select pg_temp.request_exception(153);
set local role service_role;
insert into scheduling_batches values(9,public.claim_due_booking_refunds(1));
select is((select ids->>0 from scheduling_batches where sequence=9),'60000000-0000-4000-8000-000000102001','new arrivals do not starve older outstanding retries');
insert into scheduling_batches values(10,public.claim_due_booking_refunds(50)),(11,public.claim_due_booking_refunds(50));
select ok(exists(select 1 from scheduling_batches where sequence in (10,11) and ids @> jsonb_build_array((select request from scheduling_ids where slot=151))),'re-eligible booking still progresses across bounded batches');
reset role;
select * from finish();
rollback;
