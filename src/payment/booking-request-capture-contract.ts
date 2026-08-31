import type {
  BookingRequestCaptureBinding,
  BookingRequestCaptureEvidenceExpectation,
  BookingRequestCaptureExecutionPermit,
  BookingRequestCaptureMovement,
  BookingRequestCapturePermitExpectation,
  BookingRequestCaptureProviderResultIdentity,
  BookingRequestCaptureSnapshot,
  BookingRequestCaptureSuccessfulOperation,
  PaymentProviderIdentity,
} from "./payment-contract";

const bindingKeys = [
  "bookingRequestId",
  "submissionAttemptId",
  "authorizationClaimId",
  "authorizationClaimGeneration",
  "paymentLifecycleId",
  "authorizationLogicalOperationId",
  "authorizationPhysicalAttemptId",
  "captureLogicalOperationId",
  "capturePhysicalAttemptId",
  "amountFils",
  "currency",
  "providerIdentity",
  "idempotencyKey",
  "requestFingerprint",
] as const;

const operationKeys = [
  "paymentLifecycleId",
  "kind",
  "logicalOperationId",
  "attemptId",
  "status",
  "amountFils",
  "providerRequestId",
  "providerReference",
  "movementReference",
  "reconciliationRequired",
  "retrySafe",
] as const;

const movementKeys = [
  "kind",
  "logicalOperationId",
  "attemptId",
  "amountFils",
  "movementReference",
  "recordedAt",
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function sameProviderIdentity(
  value: unknown,
  expected: PaymentProviderIdentity,
) {
  const provider = record(value);
  return (
    !!provider &&
    exactKeys(provider, [
      "provider",
      "environment",
      "merchantId",
      "terminalId",
    ]) &&
    provider.provider === expected.provider &&
    provider.environment === expected.environment &&
    provider.merchantId === expected.merchantId &&
    provider.terminalId === expected.terminalId
  );
}

function sameBinding(
  value: Record<string, unknown>,
  expected: BookingRequestCaptureBinding,
) {
  return bindingKeys.every((key) =>
    key === "providerIdentity"
      ? sameProviderIdentity(value[key], expected[key])
      : value[key] === expected[key],
  );
}

function operationIdentity(
  kind: "authorization" | "capture",
  expected: BookingRequestCaptureBinding,
) {
  return kind === "authorization"
    ? [
        expected.authorizationLogicalOperationId,
        expected.authorizationPhysicalAttemptId,
      ]
    : [expected.captureLogicalOperationId, expected.capturePhysicalAttemptId];
}

function validSuccessfulOperation(
  value: unknown,
  kind: "authorization" | "capture",
  expected: BookingRequestCaptureBinding,
  providerResult: BookingRequestCaptureProviderResultIdentity,
) {
  const operation = record(value);
  const [logicalOperationId, physicalAttemptId] = operationIdentity(
    kind,
    expected,
  );
  return (
    !!operation &&
    exactKeys(operation, operationKeys) &&
    operation.paymentLifecycleId === expected.paymentLifecycleId &&
    operation.kind === kind &&
    operation.logicalOperationId === logicalOperationId &&
    operation.attemptId === physicalAttemptId &&
    operation.status === "succeeded" &&
    operation.amountFils === expected.amountFils &&
    operation.providerRequestId === providerResult.providerRequestId &&
    operation.providerReference === providerResult.providerReference &&
    operation.movementReference === providerResult.movementReference &&
    operation.reconciliationRequired === false &&
    operation.retrySafe === false
  );
}

function distinctReplayIdentities(
  authorization: BookingRequestCaptureProviderResultIdentity,
  capture: BookingRequestCaptureProviderResultIdentity,
) {
  return (
    authorization.providerRequestId !== capture.providerRequestId &&
    authorization.movementReference !== capture.movementReference
  );
}

function chronologicalMovementEvidence(
  expected: BookingRequestCaptureEvidenceExpectation,
) {
  const authorizationTime = Date.parse(expected.authorizationRecordedAt);
  const captureTime = Date.parse(expected.captureRecordedAt);
  return (
    !Number.isNaN(authorizationTime) &&
    !Number.isNaN(captureTime) &&
    authorizationTime <= captureTime
  );
}

function validMovement(
  value: unknown,
  kind: "authorization" | "capture",
  expected: BookingRequestCaptureBinding,
  providerResult: BookingRequestCaptureProviderResultIdentity,
  recordedAt: string,
) {
  const movement = record(value);
  const [logicalOperationId, physicalAttemptId] = operationIdentity(
    kind,
    expected,
  );
  return (
    !!movement &&
    exactKeys(movement, movementKeys) &&
    movement.kind === kind &&
    movement.logicalOperationId === logicalOperationId &&
    movement.attemptId === physicalAttemptId &&
    movement.amountFils === expected.amountFils &&
    movement.movementReference === providerResult.movementReference &&
    movement.recordedAt === recordedAt
  );
}

export function rehydrateBookingRequestCaptureSnapshot(
  value: unknown,
  expected: BookingRequestCaptureEvidenceExpectation,
): BookingRequestCaptureSnapshot {
  const snapshot = record(value);
  if (
    !snapshot ||
    !exactKeys(snapshot, [
      ...bindingKeys,
      "authorization",
      "capture",
      "movements",
    ]) ||
    !sameBinding(snapshot, expected) ||
    !distinctReplayIdentities(
      expected.authorizationProviderResult,
      expected.captureProviderResult,
    ) ||
    !chronologicalMovementEvidence(expected) ||
    !validSuccessfulOperation(
      snapshot.authorization,
      "authorization",
      expected,
      expected.authorizationProviderResult,
    ) ||
    !validSuccessfulOperation(
      snapshot.capture,
      "capture",
      expected,
      expected.captureProviderResult,
    ) ||
    !Array.isArray(snapshot.movements) ||
    snapshot.movements.length !== 2 ||
    !validMovement(
      snapshot.movements[0],
      "authorization",
      expected,
      expected.authorizationProviderResult,
      expected.authorizationRecordedAt,
    ) ||
    !validMovement(
      snapshot.movements[1],
      "capture",
      expected,
      expected.captureProviderResult,
      expected.captureRecordedAt,
    )
  ) {
    throw new Error("Booking Request capture evidence is invalid.");
  }

  const movements = snapshot.movements as [
    BookingRequestCaptureMovement<"authorization">,
    BookingRequestCaptureMovement<"capture">,
  ];
  return Object.freeze({
    ...snapshot,
    providerIdentity: Object.freeze({
      ...(snapshot.providerIdentity as PaymentProviderIdentity),
    }),
    authorization: Object.freeze({
      ...(snapshot.authorization as BookingRequestCaptureSuccessfulOperation<"authorization">),
    }),
    capture: Object.freeze({
      ...(snapshot.capture as BookingRequestCaptureSuccessfulOperation<"capture">),
    }),
    movements: Object.freeze([
      Object.freeze({ ...movements[0] }),
      Object.freeze({ ...movements[1] }),
    ]),
  }) as BookingRequestCaptureSnapshot;
}

export function rehydrateBookingRequestCaptureExecutionPermit(
  value: unknown,
  expected: BookingRequestCapturePermitExpectation,
): BookingRequestCaptureExecutionPermit {
  const permit = record(value);
  if (
    !permit ||
    !exactKeys(permit, [
      "purpose",
      ...bindingKeys,
      "workId",
      "leaseGeneration",
      "leaseToken",
      "notAfter",
    ]) ||
    permit.purpose !== "booking-request-capture" ||
    !sameBinding(permit, expected) ||
    permit.workId !== expected.workId ||
    permit.leaseGeneration !== expected.leaseGeneration ||
    permit.leaseToken !== expected.leaseToken ||
    permit.notAfter !== expected.notAfter
  ) {
    throw new Error("Booking Request capture execution permit is invalid.");
  }

  return Object.freeze({
    ...permit,
    providerIdentity: Object.freeze({
      ...(permit.providerIdentity as PaymentProviderIdentity),
    }),
  }) as unknown as BookingRequestCaptureExecutionPermit;
}
