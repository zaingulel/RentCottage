import { describe, expect, it } from "vitest";

import {
  rehydrateBookingRequestCaptureExecutionPermit,
  rehydrateBookingRequestCaptureSnapshot,
} from "./booking-request-capture-contract";
import { PaymentSimulator } from "./payment-simulator";

const paymentLifecycleId = "44444444-4444-4444-8444-444444444444";
const authorizationLogicalOperationId = `${paymentLifecycleId}:authorization`;
const authorizationPhysicalAttemptId = `${authorizationLogicalOperationId}:attempt-1`;
const captureLogicalOperationId = `${paymentLifecycleId}:capture`;
const capturePhysicalAttemptId = `${captureLogicalOperationId}:attempt-2`;

const binding = {
  bookingRequestId: "11111111-1111-4111-8111-111111111111",
  submissionAttemptId: "22222222-2222-4222-8222-222222222222",
  authorizationClaimId: "33333333-3333-4333-8333-333333333333",
  authorizationClaimGeneration: 1,
  paymentLifecycleId,
  authorizationLogicalOperationId,
  authorizationPhysicalAttemptId,
  captureLogicalOperationId,
  capturePhysicalAttemptId,
  amountFils: 105_000_000,
  currency: "IQD" as const,
  providerIdentity: {
    provider: "fictitious-payments",
    environment: "sandbox",
    merchantId: "merchant-test-only",
    terminalId: "terminal-test-only",
  },
  idempotencyKey:
    "booking-request-capture:11111111-1111-4111-8111-111111111111:1",
  requestFingerprint:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

const authorizationProviderResult = {
  providerRequestId: "provider-request-authorization",
  providerReference: "provider-reference-authorization",
  movementReference: "movement-authorization",
};
const captureProviderResult = {
  providerRequestId: "provider-request-capture",
  providerReference: "provider-reference-capture",
  movementReference: "movement-capture",
};
const authorizationRecordedAt = "2026-08-26T09:00:00.000Z";
const captureRecordedAt = "2026-08-26T09:01:00.000Z";

const expectedEvidence = {
  ...binding,
  authorizationProviderResult,
  captureProviderResult,
  authorizationRecordedAt,
  captureRecordedAt,
};

const permitExpectation = {
  ...binding,
  workId: "55555555-5555-4555-8555-555555555555",
  leaseGeneration: 3,
  leaseToken: "66666666-6666-4666-8666-666666666666",
  notAfter: "2026-08-26T09:05:00.000Z",
};

const captureExecutionPermit = () => ({
  purpose: "booking-request-capture" as const,
  ...permitExpectation,
  providerIdentity: { ...permitExpectation.providerIdentity },
});

const captureSnapshot = () => ({
  ...binding,
  providerIdentity: { ...binding.providerIdentity },
  authorization: {
    paymentLifecycleId,
    kind: "authorization",
    logicalOperationId: authorizationLogicalOperationId,
    attemptId: authorizationPhysicalAttemptId,
    status: "succeeded",
    amountFils: binding.amountFils,
    ...authorizationProviderResult,
    reconciliationRequired: false,
    retrySafe: false,
  },
  capture: {
    paymentLifecycleId,
    kind: "capture",
    logicalOperationId: captureLogicalOperationId,
    attemptId: capturePhysicalAttemptId,
    status: "succeeded",
    amountFils: binding.amountFils,
    ...captureProviderResult,
    reconciliationRequired: false,
    retrySafe: false,
  },
  movements: [
    {
      kind: "authorization",
      logicalOperationId: authorizationLogicalOperationId,
      attemptId: authorizationPhysicalAttemptId,
      amountFils: binding.amountFils,
      movementReference: authorizationProviderResult.movementReference,
      recordedAt: authorizationRecordedAt,
    },
    {
      kind: "capture",
      logicalOperationId: captureLogicalOperationId,
      attemptId: capturePhysicalAttemptId,
      amountFils: binding.amountFils,
      movementReference: captureProviderResult.movementReference,
      recordedAt: captureRecordedAt,
    },
  ],
});

describe("Booking Request capture evidence contract", () => {
  it("rehydrates the exact successful Authorization and Capture evidence", () => {
    const snapshot = captureSnapshot();
    const rehydrated = rehydrateBookingRequestCaptureSnapshot(
      snapshot,
      expectedEvidence,
    );
    const operationKinds: ["authorization", "capture"] = [
      rehydrated.authorization.kind,
      rehydrated.capture.kind,
    ];
    const operationStatuses: ["succeeded", "succeeded"] = [
      rehydrated.authorization.status,
      rehydrated.capture.status,
    ];
    const providerRequestIds: [string, string] = [
      rehydrated.authorization.providerRequestId,
      rehydrated.capture.providerRequestId,
    ];
    const movementKinds: ["authorization", "capture"] = [
      rehydrated.movements[0].kind,
      rehydrated.movements[1].kind,
    ];

    expect(rehydrated).toEqual(snapshot);
    expect({
      operationKinds,
      operationStatuses,
      providerRequestIds,
      movementKinds,
    }).toEqual({
      operationKinds: ["authorization", "capture"],
      operationStatuses: ["succeeded", "succeeded"],
      providerRequestIds: [
        authorizationProviderResult.providerRequestId,
        captureProviderResult.providerRequestId,
      ],
      movementKinds: ["authorization", "capture"],
    });
  });

  it("accepts a provider reference shared by Authorization and Capture", () => {
    const providerReference = "provider-transaction-reference";
    const snapshot = captureSnapshot();
    snapshot.authorization.providerReference = providerReference;
    snapshot.capture.providerReference = providerReference;

    expect(
      rehydrateBookingRequestCaptureSnapshot(snapshot, {
        ...expectedEvidence,
        authorizationProviderResult: {
          ...authorizationProviderResult,
          providerReference,
        },
        captureProviderResult: {
          ...captureProviderResult,
          providerReference,
        },
      }),
    ).toEqual(snapshot);
  });

  it.each([
    [
      "Booking Request",
      { bookingRequestId: "99999999-9999-4999-8999-999999999999" },
    ],
    [
      "submission attempt",
      { submissionAttemptId: "99999999-9999-4999-8999-999999999999" },
    ],
    [
      "Authorization claim",
      { authorizationClaimId: "99999999-9999-4999-8999-999999999999" },
    ],
    ["Authorization claim generation", { authorizationClaimGeneration: 2 }],
    [
      "Payment Lifecycle",
      { paymentLifecycleId: "99999999-9999-4999-8999-999999999999" },
    ],
    [
      "Authorization logical operation",
      { authorizationLogicalOperationId: `${paymentLifecycleId}:release` },
    ],
    [
      "Authorization physical attempt",
      {
        authorizationPhysicalAttemptId: `${authorizationLogicalOperationId}:attempt-9`,
      },
    ],
    [
      "Capture logical operation",
      { captureLogicalOperationId: `${paymentLifecycleId}:refund` },
    ],
    [
      "Capture physical attempt",
      { capturePhysicalAttemptId: `${captureLogicalOperationId}:attempt-9` },
    ],
    ["Customer Total", { amountFils: 105_001_000 }],
    ["currency", { currency: "USD" }],
    [
      "provider name",
      {
        providerIdentity: {
          ...binding.providerIdentity,
          provider: "another-provider",
        },
      },
    ],
    [
      "provider environment",
      {
        providerIdentity: {
          ...binding.providerIdentity,
          environment: "production",
        },
      },
    ],
    [
      "provider merchant",
      {
        providerIdentity: {
          ...binding.providerIdentity,
          merchantId: "another-merchant",
        },
      },
    ],
    [
      "provider terminal",
      {
        providerIdentity: {
          ...binding.providerIdentity,
          terminalId: "another-terminal",
        },
      },
    ],
    [
      "extra provider identity field",
      {
        providerIdentity: {
          ...binding.providerIdentity,
          unrelatedIdentity: "not-the-authorized-provider",
        },
      },
    ],
    [
      "idempotency identity",
      { idempotencyKey: `${binding.idempotencyKey}:replacement` },
    ],
    ["request fingerprint", { requestFingerprint: "b".repeat(64) }],
    ["extra field", { unrelatedEvidence: "not-capture-evidence" }],
  ])("rejects a substituted %s binding", (_name, replacement) => {
    expect(() =>
      rehydrateBookingRequestCaptureSnapshot(
        { ...captureSnapshot(), ...replacement },
        expectedEvidence,
      ),
    ).toThrow("Booking Request capture evidence is invalid");
  });

  it.each([
    [
      "Authorization lifecycle",
      "authorization",
      { paymentLifecycleId: "99999999-9999-4999-8999-999999999999" },
    ],
    ["Authorization kind", "authorization", { kind: "release" }],
    ["Authorization status", "authorization", { status: "pending" }],
    [
      "Authorization logical operation",
      "authorization",
      { logicalOperationId: `${paymentLifecycleId}:release` },
    ],
    [
      "Authorization physical attempt",
      "authorization",
      { attemptId: `${authorizationLogicalOperationId}:attempt-9` },
    ],
    ["Authorization amount", "authorization", { amountFils: 105_001_000 }],
    [
      "Authorization provider request",
      "authorization",
      { providerRequestId: "replacement-provider-request" },
    ],
    [
      "Authorization provider reference",
      "authorization",
      { providerReference: "replacement-provider-reference" },
    ],
    [
      "Authorization movement reference",
      "authorization",
      { movementReference: "replacement-authorization-movement" },
    ],
    [
      "Authorization reconciliation state",
      "authorization",
      { reconciliationRequired: true },
    ],
    ["Authorization retry state", "authorization", { retrySafe: true }],
    ["Capture kind", "capture", { kind: "refund" }],
    ["Capture status", "capture", { status: "pending" }],
    [
      "Capture logical operation",
      "capture",
      { logicalOperationId: `${paymentLifecycleId}:refund` },
    ],
    [
      "Capture physical attempt",
      "capture",
      { attemptId: `${captureLogicalOperationId}:attempt-9` },
    ],
    ["Capture amount", "capture", { amountFils: 105_001_000 }],
    [
      "Capture provider request",
      "capture",
      { providerRequestId: "replacement-provider-request" },
    ],
    [
      "Capture provider reference",
      "capture",
      { providerReference: "replacement-provider-reference" },
    ],
    [
      "Capture movement reference",
      "capture",
      { movementReference: "replacement-capture-movement" },
    ],
    ["extra Capture field", "capture", { unrelatedEvidence: true }],
  ])("rejects substituted %s evidence", (_name, operationName, replacement) => {
    const snapshot = captureSnapshot();
    const operation = snapshot[operationName as "authorization" | "capture"];

    expect(() =>
      rehydrateBookingRequestCaptureSnapshot(
        {
          ...snapshot,
          [operationName]: { ...operation, ...replacement },
        },
        expectedEvidence,
      ),
    ).toThrow("Booking Request capture evidence is invalid");
  });

  it("rejects a coupled replacement of Capture provider and movement identities", () => {
    const snapshot = captureSnapshot();
    const replacementMovementReference = "replacement-capture-movement";

    expect(() =>
      rehydrateBookingRequestCaptureSnapshot(
        {
          ...snapshot,
          capture: {
            ...snapshot.capture,
            providerRequestId: "replacement-capture-request",
            providerReference: "replacement-capture-reference",
            movementReference: replacementMovementReference,
          },
          movements: [
            snapshot.movements[0],
            {
              ...snapshot.movements[1],
              movementReference: replacementMovementReference,
            },
          ],
        },
        expectedEvidence,
      ),
    ).toThrow("Booking Request capture evidence is invalid");
  });

  it("rejects a duplicated provider request identity", () => {
    const snapshot = captureSnapshot();
    snapshot.capture.providerRequestId =
      authorizationProviderResult.providerRequestId;

    expect(() =>
      rehydrateBookingRequestCaptureSnapshot(snapshot, {
        ...expectedEvidence,
        captureProviderResult: {
          ...captureProviderResult,
          providerRequestId: authorizationProviderResult.providerRequestId,
        },
      }),
    ).toThrow("Booking Request capture evidence is invalid");
  });

  it("rejects a duplicated movement identity", () => {
    const snapshot = captureSnapshot();
    snapshot.capture.movementReference =
      authorizationProviderResult.movementReference;
    snapshot.movements[1].movementReference =
      authorizationProviderResult.movementReference;

    expect(() =>
      rehydrateBookingRequestCaptureSnapshot(snapshot, {
        ...expectedEvidence,
        captureProviderResult: {
          ...captureProviderResult,
          movementReference: authorizationProviderResult.movementReference,
        },
      }),
    ).toThrow("Booking Request capture evidence is invalid");
  });

  const movements = captureSnapshot().movements;
  it.each([
    ["missing", [movements[0]]],
    ["reordered", [movements[1], movements[0]]],
    ["duplicated", [movements[0], movements[0]]],
    ["unrelated", [movements[0], { ...movements[1], kind: "release" }]],
    [
      "replaced",
      [
        movements[0],
        {
          ...movements[1],
          movementReference: "replacement-capture-movement",
        },
      ],
    ],
    [
      "extra",
      [
        movements[0],
        movements[1],
        {
          ...movements[1],
          kind: "refund",
          logicalOperationId: `${paymentLifecycleId}:refund:1`,
          attemptId: `${paymentLifecycleId}:refund:1:attempt-3`,
          amountFils: 1_000,
          movementReference: "unrelated-refund-movement",
        },
      ],
    ],
  ])("rejects %s money-movement evidence", (_name, replacedMovements) => {
    expect(() =>
      rehydrateBookingRequestCaptureSnapshot(
        { ...captureSnapshot(), movements: replacedMovements },
        expectedEvidence,
      ),
    ).toThrow("Booking Request capture evidence is invalid");
  });

  it.each([
    [
      "logical operation",
      { logicalOperationId: `${paymentLifecycleId}:release` },
    ],
    [
      "physical attempt",
      { attemptId: `${authorizationLogicalOperationId}:attempt-9` },
    ],
    ["amount", { amountFils: 105_001_000 }],
    ["valid timestamp", { recordedAt: "2026-08-26T08:59:00.000Z" }],
    ["extra field", { unrelatedEvidence: true }],
  ])("rejects a money movement with a substituted %s", (_name, replacement) => {
    const snapshot = captureSnapshot();

    expect(() =>
      rehydrateBookingRequestCaptureSnapshot(
        {
          ...snapshot,
          movements: [
            { ...snapshot.movements[0], ...replacement },
            snapshot.movements[1],
          ],
        },
        expectedEvidence,
      ),
    ).toThrow("Booking Request capture evidence is invalid");
  });

  it("rejects a replaced Capture movement timestamp", () => {
    const snapshot = captureSnapshot();
    snapshot.movements[1].recordedAt = "2026-08-26T09:02:00.000Z";

    expect(() =>
      rehydrateBookingRequestCaptureSnapshot(snapshot, expectedEvidence),
    ).toThrow("Booking Request capture evidence is invalid");
  });

  it("rejects Capture movement chronology before Authorization", () => {
    const snapshot = captureSnapshot();
    const contradictoryCaptureRecordedAt = "2026-08-26T08:59:00.000Z";
    snapshot.movements[1].recordedAt = contradictoryCaptureRecordedAt;

    expect(() =>
      rehydrateBookingRequestCaptureSnapshot(snapshot, {
        ...expectedEvidence,
        captureRecordedAt: contradictoryCaptureRecordedAt,
      }),
    ).toThrow("Booking Request capture evidence is invalid");
  });

  it("rehydrates immutable evidence and preserves its exact order on replay", () => {
    const stored = captureSnapshot();
    const rehydrated = rehydrateBookingRequestCaptureSnapshot(
      stored,
      expectedEvidence,
    );
    const replayed = rehydrateBookingRequestCaptureSnapshot(
      JSON.parse(JSON.stringify(rehydrated)),
      expectedEvidence,
    );

    stored.capture.movementReference = "caller-mutated-capture-movement";
    stored.movements.reverse();

    expect(replayed).toEqual(rehydrated);
    expect(rehydrated.capture.movementReference).toBe("movement-capture");
    expect(
      rehydrated.movements.map((movement) => movement.movementReference),
    ).toEqual(["movement-authorization", "movement-capture"]);
    expect(
      [
        rehydrated,
        rehydrated.providerIdentity,
        rehydrated.authorization,
        rehydrated.capture,
        rehydrated.movements,
        ...rehydrated.movements,
      ].every(Object.isFrozen),
    ).toBe(true);
  });

  it("rehydrates the exact Booking Request Capture execution permit", () => {
    const permit = captureExecutionPermit();

    expect(
      rehydrateBookingRequestCaptureExecutionPermit(permit, permitExpectation),
    ).toEqual(permit);
  });

  it("does not activate provider execution from a Capture execution permit", async () => {
    const provider = new PaymentSimulator({
      now: () => "2026-08-26T09:00:00.000Z",
      outcomes: ["succeeded"],
    });

    await expect(
      provider.execute({
        kind: "capture",
        paymentLifecycleId,
        logicalOperationId: captureLogicalOperationId,
        attemptId: capturePhysicalAttemptId,
        amountFils: binding.amountFils,
        currency: "IQD",
        executionPermit: captureExecutionPermit(),
      }),
    ).resolves.toEqual({ outcome: "not-executed" });
    expect(provider.requests).toHaveLength(0);
  });

  it.each([
    ["purpose", { purpose: "booking-request-release" }],
    [
      "Booking Request",
      { bookingRequestId: "99999999-9999-4999-8999-999999999999" },
    ],
    [
      "submission attempt",
      { submissionAttemptId: "99999999-9999-4999-8999-999999999999" },
    ],
    [
      "Authorization claim",
      { authorizationClaimId: "99999999-9999-4999-8999-999999999999" },
    ],
    ["Authorization claim generation", { authorizationClaimGeneration: 2 }],
    [
      "Payment Lifecycle",
      { paymentLifecycleId: "99999999-9999-4999-8999-999999999999" },
    ],
    [
      "Authorization logical operation",
      { authorizationLogicalOperationId: `${paymentLifecycleId}:release` },
    ],
    [
      "Authorization physical attempt",
      {
        authorizationPhysicalAttemptId: `${authorizationLogicalOperationId}:attempt-9`,
      },
    ],
    [
      "Capture logical operation",
      { captureLogicalOperationId: `${paymentLifecycleId}:refund` },
    ],
    [
      "Capture physical attempt",
      { capturePhysicalAttemptId: `${captureLogicalOperationId}:attempt-9` },
    ],
    ["Customer Total", { amountFils: 105_001_000 }],
    ["currency", { currency: "USD" }],
    [
      "provider",
      {
        providerIdentity: {
          ...binding.providerIdentity,
          terminalId: "another-terminal",
        },
      },
    ],
    [
      "idempotency identity",
      { idempotencyKey: `${binding.idempotencyKey}:replacement` },
    ],
    ["request fingerprint", { requestFingerprint: "b".repeat(64) }],
    ["capture work", { workId: "99999999-9999-4999-8999-999999999999" }],
    ["lease generation", { leaseGeneration: 4 }],
    ["lease token", { leaseToken: "99999999-9999-4999-8999-999999999999" }],
    ["expiry", { notAfter: "2026-08-26T09:06:00.000Z" }],
    ["extra field", { unrelatedEvidence: "not-permit-evidence" }],
  ])("rejects a substituted %s permit binding", (_name, replacement) => {
    expect(() =>
      rehydrateBookingRequestCaptureExecutionPermit(
        { ...captureExecutionPermit(), ...replacement },
        permitExpectation,
      ),
    ).toThrow("Booking Request capture execution permit is invalid");
  });

  it("rehydrates an immutable permit and preserves the same replay identity", () => {
    const stored = captureExecutionPermit();
    const rehydrated = rehydrateBookingRequestCaptureExecutionPermit(
      stored,
      permitExpectation,
    );
    const replayed = rehydrateBookingRequestCaptureExecutionPermit(
      JSON.parse(JSON.stringify(rehydrated)),
      permitExpectation,
    );

    stored.workId = "99999999-9999-4999-8999-999999999999";
    stored.providerIdentity.terminalId = "caller-mutated-terminal";

    expect(replayed).toEqual(rehydrated);
    expect(rehydrated.workId).toBe(permitExpectation.workId);
    expect(rehydrated.providerIdentity.terminalId).toBe("terminal-test-only");
    expect(Object.isFrozen(rehydrated)).toBe(true);
    expect(Object.isFrozen(rehydrated.providerIdentity)).toBe(true);
  });
});
