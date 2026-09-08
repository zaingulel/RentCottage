import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
const identity = {
  provider: "fictional-payments",
  environment: "local-test",
  merchantId: "fictional-merchant",
  terminalId: "fictional-terminal",
};
const fixture = readFileSync(
  "supabase/tests/database/booking_request_payment_correction.test.sql",
  "utf8",
)
  .split("-- BEGIN CAPTURE RECOVERY SOURCE")[1]
  .split("-- END CAPTURE RECOVERY SOURCE")[0];
const literal = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const sessions = [];
function fixtureFor(index) {
  const lifecycle = `73000000-0000-4000-8000-00000000${index}1`;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        provider: identity,
        kind: "capture",
        paymentLifecycleId: lifecycle,
        logicalOperationId: `${lifecycle}:capture`,
        attemptId: `${lifecycle}:capture:attempt-2`,
        amountFils: 115000000,
        currency: "IQD",
      }),
    )
    .digest("hex");
  return fixture
    .replaceAll("00000000100", `00000000${index}`)
    .replaceAll("750000100", `750000${index}`)
    .replaceAll("confirmation-auth-", `history-${index}-auth-`)
    .replaceAll("CONFIRMATION-HOLD-1", `HISTORY-HOLD-${index}`)
    .replaceAll(
      "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
      fingerprint,
    );
}
const historySql = (index) => `
  set local role authenticated;
  select 'HISTORY:' || public.get_administrator_booking_request_payment_history('RC-REQ-000000000000${index}1')::text;
  reset role;
  select 'SEQUENCES:' || jsonb_agg(sequence order by sequence)::text from public.booking_request_payment_history where payment_lifecycle_id='73000000-0000-4000-8000-00000000${index}1';
`;
const histories = (session) =>
  session.stdout
    .split("\n")
    .filter((line) => line.startsWith("HISTORY:"))
    .map((line) => JSON.parse(line.slice(8)));
const sequences = (session) =>
  session.stdout
    .split("\n")
    .filter((line) => line.startsWith("SEQUENCES:"))
    .map((line) => JSON.parse(line.slice(10)));

harness.guardDisposableLocalDatabase();
try {
  for (const index of [141, 142]) {
    const request = `60000000-0000-4000-8000-00000000${index}1`;
    const session = harness.startSession(`begin;${fixtureFor(index)}
      update public.account_contexts set role='platform_administrator' where user_id='10000000-0000-4000-8000-00000000${index}3';
      set request.jwt.claims='{"sub":"10000000-0000-4000-8000-00000000${index}3","role":"authenticated","aal":"aal2"}';
      set local role service_role;
      create temp table history_lease as select public.lease_booking_request_capture_work('${request}',${literal(identity)}) result;
      create temp table history_execution as select public.execute_simulated_booking_request_capture((select result->'permit' from history_lease),'failed') result;
      reset role;
      ${historySql(index)}
      select 'HISTORY_READY';
    `);
    sessions.push({ index, request, session });
  }
  await Promise.all(
    sessions.map(({ session }) =>
      harness.waitForMarker(session, "HISTORY_READY"),
    ),
  );
  // Both real source transactions remain open; later completion must append to
  // the same original request without replacing the first execution evidence.
  for (const { index, request, session } of sessions) {
    session.child.stdin.write(`set local role service_role;
      select public.record_booking_request_capture_failure('${request}',(select (result#>>'{permit,leaseGeneration}')::bigint from history_lease),(select (result#>>'{permit,leaseToken}')::uuid from history_lease),(select result from history_execution));
      reset role;
      ${historySql(index)}
      select 'HISTORY_COMPLETED';
    `);
  }
  await Promise.all(
    sessions.map(({ session }) =>
      harness.waitForMarker(session, "HISTORY_COMPLETED"),
    ),
  );
  const allSequences = [];
  for (const { index, session } of sessions) {
    const [before, after] = histories(session);
    assert.equal(
      before.bookingRequestReference,
      `RC-REQ-000000000000${index}1`,
    );
    assert.equal(
      before.events.filter((event) => event.kind === "physical-attempt").length,
      1,
    );
    assert.equal(before.events.at(-1).outcome, "failed");
    assert.deepEqual(
      after.events.slice(0, before.events.length),
      before.events,
    );
    assert.equal(after.events.at(-1).source, "capture-work");
    assert.equal(after.events.at(-1).toState, "payment_required");
    assert.equal(
      after.events.filter((event) => event.kind === "physical-attempt").length,
      1,
    );
    const [beforeSequence, afterSequence] = sequences(session);
    assert.deepEqual(
      afterSequence.slice(0, beforeSequence.length),
      beforeSequence,
    );
    assert.equal(afterSequence.length, after.events.length);
    allSequences.push(...afterSequence);
  }
  assert.equal(new Set(allSequences).size, allSequences.length);
  console.log(
    "Concurrent real capture procedures retain one physical attempt per request and immutable ordered AAL2 history prefixes when completion appends; all fixtures roll back.",
  );
} finally {
  await Promise.all(
    sessions.map(({ session }) =>
      harness.finishSession(session, { action: "rollback" }),
    ),
  );
}
