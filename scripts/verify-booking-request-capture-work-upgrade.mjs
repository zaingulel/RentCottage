import { historicalProviderOperationSource } from "../tests/fixtures/payment-provider-history.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSync } from "esbuild";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
import { createBookingRequestPaymentUpgradeWorker } from "./lib/booking-request-payment-upgrade-worker.mjs";

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
let paymentEvidenceInstalled = false;

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
  if (result.status === 0) {
    if (args[0] === "migration" && args[1] === "up")
      paymentEvidenceInstalled = true;
    if (args[0] === "db" && args[1] === "reset")
      paymentEvidenceInstalled = !args.includes("--version");
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

function assertRefundSchedulingUpgrade(actual, expected, message) {
  // Historical request rows gain only a null scheduling field on upgrade.
  // Current snapshots stay whole-row, so later scheduling changes remain visible.
  assert.deepEqual(
    JSON.parse(actual),
    JSON.parse(expected).map((row) => ({
      ...row,
      refund_last_scheduled_at: null,
    })),
    message,
  );
}

function assertPaymentRequiredUpgrade(actual, expected, message) {
  const expectedRows = JSON.parse(expected).map((row) => ({
    ...row,
    payment_required_recorded_at: null,
    payment_required_deadline: null,
  }));
  const actualRows = JSON.parse(actual);
  const canonical = (rows) =>
    JSON.stringify(
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      ),
    );
  if (canonical(actualRows) !== canonical(expectedRows)) {
    throw new Error(
      `${message}\nExpected: ${JSON.stringify(expectedRows)}\nReceived: ${JSON.stringify(actualRows)}`,
    );
  }
}

function snapshot(table, orderBy, omitAddedColumns = true) {
  const projection =
    table === "simulated_payment_provider_operations"
      ? "to_jsonb(rows) - 'recovery_attempt_id' - 'authoritative_outcome_at'" +
        (omitAddedColumns ? " - 'capture_execution_permit'" : "")
      : table === "booking_request_capture_work"
        ? "to_jsonb(rows) - 'recovery_operation_id'"
        : "to_jsonb(rows)";
  return harness.runSql(`
    select coalesce(jsonb_agg(${projection} order by ${orderBy}), '[]'::jsonb)
    from ${table === "simulated_payment_provider_operations" ? historicalProviderOperationSource(paymentEvidenceInstalled) : `public.${table}`} rows;
  `);
}

function snapshotPredecessorGraph() {
  return {
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
}

let failure;

harness.guardDisposableLocalDatabase();
const workerDirectory = mkdtempSync(
  join(tmpdir(), "rentcottage-payment-upgrade-"),
);
const workerBundle = join(workerDirectory, "worker.mjs");
buildSync({
  entryPoints: ["scripts/booking-request-capture-recovery-worker.ts"],
  outfile: workerBundle,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
});
const runPaymentWorker = createBookingRequestPaymentUpgradeWorker({
  guardDisposableLocalDatabase: harness.guardDisposableLocalDatabase,
  workerBundle,
});

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

  const seedPredecessorGraph = `
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
  `;
  harness.runSql(seedPredecessorGraph);

  const before = snapshotPredecessorGraph();

  const upgradeArgs = ["migration", "up", "--local"];
  const upgrade = runSupabase(upgradeArgs);
  if (upgrade.status !== 0) throw commandFailure(upgradeArgs, upgrade);

  const after = snapshotPredecessorGraph();
  for (const key of Object.keys(before)) {
    const compare =
      key === "requests" ? assertRefundSchedulingUpgrade : assertEqual;
    compare(
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
          from ${historicalProviderOperationSource(paymentEvidenceInstalled)} operations
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
    confirmationRelationCount: 2,
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
    "Booking Request capture-work upgrade preserved pending, release-processing, and accepted predecessor graphs byte-for-byte; retained three active holds and successful authorizations; inferred no capture work, evidence, operation, confirmation, or receipt rows; and created the private empty outcome relations without application-role access.",
  );

  const captureWorkPredecessor = "20260904120000";
  const resetCaptureWorkArgs = [
    "db",
    "reset",
    "--local",
    "--version",
    captureWorkPredecessor,
  ];
  const resetCaptureWork = runSupabase(resetCaptureWorkArgs);
  if (resetCaptureWork.status !== 0)
    throw commandFailure(resetCaptureWorkArgs, resetCaptureWork);
  assertEqual(
    harness.runSql(
      "select max(version) from supabase_migrations.schema_migrations;",
    ),
    captureWorkPredecessor,
    "Capture execution upgrade reset to the wrong predecessor.",
  );
  harness.runSql(seedPredecessorGraph);
  harness.runSql(
    "begin; delete from public.booking_request_release_work; update public.booking_requests set status = 'accepted'; commit;",
  );
  for (let position = 1; position <= 3; position++) {
    const suffix = String(position).padStart(12, "0");
    const requestId = `96000000-0000-4000-8000-${suffix}`;
    const lifecycleId = `99000000-0000-4000-8000-${suffix}`;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          provider: {
            provider: "fictional-payments",
            environment: "local-test",
            merchantId: "capture-upgrade-merchant",
            terminalId: "capture-upgrade-terminal",
          },
          kind: "capture",
          paymentLifecycleId: lifecycleId,
          logicalOperationId: `${lifecycleId}:capture`,
          attemptId: `${lifecycleId}:capture:attempt-2`,
          amountFils: 115000000,
          currency: "IQD",
        }),
      )
      .digest("hex");
    const state = ["queued", "processing", "complete"][position - 1];
    harness.runSql(`insert into public.booking_request_capture_work (
      booking_request_id, attempt_id, authorization_claim_id, authorization_claim_generation,
      payment_lifecycle_id, authorization_logical_operation_id, authorization_physical_attempt_id,
      capture_logical_operation_id, capture_physical_attempt_id, amount_fils, currency,
      provider, environment, merchant_id, terminal_id, provider_idempotency_key, request_fingerprint,
      state, lease_generation, lease_token, lease_expires_at, outcome, created_at, completed_at
    ) values (
      '${requestId}', '97000000-0000-4000-8000-${suffix}', '98000000-0000-4000-8000-${suffix}', 1,
      '${lifecycleId}', '${lifecycleId}:authorization', '${lifecycleId}:authorization:attempt-1',
      '${lifecycleId}:capture', '${lifecycleId}:capture:attempt-2', 115000000, 'IQD',
      'fictional-payments', 'local-test', 'capture-upgrade-merchant', 'capture-upgrade-terminal',
      'booking-request-capture:${requestId}:1', '${fingerprint}', '${state}', ${position === 1 ? 0 : position},
      ${position === 2 ? "'99200000-0000-4000-8000-000000000002'" : "null"},
      ${position === 2 ? "'2101-01-01T00:00:30.000Z'" : "null"}, ${position === 3 ? "'succeeded'" : "null"},
      '2100-01-01T00:00:00.000Z', ${position === 3 ? "'2100-01-01T01:00:00.000Z'" : "null"}
    );`);
  }
  const beforeExecution = {
    ...snapshotPredecessorGraph(),
    captureWork: snapshot(
      "booking_request_capture_work",
      "rows.booking_request_id",
    ),
  };
  const executionUpgrade = runSupabase(upgradeArgs);
  if (executionUpgrade.status !== 0)
    throw commandFailure(upgradeArgs, executionUpgrade);
  const afterExecution = {
    ...snapshotPredecessorGraph(),
    captureWork: snapshot(
      "booking_request_capture_work",
      "rows.booking_request_id",
    ),
  };
  for (const key of Object.keys(beforeExecution)) {
    const message = `Capture execution migration changed predecessor ${key}.`;
    if (key === "captureWork")
      assertPaymentRequiredUpgrade(
        afterExecution[key],
        beforeExecution[key],
        message,
      );
    else if (key === "requests")
      assertRefundSchedulingUpgrade(
        afterExecution[key],
        beforeExecution[key],
        message,
      );
    else assertEqual(afterExecution[key], beforeExecution[key], message);
  }
  assertEqual(
    harness.runSql(
      "select string_agg(state, ',' order by booking_request_id) from public.booking_request_capture_work;",
    ),
    "queued,processing,complete",
    "Capture execution migration must retain every predecessor work state.",
  );
  assertEqual(
    harness.runSql(
      `select count(*) from ${historicalProviderOperationSource(paymentEvidenceInstalled)} where capture_execution_permit is not null or operation_kind = 'capture';`,
    ),
    "0",
    "Capture execution migration must not backfill a permit or execute capture.",
  );
  console.log(
    "Capture execution upgrade preserved queued, processing and complete predecessor work and every source graph byte-for-byte; existing Authorization ledger columns are unchanged and their new capture-only permit column remains null.",
  );

  const confirmationPredecessor = "20260905120000";
  const resetConfirmationArgs = [
    "db",
    "reset",
    "--local",
    "--version",
    confirmationPredecessor,
  ];
  const resetConfirmation = runSupabase(resetConfirmationArgs);
  if (resetConfirmation.status !== 0)
    throw commandFailure(resetConfirmationArgs, resetConfirmation);
  assertEqual(
    harness.runSql(
      "select max(version) from supabase_migrations.schema_migrations;",
    ),
    confirmationPredecessor,
    "Confirmation upgrade reset to the wrong predecessor.",
  );
  const confirmationSource = readFileSync(
    new URL(
      "../supabase/fixtures/legacy-booking_request_confirmation.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const confirmationFixture = confirmationSource
    .split("-- BEGIN CONFIRMATION FIXTURE\n")[1]
    ?.split("-- END CONFIRMATION FIXTURE")[0];
  if (!confirmationFixture)
    throw new Error("The complete confirmation fixture must be available.");
  harness.runSql(`begin; ${confirmationFixture} commit;`);
  harness.runSql(`select public.complete_booking_request_capture(
    '60000000-0000-4000-8000-000000001001',
    (capture_execution_permit ->> 'leaseGeneration')::bigint,
    (capture_execution_permit ->> 'leaseToken')::uuid,
    jsonb_build_object('outcome', 'succeeded',
      'providerRequestId', provider_request_id,
      'providerReference', provider_reference,
      'movementReference', movement_reference)
  ) from ${historicalProviderOperationSource(paymentEvidenceInstalled)}
  where operation_kind = 'capture'
    and payment_lifecycle_id = '73000000-0000-4000-8000-000000001001';`);
  const beforeConfirmation = {
    ...snapshotPredecessorGraph(),
    captureWork: snapshot(
      "booking_request_capture_work",
      "rows.booking_request_id",
    ),
  };
  const confirmationUpgrade = runSupabase(upgradeArgs);
  if (confirmationUpgrade.status !== 0)
    throw commandFailure(upgradeArgs, confirmationUpgrade);
  const afterConfirmation = {
    ...snapshotPredecessorGraph(),
    captureWork: snapshot(
      "booking_request_capture_work",
      "rows.booking_request_id",
    ),
  };
  for (const key of Object.keys(beforeConfirmation)) {
    const message = `Confirmation migration changed completed-Capture predecessor ${key}.`;
    if (key === "captureWork")
      assertPaymentRequiredUpgrade(
        afterConfirmation[key],
        beforeConfirmation[key],
        message,
      );
    else if (key === "requests")
      assertRefundSchedulingUpgrade(
        afterConfirmation[key],
        beforeConfirmation[key],
        message,
      );
    else assertEqual(afterConfirmation[key], beforeConfirmation[key], message);
  }
  assertEqual(
    harness.runSql(
      "select (select count(*) from public.booking_confirmations) || ':' || (select count(*) from public.booking_receipts) || ':' || (select count(*) from public.cottage_booking_period_commitments where status = 'pending_hold') || ':' || (select count(*) from public.booking_request_capture_work where state = 'complete');",
    ),
    "0:0:1:1",
    "Confirmation migration must not infer outcomes from completed Capture evidence.",
  );
  console.log(
    "Confirmation upgrade preserved a genuinely completed Capture graph byte-for-byte, created only private empty outcome relations, and inferred no confirmation, receipt, or commitment promotion.",
  );

  const recoveryPredecessor = "20260905200000";
  const resetRecoveryArgs = [
    "db",
    "reset",
    "--local",
    "--version",
    recoveryPredecessor,
  ];
  const resetRecovery = runSupabase(resetRecoveryArgs);
  if (resetRecovery.status !== 0)
    throw commandFailure(resetRecoveryArgs, resetRecovery);
  assertEqual(
    harness.runSql(
      "select max(version) from supabase_migrations.schema_migrations;",
    ),
    recoveryPredecessor,
    "Recovery upgrade reset to the wrong predecessor.",
  );
  harness.runSql(`begin; ${confirmationFixture} commit;`);
  const secondLifecycle = "73000000-0000-4000-8000-000000001101";
  const secondFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        provider: {
          provider: "fictional-payments",
          environment: "local-test",
          merchantId: "fictional-merchant",
          terminalId: "fictional-terminal",
        },
        kind: "capture",
        paymentLifecycleId: secondLifecycle,
        logicalOperationId: `${secondLifecycle}:capture`,
        attemptId: `${secondLifecycle}:capture:attempt-2`,
        amountFils: 115000000,
        currency: "IQD",
      }),
    )
    .digest("hex");
  const secondFixture = confirmationFixture
    .replaceAll("00000000100", "00000000110")
    .replaceAll("750000100", "750000110")
    .replaceAll("confirmation-auth-", "recovery-upgrade-auth-")
    .replaceAll("CONFIRMATION-HOLD-1", "CONFIRMATION-HOLD-2")
    .replaceAll(
      "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
      secondFingerprint,
    );
  harness.runSql(`begin; ${secondFixture} commit;`);
  harness.runSql(`select public.complete_booking_request_capture(
    '60000000-0000-4000-8000-000000001101', (capture_execution_permit ->> 'leaseGeneration')::bigint,
    (capture_execution_permit ->> 'leaseToken')::uuid, jsonb_build_object('outcome','succeeded',
      'providerRequestId',provider_request_id,'providerReference',provider_reference,'movementReference',movement_reference))
    from ${historicalProviderOperationSource(paymentEvidenceInstalled)} where operation_kind = 'capture' and payment_lifecycle_id = '${secondLifecycle}';`);
  const recoveryGraph = () => ({
    ...snapshotPredecessorGraph(),
    captureWork: snapshot(
      "booking_request_capture_work",
      "rows.booking_request_id",
    ),
    providerOperations: snapshot(
      "simulated_payment_provider_operations",
      "rows.id",
      false,
    ),
    confirmations: snapshot("booking_confirmations", "rows.id"),
    receipts: snapshot("booking_receipts", "rows.id"),
  });
  const beforeRecovery = recoveryGraph();
  assertEqual(
    harness.runSql(
      "select string_agg(state, ',' order by booking_request_id) from public.booking_request_capture_work;",
    ),
    "processing,complete",
    "Upgrade needs both outstanding and completed real Capture evidence.",
  );
  const recoveryUpgrade = runSupabase(upgradeArgs);
  if (recoveryUpgrade.status !== 0)
    throw commandFailure(upgradeArgs, recoveryUpgrade);
  const afterRecovery = recoveryGraph();
  for (const key of Object.keys(beforeRecovery)) {
    const message = `Recovery migration changed predecessor ${key}.`;
    if (key === "captureWork")
      assertPaymentRequiredUpgrade(
        afterRecovery[key],
        beforeRecovery[key],
        message,
      );
    else if (key === "requests")
      assertRefundSchedulingUpgrade(
        afterRecovery[key],
        beforeRecovery[key],
        message,
      );
    else assertEqual(afterRecovery[key], beforeRecovery[key], message);
  }
  assertEqual(
    harness.runSql(
      "select count(*) from public.booking_request_capture_work where recovery_operation_id is not null;",
    ),
    "0",
    "Migration must not infer recovery ownership.",
  );
  assertEqual(
    harness.runSql(
      `select count(*) || ':' || sum(physical_execution_count) from ${historicalProviderOperationSource(paymentEvidenceInstalled)} where operation_kind = 'capture';`,
    ),
    "2:2",
    "Migration must preserve exactly the two original Capture executions.",
  );
  assertEqual(
    harness.runSql(
      "select (select count(*) from public.booking_confirmations) || ':' || (select count(*) from public.booking_receipts) || ':' || (select count(*) from public.cottage_booking_period_commitments where status = 'pending_hold');",
    ),
    "0:0:2",
    "Recovery migration cannot confirm, create receipts, or promote holds.",
  );
  console.log(
    "Recovery upgrade preserved real outstanding and completed Capture graphs, original execution permits and all existing columns byte-for-byte; recovery links start null and no execution, reclaim, confirmation, receipt, or hold promotion is inferred.",
  );
  const admissionResetArgs = [
    "db",
    "reset",
    "--local",
    "--version",
    "20260906140000",
  ];
  const admissionReset = runSupabase(admissionResetArgs);
  if (admissionReset.status !== 0)
    throw commandFailure(admissionResetArgs, admissionReset);
  harness.runSql(seedPredecessorGraph);
  const captureSource = confirmationFixture.split(
    "-- END CAPTURE RECOVERY SOURCE",
  )[0];
  for (const [index, state] of [
    [14, "queued"],
    [15, "processing"],
    [16, "complete"],
    [17, "confirmed"],
  ]) {
    const lifecycle = `73000000-0000-4000-8000-00000000${index}01`;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          provider: {
            provider: "fictional-payments",
            environment: "local-test",
            merchantId: "fictional-merchant",
            terminalId: "fictional-terminal",
          },
          kind: "capture",
          paymentLifecycleId: lifecycle,
          logicalOperationId: `${lifecycle}:capture`,
          attemptId: `${lifecycle}:capture:attempt-2`,
          amountFils: 115000000,
          currency: "IQD",
        }),
      )
      .digest("hex");
    const fixture = captureSource
      .replaceAll("00000000100", `00000000${index}0`)
      .replaceAll("750000100", `750000${index}0`)
      .replaceAll("confirmation-auth-", `admission-${index}-auth-`)
      .replaceAll("CONFIRMATION-HOLD-1", `ADMISSION-UPGRADE-HOLD-${index}`)
      .replaceAll(
        "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
        fingerprint,
      );
    harness.runSql(`begin; ${fixture} commit;`);
    if (state === "queued") continue;
    const request = `60000000-0000-4000-8000-00000000${index}01`;
    const lease = JSON.parse(
      harness.runSql(
        `select public.lease_booking_request_capture_work('${request}', '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}');`,
      ),
    );
    const executed = JSON.parse(
      harness.runSql(
        `select public.execute_simulated_booking_request_capture('${JSON.stringify(lease.permit)}'::jsonb);`,
      ),
    );
    if (state === "processing") continue;
    const completed = JSON.parse(
      harness.runSql(
        `select public.complete_booking_request_capture('${request}', ${lease.permit.leaseGeneration}, '${lease.permit.leaseToken}', '${JSON.stringify(executed)}'::jsonb);`,
      ),
    );
    if (state === "confirmed")
      harness.runSql(
        `select public.finalize_booking_request_confirmation('${request}', '${JSON.stringify(completed.snapshot)}'::jsonb);`,
      );
  }
  const admissionGraph = () => ({
    ...recoveryGraph(),
    captureWork: harness.runSql(
      "select jsonb_agg(to_jsonb(work) order by booking_request_id) from public.booking_request_capture_work work;",
    ),
  });
  const beforeAdmission = admissionGraph();
  assertEqual(
    harness.runSql(
      "select string_agg(state, ',' order by booking_request_id) from public.booking_request_capture_work;",
    ),
    "queued,processing,complete,complete",
    "Admission upgrade needs every predecessor capture state.",
  );
  const admissionUpgrade = runSupabase(upgradeArgs);
  if (admissionUpgrade.status !== 0)
    throw commandFailure(upgradeArgs, admissionUpgrade);
  const afterAdmission = admissionGraph();
  for (const key of Object.keys(beforeAdmission)) {
    const message = `Payment Required migration changed predecessor ${key}.`;
    if (key === "captureWork")
      assertPaymentRequiredUpgrade(
        afterAdmission[key],
        beforeAdmission[key],
        message,
      );
    else if (key === "requests")
      assertRefundSchedulingUpgrade(
        afterAdmission[key],
        beforeAdmission[key],
        message,
      );
    else assertEqual(afterAdmission[key], beforeAdmission[key], message);
  }
  assertEqual(
    harness.runSql(
      `select (select count(*) from public.booking_request_capture_work) || ':' || (select sum(physical_execution_count) from ${historicalProviderOperationSource(paymentEvidenceInstalled)} where operation_kind = 'capture') || ':' || (select count(*) from public.booking_confirmations) || ':' || (select count(*) from public.booking_receipts);`,
    ),
    "4:3:1:2",
    "Admission migration must not infer capture, execution, confirmation, or receipts.",
  );
  assertEqual(
    harness.runSql(
      "set role service_role; select count(*) from public.list_due_booking_confirmation_notifications(10);",
    ),
    "2",
    "Both byte-preserved receipt intents must become due notification candidates.",
  );
  console.log(
    "Payment Required upgrade preserved pending, release-processing, historical accepted, queued, processing, completed and confirmed graphs byte-for-byte; both new terminal timestamps are null on every predecessor row and no provider or booking effect was inferred.",
  );
  const recovery138ResetArgs = [
    "db",
    "reset",
    "--local",
    "--version",
    "20260906160000",
  ];
  const recovery138Reset = runSupabase(recovery138ResetArgs);
  if (recovery138Reset.status !== 0)
    throw commandFailure(recovery138ResetArgs, recovery138Reset);
  const paymentRequiredFixture = readFileSync(
    "supabase/fixtures/legacy-booking_request_payment_recovery.sql",
    "utf8",
  )
    .split("select plan(")[0]
    .replace(/^begin;/, "");
  harness.runSql(`begin; ${paymentRequiredFixture} commit;`);
  const recovery138Graph = () => ({
    ...snapshotPredecessorGraph(),
    work: harness.runSql(
      "select jsonb_agg(to_jsonb(work) order by booking_request_id) from public.booking_request_capture_work work;",
    ),
    ledger: harness.runSql(
      `select jsonb_agg(to_jsonb(ledger)-'recovery_attempt_id'-'authoritative_outcome_at' order by id) from ${historicalProviderOperationSource(paymentEvidenceInstalled)} ledger;`,
    ),
  });
  const before138 = recovery138Graph();
  const upgrade138 = runSupabase(upgradeArgs);
  if (upgrade138.status !== 0) throw commandFailure(upgradeArgs, upgrade138);
  const after138 = recovery138Graph();
  for (const field of Object.keys(before138)) {
    const compare =
      field === "requests" ? assertRefundSchedulingUpgrade : assertEqual;
    compare(
      after138[field],
      before138[field],
      `Customer recovery migration changed original ${field}.`,
    );
  }
  assertEqual(
    harness.runSql(
      `select (select count(*) from public.booking_request_payment_recovery_attempts)||':'||(select count(*) from public.booking_request_payment_recovery_operations)||':'||(select count(*) from ${historicalProviderOperationSource(paymentEvidenceInstalled)} where recovery_attempt_id is not null or authoritative_outcome_at is not null);`,
    ),
    "0:0:0",
    "Recovery migration cannot invent replacement work or authoritative outcomes.",
  );
  const recovery138Admission = JSON.parse(
    harness
      .runSql(
        `select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',false);
    set role authenticated;select public.claim_customer_booking_request_payment_recovery('60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000001001','simulated-replacement');`,
      )
      .split("\n")
      .at(-1),
  );
  assertEqual(
    recovery138Admission.status,
    "processing",
    "The existing owning Customer must be admitted after upgrade.",
  );
  assertEqual(
    runPaymentWorker(
      "payment-recovery",
      "60000000-0000-4000-8000-000000001001",
      {
        PAYMENT_RECOVERY_ATTEMPT_ID: recovery138Admission.attemptId,
      },
    ).status,
    "succeeded",
    "The upgraded request resumes through the complete application recovery service.",
  );
  assertEqual(
    harness.runSql(
      "select (select count(*) from public.booking_confirmations)||':'||(select count(*) from public.booking_receipts);",
    ),
    "1:2",
    "The preserved request must recover through the existing confirmation transaction.",
  );
  console.log(
    "Customer recovery upgrade preserved a real pre-138 Payment Required graph and fixed deadline, started with empty recovery tables/null ledger additions, then allowed its owning Customer to confirm exactly once.",
  );
} catch (error) {
  failure = error;
} finally {
  rmSync(workerDirectory, { recursive: true, force: true });
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
