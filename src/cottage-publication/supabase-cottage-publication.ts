import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isTranslationFailureCode,
  type TranslationFailureCode,
} from "@/translation/failure-code";

import type {
  CottageTranslationAttempt,
  CottageTranslationAdministration,
  CottagePublicationReviewState,
  CottageTranslationResult,
  CottageTranslationRoute,
  LaunchLanguage,
} from "./cottage-publication";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid-provider-data");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("invalid-provider-data");
  }
  return value;
}

function language(value: unknown): LaunchLanguage {
  if (value !== "ar" && value !== "ckb" && value !== "en") {
    throw new Error("invalid-provider-data");
  }
  return value;
}

function requiredArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("invalid-provider-data");
  return value;
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("invalid-provider-data");
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function nullablePositiveInteger(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error("invalid-provider-data");
  }
  return value as number;
}

function nonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("invalid-provider-data");
  }
  return value as number;
}

function assertSuccess(error: unknown): void {
  if (error)
    throw new Error("Cottage publication provider is unavailable", {
      cause: error,
    });
}

export class SupabaseCottagePublicationRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly privilegedClient: SupabaseClient,
  ) {}

  async beginTranslation(
    reviewCycleId: string,
    targetLanguage: LaunchLanguage,
    route: CottageTranslationRoute,
    leaseDurationMilliseconds: number,
  ): Promise<CottageTranslationAttempt> {
    const attemptResult = await this.privilegedClient.rpc(
      "begin_cottage_profile_translation_execution",
      {
        target_review_cycle_id: reviewCycleId,
        target_language: targetLanguage,
        target_route: route,
        target_lease_milliseconds: leaseDurationMilliseconds,
      },
    );
    assertSuccess(attemptResult.error);
    const attempt = record(attemptResult.data);
    const sourceResult = await this.privilegedClient
      .from("cottage_profile_source_revisions")
      .select("source_language,description,house_rules")
      .eq("id", requiredString(attempt.source_revision_id))
      .single();
    assertSuccess(sourceResult.error);
    const source = record(sourceResult.data);
    return {
      id: requiredString(attempt.id),
      leaseToken: requiredString(attempt.lease_token),
      reviewCycleId: requiredString(attempt.review_cycle_id),
      sourceLanguage: language(source.source_language),
      targetLanguage: language(attempt.target_language),
      description: requiredString(source.description),
      houseRules: requiredString(source.house_rules),
    };
  }

  async completeTranslation(
    input: CottageTranslationResult & { attemptId: string; leaseToken: string },
  ): Promise<boolean> {
    const result = await this.privilegedClient.rpc(
      "complete_cottage_profile_translation_execution",
      {
        target_attempt_id: input.attemptId,
        target_lease_token: input.leaseToken,
        translated_description: input.description,
        translated_house_rules: input.houseRules,
        returned_provider: input.provenance.provider,
        returned_model: input.provenance.model,
        returned_effort: input.provenance.effort,
        returned_prompt_version: input.provenance.promptVersion,
      },
    );
    assertSuccess(result.error);
    if (typeof result.data !== "boolean") {
      throw new Error("invalid-provider-data");
    }
    return result.data;
  }

  async failTranslation(
    attemptId: string,
    leaseToken: string,
    failure: TranslationFailureCode,
  ): Promise<boolean> {
    const result = await this.privilegedClient.rpc(
      "fail_cottage_profile_translation_execution",
      {
        target_attempt_id: attemptId,
        target_lease_token: leaseToken,
        target_failure_code: failure,
      },
    );
    assertSuccess(result.error);
    if (typeof result.data !== "boolean") {
      throw new Error("invalid-provider-data");
    }
    return result.data;
  }

  async assertTranslationAdministrator(): Promise<void> {
    const result = await this.client.rpc("is_platform_administrator", {
      required_assurance: "aal2",
    });
    assertSuccess(result.error);
    if (result.data !== true) {
      throw new Error("AAL2 Platform Administrator access is required");
    }
  }

  async routeHumanReview(
    reviewCycleId: string,
    locale: LaunchLanguage,
    reason: string,
  ): Promise<void> {
    const result = await this.client.rpc(
      "route_current_cottage_translation_to_human_review",
      {
        target_review_cycle_id: reviewCycleId,
        target_locale: locale,
        target_reason: reason,
      },
    );
    assertSuccess(result.error);
  }

  async reportTranslation(
    reviewCycleId: string,
    localizedRevisionId: string,
    reason: string,
  ): Promise<void> {
    const result = await this.client.rpc("report_current_cottage_translation", {
      target_review_cycle_id: reviewCycleId,
      target_localized_revision_id: localizedRevisionId,
      target_reason: reason,
    });
    assertSuccess(result.error);
  }

  async loadTranslationAdministration(): Promise<CottageTranslationAdministration> {
    const result = await this.client.rpc(
      "get_cottage_translation_administration",
    );
    assertSuccess(result.error);
    const data = record(result.data);
    return {
      productionReady: requiredBoolean(data.productionReady),
      providerTermsApproved: requiredBoolean(data.providerTermsApproved),
      nativeReviewApproved: requiredBoolean(data.nativeReviewApproved),
      qualityThresholdApproved: requiredBoolean(data.qualityThresholdApproved),
      ordinaryModel: nullableString(data.ordinaryModel),
      ordinaryEffort: nullableString(data.ordinaryEffort),
      strongerModel: nullableString(data.strongerModel),
      strongerEffort: nullableString(data.strongerEffort),
      judgeModel: nullableString(data.judgeModel),
      judgeEffort: nullableString(data.judgeEffort),
      monthlyRequestLimit: nullablePositiveInteger(data.monthlyRequestLimit),
      monthlyTokenLimit: nullablePositiveInteger(data.monthlyTokenLimit),
      monthlySpendMicrousdLimit: nullablePositiveInteger(
        data.monthlySpendMicrousdLimit,
      ),
      monthRequests: nonnegativeInteger(data.monthRequests),
      monthReservedTokens: nonnegativeInteger(data.monthReservedTokens),
      monthReservedMicrousd: nonnegativeInteger(data.monthReservedMicrousd),
      monthActualMicrousd: nonnegativeInteger(data.monthActualMicrousd),
      qualityReportCount: nonnegativeInteger(data.qualityReportCount),
    };
  }

  async loadCurrentReview(
    profileId: string,
  ): Promise<CottagePublicationReviewState | null> {
    const cycleResult = await this.client
      .from("cottage_profile_review_cycles")
      .select("id,state,source_revision_id")
      .eq("profile_id", profileId)
      .order("cycle_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    assertSuccess(cycleResult.error);
    if (!cycleResult.data) return null;
    const cycle = record(cycleResult.data);
    const cycleId = requiredString(cycle.id);
    const sourceRevisionId = requiredString(cycle.source_revision_id);
    const sourceResult = await this.client
      .from("cottage_profile_source_revisions")
      .select("id,source_language,description,house_rules")
      .eq("id", sourceRevisionId)
      .single();
    assertSuccess(sourceResult.error);
    const sourceRevision = record(sourceResult.data);
    if (requiredString(sourceRevision.id) !== sourceRevisionId) {
      throw new Error("invalid-provider-data");
    }
    const sourceLanguage = language(sourceRevision.source_language);
    const headsResult = await this.client
      .from("cottage_profile_localized_heads")
      .select("localized_revision_id")
      .eq("review_cycle_id", cycleId);
    assertSuccess(headsResult.error);
    const heads = requiredArray(headsResult.data).map(record);
    const revisionIds = heads.map((head) =>
      requiredString(head.localized_revision_id),
    );
    const revisionsResult = revisionIds.length
      ? await this.client
          .from("cottage_profile_localized_revisions")
          .select("id,locale,origin,description,house_rules")
          .in("id", revisionIds)
      : { data: [], error: null };
    assertSuccess(revisionsResult.error);
    const revisionRows = requiredArray(revisionsResult.data);
    const decisionsResult = revisionIds.length
      ? await this.client
          .from("cottage_profile_localized_decisions")
          .select("localized_revision_id,approved,decided_at")
          .eq("review_cycle_id", cycleId)
          .in("localized_revision_id", revisionIds)
          .order("decided_at", { ascending: false })
      : { data: [], error: null };
    assertSuccess(decisionsResult.error);
    const attemptsResult = await this.privilegedClient
      .from("cottage_profile_translation_attempts")
      .select("target_language,state,failure_code,attempt_number")
      .eq("review_cycle_id", cycleId)
      .order("attempt_number", { ascending: false });
    assertSuccess(attemptsResult.error);
    const humanReviewResult = await this.client
      .from("cottage_profile_translation_human_reviews")
      .select("locale,state")
      .eq("review_cycle_id", cycleId)
      .eq("state", "active");
    assertSuccess(humanReviewResult.error);
    const qualityReportsResult = await this.client
      .from("cottage_translation_quality_reports")
      .select("locale,reason")
      .eq("remediation_review_cycle_id", cycleId);
    assertSuccess(qualityReportsResult.error);
    const approvedByRevision = new Map<string, boolean>();
    for (const value of requiredArray(decisionsResult.data)) {
      const decision = record(value);
      const revisionId = requiredString(decision.localized_revision_id);
      if (!approvedByRevision.has(revisionId))
        approvedByRevision.set(revisionId, requiredBoolean(decision.approved));
    }
    const revisions = new Map(
      revisionRows.map((value) => {
        const revision = record(value);
        return [requiredString(revision.id), revision] as const;
      }),
    );
    const revisionsByLocale = new Map<
      LaunchLanguage,
      Record<string, unknown>
    >();
    for (const revision of revisions.values()) {
      revisionsByLocale.set(language(revision.locale), revision);
    }
    const latestAttemptByLocale = new Map<
      LaunchLanguage,
      Record<string, unknown>
    >();
    for (const value of requiredArray(attemptsResult.data)) {
      const attempt = record(value);
      const locale = language(attempt.target_language);
      if (!latestAttemptByLocale.has(locale)) {
        latestAttemptByLocale.set(locale, attempt);
      }
    }
    const humanReviewLocales = new Set(
      requiredArray(humanReviewResult.data).map((value) => {
        const review = record(value);
        if (review.state !== "active") throw new Error("invalid-provider-data");
        return language(review.locale);
      }),
    );
    const qualityReportReasonByLocale = new Map<LaunchLanguage, string>();
    for (const value of requiredArray(qualityReportsResult.data)) {
      const report = record(value);
      const locale = language(report.locale);
      if (!qualityReportReasonByLocale.has(locale)) {
        qualityReportReasonByLocale.set(locale, requiredString(report.reason));
      }
    }
    const controlResult = await this.privilegedClient
      .from("cottage_translation_runtime_control")
      .select("production_ready")
      .eq("singleton", true)
      .single();
    assertSuccess(controlResult.error);
    const state = cycle.state;
    if (state !== "in_review" && state !== "approved" && state !== "rejected") {
      throw new Error("invalid-provider-data");
    }
    return {
      id: cycleId,
      state,
      sourceLanguage,
      productionReady: requiredBoolean(
        record(controlResult.data).production_ready,
      ),
      localizations: (["en", "ar", "ckb"] as const).map((locale) => {
        const revision = revisionsByLocale.get(locale);
        const humanReviewRequired = humanReviewLocales.has(locale);
        if (!revision || humanReviewRequired) {
          const latestAttempt = latestAttemptByLocale.get(locale);
          const failureCode = latestAttempt?.failure_code;
          if (
            failureCode !== null &&
            failureCode !== undefined &&
            !isTranslationFailureCode(failureCode)
          ) {
            throw new Error("invalid-provider-data");
          }
          return {
            locale,
            contentLanguage: sourceLanguage,
            revisionId: revision ? requiredString(revision.id) : undefined,
            origin: "source_fallback" as const,
            description: requiredString(sourceRevision.description),
            houseRules: requiredString(sourceRevision.house_rules),
            approved: false,
            humanReviewRequired,
            failureCode: failureCode ?? undefined,
            qualityReportReason: qualityReportReasonByLocale.get(locale),
          };
        }
        const revisionId = requiredString(revision.id);
        const origin = revision.origin;
        if (
          origin !== "owner_source" &&
          origin !== "generated" &&
          origin !== "administrator_correction"
        ) {
          throw new Error("invalid-provider-data");
        }
        return {
          locale,
          contentLanguage: locale,
          revisionId,
          origin,
          description: requiredString(revision.description),
          houseRules: requiredString(revision.house_rules),
          approved: approvedByRevision.get(revisionId) === true,
          qualityReportReason: qualityReportReasonByLocale.get(locale),
        };
      }),
    };
  }

  async correct(
    reviewCycleId: string,
    locale: LaunchLanguage,
    description: string,
    houseRules: string,
    reason: string,
  ) {
    const result = await this.client.rpc(
      "correct_cottage_profile_localization",
      {
        target_review_cycle_id: reviewCycleId,
        target_locale: locale,
        corrected_description: description,
        corrected_house_rules: houseRules,
        target_reason: reason,
      },
    );
    assertSuccess(result.error);
  }

  async decideLocale(
    reviewCycleId: string,
    locale: LaunchLanguage,
    approved: boolean,
    reason: string,
  ) {
    const result = await this.client.rpc(
      "decide_cottage_profile_localization",
      {
        target_review_cycle_id: reviewCycleId,
        target_locale: locale,
        target_approved: approved,
        target_reason: reason,
      },
    );
    assertSuccess(result.error);
  }

  async decidePublication(
    reviewCycleId: string,
    approved: boolean,
    reason: string,
  ) {
    const result = await this.client.rpc(
      approved
        ? "approve_cottage_profile_publication"
        : "reject_cottage_profile_publication",
      { target_review_cycle_id: reviewCycleId, target_reason: reason },
    );
    assertSuccess(result.error);
  }

  async resolveMedia(opaqueId: string): Promise<string> {
    const result = await this.privilegedClient.rpc(
      "resolve_current_cottage_publication_media",
      {
        target_opaque_id: opaqueId,
      },
    );
    assertSuccess(result.error);
    return requiredString(result.data);
  }
}
