import type { Fils, RefundAllocation } from "@/payment/payment-contract";
import {
  exactMarketplaceCommission,
  refundAllocationTotal,
} from "@/payment/payment-refund-allocation";

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1_000;

export function bookingCancellationRefundObligation({
  outcome,
  firstStartsAt,
  evaluatedAt,
  captured,
}: {
  readonly outcome:
    | "customer_cancellation"
    | "owner_cancellation"
    | "administrator_cancellation"
    | "no_show";
  readonly firstStartsAt: string;
  readonly evaluatedAt: string;
  readonly captured: RefundAllocation;
}): { readonly amountFils: Fils; readonly allocation: RefundAllocation } {
  const startsAtMilliseconds = timestampMilliseconds(firstStartsAt);
  const evaluatedAtMilliseconds = timestampMilliseconds(evaluatedAt);
  const customerTotalFils = refundAllocationTotal(captured);
  exactMarketplaceCommission(captured.bookingPriceFils);
  const fullRefund =
    outcome === "owner_cancellation" ||
    outcome === "administrator_cancellation" ||
    (outcome === "customer_cancellation" &&
      startsAtMilliseconds - evaluatedAtMilliseconds >= FORTY_EIGHT_HOURS_MS);
  return fullRefund
    ? { amountFils: customerTotalFils, allocation: { ...captured } }
    : {
        amountFils: 0,
        allocation: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
      };
}

function timestampMilliseconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(milliseconds)) {
    throw new TypeError(
      "Cancellation policy requires valid timestamps with an explicit timezone.",
    );
  }
  return milliseconds;
}
