import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness({
  messages: {
    invalidGuard:
      "The Booking Request lifecycle fence test requires guarded local Supabase.",
    wrongOwner:
      "The Supabase container does not belong to this disposable checkout.",
  },
});
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "rentcottage-lifecycle-workers-"),
);
const workerBundle = join(temporaryDirectory, "worker.mjs");
const workers = new Set();
const databaseSessions = new Set();
const fixtureIds = Object.freeze({
  bookingRequest: randomUUID(),
  bookingSnapshot: randomUUID(),
  commitment: randomUUID(),
  attempt: randomUUID(),
  claim: randomUUID(),
  paymentLifecycle: randomUUID(),
  scheduleRevision: randomUUID(),
  fullDayBundle: randomUUID(),
  morningShift: randomUUID(),
  idempotencyKey: randomUUID(),
  eveningShift: randomUUID(),
});

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for lifecycle concurrency`);
  return value;
}

function seedSource() {
  harness.runSql(`
    begin;
    insert into public.test_booking_request_lifecycle_fences (
      label, booking_request_id, booking_snapshot_id, commitment_id,
      attempt_id, claim_id, payment_lifecycle_id, customer_user_id,
      owner_user_id
    )
    select 'source',
      '${fixtureIds.bookingRequest}',
      '${fixtureIds.bookingSnapshot}',
      '${fixtureIds.commitment}',
      '${fixtureIds.attempt}',
      '${fixtureIds.claim}',
      '${fixtureIds.paymentLifecycle}',
      customers.user_id, profiles.owner_user_id
    from public.owner_application_cottage_profiles profiles
    join public.account_contexts owners
      on owners.user_id = profiles.owner_user_id
      and owners.owner_approval_state = 'approved'
    cross join lateral (
      select contexts.user_id from public.account_contexts contexts
      where contexts.role = 'customer' order by contexts.user_id limit 1
    ) customers
    order by profiles.created_at, profiles.id
    limit 1;

    insert into public.cottage_shift_schedule_revisions (
      id, profile_id, revision, full_day_bundle_id
    )
    select '${fixtureIds.scheduleRevision}', profiles.id,
      coalesce((select max(existing.revision)
        from public.cottage_shift_schedule_revisions existing
        where existing.profile_id = profiles.id), 0) + 1,
      '${fixtureIds.fullDayBundle}'
    from public.test_booking_request_lifecycle_fences fixture
    join public.owner_application_cottage_profiles profiles
      on profiles.owner_user_id = fixture.owner_user_id
    where fixture.label = 'source'
    order by profiles.created_at, profiles.id limit 1;
    select set_config(
      'rentcottage.shift_schedule_write_revision_id',
      '${fixtureIds.scheduleRevision}', true
    );
    insert into public.cottage_shifts (
      id, schedule_revision_id, position, name, start_time, end_time
    ) values
      (
        '${fixtureIds.morningShift}',
        '${fixtureIds.scheduleRevision}',
        1, 'Fence morning', '09:00', '10:00'
      ),
      (
        '${fixtureIds.eveningShift}',
        '${fixtureIds.scheduleRevision}',
        2, 'Fence evening', '18:00', '19:00'
      );
    select set_config('rentcottage.shift_schedule_write_revision_id', '', true);
    insert into public.cottage_booking_period_commitments (
      id, customer_user_id, profile_id, schedule_revision_id,
      commitment_reference, status, access_ranges
    )
    select fixture.commitment_id, fixture.customer_user_id, revisions.profile_id,
      revisions.id, 'RC-FENCE-SOURCE', 'pending_hold',
      tstzmultirange(tstzrange(
        '2101-01-01 09:00:00+03'::timestamptz,
        '2101-01-01 10:00:00+03'::timestamptz, '[)'
      ))
    from public.test_booking_request_lifecycle_fences fixture
    join public.cottage_shift_schedule_revisions revisions
      on revisions.id = '${fixtureIds.scheduleRevision}'
    where fixture.label = 'source';
    insert into public.cottage_booking_period_occupancies (
      booking_period_commitment_id, schedule_revision_id, shift_id,
      service_day, active
    ) values (
      '${fixtureIds.commitment}',
      '${fixtureIds.scheduleRevision}',
      '${fixtureIds.morningShift}', '2101-01-01', true
    );
    insert into public.booking_snapshots (
      id, customer_user_id, profile_id, quote_fingerprint,
      intent_fingerprint, quote_payload, intent_payload,
      booking_terms_version, booking_terms_locale, booking_terms_body,
      booking_terms_sha256, cancellation_policy_version, acceptance_locale,
      acceptance_evidence, acceptance_evidence_fingerprint,
      marketplace_commission_rate_basis_points,
      marketplace_commission_amount_fils
    )
    select fixture.booking_snapshot_id, fixture.customer_user_id,
      revisions.profile_id, repeat('a', 64), repeat('b', 64),
      jsonb_build_object(
        'cottageName', 'Fictional fence cottage', 'items', '[]'::jsonb,
        'bookingPriceIqd', 110000, 'serviceFeeIqd', 5000,
        'customerTotalIqd', 115000
      ),
      jsonb_build_object('fenceSource', true),
      'fictional-fence-terms-v1', 'en', 'Fictional fence terms.',
      repeat('c', 64), 'fictional-cancellation-v1', 'en',
      jsonb_build_object('accepted', true), repeat('d', 64),
      1000, 11000000
    from public.test_booking_request_lifecycle_fences fixture
    join public.cottage_shift_schedule_revisions revisions
      on revisions.id = '${fixtureIds.scheduleRevision}'
    where fixture.label = 'source';
    insert into public.booking_requests (
      id, booking_request_reference, customer_user_id, owner_user_id,
      profile_id, booking_snapshot_id, booking_period_commitment_id,
      payment_lifecycle_id, customer_name, party_size, booking_note,
      status, response_deadline, created_at
    )
    select fixture.booking_request_id, 'RC-REQ-9700000000000901',
      fixture.customer_user_id, fixture.owner_user_id, snapshots.profile_id,
      fixture.booking_snapshot_id, fixture.commitment_id,
      fixture.payment_lifecycle_id, 'Fence Customer', 2, null, 'pending',
      timed.created_at + interval '4 hours', timed.created_at
    from public.test_booking_request_lifecycle_fences fixture
    join public.booking_snapshots snapshots
      on snapshots.id = fixture.booking_snapshot_id
    cross join lateral (select clock_timestamp() as created_at) timed
    where fixture.label = 'source';
    insert into public.booking_request_submission_attempts (
      id, customer_user_id, idempotency_key, payment_lifecycle_id,
      profile_id, locale, public_slug, requested_search,
      quote_fingerprint, quote_payload, intent_fingerprint, intent_payload,
      payment_snapshot, authorization_provider, authorization_environment,
      authorization_merchant_id, authorization_terminal_id,
      authorization_provider_request_id, authorization_provider_reference,
      authorization_movement_reference, state, booking_request_id,
      intent_dedupe_active
    )
    select fixture.attempt_id, fixture.customer_user_id,
      '${fixtureIds.idempotencyKey}', fixture.payment_lifecycle_id,
      requests.profile_id, 'en', 'fictional-fence-cottage', '{}'::jsonb,
      repeat('a', 64), snapshots.quote_payload, repeat('b', 64),
      snapshots.intent_payload,
      jsonb_build_object(
        'paymentLifecycleId', fixture.payment_lifecycle_id,
        'currency', 'IQD', 'bookingPriceFils', 110000000,
        'bookingServiceFeeFils', 5000000, 'customerTotalFils', 115000000,
        'authorization', jsonb_build_object(
          'paymentLifecycleId', fixture.payment_lifecycle_id,
          'kind', 'authorization',
          'logicalOperationId', fixture.payment_lifecycle_id::text || ':authorization',
          'attemptId', fixture.payment_lifecycle_id::text || ':authorization:attempt-1',
          'status', 'succeeded', 'amountFils', 115000000,
          'providerRequestId', 'fence-auth-request-source',
          'providerReference', 'fence-auth-reference-source',
          'movementReference', 'fence-auth-movement-source',
          'reconciliationRequired', false, 'retrySafe', false
        ),
        'capture', null, 'release', null, 'refunds', '[]'::jsonb,
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
          'paidFils', 0, 'providerFeeFils', 0,
          'providerReserveFils', 0, 'recoveryExposureFils', 0,
          'recoveryBalanceFils', 0, 'automaticOwnerDebitFils', 0,
          'paidWhileBlocked', false, 'settlement', null
        ),
        'holds', jsonb_build_object('administrator', false, 'dispute', false),
        'dispute', null, 'audits', '[]'::jsonb,
        'movements', jsonb_build_array(jsonb_build_object(
          'kind', 'authorization',
          'logicalOperationId', fixture.payment_lifecycle_id::text || ':authorization',
          'attemptId', fixture.payment_lifecycle_id::text || ':authorization:attempt-1',
          'amountFils', 115000000,
          'movementReference', 'fence-auth-movement-source',
          'recordedAt', '2099-08-21T14:00:00.000Z'
        ))
      ),
      'fictional-payments', 'local-test', 'fictional-merchant',
      'fictional-terminal', 'fence-auth-request-source',
      'fence-auth-reference-source', 'fence-auth-movement-source',
      'finalized', fixture.booking_request_id, true
    from public.test_booking_request_lifecycle_fences fixture
    join public.booking_requests requests on requests.id = fixture.booking_request_id
    join public.booking_snapshots snapshots on snapshots.id = fixture.booking_snapshot_id
    where fixture.label = 'source';
    insert into public.booking_request_authorization_claims (
      id, attempt_id, generation, state_revision, state, customer_user_id,
      profile_id, schedule_revision_id, payment_lifecycle_id,
      logical_operation_id, physical_attempt_id, amount_fils, currency,
      provider, environment, merchant_id, terminal_id,
      provider_idempotency_key, quote_fingerprint, intent_fingerprint,
      access_ranges, not_after, reconciliation_expires_at
    )
    select fixture.claim_id, fixture.attempt_id, 1, 2, 'converted',
      fixture.customer_user_id, attempts.profile_id,
      '${fixtureIds.scheduleRevision}', fixture.payment_lifecycle_id,
      fixture.payment_lifecycle_id::text || ':authorization',
      fixture.payment_lifecycle_id::text || ':authorization:attempt-1',
      115000000, 'IQD', 'fictional-payments', 'local-test',
      'fictional-merchant', 'fictional-terminal',
      'fence-auth:source', repeat('a', 64), repeat('b', 64),
      tstzmultirange(tstzrange(
        '2101-01-01 09:00:00+03'::timestamptz,
        '2101-01-01 10:00:00+03'::timestamptz, '[)'
      )), timed.deadline, timed.deadline
    from public.test_booking_request_lifecycle_fences fixture
    join public.booking_request_submission_attempts attempts
      on attempts.id = fixture.attempt_id
    cross join lateral (
      select clock_timestamp() + interval '5 minutes' as deadline
    ) timed
    where fixture.label = 'source';
    insert into public.booking_request_authorization_claim_items (
      claim_id, unit_kind, unit_id, service_day, price_iqd
    ) values (
      '${fixtureIds.claim}', 'shift',
      '${fixtureIds.morningShift}', '2101-01-01', 110000
    );
    insert into public.booking_request_authorization_claim_occupancies (
      claim_id, schedule_revision_id, shift_id, service_day, active
    ) values (
      '${fixtureIds.claim}',
      '${fixtureIds.scheduleRevision}',
      '${fixtureIds.morningShift}', '2101-01-01', false
    );
    insert into public.booking_request_authorization_reconciliation_outbox (
      claim_id, claim_generation, observed_state_revision, state
    ) values (
      '${fixtureIds.claim}', 1, 2, 'complete'
    );
    commit;
  `);
}

function seed(label, ordinal) {
  const day = String(ordinal + 1).padStart(2, "0");
  harness.runSql(`
    insert into public.test_booking_request_lifecycle_fences (
      label, booking_request_id, booking_snapshot_id, commitment_id,
      attempt_id, claim_id, payment_lifecycle_id, customer_user_id,
      owner_user_id
    )
    select '${label}', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
      gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
      requests.customer_user_id, requests.owner_user_id
    from public.booking_requests requests
    join public.booking_request_submission_attempts attempts
      on attempts.booking_request_id = requests.id
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    where requests.status = 'pending'
      and attempts.payment_snapshot -> 'authorization' ->> 'status' = 'succeeded'
      and attempts.payment_snapshot -> 'capture' = 'null'::jsonb
      and nullif(attempts.payment_snapshot -> 'release', 'null'::jsonb) is null
      and claims.state = 'converted'
    order by requests.created_at
    limit 1;

    insert into public.cottage_booking_period_commitments (
      id, customer_user_id, profile_id, schedule_revision_id,
      commitment_reference, status, access_ranges
    )
    select fixture.commitment_id, fixture.customer_user_id,
      source.profile_id, source.schedule_revision_id,
      'RC-FENCE-${String(ordinal).padStart(2, "0")}', 'pending_hold',
      tstzmultirange(tstzrange(
        '2102-01-${day} 09:00:00+03'::timestamptz,
        '2102-01-${day} 10:00:00+03'::timestamptz, '[)'
      ))
    from public.test_booking_request_lifecycle_fences fixture
    cross join lateral (
      select commitments.*
      from public.booking_requests requests
      join public.cottage_booking_period_commitments commitments
        on commitments.id = requests.booking_period_commitment_id
      where requests.customer_user_id = fixture.customer_user_id
      order by requests.created_at limit 1
    ) source
    where fixture.label = '${label}';

    insert into public.cottage_booking_period_occupancies (
      booking_period_commitment_id, schedule_revision_id, shift_id,
      service_day, active
    )
    select fixture.commitment_id, source.schedule_revision_id,
      source.shift_id, '2102-01-${day}'::date, true
    from public.test_booking_request_lifecycle_fences fixture
    cross join lateral (
      select occupancies.*
      from public.booking_requests requests
      join public.cottage_booking_period_occupancies occupancies
        on occupancies.booking_period_commitment_id =
          requests.booking_period_commitment_id
      where requests.customer_user_id = fixture.customer_user_id
      order by requests.created_at, occupancies.service_day limit 1
    ) source
    where fixture.label = '${label}';

    insert into public.booking_snapshots (
      id, customer_user_id, profile_id, quote_fingerprint,
      intent_fingerprint, quote_payload, intent_payload,
      booking_terms_version, booking_terms_locale, booking_terms_body,
      booking_terms_sha256, cancellation_policy_version, acceptance_locale,
      acceptance_evidence, acceptance_evidence_fingerprint,
      marketplace_commission_rate_basis_points,
      marketplace_commission_amount_fils
    )
    select fixture.booking_snapshot_id, fixture.customer_user_id,
      snapshots.profile_id, snapshots.quote_fingerprint,
      encode(extensions.digest(convert_to(fixture.label, 'UTF8'), 'sha256'), 'hex'),
      snapshots.quote_payload,
      snapshots.intent_payload || jsonb_build_object('fenceCase', fixture.label),
      snapshots.booking_terms_version, snapshots.booking_terms_locale,
      snapshots.booking_terms_body, snapshots.booking_terms_sha256,
      snapshots.cancellation_policy_version, snapshots.acceptance_locale,
      snapshots.acceptance_evidence,
      snapshots.acceptance_evidence_fingerprint,
      snapshots.marketplace_commission_rate_basis_points,
      snapshots.marketplace_commission_amount_fils
    from public.test_booking_request_lifecycle_fences fixture
    cross join lateral (
      select snapshots.*
      from public.booking_requests requests
      join public.booking_snapshots snapshots
        on snapshots.id = requests.booking_snapshot_id
      where requests.customer_user_id = fixture.customer_user_id
      order by requests.created_at limit 1
    ) snapshots
    where fixture.label = '${label}';

    insert into public.booking_requests (
      id, booking_request_reference, customer_user_id, owner_user_id,
      profile_id, booking_snapshot_id, booking_period_commitment_id,
      payment_lifecycle_id, customer_name, party_size, booking_note,
      status, response_deadline, created_at
    )
    select fixture.booking_request_id,
      'RC-REQ-' || upper(substr(encode(extensions.digest(
        convert_to(fixture.label, 'UTF8'), 'sha256'), 'hex'), 1, 16)),
      fixture.customer_user_id, fixture.owner_user_id, snapshots.profile_id,
      fixture.booking_snapshot_id, fixture.commitment_id,
      fixture.payment_lifecycle_id, 'Lifecycle Fence Customer', 2, null,
      'pending', timed.created_at + interval '4 hours', timed.created_at
    from public.test_booking_request_lifecycle_fences fixture
    join public.booking_snapshots snapshots
      on snapshots.id = fixture.booking_snapshot_id
    cross join lateral (select clock_timestamp() as created_at) timed
    where fixture.label = '${label}';

    insert into public.booking_request_submission_attempts (
      id, customer_user_id, idempotency_key, payment_lifecycle_id,
      profile_id, locale, public_slug, requested_search,
      quote_fingerprint, quote_payload, intent_fingerprint, intent_payload,
      payment_snapshot, authorization_provider, authorization_environment,
      authorization_merchant_id, authorization_terminal_id,
      authorization_provider_request_id, authorization_provider_reference,
      authorization_movement_reference, state, booking_request_id,
      intent_dedupe_active
    )
    select fixture.attempt_id, fixture.customer_user_id, gen_random_uuid(),
      fixture.payment_lifecycle_id, requests.profile_id, source.locale,
      source.public_slug, source.requested_search, source.quote_fingerprint,
      source.quote_payload,
      encode(extensions.digest(convert_to(fixture.label || ':intent', 'UTF8'), 'sha256'), 'hex'),
      source.intent_payload || jsonb_build_object('fenceCase', fixture.label),
      source.payment_snapshot || jsonb_build_object(
        'paymentLifecycleId', fixture.payment_lifecycle_id,
        'authorization', (source.payment_snapshot -> 'authorization') ||
          jsonb_build_object(
            'paymentLifecycleId', fixture.payment_lifecycle_id,
            'logicalOperationId', fixture.payment_lifecycle_id::text || ':authorization',
            'attemptId', fixture.payment_lifecycle_id::text || ':authorization:attempt-1',
            'providerRequestId', 'fence-auth-request-' || fixture.label,
            'providerReference', 'fence-auth-reference-' || fixture.label,
            'movementReference', 'fence-auth-movement-' || fixture.label
          ),
        'movements', jsonb_build_array(
          (source.payment_snapshot -> 'movements' -> 0) || jsonb_build_object(
            'logicalOperationId', fixture.payment_lifecycle_id::text || ':authorization',
            'attemptId', fixture.payment_lifecycle_id::text || ':authorization:attempt-1',
            'movementReference', 'fence-auth-movement-' || fixture.label
          )
        )
      ),
      'fictional-payments', 'local-test', 'fictional-merchant',
      'fictional-terminal', 'fence-auth-request-' || fixture.label,
      'fence-auth-reference-' || fixture.label,
      'fence-auth-movement-' || fixture.label,
      'finalized', fixture.booking_request_id, true
    from public.test_booking_request_lifecycle_fences fixture
    join public.booking_requests requests on requests.id = fixture.booking_request_id
    cross join lateral (
      select attempts.*
      from public.booking_request_submission_attempts attempts
      join public.booking_requests source_request
        on source_request.id = attempts.booking_request_id
      where source_request.customer_user_id = fixture.customer_user_id
        and attempts.payment_snapshot -> 'authorization' ->> 'status' = 'succeeded'
        and nullif(attempts.payment_snapshot -> 'release', 'null'::jsonb) is null
      order by source_request.created_at limit 1
    ) source
    where fixture.label = '${label}';

    insert into public.booking_request_authorization_claims (
      id, attempt_id, generation, state_revision, state, customer_user_id,
      profile_id, schedule_revision_id, payment_lifecycle_id,
      logical_operation_id, physical_attempt_id, amount_fils, currency,
      provider, environment, merchant_id, terminal_id,
      provider_idempotency_key, quote_fingerprint, intent_fingerprint,
      access_ranges, not_after, reconciliation_expires_at
    )
    select fixture.claim_id, fixture.attempt_id, 1, 2, 'converted',
      fixture.customer_user_id, attempts.profile_id, source.schedule_revision_id,
      fixture.payment_lifecycle_id,
      fixture.payment_lifecycle_id::text || ':authorization',
      fixture.payment_lifecycle_id::text || ':authorization:attempt-1',
      (attempts.quote_payload ->> 'customerTotalIqd')::bigint * 1000, 'IQD',
      'fictional-payments', 'local-test', 'fictional-merchant',
      'fictional-terminal', 'fence-auth:' || fixture.claim_id::text,
      attempts.quote_fingerprint, attempts.intent_fingerprint,
      source.access_ranges, timed.deadline, timed.deadline
    from public.test_booking_request_lifecycle_fences fixture
    join public.booking_request_submission_attempts attempts
      on attempts.id = fixture.attempt_id
    cross join lateral (
      select claims.schedule_revision_id, claims.access_ranges
      from public.booking_request_authorization_claims claims
      where claims.customer_user_id = fixture.customer_user_id
      order by claims.created_at limit 1
    ) source
    cross join lateral (
      select clock_timestamp() + interval '5 minutes' as deadline
    ) timed
    where fixture.label = '${label}';

    insert into public.booking_request_authorization_claim_items (
      claim_id, unit_kind, unit_id, service_day, price_iqd
    )
    select fixture.claim_id, source.unit_kind, source.unit_id,
      '2102-01-${day}'::date, source.price_iqd
    from public.test_booking_request_lifecycle_fences fixture
    cross join lateral (
      select items.*
      from public.booking_request_authorization_claims claims
      join public.booking_request_authorization_claim_items items
        on items.claim_id = claims.id
      where claims.customer_user_id = fixture.customer_user_id
      order by items.service_day limit 1
    ) source
    where fixture.label = '${label}';

    insert into public.booking_request_authorization_claim_occupancies (
      claim_id, schedule_revision_id, shift_id, service_day, active
    )
    select fixture.claim_id, occupancies.schedule_revision_id,
      occupancies.shift_id, '2102-01-${day}'::date, false
    from public.test_booking_request_lifecycle_fences fixture
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = fixture.commitment_id
    where fixture.label = '${label}';

    insert into public.booking_request_authorization_reconciliation_outbox (
      claim_id, claim_generation, observed_state_revision, state
    )
    select claim_id, 1, 2, 'complete'
    from public.test_booking_request_lifecycle_fences
    where label = '${label}';
  `);
}

function fixture(label) {
  const value = harness.runSql(`
    select booking_request_id || '|' || customer_user_id
    from public.test_booking_request_lifecycle_fences
    where label = '${label}';
  `);
  const [bookingRequestId, customerId] = value.split("|");
  if (!bookingRequestId || !customerId) {
    throw new Error(`Lifecycle fence fixture ${label} was not created`);
  }
  return { bookingRequestId, customerId };
}

function startWorker(label, pause = "none") {
  const target = fixture(label);
  const child = spawn(process.execPath, [workerBundle], {
    env: {
      ...process.env,
      SUPABASE_URL: required("SUPABASE_URL"),
      SUPABASE_SECRET_KEY: required("SUPABASE_SECRET_KEY"),
      LIFECYCLE_BOOKING_REQUEST_ID: target.bookingRequestId,
      LIFECYCLE_CUSTOMER_ID: target.customerId,
      LIFECYCLE_WORKER_PAUSE: pause,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const worker = { child, messages: [], stderr: "", exit: undefined };
  workers.add(worker);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    worker.stderr += chunk;
  });
  child.on("message", (message) => worker.messages.push(message));
  worker.exited = new Promise((resolve) => {
    child.on("close", (code, signal) => {
      worker.exit = { code, signal };
      resolve(worker.exit);
    });
  });
  return worker;
}

async function waitForStage(worker, stage) {
  const started = Date.now();
  while (true) {
    const message = worker.messages.find(
      (candidate) => candidate.stage === stage,
    );
    if (message) return message;
    const error = worker.messages.find(
      (candidate) => candidate.stage === "error",
    );
    if (error) throw new Error(`Lifecycle worker failed: ${error.message}`);
    if (worker.exit) {
      throw new Error(
        `Lifecycle worker exited before ${stage}: ${worker.stderr.trim()}`,
      );
    }
    if (Date.now() - started > 15_000) {
      throw new Error(`Lifecycle worker did not reach ${stage}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function finishWorker(worker) {
  const result = await worker.exited;
  if (result.code !== 0) {
    throw new Error(`Lifecycle worker failed: ${worker.stderr.trim()}`);
  }
  return waitForStage(worker, "complete");
}

function expireLease(label) {
  harness.runSql(`
    update public.booking_request_release_work work
    set lease_expires_at = clock_timestamp() - interval '1 millisecond'
    from public.test_booking_request_lifecycle_fences fixture
    where fixture.label = '${label}'
      and work.booking_request_id = fixture.booking_request_id;
  `);
}

function releaseWorkFixture(label) {
  const value = harness.runSql(`
    select work.id || '|' || work.lease_generation || '|' ||
      fixture.attempt_id || '|' || coalesce(work.active_operation_id::text, '')
    from public.test_booking_request_lifecycle_fences fixture
    join public.booking_request_release_work work
      on work.booking_request_id = fixture.booking_request_id
    where fixture.label = '${label}';
  `);
  const [workId, leaseGeneration, attemptId, operationId] = value.split("|");
  if (!workId || !leaseGeneration || !attemptId) {
    throw new Error(`Lifecycle release fixture ${label} is incomplete`);
  }
  return { workId, leaseGeneration, attemptId, operationId };
}

function startDatabaseSession(sql, closeInput = false) {
  const session = harness.startSession(sql, closeInput);
  databaseSessions.add(session);
  return session;
}

function assertBlockedBy(contenderName, blockerName) {
  const blockers = harness.runSql(`
    select count(*)::integer
    from pg_catalog.pg_stat_activity contender
    join pg_catalog.pg_stat_activity blocker
      on blocker.pid = any(pg_catalog.pg_blocking_pids(contender.pid))
    where contender.application_name = '${contenderName}'
      and blocker.application_name = '${blockerName}';
  `);
  if (blockers !== "1") {
    throw new Error(
      `${contenderName} was not blocked by ${blockerName}; found ${blockers}`,
    );
  }
}

async function assertNowaitSucceeds(sql) {
  const probe = startDatabaseSession(
    `
      begin;
      ${sql}
      rollback;
    `,
    true,
  );
  await harness.finishSession(probe);
}

async function verifyCompletedRequestBeforeWork(label, operation) {
  const fixture = releaseWorkFixture(label);
  const suffix = operation === "lease" ? "lease" : "finalize";
  const holderName = `rc_request_holder_${suffix}`;
  const contenderName = `rc_release_contender_${suffix}`;
  const marker = `${suffix}-request-locked`;
  const expectedResult = `${suffix}-result:withdrawn`;
  const targetCall =
    operation === "lease"
      ? `public.lease_booking_request_release_work('${fixture.workId}')`
      : `public.finalize_booking_request_release(
          '${fixture.workId}', ${fixture.leaseGeneration}, '${randomUUID()}'
        )`;
  const holder = startDatabaseSession(`
    set application_name = '${holderName}';
    begin;
    select 1 from public.booking_requests requests
    where requests.id = (
      select work.booking_request_id
      from public.booking_request_release_work work
      where work.id = '${fixture.workId}'
    )
    for update;
    select '${marker}';
  `);
  await harness.waitForMarker(holder, marker);
  const contender = startDatabaseSession(
    `
      set application_name = '${contenderName}';
      begin;
      select '${suffix}-result:' || (${targetCall} ->> 'status');
      rollback;
    `,
    true,
  );
  try {
    await harness.waitForLock(contenderName, contender);
    assertBlockedBy(contenderName, holderName);
    await assertNowaitSucceeds(`
      select 1 from public.booking_request_release_work work
      where work.id = '${fixture.workId}'
      for update nowait;
    `);
  } finally {
    await harness.finishSession(holder, { action: "rollback" });
    await harness.finishSession(contender);
  }
  if (!contender.stdout.includes(expectedResult)) {
    throw new Error(
      `${operation} changed the completed terminal result: ${contender.stdout.trim()}`,
    );
  }
}

async function verifyAttemptBeforeActiveOperation(label) {
  const fixture = releaseWorkFixture(label);
  if (!fixture.operationId) {
    throw new Error(
      `Lifecycle release fixture ${label} has no active operation`,
    );
  }
  const holderName = "rc_attempt_holder_active_release";
  const contenderName = "rc_lease_contender_active_release";
  const marker = "active-release-attempt-locked";
  const expectedResult = "active-release-result:release-required";
  const holder = startDatabaseSession(`
    set application_name = '${holderName}';
    begin;
    select 1 from public.booking_request_submission_attempts attempts
    where attempts.id = '${fixture.attemptId}'
    for update;
    select '${marker}';
  `);
  await harness.waitForMarker(holder, marker);
  const contender = startDatabaseSession(
    `
      set application_name = '${contenderName}';
      begin;
      select 'active-release-result:' ||
        (public.lease_booking_request_release_work('${fixture.workId}')
          ->> 'status');
      rollback;
    `,
    true,
  );
  try {
    await harness.waitForLock(contenderName, contender);
    assertBlockedBy(contenderName, holderName);
    await assertNowaitSucceeds(`
      select 1 from public.booking_request_release_operations operations
      where operations.id = '${fixture.operationId}'
      for update nowait;
    `);
  } finally {
    await harness.finishSession(holder, { action: "rollback" });
    await harness.finishSession(contender);
  }
  if (!contender.stdout.includes(expectedResult)) {
    throw new Error(
      `The reclaimed lease result changed: ${contender.stdout.trim()}`,
    );
  }
}

function verify(label, expectedOperations) {
  const actual = harness.runSql(`
    select requests.status || '|' || work.state || '|' ||
      work.lease_generation || '|' || commitments.status || '|' ||
      bool_and(not occupancies.active) || '|' ||
      count(distinct notifications.id) || '|' ||
      count(distinct operations.id) || '|' ||
      count(distinct provider.id) || '|' ||
      count(distinct movements.value)
    from public.test_booking_request_lifecycle_fences fixture
    join public.booking_requests requests
      on requests.id = fixture.booking_request_id
    join public.booking_request_release_work work
      on work.booking_request_id = requests.id
    join public.booking_request_submission_attempts attempts
      on attempts.id = fixture.attempt_id
    join public.cottage_booking_period_commitments commitments
      on commitments.id = fixture.commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = fixture.commitment_id
    join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = fixture.booking_request_id
    join public.booking_request_release_operations operations
      on operations.work_id = work.id
    join public.simulated_payment_provider_operations provider
      on provider.payment_lifecycle_id = fixture.payment_lifecycle_id
      and provider.operation_kind = 'release'
    cross join lateral jsonb_array_elements(
      attempts.payment_snapshot -> 'movements'
    ) movements(value)
    where fixture.label = '${label}'
      and movements.value ->> 'kind' = 'release'
    group by requests.status, work.state, work.lease_generation,
      commitments.status;
  `);
  const expected = `withdrawn|complete|2|released_hold|true|2|${expectedOperations}|1|1`;
  if (actual !== expected) {
    throw new Error(`${label} produced ${actual}; expected ${expected}`);
  }
}

const cleanup = `
  delete from public.booking_request_status_notifications notifications
  using public.test_booking_request_lifecycle_fences fixture
  where notifications.booking_request_id = fixture.booking_request_id;
  delete from public.simulated_payment_provider_operations provider
  using public.test_booking_request_lifecycle_fences fixture
  where provider.payment_lifecycle_id = fixture.payment_lifecycle_id;
  update public.booking_request_release_work work set active_operation_id = null
  from public.test_booking_request_lifecycle_fences fixture
  where work.booking_request_id = fixture.booking_request_id;
  delete from public.booking_request_release_operations operations
  using public.test_booking_request_lifecycle_fences fixture
  where operations.work_id in (
    select work.id from public.booking_request_release_work work
    where work.booking_request_id = fixture.booking_request_id
  );
  delete from public.booking_request_release_work work
  using public.test_booking_request_lifecycle_fences fixture
  where work.booking_request_id = fixture.booking_request_id;
  delete from public.booking_request_authorization_reconciliation_outbox outbox
  using public.test_booking_request_lifecycle_fences fixture
  where outbox.claim_id = fixture.claim_id;
  delete from public.booking_request_authorization_claim_occupancies occupancies
  using public.test_booking_request_lifecycle_fences fixture
  where occupancies.claim_id = fixture.claim_id;
  delete from public.booking_request_authorization_claim_items items
  using public.test_booking_request_lifecycle_fences fixture
  where items.claim_id = fixture.claim_id;
  delete from public.booking_request_authorization_claims claims
  using public.test_booking_request_lifecycle_fences fixture
  where claims.id = fixture.claim_id;
  delete from public.booking_request_submission_attempts attempts
  using public.test_booking_request_lifecycle_fences fixture
  where attempts.id = fixture.attempt_id;
  delete from public.booking_requests requests
  using public.test_booking_request_lifecycle_fences fixture
  where requests.id = fixture.booking_request_id;
  alter table public.booking_snapshots disable trigger reject_booking_snapshot_update;
  delete from public.booking_snapshots snapshots
  using public.test_booking_request_lifecycle_fences fixture
  where snapshots.id = fixture.booking_snapshot_id;
  alter table public.booking_snapshots enable trigger reject_booking_snapshot_update;
  delete from public.cottage_booking_period_occupancies occupancies
  using public.test_booking_request_lifecycle_fences fixture
  where occupancies.booking_period_commitment_id = fixture.commitment_id;
  delete from public.cottage_booking_period_commitments commitments
  using public.test_booking_request_lifecycle_fences fixture
  where commitments.id = fixture.commitment_id;
  drop table if exists public.test_booking_request_lifecycle_fences;
  alter table public.cottage_shifts disable trigger reject_cottage_shift_delete;
  delete from public.cottage_shifts
  where id in (
    '${fixtureIds.morningShift}',
    '${fixtureIds.eveningShift}'
  );
  alter table public.cottage_shifts enable trigger reject_cottage_shift_delete;
  alter table public.cottage_shift_schedule_revisions
    disable trigger reject_cottage_shift_schedule_revision_delete;
  delete from public.cottage_shift_schedule_revisions
  where id = '${fixtureIds.scheduleRevision}';
  alter table public.cottage_shift_schedule_revisions
    enable trigger reject_cottage_shift_schedule_revision_delete;
`;

let failure;
try {
  harness.guardDisposableLocalDatabase();
  await build({
    entryPoints: ["scripts/booking-request-lifecycle-worker.ts"],
    outfile: workerBundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    plugins: [
      {
        name: "server-only-noop",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^server-only$/ }, () => ({
            path: "server-only",
            namespace: "server-only-noop",
          }));
          buildApi.onLoad(
            { filter: /.*/, namespace: "server-only-noop" },
            () => ({ contents: "export {};", loader: "js" }),
          );
        },
      },
    ],
  });
  if (
    harness.runSql(
      "select to_regclass('public.test_booking_request_lifecycle_fences') is not null;",
    ) === "t"
  ) {
    harness.runSql(cleanup);
  }
  harness.runSql(`
    create table public.test_booking_request_lifecycle_fences (
      label text primary key,
      booking_request_id uuid not null unique,
      booking_snapshot_id uuid not null unique,
      commitment_id uuid not null unique,
      attempt_id uuid not null unique,
      claim_id uuid not null unique,
      payment_lifecycle_id uuid not null unique,
      customer_user_id uuid not null,
      owner_user_id uuid not null
    );
  `);

  seedSource();
  seed("pre-admitted", 1);
  const admitted = startWorker("pre-admitted", "after-admission");
  await waitForStage(admitted, "admitted");
  expireLease("pre-admitted");
  await verifyAttemptBeforeActiveOperation("pre-admitted");
  const admittedRecovery = startWorker("pre-admitted");
  const recoveredAdmission = await finishWorker(admittedRecovery);
  if (recoveredAdmission.result.status !== "withdrawn") {
    throw new Error("The recovery worker did not finalize pre-admitted work");
  }
  admitted.child.send("continue");
  await finishWorker(admitted);
  verify("pre-admitted", 1);
  await verifyCompletedRequestBeforeWork("pre-admitted", "lease");

  seed("post-expiry", 2);
  const rejected = startWorker("post-expiry", "before-admission");
  await waitForStage(rejected, "permitted");
  expireLease("post-expiry");
  rejected.child.send("continue");
  await finishWorker(rejected);
  const rejectedRecovery = startWorker("post-expiry");
  const recoveredAbsence = await finishWorker(rejectedRecovery);
  if (recoveredAbsence.result.status !== "withdrawn") {
    throw new Error(
      "The recovery worker did not retry proven provider absence",
    );
  }
  verify("post-expiry", 2);
  await verifyCompletedRequestBeforeWork("post-expiry", "finalize");
  console.log(
    "Booking Request release concurrency passed: separate Node workers with separate Supabase clients used the production repository and DurablePaymentSimulator; pre-expiry admission reconciled the same operation after lease loss, while post-expiry admission created no provider row and retried only after durable absence proof.",
  );
} catch (error) {
  failure = error;
} finally {
  for (const worker of workers) {
    if (!worker.exit) worker.child.kill("SIGTERM");
  }
  for (const session of databaseSessions) {
    if (!session.exit) session.child.kill("SIGTERM");
  }
  try {
    harness.guardDisposableLocalDatabase();
    if (
      harness.runSql(
        "select to_regclass('public.test_booking_request_lifecycle_fences') is not null;",
      ) === "t"
    ) {
      harness.runSql(cleanup);
    }
  } catch (cleanupError) {
    failure = failure
      ? new AggregateError([failure, cleanupError], "Lifecycle cleanup failed")
      : cleanupError;
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
if (failure) throw failure;
