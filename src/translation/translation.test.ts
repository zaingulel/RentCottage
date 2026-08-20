import { describe, expect, it, vi } from "vitest";

import {
  createTranslationService,
  type TranslationConfiguration,
  type TranslationInput,
  type TranslationStore,
} from "./translation";

const input = {
  sourceLanguage: "en" as const,
  targetLanguage: "ar" as const,
  route: "ordinary" as const,
  segments: [
    {
      key: "description",
      kind: "cottage_description" as const,
      text: "A quiet cottage near Shaqlawa.",
    },
    { key: "houseRules", kind: "house_rules" as const, text: "No smoking." },
  ],
};

const configuration: Extract<TranslationConfiguration, { enabled: true }> = {
  enabled: true,
  provider: "openai",
  ordinary: {
    model: "gpt-5.6-luna",
    effort: "none",
    promptVersion: "v1",
    promptContent: "Approved ordinary prompt.",
    promptDigest:
      "5a7874e3c4e75a4a2afe3cc5385fcb8b3498e6617fe99a80c3f026e846adfa60",
  },
  strongerModel: {
    model: "gpt-5.6-terra",
    effort: "none",
    promptVersion: "v1",
    promptContent: "Approved stronger prompt.",
    promptDigest:
      "55c9204c727310a661a9c73c33c272cc47b2180c61fce7948030983156ad9207",
  },
  limits: {
    maximumAttempts: 3,
    maximumSegmentCharacters: 2_000,
    maximumRequestBytes: 3_000,
    maximumInputTokens: 4_096,
    providerFramingTokenAllowance: 512,
    maximumOutputTokens: 512,
    inputMicrousdPerMillion: 200_000,
    outputMicrousdPerMillion: 1_200_000,
    reservationMicrousd: 10_000,
  },
};

function store(overrides: Partial<TranslationStore> = {}): TranslationStore {
  return {
    findCached: vi.fn().mockResolvedValue(null),
    reserveUsage: vi
      .fn()
      .mockResolvedValue({ granted: true, id: "reservation-1" }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    saveCached: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("translation module", () => {
  it("fails closed with the originals when configuration is disabled", async () => {
    const storage = store();
    const adapter = { translate: vi.fn() };
    const service = createTranslationService({
      configuration: { enabled: false, code: "configuration_unavailable" },
      adapter,
      store: storage,
    });

    await expect(service.translate(input)).resolves.toEqual({
      status: "unavailable",
      code: "configuration_unavailable",
      originals: input.segments,
    });
    expect(adapter.translate).not.toHaveBeenCalled();
    expect(storage.reserveUsage).not.toHaveBeenCalled();
  });

  it("rejects unsupported content before cache, reservation or network access", async () => {
    const storage = store();
    const adapter = { translate: vi.fn() };
    const service = createTranslationService({
      configuration,
      adapter,
      store: storage,
    });

    await expect(
      service.translate({
        ...input,
        segments: [
          {
            key: "evidence",
            kind: "verification_document",
            text: "private identity evidence",
          },
        ] as never,
      }),
    ).resolves.toEqual({
      status: "unavailable",
      code: "unsupported_content",
      originals: [
        {
          key: "evidence",
          kind: "verification_document",
          text: "private identity evidence",
        },
      ],
    });
    expect(storage.findCached).not.toHaveBeenCalled();
    expect(storage.reserveUsage).not.toHaveBeenCalled();
    expect(adapter.translate).not.toHaveBeenCalled();
  });

  it.each([
    { sourceLanguage: "ku" },
    { targetLanguage: "fr" },
    { route: "custom_model" },
  ])(
    "rejects invalid public input before cache, reservation or network access",
    async (change) => {
      const storage = store();
      const adapter = { translate: vi.fn() };
      const service = createTranslationService({
        configuration,
        adapter,
        store: storage,
      });

      await expect(
        service.translate({ ...input, ...change } as never),
      ).resolves.toMatchObject({
        status: "unavailable",
        code: "invalid_input",
      });
      expect(storage.findCached).not.toHaveBeenCalled();
      expect(storage.reserveUsage).not.toHaveBeenCalled();
      expect(adapter.translate).not.toHaveBeenCalled();
    },
  );

  it("returns a validated cache hit without a reservation or provider call", async () => {
    const cached = {
      segments: [
        { key: "description", text: "كوخ هادئ قرب شقلاوة." },
        { key: "houseRules", text: "ممنوع التدخين." },
      ],
      provenance: {
        provider: "openai",
        model: "gpt-5.6-luna",
        effort: "none",
        promptVersion: "v1",
        promptDigest:
          "5a7874e3c4e75a4a2afe3cc5385fcb8b3498e6617fe99a80c3f026e846adfa60",
      },
      usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
    };
    const storage = store({ findCached: vi.fn().mockResolvedValue(cached) });
    const adapter = { translate: vi.fn() };
    const service = createTranslationService({
      configuration,
      adapter,
      store: storage,
    });

    await expect(service.translate(input)).resolves.toEqual({
      status: "completed",
      source: "cache",
      ...cached,
    });
    expect(storage.reserveUsage).not.toHaveBeenCalled();
    expect(adapter.translate).not.toHaveBeenCalled();
  });

  it("reserves exactly once for each transient provider attempt", async () => {
    const storage = store({
      reserveUsage: vi
        .fn()
        .mockResolvedValueOnce({ granted: true, id: "reservation-1" })
        .mockResolvedValueOnce({ granted: true, id: "reservation-2" }),
    });
    const adapter = {
      translate: vi
        .fn()
        .mockRejectedValueOnce({ transient: true, code: "rate_limited" })
        .mockResolvedValueOnce({
          segments: [
            { key: "description", text: "كوخ هادئ قرب شقلاوة." },
            { key: "houseRules", text: "ممنوع التدخين." },
          ],
          provenance: {
            provider: "openai",
            model: "gpt-5.6-luna",
            effort: "none",
            promptVersion: "v1",
            promptDigest:
              "5a7874e3c4e75a4a2afe3cc5385fcb8b3498e6617fe99a80c3f026e846adfa60",
          },
          usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        }),
    };
    const service = createTranslationService({
      configuration,
      adapter,
      store: storage,
    });

    await expect(service.translate(input)).resolves.toMatchObject({
      status: "completed",
      source: "provider",
    });
    expect(adapter.translate).toHaveBeenCalledTimes(2);
    expect(storage.reserveUsage).toHaveBeenCalledTimes(2);
    expect(storage.recordUsage).toHaveBeenCalledTimes(1);
    expect(storage.recordUsage).toHaveBeenCalledWith(
      "reservation-2",
      expect.objectContaining({ totalTokens: 70 }),
    );
  });

  it("retains an ambiguous timeout reservation and returns originals after retries", async () => {
    const storage = store();
    const adapter = {
      translate: vi
        .fn()
        .mockRejectedValue({ transient: true, code: "timeout" }),
    };
    const service = createTranslationService({
      configuration: {
        ...configuration,
        limits: { ...configuration.limits, maximumAttempts: 2 },
      },
      adapter,
      store: storage,
    });

    await expect(service.translate(input)).resolves.toEqual({
      status: "unavailable",
      code: "provider_timeout",
      originals: input.segments,
    });
    expect(adapter.translate).toHaveBeenCalledTimes(2);
    expect(storage.reserveUsage).toHaveBeenCalledTimes(2);
    expect(storage.recordUsage).not.toHaveBeenCalled();
  });

  it("validates provider bounds before reserving a physical call", async () => {
    const storage = store();
    const adapter = {
      validate: vi.fn(() => {
        throw { transient: false, code: "configuration_unavailable" };
      }),
      translate: vi.fn(),
    };
    const service = createTranslationService({
      configuration,
      adapter,
      store: storage,
    });

    await expect(service.translate(input)).resolves.toEqual({
      status: "unavailable",
      code: "configuration_unavailable",
      originals: input.segments,
    });
    expect(adapter.validate).toHaveBeenCalledTimes(1);
    expect(storage.reserveUsage).not.toHaveBeenCalled();
    expect(adapter.translate).not.toHaveBeenCalled();
  });

  it.each([
    [
      "cache lookup",
      { findCached: vi.fn().mockRejectedValue(new Error("down")) },
      "cache_unavailable",
    ],
    [
      "usage reservation",
      { reserveUsage: vi.fn().mockRejectedValue(new Error("down")) },
      "usage_accounting_unavailable",
    ],
  ])(
    "fails with originals when %s is unavailable",
    async (_name, override, code) => {
      const storage = store(override);
      const adapter = { translate: vi.fn() };
      const service = createTranslationService({
        configuration,
        adapter,
        store: storage,
      });

      await expect(service.translate(input)).resolves.toEqual({
        status: "unavailable",
        code,
        originals: input.segments,
      });
      expect(adapter.translate).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "usage accounting",
      { recordUsage: vi.fn().mockRejectedValue(new Error("down")) },
      "usage_accounting_unavailable",
    ],
    [
      "cache save",
      { saveCached: vi.fn().mockRejectedValue(new Error("down")) },
      "cache_unavailable",
    ],
  ])(
    "fails with originals when post-fetch %s is unavailable",
    async (_name, override, code) => {
      const storage = store(override);
      const adapter = {
        translate: vi.fn().mockResolvedValue({
          segments: [
            { key: "description", text: "كوخ هادئ قرب شقلاوة." },
            { key: "houseRules", text: "ممنوع التدخين." },
          ],
          provenance: {
            provider: "openai",
            model: "gpt-5.6-luna",
            effort: "none",
            promptVersion: "v1",
            promptDigest:
              "5a7874e3c4e75a4a2afe3cc5385fcb8b3498e6617fe99a80c3f026e846adfa60",
          },
          usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        }),
      };
      const service = createTranslationService({
        configuration,
        adapter,
        store: storage,
      });

      await expect(service.translate(input)).resolves.toEqual({
        status: "unavailable",
        code,
        originals: input.segments,
      });
    },
  );

  it("uses the configured stronger route and returns human-review originals without caching", async () => {
    const storage = store();
    const adapter = {
      translate: vi
        .fn()
        .mockResolvedValue({ humanReviewReason: "safety_review" }),
    };
    const service = createTranslationService({
      configuration,
      adapter,
      store: storage,
    });

    await expect(
      service.translate({ ...input, route: "stronger_model" }),
    ).resolves.toEqual({
      status: "human_review_required",
      reason: "safety_review",
      originals: input.segments,
    });
    expect(adapter.translate).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "stronger_model",
        configuration: configuration.strongerModel,
      }),
    );
    expect(storage.recordUsage).not.toHaveBeenCalled();
    expect(storage.saveCached).not.toHaveBeenCalled();
  });

  it("binds cache identity to every required canonical dimension", async () => {
    async function observedKey(
      request: TranslationInput = input,
      configured: TranslationConfiguration = configuration,
    ) {
      const storage = store({
        reserveUsage: vi.fn().mockResolvedValue({ granted: false }),
      });
      const service = createTranslationService({
        configuration: configured,
        adapter: { translate: vi.fn() },
        store: storage,
      });
      await service.translate(request);
      return vi.mocked(storage.findCached).mock.calls[0]![0];
    }

    const baseline = await observedKey();
    await expect(observedKey()).resolves.toBe(baseline);
    const variants = [
      await observedKey({
        ...input,
        segments: input.segments.map((segment, index) =>
          index === 0
            ? { ...segment, text: `${segment.text} changed` }
            : segment,
        ),
      }),
      await observedKey({ ...input, sourceLanguage: "ckb" }),
      await observedKey({ ...input, targetLanguage: "ckb" }),
      await observedKey(input, {
        ...configuration,
        ordinary: { ...configuration.ordinary, model: "approved-model-2" },
      }),
      await observedKey(input, {
        ...configuration,
        ordinary: { ...configuration.ordinary, effort: "low" },
      }),
      await observedKey(input, {
        ...configuration,
        ordinary: { ...configuration.ordinary, promptVersion: "v2" },
      }),
      await observedKey(input, {
        ...configuration,
        ordinary: {
          ...configuration.ordinary,
          promptContent: "Changed content under the same version.",
          promptDigest: "changed-prompt-digest",
        },
      }),
    ];
    expect(new Set([baseline, ...variants])).toHaveLength(8);
  });
});
