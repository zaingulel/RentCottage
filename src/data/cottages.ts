import type { Locale } from "@/i18n/routing";
import type { AmenityKey, AreaKey } from "@/domain/discovery";

type LocalizedText = Record<Locale, string>;

export interface Cottage {
  slug: string;
  image: string;
  gallery: string[];
  name: LocalizedText;
  area: LocalizedText;
  areaKey: AreaKey;
  amenities: AmenityKey[];
  description: LocalizedText;
  rules: Record<Locale, string[]>;
  price: number;
  capacity: number;
  bedrooms: number;
  bathrooms: number;
}

export const cottages: Cottage[] = [
  {
    slug: "garden-house",
    image: "cottage-garden.png",
    gallery: ["cottage-garden.png", "detail-tea.png", "interior-bedroom.png"],
    name: { ar: "بيت الحديقة", ckb: "ماڵی باخچە", en: "Garden House" },
    area: {
      ar: "الريف الشمالي",
      ckb: "گوندەکانی باکوور",
      en: "Northern Countryside",
    },
    areaKey: "north",
    amenities: ["garden", "outside", "family"],
    description: {
      ar: "بيت من طابق واحد تحيط به حديقة وارفة ومساحة خضراء آمنة للعائلة.",
      ckb: "ماڵێکی یەک نهۆمە کە باخچەیەکی سەوز و شوێنێکی ئارام بۆ خێزان دەوری داوە.",
      en: "A single-storey house wrapped in a lush garden, with calm and safe space for a family.",
    },
    rules: {
      ar: ["ممنوع قطف ثمار الحديقة دون إذن", "الهدوء التام بعد منتصف الليل"],
      ckb: [
        "بێ مۆڵەت میوەی باخچە مەچنەوە",
        "دوای نیوەشەو دەبێت ئارامی بپارێزرێت",
      ],
      en: [
        "Do not pick garden fruit without permission",
        "Quiet after midnight",
      ],
    },
    price: 135000,
    capacity: 5,
    bedrooms: 2,
    bathrooms: 1,
  },
  {
    slug: "sunset-house",
    image: "cottage-dusk.png",
    gallery: [
      "cottage-dusk.png",
      "interior-living.png",
      "interior-bedroom.png",
    ],
    name: { ar: "بيت الغروب", ckb: "ماڵی خۆرئاوابوون", en: "Sunset House" },
    area: { ar: "الواحة الغربية", ckb: "دەشتی ڕۆژئاوا", en: "Western Oasis" },
    areaKey: "highlands",
    amenities: ["pool", "ac", "outside"],
    description: {
      ar: "بيت حديث بروح ريفية، معروف بمسبحه المضاء وجلساته المسائية.",
      ckb: "ماڵێکی نوێ بە ڕۆحێکی گوندی، بە مەڵەوانگەی ڕووناک و دانیشتنی ئێوارە ناسراوە.",
      en: "A modern house with a rural soul, known for its lit pool and evening seating.",
    },
    rules: {
      ar: ["للعائلات والمجموعات الهادئة فقط", "ممنوع التدخين داخل البيت"],
      ckb: ["تەنها بۆ خێزان و گرووپی ئارام", "جگەرەکێشان لە ناو ماڵ قەدەغەیە"],
      en: ["Families and quiet groups only", "No smoking indoors"],
    },
    price: 240000,
    capacity: 8,
    bedrooms: 3,
    bathrooms: 2,
  },
  {
    slug: "river-house",
    image: "cottage-river.png",
    gallery: ["cottage-river.png", "detail-lattice.png", "interior-living.png"],
    name: { ar: "بيت النهر", ckb: "ماڵی ڕووبار", en: "River House" },
    area: { ar: "ضفاف دجلة", ckb: "کەناری دیجەلە", en: "Tigris Riverside" },
    areaKey: "orchards",
    amenities: ["net", "outside", "family"],
    description: {
      ar: "بيت هادئ بشرفة تطل على الماء وتفاصيل خشبية مستوحاة من البيوت العراقية.",
      ckb: "ماڵێکی ئارام بە سەکۆیەک بەرەو ئاو و وردەکاری دارین بە ڕەگ و ڕیشەی عێراقی.",
      en: "A peaceful house with a waterside veranda and woodwork inspired by Iraqi homes.",
    },
    rules: {
      ar: ["يجب الإشراف على الأطفال قرب الماء", "الهدوء بعد منتصف الليل"],
      ckb: ["منداڵان لە نزیک ئاو چاودێری بکرێن", "دوای نیوەشەو ئارامی بپارێزە"],
      en: [
        "Children must be supervised near the water",
        "Quiet after midnight",
      ],
    },
    price: 180000,
    capacity: 6,
    bedrooms: 2,
    bathrooms: 2,
  },
];

export function cottageBySlug(slug: string) {
  return cottages.find((cottage) => cottage.slug === slug);
}
