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
  it("preserves failed release retry safety across fresh simulator instances", async () => {
    for (const failureRetrySafe of [undefined, false, true]) {
      const { effects } = fixture();
      const first = new DurablePaymentSimulator({
        effects,
        now: () => "2098-01-01T00:00:00Z",
        executeOutcome: "failed",
        failureRetrySafe,
      });
      const result = await first.execute(execute);
      expect(result).toMatchObject({
        outcome: "failed",
        retrySafe: failureRetrySafe === true,
      });
      const fresh = new DurablePaymentSimulator({
        effects,
        now: () => "2098-01-02T00:00:00Z",
        executeOutcome: "failed",
        failureRetrySafe: failureRetrySafe !== true,
      });
      expect(await fresh.query(query)).toEqual(result);
      expect(await fresh.execute(execute)).toEqual(result);
      expect(effects.resolve).not.toHaveBeenCalled();
    }
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

describe("hosted demo initial-capture selector", () => {
  it("rejects non-hosted malformed and conflicting failure selectors before effect access", async () => {
    const { effects } = fixture();
    const options = {
      effects,
      environment: "hosted-demo-yvibcyqtyihpzpmomnzg" as const,
      now: () => "2098-01-01T00:00:00Z",
      failedInitialCaptureLifecycleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    for (const patch of [
      { environment: undefined },
      { environment: "local-test" as const },
      { failedInitialCaptureLifecycleId: "" },
      { failedInitialCaptureLifecycleId: "not-a-uuid" },
      {
        failedInitialCaptureLifecycleId:
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\n",
      },
      {
        failedInitialCaptureLifecycleId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      },
      { executeOutcome: "succeeded" as const },
      { executeOutcome: "failed" as const },
      { failureRetrySafe: false },
      { failureRetrySafe: true },
      { reconciliationOutcome: "succeeded" as const },
    ]) {
      expect(
        () => new DurablePaymentSimulator({ ...options, ...patch }),
      ).toThrow(/initial.capture/i);
    }
    const provider = new DurablePaymentSimulator(options);
    const requestBinding = {
      ...binding,
      kind: "capture" as const,
      paymentLifecycleId: options.failedInitialCaptureLifecycleId,
    };
    const admitted = {
      ...admission,
      purpose: "booking-request-capture" as const,
      providerIdentity: provider.identity,
      binding: requestBinding,
    };
    for (const changed of [
      undefined,
      { ...admitted, providerIdentity: identity },
      {
        ...admitted,
        binding: {
          ...requestBinding,
          paymentLifecycleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        },
      },
      { ...admitted, binding: { ...requestBinding, kind: "release" as const } },
      { ...admitted, binding: { ...requestBinding, amountFils: 99 } },
    ]) {
      await expect(
        provider.execute({
          ...requestBinding,
          executionPermit: null,
          admission: changed,
        }),
      ).rejects.toThrow("admission");
      await expect(
        provider.query({
          ...requestBinding,
          providerRequestId: null,
          providerReference: null,
          admission: changed,
        }),
      ).rejects.toThrow("admission");
    }
    expect(effects.executeOnce).not.toHaveBeenCalled();
    expect(effects.queryAndSealAbsent).not.toHaveBeenCalled();
    expect(effects.resolve).not.toHaveBeenCalled();
  });
  it("fails only the designated original capture and preserves persisted results across selector changes", async () => {
    const selected = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const unrelated = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const environment = "hosted-demo-yvibcyqtyihpzpmomnzg";
    const cases: readonly [
      PaymentOperationAdmission["purpose"],
      PaymentOperationAdmission["binding"]["kind"],
      string,
      "succeeded" | "failed",
    ][] = [
      ["booking-request-capture", "capture", selected, "failed"],
      ["booking-request-capture", "capture", unrelated, "succeeded"],
      ["booking-request-payment-recovery", "capture", selected, "succeeded"],
      [
        "booking-request-payment-recovery",
        "authorization",
        selected,
        "succeeded",
      ],
      ["booking-request-payment-recovery", "release", selected, "succeeded"],
      ["booking-request-authorization", "authorization", selected, "succeeded"],
      ["booking-request-release", "release", selected, "succeeded"],
      ["booking-request-capture", "authorization", selected, "succeeded"],
    ];
    for (const [purpose, kind, paymentLifecycleId, outcome] of cases) {
      const { effects } = fixture();
      const requestBinding = { ...binding, kind, paymentLifecycleId };
      const admitted = {
        ...admission,
        purpose,
        providerIdentity: { ...identity, environment },
        binding: requestBinding,
      };
      const request = {
        ...requestBinding,
        admission: admitted,
        executionPermit: null,
      };
      const make = (failedInitialCaptureLifecycleId?: string) =>
        new DurablePaymentSimulator({
          effects,
          environment,
          now: () => "2098-01-01T00:00:00Z",
          failedInitialCaptureLifecycleId,
        });
      const result = await make(selected).execute(request);
      expect(result.outcome, `${purpose}/${kind}/${paymentLifecycleId}`).toBe(
        outcome,
      );
      if (outcome === "failed") {
        expect(result).toMatchObject({ retrySafe: false });
        expect(result).not.toHaveProperty("movementReference");
      }
      expect(await make(unrelated).execute(request)).toEqual(result);
      expect(await make().execute(request)).toEqual(result);
      expect(
        await make(unrelated).query({
          ...requestBinding,
          admission: { ...admitted, mode: "reconcile" },
          providerRequestId: null,
          providerReference: null,
        }),
      ).toEqual(result);
      expect(effects.resolve).not.toHaveBeenCalled();
    }
    const { effects } = fixture();
    const requestBinding = {
      ...binding,
      kind: "capture" as const,
      paymentLifecycleId: selected,
    };
    const request = {
      ...requestBinding,
      executionPermit: null,
      admission: {
        ...admission,
        purpose: "booking-request-capture" as const,
        providerIdentity: { ...identity, environment },
        binding: requestBinding,
      },
    };
    const result = await new DurablePaymentSimulator({
      effects,
      environment,
      now: () => "2098-01-01T00:00:00Z",
    }).execute(request);
    expect(result.outcome).toBe("succeeded");
    expect(
      await new DurablePaymentSimulator({
        effects,
        environment,
        now: () => "2098-01-01T00:00:00Z",
        failedInitialCaptureLifecycleId: selected,
      }).execute(request),
    ).toEqual(result);
  });
});
