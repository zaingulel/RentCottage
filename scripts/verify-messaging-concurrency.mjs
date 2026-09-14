import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
const source = readFileSync(
  new URL(
    "../supabase/tests/database/booking_cancellation.test.sql",
    import.meta.url,
  ),
  "utf8",
);
const between = (text, startMarker, endMarker, name) => {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing ${name}`);
  assert.equal(text.lastIndexOf(startMarker), start, `Duplicate ${name} start`);
  assert.equal(text.lastIndexOf(endMarker), end, `Duplicate ${name} end`);
  return text.slice(start, end);
};
const fixture = (name) =>
  between(source, `-- BEGIN ${name}`, `-- END ${name}`, name);
const originalRanges =
  `'{["2101-01-01 05:00+00","2101-01-01 09:00+00"),` +
  `["2101-01-01 17:00+00","2101-01-01 23:00+00"),` +
  `["2101-01-02 05:00+00","2101-01-02 23:00+00")}'::tstzmultirange`;
const boundaryRanges =
  "tstzmultirange(tstzrange(statement_timestamp()-interval '30 days 1 hour'," +
  "statement_timestamp()-interval '30 days'+interval '20 seconds','[)'))";
const cancellationFixture = fixture("CANCELLATION FIXTURE").replaceAll(
  originalRanges,
  boundaryRanges,
);
assert.equal(
  cancellationFixture.split(boundaryRanges).length - 1,
  2,
  "The commitment and authorization claim use the same controlled boundary",
);

const request = "60000000-0000-4000-8000-000000001001";
const attempt = "70000000-0000-4000-8000-000000001001";
const customer = "10000000-0000-4000-8000-000000001002";
const stranger = "10000000-0000-4000-8000-000000001003";
const profile = "20000000-0000-4000-8000-000000001001";
const sessions = [];
const cleanupSource = readFileSync(
  new URL("./verify-booking-cancellation-concurrency.mjs", import.meta.url),
  "utf8",
);
const resetCancellation = between(
  cleanupSource,
  "const resetCancellation = `",
  "`;\nconst cleanup",
  "cancellation reset template",
).slice("const resetCancellation = `".length);
const cancellationCleanup = between(
  cleanupSource,
  "const cleanup = `",
  "`;\nconst sessions",
  "cancellation cleanup template",
)
  .slice("const cleanup = `".length)
  .replace("${resetCancellation}", resetCancellation)
  .replaceAll("${request}", request)
  .replaceAll("${claim}", "72000000-0000-4000-8000-000000001001")
  .replaceAll("${owner}", "10000000-0000-4000-8000-000000001001")
  .replaceAll("${customer}", customer);
assert.doesNotMatch(
  cancellationCleanup,
  /\$\{/,
  "The reused cleanup template has no unresolved interpolation",
);
const cleanup = `
  set session_replication_role=replica;
  delete from public.messaging_messages where conversation_id in (
    select id from public.messaging_conversations where profile_id='${profile}'
  );
  delete from public.messaging_send_attempts where conversation_id in (
    select id from public.messaging_conversations where profile_id='${profile}'
  );
  delete from public.messaging_conversation_booking_requests
    where conversation_id in (
      select id from public.messaging_conversations where profile_id='${profile}'
    );
  update public.booking_request_submission_attempts set conversation_id=null
    where id='${attempt}';
  delete from public.messaging_conversations where profile_id='${profile}';
  delete from public.cottage_marketplace_listings where profile_id='${profile}';
  set session_replication_role=origin;
  ${cancellationCleanup}
`;
const resultLine = (session) =>
  session.stdout.split("\n").find((line) => line.startsWith("{"));

harness.guardDisposableLocalDatabase();
let failure;
try {
  assert.equal(
    harness.runSql(
      `select count(*) from public.booking_requests where id='${request}';`,
    ),
    "0",
    "Refuse a pre-existing messaging concurrency fixture",
  );
  harness.runSql(`
    ${fixture("PAYMENT EVIDENCE FIXTURE")}
    ${cancellationFixture}
    select pg_temp.seed_cancellation_booking(
      ((clock_timestamp() at time zone 'Asia/Baghdad')::date + 60)
    );
    insert into public.cottage_marketplace_listings(profile_id,public_slug,state)
    values('${profile}','cottage-20000000000040008000000000001001','published');
  `);
  assert.equal(
    harness.runSql(`
      select public.booking_request_payment_status(requests)
      from public.booking_requests requests where id='${request}';
    `),
    "paid-confirmed",
    "The reused fixture must establish the production paid-access state",
  );
  const created = JSON.parse(
    harness.runSql(`
      set role service_role;
      select public.create_messaging_conversation(
        '${customer}','${profile}','36000000-0000-4000-8000-000000003601'
      );
    `),
  );
  assert.equal(created.status, "created");
  const conversation = created.conversationId;

  const associationHolder = harness.startSession(`
    begin;
    set application_name='messaging_association_holder';
    select id from public.messaging_conversations
      where id='${conversation}' for update;
    update public.booking_request_submission_attempts
      set conversation_id='${conversation}' where id='${attempt}';
    insert into public.messaging_conversation_booking_requests(
      conversation_id,booking_request_id,submission_attempt_id
    ) values ('${conversation}','${request}','${attempt}');
    select 'MESSAGING_ASSOCIATION_HELD';
  `);
  sessions.push(associationHolder);
  await harness.waitForMarker(associationHolder, "MESSAGING_ASSOCIATION_HELD");
  const associationContender = harness.startSession(
    `begin;
    set application_name='messaging_association_contender';
    set local role service_role;
    select public.admit_messaging_message(
      '${customer}','${conversation}',
      '36000000-0000-4000-8000-000000003602','en','Call +964 750 123 4567'
    );
    commit;`,
    true,
  );
  sessions.push(associationContender);
  await harness.waitForLock(
    "messaging_association_contender",
    associationContender,
  );
  await harness.finishSession(associationHolder, { action: "commit" });
  await harness.finishSession(associationContender);
  assert.equal(
    JSON.parse(resultLine(associationContender)).status,
    "retry",
    "Admission retries when a booking association appears during its lock wait",
  );
  assert.equal(
    harness.runSql(
      `select count(*) from public.messaging_send_attempts where conversation_id='${conversation}';`,
    ),
    "0",
    "A changed association admits no message and writes no rejection audit",
  );

  const requestHolder = harness.startSession(`
    begin;
    set application_name='messaging_unauthorized_holder';
    select id from public.booking_requests where id='${request}' for update;
    select 'MESSAGING_UNAUTHORIZED_REQUEST_HELD';
  `);
  sessions.push(requestHolder);
  await harness.waitForMarker(
    requestHolder,
    "MESSAGING_UNAUTHORIZED_REQUEST_HELD",
  );
  const unauthorized = harness.startSession(
    `begin;
    set application_name='messaging_unauthorized_contender';
    set local lock_timeout='500ms';
    set local role service_role;
    select public.admit_messaging_message(
      '${stranger}','${conversation}',
      '36000000-0000-4000-8000-000000003603','en','Call +964 750 123 4567'
    );
    commit;`,
    true,
  );
  sessions.push(unauthorized);
  await harness.finishSession(unauthorized);
  assert.equal(JSON.parse(resultLine(unauthorized)).status, "access-required");
  await harness.finishSession(requestHolder, { action: "rollback" });

  assert.equal(
    harness.runSql(`
      select (max(upper(periods.period))+interval '720 hours') > clock_timestamp()
      from public.cottage_booking_period_commitments commitments,
        unnest(commitments.access_ranges) periods(period)
      where commitments.id=(select booking_period_commitment_id
        from public.booking_requests where id='${request}');
    `),
    "t",
    "The controlled cutoff must still be ahead of the database clock",
  );
  const cutoffHolder = harness.startSession(`
    begin;
    set application_name='messaging_cutoff_holder';
    select id from public.booking_requests where id='${request}' for update;
    select 'MESSAGING_CUTOFF_REQUEST_HELD';
  `);
  sessions.push(cutoffHolder);
  await harness.waitForMarker(cutoffHolder, "MESSAGING_CUTOFF_REQUEST_HELD");
  const cutoffContender = harness.startSession(
    `begin;
    set application_name='messaging_cutoff_contender';
    set local role service_role;
    select public.admit_messaging_message(
      '${customer}','${conversation}',
      '36000000-0000-4000-8000-000000003604','en','Call +964 750 123 4567'
    );
    commit;`,
    true,
  );
  sessions.push(cutoffContender);
  await harness.waitForLock("messaging_cutoff_contender", cutoffContender);
  const conversationProbe = harness.runDocker(
    harness.psqlArguments(),
    `begin; set local lock_timeout='250ms';
      select id from public.messaging_conversations
      where id='${conversation}' for update; rollback;`,
  );
  assert.equal(
    conversationProbe.status,
    0,
    "An authorized contender waits on the Booking Request before locking its conversation",
  );
  harness.runSql(`
    select pg_sleep(greatest(0, extract(epoch from (
      (select max(upper(periods.period))+interval '720 hours'
       from public.cottage_booking_period_commitments commitments,
         unnest(commitments.access_ranges) periods(period)
       where commitments.id=(select booking_period_commitment_id
         from public.booking_requests where id='${request}'))
      - clock_timestamp()
    )) + 0.05));
  `);
  await harness.finishSession(cutoffHolder, { action: "commit" });
  await harness.finishSession(cutoffContender);
  assert.equal(
    JSON.parse(resultLine(cutoffContender)).status,
    "read-only",
    "Admission samples the authoritative clock after the lock wait and enforces the exact cutoff",
  );
  assert.equal(
    harness.runSql(
      `select count(*) from public.messaging_messages where conversation_id='${conversation}';`,
    ),
    "0",
    "The closed journey writes no message",
  );

  console.log(
    "Messaging concurrency passed association revalidation, pre-lock stranger rejection, Booking Request before conversation lock order, and post-wait cutoff enforcement.",
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
  try {
    harness.runSql(cleanup);
    const residue = JSON.parse(
      harness.runSql(`
        select jsonb_build_object(
          'users',(select count(*) from auth.users where id in (
            '10000000-0000-4000-8000-000000001001','${customer}','${stranger}',
            '10000000-0000-4000-8000-000000003801')),
          'contexts',(select count(*) from public.account_contexts where user_id in (
            '10000000-0000-4000-8000-000000001001','${customer}','${stranger}',
            '10000000-0000-4000-8000-000000003801')),
          'profiles',(select count(*) from public.owner_application_cottage_profiles where id='${profile}'),
          'listings',(select count(*) from public.cottage_marketplace_listings where profile_id='${profile}'),
          'requests',(select count(*) from public.booking_requests where id='${request}'),
          'attempts',(select count(*) from public.booking_request_submission_attempts where id='${attempt}'),
          'conversations',(select count(*) from public.messaging_conversations where profile_id='${profile}'),
          'links',(select count(*) from public.messaging_conversation_booking_requests where booking_request_id='${request}'),
          'sendAttempts',(select count(*) from public.messaging_send_attempts where actor_user_id in ('${customer}','${stranger}')),
          'messages',(select count(*) from public.messaging_messages where sender_user_id in ('${customer}','${stranger}'))
        );
      `),
    );
    assert.deepEqual(
      residue,
      {
        users: 0,
        contexts: 0,
        profiles: 0,
        listings: 0,
        requests: 0,
        attempts: 0,
        conversations: 0,
        links: 0,
        sendAttempts: 0,
        messages: 0,
      },
      "Messaging concurrency fixture cleanup",
    );
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (failure || cleanupErrors.length > 0) {
    throw new AggregateError(
      [failure, ...cleanupErrors].filter(Boolean),
      "Messaging concurrency verification or cleanup failed",
    );
  }
}
