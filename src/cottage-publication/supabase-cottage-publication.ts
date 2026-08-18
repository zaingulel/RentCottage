import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CottageTranslationAttempt,
  CottagePublicationReviewState,
  CottageTranslationResult,
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
  ): Promise<CottageTranslationAttempt> {
    const attemptResult = await this.privilegedClient.rpc(
      "begin_cottage_profile_translation",
      {
        target_review_cycle_id: reviewCycleId,
        target_language: targetLanguage,
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
      reviewCycleId: requiredString(attempt.review_cycle_id),
      sourceLanguage: language(source.source_language),
      targetLanguage: language(attempt.target_language),
      description: requiredString(source.description),
      houseRules: requiredString(source.house_rules),
    };
  }

  async completeTranslation(
    input: CottageTranslationResult & { attemptId: string },
  ): Promise<boolean> {
    const result = await this.privilegedClient.rpc(
      "complete_cottage_profile_translation",
      {
        target_attempt_id: input.attemptId,
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

  async failTranslation(attemptId: string, failure: string): Promise<void> {
    const result = await this.privilegedClient.rpc(
      "fail_cottage_profile_translation",
      { target_attempt_id: attemptId, target_failure_code: failure },
    );
    assertSuccess(result.error);
  }

  async loadCurrentReview(
    profileId: string,
  ): Promise<CottagePublicationReviewState | null> {
    const cycleResult = await this.client
      .from("cottage_profile_review_cycles")
      .select("id,state")
      .eq("profile_id", profileId)
      .order("cycle_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    assertSuccess(cycleResult.error);
    if (!cycleResult.data) return null;
    const cycle = record(cycleResult.data);
    const cycleId = requiredString(cycle.id);
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
      productionReady: requiredBoolean(
        record(controlResult.data).production_ready,
      ),
      localizations: heads.map((head) => {
        const revisionId = requiredString(head.localized_revision_id);
        const revision = revisions.get(revisionId);
        if (!revision) throw new Error("invalid-provider-data");
        const origin = revision.origin;
        if (
          origin !== "owner_source" &&
          origin !== "generated" &&
          origin !== "administrator_correction"
        ) {
          throw new Error("invalid-provider-data");
        }
        return {
          locale: language(revision.locale),
          origin,
          description: requiredString(revision.description),
          houseRules: requiredString(revision.house_rules),
          approved: approvedByRevision.get(revisionId) === true,
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
