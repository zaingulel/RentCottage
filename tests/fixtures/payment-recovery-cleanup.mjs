export function withPaymentRecoveryCleanup(cleanup, requestId) {
  return cleanup.replace(
    "  delete from public.booking_request_release_work",
    `
  delete from public.booking_request_payment_recovery_operations where recovery_attempt_id in (select id from public.booking_request_payment_recovery_attempts where booking_request_id='${requestId}');
  delete from public.simulated_payment_provider_operations where recovery_attempt_id in (select id from public.booking_request_payment_recovery_attempts where booking_request_id='${requestId}');
  delete from public.booking_request_payment_recovery_attempts where booking_request_id='${requestId}';
  delete from public.booking_request_release_work`,
  );
}
