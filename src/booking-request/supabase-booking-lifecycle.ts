import type { SupabaseClient } from "@supabase/supabase-js";
import { refundAllocationTotal } from "@/payment/payment-refund-allocation";
import type {
  BookingIncidentCommand,
  BookingIncidentResult,
  BookingNoShowCommand,
  BookingNoShowFacts,
  BookingNoShowRepository,
  BookingNoShowResult,
} from "./booking-completion-commands";
export class BookingLifecycleConflict extends Error {
  constructor() {
    super("Booking lifecycle changed. Refresh to see its current outcome.");
  }
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid booking lifecycle response");
  return value as Record<string, unknown>;
};
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const timestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
function checkError(error: { code?: string } | null) {
  if (error?.code === "RC409") throw new BookingLifecycleConflict();
  if (error) throw new Error("Booking lifecycle command is unavailable");
}
export class SupabaseBookingNoShowRepository implements BookingNoShowRepository {
  constructor(private readonly client: SupabaseClient) {}
  async facts(command: BookingNoShowCommand): Promise<BookingNoShowFacts> {
    const { data, error } = await this.client.rpc("get_booking_no_show_facts", {
      target_booking_request_id: command.bookingRequestId,
    });
    checkError(error);
    const v = object(data),
      captured = object(v.captured);
    if (
      v.bookingRequestId !== command.bookingRequestId ||
      typeof v.revision !== "string" ||
      !/^[a-f0-9]{32}$/.test(v.revision) ||
      !timestamp(v.firstStartsAt) ||
      !timestamp(v.observedAt) ||
      typeof captured.bookingPriceFils !== "number" ||
      typeof captured.bookingServiceFeeFils !== "number"
    )
      throw new Error("Invalid no-show facts");
    const allocation = {
      bookingPriceFils: captured.bookingPriceFils,
      bookingServiceFeeFils: captured.bookingServiceFeeFils,
    };
    refundAllocationTotal(allocation);
    return {
      bookingRequestId: command.bookingRequestId,
      revision: v.revision,
      firstStartsAt: v.firstStartsAt,
      observedAt: v.observedAt,
      captured: allocation,
    };
  }
  async commit(
    command: BookingNoShowCommand,
    decision: Parameters<BookingNoShowRepository["commit"]>[1],
  ): Promise<BookingNoShowResult> {
    const { data, error } = await this.client.rpc("commit_booking_no_show", {
      target_booking_request_id: command.bookingRequestId,
      target_command_id: command.commandId,
      target_reason: command.reason,
      target_decision: decision,
    });
    checkError(error);
    const v = object(data);
    if (v.status === "stale") return { status: "stale" };
    const refund = object(v.refundObligation);
    if (
      v.status !== "no_show" ||
      v.bookingRequestId !== command.bookingRequestId ||
      !uuid(v.noShowId) ||
      !timestamp(v.occurredAt) ||
      refund.bookingPriceFils !== 0 ||
      refund.bookingServiceFeeFils !== 0
    )
      throw new Error("Invalid no-show receipt");
    return {
      status: "no_show",
      bookingRequestId: command.bookingRequestId,
      noShowId: v.noShowId,
      occurredAt: v.occurredAt,
      refundObligation: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
    };
  }
}
export async function recordBookingIncident(
  client: SupabaseClient,
  command: BookingIncidentCommand,
): Promise<BookingIncidentResult> {
  const { data, error } = await client.rpc("record_booking_incident", {
    target_booking_request_id: command.bookingRequestId,
    target_command_id: command.commandId,
    target_actor_role: command.actorRole,
    target_category: command.category,
    target_narrative: command.narrative,
  });
  checkError(error);
  const v = object(data);
  if (
    v.status !== "recorded" ||
    v.bookingRequestId !== command.bookingRequestId ||
    !uuid(v.incidentId) ||
    !timestamp(v.recordedAt)
  )
    throw new Error("Invalid incident receipt");
  return {
    status: "recorded",
    bookingRequestId: command.bookingRequestId,
    incidentId: v.incidentId,
    recordedAt: v.recordedAt,
  };
}
