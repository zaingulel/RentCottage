import {
  isFictionalSupplierEnvironment,
  type FictionalSupplierEnvironment,
} from "@/booking-request/fictional-supplier-environment-core";
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
  readonly environment?: FictionalSupplierEnvironment;
  readonly effects: SimulatorEffectRepository;
  readonly now: () => string;
  readonly failedInitialCaptureLifecycleId?: string;
  readonly executeOutcome?: ProviderOutcome;
  readonly failureRetrySafe?: boolean;
  readonly reconciliationOutcome?: ProviderOutcome;
}

export class DurablePaymentSimulator implements PaymentProviderAdapter {
  readonly identity: PaymentProviderIdentity;
  readonly #effects: SimulatorEffectRepository;
  readonly #now: () => string;
  readonly #failedInitialCaptureLifecycleId: string | undefined;
  readonly #executeOutcome: ProviderOutcome;
  readonly #failureRetrySafe: boolean;
  readonly #reconciliationOutcome: ProviderOutcome;

  constructor(options: DurablePaymentSimulatorOptions) {
    const environment =
      options.environment === undefined ? "local-test" : options.environment;
    if (!isFictionalSupplierEnvironment(environment))
      throw new Error("Fictional payment environment is invalid");
    if (
      options.failedInitialCaptureLifecycleId !== undefined &&
      (environment !== "hosted-demo-yvibcyqtyihpzpmomnzg" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          options.failedInitialCaptureLifecycleId,
        ) ||
        options.executeOutcome !== undefined ||
        options.failureRetrySafe !== undefined ||
        options.reconciliationOutcome !== undefined)
    ) {
      throw new Error(
        "Initial-capture selector requires a hosted demo canonical lowercase UUID without global outcome options",
      );
    }
    this.identity = Object.freeze({
      provider: "fictional-payments",
      environment,
      merchantId: "fictional-merchant",
      terminalId: "fictional-terminal",
    });
    this.#failedInitialCaptureLifecycleId =
      options.failedInitialCaptureLifecycleId;
    this.#effects = options.effects;
    this.#now = options.now;
    this.#executeOutcome = options.executeOutcome ?? "succeeded";
    this.#failureRetrySafe = options.failureRetrySafe ?? false;
    this.#reconciliationOutcome =
      options.reconciliationOutcome ?? this.#executeOutcome;
  }

  #binding(
    request: ProviderOperationRequest | ProviderReconciliationQuery,
  ): SimulatorEffectBinding {
    const admission: PaymentOperationAdmission | undefined = request.admission;
    if (
      !admission ||
      !paymentIdentityMatches(admission.providerIdentity, this.identity) ||
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
        ? { retrySafe: this.#failureRetrySafe }
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
    const outcome =
      request.admission!.purpose === "booking-request-capture" &&
      request.kind === "capture" &&
      request.paymentLifecycleId === this.#failedInitialCaptureLifecycleId
        ? "failed"
        : this.#executeOutcome;
    return validatedProviderResult(
      await this.#effects.executeOnce(binding, this.#result(binding, outcome)),
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
