import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const customerId = "97000000-0000-4000-8000-000000000032";
const authorizationMarker = "RC_BOOKING_REQUEST_AUTHORIZED";
const finalizationMarker = "RC_BOOKING_REQUEST_FIRST_FINALIZED";
const contenderName = "rc-booking-request-contender";
const paymentCasMarker = "RC_BOOKING_REQUEST_RELEASE_SAVED";
const paymentCasContenderName = "rc-booking-request-payment-stale";
const finalizationTimeBlockerName = "rc-booking-request-time-blocker";
const lookupCommitName = "rc-booking-request-lookup-commit";
const lookupRollbackName = "rc-booking-request-lookup-rollback";
const inlinePersistenceMarker = "RC_BOOKING_REQUEST_INLINE_PERSISTING";
const outboxCompletionName = "rc-booking-request-outbox-completion";
const durableExecutionContenderName =
  "rc-booking-request-durable-execution-contender";
const expiryStaleCompletionName = "rc-booking-request-expiry-stale-completion";
const releaseRetryOwnerName = "rc-booking-request-release-retry-owner";
const releaseRetryContenderName = "rc-booking-request-release-retry-contender";
const releaseRetryMarker = "RC_BOOKING_REQUEST_RELEASE_RETRY_LEASED";

const {
  finishSession,
  guardDisposableLocalDatabase,
  runSql,
  startSession: openSession,
  waitForLock,
  waitForMarker,
} = createLocalSupabaseConcurrencyHarness({
  messages: {
    invalidGuard:
      "The Booking Request concurrency test requires guarded local Supabase.",
    wrongOwner:
      "The Supabase container does not belong to this disposable checkout.",
  },
});
const activeSessions = new Set();

function startSession(sql, closeInput) {
  const session = openSession(sql, closeInput);
  activeSessions.add(session);
  return session;
}

function prepareSql(idempotencyKey) {
  return `public.prepare_booking_request_submission(
    '${customerId}', '${idempotencyKey}',
    (select submission from public.test_booking_request_concurrency_fixture)
  )`;
}

function restoreBaseBookingWindow() {
  runSql(`
    delete from public.cottage_inventory_availability availability
    using public.test_booking_request_concurrency_fixture fixture
    where availability.schedule_revision_id = fixture.schedule_id
      and availability.unit_kind = 'shift'
      and availability.unit_id = fixture.shift_id
      and availability.service_day = fixture.service_day;
    delete from public.cottage_inventory_availability availability
    using public.test_booking_request_cross_cottage_fixture fixture
    where availability.schedule_revision_id = fixture.schedule_id
      and availability.unit_kind = 'shift'
      and availability.unit_id = fixture.shift_id
      and availability.service_day = fixture.service_day;
    alter table public.cottage_shifts
      disable trigger reject_cottage_shift_update;
    update public.cottage_shifts shifts
    set start_time = fixture.original_start_time,
      end_time = fixture.original_end_time
    from public.test_booking_request_concurrency_fixture fixture
    where shifts.id = fixture.shift_id;
    update public.cottage_shifts shifts
    set start_time = fixture.original_start_time,
      end_time = fixture.original_end_time
    from public.test_booking_request_cross_cottage_fixture fixture
    where shifts.id = fixture.shift_id;
    alter table public.cottage_shifts
      enable trigger reject_cottage_shift_update;
    update public.test_booking_request_concurrency_fixture
    set service_day = base_service_day,
      submission = base_submission;
    update public.test_booking_request_cross_cottage_fixture
    set service_day = base_service_day;
    insert into public.cottage_inventory_availability (
      schedule_revision_id, unit_kind, unit_id, service_day, state
    ) select schedule_id, 'shift', shift_id, service_day, 'open'
      from public.test_booking_request_concurrency_fixture
    on conflict (schedule_revision_id, unit_kind, unit_id, service_day)
      do update set state = 'open';
    insert into public.cottage_inventory_availability (
      schedule_revision_id, unit_kind, unit_id, service_day, state
    ) select schedule_id, 'shift', shift_id, service_day, 'open'
      from public.test_booking_request_cross_cottage_fixture
    on conflict (schedule_revision_id, unit_kind, unit_id, service_day)
      do update set state = 'open';
  `);
}

function prepareBoundaryAttempt({
  authorize = true,
  boundaryHours,
  idempotencyKey,
  label,
  providerSuffix,
}) {
  runSql(`
    delete from public.cottage_inventory_availability availability
    using public.test_booking_request_concurrency_fixture fixture
    where availability.schedule_revision_id = fixture.schedule_id
      and availability.unit_kind = 'shift'
      and availability.unit_id = fixture.shift_id
      and availability.service_day = fixture.service_day;
    delete from public.cottage_inventory_availability availability
    using public.test_booking_request_cross_cottage_fixture fixture
    where availability.schedule_revision_id = fixture.schedule_id
      and availability.unit_kind = 'shift'
      and availability.unit_id = fixture.shift_id
      and availability.service_day = fixture.service_day;
    create temporary table boundary_time as
    select date_trunc('minute', clock_timestamp())
        + interval '${boundaryHours} hours 1 minute'
      as starts_at;
    alter table public.cottage_shifts
      disable trigger reject_cottage_shift_update;
    update public.cottage_shifts shifts
    set start_time = (boundary.starts_at at time zone 'Asia/Baghdad')::time,
      end_time = ((boundary.starts_at + interval '1 hour')
        at time zone 'Asia/Baghdad')::time
    from public.test_booking_request_concurrency_fixture fixture,
      boundary_time boundary
    where shifts.id = fixture.shift_id;
    update public.cottage_shifts shifts
    set start_time = (boundary.starts_at at time zone 'Asia/Baghdad')::time,
      end_time = ((boundary.starts_at + interval '1 hour')
        at time zone 'Asia/Baghdad')::time
    from public.test_booking_request_cross_cottage_fixture fixture,
      boundary_time boundary
    where shifts.id = fixture.shift_id;
    alter table public.cottage_shifts
      enable trigger reject_cottage_shift_update;
    update public.test_booking_request_concurrency_fixture fixture
    set service_day = (boundary.starts_at at time zone 'Asia/Baghdad')::date
    from boundary_time boundary;
    update public.test_booking_request_cross_cottage_fixture fixture
    set service_day = (boundary.starts_at at time zone 'Asia/Baghdad')::date
    from boundary_time boundary;
    insert into public.cottage_inventory_availability (
      schedule_revision_id, unit_kind, unit_id, service_day, state
    ) select schedule_id, 'shift', shift_id, service_day, 'open'
      from public.test_booking_request_concurrency_fixture
    on conflict (schedule_revision_id, unit_kind, unit_id, service_day)
      do update set state = 'open';
    insert into public.cottage_inventory_availability (
      schedule_revision_id, unit_kind, unit_id, service_day, state
    ) select schedule_id, 'shift', shift_id, service_day, 'open'
      from public.test_booking_request_cross_cottage_fixture
    on conflict (schedule_revision_id, unit_kind, unit_id, service_day)
      do update set state = 'open';
    update public.test_booking_request_concurrency_fixture fixture
    set submission = resolved.submission
    from (
      with request as (
        select candidate.*,
          jsonb_build_object(
            'from', service_day, 'to', service_day, 'guests', 2,
            'amenities', jsonb_build_array(),
            'selections', jsonb_build_array(jsonb_build_object(
              'serviceDay', service_day, 'kind', 'shift', 'position', position
            ))
          ) as search
        from public.test_booking_request_concurrency_fixture candidate
      ), quoted as (
        select request.*,
          public.get_public_booking_quote_with_fingerprint('en', slug, search) as quote
        from request
      ), policy as (
        select quoted.*,
          (public.booking_request_policy_at(
            (quote -> 'items' -> 0 ->> 'startsAt')::timestamptz,
            clock_timestamp()
          ) ->> 'requiresInside48HourNoRefundAcceptance')::boolean
            as requires_inside_48
        from quoted
      )
      select profile_id, jsonb_build_object(
        'locale', 'en', 'publicSlug', slug, 'discoveryQuery', search,
        'quoteFingerprint', quote ->> 'quoteFingerprint',
        'contentVersion', (quote ->> 'contentVersion')::integer,
        'termsVersion', quote ->> 'termsVersion',
        'bookingPriceIqd', (quote ->> 'bookingPriceIqd')::bigint,
        'serviceFeeIqd', (quote ->> 'serviceFeeIqd')::bigint,
        'customerTotalIqd', (quote ->> 'customerTotalIqd')::bigint,
        'firstStartsAt', quote -> 'items' -> 0 ->> 'startsAt',
        'intent', jsonb_build_object(
          'customerName', 'Boundary Customer', 'partySize', 2,
          'acceptedHouseRules', true, 'acceptedCancellationPolicy', true,
          'acceptedMarketplaceTerms', true,
          'acceptedInside48HourNoRefund', requires_inside_48,
          'cancellationPolicyVersion', 'rentcottage-mvp-2026-08-04',
          'acceptanceEvidence', public.booking_request_acceptance_evidence(
            'en', quote ->> 'termsVersion', requires_inside_48
          )
        )
      ) as submission
      from policy where quote ->> 'status' = 'quoted'
    ) resolved
    where fixture.profile_id = resolved.profile_id;
    insert into public.test_booking_request_time_boundary_fixture (
      label, crosses_at, prepare_result
    ) select '${label}',
        (fixture.submission ->> 'firstStartsAt')::timestamptz
          - interval '${boundaryHours} hours',
        ${prepareSql(idempotencyKey)}
      from public.test_booking_request_concurrency_fixture fixture;
  `);
  if (authorize) {
    runSql(`
    with prepared as (
      select prepare_result as result
      from public.test_booking_request_time_boundary_fixture
      where label = '${label}'
    ), authorized as (
      select result,
        jsonb_build_object(
          'paymentLifecycleId', result ->> 'paymentLifecycleId',
          'currency', 'IQD',
          'bookingPriceFils', ((fixture.submission ->> 'bookingPriceIqd')::bigint * 1000),
          'bookingServiceFeeFils', ((fixture.submission ->> 'serviceFeeIqd')::bigint * 1000),
          'customerTotalFils', ((fixture.submission ->> 'customerTotalIqd')::bigint * 1000),
          'authorization', jsonb_build_object(
            'paymentLifecycleId', result ->> 'paymentLifecycleId',
            'kind', 'authorization',
            'logicalOperationId', (result ->> 'paymentLifecycleId') || ':authorization',
            'attemptId', (result ->> 'paymentLifecycleId') || ':authorization:attempt-1',
            'status', 'succeeded',
            'amountFils', ((fixture.submission ->> 'customerTotalIqd')::bigint * 1000),
            'providerRequestId', 'boundary-${providerSuffix}-request',
            'providerReference', 'boundary-${providerSuffix}-reference',
            'movementReference', 'boundary-${providerSuffix}-movement',
            'reconciliationRequired', false,
            'retrySafe', false
          ),
          'capture', null,
          'release', null,
          'refunds', jsonb_build_array(),
          'financials', jsonb_build_object(
            'refundedBookingPriceFils', 0,
            'refundedBookingServiceFeeFils', 0,
            'remainingBookingPriceFils', ((fixture.submission ->> 'bookingPriceIqd')::bigint * 1000),
            'remainingBookingServiceFeeFils', ((fixture.submission ->> 'serviceFeeIqd')::bigint * 1000),
            'marketplaceCommissionFils', ((fixture.submission ->> 'bookingPriceIqd')::bigint * 100),
            'ownerEntitlementFils', ((fixture.submission ->> 'bookingPriceIqd')::bigint * 900)
          ),
          'payout', jsonb_build_object(
            'status', 'not_eligible',
            'eligibleFils', ((fixture.submission ->> 'bookingPriceIqd')::bigint * 900),
            'paidFils', 0,
            'providerFeeFils', 0,
            'providerReserveFils', 0,
            'recoveryExposureFils', 0,
            'recoveryBalanceFils', 0,
            'automaticOwnerDebitFils', 0,
            'paidWhileBlocked', false,
            'settlement', null
          ),
          'holds', jsonb_build_object('administrator', false, 'dispute', false),
          'dispute', null,
          'audits', jsonb_build_array(),
          'movements', jsonb_build_array(
            jsonb_build_object(
              'kind', 'authorization',
              'logicalOperationId', (result ->> 'paymentLifecycleId') || ':authorization',
              'attemptId', (result ->> 'paymentLifecycleId') || ':authorization:attempt-1',
              'amountFils', ((fixture.submission ->> 'customerTotalIqd')::bigint * 1000),
              'movementReference', 'boundary-${providerSuffix}-movement',
              'recordedAt', '2099-01-01T00:00:00.000Z'
            )
          )
        ) as snapshot
      from prepared
      cross join public.test_booking_request_concurrency_fixture fixture
      where result ->> 'status' = 'ready'
    ), claimed as (
      select result, snapshot,
        public.begin_booking_request_authorization_claim(
          (result ->> 'attemptId')::uuid,
          snapshot || jsonb_build_object(
            'authorization', (snapshot -> 'authorization') || jsonb_build_object(
              'status', 'pending', 'providerRequestId', null,
              'providerReference', null, 'movementReference', null
            ),
            'movements', jsonb_build_array()
          ),
          '{"provider":"test-payments","environment":"local-test","merchantId":"concurrency-merchant","terminalId":"concurrency-terminal"}'::jsonb
        ) as claim_result
      from authorized
    )
    update public.test_booking_request_time_boundary_fixture fixture
    set attempt_id = (claimed.result ->> 'attemptId')::uuid,
      payment_snapshot = claimed.snapshot
    from claimed
    where claimed.claim_result ->> 'status' = 'ready'
      and fixture.label = '${label}';
    drop table if exists public.test_booking_request_boundary_durable_operation;
    create table public.test_booking_request_boundary_durable_operation as
    select jsonb_build_object(
        'providerIdentity', jsonb_build_object(
          'provider', claims.provider,
          'environment', claims.environment,
          'merchantId', claims.merchant_id,
          'terminalId', claims.terminal_id
        ),
        'idempotencyKey', claims.provider_idempotency_key,
        'requestFingerprint', repeat('b', 64),
        'paymentLifecycleId', claims.payment_lifecycle_id,
        'logicalOperationId', claims.logical_operation_id,
        'physicalAttemptId', claims.physical_attempt_id,
        'operationKind', 'authorization',
        'amountFils', claims.amount_fils,
        'currency', claims.currency,
        'claimId', claims.id,
        'claimGeneration', claims.generation
      ) as operation
    from public.booking_request_authorization_claims claims
    join public.test_booking_request_time_boundary_fixture fixture
      on fixture.attempt_id = claims.attempt_id
    where fixture.label = '${label}';
    grant select on public.test_booking_request_boundary_durable_operation
      to service_role;
    set role service_role;
    select public.execute_simulated_payment_provider_operation(
      operation, 'succeeded'
    )
    from public.test_booking_request_boundary_durable_operation;
    reset role;
    drop table public.test_booking_request_boundary_durable_operation;
    select public.save_booking_request_payment_snapshot(
      fixture.attempt_id,
      fixture.payment_snapshot,
      '{"provider":"test-payments","environment":"local-test","merchantId":"concurrency-merchant","terminalId":"concurrency-terminal"}'::jsonb
    )
    from public.test_booking_request_time_boundary_fixture fixture
    where fixture.label = '${label}';
    `);
  } else {
    runSql(`
      update public.test_booking_request_time_boundary_fixture
      set attempt_id = (prepare_result ->> 'attemptId')::uuid
      where label = '${label}'
        and prepare_result ->> 'status' = 'ready';
    `);
  }
  const fixtureReady = authorize
    ? runSql(`
      select count(*) from public.test_booking_request_time_boundary_fixture
      where label = '${label}'
        and attempt_id is not null
        and payment_snapshot is not null;
    `)
    : runSql(`
      select count(*) from public.test_booking_request_time_boundary_fixture
      where label = '${label}'
        and attempt_id is not null
        and payment_snapshot is null;
    `);
  if (fixtureReady !== "1") {
    const result = runSql(`
      select jsonb_build_object(
        'prepareResult', boundary.prepare_result,
        'crossesAt', boundary.crosses_at,
        'observedAt', clock_timestamp(),
        'firstStartsAt', fixture.submission ->> 'firstStartsAt'
      )::text
      from public.test_booking_request_time_boundary_fixture boundary
      cross join public.test_booking_request_concurrency_fixture fixture
      where boundary.label = '${label}';
    `);
    throw new Error(
      `The ${label} boundary fixture was not prepared: ${result}`,
    );
  }
}

async function verifyLockDelayedPreparationBoundary({
  expectedStatus,
  idempotencyKey,
  label,
}) {
  const blockerMarker = `RC_BOOKING_REQUEST_${label.toUpperCase()}_LOCKED`;
  const blocker = startSession(`
    set application_name = '${finalizationTimeBlockerName}-${label}';
    begin;
    select profiles.id
    from public.owner_application_cottage_profiles profiles
    where profiles.id = (select profile_id from public.test_booking_request_concurrency_fixture)
    for update;
    select '${blockerMarker}';
    select pg_sleep(greatest(0, extract(epoch from (
      (select crosses_at + interval '500 milliseconds'
        from public.test_booking_request_time_boundary_fixture
        where label = '${label}') - clock_timestamp()
    ))));
  `);
  await waitForMarker(blocker, blockerMarker);
  const preparerName = `rc-booking-request-${label}-preparer`;
  const preparer = startSession(
    `
    set application_name = '${preparerName}';
    begin;
    set local role service_role;
    select ${prepareSql(idempotencyKey)} ->> 'status';
    commit;
  `,
    true,
  );
  await waitForLock(preparerName, preparer);
  await finishSession(blocker, { action: "commit" });
  await finishSession(preparer);
  if (!preparer.stdout.includes(expectedStatus)) {
    throw new Error(
      `The ${label} pre-authorization retry returned the wrong state: ${preparer.stdout}`,
    );
  }
  if (
    runSql(`
      select count(*)
      from public.test_booking_request_time_boundary_fixture fixture
      join public.booking_request_submission_attempts attempts
        on attempts.id = fixture.attempt_id
      where fixture.label = '${label}'
        and attempts.state = 'authorizing'
        and attempts.payment_snapshot is null
        and attempts.authorization_provider_request_id is null
        and not exists (
          select 1
          from public.booking_request_provider_operation_identities identities
          where identities.attempt_id = attempts.id
        );
    `) !== "1"
  ) {
    throw new Error(
      `The ${label} retry persisted provider authorization evidence before freshness passed.`,
    );
  }
}

function removeBoundaryAttempt(label) {
  runSql(`
    delete from public.simulated_payment_provider_operations operations
    using public.booking_request_authorization_claims claims,
      public.test_booking_request_time_boundary_fixture fixture
    where fixture.label = '${label}'
      and claims.attempt_id = fixture.attempt_id
      and operations.claim_id = claims.id;
    delete from public.booking_request_provider_operation_identities identities
    using public.test_booking_request_time_boundary_fixture fixture
    where fixture.label = '${label}'
      and identities.attempt_id = fixture.attempt_id;
    delete from public.booking_request_authorization_reconciliation_outbox outbox
    using public.booking_request_authorization_claims claims,
      public.test_booking_request_time_boundary_fixture fixture
    where fixture.label = '${label}'
      and claims.attempt_id = fixture.attempt_id
      and outbox.claim_id = claims.id;
    delete from public.booking_request_authorization_claim_occupancies occupancies
    using public.booking_request_authorization_claims claims,
      public.test_booking_request_time_boundary_fixture fixture
    where fixture.label = '${label}'
      and claims.attempt_id = fixture.attempt_id
      and occupancies.claim_id = claims.id;
    delete from public.booking_request_authorization_claim_items items
    using public.booking_request_authorization_claims claims,
      public.test_booking_request_time_boundary_fixture fixture
    where fixture.label = '${label}'
      and claims.attempt_id = fixture.attempt_id
      and items.claim_id = claims.id;
    delete from public.booking_request_authorization_claims claims
    using public.test_booking_request_time_boundary_fixture fixture
    where fixture.label = '${label}'
      and claims.attempt_id = fixture.attempt_id;
    delete from public.booking_request_submission_attempts attempts
    using public.test_booking_request_time_boundary_fixture fixture
    where fixture.label = '${label}'
      and attempts.id = fixture.attempt_id;
    delete from public.test_booking_request_time_boundary_fixture
    where label = '${label}';
  `);
}

async function verifyPostAuthorizationPolicyBoundary({
  expectedMessage,
  label,
}) {
  const blockerMarker = `RC_BOOKING_REQUEST_${label.toUpperCase()}_LOCKED`;
  const blocker = startSession(`
    set application_name = '${finalizationTimeBlockerName}-${label}';
    begin;
    select profiles.id
    from public.owner_application_cottage_profiles profiles
    where profiles.id = (select profile_id from public.test_booking_request_concurrency_fixture)
    for update;
    select '${blockerMarker}';
    select pg_sleep(greatest(0, extract(epoch from (
      (select crosses_at + interval '500 milliseconds'
        from public.test_booking_request_time_boundary_fixture
        where label = '${label}') - clock_timestamp()
    ))));
  `);
  await waitForMarker(blocker, blockerMarker);
  const finalizerName = `rc-booking-request-${label}-finalizer`;
  const finalizer = startSession(
    `
    set application_name = '${finalizerName}';
    begin;
    set local role service_role;
    select public.finalize_booking_request_submission(attempt_id, payment_snapshot)
    from public.test_booking_request_time_boundary_fixture
    where label = '${label}';
    commit;
  `,
    true,
  );
  await waitForLock(finalizerName, finalizer);
  await finishSession(blocker, { action: "rollback" });
  await finishSession(finalizer, { expectedState: "RC409" });
  if (!finalizer.stderr.includes(expectedMessage)) {
    throw new Error(
      `The ${label} finalization failed for the wrong reason: ${finalizer.stderr}`,
    );
  }
  const retainedState = runSql(`
    select
      (select count(*)
       from public.booking_request_submission_attempts attempts
       join public.test_booking_request_time_boundary_fixture fixture
         on fixture.attempt_id = attempts.id
       where fixture.label = '${label}'
         and attempts.state = 'authorized'
         and attempts.payment_snapshot = fixture.payment_snapshot
         and attempts.booking_request_id is null),
      (select count(*) from public.booking_requests
       where customer_user_id = '${customerId}'),
      (select count(*) from public.cottage_booking_period_commitments
       where customer_user_id = '${customerId}'),
      (select count(*)
       from public.booking_request_provider_operation_identities identities
       join public.test_booking_request_time_boundary_fixture fixture
         on fixture.attempt_id = identities.attempt_id
       where fixture.label = '${label}'
         and identities.operation_kind = 'authorization');
  `);
  if (retainedState !== "1|0|0|1") {
    throw new Error(
      `The ${label} overlap failure did not preserve one releasable authorization without a request or hold: ${retainedState}`,
    );
  }
}

function verifyCutoffExpiryRelease(label) {
  runSql(`
    drop table if exists public.test_booking_request_cutoff_stale_work;
    update public.booking_request_authorization_claims claims
    set reconciliation_expires_at = clock_timestamp() - interval '1 second'
    from public.test_booking_request_time_boundary_fixture fixture
    where fixture.label = '${label}'
      and claims.attempt_id = fixture.attempt_id;
    create table public.test_booking_request_cutoff_stale_work (
      result jsonb not null
    );
    grant select, insert on public.test_booking_request_cutoff_stale_work
      to service_role;
    set role service_role;
    insert into public.test_booking_request_cutoff_stale_work
    select public.dequeue_booking_request_authorization_reconciliation();
    select public.expire_booking_request_authorization_claims();
    reset role;
  `);
  const releaseState = runSql(`
    select attempts.state, claims.state::text, occupancies.active,
      outbox.state, attempts.payment_snapshot -> 'release' ->> 'status',
      outbox.lease_token is null,
      (select count(*) from public.booking_requests
        where customer_user_id = '${customerId}'),
      (select count(*) from public.cottage_booking_period_commitments
        where customer_user_id = '${customerId}')
    from public.test_booking_request_time_boundary_fixture fixture
    join public.booking_request_submission_attempts attempts
      on attempts.id = fixture.attempt_id
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id
    where fixture.label = '${label}';
  `);
  if (releaseState !== "releasing|releasing|t|pending|pending|t|0|0") {
    throw new Error(
      `Cut-off expiry did not preserve inventory around a recoverable release: ${releaseState}`,
    );
  }
  const staleCompletion = runSql(`
    set role service_role;
    select public.complete_booking_request_authorization_reconciliation(
      (work.result ->> 'claimId')::uuid,
      (work.result ->> 'generation')::integer,
      (work.result ->> 'stateRevision')::bigint,
      (work.result ->> 'leaseToken')::uuid,
      fixture.payment_snapshot,
      '{"provider":"test-payments","environment":"local-test","merchantId":"concurrency-merchant","terminalId":"concurrency-terminal"}'::jsonb
    ) ->> 'status'
    from public.test_booking_request_cutoff_stale_work work
    cross join public.test_booking_request_time_boundary_fixture fixture
    where fixture.label = '${label}';
    reset role;
  `);
  if (staleCompletion !== "conflict") {
    throw new Error(
      `A stale pre-cut-off worker overwrote the release transition: ${staleCompletion}`,
    );
  }
  runSql(`drop table public.test_booking_request_cutoff_stale_work;`);
}

const cleanup = `
  create table if not exists public.test_booking_request_concurrency_fixture (
    profile_id uuid, schedule_id uuid, shift_id uuid, slug text,
    position smallint, service_day date, submission jsonb,
    attempt_id uuid, payment_snapshot jsonb, base_service_day date,
    base_submission jsonb, original_start_time time, original_end_time time
  );
  create table if not exists public.test_booking_request_cross_cottage_fixture (
    profile_id uuid, schedule_id uuid, shift_id uuid, position smallint,
    service_day date, base_service_day date,
    original_start_time time, original_end_time time
  );
  drop table if exists public.test_booking_request_payment_cas_fixture;
  drop table if exists public.test_booking_request_time_boundary_fixture;
  drop table if exists public.test_booking_request_reconciliation_work;
  drop table if exists public.test_booking_request_durable_operation;
  drop table if exists public.test_booking_request_expiry_stale_work;
  drop table if exists public.test_booking_request_cutoff_stale_work;
  drop table if exists public.test_booking_request_boundary_durable_operation;
  delete from public.booking_request_provider_operation_identities identities
  using public.booking_request_submission_attempts attempts
  where identities.attempt_id = attempts.id
    and attempts.customer_user_id = '${customerId}';
  delete from public.simulated_payment_provider_operations operations
  using public.booking_request_authorization_claims claims
  where claims.customer_user_id = '${customerId}'
    and operations.claim_id = claims.id;
  delete from public.booking_request_authorization_reconciliation_outbox outbox
  using public.booking_request_authorization_claims claims
  where claims.customer_user_id = '${customerId}' and outbox.claim_id = claims.id;
  delete from public.booking_request_authorization_claim_occupancies occupancies
  using public.booking_request_authorization_claims claims
  where claims.customer_user_id = '${customerId}' and occupancies.claim_id = claims.id;
  delete from public.booking_request_authorization_claim_items items
  using public.booking_request_authorization_claims claims
  where claims.customer_user_id = '${customerId}' and items.claim_id = claims.id;
  delete from public.booking_request_authorization_claims
  where customer_user_id = '${customerId}';
  delete from public.cottage_inventory_availability availability
  using public.test_booking_request_concurrency_fixture fixture
  where availability.schedule_revision_id = fixture.schedule_id
    and availability.unit_kind = 'shift'
    and availability.unit_id = fixture.shift_id
      and availability.service_day = fixture.service_day;
  delete from public.cottage_inventory_availability availability
  using public.test_booking_request_cross_cottage_fixture fixture
  where availability.schedule_revision_id = fixture.schedule_id
    and availability.unit_kind = 'shift'
    and availability.unit_id = fixture.shift_id
    and availability.service_day = fixture.service_day;
  alter table public.cottage_shifts
    disable trigger reject_cottage_shift_update;
  update public.cottage_shifts shifts
  set start_time = fixture.original_start_time,
    end_time = fixture.original_end_time
  from public.test_booking_request_concurrency_fixture fixture
  where shifts.id = fixture.shift_id
    and fixture.original_start_time is not null
    and fixture.original_end_time is not null;
  update public.cottage_shifts shifts
  set start_time = fixture.original_start_time,
    end_time = fixture.original_end_time
  from public.test_booking_request_cross_cottage_fixture fixture
  where shifts.id = fixture.shift_id
    and fixture.original_start_time is not null
    and fixture.original_end_time is not null;
  alter table public.cottage_shifts
    enable trigger reject_cottage_shift_update;
  alter table public.booking_snapshots disable trigger reject_booking_snapshot_update;
  delete from public.owner_request_notifications where booking_request_id in (
    select id from public.booking_requests where customer_user_id = '${customerId}'
  );
  delete from public.booking_request_provider_operation_identities identities
  using public.booking_request_submission_attempts attempts
  where identities.attempt_id = attempts.id
    and attempts.customer_user_id = '${customerId}';
  delete from public.booking_request_authorization_reconciliation_outbox outbox
  using public.booking_request_authorization_claims claims
  where claims.customer_user_id = '${customerId}' and outbox.claim_id = claims.id;
  delete from public.booking_request_authorization_claim_occupancies occupancies
  using public.booking_request_authorization_claims claims
  where claims.customer_user_id = '${customerId}' and occupancies.claim_id = claims.id;
  delete from public.booking_request_authorization_claim_items items
  using public.booking_request_authorization_claims claims
  where claims.customer_user_id = '${customerId}' and items.claim_id = claims.id;
  delete from public.booking_request_authorization_claims
  where customer_user_id = '${customerId}';
  delete from public.booking_request_submission_attempts where customer_user_id = '${customerId}';
  delete from public.booking_requests where customer_user_id = '${customerId}';
  delete from public.booking_snapshots where customer_user_id = '${customerId}';
  alter table public.booking_snapshots enable trigger reject_booking_snapshot_update;
  delete from public.cottage_inventory_commitments where booking_period_commitment_id in (
    select id from public.cottage_booking_period_commitments where customer_user_id = '${customerId}'
  );
  delete from public.cottage_booking_period_occupancies where booking_period_commitment_id in (
    select id from public.cottage_booking_period_commitments where customer_user_id = '${customerId}'
  );
  delete from public.cottage_booking_period_commitments where customer_user_id = '${customerId}';
  delete from public.account_contexts where user_id = '${customerId}';
  delete from auth.users where id = '${customerId}';
  drop table if exists public.test_booking_request_concurrency_fixture;
  drop table if exists public.test_booking_request_cross_cottage_fixture;
`;

async function main() {
  guardDisposableLocalDatabase();
  runSql(cleanup);
  runSql(`
    insert into auth.users (id, aud, role, phone, phone_confirmed_at)
    values ('${customerId}', 'authenticated', 'authenticated', '+9647500097032', now());
    insert into public.account_contexts (user_id, role)
    values ('${customerId}', 'customer');
    create table public.test_booking_request_concurrency_fixture as
      select profiles.id as profile_id,
        profiles.current_shift_schedule_id as schedule_id,
        shifts.id as shift_id,
        'cottage-' || replace(profiles.id::text, '-', '') as slug,
        shifts.position, current_date + 30 as service_day,
        current_date + 30 as base_service_day,
        shifts.start_time as original_start_time,
        shifts.end_time as original_end_time,
        null::jsonb as submission
      from public.cottage_marketplace_listings listings
      join public.owner_application_cottage_profiles profiles
        on profiles.id = listings.profile_id
      join public.cottage_shifts shifts
        on shifts.schedule_revision_id = profiles.current_shift_schedule_id
      join public.cottage_publication_snapshots publications
        on publications.id = profiles.current_publication_id
        and publications.profile_id = profiles.id
        and publications.capacity >= 2
      join public.cottage_publication_localizations localizations
        on localizations.publication_id = publications.id
        and localizations.locale = 'en'
      where listings.state = 'published'
        and public.is_cottage_publicly_discoverable(profiles.id)
      order by profiles.id, shifts.position
      limit 1;
    alter table public.test_booking_request_concurrency_fixture
      add column attempt_id uuid,
      add column payment_snapshot jsonb,
      add column base_submission jsonb;
    create table public.test_booking_request_cross_cottage_fixture as
      select profiles.id as profile_id,
        profiles.current_shift_schedule_id as schedule_id,
        shifts.id as shift_id,
        shifts.position,
        current_date + 30 as service_day,
        current_date + 30 as base_service_day,
        shifts.start_time as original_start_time,
        shifts.end_time as original_end_time
      from public.cottage_marketplace_listings listings
      join public.owner_application_cottage_profiles profiles
        on profiles.id = listings.profile_id
      join public.cottage_shifts shifts
        on shifts.schedule_revision_id = profiles.current_shift_schedule_id
      join public.cottage_publication_snapshots publications
        on publications.id = profiles.current_publication_id
        and publications.profile_id = profiles.id
        and publications.capacity >= 2
      join public.cottage_publication_localizations localizations
        on localizations.publication_id = publications.id
        and localizations.locale = 'en'
      where listings.state = 'published'
        and public.is_cottage_publicly_discoverable(profiles.id)
        and profiles.id <> (
          select profile_id from public.test_booking_request_concurrency_fixture
        )
      order by profiles.id, shifts.position
      limit 1;
    grant select, update on public.test_booking_request_concurrency_fixture to service_role;
    grant select on public.test_booking_request_cross_cottage_fixture to service_role;
    insert into public.cottage_inventory_availability (
      schedule_revision_id, unit_kind, unit_id, service_day, state
    ) select schedule_id, 'shift', shift_id, service_day, 'open'
      from public.test_booking_request_concurrency_fixture
    on conflict (schedule_revision_id, unit_kind, unit_id, service_day)
      do update set state = 'open';
    insert into public.cottage_inventory_availability (
      schedule_revision_id, unit_kind, unit_id, service_day, state
    ) select schedule_id, 'shift', shift_id, service_day, 'open'
      from public.test_booking_request_cross_cottage_fixture
    on conflict (schedule_revision_id, unit_kind, unit_id, service_day)
      do update set state = 'open';
    update public.test_booking_request_concurrency_fixture fixture
    set submission = resolved.submission
    from (
      with request as (
        select candidate.*,
        jsonb_build_object(
          'from', service_day, 'to', service_day, 'guests', 2,
          'amenities', jsonb_build_array(),
          'selections', jsonb_build_array(jsonb_build_object(
            'serviceDay', service_day, 'kind', 'shift', 'position', position
          ))
        ) as search
        from public.test_booking_request_concurrency_fixture candidate
      ), quoted as (
        select request.*,
          public.get_public_booking_quote_with_fingerprint('en', slug, search) as quote
        from request
      )
      select profile_id, jsonb_build_object(
      'locale', 'en', 'publicSlug', slug, 'discoveryQuery', search,
      'quoteFingerprint', quote ->> 'quoteFingerprint',
      'contentVersion', (quote ->> 'contentVersion')::integer,
      'termsVersion', quote ->> 'termsVersion',
      'bookingPriceIqd', (quote ->> 'bookingPriceIqd')::bigint,
      'serviceFeeIqd', (quote ->> 'serviceFeeIqd')::bigint,
      'customerTotalIqd', (quote ->> 'customerTotalIqd')::bigint,
      'firstStartsAt', quote -> 'items' -> 0 ->> 'startsAt',
      'intent', jsonb_build_object(
        'customerName', 'Concurrency Customer', 'partySize', 2,
        'acceptedHouseRules', true, 'acceptedCancellationPolicy', true,
        'acceptedMarketplaceTerms', true,
        'acceptedInside48HourNoRefund', true,
        'cancellationPolicyVersion', 'rentcottage-mvp-2026-08-04',
        'acceptanceEvidence', public.booking_request_acceptance_evidence(
          'en', quote ->> 'termsVersion', false
        )
      )
      ) as submission
      from quoted where quote ->> 'status' = 'quoted'
    ) resolved
    where fixture.profile_id = resolved.profile_id;
    update public.test_booking_request_concurrency_fixture
    set base_submission = submission;
    create table public.test_booking_request_time_boundary_fixture (
      label text primary key,
      crosses_at timestamptz not null,
      prepare_result jsonb not null,
      attempt_id uuid,
      payment_snapshot jsonb
    );
    grant select on public.test_booking_request_time_boundary_fixture to service_role;
  `);
  if (
    runSql(
      "select count(*) from public.test_booking_request_concurrency_fixture where submission is not null;",
    ) !== "1"
  ) {
    throw new Error(
      "No isolated Booking Request concurrency fixture was available.",
    );
  }
  if (
    runSql(
      "select count(*) from public.test_booking_request_cross_cottage_fixture;",
    ) !== "1"
  ) {
    throw new Error(
      "No second isolated Cottage was available for the cross-cottage overlap observer.",
    );
  }

  prepareBoundaryAttempt({
    authorize: false,
    boundaryHours: 6,
    idempotencyKey: "11111111-1111-4111-8111-111111119716",
    label: "preauth-six-hour",
    providerSuffix: "unused-preauth-six-hour",
  });
  await verifyLockDelayedPreparationBoundary({
    expectedStatus: "too-late",
    idempotencyKey: "11111111-1111-4111-8111-111111119716",
    label: "preauth-six-hour",
  });
  removeBoundaryAttempt("preauth-six-hour");
  restoreBaseBookingWindow();

  prepareBoundaryAttempt({
    authorize: false,
    boundaryHours: 48,
    idempotencyKey: "11111111-1111-4111-8111-111111119758",
    label: "preauth-inside-48-hour",
    providerSuffix: "unused-preauth-inside-48-hour",
  });
  await verifyLockDelayedPreparationBoundary({
    expectedStatus: "invalid",
    idempotencyKey: "11111111-1111-4111-8111-111111119758",
    label: "preauth-inside-48-hour",
  });
  removeBoundaryAttempt("preauth-inside-48-hour");
  restoreBaseBookingWindow();

  prepareBoundaryAttempt({
    boundaryHours: 6,
    idempotencyKey: "11111111-1111-4111-8111-111111119706",
    label: "six-hour",
    providerSuffix: "six-hour",
  });
  await verifyPostAuthorizationPolicyBoundary({
    expectedMessage: "Booking Request Cut-Off has passed",
    label: "six-hour",
  });
  verifyCutoffExpiryRelease("six-hour");
  removeBoundaryAttempt("six-hour");
  restoreBaseBookingWindow();

  prepareBoundaryAttempt({
    boundaryHours: 48,
    idempotencyKey: "11111111-1111-4111-8111-111111119748",
    label: "inside-48-hour",
    providerSuffix: "inside-48-hour",
  });
  await verifyPostAuthorizationPolicyBoundary({
    expectedMessage: "Booking acceptance evidence changed before finalization",
    label: "inside-48-hour",
  });
  removeBoundaryAttempt("inside-48-hour");
  restoreBaseBookingWindow();

  const authorization = startSession(`
    set application_name = 'rc-booking-request-first';
    begin;
    set local role service_role;
    create temporary table prepared as select ${prepareSql("11111111-1111-4111-8111-111111119701")} as result;
    create temporary table authorized as select jsonb_build_object(
      'paymentLifecycleId', result ->> 'paymentLifecycleId', 'currency', 'IQD',
      'bookingPriceFils', ((select submission ->> 'bookingPriceIqd' from public.test_booking_request_concurrency_fixture)::bigint * 1000),
      'bookingServiceFeeFils', ((select submission ->> 'serviceFeeIqd' from public.test_booking_request_concurrency_fixture)::bigint * 1000),
      'customerTotalFils', ((select submission ->> 'customerTotalIqd' from public.test_booking_request_concurrency_fixture)::bigint * 1000),
      'authorization', jsonb_build_object(
        'paymentLifecycleId', result ->> 'paymentLifecycleId', 'kind', 'authorization',
        'logicalOperationId', (result ->> 'paymentLifecycleId') || ':authorization',
        'attemptId', (result ->> 'paymentLifecycleId') || ':authorization:attempt-1',
        'status', 'succeeded',
        'amountFils', ((select submission ->> 'customerTotalIqd' from public.test_booking_request_concurrency_fixture)::bigint * 1000),
        'providerRequestId', 'concurrency-provider-request',
        'providerReference', 'concurrency-provider-reference',
        'movementReference', 'concurrency-movement',
        'reconciliationRequired', false, 'retrySafe', false
      ),
      'capture', null, 'release', null, 'refunds', jsonb_build_array(),
      'financials', jsonb_build_object(
        'refundedBookingPriceFils', 0, 'refundedBookingServiceFeeFils', 0,
        'remainingBookingPriceFils', ((select submission ->> 'bookingPriceIqd' from public.test_booking_request_concurrency_fixture)::bigint * 1000),
        'remainingBookingServiceFeeFils', ((select submission ->> 'serviceFeeIqd' from public.test_booking_request_concurrency_fixture)::bigint * 1000),
        'marketplaceCommissionFils', ((select submission ->> 'bookingPriceIqd' from public.test_booking_request_concurrency_fixture)::bigint * 100),
        'ownerEntitlementFils', ((select submission ->> 'bookingPriceIqd' from public.test_booking_request_concurrency_fixture)::bigint * 900)
      ),
      'payout', jsonb_build_object(
        'status', 'not_eligible',
        'eligibleFils', ((select submission ->> 'bookingPriceIqd' from public.test_booking_request_concurrency_fixture)::bigint * 900),
        'paidFils', 0, 'providerFeeFils', 0, 'providerReserveFils', 0,
        'recoveryExposureFils', 0, 'recoveryBalanceFils', 0,
        'automaticOwnerDebitFils', 0, 'paidWhileBlocked', false, 'settlement', null
      ),
      'holds', jsonb_build_object('administrator', false, 'dispute', false),
      'dispute', null, 'audits', jsonb_build_array(),
      'movements', jsonb_build_array(jsonb_build_object(
        'kind', 'authorization',
        'logicalOperationId', (result ->> 'paymentLifecycleId') || ':authorization',
        'attemptId', (result ->> 'paymentLifecycleId') || ':authorization:attempt-1',
        'amountFils', ((select submission ->> 'customerTotalIqd' from public.test_booking_request_concurrency_fixture)::bigint * 1000),
        'movementReference', 'concurrency-movement',
        'recordedAt', '2099-01-01T00:00:00.000Z'
      ))
    ) as snapshot from prepared;
    create temporary table authorization_pending as
    select result, snapshot || jsonb_build_object(
      'authorization', (snapshot -> 'authorization') || jsonb_build_object(
        'status', 'pending', 'providerRequestId', null,
        'providerReference', null, 'movementReference', null
      ),
      'movements', jsonb_build_array()
    ) as snapshot
    from prepared cross join authorized;
    select public.begin_booking_request_authorization_claim(
      (result ->> 'attemptId')::uuid,
      snapshot,
      '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    ) from authorization_pending;
    update public.test_booking_request_concurrency_fixture
    set attempt_id = (select (result ->> 'attemptId')::uuid from prepared),
      payment_snapshot = (select snapshot from authorized);
    select '${authorizationMarker}';
  `);
  await waitForMarker(authorization, authorizationMarker);
  const crossCottageClaimContenderName =
    "rc-booking-request-cross-cottage-claim-contender";
  const crossCottageClaimContender = startSession(
    `
    set application_name = '${crossCottageClaimContenderName}';
    begin;
    set local role service_role;
    select public.create_pending_booking_period_hold(
      '${customerId}', fixture.profile_id, 'RC-CROSS-COTTAGE-CLAIM-CONTENDER',
      jsonb_build_object(
        'from', fixture.service_day, 'to', fixture.service_day, 'guests', 2,
        'amenities', jsonb_build_array(),
        'selections', jsonb_build_array(jsonb_build_object(
          'serviceDay', fixture.service_day, 'kind', 'shift',
          'position', fixture.position
        ))
      )
    )
    from public.test_booking_request_cross_cottage_fixture fixture;
    commit;
  `,
    true,
  );
  await waitForLock(crossCottageClaimContenderName, crossCottageClaimContender);
  await finishSession(authorization, { action: "commit" });
  await finishSession(crossCottageClaimContender, { expectedState: "RC409" });

  runSql(`
    create table public.test_booking_request_durable_operation as
    select jsonb_build_object(
      'providerIdentity', jsonb_build_object(
        'provider', claims.provider,
        'environment', claims.environment,
        'merchantId', claims.merchant_id,
        'terminalId', claims.terminal_id
      ),
      'idempotencyKey', claims.provider_idempotency_key,
      'requestFingerprint', repeat('d', 64),
      'paymentLifecycleId', claims.payment_lifecycle_id,
      'logicalOperationId', claims.logical_operation_id,
      'physicalAttemptId', claims.physical_attempt_id,
      'operationKind', 'authorization',
      'amountFils', claims.amount_fils,
      'currency', claims.currency,
      'claimId', claims.id,
      'claimGeneration', claims.generation
    ) as operation
    from public.booking_request_authorization_claims claims
    where claims.attempt_id = (
      select attempt_id from public.test_booking_request_concurrency_fixture
    );
    grant select on public.test_booking_request_durable_operation to service_role;
  `);
  const firstDurableExecution = startSession(`
    set application_name = 'rc-booking-request-durable-execution-first';
    begin;
    set local role service_role;
    select public.execute_simulated_payment_provider_operation(
      operation, 'succeeded'
    ) ->> 'outcome'
    from public.test_booking_request_durable_operation;
    select 'RC_BOOKING_REQUEST_DURABLE_EXECUTION_LOCKED';
  `);
  await waitForMarker(
    firstDurableExecution,
    "RC_BOOKING_REQUEST_DURABLE_EXECUTION_LOCKED",
  );
  const duplicateDurableExecution = startSession(
    `
    set application_name = '${durableExecutionContenderName}';
    begin;
    set local role service_role;
    select public.execute_simulated_payment_provider_operation(
      operation, 'succeeded'
    ) ->> 'outcome'
    from public.test_booking_request_durable_operation;
    commit;
  `,
    true,
  );
  await waitForLock(durableExecutionContenderName, duplicateDurableExecution);
  await finishSession(firstDurableExecution, { action: "commit" });
  await finishSession(duplicateDurableExecution);
  const durableLedgerCounts = runSql(`
    select
      (select count(*)::integer
        from public.simulated_payment_provider_operations operations
        join public.booking_request_authorization_claims claims
          on claims.id = operations.claim_id
        where claims.attempt_id = (
          select attempt_id from public.test_booking_request_concurrency_fixture
        )),
      (select sum(physical_execution_count)::integer
        from public.simulated_payment_provider_operations operations
        join public.booking_request_authorization_claims claims
          on claims.id = operations.claim_id
        where claims.attempt_id = (
          select attempt_id from public.test_booking_request_concurrency_fixture
        ));
  `);
  const durableReconciliationOutcome = runSql(`
    set role service_role;
    select public.query_simulated_payment_provider_operation(
      (select operation from public.test_booking_request_durable_operation),
      null, null, 'succeeded'
    ) ->> 'outcome';
    reset role;
  `);
  if (
    durableLedgerCounts !== "1|1" ||
    durableReconciliationOutcome !== "succeeded"
  ) {
    throw new Error(
      `Concurrent durable reconciliation was not exactly-once: ${durableLedgerCounts}|${durableReconciliationOutcome}`,
    );
  }
  runSql(`
    update public.test_booking_request_concurrency_fixture fixture
    set payment_snapshot = fixture.payment_snapshot || jsonb_build_object(
      'authorization', (fixture.payment_snapshot -> 'authorization') ||
        jsonb_build_object(
          'providerRequestId', operations.provider_request_id,
          'providerReference', operations.provider_reference,
          'movementReference', operations.movement_reference
        ),
      'movements', jsonb_build_array(jsonb_build_object(
        'kind', 'authorization',
        'logicalOperationId', fixture.payment_snapshot -> 'authorization' ->> 'logicalOperationId',
        'attemptId', fixture.payment_snapshot -> 'authorization' ->> 'attemptId',
        'amountFils', fixture.payment_snapshot -> 'authorization' -> 'amountFils',
        'movementReference', operations.movement_reference,
        'recordedAt', '2099-01-01T00:00:00.000Z'
      ))
    )
    from public.simulated_payment_provider_operations operations
    where operations.claim_id = (
      select claims.id
      from public.booking_request_authorization_claims claims
      where claims.attempt_id = fixture.attempt_id
    ) and operations.operation_kind = 'authorization';
  `);

  runSql(`
    create table public.test_booking_request_reconciliation_work (result jsonb not null);
    grant select, insert on public.test_booking_request_reconciliation_work to service_role;
    set role service_role;
    insert into public.test_booking_request_reconciliation_work
    select public.dequeue_booking_request_authorization_reconciliation();
    reset role;
  `);
  const inlinePersistence = startSession(`
    set application_name = 'rc-booking-request-inline-persistence';
    begin;
    set local role service_role;
    select public.save_booking_request_payment_snapshot(
      attempt_id, payment_snapshot,
      '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    ) from public.test_booking_request_concurrency_fixture;
    select '${inlinePersistenceMarker}';
  `);
  await waitForMarker(inlinePersistence, inlinePersistenceMarker);
  const outboxCompletion = startSession(
    `
    set application_name = '${outboxCompletionName}';
    begin;
    set local role service_role;
    select public.complete_booking_request_authorization_reconciliation(
      (work.result ->> 'claimId')::uuid,
      (work.result ->> 'generation')::integer,
      (work.result ->> 'stateRevision')::bigint,
      (work.result ->> 'leaseToken')::uuid,
      fixture.payment_snapshot,
      '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    ) ->> 'status'
    from public.test_booking_request_reconciliation_work work
    cross join public.test_booking_request_concurrency_fixture fixture;
    commit;
  `,
    true,
  );
  await waitForLock(outboxCompletionName, outboxCompletion);
  await finishSession(inlinePersistence, { action: "commit" });
  await finishSession(outboxCompletion);
  if (!outboxCompletion.stdout.includes("conflict")) {
    throw new Error(
      `Concurrent outbox completion did not lose the monotonic CAS: ${outboxCompletion.stdout}`,
    );
  }
  if (
    runSql(`
      select count(*)
      from public.booking_request_submission_attempts attempts
      join public.booking_request_authorization_claims claims
        on claims.attempt_id = attempts.id
      where attempts.id = (
          select attempt_id from public.test_booking_request_concurrency_fixture
        )
        and attempts.state = 'authorized'
        and attempts.payment_snapshot = (
          select payment_snapshot from public.test_booking_request_concurrency_fixture
        )
        and claims.state = 'authorized';
    `) !== "1"
  ) {
    throw new Error(
      "Concurrent inline persistence and outbox completion did not retain one authorized result.",
    );
  }
  runSql(`drop table public.test_booking_request_reconciliation_work;`);

  runSql(`
    create table public.test_booking_request_release_retry_fixture as
    select fixture.attempt_id, fixture.payment_snapshot as authorized_snapshot,
      fixture.payment_snapshot || jsonb_build_object(
        'release', jsonb_build_object(
          'paymentLifecycleId', fixture.payment_snapshot ->> 'paymentLifecycleId',
          'kind', 'release',
          'logicalOperationId', (fixture.payment_snapshot ->> 'paymentLifecycleId') || ':release',
          'attemptId', (fixture.payment_snapshot ->> 'paymentLifecycleId') || ':release:attempt-2',
          'status', 'pending',
          'amountFils', fixture.payment_snapshot -> 'authorization' -> 'amountFils',
          'providerRequestId', null, 'providerReference', null,
          'movementReference', null,
          'reconciliationRequired', false, 'retrySafe', false
        )
      ) as pending_snapshot
    from public.test_booking_request_concurrency_fixture fixture;
    alter table public.test_booking_request_release_retry_fixture
      add column failed_snapshot jsonb;
    grant select on public.test_booking_request_release_retry_fixture to service_role;
    create table public.test_booking_request_failed_release_result (
      result jsonb not null
    );
    create table public.test_booking_request_failed_release_operation as
    select jsonb_build_object(
      'providerIdentity', jsonb_build_object(
        'provider', claims.provider,
        'environment', claims.environment,
        'merchantId', claims.merchant_id,
        'terminalId', claims.terminal_id
      ),
      'idempotencyKey', null,
      'requestFingerprint', repeat('d', 64),
      'paymentLifecycleId', claims.payment_lifecycle_id,
      'logicalOperationId', fixture.pending_snapshot -> 'release' ->> 'logicalOperationId',
      'physicalAttemptId', fixture.pending_snapshot -> 'release' ->> 'attemptId',
      'operationKind', 'release',
      'amountFils', claims.amount_fils,
      'currency', claims.currency,
      'claimId', null,
      'claimGeneration', null
    ) as operation
    from public.booking_request_authorization_claims claims
    join public.test_booking_request_release_retry_fixture fixture
      on fixture.attempt_id = claims.attempt_id;
    grant select, insert on public.test_booking_request_failed_release_result
      to service_role;
    grant select on public.test_booking_request_failed_release_operation
      to service_role;
    set role service_role;
    select public.save_booking_request_payment_snapshot(
      attempt_id, pending_snapshot,
      '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    ) from public.test_booking_request_release_retry_fixture;
    insert into public.test_booking_request_failed_release_result
    select public.execute_simulated_payment_provider_operation(
      operation, 'failed'
    ) from public.test_booking_request_failed_release_operation;
    reset role;
    update public.test_booking_request_release_retry_fixture fixture
    set failed_snapshot = fixture.pending_snapshot || jsonb_build_object(
      'release', (fixture.pending_snapshot -> 'release') || jsonb_build_object(
        'status', 'failed',
        'providerRequestId', provider.result ->> 'providerRequestId',
        'providerReference', provider.result ->> 'providerReference',
        'movementReference', null,
        'reconciliationRequired', false,
        'retrySafe', true
      )
    )
    from public.test_booking_request_failed_release_result provider;
    set role service_role;
    select public.save_booking_request_payment_snapshot(
      attempt_id, failed_snapshot,
      '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    ) from public.test_booking_request_release_retry_fixture;
    reset role;
    create table public.test_booking_request_first_release_retry_work (
      result jsonb not null
    );
    create table public.test_booking_request_recovered_release_retry_work (
      result jsonb not null
    );
    grant select, insert on public.test_booking_request_first_release_retry_work,
      public.test_booking_request_recovered_release_retry_work to service_role;
  `);
  const releaseRetryOwner = startSession(`
    set application_name = '${releaseRetryOwnerName}';
    begin;
    set local role service_role;
    insert into public.test_booking_request_first_release_retry_work
    select public.dequeue_booking_request_authorization_reconciliation();
    select '${releaseRetryMarker}';
  `);
  await waitForMarker(releaseRetryOwner, releaseRetryMarker);
  const releaseRetryContender = startSession(
    `
    set application_name = '${releaseRetryContenderName}';
    begin;
    set local role service_role;
    select public.dequeue_booking_request_authorization_reconciliation() ->> 'status';
    commit;
  `,
    true,
  );
  await finishSession(releaseRetryContender);
  await finishSession(releaseRetryOwner, { action: "commit" });
  if (!releaseRetryContender.stdout.includes("empty")) {
    throw new Error(
      `A concurrent release retry worker obtained the active lease: ${releaseRetryContender.stdout}`,
    );
  }
  runSql(`
    update public.booking_request_authorization_reconciliation_outbox
    set lease_expires_at = clock_timestamp() - interval '1 second'
    where claim_id = (
      select claims.id
      from public.booking_request_authorization_claims claims
      join public.test_booking_request_release_retry_fixture fixture
        on fixture.attempt_id = claims.attempt_id
    );
    set role service_role;
    insert into public.test_booking_request_recovered_release_retry_work
    select public.dequeue_booking_request_authorization_reconciliation();
    reset role;
  `);
  const releaseRetryEvidence = runSql(`
    select
      first.result ->> 'physicalAttemptId'
        = recovered.result ->> 'physicalAttemptId',
      first.result ->> 'leaseToken' <> recovered.result ->> 'leaseToken',
      recovered.result ->> 'recoveryAction',
      claims.state::text,
      occupancies.active,
      outbox.state,
      (select count(*) from public.simulated_payment_provider_operations operations
        where operations.claim_id = claims.id
          and operations.operation_kind = 'release'
          and operations.current_outcome = 'failed')
    from public.test_booking_request_first_release_retry_work first
    cross join public.test_booking_request_recovered_release_retry_work recovered
    join public.booking_request_authorization_claims claims
      on claims.id = (recovered.result ->> 'claimId')::uuid
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id;
  `);
  if (releaseRetryEvidence !== "t|t|execute|releasing|t|pending|1") {
    throw new Error(
      `Release retry lease recovery lost its binding or evidence: ${releaseRetryEvidence}`,
    );
  }
  const staleReleaseRetry = runSql(`
    set role service_role;
    select public.complete_booking_request_authorization_reconciliation(
      (work.result ->> 'claimId')::uuid,
      (work.result ->> 'generation')::integer,
      (work.result ->> 'stateRevision')::bigint,
      (work.result ->> 'leaseToken')::uuid,
      work.result -> 'paymentSnapshot',
      '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    ) ->> 'status'
    from public.test_booking_request_first_release_retry_work work;
    reset role;
  `);
  if (staleReleaseRetry !== "conflict") {
    throw new Error(
      `A stale failed-release worker retained its expired lease: ${staleReleaseRetry}`,
    );
  }
  runSql(`
    delete from public.simulated_payment_provider_operations operations
    using public.booking_request_authorization_claims claims,
      public.test_booking_request_release_retry_fixture fixture
    where claims.attempt_id = fixture.attempt_id
      and operations.claim_id = claims.id
      and operations.operation_kind = 'release';
    update public.booking_request_submission_attempts attempts
    set payment_snapshot = fixture.authorized_snapshot,
      state = 'authorized',
      release_provider_request_id = null,
      release_provider_reference = null,
      release_movement_reference = null
    from public.test_booking_request_release_retry_fixture fixture
    where attempts.id = fixture.attempt_id;
    update public.booking_request_authorization_claims claims
    set state = 'authorized', state_revision = state_revision + 1
    from public.test_booking_request_release_retry_fixture fixture
    where claims.attempt_id = fixture.attempt_id;
    update public.booking_request_authorization_reconciliation_outbox outbox
    set observed_state_revision = claims.state_revision,
      state = 'pending', lease_token = null, lease_expires_at = null
    from public.booking_request_authorization_claims claims,
      public.test_booking_request_release_retry_fixture fixture
    where claims.attempt_id = fixture.attempt_id and outbox.claim_id = claims.id;
    drop table public.test_booking_request_first_release_retry_work,
      public.test_booking_request_recovered_release_retry_work,
      public.test_booking_request_failed_release_result,
      public.test_booking_request_failed_release_operation,
      public.test_booking_request_release_retry_fixture;
  `);

  runSql(`
    insert into public.booking_request_submission_attempts (
      id, customer_user_id, idempotency_key, payment_lifecycle_id, profile_id,
      locale, public_slug, requested_search, quote_fingerprint, quote_payload,
      intent_fingerprint, intent_payload, state
    ) select
      '97200000-0000-4000-8000-000000000032', customer_user_id,
      '97300000-0000-4000-8000-000000000032',
      '97400000-0000-4000-8000-000000000032', profile_id,
      locale, public_slug, requested_search, quote_fingerprint, quote_payload,
      repeat('f', 64), intent_payload || '{"paymentCasFixture":true}'::jsonb,
      'authorizing'
    from public.booking_request_submission_attempts
    where id = (select attempt_id from public.test_booking_request_concurrency_fixture);
    create table public.test_booking_request_payment_cas_fixture as
    with source as (
      select attempts.id as attempt_id, attempts.payment_lifecycle_id,
        fixture.payment_snapshot as base_snapshot
      from public.booking_request_submission_attempts attempts
      cross join public.test_booking_request_concurrency_fixture fixture
      where attempts.id = '97200000-0000-4000-8000-000000000032'
    ), stale as (
      select attempt_id,
        base_snapshot || jsonb_build_object(
          'paymentLifecycleId', payment_lifecycle_id,
          'authorization', jsonb_build_object(
            'paymentLifecycleId', payment_lifecycle_id,
            'kind', 'authorization',
            'logicalOperationId', payment_lifecycle_id::text || ':authorization',
            'attemptId', payment_lifecycle_id::text || ':authorization:attempt-1',
            'status', 'succeeded',
            'amountFils', base_snapshot -> 'authorization' -> 'amountFils',
            'providerRequestId', 'cas-auth-request',
            'providerReference', 'cas-auth-reference',
            'movementReference', 'cas-auth-movement',
            'reconciliationRequired', false, 'retrySafe', false
          ),
          'release', null,
          'movements', jsonb_build_array(jsonb_build_object(
            'kind', 'authorization',
            'logicalOperationId', payment_lifecycle_id::text || ':authorization',
            'attemptId', payment_lifecycle_id::text || ':authorization:attempt-1',
            'amountFils', base_snapshot -> 'authorization' -> 'amountFils',
            'movementReference', 'cas-auth-movement',
            'recordedAt', '2099-01-01T00:00:00.000Z'
          ))
        ) as stale_snapshot,
        payment_lifecycle_id
      from source
    )
    select attempt_id, stale_snapshot,
      stale_snapshot || jsonb_build_object(
        'release', jsonb_build_object(
          'paymentLifecycleId', payment_lifecycle_id,
          'kind', 'release',
          'logicalOperationId', payment_lifecycle_id::text || ':release',
          'attemptId', payment_lifecycle_id::text || ':release:attempt-1',
          'status', 'succeeded',
          'amountFils', stale_snapshot -> 'authorization' -> 'amountFils',
          'providerRequestId', 'cas-release-request',
          'providerReference', 'cas-release-reference',
          'movementReference', 'cas-release-movement',
          'reconciliationRequired', false, 'retrySafe', false
        ),
        'movements', (stale_snapshot -> 'movements') || jsonb_build_array(
          jsonb_build_object(
            'kind', 'release',
            'logicalOperationId', payment_lifecycle_id::text || ':release',
            'attemptId', payment_lifecycle_id::text || ':release:attempt-1',
            'amountFils', stale_snapshot -> 'authorization' -> 'amountFils',
            'movementReference', 'cas-release-movement',
            'recordedAt', '2099-01-01T00:01:00.000Z'
          )
        )
      ) as released_snapshot
    from stale;
    grant select on public.test_booking_request_payment_cas_fixture to service_role;
  `);
  const newerPayment = startSession(`
    set application_name = 'rc-booking-request-payment-newer';
    begin;
    set local role service_role;
    select public.save_booking_request_payment_snapshot(
      attempt_id, released_snapshot,
      '{"provider":"test-payments","environment":"test","merchantId":"concurrency-merchant","terminalId":"concurrency-terminal"}'::jsonb
    ) from public.test_booking_request_payment_cas_fixture;
    select '${paymentCasMarker}';
  `);
  await waitForMarker(newerPayment, paymentCasMarker);
  const stalePayment = startSession(
    `
    set application_name = '${paymentCasContenderName}';
    begin;
    set local role service_role;
    select public.save_booking_request_payment_snapshot(
      attempt_id, stale_snapshot,
      '{"provider":"test-payments","environment":"test","merchantId":"concurrency-merchant","terminalId":"concurrency-terminal"}'::jsonb
    ) from public.test_booking_request_payment_cas_fixture;
    commit;
  `,
    true,
  );
  await waitForLock(paymentCasContenderName, stalePayment);
  await finishSession(newerPayment, { action: "commit" });
  await finishSession(stalePayment, { expectedState: "RC409" });
  if (
    runSql(`
      select count(*)
      from public.booking_request_submission_attempts attempts
      join public.test_booking_request_payment_cas_fixture fixture
        on fixture.attempt_id = attempts.id
      where attempts.state = 'released'
        and attempts.payment_snapshot = fixture.released_snapshot;
    `) !== "1"
  ) {
    throw new Error(
      "A competing stale payment save regressed released evidence.",
    );
  }
  runSql(`
    delete from public.booking_request_provider_operation_identities
    where attempt_id = '97200000-0000-4000-8000-000000000032';
    delete from public.booking_request_submission_attempts
    where id = '97200000-0000-4000-8000-000000000032';
    drop table public.test_booking_request_payment_cas_fixture;
  `);

  const priceMutation = startSession(
    `
    set application_name = 'rc-booking-request-price-mutation';
    begin;
    select profiles.id
    from public.owner_application_cottage_profiles profiles
    where profiles.id = (select profile_id from public.test_booking_request_concurrency_fixture)
    for update;
    update public.cottage_inventory_standard_prices prices
    set price_iqd = price_iqd + 1000
    from public.owner_application_cottage_profiles profiles,
      public.cottage_shifts shifts
    where profiles.id = (select profile_id from public.test_booking_request_concurrency_fixture)
      and shifts.schedule_revision_id = profiles.current_shift_schedule_id
      and shifts.position = ((select submission -> 'discoveryQuery' -> 'selections' -> 0 ->> 'position'
        from public.test_booking_request_concurrency_fixture)::smallint)
      and prices.schedule_revision_id = shifts.schedule_revision_id
      and prices.unit_kind = 'shift'
      and prices.unit_id = shifts.id;
    commit;
  `,
    true,
  );
  await finishSession(priceMutation, { expectedState: "RC204" });
  if (
    runSql(
      `select count(*) from public.booking_requests where customer_user_id = '${customerId}';`,
    ) !== "0"
  ) {
    throw new Error(
      "A rejected claim-protected price change created a request.",
    );
  }

  runSql(`
    delete from public.booking_request_provider_operation_identities identities
    using public.test_booking_request_time_boundary_fixture fixture
    where identities.attempt_id = fixture.attempt_id;
    delete from public.booking_request_authorization_reconciliation_outbox outbox
    using public.booking_request_authorization_claims claims,
      public.test_booking_request_time_boundary_fixture fixture
    where claims.attempt_id = fixture.attempt_id and outbox.claim_id = claims.id;
    delete from public.booking_request_authorization_claim_occupancies occupancies
    using public.booking_request_authorization_claims claims,
      public.test_booking_request_time_boundary_fixture fixture
    where claims.attempt_id = fixture.attempt_id and occupancies.claim_id = claims.id;
    delete from public.booking_request_authorization_claim_items items
    using public.booking_request_authorization_claims claims,
      public.test_booking_request_time_boundary_fixture fixture
    where claims.attempt_id = fixture.attempt_id and items.claim_id = claims.id;
    delete from public.booking_request_authorization_claims claims
    using public.test_booking_request_time_boundary_fixture fixture
    where claims.attempt_id = fixture.attempt_id;
    delete from public.booking_request_submission_attempts attempts
    using public.test_booking_request_time_boundary_fixture fixture
    where attempts.id = fixture.attempt_id;
    delete from public.test_booking_request_time_boundary_fixture;
  `);

  const rolledBackFinalization = startSession(`
    set application_name = 'rc-booking-request-finalization-rollback';
    begin;
    set local role service_role;
    select public.finalize_booking_request_submission(attempt_id, payment_snapshot)
    from public.test_booking_request_concurrency_fixture;
    select 'RC_BOOKING_REQUEST_FINALIZATION_ROLLBACK_LOCKED';
  `);
  await waitForMarker(
    rolledBackFinalization,
    "RC_BOOKING_REQUEST_FINALIZATION_ROLLBACK_LOCKED",
  );
  const rollbackLookup = startSession(
    `
    set application_name = '${lookupRollbackName}';
    begin;
    set local role service_role;
    select public.lookup_booking_request_submission(attempt_id) ->> 'status'
    from public.test_booking_request_concurrency_fixture;
    commit;
  `,
    true,
  );
  await waitForLock(lookupRollbackName, rollbackLookup);
  await finishSession(rolledBackFinalization, { action: "rollback" });
  await finishSession(rollbackLookup);
  if (!rollbackLookup.stdout.includes("absent")) {
    throw new Error(
      `Lookup after rolled-back finalization was not absent: ${rollbackLookup.stdout}`,
    );
  }

  runSql(`
    update public.booking_request_authorization_claims claims
    set reconciliation_expires_at = clock_timestamp() - interval '1 second'
    where claims.attempt_id = (
      select attempt_id from public.test_booking_request_concurrency_fixture
    );
    create table public.test_booking_request_expiry_stale_work as
    select public.dequeue_booking_request_authorization_reconciliation() as result;
    grant select on public.test_booking_request_expiry_stale_work to service_role;
  `);
  const first = startSession(`
    set application_name = 'rc-booking-request-expiry-finalization';
    begin;
    set local role service_role;
    select public.expire_booking_request_authorization_claims();
    select '${finalizationMarker}';
  `);
  await waitForMarker(first, finalizationMarker);

  const committedLookup = startSession(
    `
    set application_name = '${lookupCommitName}';
    begin;
    set local role service_role;
    select public.lookup_booking_request_submission(attempt_id) ->> 'status'
    from public.test_booking_request_concurrency_fixture;
    commit;
  `,
    true,
  );
  await waitForLock(lookupCommitName, committedLookup);
  const expiryStaleCompletion = startSession(
    `
    set application_name = '${expiryStaleCompletionName}';
    begin;
    set local role service_role;
    select public.complete_booking_request_authorization_reconciliation(
      (work.result ->> 'claimId')::uuid,
      (work.result ->> 'generation')::integer,
      (work.result ->> 'stateRevision')::bigint,
      (work.result ->> 'leaseToken')::uuid,
      fixture.payment_snapshot,
      '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    ) ->> 'status'
    from public.test_booking_request_expiry_stale_work work
    cross join public.test_booking_request_concurrency_fixture fixture;
    commit;
  `,
    true,
  );
  await waitForLock(expiryStaleCompletionName, expiryStaleCompletion);
  const contender = startSession(
    `
    set application_name = '${contenderName}';
    begin;
    set local role service_role;
    select ${prepareSql("11111111-1111-4111-8111-111111119702")} ->> 'status';
    commit;
  `,
    true,
  );
  await waitForLock(contenderName, contender);
  await finishSession(first, { action: "commit" });
  await finishSession(committedLookup);
  await finishSession(expiryStaleCompletion);
  await finishSession(contender);
  if (!committedLookup.stdout.includes("pending")) {
    throw new Error(
      `Lookup after committed finalization was not Pending: ${committedLookup.stdout}`,
    );
  }
  if (!expiryStaleCompletion.stdout.includes("conflict")) {
    throw new Error(
      `Stale recovery completion overwrote expiry finalization: ${expiryStaleCompletion.stdout}`,
    );
  }
  if (!contender.stdout.includes("pending")) {
    throw new Error(
      `Concurrent unchanged intent did not recover Pending: ${contender.stdout}`,
    );
  }
  const counts = runSql(`
    select
      (select count(*) from public.booking_request_submission_attempts where customer_user_id = '${customerId}'),
      (select count(*) from public.booking_requests where customer_user_id = '${customerId}'),
      (select count(*) from public.cottage_booking_period_commitments where customer_user_id = '${customerId}'),
      (select count(*) from public.owner_request_notifications notifications
        join public.booking_requests requests on requests.id = notifications.booking_request_id
        where requests.customer_user_id = '${customerId}'),
      (select count(*) from public.booking_request_submission_attempts
        where customer_user_id = '${customerId}'
          and exists (
            select 1
            from public.simulated_payment_provider_operations operations
            join public.booking_request_authorization_claims claims
              on claims.id = operations.claim_id
            where claims.attempt_id =
                booking_request_submission_attempts.id
              and operations.provider_request_id =
                booking_request_submission_attempts.authorization_provider_request_id
          ));
  `);
  if (counts !== "1|1|1|1|1") {
    throw new Error(
      `Concurrent Booking Request effects were not singular: ${counts}`,
    );
  }
  console.log(
    "Booking Request concurrency passed: effects=1|1|1|1|1 (attempt|request|Pending Hold|owner notice|provider authorization); durable-ledger=two-fresh-executions-one-row-null-id-reconciled; release-retry-lease=one-owner-same-persisted-attempt-new-token-stale-worker-conflict; expiry-race=ledger-finalized-stale-lease-conflict; payment-CAS=stale-save-blocked-then-RC409; claim-protected-price=RC204; preauth-six-hour-lock=blocked-across-boundary-then-too-late-without-authorization; preauth-inside-48-hour-lock=blocked-across-boundary-then-invalid-without-authorization; postauth-six-hour-lock=blocked-across-boundary-then-RC409-release-prepared-stale-worker-conflict; postauth-inside-48-hour-lock=blocked-across-boundary-then-RC409-with-releasable-authorization; cross-cottage-overlap=blocked-on-customer-lock-then-RC409; authoritative lookup=waits-then-absent-on-rollback-and-pending-on-commit; same-intent contender=blocked-then-pending.",
  );
}

let failure;
try {
  await main();
} catch (error) {
  failure = error;
} finally {
  try {
    for (const session of activeSessions) {
      if (session.exit) continue;
      if (
        !session.child.stdin.destroyed &&
        !session.child.stdin.writableEnded
      ) {
        session.child.stdin.end("rollback;\n");
      } else {
        session.child.kill("SIGTERM");
      }
      await session.exited;
    }
    guardDisposableLocalDatabase();
    runSql(cleanup);
  } catch (cleanupError) {
    failure = failure
      ? new AggregateError(
          [failure, cleanupError],
          "Booking Request concurrency and cleanup failed.",
        )
      : cleanupError;
  }
}
if (failure) throw failure;
