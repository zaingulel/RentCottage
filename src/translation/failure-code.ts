export const translationFailureCodes = [
  "adapter_unavailable",
  "configuration_unavailable",
  "unsupported_content",
  "invalid_input",
  "usage_limit_reached",
  "provider_timeout",
  "provider_unavailable",
  "invalid_provider_response",
  "cache_unavailable",
  "usage_accounting_unavailable",
  "provider_failure",
] as const;

export type TranslationFailureCode = (typeof translationFailureCodes)[number];

const failureCodes = new Set<string>(translationFailureCodes);

export function isTranslationFailureCode(
  value: unknown,
): value is TranslationFailureCode {
  return typeof value === "string" && failureCodes.has(value);
}
