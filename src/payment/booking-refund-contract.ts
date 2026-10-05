import type {
  PaymentProviderIdentity,
  ProviderOperationBinding,
} from "./payment-contract";
import {
  paymentBindingMatches,
  paymentIdentityMatches,
} from "./payment-operation-execution";
import {
  intentExecutionPermitFrom,
  type IntentPermitKind,
} from "./payment-permit";

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
const refundPermitKind: IntentPermitKind<BookingRefundExecutionPermit> = {
  purpose: "booking-refund",
  operationKind: "refund",
  intentIdOf: (binding) => binding.refundIntentId,
  invalidMessage: "Refund permit is invalid",
};
export function bookingRefundPermitFrom(
  value: unknown,
): BookingRefundExecutionPermit {
  return intentExecutionPermitFrom(value, refundPermitKind);
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
