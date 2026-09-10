export function withPaymentRecoveryCleanup(cleanup, requestId) {
  return cleanup
    .replace(
      "begin;",
      `begin;
  alter table public.booking_confirmation_notification_attempts disable trigger reject_booking_confirmation_notification_attempt_change;
  delete from public.booking_confirmation_notification_attempts where receipt_id in (select receipt.id from public.booking_receipts receipt join public.booking_confirmations confirmation on confirmation.id=receipt.booking_confirmation_id where confirmation.booking_request_id='${requestId}');
  alter table public.booking_confirmation_notification_attempts enable trigger reject_booking_confirmation_notification_attempt_change;
  alter table public.fictional_booking_confirmation_notification_effects disable trigger reject_fictional_booking_confirmation_notification_effect_change;
  delete from public.fictional_booking_confirmation_notification_effects where receipt_id in (select receipt.id from public.booking_receipts receipt join public.booking_confirmations confirmation on confirmation.id=receipt.booking_confirmation_id where confirmation.booking_request_id='${requestId}');
  alter table public.fictional_booking_confirmation_notification_effects enable trigger reject_fictional_booking_confirmation_notification_effect_change;
  alter table public.booking_confirmation_notification_work disable trigger guard_booking_confirmation_notification_work;
  delete from public.booking_confirmation_notification_work where receipt_id in (select receipt.id from public.booking_receipts receipt join public.booking_confirmations confirmation on confirmation.id=receipt.booking_confirmation_id where confirmation.booking_request_id='${requestId}');
  alter table public.booking_confirmation_notification_work enable trigger guard_booking_confirmation_notification_work;
  alter table public.booking_request_payment_history disable trigger reject_booking_request_payment_history_change;
  delete from public.booking_request_payment_history where booking_request_id='${requestId}';
  alter table public.booking_request_payment_history enable trigger reject_booking_request_payment_history_change;
  alter table public.booking_request_payment_correction_observations disable trigger reject_payment_correction_observation_change;
  delete from public.booking_request_payment_correction_observations where booking_request_id='${requestId}';
  alter table public.booking_request_payment_correction_observations enable trigger reject_payment_correction_observation_change;
  alter table public.booking_request_confirmation_invalidations disable trigger reject_booking_confirmation_invalidation_change;
  delete from public.booking_request_confirmation_invalidations where booking_request_id='${requestId}';
  alter table public.booking_request_confirmation_invalidations enable trigger reject_booking_confirmation_invalidation_change;
`,
    )
    .replace(
      "  delete from public.booking_request_release_work",
      `
  delete from public.booking_request_payment_required_expiry_operations where booking_request_id='${requestId}';
  delete from public.booking_request_payment_required_expiry_work where booking_request_id='${requestId}';
  delete from public.booking_request_payment_recovery_operations where recovery_attempt_id in (select id from public.booking_request_payment_recovery_attempts where booking_request_id='${requestId}');
  delete from public.payment_provider_operations where recovery_attempt_id in (select id from public.booking_request_payment_recovery_attempts where booking_request_id='${requestId}');
  delete from public.booking_request_payment_recovery_attempts where booking_request_id='${requestId}';
  delete from public.booking_request_release_work`,
    );
}
