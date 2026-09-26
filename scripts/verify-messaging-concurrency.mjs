import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness({
  timing: { check: "verify-messaging-concurrency", isolation: "serial" },
});
let timingOutcome = "failed";
try {
  harness.markTimingPhase("setup");
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
    assert.equal(
      text.lastIndexOf(startMarker),
      start,
      `Duplicate ${name} start`,
    );
    assert.equal(text.lastIndexOf(endMarker), end, `Duplicate ${name} end`);
    return text.slice(start, end);
  };
  const fixture = (name) =>
    between(source, `-- BEGIN ${name}`, `-- END ${name}`, name);
  const correctionSource = readFileSync(
    new URL(
      "../supabase/tests/database/booking_request_payment_correction.test.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const correctionFixture = (name) =>
    between(
      correctionSource,
      `-- BEGIN ${name}`,
      `-- END ${name}`,
      `payment-correction ${name}`,
    );
  const recoveredPaymentFixture = `
  ${correctionFixture("PAYMENT EVIDENCE FIXTURE")}
  ${correctionFixture("CONFIRMATION FIXTURE")}
  set role service_role;
  select public.record_booking_request_capture_failure(
    '60000000-0000-4000-8000-000000001001',
    (select (result#>>'{permit,leaseGeneration}')::bigint from confirmation_capture_lease),
    (select (result#>>'{permit,leaseToken}')::uuid from confirmation_capture_lease),
    (select result from confirmation_capture_result)
  );
  reset role;
  select set_config(
    'request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',true
  );
  set role authenticated;
  create temp table messaging_recovery_attempt as
  select public.claim_customer_booking_request_payment_recovery(
    '60000000-0000-4000-8000-000000001001',
    '81000000-0000-4000-8000-000000001001','simulated-replacement'
  ) result;
  reset role;
  grant select on messaging_recovery_attempt to service_role;
  set role service_role;
  select pg_temp.recovery_execute(
    public.lease_booking_request_payment_recovery_step(
      (select (result->>'attemptId')::uuid from messaging_recovery_attempt),
      'original-release','admitted'
    )->'permit','succeeded','original_released'
  );
  select pg_temp.recovery_execute(
    public.lease_booking_request_payment_recovery_step(
      (select (result->>'attemptId')::uuid from messaging_recovery_attempt),
      'replacement-authorization','original_released'
    )->'permit','succeeded','replacement_authorized'
  );
  select pg_temp.recovery_execute(
    public.lease_booking_request_payment_recovery_step(
      (select (result->>'attemptId')::uuid from messaging_recovery_attempt),
      'replacement-capture','replacement_authorized'
    )->'permit','succeeded','succeeded'
  );
  select public.finalize_booking_request_confirmation(
    '60000000-0000-4000-8000-000000001001',
    public.get_booking_request_payment_recovery_confirmation_evidence(
      (select (result->>'attemptId')::uuid from messaging_recovery_attempt)
    )
  );
  reset role;
`;
  const originalRanges =
    `'{["2101-01-01 05:00+00","2101-01-01 09:00+00"),` +
    `["2101-01-01 17:00+00","2101-01-01 23:00+00"),` +
    `["2101-01-02 05:00+00","2101-01-02 23:00+00")}'::tstzmultirange`;
  const boundaryRanges =
    "tstzmultirange(tstzrange(statement_timestamp()-interval '30 days 1 hour'," +
    "statement_timestamp()-interval '30 days'+interval '20 seconds','[)'))";
  const cancellationFixture = fixture("CANCELLATION FIXTURE");
  const cutoffCancellationFixture = cancellationFixture.replaceAll(
    originalRanges,
    boundaryRanges,
  );
  assert.equal(
    cutoffCancellationFixture.split(boundaryRanges).length - 1,
    2,
    "The commitment and authorization claim use the same controlled boundary",
  );

  const request = "60000000-0000-4000-8000-000000001001";
  const attempt = "70000000-0000-4000-8000-000000001001";
  const customer = "10000000-0000-4000-8000-000000001002";
  const stranger = "10000000-0000-4000-8000-000000001003";
  const owner = "10000000-0000-4000-8000-000000001001";
  const profile = "20000000-0000-4000-8000-000000001001";
  const sessions = [];
  const cleanupSource = readFileSync(
    new URL("./verify-booking-cancellation-concurrency.mjs", import.meta.url),
    "utf8",
  );
  const resetCancellation = between(
    cleanupSource,
    "const resetCancellation = `",
    "`;\n  const cleanup",
    "cancellation reset template",
  ).slice("const resetCancellation = `".length);
  const cancellationCleanup = between(
    cleanupSource,
    "const cleanup = `",
    "`;\n  const sessions",
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
  delete from public.messaging_translation_reports where translation_id in (
    select translations.id from public.messaging_translations translations
    join public.messaging_messages messages on messages.id=translations.message_id
    join public.messaging_conversations conversations on conversations.id=messages.conversation_id
    where conversations.profile_id='${profile}'
  );
  delete from public.messaging_translations where message_id in (
    select messages.id from public.messaging_messages messages
    join public.messaging_conversations conversations on conversations.id=messages.conversation_id
    where conversations.profile_id='${profile}'
  );
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
  delete from public.booking_request_confirmation_invalidations
    where booking_request_id='${request}';
  delete from public.booking_request_payment_correction_observations
    where booking_request_id='${request}';
  delete from public.booking_request_payment_recovery_operations
    where recovery_attempt_id in (
      select id from public.booking_request_payment_recovery_attempts
      where booking_request_id='${request}'
    );
  delete from public.booking_request_payment_recovery_attempts
    where booking_request_id='${request}';
  delete from public.booking_request_payment_required_expiry_work
    where booking_request_id='${request}';
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
    harness.markTimingPhase("execution");
    const created = JSON.parse(
      harness.runSql(`
      set role service_role;
      select public.create_messaging_conversation(
        '${customer}','${profile}','36000000-0000-4000-8000-000000003601'
      );
    `),
    );
    assert.equal(created.status, "created");
    let conversation = created.conversationId;

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
    await harness.waitForMarker(
      associationHolder,
      "MESSAGING_ASSOCIATION_HELD",
    );
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
    assert.equal(
      JSON.parse(resultLine(unauthorized)).status,
      "access-required",
    );
    await harness.finishSession(requestHolder, { action: "rollback" });

    const authorityHolder = harness.startSession(`
    begin;
    set application_name='messaging_authority_holder';
    select id from public.booking_requests where id='${request}' for update;
    select 'MESSAGING_AUTHORITY_REQUEST_HELD';
  `);
    sessions.push(authorityHolder);
    await harness.waitForMarker(
      authorityHolder,
      "MESSAGING_AUTHORITY_REQUEST_HELD",
    );
    const authorityContender = harness.startSession(
      `begin;
    set application_name='messaging_authority_contender';
    set local role service_role;
    select public.admit_messaging_message(
      '${owner}','${conversation}',
      '36000000-0000-4000-8000-000000003605','en','Owner authority recheck'
    );
    commit;`,
      true,
    );
    sessions.push(authorityContender);
    await harness.waitForLock(
      "messaging_authority_contender",
      authorityContender,
    );
    await harness.finishSession(authorityHolder, {
      action: `update public.account_contexts
      set owner_approval_state='suspended'
      where user_id='${owner}'; commit`,
    });
    await harness.finishSession(authorityContender);
    assert.equal(
      JSON.parse(resultLine(authorityContender)).status,
      "access-required",
      "Admission rechecks current owner approval after waiting on the Booking Request",
    );
    assert.equal(
      harness.runSql(`select count(*) from public.messaging_send_attempts
      where command_id='36000000-0000-4000-8000-000000003605';`),
      "0",
      "Revoked authority writes neither a message nor a rejection audit",
    );
    harness.runSql(`update public.account_contexts set owner_approval_state='approved'
    where user_id='${owner}';`);

    const safeMessage = JSON.parse(
      harness.runSql(`
    set role service_role;
    select public.admit_messaging_message(
      '${customer}','${conversation}',
      '36000000-0000-4000-8000-000000003606','en','A safe translation source'
    );
  `),
    );
    assert.equal(safeMessage.status, "sent");
    const savedTranslation = JSON.parse(
      harness.runSql(`
    set role service_role;
    select public.save_messaging_translation(
      '${customer}','${safeMessage.messageId}','ar',
      'fictional-local-test','deterministic-pairs-v1','message-pairs-v1',
      'مصدر ترجمة آمن'
    );
  `),
    );
    assert.equal(savedTranslation.status, "translated");
    const reportHolder = harness.startSession(`
    begin;
    set application_name='messaging_report_holder';
    set local role service_role;
    select public.report_messaging_translation(
      '${customer}','${savedTranslation.translationId}',
      '36000000-0000-4000-8000-000000003607','incorrect'
    );
    select 'MESSAGING_REPORT_HELD';
  `);
    sessions.push(reportHolder);
    await harness.waitForMarker(reportHolder, "MESSAGING_REPORT_HELD");
    const reportContender = harness.startSession(
      `begin;
    set application_name='messaging_report_contender';
    set local role service_role;
    select public.report_messaging_translation(
      '${customer}','${savedTranslation.translationId}',
      '36000000-0000-4000-8000-000000003607','incorrect'
    );
    commit;`,
      true,
    );
    sessions.push(reportContender);
    await harness.waitForLock("messaging_report_contender", reportContender);
    await harness.finishSession(reportHolder, { action: "commit" });
    await harness.finishSession(reportContender);
    assert.equal(
      JSON.parse(resultLine(reportContender)).reportId,
      JSON.parse(resultLine(reportHolder)).reportId,
      "Concurrent identical poor-translation reports return one stable receipt",
    );
    assert.equal(
      harness.runSql(`select count(*) from public.messaging_translation_reports
      where command_id='36000000-0000-4000-8000-000000003607';`),
      "1",
    );

    harness.markTimingPhase("setup");
    harness.runSql(cleanup);
    harness.runSql(`begin;
    ${recoveredPaymentFixture}
    insert into public.cottage_marketplace_listings(profile_id,public_slug,state)
    values('${profile}','cottage-20000000000040008000000000001001','published');
    commit;
  `);
    harness.markTimingPhase("execution");
    const bookingOpenHolder = harness.startSession(`
    begin;
    set application_name='messaging_booking_open_holder';
    set local role service_role;
    select public.open_messaging_conversation_for_booking(
      '${customer}','RC-REQ-0000000000001001',
      '36000000-0000-4000-8000-000000003610'
    );
    select 'MESSAGING_BOOKING_OPEN_HELD';
  `);
    sessions.push(bookingOpenHolder);
    await harness.waitForMarker(
      bookingOpenHolder,
      "MESSAGING_BOOKING_OPEN_HELD",
    );
    const bookingOpenContender = harness.startSession(
      `begin;
    set application_name='messaging_booking_open_contender';
    set local role service_role;
    select public.open_messaging_conversation_for_booking(
      '${customer}','RC-REQ-0000000000001001',
      '36000000-0000-4000-8000-000000003611'
    );
    commit;`,
      true,
    );
    sessions.push(bookingOpenContender);
    await harness.waitForLock(
      "messaging_booking_open_contender",
      bookingOpenContender,
    );
    await harness.finishSession(bookingOpenHolder, { action: "commit" });
    await harness.finishSession(bookingOpenContender);
    const recoveredConversation = JSON.parse(resultLine(bookingOpenHolder));
    assert.equal(recoveredConversation.status, "created");
    assert.equal(
      JSON.parse(resultLine(bookingOpenContender)).conversationId,
      recoveredConversation.conversationId,
      "Simultaneous existing-booking entry returns one retained journey",
    );
    conversation = recoveredConversation.conversationId;
    assert.equal(
      harness.runSql(`select public.booking_request_payment_status(requests)
      from public.booking_requests requests where id='${request}';`),
      "paid-confirmed",
      "The payment recheck scenario begins from a production recovered confirmation",
    );

    const paymentHolder = harness.startSession(`
    begin;
    set application_name='messaging_payment_holder';
    select public.quarantine_booking_request_payment(
      '${request}','conflicting-evidence'
    );
    select 'MESSAGING_PAYMENT_REQUEST_HELD';
  `);
    sessions.push(paymentHolder);
    await harness.waitForMarker(
      paymentHolder,
      "MESSAGING_PAYMENT_REQUEST_HELD",
    );
    const duringPaymentChange = harness.startSession(
      `begin;
    set local lock_timeout='500ms';
    select set_config('request.jwt.claim.sub','${customer}',true);
    set local role authenticated;
    select public.get_messaging_conversation('${conversation}',null,20);
    commit;`,
      true,
    );
    sessions.push(duringPaymentChange);
    await harness.finishSession(duringPaymentChange);
    const committedBeforeQuarantine = JSON.parse(
      resultLine(duringPaymentChange),
    );
    assert.equal(
      committedBeforeQuarantine.booking.paymentStatus,
      "paid-confirmed",
    );
    assert.equal(committedBeforeQuarantine.booking.contactAllowed, true);
    assert.equal(
      committedBeforeQuarantine.bookingHistory.at(-1).bookingRequestReference,
      "RC-REQ-0000000000001001",
      "The nonlocking reader returns one committed paid header/history snapshot while quarantine is uncommitted",
    );
    const paymentContender = harness.startSession(
      `begin;
    set application_name='messaging_payment_contender';
    set local role service_role;
    select public.admit_messaging_message(
      '${customer}','${conversation}',
      '36000000-0000-4000-8000-000000003608','en','Call +964 750 123 4567'
    );
    commit;`,
      true,
    );
    sessions.push(paymentContender);
    await harness.waitForLock("messaging_payment_contender", paymentContender);
    await harness.finishSession(paymentHolder, { action: "commit" });
    await harness.finishSession(paymentContender);
    assert.equal(
      JSON.parse(resultLine(paymentContender)).status,
      "blocked",
      "A committed production payment quarantine removes contact permission before admission resumes",
    );
    assert.equal(
      harness.runSql(`select count(*) from public.messaging_messages messages
      join public.messaging_send_attempts attempts on attempts.id=messages.send_attempt_id
      where attempts.command_id='36000000-0000-4000-8000-000000003608';`),
      "0",
      "The post-wait contact rejection creates no message",
    );
    assert.equal(
      harness.runSql(`select count(*) from public.messaging_send_attempts
      where command_id='36000000-0000-4000-8000-000000003608'
        and outcome='blocked';`),
      "1",
      "The post-wait contact rejection retains its audit receipt",
    );
    const afterPaymentChange = harness.startSession(
      `begin;
    select set_config('request.jwt.claim.sub','${customer}',true);
    set local role authenticated;
    select public.get_messaging_conversation('${conversation}',null,20);
    commit;`,
      true,
    );
    sessions.push(afterPaymentChange);
    await harness.finishSession(afterPaymentChange);
    const committedAfterQuarantine = JSON.parse(resultLine(afterPaymentChange));
    assert.equal(committedAfterQuarantine.booking.contactAllowed, false);
    assert.notEqual(
      committedAfterQuarantine.booking.paymentStatus,
      "paid-confirmed",
    );
    assert.equal(
      committedAfterQuarantine.bookingHistory.at(-1).bookingRequestReference,
      committedBeforeQuarantine.bookingHistory.at(-1).bookingRequestReference,
      "A fresh read sees revoked permission while preserving the same retained journey history",
    );

    harness.markTimingPhase("setup");
    harness.runSql(cleanup);
    harness.runSql(`
    ${fixture("PAYMENT EVIDENCE FIXTURE")}
    ${cutoffCancellationFixture}
    select pg_temp.seed_cancellation_booking(
      ((clock_timestamp() at time zone 'Asia/Baghdad')::date + 60)
    );
    insert into public.cottage_marketplace_listings(profile_id,public_slug,state)
    values('${profile}','cottage-20000000000040008000000000001001','published');
  `);
    harness.markTimingPhase("execution");
    const cutoffCreated = JSON.parse(
      harness.runSql(`
    set role service_role;
    select public.open_messaging_conversation_for_booking(
      '${customer}','RC-REQ-0000000000001001',
      '36000000-0000-4000-8000-000000003609'
    );
  `),
    );
    assert.equal(cutoffCreated.status, "created");
    conversation = cutoffCreated.conversationId;

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
      "Messaging concurrency passed association revalidation, pre-lock stranger rejection, nonlocking committed reader projection, post-wait authority and payment rechecks, report retry deduplication, Booking Request before conversation lock order, and post-wait cutoff enforcement.",
    );
  } catch (error) {
    failure = error;
  } finally {
    harness.markTimingPhase("cleanup");
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
          ,'translations',(select count(*) from public.messaging_translations translations
            join public.messaging_messages messages on messages.id=translations.message_id
            where messages.sender_user_id in ('${customer}','${stranger}'))
          ,'reports',(select count(*) from public.messaging_translation_reports reports
            where reports.reporter_user_id in ('${customer}','${stranger}'))
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
          translations: 0,
          reports: 0,
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
  timingOutcome = "passed";
} finally {
  harness.finishTiming({ outcome: timingOutcome, cleanupDisposition: "local" });
}
