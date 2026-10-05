import { describe, expect, it } from "vitest";

import { bookingRequestProgressSteps } from "@/booking-request/booking-request-progress";
import { bookingRequestStatuses } from "@/booking-request/booking-request-status";
import { bookingRequestDeclineReasons } from "@/booking-request/booking-request-lifecycle";
import {
  administratorPaymentHistoryCodeMessages,
  administratorPaymentHistoryMessages,
} from "./administrator-payment-history-messages";
import {
  bookingRequestDeclineReasonMessages,
  bookingRequestDisplayStatusMessages,
  bookingRequestProgressMessages,
  bookingRequestStatusMessages,
  bookingRequestPaymentRequiredExpiryMessages,
} from "./booking-request-status-messages";

describe("Booking Request lifecycle copy", () => {
  it.each(["en", "ar", "ckb"] as const)(
    "maps every status and decline reason to %s user copy",
    (locale) => {
      for (const status of bookingRequestStatuses) {
        const label = bookingRequestStatusMessages[locale][status];
        expect(label).toEqual(expect.any(String));
        expect(label.trim()).not.toBe("");
        expect(label).not.toBe(status);
      }
      for (const reason of bookingRequestDeclineReasons) {
        const label = bookingRequestDeclineReasonMessages[locale][reason];
        expect(label).toEqual(expect.any(String));
        expect(label.trim()).not.toBe("");
        expect(label).not.toBe(reason);
      }
    },
  );

  it.each(["en", "ar", "ckb"] as const)(
    "names every progress step and state in %s",
    (locale) => {
      const copy = bookingRequestProgressMessages[locale];
      expect(copy.label).toEqual(expect.any(String));
      expect(copy.label.trim()).not.toBe("");
      for (const step of bookingRequestProgressSteps) {
        const name = copy.steps[step];
        expect(name).toEqual(expect.any(String));
        expect(name.trim()).not.toBe("");
        expect(name).not.toBe(step);
      }
      for (const state of [
        "completed",
        "current",
        "action-required",
        "stopped",
        "upcoming",
      ] as const) {
        const name = copy.states[state];
        expect(name).toEqual(expect.any(String));
        expect(name.trim()).not.toBe("");
        expect(name).not.toBe(state);
      }
    },
  );

  it.each([
    ["en", "Payment confirmation pending", "Booking confirmed"],
    ["ar", "بانتظار تأكيد الدفع", "تم تأكيد الحجز"],
    ["ckb", "چاوەڕێی پشتڕاستکردنەوەی پارەدان", "حجز پشتڕاست کراوەتەوە"],
  ] as const)(
    "distinguishes capture processing from paid confirmation in %s",
    (locale, captureProcessing, paidConfirmed) => {
      expect(
        bookingRequestDisplayStatusMessages[locale]["capture-processing"],
      ).toBe(captureProcessing);
      expect(
        bookingRequestDisplayStatusMessages[locale]["paid-confirmed"],
      ).toBe(paidConfirmed);
    },
  );
});

it.each([
  [
    "en",
    "Expired unpaid",
    "could not yet be verified",
    "remain held",
    "authorisations have been released",
  ],
  [
    "ar",
    "انتهى الطلب دون دفع",
    "لم نتمكن بعد من التحقق",
    "محجوزة",
    "تم تحرير تفويضات الدفع",
  ],
  [
    "ckb",
    "داواکارییەکە بەبێ پارەدان بەسەرچوو",
    "هێشتا نەمانتوانیوە",
    "گیراو دەمێننەوە",
    "مۆڵەتەکانی پارەدان ئازاد کراون",
  ],
] as const)(
  "distinguishes held uncertainty from safe unpaid expiry in %s",
  (locale, label, unresolved, held, released) => {
    const copy = bookingRequestPaymentRequiredExpiryMessages[locale];
    expect(copy.attention).toContain(unresolved);
    expect(copy.attention).toContain(held);
    expect(copy.attention).not.toContain(released);
    expect(copy.expiredLabel).toBe(label);
    expect(copy.expiredDescription).toContain(released);
    expect(copy.expiredDescription).not.toContain(held);
  },
);

it("Arabic payment copy distinguishes collection recovery from returned money", () => {
  const recoveryCodes = [
    "recovery-evidence-invalid",
    "unexplained-recovery-provider-operation",
    "recovery-operation-indeterminate",
    "unsafe-recovery-original-release-indeterminate",
    "unsafe-recovery-original-release-failed",
    "unsafe-recovery-replacement-authorization-indeterminate",
    "unsafe-recovery-replacement-capture-indeterminate",
    "unsafe-recovery-replacement-release-indeterminate",
    "unsafe-recovery-replacement-release-failed",
    "admitted",
  ] as const;

  for (const code of recoveryCodes) {
    const label = administratorPaymentHistoryCodeMessages.ar[code];
    expect(label).toContain("تعثّر الدفع");
    expect(label).not.toContain("استرداد");
  }
  const generation = administratorPaymentHistoryMessages.ar.recoveryGeneration;
  expect(generation).toContain("تعثّر الدفع");
  expect(generation).not.toContain("استرداد");

  const refunding = bookingRequestPaymentRequiredExpiryMessages.ar;
  expect(refunding.refundingLabel).toContain("إرجاع المبلغ");
  expect(refunding.refundingDescription).toContain("إرجاع المبلغ");
  expect(refunding.refundingDescription).toContain("الحجز غير مؤكد");
  expect(refunding.refundingDescription).toContain("محجوزة");
});
