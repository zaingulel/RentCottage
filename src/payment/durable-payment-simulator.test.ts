import { describe, expect, it, vi } from "vitest";
import { DurablePaymentSimulator } from "./durable-payment-simulator-core";
import type {
  SimulatorEffectBinding,
  SimulatorEffectRepository,
} from "./durable-payment-simulator-core";
import type { PaymentOperationAdmission } from "./payment-operation-execution";
import type { ProviderOperationResult } from "./payment-contract";

const identity = {
  provider: "fictional-payments",
  environment: "local-test",
  merchantId: "fictional-merchant",
  terminalId: "fictional-terminal",
};
const binding = {
  kind: "release" as const,
  paymentLifecycleId: "lifecycle",
  logicalOperationId: "release",
  attemptId: "attempt-1",
  amountFils: 1000,
  currency: "IQD" as const,
};
const admission: PaymentOperationAdmission = {
  purpose: "booking-request-release",
  operationId: "operation-1",
  providerIdentity: identity,
  idempotencyKey: "original-key",
  requestFingerprint: "a".repeat(64),
  binding,
  notBefore: null,
  notAfter: "2099-01-01T00:00:00Z",
  mode: "execute",
};
function fixture() {
  let stored: ProviderOperationResult | undefined;
  const effects: SimulatorEffectRepository = {
    executeOnce: vi.fn(async (_binding, proposed) => {
      stored ??= proposed;
      return stored!;
    }),
    queryAndSealAbsent: vi.fn(async (target) => {
      stored ??= {
        outcome: "not-executed",
        evidence: {
          operationId: target.operationId,
          eventId: "closed-1",
          provenance: "fictional-provider",
          originalOutcome: null,
          executedAt: null,
          occurredAt: null,
          closedAt: "2098-01-01T00:00:00Z",
        },
      };
      return stored!;
    }),
    resolve: vi.fn(async (_binding, _expected, proposed) => {
      stored = proposed;
      return stored!;
    }),
  };
  return {
    effects,
    make: (outcome = "succeeded" as "succeeded" | "failed" | "indeterminate") =>
      new DurablePaymentSimulator({
        effects,
        now: () => "2098-01-01T00:00:00Z",
        executeOutcome: outcome,
        reconciliationOutcome: "succeeded",
      }),
  };
}
const execute = { ...binding, executionPermit: null, admission };
const query = {
  ...binding,
  providerRequestId: null,
  providerReference: null,
  admission,
};

describe("isolated durable fictional provider", () => {
  it.each(["succeeded", "failed", "indeterminate"] as const)(
    "generates %s evidence using only the narrow effect repository",
    async (outcome) => {
      const test = fixture();
      const result = await test.make(outcome).execute(execute);
      expect(result.outcome).toBe(outcome);
      expect(result.evidence?.operationId).toBe(admission.operationId);
      expect(test.effects.executeOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: "operation-1",
          idempotencyKey: "original-key",
          notAfter: admission.notAfter,
        }),
        expect.objectContaining({ outcome }),
      );
      expect(Object.keys(test.effects)).toEqual([
        "executeOnce",
        "queryAndSealAbsent",
        "resolve",
      ]);
    },
  );
  it("fresh-instance inquiry with null references returns the same physical effect", async () => {
    const test = fixture();
    const first = await test.make().execute(execute);
    expect(await test.make().query(query)).toEqual(first);
    expect(test.effects.executeOnce).toHaveBeenCalledTimes(1);
  });
  it("a sealed absence wins against the original delayed executor", async () => {
    const test = fixture();
    const absent = await test.make().query(query);
    expect(absent.outcome).toBe("not-executed");
    expect(await test.make().execute(execute)).toEqual(absent);
    expect(test.effects.resolve).not.toHaveBeenCalled();
  });
  it("resolves indeterminate evidence with the original movement and operation identity", async () => {
    const test = fixture();
    const initial = await test.make("indeterminate").execute(execute);
    const resolved = await test.make().query(query);
    expect(resolved).toMatchObject({
      outcome: "succeeded",
      movementReference: "sim-movement-operation-1",
      evidence: { operationId: "operation-1" },
    });
    expect(test.effects.executeOnce).toHaveBeenCalledTimes(1);
    expect(test.effects.resolve).toHaveBeenCalledWith(
      expect.anything(),
      initial.evidence?.eventId,
      expect.objectContaining({ outcome: "succeeded" }),
    );
  });
  it.each([
    undefined,
    {
      ...admission,
      providerIdentity: { ...identity, environment: "production" },
    },
    { ...admission, binding: { ...binding, amountFils: 99 } },
  ])(
    "refuses missing or foreign admission without any effect-store access",
    async (changed) => {
      const test = fixture();
      await expect(
        test.make().execute({ ...execute, admission: changed }),
      ).rejects.toThrow("admission");
      expect(test.effects.executeOnce).not.toHaveBeenCalled();
    },
  );
  it("never converts an unavailable inquiry into absence", async () => {
    const test = fixture();
    vi.mocked(test.effects.queryAndSealAbsent).mockRejectedValue(
      new Error("database unavailable"),
    );
    await expect(test.make().query(query)).rejects.toThrow("unavailable");
  });
  it("uses one stable binding for execution and inquiry", async () => {
    const test = fixture();
    await test.make().execute(execute);
    await test
      .make()
      .query({ ...query, admission: { ...admission, mode: "reconcile" } });
    const executedBinding = vi.mocked(test.effects.executeOnce).mock
      .calls[0][0];
    expect(vi.mocked(test.effects.queryAndSealAbsent).mock.calls[0][0]).toEqual(
      executedBinding satisfies SimulatorEffectBinding,
    );
    expect(executedBinding).not.toHaveProperty("executionPermit");
    expect(executedBinding).not.toHaveProperty("mode");
  });
});
