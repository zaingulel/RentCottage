import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { build } from "esbuild";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
const trackedSpawn = (command, args, options) => {
  console.log(`Starting ${command} ${args.join(" ")} (no listening port)`);
  const child = spawn(command, args, options);
  console.log(
    execFileSync(
      "ps",
      ["-p", String(child.pid), "-o", "pid=,ppid=,pgid=,lstart=,command="],
      { encoding: "utf8" },
    ).trim(),
  );
  return child;
};
const harness = createLocalSupabaseConcurrencyHarness({
  spawnProcess: trackedSpawn,
});
const source = readFileSync(
  new URL(
    "../supabase/tests/database/booking_settlement.test.sql",
    import.meta.url,
  ),
  "utf8",
);
const fixture = (name) => {
  const start = source.indexOf(`-- BEGIN ${name}`),
    end = source.indexOf(`-- END ${name}`, start);
  if (start < 0 || end < 0) throw new Error(`Missing ${name}`);
  return source.slice(start, end);
};
const request = "60000000-0000-4000-8000-000000001001",
  customer = "10000000-0000-4000-8000-000000001002",
  owner = "10000000-0000-4000-8000-000000001001",
  claim = "72000000-0000-4000-8000-000000001001";
const administrator = `set local role authenticated; set local request.jwt.claim.sub='10000000-0000-4000-8000-000000003801'; set local request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000003801","aal":"aal2"}';`;
const resetCancellation = `set session_replication_role=replica;
delete from public.booking_completion_maturity where booking_request_id='${request}';
delete from public.booking_incidents where booking_request_id='${request}';
delete from public.booking_lifecycle_outcomes where booking_request_id='${request}';
delete from public.booking_notification_events where booking_request_id='${request}';
delete from public.booking_cancellation_administrator_audit where cancellation_id in (select id from public.booking_cancellations where booking_request_id='${request}');
delete from public.booking_cancellation_incidents where cancellation_id in (select id from public.booking_cancellations where booking_request_id='${request}');
delete from public.booking_cancellations where booking_request_id='${request}';
delete from public.booking_request_payment_history where booking_request_id='${request}' and to_state='cancelled';
update public.cottage_booking_period_commitments set status='confirmed_booking' where id='50000000-0000-4000-8000-000000001001';
update public.cottage_booking_period_occupancies set active=true where booking_period_commitment_id='50000000-0000-4000-8000-000000001001';
set session_replication_role=origin;`;
const cleanup = `${resetCancellation} set session_replication_role=replica;
delete from public.booking_settlement_receipts where settlement_intent_id in (select id from public.booking_settlement_intents where booking_request_id='${request}');
delete from public.booking_settlement_attempts where settlement_intent_id in (select id from public.booking_settlement_intents where booking_request_id='${request}');
delete from public.booking_settlement_intents where booking_request_id='${request}';
delete from public.booking_refund_attempts where refund_intent_id in (select id from public.booking_refund_intents where booking_request_id='${request}');
delete from public.booking_refund_intents where booking_request_id='${request}';
delete from public.booking_payout_commands where booking_request_id='${request}';
delete from public.fictional_booking_confirmation_notification_effects where booking_request_id='${request}';
delete from public.booking_confirmation_notification_attempts where receipt_id in (select receipt_id from public.booking_confirmation_notification_work where booking_request_id='${request}');
delete from public.booking_confirmation_notification_work where booking_request_id='${request}';
delete from public.booking_request_payment_history where booking_request_id='${request}';
delete from public.simulated_payment_effects where operation_id in (select id from public.payment_provider_operations where claim_id='${claim}');
delete from public.payment_provider_observations where operation_id in (select id from public.payment_provider_operations where claim_id='${claim}');
delete from public.payment_provider_operations where claim_id='${claim}';
delete from public.booking_receipts where booking_confirmation_id in (select id from public.booking_confirmations where booking_request_id='${request}');
delete from public.booking_confirmations where booking_request_id='${request}';
delete from public.booking_request_capture_work where booking_request_id='${request}';
delete from public.booking_request_provider_operation_identities where attempt_id='70000000-0000-4000-8000-000000001001';
delete from public.booking_request_authorization_claim_items where claim_id='${claim}';
delete from public.booking_request_authorization_claim_occupancies where claim_id='${claim}';
delete from public.booking_request_authorization_claims where id='${claim}';
delete from public.booking_request_submission_attempts where id='70000000-0000-4000-8000-000000001001';
delete from public.booking_requests where id='${request}';
delete from public.cottage_booking_period_occupancies where booking_period_commitment_id='50000000-0000-4000-8000-000000001001';
delete from public.cottage_inventory_commitments where booking_period_commitment_id='50000000-0000-4000-8000-000000001001';
delete from public.cottage_booking_period_commitments where id='50000000-0000-4000-8000-000000001001';
delete from public.booking_snapshots where id='40000000-0000-4000-8000-000000001001';
delete from public.cottage_shifts where schedule_revision_id='30000000-0000-4000-8000-000000001001';
delete from public.cottage_shift_schedule_revisions where id='30000000-0000-4000-8000-000000001001';
delete from public.owner_application_cottage_profiles where id='20000000-0000-4000-8000-000000001001';
delete from public.account_contexts where user_id in ('${owner}','${customer}','10000000-0000-4000-8000-000000001003','10000000-0000-4000-8000-000000003801');
delete from auth.users where id in ('${owner}','${customer}','10000000-0000-4000-8000-000000001003','10000000-0000-4000-8000-000000003801');
set session_replication_role=origin;`;

const sessions = [];
const processes = [];
const temp = mkdtempSync(join(tmpdir(), "rentcottage-payout-observer-"));
async function child(mode) {
  const process = trackedSpawn(
    globalThis.process.execPath,
    [join(temp, "fixture.mjs"), mode],
    { stdio: ["ignore", "pipe", "pipe"], env: globalThis.process.env },
  );
  processes.push(process);
  let stdout = "",
    stderr = "";
  process.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  process.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    process.once("error", reject);
    process.once("close", resolve);
  });
  assert.equal(code, 0, stderr);
  return stdout.trim();
}
harness.guardDisposableLocalDatabase();
try {
  await build({
    entryPoints: [
      new URL("./booking-payout-process-fixture.ts", import.meta.url).pathname,
    ],
    outfile: join(temp, "fixture.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const seed = () => {
    harness.runSql(cleanup);
    harness.runSql(
      `${fixture("PAYMENT EVIDENCE FIXTURE")} ${fixture("COMPLETION FIXTURE")} select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-3); begin;set local role service_role;select public.commit_booking_completion('${request}',(select value->>'revision' from public.list_due_booking_completions(50) value));commit;`,
    );
  };
  const literal = (value) =>
    `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  for (const scenario of [
    "hold-first",
    "refund-first",
    "settlement-first",
    "hold-rollback",
    "duplicate-admission",
  ]) {
    seed();
    harness.runSql(
      `begin;${administrator}select public.request_booking_settlement('${request}','90000000-0000-4000-8000-000000002280','Settlement review',public.get_booking_settlement_facts('${request}')->>'revision',90000000);commit;`,
    );
    const intent = harness.runSql(
      `select id from public.booking_settlement_intents where booking_request_id='${request}'`,
    );
    const claim = JSON.parse(
      harness.runSql(
        `set role service_role;select public.claim_booking_settlement('${intent}')`,
      ),
    );
    const admission = `set local role service_role;select public.admit_booking_settlement(${literal(claim.request.executionPermit)});`;
    const refund = `${administrator}select public.request_booking_refund_exception('${request}','90000000-0000-4000-8000-000000002287','Concurrent refund','{"bookingPriceFils":10000000,"bookingServiceFeeFils":0}');`;
    const hold = `${administrator}select public.record_booking_payout_command('${request}','90000000-0000-4000-8000-000000002288','place_hold','Concurrent hold',null,null,null);`;
    const holder = harness.startSession(
      `begin;set application_name='payout_race_holder';${scenario.startsWith("hold") ? hold : scenario === "refund-first" ? refund : admission}select 'PAYOUT_SOURCE_LOCKED';`,
    );
    sessions.push(holder);
    await harness.waitForMarker(holder, "PAYOUT_SOURCE_LOCKED");
    const contender = harness.startSession(
      `begin;set application_name='payout_race_contender';${scenario === "settlement-first" ? refund : admission}commit;`,
      true,
    );
    sessions.push(contender);
    await harness.waitForLock("payout_race_contender", contender);
    await harness.finishSession(holder, {
      action: scenario === "hold-rollback" ? "rollback" : "commit",
    });
    await harness.finishSession(
      contender,
      scenario === "settlement-first" ? { expectedState: "RC409" } : undefined,
    );
    if (scenario === "hold-first" || scenario === "refund-first")
      assert.match(contender.stdout, /not-admitted/);
    if (scenario === "hold-rollback")
      assert.match(contender.stdout, /"mode": "execute"/);
    if (scenario === "duplicate-admission")
      assert.match(contender.stdout, /"mode": "reconcile"/);
  }
  seed();
  assert.equal(
    harness.runSql(
      `select public.booking_request_payment_status(r) from public.booking_requests r where id='${request}'`,
    ),
    "paid-confirmed",
  );
  const original = harness.runSql(
    `select jsonb_build_object('snapshot',to_jsonb(s),'receipt',(select jsonb_agg(to_jsonb(r) order by r.id) from public.booking_receipts r where r.booking_confirmation_id=c.id)) from public.booking_confirmations c join public.booking_requests b on b.id=c.booking_request_id join public.booking_snapshots s on s.id=b.booking_snapshot_id where b.id='${request}'`,
  );
  const first = await child("effect-before-recording");
  assert.match(first, /^EFFECT_PERSISTED [a-f0-9-]+$/);
  const operationId = first.split(" ")[1];
  assert.equal(
    harness.runSql(
      `select current_outcome is null from public.payment_provider_operations where id='${operationId}'`,
    ),
    "t",
    "process ended before application recording",
  );
  assert.equal(
    harness.runSql(
      `select physical_execution_count from public.simulated_payment_effects where operation_id='${operationId}'`,
    ),
    "1",
    "provider effect survived process exit",
  );
  const intent = harness.runSql(
    `select id from public.booking_settlement_intents where booking_request_id='${request}'`,
  );
  const holder = harness.startSession(
    `begin;set application_name='payout_worker_holder';set local role service_role;select public.claim_booking_settlement('${intent}');select 'PAYOUT_QUERY_READY';`,
  );
  sessions.push(holder);
  await harness.waitForMarker(holder, "PAYOUT_QUERY_READY");
  const contender = harness.startSession(
    `begin;set application_name='payout_worker_contender';set local role service_role;select public.claim_booking_settlement('${intent}');commit;`,
    true,
  );
  sessions.push(contender);
  await harness.waitForLock("payout_worker_contender", contender);
  await harness.finishSession(holder, { action: "commit" });
  await harness.finishSession(contender);
  assert.match(holder.stdout, /"status": "query"/);
  assert.match(contender.stdout, /"status": "query"/);
  assert.equal(
    harness.runSql(
      `select count(*) from public.booking_settlement_attempts where settlement_intent_id='${intent}'`,
    ),
    "1",
    "competing workers retain one admitted attempt",
  );
  harness.runSql(
    `begin;${administrator}select public.record_booking_payout_command('${request}','90000000-0000-4000-8000-000000002289','place_hold','Review after effect',null,null,null);commit;`,
  );
  assert.deepEqual(
    JSON.parse(await child("reconcile")),
    { status: "settled" },
    "fresh application queries and records the original admitted effect while held",
  );
  assert.deepEqual(JSON.parse(await child("duplicate")), { status: "settled" });
  assert.equal(
    harness.runSql(
      `select count(*)||':'||sum(e.physical_execution_count)||':'||sum(o.amount_fils) from public.payment_provider_operations o join public.simulated_payment_effects e on e.operation_id=o.id where o.operation_kind='settlement' and o.claim_id='${claim}'`,
    ),
    "1:1:90000000",
  );
  assert.equal(
    harness.runSql(
      `select count(*) from public.booking_request_payment_history where booking_request_id='${request}' and operation_kind='settlement'`,
    ),
    "1",
  );
  assert.equal(
    harness.runSql(
      `select count(*) from public.payment_provider_observations where operation_id='${operationId}'`,
    ),
    "1",
  );
  assert.equal(
    harness.runSql(
      `select jsonb_build_object('snapshot',to_jsonb(s),'receipt',(select jsonb_agg(to_jsonb(r) order by r.id) from public.booking_receipts r where r.booking_confirmation_id=c.id)) from public.booking_confirmations c join public.booking_requests b on b.id=c.booking_request_id join public.booking_snapshots s on s.id=b.booking_snapshot_id where b.id='${request}'`,
    ),
    original,
  );
  const late = JSON.parse(await child("facts"));
  assert.deepEqual(late.recovery, {
    status: "paid",
    ownerEntitlementFils: 90000000,
    paidFils: 90000000,
    paidWhileBlocked: true,
    recoveryExposureFils: 90000000,
    recoveryBalanceFils: 90000000,
    automaticOwnerDebitFils: 0,
  });
  const receipt = late.settlement.receipt;
  assert.equal(receipt.activeHoldIds.length, 1);
  harness.runSql(
    `begin;${administrator}select public.request_booking_refund_exception('${request}','90000000-0000-4000-8000-000000002290','Later compensation','{"bookingPriceFils":10000000,"bookingServiceFeeFils":0}');commit;`,
  );
  assert.deepEqual(JSON.parse(await child("refund")), { status: "settled" });
  const recovered = JSON.parse(await child("facts"));
  assert.deepEqual(recovered.recovery, {
    ...late.recovery,
    ownerEntitlementFils: 81000000,
    recoveryBalanceFils: 9000000,
  });
  assert.deepEqual(
    recovered.settlement.receipt,
    receipt,
    "later refunds and replay preserve first-success audit context",
  );
  assert.deepEqual(recovered.captured, {
    bookingPriceFils: 100000000,
    bookingServiceFeeFils: 5000000,
  });
  assert.equal(
    harness.runSql(`select count(*) from public.booking_settlement_receipts`),
    "1",
  );
  console.log(
    "Hold/refund/admission/rollback races passed; fresh process recovery preserved 90m paid/exposure, then verified 10m price refund yielded 9m balance and zero owner debit.",
  );
  console.log(
    "Fresh processes recovered effect-before-recording through the real settlement application, simulator and shared observation recorder; duplicate replay preserved one effect, operation, observation and history entry.",
  );
} finally {
  for (const process of processes)
    if (process.exitCode === null) process.kill("SIGTERM");
  for (const session of sessions)
    if (!session.exit) session.child.kill("SIGTERM");
  harness.runSql(cleanup);
  rmSync(temp, { recursive: true, force: true });
}
