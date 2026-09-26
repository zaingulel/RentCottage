import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
import {
  request,
  owner,
  customer,
  fixture,
  terminalReleaseSql,
  cleanup,
  parse,
  json,
  binding,
} from "./booking-request-notification-fixture.mjs";
async function main() {
  const harness = createLocalSupabaseConcurrencyHarness({
    timing: {
      check: "verify-booking-request-notification-concurrency",
      isolation: "serial",
    },
  });
  harness.markTimingPhase("setup");
  let passed = false;
  try {
    const service = (sql) =>
      parse(harness.runSql(`set role service_role; ${sql}`));
    const sessions = [];
    const args = (lease) =>
      `null,${lease.leaseGeneration},'${lease.leaseToken}',${json(binding(lease))},'${lease.event.id}'`;
    harness.guardDisposableLocalDatabase();
    try {
      harness.runSql(cleanup);
      harness.markTimingPhase("execution");
      await harness.runSqlAfterSetup(
        fixture,
        ` select pg_temp.prepare_request_notice('request_new','cottage_owner'); commit;`,
      );
      const event = harness.runSql(
        `select id from public.booking_notification_events where booking_request_id='${request}' and event_kind='request_new'`,
      );
      harness.runSql(
        `update public.booking_confirmation_notification_work set lease_expires_at=clock_timestamp()-interval '1 second' where event_id='${event}'`,
      );
      const holder = harness.startSession(
        `begin; set application_name='request_notice_lease_holder'; set local role service_role; select public.lease_booking_confirmation_notification_work(null,'${event}'); select 'REQUEST_LEASED';`,
      );
      sessions.push(holder);
      await harness.waitForMarker(holder, "REQUEST_LEASED");
      const contender = harness.startSession(
        `set application_name='request_notice_lease_contender'; set role service_role; select public.lease_booking_confirmation_notification_work(null,'${event}');`,
        true,
      );
      sessions.push(contender);
      await harness.waitForLock("request_notice_lease_contender", contender);
      await harness.finishSession(holder, { action: "commit" });
      await harness.finishSession(contender);
      assert.equal(
        contender.stdout.trim(),
        "",
        "Second drain cannot lease active work",
      );
      const lease = parse(holder.stdout.split("REQUEST_LEASED")[0]);
      assert.equal(
        service(
          `select public.query_fictional_booking_confirmation_notification_effect(${args(lease)});`,
        ).status,
        "not-found",
      );
      const executor = harness.startSession(
        `begin; set application_name='request_notice_effect_holder'; set local role service_role; select public.execute_fictional_booking_confirmation_notification_effect(${args(lease)}); select 'REQUEST_EXECUTED';`,
      );
      sessions.push(executor);
      await harness.waitForMarker(executor, "REQUEST_EXECUTED");
      const duplicate = harness.startSession(
        `set application_name='request_notice_effect_contender'; set role service_role; select public.execute_fictional_booking_confirmation_notification_effect(${args(lease)});`,
        true,
      );
      sessions.push(duplicate);
      await harness.waitForLock("request_notice_effect_contender", duplicate);
      await harness.finishSession(executor, { action: "commit" });
      await harness.finishSession(duplicate);
      const effect = parse(executor.stdout.split("REQUEST_EXECUTED")[0]);
      assert.equal(
        parse(duplicate.stdout).effectId,
        effect.effectId,
        "Competing executions retain one effect",
      );
      // Crash after effect commit: restart after the lease expires and state/access change.
      harness.runSql(
        `select public.claim_booking_request_action('${owner}','${request}','accept'); update public.account_contexts set owner_approval_state='suspended' where user_id='${owner}'; update public.booking_confirmation_notification_work set lease_expires_at=clock_timestamp()-interval '1 second' where event_id='${event}';`,
      );
      const restarted = service(
        `select public.lease_booking_confirmation_notification_work(null,'${event}');`,
      );
      assert.equal(restarted.leaseGeneration, lease.leaseGeneration + 1);
      assert.equal(
        service(
          `select public.execute_fictional_booking_confirmation_notification_effect(${args(lease)});`,
        ).status,
        "stale",
      );
      const found = service(
        `select public.query_fictional_booking_confirmation_notification_effect(${args(restarted)});`,
      );
      assert.equal(found.effectId, effect.effectId);
      const complete = `select public.complete_booking_confirmation_notification_delivery(null,${restarted.leaseGeneration},'${restarted.leaseToken}',${json(binding(restarted))},'${effect.effectId}','${event}');`;
      assert.deepEqual(service(complete), {
        status: "delivered",
        historical: true,
      });
      assert.equal(
        service(complete).status,
        "stale",
        "Repeated completion creates no new attempt or effect",
      );
      assert.equal(
        harness.runSql(
          `select count(*) from public.fictional_booking_confirmation_notification_effects where booking_request_id='${request}'`,
        ),
        "1",
      );
      assert.equal(
        harness.runSql(
          `select count(*) from public.booking_confirmation_notification_attempts where event_id='${event}' and action='complete'`,
        ),
        "1",
      );
      // A different event with no effect is suppressed after current authority revocation.
      harness.markTimingPhase("setup");
      const pendingSetup = fixture.slice(
        fixture.indexOf("create function pg_temp.request_payload"),
      );
      harness.markTimingPhase("execution");
      await harness.runSqlAfterSetup(
        pendingSetup,
        ` select pg_temp.prepare_request_notice('request_accepted','cottage_owner');`,
      );
      const pending = parse(
        harness.runSql(
          `select public.booking_confirmation_notification_binding(w)||jsonb_build_object('leaseGeneration',w.lease_generation,'leaseToken',w.lease_token) from public.booking_confirmation_notification_work w join public.booking_notification_events e on e.id=w.event_id where e.event_kind='request_accepted' and e.recipient_role='cottage_owner' and e.booking_request_id='${request}'`,
        ),
      );
      assert.equal(
        service(
          `select public.query_fictional_booking_confirmation_notification_effect(${args(pending)});`,
        ).status,
        "not-found",
      );
      assert.equal(
        service(
          `select public.execute_fictional_booking_confirmation_notification_effect(${args(pending)});`,
        ).status,
        "suppressed",
      );
      assert.equal(
        harness.runSql(
          `select count(*) from public.fictional_booking_confirmation_notification_effects where booking_request_id='${request}'`,
        ),
        "1",
      );
      await verifyTerminalReleaseNotifications(harness);
      console.log(
        "Real declined, withdrawn and expired release transitions each produced exactly the customer and owner intents and two effects, without a paid receipt.",
      );
      console.log(
        "Request notification concurrency passed competing drains, one effect, crash reconciliation, stale fencing, historical completion and current-authority suppression.",
      );
    } finally {
      harness.markTimingPhase("cleanup");
      for (const session of sessions)
        if (!session.exit) session.child.kill("SIGTERM");
      await Promise.all(sessions.map((session) => session.exited));
      harness.runSql(cleanup);
    }
    passed = true;
  } finally {
    harness.finishTiming({
      outcome: passed ? "passed" : "failed",
      cleanupDisposition: "local",
    });
  }
}

export async function verifyTerminalReleaseNotifications(harness) {
  for (const [action, status] of [
    ["decline", "declined"],
    ["withdraw", "withdrawn"],
    ["expire", "expired"],
  ]) {
    harness.markTimingPhase("setup");
    harness.runSql(cleanup);
    const seed =
      action === "expire"
        ? fixture.replace(
            "statement_timestamp()+interval '4 hours',statement_timestamp(),null",
            "statement_timestamp()-interval '1 second',statement_timestamp()-interval '4 hours 1 second',null",
          )
        : fixture;
    harness.markTimingPhase("execution");
    const result = parse(
      await harness.runSqlAfterSetup(
        `${seed} ${terminalReleaseSql}`,
        ` select pg_temp.finish_terminal_release('${action}'); commit;`,
      ),
    );
    assert.equal(result.status, status);
    const events = parse(
      harness.runSql(
        `select jsonb_agg(jsonb_build_object('role',recipient_role,'recipient',recipient_user_id,'receipt',receipt_id) order by recipient_role) from public.booking_notification_events where booking_request_id='${request}' and event_kind='request_${status}'`,
      ),
    );
    assert.deepEqual(events, [
      { role: "cottage_owner", recipient: owner, receipt: null },
      { role: "customer", recipient: customer, receipt: null },
    ]);
    harness.markTimingPhase("setup");
    const helpers = fixture.slice(
      fixture.indexOf("create function pg_temp.notice_call"),
    );
    harness.markTimingPhase("execution");
    const delivered = parse(
      await harness.runSqlAfterSetup(
        helpers,
        ` select jsonb_agg(pg_temp.request_notice_call('execute',pg_temp.prepare_request_notice('request_${status}',role))) from (values ('customer'),('cottage_owner')) recipients(role);`,
      ),
    );
    assert.deepEqual(
      delivered.map((e) => e.status),
      ["delivered", "delivered"],
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.booking_receipts r join public.booking_confirmations c on c.id=r.booking_confirmation_id where c.booking_request_id='${request}'`,
      ),
      "0",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
