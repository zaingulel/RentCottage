import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
import {
  cancellationReset,
  confirmedBookingCleanup,
} from "./lib/booking-fixture.mjs";

const harness = createLocalSupabaseConcurrencyHarness({
  timing: {
    check: "verify-booking-cancellation-concurrency",
    isolation: "serial",
  },
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
  const customer = "10000000-0000-4000-8000-000000001002";
  const owner = "10000000-0000-4000-8000-000000001001";
  const actor = (id) =>
    `set local role authenticated; select set_config('request.jwt.claim.sub','${id}',true);`;
  const cancel = (role, key) =>
    `select public.commit_booking_cancellation('${request}','${key}','${role}',${role === "customer" ? "null" : "'Unavailable property'"},null,jsonb_build_object('revision',public.get_booking_cancellation_facts('${request}','${role}')->>'revision','refundObligation','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb));`;
  const ownerReadSql = `select public.list_owner_booking_request_notifications();`;
  const ownerSnapshot = (output) => {
    const notices = JSON.parse(
      output.split("\n").find((line) => line.startsWith("[")),
    );
    assert.equal(notices.length, 1, "one owning-Owner notice snapshot");
    const {
      id,
      cancellationStatus,
      paymentStatus,
      paymentRequiredWindow,
      paymentRequiredExpiry,
      bookingPriceIqd,
      marketplaceCommissionFils,
      ownerNetFils,
    } = notices[0];
    return {
      id,
      cancellationStatus,
      paymentStatus,
      paymentRequiredWindow,
      paymentRequiredExpiry,
      bookingPriceIqd,
      marketplaceCommissionFils,
      ownerNetFils,
    };
  };
  const readOwnerSnapshot = () =>
    ownerSnapshot(
      harness.runSql(
        `begin; set local role authenticated; set local "request.jwt.claim.sub"='${owner}'; ${ownerReadSql} commit;`,
      ),
    );
  const beforeCancellation = {
    id: request,
    cancellationStatus: null,
    paymentStatus: "paid-confirmed",
    paymentRequiredWindow: null,
    paymentRequiredExpiry: null,
    bookingPriceIqd: 110000,
    marketplaceCommissionFils: 11000000,
    ownerNetFils: 99000000,
  };
  const readerClaim =
    "Owner cancellation notification reads leave the writer free and retain one committed snapshot";
  const resetCancellation = cancellationReset();
  const cleanup = confirmedBookingCleanup({ terminalRequest: true });
  const sessions = [];
  harness.guardDisposableLocalDatabase();
  try {
    harness.runSql(cleanup);
    assert.equal(
      harness.runSql(
        `select count(*) from public.owner_request_notifications where booking_request_id='${request}';`,
      ),
      "0",
      "cleanup removes the owned request notice",
    );
    harness.runSql(
      `${fixture("PAYMENT EVIDENCE FIXTURE")} ${fixture("CANCELLATION FIXTURE")} select pg_temp.seed_cancellation_booking('2101-01-01');`,
    );
    harness.markTimingPhase("execution");
    for (const scenario of ["duplicate", "competing-actors", "rollback"]) {
      const ownerFirst = scenario !== "duplicate";
      let openOwnerRead;
      let snapshotReader;
      if (scenario === "competing-actors") {
        openOwnerRead = harness.startSession(
          `begin; ${actor(owner)} ${ownerReadSql} select 'OWNER_NOTICE_READ_OPEN';`,
        );
        sessions.push(openOwnerRead);
        await harness.waitForMarker(openOwnerRead, "OWNER_NOTICE_READ_OPEN");
        assert.deepEqual(
          ownerSnapshot(openOwnerRead.stdout),
          beforeCancellation,
          `${readerClaim}: original committed facts`,
        );
      }
      const holder = harness.startSession(
        `begin; set application_name='cancellation_holder'; ${actor(ownerFirst ? owner : customer)} ${cancel(ownerFirst ? "cottage_owner" : "customer", "90000000-0000-4000-8000-000000003801")} select 'CANCELLATION_LOCKED';`,
      );
      sessions.push(holder);
      await harness.waitForMarker(holder, "CANCELLATION_LOCKED");
      if (openOwnerRead) {
        await harness.finishSession(openOwnerRead, { action: "commit" });
        assert.deepEqual(
          readOwnerSnapshot(),
          beforeCancellation,
          `${readerClaim}: an uncommitted writer leaves normal authenticated reads available`,
        );
      }
      const contender = harness.startSession(
        `begin; set application_name='cancellation_contender'; ${actor(customer)} ${cancel("customer", ownerFirst ? "90000000-0000-4000-8000-000000003802" : "90000000-0000-4000-8000-000000003801")} commit;`,
        true,
      );
      sessions.push(contender);
      await harness.waitForLock("cancellation_contender", contender);
      if (scenario === "competing-actors") {
        // Only this outer barrier uses harness authority; the RPC still gets the exact Owner identity.
        snapshotReader = harness.startSession(
          `begin; set application_name='cancellation_snapshot_reader';
          set local "request.jwt.claim.sub"='${owner}';
          select public.list_owner_booking_request_notifications() from
            (select id from public.booking_requests where id='${request}' offset 0 for key share) barrier;
          commit;`,
          true,
        );
        sessions.push(snapshotReader);
        await harness.waitForLock(
          "cancellation_snapshot_reader",
          snapshotReader,
        );
        assert.equal(
          harness.runSql(`select exists(
          select 1 from pg_catalog.pg_stat_activity reader
          join pg_catalog.pg_stat_activity blocker on blocker.pid=any(pg_catalog.pg_blocking_pids(reader.pid))
          where reader.application_name='cancellation_snapshot_reader'
            and blocker.application_name in ('cancellation_holder','cancellation_contender')
        );`),
          "t",
          `${readerClaim}: the original writer holds the snapshot barrier`,
        );
      }
      await harness.finishSession(holder, {
        action: scenario === "rollback" ? "rollback" : "commit",
      });
      await harness.finishSession(
        contender,
        scenario === "competing-actors"
          ? { expectedState: "RC409" }
          : undefined,
      );
      if (snapshotReader) {
        await harness.finishSession(snapshotReader);
        assert.deepEqual(
          ownerSnapshot(snapshotReader.stdout),
          beforeCancellation,
          `${readerClaim}: the held statement retains pre-cancellation facts`,
        );
        assert.deepEqual(
          readOwnerSnapshot(),
          {
            ...beforeCancellation,
            cancellationStatus: "cancelled",
            paymentStatus: null,
          },
          `${readerClaim}: a fresh authenticated read sees cancellation and original amounts`,
        );
        console.log(`${readerClaim}.`);
      }
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
          `select count(*) from public.booking_notification_events where booking_request_id='${request}' and event_kind='cancelled'`,
        ),
        "2",
        `${scenario}: two cancellation recipient events`,
      );
      assert.equal(
        harness.runSql(
          `select count(*) from public.booking_request_payment_history where booking_request_id='${request}' and to_state='cancelled'`,
        ),
        "1",
        `${scenario}: one history transition`,
      );
      harness.markTimingPhase("setup");
      harness.runSql(resetCancellation);
      harness.markTimingPhase("execution");
    }
    console.log(
      "Cancellation concurrency passed duplicate-command replay, competing actors, and transaction rollback in separate PostgreSQL sessions.",
    );
  } finally {
    harness.markTimingPhase("cleanup");
    for (const session of sessions)
      if (!session.exit) session.child.kill("SIGTERM");
    harness.runSql(cleanup);
    assert.equal(
      harness.runSql(
        `select count(*) from public.owner_request_notifications where booking_request_id='${request}';`,
      ),
      "0",
      "cleanup removes the owned request notice",
    );
  }
  timingOutcome = "passed";
} finally {
  harness.finishTiming({ outcome: timingOutcome, cleanupDisposition: "local" });
}
