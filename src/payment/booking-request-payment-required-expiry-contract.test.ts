import { describe, expect, it, vi } from "vitest";

import {
  paymentRequiredExpiryPermitFrom,
  paymentRequiredExpiryRequestMatches,
} from "./booking-request-payment-required-expiry-contract";

import { SupabasePaymentOperationExecutionRepository } from "./supabase-payment-operation-execution";
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

describe("Durable expiry admission", () => {
  it("passes the fixed database deadline with the exact release admission", async () => {
    const admission = {
      purpose: permit.purpose,
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      providerIdentity: permit.binding.providerIdentity,
      binding: request,
      idempotencyKey: permit.idempotencyKey,
      requestFingerprint: permit.binding.requestFingerprint,
      notBefore: permit.notBefore,
      notAfter: null,
      mode: "execute",
    };
    const rpc = vi.fn().mockResolvedValue({ data: admission, error: null });
    const repository = new SupabasePaymentOperationExecutionRepository({
      rpc,
    } as never);
    await expect(
      repository.admit(
        { ...request, executionPermit: permit },
        permit.binding.providerIdentity,
      ),
    ).resolves.toEqual(admission);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "admit_booking_request_payment_required_expiry",
      { target_permit: permit },
    );
    rpc.mockClear();
    await expect(
      repository.admit(
        { ...request, kind: "capture", executionPermit: permit },
        permit.binding.providerIdentity,
      ),
    ).rejects.toThrow("permit");
    expect(rpc).not.toHaveBeenCalled();
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
  it("admits the exact corrective refund through the expiry integrity boundary", async () => {
    const admission = {
      purpose: refundPermit.purpose,
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      providerIdentity: refundPermit.binding.providerIdentity,
      binding: refund,
      idempotencyKey: refundPermit.idempotencyKey,
      requestFingerprint: "a".repeat(64),
      notBefore: refundPermit.notBefore,
      notAfter: null,
      mode: "execute",
    };
    const rpc = vi.fn().mockResolvedValue({ data: admission, error: null });
    const repository = new SupabasePaymentOperationExecutionRepository({
      rpc,
    } as never);
    await expect(
      repository.admit(
        { ...refund, executionPermit: refundPermit },
        refundPermit.binding.providerIdentity,
      ),
    ).resolves.toEqual(admission);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "admit_booking_request_payment_required_expiry",
      { target_permit: refundPermit },
    );
  });
});
