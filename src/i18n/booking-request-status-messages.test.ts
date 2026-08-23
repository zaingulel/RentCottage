import { describe, expect, it } from "vitest";

import { bookingRequestStatuses } from "@/booking-request/booking-request-status";
import { bookingRequestDeclineReasons } from "@/booking-request/booking-request-lifecycle";
import {
  bookingRequestDeclineReasonMessages,
  bookingRequestStatusMessages,
} from "./booking-request-status-messages";

describe("Booking Request lifecycle copy", () => {
  it.each(["en", "ar", "ckb"] as const)(
    "maps every status and decline reason to %s user copy",
    (locale) => {
      for (const status of bookingRequestStatuses) {
        expect(bookingRequestStatusMessages[locale][status]).not.toBe(status);
      }
      for (const reason of bookingRequestDeclineReasons) {
        expect(bookingRequestDeclineReasonMessages[locale][reason]).not.toBe(
          reason,
        );
      }
    },
  );
});
