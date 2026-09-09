import { describe, expect, it } from "vitest";

import { paidConfirmationNotice } from "./paid-confirmation-notice";

describe("paid confirmation notice", () => {
  it.each([
    ["en", "Booking confirmed", "View confirmed booking"],
    ["ar", "تم تأكيد الحجز", "عرض الحجز المؤكد"],
    ["ckb", "حجزەکە پشتڕاست کرایەوە", "بینینی حجزە پشتڕاستکراوەکە"],
  ] as const)(
    "freezes supported %s content without private access data",
    (locale, title, linkLabel) => {
      const notice = paidConfirmationNotice({
        locale,
        recipientRole: "customer",
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
        bookingReference: "CONFIRMED-BOOKING-35",
      });

      expect(notice).toEqual({
        kind: "paid-confirmation",
        title,
        body: expect.stringContaining("CONFIRMED-BOOKING-35"),
        bookingReference: "CONFIRMED-BOOKING-35",
        detailsPath: `/${locale}/booking-requests/RC-REQ-AAAAAAAAAAAAAAAA`,
        linkLabel,
        fictional: true,
      });
      expect(JSON.stringify(notice)).not.toMatch(
        /address|direction|latitude|longitude|phone/i,
      );
    },
  );

  it("uses the Cottage Owner's authenticated route", () => {
    expect(
      paidConfirmationNotice({
        locale: "en",
        recipientRole: "cottage_owner",
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
        bookingReference: "CONFIRMED-BOOKING-35",
      }).detailsPath,
    ).toBe("/en/owner/booking-requests/RC-REQ-AAAAAAAAAAAAAAAA");
  });

  it("maps the stored Sorani locale to the application's ckb route", () => {
    expect(
      paidConfirmationNotice({
        locale: "ckb",
        recipientRole: "cottage_owner",
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
        bookingReference: "CONFIRMED-BOOKING-35",
      }).detailsPath,
    ).toBe("/ckb/owner/booking-requests/RC-REQ-AAAAAAAAAAAAAAAA");
  });
});
