import type { Locale } from "./routing";

export interface MarketplaceMessages {
  languageName: string;
  languageLabel: string;
  brand: string;
  tagline: string;
  heroTitle: string;
  heroSubtitle: string;
  retreatBlurb: string;
  trustedTitle: string;
  trustedSubtitle: string;
  steps: string[];
  footerDescription: string;
  footerDiscover: string;
  footerSearch: string;
  footerOwners: string;
  footerOwnerApplication: string;
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
    retreatBlurb:
      "بيوت قليلة، مختارة يدًا بيد مع أصحابها، من بساتين النخيل إلى المرتفعات.",
    trustedTitle: "حجز موثوق، خطوة بخطوة",
    trustedSubtitle: "نراجع كل مالكٍ بأنفسنا، ونحمي معلوماتك حتى لحظة التأكيد.",
    steps: [
      "كل مالكٍ يُراجَع ويُعتمد يدويًا قبل نشر بيته",
      "يصلك ردّ المالك على طلبك خلال 4 ساعات كحدٍّ أقصى",
      "العنوان الدقيق ومعلومات التواصل تُكشف بعد التأكيد فقط",
    ],
    footerDescription: "سوق مضبوطة لأصحاب بيوت ريفية تُعتمد يدويًا.",
    footerDiscover: "اكتشف",
    footerSearch: "ابحث عن البيوت المتاحة",
    footerOwners: "المالكون",
    footerOwnerApplication: "طلب المالك",
  },
  ckb: {
    languageName: "کوردی",
    languageLabel: "زمان",
    brand: "ڕێنت کۆتاج",
    tagline: "ماڵە گوندییەکانی عێراق",
    heroTitle: "ماڵێک لە گوند، تەنها بۆ ئێوە",
    heroSubtitle:
      "ماڵی گوندی بەوردی هەڵبژێردراو لە سەرانسەری عێراق، بە هەنگاوێکی ئارام داوا دەکرێت.",
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
    footerDescription:
      "بازاڕێکی کۆنترۆڵکراو لە خاوەن کۆتێجی بە دەستی پەسەندکراو.",
    footerDiscover: "بدۆزەرەوە",
    footerSearch: "گەڕان بۆ کۆتێجی بەردەست",
    footerOwners: "خاوەنەکان",
    footerOwnerApplication: "داواکاری خاوەن",
  },
  en: {
    languageName: "English",
    languageLabel: "Language",
    brand: "RentCottage",
    tagline: "Countryside homes of Iraq",
    heroTitle: "A house in the countryside, all yours",
    heroSubtitle:
      "Hand-picked rural homes across Iraq, requested in one quiet step.",
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
    footerDescription:
      "A controlled marketplace of manually approved cottage owners.",
    footerDiscover: "Discover",
    footerSearch: "Search available cottages",
    footerOwners: "Owners",
    footerOwnerApplication: "Owner application",
  },
};
