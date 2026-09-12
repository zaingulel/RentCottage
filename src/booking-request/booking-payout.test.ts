import { describe, expect, it, vi } from "vitest";
import { createBookingPayout, type BookingPayoutFacts } from "./booking-payout";
const bookingRequestId = "60000000-0000-4000-8000-000000001001";
const command = {
  bookingRequestId,
  commandId: "90000000-0000-4000-8000-000000002273",
  action: "resolve_dispute" as const,
  subjectId: "90000000-0000-4000-8000-000000002271",
  reason: "Provider decision",
  outcome: "customer_won" as const,
};
describe("persisted booking payout commands", () => {
  it("selects the full remaining customer award without reducing the original paid allocation", async () => {
    const facts: BookingPayoutFacts = {
      bookingRequestId,
      commands: [],
      reserved: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
      activeHoldIds: [],
      activeDisputeIds: [],
      disputes: [],
      captured: { bookingPriceFils: 100000000, bookingServiceFeeFils: 5000000 },
      refunded: { bookingPriceFils: 10000000, bookingServiceFeeFils: 0 },
    };
    const repository = {
      facts: vi.fn().mockResolvedValue(facts),
      record: vi.fn().mockResolvedValue({ status: "recorded" }),
    };
    await createBookingPayout(repository).record(command);
    expect(repository.record).toHaveBeenCalledWith({
      ...command,
      allocation: {
        bookingPriceFils: 90000000,
        bookingServiceFeeFils: 5000000,
      },
    });
    expect(facts.captured).toEqual({
      bookingPriceFils: 100000000,
      bookingServiceFeeFils: 5000000,
    });
  });
  it("refuses to select a full award from another booking", async () => {
    const repository = {
      facts: vi.fn().mockResolvedValue({ bookingRequestId: "foreign" }),
      record: vi.fn(),
    };
    await expect(
      createBookingPayout(repository).record(command),
    ).rejects.toThrow("another booking");
    expect(repository.record).not.toHaveBeenCalled();
  });
});
