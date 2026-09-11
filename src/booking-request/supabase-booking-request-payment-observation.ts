import type { SupabaseClient } from "@supabase/supabase-js";
import {
  recoveryPermitFrom,
  paymentRecoverySteps,
} from "@/payment/booking-request-payment-recovery-contract";
import { paymentRequiredExpiryPermitFrom } from "@/payment/booking-request-payment-required-expiry-contract";
import {
  paymentIdentityMatches,
  validatedProviderResult,
} from "@/payment/payment-operation-execution";
import type {
  PaymentProviderIdentity,
  ProviderOperationResult,
} from "@/payment/payment-contract";
import type {
  BookingRequestPaymentFacts,
  BookingRequestPaymentObservationRepository,
  PaymentObservationCommand,
} from "./booking-request-payment-observation";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Payment facts are invalid");
  return value as Record<string, unknown>;
};
const text = (value: unknown) => typeof value === "string" && value.length > 0;
const id = (value: unknown) => typeof value === "string" && uuid.test(value);
const time = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const nullable = (value: unknown, validate: (input: unknown) => boolean) =>
  value === null || validate(value);
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Payment facts are invalid");
  return value;
};
const requireValid = (condition: boolean) => {
  if (!condition) throw new Error("Payment facts are invalid");
};
const outcome = (value: unknown) =>
  ["succeeded", "failed", "indeterminate", "not-executed", null].includes(
    value as string | null,
  );
const states = [
  "admitted",
  "original_released",
  "replacement_authorized",
  "capture_failed",
  "safely_failed",
  "succeeded",
  "late_succeeded",
  "blocked",
];
export function bookingRequestPaymentFactsFrom(
  value: unknown,
): BookingRequestPaymentFacts {
  const facts = object(value);
  requireValid(
    id(facts.bookingRequestId) &&
      typeof facts.revision === "string" &&
      /^[a-f0-9]{32}$/.test(facts.revision) &&
      time(facts.observedAt) &&
      (time(facts.deadline) ||
        (facts.deadline === null && facts.confirmationValid === true)) &&
      [
        facts.sourceValid,
        facts.quarantined,
        facts.expired,
        facts.confirmationValid,
      ].every((entry) => typeof entry === "boolean") &&
      Number.isSafeInteger(facts.amountFils) &&
      (facts.amountFils as number) > 0 &&
      id(facts.originalLifecycleId) &&
      nullable(facts.originalAuthorizationId, id) &&
      nullable(facts.originalCaptureId, id),
  );
  const provider = object(facts.providerIdentity);
  requireValid(
    Object.keys(provider).length === 4 &&
      [
        provider.provider,
        provider.environment,
        provider.merchantId,
        provider.terminalId,
      ].every(text),
  );
  const attempts = array(facts.attempts).map((entry) => {
    const attempt = object(entry);
    requireValid(
      id(attempt.id) &&
        Number.isSafeInteger(attempt.generation) &&
        (attempt.generation as number) > 0 &&
        states.includes(attempt.state as string),
    );
    return attempt;
  });
  const operations = array(facts.operations).map((entry) => {
    const operation = object(entry);
    requireValid(
      id(operation.id) &&
        id(operation.lifecycleId) &&
        [
          "authorization",
          "capture",
          "release",
          "refund",
          "settlement",
        ].includes(operation.kind as string) &&
        [
          "admitted",
          "fictional-provider",
          "provider-event",
          "legacy-simulated",
        ].includes(operation.provenance as string) &&
        text(operation.logicalOperationId) &&
        text(operation.physicalAttemptId) &&
        outcome(operation.outcome) &&
        outcome(operation.originalOutcome) &&
        [
          operation.occurredAt,
          operation.executedAt,
          operation.recordedAt,
        ].every((entry) => nullable(entry, time)) &&
        [
          operation.movementReference,
          operation.providerRequestId,
          operation.providerReference,
        ].every((entry) => nullable(entry, text)) &&
        nullable(operation.recoveryAttemptId, id) &&
        nullable(operation.recoveryOperationId, id) &&
        typeof operation.valid === "boolean" &&
        (operation.recoveryStep === null ||
          paymentRecoverySteps.includes(
            operation.recoveryStep as (typeof paymentRecoverySteps)[number],
          )),
    );
    if (operation.bookingRefund != null) {
      const refund = object(operation.bookingRefund);
      requireValid(
        operation.kind === "refund" &&
          id(refund.intentId) &&
          id(refund.captureOperationId) &&
          Number.isSafeInteger(refund.amountFils) &&
          (refund.amountFils as number) > 0 &&
          (refund.amountFils as number) <= (facts.amountFils as number),
      );
    }
    const permit =
      operation.permit === null
        ? null
        : object(operation.permit).purpose ===
            "booking-request-payment-recovery"
          ? recoveryPermitFrom(operation.permit)
          : paymentRequiredExpiryPermitFrom(operation.permit);
    requireValid(
      !permit ||
        (permit.binding.bookingRequestId === facts.bookingRequestId &&
          permit.binding.amountFils === facts.amountFils &&
          paymentIdentityMatches(
            permit.binding.providerIdentity,
            provider as unknown as PaymentProviderIdentity,
          )),
    );
    if (permit?.purpose === "booking-request-payment-recovery")
      requireValid(
        permit.attemptId === operation.recoveryAttemptId &&
          permit.step === operation.recoveryStep &&
          permit.binding.paymentLifecycleId === operation.lifecycleId &&
          permit.operationId === operation.logicalOperationId &&
          permit.idempotencyKey === operation.physicalAttemptId,
      );
    return { ...operation, permit };
  });
  const expiryOperations = array(facts.expiryOperations).map((entry) => {
    const operation = object(entry);
    const permit = paymentRequiredExpiryPermitFrom(operation.permit);
    requireValid(
      id(operation.id) &&
        ["recovery", "expiry"].includes(operation.owner as string) &&
        id(operation.authorizationLifecycleId) &&
        ["release", "refund"].includes(operation.kind as string) &&
        nullable(operation.captureId, id) &&
        nullable(operation.providerOperationId, id) &&
        typeof operation.valid === "boolean" &&
        permit.binding.bookingRequestId === facts.bookingRequestId &&
        permit.expiryOperationId === operation.id,
    );
    return { ...operation, permit };
  });
  const receipts = array(facts.receipts).map((entry) => {
    const receipt = object(entry);
    requireValid(
      id(receipt.operationId) &&
        text(receipt.receiptId) &&
        "payload" in receipt,
    );
    return receipt;
  });
  for (const rows of [attempts, operations, expiryOperations])
    requireValid(
      new Set(rows.map((entry) => object(entry).id)).size === rows.length,
    );
  return {
    ...facts,
    attempts,
    operations,
    expiryOperations,
    receipts,
  } as unknown as BookingRequestPaymentFacts;
}
export class SupabaseBookingRequestPaymentObservationRepository implements BookingRequestPaymentObservationRepository {
  constructor(private readonly client: SupabaseClient) {}
  async facts(operationId: string) {
    const { data, error } = await this.client.rpc(
      "get_booking_request_payment_observation_facts",
      { target_operation_id: operationId },
    );
    if (error) throw new Error("Payment observation facts are unavailable");
    const facts = bookingRequestPaymentFactsFrom(data);
    if (!facts.operations.some((entry) => entry.id === operationId))
      throw new Error("Payment observation facts belong to another operation");
    return facts;
  }
  async record(
    operationId: string,
    result: ProviderOperationResult,
    command: PaymentObservationCommand,
  ): Promise<ProviderOperationResult | "stale"> {
    const { data, error } = await this.client.rpc(
      "record_booking_request_payment_observation",
      {
        target_operation_id: operationId,
        target_result: result,
        target_command: command,
      },
    );
    if (error) throw new Error("Payment observation recording is unavailable");
    if (data?.status === "stale") return "stale";
    return validatedProviderResult(data, operationId);
  }
  async correct(
    bookingRequestId: string,
    operationId: string,
    receipt: unknown,
    command: PaymentObservationCommand,
  ) {
    const { data, error } = await this.client.rpc(
      "observe_booking_request_payment_correction",
      {
        target_booking_request_id: bookingRequestId,
        target_provider_operation_id: operationId,
        target_receipt: receipt,
        target_command: command,
      },
    );
    if (
      error ||
      !["recorded", "duplicate", "quarantined", "stale"].includes(data?.status)
    )
      throw new Error("Payment correction is unavailable");
    return data as {
      readonly status: "recorded" | "duplicate" | "quarantined" | "stale";
    };
  }
}
