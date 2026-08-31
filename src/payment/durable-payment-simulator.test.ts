import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { DurablePaymentSimulator } from "./durable-payment-simulator";

vi.mock("server-only", () => ({}));

const request = {
  kind: "authorization" as const,
  paymentLifecycleId: "11111111-1111-4111-8111-111111111111",
  logicalOperationId: "11111111-1111-4111-8111-111111111111:authorization",
  attemptId: "11111111-1111-4111-8111-111111111111:authorization:attempt-1",
  amountFils: 105_003_000,
  currency: "IQD" as const,
  executionPermit: {
    purpose: "booking-request-authorization" as const,
    claimId: "22222222-2222-4222-8222-222222222222",
    generation: 1,
    idempotencyKey: "booking-request:22222222-2222-4222-8222-222222222222:1",
    notAfter: "2099-08-22T00:00:00.000Z",
  },
};

const releaseRequest = {
  ...request,
  kind: "release" as const,
  logicalOperationId: `${request.paymentLifecycleId}:release`,
  attemptId: `${request.paymentLifecycleId}:release:attempt-2`,
  executionPermit: {
    purpose: "booking-request-release" as const,
    workId: "33333333-3333-4333-8333-333333333333",
    leaseGeneration: 1,
    leaseToken: "44444444-4444-4444-8444-444444444444",
    operationId: "55555555-5555-4555-8555-555555555555",
    operationGeneration: 1,
    idempotencyKey:
      "booking-request-release:33333333-3333-4333-8333-333333333333:1",
    requestFingerprint:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    notAfter: "2099-08-22T00:00:00.000Z",
  },
};

const cleanupRequest = {
  ...releaseRequest,
  executionPermit: {
    purpose: "booking-request-submission-cleanup" as const,
    attemptId: "66666666-6666-4666-8666-666666666666",
    claimId: "77777777-7777-4777-8777-777777777777",
    generation: 1,
    stateRevision: 4,
    idempotencyKey:
      "booking-request-submission-cleanup:66666666-6666-4666-8666-666666666666:4",
    requestFingerprint:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    notAfter: "2099-08-22T00:00:00.000Z",
  },
};

const captureRequest = {
  ...request,
  kind: "capture" as const,
  logicalOperationId: `${request.paymentLifecycleId}:capture`,
  attemptId: `${request.paymentLifecycleId}:capture:attempt-2`,
  executionPermit: {
    purpose: "booking-request-capture" as const,
    bookingRequestId: "88888888-8888-4888-8888-888888888888",
    submissionAttemptId: "99999999-9999-4999-8999-999999999999",
    authorizationClaimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    authorizationClaimGeneration: 1,
    paymentLifecycleId: request.paymentLifecycleId,
    authorizationLogicalOperationId: request.logicalOperationId,
    authorizationPhysicalAttemptId: request.attemptId,
    captureLogicalOperationId: `${request.paymentLifecycleId}:capture`,
    capturePhysicalAttemptId: `${request.paymentLifecycleId}:capture:attempt-2`,
    amountFils: request.amountFils,
    currency: "IQD" as const,
    providerIdentity: {
      provider: "fictional-payments",
      environment: "local-test",
      merchantId: "fictional-merchant",
      terminalId: "fictional-terminal",
    },
    idempotencyKey:
      "booking-request-capture:88888888-8888-4888-8888-888888888888:1",
    requestFingerprint:
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    workId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    leaseGeneration: 2,
    leaseToken: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    notAfter: "2099-08-22T00:00:00.000Z",
  },
};

describe("durable simulated payment provider", () => {
  it("executes and reconciles through the service-role ledger without personal data", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          outcome: "indeterminate",
          providerRequestId: "sim-request-1",
          providerReference: "sim-reference-1",
          movementReference: "sim-movement-1",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          outcome: "succeeded",
          providerRequestId: "sim-request-1",
          providerReference: "sim-reference-1",
          movementReference: "sim-movement-1",
        },
        error: null,
      });
    const provider = new DurablePaymentSimulator({
      client: { rpc } as unknown as SupabaseClient,
      now: () => "2099-08-21T17:00:00.000Z",
      executeOutcome: "indeterminate",
      reconciliationOutcome: "succeeded",
    });

    await expect(provider.execute(request)).resolves.toMatchObject({
      outcome: "indeterminate",
    });
    await expect(
      provider.query({
        kind: request.kind,
        paymentLifecycleId: request.paymentLifecycleId,
        logicalOperationId: request.logicalOperationId,
        attemptId: request.attemptId,
        amountFils: request.amountFils,
        currency: request.currency,
        providerRequestId: null,
        providerReference: null,
      }),
    ).resolves.toMatchObject({ outcome: "succeeded" });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "execute_simulated_payment_provider_operation",
      "query_simulated_payment_provider_operation",
    ]);
    expect(rpc.mock.calls[1][1].target_operation.requestFingerprint).toBe(
      rpc.mock.calls[0][1].target_operation.requestFingerprint,
    );
    expect(rpc.mock.calls[1][1]).toMatchObject({
      target_provider_request_id: null,
      target_provider_reference: null,
    });
    const serialized = JSON.stringify(rpc.mock.calls);
    expect(serialized).not.toContain("customerName");
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("bookingNote");
    expect(serialized).not.toContain("cottage");
  });

  it("refuses execution after the database permit expires without touching the ledger", async () => {
    const rpc = vi.fn();
    const provider = new DurablePaymentSimulator({
      client: { rpc } as unknown as SupabaseClient,
      now: () => "2099-08-22T00:00:00.000Z",
    });

    await expect(provider.execute(request)).resolves.toEqual({
      outcome: "not-executed",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps a Capture permit non-operative before touching the ledger", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: "succeeded",
        providerRequestId: "must-not-execute",
        providerReference: "must-not-execute",
        movementReference: "must-not-execute",
      },
      error: null,
    });
    const provider = new DurablePaymentSimulator({
      client: { rpc } as unknown as SupabaseClient,
      now: () => "2099-08-21T17:00:00.000Z",
    });

    await expect(provider.execute(captureRequest)).resolves.toEqual({
      outcome: "not-executed",
    });
    await expect(
      provider.execute({
        ...captureRequest,
        kind: "release",
        logicalOperationId: `${request.paymentLifecycleId}:release`,
        attemptId: `${request.paymentLifecycleId}:release:attempt-3`,
      }),
    ).resolves.toEqual({ outcome: "not-executed" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an unsupported permit purpose without touching the ledger", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: "succeeded",
        providerRequestId: "must-not-execute",
        providerReference: "must-not-execute",
        movementReference: "must-not-execute",
      },
      error: null,
    });
    const provider = new DurablePaymentSimulator({
      client: { rpc } as unknown as SupabaseClient,
      now: () => "2099-08-21T17:00:00.000Z",
    });
    const unsupportedPurposeRequest = {
      ...releaseRequest,
      executionPermit: {
        ...releaseRequest.executionPermit,
        purpose: "unsupported-runtime-purpose",
      },
    } as unknown as Parameters<DurablePaymentSimulator["execute"]>[0];

    await expect(provider.execute(unsupportedPurposeRequest)).resolves.toEqual({
      outcome: "not-executed",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports authoritative missing ledger evidence as not executed", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { outcome: "not-executed" },
      error: null,
    });
    const provider = new DurablePaymentSimulator({
      client: { rpc } as unknown as SupabaseClient,
      now: () => "2099-08-21T17:00:00.000Z",
    });

    await expect(
      provider.query({
        kind: "release",
        paymentLifecycleId: request.paymentLifecycleId,
        logicalOperationId: `${request.paymentLifecycleId}:release`,
        attemptId: `${request.paymentLifecycleId}:release:attempt-2`,
        amountFils: request.amountFils,
        currency: request.currency,
        providerRequestId: null,
        providerReference: null,
      }),
    ).resolves.toEqual({ outcome: "not-executed" });
    expect(rpc.mock.calls[0][1].target_operation.requestFingerprint).toBeNull();
  });

  it("passes every fenced release-permit binding to the fictional provider RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: "succeeded",
        providerRequestId: "sim-request-release",
        providerReference: "sim-reference-release",
        movementReference: "sim-movement-release",
      },
      error: null,
    });
    const provider = new DurablePaymentSimulator({
      client: { rpc } as unknown as SupabaseClient,
      now: () => "2099-08-21T17:00:00.000Z",
    });

    await expect(provider.execute(releaseRequest)).resolves.toMatchObject({
      outcome: "succeeded",
    });
    expect(rpc).toHaveBeenCalledWith(
      "execute_simulated_payment_provider_operation",
      expect.objectContaining({
        target_operation: expect.objectContaining({
          permitPurpose: "booking-request-release",
          workId: releaseRequest.executionPermit.workId,
          leaseGeneration: 1,
          leaseToken: releaseRequest.executionPermit.leaseToken,
          operationId: releaseRequest.executionPermit.operationId,
          operationGeneration: 1,
          idempotencyKey: releaseRequest.executionPermit.idempotencyKey,
          requestFingerprint: releaseRequest.executionPermit.requestFingerprint,
          notAfter: releaseRequest.executionPermit.notAfter,
        }),
      }),
    );
  });

  it("passes only the cleanup permit namespace for a pre-request release", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: "succeeded",
        providerRequestId: "sim-request-cleanup",
        providerReference: "sim-reference-cleanup",
        movementReference: "sim-movement-cleanup",
      },
      error: null,
    });
    const provider = new DurablePaymentSimulator({
      client: { rpc } as unknown as SupabaseClient,
      now: () => "2099-08-21T17:00:00.000Z",
    });

    await provider.execute(cleanupRequest);

    expect(rpc).toHaveBeenCalledWith(
      "execute_simulated_payment_provider_operation",
      expect.objectContaining({
        target_operation: expect.objectContaining({
          permitPurpose: "booking-request-submission-cleanup",
          cleanupAttemptId: cleanupRequest.executionPermit.attemptId,
          claimId: cleanupRequest.executionPermit.claimId,
          claimGeneration: cleanupRequest.executionPermit.generation,
          stateRevision: cleanupRequest.executionPermit.stateRevision,
          requestFingerprint: cleanupRequest.executionPermit.requestFingerprint,
          workId: null,
          leaseToken: null,
          operationId: null,
        }),
      }),
    );
  });
});
