import { afterEach, describe, expect, it, vi } from "vitest";

import type { RequestAccount } from "@/access/request-account-context";
import type {
  TranslationOutcome,
  TranslationSegment,
} from "@/translation/translation";

import { createDeterministicReviewTranslationAdapter } from "./deterministic-review-translation";
import {
  createReviewTranslation,
  reviewTranslationProvenance,
  type ReviewTranslationAdapter,
  type ReviewTranslationRepository,
} from "./review-translation";

const customerId = "10000000-0000-4000-8000-000000001002";
const ownerId = "10000000-0000-4000-8000-000000001001";
const attackerId = "99999999-9999-4999-8999-999999999999";
const reviewId = "88000000-0000-4000-8000-000000001801";
const translationId = "77777777-7777-4777-8777-777777777777";
const reportId = "66666666-6666-4666-8666-666666666666";

const originalReview = "A calm stay beside the garden.";
const arabicReview = "إقامة هادئة بجانب الحديقة.";
const request = {
  reviewId,
  subject: "review",
  targetLanguage: "ar",
} as const;

function signedIn(account: RequestAccount) {
  return async () => account;
}

const customerAccount: RequestAccount = {
  status: "authenticated",
  context: { userId: customerId, role: "customer" },
};

function fakeRepository() {
  return {
    prepare: vi.fn<ReviewTranslationRepository["prepare"]>(async () => ({
      status: "prepared",
      originalLanguage: "en",
      originalBody: originalReview,
    })),
    save: vi.fn<ReviewTranslationRepository["save"]>(async (input) => ({
      status: "translated",
      translationId,
      translatedBody: input.translatedBody,
    })),
    report: vi.fn<ReviewTranslationRepository["report"]>(async () => ({
      status: "reported",
      reportId,
    })),
  };
}

function completed(
  segments: { key: string; text: string }[],
  provenance: Partial<
    Extract<TranslationOutcome, { status: "completed" }>["provenance"]
  > = {},
): TranslationOutcome {
  return {
    status: "completed",
    source: "provider",
    segments,
    provenance: {
      ...reviewTranslationProvenance,
      effort: "none",
      promptDigest: "fictional-review-pairs-v1",
      ...provenance,
    },
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
}

function fakeAdapter(outcome: TranslationOutcome) {
  return {
    translate: vi.fn<ReviewTranslationAdapter["translate"]>(
      async () => outcome,
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("review translation", () => {
  it("review translation takes the actor from the signed-in account and never from its input", async () => {
    const repository = fakeRepository();
    const translation = createReviewTranslation({
      repository,
      adapter: createDeterministicReviewTranslationAdapter(),
      account: signedIn(customerAccount),
    });

    await expect(
      translation.translate({
        ...request,
        actorUserId: attackerId,
      } as never),
    ).resolves.toEqual({
      status: "translated",
      translationId,
      translatedBody: arabicReview,
    });
    expect(repository.prepare).toHaveBeenCalledWith({
      actorUserId: customerId,
      reviewId,
      subject: "review",
      targetLanguage: "ar",
    });
    expect(repository.save).toHaveBeenCalledWith({
      actorUserId: customerId,
      reviewId,
      subject: "review",
      targetLanguage: "ar",
      translatedBody: arabicReview,
    });

    await expect(
      translation.report({ translationId, actorUserId: attackerId } as never),
    ).resolves.toEqual({ status: "reported", reportId });
    expect(repository.report).toHaveBeenCalledWith({
      actorUserId: customerId,
      translationId,
    });

    const ownerRepository = fakeRepository();
    await createReviewTranslation({
      repository: ownerRepository,
      adapter: createDeterministicReviewTranslationAdapter(),
      account: signedIn({
        status: "authenticated",
        context: {
          userId: ownerId,
          role: "cottage_owner",
          approvalState: "prospective",
        },
      }),
    }).report({ translationId });
    expect(ownerRepository.report).toHaveBeenCalledWith({
      actorUserId: ownerId,
      translationId,
    });
  });

  it("a signed-out reader and a Platform Administrator reach no service-role call", async () => {
    const accounts: RequestAccount[] = [
      { status: "signed_out" },
      { status: "authenticated", context: undefined },
      {
        status: "authenticated",
        context: { userId: attackerId, role: "platform_administrator" },
      },
    ];
    for (const account of accounts) {
      const repository = fakeRepository();
      const adapter = fakeAdapter(completed([]));
      const translation = createReviewTranslation({
        repository,
        adapter,
        account: signedIn(account),
      });

      await expect(translation.translate(request)).resolves.toEqual({
        status: "access-required",
      });
      await expect(translation.report({ translationId })).resolves.toEqual({
        status: "access-required",
      });
      expect(repository.prepare).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
      expect(repository.report).not.toHaveBeenCalled();
      expect(adapter.translate).not.toHaveBeenCalled();
    }

    const repository = fakeRepository();
    const translation = createReviewTranslation({
      repository,
      adapter: fakeAdapter(completed([])),
      account: signedIn({ status: "unavailable" }),
    });
    await expect(translation.translate(request)).resolves.toEqual({
      status: "unavailable",
    });
    await expect(translation.report({ translationId })).resolves.toEqual({
      status: "unavailable",
    });
    expect(repository.prepare).not.toHaveBeenCalled();
    expect(repository.report).not.toHaveBeenCalled();
  });

  it("supplier output with other provenance, more than one segment or empty text is never saved", async () => {
    const rejected: TranslationOutcome[] = [
      completed([{ key: "review", text: arabicReview }], {
        provider: "another-supplier",
      }),
      completed([{ key: "review", text: arabicReview }], {
        model: "another-model",
      }),
      completed([{ key: "review", text: arabicReview }], {
        promptVersion: "message-pairs-v1",
      }),
      completed([
        { key: "review", text: arabicReview },
        { key: "review", text: arabicReview },
      ]),
      completed([]),
      completed([{ key: "reply", text: arabicReview }]),
      completed([{ key: "review", text: "" }]),
      completed([{ key: "review", text: " \n\t " }]),
      {
        status: "unavailable",
        originals: [],
        code: "unsupported_content",
      },
      { status: "human_review_required", originals: [], reason: "unsafe" },
    ];
    for (const outcome of rejected) {
      const repository = fakeRepository();
      const translation = createReviewTranslation({
        repository,
        adapter: fakeAdapter(outcome),
        account: signedIn(customerAccount),
      });

      await expect(translation.translate(request)).resolves.toEqual({
        status: "unavailable",
      });
      expect(repository.save).not.toHaveBeenCalled();
    }

    const repository = fakeRepository();
    const adapter = fakeAdapter(
      completed([{ key: "reply", text: `  ${arabicReview}\n` }]),
    );
    await createReviewTranslation({
      repository,
      adapter,
      account: signedIn(customerAccount),
    }).translate({ ...request, subject: "reply" });
    const segments: TranslationSegment[] = [
      { key: "reply", kind: "review", text: originalReview },
    ];
    expect(adapter.translate).toHaveBeenCalledWith({
      sourceLanguage: "en",
      targetLanguage: "ar",
      segments,
    });
    expect(repository.save).toHaveBeenCalledWith({
      actorUserId: customerId,
      reviewId,
      subject: "reply",
      targetLanguage: "ar",
      translatedBody: arabicReview,
    });
  });

  it("returns every database status unchanged and calls the supplier only for a prepared source", async () => {
    for (const status of [
      "invalid",
      "access-required",
      "not-found",
      "unavailable",
    ] as const) {
      const repository = fakeRepository();
      repository.prepare.mockResolvedValue({ status });
      const adapter = fakeAdapter(completed([]));
      await expect(
        createReviewTranslation({
          repository,
          adapter,
          account: signedIn(customerAccount),
        }).translate(request),
      ).resolves.toEqual({ status });
      expect(adapter.translate).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    }

    const cached = fakeRepository();
    cached.prepare.mockResolvedValue({
      status: "translated",
      translationId,
      translatedBody: arabicReview,
    });
    const cachedAdapter = fakeAdapter(completed([]));
    await expect(
      createReviewTranslation({
        repository: cached,
        adapter: cachedAdapter,
        account: signedIn(customerAccount),
      }).translate(request),
    ).resolves.toEqual({
      status: "translated",
      translationId,
      translatedBody: arabicReview,
    });
    expect(cachedAdapter.translate).not.toHaveBeenCalled();

    const blocked = fakeRepository();
    blocked.save.mockResolvedValue({ status: "blocked" });
    await expect(
      createReviewTranslation({
        repository: blocked,
        adapter: createDeterministicReviewTranslationAdapter(),
        account: signedIn(customerAccount),
      }).translate(request),
    ).resolves.toEqual({ status: "blocked" });
  });

  it("turns a thrown failure into unavailable and logs only the tag", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const repository = fakeRepository();
    repository.prepare.mockRejectedValue(new Error("private detail"));
    repository.report.mockRejectedValue(new Error("private detail"));
    const translation = createReviewTranslation({
      repository,
      adapter: createDeterministicReviewTranslationAdapter(),
      account: signedIn(customerAccount),
    });

    await expect(translation.translate(request)).resolves.toEqual({
      status: "unavailable",
    });
    await expect(translation.report({ translationId })).resolves.toEqual({
      status: "unavailable",
    });
    expect(log.mock.calls).toEqual([
      ["customer-review-translation-unavailable"],
      ["customer-review-translation-unavailable"],
    ]);
  });
});

describe("deterministic review translation adapter", () => {
  const adapter = createDeterministicReviewTranslationAdapter();
  const input = (
    targetLanguage: "ar" | "ckb",
    text: string,
    kind: TranslationSegment["kind"] = "review",
  ) => ({
    sourceLanguage: "en" as const,
    targetLanguage,
    segments: [{ key: "review", kind, text }],
  });

  it("translates exactly the three fixed pairs with the review provenance", async () => {
    const pairs = [
      ["ar", originalReview, arabicReview],
      ["ckb", originalReview, "مانەوەیەکی ئارام لە تەنیشت باخچەکە."],
      ["ar", "Thank you for staying with us.", "شكراً لإقامتكم معنا."],
    ] as const;
    for (const [target, text, translated] of pairs) {
      await expect(adapter.translate(input(target, text))).resolves.toEqual({
        status: "completed",
        source: "provider",
        segments: [{ key: "review", text: translated }],
        provenance: {
          provider: "fictional-local-test",
          model: "deterministic-pairs-v1",
          effort: "none",
          promptVersion: "review-pairs-v1",
          promptDigest: "fictional-review-pairs-v1",
        },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      });
    }
  });

  it("refuses every other input, the reply having no Sorani pair on purpose", async () => {
    const unsupported = {
      status: "unavailable",
      code: "unsupported_content",
    };
    await expect(
      adapter.translate(input("ckb", "Thank you for staying with us.")),
    ).resolves.toMatchObject(unsupported);
    await expect(
      adapter.translate(input("ar", originalReview, "message")),
    ).resolves.toMatchObject(unsupported);
    await expect(
      adapter.translate({
        ...input("ar", originalReview),
        segments: [
          { key: "a", kind: "review", text: originalReview },
          { key: "b", kind: "review", text: originalReview },
        ],
      }),
    ).resolves.toMatchObject(unsupported);
  });
});
