import { describe, expect, it, vi } from "vitest";
import {
  paymentFactsFixture,
  paymentOperationFixture,
  recoveryAttemptId,
  recoveryPermitFixture,
} from "../../tests/fixtures/payment-recovery.fixtures";
import {
  createBookingRequestPaymentObservation,
  selectPaymentObservation,
} from "./booking-request-payment-observation";
import type { RecoveryState } from "./booking-request-payment-observation";
import type { PaymentRecoveryStep } from "@/payment/booking-request-payment-recovery-contract";
import type { ProviderOperationResult } from "@/payment/payment-contract";
const operationId = paymentOperationFixture().id;
function result(
  outcome: "succeeded" | "failed" | "indeterminate",
  occurredAt: string | null = "2026-09-06T12:10:00Z",
): ProviderOperationResult {
  return {
    outcome,
    providerRequestId: "request",
    providerReference: "reference",
    ...(outcome === "failed"
      ? { retrySafe: false }
      : { movementReference: "movement" }),
    evidence: {
      operationId,
      eventId: "event-1",
      provenance: "fictional-provider",
      originalOutcome: outcome,
      executedAt: "2026-09-06T12:05:00Z",
      occurredAt: outcome === "indeterminate" ? null : occurredAt,
      closedAt: null,
    },
  } as ProviderOperationResult;
}
const rows: [
  PaymentRecoveryStep,
  RecoveryState,
  "succeeded" | "failed" | "indeterminate",
  RecoveryState,
  boolean,
][] = [
  ["original-release", "admitted", "succeeded", "original_released", false],
  ["original-release", "admitted", "failed", "blocked", true],
  ["original-release", "admitted", "indeterminate", "blocked", true],
  [
    "replacement-authorization",
    "original_released",
    "succeeded",
    "replacement_authorized",
    false,
  ],
  [
    "replacement-authorization",
    "original_released",
    "failed",
    "safely_failed",
    false,
  ],
  [
    "replacement-authorization",
    "original_released",
    "indeterminate",
    "blocked",
    true,
  ],
  [
    "replacement-capture",
    "replacement_authorized",
    "succeeded",
    "succeeded",
    false,
  ],
  [
    "replacement-capture",
    "replacement_authorized",
    "failed",
    "capture_failed",
    false,
  ],
  [
    "replacement-capture",
    "replacement_authorized",
    "indeterminate",
    "blocked",
    true,
  ],
  [
    "replacement-release",
    "capture_failed",
    "succeeded",
    "safely_failed",
    false,
  ],
  ["replacement-release", "capture_failed", "failed", "blocked", true],
];
describe("atomic payment observation selection", () => {
  it.each(rows)(
    "selects %s %s %s as %s with quarantine=%s",
    (step, state, outcome, expected, quarantined) => {
      const permit = recoveryPermitFixture(step);
      const facts = paymentFactsFixture({
        attempts: [{ id: recoveryAttemptId, generation: 1, state }],
        operations: [
          paymentOperationFixture({
            kind:
              step === "replacement-capture"
                ? "capture"
                : step === "replacement-authorization"
                  ? "authorization"
                  : "release",
            recoveryAttemptId,
            recoveryStep: step,
            permit,
            originalOutcome: null,
            outcome: null,
          }),
        ],
      });
      const decision = selectPaymentObservation(
        facts,
        operationId,
        result(outcome),
      );
      expect(decision.recoveryState).toBe(expected);
      expect(decision.quarantineReason !== null).toBe(quarantined);
    },
  );
  it.each(["2026-09-06T12:20:00Z", "2026-09-06T12:20:01Z"])(
    "binds refund ownership to a capture occurring at/after deadline %s",
    (occurredAt) => {
      const facts = paymentFactsFixture({
        operations: [
          paymentOperationFixture({
            originalOutcome: "indeterminate",
            outcome: "indeterminate",
          }),
        ],
      });
      expect(
        selectPaymentObservation(
          facts,
          operationId,
          result("succeeded", occurredAt),
        ),
      ).toMatchObject({
        correctiveCaptureId: operationId,
        quarantineReason: null,
      });
    },
  );
  it("keeps on-time occurrence eligible when its receipt arrives late", () => {
    const facts = paymentFactsFixture({
      observedAt: "2026-09-06T12:21:00Z",
      attempts: [
        {
          id: recoveryAttemptId,
          generation: 1,
          state: "replacement_authorized",
        },
      ],
      operations: [
        paymentOperationFixture({
          recoveryAttemptId,
          recoveryStep: "replacement-capture",
          permit: recoveryPermitFixture(),
          originalOutcome: null,
          outcome: null,
        }),
      ],
    });
    expect(
      selectPaymentObservation(facts, operationId, result("succeeded")),
    ).toMatchObject({ recoveryState: "succeeded", correctiveCaptureId: null });
  });
  it("quarantines unknown capture occurrence and failed-to-success contradiction", () => {
    expect(
      selectPaymentObservation(
        paymentFactsFixture(),
        operationId,
        result("succeeded", null),
      ).quarantineReason,
    ).toBe("capture-occurrence-unknown");
    expect(
      selectPaymentObservation(
        paymentFactsFixture(),
        operationId,
        result("succeeded", "2026-09-06T12:20:00Z"),
      ),
    ).toMatchObject({
      quarantineReason: "conflicting-provider-observation",
      correctiveCaptureId: null,
    });
  });
  it("keeps quarantine sticky while retaining later evidence", () => {
    const facts = paymentFactsFixture({
      quarantined: true,
      operations: [
        paymentOperationFixture({ originalOutcome: "indeterminate" }),
      ],
    });
    expect(
      selectPaymentObservation(
        facts,
        operationId,
        result("succeeded", "2026-09-06T12:20:00Z"),
      ),
    ).toMatchObject({ recoveryState: null, correctiveCaptureId: null });
  });
  it("reselects a stale observation using the same provider receipt without executing another effect", async () => {
    const received = result("failed");
    const repository = {
      facts: vi.fn().mockResolvedValue(paymentFactsFixture()),
      record: vi
        .fn()
        .mockResolvedValueOnce("stale")
        .mockResolvedValueOnce(received),
      correct: vi.fn(),
    };
    const observation = createBookingRequestPaymentObservation({ repository });
    expect(await observation.record({ operationId } as never, received)).toBe(
      received,
    );
    expect(repository.record).toHaveBeenCalledTimes(2);
    expect(
      repository.record.mock.calls.every((call) => call[1] === received),
    ).toBe(true);
  });
  it("classifies malformed passive receipts before the one atomic commit", async () => {
    const repository = {
      facts: vi.fn().mockResolvedValue(paymentFactsFixture()),
      record: vi.fn(),
      correct: vi.fn().mockResolvedValue({ status: "quarantined" }),
    };
    const observation = createBookingRequestPaymentObservation({ repository });
    expect(
      await observation.correct(
        paymentFactsFixture().bookingRequestId,
        operationId,
        { receiptId: "bad" },
      ),
    ).toEqual({ status: "quarantined" });
    expect(repository.correct).toHaveBeenCalledWith(
      paymentFactsFixture().bookingRequestId,
      operationId,
      { receiptId: "bad" },
      expect.objectContaining({
        quarantineReason: "malformed-provider-observation",
      }),
    );
  });
});

it.each([
  ["2026-09-06T12:20:00.000000Z", "succeeded"],
  ["2026-09-06T12:20:00.000500Z", "late_succeeded"],
  ["2026-09-06T12:20:00.001000Z", "late_succeeded"],
  ["2026-09-06T15:20:00.000000+03:00", "succeeded"],
  ["2026-09-06T15:20:00.000500+0300", "late_succeeded"],
  ["2026-09-06T12:20:00Z", "succeeded"],
  ["2026-09-06T12:20:00.0Z", "succeeded"],
  ["2026-09-06T12:20:00.00Z", "succeeded"],
  ["2026-09-06T12:20:00.000Z", "succeeded"],
  ["2026-09-06T12:20:00.0005Z", "late_succeeded"],
  ["2026-09-06T12:20:00.00050Z", "late_succeeded"],
])(
  "preserves exact capture occurrence %s at the microsecond deadline",
  (occurredAt, recoveryState) => {
    const facts = paymentFactsFixture({
      deadline: "2026-09-06T12:20:00.000500Z",
      attempts: [
        {
          id: recoveryAttemptId,
          generation: 1,
          state: "replacement_authorized",
        },
      ],
      operations: [
        paymentOperationFixture({
          recoveryAttemptId,
          recoveryStep: "replacement-capture",
          permit: recoveryPermitFixture(),
          originalOutcome: null,
          outcome: null,
        }),
      ],
    });
    expect(
      selectPaymentObservation(
        facts,
        operationId,
        result("succeeded", occurredAt),
      ),
    ).toMatchObject({
      recoveryState,
      correctiveCaptureId: recoveryState === "succeeded" ? null : operationId,
    });
  },
);
