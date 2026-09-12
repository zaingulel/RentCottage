import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
const source = readFileSync(
  new URL(
    "../supabase/tests/database/booking_completion.test.sql",
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
const administrator = "10000000-0000-4000-8000-000000003801";
const actor = (id, aal = "aal1") =>
  `set local role authenticated; select set_config('request.jwt.claim.sub','${id}',true); select set_config('request.jwt.claims','{"sub":"${id}","aal":"${aal}"}',true);`;
const complete = (revision) =>
  `set local role service_role; select public.commit_booking_completion('${request}','${revision}');`;
const incident = `${actor(owner)} select public.record_booking_incident('${request}','90000000-0000-4000-8000-000000003901','cottage_owner','safety','Private concurrent incident');`;
const noShow = `${actor(administrator, "aal2")} select public.commit_booking_no_show('${request}','90000000-0000-4000-8000-000000003902','Did not arrive',jsonb_build_object('revision',public.get_booking_no_show_facts('${request}')->>'revision','refundObligation','{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb));`;
const cancel = `${actor(customer)} select public.commit_booking_cancellation('${request}','90000000-0000-4000-8000-000000003903','customer',null,null,jsonb_build_object('revision',public.get_booking_cancellation_facts('${request}','customer')->>'revision','refundObligation','{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb));`;
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
harness.guardDisposableLocalDatabase();
try {
  harness.runSql(cleanup);
  harness.runSql(
    `${fixture("PAYMENT EVIDENCE FIXTURE")} ${fixture("COMPLETION FIXTURE")} select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-3);`,
  );
  assert.equal(
    harness.runSql(
      `select public.booking_request_payment_status(r) from public.booking_requests r where id='${request}'`,
    ),
    "paid-confirmed",
    "real provider capture produces the paid confirmation fixture",
  );
  const scenarios = [
    {
      name: "duplicate-completion",
      first: "complete",
      second: "complete",
      outcome: "completed",
      incidents: "0",
    },
    {
      name: "incident-before-completion",
      first: "incident",
      second: "complete",
      outcome: "none",
      incidents: "1",
    },
    {
      name: "completion-before-incident",
      first: "complete",
      second: "incident",
      outcome: "completed",
      incidents: "1",
    },
    {
      name: "completion-before-no-show",
      first: "complete",
      second: "noShow",
      outcome: "completed",
      incidents: "0",
      conflict: true,
    },
    {
      name: "completion-before-cancellation",
      first: "complete",
      second: "cancel",
      outcome: "completed",
      incidents: "0",
      conflict: true,
    },
    {
      name: "cancellation-before-completion",
      first: "cancel",
      second: "complete",
      outcome: "cancelled",
      incidents: "0",
    },
    {
      name: "incident-before-no-show",
      first: "incident",
      second: "noShow",
      outcome: "none",
      incidents: "1",
      conflict: true,
    },
    {
      name: "no-show-before-incident",
      first: "noShow",
      second: "incident",
      outcome: "no_show",
      incidents: "1",
    },
    {
      name: "duplicate-no-show",
      first: "noShow",
      second: "noShow",
      outcome: "no_show",
      incidents: "0",
    },
    {
      name: "completion-rollback",
      first: "complete",
      second: "noShow",
      outcome: "no_show",
      incidents: "0",
      rollback: true,
    },
    {
      name: "incident-rollback",
      first: "incident",
      second: "complete",
      outcome: "completed",
      incidents: "0",
      rollback: true,
    },
  ];
  for (const scenario of scenarios) {
    const revision = harness.runSql(
      `begin; set local role service_role; select value->>'revision' from public.list_due_booking_completions(50) value where value->>'bookingRequestId'='${request}'; commit;`,
    );
    assert.match(
      revision,
      /^[a-f0-9]{32}$/,
      `${scenario.name}: exactly one valid completion candidate`,
    );
    const commands = { complete: complete(revision), incident, noShow, cancel };
    const holder = harness.startSession(
      `begin; set application_name='completion_holder'; ${commands[scenario.first]} select 'COMPLETION_LOCKED';`,
    );
    sessions.push(holder);
    await harness.waitForMarker(holder, "COMPLETION_LOCKED");
    assert.throws(
      () =>
        harness.runSql(`\\set VERBOSITY verbose
begin; select id from public.booking_requests where id='${request}' for update nowait; rollback;`),
      /55P03/,
      `${scenario.name}: mutation holds the shared booking-request lock`,
    );
    const contender = harness.startSession(
      `begin; set application_name='completion_contender'; ${commands[scenario.second]} commit;`,
      true,
    );
    sessions.push(contender);
    await harness.waitForLock("completion_contender", contender);
    assert.equal(
      harness.runSql(
        "select cardinality(pg_blocking_pids(pid)) from pg_stat_activity where application_name='completion_contender'",
      ),
      "1",
      `${scenario.name}: second command demonstrably waits for the first`,
    );
    await harness.finishSession(holder, {
      action: scenario.rollback ? "rollback" : "commit",
    });
    await harness.finishSession(
      contender,
      scenario.conflict ? { expectedState: "RC409" } : undefined,
    );
    const outcome = harness.runSql(
      `select coalesce((select outcome from public.booking_lifecycle_outcomes where booking_request_id='${request}'),(select 'cancelled' from public.booking_cancellations where booking_request_id='${request}'),'none')`,
    );
    assert.equal(
      outcome,
      scenario.outcome,
      `${scenario.name}: final outcome preserves first committed authority`,
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.booking_incidents where booking_request_id='${request}'`,
      ),
      scenario.incidents,
      `${scenario.name}: exactly the authorized incident facts remain`,
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.booking_completion_maturity where booking_request_id='${request}'`,
      ),
      outcome === "completed" ? "1" : "0",
      `${scenario.name}: maturity commits atomically with completion only`,
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.booking_confirmations where booking_request_id='${request}'`,
      ),
      "1",
      `${scenario.name}: confirmation survives`,
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.booking_receipts where booking_confirmation_id in(select id from public.booking_confirmations where booking_request_id='${request}')`,
      ),
      "2",
      `${scenario.name}: both original receipts survive`,
    );
    harness.runSql(resetCancellation);
  }
  console.log(
    `Booking lifecycle concurrency passed ${scenarios.length} scenarios with observed shared booking locks, replay, conflicts, incident order, cancellation order, and rollback in separate PostgreSQL sessions.`,
  );
} finally {
  for (const session of sessions)
    if (!session.exit) session.child.kill("SIGTERM");
  harness.runSql(cleanup);
}
