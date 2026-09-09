import { historicalProviderOperationSource } from "../tests/fixtures/payment-provider-history.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSync } from "esbuild";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
let paymentEvidenceInstalled = false;
const priorVersion = "20260907200000";
const fixture = readFileSync(
  "supabase/fixtures/legacy-booking_request_payment_correction.sql",
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
            `select coalesce(jsonb_agg(to_jsonb(source) order by to_jsonb(source)::text),'[]') from ${table === "simulated_payment_provider_operations" ? historicalProviderOperationSource(paymentEvidenceInstalled) : `public.${table}`} source;`,
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
  "supabase/fixtures/legacy-booking_request_payment_history.sql",
  "utf8",
)
  .split("-- BEGIN HISTORY BROWSER FIXTURE")[1]
  .split("select public.append_booking_request_payment_history(")[0];
function verifyProviderEvidenceCutover() {
  // This stage begins at the last shipped schema, with history already installed.
  supabase(["db", "reset", "--local", "--version", "20260908130000"]);
  paymentEvidenceInstalled = false;
  harness.runSql(`begin;${fixture}${expiryFixture}commit;`);
  const literal = (value) =>
    `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const recovery = [];
  for (const suffix of ["1001", "1441"]) {
    const customerSuffix = suffix === "1001" ? "1002" : "1442";
    const requestId = `60000000-0000-4000-8000-00000000${suffix}`;
    const claimed = JSON.parse(
      harness.runSql(`begin;
      set request.jwt.claims='{"sub":"10000000-0000-4000-8000-00000000${customerSuffix}","role":"authenticated","aal":"aal1"}';
      set local role authenticated;
      select public.claim_customer_booking_request_payment_recovery('${requestId}','81000000-0000-4000-8000-00000000${suffix}','simulated-replacement'); commit;`),
    );
    const leased = JSON.parse(
      harness.runSql(
        `set role service_role; select public.lease_booking_request_payment_recovery_step('${claimed.attemptId}');`,
      ),
    );
    assert.equal(leased.status, "leased");
    const result = JSON.parse(
      harness.runSql(
        `set role service_role; select public.execute_simulated_booking_request_payment_recovery(${literal(leased.permit)},'${suffix === "1001" ? "succeeded" : "indeterminate"}');`,
      ),
    );
    assert.equal(
      result.outcome,
      suffix === "1001" ? "succeeded" : "indeterminate",
    );
    if (suffix === "1001") {
      // Retained historical metadata predating sticky quarantine: the original
      // indeterminate response resolved successfully before this schema existed.
      // This is source-fixture arrangement, not a current recovery transition.
      harness.runSql(`update public.simulated_payment_provider_operations set original_outcome='indeterminate'
        where recovery_attempt_id='${claimed.attemptId}' and operation_kind='release';`);
    } else {
      assert.equal(
        harness.runSql(
          `select public.booking_request_payment_quarantined('${requestId}');`,
        ),
        "t",
        "A currently uncertain legacy release retains shipped sticky quarantine",
      );
    }
    recovery.push({ requestId, permit: leased.permit });
  }
  const receipt = JSON.parse(
    harness.runSql(`select jsonb_build_object('receiptId','legacy-pre-execution-occurrence',
    'bookingRequestId','60000000-0000-4000-8000-000000001001','providerOperationId',id,
    'providerIdentity',jsonb_build_object('provider',provider,'environment',environment,'merchantId',merchant_id,'terminalId',terminal_id),
    'paymentLifecycleId',payment_lifecycle_id,'logicalOperationId',logical_operation_id,'physicalAttemptId',physical_attempt_id,
    'kind',operation_kind,'amountFils',amount_fils,'currency',currency,'providerRequestId',provider_request_id,'providerReference',provider_reference,
    'movementReference',movement_reference,'outcome',current_outcome,'occurredAt',created_at-interval '1 second')
    from public.simulated_payment_provider_operations where claim_id='72000000-0000-4000-8000-000000001001' and operation_kind='capture';`),
  );
  const observe = (value) =>
    paymentEvidenceInstalled
      ? runPaymentWorker("payment-correction", value.bookingRequestId, {
          PAYMENT_CORRECTION_RECEIPT: JSON.stringify(value),
        })
      : JSON.parse(
          harness.runSql(
            `set role service_role; select public.observe_booking_request_payment_correction('${value.bookingRequestId}','${value.providerOperationId}',${literal(value)});`,
          ),
        );
  assert.equal(
    observe(receipt).status,
    "recorded",
    "The shipped correction accepts this historical occurrence before row creation",
  );
  harness.runSql(`select public.append_booking_request_payment_history('73000000-0000-4000-8000-000000001001','60000000-0000-4000-8000-000000001001',
    'state-transition','provider-operation','imported',target_provider_operation_id=>'${receipt.providerOperationId}',target_outcome=>'failed',target_source_recorded_at=>'2026-01-01T00:00:00Z');`);
  const graph = sourceHashes();
  const retainedHistory = harness.runSql(
    "select jsonb_agg(to_jsonb(history) order by sequence) from public.booking_request_payment_history history;",
  );
  const sequence = harness.runSql(
    "select jsonb_build_array(last_value,is_called) from public.booking_request_payment_history_sequence_seq;",
  );
  const catalog = (table) =>
    JSON.parse(
      harness.runSql(`select jsonb_build_object('table',tables.oid,'type',tables.reltype,
    'indexes',(select jsonb_agg(indexrelid order by indexrelid) from pg_index where indrelid=tables.oid),
    'foreignKeys',(select jsonb_agg(jsonb_build_array(oid,conname,conrelid,confrelid) order by oid) from pg_constraint where contype='f' and (conrelid=tables.oid or confrelid=tables.oid)))
    from pg_class tables where tables.oid='public.${table}'::regclass;`),
    );
  const identity = catalog("simulated_payment_provider_operations");
  const original = JSON.parse(
    harness.runSql(
      "select jsonb_agg(to_jsonb(operation) order by id) from public.simulated_payment_provider_operations operation;",
    ),
  );
  assert.ok(
    original.some(
      (row) =>
        row.original_outcome === "indeterminate" &&
        row.current_outcome === "succeeded",
    ),
  );
  assert.ok(original.some((row) => row.current_outcome === "indeterminate"));
  assert.ok(
    original.some(
      (row) =>
        row.current_outcome === "failed" &&
        row.authoritative_outcome_at === null,
    ),
  );
  supabase(["migration", "up", "--local"]);
  paymentEvidenceInstalled = true;
  assert.deepEqual(
    sourceHashes(),
    graph,
    "Evidence cutover preserves every historical source row, reference and link",
  );
  assert.equal(
    harness.runSql(
      "select jsonb_agg(to_jsonb(history) order by sequence) from public.booking_request_payment_history history;",
    ),
    retainedHistory,
    "Evidence import neither appends nor rewrites existing observed or imported history",
  );
  assert.equal(
    harness.runSql(
      "select jsonb_build_array(last_value,is_called) from public.booking_request_payment_history_sequence_seq;",
    ),
    sequence,
    "Evidence import consumes no history sequence value",
  );
  const afterIdentity = catalog("payment_provider_operations");
  assert.equal(
    afterIdentity.table,
    identity.table,
    "Table object identity survives the rename",
  );
  assert.equal(
    afterIdentity.type,
    identity.type,
    "Composite type identity survives the rename",
  );
  assert.deepEqual(
    afterIdentity.indexes,
    identity.indexes,
    "Existing indexes retain object identity",
  );
  for (const key of identity.foreignKeys)
    assert.ok(
      afterIdentity.foreignKeys.some(
        (current) => JSON.stringify(current) === JSON.stringify(key),
      ),
      "Existing foreign keys retain their exact objects and endpoints",
    );
  const imported = JSON.parse(
    harness.runSql(
      "select jsonb_agg(to_jsonb(operation) order by id) from public.payment_provider_operations operation;",
    ),
  );
  for (const before of original) {
    const after = imported.find((row) => row.id === before.id);
    assert.equal(after.executed_at, before.created_at);
    assert.equal(
      after.original_outcome_at,
      before.original_outcome === "indeterminate" ? null : before.created_at,
    );
    assert.equal(
      after.authoritative_outcome_at,
      before.authoritative_outcome_at,
      "Unknown provider occurrence stays unknown",
    );
    assert.equal(after.recorded_at, before.updated_at);
    assert.equal(after.evidence_provenance, "legacy-simulated");
  }
  assert.equal(
    observe(receipt).status,
    "duplicate",
    "Exact old receipt replay remains idempotent after import",
  );
  const newReceipt = {
    ...receipt,
    receiptId: "legacy-post-upgrade-continuation",
  };
  assert.equal(
    observe(newReceipt).status,
    "recorded",
    "A new valid receipt can extend accepted imported evidence without relabeling its origin",
  );
  assert.equal(
    harness.runSql(
      `select evidence_provenance from public.payment_provider_operations where id='${receipt.providerOperationId}';`,
    ),
    "legacy-simulated",
  );
  const pending = recovery[0];
  const inquiry = runPaymentWorker("payment-query", pending.requestId, {
    PAYMENT_OPERATION_QUERY: JSON.stringify({
      kind: "release",
      paymentLifecycleId: pending.permit.binding.paymentLifecycleId,
      logicalOperationId: pending.permit.operationId,
      attemptId: pending.permit.idempotencyKey,
      amountFils: pending.permit.binding.amountFils,
      currency: "IQD",
      recoveryPermit: pending.permit,
      providerRequestId: null,
      providerReference: null,
    }),
  });
  assert.equal(inquiry.status, "recorded");
  const continued = inquiry.result;
  assert.equal(
    continued.outcome,
    "succeeded",
    "An imported resolved attempt replays through current null-reference inquiry and explicit recording",
  );
  assert.equal(
    harness.runSql(
      "select sum(physical_execution_count) from public.simulated_payment_effects;",
    ),
    String(original.length),
    "Historical continuation never reexecutes a prior physical operation",
  );
  assert.equal(
    harness.runSql(
      `select public.booking_request_payment_quarantined('${recovery[1].requestId}');`,
    ),
    "t",
    "Import and unrelated continuation never clear existing quarantine",
  );
  const prefix = harness.runSql(
    `select jsonb_agg(to_jsonb(history) order by sequence) from public.booking_request_payment_history history where sequence<=${JSON.parse(sequence)[0]};`,
  );
  assert.equal(
    prefix,
    retainedHistory,
    "Post-upgrade continuation preserves every original history row and clock",
  );
  console.log(
    "Provider evidence cutover preserves table/composite/index/foreign-key identity, exact source rows and both observed/imported history; original execution and known/unknown occurrence clocks remain distinct; old receipt replay, new legacy correction and null-reference recovery continue without another physical effect.",
  );
}

let failure;
harness.guardDisposableLocalDatabase();
function verifyOrchestrationCutover() {
  supabase(["db", "reset", "--local", "--version", "20260908235322"]);
  paymentEvidenceInstalled = true;
  const source = readFileSync(
    "supabase/tests/database/booking_request_payment_recovery.test.sql",
    "utf8",
  )
    .split("select plan(")[0]
    .replace(/^begin;/, "");
  harness.runSql(`begin;${source}commit;`);
  const requestId = "60000000-0000-4000-8000-000000001001";
  const attempt = JSON.parse(
    harness.runSql(
      `set request.jwt.claim.sub='10000000-0000-4000-8000-000000001002';set role authenticated;select public.claim_customer_booking_request_payment_recovery('${requestId}','81000000-0000-4000-8000-000000001001','simulated-replacement');`,
    ),
  );
  const permit = JSON.parse(
    harness.runSql(
      `set role service_role;select public.lease_booking_request_payment_recovery_step('${attempt.attemptId}')->'permit';`,
    ),
  );
  const unobserved = readFileSync(
    "supabase/tests/database/booking_request_payment_correction.test.sql",
    "utf8",
  )
    .split("-- BEGIN UNOBSERVED RECOVERY FIXTURE")[1]
    .split("-- END UNOBSERVED RECOVERY FIXTURE")[0];
  const receipt = JSON.parse(
    harness.runSql(
      unobserved +
        `select pg_temp.seed_unobserved_payment_outcome('${JSON.stringify(permit)}'::jsonb,'succeeded',clock_timestamp(),'succeeded');`,
    ),
  );
  const retainedTables = [
    "payment_provider_operations",
    "payment_provider_observations",
    "simulated_payment_effects",
    "booking_request_payment_recovery_attempts",
    "booking_request_payment_recovery_operations",
    "booking_request_capture_work",
    "booking_request_payment_history",
    "booking_confirmations",
    "booking_receipts",
    "cottage_booking_period_occupancies",
  ];
  const rows = () =>
    Object.fromEntries(
      retainedTables.map((table) => [
        table,
        harness.runSql(
          `select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]') from public.${table} v;`,
        ),
      ]),
    );
  const before = rows();
  assert.equal(
    harness.runSql(
      `select current_outcome is null from public.payment_provider_operations where id='${receipt.providerOperationId}';`,
    ),
    "t",
  );
  assert.equal(
    harness.runSql(
      `select physical_execution_count from public.simulated_payment_effects where operation_id='${receipt.providerOperationId}';`,
    ),
    "1",
  );
  supabase(["migration", "up", "--local"]);
  assert.deepEqual(
    rows(),
    before,
    "The #201-to-#202 command cutover must preserve every seeded row, clock, identity, provenance and history event",
  );
  assert.equal(
    runPaymentWorker("payment-recovery", requestId, {
      PAYMENT_RECOVERY_ATTEMPT_ID: attempt.attemptId,
    }).status,
    "succeeded",
  );
  assert.equal(
    harness.runSql(
      `select physical_execution_count from public.simulated_payment_effects where operation_id='${receipt.providerOperationId}';`,
    ),
    "1",
  );
  assert.equal(
    harness.runSql(
      `select (select count(*) from public.payment_provider_operations where recovery_attempt_id='${attempt.attemptId}')||':'||(select count(*) from public.booking_confirmations)||':'||(select count(*) from public.booking_receipts);`,
    ),
    "3:1:2",
  );
  assert.equal(
    rows().booking_request_capture_work,
    before.booking_request_capture_work,
    "Continuation retains the original Payment Required work and fixed deadline",
  );
  const completed = rows();
  assert.equal(
    runPaymentWorker("payment-recovery", requestId, {
      PAYMENT_RECOVERY_ATTEMPT_ID: attempt.attemptId,
    }).status,
    "succeeded",
  );
  assert.deepEqual(
    rows(),
    completed,
    "Current application replay after upgrade cannot repeat effects, confirmation or history",
  );
  console.log(
    "The exact #201-to-#202 upgrade preserves an admitted unreceived provider effect byte for byte, then production recovery queries that identity and completes once with three recovery operations, one confirmation and two receipts.",
  );
}

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
function runPaymentWorker(mode, bookingRequestId, extra = {}) {
  harness.guardDisposableLocalDatabase();
  const workdir = process.env.SUPABASE_LOCAL_WORKDIR;
  const status = spawnSync(
    "npx",
    [
      "supabase",
      "status",
      "--output",
      "json",
      ...(workdir ? ["--workdir", workdir] : []),
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    },
  );
  let connection;
  try {
    connection = JSON.parse(status.stdout);
    const origin = new URL(connection.API_URL);
    if (
      status.status !== 0 ||
      origin.protocol !== "http:" ||
      origin.hostname !== "127.0.0.1" ||
      connection.API_URL !== origin.origin ||
      typeof connection.SECRET_KEY !== "string" ||
      !connection.SECRET_KEY
    )
      throw new Error();
  } catch {
    throw new Error(
      "Unable to resolve the disposable Supabase connection for payment upgrade",
    );
  }
  const result = spawnSync(process.execPath, [workerBundle], {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      CAPTURE_WORKER_MODE: mode,
      CAPTURE_BOOKING_REQUEST_ID: bookingRequestId,
      PAYMENT_WORKER_OUTPUT: "json",
      ...extra,
      SUPABASE_URL: connection.API_URL,
      SUPABASE_SECRET_KEY: connection.SECRET_KEY,
    },
  });
  const messages = result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (result.status !== 0)
    throw new Error(
      `Payment upgrade worker failed: ${result.stderr}; ${JSON.stringify(messages)}`,
    );
  const complete = messages.find((message) => message.stage === "complete");
  if (!complete) throw new Error("Payment upgrade worker returned no result");
  return complete.result;
}

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
  paymentEvidenceInstalled = true;
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
  verifyProviderEvidenceCutover();
  verifyOrchestrationCutover();
} catch (error) {
  failure = error;
} finally {
  rmSync(workerDirectory, { recursive: true, force: true });
  try {
    supabase(["db", "reset", "--local"]);
  } catch (restoreError) {
    if (!failure) failure = restoreError;
  }
}
if (failure) throw failure;
