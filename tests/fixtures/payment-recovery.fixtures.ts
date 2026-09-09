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

import type {
  BookingRequestPaymentFacts,
  PaymentOperationFact,
} from "../../src/booking-request/booking-request-payment-observation";
export const paymentRequestId = "22222222-2222-4222-8222-222222222222";
export function paymentOperationFixture(
  overrides: Partial<PaymentOperationFact> = {},
): PaymentOperationFact {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    kind: "capture",
    lifecycleId: "33333333-3333-4333-8333-333333333333",
    logicalOperationId: "original-capture",
    physicalAttemptId: "original-capture:1",
    outcome: "failed",
    originalOutcome: "failed",
    occurredAt: "2026-09-06T12:00:00.000Z",
    executedAt: "2026-09-06T12:00:00.000Z",
    recordedAt: "2026-09-06T12:00:00.000Z",
    provenance: "fictional-provider",
    movementReference: null,
    providerRequestId: "request",
    providerReference: "reference",
    recoveryAttemptId: null,
    recoveryOperationId: null,
    recoveryStep: null,
    valid: true,
    permit: null,
    ...overrides,
  };
}
export function paymentFactsFixture(
  overrides: Partial<BookingRequestPaymentFacts> = {},
): BookingRequestPaymentFacts {
  const original = paymentOperationFixture();
  return {
    bookingRequestId: paymentRequestId,
    revision: "a".repeat(32),
    observedAt: "2026-09-06T12:01:00.000Z",
    deadline: "2026-09-06T12:20:00.000Z",
    amountFils: 105_000_000,
    providerIdentity: recoveryPermitFixture().binding.providerIdentity,
    sourceValid: true,
    quarantined: false,
    expired: false,
    confirmationValid: false,
    originalLifecycleId: original.lifecycleId,
    originalAuthorizationId: null,
    originalCaptureId: original.id,
    attempts: [{ id: recoveryAttemptId, generation: 1, state: "admitted" }],
    operations: [original],
    expiryOperations: [],
    receipts: [],
    ...overrides,
  };
}
