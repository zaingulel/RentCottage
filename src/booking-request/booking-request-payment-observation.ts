import type { PaymentOperationAdmission } from "@/payment/payment-operation-execution";
import { validatedProviderResult } from "@/payment/payment-operation-execution";
import type {
  PaymentProviderIdentity,
  ProviderOperationResult,
} from "@/payment/payment-contract";
import type {
  BookingRequestPaymentRecoveryPermit,
  PaymentRecoveryStep,
} from "@/payment/booking-request-payment-recovery-contract";
import type { BookingRequestPaymentRequiredExpiryPermit } from "@/payment/booking-request-payment-required-expiry-contract";

export type RecoveryState =
  | "admitted"
  | "original_released"
  | "replacement_authorized"
  | "capture_failed"
  | "safely_failed"
  | "succeeded"
  | "late_succeeded"
  | "blocked";
export interface PaymentOperationFact {
  readonly id: string;
  readonly kind:
    | "authorization"
    | "capture"
    | "release"
    | "refund"
    | "settlement";
  readonly lifecycleId: string;
  readonly logicalOperationId: string;
  readonly physicalAttemptId: string;
  readonly outcome:
    | "succeeded"
    | "failed"
    | "indeterminate"
    | "not-executed"
    | null;
  readonly originalOutcome: PaymentOperationFact["outcome"];
  readonly occurredAt: string | null;
  readonly executedAt: string | null;
  readonly recordedAt: string | null;
  readonly provenance:
    | "admitted"
    | "fictional-provider"
    | "provider-event"
    | "legacy-simulated";
  readonly movementReference: string | null;
  readonly providerRequestId: string | null;
  readonly providerReference: string | null;
  readonly recoveryAttemptId: string | null;
  readonly recoveryOperationId: string | null;
  readonly recoveryStep: PaymentRecoveryStep | null;
  readonly valid: boolean;
  readonly permit:
    | BookingRequestPaymentRecoveryPermit
    | BookingRequestPaymentRequiredExpiryPermit
    | null;
}
export interface PaymentExpiryOperationFact {
  readonly id: string;
  readonly owner: "recovery" | "expiry";
  readonly authorizationLifecycleId: string;
  readonly kind: "release" | "refund";
  readonly captureId: string | null;
  readonly providerOperationId: string | null;
  readonly valid: boolean;
  readonly permit: BookingRequestPaymentRequiredExpiryPermit;
}
export interface BookingRequestPaymentFacts {
  readonly bookingRequestId: string;
  readonly revision: string;
  readonly observedAt: string;
  readonly deadline: string;
  readonly providerIdentity: PaymentProviderIdentity;
  readonly amountFils: number;
  readonly sourceValid: boolean;
  readonly quarantined: boolean;
  readonly expired: boolean;
  readonly confirmationValid: boolean;
  readonly originalLifecycleId: string;
  readonly originalAuthorizationId: string | null;
  readonly originalCaptureId: string | null;
  readonly attempts: readonly {
    readonly id: string;
    readonly generation: number;
    readonly state: RecoveryState;
  }[];
  readonly operations: readonly PaymentOperationFact[];
  readonly expiryOperations: readonly PaymentExpiryOperationFact[];
  readonly receipts: readonly {
    readonly operationId: string;
    readonly receiptId: string;
    readonly payload: unknown;
  }[];
}
export interface PaymentObservationCommand {
  readonly revision: string;
  readonly recoveryState: RecoveryState | null;
  readonly quarantineReason: string | null;
  readonly correctiveCaptureId: string | null;
}
export interface BookingRequestPaymentObservationRepository {
  facts(operationId: string): Promise<BookingRequestPaymentFacts>;
  record(
    operationId: string,
    result: ProviderOperationResult,
    command: PaymentObservationCommand,
  ): Promise<ProviderOperationResult | "stale">;
  correct(
    bookingRequestId: string,
    operationId: string,
    receipt: unknown,
    command: PaymentObservationCommand,
  ): Promise<{
    readonly status: "recorded" | "duplicate" | "quarantined" | "stale";
  }>;
}
export const recoveryPredecessorStates: Record<
  PaymentRecoveryStep,
  RecoveryState
> = {
  "original-release": "admitted",
  "replacement-authorization": "original_released",
  "replacement-capture": "replacement_authorized",
  "replacement-release": "capture_failed",
};

// PostgreSQL timestamps retain microseconds; Date.parse alone would move a
// capture or command across the fixed deadline within the same millisecond.
export function paymentInstant(value: string): bigint {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds))
    throw new Error("Invalid payment instant");
  const fraction =
    value.match(/\.(\d+)(?:Z|[+-]\d{2}(?::?\d{2})?)$/i)?.[1] ?? "";
  return (
    BigInt(milliseconds) * 1000n + BigInt(fraction.slice(3, 6).padEnd(3, "0"))
  );
}

export function selectPaymentObservation(
  facts: BookingRequestPaymentFacts,
  operationId: string,
  result: ProviderOperationResult,
): PaymentObservationCommand {
  const operation = facts.operations.find((entry) => entry.id === operationId);
  if (!operation) throw new Error("Payment observation operation is missing");
  const outcome =
    result.outcome === "indeterminate" &&
    operation.outcome &&
    operation.outcome !== "indeterminate"
      ? operation.outcome
      : result.outcome;
  const occurredAt =
    outcome !== result.outcome
      ? operation.occurredAt
      : result.evidence?.occurredAt;
  const attempt = facts.attempts.find(
    (entry) => entry.id === operation.recoveryAttemptId,
  );
  let recoveryState: RecoveryState | null = null;
  let quarantineReason: string | null = null;
  let correctiveCaptureId: string | null = null;
  if (
    outcome !== "not-executed" &&
    operation.recoveryStep &&
    attempt &&
    !facts.quarantined &&
    (attempt.state === "blocked" ||
      attempt.state === recoveryPredecessorStates[operation.recoveryStep])
  ) {
    if (outcome === "indeterminate") recoveryState = "blocked";
    else
      switch (operation.recoveryStep) {
        case "original-release":
          recoveryState =
            outcome === "succeeded" ? "original_released" : "blocked";
          break;
        case "replacement-authorization":
          recoveryState =
            outcome === "succeeded"
              ? "replacement_authorized"
              : "safely_failed";
          break;
        case "replacement-capture":
          recoveryState =
            outcome === "failed"
              ? "capture_failed"
              : occurredAt &&
                  paymentInstant(occurredAt) < paymentInstant(facts.deadline)
                ? "succeeded"
                : "late_succeeded";
          break;
        case "replacement-release":
          recoveryState = outcome === "succeeded" ? "safely_failed" : "blocked";
          break;
      }
  }
  if (
    operation.recoveryStep &&
    (outcome === "indeterminate" ||
      ((operation.recoveryStep === "original-release" ||
        operation.recoveryStep === "replacement-release") &&
        outcome === "failed"))
  )
    quarantineReason = `unsafe-recovery-${operation.recoveryStep}-${outcome}`;
  if (
    operation.permit?.purpose !== "booking-request-payment-recovery" &&
    operation.permit &&
    outcome !== "succeeded"
  )
    quarantineReason = `expiry-${operation.kind}-${outcome}`;
  if (operation.kind === "capture" && outcome === "succeeded") {
    if (!occurredAt) quarantineReason = "capture-occurrence-unknown";
    else if (paymentInstant(occurredAt) >= paymentInstant(facts.deadline)) {
      if (
        operation.originalOutcome === "failed" ||
        result.evidence?.originalOutcome === "failed"
      )
        quarantineReason = "conflicting-provider-observation";
      else if (
        facts.expiryOperations.some(
          (entry) =>
            entry.authorizationLifecycleId === operation.lifecycleId &&
            entry.kind === "release",
        )
      )
        quarantineReason = "conflicting-provider-observation";
      else if (!facts.quarantined) correctiveCaptureId = operation.id;
    }
  }
  return {
    revision: facts.revision,
    recoveryState,
    quarantineReason,
    correctiveCaptureId,
  };
}

export function createBookingRequestPaymentObservation({
  repository,
}: {
  repository: BookingRequestPaymentObservationRepository;
}) {
  return {
    async record(
      admission: PaymentOperationAdmission,
      result: ProviderOperationResult,
    ) {
      for (let retry = 0; retry < 4; retry += 1) {
        const facts = await repository.facts(admission.operationId);
        const accepted = await repository.record(
          admission.operationId,
          result,
          selectPaymentObservation(facts, admission.operationId, result),
        );
        if (accepted !== "stale") return accepted;
      }
      throw new Error("Payment observation did not converge");
    },
    async correct(
      bookingRequestId: string,
      operationId: string,
      receipt: unknown,
    ) {
      for (let retry = 0; retry < 4; retry += 1) {
        const facts = await repository.facts(operationId);
        if (facts.bookingRequestId !== bookingRequestId)
          throw new Error(
            "Payment correction belongs to another Booking Request",
          );
        const operation = facts.operations.find(
          (entry) => entry.id === operationId,
        );
        if (!operation)
          throw new Error("Payment correction operation is missing");
        let command: PaymentObservationCommand = {
          revision: facts.revision,
          recoveryState: null,
          quarantineReason: "malformed-provider-observation",
          correctiveCaptureId: null,
        };
        if (receipt && typeof receipt === "object" && !Array.isArray(receipt)) {
          const value = receipt as Record<string, unknown>;
          const keys = [
            "receiptId",
            "bookingRequestId",
            "providerOperationId",
            "providerIdentity",
            "paymentLifecycleId",
            "logicalOperationId",
            "physicalAttemptId",
            "kind",
            "amountFils",
            "currency",
            "providerRequestId",
            "providerReference",
            "movementReference",
            "outcome",
            "occurredAt",
          ];
          if (
            keys.every((key) => key in value) &&
            Object.keys(value).every(
              (key) => keys.includes(key) || key === "evidence",
            ) &&
            typeof value.receiptId === "string" &&
            value.receiptId.length > 0 &&
            value.receiptId.length <= 200
          ) {
            command = {
              ...command,
              quarantineReason: "conflicting-provider-observation",
            };
            try {
              const occurredAt =
                typeof value.occurredAt === "string"
                  ? paymentInstant(value.occurredAt)
                  : null;
              const expected = {
                bookingRequestId,
                providerOperationId: operationId,
                providerIdentity: facts.providerIdentity,
                paymentLifecycleId: operation.lifecycleId,
                logicalOperationId: operation.logicalOperationId,
                physicalAttemptId: operation.physicalAttemptId,
                kind: operation.kind,
                amountFils: facts.amountFils,
                currency: "IQD",
                providerRequestId:
                  operation.providerRequestId ?? value.providerRequestId,
                providerReference:
                  operation.providerReference ?? value.providerReference,
              };
              if (
                !Object.entries(expected).every(([key, entry]) =>
                  jsonEqual(entry, value[key]),
                ) ||
                (operation.outcome !== null &&
                  operation.outcome !== "indeterminate" &&
                  value.outcome !== operation.outcome) ||
                (operation.outcome !== null &&
                  value.outcome !== "failed" &&
                  value.movementReference !== operation.movementReference) ||
                (value.outcome === "failed" &&
                  value.movementReference !== null) ||
                (operation.outcome === null && !value.evidence) ||
                (value.outcome === "indeterminate") !== (occurredAt === null) ||
                (occurredAt !== null &&
                  (occurredAt > paymentInstant(facts.observedAt) ||
                    (operation.provenance !== "legacy-simulated" &&
                      operation.executedAt !== null &&
                      occurredAt < paymentInstant(operation.executedAt)) ||
                    (operation.occurredAt !== null &&
                      occurredAt !== paymentInstant(operation.occurredAt)))) ||
                facts.receipts.some(
                  (entry) =>
                    entry.operationId === operationId &&
                    !jsonEqual(entry.payload, receipt) &&
                    (entry.receiptId === value.receiptId ||
                      !jsonEqual(
                        withoutReceiptId(entry.payload),
                        withoutReceiptId(receipt),
                      )),
                )
              )
                throw new Error("Conflicting receipt");
              const result = validatedProviderResult(
                {
                  outcome: value.outcome,
                  providerRequestId: value.providerRequestId,
                  providerReference: value.providerReference,
                  ...(value.outcome === "failed"
                    ? { retrySafe: false }
                    : { movementReference: value.movementReference }),
                  evidence: value.evidence ?? {
                    operationId,
                    eventId: value.receiptId,
                    provenance: operation.provenance,
                    originalOutcome: operation.originalOutcome,
                    executedAt: operation.executedAt,
                    occurredAt: value.occurredAt,
                    closedAt: null,
                  },
                },
                operationId,
              );
              if (
                result.evidence?.occurredAt !== null &&
                paymentInstant(result.evidence!.occurredAt!) !== occurredAt
              )
                throw new Error("Conflicting occurrence");
              command = selectPaymentObservation(facts, operationId, result);
              if (result.outcome === "indeterminate")
                command = {
                  ...command,
                  quarantineReason: "unresolved-provider-observation",
                };
              if (
                (operation.kind === "release" || operation.kind === "refund") &&
                result.outcome === "failed"
              )
                command = {
                  ...command,
                  quarantineReason: `failed-${operation.kind}-observation`,
                };
            } catch {
              command = {
                ...command,
                recoveryState: null,
                correctiveCaptureId: null,
                quarantineReason: "conflicting-provider-observation",
              };
            }
          }
        }
        const accepted = await repository.correct(
          bookingRequestId,
          operationId,
          receipt,
          command,
        );
        if (accepted.status !== "stale") return accepted;
      }
      throw new Error("Payment correction did not converge");
    },
  };
}

function withoutReceiptId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "receiptId"),
  );
}
function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  const a = Object.entries(left),
    b = Object.entries(right);
  return (
    a.length === b.length &&
    a.every(([key, value]) =>
      b.some(([other, entry]) => key === other && jsonEqual(value, entry)),
    )
  );
}
