begin;
-- BEGIN PAYMENT EVIDENCE FIXTURE
create or replace function pg_temp.payment_fixture_result(admission jsonb, outcome text, target_command jsonb default null) returns jsonb language plpgsql as $$
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
  if recorder in ('record_booking_request_payment_recovery_observation','record_booking_request_payment_required_expiry_observation') then
    if target_command is null then raise exception 'Fixture must name observation consequences'; end if;
    execute format('select public.%I($1,$2,$3)',recorder) into observed using operation_id::uuid,observed,
      target_command||jsonb_build_object('revision',public.get_booking_request_payment_observation_facts(operation_id::uuid)->>'revision');
  else execute format('select public.%I($1,$2)',recorder) into observed using operation_id::uuid,observed; end if;
  return observed-'evidence';
end;
$$;
create or replace function pg_temp.payment_fixture_execute(routine text,permit jsonb,outcome text,target_command jsonb default null) returns jsonb language plpgsql as $$
declare prior_role text:=current_setting('role'); declare admission jsonb; declare result jsonb;
begin
  if prior_role='none' then perform set_config('role','service_role',true); end if;
  execute format('select public.%I($1)',routine) into admission using permit;
  result:=pg_temp.payment_fixture_result(admission,outcome,target_command);
  perform set_config('role',prior_role,true);
  return result;
end;
$$;
create or replace function pg_temp.capture_execute(permit jsonb,outcome text default 'succeeded') returns jsonb language sql as $$
  select pg_temp.payment_fixture_execute('admit_booking_request_capture',permit,outcome);
$$;
create or replace function pg_temp.recovery_execute(permit jsonb,outcome text,target_state text,target_quarantine text default null,target_capture uuid default null) returns jsonb language sql as $$
  select pg_temp.payment_fixture_execute('admit_booking_request_payment_recovery',permit,outcome,jsonb_build_object('recoveryState',target_state,'quarantineReason',target_quarantine,'correctiveCaptureId',target_capture));
$$;
create or replace function pg_temp.expiry_execute(permit jsonb,outcome text,target_quarantine text default null) returns jsonb language sql as $$
  select pg_temp.payment_fixture_execute('admit_booking_request_payment_required_expiry',permit,outcome,jsonb_build_object('recoveryState',null,'quarantineReason',target_quarantine,'correctiveCaptureId',null));
$$;
create or replace function pg_temp.payment_query(operation jsonb,request_id text,reference text,outcome text,target_command jsonb default null) returns jsonb language plpgsql as $$
declare prior_role text:=current_setting('role'); declare result jsonb;
begin
  if prior_role='none' then perform set_config('role','service_role',true); end if;
  result:=pg_temp.payment_fixture_result(public.reload_booking_request_payment_operation(operation-array['permitPurpose','claimId','claimGeneration','notAfter','idempotencyKey','cleanupAttemptId','workId','leaseGeneration','leaseToken','stateRevision','operationId','operationGeneration'],request_id,reference),outcome,target_command);
  perform set_config('role',prior_role,true);
  return result;
end;
$$;
create or replace function pg_temp.permit_query(permit jsonb,request_id text,reference text,outcome text,target_state text default null,target_quarantine text default null,target_capture uuid default null) returns jsonb language sql as $$
  select pg_temp.payment_query(jsonb_build_object('providerIdentity',permit#>'{binding,providerIdentity}',
    'requestFingerprint',permit#>'{binding,requestFingerprint}','paymentLifecycleId',coalesce(permit#>'{binding,paymentLifecycleId}',permit#>'{binding,authorizationPaymentLifecycleId}'),
    'logicalOperationId',coalesce(permit#>'{binding,logicalOperationId}',permit#>'{binding,releaseLogicalOperationId}',permit#>'{binding,refundLogicalOperationId}'),'physicalAttemptId',coalesce(permit#>'{binding,physicalAttemptId}',permit#>'{binding,releasePhysicalAttemptId}',permit#>'{binding,refundPhysicalAttemptId}'),
    'operationKind',case permit->>'step' when 'replacement-authorization' then 'authorization' when 'replacement-capture' then 'capture'
      else case when permit->>'purpose'='booking-request-payment-required-corrective-refund' then 'refund' else 'release' end end,
    'amountFils',permit#>'{binding,amountFils}','currency',permit#>'{binding,currency}'),request_id,reference,outcome,jsonb_build_object('recoveryState',target_state,'quarantineReason',target_quarantine,'correctiveCaptureId',target_capture));
$$;
create or replace function pg_temp.expiry_prepare(request_id uuid,identity jsonb,command jsonb) returns jsonb language plpgsql as $$
declare result jsonb; declare target jsonb; declare prior_role text:=current_setting('role');
begin
  if prior_role='none' then perform set_config('role','service_role',true); end if;
  result:=public.prepare_booking_request_payment_required_expiry(request_id,identity,command||jsonb_build_object('revision',public.get_booking_request_payment_facts(request_id)->>'revision'));
  if result->>'status'='prepared' then
    select owned into target from jsonb_array_elements(public.get_booking_request_payment_facts(request_id)->'expiryOperations') owned
      where (command->>'action'='release' and owned->>'authorizationLifecycleId'=command->>'authorizationLifecycleId')
        or (command->>'action'='refund' and owned->>'captureId'=command->>'captureId');
    result:=jsonb_build_object('status',command->>'action','permit',target->'permit','binding',target#>'{permit,binding}');
  end if;
  perform set_config('role',prior_role,true);
  return result;
end;
$$;
create or replace function pg_temp.correction_observe(request_id uuid,operation_id uuid,receipt jsonb,target_state text,target_quarantine text,target_capture uuid default null) returns jsonb language sql as $$
  select public.observe_booking_request_payment_correction(request_id,operation_id,receipt,jsonb_build_object('revision',public.get_booking_request_payment_observation_facts(operation_id)->>'revision',
    'recoveryState',target_state,'quarantineReason',target_quarantine,'correctiveCaptureId',target_capture));
$$;
-- END PAYMENT EVIDENCE FIXTURE

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
create temp table confirmation_capture_result as select pg_temp.capture_execute((select result->'permit' from confirmation_capture_lease),'failed') result;
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

select no_plan();
-- BEGIN UNOBSERVED RECOVERY FIXTURE
-- A provider has completed a leased operation, but its response has not reached
-- the recovery recorder. No indeterminate response or quarantine has occurred.
create function pg_temp.seed_unobserved_payment_outcome(permit jsonb, outcome text, occurred_at timestamptz, first_outcome text default 'indeterminate')
returns jsonb language plpgsql as $$
declare admission jsonb;
declare observed jsonb;
declare binding jsonb := permit->'binding';
declare prior_role text:=current_setting('role');
begin
  if prior_role='none' then perform set_config('role','service_role',true); end if;
  admission:=case when permit->>'purpose'='booking-request-payment-recovery' then public.admit_booking_request_payment_recovery(permit) else public.admit_booking_request_payment_required_expiry(permit) end;
  observed:=public.persist_simulated_payment_effect(admission-array['purpose','binding','mode'],
    jsonb_build_object('outcome',first_outcome,'providerRequestId','inflight-request-'||(admission->>'operationId'),
      'providerReference','inflight-reference-'||(admission->>'operationId'),
      'evidence',jsonb_build_object('operationId',admission->>'operationId','eventId','inflight-'||(admission->>'operationId'),
        'provenance','fictional-provider','originalOutcome',first_outcome,'executedAt',clock_timestamp(),'occurredAt',case when first_outcome<>'indeterminate' then clock_timestamp() end,'closedAt',null))
      ||case when first_outcome='failed' then jsonb_build_object('retrySafe',false) else jsonb_build_object('movementReference','inflight-movement-'||(admission->>'operationId')) end);
  perform set_config('role',prior_role,true);
  return jsonb_build_object('receiptId','inflight-receipt-'||(admission->>'operationId'),'bookingRequestId',binding->>'bookingRequestId',
    'providerOperationId',admission->>'operationId','providerIdentity',admission->'providerIdentity','paymentLifecycleId',admission#>>'{binding,paymentLifecycleId}',
    'logicalOperationId',admission#>>'{binding,logicalOperationId}','physicalAttemptId',admission#>>'{binding,attemptId}','kind',admission#>>'{binding,kind}',
    'amountFils',binding->'amountFils','currency',binding->>'currency','providerRequestId',observed->>'providerRequestId',
    'providerReference',observed->>'providerReference','movementReference',case when outcome<>'failed' then observed->>'movementReference' end,
    'outcome',outcome,'occurredAt',occurred_at,'evidence',jsonb_set(observed->'evidence','{occurredAt}',coalesce(to_jsonb(occurred_at),'null'::jsonb)));
end;
$$;
-- END UNOBSERVED RECOVERY FIXTURE
create table public.payment_correction_test_clock(instant timestamptz not null);
insert into public.payment_correction_test_clock select payment_required_deadline-interval '1 millisecond' from public.booking_request_capture_work;
create function public.payment_correction_now() returns timestamptz language sql volatile security definer set search_path='' as $$ select instant from public.payment_correction_test_clock $$;
select replace(pg_get_functiondef(procedures.oid),'clock_timestamp()','public.payment_correction_now()')
from pg_proc procedures join pg_namespace namespaces on namespaces.oid=procedures.pronamespace
where namespaces.nspname='public' and procedures.prokind='f' and procedures.prosrc like '%clock_timestamp()%'
  and (procedures.proname like '%booking_request%' or procedures.proname in ('persist_simulated_payment_effect','seal_simulated_payment_absence','resolve_simulated_payment_effect','validate_payment_provider_observation','accept_payment_provider_observation','simulated_payment_absence_receipt')) \gexec
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
create temp table correction_attempt as select public.claim_customer_booking_request_payment_recovery(
 '60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000001001','simulated-replacement') result;
reset role;
grant select on correction_attempt to service_role;
set local role service_role;
select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from correction_attempt),'original-release','admitted')->'permit','succeeded','original_released');
select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from correction_attempt),'replacement-authorization','original_released')->'permit','succeeded','replacement_authorized');
create temp table correction_capture_permit as select public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from correction_attempt),'replacement-capture','replacement_authorized')->'permit' permit;
reset role;
savepoint before_capture;
create temp table correction_capture_result as select pg_temp.seed_unobserved_payment_outcome((select permit from correction_capture_permit),'succeeded',(select payment_required_deadline from public.booking_request_capture_work)) result;
update public.payment_correction_test_clock set instant=(select payment_required_deadline from public.booking_request_capture_work);
select is((select current_outcome from public.payment_provider_operations where id=(select (result->>'providerOperationId')::uuid from correction_capture_result)),null::text,'unreceived correction evidence leaves the shared admission pending');
grant select on correction_capture_result to service_role;
savepoint malformed_nested_occurrence;
set local role service_role;
select lives_ok($sql$select pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',
 (select (result->>'providerOperationId')::uuid from correction_capture_result),
 (select jsonb_set(result,'{evidence,occurredAt}','"malformed-provider-time"') from correction_capture_result),null,'conflicting-provider-observation')$sql$,
 'malformed nested provider occurrence follows correction audit and quarantine');
reset role;
select is((select count(*) from public.booking_request_payment_correction_observations where conflict),1::bigint,'malformed nested occurrence is retained as conflicting evidence');
select is((select current_outcome from public.payment_provider_operations where id=(select (result->>'providerOperationId')::uuid from correction_capture_result)),null::text,'malformed occurrence leaves shared admission unrecorded');
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','malformed occurrence quarantines the payment case');
rollback to malformed_nested_occurrence;
-- A failed durable follow-up write rolls back accepted evidence and every consequence.
savepoint interrupted_correction;
create temp table interrupted_graph as select jsonb_build_object(
 'ledger',(select jsonb_agg(to_jsonb(v) order by id) from public.payment_provider_operations v),
 'operations',(select jsonb_agg(to_jsonb(v) order by id) from public.booking_request_payment_recovery_operations v),
 'attempts',(select jsonb_agg(to_jsonb(v) order by id) from public.booking_request_payment_recovery_attempts v),
 'history',(select jsonb_agg(to_jsonb(v) order by sequence) from public.booking_request_payment_history v)) graph;
create function pg_temp.reject_refund_ownership() returns trigger language plpgsql as $$ begin raise exception 'Injected refund ownership failure'; end $$;
create trigger reject_test_refund_ownership before insert on public.booking_request_payment_required_expiry_operations for each row execute function pg_temp.reject_refund_ownership();
set local role service_role;
select throws_ok($sql$select pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',
 (select (result->>'providerOperationId')::uuid from correction_capture_result),(select result from correction_capture_result),
 'late_succeeded',null,(select (result->>'providerOperationId')::uuid from correction_capture_result))$sql$,
 'P0001','Injected refund ownership failure','refund ownership failure aborts the entire passive observation transaction');
reset role;
select is(jsonb_build_object(
 'ledger',(select jsonb_agg(to_jsonb(v) order by id) from public.payment_provider_operations v),
 'operations',(select jsonb_agg(to_jsonb(v) order by id) from public.booking_request_payment_recovery_operations v),
 'attempts',(select jsonb_agg(to_jsonb(v) order by id) from public.booking_request_payment_recovery_attempts v),
 'history',(select jsonb_agg(to_jsonb(v) order by sequence) from public.booking_request_payment_history v)),
 (select graph from interrupted_graph),'interrupted correction preserves canonical facts, association, state and history byte for byte');
select is((select count(*) from public.booking_request_payment_correction_observations),0::bigint,'interrupted correction commits no receipt');
select is((select count(*) from public.booking_request_payment_required_expiry_work),0::bigint,'interrupted correction commits no expiry ownership work');
select is((select count(*) from public.booking_request_confirmation_invalidations),0::bigint,'interrupted correction commits no invalidation');
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'interrupted correction retains every selected occupancy');
rollback to interrupted_correction;
set local role service_role;
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',
 (select (result->>'providerOperationId')::uuid from correction_capture_result),(select result from correction_capture_result),'late_succeeded',null,(select (result->>'providerOperationId')::uuid from correction_capture_result))->>'status','recorded','a first delayed provider receipt records its admitted operation');
select pg_temp.expiry_prepare('60000000-0000-4000-8000-000000001001','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}',jsonb_build_object('action','release','authorizationLifecycleId','73000000-0000-4000-8000-000000001001','recoveryOperationId',(select entry->>'recoveryOperationId' from jsonb_array_elements(public.get_booking_request_payment_facts('60000000-0000-4000-8000-000000001001')->'operations') entry where entry->>'recoveryStep'='original-release')));
create temp table correction_prepared as select pg_temp.expiry_prepare('60000000-0000-4000-8000-000000001001',
 '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}',jsonb_build_object('action','refund','captureId',(select result->>'providerOperationId' from correction_capture_result))) result;
select is((select result->>'status' from correction_prepared),'refund','capture at the fixed deadline creates a full corrective refund');
select is((select result#>>'{permit,binding,amountFils}' from correction_prepared),'115000000','corrective refund includes booking price and the entire service fee');
reset role;
select is((select count(*) from public.booking_confirmations),0::bigint,'a late capture cannot confirm');
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'every selected Cottage Shift remains held before corrective refund proof');
savepoint late_capture;
set local role service_role;
select pg_temp.expiry_execute((select result->'permit' from correction_prepared),'succeeded');
select is(public.finalize_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001')->>'status','expired','exact refund and release of the uncaptured original authorization safely expire');
reset role;
select is((select count(*) from public.payment_provider_operations where operation_kind='refund'),1::bigint,'one refund physical effect');
select is((select count(*) from public.payment_provider_operations where operation_kind='release'),1::bigint,'captured replacement authorization is consumed, never released after capture');
select is((select count(*) from public.cottage_booking_period_occupancies where active),0::bigint,'safe correction releases the full occupancy set');
-- Late contradictory evidence after release changes money presentation, never inventory ownership.
create temp table released_request as select to_jsonb(requests) snapshot from public.booking_requests requests;
create temp table released_occupancies as select jsonb_agg(to_jsonb(occupancies) order by shift_id,service_day) snapshot from public.cottage_booking_period_occupancies occupancies;
create temp table contradictory_refund_receipt as select ledger.id,jsonb_build_object(
  'receiptId','contradictory-refund','bookingRequestId','60000000-0000-4000-8000-000000001001','providerOperationId',ledger.id,
  'providerIdentity',jsonb_build_object('provider',ledger.provider,'environment',ledger.environment,'merchantId',ledger.merchant_id,'terminalId',ledger.terminal_id),
  'paymentLifecycleId',ledger.payment_lifecycle_id,'logicalOperationId',ledger.logical_operation_id,'physicalAttemptId',ledger.physical_attempt_id,
  'kind','refund','amountFils',115000000,'currency','IQD','providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
  'movementReference',null,'outcome','failed','occurredAt',ledger.authoritative_outcome_at) payload
from public.payment_provider_operations ledger where ledger.operation_kind='refund';
grant select on contradictory_refund_receipt to service_role;
set local role service_role;
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',(select id from contradictory_refund_receipt),(select payload from contradictory_refund_receipt),null,'conflicting-provider-observation')->>'status','quarantined','contradictory evidence after safe expiry enters durable review');
reset role;
select is((select to_jsonb(requests) from public.booking_requests requests),(select snapshot from released_request),'late evidence does not rewrite the historical expired request');
select is((select jsonb_agg(to_jsonb(occupancies) order by shift_id,service_day) from public.cottage_booking_period_occupancies occupancies),(select snapshot from released_occupancies),'late evidence never reactivates released occupancies');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')#>>'{paymentRequiredExpiry,status}','quarantined-released','released request exposes review without claiming inventory remains held');
reset role;
rollback to late_capture;
create temp table passive_refund_receipt as
select (payload->>'providerOperationId')::uuid id,payload from (
  select pg_temp.seed_unobserved_payment_outcome((select result->'permit' from correction_prepared),
    'failed',public.payment_correction_now(),'failed') payload
) observation;
grant select on passive_refund_receipt to service_role;
savepoint refund_query_unreceived;
set local role service_role;
select is(pg_temp.permit_query((select result->'permit' from correction_prepared),null,null,'failed',null,'expiry-refund-failed')->>'outcome','failed','refund query preserves the provider failure');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','refund query failure quarantines before finalization');
rollback to refund_query_unreceived;

set local role service_role;
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',(select id from passive_refund_receipt),(select payload from passive_refund_receipt),null,'failed-refund-observation')->>'status','quarantined','passive failed refund from failed provider state quarantines before any expiry preparation');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','passive failed refund is durably quarantined');
select is((select current_outcome from public.payment_provider_operations where id=(select id from passive_refund_receipt)),'failed','failed refund provider fact is retained');
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'passive failed refund retains all selected shifts');
rollback to late_capture;
create temp table passive_refund_receipt as
select (payload->>'providerOperationId')::uuid id,payload from (
  select pg_temp.seed_unobserved_payment_outcome((select result->'permit' from correction_prepared),
    'failed',public.payment_correction_now(),'indeterminate') payload
) observation;
grant select on passive_refund_receipt to service_role;
savepoint refund_query_unreceived;
set local role service_role;
select is(pg_temp.permit_query((select result->'permit' from correction_prepared),null,null,'failed',null,'expiry-refund-failed')->>'outcome','failed','refund query preserves the provider failure');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','refund query failure quarantines before finalization');
rollback to refund_query_unreceived;
set local role service_role;
select is(pg_temp.permit_query((select result->'permit' from correction_prepared),null,null,'indeterminate',null,'expiry-refund-indeterminate')->>'outcome','indeterminate','refund query preserves unresolved provider money');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','unchanged unresolved refund query quarantines immediately');
rollback to refund_query_unreceived;

set local role service_role;
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',(select id from passive_refund_receipt),(select payload from passive_refund_receipt),null,'failed-refund-observation')->>'status','quarantined','passive failed refund from indeterminate provider state quarantines before any expiry preparation');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','passive failed refund is durably quarantined');
select is((select current_outcome from public.payment_provider_operations where id=(select id from passive_refund_receipt)),'failed','failed refund provider fact is retained');
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'passive failed refund retains all selected shifts');
rollback to late_capture;
set local role service_role;
select pg_temp.expiry_execute((select result->'permit' from correction_prepared),'indeterminate','expiry-refund-indeterminate');
select is(public.finalize_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001001')->>'status','quarantined','uncertain refund quarantines permanently');
select is(pg_temp.expiry_prepare('60000000-0000-4000-8000-000000001001',
 '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}',jsonb_build_object('action','refund','captureId',(select result->>'providerOperationId' from correction_capture_result)))->>'status','quarantined','scheduled retry cannot restart quarantine');
select is(pg_temp.expiry_execute((select result->'permit' from correction_prepared),'succeeded')->>'outcome','not-executed','stale refund execution is fenced');
select is(pg_temp.permit_query((select permit from correction_capture_permit),
 (select result->>'providerRequestId' from correction_capture_result),(select result->>'providerReference' from correction_capture_result),'succeeded',null,null)->>'outcome','not-executed','stale recovery query is fenced');
select is(public.claim_due_booking_request_payment_required_expiries(20,
 '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'),'[]'::jsonb,'quarantine is omitted from scheduled expiry selection');
reset role;
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'quarantine retains every selected Cottage Shift');
select throws_ok($sql$update public.booking_request_payment_required_expiry_work set state='processing',diagnostic_reason=null$sql$,'RC204',null,'quarantine cannot be reset');
select throws_ok($sql$update public.booking_request_payment_required_expiry_work set state=state$sql$,'RC204',null,'even a no-op update cannot rewrite the first quarantine occurrence');
rollback to before_capture;
set local role service_role;
select pg_temp.recovery_execute((select permit from correction_capture_permit),'succeeded','succeeded');
select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',
  public.get_booking_request_payment_recovery_confirmation_evidence((select (result->>'attemptId')::uuid from correction_attempt)));
reset role;
create temp table immutable_confirmation as select to_jsonb(confirmations) snapshot from public.booking_confirmations confirmations;
create temp table immutable_receipts as select jsonb_agg(to_jsonb(receipts) order by receipts.id) snapshot from public.booking_receipts receipts;
create temp table observed_capture as select ledger.id,(select payment_required_deadline from public.booking_request_capture_work) deadline,jsonb_build_object(
  'receiptId','provider-receipt-1','bookingRequestId','60000000-0000-4000-8000-000000001001','providerOperationId',ledger.id,
  'providerIdentity',jsonb_build_object('provider',ledger.provider,'environment',ledger.environment,'merchantId',ledger.merchant_id,'terminalId',ledger.terminal_id),
  'paymentLifecycleId',ledger.payment_lifecycle_id,'logicalOperationId',ledger.logical_operation_id,'physicalAttemptId',ledger.physical_attempt_id,
  'kind','capture','amountFils',115000000,'currency','IQD','providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
  'movementReference',ledger.movement_reference,'outcome','succeeded','occurredAt',to_char(ledger.authoritative_outcome_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) payload
from public.payment_provider_operations ledger where ledger.operation_kind='capture' and ledger.recovery_attempt_id is not null;
grant select on observed_capture to service_role;
update public.payment_correction_test_clock set instant=(select payment_required_deadline+interval '1 second' from public.booking_request_capture_work);
set local role service_role;
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',(select id from observed_capture),(select payload from observed_capture),null,null)->>'status','recorded','authoritative D minus 1ms occurrence remains coherent when received after D');
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',(select id from observed_capture),(select payload from observed_capture),null,null)->>'status','duplicate','identical receipt is idempotent');
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',(select id from observed_capture),(select payload||'{"receiptId":"provider-receipt-2"}' from observed_capture),null,null)->>'status','recorded','new receipt identity for identical facts is coherent');
reset role;
select is((select count(*) from public.booking_request_payment_correction_observations),2::bigint,'duplicate receipt does not create a second observation or rewrite receipt time');
select is((select status::text from public.cottage_booking_period_commitments),'confirmed_booking','coherent on-time capture retains its active confirmation');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->>'paymentStatus','paid-confirmed','later receipt time does not replace authoritative occurrence time');
reset role;
set local role service_role;
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',(select id from observed_capture),
 (select payload||jsonb_build_object('occurredAt',deadline) from observed_capture),null,'conflicting-provider-observation')->>'status','quarantined','changed receipt with late occurrence quarantines historical confirmation');
reset role;
select is((select to_jsonb(confirmations) from public.booking_confirmations confirmations),(select snapshot from immutable_confirmation),'historical confirmation is preserved byte for byte');
select is((select jsonb_agg(to_jsonb(receipts) order by receipts.id) from public.booking_receipts receipts),(select snapshot from immutable_receipts),'historical receipts remain immutable');
select is((select count(*) from public.booking_request_confirmation_invalidations),1::bigint,'one append-only invalidation removes active confirmation');
select is((select status::text from public.cottage_booking_period_commitments),'pending_hold','invalidated booking is an unconfirmed hold');
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'invalidation retains every selected shift');
select is((select count(*) from public.booking_request_payment_correction_observations where conflict),1::bigint,'changed receipt is preserved as conflict');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')->>'paymentStatus','payment-required','Customer active projection is unconfirmed despite immutable confirmation history');
select is(public.get_customer_booking_request('RC-REQ-0000000000001001')#>>'{paymentRequiredExpiry,status}','quarantined','Customer sees review-required state');
select is(public.claim_customer_booking_request_payment_recovery('60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000001001','simulated-replacement')->>'status','quarantined','Customer cannot replay a previous admitted recovery command');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001003',true);
set local role authenticated;
select throws_ok($sql$select public.claim_customer_booking_request_payment_recovery('60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000001001','simulated-replacement')$sql$,'RC404',null,'quarantine fence does not reveal another Customer request');
reset role;
set local role service_role;
select is(public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001','{}')->>'status','quarantined','historical confirmation cannot replay through quarantine');
reset role;

rollback to before_capture;
create temp table delayed_observation as select (payload->>'providerOperationId')::uuid id,payload from (
  select pg_temp.seed_unobserved_payment_outcome((select permit from correction_capture_permit),'succeeded',
    (select payment_required_deadline-interval '1 millisecond' from public.booking_request_capture_work)) payload
) observation;
select is((select count(*) from public.booking_request_payment_required_expiry_work),0::bigint,'the in-flight success has never entered quarantine');
select is((select state from public.booking_request_payment_recovery_attempts),'replacement_authorized','the successful provider response is not yet recorded by recovery');
grant select on delayed_observation to service_role;
update public.payment_correction_test_clock set instant=(select payment_required_deadline+interval '1 second' from public.booking_request_capture_work);
savepoint unresolved_observation;
set local role service_role;
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',(select id from delayed_observation),(select payload from delayed_observation),'succeeded',null)->>'status','recorded','delayed authoritative success records a previously unobserved capture with C before D');
select lives_ok($sql$select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',public.get_booking_request_payment_recovery_confirmation_evidence((select (result->>'attemptId')::uuid from correction_attempt)))$sql$,'C before D confirms despite receipt after D');
reset role;
select is((select count(*) from public.booking_confirmations),1::bigint,'delayed coherent success produces one confirmation');
select is((select authoritative_outcome_at from public.payment_provider_operations where operation_kind='capture' and recovery_attempt_id is not null),(select payment_required_deadline-interval '1 millisecond' from public.booking_request_capture_work),'provider occurrence is retained independently of database receipt');
rollback to unresolved_observation;
set local role service_role;
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',(select id from delayed_observation),(select payload||'{"outcome":"indeterminate","occurredAt":null}' from delayed_observation),null,'conflicting-provider-observation')->>'status','quarantined','unresolved passive observation enters quarantine in its own transaction');
select is(pg_temp.permit_query((select permit from correction_capture_permit),
  null,null,'succeeded',null,null)->>'outcome','not-executed','unresolved observation immediately fences stale provider reconciliation');
reset role;
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'unresolved observation retains every selected shift');
rollback to before_capture;
set local role service_role;
select pg_temp.recovery_execute((select permit from correction_capture_permit),'failed','capture_failed');
create temp table passive_release_permit as select public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from correction_attempt),'replacement-release','capture_failed')->'permit' permit;
reset role;
create temp table passive_release_receipt as select pg_temp.seed_unobserved_payment_outcome((select permit from passive_release_permit),'failed',(select payment_required_deadline-interval '1 millisecond' from public.booking_request_capture_work),'failed') payload;
update passive_release_receipt set payload=jsonb_set(payload||jsonb_build_object('outcome','failed','movementReference',null,'occurredAt',(select payment_required_deadline-interval '1 millisecond' from public.booking_request_capture_work)),
  '{evidence,occurredAt}',to_jsonb((select payment_required_deadline-interval '1 millisecond' from public.booking_request_capture_work)));
grant select on passive_release_receipt,passive_release_permit to service_role;
savepoint replay_release_unreceived;
set local role service_role;
select is(pg_temp.recovery_execute((select permit from passive_release_permit),'succeeded','blocked','unsafe-recovery-replacement-release-failed')->>'outcome','failed','execution replay preserves the unreceived failed release result');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','execution replay of failed release quarantines');
rollback to replay_release_unreceived;

savepoint failed_release_unreceived;
set local role service_role;
select is(pg_temp.permit_query((select permit from passive_release_permit),null,null,'succeeded','blocked','unsafe-recovery-replacement-release-failed')->>'outcome','failed','query replay preserves an already-failed release outcome');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','query first observation of an already-failed release quarantines immediately');
rollback to failed_release_unreceived;
set local role service_role;
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',(select (payload->>'providerOperationId')::uuid from passive_release_receipt),(select payload from passive_release_receipt),'blocked','failed-release-observation')->>'status','quarantined','passive failed release from failed provider state immediately reports quarantine');
select is(pg_temp.permit_query((select permit from passive_release_permit),null,null,'succeeded',null,null)->>'outcome','not-executed','passive failed release fences stale query');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','passive failed release persists sticky quarantine');
select is((select current_outcome from public.payment_provider_operations where id=(select (payload->>'providerOperationId')::uuid from passive_release_receipt)),'failed','passive failed release retains the authoritative provider outcome');
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'passive failed release retains all selected shifts');
rollback to before_capture;
set local role service_role;
select pg_temp.recovery_execute((select permit from correction_capture_permit),'failed','capture_failed');
create temp table passive_release_permit as select public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from correction_attempt),'replacement-release','capture_failed')->'permit' permit;
reset role;
create temp table passive_release_receipt as select pg_temp.seed_unobserved_payment_outcome((select permit from passive_release_permit),'indeterminate',null) payload;
update passive_release_receipt set payload=jsonb_set(payload||jsonb_build_object('outcome','failed','movementReference',null,'occurredAt',(select payment_required_deadline-interval '1 millisecond' from public.booking_request_capture_work)),
  '{evidence,occurredAt}',to_jsonb((select payment_required_deadline-interval '1 millisecond' from public.booking_request_capture_work)));
grant select on passive_release_receipt,passive_release_permit to service_role;
savepoint replay_release_unreceived;
set local role service_role;
select is(pg_temp.recovery_execute((select permit from passive_release_permit),'indeterminate','blocked','unsafe-recovery-replacement-release-indeterminate')->>'outcome','indeterminate','dispatch records the still unresolved release result');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','execution replay of indeterminate release quarantines');
rollback to replay_release_unreceived;
set local role service_role;
select is(pg_temp.permit_query((select permit from passive_release_permit),null,null,'failed','blocked','unsafe-recovery-replacement-release-failed')->>'outcome','failed','query retains newly resolved release failure');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','query resolving release failure quarantines in the same transaction');
rollback to replay_release_unreceived;

set local role service_role;
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',(select (payload->>'providerOperationId')::uuid from passive_release_receipt),(select payload from passive_release_receipt),'blocked','failed-release-observation')->>'status','quarantined','passive failed release from indeterminate provider state immediately reports quarantine');
select is(pg_temp.permit_query((select permit from passive_release_permit),null,null,'succeeded',null,null)->>'outcome','not-executed','passive failed release fences stale query');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','passive failed release persists sticky quarantine');
select is((select current_outcome from public.payment_provider_operations where id=(select (payload->>'providerOperationId')::uuid from passive_release_receipt)),'failed','passive failed release retains the authoritative provider outcome');
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'passive failed release retains all selected shifts');
rollback to before_capture;
create temp table pending_provider_receipt as select pg_temp.seed_unobserved_payment_outcome((select permit from correction_capture_permit),'indeterminate',null) payload;
grant select on pending_provider_receipt to service_role;
select is((select count(*) from public.booking_request_payment_required_expiry_work),0::bigint,'unreceived provider outcome has not yet entered quarantine');
set local role service_role;
select is(pg_temp.permit_query((select permit from correction_capture_permit),null,null,'indeterminate','blocked','unsafe-recovery-replacement-capture-indeterminate')->>'outcome','indeterminate','query preserves the first unresolved provider outcome');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','query first observation of unresolved provider money quarantines immediately');
select is((select authoritative_outcome_at from public.payment_provider_operations where id=(select (payload->>'providerOperationId')::uuid from pending_provider_receipt)),null::timestamptz,'query cannot manufacture a provider occurrence');
rollback to before_capture;
create temp table pending_provider_receipt as select pg_temp.seed_unobserved_payment_outcome((select permit from correction_capture_permit),'indeterminate',null) payload;
grant select on pending_provider_receipt to service_role;
select is((select count(*) from public.booking_request_payment_required_expiry_work),0::bigint,'unreceived provider outcome has not yet entered quarantine');
set local role service_role;
select is(pg_temp.recovery_execute((select permit from correction_capture_permit),'indeterminate','blocked','unsafe-recovery-replacement-capture-indeterminate')->>'outcome','indeterminate','dispatch records the still unresolved provider outcome');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','execute first observation of unresolved provider money quarantines immediately');
select is((select authoritative_outcome_at from public.payment_provider_operations where id=(select (payload->>'providerOperationId')::uuid from pending_provider_receipt)),null::timestamptz,'execute cannot manufacture a provider occurrence');
rollback to before_capture;
update public.payment_correction_test_clock set instant=(select payment_required_deadline from public.booking_request_capture_work);
set local role service_role;
select pg_temp.expiry_prepare('60000000-0000-4000-8000-000000001001','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}',jsonb_build_object('action','release','authorizationLifecycleId','73000000-0000-4000-8000-000000001001','recoveryOperationId',(select entry->>'recoveryOperationId' from jsonb_array_elements(public.get_booking_request_payment_facts('60000000-0000-4000-8000-000000001001')->'operations') entry where entry->>'recoveryStep'='original-release')));
create temp table correction_prepared as select pg_temp.expiry_prepare('60000000-0000-4000-8000-000000001001','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}',jsonb_build_object('action','release','authorizationLifecycleId',(select result->>'attemptId' from correction_attempt),'recoveryOperationId',null)) result;
reset role;
create temp table passive_release_receipt as
select (payload->>'providerOperationId')::uuid id,payload from (
  select pg_temp.seed_unobserved_payment_outcome((select result->'permit' from correction_prepared),
    'failed',public.payment_correction_now(),'failed') payload
) observation;
grant select on passive_release_receipt to service_role;
savepoint release_query_unreceived;
set local role service_role;
select is(pg_temp.permit_query((select result->'permit' from correction_prepared),null,null,'failed',null,'expiry-release-failed')->>'outcome','failed','release query preserves the provider failure');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','release query failure quarantines before finalization');
rollback to release_query_unreceived;

set local role service_role;
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',(select id from passive_release_receipt),(select payload from passive_release_receipt),null,'failed-release-observation')->>'status','quarantined','passive failed release from failed provider state quarantines before any expiry preparation');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','passive failed release is durably quarantined');
select is((select current_outcome from public.payment_provider_operations where id=(select id from passive_release_receipt)),'failed','failed release provider fact is retained');
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'passive failed release retains all selected shifts');
rollback to before_capture;
update public.payment_correction_test_clock set instant=(select payment_required_deadline from public.booking_request_capture_work);
set local role service_role;
select pg_temp.expiry_prepare('60000000-0000-4000-8000-000000001001','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}',jsonb_build_object('action','release','authorizationLifecycleId','73000000-0000-4000-8000-000000001001','recoveryOperationId',(select entry->>'recoveryOperationId' from jsonb_array_elements(public.get_booking_request_payment_facts('60000000-0000-4000-8000-000000001001')->'operations') entry where entry->>'recoveryStep'='original-release')));
create temp table correction_prepared as select pg_temp.expiry_prepare('60000000-0000-4000-8000-000000001001','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}',jsonb_build_object('action','release','authorizationLifecycleId',(select result->>'attemptId' from correction_attempt),'recoveryOperationId',null)) result;
reset role;
create temp table passive_release_receipt as
select (payload->>'providerOperationId')::uuid id,payload from (
  select pg_temp.seed_unobserved_payment_outcome((select result->'permit' from correction_prepared),
    'failed',public.payment_correction_now(),'indeterminate') payload
) observation;
grant select on passive_release_receipt to service_role;
savepoint release_query_unreceived;
set local role service_role;
select is(pg_temp.permit_query((select result->'permit' from correction_prepared),null,null,'failed',null,'expiry-release-failed')->>'outcome','failed','release query preserves the provider failure');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','release query failure quarantines before finalization');
rollback to release_query_unreceived;
set local role service_role;
select is(pg_temp.permit_query((select result->'permit' from correction_prepared),null,null,'indeterminate',null,'expiry-release-indeterminate')->>'outcome','indeterminate','release query preserves unresolved provider money');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','unchanged unresolved release query quarantines immediately');
rollback to release_query_unreceived;

set local role service_role;
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',(select id from passive_release_receipt),(select payload from passive_release_receipt),null,'failed-release-observation')->>'status','quarantined','passive failed release from indeterminate provider state quarantines before any expiry preparation');
reset role;
select is((select state from public.booking_request_payment_required_expiry_work),'quarantined','passive failed release is durably quarantined');
select is((select current_outcome from public.payment_provider_operations where id=(select id from passive_release_receipt)),'failed','failed release provider fact is retained');
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'passive failed release retains all selected shifts');
rollback to before_capture;
reset role;
update public.payment_correction_test_clock set instant=(select payment_required_deadline+interval '1 second' from public.booking_request_capture_work);
create temp table original_capture_conflict as select ledger.id,jsonb_build_object(
  'receiptId','late-original-success','bookingRequestId','60000000-0000-4000-8000-000000001001','providerOperationId',ledger.id,
  'providerIdentity',jsonb_build_object('provider',ledger.provider,'environment',ledger.environment,'merchantId',ledger.merchant_id,'terminalId',ledger.terminal_id),
  'paymentLifecycleId',ledger.payment_lifecycle_id,'logicalOperationId',ledger.logical_operation_id,'physicalAttemptId',ledger.physical_attempt_id,
  'kind','capture','amountFils',115000000,'currency','IQD','providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
  'movementReference','unexpected-late-original-capture','outcome','succeeded','occurredAt',(select payment_required_deadline from public.booking_request_capture_work)) payload
from public.payment_provider_operations ledger where ledger.operation_kind='capture' and ledger.recovery_attempt_id is null;
grant select on original_capture_conflict to service_role;
set local role service_role;
select is(pg_temp.correction_observe('60000000-0000-4000-8000-000000001001',(select id from original_capture_conflict),(select payload from original_capture_conflict),null,'conflicting-provider-observation')->>'status','quarantined','original definitive failure followed by success is a contradiction, never an automatic refund');
reset role;
select is((select current_outcome from public.payment_provider_operations where id=(select id from original_capture_conflict)),'failed','original definitive failure remains immutable evidence');
select is((select count(*) from public.booking_request_payment_correction_observations where conflict),1::bigint,'contradictory original success is retained alongside the failure');
select is((select count(*) from public.payment_provider_operations where operation_kind='refund'),0::bigint,'contradictory original capture never creates a refund effect');
select is((select count(*) from public.cottage_booking_period_occupancies where active),5::bigint,'original conflict retains every selected shift');
select * from finish();
rollback;
