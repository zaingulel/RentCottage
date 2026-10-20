import { createHash } from "node:crypto";

// One home for the reset and cleanup SQL of the fixed-identifier booking, customer review and
// Published Cottage fixtures.
const id = (prefix, stem, row = "1") =>
  `${prefix}-0000-4000-8000-00000000${stem}${row}`;
const rows = (stem) => ({
  owner: id("10000000", stem),
  customer: id("10000000", stem, "2"),
  third: id("10000000", stem, "3"),
  profile: id("20000000", stem),
  schedule: id("30000000", stem),
  snapshot: id("40000000", stem),
  commitment: id("50000000", stem),
  request: id("60000000", stem),
  attempt: id("70000000", stem),
  claim: id("72000000", stem),
  confirmation: id("80000000", stem),
  operation: id("81000000", stem),
});
const administrator = "10000000-0000-4000-8000-000000003801";

export function browserBookingFixtureIdentity(file, project) {
  const stems = new Map([
    ["cancellation", ["810", "811", "812"]],
    ["completion", ["820", "821", "822"]],
    ["refund", ["830", "831", "832"]],
    ["request-notification", ["840", "841", "842"]],
    ["expiry", ["850", "851", "852"]],
    ["reminder", ["860", "861", "862"]],
    ["capture", ["870", "871", "872"]],
  ]);
  const projects = ["mobile", "desktop", "worker"];
  if (!stems.has(file)) throw new Error("Unknown browser booking fixture file");
  if (!projects.includes(project))
    throw new Error("Unknown browser booking fixture project");
  const stem = stems.get(file)[projects.indexOf(project)];
  const paymentLifecycle = id("73000000", stem);
  const captureFingerprint = createHash("sha256")
    .update(
      `{"provider":{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"},"kind":"capture","paymentLifecycleId":"${paymentLifecycle}","logicalOperationId":"${paymentLifecycle}:capture","attemptId":"${paymentLifecycle}:capture:attempt-2","amountFils":115000000,"currency":"IQD"}`,
      "utf8",
    )
    .digest("hex");
  return {
    stem,
    ...rows(stem),
    administrator: id("10000000", stem, "8"),
    paymentLifecycle,
    reference: `RC-REQ-000000000000${stem}1`,
    ownerPhone: `+964750000${stem}1`,
    customerPhone: `+964750000${stem}2`,
    thirdPhone: `+964750000${stem}3`,
    captureFingerprint,
  };
}

// Read literal fixture boundaries, never transform SQL or accept an ambiguous source.
export function bookingFixtureSource(
  source,
  { start = "", end, required = [] },
) {
  const unique = (marker) => {
    const at = source.indexOf(marker);
    if (at < 0 || source.indexOf(marker, at + marker.length) >= 0)
      throw new Error(`Booking fixture source requires one ${marker}`);
    return at;
  };
  const from = start ? unique(start) + start.length : 0;
  const to = unique(end);
  if (!start && end.startsWith("-- END ")) {
    const opening = end.replace("-- END ", "-- BEGIN ");
    const at = unique(opening) + opening.length;
    if (at >= to || !source.slice(at, to).trim())
      throw new Error("Booking fixture source block is empty or reversed");
  }
  const block = source.slice(from, to);
  if (to <= from || !block.trim())
    throw new Error("Booking fixture source block is empty or reversed");
  for (const token of required) {
    if (!block.includes(token))
      throw new Error(`Booking fixture source is missing ${token}`);
  }
  return block;
}

// Later session markers belong to projection assertions, not the initial confirmed graph.
export function confirmedBookingAccessFixtureSource(source) {
  const start = "set session_replication_role = replica;";
  const end = "set session_replication_role = origin;";
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0)
    throw new Error(
      "Confirmed booking access fixture source markers are missing",
    );
  const window = source.slice(from, to + end.length);
  const block = bookingFixtureSource(window, {
    start,
    end,
    required: [
      "00000000350",
      "964750000350",
      "RC-REQ-0000000000003501",
      "CONFIRMED-BOOKING-35",
      "booking-request-capture:35",
      "repeat('e', 64)",
    ],
  });
  return start + block + end;
}

const completionDeletes = (
  r,
) => `delete from public.booking_completion_maturity where booking_request_id='${r.request}';
delete from public.booking_incidents where booking_request_id='${r.request}';
delete from public.booking_lifecycle_outcomes where booking_request_id='${r.request}';
`;
const terminalRequestDeletes = (
  r,
) => `delete from public.booking_request_release_operations where work_id in (select id from public.booking_request_release_work where booking_request_id='${r.request}');
delete from public.booking_request_release_work where booking_request_id='${r.request}';
delete from public.booking_request_status_notifications where booking_request_id='${r.request}';
delete from public.owner_request_notifications where booking_request_id='${r.request}';
delete from public.booking_request_payment_recovery_operations where recovery_attempt_id in (select id from public.booking_request_payment_recovery_attempts where booking_request_id='${r.request}');
delete from public.booking_request_payment_recovery_attempts where booking_request_id='${r.request}';
delete from public.booking_request_payment_required_expiry_work where booking_request_id='${r.request}';
`;
const settlementDeletes = (
  r,
) => `delete from public.booking_settlement_receipts where settlement_intent_id in (select id from public.booking_settlement_intents where booking_request_id='${r.request}');
delete from public.booking_settlement_attempts where settlement_intent_id in (select id from public.booking_settlement_intents where booking_request_id='${r.request}');
delete from public.booking_settlement_intents where booking_request_id='${r.request}';
delete from public.booking_refund_attempts where refund_intent_id in (select id from public.booking_refund_intents where booking_request_id='${r.request}');
delete from public.booking_refund_intents where booking_request_id='${r.request}';
delete from public.booking_payout_commands where booking_request_id='${r.request}';
`;

// Hold exact targets before their actions so cleanup cannot race a new restriction or FK reference.
const suspensionCleanupPreflight = (users, profiles, removedRequests) => `
create temporary table fixture_suspension_actions_to_delete(id uuid primary key) on commit drop;
do $suspension_cleanup$
begin
  perform 1 from public.account_contexts
  where user_id=any(array[${users}]::uuid[]) order by user_id for update;
  perform 1 from public.owner_application_cottage_profiles
  where id=any(array[${profiles}]::uuid[]) order by id for update;
  insert into pg_temp.fixture_suspension_actions_to_delete(id)
  select actions.id from private.marketplace_suspension_actions actions
  where actions.account_user_id=any(array[${users}]::uuid[])
    or actions.profile_id=any(array[${profiles}]::uuid[])
  order by actions.id for update;
  if exists(
    select 1 from public.booking_request_release_work work
    join pg_temp.fixture_suspension_actions_to_delete actions on actions.id=work.suspension_action_id
    where not work.booking_request_id=any(array[${removedRequests}]::uuid[])
  ) then
    raise exception 'Fixture suspension action has an outside release-work reference'
      using errcode='RC409';
  end if;
end;
$suspension_cleanup$;
`;
const suspensionActionDeletes = `delete from private.marketplace_suspension_actions
where id in (select id from pg_temp.fixture_suspension_actions_to_delete);
`;

const reset = (
  r,
  { completion, terminalRequest },
) => `${completion ? completionDeletes(r) : ""}delete from public.booking_notification_events where booking_request_id='${r.request}';
delete from public.booking_cancellation_administrator_audit where cancellation_id in (select id from public.booking_cancellations where booking_request_id='${r.request}');
delete from public.booking_cancellation_incidents where cancellation_id in (select id from public.booking_cancellations where booking_request_id='${r.request}');
delete from public.booking_cancellations where booking_request_id='${r.request}';
${terminalRequest ? terminalRequestDeletes(r) : ""}delete from public.booking_request_payment_history where booking_request_id='${r.request}' and to_state='cancelled';
update public.cottage_booking_period_commitments set status='confirmed_booking' where id='${r.commitment}';
update public.cottage_booking_period_occupancies set active=true where booking_period_commitment_id='${r.commitment}';`;

export const cancellationReset = ({ completion = false } = {}) =>
  `set session_replication_role=replica;
${reset(rows("100"), { completion, terminalRequest: false })}set session_replication_role=origin;`;

export const refundReset = ({ stem = "100" } = {}) => {
  const r = rows(stem);
  return `set session_replication_role=replica;
delete from public.booking_notification_events where refund_intent_id in (select id from public.booking_refund_intents where booking_request_id='${r.request}');
delete from public.payment_provider_observations where operation_id in (select id from public.payment_provider_operations where claim_id='${r.claim}' and operation_kind='refund');
delete from public.simulated_payment_effects where operation_id in (select id from public.payment_provider_operations where claim_id='${r.claim}' and operation_kind='refund');
delete from public.payment_provider_operations where claim_id='${r.claim}' and operation_kind='refund';
delete from public.booking_refund_attempts where refund_intent_id in (select id from public.booking_refund_intents where booking_request_id='${r.request}');
delete from public.booking_refund_intents where booking_request_id='${r.request}';
set session_replication_role=origin;`;
};

const listedCottageDeletes = (
  r,
) => `delete from public.cottage_marketplace_listings where profile_id='${r.profile}';
delete from public.cottage_publication_localizations where publication_id in (select id from public.cottage_publication_snapshots where profile_id='${r.profile}');
delete from public.cottage_publication_snapshots where profile_id='${r.profile}';
delete from public.cottage_profile_publication_decisions where review_cycle_id in (select id from public.cottage_profile_review_cycles where profile_id='${r.profile}');
delete from public.cottage_profile_localized_heads where review_cycle_id in (select id from public.cottage_profile_review_cycles where profile_id='${r.profile}');
delete from public.cottage_profile_localized_revisions where review_cycle_id in (select id from public.cottage_profile_review_cycles where profile_id='${r.profile}');
delete from public.cottage_profile_review_cycles where profile_id='${r.profile}';
delete from public.cottage_profile_source_revisions where profile_id='${r.profile}';
`;
const confirmedBookingDeletes = (
  r,
  { workIdentity, listedCottage, users },
) => `do $$
declare conversation_ids uuid[];
begin
  select array_agg(selected.conversation_id) into conversation_ids from (
    select conversation_id from public.booking_request_submission_attempts where booking_request_id='${r.request}' and conversation_id is not null
    union
    select conversation_id from public.messaging_conversation_booking_requests where booking_request_id='${r.request}'
  ) selected;
  delete from public.messaging_translation_reports where translation_id in (select translations.id from public.messaging_translations translations join public.messaging_messages messages on messages.id=translations.message_id where messages.conversation_id=any(conversation_ids));
  delete from public.messaging_translations where message_id in (select id from public.messaging_messages where conversation_id=any(conversation_ids));
  delete from public.messaging_messages where conversation_id=any(conversation_ids);
  delete from public.messaging_send_attempts where conversation_id=any(conversation_ids);
  delete from public.messaging_conversation_booking_requests where conversation_id=any(conversation_ids);
  update public.booking_request_submission_attempts set conversation_id=null where booking_request_id='${r.request}';
  delete from public.messaging_conversations where id=any(conversation_ids);
end;
$$;
delete from public.fictional_booking_confirmation_notification_effects where booking_request_id='${r.request}';
delete from public.booking_confirmation_notification_attempts where ${workIdentity} in (select ${workIdentity} from public.booking_confirmation_notification_work where booking_request_id='${r.request}');
delete from public.booking_confirmation_notification_work where booking_request_id='${r.request}';
delete from public.booking_request_payment_history where booking_request_id='${r.request}';
delete from public.simulated_payment_effects where operation_id in (select id from public.payment_provider_operations where claim_id='${r.claim}');
delete from public.payment_provider_observations where operation_id in (select id from public.payment_provider_operations where claim_id='${r.claim}');
delete from public.payment_provider_operations where claim_id='${r.claim}';
delete from public.booking_receipts where booking_confirmation_id in (select id from public.booking_confirmations where booking_request_id='${r.request}');
delete from public.booking_confirmations where booking_request_id='${r.request}';
delete from public.booking_request_capture_work where booking_request_id='${r.request}';
delete from public.booking_request_provider_operation_identities where attempt_id='${r.attempt}';
delete from public.booking_request_authorization_claim_items where claim_id='${r.claim}';
delete from public.booking_request_authorization_claim_occupancies where claim_id='${r.claim}';
delete from public.booking_request_authorization_claims where id='${r.claim}';
delete from public.booking_request_submission_attempts where id='${r.attempt}';
delete from public.booking_requests where id='${r.request}';
delete from public.cottage_booking_period_occupancies where booking_period_commitment_id='${r.commitment}';
delete from public.cottage_inventory_commitments where booking_period_commitment_id='${r.commitment}';
delete from public.cottage_booking_period_commitments where id='${r.commitment}';
delete from public.booking_snapshots where id='${r.snapshot}';
${listedCottage ? listedCottageDeletes(r) : ""}delete from public.cottage_shifts where schedule_revision_id='${r.schedule}';
delete from public.cottage_shift_schedule_revisions where id='${r.schedule}';
${suspensionActionDeletes}delete from public.owner_application_cottage_profiles where id='${r.profile}';
delete from public.account_names where user_id in (${users});
delete from public.account_contexts where user_id in (${users});
delete from auth.users where id in (${users});
`;

export const confirmedBookingCleanup = ({
  stem = "100",
  administrator: selectedAdministrator = administrator,
  exportAdministrator = null,
  completion = false,
  settlement = false,
  terminalRequest = false,
} = {}) => {
  const r = rows(stem);
  // Request events have no receipt; cleanup follows the actual work identity.
  const workIdentity = terminalRequest ? "notification_id" : "receipt_id";
  const users = `'${r.owner}','${r.customer}','${r.third}','${selectedAdministrator}'`;
  return `begin;
${suspensionCleanupPreflight(users, `'${r.profile}'`, terminalRequest ? `'${r.request}'` : "")}set local session_replication_role=replica;
delete from private.administrator_booking_money_exports where administrator_user_id in ('${selectedAdministrator}'${exportAdministrator === null ? "" : `,'${exportAdministrator}'`});
${reset(r, { completion, terminalRequest })}${settlement ? settlementDeletes(r) : ""}${confirmedBookingDeletes(r, { workIdentity, listedCottage: true, users })}set local session_replication_role=origin;
commit;`;
};

export const customerReviewCleanup = (
  namespace,
  { reusedAuthUsers = [] } = {},
) => {
  // A review namespace NN is the confirmed booking fixture at stem NN0; rows 81 and 82 are its administrators.
  const r = rows(`${namespace}0`);
  const users = [
    r.owner,
    r.customer,
    r.third,
    id("10000000", `${namespace}8`),
    id("10000000", `${namespace}8`, "2"),
  ]
    .map((user) => `'${user}'`)
    .join(",");
  // Reused authentication users keep their auth.users rows, which the caller finds again by phone;
  // only the account contexts the seed inserts afresh are cleared.
  const reusedAccountContextDeletes = reusedAuthUsers.length
    ? `delete from public.account_names where user_id in (${reusedAuthUsers.map((user) => `'${user}'`).join(",")});
delete from public.account_contexts where user_id in (${reusedAuthUsers.map((user) => `'${user}'`).join(",")});
`
    : "";
  const targetUsers = [
    users,
    ...reusedAuthUsers.map((user) => `'${user}'`),
  ].join(",");
  return `begin;
${suspensionCleanupPreflight(targetUsers, `'${r.profile}'`, "")}set local session_replication_role=replica;
delete from public.customer_review_translation_reports where translation_id in (select translations.id from public.customer_review_translations translations join public.customer_reviews reviews on reviews.id=translations.review_id where reviews.booking_request_id='${r.request}');
delete from public.customer_review_translations where review_id in (select id from public.customer_reviews where booking_request_id='${r.request}');
delete from public.customer_review_reply_hides where review_id in (select id from public.customer_reviews where booking_request_id='${r.request}');
delete from public.customer_review_replies where review_id in (select id from public.customer_reviews where booking_request_id='${r.request}');
delete from public.customer_review_hides where review_id in (select id from public.customer_reviews where booking_request_id='${r.request}');
delete from public.customer_reviews where booking_request_id='${r.request}';
${completionDeletes(r)}delete from public.booking_notification_events where booking_request_id='${r.request}';
${confirmedBookingDeletes(r, { workIdentity: "receipt_id", listedCottage: true, users })}${reusedAccountContextDeletes}set local session_replication_role=origin;
commit;`;
};

const lifecycleDeletes = (
  r,
) => `delete from public.booking_cancellation_incidents where cancellation_id in (select id from public.booking_cancellations where booking_request_id='${r.request}');
delete from public.booking_cancellations where booking_request_id='${r.request}';
delete from public.booking_incidents where booking_request_id='${r.request}';
delete from public.booking_lifecycle_outcomes where booking_request_id='${r.request}';
`;

export const confirmedBookingAccessCleanup = ({
  stem = "350",
  owner = rows(stem).owner,
  customer = rows(stem).customer,
  lifecycle = false,
} = {}) => {
  const r = rows(stem);
  return `begin;
${suspensionCleanupPreflight(`'${owner}','${customer}','${r.third}'`, `'${r.profile}'`, "")}set local session_replication_role=replica;
delete from public.booking_confirmation_notification_attempts where notification_id in (select notification_id from public.booking_confirmation_notification_work where booking_request_id='${r.request}');
delete from public.fictional_booking_confirmation_notification_effects where booking_request_id='${r.request}';
delete from public.booking_confirmation_notification_work where booking_request_id='${r.request}';
delete from public.booking_notification_events where booking_request_id='${r.request}';
${lifecycle ? lifecycleDeletes(r) : ""}delete from public.booking_request_confirmation_invalidations where booking_request_id='${r.request}';
delete from public.booking_request_payment_required_expiry_work where booking_request_id='${r.request}';
delete from public.payment_provider_operations where id='${r.operation}';
delete from public.booking_receipts where booking_confirmation_id='${r.confirmation}'; delete from public.booking_confirmations where id='${r.confirmation}';
delete from public.booking_request_capture_work where booking_request_id='${r.request}'; delete from public.booking_requests where id='${r.request}';
delete from public.cottage_booking_period_commitments where id='${r.commitment}'; delete from public.booking_snapshots where id='${r.snapshot}';
${suspensionActionDeletes}delete from public.owner_application_cottage_profiles where id='${r.profile}'; delete from public.account_names where user_id in ('${owner}','${customer}','${r.third}'); delete from public.account_contexts where user_id in ('${owner}','${customer}','${r.third}'); delete from auth.users where id in ('${owner}','${customer}','${r.third}'); set local session_replication_role=origin;
commit;`;
};

export const preparationReminderCleanup = (event) => {
  const r = rows("350");
  return `set session_replication_role=replica;
delete from public.booking_confirmation_notification_attempts where event_id='${event}';
delete from public.fictional_booking_confirmation_notification_effects where event_id='${event}';
delete from public.booking_confirmation_notification_work where event_id='${event}';
delete from public.booking_notification_events where id='${event}';
delete from public.booking_incidents where booking_request_id='${r.request}';
delete from public.booking_cancellation_incidents where cancellation_id in (select id from public.booking_cancellations where booking_request_id='${r.request}');
delete from public.booking_cancellations where booking_request_id='${r.request}';
delete from public.booking_request_payment_history where booking_request_id='${r.request}';
delete from public.booking_receipts where booking_confirmation_id='${r.confirmation}';
delete from public.booking_confirmations where id='${r.confirmation}';
delete from public.booking_request_capture_work where booking_request_id='${r.request}';
delete from public.payment_provider_operations where id='${r.operation}';
delete from public.booking_requests where id='${r.request}';
delete from public.cottage_booking_period_commitments where id='${r.commitment}';
delete from public.booking_snapshots where id='${r.snapshot}';
delete from public.owner_application_cottage_profiles where id='${r.profile}';
delete from public.account_names where user_id in ('${r.owner}','${r.customer}','${r.third}');
delete from public.account_contexts where user_id in ('${r.owner}','${r.customer}','${r.third}');
delete from auth.users where id in ('${r.owner}','${r.customer}','${r.third}');
set session_replication_role=origin;`;
};

const paymentRecoveryOpeningDeletes = (
  r,
) => `  alter table public.booking_confirmation_notification_attempts disable trigger reject_booking_confirmation_notification_attempt_change;
  delete from public.booking_confirmation_notification_attempts where notification_id in (select notification_id from public.booking_confirmation_notification_work where booking_request_id='${r.request}');
  alter table public.booking_confirmation_notification_attempts enable trigger reject_booking_confirmation_notification_attempt_change;
  alter table public.fictional_booking_confirmation_notification_effects disable trigger reject_fictional_booking_confirmation_notification_effect_change;
  delete from public.fictional_booking_confirmation_notification_effects where booking_request_id='${r.request}';
  alter table public.fictional_booking_confirmation_notification_effects enable trigger reject_fictional_booking_confirmation_notification_effect_change;
  alter table public.booking_confirmation_notification_work disable trigger guard_booking_confirmation_notification_work;
  delete from public.booking_confirmation_notification_work where booking_request_id='${r.request}';
  alter table public.booking_confirmation_notification_work enable trigger guard_booking_confirmation_notification_work;
  alter table public.booking_notification_events disable trigger reject_booking_notification_events_change;
  delete from public.booking_notification_events where booking_request_id='${r.request}';
  alter table public.booking_notification_events enable trigger reject_booking_notification_events_change;
  alter table public.booking_request_payment_history disable trigger reject_booking_request_payment_history_change;
  delete from public.booking_request_payment_history where booking_request_id='${r.request}';
  alter table public.booking_request_payment_history enable trigger reject_booking_request_payment_history_change;
  alter table public.booking_request_payment_correction_observations disable trigger reject_payment_correction_observation_change;
  delete from public.booking_request_payment_correction_observations where booking_request_id='${r.request}';
  alter table public.booking_request_payment_correction_observations enable trigger reject_payment_correction_observation_change;
  alter table public.booking_request_confirmation_invalidations disable trigger reject_booking_confirmation_invalidation_change;
  delete from public.booking_request_confirmation_invalidations where booking_request_id='${r.request}';
  alter table public.booking_request_confirmation_invalidations enable trigger reject_booking_confirmation_invalidation_change;
`;
const paymentRecoveryDeletes = (
  r,
) => `  delete from public.booking_request_payment_required_expiry_operations where booking_request_id='${r.request}';
  delete from public.booking_request_payment_required_expiry_work where booking_request_id='${r.request}';
  delete from public.booking_request_payment_recovery_operations where recovery_attempt_id in (select id from public.booking_request_payment_recovery_attempts where booking_request_id='${r.request}');
  delete from public.payment_provider_operations where recovery_attempt_id in (select id from public.booking_request_payment_recovery_attempts where booking_request_id='${r.request}');
  delete from public.booking_request_payment_recovery_attempts where booking_request_id='${r.request}';
`;
const releaseOperationDeletes = (
  r,
) => `  update public.booking_request_release_work set active_operation_id=null where booking_request_id='${r.request}';
  delete from public.booking_request_release_operations where work_id in (select id from public.booking_request_release_work where booking_request_id='${r.request}');
`;
const publishedCottageDeletes = (
  r,
) => `  delete from public.cottage_inventory_availability where schedule_revision_id='${r.schedule}';
  delete from public.cottage_inventory_standard_prices where schedule_revision_id='${r.schedule}';
  update public.owner_application_cottage_profiles set current_publication_id=null,current_shift_schedule_id=null where id='${r.profile}';
  alter table public.cottage_publication_snapshots disable trigger reject_cottage_publication_snapshots_delete;
  delete from public.cottage_publication_snapshots where profile_id='${r.profile}';
  alter table public.cottage_publication_snapshots enable trigger reject_cottage_publication_snapshots_delete;
  alter table public.cottage_profile_review_cycles disable trigger reject_cottage_profile_review_cycles_delete;
  delete from public.cottage_profile_review_cycles where profile_id='${r.profile}';
  alter table public.cottage_profile_review_cycles enable trigger reject_cottage_profile_review_cycles_delete;
  alter table public.cottage_profile_source_revisions disable trigger reject_cottage_profile_source_delete;
  delete from public.cottage_profile_source_revisions where profile_id='${r.profile}';
  alter table public.cottage_profile_source_revisions enable trigger reject_cottage_profile_source_delete;
`;

export const captureCleanup = ({
  stem = "100",
  paymentRecovery = false,
  releaseOperations = false,
  publishedCottage = false,
} = {}) => {
  const r = rows(stem);
  return `begin;
${suspensionCleanupPreflight(`'${r.owner}','${r.customer}','${r.third}'`, `'${r.profile}'`, `'${r.request}'`)}${paymentRecovery ? paymentRecoveryOpeningDeletes(r) : ""}  alter table public.booking_notification_events disable trigger reject_booking_notification_events_change;
  delete from public.booking_notification_events where booking_request_id = '${r.request}';
  alter table public.booking_notification_events enable trigger reject_booking_notification_events_change;
  alter table public.payment_provider_operations disable trigger guard_payment_provider_admission;
  alter table public.payment_provider_observations disable trigger guard_payment_provider_observation;
  delete from public.payment_provider_observations where operation_id in (select id from public.payment_provider_operations where claim_id='${r.claim}');
  alter table public.payment_provider_observations enable trigger guard_payment_provider_observation;
  delete from public.simulated_payment_effects where operation_id in (select id from public.payment_provider_operations where claim_id='${r.claim}');
  alter table public.booking_request_payment_history disable trigger reject_booking_request_payment_history_change;
  delete from public.booking_request_payment_history
  where payment_lifecycle_id in (
    select payment_lifecycle_id from public.booking_requests where id = '${r.request}'
  );
  alter table public.booking_request_payment_history enable trigger reject_booking_request_payment_history_change;
  alter table public.booking_receipts disable trigger reject_booking_receipt_change;
  delete from public.booking_receipts where booking_confirmation_id in (
    select id from public.booking_confirmations where booking_request_id = '${r.request}'
  );
  alter table public.booking_receipts enable trigger reject_booking_receipt_change;
  alter table public.booking_confirmations disable trigger reject_booking_confirmation_change;
  delete from public.booking_confirmations where booking_request_id = '${r.request}';
  alter table public.booking_confirmations enable trigger reject_booking_confirmation_change;
${paymentRecovery ? paymentRecoveryDeletes(r) : ""}${releaseOperations ? releaseOperationDeletes(r) : ""}  delete from public.booking_request_release_work where booking_request_id = '${r.request}';
  delete from public.booking_request_capture_work where booking_request_id = '${r.request}';
  delete from public.payment_provider_operations where claim_id = '${r.claim}';
  delete from public.booking_request_provider_operation_identities where attempt_id = '${r.attempt}';
  delete from public.booking_request_authorization_claim_items where claim_id = '${r.claim}';
  delete from public.booking_request_authorization_claim_occupancies where claim_id = '${r.claim}';
  delete from public.booking_request_authorization_claims where id = '${r.claim}';
  delete from public.booking_request_submission_attempts where id = '${r.attempt}';
  delete from public.booking_request_status_notifications where booking_request_id = '${r.request}';
  delete from public.owner_request_notifications where booking_request_id = '${r.request}';
  delete from public.booking_requests where id = '${r.request}';
  alter table public.booking_snapshots disable trigger reject_booking_snapshot_update;
  delete from public.booking_snapshots where id = '${r.snapshot}';
  alter table public.booking_snapshots enable trigger reject_booking_snapshot_update;
  delete from public.cottage_booking_period_occupancies where booking_period_commitment_id = '${r.commitment}';
  delete from public.cottage_booking_period_commitments where id = '${r.commitment}';
${publishedCottage ? publishedCottageDeletes(r) : ""}  alter table public.cottage_shifts disable trigger reject_cottage_shift_delete;
  delete from public.cottage_shifts where schedule_revision_id = '${r.schedule}';
  alter table public.cottage_shifts enable trigger reject_cottage_shift_delete;
  alter table public.cottage_shift_schedule_revisions disable trigger reject_cottage_shift_schedule_revision_delete;
  delete from public.cottage_shift_schedule_revisions where id = '${r.schedule}';
  alter table public.cottage_shift_schedule_revisions enable trigger reject_cottage_shift_schedule_revision_delete;
${suspensionActionDeletes}  delete from public.owner_application_cottage_profiles where id = '${r.profile}';
  delete from public.account_contexts where user_id in ('${r.owner}', '${r.customer}', '${r.third}');
  delete from auth.users where id in ('${r.owner}', '${r.customer}', '${r.third}');
alter table public.payment_provider_operations enable trigger guard_payment_provider_admission;
commit;`;
};

export const publishedCottageCleanup = ({ profiles, users }) => {
  const quoted = (identifiers) =>
    identifiers.map((identifier) => `'${identifier}'`).join(", ");
  const profileList = quoted(profiles);
  const userList = quoted(users);
  const schedules = `select id from public.cottage_shift_schedule_revisions where profile_id in (${profileList})`;
  return `begin;
${suspensionCleanupPreflight(userList, profileList, "")}  delete from public.cottage_booking_period_commitments where profile_id in (${profileList});
  delete from public.cottage_inventory_availability where schedule_revision_id in (${schedules});
  delete from public.cottage_inventory_date_price_overrides where schedule_revision_id in (${schedules});
  delete from public.cottage_inventory_weekday_price_overrides where schedule_revision_id in (${schedules});
  delete from public.cottage_inventory_standard_prices where schedule_revision_id in (${schedules});
  update public.owner_application_cottage_profiles set current_shift_schedule_id = null, current_publication_id = null where id in (${profileList});
  alter table public.cottage_shifts disable trigger reject_cottage_shift_delete;
  delete from public.cottage_shifts where schedule_revision_id in (${schedules});
  alter table public.cottage_shifts enable trigger reject_cottage_shift_delete;
  alter table public.cottage_shift_schedule_revisions disable trigger reject_cottage_shift_schedule_revision_delete;
  delete from public.cottage_shift_schedule_revisions where profile_id in (${profileList});
  alter table public.cottage_shift_schedule_revisions enable trigger reject_cottage_shift_schedule_revision_delete;
  alter table public.cottage_publication_snapshots disable trigger reject_cottage_publication_snapshots_delete;
  delete from public.cottage_publication_snapshots where profile_id in (${profileList});
  alter table public.cottage_publication_snapshots enable trigger reject_cottage_publication_snapshots_delete;
  alter table public.cottage_profile_review_cycles disable trigger reject_cottage_profile_review_cycles_delete;
  delete from public.cottage_profile_review_cycles where profile_id in (${profileList});
  alter table public.cottage_profile_review_cycles enable trigger reject_cottage_profile_review_cycles_delete;
  alter table public.cottage_profile_source_revisions disable trigger reject_cottage_profile_source_delete;
  delete from public.cottage_profile_source_revisions where profile_id in (${profileList});
  alter table public.cottage_profile_source_revisions enable trigger reject_cottage_profile_source_delete;
${suspensionActionDeletes}  delete from public.owner_application_cottage_profiles where id in (${profileList});
  delete from public.account_contexts where user_id in (${userList});
  delete from auth.users where id in (${userList});
commit;`;
};
