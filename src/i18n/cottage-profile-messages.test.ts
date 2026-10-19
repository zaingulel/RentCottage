import { describe, expect, it } from "vitest";

import {
  cottageProfileCounts,
  cottageProfileMessages,
  ownerCottagesSummarySentence,
} from "./cottage-profile-messages";
import type { Locale } from "./routing";

const publicationId = "80000000-0000-4000-8000-000000000001";

describe("owner Cottage Profile counts", () => {
  it("counts as published and draft exactly the cottages whose badges say so", () => {
    expect(
      cottageProfileCounts([
        {
          status: "draft",
          currentPublicationId: null,
          hasUnpublishedContentChange: false,
        },
        {
          status: "submitted_for_content_approval",
          currentPublicationId: null,
          hasUnpublishedContentChange: false,
        },
        {
          status: "abandoned",
          currentPublicationId: null,
          hasUnpublishedContentChange: false,
        },
        {
          status: "draft",
          currentPublicationId: publicationId,
          hasUnpublishedContentChange: false,
        },
        {
          status: "draft",
          currentPublicationId: publicationId,
          hasUnpublishedContentChange: true,
        },
        {
          status: "submitted_for_content_approval",
          currentPublicationId: publicationId,
          hasUnpublishedContentChange: true,
        },
      ]),
    ).toEqual({ published: 3, drafts: 1 });
  });

  it.each<{
    locale: Locale;
    published: number;
    drafts: number;
    expected: string;
  }>([
    {
      locale: "en",
      published: 2,
      drafts: 1,
      expected: "You have 2 published cottages and 1 draft.",
    },
    {
      locale: "en",
      published: 1,
      drafts: 0,
      expected: "You have 1 published cottage.",
    },
    { locale: "en", published: 0, drafts: 3, expected: "You have 3 drafts." },
    {
      locale: "en",
      published: 0,
      drafts: 0,
      expected: "None of your cottages is published yet.",
    },
    {
      locale: "ar",
      published: 2,
      drafts: 1,
      expected: "لديك 2 كوخان منشوران و1 مسودة.",
    },
    {
      locale: "ar",
      published: 11,
      drafts: 2,
      expected: "لديك 11 كوخًا منشورًا و2 مسودتان.",
    },
    {
      locale: "ar",
      published: 1,
      drafts: 0,
      expected: "لديك 1 كوخ منشور.",
    },
    { locale: "ar", published: 0, drafts: 3, expected: "لديك 3 مسودات." },
    {
      locale: "ar",
      published: 0,
      drafts: 0,
      expected: "لم يُنشر أي من أكواخك بعد.",
    },
    {
      locale: "ckb",
      published: 2,
      drafts: 1,
      expected: "٢ کۆتێجی بڵاوکراوە و ١ ڕەشنووست هەیە.",
    },
    {
      locale: "ckb",
      published: 1,
      drafts: 0,
      expected: "١ کۆتێجی بڵاوکراوەت هەیە.",
    },
    { locale: "ckb", published: 0, drafts: 3, expected: "٣ ڕەشنووست هەیە." },
    {
      locale: "ckb",
      published: 0,
      drafts: 0,
      expected: "هێشتا هیچ کام لە کۆتێجەکانت بڵاونەکراوەتەوە.",
    },
  ])(
    "words the owner's counts in $locale for $published published and $drafts drafts",
    ({ locale, published, drafts, expected }) => {
      expect(ownerCottagesSummarySentence(locale, { published, drafts })).toBe(
        expected,
      );
    },
  );
});

it("uses Eastern Arabic digits in Sorani cottage profile prose", () => {
  expect(cottageProfileMessages.ckb).toMatchObject({
    completion:
      "هەموو خانە پێویستەکان پڕ بکەوە و ١ تا ١٢ وێنەی ئامادە زیاد بکە پێش ناردن.",
    photoGuidance:
      "١ تا ١٢ وێنەی JPEG، PNG یان WebP زیاد بکە. هەر وێنەیەک نابێت لە ٥ MiB زیاتر بێت. HEIC وەرناگیرێت.",
    capacityLimit: "دەتوانیت تا ٢٠ پرۆفایلی کراوە و بڵاونەکراوەی کۆتێجت هەبێت.",
    rateLimit:
      "دەتوانیت لە ماوەی ٢٤ کاتژمێردا تا ٢٠ پرۆفایلی زیادەی کۆتێج دروست بکەیت.",
    incomplete:
      "هەموو خانە پێویستەکان پڕ بکەوە و دڵنیابە ١ تا ١٢ وێنە ئامادەن.",
    pointOutside:
      "ئەم ژمارانە لە دەرەوەی ناوچەی پشتگیریکراون (پانی جوگرافی لە 29.0 تا 37.4، درێژی جوگرافی لە 38.7 تا 49.2). پشکنینیان بکە و دووبارە هەوڵ بدەوە.",
    pointDecimal:
      "هەردوو ژمارەکە بە شێوەی دەیی بنووسە، وەک 36.408333 و 44.385834.",
  });
  expect(cottageProfileMessages.en).toMatchObject({
    completion:
      "Complete every required field and add 1–12 ready photos before submission.",
    photoGuidance:
      "Add 1–12 JPEG, PNG or WebP images. Each image must be 5 MiB or smaller. HEIC is not accepted.",
    capacityLimit: "You can have up to 20 open unpublished Cottage Profiles.",
    rateLimit:
      "You can create up to 20 additional Cottage Profiles in 24 hours.",
    incomplete:
      "Complete every required field and make sure 1–12 photos are ready before submitting.",
    pointOutside:
      "These numbers are outside the supported area (latitude 29.0 to 37.4, longitude 38.7 to 49.2). Check them and try again.",
    pointDecimal:
      "Enter both as decimal numbers, such as 36.408333 and 44.385834.",
  });
  expect(cottageProfileMessages.ar).toMatchObject({
    completion:
      "أكمل جميع الحقول المطلوبة وأضف من 1 إلى 12 صورة جاهزة قبل الإرسال.",
    photoGuidance:
      "أضف من 1 إلى 12 صورة JPEG أو PNG أو WebP. الحد الأقصى لكل صورة 5 ميبيبايت. صيغة HEIC غير مقبولة.",
    capacityLimit: "يمكن أن يكون لديك حتى 20 ملف كوخ مفتوحاً وغير منشور.",
    rateLimit: "يمكنك إنشاء حتى 20 ملف كوخ إضافياً خلال 24 ساعة.",
    incomplete:
      "أكمل كل الحقول المطلوبة وتأكد من جاهزية 1 إلى 12 صورة قبل الإرسال.",
    pointOutside:
      "هذه الأرقام خارج المنطقة المدعومة (خط العرض من 29.0 إلى 37.4، وخط الطول من 38.7 إلى 49.2). تحقق منها وحاول مرة أخرى.",
    pointDecimal: "أدخل الرقمين بصيغة عشرية، مثل 36.408333 و 44.385834.",
  });
});

it("administrator editor requires a reason for each content change", () => {
  expect(cottageProfileMessages.en.reasonInvalid).toBe(
    "Enter an administrator reason of 1 to 1000 characters.",
  );
  expect(cottageProfileMessages.ar.reasonInvalid).toBe(
    "أدخل سبب المسؤول من حرف واحد إلى 1000 حرف.",
  );
  expect(cottageProfileMessages.ckb.reasonInvalid).toBe(
    "هۆکاری بەڕێوەبەر بنووسە کە لە ١ تا ١٠٠٠ پیت بێت.",
  );
});

it("published content controls report persisted hide and restore outcomes", () => {
  const expected = {
    en: {
      visibilityTitle: "Public visibility",
      visibilityVisible: "Visible",
      visibilityHidden: "Hidden",
      visibilityHide: "Hide",
      visibilityRestore: "Restore",
    },
    ar: {
      visibilityTitle: "الظهور العام",
      visibilityVisible: "ظاهر",
      visibilityHidden: "مخفي",
      visibilityHide: "إخفاء",
      visibilityRestore: "إظهار",
    },
    ckb: {
      visibilityTitle: "پیشاندانی گشتی",
      visibilityVisible: "پیشاندراو",
      visibilityHidden: "شاراوە",
      visibilityHide: "شاردنەوە",
      visibilityRestore: "پیشاندانەوە",
    },
  };
  for (const locale of ["en", "ar", "ckb"] as const) {
    expect(cottageProfileMessages[locale]).toMatchObject(expected[locale]);
    for (const key of [
      "visibilityGuidance",
      "visibilityDescription",
      "visibilitySaved",
      "visibilityDenied",
      "visibilityConflict",
      "visibilityLastPhoto",
      "visibilityUnavailable",
      "visibilityInvalid",
    ] as const) {
      expect(cottageProfileMessages[locale][key].trim()).not.toBe("");
      if (locale !== "en")
        expect(cottageProfileMessages[locale][key]).not.toBe(
          cottageProfileMessages.en[key],
        );
    }
  }
});
