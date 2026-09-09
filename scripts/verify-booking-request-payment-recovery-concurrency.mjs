// SQL arrangement mirrors admission, isolated effect, and explicit recording.
const paymentEvidenceSql =
  "-- BEGIN PAYMENT EVIDENCE FIXTURE\n" +
  readFileSync("supabase/fixtures/payment-evidence.sql", "utf8") +
  "\n-- END PAYMENT EVIDENCE FIXTURE\n";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
import { withPaymentRecoveryCleanup } from "../tests/fixtures/payment-recovery-cleanup.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
const requestId = "60000000-0000-4000-8000-000000001001";
const customer = "10000000-0000-4000-8000-000000001002";
const key = "81000000-0000-4000-8000-000000001001";
const sqlJson = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const unobservedRecoveryFixture = readFileSync(
  "supabase/tests/database/booking_request_payment_correction.test.sql",
  "utf8",
)
  .split("-- BEGIN UNOBSERVED RECOVERY FIXTURE")[1]
  .split("-- END UNOBSERVED RECOVERY FIXTURE")[0];
const delayedObservationSql = (permit, occurrence) => {
  const receipt = JSON.parse(
    harness.runSql(
      paymentEvidenceSql +
        (unobservedRecoveryFixture +
          `select pg_temp.seed_unobserved_payment_outcome(${sqlJson(permit)},'succeeded',${occurrence});`),
    ),
  );
  return `select public.observe_booking_request_payment_correction('${requestId}','${receipt.providerOperationId}',${sqlJson(receipt)});`;
};
const service = (sql) =>
  harness.runSql(paymentEvidenceSql + `set role service_role; ${sql}`);
const parsed = (sql) => JSON.parse(service(sql));
const admitSql = (command) =>
  `select public.claim_customer_booking_request_payment_recovery('${requestId}','${command}','simulated-replacement');`;
const authenticated = (sql) =>
  `select set_config('request.jwt.claim.sub','${customer}',false); set role authenticated; ${sql}`;
const admit = (command = key) =>
  JSON.parse(
    harness
      .runSql(paymentEvidenceSql + authenticated(admitSql(command)))
      .split("\n")
      .at(-1),
  );
const lease = (id) =>
  parsed(`select public.lease_booking_request_payment_recovery_step('${id}');`);
const executeSql = (permit, outcome = "succeeded") =>
  `select pg_temp.recovery_execute(${sqlJson(permit)},'${outcome}');`;
const execute = (permit, outcome) => parsed(executeSql(permit, outcome));
const finalizeSql = (id) =>
  `select public.finalize_booking_request_confirmation('${requestId}',public.get_booking_request_payment_recovery_confirmation_evidence('${id}'));`;
const fixture = readFileSync(
  "supabase/tests/database/booking_request_payment_recovery.test.sql",
  "utf8",
)
  .split("select plan(")[0]
  .replace(/^begin;/, "");
const cleanup = withPaymentRecoveryCleanup(
  readFileSync("scripts/verify-booking-request-capture-concurrency.mjs", "utf8")
    .split("const cleanup = `")[1]
    .split("`;\n")[0]
    .replaceAll("${requestId}", requestId),
  requestId,
);
const sessions = new Set();
function start(sql, close = false) {
  const session = harness.startSession(paymentEvidenceSql + sql, close);
  sessions.add(session);
  return session;
}
async function finish(session, options) {
  await harness.finishSession(session, options);
  sessions.delete(session);
}
const result = (session) =>
  JSON.parse(session.stdout.split("\n").find((line) => line.startsWith("{")));
async function duplicate(sql, label) {
  const held = start(
    `begin;set application_name='recovery_${label}_holder';set role service_role;${sql}select 'RECOVERY_HELD';`,
  );
  await harness.waitForMarker(held, "RECOVERY_HELD");
  const contender = start(
    `begin;set application_name='recovery_${label}_contender';set role service_role;${sql}commit;`,
    true,
  );
  await harness.waitForLock(`recovery_${label}_contender`, contender);
  await finish(held, { action: "commit" });
  await finish(contender);
  assert.deepEqual(
    result(contender),
    result(held),
    `${label} must replay the same durable result`,
  );
  return result(held);
}
const clockSignatures = [
  "claim_customer_booking_request_payment_recovery(uuid,uuid,text)",
  "lease_booking_request_payment_recovery_step(uuid)",
  "persist_simulated_payment_effect(jsonb,jsonb)",
  "resolve_simulated_payment_effect(jsonb,text,jsonb)",
  "seal_simulated_payment_absence(jsonb)",
  "validate_payment_provider_observation(jsonb,uuid)",
  "accept_payment_provider_observation(uuid,jsonb)",
  "admit_booking_request_payment_recovery(jsonb)",
  "reload_booking_request_payment_operation(jsonb,text,text)",
  "finalize_booking_request_confirmation(uuid,jsonb)",
  "booking_request_payment_recovery_status(public.booking_requests)",
  "observe_booking_request_payment_correction(uuid,uuid,jsonb)",
];
const definitions = [];
let seeded = false;
const snapshot = () =>
  JSON.parse(
    harness.runSql(
      paymentEvidenceSql +
        `select jsonb_build_object(
  'original',(select to_jsonb(work) from public.booking_request_capture_work work where booking_request_id='${requestId}'),
  'confirmation',(select to_jsonb(confirmation) from public.booking_confirmations confirmation where booking_request_id='${requestId}'),
  'receipts',(select jsonb_agg(to_jsonb(receipt) order by receipt.id) from public.booking_receipts receipt where booking_confirmation_id in (select id from public.booking_confirmations where booking_request_id='${requestId}')),
  'inventory',(select jsonb_agg(to_jsonb(inventory) order by inventory.id) from public.cottage_inventory_commitments inventory where booking_period_commitment_id in (select booking_period_commitment_id from public.booking_requests where id='${requestId}')),
  'occupancies',(select jsonb_agg(to_jsonb(occupancy) order by occupancy.shift_id,occupancy.service_day) from public.cottage_booking_period_occupancies occupancy where booking_period_commitment_id in (select booking_period_commitment_id from public.booking_requests where id='${requestId}')),
  'physical',(select sum((select effect.physical_execution_count from public.simulated_payment_effects effect where effect.operation_id=payment_provider_operations.id)) from public.payment_provider_operations where recovery_attempt_id in (select id from public.booking_request_payment_recovery_attempts where booking_request_id='${requestId}')));`,
    ),
  );
const clock = (expression) =>
  harness.runSql(
    paymentEvidenceSql +
      `update public.recovery_test_clock set instant=${expression};`,
  );
const deadline = () =>
  harness.runSql(
    paymentEvidenceSql +
      `select payment_required_deadline from public.booking_request_capture_work where booking_request_id='${requestId}';`,
  );
const atDeadline = (offset = "") =>
  clock(`'${deadline()}'::timestamptz ${offset}`);
async function resetFixture() {
  if (seeded) harness.runSql(paymentEvidenceSql + cleanup);
  // Seed under the real source clock before restoring a controlled recovery clock.
  for (const definition of definitions)
    harness.runSql(paymentEvidenceSql + definition);
  harness.runSql(paymentEvidenceSql + `begin;${fixture}commit;`);
  seeded = true;
  if (definitions.length) {
    clock("clock_timestamp()");
    for (const definition of definitions)
      harness.runSql(
        paymentEvidenceSql +
          definition.replaceAll(
            "clock_timestamp()",
            "public.recovery_test_now()",
          ),
      );
  }
}
harness.guardDisposableLocalDatabase();
try {
  await resetFixture();
  const before = snapshot();
  const holder = start(
    `begin;set application_name='recovery_admit_holder';${authenticated(admitSql(key))}select 'ADMITTED';`,
  );
  await harness.waitForMarker(holder, "ADMITTED");
  const contender = start(
    `begin;set application_name='recovery_admit_contender';${authenticated(admitSql("81000000-0000-4000-8000-000000001002"))}commit;`,
    true,
  );
  await harness.waitForLock("recovery_admit_contender", contender);
  await finish(holder, { action: "commit" });
  await finish(contender, { expectedState: "RC409" });
  const admission = result(holder);
  assert.equal(admit().attemptId, admission.attemptId);
  for (const step of [
    "original-release",
    "replacement-authorization",
    "replacement-capture",
  ]) {
    const work = lease(admission.attemptId);
    assert.equal(work.permit.step, step);
    await duplicate(executeSql(work.permit), step);
  }
  await duplicate(finalizeSql(admission.attemptId), "confirmation");
  const confirmed = snapshot();
  assert.deepEqual(confirmed.original, before.original);
  assert.deepEqual(confirmed.inventory, before.inventory);
  assert.deepEqual(confirmed.occupancies, before.occupancies);
  assert.equal(confirmed.physical, 3);
  assert.equal(confirmed.receipts.length, 2);
  console.log(
    "Competing authenticated commands, repeated physical dispatch and duplicate finalization preserve one attempt, three movements, one confirmation, two receipts and the unchanged original deadline/inventory.",
  );

  await resetFixture();
  const failed = admit();
  execute(lease(failed.attemptId).permit);
  execute(lease(failed.attemptId).permit);
  execute(lease(failed.attemptId).permit, "failed");
  assert.throws(() => admit("81000000-0000-4000-8000-000000001002"));
  execute(lease(failed.attemptId).permit);
  assert.equal(lease(failed.attemptId).status, "retryable");
  const retry = admit("81000000-0000-4000-8000-000000001002");
  assert.equal(lease(retry.attemptId).permit.step, "replacement-authorization");
  assert.equal(
    harness.runSql(
      paymentEvidenceSql +
        `select count(*) from public.booking_request_payment_recovery_operations where step='original-release' and recovery_attempt_id in (select id from public.booking_request_payment_recovery_attempts where booking_request_id='${requestId}');`,
    ),
    "1",
  );
  assert.equal(retry.deadline, failed.deadline);
  console.log(
    "Definitive failure blocks retry until replacement release succeeds; safe retry reuses the original release and fixed deadline.",
  );

  await resetFixture();
  for (const signature of clockSignatures)
    definitions.push(
      harness.runSql(
        paymentEvidenceSql +
          `select pg_get_functiondef('public.${signature}'::regprocedure);`,
      ),
    );
  harness.runSql(
    paymentEvidenceSql +
      "create table public.recovery_test_clock(instant timestamptz not null);insert into public.recovery_test_clock values(clock_timestamp());create function public.recovery_test_now() returns timestamptz language plpgsql volatile as $$ begin return (select instant from public.recovery_test_clock); end; $$;",
  );
  for (const definition of definitions)
    harness.runSql(
      paymentEvidenceSql +
        definition.replaceAll(
          "clock_timestamp()",
          "public.recovery_test_now()",
        ),
    );
  atDeadline("- interval '1 second'");
  const deadlineHolder = start(
    `begin;set application_name='recovery_deadline_holder';select 1 from public.booking_requests where id='${requestId}' for update;select 'DEADLINE_HELD';`,
  );
  await harness.waitForMarker(deadlineHolder, "DEADLINE_HELD");
  const deadlineContender = start(
    `begin;set application_name='recovery_deadline_contender';${authenticated(admitSql(key))}commit;`,
    true,
  );
  await harness.waitForLock("recovery_deadline_contender", deadlineContender);
  atDeadline();
  await finish(deadlineHolder, { action: "commit" });
  await finish(deadlineContender, { expectedState: "RC409" });
  assert.equal(
    harness.runSql(
      paymentEvidenceSql +
        `select count(*) from public.booking_request_payment_recovery_attempts where booking_request_id='${requestId}';`,
    ),
    "0",
  );
  assert.throws(() => admit());
  atDeadline("- interval '1 second'");
  const beforeDeadline = admit();
  execute(lease(beforeDeadline.attemptId).permit);
  execute(lease(beforeDeadline.attemptId).permit);
  execute(lease(beforeDeadline.attemptId).permit);
  atDeadline("+ interval '1 second'");
  assert.equal(
    harness.runSql(
      paymentEvidenceSql +
        `select public.booking_request_payment_recovery_status(requests)->>'status' from public.booking_requests requests where id='${requestId}';`,
    ),
    "processing",
    "Authoritative pre-deadline success must remain processing while local confirmation is pending",
  );
  assert.equal(snapshot().confirmation, null);
  const finalized = parsed(finalizeSql(beforeDeadline.attemptId));
  assert.deepEqual(parsed(finalizeSql(beforeDeadline.attemptId)), finalized);
  assert.equal(snapshot().receipts.length, 2);
  console.log(
    "Admission checks database time after the contended request lock; pre-deadline success finalizes and replays after the immutable deadline.",
  );

  for (const boundary of ["", "+ interval '1 second'"]) {
    await resetFixture();
    atDeadline("- interval '1 second'");
    const late = admit();
    execute(lease(late.attemptId).permit);
    execute(lease(late.attemptId).permit);
    const pending = lease(late.attemptId);
    assert.throws(() => admit("81000000-0000-4000-8000-000000001002"));
    const observation = delayedObservationSql(
      pending.permit,
      `'${deadline()}'::timestamptz ${boundary}`,
    );
    atDeadline(boundary);
    assert.equal(parsed(observation).status, "recorded");
    await duplicate(observation, `late_${boundary ? "after" : "equal"}`);
    assert.equal(lease(late.attemptId).status, "late-succeeded");
    assert.throws(() => parsed(finalizeSql(late.attemptId)));
    assert.equal(snapshot().confirmation, null);
    assert.equal(snapshot().physical, 3);
    assert.equal(
      harness.runSql(
        paymentEvidenceSql +
          `select count(*) from public.payment_provider_operations ledger join public.booking_request_capture_work work on work.booking_request_id='${requestId}' where ledger.recovery_attempt_id='${late.attemptId}' and operation_kind='capture' and ledger.authoritative_outcome_at >= work.payment_required_deadline and ledger.created_at < work.payment_required_deadline;`,
      ),
      "1",
    );
  }
  console.log(
    "Previously unobserved captures occurring exactly at or after the deadline preserve provider occurrence through duplicate passive receipts, with no confirmation or repeated execution.",
  );
} finally {
  for (const session of sessions) {
    if (!session.child.stdin.destroyed && !session.child.stdin.writableEnded)
      session.child.stdin.end("rollback;\n");
    await session.exited;
  }
  for (const definition of definitions)
    harness.runSql(paymentEvidenceSql + definition);
  if (definitions.length)
    harness.runSql(
      paymentEvidenceSql +
        "drop function public.recovery_test_now();drop table public.recovery_test_clock;",
    );
  if (seeded) harness.runSql(paymentEvidenceSql + cleanup);
}
