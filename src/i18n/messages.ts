import type { Locale } from "./routing";
import type {
  AmenityKey,
  AreaKey,
  BookingPeriodOption,
} from "@/domain/discovery";

export interface MarketplaceMessages {
  languageName: string;
  languageLabel: string;
  brand: string;
  tagline: string;
  heroTitle: string;
  heroSubtitle: string;
  areaLabel: string;
  allAreas: string;
  areas: { value: AreaKey; label: string }[];
  arrivalLabel: string;
  bookingPeriodLabel: string;
  bookingPeriods: Record<BookingPeriodOption, string>;
  guestsLabel: string;
  guestsUnit: string;
  amenitiesLabel: string;
  amenityNames: Record<AmenityKey, string>;
  searchCta: string;
  retreatBlurb: string;
  trustedTitle: string;
  trustedSubtitle: string;
  steps: string[];
  cottagePreviewTitle: string;
  selectedCottages: string;
  fictionalNote: string;
  backToSearch: string;
  resultsTitle: string;
  resultsSubtitle: string;
  approximateArea: string;
  samplePrice: string;
  viewCottage: string;
  searchSummary: string;
  noResults: string;
}

export const messages: Record<Locale, MarketplaceMessages> = {
  ar: {
    languageName: "العربية",
    languageLabel: "اللغة",
    brand: "ريف كوتج",
    tagline: "بيوت الريف العراقي",
    heroTitle: "بيتٌ في الريف، لكم وحدكم",
    heroSubtitle:
      "بيوت ريفية مختارة بعناية في أنحاء العراق، تُطلب بخطوةٍ واحدة هادئة.",
    areaLabel: "الموقع التقريبي",
    allAreas: "كل المناطق",
    areas: [
      { value: "north", label: "الريف الشمالي" },
      { value: "orchards", label: "بساتين النخيل" },
      { value: "highlands", label: "المرتفعات" },
    ],
    arrivalLabel: "تاريخ الوصول",
    bookingPeriodLabel: "فترة الحجز المفضلة",
    bookingPeriods: {
      "morning-shift": "الفترة الصباحية",
      "evening-shift": "الفترة المسائية",
      "full-day": "اليوم الكامل",
    },
    guestsLabel: "عدد الضيوف",
    guestsUnit: "ضيوف",
    amenitiesLabel: "مرافق اختيارية",
    amenityNames: {
      pool: "مسبح خاص",
      garden: "حديقة",
      ac: "تكييف",
      net: "إنترنت",
      outside: "جلسة خارجية",
      family: "مناسب للعائلات",
    },
    searchCta: "ابحث عن ملاذك",
    retreatBlurb:
      "بيوت قليلة، مختارة يدًا بيد مع أصحابها، من بساتين النخيل إلى المرتفعات.",
    trustedTitle: "حجز موثوق، خطوة بخطوة",
    trustedSubtitle: "نراجع كل مالكٍ بأنفسنا، ونحمي معلوماتك حتى لحظة التأكيد.",
    steps: [
      "كل مالكٍ يُراجَع ويُعتمد يدويًا قبل نشر بيته",
      "يصلك ردّ المالك على طلبك خلال 4 ساعات كحدٍّ أقصى",
      "العنوان الدقيق ومعلومات التواصل تُكشف بعد التأكيد فقط",
    ],
    cottagePreviewTitle: "بيوت مختارة",
    selectedCottages: "بيوت نموذجية",
    fictionalNote:
      "نموذج أولي للعرض، جميع الأسماء والمواقع والأسعار محتوى خيالي",
    backToSearch: "العودة إلى البحث",
    resultsTitle: "بيوت نموذجية تناسب بحثك",
    resultsSubtitle:
      "هذه واجهة تأسيسية، وتأكيد التوفر الفعلي سيُضاف في تذكرة الحجز.",
    approximateArea: "موقع تقريبي",
    samplePrice: "سعر نموذجي",
    viewCottage: "اعرض البيت",
    searchSummary: "اختيارات البحث المحفوظة",
    noResults: "لا توجد بيوت نموذجية تطابق هذه المرشحات. ارجع وعدّل البحث.",
  },
  ckb: {
    languageName: "کوردی",
    languageLabel: "زمان",
    brand: "ڕێنت کۆتاج",
    tagline: "ماڵە گوندییەکانی عێراق",
    heroTitle: "ماڵێک لە گوند، تەنها بۆ ئێوە",
    heroSubtitle:
      "ماڵی گوندی بەوردی هەڵبژێردراو لە سەرانسەری عێراق، بە هەنگاوێکی ئارام داوا دەکرێت.",
    areaLabel: "ناوچەی نزیکەوە",
    allAreas: "هەموو ناوچەکان",
    areas: [
      { value: "north", label: "گوندەکانی باکوور" },
      { value: "orchards", label: "باخەکانی خورما" },
      { value: "highlands", label: "بەرزاییەکان" },
    ],
    arrivalLabel: "ڕۆژی گەیشتن",
    bookingPeriodLabel: "ماوەی حجزکردنی پەسەندکراو",
    bookingPeriods: {
      "morning-shift": "شیفتی بەیانی",
      "evening-shift": "شیفتی ئێوارە",
      "full-day": "هەموو ڕۆژ",
    },
    guestsLabel: "ژمارەی میوان",
    guestsUnit: "میوان",
    amenitiesLabel: "خزمەتگوزارییە هەڵبژاردەییەکان",
    amenityNames: {
      pool: "مەڵەوانگەی تایبەت",
      garden: "باخچە",
      ac: "ساردکەرەوە",
      net: "وای فای",
      outside: "دانیشتنی دەرەوە",
      family: "گونجاو بۆ خێزان",
    },
    searchCta: "پەناگەکەت بدۆزەوە",
    retreatBlurb:
      "کۆمەڵێک ماڵی کەم، دەستبەدەست لەگەڵ خاوەنەکانیان هەڵبژێردراون، لە باخەکانی خورما تا بەرزاییەکان.",
    trustedTitle: "حجزێکی متمانەپێکراو، هەنگاو بە هەنگاو",
    trustedSubtitle:
      "خۆمان هەر خاوەنێک دەناسینەوە و زانیارییەکانت تا کاتی پشتڕاستکردنەوە دەپارێزین.",
    steps: [
      "هەر خاوەنێک پێش بڵاوکردنەوەی ماڵەکەی بە دەستی پشکنین و پەسەند دەکرێت",
      "خاوەنەکە لە ماوەی زۆرترین 4 کاتژمێردا وەڵامی داواکارییەکەت دەداتەوە",
      "ناونیشانی ورد و زانیاری پەیوەندی تەنها دوای پشتڕاستکردنەوە ئاشکرا دەکرێت",
    ],
    cottagePreviewTitle: "ماڵی هەڵبژێردراو",
    selectedCottages: "ماڵی نموونەیی",
    fictionalNote: "نموونەیەکی پێشاندانییە، هەموو ناو و شوێن و نرخەکان خەیاڵین",
    backToSearch: "گەڕانەوە بۆ گەڕان",
    resultsTitle: "ماڵی نموونەیی کە لە گەڕانەکەت دەگونجێت",
    resultsSubtitle:
      "ئەمە ڕووکاری بنەڕەتییە، پشتڕاستکردنەوەی بەردەستبوون لە تیکەتی حجز زیاد دەکرێت.",
    approximateArea: "ناوچەی نزیکەوە",
    samplePrice: "نرخی نموونەیی",
    viewCottage: "ماڵەکە ببینە",
    searchSummary: "هەڵبژاردنە پارێزراوەکانی گەڕان",
    noResults:
      "هیچ ماڵێکی نموونەیی لەگەڵ ئەم فلتەرانە ناگونجێت. بگەڕێوە و گەڕانەکە بگۆڕە.",
  },
  en: {
    languageName: "English",
    languageLabel: "Language",
    brand: "RentCottage",
    tagline: "Countryside homes of Iraq",
    heroTitle: "A house in the countryside, all yours",
    heroSubtitle:
      "Hand-picked rural homes across Iraq, requested in one quiet step.",
    areaLabel: "Approximate area",
    allAreas: "All areas",
    areas: [
      { value: "north", label: "Northern Countryside" },
      { value: "orchards", label: "Palm Orchards" },
      { value: "highlands", label: "The Highlands" },
    ],
    arrivalLabel: "Arrival date",
    bookingPeriodLabel: "Preferred booking period",
    bookingPeriods: {
      "morning-shift": "Morning shift",
      "evening-shift": "Evening shift",
      "full-day": "Full-day bundle",
    },
    guestsLabel: "Guests",
    guestsUnit: "guests",
    amenitiesLabel: "Optional amenities",
    amenityNames: {
      pool: "Private pool",
      garden: "Garden",
      ac: "Air conditioning",
      net: "Wi-Fi",
      outside: "Outdoor seating",
      family: "Family friendly",
    },
    searchCta: "Find your retreat",
    retreatBlurb:
      "A small collection, chosen hand in hand with their owners, from palm orchards to the highlands.",
    trustedTitle: "A trusted booking, step by step",
    trustedSubtitle:
      "We review every owner ourselves, and guard your details until the moment of confirmation.",
    steps: [
      "Every owner is manually reviewed and approved before their house is published",
      "The owner replies to your request within 4 hours at most",
      "The exact address and contact details are revealed only after confirmation",
    ],
    cottagePreviewTitle: "Selected homes",
    selectedCottages: "Sample cottages",
    fictionalNote:
      "Exploratory preview, all names, places and prices are fictional content",
    backToSearch: "Back to search",
    resultsTitle: "Sample cottages matching your search",
    resultsSubtitle:
      "This is the foundation interface. Live availability confirmation arrives in the booking ticket.",
    approximateArea: "Approximate area",
    samplePrice: "sample price",
    viewCottage: "View cottage",
    searchSummary: "Saved search choices",
    noResults:
      "No sample homes match these filters. Go back and adjust your search.",
  },
};
