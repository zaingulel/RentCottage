import type { BookingPayoutFacts } from "./booking-payout";
import {
  parseBookingLifecycle,
  parseBookingCompletionEligibility,
  type BookingLifecycle,
  type BookingCompletionEligibility,
} from "./booking-lifecycle";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RefundAllocation } from "@/payment/payment-contract";
import {
  refundAllocationTotal,
  refundCapacity,
  exactMarketplaceCommission,
} from "@/payment/payment-refund-allocation";
import type { BookingCancellationCommand } from "./booking-cancellation";
export type BookingParticipantRole = BookingCancellationCommand["actorRole"];
export interface BookingFinancialView {
  readonly payout?: BookingPayoutFacts;
  readonly bookingRequestId: string;
  readonly bookingRequestReference: string;
  readonly bookingReference: string;
  readonly actorRole: BookingParticipantRole;
  readonly cottageName: string;
  readonly firstStartsAt: string;
  readonly bookingTermsBody: string;
  readonly captured: RefundAllocation;
  readonly refunded: RefundAllocation;
  readonly reserved: RefundAllocation;
  readonly lifecycle: BookingLifecycle;
  readonly eligibility: BookingCompletionEligibility;
  readonly cancellation: null | {
    readonly occurredAt: string;
    readonly obligation: RefundAllocation;
  };
  readonly refunds: readonly {
    readonly id: string;
    readonly occurredAt: string;
    readonly source: "administrator" | "cancellation" | "dispute";
    readonly state:
      | "requested"
      | "processing"
      | "unknown"
      | "succeeded"
      | "failed";
    readonly allocation: RefundAllocation;
  }[];
  readonly notifications: readonly {
    readonly eventId: string;
    readonly receiptId: string;
    readonly kind:
      | "cancelled"
      | "refund_requested"
      | "refund_returned"
      | "refund_attention"
      | "preparation_reminder";
    readonly dueAt?: string;
    readonly recipientRole: "customer" | "cottage_owner";
    readonly deliveredAt?: string;
    readonly outcome?: "failed" | "unknown" | "delivered" | "suppressed";
    readonly retryAllowed: boolean;
    readonly state:
      | "pending"
      | "processing"
      | "retryable"
      | "uncertain"
      | "delivered"
      | "suppressed";
  }[];
  readonly audit?: {
    readonly cancellation: null | {
      readonly reason: string | null;
      readonly category: string | null;
      readonly actorUserId: string;
      readonly actorRole: BookingParticipantRole;
    };
    readonly refunds: readonly {
      readonly id: string;
      readonly reason: string;
      readonly actorUserId: string;
    }[];
  };
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid booking financial view");
  return value as Record<string, unknown>;
};
const text = (v: unknown): string => {
  if (typeof v !== "string" || !v.trim())
    throw new Error("Invalid booking financial text");
  return v;
};
const uuid = (v: unknown): string => {
  const s = text(v);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      s,
    )
  )
    throw new Error("Invalid booking identity");
  return s;
};
const timestamp = (v: unknown): string => {
  const s = text(v);
  if (!Number.isFinite(Date.parse(s)))
    throw new Error("Invalid booking timestamp");
  return s;
};
const choice = <T extends string>(v: unknown, choices: readonly T[]): T => {
  if (!choices.includes(v as T)) throw new Error("Invalid booking state");
  return v as T;
};
const boolean = (value: unknown): boolean => {
  if (typeof value !== "boolean")
    throw new Error("Invalid booking notification retry status");
  return value;
};
const allocation = (v: unknown): RefundAllocation => {
  const o = object(v);
  if (
    typeof o.bookingPriceFils !== "number" ||
    typeof o.bookingServiceFeeFils !== "number"
  )
    throw new Error("Invalid refund allocation");
  const a = {
    bookingPriceFils: o.bookingPriceFils,
    bookingServiceFeeFils: o.bookingServiceFeeFils,
  };
  refundAllocationTotal(a);
  exactMarketplaceCommission(a.bookingPriceFils);
  return a;
};
const list = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new Error("Invalid booking history");
  return v;
};
export function parseBookingFinancialView(
  value: unknown,
  reference: string,
  actorRole: BookingParticipantRole,
): BookingFinancialView {
  const v = object(value);
  if (
    v.bookingRequestReference !== reference ||
    v.actorRole !== actorRole ||
    (actorRole !== "platform_administrator" && v.audit !== undefined)
  )
    throw new Error("Invalid financial view binding");
  const captured = allocation(v.captured),
    refunded = allocation(v.refunded),
    reserved = allocation(v.reserved);
  refundCapacity({ captured, refunded, reserved });
  const cancellation = v.cancellation === null ? null : object(v.cancellation);
  const result: BookingFinancialView = {
    bookingRequestId: uuid(v.bookingRequestId),
    bookingRequestReference: reference,
    bookingReference: text(v.bookingReference),
    actorRole,
    cottageName: text(v.cottageName),
    firstStartsAt: timestamp(v.firstStartsAt),
    bookingTermsBody: text(v.bookingTermsBody),
    captured,
    refunded,
    reserved,
    lifecycle: parseBookingLifecycle(
      v.lifecycle,
      uuid(v.bookingRequestId),
      actorRole,
    ),
    eligibility: parseBookingCompletionEligibility(v.eligibility),
    cancellation: cancellation
      ? {
          occurredAt: timestamp(cancellation.occurredAt),
          obligation: allocation(cancellation.obligation),
        }
      : null,
    refunds: list(v.refunds).map((value) => {
      const r = object(value);
      return {
        id: uuid(r.id),
        occurredAt: timestamp(r.occurredAt),
        source: choice(r.source, ["administrator", "cancellation", "dispute"]),
        state: choice(r.state, [
          "requested",
          "processing",
          "unknown",
          "succeeded",
          "failed",
        ]),
        allocation: allocation(r.allocation),
      };
    }),
    notifications: list(v.notifications).map((value) => {
      const n = object(value);
      return {
        eventId: uuid(n.eventId),
        receiptId: uuid(n.receiptId),
        kind: choice(n.kind, [
          "cancelled",
          "refund_requested",
          "refund_returned",
          "refund_attention",
          "preparation_reminder",
        ]),
        ...(n.dueAt === undefined ? {} : { dueAt: timestamp(n.dueAt) }),
        recipientRole: choice(n.recipientRole, ["customer", "cottage_owner"]),
        ...(n.deliveredAt === undefined
          ? {}
          : { deliveredAt: timestamp(n.deliveredAt) }),
        ...(n.outcome === undefined
          ? {}
          : {
              outcome: choice(n.outcome, [
                "failed",
                "unknown",
                "delivered",
                "suppressed",
              ] as const),
            }),
        retryAllowed: boolean(n.retryAllowed),
        state: choice(n.state, [
          "pending",
          "processing",
          "retryable",
          "uncertain",
          "delivered",
          "suppressed",
        ]),
      };
    }),
  };
  if (actorRole !== "platform_administrator") return result;
  const a = object(v.audit),
    c = a.cancellation === null ? null : object(a.cancellation);
  return {
    ...result,
    audit: {
      cancellation: c
        ? {
            reason: c.reason === null ? null : text(c.reason),
            category:
              c.category === null
                ? null
                : choice(c.category, [
                    "safety",
                    "fraud",
                    "legal",
                    "serious_operational",
                  ]),
            actorUserId: uuid(c.actorUserId),
            actorRole: choice(c.actorRole, [
              "customer",
              "cottage_owner",
              "platform_administrator",
            ]),
          }
        : null,
      refunds: list(a.refunds).map((value) => {
        const r = object(value);
        return {
          id: uuid(r.id),
          reason: text(r.reason),
          actorUserId: uuid(r.actorUserId),
        };
      }),
    },
  };
}
export async function getBookingFinancialView(
  client: SupabaseClient,
  reference: string,
  actorRole: BookingParticipantRole,
): Promise<BookingFinancialView | null> {
  const { data, error } = await client.rpc("get_booking_financial_view", {
    target_reference: reference,
    target_actor_role: actorRole,
  });
  if (error) {
    if (error.code === "42501") return null;
    throw new Error("Booking financial view is unavailable");
  }
  return data === null
    ? null
    : parseBookingFinancialView(data, reference, actorRole);
}
