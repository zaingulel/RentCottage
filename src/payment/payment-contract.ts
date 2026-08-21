export type Fils = number;

export type PaymentOperationKind =
  | "authorization"
  | "capture"
  | "release"
  | "refund"
  | "settlement";

export type PaymentOperationStatus = "pending" | "succeeded" | "failed";

export type ProviderOutcome = "succeeded" | "failed" | "indeterminate";

export interface ProviderExecutionPermit {
  readonly claimId: string;
  readonly generation: number;
  readonly idempotencyKey: string;
  readonly notAfter: string;
}

export interface ProviderOperationRequest {
  readonly kind: PaymentOperationKind;
  readonly paymentLifecycleId: string;
  readonly logicalOperationId: string;
  readonly attemptId: string;
  readonly amountFils: Fils;
  readonly currency: "IQD";
  readonly executionPermit: ProviderExecutionPermit | null;
}

export type ProviderOperationResult =
  | {
      readonly outcome: "not-executed";
    }
  | {
      readonly outcome: "succeeded";
      readonly providerRequestId: string;
      readonly providerReference: string;
      readonly movementReference: string;
    }
  | {
      readonly outcome: "failed";
      readonly providerRequestId: string;
      readonly providerReference: string;
      readonly retrySafe: boolean;
    }
  | {
      readonly outcome: "indeterminate";
      readonly providerRequestId: string;
      readonly providerReference: string;
      readonly movementReference: string;
    };

export interface PaymentProviderIdentity {
  readonly provider: string;
  readonly environment: string;
  readonly merchantId: string;
  readonly terminalId: string;
}

export interface SignedProviderEvent extends PaymentProviderIdentity {
  readonly eventId: string;
  readonly outcome: "succeeded" | "failed";
  readonly currency: string;
  readonly amountFils: Fils;
  readonly paymentLifecycleId: string;
  readonly logicalOperationId: string;
  readonly attemptId: string;
  readonly providerRequestId: string;
  readonly providerReference: string;
  readonly movementReference: string;
  readonly occurredAt: string;
  readonly retrySafe: boolean;
  readonly signature: string;
}

export type ProviderEventApplication =
  | { readonly status: "applied" }
  | { readonly status: "duplicate" }
  | { readonly status: "conflict"; readonly reason: string };

export interface PaymentProviderAdapter {
  readonly identity: PaymentProviderIdentity;
  execute(request: ProviderOperationRequest): Promise<ProviderOperationResult>;
  query(request: ProviderReconciliationQuery): Promise<ProviderOperationResult>;
  verifySignedEvent(event: SignedProviderEvent): boolean;
}

export interface ProviderReconciliationQuery extends ProviderOperationRequest {
  readonly providerRequestId: string | null;
  readonly providerReference: string | null;
}

export interface PaymentOperationSnapshot {
  readonly paymentLifecycleId: string;
  readonly kind: PaymentOperationKind;
  readonly logicalOperationId: string;
  readonly attemptId: string;
  readonly status: PaymentOperationStatus;
  readonly amountFils: Fils;
  readonly providerRequestId: string | null;
  readonly providerReference: string | null;
  readonly movementReference: string | null;
  readonly reconciliationRequired: boolean;
  readonly retrySafe: boolean;
  readonly refundAllocation?: RefundAllocation;
}

export interface RefundAllocation {
  readonly bookingPriceFils: Fils;
  readonly bookingServiceFeeFils: Fils;
}

export interface MoneyMovement {
  readonly kind: PaymentOperationKind;
  readonly logicalOperationId: string;
  readonly attemptId: string;
  readonly amountFils: Fils;
  readonly movementReference: string;
  readonly recordedAt: string;
  readonly refundAllocation?: RefundAllocation;
}

export interface PaymentFinancials {
  readonly refundedBookingPriceFils: Fils;
  readonly refundedBookingServiceFeeFils: Fils;
  readonly remainingBookingPriceFils: Fils;
  readonly remainingBookingServiceFeeFils: Fils;
  readonly marketplaceCommissionFils: Fils;
  readonly ownerEntitlementFils: Fils;
}

export type PayoutStatus =
  | "not_eligible"
  | "eligible"
  | "blocked"
  | "pending"
  | "failed"
  | "paid";

export interface PaymentPayoutSnapshot {
  readonly status: PayoutStatus;
  readonly eligibleFils: Fils;
  readonly paidFils: Fils;
  readonly providerFeeFils: Fils;
  readonly providerReserveFils: Fils;
  readonly recoveryExposureFils: Fils;
  readonly recoveryBalanceFils: Fils;
  readonly automaticOwnerDebitFils: 0;
  readonly paidWhileBlocked: boolean;
  readonly settlement: PaymentOperationSnapshot | null;
}

export type PaymentDisputeOutcome =
  | "owner_won"
  | "customer_won"
  | "partial_customer_award";

export interface PaymentDisputeSnapshot {
  readonly disputeId: string;
  readonly status: "open" | "resolving" | "resolved";
  readonly outcome: PaymentDisputeOutcome | null;
  readonly refundAllocation: RefundAllocation | null;
  readonly refundLogicalOperationId: string | null;
}

export interface PaymentAuditEntry {
  readonly kind: "settlement_paid_while_blocked";
  readonly amountFils: Fils;
  readonly logicalOperationId: string;
  readonly recordedAt: string;
}

export interface PaymentLifecycleSnapshot {
  readonly paymentLifecycleId: string;
  readonly currency: "IQD";
  readonly bookingPriceFils: Fils;
  readonly bookingServiceFeeFils: Fils;
  readonly customerTotalFils: Fils;
  readonly authorization: PaymentOperationSnapshot | null;
  readonly capture: PaymentOperationSnapshot | null;
  readonly release: PaymentOperationSnapshot | null;
  readonly refunds: readonly PaymentOperationSnapshot[];
  readonly financials: PaymentFinancials;
  readonly payout: PaymentPayoutSnapshot;
  readonly holds: {
    readonly administrator: boolean;
    readonly dispute: boolean;
  };
  readonly dispute: PaymentDisputeSnapshot | null;
  readonly audits: readonly PaymentAuditEntry[];
  readonly movements: readonly MoneyMovement[];
}

export function iqdToFils(iqd: number): Fils {
  if (!Number.isSafeInteger(iqd)) {
    throw new Error("Payment prices must be whole IQD.");
  }

  const fils = iqd * 1_000;
  if (!Number.isSafeInteger(fils)) {
    throw new Error("Payment price must convert to safe integer fils.");
  }

  return fils;
}
