import { createClient } from "@supabase/supabase-js";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness({
  timing: {
    check: "verify-cottage-profile-draft-concurrency",
    isolation: "serial",
  },
});
let timingOutcome = "failed";
try {
  harness.markTimingPhase("setup");
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
    harness.markTimingPhase("setup");
    clearAdditionalProfiles();
    seedAdditionalProfiles(seedCount, seedStatus, seedAge);
    harness.markTimingPhase("execution");
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

  harness.markTimingPhase("setup");
  clearAdditionalProfiles();
  seedAdditionalProfiles(18, "draft", "2 days");
  const abandonedProfileId = harness.runSql(`
  insert into public.owner_application_cottage_profiles (
    owner_user_id, status, created_at, abandoned_at
  ) values ('${ownerUserId}', 'abandoned', now() - interval '2 days', now())
  returning id;
`);
  harness.markTimingPhase("execution");
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
  harness.markTimingPhase("cleanup");
  clearAdditionalProfiles();
  timingOutcome = "passed";
} finally {
  harness.finishTiming({ outcome: timingOutcome, cleanupDisposition: "local" });
}
