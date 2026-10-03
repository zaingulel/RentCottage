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
  "self-booking-not-allowed",
  "quote-stale",
  "too-late",
  "authorization-failed",
  "payment-unavailable",
  "reconciliation-required",
  "unavailable",
] as const satisfies readonly SubmissionFailureStatus[];

describe("Booking Request error messages", () => {
  it("anchors the Arabic request cutoff to the first shift", () => {
    expect(bookingRequestMessages.ar.errors["too-late"]).toContain(
      "بداية أول فترة محجوزة",
    );
    expect(bookingRequestMessages.ar.errors["too-late"]).toContain("بست ساعات");
  });

  it("describes online payment authorisation without promising launch access", () => {
    expect(bookingRequestMessages.ar.futureBody).toContain(
      "حجز المبلغ عبر الإنترنت",
    );
    expect(bookingRequestMessages.ar.futureBody).toContain(
      "بعد اكتمال فحوصات الإطلاق",
    );
  });

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
