// SQL arrangement mirrors admission, isolated effect, and explicit recording.
const paymentEvidenceSql =
  "-- BEGIN PAYMENT EVIDENCE FIXTURE\n" +
  readFileSync("supabase/fixtures/payment-evidence.sql", "utf8") +
  "\n-- END PAYMENT EVIDENCE FIXTURE\n";
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

// Reuse the established public submission scenario through its first finalized
// request: one indeterminate authorization is resolved by the real query RPC.
function verifyProviderResolution() {
  const submission = readFileSync(
    "supabase/tests/database/booking_request_submission.test.sql",
    "utf8",
  );
  const cutoff =
    "  'successful authorization finalizes one Pending Booking Request'\n);";
  assert.ok(submission.includes(cutoff));
  const result = harness.runSql(
    paymentEvidenceSql +
      (submission
        .slice(0, submission.indexOf(cutoff) + cutoff.length)
        .replace(
          "begin;",
          "begin; create extension if not exists pgtap with schema extensions; set local search_path=public,extensions;",
        ) +
        `
    reset role;
    update public.account_contexts set role='platform_administrator' where user_id=(select customer_user_id from public.booking_requests);
    select set_config('request.jwt.claims',jsonb_build_object('sub',(select customer_user_id from public.booking_requests),'role','authenticated','aal','aal2')::text,true);
    create temp table history_reference as select booking_request_reference reference from public.booking_requests;
    grant select on history_reference to authenticated;
    set local role authenticated;
    select 'RESOLVED:'||public.get_administrator_booking_request_payment_history((select reference from history_reference))::text;
    reset role;
    select 'SOURCE:'||jsonb_build_object('id',id,'originalOutcome',original_outcome,'outcome',current_outcome,'executions',(select physical_execution_count from public.simulated_payment_effects where operation_id=payment_provider_operations.id),'physicalAttemptId',physical_attempt_id,'request',provider_request_id,'reference',provider_reference,'movement',movement_reference)::text from public.payment_provider_operations;
    select 'RECEIPTS:'||count(*)::text from public.booking_request_payment_correction_observations;
    set local role service_role;
    select 'REPEAT:'||(pg_temp.payment_query((select operation from simulated_authorization_operation),null,null,'succeeded')->>'outcome');
    reset role;
    update public.payment_provider_operations set updated_at=updated_at+interval '1 second';
    set local role authenticated;
    select 'RESOLVED:'||public.get_administrator_booking_request_payment_history((select reference from history_reference))::text;
    reset role;
    -- Controlled retained-source updates isolate each meaningful observation field.
    update public.payment_provider_operations set authoritative_outcome_at='2099-01-01T00:00:00Z';
    set local role authenticated;
    select 'EVIDENCE_TIME:'||public.get_administrator_booking_request_payment_history((select reference from history_reference))::text;
    reset role;
    update public.payment_provider_operations set movement_reference='sim-movement-1234567890abcdef1234567890abcdef';
    set local role authenticated;
    select 'EVIDENCE_MOVEMENT:'||public.get_administrator_booking_request_payment_history((select reference from history_reference))::text;
    reset role;
    update public.payment_provider_operations set movement_reference=movement_reference,authoritative_outcome_at=authoritative_outcome_at,updated_at=updated_at+interval '1 second';
    set local role authenticated;
    select 'EVIDENCE_MOVEMENT:'||public.get_administrator_booking_request_payment_history((select reference from history_reference))::text;
    rollback;
  `),
  );
  assert.doesNotMatch(
    result,
    /not ok /,
    "The established submission setup must pass",
  );
  const values = (prefix) =>
    result
      .split("\n")
      .filter((line) => line.startsWith(prefix))
      .map((line) => JSON.parse(line.slice(prefix.length)));
  const [before, after] = values("RESOLVED:");
  const [source] = values("SOURCE:");
  assert.deepEqual(
    after,
    before,
    "Repeated query and timestamp-only update append no duplicate history",
  );
  assert.equal(source.originalOutcome, "indeterminate");
  assert.equal(source.outcome, "succeeded");
  assert.equal(source.executions, 1);
  assert.equal(values("RECEIPTS:")[0], 0);
  assert.match(result, /REPEAT:succeeded/);
  assert.equal(before.historyCoverage, "complete");
  const physical = before.events.filter(
    (event) => event.kind === "physical-attempt",
  );
  assert.equal(physical.length, 1);
  assert.equal(physical[0].outcome, "indeterminate");
  const transitions = before.events.filter(
    (event) =>
      event.source === "provider-operation" &&
      event.kind === "state-transition",
  );
  assert.equal(
    transitions.length,
    1,
    "Real provider query resolution is retained without inventing a receipt",
  );
  assert.equal(transitions[0].fromState, "indeterminate");
  assert.equal(transitions[0].toState, "succeeded");
  assert.equal(transitions[0].outcome, "succeeded");
  assert.equal(transitions[0].physicalAttemptId, source.physicalAttemptId);
  assert.equal(transitions[0].receivedAt, undefined);
  assert.equal(
    transitions[0].providerRequestId,
    `internal-request:${source.id}`,
  );
  assert.equal(
    transitions[0].providerReference,
    `internal-reference:${source.id}`,
  );
  assert.equal(
    transitions[0].movementReference,
    `internal-movement:${source.id}`,
  );
  assert.equal(
    before.events.filter((event) => event.kind === "receipt-observation")
      .length,
    0,
  );
  const [timeEvidence] = values("EVIDENCE_TIME:");
  const [movementEvidence, repeatedEvidence] = values("EVIDENCE_MOVEMENT:");
  for (const [previous, next] of [
    [after, timeEvidence],
    [timeEvidence, movementEvidence],
  ]) {
    assert.deepEqual(
      next.events.slice(0, previous.events.length),
      previous.events,
    );
    assert.equal(next.events.length, previous.events.length + 1);
    assert.equal(next.events.at(-1).kind, "state-transition");
    assert.equal(next.events.at(-1).fromState, "succeeded");
    assert.equal(next.events.at(-1).toState, "succeeded");
    assert.equal(
      next.events.at(-1).physicalAttemptId,
      source.physicalAttemptId,
    );
    assert.equal(next.events.at(-1).receivedAt, undefined);
  }
  assert.equal(
    timeEvidence.events.at(-1).providerOccurredAt,
    "2099-01-01T00:00:00+00:00",
  );
  assert.equal(
    movementEvidence.events.at(-1).movementReference,
    "sim-movement-1234567890abcdef1234567890abcdef",
  );
  assert.deepEqual(repeatedEvidence, movementEvidence);
  console.log(
    "Public authorization query retains indeterminate-to-succeeded transition, original physical outcome, safe internal support references and one execution without receipts; repeat query and timestamp-only update retain identical AAL2 history.",
  );
}

// Hold only the request row while querying release evidence. Detect an
// unexpected dependency and cancel the query before releasing that holder;
// never create a circular wait between the real query and lease procedures.
async function verifyReleaseDependencies() {
  const request = "60000000-0000-4000-8000-000000001431";
  const lifecycle = "73000000-0000-4000-8000-000000001431";
  const setup = fixtureFor(143)
    .split("insert into public.booking_request_capture_work")[0]
    .replace(
      "'accepted','2100-12-31 16:00+00'",
      "'pending','2100-12-31 16:00+00'",
    )
    .replace("'2100-12-31 13:00+00');", "null);");
  const cleanupSource = readFileSync(
    "scripts/verify-booking-request-capture-concurrency.mjs",
    "utf8",
  )
    .split("const cleanup = `")[1]
    .split("`;")[0];
  const cleanup = cleanupSource
    .replaceAll("${requestId}", request)
    .replaceAll("00000000100", "00000000143")
    .replace(
      "  delete from public.booking_request_release_work",
      `  update public.booking_request_release_work set active_operation_id=null where booking_request_id='${request}';
  delete from public.booking_request_release_operations where work_id in (select id from public.booking_request_release_work where booking_request_id='${request}');
  delete from public.booking_request_release_work`,
    );
  let holder,
    query,
    queryPid,
    lease,
    seeded = false;
  try {
    assert.equal(
      harness.runSql(
        paymentEvidenceSql +
          `select count(*) from public.booking_requests where id='${request}';`,
      ),
      "0",
    );
    harness.runSql(paymentEvidenceSql + `begin;${setup}commit;`);
    seeded = true;
    const setupResult = harness.runSql(
      paymentEvidenceSql +
        `begin;
      set local role service_role;
      select public.claim_booking_request_action('10000000-0000-4000-8000-000000001432','${request}','withdraw',null,null);
      reset role;
      create temp table release_snapshot as select work.id,work.lease_generation,work.lease_token,
        jsonb_set(attempts.payment_snapshot,'{release}',jsonb_build_object(
          'paymentLifecycleId',attempts.payment_lifecycle_id,'kind','release',
          'logicalOperationId',attempts.payment_lifecycle_id::text||':release',
          'attemptId',attempts.payment_lifecycle_id::text||':release:attempt-2',
          'status','pending','amountFils',claims.amount_fils,'providerRequestId',null,
          'providerReference',null,'movementReference',null,'reconciliationRequired',false,'retrySafe',false)) snapshot
        from public.booking_request_release_work work
        join public.booking_request_submission_attempts attempts on attempts.id=work.attempt_id
        join public.booking_request_authorization_claims claims on claims.attempt_id=attempts.id
        where work.booking_request_id='${request}';
      grant select on release_snapshot to service_role;
      set local role service_role;
      create temp table release_permit as select public.save_booking_request_release_snapshot(id,lease_generation,lease_token,snapshot,${literal(identity)}) permit from release_snapshot;
      select 'PERMIT:'||permit::text from release_permit;
      commit;
    `,
    );
    const permit = JSON.parse(
      setupResult
        .split("\n")
        .find((line) => line.startsWith("PERMIT:"))
        .slice(7),
    );
    const operation = {
      providerIdentity: identity,
      requestFingerprint: null,
      paymentLifecycleId: lifecycle,
      logicalOperationId: `${lifecycle}:release`,
      physicalAttemptId: `${lifecycle}:release:attempt-2`,
      operationKind: "release",
      amountFils: 115000000,
      currency: "IQD",
    };
    const execution = {
      ...operation,
      requestFingerprint: permit.requestFingerprint,
      permitPurpose: permit.purpose,
      idempotencyKey: permit.idempotencyKey,
      notAfter: permit.notAfter,
      claimId: null,
      claimGeneration: null,
      stateRevision: null,
      cleanupAttemptId: null,
      workId: permit.workId,
      leaseGeneration: permit.leaseGeneration,
      leaseToken: permit.leaseToken,
      operationId: permit.operationId,
      operationGeneration: permit.operationGeneration,
    };
    const admission = JSON.parse(
      harness.runSql(
        paymentEvidenceSql +
          `begin; set local role service_role; select public.admit_booking_request_provider_operation(${literal(execution)}); commit;`,
      ),
    );
    const querySql = `pg_temp.payment_query(${literal(operation)},null,null,'succeeded')`;
    holder = harness.startSession(
      paymentEvidenceSql +
        `begin; set application_name='history_release_holder'; select 'HOLDER_PID:'||pg_backend_pid(); select id from public.booking_requests where id='${request}' for update; select 'HOLDER_READY';`,
    );
    await harness.waitForMarker(holder, "HOLDER_READY");
    const holderPid = Number(
      holder.stdout
        .split("\n")
        .find((line) => line.startsWith("HOLDER_PID:"))
        .slice(11),
    );
    query = harness.startSession(
      paymentEvidenceSql +
        `begin; set application_name='history_release_query'; select 'QUERY_PID:'||pg_backend_pid(); set local role service_role; select 'QUERY_RESULT:'||${querySql}::text; reset role;
      select 'QUERY_STATE:'||state from public.booking_request_release_operations where work_id='${permit.workId}';
      select 'QUERY_HISTORY:'||count(*) from public.booking_request_payment_history where payment_lifecycle_id='${lifecycle}' and source='release-operation' and to_state='retryable' and outcome='not_executed';
      select 'QUERY_COMPLETE';`,
    );
    await harness.waitForMarker(query, "QUERY_PID:");
    queryPid = Number(
      query.stdout
        .split("\n")
        .find((line) => line.startsWith("QUERY_PID:"))
        .slice(10),
    );
    const started = Date.now();
    while (!query.stdout.includes("QUERY_COMPLETE")) {
      const blocked = harness.runSql(
        paymentEvidenceSql +
          `select ${holderPid}=any(pg_blocking_pids(${queryPid}));`,
      );
      if (blocked === "t") {
        harness.runSql(
          paymentEvidenceSql +
            `select pg_cancel_backend(pid) from pg_stat_activity where pid=${queryPid} and application_name='history_release_query';`,
        );
        const cancelled = query;
        query = undefined;
        await harness.finishSession(cancelled, { expectedState: "57014" });
        assert.fail(
          "Canonical release query unexpectedly depends on the held request row; query cancelled before releasing the holder",
        );
      }
      if (query.exit) throw new Error(query.stderr);
      assert.ok(
        Date.now() - started < 15000,
        "Release query must reach an observable result or dependency",
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(query.stdout, /QUERY_RESULT:.*"outcome": "not-executed"/);
    assert.match(query.stdout, /QUERY_STATE:retryable/);
    assert.match(query.stdout, /QUERY_HISTORY:1/);
    lease = harness.startSession(
      paymentEvidenceSql +
        `begin; set application_name='history_release_lease'; select 'LEASE_PID:'||pg_backend_pid(); set local role service_role; select 'LEASE_RESULT:'||public.claim_booking_request_action('10000000-0000-4000-8000-000000001432','${request}','withdraw',null,null)::text; select 'LEASE_COMPLETE';`,
    );
    await harness.waitForMarker(lease, "LEASE_PID:");
    const leasePid = Number(
      lease.stdout
        .split("\n")
        .find((line) => line.startsWith("LEASE_PID:"))
        .slice(10),
    );
    await harness.waitForLock("history_release_lease", lease);
    assert.equal(
      harness.runSql(
        paymentEvidenceSql +
          `select ${holderPid}=any(pg_blocking_pids(${leasePid})) and not ${queryPid}=any(pg_blocking_pids(${leasePid}));`,
      ),
      "t",
      "Canonical lease waits only on the held request while query has completed holding release work",
    );
    await harness.finishSession(query, { action: "rollback" });
    query = undefined;
    await harness.finishSession(holder, { action: "rollback" });
    holder = undefined;
    await harness.waitForMarker(lease, "LEASE_COMPLETE");
    assert.match(lease.stdout, /LEASE_RESULT:.*"status": "processing"/);
    await harness.finishSession(lease, { action: "rollback" });
    lease = undefined;
    // The inquiry fixture transaction rolled back its closure and recording.
    // Resume the original admitted caller; a fresh admission would reconcile instead.
    const outcome = harness.runSql(
      paymentEvidenceSql +
        `begin; set local role service_role; select pg_temp.payment_fixture_result(${literal(admission)},'succeeded')->>'outcome'; commit;`,
    );
    assert.equal(outcome, "succeeded");
    assert.equal(
      harness.runSql(
        paymentEvidenceSql +
          `select sum((select effect.physical_execution_count from public.simulated_payment_effects effect where effect.operation_id=payment_provider_operations.id)) from public.payment_provider_operations where payment_lifecycle_id='${lifecycle}';`,
      ),
      "1",
    );
    assert.equal(
      harness.runSql(
        paymentEvidenceSql +
          `select count(*) from public.booking_request_payment_history where payment_lifecycle_id='${lifecycle}' and kind='physical-attempt';`,
      ),
      "1",
    );
    console.log(
      "Canonical release query records authoritative absence without requesting the held request row; concurrent lease depends only on that holder. Original query/lease outcomes and one subsequent physical release execution are preserved.",
    );
  } finally {
    // Query is resolved or cancelled before the holder is released. The lease
    // never holds the work row while the holder is open.
    try {
      if (query) {
        if (!query.exit && !query.stdout.includes("QUERY_COMPLETE")) {
          harness.runSql(
            paymentEvidenceSql +
              `select pg_cancel_backend(pid) from pg_stat_activity where pid=${queryPid ?? "null"} and application_name='history_release_query';`,
          );
          await harness.finishSession(query, { expectedState: "57014" });
        } else {
          await harness.finishSession(
            query,
            query.exit ? {} : { action: "rollback" },
          );
        }
      }
    } finally {
      try {
        if (holder) await harness.finishSession(holder, { action: "rollback" });
      } finally {
        try {
          if (lease)
            await harness.finishSession(
              lease,
              lease.exit ? {} : { action: "rollback" },
            );
        } finally {
          if (seeded) {
            harness.guardDisposableLocalDatabase();
            harness.runSql(paymentEvidenceSql + cleanup);
          }
        }
      }
    }
  }
}

harness.guardDisposableLocalDatabase();
await verifyReleaseDependencies();
verifyProviderResolution();
try {
  for (const index of [141, 142]) {
    const request = `60000000-0000-4000-8000-00000000${index}1`;
    const session = harness.startSession(
      paymentEvidenceSql +
        `begin;${fixtureFor(index)}
      update public.account_contexts set role='platform_administrator' where user_id='10000000-0000-4000-8000-00000000${index}3';
      set request.jwt.claims='{"sub":"10000000-0000-4000-8000-00000000${index}3","role":"authenticated","aal":"aal2"}';
      set local role service_role;
      create temp table history_lease as select public.lease_booking_request_capture_work('${request}',${literal(identity)}) result;
      create temp table history_execution as select pg_temp.capture_execute((select result->'permit' from history_lease),'failed') result;
      reset role;
      ${historySql(index)}
      select 'HISTORY_READY';
    `,
    );
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
