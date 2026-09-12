import type { RefundAllocation } from "@/payment/payment-contract";
import {
  exactMarketplaceCommission,
  refundCapacity,
  refundAllocationTotal,
  validateRefundAllocation,
} from "@/payment/payment-refund-allocation";
export function bookingFinancialPresentation(facts: {
  captured: RefundAllocation;
  refunded: RefundAllocation;
  obligation: RefundAllocation;
  pending: boolean;
}) {
  const { remaining } = refundCapacity({
    captured: facts.captured,
    refunded: facts.refunded,
    reserved: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
  });
  const originalCommissionFils = exactMarketplaceCommission(
    facts.captured.bookingPriceFils,
  );
  refundAllocationTotal(facts.obligation);
  return {
    originalCommissionFils,
    originalOwnerShareFils:
      facts.captured.bookingPriceFils - originalCommissionFils,
    ownerShareAfterCompletedRefundsFils:
      remaining.bookingPriceFils -
      exactMarketplaceCommission(remaining.bookingPriceFils),
    fullRefundRequired:
      refundAllocationTotal(facts.captured) > 0 &&
      facts.obligation.bookingPriceFils === facts.captured.bookingPriceFils &&
      facts.obligation.bookingServiceFeeFils ===
        facts.captured.bookingServiceFeeFils,
    pending: facts.pending,
  };
}
function inputFils(value: string): number {
  const normalized = value
    .trim()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace("٫", ".");
  if (!/^\d{1,13}(?:\.\d{1,3})?$/.test(normalized))
    throw new Error("Enter IQD with up to three decimal places.");
  const [whole, fraction = ""] = normalized.split(".");
  const fils = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  if (fils > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Refund amount is too large.");
  return Number(fils);
}
export function refundInputAllocation(
  price: string,
  fee: string,
): RefundAllocation {
  const allocation = {
    bookingPriceFils: inputFils(price),
    bookingServiceFeeFils: inputFils(fee),
  };
  exactMarketplaceCommission(allocation.bookingPriceFils);
  validateRefundAllocation(allocation, allocation);
  return allocation;
}
