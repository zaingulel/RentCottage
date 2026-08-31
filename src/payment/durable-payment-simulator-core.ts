import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  PaymentProviderAdapter,
  PaymentProviderIdentity,
  ProviderOperationBinding,
  ProviderOperationRequest,
  ProviderOperationResult,
  ProviderOutcome,
  ProviderReconciliationQuery,
} from "./payment-contract";

interface DurablePaymentSimulatorOptions {
  readonly client: SupabaseClient;
  readonly now: () => string;
  readonly executeOutcome?: ProviderOutcome;
  readonly reconciliationOutcome?: ProviderOutcome;
}

const identity: PaymentProviderIdentity = Object.freeze({
  provider: "fictional-payments",
  environment: "local-test",
  merchantId: "fictional-merchant",
  terminalId: "fictional-terminal",
});

function operationFingerprint(request: ProviderOperationBinding): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: identity,
        kind: request.kind,
        paymentLifecycleId: request.paymentLifecycleId,
        logicalOperationId: request.logicalOperationId,
        attemptId: request.attemptId,
        amountFils: request.amountFils,
        currency: request.currency,
      }),
    )
    .digest("hex");
}

function providerResult(value: unknown): ProviderOperationResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Simulated payment ledger returned an invalid result");
  }
  const result = value as Record<string, unknown>;
  if (result.outcome === "not-executed") {
    return { outcome: "not-executed" };
  }
  if (
    result.outcome === "failed" &&
    typeof result.providerRequestId === "string" &&
    typeof result.providerReference === "string"
  ) {
    return {
      outcome: "failed",
      providerRequestId: result.providerRequestId,
      providerReference: result.providerReference,
      retrySafe: result.retrySafe === true,
    };
  }
  if (
    (result.outcome === "succeeded" || result.outcome === "indeterminate") &&
    typeof result.providerRequestId === "string" &&
    typeof result.providerReference === "string" &&
    typeof result.movementReference === "string"
  ) {
    return {
      outcome: result.outcome,
      providerRequestId: result.providerRequestId,
      providerReference: result.providerReference,
      movementReference: result.movementReference,
    };
  }
  throw new Error("Simulated payment ledger returned an invalid result");
}

function operationPayload(request: ProviderOperationBinding) {
  return {
    target_operation: {
      providerIdentity: identity,
      requestFingerprint: operationFingerprint(request),
      paymentLifecycleId: request.paymentLifecycleId,
      logicalOperationId: request.logicalOperationId,
      physicalAttemptId: request.attemptId,
      operationKind: request.kind,
      amountFils: request.amountFils,
      currency: request.currency,
    },
  };
}

type ActiveExecutionPermit = Exclude<
  NonNullable<ProviderOperationRequest["executionPermit"]>,
  { readonly purpose: "booking-request-capture" }
>;

function permitPayload(permit: ActiveExecutionPermit) {
  if (permit.purpose === "booking-request-authorization") {
    return {
      permitPurpose: permit.purpose,
      claimId: permit.claimId,
      claimGeneration: permit.generation,
      idempotencyKey: permit.idempotencyKey,
      notAfter: permit.notAfter,
      workId: null,
      leaseGeneration: null,
      leaseToken: null,
      operationId: null,
      operationGeneration: null,
      cleanupAttemptId: null,
      stateRevision: null,
    };
  }
  if (permit.purpose === "booking-request-submission-cleanup") {
    return {
      permitPurpose: permit.purpose,
      claimId: permit.claimId,
      claimGeneration: permit.generation,
      idempotencyKey: permit.idempotencyKey,
      notAfter: permit.notAfter,
      workId: null,
      leaseGeneration: null,
      leaseToken: null,
      operationId: null,
      operationGeneration: null,
      cleanupAttemptId: permit.attemptId,
      stateRevision: permit.stateRevision,
    };
  }
  return {
    permitPurpose: permit.purpose,
    claimId: null,
    claimGeneration: null,
    idempotencyKey: permit.idempotencyKey,
    notAfter: permit.notAfter,
    workId: permit.workId,
    leaseGeneration: permit.leaseGeneration,
    leaseToken: permit.leaseToken,
    operationId: permit.operationId,
    operationGeneration: permit.operationGeneration,
    cleanupAttemptId: null,
    stateRevision: null,
  };
}

export class DurablePaymentSimulator implements PaymentProviderAdapter {
  readonly identity = identity;
  readonly #client: SupabaseClient;
  readonly #now: () => string;
  readonly #executeOutcome: ProviderOutcome;
  readonly #reconciliationOutcome: ProviderOutcome;

  constructor(options: DurablePaymentSimulatorOptions) {
    this.#client = options.client;
    this.#now = options.now;
    this.#executeOutcome = options.executeOutcome ?? "succeeded";
    this.#reconciliationOutcome =
      options.reconciliationOutcome ?? this.#executeOutcome;
  }

  async execute(
    request: ProviderOperationRequest,
  ): Promise<ProviderOperationResult> {
    const permit = request.executionPermit;
    if (permit?.purpose === "booking-request-capture") {
      return { outcome: "not-executed" };
    }
    const purposeMatchesKind =
      (permit?.purpose === "booking-request-authorization" &&
        request.kind === "authorization") ||
      ((permit?.purpose === "booking-request-release" ||
        permit?.purpose === "booking-request-submission-cleanup") &&
        request.kind === "release");
    if (
      !permit ||
      Date.parse(this.#now()) >= Date.parse(permit.notAfter) ||
      !purposeMatchesKind
    ) {
      return { outcome: "not-executed" };
    }
    const { data, error } = await this.#client.rpc(
      "execute_simulated_payment_provider_operation",
      {
        ...operationPayload(request),
        target_operation: {
          ...operationPayload(request).target_operation,
          ...permitPayload(permit),
          requestFingerprint:
            permit?.purpose === "booking-request-release" ||
            permit?.purpose === "booking-request-submission-cleanup"
              ? permit.requestFingerprint
              : operationPayload(request).target_operation.requestFingerprint,
        },
        target_outcome: this.#executeOutcome,
      },
    );
    if (error) throw new Error("Simulated payment execution is unavailable");
    return providerResult(data);
  }

  async query(
    request: ProviderReconciliationQuery,
  ): Promise<ProviderOperationResult> {
    const { data, error } = await this.#client.rpc(
      "query_simulated_payment_provider_operation",
      {
        ...operationPayload(request),
        target_operation: {
          ...operationPayload(request).target_operation,
          requestFingerprint:
            request.kind === "release"
              ? null
              : operationPayload(request).target_operation.requestFingerprint,
        },
        target_provider_request_id: request.providerRequestId,
        target_provider_reference: request.providerReference,
        target_outcome: this.#reconciliationOutcome,
      },
    );
    if (error) throw new Error("Simulated payment query is unavailable");
    return providerResult(data);
  }

  verifySignedEvent(): boolean {
    return false;
  }
}
