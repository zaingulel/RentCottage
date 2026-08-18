import type { Locale } from "./routing";

const en = {
  title: "Daily Shift Schedule",
  intro:
    "Define two required recurring Cottage Shifts and, if needed, one optional third shift.",
  readOnly:
    "The Shift Schedule is read-only while this Cottage Profile is in content review.",
  shift: "Shift",
  required: "Required",
  optional: "Optional",
  name: "name",
  startTime: "start time",
  endTime: "end time",
  crossMidnight:
    "When an end time is earlier than its start time, the shift crosses midnight and belongs to the Service Day on which it starts.",
  fullDay: "Full-Day Bundle",
  fullDayEmpty: "Save a valid Shift Schedule to define the Full-Day Bundle.",
  nextDay: "next day",
  save: "Save Shift Schedule",
  saved: "Shift Schedule saved as a new revision.",
  invalid:
    "Enter exactly two or three complete shifts with different start and end times.",
  overlap: "These recurring shifts overlap. Touching endpoints are allowed.",
  conflict:
    "This Shift Schedule changed elsewhere. Reload before saving again.",
  denied: "This Shift Schedule cannot be changed right now.",
  unavailable:
    "The Shift Schedule is temporarily unavailable. Please try again.",
} as const;

type Copy = { [Key in keyof typeof en]: string };

const ar: Copy = {
  title: "جدول المناوبات اليومية",
  intro: "حدّد مناوبتين متكررتين مطلوبتين، ويمكنك إضافة مناوبة ثالثة اختيارية.",
  readOnly: "جدول المناوبات للقراءة فقط أثناء مراجعة محتوى ملف الكوخ.",
  shift: "المناوبة",
  required: "مطلوبة",
  optional: "اختيارية",
  name: "الاسم",
  startTime: "وقت البدء",
  endTime: "وقت الانتهاء",
  crossMidnight:
    "إذا كان وقت الانتهاء أسبق من وقت البدء، تعبر المناوبة منتصف الليل وتتبع يوم الخدمة الذي بدأت فيه.",
  fullDay: "باقة اليوم الكامل",
  fullDayEmpty: "احفظ جدول مناوبات صالحاً لتحديد باقة اليوم الكامل.",
  nextDay: "اليوم التالي",
  save: "حفظ جدول المناوبات",
  saved: "حُفظ جدول المناوبات كمراجعة جديدة.",
  invalid: "أدخل مناوبتين أو ثلاث مناوبات مكتملة بأوقات بدء وانتهاء مختلفة.",
  overlap: "هذه المناوبات المتكررة متداخلة. يُسمح بتلامس نقاط النهاية.",
  conflict: "تغيّر جدول المناوبات في مكان آخر. أعد التحميل قبل الحفظ.",
  denied: "لا يمكن تغيير جدول المناوبات الآن.",
  unavailable: "جدول المناوبات غير متاح مؤقتاً. حاول مرة أخرى.",
};

const ckb: Copy = {
  title: "خشتەی شیفتە ڕۆژانەکان",
  intro:
    "دوو شیفتی دووبارەبووەوەی پێویست دیاری بکە و ئەگەر پێویست بوو شیفتێکی سێیەمی ئارەزوومەندانە زیاد بکە.",
  readOnly:
    "خشتەی شیفتەکان لە کاتی پێداچوونەوەی ناوەڕۆکدا تەنها بۆ خوێندنەوەیە.",
  shift: "شیفت",
  required: "پێویست",
  optional: "ئارەزوومەندانە",
  name: "ناو",
  startTime: "کاتی دەستپێک",
  endTime: "کاتی کۆتایی",
  crossMidnight:
    "ئەگەر کاتی کۆتایی پێش کاتی دەستپێک بێت، شیفتەکە نیوەشەو دەبڕێت و سەر بە ڕۆژی خزمەتگوزاری دەستپێکەکەیە.",
  fullDay: "پاکێجی ڕۆژی تەواو",
  fullDayEmpty:
    "خشتەی شیفتێکی دروست پاشەکەوت بکە بۆ دیاریکردنی پاکێجی ڕۆژی تەواو.",
  nextDay: "ڕۆژی دواتر",
  save: "پاشەکەوتکردنی خشتەی شیفتەکان",
  saved: "خشتەی شیفتەکان وەک وەشانێکی نوێ پاشەکەوت کرا.",
  invalid: "دوو یان سێ شیفتی تەواو بە کاتی دەستپێک و کۆتایی جیاواز بنووسە.",
  overlap:
    "ئەم شیفتە دووبارەبووانە تێکدەچن. پێکگەیشتنی خاڵی کۆتایی ڕێگەپێدراوە.",
  conflict:
    "خشتەی شیفتەکان لە شوێنێکی تر گۆڕاوە. پێش پاشەکەوتکردن نوێی بکەرەوە.",
  denied: "ئێستا ناتوانرێت خشتەی شیفتەکان بگۆڕدرێت.",
  unavailable: "خشتەی شیفتەکان کاتێک بەردەست نییە. دووبارە هەوڵ بدە.",
};

export const cottageShiftScheduleMessages: Record<Locale, Copy> = {
  en,
  ar,
  ckb,
};
