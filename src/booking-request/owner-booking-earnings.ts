import type { RefundAllocation } from "@/payment/payment-contract";
import {
  exactMarketplaceCommission,
  refundAllocationTotal,
  refundCapacity,
} from "@/payment/payment-refund-allocation";
import {
  parseBookingCompletionEligibility,
  type BookingCompletionEligibility,
} from "./booking-lifecycle";
import type { BookingPayoutRecovery } from "./booking-payout";
import { bookingFinancialPresentation } from "./booking-financial-presentation";
import { parseBookingPayoutRecovery } from "./supabase-booking-payout";

type RefundState =
  | "requested"
  | "processing"
  | "unknown"
  | "succeeded"
  | "failed";
type SettlementState =
  | "requested"
  | "processing"
  | "indeterminate"
  | "succeeded"
  | "failed"
  | "not-executed";
type DisputeOutcome = "owner_won" | "customer_won" | "partial_customer_award";

export type OwnerBookingEarningsFacts =
  | { readonly status: "not-captured" | "unavailable" }
  | {
      readonly status: "captured";
      readonly captured: RefundAllocation;
      readonly refunded: RefundAllocation;
      readonly reserved: RefundAllocation;
      readonly obligation: RefundAllocation;
      readonly marketplaceCommissionRateBasisPoints: 1_000;
      readonly marketplaceCommissionAmountFils: number;
      readonly refunds: readonly {
        readonly state: RefundState;
        readonly allocation: RefundAllocation;
      }[];
      readonly maturity: BookingCompletionEligibility;
      readonly administratorHoldActive: boolean;
      readonly disputes: readonly {
        readonly state: "open" | "resolving" | "resolved";
        readonly outcome: DisputeOutcome | null;
      }[];
      readonly settlement: null | {
        readonly amountFils: number;
        readonly state: SettlementState;
        readonly retrySafe: boolean;
        readonly receipt: null | {
          readonly paidFils: number;
          readonly recordedAt: string;
        };
      };
      readonly recovery: BookingPayoutRecovery;
    };

export type OwnerBookingEarnings =
  | { readonly status: "not-captured" }
  | { readonly status: "unavailable" }
  | {
      readonly status:
        | "eligible"
        | "not-yet-eligible"
        | "blocked"
        | "pending"
        | "attention"
        | "no-payout"
        | "paid";
      readonly bookingPriceFils: number;
      readonly bookingServiceFeeFils: number;
      readonly originalMarketplaceCommissionFils: number;
      readonly currentMarketplaceCommissionFils: number;
      readonly completedBookingPriceRefundFils: number;
      readonly completedBookingServiceFeeRefundFils: number;
      readonly pendingBookingPriceRefundFils: number;
      readonly pendingBookingServiceFeeRefundFils: number;
      readonly currentNetPayoutFils: number;
      readonly expectedUnpaidPayoutFils: number;
      readonly paidPayoutFils: number;
      readonly recoveryExposureFils: number;
      readonly recoveryBalanceFils: number;
      readonly paidWhileBlocked: boolean;
      readonly paidAt: string | null;
      readonly causes: readonly OwnerBookingEarningsCause[];
    };

export type OwnerBookingEarningsCause =
  | "administrator-hold"
  | "open-dispute"
  | "resolving-dispute"
  | "refund-pending"
  | "refund-failed"
  | "settlement-stale"
  | "settlement-pending"
  | "settlement-indeterminate"
  | "settlement-failed"
  | "settlement-not-executed"
  | "completion-pending"
  | "full-refund"
  | "zero-entitlement"
  | "paid-while-blocked"
  | "recovery-required";

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid owner earnings facts");
  return value as Record<string, unknown>;
};
const choice = <T extends string>(value: unknown, values: readonly T[]): T => {
  if (!values.includes(value as T))
    throw new Error("Invalid owner earnings state");
  return value as T;
};
const money = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid owner earnings amount");
  return value;
};
const allocation = (value: unknown): RefundAllocation => {
  const source = object(value);
  const result = {
    bookingPriceFils: money(source.bookingPriceFils),
    bookingServiceFeeFils: money(source.bookingServiceFeeFils),
  };
  refundAllocationTotal(result);
  exactMarketplaceCommission(result.bookingPriceFils);
  return result;
};
const timestamp = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("Invalid owner earnings timestamp");
  return value;
};

export function parseOwnerBookingEarningsFacts(
  value: unknown,
): OwnerBookingEarningsFacts {
  const source = object(value);
  if (source.status === "not-captured" || source.status === "unavailable")
    return { status: source.status };
  if (source.status !== "captured")
    throw new Error("Invalid owner earnings availability");
  const captured = allocation(source.captured);
  const refunded = allocation(source.refunded);
  const reserved = allocation(source.reserved);
  const obligation = allocation(source.obligation);
  refundCapacity({ captured, refunded, reserved });
  refundCapacity({
    captured,
    refunded: obligation,
    reserved: {
      bookingPriceFils: 0,
      bookingServiceFeeFils: 0,
    },
  });
  if (
    source.marketplaceCommissionRateBasisPoints !== 1_000 ||
    money(source.marketplaceCommissionAmountFils) !==
      exactMarketplaceCommission(captured.bookingPriceFils)
  )
    throw new Error("Invalid owner earnings commission snapshot");
  if (!Array.isArray(source.refunds) || !Array.isArray(source.disputes))
    throw new Error("Invalid owner earnings history");
  const refunds = source.refunds.map((value) => {
    const refund = object(value);
    return {
      state: choice(refund.state, [
        "requested",
        "processing",
        "unknown",
        "succeeded",
        "failed",
      ] as const),
      allocation: allocation(refund.allocation),
    };
  });
  const disputes = source.disputes.map((value) => {
    const dispute = object(value);
    const state = choice(dispute.state, [
      "open",
      "resolving",
      "resolved",
    ] as const);
    const outcome =
      dispute.outcome === null
        ? null
        : choice(dispute.outcome, [
            "owner_won",
            "customer_won",
            "partial_customer_award",
          ] as const);
    if (
      (state === "open") !== (outcome === null) ||
      (state === "resolving" && outcome === "owner_won")
    )
      throw new Error("Invalid owner earnings dispute");
    return { state, outcome };
  });
  if (typeof source.administratorHoldActive !== "boolean")
    throw new Error("Invalid owner earnings hold state");
  const settlementSource =
    source.settlement === null ? null : object(source.settlement);
  const settlement = settlementSource
    ? {
        amountFils: money(settlementSource.amountFils),
        state: choice(settlementSource.state, [
          "requested",
          "processing",
          "indeterminate",
          "succeeded",
          "failed",
          "not-executed",
        ] as const),
        retrySafe:
          typeof settlementSource.retrySafe === "boolean"
            ? settlementSource.retrySafe
            : (() => {
                throw new Error("Invalid owner earnings retry state");
              })(),
        receipt:
          settlementSource.receipt === null
            ? null
            : (() => {
                const receipt = object(settlementSource.receipt);
                return {
                  paidFils: money(receipt.paidFils),
                  recordedAt: timestamp(receipt.recordedAt),
                };
              })(),
      }
    : null;
  if (settlement && settlement.amountFils <= 0)
    throw new Error("Invalid owner earnings settlement amount");
  return {
    status: "captured",
    captured,
    refunded,
    reserved,
    obligation,
    marketplaceCommissionRateBasisPoints: 1_000,
    marketplaceCommissionAmountFils: money(
      source.marketplaceCommissionAmountFils,
    ),
    refunds,
    maturity: parseBookingCompletionEligibility(source.maturity),
    administratorHoldActive: source.administratorHoldActive,
    disputes,
    settlement,
    recovery: parseBookingPayoutRecovery(source.recovery),
  };
}

export function parseOwnerBookingEarningsAvailability(
  value: unknown,
): OwnerBookingEarningsFacts {
  try {
    return parseOwnerBookingEarningsFacts(value);
  } catch {
    return { status: "unavailable" };
  }
}

export function ownerBookingEarnings(
  facts: OwnerBookingEarningsFacts,
): OwnerBookingEarnings {
  if (facts.status !== "captured") return facts;
  const presentation = bookingFinancialPresentation({
    captured: facts.captured,
    refunded: facts.refunded,
    obligation: facts.obligation,
    pending: refundAllocationTotal(facts.reserved) > 0,
  });
  if (
    facts.marketplaceCommissionRateBasisPoints !== 1_000 ||
    facts.marketplaceCommissionAmountFils !==
      presentation.originalCommissionFils
  )
    throw new Error("Owner earnings conflict with the booking snapshot");
  const settlement = facts.settlement;
  const recovery = facts.recovery;
  const validPaid =
    settlement?.state === "succeeded" &&
    settlement.receipt !== null &&
    recovery.status === "paid" &&
    settlement.amountFils === settlement.receipt.paidFils &&
    settlement.amountFils === recovery.paidFils;
  const hasPaidEvidence =
    settlement?.state === "succeeded" ||
    (settlement !== null && settlement.receipt !== null) ||
    recovery.status === "paid";
  if (hasPaidEvidence && !validPaid)
    throw new Error("Owner earnings payment evidence is contradictory");
  if (recovery.status === "unavailable")
    throw new Error("Owner earnings recovery is unavailable");

  const currentOwnerShare = presentation.ownerShareAfterCompletedRefundsFils;
  const expectedUnpaidPayoutFils =
    validPaid || presentation.fullRefundRequired ? 0 : currentOwnerShare;
  const causes: OwnerBookingEarningsCause[] = [];
  if (facts.administratorHoldActive) causes.push("administrator-hold");
  if (facts.disputes.some((dispute) => dispute.state === "open"))
    causes.push("open-dispute");
  if (facts.disputes.some((dispute) => dispute.state === "resolving"))
    causes.push("resolving-dispute");
  if (
    refundAllocationTotal(facts.reserved) > 0 ||
    facts.refunds.some((refund) =>
      ["requested", "processing", "unknown"].includes(refund.state),
    )
  )
    causes.push("refund-pending");
  if (facts.refunds.some((refund) => refund.state === "failed"))
    causes.push("refund-failed");
  if (!validPaid && settlement && settlement.amountFils !== currentOwnerShare)
    causes.push("settlement-stale");
  if (settlement?.state === "requested" || settlement?.state === "processing")
    causes.push("settlement-pending");
  if (settlement?.state === "indeterminate")
    causes.push("settlement-indeterminate");
  if (settlement?.state === "failed") causes.push("settlement-failed");
  if (settlement?.state === "not-executed")
    causes.push("settlement-not-executed");
  if (!facts.maturity.payoutPrerequisiteAvailable)
    causes.push("completion-pending");
  if (presentation.fullRefundRequired) causes.push("full-refund");
  if (currentOwnerShare === 0) causes.push("zero-entitlement");
  if (validPaid && recovery.paidWhileBlocked) causes.push("paid-while-blocked");
  if (validPaid && recovery.recoveryBalanceFils > 0)
    causes.push("recovery-required");
  let status: Exclude<
    OwnerBookingEarnings,
    { status: "not-captured" | "unavailable" }
  >["status"];
  if (validPaid) status = "paid";
  else if (
    facts.administratorHoldActive ||
    facts.disputes.some((dispute) => dispute.state !== "resolved")
  )
    status = "blocked";
  else if (settlement && settlement.amountFils !== currentOwnerShare)
    status = "attention";
  else if (
    settlement &&
    ["requested", "processing", "indeterminate"].includes(settlement.state)
  )
    status = "pending";
  else if (
    (settlement && ["failed", "not-executed"].includes(settlement.state)) ||
    facts.refunds.some((refund) => refund.state === "failed")
  )
    status = "attention";
  else if (presentation.fullRefundRequired || currentOwnerShare === 0)
    status = "no-payout";
  else if (
    refundAllocationTotal(facts.reserved) > 0 ||
    facts.refunds.some((refund) => refund.state !== "succeeded")
  )
    status = "blocked";
  else if (!facts.maturity.payoutPrerequisiteAvailable)
    status = "not-yet-eligible";
  else status = "eligible";

  return {
    status,
    bookingPriceFils: facts.captured.bookingPriceFils,
    bookingServiceFeeFils: facts.captured.bookingServiceFeeFils,
    originalMarketplaceCommissionFils: presentation.originalCommissionFils,
    currentMarketplaceCommissionFils: exactMarketplaceCommission(
      facts.captured.bookingPriceFils - facts.refunded.bookingPriceFils,
    ),
    completedBookingPriceRefundFils: facts.refunded.bookingPriceFils,
    completedBookingServiceFeeRefundFils: facts.refunded.bookingServiceFeeFils,
    pendingBookingPriceRefundFils: facts.reserved.bookingPriceFils,
    pendingBookingServiceFeeRefundFils: facts.reserved.bookingServiceFeeFils,
    currentNetPayoutFils: currentOwnerShare,
    expectedUnpaidPayoutFils,
    paidPayoutFils: validPaid ? recovery.paidFils : 0,
    recoveryExposureFils: validPaid ? recovery.recoveryExposureFils : 0,
    recoveryBalanceFils: validPaid ? recovery.recoveryBalanceFils : 0,
    paidWhileBlocked: validPaid ? recovery.paidWhileBlocked : false,
    paidAt: validPaid ? settlement.receipt.recordedAt : null,
    causes,
  };
}

export function ownerBookingEarningsTotals(
  rows: readonly OwnerBookingEarnings[],
):
  | { readonly status: "unavailable" }
  | {
      readonly status: "available";
      readonly expectedUnpaidPayoutFils: number;
      readonly paidPayoutFils: number;
    } {
  let expectedUnpaidPayoutFils = 0;
  let paidPayoutFils = 0;
  for (const row of rows) {
    if (row.status === "unavailable") return { status: "unavailable" };
    if (row.status === "not-captured") continue;
    expectedUnpaidPayoutFils += row.expectedUnpaidPayoutFils;
    paidPayoutFils += row.paidPayoutFils;
    if (
      !Number.isSafeInteger(expectedUnpaidPayoutFils) ||
      !Number.isSafeInteger(paidPayoutFils)
    )
      return { status: "unavailable" };
  }
  return { status: "available", expectedUnpaidPayoutFils, paidPayoutFils };
}
