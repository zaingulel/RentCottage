import { describe, expect, it, vi } from "vitest";

import { createOpenAIEvaluationRunner } from "./openai-evaluation-runner";

function providerResponse({
  model,
  output,
  inputTokens,
  outputTokens,
}: {
  model: string;
  output: unknown;
  inputTokens: number;
  outputTokens: number;
}) {
  return new Response(
    JSON.stringify({
      id: "resp_eval",
      status: "completed",
      model,
      output: [
        {
          id: model.includes("sol") ? "rs_sol" : "rs_luna",
          type: "reasoning",
          summary: [],
        },
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
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const pricing = {
  candidateInputMicrousdPerMillion: 200000,
  candidateOutputMicrousdPerMillion: 1200000,
  judgeInputMicrousdPerMillion: 5000000,
  judgeOutputMicrousdPerMillion: 30000000,
};
const bounds = {
  candidate: {
    maximumInputTokens: 4_096,
    providerFramingTokenAllowance: 512,
    maximumOutputTokens: 512,
    maximumRequestBytes: 3_000,
    maximumCallMicrousd: 100_000,
  },
  judge: {
    maximumInputTokens: 8_192,
    providerFramingTokenAllowance: 512,
    maximumOutputTokens: 128,
    maximumRequestBytes: 7_000,
    maximumCallMicrousd: 100_000,
  },
};

describe("OpenAI translation evaluation runner", () => {
  it("runs a candidate and blinded Sol judge through separate strict Responses calls", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        providerResponse({
          model: "gpt-5.6-luna",
          output: {
            segments: [{ key: "description", text: "كوخ هادئ" }],
          },
          inputTokens: 100,
          outputTokens: 50,
        }),
      )
      .mockResolvedValueOnce(
        providerResponse({
          model: "gpt-5.6-sol",
          output: { score: 0.94, criticalErrors: 0 },
          inputTokens: 200,
          outputTokens: 20,
        }),
      );
    const runner = createOpenAIEvaluationRunner({
      fetch,
      timeoutMilliseconds: 5_000,
      pricing,
      ...bounds,
    });
    const source = [
      {
        key: "description",
        kind: "cottage_description" as const,
        text: "A quiet cottage",
        ownerIdentity: "must-not-leave-server",
      },
    ] as never;

    await expect(
      runner.runCandidate({
        apiKey: "server-key",
        model: "gpt-5.6-luna",
        effort: "none",
        promptVersion: "v1",
        promptContent: "Translate with the approved candidate prompt.",
        promptDigest: "candidate-prompt-digest",
        sourceLanguage: "en",
        targetLanguage: "ar",
        segments: source,
      }),
    ).resolves.toEqual({
      segments: [{ key: "description", text: "كوخ هادئ" }],
      provenance: {
        model: "gpt-5.6-luna",
        effort: "none",
        promptVersion: "v1",
        promptDigest: "candidate-prompt-digest",
      },
      costMicrousd: 80,
    });
    await expect(
      runner.runJudge({
        apiKey: "server-key",
        model: "gpt-5.6-sol",
        effort: "medium",
        promptVersion: "judge-v1",
        promptContent: "Apply the approved judge rubric.",
        promptDigest: "judge-prompt-digest",
        candidateId: "0123456789abcdef",
        sampleId: "ar-description",
        sourceLanguage: "en",
        targetLanguage: "ar",
        source,
        answers: [
          {
            id: "0123456789abcdef",
            segments: [
              {
                key: "description",
                text: "كوخ هادئ",
                verificationDocument: "must-not-leave-server",
              },
            ] as never,
          },
          {
            id: "fedcba9876543210",
            segments: [{ key: "description", text: "كوخ هادئ" }],
          },
        ],
      }),
    ).resolves.toEqual({
      score: 0.94,
      criticalErrors: 0,
      provenance: {
        model: "gpt-5.6-sol",
        effort: "medium",
        promptVersion: "judge-v1",
        promptDigest: "judge-prompt-digest",
      },
      costMicrousd: 1600,
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]![1]!.redirect).toBe("error");
    expect(fetch.mock.calls[1]![1]!.redirect).toBe("error");
    const candidateBody = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
    const judgeBody = JSON.parse(String(fetch.mock.calls[1]![1]!.body));
    expect(candidateBody).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      background: false,
      tools: [],
      reasoning: { effort: "none", context: "current_turn" },
      max_output_tokens: 512,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(candidateBody.instructions).toBe(
      "Translate with the approved candidate prompt.",
    );
    expect(judgeBody).toMatchObject({
      model: "gpt-5.6-sol",
      store: false,
      background: false,
      tools: [],
      reasoning: { effort: "medium", context: "current_turn" },
      max_output_tokens: 128,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(judgeBody.instructions).toBe("Apply the approved judge rubric.");
    const judgePayload = JSON.stringify(judgeBody.input);
    expect(judgePayload).not.toContain("gpt-5.6-luna");
    expect(judgePayload).not.toContain('"effort":"none"');
    expect(judgePayload).not.toContain('"promptVersion":"v1"');
    expect(judgePayload).toContain("0123456789abcdef");
    expect(JSON.stringify(candidateBody)).not.toContain("ownerIdentity");
    expect(JSON.stringify(candidateBody)).not.toContain(
      "must-not-leave-server",
    );
    expect(JSON.stringify(judgeBody)).not.toContain("verificationDocument");
    expect(JSON.stringify(judgeBody)).not.toContain("must-not-leave-server");
  });

  it("fails on malformed judge output without retrying or logging content", async () => {
    const fetch = vi.fn().mockResolvedValue(
      providerResponse({
        model: "gpt-5.6-sol",
        output: { score: 2, criticalErrors: 0 },
        inputTokens: 10,
        outputTokens: 10,
      }),
    );
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const runner = createOpenAIEvaluationRunner({
      fetch,
      timeoutMilliseconds: 5_000,
      pricing,
      ...bounds,
    });

    await expect(
      runner.runJudge({
        apiKey: "server-key",
        model: "gpt-5.6-sol",
        effort: "medium",
        promptVersion: "judge-v1",
        promptContent: "Apply the approved judge rubric.",
        promptDigest: "judge-prompt-digest",
        candidateId: "0123456789abcdef",
        sampleId: "ar-description",
        sourceLanguage: "en",
        targetLanguage: "ar",
        source: [],
        answers: [],
      }),
    ).rejects.toThrow("Translation evaluation provider response is invalid");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("rejects a worst-case call exceeding its reservation before fetch", async () => {
    const fetch = vi.fn();
    const runner = createOpenAIEvaluationRunner({
      fetch,
      timeoutMilliseconds: 5_000,
      pricing,
      candidate: { ...bounds.candidate, maximumCallMicrousd: 1 },
      judge: bounds.judge,
    });

    await expect(
      runner.runCandidate({
        apiKey: "server-key",
        model: "approved-candidate",
        effort: "none",
        promptVersion: "candidate-v2",
        promptContent: "Translate with the approved candidate prompt.",
        promptDigest: "candidate-prompt-digest",
        sourceLanguage: "en",
        targetLanguage: "ar",
        segments: [
          {
            key: "description",
            kind: "cottage_description",
            text: "A quiet cottage",
          },
        ],
      }),
    ).rejects.toThrow("Translation evaluation provider response is invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects provider usage above the configured output-token bound", async () => {
    const fetch = vi.fn().mockResolvedValue(
      providerResponse({
        model: "approved-judge",
        output: { score: 0.9, criticalErrors: 0 },
        inputTokens: 20,
        outputTokens: 129,
      }),
    );
    const runner = createOpenAIEvaluationRunner({
      fetch,
      timeoutMilliseconds: 5_000,
      pricing,
      ...bounds,
    });

    await expect(
      runner.runJudge({
        apiKey: "server-key",
        model: "approved-judge",
        effort: "medium",
        promptVersion: "judge-v2",
        promptContent: "Apply the approved judge rubric.",
        promptDigest: "judge-prompt-digest",
        candidateId: "0123456789abcdef",
        sampleId: "ar-description",
        sourceLanguage: "en",
        targetLanguage: "ar",
        source: [],
        answers: [],
      }),
    ).rejects.toThrow("Translation evaluation provider response is invalid");
  });

  it("rejects provider usage above the configured input-token bound", async () => {
    const fetch = vi.fn().mockResolvedValue(
      providerResponse({
        model: "approved-judge",
        output: { score: 0.9, criticalErrors: 0 },
        inputTokens: bounds.judge.maximumInputTokens + 1,
        outputTokens: 1,
      }),
    );
    const runner = createOpenAIEvaluationRunner({
      fetch,
      timeoutMilliseconds: 5_000,
      pricing,
      ...bounds,
    });
    await expect(
      runner.runJudge({
        apiKey: "server-key",
        model: "approved-judge",
        effort: "medium",
        promptVersion: "judge-v2",
        promptContent: "Apply the approved judge rubric.",
        promptDigest: "judge-prompt-digest",
        candidateId: "0123456789abcdef",
        sampleId: "ar-description",
        sourceLanguage: "en",
        targetLanguage: "ar",
        source: [],
        answers: [],
      }),
    ).rejects.toThrow("Translation evaluation provider response is invalid");
  });

  it("does not follow a judge redirect with the API credential", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302 }));
    const runner = createOpenAIEvaluationRunner({
      fetch,
      timeoutMilliseconds: 5_000,
      pricing,
      ...bounds,
    });
    await expect(
      runner.runJudge({
        apiKey: "server-key",
        model: "approved-judge",
        effort: "medium",
        promptVersion: "judge-v2",
        promptContent: "Apply the approved judge rubric.",
        promptDigest: "judge-prompt-digest",
        candidateId: "0123456789abcdef",
        sampleId: "ar-description",
        sourceLanguage: "en",
        targetLanguage: "ar",
        source: [],
        answers: [],
      }),
    ).rejects.toThrow("Translation evaluation provider is unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]!.redirect).toBe("error");
  });

  it("rejects an oversized declared judge response and cancels its body", async () => {
    const cancel = vi.fn();
    const fetch = vi.fn().mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        headers: { "content-length": "250001" },
      }),
    );
    const runner = createOpenAIEvaluationRunner({
      fetch,
      timeoutMilliseconds: 5_000,
      pricing,
      ...bounds,
    });

    await expect(
      runner.runJudge({
        apiKey: "server-key",
        model: "approved-judge",
        effort: "medium",
        promptVersion: "judge-v2",
        promptContent: "Apply the approved judge rubric.",
        promptDigest: "judge-prompt-digest",
        candidateId: "0123456789abcdef",
        sampleId: "ar-description",
        sourceLanguage: "en",
        targetLanguage: "ar",
        source: [],
        answers: [],
      }),
    ).rejects.toThrow("Translation evaluation provider response is invalid");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("keeps the timeout active while the judge response body is stalled", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const runner = createOpenAIEvaluationRunner({
      fetch,
      timeoutMilliseconds: 100,
      pricing,
      ...bounds,
    });

    const result = expect(
      runner.runJudge({
        apiKey: "server-key",
        model: "approved-judge",
        effort: "medium",
        promptVersion: "judge-v2",
        promptContent: "Apply the approved judge rubric.",
        promptDigest: "judge-prompt-digest",
        candidateId: "0123456789abcdef",
        sampleId: "ar-description",
        sourceLanguage: "en",
        targetLanguage: "ar",
        source: [],
        answers: [],
      }),
    ).rejects.toThrow("Translation evaluation provider is unavailable");
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(cancel).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
