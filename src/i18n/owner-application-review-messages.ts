import type { Locale } from "./routing";

export const ownerApplicationReviewMessages: Record<
  Locale,
  {
    eyebrow: string;
    title: string;
    intro: string;
    accessRequired: string;
    signIn: string;
    empty: string;
    submitted: string;
    underReview: string;
    reviewDue: string;
    openApplication: string;
    documents: string;
    createLink: string;
    pending: string;
    linkReady: string;
    openDocument: string;
    denied: string;
    unavailable: string;
    expired: string;
    nextPage: string;
  }
> = {
  en: {
    eyebrow: "Administrator review",
    title: "Submitted Owner Applications",
    intro:
      "Open a 60-second secure link only when you need to inspect source evidence. Every access is attributed and recorded.",
    accessRequired:
      "Platform Administrator multi-factor access is required to review private evidence.",
    signIn: "Verify administrator access",
    empty: "There are no submitted Owner Applications to review.",
    submitted: "Submitted",
    underReview: "Under review",
    reviewDue: "Review target",
    openApplication: "Open application",
    documents: "Verification documents",
    createLink: "Create secure link",
    pending: "Creating secure link.",
    linkReady: "Secure link ready for up to 60 seconds.",
    openDocument: "Open secure document",
    denied: "You do not have permission to access this private document.",
    unavailable: "The private review queue is temporarily unavailable.",
    expired:
      "This secure link has expired. Create a new secure link to continue.",
    nextPage: "Next applications",
  },
  ar: {
    eyebrow: "مراجعة المسؤول",
    title: "طلبات المالك المرسلة",
    intro:
      "أنشئ رابطاً آمناً لمدة 60 ثانية فقط عند الحاجة لمراجعة الدليل الأصلي. يُنسب كل وصول ويُسجّل.",
    accessRequired:
      "يلزم دخول مسؤول المنصة بالمصادقة متعددة العوامل لمراجعة الأدلة الخاصة.",
    signIn: "تحقق من دخول المسؤول",
    empty: "لا توجد طلبات مالك مرسلة للمراجعة.",
    submitted: "أُرسل",
    underReview: "قيد المراجعة",
    reviewDue: "موعد المراجعة المستهدف",
    openApplication: "افتح الطلب",
    documents: "وثائق التحقق",
    createLink: "أنشئ رابطاً آمناً",
    pending: "يجري إنشاء الرابط الآمن.",
    linkReady: "الرابط الآمن جاهز لمدة تصل إلى 60 ثانية.",
    openDocument: "افتح الوثيقة الآمنة",
    denied: "لا تملك صلاحية الوصول إلى هذه الوثيقة الخاصة.",
    unavailable: "قائمة المراجعة الخاصة غير متاحة مؤقتاً.",
    expired:
      "انتهت صلاحية هذا الرابط الآمن. أنشئ رابطاً آمناً جديداً للمتابعة.",
    nextPage: "الطلبات التالية",
  },
  ckb: {
    eyebrow: "پێداچوونەوەی بەڕێوەبەر",
    title: "داواکارییە نێردراوەکانی خاوەن",
    intro:
      "تەنها کاتێک پێویستە بەڵگەی سەرچاوە ببینیت بەستەری پارێزراوی 60 چرکەیی دروست بکە. هەموو دەستگەیشتنێک تۆمار دەکرێت.",
    accessRequired:
      "بۆ پێداچوونەوەی بەڵگە نهێنییەکان چوونەژوورەوەی دوو هەنگاوی بەڕێوەبەری پلاتفۆرم پێویستە.",
    signIn: "دەسەڵاتی بەڕێوەبەر پشتڕاست بکەرەوە",
    empty: "هیچ داواکارییەکی نێردراوی خاوەن بۆ پێداچوونەوە نییە.",
    submitted: "نێردراوە",
    underReview: "لە ژێر پێداچوونەوەدایە",
    reviewDue: "ئامانجی پێداچوونەوە",
    openApplication: "داواکارییەکە بکەرەوە",
    documents: "بەڵگەنامەکانی پشتڕاستکردنەوە",
    createLink: "بەستەری پارێزراو دروست بکە",
    pending: "بەستەری پارێزراو دروست دەکرێت.",
    linkReady: "بەستەرە پارێزراوەکە بۆ ماوەی تا 60 چرکە ئامادەیە.",
    openDocument: "بەڵگەنامە پارێزراوەکە بکەرەوە",
    denied: "دەسەڵاتی دەستگەیشتن بەم بەڵگەنامە نهێنییە نییە.",
    unavailable: "ڕیزی پێداچوونەوەی نهێنی کاتێکی کورت بەردەست نییە.",
    expired:
      "ئەم بەستەرە پارێزراوە بەسەرچووە. بۆ بەردەوامبوون بەستەرێکی نوێ دروست بکە.",
    nextPage: "داواکارییەکانی دواتر",
  },
};
