import "server-only";

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
import type {
  CompletedTranslation,
  TranslationAdapter,
  TranslationAdapterRequest,
} from "./translation.ts";
import {
  createTranslationResponsesRequest,
  maximumProviderSegmentCharacters,
} from "./translation-request.ts";

const responsesEndpoint = "https://api.openai.com/v1/responses";

function invalidResponse(): never {
  throw { transient: false, code: "invalid_provider_response" };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalidResponse();
  return value as Record<string, unknown>;
}

function parseCompleted(
  value: unknown,
  request: TranslationAdapterRequest,
): CompletedTranslation {
  try {
    const envelope = parseResponsesEnvelope(value, request.configuration.model);
    const body = envelope.output;
    const usage = validateReportedResponsesUsage(
      envelope.usage,
      request.reservation,
    );
    if (
      !usage ||
      Object.keys(body).join(",") !== "segments" ||
      !Array.isArray(body.segments) ||
      body.segments.length !== request.segments.length
    )
      invalidResponse();
    const segments = body.segments.map((value, index) => {
      const segment = record(value);
      const expected = request.segments[index];
      if (
        Object.keys(segment).sort().join(",") !== "key,text" ||
        segment.key !== expected?.key ||
        typeof segment.text !== "string" ||
        segment.text.trim().length === 0 ||
        segment.text.length > maximumProviderSegmentCharacters
      ) {
        invalidResponse();
      }
      return { key: segment.key, text: segment.text.trim() } as {
        key: string;
        text: string;
      };
    });
    return {
      segments,
      provenance: {
        provider: "openai",
        model: request.configuration.model,
        effort: request.configuration.effort,
        promptVersion: request.configuration.promptVersion,
        promptDigest: request.configuration.promptDigest,
      },
      usage: envelope.usage,
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "invalid_provider_response"
    ) {
      throw error;
    }
    invalidResponse();
  }
}

function requestBody(
  request: TranslationAdapterRequest,
  prompt: string,
): Record<string, unknown> {
  return createTranslationResponsesRequest({
    model: request.configuration.model,
    effort: request.configuration.effort,
    instructions: prompt,
    maximumOutputTokens: request.reservation.maximumOutputTokens,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    segments: request.segments,
    schemaName: "cottage_translation",
  });
}

function providerError(status: number) {
  return {
    transient:
      status === 408 ||
      status === 409 ||
      status === 429 ||
      (status >= 500 && status <= 599),
    code: "provider_http_error",
  };
}

export function createOpenAIResponsesTranslationAdapter({
  apiKey,
  fetch: fetchResponse = globalThis.fetch,
  timeoutMilliseconds,
}: {
  apiKey: string;
  fetch?: ResponsesFetch;
  timeoutMilliseconds: number;
}): TranslationAdapter {
  function prepare(request: TranslationAdapterRequest) {
    if (!apiKey || timeoutMilliseconds <= 0) {
      throw { transient: false, code: "configuration_unavailable" };
    }
    const body = requestBody(request, request.configuration.promptContent);
    const serializedBody = JSON.stringify(body);
    if (!validateResponsesCallBudget(serializedBody, request.reservation)) {
      throw { transient: false, code: "configuration_unavailable" };
    }
    return serializedBody;
  }

  return {
    validate(request) {
      prepare(request);
    },

    async translate(request) {
      const serializedBody = prepare(request);
      let response: Awaited<ReturnType<typeof fetchBoundedJson>>;
      try {
        response = await fetchBoundedJson({
          fetch: fetchResponse,
          url: responsesEndpoint,
          timeoutMilliseconds,
          maximumResponseBytes: 250_000,
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
      } catch (error) {
        if (error instanceof ResponsesTransportError) {
          if (error.kind === "timeout") {
            throw { transient: true, code: "timeout" };
          }
          if (error.kind === "invalid_response") invalidResponse();
        }
        throw { transient: true, code: "connection_failure" };
      }
      if (!response.ok) throw providerError(response.status);
      return parseCompleted(response.value, request);
    },
  };
}
