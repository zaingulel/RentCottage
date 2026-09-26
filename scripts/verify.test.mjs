import { spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  chmodSync,
  cpSync,
  globSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baselineVerificationSteps,
  classifyChanges,
  expensiveVerificationSteps,
  main,
} from "./verify.mjs";

const requiredBaselineSteps = [
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

const requiredExpensiveSteps = [
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

const requiredDatabaseSteps = [["npm", ["run", "verify:access:database"]]];

const requiredBrowserSteps = [
  ["npm", ["run", "verify:access:browser"]],
  ...requiredExpensiveSteps.slice(1),
];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const explicitNodeWorkflowEntries = [
  "scripts/merge-watch.mjs",
  "scripts/doc-lint.mjs",
  ".claude/hooks/filter-test-output.mjs",
  ".claude/hooks/test-output-filter-run.mjs",
];

const lockedDependencyVersions = {
  wrangler: "4.130.0",
  workerd: "1.20260908.1",
};

function requiredCiSteps(mode) {
  const chromium = [
    "npx",
    ["playwright", "install", "--with-deps", "chromium"],
  ];
  if (mode === "--database")
    return [["npm", ["run", "verify:access:database"]]];
  if (mode === "--browser")
    return [
      chromium,
      ["npm", ["run", "verify:access:browser"]],
      ...requiredExpensiveSteps.slice(1),
    ];
  return [...requiredBaselineSteps, chromium, ...requiredExpensiveSteps];
}

const repositories = [];

const currentRegularAgentDefinitions = globSync(
  [
    ".agents/roles/*.md",
    ".agents/skills/*/SKILL.md",
    ".agents/templates/*.md",
    ".claude/agents/*.md",
    ".claude/templates/*.md",
    ".codex/agents/*.toml",
  ],
  { cwd: process.cwd() },
).filter((path) => {
  const stat = lstatSync(join(process.cwd(), path));
  return stat.isFile() && (stat.mode & 0o111) === 0;
});

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

it("keeps explicit Node workflow entry points non-executable for baseline eligibility", () => {
  const trackedEntries = git(ROOT, [
    "ls-files",
    "--stage",
    "--",
    ...explicitNodeWorkflowEntries,
  ])
    .split("\n")
    .map((record) => {
      const [metadata, path] = record.split("\t");
      const [mode, , stage] = metadata.split(" ");
      return { mode, path, stage };
    });
  for (const path of explicitNodeWorkflowEntries) {
    const entries = trackedEntries.filter((entry) => entry.path === path);
    expect(entries, `${path} must be tracked exactly once`).toHaveLength(1);
    expect(entries[0].mode, `${path} tracked mode`).toBe("100644");
    expect(entries[0].stage, `${path} index stage`).toBe("0");
    const stat = lstatSync(join(ROOT, path));
    expect(stat.isFile(), `${path} must be a regular file`).toBe(true);
    expect(stat.mode & 0o111, `${path} on-disk mode`).toBe(0);
  }
});

it.each(explicitNodeWorkflowEntries)(
  "rejects executable explicit Node workflow entry %s for baseline eligibility",
  (path) => {
    expect(
      classifyChanges([
        { path, oldMode: "100644", newMode: "100644", status: "M" },
      ]),
    ).toEqual({
      browser: false,
      database: false,
      reason: `only approved workflow or prose changed: ${path}`,
    });
    for (const [oldMode, newMode, status] of [
      ["000000", "100755", "A"],
      ["100644", "100755", "M"],
      ["100755", "100644", "M"],
    ]) {
      expect(classifyChanges([{ path, oldMode, newMode, status }])).toEqual({
        browser: true,
        database: true,
        reason: `${path} is executable or has an executable-mode change`,
      });
    }
  },
);

function write(repository, path, contents) {
  const target = join(repository, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function writeDependencyMetadata(
  repository,
  {
    lockVersions = lockedDependencyVersions,
    installedVersions = lockedDependencyVersions,
  } = {},
) {
  write(
    repository,
    "package-lock.json",
    `${JSON.stringify(
      {
        lockfileVersion: 3,
        packages: Object.fromEntries(
          Object.entries(lockVersions).map(([name, version]) => [
            `node_modules/${name}`,
            { version },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );
  for (const [name, version] of Object.entries(installedVersions)) {
    write(
      repository,
      `node_modules/${name}/package.json`,
      `${JSON.stringify({ name, version }, null, 2)}\n`,
    );
  }
}

function createRepository() {
  const repository = mkdtempSync(join(tmpdir(), "rentcottage-verify-"));
  repositories.push(repository);
  git(repository, ["init", "--initial-branch=main"]);
  git(repository, ["config", "user.name", "Verification Test"]);
  git(repository, ["config", "user.email", "verify@example.test"]);
  write(repository, "AGENTS.md", "initial instructions\n");
  write(repository, ".gitignore", "node_modules/\n");
  write(repository, "src/runtime.ts", "export const value = 'initial';\n");
  writeDependencyMetadata(repository);
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "initial"]);
  git(repository, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(repository, ["switch", "-c", "job/test"]);
  return repository;
}

function createCrissCrossRepository() {
  const repository = createRepository();
  const root = git(repository, ["rev-parse", "HEAD"]);
  const leftOne = commit(
    repository,
    "AGENTS.md",
    "left instructions\n",
    "left one",
  );
  git(repository, ["switch", "-c", "right", root]);
  const rightOne = commit(
    repository,
    "CONTEXT.md",
    "right context\n",
    "right one",
  );
  git(repository, ["switch", "job/test"]);
  git(repository, ["merge", "--no-ff", rightOne, "-m", "left merge"]);
  const left = git(repository, ["rev-parse", "HEAD"]);
  git(repository, ["switch", "right"]);
  git(repository, ["merge", "--no-ff", leftOne, "-m", "right merge"]);
  const right = git(repository, ["rev-parse", "HEAD"]);
  return { left, repository, right };
}

function commit(repository, path, contents, message = "change") {
  write(repository, path, contents);
  git(repository, ["add", "--", path]);
  git(repository, ["commit", "-m", message]);
  return git(repository, ["rev-parse", "HEAD"]);
}

function runVerification(repository, options = {}) {
  const calls = [];
  const stdout = vi.fn();
  const stderr = vi.fn();
  const run = vi.fn((command, args, environment) => {
    calls.push([command, args, environment]);
    return { status: 0 };
  });
  const status = main(options.args ?? [], {
    cwd: repository,
    environment: options.environment ?? {},
    run: options.run ?? run,
    captureRuntimeContract: options.captureRuntimeContract,
    stderr,
    stdout,
  });
  return { calls, run: options.run ?? run, status, stderr, stdout };
}

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

function runtimeFixture() {
  return { digest: "a".repeat(64), dockerReferences: [] };
}

function localVerification(repository, options = {}) {
  return runVerification(repository, {
    captureRuntimeContract: runtimeFixture,
    ...options,
  });
}

function productionFixture({ browsers = false } = {}) {
  const repository = createRepository();
  const tools = mkdtempSync(join(tmpdir(), "rentcottage-native-"));
  repositories.push(tools);
  const bin = join(tools, "bin");
  mkdirSync(bin);
  for (const name of ["node", "git"]) {
    const actual =
      name === "node"
        ? process.execPath
        : spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
    symlinkSync(actual, join(bin, name));
  }
  const images = join(tools, "images.json");
  const daemon = join(tools, "daemon.json");
  const commandLog = join(tools, "commands.jsonl");
  writeFileSync(images, "");
  writeFileSync(daemon, JSON.stringify("fixture-daemon"));
  const npmConfig = {
    userconfig: join(tools, "user.npmrc"),
    globalconfig: join(tools, "global.npmrc"),
  };
  const launcher = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const name = require('node:path').basename(process.argv[1]);
if (name === 'docker') {
  if (args[0] === 'version') console.log(JSON.stringify({ Client: { Version: 'fixture-client' }, Server: { Version: 'fixture-server' } }));
  else if (args[0] === 'info') console.log(fs.readFileSync(${JSON.stringify(daemon)}, 'utf8'));
  else if (args[0] === 'context') console.log('fixture-context');
  else if (args[0] === 'image') process.stdout.write(fs.readFileSync(${JSON.stringify(images)}, 'utf8'));
  else process.exitCode = 2;
} else if (args[0] === 'config') console.log(${JSON.stringify(JSON.stringify(npmConfig))});
else fs.appendFileSync(${JSON.stringify(commandLog)}, JSON.stringify([name, ...args]) + '\\n');
`;
  for (const name of ["npm", "npx", "docker"]) {
    writeFileSync(join(bin, name), launcher, { mode: 0o755 });
  }
  const environment = { PATH: bin, HOME: tools };
  let distributions;
  if (browsers) {
    cpSync(
      join(ROOT, "node_modules/playwright-core"),
      join(repository, "node_modules/playwright-core"),
      { recursive: true },
    );
    const browserRoot = join(tools, "browsers");
    environment.PLAYWRIGHT_BROWSERS_PATH = browserRoot;
    const resolveDistributions = spawnSync(
      process.execPath,
      [
        "-e",
        `const {createRequire}=require('node:module');const requireHere=createRequire(process.cwd()+'/package.json');const {registry}=requireHere('playwright-core/lib/coreBundle');console.log(JSON.stringify(['chromium','chromium-headless-shell'].map(name=>{const entry=registry.registry.findExecutable(name);return {name,directory:entry.directory,executable:entry.executablePath()}})));`,
      ],
      { cwd: repository, env: environment, encoding: "utf8" },
    );
    if (resolveDistributions.status !== 0)
      throw new Error(resolveDistributions.stderr);
    distributions = JSON.parse(resolveDistributions.stdout);
    for (const entry of distributions) {
      mkdirSync(dirname(entry.executable), { recursive: true });
      writeFileSync(entry.executable, "fixture-launcher", { mode: 0o755 });
      write(entry.directory, "Resources/locale.pak", "fixture-resource");
    }
  }
  commit(repository, "src/runtime.ts", "seed\n");
  return {
    repository,
    tools,
    images,
    daemon,
    commandLog,
    environment,
    distributions,
  };
}

function evidenceFile(repository, suffix, group = "database") {
  return join(
    git(repository, ["rev-parse", "--absolute-git-dir"]),
    "rentcottage-verification",
    `${group}.${suffix}.json`,
  );
}

function commands(result) {
  return result.run.mock.calls.map(([command, args]) => [command, args]);
}

describe("repository verification command", () => {
  it("reuses only unchanged local groups after classified repairs", () => {
    const repository = createRepository();
    commit(repository, "src/runtime.ts", "export const value = 'seed';\n");
    expect(commands(localVerification(repository))).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
    commit(repository, "AGENTS.md", "repaired instructions\n");
    const repaired = localVerification(repository);
    expect(repaired.status).toBe(0);
    expect(commands(repaired)).toEqual(requiredBaselineSteps);
    expect(repaired.stdout.mock.calls.flat().join("\n")).toContain(
      "reused local evidence",
    );
    commit(repository, "src/app/globals.css", "body { color: red; }\n");
    expect(commands(localVerification(repository))).toEqual([
      ...requiredBaselineSteps,
      ...requiredBrowserSteps,
    ]);
    write(repository, "src/runtime.ts", "export const value = 'repaired';\n");
    expect(commands(localVerification(repository))).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
  }, 30000);

  it("ignores only bookkeeping environment changes through production capture", () => {
    const fixture = productionFixture({ browsers: true });
    const bookkeepingKeys = [
      "RUN_LOG_RERUN_REASON",
      "CLAUDE_CODE_SESSION_ID",
      "CLAUDE_PID",
      "CODEX_SESSION_ID",
      "STARSHIP_SESSION_KEY",
      "_",
      "OLDPWD",
    ];
    const initialEnvironment = {
      ...fixture.environment,
      TZ: "Etc/UTC",
      VERIFY_FIXTURE_UNRECOGNIZED_INPUT: "private-unknown-before",
      ...Object.fromEntries(
        bookkeepingKeys.map((key) => [key, `private-${key}-before`]),
      ),
    };
    const changedBookkeeping = {
      ...initialEnvironment,
      ...Object.fromEntries(
        bookkeepingKeys.map((key) => [key, `private-${key}-after`]),
      ),
    };
    const execute = (environment, expectedCommands, reused) => {
      const result = runVerification(fixture.repository, { environment });
      expect(result.status).toBe(0);
      expect(commands(result)).toEqual(expectedCommands);
      for (const [, , suppliedEnvironment] of result.calls) {
        expect(suppliedEnvironment).toMatchObject(environment);
      }
      const output = [
        ...result.stdout.mock.calls.flat(),
        ...result.stderr.mock.calls.flat(),
      ].join("\n");
      for (const group of ["database", "browser"]) {
        expect(output.includes(`${group}: reused local evidence`)).toBe(reused);
        const record = readFileSync(
          evidenceFile(fixture.repository, "success", group),
          "utf8",
        );
        for (const value of Object.values(environment)) {
          expect(output).not.toContain(value);
          expect(record).not.toContain(value);
        }
      }
    };
    const freshCommands = [...requiredBaselineSteps, ...requiredExpensiveSteps];
    execute(initialEnvironment, freshCommands, false);
    execute(changedBookkeeping, requiredBaselineSteps, true);
    for (const [key, value] of [
      ["TZ", "Pacific/Auckland"],
      ["VERIFY_FIXTURE_UNRECOGNIZED_INPUT", "private-unknown-after"],
    ]) {
      const changedInput = { ...changedBookkeeping, [key]: value };
      execute(changedInput, freshCommands, false);
      execute(changedInput, requiredBaselineSteps, true);
      execute(changedBookkeeping, freshCommands, false);
      execute(changedBookkeeping, requiredBaselineSteps, true);
    }
  }, 60000);

  it("refuses stale source base and environment evidence", () => {
    const cases = [
      (repository) =>
        commit(repository, "src/runtime.ts", "committed repair\n"),
      (repository) => {
        write(repository, "src/runtime.ts", "staged repair\n");
        git(repository, ["add", "src/runtime.ts"]);
        write(repository, "src/runtime.ts", "seed\n");
      },
      (repository) => write(repository, "src/runtime.ts", "unstaged repair\n"),
      (repository) => write(repository, "src/new.ts", "untracked repair\n"),
      (repository) => rmSync(join(repository, "src/runtime.ts")),
      (repository) =>
        renameSync(
          join(repository, "src/runtime.ts"),
          join(repository, "src/renamed.ts"),
        ),
      (repository) => {
        chmodSync(join(repository, "AGENTS.md"), 0o755);
        git(repository, ["add", "AGENTS.md"]);
        chmodSync(join(repository, "AGENTS.md"), 0o644);
      },
      (repository) => {
        const baseTree = git(repository, ["rev-parse", "origin/main^{tree}"]);
        const movedBase = git(repository, [
          "commit-tree",
          baseTree,
          "-p",
          "origin/main",
          "-m",
          "advanced base",
        ]);
        const jobTree = git(repository, ["rev-parse", "HEAD^{tree}"]);
        const merged = git(repository, [
          "commit-tree",
          jobTree,
          "-p",
          "HEAD",
          "-p",
          movedBase,
          "-m",
          "merge base movement",
        ]);
        git(repository, ["update-ref", "HEAD", merged]);
        git(repository, ["update-ref", "refs/remotes/origin/main", movedBase]);
      },
      (repository) =>
        git(repository, ["update-ref", "-d", "refs/remotes/origin/main"]),
      (repository) => chmodSync(join(repository, "AGENTS.md"), 0o755),
      (repository) => {
        rmSync(join(repository, "AGENTS.md"));
        symlinkSync("src/runtime.ts", join(repository, "AGENTS.md"));
      },
      (repository) => {
        const tree = git(repository, ["rev-parse", "origin/main^{tree}"]);
        const moved = git(repository, [
          "commit-tree",
          tree,
          "-p",
          "origin/main",
          "-m",
          "base movement",
        ]);
        git(repository, ["update-ref", "refs/remotes/origin/main", moved]);
      },
    ];
    for (const change of cases) {
      const repository = createRepository();
      commit(repository, "src/runtime.ts", "seed\n");
      expect(
        localVerification(repository, { args: ["--database"] }).status,
      ).toBe(0);
      change(repository);
      const result = localVerification(repository, { args: ["--database"] });
      expect(commands(result)).toEqual(requiredDatabaseSteps);
      expect(result.stdout.mock.calls.flat().join("\n")).not.toContain(
        "reused local evidence",
      );
    }
    const linkedRepository = createRepository();
    const externalDirectory = mkdtempSync(
      join(tmpdir(), "rentcottage-source-target-"),
    );
    repositories.push(externalDirectory);
    const externalSource = join(externalDirectory, "runtime.ts");
    writeFileSync(externalSource, "first external source");
    rmSync(join(linkedRepository, "src/runtime.ts"));
    symlinkSync(externalSource, join(linkedRepository, "src/runtime.ts"));
    expect(
      localVerification(linkedRepository, { args: ["--database"] }).status,
    ).toBe(0);
    writeFileSync(externalSource, "same-path external source replacement");
    const replacedTarget = localVerification(linkedRepository, {
      args: ["--database"],
    });
    expect(commands(replacedTarget)).toEqual(requiredDatabaseSteps);
    expect(replacedTarget.stdout.mock.calls.flat().join("\n")).toContain(
      "source symlink prevents reuse",
    );
    expect(replacedTarget.stdout.mock.calls.flat().join("\n")).toContain(
      "local evidence not retained",
    );

    const repository = createRepository();
    commit(repository, "src/runtime.ts", "seed\n");
    localVerification(repository, {
      args: ["--database"],
      environment: { CONTRACT: "before" },
    });
    const changed = localVerification(repository, {
      args: ["--database"],
      environment: { CONTRACT: "after" },
    });
    expect(commands(changed)).toEqual(requiredDatabaseSteps);
    const runtimeChanged = localVerification(repository, {
      args: ["--database"],
      environment: { CONTRACT: "after" },
      captureRuntimeContract: () => ({
        digest: "b".repeat(64),
        dockerReferences: [],
      }),
    });
    expect(commands(runtimeChanged)).toEqual(requiredDatabaseSteps);
    const rerunReason = localVerification(repository, {
      args: ["--database"],
      environment: {
        CONTRACT: "after",
        RUN_LOG_RERUN_REASON: "changed explanation",
      },
      captureRuntimeContract: () => ({
        digest: "b".repeat(64),
        dockerReferences: [],
      }),
    });
    expect(commands(rerunReason)).toEqual([]);
  }, 60000);

  it("retains only authoritatively completed service groups", () => {
    for (const failure of ["verify:access", "build:worker", "test:browser"]) {
      const repository = createRepository();
      commit(repository, "src/runtime.ts", "seed\n");
      const run = vi.fn((_command, args) => ({
        status: args[1] === failure ? 7 : 0,
      }));
      expect(localVerification(repository, { run }).status).toBe(7);
      commit(repository, "AGENTS.md", "baseline-only repair\n");
      const repaired = localVerification(repository);
      if (failure !== "verify:access")
        expect(repaired.stdout.mock.calls.flat().join("\n")).toContain(
          "database: reused local evidence",
        );
      expect(commands(repaired)).toEqual([
        ...requiredBaselineSteps,
        ...(failure === "verify:access"
          ? requiredExpensiveSteps
          : requiredBrowserSteps),
      ]);
    }
    const independentRepository = createRepository();
    commit(independentRepository, "src/runtime.ts", "seed\n");
    expect(
      localVerification(independentRepository, { args: ["--database"] }).status,
    ).toBe(0);
    expect(
      localVerification(independentRepository, {
        args: ["--browser"],
        run: vi.fn(() => ({ status: 7 })),
      }).status,
    ).toBe(7);
    commit(
      independentRepository,
      "src/app/globals.css",
      "presentation repair\n",
    );
    expect(commands(localVerification(independentRepository))).toEqual([
      ...requiredBaselineSteps,
      ...requiredBrowserSteps,
    ]);
    for (const outcome of [
      { status: 5 },
      { status: null, signal: "SIGTERM" },
      {
        status: null,
        error: Object.assign(new Error("missing"), { code: "ENOENT" }),
      },
    ]) {
      const repository = createRepository();
      commit(repository, "src/runtime.ts", "seed\n");
      const failed = localVerification(repository, {
        args: ["--database"],
        run: vi.fn(() => outcome),
      });
      expect(failed.status).not.toBe(0);
      expect(
        commands(localVerification(repository, { args: ["--database"] })),
      ).toEqual(requiredDatabaseSteps);
    }
    const repository = createRepository();
    commit(repository, "src/runtime.ts", "seed\n");
    localVerification(repository, {
      args: ["--database"],
      run: vi.fn(() => {
        write(repository, "src/runtime.ts", "changed during execution\n");
        return { status: 0 };
      }),
    });
    expect(
      commands(localVerification(repository, { args: ["--database"] })),
    ).toEqual(requiredDatabaseSteps);
  }, 60000);

  it("rejects corrupt interrupted and superseded local evidence", () => {
    const changes = [
      (path) => {
        const record = JSON.parse(readFileSync(path));
        record.head = [record.head];
        writeFileSync(path, JSON.stringify(record));
      },
      (path, marker) => {
        for (const target of [path, marker]) {
          const record = JSON.parse(readFileSync(target));
          record.token = "-".repeat(36);
          writeFileSync(target, JSON.stringify(record));
        }
      },
      (path) => {
        const record = JSON.parse(readFileSync(path));
        record.completedAt = "2026";
        writeFileSync(path, JSON.stringify(record));
      },
      (path) => writeFileSync(path, "{broken"),
      (path) => writeFileSync(path, "x".repeat(1024 * 1024 + 1)),
      (path) => {
        const record = JSON.parse(readFileSync(path));
        record.version = 2;
        writeFileSync(path, JSON.stringify(record));
      },
      (path) => {
        const record = JSON.parse(readFileSync(path));
        record.group = "browser";
        writeFileSync(path, JSON.stringify(record));
      },
      (path) => {
        const record = JSON.parse(readFileSync(path));
        record.identity.dockerReferences = [
          ["b".repeat(64), "c".repeat(64)],
          ["b".repeat(64), "c".repeat(64)],
        ];
        writeFileSync(path, JSON.stringify(record));
      },
      (path) => {
        renameSync(path, `${path}.original`);
        symlinkSync(`${path}.original`, path);
      },
      (_path, marker) => rmSync(marker),
      (_path, marker) => {
        const record = JSON.parse(readFileSync(marker));
        record.token = "00000000-0000-0000-0000-000000000000";
        writeFileSync(marker, JSON.stringify(record));
      },
    ];
    for (const change of changes) {
      const repository = createRepository();
      commit(repository, "src/runtime.ts", "seed\n");
      localVerification(repository, { args: ["--database"] });
      change(
        evidenceFile(repository, "success"),
        evidenceFile(repository, "attempt"),
      );
      expect(
        commands(localVerification(repository, { args: ["--database"] })),
      ).toEqual(requiredDatabaseSteps);
    }
    const oversizedRepository = createRepository();
    commit(oversizedRepository, "src/runtime.ts", "seed\n");
    const oversized = localVerification(oversizedRepository, {
      args: ["--database"],
      captureRuntimeContract: () => ({
        digest: "a".repeat(64),
        dockerReferences: Array.from({ length: 10000 }, (_, index) => [
          index.toString(16).padStart(64, "0"),
          "b".repeat(64),
        ]),
      }),
    });
    expect(oversized.status).toBe(0);
    expect(oversized.stdout.mock.calls.flat().join("\n")).toContain(
      "local evidence not retained",
    );
    expect(() =>
      readFileSync(evidenceFile(oversizedRepository, "success")),
    ).toThrow();
    const repository = createRepository();
    commit(repository, "src/runtime.ts", "seed\n");
    localVerification(repository, {
      args: ["--database"],
      run: vi.fn(() => {
        const marker = evidenceFile(repository, "attempt");
        const record = JSON.parse(readFileSync(marker));
        record.token = "00000000-0000-0000-0000-000000000000";
        writeFileSync(marker, JSON.stringify(record));
        return { status: 0 };
      }),
    });
    expect(
      commands(localVerification(repository, { args: ["--database"] })),
    ).toEqual(requiredDatabaseSteps);
    const stateDirectory = dirname(evidenceFile(repository, "success"));
    renameSync(stateDirectory, `${stateDirectory}.elsewhere`);
    symlinkSync(`${stateDirectory}.elsewhere`, stateDirectory);
    const escaped = localVerification(repository, { args: ["--database"] });
    expect(commands(escaped)).toEqual([]);
    expect(escaped.status).toBe(1);
    expect(escaped.stderr.mock.calls.flat().join("\n")).toContain(
      "verification-admission-failure",
    );
  }, 60000);

  it("keeps forced hosted and planned verification honest", () => {
    const repository = createRepository();
    commit(repository, "src/runtime.ts", "seed\n");
    localVerification(repository);
    const marker = evidenceFile(repository, "attempt");
    const oldMarker = readFileSync(marker, "utf8");
    const captureRuntimeContract = vi.fn(runtimeFixture);
    const plan = localVerification(repository, {
      args: ["--plan"],
      captureRuntimeContract,
    });
    expect(plan.status).toBe(0);
    expect(commands(plan)).toEqual([]);
    expect(captureRuntimeContract).not.toHaveBeenCalled();
    expect(readFileSync(marker, "utf8")).toBe(oldMarker);
    expect(plan.stdout.mock.calls.flat().join("\n")).toContain(
      "reuse eligibility will be checked during execution",
    );
    const baselineFailure = localVerification(repository, {
      run: vi.fn(() => ({ status: 8 })),
      captureRuntimeContract,
    });
    expect(baselineFailure.status).toBe(8);
    expect(captureRuntimeContract).not.toHaveBeenCalled();
    expect(baselineFailure.stdout.mock.calls.flat().join("\n")).not.toContain(
      "reused local evidence",
    );
    for (const environment of [{ CI: "true" }, { GITHUB_ACTIONS: "true" }]) {
      const hosted = localVerification(repository, {
        args: ["--full"],
        environment,
        captureRuntimeContract,
      });
      expect(commands(hosted)).toEqual(
        environment.GITHUB_ACTIONS
          ? requiredCiSteps()
          : [...requiredBaselineSteps, ...requiredExpensiveSteps],
      );
      expect(hosted.status).toBe(0);
      expect(captureRuntimeContract).not.toHaveBeenCalled();
      expect(readFileSync(marker, "utf8")).toBe(oldMarker);
    }
    const forced = localVerification(repository, { args: ["--full"] });
    expect(commands(forced)).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
    expect(readFileSync(marker, "utf8")).not.toBe(oldMarker);
    expect(commands(localVerification(repository))).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
    expect(
      commands(localVerification(repository, { args: ["--database"] })),
    ).toEqual([]);
    expect(
      commands(localVerification(repository, { args: ["--browser"] })),
    ).toEqual([]);
  }, 30000);

  it("wires local evidence reuse through a real child invocation", () => {
    const fixture = productionFixture();
    const gitExecutable = join(fixture.tools, "bin/git");
    const originalGit = fs.realpathSync(gitExecutable);
    const gitLog = join(fixture.tools, "git-commands.jsonl");
    rmSync(gitExecutable);
    writeFileSync(
      gitExecutable,
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(gitLog)}, JSON.stringify(args) + '\\n');
const result = require('node:child_process').spawnSync(${JSON.stringify(originalGit)}, args, { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
else process.exit(result.status);
`,
      { mode: 0o755 },
    );
    const child = () =>
      spawnSync(
        process.execPath,
        [join(ROOT, "scripts/verify.mjs"), "--database"],
        { cwd: fixture.repository, env: fixture.environment, encoding: "utf8" },
      );
    const first = child();
    expect(first.status, first.stderr).toBe(0);
    expect(
      readFileSync(fixture.commandLog, "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse),
    ).toEqual([["npm", "run", "verify:access:database"]]);
    const second = child();
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("reused local evidence");
    expect(
      readFileSync(fixture.commandLog, "utf8").trim().split("\n"),
    ).toHaveLength(1);
    write(fixture.repository, "src/runtime.ts", "stale source\n");
    const stale = child();
    expect(stale.status, stale.stderr).toBe(0);
    expect(stale.stdout).not.toContain("reused local evidence");
    expect(
      readFileSync(fixture.commandLog, "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse),
    ).toEqual([
      ["npm", "run", "verify:access:database"],
      ["npm", "run", "verify:access:database"],
    ]);
    const gitArguments = readFileSync(gitLog, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    expect(gitArguments.some(([command]) => command === "ls-tree")).toBe(true);
    expect(gitArguments.some(([command]) => command === "ls-files")).toBe(true);
    expect(
      gitArguments.filter(
        ([command, type]) => command === "cat-file" && type === "blob",
      ),
    ).toEqual([]);
  }, 30000);

  it("refuses external executable overrides through production capture", () => {
    const fixture = productionFixture();
    const external = join(fixture.tools, "external-binary");
    writeFileSync(external, "first executable", { mode: 0o755 });
    const execute = (environment, args = ["--database"]) =>
      runVerification(fixture.repository, {
        environment: { ...fixture.environment, ...environment },
        args,
      });
    expect(execute({}).status).toBe(0);
    expect(commands(execute({}))).toEqual([]);
    for (const name of [
      "SUPABASE_CLI_BINARY_OVERRIDE",
      "ESBUILD_BINARY_PATH",
      "MINIFLARE_WORKERD_PATH",
    ]) {
      for (const value of [external, ""]) {
        const earlierReceipt = readFileSync(
          evidenceFile(fixture.repository, "success"),
          "utf8",
        );
        const result = execute({ [name]: value });
        expect(commands(result)).toEqual(requiredDatabaseSteps);
        expect(result.stdout.mock.calls.flat().join("\n")).toContain(
          `${name}: external executable override prevents reuse`,
        );
        expect(result.stdout.mock.calls.flat().join("\n")).not.toContain(
          external,
        );
        writeFileSync(external, "same path replacement", { mode: 0o755 });
        expect(commands(execute({ [name]: value }))).toEqual(
          requiredDatabaseSteps,
        );
        expect(
          readFileSync(evidenceFile(fixture.repository, "success"), "utf8"),
        ).toBe(earlierReceipt);
        const refusedBrowser = execute({ [name]: value }, ["--browser"]);
        expect(commands(refusedBrowser)).toEqual(requiredBrowserSteps);
        expect(refusedBrowser.stdout.mock.calls.flat().join("\n")).toContain(
          `${name}: external executable override prevents reuse`,
        );
        expect(() =>
          readFileSync(evidenceFile(fixture.repository, "success", "browser")),
        ).toThrow();
      }
      expect(commands(execute({}))).toEqual(requiredDatabaseSteps);
      expect(commands(execute({}))).toEqual([]);
    }
    for (const name of [
      "NODE_OPTIONS",
      "NODE_PATH",
      "PW_INSTRUMENT_MODULES",
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
      "DYLD_INSERT_LIBRARIES",
      "DYLD_LIBRARY_PATH",
    ]) {
      const refused = execute({ [name]: "external" });
      expect(commands(refused)).toEqual(requiredDatabaseSteps);
      expect(refused.stdout.mock.calls.flat().join("\n")).toContain(
        `${name}: external executable override prevents reuse`,
      );
    }
    for (const name of ["SELENIUM_REMOTE_URL", "PW_TEST_CONNECT_WS_ENDPOINT"]) {
      const remote = execute({ [name]: "remote-secret" }, ["--browser"]);
      expect(commands(remote)).toEqual(requiredBrowserSteps);
      expect(remote.stdout.mock.calls.flat().join("\n")).toContain(
        `${name}: remote browser prevents reuse`,
      );
      expect(remote.stdout.mock.calls.flat().join("\n")).not.toContain(
        "remote-secret",
      );
    }
  }, 60000);

  it("distinguishes installed inputs from generated results after baseline", () => {
    const fixture = productionFixture({ browsers: true });
    const execute = (mutate) =>
      runVerification(fixture.repository, {
        environment: fixture.environment,
        run: vi.fn((_command, args) => {
          if (args[0] === "test" && mutate) mutate();
          return { status: 0 };
        }),
      });
    expect(execute().status).toBe(0);
    const resultPath = `node_modules/.vite/vitest/${"a".repeat(40)}/results.json`;
    for (const mutate of [
      () =>
        write(
          fixture.repository,
          resultPath,
          JSON.stringify({
            version: "4.1.10",
            results: [["case", { duration: 12, failed: false }]],
          }),
        ),
      () =>
        write(
          fixture.repository,
          resultPath,
          JSON.stringify({
            version: "4.1.10",
            results: [["case", { duration: 99, failed: true }]],
          }),
        ),
      () => rmSync(join(fixture.repository, resultPath)),
    ]) {
      const result = execute(mutate);
      expect(commands(result)).toEqual(requiredBaselineSteps);
      expect(result.stdout.mock.calls.flat().join("\n")).toContain(
        "database: reused local evidence",
      );
      expect(result.stdout.mock.calls.flat().join("\n")).toContain(
        "browser: reused local evidence",
      );
    }
    for (const [path, contents, mode] of [
      ["node_modules/workerd/installed.js", "first installed input", 0o644],
      [
        "node_modules/workerd/installed.js",
        "same-path installed replacement",
        0o644,
      ],
      ["node_modules/.vite/executable-output", "executable result", 0o755],
      [resultPath, "executable results", 0o755],
    ]) {
      const result = execute(() => {
        write(fixture.repository, path, contents);
        chmodSync(join(fixture.repository, path), mode);
      });
      expect(commands(result)).toEqual([
        ...requiredBaselineSteps,
        ...requiredExpensiveSteps,
      ]);
    }
    const symlinkReplacement = execute(() => {
      rmSync(join(fixture.repository, resultPath));
      symlinkSync(
        "../../../workerd/installed.js",
        join(fixture.repository, resultPath),
      );
    });
    expect(commands(symlinkReplacement)).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
    const symlinkResult = execute();
    expect(commands(symlinkResult)).toEqual(requiredBaselineSteps);
    const ancestor = join(fixture.repository, "node_modules/.vite/vitest");
    renameSync(ancestor, `${ancestor}.original`);
    symlinkSync("vitest.original", ancestor);
    const invalidAncestor = execute();
    expect(commands(invalidAncestor)).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
    expect(invalidAncestor.stdout.mock.calls.flat().join("\n")).toContain(
      "local evidence not retained",
    );
    rmSync(ancestor);
    renameSync(`${ancestor}.original`, ancestor);
    expect(execute().status).toBe(0);
    const external = join(fixture.tools, "external-installed-input");
    writeFileSync(external, "unbounded external input");
    const dependencyRoot = join(fixture.repository, "node_modules");
    symlinkSync(
      relative(dependencyRoot, external),
      join(dependencyRoot, "external-input"),
    );
    const unbounded = execute();
    expect(commands(unbounded)).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
    expect(unbounded.stdout.mock.calls.flat().join("\n")).toContain(
      "local evidence not retained",
    );
  }, 60000);

  it("admits cold image preparation and ignores unrelated image additions", () => {
    const fixture = productionFixture();
    const image = (repository, tag, id) => ({
      Repository: repository,
      Tag: tag,
      Digest: "<none>",
      ID: `sha256:${id.repeat(64)}`,
    });
    const original = image("fixture/required", "latest", "a");
    const unrelated = image("other/fixture", "extra", "b");
    const writeImages = (rows) =>
      writeFileSync(
        fixture.images,
        rows.map((row) => JSON.stringify(row)).join("\n"),
      );
    const execute = (mutate) =>
      runVerification(fixture.repository, {
        args: ["--database"],
        environment: fixture.environment,
        run: vi.fn(() => {
          if (mutate) mutate();
          return { status: 0 };
        }),
      });
    expect(execute(() => writeImages([original])).status).toBe(0);
    const saved = readFileSync(
      evidenceFile(fixture.repository, "success"),
      "utf8",
    );
    expect(saved).not.toContain(original.Repository);
    expect(saved).not.toContain(original.ID);
    expect(commands(execute())).toEqual([]);
    writeImages([original, unrelated]);
    expect(commands(execute())).toEqual([]);
    expect(
      readFileSync(evidenceFile(fixture.repository, "success"), "utf8"),
    ).toBe(saved);
    writeImages([image(original.Repository, original.Tag, "c"), unrelated]);
    expect(commands(execute())).toEqual(requiredDatabaseSteps);
    writeImages([unrelated]);
    expect(commands(execute())).toEqual(requiredDatabaseSteps);
    writeFileSync(fixture.daemon, JSON.stringify("changed-daemon"));
    expect(commands(execute())).toEqual(requiredDatabaseSteps);
    expect(commands(execute())).toEqual([]);
    write(fixture.repository, "src/runtime.ts", "repair requiring execution\n");
    const changedDuring = execute(() =>
      writeImages([image(unrelated.Repository, unrelated.Tag, "d")]),
    );
    expect(changedDuring.stdout.mock.calls.flat().join("\n")).toContain(
      "local evidence not retained",
    );
    expect(commands(execute())).toEqual(requiredDatabaseSteps);
    for (const metadata of [
      "{malformed",
      JSON.stringify({
        Repository: "private-image-name",
        Tag: "latest",
        ID: "bad",
        Digest: "<none>",
      }),
      [image("conflict", "tag", "a"), image("conflict", "tag", "b")]
        .map(JSON.stringify)
        .join("\n"),
    ]) {
      writeFileSync(fixture.images, metadata);
      const malformed = execute();
      expect(commands(malformed)).toEqual(requiredDatabaseSteps);
      expect(malformed.stdout.mock.calls.flat().join("\n")).toContain(
        "local evidence not retained",
      );
      expect(malformed.stdout.mock.calls.flat().join("\n")).not.toContain(
        "private-image-name",
      );
    }
  }, 60000);

  it("fingerprints browser distribution sidecars through production capture", () => {
    const fixture = productionFixture({ browsers: true });
    const [chromium, headless] = fixture.distributions;
    const framework = join(
      chromium.directory,
      "Fixture.app/Contents/Frameworks/Fixture.framework/Versions",
    );
    write(framework, "A/Fixture", "framework executable");
    chmodSync(join(framework, "A/Fixture"), 0o755);
    write(framework, "A/Resources/resource.pak", "framework resource");
    symlinkSync("A", join(framework, "Current"));
    const library = join(dirname(headless.executable), "libfixture.dylib");
    const icd = join(dirname(headless.executable), "vk_fixture_icd.json");
    writeFileSync(library, "headless sibling library");
    writeFileSync(icd, '{"fixture":"initial"}');
    const launchers = fixture.distributions.map((entry) =>
      readFileSync(entry.executable, "utf8"),
    );
    const execute = (environment = fixture.environment) =>
      runVerification(fixture.repository, { args: ["--browser"], environment });
    expect(execute().status).toBe(0);
    expect(commands(execute())).toEqual([]);
    for (const [path, contents] of [
      [join(framework, "Current/Fixture"), "changed framework executable"],
      [
        join(framework, "Current/Resources/resource.pak"),
        "changed framework resource",
      ],
      [library, "changed headless library"],
      [icd, '{"fixture":"changed"}'],
    ]) {
      writeFileSync(path, contents);
      const changed = execute();
      expect(commands(changed)).toEqual(requiredBrowserSteps);
      expect(changed.status).toBe(0);
      expect(commands(execute())).toEqual([]);
      expect(
        fixture.distributions.map((entry) =>
          readFileSync(entry.executable, "utf8"),
        ),
      ).toEqual(launchers);
    }
    const aliasEnvironment = { ...fixture.environment };
    aliasEnvironment.npm_config_playwright_browsers_path =
      aliasEnvironment.PLAYWRIGHT_BROWSERS_PATH;
    delete aliasEnvironment.PLAYWRIGHT_BROWSERS_PATH;
    expect(commands(execute(aliasEnvironment))).toEqual(requiredBrowserSteps);
    expect(commands(execute(aliasEnvironment))).toEqual([]);
    const external = join(fixture.tools, "outside-distribution");
    writeFileSync(external, "outside content");
    symlinkSync(
      relative(chromium.directory, external),
      join(chromium.directory, "escape"),
    );
    const escape = execute();
    expect(commands(escape)).toEqual(requiredBrowserSteps);
    expect(escape.stdout.mock.calls.flat().join("\n")).toContain(
      "local evidence not retained",
    );
    rmSync(join(chromium.directory, "escape"));
    rmSync(headless.directory, { recursive: true });
    const missing = execute();
    expect(commands(missing)).toEqual(requiredBrowserSteps);
    expect(missing.stdout.mock.calls.flat().join("\n")).toContain(
      "local evidence not retained",
    );
  }, 60000);

  it("requires durable invalidation before fresh local execution", () => {
    const repository = createRepository();
    commit(repository, "src/runtime.ts", "seed\n");
    localVerification(repository, { args: ["--database"] });
    const marker = evidenceFile(repository, "attempt");
    const directory = dirname(marker);
    const originalMarker = readFileSync(marker, "utf8");
    const provenance = JSON.parse(
      readFileSync(evidenceFile(repository, "success")),
    ).head;
    chmodSync(directory, 0o500);
    try {
      const blocked = localVerification(repository, {
        args: ["--database", "--full"],
      });
      expect(blocked.status).toBe(1);
      expect(commands(blocked)).toEqual([]);
      expect(blocked.stderr.mock.calls.flat().join("\n")).toContain(
        "verification-admission-failure",
      );
      expect(blocked.stderr.mock.calls.flat().join("\n")).not.toContain(
        '"type":"verification-failure"',
      );
      expect(blocked.stdout.mock.calls.flat().join("\n")).not.toContain(
        '"type":"verification-phase"',
      );
    } finally {
      chmodSync(directory, 0o700);
    }
    const recovered = localVerification(repository, { args: ["--database"] });
    expect(commands(recovered)).toEqual([]);
    expect(recovered.stdout.mock.calls.flat().join("\n")).toContain(
      `HEAD ${provenance}`,
    );
    const failedAttempt = localVerification(repository, {
      args: ["--database", "--full"],
      run: vi.fn(() => {
        expect(readFileSync(marker, "utf8")).not.toBe(originalMarker);
        return { status: 9 };
      }),
    });
    expect(failedAttempt.status).toBe(9);
    expect(
      commands(localVerification(repository, { args: ["--database"] })),
    ).toEqual(requiredDatabaseSteps);
    for (const fault of [
      "write",
      "file-flush",
      "rename",
      "directory-flush",
      "readback",
    ]) {
      const originalWrite = fs.writeFileSync;
      const originalFlush = fs.fsyncSync;
      const originalRename = fs.renameSync;
      const originalRead = fs.readFileSync;
      const spies = [
        vi.spyOn(fs, "writeFileSync").mockImplementation((...args) => {
          if (fault === "write")
            throw Object.assign(new Error("fixture denied marker write"), {
              code: "EACCES",
            });
          return originalWrite(...args);
        }),
        vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
          const directory = fs.fstatSync(fd).isDirectory();
          if (
            (fault === "directory-flush" && directory) ||
            (fault === "file-flush" && !directory)
          )
            throw Object.assign(new Error("fixture denied flush"), {
              code: "EIO",
            });
          return originalFlush(fd);
        }),
        vi.spyOn(fs, "renameSync").mockImplementation((...args) => {
          if (fault === "rename")
            throw Object.assign(new Error("fixture denied rename"), {
              code: "EACCES",
            });
          return originalRename(...args);
        }),
        vi.spyOn(fs, "readFileSync").mockImplementation((...args) => {
          if (fault === "readback")
            throw Object.assign(new Error("fixture denied readback"), {
              code: "EIO",
            });
          return originalRead(...args);
        }),
      ];
      try {
        const blocked = localVerification(repository, {
          args: ["--database", "--full"],
        });
        expect(blocked.status, fault).toBe(1);
        expect(commands(blocked), fault).toEqual([]);
        expect(blocked.stderr.mock.calls.flat().join("\n"), fault).toContain(
          "verification-admission-failure",
        );
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    }
    const originalRename = fs.renameSync;
    const browserDenied = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((from, to) => {
        if (to.endsWith("browser.attempt.json"))
          throw Object.assign(new Error("fixture denied browser marker"), {
            code: "EACCES",
          });
        return originalRename(from, to);
      });
    try {
      const combined = localVerification(repository, { args: ["--full"] });
      expect(combined.status).toBe(1);
      expect(commands(combined)).toEqual(requiredBaselineSteps);
      expect(combined.stderr.mock.calls.flat().join("\n")).toContain(
        '"group":"browser"',
      );
      expect(combined.stdout.mock.calls.flat().join("\n")).not.toContain(
        "database: executed",
      );
    } finally {
      browserDenied.mockRestore();
    }
  }, 60000);

  it("keeps completion write failures separate from product outcomes", () => {
    const repository = createRepository();
    commit(repository, "src/runtime.ts", "seed\n");
    localVerification(repository, { args: ["--database"] });
    const receipt = evidenceFile(repository, "success");
    const marker = evidenceFile(repository, "attempt");
    const directory = dirname(receipt);
    const originalReceipt = readFileSync(receipt, "utf8");
    const originalToken = JSON.parse(originalReceipt).token;
    chmodSync(receipt, 0o000);
    try {
      const completed = localVerification(repository, {
        args: ["--database"],
        run: vi.fn(() => {
          expect(JSON.parse(readFileSync(marker)).token).not.toBe(
            originalToken,
          );
          chmodSync(receipt, 0o600);
          chmodSync(directory, 0o500);
          return { status: 0 };
        }),
      });
      expect(completed.status).toBe(0);
      expect(commands(completed)).toEqual(requiredDatabaseSteps);
      expect(completed.stdout.mock.calls.flat().join("\n")).toContain(
        "local evidence not retained",
      );
      expect(completed.stdout.mock.calls.flat().join("\n")).toContain(
        '"outcome":{"type":"exit","status":0}',
      );
      expect(completed.stderr).not.toHaveBeenCalled();
    } finally {
      chmodSync(directory, 0o700);
      chmodSync(receipt, 0o600);
    }
    expect(readFileSync(receipt, "utf8")).toBe(originalReceipt);
    expect(
      commands(localVerification(repository, { args: ["--database"] })),
    ).toEqual(requiredDatabaseSteps);
    expect(
      commands(localVerification(repository, { args: ["--database"] })),
    ).toEqual([]);
    for (const operation of ["writeFileSync", "fsyncSync", "renameSync"]) {
      const before = readFileSync(receipt, "utf8");
      chmodSync(receipt, 0o000);
      let fault;
      try {
        const completed = localVerification(repository, {
          args: ["--database"],
          run: vi.fn(() => {
            chmodSync(receipt, 0o600);
            fault = vi.spyOn(fs, operation).mockImplementation(() => {
              throw Object.assign(new Error("fixture completion write fault"), {
                code: "EIO",
              });
            });
            return { status: 0 };
          }),
        });
        expect(completed.status, operation).toBe(0);
        expect(
          completed.stdout.mock.calls.flat().join("\n"),
          operation,
        ).toContain("local evidence not retained");
        expect(completed.stderr, operation).not.toHaveBeenCalled();
        expect(fault, operation).toHaveBeenCalled();
      } finally {
        fault?.mockRestore();
        chmodSync(receipt, 0o600);
      }
      expect(readFileSync(receipt, "utf8"), operation).toBe(before);
      expect(
        commands(localVerification(repository, { args: ["--database"] })),
        operation,
      ).toEqual(requiredDatabaseSteps);
    }
  }, 60000);

  it("rejects arguments before running an external command", () => {
    const run = vi.fn();
    const stderr = vi.fn();

    expect(main(["unexpected"], { run, stderr })).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      "Usage: npm run verify [-- [--baseline|--database|--browser] [--full] [--plan]]",
    );
  });

  it("runs the baseline independently without selecting services", () => {
    const result = runVerification(createRepository(), {
      args: ["--baseline"],
    });
    expect(result.status).toBe(0);
    expect(result.calls.map(([command, args]) => [command, args])).toEqual(
      requiredBaselineSteps,
    );
    expect(result.stderr).not.toHaveBeenCalled();
  });

  it.each(["--database", "--browser"])(
    "routes %s independently through the existing selector",
    (mode) => {
      const repository = createRepository();
      commit(repository, "AGENTS.md", "updated instructions\n");
      const prose = runVerification(repository, { args: [mode] });
      expect(prose.status).toBe(0);
      expect(prose.calls).toEqual([]);
      expect(prose.stdout).toHaveBeenCalledWith(
        expect.stringContaining("Expensive verification: skipped"),
      );

      const expected =
        mode === "--database"
          ? [["npm", ["run", "verify:access:database"]]]
          : [
              ["npm", ["run", "verify:access:browser"]],
              ...requiredExpensiveSteps.slice(1),
            ];
      for (const args of [
        [mode, "--full"],
        ["--full", mode],
      ]) {
        const forced = runVerification(repository, { args });
        expect(forced.status).toBe(0);
        expect(
          forced.calls.map(([command, commandArgs]) => [command, commandArgs]),
        ).toEqual(expected);
      }
      write(repository, "src/runtime.ts", "export const value = 'dirty';\n");
      const selected = runVerification(repository, { args: [mode] });
      expect(selected.status).toBe(0);
      expect(selected.calls.map(([command, args]) => [command, args])).toEqual(
        expected,
      );
    },
  );

  it.each([
    ["--database", "--browser"],
    ["--baseline", "--browser"],
    ["--baseline", "--database"],
    ["--full", "--full"],
    ["--plan", "--plan"],
    ["--database", "--database"],
    ["--browser", "unexpected"],
  ])("rejects conflicting or malformed modes %j", (...args) => {
    const result = runVerification("/missing-git-evidence", { args });
    expect(result.status).toBe(2);
    expect(result.run).not.toHaveBeenCalled();
    expect(result.stdout).not.toHaveBeenCalled();
  });

  it.each(["--baseline", "--database", "--browser"])(
    "installs Chromium only for the full browser mode in CI: %s",
    (mode) => {
      const result = runVerification(createRepository(), {
        args: [mode, "--full"],
        environment: { GITHUB_ACTIONS: "true" },
      });
      expect(result.status).toBe(0);
      const installs = result.calls.filter(([command]) => command === "npx");
      expect(installs.map(([command, args]) => [command, args])).toEqual(
        mode === "--browser"
          ? [["npx", ["playwright", "install", "--with-deps", "chromium"]]]
          : [],
      );
    },
  );

  it("keeps both verification groups in their approved order", () => {
    expect(baselineVerificationSteps).toEqual(requiredBaselineSteps);
    expect(expensiveVerificationSteps).toEqual(requiredExpensiveSteps);
  });

  it("chains the node:test suite into the test step the baseline runs", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

    expect(packageJson.scripts.test).toBe("vitest run && npm run test:scripts");
    expect(packageJson.scripts["test:scripts"]).toBe(
      'node --test "scripts/lib/*.test.mjs"',
    );
  });

  it("runs every check with safe test bindings when full is explicit", () => {
    const repository = createRepository();
    const run = vi.fn(() => ({ status: 0 }));
    const expectedEnvironment = {
      EXISTING: "kept",
      APP_ENVIRONMENT: "test",
      NEXTJS_ENV: "test",
      SUPABASE_PROJECT_REF: "local-test",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-test-publishable",
      SUPABASE_SECRET_KEY: "local-test-secret",
      PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
    };

    expect(
      main(["--full"], {
        cwd: repository,
        environment: { EXISTING: "kept" },
        run,
      }),
    ).toBe(0);
    expect(run).toHaveBeenCalledTimes(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );
    for (const call of run.mock.calls) {
      expect(call[2]).toEqual(expectedEnvironment);
    }
  });

  it("stops before every selected command when installed Wrangler or Workerd differs from the lockfile", () => {
    const repository = createRepository();
    writeDependencyMetadata(repository, {
      installedVersions: {
        wrangler: "4.122.0",
        workerd: "1.20260811.1",
      },
    });
    const result = runVerification(repository, { args: ["--full"] });

    expect(result.status).toBe(1);
    expect(result.run).not.toHaveBeenCalled();
    const report = result.stderr.mock.calls.map(([line]) => line).join("\n");
    expect(report).toContain("wrangler");
    expect(report).toContain("expected 4.130.0");
    expect(report).toContain("observed 4.122.0");
    expect(report).toContain("workerd");
    expect(report).toContain("expected 1.20260908.1");
    expect(report).toContain("observed 1.20260811.1");
    expect(report).toContain("npm ci");
  });

  it("does not execute when dependency metadata is missing or malformed", () => {
    const repository = createRepository();
    write(repository, "package-lock.json", "{ malformed\n");
    rmSync(join(repository, "node_modules/workerd/package.json"));

    const result = runVerification(repository, { args: ["--full"] });

    expect(result.status).toBe(1);
    expect(result.run).not.toHaveBeenCalled();
    const report = result.stderr.mock.calls.map(([line]) => line).join("\n");
    expect(report).toContain("wrangler");
    expect(report).toContain("expected version cannot be established");
    expect(report).toContain("workerd");
    expect(report).toContain("observed installed version missing");
    expect(report).toContain("npm ci");
  });

  it("keeps plan-only output non-mutating when dependency metadata is unavailable", () => {
    const repository = createRepository();
    rmSync(join(repository, "package-lock.json"));
    rmSync(join(repository, "node_modules/wrangler/package.json"));

    const result = runVerification(repository, { args: ["--full", "--plan"] });

    expect(result.status).toBe(0);
    expect(result.run).not.toHaveBeenCalled();
    expect(result.stdout).toHaveBeenCalledWith(
      "Dependency preflight: Wrangler and Workerd will be checked before execution; not run in plan-only mode.",
    );
  });

  it("skips the dependency preflight when no verification commands are selected", () => {
    const repository = createRepository();
    commit(repository, "AGENTS.md", "updated instructions\n");
    rmSync(join(repository, "node_modules/wrangler/package.json"));
    rmSync(join(repository, "node_modules/workerd/package.json"));

    const executed = runVerification(repository, { args: ["--database"] });
    const planned = runVerification(repository, {
      args: ["--database", "--plan"],
    });

    expect(executed.status).toBe(0);
    expect(executed.run).not.toHaveBeenCalled();
    expect(planned.status).toBe(0);
    expect(planned.run).not.toHaveBeenCalled();
    expect(planned.stdout).toHaveBeenCalledWith(
      "Dependency preflight: unnecessary because no verification commands are selected.",
    );
  });

  it("does not reuse a placeholder Worker build unless compilation succeeds", () => {
    const repository = createRepository();
    const run = vi.fn((command, args) => ({
      status:
        command === "npm" && args.join(" ") === "run build:worker" ? 8 : 0,
    }));
    expect(
      main(["--browser", "--full"], {
        cwd: repository,
        environment: {},
        run,
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(8);
    expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ["npm", ["run", "verify:access:browser"]],
      ["npm", ["run", "build:worker"]],
    ]);
  });

  it("stops immediately and preserves a failing exit code", () => {
    const repository = createRepository();
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 7 });
    const stderr = vi.fn();

    expect(main(["--full"], { cwd: repository, run, stderr })).toBe(7);
    expect(run).toHaveBeenCalledTimes(2);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("later selected checks were not reached"),
    );
  });

  it("reports prepared failure recipes without guessing a combined access group", () => {
    const repository = createRepository();
    const baselineRecipe = ["npm", "run", "verify", "--", "--baseline"];
    const databaseRecipe = [
      "npm",
      "run",
      "verify",
      "--",
      "--database",
      "--full",
    ];
    const browserRecipe = ["npm", "run", "verify", "--", "--browser", "--full"];
    const combinedRecipe = ["npm", "run", "verify", "--", "--full"];
    const chromium = [
      "npx",
      ["playwright", "install", "--with-deps", "chromium"],
    ];
    const scenarios = [
      ...requiredBaselineSteps.map((failedStep) => ({
        args: ["--baseline"],
        steps: requiredBaselineSteps,
        failedStep,
        reproduction: { reproduceGroup: baselineRecipe },
      })),
      {
        args: ["--database", "--full"],
        steps: requiredDatabaseSteps,
        failedStep: requiredDatabaseSteps[0],
        reproduction: { reproduceGroup: databaseRecipe },
      },
      ...[chromium, ...requiredBrowserSteps].map((failedStep) => ({
        args: ["--browser", "--full"],
        steps: [chromium, ...requiredBrowserSteps],
        failedStep,
        reproduction: { reproduceGroup: browserRecipe },
      })),
      {
        args: ["--full"],
        steps: [...requiredBaselineSteps, chromium, ...requiredExpensiveSteps],
        failedStep: requiredExpensiveSteps[0],
        reproduction: { reproduceSelectedGroups: combinedRecipe },
      },
    ];
    const failures = [
      { result: { status: 7 }, status: 7 },
      { result: { status: null, signal: "SIGTERM" }, status: 1 },
      {
        result: {
          status: null,
          error: Object.assign(new Error("executable unavailable"), {
            code: "ENOENT",
          }),
        },
        status: 1,
      },
    ];

    for (const scenario of scenarios) {
      for (const failure of failures) {
        const stdout = vi.fn();
        const stderr = vi.fn();
        const failedIndex = scenario.steps.indexOf(scenario.failedStep);
        const run = vi.fn(() =>
          run.mock.calls.length === failedIndex + 1
            ? failure.result
            : { status: 0 },
        );

        expect(
          main(scenario.args, {
            cwd: repository,
            environment: { GITHUB_ACTIONS: "true" },
            run,
            stdout,
            stderr,
          }),
        ).toBe(failure.status);
        expect(
          run.mock.calls.map(([command, args]) => [command, args]),
        ).toEqual(scenario.steps.slice(0, failedIndex + 1));
        const diagnostics = stderr.mock.calls
          .map(([line]) => line)
          .filter((line) => line.startsWith("{"))
          .map((line) => JSON.parse(line));
        expect(diagnostics).toEqual([
          {
            type: "verification-failure",
            attemptedCommand: [
              scenario.failedStep[0],
              ...scenario.failedStep[1],
            ],
            ...scenario.reproduction,
          },
        ]);
      }
    }
  });

  it("reproduces a failed browser group with its bindings and Worker artifact prerequisites", () => {
    const repository = createRepository();
    commit(repository, "docs/research/study.md", "# Study\n");
    const requiredBindings = {
      APP_ENVIRONMENT: "test",
      NEXTJS_ENV: "test",
      SUPABASE_PROJECT_REF: "local-test",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-test-publishable",
      SUPABASE_SECRET_KEY: "local-test-secret",
      PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
    };
    const conflictingBindings = Object.fromEntries(
      Object.keys(requiredBindings).map((key) => [
        key,
        `inherited-${key}-private`,
      ]),
    );

    for (const environment of [{}, conflictingBindings]) {
      const execute = (args) => {
        let artifactPresent = false;
        const stdout = vi.fn();
        const stderr = vi.fn();
        const run = vi.fn((command, commandArgs, bindings, cwd) => {
          expect(cwd).toBe(repository);
          if (
            Object.entries(requiredBindings).some(
              ([key, value]) => bindings[key] !== value,
            )
          ) {
            return { status: 71 };
          }
          if (
            command === "npm" &&
            commandArgs.join(" ") === "run build:worker"
          ) {
            artifactPresent = true;
          }
          if (
            command === "npm" &&
            commandArgs.join(" ") === "run scan:client-secrets"
          ) {
            return { status: artifactPresent ? 7 : 72 };
          }
          return { status: 0 };
        });
        const status = main(args, {
          cwd: repository,
          environment,
          run,
          stdout,
          stderr,
        });
        const diagnostic = stderr.mock.calls
          .map(([line]) => line)
          .filter((line) => line.startsWith("{"))
          .map((line) => JSON.parse(line))[0];
        const output = [...stdout.mock.calls, ...stderr.mock.calls]
          .map(([line]) => line)
          .join("\n");
        for (const value of [
          ...Object.values(requiredBindings),
          ...Object.values(environment),
        ]) {
          expect(output).not.toContain(value);
        }
        return { diagnostic, run, status };
      };

      const failed = execute(["--browser", "--full"]);
      expect(failed.status).toBe(7);
      expect(failed.diagnostic.attemptedCommand).toEqual([
        "npm",
        "run",
        "scan:client-secrets",
      ]);
      expect(failed.diagnostic.reproduceGroup.slice(0, 4)).toEqual([
        "npm",
        "run",
        "verify",
        "--",
      ]);

      const reproduced = execute(failed.diagnostic.reproduceGroup.slice(4));
      expect(reproduced.status).toBe(7);
      for (const result of [failed, reproduced]) {
        expect(
          result.run.mock.calls.map(([command, args]) => [command, args]),
        ).toEqual([
          ["npm", ["run", "verify:access:browser"]],
          ["npm", ["run", "build:worker"]],
          ["npm", ["run", "scan:client-secrets"]],
        ]);
      }
    }
  });

  it("records command timing only after execution and preserves fail-fast outcomes", () => {
    const repository = createRepository();
    const expectedSteps = [...requiredBaselineSteps, ...requiredExpensiveSteps];
    const scenarios = [
      {
        result: { status: 0 },
        outcome: { type: "exit", status: 0 },
        status: 0,
        expectedSteps,
      },
      {
        result: { status: 7 },
        outcome: { type: "exit", status: 7 },
        status: 7,
        expectedSteps: expectedSteps.slice(0, 2),
      },
      {
        result: { status: null, signal: "SIGTERM" },
        outcome: { type: "signal", signal: "SIGTERM" },
        status: 1,
        expectedSteps: expectedSteps.slice(0, 2),
      },
      {
        result: {
          status: null,
          error: Object.assign(new Error("executable unavailable"), {
            code: "ENOENT",
          }),
        },
        outcome: { type: "spawn-failure", code: "ENOENT" },
        status: 1,
        expectedSteps: expectedSteps.slice(0, 2),
      },
    ];

    for (const scenario of scenarios) {
      let monotonic = 100;
      let utc = "2026-09-26T10:00:00.000Z";
      const records = [];
      const stdout = vi.fn((line) => {
        if (line.startsWith("{")) records.push(JSON.parse(line));
      });
      const run = vi.fn((_command, _args, _environment, cwd) => {
        expect(cwd).toBe(repository);
        expect(records).toHaveLength(run.mock.calls.length - 1);
        monotonic += 37;
        utc = new Date(Date.parse(utc) + 1000).toISOString();
        return run.mock.calls.length === 2 ? scenario.result : { status: 0 };
      });

      expect(
        main(["--full"], {
          cwd: repository,
          environment: {},
          monotonicNow: () => monotonic,
          utcNow: () => utc,
          run,
          stdout,
          stderr: vi.fn(),
        }),
      ).toBe(scenario.status);
      expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual(
        scenario.expectedSteps,
      );
      expect(records).toHaveLength(scenario.expectedSteps.length);
      expect(records.map((record) => record.command)).toEqual(
        scenario.expectedSteps.map(([command, args]) => [command, ...args]),
      );
      expect(records[0]).toEqual({
        type: "verification-phase",
        command: ["npm", "run", "audit:production"],
        startedAt: "2026-09-26T10:00:00.000Z",
        completedAt: "2026-09-26T10:00:01.000Z",
        durationMs: 37,
        outcome: { type: "exit", status: 0 },
      });
      expect(records[1]).toEqual({
        type: "verification-phase",
        command: ["npm", "run", "format:check"],
        startedAt: "2026-09-26T10:00:01.000Z",
        completedAt: "2026-09-26T10:00:02.000Z",
        durationMs: 37,
        outcome: scenario.outcome,
      });
      for (const record of records.slice(2)) {
        expect(record.durationMs).toBe(37);
        expect(record.outcome).toEqual({ type: "exit", status: 0 });
      }
    }

    const planned = runVerification(repository, {
      args: ["--full", "--plan"],
    });
    expect(planned.status).toBe(0);
    expect(planned.run).not.toHaveBeenCalled();
    expect(
      planned.stdout.mock.calls.some(([line]) => line.startsWith("{")),
    ).toBe(false);
    expect(
      planned.stdout.mock.calls
        .map(([line]) => line)
        .filter((line) => line.startsWith("Planned command: "))
        .map((line) => JSON.parse(line.slice("Planned command: ".length))),
    ).toEqual(expectedSteps.map(([command, args]) => [command, ...args]));

    rmSync(join(repository, "node_modules/wrangler/package.json"));
    const blocked = runVerification(repository, { args: ["--full"] });
    expect(blocked.status).toBe(1);
    expect(blocked.run).not.toHaveBeenCalled();
    expect(
      blocked.stdout.mock.calls.some(([line]) => line.startsWith("{")),
    ).toBe(false);
  });

  it("fails loudly when a verification executable cannot start or is signalled", () => {
    const repository = createRepository();
    const stderr = vi.fn();
    const run = vi.fn(() => ({
      error: new Error("executable unavailable"),
      status: null,
    }));

    expect(main(["--full"], { cwd: repository, run, stderr })).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("Unable to run npm: executable unavailable"),
    );

    run.mockReturnValue({ signal: "SIGTERM", status: null });
    expect(main(["--full"], { cwd: repository, run, stderr })).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("Unable to run npm: terminated by SIGTERM"),
    );
  });

  it("runs the baseline only when every changed path is explicitly approved prose", () => {
    const repository = createRepository();
    commit(repository, "AGENTS.md", "updated instructions\n");

    const result = runVerification(repository);

    expect(result.status).toBe(0);
    expect(result.calls.map(([command, args]) => [command, args])).toEqual(
      requiredBaselineSteps,
    );
    expect(result.stdout).toHaveBeenCalledWith(
      expect.stringContaining("Expensive verification: skipped"),
    );
    expect(result.stdout).toHaveBeenCalledWith(
      expect.stringContaining("AGENTS.md"),
    );
  });

  it.each([
    [
      "builder-max runtime",
      ".codex/agents/builder-max.toml",
      "sandbox_mode = 'workspace-write'\n",
    ],
    [
      "a future role definition",
      ".agents/roles/release-captain.md",
      "# Release captain\n",
    ],
    [
      "arbitrary native skill metadata",
      ".agents/skills/future-publisher/agents/openai.yaml",
      "interface:\n  display_name: Future Publisher\n",
    ],
    [
      "reviewer runtime",
      ".codex/agents/reviewer.toml",
      "sandbox_mode = 'workspace-write'\n",
    ],
    [
      "security reviewer runtime",
      ".codex/agents/security-reviewer.toml",
      "sandbox_mode = 'workspace-write'\n",
    ],
    ["run logger", "scripts/run-log.mjs", "export const fixture = true;\n"],
    [
      "run logger test",
      "scripts/lib/run-log.test.mjs",
      "export const fixture = true;\n",
    ],
    [
      "Claude handoff hook",
      ".claude/hooks/check-builder-handoff.mjs",
      "export const fixture = true;\n",
    ],
    ["Claude hook registration", ".claude/settings.json", "{}\n"],
    ["Codex hook registration", ".codex/hooks.json", "{}\n"],
    [
      "Codex handoff hook",
      ".codex/hooks/check-builder-handoff.mjs",
      "export const fixture = true;\n",
    ],
    [
      "Codex handoff adapter",
      "scripts/lib/codex-hook-adapters.mjs",
      "export const fixture = true;\n",
    ],
    [
      "Codex handoff adapter test",
      "scripts/lib/codex-hook-adapters.test.mjs",
      "export const fixture = true;\n",
    ],
    [
      "shared handoff validator",
      "scripts/lib/handoff-check.mjs",
      "export const fixture = true;\n",
    ],
    [
      "shared handoff validator test",
      "scripts/lib/handoff-check.test.mjs",
      "export const fixture = true;\n",
    ],
    ["documentation checker", "scripts/doc-lint.mjs", "export {};\n"],
    [
      "documentation checker library",
      "scripts/lib/doc-lint.mjs",
      "export {};\n",
    ],
    [
      "documentation checker tests",
      "scripts/lib/doc-lint.test.mjs",
      "export {};\n",
    ],
    [
      "documentation link checker",
      "scripts/lib/doc-lint-links.mjs",
      "export {};\n",
    ],
    [
      "documentation citation checker",
      "scripts/lib/doc-lint-citations.mjs",
      "export {};\n",
    ],
    ["agent validator", "scripts/lib/check-agents.mjs", "export {};\n"],
    [
      "agent validator tests",
      "scripts/lib/check-agents.test.mjs",
      "export {};\n",
    ],
    ["output filter", "scripts/lib/test-output-filter.mjs", "export {};\n"],
    [
      "output filter tests",
      "scripts/lib/test-output-filter.test.mjs",
      "export {};\n",
    ],
    ["settings policy", "scripts/lib/settings-policy.test.mjs", "export {};\n"],
    ["pre-commit contract", "scripts/lib/precommit.test.mjs", "export {};\n"],
    ["pre-push contract", "scripts/lib/prepush.test.mjs", "export {};\n"],
    [
      "verify-green contract",
      "scripts/lib/verify-green.test.mjs",
      "export {};\n",
    ],
    ["sweep scope entry", "scripts/sweep-scope-check.mjs", "export {};\n"],
    [
      "sweep scope corpus",
      "scripts/lib/sweep-scope-corpus.mjs",
      "export const PASS_ROWS = [];\n",
    ],
    ["sweep scope library", "scripts/lib/sweep-scope.mjs", "export {};\n"],
    ["sweep scope tests", "scripts/lib/sweep-scope.test.mjs", "export {};\n"],
    [
      "sweep workflow contract",
      "scripts/lib/sweep-scope-workflow.test.mjs",
      "export {};\n",
    ],
    [
      "workflow contract",
      "scripts/lib/workflow-contract.test.mjs",
      "export {};\n",
    ],
    ["issue publisher", "scripts/verify-issue-publish.mjs", "export {};\n"],
    [
      "issue publisher library",
      "scripts/lib/issue-publish.mjs",
      "export {};\n",
    ],
    [
      "board portability contract",
      "scripts/lib/board-portability.test.mjs",
      "export {};\n",
    ],
    ["Claude Git guard", ".claude/hooks/block-unsafe-git.mjs", "export {};\n"],
    [
      "Claude output hook",
      ".claude/hooks/filter-test-output.mjs",
      "export {};\n",
    ],
    [
      "Claude output runner",
      ".claude/hooks/test-output-filter-run.mjs",
      "export {};\n",
    ],
    ["Claude green wrapper", ".claude/hooks/verify-green.sh", "exit 0\n"],
    ["Codex Git guard", ".codex/hooks/block-unsafe-git.mjs", "export {};\n"],
    ["Codex green wrapper", ".codex/hooks/verify-green.sh", "exit 0\n"],
    [
      "Codex browser rule",
      ".codex/rules/playwright.rules",
      'prefix_rule(pattern=["npx"]);\n',
    ],
    ["native hook manual", ".githooks/README.md", "# Hooks\n"],
    ["shared workflow manifest", ".agents/factory-manifest.json", "{}\n"],
    ["merge watch entry", "scripts/merge-watch.mjs", "export {};\n"],
    ["merge watch library", "scripts/lib/merge-watch.mjs", "export {};\n"],
    ["merge watch tests", "scripts/lib/merge-watch.test.mjs", "export {};\n"],
    ["shared workflow sync entry", "scripts/factory-sync.mjs", "export {};\n"],
    [
      "shared workflow sync library",
      "scripts/lib/factory-sync.mjs",
      "export {};\n",
    ],
    [
      "shared workflow sync tests",
      "scripts/lib/factory-sync.test.mjs",
      "export {};\n",
    ],
    [
      "Codex browser rule test",
      "scripts/lib/codex-browser-policy.test.mjs",
      "export {};\n",
    ],
    [
      "product manual contract test",
      "scripts/lib/product-manual.test.mjs",
      "export {};\n",
    ],
  ])(
    "keeps reviewed workflow-only %s on baseline evidence",
    (_label, path, contents) => {
      const repository = createRepository();
      commit(repository, path, contents);

      const result = runVerification(repository);

      expect(result.calls.map(([command, args]) => [command, args])).toEqual(
        requiredBaselineSteps,
      );
    },
  );

  it("keeps every current regular agent definition and future names on baseline evidence", () => {
    const repository = createRepository();
    const paths = [
      ...currentRegularAgentDefinitions,
      ".agents/roles/future-role.md",
      ".agents/skills/future-skill/SKILL.md",
      ".agents/templates/future-template.md",
      ".claude/agents/future-agent.md",
      ".claude/templates/future-template.md",
      ".codex/agents/future-agent.toml",
    ];
    for (const path of paths)
      write(repository, path, `definition for ${path}\n`);
    git(repository, ["add", "."]);
    git(repository, ["commit", "-m", "agent definitions"]);

    const result = runVerification(repository);

    expect(result.calls.map(([command, args]) => [command, args])).toEqual(
      requiredBaselineSteps,
    );
  });

  it.each([
    [
      "vendored skill prose",
      ".agents/upstream/mattpocock-skills/example/SKILL.md",
    ],
    [
      "vendored skill metadata",
      ".agents/upstream/mattpocock-skills/example/agents/openai.yaml",
    ],
    ["vendored licence", ".agents/upstream/mattpocock-skills/LICENSE"],
  ])("keeps %s on baseline evidence", (_label, path) => {
    const repository = createRepository();
    commit(repository, path, "vendored fixture\n");

    expect(
      runVerification(repository).calls.map(([command, args]) => [
        command,
        args,
      ]),
    ).toEqual(requiredBaselineSteps);
  });

  it.each([
    ".claude/skills/example/SKILL.md",
    ".claude/skills/example/references/guide.md",
    ".claude/skills/example/agents/openai.yaml",
    ".claude/hooks/.gitattributes",
    ".codex/hooks/.gitattributes",
    ".githooks/.gitattributes",
    ".codex/hooks/verify-green.mjs",
  ])("keeps copied workflow file %s on baseline evidence", (path) => {
    const repository = createRepository();
    commit(repository, path, "copied workflow fixture\n");

    const result = runVerification(repository);

    expect(result.status).toBe(0);
    expect(result.calls.map(([command, args]) => [command, args])).toEqual(
      requiredBaselineSteps,
    );
  });

  it("requires full evidence for root LF checkout policy", () => {
    const repository = createRepository();
    commit(repository, ".gitattributes", "* text=auto eol=lf\n");

    const result = runVerification(repository);

    expect(result.status).toBe(0);
    expect(result.calls.map(([command, args]) => [command, args])).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
  });

  it.each([
    ".claude/skills/example/scripts/runtime.mjs",
    ".claude/skills/example/fixtures/worker/agents/openai.yaml",
  ])(
    "does not classify executable copied skill input as baseline: %s",
    (path) => {
      const repository = createRepository();
      commit(repository, path, "export {};\n");

      const result = runVerification(repository);

      expect(result.status).toBe(3);
      expect(result.run).not.toHaveBeenCalled();
      expect(result.stderr).toHaveBeenCalledWith(expect.stringContaining(path));
    },
  );

  it.each([
    ".githooks/pre-commit",
    ".githooks/pre-merge-commit",
    ".githooks/pre-push",
    "scripts/board.mjs",
  ])(
    "keeps the named executable workflow entry %s on baseline evidence",
    (path) => {
      const repository = createRepository();
      write(repository, path, "#!/bin/sh\nexit 0\n");
      chmodSync(join(repository, path), 0o755);
      git(repository, ["add", path]);
      git(repository, ["commit", "-m", "workflow entry"]);

      expect(
        runVerification(repository).calls.map(([command, args]) => [
          command,
          args,
        ]),
      ).toEqual(requiredBaselineSteps);
    },
  );

  it.each([
    ["research prose", "docs/research/future-study.md"],
    ["retained document", "docs/discovery/future-decisions.docx"],
    ["documentation illustration", "docs/product/assets/future-map.png"],
  ])("keeps %s on baseline evidence", (_label, path) => {
    const repository = createRepository();
    commit(repository, path, "fixture\n");

    expect(
      runVerification(repository).calls.map(([command, args]) => [
        command,
        args,
      ]),
    ).toEqual(requiredBaselineSteps);
  });

  it.each([
    [
      "global presentation CSS",
      "src/app/globals.css",
      "body { color: black; }\n",
    ],
    ["bundled image", "public/uploads/hero.png", "image bytes\n"],
    [
      "self-hosted font stylesheet",
      "src/app/fonts.css",
      '@font-face { font-family: "Karla"; }\n',
    ],
    ["self-hosted font file", "public/fonts/karla-latin.woff2", "font bytes\n"],
    [
      "shell journey",
      "tests/marketplace-shell.spec.ts",
      "test('shell', () => {});\n",
    ],
    [
      "interaction journey",
      "tests/interaction-controls.spec.ts",
      "test('controls', () => {});\n",
    ],
    [
      "booking display journey",
      "tests/booking-request-display.spec.ts",
      "test('display', () => {});\n",
    ],
  ])(
    "selects browser evidence without database evidence for %s",
    (_label, path, contents) => {
      const repository = createRepository();
      commit(repository, path, contents);

      const result = runVerification(repository);

      expect(result.calls.map(([command, args]) => [command, args])).toEqual([
        ...requiredBaselineSteps,
        ...requiredBrowserSteps,
      ]);
      expect(
        result.calls.map(([command, args]) => [command, args]),
      ).not.toEqual(expect.arrayContaining(requiredDatabaseSteps));
      expect(result.stdout).toHaveBeenCalledWith(
        expect.stringContaining("Database verification: skipped"),
      );
      expect(result.stdout).toHaveBeenCalledWith(
        expect.stringContaining("Browser verification: selected"),
      );
    },
  );

  it.each([
    ["runtime code", "src/runtime.ts", "export const value = 'changed';\n"],
    ["a test", "src/runtime.test.ts", "throw new Error('fixture');\n"],
    ["a dependency file", "package.json", "{}\n"],
    ["root git ignore", ".gitignore", "node_modules/\n.demo/\n"],
    ["root Prettier ignore", ".prettierignore", "node_modules\n"],
    ["root Prettier config", ".prettierrc.json", "{}\n"],
    [
      "the selector itself",
      "scripts/verify.mjs",
      "export const changed = true;\n",
    ],
    [
      "the selector tests",
      "scripts/verify.test.mjs",
      "export const changed = true;\n",
    ],
    [
      "a public runtime file",
      "public/_headers",
      "/assets/*\n  cache-control: no-cache\n",
    ],
  ])("selects full verification for %s", (_label, path, contents) => {
    const repository = createRepository();
    commit(repository, path, contents);

    const result = runVerification(repository);

    expect(result.status).toBe(0);
    expect(result.calls.map(([command, args]) => [command, args])).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
    expect(result.stdout).toHaveBeenCalledWith(
      expect.stringContaining("Database verification: selected"),
    );
    expect(result.stdout).toHaveBeenCalledWith(
      expect.stringContaining("Browser verification: selected"),
    );
  });

  it("stops without running anything when a changed path is unclassified", () => {
    const repository = createRepository();
    commit(repository, "unknown-policy.fixture", "unclassified\n");

    const result = runVerification(repository);

    expect(result.status).toBe(3);
    expect(result.run).not.toHaveBeenCalled();
    expect(result.stderr).toHaveBeenCalledWith(
      expect.stringContaining("unknown-policy.fixture"),
    );
    expect(result.stderr).toHaveBeenCalledWith(
      expect.stringMatching(/1 changed path is not listed/),
    );
    expect(result.stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        "the fallback would select full verification, which runs the database and browser checks",
      ),
    );
    // The remediation names only the two flags that bypass classification. The other two
    // re-enter the selector and stop again, which the group-flag cases below prove, so
    // offering them here would send the operator round the same loop.
    expect(result.stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        "running again with an explicit --full or --baseline",
      ),
    );
    expect(result.stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        "--database and --browser still consult it and stop here again",
      ),
    );
  });

  it("names only the unclassified path when a classified path also changed", () => {
    const repository = createRepository();
    commit(repository, "unknown-policy.fixture", "unclassified\n");
    commit(repository, "src/runtime.ts", "export const value = 'changed';\n");

    const result = runVerification(repository);

    expect(result.status).toBe(3);
    expect(result.run).not.toHaveBeenCalled();
    const report = result.stderr.mock.calls.map(([line]) => line).join("\n");
    expect(report).toContain("unknown-policy.fixture");
    expect(report).not.toContain("src/runtime.ts");
    expect(report).toMatch(/1 changed path is not listed/);
  });

  it("counts every unclassified path in one report", () => {
    const repository = createRepository();
    commit(repository, "unknown-policy.fixture", "unclassified\n");
    commit(repository, "unknown-runtime.fixture", "runtime\n");

    const result = runVerification(repository);

    expect(result.status).toBe(3);
    const report = result.stderr.mock.calls.map(([line]) => line).join("\n");
    expect(report).toMatch(/2 changed paths are not listed/);
    expect(report).toContain("unknown-policy.fixture\nunknown-runtime.fixture");
  });

  it.each(["--database", "--browser", "--plan"])(
    "stops %s on an unclassified path because each one still selects a route",
    (mode) => {
      const repository = createRepository();
      commit(repository, "unknown-policy.fixture", "unclassified\n");

      const result = runVerification(repository, { args: [mode] });

      expect(result.status).toBe(3);
      expect(result.run).not.toHaveBeenCalled();
      expect(result.stderr).toHaveBeenCalledWith(
        expect.stringContaining("unknown-policy.fixture"),
      );
    },
  );

  it.each(["--full", "--baseline"])(
    "lets %s confirm the route while an unclassified path is present",
    (mode) => {
      const repository = createRepository();
      commit(repository, "unknown-policy.fixture", "unclassified\n");

      const result = runVerification(repository, { args: [mode] });

      expect(result.status).toBe(0);
      expect(result.calls.map(([command, args]) => [command, args])).toEqual(
        mode === "--baseline"
          ? requiredBaselineSteps
          : [...requiredBaselineSteps, ...requiredExpensiveSteps],
      );
      expect(result.stderr).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["an asset", "docs/product/assets/runtime.json", "{}\n"],
    ["an agent script", ".agents/roles/runtime.mjs", "export {};\n"],
    ["an agent config", ".agents/roles/runtime.json", "{}\n"],
    [
      "an agent TypeScript file",
      ".agents/skills/tool/runtime.ts",
      "export {};\n",
    ],
    [
      "nested native skill metadata",
      ".agents/skills/future-publisher/fixtures/worker/agents/openai.yaml",
      "interface:\n  display_name: Nested Fixture\n",
    ],
    ["a docs script", "docs/research/runtime.js", "export {};\n"],
    ["a category lookalike", ".agents-copy/roles/reviewer.md", "# Lookalike\n"],
    ["a docs lookalike", "docs-copy/research/study.md", "# Lookalike\n"],
  ])("refuses to treat %s as approved prose", (_label, path, contents) => {
    const repository = createRepository();
    commit(repository, path, contents);

    const result = runVerification(repository);

    expect(result.status).toBe(3);
    expect(result.run).not.toHaveBeenCalled();
    expect(result.stderr).toHaveBeenCalledWith(expect.stringContaining(path));
  });

  it.each([
    [
      "board configuration",
      "scripts/lib/board-config.mjs",
      "export const BOARD_PROJECT_NUMBER = 4;\n",
    ],
    [
      "a board test",
      "scripts/lib/board-rules.test.mjs",
      "export const fixture = true;\n",
    ],
    [
      "the end-to-end board CLI test",
      "scripts/lib/board-cli.test.mjs",
      "export const fixture = true;\n",
    ],
    [
      "the board command",
      "scripts/board.mjs",
      "export const main = () => 0;\n",
    ],
    [
      "the board-add command",
      "scripts/board-add.mjs",
      "export const main = () => 0;\n",
    ],
    [
      "the board-move command",
      "scripts/board-move.mjs",
      "export const main = () => 0;\n",
    ],
    [
      "the self-hosted font test",
      "src/app/fonts.test.ts",
      "test('fonts', () => {});\n",
    ],
    ["a font licence", "public/fonts/OFL-karla.txt", "licence text\n"],
  ])("keeps %s on baseline evidence", (_label, path, contents) => {
    const repository = createRepository();
    commit(repository, path, contents);

    const result = runVerification(repository);

    expect(result.status).toBe(0);
    expect(result.calls.map(([command, args]) => [command, args])).toEqual(
      requiredBaselineSteps,
    );
    expect(result.stdout).toHaveBeenCalledWith(
      expect.stringContaining("Database verification: skipped"),
    );
    expect(result.stdout).toHaveBeenCalledWith(
      expect.stringContaining("Browser verification: skipped"),
    );
  });

  it.each([
    [
      "the browser fixtures",
      "scripts/lib/access-browser-fixtures.mjs",
      "export const fixture = true;\n",
    ],
    [
      "the access fixture users",
      "scripts/lib/access-fixture-users.mjs",
      "export const fixture = true;\n",
    ],
    [
      "a migration",
      "supabase/migrations/20260101000000_fixture.sql",
      "-- sql\n",
    ],
  ])("keeps %s on full evidence", (_label, path, contents) => {
    const repository = createRepository();
    commit(repository, path, contents);

    const result = runVerification(repository);

    expect(result.status).toBe(0);
    expect(result.calls.map(([command, args]) => [command, args])).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
  });

  it("lets --full bypass documentation selection", () => {
    const repository = createRepository();
    commit(repository, "AGENTS.md", "updated instructions\n");

    const result = runVerification(repository, { args: ["--full"] });

    expect(result.status).toBe(0);
    expect(result.calls.map(([command, args]) => [command, args])).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
    expect(result.stdout).toHaveBeenCalledWith(
      expect.stringContaining("explicit --full"),
    );
  });

  it("keeps an earlier runtime commit visible after a documentation commit", () => {
    const repository = createRepository();
    commit(repository, "src/runtime.ts", "export const value = 'changed';\n");
    commit(repository, "AGENTS.md", "updated instructions\n");

    const result = runVerification(repository);

    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );
  });

  it("unions dirty, staged-cancelled, and untracked paths", () => {
    const cases = [
      (repository) =>
        write(repository, "src/runtime.ts", "export const value = 'dirty';\n"),
      (repository) => {
        write(repository, "src/runtime.ts", "export const value = 'staged';\n");
        git(repository, ["add", "src/runtime.ts"]);
        write(
          repository,
          "src/runtime.ts",
          "export const value = 'initial';\n",
        );
      },
      (repository) => write(repository, "src/untracked.ts", "export {};\n"),
    ];

    for (const arrange of cases) {
      const repository = createRepository();
      arrange(repository);
      const result = runVerification(repository);
      expect(result.status).toBe(0);
      expect(result.calls).toHaveLength(
        requiredBaselineSteps.length + requiredExpensiveSteps.length,
      );
    }
  });

  it("uses both endpoints of deletions and renames", () => {
    const deletedRepository = createRepository();
    git(deletedRepository, ["rm", "src/runtime.ts"]);
    git(deletedRepository, ["commit", "-m", "delete runtime"]);
    expect(runVerification(deletedRepository).calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );

    const renamedRepository = createRepository();
    mkdirSync(join(renamedRepository, "src"), { recursive: true });
    git(renamedRepository, ["mv", "AGENTS.md", "src/new-agent-manual.md"]);
    git(renamedRepository, ["commit", "-m", "rename manual"]);
    expect(runVerification(renamedRepository).calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );
  });

  it("rejects symlink and tracked file-type exemptions", () => {
    const untrackedRepository = createRepository();
    mkdirSync(join(untrackedRepository, "docs/agents"), { recursive: true });
    symlinkSync(
      "../../src/runtime.ts",
      join(untrackedRepository, "docs/agents/domain.md"),
    );
    expect(runVerification(untrackedRepository).calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );

    const changedRepository = createRepository();
    rmSync(join(changedRepository, "AGENTS.md"));
    symlinkSync("src/runtime.ts", join(changedRepository, "AGENTS.md"));
    git(changedRepository, ["add", "AGENTS.md"]);
    expect(runVerification(changedRepository).calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );
  });

  it.each(["committed", "staged", "unstaged", "untracked"])(
    "rejects %s executable agent prose",
    (state) => {
      const repository = createRepository();
      const path = ".agents/roles/future-role.md";
      write(repository, path, "# Future role\n");
      if (state !== "untracked") {
        git(repository, ["add", path]);
        git(repository, ["commit", "-m", "non-executable role"]);
      }
      chmodSync(join(repository, path), 0o755);
      if (state === "committed" || state === "staged") {
        git(repository, ["add", path]);
      }
      if (state === "committed") {
        git(repository, ["commit", "-m", "executable role"]);
      }

      const result = runVerification(repository);

      expect(result.calls.map(([command, args]) => [command, args])).toEqual([
        ...requiredBaselineSteps,
        ...requiredExpensiveSteps,
      ]);
      expect(result.stdout).toHaveBeenCalledWith(
        expect.stringMatching(/executable/i),
      );
    },
  );

  it("keeps mixed prose and runtime changes on full evidence", () => {
    const repository = createRepository();
    commit(repository, "docs/research/study.md", "# Study\n");
    commit(repository, "src/runtime.ts", "export const value = 'changed';\n");

    expect(runVerification(repository).calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );
  });

  it("selects full verification when Git evidence is missing or shallow", () => {
    const missingRepository = createRepository();
    git(missingRepository, ["update-ref", "-d", "refs/remotes/origin/main"]);
    const missing = runVerification(missingRepository);
    expect(missing.calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );
    expect(missing.stderr).toHaveBeenCalledWith(
      expect.stringContaining("selecting full verification"),
    );

    const source = createRepository();
    commit(source, "AGENTS.md", "updated instructions\n");
    const shallowRepository = mkdtempSync(
      join(tmpdir(), "rentcottage-verify-shallow-"),
    );
    repositories.push(shallowRepository);
    git(tmpdir(), [
      "clone",
      "--depth=1",
      `file://${source}`,
      shallowRepository,
    ]);
    writeDependencyMetadata(shallowRepository);
    const shallow = runVerification(shallowRepository);
    expect(shallow.calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );
    expect(shallow.stderr).toHaveBeenCalledWith(
      expect.stringContaining("shallow"),
    );
  });

  it.each([undefined, "--database", "--browser"])(
    "uses source and checked-out merge histories in CI: %s",
    (mode) => {
      const repository = createRepository();
      const originalBase = git(repository, ["rev-parse", "HEAD"]);

      git(repository, ["switch", "-c", "source", originalBase]);
      commit(repository, "src/runtime.ts", "export const value = 'source';\n");
      const source = commit(repository, "AGENTS.md", "source instructions\n");

      git(repository, ["switch", "main"]);
      commit(repository, "src/runtime.ts", "export const value = 'base';\n");
      const base = git(repository, ["rev-parse", "HEAD"]);
      const merge = spawnSync("git", ["merge", "--no-ff", "source"], {
        cwd: repository,
        encoding: "utf8",
      });
      expect(merge.status).not.toBe(0);
      write(repository, "src/runtime.ts", "export const value = 'base';\n");
      git(repository, ["add", "."]);
      git(repository, ["commit", "-m", "merge source"]);

      const result = runVerification(repository, {
        args: mode ? [mode] : [],
        environment: {
          GITHUB_ACTIONS: "true",
          VERIFY_BASE_SHA: base,
          VERIFY_SOURCE_SHA: source,
        },
      });

      expect(result.status).toBe(0);
      expect(result.calls.map(([command, args]) => [command, args])).toEqual(
        requiredCiSteps(mode),
      );
      expect(result.stdout).toHaveBeenCalledWith(
        `CI Git comparison: merge base ${originalBase}; base ${base}; source ${source}; merge ${git(repository, ["rev-parse", "HEAD"])}`,
      );
    },
  );

  it.each([undefined, "--database", "--browser"])(
    "skips Chromium and expensive checks for a docs-only CI merge: %s",
    (mode) => {
      const repository = createRepository();
      const base = git(repository, ["rev-parse", "HEAD"]);
      const source = commit(repository, "AGENTS.md", "source instructions\n");
      git(repository, ["switch", "main"]);
      git(repository, ["merge", "--no-ff", source]);

      const result = runVerification(repository, {
        args: mode ? [mode] : [],
        environment: {
          GITHUB_ACTIONS: "true",
          VERIFY_BASE_SHA: base,
          VERIFY_SOURCE_SHA: source,
        },
      });

      expect(result.status).toBe(0);
      expect(result.calls.map(([command, args]) => [command, args])).toEqual(
        mode ? [] : requiredBaselineSteps,
      );
      expect(result.stdout).toHaveBeenCalledWith(
        expect.stringContaining("Expensive verification: skipped"),
      );
    },
  );

  it.each([
    ["modification", undefined],
    ["addition", "--database"],
    ["deletion", "--browser"],
  ])(
    "ignores an advanced-base-only runtime %s in CI: %s",
    (baseChange, mode) => {
      const repository = createRepository();
      const originalBase = git(repository, ["rev-parse", "HEAD"]);

      git(repository, ["switch", "-c", "source", originalBase]);
      const source = commit(repository, "AGENTS.md", "source instructions\n");
      git(repository, ["switch", "main"]);
      if (baseChange === "addition") {
        commit(repository, "src/base-only.ts", "export const base = true;\n");
      } else if (baseChange === "deletion") {
        git(repository, ["rm", "src/runtime.ts"]);
        git(repository, ["commit", "-m", "delete runtime on base"]);
      } else {
        commit(repository, "src/runtime.ts", "export const value = 'base';\n");
      }
      const base = git(repository, ["rev-parse", "HEAD"]);
      git(repository, ["merge", "--no-ff", "source"]);

      const result = runVerification(repository, {
        args: mode ? [mode] : [],
        environment: {
          GITHUB_ACTIONS: "true",
          VERIFY_BASE_SHA: base,
          VERIFY_SOURCE_SHA: source,
        },
      });

      expect(result.status).toBe(0);
      expect(result.calls.map(([command, args]) => [command, args])).toEqual(
        mode ? [] : requiredBaselineSteps,
      );
      expect(result.stdout).toHaveBeenCalledWith(
        expect.stringContaining("Expensive verification: skipped"),
      );
    },
  );

  it.each([undefined, "--database", "--browser"])(
    "selects full CI evidence for a runtime change visible only in the merge result: %s",
    (mode) => {
      const repository = createRepository();
      const base = git(repository, ["rev-parse", "HEAD"]);
      const source = commit(repository, "AGENTS.md", "source instructions\n");
      git(repository, ["switch", "main"]);
      git(repository, ["merge", "--no-ff", "--no-commit", source]);
      write(repository, "src/runtime.ts", "export const value = 'merge';\n");
      git(repository, ["add", "."]);
      git(repository, ["commit", "-m", "merge source"]);

      const result = runVerification(repository, {
        args: mode ? [mode] : [],
        environment: {
          GITHUB_ACTIONS: "true",
          VERIFY_BASE_SHA: base,
          VERIFY_SOURCE_SHA: source,
        },
      });

      expect(result.status).toBe(0);
      expect(result.calls.map(([command, args]) => [command, args])).toEqual(
        requiredCiSteps(mode),
      );
      expect(result.stdout).toHaveBeenCalledWith(
        expect.stringContaining("src/runtime.ts requires full evidence"),
      );
    },
  );

  it("prints full and group-scoped plans from execution vectors without running them", () => {
    const cases = [
      {
        args: ["--full"],
        expected: [...requiredBaselineSteps, ...requiredExpensiveSteps],
        scope: "all groups",
      },
      {
        args: ["--database", "--full"],
        expected: requiredDatabaseSteps,
        scope: "database",
      },
    ];

    for (const { args, expected, scope } of cases) {
      const result = runVerification("/missing-git-evidence", {
        args: [...args, "--plan"],
      });
      const planned = result.stdout.mock.calls
        .map(([line]) => line)
        .filter((line) => line.startsWith("Planned command: "))
        .map((line) => JSON.parse(line.slice("Planned command: ".length)))
        .map(([command, ...commandArgs]) => [command, commandArgs]);

      expect(result.status).toBe(0);
      expect(result.run).not.toHaveBeenCalled();
      expect(planned).toEqual(expected);
      expect(result.stdout).toHaveBeenCalledWith(
        `Verification scope: ${scope}`,
      );
      expect(result.stdout).toHaveBeenCalledWith(
        "Plan only: no verification ran.",
      );
    }
  });

  it("prints the same narrow commands that execution consumes", () => {
    const repository = createRepository();
    commit(repository, "docs/research/study.md", "# Study\n");
    const executed = runVerification(repository);
    const planned = runVerification(repository, { args: ["--plan"] });
    const plannedCommands = planned.stdout.mock.calls
      .map(([line]) => line)
      .filter((line) => line.startsWith("Planned command: "))
      .map((line) => JSON.parse(line.slice("Planned command: ".length)))
      .map(([command, ...args]) => [command, args]);

    expect(planned.run).not.toHaveBeenCalled();
    expect(plannedCommands).toEqual(
      executed.calls.map(([command, args]) => [command, args]),
    );
  });

  it("plans CI browser preparation without invoking the Chromium installer", () => {
    const result = runVerification("/missing-git-evidence", {
      args: ["--browser", "--full", "--plan"],
      environment: { GITHUB_ACTIONS: "true" },
    });

    expect(result.run).not.toHaveBeenCalled();
    expect(result.stdout).toHaveBeenCalledWith(
      'Planned command: ["npx","playwright","install","--with-deps","chromium"]',
    );
  });

  it.each(["local", "CI"])(
    "fails closed when %s history has multiple merge bases",
    (context) => {
      const { left, repository, right } = createCrissCrossRepository();
      let options = {};
      if (context === "local") {
        git(repository, ["update-ref", "refs/remotes/origin/main", left]);
      } else {
        git(repository, ["switch", "--detach", left]);
        git(repository, ["merge", "--no-ff", right, "-m", "CI merge"]);
        options = {
          environment: {
            GITHUB_ACTIONS: "true",
            VERIFY_BASE_SHA: left,
            VERIFY_SOURCE_SHA: right,
          },
        };
      }

      const result = runVerification(repository, options);

      expect(result.calls.map(([command, args]) => [command, args])).toEqual(
        context === "CI"
          ? requiredCiSteps(undefined)
          : [...requiredBaselineSteps, ...requiredExpensiveSteps],
      );
      expect(result.stderr).toHaveBeenCalledWith(
        expect.stringContaining("exactly one merge base"),
      );
    },
  );

  it.each([undefined, "--database", "--browser"])(
    "fails closed for invalid CI merge identity: %s",
    (mode) => {
      const repository = createRepository();
      commit(repository, "AGENTS.md", "updated instructions\n");
      const result = runVerification(repository, {
        args: mode ? [mode] : [],
        environment: {
          GITHUB_ACTIONS: "true",
          VERIFY_BASE_SHA: git(repository, ["rev-parse", "origin/main"]),
          VERIFY_SOURCE_SHA: git(repository, ["rev-parse", "HEAD"]),
        },
      });

      expect(result.calls.map(([command, args]) => [command, args])).toEqual(
        requiredCiSteps(mode),
      );
      expect(result.stderr).toHaveBeenCalledWith(
        expect.stringContaining("merge parent"),
      );
    },
  );
});
