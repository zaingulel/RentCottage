import type { Locale } from "./routing";

const en = {
  iraqTimeZone: "All times are Iraq local time (UTC+3).",
  morning: "Morning",
  evening: "Evening",
  fullDay: "Full-day",
  arrival: "Arrival",
  departure: "Departure",
  nextDay: "next day",
  selected: "Selected",
  selectedAccess: "Your selected access",
  choose: "Choose one or more individual shifts, or Full-day, for each date.",
  fullDayIncludes:
    "Includes Morning and Evening with continuous access, including the time between them.",
  fullDaySchedule:
    "Full-day follows this cottage's schedule. It is not always 24 hours.",
  fullDayPrice: "Full-day has its own price.",
  consecutive:
    "Continuous access includes the overnight time between these Full-day dates.",
  gap: "No access between {departure} and {arrival}.",
};
type Copy = { [Key in keyof typeof en]: string };

const ar: Copy = {
  iraqTimeZone: "جميع الأوقات بتوقيت العراق (UTC+3).",
  morning: "الفترة الصباحية",
  evening: "الفترة المسائية",
  fullDay: "حجز اليوم الكامل",
  arrival: "الوصول",
  departure: "المغادرة",
  nextDay: "اليوم التالي",
  selected: "محدد",
  selectedAccess: "أوقات الدخول والبقاء التي اخترتها",
  choose: "اختر فترة منفردة أو أكثر، أو حجز اليوم الكامل، لكل تاريخ.",
  fullDayIncludes:
    "يشمل الفترتين الصباحية والمسائية مع دخول وبقاء متواصلين، بما في ذلك الوقت بينهما.",
  fullDaySchedule:
    "يتبع حجز اليوم الكامل جدول هذا الكوخ. مدته ليست دائماً 24 ساعة.",
  fullDayPrice: "لحجز اليوم الكامل سعر مستقل.",
  consecutive:
    "يشمل الدخول والبقاء المتواصلان الوقت الليلي بين تواريخ حجز اليوم الكامل هذه.",
  gap: "لا يحق لك الدخول أو البقاء بين {departure} و{arrival}.",
};

const ckb: Copy = {
  iraqTimeZone: "هەموو کاتەکان بە کاتی عێراقن (UTC+3).",
  morning: "ماوەی بەیانی",
  evening: "ماوەی ئێوارە",
  fullDay: "حجزکردنی تەواوی ڕۆژ",
  arrival: "گەیشتن",
  departure: "ڕۆیشتن",
  nextDay: "ڕۆژی دواتر",
  selected: "هەڵبژێردراوە",
  selectedAccess: "کاتە هەڵبژێردراوەکانی بەکارهێنان و مانەوەت",
  choose:
    "بۆ هەر بەروارێک یەک ماوەی تاک یان زیاتر، یان حجزکردنی تەواوی ڕۆژ هەڵبژێرە.",
  fullDayIncludes:
    "ماوەی بەیانی و ئێوارە دەگرێتەوە بە مافی بەکارهێنان و مانەوەی بەردەوام، لەگەڵ کاتی نێوانیان.",
  fullDaySchedule:
    "حجزکردنی تەواوی ڕۆژ شوێن خشتەی ئەم کۆخە دەکەوێت. هەمیشە 24 کاتژمێر نییە.",
  fullDayPrice: "حجزکردنی تەواوی ڕۆژ نرخی خۆی هەیە.",
  consecutive:
    "بەکارهێنان و مانەوەی بەردەوام کاتی شەوی نێوان ئەم بەروارانەی حجزکردنی تەواوی ڕۆژیش دەگرێتەوە.",
  gap: "لە نێوان {departure} و {arrival} مافی بەکارهێنان و مانەوەت نییە.",
};

export const bookingPeriodMessages: Record<Locale, Copy> = { en, ar, ckb };
