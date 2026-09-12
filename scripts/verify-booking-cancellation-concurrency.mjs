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
const actor = (id) =>
  `set local role authenticated; select set_config('request.jwt.claim.sub','${id}',true);`;
const cancel = (role, key) =>
  `select public.commit_booking_cancellation('${request}','${key}','${role}',${role === "customer" ? "null" : "'Unavailable property'"},null,jsonb_build_object('revision',public.get_booking_cancellation_facts('${request}','${role}')->>'revision','refundObligation','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb));`;
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
const sessions = [];
harness.guardDisposableLocalDatabase();
try {
  harness.runSql(cleanup);
  harness.runSql(
    `${fixture("PAYMENT EVIDENCE FIXTURE")} ${fixture("CANCELLATION FIXTURE")} select pg_temp.seed_cancellation_booking('2101-01-01');`,
  );
  for (const scenario of ["duplicate", "competing-actors", "rollback"]) {
    const ownerFirst = scenario !== "duplicate";
    const holder = harness.startSession(
      `begin; set application_name='cancellation_holder'; ${actor(ownerFirst ? owner : customer)} ${cancel(ownerFirst ? "cottage_owner" : "customer", "90000000-0000-4000-8000-000000003801")} select 'CANCELLATION_LOCKED';`,
    );
    sessions.push(holder);
    await harness.waitForMarker(holder, "CANCELLATION_LOCKED");
    const contender = harness.startSession(
      `begin; set application_name='cancellation_contender'; ${actor(customer)} ${cancel("customer", ownerFirst ? "90000000-0000-4000-8000-000000003802" : "90000000-0000-4000-8000-000000003801")} commit;`,
      true,
    );
    sessions.push(contender);
    await harness.waitForLock("cancellation_contender", contender);
    await harness.finishSession(holder, {
      action: scenario === "rollback" ? "rollback" : "commit",
    });
    await harness.finishSession(
      contender,
      scenario === "competing-actors" ? { expectedState: "RC409" } : undefined,
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.booking_cancellations where booking_request_id='${request}'`,
      ),
      "1",
      `${scenario}: one cancellation fact`,
    );
    assert.equal(
      harness.runSql(
        `select actor_role from public.booking_cancellations where booking_request_id='${request}'`,
      ),
      scenario === "competing-actors" ? "cottage_owner" : "customer",
      `${scenario}: first committed actor wins`,
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.booking_notification_events where booking_request_id='${request}'`,
      ),
      "2",
      `${scenario}: two recipient events`,
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.booking_request_payment_history where booking_request_id='${request}' and to_state='cancelled'`,
      ),
      "1",
      `${scenario}: one history transition`,
    );
    harness.runSql(resetCancellation);
  }
  console.log(
    "Cancellation concurrency passed duplicate-command replay, competing actors, and transaction rollback in separate PostgreSQL sessions.",
  );
} finally {
  for (const session of sessions)
    if (!session.exit) session.child.kill("SIGTERM");
  harness.runSql(cleanup);
}
