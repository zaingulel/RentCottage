import { spawnSync } from "node:child_process";
// Namespace operations expose private-state faults; named dependency/source reads stay outside them.
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname, join, delimiter, relative, isAbsolute } from "node:path";
import { release } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const groupVerificationSteps = {
  database: [["npm", ["run", "verify:access:database"]]],
  browser: [
    ["npm", ["run", "verify:access:browser"]],
    ...expensiveVerificationSteps.slice(1),
  ],
};

function serviceVerificationSteps(mode, database, browser) {
  return mode === undefined && database && browser
    ? expensiveVerificationSteps
    : [
        ...(database ? groupVerificationSteps.database : []),
        ...(browser ? groupVerificationSteps.browser : []),
      ];
}

const accessCommandContracts = {
  "verify:access": {
    groups: ["database", "browser"],
    completedGroups: ["database"],
    failureRecipe: {
      reproduceSelectedGroups: ["npm", "run", "verify", "--", "--full"],
    },
  },
  "verify:access:database": {
    groups: ["database"],
    completedGroups: ["database"],
    failureRecipe: {
      reproduceGroup: ["npm", "run", "verify", "--", "--database", "--full"],
    },
  },
  "verify:access:browser": {
    groups: ["browser"],
    completedGroups: [],
    failureRecipe: {
      reproduceGroup: ["npm", "run", "verify", "--", "--browser", "--full"],
    },
  },
};

const baselineOnlyPaths = new Set([
  ".github/pull_request_template.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md",
  "scripts/run-log.mjs",
  "scripts/lib/run-log.test.mjs",
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
  ".agents/factory-manifest.json",
  "scripts/board.mjs",
  "scripts/board-add.mjs",
  "scripts/board-move.mjs",
  "scripts/factory-sync.mjs",
  "scripts/merge-watch.mjs",
  "scripts/lib/merge-watch.mjs",
  "scripts/lib/merge-watch.test.mjs",
  "scripts/verify-issue-publish.mjs",
  "scripts/doc-lint.mjs",
  "scripts/sweep-scope-check.mjs",
  "scripts/lib/board.mjs",
  "scripts/lib/board.test.mjs",
  "scripts/lib/board-add.mjs",
  "scripts/lib/board-add.test.mjs",
  "scripts/lib/board-cli.test.mjs",
  "scripts/lib/board-config.mjs",
  "scripts/lib/board-fixtures.mjs",
  "scripts/lib/board-move.mjs",
  "scripts/lib/board-move.test.mjs",
  "scripts/lib/board-portability.test.mjs",
  "scripts/lib/board-rules.mjs",
  "scripts/lib/board-rules.test.mjs",
  "scripts/lib/checkout-context.mjs",
  "scripts/lib/checkout-context.test.mjs",
  "scripts/lib/cli-flags.mjs",
  "scripts/lib/cli-flags.test.mjs",
  "scripts/lib/fake-gh.mjs",
  "scripts/lib/gh-exec.mjs",
  "scripts/lib/gh-exec.test.mjs",
  "scripts/lib/issue-publish.mjs",
  "scripts/lib/issue-publish.test.mjs",
  "scripts/lib/check-agents.mjs",
  "scripts/lib/check-agents.test.mjs",
  "scripts/lib/codex-hook-adapters.mjs",
  "scripts/lib/codex-hook-adapters.test.mjs",
  "scripts/lib/codex-browser-policy.test.mjs",
  "scripts/lib/product-manual.test.mjs",
  "scripts/lib/factory-sync.mjs",
  "scripts/lib/factory-sync.test.mjs",
  "scripts/lib/handoff-check.mjs",
  "scripts/lib/handoff-check.test.mjs",
  "scripts/lib/precommit.test.mjs",
  "scripts/lib/prepush.test.mjs",
  "scripts/lib/settings-policy.test.mjs",
  "scripts/lib/sweep-scope-corpus.mjs",
  "scripts/lib/sweep-scope.mjs",
  "scripts/lib/sweep-scope.test.mjs",
  "scripts/lib/sweep-scope-workflow.test.mjs",
  "scripts/lib/test-output-filter.mjs",
  "scripts/lib/test-output-filter.test.mjs",
  "scripts/lib/unsafe-git.mjs",
  "scripts/lib/unsafe-git.test.mjs",
  "scripts/lib/verify-green.test.mjs",
  "scripts/lib/workflow-contract.test.mjs",
  "scripts/lib/doc-lint.mjs",
  "scripts/lib/doc-lint.test.mjs",
  "scripts/lib/doc-lint-links.mjs",
  "scripts/lib/doc-lint-links.test.mjs",
  "scripts/lib/doc-lint-citations.mjs",
  "scripts/lib/doc-lint-citations.test.mjs",
  ".githooks/.gitattributes",
  ".githooks/README.md",
  ".githooks/pre-commit",
  ".githooks/pre-merge-commit",
  ".githooks/pre-push",
  ".claude/hooks/.gitattributes",
  ".claude/hooks/block-unsafe-git.mjs",
  ".claude/hooks/check-builder-handoff.mjs",
  ".claude/hooks/filter-test-output.mjs",
  ".claude/hooks/test-output-filter-run.mjs",
  ".claude/hooks/verify-green.sh",
  ".claude/settings.json",
  ".codex/hooks.json",
  ".codex/hooks/.gitattributes",
  ".codex/hooks/block-unsafe-git.mjs",
  ".codex/hooks/check-builder-handoff.mjs",
  ".codex/hooks/verify-green.mjs",
  ".codex/hooks/verify-green.sh",
  ".codex/rules/playwright.rules",
]);

// These are executable command entry points by design. Their exact paths are baseline-only, but a
// chmod between executable and non-executable still selects full evidence. No directory wildcard may
// enter this set.
const baselineExecutablePaths = new Set([
  ".githooks/pre-commit",
  ".githooks/pre-merge-commit",
  ".githooks/pre-push",
  "scripts/board.mjs",
]);

function isBaselineOnlyPath(path) {
  return (
    baselineOnlyPaths.has(path) ||
    /^\.agents\/(?:roles|skills|templates)\/.+\.md$/i.test(path) ||
    /^\.agents\/skills\/[^/]+\/agents\/openai\.yaml$/i.test(path) ||
    /^\.agents\/upstream\/mattpocock-skills\/(?:LICENSE|.+\.(?:md|yaml))$/i.test(
      path,
    ) ||
    /^\.claude\/skills\/[^/]+\/(?:.+\.md|agents\/openai\.yaml)$/i.test(path) ||
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
  ".gitattributes",
  ".gitignore",
  ".nvmrc",
  ".prettierignore",
  ".prettierrc.json",
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

export function classifyChanges(changes) {
  if (changes.length === 0) {
    return { browser: false, database: false, reason: "no changed paths" };
  }

  let browser = false;
  let fullReason;
  const unclassified = new Set();
  for (const change of changes) {
    if (change.oldMode === "100755" || change.newMode === "100755") {
      if (
        baselineExecutablePaths.has(change.path) &&
        [change.oldMode, change.newMode].every(
          (mode) => mode === "000000" || mode === "100755",
        )
      ) {
        continue;
      }
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

const digest = (value) => createHash("sha256").update(value).digest("hex");
const digestPattern = /^[0-9a-f]{64}$/;
const tokenPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function gitRecords(cwd, args, layer) {
  const output = gitOutput(cwd, args).toString("utf8");
  if (output.includes("\uFFFD") || (output && !output.endsWith("\0"))) {
    throw new Error("source records unavailable");
  }
  return output
    ? output
        .slice(0, -1)
        .split("\0")
        .map((entry) => {
          const match = entry.match(
            layer === "index"
              ? /^(\d{6}) ([0-9a-f]+) 0\t(.+)$/s
              : /^(\d{6}) blob ([0-9a-f]+)\t(.+)$/s,
          );
          if (!match) throw new Error("source records unavailable");
          return { mode: match[1], object: match[2], path: match[3] };
        })
    : [];
}

const bookkeepingEnvironmentKeys = new Set([
  "RUN_LOG_RERUN_REASON",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_PID",
  "CODEX_SESSION_ID",
  "STARSHIP_SESSION_KEY",
  "_",
  "OLDPWD",
]);

function captureLocalEvidenceInputs(
  cwd,
  environment,
  group,
  commands,
  captureRuntimeContract,
) {
  try {
    if (textOutput(cwd, ["rev-parse", "--is-shallow-repository"]) !== "false") {
      throw new Error("Git history is shallow");
    }
    const base = textOutput(cwd, [
      "rev-parse",
      "--verify",
      "origin/main^{commit}",
    ]);
    const mergeBase = uniqueMergeBase(cwd, "origin/main", "HEAD");
    const head = textOutput(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]);
    const headRecords = gitRecords(cwd, ["ls-tree", "-rz", "HEAD"], "head");
    const indexRecords = gitRecords(
      cwd,
      ["ls-files", "--stage", "-z"],
      "index",
    );
    const baseRecords = gitRecords(cwd, ["ls-tree", "-rz", mergeBase], "head");
    const untracked = gitOutput(cwd, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ]).toString("utf8");
    if (
      untracked.includes("\uFFFD") ||
      (untracked && !untracked.endsWith("\0"))
    )
      throw new Error("source records unavailable");
    const paths = [
      ...new Set(
        [...headRecords, ...indexRecords, ...baseRecords]
          .map(({ path }) => path)
          .concat(untracked ? untracked.slice(0, -1).split("\0") : []),
      ),
    ].sort();
    const layers = [];
    for (const path of paths) {
      const headRecord = headRecords.find((entry) => entry.path === path);
      const indexRecord = indexRecords.find((entry) => entry.path === path);
      const baseRecord = baseRecords.find((entry) => entry.path === path);
      let working;
      try {
        const stat = lstatSync(join(cwd, path));
        const mode = stat.isFile()
          ? stat.mode & 0o111
            ? "100755"
            : "100644"
          : stat.isSymbolicLink()
            ? "120000"
            : "unsupported";
        if (mode === "unsupported") throw new Error("unsupported source type");
        working = {
          mode,
          content: digest(
            mode === "120000"
              ? readlinkSync(join(cwd, path))
              : readFileSync(join(cwd, path)),
          ),
        };
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const modes = [baseRecord, headRecord, indexRecord, working].map(
        (record) => record?.mode ?? "000000",
      );
      const policy = classifyChanges(
        modes.slice(1).map((mode, i) => ({
          path,
          oldMode: modes[i],
          newMode: mode,
          status: "M",
        })),
      );
      if (!policy.unclassified && !policy[group]) continue;
      if (
        [headRecord, indexRecord, working].some(
          (record) => record?.mode === "120000",
        )
      ) {
        return { unavailable: "source symlink prevents reuse" };
      }
      const record = (entry) =>
        entry
          ? {
              mode: entry.mode,
              content: digest(entry.object),
            }
          : null;
      layers.push({
        path,
        head: record(headRecord),
        index: record(indexRecord),
        working: working ?? null,
      });
    }
    const runtime = captureRuntimeContract(cwd, environment, group);
    if (runtime.unavailable) return runtime;
    if (
      !digestPattern.test(runtime.digest) ||
      !validDockerReferences(runtime.dockerReferences)
    )
      throw new Error("runtime contract unavailable");
    return {
      identity: {
        inputDigest: digest(
          JSON.stringify({
            cwd: realpathSync(cwd),
            base,
            mergeBase,
            layers,
            commands,
            environment: Object.entries(environment)
              .filter(([key]) => !bookkeepingEnvironmentKeys.has(key))
              .sort(([left], [right]) => left.localeCompare(right)),
            runtime: runtime.digest,
            verifier: digest(readFileSync(fileURLToPath(import.meta.url))),
          }),
        ),
        dockerReferences: runtime.dockerReferences,
      },
      head,
      base,
    };
  } catch {
    return { unavailable: "source or runtime contract unavailable" };
  }
}

function validDockerReferences(references) {
  return (
    Array.isArray(references) &&
    references.length <= 10000 &&
    references.every(
      (pair, i) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        pair.every(
          (value) => typeof value === "string" && digestPattern.test(value),
        ) &&
        (i === 0 || references[i - 1][0] < pair[0]),
    )
  );
}

function preservesImages(before, after) {
  return before.every(([reference, id]) =>
    after.some(
      ([currentReference, currentId]) =>
        reference === currentReference && id === currentId,
    ),
  );
}

function evidencePath(cwd, group, suffix) {
  return join(
    textOutput(cwd, ["rev-parse", "--absolute-git-dir"]),
    "rentcottage-verification",
    `${group}.${suffix}.json`,
  );
}

function validateEvidenceDirectory(path) {
  const stat = lstatSync(dirname(path));
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0)
    throw new Error("invalid local evidence directory");
}

function readPrivateJson(path) {
  validateEvidenceDirectory(path);
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024 * 1024 || (stat.mode & 0o077) !== 0)
      throw new Error("invalid local evidence");
    const contents = fs.readFileSync(fd, "utf8");
    if (Buffer.byteLength(contents) > 1024 * 1024)
      throw new Error("invalid local evidence");
    return JSON.parse(contents);
  } finally {
    fs.closeSync(fd);
  }
}

function readLocalGroupEvidence(cwd, group, identity) {
  try {
    const record = readPrivateJson(evidencePath(cwd, group, "success"));
    const marker = readPrivateJson(evidencePath(cwd, group, "attempt"));
    if (
      record.version !== 1 ||
      record.group !== group ||
      typeof record.token !== "string" ||
      !tokenPattern.test(record.token) ||
      marker.version !== 1 ||
      marker.group !== group ||
      record.token !== marker.token ||
      !digestPattern.test(record.identity?.inputDigest) ||
      !validDockerReferences(record.identity?.dockerReferences) ||
      typeof record.head !== "string" ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(record.head) ||
      typeof record.base !== "string" ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(record.base) ||
      record.commandDigest !==
        digest(JSON.stringify(groupVerificationSteps[group])) ||
      typeof record.completedAt !== "string" ||
      new Date(record.completedAt).toISOString() !== record.completedAt ||
      record.identity.inputDigest !== identity.inputDigest ||
      !preservesImages(
        record.identity.dockerReferences,
        identity.dockerReferences,
      )
    )
      return { reuse: false };
    return { reuse: true, head: record.head, base: record.base };
  } catch {
    return { reuse: false };
  }
}

function writePrivateJson(path, value, durableMarker = false) {
  let step = "directory preparation";
  let temporary;
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > 1024 * 1024)
      throw new Error("local evidence exceeds the record bound");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    validateEvidenceDirectory(path);
    temporary = `${path}.${randomUUID()}.tmp`;
    step = "marker write";
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, serialized);
      step = "file flush";
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    step = "atomic replacement";
    fs.renameSync(temporary, path);
    temporary = undefined;
    if (durableMarker) {
      step = "directory flush";
      const directory = fs.openSync(
        dirname(path),
        fs.constants.O_RDONLY |
          fs.constants.O_DIRECTORY |
          fs.constants.O_NOFOLLOW,
      );
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
    }
  } catch (error) {
    error.verificationStep = step;
    throw error;
  } finally {
    if (temporary) {
      try {
        fs.unlinkSync(temporary);
      } catch {
        /* A failed temporary file cannot certify success. */
      }
    }
  }
}

function beginLocalGroupAttempt(cwd, group) {
  let step = "marker installation";
  try {
    const token = randomUUID();
    const path = evidencePath(cwd, group, "attempt");
    writePrivateJson(path, { version: 1, group, token }, true);
    step = "marker readback";
    const marker = readPrivateJson(path);
    if (
      marker.version !== 1 ||
      marker.group !== group ||
      marker.token !== token
    )
      throw new Error("marker readback mismatch");
    return { token };
  } catch (error) {
    return { blocked: error.verificationStep ?? step };
  }
}

function completeLocalGroupAttempt(cwd, group, token, before, after) {
  if (
    !before.identity ||
    !after.identity ||
    before.identity.inputDigest !== after.identity.inputDigest ||
    !preservesImages(
      before.identity.dockerReferences,
      after.identity.dockerReferences,
    )
  )
    return false;
  try {
    if (readPrivateJson(evidencePath(cwd, group, "attempt")).token !== token)
      return false;
    writePrivateJson(evidencePath(cwd, group, "success"), {
      version: 1,
      group,
      token,
      commandDigest: digest(JSON.stringify(groupVerificationSteps[group])),
      identity: after.identity,
      head: after.head,
      base: after.base,
      completedAt: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

function captureNative(command, args, cwd, environment) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30000,
  });
  if (
    result.error ||
    result.signal ||
    result.status !== 0 ||
    typeof result.stdout !== "string" ||
    result.stdout.includes("\uFFFD")
  )
    throw new Error("native runtime observation unavailable");
  return result.stdout.trim();
}

function resolvedExecutable(name, cwd, environment) {
  for (const entry of (environment.PATH ?? "").split(delimiter)) {
    if (!entry) continue;
    const path = join(isAbsolute(entry) ? entry : join(cwd, entry), name);
    try {
      const canonical = realpathSync(path);
      const stat = lstatSync(canonical);
      if (stat.isFile() && stat.mode & 0o111)
        return {
          path: canonical,
          mode: stat.mode & 0o111,
          content: digest(readFileSync(canonical)),
        };
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    }
  }
  throw new Error("executable identity unavailable");
}

function installedContent(root, generatedResults = false) {
  if (!lstatSync(root).isDirectory())
    throw new Error("installed root is not a real directory");
  const canonical = realpathSync(root);
  const records = [];
  function walk(path, name, ancestors) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      if (
        generatedResults &&
        /^(?:\.vite|\.vite\/vitest|\.vite\/vitest\/[0-9a-f]{40})$/.test(name)
      )
        throw new Error("generated result ancestor is not a real directory");
      const link = readlinkSync(path);
      if (isAbsolute(link)) throw new Error("unbounded installed symlink");
      const target = realpathSync(path);
      const inside = relative(canonical, target);
      if (inside.startsWith("../") || inside === ".." || isAbsolute(inside))
        throw new Error("unbounded installed symlink");
      records.push([name, "symlink", link]);
      walk(target, `${name}/target`, ancestors);
    } else if (stat.isDirectory()) {
      const actual = realpathSync(path);
      if (ancestors.has(actual)) throw new Error("installed symlink cycle");
      const next = new Set(ancestors).add(actual);
      for (const child of readdirSync(path).sort())
        walk(join(path, child), name ? `${name}/${child}` : child, next);
    } else if (stat.isFile()) {
      if (
        generatedResults &&
        (stat.mode & 0o111) === 0 &&
        /^\.vite\/vitest\/[0-9a-f]{40}\/results\.json$/.test(name)
      )
        return;
      records.push([
        name,
        "file",
        stat.mode & 0o111,
        digest(readFileSync(path)),
      ]);
    } else {
      throw new Error("unsupported installed file type");
    }
  }
  walk(root, "", new Set());
  return { root: canonical, content: digest(JSON.stringify(records)) };
}

function captureDockerReferences(output) {
  const references = new Map();
  const rows = output ? output.split("\n") : [];
  if (rows.length > 10000) throw new Error("image contract unavailable");
  for (const row of rows) {
    const value = JSON.parse(row);
    if (
      !value ||
      ["Repository", "Tag", "Digest", "ID"].some(
        (key) =>
          typeof value[key] !== "string" ||
          !value[key] ||
          /[\s\u0000-\u001f]/.test(value[key]),
      ) ||
      !/^sha256:[0-9a-f]{64}$/.test(value.ID) ||
      (value.Digest !== "<none>" && !/^sha256:[0-9a-f]{64}$/.test(value.Digest))
    )
      throw new Error("image contract unavailable");
    if (value.Repository === "<none>") {
      if (value.Tag !== "<none>" || value.Digest !== "<none>")
        throw new Error("image contract unavailable");
      continue;
    }
    for (const reference of [
      value.Tag === "<none>" ? null : `${value.Repository}:${value.Tag}`,
      value.Digest === "<none>" ? null : `${value.Repository}@${value.Digest}`,
    ].filter(Boolean)) {
      const key = digest(reference);
      const id = digest(value.ID);
      if (references.has(key) && references.get(key) !== id)
        throw new Error("image contract unavailable");
      references.set(key, id);
    }
  }
  return [...references].sort(([left], [right]) => left.localeCompare(right));
}

function captureBrowserDistributions(node, cwd, environment) {
  const descriptors = JSON.parse(
    captureNative(
      node,
      [
        "-e",
        `const {createRequire}=require('node:module');const requireHere=createRequire(process.cwd()+'/package.json');const {registry}=requireHere('playwright-core/lib/coreBundle');console.log(JSON.stringify(['chromium','chromium-headless-shell'].map(name=>{const entry=registry.registry.findExecutable(name);return {name,directory:entry.directory,executable:entry.executablePath()}})));`,
      ],
      cwd,
      environment,
    ),
  );
  const names = ["chromium", "chromium-headless-shell"];
  if (!Array.isArray(descriptors) || descriptors.length !== names.length)
    throw new Error("browser descriptors unavailable");
  return descriptors.map((entry, index) => {
    if (
      !entry ||
      entry.name !== names[index] ||
      typeof entry.directory !== "string" ||
      typeof entry.executable !== "string" ||
      !isAbsolute(entry.directory) ||
      !isAbsolute(entry.executable)
    )
      throw new Error("browser descriptors unavailable");
    const root = realpathSync(entry.directory);
    const executable = realpathSync(entry.executable);
    const inside = relative(root, executable);
    const stat = lstatSync(executable);
    if (
      !inside ||
      inside === ".." ||
      inside.startsWith("../") ||
      isAbsolute(inside) ||
      !stat.isFile() ||
      !(stat.mode & 0o111)
    )
      throw new Error("browser executable unavailable");
    return {
      name: entry.name,
      executable: inside,
      distribution: installedContent(entry.directory),
    };
  });
}

function captureRuntimeContract(cwd, environment, group) {
  const suppliedOverride = [
    "SUPABASE_CLI_BINARY_OVERRIDE",
    "ESBUILD_BINARY_PATH",
    "MINIFLARE_WORKERD_PATH",
  ].find((name) => Object.hasOwn(environment, name));
  const externalOverride =
    suppliedOverride ??
    [
      "NODE_OPTIONS",
      "NODE_PATH",
      "PW_INSTRUMENT_MODULES",
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
      "DYLD_INSERT_LIBRARIES",
      "DYLD_LIBRARY_PATH",
    ].find((name) => environment[name]);
  if (externalOverride)
    return {
      unavailable: `${externalOverride}: external executable override prevents reuse`,
    };
  if (group === "browser") {
    const remote = ["SELENIUM_REMOTE_URL", "PW_TEST_CONNECT_WS_ENDPOINT"].find(
      (name) => environment[name],
    );
    if (remote)
      return { unavailable: `${remote}: remote browser prevents reuse` };
  }
  try {
    const executables = Object.fromEntries(
      ["node", "npm", "npx", "git", "docker"].map((name) => [
        name,
        resolvedExecutable(name, cwd, environment),
      ]),
    );
    const npmConfiguration = JSON.parse(
      captureNative(
        executables.npm.path,
        ["config", "list", "--json"],
        cwd,
        environment,
      ),
    );
    if (
      !npmConfiguration ||
      typeof npmConfiguration !== "object" ||
      Array.isArray(npmConfiguration)
    )
      throw new Error("npm configuration unavailable");
    const configPaths = [
      join(cwd, ".npmrc"),
      ...["userconfig", "globalconfig"].map((key) => {
        if (
          typeof npmConfiguration[key] !== "string" ||
          !isAbsolute(npmConfiguration[key])
        )
          throw new Error("npm configuration unavailable");
        return npmConfiguration[key];
      }),
      ...readdirSync(cwd)
        .filter((name) => /^(?:\.env|\.dev\.vars)/.test(name))
        .map((name) => join(cwd, name)),
    ];
    const configurations = configPaths.sort().map((path) => {
      try {
        const stat = lstatSync(path);
        if (!stat.isFile()) throw new Error("configuration type unavailable");
        return [path, digest(readFileSync(path))];
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return [path, null];
      }
    });
    const version = JSON.parse(
      captureNative(
        executables.docker.path,
        ["version", "--format", "{{json .}}"],
        cwd,
        environment,
      ),
    );
    if (
      ![version?.Client?.Version, version?.Server?.Version].every(
        (value) => typeof value === "string" && value,
      )
    )
      throw new Error("Docker version unavailable");
    const daemon = JSON.parse(
      captureNative(
        executables.docker.path,
        ["info", "--format", "{{json .ID}}"],
        cwd,
        environment,
      ),
    );
    const context = captureNative(
      executables.docker.path,
      ["context", "show"],
      cwd,
      environment,
    );
    if (typeof daemon !== "string" || !daemon || !context || /\s/.test(context))
      throw new Error("Docker identity unavailable");
    const dockerReferences = captureDockerReferences(
      captureNative(
        executables.docker.path,
        ["image", "ls", "--no-trunc", "--digests", "--format", "json"],
        cwd,
        environment,
      ),
    );
    const browsers =
      group === "browser"
        ? captureBrowserDistributions(executables.node.path, cwd, environment)
        : undefined;
    const contract = {
      executables,
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        release: release(),
        resolvedVersion: captureNative(
          executables.node.path,
          ["--version"],
          cwd,
          environment,
        ),
      },
      dependencies: installedContent(join(cwd, "node_modules"), true),
      lockfile: digest(readFileSync(join(cwd, "package-lock.json"))),
      npmConfiguration,
      configurations,
      version,
      daemon,
      context,
      browsers,
    };
    return { digest: digest(JSON.stringify(contract)), dockerReferences };
  } catch {
    return { unavailable: "runtime contract unavailable" };
  }
}

export function main(
  args,
  {
    captureRuntimeContract: captureRuntime = captureRuntimeContract,
    cwd = process.cwd(),
    environment = process.env,
    monotonicNow = () => Number(process.hrtime.bigint()) / 1e6,
    run = runStep,
    stderr = console.error,
    stdout = console.log,
    utcNow = () => new Date().toISOString(),
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
  const prefixSteps = [
    ...(baseline ? baselineVerificationSteps : []),
    ...preparation,
  ];
  const serviceStart = prefixSteps.length;
  let steps = [
    ...prefixSteps,
    ...serviceVerificationSteps(mode, selectedDatabase, selectedBrowser),
  ];
  const local = !environment.CI && !environment.GITHUB_ACTIONS;
  const forced = args.includes("--full");
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
    if (local && !forced && expensive)
      stdout("Local reuse eligibility will be checked during execution.");
    stdout("Plan only: no verification ran.");
    return 0;
  }
  if (steps.length > 0 && !checkLockedDependencies(cwd, stderr)) return 1;
  const snapshots = {};
  const tokens = {};
  for (let index = 0; index < steps.length; index += 1) {
    if (local && index === serviceStart && expensive) {
      const fresh = {};
      for (const group of ["database", "browser"]) {
        if (!(group === "database" ? selectedDatabase : selectedBrowser))
          continue;
        snapshots[group] = captureLocalEvidenceInputs(
          cwd,
          verificationEnvironment,
          group,
          groupVerificationSteps[group],
          captureRuntime,
        );
        const evidence =
          !forced && snapshots[group].identity
            ? readLocalGroupEvidence(cwd, group, snapshots[group].identity)
            : { reuse: false };
        if (evidence.reuse) {
          stdout(
            `${group}: reused local evidence from HEAD ${evidence.head}; base ${evidence.base}`,
          );
        } else {
          if (snapshots[group].unavailable)
            stdout(
              `${group}: local reuse unavailable (${snapshots[group].unavailable})`,
            );
          const attempt = beginLocalGroupAttempt(cwd, group);
          if (attempt.blocked) {
            stderr(
              JSON.stringify({
                type: "verification-admission-failure",
                group,
                step: attempt.blocked,
              }),
            );
            return 1;
          }
          tokens[group] = attempt.token;
          fresh[group] = true;
          stdout(
            `${group}: fresh local verification required (${forced ? "explicit --full" : "local evidence missing, stale or unavailable"})`,
          );
        }
      }
      steps = [
        ...prefixSteps,
        ...serviceVerificationSteps(mode, fresh.database, fresh.browser),
      ];
      if (index === steps.length) break;
    }
    const [command, commandArgs] = steps[index];
    const accessContract =
      command === "npm" && commandArgs[0] === "run"
        ? accessCommandContracts[commandArgs[1]]
        : undefined;
    const startedAt = utcNow();
    const started = monotonicNow();
    const result = run(command, commandArgs, verificationEnvironment, cwd);
    if (accessContract) {
      for (const group of accessContract.groups)
        stdout(
          `${group}: ${result.error ? "fresh verification could not start" : "executed fresh verification"}`,
        );
    }
    const durationMs = monotonicNow() - started;
    const completedAt = utcNow();
    const outcome = result.error
      ? { type: "spawn-failure", code: result.error.code ?? null }
      : result.signal
        ? { type: "signal", signal: result.signal }
        : { type: "exit", status: result.status };
    stdout(
      JSON.stringify({
        type: "verification-phase",
        command: [command, ...commandArgs],
        startedAt,
        completedAt,
        durationMs,
        outcome,
      }),
    );
    if (result.error || result.signal || result.status !== 0) {
      const reproduction =
        baseline && index < baselineVerificationSteps.length
          ? { reproduceGroup: ["npm", "run", "verify", "--", "--baseline"] }
          : (accessContract?.failureRecipe ?? {
              reproduceGroup: [
                "npm",
                "run",
                "verify",
                "--",
                "--browser",
                "--full",
              ],
            });
      stderr(
        JSON.stringify({
          type: "verification-failure",
          attemptedCommand: [command, ...commandArgs],
          ...reproduction,
        }),
      );
    }
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
    if (local) {
      const completed = [...(accessContract?.completedGroups ?? [])];
      if (index === steps.length - 1 && tokens.browser)
        completed.push("browser");
      for (const group of completed) {
        const after = captureLocalEvidenceInputs(
          cwd,
          verificationEnvironment,
          group,
          groupVerificationSteps[group],
          captureRuntime,
        );
        if (
          !completeLocalGroupAttempt(
            cwd,
            group,
            tokens[group],
            snapshots[group],
            after,
          )
        )
          stdout(`${group}: local evidence not retained`);
      }
    }
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
