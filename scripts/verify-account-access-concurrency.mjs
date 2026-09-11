import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

if (
  !process.env.SUPABASE_LOCAL_WORKDIR ||
  !process.env.SUPABASE_LOCAL_PROJECT ||
  process.env.SUPABASE_LOCAL_PROJECT === "rentcottage"
) {
  throw new Error(
    "Account concurrency requires an explicitly isolated disposable project and workdir.",
  );
}
const harness = createLocalSupabaseConcurrencyHarness();
harness.guardDisposableLocalDatabase();
const id = (index) => `10000000-0000-4000-8000-00000000274${index}`;
const sessions = [];
const fixture = readFileSync(
  "supabase/fixtures/legacy-account-access.sql",
  "utf8",
).replaceAll("214", "274");
const auth = (userId) =>
  `set local role authenticated; select set_config('request.jwt.claim.sub','${userId}',true);`;
let seeded = false;
async function race(index, firstRole, secondRole) {
  const first = harness.startSession(
    `begin; set application_name='account_274_first'; ${auth(id(index))} select row_to_json(public.claim_marketplace_role('${firstRole}')); select 'ACCOUNT_FIRST_CLAIMED';`,
  );
  sessions.push(first);
  await harness.waitForMarker(first, "ACCOUNT_FIRST_CLAIMED");
  const second = harness.startSession(
    `begin; set application_name='account_274_second'; ${auth(id(index))} select row_to_json(public.claim_marketplace_role('${secondRole}')); select 'ACCOUNT_SECOND_CLAIMED'; commit;`,
    true,
  );
  sessions.push(second);
  await harness.waitForLock("account_274_second", second);
  await harness.finishSession(first, { action: "commit" });
  await harness.finishSession(second);
  assert.match(second.stdout, /ACCOUNT_SECOND_CLAIMED/);
  for (const session of [first, second]) {
    const context = JSON.parse(
      session.stdout.split("\n").find((line) => line.startsWith("{")),
    );
    assert.equal(context.user_id, id(index));
    assert.notEqual(context.role, "platform_administrator");
  }
  const row = JSON.parse(
    harness.runSql(
      `select jsonb_build_object('count',count(*),'rows',jsonb_agg(jsonb_build_array(user_id,role,owner_approval_state))) from public.account_contexts where user_id='${id(index)}';`,
    ),
  );
  assert.equal(row.count, 1);
  assert.deepEqual(row.rows, [
    [id(index), "cottage_owner", index === 1 ? "approved" : "prospective"],
  ]);
}
let failure;
try {
  assert.equal(
    harness.runSql(
      `select count(*) from auth.users where id in (${[1, 2, 3, 4, 5, 6].map((i) => `'${id(i)}'`).join(",")});`,
    ),
    "0",
    "Refuse preexisting fixture identities",
  );
  harness.runSql(
    `begin; ${fixture} insert into auth.users(id,aud,role,phone,phone_confirmed_at) values('${id(6)}','authenticated','authenticated','9647500002746',now()); commit;`,
  );
  seeded = true;
  await race(6, "cottage_owner", "cottage_owner");
  await race(2, "customer", "cottage_owner");
  harness.runSql(
    `update public.account_contexts set role='customer',owner_approval_state=null where user_id='${id(2)}';`,
  );
  await race(2, "cottage_owner", "customer");
  await race(2, "cottage_owner", "cottage_owner");
  await race(1, "customer", "cottage_owner");
  const receipt = harness
    .runSql(
      `begin; ${auth(id(2))} select public.get_confirmed_booking_access('RC-REQ-0000000000002741')->>'actorRole'; rollback;`,
    )
    .split("\n")
    .at(-1);
  assert.equal(
    receipt,
    "customer",
    "Enrolled owner still reads their old customer receipt",
  );
  const denied = harness.runDocker(
    harness.psqlArguments(),
    `begin; ${auth(id(2))} select public.claim_marketplace_role('platform_administrator'); rollback;`,
  );
  assert.notEqual(
    denied.status,
    0,
    "Public role claims never grant administrator powers",
  );
  assert.match(denied.stderr, /Only Customer or Cottage Owner/);
  console.log(
    "Account enrollment concurrency passed: observed lock waits, one immutable identity, preserved approval and customer receipt.",
  );
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors = [];
  for (const session of sessions) {
    if (!session.exit) {
      try {
        await harness.finishSession(session, { action: "rollback" });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  if (seeded) {
    try {
      harness.runSql(`begin; set session_replication_role=replica;
        delete from public.payment_provider_observations where operation_id='81000000-0000-4000-8000-000000002741';
        delete from public.payment_provider_operations where id='81000000-0000-4000-8000-000000002741';
        delete from public.booking_request_authorization_claim_items where claim_id in ('72000000-0000-4000-8000-000000002741','72000000-0000-4000-8000-000000002742');
        delete from public.booking_request_authorization_claim_occupancies where claim_id in ('72000000-0000-4000-8000-000000002741','72000000-0000-4000-8000-000000002742');
        delete from public.booking_request_authorization_claims where id in ('72000000-0000-4000-8000-000000002741','72000000-0000-4000-8000-000000002742');
        delete from public.booking_request_submission_attempts where id in ('70000000-0000-4000-8000-000000002741','70000000-0000-4000-8000-000000002742');
        delete from public.cottage_inventory_commitments where booking_period_commitment_id in ('50000000-0000-4000-8000-000000002741','50000000-0000-4000-8000-000000002742');
        delete from public.cottage_booking_period_occupancies where booking_period_commitment_id in ('50000000-0000-4000-8000-000000002741','50000000-0000-4000-8000-000000002742');
        delete from public.cottage_shifts where schedule_revision_id='30000000-0000-4000-8000-000000002741';
        delete from public.cottage_shift_schedule_revisions where id='30000000-0000-4000-8000-000000002741';
        delete from public.booking_receipts where id in ('82000000-0000-4000-8000-000000002741','82000000-0000-4000-8000-000000002742');
        delete from public.booking_confirmations where id='80000000-0000-4000-8000-000000002741';
        delete from public.booking_request_capture_work where booking_request_id='60000000-0000-4000-8000-000000002741';
        delete from public.booking_requests where id in ('60000000-0000-4000-8000-000000002741','60000000-0000-4000-8000-000000002742');
        delete from public.cottage_booking_period_commitments where id in ('50000000-0000-4000-8000-000000002741','50000000-0000-4000-8000-000000002742');
        delete from public.booking_snapshots where id in ('40000000-0000-4000-8000-000000002741','40000000-0000-4000-8000-000000002742');
        delete from public.owner_application_cottage_profiles where id='20000000-0000-4000-8000-000000002741';
        delete from public.account_contexts where user_id in (${[1, 2, 3, 4, 5, 6].map((i) => `'${id(i)}'`).join(",")});
        delete from auth.users where id in (${[1, 2, 3, 4, 5, 6].map((i) => `'${id(i)}'`).join(",")});
        set session_replication_role=origin; commit;`);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length)
    failure = new AggregateError(
      [...(failure ? [failure] : []), ...cleanupErrors],
      "Account concurrency proof or exact fixture cleanup failed",
    );
}
if (failure) throw failure;
