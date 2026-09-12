import type {
  PaymentProviderIdentity,
  ProviderOperationBinding,
} from "./payment-contract";
import {
  paymentBindingMatches,
  paymentIdentityMatches,
} from "./payment-operation-execution";

export interface BookingRefundExecutionPermit {
  readonly purpose: "booking-refund";
  readonly attemptId: string;
  readonly generation: number;
  readonly leaseToken: string;
  readonly idempotencyKey: string;
  readonly notBefore: string;
  readonly notAfter: string;
  readonly binding: ProviderOperationBinding & {
    readonly kind: "refund";
    readonly bookingRequestId: string;
    readonly refundIntentId: string;
    readonly captureOperationId: string;
    readonly requestFingerprint: string;
    readonly providerIdentity: PaymentProviderIdentity;
  };
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function bookingRefundPermitFrom(
  value: unknown,
): BookingRefundExecutionPermit {
  if (!value || typeof value !== "object")
    throw new Error("Refund permit is invalid");
  const permit = value as BookingRefundExecutionPermit;
  const binding = permit.binding;
  if (
    permit.purpose !== "booking-refund" ||
    !binding ||
    binding.kind !== "refund" ||
    ![
      permit.attemptId,
      permit.leaseToken,
      binding.bookingRequestId,
      binding.refundIntentId,
      binding.captureOperationId,
      binding.paymentLifecycleId,
    ].every((id) => typeof id === "string" && uuid.test(id)) ||
    !Number.isSafeInteger(permit.generation) ||
    permit.generation < 1 ||
    !Number.isFinite(Date.parse(permit.notBefore)) ||
    !(Date.parse(permit.notAfter) > Date.parse(permit.notBefore)) ||
    binding.logicalOperationId !== `${binding.refundIntentId}:refund` ||
    binding.attemptId !==
      `${binding.refundIntentId}:refund:${permit.generation}` ||
    permit.idempotencyKey !== binding.attemptId ||
    !Number.isSafeInteger(binding.amountFils) ||
    binding.amountFils <= 0 ||
    binding.currency !== "IQD" ||
    !/^[a-f0-9]{64}$/.test(binding.requestFingerprint) ||
    !binding.providerIdentity ||
    ![
      binding.providerIdentity.provider,
      binding.providerIdentity.environment,
      binding.providerIdentity.merchantId,
      binding.providerIdentity.terminalId,
    ].every((part) => typeof part === "string" && part.length > 0)
  )
    throw new Error("Refund permit is invalid");
  return permit;
}
export function bookingRefundRequestMatches(
  request: ProviderOperationBinding,
  value: unknown,
  identity: PaymentProviderIdentity,
): boolean {
  try {
    const permit = bookingRefundPermitFrom(value);
    return (
      paymentBindingMatches(request, permit.binding) &&
      paymentIdentityMatches(identity, permit.binding.providerIdentity)
    );
  } catch {
    return false;
  }
}
