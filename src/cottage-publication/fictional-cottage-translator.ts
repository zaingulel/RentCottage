import {
  TranslationExecutionUnavailableError,
  type CottageTranslator,
} from "./cottage-publication";

const sharedHouseRules =
  "Fictional demonstration only. Respect neighbours, do not smoke indoors, and keep the party within the cottage's stated guest capacity.";
const sampleHouseRules = {
  ar: "للعرض الخيالي فقط. احترم الجيران، ولا تدخن داخل المنزل، والتزم بعدد الضيوف المحدد للكوخ.",
  ckb: "تەنها بۆ پیشاندانی خەیاڵی. ڕێزی دراوسێکان بگرە، لە ناو ماڵ جگەرە مەکێشە و ژمارەی میوانان لە سنووری دیاریکراوی کۆتێجەکە زیاتر مەکە.",
};

const catalog: readonly { source: string; ar: string; ckb: string }[] = [
  {
    source:
      "Fictional demonstration cottage in the Shaqlawa area of Erbil. A garden and pool setting for up to eight guests, with three bedrooms, two bathrooms and parking. No real accommodation is offered.",
    ar: "كوخ تجريبي خيالي في منطقة شقلاوة في أربيل. حديقة ومسبح لما يصل إلى ثمانية ضيوف، مع ثلاث غرف نوم وحمامين وموقف سيارات. لا يُعرض أي سكن حقيقي.",
    ckb: "کۆتێجێکی خەیاڵی بۆ پیشاندان لە ناوچەی شەقڵاوەی هەولێر. باخچە و مەلەوانگە بۆ تا هەشت میوان، لەگەڵ سێ ژووری نووستن و دوو حەمام و شوێنی پارککردن. هیچ شوێنێکی ڕاستەقینە بۆ مانەوە پێشکەش ناکرێت.",
  },
  {
    source:
      "Fictional demonstration cottage in the Koya area of Erbil. Garden and outdoor seating for up to six guests, with two bedrooms, one bathroom and parking. No real accommodation is offered.",
    ar: "كوخ تجريبي خيالي في منطقة كوية في أربيل. حديقة وجلسات خارجية لما يصل إلى ستة ضيوف، مع غرفتي نوم وحمام واحد وموقف سيارات. لا يُعرض أي سكن حقيقي.",
    ckb: "کۆتێجێکی خەیاڵی بۆ پیشاندان لە ناوچەی کۆیەی هەولێر. باخچە و دانیشتنی دەرەوە بۆ تا شەش میوان، لەگەڵ دوو ژووری نووستن و یەک حەمام و شوێنی پارککردن. هیچ شوێنێکی ڕاستەقینە بۆ مانەوە پێشکەش ناکرێت.",
  },
  {
    source:
      "Fictional demonstration cottage in the Dukan area of Sulaymaniyah. Garden and pool space for up to twelve guests, with four bedrooms, three bathrooms and Wi-Fi. No real accommodation is offered.",
    ar: "كوخ تجريبي خيالي في منطقة دوكان في السليمانية. حديقة ومسبح لما يصل إلى اثني عشر ضيفاً، مع أربع غرف نوم وثلاثة حمامات وواي فاي. لا يُعرض أي سكن حقيقي.",
    ckb: "کۆتێجێکی خەیاڵی بۆ پیشاندان لە ناوچەی دووکانی سلێمانی. باخچە و مەلەوانگە بۆ تا دوازدە میوان، لەگەڵ چوار ژووری نووستن و سێ حەمام و وای فای. هیچ شوێنێکی ڕاستەقینە بۆ مانەوە پێشکەش ناکرێت.",
  },
  {
    source:
      "Fictional demonstration cottage in the Amedi area of Duhok. A garden setting for up to four guests, with two bedrooms, one bathroom, parking and Wi-Fi. No real accommodation is offered.",
    ar: "كوخ تجريبي خيالي في منطقة العمادية في دهوك. حديقة لما يصل إلى أربعة ضيوف، مع غرفتي نوم وحمام واحد وموقف سيارات وواي فاي. لا يُعرض أي سكن حقيقي.",
    ckb: "کۆتێجێکی خەیاڵی بۆ پیشاندان لە ناوچەی ئامێدیی دهۆک. باخچە بۆ تا چوار میوان، لەگەڵ دوو ژووری نووستن و یەک حەمام و شوێنی پارککردن و وای فای. هیچ شوێنێکی ڕاستەقینە بۆ مانەوە پێشکەش ناکرێت.",
  },
  {
    source:
      "Fictional demonstration cottage in the Al-Tarmiyah area of Baghdad. Pool space for up to ten guests, with three bedrooms, two bathrooms, parking and air conditioning. No real accommodation is offered.",
    ar: "كوخ تجريبي خيالي في منطقة الطارمية في بغداد. مسبح لما يصل إلى عشرة ضيوف، مع ثلاث غرف نوم وحمامين وموقف سيارات وتكييف. لا يُعرض أي سكن حقيقي.",
    ckb: "کۆتێجێکی خەیاڵی بۆ پیشاندان لە ناوچەی تارمیەی بەغدا. مەلەوانگە بۆ تا دە میوان، لەگەڵ سێ ژووری نووستن و دوو حەمام و شوێنی پارککردن و ساردکەرەوە. هیچ شوێنێکی ڕاستەقینە بۆ مانەوە پێشکەش ناکرێت.",
  },
  {
    source:
      "Fictional demonstration cottage in the Hillah area of Babil. Garden, pool and outdoor seating for up to sixteen guests, with five bedrooms and three bathrooms. No real accommodation is offered.",
    ar: "كوخ تجريبي خيالي في منطقة الحلة في بابل. حديقة ومسبح وجلسات خارجية لما يصل إلى ستة عشر ضيفاً، مع خمس غرف نوم وثلاثة حمامات. لا يُعرض أي سكن حقيقي.",
    ckb: "کۆتێجێکی خەیاڵی بۆ پیشاندان لە ناوچەی حیلەی بابل. باخچە و مەلەوانگە و دانیشتنی دەرەوە بۆ تا شانزە میوان، لەگەڵ پێنج ژووری نووستن و سێ حەمام. هیچ شوێنێکی ڕاستەقینە بۆ مانەوە پێشکەش ناکرێت.",
  },
];

export const fictionalCottageTranslator: CottageTranslator = {
  async translate(input) {
    const entry = catalog.find((item) => item.source === input.description);
    if (
      !entry ||
      input.sourceLanguage !== "en" ||
      input.targetLanguage === "en" ||
      input.houseRules !== sharedHouseRules
    ) {
      throw new TranslationExecutionUnavailableError("unsupported_content");
    }
    return {
      description: entry[input.targetLanguage],
      houseRules: sampleHouseRules[input.targetLanguage],
      provenance: {
        provider: "fictional-cottage-translations",
        model: "catalog-v1",
        effort: "none",
        promptVersion: "fictional-cottage-catalog-v1",
      },
    };
  },
};
