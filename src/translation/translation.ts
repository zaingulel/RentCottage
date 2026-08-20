import type { TranslationFailureCode } from "./failure-code.ts";

export type LaunchLanguage = "ar" | "ckb" | "en";

export type TranslationSegmentKind =
  | "cottage_description"
  | "house_rules"
  | "message"
  | "review"
  | "place_name"
  | "price"
  | "date"
  | "cottage_shift";

export interface TranslationSegment {
  key: string;
  kind: TranslationSegmentKind;
  text: string;
}

export interface TranslationInput {
  sourceLanguage: LaunchLanguage;
  targetLanguage: LaunchLanguage;
  segments: TranslationSegment[];
  route?: "ordinary" | "stronger_model";
}

export interface TranslationProvenance {
  provider: string;
  model: string;
  effort: string;
  promptVersion: string;
  promptDigest: string;
}

export interface TranslationUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CompletedTranslation {
  segments: Array<{ key: string; text: string }>;
  provenance: TranslationProvenance;
  usage: TranslationUsage;
}

export type TranslationOutcome =
  | ({
      status: "completed";
      source: "cache" | "provider";
    } & CompletedTranslation)
  | {
      status: "human_review_required";
      originals: TranslationSegment[];
      reason: string;
    }
  | {
      status: "unavailable";
      originals: TranslationSegment[];
      code: Exclude<
        TranslationFailureCode,
        "adapter_unavailable" | "provider_failure"
      >;
    };

export interface TranslationRouteConfiguration {
  model: string;
  effort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  promptVersion: string;
  promptContent: string;
  promptDigest: string;
}

export type TranslationConfiguration =
  | { enabled: false; code: "configuration_unavailable" }
  | {
      enabled: true;
      provider: string;
      ordinary: TranslationRouteConfiguration;
      strongerModel: TranslationRouteConfiguration;
      limits: {
        maximumAttempts: number;
        maximumSegmentCharacters: number;
        maximumRequestBytes: number;
        maximumInputTokens: number;
        providerFramingTokenAllowance: number;
        maximumOutputTokens: number;
        inputMicrousdPerMillion: number;
        outputMicrousdPerMillion: number;
        reservationMicrousd: number;
      };
    };

export interface TranslationAdapterRequest extends TranslationInput {
  route: "ordinary" | "stronger_model";
  configuration: TranslationRouteConfiguration;
  reservation: {
    maximumRequestBytes: number;
    maximumInputTokens: number;
    providerFramingTokenAllowance: number;
    maximumMicrousd: number;
    maximumOutputTokens: number;
    inputMicrousdPerMillion: number;
    outputMicrousdPerMillion: number;
  };
}

export interface TranslationAdapter {
  validate?(input: TranslationAdapterRequest): void;
  translate(
    input: TranslationAdapterRequest,
  ): Promise<CompletedTranslation | { humanReviewReason: string }>;
}

export interface TranslationStore {
  findCached(cacheKey: string): Promise<CompletedTranslation | null>;
  reserveUsage(input: {
    cacheKey: string;
    model: string;
    effort: string;
    promptVersion: string;
    reservedTokens: number;
    reservedMicrousd: number;
  }): Promise<{ granted: true; id: string } | { granted: false }>;
  recordUsage(reservationId: string, usage: TranslationUsage): Promise<void>;
  saveCached(cacheKey: string, result: CompletedTranslation): Promise<void>;
}

const supportedKinds = new Set<TranslationSegmentKind>([
  "cottage_description",
  "house_rules",
  "message",
  "review",
  "place_name",
  "price",
  "date",
  "cottage_shift",
]);
const launchLanguages = new Set<LaunchLanguage>(["ar", "ckb", "en"]);

function originals(input: TranslationInput): TranslationSegment[] {
  return input.segments.map((segment) => ({ ...segment }));
}

function unavailable(
  input: TranslationInput,
  code: Extract<TranslationOutcome, { status: "unavailable" }>["code"],
): TranslationOutcome {
  return { status: "unavailable", code, originals: originals(input) };
}

function validateInput(
  input: TranslationInput,
  maximumSegmentCharacters: number,
): "unsupported_content" | "invalid_input" | null {
  if (
    !launchLanguages.has(input.sourceLanguage) ||
    !launchLanguages.has(input.targetLanguage) ||
    input.sourceLanguage === input.targetLanguage ||
    (input.route !== undefined &&
      input.route !== "ordinary" &&
      input.route !== "stronger_model") ||
    input.segments.length === 0 ||
    input.segments.length > 20
  ) {
    return "invalid_input";
  }
  const keys = new Set<string>();
  for (const segment of input.segments) {
    if (!supportedKinds.has(segment.kind)) return "unsupported_content";
    if (
      typeof segment.key !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(segment.key) ||
      keys.has(segment.key) ||
      typeof segment.text !== "string" ||
      segment.text.trim().length === 0 ||
      segment.text.length > maximumSegmentCharacters
    ) {
      return "invalid_input";
    }
    keys.add(segment.key);
  }
  return null;
}

function validUsage(value: TranslationUsage): boolean {
  return (
    Number.isSafeInteger(value.inputTokens) &&
    value.inputTokens >= 0 &&
    Number.isSafeInteger(value.outputTokens) &&
    value.outputTokens >= 0 &&
    Number.isSafeInteger(value.totalTokens) &&
    value.totalTokens === value.inputTokens + value.outputTokens
  );
}

function validateCompleted(
  result: CompletedTranslation,
  input: TranslationInput,
  expected: TranslationRouteConfiguration,
  provider: string,
  maximumSegmentCharacters: number,
): boolean {
  if (
    result.provenance.provider !== provider ||
    result.provenance.model !== expected.model ||
    result.provenance.effort !== expected.effort ||
    result.provenance.promptVersion !== expected.promptVersion ||
    result.provenance.promptDigest !== expected.promptDigest ||
    !validUsage(result.usage) ||
    result.segments.length !== input.segments.length
  ) {
    return false;
  }
  return result.segments.every(
    (segment, index) =>
      segment.key === input.segments[index]?.key &&
      typeof segment.text === "string" &&
      segment.text.trim().length > 0 &&
      segment.text.length <= maximumSegmentCharacters,
  );
}

async function cacheKey(
  input: TranslationInput,
  route: TranslationRouteConfiguration,
): Promise<string> {
  const canonical = JSON.stringify({
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    model: route.model,
    effort: route.effort,
    promptVersion: route.promptVersion,
    promptDigest: route.promptDigest,
    segments: input.segments.map(({ key, kind, text }) => ({
      key,
      kind,
      text,
    })),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function transient(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "transient" in error &&
    error.transient === true
  );
}

function failureCode(
  error: unknown,
): Extract<TranslationOutcome, { status: "unavailable" }>["code"] {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "timeout") return "provider_timeout";
    if (error.code === "invalid_provider_response")
      return "invalid_provider_response";
    if (error.code === "configuration_unavailable")
      return "configuration_unavailable";
  }
  return "provider_unavailable";
}

export function createTranslationService({
  configuration,
  adapter,
  store,
}: {
  configuration: TranslationConfiguration;
  adapter: TranslationAdapter;
  store: TranslationStore;
}) {
  return {
    async translate(input: TranslationInput): Promise<TranslationOutcome> {
      if (!configuration.enabled) return unavailable(input, configuration.code);
      const invalidReason = validateInput(
        input,
        configuration.limits.maximumSegmentCharacters,
      );
      if (invalidReason) return unavailable(input, invalidReason);

      const routeName = input.route ?? "ordinary";
      const route =
        routeName === "stronger_model"
          ? configuration.strongerModel
          : configuration.ordinary;
      const key = await cacheKey(input, route);
      let cached: CompletedTranslation | null;
      try {
        cached = await store.findCached(key);
      } catch {
        return unavailable(input, "cache_unavailable");
      }
      if (
        cached &&
        validateCompleted(
          cached,
          input,
          route,
          configuration.provider,
          configuration.limits.maximumSegmentCharacters,
        )
      ) {
        return { status: "completed", source: "cache", ...cached };
      }

      const adapterRequest: TranslationAdapterRequest = {
        ...input,
        route: routeName,
        configuration: route,
        reservation: {
          maximumRequestBytes: configuration.limits.maximumRequestBytes,
          maximumInputTokens: configuration.limits.maximumInputTokens,
          providerFramingTokenAllowance:
            configuration.limits.providerFramingTokenAllowance,
          maximumMicrousd: configuration.limits.reservationMicrousd,
          maximumOutputTokens: configuration.limits.maximumOutputTokens,
          inputMicrousdPerMillion: configuration.limits.inputMicrousdPerMillion,
          outputMicrousdPerMillion:
            configuration.limits.outputMicrousdPerMillion,
        },
      };
      try {
        adapter.validate?.(adapterRequest);
      } catch (error) {
        return unavailable(input, failureCode(error));
      }

      let lastError: unknown;
      for (
        let attempt = 1;
        attempt <= configuration.limits.maximumAttempts;
        attempt += 1
      ) {
        let reservation: Awaited<ReturnType<TranslationStore["reserveUsage"]>>;
        try {
          reservation = await store.reserveUsage({
            cacheKey: key,
            model: route.model,
            effort: route.effort,
            promptVersion: route.promptVersion,
            reservedTokens:
              configuration.limits.maximumInputTokens +
              configuration.limits.maximumOutputTokens,
            reservedMicrousd: configuration.limits.reservationMicrousd,
          });
        } catch {
          return unavailable(input, "usage_accounting_unavailable");
        }
        if (!reservation.granted)
          return unavailable(input, "usage_limit_reached");
        let result: Awaited<ReturnType<TranslationAdapter["translate"]>>;
        try {
          result = await adapter.translate(adapterRequest);
        } catch (error) {
          lastError = error;
          if (
            !transient(error) ||
            attempt === configuration.limits.maximumAttempts
          )
            break;
          continue;
        }
        if ("humanReviewReason" in result) {
          return {
            status: "human_review_required",
            originals: originals(input),
            reason: result.humanReviewReason,
          };
        }
        if (
          !validateCompleted(
            result,
            input,
            route,
            configuration.provider,
            configuration.limits.maximumSegmentCharacters,
          )
        ) {
          return unavailable(input, "invalid_provider_response");
        }
        try {
          await store.recordUsage(reservation.id, result.usage);
        } catch {
          return unavailable(input, "usage_accounting_unavailable");
        }
        try {
          await store.saveCached(key, result);
        } catch {
          return unavailable(input, "cache_unavailable");
        }
        return { status: "completed", source: "provider", ...result };
      }
      return unavailable(input, failureCode(lastError));
    },
  };
}
