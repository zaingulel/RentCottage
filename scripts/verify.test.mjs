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
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
  baselineVerificationSteps,
  classifyChanges,
  expensiveVerificationSteps,
  main,
  runStep,
} from "./verify.mjs";
import {
  ROOT,
  requiredBaselineSteps,
  requiredExpensiveSteps,
  requiredDatabaseSteps,
  requiredLightDatabaseSteps,
  requiredBrowserSteps,
  requiredShellSmokeSteps,
  requiredCiSteps,
  git,
  write,
  writeDependencyMetadata,
  createRepository,
  commit,
  runVerification,
  repositories,
} from "./verify-test-fixtures.mjs";

const explicitNodeWorkflowEntries = [
  "scripts/merge-watch.mjs",
  "scripts/doc-lint.mjs",
  ".claude/hooks/filter-test-output.mjs",
  ".claude/hooks/test-output-filter-run.mjs",
];

const currentRegularAgentDefinitions = globSync(
  [
    ".agents/skills/*/SKILL.md",
    ".agents/templates/*.md",
    ".claude/agents/*.md",
    ".codex/agents/*.toml",
  ],
  { cwd: process.cwd() },
).filter((path) => {
  const stat = lstatSync(join(process.cwd(), path));
  return stat.isFile() && (stat.mode & 0o111) === 0;
});

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
      bookingConcurrency: false,
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
        bookingConcurrency: true,
        reason: `${path} is executable or has an executable-mode change`,
      });
    }
  },
);

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
    "GLOSSARY.md",
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

describe("repository verification command", () => {
  it("rejects arguments before running an external command", async () => {
    const run = vi.fn();
    const stderr = vi.fn();

    expect(await main(["unexpected"], { run, stderr })).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      "Usage: npm run verify [-- [--baseline|--database|--browser] [--full] [--plan]]",
    );
  });

  it("runs the baseline independently without selecting services", async () => {
    const result = await runVerification(createRepository(), {
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
    async (mode) => {
      const repository = createRepository();
      commit(repository, "AGENTS.md", "updated instructions\n");
      const prose = await runVerification(repository, { args: [mode] });
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
        const forced = await runVerification(repository, { args });
        expect(forced.status).toBe(0);
        expect(
          forced.calls.map(([command, commandArgs]) => [command, commandArgs]),
        ).toEqual(expected);
      }
      write(repository, "tsconfig.json", "{ dirty }\n");
      const selected = await runVerification(repository, { args: [mode] });
      expect(selected.status).toBe(0);
      expect(selected.calls.map(([command, args]) => [command, args])).toEqual(
        expected,
      );
    },
  );

  it.each(["--database", "--browser"])(
    "runs the selected %s group again on an unchanged local rerun",
    async (mode) => {
      const repository = createRepository();
      write(repository, "tsconfig.json", "{ dirty }\n");
      const expected =
        mode === "--database"
          ? [["npm", ["run", "verify:access:database"]]]
          : [
              ["npm", ["run", "verify:access:browser"]],
              ...requiredExpensiveSteps.slice(1),
            ];
      for (let run = 0; run < 2; run += 1) {
        const result = await runVerification(repository, { args: [mode] });
        expect(result.status).toBe(0);
        expect(result.calls.map(([command, args]) => [command, args])).toEqual(
          expected,
        );
      }
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
  ])("rejects conflicting or malformed modes %j", async (...args) => {
    const result = await runVerification("/missing-git-evidence", { args });
    expect(result.status).toBe(2);
    expect(result.run).not.toHaveBeenCalled();
    expect(result.stdout).not.toHaveBeenCalled();
  });

  it.each(["--baseline", "--database", "--browser"])(
    "installs Chromium only for the full browser mode in CI: %s",
    async (mode) => {
      const result = await runVerification(createRepository(), {
        args: [mode, "--full"],
        environment: { GITHUB_ACTIONS: "true" },
      });
      expect(result.status).toBe(0);
      const installs = result.calls.filter(([command]) => command === "npx");
      expect(installs.map(([command, args]) => [command, args])).toEqual(
        mode === "--browser"
          ? [["npx", ["playwright", "install", "chromium"]]]
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

  it("runs every check with safe test bindings when full is explicit", async () => {
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
      await main(["--full"], {
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

  it("stops before every selected command when installed Wrangler or Workerd differs from the lockfile", async () => {
    const repository = createRepository();
    writeDependencyMetadata(repository, {
      installedVersions: {
        wrangler: "4.122.0",
        workerd: "1.20260811.1",
      },
    });
    const result = await runVerification(repository, { args: ["--full"] });

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

  it("does not execute when dependency metadata is missing or malformed", async () => {
    const repository = createRepository();
    write(repository, "package-lock.json", "{ malformed\n");
    rmSync(join(repository, "node_modules/workerd/package.json"));

    const result = await runVerification(repository, { args: ["--full"] });

    expect(result.status).toBe(1);
    expect(result.run).not.toHaveBeenCalled();
    const report = result.stderr.mock.calls.map(([line]) => line).join("\n");
    expect(report).toContain("wrangler");
    expect(report).toContain("expected version cannot be established");
    expect(report).toContain("workerd");
    expect(report).toContain("observed installed version missing");
    expect(report).toContain("npm ci");
  });

  it("keeps plan-only output non-mutating when dependency metadata is unavailable", async () => {
    const repository = createRepository();
    rmSync(join(repository, "package-lock.json"));
    rmSync(join(repository, "node_modules/wrangler/package.json"));

    const result = await runVerification(repository, {
      args: ["--full", "--plan"],
    });

    expect(result.status).toBe(0);
    expect(result.run).not.toHaveBeenCalled();
    expect(result.stdout).toHaveBeenCalledWith(
      "Dependency preflight: Wrangler and Workerd will be checked before execution; not run in plan-only mode.",
    );
  });

  it("skips the dependency preflight when no verification commands are selected", async () => {
    const repository = createRepository();
    commit(repository, "AGENTS.md", "updated instructions\n");
    rmSync(join(repository, "node_modules/wrangler/package.json"));
    rmSync(join(repository, "node_modules/workerd/package.json"));

    const executed = await runVerification(repository, {
      args: ["--database"],
    });
    const planned = await runVerification(repository, {
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

  it("does not serve a prebuilt build unless the access run that makes it succeeds", async () => {
    const repository = createRepository();
    const run = vi.fn((command, args) => ({
      status:
        command === "npm" && args.join(" ") === "run verify:access:browser"
          ? 8
          : 0,
    }));
    expect(
      await main(["--browser", "--full"], {
        cwd: repository,
        environment: {},
        run,
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(8);
    expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ["npm", ["run", "verify:access:browser"]],
    ]);

    const hosted = createRepository();
    const hostedBase = git(hosted, ["rev-parse", "HEAD"]);
    const hostedSource = commit(
      hosted,
      "src/booking-request/policy.ts",
      "export const value = true;\n",
    );
    git(hosted, ["switch", "main"]);
    git(hosted, ["merge", "--no-ff", hostedSource]);
    const hostedRun = vi.fn((command, args) => ({
      status:
        command === "npm" && args.join(" ") === "run build:worker" ? 8 : 0,
    }));
    expect(
      await main(["--browser"], {
        cwd: hosted,
        environment: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "shell-smoke",
          VERIFY_CI_SHARD: "",
          VERIFY_BASE_SHA: hostedBase,
          VERIFY_SOURCE_SHA: hostedSource,
        },
        run: hostedRun,
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(8);
    expect(
      hostedRun.mock.calls.map(([command, args]) => [command, args]),
    ).toEqual([
      ["npx", ["playwright", "install", "chromium"]],
      ["npm", ["run", "build:worker"]],
    ]);
  });

  it("stops immediately and preserves a failing exit code", async () => {
    const repository = createRepository();
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 7 });
    const stderr = vi.fn();

    expect(await main(["--full"], { cwd: repository, run, stderr })).toBe(7);
    expect(run).toHaveBeenCalledTimes(2);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("later selected checks were not reached"),
    );
  });

  it("reports prepared failure recipes without guessing a combined access group", async () => {
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
    const chromium = ["npx", ["playwright", "install", "chromium"]];
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
          await main(scenario.args, {
            cwd: repository,
            environment: { GITHUB_ACTIONS: "true" },
            run,
            stdout,
            stderr,
          }),
        ).toBe(failure.status);
        const overlapped =
          scenario.args[0] === "--baseline" &&
          failedIndex >= 2 &&
          failedIndex <= 5;
        expect(
          run.mock.calls.map(([command, args]) => [command, args]),
        ).toEqual(scenario.steps.slice(0, overlapped ? 6 : failedIndex + 1));
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

  it("reproduces a failed browser group with its bindings and Worker artifact prerequisites", async () => {
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
      const execute = async (args) => {
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
            commandArgs.join(" ") === "run verify:access:browser"
          ) {
            artifactPresent = true;
          }
          if (command === "npm" && commandArgs[1] === "smoke:preview") {
            return { status: artifactPresent ? 7 : 72 };
          }
          return { status: 0 };
        });
        const status = await main(args, {
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
        // APP_ENVIRONMENT and NEXTJS_ENV are public mode names whose value is the plain
        // word "test", which the runner's own printed command names such as test:browser
        // contain, so they cannot tell a leak from a command name.
        for (const value of [
          ...Object.entries(requiredBindings)
            .filter(([key]) => !["APP_ENVIRONMENT", "NEXTJS_ENV"].includes(key))
            .map(([, bindingValue]) => bindingValue),
          ...Object.values(environment),
        ]) {
          expect(output).not.toContain(value);
        }
        return { diagnostic, run, status };
      };

      const failed = await execute(["--browser", "--full"]);
      expect(failed.status).toBe(7);
      expect(failed.diagnostic.attemptedCommand).toEqual([
        "npm",
        "run",
        "smoke:preview",
        "--",
        "--config=playwright.worker-prebuilt.config.ts",
      ]);
      expect(failed.diagnostic.reproduceGroup.slice(0, 4)).toEqual([
        "npm",
        "run",
        "verify",
        "--",
      ]);

      const reproduced = await execute(
        failed.diagnostic.reproduceGroup.slice(4),
      );
      expect(reproduced.status).toBe(7);
      for (const result of [failed, reproduced]) {
        expect(
          result.run.mock.calls.map(([command, args]) => [command, args]),
        ).toEqual(requiredBrowserSteps);
      }
    }
  });

  it("records command timing only after execution and preserves fail-fast outcomes", async () => {
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
        const call = run.mock.calls.length;
        expect(records).toHaveLength(call >= 3 && call <= 6 ? 2 : call - 1);
        monotonic += 37;
        utc = new Date(Date.parse(utc) + 1000).toISOString();
        return run.mock.calls.length === 2 ? scenario.result : { status: 0 };
      });

      expect(
        await main(["--full"], {
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
        command: ["npm", "run", "audit:shipped-dev"],
        startedAt: "2026-09-26T10:00:01.000Z",
        completedAt: "2026-09-26T10:00:02.000Z",
        durationMs: 37,
        outcome: scenario.outcome,
      });
      expect(records.slice(2, 6).map((record) => record.durationMs)).toEqual(
        scenario.status === 0 ? [148, 111, 74, 37] : [],
      );
      for (const record of records.slice(2)) {
        expect(record.outcome).toEqual({ type: "exit", status: 0 });
      }
      for (const record of records.slice(6)) {
        expect(record.durationMs).toBe(37);
      }
    }

    const planned = await runVerification(repository, {
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
    const blocked = await runVerification(repository, { args: ["--full"] });
    expect(blocked.status).toBe(1);
    expect(blocked.run).not.toHaveBeenCalled();
    expect(
      blocked.stdout.mock.calls.some(([line]) => line.startsWith("{")),
    ).toBe(false);
  });

  it("fails loudly when a verification executable cannot start or is signalled", async () => {
    const repository = createRepository();
    const stderr = vi.fn();
    const run = vi.fn(() => ({
      error: new Error("executable unavailable"),
      status: null,
    }));

    expect(await main(["--full"], { cwd: repository, run, stderr })).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("Unable to run npm: executable unavailable"),
    );

    run.mockReturnValue({ signal: "SIGTERM", status: null });
    expect(await main(["--full"], { cwd: repository, run, stderr })).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("Unable to run npm: terminated by SIGTERM"),
    );
  });

  it("starts format, lint, type and unit checks together and reports each failure under its own name", async () => {
    const repository = createRepository();
    const baselineRecipe = ["npm", "run", "verify", "--", "--baseline"];
    const pending = new Map();
    const run = vi.fn((command, args, _environment, _cwd, overlapped) =>
      overlapped
        ? new Promise((resolve) => {
            pending.set([command, ...args].join(" "), resolve);
          })
        : { status: 0 },
    );
    const stdout = vi.fn();
    const stderr = vi.fn();
    const finished = main(["--baseline"], {
      cwd: repository,
      environment: {},
      run,
      stdout,
      stderr,
    });

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(6));
    expect(
      run.mock.calls.map(([command, args, , , overlapped]) => [
        command,
        args,
        overlapped,
      ]),
    ).toEqual([
      ["npm", ["run", "audit:production"], false],
      ["npm", ["run", "audit:shipped-dev"], false],
      ["npm", ["run", "format:check"], true],
      ["npm", ["run", "lint"], true],
      ["npm", ["run", "typecheck"], true],
      ["npm", ["test"], true],
    ]);
    expect([...pending.keys()]).toEqual([
      "npm run format:check",
      "npm run lint",
      "npm run typecheck",
      "npm test",
    ]);
    const phases = () =>
      stdout.mock.calls
        .map(([line]) => line)
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line).command.join(" "));
    expect(phases()).toEqual([
      "npm run audit:production",
      "npm run audit:shipped-dev",
    ]);

    pending.get("npm test")({ status: 5 });
    pending.get("npm run lint")({ status: 3 });
    pending.get("npm run typecheck")({ status: 0 });
    await vi.waitFor(() => expect(phases()).toHaveLength(5));
    expect(run).toHaveBeenCalledTimes(6);

    pending.get("npm run format:check")({ status: 0 });
    expect(await finished).toBe(3);
    expect(run).toHaveBeenCalledTimes(6);
    expect(phases().slice(2)).toEqual([
      "npm test",
      "npm run lint",
      "npm run typecheck",
      "npm run format:check",
    ]);
    const messages = stderr.mock.calls.map(([line]) => line);
    expect(
      messages
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line)),
    ).toEqual([
      {
        type: "verification-failure",
        attemptedCommand: ["npm", "test"],
        reproduceGroup: baselineRecipe,
      },
      {
        type: "verification-failure",
        attemptedCommand: ["npm", "run", "lint"],
        reproduceGroup: baselineRecipe,
      },
    ]);
    expect(messages.filter((line) => !line.startsWith("{"))).toEqual([
      "npm test failed; 2 later selected checks were not reached.",
      "npm run lint failed; 2 later selected checks were not reached.",
    ]);
  });

  it("keeps the hosted baseline one step at a time", async () => {
    const repository = createRepository();
    const records = [];
    const stdout = vi.fn((line) => {
      if (line.startsWith("{")) records.push(JSON.parse(line));
    });
    const run = vi.fn(() => {
      expect(records).toHaveLength(run.mock.calls.length - 1);
      return { status: 0 };
    });

    expect(
      await main(["--baseline"], {
        cwd: repository,
        environment: {
          GITHUB_ACTIONS: "true",
          RUNNER_ENVIRONMENT: "github-hosted",
        },
        run,
        stdout,
        stderr: vi.fn(),
      }),
    ).toBe(0);
    expect(
      run.mock.calls.map(([command, args, , , overlapped]) => [
        command,
        args,
        overlapped,
      ]),
    ).toEqual(
      requiredBaselineSteps.map(([command, args]) => [command, args, false]),
    );
    expect(records.map((record) => record.command)).toEqual(
      requiredBaselineSteps.map(([command, args]) => [command, ...args]),
    );
  });

  it("replays an overlapped step's output when it ends and returns how it ended", async () => {
    const written = (spy) =>
      spy.mock.calls.map(([chunk]) => chunk.toString()).join("");
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      expect(
        await runStep(
          process.execPath,
          [
            "-e",
            'process.stdout.write("out"); process.stderr.write("err"); process.exitCode = 3;',
          ],
          process.env,
          ROOT,
          true,
        ),
      ).toEqual({ status: 3, signal: null });
      expect(written(out)).toBe("out");
      expect(written(err)).toBe("err");

      out.mockClear();
      err.mockClear();
      expect(
        await runStep(
          join(ROOT, "no-such-verification-executable"),
          [],
          process.env,
          ROOT,
          true,
        ),
      ).toEqual({
        error: expect.objectContaining({ code: "ENOENT" }),
        status: null,
      });
      expect(out).not.toHaveBeenCalled();
      expect(err).not.toHaveBeenCalled();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it("runs the baseline only when every changed path is explicitly approved prose", async () => {
    const repository = createRepository();
    commit(repository, "AGENTS.md", "updated instructions\n");

    const result = await runVerification(repository);

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

  const added = (path) => ({
    path,
    oldMode: "000000",
    newMode: "100644",
    status: "A",
  });
  const routes = {
    baseline: { browser: false, database: false, bookingConcurrency: false },
    database: { browser: false, database: true, bookingConcurrency: false },
    "database with concurrency": {
      browser: false,
      database: true,
      bookingConcurrency: true,
    },
    browser: { browser: true, database: false, bookingConcurrency: false },
    "full without concurrency": {
      browser: true,
      database: true,
      bookingConcurrency: false,
    },
    full: { browser: true, database: true, bookingConcurrency: true },
  };

  it("routes the approved Supabase vendor prose without admitting executable or unknown vendor inputs", () => {
    const prosePaths = [
      ".agents/upstream/supabase-agent-skills/LICENSE",
      ".agents/upstream/supabase-agent-skills/supabase/SKILL.md",
      ".agents/upstream/supabase-agent-skills/supabase-postgres-best-practices/SKILL.md",
      ".agents/upstream/supabase-agent-skills/supabase-postgres-best-practices/references/conn-pooling.md",
    ];
    for (const path of prosePaths) {
      expect(classifyChanges([added(path)])).toMatchObject(routes.baseline);
      for (const [oldMode, newMode, status] of [
        ["000000", "100755", "A"],
        ["000000", "120000", "A"],
        ["100644", "100644", "T"],
      ]) {
        expect(
          classifyChanges([{ path, oldMode, newMode, status }]),
        ).toMatchObject(routes.full);
      }
    }

    for (const path of [
      ".agents/upstream/unknown-vendor/supabase/SKILL.md",
      ".agents/upstream/supabase-agent-skills/supabase/vendor.mjs",
    ]) {
      expect(classifyChanges([added(path)])).toEqual({ unclassified: [path] });
    }
    for (const path of [
      "scripts/unknown-vendor.mjs",
      "scripts/verify.mjs",
      "scripts/verify.test.mjs",
    ]) {
      expect(classifyChanges([added(path)])).toMatchObject(routes.full);
    }
  });

  // The changed path alone decides the route, so these rows need no repository;
  // "selects the route for %s" proves each route's commands end to end.
  it.each([
    ["builder-max runtime", [".codex/agents/builder-max.toml"], "baseline"],
    [
      "arbitrary native skill metadata",
      [".agents/skills/future-publisher/agents/openai.yaml"],
      "baseline",
    ],
    ["reviewer runtime", [".codex/agents/reviewer.toml"], "baseline"],
    [
      "security reviewer runtime",
      [".codex/agents/security-reviewer.toml"],
      "baseline",
    ],
    ["run logger", ["scripts/run-log.mjs"], "baseline"],
    ["run logger test", ["scripts/lib/run-log.test.mjs"], "baseline"],
    [
      "Claude handoff hook",
      [".claude/hooks/check-builder-handoff.mjs"],
      "baseline",
    ],
    ["Claude hook registration", [".claude/settings.json"], "baseline"],
    ["Codex hook registration", [".codex/hooks.json"], "baseline"],
    [
      "Codex handoff hook",
      [".codex/hooks/check-builder-handoff.mjs"],
      "baseline",
    ],
    [
      "Codex handoff adapter",
      ["scripts/lib/codex-hook-adapters.mjs"],
      "baseline",
    ],
    [
      "Codex handoff adapter test",
      ["scripts/lib/codex-hook-adapters.test.mjs"],
      "baseline",
    ],
    ["shared handoff validator", ["scripts/lib/handoff-check.mjs"], "baseline"],
    [
      "shared handoff validator test",
      ["scripts/lib/handoff-check.test.mjs"],
      "baseline",
    ],
    ["documentation checker", ["scripts/doc-lint.mjs"], "baseline"],
    ["documentation checker library", ["scripts/lib/doc-lint.mjs"], "baseline"],
    [
      "documentation checker tests",
      ["scripts/lib/doc-lint.test.mjs"],
      "baseline",
    ],
    [
      "documentation link checker",
      ["scripts/lib/doc-lint-links.mjs"],
      "baseline",
    ],
    [
      "documentation citation checker",
      ["scripts/lib/doc-lint-citations.mjs"],
      "baseline",
    ],
    ["agent validator", ["scripts/lib/check-agents.mjs"], "baseline"],
    [
      "agent validator tests",
      ["scripts/lib/check-agents.test.mjs"],
      "baseline",
    ],
    ["output filter", ["scripts/lib/test-output-filter.mjs"], "baseline"],
    [
      "output filter tests",
      ["scripts/lib/test-output-filter.test.mjs"],
      "baseline",
    ],
    ["settings policy", ["scripts/lib/settings-policy.test.mjs"], "baseline"],
    ["pre-commit contract", ["scripts/lib/precommit.test.mjs"], "baseline"],
    ["pre-push contract", ["scripts/lib/prepush.test.mjs"], "baseline"],
    [
      "verify-green contract",
      ["scripts/lib/verify-green.test.mjs"],
      "baseline",
    ],
    ["sweep scope entry", ["scripts/sweep-scope-check.mjs"], "baseline"],
    ["sweep scope corpus", ["scripts/lib/sweep-scope-corpus.mjs"], "baseline"],
    ["sweep scope library", ["scripts/lib/sweep-scope.mjs"], "baseline"],
    [
      "sweep scope evaluator",
      ["scripts/lib/sweep-scope-evaluate.mjs"],
      "baseline",
    ],
    ["sweep scope tests", ["scripts/lib/sweep-scope.test.mjs"], "baseline"],
    [
      "sweep workflow contract",
      ["scripts/lib/sweep-scope-workflow.test.mjs"],
      "baseline",
    ],
    [
      "workflow contract",
      ["scripts/lib/workflow-contract.test.mjs"],
      "baseline",
    ],
    ["issue publisher", ["scripts/verify-issue-publish.mjs"], "baseline"],
    ["issue publisher library", ["scripts/lib/issue-publish.mjs"], "baseline"],
    [
      "board portability contract",
      ["scripts/lib/board-portability.test.mjs"],
      "baseline",
    ],
    ["Claude Git guard", [".claude/hooks/block-unsafe-git.mjs"], "baseline"],
    [
      "Claude output hook",
      [".claude/hooks/filter-test-output.mjs"],
      "baseline",
    ],
    [
      "Claude output runner",
      [".claude/hooks/test-output-filter-run.mjs"],
      "baseline",
    ],
    ["Claude green wrapper", [".claude/hooks/verify-green.sh"], "baseline"],
    ["Codex Git guard", [".codex/hooks/block-unsafe-git.mjs"], "baseline"],
    ["Codex green wrapper", [".codex/hooks/verify-green.sh"], "baseline"],
    ["Codex browser rule", [".codex/rules/playwright.rules"], "baseline"],
    ["native hook manual", [".githooks/README.md"], "baseline"],
    ["shared workflow manifest", [".agents/factory-manifest.json"], "baseline"],
    ["merge watch entry", ["scripts/merge-watch.mjs"], "baseline"],
    ["merge watch library", ["scripts/lib/merge-watch.mjs"], "baseline"],
    ["merge watch tests", ["scripts/lib/merge-watch.test.mjs"], "baseline"],
    ["shared workflow sync entry", ["scripts/factory-sync.mjs"], "baseline"],
    [
      "shared workflow sync library",
      ["scripts/lib/factory-sync.mjs"],
      "baseline",
    ],
    [
      "shared workflow sync tests",
      ["scripts/lib/factory-sync.test.mjs"],
      "baseline",
    ],
    [
      "Codex browser rule test",
      ["scripts/lib/codex-browser-policy.test.mjs"],
      "baseline",
    ],
    [
      "product manual contract test",
      ["scripts/lib/product-manual.test.mjs"],
      "baseline",
    ],
    [
      "vendored skill prose",
      [".agents/upstream/mattpocock-skills/example/SKILL.md"],
      "baseline",
    ],
    [
      "vendored skill metadata",
      [".agents/upstream/mattpocock-skills/example/agents/openai.yaml"],
      "baseline",
    ],
    [
      "vendored licence",
      [".agents/upstream/mattpocock-skills/LICENSE"],
      "baseline",
    ],
    [
      "vendored frontend-design skill prose",
      [
        ".agents/upstream/anthropics-claude-plugins-official/frontend-design/SKILL.md",
      ],
      "baseline",
    ],
    [
      "vendored frontend-design licence",
      [
        ".agents/upstream/anthropics-claude-plugins-official/frontend-design/LICENSE.txt",
      ],
      "baseline",
    ],
    [
      "vendored accessibility-review skill prose",
      [
        ".agents/upstream/anthropics-knowledge-work-plugins/accessibility-review/SKILL.md",
      ],
      "baseline",
    ],
    [
      "vendored knowledge-work licence",
      [".agents/upstream/anthropics-knowledge-work-plugins/LICENSE"],
      "baseline",
    ],
    [
      "installed skill licence",
      [".agents/skills/frontend-design/LICENSE.txt"],
      "baseline",
    ],
    [
      "copied skill licence",
      [".claude/skills/frontend-design/LICENSE.txt"],
      "baseline",
    ],
    ["copied workflow file", [".claude/skills/example/SKILL.md"], "baseline"],
    [
      "copied workflow file",
      [".claude/skills/example/references/guide.md"],
      "baseline",
    ],
    [
      "copied workflow file",
      [".claude/skills/example/agents/openai.yaml"],
      "baseline",
    ],
    ["copied workflow file", [".claude/hooks/.gitattributes"], "baseline"],
    ["copied workflow file", [".codex/hooks/.gitattributes"], "baseline"],
    ["copied workflow file", [".githooks/.gitattributes"], "baseline"],
    ["copied workflow file", [".codex/hooks/verify-green.mjs"], "baseline"],
    ["root LF checkout policy", [".gitattributes"], "full without concurrency"],
    ["research prose", ["docs/research/future-study.md"], "baseline"],
    ["retained document", ["docs/discovery/future-decisions.docx"], "baseline"],
    [
      "documentation illustration",
      ["docs/product/assets/future-map.png"],
      "baseline",
    ],
    ["documentation web page", ["docs/future-page.html"], "baseline"],
    ["global presentation CSS", ["src/app/globals.css"], "browser"],
    ["bundled image", ["public/uploads/hero.png"], "browser"],
    ["self-hosted font stylesheet", ["src/app/fonts.css"], "browser"],
    ["self-hosted font file", ["public/fonts/karla-latin.woff2"], "browser"],
    ["shell journey", ["tests/marketplace-shell.spec.ts"], "browser"],
    ["interaction journey", ["tests/interaction-controls.spec.ts"], "browser"],
    [
      "booking display journey",
      ["tests/booking-request-display.spec.ts"],
      "browser",
    ],
    ["a public runtime file", ["public/_headers"], "browser"],
    [
      "a domain module",
      ["src/booking-request/booking-request-policy.ts"],
      "baseline",
    ],
    [
      "a database test",
      ["supabase/tests/database/booking_quotes.test.sql"],
      "database",
    ],
    ["a policy declaration", ["supabase/schemas/40_policies.sql"], "database"],
    [
      "a migration",
      ["supabase/migrations/20260101000000_fixture.sql"],
      "database",
    ],
    [
      "a booking function declaration",
      ["supabase/schemas/20_functions_booking.sql"],
      "database with concurrency",
    ],
    [
      "a concurrency program",
      ["scripts/verify-booking-refund-concurrency.mjs"],
      "database with concurrency",
    ],
    ["a component", ["src/components/booking-quote.tsx"], "browser"],
    ["a page", ["src/app/[locale]/bookings/page.tsx"], "browser"],
    ["a browser journey", ["tests/access.spec.ts"], "browser"],
    [
      "a component and a database test",
      [
        "src/components/booking-quote.tsx",
        "supabase/tests/database/booking_quotes.test.sql",
      ],
      "full without concurrency",
    ],
    ["the Supabase configuration", ["supabase/config.toml"], "full"],
    [
      "the concurrency harness",
      ["scripts/local-supabase-concurrency-harness.mjs"],
      "full",
    ],
    ["runtime code", ["custom-worker.ts"], "full without concurrency"],
    [
      "runtime code and the concurrency harness",
      ["custom-worker.ts", "scripts/local-supabase-concurrency-harness.mjs"],
      "full",
    ],
    ["the dependency lockfile", ["package-lock.json"], "full"],
    ["a dependency file", ["package.json"], "full"],
    ["root git ignore", [".gitignore"], "full without concurrency"],
    ["root Prettier ignore", [".prettierignore"], "full without concurrency"],
    ["root Prettier config", [".prettierrc.json"], "full without concurrency"],
    ["the selector itself", ["scripts/verify.mjs"], "full"],
    ["the selector tests", ["scripts/verify.test.mjs"], "full"],
    ["the repository profile", [".agents/REPOSITORY.md"], "baseline"],
    ["board configuration", ["scripts/lib/board-config.mjs"], "baseline"],
    ["a board test", ["scripts/lib/board-rules.test.mjs"], "baseline"],
    [
      "the end-to-end board CLI test",
      ["scripts/lib/board-cli.test.mjs"],
      "baseline",
    ],
    ["the board command", ["scripts/board.mjs"], "baseline"],
    ["the board-add command", ["scripts/board-add.mjs"], "baseline"],
    ["the board-move command", ["scripts/board-move.mjs"], "baseline"],
    ["the self-hosted font test", ["src/app/fonts.test.ts"], "baseline"],
    ["a font licence", ["public/fonts/OFL-karla.txt"], "baseline"],
    [
      "a domain test",
      ["src/booking-request/booking-request-policy.test.ts"],
      "baseline",
    ],
    [
      "the browser fixtures",
      ["scripts/lib/access-browser-fixtures.mjs"],
      "full",
    ],
    [
      "the access fixture users",
      ["scripts/lib/access-fixture-users.mjs"],
      "full",
    ],
  ])("routes %s %j to the %s route", (_label, paths, route) => {
    expect(classifyChanges(paths.map(added))).toMatchObject(routes[route]);
  });

  it.each([
    [
      "executable copied skill input",
      [".claude/skills/example/scripts/runtime.mjs"],
    ],
    [
      "executable copied skill input",
      [".claude/skills/example/fixtures/worker/agents/openai.yaml"],
    ],
    ["an unlisted source module", ["src/reporting/new.ts"]],
    ["an asset", ["docs/product/assets/runtime.json"]],
    ["an agent script", [".agents/templates/runtime.mjs"]],
    ["an agent config", [".agents/templates/runtime.json"]],
    ["a retired template", [".claude/templates/future-template.md"]],
    ["an agent TypeScript file", [".agents/skills/tool/runtime.ts"]],
    [
      "nested native skill metadata",
      [".agents/skills/future-publisher/fixtures/worker/agents/openai.yaml"],
    ],
    ["a docs script", ["docs/research/runtime.js"]],
    ["a category lookalike", [".agents-copy/templates/reviewer.md"]],
    ["a docs lookalike", ["docs-copy/research/study.md"]],
  ])("leaves %s %j unlisted", (_label, paths) => {
    expect(classifyChanges(paths.map(added))).toEqual({
      unclassified: [...paths].sort(),
    });
  });

  it("keeps every current regular agent definition and future names on baseline evidence", () => {
    const paths = [
      ...currentRegularAgentDefinitions,
      ".agents/skills/future-skill/SKILL.md",
      ".agents/templates/future-template.md",
      ".claude/agents/future-agent.md",
      ".codex/agents/future-agent.toml",
    ];

    expect(classifyChanges(paths.map(added))).toMatchObject(routes.baseline);
  });

  it.each([
    ".githooks/pre-commit",
    ".githooks/pre-merge-commit",
    ".githooks/pre-push",
    "scripts/board.mjs",
  ])(
    "keeps the named executable workflow entry %s on baseline evidence",
    (path) => {
      expect(
        classifyChanges([
          { path, oldMode: "000000", newMode: "100755", status: "A" },
        ]),
      ).toMatchObject(routes.baseline);
    },
  );

  const fullRoute = [...requiredBaselineSteps, ...requiredExpensiveSteps];
  const fullRouteWithoutConcurrency = [
    ...requiredBaselineSteps,
    ...requiredLightDatabaseSteps,
    ...requiredBrowserSteps,
  ];
  it.each(
    [
      [
        ["src/booking-request/booking-request-policy.ts"],
        requiredBaselineSteps,
        "skipped",
        "skipped",
        "skipped",
      ],
      [
        ["supabase/tests/database/booking_quotes.test.sql"],
        [...requiredBaselineSteps, ...requiredLightDatabaseSteps],
        "selected",
        "skipped",
        "skipped",
      ],
      [
        ["supabase/schemas/20_functions_booking.sql"],
        [...requiredBaselineSteps, ...requiredDatabaseSteps],
        "selected",
        "skipped",
        "selected",
      ],
      [
        ["src/components/booking-quote.tsx"],
        [...requiredBaselineSteps, ...requiredBrowserSteps],
        "skipped",
        "selected",
        "skipped",
      ],
      [
        [
          "src/components/booking-quote.tsx",
          "supabase/tests/database/booking_quotes.test.sql",
        ],
        [
          ...requiredBaselineSteps,
          ...requiredLightDatabaseSteps,
          ...requiredBrowserSteps,
        ],
        "selected",
        "selected",
        "skipped",
      ],
      [["supabase/config.toml"], fullRoute, "selected", "selected", "selected"],
      [
        ["custom-worker.ts"],
        fullRouteWithoutConcurrency,
        "selected",
        "selected",
        "skipped",
      ],
    ].map(([paths, ...rest]) => [paths.join(" and "), paths, ...rest]),
  )(
    "selects the route for %s",
    async (_label, paths, steps, database, browser, concurrency) => {
      const repository = createRepository();
      for (const path of paths) commit(repository, path, "fixture\n");

      const result = await runVerification(repository);

      expect(result.status).toBe(0);
      expect(result.calls.map(([command, args]) => [command, args])).toEqual(
        steps,
      );
      expect(result.stdout).toHaveBeenCalledWith(
        expect.stringContaining(`Database verification: ${database}`),
      );
      expect(result.stdout).toHaveBeenCalledWith(
        expect.stringContaining(`Browser verification: ${browser}`),
      );
      expect(result.stdout).toHaveBeenCalledWith(
        expect.stringContaining(
          `Booking and payment concurrency programs: ${concurrency}`,
        ),
      );
    },
  );

  it("stops without running anything when a changed path is unclassified", async () => {
    const repository = createRepository();
    commit(repository, "unknown-policy.fixture", "unclassified\n");

    const result = await runVerification(repository);

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

  it("names only the unclassified path when a classified path also changed", async () => {
    const repository = createRepository();
    commit(repository, "unknown-policy.fixture", "unclassified\n");
    commit(repository, "custom-worker.ts", "export const value = 'changed';\n");

    const result = await runVerification(repository);

    expect(result.status).toBe(3);
    expect(result.run).not.toHaveBeenCalled();
    const report = result.stderr.mock.calls.map(([line]) => line).join("\n");
    expect(report).toContain("unknown-policy.fixture");
    expect(report).not.toContain("custom-worker.ts");
    expect(report).toMatch(/1 changed path is not listed/);
  });

  it("counts every unclassified path in one report", async () => {
    const repository = createRepository();
    commit(repository, "unknown-policy.fixture", "unclassified\n");
    commit(repository, "unknown-runtime.fixture", "runtime\n");

    const result = await runVerification(repository);

    expect(result.status).toBe(3);
    const report = result.stderr.mock.calls.map(([line]) => line).join("\n");
    expect(report).toMatch(/2 changed paths are not listed/);
    expect(report).toContain("unknown-policy.fixture\nunknown-runtime.fixture");
  });

  it.each(["--database", "--browser", "--plan"])(
    "stops %s on an unclassified path because each one still selects a route",
    async (mode) => {
      const repository = createRepository();
      commit(repository, "unknown-policy.fixture", "unclassified\n");

      const result = await runVerification(repository, { args: [mode] });

      expect(result.status).toBe(3);
      expect(result.run).not.toHaveBeenCalled();
      expect(result.stderr).toHaveBeenCalledWith(
        expect.stringContaining("unknown-policy.fixture"),
      );
    },
  );

  it.each(["--full", "--baseline"])(
    "lets %s confirm the route while an unclassified path is present",
    async (mode) => {
      const repository = createRepository();
      commit(repository, "unknown-policy.fixture", "unclassified\n");

      const result = await runVerification(repository, { args: [mode] });

      expect(result.status).toBe(0);
      expect(result.calls.map(([command, args]) => [command, args])).toEqual(
        mode === "--baseline"
          ? requiredBaselineSteps
          : [...requiredBaselineSteps, ...requiredExpensiveSteps],
      );
      expect(result.stderr).not.toHaveBeenCalled();
    },
  );

  it("lets --full bypass documentation selection", async () => {
    const repository = createRepository();
    commit(repository, "AGENTS.md", "updated instructions\n");

    const result = await runVerification(repository, { args: ["--full"] });

    expect(result.status).toBe(0);
    expect(result.calls.map(([command, args]) => [command, args])).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
    expect(result.stdout).toHaveBeenCalledWith(
      expect.stringContaining("explicit --full"),
    );
  });

  it("keeps an earlier runtime commit visible after a documentation commit", async () => {
    const repository = createRepository();
    commit(repository, "tsconfig.json", "{ changed }\n");
    commit(repository, "AGENTS.md", "updated instructions\n");

    const result = await runVerification(repository);

    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );
  });

  it("unions dirty, staged-cancelled, and untracked paths", async () => {
    const cases = [
      (repository) => write(repository, "tsconfig.json", "{ dirty }\n"),
      (repository) => {
        write(repository, "tsconfig.json", "{ staged }\n");
        git(repository, ["add", "tsconfig.json"]);
        write(repository, "tsconfig.json", "{}\n");
      },
      (repository) =>
        write(repository, "scripts/verify-preview.mjs", "export {};\n"),
    ];

    for (const arrange of cases) {
      const repository = createRepository();
      arrange(repository);
      const result = await runVerification(repository);
      expect(result.status).toBe(0);
      expect(result.calls).toHaveLength(
        requiredBaselineSteps.length + requiredExpensiveSteps.length,
      );
    }
  });

  it("uses both endpoints of deletions and renames", async () => {
    const deletedRepository = createRepository();
    git(deletedRepository, ["rm", "tsconfig.json"]);
    git(deletedRepository, ["commit", "-m", "delete runtime"]);
    expect((await runVerification(deletedRepository)).calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );

    const renamedRepository = createRepository();
    mkdirSync(join(renamedRepository, "scripts"));
    git(renamedRepository, ["mv", "AGENTS.md", "scripts/verify-preview.mjs"]);
    git(renamedRepository, ["commit", "-m", "rename manual"]);
    expect((await runVerification(renamedRepository)).calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );
  });

  it("rejects symlink and tracked file-type exemptions", async () => {
    const untrackedRepository = createRepository();
    mkdirSync(join(untrackedRepository, "docs/agents"), { recursive: true });
    symlinkSync(
      "../../custom-worker.ts",
      join(untrackedRepository, "docs/agents/domain.md"),
    );
    expect((await runVerification(untrackedRepository)).calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );

    const changedRepository = createRepository();
    rmSync(join(changedRepository, "AGENTS.md"));
    symlinkSync("custom-worker.ts", join(changedRepository, "AGENTS.md"));
    git(changedRepository, ["add", "AGENTS.md"]);
    expect((await runVerification(changedRepository)).calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );
  });

  it.each(["committed", "staged", "unstaged", "untracked"])(
    "rejects %s executable agent prose",
    async (state) => {
      const repository = createRepository();
      const path = ".agents/templates/future-template.md";
      write(repository, path, "# Future template\n");
      if (state !== "untracked") {
        git(repository, ["add", path]);
        git(repository, ["commit", "-m", "non-executable template"]);
      }
      chmodSync(join(repository, path), 0o755);
      if (state === "committed" || state === "staged") {
        git(repository, ["add", path]);
      }
      if (state === "committed") {
        git(repository, ["commit", "-m", "executable template"]);
      }

      const result = await runVerification(repository);

      expect(result.calls.map(([command, args]) => [command, args])).toEqual([
        ...requiredBaselineSteps,
        ...requiredExpensiveSteps,
      ]);
      expect(result.stdout).toHaveBeenCalledWith(
        expect.stringMatching(/executable/i),
      );
    },
  );

  it("keeps mixed prose and runtime changes on full evidence", async () => {
    const repository = createRepository();
    commit(repository, "docs/research/study.md", "# Study\n");
    commit(repository, "tsconfig.json", "{ changed }\n");

    expect((await runVerification(repository)).calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );
  });

  it("selects full verification when Git evidence is missing or shallow", async () => {
    const missingRepository = createRepository();
    git(missingRepository, ["update-ref", "-d", "refs/remotes/origin/main"]);
    const missing = await runVerification(missingRepository);
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
    const shallow = await runVerification(shallowRepository);
    expect(shallow.calls).toHaveLength(
      requiredBaselineSteps.length + requiredExpensiveSteps.length,
    );
    expect(shallow.stderr).toHaveBeenCalledWith(
      expect.stringContaining("shallow"),
    );
  });

  it.each([undefined, "--database", "--browser"])(
    "uses source and checked-out merge histories in CI: %s",
    async (mode) => {
      const repository = createRepository();
      const originalBase = git(repository, ["rev-parse", "HEAD"]);

      git(repository, ["switch", "-c", "source", originalBase]);
      commit(
        repository,
        "custom-worker.ts",
        "export const value = 'source';\n",
      );
      const source = commit(repository, "AGENTS.md", "source instructions\n");

      git(repository, ["switch", "main"]);
      commit(repository, "custom-worker.ts", "export const value = 'base';\n");
      const base = git(repository, ["rev-parse", "HEAD"]);
      const merge = spawnSync("git", ["merge", "--no-ff", "source"], {
        cwd: repository,
        encoding: "utf8",
      });
      expect(merge.status).not.toBe(0);
      write(repository, "custom-worker.ts", "export const value = 'base';\n");
      git(repository, ["add", "."]);
      git(repository, ["commit", "-m", "merge source"]);

      const result = await runVerification(repository, {
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

  it("preserves hosted partitions, source selection and local isolation", async () => {
    const rows = [
      ...[
        "database-core",
        "booking-request",
        "booking-capture",
        "payment-required-expiry",
      ].map((partition) => ({ mode: "--database", partition })),
      ...["next", "worker"].flatMap((partition) =>
        ["1/2", "2/2"].map((shard) => ({
          mode: "--browser",
          partition,
          shard,
        })),
      ),
      { mode: "--browser", partition: "scheduled" },
      { mode: "--browser", partition: "shell-smoke" },
    ];
    const code = createRepository();
    const codeBase = git(code, ["rev-parse", "HEAD"]);
    const codeSource = commit(
      code,
      "src/booking-request/policy.ts",
      "export const value = true;\n",
    );
    git(code, ["switch", "main"]);
    git(code, ["merge", "--no-ff", codeSource]);
    const docs = createRepository();
    const docsBase = git(docs, ["rev-parse", "HEAD"]);
    const docsSource = commit(docs, "AGENTS.md", "source instructions\n");
    git(docs, ["switch", "main"]);
    git(docs, ["merge", "--no-ff", docsSource]);
    const chromium = ["npx", ["playwright", "install", "chromium"]];
    for (const { mode, partition, shard } of rows) {
      const controls = {
        GITHUB_ACTIONS: "true",
        VERIFY_CI_PARTITION: partition,
        VERIFY_CI_SHARD: shard ?? "",
      };
      const expected =
        mode === "--database"
          ? requiredDatabaseSteps
          : [
              chromium,
              ...(partition === "shell-smoke"
                ? requiredShellSmokeSteps
                : [requiredBrowserSteps[0]]),
            ];
      for (const [repository, base, source, selected] of [
        [code, codeBase, codeSource, true],
        [docs, docsBase, docsSource, false],
        [code, codeBase, "0".repeat(40), true],
      ]) {
        const result = await runVerification(repository, {
          args: [mode],
          environment: {
            ...controls,
            VERIFY_BASE_SHA: base,
            VERIFY_SOURCE_SHA: source,
          },
        });
        expect(result.status).toBe(0);
        expect(result.calls.map(([command, args]) => [command, args])).toEqual(
          selected ? expected : [],
        );
        expect(result.stdout).toHaveBeenCalledWith(
          JSON.stringify({
            type: "verification-partition",
            evidence: "partial",
            partition,
            shard: shard || null,
          }),
        );
        if (selected) {
          expect(
            result.calls.every(
              ([, , env]) =>
                env.VERIFY_CI_PARTITION === partition &&
                env.VERIFY_CI_SHARD === (shard ?? ""),
            ),
          ).toBe(true);
        }
      }
    }
    for (const { args, environment, reason } of [
      {
        args: ["--browser"],
        environment: { VERIFY_CI_PARTITION: "next", VERIFY_CI_SHARD: "1/2" },
        reason: "GITHUB_ACTIONS=true",
      },
      {
        args: ["--browser"],
        environment: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "next",
          VERIFY_CI_SHARD: "0/2",
        },
        reason: "VERIFY_CI_SHARD",
      },
      {
        args: ["--browser"],
        environment: { GITHUB_ACTIONS: "true", VERIFY_CI_PARTITION: "next" },
        reason: "VERIFY_CI_SHARD",
      },
      {
        args: ["--browser"],
        environment: { GITHUB_ACTIONS: "true", VERIFY_CI_PARTITION: "unknown" },
        reason: "VERIFY_CI_PARTITION",
      },
      {
        args: ["--browser"],
        environment: { GITHUB_ACTIONS: "true", VERIFY_CI_SHARD: "1/2" },
        reason: "VERIFY_CI_PARTITION",
      },
      {
        args: ["--browser"],
        environment: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "scheduled",
          VERIFY_CI_SHARD: "1/2",
        },
        reason: "VERIFY_CI_SHARD",
      },
      {
        args: ["--database"],
        environment: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "next",
          VERIFY_CI_SHARD: "1/2",
        },
        reason: "VERIFY_CI_PARTITION",
      },
      {
        args: [],
        environment: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "next",
          VERIFY_CI_SHARD: "1/2",
        },
        reason: "VERIFY_CI_PARTITION",
      },
      {
        args: ["--baseline"],
        environment: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "next",
          VERIFY_CI_SHARD: "1/2",
        },
        reason: "VERIFY_CI_PARTITION",
      },
      {
        args: ["--browser", "--full"],
        environment: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "next",
          VERIFY_CI_SHARD: "1/2",
        },
        reason: "--full",
      },
    ]) {
      const result = await runVerification("/missing-git-evidence", {
        args,
        environment,
      });
      expect(result.status).toBe(2);
      expect(result.run).not.toHaveBeenCalled();
      expect(result.stdout).not.toHaveBeenCalled();
      expect(result.stderr).toHaveBeenCalledWith(
        expect.stringContaining(reason),
      );
    }
    const local = await runVerification(docs, { args: ["--browser"] });
    expect(local.status).toBe(0);
    expect(local.calls).toEqual([]);
  }, 30_000);

  it.each([undefined, "--database", "--browser"])(
    "keeps the CI quick path for a docs-only merge: %s",
    async (mode) => {
      const repository = createRepository();
      const base = git(repository, ["rev-parse", "HEAD"]);
      const source = commit(repository, "AGENTS.md", "source instructions\n");
      git(repository, ["switch", "main"]);
      git(repository, ["merge", "--no-ff", source]);

      const result = await runVerification(repository, {
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

  it.each(
    [
      "src/booking-request/booking-request-policy.ts",
      "src/booking-request/booking-request-policy.test.ts",
    ].flatMap((path) =>
      [undefined, "--database", "--browser"].map((mode) => [path, mode]),
    ),
  )(
    "runs every check in CI for a product change: %s %s",
    async (path, mode) => {
      const repository = createRepository();
      const base = git(repository, ["rev-parse", "HEAD"]);
      const source = commit(repository, path, "export const value = true;\n");
      git(repository, ["switch", "main"]);
      git(repository, ["merge", "--no-ff", source]);

      const result = await runVerification(repository, {
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
        expect.stringContaining("continuous integration runs every check"),
      );
    },
  );

  it.each([
    ["modification", undefined],
    ["addition", "--database"],
    ["deletion", "--browser"],
  ])(
    "ignores an advanced-base-only runtime %s in CI: %s",
    async (baseChange, mode) => {
      const repository = createRepository();
      const originalBase = git(repository, ["rev-parse", "HEAD"]);

      git(repository, ["switch", "-c", "source", originalBase]);
      const source = commit(repository, "AGENTS.md", "source instructions\n");
      git(repository, ["switch", "main"]);
      if (baseChange === "addition") {
        commit(repository, "src/base-only.ts", "export const base = true;\n");
      } else if (baseChange === "deletion") {
        git(repository, ["rm", "custom-worker.ts"]);
        git(repository, ["commit", "-m", "delete runtime on base"]);
      } else {
        commit(
          repository,
          "custom-worker.ts",
          "export const value = 'base';\n",
        );
      }
      const base = git(repository, ["rev-parse", "HEAD"]);
      git(repository, ["merge", "--no-ff", "source"]);

      const result = await runVerification(repository, {
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
    async (mode) => {
      const repository = createRepository();
      const base = git(repository, ["rev-parse", "HEAD"]);
      const source = commit(repository, "AGENTS.md", "source instructions\n");
      git(repository, ["switch", "main"]);
      git(repository, ["merge", "--no-ff", "--no-commit", source]);
      write(repository, "custom-worker.ts", "export const value = 'merge';\n");
      git(repository, ["add", "."]);
      git(repository, ["commit", "-m", "merge source"]);

      const result = await runVerification(repository, {
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
        expect.stringContaining("continuous integration runs every check"),
      );
    },
  );

  it("prints full and group-scoped plans from execution vectors without running them", async () => {
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
      const result = await runVerification("/missing-git-evidence", {
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

  it("prints the same narrow commands that execution consumes", async () => {
    const repository = createRepository();
    commit(repository, "docs/research/study.md", "# Study\n");
    const executed = await runVerification(repository);
    const planned = await runVerification(repository, { args: ["--plan"] });
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

  it("plans CI browser preparation without invoking the Chromium installer", async () => {
    const result = await runVerification("/missing-git-evidence", {
      args: ["--browser", "--full", "--plan"],
      environment: { GITHUB_ACTIONS: "true" },
    });

    expect(result.run).not.toHaveBeenCalled();
    expect(result.stdout).toHaveBeenCalledWith(
      'Planned command: ["npx","playwright","install","chromium"]',
    );
  });

  it.each(["local", "CI"])(
    "fails closed when %s history has multiple merge bases",
    async (context) => {
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

      const result = await runVerification(repository, options);

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
    async (mode) => {
      const repository = createRepository();
      commit(repository, "AGENTS.md", "updated instructions\n");
      const result = await runVerification(repository, {
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

  it("takes a place for a local run with database or browser steps and hands it to every step", async () => {
    const repository = createRepository();
    for (const [args, expected] of [
      [["--full"], [...requiredBaselineSteps, ...requiredExpensiveSteps]],
      [["--database", "--full"], requiredDatabaseSteps],
      [["--browser", "--full"], requiredBrowserSteps],
    ]) {
      const claimRunSlot = vi.fn(async () => 2);
      const result = await runVerification(repository, { args, claimRunSlot });

      expect(result.status).toBe(0);
      expect(claimRunSlot).toHaveBeenCalledTimes(1);
      expect(
        result.calls.map(([command, commandArgs]) => [command, commandArgs]),
      ).toEqual(expected);
      for (const [, , environment] of result.calls) {
        expect(environment).toMatchObject({
          VERIFY_LOCAL_SLOT: "2",
          PLAYWRIGHT_NEXT_PORT: "3020",
          PLAYWRIGHT_WORKER_PORT: "8808",
        });
      }
    }
  });

  it("stops with the limit message and runs nothing when no place is free", async () => {
    const claimRunSlot = vi.fn(async () => undefined);
    const result = await runVerification(createRepository(), {
      args: ["--full"],
      claimRunSlot,
    });

    expect(result.status).toBe(4);
    expect(claimRunSlot).toHaveBeenCalledTimes(1);
    expect(result.calls).toEqual([]);
    expect(result.stderr.mock.calls).toEqual([
      [
        "The full local check runs at most 2 at a time on this machine, and all 2 places are in use. Nothing ran. Run it again when one of them has finished.",
      ],
    ]);
  });

  it("takes no place for baseline-only, plan-only or hosted runs", async () => {
    const repository = createRepository();
    for (const [options, stepCount] of [
      [{ args: ["--baseline"] }, requiredBaselineSteps.length],
      [{ args: ["--full", "--plan"] }, 0],
      [
        {
          args: ["--full"],
          environment: {
            GITHUB_ACTIONS: "true",
            RUNNER_ENVIRONMENT: "github-hosted",
          },
        },
        requiredCiSteps(undefined).length,
      ],
    ]) {
      const claimRunSlot = vi.fn(async () => 2);
      const result = await runVerification(repository, {
        ...options,
        claimRunSlot,
      });

      expect(result.status).toBe(0);
      expect(claimRunSlot).not.toHaveBeenCalled();
      expect(result.calls).toHaveLength(stepCount);
      for (const [, , environment] of result.calls) {
        expect(environment).not.toHaveProperty("VERIFY_LOCAL_SLOT");
        expect(environment).not.toHaveProperty("PLAYWRIGHT_NEXT_PORT");
        expect(environment).not.toHaveProperty("PLAYWRIGHT_WORKER_PORT");
      }
    }
  });
});
