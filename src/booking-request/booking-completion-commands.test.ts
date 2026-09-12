import { describe, expect, it, vi } from "vitest";

import {
  createBookingNoShow,
  type BookingNoShowCommand,
} from "./booking-completion-commands";

const noShowCommand: BookingNoShowCommand = {
  bookingRequestId: "60000000-0000-4000-8000-000000003901",
  commandId: "60000000-0000-4000-8000-000000003902",
  reason: "Customer did not arrive for the purchased period.",
};
const noShowFacts = {
  bookingRequestId: noShowCommand.bookingRequestId,
  revision: "a".repeat(32),
  firstStartsAt: "2099-08-24T08:00:00.000Z",
  observedAt: "2099-08-24T08:00:00.000Z",
  captured: {
    bookingPriceFils: 110_000_000,
    bookingServiceFeeFils: 5_000_000,
  },
};

describe("booking no-show application", () => {
  it("commits a literal zero refund from immutable captured facts", async () => {
    const commit = vi.fn().mockResolvedValue({
      status: "no_show",
      bookingRequestId: noShowCommand.bookingRequestId,
      noShowId: "60000000-0000-4000-8000-000000003903",
      occurredAt: noShowFacts.observedAt,
      refundObligation: {
        bookingPriceFils: 0,
        bookingServiceFeeFils: 0,
      },
    });
    const application = createBookingNoShow({
      facts: vi.fn().mockResolvedValue(noShowFacts),
      commit,
    });

    await expect(application.record(noShowCommand)).resolves.toMatchObject({
      status: "no_show",
      refundObligation: {
        bookingPriceFils: 0,
        bookingServiceFeeFils: 0,
      },
    });
    expect(commit).toHaveBeenCalledExactlyOnceWith(noShowCommand, {
      revision: noShowFacts.revision,
      refundObligation: {
        bookingPriceFils: 0,
        bookingServiceFeeFils: 0,
      },
    });
  });

  it("re-reads authoritative facts after contention", async () => {
    const facts = vi.fn().mockResolvedValue(noShowFacts);
    const commit = vi
      .fn()
      .mockResolvedValueOnce({ status: "stale" })
      .mockResolvedValue({
        status: "no_show",
        bookingRequestId: noShowCommand.bookingRequestId,
        noShowId: "60000000-0000-4000-8000-000000003903",
        occurredAt: noShowFacts.observedAt,
        refundObligation: {
          bookingPriceFils: 0,
          bookingServiceFeeFils: 0,
        },
      });
    await createBookingNoShow({ facts, commit }).record(noShowCommand);
    expect(facts).toHaveBeenCalledTimes(2);
  });
});
