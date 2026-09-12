import { exactMarketplaceCommission } from "@/payment/payment-refund-allocation";
import type { RefundAllocation } from "@/payment/payment-contract";

export type BookingPayoutAction =
  | "place_hold"
  | "release_hold"
  | "open_dispute"
  | "resolve_dispute";
export type BookingDisputeOutcome =
  | "owner_won"
  | "customer_won"
  | "partial_customer_award";
export interface BookingPayoutCommand {
  readonly bookingRequestId: string;
  readonly commandId: string;
  readonly action: BookingPayoutAction;
  readonly reason: string;
  readonly subjectId?: string;
  readonly outcome?: BookingDisputeOutcome;
  readonly allocation?: RefundAllocation;
}
export interface BookingPayoutReceipt {
  readonly status: "recorded";
  readonly bookingRequestId: string;
  readonly commandId: string;
  readonly occurredAt: string;
}
export interface BookingPayoutFacts {
  readonly bookingRequestId: string;
  readonly captured: RefundAllocation;
  readonly refunded: RefundAllocation;
  readonly reserved: RefundAllocation;
  readonly activeHoldIds: readonly string[];
  readonly activeDisputeIds: readonly string[];
  readonly commands: readonly {
    readonly commandId: string;
    readonly action: BookingPayoutAction;
    readonly subjectId: string | null;
    readonly outcome: BookingDisputeOutcome | null;
    readonly allocation: RefundAllocation | null;
    readonly actorUserId: string;
    readonly reason: string;
    readonly occurredAt: string;
  }[];
  readonly disputes: readonly {
    readonly id: string;
    readonly resolutionId: string | null;
    readonly refundIntentId: string | null;
    readonly state: "open" | "resolving" | "resolved";
  }[];
}
export interface BookingPayoutRepository {
  facts(bookingRequestId: string): Promise<BookingPayoutFacts>;
  record(command: BookingPayoutCommand): Promise<BookingPayoutReceipt>;
}
export function createBookingPayout(repository: BookingPayoutRepository) {
  return {
    async record(command: BookingPayoutCommand): Promise<BookingPayoutReceipt> {
      if (command.outcome !== "customer_won") return repository.record(command);
      const facts = await repository.facts(command.bookingRequestId);
      if (facts.bookingRequestId !== command.bookingRequestId)
        throw new Error("Payout facts belong to another booking.");
      return repository.record({
        ...command,
        allocation: facts.commands.find(
          (prior) => prior.commandId === command.commandId,
        )?.allocation ?? {
          bookingPriceFils:
            facts.captured.bookingPriceFils - facts.refunded.bookingPriceFils,
          bookingServiceFeeFils:
            facts.captured.bookingServiceFeeFils -
            facts.refunded.bookingServiceFeeFils,
        },
      });
    },
  };
}

export type BookingPayoutRecovery =
  | { readonly status: "unsettled" | "unavailable" }
  | {
      readonly status: "paid";
      readonly ownerEntitlementFils: number;
      readonly paidFils: number;
      readonly paidWhileBlocked: boolean;
      readonly recoveryExposureFils: number;
      readonly recoveryBalanceFils: number;
      readonly automaticOwnerDebitFils: 0;
    };
export interface BookingSettlementFacts extends BookingPayoutFacts {
  readonly revision: string;
  readonly recovery: BookingPayoutRecovery;
  readonly maturity: import("./booking-lifecycle").BookingCompletionEligibility;
  readonly intents: import("./booking-refund").BookingRefundFacts["intents"];
  readonly settlement: null | {
    readonly id: string;
    readonly commandId: string;
    readonly amountFils: number;
    readonly state:
      | "requested"
      | "processing"
      | "indeterminate"
      | "succeeded"
      | "failed"
      | "not-executed";
    readonly retrySafe: boolean;
    readonly actorUserId: string;
    readonly reason: string;
    readonly requestedAt: string;
    readonly receipt: null | {
      readonly observationId: string;
      readonly historySequence: number;
      readonly recordedAt: string;
      readonly activeHoldIds: readonly string[];
      readonly activeDisputeIds: readonly string[];
    };
  };
}
export interface BookingSettlementCommand {
  readonly bookingRequestId: string;
  readonly commandId: string;
  readonly reason: string;
}
export type BookingSettlementClaim =
  | {
      readonly status: "execute";
      readonly request: import("@/payment/payment-contract").ProviderOperationRequest;
    }
  | {
      readonly status: "query";
      readonly query: import("@/payment/payment-contract").ProviderReconciliationQuery;
    }
  | {
      readonly status:
        | "processing"
        | "settled"
        | "blocked"
        | "attention-required";
    };
export interface BookingSettlementRepository {
  facts(bookingRequestId: string): Promise<BookingSettlementFacts>;
  request(
    command: BookingSettlementCommand,
    revision: string,
    amountFils: number,
  ): Promise<
    | { readonly status: "requested"; readonly intentId: string }
    | { readonly status: "stale" }
  >;
  claim(intentId: string): Promise<BookingSettlementClaim>;
}
export interface BookingSettlementResult {
  readonly status: "settled" | "blocked" | "attention-required" | "processing";
}
export function selectBookingSettlement(
  facts: BookingSettlementFacts,
):
  | { readonly action: "request"; readonly amountFils: number }
  | { readonly action: "process"; readonly intentId: string }
  | { readonly action: "settled" | "blocked" | "attention-required" } {
  const settlement = facts.settlement;
  if (settlement?.state === "succeeded") return { action: "settled" };
  // An admitted operation remains queryable when a later hold blocks new execution.
  if (
    settlement &&
    (settlement.state === "processing" || settlement.state === "indeterminate")
  )
    return { action: "process", intentId: settlement.id };
  if (settlement?.state === "failed" && !settlement.retrySafe)
    return { action: "attention-required" };
  if (
    !facts.maturity.payoutPrerequisiteAvailable ||
    facts.activeHoldIds.length ||
    facts.activeDisputeIds.length
  )
    return { action: "blocked" };
  if (facts.intents.some((intent) => intent.state === "failed"))
    return { action: "attention-required" };
  if (
    facts.reserved.bookingPriceFils + facts.reserved.bookingServiceFeeFils >
      0 ||
    facts.intents.some((intent) => intent.state !== "succeeded")
  )
    return { action: "blocked" };
  const remaining =
    facts.captured.bookingPriceFils - facts.refunded.bookingPriceFils;
  const amountFils = remaining - exactMarketplaceCommission(remaining);
  if (amountFils <= 0) return { action: "blocked" };
  if (settlement)
    return settlement.amountFils === amountFils
      ? { action: "process", intentId: settlement.id }
      : { action: "attention-required" };
  return { action: "request", amountFils };
}
export function createBookingSettlement({
  repository,
  operations,
}: {
  repository: BookingSettlementRepository;
  operations: import("@/payment/payment-operation-execution").PaymentOperationExecution;
}) {
  return {
    async settle(
      command: BookingSettlementCommand,
    ): Promise<BookingSettlementResult> {
      let commandChecked = false;
      for (let progress = 0; progress < 8; progress += 1) {
        const facts = await repository.facts(command.bookingRequestId);
        if (facts.bookingRequestId !== command.bookingRequestId)
          throw new Error("Settlement facts belong to another booking.");
        if (
          !commandChecked &&
          facts.settlement?.commandId === command.commandId
        ) {
          await repository.request(
            command,
            facts.revision,
            facts.settlement.amountFils,
          );
          commandChecked = true;
        }
        const selected = selectBookingSettlement(facts);
        if (selected.action === "request") {
          commandChecked =
            (
              await repository.request(
                command,
                facts.revision,
                selected.amountFils,
              )
            ).status === "requested";
          continue;
        }
        if (selected.action !== "process") return { status: selected.action };
        const claim = await repository.claim(selected.intentId);
        if (claim.status !== "execute" && claim.status !== "query")
          return claim;
        const execution =
          claim.status === "execute"
            ? await operations.execute(claim.request)
            : await operations.query(claim.query);
        if (execution.status === "not-admitted") continue;
        if (execution.status !== "recorded") return { status: "processing" };
        if (execution.result.outcome === "indeterminate")
          return { status: "attention-required" };
      }
      return { status: "processing" };
    },
  };
}
