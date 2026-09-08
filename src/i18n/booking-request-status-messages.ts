import type { BookingRequestDeclineReason } from "@/booking-request/booking-request-lifecycle";
import type { BookingRequestDisplayStatus } from "@/booking-request/booking-request-display";
import type { BookingRequestStatus } from "@/booking-request/booking-request-status";
import type { Locale } from "./routing";

export const bookingRequestStatusMessages: Record<
  Locale,
  Record<BookingRequestStatus, string>
> = {
  en: {
    pending: "Pending",
    processing: "Processing",
    accepted: "Accepted",
    declined: "Declined",
    withdrawn: "Withdrawn",
    expired: "Expired",
  },
  ar: {
    pending: "قيد الانتظار",
    processing: "قيد المعالجة",
    accepted: "مقبول",
    declined: "مرفوض",
    withdrawn: "مسحوب",
    expired: "منتهي",
  },
  ckb: {
    pending: "چاوەڕێ",
    processing: "لە پرۆسەدایە",
    accepted: "قبوڵکراو",
    declined: "ڕەتکراوە",
    withdrawn: "کشێنراوەتەوە",
    expired: "بەسەرچووە",
  },
};

export const bookingRequestDisplayStatusMessages: Record<
  Locale,
  Record<BookingRequestDisplayStatus, string>
> = {
  en: {
    ...bookingRequestStatusMessages.en,
    "capture-processing": "Payment confirmation pending",
    "payment-required": "Payment Required",
    "paid-confirmed": "Booking confirmed",
  },
  ar: {
    ...bookingRequestStatusMessages.ar,
    "capture-processing": "بانتظار تأكيد الدفع",
    "payment-required": "الدفع مطلوب",
    "paid-confirmed": "تم تأكيد الحجز",
  },
  ckb: {
    ...bookingRequestStatusMessages.ckb,
    "capture-processing": "چاوەڕێی پشتڕاستکردنەوەی پارەدان",
    "payment-required": "پارەدان پێویستە",
    "paid-confirmed": "حجز پشتڕاست کراوەتەوە",
  },
};

export const bookingRequestPaymentDisplayMessages: Record<
  Locale,
  Record<"capture-processing" | "paid-confirmed", string>
> = {
  en: {
    "capture-processing":
      "The Cottage Owner accepted the request. Payment confirmation is pending. The booking is not confirmed yet.",
    "paid-confirmed": "Payment succeeded. The booking is confirmed.",
  },
  ar: {
    "capture-processing":
      "وافق مالك البيت على الطلب. بانتظار تأكيد الدفع. الحجز غير مؤكد بعد.",
    "paid-confirmed": "نجحت عملية الدفع. تم تأكيد الحجز.",
  },
  ckb: {
    "capture-processing":
      "خاوەنی کۆتێج داواکارییەکەی قبوڵ کرد. چاوەڕێی پشتڕاستکردنەوەی پارەدانین. حجزەکە هێشتا پشتڕاست نەکراوەتەوە.",
    "paid-confirmed": "پارەدان سەرکەوتوو بوو. حجزەکە پشتڕاست کراوەتەوە.",
  },
};

export const bookingRequestPaymentRequiredMessages = {
  en: {
    customer: {
      open: "Automatic payment failed. Your booking is not confirmed. Your selected Cottage Shifts remain held.",
      elapsed:
        "The payment deadline has passed. Your booking is still not confirmed and your selected Cottage Shifts remain held.",
    },
    owner: {
      open: "The Customer’s automatic payment failed. The booking is not confirmed. The selected Cottage Shifts remain held.",
      elapsed:
        "The Customer payment deadline has passed. The booking is still not confirmed and the selected Cottage Shifts remain held.",
    },
  },
  ar: {
    customer: {
      open: "فشل الدفع التلقائي. حجزك غير مؤكد. تبقى فترات البيت التي اخترتها محجوزة.",
      elapsed:
        "انتهى موعد الدفع. لا يزال حجزك غير مؤكد، وتبقى فترات البيت التي اخترتها محجوزة.",
    },
    owner: {
      open: "فشل الدفع التلقائي للعميل. الحجز غير مؤكد. تبقى فترات البيت المختارة محجوزة.",
      elapsed:
        "انتهى موعد دفع العميل. لا يزال الحجز غير مؤكد، وتبقى فترات البيت المختارة محجوزة.",
    },
  },
  ckb: {
    customer: {
      open: "پارەدانی خۆکار سەرکەوتوو نەبوو. حجزەکەت پشتڕاست نەکراوەتەوە. شەفتە هەڵبژێردراوەکانت گیراو دەمێننەوە.",
      elapsed:
        "کاتی کۆتایی پارەدان تێپەڕی. حجزەکەت هێشتا پشتڕاست نەکراوەتەوە و شەفتە هەڵبژێردراوەکانت گیراو دەمێننەوە.",
    },
    owner: {
      open: "پارەدانی خۆکاری کڕیار سەرکەوتوو نەبوو. حجزەکە پشتڕاست نەکراوەتەوە. شەفتە هەڵبژێردراوەکان گیراو دەمێننەوە.",
      elapsed:
        "کاتی کۆتایی پارەدانی کڕیار تێپەڕی. حجزەکە هێشتا پشتڕاست نەکراوەتەوە و شەفتە هەڵبژێردراوەکان گیراو دەمێننەوە.",
    },
  },
} as const;

export const bookingRequestDeclineReasonMessages: Record<
  Locale,
  Record<BookingRequestDeclineReason, string>
> = {
  en: {
    cottage_unavailable: "Cottage is unavailable",
    cannot_accommodate_request: "Cannot accommodate this request",
    other: "Other",
  },
  ar: {
    cottage_unavailable: "البيت غير متاح",
    cannot_accommodate_request: "لا يمكن تلبية هذا الطلب",
    other: "سبب آخر",
  },
  ckb: {
    cottage_unavailable: "کۆتێج بەردەست نییە",
    cannot_accommodate_request: "ناتوانرێت داواکارییەکە جێبەجێ بکرێت",
    other: "هۆکارێکی تر",
  },
};

export const bookingRequestPaymentRecoveryMessages = {
  en: {
    action: "Use simulated replacement payment",
    retry: "Retry simulated replacement payment",
    processing:
      "Your replacement payment is being checked. Do not start another attempt.",
  },
  ar: {
    action: "استخدام دفع بديل تجريبي",
    retry: "إعادة محاولة الدفع البديل التجريبي",
    processing: "جارٍ التحقق من الدفع البديل. لا تبدأ محاولة أخرى.",
  },
  ckb: {
    action: "پارەدانی جێگرەوەی تاقیکاری بەکاربهێنە",
    retry: "پارەدانی جێگرەوەی تاقیکاری دووبارە بکەوە",
    processing: "پارەدانی جێگرەوەت پشکنین دەکرێت. هەوڵێکی تر دەست پێ مەکە.",
  },
} as const;

export const bookingRequestPaymentRequiredExpiryMessages = {
  en: {
    quarantinedReleasedDescription:
      "Support needs to review a payment received for this expired request. The booking is not confirmed. The selected Cottage Shifts were already released. Please do not pay again.",
    refundingLabel: "Payment is being returned",
    refundingDescription:
      "Payment arrived after the deadline and is being returned in full. The booking is not confirmed. The selected Cottage Shifts remain held until the return is verified.",
    quarantinedLabel: "Payment needs review",
    quarantinedDescription:
      "Support needs to review this payment. The booking is not confirmed and the selected Cottage Shifts remain held. Please do not pay again.",
    refundedLabel: "Expired — payment returned",
    refundedDescription:
      "The full payment has been returned. The booking is not confirmed and this request’s hold on the selected Cottage Shifts has been released.",

    attention:
      "Payment or authorisation release could not yet be verified. The booking is not confirmed and the selected Cottage Shifts remain held.",
    expiredLabel: "Expired unpaid",
    expiredDescription:
      "Payment authorisations have been released. The booking is not confirmed and this request’s hold on the selected Cottage Shifts has been released.",
  },
  ar: {
    quarantinedReleasedDescription:
      "يحتاج فريق الدعم إلى مراجعة دفع لهذا الطلب المنتهي. الحجز غير مؤكد. تم تحرير فترات البيت المختارة سابقاً. يرجى عدم الدفع مرة أخرى.",
    refundingLabel: "جارٍ إعادة الدفع",
    refundingDescription:
      "وصل الدفع بعد الموعد النهائي وجارٍ إعادته بالكامل. الحجز غير مؤكد. تبقى فترات البيت المختارة محجوزة حتى يتم التحقق من إعادة الدفع.",
    quarantinedLabel: "الدفع يحتاج إلى مراجعة",
    quarantinedDescription:
      "يحتاج فريق الدعم إلى مراجعة هذا الدفع. الحجز غير مؤكد وتبقى فترات البيت المختارة محجوزة. يرجى عدم الدفع مرة أخرى.",
    refundedLabel: "انتهى الطلب — تم إرجاع الدفع",
    refundedDescription:
      "تم إرجاع كامل المبلغ. الحجز غير مؤكد وتم تحرير الفترات التي حجزها هذا الطلب.",

    attention:
      "لم نتمكن بعد من التحقق من الدفع أو تحرير تفويضات الدفع. الحجز غير مؤكد، وتبقى فترات البيت المختارة محجوزة.",
    expiredLabel: "انتهى الطلب دون دفع",
    expiredDescription:
      "تم تحرير تفويضات الدفع. الحجز غير مؤكد، وتم تحرير الفترات التي حجزها هذا الطلب.",
  },
  ckb: {
    quarantinedReleasedDescription:
      "تیمی پشتگیری پێویستە پێداچوونەوە بە پارەدانی ئەم داواکارییە بەسەرچووە بکات. حجزەکە پشتڕاست نەکراوەتەوە. شەفتە هەڵبژێردراوەکان پێشتر ئازاد کراون. تکایە دووبارە پارە مەدە.",
    refundingLabel: "پارەکە دەگەڕێندرێتەوە",
    refundingDescription:
      "پارەکە دوای کاتی دیاریکراو گەیشتووە و بە تەواوی دەگەڕێندرێتەوە. حجزەکە پشتڕاست نەکراوەتەوە. شەفتە هەڵبژێردراوەکان گیراو دەمێننەوە تا گەڕاندنەوەی پارەکە پشتڕاست بکرێتەوە.",
    quarantinedLabel: "پارەدان پێویستی بە پێداچوونەوە هەیە",
    quarantinedDescription:
      "تیمی پشتگیری پێویستە پێداچوونەوە بە ئەم پارەدانە بکات. حجزەکە پشتڕاست نەکراوەتەوە و شەفتە هەڵبژێردراوەکان گیراو دەمێننەوە. تکایە دووبارە پارە مەدە.",
    refundedLabel: "بەسەرچوو — پارەکە گەڕێندرایەوە",
    refundedDescription:
      "هەموو پارەکە گەڕێندرایەوە. حجزەکە پشتڕاست نەکراوەتەوە و شەفتە گیراوەکانی ئەم داواکارییە ئازاد کراون.",

    attention:
      "هێشتا نەمانتوانیوە پارەدان یان ئازادکردنی مۆڵەتەکانی پارەدان پشتڕاست بکەینەوە. حجزەکە پشتڕاست نەکراوەتەوە و شەفتە هەڵبژێردراوەکان گیراو دەمێننەوە.",
    expiredLabel: "داواکارییەکە بەبێ پارەدان بەسەرچوو",
    expiredDescription:
      "مۆڵەتەکانی پارەدان ئازاد کراون. حجزەکە پشتڕاست نەکراوەتەوە و شەفتە گیراوەکانی ئەم داواکارییە ئازاد کراون.",
  },
} as const;
