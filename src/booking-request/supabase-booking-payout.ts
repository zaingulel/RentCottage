import type { SupabaseClient } from "@supabase/supabase-js";
import {
  exactMarketplaceCommission,
  refundCapacity,
} from "@/payment/payment-refund-allocation";
import { BookingLifecycleConflict } from "./supabase-booking-lifecycle";
import type {
  BookingPayoutCommand,
  BookingPayoutFacts,
  BookingPayoutReceipt,
  BookingPayoutRepository,
} from "./booking-payout";
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid payout evidence");
  return v as Record<string, unknown>;
};
const uuid = (v: unknown): string => {
  if (
    typeof v !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v,
    )
  )
    throw new Error("Invalid payout identity");
  return v;
};
const choice = <T extends string>(v: unknown, choices: readonly T[]): T => {
  if (!choices.includes(v as T)) throw new Error("Invalid payout state");
  return v as T;
};
const list = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new Error("Invalid payout history");
  return v;
};
const timestamp = (v: unknown): string => {
  if (
    typeof v !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    throw new Error("Invalid payout timestamp");
  return v;
};
const allocation = (v: unknown) => {
  const a = object(v);
  if (
    typeof a.bookingPriceFils !== "number" ||
    typeof a.bookingServiceFeeFils !== "number"
  )
    throw new Error("Invalid payout allocation");
  const value = {
    bookingPriceFils: a.bookingPriceFils,
    bookingServiceFeeFils: a.bookingServiceFeeFils,
  };
  refundCapacity({
    captured: value,
    refunded: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
    reserved: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
  });
  exactMarketplaceCommission(value.bookingPriceFils);
  return value;
};
function checkError(error: { code?: string } | null) {
  if (error?.code === "RC409") throw new BookingLifecycleConflict();
  if (error) throw new Error("Payout evidence is unavailable");
}
export function parseBookingPayoutFacts(
  value: unknown,
  bookingRequestId: string,
): BookingPayoutFacts {
  const v = object(value);
  if (v.bookingRequestId !== bookingRequestId)
    throw new Error("Invalid payout booking binding");
  const commands = list(v.commands).map((value) => {
    const c = object(value);
    if (
      typeof c.reason !== "string" ||
      !c.reason.trim() ||
      c.reason.trim().length > 2000
    )
      throw new Error("Invalid payout attribution");
    return {
      commandId: uuid(c.commandId),
      action: choice(c.action, [
        "place_hold",
        "release_hold",
        "open_dispute",
        "resolve_dispute",
      ] as const),
      subjectId: c.subjectId === null ? null : uuid(c.subjectId),
      outcome:
        c.outcome === null
          ? null
          : choice(c.outcome, [
              "owner_won",
              "customer_won",
              "partial_customer_award",
            ] as const),
      allocation: c.allocation === null ? null : allocation(c.allocation),
      actorUserId: uuid(c.actorUserId),
      reason: c.reason,
      occurredAt: timestamp(c.occurredAt),
    };
  });
  if (new Set(commands.map((c) => c.commandId)).size !== commands.length)
    throw new Error("Duplicate payout history");
  for (const command of commands) {
    const subjectRequired =
      command.action === "release_hold" || command.action === "resolve_dispute";
    const award =
      command.outcome === "customer_won" ||
      command.outcome === "partial_customer_award";
    if (
      subjectRequired !== (command.subjectId !== null) ||
      (command.action === "resolve_dispute") !== (command.outcome !== null) ||
      award !== (command.allocation !== null)
    )
      throw new Error("Invalid payout command binding");
    if (
      command.subjectId !== null &&
      !commands.some(
        (subject) =>
          subject.commandId === command.subjectId &&
          subject.action ===
            (command.action === "release_hold" ? "place_hold" : "open_dispute"),
      )
    )
      throw new Error("Missing payout command source");
  }
  const disputes = list(v.disputes).map((value) => {
    const d = object(value);
    const result = {
      id: uuid(d.id),
      resolutionId: d.resolutionId === null ? null : uuid(d.resolutionId),
      refundIntentId: d.refundIntentId === null ? null : uuid(d.refundIntentId),
      state: choice(d.state, ["open", "resolving", "resolved"] as const),
    };
    const opening = commands.find(
      (c) => c.commandId === result.id && c.action === "open_dispute",
    );
    const resolution = commands.find(
      (c) =>
        c.commandId === result.resolutionId &&
        c.subjectId === result.id &&
        c.action === "resolve_dispute",
    );
    if (
      !opening ||
      (result.state === "open"
        ? result.resolutionId !== null || result.refundIntentId !== null
        : !resolution ||
          (resolution.outcome === "owner_won"
            ? result.state !== "resolved" || result.refundIntentId !== null
            : result.refundIntentId === null))
    )
      throw new Error("Invalid dispute resolution binding");
    return result;
  });
  const activeHoldIds = list(v.activeHoldIds).map(uuid),
    activeDisputeIds = list(v.activeDisputeIds).map(uuid);
  const expectedHolds = commands
    .filter(
      (c) =>
        c.action === "place_hold" &&
        !commands.some(
          (r) => r.action === "release_hold" && r.subjectId === c.commandId,
        ),
    )
    .map((c) => c.commandId);
  const expectedDisputes = disputes
    .filter((d) => d.state !== "resolved")
    .map((d) => d.id);
  if (
    activeHoldIds.length > 1 ||
    activeDisputeIds.length > 1 ||
    JSON.stringify(activeHoldIds) !== JSON.stringify(expectedHolds) ||
    JSON.stringify(activeDisputeIds) !== JSON.stringify(expectedDisputes) ||
    disputes.length !==
      commands.filter((c) => c.action === "open_dispute").length
  )
    throw new Error("Incomplete payout hold evidence");
  const result = {
    bookingRequestId: uuid(v.bookingRequestId),
    captured: allocation(v.captured),
    refunded: allocation(v.refunded),
    reserved: allocation(v.reserved),
    commands,
    disputes,
    activeHoldIds,
    activeDisputeIds,
  };
  refundCapacity(result);
  return result;
}
export class SupabaseBookingPayoutRepository implements BookingPayoutRepository {
  constructor(private readonly client: SupabaseClient) {}
  async facts(bookingRequestId: string): Promise<BookingPayoutFacts> {
    const { data, error } = await this.client.rpc("get_booking_payout_facts", {
      target_booking_request_id: bookingRequestId,
    });
    checkError(error);
    return parseBookingPayoutFacts(data, bookingRequestId);
  }
  async record(command: BookingPayoutCommand): Promise<BookingPayoutReceipt> {
    const { data, error } = await this.client.rpc(
      "record_booking_payout_command",
      {
        target_booking_request_id: command.bookingRequestId,
        target_command_id: command.commandId,
        target_action: command.action,
        target_reason: command.reason,
        target_subject_id: command.subjectId ?? null,
        target_outcome: command.outcome ?? null,
        target_allocation: command.allocation ?? null,
      },
    );
    checkError(error);
    const v = object(data);
    if (
      v.status !== "recorded" ||
      v.bookingRequestId !== command.bookingRequestId ||
      v.commandId !== command.commandId
    )
      throw new Error("Invalid payout command receipt");
    return {
      status: "recorded",
      bookingRequestId: uuid(v.bookingRequestId),
      commandId: uuid(v.commandId),
      occurredAt: timestamp(v.occurredAt),
    };
  }
}
