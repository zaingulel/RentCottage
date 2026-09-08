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

// Keep expiry import evidence separate from the original post-upgrade recovery.
const expiryLifecycle = "73000000-0000-4000-8000-000000001441";
const expiryFingerprint = createHash("sha256")
  .update(
    JSON.stringify({
      provider: {
        provider: "fictional-payments",
        environment: "local-test",
        merchantId: "fictional-merchant",
        terminalId: "fictional-terminal",
      },
      kind: "capture",
      paymentLifecycleId: expiryLifecycle,
      logicalOperationId: `${expiryLifecycle}:capture`,
      attemptId: `${expiryLifecycle}:capture:attempt-2`,
      amountFils: 115000000,
      currency: "IQD",
    }),
  )
  .digest("hex");
const expiryFixture = fixture
  .replaceAll("00000000100", "00000000144")
  .replaceAll("750000100", "750000144")
  .replaceAll("confirmation-auth-", "expiry-import-auth-")
  .replaceAll("CONFIRMATION-HOLD-1", "EXPIRY-IMPORT-HOLD-144")
  .replaceAll("confirmation_capture_", "expiry_import_capture_")
  .replaceAll("recovery_payment_required", "expiry_import_payment_required")
  .replaceAll(
    "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
    expiryFingerprint,
  );

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
  harness.runSql(`begin;${fixture}${expiryFixture}${olderWithoutProvider}
    insert into auth.users(id,aud,role,phone,phone_confirmed_at) values('10000000-0000-4000-8000-000000001370','authenticated','authenticated','+9647500001370',now());
    insert into public.account_contexts(user_id,role) values('10000000-0000-4000-8000-000000001370','platform_administrator');
    create temp table history_original_clock_functions as
      select pg_get_functiondef(procedures.oid) definition from pg_proc procedures join pg_namespace namespaces on namespaces.oid=procedures.pronamespace
      where namespaces.nspname='public' and procedures.prokind='f' and procedures.prosrc like '%clock_timestamp()%'
        and procedures.proname like '%booking_request%';
    create function public.history_upgrade_test_now() returns timestamptz language sql volatile security definer set search_path='' as $clock$
      select payment_required_deadline from public.booking_request_capture_work where booking_request_id='60000000-0000-4000-8000-000000001441'
    $clock$;
    select replace(definition,'clock_timestamp()','public.history_upgrade_test_now()') from history_original_clock_functions \\gexec
    set local role service_role;
    select public.prepare_booking_request_payment_required_expiry('60000000-0000-4000-8000-000000001441','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}');
    reset role;
    select definition from history_original_clock_functions \\gexec
    drop function public.history_upgrade_test_now();
    update public.simulated_payment_provider_operations set original_outcome='indeterminate';
    commit;`);
  const expiry = JSON.parse(
    harness.runSql(
      "select jsonb_build_object('createdAt',operations.created_at,'requestCreatedAt',requests.created_at) from public.booking_request_payment_required_expiry_operations operations join public.booking_requests requests on requests.id=operations.booking_request_id;",
    ),
  );
  assert.notEqual(
    expiry.createdAt,
    expiry.requestCreatedAt,
    "The fixture must distinguish the expiry operation clock from the request clock",
  );
  const before = sourceHashes();
  const provider = JSON.parse(
    harness.runSql(
      "select jsonb_build_object('id',id,'originalOutcome',original_outcome,'outcome',current_outcome,'amount',amount_fils::text,'createdAt',created_at,'occurredAt',authoritative_outcome_at,'updatedAt',updated_at) from public.simulated_payment_provider_operations where claim_id='72000000-0000-4000-8000-000000001001';",
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
      event.kind !== "physical-attempt",
  );
  assert.equal(corrected.length, 1);
  assert.equal(corrected[0].outcome, provider.outcome);
  assert.equal(corrected[0].sourceRecordedAt, provider.updatedAt);
  assert.equal(corrected[0].providerOccurredAt ?? null, provider.occurredAt);
  assert.equal(corrected[0].receivedAt, undefined);
  const repairFailures = [];
  for (const check of [
    () =>
      assert.equal(
        corrected[0].kind,
        "state-transition",
        "Imported changed provider evidence is a transition, not an invented receipt",
      ),
    () =>
      assert.equal(
        corrected[0].fromState,
        provider.originalOutcome,
        "Import retains the original outcome as previous state",
      ),
    () =>
      assert.equal(
        corrected[0].toState,
        provider.outcome,
        "Import retains the current provider outcome as resulting state",
      ),
    () =>
      assert.equal(
        history("RC-REQ-0000000000001441").events.find(
          (event) => event.source === "expiry-operation",
        ).sourceRecordedAt,
        expiry.createdAt,
        "Import uses the expiry operation's own exact source clock",
      ),
    () =>
      assert.equal(
        imported.events.find((event) => event.source === "authorization-claim")
          .operationGeneration,
        1,
        "Original authorization generation is an operation generation",
      ),
    () =>
      assert.equal(
        imported.events.find((event) => event.source === "authorization-claim")
          .recoveryGeneration,
        undefined,
        "Original authorization must not claim a recovery generation",
      ),
  ]) {
    try {
      check();
    } catch (error) {
      repairFailures.push(error);
      console.error(error.message);
    }
  }
  if (repairFailures.length)
    throw new AggregateError(
      repairFailures,
      "Retained-evidence import regressions",
    );
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
