import { describe, expect, it, vi } from "vitest";

import { SupabaseBookingRequestPaymentRequiredExpiryRepository } from "./supabase-booking-request-payment-required-expiry";

const requestId = "11111111-1111-4111-8111-111111111111";
const identity = {
  provider: "fictional-payments",
  environment: "local-test",
  merchantId: "fictional-merchant",
  terminalId: "fictional-terminal",
};

const permit = {
  purpose: "booking-request-payment-required-expiry" as const,
  expiryWorkId: "22222222-2222-4222-8222-222222222222",
  expiryOperationId: "33333333-3333-4333-8333-333333333333",
  idempotencyKey: "release-physical",
  notBefore: "2026-09-07T12:20:00.000000Z",
  binding: {
    bookingRequestId: requestId,
    authorizationClaimId: "44444444-4444-4444-8444-444444444444",
    authorizationClaimGeneration: 1,
    authorizationPaymentLifecycleId: "55555555-5555-4555-8555-555555555555",
    authorizationLogicalOperationId: "authorization-logical",
    authorizationPhysicalAttemptId: "authorization-physical",
    predecessorMovementReference: "authorization-movement",
    predecessorOutcomeAt: "2026-09-07T12:00:00.000000Z",
    releaseLogicalOperationId: "release-logical",
    releasePhysicalAttemptId: "release-physical",
    amountFils: 115_000_000,
    currency: "IQD" as const,
    requestFingerprint: "a".repeat(64),
    providerIdentity: identity,
  },
};

describe("Supabase Payment Required expiry repository", () => {
  it("uses the bounded service interfaces and rejects duplicate due requests", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { bookingRequestId: requestId, deadline: "2026-09-07T12:20:00.000Z" },
        { bookingRequestId: requestId, deadline: "2026-09-07T12:20:00.000Z" },
      ],
      error: null,
    });
    const repository =
      new SupabaseBookingRequestPaymentRequiredExpiryRepository({
        rpc,
      } as never);
    await expect(repository.due(20, identity)).rejects.toThrow(
      "batch is invalid",
    );
    expect(rpc).toHaveBeenCalledWith(
      "claim_due_booking_request_payment_required_expiries",
      { target_limit: 20, target_provider_identity: identity },
    );
  });

  it("fails closed on a malformed full-amount release instruction", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: "release",
        permit: { purpose: "booking-request-payment-required-expiry" },
        binding: { kind: "release", amountFils: 110_000_000 },
      },
      error: null,
    });
    const repository =
      new SupabaseBookingRequestPaymentRequiredExpiryRepository({
        rpc,
      } as never);
    await expect(repository.prepare(requestId, identity)).rejects.toThrow(
      "data is invalid",
    );
  });

  it("accepts semantically identical JSONB bindings regardless of key order", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: "release",
        permit,
        binding: Object.fromEntries(Object.entries(permit.binding).reverse()),
      },
      error: null,
    });
    const repository =
      new SupabaseBookingRequestPaymentRequiredExpiryRepository({
        rpc,
      } as never);
    await expect(
      repository.prepare(requestId, identity),
    ).resolves.toMatchObject({
      status: "release",
      binding: { kind: "release", amountFils: 115_000_000, currency: "IQD" },
    });
    rpc.mockResolvedValueOnce({
      data: {
        status: "release",
        permit,
        binding: { ...permit.binding, amountFils: 110_000_000 },
      },
      error: null,
    });
    await expect(repository.prepare(requestId, identity)).rejects.toThrow(
      "data is invalid",
    );
    await expect(
      repository.prepare(requestId, {
        ...identity,
        merchantId: "foreign-merchant",
      }),
    ).rejects.toThrow("data is invalid");
  });

  it("returns only a bound terminal finalization result", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: "expired", bookingRequestId: requestId },
      error: null,
    });
    const repository =
      new SupabaseBookingRequestPaymentRequiredExpiryRepository({
        rpc,
      } as never);
    await expect(repository.finalize(requestId)).resolves.toEqual({
      status: "expired",
    });
    expect(rpc).toHaveBeenCalledWith(
      "finalize_booking_request_payment_required_expiry",
      { target_booking_request_id: requestId },
    );
  });
});
