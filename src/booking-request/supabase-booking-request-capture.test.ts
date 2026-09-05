import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type {
  BookingRequestCaptureExecutionPermit,
  BookingRequestCaptureSnapshot,
} from "@/payment/payment-contract";
import { SupabaseBookingRequestCaptureRepository } from "./supabase-booking-request-capture";

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
const { authorization, capture, movements, ...binding } = snapshot;
const expectation = {
  ...binding,
  authorizationProviderResult: {
    providerRequestId: authorization.providerRequestId,
    providerReference: authorization.providerReference,
    movementReference: authorization.movementReference,
  },
  captureProviderResult: {
    providerRequestId: capture.providerRequestId,
    providerReference: capture.providerReference,
    movementReference: capture.movementReference,
  },
  authorizationRecordedAt: movements[0].recordedAt,
  captureRecordedAt: movements[1].recordedAt,
};
const completed = { status: "complete", snapshot, expectation };
function setup(data: unknown = { status: "leased", permit }) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  const repository = new SupabaseBookingRequestCaptureRepository({
    rpc,
  } as unknown as SupabaseClient);
  return { rpc, repository };
}

describe("Supabase Booking Request Capture repository", () => {
  it("leases only the specified seeded work with the complete provider identity", async () => {
    const { rpc, repository } = setup();
    const result = await repository.lease(
      permit.bookingRequestId,
      permit.providerIdentity,
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "lease_booking_request_capture_work",
      {
        target_booking_request_id: permit.bookingRequestId,
        target_provider_identity: permit.providerIdentity,
      },
    );
    expect(result).toEqual({ status: "leased", permit });
    if (result.status !== "leased") throw new Error("missing lease");
    expect(Object.isFrozen(result.permit)).toBe(true);
    expect(Object.isFrozen(result.permit.providerIdentity)).toBe(true);
  });
  it.each([
    null,
    [],
    {},
    { status: "queued" },
    { status: "processing", permit },
    ...[
      { bookingRequestId: "99999999-9999-4999-8999-999999999999" },
      { submissionAttemptId: "not-uuid" },
      { authorizationClaimId: 1 },
      { authorizationClaimGeneration: 0 },
      { paymentLifecycleId: null },
      { workId: "99999999-9999-4999-8999-999999999999" },
      { amountFils: 0 },
      { amountFils: 1.5 },
      { currency: "USD" },
      { captureLogicalOperationId: "wrong-operation" },
      { capturePhysicalAttemptId: "wrong-attempt" },
      { authorizationLogicalOperationId: "wrong-authorization" },
      { authorizationPhysicalAttemptId: "" },
      { idempotencyKey: "replaced" },
      { requestFingerprint: "not-a-fingerprint" },
      {
        providerIdentity: {
          ...permit.providerIdentity,
          merchantId: "wrong-merchant",
        },
      },
      { leaseGeneration: 0 },
      { leaseToken: "not-uuid" },
      { notAfter: "not-time" },
      { unexpected: "data" },
    ].map((replacement) => ({
      status: "leased",
      permit: { ...permit, ...replacement },
    })),
  ])("rejects malformed or substituted lease evidence %#", async (data) => {
    const { repository } = setup(data);
    await expect(
      repository.lease(permit.bookingRequestId, permit.providerIdentity),
    ).rejects.toThrow();
  });

  it.each(["processing", "expired", "unavailable"] as const)(
    "preserves the exact %s status without fabricating a permit",
    async (status) => {
      const { repository } = setup({ status });
      await expect(
        repository.lease(permit.bookingRequestId, permit.providerIdentity),
      ).resolves.toEqual({ status });
    },
  );

  it("fails loudly when leasing is unavailable even if data claims success", async () => {
    const { repository, rpc } = setup();
    rpc.mockResolvedValue({
      data: { status: "leased", permit },
      error: { message: "database unavailable" },
    });
    await expect(
      repository.lease(permit.bookingRequestId, permit.providerIdentity),
    ).rejects.toThrow("Capture lease is unavailable");
  });

  it("completes with the original lease and provider result and rehydrates immutable ledger-backed evidence", async () => {
    const { repository, rpc } = setup(completed);
    const result = await repository.complete(permit, success);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "complete_booking_request_capture",
      {
        target_booking_request_id: permit.bookingRequestId,
        target_lease_generation: permit.leaseGeneration,
        target_lease_token: permit.leaseToken,
        target_provider_result: success,
      },
    );
    expect(result).toEqual({ status: "complete", snapshot });
    expect(
      [
        result.snapshot,
        result.snapshot.authorization,
        result.snapshot.capture,
        result.snapshot.movements,
        ...result.snapshot.movements,
      ].every(Object.isFrozen),
    ).toBe(true);
    await expect(
      repository.lease(permit.bookingRequestId, permit.providerIdentity),
    ).resolves.toEqual(result);
  });

  it.each([
    null,
    [],
    {},
    { status: "processing" },
    { ...completed, unexpected: true },
    { ...completed, expectation: { ...expectation, extra: true } },
    {
      ...completed,
      snapshot: { ...snapshot, movements: [...snapshot.movements].reverse() },
    },
    {
      ...completed,
      snapshot: {
        ...snapshot,
        capture: { ...snapshot.capture, amountFils: 1 },
      },
    },
    {
      ...completed,
      expectation: { ...expectation, authorizationRecordedAt: null },
    },
    {
      ...completed,
      expectation: {
        ...expectation,
        captureProviderResult: {
          ...expectation.captureProviderResult,
          movementReference: "",
        },
      },
    },
    ...[
      { amountFils: 1 },
      { submissionAttemptId: "99999999-9999-4999-8999-999999999999" },
      { requestFingerprint: "b".repeat(64) },
    ].map((replacement) => ({
      ...completed,
      snapshot: { ...snapshot, ...replacement },
      expectation: { ...expectation, ...replacement },
    })),
  ])("rejects malformed or replaced completion evidence %#", async (data) => {
    const { repository } = setup(data);
    await expect(repository.complete(permit, success)).rejects.toThrow();
  });

  it("rejects provider evidence that differs from the successful result being completed", async () => {
    const { repository } = setup(completed);
    await expect(
      repository.complete(permit, {
        ...success,
        movementReference: "different-movement",
      }),
    ).rejects.toThrow();
  });

  it("fails loudly when completion is unavailable even if data claims success", async () => {
    const { repository, rpc } = setup(completed);
    rpc.mockResolvedValue({
      data: completed,
      error: { message: "database unavailable" },
    });
    await expect(repository.complete(permit, success)).rejects.toThrow(
      "Capture completion is unavailable",
    );
  });
});
