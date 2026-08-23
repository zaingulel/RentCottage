begin;

select plan(277);

select has_function(
  'public', 'prepare_booking_request_submission', array['uuid', 'uuid', 'jsonb'],
  'Booking Request submission claims one durable attempt before payment'
);
select ok(
  has_function_privilege('service_role',
    'public.claim_booking_request_action(uuid,uuid,text,text,text)', 'execute')
  and not has_function_privilege('anon',
    'public.claim_booking_request_action(uuid,uuid,text,text,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.claim_booking_request_action(uuid,uuid,text,text,text)', 'execute'),
  'only the service role can claim an actor-authorized lifecycle action'
);
select ok(
  has_function_privilege('service_role',
    'public.claim_booking_request_expiry(uuid)', 'execute')
  and not has_function_privilege('anon',
    'public.claim_booking_request_expiry(uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'public.claim_booking_request_expiry(uuid)', 'execute'),
  'only the service role can claim an internal Booking Request expiry'
);
select ok(
  has_function_privilege('service_role',
    'public.claim_due_booking_request_releases(integer)', 'execute')
  and not has_function_privilege('anon',
    'public.claim_due_booking_request_releases(integer)', 'execute')
  and not has_function_privilege('authenticated',
    'public.claim_due_booking_request_releases(integer)', 'execute'),
  'only the service role can run the bounded lifecycle drain'
);
select ok(
  has_function_privilege('service_role',
    'public.save_booking_request_release_snapshot(uuid,bigint,uuid,jsonb,jsonb)', 'execute')
  and not has_function_privilege('anon',
    'public.save_booking_request_release_snapshot(uuid,bigint,uuid,jsonb,jsonb)', 'execute')
  and not has_function_privilege('authenticated',
    'public.save_booking_request_release_snapshot(uuid,bigint,uuid,jsonb,jsonb)', 'execute'),
  'only the service role can save lifecycle payment-release evidence'
);
select ok(
  has_function_privilege('service_role',
    'public.finalize_booking_request_release(uuid,bigint,uuid)', 'execute')
  and not has_function_privilege('anon',
    'public.finalize_booking_request_release(uuid,bigint,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'public.finalize_booking_request_release(uuid,bigint,uuid)', 'execute'),
  'only the service role can finalize a Booking Request release'
);
select has_column(
  'public', 'booking_request_submission_attempts', 'intent_dedupe_active',
  'only active Booking Request intents participate in submission deduplication'
);
select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.booking_request_release_operations'::regclass),
  'the release operation ledger has row-level security enabled'
);
select ok(
  not has_table_privilege(
    'anon', 'public.booking_request_release_operations', 'select'
  )
  and not has_table_privilege(
    'anon', 'public.booking_request_release_operations', 'insert'
  )
  and not has_table_privilege(
    'anon', 'public.booking_request_release_operations', 'update'
  )
  and not has_table_privilege(
    'anon', 'public.booking_request_release_operations', 'delete'
  )
  and not has_table_privilege(
    'authenticated', 'public.booking_request_release_operations', 'select'
  )
  and not has_table_privilege(
    'authenticated', 'public.booking_request_release_operations', 'insert'
  )
  and not has_table_privilege(
    'authenticated', 'public.booking_request_release_operations', 'update'
  )
  and not has_table_privilege(
    'authenticated', 'public.booking_request_release_operations', 'delete'
  )
  and not has_table_privilege('service_role',
    'public.booking_request_release_operations', 'select')
  and not has_table_privilege('service_role',
    'public.booking_request_release_operations', 'insert'),
  'no application role has direct release-ledger access'
);
select is(
  (select count(*)::integer from pg_constraint
    where conrelid = 'public.booking_request_release_operations'::regclass
      and contype = 'f'
      and array_length(conkey, 1) = 2),
  2,
  'the release ledger is composite-linked to its work, attempt, and lifecycle'
);
select has_function(
  'public', 'execute_simulated_payment_provider_operation',
  array['jsonb', 'text'],
  'the fictional provider executes through a durable PostgreSQL ledger'
);
select has_function(
  'public', 'query_simulated_payment_provider_operation',
  array['jsonb', 'text', 'text', 'text'],
  'the fictional provider reconciles through the same durable ledger'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.execute_simulated_payment_provider_operation(jsonb,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.execute_simulated_payment_provider_operation(jsonb,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.execute_simulated_payment_provider_operation(jsonb,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.expire_booking_request_authorization_claims()',
    'execute'
  )
  and not has_function_privilege(
    'anon', 'public.expire_booking_request_authorization_claims()', 'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.expire_booking_request_authorization_claims()',
    'execute'
  ),
  'only the service role can execute a fictional provider operation'
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
      ('authorized'::text, true, true, false, false),
      ('releasing'::text, true, true, false, false),
      ('released'::text, false, false, true, false),
      ('expired'::text, false, false, true, false),
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
      ('expired', 'authorized', true, null),
      ('converted', 'reconciliation_required', true, null)
    ) cases(current_state, next_attempt_state, has_request, release_status)$$,
  $$values ('authorized'::text), ('not_started'), ('failed'), ('releasing'),
      ('reconciliation_required'), ('released'), ('expired'), ('converted')$$,
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
      'public.simulated_payment_provider_operations'::regclass,
      'public.booking_snapshots'::regclass,
      'public.booking_requests'::regclass,
      'public.owner_request_notifications'::regclass,
      'public.booking_request_release_work'::regclass,
      'public.booking_request_release_operations'::regclass,
      'public.booking_request_status_notifications'::regclass
    ) and relations.relrowsecurity
  ),
  13::bigint,
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
      ('public.simulated_payment_provider_operations'),
      ('public.booking_snapshots'),
      ('public.booking_requests'),
      ('public.owner_request_notifications'),
      ('public.booking_request_release_work'),
      ('public.booking_request_release_operations'),
      ('public.booking_request_status_notifications')
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
  'termsVersion', 'fictional-local-test-2026-08-22-v1',
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
      'marketplaceTermsAcceptance', 'I accept the marketplace booking terms. (fictional-local-test-2026-08-22-v1)',
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
  and not public.booking_request_content_is_safe('name @ example . com')
  and not public.booking_request_content_is_safe('name @ example . uk')
  and not public.booking_request_content_is_safe('name at example dot uk')
  and not public.booking_request_content_is_safe('z a i n at g m a i l dot c o m')
  and not public.booking_request_content_is_safe('example.dev')
  and not public.booking_request_content_is_safe('0a7a5a0a1a2a3a4a5a6')
  and not public.booking_request_content_is_safe('0a7b5c0d1e2f3g4h5i6')
  and not public.booking_request_content_is_safe('0a 7b 5c 0d 1e 2f 3g 4h 5i 6')
  and not public.booking_request_content_is_safe('٠a ٧b ٥c ٠d ١e ٢f ٣g ٤h ٥i ٦')
  and not public.booking_request_content_is_safe('۰a ۷b ۵c ۰d ۱e ۲f ۳g ۴h ۵i ۶')
  and not public.booking_request_content_is_safe('०७५०१२३४५६७')
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
select ok(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113293',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"name @ example . com"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113292',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"0a7a5a0a1a2a3a4a5a6"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113286',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"z a i n at g m a i l dot c o m"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113285',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"०७५०१२३४५६७"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113289',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"0a 7b 5c 0d 1e 2f 3g 4h 5i 6"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113288',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"٠a ٧b ٥c ٠d ١e ٢f ٣g ٤h ٥i ٦"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113287',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"۰a ۷b ۵c ۰d ۱e ۲f ۳g ۴h ۵i ۶"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113291',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"name at example dot uk"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113290',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"0a7b5c0d1e2f3g4h5i6"'::jsonb)
  ) ->> 'status' = 'invalid',
  'TLD-independent email and mixed-letter phone obfuscation cannot reach the owner projection'
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

savepoint authorization_null_input_audit;
create temporary table authorization_null_baseline as
select to_jsonb(attempts) as attempt_record,
  (select count(*)::integer from public.booking_request_authorization_claims)
    as claim_count,
  (select count(*)::integer
    from public.booking_request_authorization_reconciliation_outbox) as outbox_count,
  (select count(*)::integer from public.simulated_payment_provider_operations)
    as provider_count
from public.booking_request_submission_attempts attempts
where attempts.id = (
  select (result ->> 'attemptId')::uuid from prepared_submission
);
grant select on authorization_null_baseline to service_role;
create temporary table authorization_null_results (
  case_name text,
  status text
);
grant select, insert on authorization_null_results to service_role;
set local role service_role;
insert into authorization_null_results
select required_key,
  public.begin_booking_request_authorization_claim(
    (select (result ->> 'attemptId')::uuid from prepared_submission),
    jsonb_set(snapshot, array['authorization', required_key], 'null'::jsonb),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status'
from pending_authorization_payment
cross join (values
  ('paymentLifecycleId'), ('kind'), ('logicalOperationId'), ('attemptId'),
  ('status'), ('amountFils'), ('reconciliationRequired'), ('retrySafe')
) required(required_key);
select results_eq(
  $$select count(*)::integer, bool_and(status = 'invalid')
    from authorization_null_results$$,
  $$values (8::integer, true)$$,
  'the authorization issuer rejects every required pending-operation binding when JSON null'
);
reset role;
truncate authorization_null_results;
set local role service_role;
insert into authorization_null_results values
  ('sql-null-snapshot', public.begin_booking_request_authorization_claim(
    (select (result ->> 'attemptId')::uuid from prepared_submission),
    null,
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status'),
  ('json-null-snapshot', public.begin_booking_request_authorization_claim(
    (select (result ->> 'attemptId')::uuid from prepared_submission),
    'null'::jsonb,
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status'),
  ('json-null-authorization', public.begin_booking_request_authorization_claim(
    (select (result ->> 'attemptId')::uuid from prepared_submission),
    jsonb_set((select snapshot from pending_authorization_payment),
      '{authorization}', 'null'::jsonb),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status'),
  ('json-null-provider', public.begin_booking_request_authorization_claim(
    (select (result ->> 'attemptId')::uuid from prepared_submission),
    (select snapshot from pending_authorization_payment), 'null'::jsonb
  ) ->> 'status'),
  ('json-null-provider-environment',
    public.begin_booking_request_authorization_claim(
      (select (result ->> 'attemptId')::uuid from prepared_submission),
      (select snapshot from pending_authorization_payment),
      '{"provider":"fictional-payments","environment":null,"merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    ) ->> 'status');
select results_eq(
  $$select count(*)::integer, bool_and(status = 'invalid')
    from authorization_null_results$$,
  $$values (5::integer, true)$$,
  'the authorization issuer rejects null or non-object snapshot and provider inputs'
);
reset role;
select results_eq(
  $$select to_jsonb(attempts) = baseline.attempt_record,
      (select count(*)::integer from public.booking_request_authorization_claims)
        = baseline.claim_count,
      (select count(*)::integer
        from public.booking_request_authorization_reconciliation_outbox)
        = baseline.outbox_count,
      (select count(*)::integer from public.simulated_payment_provider_operations)
        = baseline.provider_count
    from authorization_null_baseline baseline
    join public.booking_request_submission_attempts attempts
      on attempts.id = (select (result ->> 'attemptId')::uuid from prepared_submission)$$,
  $$values (true, true, true, true)$$,
  'invalid authorization inputs create no claim, outbox, provider row, or attempt mutation'
);
set local role service_role;
create temporary table authorization_after_null_audit as
select public.begin_booking_request_authorization_claim(
  (select (result ->> 'attemptId')::uuid from prepared_submission),
  (select snapshot from pending_authorization_payment),
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as result;
select is(
  (select result -> 'executionPermit' ->> 'purpose'
    from authorization_after_null_audit),
  'booking-request-authorization',
  'authorization-purpose issuance remains available after fail-closed null attempts'
);
reset role;
rollback to savepoint authorization_null_input_audit;

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
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
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
select is(
  (select lease_expires_at - updated_at
    from public.booking_request_authorization_reconciliation_outbox),
  interval '30 seconds',
  'a reconciliation worker owns an exact thirty-second technical lease'
);
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
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
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
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
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
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'the internal Authorization Claim and pending Payment Lifecycle are created atomically'
);
reset role;
select is(
  (select reconciliation_expires_at - created_at
    from public.booking_request_authorization_claims),
  interval '5 minutes',
  'unfinished pre-finalization work has an exact five-minute recovery window'
);
create temporary table simulated_authorization_operation as
select jsonb_build_object(
  'providerIdentity', jsonb_build_object(
    'provider', claims.provider,
    'environment', claims.environment,
    'merchantId', claims.merchant_id,
    'terminalId', claims.terminal_id
  ),
  'permitPurpose', 'booking-request-authorization',
  'idempotencyKey', claims.provider_idempotency_key,
  'notAfter', to_char(claims.not_after at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'requestFingerprint', repeat('a', 64),
  'paymentLifecycleId', claims.payment_lifecycle_id,
  'logicalOperationId', claims.logical_operation_id,
  'physicalAttemptId', claims.physical_attempt_id,
  'operationKind', 'authorization',
  'amountFils', claims.amount_fils,
  'currency', claims.currency,
  'claimId', claims.id,
  'claimGeneration', claims.generation,
  'stateRevision', null,
  'cleanupAttemptId', null,
  'workId', null,
  'leaseGeneration', null,
  'leaseToken', null,
  'operationId', null,
  'operationGeneration', null
) as operation
from public.booking_request_authorization_claims claims;
grant select on simulated_authorization_operation to service_role;

savepoint provider_query_null_input_audit;
create temporary table provider_query_null_baseline as
select to_jsonb(claims) as claim_record,
  (select count(*)::integer from public.simulated_payment_provider_operations)
    as provider_count
from public.booking_request_authorization_claims claims;
create function pg_temp.assert_null_query_bindings_rejected(target_operation jsonb)
returns void
language plpgsql
as $$
declare required_key text;
declare invalid_operation jsonb;
begin
  foreach required_key in array array[
    'provider', 'environment', 'merchantId', 'terminalId'
  ] loop
    invalid_operation := jsonb_set(
      target_operation, array['providerIdentity', required_key], 'null'::jsonb
    );
    begin
      perform public.query_simulated_payment_provider_operation(
        invalid_operation, null, null, 'succeeded'
      );
      raise exception 'provider query accepted null binding %', required_key
        using errcode = 'P0001';
    exception when sqlstate '22023' or sqlstate 'RC409' then null;
    end;
  end loop;
  foreach required_key in array array[
    'requestFingerprint', 'paymentLifecycleId', 'logicalOperationId',
    'physicalAttemptId', 'operationKind', 'amountFils', 'currency'
  ] loop
    invalid_operation := jsonb_set(
      target_operation, array[required_key], 'null'::jsonb
    );
    begin
      perform public.query_simulated_payment_provider_operation(
        invalid_operation, null, null, 'succeeded'
      );
      raise exception 'provider query accepted null binding %', required_key
        using errcode = 'P0001';
    exception when sqlstate '22023' or sqlstate 'RC409' then null;
    end;
  end loop;
end;
$$;
create function pg_temp.assert_query_objects_rejected(target_operation jsonb)
returns void
language plpgsql
as $$
begin
  begin
    perform public.query_simulated_payment_provider_operation(
      null, null, null, 'succeeded'
    );
    raise exception 'provider query accepted SQL null operation' using errcode='P0001';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.query_simulated_payment_provider_operation(
      'null'::jsonb, null, null, 'succeeded'
    );
    raise exception 'provider query accepted JSON null operation' using errcode='P0001';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.query_simulated_payment_provider_operation(
      jsonb_set(target_operation, '{providerIdentity}', 'null'::jsonb),
      null, null, 'succeeded'
    );
    raise exception 'provider query accepted JSON null provider' using errcode='P0001';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.query_simulated_payment_provider_operation(
      target_operation, null, null, null
    );
    raise exception 'provider query accepted null outcome' using errcode='P0001';
  exception when sqlstate '22023' then null;
  end;
end;
$$;
grant select on provider_query_null_baseline to service_role;
set local role service_role;
select lives_ok(
  format(
    'select pg_temp.assert_null_query_bindings_rejected(%L::jsonb)',
    (select operation::text from simulated_authorization_operation)
  ),
  'provider query rejects every required authorization binding when JSON null'
);
select lives_ok(
  format(
    'select pg_temp.assert_query_objects_rejected(%L::jsonb)',
    (select operation::text from simulated_authorization_operation)
  ),
  'provider query rejects null operation, provider object, and outcome inputs'
);
reset role;
select results_eq(
  $$select to_jsonb(claims) = baseline.claim_record,
      (select count(*)::integer from public.simulated_payment_provider_operations)
        = baseline.provider_count
    from provider_query_null_baseline baseline
    join public.booking_request_authorization_claims claims
      on claims.id = (baseline.claim_record ->> 'id')::uuid$$,
  $$values (true, true)$$,
  'invalid provider queries mutate neither authorization state nor provider ledger'
);
rollback to savepoint provider_query_null_input_audit;

create temporary table simulated_authorization_results (result jsonb);
grant select, insert on simulated_authorization_results to service_role;
set local role service_role;
insert into simulated_authorization_results
select public.execute_simulated_payment_provider_operation(
  (select operation from simulated_authorization_operation), 'indeterminate'
);
insert into simulated_authorization_results
select public.execute_simulated_payment_provider_operation(
  (select operation from simulated_authorization_operation), 'succeeded'
);
select results_eq(
  $$select count(*)::integer, count(distinct result ->> 'providerRequestId')::integer,
      count(distinct result ->> 'providerReference')::integer
    from simulated_authorization_results$$,
  $$values (2::integer, 1::integer, 1::integer)$$,
  'fresh callers receive the same fictional provider identity for one idempotency key'
);
reset role;
select results_eq(
  $$select count(*)::integer, sum(physical_execution_count)::integer
    from public.simulated_payment_provider_operations$$,
  $$values (1::integer, 1::integer)$$,
  'the durable ledger records exactly one physical fictional authorization'
);
set local role service_role;
select is(
  public.query_simulated_payment_provider_operation(
    (select operation from simulated_authorization_operation),
    (select result ->> 'providerRequestId'
      from simulated_authorization_results limit 1),
    (select result ->> 'providerReference'
      from simulated_authorization_results limit 1),
    'succeeded'
  ) ->> 'outcome',
  'succeeded',
  'reconciliation resolves the same physical fictional authorization'
);
select is(
  public.query_simulated_payment_provider_operation(
    (select operation from simulated_authorization_operation),
    null,
    null,
    'succeeded'
  ) ->> 'outcome',
  'succeeded',
  'reconciliation discovers the immutable operation when a crash lost provider identifiers'
);
select is(
  public.query_simulated_payment_provider_operation(
    jsonb_set(
      (select operation from simulated_authorization_operation),
      '{requestFingerprint}', to_jsonb(repeat('c', 64))
    ),
    null,
    null,
    'succeeded'
  ) ->> 'outcome',
  'not-executed',
  'reconciliation reports authoritative ledger absence without inventing provider identity'
);
select throws_ok(
  format(
    'select public.execute_simulated_payment_provider_operation(%L::jsonb, %L)',
    (select jsonb_set(operation, '{requestFingerprint}', to_jsonb(repeat('b', 64)))::text
      from simulated_authorization_operation),
    'succeeded'
  ),
  'RC409', null,
  'reusing an idempotency key with a different request fingerprint fails closed'
);
reset role;
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'simulated_payment_provider_operations'
      and column_name in (
        'customer_user_id', 'customer_name', 'phone', 'booking_note',
        'profile_id', 'public_slug', 'quote_payload', 'intent_payload'
      )
  ),
  'the fictional provider ledger has no personal or cottage data columns'
);
set local role service_role;
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
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
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

savepoint authorized_after_cutoff_releases;
update public.booking_request_submission_attempts
set quote_payload = jsonb_set(
  quote_payload,
  '{items,0,startsAt}',
  to_jsonb(to_char(
    (clock_timestamp() + interval '5 hours') at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ))
);
update public.booking_request_authorization_claims
set reconciliation_expires_at = clock_timestamp() - interval '1 second';
update public.booking_request_authorization_reconciliation_outbox
set lease_token = gen_random_uuid(),
  lease_expires_at = clock_timestamp() + interval '30 seconds';
create temporary table cutoff_stale_lease as
select claims.id as claim_id, claims.generation, claims.state_revision,
  outbox.lease_token
from public.booking_request_authorization_claims claims
join public.booking_request_authorization_reconciliation_outbox outbox
  on outbox.claim_id = claims.id;
grant select on cutoff_stale_lease to service_role;
set local role service_role;
select lives_ok(
  $$select public.expire_booking_request_authorization_claims()$$,
  'expiry does not retry illegal finalization after the six-hour cut-off'
);
reset role;
select results_eq(
  $$select attempts.state, claims.state::text, occupancies.active, outbox.state,
      attempts.payment_snapshot -> 'release' ->> 'status',
      outbox.lease_token is null,
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('releasing'::text, 'releasing'::text, true, 'pending'::text,
    'pending'::text, true, 0::integer, 0::integer)$$,
  'cut-off expiry durably prepares a release while retaining inventory and product absence'
);
create temporary table cutoff_release_work as
select public.dequeue_booking_request_authorization_reconciliation() as result;
grant select on cutoff_release_work to service_role;
set local role service_role;
select results_eq(
  $$select result ->> 'status', result ->> 'operationKind',
      result ->> 'recoveryAction'
    from cutoff_release_work$$,
  $$values ('work'::text, 'release'::text, 'execute'::text)$$,
  'the independent worker discovers the cut-off release instead of finalization'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    (select claim_id from cutoff_stale_lease),
    (select generation from cutoff_stale_lease),
    (select state_revision from cutoff_stale_lease),
    (select lease_token from cutoff_stale_lease),
    (select snapshot from authorized_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status',
  'conflict',
  'a stale pre-cut-off lease cannot overwrite the durable release transition'
);
reset role;
rollback to savepoint authorized_after_cutoff_releases;

savepoint expired_pre_finalization_availability;
update public.booking_request_authorization_claims
set reconciliation_expires_at = clock_timestamp() - interval '1 second';
update public.booking_request_authorization_reconciliation_outbox
set lease_token = gen_random_uuid(),
  lease_expires_at = clock_timestamp() + interval '30 seconds';
create temporary table expiry_stale_lease as
select claims.id as claim_id, claims.generation, claims.state_revision,
  outbox.lease_token
from public.booking_request_authorization_claims claims
join public.booking_request_authorization_reconciliation_outbox outbox
  on outbox.claim_id = claims.id;
grant select on expiry_stale_lease to service_role;
set local role service_role;
select is(
  public.expire_booking_request_authorization_claims(),
  1,
  'the expiry boundary reconciles a succeeded durable authorization without the recovery runner'
);
reset role;
select is(
  public.public_cottage_unit_is_available(
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003202', '2099-08-21'
  ),
  false,
  'a reconciled authorization keeps inventory reserved through its Pending Hold'
);
select results_eq(
  $$select attempts.state, claims.state::text, occupancies.active, outbox.state,
      outbox.lease_token is null, outbox.lease_expires_at is null,
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('finalized'::text, 'converted'::text, false, 'complete'::text,
    true, true, 1::integer, 1::integer)$$,
  'expiry finalizes exactly one authorized Request and Pending Hold while invalidating the stale lease'
);
set local role service_role;
select is(
  public.complete_booking_request_authorization_reconciliation(
    (select claim_id from expiry_stale_lease),
    (select generation from expiry_stale_lease),
    (select state_revision from expiry_stale_lease),
    (select lease_token from expiry_stale_lease),
    (select snapshot from authorized_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status',
  'conflict',
  'a stale recovery lease cannot overwrite ledger-driven expiry finalization'
);
reset role;
rollback to savepoint expired_pre_finalization_availability;

savepoint indeterminate_expiry_remains_protected;
delete from public.booking_request_provider_operation_identities;
update public.simulated_payment_provider_operations
set current_outcome = 'indeterminate';
update public.booking_request_submission_attempts
set state = 'reconciliation_required',
  payment_snapshot = (select snapshot from pending_authorization_payment),
  authorization_provider_request_id = null,
  authorization_provider_reference = null,
  authorization_movement_reference = null;
update public.booking_request_authorization_claims
set state = 'reconciliation_required',
  reconciliation_expires_at = clock_timestamp() - interval '1 second',
  state_revision = state_revision + 1;
update public.booking_request_authorization_reconciliation_outbox
set state = 'pending', observed_state_revision = (
    select state_revision from public.booking_request_authorization_claims
  ),
  lease_token = gen_random_uuid(),
  lease_expires_at = clock_timestamp() + interval '30 seconds';
set local role service_role;
select is(
  public.expire_booking_request_authorization_claims(),
  0,
  'expiry does not orphan an indeterminate durable provider movement'
);
reset role;
select results_eq(
  $$select claims.state::text, occupancies.active, outbox.state,
      outbox.lease_token is not null,
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)
    from public.booking_request_authorization_claims claims
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('reconciliation_required'::text, true, 'pending'::text,
    true, 0::integer, 0::integer)$$,
  'indeterminate ledger evidence remains recoverable and fail-closed'
);
rollback to savepoint indeterminate_expiry_remains_protected;

savepoint absent_execution_expires;
delete from public.booking_request_provider_operation_identities;
delete from public.simulated_payment_provider_operations;
update public.booking_request_submission_attempts
set state = 'reconciliation_required',
  payment_snapshot = (select snapshot from pending_authorization_payment),
  authorization_provider_request_id = null,
  authorization_provider_reference = null,
  authorization_movement_reference = null;
update public.booking_request_authorization_claims
set state = 'reconciliation_required',
  reconciliation_expires_at = clock_timestamp() - interval '1 second',
  state_revision = state_revision + 1;
update public.booking_request_authorization_reconciliation_outbox
set state = 'pending', observed_state_revision = (
    select state_revision from public.booking_request_authorization_claims
  ), lease_token = null, lease_expires_at = null;
set local role service_role;
select is(
  public.expire_booking_request_authorization_claims(),
  1,
  'authoritative ledger absence terminalizes an unexecuted expired claim'
);
reset role;
select results_eq(
  $$select attempts.state, claims.state::text, occupancies.active, outbox.state,
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('expired'::text, 'expired'::text, false, 'complete'::text,
    0::integer, 0::integer)$$,
  'an evidenced unexecuted expiry frees inventory without creating product records'
);
create temporary table expired_reconciliation_baseline on commit drop as
select attempts.id as attempt_id,
    attempts.state as attempt_state,
    attempts.payment_snapshot,
    attempts.updated_at as attempt_updated_at,
    claims.state as claim_state,
    claims.state_revision as claim_state_revision,
    claims.updated_at as claim_updated_at,
    outbox.state as outbox_state,
    outbox.observed_state_revision,
    outbox.lease_token,
    outbox.lease_expires_at,
    outbox.updated_at as outbox_updated_at
  from public.booking_request_submission_attempts attempts
  join public.booking_request_authorization_claims claims
    on claims.attempt_id = attempts.id
  join public.booking_request_authorization_reconciliation_outbox outbox
    on outbox.claim_id = claims.id;
grant select on expired_reconciliation_baseline to service_role;
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    (select attempt_id from expired_reconciliation_baseline),
    (select payment_snapshot::text from expired_reconciliation_baseline),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'RC409', null,
  'an identical stale reconciliation snapshot cannot regress an expired attempt'
);
select public.mark_booking_request_reconciliation_required(
  (select attempt_id from expired_reconciliation_baseline)
);
reset role;
select results_eq(
  $$select attempts.state, attempts.payment_snapshot, attempts.updated_at,
      claims.state, claims.state_revision, claims.updated_at,
      outbox.state, outbox.observed_state_revision,
      outbox.lease_token, outbox.lease_expires_at, outbox.updated_at
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$select attempt_state, payment_snapshot, attempt_updated_at,
      claim_state, claim_state_revision, claim_updated_at,
      outbox_state, observed_state_revision,
      lease_token, lease_expires_at, outbox_updated_at
    from expired_reconciliation_baseline$$,
  'stale same-snapshot save and marker preserve expired payment, claim, audit, and outbox state'
);
select is(
  public.public_cottage_unit_is_available(
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003202', '2099-08-21'
  ),
  true,
  'authoritative absence restores public availability without a recovery runner'
);
rollback to savepoint absent_execution_expires;

savepoint authorized_finalization_recovery;
create temporary table authorized_finalization_work (result jsonb);
grant select, insert on authorized_finalization_work to service_role;
set local role service_role;
insert into authorized_finalization_work
select public.dequeue_booking_request_authorization_reconciliation();
select results_eq(
  $$select result ->> 'status', result ->> 'operationKind',
      result -> 'paymentSnapshot' = (select snapshot from authorized_payment)
    from authorized_finalization_work$$,
  $$values ('work'::text, 'finalization'::text, true)$$,
  'an authorized claim remains recoverable through the independent outbox'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from authorized_finalization_work))::uuid,
    ((select result ->> 'generation' from authorized_finalization_work))::integer,
    ((select result ->> 'stateRevision' from authorized_finalization_work))::bigint,
    ((select result ->> 'leaseToken' from authorized_finalization_work))::uuid,
    (select snapshot from authorized_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'claimState',
  'converted',
  'authorized outbox recovery finalizes the request instead of reauthorizing'
);
reset role;
select results_eq(
  $$select count(*)::integer,
      (select count(*)::integer from public.cottage_booking_period_commitments),
      min(response_deadline - created_at)
    from public.booking_requests$$,
  $$values (1::integer, 1::integer, interval '4 hours')$$,
  'recovered finalization creates one Pending Hold for the four-hour owner deadline'
);
rollback to savepoint authorized_finalization_recovery;

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

savepoint cleanup_issuer_null_input_audit;
create temporary table cleanup_issuer_null_baseline as
select to_jsonb(attempts) as attempt_record, to_jsonb(claims) as claim_record,
  (select count(*)::integer
    from public.booking_request_authorization_reconciliation_outbox) as outbox_count,
  (select count(*)::integer from public.simulated_payment_provider_operations)
    as provider_count,
  (select count(*)::integer from public.booking_request_release_work) as work_count
from public.booking_request_submission_attempts attempts
join public.booking_request_authorization_claims claims
  on claims.attempt_id = attempts.id
where attempts.id = (
  select (result ->> 'attemptId')::uuid from prepared_submission
);
create function pg_temp.assert_null_cleanup_bindings_rejected(
  target_attempt_id uuid,
  target_snapshot jsonb,
  target_provider jsonb
)
returns void
language plpgsql
as $$
declare required_key text;
declare invalid_snapshot jsonb;
declare invalid_provider jsonb;
begin
  foreach required_key in array array[
    'paymentLifecycleId', 'kind', 'logicalOperationId', 'attemptId',
    'status', 'amountFils', 'reconciliationRequired', 'retrySafe'
  ] loop
    invalid_snapshot := jsonb_set(
      target_snapshot, array['release', required_key], 'null'::jsonb
    );
    begin
      perform public.begin_booking_request_submission_cleanup_release(
        target_attempt_id, invalid_snapshot, target_provider
      );
      raise exception 'cleanup issuer accepted null binding %', required_key
        using errcode = 'P0001';
    exception when sqlstate 'RC409' then null;
    end;
  end loop;
  foreach required_key in array array[
    'provider', 'environment', 'merchantId', 'terminalId'
  ] loop
    invalid_provider := jsonb_set(
      target_provider, array[required_key], 'null'::jsonb
    );
    begin
      perform public.begin_booking_request_submission_cleanup_release(
        target_attempt_id, target_snapshot, invalid_provider
      );
      raise exception 'cleanup issuer accepted null provider %', required_key
        using errcode = 'P0001';
    exception when sqlstate 'RC409' then null;
    end;
  end loop;
end;
$$;
create function pg_temp.assert_cleanup_objects_rejected(
  target_attempt_id uuid,
  target_snapshot jsonb,
  target_provider jsonb
)
returns void
language plpgsql
as $$
begin
  begin
    perform public.begin_booking_request_submission_cleanup_release(
      null, target_snapshot, target_provider
    );
    raise exception 'cleanup issuer accepted null attempt' using errcode='P0001';
  exception when sqlstate 'RC409' then null;
  end;
  begin
    perform public.begin_booking_request_submission_cleanup_release(
      target_attempt_id, 'null'::jsonb, target_provider
    );
    raise exception 'cleanup issuer accepted JSON null snapshot' using errcode='P0001';
  exception when sqlstate 'RC409' then null;
  end;
  begin
    perform public.begin_booking_request_submission_cleanup_release(
      target_attempt_id,
      jsonb_set(target_snapshot, '{release}', 'null'::jsonb), target_provider
    );
    raise exception 'cleanup issuer accepted JSON null release' using errcode='P0001';
  exception when sqlstate 'RC409' then null;
  end;
  begin
    perform public.begin_booking_request_submission_cleanup_release(
      target_attempt_id,
      jsonb_set(target_snapshot, '{authorization}', 'null'::jsonb), target_provider
    );
    raise exception 'cleanup issuer accepted JSON null authorization' using errcode='P0001';
  exception when sqlstate 'RC409' then null;
  end;
  begin
    perform public.begin_booking_request_submission_cleanup_release(
      target_attempt_id, target_snapshot, 'null'::jsonb
    );
    raise exception 'cleanup issuer accepted JSON null provider' using errcode='P0001';
  exception when sqlstate 'RC409' then null;
  end;
end;
$$;
grant select on cleanup_issuer_null_baseline to service_role;
set local role service_role;
select lives_ok(
  format(
    'select pg_temp.assert_null_cleanup_bindings_rejected(%L::uuid,%L::jsonb,%L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from pending_release_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'cleanup issuer rejects every required release and provider binding when JSON null'
);
select lives_ok(
  format(
    'select pg_temp.assert_cleanup_objects_rejected(%L::uuid,%L::jsonb,%L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from pending_release_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'cleanup issuer rejects null attempt, snapshot, payment operation, and provider objects'
);
reset role;
select results_eq(
  $$select to_jsonb(attempts) = baseline.attempt_record,
      to_jsonb(claims) = baseline.claim_record,
      (select count(*)::integer
        from public.booking_request_authorization_reconciliation_outbox)
        = baseline.outbox_count,
      (select count(*)::integer from public.simulated_payment_provider_operations)
        = baseline.provider_count,
      (select count(*)::integer from public.booking_request_release_work)
        = baseline.work_count
    from cleanup_issuer_null_baseline baseline
    join public.booking_request_submission_attempts attempts
      on attempts.id = (baseline.attempt_record ->> 'id')::uuid
    join public.booking_request_authorization_claims claims
      on claims.id = (baseline.claim_record ->> 'id')::uuid$$,
  $$values (true, true, true, true, true)$$,
  'invalid cleanup inputs mutate no attempt, claim, outbox, provider, or release work'
);
set local role service_role;
create temporary table cleanup_release_permit as
select public.begin_booking_request_submission_cleanup_release(
  ((select result ->> 'attemptId' from prepared_submission))::uuid,
  (select snapshot from pending_release_payment),
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as result;
grant select on cleanup_release_permit to service_role;
select is(
  (select result -> 'executionPermit' ->> 'purpose' from cleanup_release_permit),
  'booking-request-submission-cleanup',
  'a release that is about to execute is durably persisted with its cleanup permit'
);
create temporary table reissued_cleanup_release_permit as
select public.begin_booking_request_submission_cleanup_release(
  ((select result ->> 'attemptId' from prepared_submission))::uuid,
  (select snapshot from pending_release_payment),
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as result;
select is(
  (select result -> 'executionPermit' from reissued_cleanup_release_permit),
  (select result -> 'executionPermit' from cleanup_release_permit),
  'reissuing the same pending cleanup returns the byte-equivalent permit window'
);
reset role;
savepoint absent_release_evidence_expiry;
update public.booking_request_authorization_claims
set reconciliation_expires_at = clock_timestamp() - interval '1 second';
set local role service_role;
select is(
  public.expire_booking_request_authorization_claims(),
  0,
  'expiry retains a release whose durable provider execution is still absent'
);
reset role;
select results_eq(
  $$select attempts.state, claims.state::text, occupancies.active, outbox.state,
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('releasing'::text, 'releasing'::text, true, 'pending'::text,
    0::integer, 0::integer)$$,
  'absent release evidence keeps inventory and reconciliation work active'
);
rollback to savepoint absent_release_evidence_expiry;

savepoint failed_release_recovery;
create temporary table failed_release_operation as
select jsonb_build_object(
  'providerIdentity', jsonb_build_object(
    'provider', claims.provider,
    'environment', claims.environment,
    'merchantId', claims.merchant_id,
    'terminalId', claims.terminal_id
  ),
  'permitPurpose', permit.result -> 'executionPermit' ->> 'purpose',
  'idempotencyKey', permit.result -> 'executionPermit' ->> 'idempotencyKey',
  'requestFingerprint', permit.result -> 'executionPermit' ->> 'requestFingerprint',
  'notAfter', permit.result -> 'executionPermit' ->> 'notAfter',
  'paymentLifecycleId', claims.payment_lifecycle_id,
  'logicalOperationId', payments.snapshot -> 'release' ->> 'logicalOperationId',
  'physicalAttemptId', payments.snapshot -> 'release' ->> 'attemptId',
  'operationKind', 'release',
  'amountFils', claims.amount_fils,
  'currency', claims.currency,
  'claimId', permit.result -> 'executionPermit' ->> 'claimId',
  'claimGeneration', (permit.result -> 'executionPermit' ->> 'generation')::integer,
  'stateRevision', (permit.result -> 'executionPermit' ->> 'stateRevision')::bigint,
  'cleanupAttemptId', permit.result -> 'executionPermit' ->> 'attemptId',
  'workId', null, 'leaseGeneration', null, 'leaseToken', null,
  'operationId', null, 'operationGeneration', null
) as operation
from public.booking_request_authorization_claims claims
cross join pending_release_payment payments
cross join cleanup_release_permit permit;
grant select on failed_release_operation to service_role;
create temporary table failed_release_result (result jsonb);
grant select, insert on failed_release_result to service_role;
set local role service_role;
insert into failed_release_result
select public.execute_simulated_payment_provider_operation(
  (select operation from failed_release_operation), 'failed'
);
select results_eq(
  $$select result ->> 'outcome', (result ->> 'retrySafe')::boolean,
      result ? 'movementReference'
    from failed_release_result$$,
  $$values ('failed'::text, true, false)$$,
  'the local provider proves a definitive failed release safe for a fresh attempt'
);
create temporary table failed_release_work as
select public.dequeue_booking_request_authorization_reconciliation() as result;
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from failed_release_work))::uuid,
    ((select result ->> 'generation' from failed_release_work))::integer,
    ((select result ->> 'stateRevision' from failed_release_work))::bigint,
    ((select result ->> 'leaseToken' from failed_release_work))::uuid,
    (select snapshot || jsonb_build_object(
      'release', (snapshot -> 'release') || jsonb_build_object(
        'status', 'failed',
        'providerRequestId', provider.result ->> 'providerRequestId',
        'providerReference', provider.result ->> 'providerReference',
        'movementReference', null,
        'reconciliationRequired', false,
        'retrySafe', true
      )
    )
    from pending_release_payment
    cross join failed_release_result provider),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'claimState',
  'reconciliation_required',
  'a failed release remains active instead of terminalizing its authorization claim'
);
reset role;
select results_eq(
  $$select attempts.state, claims.state::text, occupancies.active, outbox.state,
      attempts.release_provider_request_id,
      count(operations.id) filter (where operations.operation_kind = 'release')::integer,
      count(operations.id) filter (where operations.operation_kind = 'release'
        and operations.current_outcome = 'failed')::integer
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id
    left join public.simulated_payment_provider_operations operations
      on operations.claim_id = claims.id
    group by attempts.state, claims.state, occupancies.active, outbox.state,
      attempts.release_provider_request_id$$,
  $$values ('reconciliation_required'::text, 'reconciliation_required'::text,
    true, 'pending'::text, null::text, 1::integer, 1::integer)$$,
  'failed release evidence is retained without freeing inventory or completing the outbox'
);
set local role service_role;
create temporary table first_release_retry_work as
select public.dequeue_booking_request_authorization_reconciliation() as result;
select results_eq(
  $$select result ->> 'status', result ->> 'operationKind',
      result ->> 'recoveryAction', result ->> 'physicalAttemptId',
      result -> 'paymentSnapshot' -> 'release' ->> 'status'
    from first_release_retry_work$$,
  $$values ('work'::text, 'release'::text, 'execute'::text,
    (select (snapshot -> 'release' ->> 'logicalOperationId') || ':attempt-2'
      from pending_release_payment), 'pending'::text)$$,
  'dequeue durably prepares exactly one fresh physical release attempt before execution'
);
reset role;
update public.booking_request_authorization_reconciliation_outbox
set lease_expires_at = clock_timestamp() - interval '1 second';
set local role service_role;
create temporary table recovered_release_retry_work as
select public.dequeue_booking_request_authorization_reconciliation() as result;
select results_eq(
  $$select recovered.result ->> 'physicalAttemptId',
      recovered.result ->> 'leaseToken' <> original.result ->> 'leaseToken'
    from recovered_release_retry_work recovered
    cross join first_release_retry_work original$$,
  $$values ((select result ->> 'physicalAttemptId' from first_release_retry_work), true)$$,
  'a crashed retry worker receives a new lease for the same persisted physical attempt'
);
create temporary table retry_cleanup_release_permit as
select public.begin_booking_request_submission_cleanup_release(
  ((select result ->> 'attemptId' from prepared_submission))::uuid,
  recovered.result -> 'paymentSnapshot',
  recovered.result -> 'providerIdentity'
) as result
from recovered_release_retry_work recovered;
select results_eq(
  $$select retry.result -> 'executionPermit' ->> 'purpose',
      retry.result -> 'executionPermit' ->> 'stateRevision'
        <> first.result -> 'executionPermit' ->> 'stateRevision',
      retry.result -> 'executionPermit' ->> 'idempotencyKey'
        <> first.result -> 'executionPermit' ->> 'idempotencyKey'
    from retry_cleanup_release_permit retry
    cross join cleanup_release_permit first$$,
  $$values ('booking-request-submission-cleanup'::text, true, true)$$,
  'a distinct cleanup retry receives a new revision-bound provider identity'
);
create temporary table successful_release_retry_result as
select public.execute_simulated_payment_provider_operation(
  jsonb_build_object(
    'providerIdentity', recovered.result -> 'providerIdentity',
    'permitPurpose', permit.result -> 'executionPermit' ->> 'purpose',
    'idempotencyKey', permit.result -> 'executionPermit' ->> 'idempotencyKey',
    'requestFingerprint', permit.result -> 'executionPermit' ->> 'requestFingerprint',
    'notAfter', permit.result -> 'executionPermit' ->> 'notAfter',
    'paymentLifecycleId', recovered.result ->> 'paymentLifecycleId',
    'logicalOperationId', recovered.result ->> 'logicalOperationId',
    'physicalAttemptId', recovered.result ->> 'physicalAttemptId',
    'operationKind', 'release',
    'amountFils', (recovered.result ->> 'amountFils')::bigint,
    'currency', recovered.result ->> 'currency',
    'claimId', permit.result -> 'executionPermit' ->> 'claimId',
    'claimGeneration',
      (permit.result -> 'executionPermit' ->> 'generation')::integer,
    'stateRevision',
      (permit.result -> 'executionPermit' ->> 'stateRevision')::bigint,
    'cleanupAttemptId', permit.result -> 'executionPermit' ->> 'attemptId',
    'workId', null, 'leaseGeneration', null, 'leaseToken', null,
    'operationId', null, 'operationGeneration', null
  ), 'succeeded'
) as result
from recovered_release_retry_work recovered
cross join retry_cleanup_release_permit permit;
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from first_release_retry_work))::uuid,
    ((select result ->> 'generation' from first_release_retry_work))::integer,
    ((select result ->> 'stateRevision' from first_release_retry_work))::bigint,
    ((select result ->> 'leaseToken' from first_release_retry_work))::uuid,
    (select result -> 'paymentSnapshot' from first_release_retry_work),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status',
  'conflict',
  'a stale release worker cannot overwrite the recovered retry lease'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from recovered_release_retry_work))::uuid,
    ((select result ->> 'generation' from recovered_release_retry_work))::integer,
    ((select result ->> 'stateRevision' from recovered_release_retry_work))::bigint,
    ((select result ->> 'leaseToken' from recovered_release_retry_work))::uuid,
    (select work.result -> 'paymentSnapshot' || jsonb_build_object(
      'release', (work.result -> 'paymentSnapshot' -> 'release') || jsonb_build_object(
        'status', 'succeeded',
        'providerRequestId', provider.result ->> 'providerRequestId',
        'providerReference', provider.result ->> 'providerReference',
        'movementReference', provider.result ->> 'movementReference',
        'reconciliationRequired', false,
        'retrySafe', false
      ),
      'movements', (work.result -> 'paymentSnapshot' -> 'movements') ||
        jsonb_build_array(jsonb_build_object(
          'kind', 'release',
          'logicalOperationId', work.result ->> 'logicalOperationId',
          'attemptId', work.result ->> 'physicalAttemptId',
          'amountFils', (work.result ->> 'amountFils')::bigint,
          'movementReference', provider.result ->> 'movementReference',
          'recordedAt', '2099-08-21T14:02:00.000Z'
        ))
    )
    from recovered_release_retry_work work
    cross join successful_release_retry_result provider),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'claimState',
  'released',
  'the recovered retry closes only after authoritative successful release evidence'
);
reset role;
select results_eq(
  $$select claims.state::text, occupancies.active, outbox.state,
      (select count(*)::integer from public.simulated_payment_provider_operations),
      (select count(*)::integer from public.simulated_payment_provider_operations
        where operation_kind = 'release' and current_outcome = 'failed'),
      (select count(*)::integer from public.simulated_payment_provider_operations
        where operation_kind = 'release' and current_outcome = 'succeeded')
    from public.booking_request_authorization_claims claims
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('released'::text, false, 'complete'::text,
    3::integer, 1::integer, 1::integer)$$,
  'successful retry frees inventory while retaining authorization and both release attempts'
);
rollback to savepoint failed_release_recovery;

savepoint ledger_evidenced_release_expiry;
create temporary table simulated_release_operation as
select jsonb_build_object(
  'providerIdentity', jsonb_build_object(
    'provider', claims.provider,
    'environment', claims.environment,
    'merchantId', claims.merchant_id,
    'terminalId', claims.terminal_id
  ),
  'permitPurpose', permit.result -> 'executionPermit' ->> 'purpose',
  'idempotencyKey', permit.result -> 'executionPermit' ->> 'idempotencyKey',
  'requestFingerprint', permit.result -> 'executionPermit' ->> 'requestFingerprint',
  'notAfter', permit.result -> 'executionPermit' ->> 'notAfter',
  'paymentLifecycleId', claims.payment_lifecycle_id,
  'logicalOperationId', payments.snapshot -> 'release' ->> 'logicalOperationId',
  'physicalAttemptId', payments.snapshot -> 'release' ->> 'attemptId',
  'operationKind', 'release',
  'amountFils', claims.amount_fils,
  'currency', claims.currency,
  'claimId', permit.result -> 'executionPermit' ->> 'claimId',
  'claimGeneration',
    (permit.result -> 'executionPermit' ->> 'generation')::integer,
  'stateRevision',
    (permit.result -> 'executionPermit' ->> 'stateRevision')::bigint,
  'cleanupAttemptId', permit.result -> 'executionPermit' ->> 'attemptId',
  'workId', null, 'leaseGeneration', null, 'leaseToken', null,
  'operationId', null, 'operationGeneration', null
) as operation
from public.booking_request_authorization_claims claims
cross join pending_release_payment payments
cross join cleanup_release_permit permit;
grant select on simulated_release_operation to service_role;
set local role service_role;
select lives_ok(
  format(
    'select public.execute_simulated_payment_provider_operation(%L::jsonb, %L)',
    (select operation::text from simulated_release_operation),
    'succeeded'
  ),
  'the fictional ledger records a definitive authorization release'
);
reset role;
update public.booking_request_authorization_claims
set reconciliation_expires_at = clock_timestamp() - interval '1 second';
update public.booking_request_authorization_reconciliation_outbox
set lease_token = gen_random_uuid(),
  lease_expires_at = clock_timestamp() + interval '30 seconds';
set local role service_role;
select is(
  public.expire_booking_request_authorization_claims(),
  1,
  'expiry frees inventory only after consulting definitive durable release evidence'
);
reset role;
select results_eq(
  $$select attempts.state, claims.state::text, occupancies.active, outbox.state,
      outbox.lease_token is null,
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments),
      (select count(*)::integer from public.simulated_payment_provider_operations)
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('released'::text, 'released'::text, false, 'complete'::text,
    true, 0::integer, 0::integer, 2::integer)$$,
  'evidenced release preserves both ledger movements and creates no product records'
);
rollback to savepoint ledger_evidenced_release_expiry;
create temporary table lost_release_operation as
select jsonb_build_object(
  'providerIdentity', jsonb_build_object(
    'provider', claims.provider,
    'environment', claims.environment,
    'merchantId', claims.merchant_id,
    'terminalId', claims.terminal_id
  ),
  'permitPurpose', permit.result -> 'executionPermit' ->> 'purpose',
  'idempotencyKey', permit.result -> 'executionPermit' ->> 'idempotencyKey',
  'requestFingerprint', permit.result -> 'executionPermit' ->> 'requestFingerprint',
  'notAfter', permit.result -> 'executionPermit' ->> 'notAfter',
  'paymentLifecycleId', claims.payment_lifecycle_id,
  'logicalOperationId', payments.snapshot -> 'release' ->> 'logicalOperationId',
  'physicalAttemptId', payments.snapshot -> 'release' ->> 'attemptId',
  'operationKind', 'release',
  'amountFils', claims.amount_fils,
  'currency', claims.currency,
  'claimId', permit.result -> 'executionPermit' ->> 'claimId',
  'claimGeneration',
    (permit.result -> 'executionPermit' ->> 'generation')::integer,
  'stateRevision',
    (permit.result -> 'executionPermit' ->> 'stateRevision')::bigint,
  'cleanupAttemptId', permit.result -> 'executionPermit' ->> 'attemptId',
  'workId', null, 'leaseGeneration', null, 'leaseToken', null,
  'operationId', null, 'operationGeneration', null
) as operation
from public.booking_request_authorization_claims claims
cross join pending_release_payment payments
cross join cleanup_release_permit permit;
grant select on lost_release_operation to service_role;
create temporary table lost_release_result (result jsonb);
grant select, insert on lost_release_result to service_role;
set local role service_role;
insert into lost_release_result
select public.execute_simulated_payment_provider_operation(
  (select operation from lost_release_operation), 'indeterminate'
);
reset role;
create temporary table first_release_work (result jsonb);
grant select, insert on first_release_work to service_role;
set local role service_role;
insert into first_release_work
select public.dequeue_booking_request_authorization_reconciliation();
select is(
  (select (result ->> 'operationKind') || ':' || (result ->> 'recoveryAction')
    from first_release_work),
  'release:execute',
  'a lost response re-executes only the idempotent persisted release binding'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from first_release_work))::uuid,
    ((select result ->> 'generation' from first_release_work))::integer,
    ((select result ->> 'stateRevision' from first_release_work))::bigint,
    ((select result ->> 'leaseToken' from first_release_work))::uuid,
    (select snapshot || jsonb_build_object(
      'release', (snapshot -> 'release') || jsonb_build_object(
        'providerRequestId', provider.result ->> 'providerRequestId',
        'providerReference', provider.result ->> 'providerReference',
        'movementReference', provider.result ->> 'movementReference',
        'reconciliationRequired', true
      )
    ) from pending_release_payment
    cross join lost_release_result provider),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
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
  (select (result ->> 'operationKind') || ':' || (result ->> 'recoveryAction')
    from retried_release_work),
  'release:query',
  'a lost release response queries the durable release before any retry'
);
create temporary table reconciled_release_result (result jsonb);
grant select, insert on reconciled_release_result to service_role;
insert into reconciled_release_result
select public.query_simulated_payment_provider_operation(
  (select operation from lost_release_operation),
  (select result ->> 'providerRequestId' from lost_release_result),
  (select result ->> 'providerReference' from lost_release_result),
  'succeeded'
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
        'providerRequestId', provider.result ->> 'providerRequestId',
        'providerReference', provider.result ->> 'providerReference',
        'movementReference', provider.result ->> 'movementReference',
        'reconciliationRequired', false
      ),
      'movements', (snapshot -> 'movements') || jsonb_build_array(
        jsonb_build_object(
          'kind', 'release',
          'logicalOperationId', snapshot -> 'release' ->> 'logicalOperationId',
          'attemptId', snapshot -> 'release' ->> 'attemptId',
          'amountFils', 115000000,
          'movementReference', provider.result ->> 'movementReference',
          'recordedAt', '2099-08-21T14:01:00.000Z'
        )
      )
    ) from pending_release_payment
    cross join reconciled_release_result provider),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
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
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
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
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb,
  'recovery returns the immutable provider identity with payment evidence'
);
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from authorized_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"changed-merchant","terminalId":"fictional-terminal"}'
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
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
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
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
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
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
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

create temporary table booking_request_lifecycle_target as
select id, owner_user_id, customer_user_id, booking_request_reference
from public.booking_requests limit 1;
grant select on booking_request_lifecycle_target to service_role, authenticated;

savepoint booking_request_null_withdraw_actor;
set local role service_role;
select is(
  public.claim_booking_request_action(
    null, (select id from booking_request_lifecycle_target),
    'withdraw', null, null
  ) ->> 'status',
  'access-required',
  'a null actor cannot withdraw a Booking Request'
);
reset role;
rollback to savepoint booking_request_null_withdraw_actor;

savepoint booking_request_null_accept_actor;
set local role service_role;
select is(
  public.claim_booking_request_action(
    null, (select id from booking_request_lifecycle_target),
    'accept', null, null
  ) ->> 'status',
  'access-required',
  'a null actor cannot accept a Booking Request'
);
reset role;
rollback to savepoint booking_request_null_accept_actor;

savepoint booking_request_null_decline_actor;
set local role service_role;
select is(
  public.claim_booking_request_action(
    null, (select id from booking_request_lifecycle_target),
    'decline', 'other', null
  ) ->> 'status',
  'access-required',
  'a null actor cannot decline a Booking Request'
);
reset role;
rollback to savepoint booking_request_null_decline_actor;

savepoint booking_request_null_action;
set local role service_role;
select is(
  public.claim_booking_request_action(
    (select customer_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target), null, null, null
  ) ->> 'status',
  'access-required',
  'a null action cannot mutate a Booking Request'
);
reset role;
rollback to savepoint booking_request_null_action;

select results_eq(
  $$select requests.status,
      claims.state,
      count(distinct work.id)::integer,
      count(distinct provider.id)::integer,
      count(distinct notifications.id)::integer
    from public.booking_requests requests
    join public.booking_request_submission_attempts attempts
      on attempts.booking_request_id = requests.id
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    left join public.booking_request_release_work work
      on work.attempt_id = attempts.id
    left join public.booking_request_release_operations operations
      on operations.work_id = work.id
    left join public.simulated_payment_provider_operations provider
      on provider.provider_idempotency_key = operations.provider_idempotency_key
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    where requests.id = (select id from booking_request_lifecycle_target)
    group by requests.status, claims.state$$,
  $$values ('pending'::text, 'converted'::public.booking_request_authorization_claim_state,
      0::integer, 0::integer, 0::integer)$$,
  'null action inputs create no release work, provider operation, hold change, or notification'
);

savepoint booking_request_premature_expiry;
set local role service_role;
select is(
  public.claim_booking_request_expiry(
    (select id from booking_request_lifecycle_target)
  ) ->> 'status',
  'not-due',
  'the internal expiry claim independently rejects a pre-deadline request'
);
reset role;
select results_eq(
  $$select requests.status, count(notifications.id)::integer
    from public.booking_requests requests
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    where requests.id = (select id from booking_request_lifecycle_target)
    group by requests.status$$,
  $$values ('pending'::text, 0::integer)$$,
  'a premature expiry claim cannot accept the request or notify either party'
);
rollback to savepoint booking_request_premature_expiry;

savepoint booking_request_cross_party_authorization;
set local role service_role;
select is(
  public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003204',
    (select id from booking_request_lifecycle_target), 'accept', null, null
  ) ->> 'status', 'access-required',
  'a different Cottage Owner cannot inspect or act on a pending Booking Request'
);
select is(
  public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003203',
    (select id from booking_request_lifecycle_target), 'withdraw', null, null
  ) ->> 'status', 'access-required',
  'a different Customer cannot inspect or withdraw a pending Booking Request'
);
reset role;
update public.booking_requests set status = 'processing';
set local role service_role;
select is(
  public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003204',
    (select id from booking_request_lifecycle_target), 'decline', 'other', null
  ) ->> 'status', 'access-required',
  'a different Cottage Owner cannot inspect processing release work'
);
select is(
  public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003203',
    (select id from booking_request_lifecycle_target), 'withdraw', null, null
  ) ->> 'status', 'access-required',
  'a different Customer cannot inspect processing release work'
);
reset role;
update public.booking_requests set status = 'declined';
set local role service_role;
select is(
  public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003204',
    (select id from booking_request_lifecycle_target), 'accept', null, null
  ) ->> 'status', 'access-required',
  'a different Cottage Owner cannot inspect a terminal Booking Request'
);
select is(
  public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003203',
    (select id from booking_request_lifecycle_target), 'withdraw', null, null
  ) ->> 'status', 'access-required',
  'a different Customer cannot inspect a terminal Booking Request'
);
reset role;
rollback to savepoint booking_request_cross_party_authorization;

savepoint booking_request_current_owner_authorization;
create temporary table current_owner_authorization_results (
  category text,
  action text,
  status text
);
grant select, insert on current_owner_authorization_results to service_role;
set local role service_role;
insert into current_owner_authorization_results values
  ('wrong', 'accept', public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003204',
    (select id from booking_request_lifecycle_target), 'accept', null, null
  ) ->> 'status'),
  ('wrong', 'decline', public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003204',
    (select id from booking_request_lifecycle_target), 'decline', 'other', null
  ) ->> 'status');
reset role;
update public.account_contexts set owner_approval_state = 'suspended'
where user_id = (select owner_user_id from booking_request_lifecycle_target);
set local role service_role;
insert into current_owner_authorization_results values
  ('suspended', 'accept', public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target), 'accept', null, null
  ) ->> 'status'),
  ('suspended', 'decline', public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target), 'decline', 'other', null
  ) ->> 'status');
reset role;
update public.account_contexts set owner_approval_state = 'expired'
where user_id = (select owner_user_id from booking_request_lifecycle_target);
set local role service_role;
insert into current_owner_authorization_results values
  ('expired', 'accept', public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target), 'accept', null, null
  ) ->> 'status'),
  ('expired', 'decline', public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target), 'decline', 'other', null
  ) ->> 'status');
reset role;
update public.account_contexts set owner_approval_state = 'prospective'
where user_id = (select owner_user_id from booking_request_lifecycle_target);
set local role service_role;
insert into current_owner_authorization_results values
  ('revoked', 'accept', public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target), 'accept', null, null
  ) ->> 'status'),
  ('revoked', 'decline', public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target), 'decline', 'other', null
  ) ->> 'status');
reset role;
select results_eq(
  $$select category, action, status
    from current_owner_authorization_results order by category, action$$,
  $$values
    ('expired'::text, 'accept'::text, 'access-required'::text),
    ('expired', 'decline', 'access-required'),
    ('revoked', 'accept', 'access-required'),
    ('revoked', 'decline', 'access-required'),
    ('suspended', 'accept', 'access-required'),
    ('suspended', 'decline', 'access-required'),
    ('wrong', 'accept', 'access-required'),
    ('wrong', 'decline', 'access-required')$$,
  'only the currently approved owning Cottage Owner can accept or decline'
);
select results_eq(
  $$select requests.status, commitments.status::text,
      bool_and(occupancies.active),
      count(distinct work.id)::integer,
      count(distinct notifications.id)::integer
    from public.booking_requests requests
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = commitments.id
    left join public.booking_request_release_work work
      on work.booking_request_id = requests.id
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    where requests.id = (select id from booking_request_lifecycle_target)
    group by requests.status, commitments.status$$,
  $$values ('pending'::text, 'pending_hold'::text, true, 0::integer, 0::integer)$$,
  'unauthorised Owner decisions cause zero lifecycle, inventory, or notification mutation'
);
rollback to savepoint booking_request_current_owner_authorization;

savepoint booking_request_expiry_ignores_owner_approval;
update public.account_contexts set owner_approval_state = 'prospective'
where user_id = (select owner_user_id from booking_request_lifecycle_target);
update public.booking_requests
set response_deadline = due.deadline,
  created_at = due.deadline - interval '4 hours'
from (select clock_timestamp() - interval '1 millisecond' as deadline) due;
set local role service_role;
select is(
  public.claim_booking_request_expiry(
    (select id from booking_request_lifecycle_target)
  ) ->> 'status',
  'release-required',
  'direct expiry claims overdue work without an Owner action or approval state'
);
reset role;
select results_eq(
  $$select work.outcome, work.actor_user_id is null,
      contexts.owner_approval_state::text
    from public.booking_request_release_work work
    join public.booking_requests requests on requests.id = work.booking_request_id
    join public.account_contexts contexts
      on contexts.user_id = requests.owner_user_id$$,
  $$values ('expired'::text, true, 'prospective'::text)$$,
  'expiry records a system-owned outcome while leaving Owner approval untouched'
);
rollback to savepoint booking_request_expiry_ignores_owner_approval;

savepoint booking_request_owner_acceptance;
set local role service_role;
select is(
  public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target),
    'accept', null, null
  ) ->> 'status',
  'accepted',
  'the authorised Cottage Owner accepts the complete request atomically'
);
reset role;
select results_eq(
  $$select requests.status, commitments.status::text,
      bool_and(occupancies.active), count(notifications.id)::integer
    from public.booking_requests requests
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = commitments.id
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    group by requests.status, commitments.status$$,
  $$values ('accepted'::text, 'pending_hold'::text, true, 2::integer)$$,
  'acceptance retains the Payment Authorisation and active Pending Hold while notifying both parties once'
);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select is(
  jsonb_array_length(public.list_owner_booking_request_notifications() -> 0
    -> 'statusNotifications')::text || ':' ||
    (public.list_owner_booking_request_notifications() -> 0
      -> 'statusNotifications' -> 0 ->> 'status'),
  '1:accepted',
  'the owning Cottage Owner reads exactly one scoped acceptance notification receipt'
);
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003202"}', true);
select is(
  jsonb_array_length(public.get_customer_booking_request(
    (select booking_request_reference from booking_request_lifecycle_target)
  ) -> 'statusNotifications')::text || ':' ||
    (public.get_customer_booking_request(
      (select booking_request_reference from booking_request_lifecycle_target)
    ) -> 'statusNotifications' -> 0 ->> 'status'),
  '1:accepted',
  'the owning Customer reads exactly one scoped acceptance notification receipt'
);
reset role;
rollback to savepoint booking_request_owner_acceptance;

savepoint booking_request_malformed_decline_reason;
set local role service_role;
select throws_ok(
  format(
    'select public.claim_booking_request_action(%L::uuid, %L::uuid, %L, %L, null)',
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target),
    'decline',
    'invented_reason'
  ),
  '22023', null,
  'an unknown decline reason fails loudly at the database boundary'
);
reset role;
rollback to savepoint booking_request_malformed_decline_reason;

savepoint booking_request_decline_claim;
set local role service_role;
select is(
  public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target),
    'decline', 'cottage_unavailable', 'Fictional maintenance is required.'
  ) ->> 'status',
  'release-required',
  'decline freezes unsuccessful intent and returns authoritative release work'
);
reset role;
select results_eq(
  $$select requests.status, work.outcome, work.decline_reason,
      work.decline_note, work.outcome_fingerprint = requests.outcome_fingerprint
    from public.booking_requests requests
    join public.booking_request_release_work work
      on work.booking_request_id = requests.id$$,
  $$values (
    'processing'::text, 'declined'::text, 'cottage_unavailable'::text,
    'Fictional maintenance is required.'::text, true
  )$$,
  'the immutable decline reason, normalized note and fingerprint are frozen before provider execution'
);
select results_eq(
  $$select commitments.status::text, bool_and(occupancies.active),
      count(notifications.id)::integer
    from public.booking_requests requests
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = commitments.id
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    group by commitments.status$$,
  $$values ('pending_hold'::text, true, 0::integer)$$,
  'inventory stays held and no terminal status notification is sent before release succeeds'
);
set local role service_role;
select is(
  public.claim_booking_request_action(
    (select customer_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target),
    'withdraw', null, null
  ) ->> 'status',
  'processing',
  'a competing withdrawal cannot replace or reclaim the live decline lease'
);
reset role;
rollback to savepoint booking_request_decline_claim;

savepoint booking_request_withdrawal_release;
set local role service_role;
select public.claim_booking_request_action(
  (select customer_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),
  'withdraw', null, null
);
reset role;
create temporary table withdrawal_release_snapshots as
select attempts.id as attempt_id, work.id as work_id,
  work.lease_generation, work.lease_token,
  jsonb_set(
    attempts.payment_snapshot,
    '{release}',
    jsonb_build_object(
      'paymentLifecycleId', attempts.payment_lifecycle_id,
      'kind', 'release',
      'logicalOperationId', attempts.payment_lifecycle_id::text || ':release',
      'attemptId', attempts.payment_lifecycle_id::text || ':release:attempt-2',
      'status', 'pending',
      'amountFils', (attempts.quote_payload ->> 'customerTotalIqd')::bigint * 1000,
      'providerRequestId', null,
      'providerReference', null,
      'movementReference', null,
      'reconciliationRequired', false,
      'retrySafe', false
    )
  ) as pending_snapshot
from public.booking_request_submission_attempts attempts
join public.booking_request_release_work work on work.attempt_id = attempts.id;
alter table withdrawal_release_snapshots add column succeeded_snapshot jsonb;
update withdrawal_release_snapshots snapshots
set succeeded_snapshot = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        snapshots.pending_snapshot,
        '{release,status}', '"succeeded"'::jsonb
      ),
      '{release,providerRequestId}', '"lifecycle-withdraw-request"'::jsonb
    ),
    '{release,providerReference}', '"lifecycle-withdraw-reference"'::jsonb
  ),
  '{release,movementReference}', '"lifecycle-withdraw-movement"'::jsonb
);
update withdrawal_release_snapshots snapshots
set succeeded_snapshot = jsonb_set(
  snapshots.succeeded_snapshot,
  '{movements}',
  (snapshots.succeeded_snapshot -> 'movements') || jsonb_build_array(
    jsonb_build_object(
      'kind', 'release',
      'logicalOperationId', snapshots.succeeded_snapshot -> 'release' ->> 'logicalOperationId',
      'attemptId', snapshots.succeeded_snapshot -> 'release' ->> 'attemptId',
      'amountFils', (snapshots.succeeded_snapshot -> 'release' ->> 'amountFils')::bigint,
      'movementReference', 'lifecycle-withdraw-movement',
      'recordedAt', '2099-08-21T17:00:00.000Z'
    )
  )
);
grant select, update on withdrawal_release_snapshots to service_role;
set local role service_role;
create temporary table withdrawal_release_permit as
select public.save_booking_request_release_snapshot(
  work_id, lease_generation, lease_token, pending_snapshot,
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as permit from withdrawal_release_snapshots;
grant select on withdrawal_release_permit to service_role;
create temporary table withdrawal_provider_result as
select public.execute_simulated_payment_provider_operation(
    jsonb_build_object(
      'providerIdentity', jsonb_build_object(
        'provider', 'fictional-payments', 'environment', 'local-test',
        'merchantId', 'fictional-merchant', 'terminalId', 'fictional-terminal'
      ),
      'permitPurpose', permit ->> 'purpose',
      'idempotencyKey', permit ->> 'idempotencyKey',
      'requestFingerprint', permit ->> 'requestFingerprint',
      'notAfter', permit ->> 'notAfter',
      'paymentLifecycleId', pending_snapshot ->> 'paymentLifecycleId',
      'logicalOperationId', pending_snapshot -> 'release' ->> 'logicalOperationId',
      'physicalAttemptId', pending_snapshot -> 'release' ->> 'attemptId',
      'operationKind', 'release',
      'amountFils', (pending_snapshot -> 'release' ->> 'amountFils')::bigint,
      'currency', 'IQD', 'claimId', null, 'claimGeneration', null,
      'stateRevision', null, 'cleanupAttemptId', null,
      'workId', permit ->> 'workId',
      'leaseGeneration', (permit ->> 'leaseGeneration')::bigint,
      'leaseToken', permit ->> 'leaseToken',
      'operationId', permit ->> 'operationId',
      'operationGeneration', (permit ->> 'operationGeneration')::integer
    ),
    'succeeded'
  ) as result
from withdrawal_release_snapshots, withdrawal_release_permit;
select is(
  (select result ->> 'outcome' from withdrawal_provider_result),
  'succeeded',
  'a converted authorization claim remains authoritative for terminal release execution'
) ;
update withdrawal_release_snapshots snapshots
set succeeded_snapshot = jsonb_set(jsonb_set(jsonb_set(
  succeeded_snapshot,
  '{release,providerRequestId}', to_jsonb(results.result ->> 'providerRequestId')
), '{release,providerReference}', to_jsonb(results.result ->> 'providerReference')),
'{release,movementReference}', to_jsonb(results.result ->> 'movementReference'))
from withdrawal_provider_result results;
update withdrawal_release_snapshots snapshots
set succeeded_snapshot = jsonb_set(
  succeeded_snapshot, '{movements,1,movementReference}',
  to_jsonb(results.result ->> 'movementReference')
) from withdrawal_provider_result results;
select public.save_booking_request_release_snapshot(
  work_id, lease_generation, lease_token, succeeded_snapshot,
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) from withdrawal_release_snapshots;
create temporary table withdrawal_release_result as
select public.finalize_booking_request_release(
  work_id, lease_generation, lease_token
) as result
from withdrawal_release_snapshots;
reset role;
select results_eq(
  $$select result ->> 'status' from withdrawal_release_result$$,
  $$values ('withdrawn'::text)$$,
  'authoritative release persistence moves a processing withdrawal to withdrawn'
);
rollback to savepoint booking_request_withdrawal_release;

savepoint booking_request_postexpiry_admission_rejected;
set local role service_role;
select public.claim_booking_request_action(
  (select customer_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),
  'withdraw', null, null
);
reset role;
create temporary table postexpiry_release_snapshot as
select work.id as work_id, work.lease_generation, work.lease_token,
  jsonb_set(attempts.payment_snapshot, '{release}', jsonb_build_object(
    'paymentLifecycleId', attempts.payment_lifecycle_id,
    'kind', 'release',
    'logicalOperationId', attempts.payment_lifecycle_id::text || ':release',
    'attemptId', attempts.payment_lifecycle_id::text || ':release:attempt-2',
    'status', 'pending', 'amountFils', claims.amount_fils,
    'providerRequestId', null, 'providerReference', null,
    'movementReference', null, 'reconciliationRequired', false,
    'retrySafe', false
  )) as pending_snapshot
from public.booking_request_submission_attempts attempts
join public.booking_request_authorization_claims claims
  on claims.attempt_id = attempts.id
join public.booking_request_release_work work on work.attempt_id = attempts.id
where attempts.booking_request_id = (select id from booking_request_lifecycle_target);
grant select on postexpiry_release_snapshot to service_role;
set local role service_role;
create temporary table postexpiry_release_permit as
select public.save_booking_request_release_snapshot(
  work_id, lease_generation, lease_token, pending_snapshot,
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as permit
from postexpiry_release_snapshot;
reset role;
create temporary table postexpiry_provider_operation as
select jsonb_build_object(
  'providerIdentity', jsonb_build_object(
    'provider', 'fictional-payments', 'environment', 'local-test',
    'merchantId', 'fictional-merchant', 'terminalId', 'fictional-terminal'
  ),
  'permitPurpose', permit ->> 'purpose',
  'idempotencyKey', permit ->> 'idempotencyKey',
  'requestFingerprint', permit ->> 'requestFingerprint',
  'notAfter', permit ->> 'notAfter',
  'paymentLifecycleId', pending_snapshot ->> 'paymentLifecycleId',
  'logicalOperationId', pending_snapshot -> 'release' ->> 'logicalOperationId',
  'physicalAttemptId', pending_snapshot -> 'release' ->> 'attemptId',
  'operationKind', 'release',
  'amountFils', (pending_snapshot -> 'release' ->> 'amountFils')::bigint,
  'currency', 'IQD', 'claimId', null, 'claimGeneration', null,
  'stateRevision', null, 'cleanupAttemptId', null,
  'workId', permit ->> 'workId',
  'leaseGeneration', (permit ->> 'leaseGeneration')::bigint,
  'leaseToken', permit ->> 'leaseToken',
  'operationId', permit ->> 'operationId',
  'operationGeneration', (permit ->> 'operationGeneration')::integer
) as operation
from postexpiry_release_snapshot, postexpiry_release_permit;
grant select on postexpiry_provider_operation to service_role;
update public.booking_request_release_work
set lease_expires_at = clock_timestamp() - interval '1 millisecond'
where id = (select work_id from postexpiry_release_snapshot);
set local role service_role;
select throws_ok(
  format(
    'select public.execute_simulated_payment_provider_operation(%L::jsonb,%L)',
    (select operation::text from postexpiry_provider_operation), 'succeeded'
  ),
  'RC409', null,
  'a generation-one provider call first presented after lease expiry is rejected'
);
reset role;
select results_eq(
  $$select operations.state,
      count(provider.id)::integer
    from public.booking_request_release_operations operations
    left join public.simulated_payment_provider_operations provider
      on provider.provider_idempotency_key = operations.provider_idempotency_key
    group by operations.state$$,
  $$values ('executing'::text, 0::integer)$$,
  'post-expiry rejection records no fictional provider execution'
);
set local role service_role;
create temporary table postexpiry_reclaimed_work as
select public.claim_booking_request_action(
  (select customer_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),
  'withdraw', null, null
) as result;
reset role;
select results_eq(
  $$select (reclaimed.result ->> 'leaseGeneration')::bigint,
      reclaimed.result ->> 'leaseToken' <> original.lease_token::text,
      operations.state
    from postexpiry_reclaimed_work reclaimed
    cross join postexpiry_release_snapshot original
    cross join public.booking_request_release_operations operations$$,
  $$select lease_generation + 1, true, 'reconcile_required'::text
    from postexpiry_release_snapshot$$,
  'reclaim rotates generation and requires reconciliation of N before any retry'
);
set local role service_role;
create temporary table postexpiry_absence_result as
select public.query_simulated_payment_provider_operation(
  jsonb_build_object(
    'providerIdentity', jsonb_build_object(
      'provider', 'fictional-payments', 'environment', 'local-test',
      'merchantId', 'fictional-merchant', 'terminalId', 'fictional-terminal'
    ),
    'requestFingerprint', null,
    'paymentLifecycleId', pending_snapshot ->> 'paymentLifecycleId',
    'logicalOperationId', pending_snapshot -> 'release' ->> 'logicalOperationId',
    'physicalAttemptId', pending_snapshot -> 'release' ->> 'attemptId',
    'operationKind', 'release',
    'amountFils', (pending_snapshot -> 'release' ->> 'amountFils')::bigint,
    'currency', 'IQD'
  ), null, null, 'succeeded'
) as result
from postexpiry_release_snapshot;
select is(
  (select result ->> 'outcome' from postexpiry_absence_result),
  'not-executed',
  'reconciliation proves the expired operation was never admitted'
);
reset role;
select results_eq(
  $$select state, provider_outcome, retry_safe,
      provider_request_id is null, provider_reference is null,
      movement_reference is null
    from public.booking_request_release_operations$$,
  $$values ('retryable'::text, 'not_executed'::text, true, true, true, true)$$,
  'provider absence becomes durable release-only retry permission'
);
rollback to savepoint booking_request_postexpiry_admission_rejected;

savepoint booking_request_preexpiry_admission_reconcile;
set local role service_role;
create temporary table preexpiry_release_claim as
select public.claim_booking_request_action(
  (select customer_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),
  'withdraw', null, null
) as result;
reset role;
create temporary table preexpiry_release_snapshot as
select attempts.id as attempt_id, work.id as work_id,
  work.lease_generation, work.lease_token,
  jsonb_set(attempts.payment_snapshot, '{release}', jsonb_build_object(
    'paymentLifecycleId', attempts.payment_lifecycle_id,
    'kind', 'release',
    'logicalOperationId', attempts.payment_lifecycle_id::text || ':release',
    'attemptId', attempts.payment_lifecycle_id::text || ':release:attempt-2',
    'status', 'pending', 'amountFils', claims.amount_fils,
    'providerRequestId', null, 'providerReference', null,
    'movementReference', null, 'reconciliationRequired', false,
    'retrySafe', false
  )) as pending_snapshot
from public.booking_request_submission_attempts attempts
join public.booking_request_authorization_claims claims
  on claims.attempt_id = attempts.id
join public.booking_request_release_work work on work.attempt_id = attempts.id
where attempts.booking_request_id = (select id from booking_request_lifecycle_target);
grant select on preexpiry_release_snapshot to service_role;

savepoint booking_request_release_save_null_generation;
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_release_snapshot(%L::uuid,null,%L::uuid,%L::jsonb,%L::jsonb)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_token from preexpiry_release_snapshot),
    (select pending_snapshot::text from preexpiry_release_snapshot),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'RC409', null,
  'release snapshot save rejects a null lease generation'
);
reset role;
rollback to savepoint booking_request_release_save_null_generation;

savepoint booking_request_release_save_null_token;
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,null,%L::jsonb,%L::jsonb)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_generation from preexpiry_release_snapshot),
    (select pending_snapshot::text from preexpiry_release_snapshot),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'RC409', null,
  'release snapshot save rejects a null lease token'
);
reset role;
rollback to savepoint booking_request_release_save_null_token;

savepoint booking_request_release_save_null_lease;
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_release_snapshot(%L::uuid,null,null,%L::jsonb,%L::jsonb)',
    (select work_id from preexpiry_release_snapshot),
    (select pending_snapshot::text from preexpiry_release_snapshot),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'RC409', null,
  'release snapshot save rejects a null lease generation and token'
);
reset role;
rollback to savepoint booking_request_release_save_null_lease;

select results_eq(
  $$select attempts.state, requests.status, claims.state,
      count(distinct operations.id)::integer,
      count(distinct provider.id)::integer,
      count(distinct notifications.id)::integer
    from public.booking_requests requests
    join public.booking_request_submission_attempts attempts
      on attempts.booking_request_id = requests.id
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    left join public.booking_request_release_work work
      on work.attempt_id = attempts.id
    left join public.booking_request_release_operations operations
      on operations.work_id = work.id
    left join public.simulated_payment_provider_operations provider
      on provider.provider_idempotency_key = operations.provider_idempotency_key
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    where requests.id = (select id from booking_request_lifecycle_target)
    group by attempts.state, requests.status, claims.state$$,
  $$values ('finalized'::text,
      'processing'::text, 'converted'::public.booking_request_authorization_claim_state,
      0::integer, 0::integer, 0::integer)$$,
  'null release-save lease inputs issue no permit and mutate no operation, provider, or product state'
);

savepoint booking_request_pending_release_movement_invention;
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_generation from preexpiry_release_snapshot),
    (select lease_token from preexpiry_release_snapshot),
    (select jsonb_set(
      pending_snapshot,
      '{movements}',
      (pending_snapshot -> 'movements') || jsonb_build_array(jsonb_build_object(
        'kind', 'release',
        'logicalOperationId', 'invented-release',
        'attemptId', 'invented-attempt',
        'amountFils', 1,
        'movementReference', 'invented-movement',
        'recordedAt', '2099-08-21T18:00:00.000Z'
      ))
    )::text from preexpiry_release_snapshot),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  '22023', null,
  'a pending release cannot invent movement evidence'
);
reset role;
rollback to savepoint booking_request_pending_release_movement_invention;

set local role service_role;
create temporary table preexpiry_release_permit as
select public.save_booking_request_release_snapshot(
  work_id, lease_generation, lease_token, pending_snapshot,
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as permit
from preexpiry_release_snapshot;
select is(
  (select permit ->> 'purpose' from preexpiry_release_permit),
  'booking-request-release',
  'generation one durably binds the release before provider admission'
);
create temporary table preexpiry_provider_operation as
select jsonb_build_object(
  'providerIdentity', jsonb_build_object(
    'provider', 'fictional-payments', 'environment', 'local-test',
    'merchantId', 'fictional-merchant', 'terminalId', 'fictional-terminal'
  ),
  'permitPurpose', permit ->> 'purpose',
  'idempotencyKey', permit ->> 'idempotencyKey',
  'requestFingerprint', permit ->> 'requestFingerprint',
  'notAfter', permit ->> 'notAfter',
  'paymentLifecycleId', pending_snapshot ->> 'paymentLifecycleId',
  'logicalOperationId', pending_snapshot -> 'release' ->> 'logicalOperationId',
  'physicalAttemptId', pending_snapshot -> 'release' ->> 'attemptId',
  'operationKind', 'release',
  'amountFils', (pending_snapshot -> 'release' ->> 'amountFils')::bigint,
  'currency', 'IQD', 'claimId', null, 'claimGeneration', null,
  'stateRevision', null, 'cleanupAttemptId', null,
  'workId', permit ->> 'workId',
  'leaseGeneration', (permit ->> 'leaseGeneration')::bigint,
  'leaseToken', permit ->> 'leaseToken',
  'operationId', permit ->> 'operationId',
  'operationGeneration', (permit ->> 'operationGeneration')::integer
) as operation
from preexpiry_release_snapshot, preexpiry_release_permit;
grant select on preexpiry_provider_operation to service_role;

create function pg_temp.assert_null_release_bindings_rejected(target_operation jsonb)
returns void
language plpgsql
as $$
declare required_path text[];
declare required_key text;
declare invalid_operation jsonb;
begin
  foreach required_key in array array[
    'provider', 'environment', 'merchantId', 'terminalId'
  ] loop
    required_path := array['providerIdentity', required_key];
    invalid_operation := jsonb_set(target_operation, required_path, 'null'::jsonb);
    begin
      perform public.execute_simulated_payment_provider_operation(
        invalid_operation, 'succeeded'
      );
      raise exception 'provider accepted null required binding at %', required_path
        using errcode = 'P0001';
    exception
      when sqlstate '22023' or sqlstate 'RC409' then null;
    end;
  end loop;
  foreach required_key in array array[
    'requestFingerprint', 'paymentLifecycleId', 'logicalOperationId',
    'physicalAttemptId', 'operationKind', 'amountFils', 'currency',
    'permitPurpose', 'idempotencyKey', 'notAfter', 'workId', 'operationId',
    'operationGeneration'
  ] loop
    required_path := array[required_key];
    invalid_operation := jsonb_set(target_operation, required_path, 'null'::jsonb);
    begin
      perform public.execute_simulated_payment_provider_operation(
        invalid_operation, 'succeeded'
      );
      raise exception 'provider accepted null required binding at %', required_path
        using errcode = 'P0001';
    exception
      when sqlstate '22023' or sqlstate 'RC409' then null;
    end;
  end loop;
end;
$$;

savepoint booking_request_provider_null_generation;
select throws_ok(
  format(
    'select public.execute_simulated_payment_provider_operation(%L::jsonb,%L)',
    (select jsonb_set(operation, '{leaseGeneration}', 'null'::jsonb)::text
      from preexpiry_provider_operation),
    'succeeded'
  ),
  '22023', null,
  'provider admission rejects a JSON null lease generation before casting'
);
rollback to savepoint booking_request_provider_null_generation;

savepoint booking_request_provider_null_token;
select throws_ok(
  format(
    'select public.execute_simulated_payment_provider_operation(%L::jsonb,%L)',
    (select jsonb_set(operation, '{leaseToken}', 'null'::jsonb)::text
      from preexpiry_provider_operation),
    'succeeded'
  ),
  '22023', null,
  'provider admission rejects a JSON null lease token before casting'
);
rollback to savepoint booking_request_provider_null_token;

savepoint booking_request_provider_null_lease;
select throws_ok(
  format(
    'select public.execute_simulated_payment_provider_operation(%L::jsonb,%L)',
    (select jsonb_set(
      jsonb_set(operation, '{leaseGeneration}', 'null'::jsonb),
      '{leaseToken}', 'null'::jsonb
    )::text from preexpiry_provider_operation),
    'succeeded'
  ),
  '22023', null,
  'provider admission rejects JSON null lease generation and token before casting'
);
rollback to savepoint booking_request_provider_null_lease;

select lives_ok(
  format(
    'select pg_temp.assert_null_release_bindings_rejected(%L::jsonb)',
    (select operation::text from preexpiry_provider_operation)
  ),
  'provider admission rejects every required lifecycle release binding when JSON null'
);
select throws_ok(
  format(
    'select public.execute_simulated_payment_provider_operation(%L::jsonb,null)',
    (select operation::text from preexpiry_provider_operation)
  ),
  '22023', null,
  'provider admission rejects a null requested outcome'
);
reset role;
select is(
  (select count(*)::integer from public.simulated_payment_provider_operations),
  1,
  'null lifecycle release bindings persist no provider execution'
);

savepoint booking_request_reconcile_movement_invention;
set local role service_role;
create temporary table preexpiry_indeterminate_provider_result as
select public.execute_simulated_payment_provider_operation(
  operation, 'indeterminate'
) as result
from preexpiry_provider_operation;
create temporary table preexpiry_invalid_reconcile_snapshot as
select snapshots.pending_snapshot || jsonb_build_object(
  'release', (snapshots.pending_snapshot -> 'release') || jsonb_build_object(
    'providerRequestId', provider.result ->> 'providerRequestId',
    'providerReference', provider.result ->> 'providerReference',
    'movementReference', provider.result ->> 'movementReference',
    'reconciliationRequired', true
  ),
  'movements', (snapshots.pending_snapshot -> 'movements') ||
    jsonb_build_array(jsonb_build_object(
      'kind', 'release', 'logicalOperationId', 'invented-release',
      'attemptId', 'invented-attempt', 'amountFils', 1,
      'movementReference', 'invented-movement',
      'recordedAt', '2099-08-21T18:00:00.000Z'
    ))
) as invalid_snapshot
from preexpiry_release_snapshot snapshots
cross join preexpiry_indeterminate_provider_result provider;
select throws_ok(
  format(
    'select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_generation from preexpiry_release_snapshot),
    (select lease_token from preexpiry_release_snapshot),
    (select invalid_snapshot::text from preexpiry_invalid_reconcile_snapshot),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  '22023', null,
  'a reconciliation-required release preserves the existing movement array exactly'
);
rollback to savepoint booking_request_reconcile_movement_invention;

set local role service_role;
create temporary table preexpiry_provider_result as
select public.execute_simulated_payment_provider_operation(
  operation, 'succeeded'
) as result
from preexpiry_provider_operation;
select is(
  (select result ->> 'outcome' from preexpiry_provider_result),
  'succeeded',
  'the provider admits generation one before its database lease expires'
);
reset role;
create temporary table preexpiry_release_success as
select snapshots.pending_snapshot || jsonb_build_object(
  'release', (snapshots.pending_snapshot -> 'release') || jsonb_build_object(
    'status', 'succeeded',
    'providerRequestId', provider.result ->> 'providerRequestId',
    'providerReference', provider.result ->> 'providerReference',
    'movementReference', provider.result ->> 'movementReference',
    'reconciliationRequired', false, 'retrySafe', false
  ),
  'movements', (snapshots.pending_snapshot -> 'movements') ||
    jsonb_build_array(jsonb_build_object(
      'kind', 'release',
      'logicalOperationId', snapshots.pending_snapshot -> 'release' ->> 'logicalOperationId',
      'attemptId', snapshots.pending_snapshot -> 'release' ->> 'attemptId',
      'amountFils', (snapshots.pending_snapshot -> 'release' ->> 'amountFils')::bigint,
      'movementReference', provider.result ->> 'movementReference',
      'recordedAt', '2099-08-21T18:00:00.000Z'
    ))
) as succeeded_snapshot
from preexpiry_release_snapshot snapshots
cross join preexpiry_provider_result provider;
grant select on preexpiry_release_success to service_role;

create temporary table preexpiry_release_state_before_invalid_evidence as
select
  (select to_jsonb(attempts) from public.booking_request_submission_attempts attempts
    where attempts.id = snapshots.attempt_id) as attempt_row,
  (select to_jsonb(work) from public.booking_request_release_work work
    where work.id = snapshots.work_id) as work_row,
  (select to_jsonb(operations) from public.booking_request_release_operations operations
    where operations.work_id = snapshots.work_id) as operation_row,
  (select to_jsonb(requests) from public.booking_requests requests
    join public.booking_request_submission_attempts attempts
      on attempts.booking_request_id = requests.id
    where attempts.id = snapshots.attempt_id) as request_row,
  (select to_jsonb(commitments) from public.cottage_booking_period_commitments commitments
    join public.booking_requests requests
      on requests.booking_period_commitment_id = commitments.id
    join public.booking_request_submission_attempts attempts
      on attempts.booking_request_id = requests.id
    where attempts.id = snapshots.attempt_id) as commitment_row,
  (select to_jsonb(provider_operations)
    from public.simulated_payment_provider_operations provider_operations
    join public.booking_request_release_operations operations
      on operations.provider_idempotency_key = provider_operations.provider_idempotency_key
    where operations.work_id = snapshots.work_id) as provider_row
from preexpiry_release_snapshot snapshots;

create temporary table preexpiry_invalid_release_movements (
  case_name text primary key,
  invalid_snapshot jsonb not null
);
insert into preexpiry_invalid_release_movements (case_name, invalid_snapshot)
select 'omits the actual release movement',
  jsonb_set(succeeded_snapshot, '{movements}',
    (succeeded_snapshot -> 'movements') - 1)
from preexpiry_release_success
union all
select 'appends invented movement evidence',
  jsonb_set(succeeded_snapshot, '{movements}',
    (succeeded_snapshot -> 'movements') || jsonb_build_array(jsonb_build_object(
      'kind', 'release', 'logicalOperationId', 'invented-release',
      'attemptId', 'invented-attempt', 'amountFils', 1,
      'movementReference', 'invented-movement',
      'recordedAt', '2099-08-21T18:00:00.000Z'
    )))
from preexpiry_release_success
union all
select 'alters the prior authorization movement',
  jsonb_set(succeeded_snapshot, '{movements,0,amountFils}', '1'::jsonb)
from preexpiry_release_success
union all
select 'changes the release movement kind',
  jsonb_set(succeeded_snapshot, '{movements,1,kind}', '"authorization"'::jsonb)
from preexpiry_release_success
union all
select 'changes the release movement amount',
  jsonb_set(succeeded_snapshot, '{movements,1,amountFils}', '1'::jsonb)
from preexpiry_release_success
union all
select 'changes the release movement logical operation',
  jsonb_set(succeeded_snapshot, '{movements,1,logicalOperationId}', '"invented-release"'::jsonb)
from preexpiry_release_success
union all
select 'changes the release movement physical attempt',
  jsonb_set(succeeded_snapshot, '{movements,1,attemptId}', '"invented-attempt"'::jsonb)
from preexpiry_release_success
union all
select 'changes the release movement provider reference',
  jsonb_set(succeeded_snapshot, '{movements,1,movementReference}', '"invented-movement"'::jsonb)
from preexpiry_release_success
union all
select 'changes the release provider request identifier',
  jsonb_set(succeeded_snapshot, '{release,providerRequestId}', '"invented-request"'::jsonb)
from preexpiry_release_success
union all
select 'changes the release provider operation reference',
  jsonb_set(succeeded_snapshot, '{release,providerReference}', '"invented-reference"'::jsonb)
from preexpiry_release_success;
grant select on preexpiry_invalid_release_movements to service_role;

create function pg_temp.assert_release_result_evidence_rejected(
  target_snapshot jsonb
) returns void
language plpgsql
as $$
begin
  begin
    perform public.save_booking_request_release_snapshot(
      (select work_id from preexpiry_release_snapshot),
      (select lease_generation from preexpiry_release_snapshot),
      (select lease_token from preexpiry_release_snapshot),
      target_snapshot,
      '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    );
    raise exception 'release save accepted invalid movement evidence'
      using errcode = 'P0001';
  exception
    when sqlstate '22023' then null;
  end;
end;
$$;

set local role service_role;
select lives_ok(
  format(
    'select pg_temp.assert_release_result_evidence_rejected(%L::jsonb)',
    invalid_snapshot::text
  ),
  'successful release snapshot ' || case_name
)
from preexpiry_invalid_release_movements
order by case_name;
reset role;

select results_eq(
  $$select
      to_jsonb(attempts), to_jsonb(work), to_jsonb(operations),
      to_jsonb(requests), to_jsonb(commitments), to_jsonb(provider_operations)
    from preexpiry_release_snapshot snapshots
    join public.booking_request_submission_attempts attempts
      on attempts.id = snapshots.attempt_id
    join public.booking_request_release_work work on work.id = snapshots.work_id
    join public.booking_request_release_operations operations
      on operations.work_id = snapshots.work_id
    join public.booking_requests requests
      on requests.id = attempts.booking_request_id
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.simulated_payment_provider_operations provider_operations
      on provider_operations.provider_idempotency_key = operations.provider_idempotency_key$$,
  $$select attempt_row, work_row, operation_row, request_row, commitment_row, provider_row
    from preexpiry_release_state_before_invalid_evidence$$,
  'invalid release movement evidence mutates no attempt, work, operation, request, hold, or provider row'
);

savepoint booking_request_finalize_null_lease_inputs;
select public.save_booking_request_release_snapshot(
  snapshots.work_id, snapshots.lease_generation, snapshots.lease_token,
  succeeded.succeeded_snapshot,
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
)
from preexpiry_release_snapshot snapshots
cross join preexpiry_release_success succeeded;

savepoint booking_request_finalize_null_generation;
select throws_ok(
  format(
    'select public.finalize_booking_request_release(%L::uuid,null,%L::uuid)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_token from preexpiry_release_snapshot)
  ),
  'RC409', null,
  'release finalization rejects a null lease generation'
);
rollback to savepoint booking_request_finalize_null_generation;

savepoint booking_request_finalize_null_token;
select throws_ok(
  format(
    'select public.finalize_booking_request_release(%L::uuid,%L::bigint,null)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_generation from preexpiry_release_snapshot)
  ),
  'RC409', null,
  'release finalization rejects a null lease token'
);
rollback to savepoint booking_request_finalize_null_token;

savepoint booking_request_finalize_null_lease;
select throws_ok(
  format(
    'select public.finalize_booking_request_release(%L::uuid,null,null)',
    (select work_id from preexpiry_release_snapshot)
  ),
  'RC409', null,
  'release finalization rejects a null lease generation and token'
);
rollback to savepoint booking_request_finalize_null_lease;

select results_eq(
  $$select requests.status, work.state, claims.state,
      commitments.status, bool_and(occupancies.active),
      count(distinct notifications.id)::integer
    from public.booking_requests requests
    join public.booking_request_submission_attempts attempts
      on attempts.booking_request_id = requests.id
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_release_work work on work.attempt_id = attempts.id
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = commitments.id
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    where requests.id = (select id from booking_request_lifecycle_target)
    group by requests.status, work.state, claims.state, commitments.status$$,
  $$values ('processing'::text, 'processing'::text,
      'converted'::public.booking_request_authorization_claim_state,
      'pending_hold'::public.cottage_inventory_commitment_status,
      true, 0::integer)$$,
  'null finalize lease inputs change no request, release work, hold, occupancy, or notice'
);
rollback to savepoint booking_request_finalize_null_lease_inputs;

update public.booking_request_release_work
set lease_expires_at = clock_timestamp() - interval '1 millisecond'
where id = (select work_id from preexpiry_release_snapshot);
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_generation from preexpiry_release_snapshot),
    (select lease_token from preexpiry_release_snapshot),
    (select succeeded_snapshot::text from preexpiry_release_success),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'RC409', null,
  'an admitted generation-one result cannot save after lease expiry'
);
select throws_ok(
  format(
    'select public.finalize_booking_request_release(%L::uuid,%L::bigint,%L::uuid)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_generation from preexpiry_release_snapshot),
    (select lease_token from preexpiry_release_snapshot)
  ),
  'RC409', null,
  'an expired generation cannot finalize product state'
);
create temporary table preexpiry_reclaimed_work as
select public.claim_booking_request_action(
  (select customer_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),
  'withdraw', null, null
) as result;
select results_eq(
  $$select reclaimed.result ->> 'status',
      (reclaimed.result ->> 'leaseGeneration')::bigint,
      reclaimed.result ->> 'leaseToken' <> original.lease_token::text
    from preexpiry_reclaimed_work reclaimed
    cross join preexpiry_release_snapshot original$$,
  $$select 'release-required'::text, lease_generation + 1, true
    from preexpiry_release_snapshot$$,
  'generation two receives a new token while retaining the same release work'
);
reset role;
select results_eq(
  $$select operations.state, operations.provider_outcome,
      attempts.payment_snapshot -> 'release' ->> 'attemptId',
      (attempts.payment_snapshot -> 'release' ->> 'reconciliationRequired')::boolean,
      requests.status, commitments.status::text,
      bool_and(occupancies.active), count(notifications.id)::integer
    from public.booking_request_release_operations operations
    join public.booking_request_release_work work on work.id = operations.work_id
    join public.booking_request_submission_attempts attempts on attempts.id = work.attempt_id
    join public.booking_requests requests on requests.id = work.booking_request_id
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = commitments.id
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    group by operations.state, operations.provider_outcome,
      attempts.payment_snapshot, requests.status, commitments.status$$,
  $$select 'reconcile_required'::text, 'unknown'::text,
      pending_snapshot -> 'release' ->> 'attemptId', true,
      'processing'::text, 'pending_hold'::text, true, 0::integer
    from preexpiry_release_snapshot$$,
  'reclaim fences stale writes without treating lease expiry as provider cancellation'
);

set local role service_role;
create temporary table preexpiry_reconciled_result as
select public.query_simulated_payment_provider_operation(
  jsonb_build_object(
    'providerIdentity', jsonb_build_object(
      'provider', 'fictional-payments', 'environment', 'local-test',
      'merchantId', 'fictional-merchant', 'terminalId', 'fictional-terminal'
    ),
    'requestFingerprint', null,
    'paymentLifecycleId', pending_snapshot ->> 'paymentLifecycleId',
    'logicalOperationId', pending_snapshot -> 'release' ->> 'logicalOperationId',
    'physicalAttemptId', pending_snapshot -> 'release' ->> 'attemptId',
    'operationKind', 'release',
    'amountFils', (pending_snapshot -> 'release' ->> 'amountFils')::bigint,
    'currency', 'IQD'
  ),
  provider.result ->> 'providerRequestId',
  provider.result ->> 'providerReference',
  'succeeded'
) as result
from preexpiry_release_snapshot
cross join preexpiry_provider_result provider;
select is(
  (select result ->> 'outcome' from preexpiry_reconciled_result),
  'succeeded',
  'generation two reconciles the exact admitted generation-one provider binding'
);
select public.save_booking_request_release_snapshot(
  (select work_id from preexpiry_release_snapshot),
  ((select result ->> 'leaseGeneration' from preexpiry_reclaimed_work))::bigint,
  ((select result ->> 'leaseToken' from preexpiry_reclaimed_work))::uuid,
  (select succeeded_snapshot from preexpiry_release_success),
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
);
create temporary table preexpiry_finalized as
select public.finalize_booking_request_release(
  (select work_id from preexpiry_release_snapshot),
  ((select result ->> 'leaseGeneration' from preexpiry_reclaimed_work))::bigint,
  ((select result ->> 'leaseToken' from preexpiry_reclaimed_work))::uuid
) as result;
select is(
  (select result ->> 'status' from preexpiry_finalized),
  'withdrawn',
  'only the current generation finalizes the reconciled release'
);
reset role;
select results_eq(
  $$select requests.status, work.state, commitments.status::text,
      bool_and(not occupancies.active), count(distinct notifications.id)::integer,
      count(distinct operations.id)::integer,
      count(distinct provider.id)::integer,
      jsonb_array_length(attempts.payment_snapshot -> 'movements')
    from public.booking_requests requests
    join public.booking_request_release_work work on work.booking_request_id = requests.id
    join public.booking_request_submission_attempts attempts on attempts.id = work.attempt_id
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = commitments.id
    join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    join public.booking_request_release_operations operations on operations.work_id = work.id
    join public.simulated_payment_provider_operations provider
      on provider.payment_lifecycle_id = attempts.payment_lifecycle_id
      and provider.operation_kind = 'release'
    group by requests.status, work.state, commitments.status, attempts.payment_snapshot$$,
  $$values ('withdrawn'::text, 'complete'::text, 'released_hold'::text,
    true, 2::integer, 1::integer, 1::integer, 2::integer)$$,
  'reconciliation produces one release, released hold, terminal outcome, and notice pair'
);

set local role anon;
select results_eq(
  $$select unit ->> 'kind', (unit ->> 'available')::boolean
    from jsonb_array_elements(public.resolve_cottage_inventory_public_availability(
      '30000000-0000-4000-8000-000000003201',
      '60000000-0000-4000-8000-000000003201', '2099-08-21'
    ) -> 'units') unit
    where unit ->> 'id' in (
      '62000000-0000-4000-8000-000000003202',
      '61000000-0000-4000-8000-000000003201'
    ) order by unit ->> 'kind'$$,
  $$values ('full_day_bundle'::text, true), ('shift'::text, true)$$,
  'a successful Shift release restores its Shift and derived Full-Day public availability'
);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select results_eq(
  $$select unit ->> 'kind', unit ->> 'calendarState',
      unit ->> 'commitmentReference', (unit ->> 'editable')::boolean
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000003201',
      '60000000-0000-4000-8000-000000003201', '2099-08-21'
    ) -> 'units') unit
    where unit ->> 'id' in (
      '62000000-0000-4000-8000-000000003202',
      '61000000-0000-4000-8000-000000003201'
    ) order by unit ->> 'kind'$$,
  $$values
    ('full_day_bundle'::text, 'open'::text, null::text, true),
    ('shift'::text, 'open'::text, null::text, true)$$,
  'the Owner Calendar treats released Shift history as open and editable'
);
select lives_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201', '2099-08-21',
    '[{"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003202","state":"closed"},{"unitKind":"full_day_bundle","unitId":"61000000-0000-4000-8000-000000003201","state":"closed"}]'::jsonb
  )$$,
  'released occupancy history does not block changed-state Owner writes'
);
select throws_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201', '2099-08-21',
    '[{"unitKind":"full_day_bundle","unitId":"61000000-0000-4000-8000-000000003201","state":"open"}]'::jsonb
  )$$,
  'RC205', null,
  'a released occupancy cannot hide a closed component when reopening its Full-Day Bundle'
);
reset role;
select results_eq(
  $$select
      count(*) filter (where availability.state = 'closed')::integer,
      count(*) filter (where not occupancies.active)::integer
    from public.cottage_inventory_availability availability
    cross join public.cottage_booking_period_occupancies occupancies
    where availability.schedule_revision_id = '60000000-0000-4000-8000-000000003201'
      and availability.service_day = '2099-08-21'
      and availability.unit_id in (
        '62000000-0000-4000-8000-000000003202',
        '61000000-0000-4000-8000-000000003201'
      )
      and occupancies.booking_period_commitment_id = (
        select booking_period_commitment_id from public.booking_requests limit 1
      )$$,
  $$values (2::integer, 2::integer)$$,
  'failed Bundle reopening mutates no availability and preserves inactive occupancy history'
);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select lives_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201', '2099-08-21',
    '[{"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003202","state":"open"},{"unitKind":"full_day_bundle","unitId":"61000000-0000-4000-8000-000000003201","state":"open"}]'::jsonb
  )$$,
  'the Owner can restore a released Shift and its Full-Day Bundle together'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select lives_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201',
    '{"units":[
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003201","standardPriceIqd":100000},
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003202","standardPriceIqd":110000,"dateOverrides":[{"serviceDay":"2099-08-21","priceIqd":111000}]},
      {"unitKind":"full_day_bundle","unitId":"61000000-0000-4000-8000-000000003201","standardPriceIqd":190000}
    ]}'::jsonb
  )$$,
  'released Shift history permits a direct future specific-date price change'
);
reset role;
select results_eq(
  $$select
      (select price_iqd from public.cottage_inventory_date_price_overrides
        where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
          and unit_kind = 'shift'::public.cottage_inventory_unit_kind
          and unit_id = '62000000-0000-4000-8000-000000003202'
          and service_day = '2099-08-21'),
      (select committed_price_iqd from public.cottage_inventory_commitments items
        join public.booking_requests requests
          on requests.booking_period_commitment_id = items.booking_period_commitment_id
        where items.unit_kind = 'shift'::public.cottage_inventory_unit_kind
          and items.unit_id = '62000000-0000-4000-8000-000000003202'
          and items.service_day = '2099-08-21'),
      (select count(*)::integer from public.cottage_booking_period_occupancies occupancies
        join public.booking_requests requests
          on requests.booking_period_commitment_id = occupancies.booking_period_commitment_id
        where occupancies.shift_id = '62000000-0000-4000-8000-000000003202'
          and occupancies.service_day = '2099-08-21'
          and not occupancies.active)$$,
  $$values (111000::bigint, 110000::bigint, 1::integer)$$,
  'released Shift pricing retains its committed price and inactive occupancy history'
);

insert into public.cottage_booking_period_commitments (
  id, customer_user_id, profile_id, schedule_revision_id,
  commitment_reference, status, access_ranges
) values (
  '70000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003203',
  '30000000-0000-4000-8000-000000003201',
  '60000000-0000-4000-8000-000000003201',
  'RC-RELEASED-BUNDLE-3201', 'released_hold',
  tstzmultirange(tstzrange('2099-08-22 05:00+00', '2099-08-22 20:00+00', '[)'))
);
insert into public.cottage_inventory_commitments (
  booking_period_commitment_id, unit_kind, unit_id, service_day, committed_price_iqd
) values (
  '70000000-0000-4000-8000-000000003201', 'full_day_bundle',
  '61000000-0000-4000-8000-000000003201', '2099-08-22', 190000
);
insert into public.cottage_booking_period_occupancies (
  booking_period_commitment_id, schedule_revision_id, shift_id, service_day, active
)
select '70000000-0000-4000-8000-000000003201',
  '60000000-0000-4000-8000-000000003201', shifts.id, '2099-08-22', false
from public.cottage_shifts shifts
where shifts.schedule_revision_id = '60000000-0000-4000-8000-000000003201';

set local role anon;
select results_eq(
  $$select count(*)::integer
    from jsonb_array_elements(public.resolve_cottage_inventory_public_availability(
      '30000000-0000-4000-8000-000000003201',
      '60000000-0000-4000-8000-000000003201', '2099-08-22'
    ) -> 'units') unit
    where (unit ->> 'available')::boolean$$,
  $$values (3::integer)$$,
  'released Full-Day history restores its direct Bundle and both derived Shifts publicly'
);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select results_eq(
  $$select count(*)::integer
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000003201',
      '60000000-0000-4000-8000-000000003201', '2099-08-22'
    ) -> 'units') unit
    where unit ->> 'calendarState' = 'open'
      and unit ->> 'commitmentReference' is null
      and (unit ->> 'editable')::boolean$$,
  $$values (3::integer)$$,
  'the Owner Calendar ignores direct and bundle-derived released Full-Day history'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select lives_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201',
    '{"units":[
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003201","standardPriceIqd":100000},
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003202","standardPriceIqd":110000},
      {"unitKind":"full_day_bundle","unitId":"61000000-0000-4000-8000-000000003201","standardPriceIqd":190000,"dateOverrides":[{"serviceDay":"2099-08-22","priceIqd":191000}]}
    ]}'::jsonb
  )$$,
  'released Full-Day history permits a direct future specific-date price change'
);
reset role;
select results_eq(
  $$select
      (select price_iqd from public.cottage_inventory_date_price_overrides
        where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
          and unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
          and unit_id = '61000000-0000-4000-8000-000000003201'
          and service_day = '2099-08-22'),
      (select committed_price_iqd from public.cottage_inventory_commitments
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003201'),
      (select count(*) filter (where not active)::integer
        from public.cottage_booking_period_occupancies
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003201')$$,
  $$values (191000::bigint, 190000::bigint, 2::integer)$$,
  'released Full-Day pricing preserves its committed price and both inactive component occupancies'
);

insert into public.cottage_shift_schedule_revisions (
  id, profile_id, revision, full_day_bundle_id
) values (
  '60000000-0000-4000-8000-000000003202',
  '30000000-0000-4000-8000-000000003201', 2,
  '61000000-0000-4000-8000-000000003202'
);

savepoint booking_request_active_confirmed_inventory_control;
insert into public.cottage_booking_period_commitments (
  id, customer_user_id, profile_id, schedule_revision_id,
  commitment_reference, status, access_ranges
) values (
  '70000000-0000-4000-8000-000000003202',
  '00000000-0000-0000-0000-000000003203',
  '30000000-0000-4000-8000-000000003201',
  '60000000-0000-4000-8000-000000003201',
  'RC-ACTIVE-CONFIRMED-3201', 'confirmed_booking',
  tstzmultirange(tstzrange('2099-08-22 05:00+00', '2099-08-22 09:00+00', '[)'))
);
insert into public.cottage_inventory_commitments (
  booking_period_commitment_id, unit_kind, unit_id, service_day, committed_price_iqd
) values (
  '70000000-0000-4000-8000-000000003202', 'shift',
  '62000000-0000-4000-8000-000000003201', '2099-08-22', 100000
);
insert into public.cottage_booking_period_occupancies (
  booking_period_commitment_id, schedule_revision_id, shift_id, service_day
) values (
  '70000000-0000-4000-8000-000000003202',
  '60000000-0000-4000-8000-000000003201',
  '62000000-0000-4000-8000-000000003201', '2099-08-22'
);
set local role anon;
select results_eq(
  $$select unit ->> 'kind', (unit ->> 'available')::boolean
    from jsonb_array_elements(public.resolve_cottage_inventory_public_availability(
      '30000000-0000-4000-8000-000000003201',
      '60000000-0000-4000-8000-000000003201', '2099-08-22'
    ) -> 'units') unit
    where unit ->> 'id' in (
      '62000000-0000-4000-8000-000000003201',
      '61000000-0000-4000-8000-000000003201'
    ) order by unit ->> 'kind'$$,
  $$values ('full_day_bundle'::text, false), ('shift'::text, false)$$,
  'an active Confirmed Booking still blocks its Shift and derived Full-Day Bundle'
);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select throws_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201', '2099-08-22',
    '[{"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003201","state":"closed"}]'::jsonb
  )$$,
  'RC204', null,
  'an active Confirmed Booking still blocks changed-state Owner writes'
);
reset role;
select results_eq(
  $$select availability.state::text, occupancies.active
    from public.cottage_inventory_availability availability
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.schedule_revision_id = availability.schedule_revision_id
      and occupancies.shift_id = availability.unit_id
      and occupancies.service_day = availability.service_day
    where occupancies.booking_period_commitment_id =
      '70000000-0000-4000-8000-000000003202'$$,
  $$values ('open'::text, true)$$,
  'a blocked active-Booking write mutates neither inventory nor occupancy'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select throws_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201',
    '{"units":[
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003201","standardPriceIqd":100000,"dateOverrides":[{"serviceDay":"2099-08-22","priceIqd":101000}]},
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003202","standardPriceIqd":110000},
      {"unitKind":"full_day_bundle","unitId":"61000000-0000-4000-8000-000000003201","standardPriceIqd":190000}
    ]}'::jsonb
  )$$,
  'RC204', null,
  'an active Confirmed Shift Booking rejects a direct specific-date price change'
);
reset role;
select results_eq(
  $$select
      (select count(*)::integer from public.cottage_inventory_date_price_overrides
        where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
          and unit_kind = 'shift'::public.cottage_inventory_unit_kind
          and unit_id = '62000000-0000-4000-8000-000000003201'
          and service_day = '2099-08-22'),
      (select committed_price_iqd from public.cottage_inventory_commitments
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003202'),
      (select active from public.cottage_booking_period_occupancies
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003202')$$,
  $$values (0::integer, 100000::bigint, true)$$,
  'a rejected active Shift price change leaves pricing and committed occupancy unchanged'
);

insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select schedule_revision_id, unit_kind, unit_id, '2099-08-23', 'open'
from public.cottage_inventory_standard_prices
where schedule_revision_id = '60000000-0000-4000-8000-000000003201';
insert into public.cottage_booking_period_commitments (
  id, customer_user_id, profile_id, schedule_revision_id,
  commitment_reference, status, access_ranges
) values (
  '70000000-0000-4000-8000-000000003203',
  '00000000-0000-0000-0000-000000003202',
  '30000000-0000-4000-8000-000000003201',
  '60000000-0000-4000-8000-000000003201',
  'RC-ACTIVE-FULL-DAY-3201', 'confirmed_booking',
  tstzmultirange(tstzrange('2099-08-23 05:00+00', '2099-08-23 20:00+00', '[)'))
);
insert into public.cottage_inventory_commitments (
  booking_period_commitment_id, unit_kind, unit_id, service_day, committed_price_iqd
) values (
  '70000000-0000-4000-8000-000000003203', 'full_day_bundle',
  '61000000-0000-4000-8000-000000003201', '2099-08-23', 190000
);
insert into public.cottage_booking_period_occupancies (
  booking_period_commitment_id, schedule_revision_id, shift_id, service_day
)
select '70000000-0000-4000-8000-000000003203',
  '60000000-0000-4000-8000-000000003201', shifts.id, '2099-08-23'
from public.cottage_shifts shifts
where shifts.schedule_revision_id = '60000000-0000-4000-8000-000000003201';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select throws_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201',
    '{"units":[
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003201","standardPriceIqd":100000},
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003202","standardPriceIqd":110000},
      {"unitKind":"full_day_bundle","unitId":"61000000-0000-4000-8000-000000003201","standardPriceIqd":190000,"dateOverrides":[{"serviceDay":"2099-08-23","priceIqd":191000}]}
    ]}'::jsonb
  )$$,
  'RC204', null,
  'an active Confirmed Full-Day Booking rejects a direct specific-date price change'
);
reset role;
select results_eq(
  $$select
      (select count(*)::integer from public.cottage_inventory_date_price_overrides
        where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
          and unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
          and unit_id = '61000000-0000-4000-8000-000000003201'
          and service_day = '2099-08-23'),
      (select committed_price_iqd from public.cottage_inventory_commitments
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003203'),
      (select count(*) filter (where active)::integer
        from public.cottage_booking_period_occupancies
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003203')$$,
  $$values (0::integer, 190000::bigint, 2::integer)$$,
  'a rejected active Full-Day price change leaves pricing and both committed occupancies unchanged'
);

select throws_ok(
  $$update public.owner_application_cottage_profiles
    set current_shift_schedule_id = '60000000-0000-4000-8000-000000003202'
    where id = '30000000-0000-4000-8000-000000003201'$$,
  'RC204', null,
  'an active Booking prevents replacement of its current Shift Schedule'
);
select results_eq(
  $$select
      (select current_shift_schedule_id from public.owner_application_cottage_profiles
        where id = '30000000-0000-4000-8000-000000003201'),
      (select count(*)::integer from public.cottage_shift_schedule_revisions
        where id = '60000000-0000-4000-8000-000000003201'),
      (select count(*)::integer from public.cottage_inventory_commitments
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003203'),
      (select count(*) filter (where active)::integer
        from public.cottage_booking_period_occupancies
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003203')$$,
  $$values ('60000000-0000-4000-8000-000000003201'::uuid, 1::integer, 1::integer, 2::integer)$$,
  'a rejected active schedule replacement preserves its pointer, revision, commitment, and occupancy audit'
);
rollback to savepoint booking_request_active_confirmed_inventory_control;

select lives_ok(
  $$update public.owner_application_cottage_profiles
    set current_shift_schedule_id = '60000000-0000-4000-8000-000000003202'
    where id = '30000000-0000-4000-8000-000000003201'$$,
  'released future inventory permits replacement of its current Shift Schedule'
);
select results_eq(
  $$select
      (select current_shift_schedule_id from public.owner_application_cottage_profiles
        where id = '30000000-0000-4000-8000-000000003201'),
      (select count(*)::integer from public.cottage_shift_schedule_revisions
        where id = '60000000-0000-4000-8000-000000003201'),
      (select count(*)::integer from public.cottage_booking_period_commitments periods
        join public.booking_requests requests
          on requests.booking_period_commitment_id = periods.id),
      (select count(*)::integer from public.cottage_inventory_commitments items
        join public.booking_requests requests
          on requests.booking_period_commitment_id = items.booking_period_commitment_id),
      (select count(*)::integer from public.cottage_booking_period_occupancies occupancies
        join public.booking_requests requests
          on requests.booking_period_commitment_id = occupancies.booking_period_commitment_id
        where not occupancies.active)$$,
  $$values ('60000000-0000-4000-8000-000000003202'::uuid, 1::integer, 1::integer, 1::integer, 1::integer)$$,
  'released schedule replacement preserves its old revision, commitment, item, and inactive occupancy audit'
);
rollback to savepoint booking_request_preexpiry_admission_reconcile;

savepoint booking_request_failed_release_retry;
set local role service_role;
select public.claim_booking_request_action(
  (select customer_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),
  'withdraw', null, null
);
reset role;
create temporary table failed_release_retry_snapshots as
select attempts.id as attempt_id, work.id as work_id,
  work.lease_generation, work.lease_token,
  jsonb_set(attempts.payment_snapshot, '{release}', jsonb_build_object(
    'paymentLifecycleId', attempts.payment_lifecycle_id,
    'kind', 'release',
    'logicalOperationId', attempts.payment_lifecycle_id::text || ':release',
    'attemptId', attempts.payment_lifecycle_id::text || ':release:attempt-2',
    'status', 'pending',
    'amountFils', claims.amount_fils,
    'providerRequestId', null, 'providerReference', null,
    'movementReference', null, 'reconciliationRequired', false,
    'retrySafe', false
  )) as pending_one
from public.booking_request_submission_attempts attempts
join public.booking_request_authorization_claims claims
  on claims.payment_lifecycle_id = attempts.payment_lifecycle_id
join public.booking_request_release_work work on work.attempt_id = attempts.id
where attempts.booking_request_id = (select id from booking_request_lifecycle_target);
alter table failed_release_retry_snapshots
  add column failed_one jsonb,
  add column pending_two jsonb;
grant select, update on failed_release_retry_snapshots to service_role;
set local role service_role;
create temporary table failed_release_retry_permit as
select public.save_booking_request_release_snapshot(
  work_id, lease_generation, lease_token, pending_one,
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as permit
from failed_release_retry_snapshots;
select is(
  (select permit ->> 'purpose' from failed_release_retry_permit),
  'booking-request-release',
  'a first physical release attempt is durably claimed'
);
reset role;
select throws_ok(
  $$update public.booking_request_release_operations
    set amount_fils = amount_fils + 1$$,
  'RC204', null,
  'release-operation amount and provider bindings are immutable'
);
select throws_ok(
  $$update public.booking_request_release_operations
    set state = 'retryable'$$,
  'RC204', null,
  'a release operation cannot become retryable without its required output shape'
);
select throws_ok(
  $$insert into public.booking_request_release_operations (
      id, work_id, attempt_id, operation_generation, payment_lifecycle_id,
      logical_operation_id, physical_attempt_id, amount_fils, currency,
      provider, environment, merchant_id, terminal_id,
      provider_idempotency_key, request_fingerprint, state,
      provider_outcome, execution_started_at
    )
    select gen_random_uuid(), work_id, attempt_id, operation_generation + 100,
      payment_lifecycle_id, logical_operation_id, physical_attempt_id || '-invalid',
      amount_fils, currency, provider, environment, merchant_id, terminal_id,
      provider_idempotency_key || '-invalid', request_fingerprint,
      'executing', 'failed', clock_timestamp()
    from public.booking_request_release_operations$$,
  'RC204', null,
  'invalid release-operation output shapes fail on insertion as well as update'
);
set local role service_role;
select throws_ok(
  (select format(
    'select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    work_id, lease_generation, lease_token,
    jsonb_set(pending_one, '{release,attemptId}',
      to_jsonb((pending_one ->> 'paymentLifecycleId') || ':release:attempt-3')),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ) from failed_release_retry_snapshots),
  'RC409', null,
  'operation N plus one cannot start before N is durably retryable'
);
create temporary table failed_release_retry_provider_result as
select public.execute_simulated_payment_provider_operation(
  jsonb_build_object(
    'providerIdentity', jsonb_build_object(
      'provider', 'fictional-payments', 'environment', 'local-test',
      'merchantId', 'fictional-merchant', 'terminalId', 'fictional-terminal'
    ),
    'permitPurpose', permit ->> 'purpose',
    'idempotencyKey', permit ->> 'idempotencyKey',
    'requestFingerprint', permit ->> 'requestFingerprint',
    'notAfter', permit ->> 'notAfter',
    'paymentLifecycleId', pending_one ->> 'paymentLifecycleId',
    'logicalOperationId', pending_one -> 'release' ->> 'logicalOperationId',
    'physicalAttemptId', pending_one -> 'release' ->> 'attemptId',
    'operationKind', 'release',
    'amountFils', (pending_one -> 'release' ->> 'amountFils')::bigint,
    'currency', 'IQD', 'claimId', null, 'claimGeneration', null,
    'stateRevision', null, 'cleanupAttemptId', null,
    'workId', permit ->> 'workId',
    'leaseGeneration', (permit ->> 'leaseGeneration')::bigint,
    'leaseToken', permit ->> 'leaseToken',
    'operationId', permit ->> 'operationId',
    'operationGeneration', (permit ->> 'operationGeneration')::integer
  ), 'failed'
) as result
from failed_release_retry_snapshots, failed_release_retry_permit;
select is(
  (select result ->> 'outcome' from failed_release_retry_provider_result),
  'failed',
  'the provider ledger proves attempt N failed before retry is allowed'
);
update failed_release_retry_snapshots snapshots set failed_one =
  jsonb_set(jsonb_set(jsonb_set(jsonb_set(pending_one,
    '{release,status}', '"failed"'::jsonb),
    '{release,providerRequestId}', to_jsonb(results.result ->> 'providerRequestId')),
    '{release,providerReference}', to_jsonb(results.result ->> 'providerReference')),
    '{release,retrySafe}', 'true'::jsonb)
from failed_release_retry_provider_result results;
update failed_release_retry_snapshots set pending_two =
  jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(failed_one,
    '{release,status}', '"pending"'::jsonb),
    '{release,attemptId}', to_jsonb((failed_one ->> 'paymentLifecycleId') || ':release:attempt-3')),
    '{release,providerRequestId}', 'null'::jsonb),
    '{release,providerReference}', 'null'::jsonb),
    '{release,retrySafe}', 'false'::jsonb);

savepoint booking_request_retryable_release_movement_invention;
select throws_ok(
  (select format(
    'select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    work_id, lease_generation, lease_token,
    jsonb_set(
      failed_one,
      '{movements}',
      (failed_one -> 'movements') || jsonb_build_array(jsonb_build_object(
        'kind', 'release', 'logicalOperationId', 'invented-release',
        'attemptId', 'invented-attempt', 'amountFils', 1,
        'movementReference', 'invented-movement',
        'recordedAt', '2099-08-21T18:00:00.000Z'
      ))
    ),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ) from failed_release_retry_snapshots),
  '22023', null,
  'a retryable failed release preserves the existing movement array exactly'
);
rollback to savepoint booking_request_retryable_release_movement_invention;
set local role service_role;
select lives_ok(
  (select format('select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    work_id, lease_generation, lease_token, failed_one,
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')
  from failed_release_retry_snapshots),
  'a definitive retry-safe release failure is durably retained'
);
reset role;
select throws_ok(
  $$update public.booking_request_release_operations
    set updated_at = clock_timestamp()$$,
  'RC204', null,
  'a retryable release operation is terminal and cannot be rewritten'
);
set local role service_role;
select lives_ok(
  (select format('select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    work_id, lease_generation, lease_token, pending_two,
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')
  from failed_release_retry_snapshots),
  'the same logical release starts the next physical attempt'
);
reset role;
select results_eq(
  $$select attempts.state, attempts.payment_snapshot -> 'release' ->> 'status',
      attempts.payment_snapshot -> 'release' ->> 'attemptId'
    from public.booking_request_submission_attempts attempts
    where attempts.booking_request_id = (select id from booking_request_lifecycle_target)$$,
  $$select 'releasing'::text, 'pending'::text,
      pending_two -> 'release' ->> 'attemptId'
    from failed_release_retry_snapshots$$,
  'retry recovery holds inventory while attempt N+1 awaits provider settlement'
);
rollback to savepoint booking_request_failed_release_retry;

savepoint booking_request_deadline_equality;
update public.booking_requests
set created_at = timed.deadline - interval '4 hours',
  response_deadline = timed.deadline
from (select clock_timestamp() as deadline) timed;
set local role service_role;
select is(
  public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target),
    'accept', null, null
  ) ->> 'status',
  'release-required',
  'deadline equality belongs to expiry even when the Owner submits acceptance'
);
reset role;
select is(
  (select outcome from public.booking_request_release_work limit 1),
  'expired',
  'the database clock records expiry as the winning outcome at the deadline'
);
rollback to savepoint booking_request_deadline_equality;

savepoint booking_request_automatic_expiry;
update public.booking_requests
set created_at = due.deadline - interval '4 hours',
  response_deadline = due.deadline
from (select clock_timestamp() as deadline) due;
set local role service_role;
select throws_ok(
  'select public.claim_due_booking_request_releases(null)',
  '22023', null,
  'the bounded internal runner rejects a null claim limit'
);
reset role;
select results_eq(
  $$select requests.status, claims.state,
      count(distinct work.id)::integer,
      count(distinct notifications.id)::integer
    from public.booking_requests requests
    join public.booking_request_submission_attempts attempts
      on attempts.booking_request_id = requests.id
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    left join public.booking_request_release_work work
      on work.attempt_id = attempts.id
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    where requests.id = (select id from booking_request_lifecycle_target)
    group by requests.status, claims.state$$,
  $$values ('pending'::text, 'converted'::public.booking_request_authorization_claim_state,
      0::integer, 0::integer)$$,
  'a null due-runner limit leases no release work and changes no product state'
);
set local role service_role;
select is(
  public.claim_due_booking_request_releases(20) -> 0 ->> 'status',
  'release-required',
  'the bounded internal runner claims an unanswered request for expiry without a user expire action'
);
reset role;
rollback to savepoint booking_request_automatic_expiry;

savepoint booking_request_terminal_rebooking;
update public.booking_requests set status = 'declined';
update public.booking_request_submission_attempts
set intent_dedupe_active = false;
update public.cottage_booking_period_commitments
set status = 'released_hold';
update public.cottage_booking_period_occupancies set active = false;
set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    (select submission from valid_submission)
  ) ->> 'status',
  'declined',
  'the original idempotency key projects the real terminal request status'
);
create temporary table terminal_rebooking as
select public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202',
  '11111111-1111-4111-8111-111111113299',
  (select submission from valid_submission)
) as result;
reset role;
select results_eq(
  $$select (select result ->> 'status' from terminal_rebooking),
      (select count(*)::integer
        from public.booking_request_submission_attempts)$$,
  $$values ('ready'::text, 2::integer)$$,
  'a new idempotency key can create the same intent after unsuccessful terminal release'
);
rollback to savepoint booking_request_terminal_rebooking;

select results_eq(
  $$select booking_terms_version, booking_terms_locale::text,
      booking_terms_sha256,
      booking_terms_sha256 = encode(
        extensions.digest(convert_to(booking_terms_body, 'UTF8'), 'sha256'
      ), 'hex'),
      booking_terms_body like 'FICTIONAL LOCAL TEST TERMS — NOT A LEGAL AGREEMENT%'
    from public.booking_snapshots$$,
  $$values (
      'fictional-local-test-2026-08-22-v1'::text,
      'en'::text,
      '54c3ef684633e5308baf6511318fcfc422842239c22776f81d655c230ecd107d'::text,
      true,
      true
    )$$,
  'the immutable snapshot preserves the complete fictional terms identity and body'
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
      'marketplaceTermsAcceptance', 'I accept the marketplace booking terms. (fictional-local-test-2026-08-22-v1)',
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

savepoint terminal_reconciliation_markers_are_monotonic;
create temporary table terminal_marker_cases (
  case_name text primary key,
  attempt_id uuid not null,
  claim_id uuid not null,
  idempotency_key uuid not null,
  payment_lifecycle_id uuid not null,
  attempt_state text not null,
  claim_state public.booking_request_authorization_claim_state not null,
  intent_fingerprint text not null
) on commit drop;
insert into terminal_marker_cases values
  ('finalized',
    '45000000-0000-4000-8000-000000003201',
    '45300000-0000-4000-8000-000000003201',
    '45100000-0000-4000-8000-000000003201',
    '45200000-0000-4000-8000-000000003201',
    'finalized', 'converted', repeat('1', 64)),
  ('released',
    '45000000-0000-4000-8000-000000003202',
    '45300000-0000-4000-8000-000000003202',
    '45100000-0000-4000-8000-000000003202',
    '45200000-0000-4000-8000-000000003202',
    'released', 'released', repeat('2', 64)),
  ('authorization_failed',
    '45000000-0000-4000-8000-000000003203',
    '45300000-0000-4000-8000-000000003203',
    '45100000-0000-4000-8000-000000003203',
    '45200000-0000-4000-8000-000000003203',
    'authorization_failed', 'failed', repeat('3', 64));
insert into public.booking_request_submission_attempts (
  id, customer_user_id, idempotency_key, payment_lifecycle_id, profile_id,
  locale, public_slug, requested_search, quote_fingerprint, quote_payload,
  intent_fingerprint, intent_payload, payment_snapshot, state,
  created_at, updated_at
)
select cases.attempt_id, source.customer_user_id, cases.idempotency_key,
  cases.payment_lifecycle_id, source.profile_id, source.locale,
  source.public_slug, source.requested_search, source.quote_fingerprint,
  source.quote_payload, cases.intent_fingerprint,
  source.intent_payload || jsonb_build_object('terminalMarkerCase', cases.case_name),
  source.payment_snapshot || jsonb_build_object('terminalMarkerCase', cases.case_name),
  cases.attempt_state, source.created_at,
  clock_timestamp() - interval '5 minutes'
from terminal_marker_cases cases
cross join public.booking_request_submission_attempts source
where source.id = (select (result ->> 'attemptId')::uuid from prepared_submission);
insert into public.booking_request_authorization_claims (
  id, attempt_id, generation, state_revision, state, customer_user_id,
  profile_id, schedule_revision_id, payment_lifecycle_id,
  logical_operation_id, physical_attempt_id, amount_fils, currency,
  provider, environment, merchant_id, terminal_id, provider_idempotency_key,
  quote_fingerprint, intent_fingerprint, access_ranges, not_after,
  reconciliation_expires_at, created_at, updated_at
)
select cases.claim_id, cases.attempt_id, source.generation,
  source.state_revision + 10, cases.claim_state, source.customer_user_id,
  source.profile_id, source.schedule_revision_id, cases.payment_lifecycle_id,
  cases.payment_lifecycle_id::text || ':authorization',
  cases.payment_lifecycle_id::text || ':authorization:attempt-1',
  source.amount_fils, source.currency, source.provider, source.environment,
  source.merchant_id, source.terminal_id,
  'terminal-marker-' || cases.case_name, source.quote_fingerprint,
  cases.intent_fingerprint, source.access_ranges, source.not_after,
  source.reconciliation_expires_at, source.created_at,
  clock_timestamp() - interval '4 minutes'
from terminal_marker_cases cases
cross join public.booking_request_authorization_claims source
where source.attempt_id = (
  select (result ->> 'attemptId')::uuid from prepared_submission
);
insert into public.booking_request_authorization_reconciliation_outbox (
  claim_id, claim_generation, observed_state_revision, state,
  lease_token, lease_expires_at, created_at, updated_at
)
select claims.id, claims.generation, claims.state_revision, 'complete',
  null, null, claims.created_at, clock_timestamp() - interval '3 minutes'
from public.booking_request_authorization_claims claims
join terminal_marker_cases cases on cases.claim_id = claims.id;
create temporary table terminal_marker_baselines on commit drop as
select cases.case_name, cases.attempt_id, cases.claim_id,
  to_jsonb(attempts) as attempt_record,
  to_jsonb(claims) as claim_record,
  to_jsonb(outbox) as outbox_record
from terminal_marker_cases cases
join public.booking_request_submission_attempts attempts
  on attempts.id = cases.attempt_id
join public.booking_request_authorization_claims claims
  on claims.id = cases.claim_id
join public.booking_request_authorization_reconciliation_outbox outbox
  on outbox.claim_id = cases.claim_id;
grant select on terminal_marker_cases to service_role;
set local role service_role;
select public.mark_booking_request_reconciliation_required(attempt_id)
from terminal_marker_cases
order by case_name;
reset role;
select results_eq(
  $$select baselines.case_name,
      to_jsonb(attempts) = baselines.attempt_record,
      to_jsonb(claims) = baselines.claim_record,
      to_jsonb(outbox) = baselines.outbox_record
    from terminal_marker_baselines baselines
    join public.booking_request_submission_attempts attempts
      on attempts.id = baselines.attempt_id
    join public.booking_request_authorization_claims claims
      on claims.id = baselines.claim_id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = baselines.claim_id
    order by baselines.case_name$$,
  $$values
      ('authorization_failed'::text, true, true, true),
      ('finalized'::text, true, true, true),
      ('released'::text, true, true, true)$$,
  'stale reconciliation markers preserve every terminal attempt, claim, audit, token, and outbox field'
);
rollback to savepoint terminal_reconciliation_markers_are_monotonic;

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
select ok(
  (select result -> 0 -> 'bookingPeriod' -> 0 ?& array['kind', 'displayName']
    from owner_projection)
  and (select result -> 0 ?& array[
    'houseRules', 'bookingTermsVersion', 'cancellationPolicyVersion',
    'marketplaceCommissionFils', 'ownerNetFils', 'statusNotifications'
  ] from owner_projection),
  'the Owner card receives the complete immutable Booking Snapshot and scoped notification receipt shape'
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

select ok(
  has_function_privilege(
    'authenticated', 'public.get_customer_booking_request(text)', 'execute'
  )
  and not has_function_privilege(
    'anon', 'public.get_customer_booking_request(text)', 'execute'
  ),
  'only authenticated users can request a Customer Booking Request projection'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003202"}',
  true
);
create temporary table customer_projection as
select public.get_customer_booking_request(
  (select booking_request_reference from booking_request_lifecycle_target)
) as result;
reset role;
select ok(
  (select result ->> 'status' from customer_projection) = 'pending'
  and not ((select result from customer_projection) ?| array[
    'ownerUserId', 'customerName', 'bookingNote', 'phone', 'email',
    'exactAddress', 'paymentLifecycleId', 'providerReference'
  ]),
  'the owning Customer receives a constrained status projection without private Owner or payment data'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003203"}',
  true
);
select is(
  public.get_customer_booking_request(
    (select booking_request_reference from booking_request_lifecycle_target)
  ),
  null::jsonb,
  'a different Customer cannot discover another Customer Booking Request'
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
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
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
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
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
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
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
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  '23505', null,
  'an authorization identity cannot be replayed as a release on another attempt'
);
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    '42000000-0000-4000-8000-000000003202',
    (select snapshot::text from released_payments where attempt_id = '42000000-0000-4000-8000-000000003202'),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
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
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
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
