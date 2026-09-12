import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
const request = "60000000-0000-4000-8000-000000003501";
const customer = "10000000-0000-4000-8000-000000003502";
const owner = "10000000-0000-4000-8000-000000003501";
const receipt = "82000000-0000-4000-8000-000000003501";
const event = "90000000-0000-4000-8000-000000003571";
const commitment = "50000000-0000-4000-8000-000000003501";
const source = readFileSync(
  "supabase/tests/database/booking_confirmation_access.test.sql",
  "utf8",
);
const seedStart = source.indexOf("set session_replication_role = replica;");
const seedEnd =
  source.indexOf("set session_replication_role = origin;", seedStart) +
  "set session_replication_role = origin;".length;
if (seedStart < 0 || seedEnd < 0)
  throw new Error("Confirmed-booking fixture seed is unavailable");
const seed = source.slice(seedStart, seedEnd);
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
const service = (sql) =>
  parse(harness.runSql(`set role service_role; ${sql}; reset role;`));
const cleanup = `set session_replication_role=replica;
delete from public.booking_confirmation_notification_attempts where event_id='${event}';
delete from public.fictional_booking_confirmation_notification_effects where event_id='${event}';
delete from public.booking_confirmation_notification_work where event_id='${event}';
delete from public.booking_notification_events where id='${event}';
delete from public.booking_incidents where booking_request_id='${request}';
delete from public.booking_cancellation_incidents where cancellation_id in (select id from public.booking_cancellations where booking_request_id='${request}');
delete from public.booking_cancellations where booking_request_id='${request}';
delete from public.booking_request_payment_history where booking_request_id='${request}';
delete from public.booking_receipts where booking_confirmation_id='80000000-0000-4000-8000-000000003501';
delete from public.booking_confirmations where id='80000000-0000-4000-8000-000000003501';
delete from public.booking_request_capture_work where booking_request_id='${request}';
delete from public.payment_provider_operations where id='81000000-0000-4000-8000-000000003501';
delete from public.booking_requests where id='${request}';
delete from public.cottage_booking_period_commitments where id='${commitment}';
delete from public.booking_snapshots where id='40000000-0000-4000-8000-000000003501';
delete from public.owner_application_cottage_profiles where id='20000000-0000-4000-8000-000000003501';
delete from public.account_contexts where user_id in ('${owner}','${customer}','10000000-0000-4000-8000-000000003503');
delete from auth.users where id in ('${owner}','${customer}','10000000-0000-4000-8000-000000003503');
set session_replication_role=origin;`;
const sessions = [];

const resetDelivery = (startAfter = "23 hours") => {
  const anchor = harness.runSql("select clock_timestamp()");
  harness.runSql(`set session_replication_role=replica;
    delete from public.booking_confirmation_notification_attempts where event_id='${event}';
    delete from public.fictional_booking_confirmation_notification_effects where event_id='${event}';
    delete from public.booking_confirmation_notification_work where event_id='${event}';
    delete from public.booking_incidents where booking_request_id='${request}';
    delete from public.booking_cancellation_incidents where cancellation_id in (select id from public.booking_cancellations where booking_request_id='${request}');
    delete from public.booking_cancellations where booking_request_id='${request}';
    update public.booking_snapshots set quote_payload=jsonb_set(quote_payload,'{items,0,startsAt}',to_jsonb('${anchor}'::timestamptz+interval '${startAfter}')) where id='40000000-0000-4000-8000-000000003501';
    update public.cottage_booking_period_commitments set status='confirmed_booking',access_ranges=tstzmultirange(tstzrange('${anchor}'::timestamptz+interval '${startAfter}','${anchor}'::timestamptz+interval '${startAfter}'+interval '4 hours','[)')) where id='${commitment}';
    update public.booking_notification_events set due_at='${anchor}'::timestamptz+interval '${startAfter}'-interval '24 hours',first_starts_at='${anchor}'::timestamptz+interval '${startAfter}' where id='${event}';
    update public.account_contexts set owner_approval_state='approved' where user_id='${owner}';
    update auth.users set phone_confirmed_at=clock_timestamp() where id='${owner}';
    set session_replication_role=origin;`);
  const times = parse(
    harness.runSql(
      `select jsonb_build_object('dueAt',due_at,'firstStartsAt',first_starts_at) from public.booking_notification_events where id='${event}'`,
    ),
  );
  const reminderPayload = {
    kind: "preparation_reminder",
    title: "Prepare for your booking",
    body: "Open your authenticated booking details.",
    bookingReference: "CONFIRMED-BOOKING-35",
    detailsPath: "/en/owner/booking-requests/RC-REQ-0000000000003501",
    linkLabel: "View booking",
    fictional: true,
    ...times,
  };
  harness.runSql(
    `set role service_role; select public.ensure_booking_confirmation_notification_work('${receipt}','en','booking-event-v1',${json(reminderPayload)},'${event}'); reset role;`,
  );
  return service(
    `select public.lease_booking_confirmation_notification_work('${receipt}','${event}')`,
  );
};
const executeSql = (lease) =>
  `select public.execute_fictional_booking_confirmation_notification_effect('${receipt}',${lease.leaseGeneration},'${lease.leaseToken}',${json(binding(lease))},'${event}')`;
const startExecute = (name, lease, hold = false) =>
  harness.startSession(
    `${hold ? "begin; " : ""}set application_name='${name}'; set role service_role; ${executeSql(lease)};${hold ? ` select '${name.toUpperCase()}_DONE';` : ""}`,
    !hold,
  );
const effectCount = () =>
  Number(
    harness.runSql(
      `select count(*) from public.fictional_booking_confirmation_notification_effects where event_id='${event}'`,
    ),
  );
const runRevocationRace = async ({ name, revoke, restore }) => {
  let lease = resetDelivery();
  const revoker = harness.startSession(
    `set application_name='${name}_revoke_holder'; begin; ${revoke}; select '${name.toUpperCase()}_REVOKED';`,
  );
  sessions.push(revoker);
  await harness.waitForMarker(revoker, `${name.toUpperCase()}_REVOKED`);
  const waiter = startExecute(`${name}_execute_waiter`, lease);
  sessions.push(waiter);
  await harness.waitForLock(`${name}_execute_waiter`, waiter);
  await harness.finishSession(revoker, { action: "commit" });
  await harness.finishSession(waiter);
  assert.equal(parse(waiter.stdout).status, "suppressed");
  assert.equal(effectCount(), 0);

  lease = resetDelivery();
  const delivery = startExecute(`${name}_delivery_holder`, lease, true);
  sessions.push(delivery);
  await harness.waitForMarker(
    delivery,
    `${name.toUpperCase()}_DELIVERY_HOLDER_DONE`,
  );
  const blockedRevoker = harness.startSession(
    `set application_name='${name}_revoke_waiter'; ${revoke};`,
    true,
  );
  sessions.push(blockedRevoker);
  await harness.waitForLock(`${name}_revoke_waiter`, blockedRevoker);
  await harness.finishSession(delivery, { action: "commit" });
  await harness.finishSession(blockedRevoker);
  assert.equal(
    parse(
      delivery.stdout.split(`${name.toUpperCase()}_DELIVERY_HOLDER_DONE`)[0],
    ).status,
    "delivered",
  );
  assert.equal(effectCount(), 1);
  harness.runSql(
    `update public.booking_confirmation_notification_work set lease_expires_at=clock_timestamp()-interval '1 second' where event_id='${event}';`,
  );
  const restarted = service(
    `select public.lease_booking_confirmation_notification_work('${receipt}','${event}')`,
  );
  const found = service(
    `select public.query_fictional_booking_confirmation_notification_effect('${receipt}',${restarted.leaseGeneration},'${restarted.leaseToken}',${json(binding(restarted))},'${event}')`,
  );
  assert.equal(found.status, "found");
  assert.equal(effectCount(), 1);
  harness.runSql(
    `set session_replication_role=replica; ${restore}; set session_replication_role=origin;`,
  );
};

harness.guardDisposableLocalDatabase();
try {
  harness.runSql(cleanup);
  harness.runSql(seed);
  harness.runSql(`set session_replication_role=replica;
    insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,original_outcome,current_outcome,provider_request_id,provider_reference,movement_reference,capture_execution_permit,admission,original_outcome_at,executed_at,recorded_at,evidence_provenance,authoritative_outcome_at)
    values('81000000-0000-4000-8000-000000003501','72000000-0000-4000-8000-000000003501',1,'capture','fictional-payments','local-test','fictional-merchant','fictional-terminal','reminder-concurrency-capture',repeat('e',64),'73000000-0000-4000-8000-000000003501','73000000-0000-4000-8000-000000003501:capture','73000000-0000-4000-8000-000000003501:capture:attempt-2',115000000,'IQD','succeeded','succeeded','reminder-request','reminder-reference','reminder-movement','{"purpose":"booking-request-payment-recovery","attemptId":"74000000-0000-4000-8000-000000003501","generation":1,"step":"replacement-capture","operationId":"81000000-0000-4000-8000-000000003501","idempotencyKey":"reminder-concurrency-capture","notAfter":"2101-01-01T00:00:00Z","binding":{}}','{"purpose":"reminder-concurrency-fixture","permit":{},"notBefore":"2100-01-01T00:00:00Z","notAfter":"2102-01-01T00:00:00Z"}','2100-12-31 13:00+00','2100-12-31 13:00+00','2100-12-31 13:00+00','fictional-provider','2100-12-31 13:00+00');
    insert into public.booking_notification_events(id,booking_request_id,receipt_id,event_kind,recipient_user_id,recipient_role,notice_locale,due_at,first_starts_at,created_at)
    values('${event}','${request}','${receipt}','preparation_reminder','${owner}','cottage_owner','en','2100-12-31 05:00+00','2101-01-01 05:00+00',clock_timestamp());
    set session_replication_role=origin;`);

  await runRevocationRace({
    name: "approval",
    revoke: `update public.account_contexts set owner_approval_state='suspended' where user_id='${owner}'`,
    restore: `update public.account_contexts set owner_approval_state='approved' where user_id='${owner}'`,
  });
  await runRevocationRace({
    name: "phone",
    revoke: `update auth.users set phone_confirmed_at=null where id='${owner}'`,
    restore: `update auth.users set phone_confirmed_at=clock_timestamp() where id='${owner}'`,
  });

  let lease = resetDelivery();
  const stale = lease;
  harness.runSql(
    `update public.booking_confirmation_notification_work set lease_expires_at=clock_timestamp()-interval '1 second' where event_id='${event}'`,
  );
  lease = service(
    `select public.lease_booking_confirmation_notification_work('${receipt}','${event}')`,
  );
  assert.equal(service(executeSql(stale)).status, "stale");
  assert.equal(service(executeSql(lease)).status, "delivered");
  assert.equal(effectCount(), 1);

  lease = resetDelivery("1 second");
  const expiryHolder = harness.startSession(
    `set application_name='reminder_expiry_holder'; begin; select id from public.booking_requests where id='${request}' for update; select 'REMINDER_EXPIRED'; select pg_sleep(1.5);`,
  );
  sessions.push(expiryHolder);
  await harness.waitForMarker(expiryHolder, "REMINDER_EXPIRED");
  const expiryWaiter = startExecute("reminder_expiry_waiter", lease);
  sessions.push(expiryWaiter);
  await harness.waitForLock("reminder_expiry_waiter", expiryWaiter);
  await harness.finishSession(expiryHolder, { action: "commit" });
  await harness.finishSession(expiryWaiter);
  assert.equal(parse(expiryWaiter.stdout).status, "suppressed");
  assert.equal(
    harness.runSql(
      `select state from public.booking_confirmation_notification_work where event_id='${event}'`,
    ),
    "suppressed",
  );
  assert.equal(effectCount(), 0);

  lease = resetDelivery();
  const incidentHolder = harness.startSession(
    `set application_name='reminder_incident_holder'; begin; set local role authenticated; select set_config('request.jwt.claim.sub','${owner}',true); select public.record_booking_incident('${request}','90000000-0000-4000-8000-000000003591','cottage_owner','other','Fixture incident'); select 'INCIDENT_RECORDED';`,
  );
  sessions.push(incidentHolder);
  await harness.waitForMarker(incidentHolder, "INCIDENT_RECORDED");
  const incidentWaiter = startExecute("reminder_incident_waiter", lease);
  sessions.push(incidentWaiter);
  await harness.waitForLock("reminder_incident_waiter", incidentWaiter);
  await harness.finishSession(incidentHolder, { action: "commit" });
  await harness.finishSession(incidentWaiter);
  assert.equal(parse(incidentWaiter.stdout).status, "suppressed");
  assert.equal(effectCount(), 0);

  lease = resetDelivery();
  const deliveryBeforeIncident = startExecute(
    "reminder_delivery_before_incident",
    lease,
    true,
  );
  sessions.push(deliveryBeforeIncident);
  await harness.waitForMarker(
    deliveryBeforeIncident,
    "REMINDER_DELIVERY_BEFORE_INCIDENT_DONE",
  );
  const incidentAfter = harness.startSession(
    `set application_name='reminder_incident_after'; set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false); select public.record_booking_incident('${request}','90000000-0000-4000-8000-000000003594','cottage_owner','other','Fixture incident after delivery');`,
    true,
  );
  sessions.push(incidentAfter);
  await harness.waitForLock("reminder_incident_after", incidentAfter);
  await harness.finishSession(deliveryBeforeIncident, { action: "commit" });
  await harness.finishSession(incidentAfter);
  assert.equal(effectCount(), 1);

  lease = resetDelivery();
  const cancelHolder = harness.startSession(
    `set application_name='reminder_cancel_holder'; begin; set local role authenticated; select set_config('request.jwt.claim.sub','${owner}',true); select public.commit_booking_cancellation('${request}','90000000-0000-4000-8000-000000003592','cottage_owner','Fixture cancellation',null,jsonb_build_object('revision',public.get_booking_cancellation_facts('${request}','cottage_owner')->>'revision','refundObligation','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb)); select 'CANCELLED';`,
  );
  sessions.push(cancelHolder);
  await harness.waitForMarker(cancelHolder, "CANCELLED");
  assert.equal(
    parse(cancelHolder.stdout.split("CANCELLED")[0]).status,
    "cancelled",
  );
  const cancelWaiter = startExecute("reminder_cancel_waiter", lease);
  sessions.push(cancelWaiter);
  await harness.waitForLock("reminder_cancel_waiter", cancelWaiter);
  await harness.finishSession(cancelHolder, { action: "commit" });
  await harness.finishSession(cancelWaiter);
  assert.equal(parse(cancelWaiter.stdout).status, "suppressed");
  assert.equal(effectCount(), 0);

  lease = resetDelivery();
  const deliveredFirst = startExecute(
    "reminder_delivery_before_cancel",
    lease,
    true,
  );
  sessions.push(deliveredFirst);
  await harness.waitForMarker(
    deliveredFirst,
    "REMINDER_DELIVERY_BEFORE_CANCEL_DONE",
  );
  const cancelAfter = harness.startSession(
    `set application_name='reminder_cancel_after'; set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false); select public.commit_booking_cancellation('${request}','90000000-0000-4000-8000-000000003593','cottage_owner','Fixture cancellation after delivery',null,jsonb_build_object('revision',public.get_booking_cancellation_facts('${request}','cottage_owner')->>'revision','refundObligation','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb));`,
    true,
  );
  sessions.push(cancelAfter);
  await harness.waitForLock("reminder_cancel_after", cancelAfter);
  await harness.finishSession(deliveredFirst, { action: "commit" });
  await harness.finishSession(cancelAfter);
  assert.equal(effectCount(), 1);

  console.log(
    "Preparation reminder concurrency passed owner approval and phone revocation in both lock orders, cancellation and incident suppression, fresh expiry, stale lease fencing, and effect-first restart without duplicate effects.",
  );
} finally {
  for (const session of sessions)
    if (!session.exit) session.child.kill("SIGTERM");
  await Promise.all(sessions.map((session) => session.exited));
  harness.runSql(cleanup);
}
