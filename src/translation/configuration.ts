import "server-only";

import { createHash } from "node:crypto";

import type {
  TranslationConfiguration,
  TranslationRouteConfiguration,
} from "./translation.ts";
import { calculateMicrousd } from "./call-budget.ts";
import {
  defaultTranslationJudgePromptV1,
  defaultTranslationPromptV1,
} from "./translation-request.ts";

type Source = Record<string, string | undefined>;

export type TranslationRuntimeConfiguration =
  | Extract<TranslationConfiguration, { enabled: false }>
  | (Extract<TranslationConfiguration, { enabled: true }> & {
      apiKey: string;
      judge: TranslationRouteConfiguration;
      evidence: {
        approvedArtifactDigest: string;
        productionApprovalDigest: string;
        protocolDigest: string;
        promptDigests: {
          ordinary: string;
          strongerModel: string;
          judge: string;
        };
      };
      limits: Extract<TranslationConfiguration, { enabled: true }>["limits"] & {
        timeoutMilliseconds: number;
        monthlyRequests: number;
        monthlyTokens: number;
        monthlyMicrousd: number;
      };
    });

const efforts = new Set<TranslationRouteConfiguration["effort"]>([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const digestPattern = /^[0-9a-f]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function digestText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function positiveInteger(
  value: string | undefined,
  maximum = Number.MAX_SAFE_INTEGER,
): number | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : null;
}

function route(
  source: Source,
  prefix: string,
  defaults: Omit<
    TranslationRouteConfiguration,
    "promptContent" | "promptDigest"
  >,
  defaultPromptContent: string,
): TranslationRouteConfiguration | null {
  const model = source[`${prefix}_MODEL`] ?? defaults.model;
  const effort = source[`${prefix}_EFFORT`] ?? defaults.effort;
  const promptVersion =
    source[`${prefix}_PROMPT_VERSION`] ?? defaults.promptVersion;
  const promptContent =
    source[`${prefix}_PROMPT_CONTENT`] ?? defaultPromptContent;
  if (
    !identifierPattern.test(model) ||
    !efforts.has(effort as TranslationRouteConfiguration["effort"]) ||
    !identifierPattern.test(promptVersion) ||
    promptContent.trim().length === 0 ||
    promptContent.length > 10_000
  ) {
    return null;
  }
  return {
    model,
    effort: effort as TranslationRouteConfiguration["effort"],
    promptVersion,
    promptContent,
    promptDigest: digestText(promptContent),
  };
}

function disabled(): TranslationRuntimeConfiguration {
  return { enabled: false, code: "configuration_unavailable" };
}

export function readTranslationConfiguration(
  source: Source,
): TranslationRuntimeConfiguration {
  if (
    source.NEXT_PUBLIC_OPENAI_API_KEY ||
    source.NEXT_PUBLIC_TRANSLATION_PROVIDER_KEY ||
    !source.OPENAI_API_KEY ||
    /\s/.test(source.OPENAI_API_KEY) ||
    source.TRANSLATION_PROVIDER_TERMS_APPROVED !== "true" ||
    source.TRANSLATION_NATIVE_REVIEW_APPROVED !== "true" ||
    source.TRANSLATION_QUALITY_THRESHOLD_APPROVED !== "true"
  ) {
    return disabled();
  }

  const ordinary = route(
    source,
    "TRANSLATION_ORDINARY",
    { model: "gpt-5.6-luna", effort: "none", promptVersion: "v1" },
    defaultTranslationPromptV1,
  );
  const strongerModel = route(
    source,
    "TRANSLATION_STRONGER",
    { model: "gpt-5.6-terra", effort: "none", promptVersion: "v1" },
    defaultTranslationPromptV1,
  );
  const judge = route(
    source,
    "TRANSLATION_JUDGE",
    { model: "gpt-5.6-sol", effort: "medium", promptVersion: "judge-v1" },
    defaultTranslationJudgePromptV1,
  );
  const monthlyRequests = positiveInteger(
    source.TRANSLATION_MONTHLY_REQUEST_LIMIT,
  );
  const monthlyTokens = positiveInteger(source.TRANSLATION_MONTHLY_TOKEN_LIMIT);
  const monthlyMicrousd = positiveInteger(
    source.TRANSLATION_MONTHLY_SPEND_MICROUSD_LIMIT,
  );
  const reservationMicrousd = positiveInteger(
    source.TRANSLATION_RESERVATION_MICROUSD,
  );
  const maximumAttempts = positiveInteger(
    source.TRANSLATION_MAXIMUM_ATTEMPTS,
    5,
  );
  const timeoutMilliseconds = positiveInteger(
    source.TRANSLATION_TIMEOUT_MILLISECONDS,
    60_000,
  );
  const maximumSegmentCharacters = positiveInteger(
    source.TRANSLATION_MAXIMUM_SEGMENT_CHARACTERS,
    10_000,
  );
  const maximumRequestBytes = positiveInteger(
    source.TRANSLATION_MAXIMUM_REQUEST_BYTES,
    1_000_000,
  );
  const maximumInputTokens = positiveInteger(
    source.TRANSLATION_MAXIMUM_INPUT_TOKENS,
    1_050_000,
  );
  const providerFramingTokenAllowance = positiveInteger(
    source.TRANSLATION_PROVIDER_FRAMING_TOKEN_ALLOWANCE,
    128_000,
  );
  const maximumOutputTokens = positiveInteger(
    source.TRANSLATION_MAXIMUM_OUTPUT_TOKENS,
    128_000,
  );
  const inputMicrousdPerMillion = positiveInteger(
    source.TRANSLATION_INPUT_MICROUSD_PER_MILLION,
  );
  const outputMicrousdPerMillion = positiveInteger(
    source.TRANSLATION_OUTPUT_MICROUSD_PER_MILLION,
  );
  const protocolDigest = source.TRANSLATION_EVALUATION_PROTOCOL_DIGEST ?? "";
  const approvedArtifactDigest =
    source.TRANSLATION_APPROVED_EVALUATION_ARTIFACT_DIGEST ?? "";
  const promptDigests = {
    ordinary: ordinary?.promptDigest ?? "",
    strongerModel: strongerModel?.promptDigest ?? "",
    judge: judge?.promptDigest ?? "",
  };
  const approvalRoute = (value: TranslationRouteConfiguration | null) =>
    value
      ? {
          model: value.model,
          effort: value.effort,
          promptVersion: value.promptVersion,
          promptDigest: value.promptDigest,
        }
      : null;
  const productionApprovalDigest = digest({
    approvedArtifactDigest,
    ordinary: approvalRoute(ordinary),
    strongerModel: approvalRoute(strongerModel),
    judge: approvalRoute(judge),
    protocolDigest,
    promptDigests,
    providerFramingTokenAllowance,
  });
  const worstCaseCost = calculateMicrousd(
    maximumInputTokens ?? -1,
    maximumOutputTokens ?? -1,
    inputMicrousdPerMillion ?? -1,
    outputMicrousdPerMillion ?? -1,
  );
  if (
    !ordinary ||
    !strongerModel ||
    !judge ||
    !monthlyRequests ||
    !monthlyTokens ||
    !monthlyMicrousd ||
    !reservationMicrousd ||
    !maximumAttempts ||
    !timeoutMilliseconds ||
    timeoutMilliseconds < 1_000 ||
    !maximumSegmentCharacters ||
    !maximumRequestBytes ||
    !maximumInputTokens ||
    !providerFramingTokenAllowance ||
    !maximumOutputTokens ||
    !inputMicrousdPerMillion ||
    !outputMicrousdPerMillion ||
    !Number.isSafeInteger(maximumInputTokens + maximumOutputTokens) ||
    !Number.isSafeInteger(
      maximumRequestBytes + providerFramingTokenAllowance,
    ) ||
    maximumRequestBytes + providerFramingTokenAllowance > maximumInputTokens ||
    worstCaseCost === null ||
    worstCaseCost > reservationMicrousd ||
    !digestPattern.test(protocolDigest) ||
    !digestPattern.test(approvedArtifactDigest) ||
    source.TRANSLATION_PRODUCTION_APPROVAL_DIGEST !== productionApprovalDigest
  ) {
    return disabled();
  }

  return {
    enabled: true,
    provider: "openai",
    apiKey: source.OPENAI_API_KEY,
    ordinary,
    strongerModel,
    judge,
    evidence: {
      approvedArtifactDigest,
      productionApprovalDigest,
      protocolDigest,
      promptDigests,
    },
    limits: {
      maximumAttempts,
      timeoutMilliseconds,
      maximumSegmentCharacters,
      maximumRequestBytes,
      maximumInputTokens,
      providerFramingTokenAllowance,
      maximumOutputTokens,
      inputMicrousdPerMillion,
      outputMicrousdPerMillion,
      reservationMicrousd,
      monthlyRequests,
      monthlyTokens,
      monthlyMicrousd,
    },
  };
}
