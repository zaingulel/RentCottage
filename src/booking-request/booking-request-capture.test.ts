import { describe, expect, it, vi } from "vitest";

import type {
  BookingRequestCaptureExecutionPermit,
  BookingRequestCaptureSnapshot,
  PaymentProviderAdapter,
} from "@/payment/payment-contract";

import {
  createBookingRequestCapture,
  type BookingRequestCaptureRepository,
} from "./booking-request-capture";

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
function setup() {
  const order: string[] = [];
  const repository = {
    lease: vi.fn<BookingRequestCaptureRepository["lease"]>(async () => {
      order.push("lease");
      return { status: "leased" as const, permit };
    }),
    complete: vi.fn<BookingRequestCaptureRepository["complete"]>(async () => {
      order.push("complete");
      return { status: "complete" as const, snapshot };
    }),
  };
  const provider = {
    identity: permit.providerIdentity,
    execute: vi.fn<PaymentProviderAdapter["execute"]>(async () => {
      order.push("provider");
      return success;
    }),
    query: vi.fn(),
    verifySignedEvent: vi.fn(),
  } satisfies PaymentProviderAdapter;
  return {
    order,
    repository,
    provider,
    capture: createBookingRequestCapture({ repository, provider }),
  };
}

describe("Booking Request Capture", () => {
  it("commits the lease before provider execution and completes only with its successful identity", async () => {
    const { capture, order, provider, repository } = setup();
    const result = await capture.execute(permit.bookingRequestId);
    expect(order).toEqual(["lease", "provider", "complete"]);
    expect(repository.lease).toHaveBeenCalledExactlyOnceWith(
      permit.bookingRequestId,
      provider.identity,
    );
    expect(provider.execute).toHaveBeenCalledExactlyOnceWith({
      kind: "capture",
      paymentLifecycleId: permit.paymentLifecycleId,
      logicalOperationId: permit.captureLogicalOperationId,
      attemptId: permit.capturePhysicalAttemptId,
      amountFils: permit.amountFils,
      currency: "IQD",
      executionPermit: permit,
    });
    expect(repository.complete).toHaveBeenCalledExactlyOnceWith(
      permit,
      success,
    );
    expect(result).toBe(await repository.complete.mock.results[0].value);
    expect(provider.query).not.toHaveBeenCalled();
  });
  it.each(["processing", "expired", "unavailable"] as const)(
    "stops %s work without executing, recovering or completing it",
    async (status) => {
      const { capture, repository, provider } = setup();
      repository.lease.mockResolvedValue({ status });
      await expect(capture.execute(permit.bookingRequestId)).resolves.toEqual({
        status,
      });
      expect(provider.execute).not.toHaveBeenCalled();
      expect(repository.complete).not.toHaveBeenCalled();
      expect(provider.query).not.toHaveBeenCalled();
    },
  );

  it("returns existing successful evidence unchanged without another provider call", async () => {
    const { capture, repository, provider } = setup();
    const stored = { status: "complete" as const, snapshot };
    repository.lease.mockResolvedValue(stored);
    await expect(capture.execute(permit.bookingRequestId)).resolves.toBe(
      stored,
    );
    expect(provider.execute).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it.each([
    { bookingRequestId: "99999999-9999-4999-8999-999999999999" },
    { workId: "99999999-9999-4999-8999-999999999999" },
    ...(["provider", "environment", "merchantId", "terminalId"] as const).map(
      (key) => ({
        providerIdentity: {
          ...permit.providerIdentity,
          [key]: "wrong-provider",
        },
      }),
    ),
  ])(
    "rejects work bound to another request or provider",
    async (replacement) => {
      const { capture, repository, provider } = setup();
      repository.lease.mockResolvedValue({
        status: "leased",
        permit: { ...permit, ...replacement },
      });
      await expect(capture.execute(permit.bookingRequestId)).rejects.toThrow(
        "Capture permit does not match",
      );
      expect(provider.execute).not.toHaveBeenCalled();
      expect(repository.complete).not.toHaveBeenCalled();
    },
  );

  it.each([
    { outcome: "not-executed" as const },
    { ...success, outcome: "indeterminate" as const },
    {
      outcome: "failed" as const,
      providerRequestId: "failed",
      providerReference: "failed",
      retrySafe: true,
    },
  ])(
    "fails loudly for $outcome provider evidence without completion or retry",
    async (result) => {
      const { capture, repository, provider } = setup();
      provider.execute.mockResolvedValue(result);
      await expect(capture.execute(permit.bookingRequestId)).rejects.toThrow(
        "did not return successful provider evidence",
      );
      expect(repository.complete).not.toHaveBeenCalled();
      expect(provider.execute).toHaveBeenCalledTimes(1);
      expect(provider.query).not.toHaveBeenCalled();
    },
  );

  it.each(["lease", "provider", "complete"] as const)(
    "propagates %s failure without claiming success",
    async (stage) => {
      const { capture, repository, provider } = setup();
      const failure = new Error("durable evidence unavailable");
      (stage === "provider"
        ? provider.execute
        : repository[stage]
      ).mockRejectedValue(failure);
      await expect(capture.execute(permit.bookingRequestId)).rejects.toBe(
        failure,
      );
      expect(provider.query).not.toHaveBeenCalled();
      if (stage !== "complete")
        expect(repository.complete).not.toHaveBeenCalled();
    },
  );
});
