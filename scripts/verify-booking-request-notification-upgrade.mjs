import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
import {
  request,
  customer,
  baselineFixture,
  fixture,
  cleanup,
  parse,
  json,
  binding,
} from "./booking-request-notification-fixture.mjs";
const modes = process.argv.slice(2);
if (
  modes.length > 1 ||
  (modes.length === 1 && modes[0] !== "--defer-successful-restore")
) {
  console.error(
    "Usage: node scripts/verify-booking-request-notification-upgrade.mjs [--defer-successful-restore]",
  );
  process.exit(2);
}
const workdir = process.env.SUPABASE_LOCAL_WORKDIR;
if (
  !workdir ||
  !process.env.SUPABASE_LOCAL_PROJECT ||
  process.env.SUPABASE_LOCAL_PROJECT === "rentcottage"
)
  throw new Error(
    "Request upgrade needs an explicitly disposable local project",
  );
const harness = createLocalSupabaseConcurrencyHarness();
harness.guardDisposableLocalDatabase();
const baseline = "20260913063829";
const supabase = (args) => {
  const r = spawnSync("npx", ["supabase", ...args, "--workdir", workdir], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.error || r.status !== 0)
    throw new Error(
      `Request upgrade ${args.join(" ")} failed: ${r.stdout}\n${r.stderr}`,
      { cause: r.error },
    );
};
const service = (sql) => parse(harness.runSql(`set role service_role; ${sql}`));
const snapshot = (tables) =>
  Object.fromEntries(
    tables.map((table) => [
      table,
      parse(
        harness.runSql(
          `select coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text),'[]') from public.${table} s`,
        ),
      ),
    ]),
  );
let failure;
try {
  supabase(["db", "reset", "--local", "--version", baseline]);
  assert.equal(
    harness.runSql(
      "select max(version) from supabase_migrations.schema_migrations",
    ),
    baseline,
  );
  const legacy = readFileSync(
    "supabase/fixtures/legacy-booking-notification.sql",
    "utf8",
  );
  for (const suffix of ["85", "86"]) {
    const reference = `RC-REQ-000000000000${suffix}01`,
      bookingReference = `REQUEST-UPGRADE-${suffix}`;
    harness.runSql(
      legacy
        .replaceAll("00000000350", `00000000${suffix}0`)
        .replaceAll("750000350", `750000${suffix}0`)
        .replaceAll("RC-REQ-0000000000003501", reference)
        .replaceAll("CONFIRMED-BOOKING-35", bookingReference)
        .replaceAll(
          "booking-request-capture:35",
          `booking-request-capture:${suffix}`,
        ),
    );
    for (const role of ["customer", "cottage_owner"]) {
      const receipt = `82000000-0000-4000-8000-00000000${suffix}0${role === "customer" ? "2" : "1"}`;
      const payload = {
        kind: "paid-confirmation",
        title: "Booking confirmed",
        body: "Confirmed and paid",
        bookingReference,
        detailsPath: `/en/${role === "customer" ? "booking-requests" : "owner/booking-requests"}/${reference}`,
        linkLabel: "View confirmed booking",
        fictional: true,
      };
      harness.runSql(
        `set role service_role; select public.ensure_booking_confirmation_notification_work('${receipt}','en','paid-confirmation-v1',${json(payload)});`,
      );
      if (suffix === "85" && role === "customer") continue;
      const lease = service(
        `select public.lease_booking_confirmation_notification_work('${receipt}')`,
      );
      const args = `'${receipt}',${lease.leaseGeneration},'${lease.leaseToken}',${json(binding(lease))}`;
      assert.equal(
        service(
          `select public.query_fictional_booking_confirmation_notification_effect(${args})`,
        ).status,
        "not-found",
      );
      if (suffix === "86" && role === "cottage_owner")
        harness.runSql(
          `insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline,state,quarantined_at,quarantine_reason) values('60000000-0000-4000-8000-000000008601','2100-12-31 14:00+00','quarantined',clock_timestamp(),'fixture-conflicting-evidence');`,
        );
      const effect = service(
        `select public.execute_fictional_booking_confirmation_notification_effect(${args})`,
      );
      if (suffix === "86" && role === "cottage_owner") {
        assert.equal(effect.status, "suppressed");
        continue;
      }
      if (suffix === "86")
        service(
          `select public.record_booking_confirmation_notification_failure('${receipt}',${lease.leaseGeneration},'${lease.leaseToken}','unknown')`,
        );
      else
        service(
          `select public.complete_booking_confirmation_notification_delivery(${args},'${effect.effectId}')`,
        );
    }
  }
  harness.runSql(`${baselineFixture}
    select public.claim_booking_request_action('10000000-0000-4000-8000-000000001001','${request}','accept');
    set local role service_role;
    create temp table capture as select public.lease_booking_request_capture_work('${request}','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}') lease;
    create temp table failed as select pg_temp.capture_execute((select lease->'permit' from capture),'failed') result;
    select public.record_booking_request_capture_failure('${request}',(select (lease#>>'{permit,leaseGeneration}')::bigint from capture),(select (lease#>>'{permit,leaseToken}')::uuid from capture),(select result from failed));
    reset role; select set_config('request.jwt.claim.sub','${customer}',true); set local role authenticated;
    create temp table admitted as select public.claim_customer_booking_request_payment_recovery('${request}','81000000-0000-4000-8000-000000002289','simulated-replacement') result;
    grant select on admitted to service_role; set local role service_role;
    select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from admitted),'original-release','admitted')->'permit','succeeded','original_released');
    select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step((select (result->>'attemptId')::uuid from admitted),'replacement-authorization','original_released')->'permit','failed','safely_failed');
    reset role; select public.quarantine_booking_request_payment('${request}','malformed-provider-observation'); commit;`);
  const tables = [
    "booking_confirmation_notification_work",
    "booking_confirmation_notification_attempts",
    "fictional_booking_confirmation_notification_effects",
    "booking_requests",
    "booking_snapshots",
    "booking_request_payment_history",
    "booking_request_capture_work",
    "booking_request_payment_recovery_attempts",
    "booking_receipts",
    "booking_confirmations",
    "cottage_booking_period_commitments",
    "cottage_booking_period_occupancies",
  ];
  const before = snapshot(tables);
  assert.deepEqual(
    before.booking_confirmation_notification_work.map((w) => w.state).sort(),
    ["delivered", "pending", "suppressed", "uncertain"],
  );
  supabase(["migration", "up", "--local"]);
  assert.deepEqual(
    snapshot(tables),
    before,
    "upgrade preserves every existing financial fact, notice binding, attempt and effect",
  );
  const count = () =>
    harness.runSql(
      `select count(*) from public.booking_notification_events where booking_request_id='${request}' and receipt_id is null`,
    );
  assert.equal(
    count(),
    "7",
    "migration backfills all existing request and recorded recovery sources",
  );
  const ids = harness.runSql(
    `select string_agg(id::text,',' order by id) from public.booking_notification_events where booking_request_id='${request}'`,
  );
  harness.runSql(
    `select public.ensure_booking_request_notification_events('${request}'); select public.ensure_booking_request_notification_events('${request}');`,
  );
  assert.equal(
    harness.runSql(
      `select string_agg(id::text,',' order by id) from public.booking_notification_events where booking_request_id='${request}'`,
    ),
    ids,
    "backfill replay preserves identities",
  );
  const helpers = fixture.slice(
    fixture.indexOf("create function pg_temp.notice_call"),
  );
  harness.runSql(`${helpers} do $$ declare e record; declare lease jsonb; declare effect jsonb; begin
    for e in select event_kind,recipient_role from public.booking_notification_events where booking_request_id='${request}' and receipt_id is null loop
      lease:=pg_temp.prepare_request_notice(e.event_kind,e.recipient_role); effect:=pg_temp.request_notice_call('query',lease);
      if effect->>'status'='not-found' then effect:=pg_temp.request_notice_call('execute',lease); end if;
      if effect->>'status'='delivered' then perform pg_temp.request_notice_call('complete',lease,(effect->>'effectId')::uuid); end if;
    end loop; end $$;`);
  assert.deepEqual(
    parse(
      harness.runSql(
        `select jsonb_object_agg(state,total) from (select state,count(*) total from public.booking_confirmation_notification_work where booking_request_id='${request}' group by state) s`,
      ),
    ),
    { delivered: 1, suppressed: 6 },
  );
  assert.deepEqual(
    snapshot(tables.slice(3)),
    Object.fromEntries(tables.slice(3).map((t) => [t, before[t]])),
    "suppressing obsolete backfill does not alter any valid booking or money fact",
  );
  // Retained-schema rollback uses the unchanged receipt-bearing application parser.
  // Remove the exact frozen upgrade groups before the transaction-scoped matrix.
  for (const suffix of ["10", "85", "86"])
    harness.runSql(cleanup.replaceAll("00000000100", `00000000${suffix}0`));
  const mixed = readFileSync(
    "supabase/tests/database/booking_request_notification.test.sql",
    "utf8",
  ).replace(
    "select * from finish();\nrollback;",
    "select * from finish(); select jsonb_agg(jsonb_build_object('role',actor_role,'view',view)) from mixed_financial_views; rollback;",
  );
  const observed = harness.runSql(
    `create extension if not exists pgtap with schema extensions; set search_path=public,extensions; ${mixed}`,
  );
  assert.doesNotMatch(
    observed,
    /(?:^|\n)not ok /,
    "mixed-history SQL observers pass after upgrade",
  );
  const output = resolve(".agent-evidence/request-financial-parser.mjs");
  await build({
    entryPoints: ["src/booking-request/booking-financial-view.ts"],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  const { parseBookingFinancialView } = await import(
    pathToFileURL(output).href
  );
  for (const item of parse(observed)) {
    const parsed = parseBookingFinancialView(
      item.view,
      "RC-REQ-0000000000001001",
      item.role,
    );
    assert.ok(parsed.cancellation);
    assert.ok(
      parsed.notifications.every((n) => typeof n.receiptId === "string"),
    );
  }
  console.log(
    "Request notification upgrade preserved pending, uncertain, delivered and suppressed notices; backfilled seven sources once; delivered only current recovery attention; retained-schema financial parser accepted all three mixed-history actor views.",
  );
} catch (error) {
  failure = error;
} finally {
  if (failure || modes[0] !== "--defer-successful-restore")
    try {
      harness.guardDisposableLocalDatabase();
      supabase(["db", "reset", "--local"]);
    } catch (error) {
      failure = new AggregateError(
        [...(failure ? [failure] : []), error],
        "Request upgrade or restore failed",
      );
    }
}
if (failure) throw failure;
