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

const reset = (
  r,
  { completion, terminalRequest },
) => `set session_replication_role=replica;
${completion ? completionDeletes(r) : ""}delete from public.booking_notification_events where booking_request_id='${r.request}';
delete from public.booking_cancellation_administrator_audit where cancellation_id in (select id from public.booking_cancellations where booking_request_id='${r.request}');
delete from public.booking_cancellation_incidents where cancellation_id in (select id from public.booking_cancellations where booking_request_id='${r.request}');
delete from public.booking_cancellations where booking_request_id='${r.request}';
${terminalRequest ? terminalRequestDeletes(r) : ""}delete from public.booking_request_payment_history where booking_request_id='${r.request}' and to_state='cancelled';
update public.cottage_booking_period_commitments set status='confirmed_booking' where id='${r.commitment}';
update public.cottage_booking_period_occupancies set active=true where booking_period_commitment_id='${r.commitment}';
set session_replication_role=origin;`;

export const cancellationReset = ({ completion = false } = {}) =>
  reset(rows("100"), { completion, terminalRequest: false });

export const refundReset = () => {
  const r = rows("100");
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
delete from public.cottage_profile_localized_revisions where review_cycle_id in (select id from public.cottage_profile_review_cycles where profile_id='${r.profile}');
delete from public.cottage_profile_review_cycles where profile_id='${r.profile}';
delete from public.cottage_profile_source_revisions where profile_id='${r.profile}';
`;
const confirmedBookingDeletes = (
  r,
  { workIdentity, listedCottage, users },
) => `delete from public.fictional_booking_confirmation_notification_effects where booking_request_id='${r.request}';
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
delete from public.owner_application_cottage_profiles where id='${r.profile}';
delete from public.account_contexts where user_id in (${users});
delete from auth.users where id in (${users});
`;

export const confirmedBookingCleanup = ({
  stem = "100",
  completion = false,
  settlement = false,
  terminalRequest = false,
} = {}) => {
  const r = rows(stem);
  // Request events have no receipt; cleanup follows the actual work identity.
  const workIdentity = terminalRequest ? "notification_id" : "receipt_id";
  const users = `'${r.owner}','${r.customer}','${r.third}','${administrator}'`;
  return `${reset(r, { completion, terminalRequest })} set session_replication_role=replica;
${settlement ? settlementDeletes(r) : ""}${confirmedBookingDeletes(r, { workIdentity, listedCottage: false, users })}set session_replication_role=origin;`;
};

export const customerReviewCleanup = (namespace) => {
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
  return `set session_replication_role=replica;
delete from public.customer_review_hides where review_id in (select id from public.customer_reviews where booking_request_id='${r.request}');
delete from public.customer_reviews where booking_request_id='${r.request}';
${completionDeletes(r)}delete from public.booking_notification_events where booking_request_id='${r.request}';
${confirmedBookingDeletes(r, { workIdentity: "receipt_id", listedCottage: true, users })}set session_replication_role=origin;`;
};

const lifecycleDeletes = (
  r,
) => `delete from public.booking_cancellation_incidents where cancellation_id in (select id from public.booking_cancellations where booking_request_id='${r.request}');
delete from public.booking_cancellations where booking_request_id='${r.request}';
delete from public.booking_incidents where booking_request_id='${r.request}';
delete from public.booking_lifecycle_outcomes where booking_request_id='${r.request}';
`;

export const confirmedBookingAccessCleanup = ({
  owner = "10000000-0000-4000-8000-000000003501",
  customer = "10000000-0000-4000-8000-000000003502",
  lifecycle = false,
} = {}) => {
  const r = rows("350");
  return `set session_replication_role=replica;
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
delete from public.owner_application_cottage_profiles where id='${r.profile}'; delete from public.account_contexts where user_id in ('${owner}','${customer}','${r.third}'); delete from auth.users where id in ('${owner}','${customer}','${r.third}'); set session_replication_role=origin;`;
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
${paymentRecovery ? paymentRecoveryOpeningDeletes(r) : ""}  alter table public.booking_notification_events disable trigger reject_booking_notification_events_change;
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
  delete from public.owner_application_cottage_profiles where id = '${r.profile}';
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
  delete from public.cottage_booking_period_commitments where profile_id in (${profileList});
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
  delete from public.owner_application_cottage_profiles where id in (${profileList});
  delete from public.account_contexts where user_id in (${userList});
  delete from auth.users where id in (${userList});
commit;`;
};
