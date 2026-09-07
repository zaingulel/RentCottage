import { describe, expect, it, vi } from "vitest";

import type { PaymentProviderAdapter } from "@/payment/payment-contract";
import { createBookingRequestPaymentRequiredExpiry } from "./booking-request-payment-required-expiry";

const requestId = "11111111-1111-4111-8111-111111111111";
const operation = {
  kind: "release" as const,
  paymentLifecycleId: "22222222-2222-4222-8222-222222222222",
  logicalOperationId: "release-logical",
  attemptId: "release-physical",
  amountFils: 115_000_000,
  currency: "IQD" as const,
};
const permit = {
  purpose: "booking-request-payment-required-expiry" as const,
  expiryWorkId: "33333333-3333-4333-8333-333333333333",
  expiryOperationId: "44444444-4444-4444-8444-444444444444",
  idempotencyKey: "expiry-release:1",
  notBefore: "2026-09-07T12:20:00.000Z",
  binding: {} as never,
};
const identity = {
  provider: "fictional-payments",
  environment: "local-test",
  merchantId: "fictional-merchant",
  terminalId: "fictional-terminal",
};

function setup() {
  const repository = {
    due: vi.fn().mockResolvedValue([requestId]),
    prepare: vi.fn().mockResolvedValue({
      status: "release" as const,
      permit,
      binding: operation,
    }),
    finalize: vi.fn().mockResolvedValue({ status: "expired" as const }),
  };
  const provider: PaymentProviderAdapter = {
    identity,
    execute: vi.fn().mockResolvedValue({
      outcome: "succeeded",
      providerRequestId: "provider-request",
      providerReference: "provider-reference",
      movementReference: "release-movement",
    }),
    query: vi.fn(),
    verifySignedEvent: () => false,
  };
  return {
    repository,
    provider,
    service: createBookingRequestPaymentRequiredExpiry({
      repository,
      provider,
    }),
  };
}

describe("Payment Required expiry processing", () => {
  it("performs one bound release and finalizes from fresh database evidence", async () => {
    const { service, repository, provider } = setup();
    await expect(service.processDue(20)).resolves.toEqual([
      { status: "expired" },
    ]);
    expect(repository.due).toHaveBeenCalledWith(20, identity);
    expect(provider.execute).toHaveBeenCalledExactlyOnceWith({
      ...operation,
      executionPermit: permit,
    });
    expect(repository.finalize).toHaveBeenCalledExactlyOnceWith(requestId);
  });

  it("does not treat failed or indeterminate release evidence as expiry proof", async () => {
    const { service, provider, repository } = setup();
    vi.mocked(provider.execute).mockResolvedValueOnce({
      outcome: "failed",
      providerRequestId: "provider-request",
      providerReference: "provider-reference",
      retrySafe: false,
    });
    repository.finalize.mockResolvedValueOnce({
      status: "attention-required",
    });
    await expect(service.processDue(20)).resolves.toEqual([
      { status: "attention-required" },
    ]);
  });

  it("reevaluates durable state after not-executed instead of inventing attention", async () => {
    const { service, repository, provider } = setup();
    vi.mocked(provider.execute).mockResolvedValueOnce({
      outcome: "not-executed",
    });
    repository.finalize.mockResolvedValueOnce({ status: "processing" });
    await expect(service.processDue(20)).resolves.toEqual([
      { status: "processing" },
    ]);
    expect(repository.finalize).toHaveBeenCalledExactlyOnceWith(requestId);
  });

  it("continues after one request is unavailable", async () => {
    const { service, repository } = setup();
    const second = "55555555-5555-4555-8555-555555555555";
    repository.due.mockResolvedValue([requestId, second]);
    repository.prepare
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ status: "ready" });
    repository.finalize.mockResolvedValueOnce({ status: "expired" });
    await expect(service.processDue(20)).resolves.toEqual([
      { status: "unavailable" },
      { status: "expired" },
    ]);
  });

  it.each([0, 51, 1.5, Number.NaN])(
    "rejects invalid limit %s before repository access",
    async (limit) => {
      const { service, repository } = setup();
      await expect(service.processDue(limit)).resolves.toEqual([
        { status: "invalid" },
      ]);
      expect(repository.due).not.toHaveBeenCalled();
    },
  );
});
