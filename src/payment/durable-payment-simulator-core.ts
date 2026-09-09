import {
  paymentBindingMatches,
  paymentIdentityMatches,
  validatedProviderResult,
} from "./payment-operation-execution";
import type { PaymentOperationAdmission } from "./payment-operation-execution";
import type {
  PaymentProviderAdapter,
  PaymentProviderIdentity,
  ProviderOperationRequest,
  ProviderOperationResult,
  ProviderOutcome,
  ProviderReconciliationQuery,
} from "./payment-contract";

export interface SimulatorEffectBinding {
  readonly operationId: string;
  readonly providerIdentity: PaymentProviderIdentity;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly notBefore: string | null;
  readonly notAfter: string | null;
}

export interface SimulatorEffectRepository {
  executeOnce(
    binding: SimulatorEffectBinding,
    proposed: ProviderOperationResult,
  ): Promise<ProviderOperationResult>;
  queryAndSealAbsent(
    binding: SimulatorEffectBinding,
  ): Promise<ProviderOperationResult>;
  resolve(
    binding: SimulatorEffectBinding,
    expectedEventId: string,
    proposed: ProviderOperationResult,
  ): Promise<ProviderOperationResult>;
}

interface DurablePaymentSimulatorOptions {
  readonly effects: SimulatorEffectRepository;
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

export class DurablePaymentSimulator implements PaymentProviderAdapter {
  readonly identity = identity;
  readonly #effects: SimulatorEffectRepository;
  readonly #now: () => string;
  readonly #executeOutcome: ProviderOutcome;
  readonly #reconciliationOutcome: ProviderOutcome;

  constructor(options: DurablePaymentSimulatorOptions) {
    this.#effects = options.effects;
    this.#now = options.now;
    this.#executeOutcome = options.executeOutcome ?? "succeeded";
    this.#reconciliationOutcome =
      options.reconciliationOutcome ?? this.#executeOutcome;
  }

  #binding(
    request: ProviderOperationRequest | ProviderReconciliationQuery,
  ): SimulatorEffectBinding {
    const admission: PaymentOperationAdmission | undefined = request.admission;
    if (
      !admission ||
      !paymentIdentityMatches(admission.providerIdentity, identity) ||
      !paymentBindingMatches(admission.binding, request)
    )
      throw new Error("Fictional payment admission is invalid");
    return {
      operationId: admission.operationId,
      providerIdentity: admission.providerIdentity,
      idempotencyKey: admission.idempotencyKey,
      requestFingerprint: admission.requestFingerprint,
      notBefore: admission.notBefore,
      notAfter: admission.notAfter,
    };
  }

  #result(
    binding: SimulatorEffectBinding,
    outcome: ProviderOutcome,
    previous?: ProviderOperationResult,
  ): ProviderOperationResult {
    const references =
      previous && previous.outcome !== "not-executed" ? previous : undefined;
    return {
      outcome,
      providerRequestId:
        references?.providerRequestId ?? `sim-request-${binding.operationId}`,
      providerReference:
        references?.providerReference ?? `sim-reference-${binding.operationId}`,
      ...(outcome === "failed"
        ? { retrySafe: false }
        : {
            movementReference:
              references && "movementReference" in references
                ? references.movementReference
                : `sim-movement-${binding.operationId}`,
          }),
      evidence: {
        operationId: binding.operationId,
        eventId: `sim-event-${binding.operationId}-${outcome}`,
        provenance: "fictional-provider",
        originalOutcome: references?.evidence?.originalOutcome ?? outcome,
        executedAt: references?.evidence?.executedAt ?? this.#now(),
        occurredAt: outcome === "indeterminate" ? null : this.#now(),
        closedAt: null,
      },
    } as ProviderOperationResult;
  }

  async execute(
    request: ProviderOperationRequest,
  ): Promise<ProviderOperationResult> {
    const binding = this.#binding(request);
    return validatedProviderResult(
      await this.#effects.executeOnce(
        binding,
        this.#result(binding, this.#executeOutcome),
      ),
      binding.operationId,
    );
  }

  async query(
    request: ProviderReconciliationQuery,
  ): Promise<ProviderOperationResult> {
    const binding = this.#binding(request);
    const stored = validatedProviderResult(
      await this.#effects.queryAndSealAbsent(binding),
      binding.operationId,
    );
    if (
      stored.outcome !== "indeterminate" ||
      this.#reconciliationOutcome === "indeterminate"
    )
      return stored;
    return validatedProviderResult(
      await this.#effects.resolve(
        binding,
        stored.evidence!.eventId,
        this.#result(binding, this.#reconciliationOutcome, stored),
      ),
      binding.operationId,
    );
  }

  verifySignedEvent(): boolean {
    return false;
  }
}
