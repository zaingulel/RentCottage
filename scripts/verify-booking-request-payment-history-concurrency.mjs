import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
import { captureCleanup } from "./lib/booking-fixture.mjs";

const harness = createLocalSupabaseConcurrencyHarness({
  timing: {
    check: "verify-booking-request-payment-history-concurrency",
    isolation: "serial",
  },
});
harness.markTimingPhase("setup");
// SQL arrangement mirrors admission, isolated effect, and explicit recording.
const paymentEvidenceSql =
  "-- BEGIN PAYMENT EVIDENCE FIXTURE\n" +
  readFileSync("supabase/fixtures/payment-evidence.sql", "utf8") +
  "\n-- END PAYMENT EVIDENCE FIXTURE\n";
const identity = {
  provider: "fictional-payments",
  environment: "local-test",
  merchantId: "fictional-merchant",
  terminalId: "fictional-terminal",
};
const fixture = readFileSync(
  "supabase/tests/database/booking_request_payment_correction.test.sql",
  "utf8",
)
  .split("-- BEGIN CAPTURE RECOVERY SOURCE")[1]
  .split("-- END CAPTURE RECOVERY SOURCE")[0];
const literal = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const sessions = [];
function fixtureFor(index) {
  const lifecycle = `73000000-0000-4000-8000-00000000${index}1`;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        provider: identity,
        kind: "capture",
        paymentLifecycleId: lifecycle,
        logicalOperationId: `${lifecycle}:capture`,
        attemptId: `${lifecycle}:capture:attempt-2`,
        amountFils: 115000000,
        currency: "IQD",
      }),
    )
    .digest("hex");
  return fixture
    .replaceAll("00000000100", `00000000${index}`)
    .replaceAll("750000100", `750000${index}`)
    .replaceAll("confirmation-auth-", `history-${index}-auth-`)
    .replaceAll("CONFIRMATION-HOLD-1", `HISTORY-HOLD-${index}`)
    .replaceAll(
      "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
      fingerprint,
    );
}
const historySql = (index) => `
  set local role authenticated;
  select 'HISTORY:' || public.get_administrator_booking_request_payment_history('RC-REQ-000000000000${index}1')::text;
  reset role;
  select 'SEQUENCES:' || jsonb_agg(sequence order by sequence)::text from public.booking_request_payment_history where payment_lifecycle_id='73000000-0000-4000-8000-00000000${index}1';
`;
const histories = (session) =>
  session.stdout
    .split("\n")
    .filter((line) => line.startsWith("HISTORY:"))
    .map((line) => JSON.parse(line.slice(8)));
const sequences = (session) =>
  session.stdout
    .split("\n")
    .filter((line) => line.startsWith("SEQUENCES:"))
    .map((line) => JSON.parse(line.slice(10)));

// Build one public authorization and resolve its indeterminate execution through the real query RPC.
export async function verifyProviderResolution(databaseHarness) {
  databaseHarness.markTimingPhase("setup");
  const setup = `begin;
  ${paymentEvidenceSql}
insert into auth.users (id, aud, role, phone, phone_confirmed_at) values
('00000000-0000-0000-0000-000000003201','authenticated','authenticated','+9647500003201',now()),
('00000000-0000-0000-0000-000000003202','authenticated','authenticated','+9647500003202',now()),
('00000000-0000-0000-0000-000000003203','authenticated','authenticated','+9647500003203',now());
insert into public.account_contexts (user_id, role, owner_approval_state) values
('00000000-0000-0000-0000-000000003201','cottage_owner','approved'),
('00000000-0000-0000-0000-000000003202','cottage_owner','suspended'),
('00000000-0000-0000-0000-000000003203','customer',null);

insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, amenities, source_language, description,
  house_rules, status
) values (
  '30000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003201',
  'Submission Cottage', 'Baghdad', 'Karrada', 'Private address',
  8, 3, 2, array['pool'], 'en', 'Description', 'No smoking', 'draft'
);
insert into public.cottage_shift_schedule_revisions (
  id, profile_id, revision, full_day_bundle_id
) values (
  '60000000-0000-4000-8000-000000003201',
  '30000000-0000-4000-8000-000000003201', 1,
  '61000000-0000-4000-8000-000000003201'
);
select set_config(
  'rentcottage.shift_schedule_write_revision_id',
  '60000000-0000-4000-8000-000000003201', true
);
insert into public.cottage_shifts (
  id, schedule_revision_id, position, name, start_time, end_time
) values
  (
    '62000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201', 1, 'Morning', '08:00', '12:00'
  ),
  (
    '62000000-0000-4000-8000-000000003202',
    '60000000-0000-4000-8000-000000003201', 2, 'Evening', '17:00', '23:00'
  );
select set_config('rentcottage.shift_schedule_write_revision_id', '', true);
update public.owner_application_cottage_profiles
set current_shift_schedule_id = '60000000-0000-4000-8000-000000003201'
where id = '30000000-0000-4000-8000-000000003201';

insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules, revision
) values (
  '63000000-0000-4000-8000-000000003201',
  '30000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003201',
  'en', 'Description', 'No smoking', 1
);
insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
) values (
  '64000000-0000-4000-8000-000000003201',
  '30000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003201',
  '63000000-0000-4000-8000-000000003201',
  'Submission Cottage', 'Baghdad', 'Karrada', 8, 3, 2,
  array['pool'], 1, 'approved', now()
);
insert into public.cottage_profile_localized_revisions (
  id, review_cycle_id, locale, revision, origin, description, house_rules
) values (
  '65000000-0000-4000-8000-000000003201',
  '64000000-0000-4000-8000-000000003201',
  'en', 1, 'owner_source', 'Description', 'No smoking'
);
insert into public.cottage_profile_publication_decisions (
  review_cycle_id, administrator_user_id, approved, reason
) values (
  '64000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003203', true, 'Approved fixture'
);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
) values (
  '66000000-0000-4000-8000-000000003201',
  '30000000-0000-4000-8000-000000003201',
  '64000000-0000-4000-8000-000000003201',
  1, 'Submission Cottage', 'Baghdad', 'Karrada', 8, 3, 2, array['pool']
);
insert into public.cottage_publication_localizations (
  publication_id, locale, localized_revision_id, description, house_rules
) values (
  '66000000-0000-4000-8000-000000003201', 'en',
  '65000000-0000-4000-8000-000000003201', 'Description', 'No smoking'
);
update public.owner_application_cottage_profiles
set current_publication_id = '66000000-0000-4000-8000-000000003201'
where id = '30000000-0000-4000-8000-000000003201';

insert into public.cottage_inventory_standard_prices (
  schedule_revision_id, unit_kind, unit_id, price_iqd
) values
  (
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003201', 100000
  ),
  (
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003202', 110000
  ),
  (
    '60000000-0000-4000-8000-000000003201', 'full_day_bundle',
    '61000000-0000-4000-8000-000000003201', 190000
  );
insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select schedule_revision_id, unit_kind, unit_id, service_day, 'open'
from public.cottage_inventory_standard_prices
cross join (values ('2099-08-21'::date), ('2099-08-22'::date)) days(service_day)
where schedule_revision_id = '60000000-0000-4000-8000-000000003201';

create temporary table submission_fixture as
select
  '{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":2}]}'::jsonb as search,
  public.get_public_booking_quote_with_fingerprint(
    'en', 'cottage-30000000000040008000000000003201',
    '{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":2}]}'::jsonb
  ) as quote;
grant select on submission_fixture to service_role;

create temporary table valid_submission as
select jsonb_build_object(
  'locale', 'en',
  'publicSlug', 'cottage-30000000000040008000000000003201',
  'discoveryQuery', search,
  'quoteFingerprint', quote ->> 'quoteFingerprint',
  'contentVersion', 1,
  'termsVersion', 'fictional-local-test-2026-08-22-v1',
  'bookingPriceIqd', 110000,
  'serviceFeeIqd', 5000,
  'customerTotalIqd', 115000,
  'firstStartsAt', '2099-08-21T17:00:00+03:00',
  'intent', jsonb_build_object(
    'customerName', 'Ava Hassan',
    'partySize', 4,
    'bookingNote', 'Please prepare the garden seating.',
    'acceptedHouseRules', true,
    'acceptedCancellationPolicy', true,
    'acceptedMarketplaceTerms', true,
    'acceptedInside48HourNoRefund', false,
    'cancellationPolicyVersion', 'rentcottage-mvp-2026-08-04',
    'acceptanceEvidence', jsonb_build_object(
      'locale', 'en',
      'cancellationPolicy', 'Cancel at least 48 hours before the first shift for a full refund. Cancellation inside 48 hours and no-shows receive no refund.',
      'cancellationAcceptance', 'I accept the cancellation policy.',
      'marketplaceTermsAcceptance', 'I accept the marketplace booking terms.',
      'inside48Warning', null,
      'inside48Acceptance', null
    )
  )
) as submission
from submission_fixture;
grant select on valid_submission to service_role;

create temporary table simulated_authorization_operation(operation jsonb);
grant select on simulated_authorization_operation to service_role;
create temp table history_reference(reference text, request_id uuid, lifecycle_id uuid, operation_id uuid);
do $history_fixture$
declare quote jsonb; declare submission jsonb; declare prepared jsonb;
declare customer_id uuid := '00000000-0000-0000-0000-000000003202';
declare attempt uuid; declare lifecycle text; declare pending jsonb; declare snapshot jsonb;
declare claimed jsonb; declare operation jsonb; declare outcome jsonb; declare finalized jsonb;
declare price_fils bigint; declare fee_fils bigint; declare total_fils bigint;
declare owned_request public.booking_requests; declare owned_operation_id uuid;
declare identity jsonb := ${literal(identity)};
begin
  select fixture.quote into strict quote from submission_fixture fixture;
  if quote ->> 'status' is distinct from 'quoted' then raise exception 'Expected a quoted Booking Period: %', quote; end if;
  select fixture.submission into strict submission from valid_submission fixture;
  price_fils := (submission ->> 'bookingPriceIqd')::bigint * 1000;
  fee_fils := (submission ->> 'serviceFeeIqd')::bigint * 1000;
  total_fils := (submission ->> 'customerTotalIqd')::bigint * 1000;

  perform set_config('role', 'service_role', true);
  prepared := public.prepare_booking_request_submission(customer_id, '11111111-1111-4111-8111-111111113201', submission);
  if prepared ->> 'status' is distinct from 'ready' then raise exception 'Expected a ready submission attempt: %', prepared; end if;
  attempt := (prepared ->> 'attemptId')::uuid;
  lifecycle := prepared ->> 'paymentLifecycleId';
  pending := jsonb_build_object('paymentLifecycleId', lifecycle, 'kind', 'authorization',
    'logicalOperationId', lifecycle || ':authorization', 'attemptId', lifecycle || ':authorization:attempt-1',
    'status', 'pending', 'amountFils', total_fils, 'providerRequestId', null, 'providerReference', null,
    'movementReference', null, 'reconciliationRequired', false, 'retrySafe', false);
  snapshot := jsonb_build_object('paymentLifecycleId', lifecycle, 'currency', 'IQD',
    'bookingPriceFils', price_fils, 'bookingServiceFeeFils', fee_fils, 'customerTotalFils', total_fils,
    'authorization', pending, 'capture', null, 'release', null, 'refunds', jsonb_build_array(),
    'financials', jsonb_build_object('refundedBookingPriceFils', 0, 'refundedBookingServiceFeeFils', 0,
      'remainingBookingPriceFils', price_fils, 'remainingBookingServiceFeeFils', fee_fils,
      'marketplaceCommissionFils', price_fils / 10, 'ownerEntitlementFils', price_fils / 10 * 9),
    'payout', jsonb_build_object('status', 'not_eligible', 'eligibleFils', price_fils / 10 * 9,
      'paidFils', 0, 'providerFeeFils', 0, 'providerReserveFils', 0, 'recoveryExposureFils', 0,
      'recoveryBalanceFils', 0, 'automaticOwnerDebitFils', 0, 'paidWhileBlocked', false, 'settlement', null),
    'holds', jsonb_build_object('administrator', false, 'dispute', false),
    'dispute', null, 'audits', jsonb_build_array(), 'movements', jsonb_build_array());
  claimed := public.begin_booking_request_authorization_claim(attempt, snapshot, identity);
  if claimed ->> 'status' is distinct from 'ready' then raise exception 'Expected a ready authorization claim: %', claimed; end if;
  perform set_config('role', 'none', true);

  select jsonb_build_object(
      'providerIdentity', jsonb_build_object('provider', claims.provider, 'environment', claims.environment,
        'merchantId', claims.merchant_id, 'terminalId', claims.terminal_id),
      'permitPurpose', 'booking-request-authorization', 'idempotencyKey', claims.provider_idempotency_key,
      'notAfter', to_char(claims.not_after at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'requestFingerprint', repeat('a', 64), 'paymentLifecycleId', claims.payment_lifecycle_id,
      'logicalOperationId', claims.logical_operation_id, 'physicalAttemptId', claims.physical_attempt_id,
      'operationKind', 'authorization', 'amountFils', claims.amount_fils, 'currency', claims.currency,
      'claimId', claims.id, 'claimGeneration', claims.generation, 'stateRevision', null, 'cleanupAttemptId', null,
      'workId', null, 'leaseGeneration', null, 'leaseToken', null, 'operationId', null, 'operationGeneration', null)
    into strict operation
    from public.booking_request_authorization_claims claims where claims.attempt_id = attempt;
  insert into simulated_authorization_operation values(operation);

  perform set_config('role', 'service_role', true);
  outcome := pg_temp.payment_execute(operation, 'indeterminate');
  if outcome ->> 'outcome' is distinct from 'indeterminate' then raise exception 'Expected an indeterminate Payment Authorization: %', outcome; end if;
  outcome := pg_temp.payment_query(operation, outcome ->> 'providerRequestId', outcome ->> 'providerReference', 'succeeded');
  if outcome ->> 'outcome' is distinct from 'succeeded' then raise exception 'Expected a resolved Payment Authorization: %', outcome; end if;
  snapshot := snapshot || jsonb_build_object(
    'authorization', pending || jsonb_build_object('status', 'succeeded',
      'providerRequestId', outcome ->> 'providerRequestId', 'providerReference', outcome ->> 'providerReference',
      'movementReference', outcome ->> 'movementReference'),
    'movements', jsonb_build_array(jsonb_build_object('kind', 'authorization',
      'logicalOperationId', pending ->> 'logicalOperationId', 'attemptId', pending ->> 'attemptId',
      'amountFils', total_fils, 'movementReference', outcome ->> 'movementReference',
      'recordedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));
  perform public.save_booking_request_payment_snapshot(attempt, snapshot, identity);
  finalized := public.finalize_booking_request_submission(attempt, snapshot);
  if finalized ->> 'status' is distinct from 'pending' then raise exception 'Expected a pending Booking Request: %', finalized; end if;
  perform set_config('role', 'none', true);

  select requests.* into strict owned_request from public.booking_requests requests
    join public.booking_request_submission_attempts attempts on attempts.booking_request_id=requests.id
    where attempts.id=attempt;
  select operations.id into strict owned_operation_id from public.payment_provider_operations operations
    where operations.claim_id=(operation->>'claimId')::uuid
      and operations.claim_generation=(operation->>'claimGeneration')::integer
      and operations.payment_lifecycle_id=lifecycle::uuid and operations.operation_kind='authorization';
  insert into history_reference values(owned_request.booking_request_reference,owned_request.id,lifecycle::uuid,owned_operation_id);
end;
$history_fixture$;
update public.account_contexts set role='platform_administrator',owner_approval_state=null
  where user_id='00000000-0000-0000-0000-000000003202';
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-0000-0000-000000003202','role','authenticated','aal','aal2')::text,true);
grant select on history_reference to authenticated;
set local role authenticated;
  `;
  let session;
  databaseHarness.markTimingPhase("execution");
  try {
    session = await databaseHarness.startSessionAfterSetup(
      setup,
      `
    select 'RESOLVED:'||public.get_administrator_booking_request_payment_history((select reference from history_reference))::text;
    reset role;
    select 'SOURCE:'||jsonb_build_object('id',id,'originalOutcome',original_outcome,'outcome',current_outcome,'executions',(select physical_execution_count from public.simulated_payment_effects where operation_id=payment_provider_operations.id),'physicalAttemptId',physical_attempt_id,'request',provider_request_id,'reference',provider_reference,'movement',movement_reference)::text from public.payment_provider_operations where id=(select operation_id from history_reference);
    select 'RECEIPTS:'||count(*)::text from public.booking_request_payment_correction_observations where booking_request_id=(select request_id from history_reference);
    set local role service_role;
    select 'REPEAT:'||(pg_temp.payment_query((select operation from simulated_authorization_operation),null,null,'succeeded')->>'outcome');
    reset role;
    update public.payment_provider_operations set updated_at=updated_at+interval '1 second' where id=(select operation_id from history_reference);
    set local role authenticated;
    select 'RESOLVED:'||public.get_administrator_booking_request_payment_history((select reference from history_reference))::text;
    reset role;
    -- Controlled retained-source updates isolate each meaningful observation field.
    update public.payment_provider_operations set authoritative_outcome_at='2099-01-01T00:00:00Z' where id=(select operation_id from history_reference);
    set local role authenticated;
    select 'EVIDENCE_TIME:'||public.get_administrator_booking_request_payment_history((select reference from history_reference))::text;
    reset role;
    update public.payment_provider_operations set movement_reference='sim-movement-1234567890abcdef1234567890abcdef' where id=(select operation_id from history_reference);
    set local role authenticated;
    select 'EVIDENCE_MOVEMENT:'||public.get_administrator_booking_request_payment_history((select reference from history_reference))::text;
    reset role;
    update public.payment_provider_operations set movement_reference=movement_reference,authoritative_outcome_at=authoritative_outcome_at,updated_at=updated_at+interval '1 second' where id=(select operation_id from history_reference);
    set local role authenticated;
    select 'EVIDENCE_MOVEMENT:'||public.get_administrator_booking_request_payment_history((select reference from history_reference))::text;
    select 'RC330_HISTORY_EXECUTION_READY';
  `,
    );
    await databaseHarness.waitForMarker(
      session,
      "RC330_HISTORY_EXECUTION_READY",
    );
    databaseHarness.markTimingPhase("cleanup");
    await databaseHarness.finishSession(session, { action: "rollback" });
    databaseHarness.markTimingPhase("execution");
    const result = session.setupStdout + session.stdout;
    const values = (prefix) =>
      result
        .split("\n")
        .filter((line) => line.startsWith(prefix))
        .map((line) => JSON.parse(line.slice(prefix.length)));
    const [before, after] = values("RESOLVED:");
    const [source] = values("SOURCE:");
    assert.deepEqual(
      after,
      before,
      "Repeated query and timestamp-only update append no duplicate history",
    );
    assert.equal(source.originalOutcome, "indeterminate");
    assert.equal(source.outcome, "succeeded");
    assert.equal(source.executions, 1);
    assert.equal(values("RECEIPTS:")[0], 0);
    assert.match(result, /REPEAT:succeeded/);
    assert.equal(before.historyCoverage, "complete");
    const physical = before.events.filter(
      (event) => event.kind === "physical-attempt",
    );
    assert.equal(physical.length, 1);
    assert.equal(physical[0].outcome, "indeterminate");
    const transitions = before.events.filter(
      (event) =>
        event.source === "provider-operation" &&
        event.kind === "state-transition",
    );
    assert.equal(
      transitions.length,
      1,
      "Real provider query resolution is retained without inventing a receipt",
    );
    assert.equal(transitions[0].fromState, "indeterminate");
    assert.equal(transitions[0].toState, "succeeded");
    assert.equal(transitions[0].outcome, "succeeded");
    assert.equal(transitions[0].physicalAttemptId, source.physicalAttemptId);
    assert.equal(transitions[0].receivedAt, undefined);
    assert.equal(
      transitions[0].providerRequestId,
      `internal-request:${source.id}`,
    );
    assert.equal(
      transitions[0].providerReference,
      `internal-reference:${source.id}`,
    );
    assert.equal(
      transitions[0].movementReference,
      `internal-movement:${source.id}`,
    );
    assert.equal(
      before.events.filter((event) => event.kind === "receipt-observation")
        .length,
      0,
    );
    const [timeEvidence] = values("EVIDENCE_TIME:");
    const [movementEvidence, repeatedEvidence] = values("EVIDENCE_MOVEMENT:");
    for (const [previous, next] of [
      [after, timeEvidence],
      [timeEvidence, movementEvidence],
    ]) {
      assert.deepEqual(
        next.events.slice(0, previous.events.length),
        previous.events,
      );
      assert.equal(next.events.length, previous.events.length + 1);
      assert.equal(next.events.at(-1).kind, "state-transition");
      assert.equal(next.events.at(-1).fromState, "succeeded");
      assert.equal(next.events.at(-1).toState, "succeeded");
      assert.equal(
        next.events.at(-1).physicalAttemptId,
        source.physicalAttemptId,
      );
      assert.equal(next.events.at(-1).receivedAt, undefined);
    }
    assert.equal(
      timeEvidence.events.at(-1).providerOccurredAt,
      "2099-01-01T00:00:00+00:00",
    );
    assert.equal(
      movementEvidence.events.at(-1).movementReference,
      "sim-movement-1234567890abcdef1234567890abcdef",
    );
    assert.deepEqual(repeatedEvidence, movementEvidence);
    console.log(
      "Public authorization query retains indeterminate-to-succeeded transition, original physical outcome, safe internal support references and one execution without receipts; repeat query and timestamp-only update retain identical AAL2 history.",
    );
  } catch (error) {
    if (session && !session.exit)
      await databaseHarness.cleanUpOwnedSession(session, error);
    throw error;
  }
}

// Hold only the request row while querying release evidence. Detect an
// unexpected dependency and cancel the query before releasing that holder;
// never create a circular wait between the real query and lease procedures.
async function verifyReleaseDependencies() {
  harness.markTimingPhase("setup");
  const request = "60000000-0000-4000-8000-000000001431";
  const lifecycle = "73000000-0000-4000-8000-000000001431";
  const setup = fixtureFor(143)
    .split("insert into public.booking_request_capture_work")[0]
    .replace(
      "'accepted','2100-12-31 16:00+00'",
      "'pending','2100-12-31 16:00+00'",
    )
    .replace("'2100-12-31 13:00+00');", "null);");
  const cleanup = captureCleanup({ stem: "143", releaseOperations: true });
  let holder,
    query,
    queryPid,
    lease,
    seeded = false;
  try {
    harness.markTimingPhase("setup");
    assert.equal(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select count(*) from public.booking_requests where id='${request}';`,
      ),
      "0",
    );
    await harness.runSqlAfterSetup(paymentEvidenceSql, `begin;${setup}commit;`);
    seeded = true;
    harness.markTimingPhase("execution");
    const setupResult = await harness.runSqlAfterSetup(
      paymentEvidenceSql,
      `begin;
      set local role service_role;
      select public.claim_booking_request_action('10000000-0000-4000-8000-000000001432','${request}','withdraw',null,null);
      reset role;
      create temp table release_snapshot as select work.id,work.lease_generation,work.lease_token,
        jsonb_set(attempts.payment_snapshot,'{release}',jsonb_build_object(
          'paymentLifecycleId',attempts.payment_lifecycle_id,'kind','release',
          'logicalOperationId',attempts.payment_lifecycle_id::text||':release',
          'attemptId',attempts.payment_lifecycle_id::text||':release:attempt-2',
          'status','pending','amountFils',claims.amount_fils,'providerRequestId',null,
          'providerReference',null,'movementReference',null,'reconciliationRequired',false,'retrySafe',false)) snapshot
        from public.booking_request_release_work work
        join public.booking_request_submission_attempts attempts on attempts.id=work.attempt_id
        join public.booking_request_authorization_claims claims on claims.attempt_id=attempts.id
        where work.booking_request_id='${request}';
      grant select on release_snapshot to service_role;
      set local role service_role;
      create temp table release_permit as select public.save_booking_request_release_snapshot(id,lease_generation,lease_token,snapshot,${literal(identity)}) permit from release_snapshot;
      select 'PERMIT:'||permit::text from release_permit;
      commit;
    `,
    );
    const permit = JSON.parse(
      setupResult
        .split("\n")
        .find((line) => line.startsWith("PERMIT:"))
        .slice(7),
    );
    const operation = {
      providerIdentity: identity,
      requestFingerprint: null,
      paymentLifecycleId: lifecycle,
      logicalOperationId: `${lifecycle}:release`,
      physicalAttemptId: `${lifecycle}:release:attempt-2`,
      operationKind: "release",
      amountFils: 115000000,
      currency: "IQD",
    };
    const execution = {
      ...operation,
      requestFingerprint: permit.requestFingerprint,
      permitPurpose: permit.purpose,
      idempotencyKey: permit.idempotencyKey,
      notAfter: permit.notAfter,
      claimId: null,
      claimGeneration: null,
      stateRevision: null,
      cleanupAttemptId: null,
      workId: permit.workId,
      leaseGeneration: permit.leaseGeneration,
      leaseToken: permit.leaseToken,
      operationId: permit.operationId,
      operationGeneration: permit.operationGeneration,
    };
    const admission = JSON.parse(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `begin; set local role service_role; select public.admit_booking_request_provider_operation(${literal(execution)}); commit;`,
      ),
    );
    const querySql = `pg_temp.payment_query(${literal(operation)},null,null,'succeeded')`;
    holder = await harness.startSessionAfterSetup(
      paymentEvidenceSql,
      `begin; set application_name='history_release_holder'; select 'HOLDER_PID:'||pg_backend_pid(); select id from public.booking_requests where id='${request}' for update; select 'HOLDER_READY';`,
    );
    await harness.waitForMarker(holder, "HOLDER_READY");
    const holderPid = Number(
      holder.stdout
        .split("\n")
        .find((line) => line.startsWith("HOLDER_PID:"))
        .slice(11),
    );
    query = await harness.startSessionAfterSetup(
      paymentEvidenceSql,
      `begin; set application_name='history_release_query'; select 'QUERY_PID:'||pg_backend_pid(); set local role service_role; select 'QUERY_RESULT:'||${querySql}::text; reset role;
      select 'QUERY_STATE:'||state from public.booking_request_release_operations where work_id='${permit.workId}';
      select 'QUERY_HISTORY:'||count(*) from public.booking_request_payment_history where payment_lifecycle_id='${lifecycle}' and source='release-operation' and to_state='retryable' and outcome='not_executed';
      select 'QUERY_COMPLETE';`,
    );
    await harness.waitForMarker(query, "QUERY_PID:");
    queryPid = Number(
      query.stdout
        .split("\n")
        .find((line) => line.startsWith("QUERY_PID:"))
        .slice(10),
    );
    const started = Date.now();
    while (!query.stdout.includes("QUERY_COMPLETE")) {
      const blocked = await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select ${holderPid}=any(pg_blocking_pids(${queryPid}));`,
      );
      if (blocked === "t") {
        await harness.runSqlAfterSetup(
          paymentEvidenceSql,
          `select pg_cancel_backend(pid) from pg_stat_activity where pid=${queryPid} and application_name='history_release_query';`,
        );
        const cancelled = query;
        query = undefined;
        await harness.finishSession(cancelled, { expectedState: "57014" });
        assert.fail(
          "Canonical release query unexpectedly depends on the held request row; query cancelled before releasing the holder",
        );
      }
      if (query.exit) throw new Error(query.stderr);
      assert.ok(
        Date.now() - started < 15000,
        "Release query must reach an observable result or dependency",
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(query.stdout, /QUERY_RESULT:.*"outcome": "not-executed"/);
    assert.match(query.stdout, /QUERY_STATE:retryable/);
    assert.match(query.stdout, /QUERY_HISTORY:1/);
    lease = await harness.startSessionAfterSetup(
      paymentEvidenceSql,
      `begin; set application_name='history_release_lease'; select 'LEASE_PID:'||pg_backend_pid(); set local role service_role; select 'LEASE_RESULT:'||public.claim_booking_request_action('10000000-0000-4000-8000-000000001432','${request}','withdraw',null,null)::text; select 'LEASE_COMPLETE';`,
    );
    await harness.waitForMarker(lease, "LEASE_PID:");
    const leasePid = Number(
      lease.stdout
        .split("\n")
        .find((line) => line.startsWith("LEASE_PID:"))
        .slice(10),
    );
    await harness.waitForLock("history_release_lease", lease);
    assert.equal(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select ${holderPid}=any(pg_blocking_pids(${leasePid})) and not ${queryPid}=any(pg_blocking_pids(${leasePid}));`,
      ),
      "t",
      "Canonical lease waits only on the held request while query has completed holding release work",
    );
    await harness.finishSession(query, { action: "rollback" });
    query = undefined;
    await harness.finishSession(holder, { action: "rollback" });
    holder = undefined;
    await harness.waitForMarker(lease, "LEASE_COMPLETE");
    assert.match(lease.stdout, /LEASE_RESULT:.*"status": "processing"/);
    await harness.finishSession(lease, { action: "rollback" });
    lease = undefined;
    // The inquiry fixture transaction rolled back its closure and recording.
    // Resume the original admitted caller; a fresh admission would reconcile instead.
    const outcome = await harness.runSqlAfterSetup(
      paymentEvidenceSql,
      `begin; set local role service_role; select pg_temp.payment_fixture_result(${literal(admission)},'succeeded')->>'outcome'; commit;`,
    );
    assert.equal(outcome, "succeeded");
    assert.equal(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select sum((select effect.physical_execution_count from public.simulated_payment_effects effect where effect.operation_id=payment_provider_operations.id)) from public.payment_provider_operations where payment_lifecycle_id='${lifecycle}';`,
      ),
      "1",
    );
    assert.equal(
      await harness.runSqlAfterSetup(
        paymentEvidenceSql,
        `select count(*) from public.booking_request_payment_history where payment_lifecycle_id='${lifecycle}' and kind='physical-attempt';`,
      ),
      "1",
    );
    console.log(
      "Canonical release query records authoritative absence without requesting the held request row; concurrent lease depends only on that holder. Original query/lease outcomes and one subsequent physical release execution are preserved.",
    );
  } finally {
    harness.markTimingPhase("cleanup");
    // Query is resolved or cancelled before the holder is released. The lease
    // never holds the work row while the holder is open.
    try {
      if (query) {
        if (!query.exit && !query.stdout.includes("QUERY_COMPLETE")) {
          await harness.runSqlAfterSetup(
            paymentEvidenceSql,
            `select pg_cancel_backend(pid) from pg_stat_activity where pid=${queryPid ?? "null"} and application_name='history_release_query';`,
          );
          await harness.finishSession(query, { expectedState: "57014" });
        } else {
          await harness.finishSession(
            query,
            query.exit ? {} : { action: "rollback" },
          );
        }
      }
    } finally {
      try {
        if (holder) await harness.finishSession(holder, { action: "rollback" });
      } finally {
        try {
          if (lease)
            await harness.finishSession(
              lease,
              lease.exit ? {} : { action: "rollback" },
            );
        } finally {
          if (seeded) {
            harness.guardDisposableLocalDatabase();
            await harness.runSqlAfterSetup(paymentEvidenceSql, cleanup);
          }
        }
      }
    }
  }
}

export async function prepareHistorySession(databaseHarness, index) {
  databaseHarness.markTimingPhase("setup");
  const request = `60000000-0000-4000-8000-00000000${index}1`;
  const setup =
    paymentEvidenceSql +
    `begin;${fixtureFor(index)}
      update public.account_contexts set role='platform_administrator' where user_id='10000000-0000-4000-8000-00000000${index}3';
      set request.jwt.claims='{"sub":"10000000-0000-4000-8000-00000000${index}3","role":"authenticated","aal":"aal2"}';
      set local role service_role;
    `;
  databaseHarness.markTimingPhase("execution");
  return databaseHarness.startSessionAfterSetup(
    setup,
    `
      create temp table history_lease as select public.lease_booking_request_capture_work('${request}',${literal(identity)}) result;
      create temp table history_execution as select pg_temp.capture_execute((select result->'permit' from history_lease),'failed') result;
      reset role;
      ${historySql(index)}
      select 'HISTORY_READY';
    `,
  );
}

async function main() {
  let passed = false;
  try {
    harness.guardDisposableLocalDatabase();
    await verifyReleaseDependencies();
    harness.markTimingPhase("execution");
    await verifyProviderResolution(harness);
    try {
      for (const index of [141, 142]) {
        const request = `60000000-0000-4000-8000-00000000${index}1`;
        const session = await prepareHistorySession(harness, index);
        sessions.push({ index, request, session });
      }
      await Promise.all(
        sessions.map(({ session }) =>
          harness.waitForMarker(session, "HISTORY_READY"),
        ),
      );
      // Both real source transactions remain open; later completion must append to
      // the same original request without replacing the first execution evidence.
      for (const { index, request, session } of sessions) {
        session.child.stdin.write(`set local role service_role;
      select public.record_booking_request_capture_failure('${request}',(select (result#>>'{permit,leaseGeneration}')::bigint from history_lease),(select (result#>>'{permit,leaseToken}')::uuid from history_lease),(select result from history_execution));
      reset role;
      ${historySql(index)}
      select 'HISTORY_COMPLETED';
    `);
      }
      await Promise.all(
        sessions.map(({ session }) =>
          harness.waitForMarker(session, "HISTORY_COMPLETED"),
        ),
      );
      const allSequences = [];
      for (const { index, session } of sessions) {
        const [before, after] = histories(session);
        assert.equal(
          before.bookingRequestReference,
          `RC-REQ-000000000000${index}1`,
        );
        assert.equal(
          before.events.filter((event) => event.kind === "physical-attempt")
            .length,
          1,
        );
        assert.equal(before.events.at(-1).outcome, "failed");
        assert.deepEqual(
          after.events.slice(0, before.events.length),
          before.events,
        );
        assert.equal(after.events.at(-1).source, "capture-work");
        assert.equal(after.events.at(-1).toState, "payment_required");
        assert.equal(
          after.events.filter((event) => event.kind === "physical-attempt")
            .length,
          1,
        );
        const [beforeSequence, afterSequence] = sequences(session);
        assert.deepEqual(
          afterSequence.slice(0, beforeSequence.length),
          beforeSequence,
        );
        assert.equal(afterSequence.length, after.events.length);
        allSequences.push(...afterSequence);
      }
      assert.equal(new Set(allSequences).size, allSequences.length);
      console.log(
        "Concurrent real capture procedures retain one physical attempt per request and immutable ordered AAL2 history prefixes when completion appends; all fixtures roll back.",
      );
    } finally {
      harness.markTimingPhase("cleanup");
      await Promise.all(
        sessions.map(({ session }) =>
          harness.finishSession(session, { action: "rollback" }),
        ),
      );
    }
    passed = true;
  } finally {
    harness.finishTiming({
      outcome: passed ? "passed" : "failed",
      cleanupDisposition: "local",
    });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
