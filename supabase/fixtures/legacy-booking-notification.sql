-- Frozen paid-confirmation source graph before event notification identity.
set session_replication_role = replica;
insert into auth.users (id, aud, role, phone, phone_confirmed_at) values
  ('10000000-0000-4000-8000-000000003501', 'authenticated', 'authenticated', '+9647500003501', now()),
  ('10000000-0000-4000-8000-000000003502', 'authenticated', 'authenticated', '+9647500003502', now()),
  ('10000000-0000-4000-8000-000000003503', 'authenticated', 'authenticated', '+9647500003503', now());
insert into public.account_contexts (user_id, role, owner_approval_state) values
  ('10000000-0000-4000-8000-000000003501', 'cottage_owner', 'approved'),
  ('10000000-0000-4000-8000-000000003502', 'cottage_owner', 'suspended'),
  ('10000000-0000-4000-8000-000000003503', 'customer', null);
insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  exact_latitude, exact_longitude, private_directions, capacity, bedrooms,
  bathrooms, amenities, source_language, description, house_rules, status
) values (
  '20000000-0000-4000-8000-000000003501',
  '10000000-0000-4000-8000-000000003501',
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
  '40000000-0000-4000-8000-000000003501',
  '10000000-0000-4000-8000-000000003502',
  '20000000-0000-4000-8000-000000003501', repeat('a', 64), repeat('b', 64),
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
  '50000000-0000-4000-8000-000000003501',
  '10000000-0000-4000-8000-000000003502',
  '20000000-0000-4000-8000-000000003501',
  '30000000-0000-4000-8000-000000003501', 'CONFIRMED-BOOKING-35',
  'confirmed_booking', '{["2101-01-01 05:00+00","2101-01-01 09:00+00")}'::tstzmultirange,
  '2100-12-31 12:00+00'
);
insert into public.booking_requests (
  id, booking_request_reference, customer_user_id, owner_user_id, profile_id,
  booking_snapshot_id, booking_period_commitment_id, payment_lifecycle_id,
  customer_name, party_size, status, response_deadline, created_at, settled_at
) values (
  '60000000-0000-4000-8000-000000003501', 'RC-REQ-0000000000003501',
  '10000000-0000-4000-8000-000000003502',
  '10000000-0000-4000-8000-000000003501',
  '20000000-0000-4000-8000-000000003501',
  '40000000-0000-4000-8000-000000003501',
  '50000000-0000-4000-8000-000000003501',
  '73000000-0000-4000-8000-000000003501', 'Fictional Customer', 4,
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
  '60000000-0000-4000-8000-000000003501',
  '70000000-0000-4000-8000-000000003501',
  '72000000-0000-4000-8000-000000003501', 1,
  '73000000-0000-4000-8000-000000003501',
  '73000000-0000-4000-8000-000000003501:authorization',
  '73000000-0000-4000-8000-000000003501:authorization:attempt-1',
  '73000000-0000-4000-8000-000000003501:capture',
  '73000000-0000-4000-8000-000000003501:capture:attempt-2',
  115000000, 'IQD', 'fictional-payments', 'local-test', 'fictional-merchant',
  'fictional-terminal', 'booking-request-capture:35', repeat('e', 64),
  'complete', 1, 'succeeded', '2100-12-31 13:00+00'
);
insert into public.booking_confirmations (
  id, booking_request_id, booking_snapshot_id, booking_period_commitment_id,
  capture_operation_id, confirmed_at
) values (
  '80000000-0000-4000-8000-000000003501',
  '60000000-0000-4000-8000-000000003501',
  '40000000-0000-4000-8000-000000003501',
  '50000000-0000-4000-8000-000000003501',
  '81000000-0000-4000-8000-000000003501', '2100-12-31 13:00+00'
);
insert into public.booking_receipts (
  id, booking_confirmation_id, booking_snapshot_id, recipient_role,
  recipient_user_id, created_at
) values
  ('82000000-0000-4000-8000-000000003501', '80000000-0000-4000-8000-000000003501', '40000000-0000-4000-8000-000000003501', 'cottage_owner', '10000000-0000-4000-8000-000000003501', '2100-12-31 13:00+00'),
  ('82000000-0000-4000-8000-000000003502', '80000000-0000-4000-8000-000000003501', '40000000-0000-4000-8000-000000003501', 'customer', '10000000-0000-4000-8000-000000003502', '2100-12-31 13:00+00');
set session_replication_role = origin;
