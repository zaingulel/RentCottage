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
    "Notification upgrade requires an explicitly isolated disposable project.",
  );
harness.guardDisposableLocalDatabase();
const priorVersion = "20260911204525";
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
      `Notification upgrade ${args.join(" ")} failed: ${result.stdout ?? ""}\n${result.stderr ?? ""}`,
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
          `select coalesce(jsonb_agg(to_jsonb(source)-array['event_id','notification_id'] order by (to_jsonb(source)-array['event_id','notification_id'])::text),'[]') from public.${table} source;`,
        ),
      ),
    ]),
  );
let failure;
try {
  supabase(["db", "reset", "--local", "--version", priorVersion]);
  assert.equal(
    harness.runSql(
      "select max(version) from supabase_migrations.schema_migrations;",
    ),
    priorVersion,
  );
  const deliveries = [];
  for (const [group, suffix] of [
    ["first", "85"],
    ["second", "86"],
  ]) {
    const reference = `RC-REQ-000000000000${suffix}01`;
    const bookingReference = `NOTIFICATION-UPGRADE-${group.toUpperCase()}`;
    const seed = fixture
      .replaceAll("00000000350", `00000000${suffix}0`)
      .replaceAll("750000350", `750000${suffix}0`)
      .replaceAll("RC-REQ-0000000000003501", reference)
      .replaceAll("CONFIRMED-BOOKING-35", bookingReference)
      .replaceAll(
        "booking-request-capture:35",
        `booking-request-capture:${suffix}`,
      );
    harness.runSql(seed);
    for (const role of ["customer", "cottage_owner"]) {
      const receiptId = `82000000-0000-4000-8000-00000000${suffix}0${role === "customer" ? "2" : "1"}`;
      const payload = {
        kind: "paid-confirmation",
        title: "Booking confirmed",
        body: `Your booking ${bookingReference} is confirmed and paid.`,
        bookingReference,
        detailsPath: `/en/${role === "customer" ? "booking-requests" : "owner/booking-requests"}/${reference}`,
        linkLabel: "View confirmed booking",
        fictional: true,
      };
      harness.runSql(
        `set role service_role; select public.ensure_booking_confirmation_notification_work('${receiptId}','en','paid-confirmation-v1',${quote(payload)});`,
      );
      if (role === "customer" && group === "first") {
        deliveries.push({ receiptId, state: "pending" });
        continue;
      }
      const lease = service(
        `select public.lease_booking_confirmation_notification_work('${receiptId}');`,
      );
      const binding = withoutLease(lease);
      const args = `'${receiptId}',${lease.leaseGeneration},'${lease.leaseToken}',${quote(binding)}`;
      assert.equal(
        service(
          `select public.query_fictional_booking_confirmation_notification_effect(${args});`,
        ).status,
        "not-found",
      );
      const effect = service(
        `select public.execute_fictional_booking_confirmation_notification_effect(${args});`,
      );
      assert.equal(effect.status, "delivered");
      const interrupted = role === "customer";
      if (!interrupted)
        assert.equal(
          service(
            `select public.complete_booking_confirmation_notification_delivery(${args},'${effect.effectId}');`,
          ).status,
          "delivered",
        );
      deliveries.push({
        receiptId,
        state: interrupted ? "processing" : "delivered",
        effectId: effect.effectId,
      });
    }
  }
  const before = snapshots();
  assert.equal(before.booking_confirmation_notification_work.length, 4);
  assert.deepEqual(
    before.booking_confirmation_notification_work
      .map((row) => row.state)
      .sort(),
    ["delivered", "delivered", "pending", "processing"],
  );
  assert.equal(
    before.fictional_booking_confirmation_notification_effects.length,
    3,
  );
  supabase(["migration", "up", "--local"]);
  assert.deepEqual(
    snapshots(),
    before,
    "All original work, hash, attempt, and supplier effect fields survive upgrade unchanged",
  );
  for (const delivery of deliveries.filter(
    ({ state }) => state !== "delivered",
  )) {
    if (delivery.state === "processing")
      harness.runSql(
        `update public.booking_confirmation_notification_work set lease_expires_at=clock_timestamp()-interval '1 second' where receipt_id='${delivery.receiptId}' and event_id is null;`,
      );
    const lease = service(
      `select public.lease_booking_confirmation_notification_work('${delivery.receiptId}');`,
    );
    assert.equal(lease.logicalId, `paid-confirmation:${delivery.receiptId}`);
    assert.equal(
      lease.payloadSha256,
      before.booking_confirmation_notification_work.find(
        (row) => row.receipt_id === delivery.receiptId,
      ).payload_sha256,
    );
    const args = `'${delivery.receiptId}',${lease.leaseGeneration},'${lease.leaseToken}',${quote(withoutLease(lease))}`;
    const query = service(
      `select public.query_fictional_booking_confirmation_notification_effect(${args});`,
    );
    assert.equal(
      query.status,
      delivery.state === "processing" ? "found" : "not-found",
    );
    const effect =
      query.status === "found"
        ? query
        : service(
            `select public.execute_fictional_booking_confirmation_notification_effect(${args});`,
          );
    if (delivery.effectId) assert.equal(effect.effectId, delivery.effectId);
    assert.equal(
      service(
        `select public.complete_booking_confirmation_notification_delivery(${args},'${effect.effectId}');`,
      ).status,
      "delivered",
    );
  }
  assert.equal(
    harness.runSql(
      "select count(*) from public.fictional_booking_confirmation_notification_effects;",
    ),
    "4",
  );
  console.log(
    "Notification upgrade preserved four original notices, three existing effects, and pending/delivered/interrupted states; restart delivered only the previously unsent notice.",
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
      "Notification upgrade or disposable restoration failed",
    );
  }
}
if (failure) throw failure;
