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
-- END PAYMENT EVIDENCE FIXTURE
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
values ('60000000-0000-4000-8000-000000001001','RC-REQ-0000000000001001','10000000-0000-4000-8000-000000001002','10000000-0000-4000-8000-000000001001','20000000-0000-4000-8000-000000001001','40000000-0000-4000-8000-000000001001','50000000-0000-4000-8000-000000001001','73000000-0000-4000-8000-000000001001','Fictional Customer',4,'pending',statement_timestamp()+interval '4 hours',statement_timestamp(),null);
insert into public.booking_request_submission_attempts
(id,customer_user_id,idempotency_key,payment_lifecycle_id,profile_id,locale,public_slug,requested_search,quote_fingerprint,quote_payload,intent_fingerprint,intent_payload,payment_snapshot,authorization_provider,authorization_environment,authorization_merchant_id,authorization_terminal_id,authorization_provider_request_id,authorization_provider_reference,authorization_movement_reference,state,booking_request_id)
values ('70000000-0000-4000-8000-000000001001','10000000-0000-4000-8000-000000001002','71000000-0000-4000-8000-000000001001','73000000-0000-4000-8000-000000001001','20000000-0000-4000-8000-000000001001','en','confirmation-cottage','{}'::jsonb,repeat('a',64),
'{"cottageName":"Preserved Cottage","bookingPriceIqd":110000,"serviceFeeIqd":5000,"customerTotalIqd":115000,"items":[{"serviceDay":"2101-01-01","kind":"shift","position":1,"startsAt":"2101-01-01T08:00:00+03:00"},{"serviceDay":"2101-01-01","kind":"shift","position":3},{"serviceDay":"2101-01-02","kind":"full_day_bundle"}]}'::jsonb,
repeat('b',64),'{"customerName":"Fictional Customer","partySize":4}'::jsonb,
jsonb_build_object('paymentLifecycleId','73000000-0000-4000-8000-000000001001','currency','IQD','bookingPriceFils',110000000,'bookingServiceFeeFils',5000000,'customerTotalFils',115000000,
'authorization',jsonb_build_object('paymentLifecycleId','73000000-0000-4000-8000-000000001001','kind','authorization','logicalOperationId','73000000-0000-4000-8000-000000001001:authorization','attemptId','73000000-0000-4000-8000-000000001001:authorization:attempt-1','status','succeeded','amountFils',115000000,'providerRequestId','confirmation-auth-request-1','providerReference','confirmation-auth-reference-1','movementReference','confirmation-auth-movement-1','reconciliationRequired',false,'retrySafe',false),
'capture',null,'release',null,'refunds','[]'::jsonb,
'financials',jsonb_build_object('refundedBookingPriceFils',0,'refundedBookingServiceFeeFils',0,'remainingBookingPriceFils',110000000,'remainingBookingServiceFeeFils',5000000,'marketplaceCommissionFils',11000000,'ownerEntitlementFils',99000000),
'payout',jsonb_build_object('status','not_eligible','eligibleFils',99000000,'paidFils',0,'providerFeeFils',0,'providerReserveFils',0,'recoveryExposureFils',0,'recoveryBalanceFils',0,'automaticOwnerDebitFils',0,'paidWhileBlocked',false,'settlement',null),
'holds',jsonb_build_object('administrator',false,'dispute',false),'dispute',null,'audits','[]'::jsonb,
'movements',jsonb_build_array(jsonb_build_object('kind','authorization','logicalOperationId','73000000-0000-4000-8000-000000001001:authorization','attemptId','73000000-0000-4000-8000-000000001001:authorization:attempt-1','amountFils',115000000,'movementReference','confirmation-auth-movement-1','recordedAt','2026-01-01T12:00:00.000Z'))),
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
insert into public.owner_request_notifications(booking_request_id,owner_user_id) values('60000000-0000-4000-8000-000000001001','10000000-0000-4000-8000-000000001001');

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

create function pg_temp.request_payload(target_event uuid) returns jsonb language sql as $$
 select jsonb_build_object('kind',e.event_kind,'title','Request status','body','Open your authenticated request for current status.','bookingReference',null,'bookingRequestReference',q.booking_request_reference,'deadlineAt',e.deadline_at,'detailsPath','/'||e.notice_locale||'/'||case e.recipient_role when 'customer' then 'booking-requests/' else 'owner/booking-requests/' end||q.booking_request_reference,'linkLabel','View Booking Request','fictional',true)
 from public.booking_notification_events e join public.booking_requests q on q.id=e.booking_request_id where e.id=target_event;
$$;
create function pg_temp.prepare_request_notice(kind text,role_name text) returns jsonb language plpgsql as $$
declare event public.booking_notification_events; declare payload jsonb; declare result jsonb; declare prior_role text:=current_setting('role');
begin
 select * into strict event from public.booking_notification_events e where e.booking_request_id='60000000-0000-4000-8000-000000001001' and e.event_kind=kind and e.recipient_role=role_name order by e.recovery_generation desc nulls last limit 1;
 payload:=pg_temp.request_payload(event.id);
 perform set_config('role','service_role',true);
 perform public.ensure_booking_confirmation_notification_work(null,event.notice_locale::text,'booking-event-v1',payload,event.id);
 result:=public.lease_booking_confirmation_notification_work(null,event.id);
 perform set_config('role',prior_role,true);
 return result;
end $$;
create function pg_temp.request_notice_call(action text,lease jsonb,effect_id uuid default null) returns jsonb language plpgsql as $$
declare prior_role text:=current_setting('role'); declare result jsonb;
begin
 perform set_config('role','service_role',true);
 result:=pg_temp.notice_call(action,lease,effect_id);
 perform set_config('role',prior_role,true);
 return result;
end $$;
select no_plan();
select is((select count(*)::integer from public.booking_notification_events where booking_request_id='60000000-0000-4000-8000-000000001001' and event_kind='request_new'),1,'committed new request creates one durable owner delivery intent');
select is((select count(*) from public.booking_receipts),0::bigint,'request notice has no fabricated paid receipt');
select is((select notice_locale::text from public.booking_notification_events where event_kind='request_new'),'en','selected snapshot language is recorded');
select public.ensure_booking_request_notification_events('60000000-0000-4000-8000-000000001001');
select is((select count(*) from public.booking_notification_events),1::bigint,'repeated source materialization retains one identity');
select throws_ok($$insert into public.booking_notification_events(booking_request_id,owner_request_notification_id,event_kind,recipient_user_id,recipient_role,notice_locale,deadline_at,created_at) select booking_request_id,owner_request_notification_id,event_kind,'10000000-0000-4000-8000-000000001003',recipient_role,notice_locale,deadline_at,created_at from public.booking_notification_events$$,'RC409','Request notification source is invalid','source recipient cannot be forged');
create temp table new_request_lease as select pg_temp.prepare_request_notice('request_new','cottage_owner') lease;
select is((select lease->'receiptId' from new_request_lease),'null'::jsonb,'prepared binding explicitly has no receipt');
select is((select lease->'bookingReference' from new_request_lease),'null'::jsonb,'prepared binding has no paid booking reference');
select is((select lease->>'logicalId' from new_request_lease),'booking-event:'||(select lease#>>'{event,id}' from new_request_lease),'request event has a durable logical identity');
select is((select count(*) from public.fictional_booking_confirmation_notification_effects),0::bigint,'intent and leasing are not delivery');
select is((select count(*) from public.booking_confirmation_notification_attempts),0::bigint,'attempts are separate from intent and work');
select is(pg_temp.request_notice_call('query',(select lease from new_request_lease))->>'status','not-found','query proves effect absence before execute');
select is((select count(*) from public.booking_confirmation_notification_attempts),1::bigint,'query attempt is persisted');
select throws_ok(format('set local role service_role; select public.ensure_booking_confirmation_notification_work(null,%L,%L,%L::jsonb,%L::uuid)','ar','booking-event-v1',(select lease->'payload' from new_request_lease),(select lease#>>'{event,id}' from new_request_lease)), 'RC409','Notification binding is immutable','prepared language cannot change');
reset role;
select throws_ok(format('set local role service_role; select public.ensure_booking_confirmation_notification_work(null,%L,%L,%L::jsonb,%L::uuid)','en','booking-event-v1',(select (lease->'payload')||'{"phone":"private"}' from new_request_lease),(select lease#>>'{event,id}' from new_request_lease)), 'RC409','Notification binding is immutable','prepared payload cannot acquire private data');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select is(jsonb_array_length(public.list_booking_request_notification_status('RC-REQ-0000000000001001','customer')),0,'customer does not see owner-only new request delivery');
select throws_ok($$select public.list_booking_request_notification_status('RC-REQ-0000000000001001','cottage_owner')$$,'42501','Request notification status unavailable','customer cannot use owner delivery projection');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
set local role authenticated;
select is(public.list_booking_request_notification_status('RC-REQ-0000000000001001','cottage_owner')#>>'{0,state}','processing','owner sees current delivery outcome independently of request');
select throws_ok($$select public.ensure_booking_request_notification_events('60000000-0000-4000-8000-000000001001')$$,'42501',null,'authenticated user cannot materialize private source facts');
reset role;
savepoint historical_effect;
create temp table new_effect as select pg_temp.request_notice_call('execute',(select lease from new_request_lease)) effect;
select is((select effect->>'status' from new_effect),'delivered','fictional effect execution is recorded');
select public.claim_booking_request_action('10000000-0000-4000-8000-000000001001','60000000-0000-4000-8000-000000001001','accept');
select is(pg_temp.request_notice_call('complete',(select lease from new_request_lease),(select (effect->>'effectId')::uuid from new_effect))->>'historical','true','executed effect completes as historical after request state changes');
select is((select count(*) from public.fictional_booking_confirmation_notification_effects),1::bigint,'historical completion never creates another effect');
rollback to historical_effect;
savepoint revocation;
update public.account_contexts set owner_approval_state='suspended' where user_id='10000000-0000-4000-8000-000000001001';
select is(pg_temp.request_notice_call('execute',(select lease from new_request_lease))->>'status','suppressed','owner approval revoked before execute prevents effect');
select is((select count(*) from public.fictional_booking_confirmation_notification_effects),0::bigint,'revoked notice leaves no effect');
rollback to revocation;
savepoint failure;
select is(pg_temp.request_notice_call('failed',(select lease from new_request_lease))->>'status','retryable','failure is durable separately from request');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
set local role authenticated;
select is(public.list_booking_request_notification_status('RC-REQ-0000000000001001','cottage_owner')#>>'{0,retryAllowed}','true','currently eligible owner can retry a failed notice');
select is(public.retry_booking_confirmation_notification(null,(public.list_booking_request_notification_status('RC-REQ-0000000000001001','cottage_owner')#>>'{0,eventId}')::uuid)->>'status','queued','authorized retry queues same request identity');
reset role;
rollback to failure;
select public.claim_booking_request_action('10000000-0000-4000-8000-000000001001','60000000-0000-4000-8000-000000001001','accept');
select is((select count(*) from public.booking_notification_events where event_kind='request_accepted'),2::bigint,'real acceptance creates customer and owner intents');
select is(pg_temp.request_notice_call('execute',(select lease from new_request_lease))->>'status','suppressed','stale new-request intent without effect is suppressed');
create temp table accepted_lease as select pg_temp.prepare_request_notice('request_accepted','customer') lease;
select ok(public.booking_notification_is_deliverable(w),'accepted notice is eligible only during capture processing') from public.booking_confirmation_notification_work w where event_id=(select (lease#>>'{event,id}')::uuid from accepted_lease);
set local role service_role;
create temp table failed_capture_lease as select public.lease_booking_request_capture_work('60000000-0000-4000-8000-000000001001','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}') result;
create temp table failed_capture as select pg_temp.capture_execute((select result->'permit' from failed_capture_lease),'failed') result;
select public.record_booking_request_capture_failure('60000000-0000-4000-8000-000000001001',(select (result#>>'{permit,leaseGeneration}')::bigint from failed_capture_lease),(select (result#>>'{permit,leaseToken}')::uuid from failed_capture_lease),(select result from failed_capture));
reset role;
select is((select count(*) from public.booking_notification_events where event_kind='request_payment_required'),1::bigint,'committed payment-required fact creates only a customer intent');
select is(pg_temp.request_notice_call('execute',(select lease from accepted_lease))->>'status','suppressed','payment-required supersedes accepted wording');
create temp table payment_required_lease as select pg_temp.prepare_request_notice('request_payment_required','customer') lease;
select ok(public.booking_notification_is_deliverable(w),'payment required notice is eligible before recovery') from public.booking_confirmation_notification_work w where event_id=(select (lease#>>'{event,id}')::uuid from payment_required_lease);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
create temp table recovery_admission as select public.claim_customer_booking_request_payment_recovery('60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000002281','simulated-replacement') result;
reset role;
grant select on recovery_admission to service_role;
select is((select count(*) from public.booking_notification_events where event_kind='recovery_processing'),1::bigint,'committed recovery admission creates one customer processing notice');
select is(pg_temp.request_notice_call('execute',(select lease from payment_required_lease))->>'status','suppressed','processing recovery supersedes payment-required action');
create temp table recovery_lease as select pg_temp.prepare_request_notice('recovery_processing','customer') lease;
select ok(public.booking_notification_is_deliverable(w),'latest recovery generation is current') from public.booking_confirmation_notification_work w where event_id=(select (lease#>>'{event,id}')::uuid from recovery_lease);
savepoint attention;
select public.quarantine_booking_request_payment('60000000-0000-4000-8000-000000001001','malformed-provider-observation');
reset role;
select is((select count(*) from public.booking_notification_events where event_kind='recovery_attention'),1::bigint,'committed quarantine of actual recovery creates generic attention notice');
create temp table attention_lease as select pg_temp.prepare_request_notice('recovery_attention','customer') lease;
select is(pg_temp.request_notice_call('execute',(select lease from attention_lease))->>'status','delivered','current recovery quarantine attention can be delivered without private diagnostic');
select is(pg_temp.request_notice_call('execute',(select lease from recovery_lease))->>'status','suppressed','quarantine supersedes processing notice');
rollback to attention;
set local role service_role;
select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from recovery_admission),'original-release','admitted')->'permit','succeeded','original_released');
select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from recovery_admission),'replacement-authorization','original_released')->'permit','failed','safely_failed');
reset role;
select is((select count(*) from public.booking_notification_events where event_kind='recovery_retryable'),1::bigint,'safe recovery failure creates a separate retryable notice');
select is(pg_temp.request_notice_call('execute',(select lease from recovery_lease))->>'status','suppressed','safely failed recovery supersedes processing');
create temp table retryable_lease as select pg_temp.prepare_request_notice('recovery_retryable','customer') lease;
select ok(public.booking_notification_is_deliverable(w),'retryable notice current for same failed generation and open window') from public.booking_confirmation_notification_work w where event_id=(select (lease#>>'{event,id}')::uuid from retryable_lease);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
select public.claim_customer_booking_request_payment_recovery('60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000002282','simulated-replacement');
reset role;
select is(pg_temp.request_notice_call('execute',(select lease from retryable_lease))->>'status','suppressed','new generation supersedes earlier recovery retry notice');
select is((select count(*) from public.booking_notification_events where event_kind='recovery_processing'),2::bigint,'each real recovery generation has one durable processing identity');
select ok(not public.booking_notification_is_deliverable(w),'previous processing generation stays superseded when a newer generation is also processing') from public.booking_confirmation_notification_work w where event_id=(select (lease#>>'{event,id}')::uuid from recovery_lease);
select is((select count(*) from public.booking_receipts),0::bigint,'failure recovery processing and intent still create no paid receipts');
select is((select amount_fils from public.booking_request_capture_work where booking_request_id='60000000-0000-4000-8000-000000001001'),115000000::bigint,'delivery never changes captured amount binding');
select is((select count(*) from public.booking_requests where status='accepted'),1::bigint,'notification suppression never changes valid request');
-- A real recovery-confirmed then cancelled booking mixes request and receipt events.
create temp table latest_recovery as select id from public.booking_request_payment_recovery_attempts where booking_request_id='60000000-0000-4000-8000-000000001001' order by generation desc limit 1;
grant select on latest_recovery to service_role;
set local role service_role;
select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step((select id from latest_recovery),'replacement-authorization','original_released')->'permit','succeeded','replacement_authorized');
select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step((select id from latest_recovery),'replacement-capture','replacement_authorized')->'permit','succeeded','succeeded');
select public.finalize_booking_request_confirmation('60000000-0000-4000-8000-000000001001',public.get_booking_request_payment_recovery_confirmation_evidence((select id from latest_recovery)));
reset role;
select is((select count(*) from public.booking_receipts),2::bigint,'only authoritative paid confirmation creates the two real receipts');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
set local role authenticated;
select public.commit_booking_cancellation('60000000-0000-4000-8000-000000001001','90000000-0000-4000-8000-000000002288','cottage_owner','Unavailable',null,jsonb_build_object('revision',public.get_booking_cancellation_facts('60000000-0000-4000-8000-000000001001','cottage_owner')->>'revision','refundObligation','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb));
reset role;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('10000000-0000-4000-8000-000000003801','authenticated','authenticated','notification-admin@example.test',now());
insert into public.account_contexts(user_id,role) values('10000000-0000-4000-8000-000000003801','platform_administrator');
create temp table mixed_financial_views(actor_role text,view jsonb);
grant select,insert on mixed_financial_views to authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true);
set local role authenticated;
insert into mixed_financial_views values('customer',public.get_booking_financial_view('RC-REQ-0000000000001001','customer'));
select ok(jsonb_array_length(public.list_booking_request_notification_status('RC-REQ-0000000000001001','customer'))>=4,'paid customer still sees authorized request delivery history separately');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
set local role authenticated;
insert into mixed_financial_views values('cottage_owner',public.get_booking_financial_view('RC-REQ-0000000000001001','cottage_owner'));
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003801',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003801","aal":"aal2"}',true);
set local role authenticated;
insert into mixed_financial_views values('platform_administrator',public.get_booking_financial_view('RC-REQ-0000000000001001','platform_administrator'));
select throws_ok($$select public.list_booking_request_notification_status('RC-REQ-0000000000001001','customer')$$,'42501','Request notification status unavailable','administrator has no recipient impersonation projection');
reset role;
select ok(not exists(select 1 from mixed_financial_views v,jsonb_array_elements(v.view->'notifications') n where n->>'kind' not in ('cancelled','refund_requested','refund_returned','refund_attention','preparation_reminder') or n->>'receiptId' is null),'legacy financial projection excludes every receiptless request kind for all three actors');
select ok(not exists(select 1 from mixed_financial_views v,jsonb_array_elements(v.view->'notifications') n where v.actor_role<>'platform_administrator' and n->>'recipientRole'<>v.actor_role),'financial actor filter remains recipient-specific');
select ok(not exists(select 1 from mixed_financial_views v where v.view->'captured'<>'{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb or v.view->'cancellation'='null'::jsonb),'mixed history preserves exact captured amounts and cancellation');
select is((select count(*) from mixed_financial_views),3::bigint,'customer owner and administrator financial views all remain readable');
select * from finish();
rollback;
