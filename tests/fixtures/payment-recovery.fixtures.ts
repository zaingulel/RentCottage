import type {
  BookingRequestPaymentRecoveryPermit,
  PaymentRecoveryStep,
} from "../../src/payment/booking-request-payment-recovery-contract";
export const recoveryAttemptId = "11111111-1111-4111-8111-111111111111";
export function recoveryPermitFixture(
  step: PaymentRecoveryStep = "replacement-capture",
): BookingRequestPaymentRecoveryPermit {
  const operationId = `${recoveryAttemptId}:${step}`;
  return {
    purpose: "booking-request-payment-recovery",
    attemptId: recoveryAttemptId,
    generation: 1,
    step,
    operationId,
    idempotencyKey: `${operationId}:1`,
    notAfter: "2100-09-06T12:20:00.000Z",
    binding: {
      bookingRequestId: "22222222-2222-4222-8222-222222222222",
      recoveryAttemptId,
      generation: 1,
      step,
      authorizationClaimId: "33333333-3333-4333-8333-333333333333",
      authorizationClaimGeneration: 1,
      predecessorMovementReference: "simulated-predecessor",
      predecessorOutcomeAt: "2026-09-06T12:00:00.000Z",
      paymentLifecycleId: recoveryAttemptId,
      logicalOperationId: operationId,
      physicalAttemptId: `${operationId}:1`,
      amountFils: 105_000_000,
      currency: "IQD",
      requestFingerprint: "a".repeat(64),
      providerIdentity: {
        provider: "fictional-payments",
        environment: "local-test",
        merchantId: "fictional-merchant",
        terminalId: "fictional-terminal",
      },
    },
  };
}
