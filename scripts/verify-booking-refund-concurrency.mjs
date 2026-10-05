import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
import {
  confirmedBookingCleanup,
  refundReset,
} from "./lib/booking-fixture.mjs";

const harness = createLocalSupabaseConcurrencyHarness({
  timing: { check: "verify-booking-refund-concurrency", isolation: "serial" },
});
let timingOutcome = "failed";
try {
  harness.markTimingPhase("setup");
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
  const cleanup = confirmedBookingCleanup();
  const resetRefunds = refundReset();
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
    harness.markTimingPhase("execution");
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
      harness.markTimingPhase("setup");
      harness.runSql(resetRefunds);
      harness.markTimingPhase("execution");
    }
    harness.markTimingPhase("setup");
    harness.runSql(
      `begin; ${administrator} ${exception(firstKey, 30000000)} commit;`,
    );
    const intent = harness
      .runSql(
        `select id from public.booking_refund_intents where command_id='${firstKey}';`,
      )
      .trim();
    harness.markTimingPhase("execution");
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
    harness.markTimingPhase("cleanup");
    for (const session of sessions)
      if (!session.exit) session.child.kill("SIGTERM");
    harness.runSql(resetRefunds + cleanup);
  }
  timingOutcome = "passed";
} finally {
  harness.finishTiming({ outcome: timingOutcome, cleanupDisposition: "local" });
}
