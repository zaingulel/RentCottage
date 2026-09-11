import { describe, expect, it, vi } from "vitest";

import {
  createBookingCancellation,
  type BookingCancellationCommand,
} from "./booking-cancellation";

const command: BookingCancellationCommand = {
  bookingRequestId: "60000000-0000-4000-8000-000000001001",
  commandId: "60000000-0000-4000-8000-000000003801",
  actorRole: "customer",
  reason: null,
  category: null,
};
const captured = {
  bookingPriceFils: 110_000_000,
  bookingServiceFeeFils: 5_000_000,
};
const facts = {
  bookingRequestId: command.bookingRequestId,
  revision: "revision-1",
  firstStartsAt: "2099-08-22T05:00:00.000Z",
  observedAt: "2099-08-20T05:00:00.000Z",
  captured,
};
const cancelled = {
  status: "cancelled" as const,
  bookingRequestId: command.bookingRequestId,
  cancellationId: "60000000-0000-4000-8000-000000003802",
  occurredAt: facts.observedAt,
  refundObligation: captured,
};

describe("booking cancellation application", () => {
  it("selects the full price and fee from the authoritative purchased facts", async () => {
    const commit = vi.fn().mockResolvedValue(cancelled);
    const application = createBookingCancellation({
      facts: vi.fn().mockResolvedValue(facts),
      commit,
    });
    expect(await application.cancel(command)).toEqual(cancelled);
    expect(commit).toHaveBeenCalledWith(command, {
      revision: "revision-1",
      refundObligation: {
        bookingPriceFils: 110_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
    });
  });

  it("re-evaluates a stale decision when the database clock crosses the refund deadline", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(facts)
      .mockResolvedValue({
        ...facts,
        observedAt: "2099-08-20T05:00:00.001Z",
        revision: "revision-2",
      });
    const commit = vi
      .fn()
      .mockResolvedValueOnce({ status: "stale" })
      .mockResolvedValue({
        ...cancelled,
        refundObligation: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
      });
    const application = createBookingCancellation({ facts: read, commit });
    expect((await application.cancel(command)).refundObligation).toEqual({
      bookingPriceFils: 0,
      bookingServiceFeeFils: 0,
    });
    expect(commit).toHaveBeenLastCalledWith(command, {
      revision: "revision-2",
      refundObligation: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
    });
  });

  it.each(["cottage_owner", "platform_administrator"] as const)(
    "selects a full late refund for %s and preserves the attributed command",
    async (actorRole) => {
      const commit = vi.fn().mockResolvedValue(cancelled);
      const attributed = {
        ...command,
        actorRole,
        reason: "Unsafe electrical supply",
        category:
          actorRole === "platform_administrator" ? ("safety" as const) : null,
      };
      const application = createBookingCancellation({
        facts: vi.fn().mockResolvedValue({
          ...facts,
          observedAt: "2099-08-22T05:00:00.000Z",
        }),
        commit,
      });
      expect(await application.cancel(attributed)).toEqual(cancelled);
      expect(commit).toHaveBeenCalledWith(attributed, {
        revision: "revision-1",
        refundObligation: captured,
      });
    },
  );

  it("rejects facts for another booking before committing a decision", async () => {
    const commit = vi.fn();
    const application = createBookingCancellation({
      facts: vi
        .fn()
        .mockResolvedValue({ ...facts, bookingRequestId: "another-booking" }),
      commit,
    });
    await expect(application.cancel(command)).rejects.toThrow(
      "another booking",
    );
    expect(commit).not.toHaveBeenCalled();
  });

  it("reports repeated contention instead of returning a false cancellation", async () => {
    const application = createBookingCancellation({
      facts: vi.fn().mockResolvedValue(facts),
      commit: vi.fn().mockResolvedValue({ status: "stale" }),
    });
    await expect(application.cancel(command)).rejects.toThrow(
      "changed during cancellation",
    );
  });
});
