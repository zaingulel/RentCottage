import { describe, expect, it, vi } from "vitest";
import { recoveryPermitFixture } from "../../tests/fixtures/payment-recovery.fixtures";
import {
  recoveryBindingFrom,
  recoveryPermitFrom,
} from "./booking-request-payment-recovery-contract";
import { DurablePaymentSimulator } from "./durable-payment-simulator-core";

describe("Booking Request recovery provider contract", () => {
  it.each([
    ["original-release", "release"],
    ["replacement-authorization", "authorization"],
    ["replacement-capture", "capture"],
    ["replacement-release", "release"],
  ] as const)(
    "dispatches %s only with operation kind %s",
    async (step, kind) => {
      const permit = recoveryPermitFixture(step);
      const rpc = vi.fn().mockResolvedValue({
        data: {
          outcome: "succeeded",
          providerRequestId: "request",
          providerReference: "reference",
          movementReference: "movement",
        },
        error: null,
      });
      const provider = new DurablePaymentSimulator({
        client: { rpc } as never,
        now: () => "2026-09-06T12:00:00.000Z",
      });
      const request = {
        kind,
        paymentLifecycleId: permit.binding.paymentLifecycleId,
        logicalOperationId: permit.operationId,
        attemptId: permit.idempotencyKey,
        amountFils: permit.binding.amountFils,
        currency: "IQD" as const,
        executionPermit: permit,
      };
      await expect(provider.execute(request)).resolves.toMatchObject({
        outcome: "succeeded",
      });
      expect(rpc).toHaveBeenCalledOnce();
      rpc.mockClear();
      await expect(
        provider.execute({
          ...request,
          kind: kind === "release" ? "capture" : "release",
        }),
      ).resolves.toEqual({ outcome: "not-executed" });
      expect(rpc).not.toHaveBeenCalled();
    },
  );
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
    "never dispatches a payment request that disagrees with its permit: %j",
    async (override) => {
      const permit = recoveryPermitFixture();
      const rpc = vi.fn();
      const provider = new DurablePaymentSimulator({
        client: { rpc } as never,
        now: () => "2026-09-06T12:00:00.000Z",
      });
      await expect(
        provider.execute({
          kind: "capture",
          paymentLifecycleId: permit.binding.paymentLifecycleId,
          logicalOperationId: permit.operationId,
          attemptId: permit.idempotencyKey,
          amountFils: 105_000_000,
          currency: "IQD",
          executionPermit: permit,
          ...override,
        } as never),
      ).resolves.toEqual({ outcome: "not-executed" });
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("queries the persisted recovery identity after its dispatch deadline", async () => {
    const permit = recoveryPermitFixture();
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: "succeeded",
        providerRequestId: "original-request",
        providerReference: "original-reference",
        movementReference: "original-movement",
      },
      error: null,
    });
    const provider = new DurablePaymentSimulator({
      client: { rpc } as never,
      now: () => "2101-01-01T00:00:00.000Z",
    });
    await expect(
      provider.query({
        kind: "capture",
        paymentLifecycleId: permit.binding.paymentLifecycleId,
        logicalOperationId: permit.operationId,
        attemptId: permit.idempotencyKey,
        amountFils: 105_000_000,
        currency: "IQD",
        recoveryPermit: permit,
        providerRequestId: "original-request",
        providerReference: "original-reference",
      }),
    ).resolves.toMatchObject({ outcome: "succeeded" });
    expect(rpc).toHaveBeenCalledWith(
      "query_simulated_booking_request_payment_recovery",
      {
        target_permit: permit,
        target_provider_request_id: "original-request",
        target_provider_reference: "original-reference",
        target_outcome: "succeeded",
      },
    );
  });
});
