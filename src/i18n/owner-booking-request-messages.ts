import type { Locale } from "./routing";

export const ownerBookingRequestMessages: Record<
  Locale,
  {
    title: string;
    intro: string;
    empty: string;
    future: string;
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
    future:
      "Online Booking Request alerts are not available yet. They will appear after launch checks are complete.",
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
    future:
      "تنبيهات طلبات الحجز عبر الإنترنت غير متاحة بعد. ستظهر بعد اكتمال فحوصات الإطلاق.",
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
    future:
      "ئاگادارکردنەوەکانی داواکاری حجزکردنی ئۆنلاین هێشتا بەردەست نین. دوای تەواوبوونی پشکنینەکانی دەستپێکردن دەردەکەون.",
    pending: "چاوەڕێ",
    cottage: "کۆتێج",
    customer: "کڕیار",
    partySize: "ژمارەی کەسان",
    bookingPeriod: "ماوەی حجز",
    bookingNote: "تێبینی حجز",
    responseDeadline: "وەڵام بدەرەوە پێش",
  },
};
