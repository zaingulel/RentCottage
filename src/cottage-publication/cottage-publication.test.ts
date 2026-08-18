import { describe, expect, it, vi } from "vitest";

import {
  createCottagePublication,
  productionTranslationUnavailable,
  type CottageTranslationAttempt,
} from "./cottage-publication";

const attempt: CottageTranslationAttempt = {
  id: "10000000-0000-4000-8000-000000000024",
  reviewCycleId: "20000000-0000-4000-8000-000000000024",
  sourceLanguage: "en",
  targetLanguage: "ar",
  description: "A quiet cottage near Shaqlawa.",
  houseRules: "No smoking.",
};

describe("Cottage publication translation", () => {
  it("sends only submitted source text and minimum language context", async () => {
    const complete = vi.fn().mockResolvedValue(true);
    const translate = vi.fn().mockResolvedValue({
      description: "كوخ هادئ قرب شقلاوة.",
      houseRules: "ممنوع التدخين.",
      provenance: {
        provider: "approved-provider",
        model: "provider-returned-model",
        effort: "provider-returned-effort",
        promptVersion: "provider-returned-prompt",
      },
    });
    const publication = createCottagePublication({
      repository: {
        beginTranslation: vi.fn().mockResolvedValue(attempt),
        completeTranslation: complete,
        failTranslation: vi.fn(),
      },
      translator: { translate },
    });

    await expect(
      publication.generateTranslation(attempt.reviewCycleId, "ar"),
    ).resolves.toEqual({ status: "completed" });
    expect(translate).toHaveBeenCalledWith({
      sourceLanguage: "en",
      targetLanguage: "ar",
      description: "A quiet cottage near Shaqlawa.",
      houseRules: "No smoking.",
    });
    expect(complete).toHaveBeenCalledWith({
      attemptId: attempt.id,
      description: "كوخ هادئ قرب شقلاوة.",
      houseRules: "ممنوع التدخين.",
      provenance: {
        provider: "approved-provider",
        model: "provider-returned-model",
        effort: "provider-returned-effort",
        promptVersion: "provider-returned-prompt",
      },
    });
  });

  it("fails loudly and records the attempt when the production adapter is unavailable", async () => {
    const failTranslation = vi.fn().mockResolvedValue(undefined);
    const publication = createCottagePublication({
      repository: {
        beginTranslation: vi.fn().mockResolvedValue(attempt),
        completeTranslation: vi.fn(),
        failTranslation,
      },
      translator: productionTranslationUnavailable,
    });

    await expect(
      publication.generateTranslation(attempt.reviewCycleId, "ar"),
    ).resolves.toEqual({ status: "adapter_unavailable" });
    expect(failTranslation).toHaveBeenCalledWith(
      attempt.id,
      "adapter_unavailable",
    );
  });

  it("does not let a late provider result replace the current localized head", async () => {
    const publication = createCottagePublication({
      repository: {
        beginTranslation: vi.fn().mockResolvedValue(attempt),
        completeTranslation: vi.fn().mockResolvedValue(false),
        failTranslation: vi.fn(),
      },
      translator: {
        translate: vi.fn().mockResolvedValue({
          description: "قديم",
          houseRules: "قديم",
          provenance: {
            provider: "approved-provider",
            model: "model",
            effort: "high",
            promptVersion: "v1",
          },
        }),
      },
    });

    await expect(
      publication.generateTranslation(attempt.reviewCycleId, "ar"),
    ).resolves.toEqual({ status: "superseded" });
  });

  it("propagates persistence failures without misclassifying them as provider failures", async () => {
    const failTranslation = vi.fn();
    const persistenceFailure = new Error("repository unavailable");
    const publication = createCottagePublication({
      repository: {
        beginTranslation: vi.fn().mockResolvedValue(attempt),
        completeTranslation: vi.fn().mockRejectedValue(persistenceFailure),
        failTranslation,
      },
      translator: {
        translate: vi.fn().mockResolvedValue({
          description: "كوخ هادئ",
          houseRules: "ممنوع التدخين",
          provenance: {
            provider: "approved-provider",
            model: "model",
            effort: "high",
            promptVersion: "v1",
          },
        }),
      },
    });

    await expect(
      publication.generateTranslation(attempt.reviewCycleId, "ar"),
    ).rejects.toBe(persistenceFailure);
    expect(failTranslation).not.toHaveBeenCalled();
  });
});
