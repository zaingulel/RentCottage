import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { TranslationRuntimeConfiguration } from "./configuration";
import { SupabaseTranslationStore } from "./supabase-translation-store";

vi.mock("server-only", () => ({}));

const configuration = {
  enabled: true,
  provider: "openai",
  apiKey: "server-secret",
  ordinary: {
    model: "gpt-5.6-luna",
    effort: "none",
    promptVersion: "v1",
    promptContent: "Translate.",
    promptDigest: "1".repeat(64),
  },
  strongerModel: {
    model: "gpt-5.6-terra",
    effort: "none",
    promptVersion: "v1",
    promptContent: "Translate carefully.",
    promptDigest: "2".repeat(64),
  },
  judge: {
    model: "gpt-5.6-sol",
    effort: "medium",
    promptVersion: "judge-v1",
    promptContent: "Judge.",
    promptDigest: "3".repeat(64),
  },
  evidence: {
    approvedArtifactDigest: "a".repeat(64),
    productionApprovalDigest: "b".repeat(64),
    protocolDigest: "c".repeat(64),
    promptDigests: {
      ordinary: "1".repeat(64),
      strongerModel: "2".repeat(64),
      judge: "3".repeat(64),
    },
  },
  limits: {
    maximumAttempts: 2,
    timeoutMilliseconds: 5_000,
    maximumSegmentCharacters: 2_000,
    maximumRequestBytes: 3_000,
    maximumInputTokens: 4_096,
    providerFramingTokenAllowance: 512,
    maximumOutputTokens: 512,
    inputMicrousdPerMillion: 200_000,
    outputMicrousdPerMillion: 1_200_000,
    reservationMicrousd: 10_000,
    monthlyRequests: 100,
    monthlyTokens: 100_000,
    monthlyMicrousd: 500_000,
  },
} satisfies Extract<TranslationRuntimeConfiguration, { enabled: true }>;

function clientWith({
  cached = null,
  reservation = { granted: true, reservation_id: "reservation-1" },
}: {
  cached?: unknown;
  reservation?: unknown;
} = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: cached, error: null });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn((name: string) => {
    if (name === "reserve_cottage_translation_usage") {
      return Promise.resolve({ data: reservation, error: null });
    }
    if (name === "record_cottage_translation_usage") {
      return Promise.resolve({ data: null, error: null });
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  const client = {
    rpc,
    from: vi.fn((table: string) => {
      if (table === "cottage_translation_cache") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle })),
          })),
          insert,
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  } as unknown as SupabaseClient;
  return { client, insert, maybeSingle, rpc };
}

describe("Supabase translation store", () => {
  it("reserves one physical call against both application and owner ceilings", async () => {
    const { client, rpc } = clientWith();
    const store = new SupabaseTranslationStore(client, configuration);

    await expect(
      store.reserveUsage({
        cacheKey: "4".repeat(64),
        model: "gpt-5.6-luna",
        effort: "none",
        promptVersion: "v1",
        reservedTokens: 4_608,
        reservedMicrousd: 10_000,
      }),
    ).resolves.toEqual({ granted: true, id: "reservation-1" });

    expect(rpc).toHaveBeenCalledWith("reserve_cottage_translation_usage", {
      target_cache_key: "4".repeat(64),
      target_model: "gpt-5.6-luna",
      target_effort: "none",
      target_prompt_version: "v1",
      target_reserved_tokens: 4_608,
      target_reserved_microusd: 10_000,
      expected_production_approval_digest: "b".repeat(64),
      application_monthly_request_limit: 100,
      application_monthly_token_limit: 100_000,
      application_monthly_spend_microusd_limit: 500_000,
    });
  });

  it("returns a validated private cache result", async () => {
    const result = {
      segments: [{ key: "description", text: "كوخ هادئ" }],
      provenance: {
        provider: "openai",
        model: "gpt-5.6-luna",
        effort: "none",
        promptVersion: "v1",
        promptDigest: "1".repeat(64),
      },
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    };
    const { client } = clientWith({ cached: { result } });
    const store = new SupabaseTranslationStore(client, configuration);

    await expect(store.findCached("4".repeat(64))).resolves.toEqual(result);
  });

  it.each([
    { segments: "not-an-array" },
    { segments: [{ key: "description", text: 7 }] },
    {
      segments: [{ key: "description", text: "كوخ هادئ" }],
      provenance: { provider: "openai" },
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 99 },
    },
  ])("rejects malformed nested cache JSON", async (result) => {
    const { client } = clientWith({ cached: { result } });
    const store = new SupabaseTranslationStore(client, configuration);

    await expect(store.findCached("4".repeat(64))).rejects.toThrow(
      "Translation persistence returned invalid data",
    );
  });

  it("records actual usage separately from the immutable reservation", async () => {
    const { client, rpc } = clientWith();
    const store = new SupabaseTranslationStore(client, configuration);

    await store.recordUsage("reservation-1", {
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
    });

    expect(rpc).toHaveBeenCalledWith("record_cottage_translation_usage", {
      target_reservation_id: "reservation-1",
      actual_input_tokens: 12,
      actual_output_tokens: 4,
      actual_total_tokens: 16,
      actual_microusd: 8,
    });
  });

  it("stores only the server-side cache key and validated result", async () => {
    const { client, insert } = clientWith();
    const store = new SupabaseTranslationStore(client, configuration);
    const result = {
      segments: [{ key: "description", text: "كوخ هادئ" }],
      provenance: {
        provider: "openai",
        model: "gpt-5.6-luna",
        effort: "none",
        promptVersion: "v1",
        promptDigest: "1".repeat(64),
      },
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    };

    await store.saveCached("4".repeat(64), result);

    expect(insert).toHaveBeenCalledWith({
      cache_key: "4".repeat(64),
      result,
    });
  });
});
