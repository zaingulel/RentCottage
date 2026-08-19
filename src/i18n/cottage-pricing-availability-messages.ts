import type { Locale } from "./routing";

const en = {
  title: "Pricing and availability",
  intro:
    "Set positive whole Iraqi dinar prices and decide which future Service Days can be booked.",
  standard: "standard price in IQD",
  standardVisible: "Standard price in IQD",
  weekday: "weekday override",
  date: "specific-date override",
  addWeekday: "Add weekday override",
  addDate: "Add specific-date override",
  newWeekday: "new weekday override",
  newDate: "new specific-date override",
  noWeekday: "No weekday override",
  serviceDay: "Service Day",
  dayNames: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ],
  availability: "Availability for a future Service Day",
  state: "operational state",
  closed: "Closed",
  open: "Open",
  privateBlocked: "Private block",
  committed: "Committed",
  savePrices: "Save prices",
  loadAvailability: "Load availability",
  loadingAvailability: "Loading availability…",
  availabilityLoadError:
    "Availability could not be loaded. No operational state has been changed.",
  saveAvailability: "Save availability",
  saved: "Pricing and availability saved.",
  invalid: "Check the highlighted pricing or Service Day fields.",
  conflict:
    "This inventory revision changed elsewhere. Reload before saving again.",
  denied: "These inventory changes are not allowed right now.",
  unavailable:
    "Pricing and availability are temporarily unavailable. Please try again.",
  readOnly:
    "Pricing and availability are read-only while owner access is unavailable.",
  publicationRequired:
    "You can configure prices before publication. Opening inventory becomes available after this Cottage Profile is published.",
  noSchedule: "Save a valid Shift Schedule before configuring inventory.",
  required: "required",
} as const;

type Copy = { [Key in keyof typeof en]: string | readonly string[] };

const ar: Copy = {
  title: "الأسعار والتوافر",
  intro:
    "حدّد أسعاراً موجبة بأعداد صحيحة بالدينار العراقي، وقرّر أيام الخدمة المستقبلية التي يمكن حجزها.",
  standard: "القياسي بالدينار العراقي",
  standardVisible: "السعر القياسي بالدينار العراقي",
  weekday: "سعر بديل ليوم من أيام الأسبوع",
  date: "سعر بديل لتاريخ محدد",
  addWeekday: "إضافة سعر بديل ليوم من أيام الأسبوع",
  addDate: "إضافة سعر بديل لتاريخ محدد",
  newWeekday: "سعر بديل جديد ليوم من أيام الأسبوع",
  newDate: "سعر بديل جديد لتاريخ محدد",
  noWeekday: "لا يوجد سعر بديل ليوم الأسبوع",
  serviceDay: "يوم الخدمة",
  dayNames: [
    "الأحد",
    "الاثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة",
    "السبت",
  ],
  availability: "التوافر ليوم خدمة مستقبلي",
  state: "الحالة التشغيلية",
  closed: "مغلق",
  open: "مفتوح",
  privateBlocked: "حظر خاص",
  committed: "ملتزم به",
  savePrices: "حفظ الأسعار",
  loadAvailability: "تحميل التوافر",
  loadingAvailability: "جارٍ تحميل التوافر…",
  availabilityLoadError: "تعذّر تحميل التوافر. لم يتم تغيير أي حالة تشغيلية.",
  saveAvailability: "حفظ التوافر",
  saved: "تم حفظ الأسعار والتوافر.",
  invalid: "تحقق من حقول الأسعار أو يوم الخدمة المحدد.",
  conflict: "تغيّر إصدار المخزون في مكان آخر. أعد التحميل قبل الحفظ.",
  denied: "لا يُسمح بتغييرات المخزون هذه الآن.",
  unavailable: "الأسعار والتوافر غير متاحين مؤقتاً. حاول مرة أخرى.",
  readOnly: "الأسعار والتوافر للقراءة فقط أثناء عدم توفر وصول المالك.",
  publicationRequired:
    "يمكنك إعداد الأسعار قبل النشر. يصبح فتح المخزون متاحاً بعد نشر ملف الكوخ.",
  noSchedule: "احفظ جدول مناوبات صالحاً قبل إعداد المخزون.",
  required: "مطلوب",
};

const ckb: Copy = {
  title: "نرخ و بەردەستبوون",
  intro:
    "نرخی ئەرێنی بە ژمارەی تەواو بە دیناری عێراقی دابنێ و دیاری بکە کام ڕۆژانی خزمەتگوزاری داهاتوو دەتوانرێت حجز بکرێن.",
  standard: "نرخی ستاندارد بە دیناری عێراقی",
  standardVisible: "نرخی ستاندارد بە دیناری عێراقی",
  weekday: "نرخی جێگرەوەی ڕۆژی هەفتە",
  date: "نرخی جێگرەوەی بەرواری دیاریکراو",
  addWeekday: "زیادکردنی نرخی جێگرەوەی ڕۆژی هەفتە",
  addDate: "زیادکردنی نرخی جێگرەوەی بەرواری دیاریکراو",
  newWeekday: "نرخی جێگرەوەی نوێی ڕۆژی هەفتە",
  newDate: "نرخی جێگرەوەی نوێی بەرواری دیاریکراو",
  noWeekday: "هیچ نرخی جێگرەوەی ڕۆژی هەفتە نییە",
  serviceDay: "ڕۆژی خزمەتگوزاری",
  dayNames: [
    "یەکشەممە",
    "دووشەممە",
    "سێشەممە",
    "چوارشەممە",
    "پێنجشەممە",
    "هەینی",
    "شەممە",
  ],
  availability: "بەردەستبوون بۆ ڕۆژی خزمەتگوزاری داهاتوو",
  state: "دۆخی کارپێکردن",
  closed: "داخراو",
  open: "کراوە",
  privateBlocked: "بلۆکی تایبەت",
  committed: "پابەندکراو",
  savePrices: "پاشەکەوتکردنی نرخەکان",
  loadAvailability: "بارکردنی بەردەستبوون",
  loadingAvailability: "بەردەستبوون بار دەکرێت…",
  availabilityLoadError:
    "بەردەستبوون بار نەکرا. هیچ دۆخێکی کارپێکردن نەگۆڕدرا.",
  saveAvailability: "پاشەکەوتکردنی بەردەستبوون",
  saved: "نرخ و بەردەستبوون پاشەکەوت کران.",
  invalid: "خانەکانی نرخ یان ڕۆژی خزمەتگوزاری بپشکنە.",
  conflict:
    "وەشانی بەردەستبوونییەکە لە شوێنێکی تر گۆڕاوە. پێش پاشەکەوتکردن نوێی بکەرەوە.",
  denied: "ئێستا ڕێگە بە ئەم گۆڕانکارییەی بەردەستبوون نادرێت.",
  unavailable: "نرخ و بەردەستبوون کاتێک بەردەست نییە. دووبارە هەوڵ بدە.",
  readOnly:
    "نرخ و بەردەستبوون تەنها بۆ خوێندنەوەیە کاتێک دەستگەیشتنی خاوەن بەردەست نییە.",
  publicationRequired:
    "دەتوانیت پێش بڵاوکردنەوە نرخەکان دابنێیت. کردنەوەی بەردەستبوون دوای بڵاوکردنەوەی پڕۆفایلی کۆتیج بەردەست دەبێت.",
  noSchedule: "پێش ڕێکخستنی بەردەستبوون خشتەی شیفتێکی دروست پاشەکەوت بکە.",
  required: "پێویستە",
};

export const cottagePricingAvailabilityMessages: Record<Locale, Copy> = {
  en,
  ar,
  ckb,
};
