import type { MessageTranslationAdapter } from "./message-translation";

const translations = new Map([
  ["en|ar|Could we use the garden?", "هل يمكننا استخدام الحديقة؟"],
  ["en|ckb|Could we use the garden?", "دەتوانین باخچەکە بەکاربهێنین؟"],
  ["ar|en|هل يمكننا استخدام الحديقة؟", "Could we use the garden?"],
  ["ar|ckb|هل يمكننا استخدام الحديقة؟", "دەتوانین باخچەکە بەکاربهێنین؟"],
  ["ckb|en|دەتوانین باخچەکە بەکاربهێنین؟", "Could we use the garden?"],
  ["ckb|ar|دەتوانین باخچەکە بەکاربهێنین؟", "هل يمكننا استخدام الحديقة؟"],
]);

export function createDeterministicMessageTranslationAdapter(): MessageTranslationAdapter {
  return {
    async translate(input) {
      if (
        input.segments.length !== 1 ||
        input.segments[0]?.kind !== "message"
      ) {
        return {
          status: "unavailable",
          originals: input.segments,
          code: "unsupported_content",
        };
      }
      const segment = input.segments[0];
      const translated = translations.get(
        `${input.sourceLanguage}|${input.targetLanguage}|${segment.text}`,
      );
      if (!translated) {
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
          provider: "fictional-local-test",
          model: "deterministic-pairs-v1",
          effort: "none",
          promptVersion: "message-pairs-v1",
          promptDigest: "fictional-message-pairs-v1",
        },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
  };
}
