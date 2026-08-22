import type { Locale } from "@/i18n/routing";

export const BOOKING_TERMS_VERSION = "fictional-local-test-2026-08-22-v1";

export interface BookingTermsFixture {
  readonly version: typeof BOOKING_TERMS_VERSION;
  readonly locale: Locale;
  readonly body: string;
  readonly sha256: string;
  readonly operative: false;
}

export const bookingTermsFixtures: Record<Locale, BookingTermsFixture> = {
  en: {
    version: BOOKING_TERMS_VERSION,
    locale: "en",
    body: `FICTIONAL LOCAL TEST TERMS — NOT A LEGAL AGREEMENT

1. This is a local software test only. No real cottage, public booking, payment, authorization, contract, or reservation is created.
2. The test simulates authorization of the full displayed Customer Total in Iraqi dinars. It is not a charge, transfers no money, and uses no real payment provider.
3. The Booking Request remains pending until the fictional Cottage Owner accepts or declines it within the displayed four-hour response deadline. A successfully finalized simulated authorization remains reserved through that deadline.
4. The displayed House Rules, fictional cancellation policy, Booking Price, service fee, Customer Total, selected period, warnings, and acceptances are preserved with the test request.
5. The fictional cancellation and no-show wording is test content only. It demonstrates the displayed full-refund and no-refund cases but cannot create a real cancellation, refund, fee, or debt.
6. Do not share phone numbers, email addresses, social handles, or links in names or notes. The fictional Owner sees only contact-safe request details, never the Customer phone or simulated provider identity. No direct contact or public booking is enabled.
7. Do not use this fixture for a real booking. It has not been approved by legal counsel, is non-operative, and creates no rights or obligations.`,
    sha256: "54c3ef684633e5308baf6511318fcfc422842239c22776f81d655c230ecd107d",
    operative: false,
  },
  ar: {
    version: BOOKING_TERMS_VERSION,
    locale: "ar",
    body: `شروط اختبار محلية خيالية — ليست اتفاقاً قانونياً

1. هذا اختبار برمجي محلي فقط. لا ينشئ بيتاً أو حجزاً عاماً أو دفعاً أو تفويضاً أو عقداً أو حجزاً حقيقياً.
2. يحاكي الاختبار تفويض إجمالي العميل المعروض كاملاً بالدينار العراقي. ليس خصماً مالياً ولا ينقل أموالاً ولا يستخدم مزود دفع حقيقياً.
3. يبقى الطلب قيد الانتظار حتى يقبل مالك البيت الخيالي أو يرفض خلال مهلة الرد المعروضة البالغة أربع ساعات. يبقى التفويض المحاكى المكتمل محفوظاً حتى نهاية تلك المهلة.
4. تُحفظ قواعد البيت المعروضة وسياسة الإلغاء الخيالية وسعر الحجز ورسوم الخدمة وإجمالي العميل والفترة المختارة والتحذيرات والقبولات مع طلب الاختبار.
5. نص الإلغاء الخيالي وعدم الحضور هو محتوى اختباري فقط. يوضح حالات الاسترداد الكامل وعدم الاسترداد المعروضة، لكنه لا ينشئ إلغاءً أو استرداداً أو رسماً أو ديناً حقيقياً.
6. لا تشارك أرقام الهواتف أو عناوين البريد الإلكتروني أو معرفات التواصل الاجتماعي أو الروابط في الأسماء أو الملاحظات. يرى المالك الخيالي تفاصيل آمنة للتواصل فقط، ولا يرى هاتف العميل أو هوية مزود المحاكاة. لا يتاح اتصال مباشر أو حجز عام.
7. لا تستخدم هذا النص لحجز حقيقي. لم يعتمدها مستشار قانوني، وهي غير نافذة ولا تنشئ أي حقوق أو التزامات.`,
    sha256: "ae5f11ef24ec56ea527a946ab591687959a3a67c3c5298b27e835d483d9adedf",
    operative: false,
  },
  ckb: {
    version: BOOKING_TERMS_VERSION,
    locale: "ckb",
    body: `مەرجە خەیاڵییەکانی تاقیکردنەوەی ناوخۆیی — ڕێککەوتنێکی یاسایی نییە

1. ئەمە تەنها تاقیکردنەوەی نەرمامێری ناوخۆییە. هیچ کۆتێج، حجزکردنی گشتی، پارەدان، ڕێگەپێدان، گرێبەست یان حجزێکی ڕاستەقینە دروست ناکات.
2. تاقیکردنەوەکە ڕێگەپێدانی تەواوی کۆی گشتی کڕیار بە دیناری عێراقی دەخاتە ڕوو. پارە وەرناگرێت، هیچ پارەیەک ناگوازێتەوە و دابینکەری پارەدانی ڕاستەقینە بەکارناهێنێت.
3. داواکارییەکە بە چاوەڕوانی دەمێنێتەوە تا خاوەنی کۆتێجی خەیاڵی لە ماوەی چوار کاتژمێری دیاریکراودا قبوڵی بکات یان ڕەتی بکاتەوە. ڕێگەپێدانی ساختەی تەواوکراو تا کۆتایی ئەو ماوەیە پارێزراو دەمێنێتەوە.
4. یاساکانی کۆتێج، سیاسەتی خەیاڵی هەڵوەشاندنەوە، نرخی حجز، کرێی خزمەتگوزاری، کۆی گشتی کڕیار، ماوەی هەڵبژێردراو، ئاگادارکردنەوە و قبوڵکردنەکان لەگەڵ داواکارییە تاقیکارییەکەدا پارێزراو دەبن.
5. دەقی هەڵوەشاندنەوە و نەهاتنی خەیاڵی تەنها ناوەڕۆکی تاقیکردنەوەیە. حاڵەتە پیشاندراوەکانی گەڕاندنەوەی تەواوی پارە و نەگەڕاندنەوە ڕوون دەکاتەوە، بەڵام هیچ هەڵوەشاندنەوە، گەڕاندنەوەی پارە، کرێ یان قەرزێکی ڕاستەقینە دروست ناکات.
6. ژمارەی تەلەفۆن هاوبەش مەکە، هەروەها ناونیشانی ئیمەیڵ، ناوی تۆڕی کۆمەڵایەتی یان بەستەر لە ناو یان تێبینیدا مەنووسە. خاوەنی خەیاڵی تەنها وردەکارییە بێ‌مەترسییەکان دەبینێت، نە ژمارەی کڕیار یان ناسنامەی دابینکەری ساختە. هیچ پەیوەندییەکی ڕاستەوخۆ یان حجزکردنی گشتی بەردەست نییە.
7. ئەم دەقە بۆ حجزێکی ڕاستەقینە بەکارمەهێنە. لەلایەن ڕاوێژکاری یاساییەوە پەسەند نەکراوە، کاریگەری یاسایی نییە و هیچ ماف یان ئەرکێک دروست ناکات.`,
    sha256: "53aba7dd4378eded73806599200b219d3d8ee157f6029e8164b3f184c30acb0b",
    operative: false,
  },
};

export function bookingTermsFixture(locale: Locale): BookingTermsFixture {
  return bookingTermsFixtures[locale];
}
