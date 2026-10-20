import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
import { confirmedBookingCleanup } from "./lib/booking-fixture.mjs";

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
  insert into auth.users(id,aud,role,email,email_confirmed_at) values('10000000-0000-4000-8000-000000003801','authenticated','authenticated','cancellation-admin@example.test',now());
  insert into public.account_contexts(user_id,role) values('10000000-0000-4000-8000-000000003801','platform_administrator');
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
  const sourceRevisionId = "37000000-0000-4000-8000-000000003601";
  const reviewCycleId = "37000000-0000-4000-8000-000000003602";
  const publicationId = "37000000-0000-4000-8000-000000003603";
  const publicationResidueSql = `select jsonb_build_object(
    'sourceRevisions',(select count(*) from public.cottage_profile_source_revisions where id='${sourceRevisionId}'),
    'reviewCycles',(select count(*) from public.cottage_profile_review_cycles where id='${reviewCycleId}'),
    'publications',(select count(*) from public.cottage_publication_snapshots where id='${publicationId}')
  );`;
  const sessions = [];
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
  ${confirmedBookingCleanup()}
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
    assert.equal(
      harness.runSql(`select
      (select count(*) from public.cottage_profile_source_revisions where id='${sourceRevisionId}')+
      (select count(*) from public.cottage_profile_review_cycles where id='${reviewCycleId}')+
      (select count(*) from public.cottage_publication_snapshots where id='${publicationId}');
    `),
      "0",
      "Refuse pre-existing messaging publication fixture rows",
    );
    const confirmedFixtureSql = `
    ${fixture("PAYMENT EVIDENCE FIXTURE")}
    ${cancellationFixture}
    select pg_temp.seed_cancellation_booking(
      ((clock_timestamp() at time zone 'Asia/Baghdad')::date + 60)
    );
    insert into public.cottage_profile_source_revisions(id,profile_id,owner_user_id,source_language,description,house_rules,revision)
    values('${sourceRevisionId}','${profile}','${owner}','en','Fixture description','Fixture rules',1);
    insert into public.cottage_profile_review_cycles(id,profile_id,owner_user_id,source_revision_id,name,governorate,approximate_location,capacity,bedrooms,bathrooms,amenities,cycle_number,state,decided_at)
    values('${reviewCycleId}','${profile}','${owner}','${sourceRevisionId}','Confirmation Cottage','Baghdad','Karrada',8,3,2,array['garden'],1,'approved',clock_timestamp());
    insert into public.cottage_publication_snapshots(id,profile_id,review_cycle_id,publication_number,name,governorate,approximate_location,capacity,bedrooms,bathrooms,amenities)
    values('${publicationId}','${profile}','${reviewCycleId}',1,'Confirmation Cottage','Baghdad','Karrada',8,3,2,array['garden']);
    update public.owner_application_cottage_profiles
    set current_publication_id='${publicationId}',current_shift_schedule_id='30000000-0000-4000-8000-000000001001'
    where id='${profile}';
  `;
    harness.runSql(confirmedFixtureSql);
    assert.equal(
      harness.runSql(`select public.is_cottage_publicly_discoverable('${profile}')
      and (select count(*) from public.cottage_shifts where schedule_revision_id='30000000-0000-4000-8000-000000001001')=3
      and (select quote_payload#>>'{items,1,position}' from public.booking_snapshots where id='40000000-0000-4000-8000-000000001001')='3';`),
      "t",
      "Inquiry fixture is public without rewriting the historical purchased three-shift snapshot",
    );
    assert.equal(
      harness.runSql(`
      select public.booking_request_payment_status(requests)
      from public.booking_requests requests where id='${request}';
    `),
      "paid-confirmed",
      "The reused fixture must establish the production paid-access state",
    );
    const administrator = "10000000-0000-4000-8000-000000003801";
    const restriction = (kind, target, action, revision, command) => `
      set local role authenticated;
      set local request.jwt.claim.sub='${administrator}';
      set local request.jwt.claims='{"sub":"${administrator}","aal":"aal2"}';
      select public.set_marketplace_suspension('${kind}','${target}','${action}',${revision},'Fictional messaging safety','36000000-0000-4000-8000-${String(command).padStart(12, "0")}');
      reset role;
    `;
    harness.markTimingPhase("execution");
    const suspensionHolder = harness.startSession(`begin;
      set application_name='messaging_suspension_holder';
      select id from public.booking_requests where id='${request}' for update;
      select 'MESSAGING_SUSPENSION_HELD';
    `);
    sessions.push(suspensionHolder);
    await harness.waitForMarker(suspensionHolder, "MESSAGING_SUSPENSION_HELD");
    const suspendedOpen = harness.startSession(
      `begin;
      set application_name='messaging_suspended_open';
      set local role service_role;
      select public.open_messaging_conversation_for_booking('${customer}','RC-REQ-0000000000001001','36000000-0000-4000-8000-000000003701');
      commit;
    `,
      true,
    );
    sessions.push(suspendedOpen);
    await harness.waitForLock("messaging_suspended_open", suspendedOpen);
    suspensionHolder.child.stdin
      .write(`${restriction("customer", customer, "suspend", 0, 3700)}
      select 'MESSAGING_CUSTOMER_SUSPENDED';
`);
    await harness.waitForMarker(
      suspensionHolder,
      "MESSAGING_CUSTOMER_SUSPENDED",
    );
    assert.equal(
      JSON.parse(resultLine(suspensionHolder)).status,
      "completed",
      "Actual AAL2 administrator restriction wins before waiting booking entry",
    );
    await harness.finishSession(suspensionHolder, { action: "commit" });
    await harness.finishSession(suspendedOpen);
    assert.equal(
      JSON.parse(resultLine(suspendedOpen)).status,
      "suspended",
      "customer_suspension_blocks_new_conversation_and_send: booking entry rechecks customer after request wait",
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.messaging_conversation_booking_requests where booking_request_id='${request}';`,
      ),
      "0",
      "Suspended booking entry creates no link",
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.messaging_conversations where customer_user_id='${customer}';`,
      ),
      "0",
      "Suspended booking entry creates no conversation",
    );
    assert.equal(
      JSON.parse(
        harness.runSql(
          `begin; ${restriction("customer", customer, "reactivate", 1, 3702)} commit;`,
        ),
      ).status,
      "completed",
    );

    const openingFirst = harness.startSession(`begin;
      set application_name='messaging_open_first';
      set local role service_role;
      select public.open_messaging_conversation_for_booking('${customer}','RC-REQ-0000000000001001','36000000-0000-4000-8000-000000003703');
      select 'MESSAGING_OPEN_FIRST_HELD';
    `);
    sessions.push(openingFirst);
    await harness.waitForMarker(openingFirst, "MESSAGING_OPEN_FIRST_HELD");
    const openingActorProbe = harness.runDocker(
      harness.psqlArguments(),
      `begin;
      select user_id from public.account_contexts
      where user_id='${customer}' for no key update nowait;
      rollback;
`,
    );
    assert.notEqual(
      openingActorProbe.status,
      0,
      "Booking entry holds actor SHARE independently of foreign-key KEY SHARE",
    );
    assert.match(
      openingActorProbe.stderr,
      /could not obtain lock on row in relation "account_contexts"/,
      "The non-key actor update is refused by its row lock, not a timeout or fixture error",
    );
    const restrictionAfterOpen = harness.startSession(
      `begin;
      set application_name='messaging_restriction_after_open';
      ${restriction("customer", customer, "suspend", 2, 3704)}
      commit;
    `,
      true,
    );
    sessions.push(restrictionAfterOpen);
    await harness.waitForLock(
      "messaging_restriction_after_open",
      restrictionAfterOpen,
    );
    assert.equal(
      harness.runSql(`select count(*) from pg_catalog.pg_stat_activity waiter
      join pg_catalog.pg_stat_activity holder on holder.pid=any(pg_catalog.pg_blocking_pids(waiter.pid))
      where waiter.application_name='messaging_restriction_after_open' and holder.application_name='messaging_open_first'
      and holder.wait_event_type is distinct from 'Lock';`),
      "1",
      "Booking writer holds actor authority; administrator waits without a reciprocal request/attempt cycle",
    );
    await harness.finishSession(openingFirst, { action: "commit" });
    await harness.finishSession(restrictionAfterOpen);
    const retainedBookingConversation = JSON.parse(resultLine(openingFirst));
    assert.equal(retainedBookingConversation.status, "created");
    assert.equal(
      JSON.parse(resultLine(restrictionAfterOpen)).status,
      "completed",
    );
    assert.equal(
      JSON.parse(
        harness.runSql(`set role service_role;
      select public.open_messaging_conversation_for_booking('${customer}','RC-REQ-0000000000001001','36000000-0000-4000-8000-000000003705');
    `),
      ).conversationId,
      retainedBookingConversation.conversationId,
      "Suspended customer retrieves the already attached booking conversation",
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.messaging_conversation_booking_requests where booking_request_id='${request}';`,
      ),
      "1",
      "Existing attached history adds no second link",
    );
    harness.markTimingPhase("cleanup");
    harness.runSql(cleanup);
    assert.deepEqual(
      JSON.parse(harness.runSql(publicationResidueSql)),
      { sourceRevisions: 0, reviewCycles: 0, publications: 0 },
      "Owned inquiry publication rows are absent before reseeding",
    );
    harness.markTimingPhase("setup");
    harness.runSql(confirmedFixtureSql);
    assert.equal(
      harness.runSql(`select public.is_cottage_publicly_discoverable('${profile}')
      and (select count(*) from public.cottage_shifts where schedule_revision_id='30000000-0000-4000-8000-000000001001')=3
      and (select quote_payload#>>'{items,1,position}' from public.booking_snapshots where id='40000000-0000-4000-8000-000000001001')='3';`),
      "t",
      "Inquiry fixture is public without rewriting the historical purchased three-shift snapshot",
    );
    harness.markTimingPhase("execution");

    const inquiryRestriction = harness.startSession(`begin;
      set application_name='messaging_inquiry_restriction';
      select user_id from public.account_contexts where user_id='${customer}' for update;
      select 'MESSAGING_INQUIRY_RESTRICTION_HELD';
    `);
    sessions.push(inquiryRestriction);
    await harness.waitForMarker(
      inquiryRestriction,
      "MESSAGING_INQUIRY_RESTRICTION_HELD",
    );
    const waitingInquiry = harness.startSession(
      `begin;
      set application_name='messaging_waiting_inquiry';
      set local role service_role;
      select public.create_messaging_conversation('${customer}','${profile}','36000000-0000-4000-8000-000000003706');
      commit;
    `,
      true,
    );
    sessions.push(waitingInquiry);
    await harness.waitForLock("messaging_waiting_inquiry", waitingInquiry);
    inquiryRestriction.child.stdin
      .write(`${restriction("customer", customer, "suspend", 0, 3707)}
      select 'MESSAGING_INQUIRY_RESTRICTION_APPLIED';
`);
    await harness.waitForMarker(
      inquiryRestriction,
      "MESSAGING_INQUIRY_RESTRICTION_APPLIED",
    );
    assert.equal(
      JSON.parse(resultLine(inquiryRestriction)).status,
      "completed",
    );
    await harness.finishSession(inquiryRestriction, { action: "commit" });
    await harness.finishSession(waitingInquiry);
    assert.equal(
      JSON.parse(resultLine(waitingInquiry)).status,
      "suspended",
      "Inquiry reads current customer restriction after actor wait",
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.messaging_conversations where customer_user_id='${customer}';`,
      ),
      "0",
    );
    assert.equal(
      JSON.parse(
        harness.runSql(
          `begin; ${restriction("customer", customer, "reactivate", 1, 3708)} commit;`,
        ),
      ).status,
      "completed",
    );
    const inquiryFirst = harness.startSession(`begin;
      set application_name='messaging_inquiry_first';
      set local role service_role;
      select public.create_messaging_conversation('${customer}','${profile}','36000000-0000-4000-8000-000000003709');
      select 'MESSAGING_INQUIRY_FIRST_HELD';
    `);
    sessions.push(inquiryFirst);
    await harness.waitForMarker(inquiryFirst, "MESSAGING_INQUIRY_FIRST_HELD");
    const restrictionAfterInquiry = harness.startSession(
      `begin;
      set application_name='messaging_restriction_after_inquiry';
      ${restriction("customer", customer, "suspend", 2, 3710)}
      commit;
    `,
      true,
    );
    sessions.push(restrictionAfterInquiry);
    await harness.waitForLock(
      "messaging_restriction_after_inquiry",
      restrictionAfterInquiry,
    );
    assert.equal(
      harness.runSql(`select count(*) from pg_catalog.pg_stat_activity waiter
      join pg_catalog.pg_stat_activity holder on holder.pid=any(pg_catalog.pg_blocking_pids(waiter.pid))
      where waiter.application_name='messaging_restriction_after_inquiry' and holder.application_name='messaging_inquiry_first'
      and holder.wait_event_type is distinct from 'Lock';`),
      "1",
      "Inquiry serializes before restriction with no reciprocal profile/actor cycle",
    );
    await harness.finishSession(inquiryFirst, { action: "commit" });
    await harness.finishSession(restrictionAfterInquiry);
    const retainedInquiry = JSON.parse(resultLine(inquiryFirst));
    assert.equal(retainedInquiry.status, "created");
    assert.equal(
      JSON.parse(resultLine(restrictionAfterInquiry)).status,
      "completed",
    );
    assert.equal(
      JSON.parse(
        harness.runSql(`set role service_role;
      select public.create_messaging_conversation('${customer}','${profile}','36000000-0000-4000-8000-000000003709');
    `),
      ).conversationId,
      retainedInquiry.conversationId,
      "Restriction preserves inquiry creation accepted before its serialization point",
    );
    assert.equal(
      JSON.parse(
        harness.runSql(
          `begin; ${restriction("customer", customer, "reactivate", 3, 3711)} commit;`,
        ),
      ).status,
      "completed",
    );
    const cottageRestrictionHolder = harness.startSession(`begin;
      set application_name='messaging_cottage_restriction';
      select id from public.owner_application_cottage_profiles where id='${profile}' for update;
      select 'MESSAGING_COTTAGE_RESTRICTION_HELD';
    `);
    sessions.push(cottageRestrictionHolder);
    await harness.waitForMarker(
      cottageRestrictionHolder,
      "MESSAGING_COTTAGE_RESTRICTION_HELD",
    );
    const waitingCottageInquiry = harness.startSession(
      `begin;
      set application_name='messaging_waiting_cottage_inquiry';
      set local role service_role;
      select public.create_messaging_conversation('${customer}','${profile}','36000000-0000-4000-8000-000000003721');
      commit;
    `,
      true,
    );
    sessions.push(waitingCottageInquiry);
    await harness.waitForLock(
      "messaging_waiting_cottage_inquiry",
      waitingCottageInquiry,
    );
    assert.equal(
      harness.runSql(`select count(*) from pg_catalog.pg_stat_activity waiter
      join pg_catalog.pg_stat_activity holder on holder.pid=any(pg_catalog.pg_blocking_pids(waiter.pid))
      where waiter.application_name='messaging_waiting_cottage_inquiry' and holder.application_name='messaging_cottage_restriction'
      and holder.wait_event_type is distinct from 'Lock';`),
      "1",
      "Inquiry waits only for the profile; cottage restriction needs no reciprocal customer authority lock",
    );
    cottageRestrictionHolder.child.stdin
      .write(`${restriction("cottage", profile, "suspend", 0, 3722)}
      select 'MESSAGING_COTTAGE_RESTRICTION_APPLIED';
`);
    await harness.waitForMarker(
      cottageRestrictionHolder,
      "MESSAGING_COTTAGE_RESTRICTION_APPLIED",
    );
    assert.equal(
      JSON.parse(resultLine(cottageRestrictionHolder)).status,
      "completed",
    );
    await harness.finishSession(cottageRestrictionHolder, { action: "commit" });
    await harness.finishSession(waitingCottageInquiry);
    assert.equal(
      JSON.parse(resultLine(waitingCottageInquiry)).status,
      "access-required",
      "Inquiry rechecks full current public eligibility after the profile wait",
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.messaging_conversations where creation_command_id='36000000-0000-4000-8000-000000003721';`,
      ),
      "0",
    );
    const cottageRestoration = JSON.parse(
      harness.runSql(
        `begin; ${restriction("cottage", profile, "reactivate", 1, 3723)} commit;`,
      ),
    );
    assert.equal(cottageRestoration.status, "completed");
    assert.equal(
      cottageRestoration.target.state,
      "paused",
      "A cottage without owner verification restores paused rather than inventing owner eligibility",
    );
    harness.markTimingPhase("cleanup");
    harness.runSql(cleanup);
    assert.deepEqual(
      JSON.parse(harness.runSql(publicationResidueSql)),
      { sourceRevisions: 0, reviewCycles: 0, publications: 0 },
      "Cottage-wait fixture publication rows are absent before independent inquiry setup",
    );
    harness.markTimingPhase("setup");
    harness.runSql(confirmedFixtureSql);
    assert.equal(
      harness.runSql(`select public.is_cottage_publicly_discoverable('${profile}')
      and (select count(*) from public.cottage_shifts where schedule_revision_id='30000000-0000-4000-8000-000000001001')=3
      and (select quote_payload#>>'{items,1,position}' from public.booking_snapshots where id='40000000-0000-4000-8000-000000001001')='3';`),
      "t",
      "Independent inquiry starts from the original public historical purchase fixture",
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
    const associationActorProbe = harness.runDocker(
      harness.psqlArguments(),
      `\\set VERBOSITY verbose
      begin;
      select user_id from public.account_contexts
      where user_id='${customer}' for no key update nowait;
      rollback;
`,
    );
    assert.notEqual(
      associationActorProbe.status,
      0,
      "Message admission holds actor SHARE before its conversation wait",
    );
    assert.match(
      associationActorProbe.stderr,
      /55P03: could not obtain lock on row in relation "account_contexts"/,
      "The waiting sender holds actor authority, not a timeout or fixture error",
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

    const committedBookingFacts = harness.runSql(`select jsonb_build_object(
      'request',(select to_jsonb(rows) from public.booking_requests rows where id='${request}'),
      'snapshot',(select to_jsonb(rows) from public.booking_snapshots rows where id=(select booking_snapshot_id from public.booking_requests where id='${request}')),
      'confirmation',(select to_jsonb(rows) from public.booking_confirmations rows where booking_request_id='${request}'),
      'link',(select to_jsonb(rows) from public.messaging_conversation_booking_requests rows where booking_request_id='${request}')
    );`);
    const sendRestrictionHolder = harness.startSession(`begin;
      set application_name='messaging_send_restriction';
      select id from public.booking_requests where id='${request}' for update;
      select id from public.messaging_conversations where id='${conversation}' for update;
      select 'MESSAGING_SEND_RESTRICTION_HELD';
    `);
    sessions.push(sendRestrictionHolder);
    await harness.waitForMarker(
      sendRestrictionHolder,
      "MESSAGING_SEND_RESTRICTION_HELD",
    );
    const waitingSend = harness.startSession(
      `begin;
      set application_name='messaging_suspended_send';
      set local role service_role;
      select public.admit_messaging_message('${customer}','${conversation}','36000000-0000-4000-8000-000000003712','en','A restricted question');
      commit;
    `,
      true,
    );
    sessions.push(waitingSend);
    await harness.waitForLock("messaging_suspended_send", waitingSend);
    sendRestrictionHolder.child.stdin
      .write(`${restriction("customer", customer, "suspend", 0, 3713)}
      select 'MESSAGING_SEND_RESTRICTION_APPLIED';
`);
    await harness.waitForMarker(
      sendRestrictionHolder,
      "MESSAGING_SEND_RESTRICTION_APPLIED",
    );
    assert.equal(
      JSON.parse(resultLine(sendRestrictionHolder)).status,
      "completed",
    );
    await harness.finishSession(sendRestrictionHolder, { action: "commit" });
    await harness.finishSession(waitingSend);
    assert.equal(
      JSON.parse(resultLine(waitingSend)).status,
      "suspended",
      "Send rechecks customer after request/conversation wait",
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.messaging_send_attempts where conversation_id='${conversation}';`,
      ),
      "0",
      "Suspended send writes no attempt or moderation receipt",
    );
    assert.equal(
      harness.runSql(
        `select count(*) from public.messaging_messages where conversation_id='${conversation}';`,
      ),
      "0",
      "Suspended send writes no message",
    );
    assert.equal(
      JSON.parse(
        harness.runSql(
          `begin; ${restriction("customer", customer, "reactivate", 1, 3714)} commit;`,
        ),
      ).status,
      "completed",
    );
    const sendingFirst = harness.startSession(`begin;
      set application_name='messaging_send_first';
      set local role service_role;
      select public.admit_messaging_message('${customer}','${conversation}','36000000-0000-4000-8000-000000003715','en','A retained message');
      select 'MESSAGING_SEND_FIRST_HELD';
    `);
    sessions.push(sendingFirst);
    await harness.waitForMarker(sendingFirst, "MESSAGING_SEND_FIRST_HELD");
    const sendingActorProbe = harness.runDocker(
      harness.psqlArguments(),
      `begin;
      select user_id from public.account_contexts
      where user_id='${customer}' for no key update nowait;
      rollback;
`,
    );
    assert.notEqual(
      sendingActorProbe.status,
      0,
      "Message admission holds actor SHARE independently of foreign-key KEY SHARE",
    );
    assert.match(
      sendingActorProbe.stderr,
      /could not obtain lock on row in relation "account_contexts"/,
      "The non-key actor update is refused by its row lock, not a timeout or fixture error",
    );
    const restrictionAfterSend = harness.startSession(
      `begin;
      set application_name='messaging_restriction_after_send';
      ${restriction("customer", customer, "suspend", 2, 3716)}
      commit;
    `,
      true,
    );
    sessions.push(restrictionAfterSend);
    await harness.waitForLock(
      "messaging_restriction_after_send",
      restrictionAfterSend,
    );
    assert.equal(
      harness.runSql(`select count(*) from pg_catalog.pg_stat_activity waiter
      join pg_catalog.pg_stat_activity holder on holder.pid=any(pg_catalog.pg_blocking_pids(waiter.pid))
      where waiter.application_name='messaging_restriction_after_send' and holder.application_name='messaging_send_first'
      and holder.wait_event_type is distinct from 'Lock';`),
      "1",
      "Message writer owns current actor authority without a reciprocal request/conversation cycle",
    );
    await harness.finishSession(sendingFirst, { action: "commit" });
    await harness.finishSession(restrictionAfterSend);
    const retainedMessage = JSON.parse(resultLine(sendingFirst));
    assert.equal(retainedMessage.status, "sent");
    assert.equal(
      JSON.parse(resultLine(restrictionAfterSend)).status,
      "completed",
    );
    assert.deepEqual(
      JSON.parse(
        harness.runSql(`set role service_role;
      select public.admit_messaging_message('${customer}','${conversation}','36000000-0000-4000-8000-000000003715','en','A retained message');
    `),
      ),
      retainedMessage,
      "A message admitted before suspension retains its exact original receipt",
    );
    const restrictedHistory = JSON.parse(
      harness.runSql(`begin;
      set local request.jwt.claim.sub='${customer}';
      set local request.jwt.claims='{"sub":"${customer}","aal":"aal1"}';
      set local role authenticated;
      select public.get_messaging_conversation('${conversation}',null,20);
      commit;
    `),
    );
    assert.equal(restrictedHistory.sendRestriction, "customer-suspended");
    assert.equal(restrictedHistory.canContinueBookingRequest, false);
    assert.equal(restrictedHistory.booking.contactAllowed, true);
    assert.equal(
      restrictedHistory.messages[0].messageId,
      retainedMessage.messageId,
    );
    assert.equal(
      restrictedHistory.messages[0].originalBody,
      "A retained message",
    );
    assert.equal(
      harness.runSql(`select jsonb_build_object(
      'request',(select to_jsonb(rows) from public.booking_requests rows where id='${request}'),
      'snapshot',(select to_jsonb(rows) from public.booking_snapshots rows where id=(select booking_snapshot_id from public.booking_requests where id='${request}')),
      'confirmation',(select to_jsonb(rows) from public.booking_confirmations rows where booking_request_id='${request}'),
      'link',(select to_jsonb(rows) from public.messaging_conversation_booking_requests rows where booking_request_id='${request}')
    );`),
      committedBookingFacts,
      "Suspension preserves exact financial/history bytes, participant IDs, confirmation and attached link",
    );
    assert.equal(
      JSON.parse(
        harness.runSql(
          `begin; ${restriction("customer", customer, "reactivate", 3, 3717)} commit;`,
        ),
      ).status,
      "completed",
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
    assert.equal(
      harness.runSql(`select
      (select count(*) from auth.users where id='${administrator}')+
      (select count(*) from public.account_contexts where user_id='${administrator}');`),
      "0",
      "Recovered fixture owns an absent synthetic administrator",
    );
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

    assert.equal(
      JSON.parse(
        harness.runSql(
          `begin; ${restriction("cottage", profile, "suspend", 0, 3718)} commit;`,
        ),
      ).status,
      "completed",
    );
    const cottageRestrictedSend = JSON.parse(
      harness.runSql(`set role service_role;
      select public.admit_messaging_message('${customer}','${conversation}','36000000-0000-4000-8000-000000003719','en','Call +964 750 123 4567');
    `),
    );
    assert.equal(
      cottageRestrictedSend.status,
      "sent",
      "suspension_preserves_conversation_history_and_confirmed_cottage_rights: cottage-only restriction preserves confirmed communication/contact rights",
    );
    const cottageRestrictedHistory = JSON.parse(
      harness.runSql(`begin;
      set local request.jwt.claim.sub='${customer}';
      set local request.jwt.claims='{"sub":"${customer}","aal":"aal1"}';
      set local role authenticated;
      select public.get_messaging_conversation('${conversation}',null,20);
      commit;
    `),
    );
    assert.equal(cottageRestrictedHistory.sendRestriction, null);
    assert.equal(cottageRestrictedHistory.booking.contactAllowed, true);
    assert.equal(cottageRestrictedHistory.booking.writingClosed, false);
    assert.equal(
      cottageRestrictedHistory.messages[0].messageId,
      cottageRestrictedSend.messageId,
    );
    assert.equal(
      JSON.parse(
        harness.runSql(
          `begin; ${restriction("cottage", profile, "reactivate", 1, 3720)} commit;`,
        ),
      ).status,
      "completed",
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
      "Messaging suspension passed actual administrator restriction before and after inquiry, booking-link and message writes, immutable confirmed history and cottage-only communication rights. Messaging concurrency passed association revalidation, pre-lock stranger rejection, nonlocking committed reader projection, post-wait authority and payment rechecks, report retry deduplication, Booking Request before conversation lock order, and post-wait cutoff enforcement.",
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
          'sourceRevisions',(select count(*) from public.cottage_profile_source_revisions where id='${sourceRevisionId}'),
          'reviewCycles',(select count(*) from public.cottage_profile_review_cycles where id='${reviewCycleId}'),
          'publications',(select count(*) from public.cottage_publication_snapshots where id='${publicationId}'),
          'suspensionActions',(select count(*) from private.marketplace_suspension_actions where account_user_id in ('${customer}','${owner}') or profile_id='${profile}'),
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
          sourceRevisions: 0,
          reviewCycles: 0,
          publications: 0,
          suspensionActions: 0,
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
      // eslint-disable-next-line no-unsafe-finally -- reports the verification failure together with any cleanup failure
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
