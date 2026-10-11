import type { SupabaseClient } from "@supabase/supabase-js";

import {
  hasExactKeys,
  isCustomerReviewBodyWithinLimit,
  isCustomerReviewLanguage,
  isCustomerReviewTranslationBody,
  isCustomerReviewUuid,
  isRecord,
} from "./customer-review";
import {
  reviewTranslationProvenance,
  type PreparedReviewTranslation,
  type ReviewTranslationReportResult,
  type ReviewTranslationRepository,
  type SavedReviewTranslation,
} from "./review-translation";
import { callRpc } from "./supabase-customer-review";

type Parsed<Result> = Result | Readonly<{ status: "unavailable" }>;

const unavailable = { status: "unavailable" } as const;

function plainStatus<Status extends string>(
  value: Record<string, unknown>,
  statuses: readonly Status[],
): Readonly<{ status: Status }> | undefined {
  const status = statuses.find((candidate) => candidate === value.status);
  return status !== undefined && hasExactKeys(value, ["status"])
    ? { status }
    : undefined;
}

function parseTranslated(
  value: Record<string, unknown>,
): SavedReviewTranslation | undefined {
  if (
    value.status === "translated" &&
    hasExactKeys(value, ["status", "translationId", "translatedBody"]) &&
    isCustomerReviewUuid(value.translationId) &&
    isCustomerReviewTranslationBody(value.translatedBody)
  ) {
    return {
      status: "translated",
      translationId: value.translationId,
      translatedBody: value.translatedBody,
    };
  }
  return undefined;
}

function parsePrepared(
  value: Record<string, unknown>,
): PreparedReviewTranslation | undefined {
  if (
    value.status === "prepared" &&
    hasExactKeys(value, ["status", "originalLanguage", "originalBody"]) &&
    isCustomerReviewLanguage(value.originalLanguage) &&
    typeof value.originalBody === "string" &&
    value.originalBody.length >= 1 &&
    isCustomerReviewBodyWithinLimit(value.originalBody)
  ) {
    return {
      status: "prepared",
      originalLanguage: value.originalLanguage,
      originalBody: value.originalBody,
    };
  }
  return undefined;
}

function parsePrepare(
  value: unknown,
): Parsed<
  | PreparedReviewTranslation
  | SavedReviewTranslation
  | Readonly<{ status: "invalid" | "access-required" | "not-found" }>
> {
  if (!isRecord(value)) {
    return unavailable;
  }
  return (
    parseTranslated(value) ??
    parsePrepared(value) ??
    plainStatus(value, ["invalid", "access-required", "not-found"]) ??
    unavailable
  );
}

function parseSave(value: unknown): Parsed<
  | SavedReviewTranslation
  | Readonly<{
      status: "invalid" | "access-required" | "not-found" | "blocked";
    }>
> {
  if (!isRecord(value)) {
    return unavailable;
  }
  return (
    parseTranslated(value) ??
    plainStatus(value, [
      "invalid",
      "access-required",
      "not-found",
      "blocked",
    ]) ??
    unavailable
  );
}

function parseReport(value: unknown): ReviewTranslationReportResult {
  if (!isRecord(value)) {
    return unavailable;
  }
  if (
    value.status === "reported" &&
    hasExactKeys(value, ["status", "reportId"]) &&
    isCustomerReviewUuid(value.reportId)
  ) {
    return { status: "reported", reportId: value.reportId };
  }
  return (
    plainStatus(value, ["invalid", "access-required", "not-found"]) ??
    unavailable
  );
}

// Runs under the service role, so the actor is an explicit argument and any
// error, a denial included, is a failure the caller shows as unavailable.
export class SupabaseReviewTranslationRepository implements ReviewTranslationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async prepare(
    input: Parameters<ReviewTranslationRepository["prepare"]>[0],
  ): ReturnType<ReviewTranslationRepository["prepare"]> {
    const response = await callRpc(
      this.client,
      "prepare_customer_review_translation",
      {
        target_actor_user_id: input.actorUserId,
        target_review_id: input.reviewId,
        target_subject: input.subject,
        target_language: input.targetLanguage,
        target_provider: reviewTranslationProvenance.provider,
        target_model: reviewTranslationProvenance.model,
        target_prompt_version: reviewTranslationProvenance.promptVersion,
      },
    );
    return !response || response.error !== null
      ? unavailable
      : parsePrepare(response.data);
  }

  async save(
    input: Parameters<ReviewTranslationRepository["save"]>[0],
  ): ReturnType<ReviewTranslationRepository["save"]> {
    const response = await callRpc(
      this.client,
      "save_customer_review_translation",
      {
        target_actor_user_id: input.actorUserId,
        target_review_id: input.reviewId,
        target_subject: input.subject,
        target_language: input.targetLanguage,
        target_provider: reviewTranslationProvenance.provider,
        target_model: reviewTranslationProvenance.model,
        target_prompt_version: reviewTranslationProvenance.promptVersion,
        target_translated_body: input.translatedBody,
      },
    );
    return !response || response.error !== null
      ? unavailable
      : parseSave(response.data);
  }

  async report(
    input: Parameters<ReviewTranslationRepository["report"]>[0],
  ): ReturnType<ReviewTranslationRepository["report"]> {
    const response = await callRpc(
      this.client,
      "report_customer_review_translation",
      {
        target_actor_user_id: input.actorUserId,
        target_translation_id: input.translationId,
      },
    );
    return !response || response.error !== null
      ? unavailable
      : parseReport(response.data);
  }
}
