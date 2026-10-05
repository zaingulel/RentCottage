import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BookingCompletionCandidate,
  BookingCompletionRepository,
  BookingCompletionResult,
} from "./booking-completion";
import { isOffsetTimestamp, rowObject } from "./booking-request-row";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function candidate(value: unknown): BookingCompletionCandidate {
  const row = rowObject(value);
  if (
    !row ||
    typeof row.bookingRequestId !== "string" ||
    !uuidPattern.test(row.bookingRequestId) ||
    !["complete", "assess_maturity"].includes(String(row.action)) ||
    typeof row.revision !== "string" ||
    !/^[0-9a-f]{32}$/.test(row.revision) ||
    !isOffsetTimestamp(row.effectivePeriodEnd) ||
    !isOffsetTimestamp(row.observedAt)
  )
    throw new Error("Booking completion candidate is invalid");
  return {
    bookingRequestId: row.bookingRequestId,
    action: row.action as BookingCompletionCandidate["action"],
    revision: row.revision,
    effectivePeriodEnd: row.effectivePeriodEnd,
    observedAt: row.observedAt,
  };
}

export class SupabaseBookingCompletionRepository implements BookingCompletionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async due(limit: number): Promise<readonly BookingCompletionCandidate[]> {
    const { data, error } = await this.client.rpc(
      "list_due_booking_completions",
      {
        target_limit: limit,
      },
    );
    if (error) throw new Error("Due booking completions are unavailable");
    if (!Array.isArray(data))
      throw new Error("Due booking completions are invalid");
    return data.map(candidate);
  }

  async complete(
    target: BookingCompletionCandidate,
  ): Promise<BookingCompletionResult> {
    const { data, error } = await this.client.rpc("commit_booking_completion", {
      target_booking_request_id: target.bookingRequestId,
      target_revision: target.revision,
    });
    if (error) throw new Error("Booking completion could not be recorded");
    const result = rowObject(data);
    if (
      !result ||
      result.bookingRequestId !== target.bookingRequestId ||
      !["completed", "ineligible"].includes(String(result.status))
    )
      throw new Error("Booking completion result is invalid");
    if (result.status === "ineligible")
      return {
        status: "ineligible",
        bookingRequestId: target.bookingRequestId,
      };
    if (
      result.effectivePeriodEnd !== target.effectivePeriodEnd ||
      !isOffsetTimestamp(result.completedAt)
    )
      throw new Error("Booking completion result is invalid");
    return {
      status: "completed",
      bookingRequestId: target.bookingRequestId,
      effectivePeriodEnd: target.effectivePeriodEnd,
      completedAt: result.completedAt,
    };
  }

  async assessMaturity(
    target: BookingCompletionCandidate,
  ): Promise<BookingCompletionResult> {
    const { data, error } = await this.client.rpc(
      "commit_booking_completion_maturity",
      {
        target_booking_request_id: target.bookingRequestId,
        target_revision: target.revision,
      },
    );
    if (error) throw new Error("Booking maturity could not be recorded");
    const result = rowObject(data);
    if (
      !result ||
      result.bookingRequestId !== target.bookingRequestId ||
      !["matured", "ineligible"].includes(String(result.status))
    )
      throw new Error("Booking maturity result is invalid");
    if (result.status === "ineligible")
      return {
        status: "ineligible",
        bookingRequestId: target.bookingRequestId,
      };
    if (
      result.effectivePeriodEnd !== target.effectivePeriodEnd ||
      !isOffsetTimestamp(result.assessedAt)
    )
      throw new Error("Booking maturity result is invalid");
    return {
      status: "matured",
      bookingRequestId: target.bookingRequestId,
      effectivePeriodEnd: target.effectivePeriodEnd,
      assessedAt: result.assessedAt,
    };
  }
}
