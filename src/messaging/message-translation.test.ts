import { describe, expect, it, vi } from "vitest";

import { createDeterministicMessageTranslationAdapter } from "./deterministic-message-translation";
import { createMessageTranslation } from "./message-translation";

const actorUserId = "11111111-1111-4111-8111-111111111111";
const messageId = "55555555-5555-4555-8555-555555555555";
const translationId = "66666666-6666-4666-8666-666666666666";

describe("message translation", () => {
  it.each([
    ["en", "ar", "Could we use the garden?", "هل يمكننا استخدام الحديقة؟"],
    [
      "ar",
      "ckb",
      "هل يمكننا استخدام الحديقة؟",
      "دەتوانین باخچەکە بەکاربهێنین؟",
    ],
    ["ckb", "en", "دەتوانین باخچەکە بەکاربهێنین؟", "Could we use the garden?"],
  ] as const)(
    "uses only the known fictional %s to %s pair",
    async (sourceLanguage, targetLanguage, text, translated) => {
      const outcome =
        await createDeterministicMessageTranslationAdapter().translate({
          sourceLanguage,
          targetLanguage,
          segments: [{ key: messageId, kind: "message", text }],
        });
      expect(outcome).toMatchObject({
        status: "completed",
        source: "provider",
        segments: [{ key: messageId, text: translated }],
        provenance: {
          provider: "fictional-local-test",
          model: "deterministic-pairs-v1",
          promptVersion: "message-pairs-v1",
        },
      });
    },
  );

  it("falls back to the original for arbitrary unsupported text", async () => {
    await expect(
      createDeterministicMessageTranslationAdapter().translate({
        sourceLanguage: "en",
        targetLanguage: "ar",
        segments: [
          { key: messageId, kind: "message", text: "Unknown sentence" },
        ],
      }),
    ).resolves.toEqual({
      status: "unavailable",
      originals: [
        { key: messageId, kind: "message", text: "Unknown sentence" },
      ],
      code: "unsupported_content",
    });
  });

  it("authorizes before generation and saves the exact generated output", async () => {
    const deterministic = createDeterministicMessageTranslationAdapter();
    const adapter = { translate: vi.fn(deterministic.translate) };
    const repository = {
      prepare: vi.fn().mockResolvedValue({
        status: "prepared",
        messageId,
        originalLanguage: "en",
        originalBody: "Could we use the garden?",
        contactProtected: true,
      }),
      save: vi.fn().mockResolvedValue({
        status: "translated",
        translationId,
        translatedBody: "هل يمكننا استخدام الحديقة؟",
        targetLanguage: "ar",
        provider: "fictional-local-test",
        model: "deterministic-pairs-v1",
        promptVersion: "message-pairs-v1",
      }),
      report: vi.fn(),
    };
    const service = createMessageTranslation({
      repository,
      adapter,
      enabled: true,
    });

    await expect(
      service.translate({ actorUserId, messageId, targetLanguage: "ar" }),
    ).resolves.toMatchObject({ status: "translated", translationId });
    expect(repository.prepare).toHaveBeenCalledBefore(repository.save);
    expect(adapter.translate).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: [
          { key: "message", kind: "message", text: "Could we use the garden?" },
        ],
      }),
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId,
        messageId,
        translatedBody: "هل يمكننا استخدام الحديقة؟",
      }),
    );
  });

  it("does not generate or save without participant authorization", async () => {
    const adapter = { translate: vi.fn() };
    const repository = {
      prepare: vi.fn().mockResolvedValue({ status: "access-required" }),
      save: vi.fn(),
      report: vi.fn(),
    };

    await expect(
      createMessageTranslation({
        repository,
        adapter,
        enabled: true,
      }).translate({
        actorUserId,
        messageId,
        targetLanguage: "ar",
      }),
    ).resolves.toEqual({ status: "access-required" });
    expect(adapter.translate).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("refuses to stamp an unexpected adapter provenance as fictional", async () => {
    const repository = {
      prepare: vi.fn().mockResolvedValue({
        status: "prepared",
        messageId,
        originalLanguage: "en",
        originalBody: "Could we use the garden?",
        contactProtected: true,
      }),
      save: vi.fn(),
      report: vi.fn(),
    };
    const adapter = {
      translate: vi.fn().mockResolvedValue({
        status: "completed",
        source: "provider",
        segments: [{ key: "message", text: "unexpected" }],
        provenance: {
          provider: "unexpected",
          model: "unknown",
          effort: "none",
          promptVersion: "unknown",
          promptDigest: "unknown",
        },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
    };

    await expect(
      createMessageTranslation({
        repository,
        adapter,
        enabled: true,
      }).translate({
        actorUserId,
        messageId,
        targetLanguage: "ar",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("never calls the adapter when the exact output is cached or the runtime is disabled", async () => {
    const adapter = { translate: vi.fn() };
    const cached = {
      status: "translated" as const,
      translationId,
      translatedBody: "هل يمكننا استخدام الحديقة؟",
      targetLanguage: "ar" as const,
      provider: "fictional-local-test",
      model: "deterministic-pairs-v1",
      promptVersion: "message-pairs-v1",
    };
    const repository = {
      prepare: vi.fn().mockResolvedValue(cached),
      save: vi.fn(),
      report: vi.fn(),
    };
    await expect(
      createMessageTranslation({
        repository,
        adapter,
        enabled: true,
      }).translate({
        actorUserId,
        messageId,
        targetLanguage: "ar",
      }),
    ).resolves.toEqual(cached);
    await expect(
      createMessageTranslation({
        repository,
        adapter,
        enabled: false,
      }).translate({
        actorUserId,
        messageId,
        targetLanguage: "ar",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(adapter.translate).not.toHaveBeenCalled();
  });
});
