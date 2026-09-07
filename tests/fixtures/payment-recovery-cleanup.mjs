export function withPaymentRecoveryCleanup(cleanup, requestId) {
  return cleanup
    .replace(
      "begin;",
      `begin;
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
  delete from public.simulated_payment_provider_operations where recovery_attempt_id in (select id from public.booking_request_payment_recovery_attempts where booking_request_id='${requestId}');
  delete from public.booking_request_payment_recovery_attempts where booking_request_id='${requestId}';
  delete from public.booking_request_release_work`,
    );
}
