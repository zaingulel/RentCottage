import type {
  TranslationEvaluationProtocol,
  TranslationEvaluationRunner,
} from "./evaluation.ts";
import {
  validateReportedResponsesUsage,
  validateResponsesCallBudget,
} from "./call-budget.ts";
import {
  fetchBoundedJson,
  parseResponsesEnvelope,
  ResponsesTransportError,
  type ResponsesFetch,
} from "./responses-envelope.ts";
import { createTranslationResponsesRequest } from "./translation-request.ts";

const responsesEndpoint = "https://api.openai.com/v1/responses";
const maximumResponseBytes = 250_000;
const maximumSegmentCharacters = 10_000;

type Pricing = Pick<
  TranslationEvaluationProtocol,
  | "candidateInputMicrousdPerMillion"
  | "candidateOutputMicrousdPerMillion"
  | "judgeInputMicrousdPerMillion"
  | "judgeOutputMicrousdPerMillion"
>;

interface CallBounds {
  maximumInputTokens: number;
  providerFramingTokenAllowance: number;
  maximumOutputTokens: number;
  maximumRequestBytes: number;
  maximumCallMicrousd: number;
}

function invalid(): never {
  throw new Error("Translation evaluation provider response is invalid");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function candidateBody(
  input: Parameters<TranslationEvaluationRunner["runCandidate"]>[0],
  bounds: CallBounds,
) {
  return createTranslationResponsesRequest({
    model: input.model,
    effort: input.effort,
    instructions: input.promptContent,
    maximumOutputTokens: bounds.maximumOutputTokens,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    segments: input.segments,
    schemaName: "translation_evaluation_candidate",
  });
}

function judgeBody(
  input: Parameters<TranslationEvaluationRunner["runJudge"]>[0],
  bounds: CallBounds,
) {
  const source = input.source.map(({ key, kind, text }) => ({
    key,
    kind,
    text,
  }));
  const answers = input.answers.map(({ id, segments }) => ({
    id,
    segments: segments.map(({ key, text }) => ({ key, text })),
  }));
  return {
    model: input.model,
    store: false,
    background: false,
    tools: [],
    max_output_tokens: bounds.maximumOutputTokens,
    reasoning: { effort: input.effort, context: "current_turn" },
    instructions: input.promptContent,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              candidateId: input.candidateId,
              sampleId: input.sampleId,
              sourceLanguage: input.sourceLanguage,
              targetLanguage: input.targetLanguage,
              source,
              answers,
            }),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "translation_evaluation",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["score", "criticalErrors"],
          properties: {
            score: { type: "number", minimum: 0, maximum: 1 },
            criticalErrors: { type: "integer", minimum: 0 },
          },
        },
      },
    },
  };
}

async function execute({
  fetch,
  timeoutMilliseconds,
  apiKey,
  serializedBody,
}: {
  fetch: ResponsesFetch;
  timeoutMilliseconds: number;
  apiKey: string;
  serializedBody: string;
}) {
  try {
    const response = await fetchBoundedJson({
      fetch,
      url: responsesEndpoint,
      timeoutMilliseconds,
      maximumResponseBytes,
      init: {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: serializedBody,
      },
    });
    if (!response.ok)
      throw new Error("Translation evaluation provider is unavailable");
    return response.value;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Translation evaluation provider is unavailable"
    ) {
      throw error;
    }
    if (
      error instanceof ResponsesTransportError &&
      error.kind === "invalid_response"
    ) {
      invalid();
    }
    throw new Error("Translation evaluation provider is unavailable");
  }
}

function validateUsage(
  usage: { inputTokens: number; outputTokens: number; totalTokens: number },
  bounds: CallBounds,
  inputRate: number,
  outputRate: number,
) {
  const validated = validateReportedResponsesUsage(usage, {
    ...bounds,
    maximumMicrousd: bounds.maximumCallMicrousd,
    inputMicrousdPerMillion: inputRate,
    outputMicrousdPerMillion: outputRate,
  });
  if (!validated) invalid();
  return validated.costMicrousd;
}

function envelope(value: unknown, model: string) {
  try {
    return parseResponsesEnvelope(value, model);
  } catch {
    invalid();
  }
}

export function createOpenAIEvaluationRunner({
  fetch = globalThis.fetch,
  timeoutMilliseconds,
  pricing,
  candidate,
  judge,
}: {
  fetch?: ResponsesFetch;
  timeoutMilliseconds: number;
  pricing: Pricing;
  candidate: CallBounds;
  judge: CallBounds;
}): TranslationEvaluationRunner {
  return {
    async runCandidate(input) {
      const body = candidateBody(input, candidate);
      const serializedBody = JSON.stringify(body);
      if (
        !validateResponsesCallBudget(serializedBody, {
          ...candidate,
          maximumMicrousd: candidate.maximumCallMicrousd,
          inputMicrousdPerMillion: pricing.candidateInputMicrousdPerMillion,
          outputMicrousdPerMillion: pricing.candidateOutputMicrousdPerMillion,
        })
      )
        invalid();
      const parsed = envelope(
        await execute({
          fetch,
          timeoutMilliseconds,
          apiKey: input.apiKey,
          serializedBody,
        }),
        input.model,
      );
      const output = parsed.output;
      if (
        Object.keys(output).join(",") !== "segments" ||
        !Array.isArray(output.segments) ||
        output.segments.length !== input.segments.length
      ) {
        invalid();
      }
      const segments = output.segments.map((value, index) => {
        const segment = record(value);
        if (
          Object.keys(segment).sort().join(",") !== "key,text" ||
          segment.key !== input.segments[index]?.key ||
          typeof segment.text !== "string" ||
          segment.text.trim().length === 0 ||
          segment.text.length > maximumSegmentCharacters
        ) {
          invalid();
        }
        return { key: segment.key as string, text: segment.text.trim() };
      });
      return {
        segments,
        provenance: {
          model: input.model,
          effort: input.effort,
          promptVersion: input.promptVersion,
          promptDigest: input.promptDigest,
        },
        costMicrousd: validateUsage(
          parsed.usage,
          candidate,
          pricing.candidateInputMicrousdPerMillion,
          pricing.candidateOutputMicrousdPerMillion,
        ),
      };
    },

    async runJudge(input) {
      const body = judgeBody(input, judge);
      const serializedBody = JSON.stringify(body);
      if (
        !validateResponsesCallBudget(serializedBody, {
          ...judge,
          maximumMicrousd: judge.maximumCallMicrousd,
          inputMicrousdPerMillion: pricing.judgeInputMicrousdPerMillion,
          outputMicrousdPerMillion: pricing.judgeOutputMicrousdPerMillion,
        })
      )
        invalid();
      const parsed = envelope(
        await execute({
          fetch,
          timeoutMilliseconds,
          apiKey: input.apiKey,
          serializedBody,
        }),
        input.model,
      );
      const result = parsed.output;
      if (
        Object.keys(result).sort().join(",") !== "criticalErrors,score" ||
        typeof result.score !== "number" ||
        result.score < 0 ||
        result.score > 1 ||
        !Number.isSafeInteger(result.criticalErrors) ||
        (result.criticalErrors as number) < 0
      ) {
        invalid();
      }
      return {
        score: result.score,
        criticalErrors: result.criticalErrors as number,
        provenance: {
          model: input.model,
          effort: input.effort,
          promptVersion: input.promptVersion,
          promptDigest: input.promptDigest,
        },
        costMicrousd: validateUsage(
          parsed.usage,
          judge,
          pricing.judgeInputMicrousdPerMillion,
          pricing.judgeOutputMicrousdPerMillion,
        ),
      };
    },
  };
}
