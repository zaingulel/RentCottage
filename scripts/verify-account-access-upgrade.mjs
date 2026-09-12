import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const priorVersion = "20260909221736";
const tables = {
  "auth.users": 5,
  "public.account_contexts": 5,
  "public.owner_application_cottage_profiles": 1,
  "public.booking_requests": 2,
  "public.booking_snapshots": 2,
  "public.cottage_booking_period_commitments": 2,
  "public.booking_request_capture_work": 1,
  "public.booking_confirmations": 1,
  "public.booking_receipts": 2,
  "public.cottage_shift_schedule_revisions": 1,
  "public.cottage_shifts": 2,
  "public.cottage_inventory_commitments": 2,
  "public.cottage_booking_period_occupancies": 2,
  "public.booking_request_submission_attempts": 2,
  "public.booking_request_authorization_claims": 2,
  "public.booking_request_authorization_claim_items": 2,
  "public.booking_request_authorization_claim_occupancies": 2,
  "public.payment_provider_operations": 1,
  "public.payment_provider_observations": 1,
};

export function verifyAccountAccessUpgrade({
  environment = process.env,
  harness = createLocalSupabaseConcurrencyHarness({ environment }),
  runSupabase,
  readFixture = () =>
    readFileSync("supabase/fixtures/legacy-account-access.sql", "utf8"),
} = {}) {
  if (
    !environment.SUPABASE_LOCAL_WORKDIR ||
    !environment.SUPABASE_LOCAL_PROJECT ||
    environment.SUPABASE_LOCAL_PROJECT === "rentcottage"
  )
    throw new Error(
      "Account upgrade requires an explicitly isolated disposable project and workdir.",
    );
  // A failed initial ownership check must never reach reset, including the restore path.
  harness.guardDisposableLocalDatabase();
  const run =
    runSupabase ??
    ((args) => {
      const result = spawnSync(
        "npx",
        ["supabase", ...args, "--workdir", environment.SUPABASE_LOCAL_WORKDIR],
        { encoding: "utf8", env: environment, maxBuffer: 10 * 1024 * 1024 },
      );
      if (result.error || result.status !== 0)
        throw new Error(
          `Guarded account upgrade ${args.join(" ")} failed: ${result.stdout ?? ""}\n${result.stderr ?? ""}`,
          { cause: result.error },
        );
      return result;
    });
  const snapshot = () =>
    Object.fromEntries(
      Object.entries(tables).map(([table, count]) => {
        const rows = JSON.parse(
          harness.runSql(
            `select coalesce(jsonb_agg(to_jsonb(r) order by coalesce(to_jsonb(r)->>'id',to_jsonb(r)->>'user_id',to_jsonb(r)->>'booking_request_id',to_jsonb(r)->>'booking_period_commitment_id',to_jsonb(r)->>'claim_id'),to_jsonb(r)->>'service_day',to_jsonb(r)->>'shift_id'),'[]') from ${table} r;`,
          ),
        );
        assert.equal(
          rows.length,
          count,
          `Frozen fixture coverage for ${table}`,
        );
        return [table, rows];
      }),
    );
  const asCustomer = (sql) =>
    harness
      .runSql(
        `begin; set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000002142',true); ${sql} rollback;`,
      )
      .split("\n")
      .at(-1);
  let failure;
  try {
    run(["db", "reset", "--local", "--version", priorVersion]);
    assert.equal(
      harness.runSql(
        "select max(version) from supabase_migrations.schema_migrations;",
      ),
      priorVersion,
      "Upgrade starts on the exact predecessor",
    );
    harness.runSql(`begin; ${readFixture()} commit;`);
    const before = snapshot();
    assert.deepEqual(
      before["public.account_contexts"]
        .map((row) => [row.user_id, row.role, row.owner_approval_state])
        .sort(),
      [
        ["10000000-0000-4000-8000-000000002141", "cottage_owner", "approved"],
        ["10000000-0000-4000-8000-000000002142", "customer", null],
        [
          "10000000-0000-4000-8000-000000002143",
          "cottage_owner",
          "prospective",
        ],
        ["10000000-0000-4000-8000-000000002144", "cottage_owner", "suspended"],
        [
          "10000000-0000-4000-8000-000000002145",
          "platform_administrator",
          null,
        ],
      ],
    );
    assert.deepEqual(
      before["public.booking_requests"]
        .map((row) => [
          row.booking_request_reference,
          row.customer_user_id,
          row.owner_user_id,
          row.status,
        ])
        .sort(),
      [
        [
          "RC-REQ-0000000000002141",
          "10000000-0000-4000-8000-000000002142",
          "10000000-0000-4000-8000-000000002141",
          "accepted",
        ],
        [
          "RC-REQ-0000000000002142",
          "10000000-0000-4000-8000-000000002142",
          "10000000-0000-4000-8000-000000002141",
          "pending",
        ],
      ],
    );
    run(["migration", "up", "--local"]);
    // Historical bookings gain only a null scheduling field. Keep it in the
    // expected graph so the later enrollment comparison also preserves it.
    before["public.booking_requests"] = before["public.booking_requests"].map(
      (row) => ({ ...row, refund_last_scheduled_at: null }),
    );
    assert.deepEqual(
      snapshot(),
      before,
      "Migration preserves nonempty identity, approval, booking, payment and receipt records before enrollment",
    );
    const enrolled = JSON.parse(
      harness
        .runSql(
          "begin; set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000002142',true); select row_to_json(public.claim_marketplace_role('cottage_owner')); commit;",
        )
        .split("\n")
        .at(-1),
    );
    assert.equal(enrolled.user_id, "10000000-0000-4000-8000-000000002142");
    assert.equal(enrolled.role, "cottage_owner");
    assert.equal(enrolled.owner_approval_state, "prospective");
    assert.equal(
      asCustomer(
        "select public.get_confirmed_booking_access('RC-REQ-0000000000002141')->>'actorRole';",
      ),
      "customer",
      "Migrated customer receipt remains readable after owner enrollment",
    );
    const afterEnrollment = snapshot();
    const expectedContexts = before["public.account_contexts"].map((row) =>
      row.user_id === enrolled.user_id
        ? { ...row, role: "cottage_owner", owner_approval_state: "prospective" }
        : row,
    );
    assert.deepEqual(
      afterEnrollment,
      { ...before, "public.account_contexts": expectedContexts },
      "Only the explicitly enrolled account classification changes; historical obligations remain unchanged",
    );
    const approved = harness
      .runSql(
        "begin; set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000002141',true); select public.claim_marketplace_role('customer'); select (public.claim_marketplace_role('cottage_owner')).owner_approval_state; rollback;",
      )
      .split("\n")
      .at(-1);
    assert.equal(
      approved,
      "approved",
      "Repeated enrollment never resets approved owner access",
    );
    harness.runSql(
      "update public.account_contexts set owner_approval_state='suspended' where user_id in ('10000000-0000-4000-8000-000000002141','10000000-0000-4000-8000-000000002142');",
    );
    assert.equal(
      asCustomer(
        "select public.get_confirmed_booking_access('RC-REQ-0000000000002141')->>'actorRole';",
      ),
      "customer",
      "Suspension retains the owner's own customer receipt",
    );
    assert.equal(
      harness
        .runSql(
          "begin; set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000002141',true); select public.get_confirmed_booking_access('RC-REQ-0000000000002141') is null; rollback;",
        )
        .split("\n")
        .at(-1),
      "t",
      "Suspension denies owner private receipt access",
    );
    assert.throws(
      () =>
        harness.runSql(
          "begin; set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000002145',true); select public.claim_marketplace_role('cottage_owner'); rollback;",
        ),
      /verified phone identity|different marketplace role/,
      "Administrators cannot enroll publicly",
    );
    run(["db", "reset", "--local", "--version", priorVersion]);
    assert.equal(
      harness.runSql(
        "select max(version) from supabase_migrations.schema_migrations;",
      ),
      priorVersion,
    );
    harness.runSql(
      `begin; ${readFixture()} set session_replication_role=replica; update public.booking_requests set customer_user_id=owner_user_id where id='60000000-0000-4000-8000-000000002142'; set session_replication_role=origin; commit;`,
    );
    const incompatible = snapshot();
    assert.throws(
      () => run(["migration", "up", "--local"]),
      /booking_requests_distinct_participants/,
      "Legacy self-booking rows fail loudly instead of being silently repaired",
    );
    assert.deepEqual(
      snapshot(),
      incompatible,
      "Rejected upgrade leaves all historical rows unchanged",
    );
    console.log(
      "Account migration preserved the frozen historical graph and refused incompatible self-booking rows.",
    );
  } catch (error) {
    failure = error;
  } finally {
    try {
      harness.guardDisposableLocalDatabase();
      run(["db", "reset", "--local"]);
    } catch (error) {
      failure = new AggregateError(
        [...(failure ? [failure] : []), error],
        "Account upgrade proof or disposable schema restoration failed",
      );
    }
  }
  if (failure) throw failure;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  verifyAccountAccessUpgrade();
