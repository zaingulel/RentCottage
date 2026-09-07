import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE =
  "Usage: node scripts/run-log.mjs <label words> -- <command> [args...]";

function parseArguments(args) {
  const separator = args.indexOf("--");
  if (separator < 1 || separator === args.length - 1) return null;
  return {
    argv: args.slice(separator + 1),
    label: args.slice(0, separator).join(" "),
  };
}

function saveReceipt(cwd, receipt) {
  const directory = join(cwd, ".agent-evidence");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "runs.jsonl");
  appendFileSync(path, `${JSON.stringify(receipt)}\n`);
  return path;
}

export function main(
  args,
  {
    cwd = process.cwd(),
    run = spawnSync,
    stderr = console.error,
    stdout = console.log,
    timestamp = () => new Date().toISOString(),
    signalHandler,
  } = {},
) {
  const parsed = parseArguments(args);
  if (!parsed) {
    stderr(USAGE);
    return 2;
  }

  const [command, ...commandArgs] = parsed.argv;
  const execution = run(command, commandArgs, {
    cwd,
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  const result = execution.error
    ? {
        kind: "spawn-error",
        code: execution.error.code ?? null,
        message: execution.error.message,
      }
    : execution.signal
      ? { kind: "signal", signal: execution.signal }
      : { kind: "exit", status: execution.status ?? 1 };

  try {
    const receiptPath = saveReceipt(cwd, {
      timestamp: timestamp(),
      label: parsed.label,
      argv: parsed.argv,
      cwd,
      result,
    });
    stdout(
      `Run receipt: ${receiptPath} (${result.kind === "exit" ? `exit ${result.status}` : result.kind})`,
    );
  } catch (error) {
    stderr(
      `Unable to save run receipt: ${error instanceof Error ? error.message : String(error)}`,
    );
    return result.kind === "exit" && result.status !== 0 ? result.status : 1;
  }

  if (result.kind === "spawn-error") {
    stderr(`Unable to start ${command}: ${result.message}`);
    return 1;
  }
  if (result.kind === "signal") {
    stderr(`${command} was terminated by ${result.signal}`);
    signalHandler?.(result.signal);
    return 1;
  }
  return result.status;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let terminatingSignal;
  const exitCode = main(process.argv.slice(2), {
    signalHandler: (signal) => {
      terminatingSignal = signal;
    },
  });
  if (terminatingSignal) process.kill(process.pid, terminatingSignal);
  else process.exitCode = exitCode;
}
