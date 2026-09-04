import { spawnSync } from "node:child_process";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const priorMigrationVersion = "20260822180004";
const resetPriorArgs = [
  "db",
  "reset",
  "--local",
  "--version",
  priorMigrationVersion,
];
const resetCurrentArgs = ["db", "reset", "--local"];
const harness = createLocalSupabaseConcurrencyHarness();

function runSupabase(args) {
  const workdir = process.env.SUPABASE_LOCAL_WORKDIR;
  const result = spawnSync(
    "npx",
    ["supabase", ...args, ...(workdir ? ["--workdir", workdir] : [])],
    {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw new Error("Unable to execute the local Supabase CLI.", {
      cause: result.error,
    });
  }
  return result;
}

function commandFailure(args, result) {
  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");
  return new Error(
    `Supabase ${args.join(" ")} failed with status ${result.status ?? 1}${output ? `:\n${output}` : "."}`,
  );
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nReceived: ${actual}`);
  }
}

function snapshot(table, orderBy) {
  return harness.runSql(`
    select coalesce(jsonb_agg(to_jsonb(rows) order by ${orderBy}), '[]'::jsonb)
    from public.${table} rows;
  `);
}

let failure;

harness.guardDisposableLocalDatabase();

try {
  const resetPrior = runSupabase(resetPriorArgs);
  if (resetPrior.status !== 0) {
    throw commandFailure(resetPriorArgs, resetPrior);
  }
  assertEqual(
    harness.runSql(
      "select max(version) from supabase_migrations.schema_migrations;",
    ),
    priorMigrationVersion,
    "Capture-work upgrade proof reset to the wrong predecessor.",
  );

  harness.runSql(`
    begin;
    insert into auth.users (id, aud, role, phone, phone_confirmed_at)
    values
      ('91000000-0000-4000-8000-000000000001', 'authenticated',
        'authenticated', '+9647500091001', now()),
      ('91000000-0000-4000-8000-000000000002', 'authenticated',
        'authenticated', '+9647500091002', now()),
      ('91000000-0000-4000-8000-000000000003', 'authenticated',
        'authenticated', '+9647500091003', now()),
      ('91000000-0000-4000-8000-000000000004', 'authenticated',
        'authenticated', '+9647500091004', now());
    insert into public.account_contexts (user_id, role, owner_approval_state)
    values
      ('91000000-0000-4000-8000-000000000001', 'cottage_owner', 'approved'),
      ('91000000-0000-4000-8000-000000000002', 'customer', null),
      ('91000000-0000-4000-8000-000000000003', 'customer', null),
      ('91000000-0000-4000-8000-000000000004', 'customer', null);
    insert into public.owner_application_cottage_profiles (
      id, owner_user_id, name, governorate, approximate_location,
      exact_address, capacity, bedrooms, bathrooms, amenities,
      source_language, description, house_rules, status
    ) values (
      '92000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      'Capture upgrade cottage', 'Baghdad', 'Karrada',
      'Private capture upgrade address', 6, 2, 2, array['garden'],
      'en', 'Capture upgrade description', 'Capture upgrade rules', 'draft'
    );
    insert into public.cottage_shift_schedule_revisions (
      id, profile_id, revision, full_day_bundle_id
    ) values (
      '93000000-0000-4000-8000-000000000001',
      '92000000-0000-4000-8000-000000000001', 1,
      '93100000-0000-4000-8000-000000000001'
    );
    select set_config(
      'rentcottage.shift_schedule_write_revision_id',
      '93000000-0000-4000-8000-000000000001', true
    );
    insert into public.cottage_shifts (
      id, schedule_revision_id, position, name, start_time, end_time
    ) values
      ('93200000-0000-4000-8000-000000000001',
        '93000000-0000-4000-8000-000000000001',
        1, 'Morning', '08:00', '12:00'),
      ('93200000-0000-4000-8000-000000000002',
        '93000000-0000-4000-8000-000000000001',
        2, 'Evening', '16:00', '22:00');
    select set_config('rentcottage.shift_schedule_write_revision_id', '', true);
    update public.owner_application_cottage_profiles
    set current_shift_schedule_id = '93000000-0000-4000-8000-000000000001'
    where id = '92000000-0000-4000-8000-000000000001';

    insert into public.booking_snapshots (
      id, customer_user_id, profile_id, quote_fingerprint, intent_fingerprint,
      quote_payload, intent_payload, booking_terms_version,
      booking_terms_locale, booking_terms_body, booking_terms_sha256,
      cancellation_policy_version, acceptance_locale, acceptance_evidence,
      acceptance_evidence_fingerprint,
      marketplace_commission_rate_basis_points,
      marketplace_commission_amount_fils, created_at
    )
    select fixture.snapshot_id, fixture.customer_id,
      '92000000-0000-4000-8000-000000000001',
      repeat(fixture.marker, 64), repeat(fixture.intent_marker, 64),
      jsonb_build_object('fixture', fixture.request_status),
      jsonb_build_object('fixture', fixture.request_status),
      'capture-upgrade-v1', 'en', 'Fictional capture upgrade terms',
      repeat('d', 64), 'fictional-cancellation-v1', 'en',
      jsonb_build_object('fixture', fixture.request_status), repeat('e', 64),
      1000, 11000000, fixture.created_at
    from (values
      ('94000000-0000-4000-8000-000000000001'::uuid,
        '91000000-0000-4000-8000-000000000002'::uuid,
        'pending'::text, 'a'::text, '1'::text,
        '2100-01-01 00:00:00+00'::timestamptz),
      ('94000000-0000-4000-8000-000000000002'::uuid,
        '91000000-0000-4000-8000-000000000003'::uuid,
        'processing'::text, 'b'::text, '2'::text,
        '2100-01-02 00:00:00+00'::timestamptz),
      ('94000000-0000-4000-8000-000000000003'::uuid,
        '91000000-0000-4000-8000-000000000004'::uuid,
        'accepted'::text, 'c'::text, '3'::text,
        '2100-01-03 00:00:00+00'::timestamptz)
    ) fixture(
      snapshot_id, customer_id, request_status, marker, intent_marker, created_at
    );

    insert into public.cottage_booking_period_commitments (
      id, customer_user_id, profile_id, schedule_revision_id,
      commitment_reference, status, access_ranges, created_at
    )
    select fixture.commitment_id, fixture.customer_id,
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001', fixture.reference,
      'pending_hold', tstzmultirange(tstzrange(
        fixture.service_day + time '08:00',
        fixture.service_day + time '12:00', '[)'
      )), fixture.created_at
    from (values
      ('95000000-0000-4000-8000-000000000001'::uuid,
        '91000000-0000-4000-8000-000000000002'::uuid,
        'CAPTURE-UPGRADE-HOLD-1'::text, '2101-01-01'::date,
        '2100-01-01 00:01:00+00'::timestamptz),
      ('95000000-0000-4000-8000-000000000002'::uuid,
        '91000000-0000-4000-8000-000000000003'::uuid,
        'CAPTURE-UPGRADE-HOLD-2'::text, '2101-01-02'::date,
        '2100-01-02 00:01:00+00'::timestamptz),
      ('95000000-0000-4000-8000-000000000003'::uuid,
        '91000000-0000-4000-8000-000000000004'::uuid,
        'CAPTURE-UPGRADE-HOLD-3'::text, '2101-01-03'::date,
        '2100-01-03 00:01:00+00'::timestamptz)
    ) fixture(commitment_id, customer_id, reference, service_day, created_at);
    insert into public.cottage_inventory_commitments (
      id, unit_kind, unit_id, service_day, committed_price_iqd,
      created_at, booking_period_commitment_id
    )
    select fixture.inventory_id, 'shift',
      '93200000-0000-4000-8000-000000000001', fixture.service_day,
      110000, fixture.created_at, fixture.commitment_id
    from (values
      ('95100000-0000-4000-8000-000000000001'::uuid,
        '2101-01-01'::date, '2100-01-01 00:02:00+00'::timestamptz,
        '95000000-0000-4000-8000-000000000001'::uuid),
      ('95100000-0000-4000-8000-000000000002'::uuid,
        '2101-01-02'::date, '2100-01-02 00:02:00+00'::timestamptz,
        '95000000-0000-4000-8000-000000000002'::uuid),
      ('95100000-0000-4000-8000-000000000003'::uuid,
        '2101-01-03'::date, '2100-01-03 00:02:00+00'::timestamptz,
        '95000000-0000-4000-8000-000000000003'::uuid)
    ) fixture(inventory_id, service_day, created_at, commitment_id);
    insert into public.cottage_booking_period_occupancies (
      booking_period_commitment_id, schedule_revision_id, shift_id,
      service_day, active, created_at
    )
    select fixture.commitment_id,
      '93000000-0000-4000-8000-000000000001',
      '93200000-0000-4000-8000-000000000001', fixture.service_day,
      true, fixture.created_at
    from (values
      ('95000000-0000-4000-8000-000000000001'::uuid,
        '2101-01-01'::date, '2100-01-01 00:03:00+00'::timestamptz),
      ('95000000-0000-4000-8000-000000000002'::uuid,
        '2101-01-02'::date, '2100-01-02 00:03:00+00'::timestamptz),
      ('95000000-0000-4000-8000-000000000003'::uuid,
        '2101-01-03'::date, '2100-01-03 00:03:00+00'::timestamptz)
    ) fixture(commitment_id, service_day, created_at);

    insert into public.booking_requests (
      id, booking_request_reference, customer_user_id, owner_user_id,
      profile_id, booking_snapshot_id, booking_period_commitment_id,
      payment_lifecycle_id, customer_name, party_size, status,
      response_deadline, created_at, settled_at
    )
    select fixture.request_id, fixture.reference, fixture.customer_id,
      '91000000-0000-4000-8000-000000000001',
      '92000000-0000-4000-8000-000000000001', fixture.snapshot_id,
      fixture.commitment_id, fixture.lifecycle_id, fixture.customer_name, 2,
      fixture.request_status, fixture.created_at + interval '4 hours',
      fixture.created_at,
      case when fixture.request_status = 'accepted'
        then fixture.created_at + interval '1 hour' end
    from (values
      ('96000000-0000-4000-8000-000000000001'::uuid,
        'RC-REQ-0000000000009101'::text,
        '91000000-0000-4000-8000-000000000002'::uuid,
        '94000000-0000-4000-8000-000000000001'::uuid,
        '95000000-0000-4000-8000-000000000001'::uuid,
        '99000000-0000-4000-8000-000000000001'::uuid,
        'Pending Customer'::text, 'pending'::text,
        '2100-01-01 01:00:00+00'::timestamptz),
      ('96000000-0000-4000-8000-000000000002'::uuid,
        'RC-REQ-0000000000009102'::text,
        '91000000-0000-4000-8000-000000000003'::uuid,
        '94000000-0000-4000-8000-000000000002'::uuid,
        '95000000-0000-4000-8000-000000000002'::uuid,
        '99000000-0000-4000-8000-000000000002'::uuid,
        'Processing Customer'::text, 'processing'::text,
        '2100-01-02 01:00:00+00'::timestamptz),
      ('96000000-0000-4000-8000-000000000003'::uuid,
        'RC-REQ-0000000000009103'::text,
        '91000000-0000-4000-8000-000000000004'::uuid,
        '94000000-0000-4000-8000-000000000003'::uuid,
        '95000000-0000-4000-8000-000000000003'::uuid,
        '99000000-0000-4000-8000-000000000003'::uuid,
        'Accepted Customer'::text, 'accepted'::text,
        '2100-01-03 01:00:00+00'::timestamptz)
    ) fixture(
      request_id, reference, customer_id, snapshot_id, commitment_id,
      lifecycle_id, customer_name, request_status, created_at
    );

    insert into public.booking_request_submission_attempts (
      id, customer_user_id, idempotency_key, payment_lifecycle_id,
      profile_id, locale, public_slug, requested_search,
      quote_fingerprint, quote_payload, intent_fingerprint, intent_payload,
      payment_snapshot, authorization_provider, authorization_environment,
      authorization_merchant_id, authorization_terminal_id,
      authorization_provider_request_id, authorization_provider_reference,
      authorization_movement_reference, state, booking_request_id,
      intent_dedupe_active, created_at, updated_at
    )
    select fixture.attempt_id, fixture.customer_id, fixture.idempotency_key,
      fixture.lifecycle_id, '92000000-0000-4000-8000-000000000001',
      'en', 'capture-upgrade-cottage', '{}'::jsonb,
      repeat(fixture.quote_marker, 64), '{}'::jsonb,
      repeat(fixture.intent_marker, 64), '{}'::jsonb,
      jsonb_build_object(
        'paymentLifecycleId', fixture.lifecycle_id,
        'authorization', jsonb_build_object(
          'paymentLifecycleId', fixture.lifecycle_id,
          'kind', 'authorization',
          'logicalOperationId', fixture.lifecycle_id::text || ':authorization',
          'attemptId', fixture.lifecycle_id::text || ':authorization:attempt-1',
          'status', 'succeeded', 'amountFils', 115000000,
          'providerRequestId', 'upgrade-auth-request-' || fixture.position,
          'providerReference', 'upgrade-auth-reference-' || fixture.position,
          'movementReference', 'upgrade-auth-movement-' || fixture.position,
          'reconciliationRequired', false, 'retrySafe', false
        ),
        'capture', null, 'release', null,
        'movements', jsonb_build_array(jsonb_build_object(
          'kind', 'authorization',
          'logicalOperationId', fixture.lifecycle_id::text || ':authorization',
          'attemptId', fixture.lifecycle_id::text || ':authorization:attempt-1',
          'amountFils', 115000000,
          'movementReference', 'upgrade-auth-movement-' || fixture.position,
          'recordedAt', to_char(fixture.created_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ))
      ),
      'fictional-payments', 'local-test', 'capture-upgrade-merchant',
      'capture-upgrade-terminal', 'upgrade-auth-request-' || fixture.position,
      'upgrade-auth-reference-' || fixture.position,
      'upgrade-auth-movement-' || fixture.position, 'finalized',
      fixture.request_id, true, fixture.created_at, fixture.created_at
    from (values
      (1, '97000000-0000-4000-8000-000000000001'::uuid,
        '91000000-0000-4000-8000-000000000002'::uuid,
        '97100000-0000-4000-8000-000000000001'::uuid,
        '99000000-0000-4000-8000-000000000001'::uuid,
        '96000000-0000-4000-8000-000000000001'::uuid,
        'a'::text, '1'::text, '2100-01-01 01:01:00+00'::timestamptz),
      (2, '97000000-0000-4000-8000-000000000002'::uuid,
        '91000000-0000-4000-8000-000000000003'::uuid,
        '97100000-0000-4000-8000-000000000002'::uuid,
        '99000000-0000-4000-8000-000000000002'::uuid,
        '96000000-0000-4000-8000-000000000002'::uuid,
        'b'::text, '2'::text, '2100-01-02 01:01:00+00'::timestamptz),
      (3, '97000000-0000-4000-8000-000000000003'::uuid,
        '91000000-0000-4000-8000-000000000004'::uuid,
        '97100000-0000-4000-8000-000000000003'::uuid,
        '99000000-0000-4000-8000-000000000003'::uuid,
        '96000000-0000-4000-8000-000000000003'::uuid,
        'c'::text, '3'::text, '2100-01-03 01:01:00+00'::timestamptz)
    ) fixture(
      position, attempt_id, customer_id, idempotency_key, lifecycle_id,
      request_id, quote_marker, intent_marker, created_at
    );

    insert into public.booking_request_authorization_claims (
      id, attempt_id, generation, state_revision, state, customer_user_id,
      profile_id, schedule_revision_id, payment_lifecycle_id,
      logical_operation_id, physical_attempt_id, amount_fils, currency,
      provider, environment, merchant_id, terminal_id,
      provider_idempotency_key, quote_fingerprint, intent_fingerprint,
      access_ranges, not_after, reconciliation_expires_at,
      created_at, updated_at
    )
    select fixture.claim_id, fixture.attempt_id, 1, 2, 'converted',
      fixture.customer_id, '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001', fixture.lifecycle_id,
      fixture.lifecycle_id::text || ':authorization',
      fixture.lifecycle_id::text || ':authorization:attempt-1',
      115000000, 'IQD', 'fictional-payments', 'local-test',
      'capture-upgrade-merchant', 'capture-upgrade-terminal',
      'booking-request:' || fixture.claim_id::text || ':1',
      repeat(fixture.quote_marker, 64), repeat(fixture.intent_marker, 64),
      tstzmultirange(tstzrange(
        fixture.service_day + time '08:00',
        fixture.service_day + time '12:00', '[)'
      )), fixture.service_day - interval '1 day',
      fixture.service_day - interval '1 day 1 minute',
      fixture.created_at, fixture.created_at
    from (values
      ('98000000-0000-4000-8000-000000000001'::uuid,
        '97000000-0000-4000-8000-000000000001'::uuid,
        '91000000-0000-4000-8000-000000000002'::uuid,
        '99000000-0000-4000-8000-000000000001'::uuid,
        'a'::text, '1'::text, '2101-01-01'::date,
        '2100-01-01 01:02:00+00'::timestamptz),
      ('98000000-0000-4000-8000-000000000002'::uuid,
        '97000000-0000-4000-8000-000000000002'::uuid,
        '91000000-0000-4000-8000-000000000003'::uuid,
        '99000000-0000-4000-8000-000000000002'::uuid,
        'b'::text, '2'::text, '2101-01-02'::date,
        '2100-01-02 01:02:00+00'::timestamptz),
      ('98000000-0000-4000-8000-000000000003'::uuid,
        '97000000-0000-4000-8000-000000000003'::uuid,
        '91000000-0000-4000-8000-000000000004'::uuid,
        '99000000-0000-4000-8000-000000000003'::uuid,
        'c'::text, '3'::text, '2101-01-03'::date,
        '2100-01-03 01:02:00+00'::timestamptz)
    ) fixture(
      claim_id, attempt_id, customer_id, lifecycle_id,
      quote_marker, intent_marker, service_day, created_at
    );

    insert into public.booking_request_authorization_claim_items (
      claim_id, unit_kind, unit_id, service_day, price_iqd
    )
    select fixture.claim_id, 'shift',
      '93200000-0000-4000-8000-000000000001', fixture.service_day, 110000
    from (values
      ('98000000-0000-4000-8000-000000000001'::uuid, '2101-01-01'::date),
      ('98000000-0000-4000-8000-000000000002'::uuid, '2101-01-02'::date),
      ('98000000-0000-4000-8000-000000000003'::uuid, '2101-01-03'::date)
    ) fixture(claim_id, service_day);
    insert into public.booking_request_authorization_claim_occupancies (
      claim_id, schedule_revision_id, shift_id, service_day, active
    )
    select fixture.claim_id, '93000000-0000-4000-8000-000000000001',
      '93200000-0000-4000-8000-000000000001', fixture.service_day, false
    from (values
      ('98000000-0000-4000-8000-000000000001'::uuid, '2101-01-01'::date),
      ('98000000-0000-4000-8000-000000000002'::uuid, '2101-01-02'::date),
      ('98000000-0000-4000-8000-000000000003'::uuid, '2101-01-03'::date)
    ) fixture(claim_id, service_day);
    insert into public.booking_request_authorization_reconciliation_outbox (
      claim_id, claim_generation, observed_state_revision, state,
      created_at, updated_at
    )
    select fixture.claim_id, 1, 2, 'complete',
      fixture.created_at, fixture.created_at
    from (values
      ('98000000-0000-4000-8000-000000000001'::uuid,
        '2100-01-01 01:02:00+00'::timestamptz),
      ('98000000-0000-4000-8000-000000000002'::uuid,
        '2100-01-02 01:02:00+00'::timestamptz),
      ('98000000-0000-4000-8000-000000000003'::uuid,
        '2100-01-03 01:02:00+00'::timestamptz)
    ) fixture(claim_id, created_at);
    insert into public.booking_request_provider_operation_identities (
      attempt_id, operation_kind, provider, environment, merchant_id,
      terminal_id, provider_request_id, provider_reference, movement_reference
    )
    select fixture.attempt_id, 'authorization', 'fictional-payments',
      'local-test', 'capture-upgrade-merchant', 'capture-upgrade-terminal',
      'upgrade-auth-request-' || fixture.position,
      'upgrade-auth-reference-' || fixture.position,
      'upgrade-auth-movement-' || fixture.position
    from (values
      (1, '97000000-0000-4000-8000-000000000001'::uuid),
      (2, '97000000-0000-4000-8000-000000000002'::uuid),
      (3, '97000000-0000-4000-8000-000000000003'::uuid)
    ) fixture(position, attempt_id);
    insert into public.simulated_payment_provider_operations (
      id, claim_id, claim_generation, operation_kind, provider, environment,
      merchant_id, terminal_id, provider_idempotency_key, request_fingerprint,
      payment_lifecycle_id, logical_operation_id, physical_attempt_id,
      amount_fils, currency, original_outcome, current_outcome,
      provider_request_id, provider_reference, movement_reference,
      created_at, updated_at
    )
    select fixture.operation_id, fixture.claim_id, 1, 'authorization',
      'fictional-payments', 'local-test', 'capture-upgrade-merchant',
      'capture-upgrade-terminal',
      'booking-request:' || fixture.claim_id::text || ':1',
      repeat(fixture.marker, 64), fixture.lifecycle_id,
      fixture.lifecycle_id::text || ':authorization',
      fixture.lifecycle_id::text || ':authorization:attempt-1',
      115000000, 'IQD', 'succeeded', 'succeeded',
      'upgrade-auth-request-' || fixture.position,
      'upgrade-auth-reference-' || fixture.position,
      'upgrade-auth-movement-' || fixture.position,
      fixture.created_at, fixture.created_at
    from (values
      (1, '99400000-0000-4000-8000-000000000001'::uuid,
        '98000000-0000-4000-8000-000000000001'::uuid,
        '99000000-0000-4000-8000-000000000001'::uuid,
        'a'::text, '2100-01-01 01:02:30+00'::timestamptz),
      (2, '99400000-0000-4000-8000-000000000002'::uuid,
        '98000000-0000-4000-8000-000000000002'::uuid,
        '99000000-0000-4000-8000-000000000002'::uuid,
        'b'::text, '2100-01-02 01:02:30+00'::timestamptz),
      (3, '99400000-0000-4000-8000-000000000003'::uuid,
        '98000000-0000-4000-8000-000000000003'::uuid,
        '99000000-0000-4000-8000-000000000003'::uuid,
        'c'::text, '2100-01-03 01:02:30+00'::timestamptz)
    ) fixture(
      position, operation_id, claim_id, lifecycle_id, marker, created_at
    );

    insert into public.booking_request_release_work (
      id, booking_request_id, attempt_id, outcome, outcome_fingerprint,
      state, lease_generation, lease_token, lease_expires_at, created_at
    ) values (
      '99100000-0000-4000-8000-000000000002',
      '96000000-0000-4000-8000-000000000002',
      '97000000-0000-4000-8000-000000000002',
      'expired', repeat('f', 64), 'processing', 1,
      '99200000-0000-4000-8000-000000000002',
      '2101-01-01 00:00:00+00', '2100-01-02 01:03:00+00'
    );
    insert into public.booking_request_status_notifications (
      id, booking_request_id, recipient_user_id, status, created_at
    ) values
      ('99300000-0000-4000-8000-000000000001',
        '96000000-0000-4000-8000-000000000003',
        '91000000-0000-4000-8000-000000000001', 'accepted',
        '2100-01-03 02:00:00+00'),
      ('99300000-0000-4000-8000-000000000002',
        '96000000-0000-4000-8000-000000000003',
        '91000000-0000-4000-8000-000000000004', 'accepted',
        '2100-01-03 02:00:00+00');
    insert into public.owner_request_notifications (
      id, booking_request_id, owner_user_id, channel, created_at
    ) values
      ('99500000-0000-4000-8000-000000000001',
        '96000000-0000-4000-8000-000000000001',
        '91000000-0000-4000-8000-000000000001', 'in_product',
        '2100-01-01 01:04:00+00'),
      ('99500000-0000-4000-8000-000000000002',
        '96000000-0000-4000-8000-000000000002',
        '91000000-0000-4000-8000-000000000001', 'in_product',
        '2100-01-02 01:04:00+00'),
      ('99500000-0000-4000-8000-000000000003',
        '96000000-0000-4000-8000-000000000003',
        '91000000-0000-4000-8000-000000000001', 'in_product',
        '2100-01-03 01:04:00+00');
    commit;
  `);

  const before = {
    snapshots: snapshot("booking_snapshots", "rows.id"),
    requests: snapshot("booking_requests", "rows.id"),
    attempts: snapshot("booking_request_submission_attempts", "rows.id"),
    claims: snapshot("booking_request_authorization_claims", "rows.id"),
    claimItems: snapshot(
      "booking_request_authorization_claim_items",
      "rows.claim_id, rows.service_day, rows.unit_kind, rows.unit_id",
    ),
    claimOccupancies: snapshot(
      "booking_request_authorization_claim_occupancies",
      "rows.claim_id, rows.schedule_revision_id, rows.shift_id, rows.service_day",
    ),
    reconciliationOutbox: snapshot(
      "booking_request_authorization_reconciliation_outbox",
      "rows.claim_id",
    ),
    providerIdentities: snapshot(
      "booking_request_provider_operation_identities",
      "rows.attempt_id, rows.operation_kind",
    ),
    providerOperations: snapshot(
      "simulated_payment_provider_operations",
      "rows.id",
    ),
    releaseWork: snapshot("booking_request_release_work", "rows.id"),
    commitments: snapshot("cottage_booking_period_commitments", "rows.id"),
    inventory: snapshot("cottage_inventory_commitments", "rows.id"),
    occupancies: snapshot(
      "cottage_booking_period_occupancies",
      "rows.booking_period_commitment_id, rows.shift_id, rows.service_day",
    ),
    notifications: snapshot("booking_request_status_notifications", "rows.id"),
    ownerNotifications: snapshot("owner_request_notifications", "rows.id"),
  };

  const upgradeArgs = ["migration", "up", "--local"];
  const upgrade = runSupabase(upgradeArgs);
  if (upgrade.status !== 0) throw commandFailure(upgradeArgs, upgrade);

  const after = {
    snapshots: snapshot("booking_snapshots", "rows.id"),
    requests: snapshot("booking_requests", "rows.id"),
    attempts: snapshot("booking_request_submission_attempts", "rows.id"),
    claims: snapshot("booking_request_authorization_claims", "rows.id"),
    claimItems: snapshot(
      "booking_request_authorization_claim_items",
      "rows.claim_id, rows.service_day, rows.unit_kind, rows.unit_id",
    ),
    claimOccupancies: snapshot(
      "booking_request_authorization_claim_occupancies",
      "rows.claim_id, rows.schedule_revision_id, rows.shift_id, rows.service_day",
    ),
    reconciliationOutbox: snapshot(
      "booking_request_authorization_reconciliation_outbox",
      "rows.claim_id",
    ),
    providerIdentities: snapshot(
      "booking_request_provider_operation_identities",
      "rows.attempt_id, rows.operation_kind",
    ),
    providerOperations: snapshot(
      "simulated_payment_provider_operations",
      "rows.id",
    ),
    releaseWork: snapshot("booking_request_release_work", "rows.id"),
    commitments: snapshot("cottage_booking_period_commitments", "rows.id"),
    inventory: snapshot("cottage_inventory_commitments", "rows.id"),
    occupancies: snapshot(
      "cottage_booking_period_occupancies",
      "rows.booking_period_commitment_id, rows.shift_id, rows.service_day",
    ),
    notifications: snapshot("booking_request_status_notifications", "rows.id"),
    ownerNotifications: snapshot("owner_request_notifications", "rows.id"),
  };
  for (const key of Object.keys(before)) {
    assertEqual(
      after[key],
      before[key],
      `Capture-work migration changed predecessor ${key}.`,
    );
  }

  const result = JSON.parse(
    harness.runSql(`
      select jsonb_build_object(
        'statuses', (
          select jsonb_agg(requests.status order by requests.id)
          from public.booking_requests requests
        ),
        'captureWorkCount', (
          select count(*) from public.booking_request_capture_work
        ),
        'captureEvidenceCount', (
          select count(*)
          from public.booking_request_submission_attempts attempts
          where attempts.payment_snapshot -> 'capture' <> 'null'::jsonb
            or jsonb_path_exists(
              attempts.payment_snapshot -> 'movements',
              '$[*] ? (@.kind == "capture")'
            )
        ),
        'captureOperationCount', (
          select count(*)
          from public.simulated_payment_provider_operations operations
          where operations.operation_kind = 'capture'
        ) + (
          select count(*)
          from public.booking_request_provider_operation_identities identities
          where identities.operation_kind = 'capture'
        ),
        'authorizationEvidenceCount', (
          select count(*)
          from public.booking_request_submission_attempts attempts
          where attempts.payment_snapshot -> 'authorization' ->> 'status'
            = 'succeeded'
        ),
        'activeHoldCount', (
          select count(*)
          from public.cottage_booking_period_commitments commitments
          join public.cottage_booking_period_occupancies occupancies
            on occupancies.booking_period_commitment_id = commitments.id
          where commitments.status = 'pending_hold' and occupancies.active
        ),
        'confirmedBookingCount', (
          select count(*)
          from public.cottage_booking_period_commitments commitments
          where commitments.status = 'confirmed_booking'
        ),
        'confirmationRelationCount', (
          select count(*)
          from (values
            (to_regclass('public.booking_confirmations')),
            (to_regclass('public.booking_receipts'))
          ) relations(relation_name)
          where relation_name is not null
        ),
        'rlsEnabled', (
          select relations.relrowsecurity
          from pg_catalog.pg_class relations
          where relations.oid =
            'public.booking_request_capture_work'::regclass
        ),
        'policyCount', (
          select count(*)
          from pg_catalog.pg_policy policies
          where policies.polrelid =
            'public.booking_request_capture_work'::regclass
        ),
        'directPrivilegeCount', (
          select count(*)
          from (values ('anon'), ('authenticated'), ('service_role')) roles(name)
          cross join (values
            ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
            ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
          ) privileges(name)
          where has_table_privilege(
            roles.name,
            'public.booking_request_capture_work',
            privileges.name
          )
        ) + (
          select count(*)
          from pg_catalog.pg_class relations
          cross join lateral aclexplode(coalesce(
            relations.relacl,
            acldefault('r', relations.relowner)
          )) privileges
          where relations.oid =
            'public.booking_request_capture_work'::regclass
            and privileges.grantee = 0
        )
      );
    `),
  );

  assertEqual(
    JSON.stringify(result.statuses),
    JSON.stringify(["pending", "processing", "accepted"]),
    "Predecessor Booking Request states were not preserved.",
  );
  for (const [key, expected] of Object.entries({
    captureWorkCount: 0,
    captureEvidenceCount: 0,
    captureOperationCount: 0,
    authorizationEvidenceCount: 3,
    activeHoldCount: 3,
    confirmedBookingCount: 0,
    confirmationRelationCount: 0,
    policyCount: 0,
    directPrivilegeCount: 0,
  })) {
    if (result[key] !== expected) {
      throw new Error(
        `Capture-work upgrade proof expected ${key}=${expected}, received ${result[key]}.`,
      );
    }
  }
  if (result.rlsEnabled !== true) {
    throw new Error("Capture-work upgrade did not preserve fail-closed RLS.");
  }

  console.log(
    "Booking Request capture-work upgrade preserved pending, release-processing, and accepted predecessor graphs byte-for-byte; retained three active holds and successful authorizations; inferred no capture work, evidence, operation, confirmation, or receipt; and kept the new relation RLS-private from every application role.",
  );
} catch (error) {
  failure = error;
} finally {
  const restored = runSupabase(resetCurrentArgs);
  if (restored.status !== 0) {
    const restoreFailure = commandFailure(resetCurrentArgs, restored);
    failure = failure
      ? new AggregateError(
          [failure, restoreFailure],
          "Capture-work upgrade proof and schema restoration failed.",
        )
      : restoreFailure;
  }
}

if (failure) throw failure;
