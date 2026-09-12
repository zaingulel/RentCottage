import {
  bookingSettlementPermitFrom,
  bookingSettlementRequestMatches,
} from "@/payment/booking-settlement-contract";
import { paymentQueryReferencesAreValid } from "@/payment/payment-operation-execution";
import type {
  ProviderOperationBinding,
  ProviderOperationRequest,
  ProviderReconciliationQuery,
} from "@/payment/payment-contract";
import { parseBookingCompletionEligibility } from "./booking-lifecycle";
import type {
  BookingPayoutRecovery,
  BookingSettlementFacts,
  BookingSettlementRepository,
  BookingSettlementCommand,
  BookingSettlementClaim,
} from "./booking-payout";
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

export function parseBookingPayoutRecovery(
  value: unknown,
): BookingPayoutRecovery {
  const v = object(value);
  if (v.status === "unsettled" || v.status === "unavailable")
    return { status: v.status };
  if (
    v.status !== "paid" ||
    typeof v.paidWhileBlocked !== "boolean" ||
    v.automaticOwnerDebitFils !== 0
  )
    throw new Error("Invalid owner recovery evidence");
  const money = (part: unknown) => {
    if (typeof part !== "number" || !Number.isSafeInteger(part) || part < 0)
      throw new Error("Invalid owner recovery amount");
    return part;
  };
  const paidFils = money(v.paidFils),
    recoveryExposureFils = money(v.recoveryExposureFils),
    recoveryBalanceFils = money(v.recoveryBalanceFils),
    ownerEntitlementFils = money(v.ownerEntitlementFils);
  if (
    paidFils === 0 ||
    recoveryBalanceFils > recoveryExposureFils ||
    recoveryExposureFils > paidFils
  )
    throw new Error("Conflicting owner recovery evidence");
  return {
    status: "paid",
    paidFils,
    ownerEntitlementFils,
    paidWhileBlocked: v.paidWhileBlocked,
    recoveryExposureFils,
    recoveryBalanceFils,
    automaticOwnerDebitFils: 0,
  };
}
export function parseBookingSettlementFacts(
  value: unknown,
  bookingRequestId: string,
): BookingSettlementFacts {
  const v = object(value),
    payout = parseBookingPayoutFacts(v, bookingRequestId);
  if (typeof v.revision !== "string" || !/^[a-f0-9]{32}$/.test(v.revision))
    throw new Error("Invalid settlement revision");
  const intent = v.settlement === null ? null : object(v.settlement);
  if (
    intent &&
    (typeof intent.amountFils !== "number" ||
      !Number.isSafeInteger(intent.amountFils) ||
      intent.amountFils <= 0 ||
      intent.amountFils > payout.captured.bookingPriceFils ||
      typeof intent.retrySafe !== "boolean")
  )
    throw new Error("Invalid settlement evidence");
  return {
    ...payout,
    revision: v.revision,
    recovery: parseBookingPayoutRecovery(v.recovery),
    maturity: parseBookingCompletionEligibility(v.maturity),
    intents: list(v.intents).map((value) => {
      const intent = object(value);
      if (typeof intent.automatic !== "boolean")
        throw new Error("Invalid settlement refund evidence");
      return {
        id: uuid(intent.id),
        automatic: intent.automatic,
        state: choice(intent.state, [
          "requested",
          "processing",
          "unknown",
          "succeeded",
          "failed",
        ] as const),
      };
    }),
    settlement: intent
      ? {
          id: uuid(intent.id),
          commandId: uuid(intent.commandId),
          amountFils: intent.amountFils as number,
          state: choice(intent.state, [
            "requested",
            "processing",
            "indeterminate",
            "succeeded",
            "failed",
            "not-executed",
          ] as const),
          retrySafe: intent.retrySafe as boolean,
          actorUserId: uuid(intent.actorUserId),
          reason:
            typeof intent.reason === "string" && intent.reason.trim()
              ? intent.reason
              : (() => {
                  throw new Error("Invalid settlement attribution");
                })(),
          requestedAt: timestamp(intent.requestedAt),
          receipt:
            intent.receipt === null
              ? null
              : (() => {
                  const r = object(intent.receipt);
                  if (
                    typeof r.historySequence !== "number" ||
                    !Number.isSafeInteger(r.historySequence) ||
                    r.historySequence < 1
                  )
                    throw new Error("Invalid settlement receipt sequence");
                  return {
                    observationId: uuid(r.observationId),
                    historySequence: r.historySequence,
                    recordedAt: timestamp(r.recordedAt),
                    activeHoldIds: list(r.activeHoldIds).map(uuid),
                    activeDisputeIds: list(r.activeDisputeIds).map(uuid),
                  };
                })(),
        }
      : null,
  };
}
export class SupabaseBookingSettlementRepository implements BookingSettlementRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly serviceClient: SupabaseClient,
  ) {}
  async facts(bookingRequestId: string): Promise<BookingSettlementFacts> {
    const { data, error } = await this.client.rpc(
      "get_booking_settlement_facts",
      { target_booking_request_id: bookingRequestId },
    );
    checkError(error);
    return parseBookingSettlementFacts(data, bookingRequestId);
  }
  async request(
    command: BookingSettlementCommand,
    revision: string,
    amountFils: number,
  ) {
    const { data, error } = await this.client.rpc(
      "request_booking_settlement",
      {
        target_booking_request_id: command.bookingRequestId,
        target_command_id: command.commandId,
        target_reason: command.reason,
        target_revision: revision,
        target_amount_fils: amountFils,
      },
    );
    checkError(error);
    const v = object(data);
    if (v.status === "stale") return { status: "stale" as const };
    if (v.status !== "requested")
      throw new Error("Invalid settlement request receipt");
    return { status: "requested" as const, intentId: uuid(v.intentId) };
  }
  async claim(intentId: string): Promise<BookingSettlementClaim> {
    const { data, error } = await this.serviceClient.rpc(
      "claim_booking_settlement",
      { target_intent_id: intentId },
    );
    checkError(error);
    const v = object(data);
    if (
      v.status === "processing" ||
      v.status === "settled" ||
      v.status === "blocked" ||
      v.status === "attention-required"
    )
      return { status: v.status };
    const request = object(
      v.status === "execute"
        ? v.request
        : v.status === "query"
          ? v.query
          : null,
    );
    const permit = bookingSettlementPermitFrom(
      v.status === "execute"
        ? request.executionPermit
        : request.settlementPermit,
    );
    if (
      permit.binding.settlementIntentId !== intentId ||
      !bookingSettlementRequestMatches(
        request as unknown as ProviderOperationBinding,
        permit,
        permit.binding.providerIdentity,
      ) ||
      (v.status === "query" &&
        !paymentQueryReferencesAreValid(
          request.providerRequestId,
          request.providerReference,
        ))
    )
      throw new Error("Invalid settlement work binding");
    return v.status === "execute"
      ? {
          status: "execute",
          request: request as unknown as ProviderOperationRequest,
        }
      : {
          status: "query",
          query: request as unknown as ProviderReconciliationQuery,
        };
  }
}
