import type { Locale } from "./routing";

export const ownerBookingRequestMessages: Record<
  Locale,
  {
    title: string;
    intro: string;
    paymentTitle: string;
    paymentIntro: string;
    empty: string;
    future: string;
    cottage: string;
    customer: string;
    partySize: string;
    bookingPeriod: string;
    bookingNote: string;
    responseDeadline: string;
    bookingPrice: string;
    commission: string;
    ownerNet: string;
    houseRules: string;
    openConfirmedBooking: string;
    notification: string;
    shift: string;
    fullDay: string;
  }
> = {
  en: {
    title: "Pending Booking Requests",
    intro:
      "Respond before the deadline. Customer contact and payment details stay private.",
    paymentTitle: "Booking Requests",
    paymentIntro:
      "Review each request’s status. Respond to pending requests before the deadline. Customer contact and payment details stay private.",
    empty: "No Booking Requests are waiting for your response.",
    future:
      "Online Booking Request alerts are not available yet. They will appear after launch checks are complete.",
    cottage: "Cottage",
    customer: "Customer",
    partySize: "Party size",
    bookingPeriod: "Booking Period",
    bookingNote: "Booking Note",
    responseDeadline: "Respond by",
    bookingPrice: "Booking Price",
    commission: "Marketplace commission",
    ownerNet: "Expected net amount",
    houseRules: "House Rules",
    openConfirmedBooking: "Open confirmed booking",
    notification: "Status notification",
    shift: "Cottage Shift",
    fullDay: "Full-Day Bundle",
  },
  ar: {
    title: "طلبات الحجز قيد الانتظار",
    intro: "رد قبل الموعد النهائي. تبقى بيانات اتصال العميل والدفع خاصة.",
    paymentTitle: "طلبات الحجز",
    paymentIntro:
      "راجع حالة كل طلب. رد على الطلبات قيد الانتظار قبل الموعد النهائي. تبقى بيانات اتصال العميل والدفع خاصة.",
    empty: "لا توجد طلبات حجز تنتظر ردك.",
    future:
      "تنبيهات طلبات الحجز عبر الإنترنت غير متاحة بعد. ستظهر بعد اكتمال فحوصات الإطلاق.",
    cottage: "البيت",
    customer: "العميل",
    partySize: "عدد أفراد المجموعة",
    bookingPeriod: "فترة الحجز",
    bookingNote: "ملاحظة الحجز",
    responseDeadline: "الرد قبل",
    bookingPrice: "سعر الحجز",
    commission: "عمولة المنصة",
    ownerNet: "صافي المبلغ المتوقع",
    houseRules: "قواعد البيت",
    openConfirmedBooking: "فتح الحجز المؤكد",
    notification: "إشعار الحالة",
    shift: "فترة البيت",
    fullDay: "باقة اليوم الكامل",
  },
  ckb: {
    title: "داواکارییە چاوەڕوانەکانی حجز",
    intro:
      "پێش کاتی کۆتایی وەڵام بدەرەوە. زانیاری پەیوەندی و پارەدانی کڕیار نهێنی دەمێنێتەوە.",
    paymentTitle: "داواکارییەکانی حجز",
    paymentIntro:
      "دۆخی هەر داواکارییەک بپشکنە. پێش کاتی کۆتایی وەڵامی داواکارییە چاوەڕوانەکان بدەرەوە. زانیاری پەیوەندی و پارەدانی کڕیار نهێنی دەمێنێتەوە.",
    empty: "هیچ داواکارییەکی حجز چاوەڕوانی وەڵامت نییە.",
    future:
      "ئاگادارکردنەوەکانی داواکاری حجزکردنی ئۆنلاین هێشتا بەردەست نین. دوای تەواوبوونی پشکنینەکانی دەستپێکردن دەردەکەون.",
    cottage: "کۆتێج",
    customer: "کڕیار",
    partySize: "ژمارەی کەسان",
    bookingPeriod: "ماوەی حجز",
    bookingNote: "تێبینی حجز",
    responseDeadline: "وەڵام بدەرەوە پێش",
    bookingPrice: "نرخی حجز",
    commission: "کۆمسیۆنی پلاتفۆرم",
    ownerNet: "بڕی چاوەڕوانکراوی خاوەن",
    houseRules: "یاساکانی کۆتێج",
    openConfirmedBooking: "کردنەوەی حجزی پشتڕاستکراو",
    notification: "ئاگادارکردنەوەی دۆخ",
    shift: "شەفتی کۆتێج",
    fullDay: "پاکێجی ڕۆژی تەواو",
  },
};
