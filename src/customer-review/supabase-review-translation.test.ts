import { describe, expect, it, vi } from "vitest";

import { SupabaseReviewTranslationRepository } from "./supabase-review-translation";

const actorUserId = "10000000-0000-4000-8000-000000001002";
const reviewId = "88000000-0000-4000-8000-000000001801";
const translationId = "77777777-7777-4777-8777-777777777777";
const reportId = "66666666-6666-4666-8666-666666666666";

const provenanceParameters = {
  target_provider: "fictional-local-test",
  target_model: "deterministic-pairs-v1",
  target_prompt_version: "review-pairs-v1",
};
const request = {
  actorUserId,
  reviewId,
  subject: "review",
  targetLanguage: "ar",
} as const;

function clientWith(data: unknown, error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) };
}

function repositoryWith(data: unknown, error: unknown = null) {
  const client = clientWith(data, error);
  return {
    client,
    repository: new SupabaseReviewTranslationRepository(client as never),
  };
}

describe("Supabase review translation repository", () => {
  it("prepares through the service-role RPC with the review provenance and the explicit actor", async () => {
    const { client, repository } = repositoryWith({
      status: "prepared",
      originalLanguage: "en",
      originalBody: "A calm stay beside the garden.",
    });

    await expect(repository.prepare(request)).resolves.toEqual({
      status: "prepared",
      originalLanguage: "en",
      originalBody: "A calm stay beside the garden.",
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "prepare_customer_review_translation",
      {
        target_actor_user_id: actorUserId,
        target_review_id: reviewId,
        target_subject: "review",
        target_language: "ar",
        ...provenanceParameters,
      },
    );

    await expect(
      repositoryWith({
        status: "translated",
        translationId,
        translatedBody: "إقامة هادئة بجانب الحديقة.",
      }).repository.prepare(request),
    ).resolves.toEqual({
      status: "translated",
      translationId,
      translatedBody: "إقامة هادئة بجانب الحديقة.",
    });
    for (const status of ["invalid", "access-required", "not-found"]) {
      await expect(
        repositoryWith({ status }).repository.prepare(request),
      ).resolves.toEqual({ status });
    }
  });

  it("saves the generated text through the service-role RPC and returns the stored text", async () => {
    const { client, repository } = repositoryWith({
      status: "translated",
      translationId,
      translatedBody: "إقامة هادئة بجانب الحديقة.",
    });

    await expect(
      repository.save({
        ...request,
        translatedBody: "إقامة هادئة بجانب الحديقة.",
      }),
    ).resolves.toEqual({
      status: "translated",
      translationId,
      translatedBody: "إقامة هادئة بجانب الحديقة.",
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "save_customer_review_translation",
      {
        target_actor_user_id: actorUserId,
        target_review_id: reviewId,
        target_subject: "review",
        target_language: "ar",
        ...provenanceParameters,
        target_translated_body: "إقامة هادئة بجانب الحديقة.",
      },
    );
    for (const status of [
      "invalid",
      "access-required",
      "not-found",
      "blocked",
    ]) {
      await expect(
        repositoryWith({ status }).repository.save({
          ...request,
          translatedBody: "text",
        }),
      ).resolves.toEqual({ status });
    }
  });

  it("reports through the service-role RPC with the explicit actor", async () => {
    const { client, repository } = repositoryWith({
      status: "reported",
      reportId,
    });

    await expect(
      repository.report({ actorUserId, translationId }),
    ).resolves.toEqual({ status: "reported", reportId });
    expect(client.rpc).toHaveBeenCalledWith(
      "report_customer_review_translation",
      {
        target_actor_user_id: actorUserId,
        target_translation_id: translationId,
      },
    );
    for (const status of ["invalid", "access-required", "not-found"]) {
      await expect(
        repositoryWith({ status }).repository.report({
          actorUserId,
          translationId,
        }),
      ).resolves.toEqual({ status });
    }
  });

  it("maps a denial, a lost response and every unexpected shape to unavailable", async () => {
    const save = { ...request, translatedBody: "text" };
    const prepared = {
      status: "prepared",
      originalLanguage: "en",
      originalBody: "Text",
    };
    const translated = {
      status: "translated",
      translationId,
      translatedBody: "x",
    };
    const malformed = [
      null,
      "translated",
      [],
      {},
      { status: "unknown" },
      { status: "invalid", extra: "private" },
      { ...translated, translationId: "not-a-uuid" },
      { ...translated, translatedBody: "  " },
      { ...translated, translatedBody: "x".repeat(4001) },
      { ...translated, translatedBody: 3 },
      { ...translated, extra: 1 },
      { status: "translated", translationId },
    ];
    for (const payload of [
      ...malformed,
      { ...prepared, originalLanguage: "fr" },
      { ...prepared, originalBody: "" },
      { ...prepared, extra: 1 },
      { status: "prepared", originalLanguage: "en" },
      { status: "blocked" },
      { status: "reported", reportId },
    ]) {
      await expect(
        repositoryWith(payload).repository.prepare(request),
      ).resolves.toEqual({ status: "unavailable" });
    }
    for (const payload of [
      ...malformed,
      prepared,
      { status: "reported", reportId },
    ]) {
      await expect(
        repositoryWith(payload).repository.save(save),
      ).resolves.toEqual({ status: "unavailable" });
    }
    for (const payload of [
      ...malformed,
      { status: "reported", reportId: "not-a-uuid" },
      { status: "reported" },
      { status: "reported", reportId, extra: 1 },
      { status: "blocked" },
    ]) {
      await expect(
        repositoryWith(payload).repository.report({
          actorUserId,
          translationId,
        }),
      ).resolves.toEqual({ status: "unavailable" });
    }

    const lost = {
      rpc: vi.fn().mockRejectedValue(new Error("network lost")),
    };
    for (const repository of [
      repositoryWith(translated, { code: "42501", message: "denied" })
        .repository,
      new SupabaseReviewTranslationRepository(lost as never),
    ]) {
      await expect(repository.prepare(request)).resolves.toEqual({
        status: "unavailable",
      });
      await expect(repository.save(save)).resolves.toEqual({
        status: "unavailable",
      });
      await expect(
        repository.report({ actorUserId, translationId }),
      ).resolves.toEqual({ status: "unavailable" });
    }
    expect(lost.rpc).toHaveBeenCalledTimes(3);
  });
});
