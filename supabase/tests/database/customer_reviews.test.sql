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
  target_namespace text default '10',
  target_shared_cottage_namespace text default null
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
declare shared_suffix text;
declare lifecycle_id text;
declare capture_fingerprint text;
declare target_owner_id text;
declare target_profile_id text;
declare target_schedule_id text;
declare shared_owner_id text;
declare shared_profile_id text;
declare shared_schedule_id text;
declare shared_bundle_id text;
declare setup_start integer;
declare setup_end integer;
declare setup_end_marker text:=
  'select set_config(''rentcottage.shift_schedule_write_revision_id'','''',true);';
begin
  if target_namespace !~ '^[0-9]{2}$' then
    raise exception 'Review fixture namespace is invalid';
  end if;
  suffix:='00000000'||target_namespace;
  if target_namespace <> '10' then
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
  if target_shared_cottage_namespace is not null then
    if target_shared_cottage_namespace !~ '^[0-9]{2}$'
      or target_shared_cottage_namespace=target_namespace
    then
      raise exception 'Shared review fixture namespace is invalid';
    end if;
    shared_suffix:='00000000'||target_shared_cottage_namespace;
    target_owner_id:='10000000-0000-4000-8000-'||suffix||'01';
    target_profile_id:='20000000-0000-4000-8000-'||suffix||'01';
    target_schedule_id:='30000000-0000-4000-8000-'||suffix||'01';
    shared_owner_id:='10000000-0000-4000-8000-'||shared_suffix||'01';
    shared_profile_id:='20000000-0000-4000-8000-'||shared_suffix||'01';
    shared_schedule_id:='30000000-0000-4000-8000-'||shared_suffix||'01';
    shared_bundle_id:='31000000-0000-4000-8000-'||shared_suffix||'01';
    if not exists(
      select 1
      from public.owner_application_cottage_profiles profiles
      join public.cottage_shift_schedule_revisions schedules
        on schedules.id=shared_schedule_id::uuid
        and schedules.profile_id=profiles.id
        and schedules.full_day_bundle_id=shared_bundle_id::uuid
      where profiles.id=shared_profile_id::uuid
        and profiles.owner_user_id=shared_owner_id::uuid
        and (
          select count(*)
          from public.cottage_shifts shifts
          where shifts.schedule_revision_id=schedules.id
        )=3
    ) then
      raise exception 'Shared review cottage fixture is unavailable';
    end if;
    fixture:=replace(
      fixture,
      format(
        '(%L,%L,%L,%L,now()),%s',
        target_owner_id,'authenticated','authenticated',
        '+964750000'||target_namespace||'01',chr(10)
      ),
      ''
    );
    fixture:=replace(
      fixture,
      format(
        '(%L,%L,%L),%s',
        target_owner_id,'cottage_owner','approved',chr(10)
      ),
      ''
    );
    setup_start:=strpos(
      fixture,'insert into public.owner_application_cottage_profiles'
    );
    setup_end:=strpos(fixture,setup_end_marker);
    if setup_start=0 or setup_end<setup_start then
      raise exception 'Shared review cottage fixture setup changed';
    end if;
    fixture:=overlay(
      fixture placing '' from setup_start
      for setup_end-setup_start+char_length(setup_end_marker)+1
    );
    fixture:=replace(fixture,target_owner_id,shared_owner_id);
    fixture:=replace(fixture,target_profile_id,shared_profile_id);
    fixture:=replace(fixture,target_schedule_id,shared_schedule_id);
    fixture:=replace(
      fixture,
      '31000000-0000-4000-8000-'||suffix||'01',
      shared_bundle_id
    );
    for shift_position in 1..3 loop
      fixture:=replace(
        fixture,
        '32000000-0000-4000-8000-'||suffix||lpad(shift_position::text,2,'0'),
        '32000000-0000-4000-8000-'||shared_suffix||lpad(shift_position::text,2,'0')
      );
    end loop;
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
select is(
  public.get_customer_review('RC-REQ-0000000000001401'),
  '{"status":"ineligible"}'::jsonb,
  'the own-review reader reports a booking without paid confirmation as ineligible'
);
reset role;

select pg_temp.seed_completion_booking(
  ((clock_timestamp() at time zone 'Asia/Baghdad')::date + 1),true,'16'
);
select ok(
  (select public.booking_request_payment_status(requests)='paid-confirmed'
    from public.booking_requests requests
    where requests.id='60000000-0000-4000-8000-000000001601')
  and not exists(
    select 1 from public.booking_lifecycle_outcomes
    where booking_request_id='60000000-0000-4000-8000-000000001601'
  )
  and not exists(
    select 1 from public.booking_completion_maturity
    where booking_request_id='60000000-0000-4000-8000-000000001601'
  ),
  'the upcoming fixture is paid-confirmed without completed lifecycle or maturity evidence'
);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001602',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001602","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(
  public.get_customer_review('RC-REQ-0000000000001601'),
  '{"status":"ineligible"}'::jsonb,
  'a normal paid-confirmed upcoming booking is ineligible without a recovery state'
);
reset role;

select pg_temp.seed_completion_booking(
  ((clock_timestamp() at time zone 'Asia/Baghdad')::date - 3),true,'17'
);
insert into public.booking_lifecycle_outcomes(
  id,booking_request_id,booking_confirmation_id,booking_period_commitment_id,
  outcome,effective_period_end,recorded_at
)
select
  '89000000-0000-4000-8000-000000001701',requests.id,
  confirmations.id,commitments.id,'completed',
  upper(range_merge(commitments.access_ranges)),clock_timestamp()
from public.booking_requests requests
join public.booking_confirmations confirmations
  on confirmations.booking_request_id=requests.id
join public.cottage_booking_period_commitments commitments
  on commitments.id=requests.booking_period_commitment_id
where requests.id='60000000-0000-4000-8000-000000001701';
select ok(
  (select public.booking_request_payment_status(requests)='paid-confirmed'
    from public.booking_requests requests
    where requests.id='60000000-0000-4000-8000-000000001701')
  and exists(
    select 1 from public.booking_lifecycle_outcomes
    where booking_request_id='60000000-0000-4000-8000-000000001701'
      and outcome='completed'
  )
  and not exists(
    select 1 from public.booking_completion_maturity
    where booking_request_id='60000000-0000-4000-8000-000000001701'
  ),
  'the recovery fixture has durable completed lifecycle evidence but no maturity row'
);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001702',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001702","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(
  public.get_customer_review('RC-REQ-0000000000001701'),
  '{"status":"unavailable"}'::jsonb,
  'completed lifecycle evidence with missing maturity remains an unavailable recovery state'
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
select ok(
  (
    select maturity.review_expires_at=outcomes.effective_period_end+interval '14 days'
      and maturity.review_expires_at<=clock_timestamp()
    from public.booking_lifecycle_outcomes outcomes
    join public.booking_completion_maturity maturity
      on maturity.booking_request_id=outcomes.booking_request_id
    where outcomes.booking_request_id='60000000-0000-4000-8000-000000001501'
      and outcomes.outcome='completed'
  ),
  'the expired fixture deadline is independently the completed period end plus fourteen days'
);
set local role authenticated;
select is(
  public.submit_customer_review(
    'RC-REQ-0000000000001501',5,'en','Expired review'
  )->>'status',
  'ineligible','late completion assessment never extends the authoritative review deadline'
);
select is(
  public.get_customer_review('RC-REQ-0000000000001501'),
  '{"status":"ineligible"}'::jsonb,
  'the own-review reader reports a completed booking after its deadline as ineligible'
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
  (
    select maturity.review_expires_at=outcomes.effective_period_end+interval '14 days'
      and clock_timestamp()>=outcomes.effective_period_end
      and clock_timestamp()<maturity.review_expires_at
    from public.booking_lifecycle_outcomes outcomes
    join public.booking_completion_maturity maturity
      on maturity.booking_request_id=outcomes.booking_request_id
    where outcomes.booking_request_id='60000000-0000-4000-8000-000000001001'
      and outcomes.outcome='completed'
  ),
  'the open fixture deadline is independently the completed period end plus fourteen days'
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
  $$select public.list_administrator_customer_reviews(null,null,50,null,null,null)$$,
  '42501',null,'the filtered administrator reader denies missing identity'
);
select throws_ok(
  $$select public.hide_customer_review(gen_random_uuid(),'Reason')$$,
  '42501',null,'review hiding denies missing identity'
);
reset role;

select ok(
  not has_function_privilege('anon','public.list_administrator_customer_reviews(timestamptz,uuid,integer,text,date,date)','EXECUTE')
  and not has_function_privilege('service_role','public.list_administrator_customer_reviews(timestamptz,uuid,integer,text,date,date)','EXECUTE'),
  'the filtered administrator reader is not executable by anon or service_role'
);

create temp table open_review_eligibility_expected as
select jsonb_build_object(
  'status','eligible',
  'reviewExpiresAt',outcomes.effective_period_end+interval '14 days'
) value
from public.booking_lifecycle_outcomes outcomes
where outcomes.booking_request_id='60000000-0000-4000-8000-000000001001'
  and outcomes.outcome='completed';
grant select on open_review_eligibility_expected to authenticated;

savepoint customer_review_submit_context_control;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(
  public.get_customer_review('RC-REQ-0000000000001001'),
  (select value from open_review_eligibility_expected),
  'the same Customer reads the independently derived open deadline while its account context is present'
);
select is(
  public.submit_customer_review(
    'RC-REQ-0000000000001001',5,'en','Guarded context control'
  )->>'status',
  'submitted','the same Customer can submit while its account context is present'
);
reset role;
rollback to savepoint customer_review_submit_context_control;

savepoint customer_review_submit_missing_context;
set session_replication_role=replica;
delete from public.account_contexts
where user_id='10000000-0000-4000-8000-000000001002';
set session_replication_role=origin;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok(
  $$select public.submit_customer_review(
    'RC-REQ-0000000000001001',5,'en','Missing context attempt'
  )$$,
  '42501',null,'review submission denies the same Customer when its account context is missing'
);
select throws_ok(
  $$select public.get_customer_review('RC-REQ-0000000000001001')$$,
  '42501',null,'the own-review reader denies the same Customer when its account context is missing'
);
reset role;
rollback to savepoint customer_review_submit_missing_context;

savepoint customer_review_phone_confirmation;
update auth.users
set phone_confirmed_at=null
where id='10000000-0000-4000-8000-000000001002';
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok(
  $$select public.submit_customer_review(
    'RC-REQ-0000000000001001',5,'en','Unconfirmed phone attempt'
  )$$,
  '42501',null,'review submission denies the same Customer when phone confirmation is absent'
);
select throws_ok(
  $$select public.get_customer_review('RC-REQ-0000000000001001')$$,
  '42501',null,'the own-review reader denies the same Customer when phone confirmation is absent'
);
reset role;
rollback to savepoint customer_review_phone_confirmation;

savepoint customer_review_phone_confirmation_control;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(
  public.get_customer_review('RC-REQ-0000000000001001')->>'status',
  'eligible','the same Customer can read its eligibility after phone confirmation is restored'
);
select is(
  public.submit_customer_review(
    'RC-REQ-0000000000001001',5,'en','Restored phone control'
  )->>'status',
  'submitted','the same Customer can submit after phone confirmation is restored'
);
reset role;
rollback to savepoint customer_review_phone_confirmation_control;

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
savepoint customer_review_reply_without_review;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal1"}',true);
select ok(
  public.get_owner_customer_review('RC-REQ-0000000000001001')
    ='{"status":"no-review"}'::jsonb
  and public.submit_customer_review_reply(
    'RC-REQ-0000000000001001','en','Thank you for staying with us.'
  )='{"status":"ineligible"}'::jsonb,
  'a booking without a review has nothing to read or reply to'
);
rollback to savepoint customer_review_reply_without_review;
create temp table review_whitespace_observations(value jsonb);
savepoint review_whitespace_submission;
reset role;
select is((select count(*)::integer from public.customer_reviews),0,
  'whitespace submission starts without a review');
set local role authenticated;
select lives_ok(
  $$insert into review_whitespace_observations
    select public.submit_customer_review('RC-REQ-0000000000001001',5,'en',E'\n\t')$$,
  'whitespace review submission returns without a constraint exception'
);
reset role;
select ok(
  (select count(*)=1 and bool_and(value->>'status'='submitted')
    from review_whitespace_observations)
  and (select count(*)=1 and bool_and(original_body is null)
    from public.customer_reviews),
  'whitespace-only review text is stored as a rating-only review'
);
rollback to savepoint review_whitespace_submission;
reset role;
savepoint review_whitespace_control;
select is((select count(*)::integer from public.customer_reviews),0,
  'NULL review control starts without a stored row');
set local role authenticated;
select lives_ok(
  $$insert into review_whitespace_observations
    select public.submit_customer_review('RC-REQ-0000000000001001',5,'en',null)$$,
  'NULL review control returns without a constraint exception'
);
reset role;
select ok(
  (select count(*)=1 and bool_and(value->>'status'='submitted')
    from review_whitespace_observations)
  and (select count(*)=1 and bool_and(original_body is not distinct from null)
    from public.customer_reviews),
  'NULL review text preserves its admission and storage contract'
);
rollback to savepoint review_whitespace_control;
savepoint review_whitespace_control;
select is((select count(*)::integer from public.customer_reviews),0,
  'empty review control starts without a stored row');
set local role authenticated;
select lives_ok(
  $$insert into review_whitespace_observations
    select public.submit_customer_review('RC-REQ-0000000000001001',5,'en','')$$,
  'empty review control returns without a constraint exception'
);
reset role;
select ok(
  (select count(*)=1 and bool_and(value->>'status'='submitted')
    from review_whitespace_observations)
  and (select count(*)=1 and bool_and(original_body is not distinct from null)
    from public.customer_reviews),
  'empty review text preserves its admission and storage contract'
);
rollback to savepoint review_whitespace_control;
savepoint review_whitespace_control;
select is((select count(*)::integer from public.customer_reviews),0,
  'spaces review control starts without a stored row');
set local role authenticated;
select lives_ok(
  $$insert into review_whitespace_observations
    select public.submit_customer_review('RC-REQ-0000000000001001',5,'en','   ')$$,
  'spaces review control returns without a constraint exception'
);
reset role;
select ok(
  (select count(*)=1 and bool_and(value->>'status'='submitted')
    from review_whitespace_observations)
  and (select count(*)=1 and bool_and(original_body is not distinct from null)
    from public.customer_reviews),
  'spaces review text preserves its admission and storage contract'
);
rollback to savepoint review_whitespace_control;
savepoint review_whitespace_control;
select is((select count(*)::integer from public.customer_reviews),0,
  'mixed whitespace review control starts without a stored row');
set local role authenticated;
select lives_ok(
  $$insert into review_whitespace_observations
    select public.submit_customer_review('RC-REQ-0000000000001001',5,'en',E' \r\n\t ')$$,
  'mixed whitespace review control returns without a constraint exception'
);
reset role;
select ok(
  (select count(*)=1 and bool_and(value->>'status'='submitted')
    from review_whitespace_observations)
  and (select count(*)=1 and bool_and(original_body is not distinct from null)
    from public.customer_reviews),
  'mixed whitespace review text preserves its admission and storage contract'
);
rollback to savepoint review_whitespace_control;
savepoint review_whitespace_control;
select is((select count(*)::integer from public.customer_reviews),0,
  'surrounded nonblank review control starts without a stored row');
set local role authenticated;
select lives_ok(
  $$insert into review_whitespace_observations
    select public.submit_customer_review('RC-REQ-0000000000001001',5,'en',E' \nGarden\t ')$$,
  'surrounded nonblank review control returns without a constraint exception'
);
reset role;
select ok(
  (select count(*)=1 and bool_and(value->>'status'='submitted')
    from review_whitespace_observations)
  and (select count(*)=1 and bool_and(original_body is not distinct from E' \nGarden\t ')
    from public.customer_reviews),
  'surrounded nonblank review text preserves its admission and storage contract'
);
rollback to savepoint review_whitespace_control;
savepoint review_whitespace_control;
select is((select count(*)::integer from public.customer_reviews),0,
  '2000-character nonblank review control starts without a stored row');
set local role authenticated;
select lives_ok(
  $$insert into review_whitespace_observations
    select public.submit_customer_review('RC-REQ-0000000000001001',5,'en',repeat('x',2000))$$,
  '2000-character nonblank review control returns without a constraint exception'
);
reset role;
select ok(
  (select count(*)=1 and bool_and(value->>'status'='submitted')
    from review_whitespace_observations)
  and (select count(*)=1 and bool_and(original_body is not distinct from repeat('x',2000))
    from public.customer_reviews),
  '2000-character nonblank review text preserves its admission and storage contract'
);
rollback to savepoint review_whitespace_control;
savepoint review_whitespace_control;
select is((select count(*)::integer from public.customer_reviews),0,
  '2000-character whitespace review control starts without a stored row');
set local role authenticated;
select lives_ok(
  $$insert into review_whitespace_observations
    select public.submit_customer_review('RC-REQ-0000000000001001',5,'en',repeat(E'\t',2000))$$,
  '2000-character whitespace review control returns without a constraint exception'
);
reset role;
select ok(
  (select count(*)=1 and bool_and(value->>'status'='submitted')
    from review_whitespace_observations)
  and (select count(*)=1 and bool_and(original_body is not distinct from null)
    from public.customer_reviews),
  '2000-character whitespace review text preserves its admission and storage contract'
);
rollback to savepoint review_whitespace_control;
savepoint review_whitespace_control;
select is((select count(*)::integer from public.customer_reviews),0,
  '2001-character whitespace review control starts without a stored row');
set local role authenticated;
select lives_ok(
  $$insert into review_whitespace_observations
    select public.submit_customer_review('RC-REQ-0000000000001001',5,'en',repeat(E'\t',2001))$$,
  '2001-character whitespace review control returns without a constraint exception'
);
reset role;
select ok(
  (select count(*)=1 and bool_and(value->>'status'='invalid')
    from review_whitespace_observations)
  and (select count(*)=0 from public.customer_reviews),
  '2001-character whitespace review text preserves its admission and storage contract'
);
rollback to savepoint review_whitespace_control;
savepoint direct_review_whitespace;
select is((select count(*)::integer from public.customer_reviews),0,
  'direct whitespace review starts without a review');
select throws_ok(
  $$insert into public.customer_reviews(
    booking_request_id,booking_confirmation_id,profile_id,author_user_id,
    rating,original_language,original_body
  ) select requests.id,confirmations.id,requests.profile_id,requests.customer_user_id,
      5,'en',E' \r\n\t '
    from public.booking_requests requests
    join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id
    where requests.id='60000000-0000-4000-8000-000000001001'$$,
  '23514',
  'new row for relation "customer_reviews" violates check constraint "customer_reviews_original_body_check"',
  'the review body check rejects a direct whitespace-only insert'
);
rollback to savepoint direct_review_whitespace;
savepoint direct_review_control;
select is((select count(*)::integer from public.customer_reviews),0,
  'direct NULL review control starts without a review');
select lives_ok(
  $$insert into public.customer_reviews(
    booking_request_id,booking_confirmation_id,profile_id,author_user_id,
    rating,original_language,original_body
  ) select requests.id,confirmations.id,requests.profile_id,requests.customer_user_id,
      5,'en',null
    from public.booking_requests requests
    join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id
    where requests.id='60000000-0000-4000-8000-000000001001'$$,
  'the review body check admits a direct NULL insert'
);
select ok((select count(*)=1 and bool_and(original_body is not distinct from null)
  from public.customer_reviews),'direct NULL review text is preserved');
rollback to savepoint direct_review_control;
savepoint direct_review_control;
select is((select count(*)::integer from public.customer_reviews),0,
  'direct nonblank review control starts without a review');
select lives_ok(
  $$insert into public.customer_reviews(
    booking_request_id,booking_confirmation_id,profile_id,author_user_id,
    rating,original_language,original_body
  ) select requests.id,confirmations.id,requests.profile_id,requests.customer_user_id,
      5,'en',E' \nGarden\t '
    from public.booking_requests requests
    join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id
    where requests.id='60000000-0000-4000-8000-000000001001'$$,
  'the review body check admits a direct nonblank insert'
);
select ok((select count(*)=1 and bool_and(original_body is not distinct from E' \nGarden\t ')
  from public.customer_reviews),'direct nonblank review text is preserved');
rollback to savepoint direct_review_control;
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

select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
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
        =array['originalBody','originalLanguage','ownerReply','rating','reviewId','submittedAt']
    from result
  ),
  'anonymous public review reading returns only the admitted public projection'
);
reset role;

update public.cottage_marketplace_listings
set state='paused'
where profile_id='20000000-0000-4000-8000-000000001001';
set local role anon;
select is(
  public.list_public_customer_reviews(
    'cottage-deadbeefdeadbeefdeadbeefdead1001',null,null,20
  ),
  '{"status":"not-found"}'::jsonb,
  'a paused known listing is not found and exposes no public review payload'
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
      and (select array_agg(key order by key) from jsonb_object_keys(value#>'{items,0}') key)
        =array['originalBody','originalLanguage','ownerReply','rating','reviewId','submittedAt']
    from result
  ),
  'restoring the listing returns the unchanged minimal public review projection'
);
reset role;

savepoint customer_review_reply;
create temp table reply_fixture as
select reviews.id review_id,reviews.submitted_at
from public.customer_reviews reviews
where reviews.booking_request_id='60000000-0000-4000-8000-000000001001';
grant select on reply_fixture to authenticated;
create temp table reply_observations(name text primary key,value jsonb not null);
grant select,insert on reply_observations to anon,authenticated;

select ok(
  not exists(
    select 1
    from unnest(array['anon','authenticated','service_role']::name[]) grantee,
      unnest(array[
        'public.customer_review_replies','public.customer_review_reply_hides'
      ]) relation
    where has_table_privilege(
      grantee,relation,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
    )
  )
  and (
    select bool_and(
      has_function_privilege('authenticated',routine,'EXECUTE')
      and not has_function_privilege('anon',routine,'EXECUTE')
      and not has_function_privilege('service_role',routine,'EXECUTE')
    )
    from unnest(array[
      'public.submit_customer_review_reply(text,public.cottage_profile_source_language,text)',
      'public.get_owner_customer_review(text)',
      'public.hide_customer_review_reply(uuid,text)'
    ]) routine
  ),
  'reply tables deny direct access and only the three reply functions are granted'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok(
  $$select public.get_owner_customer_review('RC-REQ-0000000000001001')$$,
  '42501',null,
  'only the approved Cottage Owner of the reviewed booking can read its review (the Customer)'
);
select throws_ok(
  $$select public.submit_customer_review_reply('RC-REQ-0000000000001001','en','Denied reply')$$,
  '42501',null,
  'only the approved Cottage Owner of the reviewed booking can reply (the Customer)'
);
reset role;

savepoint customer_review_reply_other_owner;
update public.account_contexts
set role='cottage_owner',owner_approval_state='approved'
where user_id='10000000-0000-4000-8000-000000001003';
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001003',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001003","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok(
  $$select public.get_owner_customer_review('RC-REQ-0000000000001001')$$,
  '42501',null,
  'only the approved Cottage Owner of the reviewed booking can read its review (another approved Cottage Owner)'
);
select throws_ok(
  $$select public.submit_customer_review_reply('RC-REQ-0000000000001001','en','Denied reply')$$,
  '42501',null,
  'only the approved Cottage Owner of the reviewed booking can reply (another approved Cottage Owner)'
);
reset role;
rollback to savepoint customer_review_reply_other_owner;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003801',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003801","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select throws_ok(
  $$select public.get_owner_customer_review('RC-REQ-0000000000001001')$$,
  '42501',null,
  'only the approved Cottage Owner of the reviewed booking can read its review (an AAL2 administrator)'
);
select throws_ok(
  $$select public.submit_customer_review_reply('RC-REQ-0000000000001001','en','Denied reply')$$,
  '42501',null,
  'only the approved Cottage Owner of the reviewed booking can reply (an AAL2 administrator)'
);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok(
  $$select public.get_owner_customer_review('RC-REQ-00000000000000FF')$$,
  '42501',null,
  'only the approved Cottage Owner of the reviewed booking can read its review (an unknown reference)'
);
select throws_ok(
  $$select public.submit_customer_review_reply('RC-REQ-00000000000000FF','en','Denied reply')$$,
  '42501',null,
  'only the approved Cottage Owner of the reviewed booking can reply (an unknown reference)'
);
reset role;

savepoint customer_review_reply_suspended_owner;
update public.account_contexts
set owner_approval_state='suspended'
where user_id='10000000-0000-4000-8000-000000001001';
set local role authenticated;
select throws_ok(
  $$select public.get_owner_customer_review('RC-REQ-0000000000001001')$$,
  '42501',null,
  'only the approved Cottage Owner of the reviewed booking can read its review (the owner while suspended)'
);
select throws_ok(
  $$select public.submit_customer_review_reply('RC-REQ-0000000000001001','en','Denied reply')$$,
  '42501',null,
  'only the approved Cottage Owner of the reviewed booking can reply (the owner while suspended)'
);
reset role;
rollback to savepoint customer_review_reply_suspended_owner;

savepoint customer_review_reply_owner_phone;
update auth.users
set phone_confirmed_at=null
where id='10000000-0000-4000-8000-000000001001';
set local role authenticated;
select throws_ok(
  $$select public.get_owner_customer_review('RC-REQ-0000000000001001')$$,
  '42501',null,
  'only the approved Cottage Owner of the reviewed booking can read its review (the owner without a confirmed phone)'
);
select throws_ok(
  $$select public.submit_customer_review_reply('RC-REQ-0000000000001001','en','Denied reply')$$,
  '42501',null,
  'only the approved Cottage Owner of the reviewed booking can reply (the owner without a confirmed phone)'
);
reset role;
rollback to savepoint customer_review_reply_owner_phone;

select is(
  (select count(*)::integer from public.customer_review_replies),0,
  'denied reply attempts store nothing'
);

set local role authenticated;
select is(
  public.get_owner_customer_review('RC-REQ-0000000000001001'),
  jsonb_build_object(
    'status','reviewed',
    'rating',5,
    'originalLanguage','en',
    'originalBody','A peaceful stay with a lovely garden.',
    'submittedAt',(select submitted_at from reply_fixture),
    'reply',null
  ),
  'the owner reads the review without Customer identity before replying'
);

insert into reply_observations
select 'invalid reply: blank',public.submit_customer_review_reply(
  'RC-REQ-0000000000001001','en','   '
)
union all
select 'invalid reply: oversized',public.submit_customer_review_reply(
  'RC-REQ-0000000000001001','en',repeat('x',2001)
)
union all
select 'invalid reply: no language',public.submit_customer_review_reply(
  'RC-REQ-0000000000001001',null,'Thank you for staying with us.'
)
union all
select 'invalid reply: no body',public.submit_customer_review_reply(
  'RC-REQ-0000000000001001','en',null
)
union all
select 'invalid reply: only newlines and tabs',public.submit_customer_review_reply(
  'RC-REQ-0000000000001001','en',E'\n\t\n'
);
insert into reply_observations
select 'prohibited reply: phone',public.submit_customer_review_reply(
  'RC-REQ-0000000000001001','en','Call us on +964 750 123 4567'
)
union all
select 'prohibited reply: email',public.submit_customer_review_reply(
  'RC-REQ-0000000000001001','en','Write to owner@example.test'
)
union all
select 'prohibited reply: link',public.submit_customer_review_reply(
  'RC-REQ-0000000000001001','en','Book again at https://example.test'
)
union all
select 'prohibited reply: handle',public.submit_customer_review_reply(
  'RC-REQ-0000000000001001','en','Find us as @cottageowner'
);
reset role;
select ok(
  (
    select count(*)=5 and bool_and(value='{"status":"invalid"}'::jsonb)
    from reply_observations where name like 'invalid reply: %'
  )
  and (select count(*)=0 from public.customer_review_replies),
  'a blank, oversized or language-less reply is invalid and stores nothing'
);
select ok(
  (
    select count(*)=4 and bool_and(value='{"status":"prohibited-content"}'::jsonb)
    from reply_observations where name like 'prohibited reply: %'
  )
  and (select count(*)=0 from public.customer_review_replies),
  'a reply with contact details is refused before storage'
);

savepoint customer_review_reply_byte_order_mark_submit;
set local role authenticated;
insert into reply_observations
select 'byte order mark reply',public.submit_customer_review_reply(
  'RC-REQ-0000000000001001','en',E'\n' || chr(65279) || ' '
);
reset role;
select ok(
  (
    select value='{"status":"invalid"}'::jsonb
    from reply_observations where name='byte order mark reply'
  )
  and (select count(*)=0 from public.customer_review_replies),
  'a reply made only of whitespace and byte order marks is invalid and stores nothing'
);
rollback to savepoint customer_review_reply_byte_order_mark_submit;

savepoint customer_review_reply_hidden_review;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003801',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003801","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select public.hide_customer_review(
  (select review_id from reply_fixture),'Review hidden before any reply'
);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal1"}',true);
select ok(
  public.submit_customer_review_reply(
    'RC-REQ-0000000000001001','en','Thank you for staying with us.'
  )='{"status":"ineligible"}'::jsonb
  and public.get_owner_customer_review('RC-REQ-0000000000001001')
    ='{"status":"review-hidden","reply":null}'::jsonb,
  'a hidden review accepts no reply and shows the owner no review text'
);
reset role;
rollback to savepoint customer_review_reply_hidden_review;

savepoint customer_review_reply_whitespace_body;
select throws_ok(
  $$insert into public.customer_review_replies(
    review_id,author_user_id,original_language,original_body
  )
  select review_id,'10000000-0000-4000-8000-000000001001','en',E'\n\t'
  from reply_fixture$$,
  '23514',null,'a whitespace-only reply body is rejected by the reply body check'
);
rollback to savepoint customer_review_reply_whitespace_body;

savepoint customer_review_reply_byte_order_mark_body;
select throws_ok(
  $$insert into public.customer_review_replies(
    review_id,author_user_id,original_language,original_body
  )
  select review_id,'10000000-0000-4000-8000-000000001001','en',
    E'\n' || chr(65279) || ' '
  from reply_fixture$$,
  '23514',null,'a byte-order-mark-only reply body is rejected by the reply body check'
);
rollback to savepoint customer_review_reply_byte_order_mark_body;

set local role authenticated;
insert into reply_observations
select 'first reply',public.submit_customer_review_reply(
  'RC-REQ-0000000000001001','en','Thank you for staying with us.'
);
reset role;
select ok(
  (
    select value->>'status'='replied'
      and (select array_agg(key order by key) from jsonb_object_keys(value) key)
        =array['affectedPublicSlug','reviewId','status','submittedAt']
      and value->>'affectedPublicSlug'='cottage-deadbeefdeadbeefdeadbeefdead1001'
      and value->>'reviewId'=(select review_id::text from reply_fixture)
      and (value->>'submittedAt')::timestamptz
        =(select submitted_at from public.customer_review_replies)
    from reply_observations where name='first reply'
  )
  and (
    select count(*)=1
      and bool_and(
        replies.review_id=(select review_id from reply_fixture)
        and replies.author_user_id='10000000-0000-4000-8000-000000001001'
        and replies.original_language='en'
        and replies.original_body='Thank you for staying with us.'
      )
    from public.customer_review_replies replies
  ),
  'the first reply is stored once with its author and returns the exact mutation target'
);

set local role authenticated;
insert into reply_observations
select 'second reply',public.submit_customer_review_reply(
  'RC-REQ-0000000000001001','ckb','Call us on +964 750 123 4567'
);
reset role;
select ok(
  (
    select value->>'status'='duplicate'
      and (select array_agg(key order by key) from jsonb_object_keys(value) key)
        =array['reviewId','status','submittedAt']
      and value->>'reviewId'=(select review_id::text from reply_fixture)
      and (value->>'submittedAt')::timestamptz
        =(select submitted_at from public.customer_review_replies)
    from reply_observations where name='second reply'
  )
  and (
    select count(*)=1
      and bool_and(
        replies.original_language='en'
        and replies.original_body='Thank you for staying with us.'
      )
    from public.customer_review_replies replies
  ),
  'a second reply returns duplicate and leaves the first reply unchanged'
);
select throws_ok(
  $$insert into public.customer_review_replies(
    review_id,author_user_id,original_language,original_body
  )
  select review_id,'10000000-0000-4000-8000-000000001001','en','A second direct reply'
  from reply_fixture$$,
  '23505',null,'a direct second reply row is rejected by the reply key'
);

select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
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
      and (
        select array_agg(key order by key)
        from jsonb_object_keys(value#>'{items,0,ownerReply}') key
      )=array['originalBody','originalLanguage','submittedAt']
      and value#>>'{items,0,ownerReply,originalLanguage}'='en'
      and value#>>'{items,0,ownerReply,originalBody}'='Thank you for staying with us.'
    from result
  ),
  'visitors read the reply with its review and no author identity'
);
reset role;

savepoint customer_review_reply_review_hidden;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003801',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003801","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select public.hide_customer_review(
  (select review_id from reply_fixture),'Review hidden after its reply'
);
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role anon;
insert into reply_observations
select 'public list after review hide',public.list_public_customer_reviews(
  'cottage-deadbeefdeadbeefdeadbeefdead1001',null,null,20
);
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select ok(
  (
    select value->>'status'='success' and jsonb_array_length(value->'items')=0
    from reply_observations where name='public list after review hide'
  )
  and (
    with owner_view as (
      select public.get_owner_customer_review('RC-REQ-0000000000001001') value
    )
    select value->>'status'='review-hidden'
      and (select array_agg(key order by key) from jsonb_object_keys(value) key)
        =array['reply','status']
      and value#>>'{reply,moderationState}'='unhidden'
    from owner_view
  ),
  'a hidden review removes its reply from visitors'
);
reset role;
rollback to savepoint customer_review_reply_review_hidden;

savepoint customer_review_reply_whitespace_reason;
select throws_ok(
  $$insert into public.customer_review_reply_hides(
    review_id,administrator_user_id,reason
  )
  select review_id,'10000000-0000-4000-8000-000000003801',E'\n\t'
  from reply_fixture$$,
  '23514',null,'a whitespace-only reply hide reason is rejected by the reason check'
);
rollback to savepoint customer_review_reply_whitespace_reason;

savepoint customer_review_reply_byte_order_mark_reason;
select throws_ok(
  $$insert into public.customer_review_reply_hides(
    review_id,administrator_user_id,reason
  )
  select review_id,'10000000-0000-4000-8000-000000003801',
    E'\n' || chr(65279) || ' '
  from reply_fixture$$,
  '23514',null,'a byte-order-mark-only reply hide reason is rejected by the reason check'
);
rollback to savepoint customer_review_reply_byte_order_mark_reason;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select throws_ok(
  format(
    'select public.hide_customer_review_reply(%L,%L)',
    (select review_id from reply_fixture),'Cottage Owner attempt'
  ),
  '42501',null,'hiding a reply needs an AAL2 administrator and a reason'
);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(
  format(
    'select public.hide_customer_review_reply(%L,%L)',
    (select review_id from reply_fixture),'Customer attempt'
  ),
  '42501',null,'hiding a reply needs an AAL2 administrator and a reason'
);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003801',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003801","role":"authenticated","aal":"aal1"}',true);
select throws_ok(
  format(
    'select public.hide_customer_review_reply(%L,%L)',
    (select review_id from reply_fixture),'AAL1 administrator attempt'
  ),
  '42501',null,'hiding a reply needs an AAL2 administrator and a reason'
);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003801","role":"authenticated","aal":"aal2"}',true);
select ok(
  public.hide_customer_review_reply(
    (select review_id from reply_fixture),'   '
  )='{"status":"invalid"}'::jsonb
  and public.hide_customer_review_reply(
    (select review_id from reply_fixture),E'\n\t\n'
  )='{"status":"invalid"}'::jsonb
  and public.hide_customer_review_reply(
    '99999999-0000-4000-8000-000000001001','Unknown review'
  )='{"status":"invalid"}'::jsonb,
  'hiding a reply needs an AAL2 administrator and a reason'
);
reset role;
select is(
  (select count(*)::integer from public.customer_review_reply_hides),0,
  'an invalid reply hide stores nothing'
);
savepoint customer_review_reply_byte_order_mark_hide;
set local role authenticated;
insert into reply_observations
select 'byte order mark reply hide',public.hide_customer_review_reply(
  (select review_id from reply_fixture),E'\n' || chr(65279) || ' '
);
reset role;
select ok(
  (
    select value='{"status":"invalid"}'::jsonb
    from reply_observations where name='byte order mark reply hide'
  )
  and (select count(*)=0 from public.customer_review_reply_hides),
  'a reply hide reason made only of whitespace and byte order marks is invalid and stores nothing'
);
rollback to savepoint customer_review_reply_byte_order_mark_hide;
set local role authenticated;
insert into reply_observations
select 'first reply hide',public.hide_customer_review_reply(
  (select review_id from reply_fixture),'  Reply breaches the review rules  '
);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003802',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003802","role":"authenticated","aal":"aal2"}',true);
insert into reply_observations
select 'second reply hide',public.hide_customer_review_reply(
  (select review_id from reply_fixture),'Replacement reply reason'
);
reset role;
select ok(
  (
    select value->>'status'='hidden'
      and (select array_agg(key order by key) from jsonb_object_keys(value) key)
        =array[
          'administratorUserId','affectedBookingRequestReference',
          'affectedPublicSlug','hiddenAt','reason','reviewId','status'
        ]
      and value->>'reviewId'=(select review_id::text from reply_fixture)
      and value->>'administratorUserId'='10000000-0000-4000-8000-000000003801'
      and value->>'reason'='Reply breaches the review rules'
      and value->>'affectedPublicSlug'='cottage-deadbeefdeadbeefdeadbeefdead1001'
      and value->>'affectedBookingRequestReference'='RC-REQ-0000000000001001'
    from reply_observations where name='first reply hide'
  )
  and (
    select value->>'status'='already-hidden'
      and (select array_agg(key order by key) from jsonb_object_keys(value) key)
        =array['administratorUserId','hiddenAt','reason','reviewId','status']
      and value->>'administratorUserId'='10000000-0000-4000-8000-000000003801'
      and value->>'reason'='Reply breaches the review rules'
    from reply_observations where name='second reply hide'
  )
  and (
    select count(*)=1
      and bool_and(
        hides.review_id=(select review_id from reply_fixture)
        and hides.administrator_user_id='10000000-0000-4000-8000-000000003801'
        and hides.reason='Reply breaches the review rules'
      )
    from public.customer_review_reply_hides hides
  ),
  'the first reply hide is retained with its administrator and reason'
);

select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
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
      and value#>'{items,0,ownerReply}'='null'::jsonb
      and value#>>'{items,0,originalBody}'='A peaceful stay with a lovely garden.'
    from result
  ),
  'a hidden reply leaves visitors the review without the reply'
);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select ok(
  (
    with owner_view as (
      select public.get_owner_customer_review('RC-REQ-0000000000001001') value
    )
    select value->>'status'='reviewed'
      and (
        select array_agg(key order by key)
        from jsonb_object_keys(value->'reply') key
      )=array['moderationState','originalBody','originalLanguage','submittedAt']
      and value#>>'{reply,moderationState}'='hidden'
      and value#>>'{reply,originalBody}'='Thank you for staying with us.'
    from owner_view
  ),
  'the owner sees their hidden reply marked hidden without the reason'
);
reset role;

create temp table review_submitted_day as
select (reviews.submitted_at at time zone 'Asia/Baghdad')::date value
from public.customer_reviews reviews;
grant select on review_submitted_day to authenticated;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003801',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003801","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select ok(
  (
    with result as (
      select public.list_administrator_customer_reviews(null,null,50) value
    )
    select value->>'status'='success'
      and jsonb_array_length(value->'items')=1
      and value#>>'{items,0,moderationState}'='unhidden'
      and (
        select array_agg(key order by key)
        from jsonb_object_keys(value#>'{items,0,reply}') key
      )=array[
        'authorUserId','hide','moderationState',
        'originalBody','originalLanguage','submittedAt'
      ]
      and value#>>'{items,0,reply,authorUserId}'='10000000-0000-4000-8000-000000001001'
      and value#>>'{items,0,reply,originalBody}'='Thank you for staying with us.'
      and value#>>'{items,0,reply,moderationState}'='hidden'
      and (
        select array_agg(key order by key)
        from jsonb_object_keys(value#>'{items,0,reply,hide}') key
      )=array['administratorUserId','hiddenAt','reason']
      and value#>>'{items,0,reply,hide,administratorUserId}'='10000000-0000-4000-8000-000000003801'
      and value#>>'{items,0,reply,hide,reason}'='Reply breaches the review rules'
    from result
  ),
  'administrators read the reply, its author and its hide audit'
);
select ok(
  (
    with result as (
      select public.list_administrator_customer_reviews(null,null,50) value
    )
    select (select array_agg(key order by key) from jsonb_object_keys(value) key)
        =array['items','nextCursor','stateCounts','status','total']
      and value->'total'='1'::jsonb
      and value->'stateCounts'='{"unhidden":1,"hidden":0}'::jsonb
    from result
  ),
  'the administrator list counts one visible review in total and by state'
);
select ok(
  (
    with result as (
      select public.list_administrator_customer_reviews(null,null,50,'hidden',null,null) value
    )
    select value->'items'='[]'::jsonb
      and value->'total'='0'::jsonb
      and value->'stateCounts'='{"unhidden":1,"hidden":0}'::jsonb
    from result
  ),
  'the hidden filter lists no visible review while the state counts ignore the state filter'
);
select ok(
  (
    with result as (
      select public.list_administrator_customer_reviews(
        null,null,50,null,
        (select value from review_submitted_day),
        (select value from review_submitted_day)
      ) value
    )
    select jsonb_array_length(value->'items')=1
      and value->'total'='1'::jsonb
      and value->'stateCounts'='{"unhidden":1,"hidden":0}'::jsonb
    from result
  ),
  'a window on the Baghdad day of submission lists the review'
);
select ok(
  (
    with result as (
      select public.list_administrator_customer_reviews(
        null,null,50,null,null,
        (select value-1 from review_submitted_day)
      ) value
    )
    select value->'items'='[]'::jsonb
      and value->'total'='0'::jsonb
    from result
  ),
  'a window ending the Baghdad day before submission lists no review'
);
select ok(
  (
    with result as (
      select public.list_administrator_customer_reviews(
        null,null,50,null,
        (select value+1 from review_submitted_day),
        null
      ) value
    )
    select value->'items'='[]'::jsonb
      and value->'total'='0'::jsonb
      and value->'stateCounts'='{"unhidden":0,"hidden":0}'::jsonb
    from result
  ),
  'a window beginning the Baghdad day after submission lists and counts no review'
);
select throws_ok(
  $$select public.list_administrator_customer_reviews(null,null,50,'replied',null,null)$$,
  '22023',null,'the administrator reader refuses an unknown moderation state'
);
select throws_ok(
  $$select public.list_administrator_customer_reviews(null,null,50,null,'2101-01-02','2101-01-01')$$,
  '22023',null,'the administrator reader refuses a reversed date range'
);
reset role;

select throws_ok(
  $$update public.customer_review_replies set original_body='overwritten'$$,
  'RC409',null,'replies and reply hides cannot be changed or deleted'
);
select throws_ok(
  $$delete from public.customer_review_replies$$,
  'RC409',null,'replies and reply hides cannot be changed or deleted'
);
select throws_ok(
  $$update public.customer_review_reply_hides set reason='overwritten'$$,
  'RC409',null,'replies and reply hides cannot be changed or deleted'
);
select throws_ok(
  $$delete from public.customer_review_reply_hides$$,
  'RC409',null,'replies and reply hides cannot be changed or deleted'
);
rollback to savepoint customer_review_reply;

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

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1"}',
  true
);
set local role authenticated;
select is(
  public.get_customer_review('RC-REQ-0000000000001001'),
  (select value from own_review_expected),
  'the Customer reader returns the immutable original and moderation state for its own review'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2"}',
  true
);
set local role authenticated;
select throws_ok(
  $$select public.list_administrator_customer_reviews(null,null,50)$$,
  '42501',null,'Customer AAL2 cannot list private administrator review facts'
);
select throws_ok(
  $$select public.list_administrator_customer_reviews(null,null,50,'hidden',null,null)$$,
  '42501',null,'Customer AAL2 cannot list filtered administrator review facts'
);
select throws_ok(
  format(
    'select public.hide_customer_review(%L,%L)',
    (select value->>'reviewId' from own_review_expected),'Customer AAL2 attempt'
  ),
  '42501',null,'Customer AAL2 cannot hide a real review'
);
reset role;

update public.account_contexts
set role='cottage_owner',owner_approval_state='approved'
where user_id='10000000-0000-4000-8000-000000001002';
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1"}',
  true
);
set local role authenticated;
select ok(
  public.submit_customer_review(
    'RC-REQ-0000000000001001',5,'en','Safe owner-capable replay'
  )->>'status'='duplicate'
  and public.get_customer_review('RC-REQ-0000000000001001')->>'status'='submitted',
  'an Owner Account retains Customer capability for another Cottage Owners booking'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2"}',
  true
);
set local role authenticated;
select throws_ok(
  $$select public.list_administrator_customer_reviews(null,null,50)$$,
  '42501',null,'Cottage Owner AAL2 cannot list private administrator review facts'
);
select throws_ok(
  $$select public.list_administrator_customer_reviews(null,null,50,'hidden',null,null)$$,
  '42501',null,'Cottage Owner AAL2 cannot list filtered administrator review facts'
);
select throws_ok(
  format(
    'select public.hide_customer_review(%L,%L)',
    (select value->>'reviewId' from own_review_expected),'Cottage Owner AAL2 attempt'
  ),
  '42501',null,'Cottage Owner AAL2 cannot hide a real review'
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
create temp table review_hide_whitespace_observations(name text,value jsonb);
savepoint review_hide_whitespace;
reset role;
select is((select count(*)::integer from public.customer_review_hides),0,
  'whitespace hide starts without a moderation row');
set local role authenticated;
select lives_ok(
  $$insert into review_hide_whitespace_observations(value)
    select public.hide_customer_review(
      ((select value from own_review_expected)->>'reviewId')::uuid,E'\n\t')$$,
  'whitespace hide returns without a constraint exception'
);
reset role;
select ok(
  (select count(*)=1 and bool_and(value->>'status'='invalid')
    from review_hide_whitespace_observations)
  and (select count(*)=0 from public.customer_review_hides),
  'whitespace-only review hide reason is invalid and stores nothing'
);
rollback to savepoint review_hide_whitespace;
reset role;
savepoint review_hide_whitespace_control;
select is((select count(*)::integer from public.customer_review_hides),0,
  'refused hide controls start without a stored row');
set local role authenticated;
select lives_ok(
  $$insert into review_hide_whitespace_observations(name,value)
    select 'invalid hide: NULL',public.hide_customer_review(
      ((select value from own_review_expected)->>'reviewId')::uuid,null)
    union all
    select 'invalid hide: empty',public.hide_customer_review(
      ((select value from own_review_expected)->>'reviewId')::uuid,'')
    union all
    select 'invalid hide: spaces',public.hide_customer_review(
      ((select value from own_review_expected)->>'reviewId')::uuid,'   ')
    union all
    select 'invalid hide: mixed whitespace',public.hide_customer_review(
      ((select value from own_review_expected)->>'reviewId')::uuid,E' \r\n\t ')
    union all
    select 'invalid hide: trimmed 2001 characters',public.hide_customer_review(
      ((select value from own_review_expected)->>'reviewId')::uuid,' ' || repeat('x',2001) || ' ')$$,
  'refused hide controls return without a constraint exception'
);
reset role;
select ok(
  (select count(*)=5 and count(distinct name)=5
    and bool_and(value IS NOT DISTINCT FROM '{"status":"invalid"}'::jsonb)
    from review_hide_whitespace_observations)
  and (select count(*)=0 from public.customer_review_hides),
  'blank and oversized hide controls are invalid and store nothing'
);
rollback to savepoint review_hide_whitespace_control;
savepoint review_hide_whitespace_control;
select is((select count(*)::integer from public.customer_review_hides),0,
  'surrounded nonblank hide control starts without a stored row');
set local role authenticated;
select lives_ok(
  $$insert into review_hide_whitespace_observations(value)
    select public.hide_customer_review(
      ((select value from own_review_expected)->>'reviewId')::uuid,E' \nReason\t ')$$,
  'surrounded nonblank hide control returns without a constraint exception'
);
reset role;
select ok(
  (select count(*)=1 and bool_and(value->>'status'='hidden')
    from review_hide_whitespace_observations)
  and (select count(*)=1 and bool_and(reason=E'\nReason\t')
    from public.customer_review_hides),
  'surrounded nonblank hide reason preserves its admission and storage contract'
);
rollback to savepoint review_hide_whitespace_control;
savepoint review_hide_whitespace_control;
select is((select count(*)::integer from public.customer_review_hides),0,
  'trimmed 2000-character hide control starts without a stored row');
set local role authenticated;
select lives_ok(
  $$insert into review_hide_whitespace_observations(value)
    select public.hide_customer_review(
      ((select value from own_review_expected)->>'reviewId')::uuid,' ' || repeat('x',2000) || ' ')$$,
  'trimmed 2000-character hide control returns without a constraint exception'
);
reset role;
select ok(
  (select count(*)=1 and bool_and(value->>'status'='hidden')
    from review_hide_whitespace_observations)
  and (select count(*)=1 and bool_and(reason=repeat('x',2000))
    from public.customer_review_hides),
  'trimmed 2000-character hide reason preserves its admission and storage contract'
);
rollback to savepoint review_hide_whitespace_control;
savepoint direct_review_hide_whitespace;
select is((select count(*)::integer from public.customer_review_hides),0,
  'direct whitespace hide starts without a moderation row');
select throws_ok(
  $$insert into public.customer_review_hides(review_id,administrator_user_id,reason)
    values (((select value from own_review_expected)->>'reviewId')::uuid,
      '10000000-0000-4000-8000-000000003801',E' \r\n\t ')$$,
  '23514',
  'new row for relation "customer_review_hides" violates check constraint "customer_review_hides_reason_check"',
  'the review hide reason check rejects a direct whitespace-only insert'
);
rollback to savepoint direct_review_hide_whitespace;
savepoint direct_review_hide_control;
select is((select count(*)::integer from public.customer_review_hides),0,
  'direct nonblank hide control starts without a moderation row');
select lives_ok(
  $$insert into public.customer_review_hides(review_id,administrator_user_id,reason)
    values (((select value from own_review_expected)->>'reviewId')::uuid,
      '10000000-0000-4000-8000-000000003801',E' \nReason\t ')$$,
  'the review hide reason check admits a direct nonblank insert'
);
select ok((select count(*)=1 and bool_and(reason=E' \nReason\t ')
  from public.customer_review_hides),'direct nonblank hide reason is preserved');
rollback to savepoint direct_review_hide_control;
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
select ok(
  (
    with result as (
      select public.list_administrator_customer_reviews(null,null,50) value
    )
    select value->'total'='1'::jsonb
      and value->'stateCounts'='{"unhidden":0,"hidden":1}'::jsonb
    from result
  ),
  'the administrator list counts the hidden review as hidden'
);
select ok(
  (
    with result as (
      select public.list_administrator_customer_reviews(null,null,50,'unhidden',null,null) value
    )
    select value->'items'='[]'::jsonb
      and value->'total'='0'::jsonb
      and value->'stateCounts'='{"unhidden":0,"hidden":1}'::jsonb
    from result
  ),
  'the visible filter lists no hidden review'
);
select ok(
  (
    with result as (
      select public.list_administrator_customer_reviews(null,null,50,'hidden',null,null) value
    )
    select jsonb_array_length(value->'items')=1
      and value#>>'{items,0,moderationState}'='hidden'
      and value->'total'='1'::jsonb
    from result
  ),
  'the hidden filter lists the hidden review'
);
reset role;

update public.cottage_marketplace_listings
set state='published'
where profile_id='20000000-0000-4000-8000-000000001001';

savepoint customer_review_guarded_pagination;
select pg_temp.seed_completion_booking(
  ((clock_timestamp() at time zone 'Asia/Baghdad')::date - 6),true,'18','10'
);
select pg_temp.seed_completion_booking(
  ((clock_timestamp() at time zone 'Asia/Baghdad')::date - 9),true,'19','10'
);
set local role service_role;
select public.commit_booking_completion(
  '60000000-0000-4000-8000-000000001801',
  (
    select value->>'revision'
    from public.list_due_booking_completions(50) value
    where value->>'bookingRequestId'='60000000-0000-4000-8000-000000001801'
  )
);
select public.commit_booking_completion(
  '60000000-0000-4000-8000-000000001901',
  (
    select value->>'revision'
    from public.list_due_booking_completions(50) value
    where value->>'bookingRequestId'='60000000-0000-4000-8000-000000001901'
  )
);
reset role;

create temp table guarded_pagination_timestamp as
select clock_timestamp() value;
select ok(
  (
    with sources as (
      select requests.id,requests.profile_id,commitments.access_ranges,
        maturity.effective_period_end,maturity.review_expires_at,
        public.booking_request_payment_status(requests) payment_status,
        public.booking_completion_eligibility_at(
          requests.id,(select value from guarded_pagination_timestamp)
        ) eligibility
      from public.booking_requests requests
      join public.cottage_booking_period_commitments commitments
        on commitments.id=requests.booking_period_commitment_id
      join public.booking_completion_maturity maturity
        on maturity.booking_request_id=requests.id
      where requests.id in (
        '60000000-0000-4000-8000-000000001801',
        '60000000-0000-4000-8000-000000001901'
      )
    )
    select count(*)=2
      and count(distinct profile_id)=1
      and bool_and(payment_status='paid-confirmed')
      and bool_and(eligibility->>'status'='completed')
      and bool_and((eligibility->>'reviewAvailable')::boolean)
      and bool_and((select value from guarded_pagination_timestamp)>=effective_period_end)
      and bool_and((select value from guarded_pagination_timestamp)<review_expires_at)
      and not (
        (select access_ranges from sources where id='60000000-0000-4000-8000-000000001801')
        &&
        (select access_ranges from sources where id='60000000-0000-4000-8000-000000001901')
      )
    from sources
  ),
  'pagination fixtures are distinct guarded periods for one paid completed cottage with a shared eligible timestamp'
);

insert into public.customer_reviews(
  id,booking_request_id,booking_confirmation_id,profile_id,author_user_id,
  rating,original_language,original_body,submitted_at
)
select
  case requests.id
    when '60000000-0000-4000-8000-000000001801'
      then '88000000-0000-4000-8000-000000001801'::uuid
    else '88000000-0000-4000-8000-000000001901'::uuid
  end,
  requests.id,confirmations.id,requests.profile_id,requests.customer_user_id,
  case when requests.id='60000000-0000-4000-8000-000000001801' then 4 else 3 end,
  case when requests.id='60000000-0000-4000-8000-000000001801'
    then 'ar'::public.cottage_profile_source_language
    else 'ckb'::public.cottage_profile_source_language
  end,
  case when requests.id='60000000-0000-4000-8000-000000001801'
    then 'مراجعة عربية آمنة'
    else 'پێداچوونەوەیەکی پارێزراو'
  end,
  (select value from guarded_pagination_timestamp)
from public.booking_requests requests
join public.booking_confirmations confirmations
  on confirmations.booking_request_id=requests.id
where requests.id in (
  '60000000-0000-4000-8000-000000001801',
  '60000000-0000-4000-8000-000000001901'
);

select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role anon;
select ok(
  (
    with first_page as (
      select public.list_public_customer_reviews(
        'cottage-deadbeefdeadbeefdeadbeefdead1001',null,null,1
      ) value
    ), second_page as (
      select public.list_public_customer_reviews(
        'cottage-deadbeefdeadbeefdeadbeefdead1001',
        (value#>>'{nextCursor,submittedAt}')::timestamptz,
        (value#>>'{nextCursor,reviewId}')::uuid,
        1
      ) value
      from first_page
    ), observed as (
      select 1 ordinal,value#>>'{items,0,reviewId}' review_id from first_page
      union all
      select 2,value#>>'{items,0,reviewId}' from second_page
    )
    select count(*)=2
      and count(distinct review_id)=2
      and array_agg(review_id order by ordinal)=array[
        '88000000-0000-4000-8000-000000001901',
        '88000000-0000-4000-8000-000000001801'
      ]
      and (select value->'nextCursor' from second_page)='null'::jsonb
    from observed
  ),
  'equal-timestamp public cursor pages use the id tie-break without skips and end with a null cursor'
);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003801',true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000003801","role":"authenticated","aal":"aal2"}',
  true
);
set local role authenticated;
select ok(
  (
    with first_page as (
      select public.list_administrator_customer_reviews(null,null,1) value
    ), second_page as (
      select public.list_administrator_customer_reviews(
        (value#>>'{nextCursor,submittedAt}')::timestamptz,
        (value#>>'{nextCursor,reviewId}')::uuid,1
      ) value
      from first_page
    ), third_page as (
      select public.list_administrator_customer_reviews(
        (value#>>'{nextCursor,submittedAt}')::timestamptz,
        (value#>>'{nextCursor,reviewId}')::uuid,1
      ) value
      from second_page
    ), observed as (
      select 1 ordinal,value#>>'{items,0,reviewId}' review_id from first_page
      union all
      select 2,value#>>'{items,0,reviewId}' from second_page
      union all
      select 3,value#>>'{items,0,reviewId}' from third_page
    )
    select count(*)=3
      and count(distinct review_id)=3
      and array_agg(review_id order by ordinal)=array[
        '88000000-0000-4000-8000-000000001901',
        '88000000-0000-4000-8000-000000001801',
        (select value->>'reviewId' from own_review_expected)
      ]
      and (select value->'nextCursor' from third_page)='null'::jsonb
    from observed
  ),
  'equal-timestamp administrator cursor pages use the id tie-break without skips and end with a null cursor'
);
select ok(
  (
    with first_page as (
      select public.list_administrator_customer_reviews(null,null,1) value
    ), second_page as (
      select public.list_administrator_customer_reviews(
        (value#>>'{nextCursor,submittedAt}')::timestamptz,
        (value#>>'{nextCursor,reviewId}')::uuid,1
      ) value
      from first_page
    ), third_page as (
      select public.list_administrator_customer_reviews(
        (value#>>'{nextCursor,submittedAt}')::timestamptz,
        (value#>>'{nextCursor,reviewId}')::uuid,1
      ) value
      from second_page
    ), observed as (
      select value from first_page
      union all
      select value from second_page
      union all
      select value from third_page
    )
    select count(*)=3
      and bool_and(value->'total'='3'::jsonb)
      and bool_and(value->'stateCounts'='{"unhidden":2,"hidden":1}'::jsonb)
    from observed
  ),
  'every administrator cursor page reports the same total and state counts for three reviews'
);
reset role;
rollback to savepoint customer_review_guarded_pagination;

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
  and (select count(*)=2 from pg_constraint where contype='p' and conname in (
    'customer_review_replies_pkey',
    'customer_review_reply_hides_pkey'
  ))
  and (select count(*)=10 from pg_constraint where contype='f' and conname in (
    'customer_reviews_booking_request_id_fkey',
    'customer_reviews_booking_confirmation_id_fkey',
    'customer_reviews_profile_id_fkey',
    'customer_reviews_author_user_id_fkey',
    'customer_review_hides_review_id_fkey',
    'customer_review_hides_administrator_user_id_fkey',
    'customer_review_replies_review_id_fkey',
    'customer_review_replies_author_user_id_fkey',
    'customer_review_reply_hides_review_id_fkey',
    'customer_review_reply_hides_administrator_user_id_fkey'
  ))
  and (select indexdef like '%(profile_id, submitted_at DESC, id DESC)'
    from pg_indexes where indexname='customer_reviews_profile_cursor_idx')
  and (select indexdef like '%(submitted_at DESC, id DESC)'
    from pg_indexes where indexname='customer_reviews_administrator_cursor_idx'),
  'review keys and both deterministic cursor indexes are present'
);

select * from finish();
rollback;
