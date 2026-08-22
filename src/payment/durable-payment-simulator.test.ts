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
    claimId: "22222222-2222-4222-8222-222222222222",
    generation: 1,
    idempotencyKey: "booking-request:22222222-2222-4222-8222-222222222222:1",
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
});
