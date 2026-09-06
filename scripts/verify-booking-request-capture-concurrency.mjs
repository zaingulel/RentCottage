import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
const sessions = new Set();
const requestId = "60000000-0000-4000-8000-000000001001";
const providerIdentity = {
  provider: "fictional-payments",
  environment: "local-test",
  merchantId: "fictional-merchant",
  terminalId: "fictional-terminal",
};
const literal = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const leaseSql = `select public.lease_booking_request_capture_work('${requestId}', ${literal(providerIdentity)});`;
const rows = [
  ["request", `public.booking_requests where id = '${requestId}'`],
  [
    "work",
    `public.booking_request_capture_work where booking_request_id = '${requestId}'`,
  ],
  [
    "attempt",
    "public.booking_request_submission_attempts where id = '70000000-0000-4000-8000-000000001001'",
  ],
  [
    "claim",
    "public.booking_request_authorization_claims where id = '72000000-0000-4000-8000-000000001001'",
  ],
  [
    "ledger",
    "public.simulated_payment_provider_operations where operation_kind = 'capture' and payment_lifecycle_id = '73000000-0000-4000-8000-000000001001'",
  ],
];

function start(sql, close = false) {
  const session = harness.startSession(sql, close);
  sessions.add(session);
  return session;
}
async function finish(session, options) {
  await harness.finishSession(session, options);
  sessions.delete(session);
}
function result(session) {
  const line = session.stdout
    .split("\n")
    .find((value) => value.startsWith("{"));
  assert.ok(line, "PostgreSQL session returned no capture result");
  return JSON.parse(line);
}
async function blockedBy(contenderName, contender, holderName) {
  await harness.waitForLock(contenderName, contender);
  assert.equal(
    harness.runSql(
      `select count(*) from pg_stat_activity contender cross join pg_stat_activity holder where contender.application_name = '${contenderName}' and holder.application_name = '${holderName}' and holder.pid = any(pg_blocking_pids(contender.pid));`,
    ),
    "1",
    "The expected earlier row must be the actual blocker",
  );
}
async function duplicate(sql, label) {
  const holderName = `capture_${label}_holder`;
  const contenderName = `capture_${label}_contender`;
  const holder = start(
    `begin; set application_name = '${holderName}'; set local role service_role; ${sql} select 'CAPTURE_HELD';`,
  );
  await harness.waitForMarker(holder, "CAPTURE_HELD");
  const contender = start(
    `begin; set application_name = '${contenderName}'; set local role service_role; ${sql} commit;`,
    true,
  );
  await blockedBy(contenderName, contender, holderName);
  await finish(holder, { action: "commit" });
  await finish(contender);
  return [result(holder), result(contender)];
}

async function proveLockOrder(sql, label, lockRows = rows) {
  for (let index = 0; index < lockRows.length - 1; index++) {
    const [rowName, row] = lockRows[index];
    const holderName = `capture_${label}_${rowName}_holder`;
    const contenderName = `capture_${label}_${rowName}_contender`;
    const holder = start(
      `begin; set application_name = '${holderName}'; select 1 from ${row} for update; select 'EARLIER_HELD';`,
    );
    await harness.waitForMarker(holder, "EARLIER_HELD");
    const contender = start(
      `begin; set application_name = '${contenderName}'; set local role service_role; ${sql} rollback;`,
      true,
    );
    await blockedBy(contenderName, contender, holderName);
    for (const [laterName, laterRow] of lockRows.slice(index + 1)) {
      assert.equal(
        harness.runSql(
          `begin; select 1 from ${laterRow} for update nowait; rollback;`,
        ),
        "1",
        `${label} must not lock later ${laterName} while blocked on ${rowName}`,
      );
    }
    if (index === 0) {
      const reversed = start(
        `begin; select 1 from ${lockRows[1][1]} for update; select 1 from ${row} for update nowait;`,
        true,
      );
      await finish(reversed, { expectedState: "55P03" });
    }
    await finish(holder, { action: "rollback" });
    await finish(contender);
  }
}

async function proveAdmissionAfterLocks(permit) {
  const holder =
    start(`begin; set application_name = 'capture_expiry_holder'; select 1 from ${rows[0][1]} for update;
    update public.booking_request_capture_work set lease_expires_at = date_trunc('milliseconds', clock_timestamp()) + interval '10 seconds' where booking_request_id = '${requestId}';
    update public.simulated_payment_provider_operations set capture_execution_permit = capture_execution_permit || jsonb_build_object('notAfter', (select to_char(lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from public.booking_request_capture_work where booking_request_id = '${requestId}')) where operation_kind = 'capture' and payment_lifecycle_id = '${permit.paymentLifecycleId}';
    select capture_execution_permit from public.simulated_payment_provider_operations where operation_kind = 'capture' and payment_lifecycle_id = '${permit.paymentLifecycleId}'; select 'EXPIRY_HELD';`);
  await harness.waitForMarker(holder, "EXPIRY_HELD");
  const expiringPermit = result(holder);
  const contender = start(
    `begin; set application_name = 'capture_expiry_contender'; set local role service_role; select public.execute_simulated_booking_request_capture(${literal(expiringPermit)}); rollback;`,
    true,
  );
  await blockedBy(
    "capture_expiry_contender",
    contender,
    "capture_expiry_holder",
  );
  assert.equal(
    harness.runSql(
      `select clock_timestamp() < '${expiringPermit.notAfter}'::timestamptz;`,
    ),
    "t",
    "Provider must begin waiting before its admission deadline",
  );
  const observationDeadline = Date.now() + 15_000;
  while (
    harness.runSql(
      `select clock_timestamp() >= '${expiringPermit.notAfter}'::timestamptz;`,
    ) !== "t"
  ) {
    assert.ok(
      Date.now() < observationDeadline,
      "Database admission deadline was not observable within the bounded wait",
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await finish(holder, { action: "commit" });
  await finish(contender);
  assert.deepEqual(
    result(contender),
    { outcome: "not-executed" },
    "Admission checks the deadline after blocked locks are acquired",
  );
  harness.runSql(`begin;
    update public.booking_request_capture_work set lease_expires_at = '${permit.notAfter}' where booking_request_id = '${requestId}';
    update public.simulated_payment_provider_operations set capture_execution_permit = ${literal(permit)} where operation_kind = 'capture' and payment_lifecycle_id = '${permit.paymentLifecycleId}'; commit;`);
}

const workers = new Set();
const providerTrace = [];
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "rentcottage-capture-workers-"),
);
const workerBundle = join(temporaryDirectory, "worker.mjs");
function startWorker(mode) {
  for (const key of ["SUPABASE_URL", "SUPABASE_SECRET_KEY"])
    assert.ok(process.env[key], `${key} is required for Capture recovery`);
  const child = spawn(process.execPath, [workerBundle], {
    env: {
      ...process.env,
      CAPTURE_WORKER_MODE: mode,
      CAPTURE_BOOKING_REQUEST_ID: requestId,
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const worker = { child, messages: [], stderr: "", exit: undefined };
  workers.add(worker);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    worker.stderr += chunk;
  });
  child.on("message", (message) => {
    worker.messages.push(message);
    if (["execute", "query"].includes(message.stage))
      providerTrace.push(message);
  });
  worker.exited = new Promise((resolve) =>
    child.on("close", (code) => {
      worker.exit = { code };
      resolve();
    }),
  );
  return worker;
}
async function stage(worker, name) {
  const deadline = Date.now() + 15_000;
  while (true) {
    const failure = worker.messages.find(
      (message) => message.stage === "error",
    );
    assert.ok(!failure, `Capture worker failed: ${failure?.message}`);
    const message = worker.messages.find((message) => message.stage === name);
    if (message) return message;
    assert.ok(
      !worker.exit,
      `Capture worker exited before ${name}: ${worker.stderr}`,
    );
    assert.ok(Date.now() < deadline, `Capture worker did not reach ${name}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function finishWorker(worker) {
  const result = await stage(worker, "complete");
  await worker.exited;
  assert.equal(worker.exit.code, 0, worker.stderr);
  workers.delete(worker);
  return result.result;
}
function observeRecovery() {
  return JSON.parse(
    harness.runSql(`select jsonb_build_object(
    'work', (select to_jsonb(w) from public.booking_request_capture_work w where booking_request_id = '${requestId}'),
    'ledger', (select jsonb_agg(to_jsonb(l) order by id) from public.simulated_payment_provider_operations l where operation_kind = 'capture'),
    'snapshot', (select payment_snapshot from public.booking_request_submission_attempts where booking_request_id = '${requestId}'),
    'request', (select to_jsonb(r) from public.booking_requests r where id = '${requestId}'),
    'commitment', (select to_jsonb(c) from public.cottage_booking_period_commitments c where id = '50000000-0000-4000-8000-000000001001'),
    'occupancies', (select jsonb_agg(to_jsonb(o) order by service_day,shift_id) from public.cottage_booking_period_occupancies o where booking_period_commitment_id = '50000000-0000-4000-8000-000000001001'),
    'inventory', (select jsonb_agg(to_jsonb(i) order by id) from public.cottage_inventory_commitments i where booking_period_commitment_id = '50000000-0000-4000-8000-000000001001'),
    'identities', (select coalesce(jsonb_agg(to_jsonb(i) order by operation_kind),'[]') from public.booking_request_provider_operation_identities i where operation_kind = 'capture'),
    'confirmations', (select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from public.booking_confirmations c),
    'receipts', (select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.booking_receipts r),
    'releases', (select count(*) from public.booking_request_release_work) + (select count(*) from public.simulated_payment_provider_operations where operation_kind = 'release')
  );`),
  );
}
function expireCaptureLease() {
  harness.runSql(
    `update public.booking_request_capture_work set lease_expires_at = '2026-02-01T00:00:00Z' where booking_request_id = '${requestId}';`,
  );
}
function assertBooking(before, after) {
  assert.equal(after.work.state, "complete");
  assert.deepEqual(
    after.ledger,
    before.ledger,
    "Recovery must retain all original provider evidence and one physical execution",
  );
  assert.equal(after.ledger.length, 1);
  assert.equal(
    after.ledger.reduce(
      (sum, operation) => sum + operation.physical_execution_count,
      0,
    ),
    1,
  );
  assert.equal(after.identities.length, 1);
  assert.equal(
    after.identities[0].movement_reference,
    before.ledger[0].movement_reference,
  );
  assert.equal(
    after.snapshot.capture.attemptId,
    before.ledger[0].physical_attempt_id,
  );
  assert.equal(
    after.snapshot.capture.movementReference,
    before.ledger[0].movement_reference,
  );
  assert.equal(
    after.snapshot.movements.filter((movement) => movement.kind === "capture")
      .length,
    1,
  );
  assert.equal(after.confirmations.length, 1);
  assert.equal(after.receipts.length, 2);
  assert.equal(after.commitment.status, "confirmed_booking");
  assert.equal(after.commitment.id, before.commitment.id);
  assert.deepEqual(
    after.request,
    before.request,
    "The accepted Request and its original bindings remain unchanged",
  );
  assert.deepEqual(after.inventory, before.inventory);
  assert.deepEqual(
    after.occupancies,
    before.occupancies,
    "Every original Shift occupancy must remain active",
  );
  assert.equal(after.releases, 0);
}
async function proveApplicationRecovery(source) {
  await build({
    entryPoints: ["scripts/booking-request-capture-recovery-worker.ts"],
    outfile: workerBundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  });
  for (const mode of ["lose-response", "capture-only"]) {
    const traceStart = providerTrace.length;
    harness.runSql(`begin; ${source} commit;`);
    seeded = true;
    const initial = startWorker(mode);
    const initialResult = await finishWorker(initial);
    const before = observeRecovery();
    assert.equal(
      initial.messages.filter((message) => message.stage === "execute").length,
      1,
    );
    assert.equal(before.ledger.length, 1);
    assert.equal(before.ledger[0].physical_execution_count, 1);
    assert.equal(before.commitment.status, "pending_hold");
    assert.equal(before.confirmations.length, 0);
    assert.equal(before.receipts.length, 0);
    assert.deepEqual(
      before.occupancies.map((occupancy) => [
        occupancy.service_day,
        occupancy.shift_id.slice(-4),
        occupancy.active,
      ]),
      [
        ["2101-01-01", "1001", true],
        ["2101-01-01", "1003", true],
        ["2101-01-02", "1001", true],
        ["2101-01-02", "1002", true],
        ["2101-01-02", "1003", true],
      ],
    );
    if (mode === "lose-response") {
      assert.equal(initialResult, "interrupted");
      assert.equal(before.snapshot.capture, null);
      assert.equal(before.work.state, "processing");
      const activeDrain = startWorker("recover");
      assert.deepEqual(
        await finishWorker(activeDrain),
        [],
        "Original active lease must not be reclaimed",
      );
      expireCaptureLease();
      const claimSql = `select public.claim_due_booking_request_captures(20, ${literal(providerIdentity)});`;
      const holder = start(
        `begin; set local role service_role; ${claimSql} select 'RECOVERY_HELD';`,
      );
      await harness.waitForMarker(holder, "RECOVERY_HELD");
      assert.match(holder.stdout, /"status": "reconcile"/);
      assert.equal(
        harness.runSql(
          `begin; set local role service_role; ${claimSql} commit;`,
        ),
        "[]",
        "A competing session skips the locked recovery candidate",
      );
      await finish(holder, { action: "rollback" });
      const renewed = start(
        `begin; set application_name = 'capture_recovery_renewal'; select 1 from ${rows[1][1]} for update; update public.booking_request_capture_work set lease_expires_at = '2100-01-01T00:00:00Z' where booking_request_id = '${requestId}'; select 'RENEWAL_HELD';`,
      );
      await harness.waitForMarker(renewed, "RENEWAL_HELD");
      const waiting = start(
        `begin; set application_name = 'capture_recovery_waiting'; set local role service_role; ${claimSql} commit;`,
        true,
      );
      await blockedBy(
        "capture_recovery_waiting",
        waiting,
        "capture_recovery_renewal",
      );
      await finish(renewed, { action: "commit" });
      await finish(waiting);
      assert.equal(
        waiting.stdout.trim(),
        "[]",
        "Recovery rechecks expiry after acquiring blocked source locks",
      );
      expireCaptureLease();
      await proveLockOrder(claimSql, "recovery_claim", rows.slice(1, 5));
      const querySql = `select public.query_simulated_booking_request_capture(${literal({ providerIdentity, requestFingerprint: before.ledger[0].request_fingerprint, paymentLifecycleId: before.ledger[0].payment_lifecycle_id, logicalOperationId: before.ledger[0].logical_operation_id, physicalAttemptId: before.ledger[0].physical_attempt_id, operationKind: "capture", amountFils: before.ledger[0].amount_fils, currency: "IQD" })}, '${before.ledger[0].provider_request_id}', '${before.ledger[0].provider_reference}');`;
      await proveLockOrder(querySql, "recovery_query", rows.slice(0, 5));
      const recovering = startWorker("pause-query");
      const query = await stage(recovering, "query");
      const reclaimed = observeRecovery();
      assert.equal(
        reclaimed.work.lease_generation,
        before.work.lease_generation + 1,
        "Recovery must advance lease generation",
      );
      assert.notEqual(
        reclaimed.work.lease_token,
        before.work.lease_token,
        "Recovery must replace the lease token",
      );
      assert.equal(reclaimed.work.recovery_operation_id, before.ledger[0].id);
      assert.deepEqual(
        reclaimed.ledger,
        before.ledger,
        "Reclaim cannot rewrite the original execution permit or identity",
      );
      const leaseFields = [
        "lease_generation",
        "lease_token",
        "lease_expires_at",
        "recovery_operation_id",
      ];
      const bindings = (work) =>
        Object.fromEntries(
          Object.entries(work).filter(([key]) => !leaseFields.includes(key)),
        );
      assert.deepEqual(bindings(reclaimed.work), bindings(before.work));
      assert.deepEqual(query.request, {
        kind: "capture",
        paymentLifecycleId: before.ledger[0].payment_lifecycle_id,
        logicalOperationId: before.ledger[0].logical_operation_id,
        attemptId: before.ledger[0].physical_attempt_id,
        amountFils: before.ledger[0].amount_fils,
        currency: "IQD",
        providerRequestId: before.ledger[0].provider_request_id,
        providerReference: before.ledger[0].provider_reference,
      });
      const competing = startWorker("recover");
      assert.deepEqual(
        await finishWorker(competing),
        [],
        "Another client cannot reclaim active recovery ownership",
      );
      const stale = start(
        `begin; set local role service_role; select public.complete_booking_request_capture('${requestId}', ${before.work.lease_generation}, '${before.work.lease_token}', ${literal({ outcome: "succeeded", providerRequestId: before.ledger[0].provider_request_id, providerReference: before.ledger[0].provider_reference, movementReference: before.ledger[0].movement_reference })}); rollback;`,
        true,
      );
      await finish(stale, { expectedState: "RC409" });
      assert.equal(
        observeRecovery().snapshot.capture,
        null,
        "A stale independent session cannot persist Capture completion",
      );
      recovering.child.send("continue");
      assert.equal((await finishWorker(recovering))[0].status, "confirmed");
      assert.equal(
        recovering.messages.filter((message) => message.stage === "execute")
          .length,
        0,
      );
      assert.equal(
        recovering.messages.filter((message) => message.stage === "query")
          .length,
        1,
      );
    } else {
      assert.equal(initialResult.status, "complete");
      const recovering = startWorker("recover");
      assert.equal((await finishWorker(recovering))[0].status, "confirmed");
      assert.equal(
        recovering.messages.filter((message) =>
          ["query", "execute"].includes(message.stage),
        ).length,
        0,
        "Interrupted confirmation needs no provider call",
      );
    }
    const after = observeRecovery();
    assertBooking(before, after);
    for (let count = 0; count < 2; count++) {
      const repeated = startWorker("recover");
      assert.deepEqual(await finishWorker(repeated), []);
      assert.equal(
        repeated.messages.filter((message) =>
          ["query", "execute"].includes(message.stage),
        ).length,
        0,
      );
      assert.deepEqual(
        observeRecovery(),
        after,
        "Repeated drains preserve all operation, movement, booking, receipt and occupancy identities",
      );
    }
    const journeyTrace = providerTrace.slice(traceStart);
    assert.equal(
      journeyTrace.filter((call) => call.stage === "execute").length,
      1,
      "Every application client shares only the initial execution in its provider trace",
    );
    assert.equal(
      journeyTrace.filter((call) => call.stage === "query").length,
      mode === "lose-response" ? 1 : 0,
    );
    harness.runSql(cleanup);
    seeded = false;
  }
  console.log(
    "Actual Capture application recovery confirmed a lost provider response and interrupted confirmation using fresh clients: one original physical execution, fenced lease renewal, exact query identity, one Capture movement, one confirmation, two receipts, all five original occupancies, and unchanged repeated drains without release.",
  );
}

let seeded = false;
const cleanup = `begin;
  alter table public.booking_receipts disable trigger reject_booking_receipt_change;
  delete from public.booking_receipts where booking_confirmation_id in (
    select id from public.booking_confirmations where booking_request_id = '${requestId}'
  );
  alter table public.booking_receipts enable trigger reject_booking_receipt_change;
  alter table public.booking_confirmations disable trigger reject_booking_confirmation_change;
  delete from public.booking_confirmations where booking_request_id = '${requestId}';
  alter table public.booking_confirmations enable trigger reject_booking_confirmation_change;
  delete from public.booking_request_capture_work where booking_request_id = '${requestId}';
  delete from public.simulated_payment_provider_operations where claim_id = '72000000-0000-4000-8000-000000001001';
  delete from public.booking_request_provider_operation_identities where attempt_id = '70000000-0000-4000-8000-000000001001';
  delete from public.booking_request_authorization_claim_items where claim_id = '72000000-0000-4000-8000-000000001001';
  delete from public.booking_request_authorization_claim_occupancies where claim_id = '72000000-0000-4000-8000-000000001001';
  delete from public.booking_request_authorization_claims where id = '72000000-0000-4000-8000-000000001001';
  delete from public.booking_request_submission_attempts where id = '70000000-0000-4000-8000-000000001001';
  delete from public.booking_requests where id = '${requestId}';
  alter table public.booking_snapshots disable trigger reject_booking_snapshot_update;
  delete from public.booking_snapshots where id = '40000000-0000-4000-8000-000000001001';
  alter table public.booking_snapshots enable trigger reject_booking_snapshot_update;
  delete from public.cottage_booking_period_occupancies where booking_period_commitment_id = '50000000-0000-4000-8000-000000001001';
  delete from public.cottage_booking_period_commitments where id = '50000000-0000-4000-8000-000000001001';
  alter table public.cottage_shifts disable trigger reject_cottage_shift_delete;
  delete from public.cottage_shifts where schedule_revision_id = '30000000-0000-4000-8000-000000001001';
  alter table public.cottage_shifts enable trigger reject_cottage_shift_delete;
  alter table public.cottage_shift_schedule_revisions disable trigger reject_cottage_shift_schedule_revision_delete;
  delete from public.cottage_shift_schedule_revisions where id = '30000000-0000-4000-8000-000000001001';
  alter table public.cottage_shift_schedule_revisions enable trigger reject_cottage_shift_schedule_revision_delete;
  delete from public.owner_application_cottage_profiles where id = '20000000-0000-4000-8000-000000001001';
  delete from public.account_contexts where user_id in ('10000000-0000-4000-8000-000000001001', '10000000-0000-4000-8000-000000001002', '10000000-0000-4000-8000-000000001003');
  delete from auth.users where id in ('10000000-0000-4000-8000-000000001001', '10000000-0000-4000-8000-000000001002', '10000000-0000-4000-8000-000000001003');
commit;`;

harness.guardDisposableLocalDatabase();
try {
  const testSource = readFileSync(
    new URL(
      "../supabase/tests/database/booking_request_capture_execution.test.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const fixture = testSource
    .split("-- BEGIN CAPTURE EXECUTION FIXTURE\n")[1]
    ?.split("-- END CAPTURE EXECUTION FIXTURE")[0];
  assert.ok(fixture, "The shared capture fixture must be available");
  harness.runSql(`begin; ${fixture} commit;`);
  seeded = true;

  const [leased, processing] = await duplicate(leaseSql, "lease");
  assert.equal(leased.status, "leased");
  assert.deepEqual(processing, { status: "processing" });
  assert.equal(
    harness.runSql(
      "select count(*) from public.simulated_payment_provider_operations where operation_kind = 'capture';",
    ),
    "0",
    "Committed leasing must precede provider execution",
  );
  // Contention proofs use a fixed fixture deadline after observing the real lease.
  const permit = { ...leased.permit, notAfter: "2100-01-01T00:00:00.000Z" };
  harness.runSql(
    `update public.booking_request_capture_work set lease_expires_at = '${permit.notAfter}' where booking_request_id = '${requestId}';`,
  );
  const providerSql = `select public.execute_simulated_booking_request_capture(${literal(permit)});`;
  const [executed, repeated] = await duplicate(providerSql, "provider");
  assert.deepEqual(
    repeated,
    executed,
    "Concurrent provider calls must return identical evidence",
  );
  assert.equal(executed.outcome, "succeeded");
  const completeSql = `select public.complete_booking_request_capture('${requestId}', ${permit.leaseGeneration}, '${permit.leaseToken}', ${literal(executed)});`;

  await proveLockOrder(leaseSql, "lease");
  await proveLockOrder(providerSql, "provider");
  await proveLockOrder(completeSql, "complete");
  await proveAdmissionAfterLocks(permit);
  const [completed, replayed] = await duplicate(completeSql, "complete");
  assert.deepEqual(
    completed,
    replayed,
    "Concurrent completion must return byte-equivalent evidence",
  );
  assert.equal(completed.status, "complete");
  rows.push([
    "identity",
    `public.booking_request_provider_operation_identities where attempt_id = '${permit.submissionAttemptId}' and operation_kind = 'capture'`,
  ]);
  await proveLockOrder(completeSql, "completed_replay");
  assert.deepEqual(
    JSON.parse(harness.runSql(leaseSql)),
    completed,
    "Completed leasing must replay evidence without another provider call",
  );
  assert.equal(
    harness.runSql(
      `select count(*) || ':' || sum(physical_execution_count) from public.simulated_payment_provider_operations where operation_kind = 'capture' and payment_lifecycle_id = '${permit.paymentLifecycleId}';`,
    ),
    "1:1",
  );
  assert.equal(
    harness.runSql(
      `select count(*) from public.booking_request_provider_operation_identities where attempt_id = '${permit.submissionAttemptId}' and operation_kind = 'capture';`,
    ),
    "1",
  );
  assert.equal(
    harness.runSql(
      `select jsonb_array_length(jsonb_path_query_array(payment_snapshot, '$.movements[*] ? (@.kind == "capture")')) from public.booking_request_submission_attempts where id = '${permit.submissionAttemptId}';`,
    ),
    "1",
  );
  harness.runSql(cleanup);
  seeded = false;

  const confirmationSource = readFileSync(
    new URL(
      "../supabase/tests/database/booking_request_confirmation.test.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const confirmationFixture = confirmationSource
    .split("-- BEGIN CONFIRMATION FIXTURE\n")[1]
    ?.split("-- END CONFIRMATION FIXTURE")[0];
  assert.ok(
    confirmationFixture,
    "The complete confirmation fixture must be available",
  );
  harness.runSql(`begin; ${confirmationFixture} commit;`);
  seeded = true;
  const captureSnapshot = JSON.parse(
    harness.runSql(
      `select public.complete_booking_request_capture(
        '${requestId}',
        (capture_execution_permit ->> 'leaseGeneration')::bigint,
        (capture_execution_permit ->> 'leaseToken')::uuid,
        jsonb_build_object('outcome', 'succeeded',
          'providerRequestId', provider_request_id,
          'providerReference', provider_reference,
          'movementReference', movement_reference)
      ) -> 'snapshot'
      from public.simulated_payment_provider_operations
      where operation_kind = 'capture' and payment_lifecycle_id = '73000000-0000-4000-8000-000000001001';`,
    ),
  );
  const confirmationSql = `select public.finalize_booking_request_confirmation('${requestId}', ${literal(captureSnapshot)});`;
  rows.push([
    "commitment",
    "public.cottage_booking_period_commitments where id = '50000000-0000-4000-8000-000000001001'",
  ]);
  await proveLockOrder(confirmationSql, "confirmation");
  const [confirmed, confirmationReplay] = await duplicate(
    confirmationSql,
    "confirmation",
  );
  assert.deepEqual(
    confirmationReplay,
    confirmed,
    "Concurrent finalization must return one identical persisted outcome",
  );
  assert.equal(
    harness.runSql(
      `select count(*) || ':' || (select count(*) from public.booking_receipts) || ':' || (select count(*) from public.cottage_booking_period_commitments where status = 'confirmed_booking') from public.booking_confirmations;`,
    ),
    "1:2:1",
    "Concurrent finalization must persist one confirmation, two receipts, and one promoted commitment",
  );
  assert.equal(
    harness.runSql(
      `select count(*) from public.cottage_booking_period_occupancies where booking_period_commitment_id = '50000000-0000-4000-8000-000000001001' and active;`,
    ),
    "5",
    "Concurrent finalization must retain every selected Shift occupancy",
  );
  assert.equal(
    harness.runSql(
      `select count(*) from public.booking_request_release_work where booking_request_id = '${requestId}';`,
    ),
    "0",
    "Successful finalization must not create release work",
  );
  console.log(
    "Booking Request Capture contention proved one lease, one physical provider execution, one Capture identity and movement, exact replay, ordered locks for all three entry points through the completed Capture identity, and admission refusal after a blocked deadline. Confirmation contention then proved one identical outcome, two receipts, retained complete occupancy, no release work, and the same ordered Capture lock prefix through the commitment.",
  );
  harness.runSql(cleanup);
  seeded = false;
  const recoverySource = confirmationSource
    .split("-- BEGIN CAPTURE RECOVERY SOURCE\n")[1]
    ?.split("-- END CAPTURE RECOVERY SOURCE")[0];
  assert.ok(
    recoverySource,
    "Capture recovery needs the complete source-only fixture",
  );
  await proveApplicationRecovery(recoverySource);
} finally {
  for (const worker of workers) worker.child.kill("SIGTERM");
  await Promise.all([...workers].map((worker) => worker.exited));
  rmSync(temporaryDirectory, { recursive: true, force: true });
  for (const session of sessions) {
    if (!session.child.stdin.destroyed && !session.child.stdin.writableEnded)
      session.child.stdin.end("rollback;\n");
  }
  await Promise.all([...sessions].map((session) => session.exited));
  if (seeded) harness.runSql(cleanup);
}
