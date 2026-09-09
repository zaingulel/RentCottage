import type {
  PaymentProviderAdapter,
  PaymentProviderIdentity,
  ProviderOperationBinding,
  ProviderExecutionPermit,
  ProviderOperationRequest,
  ProviderOperationResult,
  ProviderReconciliationQuery,
} from "./payment-contract";

export interface PaymentOperationAdmission {
  readonly purpose: ProviderExecutionPermit["purpose"];
  readonly operationId: string;
  readonly providerIdentity: PaymentProviderIdentity;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly binding: ProviderOperationBinding;
  readonly notBefore: string | null;
  readonly notAfter: string | null;
  readonly mode: "execute" | "reconcile";
}

export type PaymentOperationAdmissionResult =
  | PaymentOperationAdmission
  | { readonly status: "not-admitted" };

export interface PaymentOperationExecutionRepository {
  admit(
    request: ProviderOperationRequest,
    identity: PaymentProviderIdentity,
  ): Promise<PaymentOperationAdmissionResult>;
  reload(
    query: ProviderReconciliationQuery,
    identity: PaymentProviderIdentity,
  ): Promise<PaymentOperationAdmissionResult>;
  record(
    admission: PaymentOperationAdmission,
    result: ProviderOperationResult,
  ): Promise<ProviderOperationResult>;
}

export type PaymentOperationExecutionResult =
  | { readonly status: "recorded"; readonly result: ProviderOperationResult }
  | { readonly status: "unresolved" | "unavailable" | "not-admitted" };

export interface PaymentOperationExecution {
  execute(
    request: ProviderOperationRequest,
  ): Promise<PaymentOperationExecutionResult>;
  query(
    query: ProviderReconciliationQuery,
  ): Promise<PaymentOperationExecutionResult>;
}

export function paymentBindingMatches(
  left: ProviderOperationBinding,
  right: ProviderOperationBinding,
): boolean {
  return (
    left.kind === right.kind &&
    left.paymentLifecycleId === right.paymentLifecycleId &&
    left.logicalOperationId === right.logicalOperationId &&
    left.attemptId === right.attemptId &&
    left.amountFils === right.amountFils &&
    left.currency === right.currency
  );
}

export function paymentIdentityMatches(
  left: PaymentProviderIdentity,
  right: PaymentProviderIdentity,
): boolean {
  return (
    left.provider === right.provider &&
    left.environment === right.environment &&
    left.merchantId === right.merchantId &&
    left.terminalId === right.terminalId
  );
}

export function validatedProviderResult(
  value: unknown,
  operationId: string,
): ProviderOperationResult {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid provider observation");
  const result = value as Record<string, unknown>;
  const evidence = result.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence))
    throw new Error("Missing provider observation identity");
  const receipt = evidence as Record<string, unknown>;
  const validTime = (time: unknown) =>
    typeof time === "string" && Number.isFinite(Date.parse(time));
  const text = (part: unknown) => typeof part === "string" && part.length > 0;
  if (
    receipt.operationId !== operationId ||
    !text(receipt.eventId) ||
    !["fictional-provider", "provider-event", "legacy-simulated"].includes(
      String(receipt.provenance),
    )
  )
    throw new Error("Invalid provider observation identity");
  if (result.outcome === "not-executed") {
    if (
      receipt.originalOutcome !== null ||
      receipt.executedAt !== null ||
      receipt.occurredAt !== null ||
      !validTime(receipt.closedAt) ||
      "providerRequestId" in result ||
      "providerReference" in result ||
      "movementReference" in result
    )
      throw new Error("Invalid provider absence receipt");
  } else {
    if (
      !["succeeded", "failed", "indeterminate"].includes(
        String(result.outcome),
      ) ||
      !text(result.providerRequestId) ||
      !text(result.providerReference) ||
      receipt.closedAt !== null ||
      !["succeeded", "failed", "indeterminate"].includes(
        String(receipt.originalOutcome),
      ) ||
      !(
        validTime(receipt.executedAt) ||
        (receipt.provenance === "legacy-simulated" &&
          receipt.executedAt === null)
      ) ||
      (result.outcome === "indeterminate"
        ? receipt.occurredAt !== null
        : !(
            validTime(receipt.occurredAt) ||
            (receipt.provenance === "legacy-simulated" &&
              receipt.occurredAt === null)
          )) ||
      (result.outcome === "failed"
        ? "movementReference" in result || typeof result.retrySafe !== "boolean"
        : !text(result.movementReference))
    )
      throw new Error("Invalid provider observation result");
  }
  return value as ProviderOperationResult;
}

export function recordedPaymentResult(
  execution: PaymentOperationExecutionResult,
): ProviderOperationResult {
  if (execution.status !== "recorded")
    throw new Error(`Payment evidence is ${execution.status}`);
  return execution.result;
}

export function createPaymentOperationExecution({
  repository,
  provider,
}: {
  repository: PaymentOperationExecutionRepository;
  provider: PaymentProviderAdapter;
}): PaymentOperationExecution {
  function validateAdmission(
    admission: PaymentOperationAdmission,
    request: ProviderOperationBinding,
  ) {
    if (
      !paymentBindingMatches(admission.binding, request) ||
      !paymentIdentityMatches(admission.providerIdentity, provider.identity)
    )
      throw new Error(
        "Payment admission does not match the requested operation",
      );
  }
  async function record(
    admission: PaymentOperationAdmission,
    result: ProviderOperationResult,
  ): Promise<PaymentOperationExecutionResult> {
    if (result.outcome === "not-executed" && !result.evidence)
      return { status: "unresolved" };
    const observation = validatedProviderResult(result, admission.operationId);
    const accepted = await repository.record(admission, observation);
    return {
      status: "recorded",
      result: validatedProviderResult(accepted, admission.operationId),
    };
  }
  return {
    async execute(request) {
      try {
        const admission = await repository.admit(request, provider.identity);
        if ("status" in admission) return admission;
        validateAdmission(admission, request);
        const result =
          admission.mode === "execute"
            ? await provider.execute({ ...request, admission })
            : await provider.query({
                ...admission.binding,
                admission,
                providerRequestId: null,
                providerReference: null,
              });
        return await record(admission, result);
      } catch {
        return { status: "unavailable" };
      }
    },
    async query(query) {
      try {
        const admission = await repository.reload(query, provider.identity);
        if ("status" in admission) return admission;
        validateAdmission(admission, query);
        return await record(
          admission,
          await provider.query({ ...query, admission }),
        );
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}

export function paymentQueryReferencesAreValid(
  requestId: unknown,
  reference: unknown,
): boolean {
  return (
    (requestId === null && reference === null) ||
    (typeof requestId === "string" &&
      requestId.trim().length > 0 &&
      typeof reference === "string" &&
      reference.trim().length > 0)
  );
}
