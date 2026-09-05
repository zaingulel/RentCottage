import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { pathToFileURL } from "node:url";

const USAGE =
  "Usage: npm run verify [-- [--baseline|--database|--browser] [--full]]";

export const baselineVerificationSteps = [
  ["npm", ["run", "audit:production"]],
  ["npm", ["run", "format:check"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["test"]],
  ["npm", ["run", "cf-typegen"]],
  [
    "git",
    [
      "diff",
      "--exit-code",
      "--ignore-space-at-eol",
      "--",
      "cloudflare-env.d.ts",
    ],
  ],
];

export const expensiveVerificationSteps = [
  ["npm", ["run", "verify:access"]],
  ["npm", ["run", "build:worker"]],
  ["npm", ["run", "scan:client-secrets"]],
  ["npm", ["run", "test:browser"]],
  [
    "npm",
    [
      "run",
      "smoke:preview",
      "--",
      "--config=playwright.worker-prebuilt.config.ts",
    ],
  ],
];

const approvedProsePaths = new Set([
  ".agents/roles/architect.md",
  ".agents/roles/builder.md",
  ".agents/roles/explorer.md",
  ".agents/roles/oracle.md",
  ".agents/roles/plan-reviewer.md",
  ".agents/roles/reviewer.md",
  ".agents/roles/security-reviewer.md",
  ".agents/skills/closeout/SKILL.md",
  ".agents/skills/handoff/SKILL.md",
  ".agents/skills/resume/SKILL.md",
  ".agents/skills/security-code-review/SKILL.md",
  ".agents/templates/builder-handoff.md",
  ".claude/agents/architect.md",
  ".claude/agents/builder-lite.md",
  ".claude/agents/builder-max.md",
  ".claude/agents/builder.md",
  ".claude/agents/explorer.md",
  ".claude/agents/oracle.md",
  ".claude/agents/plan-reviewer.md",
  ".claude/agents/reviewer.md",
  ".claude/agents/security-reviewer.md",
  ".claude/templates/builder-handoff.md",
  ".github/pull_request_template.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md",
  "docs/adr/0001-cloudflare-workers-supabase-stack.md",
  "docs/agents/delivery.md",
  "docs/agents/domain.md",
  "docs/agents/issue-tracker.md",
  "docs/agents/triage-labels.md",
  "docs/commercial/founder-equity-discussion.md",
  "docs/commercial/muntajaa-cost-plan.md",
  "docs/demo.md",
  "docs/discovery/client-questions.md",
  "docs/discovery/design-brief.md",
  "docs/engineering/coding-standards.md",
  "docs/engineering/testing-strategy.md",
  "docs/product/rentcottage-mvp-prd.md",
  "docs/research/ajirly-and-iraq-booking-constraints.md",
  "docs/research/rentcottage-unresolved-commercial-compliance-research.md",
]);

const testEnvironment = {
  APP_ENVIRONMENT: "test",
  NEXTJS_ENV: "test",
  SUPABASE_PROJECT_REF: "local-test",
  SUPABASE_URL: "http://127.0.0.1:54331",
  SUPABASE_PUBLISHABLE_KEY: "local-test-publishable",
  SUPABASE_SECRET_KEY: "local-test-secret",
  PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
};

function runStep(command, args, environment, cwd) {
  return spawnSync(command, args, {
    cwd,
    env: environment,
    stdio: "inherit",
  });
}

function runGit(cwd, args) {
  return spawnSync("git", args, {
    cwd,
    encoding: null,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function gitOutput(cwd, args) {
  const result = runGit(cwd, args);
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`git was terminated by ${result.signal}`);
  if (result.status !== 0) {
    const detail = result.stderr?.toString("utf8").trim();
    throw new Error(detail || `git ${args.join(" ")} exited ${result.status}`);
  }
  return result.stdout;
}

function textOutput(cwd, args) {
  const output = gitOutput(cwd, args).toString("utf8").trim();
  if (output.includes("\uFFFD")) throw new Error("Git returned malformed text");
  return output;
}

function parseRawDiff(output) {
  if (output.length === 0) return [];
  const text = output.toString("utf8");
  if (text.includes("\uFFFD") || !text.endsWith("\0")) {
    throw new Error("Git returned a malformed NUL-delimited diff");
  }
  const fields = text.slice(0, -1).split("\0");
  if (fields.length % 2 !== 0) {
    throw new Error("Git returned a malformed raw diff");
  }

  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    const metadata = fields[index].match(
      /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])$/,
    );
    const path = fields[index + 1];
    if (!metadata || path.length === 0) {
      throw new Error("Git returned a malformed raw diff entry");
    }
    changes.push({
      newMode: metadata[2],
      oldMode: metadata[1],
      path,
      status: metadata[3],
    });
  }
  return changes;
}

function diffChanges(cwd, args) {
  return parseRawDiff(
    gitOutput(cwd, ["diff", "--raw", "--no-renames", "-z", ...args]),
  );
}

function regularOrAbsent(mode) {
  return mode === "000000" || mode.startsWith("100");
}

function classifyChanges(changes) {
  if (changes.length === 0) {
    return { expensive: false, reason: "no changed paths" };
  }

  for (const change of changes) {
    if (
      change.status === "T" ||
      !regularOrAbsent(change.oldMode) ||
      !regularOrAbsent(change.newMode)
    ) {
      return {
        expensive: true,
        reason: `${change.path} has a symlink or file-type change`,
      };
    }
    if (!approvedProsePaths.has(change.path)) {
      return {
        expensive: true,
        reason: `${change.path} requires full evidence`,
      };
    }
  }

  const paths = [...new Set(changes.map(({ path }) => path))].sort();
  return {
    expensive: false,
    reason: `only approved prose changed: ${paths.join(", ")}`,
  };
}

function localSelection(cwd, stdout) {
  if (textOutput(cwd, ["rev-parse", "--is-shallow-repository"]) !== "false") {
    throw new Error("Git history is shallow");
  }
  const mergeBase = textOutput(cwd, ["merge-base", "origin/main", "HEAD"]);
  const head = textOutput(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]);
  stdout(`Git comparison: merge base ${mergeBase}; HEAD ${head}`);

  const changes = [
    ...diffChanges(cwd, [`${mergeBase}..HEAD`]),
    ...diffChanges(cwd, ["--cached"]),
    ...diffChanges(cwd, []),
  ];
  const untracked = gitOutput(cwd, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const untrackedText = untracked.toString("utf8");
  if (untrackedText.includes("\uFFFD") || !untrackedText.endsWith("\0")) {
    if (untracked.length !== 0) {
      throw new Error("Git returned malformed untracked paths");
    }
  } else {
    for (const path of untrackedText.slice(0, -1).split("\0")) {
      const stat = lstatSync(`${cwd}/${path}`);
      changes.push({
        newMode: stat.isFile() ? "100644" : "120000",
        oldMode: "000000",
        path,
        status: "A",
      });
    }
  }
  return classifyChanges(changes);
}

function resolveCommit(cwd, value, name) {
  if (!value || !/^[0-9a-f]{40,64}$/i.test(value)) {
    throw new Error(`${name} commit identifier is missing or malformed`);
  }
  return textOutput(cwd, ["rev-parse", "--verify", `${value}^{commit}`]);
}

function ciSelection(cwd, environment, stdout) {
  if (textOutput(cwd, ["rev-parse", "--is-shallow-repository"]) !== "false") {
    throw new Error("Git history is shallow");
  }
  const base = resolveCommit(cwd, environment.VERIFY_BASE_SHA, "base");
  const source = resolveCommit(cwd, environment.VERIFY_SOURCE_SHA, "source");
  const merge = textOutput(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const parents = textOutput(cwd, ["rev-list", "--parents", "-n", "1", merge])
    .split(" ")
    .slice(1);
  if (parents.length !== 2 || parents[0] !== base || parents[1] !== source) {
    throw new Error(
      "checked-out commit does not have the expected merge parents",
    );
  }
  stdout(`CI Git comparison: base ${base}; source ${source}; merge ${merge}`);
  return classifyChanges([
    ...diffChanges(cwd, [`${base}..${source}`]),
    ...diffChanges(cwd, [`${base}..${merge}`]),
  ]);
}

function selectVerification(cwd, environment, stdout, stderr) {
  try {
    return environment.GITHUB_ACTIONS === "true"
      ? ciSelection(cwd, environment, stdout)
      : localSelection(cwd, stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(
      `Unable to classify changes (${message}); selecting full verification.`,
    );
    return {
      expensive: true,
      reason: `classification unavailable: ${message}`,
    };
  }
}

export function main(
  args,
  {
    cwd = process.cwd(),
    environment = process.env,
    run = runStep,
    stderr = console.error,
    stdout = console.log,
  } = {},
) {
  const modes = args.filter((arg) => arg !== "--full");
  if (
    modes.length > 1 ||
    new Set(args).size !== args.length ||
    args.some(
      (arg) =>
        !["--baseline", "--database", "--browser", "--full"].includes(arg),
    )
  ) {
    stderr(USAGE);
    return 2;
  }

  const mode = modes[0];
  const baseline = mode === undefined || mode === "--baseline";
  const browser = mode === undefined || mode === "--browser";
  const verificationEnvironment = { ...environment, ...testEnvironment };
  const selection = args.includes("--baseline")
    ? { expensive: false, reason: "baseline mode" }
    : args.includes("--full")
      ? { expensive: true, reason: "explicit --full" }
      : selectVerification(cwd, environment, stdout, stderr);
  stdout(`Baseline verification: ${baseline ? "selected" : "unselected"}`);
  stdout(
    `Expensive verification: ${selection.expensive ? "selected" : "skipped"} (${selection.reason})`,
  );

  const preparation =
    browser && selection.expensive && environment.GITHUB_ACTIONS === "true"
      ? [["npx", ["playwright", "install", "--with-deps", "chromium"]]]
      : [];
  const expensiveSteps =
    mode === "--database"
      ? [["npm", ["run", "verify:access:database"]]]
      : mode === "--browser"
        ? [
            ["npm", ["run", "verify:access:browser"]],
            ...expensiveVerificationSteps.slice(1),
          ]
        : expensiveVerificationSteps;
  const steps = [
    ...(baseline ? baselineVerificationSteps : []),
    ...preparation,
    ...(selection.expensive ? expensiveSteps : []),
  ];
  for (let index = 0; index < steps.length; index += 1) {
    const [command, commandArgs] = steps[index];
    const result = run(command, commandArgs, verificationEnvironment, cwd);
    if (result.error) {
      stderr(
        `Unable to run ${command}: ${result.error.message}; ${steps.length - index - 1} later selected checks were not reached.`,
      );
      return 1;
    }
    if (result.signal) {
      stderr(
        `Unable to run ${command}: terminated by ${result.signal}; ${steps.length - index - 1} later selected checks were not reached.`,
      );
      return 1;
    }
    if (result.status !== 0) {
      stderr(
        `${command} ${commandArgs.join(" ")} failed; ${steps.length - index - 1} later selected checks were not reached.`,
      );
      return result.status ?? 1;
    }
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
