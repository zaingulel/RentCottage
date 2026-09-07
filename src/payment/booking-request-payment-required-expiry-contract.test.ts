import { describe, expect, it, vi } from "vitest";

import {
  paymentRequiredExpiryPermitFrom,
  paymentRequiredExpiryRequestMatches,
} from "./booking-request-payment-required-expiry-contract";

import { DurablePaymentSimulator } from "./durable-payment-simulator-core";
import { PaymentSimulator } from "./payment-simulator";

const permit = {
  purpose: "booking-request-payment-required-expiry" as const,
  expiryWorkId: "11111111-1111-4111-8111-111111111111",
  expiryOperationId: "22222222-2222-4222-8222-222222222222",
  idempotencyKey: "release-physical",
  notBefore: "2026-09-07T12:20:00.000Z",
  binding: {
    bookingRequestId: "33333333-3333-4333-8333-333333333333",
    authorizationClaimId: "44444444-4444-4444-8444-444444444444",
    authorizationClaimGeneration: 2,
    authorizationPaymentLifecycleId: "55555555-5555-4555-8555-555555555555",
    authorizationLogicalOperationId: "authorization-logical",
    authorizationPhysicalAttemptId: "authorization-physical",
    predecessorMovementReference: "authorization-movement",
    predecessorOutcomeAt: "2026-09-07T12:00:00.000Z",
    releaseLogicalOperationId: "release-logical",
    releasePhysicalAttemptId: "release-physical",
    amountFils: 115_000_000,
    currency: "IQD" as const,
    requestFingerprint: "a".repeat(64),
    providerIdentity: {
      provider: "fictional-payments",
      environment: "local-test",
      merchantId: "fictional-merchant",
      terminalId: "fictional-terminal",
    },
  },
};

const request = {
  kind: "release" as const,
  paymentLifecycleId: permit.binding.authorizationPaymentLifecycleId,
  logicalOperationId: permit.binding.releaseLogicalOperationId,
  attemptId: permit.binding.releasePhysicalAttemptId,
  amountFils: 115_000_000,
  currency: "IQD" as const,
};

describe("Payment Required expiry provider contract", () => {
  it("accepts only the exact full-amount release binding", () => {
    expect(paymentRequiredExpiryPermitFrom(permit)).toEqual(permit);
    expect(
      paymentRequiredExpiryRequestMatches(
        request,
        permit,
        permit.binding.providerIdentity,
      ),
    ).toBe(true);
  });

  it.each([
    ["capture", { kind: "capture" }],
    ["partial amount", { amountFils: 110_000_000 }],
    [
      "malformed predecessor",
      {
        executionPermit: {
          ...permit,
          binding: { ...permit.binding, predecessorMovementReference: "" },
        },
      },
    ],
  ])("rejects a %s substitution", (_label, replacement) => {
    const changedPermit =
      "executionPermit" in replacement ? replacement.executionPermit : permit;
    expect(
      paymentRequiredExpiryRequestMatches(
        "executionPermit" in replacement
          ? request
          : ({ ...request, ...replacement } as typeof request),
        changedPermit,
        permit.binding.providerIdentity,
      ),
    ).toBe(false);
  });
});

describe("Durable simulator expiry permit", () => {
  const providerResult = {
    outcome: "succeeded",
    providerRequestId: "expiry-request",
    providerReference: "expiry-reference",
    movementReference: "expiry-release",
  };
  it("dispatches only the exact release at or after its fixed deadline", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: providerResult, error: null });
    let now = "2026-09-07T12:19:59.999Z";
    const provider = new DurablePaymentSimulator({
      client: { rpc } as never,
      now: () => now,
    });
    await expect(
      provider.execute({ ...request, executionPermit: permit }),
    ).resolves.toEqual({ outcome: "not-executed" });
    expect(rpc).not.toHaveBeenCalled();
    now = "2026-09-07T12:20:00.000Z";
    await expect(
      provider.execute({ ...request, executionPermit: permit }),
    ).resolves.toEqual(providerResult);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "execute_simulated_booking_request_payment_required_expiry",
      {
        target_permit: permit,
        target_outcome: "succeeded",
      },
    );
    await expect(
      provider.execute({
        ...request,
        kind: "capture",
        executionPermit: permit,
      }),
    ).resolves.toEqual({ outcome: "not-executed" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("queries the same expiry identity and retains the signed-event boundary", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: providerResult, error: null });
    const provider = new DurablePaymentSimulator({
      client: { rpc } as never,
      now: () => "2026-09-07T12:21:00.000Z",
    });
    await expect(
      provider.query({
        ...request,
        expiryPermit: permit,
        providerRequestId: "expiry-request",
        providerReference: "expiry-reference",
      }),
    ).resolves.toEqual(providerResult);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "query_simulated_booking_request_payment_required_expiry",
      {
        target_permit: permit,
        target_provider_request_id: "expiry-request",
        target_provider_reference: "expiry-reference",
        target_outcome: "succeeded",
      },
    );
    expect(provider.verifySignedEvent()).toBe(false);
  });

  it("does not let the in-memory simulator execute a durable expiry permit", async () => {
    const provider = new PaymentSimulator({
      now: () => "2026-09-07T12:21:00.000Z",
      outcomes: ["succeeded"],
    });
    await expect(
      provider.execute({ ...request, executionPermit: permit }),
    ).resolves.toEqual({ outcome: "not-executed" });
    expect(provider.requests).toEqual([]);
  });
});

describe("corrective refund provider contract", () => {
  const refundPermit = {
    ...permit,
    purpose: "booking-request-payment-required-corrective-refund" as const,
    idempotencyKey: "refund-physical",
    binding: {
      bookingRequestId: permit.binding.bookingRequestId,
      captureProviderOperationId: "66666666-6666-4666-8666-666666666666",
      paymentLifecycleId: permit.binding.authorizationPaymentLifecycleId,
      captureLogicalOperationId: "capture-logical",
      capturePhysicalAttemptId: "capture-physical",
      captureMovementReference: "capture-movement",
      captureOccurredAt: "2026-09-07T12:20:00.000Z",
      refundLogicalOperationId: "refund-logical",
      refundPhysicalAttemptId: "refund-physical",
      amountFils: 115_000_000,
      currency: "IQD" as const,
      providerIdentity: permit.binding.providerIdentity,
    },
  };
  const refund = {
    ...request,
    kind: "refund" as const,
    logicalOperationId: "refund-logical",
    attemptId: "refund-physical",
  };
  it("accepts an exact full Customer Total corrective refund bound to the late capture", () => {
    expect(paymentRequiredExpiryPermitFrom(refundPermit)).toEqual(refundPermit);
    expect(
      paymentRequiredExpiryRequestMatches(
        refund,
        refundPermit,
        permit.binding.providerIdentity,
      ),
    ).toBe(true);
  });
  it.each([
    ["amount", { amountFils: 110_000_000 }],
    ["attempt", { attemptId: "other" }],
    [
      "lifecycle",
      { paymentLifecycleId: "77777777-7777-4777-8777-777777777777" },
    ],
    ["release after capture", { kind: "release" }],
  ])("rejects substituted %s", (_label, changed) => {
    expect(
      paymentRequiredExpiryRequestMatches(
        { ...refund, ...changed } as typeof refund,
        refundPermit,
        permit.binding.providerIdentity,
      ),
    ).toBe(false);
  });
  it.each([
    "captureProviderOperationId",
    "captureLogicalOperationId",
    "capturePhysicalAttemptId",
    "captureMovementReference",
    "captureOccurredAt",
  ])("requires the capture binding %s", (key) => {
    expect(() =>
      paymentRequiredExpiryPermitFrom({
        ...refundPermit,
        binding: { ...refundPermit.binding, [key]: "" },
      }),
    ).toThrow();
  });
  it.each(["2026-09-07T12:19:59.999Z", "not-a-time"])(
    "rejects a capture before the deadline or with no authoritative occurrence: %s",
    (captureOccurredAt) => {
      expect(() =>
        paymentRequiredExpiryPermitFrom({
          ...refundPermit,
          binding: { ...refundPermit.binding, captureOccurredAt },
        }),
      ).toThrow();
    },
  );
  it("prevents the in-memory simulator from executing a durable corrective refund", async () => {
    const provider = new PaymentSimulator({
      now: () => "2026-09-07T12:21:00.000Z",
      outcomes: ["succeeded"],
    });
    await expect(
      provider.execute({ ...refund, executionPermit: refundPermit }),
    ).resolves.toEqual({ outcome: "not-executed" });
    expect(provider.requests).toEqual([]);
  });
  it("executes refund through the existing expiry provider boundary", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: "succeeded",
        providerRequestId: "refund-request",
        providerReference: "refund-reference",
        movementReference: "refund-movement",
      },
      error: null,
    });
    const provider = new DurablePaymentSimulator({
      client: { rpc } as never,
      now: () => "2026-09-07T12:21:00.000Z",
    });
    await expect(
      provider.execute({ ...refund, executionPermit: refundPermit }),
    ).resolves.toMatchObject({ outcome: "succeeded" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "execute_simulated_booking_request_payment_required_expiry",
      { target_permit: refundPermit, target_outcome: "succeeded" },
    );
  });
});
