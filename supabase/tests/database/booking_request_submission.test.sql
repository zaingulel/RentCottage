begin;

select plan(96);

select has_function(
  'public', 'prepare_booking_request_submission', array['uuid', 'uuid', 'jsonb'],
  'Booking Request submission claims one durable attempt before payment'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.dequeue_booking_request_authorization_reconciliation()',
    'execute'
  )
  and not has_function_privilege(
    'anon', 'public.dequeue_booking_request_authorization_reconciliation()', 'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.dequeue_booking_request_authorization_reconciliation()',
    'execute'
  ),
  'only the least-privilege backend worker role can dequeue provider work'
);
select has_function(
  'public', 'booking_request_policy_at', array['timestamptz', 'timestamptz'],
  'Booking Request timing policy has one deterministic database seam'
);
select has_function(
  'public', 'finalize_booking_request_submission', array['uuid', 'jsonb'],
  'Booking Request finalization is one PostgreSQL transaction'
);
select has_function(
  'public', 'dequeue_booking_request_authorization_reconciliation', array[]::text[],
  'an independent worker can discover reconciliation work through a deployed interface'
);
select has_function(
  'public', 'complete_booking_request_authorization_reconciliation',
  array['uuid', 'integer', 'bigint', 'uuid', 'jsonb', 'jsonb'],
  'reconciliation completion is lease, generation, and revision compare-and-set'
);
select has_function(
  'public', 'classify_booking_request_authorization_claim_persistence', array['uuid'],
  'a lost initial claim response has an authoritative persistence classifier'
);
select results_eq(
  $$select state::text,
      public.booking_request_claim_state_is_active(state),
      public.booking_request_claim_state_is_reconcilable(state),
      public.booking_request_claim_state_is_terminal(state),
      public.booking_request_claim_state_allows_authorization(state)
    from unnest(enum_range(null::public.booking_request_authorization_claim_state)) state$$,
  $$values
      ('starting'::text, true, true, false, true),
      ('not_started'::text, false, false, true, false),
      ('failed'::text, false, false, true, false),
      ('reconciliation_required'::text, true, true, false, true),
      ('authorized'::text, true, false, false, false),
      ('releasing'::text, true, true, false, false),
      ('released'::text, false, false, true, false),
      ('converted'::text, false, false, true, false)$$,
  'every claim state has one exhaustive active, reconcilable, terminal, and authorization classification'
);
select results_eq(
  $$select public.booking_request_claim_state_after_payment(
      current_state, next_attempt_state, has_request, release_status
    )::text
    from (values
      ('starting'::public.booking_request_authorization_claim_state, 'authorized', true, null::text),
      ('starting', 'authorization_failed', false, null),
      ('starting', 'authorization_failed', true, null),
      ('authorized', 'releasing', true, 'pending'),
      ('releasing', 'releasing', true, 'failed'),
      ('releasing', 'released', true, 'succeeded'),
      ('converted', 'reconciliation_required', true, null)
    ) cases(current_state, next_attempt_state, has_request, release_status)$$,
  $$values ('authorized'::text), ('not_started'), ('failed'), ('releasing'),
      ('failed'), ('released'), ('converted')$$,
  'claim payment transitions are exhaustive and terminal states cannot regress'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_class relations
    where relations.oid in (
      'public.booking_request_submission_attempts'::regclass,
      'public.booking_request_provider_operation_identities'::regclass,
      'public.booking_request_authorization_claims'::regclass,
      'public.booking_request_authorization_claim_items'::regclass,
      'public.booking_request_authorization_claim_occupancies'::regclass,
      'public.booking_request_authorization_reconciliation_outbox'::regclass,
      'public.booking_snapshots'::regclass,
      'public.booking_requests'::regclass,
      'public.owner_request_notifications'::regclass
    ) and relations.relrowsecurity
  ),
  9::bigint,
  'all private Booking Request tables have Row Level Security enabled'
);
select ok(
  not exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
    cross join (values
      ('public.booking_request_submission_attempts'),
      ('public.booking_request_provider_operation_identities'),
      ('public.booking_request_authorization_claims'),
      ('public.booking_request_authorization_claim_items'),
      ('public.booking_request_authorization_claim_occupancies'),
      ('public.booking_request_authorization_reconciliation_outbox'),
      ('public.booking_snapshots'),
      ('public.booking_requests'),
      ('public.owner_request_notifications')
    ) relations(table_name)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) privileges(privilege_name)
    where has_table_privilege(roles.role_name, relations.table_name, privileges.privilege_name)
  ),
  'application roles cannot bypass the Booking Request interfaces'
);

insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values
  (
    '00000000-0000-0000-0000-000000003201', 'authenticated', 'authenticated',
    '+9647500003201', now()
  ),
  (
    '00000000-0000-0000-0000-000000003202', 'authenticated', 'authenticated',
    '+9647500003202', now()
  ),
  (
    '00000000-0000-0000-0000-000000003203', 'authenticated', 'authenticated',
    '+9647500003203', now()
  ),
  (
    '00000000-0000-0000-0000-000000003204', 'authenticated', 'authenticated',
    '+9647500003204', now()
  ),
  (
    '00000000-0000-0000-0000-000000003205', 'authenticated', 'authenticated',
    '+9647500003205', null
  );
insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000003201', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000003202', 'customer', null),
  ('00000000-0000-0000-0000-000000003203', 'customer', null),
  ('00000000-0000-0000-0000-000000003204', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000003205', 'customer', null);

insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, amenities, source_language, description,
  house_rules, status
) values (
  '30000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003201',
  'Submission Cottage', 'Baghdad', 'Karrada', 'Private address',
  8, 3, 2, array['pool'], 'en', 'Description', 'No smoking', 'draft'
);
insert into public.cottage_shift_schedule_revisions (
  id, profile_id, revision, full_day_bundle_id
) values (
  '60000000-0000-4000-8000-000000003201',
  '30000000-0000-4000-8000-000000003201', 1,
  '61000000-0000-4000-8000-000000003201'
);
select set_config(
  'rentcottage.shift_schedule_write_revision_id',
  '60000000-0000-4000-8000-000000003201', true
);
insert into public.cottage_shifts (
  id, schedule_revision_id, position, name, start_time, end_time
) values
  (
    '62000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201', 1, 'Morning', '08:00', '12:00'
  ),
  (
    '62000000-0000-4000-8000-000000003202',
    '60000000-0000-4000-8000-000000003201', 2, 'Evening', '17:00', '23:00'
  );
select set_config('rentcottage.shift_schedule_write_revision_id', '', true);
update public.owner_application_cottage_profiles
set current_shift_schedule_id = '60000000-0000-4000-8000-000000003201'
where id = '30000000-0000-4000-8000-000000003201';

insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules, revision
) values (
  '63000000-0000-4000-8000-000000003201',
  '30000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003201',
  'en', 'Description', 'No smoking', 1
);
insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
) values (
  '64000000-0000-4000-8000-000000003201',
  '30000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003201',
  '63000000-0000-4000-8000-000000003201',
  'Submission Cottage', 'Baghdad', 'Karrada', 8, 3, 2,
  array['pool'], 1, 'approved', now()
);
insert into public.cottage_profile_localized_revisions (
  id, review_cycle_id, locale, revision, origin, description, house_rules
) values (
  '65000000-0000-4000-8000-000000003201',
  '64000000-0000-4000-8000-000000003201',
  'en', 1, 'owner_source', 'Description', 'No smoking'
);
insert into public.cottage_profile_publication_decisions (
  review_cycle_id, administrator_user_id, approved, reason
) values (
  '64000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003203', true, 'Approved fixture'
);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
) values (
  '66000000-0000-4000-8000-000000003201',
  '30000000-0000-4000-8000-000000003201',
  '64000000-0000-4000-8000-000000003201',
  1, 'Submission Cottage', 'Baghdad', 'Karrada', 8, 3, 2, array['pool']
);
insert into public.cottage_publication_localizations (
  publication_id, locale, localized_revision_id, description, house_rules
) values (
  '66000000-0000-4000-8000-000000003201', 'en',
  '65000000-0000-4000-8000-000000003201', 'Description', 'No smoking'
);
update public.owner_application_cottage_profiles
set current_publication_id = '66000000-0000-4000-8000-000000003201'
where id = '30000000-0000-4000-8000-000000003201';

insert into public.cottage_inventory_standard_prices (
  schedule_revision_id, unit_kind, unit_id, price_iqd
) values
  (
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003201', 100000
  ),
  (
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003202', 110000
  ),
  (
    '60000000-0000-4000-8000-000000003201', 'full_day_bundle',
    '61000000-0000-4000-8000-000000003201', 190000
  );
insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select schedule_revision_id, unit_kind, unit_id, service_day, 'open'
from public.cottage_inventory_standard_prices
cross join (values ('2099-08-21'::date), ('2099-08-22'::date)) days(service_day)
where schedule_revision_id = '60000000-0000-4000-8000-000000003201';

create temporary table submission_fixture as
select
  '{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":2}]}'::jsonb as search,
  public.get_public_booking_quote_with_fingerprint(
    'en', 'cottage-30000000000040008000000000003201',
    '{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":2}]}'::jsonb
  ) as quote;
grant select on submission_fixture to service_role;

create temporary table valid_submission as
select jsonb_build_object(
  'locale', 'en',
  'publicSlug', 'cottage-30000000000040008000000000003201',
  'discoveryQuery', search,
  'quoteFingerprint', quote ->> 'quoteFingerprint',
  'contentVersion', 1,
  'termsVersion', 'rentcottage-mvp-2026-08-04',
  'bookingPriceIqd', 110000,
  'serviceFeeIqd', 5000,
  'customerTotalIqd', 115000,
  'firstStartsAt', '2099-08-21T17:00:00+03:00',
  'intent', jsonb_build_object(
    'customerName', 'Ava Hassan',
    'partySize', 4,
    'bookingNote', 'Please prepare the garden seating.',
    'acceptedHouseRules', true,
    'acceptedCancellationPolicy', true,
    'acceptedMarketplaceTerms', true,
    'acceptedInside48HourNoRefund', false,
    'cancellationPolicyVersion', 'rentcottage-mvp-2026-08-04',
    'acceptanceEvidence', jsonb_build_object(
      'locale', 'en',
      'cancellationPolicy', 'Cancel at least 48 hours before the first shift for a full refund. Cancellation inside 48 hours and no-shows receive no refund.',
      'cancellationAcceptance', 'I accept the cancellation policy.',
      'marketplaceTermsAcceptance', 'I accept the marketplace booking terms. (rentcottage-mvp-2026-08-04)',
      'inside48Warning', null,
      'inside48Acceptance', null
    )
  )
) as submission
from submission_fixture;
grant select on valid_submission to service_role;

select matches(
  (select quote ->> 'quoteFingerprint' from submission_fixture),
  '^[0-9a-f]{64}$',
  'the displayed Booking Quote has a canonical fingerprint'
);
select ok(
  not public.booking_request_content_is_safe('+964 750 123 4567')
  and not public.booking_request_content_is_safe('0750[123][4567]')
  and not public.booking_request_content_is_safe('٠٧٥٠ ١٢٣ ٤٥٦٧')
  and not public.booking_request_content_is_safe('٠٧٥٠[١٢٣][٤٥٦٧]')
  and not public.booking_request_content_is_safe('۰۷۵۰-۱۲۳-۴۵۶۷')
  and not public.booking_request_content_is_safe('۰۷۵۰—۱۲۳—۴۵۶۷')
  and not public.booking_request_content_is_safe('٠٧٥٠–١٢٣–٤٥٦٧')
  and not public.booking_request_content_is_safe('0750‑123‑4567')
  and not public.booking_request_content_is_safe('۰۷۵۰[۱۲۳][۴۵۶۷]')
  and not public.booking_request_content_is_safe('ava@example.com')
  and not public.booking_request_content_is_safe('https://example.com/ava')
  and not public.booking_request_content_is_safe('Telegram @ava_hassan')
  and not public.booking_request_content_is_safe('contact:@ava_hassan'),
  'the database blocks common contact formats across supported digit scripts'
);
select ok(
  not public.booking_request_content_is_safe('0750​123​4567')
  and not public.booking_request_content_is_safe('۰۷۵۰​۱۲۳​۴۵۶۷'),
  'the database neutralizes zero-width formatting characters in readable phone numbers'
);
select ok(
  not public.booking_request_content_is_safe('zero seven five zero one two three four five six seven')
  and not public.booking_request_content_is_safe('ava at example dot com')
  and not public.booking_request_content_is_safe('صفر سبعة خمسة صفر واحد اثنان ثلاثة أربعة خمسة ستة سبعة')
  and not public.booking_request_content_is_safe('ava ات example نقطة com')
  and not public.booking_request_content_is_safe('سفر حەوت پێنج سفر یەک دوو سێ چوار پێنج شەش حەوت')
  and not public.booking_request_content_is_safe('ava ئەت example دۆت com')
  and public.booking_request_content_is_safe('One guest will arrive at the garden after seven.')
  and public.booking_request_content_is_safe('یەک میوان دوای حەوت دەگات.')
  and public.booking_request_content_is_safe('سنصل بعد سبع ساعات مع ضيف واحد.'),
  'the database blocks only structured word-obfuscated contact across launch languages'
);
select is(
  public.booking_request_policy_at(
    '2099-08-22T00:00:00Z', '2099-08-21T18:00:00Z'
  ) ->> 'insideCutoff',
  'false', 'exactly six hours remains requestable'
);
select is(
  public.booking_request_policy_at(
    '2099-08-22T00:00:00Z', '2099-08-21T18:00:00.001Z'
  ) ->> 'insideCutoff',
  'true', 'just inside six hours is after the Booking Request Cut-Off'
);
select is(
  public.booking_request_policy_at(
    '2099-08-22T00:00:00Z', '2099-08-20T00:00:00Z'
  ) ->> 'requiresInside48HourNoRefundAcceptance',
  'false', 'exactly 48 hours does not require the inside-48-hour acceptance'
);
select is(
  public.booking_request_policy_at(
    '2099-08-22T00:00:00Z', '2099-08-20T00:00:00.001Z'
  ) ->> 'requiresInside48HourNoRefundAcceptance',
  'true', 'just inside 48 hours requires the no-refund acceptance'
);

set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113299',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"Email ava@example.com"'::jsonb)
  ) ->> 'status',
  'invalid',
  'contact protection cannot be bypassed through the database interface'
);
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113294',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"0750​123​4567"'::jsonb)
  ) ->> 'status',
  'invalid',
  'zero-width contact obfuscation is rejected before owner projection'
);
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003205',
    '11111111-1111-4111-8111-111111113298',
    (select submission from valid_submission)
  ) ->> 'status',
  'access-required',
  'an authenticated but phone-unverified Customer is denied'
);
reset role;

set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113295',
    (select jsonb_set(
      submission,
      '{intent}',
      (submission -> 'intent') - 'acceptanceEvidence'
    ) from valid_submission)
  ) ->> 'status',
  'invalid',
  'missing acceptance evidence is rejected before Payment Authorization'
);
reset role;

set local role service_role;
create temporary table prepared_submission as
select public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202',
  '11111111-1111-4111-8111-111111113201',
  (select submission from valid_submission)
) as result;
reset role;

select is(
  (select result ->> 'status' from prepared_submission), 'ready',
  'a verified Customer claims one submission attempt before authorization'
);

set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    (select submission from valid_submission)
  ) ->> 'status',
  'ready',
  'a pre-provider crash resumes the same durable Payment Lifecycle'
);
reset role;

update public.cottage_inventory_standard_prices
set price_iqd = 120000
where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
  and unit_id = '62000000-0000-4000-8000-000000003202';
set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    (select submission from valid_submission)
  ) ->> 'status',
  'quote-stale',
  'a pre-provider crash cannot resume against a stale price quote'
);
reset role;
update public.cottage_inventory_standard_prices
set price_iqd = 110000
where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
  and unit_id = '62000000-0000-4000-8000-000000003202';

update public.cottage_inventory_availability
set state = 'closed'
where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
  and unit_kind = 'shift'
  and unit_id = '62000000-0000-4000-8000-000000003202'
  and service_day = '2099-08-21';
set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    (select submission from valid_submission)
  ) ->> 'status',
  'quote-stale',
  'a pre-provider crash cannot resume after availability closes'
);
reset role;
update public.cottage_inventory_availability
set state = 'open'
where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
  and unit_kind = 'shift'
  and unit_id = '62000000-0000-4000-8000-000000003202'
  and service_day = '2099-08-21';
select is(
  (select count(*) from public.booking_request_submission_attempts),
  1::bigint,
  'customer-scoped idempotency persists only one attempt'
);

set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    jsonb_set(
      (select submission from valid_submission),
      '{intent,customerName}', '"Different Customer"'::jsonb
    )
  ) ->> 'status',
  'invalid',
  'an idempotency key cannot be rebound to a different immutable intent'
);
reset role;

create temporary table authorized_payment as
select jsonb_build_object(
  'paymentLifecycleId', result ->> 'paymentLifecycleId',
  'currency', 'IQD',
  'bookingPriceFils', 110000000,
  'bookingServiceFeeFils', 5000000,
  'customerTotalFils', 115000000,
  'authorization', jsonb_build_object(
    'paymentLifecycleId', result ->> 'paymentLifecycleId',
    'kind', 'authorization',
    'logicalOperationId', (result ->> 'paymentLifecycleId') || ':authorization',
    'attemptId', (result ->> 'paymentLifecycleId') || ':authorization:attempt-1',
    'status', 'succeeded',
    'amountFils', 115000000,
    'providerRequestId', 'provider-request-3201',
    'providerReference', 'provider-reference-3201',
    'movementReference', 'movement-reference-3201',
    'reconciliationRequired', false,
    'retrySafe', false
  ),
  'capture', null,
  'release', null,
  'refunds', jsonb_build_array(),
  'financials', jsonb_build_object(
    'refundedBookingPriceFils', 0,
    'refundedBookingServiceFeeFils', 0,
    'remainingBookingPriceFils', 110000000,
    'remainingBookingServiceFeeFils', 5000000,
    'marketplaceCommissionFils', 11000000,
    'ownerEntitlementFils', 99000000
  ),
  'payout', jsonb_build_object(
    'status', 'not_eligible', 'eligibleFils', 99000000,
    'paidFils', 0, 'providerFeeFils', 0, 'providerReserveFils', 0,
    'recoveryExposureFils', 0, 'recoveryBalanceFils', 0,
    'automaticOwnerDebitFils', 0, 'paidWhileBlocked', false,
    'settlement', null
  ),
  'holds', jsonb_build_object('administrator', false, 'dispute', false),
  'dispute', null,
  'audits', jsonb_build_array(),
  'movements', jsonb_build_array(jsonb_build_object(
    'kind', 'authorization',
    'logicalOperationId', (result ->> 'paymentLifecycleId') || ':authorization',
    'attemptId', (result ->> 'paymentLifecycleId') || ':authorization:attempt-1',
    'amountFils', 115000000,
    'movementReference', 'movement-reference-3201',
    'recordedAt', '2099-08-21T14:00:00.000Z'
  ))
) as snapshot
from prepared_submission;
grant select on authorized_payment to service_role;

create temporary table pending_authorization_payment as
select snapshot
  #- '{authorization,providerRequestId}'
  #- '{authorization,providerReference}'
  #- '{authorization,movementReference}'
  || jsonb_build_object(
    'authorization', (snapshot -> 'authorization') || jsonb_build_object(
      'status', 'pending', 'providerRequestId', null,
      'providerReference', null, 'movementReference', null
    ),
    'movements', jsonb_build_array()
  ) as snapshot
from authorized_payment;
grant select on pending_authorization_payment to service_role;

set local role service_role;
select is(
  public.classify_booking_request_authorization_claim_persistence(
    (select (result ->> 'attemptId')::uuid from prepared_submission)
  ) ->> 'status',
  'absent',
  'an initial claim transaction that left no claim, outbox, or snapshot is safely retryable'
);
reset role;

savepoint independent_reconciliation;
set local role service_role;
select lives_ok(
  format(
    'select public.begin_booking_request_authorization_claim(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from pending_authorization_payment),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'
  ),
  'a crash-safe reconciliation claim is durably available to an independent consumer'
);
reset role;
create temporary table definitely_not_started_work (result jsonb);
grant select, insert on definitely_not_started_work to service_role;
set local role service_role;
insert into definitely_not_started_work
select public.dequeue_booking_request_authorization_reconciliation();
select is(
  (select result ->> 'status' from definitely_not_started_work),
  'work',
  'the deployed worker interface discovers persisted reconciliation work independently'
);
select ok(
  not ((select result from definitely_not_started_work) ?| array[
    'customerUserId', 'customerName', 'bookingNote', 'phone', 'publicSlug',
    'profileId', 'intentPayload', 'quotePayload', 'requestedSearch'
  ]),
  'dequeued provider work exposes no customer, profile, quote, intent, or contact data'
);
select is(
  public.dequeue_booking_request_authorization_reconciliation() ->> 'status',
  'empty',
  'a second worker cannot dequeue work while the first worker owns its lease'
);
reset role;
update public.booking_request_authorization_reconciliation_outbox
set lease_expires_at = clock_timestamp() - interval '1 second';
create temporary table recovered_not_started_work (result jsonb);
grant select, insert on recovered_not_started_work to service_role;
set local role service_role;
insert into recovered_not_started_work
select public.dequeue_booking_request_authorization_reconciliation();
select results_eq(
  $$select
      recovered.result ->> 'status',
      recovered.result ->> 'claimId' = original.result ->> 'claimId',
      recovered.result ->> 'generation' = original.result ->> 'generation',
      recovered.result ->> 'stateRevision' = original.result ->> 'stateRevision',
      recovered.result ->> 'leaseToken' <> original.result ->> 'leaseToken'
    from recovered_not_started_work recovered
    cross join definitely_not_started_work original$$,
  $$values ('work'::text, true, true, true, true)$$,
  'an expired crashed-worker lease is retried with the same CAS identity and a new lease token'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from recovered_not_started_work))::uuid,
    ((select result ->> 'generation' from recovered_not_started_work))::integer,
    ((select result ->> 'stateRevision' from recovered_not_started_work))::bigint,
    ((select result ->> 'leaseToken' from recovered_not_started_work))::uuid,
    (select snapshot || jsonb_build_object(
      'authorization', (snapshot -> 'authorization') || jsonb_build_object(
        'status', 'failed', 'reconciliationRequired', false, 'retrySafe', false
      )
    ) from pending_authorization_payment),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'::jsonb
  ) ->> 'status',
  'applied',
  'independent reconciliation records provider-confirmed non-execution'
);
reset role;
select results_eq(
  $$select claims.state::text, occupancies.active, outbox.state
    from public.booking_request_authorization_claims claims
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('not_started'::text, false, 'complete'::text)$$,
  'definite non-execution terminally frees the private occupancy and completes the outbox'
);
select is(
  public.public_cottage_unit_is_available(
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003202', '2099-08-21'
  ),
  true,
  'definite non-execution restores public availability without a customer retry'
);
set local role service_role;
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from recovered_not_started_work))::uuid,
    ((select result ->> 'generation' from recovered_not_started_work))::integer,
    ((select result ->> 'stateRevision' from recovered_not_started_work))::bigint,
    ((select result ->> 'leaseToken' from recovered_not_started_work))::uuid,
    (select snapshot || jsonb_build_object(
      'authorization', (snapshot -> 'authorization') || jsonb_build_object(
        'status', 'failed', 'reconciliationRequired', false, 'retrySafe', false
      )
    ) from pending_authorization_payment),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'::jsonb
  ) ->> 'status',
  'conflict',
  'a duplicate independent reconciliation query cannot reapply terminal evidence'
);
reset role;
select results_eq(
  $$select
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)$$,
  $$values (0::integer, 0::integer)$$,
  'definite non-execution creates neither a Request nor a product Pending Hold'
);
rollback to savepoint independent_reconciliation;

set local role service_role;
select lives_ok(
  format(
    'select public.begin_booking_request_authorization_claim(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from pending_authorization_payment),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'
  ),
  'the internal Authorization Claim and pending Payment Lifecycle are created atomically'
);
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    (select submission from valid_submission)
  ) ->> 'status',
  'reconciliation-required',
  'refresh after a potentially sent claim delegates recovery to the independent outbox'
);
select lives_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from authorized_payment),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'
  ),
  'the exact successful Payment Lifecycle snapshot is persisted before finalization'
);
reset role;
select is(
  (select state from public.booking_request_authorization_claims),
  'authorized',
  'successful authorization advances the same durable claim'
);
select results_eq(
  $$select count(*)::integer,
      count(*) filter (where active)::integer
    from public.booking_request_authorization_claim_occupancies$$,
  $$values (1::integer, 1::integer)$$,
  'one private active occupancy protects the selected Cottage Shift'
);
select is(
  (select state from public.booking_request_authorization_reconciliation_outbox),
  'pending',
  'independent reconciliation remains queued until conversion or definitive absence'
);

savepoint lost_release_response;
create temporary table pending_release_payment as
select snapshot || jsonb_build_object(
  'release', jsonb_build_object(
    'paymentLifecycleId', snapshot ->> 'paymentLifecycleId',
    'kind', 'release',
    'logicalOperationId', (snapshot ->> 'paymentLifecycleId') || ':release',
    'attemptId', (snapshot ->> 'paymentLifecycleId') || ':release:attempt-1',
    'status', 'pending', 'amountFils', 115000000,
    'providerRequestId', null, 'providerReference', null,
    'movementReference', null, 'reconciliationRequired', false,
    'retrySafe', false
  )
) as snapshot
from authorized_payment;
grant select on pending_release_payment to service_role;
set local role service_role;
select lives_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from pending_release_payment),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'
  ),
  'a release that is about to execute is durably persisted before its provider call'
);
reset role;
create temporary table first_release_work (result jsonb);
grant select, insert on first_release_work to service_role;
set local role service_role;
insert into first_release_work
select public.dequeue_booking_request_authorization_reconciliation();
select is(
  (select result ->> 'operationKind' from first_release_work),
  'release',
  'reconciliation discovers the pending release and never reauthorizes it'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from first_release_work))::uuid,
    ((select result ->> 'generation' from first_release_work))::integer,
    ((select result ->> 'stateRevision' from first_release_work))::bigint,
    ((select result ->> 'leaseToken' from first_release_work))::uuid,
    (select snapshot || jsonb_build_object(
      'release', (snapshot -> 'release') || jsonb_build_object(
        'providerRequestId', 'release-request-3201',
        'providerReference', 'release-reference-3201',
        'movementReference', 'release-movement-3201',
        'reconciliationRequired', true
      )
    ) from pending_release_payment),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'::jsonb
  ) ->> 'claimState',
  'reconciliation_required',
  'an unknown release outcome retains its claim, occupancy, and reconciliation work'
);
reset role;
select results_eq(
  $$select claims.state::text, occupancies.active, outbox.state
    from public.booking_request_authorization_claims claims
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('reconciliation_required'::text, true, 'pending'::text)$$,
  'unknown release evidence cannot prematurely free the protected period'
);
create temporary table retried_release_work (result jsonb);
grant select, insert on retried_release_work to service_role;
set local role service_role;
insert into retried_release_work
select public.dequeue_booking_request_authorization_reconciliation();
select is(
  (select result ->> 'operationKind' from retried_release_work),
  'release',
  'a lost release response retries only the authoritative release operation'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from retried_release_work))::uuid,
    ((select result ->> 'generation' from retried_release_work))::integer,
    ((select result ->> 'stateRevision' from retried_release_work))::bigint,
    ((select result ->> 'leaseToken' from retried_release_work))::uuid,
    (select snapshot || jsonb_build_object(
      'release', (snapshot -> 'release') || jsonb_build_object(
        'status', 'succeeded',
        'providerRequestId', 'release-request-3201',
        'providerReference', 'release-reference-3201',
        'movementReference', 'release-movement-3201',
        'reconciliationRequired', false
      ),
      'movements', (snapshot -> 'movements') || jsonb_build_array(
        jsonb_build_object(
          'kind', 'release',
          'logicalOperationId', snapshot -> 'release' ->> 'logicalOperationId',
          'attemptId', snapshot -> 'release' ->> 'attemptId',
          'amountFils', 115000000,
          'movementReference', 'release-movement-3201',
          'recordedAt', '2099-08-21T14:01:00.000Z'
        )
      )
    ) from pending_release_payment),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'::jsonb
  ) ->> 'claimState',
  'released',
  'a recovered successful release terminally closes the claim'
);
reset role;
select results_eq(
  $$select claims.state::text, occupancies.active, outbox.state,
      outbox.lease_token is null
    from public.booking_request_authorization_claims claims
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('released'::text, false, 'complete'::text, true)$$,
  'definitive release evidence deactivates claim, occupancy, lease, and outbox'
);
set local role service_role;
select is(
  public.dequeue_booking_request_authorization_reconciliation() ->> 'status',
  'empty',
  'terminal release evidence cannot be rediscovered or reauthorized'
);
reset role;
select is(
  public.public_cottage_unit_is_available(
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003202', '2099-08-21'
  ),
  true,
  'definitive release automatically restores public availability'
);
select results_eq(
  $$select
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)$$,
  $$values (0::integer, 0::integer)$$,
  'release reconciliation creates neither a Request nor a product Pending Hold'
);
rollback to savepoint lost_release_response;

select results_eq(
  $$select
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)$$,
  $$values (0::integer, 0::integer)$$,
  'authorization claim and successful authorization create neither Request nor product Pending Hold'
);
create temporary table authorization_claim_observer as
select id, generation, state_revision
from public.booking_request_authorization_claims;
grant select on authorization_claim_observer to service_role;
select is(
  public.public_cottage_unit_is_available(
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003202', '2099-08-21'
  ),
  false,
  'the private claim removes its unit from public availability without becoming a product hold'
);
set local role service_role;
select results_eq(
  $$select unit ->> 'calendarState', (unit ->> 'editable')::boolean,
      unit ->> 'commitmentReference'
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000003201',
      '60000000-0000-4000-8000-000000003201', '2099-08-21'
    ) -> 'units') unit
    where unit ->> 'id' = '62000000-0000-4000-8000-000000003202'$$,
  $$values ('unavailable'::text, false, null::text)$$,
  'owner calendar exposes only generic unavailability without private claim metadata'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    (select id from authorization_claim_observer),
    (select generation from authorization_claim_observer),
    0,
    gen_random_uuid(),
    (select snapshot from authorized_payment),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'::jsonb
  ) ->> 'status',
  'conflict',
  'stale reconciliation completion loses the claim state-revision compare-and-set'
);
select throws_ok(
  format(
    'select public.create_pending_booking_period_hold(%L::uuid, %L::uuid, %L, %L::jsonb)',
    '00000000-0000-0000-0000-000000003203',
    '30000000-0000-4000-8000-000000003201', 'RC-CLAIM-CONTENDER',
    (select (submission -> 'discoveryQuery')::text from valid_submission)
  ),
  'RC409', null,
  'a product Pending Hold cannot overlap active authorization-claimed inventory'
);
reset role;
select throws_ok(
  $$update public.cottage_inventory_standard_prices
    set price_iqd = price_iqd + 1
    where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
      and unit_kind = 'shift'
      and unit_id = '62000000-0000-4000-8000-000000003202'$$,
  'RC204', null,
  'an owner price mutation cannot change authorization-claimed inventory'
);
select throws_ok(
  $$update public.cottage_inventory_availability
    set state = 'closed'
    where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
      and unit_kind = 'shift'
      and unit_id = '62000000-0000-4000-8000-000000003202'
      and service_day = '2099-08-21'$$,
  'RC204', null,
  'an owner availability mutation cannot change authorization-claimed inventory'
);
select throws_ok(
  $$update public.owner_application_cottage_profiles
    set current_publication_id = null
    where id = '30000000-0000-4000-8000-000000003201'$$,
  'RC204', null,
  'an owner publication pointer cannot change while authorization is claim-protected'
);
set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    (select submission from valid_submission)
  ) -> 'providerIdentity',
  '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'::jsonb,
  'recovery returns the immutable provider identity with payment evidence'
);
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from authorized_payment),
    '{"provider":"test-payments","environment":"test","merchantId":"changed-merchant","terminalId":"terminal-32"}'
  ),
  'RC409', null,
  'a provider configuration change cannot move an authorization uniqueness namespace'
);
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select jsonb_set(snapshot, '{movements}', (snapshot -> 'movements') || jsonb_build_array(jsonb_build_object(
      'kind', 'authorization',
      'logicalOperationId', snapshot -> 'authorization' ->> 'logicalOperationId',
      'attemptId', snapshot -> 'authorization' ->> 'attemptId',
      'amountFils', 115000000,
      'movementReference', 'invented-extra-movement',
      'recordedAt', '2099-08-21T14:00:01.000Z'
    )))::text from authorized_payment),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'
  ),
  '22023', null,
  'an authorization-only snapshot rejects invented extra movements'
);
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select jsonb_set(snapshot, '{authorization,logicalOperationId}', '"forged"'::jsonb)::text from authorized_payment),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'
  ),
  '22023', null,
  'the database rejects a forged successful authorization snapshot'
);
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select jsonb_set(snapshot, '{release}', jsonb_build_object(
      'paymentLifecycleId', snapshot ->> 'paymentLifecycleId',
      'kind', 'release',
      'logicalOperationId', 'forged',
      'attemptId', (snapshot ->> 'paymentLifecycleId') || ':release:attempt-1',
      'status', 'pending',
      'amountFils', 115000000,
      'providerRequestId', null,
      'providerReference', null,
      'movementReference', null,
      'reconciliationRequired', false,
      'retrySafe', false
    ))::text from authorized_payment),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'
  ),
  '22023', null,
  'the database rejects a forged release operation before changing attempt state'
);
reset role;
update public.booking_request_submission_attempts
set payment_snapshot = jsonb_set(
  payment_snapshot,
  '{movements}',
  (payment_snapshot -> 'movements') || jsonb_build_array(jsonb_build_object(
    'kind', 'authorization',
    'logicalOperationId', payment_snapshot -> 'authorization' ->> 'logicalOperationId',
    'attemptId', payment_snapshot -> 'authorization' ->> 'attemptId',
    'amountFils', 115000000,
    'movementReference', 'tampered-retained-movement',
    'recordedAt', '2099-08-21T14:00:02.000Z'
  ))
)
where id = (select (result ->> 'attemptId')::uuid from prepared_submission);
create temporary table tampered_payment as
select payment_snapshot as snapshot
from public.booking_request_submission_attempts
where id = (select (result ->> 'attemptId')::uuid from prepared_submission);
grant select on tampered_payment to service_role;
set local role service_role;
select throws_ok(
  format(
    'select public.finalize_booking_request_submission(%L::uuid, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from tampered_payment)
  ),
  '22023', null,
  'finalization revalidates exact retained payment evidence'
);
reset role;
update public.booking_request_submission_attempts
set payment_snapshot = (select snapshot from authorized_payment),
  state = 'authorized'
where id = (select (result ->> 'attemptId')::uuid from prepared_submission);
update public.booking_request_submission_attempts
set intent_payload = jsonb_set(
  intent_payload,
  '{acceptanceEvidence,cancellationPolicy}',
  '"changed after acceptance"'::jsonb
)
where id = (select (result ->> 'attemptId')::uuid from prepared_submission);
set local role service_role;
select throws_ok(
  format(
    'select public.finalize_booking_request_submission(%L::uuid, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from authorized_payment)
  ),
  'RC409', null,
  'finalization rejects changed localized acceptance evidence under its lock'
);
reset role;
update public.booking_request_submission_attempts
set intent_payload = jsonb_set(
  intent_payload,
  '{acceptanceEvidence,cancellationPolicy}',
  '"Cancel at least 48 hours before the first shift for a full refund. Cancellation inside 48 hours and no-shows receive no refund."'::jsonb
)
where id = (select (result ->> 'attemptId')::uuid from prepared_submission);
create temporary table finalized_submission as
select public.finalize_booking_request_submission(
  (select result ->> 'attemptId' from prepared_submission)::uuid,
  (select snapshot from authorized_payment)
) as result;
reset role;
grant select on finalized_submission to service_role;

select is(
  (select result ->> 'status' from finalized_submission), 'pending',
  'successful authorization finalizes one Pending Booking Request'
);
select results_eq(
  $$select
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.booking_snapshots),
      (select count(*)::integer from public.cottage_booking_period_commitments),
      (select count(*)::integer from public.owner_request_notifications)$$,
  $$values (1::integer, 1::integer, 1::integer, 1::integer)$$,
  'request, immutable snapshot, complete Pending Hold and owner notice commit atomically'
);
select results_eq(
  $$select claims.state::text, occupancies.active, outbox.state
    from public.booking_request_authorization_claims claims
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('converted'::text, false, 'complete'::text)$$,
  'successful finalization atomically consumes the private claim into the product Pending Hold'
);
select results_eq(
  $$select claim_items.service_day, claim_items.unit_kind::text,
      claim_items.unit_id, claim_items.price_iqd
    from public.booking_request_authorization_claim_items claim_items$$,
  $$select commitments.service_day, commitments.unit_kind::text,
      commitments.unit_id, commitments.committed_price_iqd
    from public.cottage_inventory_commitments commitments$$,
  'the first real Pending Hold exactly preserves every claimed priced item'
);
select is(
  (
    select response_deadline - created_at
    from public.booking_requests
  ),
  interval '4 hours',
  'the owner receives the exact four-hour Response Deadline'
);
select results_eq(
  $$select marketplace_commission_rate_basis_points,
      marketplace_commission_amount_fils
    from public.booking_snapshots$$,
  $$values (1000::smallint, 11000000::bigint)$$,
  'the immutable Booking Snapshot preserves the exact ten-percent commission'
);
select results_eq(
  $$select acceptance_locale::text, acceptance_evidence,
      acceptance_evidence_fingerprint = encode(
        extensions.digest(convert_to(acceptance_evidence::text, 'UTF8'), 'sha256'
      ), 'hex')
    from public.booking_snapshots$$,
  $$values ('en'::text, jsonb_build_object(
      'locale', 'en',
      'cancellationPolicy', 'Cancel at least 48 hours before the first shift for a full refund. Cancellation inside 48 hours and no-shows receive no refund.',
      'cancellationAcceptance', 'I accept the cancellation policy.',
      'marketplaceTermsAcceptance', 'I accept the marketplace booking terms. (rentcottage-mvp-2026-08-04)',
      'inside48Warning', null,
      'inside48Acceptance', null
    ), true)$$,
  'the immutable snapshot preserves and fingerprints the exact shown acceptance wording'
);

set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113297',
    (select submission from valid_submission)
  ) ->> 'bookingRequestReference',
  (select result ->> 'bookingRequestReference' from finalized_submission),
  'a fresh page key for the unchanged immutable intent returns the same request'
);
reset role;
select is(
  (select count(*) from public.booking_request_submission_attempts),
  1::bigint,
  'an unchanged intent cannot create a second durable attempt after refresh'
);

update public.cottage_inventory_standard_prices
set price_iqd = 120000
where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
  and unit_id = '62000000-0000-4000-8000-000000003202';
set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113296',
    (select submission from valid_submission)
  ) ->> 'bookingRequestReference',
  (select result ->> 'bookingRequestReference' from finalized_submission),
  'a finalized attempt returns its original result before current-quote rejection'
);
reset role;

set local role service_role;
select is(
  public.finalize_booking_request_submission(
    (select result ->> 'attemptId' from prepared_submission)::uuid,
    (select snapshot from authorized_payment)
  ) ->> 'bookingRequestReference',
  (select result ->> 'bookingRequestReference' from finalized_submission),
  'a finalization retry returns the same Booking Request'
);
reset role;
select results_eq(
  $$select count(*)::integer,
      (select count(*)::integer from public.owner_request_notifications)
    from public.booking_requests$$,
  $$values (1::integer, 1::integer)$$,
  'a finalization retry cannot duplicate the request or owner notice'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}',
  true
);
create temporary table owner_projection as
select public.list_owner_booking_request_notifications() as result;
reset role;
select is(
  jsonb_array_length((select result from owner_projection)), 1,
  'the Cottage Owner receives one immediate in-product notice'
);
select ok(
  not ((select result -> 0 from owner_projection) ?| array[
    'phone', 'contact', 'paymentLifecycleId', 'providerRequestId', 'providerReference'
  ]),
  'the owner projection excludes contact and payment-provider metadata'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003204"}',
  true
);
select is(
  jsonb_array_length(public.list_owner_booking_request_notifications()),
  0,
  'a second approved Cottage Owner cannot see an unrelated request'
);
reset role;

select throws_ok(
  $$insert into public.booking_request_submission_attempts (
      id, customer_user_id, idempotency_key, payment_lifecycle_id, profile_id,
      locale, public_slug, requested_search, quote_fingerprint, quote_payload,
      intent_fingerprint, intent_payload, state,
      authorization_provider, authorization_environment,
      authorization_merchant_id, authorization_terminal_id,
      authorization_provider_request_id, authorization_provider_reference,
      authorization_movement_reference
    ) select
      gen_random_uuid(), customer_user_id, gen_random_uuid(), gen_random_uuid(),
      profile_id, locale, public_slug, requested_search, repeat('b', 64),
      quote_payload, repeat('c', 64), intent_payload || '{"distinct":true}'::jsonb,
      'authorized', authorization_provider, authorization_environment,
      authorization_merchant_id, authorization_terminal_id,
      authorization_provider_request_id, authorization_provider_reference,
      authorization_movement_reference
    from public.booking_request_submission_attempts limit 1$$,
  '23505', null,
  'one provider authorization identity cannot be attached to two attempts'
);

insert into public.booking_request_submission_attempts (
  id, customer_user_id, idempotency_key, payment_lifecycle_id, profile_id,
  locale, public_slug, requested_search, quote_fingerprint, quote_payload,
  intent_fingerprint, intent_payload, state
)
select fixtures.attempt_id, '00000000-0000-0000-0000-000000003203',
  fixtures.idempotency_key, fixtures.payment_lifecycle_id,
  source.profile_id, source.locale, source.public_slug, source.requested_search,
  fixtures.intent_fingerprint, source.quote_payload,
  fixtures.intent_fingerprint,
  source.intent_payload || jsonb_build_object('releaseReplayFixture', fixtures.suffix),
  'authorizing'
from public.booking_request_submission_attempts source
cross join (values
  ('42000000-0000-4000-8000-000000003201'::uuid,
    '42100000-0000-4000-8000-000000003201'::uuid,
    '42200000-0000-4000-8000-000000003201'::uuid, repeat('d', 64), 'one'),
  ('42000000-0000-4000-8000-000000003202'::uuid,
    '42100000-0000-4000-8000-000000003202'::uuid,
    '42200000-0000-4000-8000-000000003202'::uuid, repeat('e', 64), 'two')
) fixtures(attempt_id, idempotency_key, payment_lifecycle_id, intent_fingerprint, suffix)
where source.id = (select (result ->> 'attemptId')::uuid from prepared_submission);

create temporary table released_payments as
select attempts.id as attempt_id,
  (authorized.snapshot || jsonb_build_object(
    'paymentLifecycleId', attempts.payment_lifecycle_id,
    'authorization', jsonb_build_object(
      'paymentLifecycleId', attempts.payment_lifecycle_id,
      'kind', 'authorization',
      'logicalOperationId', attempts.payment_lifecycle_id::text || ':authorization',
      'attemptId', attempts.payment_lifecycle_id::text || ':authorization:attempt-1',
      'status', 'succeeded', 'amountFils', 115000000,
      'providerRequestId', 'replay-auth-request-' || attempts.id,
      'providerReference', 'replay-auth-reference-' || attempts.id,
      'movementReference', 'replay-auth-movement-' || attempts.id,
      'reconciliationRequired', false, 'retrySafe', false
    ),
    'release', jsonb_build_object(
      'paymentLifecycleId', attempts.payment_lifecycle_id,
      'kind', 'release',
      'logicalOperationId', attempts.payment_lifecycle_id::text || ':release',
      'attemptId', attempts.payment_lifecycle_id::text || ':release:attempt-1',
      'status', 'succeeded', 'amountFils', 115000000,
      'providerRequestId', 'shared-release-request',
      'providerReference', 'shared-release-reference',
      'movementReference', 'shared-release-movement',
      'reconciliationRequired', false, 'retrySafe', false
    ),
    'movements', jsonb_build_array(
      jsonb_build_object(
        'kind', 'authorization',
        'logicalOperationId', attempts.payment_lifecycle_id::text || ':authorization',
        'attemptId', attempts.payment_lifecycle_id::text || ':authorization:attempt-1',
        'amountFils', 115000000,
        'movementReference', 'replay-auth-movement-' || attempts.id,
        'recordedAt', '2099-08-21T15:00:00.000Z'
      ),
      jsonb_build_object(
        'kind', 'release',
        'logicalOperationId', attempts.payment_lifecycle_id::text || ':release',
        'attemptId', attempts.payment_lifecycle_id::text || ':release:attempt-1',
        'amountFils', 115000000,
        'movementReference', 'shared-release-movement',
        'recordedAt', '2099-08-21T15:01:00.000Z'
      )
    )
  )) as snapshot
from public.booking_request_submission_attempts attempts
cross join authorized_payment authorized
where attempts.id in (
  '42000000-0000-4000-8000-000000003201',
  '42000000-0000-4000-8000-000000003202'
);
grant select on released_payments to service_role;

set local role service_role;
select lives_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    '42000000-0000-4000-8000-000000003201',
    (select snapshot::text from released_payments where attempt_id = '42000000-0000-4000-8000-000000003201'),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'
  ),
  'a successful release persists its typed provider identities'
);
reset role;
select results_eq(
  $$select release_provider_request_id, release_provider_reference,
      release_movement_reference
    from public.booking_request_submission_attempts
    where id = '42000000-0000-4000-8000-000000003201'$$,
  $$values ('shared-release-request'::text, 'shared-release-reference'::text,
    'shared-release-movement'::text)$$,
  'the release replay boundary retains all typed external identities'
);
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    '42000000-0000-4000-8000-000000003202',
    (select jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(snapshot, '{release}', 'null'::jsonb),
            '{authorization,providerRequestId}', '"shared-release-request"'::jsonb
          ),
          '{authorization,providerReference}', '"shared-release-reference"'::jsonb
        ),
        '{authorization,movementReference}', '"shared-release-movement"'::jsonb
      ),
      '{movements}', jsonb_build_array(jsonb_set(
        snapshot -> 'movements' -> 0,
        '{movementReference}', '"shared-release-movement"'::jsonb
      ))
    )::text from released_payments
      where attempt_id = '42000000-0000-4000-8000-000000003202'),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'
  ),
  '23505', null,
  'a release identity cannot be replayed as an authorization on another attempt'
);
do $$
begin
  perform public.save_booking_request_payment_snapshot(
    '42000000-0000-4000-8000-000000003202',
    (
      select jsonb_set(
        jsonb_set(snapshot, '{release}', 'null'::jsonb),
        '{movements}', jsonb_build_array(snapshot -> 'movements' -> 0)
      )
      from released_payments
      where attempt_id = '42000000-0000-4000-8000-000000003202'
    ),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'::jsonb
  );
end;
$$;
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    '42000000-0000-4000-8000-000000003202',
    (select jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(snapshot, '{release,providerRequestId}', '"provider-request-3201"'::jsonb),
          '{release,providerReference}', '"provider-reference-3201"'::jsonb
        ),
        '{release,movementReference}', '"movement-reference-3201"'::jsonb
      ),
      '{movements,1,movementReference}', '"movement-reference-3201"'::jsonb
    )::text from released_payments
      where attempt_id = '42000000-0000-4000-8000-000000003202'),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'
  ),
  '23505', null,
  'an authorization identity cannot be replayed as a release on another attempt'
);
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    '42000000-0000-4000-8000-000000003202',
    (select snapshot::text from released_payments where attempt_id = '42000000-0000-4000-8000-000000003202'),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'
  ),
  '23505', null,
  'one external release identity cannot mark two attempts released'
);
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    '42000000-0000-4000-8000-000000003201',
    (select (snapshot - 'release' || jsonb_build_object('release', null, 'movements', jsonb_build_array(snapshot -> 'movements' -> 0)))::text
      from released_payments where attempt_id = '42000000-0000-4000-8000-000000003201'),
    '{"provider":"test-payments","environment":"test","merchantId":"merchant-32","terminalId":"terminal-32"}'
  ),
  'RC409', null,
  'a released snapshot cannot be overwritten by stale authorization-only evidence'
);
select public.mark_booking_request_reconciliation_required(
  '42000000-0000-4000-8000-000000003201'
);
reset role;
select is(
  (select state from public.booking_request_submission_attempts
    where id = '42000000-0000-4000-8000-000000003201'),
  'released',
  'a reconciliation marker cannot regress a successful release'
);

delete from public.booking_request_provider_operation_identities
where attempt_id in (
  '42000000-0000-4000-8000-000000003201',
  '42000000-0000-4000-8000-000000003202'
);
delete from public.booking_request_submission_attempts
where id in (
  '42000000-0000-4000-8000-000000003201',
  '42000000-0000-4000-8000-000000003202'
);
select results_eq(
  $$select result -> 0 ->> 'customerName',
      (result -> 0 ->> 'partySize')::integer,
      result -> 0 ->> 'bookingNote'
    from owner_projection$$,
  $$values ('Ava Hassan'::text, 4::integer, 'Please prepare the garden seating.'::text)$$,
  'the owner projection contains only the required Customer request details'
);

select throws_ok(
  $$update public.booking_snapshots set quote_payload = '{}'::jsonb$$,
  'RC204', null,
  'a Booking Snapshot cannot be changed after submission'
);

select * from finish();
rollback;
