#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRentCottageGitHubAdapter } from "./lib/rentcottage-github-adapter.mjs";
import { createRentCottageGhSource } from "./lib/rentcottage-gh-source.mjs";
import { runRentCottageReconciliation } from "./lib/rentcottage-reconciliation.mjs";
import { createRentCottageTrackerPolicy } from "./lib/rentcottage-tracker-policy.mjs";
import { boundedDiagnostic, errorDiagnostic } from "./lib/github-cli.mjs";

const USAGE = `Usage: npm run reconcile:board -- [--intent audit|publish|claim|review|closeout] [--issue <number>] [--area <Project Area>] [--pull-request <number>] [--assignee <login>] [--apply --plan-id <sha256:fingerprint>]`;

function positiveInteger(value, flag) {
  if (!/^\d+$/.test(value ?? "") || Number(value) < 1)
    throw new Error(`${flag} requires a positive integer`);
  return Number(value);
}

export function parseReconciliationArgs(args) {
  const parsed = { intent: { type: "audit" }, apply: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }
    const value = args[index + 1];
    if (arg === "--intent") {
      if (!["audit", "publish", "claim", "review", "closeout"].includes(value))
        throw new Error("--intent is invalid");
      parsed.intent.type = value;
    } else if (arg === "--issue") {
      parsed.intent.issueNumber = positiveInteger(value, arg);
    } else if (arg === "--pull-request") {
      parsed.intent.pullRequestNumber = positiveInteger(value, arg);
    } else if (arg === "--assignee") {
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value ?? ""))
        throw new Error("--assignee requires a GitHub login");
      parsed.intent.assignee = value;
    } else if (arg === "--area") {
      if (typeof value !== "string" || value.trim() !== value || value === "")
        throw new Error("--area requires a Project Area");
      parsed.intent.area = value;
    } else if (arg === "--plan-id") {
      if (!/^sha256:[a-f0-9]{64}$/.test(value ?? ""))
        throw new Error("--plan-id requires a SHA-256 fingerprint");
      parsed.planId = value;
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
    index += 1;
  }
  if (parsed.apply && !parsed.planId)
    throw new Error("--apply requires --plan-id");
  if (parsed.planId && !parsed.apply)
    throw new Error("--plan-id is valid only with --apply");
  if (parsed.intent.type === "audit" && parsed.apply)
    throw new Error("audit does not accept --apply");
  if (parsed.intent.type === "publish" && !parsed.intent.issueNumber)
    throw new Error("publish requires --issue");
  if (
    parsed.intent.type === "claim" &&
    (!parsed.intent.issueNumber || !parsed.intent.assignee)
  ) {
    throw new Error("claim requires --issue and --assignee");
  }
  if (
    ["review", "closeout"].includes(parsed.intent.type) &&
    (!parsed.intent.issueNumber || !parsed.intent.pullRequestNumber)
  ) {
    throw new Error(
      `${parsed.intent.type} requires --issue and --pull-request`,
    );
  }
  const allowedIdentifiers = {
    audit: [],
    publish: ["issueNumber", "area"],
    claim: ["issueNumber", "assignee"],
    review: ["issueNumber", "pullRequestNumber"],
    closeout: ["issueNumber", "pullRequestNumber"],
  }[parsed.intent.type];
  for (const [identifier, flag] of [
    ["issueNumber", "--issue"],
    ["pullRequestNumber", "--pull-request"],
    ["assignee", "--assignee"],
    ["area", "--area"],
  ]) {
    if (
      parsed.intent[identifier] !== undefined &&
      !allowedIdentifiers.includes(identifier)
    ) {
      throw new Error(`${parsed.intent.type} does not accept ${flag}`);
    }
  }
  return parsed;
}

function boundedOutputValue(value, key) {
  if (key === "body" && typeof value === "string") {
    return {
      bodySha256: createHash("sha256").update(value).digest("hex"),
      bodyBytes: Buffer.byteLength(value),
    };
  }
  if (typeof value === "string") {
    return boundedDiagnostic(value);
  }
  if (Array.isArray(value)) {
    const bounded = value
      .slice(0, 100)
      .map((entry) => boundedOutputValue(entry, undefined));
    if (value.length > 100)
      bounded.push({ truncatedEntries: value.length - 100 });
    return bounded;
  }
  if (value && typeof value === "object") {
    const entries = [];
    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (entryKey === "body" && typeof entryValue === "string") {
        entries.push(
          ...Object.entries(boundedOutputValue(entryValue, entryKey)),
        );
      } else {
        entries.push([entryKey, boundedOutputValue(entryValue, entryKey)]);
      }
    }
    return Object.fromEntries(entries);
  }
  return value;
}

export async function main(
  args,
  { github, policy, verify, stdout = console.log, stderr = console.error },
) {
  let command;
  try {
    command = parseReconciliationArgs(args);
  } catch (error) {
    stderr(`${error.message}\n${USAGE}`);
    return 2;
  }
  if (
    command.intent.type === "publish" &&
    !policy.issues.has(command.intent.issueNumber) &&
    !command.intent.area
  ) {
    stderr(`publish requires --issue and --area\n${USAGE}`);
    return 2;
  }
  const protectedIssue = policy.issues.get(command.intent.issueNumber);
  if (
    command.intent.type === "publish" &&
    protectedIssue &&
    command.intent.area &&
    command.intent.area !== protectedIssue.area
  ) {
    stderr(
      `Protected #${command.intent.issueNumber} requires Area ${protectedIssue.area}\n${USAGE}`,
    );
    return 2;
  }
  let result;
  try {
    result = await runRentCottageReconciliation(command, {
      github,
      policy,
      verify,
    });
  } catch (error) {
    stderr(`Tracker reconciliation failed: ${errorDiagnostic(error)}`);
    return 1;
  }
  stdout(JSON.stringify(boundedOutputValue(result), null, 2));
  if (result.outcome === "blocked") return 4;
  if (result.outcome === "failed") return 1;
  if (result.outcome === "plan") return 3;
  if (result.outcome === "noop") return 5;
  return 0;
}

export function verifyBoard({
  execute = execFileSync,
  timeoutMs = 60_000,
} = {}) {
  try {
    execute("npm", ["run", "verify:board"], {
      stdio: "inherit",
      timeout: timeoutMs,
    });
    return { ok: true };
  } catch (error) {
    if (error.code === "ETIMEDOUT" || error.killed === true) {
      return {
        ok: false,
        message: `npm run verify:board timed out after ${timeoutMs}ms`,
      };
    }
    return {
      ok: false,
      message: `npm run verify:board exited ${error.status ?? "without a status"}`,
    };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const policy = createRentCottageTrackerPolicy();
  const source = createRentCottageGhSource({
    repository: policy.repository,
    projectOwner: policy.projectOwner,
    projectNumber: policy.projectNumber,
  });
  const github = createRentCottageGitHubAdapter({ source, policy });
  main(process.argv.slice(2), { github, policy, verify: verifyBoard })
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(`Tracker reconciliation failed: ${errorDiagnostic(error)}`);
      process.exitCode = 1;
    });
}
