import type {
  LaunchLanguage,
  TranslationRouteConfiguration,
  TranslationSegment,
} from "./translation.ts";

type Effort = TranslationRouteConfiguration["effort"];

export interface TranslationEvaluationProtocol {
  version: string;
  candidateModel: string;
  candidatePromptVersion: string;
  candidateInstructions: string;
  candidatePromptDigest: string;
  judgeModel: string;
  judgeEffort: Effort;
  judgePromptVersion: string;
  judgeInstructions: string;
  judgePromptDigest: string;
  candidateLowestSupportedEffort: Effort;
  reasoningEfforts: Effort[];
  runsPerConfiguration: 3;
  medianThreshold: number;
  minimumSampleScore: number;
  maximumCriticalErrors: 0;
  candidateMaxInputTokens: number;
  candidateMaxOutputTokens: number;
  candidateMaximumRequestBytes: number;
  judgeMaxInputTokens: number;
  judgeMaxOutputTokens: number;
  judgeMaximumRequestBytes: number;
  providerFramingTokenAllowance: number;
  maximumCandidateCallMicrousd: number;
  maximumJudgeCallMicrousd: number;
  candidateInputMicrousdPerMillion: number;
  candidateOutputMicrousdPerMillion: number;
  judgeInputMicrousdPerMillion: number;
  judgeOutputMicrousdPerMillion: number;
  calibrationDigest: string;
  nativeReviewerSetDigest: string;
}

export interface TranslationEvaluationSample {
  id: string;
  sourceLanguage: LaunchLanguage;
  targetLanguage: LaunchLanguage;
  provenance: "synthetic" | "reviewer_authored" | "licensed_deidentified";
  segments: TranslationSegment[];
  reference: Array<{ key: string; text: string }>;
}

interface EvaluationProvenance {
  model: string;
  effort: string;
  promptVersion: string;
  promptDigest: string;
}

export interface TranslationEvaluationRunner {
  runCandidate(input: {
    apiKey: string;
    model: string;
    effort: Effort;
    promptVersion: string;
    promptContent: string;
    promptDigest: string;
    sourceLanguage: LaunchLanguage;
    targetLanguage: LaunchLanguage;
    segments: TranslationSegment[];
  }): Promise<{
    segments: Array<{ key: string; text: string }>;
    provenance: EvaluationProvenance;
    costMicrousd: number;
  }>;
  runJudge(input: {
    apiKey: string;
    model: string;
    effort: Effort;
    promptVersion: string;
    promptContent: string;
    promptDigest: string;
    candidateId: string;
    sampleId: string;
    sourceLanguage: LaunchLanguage;
    targetLanguage: LaunchLanguage;
    source: TranslationSegment[];
    answers: Array<{
      id: string;
      segments: Array<{ key: string; text: string }>;
    }>;
  }): Promise<{
    score: number;
    criticalErrors: number;
    provenance: EvaluationProvenance;
    costMicrousd: number;
  }>;
}

const digestPattern = /^[0-9a-f]{64}$/;
const supportedEfforts = new Set([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const launchLanguages = new Set(["ar", "ckb", "en"]);
const supportedKinds = new Set([
  "cottage_description",
  "house_rules",
  "message",
  "review",
  "place_name",
  "price",
  "date",
  "cottage_shift",
]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const output = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(output), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function digestText(value: string): Promise<string> {
  const output = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(output), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function positiveCost(value: unknown, maximum: number): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= maximum
  );
}

function validProtocol(protocol: TranslationEvaluationProtocol): boolean {
  const efforts = Array.isArray(protocol.reasoningEfforts)
    ? protocol.reasoningEfforts
    : [];
  const effortOrder = ["none", "low", "medium", "high", "xhigh", "max"];
  const effortIndexes = efforts.map((effort) => effortOrder.indexOf(effort));
  return (
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(protocol.version) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(protocol.candidateModel) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(protocol.judgeModel) &&
    typeof protocol.candidatePromptVersion === "string" &&
    protocol.candidatePromptVersion.length > 0 &&
    typeof protocol.candidateInstructions === "string" &&
    protocol.candidateInstructions.trim().length > 0 &&
    protocol.candidateInstructions.length <= 10_000 &&
    digestPattern.test(protocol.candidatePromptDigest) &&
    supportedEfforts.has(protocol.judgeEffort) &&
    supportedEfforts.has(protocol.candidateLowestSupportedEffort) &&
    typeof protocol.judgePromptVersion === "string" &&
    protocol.judgePromptVersion.length > 0 &&
    typeof protocol.judgeInstructions === "string" &&
    protocol.judgeInstructions.trim().length > 0 &&
    protocol.judgeInstructions.length <= 10_000 &&
    digestPattern.test(protocol.judgePromptDigest) &&
    protocol.runsPerConfiguration === 3 &&
    efforts.length > 0 &&
    efforts.every((effort) => supportedEfforts.has(effort)) &&
    new Set(efforts).size === efforts.length &&
    efforts[0] === protocol.candidateLowestSupportedEffort &&
    effortIndexes.every(
      (index, position) =>
        position === 0 || index > effortIndexes[position - 1]!,
    ) &&
    protocol.medianThreshold > 0 &&
    protocol.medianThreshold <= 1 &&
    protocol.minimumSampleScore > 0 &&
    protocol.minimumSampleScore <= 1 &&
    protocol.maximumCriticalErrors === 0 &&
    Number.isSafeInteger(protocol.candidateMaxInputTokens) &&
    protocol.candidateMaxInputTokens > 0 &&
    Number.isSafeInteger(protocol.candidateMaxOutputTokens) &&
    protocol.candidateMaxOutputTokens > 0 &&
    protocol.candidateMaxOutputTokens <= 128_000 &&
    Number.isSafeInteger(protocol.candidateMaximumRequestBytes) &&
    protocol.candidateMaximumRequestBytes > 0 &&
    Number.isSafeInteger(protocol.judgeMaxInputTokens) &&
    protocol.judgeMaxInputTokens > 0 &&
    Number.isSafeInteger(protocol.judgeMaxOutputTokens) &&
    protocol.judgeMaxOutputTokens > 0 &&
    protocol.judgeMaxOutputTokens <= 128_000 &&
    Number.isSafeInteger(protocol.judgeMaximumRequestBytes) &&
    protocol.judgeMaximumRequestBytes > 0 &&
    Number.isSafeInteger(protocol.providerFramingTokenAllowance) &&
    protocol.providerFramingTokenAllowance > 0 &&
    Number.isSafeInteger(
      protocol.candidateMaximumRequestBytes +
        protocol.providerFramingTokenAllowance,
    ) &&
    protocol.candidateMaximumRequestBytes +
      protocol.providerFramingTokenAllowance <=
      protocol.candidateMaxInputTokens &&
    Number.isSafeInteger(
      protocol.judgeMaximumRequestBytes +
        protocol.providerFramingTokenAllowance,
    ) &&
    protocol.judgeMaximumRequestBytes +
      protocol.providerFramingTokenAllowance <=
      protocol.judgeMaxInputTokens &&
    Number.isSafeInteger(protocol.maximumCandidateCallMicrousd) &&
    protocol.maximumCandidateCallMicrousd > 0 &&
    Number.isSafeInteger(protocol.maximumJudgeCallMicrousd) &&
    protocol.maximumJudgeCallMicrousd > 0 &&
    Number.isSafeInteger(protocol.candidateInputMicrousdPerMillion) &&
    protocol.candidateInputMicrousdPerMillion > 0 &&
    Number.isSafeInteger(protocol.candidateOutputMicrousdPerMillion) &&
    protocol.candidateOutputMicrousdPerMillion > 0 &&
    Number.isSafeInteger(protocol.judgeInputMicrousdPerMillion) &&
    protocol.judgeInputMicrousdPerMillion > 0 &&
    Number.isSafeInteger(protocol.judgeOutputMicrousdPerMillion) &&
    protocol.judgeOutputMicrousdPerMillion > 0 &&
    digestPattern.test(protocol.calibrationDigest) &&
    digestPattern.test(protocol.nativeReviewerSetDigest)
  );
}

function validSamples(samples: TranslationEvaluationSample[]): boolean {
  if (!Array.isArray(samples) || samples.length === 0 || samples.length > 100)
    return false;
  const ids = new Set<string>();
  return samples.every((sample) => {
    if (
      !sample ||
      typeof sample !== "object" ||
      ids.has(sample.id) ||
      !/^[a-z0-9][a-z0-9-]{2,79}$/.test(sample.id) ||
      !launchLanguages.has(sample.sourceLanguage) ||
      !launchLanguages.has(sample.targetLanguage) ||
      !["synthetic", "reviewer_authored", "licensed_deidentified"].includes(
        sample.provenance,
      ) ||
      sample.sourceLanguage === sample.targetLanguage ||
      !Array.isArray(sample.segments) ||
      sample.segments.length === 0 ||
      sample.segments.length > 20 ||
      !Array.isArray(sample.reference) ||
      sample.segments.length !== sample.reference.length
    ) {
      return false;
    }
    ids.add(sample.id);
    const segmentKeys = new Set<string>();
    return sample.segments.every((segment, index) => {
      const reference = sample.reference[index];
      if (
        !segment ||
        !reference ||
        typeof segment !== "object" ||
        typeof reference !== "object"
      ) {
        return false;
      }
      const valid =
        /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(segment.key) &&
        !segmentKeys.has(segment.key) &&
        supportedKinds.has(segment.kind) &&
        segment.key === reference.key &&
        typeof segment.text === "string" &&
        typeof reference.text === "string" &&
        segment.text.trim().length > 0 &&
        segment.text.length <= 10_000 &&
        reference.text.trim().length > 0 &&
        reference.text.length <= 10_000;
      segmentKeys.add(segment.key);
      return valid;
    });
  });
}

function exactProvenance(
  actual: EvaluationProvenance,
  expected: EvaluationProvenance,
): boolean {
  return (
    actual.model === expected.model &&
    actual.effort === expected.effort &&
    actual.promptVersion === expected.promptVersion &&
    actual.promptDigest === expected.promptDigest
  );
}

function validCandidate(
  segments: Array<{ key: string; text: string }>,
  sample: TranslationEvaluationSample,
): boolean {
  return (
    segments.length === sample.segments.length &&
    segments.every(
      (segment, index) =>
        segment.key === sample.segments[index]?.key &&
        typeof segment.text === "string" &&
        segment.text.trim().length > 0,
    )
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

async function preflight(input: {
  apiKey: string;
  maximumSpendMicrousd: number;
  protocol: TranslationEvaluationProtocol;
  samples: TranslationEvaluationSample[];
}) {
  if (
    !input.apiKey ||
    /\s/.test(input.apiKey) ||
    !Number.isSafeInteger(input.maximumSpendMicrousd) ||
    input.maximumSpendMicrousd <= 0 ||
    !validProtocol(input.protocol) ||
    !validSamples(input.samples) ||
    input.protocol.candidatePromptDigest !==
      (await digestText(input.protocol.candidateInstructions)) ||
    input.protocol.judgePromptDigest !==
      (await digestText(input.protocol.judgeInstructions))
  ) {
    throw new Error("Translation evaluation preflight failed");
  }
}

export async function evaluateTranslationConfiguration(input: {
  apiKey: string;
  maximumSpendMicrousd: number;
  protocol: TranslationEvaluationProtocol;
  samples: TranslationEvaluationSample[];
  runner: TranslationEvaluationRunner;
}) {
  await preflight(input);
  let spentMicrousd = 0;
  const summaries: Array<{
    effort: Effort;
    medianScore: number;
    minimumSampleMedian: number;
    criticalErrors: number;
    samples: Array<{
      sampleDigest: string;
      medianScore: number;
      criticalErrors: number;
    }>;
  }> = [];

  for (const effort of input.protocol.reasoningEfforts) {
    const scores: number[] = [];
    const sampleMedians: number[] = [];
    const sampleSummaries: Array<{
      sampleDigest: string;
      medianScore: number;
      criticalErrors: number;
    }> = [];
    let criticalErrors = 0;
    for (const sample of input.samples) {
      const sampleScores: number[] = [];
      let sampleCriticalErrors = 0;
      for (let run = 1; run <= input.protocol.runsPerConfiguration; run += 1) {
        if (
          spentMicrousd + input.protocol.maximumCandidateCallMicrousd >
          input.maximumSpendMicrousd
        ) {
          throw new Error("Translation evaluation spend ceiling reached");
        }
        const candidate = await input.runner.runCandidate({
          apiKey: input.apiKey,
          model: input.protocol.candidateModel,
          effort,
          promptVersion: input.protocol.candidatePromptVersion,
          promptContent: input.protocol.candidateInstructions,
          promptDigest: input.protocol.candidatePromptDigest,
          sourceLanguage: sample.sourceLanguage,
          targetLanguage: sample.targetLanguage,
          segments: sample.segments,
        });
        if (
          !positiveCost(
            candidate.costMicrousd,
            input.protocol.maximumCandidateCallMicrousd,
          ) ||
          !exactProvenance(candidate.provenance, {
            model: input.protocol.candidateModel,
            effort,
            promptVersion: input.protocol.candidatePromptVersion,
            promptDigest: input.protocol.candidatePromptDigest,
          }) ||
          !validCandidate(candidate.segments, sample)
        ) {
          throw new Error("Translation evaluation result is invalid");
        }
        spentMicrousd += candidate.costMicrousd;
        if (
          spentMicrousd + input.protocol.maximumJudgeCallMicrousd >
          input.maximumSpendMicrousd
        ) {
          throw new Error("Translation evaluation spend ceiling reached");
        }
        const candidateId = (
          await digest({ sample: sample.id, run, effort })
        ).slice(0, 16);
        const referenceId = (
          await digest({ sample: sample.id, run, reference: true })
        ).slice(0, 16);
        const answers = [
          { id: candidateId, segments: candidate.segments },
          { id: referenceId, segments: sample.reference },
        ].sort((left, right) => left.id.localeCompare(right.id));
        const judged = await input.runner.runJudge({
          apiKey: input.apiKey,
          model: input.protocol.judgeModel,
          effort: input.protocol.judgeEffort,
          promptVersion: input.protocol.judgePromptVersion,
          promptContent: input.protocol.judgeInstructions,
          promptDigest: input.protocol.judgePromptDigest,
          candidateId,
          sampleId: sample.id,
          sourceLanguage: sample.sourceLanguage,
          targetLanguage: sample.targetLanguage,
          source: sample.segments,
          answers,
        });
        if (
          !positiveCost(
            judged.costMicrousd,
            input.protocol.maximumJudgeCallMicrousd,
          ) ||
          !exactProvenance(judged.provenance, {
            model: input.protocol.judgeModel,
            effort: input.protocol.judgeEffort,
            promptVersion: input.protocol.judgePromptVersion,
            promptDigest: input.protocol.judgePromptDigest,
          }) ||
          typeof judged.score !== "number" ||
          judged.score < 0 ||
          judged.score > 1 ||
          !Number.isSafeInteger(judged.criticalErrors) ||
          judged.criticalErrors < 0
        ) {
          throw new Error("Translation evaluation result is invalid");
        }
        spentMicrousd += judged.costMicrousd;
        scores.push(judged.score);
        sampleScores.push(judged.score);
        criticalErrors += judged.criticalErrors;
        sampleCriticalErrors += judged.criticalErrors;
      }
      const sampleMedian = median(sampleScores);
      sampleMedians.push(sampleMedian);
      sampleSummaries.push({
        sampleDigest: await digest(sample.id),
        medianScore: sampleMedian,
        criticalErrors: sampleCriticalErrors,
      });
    }
    const summary = {
      effort,
      medianScore: median(scores),
      minimumSampleMedian: Math.min(...sampleMedians),
      criticalErrors,
      samples: sampleSummaries,
    };
    summaries.push(summary);
    if (
      summary.medianScore >= input.protocol.medianThreshold &&
      summary.minimumSampleMedian >= input.protocol.minimumSampleScore &&
      summary.criticalErrors <= input.protocol.maximumCriticalErrors
    ) {
      const artifact = {
        protocolVersion: input.protocol.version,
        protocolDigest: await digest(input.protocol),
        sampleSetDigest: await digest(input.samples),
        candidatePromptDigest: input.protocol.candidatePromptDigest,
        judge: {
          model: input.protocol.judgeModel,
          effort: input.protocol.judgeEffort,
          promptVersion: input.protocol.judgePromptVersion,
          promptDigest: input.protocol.judgePromptDigest,
        },
        selected: {
          model: input.protocol.candidateModel,
          effort,
          promptVersion: input.protocol.candidatePromptVersion,
          promptDigest: input.protocol.candidatePromptDigest,
        },
        runsPerConfiguration: input.protocol.runsPerConfiguration,
        sampleCount: input.samples.length,
        medianScore: summary.medianScore,
        criticalErrors: summary.criticalErrors,
        pass: true as const,
        spentMicrousd,
        evaluated: summaries,
      };
      return { ...artifact, artifactDigest: await digest(artifact) };
    }
  }
  return {
    protocolVersion: input.protocol.version,
    protocolDigest: await digest(input.protocol),
    sampleSetDigest: await digest(input.samples),
    selected: null,
    runsPerConfiguration: input.protocol.runsPerConfiguration,
    sampleCount: input.samples.length,
    medianScore: null,
    criticalErrors: summaries.reduce(
      (total, summary) => total + summary.criticalErrors,
      0,
    ),
    pass: false as const,
    artifactDigest: null,
    spentMicrousd,
    evaluated: summaries,
  };
}
