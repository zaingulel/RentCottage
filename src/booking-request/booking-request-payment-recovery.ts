import { paymentInstant } from "./booking-request-payment-observation";
import type {
  BookingRequestPaymentFacts,
  RecoveryState,
} from "./booking-request-payment-observation";
import type {
  BookingRequestConfirmation,
  BookingRequestRecoveryConfirmationEvidence,
} from "./booking-request-confirmation";
import {
  paymentRecoveryOperationKinds,
  type PaymentRecoveryStep,
} from "@/payment/booking-request-payment-recovery-contract";
import { recordedPaymentResult } from "@/payment/payment-operation-execution";
import type { PaymentOperationExecution } from "@/payment/payment-operation-execution";
import type { ProviderOperationBinding } from "@/payment/payment-contract";
import type { BookingRequestPaymentRecoveryPermit } from "@/payment/booking-request-payment-recovery-contract";

export type PaymentRecoveryStatus =
  | "processing"
  | "retryable"
  | "succeeded"
  | "late-succeeded"
  | "deadline-elapsed"
  | "blocked"
  | "quarantined"
  | "unavailable";
export type PaymentRecoveryAdmission =
  | { readonly status: "quarantined" }
  | {
      readonly status:
        | "processing"
        | "retryable"
        | "succeeded"
        | "late-succeeded";
      readonly attemptId: string;
      readonly deadline: string;
    };
export type PaymentRecoveryLease =
  | { readonly status: Exclude<PaymentRecoveryStatus, "processing"> | "stale" }
  | {
      readonly status: "leased";
      readonly permit: BookingRequestPaymentRecoveryPermit;
      readonly binding: ProviderOperationBinding;
    }
  | {
      readonly status: "reconcile";
      readonly permit: BookingRequestPaymentRecoveryPermit;
      readonly binding: ProviderOperationBinding;
      readonly providerRequestId: string | null;
      readonly providerReference: string | null;
    };
export interface BookingRequestPaymentRecoveryRepository {
  admit(input: {
    readonly bookingRequestId: string;
    readonly commandKey: string;
  }): Promise<PaymentRecoveryAdmission>;
  facts(attemptId: string): Promise<BookingRequestPaymentFacts>;
  lease(
    attemptId: string,
    step: PaymentRecoveryStep,
    expectedState: RecoveryState,
  ): Promise<PaymentRecoveryLease>;
  confirmationEvidence(
    attemptId: string,
  ): Promise<BookingRequestRecoveryConfirmationEvidence>;
  due(limit: number): Promise<readonly string[]>;
}
export function createBookingRequestPaymentRecovery({
  repository,
  operations,
  confirmation,
}: {
  confirmation: BookingRequestConfirmation;
  repository: BookingRequestPaymentRecoveryRepository;
  operations: PaymentOperationExecution;
}) {
  async function resume(
    attemptId: string,
  ): Promise<{ readonly status: PaymentRecoveryStatus }> {
    for (let step = 0; step < 8; step += 1) {
      const facts = await repository.facts(attemptId);
      const selected = selectPaymentRecovery(facts, attemptId);
      const leased =
        selected.status === "execute"
          ? await repository.lease(
              attemptId,
              selected.step,
              selected.expectedState,
            )
          : selected;
      if (leased.status === "stale") continue;
      if (leased.status !== "leased" && leased.status !== "reconcile") {
        if (leased.status === "succeeded" && !facts.confirmationValid) {
          const evidence = await repository.confirmationEvidence(attemptId);
          await confirmation.execute(evidence.bookingRequestId, evidence);
        }
        return { status: leased.status };
      }
      const execution =
        leased.status === "reconcile"
          ? await operations.query({
              ...leased.binding,
              recoveryPermit: leased.permit,
              providerRequestId: leased.providerRequestId,
              providerReference: leased.providerReference,
            })
          : await operations.execute({
              ...leased.binding,
              executionPermit: leased.permit,
            });
      if (execution.status === "not-admitted") return { status: "blocked" };
      const outcome = recordedPaymentResult(execution);
      if (
        outcome.outcome === "not-executed" ||
        outcome.outcome === "indeterminate"
      )
        return { status: "blocked" };
    }
    return { status: "unavailable" };
  }
  return {
    async execute(input: {
      readonly bookingRequestId: string;
      readonly commandKey: string;
    }) {
      const admitted = await repository.admit(input);
      if (
        admitted.status === "quarantined" ||
        admitted.status === "retryable" ||
        admitted.status === "late-succeeded"
      )
        return { status: admitted.status };
      return resume(admitted.attemptId);
    },
    resume,
    async processDue(limit: number) {
      const results: { readonly status: PaymentRecoveryStatus }[] = [];
      for (const attemptId of await repository.due(limit)) {
        try {
          results.push(await resume(attemptId));
        } catch {
          results.push({ status: "unavailable" });
        }
      }
      return results;
    },
  };
}

export function selectPaymentRecovery(
  facts: BookingRequestPaymentFacts,
  attemptId: string,
):
  | PaymentRecoveryLease
  | {
      readonly status: "execute";
      readonly step: PaymentRecoveryStep;
      readonly expectedState: RecoveryState;
    } {
  if (facts.quarantined) return { status: "quarantined" };
  if (facts.expired) return { status: "deadline-elapsed" };
  const attempt = facts.attempts.find((entry) => entry.id === attemptId);
  if (!attempt || !facts.sourceValid) return { status: "unavailable" };
  const pending =
    facts.operations.find(
      (operation) =>
        operation.recoveryAttemptId === attemptId && operation.outcome === null,
    ) ??
    facts.operations.find(
      (operation) =>
        operation.recoveryAttemptId === attemptId &&
        operation.outcome === "indeterminate",
    );
  if (pending) {
    if (pending.permit?.purpose !== "booking-request-payment-recovery")
      throw new Error("Recovery inquiry has no durable permit");
    const permit = pending.permit;
    return {
      status: "reconcile",
      permit,
      binding: {
        kind: paymentRecoveryOperationKinds[permit.step],
        paymentLifecycleId: permit.binding.paymentLifecycleId,
        logicalOperationId: permit.operationId,
        attemptId: permit.idempotencyKey,
        amountFils: permit.binding.amountFils,
        currency: "IQD",
      },
      providerRequestId: pending.providerRequestId,
      providerReference: pending.providerReference,
    };
  }
  let step: PaymentRecoveryStep;
  switch (attempt.state) {
    case "safely_failed":
      return { status: "retryable" };
    case "succeeded":
      return { status: "succeeded" };
    case "late_succeeded":
      return { status: "late-succeeded" };
    case "blocked":
      return { status: "blocked" };
    case "admitted":
      step = "original-release";
      break;
    case "original_released":
      step = "replacement-authorization";
      break;
    case "replacement_authorized":
      step = "replacement-capture";
      break;
    case "capture_failed":
      step = "replacement-release";
      break;
  }
  if (
    step !== "replacement-release" &&
    paymentInstant(facts.observedAt) >= paymentInstant(facts.deadline)
  )
    return { status: "deadline-elapsed" };
  const lifecycle =
    step === "original-release" ? facts.originalLifecycleId : attemptId;
  if (
    facts.expiryOperations.some(
      (operation) =>
        operation.owner === "expiry" &&
        operation.authorizationLifecycleId === lifecycle,
    )
  )
    return { status: "deadline-elapsed" };
  if (
    facts.operations.some(
      (operation) =>
        operation.recoveryAttemptId === attemptId &&
        operation.recoveryStep === step &&
        operation.outcome === "not-executed",
    )
  )
    return { status: "blocked" };
  return { status: "execute", step, expectedState: attempt.state };
}
