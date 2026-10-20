import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
import {
  captureCleanup,
  confirmedBookingCleanup,
  confirmedBookingAccessCleanup,
  customerReviewCleanup,
  publishedCottageCleanup,
} from "./lib/booking-fixture.mjs";

const harness = createLocalSupabaseConcurrencyHarness({
  timing: {
    check: "verify-booking-request-capture-concurrency",
    isolation: "serial",
  },
});
harness.markTimingPhase("setup");
let timingOutcome = "failed";
try {
  // SQL arrangement mirrors admission, isolated effect, and explicit recording.
  const paymentEvidenceSql =
    "-- BEGIN PAYMENT EVIDENCE FIXTURE\n" +
    readFileSync("supabase/fixtures/payment-evidence.sql", "utf8") +
    "\n-- END PAYMENT EVIDENCE FIXTURE\n";

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

  async function start(sql, close = false) {
    const session = await harness.startSessionAfterSetup(
      paymentEvidenceSql,
      sql,
      close,
    );
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
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select count(*) from pg_stat_activity contender cross join pg_stat_activity holder where contender.application_name = '${contenderName}' and holder.application_name = '${holderName}' and holder.pid = any(pg_blocking_pids(contender.pid));`,
      ),
      "1",
      "The expected earlier row must be the actual blocker",
    );
  }
  async function duplicate(sql, label) {
    const holderName = `capture_${label}_holder`;
    const contenderName = `capture_${label}_contender`;
    const holder = await start(
      `begin; set application_name = '${holderName}'; set local role service_role; ${sql} select 'CAPTURE_HELD';`,
    );
    await harness.waitForMarker(holder, "CAPTURE_HELD");
    const contender = await start(
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
      const holder = await start(
        `begin; set application_name = '${holderName}'; select 1 from ${row} for update; select 'EARLIER_HELD';`,
      );
      await harness.waitForMarker(holder, "EARLIER_HELD");
      const contender = await start(
        `begin; set application_name = '${contenderName}'; set local role service_role; ${sql} rollback;`,
        true,
      );
      await blockedBy(contenderName, contender, holderName);
      for (const [laterName, laterRow] of lockRows.slice(index + 1)) {
        assert.equal(
          await harness.runSqlAfterSetup(
            paymentEvidenceSql,
            `begin; select 1 from ${laterRow} for update nowait; rollback;`,
          ),
          "1",
          `${label} must not lock later ${laterName} while blocked on ${rowName}`,
        );
      }
      if (index === 0) {
        const reversed = await start(
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
      await start(`begin; set application_name = 'capture_expiry_holder'; select 1 from ${rows[0][1]} for update;
    update public.booking_request_capture_work set lease_expires_at = date_trunc('milliseconds', clock_timestamp()) + interval '10 seconds' where booking_request_id = '${requestId}';
    select ${literal(permit)} || jsonb_build_object('notAfter', to_char(lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) from public.booking_request_capture_work where booking_request_id = '${requestId}'; select 'EXPIRY_HELD';`);
    await harness.waitForMarker(holder, "EXPIRY_HELD");
    const expiringPermit = result(holder);
    const contender = await start(
      `begin; set application_name = 'capture_expiry_contender'; set local role service_role; select pg_temp.capture_execute(${literal(expiringPermit)}); rollback;`,
      true,
    );
    await blockedBy(
      "capture_expiry_contender",
      contender,
      "capture_expiry_holder",
    );
    assert.equal(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select clock_timestamp() < '${expiringPermit.notAfter}'::timestamptz;`,
      ),
      "t",
      "Provider must begin waiting before its admission deadline",
    );
    const observationDeadline = Date.now() + 15_000;
    while (
      (await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select clock_timestamp() >= '${expiringPermit.notAfter}'::timestamptz;`,
      )) !== "t"
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
    await harness.runSqlAfterSetup(
      paymentEvidenceSql,
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
  function startWorker(mode, bookingRequestId = requestId, extraEnv = {}) {
    for (const key of ["SUPABASE_URL", "SUPABASE_SECRET_KEY"])
      assert.ok(process.env[key], `${key} is required for Capture recovery`);
    const child = spawn(process.execPath, [workerBundle], {
      env: {
        ...process.env,
        CAPTURE_WORKER_MODE: mode,
        CAPTURE_BOOKING_REQUEST_ID: bookingRequestId,
        ...extraEnv,
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
  async function observeRecovery() {
    return JSON.parse(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
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
  async function expireCaptureLease() {
    await harness.runSqlAfterSetup(
      paymentEvidenceSql,
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
    harness.markTimingPhase("setup");
    await build({
      entryPoints: ["scripts/booking-request-capture-recovery-worker.ts"],
      outfile: workerBundle,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
    });
    harness.markTimingPhase("execution");
    for (const mode of ["lose-response", "capture-only"]) {
      const traceStart = providerTrace.length;
      harness.markTimingPhase("setup");
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `begin; ${source} commit;`,
      );
      harness.markTimingPhase("execution");
      seeded = true;
      const initial = startWorker(mode);
      const initialResult = await finishWorker(initial);
      const before = await observeRecovery();
      assert.equal(
        initial.messages.filter((message) => message.stage === "execute")
          .length,
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
        await expireCaptureLease();
        const claimSql = `select public.claim_due_booking_request_captures(20, ${literal(providerIdentity)});`;
        const holder = await start(
          `begin; set local role service_role; ${claimSql} select 'RECOVERY_HELD';`,
        );
        await harness.waitForMarker(holder, "RECOVERY_HELD");
        assert.match(holder.stdout, /"status": "reconcile"/);
        assert.equal(
          await harness.runSqlAfterSetup(
            paymentEvidenceSql,
            `begin; set local role service_role; ${claimSql} commit;`,
          ),
          "[]",
          "A competing session skips the locked recovery candidate",
        );
        await finish(holder, { action: "rollback" });
        const renewed = await start(
          `begin; set application_name = 'capture_recovery_renewal'; select 1 from ${rows[1][1]} for update; update public.booking_request_capture_work set lease_expires_at = '2100-01-01T00:00:00Z' where booking_request_id = '${requestId}'; select 'RENEWAL_HELD';`,
        );
        await harness.waitForMarker(renewed, "RENEWAL_HELD");
        const waiting = await start(
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
        await expireCaptureLease();
        await proveLockOrder(claimSql, "recovery_claim", rows.slice(1, 5));
        const querySql = `select pg_temp.capture_query(${literal({ providerIdentity, requestFingerprint: before.ledger[0].request_fingerprint, paymentLifecycleId: before.ledger[0].payment_lifecycle_id, logicalOperationId: before.ledger[0].logical_operation_id, physicalAttemptId: before.ledger[0].physical_attempt_id, operationKind: "capture", amountFils: before.ledger[0].amount_fils, currency: "IQD" })}, ${before.ledger[0].provider_request_id === null ? "null" : `'${before.ledger[0].provider_request_id}'`}, ${before.ledger[0].provider_reference === null ? "null" : `'${before.ledger[0].provider_reference}'`});`;
        await proveLockOrder(querySql, "recovery_query", rows.slice(0, 5));
        const recovering = startWorker("pause-query");
        const query = await stage(recovering, "query");
        const reclaimed = await observeRecovery();
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
        const { admission: queriedAdmission, ...queriedBinding } =
          query.request;
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
        const stale = await start(
          `begin; set local role service_role; select public.complete_booking_request_capture('${requestId}', ${before.work.lease_generation}, '${before.work.lease_token}', ${literal({ outcome: "succeeded", providerRequestId: before.ledger[0].provider_request_id, providerReference: before.ledger[0].provider_reference, movementReference: before.ledger[0].movement_reference })}); rollback;`,
          true,
        );
        await finish(stale, { expectedState: "RC409" });
        assert.equal(
          (await observeRecovery()).snapshot.capture,
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
      const after = await observeRecovery();
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
          await observeRecovery(),
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
      harness.markTimingPhase("setup");
      await harness.runSqlAfterSetup(paymentEvidenceSql, cleanup);
      harness.markTimingPhase("execution");
      seeded = false;
    }
    console.log(
      "Actual Capture application recovery confirmed a lost provider response and interrupted confirmation using fresh clients: one original physical execution, fenced lease renewal, exact query identity, one Capture movement, one confirmation, two receipts, all five original occupancies, and unchanged repeated drains without release.",
    );
  }

  async function proveFailureRecording(source) {
    for (const mode of ["duplicate", "expired-after-lock"]) {
      harness.markTimingPhase("setup");
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `begin; ${source} commit;`,
      );
      harness.markTimingPhase("execution");
      seeded = true;
      const lease = JSON.parse(
        await harness.runSqlAfterSetup(paymentEvidenceSql, leaseSql),
      );
      assert.equal(lease.status, "leased");
      if (mode === "expired-after-lock") {
        lease.permit = JSON.parse(
          await harness.runSqlAfterSetup(
            paymentEvidenceSql,
            `update public.booking_request_capture_work set lease_expires_at=date_trunc('milliseconds',clock_timestamp())+interval '10 seconds' where booking_request_id='${requestId}' returning ${literal(lease.permit)} || jsonb_build_object('notAfter',to_char(lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));`,
          ),
        );
      }
      const failed = JSON.parse(
        await harness.runSqlAfterSetup(
          paymentEvidenceSql,
          `select pg_temp.capture_execute(${literal(lease.permit)},'failed');`,
        ),
      );
      const before = await observeRecovery();
      const finalize = `select public.record_booking_request_capture_failure('${requestId}',${lease.permit.leaseGeneration},'${lease.permit.leaseToken}',${literal(failed)});`;
      if (mode === "duplicate") {
        const [first, repeated] = await duplicate(
          finalize,
          "failure_recording",
        );
        assert.equal(first.status, "payment-required");
        assert.deepEqual(
          repeated,
          first,
          "Two finalizers must return one identical fixed window",
        );
        const after = await observeRecovery();
        assert.equal(after.notifications.length, 1);
        assert.deepEqual(after.occupancies, before.occupancies);
        assert.deepEqual(after.inventory, before.inventory);
        assert.deepEqual(after.ledger, before.ledger);
      } else {
        const holder = await start(
          "begin; set application_name='failure_commitment_holder'; select 1 from public.cottage_booking_period_commitments where id='50000000-0000-4000-8000-000000001001' for update; select 'COMMITMENT_HELD';",
        );
        await harness.waitForMarker(holder, "COMMITMENT_HELD");
        const contender = await start(
          `begin; set application_name='failure_deadline_contender'; set local role service_role; ${finalize} commit;`,
          true,
        );
        await blockedBy(
          "failure_deadline_contender",
          contender,
          "failure_commitment_holder",
        );
        assert.equal(
          await harness.runSqlAfterSetup(
            paymentEvidenceSql,
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
        const after = await observeRecovery();
        assert.equal(after.work.state, "processing");
        assert.equal(after.notifications.length, 0);
        assert.deepEqual(after.occupancies, before.occupancies);
      }
      harness.markTimingPhase("setup");
      await harness.runSqlAfterSetup(paymentEvidenceSql, cleanup);
      harness.markTimingPhase("execution");
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
      harness.markTimingPhase("setup");
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `begin; ${source} commit;`,
      );
      harness.markTimingPhase("execution");
      seeded = true;
      const initial = startWorker("indeterminate-capture");
      assert.equal(await finishWorker(initial), "indeterminate");
      const unknown = await observeRecovery();
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
        harness.markTimingPhase("setup");
        await harness.runSqlAfterSetup(
          paymentEvidenceSql,
          `begin; ${other(pendingSource(source))} ${other(acceptSql)} commit;`,
        );
        harness.markTimingPhase("execution");
        otherSeeded = true;
        assert.equal(
          (await finishWorker(startWorker("capture-only", otherId))).status,
          "complete",
        );
        await expireCaptureLease();
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
        harness.markTimingPhase("cleanup");
        if (otherSeeded)
          await harness.runSqlAfterSetup(
            paymentEvidenceSql,
            captureCleanup({ stem: "110" }),
          );
      }
      harness.markTimingPhase("execution");
      const stillUnknown = await observeRecovery();
      assert.deepEqual(stillUnknown.ledger, unknown.ledger);
      assert.deepEqual(stillUnknown.effects, unknown.effects);
      assert.deepEqual(stillUnknown.occupancies, unknown.occupancies);
      assert.equal(stillUnknown.confirmations.length, 0);
      assert.equal(stillUnknown.receipts.length, 0);
      assert.equal(stillUnknown.commitment.status, "pending_hold");
      assert.equal(stillUnknown.snapshot.capture, null);
      await expireCaptureLease();
      const terminalWorker = startWorker(
        outcome === "failed" ? "recover-failure" : "recover",
      );
      const terminalResult = await finishWorker(terminalWorker);
      assert.equal(
        terminalResult[0].status,
        outcome === "failed" ? "payment-required" : "confirmed",
      );
      const terminal = await observeRecovery();
      assert.equal(terminal.ledger.length, 1);
      assert.equal(terminal.ledger[0].id, unknown.ledger[0].id);
      assert.deepEqual(
        terminal.ledger[0].admission,
        unknown.ledger[0].admission,
      );
      assert.equal(terminal.ledger[0].original_outcome, "indeterminate");
      assert.equal(terminal.ledger[0].current_outcome, outcome);
      assert.equal(
        terminal.ledger[0].executed_at,
        unknown.ledger[0].executed_at,
      );
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
          await harness.runSqlAfterSetup(
            paymentEvidenceSql,
            `begin;
        create function public.unknown_capture_expiry_now() returns timestamptz language sql as $$select payment_required_deadline from public.booking_request_capture_work where booking_request_id='${requestId}'$$;
        do $$begin execute replace(pg_get_functiondef('public.prepare_booking_request_payment_required_expiry(uuid,jsonb,jsonb)'::regprocedure),'clock_timestamp()','public.unknown_capture_expiry_now()');end$$;
        set local role service_role; select pg_temp.expiry_prepare('${requestId}',${literal(providerIdentity)},jsonb_build_object('action','release','authorizationLifecycleId',public.get_booking_request_payment_facts('${requestId}')->>'originalLifecycleId','recoveryOperationId',null)); rollback;`,
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
        await observeRecovery(),
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
      harness.markTimingPhase("setup");
      await harness.runSqlAfterSetup(paymentEvidenceSql, cleanup);
      harness.markTimingPhase("execution");
      seeded = false;
    }
    console.log(
      "Original indeterminate Capture survives fresh unknown inquiry, unrelated eligible work, and same-identity success/failure resolution: one execution, immutable original evidence, exact success occurrence, one confirmation or fixed Payment Required window, safe expiry preparation, and terminal replay.",
    );
  }

  async function proveApplicationFailureRecovery(source) {
    const traceStart = providerTrace.length;
    harness.markTimingPhase("setup");
    await harness.runSqlAfterSetup(
      paymentEvidenceSql,
      `begin; ${source} commit;`,
    );
    harness.markTimingPhase("execution");
    seeded = true;
    const interrupted = startWorker("failure-lose-response");
    assert.equal(await finishWorker(interrupted), "interrupted");
    assert.equal(
      interrupted.messages.filter((message) => message.stage === "execute")
        .length,
      1,
    );
    const failedExecution = await observeRecovery();
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
    await expireCaptureLease();
    const claimSql = `select public.claim_due_booking_request_captures(20, ${literal(providerIdentity)});`;
    const holder = await start(
      `begin; set local role service_role; ${claimSql} select 'FAILURE_RECOVERY_HELD';`,
    );
    await harness.waitForMarker(holder, "FAILURE_RECOVERY_HELD");
    assert.match(holder.stdout, /"status": "reconcile"/);
    assert.equal(
      await harness.runSqlAfterSetup(paymentEvidenceSql, claimSql),
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
    const terminal = await observeRecovery();
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
      await observeRecovery(),
      terminal,
      "Repeated failure recovery must not move the terminal window or recapture",
    );
    const trace = providerTrace.slice(traceStart);
    assert.equal(trace.filter((call) => call.stage === "execute").length, 1);
    assert.equal(trace.filter((call) => call.stage === "query").length, 1);
    harness.markTimingPhase("setup");
    await harness.runSqlAfterSetup(paymentEvidenceSql, cleanup);
    harness.markTimingPhase("execution");
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
  async function proveSuspensionFixtureCleanup(source) {
    const administratorId = "10000000-0000-4000-8000-000000001098";
    const commandId = "90000000-0000-4000-8000-000000001098";
    const unrelatedCommandId = "90000000-0000-4000-8000-000000001099";
    const outsideRequestId = "60000000-0000-4000-8000-000000001011";
    const ownedCleanup = confirmedBookingCleanup({
      administrator: administratorId,
      terminalRequest: true,
    });
    const outsideCleanup = captureCleanup({ stem: "101", releaseOperations: true });
    const unrelatedCleanup = captureCleanup({ stem: "102", releaseOperations: true });
    const cloned = pendingSource(source)
      .replaceAll("1001", "1011")
      .replaceAll("1002", "1012")
      .replaceAll("1003", "1013")
      .replaceAll("2101-", "2102-")
      .replaceAll("repeat('b',64)", "repeat('f',64)")
      .replaceAll("CONFIRMATION-HOLD-1", "SUSPENSION-CLEANUP-OUTSIDE-HOLD")
      .replaceAll("confirmation-auth-request-1", "cleanup-outside-auth-request")
      .replaceAll("confirmation-auth-reference-1", "cleanup-outside-auth-reference")
      .replaceAll("confirmation-auth-movement-1", "cleanup-outside-auth-movement");
    const unrelated = pendingSource(source)
      .replaceAll("1001", "1021").replaceAll("1002", "1022").replaceAll("1003", "1023")
      .replaceAll("CONFIRMATION-HOLD-1", "SUSPENSION-CLEANUP-UNRELATED-HOLD")
      .replaceAll("confirmation-auth-request-1", "cleanup-unrelated-auth-request")
      .replaceAll("confirmation-auth-reference-1", "cleanup-unrelated-auth-reference")
      .replaceAll("confirmation-auth-movement-1", "cleanup-unrelated-auth-movement");
    const outside = `
      insert into auth.users(id,aud,role,phone,phone_confirmed_at) values
        ('10000000-0000-4000-8000-000000001011','authenticated','authenticated','+9647500001011',now()),
        ('10000000-0000-4000-8000-000000001013','authenticated','authenticated','+9647500001013',now());
      insert into public.account_contexts(user_id,role,owner_approval_state) values
        ('10000000-0000-4000-8000-000000001011','cottage_owner','approved'),
        ('10000000-0000-4000-8000-000000001013','customer',null);
      ${cloned.slice(cloned.indexOf("insert into public.owner_application_cottage_profiles")).replaceAll("10000000-0000-4000-8000-000000001012", customerId)}
    `;
    const authorization = `set local request.jwt.claims=
      '{"sub":"${administratorId}","role":"authenticated","aal":"aal2"}';`;
    const observe = () => harness.runSqlAfterSetup(paymentEvidenceSql, `
      select jsonb_build_object(
        'actions',(select jsonb_agg(to_jsonb(actions) order by id) from private.marketplace_suspension_actions actions where command_id in ('${commandId}','${unrelatedCommandId}')),
        'work',(select jsonb_agg(to_jsonb(work) order by id) from public.booking_request_release_work work where booking_request_id in ('${requestId}','${outsideRequestId}','60000000-0000-4000-8000-000000001021')),
        'requests',(select jsonb_agg(to_jsonb(requests) order by id) from public.booking_requests requests where id in ('${requestId}','${outsideRequestId}','60000000-0000-4000-8000-000000001021')),
        'profiles',(select jsonb_agg(to_jsonb(profiles) order by id) from public.owner_application_cottage_profiles profiles where id in ('20000000-0000-4000-8000-000000001001','20000000-0000-4000-8000-000000001011','20000000-0000-4000-8000-000000001021')),
        'accounts',(select jsonb_agg(to_jsonb(contexts) order by user_id) from public.account_contexts contexts where user_id in ('${ownerId}','${customerId}','10000000-0000-4000-8000-000000001011','10000000-0000-4000-8000-000000001013','10000000-0000-4000-8000-000000001021','10000000-0000-4000-8000-000000001022','10000000-0000-4000-8000-000000001023','10000000-0000-4000-8000-000000001099','${administratorId}'))
      );
    `);
    try {
      harness.markTimingPhase("setup");
      await harness.runSqlAfterSetup(paymentEvidenceSql, `begin;
        ${pendingSource(source)} ${outside} ${unrelated}
        insert into auth.users(id,aud,role,phone,phone_confirmed_at) values
          ('${administratorId}','authenticated','authenticated','+9647500001098',now()),
          ('10000000-0000-4000-8000-000000001099','authenticated','authenticated','+9647500001099',now());
        insert into public.account_contexts(user_id,role) values
          ('${administratorId}','platform_administrator'),('10000000-0000-4000-8000-000000001099','customer');
        ${authorization}
        savepoint cottage_scope;
        select public.set_marketplace_suspension('cottage','20000000-0000-4000-8000-000000001001','suspend',0,'Fictional cottage scope','90000000-0000-4000-8000-000000001086');
        do $scope$ begin
          if (select count(*) from public.booking_request_release_work where booking_request_id in ('${requestId}','${outsideRequestId}','60000000-0000-4000-8000-000000001021'))<>1
            or not exists(select 1 from public.booking_requests where id='${requestId}' and status='processing')
            or not exists(select 1 from public.booking_requests where id='${outsideRequestId}' and status='pending')
            or not exists(select 1 from public.booking_requests where id='60000000-0000-4000-8000-000000001021' and status='pending')
          then raise exception 'Cottage suspension crossed the exact pending request scope'; end if;
        end; $scope$;
        rollback to savepoint cottage_scope;
        savepoint owner_scope;
        insert into public.owner_applications(id,owner_user_id,applicant_kind,legal_name,status,submitted_at,review_started_at,review_due_at)
        values('90000000-0000-4000-8000-000000001085','${ownerId}','individual','Fictional Scope Owner','submitted',now(),now(),now()+interval '72 hours');
        insert into public.owner_verification_documents(id,application_id,kind,object_path,original_filename,media_type,size_bytes)
        values('90000000-0000-4000-8000-000000001085','90000000-0000-4000-8000-000000001085','identity','fictional/scope/identity.pdf','identity.pdf','application/pdf',128);
        update public.owner_verification_documents set content_digest=repeat('f',64),digest_source='sha256' where id='90000000-0000-4000-8000-000000001085';
        select public.review_owner_application('90000000-0000-4000-8000-000000001085',1,'approve','Fictional content-bound evidence accepted','{}','{}','Baghdad','licence','Fictional licence',jsonb_build_object('identity',(current_date+365)::text));
        select public.set_marketplace_suspension('owner','${ownerId}','suspend',2,'Fictional owner scope','90000000-0000-4000-8000-000000001084');
        do $scope$ begin
          if (select count(*) from public.booking_request_release_work where booking_request_id in ('${requestId}','${outsideRequestId}','60000000-0000-4000-8000-000000001021'))<>1
            or not exists(select 1 from public.booking_requests where id='${requestId}' and status='processing')
            or not exists(select 1 from public.booking_requests where id='${outsideRequestId}' and status='pending')
            or not exists(select 1 from public.booking_requests where id='60000000-0000-4000-8000-000000001021' and status='pending')
            or exists(select 1 from public.account_contexts where user_id='${customerId}' and customer_suspended)
          then raise exception 'Owner suspension crossed pending scope or changed customer capability'; end if;
        end; $scope$;
        rollback to savepoint owner_scope;
        select public.set_marketplace_suspension('customer','${customerId}','suspend',0,'Fictional shared-customer cleanup case','${commandId}');
        select public.set_marketplace_suspension('customer','10000000-0000-4000-8000-000000001099','suspend',0,'Unrelated fixture action','${unrelatedCommandId}');
        commit;`);
      seeded = true;
      harness.markTimingPhase("execution");
      assert.equal(await harness.runSqlAfterSetup(paymentEvidenceSql, `
        select count(*) from public.booking_request_release_work work join private.marketplace_suspension_actions actions on actions.id=work.suspension_action_id where actions.command_id='${commandId}';
      `), "2", "Customer scope must include the request on the other cottage");
      assert.equal(await harness.runSqlAfterSetup(paymentEvidenceSql,
        `select status from public.booking_requests where id='60000000-0000-4000-8000-000000001021';`), "pending",
        "Customer suspension must preserve another customer's pending request");
      const before = await observe();
      const noReleaseCleanupVariants = [
        confirmedBookingCleanup({ administrator: administratorId }),
        customerReviewCleanup("10"),
        customerReviewCleanup("11", { reusedAuthUsers: [customerId] }),
        confirmedBookingAccessCleanup({ stem: "100" }),
        publishedCottageCleanup({
          profiles: ["20000000-0000-4000-8000-000000001001"],
          users: [ownerId, customerId, "10000000-0000-4000-8000-000000001003"],
        }),
      ];
      for (const selectedCleanup of [ownedCleanup, captureCleanup(), ...noReleaseCleanupVariants]) {
        let refusal;
        try {
          await harness.runSqlAfterSetup(paymentEvidenceSql, selectedCleanup);
        } catch (error) {
          refusal = error;
        }
        assert.equal(await observe(), before,
          "Outside release references must preserve every owned and outside fact before cleanup");
        assert.match(refusal?.message ?? "", /outside.*release|release.*outside/i,
          "Every whole-fixture cleanup must explicitly refuse another fixture's release reference");
      }
      const actionId = await harness.runSqlAfterSetup(paymentEvidenceSql,
        `select id from private.marketplace_suspension_actions where command_id='${commandId}';`);
      await harness.runSqlAfterSetup(paymentEvidenceSql,
        `update public.booking_request_release_work set suspension_action_id=null where booking_request_id='${outsideRequestId}';`);
      const releaseHolder = await start(`begin; set application_name='suspension_cleanup_release_holder'; select 1 from public.booking_request_release_work where booking_request_id='${requestId}' for update; select 'CLEANUP_RELEASE_HELD';`);
      await harness.waitForMarker(releaseHolder, "CLEANUP_RELEASE_HELD");
      const cleaning = await start(`set application_name='suspension_cleanup_preflight_holder'; ${ownedCleanup}`, true);
      await blockedBy("suspension_cleanup_preflight_holder", cleaning, "suspension_cleanup_release_holder");
      const newReference = await start(`begin; set application_name='suspension_cleanup_fk_contender'; update public.booking_request_release_work set suspension_action_id='${actionId}' where booking_request_id='${outsideRequestId}'; select 'CLEANUP_NEW_REFERENCE_ATTACHED';`);
      try {
        await blockedBy("suspension_cleanup_fk_contender", newReference, "suspension_cleanup_preflight_holder");
        await harness.runSqlAfterSetup(paymentEvidenceSql,
          `select pg_cancel_backend(pid) from pg_stat_activity where application_name='suspension_cleanup_preflight_holder';`);
        await finish(cleaning, { expectedState: "57014" });
        await harness.waitForMarker(newReference, "CLEANUP_NEW_REFERENCE_ATTACHED");
        await finish(newReference, { action: "rollback" });
      } finally {
        await finish(releaseHolder, { action: "rollback" });
      }
      await harness.runSqlAfterSetup(paymentEvidenceSql,
        `update public.booking_request_release_work set suspension_action_id='${actionId}' where booking_request_id='${outsideRequestId}';`);
      assert.equal(await observe(), before, "Canceled cleanup and new reference attempt preserve exact owned and outside rows");
      harness.markTimingPhase("cleanup");
      await harness.runSqlAfterSetup(paymentEvidenceSql, outsideCleanup);
      harness.markTimingPhase("execution");
      assert.equal(await harness.runSqlAfterSetup(paymentEvidenceSql, `
        select count(*) from private.marketplace_suspension_actions where command_id='${unrelatedCommandId}';
      `), "1", "Outside fixture teardown retains an unrelated target action");
      const ownedOnly = await observe();
      for (const selectedCleanup of noReleaseCleanupVariants) {
        let refusal;
        try {
          await harness.runSqlAfterSetup(paymentEvidenceSql, selectedCleanup);
        } catch (error) {
          refusal = error;
        }
        assert.equal(await observe(), ownedOnly,
          "A cleanup that deletes no release work must preserve even its own referenced target/action");
        assert.match(refusal?.message ?? "", /outside.*release|release.*outside/i,
          "No-release variants must use the empty allowed request set");
      }
      await harness.runSqlAfterSetup(paymentEvidenceSql, ownedCleanup);
      seeded = false;
      assert.equal(await harness.runSqlAfterSetup(paymentEvidenceSql, `
        select count(*) from private.marketplace_suspension_actions where command_id='${commandId}';
      `), "0", "Whole-fixture teardown removes its prechecked action after owned release work");
      assert.equal(await harness.runSqlAfterSetup(paymentEvidenceSql, `
        select count(*) from private.marketplace_suspension_actions where command_id='${unrelatedCommandId}';
      `), "1", "Owned teardown must retain the unrelated fixture action");
      harness.markTimingPhase("setup");
      await harness.runSqlAfterSetup(paymentEvidenceSql, `begin; ${pendingSource(source)} commit;`);
      seeded = true;
      harness.markTimingPhase("execution");
      assert.equal(await harness.runSqlAfterSetup(paymentEvidenceSql, `
        select customer_suspension_revision from public.account_contexts where user_id='${customerId}';
      `), "0", "The exact fixed fixture reseeds without retained restriction history");
    } finally {
      harness.markTimingPhase("cleanup");
      // These exact commands and release rows belong to this scenario, including an old replica-mode teardown.
      await harness.runSqlAfterSetup(paymentEvidenceSql, `begin;
        delete from public.booking_request_release_operations where work_id in (
          select id from public.booking_request_release_work where booking_request_id in ('${requestId}','${outsideRequestId}','60000000-0000-4000-8000-000000001021')
        );
        delete from public.booking_request_release_work where booking_request_id in ('${requestId}','${outsideRequestId}','60000000-0000-4000-8000-000000001021');
        delete from private.marketplace_suspension_actions where command_id in ('${commandId}','${unrelatedCommandId}');
        commit;
      `);
      await harness.runSqlAfterSetup(paymentEvidenceSql, outsideCleanup);
      await harness.runSqlAfterSetup(paymentEvidenceSql, unrelatedCleanup);
      await harness.runSqlAfterSetup(paymentEvidenceSql, captureCleanup({ releaseOperations: true }));
      await harness.runSqlAfterSetup(paymentEvidenceSql, `
        delete from public.account_contexts where user_id in ('${administratorId}','10000000-0000-4000-8000-000000001099');
        delete from auth.users where id in ('${administratorId}','10000000-0000-4000-8000-000000001099');
      `);
      seeded = false;
      harness.markTimingPhase("execution");
    }
    console.log("Suspension fixture cleanup refuses outside references before replica mode, preserves exact facts, deletes only owned actions, and reseeds the fixed graph.");
  }
  async function proveMarketplaceSuspension(source) {
    const administratorId = "10000000-0000-4000-8000-000000001098";
    const otherAdministratorId = "10000000-0000-4000-8000-000000001099";
    const applicationId = "90000000-0000-4000-8000-000000001097";
    const secondProfileId = "20000000-0000-4000-8000-000000001097";
    const authorization = `set local request.jwt.claims=
      '{"sub":"${administratorId}","role":"authenticated","aal":"aal2"}';`;
    const command = (kind, target, action, revision, commandId) =>
      `select public.set_marketplace_suspension('${kind}','${target}','${action}',${revision},'Fictional concurrent restriction','${commandId}');`;
    const observe = () => harness.runSqlAfterSetup(paymentEvidenceSql, `
      select jsonb_build_object(
        'accounts',(select jsonb_agg(to_jsonb(contexts) order by user_id) from public.account_contexts contexts where user_id in ('${ownerId}','${customerId}')),
        'application',(select to_jsonb(applications) from public.owner_applications applications where id='${applicationId}'),
        'profiles',(select jsonb_agg(to_jsonb(profiles) order by id) from public.owner_application_cottage_profiles profiles where owner_user_id='${ownerId}'),
        'actions',(select jsonb_agg(to_jsonb(actions) order by id) from private.marketplace_suspension_actions actions where account_user_id in ('${ownerId}','${customerId}') or profile_id in ('20000000-0000-4000-8000-000000001001','${secondProfileId}')),
        'requests',(select to_jsonb(requests) from public.booking_requests requests where id='${requestId}'),
        'attempts',(select to_jsonb(attempts) from public.booking_request_submission_attempts attempts where booking_request_id='${requestId}'),
        'work',(select jsonb_agg(to_jsonb(work) order by id) from public.booking_request_release_work work where booking_request_id='${requestId}'),
        'notices',(select jsonb_agg(to_jsonb(notices) order by id) from public.owner_application_notices notices where application_id='${applicationId}')
      );
    `);
    const clear = async () => {
      harness.markTimingPhase("cleanup");
      await harness.runSqlAfterSetup(paymentEvidenceSql, `begin;
        set local session_replication_role=replica;
        delete from public.owner_application_notices where application_id='${applicationId}';
        delete from public.owner_application_transitions where application_id='${applicationId}';
        delete from public.owner_application_verification_records where application_id='${applicationId}';
        delete from public.owner_verification_document_versions where application_id='${applicationId}';
        delete from public.owner_verification_documents where application_id='${applicationId}';
        delete from public.owner_applications where id='${applicationId}';
        delete from public.owner_application_cottage_profiles where id='${secondProfileId}';
        commit;`);
      await harness.runSqlAfterSetup(paymentEvidenceSql, captureCleanup({ releaseOperations: true }));
      await harness.runSqlAfterSetup(paymentEvidenceSql, `
        delete from public.account_contexts where user_id in ('${administratorId}','${otherAdministratorId}');
        delete from auth.users where id in ('${administratorId}','${otherAdministratorId}');
      `);
      seeded = false;
      harness.markTimingPhase("execution");
    };
    const reset = async () => {
      harness.markTimingPhase("setup");
      await harness.runSqlAfterSetup(paymentEvidenceSql, `begin;
        ${pendingSource(source)}
        insert into auth.users(id,aud,role,phone,phone_confirmed_at) values
          ('${administratorId}','authenticated','authenticated','+9647500001098',now()),
          ('${otherAdministratorId}','authenticated','authenticated','+9647500001099',now());
        insert into public.account_contexts(user_id,role) values
          ('${administratorId}','platform_administrator'),('${otherAdministratorId}','platform_administrator');
        insert into public.owner_applications(id,owner_user_id,applicant_kind,legal_name,status,submitted_at,review_started_at,review_due_at)
        values('${applicationId}','${ownerId}','individual','Fictional Concurrency Owner','submitted',now(),now(),now()+interval '72 hours');
        insert into public.owner_verification_documents(id,application_id,kind,object_path,original_filename,media_type,size_bytes)
        values('${applicationId}','${applicationId}','identity','fictional/concurrency/identity.pdf','identity.pdf','application/pdf',128);
        update public.owner_verification_documents set content_digest=repeat('f',64),digest_source='sha256' where id='${applicationId}';
        ${authorization}
        select public.review_owner_application('${applicationId}',1,'approve','Fictional content-bound evidence accepted','{}','{}','Baghdad','licence','Fictional licence',jsonb_build_object('identity',(current_date+365)::text));
        insert into public.owner_application_cottage_profiles(id,owner_user_id,status) values('${secondProfileId}','${ownerId}','draft');
        commit;`);
      seeded = true;
      harness.markTimingPhase("execution");
    };
    try {
      for (const [label, lock, kind, target, revision] of [
        ["profile", `public.owner_application_cottage_profiles where id='${secondProfileId}'`, "owner", ownerId, 2],
        ["request", `public.booking_requests where id='${requestId}'`, "customer", customerId, 0],
        ["attempt", `public.booking_request_submission_attempts where booking_request_id='${requestId}'`, "customer", customerId, 0],
      ]) {
        await reset();
        const before = await observe();
        const holderName = `suspension_${label}_holder`;
        const contenderName = `suspension_${label}_contender`;
        const holder = await start(`begin; set application_name='${holderName}'; select 1 from ${lock} for update; select 'SUSPENSION_BOUNDARY_HELD';`);
        await harness.waitForMarker(holder, "SUSPENSION_BOUNDARY_HELD");
        const sql = command(kind, target, "suspend", revision, "90000000-0000-4000-8000-000000001096");
        const contender = await start(`begin; set application_name='${contenderName}'; ${authorization} ${sql} commit;`, true);
        let forbiddenWait = false;
        try {
          await harness.waitForLock(contenderName, contender);
          forbiddenWait = true;
          await blockedBy(contenderName, contender, holderName);
          await harness.runSqlAfterSetup(paymentEvidenceSql, `select pg_cancel_backend(pid) from pg_stat_activity where application_name='${contenderName}';`);
          await finish(contender, { expectedState: "57014" });
        } catch (error) {
          if (forbiddenWait || contender.exit?.code !== 0) throw error;
          await finish(contender);
        } finally {
          await finish(holder, { action: "rollback" });
        }
        assert.equal(forbiddenWait, false, "Suspension must never wait from an authority lock onto a dependent row");
        assert.deepEqual(result(contender), { status: "retry" });
        assert.equal(await observe(), before, "A contended later row must roll back the entire restriction/audit/work graph");
        const retried = JSON.parse((await harness.runSqlAfterSetup(paymentEvidenceSql, `begin; ${authorization} ${sql} commit;`)).split("\n").at(-1));
        assert.equal(retried.status, "completed");
        assert.equal(await harness.runSqlAfterSetup(paymentEvidenceSql, `select count(*) from private.marketplace_suspension_actions where command_id='90000000-0000-4000-8000-000000001096';`), "1");
        await clear();
      }
      for (const acceptFirst of [true, false]) {
        await reset();
        const suspendSql = command("customer", customerId, "suspend", 0, "90000000-0000-4000-8000-000000001095");
        const holder = await start(`begin; set application_name='suspension_accept_holder'; ${authorization} ${acceptFirst ? acceptSql : suspendSql} select 'SUSPENSION_DECISION_HELD';`);
        await harness.waitForMarker(holder, "SUSPENSION_DECISION_HELD");
        const contender = await start(`begin; set application_name='suspension_accept_contender'; ${authorization} ${acceptFirst ? suspendSql : acceptSql} commit;`, true);
        await blockedBy("suspension_accept_contender", contender, "suspension_accept_holder");
        if (acceptFirst) {
          assert.equal(await harness.runSqlAfterSetup(paymentEvidenceSql, `
            select count(*) from pg_locks locks
            join pg_stat_activity activity on activity.pid=locks.pid
            join public.account_contexts contexts on contexts.ctid=concat('(',locks.page,',',locks.tuple,')')::tid
            where activity.application_name='suspension_accept_contender'
              and locks.locktype='tuple' and locks.relation='public.account_contexts'::regclass
              and contexts.user_id='${customerId}';
          `), "1", "Acceptance may serialize the command at its primary customer target lock");
        }
        await finish(holder, { action: "commit" });
        await finish(contender);
        assert.equal(result(contender).status, acceptFirst ? "completed" : "release-required");
        assert.equal(await harness.runSqlAfterSetup(paymentEvidenceSql, `select status||'|'||(select count(*) from public.booking_request_release_work where booking_request_id=requests.id)||'|'||(select count(*) from public.booking_request_capture_work where booking_request_id=requests.id) from public.booking_requests requests where id='${requestId}';`), acceptFirst ? "accepted|0|1" : "processing|1|0");
        await clear();
      }
      await reset();
      const exactSql = command("customer", "10000000-0000-4000-8000-000000001003", "suspend", 0, "90000000-0000-4000-8000-000000001094");
      const holder = await start(`begin; set application_name='suspension_replay_holder'; ${authorization} ${exactSql} select 'SUSPENSION_REPLAY_HELD';`);
      await harness.waitForMarker(holder, "SUSPENSION_REPLAY_HELD");
      const contender = await start(`begin; set application_name='suspension_replay_contender'; ${authorization} ${exactSql} commit;`, true);
      await blockedBy("suspension_replay_contender", contender, "suspension_replay_holder");
      await finish(holder, { action: "commit" });
      await finish(contender);
      assert.equal(result(holder).status, "completed");
      assert.equal(result(contender).status, "completed");
      assert.equal(result(contender).actionId, result(holder).actionId);
      assert.equal(await harness.runSqlAfterSetup(paymentEvidenceSql, `select count(*) from private.marketplace_suspension_actions where command_id='90000000-0000-4000-8000-000000001094';`), "1");
      const reusedCommand = "90000000-0000-4000-8000-000000001093";
      const differentHolder = await start(`begin; set application_name='suspension_intent_holder'; ${authorization} ${command("customer", "10000000-0000-4000-8000-000000001003", "reactivate", 1, reusedCommand)} select 'SUSPENSION_INTENT_HELD';`);
      await harness.waitForMarker(differentHolder, "SUSPENSION_INTENT_HELD");
      const differentContender = await start(`begin; set application_name='suspension_intent_contender'; ${authorization} ${command("customer", customerId, "suspend", 0, reusedCommand)} commit;`, true);
      await blockedBy("suspension_intent_contender", differentContender, "suspension_intent_holder");
      await finish(differentHolder, { action: "commit" });
      await finish(differentContender);
      assert.deepEqual(result(differentContender), { status: "conflict" });
      assert.equal(await harness.runSqlAfterSetup(paymentEvidenceSql, `select customer_suspended||'|'||customer_suspension_revision from public.account_contexts where user_id='${customerId}';`), "false|0");
      const administrators = [administratorId, otherAdministratorId];
      const administratorSessions = [];
      for (const [index, actor] of administrators.entries()) {
        const session = await start(`begin; select 1 from public.account_contexts where user_id='${actor}' for share; select 'ADMINISTRATOR_CONTEXT_HELD';`);
        await harness.waitForMarker(session, "ADMINISTRATOR_CONTEXT_HELD");
        administratorSessions.push(session);
        if (index === 1) {
          for (const [position, active] of administratorSessions.entries()) {
            active.child.stdin.end(`set local request.jwt.claims='{"sub":"${administrators[position]}","role":"authenticated","aal":"aal2"}'; ${command("customer", administrators[1 - position], "suspend", 0, `90000000-0000-4000-8000-00000000109${position}`)} commit;`);
          }
        }
      }
      for (const session of administratorSessions) {
        await finish(session);
        assert.deepEqual(result(session), { status: "not-found" }, "Forbidden administrator targets must not form reciprocal upgrade waits");
      }
      await clear();
      await reset();
      const legacyHolder = await start(`begin; set application_name='suspension_legacy_holder'; ${authorization} select public.review_owner_application('${applicationId}',2,'suspend','Fictional concurrent restriction','{}','{}',null,null,null,'{}'); select 'LEGACY_SUSPENSION_HELD';`);
      await harness.waitForMarker(legacyHolder, "LEGACY_SUSPENSION_HELD");
      const legacyContender = await start(`begin; set application_name='suspension_legacy_contender'; ${authorization} ${command("owner", ownerId, "suspend", 2, "90000000-0000-4000-8000-000000001089")} commit;`, true);
      await blockedBy("suspension_legacy_contender", legacyContender, "suspension_legacy_holder");
      await finish(legacyHolder, { action: "commit" });
      await finish(legacyContender);
      assert.deepEqual(result(legacyContender), { status: "conflict" });
      assert.equal(await harness.runSqlAfterSetup(paymentEvidenceSql, `select applications.version||'|'||contexts.owner_suspension_revision||'|'||(select count(*) from private.marketplace_suspension_actions where target_kind='owner' and account_user_id='${ownerId}')||'|'||(select count(*) from public.owner_application_notices where application_id='${applicationId}' and kind='suspended')||'|'||(select count(*) from public.booking_request_release_work where booking_request_id='${requestId}') from public.owner_applications applications join public.account_contexts contexts on contexts.user_id=applications.owner_user_id where applications.id='${applicationId}';`), "3|1|1|1|1");
      await clear();
      console.log("Suspension real sessions proved complete multi-profile/request/attempt NOWAIT rollback, one reattempt, both acceptance orders, legacy-writer serialization, reciprocal forbidden admin targets and exact/altered command races.");
    } finally {
      if (seeded) await clear();
    }
  }
  async function proveOwnerAdmission(source) {
    const pending = pendingSource(source);
    const reset = async () => {
      harness.markTimingPhase("setup");
      try {
        await harness.runSqlAfterSetup(
          paymentEvidenceSql,
          `begin; ${pending} commit;`,
        );
        seeded = true;
      } finally {
        harness.markTimingPhase("execution");
      }
    };
    await reset();
    const admissions = await duplicate(acceptSql, "owner_accept");
    assert.deepEqual(admissions[0], admissions[1]);
    assert.equal(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select count(*) from public.booking_request_capture_work where booking_request_id = '${requestId}';`,
      ),
      "1",
    );
    const identity = await harness.runSqlAfterSetup(
      paymentEvidenceSql,
      `select to_jsonb(work) from public.booking_request_capture_work work where booking_request_id = '${requestId}';`,
    );
    await harness.runSqlAfterSetup(paymentEvidenceSql, acceptSql);
    assert.equal(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select to_jsonb(work) from public.booking_request_capture_work work where booking_request_id = '${requestId}';`,
      ),
      identity,
    );
    harness.markTimingPhase("setup");
    await harness.runSqlAfterSetup(paymentEvidenceSql, cleanup);
    harness.markTimingPhase("execution");
    seeded = false;

    for (const action of ["decline", "withdraw", "expire"]) {
      for (const acceptFirst of [true, false]) {
        await reset();
        if (action === "expire" && !acceptFirst)
          await harness.runSqlAfterSetup(
            paymentEvidenceSql,
            `update public.booking_requests set response_deadline = statement_timestamp(), created_at = statement_timestamp() - interval '4 hours' where id = '${requestId}';`,
          );
        const otherSql =
          action === "expire"
            ? `select public.claim_booking_request_expiry('${requestId}');`
            : `select public.claim_booking_request_action('${action === "withdraw" ? customerId : ownerId}', '${requestId}', '${action}', ${action === "decline" ? "'other'" : "null"});`;
        const holder = await start(
          `begin; set application_name = 'owner_decision_holder'; set local role service_role; ${acceptFirst ? acceptSql : otherSql} select 'DECISION_HELD';`,
        );
        await harness.waitForMarker(holder, "DECISION_HELD");
        const contender = await start(
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
          await harness.runSqlAfterSetup(
            paymentEvidenceSql,
            `select status from public.booking_requests where id = '${requestId}';`,
          ),
          acceptFirst ? "accepted" : "processing",
        );
        assert.equal(
          await harness.runSqlAfterSetup(
            paymentEvidenceSql,
            `select count(*) from public.booking_request_capture_work where booking_request_id = '${requestId}';`,
          ),
          acceptFirst ? "1" : "0",
        );
        assert.equal(
          await harness.runSqlAfterSetup(
            paymentEvidenceSql,
            `select count(*) from public.payment_provider_operations where operation_kind = 'capture';`,
          ),
          "0",
        );
        harness.markTimingPhase("setup");
        await harness.runSqlAfterSetup(paymentEvidenceSql, cleanup);
        harness.markTimingPhase("execution");
        seeded = false;
      }
    }
    await reset();
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
      const holder = await start(
        `begin; set application_name = 'owner_account_holder'; update public.account_contexts set ${change} where user_id = '${ownerId}'; select 'ACCOUNT_HELD';`,
      );
      await harness.waitForMarker(holder, "ACCOUNT_HELD");
      const contender = await start(
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
        await harness.runSqlAfterSetup(
          paymentEvidenceSql,
          `select count(*) from public.booking_request_capture_work where booking_request_id = '${requestId}';`,
        ),
        "0",
      );
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `update public.account_contexts set role = 'cottage_owner', owner_approval_state = 'approved' where user_id = '${ownerId}';`,
      );
    }
    const holder = await start(
      `begin; set application_name = 'owner_deadline_holder'; update public.booking_requests set response_deadline = statement_timestamp() + interval '2 seconds', created_at = statement_timestamp() - interval '4 hours' + interval '2 seconds' where id = '${requestId}'; select 'DEADLINE_HELD';`,
    );
    await harness.waitForMarker(holder, "DEADLINE_HELD");
    const contender = await start(
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
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select status from public.booking_requests where id = '${requestId}';`,
      ),
      "processing",
    );
    assert.equal(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select count(*) from public.booking_request_capture_work where booking_request_id = '${requestId}';`,
      ),
      "0",
    );
    harness.markTimingPhase("setup");
    await harness.runSqlAfterSetup(paymentEvidenceSql, cleanup);
    harness.markTimingPhase("execution");
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
    const seedSql = (index) =>
      `begin; ${clone(pending, index)} ${clone(acceptSql, index)} commit;`;
    const expireSql = (index) =>
      `update public.booking_request_capture_work set lease_expires_at = clock_timestamp() where booking_request_id = '${clone(requestId, index)}';`;
    try {
      harness.markTimingPhase("setup");
      await harness.runStatementsAfterSetup(
        paymentEvidenceSql,
        indexes
          .slice(0, -1)
          .flatMap((index) => [
            seedSql(index),
            clone(leaseSql, index),
            expireSql(index),
          ]),
      );
      const last = indexes.at(-1);
      await harness.runSqlAfterSetup(paymentEvidenceSql, seedSql(last));
      const leased = JSON.parse(
        await harness.runSqlAfterSetup(
          paymentEvidenceSql,
          clone(leaseSql, last),
        ),
      );
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select pg_temp.capture_execute(${literal(leased.permit)});`,
      );
      await harness.runSqlAfterSetup(paymentEvidenceSql, expireSql(last));
      harness.markTimingPhase("execution");
      const unavailableBefore = await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select jsonb_agg(to_jsonb(work) order by booking_request_id) from public.booking_request_capture_work work where recovery_operation_id is null and booking_request_id <> '${clone(requestId, indexes.at(-1))}';`,
      );
      const recovered = JSON.parse(
        await harness.runSqlAfterSetup(
          paymentEvidenceSql,
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
        await harness.runSqlAfterSetup(
          paymentEvidenceSql,
          `select jsonb_agg(to_jsonb(work) order by booking_request_id) from public.booking_request_capture_work work where recovery_operation_id is null and booking_request_id <> '${clone(requestId, indexes.at(-1))}';`,
        ),
        unavailableBefore,
        "Missing execution must never renew ownership",
      );
      console.log(
        "Recovery selected later exact provider evidence beyond a full unavailable batch without renewing missing-evidence ownership.",
      );
    } finally {
      harness.markTimingPhase("cleanup");
      await harness.runStatementsAfterSetup(
        paymentEvidenceSql,
        indexes.map((index) =>
          captureCleanup({ stem: String(200 + Number(index)) }),
        ),
      );
    }
    harness.markTimingPhase("execution");
  }

  async function proveCaptureProcessing(source) {
    for (const mode of [
      "process",
      "process-lose-response",
      "process-interrupt-confirmation",
    ]) {
      harness.markTimingPhase("setup");
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `begin; ${pendingSource(source)} ${acceptSql} commit;`,
      );
      harness.markTimingPhase("execution");
      seeded = true;
      const admitted = await observeRecovery();
      if (mode === "process") {
        const clients = [startWorker(mode), startWorker(mode)];
        await Promise.all(clients.map(finishWorker));
      } else {
        assert.deepEqual(await finishWorker(startWorker(mode)), [
          { status: "unavailable" },
        ]);
        const interrupted = await observeRecovery();
        assert.equal(interrupted.ledger.length, 1);
        assert.equal(interrupted.confirmations.length, 0);
        assert.equal(interrupted.receipts.length, 0);
        if (mode === "process-lose-response") await expireCaptureLease();
        const result = await finishWorker(startWorker("process"));
        assert.equal(result[0].status, "confirmed");
      }
      const confirmed = await observeRecovery();
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
        await observeRecovery(),
        confirmed,
        "Repeated processing must preserve all durable identities",
      );
      harness.markTimingPhase("setup");
      await harness.runSqlAfterSetup(paymentEvidenceSql, cleanup);
      harness.markTimingPhase("execution");
      seeded = false;
    }
    console.log(
      "Composed processing confirmed newly admitted work through two competing clients and recovered both response-loss and confirmation interruption: one physical capture, one confirmation, two receipts and five unchanged occupancies.",
    );
  }

  async function provePaymentOrchestration() {
    harness.markTimingPhase("setup");
    const source = readFileSync(
      "supabase/tests/database/booking_request_payment_recovery.test.sql",
      "utf8",
    )
      .split("select plan(")[0]
      .replace(/^begin;/, "");
    const recoveryCleanup = captureCleanup({ paymentRecovery: true });
    harness.markTimingPhase("execution");
    const seed = async () => {
      harness.markTimingPhase("setup");
      try {
        await harness.runSqlAfterSetup(
          paymentEvidenceSql,
          `begin;${source}commit;`,
        );
        seeded = true;
        paymentRecoverySeeded = true;
        return JSON.parse(
          harness.runSql(
            `set request.jwt.claim.sub='10000000-0000-4000-8000-000000001002';set role authenticated;select public.claim_customer_booking_request_payment_recovery('${requestId}','81000000-0000-4000-8000-000000001001','simulated-replacement');`,
          ),
        );
      } finally {
        harness.markTimingPhase("execution");
      }
    };
    const clear = async () => {
      harness.markTimingPhase("setup");
      try {
        await harness.runSqlAfterSetup(paymentEvidenceSql, recoveryCleanup);
        seeded = false;
        paymentRecoverySeeded = false;
      } finally {
        harness.markTimingPhase("execution");
      }
    };
    const state = async () =>
      JSON.parse(
        await harness.runSqlAfterSetup(
          paymentEvidenceSql,
          `select jsonb_build_object(
    'attempts',(select jsonb_agg(to_jsonb(v) order by generation) from public.booking_request_payment_recovery_attempts v),
    'operations',(select jsonb_agg(pg_temp.payment_fixture_operation_json(v) order by created_at,id) from public.payment_provider_operations v where recovery_attempt_id is not null or operation_kind='refund'),
    'effects',(select coalesce(sum(e.physical_execution_count),0) from public.simulated_payment_effects e join public.payment_provider_operations l on l.id=e.operation_id where l.recovery_attempt_id is not null or l.operation_kind='refund'),
    'active',(select count(*) from public.cottage_booking_period_occupancies where active),
    'confirmations',(select count(*) from public.booking_confirmations),
    'receipts',(select count(*) from public.booking_receipts),
    'invalidations',(select count(*) from public.booking_request_confirmation_invalidations),
    'request',(select status from public.booking_requests where id='${requestId}'),
    'expiry',(select state from public.booking_request_payment_required_expiry_work where booking_request_id='${requestId}'),
    'targets',(select coalesce(jsonb_agg(to_jsonb(v) order by id),'[]') from public.booking_request_payment_required_expiry_operations v),
    'notices',(select count(*) from public.booking_request_status_notifications where status='expired'));`,
        ),
      );
    const stop = async (worker) => {
      harness.markTimingPhase("cleanup");
      try {
        worker.child.kill("SIGTERM");
        await worker.exited;
        workers.delete(worker);
      } finally {
        harness.markTimingPhase("execution");
      }
    };
    const inquiryFirst = await seed();
    const beforeInquiry = await state();
    const heldOccupancies = (await observeRecovery()).occupancies;
    const delayedExecutor = startWorker("payment-recovery", requestId, {
      PAYMENT_RECOVERY_ATTEMPT_ID: inquiryFirst.attemptId,
      PAYMENT_WORKER_PAUSE: "admitted",
      PAYMENT_WORKER_PAUSE_KIND: "release",
    });
    await stage(delayedExecutor, "admitted-paused");
    const inquiryResult = await finishWorker(
      startWorker("payment-recovery", requestId, {
        PAYMENT_RECOVERY_ATTEMPT_ID: inquiryFirst.attemptId,
      }),
    );
    delayedExecutor.child.send("continue");
    const delayedResult = await finishWorker(delayedExecutor);
    assert.deepEqual(
      [inquiryResult.status, delayedResult.status],
      ["blocked", "blocked"],
    );
    const closed = await state();
    assert.equal(closed.effects, 0);
    assert.equal(closed.operations.length, 1);
    const closedOperation = closed.operations[0];
    assert.equal(closedOperation.operation_kind, "release");
    assert.equal(closedOperation.current_outcome, "not-executed");
    assert.equal(closedOperation.physical_execution_count, 0);
    assert.deepEqual(
      [
        closedOperation.provider_request_id,
        closedOperation.provider_reference,
        closedOperation.movement_reference,
      ],
      [null, null, null],
    );
    const closedEffectSql = `select to_jsonb(effect) from public.simulated_payment_effects effect where operation_id='${closedOperation.id}';`;
    const closedEffect = JSON.parse(harness.runSql(closedEffectSql));
    assert.equal(closedEffect.state, "closed-not-executed");
    assert.equal(closedEffect.physical_execution_count, 0);
    assert.equal(closedEffect.result.outcome, "not-executed");
    assert.ok(closedEffect.result.evidence.closedAt);
    assert.equal(closedEffect.result.evidence.executedAt, null);
    assert.equal(closedEffect.result.evidence.occurredAt, null);
    for (const reference of [
      "providerRequestId",
      "providerReference",
      "movementReference",
    ]) {
      assert.equal(reference in closedEffect.result, false);
    }
    assert.deepEqual(closed.attempts, beforeInquiry.attempts);
    assert.equal(closed.attempts[0].state, "admitted");
    assert.equal(closed.request, "accepted");
    assert.equal(closed.active, 5);
    assert.deepEqual((await observeRecovery()).occupancies, heldOccupancies);
    assert.equal(closed.confirmations, 0);
    assert.equal(closed.receipts, 0);
    assert.equal(closed.expiry, null);
    assert.deepEqual(closed.targets, []);
    assert.equal(closed.notices, 0);
    assert.equal(
      (
        await finishWorker(
          startWorker("payment-recovery", requestId, {
            PAYMENT_RECOVERY_ATTEMPT_ID: inquiryFirst.attemptId,
          }),
        )
      ).status,
      "blocked",
    );
    assert.deepEqual(await state(), closed);
    assert.deepEqual(JSON.parse(harness.runSql(closedEffectSql)), closedEffect);
    await clear();

    const concurrent = await seed();
    const confirming = startWorker("payment-recovery", requestId, {
      PAYMENT_RECOVERY_ATTEMPT_ID: concurrent.attemptId,
      PAYMENT_WORKER_PAUSE: "confirmation",
    });
    await stage(confirming, "confirmation-paused");
    const confirmationReplay = await finishWorker(
      startWorker("payment-recovery", requestId, {
        PAYMENT_RECOVERY_ATTEMPT_ID: concurrent.attemptId,
      }),
    );
    confirming.child.send("continue");
    const competing = [await finishWorker(confirming), confirmationReplay];
    assert.deepEqual(
      competing.map(({ status }) => status),
      ["succeeded", "succeeded"],
    );
    const converged = await state();
    assert.equal(converged.effects, 3);
    assert.equal(converged.confirmations, 1);
    assert.equal(converged.receipts, 2);
    assert.equal(converged.active, 5);
    assert.ok(
      converged.operations.every(
        ({ physical_execution_count }) => physical_execution_count === 1,
      ),
    );
    const capture = converged.operations.find(
      ({ operation_kind }) => operation_kind === "capture",
    );
    const conflicting = {
      receiptId: "runtime-conflicting-amount",
      bookingRequestId: requestId,
      providerOperationId: capture.id,
      providerIdentity,
      paymentLifecycleId: capture.payment_lifecycle_id,
      logicalOperationId: capture.logical_operation_id,
      physicalAttemptId: capture.physical_attempt_id,
      kind: "capture",
      amountFils: 110000000,
      currency: "IQD",
      providerRequestId: capture.provider_request_id,
      providerReference: capture.provider_reference,
      movementReference: capture.movement_reference,
      outcome: "succeeded",
      occurredAt: capture.authoritative_outcome_at,
    };
    assert.equal(
      (
        await finishWorker(
          startWorker("payment-correction", requestId, {
            PAYMENT_CORRECTION_RECEIPT: JSON.stringify(conflicting),
          }),
        )
      ).status,
      "quarantined",
    );
    const invalidated = await state();
    assert.equal(invalidated.invalidations, 1);
    assert.equal(invalidated.confirmations, 1);
    assert.equal(invalidated.receipts, 2);
    assert.equal(invalidated.active, 5);
    assert.equal(invalidated.effects, 3);
    assert.deepEqual(invalidated.operations, converged.operations);
    await clear();
    for (const interruption of [
      "admitted",
      "effect",
      "recorded",
      "confirmation",
    ]) {
      const admission = await seed();
      const env = { PAYMENT_RECOVERY_ATTEMPT_ID: admission.attemptId };
      const first = startWorker("payment-recovery", requestId, {
        ...env,
        PAYMENT_WORKER_PAUSE: interruption,
        PAYMENT_WORKER_PAUSE_KIND:
          interruption === "confirmation" ? "" : "capture",
      });
      await stage(
        first,
        interruption === "confirmation"
          ? "confirmation"
          : interruption + "-paused",
      );
      const interrupted = await state();
      assert.equal(interrupted.confirmations, 0);
      assert.equal(interrupted.active, 5);
      await stop(first);
      const result = await finishWorker(
        startWorker("payment-recovery", requestId, env),
      );
      const recovered = await state();
      assert.equal(
        result.status,
        interruption === "admitted" ? "blocked" : "succeeded",
      );
      assert.equal(recovered.active, 5);
      assert.equal(
        recovered.confirmations,
        interruption === "admitted" ? 0 : 1,
      );
      assert.equal(recovered.receipts, interruption === "admitted" ? 0 : 2);
      assert.equal(recovered.effects, interruption === "admitted" ? 2 : 3);
      assert.deepEqual(
        recovered.operations.map(({ id }) => id).sort(),
        interrupted.operations.map(({ id }) => id).sort(),
      );
      if (interruption === "admitted")
        assert.equal(
          recovered.operations.find(
            ({ operation_kind }) => operation_kind === "capture",
          ).current_outcome,
          "not-executed",
        );
      else {
        assert.equal(
          (await finishWorker(startWorker("payment-recovery", requestId, env)))
            .status,
          "succeeded",
        );
        assert.deepEqual(await state(), recovered);
      }
      await clear();
    }
    console.log(
      "Production recovery resumes across admission, effect, recording and confirmation interruptions: the same operation identities, definitive absence versus success, at most three effects, one confirmation and two receipts.",
    );

    harness.markTimingPhase("setup");
    const definitions = [];
    const frozen = (deadline) =>
      definitions.map((definition) =>
        definition.replaceAll(
          "clock_timestamp()",
          `'${deadline}'::timestamptz`,
        ),
      );
    const unobserved = readFileSync(
      "supabase/tests/database/booking_request_payment_correction.test.sql",
      "utf8",
    )
      .split("-- BEGIN UNOBSERVED RECOVERY FIXTURE")[1]
      .split("-- END UNOBSERVED RECOVERY FIXTURE")[0];
    harness.markTimingPhase("execution");
    try {
      for (const interruption of ["admitted", "effect", "recorded"]) {
        const admission = await seed();
        // Arrange only two explicitly selected predecessor operations; the passive and expiry journeys use production services.
        await harness.runSqlAfterSetup(
          paymentEvidenceSql,
          `set role service_role;
        select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step('${admission.attemptId}','original-release','admitted')->'permit','succeeded','original_released');
        select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step('${admission.attemptId}','replacement-authorization','original_released')->'permit','succeeded','replacement_authorized');`,
        );
        const permit = JSON.parse(
          harness.runSql(
            `set role service_role;select public.lease_booking_request_payment_recovery_step('${admission.attemptId}','replacement-capture','replacement_authorized')->'permit';`,
          ),
        );
        if (!definitions.length) {
          const result = JSON.parse(
            harness.runSql(
              `select jsonb_agg(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.prosrc like '%clock_timestamp()%' and (p.proname like '%booking_request%' or p.proname in ('persist_simulated_payment_effect','seal_simulated_payment_absence','resolve_simulated_payment_effect','validate_payment_provider_observation','accept_payment_provider_observation','simulated_payment_absence_receipt'));`,
            ),
          );
          definitions.push(...result);
        }
        harness.markTimingPhase("setup");
        const receipt = JSON.parse(
          await harness.runSqlAfterSetup(
            paymentEvidenceSql,
            unobserved +
              `select pg_temp.seed_unobserved_payment_outcome(${literal(permit)},'succeeded','${admission.deadline}'::timestamptz);`,
          ),
        );
        harness.markTimingPhase("execution");
        harness.markTimingPhase("setup");
        await harness.runStatementsAfterSetup(
          paymentEvidenceSql,
          frozen(admission.deadline),
        );
        harness.markTimingPhase("execution");
        const now = admission.deadline;
        assert.equal(
          (
            await finishWorker(
              startWorker("payment-correction", requestId, {
                PAYMENT_CORRECTION_RECEIPT: JSON.stringify(receipt),
                PAYMENT_WORKER_NOW: now,
              }),
            )
          ).status,
          "recorded",
        );
        const owned = await state();
        assert.equal(owned.confirmations, 0);
        assert.equal(
          owned.targets.filter(
            ({ operation_kind }) => operation_kind === "refund",
          ).length,
          1,
        );
        assert.equal(owned.active, 5);
        const first = startWorker("payment-expiry", requestId, {
          PAYMENT_WORKER_NOW: now,
          PAYMENT_WORKER_PAUSE: interruption,
          PAYMENT_WORKER_PAUSE_KIND: "refund",
        });
        await stage(first, interruption + "-paused");
        const interrupted = await state();
        await stop(first);
        const finished = await finishWorker(
          startWorker("payment-expiry", requestId, { PAYMENT_WORKER_NOW: now }),
        );
        const after = await state();
        assert.equal(
          after.operations.filter(
            ({ operation_kind }) => operation_kind === "refund",
          ).length,
          1,
        );
        assert.equal(
          after.operations.filter(
            ({ operation_kind }) => operation_kind === "release",
          ).length,
          1,
        );
        if (interruption === "admitted") {
          assert.equal(finished.status, "quarantined");
          assert.equal(after.active, 5);
          assert.equal(after.effects, 3);
          assert.equal(
            after.operations.find(
              ({ operation_kind }) => operation_kind === "refund",
            ).current_outcome,
            "not-executed",
          );
        } else {
          assert.equal(finished.status, "expired");
          assert.equal(after.active, 0);
          assert.equal(after.notices, 2);
          assert.equal(after.effects, 4);
          assert.deepEqual(
            after.targets.map(({ id }) => id).sort(),
            interrupted.targets.map(({ id }) => id).sort(),
          );
          assert.equal(
            (
              await finishWorker(
                startWorker("payment-expiry", requestId, {
                  PAYMENT_WORKER_NOW: now,
                }),
              )
            ).status,
            "expired",
          );
          assert.deepEqual(await state(), after);
        }
        harness.markTimingPhase("setup");
        await harness.runStatementsAfterSetup(paymentEvidenceSql, definitions);
        harness.markTimingPhase("execution");
        await clear();
      }
      const invalid = await seed();
      harness.markTimingPhase("setup");
      await harness.runStatementsAfterSetup(
        paymentEvidenceSql,
        frozen(invalid.deadline),
      );
      harness.markTimingPhase("execution");
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `set role service_role;
      select pg_temp.expiry_execute(pg_temp.expiry_prepare('${requestId}',${literal(providerIdentity)},
        '{"action":"release","authorizationLifecycleId":"73000000-0000-4000-8000-000000001001","recoveryOperationId":null}')->'permit','succeeded');
      reset role;alter table public.payment_provider_operations disable trigger guard_payment_provider_admission;
      update public.payment_provider_operations set amount_fils=110000000 where operation_kind='release';
      alter table public.payment_provider_operations enable trigger guard_payment_provider_admission;`,
      );
      assert.equal(
        (
          await finishWorker(
            startWorker("payment-expiry", requestId, {
              PAYMENT_WORKER_NOW: invalid.deadline,
            }),
          )
        ).status,
        "quarantined",
      );
      assert.equal((await state()).expiry, "quarantined");
      assert.equal((await state()).active, 5);
      assert.equal((await state()).notices, 0);
      harness.markTimingPhase("setup");
      await harness.runStatementsAfterSetup(paymentEvidenceSql, definitions);
      harness.markTimingPhase("execution");
      await clear();
    } finally {
      harness.markTimingPhase("cleanup");
      await harness.runStatementsAfterSetup(paymentEvidenceSql, definitions);
    }
    harness.markTimingPhase("execution");
    console.log(
      "Production passive correction atomically owns the late-capture refund; expiry resumes across refund admission, effect and recording interruptions with one refund identity, no captured-authorization release, and inventory released only after proof.",
    );
  }

  let paymentRecoverySeeded = false;
  let seeded = false;
  const cleanup = captureCleanup();

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
    harness.markTimingPhase("setup");
    await harness.runSqlAfterSetup(
      paymentEvidenceSql,
      `begin; ${fixture} commit;`,
    );
    harness.markTimingPhase("execution");
    seeded = true;

    const [leased, processing] = await duplicate(leaseSql, "lease");
    assert.equal(leased.status, "leased");
    assert.deepEqual(processing, { status: "processing" });
    assert.equal(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        "select count(*) from public.payment_provider_operations where operation_kind = 'capture';",
      ),
      "0",
      "Committed leasing must precede provider execution",
    );
    // Contention proofs use a fixed fixture deadline after observing the real lease.
    const permit = { ...leased.permit, notAfter: "2100-01-01T00:00:00.000Z" };
    await harness.runSqlAfterSetup(
      paymentEvidenceSql,
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
      JSON.parse(await harness.runSqlAfterSetup(paymentEvidenceSql, leaseSql)),
      completed,
      "Completed leasing must replay evidence without another provider call",
    );
    assert.equal(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select count(*) || ':' || sum((select effect.physical_execution_count from public.simulated_payment_effects effect where effect.operation_id=payment_provider_operations.id)) from public.payment_provider_operations where operation_kind = 'capture' and payment_lifecycle_id = '${permit.paymentLifecycleId}';`,
      ),
      "1:1",
    );
    assert.equal(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select count(*) from public.booking_request_provider_operation_identities where attempt_id = '${permit.submissionAttemptId}' and operation_kind = 'capture';`,
      ),
      "1",
    );
    assert.equal(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select jsonb_array_length(jsonb_path_query_array(payment_snapshot, '$.movements[*] ? (@.kind == "capture")')) from public.booking_request_submission_attempts where id = '${permit.submissionAttemptId}';`,
      ),
      "1",
    );
    harness.markTimingPhase("setup");
    await harness.runSqlAfterSetup(paymentEvidenceSql, cleanup);
    harness.markTimingPhase("execution");
    seeded = false;

    harness.markTimingPhase("setup");
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
    harness.markTimingPhase("setup");
    await harness.runSqlAfterSetup(
      paymentEvidenceSql,
      `begin; ${confirmationFixture} commit;`,
    );
    harness.markTimingPhase("execution");
    seeded = true;
    const captureSnapshot = JSON.parse(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
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
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select count(*) || ':' || (select count(*) from public.booking_receipts) || ':' || (select count(*) from public.cottage_booking_period_commitments where status = 'confirmed_booking') from public.booking_confirmations;`,
      ),
      "1:2:1",
      "Concurrent finalization must persist one confirmation, two receipts, and one promoted commitment",
    );
    assert.equal(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select count(*) from public.cottage_booking_period_occupancies where booking_period_commitment_id = '50000000-0000-4000-8000-000000001001' and active;`,
      ),
      "5",
      "Concurrent finalization must retain every selected Shift occupancy",
    );
    assert.equal(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select count(*) from public.booking_request_release_work where booking_request_id = '${requestId}';`,
      ),
      "0",
      "Successful finalization must not create release work",
    );
    const confirmedFacts = () => harness.runSqlAfterSetup(paymentEvidenceSql, `
      select jsonb_build_object(
        'request',(select to_jsonb(requests) from public.booking_requests requests where id='${requestId}'),
        'confirmation',(select to_jsonb(confirmations) from public.booking_confirmations confirmations where booking_request_id='${requestId}'),
        'receipts',(select jsonb_agg(to_jsonb(receipts) order by id) from public.booking_receipts receipts where booking_confirmation_id in (select id from public.booking_confirmations where booking_request_id='${requestId}')),
        'snapshot',(select to_jsonb(snapshots) from public.booking_snapshots snapshots where id='40000000-0000-4000-8000-000000001001'),
        'hold',(select to_jsonb(commitments) from public.cottage_booking_period_commitments commitments where id='50000000-0000-4000-8000-000000001001'),
        'occupancies',(select jsonb_agg(to_jsonb(occupancies) order by to_jsonb(occupancies)::text) from public.cottage_booking_period_occupancies occupancies where booking_period_commitment_id='50000000-0000-4000-8000-000000001001'),
        'provider',(select jsonb_agg(to_jsonb(operations) order by id) from public.payment_provider_operations operations where payment_lifecycle_id='73000000-0000-4000-8000-000000001001')
      );
    `);
    const confirmedBeforeRestriction = await confirmedFacts();
    await harness.runSqlAfterSetup(paymentEvidenceSql, `
      update public.account_contexts set role='platform_administrator' where user_id='10000000-0000-4000-8000-000000001003';
    `);
    for (const [action, revision, commandId] of [
      ["suspend", 0, "90000000-0000-4000-8000-000000001087"],
      ["reactivate", 1, "90000000-0000-4000-8000-000000001088"],
    ]) {
      const changed = JSON.parse((await harness.runSqlAfterSetup(paymentEvidenceSql, `begin;
        set local role authenticated;
        select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000001003","role":"authenticated","aal":"aal2"}',true);
        select public.set_marketplace_suspension('customer','${customerId}','${action}',${revision},'Confirmed obligations and history remain intact','${commandId}'); commit;
      `)).split("\n").at(-1));
      assert.equal(changed.status, "completed");
      assert.equal(await confirmedFacts(), confirmedBeforeRestriction,
        "Suspension/reactivation must preserve captured money, confirmed receipt IDs/content and complete occupancy");
      assert.equal(await harness.runSqlAfterSetup(paymentEvidenceSql,
        `select count(*) from public.booking_request_release_work where booking_request_id='${requestId}';`), "0");
    }
    console.log(
      "Booking Request Capture contention proved one lease, one physical provider execution, one Capture identity and movement, exact replay, ordered locks for all three entry points through the completed Capture identity, and admission refusal after a blocked deadline. Confirmation contention then proved one identical outcome, two receipts, retained complete occupancy, no release work, and the same ordered Capture lock prefix through the commitment.",
    );
    harness.markTimingPhase("setup");
    await harness.runSqlAfterSetup(paymentEvidenceSql, cleanup);
    harness.markTimingPhase("execution");
    seeded = false;
    const recoverySource = confirmationSource
      .split("-- BEGIN CAPTURE RECOVERY SOURCE\n")[1]
      ?.split("-- END CAPTURE RECOVERY SOURCE")[0];
    assert.ok(
      recoverySource,
      "Capture recovery needs the complete source-only fixture",
    );
    await proveSuspensionFixtureCleanup(recoverySource);
    await proveMarketplaceSuspension(recoverySource);
    await proveOwnerAdmission(recoverySource);
    await proveRecoveryProgress(recoverySource);
    await proveApplicationRecovery(recoverySource);
    await proveFailureRecording(recoverySource);
    await proveApplicationFailureRecovery(recoverySource);
    await proveCaptureProcessing(recoverySource);
    await proveIndeterminateCaptureRecovery(recoverySource);
    await provePaymentOrchestration();
  } finally {
    harness.markTimingPhase("cleanup");
    for (const worker of workers) worker.child.kill("SIGTERM");
    await Promise.all([...workers].map((worker) => worker.exited));
    rmSync(temporaryDirectory, { recursive: true, force: true });
    for (const session of sessions) {
      if (!session.child.stdin.destroyed && !session.child.stdin.writableEnded)
        session.child.stdin.end("rollback;\n");
    }
    await Promise.all([...sessions].map((session) => session.exited));
    if (seeded)
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        paymentRecoverySeeded
          ? captureCleanup({ paymentRecovery: true })
          : cleanup,
      );
  }
  timingOutcome = "passed";
} finally {
  harness.finishTiming({ outcome: timingOutcome, cleanupDisposition: "local" });
}
