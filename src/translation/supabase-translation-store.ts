import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { calculateMicrousd } from "./call-budget.ts";
import type { TranslationRuntimeConfiguration } from "./configuration.ts";
import type {
  CompletedTranslation,
  TranslationStore,
  TranslationUsage,
} from "./translation.ts";

type EnabledConfiguration = Extract<
  TranslationRuntimeConfiguration,
  { enabled: true }
>;

function assertSuccess(error: unknown): void {
  if (error) {
    throw new Error("Translation persistence is unavailable", {
      cause: error,
    });
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Translation persistence returned invalid data");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Translation persistence returned invalid data");
  }
  return value;
}

function nonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Translation persistence returned invalid data");
  }
  return value as number;
}

function completedTranslation(value: unknown): CompletedTranslation {
  const result = record(value);
  if (!Array.isArray(result.segments)) {
    throw new Error("Translation persistence returned invalid data");
  }
  const provenance = record(result.provenance);
  const usage = record(result.usage);
  const inputTokens = nonnegativeInteger(usage.inputTokens);
  const outputTokens = nonnegativeInteger(usage.outputTokens);
  const totalTokens = nonnegativeInteger(usage.totalTokens);
  if (totalTokens !== inputTokens + outputTokens) {
    throw new Error("Translation persistence returned invalid data");
  }
  return {
    segments: result.segments.map((value) => {
      const segment = record(value);
      return {
        key: requiredString(segment.key),
        text: requiredString(segment.text),
      };
    }),
    provenance: {
      provider: requiredString(provenance.provider),
      model: requiredString(provenance.model),
      effort: requiredString(provenance.effort),
      promptVersion: requiredString(provenance.promptVersion),
      promptDigest: requiredString(provenance.promptDigest),
    },
    usage: { inputTokens, outputTokens, totalTokens },
  };
}

export class SupabaseTranslationStore implements TranslationStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly configuration: EnabledConfiguration,
  ) {}

  async findCached(cacheKey: string): Promise<CompletedTranslation | null> {
    const response = await this.client
      .from("cottage_translation_cache")
      .select("result")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    assertSuccess(response.error);
    if (!response.data) return null;
    return completedTranslation(record(response.data).result);
  }

  async reserveUsage(input: {
    cacheKey: string;
    model: string;
    effort: string;
    promptVersion: string;
    reservedTokens: number;
    reservedMicrousd: number;
  }): Promise<{ granted: true; id: string } | { granted: false }> {
    const limits = this.configuration.limits;
    const response = await this.client.rpc(
      "reserve_cottage_translation_usage",
      {
        target_cache_key: input.cacheKey,
        target_model: input.model,
        target_effort: input.effort,
        target_prompt_version: input.promptVersion,
        target_reserved_tokens: input.reservedTokens,
        target_reserved_microusd: input.reservedMicrousd,
        expected_production_approval_digest:
          this.configuration.evidence.productionApprovalDigest,
        application_monthly_request_limit: limits.monthlyRequests,
        application_monthly_token_limit: limits.monthlyTokens,
        application_monthly_spend_microusd_limit: limits.monthlyMicrousd,
      },
    );
    assertSuccess(response.error);
    const reservation = record(response.data);
    if (reservation.granted === false) return { granted: false };
    if (
      reservation.granted !== true ||
      typeof reservation.reservation_id !== "string" ||
      reservation.reservation_id.length === 0
    ) {
      throw new Error("Translation persistence returned invalid data");
    }
    return { granted: true, id: reservation.reservation_id };
  }

  async recordUsage(
    reservationId: string,
    usage: TranslationUsage,
  ): Promise<void> {
    const actualMicrousd = calculateMicrousd(
      usage.inputTokens,
      usage.outputTokens,
      this.configuration.limits.inputMicrousdPerMillion,
      this.configuration.limits.outputMicrousdPerMillion,
    );
    if (actualMicrousd === null) {
      throw new Error("Translation usage is invalid");
    }
    const response = await this.client.rpc("record_cottage_translation_usage", {
      target_reservation_id: reservationId,
      actual_input_tokens: usage.inputTokens,
      actual_output_tokens: usage.outputTokens,
      actual_total_tokens: usage.totalTokens,
      actual_microusd: actualMicrousd,
    });
    assertSuccess(response.error);
  }

  async saveCached(
    cacheKey: string,
    result: CompletedTranslation,
  ): Promise<void> {
    const response = await this.client
      .from("cottage_translation_cache")
      .insert({ cache_key: cacheKey, result });
    assertSuccess(response.error);
  }
}
