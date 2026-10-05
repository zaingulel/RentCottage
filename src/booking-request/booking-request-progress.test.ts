import { describe, expect, it } from "vitest";

import { customerBookingRequestProgress } from "./booking-request-progress";

const openWindow = {
  recordedAt: "2099-08-20T00:00:00.000Z",
  deadline: "2099-08-20T00:20:00.000Z",
  phase: "open",
} as const;
const elapsedWindow = { ...openWindow, phase: "elapsed" } as const;
const unpaidExpiry = {
  status: "expired",
  deadline: "2099-08-20T00:20:00.000Z",
} as const;

describe("Customer Booking Request progress", () => {
  it("derives the four steps for every display status", () => {
    const rows = [
      ["pending", null, null, ["completed", "current", "upcoming", "upcoming"]],
      [
        "processing",
        null,
        null,
        ["completed", "stopped", "upcoming", "upcoming"],
      ],
      [
        "declined",
        null,
        null,
        ["completed", "stopped", "upcoming", "upcoming"],
      ],
      [
        "withdrawn",
        null,
        null,
        ["completed", "stopped", "upcoming", "upcoming"],
      ],
      ["expired", null, null, ["completed", "stopped", "upcoming", "upcoming"]],
      [
        "expired",
        null,
        unpaidExpiry,
        ["completed", "completed", "stopped", "upcoming"],
      ],
      [
        "accepted",
        null,
        null,
        ["completed", "completed", "current", "upcoming"],
      ],
      [
        "capture-processing",
        null,
        null,
        ["completed", "completed", "current", "upcoming"],
      ],
      [
        "payment-required",
        openWindow,
        null,
        ["completed", "completed", "action-required", "upcoming"],
      ],
      [
        "payment-required",
        elapsedWindow,
        null,
        ["completed", "completed", "current", "upcoming"],
      ],
      [
        "paid-confirmed",
        null,
        null,
        ["completed", "completed", "completed", "completed"],
      ],
    ] as const;

    for (const [
      status,
      paymentRequiredWindow,
      paymentRequiredExpiry,
      states,
    ] of rows) {
      const progress = customerBookingRequestProgress(status, {
        paymentRequiredWindow,
        paymentRequiredExpiry,
      });
      const label = `${status} window=${paymentRequiredWindow?.phase ?? "none"} expiry=${paymentRequiredExpiry?.status ?? "none"}`;

      expect(
        progress.map(({ step }) => step),
        label,
      ).toEqual(["requested", "owner-decision", "payment", "confirmed"]);
      expect(
        progress.map(({ state }) => state),
        label,
      ).toEqual(states);
    }
  });
});
