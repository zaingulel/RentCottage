import type { RefundAllocation } from "@/payment/payment-contract";
import { bookingCancellationRefundObligation } from "./booking-cancellation-policy";

export interface BookingCancellationCommand {
  readonly bookingRequestId: string;
  readonly commandId: string;
  readonly actorRole: "customer" | "cottage_owner" | "platform_administrator";
  readonly reason: string | null;
  readonly category:
    | "safety"
    | "fraud"
    | "legal"
    | "serious_operational"
    | null;
}

export interface BookingCancellationFacts {
  readonly bookingRequestId: string;
  readonly revision: string;
  readonly firstStartsAt: string;
  readonly observedAt: string;
  readonly captured: RefundAllocation;
}

export interface BookingCancellationResult {
  readonly status: "cancelled";
  readonly bookingRequestId: string;
  readonly cancellationId: string;
  readonly occurredAt: string;
  readonly refundObligation: RefundAllocation;
}

export interface BookingCancellationRepository {
  facts(command: BookingCancellationCommand): Promise<BookingCancellationFacts>;
  commit(
    command: BookingCancellationCommand,
    decision: {
      readonly revision: string;
      readonly refundObligation: RefundAllocation;
    },
  ): Promise<BookingCancellationResult | { readonly status: "stale" }>;
}

export function createBookingCancellation(
  repository: BookingCancellationRepository,
) {
  return {
    async cancel(
      command: BookingCancellationCommand,
    ): Promise<BookingCancellationResult> {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const facts = await repository.facts(command);
        if (facts.bookingRequestId !== command.bookingRequestId) {
          throw new Error("Cancellation facts belong to another booking.");
        }
        const obligation = bookingCancellationRefundObligation({
          ...facts,
          evaluatedAt: facts.observedAt,
          outcome:
            command.actorRole === "customer"
              ? "customer_cancellation"
              : command.actorRole === "cottage_owner"
                ? "owner_cancellation"
                : "administrator_cancellation",
        });
        const result = await repository.commit(command, {
          revision: facts.revision,
          refundObligation: obligation.allocation,
        });
        if (result.status === "cancelled") return result;
      }
      throw new Error("Booking facts changed during cancellation. Try again.");
    },
  };
}
