import type { Locale } from "./routing";

const en = {
  title: "Shift schedule",
  intro: "Set the times customers can book.",
  readOnly:
    "This schedule can be edited only while the cottage profile is a draft and your owner account is approved. Existing booking requests and confirmed bookings keep their original times.",
  shift: "Shift",
  required: "Required",
  optional: "Optional",
  name: "name",
  startTime: "Starts",
  endTime: "Ends",
  morning: "Morning",
  evening: "Evening",
  localName: "Local name (optional)",
  iraqTimeZone: "All times are Iraq local time (UTC+3).",
  clockFormat:
    "Time fields may show 12- or 24-hour times. The access summary uses 24-hour times.",
  morningAccess: "Morning access",
  eveningAccess: "Evening access",
  accessRange: "{start} to {end}",
  sameDay: "same day",
  crossMidnight: "The booking date is the day the shift starts.",
  cleaningTitle: "Cleaning between separate bookings",
  cleaning:
    "Consider leaving time between shifts for cleaning. You choose whether to leave a gap and how long it is. Full-day customers keep access during this gap.",
  fullDay: "Full-day",
  fullDayEmpty: "Complete both shifts to see Full-day access.",
  fullDayIncludes: "Includes Morning and Evening, with continuous access.",
  fullDayAccess: "Full-day access",
  includingGap: "including the {start} to {end} gap",
  betweenShifts: "Between shifts",
  fullDayBetweenShifts: "Customers may remain between the two shifts.",
  consecutiveDays: "Consecutive days",
  consecutiveDaysAccess:
    "Full-day bookings for {firstDay} and {lastDay} give continuous access from {start} to {end}, including overnight gaps.",
  nextDay: "next day",
  prices: "Prices",
  independentPrices:
    "Set the Full-day price separately from individual shift prices. Saving the schedule does not save prices or open availability.",
  reset:
    "After changing the schedule, set prices and availability again. Previous settings are not copied, and bookings do not open automatically.",
  confirmedTimes: "I checked these times and Full-day access.",
  requiredConfirmation: "Check the times and confirm them before saving.",
  save: "Save schedule",
  saved: "Shift Schedule saved.",
  invalid:
    "Enter exactly two complete shifts with different start and end times.",
  overlap: "These recurring shifts overlap. Touching endpoints are allowed.",
  conflict: "This schedule changed elsewhere. Reload before saving again.",
  committed:
    "This schedule is in use by a booking or payment request and cannot be replaced now. Its times have not changed.",
  legacyRead:
    "This existing three-shift schedule is read-only. Contact platform support before changing it.",
  denied: "This Shift Schedule cannot be changed right now.",
  unavailable:
    "The Shift Schedule is temporarily unavailable. Please try again.",
} as const;

export type Copy = { [Key in keyof typeof en]: string };

const ar: Copy = {
  title: "جدول الفترات",
  intro: "حدّد الأوقات التي يمكن للعملاء حجزها.",
  readOnly:
    "يمكن تعديل الجدول فقط عندما يكون ملف الكوخ مسودة ويكون حساب المالك معتمداً. تحتفظ طلبات الحجز والحجوزات المؤكدة بأوقاتها الأصلية.",
  shift: "المناوبة",
  required: "مطلوبة",
  optional: "اختيارية",
  name: "الاسم",
  startTime: "يبدأ",
  endTime: "ينتهي",
  morning: "الفترة الصباحية",
  evening: "الفترة المسائية",
  localName: "الاسم المحلي (اختياري)",
  iraqTimeZone: "جميع الأوقات بتوقيت العراق (UTC+3).",
  clockFormat:
    "قد تعرض حقول الوقت صيغة 12 أو 24 ساعة. يظهر ملخص الأوقات بصيغة 24 ساعة.",
  morningAccess: "دخول الفترة الصباحية",
  eveningAccess: "دخول الفترة المسائية",
  accessRange: "من {start} إلى {end}",
  sameDay: "في اليوم نفسه",
  crossMidnight: "تاريخ الحجز هو اليوم الذي تبدأ فيه الفترة.",
  cleaningTitle: "التنظيف بين الحجوزات المنفصلة",
  cleaning:
    "فكّر في ترك وقت للتنظيف بين الفترتين. أنت تختار ترك فاصل من عدمه ومدته. يحتفظ عملاء حجز اليوم الكامل بحق الدخول والبقاء خلال هذا الفاصل.",
  fullDay: "حجز اليوم الكامل",
  fullDayEmpty: "أكمل الفترتين لعرض مدة الدخول والبقاء في حجز اليوم الكامل.",
  fullDayIncludes: "يشمل الفترتين الصباحية والمسائية، مع دخول وبقاء متواصلين.",
  fullDayAccess: "دخول اليوم الكامل",
  includingGap: "بما في ذلك الفاصل من {start} إلى {end}",
  betweenShifts: "بين الفترتين",
  fullDayBetweenShifts: "يمكن للعملاء البقاء بين الفترتين.",
  consecutiveDays: "أيام متتالية",
  consecutiveDaysAccess:
    "حجز اليوم الكامل ليومي {firstDay} و{lastDay} يتيح البقاء المتواصل من {start} إلى {end}، بما في ذلك الفواصل الليلية.",
  nextDay: "اليوم التالي",
  prices: "الأسعار",
  independentPrices:
    "حدّد سعر اليوم الكامل بشكل مستقل عن أسعار الفترات المنفردة. حفظ الجدول لا يحفظ الأسعار ولا يفتح الأوقات للحجز.",
  reset:
    "بعد تغيير الجدول، اضبط الأسعار والتوفّر من جديد. لا تُنسخ الإعدادات السابقة ولا يُفتح الحجز تلقائياً.",
  confirmedTimes:
    "تحققت من هذه الأوقات ومن مدة الدخول والبقاء في حجز اليوم الكامل.",
  requiredConfirmation: "راجع الأوقات وأكّدها قبل الحفظ.",
  save: "حفظ الجدول",
  saved: "حُفظ جدول المناوبات.",
  invalid: "أدخل مناوبتين مكتملتين بأوقات بدء وانتهاء مختلفة.",
  overlap: "هذه المناوبات المتكررة متداخلة. يُسمح بتلامس نقاط النهاية.",
  conflict: "تغيّر الجدول في مكان آخر. أعد تحميل الصفحة قبل الحفظ مرة أخرى.",
  committed:
    "هذا الجدول مرتبط بحجز أو طلب دفع ولا يمكن استبداله الآن. لم تتغير أوقاته.",
  legacyRead:
    "هذا الجدول القائم بثلاث فترات متاح للقراءة فقط. تواصل مع دعم المنصة قبل تغييره.",
  denied: "لا يمكن تغيير جدول المناوبات الآن.",
  unavailable: "جدول المناوبات غير متاح مؤقتاً. حاول مرة أخرى.",
};

const ckb: Copy = {
  title: "خشتەی ماوەکان",
  intro: "ئەو کاتانە دیاری بکە کە کڕیاران دەتوانن حجز بکەن.",
  readOnly:
    "تەنها کاتێک دەتوانیت خشتەکە دەستکاری بکەیت کە پرۆفایلی کۆخەکە ڕەشنووس بێت و هەژماری خاوەنەکە پەسەند کرابێت. داواکارییەکانی حجز و حجزە پشتڕاستکراوەکان کاتە ڕەسەنەکانیان دەپارێزن.",
  shift: "شیفت",
  required: "پێویست",
  optional: "ئارەزوومەندانە",
  name: "ناو",
  startTime: "دەست پێ دەکات",
  endTime: "کۆتایی دێت",
  morning: "ماوەی بەیانی",
  evening: "ماوەی ئێوارە",
  localName: "ناوی ناوخۆیی (ئارەزوومەندانە)",
  iraqTimeZone: "هەموو کاتەکان بە کاتی عێراقن (UTC+3).",
  clockFormat:
    "خانەکانی کات لەوانەیە شێوازی ١٢ یان ٢٤ کاتژمێر پیشان بدەن. پوختەی کاتەکان بە شێوازی ٢٤ کاتژمێر پیشان دەدرێت.",
  morningAccess: "بەکارهێنانی ماوەی بەیانی",
  eveningAccess: "بەکارهێنانی ماوەی ئێوارە",
  accessRange: "لە {start} تا {end}",
  sameDay: "لە هەمان ڕۆژدا",
  crossMidnight: "بەرواری حجز ئەو ڕۆژەیە کە ماوەکە تێیدا دەست پێ دەکات.",
  cleaningTitle: "پاککردنەوە لە نێوان حجزە جیاوازەکان",
  cleaning:
    "بیر لە جێهێشتنی کاتێک بۆ پاککردنەوە لە نێوان ماوەکان بکەرەوە. تۆ بڕیار دەدەیت بۆشایی هەبێت یان نا و ماوەکەی چەند بێت. کڕیارانی حجزکردنی تەواوی ڕۆژ لەو بۆشاییەشدا مافی مانەوەیان هەیە.",
  fullDay: "حجزکردنی تەواوی ڕۆژ",
  fullDayEmpty:
    "هەردوو ماوەکە تەواو بکە بۆ بینینی ماوەی بەکارهێنانی حجزکردنی تەواوی ڕۆژ.",
  fullDayIncludes:
    "ماوەی بەیانی و ئێوارە دەگرێتەوە، بە مافی بەکارهێنان و مانەوەی بەردەوام.",
  fullDayAccess: "بەکارهێنانی تەواوی ڕۆژ",
  includingGap: "لەگەڵ بۆشایی نێوان {start} و {end}",
  betweenShifts: "لە نێوان ماوەکان",
  fullDayBetweenShifts: "کڕیاران دەتوانن لە نێوان هەردوو ماوەکەدا بمێننەوە.",
  consecutiveDays: "ڕۆژە بەردەوامەکان",
  consecutiveDaysAccess:
    "حجزکردنی تەواوی ڕۆژ بۆ {firstDay} و {lastDay} مافی مانەوەی بەردەوام دەدات لە {start} تا {end}، لەگەڵ بۆشاییەکانی شەو.",
  nextDay: "ڕۆژی دواتر",
  prices: "نرخەکان",
  independentPrices:
    "نرخی تەواوی ڕۆژ بە شێوەی سەربەخۆ لە نرخی هەر ماوەیەک دیاری بکە. پاشەکەوتکردنی خشتە نرخەکان پاشەکەوت ناکات و کاتەکان بۆ حجز ناکاتەوە.",
  reset:
    "دوای گۆڕینی خشتەکە، نرخەکان و بەردەستبوون دووبارە ڕێک بخە. ڕێکخستنە پێشوەکان کۆپی ناکرێن و حجزکردن بە خۆکار ناکرێتەوە.",
  confirmedTimes:
    "ئەم کاتانە و ماوەی بەکارهێنانی حجزکردنی تەواوی ڕۆژم پشکنین کرد.",
  requiredConfirmation: "کاتەکان بپشکنە و پێش پاشەکەوتکردن پشتڕاستیان بکەرەوە.",
  save: "پاشەکەوتکردنی خشتە",
  saved: "خشتەی شیفتەکان پاشەکەوت کرا.",
  invalid: "دوو شیفتی تەواو بە کاتی دەستپێک و کۆتایی جیاواز بنووسە.",
  overlap:
    "ئەم شیفتە دووبارەبووانە بەسەر یەکدا دەکەون. پێکگەیشتنی خاڵی کۆتایی ڕێگەپێدراوە.",
  conflict:
    "خشتەکە لە شوێنێکی تر گۆڕاوە. پێش پاشەکەوتکردنەوە پەڕەکە نوێ بکەرەوە.",
  committed:
    "ئەم خشتەیە لە حجزێک یان داواکاریی پارەدانێکدا بەکاردێت و ئێستا ناتوانرێت بگۆڕدرێت. کاتەکانی نەگۆڕاون.",
  legacyRead:
    "ئەم خشتە هەبووەی سێ ماوەیە تەنها بۆ خوێندنەوەیە. پێش گۆڕینی پەیوەندی بە پاڵپشتی پلاتفۆرمەکەوە بکە.",
  denied: "ئێستا ناتوانرێت خشتەی شیفتەکان بگۆڕدرێت.",
  unavailable:
    "خشتەی شیفتەکان بە شێوەیەکی کاتی بەردەست نییە. دووبارە هەوڵ بدە.",
};

export const cottageShiftScheduleMessages: Record<Locale, Copy> = {
  en,
  ar,
  ckb,
};
