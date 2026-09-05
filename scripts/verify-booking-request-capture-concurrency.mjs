import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

async function proveLockOrder(sql, label) {
  for (let index = 0; index < rows.length - 1; index++) {
    const [rowName, row] = rows[index];
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
    for (const [laterName, laterRow] of rows.slice(index + 1)) {
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
        `begin; select 1 from ${rows[1][1]} for update; select 1 from ${row} for update nowait;`,
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

let seeded = false;
const cleanup = `begin;
  delete from public.booking_request_capture_work where booking_request_id = '${requestId}';
  delete from public.simulated_payment_provider_operations where claim_id = '72000000-0000-4000-8000-000000001001';
  delete from public.booking_request_provider_operation_identities where attempt_id = '70000000-0000-4000-8000-000000001001';
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
  delete from public.account_contexts where user_id in ('10000000-0000-4000-8000-000000001001', '10000000-0000-4000-8000-000000001002');
  delete from auth.users where id in ('10000000-0000-4000-8000-000000001001', '10000000-0000-4000-8000-000000001002');
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
  console.log(
    "Booking Request Capture contention proved one lease, one physical provider execution, one Capture identity and movement, exact replay, ordered locks for all three entry points through the completed Capture identity, and admission refusal after a blocked deadline.",
  );
} finally {
  for (const session of sessions) {
    if (!session.child.stdin.destroyed && !session.child.stdin.writableEnded)
      session.child.stdin.end("rollback;\n");
  }
  await Promise.all([...sessions].map((session) => session.exited));
  if (seeded) harness.runSql(cleanup);
}
