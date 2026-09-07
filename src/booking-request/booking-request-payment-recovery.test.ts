import { recoveryPermitFixture } from "../../tests/fixtures/payment-recovery.fixtures";
import { describe, expect, it, vi } from "vitest";

import type { PaymentProviderAdapter } from "@/payment/payment-contract";
import { createBookingRequestPaymentRecovery } from "./booking-request-payment-recovery";

const attemptId = "11111111-1111-4111-8111-111111111111";
const bookingRequestId = "22222222-2222-4222-8222-222222222222";
const deadline = "2026-09-06T12:20:00.000Z";

describe("Customer Booking Request payment recovery", () => {
  it("runs the simulated replacement only after original release proof", async () => {
    const steps = [
      "original-release",
      "replacement-authorization",
      "replacement-capture",
    ] as const;
    let position = 0;
    const repository = {
      admit: vi
        .fn()
        .mockResolvedValue({ status: "processing", attemptId, deadline }),
      lease: vi.fn(async () => {
        const step = steps[position++];
        if (!step) return { status: "succeeded" as const };
        return {
          status: "leased" as const,
          permit: recoveryPermitFixture(step),
          binding: {
            kind: step.includes("release")
              ? ("release" as const)
              : step === "replacement-authorization"
                ? ("authorization" as const)
                : ("capture" as const),
            paymentLifecycleId: attemptId,
            logicalOperationId: `${attemptId}:${step}`,
            attemptId: `${attemptId}:${step}:1`,
            amountFils: 105_000_000,
            currency: "IQD" as const,
          },
        };
      }),
      due: vi.fn().mockResolvedValue([]),
      finalize: vi.fn().mockResolvedValue(undefined),
    };
    const execute = vi
      .fn<PaymentProviderAdapter["execute"]>()
      .mockResolvedValue({
        outcome: "succeeded",
        providerRequestId: "request",
        providerReference: "reference",
        movementReference: "movement",
      });
    const service = createBookingRequestPaymentRecovery({
      repository,
      provider: {
        identity: {
          provider: "fictional-payments",
          environment: "local-test",
          merchantId: "fictional-merchant",
          terminalId: "fictional-terminal",
        },
        execute,
        query: vi.fn(),
        verifySignedEvent: vi.fn(),
      },
    });

    await expect(
      service.execute({ bookingRequestId, commandKey: attemptId }),
    ).resolves.toEqual({ status: "succeeded" });
    expect(execute.mock.calls.map(([request]) => request.kind)).toEqual([
      "release",
      "authorization",
      "capture",
    ]);
  });
});

it("reconciles an admitted unresolved operation without another physical execution", async () => {
  const query = vi.fn().mockResolvedValue({
    outcome: "succeeded",
    providerRequestId: "request",
    providerReference: "reference",
    movementReference: "movement",
  });
  const execute = vi.fn();
  const repository = {
    admit: vi
      .fn()
      .mockResolvedValue({ status: "processing", attemptId, deadline }),
    lease: vi
      .fn()
      .mockResolvedValueOnce({
        status: "reconcile",
        permit: { purpose: "booking-request-payment-recovery" },
        binding: { kind: "release" },
        providerRequestId: "request",
        providerReference: "reference",
      })
      .mockResolvedValue({ status: "blocked" }),
    due: vi.fn().mockResolvedValue([]),
    finalize: vi.fn(),
  };
  const service = createBookingRequestPaymentRecovery({
    repository,
    provider: {
      identity: {} as never,
      execute,
      query,
      verifySignedEvent: vi.fn(),
    },
  });
  await service.execute({ bookingRequestId, commandKey: attemptId });
  expect(query).toHaveBeenCalledWith(
    expect.objectContaining({
      providerRequestId: "request",
      providerReference: "reference",
    }),
  );
  expect(execute).not.toHaveBeenCalled();
});

it("continues admitted work after one recovery item is unavailable", async () => {
  const second = "33333333-3333-4333-8333-333333333333";
  const repository = {
    admit: vi.fn(),
    due: vi.fn().mockResolvedValue([attemptId, second]),
    lease: vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary unavailable"))
      .mockResolvedValue({ status: "succeeded" }),
    finalize: vi.fn(),
  };
  const service = createBookingRequestPaymentRecovery({
    repository,
    provider: {
      identity: {} as never,
      execute: vi.fn(),
      query: vi.fn(),
      verifySignedEvent: vi.fn(),
    },
  });
  await expect(service.processDue(50)).resolves.toEqual([
    { status: "unavailable" },
    { status: "succeeded" },
  ]);
  expect(repository.finalize).toHaveBeenCalledExactlyOnceWith(second);
});
