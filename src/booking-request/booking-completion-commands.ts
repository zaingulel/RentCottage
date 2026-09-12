import type { RefundAllocation } from "@/payment/payment-contract";

import { bookingCancellationRefundObligation } from "./booking-cancellation-policy";

export interface BookingNoShowCommand {
  readonly bookingRequestId: string;
  readonly commandId: string;
  readonly reason: string;
}

export interface BookingNoShowFacts {
  readonly bookingRequestId: string;
  readonly revision: string;
  readonly firstStartsAt: string;
  readonly observedAt: string;
  readonly captured: RefundAllocation;
}

export type BookingNoShowResult =
  | {
      readonly status: "no_show";
      readonly bookingRequestId: string;
      readonly noShowId: string;
      readonly occurredAt: string;
      readonly refundObligation: RefundAllocation;
    }
  | { readonly status: "stale" };

export interface BookingNoShowRepository {
  facts(command: BookingNoShowCommand): Promise<BookingNoShowFacts>;
  commit(
    command: BookingNoShowCommand,
    decision: {
      readonly revision: string;
      readonly refundObligation: RefundAllocation;
    },
  ): Promise<BookingNoShowResult>;
}

export function createBookingNoShow(repository: BookingNoShowRepository) {
  return {
    async record(command: BookingNoShowCommand) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const facts = await repository.facts(command);
        if (facts.bookingRequestId !== command.bookingRequestId)
          throw new Error("No-show facts belong to another booking.");
        const refundObligation = bookingCancellationRefundObligation({
          outcome: "no_show",
          firstStartsAt: facts.firstStartsAt,
          evaluatedAt: facts.observedAt,
          captured: facts.captured,
        }).allocation;
        const result = await repository.commit(command, {
          revision: facts.revision,
          refundObligation,
        });
        if (result.status === "no_show") return result;
      }
      throw new Error("Booking facts changed while recording the no-show.");
    },
  };
}

export interface BookingIncidentCommand {
  readonly bookingRequestId: string;
  readonly commandId: string;
  readonly actorRole: "cottage_owner" | "platform_administrator";
  readonly category: "safety" | "property_damage" | "conduct" | "other";
  readonly narrative: string;
}

export interface BookingIncidentResult {
  readonly status: "recorded";
  readonly bookingRequestId: string;
  readonly incidentId: string;
  readonly recordedAt: string;
}

export interface BookingIncidentRepository {
  record(command: BookingIncidentCommand): Promise<BookingIncidentResult>;
}
