import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const USAGE =
  "Usage: node scripts/verify-booking-request-scheduled-expiry.mjs --seed|--verify";
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function main(args, environment = process.env) {
  if (args.length !== 1 || (args[0] !== "--seed" && args[0] !== "--verify")) {
    console.error(USAGE);
    return 2;
  }

  const workdir = environment.SUPABASE_LOCAL_WORKDIR;
  if (!workdir || !statSync(workdir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("Scheduled expiry requires an existing local Supabase workdir.");
  }
  const identityFile = join(workdir, "scheduled-expiry-request-id");

  const harness = createLocalSupabaseConcurrencyHarness({ environment });
  harness.guardDisposableLocalDatabase();

  if (args[0] === "--seed") {
    const requestId = harness.runSql(`
      with target as (
        select requests.id
        from public.booking_requests requests
        where requests.status = 'pending'
      ), base as (
        select clock_timestamp() - interval '5 hours' as created_at
      )
      update public.booking_requests requests
      set created_at = base.created_at,
          response_deadline = base.created_at + interval '4 hours'
      from target, base
      where requests.id = target.id
        and (select count(*) from target) = 1
      returning requests.id;
    `);
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      throw new Error("Expected exactly one pending booking request.");
    }
    writeFileSync(identityFile, `${requestId}\n`);
    console.log(`Scheduled expiry fixture ${requestId} is due.`);
    return 0;
  }

  const requestId = readFileSync(identityFile, "utf8").trim();
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error("Scheduled expiry fixture ID is invalid.");
  }
  const result = harness.runSql(`
    select concat_ws('|', requests.status, work.state, work.outcome,
      commitments.status, bool_and(not occupancies.active),
      count(distinct notifications.id), count(distinct operations.id),
      count(distinct provider.id),
      jsonb_array_length(attempts.payment_snapshot -> 'movements'))
    from public.booking_requests requests
    join public.booking_request_release_work work
      on work.booking_request_id = requests.id
    join public.booking_request_submission_attempts attempts
      on attempts.id = work.attempt_id
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = commitments.id
    join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    join public.booking_request_release_operations operations
      on operations.work_id = work.id
    join public.payment_provider_operations provider
      on provider.payment_lifecycle_id = attempts.payment_lifecycle_id
      and provider.operation_kind = 'release'
    where requests.id = '${requestId}'
      and requests.status = 'expired'
      and work.outcome = 'expired'
    group by requests.id, requests.status, work.state, work.outcome, commitments.status,
      attempts.payment_snapshot;
  `);
  const expected = "expired|complete|expired|released_hold|t|2|1|1|2";
  if (result !== expected) {
    throw new Error(
      `Scheduled expiry did not produce the exact terminal state: ${result || "no result"}`,
    );
  }
  console.log("Scheduled expiry produced one release and one notice pair.");
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
