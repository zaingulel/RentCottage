import { describe, expect, it } from "vitest";

import { ownerDisplayFixtures } from "../../tests/fixtures/booking-request-display.fixtures";
import { waitingBookingRequestCount } from "./booking-request-display";

const pending = {
  ...ownerDisplayFixtures["capture-processing"],
  status: "pending" as const,
};

describe("waitingBookingRequestCount", () => {
  it("counts only the pending Booking Requests as waiting", () => {
    expect(
      waitingBookingRequestCount([
        pending,
        ownerDisplayFixtures["capture-processing"],
        pending,
        ownerDisplayFixtures["payment-required-open"],
      ]),
    ).toBe(2);
    expect(waitingBookingRequestCount([])).toBe(0);
  });
});
