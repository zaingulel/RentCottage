import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { SupabaseCottagePublicationRepository } from "./supabase-cottage-publication";

const profileId = "70000000-0000-4000-8000-000000000024";
const cycleId = "20000000-0000-4000-8000-000000000024";
const revisionId = "30000000-0000-4000-8000-000000000024";
const ordinaryProvenance = {
  provider: "openai",
  model: "ordinary-model",
  effort: "none",
  prompt_version: "ordinary-v1",
};
const fictionalProvenance = {
  provider: "fictional-cottage-translations",
  model: "catalog-v1",
  effort: "none",
  prompt_version: "fictional-cottage-catalog-v1",
};
const noProvenance = {
  provider: null,
  model: null,
  effort: null,
  prompt_version: null,
};
const environment = "hosted-demo-yvibcyqtyihpzpmomnzg";

function result(data: unknown) {
  return Promise.resolve({ data, error: null });
}

function repositoryWith({
  cycle = {
    id: cycleId,
    state: "in_review",
    source_revision_id: revisionId,
  },
  source = {
    id: revisionId,
    source_language: "en",
    description: "Description",
    house_rules: "Rules",
  },
  heads = [
    {
      locale: "en",
      localized_revision_id: revisionId,
    },
  ],
  revisions = [
    {
      id: revisionId,
      locale: "en",
      origin: "owner_source",
      translation_environment: null,
      ...noProvenance,
      description: "Description",
      house_rules: "Rules",
    },
  ],
  decisions = [
    {
      localized_revision_id: revisionId,
      approved: true,
      decided_at: "2026-08-18T00:00:00.000Z",
    },
  ],
  attempts = [],
  humanReviews = [],
  qualityReports = [],
  mode = "unavailable",
}: {
  cycle?: unknown;
  source?: unknown;
  heads?: unknown;
  revisions?: unknown;
  decisions?: unknown;
  attempts?: unknown;
  humanReviews?: unknown;
  qualityReports?: unknown;
  mode?: unknown;
} = {}) {
  const client = {
    rpc: vi.fn((name: string) => {
      if (name !== "cottage_translation_runtime_mode")
        throw new Error(`Unexpected RPC ${name}`);
      return result(mode);
    }),
    from: vi.fn((table: string) => {
      if (table === "cottage_profile_review_cycles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(() => result(cycle)),
                })),
              })),
            })),
          })),
        };
      }
      if (table === "cottage_profile_localized_heads") {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => result(heads)) })),
        };
      }
      if (table === "cottage_profile_source_revisions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ single: vi.fn(() => result(source)) })),
          })),
        };
      }
      if (table === "cottage_profile_localized_revisions") {
        return {
          select: vi.fn(() => ({ in: vi.fn(() => result(revisions)) })),
        };
      }
      if (table === "cottage_profile_localized_decisions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() => ({ order: vi.fn(() => result(decisions)) })),
            })),
          })),
        };
      }
      if (table === "cottage_profile_translation_attempts") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ order: vi.fn(() => result(attempts)) })),
          })),
        };
      }
      if (table === "cottage_profile_translation_human_reviews") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => result(humanReviews)),
            })),
          })),
        };
      }
      if (table === "cottage_translation_quality_reports") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => result(qualityReports)),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  } as unknown as SupabaseClient;
  return new SupabaseCottagePublicationRepository(client, client);
}

describe("Supabase Cottage publication adapter", () => {
  it.each(["production", "fictional", "unavailable"])(
    "reads %s publication admission through the privileged mode RPC",
    async (mode) => {
      expect(
        await repositoryWith({ mode }).loadCurrentReview(profileId),
      ).toMatchObject({ publicationMode: mode });
    },
  );

  it.each(["generated", "administrator_correction"])(
    "preserves fictional provenance for a %s remediation head independently of runtime admission",
    async (origin) => {
      for (const mode of ["production", "fictional", "unavailable"]) {
        const review = await repositoryWith({
          mode,
          revisions: [
            {
              id: revisionId,
              locale: "ar",
              origin,
              description: "Fictional sample",
              house_rules: "Fictional rules",
              translation_environment: environment,
              ...(origin === "generated" ? fictionalProvenance : noProvenance),
            },
          ],
          qualityReports: [
            { locale: "ar", reason: "Sample correction requested" },
          ],
        }).loadCurrentReview(profileId);
        expect(review?.localizations[1]).toMatchObject({
          origin,
          translationEnvironment: environment,
          qualityReportReason: "Sample correction requested",
        });
      }
    },
  );

  it.each([
    ["missing marker", { translation_environment: undefined }],
    ["unknown marker", { translation_environment: "other-demo" }],
    [
      "owner source marked fictional",
      { origin: "owner_source", ...noProvenance },
    ],
    ["fictional generated with ordinary tuple", ordinaryProvenance],
    ["unmarked reserved tuple", { translation_environment: null }],
    ["correction with generated tuple", { origin: "administrator_correction" }],
    [
      "generated without provenance",
      { translation_environment: null, ...noProvenance },
    ],
  ])(
    "rejects %s before rendering even a human-review fallback",
    async (_name, change) => {
      await expect(
        repositoryWith({
          revisions: [
            {
              id: revisionId,
              locale: "ar",
              origin: "generated",
              description: "Sample",
              house_rules: "Rules",
              translation_environment: environment,
              ...fictionalProvenance,
              ...change,
            },
          ],
          humanReviews: [{ locale: "ar", state: "active" }],
        }).loadCurrentReview(profileId),
      ).rejects.toThrow("invalid-provider-data");
    },
  );

  it("retains a fictional marker when human review shows the original source", async () => {
    const review = await repositoryWith({
      revisions: [
        {
          id: revisionId,
          locale: "ar",
          origin: "generated",
          description: "Sample",
          house_rules: "Rules",
          translation_environment: environment,
          ...fictionalProvenance,
        },
      ],
      humanReviews: [{ locale: "ar", state: "active" }],
    }).loadCurrentReview(profileId);
    expect(review?.localizations[1]).toMatchObject({
      origin: "source_fallback",
      description: "Description",
      translationEnvironment: environment,
      humanReviewRequired: true,
    });
  });

  it("retains actual production readiness while admitting fictional administration and rejects corrupt mode combinations", async () => {
    const administration = {
      productionReady: false,
      publicationMode: "fictional",
      providerTermsApproved: false,
      nativeReviewApproved: false,
      qualityThresholdApproved: false,
      ordinaryModel: null,
      ordinaryEffort: null,
      strongerModel: null,
      strongerEffort: null,
      judgeModel: null,
      judgeEffort: null,
      monthlyRequestLimit: null,
      monthlyTokenLimit: null,
      monthlySpendMicrousdLimit: null,
      monthRequests: 0,
      monthReservedTokens: 0,
      monthReservedMicrousd: 0,
      monthActualMicrousd: 0,
      qualityReportCount: 0,
    };
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: administration, error: null });
    const client = { rpc } as unknown as SupabaseClient;
    const repository = new SupabaseCottagePublicationRepository(client, client);
    expect(await repository.loadTranslationAdministration()).toMatchObject({
      productionReady: false,
      publicationMode: "fictional",
    });
    for (const change of [
      { publicationMode: undefined },
      { publicationMode: "unknown" },
      { productionReady: true },
      { publicationMode: "production", productionReady: false },
    ]) {
      rpc.mockResolvedValueOnce({
        data: { ...administration, ...change },
        error: null,
      });
      await expect(repository.loadTranslationAdministration()).rejects.toThrow(
        "invalid-provider-data",
      );
    }
  });

  it("allows ordinary provenance sharing individual reserved values without claiming fictional evidence", async () => {
    for (const provenance of [
      ordinaryProvenance,
      { ...ordinaryProvenance, provider: "fictional-cottage-translations" },
      { ...ordinaryProvenance, model: "catalog-v1" },
      { ...ordinaryProvenance, prompt_version: "fictional-cottage-catalog-v1" },
    ]) {
      const review = await repositoryWith({
        revisions: [
          {
            id: revisionId,
            locale: "ar",
            origin: "generated",
            description: "Ordinary draft",
            house_rules: "Rules",
            translation_environment: null,
            ...provenance,
          },
        ],
      }).loadCurrentReview(profileId);
      expect(review?.localizations[1]).toMatchObject({
        origin: "generated",
        translationEnvironment: null,
      });
    }
  });

  it("returns originals for failed and human-routed targets while retaining source language", async () => {
    const arabicRevisionId = "30000000-0000-4000-8000-000000000025";
    const review = await repositoryWith({
      source: {
        id: revisionId,
        source_language: "en",
        description: "Original description",
        house_rules: "Original rules",
      },
      heads: [
        { localized_revision_id: revisionId },
        { localized_revision_id: arabicRevisionId },
      ],
      revisions: [
        {
          id: revisionId,
          locale: "en",
          origin: "owner_source",
          translation_environment: null,
          ...noProvenance,
          description: "Original description",
          house_rules: "Original rules",
        },
        {
          id: arabicRevisionId,
          locale: "ar",
          origin: "generated",
          translation_environment: null,
          ...ordinaryProvenance,
          description: "Generated Arabic",
          house_rules: "Generated rules",
        },
      ],
      attempts: [
        {
          target_language: "ckb",
          state: "failed",
          failure_code: "usage_limit_reached",
          attempt_number: 1,
        },
      ],
      humanReviews: [{ locale: "ar", state: "active" }],
    }).loadCurrentReview(profileId);

    expect(review).toMatchObject({
      sourceLanguage: "en",
      localizations: [
        { locale: "en", origin: "owner_source" },
        {
          locale: "ar",
          origin: "source_fallback",
          contentLanguage: "en",
          description: "Original description",
          humanReviewRequired: true,
        },
        {
          locale: "ckb",
          origin: "source_fallback",
          contentLanguage: "en",
          description: "Original description",
          failureCode: "usage_limit_reached",
        },
      ],
    });
  });

  it("binds a translation attempt to the selected leased route", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: "10000000-0000-4000-8000-000000000024",
        review_cycle_id: cycleId,
        source_revision_id: revisionId,
        target_language: "ar",
        lease_token: "50000000-0000-4000-8000-000000000024",
      },
      error: null,
    });
    const privilegedClient = {
      rpc,
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() =>
              result({
                source_language: "en",
                description: "Quiet cottage",
                house_rules: "No smoking",
              }),
            ),
          })),
        })),
      })),
    } as unknown as SupabaseClient;
    const repository = new SupabaseCottagePublicationRepository(
      privilegedClient,
      privilegedClient,
    );

    await expect(
      repository.beginTranslation(cycleId, "ar", "stronger_model", 50_000),
    ).resolves.toMatchObject({
      reviewCycleId: cycleId,
      sourceLanguage: "en",
      targetLanguage: "ar",
      leaseToken: "50000000-0000-4000-8000-000000000024",
    });
    expect(rpc).toHaveBeenCalledWith(
      "begin_cottage_profile_translation_execution",
      {
        target_review_cycle_id: cycleId,
        target_language: "ar",
        target_route: "stronger_model",
        target_lease_milliseconds: 50_000,
      },
    );
  });

  it("binds completion and failure to the caller's exclusive lease token", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const client = { rpc } as unknown as SupabaseClient;
    const repository = new SupabaseCottagePublicationRepository(client, client);
    const leaseToken = "50000000-0000-4000-8000-000000000024";

    await repository.completeTranslation({
      attemptId: "10000000-0000-4000-8000-000000000024",
      leaseToken,
      description: "كوخ هادئ",
      houseRules: "ممنوع التدخين",
      provenance: {
        provider: "openai",
        model: "gpt-6-luna",
        effort: "none",
        promptVersion: "v1",
      },
    });
    await repository.failTranslation(
      "10000000-0000-4000-8000-000000000024",
      leaseToken,
      "provider_timeout",
    );

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "complete_cottage_profile_translation_execution",
      expect.objectContaining({ target_lease_token: leaseToken }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "fail_cottage_profile_translation_execution",
      {
        target_attempt_id: "10000000-0000-4000-8000-000000000024",
        target_lease_token: leaseToken,
        target_failure_code: "provider_timeout",
      },
    );
  });

  it.each(["complete", "fail"] as const)(
    "preserves a false %s lease result",
    async (operation) => {
      const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
      const client = { rpc } as unknown as SupabaseClient;
      const repository = new SupabaseCottagePublicationRepository(
        client,
        client,
      );

      const result =
        operation === "complete"
          ? await repository.completeTranslation({
              attemptId: "10000000-0000-4000-8000-000000000024",
              leaseToken: "50000000-0000-4000-8000-000000000024",
              description: "كوخ هادئ",
              houseRules: "ممنوع التدخين",
              provenance: {
                provider: "openai",
                model: "gpt-6-luna",
                effort: "none",
                promptVersion: "v1",
              },
            })
          : await repository.failTranslation(
              "10000000-0000-4000-8000-000000000024",
              "50000000-0000-4000-8000-000000000024",
              "provider_timeout",
            );

      expect(result).toBe(false);
    },
  );

  it("uses authenticated atomic RPCs for human review and owner reports", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const client = { rpc } as unknown as SupabaseClient;
    const repository = new SupabaseCottagePublicationRepository(client, client);

    await repository.routeHumanReview(cycleId, "ar", "Native review");
    await repository.reportTranslation(cycleId, revisionId, "Poor meaning");

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "route_current_cottage_translation_to_human_review",
      {
        target_review_cycle_id: cycleId,
        target_locale: "ar",
        target_reason: "Native review",
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "report_current_cottage_translation",
      {
        target_review_cycle_id: cycleId,
        target_localized_revision_id: revisionId,
        target_reason: "Poor meaning",
      },
    );
  });

  it.each([
    ["localized heads", { heads: {} }],
    ["localized revisions", { revisions: {} }],
    ["localized decisions", { decisions: {} }],
    ["runtime mode", { mode: {} }],
    ["unknown runtime mode", { mode: "ready" }],
    [
      "decision approval",
      {
        decisions: [
          {
            localized_revision_id: revisionId,
            approved: "true",
            decided_at: "2026-08-18T00:00:00.000Z",
          },
        ],
      },
    ],
    [
      "localized revision text",
      {
        revisions: [
          {
            id: revisionId,
            locale: "en",
            origin: "owner_source",
            translation_environment: null,
            ...noProvenance,
            description: "Description",
          },
        ],
      },
    ],
  ] as const)(
    "rejects malformed successful %s payloads",
    async (_name, data) => {
      await expect(
        repositoryWith(data).loadCurrentReview(profileId),
      ).rejects.toThrow("invalid-provider-data");
    },
  );

  it("loads the immutable source revision separately from localized heads", async () => {
    const sourceRevisionId = "40000000-0000-4000-8000-000000000024";
    const review = await repositoryWith({
      cycle: {
        id: cycleId,
        state: "in_review",
        source_revision_id: sourceRevisionId,
      },
      source: {
        id: sourceRevisionId,
        source_language: "ckb",
        description: "سەرچاوە",
        house_rules: "یاسا",
      },
      heads: [],
      revisions: [],
      decisions: [],
    }).loadCurrentReview(profileId);

    expect(review).toMatchObject({
      sourceLanguage: "ckb",
      localizations: [
        { locale: "en", contentLanguage: "ckb", description: "سەرچاوە" },
        { locale: "ar", contentLanguage: "ckb", description: "سەرچاوە" },
        { locale: "ckb", contentLanguage: "ckb", description: "سەرچاوە" },
      ],
    });
  });

  it("loads an authorized quality report against the affected remediation locale", async () => {
    const review = await repositoryWith({
      qualityReports: [
        { locale: "ar", reason: "The published meaning is incorrect" },
      ],
    }).loadCurrentReview(profileId);

    expect(review?.localizations).toContainEqual(
      expect.objectContaining({
        locale: "ar",
        qualityReportReason: "The published meaning is incorrect",
      }),
    );
  });

  it("rejects unknown internal translation failure codes", async () => {
    await expect(
      repositoryWith({
        attempts: [
          {
            target_language: "ar",
            state: "failed",
            failure_code: "database-password",
            attempt_number: 1,
          },
        ],
      }).loadCurrentReview(profileId),
    ).rejects.toThrow("invalid-provider-data");
  });
});
