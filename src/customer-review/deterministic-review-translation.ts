import {
  reviewTranslationProvenance,
  type ReviewTranslationAdapter,
} from "./review-translation";

// The reply has no Sorani pair on purpose: it proves the unavailable fallback.
const translations = new Map([
  ["en|ar|A calm stay beside the garden.", "إقامة هادئة بجانب الحديقة."],
  [
    "en|ckb|A calm stay beside the garden.",
    "مانەوەیەکی ئارام لە تەنیشت باخچەکە.",
  ],
  ["en|ar|Thank you for staying with us.", "شكراً لإقامتكم معنا."],
]);

export function createDeterministicReviewTranslationAdapter(): ReviewTranslationAdapter {
  return {
    async translate(input) {
      const segment = input.segments[0];
      const translated =
        input.segments.length === 1 && segment?.kind === "review"
          ? translations.get(
              `${input.sourceLanguage}|${input.targetLanguage}|${segment.text}`,
            )
          : undefined;
      if (!segment || !translated) {
        return {
          status: "unavailable",
          originals: input.segments,
          code: "unsupported_content",
        };
      }
      return {
        status: "completed",
        source: "provider",
        segments: [{ key: segment.key, text: translated }],
        provenance: {
          ...reviewTranslationProvenance,
          effort: "none",
          promptDigest: "fictional-review-pairs-v1",
        },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
  };
}
