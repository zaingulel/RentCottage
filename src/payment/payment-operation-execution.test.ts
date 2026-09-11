import { describe, expect, it, vi } from "vitest";

import { createPaymentOperationExecution } from "./payment-operation-execution";
import type {
  PaymentOperationAdmission,
  PaymentOperationExecutionRepository,
} from "./payment-operation-execution";
import type {
  PaymentProviderAdapter,
  ProviderOperationRequest,
  ProviderOperationResult,
} from "./payment-contract";

const identity = {
  provider: "isolated-fiction",
  environment: "test",
  merchantId: "merchant",
  terminalId: "terminal",
};
const request: ProviderOperationRequest = {
  kind: "release",
  paymentLifecycleId: "lifecycle",
  logicalOperationId: "release",
  attemptId: "attempt-1",
  amountFils: 1000,
  currency: "IQD",
  executionPermit: null,
};
const admission: PaymentOperationAdmission = {
  purpose: "booking-request-release",
  operationId: "operation-1",
  providerIdentity: identity,
  idempotencyKey: "original-key",
  requestFingerprint: "a".repeat(64),
  binding: request,
  notBefore: null,
  notAfter: "2099-01-01T00:00:00Z",
  mode: "execute",
};
function evidence(
  outcome: "succeeded" | "failed" | "indeterminate",
): ProviderOperationResult {
  return {
    outcome,
    providerRequestId: "request-1",
    providerReference: "reference-1",
    ...(outcome === "failed"
      ? { retrySafe: true }
      : { movementReference: "movement-1" }),
    evidence: {
      operationId: admission.operationId,
      eventId: "event-1",
      provenance: "fictional-provider",
      originalOutcome: outcome,
      executedAt: "2098-01-01T00:00:00Z",
      occurredAt: outcome === "indeterminate" ? null : "2098-01-01T00:00:00Z",
      closedAt: null,
    },
  } as ProviderOperationResult;
}
function fixture(result: ProviderOperationResult = evidence("succeeded")) {
  const recorded: ProviderOperationResult[] = [];
  const repository: PaymentOperationExecutionRepository = {
    admit: vi.fn(async () => admission),
    reload: vi.fn(async () => ({ ...admission, mode: "reconcile" as const })),
    record: vi.fn(async (_admission, observation) => {
      recorded.push(observation);
      return observation;
    }),
  };
  const provider: PaymentProviderAdapter = {
    identity,
    execute: vi.fn(async () => {
      expect(recorded).toHaveLength(0);
      return result;
    }),
    query: vi.fn(async () => result),
    verifySignedEvent: () => false,
  };
  return {
    repository,
    provider,
    recorded,
    operations: createPaymentOperationExecution({ repository, provider }),
  };
}

describe("explicit durable payment operation execution", () => {
  it.each(["succeeded", "failed", "indeterminate"] as const)(
    "records isolated provider %s evidence before returning it to booking work",
    async (outcome) => {
      const test = fixture(evidence(outcome));
      expect(await test.operations.execute(request)).toEqual({
        status: "recorded",
        result: evidence(outcome),
      });
      expect(test.recorded).toEqual([evidence(outcome)]);
      expect(test.provider.execute).toHaveBeenCalledWith(
        expect.objectContaining({ admission }),
      );
    },
  );
  it("records booking refunds through the shared observation application", async () => {
    const test = fixture();
    vi.mocked(test.repository.admit).mockResolvedValue({
      ...admission,
      purpose: "booking-refund",
    });
    const observation = {
      record: vi.fn(
        async (_admission, result: ProviderOperationResult) => result,
      ),
    };
    const execution = createPaymentOperationExecution({
      repository: test.repository,
      provider: test.provider,
      observation,
    });
    expect((await execution.execute(request)).status).toBe("recorded");
    expect(observation.record).toHaveBeenCalledOnce();
    expect(test.repository.record).not.toHaveBeenCalled();
  });
  it("reconciles a lost response using the original admission and null references without executing again", async () => {
    const test = fixture();
    vi.mocked(test.repository.admit).mockResolvedValue({
      ...admission,
      mode: "reconcile",
    });
    expect((await test.operations.execute(request)).status).toBe("recorded");
    expect(test.provider.execute).not.toHaveBeenCalled();
    expect(test.provider.query).toHaveBeenCalledWith(
      expect.objectContaining({
        admission: { ...admission, mode: "reconcile" },
        providerRequestId: null,
        providerReference: null,
      }),
    );
    expect(test.recorded).toHaveLength(1);
  });
  it("retains an unresolved operation when recording fails and a fresh executor queries the same identity", async () => {
    const first = fixture();
    vi.mocked(first.repository.record).mockRejectedValueOnce(
      new Error("response lost"),
    );
    expect(await first.operations.execute(request)).toEqual({
      status: "unavailable",
    });
    const fresh = createPaymentOperationExecution({
      repository: first.repository,
      provider: first.provider,
    });
    expect(
      (
        await fresh.query({
          ...request,
          providerRequestId: null,
          providerReference: null,
        })
      ).status,
    ).toBe("recorded");
    expect(first.provider.execute).toHaveBeenCalledTimes(1);
    expect(first.provider.query).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "attempt-1",
        admission: expect.objectContaining({
          operationId: "operation-1",
          idempotencyKey: "original-key",
        }),
      }),
    );
  });
  it("does not turn a local refusal or unbound absence into a recorded retry", async () => {
    const test = fixture({ outcome: "not-executed" });
    expect(await test.operations.execute(request)).toEqual({
      status: "unresolved",
    });
    expect(test.repository.record).not.toHaveBeenCalled();
  });
  it("explicitly records an operation-bound permanent absence receipt", async () => {
    const result: ProviderOperationResult = {
      outcome: "not-executed",
      evidence: {
        operationId: "operation-1",
        eventId: "closed-1",
        provenance: "fictional-provider",
        originalOutcome: null,
        executedAt: null,
        occurredAt: null,
        closedAt: "2098-01-01T00:00:00Z",
      },
    };
    const test = fixture(result);
    expect(
      await test.operations.query({
        ...request,
        providerRequestId: null,
        providerReference: null,
      }),
    ).toEqual({ status: "recorded", result });
    expect(test.recorded).toEqual([result]);
  });
  it.each([
    { ...admission, providerIdentity: { ...identity, merchantId: "foreign" } },
    { ...admission, binding: { ...request, amountFils: 2 } },
    { ...admission, binding: { ...request, attemptId: "attempt-2" } },
  ])(
    "rejects an admission that changes the requested provider or immutable binding",
    async (changed) => {
      const test = fixture();
      vi.mocked(test.repository.admit).mockResolvedValue(changed);
      expect(await test.operations.execute(request)).toEqual({
        status: "unavailable",
      });
      expect(test.provider.execute).not.toHaveBeenCalled();
      expect(test.repository.record).not.toHaveBeenCalled();
    },
  );
  it("does not record a provider result for another operation", async () => {
    const result = evidence("succeeded");
    const test = fixture({
      ...result,
      evidence: { ...result.evidence!, operationId: "foreign" },
    });
    expect(await test.operations.execute(request)).toEqual({
      status: "unavailable",
    });
    expect(test.repository.record).not.toHaveBeenCalled();
  });
  it("preserves unknown occurrence time on imported legacy evidence", async () => {
    const result = evidence("succeeded");
    const legacy = {
      ...result,
      evidence: {
        ...result.evidence!,
        provenance: "legacy-simulated" as const,
        occurredAt: null,
      },
    };
    const test = fixture(legacy);
    await expect(
      test.operations.query({
        ...request,
        providerRequestId: null,
        providerReference: null,
      }),
    ).resolves.toEqual({ status: "recorded", result: legacy });
    expect(test.recorded[0].evidence?.occurredAt).toBeNull();
  });
});

describe("application-owned recovery and expiry recording", () => {
  it.each([
    "booking-request-payment-recovery",
    "booking-request-payment-required-expiry",
    "booking-request-payment-required-corrective-refund",
  ] as const)(
    "%s commits consequences through the same application seam for execution and inquiry",
    async (purpose) => {
      const test = fixture();
      const owned = { ...admission, purpose };
      vi.mocked(test.repository.admit).mockResolvedValue(owned);
      vi.mocked(test.repository.reload).mockResolvedValue({
        ...owned,
        mode: "reconcile",
      });
      const observation = {
        record: vi.fn(
          async (
            _admission: PaymentOperationAdmission,
            result: ProviderOperationResult,
          ) => result,
        ),
      };
      const operations = createPaymentOperationExecution({
        repository: test.repository,
        provider: test.provider,
        observation,
      });
      expect((await operations.execute(request)).status).toBe("recorded");
      expect(
        (
          await operations.query({
            ...request,
            providerRequestId: null,
            providerReference: null,
          })
        ).status,
      ).toBe("recorded");
      expect(observation.record).toHaveBeenCalledTimes(2);
      expect(test.repository.record).not.toHaveBeenCalled();
    },
  );
  it("refuses dispatch before a provider effect when required application recording is absent", async () => {
    const test = fixture();
    vi.mocked(test.repository.admit).mockResolvedValue({
      ...admission,
      purpose: "booking-request-payment-recovery",
    });
    expect(await test.operations.execute(request)).toEqual({
      status: "unavailable",
    });
    expect(test.provider.execute).not.toHaveBeenCalled();
    expect(test.repository.record).not.toHaveBeenCalled();
  });
});
