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

export interface BookingSettlementExecutionPermit {
  readonly purpose: "booking-settlement";
  readonly attemptId: string;
  readonly generation: number;
  readonly leaseToken: string;
  readonly idempotencyKey: string;
  readonly notBefore: string;
  readonly notAfter: string;
  readonly binding: ProviderOperationBinding & {
    readonly kind: "settlement";
    readonly bookingRequestId: string;
    readonly settlementIntentId: string;
    readonly captureOperationId: string;
    readonly requestFingerprint: string;
    readonly providerIdentity: PaymentProviderIdentity;
  };
}
const settlementPermitKind: IntentPermitKind<BookingSettlementExecutionPermit> =
  {
    purpose: "booking-settlement",
    operationKind: "settlement",
    intentIdOf: (binding) => binding.settlementIntentId,
    invalidMessage: "Settlement permit is invalid",
  };
export function bookingSettlementPermitFrom(
  value: unknown,
): BookingSettlementExecutionPermit {
  return intentExecutionPermitFrom(value, settlementPermitKind);
}
export function bookingSettlementRequestMatches(
  request: ProviderOperationBinding,
  value: unknown,
  identity: PaymentProviderIdentity,
): boolean {
  try {
    const permit = bookingSettlementPermitFrom(value);
    return (
      paymentBindingMatches(request, permit.binding) &&
      paymentIdentityMatches(identity, permit.binding.providerIdentity)
    );
  } catch {
    return false;
  }
}
