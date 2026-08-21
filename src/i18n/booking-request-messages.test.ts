import { describe, expect, it } from "vitest";

import type { SubmissionFailureStatus } from "@/booking-request/booking-request-submission";
import type { Locale } from "./routing";
import {
  bookingRequestErrorMessage,
  bookingRequestMessages,
} from "./booking-request-messages";

const failureStatuses = [
  "invalid",
  "access-required",
  "quote-stale",
  "too-late",
  "authorization-failed",
  "payment-unavailable",
  "reconciliation-required",
  "unavailable",
] as const satisfies readonly SubmissionFailureStatus[];

describe("Booking Request error messages", () => {
  it.each(["en", "ar", "ckb"] satisfies Locale[])(
    "provides exact %s copy for every domain failure status",
    (locale) => {
      expect(Object.keys(bookingRequestMessages[locale].errors).sort()).toEqual(
        [...failureStatuses].sort(),
      );
      for (const status of failureStatuses) {
        expect(bookingRequestErrorMessage(locale, status)).toBeTruthy();
      }
    },
  );

  it("fails loudly for an impossible external status", () => {
    expect(() =>
      bookingRequestErrorMessage(
        "en",
        "provider-invented-status" as SubmissionFailureStatus,
      ),
    ).toThrow("Unknown Booking Request submission status");
  });
});
