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
    "paid-confirmed": "Booking confirmed",
  },
  ar: {
    ...bookingRequestStatusMessages.ar,
    "capture-processing": "بانتظار تأكيد الدفع",
    "paid-confirmed": "تم تأكيد الحجز",
  },
  ckb: {
    ...bookingRequestStatusMessages.ckb,
    "capture-processing": "چاوەڕێی پشتڕاستکردنەوەی پارەدان",
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
