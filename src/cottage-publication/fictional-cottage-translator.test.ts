import { expect, it } from "vitest";

import { fictionalCottageTranslator } from "./fictional-cottage-translator";

const houseRules =
  "Fictional demonstration only. Respect neighbours, do not smoke indoors, and keep the party within the cottage's stated guest capacity.";
const sources = [
  "Fictional demonstration cottage in the Shaqlawa area of Erbil. A garden and pool setting for up to eight guests, with three bedrooms, two bathrooms and parking. No real accommodation is offered.",
  "Fictional demonstration cottage in the Koya area of Erbil. Garden and outdoor seating for up to six guests, with two bedrooms, one bathroom and parking. No real accommodation is offered.",
  "Fictional demonstration cottage in the Dukan area of Sulaymaniyah. Garden and pool space for up to twelve guests, with four bedrooms, three bathrooms and Wi-Fi. No real accommodation is offered.",
  "Fictional demonstration cottage in the Amedi area of Duhok. A garden setting for up to four guests, with two bedrooms, one bathroom, parking and Wi-Fi. No real accommodation is offered.",
  "Fictional demonstration cottage in the Al-Tarmiyah area of Baghdad. Pool space for up to ten guests, with three bedrooms, two bathrooms, parking and air conditioning. No real accommodation is offered.",
  "Fictional demonstration cottage in the Hillah area of Babil. Garden, pool and outdoor seating for up to sixteen guests, with five bedrooms and three bathrooms. No real accommodation is offered.",
];

it("returns explicit fictional samples for the six documented English source pairs in both target languages", async () => {
  const facts = [
    {
      ar: ["شقلاوة", "ثمانية ضيوف", "ثلاث غرف نوم"],
      ckb: ["شەقڵاوە", "هەشت میوان", "سێ ژووری نووستن"],
    },
    {
      ar: ["كوية", "ستة ضيوف", "غرفتي نوم"],
      ckb: ["کۆیە", "شەش میوان", "دوو ژووری نووستن"],
    },
    {
      ar: ["دوكان", "اثني عشر ضيفاً", "أربع غرف نوم"],
      ckb: ["دووکان", "دوازدە میوان", "چوار ژووری نووستن"],
    },
    {
      ar: ["العمادية", "أربعة ضيوف", "غرفتي نوم"],
      ckb: ["ئامێدی", "چوار میوان", "دوو ژووری نووستن"],
    },
    {
      ar: ["الطارمية", "عشرة ضيوف", "ثلاث غرف نوم"],
      ckb: ["تارمیە", "دە میوان", "سێ ژووری نووستن"],
    },
    {
      ar: ["الحلة", "ستة عشر ضيفاً", "خمس غرف نوم"],
      ckb: ["حیلە", "شانزە میوان", "پێنج ژووری نووستن"],
    },
  ];
  for (const [index, description] of sources.entries()) {
    for (const targetLanguage of ["ar", "ckb"] as const) {
      const sample = await fictionalCottageTranslator.translate({
        sourceLanguage: "en",
        targetLanguage,
        description,
        houseRules,
        route: "ordinary",
      });
      expect(sample.provenance).toEqual({
        provider: "fictional-cottage-translations",
        model: "catalog-v1",
        effort: "none",
        promptVersion: "fictional-cottage-catalog-v1",
      });
      expect(sample.description).toContain(
        targetLanguage === "ar" ? "كوخ تجريبي خيالي" : "کۆتێجێکی خەیاڵی",
      );
      for (const fact of facts[index][targetLanguage])
        expect(sample.description).toContain(fact);
      expect(sample.houseRules).toBe(
        targetLanguage === "ar"
          ? "للعرض الخيالي فقط. احترم الجيران، ولا تدخن داخل المنزل، والتزم بعدد الضيوف المحدد للكوخ."
          : "تەنها بۆ پیشاندانی خەیاڵی. ڕێزی دراوسێکان بگرە، لە ناو ماڵ جگەرە مەکێشە و ژمارەی میوانان لە سنووری دیاریکراوی کۆتێجەکە زیاتر مەکە.",
      );
      expect(
        await fictionalCottageTranslator.translate({
          sourceLanguage: "en",
          targetLanguage,
          description,
          houseRules,
          route: "stronger_model",
        }),
      ).toEqual(sample);
    }
  }
  expect(
    await fictionalCottageTranslator.translate({
      sourceLanguage: "en",
      targetLanguage: "ar",
      description: sources[0],
      houseRules,
      route: "ordinary",
    }),
  ).toMatchObject({
    description:
      "كوخ تجريبي خيالي في منطقة شقلاوة في أربيل. حديقة ومسبح لما يصل إلى ثمانية ضيوف، مع ثلاث غرف نوم وحمامين وموقف سيارات. لا يُعرض أي سكن حقيقي.",
  });
});

it("rejects changed source text, rules, unsupported source languages and targets without a substitute sample", async () => {
  const input = {
    sourceLanguage: "en" as const,
    targetLanguage: "ar" as const,
    description: sources[0],
    houseRules,
    route: "ordinary" as const,
  };
  for (const change of [
    { description: sources[0] + " " },
    { houseRules: houseRules + " " },
    { description: "Unlisted fictional cottage" },
    { sourceLanguage: "ar" as const },
    { sourceLanguage: "ckb" as const },
    { targetLanguage: "en" as const },
  ]) {
    await expect(
      fictionalCottageTranslator.translate({ ...input, ...change }),
    ).rejects.toMatchObject({ code: "unsupported_content" });
  }
});
