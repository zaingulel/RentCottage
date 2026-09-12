import type { SupabaseClient } from "@supabase/supabase-js";
import type { RefundAllocation } from "@/payment/payment-contract";
import {
  bookingRefundPermitFrom,
  bookingRefundRequestMatches,
} from "@/payment/booking-refund-contract";
import {
  refundCapacity,
  refundAllocationTotal,
} from "@/payment/payment-refund-allocation";
import type {
  BookingRefundClaim,
  BookingRefundFacts,
  BookingRefundRepository,
} from "./booking-refund";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}
export class SupabaseBookingRefundRepository implements BookingRefundRepository {
  constructor(private readonly client: SupabaseClient) {}
  async facts(bookingRequestId: string): Promise<BookingRefundFacts> {
    const { data, error } = await this.client.rpc("get_booking_refund_facts", {
      target_booking_request_id: bookingRequestId,
    });
    if (
      error ||
      !data ||
      data.bookingRequestId !== bookingRequestId ||
      !validId(data.captureOperationId) ||
      !/^[a-f0-9]{32}$/.test(data.revision) ||
      !Array.isArray(data.intents) ||
      !data.intents.every(
        (intent: BookingRefundFacts["intents"][number]) =>
          validId(intent.id) &&
          typeof intent.automatic === "boolean" &&
          [
            "requested",
            "processing",
            "unknown",
            "succeeded",
            "failed",
          ].includes(intent.state),
      ) ||
      new Set(
        data.intents.map(
          (intent: BookingRefundFacts["intents"][number]) => intent.id,
        ),
      ).size !== data.intents.length
    )
      throw new Error("Refund facts are unavailable");
    refundCapacity(data);
    refundCapacity({
      captured: data.captured,
      refunded: data.obligation,
      reserved: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
    });
    return data;
  }
  async requestException(command: {
    readonly bookingRequestId: string;
    readonly commandId: string;
    readonly reason: string;
    readonly allocation: RefundAllocation;
  }): Promise<{ readonly status: "requested"; readonly intentId: string }> {
    if (refundAllocationTotal(command.allocation) <= 0)
      throw new Error("Refund must return a positive amount.");
    const { data, error } = await this.client.rpc(
      "request_booking_refund_exception",
      {
        target_booking_request_id: command.bookingRequestId,
        target_command_id: command.commandId,
        target_reason: command.reason,
        target_allocation: command.allocation,
      },
    );
    if (error || data?.status !== "requested" || !validId(data.intentId))
      throw new Error("Refund exception is unavailable");
    return { status: "requested", intentId: data.intentId };
  }
  async requestAutomatic(
    bookingRequestId: string,
    revision: string,
    allocation: RefundAllocation,
  ): Promise<{ readonly status: "requested" | "stale" }> {
    const { data, error } = await this.client.rpc(
      "request_automatic_booking_refund",
      {
        target_booking_request_id: bookingRequestId,
        target_revision: revision,
        target_allocation: allocation,
      },
    );
    if (error || !["requested", "stale"].includes(data?.status))
      throw new Error("Automatic refund is unavailable");
    return { status: data.status };
  }
  async claim(intentId: string): Promise<BookingRefundClaim> {
    const { data, error } = await this.client.rpc("claim_booking_refund", {
      target_intent_id: intentId,
    });
    if (error || !data) throw new Error("Refund work is unavailable");
    if (data.status === "stale" || data.status === "processing")
      return { status: data.status };
    const request =
      data.status === "execute"
        ? data.request
        : data.status === "query"
          ? data.query
          : null;
    const permit = bookingRefundPermitFrom(
      data.status === "execute"
        ? request?.executionPermit
        : request?.refundPermit,
    );
    if (
      !request ||
      permit.binding.refundIntentId !== intentId ||
      !bookingRefundRequestMatches(
        request,
        permit,
        permit.binding.providerIdentity,
      ) ||
      (data.status === "query" &&
        !(
          (request.providerRequestId === null &&
            request.providerReference === null) ||
          (typeof request.providerRequestId === "string" &&
            request.providerRequestId.length > 0 &&
            typeof request.providerReference === "string" &&
            request.providerReference.length > 0)
        ))
    )
      throw new Error("Refund work is invalid");
    return data;
  }
  async claimDue(limit: number): Promise<readonly string[]> {
    const { data, error } = await this.client.rpc("claim_due_booking_refunds", {
      target_limit: limit,
    });
    if (
      error ||
      !Array.isArray(data) ||
      data.length > limit ||
      !data.every(validId) ||
      new Set(data).size !== data.length
    )
      throw new Error("Refund batch is unavailable");
    return data;
  }
}
