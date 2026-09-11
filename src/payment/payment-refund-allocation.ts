import type { Fils, RefundAllocation } from "./payment-contract";

export function exactMarketplaceCommission(bookingPriceFils: Fils): Fils {
  if (bookingPriceFils % 10 !== 0) {
    throw new Error("10% Marketplace Commission must be exact in fils.");
  }
  return bookingPriceFils / 10;
}

export function refundAllocationTotal(allocation: RefundAllocation): Fils {
  assertRefundAmount(allocation.bookingPriceFils, "Booking Price");
  assertRefundAmount(allocation.bookingServiceFeeFils, "Booking Service Fee");
  const total = allocation.bookingPriceFils + allocation.bookingServiceFeeFils;
  if (!Number.isSafeInteger(total)) {
    throw new Error("Customer Total must be safe integer fils.");
  }
  return total;
}

export function refundCapacity({
  captured,
  refunded,
  reserved,
}: {
  readonly captured: RefundAllocation;
  readonly refunded: RefundAllocation;
  readonly reserved: RefundAllocation;
}): {
  readonly remaining: RefundAllocation;
  readonly available: RefundAllocation;
} {
  const remaining = subtractRefundAllocation(captured, refunded);
  return {
    remaining,
    available: subtractRefundAllocation(remaining, reserved),
  };
}

export function validateRefundAllocation(
  allocation: RefundAllocation,
  capacity: RefundAllocation,
): Fils {
  const amountFils = refundAllocationTotal(allocation);
  if (amountFils === 0) {
    throw new Error("Refund must return a positive amount.");
  }
  subtractRefundAllocation(capacity, allocation);
  return amountFils;
}

function subtractRefundAllocation(
  capacity: RefundAllocation,
  allocation: RefundAllocation,
): RefundAllocation {
  refundAllocationTotal(capacity);
  refundAllocationTotal(allocation);
  exactMarketplaceCommission(capacity.bookingPriceFils);
  if (allocation.bookingPriceFils > capacity.bookingPriceFils) {
    throw new Error("Refund allocation exceeds the remaining Booking Price.");
  }
  if (allocation.bookingServiceFeeFils > capacity.bookingServiceFeeFils) {
    throw new Error(
      "Refund allocation exceeds the remaining Booking Service Fee.",
    );
  }
  const remaining = {
    bookingPriceFils: capacity.bookingPriceFils - allocation.bookingPriceFils,
    bookingServiceFeeFils:
      capacity.bookingServiceFeeFils - allocation.bookingServiceFeeFils,
  };
  exactMarketplaceCommission(remaining.bookingPriceFils);
  return remaining;
}

function assertRefundAmount(amountFils: Fils, name: string): void {
  if (!Number.isSafeInteger(amountFils) || amountFils < 0) {
    throw new Error(
      `${name} refund allocation must be non-negative safe integer fils.`,
    );
  }
}
