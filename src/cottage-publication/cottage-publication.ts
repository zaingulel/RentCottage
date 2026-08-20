import type { TranslationFailureCode } from "@/translation/failure-code";

export type LaunchLanguage = "ar" | "ckb" | "en";

export interface CottageLocalizationReview {
  locale: LaunchLanguage;
  contentLanguage?: LaunchLanguage;
  revisionId?: string;
  origin:
    | "owner_source"
    | "generated"
    | "administrator_correction"
    | "source_fallback";
  description: string;
  houseRules: string;
  approved: boolean;
  humanReviewRequired?: boolean;
  failureCode?: TranslationFailureCode;
  qualityReportReason?: string;
}

export interface CottagePublicationReviewState {
  id: string;
  state: "in_review" | "approved" | "rejected";
  productionReady: boolean;
  sourceLanguage?: LaunchLanguage;
  localizations: CottageLocalizationReview[];
}

export interface CottageTranslationAdministration {
  productionReady: boolean;
  providerTermsApproved: boolean;
  nativeReviewApproved: boolean;
  qualityThresholdApproved: boolean;
  ordinaryModel: string | null;
  ordinaryEffort: string | null;
  strongerModel: string | null;
  strongerEffort: string | null;
  judgeModel: string | null;
  judgeEffort: string | null;
  monthlyRequestLimit: number | null;
  monthlyTokenLimit: number | null;
  monthlySpendMicrousdLimit: number | null;
  monthRequests: number;
  monthReservedTokens: number;
  monthReservedMicrousd: number;
  monthActualMicrousd: number;
  qualityReportCount: number;
}

export interface CottageTranslationAttempt {
  id: string;
  leaseToken: string;
  reviewCycleId: string;
  sourceLanguage: LaunchLanguage;
  targetLanguage: LaunchLanguage;
  description: string;
  houseRules: string;
}

export type CottageTranslationRoute = "ordinary" | "stronger_model";

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
    route: CottageTranslationRoute;
  }): Promise<CottageTranslationResult>;
}

export interface CottagePublicationRepository {
  beginTranslation(
    reviewCycleId: string,
    targetLanguage: LaunchLanguage,
    route: CottageTranslationRoute,
    leaseDurationMilliseconds: number,
  ): Promise<CottageTranslationAttempt>;
  completeTranslation(
    input: CottageTranslationResult & {
      attemptId: string;
      leaseToken: string;
    },
  ): Promise<boolean>;
  failTranslation(
    attemptId: string,
    leaseToken: string,
    failure: TranslationFailureCode,
  ): Promise<boolean>;
  routeHumanReview?(
    reviewCycleId: string,
    targetLanguage: LaunchLanguage,
    reason: string,
  ): Promise<void>;
}

export class HumanReviewRequiredError extends Error {
  constructor(readonly reason: string) {
    super("The translation requires human review");
    this.name = "HumanReviewRequiredError";
  }
}

export class TranslationExecutionUnavailableError extends Error {
  constructor(readonly code: TranslationFailureCode) {
    super("The translation execution is unavailable");
    this.name = "TranslationExecutionUnavailableError";
  }
}

export const productionTranslationUnavailable: CottageTranslator = {
  async translate() {
    throw new TranslationExecutionUnavailableError("configuration_unavailable");
  },
};

const leaseCompletionAllowanceMilliseconds = 5_000;
const maximumLeaseMilliseconds = 15 * 60 * 1_000;

export function translationExecutionLeaseMilliseconds(
  maximumAttempts: number,
  timeoutMilliseconds: number,
): number {
  const retryBudget = maximumAttempts * timeoutMilliseconds;
  const leaseMilliseconds = retryBudget + leaseCompletionAllowanceMilliseconds;
  if (
    !Number.isSafeInteger(maximumAttempts) ||
    maximumAttempts < 1 ||
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1_000 ||
    !Number.isSafeInteger(leaseMilliseconds) ||
    leaseMilliseconds > maximumLeaseMilliseconds
  ) {
    throw new Error("Translation execution lease is invalid");
  }
  return leaseMilliseconds;
}

export function createCottagePublication({
  repository,
  translator,
  leaseDurationMilliseconds,
}: {
  repository: CottagePublicationRepository;
  translator: CottageTranslator;
  leaseDurationMilliseconds: number;
}) {
  return {
    async generateTranslation(
      reviewCycleId: string,
      targetLanguage: LaunchLanguage,
      route: CottageTranslationRoute = "ordinary",
    ) {
      const attempt = await repository.beginTranslation(
        reviewCycleId,
        targetLanguage,
        route,
        leaseDurationMilliseconds,
      );
      let result: CottageTranslationResult;
      try {
        result = await translator.translate({
          sourceLanguage: attempt.sourceLanguage,
          targetLanguage: attempt.targetLanguage,
          description: attempt.description,
          houseRules: attempt.houseRules,
          route,
        });
      } catch (error) {
        if (error instanceof HumanReviewRequiredError) {
          if (!repository.routeHumanReview) throw error;
          await repository.routeHumanReview(
            reviewCycleId,
            targetLanguage,
            error.reason,
          );
          return { status: "human_review_required" as const };
        }
        const failure: TranslationFailureCode =
          error instanceof TranslationExecutionUnavailableError
            ? error.code
            : "provider_failure";
        const current = await repository.failTranslation(
          attempt.id,
          attempt.leaseToken,
          failure,
        );
        return {
          status: current ? failure : ("superseded" as const),
        };
      }
      const current = await repository.completeTranslation({
        attemptId: attempt.id,
        leaseToken: attempt.leaseToken,
        ...result,
      });
      return {
        status: current ? ("completed" as const) : ("superseded" as const),
      };
    },
  };
}
