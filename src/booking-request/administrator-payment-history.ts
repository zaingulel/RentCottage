export const paymentHistoryKinds = [
  "logical-operation",
  "physical-attempt",
  "retry",
  "receipt-observation",
  "state-transition",
  "terminal-outcome",
  "quarantine",
] as const;

export type PaymentHistoryKind = (typeof paymentHistoryKinds)[number];
export type PaymentHistoryCoverage = "complete" | "retained-evidence-only";

export interface AdministratorPaymentHistoryEvent {
  readonly id: string;
  readonly kind: PaymentHistoryKind;
  readonly source: string;
  readonly provenance: "observed" | "imported";
  readonly operationKind?: string;
  readonly logicalOperationId?: string;
  readonly physicalAttemptId?: string;
  readonly operationGeneration?: number;
  readonly recoveryGeneration?: number;
  readonly fromState?: string;
  readonly toState?: string;
  readonly outcome?: string;
  readonly reasonCode?: string;
  readonly providerOperationId?: string;
  readonly providerRequestId?: string;
  readonly providerReference?: string;
  readonly movementReference?: string;
  readonly amountFils?: string;
  readonly currency?: "IQD";
  readonly providerOccurredAt?: string;
  readonly receivedAt?: string;
  readonly sourceRecordedAt?: string;
  readonly recordedAt: string;
}

export interface AdministratorPaymentHistory {
  readonly bookingRequestReference: string;
  readonly simulated: true;
  readonly current: {
    readonly requestStatus: string;
    readonly paymentStatus: string | null;
    readonly expiryStatus: string | null;
    readonly reasonCode: string | null;
    readonly paymentRequiredDeadline: string | null;
  };
  readonly historyCoverage: PaymentHistoryCoverage;
  readonly events: readonly AdministratorPaymentHistoryEvent[];
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reference = /^RC-REQ-[A-F0-9]{16}$/;
const decimal = /^[1-9]\d*$/;
const timestamp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

const sources = [
  "authorization-claim",
  "provider-operation",
  "release-work",
  "release-operation",
  "capture-work",
  "recovery-attempt",
  "recovery-operation",
  "expiry-work",
  "expiry-operation",
  "booking-request",
  "confirmation",
  "confirmation-invalidation",
  "provider-receipt",
];
const operations = [
  "authorization",
  "capture",
  "release",
  "refund",
  "settlement",
  "original-release",
  "replacement-authorization",
  "replacement-capture",
  "replacement-release",
  "expiry",
  "confirmation",
  "invalidation",
];
const states = [
  "paid-confirmed",
  "cancelled",
  "indeterminate",
  "pending",
  "processing",
  "accepted",
  "declined",
  "withdrawn",
  "expired",
  "starting",
  "not_started",
  "failed",
  "reconciliation_required",
  "authorized",
  "releasing",
  "released",
  "converted",
  "queued",
  "complete",
  "payment_required",
  "executing",
  "reconcile_required",
  "retryable",
  "succeeded",
  "admitted",
  "original_released",
  "replacement_authorized",
  "capture_failed",
  "blocked",
  "safely_failed",
  "late_succeeded",
  "attention_required",
  "quarantined",
  "confirmed",
  "invalidated",
];
const outcomes = [
  "unknown",
  "not_executed",
  "not-executed",
  "failed",
  "indeterminate",
  "succeeded",
  "declined",
  "withdrawn",
  "expired",
  "retrying",
  "duplicate",
  "conflicting",
  "malformed",
];
const reasons = [
  "customer-cancellation",
  "cottage_owner-cancellation",
  "platform_administrator-cancellation",
  "replacement-capture-succeeded",
  "source-evidence-invalid",
  "capture-occurrence-unknown",
  "original-capture-unresolved",
  "recovery-evidence-invalid",
  "unexplained-recovery-provider-operation",
  "recovery-operation-indeterminate",
  "corrective-capture-invalid",
  "unexplained-provider-operation",
  "original-release-indeterminate",
  "original-release-failed",
  "replacement-authorization-invalid",
  "replacement-release-indeterminate",
  "replacement-release-failed",
  "expiry-evidence-invalid",
  "expiry-release-failed",
  "expiry-release-indeterminate",
  "expiry-refund-failed",
  "expiry-refund-indeterminate",
  "inventory-evidence-invalid",
  "legacy-unresolved-money",
  "legacy-confirmation-evidence-invalid",
  "unsafe-recovery-original-release-indeterminate",
  "unsafe-recovery-original-release-failed",
  "unsafe-recovery-replacement-authorization-indeterminate",
  "unsafe-recovery-replacement-capture-indeterminate",
  "unsafe-recovery-replacement-release-indeterminate",
  "unsafe-recovery-replacement-release-failed",

  "cottage_unavailable",
  "cannot_accommodate_request",
  "other",
  "capture-failed",
  "payment-required-expired",
  "late-capture",
  "conflicting-evidence",
  "unresolved-evidence",
  "conflicting-provider-observation",
  "unresolved-provider-observation",
  "failed-release-observation",
  "failed-refund-observation",
  "malformed-provider-observation",
  "unclassified-evidence",
];
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("Administrator payment history data is invalid");
}
function code(value: unknown, allowed: readonly string[]): string {
  const result = requiredString(value);
  if (!allowed.includes(result))
    throw new Error("Administrator payment history data is invalid");
  return result;
}
function optionalCode(value: unknown, allowed: readonly string[]) {
  return value === undefined ? undefined : code(value, allowed);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Administrator payment history data is invalid");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value)
    throw new Error("Administrator payment history data is invalid");
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value);
}

function supportReference(
  value: unknown,
  kind: "request" | "reference" | "movement",
  operationId: unknown,
): string | undefined {
  const parsed = optionalString(value);
  if (parsed === undefined || parsed === "reference-unavailable") return parsed;
  const legacy = new RegExp(
    `^sim(-capture|-recovery|-expiry)?-${kind}-([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`,
  );
  if (
    !legacy.test(parsed) &&
    (typeof operationId !== "string" ||
      !uuid.test(operationId) ||
      parsed !== `internal-${kind}:${operationId}`)
  )
    throw new Error("Administrator payment history data is invalid");
  return parsed;
}

function optionalTimestamp(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const parsed = requiredString(value);
  if (!timestamp.test(parsed) || Number.isNaN(Date.parse(parsed)))
    throw new Error("Administrator payment history data is invalid");
  return parsed;
}

function parseEvent(value: unknown): AdministratorPaymentHistoryEvent {
  const event = record(value);
  onlyKeys(event, [
    "id",
    "kind",
    "source",
    "provenance",
    "operationKind",
    "logicalOperationId",
    "physicalAttemptId",
    "operationGeneration",
    "recoveryGeneration",
    "fromState",
    "toState",
    "outcome",
    "reasonCode",
    "providerOperationId",
    "providerRequestId",
    "providerReference",
    "movementReference",
    "amountFils",
    "currency",
    "providerOccurredAt",
    "receivedAt",
    "sourceRecordedAt",
    "recordedAt",
  ]);
  const id = requiredString(event.id);
  const kind = requiredString(event.kind);
  const provenance = requiredString(event.provenance);
  const recordedAt = optionalTimestamp(event.recordedAt);
  const amountFils = optionalString(event.amountFils);
  const operationGeneration = event.operationGeneration;
  const recoveryGeneration = event.recoveryGeneration;
  if (
    !uuid.test(id) ||
    !paymentHistoryKinds.includes(kind as PaymentHistoryKind) ||
    !["observed", "imported"].includes(provenance) ||
    !recordedAt ||
    (amountFils !== undefined &&
      (!decimal.test(amountFils) ||
        BigInt(amountFils) > 9223372036854775807n)) ||
    (amountFils !== undefined) !== (event.currency === "IQD") ||
    (event.currency !== undefined && event.currency !== "IQD") ||
    (operationGeneration !== undefined &&
      (typeof operationGeneration !== "number" ||
        !Number.isSafeInteger(operationGeneration) ||
        operationGeneration < 0)) ||
    (recoveryGeneration !== undefined &&
      (typeof recoveryGeneration !== "number" ||
        !Number.isSafeInteger(recoveryGeneration) ||
        recoveryGeneration < 0))
  )
    throw new Error("Administrator payment history data is invalid");
  return {
    id,
    kind: kind as PaymentHistoryKind,
    source: code(event.source, sources),
    provenance: provenance as "observed" | "imported",
    operationKind: optionalCode(event.operationKind, operations),
    logicalOperationId: optionalString(event.logicalOperationId),
    physicalAttemptId: optionalString(event.physicalAttemptId),
    operationGeneration: operationGeneration as number | undefined,
    recoveryGeneration: recoveryGeneration as number | undefined,
    fromState: optionalCode(event.fromState, states),
    toState: optionalCode(event.toState, states),
    outcome: optionalCode(event.outcome, outcomes),
    reasonCode: optionalCode(event.reasonCode, reasons),
    providerOperationId: optionalString(event.providerOperationId),
    providerRequestId: supportReference(
      event.providerRequestId,
      "request",
      event.providerOperationId,
    ),
    providerReference: supportReference(
      event.providerReference,
      "reference",
      event.providerOperationId,
    ),
    movementReference: supportReference(
      event.movementReference,
      "movement",
      event.providerOperationId,
    ),
    amountFils,
    currency: event.currency as "IQD" | undefined,
    providerOccurredAt: optionalTimestamp(event.providerOccurredAt),
    receivedAt: optionalTimestamp(event.receivedAt),
    sourceRecordedAt: optionalTimestamp(event.sourceRecordedAt),
    recordedAt,
  };
}

export function parseAdministratorPaymentHistory(
  value: unknown,
): AdministratorPaymentHistory {
  const result = record(value);
  onlyKeys(result, [
    "bookingRequestReference",
    "simulated",
    "current",
    "historyCoverage",
    "events",
  ]);
  const bookingRequestReference = requiredString(
    result.bookingRequestReference,
  );
  const current = record(result.current);
  onlyKeys(current, [
    "requestStatus",
    "paymentStatus",
    "expiryStatus",
    "reasonCode",
    "paymentRequiredDeadline",
  ]);
  if (
    !reference.test(bookingRequestReference) ||
    result.simulated !== true ||
    !["complete", "retained-evidence-only"].includes(
      String(result.historyCoverage),
    ) ||
    !Array.isArray(result.events)
  )
    throw new Error("Administrator payment history data is invalid");
  const events = result.events.map(parseEvent);
  if (new Set(events.map((event) => event.id)).size !== events.length)
    throw new Error("Administrator payment history data is invalid");
  return {
    bookingRequestReference,
    simulated: true,
    current: {
      requestStatus: code(current.requestStatus, [
        "pending",
        "processing",
        "accepted",
        "declined",
        "withdrawn",
        "expired",
      ]),
      paymentStatus:
        current.paymentStatus === null
          ? null
          : code(current.paymentStatus, [
              "capture-processing",
              "payment-required",
              "paid-confirmed",
              "cancelled",
            ]),
      expiryStatus:
        current.expiryStatus === null
          ? null
          : code(current.expiryStatus, [
              "processing",
              "attention_required",
              "quarantined",
              "complete",
            ]),
      reasonCode:
        current.reasonCode === null ? null : code(current.reasonCode, reasons),
      paymentRequiredDeadline:
        current.paymentRequiredDeadline === null
          ? null
          : optionalTimestamp(requiredString(current.paymentRequiredDeadline))!,
    },
    historyCoverage: result.historyCoverage as PaymentHistoryCoverage,
    events,
  };
}
