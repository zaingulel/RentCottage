import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const USAGE =
  "Usage: npm run verify [-- [--baseline|--database|--browser] [--full] [--plan]]";

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

const baselineOnlyPaths = new Set([
  ".github/pull_request_template.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md",
  "scripts/run-log.mjs",
  "scripts/run-log.test.mjs",
  // The self-hosted font unit test and the licences it reads. npm test proves both in
  // baseline. The licences ship from public/ like any asset, but their text cannot
  // change a rendered page or the Worker's behaviour. The .woff2 files and fonts.css
  // do change rendering, so they stay on the browser route.
  "public/fonts/OFL-almarai.txt",
  "public/fonts/OFL-changa.txt",
  "public/fonts/OFL-karla.txt",
  "src/app/fonts.test.ts",
  // The board, git-guard and agent-handoff toolkits. npm test proves these in baseline through the
  // node --test suite, except scripts/board-move.mjs, which is argv parsing over proved
  // helpers; their reach is GitHub, local Git or agent dispatch, never Supabase, the Worker or
  // a browser. Exact names, never directory wildcards: these directories also hold
  // Supabase, Worker and browser fixtures, which do need the expensive route.
  "scripts/board.mjs",
  "scripts/board-add.mjs",
  "scripts/board-move.mjs",
  "scripts/lib/board.mjs",
  "scripts/lib/board.test.mjs",
  "scripts/lib/board-add.mjs",
  "scripts/lib/board-add.test.mjs",
  "scripts/lib/board-cli.test.mjs",
  "scripts/lib/board-config.mjs",
  "scripts/lib/board-fixtures.mjs",
  "scripts/lib/board-move.mjs",
  "scripts/lib/board-move.test.mjs",
  "scripts/lib/board-rules.mjs",
  "scripts/lib/board-rules.test.mjs",
  "scripts/lib/checkout-context.mjs",
  "scripts/lib/checkout-context.test.mjs",
  "scripts/lib/cli-flags.mjs",
  "scripts/lib/cli-flags.test.mjs",
  "scripts/lib/fake-gh.mjs",
  "scripts/lib/gh-exec.mjs",
  "scripts/lib/gh-exec.test.mjs",
  "scripts/lib/codex-hook-adapters.mjs",
  "scripts/lib/codex-hook-adapters.test.mjs",
  "scripts/lib/handoff-check.mjs",
  "scripts/lib/handoff-check.test.mjs",
  "scripts/lib/unsafe-git.mjs",
  "scripts/lib/unsafe-git.test.mjs",
  ".claude/hooks/check-builder-handoff.mjs",
  ".claude/settings.json",
  ".codex/hooks.json",
  ".codex/hooks/check-builder-handoff.mjs",
]);

function isBaselineOnlyPath(path) {
  return (
    baselineOnlyPaths.has(path) ||
    /^\.agents\/(?:roles|skills|templates)\/.+\.md$/i.test(path) ||
    /^\.claude\/(?:agents|templates)\/.+\.md$/i.test(path) ||
    /^\.codex\/agents\/[^/]+\.toml$/i.test(path) ||
    /^docs\/.+\.(?:avif|docx|gif|jpe?g|md|png|svg|webp)$/i.test(path)
  );
}

const browserOnlyPaths = new Set([
  "src/app/fonts.css",
  "src/app/globals.css",
  "tests/booking-request-display.spec.ts",
  "tests/interaction-controls.spec.ts",
  "tests/marketplace-shell.spec.ts",
]);

function isBrowserOnlyPath(path) {
  return (
    browserOnlyPaths.has(path) ||
    /^public\/fonts\/[^/]+\.woff2$/i.test(path) ||
    /^public\/uploads\/[^/]+\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(path)
  );
}

const fullEvidenceRootPaths = new Set([
  ".nvmrc",
  "cloudflare-env.d.ts",
  "custom-worker.ts",
  "eslint.config.mjs",
  "next-env.d.ts",
  "next.config.ts",
  "open-next.config.ts",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
  "vitest.config.ts",
  "vitest.setup.ts",
  "wrangler.jsonc",
]);

function requiresFullEvidence(path) {
  return (
    fullEvidenceRootPaths.has(path) ||
    /^(?:\.github\/workflows|public|scripts|src|supabase|tests|translation)\/.+$/.test(
      path,
    ) ||
    /^playwright[^/]*\.config\.ts$/.test(path) ||
    /^\.(?:env|dev\.vars)[^/]*\.example$/.test(path)
  );
}

const testEnvironment = {
  APP_ENVIRONMENT: "test",
  NEXTJS_ENV: "test",
  SUPABASE_PROJECT_REF: "local-test",
  SUPABASE_URL: "http://127.0.0.1:54331",
  SUPABASE_PUBLISHABLE_KEY: "local-test-publishable",
  SUPABASE_SECRET_KEY: "local-test-secret",
  PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
};

const lockedDependencies = ["wrangler", "workerd"];

function lockfileVersion(cwd, packageName) {
  try {
    const lockfile = JSON.parse(
      readFileSync(`${cwd}/package-lock.json`, "utf8"),
    );
    const version = lockfile.packages?.[`node_modules/${packageName}`]?.version;
    return typeof version === "string" && version.length > 0
      ? { value: version }
      : {
          problem:
            "expected version cannot be established from package-lock.json",
        };
  } catch {
    return {
      problem: "expected version cannot be established from package-lock.json",
    };
  }
}

function installedVersion(cwd, packageName) {
  try {
    const manifest = JSON.parse(
      readFileSync(`${cwd}/node_modules/${packageName}/package.json`, "utf8"),
    );
    return typeof manifest.version === "string" && manifest.version.length > 0
      ? { value: manifest.version }
      : { problem: "observed installed version is unreadable" };
  } catch (error) {
    return {
      problem:
        error && typeof error === "object" && error.code === "ENOENT"
          ? "observed installed version missing"
          : "observed installed version is unreadable",
    };
  }
}

function checkLockedDependencies(cwd, stderr) {
  const failures = [];
  for (const packageName of lockedDependencies) {
    const expected = lockfileVersion(cwd, packageName);
    const observed = installedVersion(cwd, packageName);
    if (expected.value === observed.value && expected.value !== undefined) {
      continue;
    }
    failures.push(
      `- ${packageName}: ${
        expected.value ? `expected ${expected.value}` : expected.problem
      }; ${observed.value ? `observed ${observed.value}` : observed.problem}.`,
    );
  }
  if (failures.length === 0) return true;
  stderr(
    [
      "Dependency preflight stopped verification:",
      ...failures,
      "Run npm ci to install the locked dependencies before verification.",
    ].join("\n"),
  );
  return false;
}

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

function nonExecutableRegularOrAbsent(mode) {
  return mode === "000000" || mode === "100644";
}

function classifyChanges(changes) {
  if (changes.length === 0) {
    return { browser: false, database: false, reason: "no changed paths" };
  }

  let browser = false;
  let fullReason;
  const unclassified = new Set();
  for (const change of changes) {
    if (change.oldMode === "100755" || change.newMode === "100755") {
      fullReason ??= `${change.path} is executable or has an executable-mode change`;
      continue;
    }
    if (
      change.status === "T" ||
      !nonExecutableRegularOrAbsent(change.oldMode) ||
      !nonExecutableRegularOrAbsent(change.newMode)
    ) {
      fullReason ??= `${change.path} has a symlink or file-type change`;
      continue;
    }
    if (isBaselineOnlyPath(change.path)) continue;
    if (isBrowserOnlyPath(change.path)) {
      browser = true;
      continue;
    }
    if (requiresFullEvidence(change.path)) {
      fullReason ??= `${change.path} requires full evidence`;
      continue;
    }
    unclassified.add(change.path);
  }

  if (unclassified.size > 0) {
    return { unclassified: [...unclassified].sort() };
  }
  if (fullReason) {
    return { browser: true, database: true, reason: fullReason };
  }

  const paths = [...new Set(changes.map(({ path }) => path))].sort();
  return {
    browser,
    database: false,
    reason: browser
      ? `only reviewed presentation inputs changed: ${paths.join(", ")}`
      : `only approved workflow or prose changed: ${paths.join(", ")}`,
  };
}

function localSelection(cwd, stdout) {
  if (textOutput(cwd, ["rev-parse", "--is-shallow-repository"]) !== "false") {
    throw new Error("Git history is shallow");
  }
  const mergeBase = uniqueMergeBase(cwd, "origin/main", "HEAD");
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
        newMode: stat.isFile()
          ? (stat.mode & 0o111) === 0
            ? "100644"
            : "100755"
          : "120000",
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

function uniqueMergeBase(cwd, left, right) {
  const output = textOutput(cwd, ["merge-base", "--all", left, right]);
  const mergeBases = output.split(/\s+/).filter(Boolean);
  if (mergeBases.length !== 1) {
    throw new Error("Git history does not have exactly one merge base");
  }
  return resolveCommit(cwd, mergeBases[0], "merge base");
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
  const mergeBase = uniqueMergeBase(cwd, base, source);
  stdout(
    `CI Git comparison: merge base ${mergeBase}; base ${base}; source ${source}; merge ${merge}`,
  );
  return classifyChanges([
    ...diffChanges(cwd, [`${mergeBase}..${source}`]),
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
      browser: true,
      database: true,
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
  const modes = args.filter((arg) => !["--full", "--plan"].includes(arg));
  if (
    modes.length > 1 ||
    new Set(args).size !== args.length ||
    args.some(
      (arg) =>
        !["--baseline", "--database", "--browser", "--full", "--plan"].includes(
          arg,
        ),
    )
  ) {
    stderr(USAGE);
    return 2;
  }

  const mode = modes[0];
  const plan = args.includes("--plan");
  const baseline = mode === undefined || mode === "--baseline";
  const browser = mode === undefined || mode === "--browser";
  const verificationEnvironment = { ...environment, ...testEnvironment };
  const selection = args.includes("--baseline")
    ? { browser: false, database: false, reason: "baseline mode" }
    : args.includes("--full")
      ? { browser: true, database: true, reason: "explicit --full" }
      : selectVerification(cwd, environment, stdout, stderr);
  if (selection.unclassified) {
    const count = selection.unclassified.length;
    stderr(
      [
        `Verification stopped: ${count} changed ${count === 1 ? "path is" : "paths are"} not listed in any verification route.`,
        ...selection.unclassified,
        "Without a classification the fallback would select full verification, which runs the database and browser checks.",
        "Nothing ran. Decide the route either by listing the paths above in scripts/verify.mjs, or by running again with an explicit --full or --baseline. Only those two bypass classification; --database and --browser still consult it and stop here again.",
      ].join("\n"),
    );
    return 3;
  }
  const selectedDatabase = mode === "--browser" ? false : selection.database;
  const selectedBrowser = mode === "--database" ? false : selection.browser;
  const expensive = selectedDatabase || selectedBrowser;
  stdout(`Baseline verification: ${baseline ? "selected" : "unselected"}`);
  stdout(
    `Database verification: ${selectedDatabase ? "selected" : "skipped"} (${selection.reason})`,
  );
  stdout(
    `Browser verification: ${selectedBrowser ? "selected" : "skipped"} (${selection.reason})`,
  );
  stdout(
    `Expensive verification: ${expensive ? "selected" : "skipped"} (${selection.reason})`,
  );

  const preparation =
    browser && selectedBrowser && environment.GITHUB_ACTIONS === "true"
      ? [["npx", ["playwright", "install", "--with-deps", "chromium"]]]
      : [];
  const databaseSteps = [["npm", ["run", "verify:access:database"]]];
  const browserSteps = [
    ["npm", ["run", "verify:access:browser"]],
    ...expensiveVerificationSteps.slice(1),
  ];
  const selectedServiceSteps =
    mode === undefined && selectedDatabase && selectedBrowser
      ? expensiveVerificationSteps
      : [
          ...(selectedDatabase ? databaseSteps : []),
          ...(selectedBrowser ? browserSteps : []),
        ];
  const steps = [
    ...(baseline ? baselineVerificationSteps : []),
    ...preparation,
    ...selectedServiceSteps,
  ];
  if (plan) {
    stdout(
      `Verification scope: ${mode === undefined ? "all groups" : mode.slice(2)}`,
    );
    for (const [command, commandArgs] of steps) {
      stdout(`Planned command: ${JSON.stringify([command, ...commandArgs])}`);
    }
    stdout(
      steps.length > 0
        ? "Dependency preflight: Wrangler and Workerd will be checked before execution; not run in plan-only mode."
        : "Dependency preflight: unnecessary because no verification commands are selected.",
    );
    stdout("Plan only: no verification ran.");
    return 0;
  }
  if (steps.length > 0 && !checkLockedDependencies(cwd, stderr)) return 1;
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
