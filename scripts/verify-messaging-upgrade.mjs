import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const priorVersion = "20260913165650";
const targetVersion = "20260914085524";
const request = "60000000-0000-4000-8000-000000001001";
const customer = "10000000-0000-4000-8000-000000001002";
const harness = createLocalSupabaseConcurrencyHarness();

function between(text, startMarker, endMarker, name) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing ${name}`);
  assert.equal(text.lastIndexOf(startMarker), start, `Duplicate ${name} start`);
  assert.equal(text.lastIndexOf(endMarker), end, `Duplicate ${name} end`);
  return text.slice(start, end);
}

function fixture(source, name) {
  return between(source, `-- BEGIN ${name}`, `-- END ${name}`, name);
}

const cancellationSource = readFileSync(
  new URL(
    "../supabase/tests/database/booking_cancellation.test.sql",
    import.meta.url,
  ),
  "utf8",
);
const correctionSource = readFileSync(
  new URL(
    "../supabase/tests/database/booking_request_payment_correction.test.sql",
    import.meta.url,
  ),
  "utf8",
);
const cancellationPaymentFixture = fixture(
  cancellationSource,
  "PAYMENT EVIDENCE FIXTURE",
);
const cancellationFixture = fixture(cancellationSource, "CANCELLATION FIXTURE");
const correctionPaymentFixture = fixture(
  correctionSource,
  "PAYMENT EVIDENCE FIXTURE",
);
const failedCaptureFixture = fixture(correctionSource, "CONFIRMATION FIXTURE");

const preservedTables = [
  "booking_requests",
  "booking_snapshots",
  "cottage_booking_period_commitments",
  "cottage_inventory_commitments",
  "cottage_booking_period_occupancies",
  "booking_request_submission_attempts",
  "booking_request_authorization_claims",
  "booking_request_authorization_claim_items",
  "booking_request_authorization_claim_occupancies",
  "booking_request_capture_work",
  "booking_request_provider_operation_identities",
  "payment_provider_operations",
  "booking_confirmations",
  "booking_receipts",
  "booking_request_payment_history",
  "booking_cancellations",
  "booking_cancellation_incidents",
  "booking_cancellation_administrator_audit",
  "booking_notification_events",
];

function snapshot() {
  return Object.fromEntries(
    preservedTables.map((table) => [
      table,
      JSON.parse(
        harness.runSql(
          `select coalesce(jsonb_agg(payload order by payload::text),'[]'::jsonb)
           from (
             select ${table === "booking_request_submission_attempts" ? "'{\"conversation_id\":null}'::jsonb ||" : ""}
               to_jsonb(rows)
               payload
             from public.${table} rows
           ) preserved;`,
        ),
      ),
    ]),
  );
}

function runSupabase(args) {
  const workdir = process.env.SUPABASE_LOCAL_WORKDIR;
  const result = spawnSync("npx", ["supabase", ...args, "--workdir", workdir], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Messaging upgrade ${args.join(" ")} failed: ${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      { cause: result.error },
    );
  }
}

function resetToPrior() {
  runSupabase(["db", "reset", "--local", "--version", priorVersion]);
  assert.equal(
    harness.runSql(
      "select max(version) from supabase_migrations.schema_migrations;",
    ),
    priorVersion,
    "Messaging upgrade starts on its exact predecessor",
  );
  assert.equal(
    harness.runSql(
      "select to_regclass('public.messaging_conversations') is null;",
    ),
    "t",
    "The predecessor has no messaging storage",
  );
}

function seedConfirmedBooking() {
  harness.runSql(`begin;
    ${cancellationPaymentFixture}
    ${cancellationFixture}
    select pg_temp.seed_cancellation_booking('2101-01-01');
    commit;`);
}

const scenarios = [
  {
    name: "paid-confirmed",
    seed() {
      seedConfirmedBooking();
    },
    expectedPaymentStatus: "paid-confirmed",
    expectedCommitmentStatus: "confirmed_booking",
  },
  {
    name: "payment-required",
    seed() {
      harness.runSql(`begin;
        ${correctionPaymentFixture}
        ${failedCaptureFixture}
        set local role service_role;
        select public.record_booking_request_capture_failure(
          '${request}',
          (select (result#>>'{permit,leaseGeneration}')::bigint
             from confirmation_capture_lease),
          (select (result#>>'{permit,leaseToken}')::uuid
             from confirmation_capture_lease),
          (select result from confirmation_capture_result)
        );
        commit;`);
    },
    expectedPaymentStatus: "payment-required",
    expectedCommitmentStatus: "pending_hold",
  },
  {
    name: "cancelled",
    seed() {
      seedConfirmedBooking();
      harness.runSql(`begin;
        select set_config('request.jwt.claim.sub','${customer}',true);
        set local role authenticated;
        select public.commit_booking_cancellation(
          '${request}',
          '90000000-0000-4000-8000-000000003699',
          'customer',null,null,
          jsonb_build_object(
            'revision',public.get_booking_cancellation_facts(
              '${request}','customer'
            )->>'revision',
            'refundObligation',jsonb_build_object(
              'bookingPriceFils',110000000,
              'bookingServiceFeeFils',5000000
            )
          )
        );
        commit;`);
    },
    expectedPaymentStatus: "capture-processing",
    expectedCommitmentStatus: "cancelled_booking",
  },
];

harness.guardDisposableLocalDatabase();
let failure;
try {
  for (const scenario of scenarios) {
    resetToPrior();
    scenario.seed();
    assert.equal(
      harness.runSql(`select public.booking_request_payment_status(requests)
        from public.booking_requests requests where id='${request}';`) || null,
      scenario.expectedPaymentStatus,
      `${scenario.name} uses the production payment projection`,
    );
    assert.equal(
      harness.runSql(`select status::text
        from public.cottage_booking_period_commitments
        where id='50000000-0000-4000-8000-000000001001';`),
      scenario.expectedCommitmentStatus,
      `${scenario.name} uses the production booking transition`,
    );
    const before = snapshot();
    runSupabase(["migration", "up", "--local"]);
    assert.equal(
      harness.runSql(`select count(*) from supabase_migrations.schema_migrations
        where version='${targetVersion}';`),
      "1",
      "The complete messaging migration is present after upgrade",
    );
    assert.deepEqual(
      snapshot(),
      before,
      `${scenario.name} upgrade preserves every existing booking, payment, inventory, and cancellation fact`,
    );
    assert.equal(
      harness.runSql(`select
        (select count(*) from public.messaging_conversations)
        +(select count(*) from public.messaging_conversation_booking_requests)
        +(select count(*) from public.messaging_messages);`),
      "0",
      `${scenario.name} upgrade does not invent conversation or message history`,
    );
  }
  console.log(
    "Messaging upgrade preserved production paid-confirmed, payment-required, and cancelled booking graphs and created no conversation or message history.",
  );
} catch (error) {
  failure = error;
} finally {
  try {
    harness.guardDisposableLocalDatabase();
    runSupabase(["db", "reset", "--local"]);
  } catch (error) {
    failure = new AggregateError(
      [...(failure ? [failure] : []), error],
      "Messaging upgrade proof or disposable schema restoration failed",
    );
  }
}
if (failure) throw failure;
