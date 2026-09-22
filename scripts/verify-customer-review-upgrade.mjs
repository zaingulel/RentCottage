import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { customerReviewFixture } from "./lib/customer-review-fixture.mjs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
import { prepareIsolatedSupabaseWorkdir } from "./verify-access.mjs";

const shippedMigration = "20260914085524_issue36_messaging_complete.sql";
const reviewMigration = "20260921191404_customer_reviews.sql";
const mutationTargetMigration =
  "20260921211138_customer_review_mutation_targets.sql";
const readAccessRepairMigration =
  "20260922021110_customer_review_read_access_repair.sql";
const project = "rentcottage-review-upgrade";
const stateRoot = mkdtempSync(join(tmpdir(), "rentcottage-review-upgrade-"));
const dockerConfig = join(stateRoot, "docker");
mkdirSync(dockerConfig);
let assertions = 0;
let started = false;

function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DOCKER_CONFIG: dockerConfig,
      DO_NOT_TRACK: "1",
      SUPABASE_TELEMETRY_DISABLED: "1",
    },
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

function actor(userId, assurance = "aal1") {
  return `set local role authenticated;
set local request.jwt.claim.sub='${userId}';
set local request.jwt.claims='{"sub":"${userId}","role":"authenticated","aal":"${assurance}"}';`;
}

function reviewPublicSlug(namespace) {
  return `cottage-deadbeefdeadbeefdeadbeefdead00${namespace}`;
}

const workingDirectory = resolve(process.cwd());
const localWorkdir = prepareIsolatedSupabaseWorkdir({
  localProject: project,
  stateRoot,
  workingDirectory,
});
const localSupabase = join(localWorkdir, "supabase");
const configPath = join(localSupabase, "config.toml");
writeFileSync(
  configPath,
  readFileSync(configPath, "utf8")
    .replaceAll("5533", "5633")
    .replace("8183", "8283"),
);

const isolatedMigrations = join(localSupabase, "migrations");
unlinkSync(isolatedMigrations);
mkdirSync(isolatedMigrations);
const sourceMigrations = join(workingDirectory, "supabase", "migrations");
for (const migration of readdirSync(sourceMigrations).sort()) {
  if (migration > shippedMigration) continue;
  symlinkSync(
    join(sourceMigrations, migration),
    join(isolatedMigrations, migration),
  );
}

const environment = {
  ...process.env,
  DOCKER_CONFIG: dockerConfig,
  DO_NOT_TRACK: "1",
  SUPABASE_TELEMETRY_DISABLED: "1",
  SUPABASE_DB_CONTAINER: `supabase_db_${project}`,
  SUPABASE_LOCAL_PROJECT: project,
  SUPABASE_LOCAL_WORKDIR: localWorkdir,
};
const harness = createLocalSupabaseConcurrencyHarness({
  environment,
  workingDirectory: localWorkdir,
});
const supabaseArguments = (args) => [...args, "--workdir", localWorkdir];

const firstPublicSlug = reviewPublicSlug("57");
const firstEligible = customerReviewFixture({
  namespace: "57",
  startDaySql: "((clock_timestamp() at time zone 'Asia/Baghdad')::date-3)",
  complete: true,
  publish: true,
});
const secondEligible = customerReviewFixture({
  namespace: "58",
  startDaySql: "((clock_timestamp() at time zone 'Asia/Baghdad')::date-6)",
  complete: true,
  publish: false,
  sharedCottage: {
    namespace: "57",
    ownerUserId: firstEligible.ids.ownerUserId,
    profileId: firstEligible.ids.profileId,
    publicSlug: firstPublicSlug,
  },
});
const ineligible = customerReviewFixture({
  namespace: "59",
  startDaySql: "((clock_timestamp() at time zone 'Asia/Baghdad')::date+1)",
  confirm: true,
  complete: false,
});
const retainedIds = [
  firstEligible.ids.requestId,
  secondEligible.ids.requestId,
  ineligible.ids.requestId,
];
const retainedIdsSql = retainedIds.map((id) => `'${id}'`).join(",");
const retainedSourceDigestSql = `select md5(jsonb_build_object(
  'requests',(select jsonb_agg(to_jsonb(value) order by value.id) from public.booking_requests value where value.id in (${retainedIdsSql})),
  'confirmations',(select jsonb_agg(to_jsonb(value) order by value.id) from public.booking_confirmations value where value.booking_request_id in (${retainedIdsSql})),
  'operations',(select jsonb_agg(to_jsonb(value) order by value.id) from public.payment_provider_operations value where value.payment_lifecycle_id in (
    select requests.payment_lifecycle_id from public.booking_requests requests where requests.id in (${retainedIdsSql})
  )),
  'outcomes',(select jsonb_agg(to_jsonb(value) order by value.id) from public.booking_lifecycle_outcomes value where value.booking_request_id in (${retainedIdsSql})),
  'maturity',(select jsonb_agg(to_jsonb(value) order by value.booking_request_id) from public.booking_completion_maturity value where value.booking_request_id in (${retainedIdsSql})),
  'listings',(select jsonb_agg(to_jsonb(value) order by value.profile_id) from public.cottage_marketplace_listings value where value.profile_id in ('${firstEligible.ids.profileId}','${secondEligible.ids.profileId}'))
)::text);`;

try {
  run(
    "npx",
    supabaseArguments([
      "supabase",
      "start",
      "-x",
      "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
    ]),
  );
  harness.guardDisposableLocalDatabase();
  started = true;

  check(
    harness.runSql(
      "select max(version) from supabase_migrations.schema_migrations;",
    ),
    shippedMigration.slice(0, 14),
    "upgrade database starts at the shipped migration cutoff",
  );
  check(
    harness.runSql("select to_regclass('public.customer_reviews') is null;"),
    "t",
    "review storage is absent before the upgrade",
  );
  check(
    [
      secondEligible.ids.ownerUserId,
      secondEligible.ids.profileId,
      secondEligible.publicSlug,
    ],
    [
      firstEligible.ids.ownerUserId,
      firstEligible.ids.profileId,
      firstPublicSlug,
    ],
    "the helper returns the actual shared cottage identity",
  );
  assert.throws(
    () =>
      customerReviewFixture({
        namespace: "60",
        startDaySql:
          "((clock_timestamp() at time zone 'Asia/Baghdad')::date-3)",
        confirm: false,
        complete: true,
      }),
    /Completion requires confirmation/,
    "the helper rejects completion without confirmation",
  );
  assertions += 1;

  harness.runSql(firstEligible.sql);
  harness.runSql(secondEligible.sql);
  harness.runSql(ineligible.sql);
  harness.runSql(`update public.cottage_marketplace_listings
set public_slug='${firstPublicSlug}'
where profile_id='${firstEligible.ids.profileId}';`);
  check(
    harness.runSql(`select count(*)::integer from public.booking_requests
      where id in (${retainedIdsSql});`),
    "3",
    "retained booking sources exist before the upgrade",
  );
  check(
    harness.runSql(`select count(*)::integer from public.booking_requests requests
      where requests.id in ('${firstEligible.ids.requestId}','${secondEligible.ids.requestId}')
        and public.booking_request_payment_status(requests)='paid-confirmed'
        and public.booking_completion_eligibility_at(requests.id,clock_timestamp())->>'status'='completed';`),
    "2",
    "eligible retained sources are authoritatively paid and completed",
  );
  check(
    harness.runSql(`select count(*)::integer from public.booking_requests requests
      where requests.id='${ineligible.ids.requestId}'
        and public.booking_request_payment_status(requests)='paid-confirmed'
        and exists(
          select 1 from public.booking_confirmations confirmations
          where confirmations.booking_request_id=requests.id
        )
        and not exists(
          select 1 from public.booking_completion_maturity maturity
          where maturity.booking_request_id=requests.id
        );`),
    "1",
    "the future ineligible source is confirmed but not completed",
  );
  const retainedBefore = harness.runSql(retainedSourceDigestSql);

  harness.runSql(readFileSync(join(sourceMigrations, reviewMigration), "utf8"));
  check(
    harness.runSql(
      "select to_regclass('public.customer_reviews') is not null;",
    ),
    "t",
    "the generated review migration applies over the shipped chain",
  );
  check(
    harness.runSql(`select
      (select count(*)=1 from pg_constraint where conname='customer_reviews_booking_request_id_key')
      and (select count(*)=6 from pg_constraint where conname in (
        'customer_reviews_booking_request_id_fkey',
        'customer_reviews_booking_confirmation_id_fkey',
        'customer_reviews_profile_id_fkey',
        'customer_reviews_author_user_id_fkey',
        'customer_review_hides_review_id_fkey',
        'customer_review_hides_administrator_user_id_fkey'))
      and (select indexdef like '%(profile_id, submitted_at DESC, id DESC)'
        from pg_indexes where indexname='customer_reviews_profile_cursor_idx')
      and (select indexdef like '%(submitted_at DESC, id DESC)'
        from pg_indexes where indexname='customer_reviews_administrator_cursor_idx');`),
    "t",
    "the upgrade creates the declared keys and cursor indexes",
  );
  check(
    harness.runSql(retainedSourceDigestSql),
    retainedBefore,
    "the original review migration preserves retained source facts",
  );

  const submit = (fixture, rating, body) =>
    JSON.parse(
      harness.runSql(`begin;
${actor(fixture.ids.customerUserId)}
select public.submit_customer_review(
  '${fixture.ids.bookingReference}',${rating},'en',${body === null ? "null" : `'${body}'`}
);
commit;`),
    );
  const hide = (fixture, reviewId, reason) =>
    JSON.parse(
      harness.runSql(`begin;
${actor(fixture.ids.administratorUserId, "aal2")}
select public.hide_customer_review('${reviewId}','${reason}');
commit;`),
    );
  const readOwn = (fixture) =>
    JSON.parse(
      harness.runSql(`begin;
${actor(fixture.ids.customerUserId)}
select public.get_customer_review('${fixture.ids.bookingReference}');
commit;`),
    );
  const first = submit(firstEligible, 5, "First retained booking review");
  check(
    Object.keys(first).sort(),
    ["reviewId", "status", "submittedAt"],
    "the original migration publishes with its original result shape",
  );
  const firstHide = hide(firstEligible, first.reviewId, "Retained first hide");
  check(
    Object.keys(firstHide).sort(),
    ["administratorUserId", "hiddenAt", "reason", "reviewId", "status"],
    "the original migration hides with its original audit shape",
  );
  const retainedReviewAuditDigestSql = `select md5(jsonb_build_object(
    'review',(select to_jsonb(value) from public.customer_reviews value where value.id='${first.reviewId}'),
    'hide',(select to_jsonb(value) from public.customer_review_hides value where value.review_id='${first.reviewId}')
  )::text);`;
  const retainedReviewAuditBefore = harness.runSql(
    retainedReviewAuditDigestSql,
  );

  harness.runSql(
    readFileSync(join(sourceMigrations, mutationTargetMigration), "utf8"),
  );
  check(
    harness.runSql(retainedReviewAuditDigestSql),
    retainedReviewAuditBefore,
    "the forward migration preserves the original review and hide audit",
  );
  check(
    harness.runSql(retainedSourceDigestSql),
    retainedBefore,
    "both review migrations preserve retained source facts",
  );
  check(
    Object.keys(submit(firstEligible, 1, "Replay ignored")).sort(),
    ["reviewId", "status", "submittedAt"],
    "submission replay remains target-free after the forward migration",
  );
  check(
    Object.keys(
      hide(firstEligible, first.reviewId, "Replacement ignored"),
    ).sort(),
    ["administratorUserId", "hiddenAt", "reason", "reviewId", "status"],
    "hide replay remains target-free after the forward migration",
  );

  harness.runSql(
    readFileSync(join(sourceMigrations, readAccessRepairMigration), "utf8"),
  );
  check(
    harness.runSql(retainedReviewAuditDigestSql),
    retainedReviewAuditBefore,
    "the read-access repair preserves the original review and hide audit",
  );
  check(
    harness.runSql(retainedSourceDigestSql),
    retainedBefore,
    "the read-access repair preserves retained source facts",
  );
  check(
    readOwn(ineligible),
    { status: "ineligible" },
    `the ${readAccessRepairMigration} upgrade reports normal pre-completion as ineligible`,
  );

  const second = submit(secondEligible, 4, null);
  check(
    Object.keys(second).sort(),
    ["affectedPublicSlug", "reviewId", "status", "submittedAt"],
    "a new submission has the exact target-bearing shape",
  );
  check(
    second.affectedPublicSlug,
    firstPublicSlug,
    "a new submission resolves its deliberately non-derived stored slug",
  );
  check(
    submit(ineligible, 3, "Unfinished booking review").status,
    "ineligible",
    "the retained unfinished booking is denied",
  );

  check(
    Date.parse(second.submittedAt) > Date.parse(first.submittedAt),
    true,
    "the ordinary cursor fixture retains its genuine submission order",
  );
  const firstPage = JSON.parse(
    harness.runSql(`begin;
${actor(firstEligible.ids.administratorUserId, "aal2")}
select public.list_administrator_customer_reviews(null,null,1);
commit;`),
  );
  const cursor = firstPage.nextCursor;
  const secondPage = JSON.parse(
    harness.runSql(`begin;
${actor(firstEligible.ids.administratorUserId, "aal2")}
select public.list_administrator_customer_reviews(
  '${cursor.submittedAt}'::timestamptz,'${cursor.reviewId}'::uuid,1
);
commit;`),
  );
  check(
    [firstPage.items[0].reviewId, secondPage.items[0].reviewId],
    [second.reviewId, first.reviewId],
    "ordinary administrator cursor pages follow genuine submission timestamps without skips",
  );
  check(
    [firstPage.nextCursor?.reviewId, secondPage.nextCursor],
    [second.reviewId, null],
    "ordinary administrator cursor traversal ends after the second retained review",
  );

  check(
    JSON.parse(
      harness.runSql(`set role anon;
select public.list_public_customer_reviews(
  '${firstPublicSlug}',null,null,20
);
reset role;`),
    ).items.map((item) => Object.keys(item).sort()),
    [["originalBody", "originalLanguage", "rating", "reviewId", "submittedAt"]],
    "anonymous publication exposes only the public review projection",
  );
  const secondHide = hide(
    secondEligible,
    second.reviewId,
    "New target-bearing hide",
  );
  check(
    Object.keys(secondHide).sort(),
    [
      "administratorUserId",
      "affectedBookingRequestReference",
      "affectedPublicSlug",
      "hiddenAt",
      "reason",
      "reviewId",
      "status",
    ],
    "a new hide has the exact target-bearing shape",
  );
  check(
    [secondHide.affectedPublicSlug, secondHide.affectedBookingRequestReference],
    [firstPublicSlug, secondEligible.ids.bookingReference],
    "a new hide resolves its stored listing and booking reference",
  );
  check(
    Object.keys(
      hide(secondEligible, second.reviewId, "Replacement target ignored"),
    ).sort(),
    ["administratorUserId", "hiddenAt", "reason", "reviewId", "status"],
    "new hide replay remains target-free",
  );
  check(
    harness.runSql(retainedReviewAuditDigestSql),
    retainedReviewAuditBefore,
    "all upgrade assertions preserve the original review and hide audit",
  );
  check(
    harness.runSql(retainedSourceDigestSql),
    retainedBefore,
    "the upgrade and review commands preserve original payment and lifecycle data",
  );

  console.log(
    `Customer review upgrade verification passed (${assertions} assertions).`,
  );
} finally {
  if (started) {
    harness.guardDisposableLocalDatabase();
    run(
      "npx",
      supabaseArguments([
        "supabase",
        "stop",
        "--no-backup",
        "--project-id",
        project,
      ]),
    );
    rmSync(stateRoot, { recursive: true, force: true });
  } else {
    console.error(`Retained upgrade verifier state at ${stateRoot}.`);
  }
}
