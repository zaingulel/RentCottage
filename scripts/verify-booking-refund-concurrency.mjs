import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
const source = readFileSync(
  new URL(
    "../supabase/tests/database/booking_cancellation.test.sql",
    import.meta.url,
  ),
  "utf8",
);
const fixture = (name) => {
  const start = source.indexOf(`-- BEGIN ${name}`);
  const end = source.indexOf(`-- END ${name}`, start);
  if (start < 0 || end < 0) throw new Error(`Missing ${name}`);
  return source.slice(start, end);
};
const request = "60000000-0000-4000-8000-000000001001";
const customer = "10000000-0000-4000-8000-000000001002";
const owner = "10000000-0000-4000-8000-000000001001";
const claim = "72000000-0000-4000-8000-000000001001";
const resetCancellation = `set session_replication_role=replica;
delete from public.booking_notification_events where booking_request_id='${request}';
delete from public.booking_cancellation_administrator_audit where cancellation_id in (select id from public.booking_cancellations where booking_request_id='${request}');
delete from public.booking_cancellation_incidents where cancellation_id in (select id from public.booking_cancellations where booking_request_id='${request}');
delete from public.booking_cancellations where booking_request_id='${request}';
delete from public.booking_request_payment_history where booking_request_id='${request}' and to_state='cancelled';
update public.cottage_booking_period_commitments set status='confirmed_booking' where id='50000000-0000-4000-8000-000000001001';
update public.cottage_booking_period_occupancies set active=true where booking_period_commitment_id='50000000-0000-4000-8000-000000001001';
set session_replication_role=origin;`;
const cleanup = `${resetCancellation} set session_replication_role=replica;
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
const resetRefunds = `set session_replication_role=replica;
delete from public.booking_notification_events where refund_intent_id in (select id from public.booking_refund_intents where booking_request_id='${request}');
delete from public.payment_provider_observations where operation_id in (select id from public.payment_provider_operations where claim_id='${claim}' and operation_kind='refund');
delete from public.simulated_payment_effects where operation_id in (select id from public.payment_provider_operations where claim_id='${claim}' and operation_kind='refund');
delete from public.payment_provider_operations where claim_id='${claim}' and operation_kind='refund';
delete from public.booking_refund_attempts where refund_intent_id in (select id from public.booking_refund_intents where booking_request_id='${request}');
delete from public.booking_refund_intents where booking_request_id='${request}';
set session_replication_role=origin;`;
const administrator = `set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003801',true); select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000003801","aal":"aal2"}',true);`;
const exception = (key, price) =>
  `select public.request_booking_refund_exception('${request}','${key}','Concurrent compensation','{"bookingPriceFils":${price},"bookingServiceFeeFils":1000000}');`;
const firstKey = "90000000-0000-4000-8000-000000003820";
const secondKey = "90000000-0000-4000-8000-000000003821";
const sessions = [];
harness.guardDisposableLocalDatabase();
try {
  harness.runSql(resetRefunds + cleanup);
  harness.runSql(
    `${fixture("PAYMENT EVIDENCE FIXTURE")} ${fixture("CANCELLATION FIXTURE")} select pg_temp.seed_cancellation_booking('2101-01-01');`,
  );
  for (const scenario of ["capacity", "duplicate", "rollback"]) {
    const holder = harness.startSession(
      `begin; set application_name='refund_holder'; ${administrator} ${exception(firstKey, 80000000)} select 'REFUND_RESERVED';`,
    );
    sessions.push(holder);
    await harness.waitForMarker(holder, "REFUND_RESERVED");
    const contender = harness.startSession(
      `begin; set application_name='refund_contender'; ${administrator} ${exception(scenario === "duplicate" ? firstKey : secondKey, scenario === "duplicate" ? 80000000 : 40000000)} commit;`,
      true,
    );
    sessions.push(contender);
    await harness.waitForLock("refund_contender", contender);
    await harness.finishSession(holder, {
      action: scenario === "rollback" ? "rollback" : "commit",
    });
    await harness.finishSession(
      contender,
      scenario === "capacity" ? { expectedState: "RC409" } : undefined,
    );
    assert.equal(
      harness
        .runSql(
          `select count(*) from public.booking_refund_intents where booking_request_id='${request}';`,
        )
        .trim(),
      "1",
    );
    assert.equal(
      harness
        .runSql(
          `select booking_price_fils from public.booking_refund_intents where booking_request_id='${request}';`,
        )
        .trim(),
      scenario === "rollback" ? "40000000" : "80000000",
    );
    harness.runSql(resetRefunds);
  }
  harness.runSql(
    `begin; ${administrator} ${exception(firstKey, 30000000)} commit;`,
  );
  const intent = harness
    .runSql(
      `select id from public.booking_refund_intents where command_id='${firstKey}';`,
    )
    .trim();
  const holder = harness.startSession(
    `begin; set application_name='refund_worker_holder'; set local role service_role; select public.claim_booking_refund('${intent}'); select 'REFUND_LEASED';`,
  );
  sessions.push(holder);
  await harness.waitForMarker(holder, "REFUND_LEASED");
  const contender = harness.startSession(
    `begin; set application_name='refund_worker_contender'; set local role service_role; select public.claim_booking_refund('${intent}'); commit;`,
    true,
  );
  sessions.push(contender);
  await harness.waitForLock("refund_worker_contender", contender);
  await harness.finishSession(holder, { action: "commit" });
  await harness.finishSession(contender);
  assert.equal(
    harness
      .runSql(
        `select count(*) from public.booking_refund_attempts where refund_intent_id='${intent}';`,
      )
      .trim(),
    "1",
  );
  assert.match(contender.stdout, /processing/);
  // A scheduling claim holds only the selected booking rows. A different
  // transaction skips those rows, and rollback leaves the work recoverable.
  const batchHolder = harness.startSession(
    `begin; set application_name='refund_batch_holder'; set local role service_role; select public.claim_due_booking_refunds(1); select 'REFUND_BATCH_SELECTED';`,
  );
  sessions.push(batchHolder);
  await harness.waitForMarker(batchHolder, "REFUND_BATCH_SELECTED");
  assert.match(batchHolder.stdout, new RegExp(request));
  const batchContender = harness.startSession(
    `begin; set application_name='refund_batch_contender'; set local statement_timeout='3s'; set local role service_role; select public.claim_due_booking_refunds(50); commit;`,
    true,
  );
  sessions.push(batchContender);
  await harness.finishSession(batchContender);
  assert.equal(
    batchContender.stdout.trim(),
    "[]",
    "parallel selector skips the locked request without duplicating it",
  );
  await harness.finishSession(batchHolder, { action: "rollback" });
  assert.equal(
    harness.runSql(
      `select refund_last_scheduled_at is null from public.booking_requests where id='${request}';`,
    ),
    "t",
    "rollback does not advance scheduling metadata",
  );
  assert.deepEqual(
    JSON.parse(
      harness.runSql(
        `begin; set local role service_role; select public.claim_due_booking_refunds(1); commit;`,
      ),
    ),
    [request],
    "rolled-back selection is immediately recoverable",
  );
  assert.equal(
    harness.runSql(
      `select refund_last_scheduled_at is not null from public.booking_requests where id='${request}';`,
    ),
    "t",
    "committed selection durably advances scheduling metadata",
  );
  console.log(
    "Refund capacity, command replay, rollback, competing worker lease and skip-locked scheduling interleavings passed.",
  );
} finally {
  for (const session of sessions)
    if (!session.exit) session.child.kill("SIGTERM");
  harness.runSql(resetRefunds + cleanup);
}
