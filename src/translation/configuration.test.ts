import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { readTranslationConfiguration } from "./configuration";
import {
  defaultTranslationJudgePromptV1,
  defaultTranslationPromptV1,
} from "./translation-request";

vi.mock("server-only", () => ({}));

const ordinaryBase = {
  model: "gpt-5.6-luna",
  effort: "none",
  promptVersion: "v1",
};
const judgeBase = {
  model: "gpt-5.6-sol",
  effort: "medium",
  promptVersion: "judge-v1",
};
const strongerBase = {
  model: "gpt-5.6-terra",
  effort: "none",
  promptVersion: "v1",
};

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function digestText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function resolvedRoute(
  route: { model: string; effort: string; promptVersion: string },
  promptContent: string,
) {
  return { ...route, promptContent, promptDigest: digestText(promptContent) };
}

const ordinary = resolvedRoute(ordinaryBase, defaultTranslationPromptV1);
const strongerModel = resolvedRoute(strongerBase, defaultTranslationPromptV1);
const judge = resolvedRoute(judgeBase, defaultTranslationJudgePromptV1);

function evidence(
  selected = ordinaryBase,
  stronger = strongerBase,
  evaluationJudge = judgeBase,
  protocolDigest = "c".repeat(64),
  artifactDigest = "a".repeat(64),
  prompts = {
    ordinary: defaultTranslationPromptV1,
    strongerModel: defaultTranslationPromptV1,
    judge: defaultTranslationJudgePromptV1,
  },
  providerFramingTokenAllowance = 512,
) {
  const promptDigests = {
    ordinary: digestText(prompts.ordinary),
    strongerModel: digestText(prompts.strongerModel),
    judge: digestText(prompts.judge),
  };
  const approvalRoute = (
    route: { model: string; effort: string; promptVersion: string },
    promptDigest: string,
  ) => ({ ...route, promptDigest });
  return {
    TRANSLATION_EVALUATION_PROTOCOL_DIGEST: protocolDigest,
    TRANSLATION_APPROVED_EVALUATION_ARTIFACT_DIGEST: artifactDigest,
    TRANSLATION_PRODUCTION_APPROVAL_DIGEST: digest({
      approvedArtifactDigest: artifactDigest,
      ordinary: approvalRoute(selected, promptDigests.ordinary),
      strongerModel: approvalRoute(stronger, promptDigests.strongerModel),
      judge: approvalRoute(evaluationJudge, promptDigests.judge),
      protocolDigest,
      promptDigests,
      providerFramingTokenAllowance,
    }),
  };
}

const approved = {
  OPENAI_API_KEY: "server-key",
  TRANSLATION_PROVIDER_TERMS_APPROVED: "true",
  TRANSLATION_NATIVE_REVIEW_APPROVED: "true",
  TRANSLATION_QUALITY_THRESHOLD_APPROVED: "true",
  ...evidence(),
  TRANSLATION_MONTHLY_REQUEST_LIMIT: "1000",
  TRANSLATION_MONTHLY_TOKEN_LIMIT: "1000000",
  TRANSLATION_MONTHLY_SPEND_MICROUSD_LIMIT: "50000000",
  TRANSLATION_RESERVATION_MICROUSD: "10000",
  TRANSLATION_MAXIMUM_ATTEMPTS: "3",
  TRANSLATION_TIMEOUT_MILLISECONDS: "15000",
  TRANSLATION_MAXIMUM_SEGMENT_CHARACTERS: "2000",
  TRANSLATION_MAXIMUM_REQUEST_BYTES: "3000",
  TRANSLATION_MAXIMUM_INPUT_TOKENS: "4096",
  TRANSLATION_PROVIDER_FRAMING_TOKEN_ALLOWANCE: "512",
  TRANSLATION_MAXIMUM_OUTPUT_TOKENS: "512",
  TRANSLATION_INPUT_MICROUSD_PER_MILLION: "200000",
  TRANSLATION_OUTPUT_MICROUSD_PER_MILLION: "1200000",
};

describe("translation configuration", () => {
  it.each([
    "OPENAI_API_KEY",
    "TRANSLATION_PROVIDER_TERMS_APPROVED",
    "TRANSLATION_NATIVE_REVIEW_APPROVED",
    "TRANSLATION_QUALITY_THRESHOLD_APPROVED",
    "TRANSLATION_APPROVED_EVALUATION_ARTIFACT_DIGEST",
    "TRANSLATION_PRODUCTION_APPROVAL_DIGEST",
    "TRANSLATION_EVALUATION_PROTOCOL_DIGEST",
    "TRANSLATION_MONTHLY_REQUEST_LIMIT",
    "TRANSLATION_MONTHLY_TOKEN_LIMIT",
    "TRANSLATION_MONTHLY_SPEND_MICROUSD_LIMIT",
    "TRANSLATION_RESERVATION_MICROUSD",
    "TRANSLATION_MAXIMUM_REQUEST_BYTES",
    "TRANSLATION_MAXIMUM_INPUT_TOKENS",
    "TRANSLATION_PROVIDER_FRAMING_TOKEN_ALLOWANCE",
    "TRANSLATION_MAXIMUM_OUTPUT_TOKENS",
    "TRANSLATION_INPUT_MICROUSD_PER_MILLION",
    "TRANSLATION_OUTPUT_MICROUSD_PER_MILLION",
  ] as const)("fails closed when %s is absent", (key) => {
    const source = { ...approved, [key]: undefined };
    expect(readTranslationConfiguration(source)).toEqual({
      enabled: false,
      code: "configuration_unavailable",
    });
  });

  it("starts ordinary translation at Luna none and keeps the stronger and judge routes replaceable", () => {
    expect(readTranslationConfiguration(approved)).toEqual({
      enabled: true,
      provider: "openai",
      apiKey: "server-key",
      ordinary,
      strongerModel,
      judge,
      evidence: {
        approvedArtifactDigest:
          approved.TRANSLATION_APPROVED_EVALUATION_ARTIFACT_DIGEST,
        productionApprovalDigest:
          approved.TRANSLATION_PRODUCTION_APPROVAL_DIGEST,
        protocolDigest: "c".repeat(64),
        promptDigests: {
          ordinary: digestText(defaultTranslationPromptV1),
          strongerModel: digestText(defaultTranslationPromptV1),
          judge: digestText(defaultTranslationJudgePromptV1),
        },
      },
      limits: {
        maximumAttempts: 3,
        timeoutMilliseconds: 15000,
        maximumSegmentCharacters: 2000,
        maximumRequestBytes: 3000,
        maximumInputTokens: 4096,
        providerFramingTokenAllowance: 512,
        maximumOutputTokens: 512,
        inputMicrousdPerMillion: 200000,
        outputMicrousdPerMillion: 1200000,
        reservationMicrousd: 10000,
        monthlyRequests: 1000,
        monthlyTokens: 1000000,
        monthlyMicrousd: 50000000,
      },
    });
  });

  it("marks secret-bearing production modules as server-only", () => {
    for (const path of [
      "src/translation/configuration.ts",
      "src/translation/openai-responses.ts",
    ]) {
      expect(readFileSync(path, "utf8")).toMatch(/^import "server-only";/);
    }
  });

  it("accepts validated replaceable model, effort, prompt and judge choices", () => {
    const replacementOrdinary = {
      model: "approved-luna-snapshot",
      effort: "low",
      promptVersion: "v2",
    };
    const replacementJudge = {
      model: "approved-sol-snapshot",
      effort: "xhigh",
      promptVersion: "judge-v2",
    };
    const result = readTranslationConfiguration({
      ...approved,
      ...evidence(
        replacementOrdinary,
        {
          model: "approved-terra-snapshot",
          effort: "high",
          promptVersion: "v2",
        },
        replacementJudge,
      ),
      TRANSLATION_ORDINARY_MODEL: "approved-luna-snapshot",
      TRANSLATION_ORDINARY_EFFORT: "low",
      TRANSLATION_ORDINARY_PROMPT_VERSION: "v2",
      TRANSLATION_STRONGER_MODEL: "approved-terra-snapshot",
      TRANSLATION_STRONGER_EFFORT: "high",
      TRANSLATION_STRONGER_PROMPT_VERSION: "v2",
      TRANSLATION_JUDGE_MODEL: "approved-sol-snapshot",
      TRANSLATION_JUDGE_EFFORT: "xhigh",
      TRANSLATION_JUDGE_PROMPT_VERSION: "judge-v2",
    });

    expect(result).toMatchObject({
      enabled: true,
      ordinary: {
        model: "approved-luna-snapshot",
        effort: "low",
        promptVersion: "v2",
      },
      strongerModel: {
        model: "approved-terra-snapshot",
        effort: "high",
        promptVersion: "v2",
      },
      judge: {
        model: "approved-sol-snapshot",
        effort: "xhigh",
        promptVersion: "judge-v2",
      },
    });
  });

  it.each([
    { TRANSLATION_ORDINARY_MODEL: "unapproved-model" },
    { TRANSLATION_ORDINARY_EFFORT: "low" },
    { TRANSLATION_ORDINARY_PROMPT_VERSION: "v2" },
    { TRANSLATION_STRONGER_MODEL: "unapproved-stronger" },
    { TRANSLATION_STRONGER_EFFORT: "high" },
    { TRANSLATION_STRONGER_PROMPT_VERSION: "v2" },
    { TRANSLATION_JUDGE_MODEL: "unapproved-judge" },
    { TRANSLATION_JUDGE_EFFORT: "high" },
    { TRANSLATION_JUDGE_PROMPT_VERSION: "judge-v2" },
    { TRANSLATION_EVALUATION_PROTOCOL_DIGEST: "d".repeat(64) },
    { TRANSLATION_APPROVED_EVALUATION_ARTIFACT_DIGEST: "b".repeat(64) },
    { TRANSLATION_ORDINARY_PROMPT_CONTENT: "changed prompt content" },
    { TRANSLATION_STRONGER_PROMPT_CONTENT: "changed stronger prompt" },
    { TRANSLATION_JUDGE_PROMPT_CONTENT: "changed judge prompt" },
    { TRANSLATION_PROVIDER_FRAMING_TOKEN_ALLOWANCE: "256" },
  ])(
    "invalidates approval evidence when active configuration changes",
    (change) => {
      expect(readTranslationConfiguration({ ...approved, ...change })).toEqual({
        enabled: false,
        code: "configuration_unavailable",
      });
    },
  );

  it.each([
    { TRANSLATION_ORDINARY_EFFORT: "minimal" },
    { TRANSLATION_MAXIMUM_ATTEMPTS: "0" },
    { TRANSLATION_TIMEOUT_MILLISECONDS: "300000" },
    { TRANSLATION_MONTHLY_REQUEST_LIMIT: "-1" },
    { TRANSLATION_MAXIMUM_REQUEST_BYTES: "4000" },
    { TRANSLATION_APPROVED_EVALUATION_ARTIFACT_DIGEST: "not-a-digest" },
    { NEXT_PUBLIC_OPENAI_API_KEY: "leaked" },
  ])("fails closed for malformed or exposed configuration", (change) => {
    expect(readTranslationConfiguration({ ...approved, ...change })).toEqual({
      enabled: false,
      code: "configuration_unavailable",
    });
  });
});
