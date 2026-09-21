import assert from "node:assert/strict";

import { customerReviewFixture } from "./lib/customer-review-fixture.mjs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness();
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

function cleanup(namespace) {
  const suffix = (sequence) => namespaceSuffix(namespace, sequence);
  const request = `60000000-0000-4000-8000-${suffix(1)}`;
  const claim = `72000000-0000-4000-8000-${suffix(1)}`;
  const attempt = `70000000-0000-4000-8000-${suffix(1)}`;
  const commitment = `50000000-0000-4000-8000-${suffix(1)}`;
  const snapshot = `40000000-0000-4000-8000-${suffix(1)}`;
  const schedule = `30000000-0000-4000-8000-${suffix(1)}`;
  const profile = `20000000-0000-4000-8000-${suffix(1)}`;
  const users = [1, 2, 3, 81, 82]
    .map((sequence) => `'10000000-0000-4000-8000-${suffix(sequence)}'`)
    .join(",");
  return `
set session_replication_role=replica;
delete from public.customer_review_hides where review_id in (
  select id from public.customer_reviews where booking_request_id='${request}'
);
delete from public.customer_reviews where booking_request_id='${request}';
delete from public.booking_completion_maturity where booking_request_id='${request}';
delete from public.booking_incidents where booking_request_id='${request}';
delete from public.booking_lifecycle_outcomes where booking_request_id='${request}';
delete from public.fictional_booking_confirmation_notification_effects where booking_request_id='${request}';
delete from public.booking_confirmation_notification_attempts where receipt_id in (
  select receipt_id from public.booking_confirmation_notification_work where booking_request_id='${request}'
);
delete from public.booking_confirmation_notification_work where booking_request_id='${request}';
delete from public.booking_notification_events where booking_request_id='${request}';
delete from public.booking_request_payment_history where booking_request_id='${request}';
delete from public.simulated_payment_effects where operation_id in (
  select id from public.payment_provider_operations where claim_id='${claim}'
);
delete from public.payment_provider_observations where operation_id in (
  select id from public.payment_provider_operations where claim_id='${claim}'
);
delete from public.payment_provider_operations where claim_id='${claim}';
delete from public.booking_receipts where booking_confirmation_id in (
  select id from public.booking_confirmations where booking_request_id='${request}'
);
delete from public.booking_confirmations where booking_request_id='${request}';
delete from public.booking_request_capture_work where booking_request_id='${request}';
delete from public.booking_request_provider_operation_identities where attempt_id='${attempt}';
delete from public.booking_request_authorization_claim_items where claim_id='${claim}';
delete from public.booking_request_authorization_claim_occupancies where claim_id='${claim}';
delete from public.booking_request_authorization_claims where id='${claim}';
delete from public.booking_request_submission_attempts where id='${attempt}';
delete from public.booking_requests where id='${request}';
delete from public.cottage_booking_period_occupancies where booking_period_commitment_id='${commitment}';
delete from public.cottage_inventory_commitments where booking_period_commitment_id='${commitment}';
delete from public.cottage_booking_period_commitments where id='${commitment}';
delete from public.booking_snapshots where id='${snapshot}';
delete from public.cottage_marketplace_listings where profile_id='${profile}';
delete from public.cottage_publication_localizations where publication_id in (
  select id from public.cottage_publication_snapshots where profile_id='${profile}'
);
delete from public.cottage_publication_snapshots where profile_id='${profile}';
delete from public.cottage_profile_publication_decisions where review_cycle_id in (
  select id from public.cottage_profile_review_cycles where profile_id='${profile}'
);
delete from public.cottage_profile_localized_revisions where review_cycle_id in (
  select id from public.cottage_profile_review_cycles where profile_id='${profile}'
);
delete from public.cottage_profile_review_cycles where profile_id='${profile}';
delete from public.cottage_profile_source_revisions where profile_id='${profile}';
delete from public.cottage_shifts where schedule_revision_id='${schedule}';
delete from public.cottage_shift_schedule_revisions where id='${schedule}';
delete from public.owner_application_cottage_profiles where id='${profile}';
delete from public.account_contexts where user_id in (${users});
delete from auth.users where id in (${users});
set session_replication_role=origin;
`;
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

  const deadlineFixture = customerReviewFixture({
    namespace: "48",
    startDaySql: "((clock_timestamp() at time zone 'Asia/Baghdad')::date-16)",
    accessRangesSql: `tstzmultirange(
        tstzrange((((current_timestamp at time zone 'Asia/Baghdad')::date-16)::timestamp at time zone 'UTC')+interval '5 hours',(((current_timestamp at time zone 'Asia/Baghdad')::date-16)::timestamp at time zone 'UTC')+interval '9 hours','[)'),
        tstzrange((((current_timestamp at time zone 'Asia/Baghdad')::date-16)::timestamp at time zone 'UTC')+interval '17 hours',(((current_timestamp at time zone 'Asia/Baghdad')::date-16)::timestamp at time zone 'UTC')+interval '23 hours','[)'),
        tstzrange(current_timestamp-interval '14 days 1 minute',current_timestamp-interval '14 days'+interval '5 seconds','[)')
    )`,
    complete: true,
    publish: true,
  });
  harness.runSql(deadlineFixture.sql);
  harness.runSql(`update public.cottage_marketplace_listings
set public_slug='${reviewPublicSlug("48")}',state='paused'
where profile_id='${deadlineFixture.ids.profileId}';`);
  const deadlineHolder = harness.startSession(`
begin;
set application_name='customer_review_deadline_holder';
select id from public.booking_requests
where id='${deadlineFixture.ids.requestId}' for update;
select 'CUSTOMER_REVIEW_DEADLINE_HELD';
`);
  sessions.push(deadlineHolder);
  await harness.waitForMarker(deadlineHolder, "CUSTOMER_REVIEW_DEADLINE_HELD");
  const deadlineContender = harness.startSession(
    `begin;
set application_name='customer_review_deadline_contender';
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
  assertions += 1;
  while (
    harness.runSql(
      `select clock_timestamp()>=(select review_expires_at from public.booking_completion_maturity where booking_request_id='${deadlineFixture.ids.requestId}');`,
    ) !== "t"
  ) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  assertions += 1;
  await harness.finishSession(deadlineHolder, { action: "commit" });
  await harness.finishSession(deadlineContender);
  check(
    jsonResults(deadlineContender)[0]?.status,
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
  await harness.finishSession(hideHolder, { action: "commit" });
  await harness.finishSession(hideContender);
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

  console.log(
    `Customer review concurrency verification passed (${assertions} assertions).`,
  );
} finally {
  for (const session of sessions) await finish(session);
  for (const namespace of ["49", "48", "47"]) {
    harness.runSql(cleanup(namespace));
  }
}
