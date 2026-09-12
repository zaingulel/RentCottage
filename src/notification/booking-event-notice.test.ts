import { describe, expect, it } from "vitest";
import {
  bookingEventNotice,
  type RefundBookingNoticeEvent,
} from "./booking-event-notice";
const candidate = {
  locale: "en" as const,
  recipientRole: "customer" as const,
  bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
  bookingReference: "BOOKING-38",
  event: {
    id: "00000000-0000-4000-8000-000000000081",
    kind: "refund_requested" as const,
    allocation: { bookingPriceFils: 30000000, bookingServiceFeeFils: 1000000 },
  },
};
describe("booking event notices", () => {
  it.each([
    ["en", "Prepare for your stay", "View booking"],
    ["ar", "استعد لإقامتك", "عرض الحجز"],
    ["ckb", "بۆ مانەوەکەت ئامادە بە", "بینینی حجز"],
  ] as const)(
    "uses private-detail links instead of embedding preparation details in %s",
    (locale, title, linkLabel) => {
      const notice = bookingEventNotice({
        ...candidate,
        locale,
        event: {
          id: "00000000-0000-4000-8000-000000000082",
          kind: "preparation_reminder",
          dueAt: "2100-12-31T21:30:00Z",
          firstStartsAt: "2101-01-01T21:30:00Z",
        },
      });
      expect(notice).toMatchObject({
        kind: "preparation_reminder",
        title,
        linkLabel,
        detailsPath: `/${locale}/booking-requests/RC-REQ-AAAAAAAAAAAAAAAA`,
      });
      expect(JSON.stringify(notice)).not.toMatch(/address|phone|location/i);
      expect(notice).not.toHaveProperty("allocation");
    },
  );
  it.each([
    ["en", "Refund requested", "View booking"],
    ["ar", "تم طلب الاسترداد", "عرض الحجز"],
    ["ckb", "داوای گەڕاندنەوەی پارە کرا", "بینینی حجز"],
  ] as const)(
    "uses localized safe content and the authenticated %s route",
    (locale, title, linkLabel) => {
      expect(bookingEventNotice({ ...candidate, locale })).toMatchObject({
        kind: "refund_requested",
        title,
        linkLabel,
        detailsPath: `/${locale}/booking-requests/RC-REQ-AAAAAAAAAAAAAAAA`,
        bookingReference: "BOOKING-38",
        allocation: {
          bookingPriceFils: 30000000,
          bookingServiceFeeFils: 1000000,
        },
        fictional: true,
      });
    },
  );
  it("distinguishes a request from verified returned money", () => {
    expect(bookingEventNotice(candidate).body).toBe(
      "A refund of IQD 31,000 was requested. View your booking for its current status. Booking price: IQD 30,000. Service fee: IQD 1,000.",
    );
    expect(
      bookingEventNotice({
        ...candidate,
        event: { ...candidate.event, kind: "refund_returned" },
      }).body,
    ).toBe(
      "A refund of IQD 31,000 has been verified as returned. Booking price: IQD 30,000. Service fee: IQD 1,000.",
    );
  });
  it("does not imply that cancellation itself returned funds", () => {
    expect(
      bookingEventNotice({
        ...candidate,
        event: { ...candidate.event, kind: "cancelled" },
      }),
    ).toMatchObject({
      title: "Booking cancelled",
      body: "This booking is cancelled. View your booking for refund progress.",
    });
  });
  it("describes the attention event without claiming its status is still current", () => {
    expect(
      bookingEventNotice({
        ...candidate,
        event: { ...candidate.event, kind: "refund_attention" },
      }),
    ).toMatchObject({
      title: "Refund attention recorded",
      body: "A refund of IQD 31,000 required attention. View your booking for its current status. Booking price: IQD 30,000. Service fee: IQD 1,000.",
    });
  });
  it.each([
    ["en", "was requested", "required attention", "current status"],
    ["ar", "تم طلب", "تطلب", "الحالية"],
    ["ckb", "داوای", "پێویستی بە بەدواداچوون هەبوو", "ئێستای"],
  ] as const)(
    "keeps delayed requested and attention notices historical after a returned event in %s",
    (locale, requested, attention, current) => {
      const returned = bookingEventNotice({
        ...candidate,
        locale,
        event: { ...candidate.event, kind: "refund_returned" },
      });
      const delayed = ["refund_requested", "refund_attention"].map((kind) =>
        bookingEventNotice({
          ...candidate,
          locale,
          event: {
            ...candidate.event,
            kind: kind as RefundBookingNoticeEvent["kind"],
          },
        }),
      );
      expect(returned.kind).toBe("refund_returned");
      expect(delayed[0].body).toContain(requested);
      expect(delayed[1].body).toContain(attention);
      for (const notice of delayed) {
        expect(notice.body).toContain(current);
        expect(notice.detailsPath).toBe(
          `/${locale}/booking-requests/RC-REQ-AAAAAAAAAAAAAAAA`,
        );
      }
    },
  );
  it("retains exact fils and the owner's authenticated route", () => {
    const result = bookingEventNotice({
      ...candidate,
      recipientRole: "cottage_owner",
      event: {
        ...candidate.event,
        allocation: {
          bookingPriceFils: 30000010,
          bookingServiceFeeFils: 1000001,
        },
      },
    });
    expect(result.body).toContain("IQD 31,000.011");
    expect(result.detailsPath).toBe(
      "/en/owner/booking-requests/RC-REQ-AAAAAAAAAAAAAAAA",
    );
  });
  it("excludes raw reasons, incident fields and private access even if present in the input", () => {
    const input = {
      ...candidate,
      reason: "PRIVATE administrator reason",
      address: "PRIVATE address",
      phone: "PRIVATE phone",
      event: {
        ...candidate.event,
        reason: "PRIVATE incident",
        allocation: {
          ...candidate.event.allocation,
          privateDetail: "PRIVATE access",
        },
      },
    };
    const notice = bookingEventNotice(input);
    expect(Object.keys(notice).sort()).toEqual([
      "allocation",
      "body",
      "bookingReference",
      "detailsPath",
      "fictional",
      "kind",
      "linkLabel",
      "title",
    ]);
    expect(JSON.stringify(notice)).not.toContain("PRIVATE");
  });
});
