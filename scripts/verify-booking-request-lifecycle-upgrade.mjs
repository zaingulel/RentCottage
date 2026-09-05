import { spawnSync } from "node:child_process";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const deferSuccessfulRestoreMode = "--defer-successful-restore";
const requestedModes = process.argv.slice(2);
if (
  requestedModes.length > 1 ||
  (requestedModes.length === 1 &&
    requestedModes[0] !== deferSuccessfulRestoreMode)
) {
  console.error(
    `Usage: node scripts/verify-booking-request-lifecycle-upgrade.mjs [${deferSuccessfulRestoreMode}]`,
  );
  process.exit(2);
}
const deferSuccessfulRestore = requestedModes[0] === deferSuccessfulRestoreMode;

const priorMigrationVersion = "20260822090100";
const ownerId = "96000000-0000-4000-8000-000000000033";
const customerId = "96000000-0000-4000-8000-000000000034";
const profileId = "96000000-0000-4000-8000-000000000133";
const scheduleId = "96000000-0000-4000-8000-000000000233";
const firstShiftId = "96000000-0000-4000-8000-000000000333";
const secondShiftId = "96000000-0000-4000-8000-000000000334";
const bundleId = "96000000-0000-4000-8000-000000000433";
const attemptId = "96000000-0000-4000-8000-000000000533";
const claimId = "96000000-0000-4000-8000-000000000633";
const paymentLifecycleId = "96000000-0000-4000-8000-000000000733";
const idempotencyKey = "96000000-0000-4000-8000-000000000833";
const amountFils = 115_000_000;
const providerIdentity = {
  provider: "fictional-payments",
  environment: "local-test",
  merchantId: "upgrade-merchant",
  terminalId: "upgrade-terminal",
};
const harness = createLocalSupabaseConcurrencyHarness();

function runSupabase(args) {
  const workdir = process.env.SUPABASE_LOCAL_WORKDIR;
  const result = spawnSync(
    "npx",
    ["supabase", ...args, ...(workdir ? ["--workdir", workdir] : [])],
    {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw new Error("Unable to execute the local Supabase CLI.", {
      cause: result.error,
    });
  }
  return result;
}

function commandFailure(args, result) {
  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");
  return new Error(
    `Supabase ${args.join(" ")} failed with status ${result.status ?? 1}${output ? `:\n${output}` : "."}`,
  );
}

function expectSqlFailure(sql, expectedCode) {
  const result = harness.runDocker(
    harness.psqlArguments(),
    `\\set VERBOSITY verbose\n${sql}\n`,
  );
  if (result.status === 0 || !result.stderr.includes(expectedCode)) {
    throw new Error(
      `Expected ${expectedCode} from the upgraded provider query, received: ${result.stderr.trim()}`,
    );
  }
}

function authorizationSnapshot() {
  return {
    paymentLifecycleId,
    authorization: {
      paymentLifecycleId,
      kind: "authorization",
      logicalOperationId: `${paymentLifecycleId}:authorization`,
      attemptId: `${paymentLifecycleId}:authorization:attempt-1`,
      status: "pending",
      amountFils,
      providerRequestId: null,
      providerReference: null,
      movementReference: null,
      reconciliationRequired: false,
      retrySafe: false,
    },
    capture: null,
    release: null,
  };
}

function providerOperation(permit) {
  return {
    providerIdentity,
    requestFingerprint: "e".repeat(64),
    paymentLifecycleId,
    logicalOperationId: `${paymentLifecycleId}:authorization`,
    physicalAttemptId: `${paymentLifecycleId}:authorization:attempt-1`,
    operationKind: "authorization",
    amountFils,
    currency: "IQD",
    permitPurpose: permit.purpose,
    idempotencyKey: permit.idempotencyKey,
    notAfter: permit.notAfter,
    claimId: permit.claimId,
    claimGeneration: permit.generation,
    stateRevision: null,
    cleanupAttemptId: null,
    workId: null,
    leaseGeneration: null,
    leaseToken: null,
    operationId: null,
    operationGeneration: null,
  };
}

function quoteJson(value) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

const resetPriorArgs = [
  "db",
  "reset",
  "--local",
  "--version",
  priorMigrationVersion,
];
const resetCurrentArgs = ["db", "reset", "--local"];
let failure;

try {
  const resetPrior = runSupabase(resetPriorArgs);
  if (resetPrior.status !== 0) {
    throw commandFailure(resetPriorArgs, resetPrior);
  }
  harness.guardDisposableLocalDatabase();
  const installedVersion = harness.runSql(`
    select max(version) from supabase_migrations.schema_migrations;
  `);
  if (installedVersion !== priorMigrationVersion) {
    throw new Error(
      `Booking Request upgrade proof installed ${installedVersion}, expected ${priorMigrationVersion}.`,
    );
  }

  harness.runSql(`
    begin;
    insert into auth.users (id, aud, role, phone, phone_confirmed_at)
    values
      ('${ownerId}', 'authenticated', 'authenticated', '+9647500096033', now()),
      ('${customerId}', 'authenticated', 'authenticated', '+9647500096034', now());
    insert into public.account_contexts (user_id, role, owner_approval_state)
    values
      ('${ownerId}', 'cottage_owner', 'approved'),
      ('${customerId}', 'customer', null);
    insert into public.owner_application_cottage_profiles (
      id, owner_user_id, name, governorate, approximate_location,
      exact_address, capacity, bedrooms, bathrooms, amenities,
      source_language, description, house_rules, status
    ) values (
      '${profileId}', '${ownerId}', 'Upgrade fixture cottage', 'Baghdad',
      'Karrada', 'Private upgrade address', 4, 2, 1, array['garden'],
      'en', 'Upgrade fixture description', 'Upgrade fixture rules', 'draft'
    );
    insert into public.cottage_shift_schedule_revisions (
      id, profile_id, revision, full_day_bundle_id
    ) values ('${scheduleId}', '${profileId}', 1, '${bundleId}');
    select set_config(
      'rentcottage.shift_schedule_write_revision_id', '${scheduleId}', true
    );
    insert into public.cottage_shifts (
      id, schedule_revision_id, position, name, start_time, end_time
    ) values
      ('${firstShiftId}', '${scheduleId}', 1, 'Morning', '09:00', '12:00'),
      ('${secondShiftId}', '${scheduleId}', 2, 'Evening', '18:00', '22:00');
    update public.owner_application_cottage_profiles
    set current_shift_schedule_id = '${scheduleId}' where id = '${profileId}';
    insert into public.booking_request_submission_attempts (
      id, customer_user_id, idempotency_key, payment_lifecycle_id,
      profile_id, locale, public_slug, requested_search,
      quote_fingerprint, quote_payload, intent_fingerprint, intent_payload,
      payment_snapshot, authorization_provider, authorization_environment,
      authorization_merchant_id, authorization_terminal_id, state
    ) values (
      '${attemptId}', '${customerId}', '${idempotencyKey}',
      '${paymentLifecycleId}', '${profileId}', 'en', 'upgrade-fixture-cottage',
      '{}'::jsonb, repeat('a', 64), '{}'::jsonb, repeat('b', 64), '{}'::jsonb,
      ${quoteJson(authorizationSnapshot())},
      '${providerIdentity.provider}', '${providerIdentity.environment}',
      '${providerIdentity.merchantId}', '${providerIdentity.terminalId}',
      'authorizing'
    );
    insert into public.booking_request_authorization_claims (
      id, attempt_id, generation, state, customer_user_id, profile_id,
      schedule_revision_id, payment_lifecycle_id, logical_operation_id,
      physical_attempt_id, amount_fils, currency, provider, environment,
      merchant_id, terminal_id, provider_idempotency_key, quote_fingerprint,
      intent_fingerprint, access_ranges, not_after, reconciliation_expires_at
    ) values (
      '${claimId}', '${attemptId}', 1, 'starting', '${customerId}', '${profileId}',
      '${scheduleId}', '${paymentLifecycleId}',
      '${paymentLifecycleId}:authorization',
      '${paymentLifecycleId}:authorization:attempt-1', ${amountFils}, 'IQD',
      '${providerIdentity.provider}', '${providerIdentity.environment}',
      '${providerIdentity.merchantId}', '${providerIdentity.terminalId}',
      'booking-request:${claimId}:1', repeat('a', 64), repeat('b', 64),
      tstzmultirange(tstzrange(
        '2101-01-01 09:00:00+03'::timestamptz,
        '2101-01-01 12:00:00+03'::timestamptz, '[)'
      )), date_trunc('milliseconds', clock_timestamp() + interval '5 minutes'),
      date_trunc('milliseconds', clock_timestamp() + interval '4 minutes')
    );
    commit;
  `);

  const upgradeArgs = ["migration", "up", "--local"];
  const upgrade = runSupabase(upgradeArgs);
  if (upgrade.status !== 0) throw commandFailure(upgradeArgs, upgrade);

  const response = JSON.parse(
    harness.runSql(`
      begin;
      set local role service_role;
      select public.begin_booking_request_authorization_claim(
        '${attemptId}', ${quoteJson(authorizationSnapshot())},
        ${quoteJson(providerIdentity)}
      );
      commit;
    `),
  );
  if (
    response.status !== "ready" ||
    Object.keys(response.executionPermit).sort().join("|") !==
      "claimId|generation|idempotencyKey|notAfter|purpose" ||
    response.executionPermit.purpose !== "booking-request-authorization" ||
    response.executionPermit.claimId !== claimId ||
    response.executionPermit.generation !== 1 ||
    response.executionPermit.idempotencyKey !== `booking-request:${claimId}:1`
  ) {
    throw new Error(
      `Upgraded authorization claim returned an invalid permit: ${JSON.stringify(response)}`,
    );
  }

  const operation = providerOperation(response.executionPermit);
  const absent = JSON.parse(
    harness.runSql(`
      begin;
      set local role service_role;
      select public.query_simulated_payment_provider_operation(
        ${quoteJson(operation)}, null, null, 'succeeded'
      );
      commit;
    `),
  );
  if (JSON.stringify(absent) !== '{"outcome":"not-executed"}') {
    throw new Error(
      `Upgraded provider query did not prove authoritative absence: ${JSON.stringify(absent)}`,
    );
  }
  expectSqlFailure(
    `begin; set local role service_role;
     select public.query_simulated_payment_provider_operation(
       ${quoteJson(operation)}, 'missing-request', 'missing-reference', 'succeeded'
     ); commit;`,
    "RC409",
  );

  const providerResult = JSON.parse(
    harness.runSql(`
      begin;
      set local role service_role;
      select public.execute_simulated_payment_provider_operation(
        ${quoteJson(operation)}, 'succeeded'
      );
      commit;
    `),
  );
  if (
    providerResult.outcome !== "succeeded" ||
    !providerResult.providerRequestId ||
    !providerResult.providerReference ||
    !providerResult.movementReference ||
    providerResult.retrySafe !== false
  ) {
    throw new Error(
      `Upgraded authorization permit was not accepted end-to-end: ${JSON.stringify(providerResult)}`,
    );
  }
  console.log(
    "Booking Request upgrade proof applied only post-20260822090100 migrations, returned the exact five-field authorization permit, proved authoritative absence, rejected identified absence, and executed the permit end-to-end.",
  );
} catch (error) {
  failure = error;
} finally {
  if (failure || !deferSuccessfulRestore) {
    const restored = runSupabase(resetCurrentArgs);
    if (restored.status !== 0) {
      const restoreFailure = commandFailure(resetCurrentArgs, restored);
      failure = failure
        ? new AggregateError(
            [failure, restoreFailure],
            "Booking Request upgrade proof and schema restoration failed.",
          )
        : restoreFailure;
    }
  }
}

if (failure) throw failure;
