import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
const harness = createLocalSupabaseConcurrencyHarness();
const workdir = process.env.SUPABASE_LOCAL_WORKDIR;
if (
  !workdir ||
  !process.env.SUPABASE_LOCAL_PROJECT ||
  process.env.SUPABASE_LOCAL_PROJECT === "rentcottage"
)
  throw new Error("Payout upgrade requires an isolated disposable project");
harness.guardDisposableLocalDatabase();
const priorVersion = "20260912134922";
const source = readFileSync(
  new URL(
    "../supabase/tests/database/booking_settlement.test.sql",
    import.meta.url,
  ),
  "utf8",
);
const fixture = (name) => {
  const start = source.indexOf(`-- BEGIN ${name}`),
    end = source.indexOf(`-- END ${name}`, start);
  if (start < 0 || end < 0) throw new Error(`Missing ${name}`);
  return source.slice(start, end);
};
const request = "60000000-0000-4000-8000-000000001001";
const administrator = `set local role authenticated;set local request.jwt.claim.sub='10000000-0000-4000-8000-000000003801';set local request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000003801","aal":"aal2"}';`;
const children = [];
async function run(command, args) {
  console.log(`Starting ${command} ${args.join(" ")} (owned local upgrade)`);
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  children.push(child);
  console.log(
    execFileSync(
      "ps",
      ["-p", String(child.pid), "-o", "pid=,ppid=,pgid=,lstart=,command="],
      { encoding: "utf8" },
    ).trim(),
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(code, 0, `${command} failed: ${stderr}`);
  return stdout.trim();
}
const supabase = (args) =>
  run("npx", ["supabase", ...args, "--workdir", workdir]);
const tables = [
  "booking_requests",
  "booking_snapshots",
  "booking_request_submission_attempts",
  "booking_request_authorization_claims",
  "booking_request_capture_work",
  "booking_confirmations",
  "booking_receipts",
  "cottage_booking_period_commitments",
  "cottage_inventory_commitments",
  "payment_provider_operations",
  "payment_provider_observations",
  "simulated_payment_effects",
  "booking_request_payment_history",
  "booking_completion_maturity",
  "booking_lifecycle_outcomes",
  "booking_refund_intents",
  "booking_refund_attempts",
];
const snapshots = () =>
  Object.fromEntries(
    tables.map((table) => [
      table,
      harness.runSql(
        `select coalesce(jsonb_agg(${table === "booking_refund_intents" ? "to_jsonb(r)-'dispute_resolution_id'" : "to_jsonb(r)"} order by to_jsonb(r)::text),'[]') from public.${table} r`,
      ),
    ]),
  );
const temp = mkdtempSync(join(tmpdir(), "rentcottage-payout-upgrade-"));
let failure;
try {
  await supabase(["db", "reset", "--local", "--version", priorVersion]);
  assert.equal(
    harness.runSql(
      "select max(version) from supabase_migrations.schema_migrations",
    ),
    priorVersion,
  );
  harness.runSql(`${fixture("PAYMENT EVIDENCE FIXTURE")} ${fixture("COMPLETION FIXTURE")} select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-3);
  begin;set local role service_role;select public.commit_booking_completion('${request}',(select value->>'revision' from public.list_due_booking_completions(50) value));commit;
  begin;${administrator}select public.request_booking_refund_exception('${request}','90000000-0000-4000-8000-000000002290','Pre-upgrade refund','{"bookingPriceFils":10000000,"bookingServiceFeeFils":0}');commit;
  set role service_role;create temp table upgrade_refund_claim as select public.claim_booking_refund((select (value->>'id')::uuid from jsonb_array_elements(public.get_booking_refund_facts('${request}')->'intents') value)) value;
  select pg_temp.payment_fixture_result(public.admit_booking_refund((select value#>'{request,executionPermit}' from upgrade_refund_claim)),'succeeded');`);
  assert.equal(
    harness.runSql(
      `set role service_role;select public.get_booking_refund_facts('${request}')#>>'{refunded,bookingPriceFils}'`,
    ),
    "10000000",
  );
  const before = snapshots();
  await supabase(["migration", "up", "--local"]);
  assert.deepEqual(
    snapshots(),
    before,
    "all pre-upgrade capture, refund, completion, snapshots, receipts and history retained exactly",
  );
  for (const table of [
    "booking_payout_commands",
    "booking_settlement_intents",
    "booking_settlement_attempts",
    "booking_settlement_receipts",
  ])
    assert.equal(
      harness.runSql(`select count(*) from public.${table}`),
      "0",
      "upgrade invents no payout fact",
    );
  await build({
    entryPoints: [
      new URL("./booking-payout-process-fixture.ts", import.meta.url).pathname,
    ],
    outfile: join(temp, "fixture.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const facts = JSON.parse(
    await run(process.execPath, [join(temp, "fixture.mjs"), "facts"]),
  );
  assert.equal(facts.maturity.payoutPrerequisiteAvailable, true);
  assert.deepEqual(facts.recovery, { status: "unsettled" });
  assert.deepEqual(facts.captured, {
    bookingPriceFils: 100000000,
    bookingServiceFeeFils: 5000000,
  });
  assert.deepEqual(facts.refunded, {
    bookingPriceFils: 10000000,
    bookingServiceFeeFils: 0,
  });
  assert.deepEqual(
    JSON.parse(
      await run(process.execPath, [join(temp, "fixture.mjs"), "settle"]),
    ),
    { status: "settled" },
  );
  assert.deepEqual(
    JSON.parse(
      await run(process.execPath, [join(temp, "fixture.mjs"), "duplicate"]),
    ),
    { status: "settled" },
  );
  const settled = JSON.parse(
    await run(process.execPath, [join(temp, "fixture.mjs"), "facts"]),
  );
  assert.deepEqual(settled.recovery, {
    status: "paid",
    ownerEntitlementFils: 81000000,
    paidFils: 81000000,
    paidWhileBlocked: false,
    recoveryExposureFils: 0,
    recoveryBalanceFils: 0,
    automaticOwnerDebitFils: 0,
  });
  console.log(
    "Pre-227 real captured/refunded/matured fixture upgraded without rewritten history or invented payout; fresh application settled the preserved 81m entitlement once.",
  );
} catch (error) {
  failure = error;
} finally {
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGTERM");
  try {
    await supabase(["db", "reset", "--local"]);
  } catch (error) {
    failure ??= error;
  }
  rmSync(temp, { recursive: true, force: true });
}
if (failure) throw failure;
