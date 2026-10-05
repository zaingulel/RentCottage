import type {
  PaymentProviderIdentity,
  ProviderOperationBinding,
} from "./payment-contract";

const identifierShape =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestFingerprintShape = /^[a-f0-9]{64}$/;

export const isPermitIdentifier = (value: unknown): value is string =>
  typeof value === "string" && identifierShape.test(value);
export const isPositiveInteger = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) > 0;
export const isRequestFingerprint = (value: unknown): value is string =>
  typeof value === "string" && requestFingerprintShape.test(value);

interface IntentExecutionPermit {
  readonly purpose: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly leaseToken: string;
  readonly idempotencyKey: string;
  readonly notBefore: string;
  readonly notAfter: string;
  readonly binding: ProviderOperationBinding & {
    readonly bookingRequestId: string;
    readonly captureOperationId: string;
    readonly requestFingerprint: string;
    readonly providerIdentity: PaymentProviderIdentity;
  };
}

export interface IntentPermitKind<Permit extends IntentExecutionPermit> {
  readonly purpose: Permit["purpose"];
  readonly operationKind: Permit["binding"]["kind"];
  readonly intentIdOf: (binding: Permit["binding"]) => string;
  readonly invalidMessage: string;
}

export function intentExecutionPermitFrom<Permit extends IntentExecutionPermit>(
  value: unknown,
  kind: IntentPermitKind<Permit>,
): Permit {
  if (!value || typeof value !== "object") throw new Error(kind.invalidMessage);
  const permit = value as Permit;
  const binding = permit.binding;
  if (
    permit.purpose !== kind.purpose ||
    !binding ||
    binding.kind !== kind.operationKind
  )
    throw new Error(kind.invalidMessage);
  const intentId = kind.intentIdOf(binding);
  if (
    ![
      permit.attemptId,
      permit.leaseToken,
      binding.bookingRequestId,
      intentId,
      binding.captureOperationId,
      binding.paymentLifecycleId,
    ].every(isPermitIdentifier) ||
    !isPositiveInteger(permit.generation) ||
    typeof permit.notBefore !== "string" ||
    typeof permit.notAfter !== "string" ||
    !Number.isFinite(Date.parse(permit.notBefore)) ||
    !(Date.parse(permit.notAfter) > Date.parse(permit.notBefore)) ||
    binding.logicalOperationId !== `${intentId}:${kind.operationKind}` ||
    binding.attemptId !==
      `${intentId}:${kind.operationKind}:${permit.generation}` ||
    permit.idempotencyKey !== binding.attemptId ||
    !isPositiveInteger(binding.amountFils) ||
    binding.currency !== "IQD" ||
    !isRequestFingerprint(binding.requestFingerprint) ||
    !binding.providerIdentity ||
    ![
      binding.providerIdentity.provider,
      binding.providerIdentity.environment,
      binding.providerIdentity.merchantId,
      binding.providerIdentity.terminalId,
    ].every((part) => typeof part === "string" && part.length > 0)
  )
    throw new Error(kind.invalidMessage);
  return permit;
}
