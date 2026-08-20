import { describe, expect, it } from "vitest";

import {
  validateReportedResponsesUsage,
  validateResponsesCallBudget,
} from "./call-budget";

const limits = {
  maximumRequestBytes: 8,
  maximumInputTokens: 12,
  providerFramingTokenAllowance: 4,
  maximumOutputTokens: 5,
  maximumMicrousd: 17,
  inputMicrousdPerMillion: 1_000_000,
  outputMicrousdPerMillion: 1_000_000,
};

describe("Responses call budget", () => {
  it("uses a conservative UTF-8 byte plus framing-unit input bound", () => {
    expect(validateResponsesCallBudget("12345678", limits)).toEqual({
      requestUtf8Bytes: 8,
      maximumCostMicrousd: 17,
    });
    expect(validateResponsesCallBudget("éééé", limits)).toEqual({
      requestUtf8Bytes: 8,
      maximumCostMicrousd: 17,
    });
    expect(validateResponsesCallBudget("😀😀", limits)).toEqual({
      requestUtf8Bytes: 8,
      maximumCostMicrousd: 17,
    });
  });

  it.each([
    ["request byte cap", "123456789", limits],
    ["input units", "12345678", { ...limits, maximumInputTokens: 11 }],
    [
      "framing overflow",
      "x",
      {
        ...limits,
        maximumInputTokens: Number.MAX_SAFE_INTEGER,
        providerFramingTokenAllowance: Number.MAX_SAFE_INTEGER,
      },
    ],
    [
      "cost overflow",
      "x",
      {
        ...limits,
        maximumInputTokens: Number.MAX_SAFE_INTEGER,
        maximumOutputTokens: Number.MAX_SAFE_INTEGER,
        maximumMicrousd: Number.MAX_SAFE_INTEGER,
        inputMicrousdPerMillion: Number.MAX_SAFE_INTEGER,
        outputMicrousdPerMillion: Number.MAX_SAFE_INTEGER,
      },
    ],
  ])("rejects %s before a call", (_name, body, changedLimits) => {
    expect(validateResponsesCallBudget(body, changedLimits)).toBeNull();
  });

  it("validates reported usage and actual cost against the same approved bounds", () => {
    expect(
      validateReportedResponsesUsage(
        { inputTokens: 6, outputTokens: 5, totalTokens: 11 },
        limits,
      ),
    ).toEqual({ costMicrousd: 11 });
  });

  it.each([
    [
      "unsafe input",
      { inputTokens: 1.5, outputTokens: 1, totalTokens: 2.5 },
      limits,
    ],
    [
      "total mismatch",
      { inputTokens: 1, outputTokens: 1, totalTokens: 3 },
      limits,
    ],
    [
      "input maximum",
      { inputTokens: 13, outputTokens: 1, totalTokens: 14 },
      limits,
    ],
    [
      "output maximum",
      { inputTokens: 1, outputTokens: 6, totalTokens: 7 },
      limits,
    ],
    [
      "spend maximum",
      { inputTokens: 6, outputTokens: 5, totalTokens: 11 },
      { ...limits, maximumMicrousd: 10 },
    ],
    [
      "cost overflow",
      {
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 0,
        totalTokens: Number.MAX_SAFE_INTEGER,
      },
      {
        ...limits,
        maximumInputTokens: Number.MAX_SAFE_INTEGER,
        inputMicrousdPerMillion: Number.MAX_SAFE_INTEGER,
        maximumMicrousd: Number.MAX_SAFE_INTEGER,
      },
    ],
  ])("rejects reported usage with %s", (_name, usage, changedLimits) => {
    expect(validateReportedResponsesUsage(usage, changedLimits)).toBeNull();
  });
});
