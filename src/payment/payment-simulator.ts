import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  PaymentOperationSnapshot,
  PaymentProviderIdentity,
  PaymentProviderAdapter,
  ProviderOperationRequest,
  ProviderOperationResult,
  ProviderOutcome,
  ProviderReconciliationQuery,
  SignedProviderEvent,
} from "./payment-contract";

interface PaymentSimulatorOptions {
  readonly now: () => string;
  readonly outcomes?: readonly ProviderOutcome[];
  readonly reconciliationOutcomes?: readonly ProviderOutcome[];
  readonly identity?: Partial<PaymentProviderIdentity>;
  readonly signingKey?: string;
  readonly failureRetrySafety?: readonly boolean[];
  readonly providerRequestIds?: readonly string[];
  readonly movementReferences?: readonly string[];
}

type SignedEventOverrides = Partial<Omit<SignedProviderEvent, "signature">>;

export class PaymentSimulator implements PaymentProviderAdapter {
  readonly identity: PaymentProviderIdentity;
  readonly #now: () => string;
  readonly #outcomes: ProviderOutcome[];
  readonly #reconciliationOutcomes: ProviderOutcome[];
  readonly #requests: ProviderOperationRequest[] = [];
  readonly #queries: ProviderReconciliationQuery[] = [];
  readonly #signingKey: string;
  readonly #failureRetrySafety: boolean[];
  readonly #providerRequestIds: string[];
  readonly #movementReferences: string[];

  constructor(options: PaymentSimulatorOptions) {
    this.#now = options.now;
    this.#outcomes = [...(options.outcomes ?? [])];
    this.#reconciliationOutcomes = [...(options.reconciliationOutcomes ?? [])];
    this.identity = Object.freeze({
      provider: options.identity?.provider ?? "fictitious-payments",
      environment: options.identity?.environment ?? "sandbox",
      merchantId: options.identity?.merchantId ?? "merchant-test-only",
      terminalId: options.identity?.terminalId ?? "terminal-test-only",
    });
    this.#signingKey =
      options.signingKey ?? "fictitious-test-signing-key-never-use";
    this.#failureRetrySafety = [...(options.failureRetrySafety ?? [])];
    this.#providerRequestIds = [...(options.providerRequestIds ?? [])];
    this.#movementReferences = [...(options.movementReferences ?? [])];
  }

  get requests(): readonly ProviderOperationRequest[] {
    return this.#requests.map((request) => Object.freeze({ ...request }));
  }

  get queries(): readonly ProviderReconciliationQuery[] {
    return this.#queries.map((query) => Object.freeze({ ...query }));
  }

  async execute(
    request: ProviderOperationRequest,
  ): Promise<ProviderOperationResult> {
    this.#requests.push(Object.freeze({ ...request }));
    const outcome = this.#outcomes.shift() ?? "indeterminate";
    return this.#resultFor(request, outcome);
  }

  async query(
    request: ProviderReconciliationQuery,
  ): Promise<ProviderOperationResult> {
    this.#queries.push(Object.freeze({ ...request }));
    const outcome = this.#reconciliationOutcomes.shift() ?? "indeterminate";
    return this.#resultFor(request, outcome);
  }

  createSignedEvent(
    operation: PaymentOperationSnapshot,
    overrides: SignedEventOverrides = {},
  ): SignedProviderEvent {
    if (
      !operation.providerRequestId ||
      !operation.providerReference ||
      !operation.movementReference
    ) {
      throw new Error(
        "Operation needs complete provider identity before an event can be simulated.",
      );
    }
    const unsigned: Omit<SignedProviderEvent, "signature"> = {
      ...this.identity,
      eventId: `sim-event-${operation.attemptId}`,
      outcome: "succeeded",
      currency: "IQD",
      amountFils: operation.amountFils,
      paymentLifecycleId: operation.paymentLifecycleId,
      logicalOperationId: operation.logicalOperationId,
      attemptId: operation.attemptId,
      providerRequestId: operation.providerRequestId,
      providerReference: operation.providerReference,
      movementReference: operation.movementReference,
      occurredAt: this.#now(),
      retrySafe: false,
      ...overrides,
    };
    return Object.freeze({
      ...unsigned,
      signature: this.#signature(unsigned),
    });
  }

  verifySignedEvent(event: SignedProviderEvent): boolean {
    const { signature, ...unsigned } = event;
    const expected = this.#signature(unsigned);
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    return (
      actualBytes.length === expectedBytes.length &&
      timingSafeEqual(actualBytes, expectedBytes)
    );
  }

  #resultFor(
    request: ProviderOperationRequest,
    outcome: ProviderOutcome,
  ): ProviderOperationResult {
    const providerRequestId =
      this.#providerRequestIds.shift() ?? `sim-request-${request.attemptId}`;
    const providerReference = `sim-reference-${request.attemptId}`;
    const movementReference =
      this.#movementReferences.shift() ?? `sim-movement-${request.attemptId}`;

    if (outcome === "succeeded") {
      return {
        outcome,
        providerRequestId,
        providerReference,
        movementReference,
      };
    }

    if (outcome === "failed") {
      return {
        outcome,
        providerRequestId,
        providerReference,
        retrySafe: this.#failureRetrySafety.shift() ?? false,
      };
    }

    return {
      outcome,
      providerRequestId,
      providerReference,
      movementReference,
    };
  }

  #signature(event: Omit<SignedProviderEvent, "signature">): string {
    return createHmac("sha256", this.#signingKey)
      .update(JSON.stringify(event))
      .digest("hex");
  }

  now(): string {
    return this.#now();
  }
}
