import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
const priorVersion = "20260906200000";
const identity = {
  provider: "fictional-payments",
  environment: "local-test",
  merchantId: "fictional-merchant",
  terminalId: "fictional-terminal",
};
const literal = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const fixture = readFileSync(
  "supabase/tests/database/booking_request_payment_recovery.test.sql",
  "utf8",
)
  .split("select plan(")[0]
  .replace(/^begin;/, "");
const id = (prefix, index, suffix = 1) =>
  `${prefix}000000-0000-4000-8000-00000000${index}0${suffix}`;
const parsed = (sql) =>
  JSON.parse(harness.runSql(`set role service_role;${sql}`));
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
  if (result.error)
    throw new Error("Unable to run the guarded local upgrade command", {
      cause: result.error,
    });
  if (result.status !== 0)
    throw new Error(
      `Local Supabase ${args.join(" ")} failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
}
function seed(index) {
  const lifecycle = id("73", index);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        provider: identity,
        kind: "capture",
        paymentLifecycleId: lifecycle,
        logicalOperationId: `${lifecycle}:capture`,
        attemptId: `${lifecycle}:capture:attempt-2`,
        amountFils: 115000000,
        currency: "IQD",
      }),
    )
    .digest("hex");
  const source = fixture
    .replaceAll("00000000100", `00000000${index}0`)
    .replaceAll("750000100", `750000${index}0`)
    .replaceAll("confirmation-auth-", `expiry-upgrade-${index}-auth-`)
    .replaceAll("CONFIRMATION-HOLD-1", `EXPIRY-UPGRADE-HOLD-${index}`)
    .replaceAll(
      "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
      fingerprint,
    );
  harness.runSql(`begin;${source}commit;`);
}
const clockSignatures = [
  "lease_booking_request_capture_work(uuid,jsonb)",
  "execute_simulated_booking_request_capture(jsonb,text)",
  "record_booking_request_capture_failure(uuid,bigint,uuid,jsonb)",
  "claim_customer_booking_request_payment_recovery(uuid,uuid,text)",
  "lease_booking_request_payment_recovery_step(uuid)",
  "execute_simulated_booking_request_payment_recovery(jsonb,text)",
  "finalize_booking_request_confirmation(uuid,jsonb)",
];
const tables = [
  "booking_requests",
  "booking_snapshots",
  "booking_request_capture_work",
  "booking_request_submission_attempts",
  "booking_request_authorization_claims",
  "booking_request_authorization_claim_items",
  "booking_request_authorization_claim_occupancies",
  "booking_request_provider_operation_identities",
  "simulated_payment_provider_operations",
  "booking_request_payment_recovery_attempts",
  "booking_request_payment_recovery_operations",
  "booking_request_release_work",
  "booking_request_release_operations",
  "cottage_booking_period_commitments",
  "cottage_inventory_commitments",
  "cottage_booking_period_occupancies",
  "booking_request_status_notifications",
  "owner_request_notifications",
  "booking_confirmations",
  "booking_receipts",
];
function snapshot() {
  return Object.fromEntries(
    tables.map((table) => [
      table,
      JSON.parse(
        harness.runSql(
          `select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]') from public.${table} rows;`,
        ),
      ),
    ]),
  );
}
function admit(index) {
  return JSON.parse(
    harness
      .runSql(
        `select set_config('request.jwt.claim.sub','${id("10", index, 2)}',false);set role authenticated;
    select public.claim_customer_booking_request_payment_recovery('${id("60", index)}','${id("81", index)}','simulated-replacement');`,
      )
      .split("\n")
      .at(-1),
  ).attemptId;
}
function step(attempt, outcome) {
  return parsed(
    `select public.execute_simulated_booking_request_payment_recovery(public.lease_booking_request_payment_recovery_step('${attempt}')->'permit','${outcome}');`,
  );
}
let failure;
harness.guardDisposableLocalDatabase();
try {
  runSupabase(["db", "reset", "--local", "--version", priorVersion]);
  assert.equal(
    harness.runSql(
      "select max(version) from supabase_migrations.schema_migrations;",
    ),
    priorVersion,
    "Upgrade must begin on the exact pre-expiry migration",
  );
  const definitions = clockSignatures.map((signature) =>
    harness.runSql(
      `select pg_get_functiondef('public.${signature}'::regprocedure);`,
    ),
  );
  harness.runSql(
    "create table public.expiry_upgrade_clock(instant timestamptz not null);insert into public.expiry_upgrade_clock values(clock_timestamp());create function public.expiry_upgrade_now() returns timestamptz language sql volatile security definer set search_path='' as $$select instant from public.expiry_upgrade_clock$$;",
  );
  for (const definition of definitions)
    harness.runSql(
      definition.replaceAll("clock_timestamp()", "public.expiry_upgrade_now()"),
    );
  seed(10); // This recovery window is still open at migration time.
  harness.runSql(
    "update public.expiry_upgrade_clock set instant=instant-interval '21 minutes';",
  );
  for (const index of [11, 12, 13]) seed(index);
  const blocked = admit(12);
  step(blocked, "indeterminate");
  const recovered = admit(13);
  for (let index = 0; index < 3; index++) step(recovered, "succeeded");
  parsed(
    `select public.finalize_booking_request_confirmation('${id("60", 13)}',public.get_booking_request_payment_recovery_confirmation_evidence('${recovered}'));`,
  );
  for (const definition of definitions) harness.runSql(definition);
  harness.runSql(
    "drop function public.expiry_upgrade_now();drop table public.expiry_upgrade_clock;",
  );
  assert.equal(
    harness.runSql(
      "select count(*) from public.booking_request_capture_work where payment_required_deadline > clock_timestamp();",
    ),
    "1",
  );
  assert.equal(
    harness.runSql(
      "select count(*) from public.booking_request_capture_work where payment_required_deadline <= clock_timestamp();",
    ),
    "3",
  );
  assert.equal(
    harness.runSql(
      "select count(*) from public.booking_request_payment_recovery_attempts where state='blocked';",
    ),
    "1",
  );
  assert.equal(
    harness.runSql("select count(*) from public.booking_confirmations;"),
    "1",
  );
  const before = snapshot();
  runSupabase(["migration", "up", "--local"]);
  assert.deepEqual(
    snapshot(),
    before,
    "Expiry migration must preserve every pre-existing payment, deadline, booking, hold and receipt row exactly",
  );
  assert.equal(
    harness.runSql(
      "select (select count(*) from public.booking_request_payment_required_expiry_work)||':'||(select count(*) from public.booking_request_payment_required_expiry_operations);",
    ),
    "0:0",
    "Migration must not manufacture expiry work or provider effects",
  );
  const due = parsed(
    `select public.claim_due_booking_request_payment_required_expiries(20,${literal(identity)});`,
  );
  assert.deepEqual(
    due.map((row) => row.bookingRequestId).sort(),
    [id("60", 11), id("60", 12)],
    "Legacy elapsed and blocked requests become eligible, while open and recovered requests do not",
  );
  const elapsed = parsed(
    `select public.prepare_booking_request_payment_required_expiry('${id("60", 11)}',${literal(identity)});`,
  );
  assert.equal(elapsed.status, "release");
  parsed(
    `select public.execute_simulated_booking_request_payment_required_expiry(${literal(elapsed.permit)},'succeeded');`,
  );
  assert.equal(
    parsed(
      `select public.finalize_booking_request_payment_required_expiry('${id("60", 11)}');`,
    ).status,
    "expired",
  );
  assert.equal(
    parsed(
      `select public.prepare_booking_request_payment_required_expiry('${id("60", 12)}',${literal(identity)});`,
    ).status,
    "reconcile-recovery",
  );
  assert.equal(
    parsed(
      `select public.finalize_booking_request_payment_required_expiry('${id("60", 12)}');`,
    ).status,
    "attention-required",
  );
  assert.equal(
    parsed(
      `select public.prepare_booking_request_payment_required_expiry('${id("60", 13)}',${literal(identity)});`,
    ).status,
    "confirmed",
  );
  const after = snapshot();
  assert.deepEqual(
    after.booking_request_capture_work,
    before.booking_request_capture_work,
    "Legacy processing must never rewrite the fixed deadlines or original capture work",
  );
  assert.deepEqual(after.booking_confirmations, before.booking_confirmations);
  assert.deepEqual(after.booking_receipts, before.booking_receipts);
  assert.deepEqual(
    after.booking_request_payment_recovery_attempts,
    before.booking_request_payment_recovery_attempts,
  );
  assert.deepEqual(
    after.booking_request_payment_recovery_operations,
    before.booking_request_payment_recovery_operations,
  );
  assert.equal(
    after.simulated_payment_provider_operations.length,
    before.simulated_payment_provider_operations.length + 1,
  );
  assert.ok(
    after.cottage_booking_period_occupancies
      .filter((row) => row.booking_period_commitment_id === id("50", 12))
      .every((row) => row.active),
  );
  console.log(
    "The exact pre-139 open, elapsed, blocked and recovered graphs survive migration byte-for-byte; only the safely released legacy request expires, blocked inventory remains held and confirmed recovery is preserved.",
  );
} catch (error) {
  failure = error;
} finally {
  try {
    runSupabase(["db", "reset", "--local"]);
  } catch (error) {
    failure = failure
      ? new AggregateError(
          [failure, error],
          "Expiry upgrade evidence and current-schema restoration failed",
        )
      : error;
  }
}
if (failure) throw failure;
console.log(
  "The disposable database is restored to the complete current migration chain.",
);
