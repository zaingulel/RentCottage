import { describe, expect, it, vi } from "vitest";

import {
  evaluateTranslationConfiguration,
  type TranslationEvaluationProtocol,
  type TranslationEvaluationRunner,
} from "./evaluation";

const protocol: TranslationEvaluationProtocol = {
  version: "translation-eval-v1",
  candidateModel: "gpt-5.6-luna",
  candidatePromptVersion: "v1",
  candidateInstructions: "Translate the supplied segments faithfully.",
  candidatePromptDigest:
    "15c1627e293e3f3b51313694b3b2978aeefda9f1831ad3bf711a826dc04b7657",
  judgeModel: "gpt-5.6-sol",
  judgeEffort: "medium",
  judgePromptVersion: "judge-v1",
  judgeInstructions: "Apply the locked translation rubric.",
  judgePromptDigest:
    "38425c2632730214051d6223d708894b450bc781e5f7fe46ce5477a1885e5ccb",
  candidateLowestSupportedEffort: "none",
  reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
  runsPerConfiguration: 3,
  medianThreshold: 0.9,
  minimumSampleScore: 0.85,
  maximumCriticalErrors: 0,
  candidateMaxInputTokens: 4096,
  candidateMaxOutputTokens: 512,
  candidateMaximumRequestBytes: 3000,
  judgeMaxInputTokens: 8192,
  judgeMaxOutputTokens: 128,
  judgeMaximumRequestBytes: 7000,
  providerFramingTokenAllowance: 512,
  maximumCandidateCallMicrousd: 10,
  maximumJudgeCallMicrousd: 5,
  candidateInputMicrousdPerMillion: 200000,
  candidateOutputMicrousdPerMillion: 1200000,
  judgeInputMicrousdPerMillion: 5000000,
  judgeOutputMicrousdPerMillion: 30000000,
  calibrationDigest: "a".repeat(64),
  nativeReviewerSetDigest: "b".repeat(64),
};

const samples = [
  {
    id: "sample-ar-description",
    sourceLanguage: "en" as const,
    targetLanguage: "ar" as const,
    provenance: "synthetic" as const,
    segments: [
      {
        key: "description",
        kind: "cottage_description" as const,
        text: "A quiet cottage near Shaqlawa.",
      },
    ],
    reference: [{ key: "description", text: "كوخ هادئ قرب شقلاوة." }],
  },
  {
    id: "sample-ckb-rules",
    sourceLanguage: "en" as const,
    targetLanguage: "ckb" as const,
    provenance: "reviewer_authored" as const,
    segments: [
      { key: "houseRules", kind: "house_rules" as const, text: "No smoking." },
    ],
    reference: [{ key: "houseRules", text: "جگەرەکێشان قەدەغەیە." }],
  },
];

function runner(scoreForRequest: (effort: string, sampleId: string) => number) {
  const pending: Array<{ effort: string; sampleId: string }> = [];
  const runCandidate = vi.fn(async (request) => {
    pending.push({ effort: request.effort, sampleId: "" });
    return {
      segments: request.segments.map(
        (segment: { key: string; text: string }) => ({
          key: segment.key,
          text: `translated:${segment.text}`,
        }),
      ),
      provenance: {
        model: request.model,
        effort: request.effort,
        promptVersion: request.promptVersion,
        promptDigest: request.promptDigest,
      },
      costMicrousd: 10,
    };
  });
  const runJudge = vi.fn(async (request) => {
    const candidate = pending.shift() ?? { effort: "", sampleId: "" };
    candidate.sampleId = request.sampleId;
    return {
      score: scoreForRequest(candidate.effort, candidate.sampleId),
      criticalErrors: 0,
      provenance: {
        model: request.model,
        effort: request.effort,
        promptVersion: request.promptVersion,
        promptDigest: request.promptDigest,
      },
      costMicrousd: 5,
    };
  });
  return {
    runCandidate,
    runJudge,
  } as unknown as TranslationEvaluationRunner & {
    runCandidate: typeof runCandidate;
    runJudge: typeof runJudge;
  };
}

describe("translation evaluation harness", () => {
  it.each([
    { apiKey: "" },
    { maximumSpendMicrousd: 0 },
    { protocol: { ...protocol, calibrationDigest: "missing" } },
    {
      protocol: {
        ...protocol,
        candidateInstructions: "Changed without approving its digest.",
      },
    },
    { protocol: { ...protocol, runsPerConfiguration: 1 } },
    {
      protocol: {
        ...protocol,
        candidateMaximumRequestBytes:
          protocol.candidateMaxInputTokens -
          protocol.providerFramingTokenAllowance +
          1,
      },
    },
    {
      protocol: {
        ...protocol,
        judgeMaximumRequestBytes:
          protocol.judgeMaxInputTokens -
          protocol.providerFramingTokenAllowance +
          1,
      },
    },
    {
      protocol: {
        ...protocol,
        reasoningEfforts: ["max", "none"],
      } as TranslationEvaluationProtocol,
    },
    {
      protocol: {
        ...protocol,
        candidateLowestSupportedEffort: "low",
      } as TranslationEvaluationProtocol,
    },
    { samples: [{ ...samples[0], provenance: "production" as never }] },
    { samples: [{ ...samples[0], targetLanguage: "ku" as never }] },
    {
      samples: [
        {
          ...samples[0],
          segments: [
            {
              ...samples[0].segments[0],
              kind: "verification_document" as never,
            },
          ],
        },
      ],
    },
  ])("fails preflight before any paid call", async (change) => {
    const evaluationRunner = runner(() => 1);
    const invalidInput = change as {
      apiKey?: string;
      maximumSpendMicrousd?: number;
      protocol?: TranslationEvaluationProtocol;
      samples?: typeof samples;
    };
    await expect(
      evaluateTranslationConfiguration({
        apiKey: invalidInput.apiKey ?? "server-key",
        maximumSpendMicrousd: invalidInput.maximumSpendMicrousd ?? 10_000,
        protocol: invalidInput.protocol ?? protocol,
        samples: invalidInput.samples ?? samples,
        runner: evaluationRunner,
      }),
    ).rejects.toThrow("Translation evaluation preflight failed");
    expect(evaluationRunner.runCandidate).not.toHaveBeenCalled();
    expect(evaluationRunner.runJudge).not.toHaveBeenCalled();
  });

  it("selects the first cheapest effort whose median clears the frozen threshold", async () => {
    const evaluationRunner = runner((effort) =>
      effort === "none" ? 0.8 : 0.95,
    );
    const artifact = await evaluateTranslationConfiguration({
      apiKey: "server-key",
      maximumSpendMicrousd: 10_000,
      protocol,
      samples,
      runner: evaluationRunner,
    });

    expect(artifact).toMatchObject({
      protocolVersion: "translation-eval-v1",
      selected: {
        model: "gpt-5.6-luna",
        effort: "low",
        promptVersion: "v1",
      },
      runsPerConfiguration: 3,
      sampleCount: 2,
      criticalErrors: 0,
      pass: true,
    });
    expect(artifact.protocolDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.sampleSetDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.artifactDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact).toMatchObject({
      judge: {
        model: "gpt-5.6-sol",
        effort: "medium",
        promptVersion: "judge-v1",
        promptDigest: protocol.judgePromptDigest,
      },
      evaluated: [
        {
          samples: [
            { sampleDigest: expect.stringMatching(/^[0-9a-f]{64}$/) },
            { sampleDigest: expect.stringMatching(/^[0-9a-f]{64}$/) },
          ],
        },
        {
          samples: [
            { sampleDigest: expect.stringMatching(/^[0-9a-f]{64}$/) },
            { sampleDigest: expect.stringMatching(/^[0-9a-f]{64}$/) },
          ],
        },
      ],
    });
    expect(evaluationRunner.runCandidate).toHaveBeenCalledTimes(12);
    expect(evaluationRunner.runJudge).toHaveBeenCalledTimes(12);
    expect(
      evaluationRunner.runCandidate.mock.calls.map(([call]) => call.effort),
    ).toEqual([...Array(6).fill("none"), ...Array(6).fill("low")]);
    for (const [judgeRequest] of evaluationRunner.runJudge.mock.calls) {
      expect(judgeRequest).not.toHaveProperty("candidateModel");
      expect(judgeRequest).not.toHaveProperty("candidatePromptVersion");
      expect(judgeRequest.candidateId).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(JSON.stringify(artifact)).not.toContain("quiet cottage");
    expect(JSON.stringify(artifact)).not.toContain("No smoking");
  });

  it("rejects a passing median when any run has a critical error", async () => {
    const evaluationRunner = runner(() => 1);
    evaluationRunner.runJudge.mockResolvedValueOnce({
      score: 1,
      criticalErrors: 1,
      provenance: {
        model: "gpt-5.6-sol",
        effort: "medium",
        promptVersion: "judge-v1",
        promptDigest: protocol.judgePromptDigest,
      },
      costMicrousd: 5,
    });

    const artifact = await evaluateTranslationConfiguration({
      apiKey: "server-key",
      maximumSpendMicrousd: 100_000,
      protocol,
      samples,
      runner: evaluationRunner,
    });

    expect(artifact.selected).toEqual({
      model: "gpt-5.6-luna",
      effort: "low",
      promptVersion: "v1",
      promptDigest: protocol.candidatePromptDigest,
    });
  });

  it("requires every sample stratum to clear the frozen floor", async () => {
    const evaluationRunner = runner((_effort, sampleId) =>
      sampleId.includes("ckb") ? 0.8 : 1,
    );
    const artifact = await evaluateTranslationConfiguration({
      apiKey: "server-key",
      maximumSpendMicrousd: 100_000,
      protocol: { ...protocol, reasoningEfforts: ["none"] },
      samples,
      runner: evaluationRunner,
    });

    expect(artifact.selected).toBeNull();
    expect(artifact.evaluated).toEqual([
      expect.objectContaining({
        effort: "none",
        medianScore: 0.9,
        minimumSampleMedian: 0.8,
        criticalErrors: 0,
      }),
    ]);
  });

  it("accepts approved replacement models, prompts and ordered effort ladders", async () => {
    const evaluationRunner = runner((effort) =>
      effort === "medium" ? 0.8 : 0.95,
    );
    const replacement = {
      ...protocol,
      version: "translation-eval-v2",
      candidateModel: "approved-candidate-snapshot",
      candidatePromptVersion: "candidate-v2",
      candidateInstructions: "Use the approved replacement prompt.",
      candidatePromptDigest:
        "6dc10999e02ec24dfea40336a10a54439882c12b090ded6862b3d3634b992c82",
      judgeModel: "approved-judge-snapshot",
      judgeEffort: "high" as const,
      judgePromptVersion: "judge-v2",
      judgeInstructions: "Use the approved replacement rubric.",
      judgePromptDigest:
        "159c8e35773033c5d5f1c87df906b69ee8b01ef961bfef36fc34393861799e47",
      candidateLowestSupportedEffort: "medium" as const,
      reasoningEfforts: ["medium", "high"] as const,
    };

    const artifact = await evaluateTranslationConfiguration({
      apiKey: "server-key",
      maximumSpendMicrousd: 100_000,
      protocol: replacement as unknown as TranslationEvaluationProtocol,
      samples,
      runner: evaluationRunner,
    });

    expect(artifact.selected).toEqual({
      model: "approved-candidate-snapshot",
      effort: "high",
      promptVersion: "candidate-v2",
      promptDigest: replacement.candidatePromptDigest,
    });
    expect(evaluationRunner.runJudge).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: "approved-judge-snapshot",
        effort: "high",
        promptVersion: "judge-v2",
        promptDigest: replacement.judgePromptDigest,
      }),
    );
  });

  it("binds successful artifact evidence to frozen samples, scores and judge", async () => {
    const first = await evaluateTranslationConfiguration({
      apiKey: "server-key",
      maximumSpendMicrousd: 100_000,
      protocol: { ...protocol, reasoningEfforts: ["none"] },
      samples,
      runner: runner(() => 0.95),
    });
    const changedScore = await evaluateTranslationConfiguration({
      apiKey: "server-key",
      maximumSpendMicrousd: 100_000,
      protocol: { ...protocol, reasoningEfforts: ["none"] },
      samples,
      runner: runner(() => 0.96),
    });
    const changedJudge = await evaluateTranslationConfiguration({
      apiKey: "server-key",
      maximumSpendMicrousd: 100_000,
      protocol: {
        ...protocol,
        reasoningEfforts: ["none"],
        judgePromptVersion: "judge-v2",
      },
      samples,
      runner: runner(() => 0.95),
    });

    expect(first.artifactDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(changedScore.artifactDigest).not.toBe(first.artifactDigest);
    expect(changedJudge.artifactDigest).not.toBe(first.artifactDigest);
  });

  it("stops before a call that could exceed the approved spend ceiling", async () => {
    const evaluationRunner = runner(() => 0);
    await expect(
      evaluateTranslationConfiguration({
        apiKey: "server-key",
        maximumSpendMicrousd: 20,
        protocol,
        samples,
        runner: evaluationRunner,
      }),
    ).rejects.toThrow("Translation evaluation spend ceiling reached");
    expect(evaluationRunner.runCandidate).toHaveBeenCalledTimes(1);
    expect(evaluationRunner.runJudge).toHaveBeenCalledTimes(1);
  });
});
