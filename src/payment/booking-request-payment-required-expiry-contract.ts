import type {
  Fils,
  PaymentProviderIdentity,
  ProviderOperationBinding,
} from "./payment-contract";

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

export interface BookingRequestPaymentRequiredExpiryPermit {
  readonly purpose: "booking-request-payment-required-expiry";
  readonly expiryWorkId: string;
  readonly expiryOperationId: string;
  readonly idempotencyKey: string;
  readonly notBefore: string;
  readonly binding: BookingRequestPaymentRequiredExpiryBinding;
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const positiveInteger = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) > 0;

export function paymentRequiredExpiryPermitFrom(
  value: unknown,
): BookingRequestPaymentRequiredExpiryPermit {
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
      (item) => typeof item === "string" && uuid.test(item),
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
    ].every((item) => typeof item === "string" && uuid.test(item)) ||
    !positiveInteger(binding.authorizationClaimGeneration) ||
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
    !positiveInteger(binding.amountFils) ||
    binding.currency !== "IQD" ||
    typeof binding.requestFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(binding.requestFingerprint) ||
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
