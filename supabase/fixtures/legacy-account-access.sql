-- Frozen fictional pre-214 records. Hand-authored expectations are in the upgrade observer.
-- Replica mode builds the historical paid projection without replaying provider effects; no live contacts.
set session_replication_role = replica;
insert into auth.users (id, aud, role, phone, phone_confirmed_at) values
  ('10000000-0000-4000-8000-000000002141', 'authenticated', 'authenticated', '9647500002141', now()),
  ('10000000-0000-4000-8000-000000002142', 'authenticated', 'authenticated', '9647500002142', now()),
  ('10000000-0000-4000-8000-000000002143', 'authenticated', 'authenticated', '+9647500002143', now());
insert into public.account_contexts (user_id, role, owner_approval_state) values
  ('10000000-0000-4000-8000-000000002141', 'cottage_owner', 'approved'),
  ('10000000-0000-4000-8000-000000002142', 'customer', null),
  ('10000000-0000-4000-8000-000000002143', 'cottage_owner', 'prospective');
insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  exact_latitude, exact_longitude, private_directions, capacity, bedrooms,
  bathrooms, amenities, source_language, description, house_rules, status
) values (
  '20000000-0000-4000-8000-000000002141',
  '10000000-0000-4000-8000-000000002141',
  'Changed current Cottage name', 'Baghdad', 'Karrada', 'Current private address',
  33.315241, 44.366067, 'Current private directions', 8, 3, 2,
  array['garden'], 'en', 'Current description', 'Changed current rules', 'draft'
);
insert into public.booking_snapshots (
  id, customer_user_id, profile_id, quote_fingerprint, intent_fingerprint,
  quote_payload, intent_payload, booking_terms_version, booking_terms_locale,
  booking_terms_body, booking_terms_sha256, cancellation_policy_version,
  acceptance_locale, acceptance_evidence, acceptance_evidence_fingerprint,
  marketplace_commission_rate_basis_points, marketplace_commission_amount_fils,
  created_at
) values (
  '40000000-0000-4000-8000-000000002141',
  '10000000-0000-4000-8000-000000002142',
  '20000000-0000-4000-8000-000000002141', repeat('a', 64), repeat('b', 64),
  '{"cottageName":"Preserved Cottage name","houseRules":"Preserved House Rules","bookingPriceIqd":110000,"serviceFeeIqd":5000,"customerTotalIqd":115000,"items":[{"serviceDay":"2101-01-01","displayName":"Morning","startsAt":"2101-01-01T08:00:00+03:00","endsAt":"2101-01-01T12:00:00+03:00","crossesMidnight":false,"priceIqd":110000,"kind":"shift","position":1}]}'::jsonb,
  '{"customerName":"Fictional Customer","partySize":4}'::jsonb,
  'confirmation-access-v1', 'en', 'Fictional terms', repeat('c', 64),
  'fictional-cancellation-v1', 'en', '{}'::jsonb, repeat('d', 64),
  1000, 11000000, '2100-12-31 12:00+00'
);
insert into public.cottage_booking_period_commitments (
  id, customer_user_id, profile_id, schedule_revision_id, commitment_reference,
  status, access_ranges, created_at
) values (
  '50000000-0000-4000-8000-000000002141',
  '10000000-0000-4000-8000-000000002142',
  '20000000-0000-4000-8000-000000002141',
  '30000000-0000-4000-8000-000000002141', 'ACCOUNT-UPGRADE-CONFIRMED-214',
  'confirmed_booking', '{["2101-01-01 05:00+00","2101-01-01 09:00+00")}'::tstzmultirange,
  '2100-12-31 12:00+00'
);
insert into public.booking_requests (
  id, booking_request_reference, customer_user_id, owner_user_id, profile_id,
  booking_snapshot_id, booking_period_commitment_id, payment_lifecycle_id,
  customer_name, party_size, status, response_deadline, created_at, settled_at
) values (
  '60000000-0000-4000-8000-000000002141', 'RC-REQ-0000000000002141',
  '10000000-0000-4000-8000-000000002142',
  '10000000-0000-4000-8000-000000002141',
  '20000000-0000-4000-8000-000000002141',
  '40000000-0000-4000-8000-000000002141',
  '50000000-0000-4000-8000-000000002141',
  '73000000-0000-4000-8000-000000002141', 'Fictional Customer', 4,
  'accepted', '2100-12-31 16:00+00', '2100-12-31 12:00+00', '2100-12-31 13:00+00'
);
insert into public.booking_request_capture_work (
  booking_request_id, attempt_id, authorization_claim_id,
  authorization_claim_generation, payment_lifecycle_id,
  authorization_logical_operation_id, authorization_physical_attempt_id,
  capture_logical_operation_id, capture_physical_attempt_id, amount_fils,
  currency, provider, environment, merchant_id, terminal_id,
  provider_idempotency_key, request_fingerprint, state, lease_generation,
  outcome, completed_at
) values (
  '60000000-0000-4000-8000-000000002141',
  '70000000-0000-4000-8000-000000002141',
  '72000000-0000-4000-8000-000000002141', 1,
  '73000000-0000-4000-8000-000000002141',
  '73000000-0000-4000-8000-000000002141:authorization',
  '73000000-0000-4000-8000-000000002141:authorization:attempt-1',
  '73000000-0000-4000-8000-000000002141:capture',
  '73000000-0000-4000-8000-000000002141:capture:attempt-2',
  115000000, 'IQD', 'fictional-payments', 'local-test', 'fictional-merchant',
  'fictional-terminal', 'booking-request-capture:35', repeat('e', 64),
  'complete', 1, 'succeeded', '2100-12-31 13:00+00'
);
insert into public.booking_confirmations (
  id, booking_request_id, booking_snapshot_id, booking_period_commitment_id,
  capture_operation_id, confirmed_at
) values (
  '80000000-0000-4000-8000-000000002141',
  '60000000-0000-4000-8000-000000002141',
  '40000000-0000-4000-8000-000000002141',
  '50000000-0000-4000-8000-000000002141',
  '81000000-0000-4000-8000-000000002141', '2100-12-31 13:00+00'
);
insert into public.booking_receipts (
  id, booking_confirmation_id, booking_snapshot_id, recipient_role,
  recipient_user_id, created_at
) values
  ('82000000-0000-4000-8000-000000002141', '80000000-0000-4000-8000-000000002141', '40000000-0000-4000-8000-000000002141', 'cottage_owner', '10000000-0000-4000-8000-000000002141', '2100-12-31 13:00+00'),
  ('82000000-0000-4000-8000-000000002142', '80000000-0000-4000-8000-000000002141', '40000000-0000-4000-8000-000000002141', 'customer', '10000000-0000-4000-8000-000000002142', '2100-12-31 13:00+00');
insert into auth.users(id,aud,role,phone,phone_confirmed_at,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000002144','authenticated','authenticated','9647500002144',now(),null,null),
 ('10000000-0000-4000-8000-000000002145','authenticated','authenticated',null,null,'account-upgrade-admin@example.invalid',now());
insert into public.account_contexts(user_id,role,owner_approval_state) values
 ('10000000-0000-4000-8000-000000002144','cottage_owner','suspended'),
 ('10000000-0000-4000-8000-000000002145','platform_administrator',null);
insert into public.booking_snapshots select (jsonb_populate_record(null::public.booking_snapshots, to_jsonb(s) || '{"id":"40000000-0000-4000-8000-000000002142","quote_fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","intent_fingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'::jsonb)).* from public.booking_snapshots s where id='40000000-0000-4000-8000-000000002141';
insert into public.cottage_booking_period_commitments select (jsonb_populate_record(null::public.cottage_booking_period_commitments, to_jsonb(c) || '{"id":"50000000-0000-4000-8000-000000002142","commitment_reference":"ACCOUNT-UPGRADE-PENDING-214","status":"pending_hold","access_ranges":"{[\"2101-01-02 05:00+00\",\"2101-01-02 09:00+00\")}"}'::jsonb)).* from public.cottage_booking_period_commitments c where id='50000000-0000-4000-8000-000000002141';
insert into public.booking_requests select (jsonb_populate_record(null::public.booking_requests, to_jsonb(q) || '{"id":"60000000-0000-4000-8000-000000002142","booking_request_reference":"RC-REQ-0000000000002142","booking_snapshot_id":"40000000-0000-4000-8000-000000002142","booking_period_commitment_id":"50000000-0000-4000-8000-000000002142","payment_lifecycle_id":"73000000-0000-4000-8000-000000002142","status":"pending","settled_at":null}'::jsonb)).* from public.booking_requests q where id='60000000-0000-4000-8000-000000002141';
insert into public.cottage_shift_schedule_revisions(id,profile_id,revision,full_day_bundle_id) values
 ('30000000-0000-4000-8000-000000002141','20000000-0000-4000-8000-000000002141',1,'31000000-0000-4000-8000-000000002141');
insert into public.cottage_shifts(id,schedule_revision_id,position,name,start_time,end_time) values
 ('32000000-0000-4000-8000-000000002141','30000000-0000-4000-8000-000000002141',1,'Morning','08:00','12:00'),
 ('32000000-0000-4000-8000-000000002142','30000000-0000-4000-8000-000000002141',2,'Evening','14:00','18:00');
insert into public.cottage_inventory_commitments(id,unit_kind,unit_id,service_day,committed_price_iqd,booking_period_commitment_id) values
 ('51000000-0000-4000-8000-000000002141','shift','32000000-0000-4000-8000-000000002141','2101-01-01',110000,'50000000-0000-4000-8000-000000002141'),
 ('51000000-0000-4000-8000-000000002142','shift','32000000-0000-4000-8000-000000002141','2101-01-02',110000,'50000000-0000-4000-8000-000000002142');
insert into public.cottage_booking_period_occupancies(booking_period_commitment_id,schedule_revision_id,shift_id,service_day) values
 ('50000000-0000-4000-8000-000000002141','30000000-0000-4000-8000-000000002141','32000000-0000-4000-8000-000000002141','2101-01-01'),
 ('50000000-0000-4000-8000-000000002142','30000000-0000-4000-8000-000000002141','32000000-0000-4000-8000-000000002141','2101-01-02');
insert into public.booking_request_submission_attempts(id,customer_user_id,idempotency_key,payment_lifecycle_id,profile_id,locale,public_slug,requested_search,quote_fingerprint,quote_payload,intent_fingerprint,intent_payload,state,booking_request_id)
select ('70000000-0000-4000-8000-00000000214'||right(q.id::text,1))::uuid,q.customer_user_id,
 ('71000000-0000-4000-8000-00000000214'||right(q.id::text,1))::uuid,q.payment_lifecycle_id,q.profile_id,'en','account-upgrade-cottage','{}',s.quote_fingerprint,s.quote_payload,s.intent_fingerprint,s.intent_payload,'finalized',q.id
from public.booking_requests q join public.booking_snapshots s on s.id=q.booking_snapshot_id where q.id in ('60000000-0000-4000-8000-000000002141','60000000-0000-4000-8000-000000002142');
insert into public.booking_request_authorization_claims(id,attempt_id,state,customer_user_id,profile_id,schedule_revision_id,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,provider,environment,merchant_id,terminal_id,provider_idempotency_key,quote_fingerprint,intent_fingerprint,access_ranges,not_after,reconciliation_expires_at)
select ('72000000-0000-4000-8000-00000000214'||right(a.id::text,1))::uuid,a.id,'converted',a.customer_user_id,a.profile_id,'30000000-0000-4000-8000-000000002141',a.payment_lifecycle_id,a.payment_lifecycle_id||':authorization',a.payment_lifecycle_id||':authorization:attempt-1',115000000,'IQD','fictional-payments','local-test','fictional-merchant','fictional-terminal','account-upgrade-authorization-'||a.id,a.quote_fingerprint,a.intent_fingerprint,c.access_ranges,'2101-01-01 04:00+00','2101-01-01 03:59+00'
from public.booking_request_submission_attempts a join public.booking_requests q on q.id=a.booking_request_id join public.cottage_booking_period_commitments c on c.id=q.booking_period_commitment_id where a.id in ('70000000-0000-4000-8000-000000002141','70000000-0000-4000-8000-000000002142');
insert into public.booking_request_authorization_claim_items(claim_id,unit_kind,unit_id,service_day,price_iqd) values
 ('72000000-0000-4000-8000-000000002141','shift','32000000-0000-4000-8000-000000002141','2101-01-01',110000),
 ('72000000-0000-4000-8000-000000002142','shift','32000000-0000-4000-8000-000000002141','2101-01-02',110000);
insert into public.booking_request_authorization_claim_occupancies(claim_id,schedule_revision_id,shift_id,service_day,active) values
 ('72000000-0000-4000-8000-000000002141','30000000-0000-4000-8000-000000002141','32000000-0000-4000-8000-000000002141','2101-01-01',false),
 ('72000000-0000-4000-8000-000000002142','30000000-0000-4000-8000-000000002141','32000000-0000-4000-8000-000000002141','2101-01-02',false);
insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,original_outcome,current_outcome,provider_request_id,provider_reference,movement_reference,capture_execution_permit,admission,recorded_at,evidence_provenance)
select '81000000-0000-4000-8000-000000002141',authorization_claim_id,authorization_claim_generation,'capture',provider,environment,merchant_id,terminal_id,provider_idempotency_key,request_fingerprint,payment_lifecycle_id,capture_logical_operation_id,capture_physical_attempt_id,amount_fils,currency,'succeeded','succeeded','account-upgrade-provider-request','account-upgrade-provider-reference','account-upgrade-capture-movement',
 jsonb_build_object('purpose','booking-request-capture','bookingRequestId',booking_request_id,'submissionAttemptId',attempt_id,'authorizationClaimId',authorization_claim_id,'authorizationClaimGeneration',authorization_claim_generation,'paymentLifecycleId',payment_lifecycle_id,'authorizationLogicalOperationId',authorization_logical_operation_id,'authorizationPhysicalAttemptId',authorization_physical_attempt_id,'captureLogicalOperationId',capture_logical_operation_id,'capturePhysicalAttemptId',capture_physical_attempt_id,'amountFils',amount_fils,'currency',currency,'providerIdentity',jsonb_build_object('provider',provider,'environment',environment,'merchantId',merchant_id,'terminalId',terminal_id),'idempotencyKey',provider_idempotency_key,'requestFingerprint',request_fingerprint,'workId',booking_request_id,'leaseGeneration',1,'leaseToken','91000000-0000-4000-8000-000000002141','notAfter','2100-12-31T14:00:00Z'),
 '{"purpose":"booking-request-capture","permit":{},"notBefore":"2100-12-31T12:00:00Z","notAfter":"2100-12-31T14:00:00Z"}', '2100-12-31 13:00+00','legacy-simulated'
from public.booking_request_capture_work where booking_request_id='60000000-0000-4000-8000-000000002141';
insert into public.payment_provider_observations(id,operation_id,provider,environment,merchant_id,terminal_id,event_id,result,occurred_at,provenance) values
 ('83000000-0000-4000-8000-000000002141','81000000-0000-4000-8000-000000002141','fictional-payments','local-test','fictional-merchant','fictional-terminal','account-upgrade-capture-event','{"outcome":"succeeded","movementReference":"account-upgrade-capture-movement"}','2100-12-31 13:00+00','legacy-simulated');

set session_replication_role = origin;
