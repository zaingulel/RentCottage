import type { Locale } from "./routing";

const en = {
  titles: {
    customer: "Customer activity",
    owner: "Owner activity",
    cottage: "Cottage activity",
  },
  effects: {
    customer:
      "Stops new Booking Requests, customer messages and reviews. Existing history, confirmed booking details, payment status and cancellation rights remain. Owner capability is separate.",
    owner:
      "Stops new owner business. Customer capability and existing commitments remain. This grants no additional owner access.",
    cottage:
      "Stops new cottage business. Existing confirmed booking access, communication and cancellation rights remain.",
  },
  states: {
    active: "Active",
    suspended: "Suspended",
    draft: "Draft",
    submitted: "Submitted",
    needs_information: "Needs information",
    under_review: "Under review",
    approved: "Approved",
    rejected: "Rejected",
    expired: "Expired: renewal required",
    published: "Published",
    paused: "Paused",
    unpublished: "Unpublished",
  },
  invalid: "Enter a reason of 1 to 1,000 characters.",
  reason: "Reason",
  suspend: "Suspend new activity",
  reactivate: "Reactivate eligible activity",
  restoration: "Eligible restoration",
  retained:
    "Closed dates, private blocks, holds and confirmed commitments remain unchanged. Separate cottage restrictions remain.",
  reviewApplication: "Review Owner Application",
  restrictions: {
    "owner-application-ineligible":
      "Use the existing Owner Application review for this application state.",
    "verification-unavailable":
      "Verification information is unavailable. Review the Owner Application before changing the restriction.",
    "abandoned-profile":
      "This Cottage Profile is abandoned and cannot change activity state.",
  },
  restorationRestrictions: {
    "verification-unavailable": "Verification information is unavailable.",
    "verification-expired":
      "Verification has expired. Existing renewal review is required before new owner business.",
    "previously-paused":
      "The listing was paused before suspension and will remain paused.",
    "publication-or-owner-ineligible":
      "Publication, schedule or owner eligibility does not permit a published listing.",
  },
  older: "Load older restriction history",
  refresh: "Refresh restriction and release progress",
  refreshed: "Restriction and payment release progress refreshed.",
  conflict: "This record changed. Refresh before making a new decision.",
  stale:
    "Last loaded restriction and history are shown; current information is unavailable.",
  retryAction: "Retry previous action",
  retry:
    "The result is uncertain. Retry the unchanged action or refresh the current restriction. Payment release is not confirmed.",
  completed:
    "Command completed. Current restriction and payment release progress are shown below.",
  unavailable:
    "Restriction information is unavailable. Refresh before taking another action.",
  progress: "Payment release progress",
  affected: "Affected",
  resolved: "Resolved",
  processing: "Processing",
  quarantined: "Needs attention",
  attention: "Review payments needing attention",
  history: "Restriction history",
  noHistory: "No restriction actions are recorded.",
  actor: "Administrator",
  auditReason: "Reason",
  actions: { suspend: "Suspension", reactivate: "Reactivation" },
};

export const marketplaceSuspensionMessages: Record<Locale, typeof en> = {
  en,
  ar: {
    titles: {
      customer: "نشاط العميل",
      owner: "نشاط المالك",
      cottage: "نشاط البيت",
    },
    effects: {
      customer:
        "يوقف طلبات الحجز الجديدة ورسائل العميل ومراجعاته. يبقى السجل وتفاصيل الحجز المؤكد وحالة الدفعات وحقوق الإلغاء متاحة. صلاحية المالك مستقلة.",
      owner:
        "يوقف أعمال المالك الجديدة. تبقى صلاحية العميل والالتزامات القائمة. لا يمنح ذلك أي وصول إضافي للمالك.",
      cottage:
        "يوقف أعمال البيت الجديدة. يبقى الوصول إلى الحجوزات المؤكدة والتواصل وحقوق الإلغاء متاحاً.",
    },
    states: {
      active: "نشط",
      suspended: "معلّق",
      draft: "مسودة",
      submitted: "أُرسل للمراجعة",
      needs_information: "يحتاج إلى معلومات",
      under_review: "قيد المراجعة",
      approved: "معتمد",
      rejected: "مرفوض",
      expired: "منتهي الصلاحية: يلزم التجديد",
      published: "منشور",
      paused: "متوقف مؤقتاً",
      unpublished: "غير منشور",
    },
    invalid: "أدخل سبباً من حرف واحد إلى 1,000 حرف.",
    reason: "السبب",
    suspend: "علّق النشاط الجديد",
    reactivate: "أعد تفعيل النشاط المؤهل",
    restoration: "الاستعادة المؤهلة",
    retained:
      "تبقى التواريخ المغلقة والحظر الخاص والحجوزات المحجوزة مؤقتاً والالتزامات المؤكدة دون تغيير. تبقى قيود البيت المستقلة.",
    reviewApplication: "راجع طلب المالك",
    restrictions: {
      "owner-application-ineligible":
        "استخدم مراجعة طلب المالك الحالية لهذه الحالة.",
      "verification-unavailable":
        "معلومات التحقق غير متاحة. راجع طلب المالك قبل تغيير القيد.",
      "abandoned-profile":
        "تم التخلي عن ملف البيت هذا ولا يمكن تغيير حالة نشاطه.",
    },
    restorationRestrictions: {
      "verification-unavailable": "معلومات التحقق غير متاحة.",
      "verification-expired":
        "انتهت صلاحية التحقق. تلزم مراجعة التجديد الحالية قبل أعمال المالك الجديدة.",
      "previously-paused":
        "كان الإعلان متوقفاً مؤقتاً قبل التعليق وسيبقى كذلك.",
      "publication-or-owner-ineligible":
        "أهلية النشر أو الجدول أو المالك لا تسمح بنشر الإعلان.",
    },
    older: "حمّل سجل القيود الأقدم",
    refresh: "حدّث القيد وتقدّم تحرير الدفعات",
    refreshed: "تم تحديث القيد وتقدّم تحرير الدفعات.",
    conflict: "تغيّر هذا السجل. حدّثه قبل اتخاذ قرار جديد.",
    stale: "يُعرض آخر قيد وسجل تم تحميلهما؛ المعلومات الحالية غير متاحة.",
    retryAction: "أعد محاولة الإجراء السابق",
    retry:
      "النتيجة غير مؤكدة. أعد محاولة الإجراء نفسه أو حدّث القيد الحالي. لم يتم تأكيد تحرير الدفعات.",
    completed: "اكتمل الأمر. يُعرض القيد الحالي وتقدّم تحرير الدفعات أدناه.",
    unavailable: "معلومات القيد غير متاحة. حدّثها قبل اتخاذ إجراء آخر.",
    progress: "تقدّم تحرير الدفعات",
    affected: "المتأثرة",
    resolved: "المحسومة",
    processing: "قيد المعالجة",
    quarantined: "يحتاج إلى متابعة",
    attention: "راجع الدفعات التي تحتاج إلى متابعة",
    history: "سجل القيود",
    noHistory: "لا توجد إجراءات قيود مسجلة.",
    actor: "مسؤول المنصة",
    auditReason: "السبب",
    actions: { suspend: "تعليق", reactivate: "إعادة تفعيل" },
  },
  ckb: {
    titles: {
      customer: "چالاکی کڕیار",
      owner: "چالاکی خاوەن",
      cottage: "چالاکی ماڵ",
    },
    effects: {
      customer:
        "داواکاری حجزکردنی نوێ و نامە و پێداچوونەوەی کڕیار ڕادەگرێت. مێژوو و وردەکاری حجزی پشتڕاستکراو و دۆخی پارەدان و مافی هەڵوەشاندنەوە دەمێننەوە. توانای خاوەن جیاوازە.",
      owner:
        "کاری نوێی خاوەن ڕادەگرێت. توانای کڕیار و پابەندییە هەنووکەییەکان دەمێننەوە. هیچ دەستگەیشتنێکی زیادە بە خاوەن نادات.",
      cottage:
        "کاری نوێی ماڵ ڕادەگرێت. دەستگەیشتن بە حجزی پشتڕاستکراو و پەیوەندی و مافی هەڵوەشاندنەوە دەمێننەوە.",
    },
    states: {
      active: "چالاک",
      suspended: "ڕاگیراو",
      draft: "ڕەشنووس",
      submitted: "نێردراو",
      needs_information: "پێویستی بە زانیارییە",
      under_review: "لە پێداچوونەوەدایە",
      approved: "پەسەندکراو",
      rejected: "ڕەتکراوە",
      expired: "بەسەرچوو: نوێکردنەوە پێویستە",
      published: "بڵاوکراوە",
      paused: "وەستێنراو",
      unpublished: "بڵاونەکراوە",
    },
    invalid: "هۆکارێک لە ١ تا ١٬٠٠٠ پیت بنووسە.",
    reason: "هۆکار",
    suspend: "چالاکی نوێ ڕابگرە",
    reactivate: "چالاکی شایستە چالاک بکەرەوە",
    restoration: "گەڕاندنەوەی شایستە",
    retained:
      "بەروارە داخراوەکان و بلۆکی تایبەت و گرتنە کاتییەکان و پابەندییە پشتڕاستکراوەکان ناگۆڕدرێن. سنووردارکردنی جیاوازی ماڵ دەمێنێتەوە.",
    reviewApplication: "داواکاری خاوەن بپشکنە",
    restrictions: {
      "owner-application-ineligible":
        "بۆ ئەم دۆخە پێداچوونەوەی هەنووکەیی داواکاری خاوەن بەکاربهێنە.",
      "verification-unavailable":
        "زانیاری پشتڕاستکردنەوە بەردەست نییە. پێش گۆڕینی سنووردارکردن داواکاری خاوەن بپشکنە.",
      "abandoned-profile":
        "ئەم پرۆفایلی ماڵە بەجێهێڵراوە و دۆخی چالاکییەکەی ناگۆڕدرێت.",
    },
    restorationRestrictions: {
      "verification-unavailable": "زانیاری پشتڕاستکردنەوە بەردەست نییە.",
      "verification-expired":
        "پشتڕاستکردنەوە بەسەرچووە. پێش کاری نوێی خاوەن پێداچوونەوەی نوێکردنەوە پێویستە.",
      "previously-paused":
        "پێش ڕاگرتن ڕیکلامەکە وەستێنرابوو و هەر وا دەمێنێتەوە.",
      "publication-or-owner-ineligible":
        "شایستەیی بڵاوکردنەوە یان خشتە یان خاوەن ڕێگە بە بڵاوکردنەوەی ڕیکلام نادات.",
    },
    older: "مێژووی کۆنترى سنووردارکردن بار بکە",
    refresh: "سنووردارکردن و پێشکەوتنی ئازادکردنی پارەدان نوێ بکەرەوە",
    refreshed: "سنووردارکردن و پێشکەوتنی ئازادکردنی پارەدان نوێ کرانەوە.",
    conflict: "ئەم تۆمارە گۆڕاوە. پێش بڕیارێکی نوێ نوێی بکەرەوە.",
    stale:
      "دوا سنووردارکردن و مێژووی بارکراو پیشان دەدرێن؛ زانیاری هەنووکەیی بەردەست نییە.",
    retryAction: "کردارەکەی پێشوو دووبارە بکەرەوە",
    retry:
      "ئەنجامەکە دڵنیا نییە. هەمان کردار دووبارە بکەرەوە یان سنووردارکردنی هەنووکەیی نوێ بکەرەوە. ئازادکردنی پارەدان پشتڕاست نەکراوەتەوە.",
    completed:
      "فەرمانەکە تەواو بوو. سنووردارکردنی هەنووکەیی و پێشکەوتنی ئازادکردنی پارەدان لە خوارەوە پیشان دەدرێن.",
    unavailable:
      "زانیاری سنووردارکردن بەردەست نییە. پێش کردارێکی تر نوێی بکەرەوە.",
    progress: "پێشکەوتنی ئازادکردنی پارەدان",
    affected: "کاریگەری لەسەرکراو",
    resolved: "چارەسەرکراو",
    processing: "لە پرۆسەدایە",
    quarantined: "پێویستی بە بەدواداچوونە",
    attention: "پارەدانە پێویست بە بەدواداچوونەکان بپشکنە",
    history: "مێژووی سنووردارکردن",
    noHistory: "هیچ کرداری سنووردارکردن تۆمار نەکراوە.",
    actor: "بەڕێوەبەری پلاتفۆرم",
    auditReason: "هۆکار",
    actions: { suspend: "ڕاگرتن", reactivate: "چالاککردنەوە" },
  },
};
