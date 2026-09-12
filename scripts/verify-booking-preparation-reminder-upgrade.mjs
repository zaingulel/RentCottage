import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
const workdir = process.env.SUPABASE_LOCAL_WORKDIR;
if (
  !workdir ||
  !process.env.SUPABASE_LOCAL_PROJECT ||
  process.env.SUPABASE_LOCAL_PROJECT === "rentcottage"
)
  throw new Error(
    "Preparation reminder upgrade requires an explicitly isolated disposable project.",
  );
harness.guardDisposableLocalDatabase();
const priorVersion = "20260912045645";
const fixture = readFileSync(
  "supabase/fixtures/legacy-booking-notification.sql",
  "utf8",
);
const supabase = (args) => {
  const result = spawnSync("npx", ["supabase", ...args, "--workdir", workdir], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Preparation reminder upgrade ${args.join(" ")} failed: ${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      { cause: result.error },
    );
};
const parse = (text) => JSON.parse(text.split("\n").filter(Boolean).at(-1));
const quote = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const service = (sql) => parse(harness.runSql(`set role service_role; ${sql}`));
const withoutLease = (lease) =>
  Object.fromEntries(
    Object.entries(lease).filter(
      ([key]) =>
        !["leaseGeneration", "leaseToken", "leaseExpiresAt"].includes(key),
    ),
  );
const seeded = (suffix, label) =>
  fixture
    .replaceAll("00000000350", `00000000${suffix}0`)
    .replaceAll("750000350", `750000${suffix}0`)
    .replaceAll("RC-REQ-0000000000003501", `RC-REQ-000000000000${suffix}01`)
    .replaceAll("CONFIRMED-BOOKING-35", `REMINDER-UPGRADE-${label}`)
    .replaceAll(
      "booking-request-capture:35",
      `booking-request-capture:${suffix}`,
    );
const ids = (suffix) => ({
  request: `60000000-0000-4000-8000-00000000${suffix}01`,
  commitment: `50000000-0000-4000-8000-00000000${suffix}01`,
  snapshot: `40000000-0000-4000-8000-00000000${suffix}01`,
  confirmation: `80000000-0000-4000-8000-00000000${suffix}01`,
  operation: `81000000-0000-4000-8000-00000000${suffix}01`,
});
const receipt = (suffix, role) =>
  `82000000-0000-4000-8000-00000000${suffix}0${role === "customer" ? "2" : "1"}`;
const snapshots = () =>
  Object.fromEntries(
    [
      "booking_confirmation_notification_work",
      "booking_confirmation_notification_attempts",
      "fictional_booking_confirmation_notification_effects",
    ].map((table) => [
      table,
      parse(
        harness.runSql(
          `select coalesce(jsonb_agg(to_jsonb(source) order by to_jsonb(source)::text),'[]') from public.${table} source`,
        ),
      ),
    ]),
  );

let failure;
try {
  supabase(["db", "reset", "--local", "--version", priorVersion]);
  assert.equal(
    harness.runSql(
      "select max(version) from supabase_migrations.schema_migrations",
    ),
    priorVersion,
  );
  for (const [suffix, label] of [
    ["85", "PRESERVED-A"],
    ["86", "PRESERVED-B"],
    ["87", "STARTED"],
    ["88", "INVALID"],
    ["89", "LATE-FUTURE"],
  ])
    harness.runSql(seeded(suffix, label));

  for (const [suffix, role, target] of [
    ["85", "customer", "pending"],
    ["85", "cottage_owner", "delivered"],
    ["86", "customer", "uncertain"],
    ["86", "cottage_owner", "failed"],
  ]) {
    const targetReceipt = receipt(suffix, role);
    const payload = {
      kind: "paid-confirmation",
      title: "Booking confirmed",
      body: `Your booking REMINDER-UPGRADE-${suffix === "85" ? "PRESERVED-A" : "PRESERVED-B"} is confirmed and paid.`,
      bookingReference: `REMINDER-UPGRADE-${suffix === "85" ? "PRESERVED-A" : "PRESERVED-B"}`,
      detailsPath: `/en/${role === "customer" ? "booking-requests" : "owner/booking-requests"}/RC-REQ-000000000000${suffix}01`,
      linkLabel: "View confirmed booking",
      fictional: true,
    };
    harness.runSql(
      `set role service_role; select public.ensure_booking_confirmation_notification_work('${targetReceipt}','en','paid-confirmation-v1',${quote(payload)})`,
    );
    if (target === "pending") continue;
    const lease = service(
      `select public.lease_booking_confirmation_notification_work('${targetReceipt}')`,
    );
    const args = `'${targetReceipt}',${lease.leaseGeneration},'${lease.leaseToken}',${quote(withoutLease(lease))}`;
    if (target === "failed") {
      assert.equal(
        service(
          `select public.record_booking_confirmation_notification_failure('${targetReceipt}',${lease.leaseGeneration},'${lease.leaseToken}','failed')`,
        ).status,
        "retryable",
      );
      continue;
    }
    const effect = service(
      `select public.execute_fictional_booking_confirmation_notification_effect(${args})`,
    );
    assert.equal(effect.status, "delivered");
    if (target === "uncertain") {
      assert.equal(
        service(
          `select public.record_booking_confirmation_notification_failure('${targetReceipt}',${lease.leaseGeneration},'${lease.leaseToken}','unknown')`,
        ).status,
        "uncertain",
      );
    } else {
      assert.equal(
        service(
          `select public.complete_booking_confirmation_notification_delivery(${args},'${effect.effectId}')`,
        ).status,
        "delivered",
      );
    }
  }

  const started = ids("87");
  const invalid = ids("88");
  const lateFuture = ids("89");
  const lateFutureStart = harness.runSql(
    "select clock_timestamp()+interval '12 hours'",
  );
  harness.runSql(`set session_replication_role=replica;
    update public.booking_snapshots set quote_payload=jsonb_set(quote_payload,'{items,0,startsAt}',to_jsonb(clock_timestamp()-interval '1 hour')) where id='${started.snapshot}';
    update public.cottage_booking_period_commitments set access_ranges=tstzmultirange(tstzrange(clock_timestamp()-interval '1 hour',clock_timestamp()+interval '3 hours','[)')) where id='${started.commitment}';
    insert into public.booking_request_payment_required_expiry_work(id,booking_request_id,payment_required_deadline,state) values('83000000-0000-4000-8000-000000008801','${invalid.request}','2100-12-31 14:00+00','processing');
    insert into public.booking_request_confirmation_invalidations(booking_request_id,confirmation_id,expiry_work_id,provider_operation_id,reason) values('${invalid.request}','${invalid.confirmation}','83000000-0000-4000-8000-000000008801','${invalid.operation}','late-capture');
    update public.booking_snapshots set quote_payload=jsonb_set(quote_payload,'{items,0,startsAt}',to_jsonb('${lateFutureStart}'::timestamptz)) where id='${lateFuture.snapshot}';
    update public.cottage_booking_period_commitments set access_ranges=tstzmultirange(tstzrange('${lateFutureStart}'::timestamptz,'${lateFutureStart}'::timestamptz+interval '4 hours','[)')) where id='${lateFuture.commitment}';
    set session_replication_role=origin;`);
  const before = snapshots();
  assert.deepEqual(
    before.booking_confirmation_notification_work
      .map((row) => row.state)
      .sort(),
    ["delivered", "pending", "retryable", "uncertain"],
  );
  assert.equal(
    before.fictional_booking_confirmation_notification_effects.length,
    2,
  );

  supabase(["migration", "up", "--local"]);
  assert.deepEqual(
    snapshots(),
    before,
    "Upgrade preserves every existing work, attempt, hash, lease, and supplier effect field",
  );
  assert.equal(
    harness.runSql(
      "select count(*) from public.booking_notification_events where event_kind='preparation_reminder'",
    ),
    "6",
    "All three valid future confirmations receive two reminder intents each",
  );
  assert.equal(
    harness.runSql(
      `select count(*) from public.booking_notification_events where event_kind='preparation_reminder' and booking_request_id='${lateFuture.request}' and due_at<clock_timestamp() and first_starts_at>clock_timestamp()`,
    ),
    "2",
    "A future stay already inside the 24-hour window remains eligible for backfill",
  );
  assert.equal(
    harness.runSql(
      `select count(*) from public.booking_notification_events where event_kind='preparation_reminder' and booking_request_id in ('${started.request}','${invalid.request}')`,
    ),
    "0",
    "Started and invalidated confirmations remain excluded",
  );
  assert.equal(
    harness.runSql(
      "select count(*) from public.booking_confirmation_notification_work where event_id is not null",
    ),
    "0",
    "Backfill creates immutable intent without manufacturing delivery work",
  );
  const uncertainReceipt = receipt("86", "customer");
  const resumed = service(
    `select public.lease_booking_confirmation_notification_work('${uncertainReceipt}')`,
  );
  const resumedArgs = `'${uncertainReceipt}',${resumed.leaseGeneration},'${resumed.leaseToken}',${quote(withoutLease(resumed))}`;
  const found = service(
    `select public.query_fictional_booking_confirmation_notification_effect(${resumedArgs})`,
  );
  assert.equal(found.status, "found");
  assert.equal(
    service(
      `select public.complete_booking_confirmation_notification_delivery(${resumedArgs},'${found.effectId}')`,
    ).status,
    "delivered",
    "An uncertain retained delivery resumes from its existing supplier effect",
  );
  console.log(
    "Preparation reminder upgrade preserved pending, delivered, uncertain-after-effect, and failed notice facts; resumed the existing uncertain effect; backfilled three valid future bookings including an already-due reminder and excluded started and invalidated bookings without delivery work.",
  );
} catch (error) {
  failure = error;
} finally {
  try {
    harness.guardDisposableLocalDatabase();
    supabase(["db", "reset", "--local"]);
  } catch (error) {
    failure = new AggregateError(
      [...(failure ? [failure] : []), error],
      "Preparation reminder upgrade or disposable restoration failed",
    );
  }
}
if (failure) throw failure;
