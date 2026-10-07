import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accessBrowserFixture } from "./lib/access-browser-fixtures.mjs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const USAGE =
  "Usage: node scripts/verify-booking-request-scheduled-expiry.mjs --seed|--verify";
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function main(args, environment = process.env) {
  if (args.length !== 1 || (args[0] !== "--seed" && args[0] !== "--verify")) {
    console.error(USAGE);
    return 2;
  }

  const workdir = environment.SUPABASE_LOCAL_WORKDIR;
  if (
    !workdir ||
    !statSync(workdir, { throwIfNoEntry: false })?.isDirectory()
  ) {
    throw new Error(
      "Scheduled expiry requires an existing local Supabase workdir.",
    );
  }
  const identityFile = join(workdir, "scheduled-expiry-request-id");

  const harness = createLocalSupabaseConcurrencyHarness({ environment });
  harness.guardDisposableLocalDatabase();

  if (args[0] === "--seed") {
    // SQL arrangement mirrors admission, isolated effect, and explicit recording.
    const paymentEvidenceSql =
      "-- BEGIN PAYMENT EVIDENCE FIXTURE\n" +
      readFileSync("supabase/fixtures/payment-evidence.sql", "utf8") +
      "\n-- END PAYMENT EVIDENCE FIXTURE\n";
    // Tables are read as the session owner; service_role covers only the production functions.
    const requestId = harness.runSql(
      paymentEvidenceSql +
        `
create function pg_temp.prepare_due_booking_request() returns uuid language plpgsql as $$
declare cottage record; declare customer_id uuid; declare search jsonb; declare quote jsonb; declare requires_inside_48 boolean;
declare submission jsonb; declare prepared jsonb; declare attempt uuid; declare lifecycle text;
declare price_fils bigint; declare fee_fils bigint; declare total_fils bigint;
declare pending jsonb; declare snapshot jsonb; declare claimed jsonb; declare operation jsonb; declare outcome jsonb; declare finalized jsonb;
declare prepared_request_id uuid; declare request_notice public.booking_notification_events; declare payload jsonb;
declare lease jsonb; declare binding jsonb; declare delivery jsonb; declare effect_id uuid; declare due_request_id uuid;
declare identity jsonb := '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}';
begin
  select profiles.current_shift_schedule_id as schedule_id, shifts.id as shift_id,
      listings.public_slug as slug, shifts.position as shift_position, current_date + 30 as service_day
    into strict cottage
    from public.cottage_marketplace_listings listings
    join public.owner_application_cottage_profiles profiles on profiles.id = listings.profile_id
    join public.cottage_shifts shifts on shifts.schedule_revision_id = profiles.current_shift_schedule_id
    join public.cottage_publication_snapshots publications
      on publications.id = profiles.current_publication_id and publications.profile_id = profiles.id and publications.capacity >= 2
    join public.cottage_publication_localizations localizations
      on localizations.publication_id = publications.id and localizations.locale = 'en'
    where listings.state = 'published'
      and public.is_cottage_publicly_discoverable(profiles.id)
      and profiles.name = '${accessBrowserFixture("worker").bookingCottageName}'
      and shifts.position = (select min(earliest.position) from public.cottage_shifts earliest
        where earliest.schedule_revision_id = profiles.current_shift_schedule_id);
  select users.id into strict customer_id
    from auth.users users join public.account_contexts contexts on contexts.user_id = users.id
    where users.phone = '9647520000002' and contexts.role = 'customer' and users.phone_confirmed_at is not null;
  insert into public.cottage_inventory_availability (schedule_revision_id, unit_kind, unit_id, service_day, state)
    values (cottage.schedule_id, 'shift', cottage.shift_id, cottage.service_day, 'open')
    on conflict (schedule_revision_id, unit_kind, unit_id, service_day) do update set state = 'open';
  search := jsonb_build_object('from', cottage.service_day, 'to', cottage.service_day, 'guests', 2,
    'amenities', jsonb_build_array(),
    'selections', jsonb_build_array(jsonb_build_object(
      'serviceDay', cottage.service_day, 'kind', 'shift', 'position', cottage.shift_position)));
  quote := public.get_public_booking_quote_with_fingerprint('en', cottage.slug, search);
  if quote ->> 'status' is distinct from 'quoted' then raise exception 'Expected a quoted Booking Period: %', quote; end if;
  requires_inside_48 := (public.booking_request_policy_at(
    (quote -> 'items' -> 0 ->> 'startsAt')::timestamptz, clock_timestamp()
  ) ->> 'requiresInside48HourNoRefundAcceptance')::boolean;
  submission := jsonb_build_object('locale', 'en', 'publicSlug', cottage.slug, 'discoveryQuery', search,
    'quoteFingerprint', quote ->> 'quoteFingerprint', 'contentVersion', (quote ->> 'contentVersion')::integer,
    'termsVersion', quote ->> 'termsVersion', 'bookingPriceIqd', (quote ->> 'bookingPriceIqd')::bigint,
    'serviceFeeIqd', (quote ->> 'serviceFeeIqd')::bigint, 'customerTotalIqd', (quote ->> 'customerTotalIqd')::bigint,
    'firstStartsAt', quote -> 'items' -> 0 ->> 'startsAt',
    'intent', jsonb_build_object('customerName', 'Scheduled Expiry Customer', 'partySize', 2,
      'acceptedHouseRules', true, 'acceptedCancellationPolicy', true, 'acceptedMarketplaceTerms', true,
      'acceptedInside48HourNoRefund', requires_inside_48, 'cancellationPolicyVersion', 'rentcottage-mvp-2026-08-04',
      'acceptanceEvidence', public.booking_request_acceptance_evidence('en', requires_inside_48)));
  price_fils := (submission ->> 'bookingPriceIqd')::bigint * 1000;
  fee_fils := (submission ->> 'serviceFeeIqd')::bigint * 1000;
  total_fils := (submission ->> 'customerTotalIqd')::bigint * 1000;

  perform set_config('role', 'service_role', true);
  prepared := public.prepare_booking_request_submission(customer_id, '48500000-0000-4000-8000-000000000001', submission);
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
      'requestFingerprint', repeat('d', 64), 'paymentLifecycleId', claims.payment_lifecycle_id,
      'logicalOperationId', claims.logical_operation_id, 'physicalAttemptId', claims.physical_attempt_id,
      'operationKind', 'authorization', 'amountFils', claims.amount_fils, 'currency', claims.currency,
      'claimId', claims.id, 'claimGeneration', claims.generation, 'stateRevision', null, 'cleanupAttemptId', null,
      'workId', null, 'leaseGeneration', null, 'leaseToken', null, 'operationId', null, 'operationGeneration', null)
    into strict operation
    from public.booking_request_authorization_claims claims where claims.attempt_id = attempt;

  perform set_config('role', 'service_role', true);
  outcome := pg_temp.payment_execute(operation, 'succeeded');
  if outcome ->> 'outcome' is distinct from 'succeeded' then raise exception 'Expected a successful Payment Authorization: %', outcome; end if;
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

  select attempts.booking_request_id into strict prepared_request_id
    from public.booking_request_submission_attempts attempts where attempts.id = attempt;
  select * into strict request_notice from public.booking_notification_events events
    where events.booking_request_id = prepared_request_id and events.event_kind = 'request_new';
  select jsonb_build_object('kind', request_notice.event_kind, 'title', 'Request status',
      'body', 'Open your authenticated request for current status.', 'bookingReference', null,
      'bookingRequestReference', requests.booking_request_reference, 'deadlineAt', request_notice.deadline_at,
      'detailsPath', '/' || request_notice.notice_locale || '/owner/booking-requests/' || requests.booking_request_reference,
      'linkLabel', 'View Booking Request', 'fictional', true)
    into strict payload from public.booking_requests requests where requests.id = prepared_request_id;

  perform set_config('role', 'service_role', true);
  perform public.ensure_booking_confirmation_notification_work(null, request_notice.notice_locale::text, 'booking-event-v1', payload, request_notice.id);
  lease := public.lease_booking_confirmation_notification_work(null, request_notice.id);
  if lease is null then raise exception 'Expected a leased Owner Request Notification for event %', request_notice.id; end if;
  binding := lease - array['leaseGeneration', 'leaseToken', 'leaseExpiresAt'];
  delivery := public.query_fictional_booking_confirmation_notification_effect(
    null, (lease ->> 'leaseGeneration')::bigint, (lease ->> 'leaseToken')::uuid, binding, request_notice.id);
  if delivery ->> 'status' is distinct from 'not-found' then raise exception 'Expected no earlier notification effect: %', delivery; end if;
  delivery := public.execute_fictional_booking_confirmation_notification_effect(
    null, (lease ->> 'leaseGeneration')::bigint, (lease ->> 'leaseToken')::uuid, binding, request_notice.id);
  if delivery ->> 'status' is distinct from 'delivered' then raise exception 'Expected a delivered notification effect: %', delivery; end if;
  effect_id := (delivery ->> 'effectId')::uuid;
  delivery := public.complete_booking_confirmation_notification_delivery(
    null, (lease ->> 'leaseGeneration')::bigint, (lease ->> 'leaseToken')::uuid, binding, effect_id, request_notice.id);
  if delivery ->> 'status' is distinct from 'delivered' then raise exception 'Expected a completed notification delivery: %', delivery; end if;
  perform set_config('role', 'none', true);

  update public.booking_requests requests
    set created_at = base.created_at, response_deadline = base.created_at + interval '4 hours'
    from (select clock_timestamp() - interval '5 hours' as created_at) base
    where requests.id = prepared_request_id and requests.status = 'pending'
      and exists (select 1 from public.booking_notification_events events
        join public.booking_confirmation_notification_work work on work.event_id = events.id
        where events.booking_request_id = requests.id and events.event_kind = 'request_new' and work.state = 'delivered')
    returning requests.id into due_request_id;
  if due_request_id is null then raise exception 'Prepared Booking Request % was not aged', prepared_request_id; end if;
  return due_request_id;
end $$;
select pg_temp.prepare_due_booking_request();
`,
    );
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      throw new Error("Scheduled expiry fixture was not prepared.");
    }
    writeFileSync(identityFile, `${requestId}\n`);
    console.log(`Scheduled expiry fixture ${requestId} is due.`);
    return 0;
  }

  const requestId = readFileSync(identityFile, "utf8").trim();
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error("Scheduled expiry fixture ID is invalid.");
  }
  const result = harness.runSql(`
    select concat_ws('|', requests.status, work.state, work.outcome,
      commitments.status, bool_and(not occupancies.active),
      count(distinct notifications.id), count(distinct operations.id),
      count(distinct provider.id),
      jsonb_array_length(attempts.payment_snapshot -> 'movements'))
    from public.booking_requests requests
    join public.booking_request_release_work work
      on work.booking_request_id = requests.id
    join public.booking_request_submission_attempts attempts
      on attempts.id = work.attempt_id
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = commitments.id
    join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    join public.booking_request_release_operations operations
      on operations.work_id = work.id
    join public.payment_provider_operations provider
      on provider.payment_lifecycle_id = attempts.payment_lifecycle_id
      and provider.operation_kind = 'release'
    where requests.id = '${requestId}'
      and requests.status = 'expired'
      and work.outcome = 'expired'
    group by requests.id, requests.status, work.state, work.outcome, commitments.status,
      attempts.payment_snapshot;
  `);
  const expected = "expired|complete|expired|released_hold|t|2|1|1|2";
  if (result !== expected) {
    throw new Error(
      `Scheduled expiry did not produce the exact terminal state: ${result || "no result"}`,
    );
  }
  console.log("Scheduled expiry produced one release and one notice pair.");
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
