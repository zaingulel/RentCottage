import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
const priorVersion = "20260907200000";
const fixture = readFileSync(
  "supabase/tests/database/booking_request_payment_correction.test.sql",
  "utf8",
)
  .split("select no_plan();")[0]
  .replace(/^begin;/, "");

function supabase(args) {
  const workdir = process.env.SUPABASE_LOCAL_WORKDIR;
  const result = spawnSync(
    "npx",
    ["supabase", ...args, ...(workdir ? ["--workdir", workdir] : [])],
    { encoding: "utf8", env: process.env, maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error(`Supabase ${args.join(" ")} failed: ${result.stderr}`);
}

const sourceTables = [
  "booking_requests",
  "booking_snapshots",
  "booking_request_submission_attempts",
  "booking_request_authorization_claims",
  "simulated_payment_provider_operations",
  "booking_request_capture_work",
  "booking_request_release_work",
  "booking_request_release_operations",
  "booking_request_payment_recovery_attempts",
  "booking_request_payment_recovery_operations",
  "booking_request_payment_required_expiry_work",
  "booking_request_payment_required_expiry_operations",
  "booking_request_payment_correction_observations",
  "booking_confirmations",
  "booking_request_confirmation_invalidations",
  "booking_receipts",
  "cottage_booking_period_commitments",
  "cottage_booking_period_occupancies",
];
function sourceHashes() {
  return Object.fromEntries(
    sourceTables.map((table) => [
      table,
      createHash("sha256")
        .update(
          harness.runSql(
            `select coalesce(jsonb_agg(to_jsonb(source) order by to_jsonb(source)::text),'[]') from public.${table} source;`,
          ),
        )
        .digest("hex"),
    ]),
  );
}
function history(reference) {
  return JSON.parse(
    harness.runSql(`
    set request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000001370","role":"authenticated","aal":"aal2"}';
    set role authenticated;
    select public.get_administrator_booking_request_payment_history('${reference}');
  `),
  );
}
const olderWithoutProvider = readFileSync(
  "supabase/tests/database/booking_request_payment_history.test.sql",
  "utf8",
)
  .split("-- BEGIN HISTORY BROWSER FIXTURE")[1]
  .split("select public.append_booking_request_payment_history(")[0];
let failure;
harness.guardDisposableLocalDatabase();
try {
  supabase(["db", "reset", "--local", "--version", priorVersion]);
  assert.equal(
    harness.runSql(
      "select max(version) from supabase_migrations.schema_migrations;",
    ),
    priorVersion,
  );
  harness.runSql(`begin;${fixture}${olderWithoutProvider}
    insert into auth.users(id,aud,role,phone,phone_confirmed_at) values('10000000-0000-4000-8000-000000001370','authenticated','authenticated','+9647500001370',now());
    insert into public.account_contexts(user_id,role) values('10000000-0000-4000-8000-000000001370','platform_administrator');
    update public.simulated_payment_provider_operations set original_outcome='indeterminate';
    commit;`);
  const before = sourceHashes();
  const provider = JSON.parse(
    harness.runSql(
      "select jsonb_build_object('id',id,'originalOutcome',original_outcome,'outcome',current_outcome,'amount',amount_fils::text,'createdAt',created_at,'occurredAt',authoritative_outcome_at,'updatedAt',updated_at) from public.simulated_payment_provider_operations;",
    ),
  );
  const requestTime = harness.runSql(
    "select to_jsonb(created_at) from public.booking_requests where booking_request_reference='RC-REQ-0000000000000137';",
  );
  const installationStarted = harness.runSql("select clock_timestamp();");
  supabase(["migration", "up", "--local"]);
  assert.deepEqual(
    sourceHashes(),
    before,
    "Upgrade must preserve every selected source row byte for byte",
  );
  const imported = history("RC-REQ-0000000000001001");
  assert.equal(imported.historyCoverage, "retained-evidence-only");
  assert.ok(imported.events.every((event) => event.provenance === "imported"));
  const physical = imported.events.filter(
    (event) => event.kind === "physical-attempt",
  );
  assert.equal(physical.length, 1);
  assert.equal(physical[0].providerOperationId, provider.id);
  assert.equal(physical[0].outcome, provider.originalOutcome);
  assert.equal(physical[0].amountFils, provider.amount);
  assert.equal(physical[0].sourceRecordedAt, provider.createdAt);
  assert.equal(
    physical[0].providerOccurredAt,
    undefined,
    "The original indeterminate response has no authoritative occurrence time",
  );
  const corrected = imported.events.filter(
    (event) =>
      event.source === "provider-operation" &&
      event.kind === "receipt-observation",
  );
  assert.equal(corrected.length, 1);
  assert.equal(corrected[0].outcome, provider.outcome);
  assert.equal(corrected[0].sourceRecordedAt, provider.updatedAt);
  assert.equal(corrected[0].providerOccurredAt ?? null, provider.occurredAt);
  assert.equal(corrected[0].receivedAt, undefined);
  assert.equal(
    physical[0].receivedAt,
    undefined,
    "Provider execution is not a provider receipt",
  );
  assert.ok(
    imported.events.every(
      (event) =>
        Date.parse(event.recordedAt) >= Date.parse(installationStarted),
    ),
  );
  const older = history("RC-REQ-0000000000000137");
  assert.equal(
    older.historyCoverage,
    "retained-evidence-only",
    "A pre-installation request without provider records is still partial history",
  );
  const retainedRequest = older.events.find(
    (event) => event.source === "booking-request",
  );
  assert.equal(retainedRequest.sourceRecordedAt, JSON.parse(requestTime));
  assert.equal(retainedRequest.providerOccurredAt, undefined);
  assert.equal(retainedRequest.receivedAt, undefined);
  harness.runSql(`begin;
    set request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1"}';
    set local role authenticated;
    select public.claim_customer_booking_request_payment_recovery('60000000-0000-4000-8000-000000001001','81000000-0000-4000-8000-000000001001','simulated-replacement');
    commit;`);
  const subsequent = history("RC-REQ-0000000000001001");
  assert.deepEqual(
    subsequent.events.slice(0, imported.events.length),
    imported.events,
  );
  assert.equal(subsequent.historyCoverage, "retained-evidence-only");
  assert.ok(
    subsequent.events
      .slice(imported.events.length)
      .some(
        (event) =>
          event.source === "recovery-attempt" &&
          event.provenance === "observed",
      ),
  );
  console.log(
    "Upgrade preserves all selected source hashes and exact imported facts/clocks through AAL2; pre-installation roots without provider evidence remain partial and subsequent real recovery events append without rewriting imports.",
  );
} catch (error) {
  failure = error;
} finally {
  try {
    supabase(["db", "reset", "--local"]);
  } catch (restoreError) {
    if (!failure) failure = restoreError;
  }
}
if (failure) throw failure;
