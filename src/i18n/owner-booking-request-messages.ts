import type { Locale } from "./routing";

export const ownerBookingRequestMessages: Record<
  Locale,
  {
    title: string;
    intro: string;
    empty: string;
    pending: string;
    cottage: string;
    customer: string;
    partySize: string;
    bookingPeriod: string;
    bookingNote: string;
    responseDeadline: string;
  }
> = {
  en: {
    title: "Pending Booking Requests",
    intro:
      "Respond before the deadline. Customer contact and payment details stay private.",
    empty: "No Booking Requests are waiting for your response.",
    pending: "Pending",
    cottage: "Cottage",
    customer: "Customer",
    partySize: "Party size",
    bookingPeriod: "Booking Period",
    bookingNote: "Booking Note",
    responseDeadline: "Respond by",
  },
  ar: {
    title: "طلبات الحجز قيد الانتظار",
    intro: "رد قبل الموعد النهائي. تبقى بيانات اتصال العميل والدفع خاصة.",
    empty: "لا توجد طلبات حجز تنتظر ردك.",
    pending: "قيد الانتظار",
    cottage: "البيت",
    customer: "العميل",
    partySize: "عدد أفراد المجموعة",
    bookingPeriod: "فترة الحجز",
    bookingNote: "ملاحظة الحجز",
    responseDeadline: "الرد قبل",
  },
  ckb: {
    title: "داواکارییە چاوەڕوانەکانی حجز",
    intro:
      "پێش کاتی کۆتایی وەڵام بدەرەوە. زانیاری پەیوەندی و پارەدانی کڕیار نهێنی دەمێنێتەوە.",
    empty: "هیچ داواکارییەکی حجز چاوەڕوانی وەڵامت نییە.",
    pending: "چاوەڕێ",
    cottage: "کۆتێج",
    customer: "کڕیار",
    partySize: "ژمارەی کەسان",
    bookingPeriod: "ماوەی حجز",
    bookingNote: "تێبینی حجز",
    responseDeadline: "وەڵام بدەرەوە پێش",
  },
};
