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
