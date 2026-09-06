import { describe, expect, it, vi } from "vitest";
import type {
  BookingRequestCaptureExecutionPermit,
  BookingRequestCaptureSnapshot,
  PaymentProviderAdapter,
} from "@/payment/payment-contract";
import type { BookingRequestConfirmation } from "./booking-request-confirmation";
import {
  createBookingRequestCaptureRecovery,
  type BookingRequestCaptureRecoveryRepository,
} from "./booking-request-capture-recovery";

const permit: BookingRequestCaptureExecutionPermit = {
  purpose: "booking-request-capture",
  bookingRequestId: "11111111-1111-4111-8111-111111111111",
  submissionAttemptId: "22222222-2222-4222-8222-222222222222",
  authorizationClaimId: "33333333-3333-4333-8333-333333333333",
  authorizationClaimGeneration: 1,
  paymentLifecycleId: "44444444-4444-4444-8444-444444444444",
  authorizationLogicalOperationId:
    "44444444-4444-4444-8444-444444444444:authorization",
  authorizationPhysicalAttemptId:
    "44444444-4444-4444-8444-444444444444:authorization:attempt-1",
  captureLogicalOperationId: "44444444-4444-4444-8444-444444444444:capture",
  capturePhysicalAttemptId:
    "44444444-4444-4444-8444-444444444444:capture:attempt-2",
  amountFils: 105_000_000,
  currency: "IQD",
  providerIdentity: {
    provider: "fictional-payments",
    environment: "local-test",
    merchantId: "fictional-merchant",
    terminalId: "fictional-terminal",
  },
  idempotencyKey:
    "booking-request-capture:11111111-1111-4111-8111-111111111111:1",
  requestFingerprint:
    "dfaa1a57856db906347ce1c5505c9404780cfb696173afeee22beb9121a38469",
  workId: "11111111-1111-4111-8111-111111111111",
  leaseGeneration: 1,
  leaseToken: "55555555-5555-4555-8555-555555555555",
  notAfter: "2099-01-01T00:00:30.000Z",
};
const success = {
  outcome: "succeeded" as const,
  providerRequestId: "capture-request",
  providerReference: "capture-reference",
  movementReference: "capture-movement",
};

const snapshot: BookingRequestCaptureSnapshot = {
  bookingRequestId: permit.bookingRequestId,
  submissionAttemptId: permit.submissionAttemptId,
  authorizationClaimId: permit.authorizationClaimId,
  authorizationClaimGeneration: permit.authorizationClaimGeneration,
  paymentLifecycleId: permit.paymentLifecycleId,
  authorizationLogicalOperationId: permit.authorizationLogicalOperationId,
  authorizationPhysicalAttemptId: permit.authorizationPhysicalAttemptId,
  captureLogicalOperationId: permit.captureLogicalOperationId,
  capturePhysicalAttemptId: permit.capturePhysicalAttemptId,
  amountFils: permit.amountFils,
  currency: permit.currency,
  providerIdentity: permit.providerIdentity,
  idempotencyKey: permit.idempotencyKey,
  requestFingerprint: permit.requestFingerprint,
  authorization: {
    paymentLifecycleId: permit.paymentLifecycleId,
    kind: "authorization",
    logicalOperationId: permit.authorizationLogicalOperationId,
    attemptId: permit.authorizationPhysicalAttemptId,
    status: "succeeded",
    amountFils: permit.amountFils,
    providerRequestId: "auth-request",
    providerReference: "auth-reference",
    movementReference: "auth-movement",
    reconciliationRequired: false,
    retrySafe: false,
  },
  capture: {
    paymentLifecycleId: permit.paymentLifecycleId,
    kind: "capture",
    logicalOperationId: permit.captureLogicalOperationId,
    attemptId: permit.capturePhysicalAttemptId,
    status: "succeeded",
    amountFils: permit.amountFils,
    providerRequestId: success.providerRequestId,
    providerReference: success.providerReference,
    movementReference: success.movementReference,
    reconciliationRequired: false,
    retrySafe: false,
  },
  movements: [
    {
      kind: "authorization",
      logicalOperationId: permit.authorizationLogicalOperationId,
      attemptId: permit.authorizationPhysicalAttemptId,
      amountFils: permit.amountFils,
      movementReference: "auth-movement",
      recordedAt: "2099-01-01T00:00:00.000Z",
    },
    {
      kind: "capture",
      logicalOperationId: permit.captureLogicalOperationId,
      attemptId: permit.capturePhysicalAttemptId,
      amountFils: permit.amountFils,
      movementReference: "capture-movement",
      recordedAt: "2099-01-01T00:00:01.000Z",
    },
  ],
};

const leaseFields = { ...permit };
Reflect.deleteProperty(leaseFields, "purpose");
const lease = {
  ...leaseFields,
  leaseGeneration: 2,
  recoveryOperationId: "66666666-6666-4666-8666-666666666666",
  providerResult: {
    providerRequestId: success.providerRequestId,
    providerReference: success.providerReference,
    movementReference: success.movementReference,
  },
};
function setup() {
  const repository = {
    claimDue: vi
      .fn<BookingRequestCaptureRecoveryRepository["claimDue"]>()
      .mockResolvedValue([{ status: "reconcile", lease }]),
    complete: vi
      .fn<BookingRequestCaptureRecoveryRepository["complete"]>()
      .mockResolvedValue({ status: "complete", snapshot }),
  };
  const provider = {
    identity: permit.providerIdentity,
    execute: vi.fn(),
    query: vi.fn<PaymentProviderAdapter["query"]>().mockResolvedValue(success),
    verifySignedEvent: vi.fn(),
  } satisfies PaymentProviderAdapter;
  const confirmed = {
    bookingRequestId: permit.bookingRequestId,
    commitmentId: "commitment",
    bookingReference: "BK-123",
    confirmedAt: "2099-01-01T00:00:02.000Z",
    capturePhysicalAttemptId: permit.capturePhysicalAttemptId,
    captureMovementReference: "capture-movement",
    receipts: {
      customer: { id: "customer-receipt", recipientId: "customer" },
      cottageOwner: { id: "owner-receipt", recipientId: "owner" },
    },
  };
  const confirmation = {
    execute: vi
      .fn<BookingRequestConfirmation["execute"]>()
      .mockResolvedValue(confirmed),
  };
  return {
    repository,
    provider,
    confirmation,
    confirmed,
    recovery: createBookingRequestCaptureRecovery({
      repository,
      provider,
      confirmation,
    }),
  };
}
describe("Booking Request Capture recovery", () => {
  it("queries the original capture then completes and confirms through its reclaimed lease without another execution", async () => {
    const { recovery, provider, repository, confirmation, confirmed } = setup();
    await expect(recovery.processDue()).resolves.toEqual([
      { status: "confirmed", confirmation: confirmed },
    ]);
    expect(repository.claimDue).toHaveBeenCalledExactlyOnceWith(
      20,
      provider.identity,
    );
    expect(provider.query).toHaveBeenCalledExactlyOnceWith({
      kind: "capture",
      paymentLifecycleId: permit.paymentLifecycleId,
      logicalOperationId: permit.captureLogicalOperationId,
      attemptId: permit.capturePhysicalAttemptId,
      amountFils: permit.amountFils,
      currency: "IQD",
      providerRequestId: success.providerRequestId,
      providerReference: success.providerReference,
    });
    expect(repository.complete).toHaveBeenCalledExactlyOnceWith(lease, success);
    expect(confirmation.execute).toHaveBeenCalledExactlyOnceWith(
      permit.bookingRequestId,
      snapshot,
    );
    expect(repository.complete.mock.invocationCallOrder[0]).toBeLessThan(
      confirmation.execute.mock.invocationCallOrder[0],
    );
    expect(provider.execute).not.toHaveBeenCalled();
  });
  it("leaves indeterminate evidence processing without completion or execution", async () => {
    const { recovery, provider, repository, confirmation } = setup();
    provider.query.mockResolvedValue({ ...success, outcome: "indeterminate" });
    await expect(recovery.processDue()).resolves.toEqual([
      { status: "processing" },
    ]);
    expect(repository.complete).not.toHaveBeenCalled();
    expect(confirmation.execute).not.toHaveBeenCalled();
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it.each([0, 51, 1.5, NaN, Infinity])(
    "rejects invalid drain limit %s before repository access",
    async (limit) => {
      const { recovery, repository } = setup();
      await expect(recovery.processDue(limit)).resolves.toEqual([
        { status: "invalid" },
      ]);
      expect(repository.claimDue).not.toHaveBeenCalled();
    },
  );
  it("confirms completed evidence without contacting the provider", async () => {
    const { recovery, repository, provider, confirmation } = setup();
    repository.claimDue.mockResolvedValue([{ status: "complete", snapshot }]);
    await recovery.processDue(50);
    expect(repository.claimDue).toHaveBeenCalledWith(50, provider.identity);
    expect(confirmation.execute).toHaveBeenCalledWith(
      permit.bookingRequestId,
      snapshot,
    );
    expect(provider.query).not.toHaveBeenCalled();
    expect(provider.execute).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });
  it("reports unavailable evidence and empty drains explicitly", async () => {
    const { recovery, repository, provider } = setup();
    repository.claimDue
      .mockResolvedValueOnce([{ status: "unavailable" }])
      .mockResolvedValueOnce([]);
    await expect(recovery.processDue()).resolves.toEqual([
      { status: "unavailable" },
    ]);
    await expect(recovery.processDue()).resolves.toEqual([]);
    expect(provider.query).not.toHaveBeenCalled();
    expect(provider.execute).not.toHaveBeenCalled();
  });
  it.each([
    "providerRequestId",
    "providerReference",
    "movementReference",
  ] as const)("refuses replaced %s before completion", async (field) => {
    const { recovery, provider, repository } = setup();
    provider.query.mockResolvedValue({ ...success, [field]: "replacement" });
    await expect(recovery.processDue()).rejects.toThrow(
      "Capture recovery provider evidence does not match",
    );
    expect(repository.complete).not.toHaveBeenCalled();
  });
  it("refuses work assigned to another provider", async () => {
    const { recovery, repository, provider } = setup();
    repository.claimDue.mockResolvedValue([
      {
        status: "reconcile",
        lease: {
          ...lease,
          providerIdentity: { ...provider.identity, merchantId: "wrong" },
        },
      },
    ]);
    await expect(recovery.processDue()).rejects.toThrow(
      "Capture recovery provider does not match",
    );
    expect(provider.query).not.toHaveBeenCalled();
  });
  it.each(["claimDue", "query", "complete", "confirmation"] as const)(
    "propagates %s failure without another execution",
    async (stage) => {
      const { recovery, repository, provider, confirmation } = setup();
      const failure = new Error("Unavailable durable evidence");
      (stage === "query"
        ? provider.query
        : stage === "confirmation"
          ? confirmation.execute
          : repository[stage]
      ).mockRejectedValue(failure);
      await expect(recovery.processDue()).rejects.toBe(failure);
      expect(provider.execute).not.toHaveBeenCalled();
    },
  );
  it.each([
    { outcome: "not-executed" as const },
    {
      outcome: "failed" as const,
      providerRequestId: "failed",
      providerReference: "failed",
      retrySafe: true,
    },
  ])("refuses $outcome without execution or confirmation", async (result) => {
    const { recovery, provider, confirmation } = setup();
    provider.query.mockResolvedValue(result);
    await expect(recovery.processDue()).rejects.toThrow(
      "did not return successful provider evidence",
    );
    expect(provider.execute).not.toHaveBeenCalled();
    expect(confirmation.execute).not.toHaveBeenCalled();
  });
});
