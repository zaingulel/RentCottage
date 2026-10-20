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
  recorder:=case admission->>'purpose' when 'booking-settlement' then 'record_booking_settlement_observation' when 'booking-refund' then 'record_booking_refund_observation' when 'booking-request-capture' then 'record_booking_request_capture_observation'
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
'{"cottageName":"Preserved Cottage","bookingPriceIqd":100000,"serviceFeeIqd":5000,"customerTotalIqd":105000,"items":[{"serviceDay":"2101-01-01","kind":"shift","position":1,"startsAt":"2101-01-01T08:00:00+03:00"},{"serviceDay":"2101-01-01","kind":"shift","position":3},{"serviceDay":"2101-01-02","kind":"full_day_bundle"}]}'::jsonb,
'{"customerName":"Fictional Customer","partySize":4}'::jsonb,'confirmation-test-v1','en','Fictional terms',repeat('c',64),'fictional-cancellation-v1','en','{}'::jsonb,repeat('d',64),1000,10000000,'2100-12-31 12:00+00');
insert into public.cottage_booking_period_commitments
(id,customer_user_id,profile_id,schedule_revision_id,commitment_reference,status,access_ranges,created_at)
values ('50000000-0000-4000-8000-000000001001','10000000-0000-4000-8000-000000001002','20000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001','CONFIRMATION-HOLD-1','pending_hold','{["2101-01-01 05:00+00","2101-01-01 09:00+00"),["2101-01-01 17:00+00","2101-01-01 23:00+00"),["2101-01-02 05:00+00","2101-01-02 23:00+00")}'::tstzmultirange,'2100-12-31 11:59:59+00');
insert into public.cottage_inventory_commitments
(id,unit_kind,unit_id,service_day,committed_price_iqd,booking_period_commitment_id) values
('51000000-0000-4000-8000-000000001001','shift','32000000-0000-4000-8000-000000001001','2101-01-01',30000,'50000000-0000-4000-8000-000000001001'),
('51000000-0000-4000-8000-000000001002','shift','32000000-0000-4000-8000-000000001003','2101-01-01',30000,'50000000-0000-4000-8000-000000001001'),
('51000000-0000-4000-8000-000000001003','full_day_bundle','31000000-0000-4000-8000-000000001001','2101-01-02',40000,'50000000-0000-4000-8000-000000001001');
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
'{"cottageName":"Preserved Cottage","bookingPriceIqd":100000,"serviceFeeIqd":5000,"customerTotalIqd":105000,"items":[{"serviceDay":"2101-01-01","kind":"shift","position":1,"startsAt":"2101-01-01T08:00:00+03:00"},{"serviceDay":"2101-01-01","kind":"shift","position":3},{"serviceDay":"2101-01-02","kind":"full_day_bundle"}]}'::jsonb,
repeat('b',64),'{"customerName":"Fictional Customer","partySize":4}'::jsonb,
jsonb_build_object('paymentLifecycleId','73000000-0000-4000-8000-000000001001','currency','IQD','bookingPriceFils',100000000,'bookingServiceFeeFils',5000000,'customerTotalFils',105000000,
'authorization',jsonb_build_object('paymentLifecycleId','73000000-0000-4000-8000-000000001001','kind','authorization','logicalOperationId','73000000-0000-4000-8000-000000001001:authorization','attemptId','73000000-0000-4000-8000-000000001001:authorization:attempt-1','status','succeeded','amountFils',105000000,'providerRequestId','confirmation-auth-request-1','providerReference','confirmation-auth-reference-1','movementReference','confirmation-auth-movement-1','reconciliationRequired',false,'retrySafe',false),
'capture',null,'release',null,'movements',jsonb_build_array(jsonb_build_object('kind','authorization','logicalOperationId','73000000-0000-4000-8000-000000001001:authorization','attemptId','73000000-0000-4000-8000-000000001001:authorization:attempt-1','amountFils',105000000,'movementReference','confirmation-auth-movement-1','recordedAt','2026-01-01T12:00:00.000Z'))),
'fictional-payments','local-test','fictional-merchant','fictional-terminal','confirmation-auth-request-1','confirmation-auth-reference-1','confirmation-auth-movement-1','finalized','60000000-0000-4000-8000-000000001001');
insert into public.booking_request_authorization_claims
(id,attempt_id,generation,state_revision,state,customer_user_id,profile_id,schedule_revision_id,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,provider,environment,merchant_id,terminal_id,provider_idempotency_key,quote_fingerprint,intent_fingerprint,access_ranges,not_after,reconciliation_expires_at)
values ('72000000-0000-4000-8000-000000001001','70000000-0000-4000-8000-000000001001',1,2,'converted','10000000-0000-4000-8000-000000001002','20000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001','73000000-0000-4000-8000-000000001001','73000000-0000-4000-8000-000000001001:authorization','73000000-0000-4000-8000-000000001001:authorization:attempt-1',105000000,'IQD','fictional-payments','local-test','fictional-merchant','fictional-terminal','booking-request:72000000-0000-4000-8000-000000001001:1',repeat('a',64),repeat('b',64),'{["2101-01-01 05:00+00","2101-01-01 09:00+00"),["2101-01-01 17:00+00","2101-01-01 23:00+00"),["2101-01-02 05:00+00","2101-01-02 23:00+00")}'::tstzmultirange,'2101-01-01 00:00+00','2100-12-31 23:59+00');
insert into public.booking_request_authorization_claim_items
(claim_id,unit_kind,unit_id,service_day,price_iqd) values
('72000000-0000-4000-8000-000000001001','shift','32000000-0000-4000-8000-000000001001','2101-01-01',30000),
('72000000-0000-4000-8000-000000001001','shift','32000000-0000-4000-8000-000000001003','2101-01-01',30000),
('72000000-0000-4000-8000-000000001001','full_day_bundle','31000000-0000-4000-8000-000000001001','2101-01-02',40000);
insert into public.booking_request_authorization_claim_occupancies
(claim_id,schedule_revision_id,shift_id,service_day,active)
select '72000000-0000-4000-8000-000000001001',schedule_revision_id,shift_id,service_day,false
from public.cottage_booking_period_occupancies where booking_period_commitment_id='50000000-0000-4000-8000-000000001001';
insert into public.booking_request_provider_operation_identities
(attempt_id,operation_kind,provider,environment,merchant_id,terminal_id,provider_request_id,provider_reference,movement_reference)
values ('70000000-0000-4000-8000-000000001001','authorization','fictional-payments','local-test','fictional-merchant','fictional-terminal','confirmation-auth-request-1','confirmation-auth-reference-1','confirmation-auth-movement-1');
insert into public.booking_request_capture_work
(booking_request_id,attempt_id,authorization_claim_id,authorization_claim_generation,payment_lifecycle_id,authorization_logical_operation_id,authorization_physical_attempt_id,capture_logical_operation_id,capture_physical_attempt_id,amount_fils,currency,provider,environment,merchant_id,terminal_id,provider_idempotency_key,request_fingerprint)
values ('60000000-0000-4000-8000-000000001001','70000000-0000-4000-8000-000000001001','72000000-0000-4000-8000-000000001001',1,'73000000-0000-4000-8000-000000001001','73000000-0000-4000-8000-000000001001:authorization','73000000-0000-4000-8000-000000001001:authorization:attempt-1','73000000-0000-4000-8000-000000001001:capture','73000000-0000-4000-8000-000000001001:capture:attempt-2',105000000,'IQD','fictional-payments','local-test','fictional-merchant','fictional-terminal','booking-request-capture:60000000-0000-4000-8000-000000001001:1','28d4ab70479df702acf9bb25ad91c2ddcd118bd75507dde1c874e0b015b7ac84');
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
 select jsonb_build_object('revision',public.get_booking_cancellation_facts('60000000-0000-4000-8000-000000001001',actor_role)->>'revision','refundObligation',case when full_refund then '{"bookingPriceFils":100000000,"bookingServiceFeeFils":5000000}'::jsonb else '{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb end);
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
select plan(69);
select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-3);
create temp table settlement_values(key text primary key,value jsonb);
grant all on settlement_values to authenticated,service_role;
create function pg_temp.settlement_value(key text) returns jsonb language sql as $$select value from settlement_values where settlement_values.key=$1$$;
create function pg_temp.money_row(target_state text,target_day date) returns jsonb language sql as $$
 select booking from jsonb_array_elements(public.list_administrator_booking_money(target_state,target_day,target_day)->'bookings') booking where booking->>'bookingRequestId'='60000000-0000-4000-8000-000000001001';
$$;
select pg_temp.actor('10000000-0000-4000-8000-000000003801','aal2');
set local role authenticated;
select throws_ok($$select public.request_booking_settlement('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002280','Settlement review','stale',90000000)$$,'RC409',null,'date alone cannot create a settlement without authoritative maturity');
reset role;
set local role service_role;
select public.commit_booking_completion('60000000-0000-4000-8000-000000001001',(select value->>'revision' from public.list_due_booking_completions(50) value));
reset role;
set local role authenticated;
select is(public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')#>>'{maturity,payoutPrerequisiteAvailable}','true','settlement consumes authoritative completion maturity');
select throws_ok($$select public.request_booking_settlement('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002280','Wrong commission',public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')->>'revision',94500000)$$,'RC409',null,'commission is on booking price, never customer total');
select throws_ok($$select public.booking_completion_eligibility('60000000-0000-4000-8000-000000001001')$$,'42501',null,'shared maturity helper remains internal');
savepoint refund_first;
select public.request_booking_refund_exception('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002282','Pending first','{"bookingPriceFils":10000000,"bookingServiceFeeFils":0}');
select throws_ok($$select public.request_booking_settlement('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002280','Settlement review',public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')->>'revision',90000000)$$,'RC409',null,'refund reservation first prevents settlement request');
rollback to refund_first;
insert into settlement_values values('intent',public.request_booking_settlement('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002280','Settlement review',public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')->>'revision',90000000));
select is(public.request_booking_settlement('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002280','Settlement review','stale',90000000),pg_temp.settlement_value('intent'),'same command replays original intent');
select throws_ok($$select public.request_booking_settlement('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002280','Changed reason','stale',90000000)$$,'RC409',null,'replay binds attributed command content');
select pg_temp.actor('10000000-0000-4000-8000-000000003801','aal1');
select throws_ok($$select public.request_booking_settlement('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002280','Settlement review','stale',90000000)$$,'42501',null,'replay requires current AAL2');
select pg_temp.actor('10000000-0000-4000-8000-000000003801','aal2');
reset role;
savepoint revoked;
update public.account_contexts set role='customer' where user_id='10000000-0000-4000-8000-000000003801';
set local role authenticated;
select throws_ok($$select public.request_booking_settlement('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002280','Settlement review','stale',90000000)$$,'42501',null,'revoked administrator cannot replay');
rollback to revoked;
set local role service_role;
select throws_ok($$select public.request_booking_settlement('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002280','Settlement review','stale',90000000)$$,'42501',null,'service role cannot impersonate attributed administrator command');
set local role service_role;
insert into settlement_values values('claim',public.claim_booking_settlement((pg_temp.settlement_value('intent')->>'intentId')::uuid));
select is(pg_temp.settlement_value('claim')->>'status','execute','first settlement obtains an immutable execution permit');
select is(public.claim_booking_settlement((pg_temp.settlement_value('intent')->>'intentId')::uuid)->>'status','processing','competing worker cannot execute a live unadmitted lease');
select throws_ok($$select public.admit_booking_settlement(jsonb_set(pg_temp.settlement_value('claim')#>'{request,executionPermit}','{binding,amountFils}','94500000'))$$,'RC409',null,'changed amount cannot admit');
select throws_ok($$select public.admit_booking_settlement(jsonb_set(pg_temp.settlement_value('claim')#>'{request,executionPermit}','{generation}','2'))$$,'RC409',null,'stale generation cannot admit');
select throws_ok($$select public.admit_booking_settlement(jsonb_set(pg_temp.settlement_value('claim')#>'{request,executionPermit}','{leaseToken}','"92000000-0000-4000-8000-000000002280"'))$$,'RC409',null,'foreign fence cannot admit');
savepoint hold_before;
set local role authenticated;
select public.record_booking_payout_command('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002285','place_hold','Admission stopped',null,null,null);
set local role service_role;
select is(public.admit_booking_settlement(pg_temp.settlement_value('claim')#>'{request,executionPermit}')->>'status','not-admitted','hold committed before admission prevents execution');
rollback to hold_before;
savepoint reservation_after_claim;
set local role authenticated;
select public.request_booking_refund_exception('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002284','Reserved after claim','{"bookingPriceFils":10000000,"bookingServiceFeeFils":0}');
set local role service_role;
select is(public.admit_booking_settlement(pg_temp.settlement_value('claim')#>'{request,executionPermit}')->>'status','not-admitted','refund arriving after claim is rechecked at admission');
rollback to reservation_after_claim;
savepoint expired_unadmitted;
reset role;
set local session_replication_role=replica;
update public.booking_settlement_attempts set created_at=clock_timestamp()-interval '60 seconds',not_after=clock_timestamp()-interval '30 seconds' where id=(pg_temp.settlement_value('claim')#>>'{request,executionPermit,attemptId}')::uuid;
set local session_replication_role=origin;
insert into settlement_values select 'expiredPermit',public.booking_settlement_execution_permit(a) from public.booking_settlement_attempts a;
set local role service_role;
select is(public.admit_booking_settlement(pg_temp.settlement_value('expiredPermit'))->>'status','not-admitted','an expired unadmitted permit cannot execute');
select is(public.claim_booking_settlement((pg_temp.settlement_value('intent')->>'intentId')::uuid)#>>'{request,executionPermit,generation}','2','a never admitted expired lease can be renewed');
select is(public.admit_booking_settlement(pg_temp.settlement_value('expiredPermit'))->>'status','not-admitted','renewal cannot revive the old permit');
rollback to expired_unadmitted;
insert into settlement_values values('admission',public.admit_booking_settlement(pg_temp.settlement_value('claim')#>'{request,executionPermit}'));
select is(pg_temp.settlement_value('admission')->>'mode','execute','eligible settlement is admitted once');
select is(public.admit_booking_settlement(pg_temp.settlement_value('claim')#>'{request,executionPermit}')->>'mode','reconcile','duplicate admission can only reconcile');
savepoint failed_settlement;
select pg_temp.payment_fixture_result(pg_temp.settlement_value('admission'),'failed');
select is(public.claim_booking_settlement((pg_temp.settlement_value('intent')->>'intentId')::uuid)->>'status','attention-required','unsafe failed settlement cannot create another physical attempt');
rollback to failed_settlement;
savepoint absent_settlement;
select public.record_booking_settlement_observation((pg_temp.settlement_value('admission')->>'operationId')::uuid,public.seal_simulated_payment_absence(pg_temp.settlement_value('admission')-array['purpose','binding','mode']));
select is(public.claim_booking_settlement((pg_temp.settlement_value('intent')->>'intentId')::uuid)#>>'{request,executionPermit,generation}','2','verified absence permits a new physical identity after eligibility recheck');
rollback to absent_settlement;
set local role authenticated;
select throws_ok($$select public.request_booking_refund_exception('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002281','Wait for settlement','{"bookingPriceFils":10000000,"bookingServiceFeeFils":0}')$$,'RC409',null,'unresolved admitted settlement blocks a new refund reservation');
select public.record_booking_payout_command('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002286','place_hold','Hold after admission',null,null,null);
set local role service_role;
select is(public.claim_booking_settlement((pg_temp.settlement_value('intent')->>'intentId')::uuid)->>'status','query','admitted work remains queryable after a hold arrives');
insert into settlement_values values('result',pg_temp.payment_fixture_result(pg_temp.settlement_value('admission'),'succeeded'));
select is(public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')#>>'{settlement,state}','succeeded','valid settlement success records despite a later hold');
select is(public.claim_booking_settlement((pg_temp.settlement_value('intent')->>'intentId')::uuid)->>'status','settled','successful settlement cannot be executed again');
reset role;
select is((select sum(physical_execution_count)::integer from public.simulated_payment_effects where operation_id=(pg_temp.settlement_value('admission')->>'operationId')::uuid),1,'one admitted settlement has one physical effect');
select is((select count(*)::integer from public.booking_request_payment_history where operation_kind='settlement'),1,'settlement uses immutable shared history');
set local role service_role;
select is(public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')->'recovery','{"status":"paid","ownerEntitlementFils":90000000,"paidFils":90000000,"paidWhileBlocked":true,"recoveryExposureFils":90000000,"recoveryBalanceFils":90000000,"automaticOwnerDebitFils":0}'::jsonb,'late success preserves 90m paid and recovery exposure without a debit');
reset role;
select is((select count(*)::integer from public.booking_settlement_receipts),1,'one immutable success receipt binds the original observation and history');
select throws_ok($$update public.booking_settlement_receipts set active_hold_ids='{}'$$,'RC409',null,'settlement recording context is immutable');
select pg_temp.actor('10000000-0000-4000-8000-000000001001');
set local role authenticated;
select is(public.get_booking_financial_view('RC-REQ-0000000000001001','cottage_owner')->'ownerPayout','{"status":"paid","ownerEntitlementFils":90000000,"paidFils":90000000,"paidWhileBlocked":true,"recoveryExposureFils":90000000,"recoveryBalanceFils":90000000,"automaticOwnerDebitFils":0}'::jsonb,'owner reads only monetary recovery facts');
select ok(not (public.get_booking_financial_view('RC-REQ-0000000000001001','cottage_owner')::text ~ 'Hold after admission|observationId|actorUserId|activeHoldIds|historySequence|providerReference'),'owner projection contains no private payout identifiers or narrative');
select throws_ok($$select public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')$$,'42501',null,'owner cannot read administrator payout facts');
select throws_ok($$select * from public.booking_settlement_receipts$$,'42501',null,'owner cannot read internal receipt rows');
select pg_temp.actor('10000000-0000-4000-8000-000000001002');
select ok(not (public.get_booking_financial_view('RC-REQ-0000000000001001','customer') ? 'ownerPayout'),'customer financial projection excludes owner recovery');
select pg_temp.actor('10000000-0000-4000-8000-000000001003');
select throws_ok($$select public.get_booking_financial_view('RC-REQ-0000000000001001','cottage_owner')$$,'42501',null,'foreign actor cannot claim owner recovery');
select pg_temp.actor('10000000-0000-4000-8000-000000003801','aal2');
select public.record_booking_payout_command('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002288','release_hold','Reviewed','90000000-0000-4000-8000-000000002286',null,null);
select is(public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')#>>'{recovery,recoveryBalanceFils}','90000000','releasing a hold cannot erase recorded late exposure');
insert into settlement_values values('refundIntent',public.request_booking_refund_exception('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002290','Later compensation','{"bookingPriceFils":10000000,"bookingServiceFeeFils":0}'));
select is(public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')#>>'{recovery,recoveryBalanceFils}','90000000','refund approval does not claim money returned or reduce recovery');
set local role service_role;
insert into settlement_values values('refundClaim',public.claim_booking_refund((pg_temp.settlement_value('refundIntent')->>'intentId')::uuid));
insert into settlement_values values('refundAdmission',public.admit_booking_refund(pg_temp.settlement_value('refundClaim')#>'{request,executionPermit}'));
savepoint failed_later_refund;
select pg_temp.payment_fixture_result(pg_temp.settlement_value('refundAdmission'),'failed');
select is(public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')#>>'{recovery,recoveryBalanceFils}','90000000','failed later refund does not reduce recorded late recovery');
rollback to failed_later_refund;
select pg_temp.payment_fixture_result(pg_temp.settlement_value('refundAdmission'),'succeeded');
select is(public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')->'recovery','{"status":"paid","ownerEntitlementFils":81000000,"paidFils":90000000,"paidWhileBlocked":true,"recoveryExposureFils":90000000,"recoveryBalanceFils":9000000,"automaticOwnerDebitFils":0}'::jsonb,'verified 10m price refund changes balance to 9m while preserving paid/exposure 90m and zero debit');
reset role;
-- 21:30 UTC is 00:30 the next day in Baghdad, so a reader that cut days in UTC would miss the booking on 13 September.
set local session_replication_role=replica;
update public.booking_confirmations set confirmed_at='2026-09-12 21:30:00+00' where booking_request_id='60000000-0000-4000-8000-000000001001';
set local session_replication_role=origin;
set local role authenticated;
select ok((select queue->'nextCursor'='null'::jsonb and queue->'rows' @> '[{"id":"60000000-0000-4000-8000-000000001001"}]'::jsonb from public.search_administrator_booking_queue('bookings',null,'2026-09-13','2026-09-13',null,null) queue),'the bookings queue for the pinned Baghdad day holds the fixture booking on one page');
select is((select array_agg(booking->>'bookingRequestId' order by booking->>'bookingRequestId') from jsonb_array_elements(public.list_administrator_booking_money(null,'2026-09-13','2026-09-13')->'bookings') booking),
  (select array_agg(queued->>'id' order by queued->>'id') from jsonb_array_elements(public.search_administrator_booking_queue('bookings',null,'2026-09-13','2026-09-13',null,null)->'rows') queued),'booking money reader lists exactly the Confirmed Bookings of the bookings queue');
select is(jsonb_array_length(public.list_administrator_booking_money(null,'2026-09-13','2026-09-13')->'bookings'),(public.search_administrator_booking_queue('bookings',null,'2026-09-13','2026-09-13',null,null)->>'total')::integer,'booking money reader returns as many bookings as the bookings queue counts');
select is((select jsonb_build_array(money#>'{earnings,captured,bookingPriceFils}',money#>'{earnings,captured,bookingServiceFeeFils}',money#>'{earnings,refunded,bookingPriceFils}',money#>'{earnings,refunded,bookingServiceFeeFils}',money#>'{earnings,settlement,receipt,paidFils}',money#>'{earnings,recovery,recoveryBalanceFils}') from pg_temp.money_row(null,'2026-09-13') money),
  '[100000000,5000000,10000000,0,90000000,9000000]'::jsonb,'booking money reader carries the captured 100m and 5m, the refunded 10m, the paid 90m and the 9m to recover');
select is((select jsonb_agg(record-'requestedAt') from jsonb_array_elements(pg_temp.money_row(null,'2026-09-13')->'refundRecords') record),
  jsonb_build_array(jsonb_build_object('id',pg_temp.settlement_value('refundIntent')->'intentId','source','administrator','state','succeeded','bookingPriceFils',10000000,'bookingServiceFeeFils',0)),'booking money reader lists the one refund record by its identifier');
select is(pg_temp.money_row(null,'2026-09-13')->'settlementIntentId',pg_temp.settlement_value('intent')->'intentId','booking money reader names the Owner Payout record');
select isnt(pg_temp.money_row(null,'2026-09-13')->>'state','no_show','the fixture booking is not a no-show');
select is(pg_temp.money_row(pg_temp.money_row(null,'2026-09-13')->>'state','2026-09-13')->>'reference','RC-REQ-0000000000001001','booking money reader keeps the booking under its own lifecycle status');
select is(pg_temp.money_row('no_show','2026-09-13'),null::jsonb,'booking money reader drops the booking under another lifecycle status');
select is(pg_temp.money_row(null,'2026-09-13')->>'confirmedAt','2026-09-12T21:30:00.000000+00:00','booking money reader places a 00:30 Baghdad confirmation on its Baghdad day');
select is(pg_temp.money_row(null,'2026-09-12'),null::jsonb,'booking money reader keeps that confirmation out of the preceding Baghdad day');
select ok(public.list_administrator_booking_money(null,'2026-09-13','2026-09-13')::text !~ 'PRIVATE ADDRESS|PRIVATE DIRECTIONS|\+9647[0-9]{10}|@|"(exactAddress|privateDirections|email|phone|objectPath|storagePath|signedUrl|documentId)"|Private address|Fictional Customer|\+9647500001|Later compensation|Settlement review|"(reason|actorUserId)"',
  'booking money reader exposes no private contact, address or document field');
reset role;
select lives_ok($test$
do $body$
declare expected_selection jsonb;
declare exported jsonb;
declare audit private.administrator_booking_money_exports;
declare selected_state text;
begin
  perform set_config('role','authenticated',true);
  selected_state:=pg_temp.money_row(null,'2026-09-13')->>'state';
  expected_selection:=public.list_administrator_booking_money(selected_state,'2026-09-13','2026-09-13');
  exported:=public.record_administrator_booking_money_export(selected_state,'2026-09-13','2026-09-13');
  perform set_config('role','none',true);
  if exported->>'status' is distinct from 'recorded' or exported->'selection' is distinct from expected_selection
    or exported-array['status','exportId','recordedAt','selection']<>'{}'::jsonb then
    raise exception 'Export did not return exactly the recorded selection: %',exported;
  end if;
  select * into strict audit from private.administrator_booking_money_exports where id=(exported->>'exportId')::uuid;
  if audit.administrator_user_id<>'10000000-0000-4000-8000-000000003801'::uuid
    or audit.filter_state is distinct from selected_state
    or audit.filter_from is distinct from '2026-09-13'::date or audit.filter_through is distinct from '2026-09-13'::date
    or audit.booking_request_ids<>array['60000000-0000-4000-8000-000000001001']::uuid[]
    or audit.recorded_at is distinct from statement_timestamp()
    or exported->>'recordedAt' is distinct from to_char(audit.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') then
    raise exception 'Export attribution, filters, selected IDs or database time disagree';
  end if;
  if exported#>'{selection,bookings,0,earnings,captured,bookingPriceFils}'<>'100000000'::jsonb
    or exported#>'{selection,bookings,0,earnings,refunded,bookingPriceFils}'<>'10000000'::jsonb
    or exported#>'{selection,bookings,0,earnings,recovery,recoveryBalanceFils}'<>'9000000'::jsonb then
    raise exception 'Captured financial selection does not match the known settlement/refund fixture';
  end if;
  insert into settlement_values values('export',exported);
end;
$body$;
$test$,'recorded money export returns exactly its captured selection and attributed filters');
select lives_ok($test$
do $body$
declare api_role text;
declare privilege text;
declare command text;
declare audit_id uuid:=(pg_temp.settlement_value('export')->>'exportId')::uuid;
begin
  if not (select relrowsecurity and relowner='postgres'::regrole from pg_class where oid='private.administrator_booking_money_exports'::regclass)
    or exists(select 1 from pg_policy where polrelid='private.administrator_booking_money_exports'::regclass) then
    raise exception 'Export audit is not private with policy-free Row Level Security';
  end if;
  foreach api_role in array array['anon','authenticated','service_role'] loop
    foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if has_table_privilege(api_role,'private.administrator_booking_money_exports',privilege) then
        raise exception '% has audit privilege %',api_role,privilege;
      end if;
    end loop;
    if has_function_privilege(api_role,'private.reject_administrator_booking_money_export_change()','EXECUTE') then
      raise exception '% can execute the audit guard',api_role;
    end if;
    perform set_config('role',api_role,true);
    begin
      perform 1 from private.administrator_booking_money_exports;
      raise exception '% read private audit rows',api_role;
    exception when insufficient_privilege then null;
    end;
    perform set_config('role','none',true);
  end loop;
  foreach command in array array[
    format('update private.administrator_booking_money_exports set recorded_at=recorded_at where id=%L',audit_id),
    format('delete from private.administrator_booking_money_exports where id=%L',audit_id),
    'truncate private.administrator_booking_money_exports'
  ] loop
    begin
      execute command;
      raise exception 'Immutable audit accepted %',command;
    exception when sqlstate 'RC409' then null;
    end;
  end loop;
  if (select count(*) from private.administrator_booking_money_exports)<>1 then
    raise exception 'Immutable record cardinality changed';
  end if;
  if not has_function_privilege('authenticated','public.record_administrator_booking_money_export(text,date,date)','EXECUTE')
    or has_function_privilege('anon','public.record_administrator_booking_money_export(text,date,date)','EXECUTE')
    or has_function_privilege('service_role','public.record_administrator_booking_money_export(text,date,date)','EXECUTE')
    or (select array[provolatile::text,prosecdef::text] from pg_proc where oid='public.record_administrator_booking_money_export(text,date,date)'::regprocedure)<>array['v','true'] then
    raise exception 'Recorded export API privileges or volatility disagree';
  end if;
end;
$body$;
$test$,'recorded money export audit is private and immutable');

savepoint audit_insert_failure;
alter table private.administrator_booking_money_exports add constraint export_test_insert_failure check(false) not valid;
select lives_ok($test$
do $body$
declare audits_before bigint;
begin
  select count(*) into audits_before from private.administrator_booking_money_exports;
  perform set_config('role','authenticated',true);
  begin
    perform public.record_administrator_booking_money_export(null,'2026-09-13','2026-09-13');
    raise exception 'Audit insertion failure returned an export';
  exception when check_violation then null;
  end;
  perform set_config('role','none',true);
  if (select count(*) from private.administrator_booking_money_exports)<>audits_before then
    raise exception 'Audit insertion failure changed audit cardinality';
  end if;
end;
$body$;
$test$,'recorded money export fails when audit insertion fails');
rollback to audit_insert_failure;

savepoint export_selection_cap;
select lives_ok($test$
do $body$
declare request_row public.booking_requests;
declare confirmation_row public.booking_confirmations;
declare exported jsonb;
declare selection jsonb;
declare audits_before bigint;
declare expected_ids uuid[];
declare n integer;
begin
  select count(*) into audits_before from private.administrator_booking_money_exports;
  perform set_config('role','authenticated',true);
  if public.record_administrator_booking_money_export(null,'1990-01-01','1990-01-01')<>'{"status":"empty"}'::jsonb
    or public.record_administrator_booking_money_export('no_show','2026-09-13','2026-09-13')<>'{"status":"empty"}'::jsonb then
    raise exception 'Empty or excluded selections were admitted';
  end if;
  begin
    perform public.record_administrator_booking_money_export('succeeded',null,null);
    raise exception 'Invalid state was admitted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_administrator_booking_money_export(null,'2026-09-14','2026-09-13');
    raise exception 'Reverse dates were admitted';
  exception when invalid_parameter_value then null;
  end;
  perform set_config('role','none',true);
  if (select count(*) from private.administrator_booking_money_exports)<>audits_before then
    raise exception 'Refused selections created an audit';
  end if;
  -- Deliberately missing-payment confirmations test real admission without fabricating valid payment lifecycles.
  select * into strict request_row from public.booking_requests where id='60000000-0000-4000-8000-000000001001';
  select * into strict confirmation_row from public.booking_confirmations where booking_request_id=request_row.id;
  for n in 1..500 loop
    request_row.id:=md5('718-request-'||n)::uuid;
    request_row.booking_request_reference:='RC-REQ-'||lpad(n::text,16,'0');
    request_row.booking_snapshot_id:=md5('718-snapshot-'||n)::uuid;
    request_row.booking_period_commitment_id:=md5('718-commitment-'||n)::uuid;
    request_row.payment_lifecycle_id:=md5('718-payment-'||n)::uuid;
    confirmation_row.id:=md5('718-confirmation-'||n)::uuid;
    confirmation_row.booking_request_id:=request_row.id;
    confirmation_row.booking_snapshot_id:=request_row.booking_snapshot_id;
    confirmation_row.booking_period_commitment_id:=request_row.booking_period_commitment_id;
    confirmation_row.capture_operation_id:=md5('718-capture-'||n)::uuid;
    execute 'set local session_replication_role=replica';
    insert into public.booking_requests select request_row.*;
    insert into public.booking_confirmations select confirmation_row.*;
    execute 'set local session_replication_role=origin';
    if n=499 then
      perform set_config('role','authenticated',true);
      selection:=public.list_administrator_booking_money(null,'2026-09-13','2026-09-13');
      exported:=public.record_administrator_booking_money_export(null,'2026-09-13','2026-09-13');
      perform set_config('role','none',true);
      select array_agg(id order by id) into expected_ids from (
        select md5('718-request-'||i)::uuid id from generate_series(1,499) i
        union all select '60000000-0000-4000-8000-000000001001'::uuid
      ) selected;
      if jsonb_array_length(selection->'bookings')<>1 or jsonb_array_length(selection->'missingPaymentEvidence')<>499
        or exported->>'status' is distinct from 'recorded' or exported->'selection' is distinct from selection
        or (select booking_request_ids from private.administrator_booking_money_exports where id=(exported->>'exportId')::uuid) is distinct from expected_ids then
        raise exception 'Exactly 500 selected entries or their full sorted ID union were not recorded';
      end if;
      if (select count(*) from private.administrator_booking_money_exports)<>audits_before+1 then
        raise exception 'Admitted selection did not create exactly one audit';
      end if;
    end if;
  end loop;
  perform set_config('role','authenticated',true);
  if public.list_administrator_booking_money(null,'2026-09-13','2026-09-13')<>'{"status":"too_many","limit":500}'::jsonb
    or public.record_administrator_booking_money_export(null,'2026-09-13','2026-09-13')<>'{"status":"too_many","limit":500}'::jsonb then
    raise exception '501 selected entries did not refuse with the unchanged 500 cap';
  end if;
  perform set_config('role','none',true);
  if (select count(*) from private.administrator_booking_money_exports)<>audits_before+1 then
    raise exception 'Oversized selection created an audit';
  end if;
end;
$body$;
$test$,'recorded money export refuses empty and oversized selections without an audit');
rollback to export_selection_cap;

select is(public.administrator_booking_money_facts(null,'2026-09-13','2026-09-13',0),'{"status":"too_many","limit":0}'::jsonb,'booking money reader refuses a selection above its limit');
savepoint equal_recording_times;
set local session_replication_role=replica;
update public.booking_request_payment_history set received_at='2026-09-12T12:00:00Z',recorded_at='2026-09-12T12:00:00Z' where operation_kind in ('refund','settlement');
update public.payment_provider_observations set received_at='2026-09-12T12:00:00Z' where operation_id in (select id from public.payment_provider_operations where operation_kind in ('refund','settlement'));
set local session_replication_role=origin;
set local role service_role;
select is(public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')#>>'{recovery,recoveryBalanceFils}','9000000','same-time observations retain serialized settlement/refund ordering');
reset role;
savepoint missing_payment_prerequisites;
set local session_replication_role=replica;
delete from public.booking_request_capture_work where booking_request_id='60000000-0000-4000-8000-000000001001';
set local session_replication_role=origin;
set local role authenticated;
select is((select jsonb_build_array(money->'missingPaymentEvidence',pg_temp.money_row(null,'2026-09-13')) from public.list_administrator_booking_money(null,'2026-09-13','2026-09-13') money),
  '[[{"bookingRequestId":"60000000-0000-4000-8000-000000001001","reference":"RC-REQ-0000000000001001","confirmedAt":"2026-09-12T21:30:00.000000+00:00"}],null]'::jsonb,'booking money reader names a confirmation whose payment prerequisites are missing');
select is(public.record_administrator_booking_money_export(null,'2026-09-13','2026-09-13')#>'{selection,missingPaymentEvidence}',
  '[{"bookingRequestId":"60000000-0000-4000-8000-000000001001","reference":"RC-REQ-0000000000001001","confirmedAt":"2026-09-12T21:30:00.000000+00:00"}]'::jsonb,'recorded money export includes missing-capture evidence in its saved selection');
reset role;
rollback to missing_payment_prerequisites;
savepoint unconfirmed_payment;
set local session_replication_role=replica;
update public.booking_request_capture_work set state='queued',lease_generation=0,lease_token=null,lease_expires_at=null,outcome=null,completed_at=null where booking_request_id='60000000-0000-4000-8000-000000001001';
set local session_replication_role=origin;
select is((select public.booking_request_payment_status(requests) from public.booking_requests requests where id='60000000-0000-4000-8000-000000001001'),'capture-processing','the fixture request now has a non-null payment status other than paid-confirmed');
set local role authenticated;
select is((select jsonb_build_array(money->'missingPaymentEvidence',pg_temp.money_row(null,'2026-09-13')) from public.list_administrator_booking_money(null,'2026-09-13','2026-09-13') money),
  '[[{"bookingRequestId":"60000000-0000-4000-8000-000000001001","reference":"RC-REQ-0000000000001001","confirmedAt":"2026-09-12T21:30:00.000000+00:00"}],null]'::jsonb,'booking money reader names a confirmation whose payment is not confirmed');
reset role;
rollback to unconfirmed_payment;
savepoint missing_context;
set local session_replication_role=replica;
delete from public.booking_settlement_receipts;
set local session_replication_role=origin;
set local role service_role;
select is(public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')->'recovery','{"status":"unavailable"}'::jsonb,'historical success without immutable recording context is unavailable, never a zero balance');
reset role;
set local role authenticated;
select is((select jsonb_build_array(money->'earnings',money#>'{refundRecords,0,id}',money->'settlementIntentId') from pg_temp.money_row(null,'2026-09-13') money),
  jsonb_build_array('{"status":"unavailable"}'::jsonb,pg_temp.settlement_value('refundIntent')->'intentId',pg_temp.settlement_value('intent')->'intentId'),'booking money reader keeps a booking with missing evidence and marks it unavailable');
select is(public.record_administrator_booking_money_export(null,'2026-09-13','2026-09-13')#>'{selection,bookings,0,earnings}',
  '{"status":"unavailable"}'::jsonb,'recorded money export includes missing settlement receipt evidence in its saved selection');
reset role;
insert into settlement_values select 'savedSuccess',result from public.payment_provider_observations where operation_id=(pg_temp.settlement_value('admission')->>'operationId')::uuid;
set local role service_role;
select public.record_booking_settlement_observation((pg_temp.settlement_value('admission')->>'operationId')::uuid,pg_temp.settlement_value('savedSuccess'));
select is(public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')->'recovery','{"status":"unavailable"}'::jsonb,'replay cannot backfill a historical hold context from current state');

reset role;
select * from finish();
rollback;
