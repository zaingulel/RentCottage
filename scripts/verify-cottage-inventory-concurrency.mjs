import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { accessBrowserFixture } from "./lib/access-browser-fixtures.mjs";
import { publishedCottageCleanup } from "./lib/booking-fixture.mjs";
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
  cleanUpOwnedSession,
  markTimingPhase,
  finishTiming,
  finishSession,
  guardDisposableLocalDatabase,
  runSql,
  startSession,
  waitForLock: waitForDatabaseLock,
  waitForMarker,
} = createLocalSupabaseConcurrencyHarness({
  timing: {
    check: "verify-cottage-inventory-concurrency",
    isolation: "serial",
  },
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
let timingOutcome = "failed";
try {
  markTimingPhase("setup");
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

  const cleanupSql = publishedCottageCleanup({
    profiles: [profileId],
    users: [ownerUserId, customerUserId],
  });

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

  async function verifyOwnerSpanSnapshot() {
    runSql(`begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '${ownerClaims}', true);
      select public.set_cottage_inventory_availability(
        '${profileId}', '${revisionId}', '2099-08-21',
        '[{"unitId":"${firstShiftId}","unitKind":"shift","state":"open"}]');
      commit;`);
    const gateKey = `hashtextextended('rc_i27_owner_span_${randomUUID()}', 0)`;
    const holder = startSession(`begin;
      set application_name='rc_i27_span_snapshot_holder';
      select pg_advisory_xact_lock(${gateKey});
      select 'SPAN_SNAPSHOT_GATE_HELD';`);
    let reader;
    try {
      await waitForMarker(holder, "SPAN_SNAPSHOT_GATE_HELD");
      const readerName = "rc_i27_span_snapshot_reader";
      reader = startSession(
        `begin isolation level read committed;
        set application_name='${readerName}';
        set local role authenticated;
        select set_config('request.jwt.claims', '${ownerClaims}', true);
        with gate as materialized (
          select pg_advisory_xact_lock(${gateKey}),
            date '2099-08-20' as from_day, date '2099-08-21' as to_day
        ), observation as materialized (
          select public.resolve_cottage_inventory_owner_calendar_span(
            '${profileId}', '${revisionId}', gate.from_day, gate.to_day) as calendar
          from gate
        ) select 'SPAN_SNAPSHOT=' || jsonb_build_object(
          'calendar', calendar,
          'matchesStatementTime', (calendar ->> 'asOf')::timestamptz = statement_timestamp()
        )::text from observation;
        commit;`,
        true,
      );
      await waitForDatabaseLock(readerName, reader);
      runSql(`${priceMutation("rc_i27_span_snapshot_writer", "SPAN_SNAPSHOT_PRICE_CHANGED")}
        select public.set_cottage_inventory_availability(
          '${profileId}', '${revisionId}', '2099-08-20',
          '[{"unitId":"${firstShiftId}","unitKind":"shift","state":"private_blocked"}]');
        select public.set_cottage_inventory_availability(
          '${profileId}', '${revisionId}', '2099-08-21',
          '[{"unitId":"${firstShiftId}","unitKind":"shift","state":"closed"}]');
        commit;`);
      await finishSession(holder, { action: "commit" });
      await finishSession(reader);
      const observed = JSON.parse(
        reader.stdout
          .split("\n")
          .find((line) => line.startsWith("SPAN_SNAPSHOT="))
          .slice("SPAN_SNAPSHOT=".length),
      );
      const fresh = JSON.parse(
        runSql(`begin;
        set local role authenticated;
        select set_config('request.jwt.claims', '${ownerClaims}', true);
        select public.resolve_cottage_inventory_owner_calendar_span(
          '${profileId}', '${revisionId}', '2099-08-20', '2099-08-21');
        rollback;`)
          .split("\n")
          .at(-1),
      );
      const firstShiftCells = (calendar) => {
        assert.equal(calendar.profileId, profileId);
        assert.equal(calendar.scheduleRevisionId, revisionId);
        assert.equal(calendar.from, "2099-08-20");
        assert.equal(calendar.to, "2099-08-21");
        assert.deepEqual(calendar.unitKeys, [
          { id: firstShiftId, kind: "shift" },
          { id: secondShiftId, kind: "shift" },
          { id: bundleId, kind: "full_day_bundle" },
        ]);
        assert.deepEqual(
          calendar.days.map((day) => day.serviceDay),
          ["2099-08-20", "2099-08-21"],
        );
        return calendar.days.map((day) => {
          assert.equal(day.units.length, 3);
          assert.deepEqual(
            day.units.map(({ id, kind }) => ({ id, kind })),
            calendar.unitKeys,
          );
          for (const unit of day.units) {
            assert.equal(unit.commitmentReference, null);
            assert.equal(unit.temporarilyUnavailable, false);
          }
          return day.units.find((unit) => unit.id === firstShiftId);
        });
      };
      assert.equal(observed.matchesStatementTime, true);
      assert.deepEqual(firstShiftCells(observed.calendar), [
        {
          id: firstShiftId,
          kind: "shift",
          ownerState: "open",
          calendarState: "open",
          priceIqd: 175000,
          available: true,
          editable: true,
          temporarilyUnavailable: false,
          commitmentReference: null,
        },
        {
          id: firstShiftId,
          kind: "shift",
          ownerState: "open",
          calendarState: "open",
          priceIqd: 175000,
          available: true,
          editable: true,
          temporarilyUnavailable: false,
          commitmentReference: null,
        },
      ]);
      assert.deepEqual(firstShiftCells(fresh), [
        {
          id: firstShiftId,
          kind: "shift",
          ownerState: "private_blocked",
          calendarState: "private_blocked",
          priceIqd: 185000,
          available: false,
          editable: true,
          temporarilyUnavailable: false,
          commitmentReference: null,
        },
        {
          id: firstShiftId,
          kind: "shift",
          ownerState: "closed",
          calendarState: "closed",
          priceIqd: 175000,
          available: false,
          editable: true,
          temporarilyUnavailable: false,
          commitmentReference: null,
        },
      ]);
      console.log(
        "owner span keeps one statement snapshot across concurrent inventory changes: passed; gated read retained open/175000, fresh read observed private_blocked/185000 and closed/175000; exact cells and statement asOf.",
      );
    } catch (error) {
      await cleanUpOwnedSession(holder, error);
      if (reader) await cleanUpOwnedSession(reader, error);
      throw error;
    }
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
    markTimingPhase("setup");
    runSql(`
    update public.cottage_inventory_availability set state = 'open'
    where schedule_revision_id = '${revisionId}'
      and unit_kind = 'shift' and unit_id = '${firstShiftId}'
      and service_day = '${serviceDay}';
  `);
    markTimingPhase("execution");
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
    markTimingPhase("setup");
    runSql(`
    delete from public.cottage_booking_period_commitments
    where commitment_reference = 'RC-PRICE-OWNER-FIRST-27';
  `);
  }

  async function verifyPriceCommitmentFirst() {
    markTimingPhase("setup");
    runSql(`
    delete from public.cottage_inventory_date_price_overrides
    where schedule_revision_id = '${revisionId}'
      and unit_kind = 'shift' and unit_id = '${firstShiftId}'
      and service_day = '${serviceDay}';
  `);
    markTimingPhase("execution");
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
  const browserOwnerId = runSql(
    "select id from auth.users where phone='9647510000000';",
  );
  assert.match(browserOwnerId, /^[0-9a-f-]{36}$/);
  function browserContinuationIds(stage) {
    const observed = JSON.parse(
      runSql(`begin;
        do $$ begin perform set_config('request.jwt.claims',
          '{"sub":"${browserOwnerId}","role":"authenticated","aal":"aal1"}', true); end $$;
        set local role authenticated;
        with profiles as materialized (
          select id, status, current_publication_id, version
          from public.list_owner_cottage_profiles(
            target_after_updated_at => null, target_after_id => null, target_limit => 100)
        ), progress as materialized (
          select profile_id, profile_version, completed_requirements, next_requirement, submission_allowed
          from public.read_owner_cottage_profile_draft_progress(
            target_profile_ids => array(select id from profiles
              where status='draft' and current_publication_id is null))
        ) select jsonb_build_object(
          'profiles', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from profiles p), '[]'::jsonb),
          'progress', coalesce((select jsonb_agg(to_jsonb(p) order by p.profile_id) from progress p), '[]'::jsonb));
        rollback;`),
    );
    assert.ok(Array.isArray(observed.profiles));
    assert.ok(Array.isArray(observed.progress));
    assert.ok(
      observed.profiles.length < 100,
      "Browser owner list reached page cap",
    );
    assert.equal(
      new Set(observed.profiles.map((profile) => profile.id)).size,
      observed.profiles.length,
    );
    const drafts = observed.profiles.filter(
      (profile) =>
        profile.status === "draft" && profile.current_publication_id === null,
    );
    assert.equal(
      observed.progress.length,
      drafts.length,
      "Exact browser draft progress cardinality required",
    );
    assert.equal(
      new Set(observed.progress.map((row) => row.profile_id)).size,
      drafts.length,
    );
    for (const row of observed.progress) {
      const profile = drafts.find((draft) => draft.id === row.profile_id);
      assert.ok(profile, "Progress must match an observed browser draft");
      assert.equal(row.profile_version, profile.version);
      assert.ok(
        Number.isInteger(row.completed_requirements) &&
          row.completed_requirements >= 0 &&
          row.completed_requirements <= 13,
      );
      assert.equal(typeof row.submission_allowed, "boolean");
      assert.ok(
        row.next_requirement === null ||
          typeof row.next_requirement === "string",
      );
      assert.equal(
        row.next_requirement === null,
        row.completed_requirements === 13,
      );
    }
    const ids = observed.progress
      .filter((row) => row.submission_allowed && row.next_requirement !== null)
      .map((row) => row.profile_id)
      .sort();
    console.log(
      "inventory browser continuation observation:",
      JSON.stringify({ stage, ids, count: ids.length }),
    );
    return ids;
  }
  const browserContinuationsBefore = browserContinuationIds("before");
  let failure;
  try {
    markTimingPhase("setup");
    runSql(cleanupSql);
    runSql(setupSql);
    markTimingPhase("execution");
    await verifyOwnerSpanSnapshot();
    markTimingPhase("setup");
    runSql(cleanupSql);
    runSql(setupSql);
    markTimingPhase("execution");
    await verifyOwnerFirst();
    await verifyCommitmentFirst();
    markTimingPhase("setup");
    runSql(cleanupSql);
    runSql(setupSql);
    markTimingPhase("execution");
    await verifyPriceOwnerFirst();
    await verifyPriceCommitmentFirst();
    markTimingPhase("setup");
    runSql(cleanupSql);
    runSql(setupSql);
    markTimingPhase("execution");
    await verifyScheduleOwnerFirst();
    markTimingPhase("setup");
    runSql(cleanupSql);
    runSql(setupSql);
    markTimingPhase("execution");
    await verifyScheduleCommitmentFirst();
    markTimingPhase("setup");
    runSql(cleanupSql);
    runSql(setupSql);
    markTimingPhase("execution");
    await verifyUnpublishFirst();
    markTimingPhase("setup");
    runSql(cleanupSql);
    runSql(setupSql);
    markTimingPhase("execution");
    await verifyCommitmentBeforeUnpublish();
    console.log(
      "Owner Calendar concurrency preserved availability, price, schedule, and publication outcomes in both transaction orders.",
    );
  } catch (error) {
    failure = error;
  } finally {
    markTimingPhase("cleanup");
    try {
      terminateTestSessions();
      runSql(cleanupSql);
    } catch (cleanupError) {
      if (!failure) failure = cleanupError;
      else console.error(cleanupError);
    }
  }
  if (failure) throw failure;
  markTimingPhase("setup");
  const preparedOwnerPhone = accessBrowserFixture(
    "mobile",
    "concurrency-inventory",
  ).bookingOwnerPhone;
  const preparedOwnerId = runSql(
    `select id from auth.users where phone='${preparedOwnerPhone.slice(1)}';`,
  );
  const administratorId = runSql(
    `select id from auth.users where email='cottage-profile-fixture-reviewer@rentcottage.test';`,
  );
  assert.match(preparedOwnerId, /^[0-9a-f-]{36}$/);
  assert.match(administratorId, /^[0-9a-f-]{36}$/);
  assert.notEqual(preparedOwnerId, ownerUserId);
  const preparedClaims = `select set_config('request.jwt.claims', '{"sub":"${preparedOwnerId}","role":"authenticated","aal":"aal1"}', true);`;
  const preparedSession = (name, body) => `
    begin;
    set application_name='${name}';
    set local role authenticated;
    ${preparedClaims}
    ${body}
  `;
  const administratorSession = (name, body) => `
    begin;
    set application_name='${name}';
    set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${administratorId}","role":"authenticated","aal":"aal2"}', true);
    ${body}
  `;
  const eligibleOwner = () =>
    runSql(
      preparedSession(
        "owner-inventory-eligibility",
        `
    select public.owner_can_start_new_business('${preparedOwnerId}'); rollback;
  `,
      ),
    )
      .split("\n")
      .at(-1);
  assert.equal(eligibleOwner(), "t");
  for (const signature of [
    "public.save_cottage_inventory_pricing_unchecked_dates(uuid,uuid,jsonb)",
    "public.set_cottage_inventory_availability_changed_units(uuid,uuid,date,jsonb)",
  ]) {
    assert.deepEqual(
      JSON.parse(
        runSql(`select jsonb_build_object(
      'authenticated', has_function_privilege('authenticated','${signature}','EXECUTE'),
      'postgres', has_function_privilege('postgres','${signature}','EXECUTE'));`),
      ),
      { authenticated: false, postgres: true },
    );
  }
  const suspendedProfileId = runSql(
    preparedSession(
      "owner-inventory-suspension-setup",
      `
    select (public.create_owner_cottage_profile_draft()).id; commit;
  `,
    ),
  )
    .split("\n")
    .at(-1);
  console.log("owner inventory scenario profile:", suspendedProfileId);
  runSql(
    preparedSession(
      "owner-inventory-suspension-schedule",
      `
    select public.replace_cottage_shift_schedule('${suspendedProfileId}',0,
      '[{"name":"Morning","startTime":"08:00","endTime":"12:00"},{"name":"Evening","startTime":"18:00","endTime":"22:00"}]');
    commit;
  `,
    ),
  );
  const readInventory = () =>
    JSON.parse(
      runSql(`
    select jsonb_build_object(
      'profile', to_jsonb(profiles),
      'schedules', (select jsonb_agg(to_jsonb(schedules) order by revision)
        from public.cottage_shift_schedule_revisions schedules where profile_id=profiles.id),
      'shifts', (select jsonb_agg(to_jsonb(shifts) order by schedules.revision, shifts.position)
        from public.cottage_shifts shifts join public.cottage_shift_schedule_revisions schedules
          on schedules.id=shifts.schedule_revision_id where schedules.profile_id=profiles.id),
      'prices', coalesce((select jsonb_agg(to_jsonb(prices) order by prices.schedule_revision_id,prices.unit_id)
        from public.cottage_inventory_standard_prices prices join public.cottage_shift_schedule_revisions schedules
          on schedules.id=prices.schedule_revision_id where schedules.profile_id=profiles.id), '[]'::jsonb),
      'datePrices', coalesce((select jsonb_agg(to_jsonb(prices) order by prices.schedule_revision_id,prices.unit_id,prices.service_day)
        from public.cottage_inventory_date_price_overrides prices join public.cottage_shift_schedule_revisions schedules
          on schedules.id=prices.schedule_revision_id where schedules.profile_id=profiles.id), '[]'::jsonb),
      'weekdayPrices', coalesce((select jsonb_agg(to_jsonb(prices) order by prices.schedule_revision_id,prices.unit_id,prices.weekday)
        from public.cottage_inventory_weekday_price_overrides prices join public.cottage_shift_schedule_revisions schedules
          on schedules.id=prices.schedule_revision_id where schedules.profile_id=profiles.id), '[]'::jsonb),
      'availability', coalesce((select jsonb_agg(to_jsonb(availability) order by availability.schedule_revision_id,availability.unit_id,availability.service_day)
        from public.cottage_inventory_availability availability join public.cottage_shift_schedule_revisions schedules
          on schedules.id=availability.schedule_revision_id where schedules.profile_id=profiles.id), '[]'::jsonb),
      'commitmentCount', (select count(*) from public.cottage_booking_period_commitments where profile_id=profiles.id),
      'occupancyCount', (select count(*) from public.cottage_booking_period_occupancies occupancies
        join public.cottage_shift_schedule_revisions schedules on schedules.id=occupancies.schedule_revision_id
        where schedules.profile_id=profiles.id)
    ) from public.owner_application_cottage_profiles profiles where id='${suspendedProfileId}';
  `),
    );
  const initial = readInventory();
  const originalScheduleId = initial.profile.current_shift_schedule_id;
  const originalFirstShiftId = initial.shifts[0].id;
  const originalSecondShiftId = initial.shifts[1].id;
  const originalBundleId = initial.schedules[0].full_day_bundle_id;
  const requestedPrices = (override) =>
    JSON.stringify({
      units: [
        {
          unitId: originalFirstShiftId,
          unitKind: "shift",
          standardPriceIqd: 175000,
          ...(override
            ? { dateOverrides: [{ serviceDay, priceIqd: 185000 }] }
            : {}),
        },
        {
          unitId: originalSecondShiftId,
          unitKind: "shift",
          standardPriceIqd: 125000,
        },
        {
          unitId: originalBundleId,
          unitKind: "full_day_bundle",
          standardPriceIqd: 275000,
        },
      ],
    });
  runSql(
    preparedSession(
      "owner-inventory-suspension-prices",
      `
    select public.save_cottage_inventory_pricing('${suspendedProfileId}', '${originalScheduleId}', '${requestedPrices(false)}');
    commit;
  `,
    ),
  );
  assert.deepEqual(
    initial.shifts.map((shift) => [
      shift.position,
      shift.start_time,
      shift.end_time,
    ]),
    [
      [1, "08:00:00", "12:00:00"],
      [2, "18:00:00", "22:00:00"],
    ],
  );
  assert.equal(initial.profile.current_publication_id, null);
  assert.equal(initial.commitmentCount, 0);
  assert.equal(initial.occupancyCount, 0);
  assert.equal(initial.availability.length, 0);
  const ownerHistory = () =>
    JSON.parse(
      runSql(`select jsonb_build_object(
    'application', (select to_jsonb(applications) from public.owner_applications applications where owner_user_id='${preparedOwnerId}'),
    'suspensionRevision', (select owner_suspension_revision from public.account_contexts where user_id='${preparedOwnerId}'),
    'transitions', coalesce((select jsonb_agg(to_jsonb(transitions) order by transitions.id)
      from public.owner_application_transitions transitions join public.owner_applications applications
        on applications.id=transitions.application_id where applications.owner_user_id='${preparedOwnerId}'), '[]'::jsonb),
    'notices', coalesce((select jsonb_agg(to_jsonb(notices) order by id)
      from public.owner_application_notices notices where owner_user_id='${preparedOwnerId}'), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(to_jsonb(actions) order by id)
      from private.marketplace_suspension_actions actions where account_user_id='${preparedOwnerId}'), '[]'::jsonb));`),
    );
  for (const operation of ["pricing", "availability", "schedule"]) {
    markTimingPhase("setup");
    assert.equal(eligibleOwner(), "t");
    assert.equal(
      runSql(
        `select count(*) from public.booking_requests where owner_user_id='${preparedOwnerId}' and status='pending';`,
      ),
      "0",
    );
    const before = readInventory();
    assert.equal(before.profile.current_shift_schedule_id, originalScheduleId);
    assert.equal(before.schedules.length, 1);
    assert.equal(before.datePrices.length, 0);
    assert.equal(before.availability.length, 0);
    assert.equal(
      before.prices.find((price) => price.unit_id === originalFirstShiftId)
        .price_iqd,
      175000,
    );
    assert.equal(
      before.prices.find((price) => price.unit_id === originalSecondShiftId)
        .price_iqd,
      125000,
    );
    assert.equal(
      before.prices.find((price) => price.unit_id === originalBundleId)
        .price_iqd,
      275000,
    );
    const historyBefore = ownerHistory();
    const commandId = randomUUID();
    const reactivationCommandId = randomUUID();
    const reason = `Fictional owner inventory ${operation} ${commandId}`;
    const restoreReason = `Restore fictional owner inventory ${operation} ${reactivationCommandId}`;
    const holder =
      startSession(`begin; set application_name='owner-${operation}-suspension-holder';
      select id from public.owner_application_cottage_profiles where id='${suspendedProfileId}' for update;
      select 'OWNER_INVENTORY_PROFILE_HELD';`);
    let contender;
    try {
      markTimingPhase("execution");
      await waitForMarker(holder, "OWNER_INVENTORY_PROFILE_HELD");
      const contenderRole =
        operation === "schedule" ? "authenticated" : "postgres";
      contender = startSession(
        `begin; set application_name='owner-${operation}-suspension-contender';
        ${operation === "schedule" ? "set local role authenticated;" : ""}
        ${preparedClaims}
        select 'HELPER_AUTHORITY=' || current_user || '|' || auth.uid()::text;
        ${
          operation === "pricing"
            ? `select public.save_cottage_inventory_pricing_unchecked_dates(
              '${suspendedProfileId}', '${originalScheduleId}', '${requestedPrices(true)}');`
            : operation === "availability"
              ? `select public.set_cottage_inventory_availability_changed_units(
                  '${suspendedProfileId}', '${originalScheduleId}', '${serviceDay}',
                  '[{"unitId":"${originalFirstShiftId}","unitKind":"shift","state":"private_blocked"}]');`
              : `select public.replace_cottage_shift_schedule('${suspendedProfileId}', ${before.schedules[0].revision},
                  '[{"name":"Morning","startTime":"07:00","endTime":"11:00"},{"name":"Evening","startTime":"17:00","endTime":"21:00"}]');`
        }
        commit;`,
        true,
      );
      await waitForMarker(
        contender,
        `HELPER_AUTHORITY=${contenderRole}|${preparedOwnerId}`,
      );
      await waitForDatabaseLock(
        `owner-${operation}-suspension-contender`,
        contender,
      );
      assert.ok(
        contender.stdout
          .split("\n")
          .includes(`HELPER_AUTHORITY=${contenderRole}|${preparedOwnerId}`),
      );
      holder.child.stdin.write(`set local role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${administratorId}","role":"authenticated","aal":"aal2"}', true);
        select 'OWNER_INVENTORY_SUSPENSION=' || public.set_marketplace_suspension('owner','${preparedOwnerId}',
          'suspend',${historyBefore.application.version},'${reason}','${commandId}')::text;
        select 'OWNER_INVENTORY_SUSPENDED';
      `);
      await waitForMarker(holder, "OWNER_INVENTORY_SUSPENDED");
      const suspension = JSON.parse(
        holder.stdout
          .split("\n")
          .find((line) => line.startsWith("OWNER_INVENTORY_SUSPENSION="))
          .slice("OWNER_INVENTORY_SUSPENSION=".length),
      );
      assert.equal(suspension.status, "completed");
      await finishSession(holder, { action: "commit" });
      await contender.exited;
      const after = readInventory();
      console.log(
        `owner-${operation} retained inventory:`,
        JSON.stringify({
          profileId: suspendedProfileId,
          commandId,
          reactivationCommandId,
          currentScheduleId: after.profile.current_shift_schedule_id,
          schedules: after.schedules,
          shifts: after.shifts,
          prices: after.prices,
          datePrices: after.datePrices,
          availability: after.availability,
        }),
      );
      assert.deepEqual(
        after,
        before,
        `owner_write_rechecks_after_profile_wait ${operation} changed inventory after suspension`,
      );
      await finishSession(contender, { expectedState: "42501" });
      console.log(
        `owner_write_rechecks_after_profile_wait ${operation}: actual suspension won profile wait; 42501 and exact unchanged inventory graph.`,
      );
    } catch (error) {
      await cleanUpOwnedSession(holder, error);
      if (contender) await cleanUpOwnedSession(contender, error);
      throw error;
    } finally {
      markTimingPhase("cleanup");
      const currentHistory = ownerHistory();
      const actions = currentHistory.actions.filter(
        (action) => action.command_id === commandId,
      );
      if (actions.length) {
        assert.equal(actions.length, 1);
        assert.equal(actions[0].actor_user_id, administratorId);
        assert.equal(actions[0].reason, reason);
        assert.equal(actions[0].target_kind, "owner");
        const current = JSON.parse(
          runSql(
            administratorSession(
              "owner-inventory-restoration-check",
              `
          select public.get_marketplace_suspension('owner','${preparedOwnerId}'); rollback;
        `,
            ),
          )
            .split("\n")
            .at(-1),
        );
        assert.equal(current.status, "ready");
        assert.equal(current.state, "suspended");
        assert.equal(current.revision, actions[0].resulting_revision);
        assert.equal(current.canReactivate, true);
        assert.equal(current.restorationState, "approved");
        const restored = JSON.parse(
          runSql(
            administratorSession(
              "owner-inventory-reactivate",
              `
          select public.set_marketplace_suspension('owner','${preparedOwnerId}','reactivate',
            ${current.revision},'${restoreReason}','${reactivationCommandId}'); commit;
        `,
            ),
          )
            .split("\n")
            .at(-1),
        );
        assert.equal(restored.status, "completed");
        assert.equal(eligibleOwner(), "t");
        const historyAfter = ownerHistory();
        for (const key of ["transitions", "notices", "actions"]) {
          const oldIds = new Set(historyBefore[key].map((row) => row.id));
          assert.deepEqual(
            historyAfter[key].filter((row) => oldIds.has(row.id)),
            historyBefore[key],
          );
        }
        assert.equal(
          historyAfter.application.version,
          historyBefore.application.version + 2,
        );
        assert.equal(
          historyAfter.suspensionRevision,
          historyBefore.suspensionRevision + 2,
        );
        assert.equal(
          historyAfter.actions.length,
          historyBefore.actions.length + 2,
        );
        assert.equal(
          historyAfter.transitions.length,
          historyBefore.transitions.length + 2,
        );
        assert.equal(
          historyAfter.notices.length,
          historyBefore.notices.length + 1,
        );
        for (const [id, expectedReason, version, action] of [
          [commandId, reason, historyBefore.application.version, "suspend"],
          [
            reactivationCommandId,
            restoreReason,
            current.revision,
            "reactivate",
          ],
        ]) {
          const matching = historyAfter.actions.filter(
            (row) => row.command_id === id,
          );
          assert.equal(matching.length, 1);
          assert.equal(matching[0].action, action);
          assert.equal(matching[0].reason, expectedReason);
          assert.equal(matching[0].expected_revision, version);
          assert.equal(matching[0].resulting_revision, version + 1);
          const transitions = historyAfter.transitions.filter(
            (row) =>
              row.application_version === version + 1 &&
              row.reason === expectedReason,
          );
          assert.equal(transitions.length, 1);
          assert.equal(transitions[0].actor_user_id, administratorId);
        }
        assert.equal(
          historyAfter.notices.filter(
            (row) => row.reason === reason && row.kind === "suspended",
          ).length,
          1,
        );
        console.log(
          `owner-${operation} history: real reactivation; all old rows and two actions/two transitions/one notice retained; counters advanced twice.`,
        );
      }
    }
  }
  markTimingPhase("setup");
  const readCustomerState = () =>
    JSON.parse(
      runSql(`select jsonb_build_object(
    'suspended',customer_suspended,'revision',customer_suspension_revision,
    'ownerApproval',owner_approval_state,'ownerRevision',owner_suspension_revision)
    from public.account_contexts where user_id='${preparedOwnerId}';`),
    );
  const customerBefore = readCustomerState();
  assert.equal(customerBefore.suspended, false);
  assert.equal(customerBefore.ownerApproval, "approved");
  assert.equal(
    runSql(`select count(*) from public.booking_requests
    where customer_user_id='${preparedOwnerId}' and status='pending';`),
    "0",
  );
  const capabilityHistoryBefore = ownerHistory();
  const capabilityInventoryBefore = readInventory();
  assert.equal(capabilityInventoryBefore.availability.length, 0);
  const customerCommandId = randomUUID();
  const customerReactivationId = randomUUID();
  const customerReason = `Fictional customer-only restriction ${customerCommandId}`;
  const customerRestoreReason = `Restore fictional customer-only restriction ${customerReactivationId}`;
  try {
    markTimingPhase("execution");
    const suspended = JSON.parse(
      runSql(
        administratorSession(
          "customer-only-owner-write-suspend",
          `
      select public.set_marketplace_suspension('customer','${preparedOwnerId}','suspend',
        ${customerBefore.revision},'${customerReason}','${customerCommandId}'); commit;
    `,
        ),
      )
        .split("\n")
        .at(-1),
    );
    assert.equal(suspended.status, "completed");
    const restricted = readCustomerState();
    assert.equal(restricted.suspended, true);
    assert.equal(restricted.ownerApproval, "approved");
    assert.equal(restricted.ownerRevision, customerBefore.ownerRevision);
    assert.equal(eligibleOwner(), "t");
    runSql(
      preparedSession(
        "customer-only-owner-availability-write",
        `
      select public.set_cottage_inventory_availability('${suspendedProfileId}',
        '${capabilityInventoryBefore.profile.current_shift_schedule_id}','${serviceDay}',
        '[{"unitId":"${originalFirstShiftId}","unitKind":"shift","state":"private_blocked"}]'); commit;
    `,
      ),
    );
    const after = readInventory();
    assert.deepEqual(after, {
      ...capabilityInventoryBefore,
      availability: [
        {
          schedule_revision_id:
            capabilityInventoryBefore.profile.current_shift_schedule_id,
          unit_id: originalFirstShiftId,
          unit_kind: "shift",
          service_day: serviceDay,
          state: "private_blocked",
        },
      ],
    });
    assert.equal(readCustomerState().suspended, true);
    console.log(
      "customer-only suspension preserves owner write: actual customer flag true and owner approved; public availability write committed private_blocked.",
    );
    console.log(
      "customer-only retained evidence:",
      JSON.stringify({
        profileId: suspendedProfileId,
        scheduleId: after.profile.current_shift_schedule_id,
        customerCommandId,
        customerReactivationId,
        availability: after.availability,
      }),
    );
  } finally {
    markTimingPhase("cleanup");
    const action = ownerHistory().actions.find(
      (row) => row.command_id === customerCommandId,
    );
    if (action) {
      assert.equal(action.target_kind, "customer");
      assert.equal(action.reason, customerReason);
      assert.equal(action.actor_user_id, administratorId);
      const current = JSON.parse(
        runSql(
          administratorSession(
            "customer-only-restoration-check",
            `
        select public.get_marketplace_suspension('customer','${preparedOwnerId}'); rollback;
      `,
          ),
        )
          .split("\n")
          .at(-1),
      );
      assert.equal(current.status, "ready");
      assert.equal(current.state, "suspended");
      assert.equal(current.revision, action.resulting_revision);
      assert.equal(current.canReactivate, true);
      const restored = JSON.parse(
        runSql(
          administratorSession(
            "customer-only-reactivate",
            `
        select public.set_marketplace_suspension('customer','${preparedOwnerId}','reactivate',
          ${current.revision},'${customerRestoreReason}','${customerReactivationId}'); commit;
      `,
          ),
        )
          .split("\n")
          .at(-1),
      );
      assert.equal(restored.status, "completed");
      assert.deepEqual(readCustomerState(), {
        ...customerBefore,
        revision: customerBefore.revision + 2,
      });
      assert.equal(eligibleOwner(), "t");
      const after = ownerHistory();
      assert.deepEqual(after.application, capabilityHistoryBefore.application);
      assert.deepEqual(after.transitions, capabilityHistoryBefore.transitions);
      assert.deepEqual(after.notices, capabilityHistoryBefore.notices);
      const oldIds = new Set(
        capabilityHistoryBefore.actions.map((row) => row.id),
      );
      assert.deepEqual(
        after.actions.filter((row) => oldIds.has(row.id)),
        capabilityHistoryBefore.actions,
      );
      const newActions = after.actions.filter((row) => !oldIds.has(row.id));
      assert.equal(newActions.length, 2);
      for (const [id, reason, revision, actionName] of [
        [customerCommandId, customerReason, customerBefore.revision, "suspend"],
        [
          customerReactivationId,
          customerRestoreReason,
          current.revision,
          "reactivate",
        ],
      ]) {
        const matching = newActions.filter((row) => row.command_id === id);
        assert.equal(matching.length, 1);
        assert.equal(matching[0].target_kind, "customer");
        assert.equal(matching[0].actor_user_id, administratorId);
        assert.equal(matching[0].reason, reason);
        assert.equal(matching[0].action, actionName);
        assert.equal(matching[0].expected_revision, revision);
        assert.equal(matching[0].resulting_revision, revision + 1);
      }
      console.log(
        "customer-only history: actual fresh-revision reactivation retained both actions and all prior owner history; owner authority unchanged.",
      );
    }
  }
  assert.deepEqual(
    browserContinuationIds("after"),
    browserContinuationsBefore,
    "Inventory concurrency changed the browser owner's Continue setup IDs",
  );
  timingOutcome = "passed";
} finally {
  finishTiming({
    outcome: timingOutcome,
    cleanupDisposition: "project-teardown",
  });
}
