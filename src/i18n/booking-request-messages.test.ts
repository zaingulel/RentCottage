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
  "customer-suspended",
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

  it.each([
    [
      "en",
      "Your Customer account is suspended. You cannot send a new Booking Request.",
    ],
    ["ar", "حساب العميل الخاص بك موقوف. لا يمكنك إرسال طلب حجز جديد."],
    [
      "ckb",
      "هەژماری کڕیاری تۆ ڕاگیراوە. ناتوانیت داواکاریی حجزکردنی نوێ بنێریت.",
    ],
  ] satisfies [Locale, string][])(
    "explains the suspended Customer booking restriction in %s without verification or availability advice",
    (locale, expected) => {
      const message = bookingRequestErrorMessage(locale, "customer-suspended");
      expect(message).toBe(expected);
      expect(message).not.toBe(
        bookingRequestErrorMessage(locale, "access-required"),
      );
      expect(message).not.toBe(
        bookingRequestErrorMessage(locale, "unavailable"),
      );
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

it("uses Eastern Arabic digits in the Sorani note hint and preserves booking evidence", () => {
  expect(bookingRequestMessages.ckb).toMatchObject({
    noteHint: "تا ٥٠٠ پیت. زانیاری پەیوەندی مەنووسە.",
    cancellationPolicy:
      "هەڵوەشاندنەوە لانیکەم 48 کاتژمێر پێش شەفت پارەکە بە تەواوی دەگەڕێنێتەوە. لە ناو 48 کاتژمێر یان نەهاتندا پارە ناگەڕێتەوە.",
    inside48Warning:
      "ئەم داواکارییە لە ناو 48 کاتژمێردا دەست پێدەکات و دوای پەسەندکردن پارەکە ناگەڕێتەوە.",
    acceptInside48: "یاسای نەگەڕاندنەوەی پارە لە ناو 48 کاتژمێردا قبوڵ دەکەم.",
  });
  expect(bookingRequestMessages.en).toMatchObject({
    noteHint: "Up to 500 characters. Do not include contact details.",
    cancellationPolicy:
      "Cancel at least 48 hours before the first shift for a full refund. Cancellation inside 48 hours and no-shows receive no refund.",
    inside48Warning:
      "This request begins inside 48 hours and will be non-refundable immediately if accepted.",
    acceptInside48:
      "I understand and accept the inside-48-hours no-refund rule.",
  });
  expect(bookingRequestMessages.ar).toMatchObject({
    noteHint: "حتى 500 حرف. لا تكتب بيانات اتصال.",
    cancellationPolicy:
      "الإلغاء قبل 48 ساعة على الأقل يعيد المبلغ كاملاً. لا استرداد عند الإلغاء خلال 48 ساعة أو عدم الحضور.",
    inside48Warning:
      "يبدأ هذا الطلب خلال 48 ساعة وسيصبح غير قابل للاسترداد فور قبوله.",
    acceptInside48: "أفهم وأوافق على عدم الاسترداد خلال 48 ساعة.",
  });
});
