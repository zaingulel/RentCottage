import assert from "node:assert/strict";

import { customerReviewCleanup } from "./lib/booking-fixture.mjs";
import { customerReviewFixture } from "./lib/customer-review-fixture.mjs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness({
  timing: { check: "verify-customer-review-concurrency", isolation: "serial" },
});
let timingOutcome = "failed";
try {
  harness.markTimingPhase("setup");
  const sessions = [];
  let assertions = 0;

  function check(actual, expected, message) {
    assert.deepEqual(actual, expected, message);
    assertions += 1;
  }

  function actor(userId, assurance = "aal1") {
    return `set local role authenticated;
set local request.jwt.claim.sub='${userId}';
set local request.jwt.claims='{"sub":"${userId}","role":"authenticated","aal":"${assurance}"}';`;
  }

  function jsonResults(session) {
    return session.stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
  }

  function namespaceSuffix(namespace, sequence) {
    return `00000000${namespace}${String(sequence).padStart(2, "0")}`;
  }

  function reviewPublicSlug(namespace) {
    return `cottage-deadbeefdeadbeefdeadbeefdead00${namespace}`;
  }

  async function finish(session, action = "rollback") {
    if (!session || session.exit) return;
    await harness.finishSession(session, { action });
  }

  harness.guardDisposableLocalDatabase();
  try {
    for (const namespace of ["47", "48", "49"]) {
      check(
        harness.runSql(
          `select count(*)::integer from public.booking_requests where id='60000000-0000-4000-8000-${namespaceSuffix(namespace, 1)}';`,
        ),
        "0",
        `namespace ${namespace} must start empty`,
      );
    }

    const duplicateFixture = customerReviewFixture({
      namespace: "47",
      startDaySql: "((clock_timestamp() at time zone 'Asia/Baghdad')::date-3)",
      complete: true,
      publish: true,
    });
    harness.runSql(duplicateFixture.sql);
    const duplicatePublicSlug = reviewPublicSlug("47");
    harness.runSql(`update public.cottage_marketplace_listings
set public_slug='${duplicatePublicSlug}',state='paused'
where profile_id='${duplicateFixture.ids.profileId}';`);
    harness.markTimingPhase("execution");
    const customerRestriction = (
      action,
      revision,
      command,
    ) => `${actor(duplicateFixture.ids.administratorUserId, "aal2")}
select public.set_marketplace_suspension('customer','${duplicateFixture.ids.customerUserId}','${action}',${revision},'Fictional review safety restriction','44000000-0000-4000-8000-${String(command).padStart(12, "0")}');`;
    const restrictionHolder = harness.startSession(`begin;
set application_name='customer_review_restriction_holder';
select id from public.booking_requests where id='${duplicateFixture.ids.requestId}' for update;
select 'REVIEW_RESTRICTION_HELD';`);
    sessions.push(restrictionHolder);
    await harness.waitForMarker(restrictionHolder, "REVIEW_RESTRICTION_HELD");
    const restrictedWriter = harness.startSession(
      `begin;
set application_name='customer_review_restricted_writer';
${actor(duplicateFixture.ids.customerUserId)}
select public.submit_customer_review('${duplicateFixture.ids.bookingReference}',5,'en','A blocked review');
commit;`,
      true,
    );
    sessions.push(restrictedWriter);
    await harness.waitForLock(
      "customer_review_restricted_writer",
      restrictedWriter,
    );
    check(
      harness.runSql(`select count(*)::integer from pg_catalog.pg_stat_activity waiter
where waiter.application_name='customer_review_restricted_writer'
and exists(select 1 from pg_catalog.pg_stat_activity holder where holder.application_name='customer_review_restriction_holder' and holder.pid=any(pg_catalog.pg_blocking_pids(waiter.pid)));`),
      "1",
      "review waiter is blocked by the held request",
    );
    restrictionHolder.child.stdin
      .write(`${customerRestriction("suspend", 0, 310)}
select 'REVIEW_RESTRICTION_APPLIED';
`);
    await harness.waitForMarker(
      restrictionHolder,
      "REVIEW_RESTRICTION_APPLIED",
    );
    check(
      jsonResults(restrictionHolder)[0]?.status,
      "completed",
      "actual customer restriction wins before waiting review",
    );
    await harness.finishSession(restrictionHolder, { action: "commit" });
    await harness.finishSession(restrictedWriter);
    check(
      jsonResults(restrictedWriter)[0],
      { status: "suspended" },
      "review rechecks current customer restriction after request wait",
    );
    check(
      harness.runSql(
        `select count(*)::integer from public.customer_reviews where booking_request_id='${duplicateFixture.ids.requestId}';`,
      ),
      "0",
      "restricted waiter creates no review",
    );
    check(
      JSON.parse(
        harness.runSql(
          `begin; ${customerRestriction("reactivate", 1, 311)} commit;`,
        ),
      ).status,
      "completed",
      "reactivation permits the next independent review",
    );
    const duplicateHolder = harness.startSession(`
begin;
set application_name='customer_review_duplicate_holder';
${actor(duplicateFixture.ids.customerUserId)}
select public.submit_customer_review(
  '${duplicateFixture.ids.bookingReference}',5,'en','First committed review'
);
reset role;
select to_jsonb(reviews) from public.customer_reviews reviews where booking_request_id='${duplicateFixture.ids.requestId}';
select 'CUSTOMER_REVIEW_DUPLICATE_HELD';
`);
    sessions.push(duplicateHolder);
    await harness.waitForMarker(
      duplicateHolder,
      "CUSTOMER_REVIEW_DUPLICATE_HELD",
    );
    const duplicateContender = harness.startSession(
      `begin;
set application_name='customer_review_duplicate_contender';
${actor(duplicateFixture.ids.customerUserId)}
select public.submit_customer_review(
  '${duplicateFixture.ids.bookingReference}',1,'ckb','Competing review'
);
commit;`,
      true,
    );
    sessions.push(duplicateContender);
    await harness.waitForLock(
      "customer_review_duplicate_contender",
      duplicateContender,
    );
    assertions += 1;
    const restrictionAfterWrite = harness.startSession(
      `begin;
set application_name='customer_review_restriction_after_write';
${customerRestriction("suspend", 2, 312)} commit;`,
      true,
    );
    sessions.push(restrictionAfterWrite);
    await harness.waitForLock(
      "customer_review_restriction_after_write",
      restrictionAfterWrite,
    );
    check(
      harness.runSql(
        `select count(*)::integer from pg_catalog.pg_stat_activity waiter where waiter.application_name='customer_review_restriction_after_write' and exists(select 1 from pg_catalog.pg_stat_activity holder where holder.application_name='customer_review_duplicate_holder' and holder.pid=any(pg_catalog.pg_blocking_pids(waiter.pid)));`,
      ),
      "1",
      "new review holds customer authority until its write commits",
    );
    await harness.finishSession(duplicateHolder, { action: "commit" });
    await harness.finishSession(restrictionAfterWrite);
    await harness.finishSession(duplicateContender);
    const submitted = jsonResults(duplicateHolder)[0];
    check(submitted?.status, "submitted", "first submit wins");
    check(
      Object.keys(submitted ?? {}).sort(),
      ["affectedPublicSlug", "reviewId", "status", "submittedAt"],
      "new submit returns the exact target-bearing result shape",
    );
    check(
      submitted?.affectedPublicSlug,
      duplicatePublicSlug,
      "new submit returns the stored non-derived public slug",
    );
    const duplicate = jsonResults(duplicateContender)[0];
    check(
      duplicate?.status,
      "duplicate",
      "contending submit observes the committed duplicate",
    );
    check(
      Object.keys(duplicate ?? {}).sort(),
      ["reviewId", "status", "submittedAt"],
      "submit replay remains target-free",
    );
    check(
      harness.runSql(
        `select count(*)::integer from public.customer_reviews where booking_request_id='${duplicateFixture.ids.requestId}';`,
      ),
      "1",
      "concurrent submission stores one review",
    );

    const committedReview = jsonResults(duplicateHolder)[1];
    check(
      jsonResults(restrictionAfterWrite)[0]?.status,
      "completed",
      "restriction after review commit completes",
    );
    check(
      JSON.parse(
        harness.runSql(
          `select to_jsonb(reviews) from public.customer_reviews reviews where booking_request_id='${duplicateFixture.ids.requestId}';`,
        ),
      ),
      committedReview,
      "review committed before restriction retains every byte and ID",
    );
    const retained = JSON.parse(
      harness.runSql(
        `begin; ${actor(duplicateFixture.ids.customerUserId)} select public.get_customer_review('${duplicateFixture.ids.bookingReference}'); commit;`,
      ),
    );
    check(
      retained.reviewId,
      submitted.reviewId,
      "suspended customer reads the same submitted review",
    );
    check(
      retained.originalBody,
      "First committed review",
      "suspended customer reads exact original review bytes",
    );
    check(
      JSON.parse(
        harness.runSql(
          `begin; ${actor(duplicateFixture.ids.customerUserId)} select public.submit_customer_review('${duplicateFixture.ids.bookingReference}',1,'en','Replacement'); commit;`,
        ),
      ),
      {
        status: "duplicate",
        reviewId: submitted.reviewId,
        submittedAt: submitted.submittedAt,
      },
      "suspended customer duplicate returns original identity and timestamp",
    );
    const replyApprovalHolder = harness.startSession(`begin;
set application_name='customer_review_reply_approval_holder';
select id from public.customer_reviews where id='${submitted.reviewId}' for update;
select 'REPLY_APPROVAL_HELD';`);
    sessions.push(replyApprovalHolder);
    await harness.waitForMarker(replyApprovalHolder, "REPLY_APPROVAL_HELD");
    const staleReply = harness.startSession(
      `begin;
set application_name='customer_review_stale_reply';
${actor(duplicateFixture.ids.ownerUserId)}
select public.submit_customer_review_reply('${duplicateFixture.ids.bookingReference}','en','Revoked owner reply'); commit;`,
      true,
    );
    sessions.push(staleReply);
    await harness.waitForLock("customer_review_stale_reply", staleReply);
    check(
      harness.runSql(
        `select count(*)::integer from pg_catalog.pg_stat_activity waiter where waiter.application_name='customer_review_stale_reply' and exists(select 1 from pg_catalog.pg_stat_activity holder where holder.application_name='customer_review_reply_approval_holder' and holder.pid=any(pg_catalog.pg_blocking_pids(waiter.pid)));`,
      ),
      "1",
      "reply waits on the held review before approval changes",
    );
    replyApprovalHolder.child.stdin
      .write(`update public.account_contexts set owner_approval_state='suspended' where user_id='${duplicateFixture.ids.ownerUserId}';
select 'REPLY_APPROVAL_REVOKED';
`);
    await harness.waitForMarker(replyApprovalHolder, "REPLY_APPROVAL_REVOKED");
    await harness.finishSession(replyApprovalHolder, { action: "commit" });
    await harness.finishSession(staleReply, { expectedState: "42501" });
    assertions += 1;
    check(
      harness.runSql(
        `select count(*)::integer from public.customer_review_replies where review_id='${submitted.reviewId}';`,
      ),
      "0",
      "current owner approval denies new reply after wait",
    );
    harness.runSql(
      `update public.account_contexts set owner_approval_state='approved' where user_id='${duplicateFixture.ids.ownerUserId}';`,
    );
    check(
      JSON.parse(
        harness.runSql(`begin;
${actor(duplicateFixture.ids.administratorUserId, "aal2")}
select public.set_marketplace_suspension('customer','${duplicateFixture.ids.ownerUserId}','suspend',0,'Independent customer capability','44000000-0000-4000-8000-000000000313'); commit;`),
      ).status,
      "completed",
      "approved owner customer capability is independently restricted",
    );
    const replyHolder = harness.startSession(`
begin;
set application_name='customer_review_reply_holder';
${actor(duplicateFixture.ids.ownerUserId)}
select public.submit_customer_review_reply(
  '${duplicateFixture.ids.bookingReference}','en','First committed reply'
);
select 'CUSTOMER_REVIEW_REPLY_HELD';
`);
    sessions.push(replyHolder);
    await harness.waitForMarker(replyHolder, "CUSTOMER_REVIEW_REPLY_HELD");
    const replyContender = harness.startSession(
      `begin;
set application_name='customer_review_reply_contender';
${actor(duplicateFixture.ids.ownerUserId)}
select public.submit_customer_review_reply(
  '${duplicateFixture.ids.bookingReference}','en','Competing reply'
);
commit;`,
      true,
    );
    sessions.push(replyContender);
    await harness.waitForLock(
      "customer_review_reply_contender",
      replyContender,
    );
    assertions += 1;
    const approvalAfterReply = harness.startSession(
      `begin;
set application_name='customer_review_approval_after_reply';
update public.account_contexts set owner_approval_state='suspended' where user_id='${duplicateFixture.ids.ownerUserId}'; commit;`,
      true,
    );
    sessions.push(approvalAfterReply);
    await harness.waitForLock(
      "customer_review_approval_after_reply",
      approvalAfterReply,
    );
    check(
      harness.runSql(
        `select count(*)::integer from pg_catalog.pg_stat_activity waiter where waiter.application_name='customer_review_approval_after_reply' and exists(select 1 from pg_catalog.pg_stat_activity holder where holder.application_name='customer_review_reply_holder' and holder.pid=any(pg_catalog.pg_blocking_pids(waiter.pid)));`,
      ),
      "1",
      "new reply holds current owner authority until its write commits",
    );
    await harness.finishSession(replyHolder, { action: "commit" });
    await harness.finishSession(replyContender);
    await harness.finishSession(approvalAfterReply);
    harness.runSql(
      `update public.account_contexts set owner_approval_state='approved' where user_id='${duplicateFixture.ids.ownerUserId}';`,
    );
    const replied = jsonResults(replyHolder)[0];
    check(
      {
        status: replied?.status,
        keys: Object.keys(replied ?? {}).sort(),
      },
      {
        status: "replied",
        keys: ["affectedPublicSlug", "reviewId", "status", "submittedAt"],
      },
      "first reply wins",
    );
    const duplicateReply = jsonResults(replyContender)[0];
    check(
      {
        status: duplicateReply?.status,
        keys: Object.keys(duplicateReply ?? {}).sort(),
      },
      { status: "duplicate", keys: ["reviewId", "status", "submittedAt"] },
      "contending reply observes the committed duplicate",
    );
    check(
      JSON.parse(
        harness.runSql(
          `select jsonb_build_object('count',count(*),'bodies',coalesce(jsonb_agg(original_body),'[]'::jsonb)) from public.customer_review_replies where review_id='${submitted.reviewId}';`,
        ),
      ),
      { count: 1, bodies: ["First committed reply"] },
      "concurrent replies store one reply",
    );

    harness.markTimingPhase("setup");
    const deadlineFixture = customerReviewFixture({
      namespace: "48",
      startDaySql: "((clock_timestamp() at time zone 'Asia/Baghdad')::date-16)",
      accessRangesSql: `tstzmultirange(
        tstzrange((((current_timestamp at time zone 'Asia/Baghdad')::date-16)::timestamp at time zone 'UTC')+interval '5 hours',(((current_timestamp at time zone 'Asia/Baghdad')::date-16)::timestamp at time zone 'UTC')+interval '9 hours','[)'),
        tstzrange((((current_timestamp at time zone 'Asia/Baghdad')::date-16)::timestamp at time zone 'UTC')+interval '17 hours',(((current_timestamp at time zone 'Asia/Baghdad')::date-16)::timestamp at time zone 'UTC')+interval '23 hours','[)'),
        tstzrange(current_timestamp-interval '14 days 1 minute',current_timestamp-interval '14 days'+interval '15 seconds','[)')
    )`,
      complete: true,
      publish: true,
    });
    harness.runSql(deadlineFixture.sql);
    harness.runSql(`update public.cottage_marketplace_listings
set public_slug='${reviewPublicSlug("48")}',state='paused'
where profile_id='${deadlineFixture.ids.profileId}';`);
    harness.markTimingPhase("execution");
    const deadlineHolder = harness.startSession(`
begin;
set application_name='customer_review_deadline_holder';
select id from public.booking_requests
where id='${deadlineFixture.ids.requestId}' for update;
select 'CUSTOMER_REVIEW_DEADLINE_HELD';
`);
    sessions.push(deadlineHolder);
    await harness.waitForMarker(
      deadlineHolder,
      "CUSTOMER_REVIEW_DEADLINE_HELD",
    );
    const deadlineContender = harness.startSession(
      `begin;
set application_name='customer_review_deadline_contender';
select jsonb_build_object(
  'transactionStartedAt',transaction_timestamp(),
  'reviewExpiresAt',(
    select review_expires_at
    from public.booking_completion_maturity
    where booking_request_id='${deadlineFixture.ids.requestId}'
  ),
  'observedBeforeCallAt',clock_timestamp()
);
select 'CUSTOMER_REVIEW_DEADLINE_CLOCKS_READY';
${actor(deadlineFixture.ids.customerUserId)}
select public.submit_customer_review(
  '${deadlineFixture.ids.bookingReference}',5,'en','Arrived before the lock released'
);
commit;`,
      true,
    );
    sessions.push(deadlineContender);
    await harness.waitForLock(
      "customer_review_deadline_contender",
      deadlineContender,
    );
    await harness.waitForMarker(
      deadlineContender,
      "CUSTOMER_REVIEW_DEADLINE_CLOCKS_READY",
    );
    assertions += 1;
    const [deadlinePreCall] = jsonResults(deadlineContender);
    check(
      Object.keys(deadlinePreCall ?? {}).sort(),
      ["observedBeforeCallAt", "reviewExpiresAt", "transactionStartedAt"],
      "the deadline contender records its transaction and pre-call database clocks",
    );
    check(
      Date.parse(deadlinePreCall.transactionStartedAt) <=
        Date.parse(deadlinePreCall.observedBeforeCallAt) &&
        Date.parse(deadlinePreCall.observedBeforeCallAt) <
          Date.parse(deadlinePreCall.reviewExpiresAt),
      true,
      "the contender transaction starts and reaches the locked call before expiry",
    );
    const observeDeadlineWait = () =>
      JSON.parse(
        harness.runSql(`select jsonb_build_object(
        'observedAt',clock_timestamp(),
        'reviewExpiresAt',(
          select review_expires_at
          from public.booking_completion_maturity
          where booking_request_id='${deadlineFixture.ids.requestId}'
        ),
        'waiterCount',(
          select count(*)::integer
          from pg_catalog.pg_stat_activity
          where application_name='customer_review_deadline_contender'
            and wait_event_type='Lock'
        )
      );`),
      );
    let deadlineWait = observeDeadlineWait();
    check(
      deadlineWait.waiterCount === 1 &&
        deadlineWait.reviewExpiresAt === deadlinePreCall.reviewExpiresAt &&
        Date.parse(deadlineWait.observedAt) <
          Date.parse(deadlineWait.reviewExpiresAt),
      true,
      "deadline fixture preparation leaves the same contender waiting before expiry",
    );
    while (
      Date.parse(deadlineWait.observedAt) <
      Date.parse(deadlineWait.reviewExpiresAt)
    ) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      deadlineWait = observeDeadlineWait();
      if (deadlineWait.waiterCount !== 1) {
        throw new Error("Deadline contender stopped waiting before expiry");
      }
    }
    check(
      deadlineWait.waiterCount === 1 &&
        Date.parse(deadlineWait.observedAt) >=
          Date.parse(deadlineWait.reviewExpiresAt),
      true,
      "the same lock wait remains observable when the database deadline expires",
    );
    await harness.finishSession(deadlineHolder, { action: "commit" });
    await harness.finishSession(deadlineContender);
    const [, deadlineResult] = jsonResults(deadlineContender);
    check(
      deadlineResult?.status,
      "ineligible",
      "admission revalidates database time after the booking lock wait",
    );
    check(
      harness.runSql(
        `select count(*)::integer from public.customer_reviews where booking_request_id='${deadlineFixture.ids.requestId}';`,
      ),
      "0",
      "expired lock waiter publishes no review",
    );

    harness.markTimingPhase("setup");
    const hideFixture = customerReviewFixture({
      namespace: "49",
      startDaySql: "((clock_timestamp() at time zone 'Asia/Baghdad')::date-3)",
      complete: true,
      publish: true,
    });
    harness.runSql(hideFixture.sql);
    const hidePublicSlug = reviewPublicSlug("49");
    harness.runSql(`update public.cottage_marketplace_listings
set public_slug='${hidePublicSlug}',state='paused'
where profile_id='${hideFixture.ids.profileId}';`);
    const hideSubmission = JSON.parse(
      harness.runSql(`begin;
${actor(hideFixture.ids.customerUserId)}
select public.submit_customer_review(
  '${hideFixture.ids.bookingReference}',5,'en','Review to moderate'
);
commit;`),
    );
    check(
      hideSubmission.affectedPublicSlug,
      hidePublicSlug,
      "moderation fixture submission resolves its stored public slug",
    );
    const reviewId = hideSubmission.reviewId;
    const secondAdministrator = `10000000-0000-4000-8000-${namespaceSuffix("49", 82)}`;
    harness.runSql(`
insert into auth.users(id,aud,role,email,email_confirmed_at)
values('${secondAdministrator}','authenticated','authenticated','review-49-second-admin@example.test',clock_timestamp());
insert into public.account_contexts(user_id,role)
values('${secondAdministrator}','platform_administrator');
`);
    const setHideListingState = (state) =>
      harness.runSql(`update public.cottage_marketplace_listings
set state='${state}'
where profile_id='${hideFixture.ids.profileId}';`);
    const saveTranslation = (targetLanguage, translatedBody) =>
      `set local role service_role;
select public.save_customer_review_translation(
  '${hideFixture.ids.customerUserId}','${reviewId}','review','${targetLanguage}',
  'fictional-local-test','deterministic-pairs-v1','review-pairs-v1',
  '${translatedBody}'
);`;
    harness.markTimingPhase("execution");
    setHideListingState("published");
    const translationHolder = harness.startSession(`
begin;
set application_name='customer_review_translation_holder';
${saveTranslation("ar", "تقييم للمراجعة")}
select 'CUSTOMER_REVIEW_TRANSLATION_HELD';
`);
    sessions.push(translationHolder);
    await harness.waitForMarker(
      translationHolder,
      "CUSTOMER_REVIEW_TRANSLATION_HELD",
    );
    const translationContender = harness.startSession(
      `begin;
set application_name='customer_review_translation_contender';
${saveTranslation("ar", "تقييم للمراجعة")}
commit;`,
      true,
    );
    sessions.push(translationContender);
    await harness.waitForLock(
      "customer_review_translation_contender",
      translationContender,
    );
    assertions += 1;
    await harness.finishSession(translationHolder, { action: "commit" });
    await harness.finishSession(translationContender);
    const savedTranslation = jsonResults(translationHolder)[0];
    check(
      {
        status: savedTranslation?.status,
        translatedBody: savedTranslation?.translatedBody,
      },
      { status: "translated", translatedBody: "تقييم للمراجعة" },
      "first translation save wins",
    );
    check(
      jsonResults(translationContender)[0],
      savedTranslation,
      "concurrent identical translation saves return one stable translation",
    );
    check(
      harness.runSql(
        `select count(*)::integer from public.customer_review_translations where review_id='${reviewId}';`,
      ),
      "1",
      "concurrent identical translation saves store one translation",
    );
    const reportTranslation = `set local role service_role;
select public.report_customer_review_translation(
  '${hideFixture.ids.customerUserId}','${savedTranslation.translationId}'
);`;
    const translationReportHolder = harness.startSession(`
begin;
set application_name='customer_review_translation_report_holder';
${reportTranslation}
select 'CUSTOMER_REVIEW_TRANSLATION_REPORT_HELD';
`);
    sessions.push(translationReportHolder);
    await harness.waitForMarker(
      translationReportHolder,
      "CUSTOMER_REVIEW_TRANSLATION_REPORT_HELD",
    );
    const translationReportContender = harness.startSession(
      `begin;
set application_name='customer_review_translation_report_contender';
${reportTranslation}
commit;`,
      true,
    );
    sessions.push(translationReportContender);
    await harness.waitForLock(
      "customer_review_translation_report_contender",
      translationReportContender,
    );
    assertions += 1;
    await harness.finishSession(translationReportHolder, { action: "commit" });
    await harness.finishSession(translationReportContender);
    const reportedTranslation = jsonResults(translationReportHolder)[0];
    check(
      reportedTranslation?.status,
      "reported",
      "first translation report wins",
    );
    check(
      jsonResults(translationReportContender)[0],
      reportedTranslation,
      "concurrent identical translation reports return one stable report",
    );
    check(
      harness.runSql(
        `select id from public.customer_review_translation_reports where translation_id='${savedTranslation.translationId}';`,
      ),
      reportedTranslation.reportId,
      "concurrent identical translation reports store one report",
    );
    setHideListingState("paused");
    const hideHolder = harness.startSession(`
begin;
set application_name='customer_review_hide_holder';
${actor(hideFixture.ids.administratorUserId, "aal2")}
select public.hide_customer_review('${reviewId}','First moderation reason');
select 'CUSTOMER_REVIEW_HIDE_HELD';
`);
    sessions.push(hideHolder);
    await harness.waitForMarker(hideHolder, "CUSTOMER_REVIEW_HIDE_HELD");
    const hideContender = harness.startSession(
      `begin;
set application_name='customer_review_hide_contender';
${actor(secondAdministrator, "aal2")}
select public.hide_customer_review('${reviewId}','Replacement reason');
commit;`,
      true,
    );
    sessions.push(hideContender);
    await harness.waitForLock("customer_review_hide_contender", hideContender);
    assertions += 1;
    const hiddenReviewReplyContender = harness.startSession(
      `begin;
set application_name='customer_review_hidden_review_reply_contender';
${actor(hideFixture.ids.ownerUserId)}
select public.submit_customer_review_reply('${hideFixture.ids.bookingReference}','en','Reply racing the hide');
commit;`,
      true,
    );
    sessions.push(hiddenReviewReplyContender);
    await harness.waitForLock(
      "customer_review_hidden_review_reply_contender",
      hiddenReviewReplyContender,
    );
    assertions += 1;
    setHideListingState("published");
    check(
      JSON.parse(
        harness.runSql(
          `select public.list_public_customer_reviews('${hidePublicSlug}',null,null,1);`,
        ),
      ).items?.[0]?.reviewId,
      reviewId,
      "the review is public while its hide is uncommitted",
    );
    // A new language inserts a row, so this save waits on the hidden review's foreign-key lock.
    const translationHideContender = harness.startSession(
      `begin;
set application_name='customer_review_translation_hide_contender';
${saveTranslation("ckb", "هەڵسەنگاندنێک بۆ پێداچوونەوە")}
commit;`,
      true,
    );
    sessions.push(translationHideContender);
    await harness.waitForLock(
      "customer_review_translation_hide_contender",
      translationHideContender,
    );
    assertions += 1;
    await harness.finishSession(hideHolder, { action: "commit" });
    await harness.finishSession(hideContender);
    await harness.finishSession(hiddenReviewReplyContender);
    await harness.finishSession(translationHideContender);
    setHideListingState("paused");
    const hidden = jsonResults(hideHolder)[0];
    check(hidden?.status, "hidden", "first hide wins");
    check(
      Object.keys(hidden ?? {}).sort(),
      [
        "administratorUserId",
        "affectedBookingRequestReference",
        "affectedPublicSlug",
        "hiddenAt",
        "reason",
        "reviewId",
        "status",
      ],
      "new hide returns the exact target-bearing result shape",
    );
    check(
      [hidden?.affectedPublicSlug, hidden?.affectedBookingRequestReference],
      [hidePublicSlug, hideFixture.ids.bookingReference],
      "new hide returns its stored public slug and booking reference",
    );
    const replay = jsonResults(hideContender)[0];
    check(replay?.status, "already-hidden", "contending hide is a replay");
    check(
      Object.keys(replay ?? {}).sort(),
      ["administratorUserId", "hiddenAt", "reason", "reviewId", "status"],
      "hide replay remains target-free",
    );
    check(
      replay?.administratorUserId,
      hideFixture.ids.administratorUserId,
      "hide replay retains the first administrator",
    );
    check(
      replay?.reason,
      "First moderation reason",
      "hide replay retains the first reason",
    );
    check(
      harness.runSql(
        `select count(*)::integer from public.customer_review_hides where review_id='${reviewId}';`,
      ),
      "1",
      "concurrent hiding stores one attribution",
    );
    check(
      jsonResults(hiddenReviewReplyContender)[0],
      { status: "ineligible" },
      "a reply that waited on an uncommitted review hide is refused",
    );
    check(
      harness.runSql(
        `select count(*)::integer from public.customer_review_replies where review_id='${reviewId}';`,
      ),
      "0",
      "the refused reply stores nothing",
    );
    check(
      jsonResults(translationHideContender)[0],
      { status: "not-found" },
      "a translation save that waited on an uncommitted review hide returns no translated text",
    );

    const replyHideHolder = harness.startSession(`
begin;
set application_name='customer_review_reply_hide_holder';
${actor(hideFixture.ids.administratorUserId, "aal2")}
select public.hide_customer_review_reply('${submitted.reviewId}','First reply moderation reason');
select 'CUSTOMER_REVIEW_REPLY_HIDE_HELD';
`);
    sessions.push(replyHideHolder);
    await harness.waitForMarker(
      replyHideHolder,
      "CUSTOMER_REVIEW_REPLY_HIDE_HELD",
    );
    const replyHideContender = harness.startSession(
      `begin;
set application_name='customer_review_reply_hide_contender';
${actor(secondAdministrator, "aal2")}
select public.hide_customer_review_reply('${submitted.reviewId}','Replacement reply reason');
commit;`,
      true,
    );
    sessions.push(replyHideContender);
    await harness.waitForLock(
      "customer_review_reply_hide_contender",
      replyHideContender,
    );
    assertions += 1;
    await harness.finishSession(replyHideHolder, { action: "commit" });
    await harness.finishSession(replyHideContender);
    const hiddenReply = jsonResults(replyHideHolder)[0];
    check(
      {
        status: hiddenReply?.status,
        keys: Object.keys(hiddenReply ?? {}).sort(),
      },
      {
        status: "hidden",
        keys: [
          "administratorUserId",
          "affectedBookingRequestReference",
          "affectedPublicSlug",
          "hiddenAt",
          "reason",
          "reviewId",
          "status",
        ],
      },
      "first reply hide wins",
    );
    const replyHideReplay = jsonResults(replyHideContender)[0];
    check(
      {
        status: replyHideReplay?.status,
        keys: Object.keys(replyHideReplay ?? {}).sort(),
        administratorUserId: replyHideReplay?.administratorUserId,
        reason: replyHideReplay?.reason,
      },
      {
        status: "already-hidden",
        keys: [
          "administratorUserId",
          "hiddenAt",
          "reason",
          "reviewId",
          "status",
        ],
        administratorUserId: hideFixture.ids.administratorUserId,
        reason: "First reply moderation reason",
      },
      "contending reply hide is a replay",
    );
    check(
      harness.runSql(
        `select count(*)::integer from public.customer_review_reply_hides where review_id='${submitted.reviewId}';`,
      ),
      "1",
      "concurrent reply hiding stores one attribution",
    );

    console.log(
      `Customer review concurrency verification passed (${assertions} assertions).`,
    );
  } finally {
    harness.markTimingPhase("cleanup");
    for (const session of sessions) await finish(session);
    for (const namespace of ["49", "48", "47"]) {
      harness.runSql(customerReviewCleanup(namespace));
    }
  }
  timingOutcome = "passed";
} finally {
  harness.finishTiming({ outcome: timingOutcome, cleanupDisposition: "local" });
}
