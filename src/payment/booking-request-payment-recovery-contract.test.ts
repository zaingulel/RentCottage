import { describe, expect, it, vi } from "vitest";
import { recoveryPermitFixture } from "../../tests/fixtures/payment-recovery.fixtures";
import {
  recoveryBindingFrom,
  recoveryPermitFrom,
} from "./booking-request-payment-recovery-contract";
import { SupabasePaymentOperationExecutionRepository } from "./supabase-payment-operation-execution";

describe("Booking Request recovery provider contract", () => {
  it.each([
    ["original-release", "release"],
    ["replacement-authorization", "authorization"],
    ["replacement-capture", "capture"],
    ["replacement-release", "release"],
  ] as const)("admits %s only with operation kind %s", async (step, kind) => {
    const permit = recoveryPermitFixture(step);
    const request = {
      kind,
      paymentLifecycleId: permit.binding.paymentLifecycleId,
      logicalOperationId: permit.operationId,
      attemptId: permit.idempotencyKey,
      amountFils: permit.binding.amountFils,
      currency: "IQD" as const,
      executionPermit: permit,
    };
    const admission = {
      purpose: permit.purpose,
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      providerIdentity: permit.binding.providerIdentity,
      binding: request,
      idempotencyKey: permit.idempotencyKey,
      requestFingerprint: "a".repeat(64),
      notBefore: null,
      notAfter: permit.notAfter,
      mode: "execute",
    };
    const rpc = vi.fn().mockResolvedValue({ data: admission, error: null });
    const repository = new SupabasePaymentOperationExecutionRepository({
      rpc,
    } as never);
    await expect(
      repository.admit(request, permit.binding.providerIdentity),
    ).resolves.toEqual(admission);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "admit_booking_request_payment_recovery",
      { target_permit: permit },
    );
    rpc.mockClear();
    await expect(
      repository.admit(
        { ...request, kind: kind === "release" ? "capture" : "release" },
        permit.binding.providerIdentity,
      ),
    ).rejects.toThrow("permit");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("validates a complete request, claim, replacement and predecessor binding", () => {
    const permit = recoveryPermitFixture();
    expect(recoveryPermitFrom(permit)).toEqual(permit);
  });
  it.each([null, "", undefined])(
    "rejects a missing predecessor %s",
    (predecessor) => {
      expect(() =>
        recoveryBindingFrom({
          ...recoveryPermitFixture().binding,
          predecessorMovementReference: predecessor,
        }),
      ).toThrow();
    },
  );
  it.each([
    "attemptId",
    "generation",
    "step",
    "operationId",
    "idempotencyKey",
    "notAfter",
  ])("rejects a substituted permit %s", (field) => {
    expect(() =>
      recoveryPermitFrom({
        ...recoveryPermitFixture(),
        [field]: "substituted",
      }),
    ).toThrow();
  });
  it.each([
    { amountFils: 1 },
    { currency: "USD" },
    { paymentLifecycleId: "other" },
    { kind: "authorization" },
    { logicalOperationId: "other" },
    { attemptId: "other" },
  ])(
    "rejects a request that disagrees with its permit: %j",
    async (override) => {
      const permit = recoveryPermitFixture();
      const rpc = vi.fn();
      const repository = new SupabasePaymentOperationExecutionRepository({
        rpc,
      } as never);
      await expect(
        repository.admit(
          {
            kind: "capture",
            paymentLifecycleId: permit.binding.paymentLifecycleId,
            logicalOperationId: permit.operationId,
            attemptId: permit.idempotencyKey,
            amountFils: 105_000_000,
            currency: "IQD",
            executionPermit: permit,
            ...override,
          } as never,
          permit.binding.providerIdentity,
        ),
      ).rejects.toThrow("permit");
      expect(rpc).not.toHaveBeenCalled();
    },
  );
});
