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
select no_plan();
savepoint uncaptured_booking;
select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-3,false);
select pg_temp.actor('10000000-0000-4000-8000-000000001001');
set local role authenticated;
select is(public.list_booking_history('cottage_owner')#>>'{0,ownerEarnings,status}','unavailable','captured but unconfirmed production evidence is unavailable rather than a plausible zero');
reset role;
rollback to uncaptured_booking;
select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-3);

set local role service_role;
select public.commit_booking_completion('60000000-0000-4000-8000-000000001001',(select value->>'revision' from public.list_due_booking_completions(50) value));
reset role;
select pg_temp.actor('10000000-0000-4000-8000-000000001001');
set local role authenticated;
select is(public.get_booking_financial_view('RC-REQ-0000000000001001','cottage_owner')#>>'{ownerEarnings,status}','captured','ordinary matured booking without a settlement retains available earnings facts');
select is(public.get_booking_financial_view('RC-REQ-0000000000001001','cottage_owner')#>'{ownerEarnings,settlement}','null'::jsonb,'ordinary unsettled booking does not manufacture settlement evidence');
reset role;
select pg_temp.actor('10000000-0000-4000-8000-000000003801','aal2');
set local role authenticated;
create temp table owner_earnings_values(key text primary key,value jsonb);
grant all on owner_earnings_values to authenticated,service_role;
insert into owner_earnings_values values('settlement',public.request_booking_settlement('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000004101','Original 90m settlement',public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')->>'revision',90000000));
insert into owner_earnings_values values('refund',public.request_booking_refund_exception('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000004102','Completed 20m price refund','{"bookingPriceFils":20000000,"bookingServiceFeeFils":0}'));
set local role service_role;
insert into owner_earnings_values select 'refundClaim',public.claim_booking_refund((select (value->>'intentId')::uuid from owner_earnings_values where key='refund'));
insert into owner_earnings_values select 'refundAdmission',public.admit_booking_refund((select value#>'{request,executionPermit}' from owner_earnings_values where key='refundClaim'));
select pg_temp.payment_fixture_result((select value from owner_earnings_values where key='refundAdmission'),'succeeded');
reset role;

insert into auth.users(id,aud,role,phone,phone_confirmed_at) values
 ('10000000-0000-4000-8000-000000004101','authenticated','authenticated','+9647500004101',now()),
 ('10000000-0000-4000-8000-000000004102','authenticated','authenticated','+9647500004102',now()),
 ('10000000-0000-4000-8000-000000004103','authenticated','authenticated','+9647500004103',now());
insert into public.account_contexts(user_id,role,owner_approval_state) values
 ('10000000-0000-4000-8000-000000004101','cottage_owner','approved'),
 ('10000000-0000-4000-8000-000000004102','cottage_owner','suspended'),
 ('10000000-0000-4000-8000-000000004103','cottage_owner','prospective');
insert into public.booking_snapshots select '40000000-0000-4000-8000-000000004101','10000000-0000-4000-8000-000000001003',profile_id,repeat('4',64),repeat('5',64),quote_payload,intent_payload,booking_terms_version,booking_terms_locale,booking_terms_body,booking_terms_sha256,cancellation_policy_version,acceptance_locale,acceptance_evidence,repeat('6',64),marketplace_commission_rate_basis_points,marketplace_commission_amount_fils,clock_timestamp() from public.booking_snapshots where id='40000000-0000-4000-8000-000000001001';
insert into public.cottage_booking_period_commitments select '50000000-0000-4000-8000-000000004101','10000000-0000-4000-8000-000000001003',profile_id,schedule_revision_id,'PENDING-OWNER-EARNINGS',status,access_ranges,clock_timestamp() from public.cottage_booking_period_commitments where id='50000000-0000-4000-8000-000000001001';
insert into public.booking_requests(id,booking_request_reference,customer_user_id,owner_user_id,profile_id,booking_snapshot_id,booking_period_commitment_id,payment_lifecycle_id,customer_name,party_size,status,response_deadline,created_at,settled_at)
select '60000000-0000-4000-8000-000000004101','RC-REQ-0000000000004101','10000000-0000-4000-8000-000000001003',owner_user_id,profile_id,'40000000-0000-4000-8000-000000004101','50000000-0000-4000-8000-000000004101','73000000-0000-4000-8000-000000004101','Fictional pending customer',party_size,'pending',created_at+interval '4 hours',created_at,null from public.booking_requests where id='60000000-0000-4000-8000-000000001001';

select pg_temp.actor('10000000-0000-4000-8000-000000001001');
set local role authenticated;
create temp table owner_detail as select public.get_booking_financial_view('RC-REQ-0000000000001001','cottage_owner') value;
create temp table owner_history as select public.list_booking_history('cottage_owner') value;
select is((select value#>>'{ownerEarnings,status}' from owner_detail),'captured','verified owner receives explicit captured earnings facts');
select is((select value#>'{ownerEarnings,captured}' from owner_detail),'{"bookingPriceFils":100000000,"bookingServiceFeeFils":5000000}'::jsonb,'owner facts preserve the captured Booking Price and separate service fee');
select is((select value#>>'{ownerEarnings,marketplaceCommissionAmountFils}' from owner_detail),'10000000','owner facts preserve the original ten percent commission snapshot');
select is((select value#>>'{ownerEarnings,refunded,bookingPriceFils}' from owner_detail),'20000000','completed real refund evidence changes current owner facts');
select is((select value#>>'{ownerEarnings,settlement,amountFils}' from owner_detail),'90000000','stale requested settlement amount remains explicit beside the current 72m entitlement');
select is((select value#>>'{ownerEarnings,settlement,state}' from owner_detail),'requested','unexecuted stored settlement remains requested');
select is((select item->'ownerEarnings' from jsonb_array_elements((select value from owner_history)) item where item->>'bookingRequestId'='60000000-0000-4000-8000-000000001001'),(select value->'ownerEarnings' from owner_detail),'owner list and detail share the same validated earnings projection');
select is((select item#>>'{ownerEarnings,status}' from jsonb_array_elements((select value from owner_history)) item where item->>'bookingRequestId'='60000000-0000-4000-8000-000000004101'),'not-captured','guarded pending request is explicit and non-earning');
select ok(not ((select value->'ownerEarnings' from owner_detail)::text ~ 'commandId|actorUserId|reason|provider|observationId|historySequence|activeHoldIds|activeDisputeIds|incident|notification'),'owner earnings allowlist excludes administration, provider, identity, and incident details');
select throws_ok($$select public.get_booking_settlement_facts('60000000-0000-4000-8000-000000001001')$$,'42501',null,'owner still cannot call administrator settlement facts');
select throws_ok($$select public.booking_payout_command_facts('60000000-0000-4000-8000-000000001001','{}')$$,'42501',null,'owner cannot execute the private payout helper');
select throws_ok($$select public.booking_settlement_projection_facts('60000000-0000-4000-8000-000000001001','{}')$$,'42501',null,'owner cannot execute the private settlement helper');

select pg_temp.actor('10000000-0000-4000-8000-000000004101');
select throws_ok($$select public.get_booking_financial_view('RC-REQ-0000000000001001','cottage_owner')$$,'42501',null,'another approved owner cannot read earnings');
select pg_temp.actor('10000000-0000-4000-8000-000000001002');
select throws_ok($$select public.get_booking_financial_view('RC-REQ-0000000000001001','cottage_owner')$$,'42501',null,'customer cannot read owner earnings');
select ok(not (public.get_booking_financial_view('RC-REQ-0000000000001001','customer') ? 'ownerEarnings'),'customer detail excludes owner earnings');
select pg_temp.actor('10000000-0000-4000-8000-000000004103');
select throws_ok($$select public.get_booking_financial_view('RC-REQ-0000000000001001','cottage_owner')$$,'42501',null,'prospective actor cannot read owner earnings');
select pg_temp.actor('10000000-0000-4000-8000-000000004102');
select throws_ok($$select public.get_booking_financial_view('RC-REQ-0000000000001001','cottage_owner')$$,'42501',null,'suspended owner cannot read earnings');
select pg_temp.actor('10000000-0000-4000-8000-000000003801','aal2');
select ok(not (public.get_booking_financial_view('RC-REQ-0000000000001001','platform_administrator') ? 'ownerEarnings'),'administrator financial audit does not impersonate owner projection');
reset role;
select throws_ok($$select public.get_booking_financial_view('RC-REQ-0000000000001001','cottage_owner')$$,'42501',null,'anonymous actor cannot read owner earnings');
select ok(not has_function_privilege('anon','public.booking_payout_command_facts(uuid,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.booking_payout_command_facts(uuid,jsonb)','EXECUTE') and not has_function_privilege('service_role','public.booking_payout_command_facts(uuid,jsonb)','EXECUTE'),'private payout helper has no API execution grants');
select ok(not has_function_privilege('anon','public.booking_settlement_projection_facts(uuid,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.booking_settlement_projection_facts(uuid,jsonb)','EXECUTE') and not has_function_privilege('service_role','public.booking_settlement_projection_facts(uuid,jsonb)','EXECUTE'),'private settlement helper has no API execution grants');

select ok(bool_and(not has_function_privilege(api_role,signature,'EXECUTE')),
  'private snapshot readers cannot be invoked by any API role')
from (values ('anon'),('authenticated'),('service_role')) roles(api_role)
cross join (values
  ('public.booking_refund_source_facts(uuid)'),
  ('public.booking_capture_refund_totals_facts(uuid,jsonb)'),
  ('public.booking_cancellation_source_facts(uuid)'),
  ('public.booking_owner_earnings_facts(uuid,timestamptz)'),
  ('public.booking_settlement_projection_facts_at(uuid,jsonb,timestamptz)'),
  ('public.booking_completion_eligibility_at(uuid,timestamptz)')
) readers(signature);

select * from finish();
rollback;
