import { describe, expect, it, vi } from "vitest";
import {
  paymentFactsFixture,
  paymentOperationFixture,
  recoveryAttemptId,
  recoveryPermitFixture,
} from "../../tests/fixtures/payment-recovery.fixtures";
import {
  createBookingRequestPaymentRequiredExpiry,
  selectPaymentRequiredExpiry,
} from "./booking-request-payment-required-expiry";
import type {
  BookingRequestPaymentFacts,
  PaymentExpiryOperationFact,
} from "./booking-request-payment-observation";
import type { PaymentProviderAdapter } from "@/payment/payment-contract";
const base = () =>
  paymentFactsFixture({ observedAt: "2026-09-06T12:20:00Z", attempts: [] });
function owned(
  overrides: Partial<PaymentExpiryOperationFact> = {},
): PaymentExpiryOperationFact {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    owner: "expiry",
    authorizationLifecycleId: base().originalLifecycleId,
    kind: "release",
    captureId: null,
    providerOperationId: null,
    valid: true,
    permit: {
      purpose: "booking-request-payment-required-expiry",
      expiryWorkId: "66666666-6666-4666-8666-666666666666",
      expiryOperationId: "55555555-5555-4555-8555-555555555555",
      idempotencyKey: "expiry-release:1",
      notBefore: base().deadline,
      binding: {
        bookingRequestId: base().bookingRequestId,
        authorizationClaimId: "77777777-7777-4777-8777-777777777777",
        authorizationClaimGeneration: 1,
        authorizationPaymentLifecycleId: base().originalLifecycleId,
        authorizationLogicalOperationId: "authorization",
        authorizationPhysicalAttemptId: "authorization:1",
        predecessorMovementReference: "authorization-movement",
        predecessorOutcomeAt: "2026-09-06T11:00:00Z",
        releaseLogicalOperationId: "expiry-release",
        releasePhysicalAttemptId: "expiry-release:1",
        amountFils: base().amountFils,
        currency: "IQD",
        requestFingerprint: "a".repeat(64),
        providerIdentity: base().providerIdentity,
      },
    },
    ...overrides,
  };
}
function fixture(initial: BookingRequestPaymentFacts = base()) {
  let facts = initial;
  const repository = {
    due: vi.fn(async () => [facts.bookingRequestId]),
    facts: vi.fn(async () => facts),
    prepare: vi.fn(async (_id, _provider, command) => {
      facts =
        command.action === "quarantine"
          ? { ...facts, quarantined: true }
          : { ...facts, expiryOperations: [owned()] };
      return { status: "prepared" as const };
    }),
    finalize: vi.fn(async () => ({ status: "expired" as const })),
  };
  const operations = {
    execute: vi.fn(async () => {
      const operation = paymentOperationFixture({
        id: "88888888-8888-4888-8888-888888888888",
        kind: "release",
        outcome: "succeeded",
        originalOutcome: "succeeded",
        movementReference: "release",
      });
      facts = {
        ...facts,
        operations: [...facts.operations, operation],
        expiryOperations: [owned({ providerOperationId: operation.id })],
      };
      return {
        status: "recorded" as const,
        result: {
          outcome: "succeeded" as const,
          providerRequestId: "request",
          providerReference: "reference",
          movementReference: "release",
        },
      };
    }),
    query: vi.fn(),
  };
  const provider: PaymentProviderAdapter = {
    identity: facts.providerIdentity,
    execute: vi.fn(),
    query: vi.fn(),
    verifySignedEvent: () => false,
  };
  const recovery = {
    resume: vi.fn(async () => {
      facts = { ...facts, confirmationValid: true };
      return { status: "succeeded" };
    }),
  };
  return {
    repository,
    operations,
    recovery,
    service: createBookingRequestPaymentRequiredExpiry({
      repository,
      operations,
      provider,
      recovery,
    }),
  };
}
describe("application Payment Required expiry", () => {
  it("selects the original authorization, releases it, reloads evidence and expires", async () => {
    const test = fixture();
    expect(await test.service.processDue(20)).toEqual([{ status: "expired" }]);
    expect(test.repository.prepare).toHaveBeenCalledExactlyOnceWith(
      base().bookingRequestId,
      base().providerIdentity,
      {
        revision: base().revision,
        action: "release",
        authorizationLifecycleId: base().originalLifecycleId,
        recoveryOperationId: null,
      },
    );
    expect(test.operations.execute).toHaveBeenCalledOnce();
    expect(test.repository.finalize).toHaveBeenCalledOnce();
  });
  it("reuses successful recovery release instead of selecting a second release", () => {
    const release = paymentOperationFixture({
      id: "99999999-9999-4999-8999-999999999999",
      kind: "release",
      recoveryStep: "original-release",
      recoveryOperationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      recoveryAttemptId,
      outcome: "succeeded",
      originalOutcome: "succeeded",
      movementReference: "release",
    });
    expect(
      selectPaymentRequiredExpiry({
        ...base(),
        operations: [...base().operations, release],
      }),
    ).toMatchObject({
      status: "prepare",
      command: {
        action: "release",
        recoveryOperationId: release.recoveryOperationId,
      },
    });
  });
  it("examines every generation before releasing held inventory", () => {
    const replacement = paymentOperationFixture({
      id: "99999999-9999-4999-8999-999999999999",
      lifecycleId: recoveryAttemptId,
      kind: "authorization",
      recoveryAttemptId,
      recoveryStep: "replacement-authorization",
      recoveryOperationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      outcome: "succeeded",
      originalOutcome: "succeeded",
      movementReference: "replacement",
    });
    const facts = {
      ...base(),
      attempts: [
        {
          id: recoveryAttemptId,
          generation: 3,
          state: "replacement_authorized" as const,
        },
      ],
      operations: [...base().operations, replacement],
      expiryOperations: [owned()],
    };
    expect(selectPaymentRequiredExpiry(facts)).toMatchObject({
      status: "prepare",
      command: {
        action: "release",
        authorizationLifecycleId: recoveryAttemptId,
      },
    });
  });
  it("inquires an unresolved admission before selecting any money movement", () => {
    const unresolved = paymentOperationFixture({
      recoveryAttemptId,
      recoveryStep: "replacement-capture",
      outcome: null,
      permit: recoveryPermitFixture(),
      providerRequestId: null,
      providerReference: null,
    });
    expect(
      selectPaymentRequiredExpiry({ ...base(), operations: [unresolved] }),
    ).toMatchObject({
      status: "reconcile-recovery",
      permit: unresolved.permit,
      providerRequestId: null,
    });
  });
  it("selects refund ownership for eligible late capture rather than releasing captured authorization", () => {
    const late = paymentOperationFixture({
      outcome: "succeeded",
      originalOutcome: "indeterminate",
      occurredAt: base().deadline,
      movementReference: "late-capture",
    });
    expect(
      selectPaymentRequiredExpiry({ ...base(), operations: [late] }),
    ).toMatchObject({
      status: "prepare",
      command: { action: "refund", captureId: late.id },
    });
  });
  it("finishes an on-time replacement confirmation after the deadline", async () => {
    const capture = paymentOperationFixture({
      id: "99999999-9999-4999-8999-999999999999",
      lifecycleId: recoveryAttemptId,
      recoveryAttemptId,
      recoveryStep: "replacement-capture",
      recoveryOperationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      outcome: "succeeded",
      originalOutcome: "succeeded",
      movementReference: "capture",
    });
    const test = fixture({
      ...base(),
      attempts: [{ id: recoveryAttemptId, generation: 1, state: "succeeded" }],
      operations: [...base().operations, capture],
    });
    expect(await test.service.processDue(20)).toEqual([
      { status: "confirmed" },
    ]);
    expect(test.recovery.resume).toHaveBeenCalledExactlyOnceWith(
      recoveryAttemptId,
    );
    expect(test.operations.execute).not.toHaveBeenCalled();
  });
  it.each(["failed", "indeterminate"] as const)(
    "quarantines an unsafe release outcome %s",
    (outcome) => {
      const release = paymentOperationFixture({
        id: "99999999-9999-4999-8999-999999999999",
        kind: "release",
        outcome,
      });
      expect(
        selectPaymentRequiredExpiry({
          ...base(),
          operations: [...base().operations, release],
          expiryOperations: [owned({ providerOperationId: release.id })],
        }),
      ).toMatchObject({ status: "prepare", command: { action: "quarantine" } });
    },
  );
  it.each([null, "2026-09-06T12:20:00Z"])(
    "quarantines unknown or contradictory successful capture %s",
    (occurredAt) => {
      expect(
        selectPaymentRequiredExpiry({
          ...base(),
          operations: [
            paymentOperationFixture({
              outcome: "succeeded",
              originalOutcome: "failed",
              occurredAt,
              movementReference: "unsafe",
            }),
          ],
        }),
      ).toMatchObject({ status: "prepare", command: { action: "quarantine" } });
    },
  );
  it("honors sticky quarantine without provider calls", async () => {
    const test = fixture({ ...base(), quarantined: true });
    expect(await test.service.processDue(20)).toEqual([
      { status: "quarantined" },
    ]);
    expect(test.operations.execute).not.toHaveBeenCalled();
  });
  it("reloads denied admission without inventing another physical identity", async () => {
    const test = fixture({ ...base(), expiryOperations: [owned()] });
    test.operations.execute.mockResolvedValueOnce({
      status: "not-admitted",
    } as never);
    expect(await test.service.processDue(20)).toEqual([{ status: "expired" }]);
    expect(test.operations.execute.mock.calls).toHaveLength(2);
    expect(test.operations.execute.mock.calls[0]).toEqual(
      test.operations.execute.mock.calls[1],
    );
  });
  it.each([0, 51, 1.5, NaN])("rejects invalid batch size %s", async (limit) => {
    const test = fixture();
    expect(await test.service.processDue(limit)).toEqual([
      { status: "invalid" },
    ]);
    expect(test.repository.due).not.toHaveBeenCalled();
  });
});

it.each([
  ["2026-09-06T12:20:00.000000Z", "not-due"],
  ["2026-09-06T12:20:00.000500Z", "prepare"],
  ["2026-09-06T12:20:00.001000Z", "prepare"],
  ["2026-09-06T15:20:00.000000+03:00", "not-due"],
])("selects expiry at exact database time %s", (observedAt, status) => {
  expect(
    selectPaymentRequiredExpiry({
      ...base(),
      deadline: "2026-09-06T12:20:00.000500Z",
      observedAt,
    }),
  ).toMatchObject({ status });
});
