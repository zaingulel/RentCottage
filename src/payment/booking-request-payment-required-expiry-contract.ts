import type {
  Fils,
  PaymentProviderIdentity,
  ProviderOperationBinding,
} from "./payment-contract";
import {
  isPermitIdentifier,
  isPositiveInteger,
  isRequestFingerprint,
} from "./payment-permit";

export interface BookingRequestPaymentRequiredExpiryBinding {
  readonly bookingRequestId: string;
  readonly authorizationClaimId: string;
  readonly authorizationClaimGeneration: number;
  readonly authorizationPaymentLifecycleId: string;
  readonly authorizationLogicalOperationId: string;
  readonly authorizationPhysicalAttemptId: string;
  readonly predecessorMovementReference: string;
  readonly predecessorOutcomeAt: string;
  readonly releaseLogicalOperationId: string;
  readonly releasePhysicalAttemptId: string;
  readonly amountFils: Fils;
  readonly currency: "IQD";
  readonly requestFingerprint: string;
  readonly providerIdentity: PaymentProviderIdentity;
}

interface BookingRequestPaymentRequiredReleasePermit {
  readonly purpose: "booking-request-payment-required-expiry";
  readonly expiryWorkId: string;
  readonly expiryOperationId: string;
  readonly idempotencyKey: string;
  readonly notBefore: string;
  readonly binding: BookingRequestPaymentRequiredExpiryBinding;
}

export interface BookingRequestPaymentRequiredCorrectiveRefundPermit {
  readonly purpose: "booking-request-payment-required-corrective-refund";
  readonly expiryWorkId: string;
  readonly expiryOperationId: string;
  readonly idempotencyKey: string;
  readonly notBefore: string;
  readonly binding: {
    readonly bookingRequestId: string;
    readonly captureProviderOperationId: string;
    readonly paymentLifecycleId: string;
    readonly captureLogicalOperationId: string;
    readonly capturePhysicalAttemptId: string;
    readonly captureMovementReference: string;
    readonly captureOccurredAt: string;
    readonly refundLogicalOperationId: string;
    readonly refundPhysicalAttemptId: string;
    readonly amountFils: Fils;
    readonly currency: "IQD";
    readonly providerIdentity: PaymentProviderIdentity;
  };
}

export type BookingRequestPaymentRequiredExpiryPermit =
  | BookingRequestPaymentRequiredReleasePermit
  | BookingRequestPaymentRequiredCorrectiveRefundPermit;

function correctiveRefundPermitFrom(
  value: unknown,
): BookingRequestPaymentRequiredCorrectiveRefundPermit {
  const permit = record(value);
  const binding = record(permit?.binding);
  const provider = record(binding?.providerIdentity);
  if (
    !permit ||
    !exactKeys(permit, [
      "purpose",
      "expiryWorkId",
      "expiryOperationId",
      "idempotencyKey",
      "notBefore",
      "binding",
    ]) ||
    permit.purpose !== "booking-request-payment-required-corrective-refund" ||
    ![permit.expiryWorkId, permit.expiryOperationId].every(
      isPermitIdentifier,
    ) ||
    typeof permit.notBefore !== "string" ||
    Number.isNaN(Date.parse(permit.notBefore)) ||
    !binding ||
    !exactKeys(binding, [
      "bookingRequestId",
      "captureProviderOperationId",
      "paymentLifecycleId",
      "captureLogicalOperationId",
      "capturePhysicalAttemptId",
      "captureMovementReference",
      "captureOccurredAt",
      "refundLogicalOperationId",
      "refundPhysicalAttemptId",
      "amountFils",
      "currency",
      "providerIdentity",
    ]) ||
    ![
      binding.bookingRequestId,
      binding.captureProviderOperationId,
      binding.paymentLifecycleId,
    ].every(isPermitIdentifier) ||
    ![
      binding.captureLogicalOperationId,
      binding.capturePhysicalAttemptId,
      binding.captureMovementReference,
      binding.refundLogicalOperationId,
      binding.refundPhysicalAttemptId,
    ].every(nonempty) ||
    typeof binding.captureOccurredAt !== "string" ||
    !(Date.parse(binding.captureOccurredAt) >= Date.parse(permit.notBefore)) ||
    permit.idempotencyKey !== binding.refundPhysicalAttemptId ||
    !isPositiveInteger(binding.amountFils) ||
    binding.currency !== "IQD" ||
    !provider ||
    !exactKeys(provider, [
      "provider",
      "environment",
      "merchantId",
      "terminalId",
    ]) ||
    !Object.values(provider).every(nonempty)
  )
    throw new Error("Payment Required corrective refund permit is invalid");
  return permit as unknown as BookingRequestPaymentRequiredCorrectiveRefundPermit;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export function paymentRequiredExpiryPermitFrom(
  value: unknown,
): BookingRequestPaymentRequiredExpiryPermit {
  if (
    record(value)?.purpose ===
    "booking-request-payment-required-corrective-refund"
  )
    return correctiveRefundPermitFrom(value);
  const permit = record(value);
  const binding = record(permit?.binding);
  const provider = record(binding?.providerIdentity);
  if (
    !permit ||
    !exactKeys(permit, [
      "purpose",
      "expiryWorkId",
      "expiryOperationId",
      "idempotencyKey",
      "notBefore",
      "binding",
    ]) ||
    permit.purpose !== "booking-request-payment-required-expiry" ||
    ![permit.expiryWorkId, permit.expiryOperationId].every(
      isPermitIdentifier,
    ) ||
    typeof permit.notBefore !== "string" ||
    Number.isNaN(Date.parse(permit.notBefore)) ||
    !binding ||
    !exactKeys(binding, [
      "bookingRequestId",
      "authorizationClaimId",
      "authorizationClaimGeneration",
      "authorizationPaymentLifecycleId",
      "authorizationLogicalOperationId",
      "authorizationPhysicalAttemptId",
      "predecessorMovementReference",
      "predecessorOutcomeAt",
      "releaseLogicalOperationId",
      "releasePhysicalAttemptId",
      "amountFils",
      "currency",
      "requestFingerprint",
      "providerIdentity",
    ]) ||
    ![
      binding.bookingRequestId,
      binding.authorizationClaimId,
      binding.authorizationPaymentLifecycleId,
    ].every(isPermitIdentifier) ||
    !isPositiveInteger(binding.authorizationClaimGeneration) ||
    ![
      binding.authorizationLogicalOperationId,
      binding.authorizationPhysicalAttemptId,
      binding.predecessorMovementReference,
      binding.releaseLogicalOperationId,
      binding.releasePhysicalAttemptId,
    ].every(nonempty) ||
    typeof binding.predecessorOutcomeAt !== "string" ||
    Number.isNaN(Date.parse(binding.predecessorOutcomeAt)) ||
    permit.idempotencyKey !== binding.releasePhysicalAttemptId ||
    !isPositiveInteger(binding.amountFils) ||
    binding.currency !== "IQD" ||
    !isRequestFingerprint(binding.requestFingerprint) ||
    !provider ||
    !exactKeys(provider, [
      "provider",
      "environment",
      "merchantId",
      "terminalId",
    ]) ||
    !Object.values(provider).every(nonempty)
  )
    throw new Error("Payment Required expiry permit is invalid");
  return permit as unknown as BookingRequestPaymentRequiredExpiryPermit;
}

export function paymentRequiredExpiryRequestMatches(
  request: ProviderOperationBinding,
  value: unknown,
  identity: PaymentProviderIdentity,
): boolean {
  let permit: BookingRequestPaymentRequiredExpiryPermit;
  try {
    permit = paymentRequiredExpiryPermitFrom(value);
  } catch {
    return false;
  }
  if (permit.purpose === "booking-request-payment-required-corrective-refund") {
    const binding = permit.binding;
    return (
      request.kind === "refund" &&
      request.paymentLifecycleId === binding.paymentLifecycleId &&
      request.logicalOperationId === binding.refundLogicalOperationId &&
      request.attemptId === binding.refundPhysicalAttemptId &&
      request.amountFils === binding.amountFils &&
      request.currency === binding.currency &&
      Object.entries(identity).every(
        ([key, expected]) =>
          expected ===
          binding.providerIdentity[key as keyof PaymentProviderIdentity],
      )
    );
  }
  const binding = permit.binding;
  return (
    request.kind === "release" &&
    request.paymentLifecycleId === binding.authorizationPaymentLifecycleId &&
    request.logicalOperationId === binding.releaseLogicalOperationId &&
    request.attemptId === binding.releasePhysicalAttemptId &&
    request.amountFils === binding.amountFils &&
    request.currency === binding.currency &&
    Object.entries(identity).every(
      ([key, expected]) =>
        expected ===
        binding.providerIdentity[key as keyof PaymentProviderIdentity],
    )
  );
}
