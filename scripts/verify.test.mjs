import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baselineVerificationSteps,
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

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function write(repository, path, contents) {
  const target = join(repository, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function createRepository() {
  const repository = mkdtempSync(join(tmpdir(), "rentcottage-verify-"));
  repositories.push(repository);
  git(repository, ["init", "--initial-branch=main"]);
  git(repository, ["config", "user.name", "Verification Test"]);
  git(repository, ["config", "user.email", "verify@example.test"]);
  write(repository, "AGENTS.md", "initial instructions\n");
  write(repository, "src/runtime.ts", "export const value = 'initial';\n");
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "initial"]);
  git(repository, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(repository, ["switch", "-c", "job/test"]);
  return repository;
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
    run,
    stderr,
    stdout,
  });
  return { calls, run, status, stderr, stdout };
}

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe("repository verification command", () => {
  it("rejects arguments before running an external command", () => {
    const run = vi.fn();
    const stderr = vi.fn();

    expect(main(["unexpected"], { run, stderr })).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      "Usage: npm run verify [-- [--baseline|--database|--browser] [--full]]",
    );
  });

  it("runs the baseline independently without selecting services", () => {
    const result = runVerification("/missing-git-evidence", {
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
      const result = runVerification("/missing-git-evidence", {
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

  it("runs every check with safe test bindings when full is explicit", () => {
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

    expect(main(["--full"], { environment: { EXISTING: "kept" }, run })).toBe(
      0,
    );
    expect(run).toHaveBeenCalledTimes(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );
    for (const call of run.mock.calls) {
      expect(call[2]).toEqual(expectedEnvironment);
    }
  });

  it("does not reuse a placeholder Worker build unless compilation succeeds", () => {
    const run = vi.fn((command, args) => ({
      status:
        command === "npm" && args.join(" ") === "run build:worker" ? 8 : 0,
    }));
    expect(
      main(["--browser", "--full"], {
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
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 7 });
    const stderr = vi.fn();

    expect(main(["--full"], { run, stderr })).toBe(7);
    expect(run).toHaveBeenCalledTimes(2);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("later selected checks were not reached"),
    );
  });

  it("fails loudly when a verification executable cannot start or is signalled", () => {
    const stderr = vi.fn();
    const run = vi.fn(() => ({
      error: new Error("executable unavailable"),
      status: null,
    }));

    expect(main(["--full"], { run, stderr })).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("Unable to run npm: executable unavailable"),
    );

    run.mockReturnValue({ signal: "SIGTERM", status: null });
    expect(main(["--full"], { run, stderr })).toBe(1);
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
    ["runtime code", "src/runtime.ts", "export const value = 'changed';\n"],
    ["a test", "src/runtime.test.ts", "throw new Error('fixture');\n"],
    ["a dependency file", "package.json", "{}\n"],
    ["an asset", "docs/product/assets/runtime.json", "{}\n"],
    ["an unknown document", "docs/new-runtime-fixture.md", "fixture\n"],
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
      expect.stringContaining("Expensive verification: selected"),
    );
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
      (repository) => write(repository, "unknown-runtime.fixture", "runtime\n"),
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
    mkdirSync(join(renamedRepository, "docs"), { recursive: true });
    git(renamedRepository, ["mv", "AGENTS.md", "docs/new-agent-manual.md"]);
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
        expect.stringContaining(`base ${base}`),
      );
      expect(result.stdout).toHaveBeenCalledWith(
        expect.stringContaining(`source ${source}`),
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
