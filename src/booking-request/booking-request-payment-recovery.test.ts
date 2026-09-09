import { describe, expect, it, vi } from "vitest";
import {
  paymentFactsFixture,
  paymentOperationFixture,
  recoveryAttemptId,
  recoveryPermitFixture,
} from "../../tests/fixtures/payment-recovery.fixtures";
import {
  createBookingRequestPaymentRecovery,
  selectPaymentRecovery,
} from "./booking-request-payment-recovery";
import type { RecoveryState } from "./booking-request-payment-observation";
import type { PaymentRecoveryStep } from "@/payment/booking-request-payment-recovery-contract";
import type { ProviderOperationResult } from "@/payment/payment-contract";

const requestId = paymentFactsFixture().bookingRequestId;
function fixture(
  states: RecoveryState[] = [
    "admitted",
    "original_released",
    "replacement_authorized",
    "succeeded",
  ],
) {
  let stage = 0;
  const facts = () =>
    paymentFactsFixture({
      attempts: [
        { id: recoveryAttemptId, generation: 1, state: states[stage] },
      ],
    });
  const evidence = {
    purpose: "booking-request-payment-recovery" as const,
    bookingRequestId: requestId,
    recoveryAttemptId,
    capturePhysicalAttemptId: `${recoveryAttemptId}:replacement-capture:1`,
    capture: { movementReference: "capture" },
  };
  const repository = {
    admit: vi.fn(async () => ({
      status: "processing" as const,
      attemptId: recoveryAttemptId,
      deadline: facts().deadline,
    })),
    facts: vi.fn(async () => facts()),
    lease: vi.fn(async (_id: string, step: PaymentRecoveryStep) => {
      const permit = recoveryPermitFixture(step);
      return {
        status: "leased" as const,
        permit,
        binding: {
          kind:
            step === "replacement-authorization"
              ? ("authorization" as const)
              : step === "replacement-capture"
                ? ("capture" as const)
                : ("release" as const),
          paymentLifecycleId: permit.binding.paymentLifecycleId,
          logicalOperationId: permit.operationId,
          attemptId: permit.idempotencyKey,
          amountFils: permit.binding.amountFils,
          currency: "IQD" as const,
        },
      };
    }),
    due: vi.fn(async () => [recoveryAttemptId]),
    confirmationEvidence: vi.fn(async () => evidence),
  };
  const operations = {
    execute: vi.fn(async () => {
      stage += 1;
      return {
        status: "recorded" as const,
        result: {
          outcome: "succeeded",
          providerRequestId: "request",
          providerReference: "reference",
          movementReference: "movement",
        } as ProviderOperationResult,
      };
    }),
    query: vi.fn(),
  };
  const confirmation = { execute: vi.fn(async () => ({}) as never) };
  return {
    repository,
    operations,
    confirmation,
    service: createBookingRequestPaymentRecovery({
      repository,
      operations,
      confirmation,
    }),
  };
}
describe("application payment recovery selection", () => {
  it("releases the original authorization, authorizes and captures the replacement, then confirms", async () => {
    const test = fixture();
    expect(
      await test.service.execute({
        bookingRequestId: requestId,
        commandKey: requestId,
      }),
    ).toEqual({ status: "succeeded" });
    expect(test.repository.lease.mock.calls.map((entry) => entry[1])).toEqual([
      "original-release",
      "replacement-authorization",
      "replacement-capture",
    ]);
    expect(test.confirmation.execute).toHaveBeenCalledWith(
      requestId,
      expect.objectContaining({
        capturePhysicalAttemptId: `${recoveryAttemptId}:replacement-capture:1`,
      }),
    );
  });
  it("reuses the original release across generations and releases a failed replacement before retry", async () => {
    const test = fixture([
      "original_released",
      "replacement_authorized",
      "capture_failed",
      "safely_failed",
    ]);
    expect(await test.service.resume(recoveryAttemptId)).toEqual({
      status: "retryable",
    });
    expect(test.repository.lease.mock.calls.map((entry) => entry[1])).toEqual([
      "replacement-authorization",
      "replacement-capture",
      "replacement-release",
    ]);
    expect(test.confirmation.execute).not.toHaveBeenCalled();
  });
  it("restarts after capture recording without another provider effect", async () => {
    const test = fixture(["succeeded"]);
    expect(await test.service.resume(recoveryAttemptId)).toEqual({
      status: "succeeded",
    });
    expect(test.operations.execute).not.toHaveBeenCalled();
    expect(test.confirmation.execute).toHaveBeenCalledOnce();
  });
  it.each(["admitted", "original_released", "replacement_authorized"] as const)(
    "stops %s at the exact fixed deadline",
    (state) => {
      const facts = paymentFactsFixture({
        observedAt: "2026-09-06T12:20:00Z",
        attempts: [{ id: recoveryAttemptId, generation: 1, state }],
      });
      expect(selectPaymentRecovery(facts, recoveryAttemptId)).toEqual({
        status: "deadline-elapsed",
      });
    },
  );
  it("permits failed replacement cleanup after the deadline", () => {
    const facts = paymentFactsFixture({
      observedAt: "2026-09-06T12:21:00Z",
      attempts: [
        { id: recoveryAttemptId, generation: 1, state: "capture_failed" },
      ],
    });
    expect(selectPaymentRecovery(facts, recoveryAttemptId)).toMatchObject({
      status: "execute",
      step: "replacement-release",
    });
  });
  it("queries the admitted identity after interruption before recording, even after the deadline", () => {
    const permit = recoveryPermitFixture("replacement-capture");
    const facts = paymentFactsFixture({
      observedAt: "2026-09-06T12:21:00Z",
      operations: [
        paymentOperationFixture({
          recoveryAttemptId,
          recoveryStep: "replacement-capture",
          permit,
          outcome: null,
          providerRequestId: null,
          providerReference: null,
        }),
      ],
    });
    expect(selectPaymentRecovery(facts, recoveryAttemptId)).toMatchObject({
      status: "reconcile",
      permit,
      providerRequestId: null,
      providerReference: null,
    });
  });
  it("does not create another identity after proved absence", () => {
    const facts = paymentFactsFixture({
      operations: [
        paymentOperationFixture({
          recoveryAttemptId,
          recoveryStep: "original-release",
          outcome: "not-executed",
        }),
      ],
    });
    expect(selectPaymentRecovery(facts, recoveryAttemptId)).toEqual({
      status: "blocked",
    });
  });
  it("does not execute or confirm quarantined work", async () => {
    const test = fixture();
    test.repository.facts.mockResolvedValue(
      paymentFactsFixture({ quarantined: true }),
    );
    expect(await test.service.resume(recoveryAttemptId)).toEqual({
      status: "quarantined",
    });
    expect(test.operations.execute).not.toHaveBeenCalled();
    expect(test.confirmation.execute).not.toHaveBeenCalled();
  });
  it("reloads a stale command without a provider effect", async () => {
    const test = fixture(["succeeded"]);
    test.repository.facts.mockResolvedValueOnce(paymentFactsFixture());
    test.repository.lease.mockResolvedValueOnce({ status: "stale" } as never);
    expect(await test.service.resume(recoveryAttemptId)).toEqual({
      status: "succeeded",
    });
    expect(test.operations.execute).not.toHaveBeenCalled();
  });
  it("propagates customer denial before private work", async () => {
    const test = fixture();
    test.repository.admit.mockRejectedValueOnce(new Error("denied"));
    await expect(
      test.service.execute({
        bookingRequestId: requestId,
        commandKey: requestId,
      }),
    ).rejects.toThrow("denied");
    expect(test.repository.facts).not.toHaveBeenCalled();
  });
});

it.each([
  ["2026-09-06T12:20:00.000000Z", "execute"],
  ["2026-09-06T12:20:00.000500Z", "deadline-elapsed"],
  ["2026-09-06T12:20:00.001000Z", "deadline-elapsed"],
  ["2026-09-06T15:20:00.000000+03:00", "execute"],
])("selects recovery at exact database time %s", (observedAt, status) => {
  expect(
    selectPaymentRecovery(
      paymentFactsFixture({
        deadline: "2026-09-06T12:20:00.000500Z",
        observedAt,
      }),
      recoveryAttemptId,
    ),
  ).toMatchObject({ status });
});
