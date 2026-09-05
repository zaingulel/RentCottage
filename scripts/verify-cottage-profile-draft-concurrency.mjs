import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const migrationPreflightMode = "--verify-migration-preflight";
const deferSuccessfulRestoreMode = "--defer-successful-restore";
const requestedModes = process.argv.slice(2);
if (
  requestedModes.length > 2 ||
  (requestedModes.length > 0 && requestedModes[0] !== migrationPreflightMode) ||
  (requestedModes.length === 2 &&
    requestedModes[1] !== deferSuccessfulRestoreMode)
) {
  console.error(
    `Usage: node scripts/verify-cottage-profile-draft-concurrency.mjs [${migrationPreflightMode} [${deferSuccessfulRestoreMode}]]`,
  );
  process.exit(2);
}
const deferSuccessfulRestore = requestedModes[1] === deferSuccessfulRestoreMode;

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
      `Expected ${expectedCode} from migration preflight, received: ${result.stderr.trim()}`,
    );
  }
}

function verifyMigrationPreflight() {
  const priorMigrationVersion = "20260820180000";
  const ownerId = "97000000-0000-4000-8000-000000000087";
  const administratorId = "97000000-0000-4000-8000-000000000088";
  const preservedProfileId = "97000000-0000-4000-8000-000000000187";
  const releasedProfileId = "97000000-0000-4000-8000-000000000188";
  const scheduleId = "97000000-0000-4000-8000-000000000287";
  const photoId = "97000000-0000-4000-8000-000000000387";
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
    if (resetPrior.status !== 0)
      throw commandFailure(resetPriorArgs, resetPrior);
    harness.guardDisposableLocalDatabase();
    harness.runSql(`
      begin;
      insert into auth.users (id, aud, role, phone, phone_confirmed_at, email, email_confirmed_at)
      values
        ('${ownerId}', 'authenticated', 'authenticated', '+9647500097087', now(), null, null),
        ('${administratorId}', 'authenticated', 'authenticated', null, null, 'migration-admin@example.test', now());
      insert into public.account_contexts (user_id, role, owner_approval_state)
      values
        ('${ownerId}', 'cottage_owner', 'approved'),
        ('${administratorId}', 'platform_administrator', null);
      insert into public.owner_application_cottage_profiles (
        id, owner_user_id, name, governorate, approximate_location,
        exact_address, exact_latitude, exact_longitude, private_directions,
        capacity, bedrooms, bathrooms, amenities, source_language,
        description, house_rules, status, created_at
      )
      select
        case when position = 1 then '${preservedProfileId}'::uuid
          when position = 2 then '${releasedProfileId}'::uuid
          else ('97000000-0000-4000-8000-' || lpad((100000000000 + position)::text, 12, '0'))::uuid end,
        '${ownerId}',
        case when position = 1 then 'Preserved private cottage' else 'Legacy open cottage ' || position end,
        case when position = 1 then 'Erbil' end,
        case when position = 1 then 'Shaqlawa' end,
        case when position = 1 then 'Private orchard gate' end,
        case when position = 1 then 36.4 end,
        case when position = 1 then 44.3 end,
        case when position = 1 then 'Turn after the old bridge' end,
        case when position = 1 then 6 end,
        case when position = 1 then 3 end,
        case when position = 1 then 2 end,
        case when position = 1 then array['garden', 'wifi']::text[] else '{}'::text[] end,
        case when position = 1 then 'en'::public.cottage_profile_source_language end,
        case when position = 1 then 'Preserved description' end,
        case when position = 1 then 'Preserved rules' end,
        'draft', now() - interval '2 days'
      from generate_series(1, 21) position;
      insert into public.cottage_shift_schedule_revisions (
        id, profile_id, revision, full_day_bundle_id
      ) values (
        '${scheduleId}', '${preservedProfileId}', 1,
        '97000000-0000-4000-8000-000000000487'
      );
      select set_config('rentcottage.shift_schedule_write_revision_id', '${scheduleId}', true);
      insert into public.cottage_shifts (
        schedule_revision_id, position, name, start_time, end_time
      ) values
        ('${scheduleId}', 1, 'Morning', '08:00', '12:00'),
        ('${scheduleId}', 2, 'Evening', '18:00', '22:00');
      update public.owner_application_cottage_profiles
      set current_shift_schedule_id = '${scheduleId}'
      where id = '${preservedProfileId}';
      insert into public.cottage_profile_photos (
        id, profile_id, owner_user_id, actor_user_id, object_path,
        original_filename, media_type, size_bytes, state
      ) values (
        '${photoId}', '${preservedProfileId}', '${ownerId}', '${ownerId}',
        '${ownerId}/${preservedProfileId}/preserved.webp',
        'preserved.webp', 'image/webp', 128, 'ready'
      );
      commit;
    `);

    const upgradeArgs = ["migration", "up", "--local"];
    const upgrade = runSupabase(upgradeArgs);
    if (upgrade.status !== 0) throw commandFailure(upgradeArgs, upgrade);
    const preserved = harness.runSql(`
      select
        (select count(*) from public.owner_application_cottage_profiles where owner_user_id = '${ownerId}'),
        (select name || '|' || exact_address || '|' || private_directions || '|' || description || '|' || house_rules
          from public.owner_application_cottage_profiles where id = '${preservedProfileId}'),
        (select count(*) from public.cottage_profile_photos where id = '${photoId}' and state = 'ready'),
        (select count(*) from public.cottage_shifts where schedule_revision_id = '${scheduleId}');
    `);
    if (
      preserved !==
      "21|Preserved private cottage|Private orchard gate|Turn after the old bridge|Preserved description|Preserved rules|1|2"
    ) {
      throw new Error(
        `Cottage Profile migration preflight changed legacy state: ${preserved}`,
      );
    }

    const ownerClaims = `select set_config('request.jwt.claims', '{"sub":"${ownerId}","role":"authenticated","aal":"aal1"}', true);`;
    const administratorClaims = `select set_config('request.jwt.claims', '{"sub":"${administratorId}","role":"authenticated","aal":"aal2"}', true);`;
    expectSqlFailure(
      `begin; set local role authenticated; ${ownerClaims} select public.create_owner_cottage_profile_draft(); commit;`,
      "RC420",
    );
    harness.runSql(`begin; set local role authenticated; ${ownerClaims}
      select public.abandon_owner_cottage_profile_draft('${preservedProfileId}', 1); commit;`);
    expectSqlFailure(
      `begin; set local role authenticated; ${administratorClaims}
       select public.restore_administrator_cottage_profile_draft('${preservedProfileId}', 2, 'Migration preservation proof'); commit;`,
      "RC420",
    );
    harness.runSql(`begin; set local role authenticated; ${ownerClaims}
      select public.abandon_owner_cottage_profile_draft('${releasedProfileId}', 1); commit;`);
    harness.runSql(`begin; set local role authenticated; ${administratorClaims}
      select public.restore_administrator_cottage_profile_draft('${preservedProfileId}', 2, 'Migration preservation proof'); commit;`);
    const restored = harness.runSql(`
      select count(*),
        bool_and(name = 'Preserved private cottage' and exact_address = 'Private orchard gate'
          and private_directions = 'Turn after the old bridge' and description = 'Preserved description'
          and house_rules = 'Preserved rules' and status = 'draft' and abandoned_at is null),
        (select count(*) from public.cottage_profile_photos where id = '${photoId}' and state = 'ready'),
        (select count(*) from public.cottage_shifts where schedule_revision_id = '${scheduleId}')
      from public.owner_application_cottage_profiles where id = '${preservedProfileId}';
    `);
    if (restored !== "1|t|1|2") {
      throw new Error(
        `Restored Cottage Profile lost private state: ${restored}`,
      );
    }
    console.log(
      "Cottage Profile migration preflight preserved 21 legacy rows and private content, blocked create/restore at capacity, and restored after release.",
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
              "Cottage Profile migration preflight and schema restoration failed.",
            )
          : restoreFailure;
      }
    }
  }
  if (failure) throw failure;
}

if (requestedModes[0] === migrationPreflightMode) {
  verifyMigrationPreflight();
  process.exit(0);
}

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !publishableKey) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required.");
}
const password = "Local-test-password-2026";
async function resolveFixtureUser(credentials) {
  const client = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword(credentials);
  if (error || !data.user) {
    throw new Error("Cottage Profile concurrency identity is unavailable.", {
      cause: error,
    });
  }
  return data.user.id;
}

harness.guardDisposableLocalDatabase();

const [ownerUserId, administratorUserId] = await Promise.all([
  resolveFixtureUser({ phone: "+9647510000000", password }),
  resolveFixtureUser({
    email: "cottage-profile-fixture-reviewer@rentcottage.test",
    password,
  }),
]);

const claims = (userId, assurance) =>
  `select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated","aal":"${assurance}"}', true);`;
const ownerSession = (applicationName, body) => `
  begin;
  select set_config('application_name', '${applicationName}', false);
  set local role authenticated;
  ${claims(ownerUserId, "aal1")}
  ${body}
`;
const administratorSession = (applicationName, body) => `
  begin;
  select set_config('application_name', '${applicationName}', false);
  set local role authenticated;
  ${claims(administratorUserId, "aal2")}
  ${body}
`;
const clearAdditionalProfiles = () =>
  harness.runSql(`
    delete from public.owner_application_cottage_profiles
    where owner_user_id = '${ownerUserId}' and application_id is null;
  `);
const seedAdditionalProfiles = (count, status, age) =>
  harness.runSql(`
    insert into public.owner_application_cottage_profiles (
      owner_user_id, status, created_at, abandoned_at
    )
    select '${ownerUserId}', '${status}', now() - interval '${age}',
      case when '${status}' = 'abandoned' then now() else null end
    from generate_series(1, ${count});
  `);

async function proveCreateRace({
  name,
  seedCount,
  seedStatus,
  seedAge,
  expectedCode,
}) {
  clearAdditionalProfiles();
  seedAdditionalProfiles(seedCount, seedStatus, seedAge);
  const first = harness.startSession(
    ownerSession(
      `${name}-winner`,
      `
      select public.create_owner_cottage_profile_draft();
      select '${name}-locked';
    `,
    ),
  );
  await harness.waitForMarker(first, `${name}-locked`);
  const contenderName = `${name}-contender`;
  const contender = harness.startSession(
    ownerSession(
      contenderName,
      `
      select public.create_owner_cottage_profile_draft();
      commit;
    `,
    ),
    true,
  );
  await harness.waitForLock(contenderName, contender);
  await harness.finishSession(first, { action: "commit" });
  await harness.finishSession(contender, { expectedState: expectedCode });
  console.log(
    `${name}: observed PostgreSQL Lock wait and ${expectedCode} refusal.`,
  );
}

await proveCreateRace({
  name: "open-cap-create-vs-create",
  seedCount: 18,
  seedStatus: "draft",
  seedAge: "2 days",
  expectedCode: "RC420",
});

await proveCreateRace({
  name: "rate-only-create-vs-create",
  seedCount: 19,
  seedStatus: "abandoned",
  seedAge: "1 hour",
  expectedCode: "RC429",
});

clearAdditionalProfiles();
seedAdditionalProfiles(18, "draft", "2 days");
const abandonedProfileId = harness.runSql(`
  insert into public.owner_application_cottage_profiles (
    owner_user_id, status, created_at, abandoned_at
  ) values ('${ownerUserId}', 'abandoned', now() - interval '2 days', now())
  returning id;
`);
const creator = harness.startSession(
  ownerSession(
    "create-vs-admin-restore-winner",
    `
    select public.create_owner_cottage_profile_draft();
    select 'create-vs-admin-restore-locked';
  `,
  ),
);
await harness.waitForMarker(creator, "create-vs-admin-restore-locked");
const restoreName = "create-vs-admin-restore-contender";
const restorer = harness.startSession(
  administratorSession(
    restoreName,
    `
    select public.restore_administrator_cottage_profile_draft(
      '${abandonedProfileId}', 1, 'Concurrency capacity proof'
    );
    commit;
  `,
  ),
  true,
);
await harness.waitForLock(restoreName, restorer);
await harness.finishSession(creator, { action: "commit" });
await harness.finishSession(restorer, { expectedState: "RC420" });
console.log(
  "create-vs-admin-restore: observed PostgreSQL Lock wait and RC420 refusal.",
);
clearAdditionalProfiles();
