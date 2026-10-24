import { describe, expect, it } from "vitest";

import { ownerDisplayFixtures } from "../../tests/fixtures/booking-request-display.fixtures";
import {
  isPaymentDisplayStatus,
  isWaitingBookingRequest,
  ownerBookingRequestNotificationDisplay,
  shouldRefreshBookingRequestStatus,
  waitingBookingRequestCount,
} from "./booking-request-display";

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

it("cancelled Owner notifications override payment state and stop refreshing", () => {
  const notification = ownerDisplayFixtures["paid-confirmed"];
  const original = {
    ...notification,
    status: "accepted" as const,
    paymentStatus: "paid-confirmed" as const,
    cancellationStatus: "cancelled" as const,
  };
  const display = ownerBookingRequestNotificationDisplay(original);
  expect(display).toEqual({ ...notification, status: "cancelled" });
  expect(display).not.toHaveProperty("cancellationStatus");
  expect(isPaymentDisplayStatus(display.status)).toBe(false);
  expect(shouldRefreshBookingRequestStatus(display.status)).toBe(false);
  expect(isWaitingBookingRequest(display)).toBe(false);
  expect(waitingBookingRequestCount([pending, display, pending])).toBe(2);
  expect(
    ownerBookingRequestNotificationDisplay({
      ...original,
      cancellationStatus: null,
    }).status,
  ).toBe("paid-confirmed");
  for (const status of [
    "capture-processing",
    "payment-required",
    "paid-confirmed",
  ] as const)
    expect(isPaymentDisplayStatus(status)).toBe(true);
});
