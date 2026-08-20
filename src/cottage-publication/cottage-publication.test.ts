import { describe, expect, it, vi } from "vitest";

import {
  createCottagePublication,
  HumanReviewRequiredError,
  productionTranslationUnavailable,
  translationExecutionLeaseMilliseconds,
  type CottageTranslationAttempt,
} from "./cottage-publication";

const attempt: CottageTranslationAttempt = {
  id: "10000000-0000-4000-8000-000000000024",
  leaseToken: "50000000-0000-4000-8000-000000000024",
  reviewCycleId: "20000000-0000-4000-8000-000000000024",
  sourceLanguage: "en",
  targetLanguage: "ar",
  description: "A quiet cottage near Shaqlawa.",
  houseRules: "No smoking.",
};

const leaseDurationMilliseconds = 50_000;

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
    const publicationRepository = {
      beginTranslation: vi.fn().mockResolvedValue(attempt),
      completeTranslation: complete,
      failTranslation: vi.fn(),
      routeHumanReview: vi.fn(),
    };
    const publication = createCottagePublication({
      repository: publicationRepository,
      translator: { translate },
      leaseDurationMilliseconds,
    });

    await expect(
      publication.generateTranslation(attempt.reviewCycleId, "ar", "ordinary"),
    ).resolves.toEqual({ status: "completed" });
    expect(publicationRepository.beginTranslation).toHaveBeenCalledWith(
      attempt.reviewCycleId,
      "ar",
      "ordinary",
      leaseDurationMilliseconds,
    );
    expect(translate).toHaveBeenCalledWith({
      sourceLanguage: "en",
      targetLanguage: "ar",
      description: "A quiet cottage near Shaqlawa.",
      houseRules: "No smoking.",
      route: "ordinary",
    });
    expect(complete).toHaveBeenCalledWith({
      attemptId: attempt.id,
      leaseToken: attempt.leaseToken,
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

  it("routes a stronger-model safety result to human review without persisting generated text", async () => {
    const routeHumanReview = vi.fn().mockResolvedValue(undefined);
    const publication = createCottagePublication({
      repository: {
        beginTranslation: vi.fn().mockResolvedValue(attempt),
        completeTranslation: vi.fn(),
        failTranslation: vi.fn(),
        routeHumanReview,
      },
      translator: {
        translate: vi
          .fn()
          .mockRejectedValue(new HumanReviewRequiredError("safety_review")),
      },
      leaseDurationMilliseconds,
    });

    await expect(
      publication.generateTranslation(
        attempt.reviewCycleId,
        "ar",
        "stronger_model",
      ),
    ).resolves.toEqual({ status: "human_review_required" });
    expect(routeHumanReview).toHaveBeenCalledWith(
      attempt.reviewCycleId,
      "ar",
      "safety_review",
    );
  });

  it("preserves a disabled runtime as configuration unavailable", async () => {
    const failTranslation = vi.fn().mockResolvedValue(true);
    const publication = createCottagePublication({
      repository: {
        beginTranslation: vi.fn().mockResolvedValue(attempt),
        completeTranslation: vi.fn(),
        failTranslation,
      },
      translator: productionTranslationUnavailable,
      leaseDurationMilliseconds,
    });

    await expect(
      publication.generateTranslation(attempt.reviewCycleId, "ar"),
    ).resolves.toEqual({ status: "configuration_unavailable" });
    expect(failTranslation).toHaveBeenCalledWith(
      attempt.id,
      attempt.leaseToken,
      "configuration_unavailable",
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
      leaseDurationMilliseconds,
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
      leaseDurationMilliseconds,
    });

    await expect(
      publication.generateTranslation(attempt.reviewCycleId, "ar"),
    ).rejects.toBe(persistenceFailure);
    expect(failTranslation).not.toHaveBeenCalled();
  });

  it("treats an expired failure lease as superseded rather than claiming persistence", async () => {
    const publication = createCottagePublication({
      repository: {
        beginTranslation: vi.fn().mockResolvedValue(attempt),
        completeTranslation: vi.fn(),
        failTranslation: vi.fn().mockResolvedValue(false),
      },
      translator: productionTranslationUnavailable,
      leaseDurationMilliseconds,
    });

    await expect(
      publication.generateTranslation(attempt.reviewCycleId, "ar"),
    ).resolves.toEqual({ status: "superseded" });
  });

  it("leases the whole bounded retry budget and changes when maximum retries change", () => {
    expect(translationExecutionLeaseMilliseconds(3, 15_000)).toBe(50_000);
    expect(translationExecutionLeaseMilliseconds(4, 15_000)).toBe(65_000);
    expect(() => translationExecutionLeaseMilliseconds(5, 180_000)).toThrow(
      "Translation execution lease is invalid",
    );
  });
});
