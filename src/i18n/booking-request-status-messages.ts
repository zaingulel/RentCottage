import type { BookingRequestDeclineReason } from "@/booking-request/booking-request-lifecycle";
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
