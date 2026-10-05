// One home for the reset and cleanup SQL of the shared fixed-identifier booking fixtures.
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

export const confirmedBookingCleanup = ({
  stem = "100",
  completion = false,
  settlement = false,
  terminalRequest = false,
} = {}) => {
  const r = rows(stem);
  // Request events have no receipt; cleanup follows the actual work identity.
  const workIdentity = terminalRequest ? "notification_id" : "receipt_id";
  return `${reset(r, { completion, terminalRequest })} set session_replication_role=replica;
${settlement ? settlementDeletes(r) : ""}delete from public.fictional_booking_confirmation_notification_effects where booking_request_id='${r.request}';
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
delete from public.cottage_shifts where schedule_revision_id='${r.schedule}';
delete from public.cottage_shift_schedule_revisions where id='${r.schedule}';
delete from public.owner_application_cottage_profiles where id='${r.profile}';
delete from public.account_contexts where user_id in ('${r.owner}','${r.customer}','${r.third}','${administrator}');
delete from auth.users where id in ('${r.owner}','${r.customer}','${r.third}','${administrator}');
set session_replication_role=origin;`;
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
