import { describe, expect, it, vi } from "vitest";

import {
  HumanReviewRequiredError,
  TranslationExecutionUnavailableError,
} from "@/cottage-publication/cottage-publication";
import { createCottagePublicationTranslator } from "./cottage-publication-translator";

describe("Cottage publication translation bridge", () => {
  it("projects exactly the two public Cottage Profile fields into the adapter", async () => {
    const translate = vi.fn().mockResolvedValue({
      status: "completed",
      source: "provider",
      segments: [
        { key: "description", text: "كوخ هادئ" },
        { key: "houseRules", text: "ممنوع التدخين" },
      ],
      provenance: {
        provider: "openai",
        model: "gpt-5.6-luna",
        effort: "none",
        promptVersion: "v1",
        promptDigest: "a".repeat(64),
      },
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    });
    const translator = createCottagePublicationTranslator({ translate });

    await expect(
      translator.translate({
        sourceLanguage: "en",
        targetLanguage: "ar",
        route: "ordinary",
        description: "Quiet cottage",
        houseRules: "No smoking",
      }),
    ).resolves.toEqual({
      description: "كوخ هادئ",
      houseRules: "ممنوع التدخين",
      provenance: {
        provider: "openai",
        model: "gpt-5.6-luna",
        effort: "none",
        promptVersion: "v1",
      },
    });
    expect(translate).toHaveBeenCalledWith({
      sourceLanguage: "en",
      targetLanguage: "ar",
      route: "ordinary",
      segments: [
        {
          key: "description",
          kind: "cottage_description",
          text: "Quiet cottage",
        },
        { key: "houseRules", kind: "house_rules", text: "No smoking" },
      ],
    });
  });

  it("preserves the human-review route as a typed control result", async () => {
    const translator = createCottagePublicationTranslator({
      translate: vi.fn().mockResolvedValue({
        status: "human_review_required",
        originals: [],
        reason: "safety_review",
      }),
    });

    await expect(
      translator.translate({
        sourceLanguage: "en",
        targetLanguage: "ar",
        route: "stronger_model",
        description: "Quiet cottage",
        houseRules: "No smoking",
      }),
    ).rejects.toEqual(new HumanReviewRequiredError("safety_review"));
  });

  it("preserves the loud failure code so the original remains visible", async () => {
    const translator = createCottagePublicationTranslator({
      translate: vi.fn().mockResolvedValue({
        status: "unavailable",
        originals: [],
        code: "usage_limit_reached",
      }),
    });

    await expect(
      translator.translate({
        sourceLanguage: "en",
        targetLanguage: "ar",
        route: "ordinary",
        description: "Quiet cottage",
        houseRules: "No smoking",
      }),
    ).rejects.toEqual(
      new TranslationExecutionUnavailableError("usage_limit_reached"),
    );
  });
});
