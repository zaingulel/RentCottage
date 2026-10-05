import { describe, expect, it } from "vitest";

import {
  confirmedBookingProgress,
  customerBookingRequestProgress,
} from "./booking-request-progress";

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
const processingExpiry = { ...unpaidExpiry, status: "processing" } as const;

describe("Customer Booking Request progress", () => {
  it("derives the four steps for every display status", () => {
    const rows = [
      [
        "pending",
        null,
        null,
        undefined,
        ["completed", "current", "upcoming", "upcoming"],
      ],
      [
        "processing",
        null,
        null,
        undefined,
        ["completed", "stopped", "upcoming", "upcoming"],
      ],
      [
        "declined",
        null,
        null,
        undefined,
        ["completed", "stopped", "upcoming", "upcoming"],
      ],
      [
        "withdrawn",
        null,
        null,
        undefined,
        ["completed", "stopped", "upcoming", "upcoming"],
      ],
      [
        "expired",
        null,
        null,
        undefined,
        ["completed", "stopped", "upcoming", "upcoming"],
      ],
      [
        "expired",
        null,
        unpaidExpiry,
        undefined,
        ["completed", "completed", "stopped", "upcoming"],
      ],
      [
        "accepted",
        null,
        null,
        undefined,
        ["completed", "completed", "current", "upcoming"],
      ],
      [
        "capture-processing",
        null,
        null,
        undefined,
        ["completed", "completed", "current", "upcoming"],
      ],
      [
        "payment-required",
        openWindow,
        null,
        { status: "available" },
        ["completed", "completed", "action-required", "upcoming"],
      ],
      [
        "payment-required",
        openWindow,
        null,
        { status: "retryable" },
        ["completed", "completed", "action-required", "upcoming"],
      ],
      [
        "payment-required",
        openWindow,
        null,
        { status: "processing" },
        ["completed", "completed", "current", "upcoming"],
      ],
      [
        "payment-required",
        elapsedWindow,
        null,
        undefined,
        ["completed", "completed", "current", "upcoming"],
      ],
      [
        "payment-required",
        elapsedWindow,
        processingExpiry,
        undefined,
        ["completed", "completed", "current", "upcoming"],
      ],
      [
        "paid-confirmed",
        null,
        null,
        undefined,
        ["completed", "completed", "completed", "completed"],
      ],
    ] as const;

    for (const [
      status,
      paymentRequiredWindow,
      paymentRequiredExpiry,
      paymentRecovery,
      states,
    ] of rows) {
      const progress = customerBookingRequestProgress({
        status,
        paymentRequiredWindow,
        paymentRequiredExpiry,
        paymentRecovery,
      });
      const label = `${status} window=${paymentRequiredWindow?.phase ?? "none"} expiry=${paymentRequiredExpiry?.status ?? "none"} recovery=${paymentRecovery?.status ?? "none"}`;

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

  it("marks every step completed for a Confirmed Booking", () => {
    expect(confirmedBookingProgress).toEqual([
      { step: "requested", state: "completed" },
      { step: "owner-decision", state: "completed" },
      { step: "payment", state: "completed" },
      { step: "confirmed", state: "completed" },
    ]);
  });
});
