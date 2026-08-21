import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const ownerUserId = "99000000-0000-4000-8000-000000000027";
const customerUserId = "99000000-0000-4000-8000-000000000028";
const profileId = "99000000-0000-4000-8000-000000000127";
const revisionId = "99000000-0000-4000-8000-000000000227";
const firstShiftId = "99000000-0000-4000-8000-000000000327";
const secondShiftId = "99000000-0000-4000-8000-000000000328";
const bundleId = "99000000-0000-4000-8000-000000000427";
const sourceRevisionId = "99000000-0000-4000-8000-000000000527";
const reviewCycleId = "99000000-0000-4000-8000-000000000627";
const publicationId = "99000000-0000-4000-8000-000000000727";
const serviceDay = "2099-08-20";

function fail(message, cause) {
  throw new Error(message, cause ? { cause } : undefined);
}

const {
  finishSession,
  guardDisposableLocalDatabase,
  runSql,
  startSession,
  waitForLock: waitForDatabaseLock,
  waitForMarker,
} = createLocalSupabaseConcurrencyHarness({
  messages: {
    invalidGuard:
      "The Cottage Inventory concurrency test requires the guarded local Supabase database.",
    unavailable:
      "The guarded local Supabase database container is unavailable.",
    wrongOwner:
      "The Supabase database container does not belong to this disposable local checkout.",
    sessionExitedBeforeMarker: (marker, stderr) =>
      `PostgreSQL session exited before ${marker}: ${stderr}`,
    markerTimeout: (marker) => `PostgreSQL session did not reach ${marker}.`,
    contenderExitedBeforeLock: (_applicationName, stderr) =>
      `The contender did not wait on the shared lock: ${stderr}`,
    lockTimeout: () =>
      "The contender never reached the shared Cottage Profile lock.",
  },
});

async function releaseSuccessfulSession(session) {
  return finishSession(session, {
    action: "commit",
    unexpectedSessionFailure: (stderr) =>
      `The lock-owning transaction failed: ${stderr}`,
  });
}

async function expectSqlState(session, sqlState) {
  return finishSession(session, {
    expectedState: sqlState,
    expectedStateFailure: (expectedState, stderr) =>
      `The losing transaction did not fail with ${expectedState}: ${stderr}`,
  });
}

async function expectSuccessfulSession(session) {
  return finishSession(session);
}

function terminateTestSessions() {
  runSql(`
    select pg_terminate_backend(pid)
    from pg_catalog.pg_stat_activity
    where application_name like 'rc_i27_%'
      and pid <> pg_backend_pid();
  `);
}

const cleanupSql = `
  begin;
  delete from public.cottage_booking_period_commitments
    where profile_id = '${profileId}';
  delete from public.cottage_inventory_availability
    where schedule_revision_id in (
      select id from public.cottage_shift_schedule_revisions where profile_id = '${profileId}'
    );
  delete from public.cottage_inventory_date_price_overrides
    where schedule_revision_id in (
      select id from public.cottage_shift_schedule_revisions where profile_id = '${profileId}'
    );
  delete from public.cottage_inventory_weekday_price_overrides
    where schedule_revision_id in (
      select id from public.cottage_shift_schedule_revisions where profile_id = '${profileId}'
    );
  delete from public.cottage_inventory_standard_prices
    where schedule_revision_id in (
      select id from public.cottage_shift_schedule_revisions where profile_id = '${profileId}'
    );
  update public.owner_application_cottage_profiles
    set current_shift_schedule_id = null, current_publication_id = null
    where id = '${profileId}';
  alter table public.cottage_shifts disable trigger reject_cottage_shift_delete;
  delete from public.cottage_shifts where schedule_revision_id in (
    select id from public.cottage_shift_schedule_revisions where profile_id = '${profileId}'
  );
  alter table public.cottage_shifts enable trigger reject_cottage_shift_delete;
  alter table public.cottage_shift_schedule_revisions
    disable trigger reject_cottage_shift_schedule_revision_delete;
  delete from public.cottage_shift_schedule_revisions where profile_id = '${profileId}';
  alter table public.cottage_shift_schedule_revisions
    enable trigger reject_cottage_shift_schedule_revision_delete;
  alter table public.cottage_publication_snapshots
    disable trigger reject_cottage_publication_snapshots_delete;
  delete from public.cottage_publication_snapshots where profile_id = '${profileId}';
  alter table public.cottage_publication_snapshots
    enable trigger reject_cottage_publication_snapshots_delete;
  alter table public.cottage_profile_review_cycles
    disable trigger reject_cottage_profile_review_cycles_delete;
  delete from public.cottage_profile_review_cycles where profile_id = '${profileId}';
  alter table public.cottage_profile_review_cycles
    enable trigger reject_cottage_profile_review_cycles_delete;
  alter table public.cottage_profile_source_revisions
    disable trigger reject_cottage_profile_source_delete;
  delete from public.cottage_profile_source_revisions where profile_id = '${profileId}';
  alter table public.cottage_profile_source_revisions
    enable trigger reject_cottage_profile_source_delete;
  delete from public.owner_application_cottage_profiles where id = '${profileId}';
  delete from public.account_contexts where user_id = '${ownerUserId}';
  delete from public.account_contexts where user_id = '${customerUserId}';
  delete from auth.users where id = '${ownerUserId}';
  delete from auth.users where id = '${customerUserId}';
  commit;
`;

const setupSql = `
  begin;
  insert into auth.users (id, aud, role, phone, phone_confirmed_at)
  values
    ('${ownerUserId}', 'authenticated', 'authenticated', '+9647500099027', now()),
    ('${customerUserId}', 'authenticated', 'authenticated', '+9647500099028', now());
  insert into public.account_contexts (user_id, role, owner_approval_state)
  values
    ('${ownerUserId}', 'cottage_owner', 'approved'),
    ('${customerUserId}', 'customer', null);
  insert into public.owner_application_cottage_profiles (
    id, owner_user_id, name, governorate, approximate_location, exact_address,
    capacity, bedrooms, bathrooms, amenities, source_language, description,
    house_rules, status
  ) values (
    '${profileId}', '${ownerUserId}', 'Concurrency Cottage', 'Erbil',
    'Local test area', 'Local test address', 4, 2, 1, array['garden'],
    'en', 'Concurrency regression fixture.', 'Local test only.', 'draft'
  );
  insert into public.cottage_profile_source_revisions (
    id, profile_id, owner_user_id, source_language, description, house_rules, revision
  ) values (
    '${sourceRevisionId}', '${profileId}', '${ownerUserId}', 'en',
    'Concurrency regression fixture.', 'Local test only.', 1
  );
  insert into public.cottage_profile_review_cycles (
    id, profile_id, owner_user_id, source_revision_id, name, governorate,
    approximate_location, capacity, bedrooms, bathrooms, amenities,
    cycle_number, state, decided_at
  ) values (
    '${reviewCycleId}', '${profileId}', '${ownerUserId}', '${sourceRevisionId}',
    'Concurrency Cottage', 'Erbil', 'Local test area', 4, 2, 1,
    array['garden'], 1, 'approved', now()
  );
  insert into public.cottage_publication_snapshots (
    id, profile_id, review_cycle_id, publication_number, name, governorate,
    approximate_location, capacity, bedrooms, bathrooms, amenities
  ) values (
    '${publicationId}', '${profileId}', '${reviewCycleId}', 1,
    'Concurrency Cottage', 'Erbil', 'Local test area', 4, 2, 1, array['garden']
  );
  insert into public.cottage_shift_schedule_revisions (
    id, profile_id, revision, full_day_bundle_id
  ) values ('${revisionId}', '${profileId}', 1, '${bundleId}');
  select set_config('rentcottage.shift_schedule_write_revision_id', '${revisionId}', true);
  insert into public.cottage_shifts (
    id, schedule_revision_id, position, name, start_time, end_time
  ) values
    ('${firstShiftId}', '${revisionId}', 1, 'Morning', '08:00', '12:00'),
    ('${secondShiftId}', '${revisionId}', 2, 'Evening', '18:00', '22:00');
  select set_config('rentcottage.shift_schedule_write_revision_id', '', true);
  update public.owner_application_cottage_profiles
    set current_shift_schedule_id = '${revisionId}', current_publication_id = '${publicationId}'
    where id = '${profileId}';
  insert into public.cottage_inventory_standard_prices (
    schedule_revision_id, unit_kind, unit_id, price_iqd
  ) values
    ('${revisionId}', 'shift', '${firstShiftId}', 175000),
    ('${revisionId}', 'shift', '${secondShiftId}', 125000),
    ('${revisionId}', 'full_day_bundle', '${bundleId}', 275000);
  insert into public.cottage_inventory_availability (
    schedule_revision_id, unit_kind, unit_id, service_day, state
  ) values ('${revisionId}', 'shift', '${firstShiftId}', '${serviceDay}', 'open');
  commit;
`;

const ownerClaims = JSON.stringify({
  sub: ownerUserId,
  role: "authenticated",
  aal: "aal1",
});

function ownerMutation(applicationName, marker) {
  return `
    set application_name = '${applicationName}';
    begin;
    set local role authenticated;
    select set_config('request.jwt.claims', '${ownerClaims}', true);
    select public.set_cottage_inventory_availability(
      '${profileId}', '${revisionId}', '${serviceDay}',
      '[{"unitId":"${firstShiftId}","unitKind":"shift","state":"private_blocked"}]'::jsonb
    );
    select '${marker}';
  `;
}

function priceMutation(applicationName, marker, markBefore = false) {
  return `
    set application_name = '${applicationName}';
    begin;
    ${markBefore ? `select '${marker}';` : ""}
    set local role authenticated;
    select set_config('request.jwt.claims', '${ownerClaims}', true);
    select public.save_cottage_inventory_pricing(
      '${profileId}', '${revisionId}',
      '{"units":[
        {"unitId":"${firstShiftId}","unitKind":"shift","standardPriceIqd":175000,
          "dateOverrides":[{"serviceDay":"${serviceDay}","priceIqd":185000}]},
        {"unitId":"${secondShiftId}","unitKind":"shift","standardPriceIqd":125000},
        {"unitId":"${bundleId}","unitKind":"full_day_bundle","standardPriceIqd":275000}
      ]}'::jsonb
    );
    ${markBefore ? "" : `select '${marker}';`}
  `;
}

function scheduleMutation(applicationName, marker, markBefore = false) {
  return `
    set application_name = '${applicationName}';
    begin;
    ${markBefore ? `select '${marker}';` : ""}
    set local role authenticated;
    select set_config('request.jwt.claims', '${ownerClaims}', true);
    select public.replace_cottage_shift_schedule(
      '${profileId}', 1,
      '[
        {"name":"Replacement Morning","startTime":"07:00","endTime":"11:00"},
        {"name":"Replacement Evening","startTime":"17:00","endTime":"21:00"}
      ]'::jsonb
    );
    ${markBefore ? "" : `select '${marker}';`}
  `;
}

function unpublishMutation(applicationName, marker, markBefore = false) {
  return `
    set application_name = '${applicationName}';
    begin;
    ${markBefore ? `select '${marker}';` : ""}
    update public.owner_application_cottage_profiles
      set current_publication_id = null
      where id = '${profileId}';
    ${markBefore ? "" : `select '${marker}';`}
  `;
}

function commitmentMutation(
  applicationName,
  marker,
  reference,
  holdLock = false,
) {
  const insert = `
    set local role service_role;
    select public.create_pending_booking_period_hold(
      '${customerUserId}', '${profileId}', '${reference}',
      '{"from":"${serviceDay}","to":"${serviceDay}","guests":1,"selections":[{"serviceDay":"${serviceDay}","kind":"shift","position":1}]}'::jsonb
    );
  `;
  return `
    set application_name = '${applicationName}';
    begin;
    ${holdLock ? insert : `select '${marker}';${insert}commit;`}
    ${holdLock ? `select '${marker}';` : ""}
  `;
}

async function verifyOwnerFirst() {
  const owner = startSession(
    ownerMutation("rc_i27_owner_first_owner", "OWNER_FIRST_LOCKED"),
  );
  await waitForMarker(owner, "OWNER_FIRST_LOCKED");
  const contenderName = "rc_i27_owner_first_commitment";
  const commitment = startSession(
    commitmentMutation(
      contenderName,
      "OWNER_FIRST_CONTENDER",
      "RC-OWNER-FIRST-27",
    ),
    true,
  );
  await waitForMarker(commitment, "OWNER_FIRST_CONTENDER");
  await waitForDatabaseLock(contenderName, commitment);
  await releaseSuccessfulSession(owner);
  await expectSqlState(commitment, "RC409");
  runSql(`
    do $$
    begin
      if not exists (
        select 1 from public.cottage_inventory_availability
        where schedule_revision_id = '${revisionId}'
          and unit_kind = 'shift' and unit_id = '${firstShiftId}'
          and service_day = '${serviceDay}' and state = 'private_blocked'
      ) or exists (
        select 1 from public.cottage_booking_period_commitments
        where schedule_revision_id = '${revisionId}'
      ) then
        raise exception 'Owner-first persisted outcome is invalid';
      end if;
    end
    $$;
  `);
}

async function verifyCommitmentFirst() {
  runSql(`
    update public.cottage_inventory_availability set state = 'open'
    where schedule_revision_id = '${revisionId}'
      and unit_kind = 'shift' and unit_id = '${firstShiftId}'
      and service_day = '${serviceDay}';
  `);
  const commitment = startSession(
    commitmentMutation(
      "rc_i27_commitment_first_commitment",
      "COMMITMENT_FIRST_LOCKED",
      "RC-COMMITMENT-FIRST-27",
      true,
    ),
  );
  await waitForMarker(commitment, "COMMITMENT_FIRST_LOCKED");
  const contenderName = "rc_i27_commitment_first_owner";
  const owner = startSession(
    `
      set application_name = '${contenderName}';
      begin;
      select 'COMMITMENT_FIRST_CONTENDER';
      set local role authenticated;
      select set_config('request.jwt.claims', '${ownerClaims}', true);
      select public.set_cottage_inventory_availability(
        '${profileId}', '${revisionId}', '${serviceDay}',
        '[{"unitId":"${firstShiftId}","unitKind":"shift","state":"private_blocked"}]'::jsonb
      );
      commit;
    `,
    true,
  );
  await waitForMarker(owner, "COMMITMENT_FIRST_CONTENDER");
  await waitForDatabaseLock(contenderName, owner);
  await releaseSuccessfulSession(commitment);
  await expectSqlState(owner, "RC204");
  runSql(`
    do $$
    begin
      if not exists (
        select 1 from public.cottage_inventory_availability
        where schedule_revision_id = '${revisionId}'
          and unit_kind = 'shift' and unit_id = '${firstShiftId}'
          and service_day = '${serviceDay}' and state = 'open'
      ) or not exists (
        select 1 from public.cottage_booking_period_commitments
        where schedule_revision_id = '${revisionId}'
          and commitment_reference = 'RC-COMMITMENT-FIRST-27'
      ) then
        raise exception 'Commitment-first persisted outcome is invalid';
      end if;
    end
    $$;
  `);
}

async function verifyPriceOwnerFirst() {
  const owner = startSession(
    priceMutation("rc_i27_price_owner_first", "PRICE_OWNER_FIRST_LOCKED"),
  );
  await waitForMarker(owner, "PRICE_OWNER_FIRST_LOCKED");
  const contenderName = "rc_i27_price_owner_first_commitment";
  const commitment = startSession(
    commitmentMutation(
      contenderName,
      "PRICE_OWNER_FIRST_CONTENDER",
      "RC-PRICE-OWNER-FIRST-27",
    ),
    true,
  );
  await waitForMarker(commitment, "PRICE_OWNER_FIRST_CONTENDER");
  await waitForDatabaseLock(contenderName, commitment);
  await releaseSuccessfulSession(owner);
  await expectSuccessfulSession(commitment);
  runSql(`
    do $$
    begin
      if not exists (
        select 1 from public.cottage_inventory_date_price_overrides
        where schedule_revision_id = '${revisionId}'
          and unit_kind = 'shift' and unit_id = '${firstShiftId}'
          and service_day = '${serviceDay}' and price_iqd = 185000
      ) or not exists (
        select 1
        from public.cottage_inventory_commitments selected
        join public.cottage_booking_period_commitments periods
          on periods.id = selected.booking_period_commitment_id
        where periods.schedule_revision_id = '${revisionId}'
          and selected.service_day = '${serviceDay}'
          and periods.commitment_reference = 'RC-PRICE-OWNER-FIRST-27'
          and selected.committed_price_iqd = 185000
      ) then
        raise exception 'Price owner-first persisted outcome is invalid';
      end if;
    end
    $$;
  `);
  runSql(`
    delete from public.cottage_booking_period_commitments
    where commitment_reference = 'RC-PRICE-OWNER-FIRST-27';
  `);
}

async function verifyPriceCommitmentFirst() {
  runSql(`
    delete from public.cottage_inventory_date_price_overrides
    where schedule_revision_id = '${revisionId}'
      and unit_kind = 'shift' and unit_id = '${firstShiftId}'
      and service_day = '${serviceDay}';
  `);
  const commitment = startSession(
    commitmentMutation(
      "rc_i27_price_commitment_first",
      "PRICE_COMMITMENT_FIRST_LOCKED",
      "RC-PRICE-COMMITMENT-FIRST-27",
      true,
    ),
  );
  await waitForMarker(commitment, "PRICE_COMMITMENT_FIRST_LOCKED");
  const contenderName = "rc_i27_price_commitment_first_owner";
  const owner = startSession(
    `${priceMutation(contenderName, "PRICE_COMMITMENT_FIRST_CONTENDER", true)}commit;`,
    true,
  );
  await waitForMarker(owner, "PRICE_COMMITMENT_FIRST_CONTENDER");
  await waitForDatabaseLock(contenderName, owner);
  await releaseSuccessfulSession(commitment);
  await expectSqlState(owner, "RC204");
  runSql(`
    do $$
    begin
      if exists (
        select 1 from public.cottage_inventory_date_price_overrides
        where schedule_revision_id = '${revisionId}'
          and unit_kind = 'shift' and unit_id = '${firstShiftId}'
          and service_day = '${serviceDay}'
      ) or not exists (
        select 1
        from public.cottage_inventory_commitments selected
        join public.cottage_booking_period_commitments periods
          on periods.id = selected.booking_period_commitment_id
        where periods.schedule_revision_id = '${revisionId}'
          and selected.unit_kind = 'shift' and selected.unit_id = '${firstShiftId}'
          and selected.service_day = '${serviceDay}'
          and periods.commitment_reference = 'RC-PRICE-COMMITMENT-FIRST-27'
          and selected.committed_price_iqd = 175000
      ) then
        raise exception 'Price commitment-first persisted outcome is invalid';
      end if;
    end
    $$;
  `);
}

async function verifyScheduleOwnerFirst() {
  const owner = startSession(
    scheduleMutation(
      "rc_i27_schedule_owner_first",
      "SCHEDULE_OWNER_FIRST_LOCKED",
    ),
  );
  await waitForMarker(owner, "SCHEDULE_OWNER_FIRST_LOCKED");
  const contenderName = "rc_i27_schedule_owner_first_commitment";
  const commitment = startSession(
    commitmentMutation(
      contenderName,
      "SCHEDULE_OWNER_FIRST_CONTENDER",
      "RC-SCHEDULE-OWNER-FIRST-27",
    ),
    true,
  );
  await waitForMarker(commitment, "SCHEDULE_OWNER_FIRST_CONTENDER");
  await waitForDatabaseLock(contenderName, commitment);
  await releaseSuccessfulSession(owner);
  await expectSqlState(commitment, "RC409");
  runSql(`
    do $$
    begin
      if (select current_shift_schedule_id = '${revisionId}'
          from public.owner_application_cottage_profiles where id = '${profileId}')
        or (select count(*) from public.cottage_shift_schedule_revisions
          where profile_id = '${profileId}') <> 2
        or exists (
          select 1 from public.cottage_booking_period_commitments
          where schedule_revision_id = '${revisionId}'
        ) then
        raise exception 'Schedule owner-first persisted outcome is invalid';
      end if;
    end
    $$;
  `);
}

async function verifyScheduleCommitmentFirst() {
  const commitment = startSession(
    commitmentMutation(
      "rc_i27_schedule_commitment_first",
      "SCHEDULE_COMMITMENT_FIRST_LOCKED",
      "RC-SCHEDULE-COMMITMENT-FIRST-27",
      true,
    ),
  );
  await waitForMarker(commitment, "SCHEDULE_COMMITMENT_FIRST_LOCKED");
  const contenderName = "rc_i27_schedule_commitment_first_owner";
  const owner = startSession(
    `${scheduleMutation(contenderName, "SCHEDULE_COMMITMENT_FIRST_CONTENDER", true)}commit;`,
    true,
  );
  await waitForMarker(owner, "SCHEDULE_COMMITMENT_FIRST_CONTENDER");
  await waitForDatabaseLock(contenderName, owner);
  await releaseSuccessfulSession(commitment);
  await expectSqlState(owner, "RC204");
  runSql(`
    do $$
    begin
      if not (select current_shift_schedule_id = '${revisionId}'
          from public.owner_application_cottage_profiles where id = '${profileId}')
        or (select count(*) from public.cottage_shift_schedule_revisions
          where profile_id = '${profileId}') <> 1
        or not exists (
          select 1 from public.cottage_inventory_commitments selected
          join public.cottage_booking_period_commitments periods
            on periods.id = selected.booking_period_commitment_id
          where periods.schedule_revision_id = '${revisionId}'
            and selected.service_day = '${serviceDay}'
            and periods.commitment_reference = 'RC-SCHEDULE-COMMITMENT-FIRST-27'
            and selected.committed_price_iqd = 175000
        ) then
        raise exception 'Schedule commitment-first persisted outcome is invalid';
      end if;
    end
    $$;
  `);
}

async function verifyUnpublishFirst() {
  const unpublish = startSession(
    unpublishMutation("rc_i27_unpublish_first", "UNPUBLISH_FIRST_LOCKED"),
  );
  await waitForMarker(unpublish, "UNPUBLISH_FIRST_LOCKED");
  const contenderName = "rc_i27_unpublish_first_commitment";
  const commitment = startSession(
    commitmentMutation(
      contenderName,
      "UNPUBLISH_FIRST_CONTENDER",
      "RC-UNPUBLISH-FIRST-27",
    ),
    true,
  );
  await waitForMarker(commitment, "UNPUBLISH_FIRST_CONTENDER");
  await waitForDatabaseLock(contenderName, commitment);
  await releaseSuccessfulSession(unpublish);
  await expectSqlState(commitment, "RC409");
  runSql(`
    do $$
    begin
      if (select current_publication_id is not null
          from public.owner_application_cottage_profiles where id = '${profileId}')
        or exists (
          select 1 from public.cottage_booking_period_commitments
          where schedule_revision_id = '${revisionId}'
        ) then
        raise exception 'Unpublish-first persisted outcome is invalid';
      end if;
    end
    $$;
  `);
}

async function verifyCommitmentBeforeUnpublish() {
  const commitment = startSession(
    commitmentMutation(
      "rc_i27_commitment_before_unpublish",
      "COMMITMENT_BEFORE_UNPUBLISH_LOCKED",
      "RC-COMMITMENT-BEFORE-UNPUBLISH-27",
      true,
    ),
  );
  await waitForMarker(commitment, "COMMITMENT_BEFORE_UNPUBLISH_LOCKED");
  const contenderName = "rc_i27_commitment_before_unpublish_owner";
  const unpublish = startSession(
    `${unpublishMutation(contenderName, "COMMITMENT_BEFORE_UNPUBLISH_CONTENDER", true)}commit;`,
    true,
  );
  await waitForMarker(unpublish, "COMMITMENT_BEFORE_UNPUBLISH_CONTENDER");
  await waitForDatabaseLock(contenderName, unpublish);
  await releaseSuccessfulSession(commitment);
  const result = await unpublish.exited;
  if (result.code !== 0) {
    fail(
      `The permitted privileged unpublish failed: ${unpublish.stderr.trim()}`,
    );
  }
  runSql(`
    do $$
    begin
      if (select current_publication_id is not null
          from public.owner_application_cottage_profiles where id = '${profileId}')
        or not exists (
          select 1 from public.cottage_inventory_commitments selected
          join public.cottage_booking_period_commitments periods
            on periods.id = selected.booking_period_commitment_id
          where periods.schedule_revision_id = '${revisionId}'
            and selected.service_day = '${serviceDay}'
            and periods.commitment_reference = 'RC-COMMITMENT-BEFORE-UNPUBLISH-27'
            and selected.committed_price_iqd = 175000
        ) then
        raise exception 'Commitment-before-unpublish persisted outcome is invalid';
      end if;
    end
    $$;
  `);
}

guardDisposableLocalDatabase();
let failure;
try {
  runSql(cleanupSql);
  runSql(setupSql);
  await verifyOwnerFirst();
  await verifyCommitmentFirst();
  runSql(cleanupSql);
  runSql(setupSql);
  await verifyPriceOwnerFirst();
  await verifyPriceCommitmentFirst();
  runSql(cleanupSql);
  runSql(setupSql);
  await verifyScheduleOwnerFirst();
  runSql(cleanupSql);
  runSql(setupSql);
  await verifyScheduleCommitmentFirst();
  runSql(cleanupSql);
  runSql(setupSql);
  await verifyUnpublishFirst();
  runSql(cleanupSql);
  runSql(setupSql);
  await verifyCommitmentBeforeUnpublish();
  console.log(
    "Owner Calendar concurrency preserved availability, price, schedule, and publication outcomes in both transaction orders.",
  );
} catch (error) {
  failure = error;
} finally {
  try {
    terminateTestSessions();
    runSql(cleanupSql);
  } catch (cleanupError) {
    if (!failure) failure = cleanupError;
    else console.error(cleanupError);
  }
}
if (failure) throw failure;
