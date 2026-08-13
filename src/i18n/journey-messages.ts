import type { Locale } from "./routing";

export const journeyMessages: Record<
  Locale,
  {
    backResults: string;
    approvedOwner: string;
    approximateArea: string;
    capacity: string;
    bedrooms: string;
    bathrooms: string;
    nightlyPrice: string;
    description: string;
    houseRules: string;
    requestBooking: string;
    requestOnly: string;
    requestTitle: string;
    staySummary: string;
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
    approvedOwner: "مالك معتمد يدويًا",
    approximateArea: "الموقع التقريبي",
    capacity: "السعة",
    bedrooms: "غرف النوم",
    bathrooms: "الحمّامات",
    nightlyPrice: "سعر الليلة",
    description: "عن البيت",
    houseRules: "قواعد البيت",
    requestBooking: "اطلب الحجز",
    requestOnly: "طلب فقط، لا يُخصم أي مبلغ الآن",
    requestTitle: "مراجعة طلب الحجز",
    staySummary: "ملخص إقامتك",
    fullName: "الاسم الكامل",
    ownerNote: "ملاحظة للمالك",
    ownerNotePlaceholder: "مثال: معنا كبار في السن",
    terms: "قرأت وأوافق على شروط استخدام RentCottage",
    submit: "أرسل طلب الحجز",
    unavailable:
      "عرض للواجهة فقط. إرسال الطلب والتحقق من الهاتف سيُفعّلان في تذكرة لاحقة.",
  },
  ckb: {
    backResults: "گەڕانەوە بۆ ئەنجامەکان",
    approvedOwner: "خاوەنی بە دەستی پەسەندکراو",
    approximateArea: "ناوچەی نزیکەوە",
    capacity: "گنجایش",
    bedrooms: "ژووری نوستن",
    bathrooms: "حەمام",
    nightlyPrice: "نرخی شەو",
    description: "دەربارەی ماڵ",
    houseRules: "یاساکانی ماڵ",
    requestBooking: "داوای حجز بکە",
    requestOnly: "تەنها داواکارییە، ئێستا هیچ پارەیەک نابڕدرێت",
    requestTitle: "پێداچوونەوەی داواکاری حجز",
    staySummary: "پوختەی مانەوەکەت",
    fullName: "ناوی تەواو",
    ownerNote: "تێبینی بۆ خاوەنەکە",
    ownerNotePlaceholder: "بۆ نموونە: میوانی بەتەمەنمان لەگەڵە",
    terms: "مەرجەکانی بەکارهێنانی RentCottage ـم خوێندووەتەوە و ڕازیم",
    submit: "داواکاری حجز بنێرە",
    unavailable:
      "تەنها پێشاندانی ڕووکارە. ناردنی داواکاری و پشتڕاستکردنەوەی تەلەفۆن لە تیکەتی داهاتوو چالاک دەکرێت.",
  },
  en: {
    backResults: "Back to results",
    approvedOwner: "Manually approved owner",
    approximateArea: "Approximate area",
    capacity: "Capacity",
    bedrooms: "Bedrooms",
    bathrooms: "Bathrooms",
    nightlyPrice: "Nightly price",
    description: "About this home",
    houseRules: "House rules",
    requestBooking: "Request booking",
    requestOnly: "A request only, nothing is charged now",
    requestTitle: "Review booking request",
    staySummary: "Your stay",
    fullName: "Full name",
    ownerNote: "Note to the owner",
    ownerNotePlaceholder: "For example: we have elderly guests",
    terms: "I have read and agree to the RentCottage Terms of Use",
    submit: "Send booking request",
    unavailable:
      "Interface preview only. Request submission and phone verification will be enabled by a later ticket.",
  },
};
