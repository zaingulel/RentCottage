export type LaunchLanguage = "ar" | "ckb" | "en";

export interface CottageLocalizationReview {
  locale: LaunchLanguage;
  origin: "owner_source" | "generated" | "administrator_correction";
  description: string;
  houseRules: string;
  approved: boolean;
}

export interface CottagePublicationReviewState {
  id: string;
  state: "in_review" | "approved" | "rejected";
  productionReady: boolean;
  localizations: CottageLocalizationReview[];
}

export interface CottageTranslationAttempt {
  id: string;
  reviewCycleId: string;
  sourceLanguage: LaunchLanguage;
  targetLanguage: LaunchLanguage;
  description: string;
  houseRules: string;
}

export interface TranslationProvenance {
  provider: string;
  model: string;
  effort: string;
  promptVersion: string;
}

export interface CottageTranslationResult {
  description: string;
  houseRules: string;
  provenance: TranslationProvenance;
}

export interface CottageTranslator {
  translate(input: {
    sourceLanguage: LaunchLanguage;
    targetLanguage: LaunchLanguage;
    description: string;
    houseRules: string;
  }): Promise<CottageTranslationResult>;
}

export interface CottagePublicationRepository {
  beginTranslation(
    reviewCycleId: string,
    targetLanguage: LaunchLanguage,
  ): Promise<CottageTranslationAttempt>;
  completeTranslation(
    input: CottageTranslationResult & {
      attemptId: string;
    },
  ): Promise<boolean>;
  failTranslation(attemptId: string, failure: string): Promise<void>;
}

export class TranslationAdapterUnavailableError extends Error {
  constructor() {
    super("The production translation adapter is unavailable until issue #46");
    this.name = "TranslationAdapterUnavailableError";
  }
}

export const productionTranslationUnavailable: CottageTranslator = {
  async translate() {
    throw new TranslationAdapterUnavailableError();
  },
};

export function createCottagePublication({
  repository,
  translator,
}: {
  repository: CottagePublicationRepository;
  translator: CottageTranslator;
}) {
  return {
    async generateTranslation(
      reviewCycleId: string,
      targetLanguage: LaunchLanguage,
    ) {
      const attempt = await repository.beginTranslation(
        reviewCycleId,
        targetLanguage,
      );
      let result: CottageTranslationResult;
      try {
        result = await translator.translate({
          sourceLanguage: attempt.sourceLanguage,
          targetLanguage: attempt.targetLanguage,
          description: attempt.description,
          houseRules: attempt.houseRules,
        });
      } catch (error) {
        const failure =
          error instanceof TranslationAdapterUnavailableError
            ? "adapter_unavailable"
            : "provider_failure";
        await repository.failTranslation(attempt.id, failure);
        return {
          status: failure as "adapter_unavailable" | "provider_failure",
        };
      }
      const current = await repository.completeTranslation({
        attemptId: attempt.id,
        ...result,
      });
      return {
        status: current ? ("completed" as const) : ("superseded" as const),
      };
    },
  };
}
