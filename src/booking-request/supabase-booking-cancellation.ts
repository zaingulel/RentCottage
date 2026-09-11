import type { SupabaseClient } from "@supabase/supabase-js";
import type { RefundAllocation } from "@/payment/payment-contract";
import {
  exactMarketplaceCommission,
  refundAllocationTotal,
} from "@/payment/payment-refund-allocation";
import type {
  BookingCancellationCommand,
  BookingCancellationFacts,
  BookingCancellationRepository,
  BookingCancellationResult,
} from "./booking-cancellation";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

function allocation(value: unknown): RefundAllocation {
  const amount = record(value);
  if (
    !amount ||
    typeof amount.bookingPriceFils !== "number" ||
    typeof amount.bookingServiceFeeFils !== "number"
  ) {
    throw new Error("Cancellation refund allocation is invalid");
  }
  const result = {
    bookingPriceFils: amount.bookingPriceFils,
    bookingServiceFeeFils: amount.bookingServiceFeeFils,
  };
  refundAllocationTotal(result);
  exactMarketplaceCommission(result.bookingPriceFils);
  return result;
}

export class SupabaseBookingCancellationRepository implements BookingCancellationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async facts(
    command: BookingCancellationCommand,
  ): Promise<BookingCancellationFacts> {
    const { data, error } = await this.client.rpc(
      "get_booking_cancellation_facts",
      {
        target_booking_request_id: command.bookingRequestId,
        target_actor_role: command.actorRole,
      },
    );
    if (error) throw new Error("Booking cancellation facts are unavailable");
    const facts = record(data);
    if (
      !facts ||
      facts.bookingRequestId !== command.bookingRequestId ||
      typeof facts.revision !== "string" ||
      !/^[0-9a-f]{32}$/.test(facts.revision) ||
      !timestamp(facts.firstStartsAt) ||
      !timestamp(facts.observedAt)
    ) {
      throw new Error("Booking cancellation facts are invalid");
    }
    return {
      bookingRequestId: command.bookingRequestId,
      revision: facts.revision,
      firstStartsAt: facts.firstStartsAt,
      observedAt: facts.observedAt,
      captured: allocation(facts.captured),
    };
  }

  async commit(
    command: BookingCancellationCommand,
    decision: {
      readonly revision: string;
      readonly refundObligation: RefundAllocation;
    },
  ): Promise<BookingCancellationResult | { readonly status: "stale" }> {
    const { data, error } = await this.client.rpc(
      "commit_booking_cancellation",
      {
        target_booking_request_id: command.bookingRequestId,
        target_command_id: command.commandId,
        target_actor_role: command.actorRole,
        target_reason: command.reason,
        target_category: command.category,
        target_decision: decision,
      },
    );
    if (error) throw new Error("Booking cancellation could not be recorded");
    const result = record(data);
    if (result?.status === "stale") return { status: "stale" };
    if (
      !result ||
      result.status !== "cancelled" ||
      result.bookingRequestId !== command.bookingRequestId ||
      typeof result.cancellationId !== "string" ||
      !uuid.test(result.cancellationId) ||
      !timestamp(result.occurredAt)
    ) {
      throw new Error("Booking cancellation result is invalid");
    }
    return {
      status: "cancelled",
      bookingRequestId: command.bookingRequestId,
      cancellationId: result.cancellationId,
      occurredAt: result.occurredAt,
      refundObligation: allocation(result.refundObligation),
    };
  }
}
