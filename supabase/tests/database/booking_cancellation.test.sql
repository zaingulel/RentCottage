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

create function pg_temp.cancellation_decision(actor_role text,full_refund boolean) returns jsonb language sql as $$
  select jsonb_build_object('revision',public.get_booking_cancellation_facts('60000000-0000-4000-8000-000000001001',actor_role)->>'revision',
    'refundObligation',case when full_refund then '{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb
      else '{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb end);
$$;
select no_plan();
savepoint before_fixture;
select pg_temp.seed_cancellation_booking('2101-01-01');
savepoint confirmed;

insert into public.cottage_shift_schedule_revisions(id,profile_id,revision,full_day_bundle_id) values('30000000-0000-4000-8000-000000003801','20000000-0000-4000-8000-000000001001',2,'31000000-0000-4000-8000-000000003801');
select set_config('rentcottage.shift_schedule_write_revision_id','30000000-0000-4000-8000-000000003801',true);
insert into public.cottage_shifts(id,schedule_revision_id,position,name,start_time,end_time) values
('32000000-0000-4000-8000-000000003801','30000000-0000-4000-8000-000000003801',1,'Changed Morning','09:00','13:00'),
('32000000-0000-4000-8000-000000003802','30000000-0000-4000-8000-000000003801',2,'Changed Evening','15:00','19:00');
select set_config('rentcottage.shift_schedule_write_revision_id','',true);
update public.owner_application_cottage_profiles set current_shift_schedule_id='30000000-0000-4000-8000-000000003801' where id='20000000-0000-4000-8000-000000001001';

select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.booking_cancellations'::regclass,'public.booking_cancellation_incidents'::regclass,'public.booking_cancellation_administrator_audit'::regclass,'public.booking_notification_events'::regclass)),'all new facts have Row Level Security');
select ok(not has_table_privilege('service_role','public.booking_cancellations','SELECT') and not has_table_privilege('authenticated','public.booking_notification_events','SELECT'),'API roles cannot directly read restricted cancellation facts');
set local role anon;
select throws_ok($$select public.get_booking_cancellation_facts('60000000-0000-4000-8000-000000001001','customer')$$,'42501',null,'anonymous cancellation is denied');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001003',true);
set local role authenticated;
select throws_ok($$select public.get_booking_cancellation_facts('60000000-0000-4000-8000-000000001001','customer')$$,'42501',null,'another customer cannot cancel');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
select throws_ok($$select public.get_booking_cancellation_facts('60000000-0000-4000-8000-000000001001','cottage_owner')$$,'42501',null,'customer cannot claim owner authority');
select is((public.get_booking_cancellation_facts('60000000-0000-4000-8000-000000001001','customer')->>'firstStartsAt')::timestamptz,'2101-01-01 05:00+00'::timestamptz,'policy retains the purchased first shift after the current schedule changes');
select is(public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003801','customer',null,null,pg_temp.cancellation_decision('customer',false))->>'status','stale','forged zero obligation cannot bypass the full refund rule');
select is(public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003801','customer',null,null,'{"revision":"stale","refundObligation":{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}}')->>'status','stale','stale source facts do not commit');
reset role;
select is((select count(*) from public.booking_cancellations),0::bigint,'rejected decisions preserve the confirmed booking');
select is(public.booking_request_policy_at('2101-01-01 08:00+03','2099-12-30 08:00+03')->>'requiresInside48HourNoRefundAcceptance','false','earlier cancellations qualify');
select is(public.booking_request_policy_at('2101-01-01 08:00+03','2100-12-30 08:00+03')->>'requiresInside48HourNoRefundAcceptance','false','exactly 48 hours is refundable at the database boundary');
select is(public.booking_request_policy_at('2101-01-01 08:00+03','2100-12-30 08:00:00.001+03')->>'requiresInside48HourNoRefundAcceptance','true','one millisecond inside 48 hours is not refundable');

create function pg_temp.reject_notification_event() returns trigger language plpgsql as $$ begin raise exception 'injected event failure'; end $$;
create trigger reject_notification_fixture before insert on public.booking_notification_events for each row execute function pg_temp.reject_notification_event();
set local role authenticated;
select throws_ok($$select public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003801','customer',null,null,pg_temp.cancellation_decision('customer',true))$$,'P0001','injected event failure','failure of an atomic receipt rolls back the entire cancellation');
reset role;
drop trigger reject_notification_fixture on public.booking_notification_events;
select ok(not exists(select 1 from public.booking_cancellations) and (select status from public.cottage_booking_period_commitments)='confirmed_booking' and (select bool_and(active) from public.cottage_booking_period_occupancies),'rollback preserves cancellation absence and all inventory');
create temp table preserved_snapshot as select quote_payload,intent_payload,acceptance_evidence from public.booking_snapshots;
create temp table preserved_ranges as select access_ranges from public.cottage_booking_period_commitments;
set local role authenticated;
create temp table cancelled_result as select public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003801','customer',null,null,pg_temp.cancellation_decision('customer',true)) result;
select is((select result->>'status' from cancelled_result),'cancelled','customer cancellation commits');
select is((select result->'refundObligation' from cancelled_result),'{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb,'entire captured price and service fee are owed');
select is(public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003801','customer',null,null,'{}'),(select result from cancelled_result),'same command replays the original outcome regardless of derived decision');
select throws_ok($$select public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003802','customer',null,null,'{}')$$,'RC409',null,'a second cancellation cannot replace the first fact');
select is(jsonb_array_length(public.list_booking_history('customer')),1,'customer history retains the cancelled booking');
select is(public.get_confirmed_booking_access('RC-REQ-0000000000001001'),null::jsonb,'retained history does not grant active private access');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
select is(jsonb_array_length(public.list_booking_history('cottage_owner')),1,'owner history retains the cancelled booking');
reset role;
select is((select status::text from public.cottage_booking_period_commitments),'cancelled_booking','cancellation ends the active customer conflict');
select is((select count(*) from public.cottage_booking_period_occupancies where active),0::bigint,'all unstarted component shifts including bundle components become available');
select ok((select (quote_payload,intent_payload,acceptance_evidence) from public.booking_snapshots)=(select (quote_payload,intent_payload,acceptance_evidence) from preserved_snapshot) and (select access_ranges from public.cottage_booking_period_commitments)=(select access_ranges from preserved_ranges),'purchased snapshot terms and access ranges stay intact');
select ok((select count(*) from public.booking_confirmations)=1 and (select count(*) from public.booking_receipts)=2 and (select count(*) from public.payment_provider_operations where operation_kind='refund')=0,'cancellation preserves confirmation and receipts independently of supplier execution');
select ok((select capture_operation_id from public.booking_cancellations)=(select capture_operation_id from public.booking_confirmations),'obligation binds to the captured operation');
select ok(not exists(select 1 from public.booking_cancellation_incidents) and not exists(select 1 from public.booking_cancellation_administrator_audit),'customer cancellation does not invent owner or administrator incidents');
select is((select count(*) from public.booking_notification_events where event_kind='cancelled' and booking_request_id='60000000-0000-4000-8000-000000001001'),2::bigint,'both recipients have durable cancellation notification events');
select ok((select bool_and(events.receipt_id=receipts.id and events.recipient_user_id=receipts.recipient_user_id and events.recipient_role=receipts.recipient_role and events.notice_locale='en') from public.booking_notification_events events join public.booking_receipts receipts on receipts.id=events.receipt_id),'events bind preserved recipients role and language');
select is((select count(*) from public.booking_request_payment_history where to_state='cancelled'),1::bigint,'cancellation contributes one attributed financial-history transition');
select throws_ok($$update public.booking_cancellations set refund_booking_price_fils=0$$,'RC409',null,'a refund obligation cannot be overwritten');
select throws_ok($$delete from public.booking_notification_events$$,'RC409',null,'cancellation notification facts cannot be removed');
select lives_ok($$insert into public.cottage_booking_period_commitments(id,customer_user_id,profile_id,schedule_revision_id,commitment_reference,status,access_ranges)
select '50000000-0000-4000-8000-000000003899','10000000-0000-4000-8000-000000001002',profile_id,schedule_revision_id,'REBOOK-AFTER-CANCELLATION','pending_hold',access_ranges from public.cottage_booking_period_commitments where id='50000000-0000-4000-8000-000000001001'$$,'same customer can reserve the original period after cancellation');
select lives_ok($$insert into public.cottage_booking_period_occupancies(booking_period_commitment_id,schedule_revision_id,shift_id,service_day)
select '50000000-0000-4000-8000-000000003899',schedule_revision_id,shift_id,service_day from public.cottage_booking_period_occupancies where booking_period_commitment_id='50000000-0000-4000-8000-000000001001'$$,'released future components can actually be reserved again');

rollback to savepoint confirmed;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
set local role authenticated;
select throws_ok($$select public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003803','cottage_owner','  ',null,'{}')$$,'22023',null,'owner cancellation requires a nonblank reason');
select lives_ok($$select public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003803','cottage_owner','Property unavailable',null,pg_temp.cancellation_decision('cottage_owner',true))$$,'owner cancellation commits a full obligation');
select throws_ok($$select public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003803','cottage_owner','Changed explanation',null,'{}')$$,'RC409',null,'reusing a command key with a changed reason is rejected');
reset role;
select ok((select reason from public.booking_cancellations)='Property unavailable' and (select count(*) from public.booking_cancellation_incidents)=1 and not exists(select 1 from public.booking_cancellation_administrator_audit),'owner reason and one incident are retained');
rollback to savepoint confirmed;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003801',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003801","aal":"aal1"}',true);
set local role authenticated;
select throws_ok($$select public.get_booking_cancellation_facts('60000000-0000-4000-8000-000000001001','platform_administrator')$$,'42501',null,'administrator cancellation requires multi-factor assurance');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003801","aal":"aal2"}',true);
select throws_ok($$select public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003804','platform_administrator','Safety concern',null,'{}')$$,'22023',null,'administrator cancellation requires the recorded category');
select lives_ok($$select public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003804','platform_administrator','Unsafe supply','safety',pg_temp.cancellation_decision('platform_administrator',true))$$,'administrator cancellation commits');
reset role;
select ok((select category from public.booking_cancellations)='safety' and (select count(*) from public.booking_cancellation_incidents)=1 and (select administrator_user_id from public.booking_cancellation_administrator_audit)='10000000-0000-4000-8000-000000003801','administrator cancellation has incident and attributed audit records');
rollback to savepoint before_fixture;

-- Keep at least one first-day component started and all next-day bundle components unstarted, independent of wall-clock duration.
select pg_temp.seed_cancellation_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-case when (clock_timestamp() at time zone 'Asia/Baghdad')::time<'08:00'::time then 1 else 0 end);
create temp table original_ranges as select access_ranges from public.cottage_booking_period_commitments;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select is(public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000003805','customer',null,null,pg_temp.cancellation_decision('customer',false))->'refundObligation','{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb,'late customer cancellation has no automatic refund');
reset role;
select is((select active from public.cottage_booking_period_occupancies where shift_id='32000000-0000-4000-8000-000000001001' order by service_day limit 1),true,'started first component retains its original reservation');
select is((select count(*) from public.cottage_booking_period_occupancies where active and service_day=(select max(service_day) from public.cottage_booking_period_occupancies)),0::bigint,'future bundle components are released after a booking has started');
select is((select access_ranges from public.cottage_booking_period_commitments),(select access_ranges from original_ranges),'late cancellation preserves original access history');
select * from finish();
rollback;
