import { readFile as readFileFromDisk } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  evaluateTranslationConfiguration,
  type TranslationEvaluationProtocol,
  type TranslationEvaluationSample,
} from "./evaluation.ts";
import { createOpenAIEvaluationRunner } from "./openai-evaluation-runner.ts";

const protocolUrl = new URL(
  "../../translation/evaluation/protocol-v1.json",
  import.meta.url,
);
const samplesUrl = new URL(
  "../../translation/evaluation/samples-v1.json",
  import.meta.url,
);

type Environment = Record<string, string | undefined>;
type Fetch = (input: string, init: RequestInit) => Promise<Response>;

function parseMaximumSpend(args: string[]): number | null {
  if (
    args.length !== 2 ||
    args[0] !== "--max-spend-microusd" ||
    !/^[1-9][0-9]*$/.test(args[1] ?? "")
  ) {
    return null;
  }
  const value = Number(args[1]);
  return Number.isSafeInteger(value) ? value : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Translation evaluation input is invalid");
  }
}

function forbiddenProductionInput(environment: Environment, args: string[]) {
  return (
    args.includes("--production-export") ||
    environment.TRANSLATION_EVALUATION_PRODUCTION_EXPORT !== undefined ||
    environment.TRANSLATION_EVALUATION_SOURCE === "production"
  );
}

export async function main(
  args: string[],
  {
    environment = process.env,
    fetch = globalThis.fetch,
    readFile = (url: URL) => readFileFromDisk(url, "utf8"),
    stdout = console.log,
    stderr = console.error,
  }: {
    environment?: Environment;
    fetch?: Fetch;
    readFile?: (url: URL) => Promise<string>;
    stdout?: (value: string) => void;
    stderr?: (value: string) => void;
  } = {},
): Promise<number> {
  const maximumSpendMicrousd = parseMaximumSpend(args);
  if (
    !maximumSpendMicrousd ||
    !environment.OPENAI_API_KEY ||
    /\s/.test(environment.OPENAI_API_KEY) ||
    forbiddenProductionInput(environment, args)
  ) {
    stderr(
      "Usage: npm run evaluate:translation -- --max-spend-microusd <positive-integer>; OPENAI_API_KEY is required and production exports are forbidden.",
    );
    return 2;
  }

  try {
    const [protocolText, samplesText] = await Promise.all([
      readFile(protocolUrl),
      readFile(samplesUrl),
    ]);
    const protocol = parseJson(protocolText) as TranslationEvaluationProtocol;
    const samples = parseJson(samplesText) as TranslationEvaluationSample[];
    const runner = createOpenAIEvaluationRunner({
      fetch,
      timeoutMilliseconds: 30_000,
      pricing: {
        candidateInputMicrousdPerMillion:
          protocol.candidateInputMicrousdPerMillion,
        candidateOutputMicrousdPerMillion:
          protocol.candidateOutputMicrousdPerMillion,
        judgeInputMicrousdPerMillion: protocol.judgeInputMicrousdPerMillion,
        judgeOutputMicrousdPerMillion: protocol.judgeOutputMicrousdPerMillion,
      },
      candidate: {
        maximumInputTokens: protocol.candidateMaxInputTokens,
        providerFramingTokenAllowance: protocol.providerFramingTokenAllowance,
        maximumOutputTokens: protocol.candidateMaxOutputTokens,
        maximumRequestBytes: protocol.candidateMaximumRequestBytes,
        maximumCallMicrousd: protocol.maximumCandidateCallMicrousd,
      },
      judge: {
        maximumInputTokens: protocol.judgeMaxInputTokens,
        providerFramingTokenAllowance: protocol.providerFramingTokenAllowance,
        maximumOutputTokens: protocol.judgeMaxOutputTokens,
        maximumRequestBytes: protocol.judgeMaximumRequestBytes,
        maximumCallMicrousd: protocol.maximumJudgeCallMicrousd,
      },
    });
    const artifact = await evaluateTranslationConfiguration({
      apiKey: environment.OPENAI_API_KEY,
      maximumSpendMicrousd,
      protocol,
      samples,
      runner,
    });
    stdout(JSON.stringify(artifact));
    return 0;
  } catch (error) {
    const message =
      error instanceof Error &&
      [
        "Translation evaluation preflight failed",
        "Translation evaluation spend ceiling reached",
        "Translation evaluation result is invalid",
        "Translation evaluation provider is unavailable",
        "Translation evaluation provider response is invalid",
      ].includes(error.message)
        ? error.message
        : "Translation evaluation input is invalid";
    stderr(message);
    return 2;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main(process.argv.slice(2));
}
