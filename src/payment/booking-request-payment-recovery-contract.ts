import type {
  Fils,
  PaymentProviderIdentity,
  ProviderOperationBinding,
} from "./payment-contract";

export const paymentRecoverySteps = [
  "original-release",
  "replacement-authorization",
  "replacement-capture",
  "replacement-release",
] as const;
export type PaymentRecoveryStep = (typeof paymentRecoverySteps)[number];
export const paymentRecoveryOperationKinds = {
  "original-release": "release",
  "replacement-authorization": "authorization",
  "replacement-capture": "capture",
  "replacement-release": "release",
} as const satisfies Record<
  PaymentRecoveryStep,
  ProviderOperationBinding["kind"]
>;
export type BookingRequestPaymentRecoveryBinding = {
  readonly bookingRequestId: string;
  readonly recoveryAttemptId: string;
  readonly generation: number;
  readonly step: PaymentRecoveryStep;
  readonly authorizationClaimId: string;
  readonly authorizationClaimGeneration: number;
  readonly predecessorMovementReference: string;
  readonly predecessorOutcomeAt: string;
  readonly paymentLifecycleId: string;
  readonly logicalOperationId: string;
  readonly physicalAttemptId: string;
  readonly amountFils: Fils;
  readonly currency: "IQD";
  readonly requestFingerprint: string;
  readonly providerIdentity: PaymentProviderIdentity;
};
export type BookingRequestPaymentRecoveryPermit = {
  readonly purpose: "booking-request-payment-recovery";
  readonly attemptId: string;
  readonly generation: number;
  readonly step: PaymentRecoveryStep;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly notAfter: string;
  readonly binding: BookingRequestPaymentRecoveryBinding;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}
const positiveInteger = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) > 0;
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
export function recoveryBindingFrom(
  value: unknown,
): BookingRequestPaymentRecoveryBinding {
  const binding = record(value);
  const identity = record(binding?.providerIdentity);
  if (
    !binding ||
    !exactKeys(binding, [
      "bookingRequestId",
      "recoveryAttemptId",
      "generation",
      "step",
      "authorizationClaimId",
      "authorizationClaimGeneration",
      "predecessorMovementReference",
      "predecessorOutcomeAt",
      "paymentLifecycleId",
      "logicalOperationId",
      "physicalAttemptId",
      "amountFils",
      "currency",
      "requestFingerprint",
      "providerIdentity",
    ]) ||
    ![
      binding.bookingRequestId,
      binding.recoveryAttemptId,
      binding.authorizationClaimId,
      binding.paymentLifecycleId,
    ].every((value) => typeof value === "string" && uuid.test(value)) ||
    !positiveInteger(binding.generation) ||
    !positiveInteger(binding.authorizationClaimGeneration) ||
    !paymentRecoverySteps.includes(binding.step as PaymentRecoveryStep) ||
    !nonempty(binding.predecessorMovementReference) ||
    typeof binding.predecessorOutcomeAt !== "string" ||
    Number.isNaN(Date.parse(binding.predecessorOutcomeAt)) ||
    binding.logicalOperationId !==
      `${binding.recoveryAttemptId}:${binding.step}` ||
    binding.physicalAttemptId !== `${binding.logicalOperationId}:1` ||
    !positiveInteger(binding.amountFils) ||
    binding.currency !== "IQD" ||
    typeof binding.requestFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(binding.requestFingerprint) ||
    !identity ||
    !exactKeys(identity, [
      "provider",
      "environment",
      "merchantId",
      "terminalId",
    ]) ||
    !Object.values(identity).every(nonempty)
  )
    throw new Error("Recovery provider binding is invalid");
  return binding as BookingRequestPaymentRecoveryBinding;
}
export function recoveryPermitFrom(
  value: unknown,
): BookingRequestPaymentRecoveryPermit {
  const permit = record(value);
  if (
    !permit ||
    !exactKeys(permit, [
      "purpose",
      "attemptId",
      "generation",
      "step",
      "operationId",
      "idempotencyKey",
      "notAfter",
      "binding",
    ]) ||
    permit.purpose !== "booking-request-payment-recovery" ||
    typeof permit.attemptId !== "string" ||
    !uuid.test(permit.attemptId) ||
    !positiveInteger(permit.generation) ||
    !paymentRecoverySteps.includes(permit.step as PaymentRecoveryStep) ||
    permit.operationId !== `${permit.attemptId}:${permit.step}` ||
    permit.idempotencyKey !== `${permit.operationId}:1` ||
    typeof permit.notAfter !== "string" ||
    Number.isNaN(Date.parse(permit.notAfter))
  )
    throw new Error("Recovery execution permit is invalid");
  const binding = recoveryBindingFrom(permit.binding);
  if (
    binding.recoveryAttemptId !== permit.attemptId ||
    binding.generation !== permit.generation ||
    binding.step !== permit.step
  )
    throw new Error("Recovery execution permit is invalid");
  return { ...permit, binding } as BookingRequestPaymentRecoveryPermit;
}
export function recoveryRequestMatches(
  request: ProviderOperationBinding,
  value: unknown,
  identity: PaymentProviderIdentity,
): boolean {
  let permit: BookingRequestPaymentRecoveryPermit;
  try {
    permit = recoveryPermitFrom(value);
  } catch {
    return false;
  }
  const binding = permit.binding;
  return (
    request.kind === paymentRecoveryOperationKinds[permit.step] &&
    request.paymentLifecycleId === binding.paymentLifecycleId &&
    request.logicalOperationId === binding.logicalOperationId &&
    request.attemptId === binding.physicalAttemptId &&
    request.amountFils === binding.amountFils &&
    request.currency === binding.currency &&
    Object.keys(identity).every(
      (key) =>
        identity[key as keyof PaymentProviderIdentity] ===
        binding.providerIdentity[key as keyof PaymentProviderIdentity],
    )
  );
}
