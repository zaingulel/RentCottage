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
create function pg_temp.seed_cancellation_booking(start_day date) returns void language plpgsql as $seed_function$
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
  execute fixture;
end;
$seed_function$;
-- END CANCELLATION FIXTURE
-- BEGIN NOTIFICATION TEST HELPERS
create function pg_temp.notification_payload(target_event_id uuid) returns jsonb language sql as $$
  select jsonb_build_object('kind',e.event_kind,'title',case e.event_kind when 'cancelled' then 'Booking cancelled' when 'refund_requested' then 'Refund requested' when 'refund_returned' then 'Refund returned' else 'Refund attention recorded' end,'body','Safe notification status','bookingReference','CONFIRMATION-HOLD-1','detailsPath','/en/'||case e.recipient_role when 'customer' then 'booking-requests/' else 'owner/booking-requests/' end||'RC-REQ-0000000000001001','linkLabel','View booking','fictional',true,'allocation',jsonb_build_object('bookingPriceFils',coalesce(c.refund_booking_price_fils,i.booking_price_fils),'bookingServiceFeeFils',coalesce(c.refund_booking_service_fee_fils,i.booking_service_fee_fils)))
  from public.booking_notification_events e left join public.booking_cancellations c on c.id=e.cancellation_id left join public.booking_refund_intents i on i.id=e.refund_intent_id where e.id=target_event_id;
$$;
create function pg_temp.notice_call(action text,lease jsonb,effect_id uuid default null) returns jsonb language plpgsql as $$
declare result jsonb; declare binding jsonb:=lease-array['leaseGeneration','leaseToken','leaseExpiresAt'];
begin
  if action='complete' then
    return public.complete_booking_confirmation_notification_delivery((lease->>'receiptId')::uuid,(lease->>'leaseGeneration')::bigint,(lease->>'leaseToken')::uuid,binding,effect_id,(lease#>>'{event,id}')::uuid);
  elsif action in ('failed','unknown') then
    return public.record_booking_confirmation_notification_failure((lease->>'receiptId')::uuid,(lease->>'leaseGeneration')::bigint,(lease->>'leaseToken')::uuid,action,(lease#>>'{event,id}')::uuid);
  end if;
  execute format('select public.%I($1,$2,$3,$4,$5)',case action when 'query' then 'query_fictional_booking_confirmation_notification_effect' when 'execute' then 'execute_fictional_booking_confirmation_notification_effect' end) into result using (lease->>'receiptId')::uuid,(lease->>'leaseGeneration')::bigint,(lease->>'leaseToken')::uuid,binding,(lease#>>'{event,id}')::uuid;
  return result;
end;
$$;
-- END NOTIFICATION TEST HELPERS
select no_plan();
select pg_temp.seed_cancellation_booking('2101-01-01');
create temp table notice_values(key text primary key,value jsonb);
grant all on notice_values to authenticated,service_role;
create function pg_temp.notice_value(key text) returns jsonb language sql as $$select value from notice_values where notice_values.key=$1$$;
create temp table paid_cases as select r.id receipt_id,r.recipient_role,jsonb_build_object('kind','paid-confirmation','title','Booking confirmed','body','Booking confirmed and paid','bookingReference','CONFIRMATION-HOLD-1','detailsPath','/en/'||case r.recipient_role when 'customer' then 'booking-requests/' else 'owner/booking-requests/' end||'RC-REQ-0000000000001001','linkLabel','View confirmed booking','fictional',true) payload from public.booking_receipts r;
grant all on paid_cases to authenticated,service_role;
set local role service_role;
select public.ensure_booking_confirmation_notification_work(receipt_id,'en','paid-confirmation-v1',payload) from paid_cases;
select is(public.lease_booking_confirmation_notification_work(receipt_id,receipt_id),null::jsonb,'receipt identity cannot masquerade as an event during lease') from paid_cases where recipient_role='customer';
insert into notice_values select 'paid-'||recipient_role,public.lease_booking_confirmation_notification_work(receipt_id) from paid_cases;
select is(pg_temp.notice_call('query',pg_temp.notice_value('paid-cottage_owner'))->>'status','not-found','paid notice queries before its original execution');
insert into notice_values values('paid-effect',pg_temp.notice_call('execute',pg_temp.notice_value('paid-cottage_owner')));
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
select public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003840','cottage_owner','PRIVATE raw reason, contact and access details',null,jsonb_build_object('revision',public.get_booking_cancellation_facts('60000000-0000-4000-8000-000000001001','cottage_owner')->>'revision','refundObligation','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb));
reset role;
-- Arrange a worker restart after the old paid notice's effect, before its recording.
update public.booking_confirmation_notification_work set lease_expires_at=clock_timestamp()-interval '1 second' where receipt_id=(pg_temp.notice_value('paid-cottage_owner')->>'receiptId')::uuid;
create temp table event_cases as select id event_id,receipt_id,recipient_role,event_kind,pg_temp.notification_payload(id) payload from public.booking_notification_events where booking_request_id='60000000-0000-4000-8000-000000001001' and event_kind='cancelled';
grant all on event_cases to authenticated,service_role;
set local role service_role;
update notice_values set value=public.lease_booking_confirmation_notification_work((value->>'receiptId')::uuid) where key='paid-cottage_owner';
select is(pg_temp.notice_call('query',pg_temp.notice_value('paid-cottage_owner'))->>'effectId',pg_temp.notice_value('paid-effect')->>'effectId','cancelled paid notice discovers the historical effect on restart');
select is(pg_temp.notice_call('complete',pg_temp.notice_value('paid-cottage_owner'),(pg_temp.notice_value('paid-effect')->>'effectId')::uuid),' {"status":"delivered","historical":true}'::jsonb,'paid historical delivery is recorded after cancellation');
select is(pg_temp.notice_call('query',pg_temp.notice_value('paid-customer'))->>'status','not-found','unsent confirmation still queries for an interrupted effect');
select is(pg_temp.notice_call('execute',pg_temp.notice_value('paid-customer'))->>'status','suppressed','cancellation suppresses the unsent confirmation');
select throws_ok(format('select public.ensure_booking_confirmation_notification_work(%L,''en'',''booking-event-v1'',%L,%L)',receipt_id,payload,'90000000-0000-4000-8000-000000003899'),'RC409',null,'unknown event cannot use an existing receipt') from event_cases where recipient_role='customer';
select throws_ok(format('select public.ensure_booking_confirmation_notification_work(%L,''en'',''booking-event-v1'',%L,%L)',(select receipt_id from event_cases where recipient_role='cottage_owner'),payload,event_id),'RC409',null,'event cannot target the other recipient receipt') from event_cases where recipient_role='customer';
select throws_ok(format('select public.ensure_booking_confirmation_notification_work(%L,''ar'',''booking-event-v1'',%L,%L)',receipt_id,payload,event_id),'RC409',null,'event cannot change the original recipient locale') from event_cases where recipient_role='customer';
select throws_ok(format('select public.ensure_booking_confirmation_notification_work(%L,''en'',''booking-event-v1'',%L,%L)',receipt_id,jsonb_set(payload,'{allocation,bookingPriceFils}','1'),event_id),'RC409',null,'event cannot change the immutable price allocation') from event_cases where recipient_role='customer';
select throws_ok(format('select public.ensure_booking_confirmation_notification_work(%L,''en'',''booking-event-v1'',%L,%L)',receipt_id,jsonb_set(payload,'{kind}','"refund_returned"'),event_id),'RC409',null,'cancellation cannot be prepared as a returned refund') from event_cases where recipient_role='customer';
select throws_ok(format('select public.ensure_booking_confirmation_notification_work(%L,''en'',''booking-event-v1'',%L,%L)',receipt_id,payload||'{"reason":"PRIVATE raw reason"}',event_id),'23514',null,'private extra fields cannot enter the notification payload') from event_cases where recipient_role='customer';
select lives_ok(format('select public.ensure_booking_confirmation_notification_work(%L,''en'',''booking-event-v1'',%L,%L)',receipt_id,payload,event_id),'cancellation notice uses its immutable event identity') from event_cases order by recipient_role;
insert into notice_values select 'cancel-'||recipient_role,public.lease_booking_confirmation_notification_work(receipt_id,event_id) from event_cases;
select is(pg_temp.notice_call('query',jsonb_set(pg_temp.notice_value('cancel-customer'),'{recipientUserId}','"10000000-0000-4000-8000-000000001003"'))->>'status','stale','query rejects a wrong recipient binding');
select is(pg_temp.notice_call('execute',jsonb_set(pg_temp.notice_value('cancel-customer'),'{locale}','"ar"'))->>'status','stale','execute rejects a changed locale');
select is(pg_temp.notice_call('execute',jsonb_set(pg_temp.notice_value('cancel-customer'),'{payload,body}','"PRIVATE injected reason"'))->>'status','stale','execute rejects a changed payload');
select is(pg_temp.notice_call('execute',jsonb_set(pg_temp.notice_value('cancel-customer'),'{event,id}',pg_temp.notice_value('cancel-cottage_owner')#>'{event,id}'))->>'status','stale','execute rejects cross-event and cross-recipient identity');
select is(pg_temp.notice_call('execute',jsonb_set(pg_temp.notice_value('cancel-customer'),'{leaseGeneration}','0'))->>'status','stale','execute rejects an old lease generation');
select is(pg_temp.notice_call('query',pg_temp.notice_value('cancel-customer'))->>'status','not-found','new event uses the shared query step');
insert into notice_values values('cancel-effect',pg_temp.notice_call('execute',pg_temp.notice_value('cancel-customer')));
select is(pg_temp.notice_call('unknown',pg_temp.notice_value('cancel-customer'))->>'status','uncertain','recording interruption remains durable uncertainty');
select is(pg_temp.notice_call('failed',pg_temp.notice_value('cancel-cottage_owner'))->>'status','retryable','failed notice is retryable independently of cancellation');
reset role;
select is((select status::text from public.cottage_booking_period_commitments where id='50000000-0000-4000-8000-000000001001'),'cancelled_booking','notification failures do not undo cancellation');
select is((select refund_booking_price_fils+refund_booking_service_fee_fils from public.booking_cancellations where booking_request_id='60000000-0000-4000-8000-000000001001'),115000000::bigint,'notification failure leaves the full obligation intact');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
select is(public.get_booking_confirmation_notification_status((pg_temp.notice_value('cancel-customer')->>'receiptId')::uuid,(pg_temp.notice_value('cancel-customer')#>>'{event,id}')::uuid)->>'state','uncertain','participant reads this event status after cancellation');
select throws_ok($$select public.retry_booking_confirmation_notification((pg_temp.notice_value('cancel-cottage_owner')->>'receiptId')::uuid,(pg_temp.notice_value('cancel-cottage_owner')#>>'{event,id}')::uuid)$$,'42501',null,'customer cannot retry owner event');
select throws_ok($$select public.get_booking_confirmation_notification_status((pg_temp.notice_value('cancel-customer')->>'receiptId')::uuid,(pg_temp.notice_value('cancel-cottage_owner')#>>'{event,id}')::uuid)$$,'42501',null,'status cannot cross event and receipt');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
select is(public.retry_booking_confirmation_notification((pg_temp.notice_value('cancel-cottage_owner')->>'receiptId')::uuid,(pg_temp.notice_value('cancel-cottage_owner')#>>'{event,id}')::uuid)->>'status','queued','original owner can retry their cancellation event');
set local role service_role;
insert into notice_values select 'restart-'||recipient_role,public.lease_booking_confirmation_notification_work(receipt_id,event_id) from event_cases;
select is(pg_temp.notice_call('complete',pg_temp.notice_value('cancel-customer'),(pg_temp.notice_value('cancel-effect')->>'effectId')::uuid)->>'status','stale','expired generation cannot record the restarted delivery');
select is(pg_temp.notice_call('query',pg_temp.notice_value('restart-customer'))->>'effectId',pg_temp.notice_value('cancel-effect')->>'effectId','restarted event queries the exact existing effect');
select is(pg_temp.notice_call('complete',pg_temp.notice_value('restart-customer'),(pg_temp.notice_value('cancel-effect')->>'effectId')::uuid)->>'status','delivered','restarted event records one original supplier delivery');
select is(pg_temp.notice_call('query',pg_temp.notice_value('restart-cottage_owner'))->>'status','not-found','retry queries before dispatching');
insert into notice_values values('owner-cancel-effect',pg_temp.notice_call('execute',pg_temp.notice_value('restart-cottage_owner')));
select is(pg_temp.notice_call('complete',pg_temp.notice_value('restart-cottage_owner'),(pg_temp.notice_value('owner-cancel-effect')->>'effectId')::uuid)->>'status','delivered','retried owner event is delivered');
reset role;
select is((select count(*)::integer from public.fictional_booking_confirmation_notification_effects where event_id is not null),2,'recording interruption and retry yield one cancellation effect per recipient');
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
select public.request_automatic_booking_refund('60000000-0000-4000-8000-000000001001',public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')->>'revision','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}');
reset role;
insert into notice_values select 'refund-intent',to_jsonb(id) from public.booking_refund_intents where booking_request_id='60000000-0000-4000-8000-000000001001';
set local role service_role;
insert into notice_values values('refund-claim',public.claim_booking_refund((pg_temp.notice_value('refund-intent')#>>'{}')::uuid));
insert into notice_values values('refund-admission',public.admit_booking_refund(pg_temp.notice_value('refund-claim')#>'{request,executionPermit}'));
insert into notice_values values('refund-unknown',public.persist_simulated_payment_effect(pg_temp.notice_value('refund-admission')-array['purpose','binding','mode'],pg_temp.refund_proposal(pg_temp.notice_value('refund-admission'),'indeterminate')));
select pg_temp.refund_record(pg_temp.notice_value('refund-admission'),pg_temp.notice_value('refund-unknown'));
insert into notice_values values('refund-resolved',public.resolve_simulated_payment_effect(pg_temp.notice_value('refund-admission')-array['purpose','binding','mode'],pg_temp.notice_value('refund-unknown')#>>'{evidence,eventId}',jsonb_set(jsonb_set(pg_temp.refund_proposal(pg_temp.notice_value('refund-admission'),'succeeded'),'{evidence,originalOutcome}','"indeterminate"'),'{evidence,executedAt}',pg_temp.notice_value('refund-unknown')#>'{evidence,executedAt}')));
select pg_temp.refund_record(pg_temp.notice_value('refund-admission'),pg_temp.notice_value('refund-resolved'));
reset role;
insert into event_cases select id,receipt_id,recipient_role,event_kind,pg_temp.notification_payload(id) from public.booking_notification_events where booking_request_id='60000000-0000-4000-8000-000000001001' and event_kind in ('refund_requested','refund_returned','refund_attention');
select is((select count(*)::integer from event_cases),8,'cancellation, requested, attention and returned events retain both original recipients');
set local role service_role;
select lives_ok(format('select public.ensure_booking_confirmation_notification_work(%L,''en'',''booking-event-v1'',%L,%L)',receipt_id,payload,event_id),'shared preparation supports '||event_kind||' for '||recipient_role) from event_cases where event_kind<>'cancelled' order by event_kind,recipient_role;
insert into notice_values select event_kind||'-'||recipient_role,public.lease_booking_confirmation_notification_work(receipt_id,event_id) from event_cases where event_kind<>'cancelled';
-- All historical notices are still dispatched after the refund has settled.
select is(pg_temp.notice_call('query',value)->>'status','not-found','event queries before execute: '||key) from notice_values where key like 'refund\_%' escape '\' and key not like 'refund-%' order by key;
insert into notice_values select key||'-effect',pg_temp.notice_call('execute',value) from notice_values where key like 'refund\_%' escape '\';
select is(pg_temp.notice_call('complete',v.value,(e.value->>'effectId')::uuid)->>'status','delivered','historical event delivers once: '||v.key) from notice_values v join notice_values e on e.key=v.key||'-effect' where v.key like 'refund\_%' escape '\' order by v.key;
select is(public.get_booking_refund_facts('60000000-0000-4000-8000-000000001001')->'refunded','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb,'notification delivery does not alter the verified returned allocation');
reset role;
select is((select count(distinct logical_id)::integer from public.fictional_booking_confirmation_notification_effects where event_id is not null),8,'four distinct event identities reach each original recipient');
select is((select count(*)::integer from public.fictional_booking_confirmation_notification_effects where event_id is null),1,'only the historical paid notice has an original supplier effect');
select ok(not exists(select 1 from public.booking_confirmation_notification_work where payload::text like '%PRIVATE%'),'no raw cancellation reason or private access enters stored notices');
select is((select reason from public.booking_cancellations where booking_request_id='60000000-0000-4000-8000-000000001001'),'PRIVATE raw reason, contact and access details','safe rendering never changes the private audit reason');
select * from finish();
rollback;
