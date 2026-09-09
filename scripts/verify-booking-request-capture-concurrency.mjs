// SQL arrangement mirrors admission, isolated effect, and explicit recording.
const paymentEvidenceSql =
  "-- BEGIN PAYMENT EVIDENCE FIXTURE\n" +
  readFileSync("supabase/fixtures/payment-evidence.sql", "utf8") +
  "\n-- END PAYMENT EVIDENCE FIXTURE\n";
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
    "public.payment_provider_operations where operation_kind = 'capture' and payment_lifecycle_id = '73000000-0000-4000-8000-000000001001'",
  ],
];

function start(sql, close = false) {
  const session = harness.startSession(paymentEvidenceSql + sql, close);
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
      paymentEvidenceSql +
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
          paymentEvidenceSql +
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
    select ${literal(permit)} || jsonb_build_object('notAfter', to_char(lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) from public.booking_request_capture_work where booking_request_id = '${requestId}'; select 'EXPIRY_HELD';`);
  await harness.waitForMarker(holder, "EXPIRY_HELD");
  const expiringPermit = result(holder);
  const contender = start(
    `begin; set application_name = 'capture_expiry_contender'; set local role service_role; select pg_temp.capture_execute(${literal(expiringPermit)}); rollback;`,
    true,
  );
  await blockedBy(
    "capture_expiry_contender",
    contender,
    "capture_expiry_holder",
  );
  assert.equal(
    harness.runSql(
      paymentEvidenceSql +
        `select clock_timestamp() < '${expiringPermit.notAfter}'::timestamptz;`,
    ),
    "t",
    "Provider must begin waiting before its admission deadline",
  );
  const observationDeadline = Date.now() + 15_000;
  while (
    harness.runSql(
      paymentEvidenceSql +
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
  harness.runSql(
    paymentEvidenceSql +
      `begin;
    update public.booking_request_capture_work set lease_expires_at = '${permit.notAfter}' where booking_request_id = '${requestId}'; commit;`,
  );
}

const workers = new Set();
const providerTrace = [];
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "rentcottage-capture-workers-"),
);
const workerBundle = join(temporaryDirectory, "worker.mjs");
function startWorker(mode, bookingRequestId = requestId) {
  for (const key of ["SUPABASE_URL", "SUPABASE_SECRET_KEY"])
    assert.ok(process.env[key], `${key} is required for Capture recovery`);
  const child = spawn(process.execPath, [workerBundle], {
    env: {
      ...process.env,
      CAPTURE_WORKER_MODE: mode,
      CAPTURE_BOOKING_REQUEST_ID: bookingRequestId,
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
    harness.runSql(
      paymentEvidenceSql +
        `select jsonb_build_object(
    'work', (select to_jsonb(w) from public.booking_request_capture_work w where booking_request_id = '${requestId}'),
    'ledger', (select jsonb_agg(pg_temp.payment_fixture_operation_json(l) order by id) from public.payment_provider_operations l where operation_kind = 'capture'),
    'effects', (select jsonb_agg(to_jsonb(e) order by e.operation_id) from public.simulated_payment_effects e join public.payment_provider_operations l on l.id=e.operation_id where l.operation_kind='capture'),
    'snapshot', (select payment_snapshot from public.booking_request_submission_attempts where booking_request_id = '${requestId}'),
    'request', (select to_jsonb(r) from public.booking_requests r where id = '${requestId}'),
    'commitment', (select to_jsonb(c) from public.cottage_booking_period_commitments c where id = '50000000-0000-4000-8000-000000001001'),
    'occupancies', (select jsonb_agg(to_jsonb(o) order by service_day,shift_id) from public.cottage_booking_period_occupancies o where booking_period_commitment_id = '50000000-0000-4000-8000-000000001001'),
    'inventory', (select jsonb_agg(to_jsonb(i) order by id) from public.cottage_inventory_commitments i where booking_period_commitment_id = '50000000-0000-4000-8000-000000001001'),
    'identities', (select coalesce(jsonb_agg(to_jsonb(i) order by operation_kind),'[]') from public.booking_request_provider_operation_identities i where operation_kind = 'capture'),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by id),'[]') from public.booking_request_status_notifications n where booking_request_id = '${requestId}'),
    'intentActive', (select intent_dedupe_active from public.booking_request_submission_attempts where booking_request_id = '${requestId}'),
    'confirmations', (select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from public.booking_confirmations c),
    'receipts', (select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.booking_receipts r),
    'releases', (select count(*) from public.booking_request_release_work) + (select count(*) from public.payment_provider_operations where operation_kind = 'release')
  );`,
    ),
  );
}
function expireCaptureLease() {
  harness.runSql(
    paymentEvidenceSql +
      `update public.booking_request_capture_work set lease_expires_at = '2026-02-01T00:00:00Z' where booking_request_id = '${requestId}';`,
  );
}
function assertBooking(before, after) {
  assert.equal(after.work.state, "complete");
  assert.deepEqual(
    after.effects,
    before.effects,
    "Recovery retains the original isolated provider effect",
  );
  const projectionFields = new Set([
    "original_outcome",
    "current_outcome",
    "provider_request_id",
    "provider_reference",
    "movement_reference",
    "original_outcome_at",
    "executed_at",
    "authoritative_outcome_at",
    "recorded_at",
    "updated_at",
    "evidence_provenance",
  ]);
  const admission = (row) =>
    Object.fromEntries(
      Object.entries(row).filter(([key]) => !projectionFields.has(key)),
    );
  assert.deepEqual(
    after.ledger.map(admission),
    before.ledger.map(admission),
    "Recording preserves every admitted operation identity and bound permit",
  );
  if (before.ledger[0].recorded_at !== null)
    assert.deepEqual(
      after.ledger,
      before.ledger,
      "Already recorded evidence is unchanged",
    );
  assert.equal(
    after.ledger[0].provider_request_id,
    before.effects[0].result.providerRequestId,
  );
  assert.equal(
    after.ledger[0].provider_reference,
    before.effects[0].result.providerReference,
  );
  assert.equal(
    after.ledger[0].movement_reference,
    before.effects[0].result.movementReference,
  );
  assert.equal(
    Date.parse(after.ledger[0].executed_at),
    Date.parse(before.effects[0].result.evidence.executedAt),
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
    before.effects[0].result.movementReference,
  );
  assert.equal(
    after.snapshot.capture.attemptId,
    before.ledger[0].physical_attempt_id,
  );
  assert.equal(
    after.snapshot.capture.movementReference,
    before.effects[0].result.movementReference,
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
    harness.runSql(paymentEvidenceSql + `begin; ${source} commit;`);
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
      assert.equal(before.ledger[0].recorded_at, null);
      assert.equal(before.ledger[0].current_outcome, null);
      assert.equal(before.ledger[0].provider_request_id, null);
      assert.equal(before.ledger[0].provider_reference, null);
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
          paymentEvidenceSql +
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
      const querySql = `select pg_temp.capture_query(${literal({ providerIdentity, requestFingerprint: before.ledger[0].request_fingerprint, paymentLifecycleId: before.ledger[0].payment_lifecycle_id, logicalOperationId: before.ledger[0].logical_operation_id, physicalAttemptId: before.ledger[0].physical_attempt_id, operationKind: "capture", amountFils: before.ledger[0].amount_fils, currency: "IQD" })}, ${before.ledger[0].provider_request_id === null ? "null" : `'${before.ledger[0].provider_request_id}'`}, ${before.ledger[0].provider_reference === null ? "null" : `'${before.ledger[0].provider_reference}'`});`;
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
      const { admission: queriedAdmission, ...queriedBinding } = query.request;
      assert.equal(queriedAdmission.operationId, before.ledger[0].id);
      assert.equal(
        queriedAdmission.idempotencyKey,
        before.ledger[0].provider_idempotency_key,
      );
      assert.equal(queriedAdmission.mode, "reconcile");
      assert.equal(
        Date.parse(queriedAdmission.notAfter),
        Date.parse(before.ledger[0].admission.notAfter),
      );
      assert.deepEqual(queriedBinding, {
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
    harness.runSql(paymentEvidenceSql + cleanup);
    seeded = false;
  }
  console.log(
    "Actual Capture application recovery confirmed a lost provider response and interrupted confirmation using fresh clients: one original physical execution, fenced lease renewal, exact query identity, one Capture movement, one confirmation, two receipts, all five original occupancies, and unchanged repeated drains without release.",
  );
}

async function proveFailureRecording(source) {
  for (const mode of ["duplicate", "expired-after-lock"]) {
    harness.runSql(paymentEvidenceSql + `begin; ${source} commit;`);
    seeded = true;
    const lease = JSON.parse(harness.runSql(paymentEvidenceSql + leaseSql));
    assert.equal(lease.status, "leased");
    if (mode === "expired-after-lock") {
      lease.permit = JSON.parse(
        harness.runSql(
          paymentEvidenceSql +
            `update public.booking_request_capture_work set lease_expires_at=date_trunc('milliseconds',clock_timestamp())+interval '10 seconds' where booking_request_id='${requestId}' returning ${literal(lease.permit)} || jsonb_build_object('notAfter',to_char(lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));`,
        ),
      );
    }
    const failed = JSON.parse(
      harness.runSql(
        paymentEvidenceSql +
          `select pg_temp.capture_execute(${literal(lease.permit)},'failed');`,
      ),
    );
    const before = observeRecovery();
    const finalize = `select public.record_booking_request_capture_failure('${requestId}',${lease.permit.leaseGeneration},'${lease.permit.leaseToken}',${literal(failed)});`;
    if (mode === "duplicate") {
      const [first, repeated] = await duplicate(finalize, "failure_recording");
      assert.equal(first.status, "payment-required");
      assert.deepEqual(
        repeated,
        first,
        "Two finalizers must return one identical fixed window",
      );
      const after = observeRecovery();
      assert.equal(after.notifications.length, 1);
      assert.deepEqual(after.occupancies, before.occupancies);
      assert.deepEqual(after.inventory, before.inventory);
      assert.deepEqual(after.ledger, before.ledger);
    } else {
      const holder = start(
        "begin; set application_name='failure_commitment_holder'; select 1 from public.cottage_booking_period_commitments where id='50000000-0000-4000-8000-000000001001' for update; select 'COMMITMENT_HELD';",
      );
      await harness.waitForMarker(holder, "COMMITMENT_HELD");
      const contender = start(
        `begin; set application_name='failure_deadline_contender'; set local role service_role; ${finalize} commit;`,
        true,
      );
      await blockedBy(
        "failure_deadline_contender",
        contender,
        "failure_commitment_holder",
      );
      assert.equal(
        harness.runSql(
          paymentEvidenceSql +
            `select clock_timestamp()<lease_expires_at from public.booking_request_capture_work where booking_request_id='${requestId}';`,
        ),
        "t",
      );
      holder.child.stdin.write(
        `do $$ begin while clock_timestamp()<(select lease_expires_at from public.booking_request_capture_work where booking_request_id='${requestId}') loop perform pg_sleep(0.01); end loop; end $$; select 'FAILURE_DEADLINE_REACHED';\n`,
      );
      await harness.waitForMarker(holder, "FAILURE_DEADLINE_REACHED");
      await finish(holder, { action: "commit" });
      await finish(contender, { expectedState: "RC409" });
      const after = observeRecovery();
      assert.equal(after.work.state, "processing");
      assert.equal(after.notifications.length, 0);
      assert.deepEqual(after.occupancies, before.occupancies);
    }
    harness.runSql(paymentEvidenceSql + cleanup);
    seeded = false;
  }
  console.log(
    "Direct failed-Capture finalizers returned one identical period under contention and refused an expired fence after a blocked hold lock, retaining every original occupancy.",
  );
}

async function proveIndeterminateCaptureRecovery(source) {
  const other = (sql) =>
    sql
      .replaceAll("00000000100", "00000000110")
      .replaceAll("750000100", "750000110")
      .replaceAll("confirmation-auth-", "unknown-other-auth-")
      .replaceAll("CONFIRMATION-HOLD-1", "UNKNOWN-OTHER-HOLD-1");
  const otherId = other(requestId);
  for (const outcome of ["succeeded", "failed"]) {
    const traceStart = providerTrace.length;
    harness.runSql(paymentEvidenceSql + `begin; ${source} commit;`);
    seeded = true;
    const initial = startWorker("indeterminate-capture");
    assert.equal(await finishWorker(initial), "indeterminate");
    const unknown = observeRecovery();
    assert.equal(unknown.ledger.length, 1);
    assert.equal(unknown.ledger[0].original_outcome, "indeterminate");
    assert.equal(unknown.ledger[0].current_outcome, "indeterminate");
    assert.ok(unknown.ledger[0].movement_reference);
    assert.equal(unknown.ledger[0].physical_execution_count, 1);
    assert.equal(unknown.work.state, "processing");
    assert.equal(unknown.commitment.status, "pending_hold");
    assert.equal(unknown.confirmations.length, 0);
    assert.equal(unknown.receipts.length, 0);
    const initialObservation = harness.runSql(
      `select to_jsonb(observation) from public.payment_provider_observations observation where operation_id='${unknown.ledger[0].id}';`,
    );
    let otherSeeded = false;
    try {
      harness.runSql(
        paymentEvidenceSql +
          `begin; ${other(pendingSource(source))} ${other(acceptSql)} commit;`,
      );
      otherSeeded = true;
      assert.equal(
        (await finishWorker(startWorker("capture-only", otherId))).status,
        "complete",
      );
      expireCaptureLease();
      const waiting = startWorker("recover-indeterminate");
      const pending = await finishWorker(waiting);
      assert.equal(
        pending.filter((result) => result.status === "processing").length,
        1,
        "Unknown Capture remains processing through a fresh inquiry",
      );
      assert.equal(
        pending.filter((result) => result.status === "confirmed").length,
        1,
        "The same batch confirms unrelated eligible work despite valid unknown Capture",
      );
      const query = waiting.messages.find(
        (message) => message.stage === "query",
      );
      assert.equal(query.request.admission.operationId, unknown.ledger[0].id);
      assert.equal(
        query.request.admission.idempotencyKey,
        unknown.ledger[0].provider_idempotency_key,
      );
      assert.equal(query.request.admission.mode, "reconcile");
      assert.equal(
        waiting.messages.find((message) => message.stage === "query-result")
          .result.outcome,
        "indeterminate",
      );
      assert.equal(
        waiting.messages.filter((message) => message.stage === "execute")
          .length,
        0,
      );
    } finally {
      if (otherSeeded) harness.runSql(paymentEvidenceSql + other(cleanup));
    }
    const stillUnknown = observeRecovery();
    assert.deepEqual(stillUnknown.ledger, unknown.ledger);
    assert.deepEqual(stillUnknown.effects, unknown.effects);
    assert.deepEqual(stillUnknown.occupancies, unknown.occupancies);
    assert.equal(stillUnknown.confirmations.length, 0);
    assert.equal(stillUnknown.receipts.length, 0);
    assert.equal(stillUnknown.commitment.status, "pending_hold");
    assert.equal(stillUnknown.snapshot.capture, null);
    expireCaptureLease();
    const terminalWorker = startWorker(
      outcome === "failed" ? "recover-failure" : "recover",
    );
    const terminalResult = await finishWorker(terminalWorker);
    assert.equal(
      terminalResult[0].status,
      outcome === "failed" ? "payment-required" : "confirmed",
    );
    const terminal = observeRecovery();
    assert.equal(terminal.ledger.length, 1);
    assert.equal(terminal.ledger[0].id, unknown.ledger[0].id);
    assert.deepEqual(terminal.ledger[0].admission, unknown.ledger[0].admission);
    assert.equal(terminal.ledger[0].original_outcome, "indeterminate");
    assert.equal(terminal.ledger[0].current_outcome, outcome);
    assert.equal(terminal.ledger[0].executed_at, unknown.ledger[0].executed_at);
    assert.equal(terminal.ledger[0].original_outcome_at, null);
    assert.equal(terminal.ledger[0].physical_execution_count, 1);
    assert.equal(
      harness.runSql(
        `select to_jsonb(observation) from public.payment_provider_observations observation where operation_id='${unknown.ledger[0].id}' and event_id='${unknown.effects[0].result.evidence.eventId}';`,
      ),
      initialObservation,
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.payment_provider_observations where operation_id='${unknown.ledger[0].id}';`,
      ),
      "2",
    );
    assert.deepEqual(terminal.inventory, unknown.inventory);
    assert.deepEqual(terminal.occupancies, unknown.occupancies);
    assert.equal(terminal.releases, 0);
    if (outcome === "succeeded") {
      assert.equal(terminal.work.state, "complete");
      assert.equal(terminal.confirmations.length, 1);
      assert.equal(terminal.receipts.length, 2);
      assert.equal(terminal.commitment.status, "confirmed_booking");
      assert.equal(
        terminal.ledger[0].movement_reference,
        unknown.ledger[0].movement_reference,
      );
      assert.equal(
        Date.parse(terminal.snapshot.movements[1].recordedAt),
        Date.parse(terminal.ledger[0].authoritative_outcome_at),
        "Confirmation records authoritative success occurrence, not initial unknown execution or receipt time",
      );
      assert.ok(
        Date.parse(terminal.ledger[0].authoritative_outcome_at) >
          Date.parse(terminal.ledger[0].executed_at),
      );
    } else {
      assert.equal(terminal.work.state, "payment_required");
      assert.equal(terminal.ledger[0].movement_reference, null);
      assert.equal(terminal.notifications.length, 1);
      assert.equal(terminal.confirmations.length, 0);
      assert.equal(terminal.receipts.length, 0);
      assert.equal(terminal.commitment.status, "pending_hold");
      assert.equal(
        Date.parse(terminal.work.payment_required_deadline) -
          Date.parse(terminal.work.payment_required_recorded_at),
        1200000,
      );
      const prepared = JSON.parse(
        harness.runSql(
          paymentEvidenceSql +
            `begin;
        create function public.unknown_capture_expiry_now() returns timestamptz language sql as $$select payment_required_deadline from public.booking_request_capture_work where booking_request_id='${requestId}'$$;
        do $$begin execute replace(pg_get_functiondef('public.prepare_booking_request_payment_required_expiry(uuid,jsonb)'::regprocedure),'clock_timestamp()','public.unknown_capture_expiry_now()');end$$;
        set local role service_role; select public.prepare_booking_request_payment_required_expiry('${requestId}',${literal(providerIdentity)}); rollback;`,
        ),
      );
      assert.equal(
        prepared.status,
        "release",
        "Resolved unknown Capture failure remains safely eligible for expiry preparation",
      );
    }
    const repeat = await finishWorker(
      startWorker(outcome === "failed" ? "recover-failure" : "recover"),
    );
    assert.ok(repeat.every((result) => result.status === "confirmed"));
    assert.deepEqual(
      observeRecovery(),
      terminal,
      "Terminal replay preserves the accepted snapshot/window and receipts",
    );
    const trace = providerTrace
      .slice(traceStart)
      .filter(
        (call) =>
          call.request.paymentLifecycleId ===
          unknown.ledger[0].payment_lifecycle_id,
      );
    assert.equal(trace.filter((call) => call.stage === "execute").length, 1);
    assert.equal(trace.filter((call) => call.stage === "query").length, 2);
    harness.runSql(paymentEvidenceSql + cleanup);
    seeded = false;
  }
  console.log(
    "Original indeterminate Capture survives fresh unknown inquiry, unrelated eligible work, and same-identity success/failure resolution: one execution, immutable original evidence, exact success occurrence, one confirmation or fixed Payment Required window, safe expiry preparation, and terminal replay.",
  );
}

async function proveApplicationFailureRecovery(source) {
  const traceStart = providerTrace.length;
  harness.runSql(paymentEvidenceSql + `begin; ${source} commit;`);
  seeded = true;
  const interrupted = startWorker("failure-lose-response");
  assert.equal(await finishWorker(interrupted), "interrupted");
  assert.equal(
    interrupted.messages.filter((message) => message.stage === "execute")
      .length,
    1,
  );
  const failedExecution = observeRecovery();
  assert.equal(failedExecution.work.state, "processing");
  assert.equal(failedExecution.ledger.length, 1);
  assert.equal(failedExecution.ledger[0].original_outcome, null);
  assert.equal(failedExecution.ledger[0].current_outcome, null);
  assert.equal(failedExecution.ledger[0].recorded_at, null);
  assert.equal(failedExecution.effects[0].result.outcome, "failed");
  assert.equal(
    failedExecution.effects[0].result.evidence.originalOutcome,
    "failed",
  );
  assert.equal(failedExecution.ledger[0].movement_reference, null);
  assert.equal(failedExecution.ledger[0].physical_execution_count, 1);
  assert.equal(failedExecution.confirmations.length, 0);
  assert.equal(failedExecution.receipts.length, 0);

  assert.deepEqual(
    await finishWorker(startWorker("recover-failure")),
    [],
    "An active failed-Capture lease cannot be reclaimed",
  );
  expireCaptureLease();
  const claimSql = `select public.claim_due_booking_request_captures(20, ${literal(providerIdentity)});`;
  const holder = start(
    `begin; set local role service_role; ${claimSql} select 'FAILURE_RECOVERY_HELD';`,
  );
  await harness.waitForMarker(holder, "FAILURE_RECOVERY_HELD");
  assert.match(holder.stdout, /"status": "reconcile"/);
  assert.equal(
    harness.runSql(paymentEvidenceSql + claimSql),
    "[]",
    "A competing recovery skips the locked failed Capture",
  );
  await finish(holder, { action: "rollback" });
  await proveLockOrder(claimSql, "failure_recovery", rows.slice(1, 5));

  const recovering = [
    startWorker("recover-failure"),
    startWorker("recover-failure"),
  ];
  const recovered = await Promise.all(recovering.map(finishWorker));
  assert.equal(
    recovered.flat().filter((result) => result.status === "payment-required")
      .length,
    1,
    "Competing recovery processes must persist one Payment Required result",
  );
  const terminal = observeRecovery();
  assert.equal(terminal.work.state, "payment_required");
  assert.equal(terminal.work.outcome, "failed");
  assert.equal(
    Date.parse(terminal.work.payment_required_deadline) -
      Date.parse(terminal.work.payment_required_recorded_at),
    20 * 60 * 1000,
  );
  assert.deepEqual(
    terminal.effects,
    failedExecution.effects,
    "Failure recovery must preserve the one original provider execution",
  );
  assert.equal(terminal.ledger[0].id, failedExecution.ledger[0].id);
  assert.deepEqual(
    terminal.ledger[0].admission,
    failedExecution.ledger[0].admission,
  );
  assert.equal(terminal.ledger[0].original_outcome, "failed");
  assert.equal(terminal.ledger[0].current_outcome, "failed");
  assert.equal(
    terminal.ledger[0].provider_request_id,
    failedExecution.effects[0].result.providerRequestId,
  );
  assert.equal(
    terminal.ledger[0].provider_reference,
    failedExecution.effects[0].result.providerReference,
  );
  assert.equal(terminal.ledger[0].movement_reference, null);
  assert.equal(
    Date.parse(terminal.ledger[0].executed_at),
    Date.parse(failedExecution.effects[0].result.evidence.executedAt),
  );
  assert.equal(terminal.identities.length, 0);
  assert.equal(terminal.notifications.length, 1);
  assert.equal(terminal.notifications[0].status, "payment-required");
  assert.equal(terminal.confirmations.length, 0);
  assert.equal(terminal.receipts.length, 0);
  assert.equal(terminal.commitment.status, "pending_hold");
  assert.deepEqual(terminal.inventory, failedExecution.inventory);
  assert.deepEqual(terminal.occupancies, failedExecution.occupancies);
  assert.equal(terminal.occupancies.length, 5);
  assert.ok(terminal.occupancies.every((occupancy) => occupancy.active));
  assert.equal(terminal.intentActive, true);
  assert.equal(terminal.releases, 0);

  assert.deepEqual(await finishWorker(startWorker("recover-failure")), []);
  assert.deepEqual(
    observeRecovery(),
    terminal,
    "Repeated failure recovery must not move the terminal window or recapture",
  );
  const trace = providerTrace.slice(traceStart);
  assert.equal(trace.filter((call) => call.stage === "execute").length, 1);
  assert.equal(trace.filter((call) => call.stage === "query").length, 1);
  harness.runSql(paymentEvidenceSql + cleanup);
  seeded = false;
  console.log(
    "Actual failure recovery used competing fresh processes after a lost response: one failed movement-free provider execution, one immutable 20-minute Payment Required window and notification, no confirmation or receipts, the active intent, pending hold and all five original occupancies retained, and stable repeated drains.",
  );
}

const ownerId = "10000000-0000-4000-8000-000000001001";
const customerId = "10000000-0000-4000-8000-000000001002";
const acceptSql = `select public.claim_booking_request_action('${ownerId}', '${requestId}', 'accept');`;
function pendingSource(source) {
  return (
    source.slice(
      0,
      source.indexOf("insert into public.booking_request_capture_work"),
    ) +
    `update public.booking_requests set status = 'pending', settled_at = null, created_at = statement_timestamp() - interval '1 hour', response_deadline = statement_timestamp() + interval '3 hours' where id = '${requestId}';`
  );
}
async function proveOwnerAdmission(source) {
  const pending = pendingSource(source);
  const reset = () => {
    harness.runSql(paymentEvidenceSql + `begin; ${pending} commit;`);
    seeded = true;
  };
  reset();
  const admissions = await duplicate(acceptSql, "owner_accept");
  assert.deepEqual(admissions[0], admissions[1]);
  assert.equal(
    harness.runSql(
      paymentEvidenceSql +
        `select count(*) from public.booking_request_capture_work where booking_request_id = '${requestId}';`,
    ),
    "1",
  );
  const identity = harness.runSql(
    paymentEvidenceSql +
      `select to_jsonb(work) from public.booking_request_capture_work work where booking_request_id = '${requestId}';`,
  );
  harness.runSql(paymentEvidenceSql + acceptSql);
  assert.equal(
    harness.runSql(
      paymentEvidenceSql +
        `select to_jsonb(work) from public.booking_request_capture_work work where booking_request_id = '${requestId}';`,
    ),
    identity,
  );
  harness.runSql(paymentEvidenceSql + cleanup);
  seeded = false;

  for (const action of ["decline", "withdraw", "expire"]) {
    for (const acceptFirst of [true, false]) {
      reset();
      if (action === "expire" && !acceptFirst)
        harness.runSql(
          paymentEvidenceSql +
            `update public.booking_requests set response_deadline = statement_timestamp(), created_at = statement_timestamp() - interval '4 hours' where id = '${requestId}';`,
        );
      const otherSql =
        action === "expire"
          ? `select public.claim_booking_request_expiry('${requestId}');`
          : `select public.claim_booking_request_action('${action === "withdraw" ? customerId : ownerId}', '${requestId}', '${action}', ${action === "decline" ? "'other'" : "null"});`;
      const holder = start(
        `begin; set application_name = 'owner_decision_holder'; set local role service_role; ${acceptFirst ? acceptSql : otherSql} select 'DECISION_HELD';`,
      );
      await harness.waitForMarker(holder, "DECISION_HELD");
      const contender = start(
        `begin; set application_name = 'owner_decision_contender'; set local role service_role; ${acceptFirst ? otherSql : acceptSql} commit;`,
        true,
      );
      await blockedBy(
        "owner_decision_contender",
        contender,
        "owner_decision_holder",
      );
      await finish(holder, { action: "commit" });
      await finish(contender);
      assert.equal(
        harness.runSql(
          paymentEvidenceSql +
            `select status from public.booking_requests where id = '${requestId}';`,
        ),
        acceptFirst ? "accepted" : "processing",
      );
      assert.equal(
        harness.runSql(
          paymentEvidenceSql +
            `select count(*) from public.booking_request_capture_work where booking_request_id = '${requestId}';`,
        ),
        acceptFirst ? "1" : "0",
      );
      assert.equal(
        harness.runSql(
          paymentEvidenceSql +
            `select count(*) from public.payment_provider_operations where operation_kind = 'capture';`,
        ),
        "0",
      );
      harness.runSql(paymentEvidenceSql + cleanup);
      seeded = false;
    }
  }
  reset();
  await proveLockOrder(acceptSql, "owner_admission", [
    rows[0],
    ["account", `public.account_contexts where user_id = '${ownerId}'`],
    rows[2],
    rows[3],
  ]);
  for (const change of [
    "role = 'customer', owner_approval_state = null",
    "owner_approval_state = 'prospective'",
  ]) {
    const holder = start(
      `begin; set application_name = 'owner_account_holder'; update public.account_contexts set ${change} where user_id = '${ownerId}'; select 'ACCOUNT_HELD';`,
    );
    await harness.waitForMarker(holder, "ACCOUNT_HELD");
    const contender = start(
      `begin; set application_name = 'owner_account_contender'; set local role service_role; ${acceptSql} commit;`,
      true,
    );
    await blockedBy(
      "owner_account_contender",
      contender,
      "owner_account_holder",
    );
    await finish(holder, { action: "commit" });
    await finish(contender);
    assert.equal(result(contender).status, "access-required");
    assert.equal(
      harness.runSql(
        paymentEvidenceSql +
          `select count(*) from public.booking_request_capture_work where booking_request_id = '${requestId}';`,
      ),
      "0",
    );
    harness.runSql(
      paymentEvidenceSql +
        `update public.account_contexts set role = 'cottage_owner', owner_approval_state = 'approved' where user_id = '${ownerId}';`,
    );
  }
  const holder = start(
    `begin; set application_name = 'owner_deadline_holder'; update public.booking_requests set response_deadline = statement_timestamp() + interval '2 seconds', created_at = statement_timestamp() - interval '4 hours' + interval '2 seconds' where id = '${requestId}'; select 'DEADLINE_HELD';`,
  );
  await harness.waitForMarker(holder, "DEADLINE_HELD");
  const contender = start(
    `begin; set application_name = 'owner_deadline_contender'; set local role service_role; ${acceptSql} commit;`,
    true,
  );
  await blockedBy(
    "owner_deadline_contender",
    contender,
    "owner_deadline_holder",
  );
  holder.child.stdin.write(
    `select clock_timestamp() < response_deadline from public.booking_requests where id = '${requestId}'; select 'BEFORE_DEADLINE';\n`,
  );
  await harness.waitForMarker(holder, "BEFORE_DEADLINE");
  assert.ok(holder.stdout.includes("t\nBEFORE_DEADLINE"));
  // Observe the actual database deadline within the holder's uncommitted row.
  holder.child.stdin.write(
    `do $$ begin while clock_timestamp() < (select response_deadline from public.booking_requests where id = '${requestId}') loop perform pg_sleep(0.01); end loop; end $$; select 'DEADLINE_REACHED';\n`,
  );
  await harness.waitForMarker(holder, "DEADLINE_REACHED");
  await finish(holder, { action: "commit" });
  await finish(contender);
  assert.equal(
    harness.runSql(
      paymentEvidenceSql +
        `select status from public.booking_requests where id = '${requestId}';`,
    ),
    "processing",
  );
  assert.equal(
    harness.runSql(
      paymentEvidenceSql +
        `select count(*) from public.booking_request_capture_work where booking_request_id = '${requestId}';`,
    ),
    "0",
  );
  harness.runSql(paymentEvidenceSql + cleanup);
  seeded = false;
  console.log(
    "Owner admission proved duplicate intent identity, both winning orders against decline/withdrawal/expiry, request-first locks, post-contention role/approval checks and deadline expiry.",
  );
}
async function proveRecoveryProgress(source) {
  const pending = pendingSource(source);
  const clone = (sql, index) =>
    sql
      .replaceAll("1003", String(2003 + Number(index) * 10))
      .replaceAll("1002", String(2002 + Number(index) * 10))
      .replaceAll("1001", String(2001 + Number(index) * 10))
      .replaceAll(
        "confirmation-auth-request-1",
        `confirmation-auth-request-${index}`,
      )
      .replaceAll(
        "confirmation-auth-reference-1",
        `confirmation-auth-reference-${index}`,
      )
      .replaceAll(
        "confirmation-auth-movement-1",
        `confirmation-auth-movement-${index}`,
      )
      .replaceAll("CONFIRMATION-HOLD-1", `CONFIRMATION-HOLD-${index}`);
  // Twenty earlier missing-execution candidates must not starve the twenty-first recoverable capture.
  const indexes = Array.from({ length: 21 }, (_, i) =>
    String(i + 2).padStart(2, "0"),
  );
  try {
    for (const index of indexes) {
      harness.runSql(
        paymentEvidenceSql +
          `begin; ${clone(pending, index)} ${clone(acceptSql, index)} commit;`,
      );
      const leased = JSON.parse(
        harness.runSql(paymentEvidenceSql + clone(leaseSql, index)),
      );
      if (index === indexes.at(-1))
        harness.runSql(
          paymentEvidenceSql +
            `select pg_temp.capture_execute(${literal(leased.permit)});`,
        );
      harness.runSql(
        paymentEvidenceSql +
          `update public.booking_request_capture_work set lease_expires_at = clock_timestamp() where booking_request_id = '${clone(requestId, index)}';`,
      );
    }
    const unavailableBefore = harness.runSql(
      paymentEvidenceSql +
        `select jsonb_agg(to_jsonb(work) order by booking_request_id) from public.booking_request_capture_work work where recovery_operation_id is null and booking_request_id <> '${clone(requestId, indexes.at(-1))}';`,
    );
    const recovered = JSON.parse(
      harness.runSql(
        paymentEvidenceSql +
          `select public.claim_due_booking_request_captures(20, ${literal(providerIdentity)});`,
      ),
    );
    assert.equal(recovered.length, 20);
    assert.equal(
      recovered.filter((row) => row.status === "reconcile").length,
      1,
      "Later execution evidence must make bounded progress past unavailable work",
    );
    assert.equal(
      recovered.filter((row) => row.status === "unavailable").length,
      19,
    );
    assert.equal(
      harness.runSql(
        paymentEvidenceSql +
          `select jsonb_agg(to_jsonb(work) order by booking_request_id) from public.booking_request_capture_work work where recovery_operation_id is null and booking_request_id <> '${clone(requestId, indexes.at(-1))}';`,
      ),
      unavailableBefore,
      "Missing execution must never renew ownership",
    );
    console.log(
      "Recovery selected later exact provider evidence beyond a full unavailable batch without renewing missing-evidence ownership.",
    );
  } finally {
    for (const index of indexes)
      harness.runSql(paymentEvidenceSql + clone(cleanup, index));
  }
}

async function proveCaptureProcessing(source) {
  for (const mode of [
    "process",
    "process-lose-response",
    "process-interrupt-confirmation",
  ]) {
    harness.runSql(
      paymentEvidenceSql +
        `begin; ${pendingSource(source)} ${acceptSql} commit;`,
    );
    seeded = true;
    const admitted = observeRecovery();
    if (mode === "process") {
      const clients = [startWorker(mode), startWorker(mode)];
      await Promise.all(clients.map(finishWorker));
    } else {
      assert.deepEqual(await finishWorker(startWorker(mode)), [
        { status: "unavailable" },
      ]);
      const interrupted = observeRecovery();
      assert.equal(interrupted.ledger.length, 1);
      assert.equal(interrupted.confirmations.length, 0);
      assert.equal(interrupted.receipts.length, 0);
      if (mode === "process-lose-response") expireCaptureLease();
      const result = await finishWorker(startWorker("process"));
      assert.equal(result[0].status, "confirmed");
    }
    const confirmed = observeRecovery();
    assert.equal(confirmed.ledger.length, 1);
    assert.equal(confirmed.ledger[0].physical_execution_count, 1);
    assert.equal(confirmed.ledger[0].amount_fils, 115000000);
    assert.equal(confirmed.confirmations.length, 1);
    assert.equal(confirmed.receipts.length, 2);
    assert.equal(confirmed.commitment.status, "confirmed_booking");
    assert.deepEqual(confirmed.occupancies, admitted.occupancies);
    assert.equal(confirmed.occupancies.length, 5);
    assert.equal(confirmed.releases, 0);
    await finishWorker(startWorker("process"));
    assert.deepEqual(
      observeRecovery(),
      confirmed,
      "Repeated processing must preserve all durable identities",
    );
    harness.runSql(paymentEvidenceSql + cleanup);
    seeded = false;
  }
  console.log(
    "Composed processing confirmed newly admitted work through two competing clients and recovered both response-loss and confirmation interruption: one physical capture, one confirmation, two receipts and five unchanged occupancies.",
  );
}

let seeded = false;
const cleanup = `begin;
  alter table public.payment_provider_operations disable trigger guard_payment_provider_admission;
  alter table public.payment_provider_observations disable trigger guard_payment_provider_observation;
  delete from public.payment_provider_observations where operation_id in (select id from public.payment_provider_operations where claim_id='72000000-0000-4000-8000-000000001001');
  alter table public.payment_provider_observations enable trigger guard_payment_provider_observation;
  delete from public.simulated_payment_effects where operation_id in (select id from public.payment_provider_operations where claim_id='72000000-0000-4000-8000-000000001001');
  alter table public.booking_request_payment_history disable trigger reject_booking_request_payment_history_change;
  delete from public.booking_request_payment_history
  where payment_lifecycle_id in (
    select payment_lifecycle_id from public.booking_requests where id = '${requestId}'
  );
  alter table public.booking_request_payment_history enable trigger reject_booking_request_payment_history_change;
  alter table public.booking_receipts disable trigger reject_booking_receipt_change;
  delete from public.booking_receipts where booking_confirmation_id in (
    select id from public.booking_confirmations where booking_request_id = '${requestId}'
  );
  alter table public.booking_receipts enable trigger reject_booking_receipt_change;
  alter table public.booking_confirmations disable trigger reject_booking_confirmation_change;
  delete from public.booking_confirmations where booking_request_id = '${requestId}';
  alter table public.booking_confirmations enable trigger reject_booking_confirmation_change;
  delete from public.booking_request_release_work where booking_request_id = '${requestId}';
  delete from public.booking_request_capture_work where booking_request_id = '${requestId}';
  delete from public.payment_provider_operations where claim_id = '72000000-0000-4000-8000-000000001001';
  delete from public.booking_request_provider_operation_identities where attempt_id = '70000000-0000-4000-8000-000000001001';
  delete from public.booking_request_authorization_claim_items where claim_id = '72000000-0000-4000-8000-000000001001';
  delete from public.booking_request_authorization_claim_occupancies where claim_id = '72000000-0000-4000-8000-000000001001';
  delete from public.booking_request_authorization_claims where id = '72000000-0000-4000-8000-000000001001';
  delete from public.booking_request_submission_attempts where id = '70000000-0000-4000-8000-000000001001';
  delete from public.booking_request_status_notifications where booking_request_id = '${requestId}';
  delete from public.owner_request_notifications where booking_request_id = '${requestId}';
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
alter table public.payment_provider_operations enable trigger guard_payment_provider_admission;
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
  harness.runSql(paymentEvidenceSql + `begin; ${fixture} commit;`);
  seeded = true;

  const [leased, processing] = await duplicate(leaseSql, "lease");
  assert.equal(leased.status, "leased");
  assert.deepEqual(processing, { status: "processing" });
  assert.equal(
    harness.runSql(
      paymentEvidenceSql +
        "select count(*) from public.payment_provider_operations where operation_kind = 'capture';",
    ),
    "0",
    "Committed leasing must precede provider execution",
  );
  // Contention proofs use a fixed fixture deadline after observing the real lease.
  const permit = { ...leased.permit, notAfter: "2100-01-01T00:00:00.000Z" };
  harness.runSql(
    paymentEvidenceSql +
      `update public.booking_request_capture_work set lease_expires_at = '${permit.notAfter}' where booking_request_id = '${requestId}';`,
  );
  await proveAdmissionAfterLocks(permit);
  const providerSql = `select pg_temp.capture_execute(${literal(permit)});`;
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
    JSON.parse(harness.runSql(paymentEvidenceSql + leaseSql)),
    completed,
    "Completed leasing must replay evidence without another provider call",
  );
  assert.equal(
    harness.runSql(
      paymentEvidenceSql +
        `select count(*) || ':' || sum((select effect.physical_execution_count from public.simulated_payment_effects effect where effect.operation_id=payment_provider_operations.id)) from public.payment_provider_operations where operation_kind = 'capture' and payment_lifecycle_id = '${permit.paymentLifecycleId}';`,
    ),
    "1:1",
  );
  assert.equal(
    harness.runSql(
      paymentEvidenceSql +
        `select count(*) from public.booking_request_provider_operation_identities where attempt_id = '${permit.submissionAttemptId}' and operation_kind = 'capture';`,
    ),
    "1",
  );
  assert.equal(
    harness.runSql(
      paymentEvidenceSql +
        `select jsonb_array_length(jsonb_path_query_array(payment_snapshot, '$.movements[*] ? (@.kind == "capture")')) from public.booking_request_submission_attempts where id = '${permit.submissionAttemptId}';`,
    ),
    "1",
  );
  harness.runSql(paymentEvidenceSql + cleanup);
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
  harness.runSql(paymentEvidenceSql + `begin; ${confirmationFixture} commit;`);
  seeded = true;
  const captureSnapshot = JSON.parse(
    harness.runSql(
      paymentEvidenceSql +
        `select public.complete_booking_request_capture(
        '${requestId}',
        (capture_execution_permit ->> 'leaseGeneration')::bigint,
        (capture_execution_permit ->> 'leaseToken')::uuid,
        jsonb_build_object('outcome', 'succeeded',
          'providerRequestId', provider_request_id,
          'providerReference', provider_reference,
          'movementReference', movement_reference)
      ) -> 'snapshot'
      from public.payment_provider_operations
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
      paymentEvidenceSql +
        `select count(*) || ':' || (select count(*) from public.booking_receipts) || ':' || (select count(*) from public.cottage_booking_period_commitments where status = 'confirmed_booking') from public.booking_confirmations;`,
    ),
    "1:2:1",
    "Concurrent finalization must persist one confirmation, two receipts, and one promoted commitment",
  );
  assert.equal(
    harness.runSql(
      paymentEvidenceSql +
        `select count(*) from public.cottage_booking_period_occupancies where booking_period_commitment_id = '50000000-0000-4000-8000-000000001001' and active;`,
    ),
    "5",
    "Concurrent finalization must retain every selected Shift occupancy",
  );
  assert.equal(
    harness.runSql(
      paymentEvidenceSql +
        `select count(*) from public.booking_request_release_work where booking_request_id = '${requestId}';`,
    ),
    "0",
    "Successful finalization must not create release work",
  );
  console.log(
    "Booking Request Capture contention proved one lease, one physical provider execution, one Capture identity and movement, exact replay, ordered locks for all three entry points through the completed Capture identity, and admission refusal after a blocked deadline. Confirmation contention then proved one identical outcome, two receipts, retained complete occupancy, no release work, and the same ordered Capture lock prefix through the commitment.",
  );
  harness.runSql(paymentEvidenceSql + cleanup);
  seeded = false;
  const recoverySource = confirmationSource
    .split("-- BEGIN CAPTURE RECOVERY SOURCE\n")[1]
    ?.split("-- END CAPTURE RECOVERY SOURCE")[0];
  assert.ok(
    recoverySource,
    "Capture recovery needs the complete source-only fixture",
  );
  await proveOwnerAdmission(recoverySource);
  await proveRecoveryProgress(recoverySource);
  await proveApplicationRecovery(recoverySource);
  await proveFailureRecording(recoverySource);
  await proveApplicationFailureRecovery(recoverySource);
  await proveCaptureProcessing(recoverySource);
  await proveIndeterminateCaptureRecovery(recoverySource);
} finally {
  for (const worker of workers) worker.child.kill("SIGTERM");
  await Promise.all([...workers].map((worker) => worker.exited));
  rmSync(temporaryDirectory, { recursive: true, force: true });
  for (const session of sessions) {
    if (!session.child.stdin.destroyed && !session.child.stdin.writableEnded)
      session.child.stdin.end("rollback;\n");
  }
  await Promise.all([...sessions].map((session) => session.exited));
  if (seeded) harness.runSql(paymentEvidenceSql + cleanup);
}
