export interface ResponsesCallBudget {
  maximumRequestBytes: number;
  maximumInputTokens: number;
  providerFramingTokenAllowance: number;
  maximumOutputTokens: number;
  maximumMicrousd: number;
  inputMicrousdPerMillion: number;
  outputMicrousdPerMillion: number;
}

export function calculateMicrousd(
  inputTokens: number,
  outputTokens: number,
  inputRate: number,
  outputRate: number,
): number | null {
  if (
    ![inputTokens, outputTokens, inputRate, outputRate].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  ) {
    return null;
  }
  const numerator =
    BigInt(inputTokens) * BigInt(inputRate) +
    BigInt(outputTokens) * BigInt(outputRate);
  const result = (numerator + 999_999n) / 1_000_000n;
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}

/**
 * Conservative application bound, not provider tokenization: each UTF-8 request
 * byte consumes one reserved input-token unit, plus frozen provider framing.
 */
export function validateResponsesCallBudget(
  serializedRequest: string,
  budget: ResponsesCallBudget,
): { requestUtf8Bytes: number; maximumCostMicrousd: number } | null {
  const integerFields = [
    budget.maximumRequestBytes,
    budget.maximumInputTokens,
    budget.providerFramingTokenAllowance,
    budget.maximumOutputTokens,
    budget.maximumMicrousd,
    budget.inputMicrousdPerMillion,
    budget.outputMicrousdPerMillion,
  ];
  if (
    integerFields.some((value) => !Number.isSafeInteger(value) || value <= 0)
  ) {
    return null;
  }
  const requestUtf8Bytes = new TextEncoder().encode(
    serializedRequest,
  ).byteLength;
  const reservedInputUnits =
    requestUtf8Bytes + budget.providerFramingTokenAllowance;
  const maximumTotalTokens =
    budget.maximumInputTokens + budget.maximumOutputTokens;
  const maximumCostMicrousd = calculateMicrousd(
    budget.maximumInputTokens,
    budget.maximumOutputTokens,
    budget.inputMicrousdPerMillion,
    budget.outputMicrousdPerMillion,
  );
  if (
    requestUtf8Bytes > budget.maximumRequestBytes ||
    !Number.isSafeInteger(reservedInputUnits) ||
    reservedInputUnits > budget.maximumInputTokens ||
    !Number.isSafeInteger(maximumTotalTokens) ||
    maximumCostMicrousd === null ||
    maximumCostMicrousd > budget.maximumMicrousd
  ) {
    return null;
  }
  return { requestUtf8Bytes, maximumCostMicrousd };
}

export function validateReportedResponsesUsage(
  usage: { inputTokens: number; outputTokens: number; totalTokens: number },
  budget: ResponsesCallBudget,
): { costMicrousd: number } | null {
  const usageValues = [
    usage.inputTokens,
    usage.outputTokens,
    usage.totalTokens,
  ];
  const approvedValues = [
    budget.maximumInputTokens,
    budget.maximumOutputTokens,
    budget.maximumMicrousd,
    budget.inputMicrousdPerMillion,
    budget.outputMicrousdPerMillion,
  ];
  if (
    usageValues.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    approvedValues.some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    ) ||
    !Number.isSafeInteger(usage.inputTokens + usage.outputTokens) ||
    usage.totalTokens !== usage.inputTokens + usage.outputTokens ||
    usage.inputTokens > budget.maximumInputTokens ||
    usage.outputTokens > budget.maximumOutputTokens
  ) {
    return null;
  }
  const costMicrousd = calculateMicrousd(
    usage.inputTokens,
    usage.outputTokens,
    budget.inputMicrousdPerMillion,
    budget.outputMicrousdPerMillion,
  );
  return costMicrousd !== null && costMicrousd <= budget.maximumMicrousd
    ? { costMicrousd }
    : null;
}
