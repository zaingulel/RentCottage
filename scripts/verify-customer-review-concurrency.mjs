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
    const duplicateHolder = harness.startSession(`
begin;
set application_name='customer_review_duplicate_holder';
${actor(duplicateFixture.ids.customerUserId)}
select public.submit_customer_review(
  '${duplicateFixture.ids.bookingReference}',5,'en','First committed review'
);
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
    await harness.finishSession(duplicateHolder, { action: "commit" });
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
    await harness.finishSession(replyHolder, { action: "commit" });
    await harness.finishSession(replyContender);
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
    harness.markTimingPhase("execution");
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
    await harness.finishSession(hideHolder, { action: "commit" });
    await harness.finishSession(hideContender);
    await harness.finishSession(hiddenReviewReplyContender);
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
