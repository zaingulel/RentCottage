import type { Fils, RefundAllocation } from "@/payment/payment-contract";
import {
  exactMarketplaceCommission,
  refundAllocationTotal,
} from "@/payment/payment-refund-allocation";

import { paymentInstant } from "./booking-request-payment-observation";

const FORTY_EIGHT_HOURS_MICROSECONDS = 48n * 60n * 60n * 1_000_000n;

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
  const startsAtInstant = timestampInstant(firstStartsAt);
  const evaluatedAtInstant = timestampInstant(evaluatedAt);
  const customerTotalFils = refundAllocationTotal(captured);
  exactMarketplaceCommission(captured.bookingPriceFils);
  const fullRefund =
    outcome === "owner_cancellation" ||
    outcome === "administrator_cancellation" ||
    (outcome === "customer_cancellation" &&
      startsAtInstant - evaluatedAtInstant >= FORTY_EIGHT_HOURS_MICROSECONDS);
  return fullRefund
    ? { amountFils: customerTotalFils, allocation: { ...captured } }
    : {
        amountFils: 0,
        allocation: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
      };
}

function timestampInstant(value: string): bigint {
  const milliseconds = Date.parse(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(milliseconds)) {
    throw new TypeError(
      "Cancellation policy requires valid timestamps with an explicit timezone.",
    );
  }
  return paymentInstant(value);
}
