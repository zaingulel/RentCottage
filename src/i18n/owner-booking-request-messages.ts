import type { BookingQuoteItem } from "@/booking-quote/booking-quote";
import type { BookingRequestResponseTimeLeft } from "@/booking-request/booking-request-status";
import { formatCount, formatServiceDay, type CountForms } from "./format";
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
    guests: CountForms;
    answerWithinHours: CountForms;
    answerWithinMinutes: CountForms;
    answerUnderAMinute: string;
    answerTimeEnded: string;
    listSeparator: string;
    viewRequest: string;
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
    guests: { one: "{count} guest", other: "{count} guests" },
    answerWithinHours: {
      one: "Answer within {count} hour",
      other: "Answer within {count} hours",
    },
    answerWithinMinutes: {
      one: "Answer within {count} minute",
      other: "Answer within {count} minutes",
    },
    answerUnderAMinute: "Less than a minute left to answer",
    answerTimeEnded: "The time to answer has ended",
    listSeparator: ", ",
    viewRequest: "View request",
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
    guests: {
      one: "{count} ضيف",
      two: "{count} ضيفان",
      few: "{count} ضيوف",
      many: "{count} ضيفًا",
      other: "{count} ضيف",
    },
    answerWithinHours: {
      one: "أجب خلال {count} ساعة",
      two: "أجب خلال {count} ساعتين",
      few: "أجب خلال {count} ساعات",
      many: "أجب خلال {count} ساعة",
      other: "أجب خلال {count} ساعة",
    },
    answerWithinMinutes: {
      one: "أجب خلال {count} دقيقة",
      two: "أجب خلال {count} دقيقتين",
      few: "أجب خلال {count} دقائق",
      many: "أجب خلال {count} دقيقة",
      other: "أجب خلال {count} دقيقة",
    },
    answerUnderAMinute: "بقي أقل من دقيقة للرد",
    answerTimeEnded: "انتهى وقت الرد",
    listSeparator: "، ",
    viewRequest: "عرض الطلب",
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
    ownerNet: "بڕی پوختی چاوەڕوانکراو",
    houseRules: "یاساکانی کۆتێج",
    openConfirmedBooking: "کردنەوەی حجزی پشتڕاستکراو",
    notification: "ئاگادارکردنەوەی دۆخ",
    shift: "شەفتی کۆتێج",
    fullDay: "پاکێجی ڕۆژی تەواو",
    guests: { other: "{count} میوان" },
    answerWithinHours: {
      other: "لە ماوەی {count} کاتژمێردا وەڵام بدەرەوە",
    },
    answerWithinMinutes: {
      other: "لە ماوەی {count} خولەکدا وەڵام بدەرەوە",
    },
    answerUnderAMinute: "کەمتر لە خولەکێک ماوە بۆ وەڵامدانەوە",
    answerTimeEnded: "کاتی وەڵامدانەوە تەواو بووە",
    listSeparator: "، ",
    viewRequest: "بینینی داواکارییەکە",
  },
};

export function ownerRequestGuests(locale: Locale, partySize: number): string {
  return formatCount(
    partySize,
    locale,
    ownerBookingRequestMessages[locale].guests,
  );
}

export function ownerRequestTimeLeft(
  locale: Locale,
  timeLeft: BookingRequestResponseTimeLeft,
): string {
  const messages = ownerBookingRequestMessages[locale];
  switch (timeLeft.unit) {
    case "hours":
      return formatCount(timeLeft.count, locale, messages.answerWithinHours);
    case "minutes":
      return formatCount(timeLeft.count, locale, messages.answerWithinMinutes);
    case "under-a-minute":
      return messages.answerUnderAMinute;
    case "elapsed":
      return messages.answerTimeEnded;
  }
}

export function ownerRequestPeriod(
  locale: Locale,
  bookingPeriod: readonly Pick<
    BookingQuoteItem,
    "serviceDay" | "displayName"
  >[],
): string[] {
  const days: { serviceDay: string; names: string[] }[] = [];
  for (const { serviceDay, displayName } of bookingPeriod) {
    const last = days.at(-1);
    if (last?.serviceDay === serviceDay) last.names.push(displayName);
    else days.push({ serviceDay, names: [displayName] });
  }
  const { listSeparator } = ownerBookingRequestMessages[locale];
  return days.map(
    ({ serviceDay, names }) =>
      `${formatServiceDay(serviceDay, locale, { weekday: true })}: ${names.join(listSeparator)}`,
  );
}
