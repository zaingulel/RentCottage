import { readFileSync } from "node:fs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
const request = "60000000-0000-4000-8000-000000003501";
const customerReceipt = "82000000-0000-4000-8000-000000003502";
const ownerReceipt = "82000000-0000-4000-8000-000000003501";
const confirmation = "80000000-0000-4000-8000-000000003501";
const operation = "81000000-0000-4000-8000-000000003501";
const source = readFileSync(
  new URL(
    "../supabase/tests/database/booking_confirmation_access.test.sql",
    import.meta.url,
  ),
  "utf8",
);
const seedStart = source.indexOf("set session_replication_role = replica;");
const seedEnd =
  source.indexOf("set session_replication_role = origin;", seedStart) +
  "set session_replication_role = origin;".length;
if (seedStart < 0 || seedEnd < 0)
  throw new Error("Confirmed-booking fixture seed is unavailable");
const seed = source.slice(seedStart, seedEnd);
const payload = (role) =>
  JSON.stringify({
    kind: "paid-confirmation",
    title: "Booking confirmed",
    body: "Paid CONFIRMED-BOOKING-35",
    bookingReference: "CONFIRMED-BOOKING-35",
    detailsPath: `/en/${role === "customer" ? "booking-requests" : "owner/booking-requests"}/RC-REQ-0000000000003501`,
    linkLabel: "View confirmed booking",
    fictional: true,
  });
const quote = (value) => `$binding$${JSON.stringify(value)}$binding$::jsonb`;
const parse = (value) => JSON.parse(value.split("\n").filter(Boolean).at(-1));
const prepare = (receipt, role) =>
  harness.runSql(
    `set role service_role; select public.ensure_booking_confirmation_notification_work('${receipt}','en','paid-confirmation-v1',$payload$${payload(role)}$payload$::jsonb); reset role;`,
  );
const lease = (receipt) =>
  parse(
    harness.runSql(
      `set role service_role; select public.lease_booking_confirmation_notification_work('${receipt}'); reset role;`,
    ),
  );
const binding = (leased) => ({
  receiptId: leased.receiptId,
  recipientUserId: leased.recipientUserId,
  recipientRole: leased.recipientRole,
  bookingRequestReference: leased.bookingRequestReference,
  bookingReference: leased.bookingReference,
  locale: leased.locale,
  logicalId: leased.logicalId,
  templateVersion: leased.templateVersion,
  payload: leased.payload,
  payloadSha256: leased.payloadSha256,
});
const cleanup = `set session_replication_role=replica;
delete from public.booking_confirmation_notification_attempts where receipt_id in ('${customerReceipt}','${ownerReceipt}');
delete from public.fictional_booking_confirmation_notification_effects where receipt_id in ('${customerReceipt}','${ownerReceipt}');
delete from public.booking_confirmation_notification_work where receipt_id in ('${customerReceipt}','${ownerReceipt}');
delete from public.booking_request_confirmation_invalidations where booking_request_id='${request}';
delete from public.booking_request_payment_required_expiry_work where booking_request_id='${request}';
delete from public.payment_provider_operations where id='${operation}';
delete from public.booking_receipts where booking_confirmation_id='${confirmation}'; delete from public.booking_confirmations where id='${confirmation}';
delete from public.booking_request_capture_work where booking_request_id='${request}'; delete from public.booking_requests where id='${request}';
delete from public.cottage_booking_period_commitments where id='50000000-0000-4000-8000-000000003501'; delete from public.booking_snapshots where id='40000000-0000-4000-8000-000000003501';
delete from public.owner_application_cottage_profiles where id='20000000-0000-4000-8000-000000003501'; delete from public.account_contexts where user_id in ('10000000-0000-4000-8000-000000003501','10000000-0000-4000-8000-000000003502','10000000-0000-4000-8000-000000003503'); delete from auth.users where id in ('10000000-0000-4000-8000-000000003501','10000000-0000-4000-8000-000000003502','10000000-0000-4000-8000-000000003503'); set session_replication_role=origin;`;

harness.guardDisposableLocalDatabase();
const sessions = [];
try {
  harness.runSql(cleanup);
  harness.runSql(seed);
  harness.runSql(
    `set session_replication_role=replica; insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,admission,evidence_provenance) values('${operation}','72000000-0000-4000-8000-000000003501',1,'release','fictional-payments','local-test','fictional-merchant','fictional-terminal','notification-concurrency',repeat('e',64),'73000000-0000-4000-8000-000000003501','73000000-0000-4000-8000-000000003501:release','73000000-0000-4000-8000-000000003501:release:attempt-1',115000000,'IQD','{"purpose":"notification-concurrency-fixture","permit":{},"notBefore":"2100-01-01T00:00:00Z","notAfter":"2102-01-01T00:00:00Z"}','admitted'); set session_replication_role=origin;`,
  );
  prepare(customerReceipt, "customer");
  const first = lease(customerReceipt);
  harness.runSql(
    `insert into public.booking_request_payment_required_expiry_work(id,booking_request_id,payment_required_deadline,state) values('83000000-0000-4000-8000-000000003501','${request}','2100-12-31 14:00+00','processing');`,
  );
  const holder = harness.startSession(
    `set application_name='notification_invalidation_holder'; begin; select public.invalidate_booking_request_payment_confirmation('${request}','${operation}','late-capture'); select 'REQUEST_LOCKED';`,
  );
  sessions.push(holder);
  await harness.waitForMarker(holder, "REQUEST_LOCKED");
  const execute = harness.startSession(
    `set application_name='notification_execute_waiter'; set role service_role; select public.execute_fictional_booking_confirmation_notification_effect('${customerReceipt}',${first.leaseGeneration},'${first.leaseToken}',${quote(binding(first))});`,
    true,
  );
  sessions.push(execute);
  await harness.waitForLock("notification_execute_waiter", execute);
  holder.child.stdin.end(`commit;\n`);
  await harness.finishSession(holder);
  await harness.finishSession(execute);
  if (parse(execute.stdout).status !== "suppressed")
    throw new Error("Invalidation-first ordering did not suppress the effect");
  harness.runSql(
    `set session_replication_role=replica; delete from public.booking_request_confirmation_invalidations where booking_request_id='${request}'; delete from public.booking_request_payment_required_expiry_work where id='83000000-0000-4000-8000-000000003501'; update public.cottage_booking_period_commitments set status='confirmed_booking' where id='50000000-0000-4000-8000-000000003501'; set session_replication_role=origin;`,
  );
  prepare(ownerReceipt, "owner");
  const second = lease(ownerReceipt);
  harness.runSql(
    `insert into public.booking_request_payment_required_expiry_work(id,booking_request_id,payment_required_deadline,state) values('83000000-0000-4000-8000-000000003502','${request}','2100-12-31 14:00+00','processing');`,
  );
  const effect = harness.startSession(
    `set application_name='notification_effect_holder'; begin; set role service_role; select public.execute_fictional_booking_confirmation_notification_effect('${ownerReceipt}',${second.leaseGeneration},'${second.leaseToken}',${quote(binding(second))}); reset role; select 'EFFECT_LOCKED';`,
  );
  sessions.push(effect);
  await harness.waitForMarker(effect, "EFFECT_LOCKED");
  const invalidate = harness.startSession(
    `set application_name='notification_invalidation_waiter'; select public.invalidate_booking_request_payment_confirmation('${request}','${operation}','late-capture');`,
    true,
  );
  sessions.push(invalidate);
  await harness.waitForLock("notification_invalidation_waiter", invalidate);
  await harness.finishSession(effect, { action: "commit" });
  await harness.finishSession(invalidate);
  const executed = parse(effect.stdout.split("EFFECT_LOCKED")[0]);
  harness.runSql(
    `update public.booking_confirmation_notification_work set lease_expires_at=clock_timestamp()-interval '1 second' where receipt_id='${ownerReceipt}';`,
  );
  const restarted = lease(ownerReceipt);
  const found = parse(
    harness.runSql(
      `set role service_role; select public.query_fictional_booking_confirmation_notification_effect('${ownerReceipt}',${restarted.leaseGeneration},'${restarted.leaseToken}',${quote(binding(restarted))}); reset role;`,
    ),
  );
  if (found.status !== "found" || found.effectId !== executed.effectId)
    throw new Error(
      "Restarted worker did not query the durable supplier effect before dispatch",
    );
  const completed = parse(
    harness.runSql(
      `set role service_role; select public.complete_booking_confirmation_notification_delivery('${ownerReceipt}',${restarted.leaseGeneration},'${restarted.leaseToken}',${quote(binding(restarted))},'${executed.effectId}'); reset role;`,
    ),
  );
  if (completed.status !== "delivered" || completed.historical !== true)
    throw new Error(
      "Effect-first ordering did not reconcile truthful historic delivery",
    );
  const count = harness.runSql(
    `select count(*) from public.fictional_booking_confirmation_notification_effects where receipt_id='${ownerReceipt}'`,
  );
  if (count !== "1")
    throw new Error("Crash reconciliation duplicated the supplier effect");
  console.log(
    "Booking confirmation notification concurrency passed invalidation-first suppression, effect-first historic delivery, and crash reconciliation without duplicate effect.",
  );
} finally {
  for (const session of sessions)
    if (!session.exit) session.child.kill("SIGTERM");
  harness.runSql(cleanup);
}
