import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { main } from "./evaluation-cli";
import type { TranslationEvaluationProtocol } from "./evaluation";

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
  maximumCandidateCallMicrousd: 25000,
  maximumJudgeCallMicrousd: 100000,
  candidateInputMicrousdPerMillion: 200000,
  candidateOutputMicrousdPerMillion: 1200000,
  judgeInputMicrousdPerMillion: 5000000,
  judgeOutputMicrousdPerMillion: 30000000,
  calibrationDigest: "a".repeat(64),
  nativeReviewerSetDigest: "b".repeat(64),
};

const samples = [
  {
    id: "ar-description",
    sourceLanguage: "en",
    targetLanguage: "ar",
    provenance: "synthetic",
    segments: [
      {
        key: "description",
        kind: "cottage_description",
        text: "A quiet cottage",
      },
    ],
    reference: [{ key: "description", text: "كوخ هادئ" }],
  },
];

function response(model: string, output: unknown) {
  return new Response(
    JSON.stringify({
      status: "completed",
      model,
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
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    }),
    { status: 200 },
  );
}

function dependencies({
  environment = { OPENAI_API_KEY: "server-key" },
  protocolValue = protocol,
  sampleValue = samples,
}: {
  environment?: Record<string, string | undefined>;
  protocolValue?: unknown;
  sampleValue?: unknown;
} = {}) {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    return body.model === "gpt-5.6-sol"
      ? response("gpt-5.6-sol", { score: 0.95, criticalErrors: 0 })
      : response("gpt-5.6-luna", {
          segments: [{ key: "description", text: "كوخ هادئ" }],
        });
  });
  const stdout = vi.fn();
  const stderr = vi.fn();
  return {
    fetch,
    stdout,
    stderr,
    options: {
      environment,
      fetch,
      stdout,
      stderr,
      readFile: vi.fn(async (url: URL) =>
        JSON.stringify(
          url.pathname.endsWith("protocol-v1.json")
            ? protocolValue
            : sampleValue,
        ),
      ),
    },
  };
}

describe("translation evaluation command", () => {
  it("requires the API key and caller-approved maximum spend before network access", async () => {
    const missingKey = dependencies({ environment: {} });
    await expect(
      main(["--max-spend-microusd", "1000000"], missingKey.options),
    ).resolves.toBe(2);
    expect(missingKey.fetch).not.toHaveBeenCalled();

    const missingSpend = dependencies();
    await expect(main([], missingSpend.options)).resolves.toBe(2);
    expect(missingSpend.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [
      "production export flag",
      ["--max-spend-microusd", "1000000", "--production-export"],
    ],
    ["invalid spend", ["--max-spend-microusd", "0"]],
  ])("rejects %s before network access", async (_name, args) => {
    const command = dependencies();
    await expect(main(args, command.options)).resolves.toBe(2);
    expect(command.fetch).not.toHaveBeenCalled();
  });

  it("rejects production-derived fixtures and incomplete frozen evidence before network access", async () => {
    const production = dependencies({
      sampleValue: [{ ...samples[0], provenance: "production" }],
    });
    await expect(
      main(["--max-spend-microusd", "1000000"], production.options),
    ).resolves.toBe(2);
    expect(production.fetch).not.toHaveBeenCalled();

    const incomplete = dependencies({
      protocolValue: { ...protocol, nativeReviewerSetDigest: null },
    });
    await expect(
      main(["--max-spend-microusd", "1000000"], incomplete.options),
    ).resolves.toBe(2);
    expect(incomplete.fetch).not.toHaveBeenCalled();
  });

  it("prints only a digest-based artifact after the cheapest passing configuration", async () => {
    const command = dependencies();
    await expect(
      main(["--max-spend-microusd", "1000000"], command.options),
    ).resolves.toBe(0);

    expect(command.fetch).toHaveBeenCalledTimes(6);
    expect(command.stderr).not.toHaveBeenCalled();
    expect(command.stdout).toHaveBeenCalledTimes(1);
    const serialized = command.stdout.mock.calls[0]![0];
    const artifact = JSON.parse(serialized);
    expect(artifact).toMatchObject({
      selected: { model: "gpt-5.6-luna", effort: "none", promptVersion: "v1" },
      sampleCount: 1,
      runsPerConfiguration: 3,
    });
    expect(artifact.protocolDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.sampleSetDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.artifactDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(serialized).not.toContain("A quiet cottage");
    expect(serialized).not.toContain("كوخ هادئ");
    expect(serialized).not.toContain("server-key");
  });

  it("exposes the bounded command through package.json", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    expect(packageJson.scripts["evaluate:translation"]).toBe(
      "node --experimental-strip-types src/translation/evaluation-cli.ts",
    );
  });

  it("starts as a Node TypeScript entrypoint and fails closed on the unfrozen repository protocol", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "src/translation/evaluation-cli.ts",
        "--max-spend-microusd",
        "1000000",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          OPENAI_API_KEY: "deliberately-invalid-not-used",
        },
      },
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Translation evaluation preflight failed\n");
  });
});
