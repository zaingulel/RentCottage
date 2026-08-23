import type {
  Fils,
  MoneyMovement,
  PaymentAuditEntry,
  PaymentLifecycleSnapshot,
  PaymentDisputeOutcome,
  PaymentDisputeSnapshot,
  PaymentOperationKind,
  PaymentOperationSnapshot,
  PaymentProviderAdapter,
  ProviderExecutionPermit,
  ProviderEventApplication,
  ProviderOperationResult,
  RefundAllocation,
  SignedProviderEvent,
} from "./payment-contract";

interface PaymentLifecycleInput {
  readonly paymentLifecycleId: string;
  readonly bookingPriceFils: Fils;
  readonly bookingServiceFeeFils: Fils;
  readonly providerFeeFils?: Fils;
  readonly providerReserveFils?: Fils;
}

interface ClockedPaymentProviderAdapter extends PaymentProviderAdapter {
  now?(): string;
}

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

const operationKeys = [
  "paymentLifecycleId",
  "kind",
  "logicalOperationId",
  "attemptId",
  "status",
  "amountFils",
  "providerRequestId",
  "providerReference",
  "movementReference",
  "reconciliationRequired",
  "retrySafe",
] as const;

function validAuthorizationPhaseOperation(
  value: unknown,
  lifecycleId: string,
  kind: "authorization" | "release",
  totalFils: number,
) {
  const operation = record(value);
  if (!operation || !exactKeys(operation, operationKeys)) return false;
  const logicalOperationId = `${lifecycleId}:${kind}`;
  const status = operation.status;
  const requestId = operation.providerRequestId;
  const providerReference = operation.providerReference;
  const movementReference = operation.movementReference;
  if (
    operation.paymentLifecycleId !== lifecycleId ||
    operation.kind !== kind ||
    operation.logicalOperationId !== logicalOperationId ||
    typeof operation.attemptId !== "string" ||
    !new RegExp(`^${logicalOperationId}:attempt-[1-9][0-9]*$`).test(
      operation.attemptId,
    ) ||
    operation.amountFils !== totalFils ||
    !["pending", "succeeded", "failed"].includes(status as string) ||
    typeof operation.reconciliationRequired !== "boolean" ||
    typeof operation.retrySafe !== "boolean"
  ) {
    return false;
  }
  if (status === "succeeded") {
    return (
      typeof requestId === "string" &&
      requestId.length > 0 &&
      typeof providerReference === "string" &&
      providerReference.length > 0 &&
      typeof movementReference === "string" &&
      movementReference.length > 0 &&
      operation.reconciliationRequired === false &&
      operation.retrySafe === false
    );
  }
  if (status === "failed") {
    const providerFailure =
      typeof requestId === "string" &&
      requestId.length > 0 &&
      typeof providerReference === "string" &&
      providerReference.length > 0 &&
      movementReference === null;
    const executionNotStarted =
      requestId === null &&
      providerReference === null &&
      movementReference === null &&
      operation.retrySafe === true;
    return (
      (providerFailure || executionNotStarted) &&
      operation.reconciliationRequired === false
    );
  }
  const untouched =
    requestId === null &&
    providerReference === null &&
    movementReference === null;
  const indeterminate =
    typeof requestId === "string" &&
    requestId.length > 0 &&
    typeof providerReference === "string" &&
    providerReference.length > 0 &&
    typeof movementReference === "string" &&
    movementReference.length > 0;
  return (
    (untouched || indeterminate) &&
    operation.retrySafe === false &&
    (operation.reconciliationRequired === indeterminate ||
      (untouched && operation.reconciliationRequired === true))
  );
}

export function isAuthorizationPhasePaymentSnapshot(
  value: unknown,
  expected: {
    paymentLifecycleId: string;
    bookingPriceFils: number;
    bookingServiceFeeFils: number;
  },
): value is PaymentLifecycleSnapshot {
  const snapshot = record(value);
  if (
    !snapshot ||
    !exactKeys(snapshot, [
      "paymentLifecycleId",
      "currency",
      "bookingPriceFils",
      "bookingServiceFeeFils",
      "customerTotalFils",
      "authorization",
      "capture",
      "release",
      "refunds",
      "financials",
      "payout",
      "holds",
      "dispute",
      "audits",
      "movements",
    ])
  )
    return false;
  const total = expected.bookingPriceFils + expected.bookingServiceFeeFils;
  const commission = expected.bookingPriceFils / 10;
  const financials = record(snapshot.financials);
  const payout = record(snapshot.payout);
  const holds = record(snapshot.holds);
  const movements = Array.isArray(snapshot.movements)
    ? snapshot.movements
    : undefined;
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(commission) ||
    snapshot.paymentLifecycleId !== expected.paymentLifecycleId ||
    snapshot.currency !== "IQD" ||
    snapshot.bookingPriceFils !== expected.bookingPriceFils ||
    snapshot.bookingServiceFeeFils !== expected.bookingServiceFeeFils ||
    snapshot.customerTotalFils !== total ||
    snapshot.capture !== null ||
    snapshot.dispute !== null ||
    !Array.isArray(snapshot.refunds) ||
    snapshot.refunds.length !== 0 ||
    !Array.isArray(snapshot.audits) ||
    snapshot.audits.length !== 0 ||
    !financials ||
    !exactKeys(financials, [
      "refundedBookingPriceFils",
      "refundedBookingServiceFeeFils",
      "remainingBookingPriceFils",
      "remainingBookingServiceFeeFils",
      "marketplaceCommissionFils",
      "ownerEntitlementFils",
    ]) ||
    financials.refundedBookingPriceFils !== 0 ||
    financials.refundedBookingServiceFeeFils !== 0 ||
    financials.remainingBookingPriceFils !== expected.bookingPriceFils ||
    financials.remainingBookingServiceFeeFils !==
      expected.bookingServiceFeeFils ||
    financials.marketplaceCommissionFils !== commission ||
    financials.ownerEntitlementFils !==
      expected.bookingPriceFils - commission ||
    !payout ||
    !exactKeys(payout, [
      "status",
      "eligibleFils",
      "paidFils",
      "providerFeeFils",
      "providerReserveFils",
      "recoveryExposureFils",
      "recoveryBalanceFils",
      "automaticOwnerDebitFils",
      "paidWhileBlocked",
      "settlement",
    ]) ||
    payout.status !== "not_eligible" ||
    payout.eligibleFils !== expected.bookingPriceFils - commission ||
    payout.paidFils !== 0 ||
    payout.providerFeeFils !== 0 ||
    payout.providerReserveFils !== 0 ||
    payout.recoveryExposureFils !== 0 ||
    payout.recoveryBalanceFils !== 0 ||
    payout.automaticOwnerDebitFils !== 0 ||
    payout.paidWhileBlocked !== false ||
    payout.settlement !== null ||
    !holds ||
    !exactKeys(holds, ["administrator", "dispute"]) ||
    holds.administrator !== false ||
    holds.dispute !== false ||
    !movements
  )
    return false;
  if (
    !validAuthorizationPhaseOperation(
      snapshot.authorization,
      expected.paymentLifecycleId,
      "authorization",
      total,
    )
  )
    return false;
  if (
    snapshot.release !== null &&
    !validAuthorizationPhaseOperation(
      snapshot.release,
      expected.paymentLifecycleId,
      "release",
      total,
    )
  )
    return false;
  const operations = [snapshot.authorization, snapshot.release].filter(
    Boolean,
  ) as PaymentOperationSnapshot[];
  const succeeded = operations.filter(
    (operation) => operation.status === "succeeded",
  );
  if (movements.length !== succeeded.length) return false;
  return succeeded.every((operation) => {
    const movement = movements.find(
      (candidate: unknown) =>
        record(candidate)?.movementReference === operation.movementReference,
    );
    const movementRecord = record(movement);
    return (
      !!movementRecord &&
      exactKeys(movementRecord, [
        "kind",
        "logicalOperationId",
        "attemptId",
        "amountFils",
        "movementReference",
        "recordedAt",
      ]) &&
      movementRecord.kind === operation.kind &&
      movementRecord.logicalOperationId === operation.logicalOperationId &&
      movementRecord.attemptId === operation.attemptId &&
      movementRecord.amountFils === total &&
      typeof movementRecord.recordedAt === "string" &&
      !Number.isNaN(Date.parse(movementRecord.recordedAt))
    );
  });
}

export interface PaymentLifecyclePersistence {
  save(
    snapshot: PaymentLifecycleSnapshot,
  ): Promise<ProviderExecutionPermit | void>;
}

export class ProviderExecutionNotStartedError extends Error {
  constructor() {
    super("provider_execution_not_started");
    this.name = "ProviderExecutionNotStartedError";
  }
}

export interface PaymentLifecycle {
  authorize(): Promise<PaymentOperationSnapshot>;
  capture(amountFils: Fils): Promise<PaymentOperationSnapshot>;
  release(amountFils: Fils): Promise<PaymentOperationSnapshot>;
  refund(allocation: RefundAllocation): Promise<PaymentOperationSnapshot>;
  reconcile(logicalOperationId: string): Promise<PaymentOperationSnapshot>;
  retry(logicalOperationId: string): Promise<PaymentOperationSnapshot>;
  applyProviderEvent(event: unknown): ProviderEventApplication;
  markBookingCompleted(): void;
  settle(): Promise<PaymentOperationSnapshot>;
  placeAdministratorHold(holdId: string): void;
  clearAdministratorHold(holdId: string): void;
  openDispute(disputeId: string): void;
  resolveDispute(
    outcome: PaymentDisputeOutcome,
    allocation?: RefundAllocation,
  ): Promise<PaymentOperationSnapshot | null>;
  snapshot(): PaymentLifecycleSnapshot;
}

class ProviderNeutralPaymentLifecycle implements PaymentLifecycle {
  readonly #input: PaymentLifecycleInput;
  readonly #provider: ClockedPaymentProviderAdapter;
  readonly #persistence?: PaymentLifecyclePersistence;
  readonly #operations = new Map<
    PaymentOperationKind,
    PaymentOperationSnapshot
  >();
  readonly #operationsByLogicalId = new Map<string, PaymentOperationSnapshot>();
  readonly #refunds: PaymentOperationSnapshot[] = [];
  readonly #movements: MoneyMovement[] = [];
  readonly #providerEvents = new Map<string, string>();
  readonly #providerRequestOwners = new Map<string, string>();
  readonly #movementOwners = new Map<string, string>();
  readonly #audits: PaymentAuditEntry[] = [];
  #operationSequence = 0;
  #refundedBookingPriceFils = 0;
  #refundedBookingServiceFeeFils = 0;
  #bookingCompleted = false;
  #paidFils = 0;
  #paidWhileBlocked = false;
  #recoveryExposureFils = 0;
  #recoveryBalanceFils = 0;
  #administratorHoldId: string | null = null;
  #dispute: PaymentDisputeSnapshot | null = null;

  constructor(
    input: PaymentLifecycleInput,
    provider: ClockedPaymentProviderAdapter,
    persistence?: PaymentLifecyclePersistence,
    restoredSnapshot?: PaymentLifecycleSnapshot,
  ) {
    this.#assertNonNegativeMoney(input.bookingPriceFils, "Booking Price");
    this.#exactCommission(input.bookingPriceFils);
    this.#assertNonNegativeMoney(
      input.bookingServiceFeeFils,
      "Booking Service Fee",
    );
    this.#assertNonNegativeMoney(input.providerFeeFils ?? 0, "provider fee");
    this.#assertNonNegativeMoney(
      input.providerReserveFils ?? 0,
      "provider reserve",
    );
    this.#input = Object.freeze({ ...input });
    this.#provider = provider;
    this.#persistence = persistence;
    if (restoredSnapshot) this.#restoreAuthorizationPhase(restoredSnapshot);
  }

  #restoreAuthorizationPhase(snapshot: PaymentLifecycleSnapshot): void {
    if (!isAuthorizationPhasePaymentSnapshot(snapshot, this.#input)) {
      throw new Error(
        "Stored Payment Lifecycle is not an authorization phase.",
      );
    }
    for (const operation of [snapshot.authorization, snapshot.release]) {
      if (!operation) continue;
      if (
        operation.paymentLifecycleId !== this.#input.paymentLifecycleId ||
        operation.amountFils !== this.#customerTotalFils() ||
        (operation.kind !== "authorization" && operation.kind !== "release")
      ) {
        throw new Error("Stored Payment Lifecycle operation is inconsistent.");
      }
      const restored = Object.freeze({
        ...operation,
        reconciliationRequired:
          operation.status === "pending"
            ? true
            : operation.reconciliationRequired,
      });
      this.#operations.set(operation.kind, restored);
      this.#operationsByLogicalId.set(operation.logicalOperationId, restored);
      if (operation.providerRequestId) {
        this.#providerRequestOwners.set(
          operation.providerRequestId,
          operation.attemptId,
        );
      }
      if (operation.movementReference) {
        this.#movementOwners.set(
          operation.movementReference,
          operation.attemptId,
        );
      }
      const sequence = operation.attemptId.match(/:attempt-(\d+)$/)?.[1];
      this.#operationSequence = Math.max(
        this.#operationSequence,
        sequence ? Number(sequence) : 0,
      );
    }
    this.#movements.push(
      ...snapshot.movements.map((movement) => Object.freeze({ ...movement })),
    );
  }

  async authorize(): Promise<PaymentOperationSnapshot> {
    if (this.#operations.has("authorization")) {
      throw new Error("Payment Authorization already exists.");
    }

    return this.#execute("authorization", this.#customerTotalFils());
  }

  async capture(amountFils: Fils): Promise<PaymentOperationSnapshot> {
    const authorization = this.#operations.get("authorization");
    if (authorization?.status !== "succeeded") {
      throw new Error(
        "Successful Payment Authorization is required before capture.",
      );
    }
    if (amountFils !== authorization.amountFils) {
      throw new Error(
        "Payment Capture must equal the exact full authorized Customer Total.",
      );
    }
    if (this.#operations.get("release")?.status === "succeeded") {
      throw new Error("Payment Authorization was already released.");
    }
    if (this.#operations.get("release")?.status === "pending") {
      throw new Error(
        "Authorization Release already exists and must be reconciled.",
      );
    }
    if (
      this.#operations.get("release")?.status === "failed" &&
      this.#operations.get("release")?.retrySafe
    ) {
      throw new Error(
        "Authorization Release failed safely and must be retried before capture.",
      );
    }
    if (this.#operations.has("capture")) {
      throw new Error("Payment Capture already exists.");
    }

    return this.#execute("capture", amountFils);
  }

  async release(amountFils: Fils): Promise<PaymentOperationSnapshot> {
    const authorization = this.#operations.get("authorization");
    if (authorization?.status !== "succeeded") {
      throw new Error(
        "Successful Payment Authorization is required before release.",
      );
    }
    if (amountFils !== authorization.amountFils) {
      throw new Error(
        "Authorization Release must equal the exact full uncaptured Customer Total.",
      );
    }
    if (this.#operations.get("capture")?.status === "succeeded") {
      throw new Error("Captured funds cannot be released.");
    }
    if (this.#operations.get("capture")?.status === "pending") {
      throw new Error("Payment Capture already exists and must be reconciled.");
    }
    if (this.#operations.has("release")) {
      throw new Error("Authorization Release already exists.");
    }

    return this.#execute("release", amountFils);
  }

  async refund(
    allocation: RefundAllocation,
  ): Promise<PaymentOperationSnapshot> {
    const amountFils = this.#validateRefundIntent(allocation);
    const refundNumber = this.#refunds.length + 1;
    const operation = await this.#execute(
      "refund",
      amountFils,
      `${this.#input.paymentLifecycleId}:refund-${refundNumber}`,
      allocation,
    );
    return operation;
  }

  async reconcile(
    logicalOperationId: string,
  ): Promise<PaymentOperationSnapshot> {
    const operation = this.#operationsByLogicalId.get(logicalOperationId);
    if (!operation) {
      throw new Error("Payment operation was not found for reconciliation.");
    }
    if (operation.status !== "pending" || !operation.reconciliationRequired) {
      throw new Error(
        "Only a reconciliation-required pending operation can be queried.",
      );
    }
    const result = await this.#provider.query({
      kind: operation.kind,
      paymentLifecycleId: this.#input.paymentLifecycleId,
      logicalOperationId: operation.logicalOperationId,
      attemptId: operation.attemptId,
      amountFils: operation.amountFils,
      currency: "IQD",
      providerRequestId: operation.providerRequestId,
      providerReference: operation.providerReference,
    });
    if (result.outcome === "not-executed") {
      if (operation.kind !== "release") {
        throw new Error("invalid_provider_reconciliation_result");
      }
      const notExecuted = Object.freeze({
        ...operation,
        status: "failed" as const,
        reconciliationRequired: false,
        retrySafe: true,
      });
      this.#operations.set(operation.kind, notExecuted);
      this.#operationsByLogicalId.set(
        operation.logicalOperationId,
        notExecuted,
      );
      await this.#persist();
      return notExecuted;
    }
    const settled = this.#applyResult(operation, result);
    await this.#persist();
    return settled;
  }

  async retry(logicalOperationId: string): Promise<PaymentOperationSnapshot> {
    const operation = this.#operationsByLogicalId.get(logicalOperationId);
    if (!operation || operation.status !== "failed") {
      throw new Error(
        "Retry is allowed only for a definitively failed operation.",
      );
    }
    if (!operation.retrySafe) {
      throw new Error("Provider has not proven this operation safe to retry.");
    }
    this.#validateRetryIntent(operation);

    const retried = await this.#execute(
      operation.kind,
      operation.amountFils,
      operation.logicalOperationId,
      operation.refundAllocation,
    );
    if (operation.kind === "refund") {
      const refundIndex = this.#refunds.findIndex(
        (refund) => refund.logicalOperationId === logicalOperationId,
      );
      if (refundIndex >= 0) {
        this.#refunds[refundIndex] = retried;
      }
    }
    return retried;
  }

  applyProviderEvent(event: unknown): ProviderEventApplication {
    if (!isSignedProviderEvent(event)) {
      return { status: "conflict", reason: "invalid_event" };
    }
    if (!this.#provider.verifySignedEvent(event)) {
      return { status: "conflict", reason: "invalid_signature" };
    }

    const eventFingerprint = JSON.stringify(event);
    const recordedFingerprint = this.#providerEvents.get(event.eventId);
    if (recordedFingerprint) {
      return recordedFingerprint === eventFingerprint
        ? { status: "duplicate" }
        : { status: "conflict", reason: "event_id_reused" };
    }

    const identityChecks: readonly [string, string, string][] = [
      ["provider", event.provider, this.#provider.identity.provider],
      ["environment", event.environment, this.#provider.identity.environment],
      ["merchantId", event.merchantId, this.#provider.identity.merchantId],
      ["terminalId", event.terminalId, this.#provider.identity.terminalId],
      ["currency", event.currency, "IQD"],
      [
        "paymentLifecycleId",
        event.paymentLifecycleId,
        this.#input.paymentLifecycleId,
      ],
    ];
    for (const [field, actual, expected] of identityChecks) {
      if (actual !== expected) {
        return { status: "conflict", reason: `correlation_mismatch:${field}` };
      }
    }

    const operation = this.#operationsByLogicalId.get(event.logicalOperationId);
    if (!operation) {
      return { status: "conflict", reason: "unknown_logical_operation" };
    }
    const operationChecks: readonly [
      string,
      string | number,
      string | number | null,
    ][] = [
      ["amountFils", event.amountFils, operation.amountFils],
      ["attemptId", event.attemptId, operation.attemptId],
      [
        "providerRequestId",
        event.providerRequestId,
        operation.providerRequestId,
      ],
      [
        "providerReference",
        event.providerReference,
        operation.providerReference,
      ],
      [
        "movementReference",
        event.movementReference,
        operation.movementReference,
      ],
    ];
    for (const [field, actual, expected] of operationChecks) {
      if (actual !== expected) {
        return { status: "conflict", reason: `correlation_mismatch:${field}` };
      }
    }

    if (operation.status !== "pending" || !operation.reconciliationRequired) {
      const matchingMovement = this.#movements.some(
        (movement) =>
          movement.logicalOperationId === operation.logicalOperationId &&
          movement.movementReference === event.movementReference,
      );
      return matchingMovement && event.outcome === "succeeded"
        ? { status: "duplicate" }
        : { status: "conflict", reason: "late_incompatible_evidence" };
    }

    const movementOwner = this.#movements.find(
      (movement) => movement.movementReference === event.movementReference,
    );
    if (
      movementOwner &&
      movementOwner.logicalOperationId !== operation.logicalOperationId
    ) {
      return { status: "conflict", reason: "movement_identity_reused" };
    }

    const result: ProviderOperationResult =
      event.outcome === "succeeded"
        ? {
            outcome: "succeeded",
            providerRequestId: event.providerRequestId,
            providerReference: event.providerReference,
            movementReference: event.movementReference,
          }
        : {
            outcome: "failed",
            providerRequestId: event.providerRequestId,
            providerReference: event.providerReference,
            retrySafe: event.retrySafe,
          };
    this.#applyResult(operation, result);
    this.#providerEvents.set(event.eventId, eventFingerprint);
    return { status: "applied" };
  }

  markBookingCompleted(): void {
    if (this.#operations.get("capture")?.status !== "succeeded") {
      throw new Error(
        "Successful Payment Capture is required before completion.",
      );
    }
    this.#bookingCompleted = true;
  }

  async settle(): Promise<PaymentOperationSnapshot> {
    if (!this.#bookingCompleted) {
      throw new Error("Owner Payout requires Booking Period completion.");
    }
    if (this.#operations.has("settlement")) {
      throw new Error("Owner Payout settlement already exists.");
    }
    if (this.#hasActiveHold()) {
      throw new Error("Owner Payout is blocked by an active hold.");
    }
    if (this.#refunds.some((refund) => refund.status !== "succeeded")) {
      throw new Error(
        "Owner Payout is blocked by an unresolved refund operation.",
      );
    }
    const ownerEntitlementFils = this.#financials().ownerEntitlementFils;
    if (ownerEntitlementFils <= 0) {
      throw new Error("No positive Owner Payout remains to settle.");
    }
    return this.#execute("settlement", ownerEntitlementFils);
  }

  placeAdministratorHold(holdId: string): void {
    if (!holdId) throw new Error("Administrator hold identity is required.");
    if (this.#administratorHoldId) {
      throw new Error("An administrator hold is already active.");
    }
    this.#administratorHoldId = holdId;
  }

  clearAdministratorHold(holdId: string): void {
    if (this.#administratorHoldId !== holdId) {
      throw new Error(
        "Administrator hold identity does not match the active hold.",
      );
    }
    this.#administratorHoldId = null;
  }

  openDispute(disputeId: string): void {
    if (this.#operations.get("capture")?.status !== "succeeded") {
      throw new Error(
        "Successful Payment Capture is required before a dispute.",
      );
    }
    if (this.#dispute && this.#dispute.status !== "resolved") {
      throw new Error("A Payment Dispute is already open.");
    }
    this.#dispute = Object.freeze({
      disputeId,
      status: "open",
      outcome: null,
      refundAllocation: null,
      refundLogicalOperationId: null,
    });
  }

  async resolveDispute(
    outcome: PaymentDisputeOutcome,
    allocation?: RefundAllocation,
  ): Promise<PaymentOperationSnapshot | null> {
    if (!this.#dispute) {
      throw new Error("An open Payment Dispute is required before resolution.");
    }
    if (this.#dispute.status !== "open") {
      const sameAllocation =
        this.#dispute.refundAllocation?.bookingPriceFils ===
          allocation?.bookingPriceFils &&
        this.#dispute.refundAllocation?.bookingServiceFeeFils ===
          allocation?.bookingServiceFeeFils;
      if (
        outcome !== this.#dispute.outcome ||
        (outcome === "partial_customer_award" && !sameAllocation) ||
        (outcome !== "partial_customer_award" && allocation !== undefined)
      ) {
        throw new Error(
          "Dispute resolution does not match the bound outcome and allocation.",
        );
      }
      return this.#dispute.refundLogicalOperationId
        ? (this.#operationsByLogicalId.get(
            this.#dispute.refundLogicalOperationId,
          ) ?? null)
        : null;
    }

    if (outcome === "owner_won") {
      if (allocation) {
        throw new Error(
          "An owner-won dispute cannot include a customer refund allocation.",
        );
      }
      this.#dispute = Object.freeze({
        disputeId: this.#dispute.disputeId,
        status: "resolved",
        outcome,
        refundAllocation: null,
        refundLogicalOperationId: null,
      });
      return null;
    }
    if (outcome === "partial_customer_award" && !allocation) {
      throw new Error(
        "A partial dispute outcome requires an explicit refund allocation.",
      );
    }
    const financials = this.#financials();
    const appliedAllocation = Object.freeze(
      outcome === "customer_won"
        ? {
            bookingPriceFils: financials.remainingBookingPriceFils,
            bookingServiceFeeFils: financials.remainingBookingServiceFeeFils,
          }
        : { ...allocation! },
    );
    const amountFils = this.#validateRefundIntent(appliedAllocation);
    const refundLogicalOperationId = `${this.#input.paymentLifecycleId}:refund-${this.#refunds.length + 1}`;

    this.#dispute = Object.freeze({
      disputeId: this.#dispute.disputeId,
      status: "resolving",
      outcome,
      refundAllocation: appliedAllocation,
      refundLogicalOperationId,
    });
    const refundOperation = await this.#execute(
      "refund",
      amountFils,
      refundLogicalOperationId,
      appliedAllocation,
    );
    return refundOperation;
  }

  snapshot(): PaymentLifecycleSnapshot {
    const snapshot: PaymentLifecycleSnapshot = {
      paymentLifecycleId: this.#input.paymentLifecycleId,
      currency: "IQD",
      bookingPriceFils: this.#input.bookingPriceFils,
      bookingServiceFeeFils: this.#input.bookingServiceFeeFils,
      customerTotalFils: this.#customerTotalFils(),
      authorization: this.#copyOperation("authorization"),
      capture: this.#copyOperation("capture"),
      release: this.#copyOperation("release"),
      refunds: Object.freeze(
        this.#refunds.map((refund) => Object.freeze({ ...refund })),
      ),
      financials: Object.freeze(this.#financials()),
      payout: Object.freeze({
        status: this.#payoutStatus(),
        eligibleFils: this.#financials().ownerEntitlementFils,
        paidFils: this.#paidFils,
        providerFeeFils: this.#input.providerFeeFils ?? 0,
        providerReserveFils: this.#input.providerReserveFils ?? 0,
        recoveryExposureFils: this.#recoveryExposureFils,
        recoveryBalanceFils: this.#recoveryBalanceFils,
        automaticOwnerDebitFils: 0,
        paidWhileBlocked: this.#paidWhileBlocked,
        settlement: this.#copyOperation("settlement"),
      }),
      holds: Object.freeze({
        administrator: this.#administratorHoldId !== null,
        dispute: this.#dispute !== null && this.#dispute.status !== "resolved",
      }),
      dispute: this.#dispute ? Object.freeze({ ...this.#dispute }) : null,
      audits: Object.freeze(
        this.#audits.map((entry) => Object.freeze({ ...entry })),
      ),
      movements: Object.freeze(
        this.#movements.map((movement) => Object.freeze({ ...movement })),
      ),
    };

    return Object.freeze(snapshot);
  }

  async #execute(
    kind: PaymentOperationKind,
    amountFils: Fils,
    logicalOperationId = `${this.#input.paymentLifecycleId}:${kind}`,
    refundAllocation?: RefundAllocation,
  ): Promise<PaymentOperationSnapshot> {
    this.#operationSequence += 1;
    const attemptId = `${logicalOperationId}:attempt-${this.#operationSequence}`;
    const pending: PaymentOperationSnapshot = {
      paymentLifecycleId: this.#input.paymentLifecycleId,
      kind,
      logicalOperationId,
      attemptId,
      status: "pending",
      amountFils,
      providerRequestId: null,
      providerReference: null,
      movementReference: null,
      reconciliationRequired: false,
      retrySafe: false,
      ...(refundAllocation
        ? { refundAllocation: Object.freeze({ ...refundAllocation }) }
        : {}),
    };
    this.#operations.set(kind, pending);
    this.#operationsByLogicalId.set(logicalOperationId, pending);
    if (
      kind === "refund" &&
      !this.#refunds.some(
        (refund) => refund.logicalOperationId === logicalOperationId,
      )
    ) {
      this.#refunds.push(Object.freeze({ ...pending }));
    }

    const executionPermit = await this.#persist();

    let result: ProviderOperationResult;
    try {
      result = await this.#provider.execute({
        kind,
        paymentLifecycleId: this.#input.paymentLifecycleId,
        logicalOperationId,
        attemptId,
        amountFils,
        currency: "IQD",
        executionPermit: executionPermit ?? null,
      });
    } catch {
      const indeterminate = Object.freeze({
        ...pending,
        reconciliationRequired: true,
      });
      this.#operations.set(kind, indeterminate);
      this.#operationsByLogicalId.set(logicalOperationId, indeterminate);
      if (kind === "refund") {
        const refundIndex = this.#refunds.findIndex(
          (refund) => refund.logicalOperationId === logicalOperationId,
        );
        if (refundIndex >= 0) this.#refunds[refundIndex] = indeterminate;
      }
      await this.#persist();
      return indeterminate;
    }
    if (result.outcome === "not-executed") {
      const notExecuted = Object.freeze({
        ...pending,
        status: "failed" as const,
        retrySafe:
          kind === "release" &&
          (executionPermit?.purpose === "booking-request-release" ||
            executionPermit?.purpose === "booking-request-submission-cleanup"),
      });
      this.#operations.set(kind, notExecuted);
      this.#operationsByLogicalId.set(logicalOperationId, notExecuted);
      if (kind === "refund") {
        const refundIndex = this.#refunds.findIndex(
          (refund) => refund.logicalOperationId === logicalOperationId,
        );
        if (refundIndex >= 0) this.#refunds[refundIndex] = notExecuted;
      }
      await this.#persist();
      throw new ProviderExecutionNotStartedError();
    }
    const settled = this.#applyResult(pending, result);
    await this.#persist();
    return settled;
  }

  async #persist(): Promise<ProviderExecutionPermit | undefined> {
    const result = await this.#persistence?.save(this.snapshot());
    return result ?? undefined;
  }

  #applyResult(
    operation: PaymentOperationSnapshot,
    result: Exclude<ProviderOperationResult, { outcome: "not-executed" }>,
  ): PaymentOperationSnapshot {
    const providerRequestOwner = this.#providerRequestOwners.get(
      result.providerRequestId,
    );
    if (providerRequestOwner && providerRequestOwner !== operation.attemptId) {
      this.#markReconciliationRequired(operation);
      throw new Error("provider_request_identity_conflict");
    }
    const movementReference =
      result.outcome === "failed"
        ? null
        : "movementReference" in result
          ? result.movementReference
          : null;
    const movementOwner = movementReference
      ? this.#movementOwners.get(movementReference)
      : null;
    if (movementOwner && movementOwner !== operation.attemptId) {
      this.#markReconciliationRequired(operation);
      throw new Error("movement_identity_conflict");
    }
    this.#providerRequestOwners.set(
      result.providerRequestId,
      operation.attemptId,
    );
    if (movementReference) {
      this.#movementOwners.set(movementReference, operation.attemptId);
    }

    const settled: PaymentOperationSnapshot = Object.freeze({
      ...operation,
      status:
        result.outcome === "failed"
          ? "failed"
          : result.outcome === "succeeded"
            ? "succeeded"
            : "pending",
      providerRequestId: result.providerRequestId,
      providerReference: result.providerReference,
      movementReference:
        result.outcome === "failed"
          ? null
          : (movementReference ?? operation.movementReference),
      reconciliationRequired: result.outcome === "indeterminate",
      retrySafe: result.outcome === "failed" && result.retrySafe,
    });
    this.#operations.set(operation.kind, settled);
    this.#operationsByLogicalId.set(operation.logicalOperationId, settled);
    if (operation.kind === "refund") {
      const refundIndex = this.#refunds.findIndex(
        (refund) => refund.logicalOperationId === operation.logicalOperationId,
      );
      if (refundIndex >= 0) this.#refunds[refundIndex] = settled;
    }

    if (result.outcome === "succeeded") {
      const movementAlreadyRecorded = this.#movements.some(
        (movement) => movement.movementReference === result.movementReference,
      );
      if (!movementAlreadyRecorded) {
        this.#movements.push(
          Object.freeze({
            kind: operation.kind,
            logicalOperationId: operation.logicalOperationId,
            attemptId: operation.attemptId,
            amountFils: operation.amountFils,
            movementReference: result.movementReference,
            recordedAt: this.#provider.now?.() ?? new Date().toISOString(),
            ...(operation.refundAllocation
              ? {
                  refundAllocation: Object.freeze({
                    ...operation.refundAllocation,
                  }),
                }
              : {}),
          }),
        );
        if (operation.kind === "refund" && operation.refundAllocation) {
          this.#refundedBookingPriceFils +=
            operation.refundAllocation.bookingPriceFils;
          this.#refundedBookingServiceFeeFils +=
            operation.refundAllocation.bookingServiceFeeFils;
          this.#refreshRecoveryBalance();
        }
      }
      if (operation.kind === "settlement" && this.#paidFils === 0) {
        this.#paidFils = operation.amountFils;
        if (this.#hasActiveHold()) {
          this.#paidWhileBlocked = true;
          this.#recoveryExposureFils = Math.max(
            this.#recoveryExposureFils,
            operation.amountFils,
          );
          this.#recoveryBalanceFils = operation.amountFils;
          this.#audits.push(
            Object.freeze({
              kind: "settlement_paid_while_blocked",
              amountFils: operation.amountFils,
              logicalOperationId: operation.logicalOperationId,
              recordedAt: this.#provider.now?.() ?? new Date().toISOString(),
            }),
          );
        }
      }
    }

    this.#finalizeDisputeRefund(settled);

    return Object.freeze({ ...settled });
  }

  #markReconciliationRequired(operation: PaymentOperationSnapshot): void {
    const reconciling: PaymentOperationSnapshot = Object.freeze({
      ...operation,
      status: "pending",
      reconciliationRequired: true,
      retrySafe: false,
    });
    this.#operations.set(operation.kind, reconciling);
    this.#operationsByLogicalId.set(operation.logicalOperationId, reconciling);
    if (operation.kind === "refund") {
      const refundIndex = this.#refunds.findIndex(
        (refund) => refund.logicalOperationId === operation.logicalOperationId,
      );
      if (refundIndex >= 0) this.#refunds[refundIndex] = reconciling;
    }
  }

  #copyOperation(kind: PaymentOperationKind): PaymentOperationSnapshot | null {
    const operation = this.#operations.get(kind);
    return operation ? Object.freeze({ ...operation }) : null;
  }

  #customerTotalFils(): Fils {
    const customerTotalFils =
      this.#input.bookingPriceFils + this.#input.bookingServiceFeeFils;
    if (!Number.isSafeInteger(customerTotalFils)) {
      throw new Error("Customer Total must be safe integer fils.");
    }
    return customerTotalFils;
  }

  #financials() {
    const remainingBookingPriceFils =
      this.#input.bookingPriceFils - this.#refundedBookingPriceFils;
    const remainingBookingServiceFeeFils =
      this.#input.bookingServiceFeeFils - this.#refundedBookingServiceFeeFils;
    const marketplaceCommissionFils = this.#exactCommission(
      remainingBookingPriceFils,
    );
    return {
      refundedBookingPriceFils: this.#refundedBookingPriceFils,
      refundedBookingServiceFeeFils: this.#refundedBookingServiceFeeFils,
      remainingBookingPriceFils,
      remainingBookingServiceFeeFils,
      marketplaceCommissionFils,
      ownerEntitlementFils:
        remainingBookingPriceFils - marketplaceCommissionFils,
    };
  }

  #exactCommission(remainingBookingPriceFils: Fils): Fils {
    if (remainingBookingPriceFils % 10 !== 0) {
      throw new Error("10% Marketplace Commission must be exact in fils.");
    }
    return remainingBookingPriceFils / 10;
  }

  #assertRefundAmount(amountFils: Fils, name: string): void {
    if (!Number.isSafeInteger(amountFils) || amountFils < 0) {
      throw new Error(
        `${name} refund allocation must be non-negative safe integer fils.`,
      );
    }
  }

  #validateRefundIntent(allocation: RefundAllocation): Fils {
    if (this.#operations.get("capture")?.status !== "succeeded") {
      throw new Error("Successful Payment Capture is required before refund.");
    }
    if (this.#operations.get("settlement")?.status === "pending") {
      throw new Error("Pending Owner Payout must be reconciled before refund.");
    }
    this.#assertRefundAmount(allocation.bookingPriceFils, "Booking Price");
    this.#assertRefundAmount(
      allocation.bookingServiceFeeFils,
      "Booking Service Fee",
    );
    const amountFils =
      allocation.bookingPriceFils + allocation.bookingServiceFeeFils;
    if (amountFils === 0) {
      throw new Error("Refund must return a positive amount.");
    }
    const reservedRefunds = this.#refunds.reduce(
      (reserved, refund) => {
        if (refund.status === "failed" || !refund.refundAllocation) {
          return reserved;
        }
        return {
          bookingPriceFils:
            reserved.bookingPriceFils +
            refund.refundAllocation.bookingPriceFils,
          bookingServiceFeeFils:
            reserved.bookingServiceFeeFils +
            refund.refundAllocation.bookingServiceFeeFils,
        };
      },
      { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
    );
    const remainingBookingPriceFils =
      this.#input.bookingPriceFils - reservedRefunds.bookingPriceFils;
    const remainingBookingServiceFeeFils =
      this.#input.bookingServiceFeeFils - reservedRefunds.bookingServiceFeeFils;
    if (allocation.bookingPriceFils > remainingBookingPriceFils) {
      throw new Error("Refund allocation exceeds the remaining Booking Price.");
    }
    if (allocation.bookingServiceFeeFils > remainingBookingServiceFeeFils) {
      throw new Error(
        "Refund allocation exceeds the remaining Booking Service Fee.",
      );
    }
    this.#exactCommission(
      remainingBookingPriceFils - allocation.bookingPriceFils,
    );
    return amountFils;
  }

  #validateRetryIntent(operation: PaymentOperationSnapshot): void {
    const authorization = this.#operations.get("authorization");
    if (operation.kind === "authorization") {
      if (operation.amountFils !== this.#customerTotalFils()) {
        throw new Error("Payment Authorization retry intent is stale.");
      }
      return;
    }
    if (operation.kind === "capture") {
      if (
        authorization?.status !== "succeeded" ||
        operation.amountFils !== authorization.amountFils
      ) {
        throw new Error("Payment Capture retry intent is stale.");
      }
      if (this.#operations.has("release")) {
        throw new Error(
          "Payment Capture retry is no longer valid after Authorization Release.",
        );
      }
      return;
    }
    if (operation.kind === "release") {
      if (
        authorization?.status !== "succeeded" ||
        operation.amountFils !== authorization.amountFils
      ) {
        throw new Error("Authorization Release retry intent is stale.");
      }
      const capture = this.#operations.get("capture");
      if (capture?.status === "succeeded" || capture?.status === "pending") {
        throw new Error(
          "Authorization Release retry is blocked by Payment Capture.",
        );
      }
      return;
    }
    if (operation.kind === "refund") {
      if (!operation.refundAllocation) {
        throw new Error("Refund retry requires its stored allocation.");
      }
      this.#validateRefundIntent(operation.refundAllocation);
      return;
    }
    if (!this.#bookingCompleted) {
      throw new Error("Owner Payout retry requires Booking Period completion.");
    }
    if (this.#hasActiveHold()) {
      throw new Error("Owner Payout retry is blocked by an active hold.");
    }
    if (this.#refunds.some((refund) => refund.status !== "succeeded")) {
      throw new Error(
        "Owner Payout retry is blocked by an unresolved refund operation.",
      );
    }
    const ownerEntitlementFils = this.#financials().ownerEntitlementFils;
    if (ownerEntitlementFils <= 0) {
      throw new Error("No positive Owner Payout remains to retry.");
    }
    if (operation.amountFils !== ownerEntitlementFils) {
      throw new Error(
        "Owner Payout retry stored amount no longer matches Owner Entitlement.",
      );
    }
  }

  #assertNonNegativeMoney(amountFils: Fils, name: string): void {
    if (!Number.isSafeInteger(amountFils) || amountFils < 0) {
      throw new Error(`${name} must be non-negative safe integer fils.`);
    }
  }

  #payoutStatus() {
    const settlement = this.#operations.get("settlement");
    if (this.#paidFils > 0) return "paid" as const;
    if (this.#hasActiveHold()) return "blocked" as const;
    if (settlement?.status === "pending") return "pending" as const;
    if (settlement?.status === "failed") return "failed" as const;
    if (this.#financials().ownerEntitlementFils === 0) {
      return "not_eligible" as const;
    }
    return this.#bookingCompleted
      ? ("eligible" as const)
      : ("not_eligible" as const);
  }

  #hasActiveHold(): boolean {
    return (
      this.#administratorHoldId !== null ||
      (this.#dispute !== null && this.#dispute.status !== "resolved")
    );
  }

  #finalizeDisputeRefund(operation: PaymentOperationSnapshot): void {
    if (
      this.#dispute?.status !== "resolving" ||
      operation.status !== "succeeded" ||
      operation.logicalOperationId !== this.#dispute.refundLogicalOperationId
    ) {
      return;
    }
    this.#dispute = Object.freeze({
      ...this.#dispute,
      status: "resolved",
    });
  }

  #refreshRecoveryBalance(): void {
    if (this.#paidFils === 0) return;
    this.#recoveryBalanceFils = Math.max(
      this.#paidFils - this.#financials().ownerEntitlementFils,
      0,
    );
    this.#recoveryExposureFils = Math.max(
      this.#recoveryExposureFils,
      this.#recoveryBalanceFils,
    );
  }
}

export function createPaymentLifecycle(
  input: PaymentLifecycleInput,
  provider: ClockedPaymentProviderAdapter,
  persistence?: PaymentLifecyclePersistence,
): PaymentLifecycle {
  return new ProviderNeutralPaymentLifecycle(input, provider, persistence);
}

export function rehydratePaymentAuthorizationLifecycle(
  input: PaymentLifecycleInput,
  provider: ClockedPaymentProviderAdapter,
  snapshot: PaymentLifecycleSnapshot,
  persistence?: PaymentLifecyclePersistence,
): PaymentLifecycle {
  return new ProviderNeutralPaymentLifecycle(
    input,
    provider,
    persistence,
    snapshot,
  );
}

function isSignedProviderEvent(event: unknown): event is SignedProviderEvent {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  const candidate = event as Record<string, unknown>;
  const stringFields = [
    "provider",
    "environment",
    "merchantId",
    "terminalId",
    "eventId",
    "currency",
    "paymentLifecycleId",
    "logicalOperationId",
    "attemptId",
    "providerRequestId",
    "providerReference",
    "movementReference",
    "occurredAt",
    "signature",
  ] as const;
  return (
    stringFields.every(
      (field) =>
        typeof candidate[field] === "string" && candidate[field].length > 0,
    ) &&
    (candidate.outcome === "succeeded" || candidate.outcome === "failed") &&
    Number.isSafeInteger(candidate.amountFils) &&
    (candidate.amountFils as number) >= 0 &&
    typeof candidate.retrySafe === "boolean"
  );
}
