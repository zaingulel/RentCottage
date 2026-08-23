import type { SubmissionFailureStatus } from "@/booking-request/booking-request-submission";

import type { Locale } from "./routing";

export const bookingRequestMessages: Record<
  Locale,
  {
    formTitle: string;
    formIntro: string;
    futureTitle: string;
    futureBody: string;
    verifyTitle: string;
    verifyIntro: string;
    customerName: string;
    partySize: string;
    bookingNote: string;
    noteHint: string;
    acceptHouseRules: string;
    acceptCancellation: string;
    cancellationPolicy: string;
    acceptTerms: string;
    inside48Warning: string;
    acceptInside48: string;
    cutoffPassed: string;
    submit: string;
    pendingAction: string;
    pendingTitle: string;
    existingTitle: string;
    reference: string;
    responseDeadline: string;
    pendingExplanation: string;
    existingExplanation: string;
    viewStatus: string;
    errors: Record<SubmissionFailureStatus, string>;
  }
> = {
  en: {
    formTitle: "Send your Booking Request",
    formIntro:
      "Your full Customer Total will be authorised now. Payment is collected only if the Cottage Owner accepts.",
    futureTitle: "Online Booking Requests are not available yet",
    futureBody:
      "You can keep browsing cottages. Online payment authorisation and Booking Requests will open after launch checks are complete.",
    verifyTitle: "Verify your phone to continue",
    verifyIntro:
      "A phone-verified Customer account is required before payment authorisation.",
    customerName: "Customer name",
    partySize: "Party size",
    bookingNote: "Booking Note (optional)",
    noteHint: "Up to 500 characters. Do not include contact details.",
    acceptHouseRules: "I accept the preserved House Rules shown above.",
    acceptCancellation: "I accept the cancellation policy.",
    cancellationPolicy:
      "Cancel at least 48 hours before the first shift for a full refund. Cancellation inside 48 hours and no-shows receive no refund.",
    acceptTerms: "I accept the marketplace booking terms.",
    inside48Warning:
      "This request begins inside 48 hours and will be non-refundable immediately if accepted.",
    acceptInside48:
      "I understand and accept the inside-48-hours no-refund rule.",
    cutoffPassed:
      "This period is inside the six-hour Booking Request Cut-Off and can no longer be requested.",
    submit: "Send Booking Request",
    pendingAction: "Authorising…",
    pendingTitle: "Booking Request pending",
    existingTitle: "Booking Request already updated",
    reference: "Request reference",
    responseDeadline: "Owner response deadline",
    pendingExplanation:
      "Your period is held while the Cottage Owner responds. Payment has been authorised, not collected.",
    existingExplanation: "Open the request to see its current status.",
    viewStatus: "View and manage this request",
    errors: {
      invalid: "Check every field and required acceptance, then try again.",
      "access-required": "Verify your Customer phone number before continuing.",
      "quote-stale":
        "The price, rules, or availability changed. Refresh this quote before trying again.",
      "too-late": "The six-hour Booking Request Cut-Off has passed.",
      "authorization-failed":
        "Payment authorisation was not approved. No request or hold was created.",
      "payment-unavailable":
        "Online payment authorisation is not available yet. You can continue browsing.",
      "reconciliation-required":
        "The payment outcome is being checked. Do not submit another request.",
      unavailable:
        "The Booking Request could not be completed safely. Try again later.",
    },
  },
  ar: {
    formTitle: "أرسل طلب الحجز",
    formIntro:
      "سيتم حجز إجمالي العميل كاملاً الآن، ولن يُحصّل المبلغ إلا إذا وافق مالك البيت.",
    futureTitle: "طلبات الحجز عبر الإنترنت غير متاحة بعد",
    futureBody:
      "يمكنك متابعة تصفح البيوت. ستتاح حجوزات الدفع وطلبات الحجز بعد اكتمال فحوصات الإطلاق.",
    verifyTitle: "تحقق من هاتفك للمتابعة",
    verifyIntro: "يلزم حساب عميل برقم هاتف متحقق منه قبل حجز المبلغ.",
    customerName: "اسم العميل",
    partySize: "عدد أفراد المجموعة",
    bookingNote: "ملاحظة الحجز (اختيارية)",
    noteHint: "حتى 500 حرف. لا تكتب بيانات اتصال.",
    acceptHouseRules: "أوافق على قواعد البيت المحفوظة والمعروضة أعلاه.",
    acceptCancellation: "أوافق على سياسة الإلغاء.",
    cancellationPolicy:
      "الإلغاء قبل 48 ساعة على الأقل يعيد المبلغ كاملاً. لا استرداد عند الإلغاء خلال 48 ساعة أو عدم الحضور.",
    acceptTerms: "أوافق على شروط الحجز في المنصة.",
    inside48Warning:
      "يبدأ هذا الطلب خلال 48 ساعة وسيصبح غير قابل للاسترداد فور قبوله.",
    acceptInside48: "أفهم وأوافق على عدم الاسترداد خلال 48 ساعة.",
    cutoffPassed: "دخلت هذه الفترة حد الست ساعات ولا يمكن طلبها الآن.",
    submit: "أرسل طلب الحجز",
    pendingAction: "جارٍ حجز المبلغ…",
    pendingTitle: "طلب الحجز قيد الانتظار",
    existingTitle: "تم تحديث طلب الحجز بالفعل",
    reference: "مرجع الطلب",
    responseDeadline: "موعد رد المالك",
    pendingExplanation:
      "الفترة محجوزة مؤقتاً حتى يرد المالك. تم حجز المبلغ ولم يتم تحصيله.",
    existingExplanation: "افتح الطلب للاطلاع على حالته الحالية.",
    viewStatus: "عرض هذا الطلب وإدارته",
    errors: {
      invalid: "راجع الحقول والموافقات المطلوبة ثم حاول مرة أخرى.",
      "access-required": "تحقق من رقم هاتف العميل قبل المتابعة.",
      "quote-stale": "تغير السعر أو القواعد أو التوفر. حدّث عرض السعر.",
      "too-late": "انتهى حد إرسال الطلب قبل ست ساعات.",
      "authorization-failed":
        "لم تتم الموافقة على حجز المبلغ، ولم يُنشأ طلب أو حجز مؤقت.",
      "payment-unavailable":
        "الدفع الإلكتروني غير متاح بعد. يمكنك متابعة التصفح.",
      "reconciliation-required":
        "يجري التحقق من نتيجة الدفع. لا ترسل طلباً آخر.",
      unavailable: "تعذر إكمال الطلب بأمان. حاول لاحقاً.",
    },
  },
  ckb: {
    formTitle: "داواکاری حجز بنێرە",
    formIntro:
      "ئێستا کۆی گشتی کڕیار ڕێگەپێدراو دەکرێت؛ پارە تەنها دوای پەسەندکردنی خاوەن وەردەگیرێت.",
    futureTitle: "داواکارییەکانی حجزکردنی ئۆنلاین هێشتا بەردەست نین",
    futureBody:
      "دەتوانیت بەردەوام بیت لە گەڕان بەدوای کۆتێجدا. ڕێگەپێدانی پارە و داواکارییەکانی حجز دوای تەواوبوونی پشکنینەکانی دەستپێکردن بەردەست دەبن.",
    verifyTitle: "بۆ بەردەوامبوون تەلەفۆنەکەت پشتڕاست بکەرەوە",
    verifyIntro: "پێش ڕێگەپێدانی پارە هەژماری کڕیاری پشتڕاستکراو پێویستە.",
    customerName: "ناوی کڕیار",
    partySize: "ژمارەی کەسان",
    bookingNote: "تێبینی حجز (ئارەزوومەندانە)",
    noteHint: "تا 500 پیت. زانیاری پەیوەندی مەنووسە.",
    acceptHouseRules:
      "یاسا پارێزراوەکانی کۆتێج کە لە سەرەوە نیشان دراون قبوڵ دەکەم.",
    acceptCancellation: "سیاسەتی هەڵوەشاندنەوە قبوڵ دەکەم.",
    cancellationPolicy:
      "هەڵوەشاندنەوە لانیکەم 48 کاتژمێر پێش شەفت پارەکە بە تەواوی دەگەڕێنێتەوە. لە ناو 48 کاتژمێر یان نەهاتندا پارە ناگەڕێتەوە.",
    acceptTerms: "مەرجەکانی حجزکردنی پلاتفۆرم قبوڵ دەکەم.",
    inside48Warning:
      "ئەم داواکارییە لە ناو 48 کاتژمێردا دەست پێدەکات و دوای پەسەندکردن پارەکە ناگەڕێتەوە.",
    acceptInside48: "یاسای نەگەڕاندنەوەی پارە لە ناو 48 کاتژمێردا قبوڵ دەکەم.",
    cutoffPassed:
      "ئەم ماوەیە چووەتە ناو سنووری شەش کاتژمێر و چیتر داوا ناکرێت.",
    submit: "داواکاری حجز بنێرە",
    pendingAction: "ڕێگەپێدان…",
    pendingTitle: "داواکاری حجز چاوەڕێیە",
    existingTitle: "داواکاری حجز پێشتر نوێ کراوەتەوە",
    reference: "ژمارەی داواکاری",
    responseDeadline: "کاتی کۆتایی وەڵامی خاوەن",
    pendingExplanation:
      "ماوەکە تا وەڵامی خاوەن گیراوە. پارەکە ڕێگەپێدراوە، بەڵام وەرنەگیراوە.",
    existingExplanation: "داواکارییەکە بکەرەوە بۆ بینینی دۆخی ئێستای.",
    viewStatus: "بینین و بەڕێوەبردنی ئەم داواکارییە",
    errors: {
      invalid: "خانەکان و قبوڵکردنە پێویستەکان بپشکنە و دووبارە هەوڵ بدە.",
      "access-required":
        "پێش بەردەوامبوون ژمارەی تەلەفۆنی کڕیار پشتڕاست بکەرەوە.",
      "quote-stale":
        "نرخ، یاسا یان بەردەستبوون گۆڕاوە. پێشنیاری نرخ نوێ بکەرەوە.",
      "too-late": "سنووری شەش کاتژمێری داواکاری تێپەڕیوە.",
      "authorization-failed":
        "ڕێگەپێدانی پارە پەسەند نەکرا و داواکاری یان گرتن دروست نەبوو.",
      "payment-unavailable":
        "پارەدانی ئۆنلاین هێشتا بەردەست نییە. دەتوانیت بەردەوام بیت لە گەڕان.",
      "reconciliation-required":
        "ئەنجامی پارەدان پشکنین دەکرێت. داواکارییەکی تر مەبنێرە.",
      unavailable: "داواکارییەکە بە سەلامەتی تەواو نەکرا. دواتر هەوڵ بدە.",
    },
  },
};

export function bookingRequestErrorMessage(
  locale: Locale,
  status: SubmissionFailureStatus,
): string {
  const errors = bookingRequestMessages[locale].errors;
  if (!Object.hasOwn(errors, status) || typeof errors[status] !== "string") {
    throw new TypeError("Unknown Booking Request submission status");
  }
  return errors[status];
}
