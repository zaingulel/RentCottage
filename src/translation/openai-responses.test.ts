import { describe, expect, it, vi } from "vitest";

import { createOpenAIResponsesTranslationAdapter } from "./openai-responses";
import type { TranslationAdapterRequest } from "./translation";

vi.mock("server-only", () => ({}));

const request: TranslationAdapterRequest = {
  sourceLanguage: "en",
  targetLanguage: "ar",
  route: "ordinary",
  configuration: {
    model: "gpt-5.6-luna",
    effort: "none",
    promptVersion: "v1",
    promptContent: "Approved ordinary prompt.",
    promptDigest:
      "5a7874e3c4e75a4a2afe3cc5385fcb8b3498e6617fe99a80c3f026e846adfa60",
  },
  reservation: {
    maximumRequestBytes: 3_000,
    maximumInputTokens: 4_096,
    providerFramingTokenAllowance: 512,
    maximumMicrousd: 10_000,
    maximumOutputTokens: 512,
    inputMicrousdPerMillion: 200_000,
    outputMicrousdPerMillion: 1_200_000,
  },
  segments: [
    {
      key: "description",
      kind: "cottage_description",
      text: "A quiet cottage near Shaqlawa.",
    },
    { key: "houseRules", kind: "house_rules", text: "No smoking." },
  ],
};

function response(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      id: "resp_46",
      status: "completed",
      model: "gpt-5.6-luna",
      output: [
        {
          id: "rs_46",
          type: "reasoning",
          summary: [{ type: "summary_text", text: "Translation checked." }],
        },
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                segments: [
                  { key: "description", text: "كوخ هادئ قرب شقلاوة." },
                  { key: "houseRules", text: "ممنوع التدخين." },
                ],
              }),
              annotations: [],
            },
          ],
        },
      ],
      usage: { input_tokens: 50, output_tokens: 20, total_tokens: 70 },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("OpenAI Responses translation adapter", () => {
  it("uses the fixed stateless, tool-free strict structured-output request", async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 5_000,
    });

    await expect(adapter.translate(request)).resolves.toEqual({
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
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.headers).toEqual({
      Authorization: "Bearer server-secret",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      background: false,
      tools: [],
      reasoning: { effort: "none", context: "current_turn" },
      max_output_tokens: 512,
      text: {
        format: {
          type: "json_schema",
          name: "cottage_translation",
          strict: true,
        },
      },
    });
    expect(body.instructions).toBe("Approved ordinary prompt.");
    expect(body).not.toHaveProperty("conversation");
    expect(body).not.toHaveProperty("previous_response_id");
    expect(body).not.toHaveProperty("include");
    expect(body.input).toEqual([
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: expect.stringContaining("A quiet cottage near Shaqlawa."),
          },
        ],
      },
    ]);
  });

  it.each([408, 409, 429, 500, 503])(
    "classifies HTTP %i as transient without an SDK retry",
    async (status) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response("failed", { status }));
      const adapter = createOpenAIResponsesTranslationAdapter({
        apiKey: "server-secret",
        fetch,
        timeoutMilliseconds: 5_000,
      });

      await expect(adapter.translate(request)).rejects.toEqual({
        transient: true,
        code: "provider_http_error",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects malformed completion, provenance and segment keys", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        model: "unexpected-model",
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  segments: [{ key: "wrong", text: "نص" }],
                }),
                annotations: [],
              },
            ],
          },
        ],
      }),
    );
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 5_000,
    });

    await expect(adapter.translate(request)).rejects.toEqual({
      transient: false,
      code: "invalid_provider_response",
    });
  });

  it.each([
    {
      name: "an unexpected structured-output property",
      output: {
        segments: [
          { key: "description", text: "كوخ هادئ قرب شقلاوة." },
          { key: "houseRules", text: "ممنوع التدخين." },
        ],
        commentary: "extra",
      },
    },
    {
      name: "a segment exceeding the provider output bound",
      output: {
        segments: [
          { key: "description", text: "ن".repeat(10_001) },
          { key: "houseRules", text: "ممنوع التدخين." },
        ],
      },
    },
  ])("rejects $name", async ({ output }) => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify(output),
                annotations: [],
              },
            ],
          },
        ],
      }),
    );
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 5_000,
    });

    await expect(adapter.translate(request)).rejects.toEqual({
      transient: false,
      code: "invalid_provider_response",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps an aborted physical request to an ambiguous transient timeout", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new DOMException("Aborted", "AbortError"));
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 5_000,
    });

    await expect(adapter.translate(request)).rejects.toEqual({
      transient: true,
      code: "timeout",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects an insufficient per-call reservation before network access", async () => {
    const fetch = vi.fn();
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 5_000,
    });

    await expect(
      adapter.translate({
        ...request,
        reservation: {
          ...request.reservation,
          maximumInputTokens: 1,
          maximumMicrousd: 1,
        },
      }),
    ).rejects.toEqual({
      transient: false,
      code: "configuration_unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("executes distinct stronger-route prompt content without substitution", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(response({ model: "gpt-5.6-terra" }));
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 5_000,
    });
    await adapter.translate({
      ...request,
      route: "stronger_model",
      configuration: {
        model: "gpt-5.6-terra",
        effort: "high",
        promptVersion: "v1",
        promptContent: "Approved stronger prompt with distinct instructions.",
        promptDigest:
          "be9f6b6007ad501bb4a33147e8d44b74aed8534373843017b86d102bc28d9b8c",
      },
    });
    const body = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
    expect(body.instructions).toBe(
      "Approved stronger prompt with distinct instructions.",
    );
  });

  it("rejects a multibyte request outside the conservative input bound before fetch", async () => {
    const fetch = vi.fn();
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 5_000,
    });
    await expect(
      adapter.translate({
        ...request,
        configuration: {
          ...request.configuration,
          promptContent: "😀".repeat(1_000),
        },
      }),
    ).rejects.toEqual({
      transient: false,
      code: "configuration_unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects provider usage exceeding the reserved output maximum", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        usage: { input_tokens: 50, output_tokens: 513, total_tokens: 563 },
      }),
    );
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 5_000,
    });

    await expect(adapter.translate(request)).rejects.toEqual({
      transient: false,
      code: "invalid_provider_response",
    });
  });

  it("rejects provider usage exceeding the approved input maximum", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        usage: {
          input_tokens: request.reservation.maximumInputTokens + 1,
          output_tokens: 1,
          total_tokens: request.reservation.maximumInputTokens + 2,
        },
      }),
    );
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 5_000,
    });

    await expect(adapter.translate(request)).rejects.toEqual({
      transient: false,
      code: "invalid_provider_response",
    });
  });

  it.each([
    ["missing message", [{ id: "rs_46", type: "reasoning", summary: [] }]],
    [
      "multiple messages",
      [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "{}" }],
        },
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "{}" }],
        },
      ],
    ],
    ["tool output", [{ type: "function_call", name: "leak" }]],
    [
      "refusal",
      [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "refusal", refusal: "no" }],
        },
      ],
    ],
  ])("rejects %s output items", async (_name, output) => {
    const fetch = vi.fn().mockResolvedValue(response({ output }));
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 5_000,
    });
    await expect(adapter.translate(request)).rejects.toEqual({
      transient: false,
      code: "invalid_provider_response",
    });
  });

  it("does not follow an authenticated redirect", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302 }));
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 5_000,
    });
    await expect(adapter.translate(request)).rejects.toEqual({
      transient: false,
      code: "provider_http_error",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]!.redirect).toBe("error");
  });

  it("sanitizes segment objects before disclosure to the provider", async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 5_000,
    });

    await adapter.translate({
      ...request,
      segments: request.segments.map((segment) => ({
        ...segment,
        ownerIdentity: "must-not-leave-server",
        verificationDocument: "must-not-leave-server",
      })) as never,
    });

    const body = String(fetch.mock.calls[0]![1]!.body);
    expect(body).not.toContain("ownerIdentity");
    expect(body).not.toContain("verificationDocument");
    expect(body).not.toContain("must-not-leave-server");
  });

  it("rejects an oversized declared response and cancels its body", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    const fetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-length": "250001" },
      }),
    );
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 5_000,
    });

    await expect(adapter.translate(request)).rejects.toEqual({
      transient: false,
      code: "invalid_provider_response",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("enforces the response byte cap when Content-Length is absent", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(250_001));
      },
      cancel,
    });
    const fetch = vi.fn().mockResolvedValue(new Response(stream));
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 5_000,
    });

    await expect(adapter.translate(request)).rejects.toEqual({
      transient: false,
      code: "invalid_provider_response",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("keeps the timeout active while a streaming body is stalled", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 100,
    });

    const result = expect(adapter.translate(request)).rejects.toEqual({
      transient: true,
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(cancel).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("terminates even when stream cancellation never resolves", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const adapter = createOpenAIResponsesTranslationAdapter({
      apiKey: "server-secret",
      fetch,
      timeoutMilliseconds: 100,
    });
    const result = expect(adapter.translate(request)).rejects.toEqual({
      transient: true,
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(cancel).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
