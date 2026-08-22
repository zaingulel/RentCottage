import { spawnSync } from "node:child_process";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const ownerId = "98000000-0000-4000-8000-000000000031";
const customerA = "98000000-0000-4000-8000-000000000032";
const customerB = "98000000-0000-4000-8000-000000000033";
const profileA = "98000000-0000-4000-8000-000000000131";
const profileB = "98000000-0000-4000-8000-000000000132";
const scheduleA = "98000000-0000-4000-8000-000000000231";
const scheduleB = "98000000-0000-4000-8000-000000000232";
const shiftA1 = "98000000-0000-4000-8000-000000000331";
const shiftA2 = "98000000-0000-4000-8000-000000000332";
const shiftB1 = "98000000-0000-4000-8000-000000000333";
const shiftB2 = "98000000-0000-4000-8000-000000000334";
const bundleA = "98000000-0000-4000-8000-000000000431";
const bundleB = "98000000-0000-4000-8000-000000000432";
const day = "2099-08-20";
const priorMigrationVersion = "20260820160000";
const migrationPreflightMode = "--verify-migration-preflight";

function fail(message, cause) {
  throw new Error(message, cause ? { cause } : undefined);
}

const {
  finishSession: finishHarnessSession,
  guardDisposableLocalDatabase,
  psqlArguments,
  runDocker,
  runSql,
  startSession,
  waitForLock,
  waitForMarker,
} = createLocalSupabaseConcurrencyHarness({
  messages: {
    invalidGuard:
      "The Booking Period concurrency test requires guarded local Supabase.",
    unavailable: "The local Supabase container is unavailable.",
    wrongOwner:
      "The Supabase container does not belong to this disposable checkout.",
    sessionExitedBeforeMarker: (marker, stderr) =>
      `Session exited before ${marker}: ${stderr}`,
    markerTimeout: (marker) => `PostgreSQL session did not reach ${marker}.`,
    contenderExitedBeforeLock: (_applicationName, stderr) =>
      `Contender exited before waiting: ${stderr}`,
    lockTimeout: () =>
      "The concurrent contender never reached a PostgreSQL lock.",
    expectedStateFailure: (expectedState, stderr) =>
      `Expected ${expectedState}, received: ${stderr}`,
    unexpectedSessionFailure: (stderr) =>
      `Transaction unexpectedly failed: ${stderr}`,
  },
});

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
  if (result.error)
    fail("Unable to execute the local Supabase CLI.", result.error);
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

function verifyMigrationPreflight() {
  const legacyOwner = "99000000-0000-4000-8000-000000000031";
  const legacyProfile = "99000000-0000-4000-8000-000000000131";
  const legacySchedule = "99000000-0000-4000-8000-000000000231";
  const legacyShiftA = "99000000-0000-4000-8000-000000000331";
  const legacyShiftB = "99000000-0000-4000-8000-000000000332";
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
    guardDisposableLocalDatabase();

    runSql(`
      begin;
      insert into auth.users (id, aud, role, phone, phone_confirmed_at)
      values ('${legacyOwner}', 'authenticated', 'authenticated', '+9647500099131', now());
      insert into public.account_contexts (user_id, role, owner_approval_state)
      values ('${legacyOwner}', 'cottage_owner', 'approved');
      insert into public.owner_application_cottage_profiles (
        id, owner_user_id, name, governorate, approximate_location, exact_address,
        capacity, bedrooms, bathrooms, amenities, source_language, description,
        house_rules, status
      ) values (
        '${legacyProfile}', '${legacyOwner}', 'Legacy migration guard', 'Baghdad',
        'Karrada', 'Private address', 4, 2, 1, array['garden'], 'en',
        'Description', 'Rules', 'draft'
      );
      insert into public.cottage_shift_schedule_revisions (
        id, profile_id, revision, full_day_bundle_id
      ) values (
        '${legacySchedule}', '${legacyProfile}', 1,
        '99000000-0000-4000-8000-000000000431'
      );
      select set_config(
        'rentcottage.shift_schedule_write_revision_id', '${legacySchedule}', true
      );
      insert into public.cottage_shifts (
        id, schedule_revision_id, position, name, start_time, end_time
      ) values
        ('${legacyShiftA}', '${legacySchedule}', 1, 'Morning', '08:00', '12:00'),
        ('${legacyShiftB}', '${legacySchedule}', 2, 'Evening', '12:00', '22:00');
      alter table public.cottage_inventory_commitments
        disable trigger lock_cottage_inventory_commitment_profile;
      insert into public.cottage_inventory_commitments (
        schedule_revision_id, unit_kind, unit_id, service_day,
        commitment_reference, committed_price_iqd, status
      ) values (
        '${legacySchedule}', 'shift', '${legacyShiftA}', '${day}',
        'RC-I31-LEGACY-PREFLIGHT', 100000, 'pending_hold'
      );
      commit;
    `);

    const upgradeArgs = ["migration", "up", "--local"];
    const upgrade = runSupabase(upgradeArgs);
    const upgradeOutput = `${upgrade.stdout ?? ""}\n${upgrade.stderr ?? ""}`;
    if (upgrade.status === 0) {
      fail(
        "The legacy-row migration preflight unexpectedly allowed the upgrade.",
      );
    }
    if (!/At statement:\s*0\b/.test(upgradeOutput)) {
      throw commandFailure(upgradeArgs, upgrade);
    }
    const preservedState = runSql(`
      select
        not exists (
          select 1 from pg_catalog.pg_extension where extname = 'btree_gist'
        ),
        to_regclass('public.cottage_booking_period_commitments') is null,
        (select count(*) from public.cottage_inventory_commitments);
    `);
    if (preservedState !== "t|t|1") {
      fail(
        `Migration preflight changed schema or legacy data before failing: ${preservedState}`,
      );
    }
    console.log(
      "Booking Period migration preflight failed at statement 0 with extension absent, parent table absent, and the legacy row preserved.",
    );
  } catch (error) {
    failure = error;
  } finally {
    const restored = runSupabase(resetCurrentArgs);
    if (restored.status !== 0) {
      const restoreFailure = commandFailure(resetCurrentArgs, restored);
      failure = failure
        ? new AggregateError(
            [failure, restoreFailure],
            "Migration preflight verification and schema restoration failed.",
          )
        : restoreFailure;
    } else {
      try {
        guardDisposableLocalDatabase();
        const restoredState = runSql(`
          select
            exists (
              select 1 from pg_catalog.pg_extension where extname = 'btree_gist'
            ),
            to_regclass('public.cottage_booking_period_commitments') is not null,
            (select count(*) from public.cottage_inventory_commitments);
        `);
        if (restoredState !== "t|t|0") {
          fail(`Current schema restoration was incomplete: ${restoredState}`);
        }
      } catch (restoreError) {
        failure = failure
          ? new AggregateError(
              [failure, restoreError],
              "Migration preflight verification failed and restored-state validation failed.",
            )
          : restoreError;
      }
    }
  }

  if (failure) throw failure;
}

async function finishSession(session, action, expectedState) {
  return finishHarnessSession(session, { action, expectedState });
}

function holdSql(
  applicationName,
  marker,
  customer,
  profile,
  reference,
  kind,
  position,
) {
  const selection =
    kind === "full-day"
      ? `{"serviceDay":"${day}","kind":"full-day"}`
      : `{"serviceDay":"${day}","kind":"shift","position":${position}}`;
  return `
    set application_name = '${applicationName}';
    begin;
    set local role service_role;
    select public.create_pending_booking_period_hold(
      '${customer}', '${profile}', '${reference}',
      '{"from":"${day}","to":"${day}","guests":1,"selections":[${selection}]}'::jsonb
    );
    select '${marker}';
  `;
}

function expectMutationDetected(name, sql) {
  const marker = `RC_MUTATION_DETECTED_${name}`;
  const result = runDocker(
    psqlArguments(),
    `\\set VERBOSITY verbose\nbegin;\n${sql}\n`,
  );
  if (result.status === 0 || !result.stderr.includes(marker)) {
    fail(`The ${name} mutation was not detected: ${result.stderr.trim()}`);
  }
}

function cleanupInjectedOccupancyFailure() {
  runSql(`
    drop trigger if exists test_fail_later_booking_period_occupancy
      on public.cottage_booking_period_occupancies;
    drop function if exists public.test_fail_later_booking_period_occupancy();
  `);
}

const cleanupSql = `
  begin;
  delete from public.cottage_booking_period_commitments
    where profile_id in ('${profileA}', '${profileB}');
  delete from public.cottage_inventory_availability
    where schedule_revision_id in ('${scheduleA}', '${scheduleB}');
  delete from public.cottage_inventory_standard_prices
    where schedule_revision_id in ('${scheduleA}', '${scheduleB}');
  update public.owner_application_cottage_profiles
    set current_publication_id = null, current_shift_schedule_id = null
    where id in ('${profileA}', '${profileB}');
  alter table public.cottage_shifts disable trigger reject_cottage_shift_delete;
  delete from public.cottage_shifts
    where schedule_revision_id in ('${scheduleA}', '${scheduleB}');
  alter table public.cottage_shifts enable trigger reject_cottage_shift_delete;
  alter table public.cottage_shift_schedule_revisions
    disable trigger reject_cottage_shift_schedule_revision_delete;
  delete from public.cottage_shift_schedule_revisions
    where id in ('${scheduleA}', '${scheduleB}');
  alter table public.cottage_shift_schedule_revisions
    enable trigger reject_cottage_shift_schedule_revision_delete;
  alter table public.cottage_publication_snapshots
    disable trigger reject_cottage_publication_snapshots_delete;
  delete from public.cottage_publication_snapshots
    where profile_id in ('${profileA}', '${profileB}');
  alter table public.cottage_publication_snapshots
    enable trigger reject_cottage_publication_snapshots_delete;
  alter table public.cottage_profile_review_cycles
    disable trigger reject_cottage_profile_review_cycles_delete;
  delete from public.cottage_profile_review_cycles
    where profile_id in ('${profileA}', '${profileB}');
  alter table public.cottage_profile_review_cycles
    enable trigger reject_cottage_profile_review_cycles_delete;
  alter table public.cottage_profile_source_revisions
    disable trigger reject_cottage_profile_source_delete;
  delete from public.cottage_profile_source_revisions
    where profile_id in ('${profileA}', '${profileB}');
  alter table public.cottage_profile_source_revisions
    enable trigger reject_cottage_profile_source_delete;
  delete from public.owner_application_cottage_profiles
    where id in ('${profileA}', '${profileB}');
  delete from public.account_contexts
    where user_id in ('${ownerId}', '${customerA}', '${customerB}');
  delete from auth.users where id in ('${ownerId}', '${customerA}', '${customerB}');
  commit;
`;

const setupSql = `
  begin;
  insert into auth.users (id, aud, role, phone, phone_confirmed_at) values
    ('${ownerId}', 'authenticated', 'authenticated', '+9647500099031', now()),
    ('${customerA}', 'authenticated', 'authenticated', '+9647500099032', now()),
    ('${customerB}', 'authenticated', 'authenticated', '+9647500099033', now());
  insert into public.account_contexts (user_id, role, owner_approval_state) values
    ('${ownerId}', 'cottage_owner', 'approved'),
    ('${customerA}', 'customer', null),
    ('${customerB}', 'customer', null);
  insert into public.owner_application_cottage_profiles (
    id, owner_user_id, name, governorate, approximate_location, exact_address,
    capacity, bedrooms, bathrooms, amenities, source_language, description,
    house_rules, status
  ) values
    ('${profileA}', '${ownerId}', 'Concurrency A', 'Baghdad', 'Area A', 'Private A',
      4, 2, 1, array['garden'], 'en', 'Description', 'Rules', 'draft'),
    ('${profileB}', '${ownerId}', 'Concurrency B', 'Baghdad', 'Area B', 'Private B',
      4, 2, 1, array['garden'], 'en', 'Description', 'Rules', 'draft');
  insert into public.cottage_profile_source_revisions (
    id, profile_id, owner_user_id, source_language, description, house_rules, revision
  ) values
    ('98000000-0000-4000-8000-000000000531', '${profileA}', '${ownerId}', 'en', 'Description', 'Rules', 1),
    ('98000000-0000-4000-8000-000000000532', '${profileB}', '${ownerId}', 'en', 'Description', 'Rules', 1);
  insert into public.cottage_profile_review_cycles (
    id, profile_id, owner_user_id, source_revision_id, name, governorate,
    approximate_location, capacity, bedrooms, bathrooms, amenities,
    cycle_number, state, decided_at
  ) values
    ('98000000-0000-4000-8000-000000000631', '${profileA}', '${ownerId}',
      '98000000-0000-4000-8000-000000000531', 'Concurrency A', 'Baghdad', 'Area A',
      4, 2, 1, array['garden'], 1, 'approved', now()),
    ('98000000-0000-4000-8000-000000000632', '${profileB}', '${ownerId}',
      '98000000-0000-4000-8000-000000000532', 'Concurrency B', 'Baghdad', 'Area B',
      4, 2, 1, array['garden'], 1, 'approved', now());
  insert into public.cottage_publication_snapshots (
    id, profile_id, review_cycle_id, publication_number, name, governorate,
    approximate_location, capacity, bedrooms, bathrooms, amenities
  ) values
    ('98000000-0000-4000-8000-000000000731', '${profileA}',
      '98000000-0000-4000-8000-000000000631', 1, 'Concurrency A', 'Baghdad', 'Area A',
      4, 2, 1, array['garden']),
    ('98000000-0000-4000-8000-000000000732', '${profileB}',
      '98000000-0000-4000-8000-000000000632', 1, 'Concurrency B', 'Baghdad', 'Area B',
      4, 2, 1, array['garden']);
  insert into public.cottage_shift_schedule_revisions (id, profile_id, revision, full_day_bundle_id)
  values ('${scheduleA}', '${profileA}', 1, '${bundleA}'),
    ('${scheduleB}', '${profileB}', 1, '${bundleB}');
  select set_config('rentcottage.shift_schedule_write_revision_id', '${scheduleA}', true);
  insert into public.cottage_shifts (id, schedule_revision_id, position, name, start_time, end_time)
  values ('${shiftA1}', '${scheduleA}', 1, 'Morning', '08:00', '12:00'),
    ('${shiftA2}', '${scheduleA}', 2, 'Evening', '12:00', '22:00');
  select set_config('rentcottage.shift_schedule_write_revision_id', '${scheduleB}', true);
  insert into public.cottage_shifts (id, schedule_revision_id, position, name, start_time, end_time)
  values ('${shiftB1}', '${scheduleB}', 1, 'Overlap', '10:00', '14:00'),
    ('${shiftB2}', '${scheduleB}', 2, 'Evening', '15:00', '19:00');
  select set_config('rentcottage.shift_schedule_write_revision_id', '', true);
  update public.owner_application_cottage_profiles
    set current_shift_schedule_id = case id when '${profileA}' then '${scheduleA}'::uuid else '${scheduleB}'::uuid end,
      current_publication_id = case id
        when '${profileA}' then '98000000-0000-4000-8000-000000000731'::uuid
        else '98000000-0000-4000-8000-000000000732'::uuid end
    where id in ('${profileA}', '${profileB}');
  insert into public.cottage_inventory_standard_prices (
    schedule_revision_id, unit_kind, unit_id, price_iqd
  ) values
    ('${scheduleA}', 'shift', '${shiftA1}', 100000),
    ('${scheduleA}', 'shift', '${shiftA2}', 110000),
    ('${scheduleA}', 'full_day_bundle', '${bundleA}', 180000),
    ('${scheduleB}', 'shift', '${shiftB1}', 90000),
    ('${scheduleB}', 'shift', '${shiftB2}', 95000),
    ('${scheduleB}', 'full_day_bundle', '${bundleB}', 170000);
  insert into public.cottage_inventory_availability (
    schedule_revision_id, unit_kind, unit_id, service_day, state
  ) select schedule_revision_id, unit_kind, unit_id, '${day}', 'open'
    from public.cottage_inventory_standard_prices
    where schedule_revision_id in ('${scheduleA}', '${scheduleB}');
  commit;
`;

function terminateSessions() {
  runSql(`
    select pg_terminate_backend(pid) from pg_catalog.pg_stat_activity
    where application_name like 'rc_i31_%' and pid <> pg_backend_pid();
  `);
}

const requestedModes = process.argv.slice(2);
if (
  requestedModes.length > 1 ||
  (requestedModes.length === 1 && requestedModes[0] !== migrationPreflightMode)
) {
  fail(
    `Usage: node scripts/verify-booking-period-hold-concurrency.mjs [${migrationPreflightMode}]`,
  );
}

guardDisposableLocalDatabase();
if (requestedModes[0] === migrationPreflightMode) {
  verifyMigrationPreflight();
} else {
  let failure;
  try {
    cleanupInjectedOccupancyFailure();
    runSql(cleanupSql);
    runSql(setupSql);

    const sameCottageWinner = startSession(
      holdSql(
        "rc_i31_same_winner",
        "SAME_WINNER",
        customerA,
        profileA,
        "RC-I31-SAME-WINNER",
        "shift",
        1,
      ),
    );
    await waitForMarker(sameCottageWinner, "SAME_WINNER");
    const sameCottageLoserName = "rc_i31_same_loser";
    const sameCottageLoser = startSession(
      `${holdSql(sameCottageLoserName, "SAME_LOSER", customerB, profileA, "RC-I31-SAME-LOSER", "full-day")}commit;`,
      true,
    );
    await waitForLock(sameCottageLoserName, sameCottageLoser);
    await finishSession(sameCottageWinner, "commit");
    await finishSession(sameCottageLoser, "commit", "RC409");
    runSql(
      `delete from public.cottage_booking_period_commitments where profile_id = '${profileA}';`,
    );

    const customerWinner = startSession(
      holdSql(
        "rc_i31_customer_winner",
        "CUSTOMER_WINNER",
        customerA,
        profileA,
        "RC-I31-CUSTOMER-WINNER",
        "shift",
        1,
      ),
    );
    await waitForMarker(customerWinner, "CUSTOMER_WINNER");
    const customerLoserName = "rc_i31_customer_loser";
    const customerLoser = startSession(
      `${holdSql(customerLoserName, "CUSTOMER_LOSER", customerA, profileB, "RC-I31-CUSTOMER-LOSER", "shift", 1)}commit;`,
      true,
    );
    await waitForLock(customerLoserName, customerLoser);
    await finishSession(customerWinner, "commit");
    await finishSession(customerLoser, "commit", "RC409");
    runSql(`delete from public.cottage_booking_period_commitments;`);

    const rolledBack = startSession(
      holdSql(
        "rc_i31_rollback_owner",
        "ROLLBACK_OWNER",
        customerA,
        profileA,
        "RC-I31-ROLLBACK",
        "shift",
        1,
      ),
    );
    await waitForMarker(rolledBack, "ROLLBACK_OWNER");
    const releasedName = "rc_i31_rollback_contender";
    const released = startSession(
      `${holdSql(releasedName, "ROLLBACK_CONTENDER", customerB, profileA, "RC-I31-AFTER-ROLLBACK", "full-day")}commit;`,
      true,
    );
    await waitForLock(releasedName, released);
    await finishSession(rolledBack, "rollback");
    await finishSession(released, "commit");
    if (
      runSql(
        `select count(*) from public.cottage_booking_period_commitments where commitment_reference = 'RC-I31-AFTER-ROLLBACK';`,
      ) !== "1"
    ) {
      fail("Rollback did not release the Booking Period constraints.");
    }
    runSql(`delete from public.cottage_booking_period_commitments;`);

    try {
      runSql(`
      create function public.test_fail_later_booking_period_occupancy()
      returns trigger language plpgsql set search_path = '' as $$
      declare seen integer := coalesce(nullif(current_setting('rentcottage.test_occupancy_count', true), '')::integer, 0) + 1;
      begin
        perform set_config('rentcottage.test_occupancy_count', seen::text, true);
        if seen = 2 then raise exception 'Injected later component failure' using errcode = 'RCX31'; end if;
        return new;
      end;
      $$;
      create trigger test_fail_later_booking_period_occupancy
        before insert on public.cottage_booking_period_occupancies
        for each row execute function public.test_fail_later_booking_period_occupancy();
    `);
      runSql(`
      do $$
      begin
        perform set_config('rentcottage.test_occupancy_count', '0', true);
        begin
          perform public.create_pending_booking_period_hold(
            '${customerA}', '${profileA}', 'RC-I31-ATOMIC-FAIL',
            '{"from":"${day}","to":"${day}","guests":1,"selections":[{"serviceDay":"${day}","kind":"full-day"}]}'::jsonb
          );
          raise exception 'Injected component failure did not fire';
        exception when sqlstate 'RCX31' then null;
        end;
        if exists (select 1 from public.cottage_booking_period_commitments where commitment_reference = 'RC-I31-ATOMIC-FAIL') then
          raise exception 'A later component failure left partial Booking Period rows';
        end if;
      end;
      $$;
    `);
    } finally {
      cleanupInjectedOccupancyFailure();
    }

    runSql(`
    set local role service_role;
    select public.create_pending_booking_period_hold(
      '${customerA}', '${profileA}', 'RC-I31-MUTATION-BUNDLE',
      '{"from":"${day}","to":"${day}","guests":1,"selections":[{"serviceDay":"${day}","kind":"full-day"}]}'::jsonb
    );
  `);
    expectMutationDetected(
      "COMPONENT_EXPANSION",
      `
    delete from public.cottage_booking_period_occupancies
    where booking_period_commitment_id = (
      select id from public.cottage_booking_period_commitments
      where commitment_reference = 'RC-I31-MUTATION-BUNDLE'
    ) and shift_id = '${shiftA2}';
    do $$ begin
      if (select count(*) from public.cottage_booking_period_occupancies occupancies
          join public.cottage_booking_period_commitments periods on periods.id = occupancies.booking_period_commitment_id
          where periods.commitment_reference = 'RC-I31-MUTATION-BUNDLE') <> 2 then
        raise exception 'RC_MUTATION_DETECTED_COMPONENT_EXPANSION';
      end if;
    end $$;
  `,
    );
    runSql(
      `update public.cottage_booking_period_commitments set status = 'confirmed_booking' where commitment_reference = 'RC-I31-MUTATION-BUNDLE';`,
    );
    expectMutationDetected(
      "CONFIRMED_BLOCKING",
      `
    delete from public.cottage_booking_period_occupancies
    where shift_id = '${shiftA1}' and booking_period_commitment_id = (
      select id from public.cottage_booking_period_commitments
      where commitment_reference = 'RC-I31-MUTATION-BUNDLE'
    );
    do $$ begin
      if public.public_cottage_unit_is_available('${scheduleA}', 'shift', '${shiftA1}', '${day}') then
        raise exception 'RC_MUTATION_DETECTED_CONFIRMED_BLOCKING';
      end if;
    end $$;
  `,
    );
    expectMutationDetected(
      "RANGE_CONSTRUCTION",
      `
    alter table public.cottage_booking_period_commitments disable trigger enforce_cottage_booking_period_commitment_transition;
    update public.cottage_booking_period_commitments
      set access_ranges = '{["2099-08-20 06:00:00+00","2099-08-20 07:00:00+00")}'::tstzmultirange
      where commitment_reference = 'RC-I31-MUTATION-BUNDLE';
    do $$ begin
      if (select access_ranges from public.cottage_booking_period_commitments
          where commitment_reference = 'RC-I31-MUTATION-BUNDLE')
          <> '{["2099-08-20 05:00:00+00","2099-08-20 19:00:00+00")}'::tstzmultirange then
        raise exception 'RC_MUTATION_DETECTED_RANGE_CONSTRUCTION';
      end if;
    end $$;
  `,
    );
    runSql(`delete from public.cottage_booking_period_commitments;`);
    runSql(`
    set local role service_role;
    select public.create_pending_booking_period_hold(
      '${customerA}', '${profileA}', 'RC-I31-MUTATION-CUSTOMER-A',
      '{"from":"${day}","to":"${day}","guests":1,"selections":[{"serviceDay":"${day}","kind":"shift","position":1}]}'::jsonb
    );
    update public.cottage_booking_period_commitments
      set status = 'confirmed_booking'
      where commitment_reference = 'RC-I31-MUTATION-CUSTOMER-A';
  `);
    expectMutationDetected(
      "CONFIRMED_CUSTOMER_EXCLUSION",
      `
    alter table public.cottage_booking_period_commitments
      drop constraint cottage_booking_period_customer_access_excl;
    alter table public.cottage_booking_period_commitments
      add constraint cottage_booking_period_customer_access_excl exclude using gist (
        customer_user_id with =,
        access_ranges with &&
      ) where (status = 'pending_hold'::public.cottage_inventory_commitment_status);
    set local role service_role;
    select public.create_pending_booking_period_hold(
      '${customerA}', '${profileB}', 'RC-I31-MUTATION-CUSTOMER-B',
      '{"from":"${day}","to":"${day}","guests":1,"selections":[{"serviceDay":"${day}","kind":"shift","position":1}]}'::jsonb
    );
    reset role;
    do $$ begin
      if (select count(*) from public.cottage_booking_period_commitments where customer_user_id = '${customerA}') > 1 then
        raise exception 'RC_MUTATION_DETECTED_CONFIRMED_CUSTOMER_EXCLUSION';
      end if;
    end $$;
  `,
    );

    console.log(
      "Booking Period concurrency passed same-cottage, cross-cottage Customer, rollback, atomic failure, confirmed-customer predicate, and mutation checks.",
    );
  } catch (error) {
    failure = error;
  } finally {
    try {
      terminateSessions();
      cleanupInjectedOccupancyFailure();
      runSql(cleanupSql);
    } catch (cleanupError) {
      if (!failure) failure = cleanupError;
      else console.error(cleanupError);
    }
  }
  if (failure) throw failure;
}
