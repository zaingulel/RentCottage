import { describe, expect, it } from "vitest";

import type { BookingRequestResponseTimeLeft } from "@/booking-request/booking-request-status";
import type { Locale } from "./routing";
import {
  ownerRequestGuests,
  ownerRequestPeriod,
  ownerRequestTimeLeft,
} from "./owner-booking-request-messages";

describe("owner Booking Request wording", () => {
  it.each<{ locale: Locale; size: number; expected: string }>([
    { locale: "en", size: 1, expected: "1 guest" },
    { locale: "en", size: 4, expected: "4 guests" },
    { locale: "ar", size: 1, expected: "1 ضيف" },
    { locale: "ar", size: 2, expected: "2 ضيفان" },
    { locale: "ar", size: 3, expected: "3 ضيوف" },
    { locale: "ar", size: 11, expected: "11 ضيفًا" },
    { locale: "ar", size: 100, expected: "100 ضيف" },
    { locale: "ckb", size: 1, expected: "١ میوان" },
    { locale: "ckb", size: 12, expected: "١٢ میوان" },
  ])("words the party size in $locale", ({ locale, size, expected }) => {
    expect(ownerRequestGuests(locale, size)).toBe(expected);
  });

  it.each<{
    locale: Locale;
    label: string;
    timeLeft: BookingRequestResponseTimeLeft;
    expected: string;
  }>([
    {
      locale: "en",
      label: "1 hour",
      timeLeft: { unit: "hours", count: 1 },
      expected: "Answer within 1 hour",
    },
    {
      locale: "en",
      label: "5 hours",
      timeLeft: { unit: "hours", count: 5 },
      expected: "Answer within 5 hours",
    },
    {
      locale: "en",
      label: "1 minute",
      timeLeft: { unit: "minutes", count: 1 },
      expected: "Answer within 1 minute",
    },
    {
      locale: "en",
      label: "45 minutes",
      timeLeft: { unit: "minutes", count: 45 },
      expected: "Answer within 45 minutes",
    },
    {
      locale: "en",
      label: "under a minute",
      timeLeft: { unit: "under-a-minute" },
      expected: "Less than a minute left to answer",
    },
    {
      locale: "en",
      label: "elapsed",
      timeLeft: { unit: "elapsed" },
      expected: "The time to answer has ended",
    },
    {
      locale: "ar",
      label: "1 hour",
      timeLeft: { unit: "hours", count: 1 },
      expected: "أجب خلال 1 ساعة",
    },
    {
      locale: "ar",
      label: "2 hours",
      timeLeft: { unit: "hours", count: 2 },
      expected: "أجب خلال 2 ساعتين",
    },
    {
      locale: "ar",
      label: "5 hours",
      timeLeft: { unit: "hours", count: 5 },
      expected: "أجب خلال 5 ساعات",
    },
    {
      locale: "ar",
      label: "11 hours",
      timeLeft: { unit: "hours", count: 11 },
      expected: "أجب خلال 11 ساعة",
    },
    {
      locale: "ar",
      label: "1 minute",
      timeLeft: { unit: "minutes", count: 1 },
      expected: "أجب خلال 1 دقيقة",
    },
    {
      locale: "ar",
      label: "2 minutes",
      timeLeft: { unit: "minutes", count: 2 },
      expected: "أجب خلال 2 دقيقتين",
    },
    {
      locale: "ar",
      label: "5 minutes",
      timeLeft: { unit: "minutes", count: 5 },
      expected: "أجب خلال 5 دقائق",
    },
    {
      locale: "ar",
      label: "45 minutes",
      timeLeft: { unit: "minutes", count: 45 },
      expected: "أجب خلال 45 دقيقة",
    },
    {
      locale: "ar",
      label: "under a minute",
      timeLeft: { unit: "under-a-minute" },
      expected: "بقي أقل من دقيقة للرد",
    },
    {
      locale: "ar",
      label: "elapsed",
      timeLeft: { unit: "elapsed" },
      expected: "انتهى وقت الرد",
    },
    {
      locale: "ckb",
      label: "5 hours",
      timeLeft: { unit: "hours", count: 5 },
      expected: "لە ماوەی ٥ کاتژمێردا وەڵام بدەرەوە",
    },
    {
      locale: "ckb",
      label: "45 minutes",
      timeLeft: { unit: "minutes", count: 45 },
      expected: "لە ماوەی ٤٥ خولەکدا وەڵام بدەرەوە",
    },
    {
      locale: "ckb",
      label: "under a minute",
      timeLeft: { unit: "under-a-minute" },
      expected: "کەمتر لە خولەکێک ماوە بۆ وەڵامدانەوە",
    },
    {
      locale: "ckb",
      label: "elapsed",
      timeLeft: { unit: "elapsed" },
      expected: "کاتی وەڵامدانەوە تەواو بووە",
    },
  ])(
    "words the time left to answer in $locale for $label",
    ({ locale, timeLeft, expected }) => {
      expect(ownerRequestTimeLeft(locale, timeLeft)).toBe(expected);
    },
  );

  it.each<{ locale: Locale; expected: string[] }>([
    {
      locale: "en",
      expected: ["Fri, Oct 23: Morning, Evening", "Sat, Oct 24: Full day"],
    },
    {
      locale: "ar",
      expected: [
        "الجمعة، 23 تشرين\u00a0الأول: Morning، Evening",
        "السبت، 24 تشرين\u00a0الأول: Full day",
      ],
    },
    {
      locale: "ckb",
      expected: [
        "ھەینی، ٢٣ی تشرینی یەکەم: Morning، Evening",
        "شەممە، ٢٤ی تشرینی یەکەم: Full day",
      ],
    },
  ])(
    "names every Booking Period item grouped by service day in $locale",
    ({ locale, expected }) => {
      expect(
        ownerRequestPeriod(locale, [
          { serviceDay: "2026-10-23", displayName: "Morning" },
          { serviceDay: "2026-10-23", displayName: "Evening" },
          { serviceDay: "2026-10-24", displayName: "Full day" },
        ]),
      ).toEqual(expected);
    },
  );
});
