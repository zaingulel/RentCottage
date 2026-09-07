import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
import { withPaymentRecoveryCleanup } from "../tests/fixtures/payment-recovery-cleanup.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
const requestId = "60000000-0000-4000-8000-000000001001";
const secondRequestId = "60000000-0000-4000-8000-000000001101";
const customer = "10000000-0000-4000-8000-000000001002";
const identity = {
  provider: "fictional-payments",
  environment: "local-test",
  merchantId: "fictional-merchant",
  terminalId: "fictional-terminal",
};
const literal = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const serviceSql = (sql) => `set role service_role;${sql}`;
const parsed = (sql) => JSON.parse(harness.runSql(serviceSql(sql)));
const dueSql = (limit = 1) =>
  `select public.claim_due_booking_request_payment_required_expiries(${limit},${literal(identity)});`;
const prepareSql = (id = requestId) =>
  `select public.prepare_booking_request_payment_required_expiry('${id}',${literal(identity)});`;
const finalizeSql = (id = requestId) =>
  `select public.finalize_booking_request_payment_required_expiry('${id}');`;
const prepare = (id) => parsed(prepareSql(id));
const releaseSql = (permit, outcome = "succeeded") =>
  `select public.execute_simulated_booking_request_payment_required_expiry(${literal(permit)},'${outcome}');`;
const recoverySql = (permit, outcome = "succeeded") =>
  `select public.execute_simulated_booking_request_payment_recovery(${literal(permit)},'${outcome}');`;
const lease = (id) =>
  parsed(`select public.lease_booking_request_payment_recovery_step('${id}');`);
const execute = (permit, outcome) => parsed(recoverySql(permit, outcome));
const admitSql = (command = "81000000-0000-4000-8000-000000001001") =>
  `select public.claim_customer_booking_request_payment_recovery('${requestId}','${command}','simulated-replacement');`;
const authenticated = (sql) =>
  `select set_config('request.jwt.claim.sub','${customer}',false);set role authenticated;${sql}`;
const admit = (command) =>
  JSON.parse(
    harness
      .runSql(authenticated(admitSql(command)))
      .split("\n")
      .at(-1),
  );
const querySql = (permit, outcome, result) =>
  `select public.query_simulated_booking_request_payment_recovery(${literal(permit)},'${result.providerRequestId}','${result.providerReference}','${outcome}');`;
const confirmSql = (id) =>
  `select public.finalize_booking_request_confirmation('${requestId}',public.get_booking_request_payment_recovery_confirmation_evidence('${id}'));`;
const fixture = readFileSync(
  "supabase/tests/database/booking_request_payment_recovery.test.sql",
  "utf8",
)
  .split("select plan(")[0]
  .replace(/^begin;/, "")
  .replace(
    "insert into public.booking_snapshots",
    `
insert into public.cottage_profile_source_revisions(id,profile_id,owner_user_id,source_language,description,house_rules,revision)
values('21000000-0000-4000-8000-000000001001','20000000-0000-4000-8000-000000001001','10000000-0000-4000-8000-000000001001','en','Expiry fixture description','Expiry fixture rules',1);
insert into public.cottage_profile_review_cycles(id,profile_id,owner_user_id,source_revision_id,name,governorate,approximate_location,capacity,bedrooms,bathrooms,amenities,cycle_number,state,decided_at)
values('22000000-0000-4000-8000-000000001001','20000000-0000-4000-8000-000000001001','10000000-0000-4000-8000-000000001001','21000000-0000-4000-8000-000000001001','Expiry Cottage','Baghdad','Karrada',8,3,2,array['garden'],1,'approved',now());
insert into public.cottage_publication_snapshots(id,profile_id,review_cycle_id,publication_number,name,governorate,approximate_location,capacity,bedrooms,bathrooms,amenities)
values('23000000-0000-4000-8000-000000001001','20000000-0000-4000-8000-000000001001','22000000-0000-4000-8000-000000001001',1,'Expiry Cottage','Baghdad','Karrada',8,3,2,array['garden']);
update public.owner_application_cottage_profiles set current_shift_schedule_id='30000000-0000-4000-8000-000000001001',current_publication_id='23000000-0000-4000-8000-000000001001' where id='20000000-0000-4000-8000-000000001001';
insert into public.cottage_inventory_standard_prices(schedule_revision_id,unit_kind,unit_id,price_iqd)
select schedule_revision_id,'shift',id,30000 from public.cottage_shifts where schedule_revision_id='30000000-0000-4000-8000-000000001001';
insert into public.cottage_inventory_standard_prices values('30000000-0000-4000-8000-000000001001','full_day_bundle','31000000-0000-4000-8000-000000001001',50000);
insert into public.cottage_inventory_availability(schedule_revision_id,unit_kind,unit_id,service_day,state)
select prices.schedule_revision_id,prices.unit_kind,prices.unit_id,day,'open' from public.cottage_inventory_standard_prices prices
cross join (values('2101-01-01'::date),('2101-01-02'::date)) days(day)
where prices.schedule_revision_id='30000000-0000-4000-8000-000000001001';
insert into public.booking_snapshots`,
  );
const baseCleanup = withPaymentRecoveryCleanup(
  readFileSync("scripts/verify-booking-request-capture-concurrency.mjs", "utf8")
    .split("const cleanup = `")[1]
    .split("`;\n")[0]
    .replaceAll("${requestId}", requestId)
    .replace(
      "  alter table public.cottage_shifts disable",
      "  delete from public.cottage_inventory_availability where schedule_revision_id='30000000-0000-4000-8000-000000001001';\n  delete from public.cottage_inventory_standard_prices where schedule_revision_id='30000000-0000-4000-8000-000000001001';\n  alter table public.cottage_shifts disable",
    ),
  requestId,
);
const publicationCleanup = `
  update public.owner_application_cottage_profiles set current_publication_id=null,current_shift_schedule_id=null where id='20000000-0000-4000-8000-000000001001';
  alter table public.cottage_publication_snapshots disable trigger reject_cottage_publication_snapshots_delete;
  delete from public.cottage_publication_snapshots where profile_id='20000000-0000-4000-8000-000000001001';
  alter table public.cottage_publication_snapshots enable trigger reject_cottage_publication_snapshots_delete;
  alter table public.cottage_profile_review_cycles disable trigger reject_cottage_profile_review_cycles_delete;
  delete from public.cottage_profile_review_cycles where profile_id='20000000-0000-4000-8000-000000001001';
  alter table public.cottage_profile_review_cycles enable trigger reject_cottage_profile_review_cycles_delete;
  alter table public.cottage_profile_source_revisions disable trigger reject_cottage_profile_source_delete;
  delete from public.cottage_profile_source_revisions where profile_id='20000000-0000-4000-8000-000000001001';
  alter table public.cottage_profile_source_revisions enable trigger reject_cottage_profile_source_delete;
`;
const cleanupSql = baseCleanup.replace(
  "  alter table public.cottage_shifts disable",
  publicationCleanup + "  alter table public.cottage_shifts disable",
);
const sessions = new Set();
const seeded = new Set();
const definitions = [];
const signatures = [
  "claim_due_booking_request_payment_required_expiries(integer,jsonb)",
  "prepare_booking_request_payment_required_expiry(uuid,jsonb)",
  "execute_simulated_booking_request_payment_required_expiry(jsonb,text)",
  "query_simulated_booking_request_payment_required_expiry(jsonb,text,text,text)",
  "finalize_booking_request_payment_required_expiry(uuid)",
  "booking_request_payment_required_expiry_completed(uuid)",
  "claim_customer_booking_request_payment_recovery(uuid,uuid,text)",
  "lease_booking_request_payment_recovery_step(uuid)",
  "execute_simulated_booking_request_payment_recovery(jsonb,text)",
  "query_simulated_booking_request_payment_recovery(jsonb,text,text,text)",
  "finalize_booking_request_confirmation(uuid,jsonb)",
];
const second = (sql) =>
  sql
    .replaceAll("00000000100", "00000000110")
    .replaceAll("750000100", "750000110")
    .replaceAll("confirmation-auth-", "expiry-second-auth-")
    .replaceAll("CONFIRMATION-HOLD-1", "EXPIRY-SECOND-HOLD");
function seed(id = requestId, merchantId = identity.merchantId) {
  let source = fixture;
  if (id === secondRequestId) {
    const lifecycle = "73000000-0000-4000-8000-000000001101";
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          provider: { ...identity, merchantId },
          kind: "capture",
          paymentLifecycleId: lifecycle,
          logicalOperationId: `${lifecycle}:capture`,
          attemptId: `${lifecycle}:capture:attempt-2`,
          amountFils: 115000000,
          currency: "IQD",
        }),
      )
      .digest("hex");
    source = second(source).replaceAll(
      "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
      fingerprint,
    );
  }
  source = source.replaceAll(identity.merchantId, merchantId);
  if (merchantId !== identity.merchantId) {
    // The simulator executes only its fixed identity. Seed normalized historical
    // evidence for the foreign identity, then use the existing failure recorder.
    source = source.replace(
      "create temp table confirmation_capture_result as select public.execute_simulated_booking_request_capture((select result->'permit' from confirmation_capture_lease),'failed') result;",
      `reset role;
insert into public.simulated_payment_provider_operations (
  id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
  provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,
  physical_attempt_id,amount_fils,currency,original_outcome,current_outcome,
  provider_request_id,provider_reference,capture_execution_permit,created_at,updated_at
)
select gen_random_uuid(),work.authorization_claim_id,work.authorization_claim_generation,'capture',
  work.provider,work.environment,work.merchant_id,work.terminal_id,
  work.provider_idempotency_key,work.request_fingerprint,work.payment_lifecycle_id,
  work.capture_logical_operation_id,work.capture_physical_attempt_id,work.amount_fils,work.currency,
  'failed','failed','foreign-capture-request-'||work.booking_request_id,'foreign-capture-reference-'||work.booking_request_id,
  (select result->'permit' from confirmation_capture_lease),clock_timestamp(),clock_timestamp()
from public.booking_request_capture_work work where work.booking_request_id='${id}';
set local role service_role;
create temp table confirmation_capture_result as select jsonb_build_object(
  'outcome','failed','providerRequestId','foreign-capture-request-${id}',
  'providerReference','foreign-capture-reference-${id}','retrySafe',false) result;`,
    );
  }
  harness.runSql(`begin;${source}commit;`);
  seeded.add(id);
}
function cleanup() {
  for (const id of seeded)
    harness.runSql(id === requestId ? cleanupSql : second(cleanupSql));
  seeded.clear();
}
function reset() {
  cleanup();
  seed();
  atDeadline("- interval '1 second'");
}
function atDeadline(offset = "") {
  harness.runSql(
    `update public.expiry_race_clock set instant=(select max(payment_required_deadline) ${offset} from public.booking_request_capture_work);`,
  );
}
function start(sql, close = false) {
  const session = harness.startSession(sql, close);
  sessions.add(session);
  return session;
}
async function finish(session, options) {
  await harness.finishSession(session, options);
  sessions.delete(session);
}
function result(session) {
  const line = session.stdout
    .split("\n")
    .find((value) => value.startsWith("{") || value.startsWith("["));
  assert.ok(
    line,
    "The database session must return its public-interface result",
  );
  return JSON.parse(line);
}
async function blockedBy(name, contender, holderName) {
  await harness.waitForLock(name, contender);
  assert.equal(
    harness.runSql(
      `select count(*) from pg_stat_activity contender cross join pg_stat_activity holder where contender.application_name='${name}' and holder.application_name='${holderName}' and holder.pid=any(pg_blocking_pids(contender.pid));`,
    ),
    "1",
    "The named request owner must be the actual blocker",
  );
}
async function race(
  firstSql,
  nextSql,
  label,
  {
    afterHeld = () => {},
    action = "commit",
    expectedState,
    firstRole = serviceSql,
    nextRole = serviceSql,
  } = {},
) {
  const holderName = `expiry_${label}_holder`;
  const contenderName = `expiry_${label}_contender`;
  const holder = start(
    `begin;set application_name='${holderName}';${firstRole(firstSql)}select 'EXPIRY_HELD';`,
  );
  await harness.waitForMarker(holder, "EXPIRY_HELD");
  afterHeld();
  const contender = start(
    `begin;set application_name='${contenderName}';${nextRole(nextSql)}commit;`,
    true,
  );
  await blockedBy(contenderName, contender, holderName);
  await finish(holder, { action });
  await finish(contender, { expectedState });
  return [holder, contender];
}
const graph = () =>
  JSON.parse(
    harness.runSql(`select jsonb_build_object(
  'request',(select to_jsonb(r) from public.booking_requests r where id='${requestId}'),
  'capture',(select to_jsonb(w) from public.booking_request_capture_work w where booking_request_id='${requestId}'),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by generation),'[]') from public.booking_request_payment_recovery_attempts a where booking_request_id='${requestId}'),
  'operations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from public.booking_request_payment_recovery_operations o join public.booking_request_payment_recovery_attempts a on a.id=o.recovery_attempt_id where a.booking_request_id='${requestId}'),
  'expiry',(select to_jsonb(w) from public.booking_request_payment_required_expiry_work w where booking_request_id='${requestId}'),
  'targets',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from public.booking_request_payment_required_expiry_operations o where booking_request_id='${requestId}'),
  'ledger',(select jsonb_agg(to_jsonb(o) order by o.id) from public.simulated_payment_provider_operations o where claim_id='72000000-0000-4000-8000-000000001001'),
  'commitment',(select to_jsonb(c) from public.cottage_booking_period_commitments c where id='50000000-0000-4000-8000-000000001001'),
  'inventory',(select jsonb_agg(to_jsonb(i) order by id) from public.cottage_inventory_commitments i where booking_period_commitment_id='50000000-0000-4000-8000-000000001001'),
  'occupancies',(select jsonb_agg(to_jsonb(o) order by service_day,shift_id) from public.cottage_booking_period_occupancies o where booking_period_commitment_id='50000000-0000-4000-8000-000000001001'),
  'notifications',(select coalesce(jsonb_agg(to_jsonb(n) order by id),'[]') from public.booking_request_status_notifications n where booking_request_id='${requestId}'),
  'confirmations',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from public.booking_confirmations c where booking_request_id='${requestId}'))`),
  );
function assertHeld() {
  const state = graph();
  assert.equal(state.request.status, "accepted");
  assert.equal(state.commitment.status, "pending_hold");
  assert.equal(state.occupancies.filter((row) => row.active).length, 5);
  assert.equal(
    state.notifications.filter((row) => row.status === "expired").length,
    0,
  );
  assert.equal(state.confirmations.length, 0);
}
function assertExpired() {
  const state = graph();
  assert.equal(state.request.status, "expired");
  assert.equal(state.commitment.status, "released_hold");
  assert.equal(state.occupancies.filter((row) => row.active).length, 0);
  assert.equal(state.inventory.length, 3);
  assert.equal(
    state.notifications.filter(
      (row) => row.status === "expired" && row.recipient_user_id === customer,
    ).length,
    1,
  );
  assert.equal(
    state.notifications.filter(
      (row) =>
        row.status === "expired" &&
        row.recipient_user_id === "10000000-0000-4000-8000-000000001001",
    ).length,
    1,
  );
  assert.equal(state.confirmations.length, 0);
  assert.equal(
    state.ledger.filter(
      (row) =>
        row.operation_kind === "capture" && row.current_outcome === "succeeded",
    ).length,
    0,
  );
  assert.ok(state.ledger.every((row) => row.physical_execution_count === 1));
  assert.equal(
    new Set(state.ledger.map((row) => row.provider_idempotency_key)).size,
    state.ledger.length,
  );
}
function drain() {
  for (let count = 0; count < 4; count++) {
    const prepared = prepare();
    if (prepared.status === "release") parsed(releaseSql(prepared.permit));
    else
      assert.ok(
        ["ready", "expired"].includes(prepared.status),
        `Unexpected safe-drain state ${prepared.status}`,
      );
    if (parsed(finalizeSql()).status === "expired") return;
  }
  assert.fail("The bounded fixture release inventory did not finish");
}

function assertAvailability(released) {
  const calendar = parsed(
    "select public.resolve_cottage_inventory_owner_calendar('20000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001','2101-01-02');",
  );
  const availability = parsed(
    "select public.resolve_cottage_inventory_public_availability('20000000-0000-4000-8000-000000001001','30000000-0000-4000-8000-000000001001','2101-01-02');",
  );
  assert.equal(calendar.units.length, 4);
  assert.equal(availability.units.length, 4);
  assert.ok(availability.units.every((unit) => unit.available === released));
  assert.ok(
    calendar.units.every(
      (unit) => unit.calendarState === (released ? "open" : "pending_hold"),
    ),
  );
  assert.ok(
    availability.units.every(
      (unit) => Object.keys(unit).sort().join(",") === "available,id,kind",
    ),
    "Public availability must not disclose private hold identity",
  );
}
function assertOverlap(released) {
  const sql = `begin;
    insert into public.cottage_booking_period_commitments(id,customer_user_id,profile_id,schedule_revision_id,commitment_reference,status,access_ranges)
      select '50000000-0000-4000-8000-000000009999',customer_user_id,profile_id,schedule_revision_id,'EXPIRY-OVERLAP-PROBE','pending_hold',access_ranges from public.cottage_booking_period_commitments where id='50000000-0000-4000-8000-000000001001';
    insert into public.cottage_booking_period_occupancies(booking_period_commitment_id,schedule_revision_id,shift_id,service_day,active)
      values('50000000-0000-4000-8000-000000009999','30000000-0000-4000-8000-000000001001','32000000-0000-4000-8000-000000001003','2101-01-01',true);
    rollback;`;
  if (released) harness.runSql(sql);
  else
    assert.throws(
      () => harness.runSql(sql),
      /overlap|duplicate key|conflicting key/i,
      "The held cross-midnight shift must reject an overlapping occupancy",
    );
}
async function proveRequestFirst(sql, label) {
  const holderName = `expiry_order_${label}_holder`;
  const contenderName = `expiry_order_${label}_contender`;
  const holder = start(
    `begin;set application_name='${holderName}';select 1 from public.booking_requests where id='${requestId}' for update;select 'ORDER_HELD';`,
  );
  await harness.waitForMarker(holder, "ORDER_HELD");
  const contender = start(
    `begin;set application_name='${contenderName}';${serviceSql(sql)}rollback;`,
    true,
  );
  await blockedBy(contenderName, contender, holderName);
  harness.runSql(`begin;
    select 1 from public.booking_request_capture_work where booking_request_id='${requestId}' for update nowait;
    select 1 from public.booking_request_submission_attempts where booking_request_id='${requestId}' for update nowait;
    select 1 from public.booking_request_authorization_claims where id='72000000-0000-4000-8000-000000001001' for update nowait;
    select 1 from public.booking_request_payment_required_expiry_work where booking_request_id='${requestId}' for update nowait;
    select 1 from public.booking_request_payment_required_expiry_operations where booking_request_id='${requestId}' for update nowait;
    select 1 from public.cottage_booking_period_commitments where id='50000000-0000-4000-8000-000000001001' for update nowait;
    rollback;`);
  await finish(holder, { action: "rollback" });
  await finish(contender);
}

harness.guardDisposableLocalDatabase();
try {
  seed();
  for (const signature of signatures)
    definitions.push(
      harness.runSql(
        `select pg_get_functiondef('public.${signature}'::regprocedure);`,
      ),
    );
  harness.runSql(
    "create table public.expiry_race_clock(instant timestamptz not null);insert into public.expiry_race_clock values(clock_timestamp());create function public.expiry_race_now() returns timestamptz language sql volatile security definer set search_path='' as $$select instant from public.expiry_race_clock$$;",
  );
  for (const definition of definitions)
    harness.runSql(
      definition.replaceAll("clock_timestamp()", "public.expiry_race_now()"),
    );
  const otherIdentity = { ...identity, merchantId: "fictional-other-merchant" };
  seed(secondRequestId, otherIdentity.merchantId);
  atDeadline();
  const otherDueSql = `select public.claim_due_booking_request_payment_required_expiries(1,${literal(otherIdentity)});`;
  assert.deepEqual(
    parsed(otherDueSql).map((row) => row.bookingRequestId),
    [secondRequestId],
    "An earlier row for another provider identity must not block matching due work",
  );
  assert.deepEqual(
    parsed(dueSql(50)).map((row) => row.bookingRequestId),
    [requestId],
    "Each provider batch must exclude the other identity's due request",
  );
  const matchingBusy = start(
    `begin;select 1 from public.booking_requests where id='${secondRequestId}' for update;select 'MATCHING_BUSY';`,
  );
  await harness.waitForMarker(matchingBusy, "MATCHING_BUSY");
  assert.deepEqual(
    parsed(otherDueSql),
    [],
    "A matching locked request is skipped",
  );
  assert.deepEqual(
    parsed(dueSql()).map((row) => row.bookingRequestId),
    [requestId],
    "A lock held for another provider does not block the matching batch",
  );
  await finish(matchingBusy, { action: "rollback" });
  console.log(
    "Provider-scoped due batches ignore an earlier foreign identity, retain per-row filtering, and skip only matching locked work.",
  );
  reset();
  seed(secondRequestId);
  atDeadline("+ interval '1 second'");
  const busy = start(
    `begin;set application_name='expiry_due_busy';select 1 from public.booking_requests where id='${requestId}' for update;select 'BUSY';`,
  );
  await harness.waitForMarker(busy, "BUSY");
  assert.deepEqual(
    parsed(dueSql()).map((row) => row.bookingRequestId),
    [secondRequestId],
    "A bounded due batch must skip a locked request and admit the next eligible request",
  );
  await finish(busy, { action: "rollback" });
  console.log(
    "Due batching skips a locked request using real PostgreSQL ownership and admits the next eligible request.",
  );

  const firstBatch = start(
    `begin;set application_name='expiry_batch_owner';${serviceSql(dueSql())}select 'BATCH_HELD';`,
  );
  await harness.waitForMarker(firstBatch, "BATCH_HELD");
  const otherBatch = start(`begin;${serviceSql(dueSql())}commit;`, true);
  await finish(otherBatch);
  assert.deepEqual(
    result(firstBatch).map((row) => row.bookingRequestId),
    [requestId],
  );
  assert.deepEqual(
    result(otherBatch).map((row) => row.bookingRequestId),
    [secondRequestId],
  );
  await finish(firstBatch, { action: "commit" });
  const failedRelease = prepare();
  parsed(releaseSql(failedRelease.permit, "failed"));
  assert.equal(parsed(finalizeSql()).status, "attention-required");
  assert.deepEqual(
    parsed(dueSql()).map((row) => row.bookingRequestId),
    [secondRequestId],
    "A previously evaluated blocked request cannot starve a later healthy request",
  );
  const healthyRelease = prepare(secondRequestId);
  parsed(releaseSql(healthyRelease.permit));
  assert.equal(parsed(finalizeSql(secondRequestId)).status, "expired");
  assertHeld();
  console.log(
    "Competing bounded claims select different requests; durable attention does not starve healthy expiry.",
  );

  reset();
  atDeadline();
  const unchanged = graph();
  const preparedPair = await race(
    prepareSql(),
    prepareSql(),
    "prepare_duplicate",
  );
  assert.deepEqual(result(preparedPair[0]), result(preparedPair[1]));
  const permit = result(preparedPair[0]).permit;
  assert.equal(graph().targets.length, 1);
  assertAvailability(false);
  assertOverlap(false);
  await proveRequestFirst(releaseSql(permit), "release");
  const releasedPair = await race(
    releaseSql(permit),
    releaseSql(permit),
    "release_duplicate",
  );
  assert.deepEqual(result(releasedPair[0]), result(releasedPair[1]));
  // Discard the first provider response, then recover by replaying the same persisted operation.
  const afterRelease = graph();
  assert.deepEqual(parsed(releaseSql(permit)), result(releasedPair[0]));
  assert.deepEqual(graph(), afterRelease);
  await proveRequestFirst(finalizeSql(), "finalize");
  const interrupted = start(
    `begin;${serviceSql(finalizeSql())}select 'FINALIZATION_UNCOMMITTED';`,
  );
  await harness.waitForMarker(interrupted, "FINALIZATION_UNCOMMITTED");
  assertHeld();
  await finish(interrupted, { action: "rollback" });
  assert.deepEqual(
    graph(),
    afterRelease,
    "Interrupted finalization must roll back its entire terminal graph",
  );
  const completedPair = await race(
    finalizeSql(),
    finalizeSql(),
    "finalize_duplicate",
  );
  assert.deepEqual(result(completedPair[0]), result(completedPair[1]));
  assertExpired();
  assertAvailability(true);
  assertOverlap(true);
  assert.deepEqual(
    graph().capture,
    unchanged.capture,
    "Expiry preserves original capture work and the fixed deadline",
  );
  assert.deepEqual(
    graph().inventory,
    unchanged.inventory,
    "Expiry retains selected inventory history",
  );
  const completedGraph = graph();
  assert.equal(parsed(finalizeSql()).status, "expired");
  parsed(releaseSql(permit, "failed"));
  assert.deepEqual(
    graph(),
    completedGraph,
    "Completed replay cannot rewrite timestamps or repeat notifications",
  );
  console.log(
    "Concurrent prepare/release/finalize, lost responses and interrupted finalization preserve one physical release and exactly two notices; inventory and overlap observers distinguish held from released.",
  );

  reset();
  await race(
    `select 1 from public.booking_requests where id='${requestId}' for update;`,
    admitSql(),
    "admit_deadline",
    {
      firstRole: (sql) => sql,
      nextRole: authenticated,
      afterHeld: () => atDeadline(),
      expectedState: "RC409",
    },
  );
  assert.equal(graph().attempts.length, 0);
  assertHeld();
  console.log(
    "A Customer admission waiting across the deadline is rejected after acquiring the governing request lock.",
  );

  reset();
  const authorizing = admit().attemptId;
  execute(lease(authorizing).permit);
  const authorizationPermit = lease(authorizing).permit;
  const authorizedFirst = await race(
    recoverySql(authorizationPermit),
    prepareSql(),
    "authorization_wins",
    { afterHeld: () => atDeadline() },
  );
  assert.equal(result(authorizedFirst[0]).outcome, "succeeded");
  assert.equal(result(authorizedFirst[1]).status, "release");
  assert.equal(
    result(authorizedFirst[1]).permit.binding.authorizationPaymentLifecycleId,
    authorizing,
  );
  drain();
  assertExpired();
  console.log(
    "Authorisation executed before the deadline remains discoverable after its transaction commits and is released by expiry.",
  );

  for (const step of ["replacement-authorization", "replacement-capture"]) {
    reset();
    const attempt = admit().attemptId;
    execute(lease(attempt).permit);
    if (step === "replacement-capture") execute(lease(attempt).permit);
    const stalePermit = lease(attempt).permit;
    assert.equal(stalePermit.step, step);
    atDeadline();
    const pair = await race(
      prepareSql(),
      recoverySql(stalePermit),
      `stale_${step}`,
    );
    assert.equal(result(pair[1]).outcome, "not-executed");
    drain();
    assertExpired();
    assert.equal(
      graph().ledger.filter(
        (row) =>
          row.recovery_attempt_id === attempt &&
          row.operation_kind ===
            (step === "replacement-authorization"
              ? "authorization"
              : "capture"),
      ).length,
      0,
    );
  }
  console.log(
    "Previously issued authorisation and capture permits produce no new effect after expiry wins ownership at the deadline.",
  );

  for (const expiryWins of [false, true]) {
    reset();
    const attempt = admit().attemptId;
    execute(lease(attempt).permit);
    execute(lease(attempt).permit);
    execute(lease(attempt).permit, "failed");
    const recoveryRelease = lease(attempt).permit;
    atDeadline();
    const pair = expiryWins
      ? await race(
          prepareSql(),
          recoverySql(recoveryRelease),
          "release_expiry_wins",
        )
      : await race(
          recoverySql(recoveryRelease),
          prepareSql(),
          "release_recovery_wins",
        );
    if (expiryWins) assert.equal(result(pair[1]).outcome, "not-executed");
    else assert.equal(result(pair[1]).status, "ready");
    drain();
    assertExpired();
    assert.equal(
      graph().ledger.filter((row) => row.operation_kind === "release").length,
      2,
    );
    assert.equal(
      graph().targets.filter(
        (target) =>
          target.authorization_payment_lifecycle_id === attempt &&
          target.owner === (expiryWins ? "expiry" : "recovery"),
      ).length,
      1,
    );
  }
  console.log(
    "Both lock-winning orders between recovery replacement release and expiry retain exactly one canonical release per authorisation.",
  );

  for (const step of [
    "original-release",
    "replacement-authorization",
    "replacement-capture",
    "replacement-release",
  ]) {
    for (const expiryWins of [false, true]) {
      reset();
      const attempt = admit().attemptId;
      for (
        let preceding = 0;
        preceding < 3 && lease(attempt).permit.step !== step;
        preceding++
      ) {
        const next = lease(attempt).permit;
        execute(
          next,
          next.step === "replacement-capture" ? "failed" : "succeeded",
        );
      }
      const uncertainPermit = lease(attempt).permit;
      assert.equal(uncertainPermit.step, step);
      const uncertain = execute(uncertainPermit, "indeterminate");
      atDeadline();
      const query = querySql(
        uncertainPermit,
        step === "replacement-capture" ? "failed" : "succeeded",
        uncertain,
      );
      if (expiryWins) {
        const pair = await race(
          prepareSql(),
          query,
          `query_${step}_expiry_first`,
        );
        assert.equal(result(pair[0]).status, "reconcile-recovery");
      } else await race(query, prepareSql(), `query_${step}_query_first`);
      drain();
      assertExpired();
      const settled = graph();
      const delayed = start(`begin;${serviceSql(query)}commit;`, true);
      await finish(delayed);
      assert.equal(
        result(delayed).outcome,
        step === "replacement-capture" ? "failed" : "succeeded",
      );
      assert.deepEqual(
        graph(),
        settled,
        "A delayed query after another worker completes expiry must replay without mutation",
      );
      assert.throws(
        () =>
          parsed(
            querySql(uncertainPermit, "succeeded", {
              ...uncertain,
              providerRequestId: "foreign-request",
            }),
          ),
        /RC409|binding is invalid/,
      );
      assert.deepEqual(graph(), settled);
    }
  }
  console.log(
    "All four indeterminate recovery operations resolve safely in both query/expiry lock orders; delayed and wrong-binding terminal queries cannot change money or completion.",
  );

  reset();
  const preDeadline = admit().attemptId;
  execute(lease(preDeadline).permit);
  execute(lease(preDeadline).permit);
  execute(lease(preDeadline).permit);
  atDeadline();
  const beforeConfirmation = graph();
  const confirmationRace = await race(
    prepareSql(),
    confirmSql(preDeadline),
    "predeadline_confirmation",
  );
  assert.equal(result(confirmationRace[0]).status, "attention-required");
  const confirmed = graph();
  assert.equal(confirmed.confirmations.length, 1);
  assert.equal(confirmed.request.status, "accepted");
  assert.equal(confirmed.targets.length, 0);
  assert.equal(
    confirmed.notifications.filter((row) => row.status === "expired").length,
    0,
  );
  assert.deepEqual(confirmed.capture, beforeConfirmation.capture);
  assert.equal(prepare().status, "confirmed");
  assert.equal(parsed(finalizeSql()).status, "confirmed");
  assert.equal(parsed(dueSql()).length, 0);
  console.log(
    "A pre-deadline successful capture confirms after expiry preparation and after the deadline, with no expiry release or notice.",
  );

  for (const offset of ["", "+ interval '1 second'"]) {
    reset();
    const attempt = admit().attemptId;
    execute(lease(attempt).permit);
    execute(lease(attempt).permit);
    const capturePermit = lease(attempt).permit;
    const uncertain = execute(capturePermit, "indeterminate");
    atDeadline(offset);
    const pair = await race(
      querySql(capturePermit, "succeeded", uncertain),
      prepareSql(),
      `late_capture_${offset ? "after" : "equal"}`,
    );
    assert.equal(result(pair[1]).status, "attention-required");
    assert.equal(parsed(finalizeSql()).status, "attention-required");
    assertHeld();
    assert.equal(graph().attempts[0].state, "late_succeeded");
    assert.equal(graph().targets.length, 0);
    assert.throws(() => parsed(confirmSql(attempt)));
  }
  console.log(
    "Captures resolving successfully exactly at or after the deadline retain inventory, evidence and durable attention without confirmation or expiry.",
  );

  reset();
  const firstGeneration = admit().attemptId;
  for (const outcome of ["succeeded", "succeeded", "failed", "succeeded"])
    execute(lease(firstGeneration).permit, outcome);
  const secondGeneration = admit(
    "81000000-0000-4000-8000-000000001002",
  ).attemptId;
  execute(lease(secondGeneration).permit, "failed");
  admit("81000000-0000-4000-8000-000000001003");
  const generations = graph();
  atDeadline();
  await race(prepareSql(), finalizeSql(), "all_generations");
  assertExpired();
  assert.deepEqual(graph().attempts, generations.attempts);
  assert.deepEqual(graph().operations, generations.operations);
  assert.equal(graph().targets.length, 2);
  assert.equal(
    graph().targets.filter((target) => target.owner === "recovery").length,
    2,
  );
  console.log(
    "Multiple safely failed generations retain their immutable history and earlier original/replacement release evidence through finalization.",
  );
} finally {
  for (const session of sessions) {
    if (!session.child.stdin.destroyed && !session.child.stdin.writableEnded)
      session.child.stdin.end("rollback;\n");
    await session.exited;
  }
  for (const definition of definitions) harness.runSql(definition);
  if (definitions.length)
    harness.runSql(
      "drop function if exists public.expiry_race_now();drop table if exists public.expiry_race_clock;",
    );
  cleanup();
}
