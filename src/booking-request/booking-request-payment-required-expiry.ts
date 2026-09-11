import { paymentInstant } from "./booking-request-payment-observation";
import type {
  BookingRequestPaymentFacts,
  PaymentOperationFact,
} from "./booking-request-payment-observation";
import { paymentRecoveryOperationKinds } from "@/payment/booking-request-payment-recovery-contract";
import { recordedPaymentResult } from "@/payment/payment-operation-execution";
import type { PaymentOperationExecution } from "@/payment/payment-operation-execution";
import type { BookingRequestPaymentRecoveryPermit } from "@/payment/booking-request-payment-recovery-contract";
import type { BookingRequestPaymentRequiredExpiryPermit } from "@/payment/booking-request-payment-required-expiry-contract";
import type {
  PaymentProviderAdapter,
  PaymentProviderIdentity,
  ProviderOperationBinding,
} from "@/payment/payment-contract";

export type PaymentRequiredExpiryResult = {
  readonly status:
    | "processing"
    | "attention-required"
    | "quarantined"
    | "expired"
    | "confirmed"
    | "not-due"
    | "unavailable"
    | "invalid";
};
export type PaymentRequiredExpiryPreparation =
  | PaymentRequiredExpiryResult
  | { readonly status: "ready" }
  | {
      readonly status: "release";
      readonly permit: BookingRequestPaymentRequiredExpiryPermit;
      readonly binding: ProviderOperationBinding;
    }
  | {
      readonly status: "refund";
      readonly permit: BookingRequestPaymentRequiredExpiryPermit;
      readonly binding: ProviderOperationBinding;
    }
  | {
      readonly status: "reconcile-expiry";
      readonly permit: BookingRequestPaymentRequiredExpiryPermit;
      readonly binding: ProviderOperationBinding;
      readonly providerRequestId: string | null;
      readonly providerReference: string | null;
    }
  | {
      readonly status: "reconcile-recovery";
      readonly permit: BookingRequestPaymentRecoveryPermit;
      readonly binding: ProviderOperationBinding;
      readonly providerRequestId: string | null;
      readonly providerReference: string | null;
    };

export type PaymentRequiredExpiryCommand = { readonly revision: string } & (
  | { readonly action: "quarantine"; readonly reason: string }
  | { readonly action: "refund"; readonly captureId: string }
  | {
      readonly action: "release";
      readonly authorizationLifecycleId: string;
      readonly recoveryOperationId: string | null;
    }
);
export interface BookingRequestPaymentRequiredExpiryRepository {
  due(
    limit: number,
    providerIdentity: PaymentProviderIdentity,
  ): Promise<readonly string[]>;
  facts(bookingRequestId: string): Promise<BookingRequestPaymentFacts>;
  prepare(
    bookingRequestId: string,
    providerIdentity: PaymentProviderIdentity,
    command: PaymentRequiredExpiryCommand,
  ): Promise<
    | { readonly status: "prepared" }
    | { readonly status: "stale" }
    | PaymentRequiredExpiryResult
  >;
  finalize(bookingRequestId: string): Promise<PaymentRequiredExpiryResult>;
}

function expiryBinding(
  permit: BookingRequestPaymentRequiredExpiryPermit,
): ProviderOperationBinding {
  return permit.purpose === "booking-request-payment-required-corrective-refund"
    ? {
        kind: "refund",
        paymentLifecycleId: permit.binding.paymentLifecycleId,
        logicalOperationId: permit.binding.refundLogicalOperationId,
        attemptId: permit.binding.refundPhysicalAttemptId,
        amountFils: permit.binding.amountFils,
        currency: "IQD",
      }
    : {
        kind: "release",
        paymentLifecycleId: permit.binding.authorizationPaymentLifecycleId,
        logicalOperationId: permit.binding.releaseLogicalOperationId,
        attemptId: permit.binding.releasePhysicalAttemptId,
        amountFils: permit.binding.amountFils,
        currency: "IQD",
      };
}
type ExpirySelection =
  | PaymentRequiredExpiryPreparation
  | {
      readonly status: "prepare";
      readonly command: PaymentRequiredExpiryCommand;
    }
  | { readonly status: "confirm"; readonly attemptId: string };
export function selectPaymentRequiredExpiry(
  facts: BookingRequestPaymentFacts,
): ExpirySelection {
  const quarantine = (reason: string): ExpirySelection => ({
    status: "prepare",
    command: { revision: facts.revision, action: "quarantine", reason },
  });
  const refund = (captureId: string): ExpirySelection => ({
    status: "prepare",
    command: { revision: facts.revision, action: "refund", captureId },
  });
  if (facts.quarantined) return { status: "quarantined" };
  if (facts.expired) return { status: "expired" };
  const deadline = facts.deadline;
  if (deadline === null)
    return { status: facts.confirmationValid ? "confirmed" : "unavailable" };
  if (!facts.sourceValid)
    return paymentInstant(facts.observedAt) < paymentInstant(deadline)
      ? { status: "not-due" }
      : quarantine("source-evidence-invalid");
  const unresolved = facts.operations.find(
    (entry) => entry.outcome === null && entry.permit,
  );
  if (unresolved?.permit) {
    const permit = unresolved.permit;
    return permit.purpose === "booking-request-payment-recovery"
      ? {
          status: "reconcile-recovery",
          permit,
          binding: {
            kind: paymentRecoveryOperationKinds[permit.step],
            paymentLifecycleId: permit.binding.paymentLifecycleId,
            logicalOperationId: permit.operationId,
            attemptId: permit.idempotencyKey,
            amountFils: permit.binding.amountFils,
            currency: "IQD",
          },
          providerRequestId: unresolved.providerRequestId,
          providerReference: unresolved.providerReference,
        }
      : {
          status: "reconcile-expiry",
          permit,
          binding: expiryBinding(permit),
          providerRequestId: unresolved.providerRequestId,
          providerReference: unresolved.providerReference,
        };
  }
  const captures = facts.operations.filter(
    (entry) => entry.kind === "capture" && entry.outcome === "succeeded",
  );
  if (captures.some((entry) => !entry.occurredAt))
    return quarantine("capture-occurrence-unknown");
  if (
    facts.confirmationValid &&
    !captures.some(
      (entry) => paymentInstant(entry.occurredAt!) >= paymentInstant(deadline),
    )
  )
    return { status: "confirmed" };
  if (paymentInstant(facts.observedAt) < paymentInstant(deadline))
    return { status: "not-due" };
  const original = facts.operations.find(
    (entry) => entry.id === facts.originalCaptureId,
  );
  const eligibleLateCapture = (entry: PaymentOperationFact) =>
    entry.outcome === "succeeded" &&
    entry.originalOutcome !== "failed" &&
    entry.occurredAt !== null &&
    paymentInstant(entry.occurredAt) >= paymentInstant(deadline);
  if (
    !original ||
    (!(
      original.outcome === "failed" &&
      original.movementReference === null &&
      ["failed", "indeterminate"].includes(original.originalOutcome!)
    ) &&
      !eligibleLateCapture(original))
  )
    return quarantine("original-capture-unresolved");
  if (facts.operations.some((entry) => entry.recoveryAttemptId && !entry.valid))
    return quarantine("recovery-evidence-invalid");
  if (
    facts.operations.some(
      (entry) =>
        entry.recoveryAttemptId &&
        entry.outcome !== "not-executed" &&
        !entry.recoveryOperationId,
    )
  )
    return quarantine("unexplained-recovery-provider-operation");
  if (
    facts.operations.some(
      (entry) =>
        entry.recoveryStep &&
        ["replacement-authorization", "replacement-capture"].includes(
          entry.recoveryStep,
        ) &&
        entry.outcome === "indeterminate",
    )
  )
    return quarantine("recovery-operation-indeterminate");
  for (const capture of captures) {
    if (paymentInstant(capture.occurredAt!) < paymentInstant(deadline)) {
      const attempt = facts.attempts.find(
        (entry) => entry.id === capture.recoveryAttemptId,
      );
      return attempt?.state === "succeeded"
        ? { status: "confirm", attemptId: attempt.id }
        : { status: "processing" };
    }
    if (!eligibleLateCapture(capture))
      return quarantine("corrective-capture-invalid");
    if (
      !facts.expiryOperations.some(
        (entry) => entry.captureId === capture.id && entry.kind === "refund",
      )
    )
      return refund(capture.id);
  }
  if (
    facts.operations.some(
      (entry) =>
        entry.id !== facts.originalAuthorizationId &&
        entry.id !== facts.originalCaptureId &&
        !entry.recoveryOperationId &&
        !entry.bookingRefund &&
        entry.outcome !== "not-executed" &&
        !facts.expiryOperations.some(
          (owned) => owned.providerOperationId === entry.id,
        ),
    )
  )
    return quarantine("unexplained-provider-operation");
  const authorizations = [
    facts.originalLifecycleId,
    ...facts.attempts
      .filter((attempt) =>
        facts.operations.some(
          (entry) =>
            entry.recoveryAttemptId === attempt.id &&
            entry.recoveryStep === "replacement-authorization" &&
            entry.outcome === "succeeded",
        ),
      )
      .map((attempt) => attempt.id),
  ];
  for (const lifecycle of authorizations) {
    if (
      facts.expiryOperations.some(
        (entry) => entry.authorizationLifecycleId === lifecycle,
      )
    )
      continue;
    const release = facts.operations.find(
      (entry) =>
        entry.lifecycleId === lifecycle &&
        entry.recoveryStep ===
          (lifecycle === facts.originalLifecycleId
            ? "original-release"
            : "replacement-release") &&
        entry.outcome !== "not-executed",
    );
    if (release && release.outcome !== "succeeded")
      return quarantine(
        `${lifecycle === facts.originalLifecycleId ? "original" : "replacement"}-release-${release.outcome}`,
      );
    return {
      status: "prepare",
      command: {
        revision: facts.revision,
        action: "release",
        authorizationLifecycleId: lifecycle,
        recoveryOperationId: release?.recoveryOperationId ?? null,
      },
    };
  }
  for (const owned of facts.expiryOperations) {
    if (!owned.valid) return quarantine("expiry-evidence-invalid");
    const operation = facts.operations.find(
      (entry) => entry.id === owned.providerOperationId,
    );
    if (!operation)
      return {
        status: owned.kind,
        permit: owned.permit,
        binding: expiryBinding(owned.permit),
      };
    if (operation.outcome !== "succeeded")
      return quarantine(`expiry-${owned.kind}-${operation.outcome}`);
  }
  return { status: "ready" };
}

export function createBookingRequestPaymentRequiredExpiry({
  repository,
  operations,
  provider,
  recovery,
}: {
  repository: BookingRequestPaymentRequiredExpiryRepository;
  provider: PaymentProviderAdapter;
  operations: PaymentOperationExecution;
  recovery: { resume(attemptId: string): Promise<{ readonly status: string }> };
}) {
  async function resume(
    bookingRequestId: string,
  ): Promise<PaymentRequiredExpiryResult> {
    for (let progress = 0; progress < 16; progress += 1) {
      const selected = selectPaymentRequiredExpiry(
        await repository.facts(bookingRequestId),
      );
      if (selected.status === "prepare") {
        const committed = await repository.prepare(
          bookingRequestId,
          provider.identity,
          selected.command,
        );
        if (committed.status === "stale" || committed.status === "prepared")
          continue;
        return committed;
      }
      if (selected.status === "confirm") {
        const result = await recovery.resume(selected.attemptId);
        if (result.status === "succeeded") continue;
        return {
          status:
            result.status === "unavailable" ? "unavailable" : "processing",
        };
      }
      if (selected.status === "ready")
        return repository.finalize(bookingRequestId);
      if (
        selected.status === "release" ||
        selected.status === "refund" ||
        selected.status === "reconcile-expiry" ||
        selected.status === "reconcile-recovery"
      ) {
        const execution =
          selected.status === "release" || selected.status === "refund"
            ? await operations.execute({
                ...selected.binding,
                executionPermit: selected.permit,
              })
            : await operations.query({
                ...selected.binding,
                ...(selected.status === "reconcile-expiry"
                  ? { expiryPermit: selected.permit }
                  : { recoveryPermit: selected.permit }),
                providerRequestId: selected.providerRequestId,
                providerReference: selected.providerReference,
              });
        if (execution.status === "not-admitted") continue;
        const result = recordedPaymentResult(execution);
        if (
          result.outcome === "indeterminate" ||
          result.outcome === "not-executed"
        ) {
          const reloaded = selectPaymentRequiredExpiry(
            await repository.facts(bookingRequestId),
          );
          if (reloaded.status === "quarantined") return reloaded;
          return { status: "attention-required" };
        }
        continue;
      }
      return selected;
    }
    return { status: "processing" };
  }
  return {
    resume,
    async processDue(
      limit: number,
    ): Promise<readonly PaymentRequiredExpiryResult[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
        return [{ status: "invalid" }];
      let due: readonly string[];
      try {
        due = await repository.due(limit, provider.identity);
      } catch {
        return [{ status: "unavailable" }];
      }
      const results: PaymentRequiredExpiryResult[] = [];
      for (const bookingRequestId of due) {
        try {
          results.push(await resume(bookingRequestId));
        } catch {
          results.push({ status: "unavailable" });
        }
      }
      return results;
    },
  };
}
