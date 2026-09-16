import { spawnSync } from "node:child_process";
import {
  chmodSync,
  globSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
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

const requiredDatabaseSteps = [["npm", ["run", "verify:access:database"]]];

const requiredBrowserSteps = [
  ["npm", ["run", "verify:access:browser"]],
  ...requiredExpensiveSteps.slice(1),
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
      "Usage: npm run verify [-- [--baseline|--database|--browser] [--full] [--plan]]",
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

  it("chains the node:test suite into the test step the baseline runs", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

    expect(packageJson.scripts.test).toBe("vitest run && npm run test:scripts");
    expect(packageJson.scripts["test:scripts"]).toBe(
      'node --test "scripts/lib/*.test.mjs"',
    );
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
      "scripts/run-log.test.mjs",
      "export const fixture = true;\n",
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
    commit(repository, ".prettierrc.json", '{ "semi": true }\n');

    const result = runVerification(repository);

    expect(result.status).toBe(3);
    expect(result.run).not.toHaveBeenCalled();
    expect(result.stderr).toHaveBeenCalledWith(
      expect.stringContaining(".prettierrc.json"),
    );
    expect(result.stderr).toHaveBeenCalledWith(
      expect.stringMatching(/1 changed path is not listed/),
    );
    expect(result.stderr).toHaveBeenCalledWith(
      expect.stringContaining("--full, --baseline, --database or --browser"),
    );
  });

  it("names only the unclassified path when a classified path also changed", () => {
    const repository = createRepository();
    commit(repository, ".prettierrc.json", '{ "semi": true }\n');
    commit(repository, "src/runtime.ts", "export const value = 'changed';\n");

    const result = runVerification(repository);

    expect(result.status).toBe(3);
    expect(result.run).not.toHaveBeenCalled();
    const report = result.stderr.mock.calls.map(([line]) => line).join("\n");
    expect(report).toContain(".prettierrc.json");
    expect(report).not.toContain("src/runtime.ts");
    expect(report).toMatch(/1 changed path is not listed/);
  });

  it("counts every unclassified path in one report", () => {
    const repository = createRepository();
    commit(repository, ".prettierrc.json", '{ "semi": true }\n');
    commit(repository, "unknown-runtime.fixture", "runtime\n");

    const result = runVerification(repository);

    expect(result.status).toBe(3);
    const report = result.stderr.mock.calls.map(([line]) => line).join("\n");
    expect(report).toMatch(/2 changed paths are not listed/);
    expect(report).toContain(".prettierrc.json\nunknown-runtime.fixture");
  });

  it.each(["--database", "--browser", "--plan"])(
    "stops %s on an unclassified path because each one still selects a route",
    (mode) => {
      const repository = createRepository();
      commit(repository, ".prettierrc.json", '{ "semi": true }\n');

      const result = runVerification(repository, { args: [mode] });

      expect(result.status).toBe(3);
      expect(result.run).not.toHaveBeenCalled();
      expect(result.stderr).toHaveBeenCalledWith(
        expect.stringContaining(".prettierrc.json"),
      );
    },
  );

  it.each(["--full", "--baseline"])(
    "lets %s confirm the route while an unclassified path is present",
    (mode) => {
      const repository = createRepository();
      commit(repository, ".prettierrc.json", '{ "semi": true }\n');

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
      "the payment upgrade worker",
      "scripts/lib/booking-request-payment-upgrade-worker.mjs",
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

      expect(result.calls).toHaveLength(
        requiredBaselineSteps.length + requiredExpensiveSteps.length,
      );
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
