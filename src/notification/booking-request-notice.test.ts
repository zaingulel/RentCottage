import { describe, expect, it } from "vitest";
import {
  bookingRequestNotice,
  type RequestNoticeKind,
} from "./booking-request-notice";
const matrix: ReadonlyArray<
  [RequestNoticeKind, "customer" | "cottage_owner", boolean]
> = [
  ["request_new", "cottage_owner", true],
  ["request_accepted", "customer", false],
  ["request_accepted", "cottage_owner", false],
  ["request_payment_required", "customer", true],
  ["request_declined", "customer", false],
  ["request_declined", "cottage_owner", false],
  ["request_withdrawn", "customer", false],
  ["request_withdrawn", "cottage_owner", false],
  ["request_expired", "customer", false],
  ["request_expired", "cottage_owner", false],
  ["recovery_processing", "customer", true],
  ["recovery_retryable", "customer", true],
  ["recovery_attention", "customer", true],
];
const reference = "RC-REQ-0000000000000228";
describe.each(["en", "ar", "ckb"] as const)(
  "%s request delivery payload",
  (locale) => {
    it.each(matrix)(
      "%s to %s preserves only request facts",
      (kind, recipientRole, timed) => {
        const deadlineAt = timed ? "2101-01-01T08:00:00Z" : null;
        const result = bookingRequestNotice({
          event: { id: "event", sourceId: "source", kind, deadlineAt },
          locale,
          recipientRole,
          bookingRequestReference: reference,
        });
        expect(Object.keys(result).sort()).toEqual(
          [
            "kind",
            "title",
            "body",
            "bookingReference",
            "bookingRequestReference",
            "deadlineAt",
            "detailsPath",
            "linkLabel",
            "fictional",
          ].sort(),
        );
        expect(result).toMatchObject({
          kind,
          bookingReference: null,
          bookingRequestReference: reference,
          deadlineAt,
          fictional: true,
          detailsPath: `/${locale}/${recipientRole === "customer" ? "booking-requests" : "owner/booking-requests"}/${reference}`,
        });
        expect(result.linkLabel).toBe(
          {
            en: "View Booking Request",
            ar: "عرض طلب الحجز",
            ckb: "بینینی داواکاری حجز",
          }[locale],
        );
        if (kind === "request_accepted")
          expect(result.body).toContain(
            {
              en: "the booking is not yet confirmed",
              ar: "لم يتم تأكيد الحجز بعد",
              ckb: "حجزەکە هێشتا پشتڕاست نەکراوەتەوە",
            }[locale],
          );
        if (kind === "request_expired" && locale === "en")
          expect(result.body).not.toMatch(/refund|returned|paid|confirmed/i);
      },
    );
  },
);
