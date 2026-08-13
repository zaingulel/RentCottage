import type { Locale } from "./routing";

export const journeyMessages: Record<
  Locale,
  {
    backResults: string;
    backCottage: string;
    approximateArea: string;
    capacity: string;
    bedrooms: string;
    bathrooms: string;
    samplePrice: string;
    description: string;
    houseRules: string;
    requestBooking: string;
    requestOnly: string;
    requestTitle: string;
    cottageSummary: string;
    fullName: string;
    ownerNote: string;
    ownerNotePlaceholder: string;
    terms: string;
    submit: string;
    unavailable: string;
  }
> = {
  ar: {
    backResults: "العودة إلى النتائج",
    backCottage: "العودة إلى البيت",
    approximateArea: "الموقع التقريبي",
    capacity: "السعة",
    bedrooms: "غرف النوم",
    bathrooms: "الحمّامات",
    samplePrice: "سعر نموذجي",
    description: "عن البيت",
    houseRules: "قواعد البيت",
    requestBooking: "اطلب الحجز",
    requestOnly: "طلب فقط، لا يُخصم أي مبلغ الآن",
    requestTitle: "مراجعة طلب الحجز",
    cottageSummary: "ملخص البيت",
    fullName: "الاسم الكامل",
    ownerNote: "ملاحظة للمالك",
    ownerNotePlaceholder: "مثال: معنا كبار في السن",
    terms: "قرأت وأوافق على شروط استخدام RentCottage",
    submit: "أرسل طلب الحجز",
    unavailable:
      "التحقق من الهاتف متاح. إرسال طلب الحجز سيُفعّل في تذكرة لاحقة.",
  },
  ckb: {
    backResults: "گەڕانەوە بۆ ئەنجامەکان",
    backCottage: "گەڕانەوە بۆ ماڵەکە",
    approximateArea: "ناوچەی نزیکەوە",
    capacity: "گنجایش",
    bedrooms: "ژووری نوستن",
    bathrooms: "حەمام",
    samplePrice: "نرخی نموونەیی",
    description: "دەربارەی ماڵ",
    houseRules: "یاساکانی ماڵ",
    requestBooking: "داوای حجز بکە",
    requestOnly: "تەنها داواکارییە، ئێستا هیچ پارەیەک نابڕدرێت",
    requestTitle: "پێداچوونەوەی داواکاری حجز",
    cottageSummary: "پوختەی ماڵەکە",
    fullName: "ناوی تەواو",
    ownerNote: "تێبینی بۆ خاوەنەکە",
    ownerNotePlaceholder: "بۆ نموونە: میوانی بەتەمەنمان لەگەڵە",
    terms: "مەرجەکانی بەکارهێنانی RentCottage ـم خوێندووەتەوە و ڕازیم",
    submit: "داواکاری حجز بنێرە",
    unavailable:
      "پشتڕاستکردنەوەی تەلەفۆن بەردەستە. ناردنی داواکاری حجز لە تیکەتی داهاتوو چالاک دەکرێت.",
  },
  en: {
    backResults: "Back to results",
    backCottage: "Back to cottage",
    approximateArea: "Approximate area",
    capacity: "Capacity",
    bedrooms: "Bedrooms",
    bathrooms: "Bathrooms",
    samplePrice: "Sample price",
    description: "About this home",
    houseRules: "House rules",
    requestBooking: "Request booking",
    requestOnly: "A request only, nothing is charged now",
    requestTitle: "Review booking request",
    cottageSummary: "Cottage summary",
    fullName: "Full name",
    ownerNote: "Note to the owner",
    ownerNotePlaceholder: "For example: we have elderly guests",
    terms: "I have read and agree to the RentCottage Terms of Use",
    submit: "Send booking request",
    unavailable:
      "Phone verification is available. Booking request submission will be enabled by a later ticket.",
  },
};
