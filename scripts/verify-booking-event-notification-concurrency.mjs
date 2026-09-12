import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
const request = "60000000-0000-4000-8000-000000001001";
const source = readFileSync(
  "supabase/tests/database/booking_event_notification.test.sql",
  "utf8",
);
const fixtureEnd = source.indexOf("select no_plan();");
if (fixtureEnd < 0)
  throw new Error("Notification concurrency fixture is missing");
const cleanupSource = readFileSync(
  "scripts/verify-booking-refund-concurrency.mjs",
  "utf8",
);
const template = (name) => {
  const value = cleanupSource.split(`const ${name} = \``)[1]?.split("`;\n")[0];
  if (!value) throw new Error(`Missing refund cleanup ${name}`);
  return value;
};
let cleanup =
  template("resetRefunds") +
  template("resetCancellation") +
  template("cleanup").replace("${resetCancellation}", "");
for (const [key, value] of Object.entries({
  request,
  claim: "72000000-0000-4000-8000-000000001001",
  owner: "10000000-0000-4000-8000-000000001001",
  customer: "10000000-0000-4000-8000-000000001002",
}))
  cleanup = cleanup.replaceAll(`\${${key}}`, value);
const parse = (value) => JSON.parse(value.split("\n").filter(Boolean).at(-1));
const json = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const binding = (lease) =>
  Object.fromEntries(
    Object.entries(lease).filter(
      ([key]) =>
        !["leaseGeneration", "leaseToken", "leaseExpiresAt"].includes(key),
    ),
  );
const service = (sql) => parse(harness.runSql(`set role service_role; ${sql}`));
const sessions = [];
harness.guardDisposableLocalDatabase();
try {
  harness.runSql(cleanup);
  harness.runSql(
    `${source.slice(0, fixtureEnd)} select pg_temp.seed_cancellation_booking('2101-01-01'); set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true); select public.commit_booking_cancellation('${request}','90000000-0000-4000-8000-000000003845','cottage_owner','Unavailable',null,jsonb_build_object('revision',public.get_booking_cancellation_facts('${request}','cottage_owner')->>'revision','refundObligation','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb)); set local role service_role; select public.request_automatic_booking_refund('${request}',public.get_booking_refund_facts('${request}')->>'revision','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'); reset role; create temp table event_candidates as select id,receipt_id,pg_temp.notification_payload(id) payload from public.booking_notification_events where booking_request_id='${request}' and event_kind in ('cancelled','refund_requested'); grant select on event_candidates to service_role; set local role service_role; select public.ensure_booking_confirmation_notification_work(receipt_id,'en','booking-event-v1',payload,id) from event_candidates; commit;`,
  );
  const events = parse(
    harness.runSql(
      `select jsonb_agg(jsonb_build_object('id',id,'receiptId',receipt_id,'kind',event_kind) order by event_kind) from public.booking_notification_events where booking_request_id='${request}' and recipient_role='customer' and event_kind in ('cancelled','refund_requested');`,
    ),
  );
  assert.equal(events.length, 2);
  assert.equal(events[0].receiptId, events[1].receiptId);
  const event = events[0];
  const leaseSql = `select public.lease_booking_confirmation_notification_work('${event.receiptId}','${event.id}');`;
  const holder = harness.startSession(
    `begin; set application_name='event_notification_lease_holder'; set local role service_role; ${leaseSql} select 'EVENT_LEASED';`,
  );
  sessions.push(holder);
  await harness.waitForMarker(holder, "EVENT_LEASED");
  const contender = harness.startSession(
    `set application_name='event_notification_lease_contender'; set role service_role; ${leaseSql}`,
    true,
  );
  sessions.push(contender);
  await harness.waitForLock("event_notification_lease_contender", contender);
  await harness.finishSession(holder, { action: "commit" });
  await harness.finishSession(contender);
  assert.equal(
    contender.stdout.trim(),
    "",
    "Second worker cannot claim an active event lease",
  );
  const lease = parse(holder.stdout.split("EVENT_LEASED")[0]);
  const args = `'${event.receiptId}',${lease.leaseGeneration},'${lease.leaseToken}',${json(binding(lease))},'${event.id}'`;
  assert.equal(
    service(
      `select public.query_fictional_booking_confirmation_notification_effect(${args});`,
    ).status,
    "not-found",
  );
  const effectHolder = harness.startSession(
    `begin; set application_name='event_notification_effect_holder'; set local role service_role; select public.execute_fictional_booking_confirmation_notification_effect(${args}); select 'EVENT_EXECUTED';`,
  );
  sessions.push(effectHolder);
  await harness.waitForMarker(effectHolder, "EVENT_EXECUTED");
  const duplicate = harness.startSession(
    `set application_name='event_notification_effect_contender'; set role service_role; select public.execute_fictional_booking_confirmation_notification_effect(${args});`,
    true,
  );
  sessions.push(duplicate);
  await harness.waitForLock("event_notification_effect_contender", duplicate);
  await harness.finishSession(effectHolder, { action: "commit" });
  await harness.finishSession(duplicate);
  const effect = parse(effectHolder.stdout.split("EVENT_EXECUTED")[0]);
  assert.equal(
    parse(duplicate.stdout).effectId,
    effect.effectId,
    "Concurrent replay returns one durable effect",
  );
  assert.equal(
    service(
      `select public.complete_booking_confirmation_notification_delivery('${event.receiptId}',${lease.leaseGeneration},'${lease.leaseToken}',${json(binding(lease))},'${effect.effectId}','${event.id}');`,
    ).status,
    "delivered",
  );
  const other = events[1];
  const otherLease = service(
    `select public.lease_booking_confirmation_notification_work('${other.receiptId}','${other.id}');`,
  );
  assert.notEqual(
    otherLease.logicalId,
    lease.logicalId,
    "Second event on the same receipt retains a distinct delivery identity",
  );
  const otherArgs = `'${other.receiptId}',${otherLease.leaseGeneration},'${otherLease.leaseToken}',${json(binding(otherLease))},'${other.id}'`;
  assert.equal(
    service(
      `select public.query_fictional_booking_confirmation_notification_effect(${otherArgs});`,
    ).status,
    "not-found",
  );
  assert.equal(
    service(
      `select public.execute_fictional_booking_confirmation_notification_effect(${otherArgs});`,
    ).status,
    "delivered",
  );
  assert.equal(
    harness.runSql(
      `select count(*) from public.fictional_booking_confirmation_notification_effects where receipt_id='${event.receiptId}';`,
    ),
    "2",
  );
  console.log(
    "Event notification concurrency passed competing leases, duplicate execution with one supplier effect, and independent events for the same receipt.",
  );
} finally {
  for (const session of sessions)
    if (!session.exit) session.child.kill("SIGTERM");
  await Promise.all(sessions.map((session) => session.exited));
  harness.runSql(cleanup);
}
