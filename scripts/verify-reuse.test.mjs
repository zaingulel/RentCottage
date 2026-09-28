import fs from "node:fs";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
  requiredBaselineSteps,
  requiredExpensiveSteps,
  requiredDatabaseSteps,
  requiredBrowserSteps,
  requiredCiSteps,
  git,
  write,
  createRepository,
  commit,
  runVerification,
  runtimeFixture,
  localVerification,
  productionFixture,
  evidenceFile,
  commands,
  repositories,
} from "./verify-test-fixtures.mjs";

describe("repository verification command", () => {
  it("reports group states without duplicates or invented execution", () => {
    const reports = (result) =>
      result.stdout.mock.calls
        .flat()
        .filter((line) =>
          /^(?:Baseline|Database|Browser|Expensive) verification:|^(?:database|browser):/.test(
            line,
          ),
        );
    const records = (mock, type) =>
      mock.mock.calls
        .flat()
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line))
        .filter((record) => record.type === type);
    const baselineRepository = createRepository();
    const baseline = localVerification(baselineRepository, {
      args: ["--baseline"],
    });
    expect(baseline.status).toBe(0);
    expect(commands(baseline)).toEqual(requiredBaselineSteps);
    expect(reports(baseline)).toEqual([
      "Baseline verification: selected",
      "Database verification: skipped (baseline mode)",
      "Browser verification: skipped (baseline mode)",
      "Expensive verification: skipped (baseline mode)",
    ]);

    const scenarios = [
      {
        args: ["--full"],
        steps: [...requiredBaselineSteps, ...requiredExpensiveSteps],
        selection: [
          "Baseline verification: selected",
          "Database verification: selected (explicit --full)",
          "Browser verification: selected (explicit --full)",
          "Expensive verification: selected (explicit --full)",
        ],
        fresh: [
          "database: fresh local verification required (explicit --full)",
          "browser: fresh local verification required (explicit --full)",
        ],
        executed: [
          "database: executed fresh verification",
          "browser: executed fresh verification",
        ],
        couldNotStart: [
          "database: fresh verification could not start",
          "browser: fresh verification could not start",
        ],
        access: ["npm", ["run", "verify:access"]],
        reproduction: {
          reproduceSelectedGroups: ["npm", "run", "verify", "--", "--full"],
        },
        completed: ["database", "browser"],
      },
      {
        args: ["--database", "--full"],
        steps: requiredDatabaseSteps,
        selection: [
          "Baseline verification: unselected",
          "Database verification: selected (explicit --full)",
          "Browser verification: skipped (explicit --full)",
          "Expensive verification: selected (explicit --full)",
        ],
        fresh: [
          "database: fresh local verification required (explicit --full)",
        ],
        executed: ["database: executed fresh verification"],
        couldNotStart: ["database: fresh verification could not start"],
        access: ["npm", ["run", "verify:access:database"]],
        reproduction: {
          reproduceGroup: [
            "npm",
            "run",
            "verify",
            "--",
            "--database",
            "--full",
          ],
        },
        completed: ["database"],
      },
      {
        args: ["--browser", "--full"],
        steps: requiredBrowserSteps,
        selection: [
          "Baseline verification: unselected",
          "Database verification: skipped (explicit --full)",
          "Browser verification: selected (explicit --full)",
          "Expensive verification: selected (explicit --full)",
        ],
        fresh: ["browser: fresh local verification required (explicit --full)"],
        executed: ["browser: executed fresh verification"],
        couldNotStart: ["browser: fresh verification could not start"],
        access: ["npm", ["run", "verify:access:browser"]],
        reproduction: {
          reproduceGroup: ["npm", "run", "verify", "--", "--browser", "--full"],
        },
        completed: ["browser"],
      },
    ];
    const failures = [
      {
        result: {
          status: null,
          error: Object.assign(new Error("fixture cannot start"), {
            code: "ENOENT",
          }),
        },
        status: 1,
        outcome: { type: "spawn-failure", code: "ENOENT" },
        started: false,
      },
      {
        result: { status: 7 },
        status: 7,
        outcome: { type: "exit", status: 7 },
        started: true,
      },
      {
        result: { status: null, signal: "SIGTERM" },
        status: 1,
        outcome: { type: "signal", signal: "SIGTERM" },
        started: true,
      },
    ];
    for (const scenario of scenarios) {
      const repository = createRepository();
      const successful = localVerification(repository, { args: scenario.args });
      expect(successful.status).toBe(0);
      expect(commands(successful)).toEqual(scenario.steps);
      expect(reports(successful)).toEqual([
        ...scenario.selection,
        ...scenario.fresh,
        ...scenario.executed,
      ]);
      for (const group of ["database", "browser"])
        expect(existsSync(evidenceFile(repository, "success", group))).toBe(
          scenario.completed.includes(group),
        );
      for (const failure of failures) {
        const failedRepository = createRepository();
        const failedIndex = scenario.steps.findIndex(
          ([command, args]) =>
            command === scenario.access[0] && args[1] === scenario.access[1][1],
        );
        const run = vi.fn(() =>
          run.mock.calls.length === failedIndex + 1
            ? failure.result
            : { status: 0 },
        );
        const failed = localVerification(failedRepository, {
          args: scenario.args,
          run,
        });
        expect(failed.status).toBe(failure.status);
        expect(commands(failed)).toEqual(
          scenario.steps.slice(0, failedIndex + 1),
        );
        expect(reports(failed)).toEqual([
          ...scenario.selection,
          ...scenario.fresh,
          ...(failure.started ? scenario.executed : scenario.couldNotStart),
        ]);
        const phases = records(failed.stdout, "verification-phase");
        expect(phases.map((phase) => phase.command)).toEqual(
          scenario.steps
            .slice(0, failedIndex + 1)
            .map(([command, args]) => [command, ...args]),
        );
        expect(phases.slice(0, -1).map((phase) => phase.outcome)).toEqual(
          Array.from({ length: failedIndex }, () => ({
            type: "exit",
            status: 0,
          })),
        );
        expect(phases.at(-1).outcome).toEqual(failure.outcome);
        expect(records(failed.stderr, "verification-failure")).toEqual([
          {
            type: "verification-failure",
            attemptedCommand: [scenario.access[0], ...scenario.access[1]],
            ...scenario.reproduction,
          },
        ]);
        for (const group of ["database", "browser"])
          expect(
            existsSync(evidenceFile(failedRepository, "success", group)),
          ).toBe(false);
      }
    }

    const reuseRepository = createRepository();
    commit(reuseRepository, "custom-worker.ts", "seed\n");
    const head = git(reuseRepository, ["rev-parse", "HEAD"]);
    const base = git(reuseRepository, ["merge-base", "origin/main", "HEAD"]);
    const cold = localVerification(reuseRepository);
    expect(cold.status).toBe(0);
    expect(commands(cold)).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
    expect(reports(cold)).toEqual([
      "Baseline verification: selected",
      "Database verification: selected (custom-worker.ts requires full evidence)",
      "Browser verification: selected (custom-worker.ts requires full evidence)",
      "Expensive verification: selected (custom-worker.ts requires full evidence)",
      "database: fresh local verification required (local evidence missing, stale or unavailable)",
      "browser: fresh local verification required (local evidence missing, stale or unavailable)",
      "database: executed fresh verification",
      "browser: executed fresh verification",
    ]);
    commit(reuseRepository, "AGENTS.md", "repaired instructions\n");
    const reused = localVerification(reuseRepository);
    expect(reused.status).toBe(0);
    expect(commands(reused)).toEqual(requiredBaselineSteps);
    expect(reports(reused)).toEqual([
      "Baseline verification: selected",
      "Database verification: selected (custom-worker.ts requires full evidence)",
      "Browser verification: selected (custom-worker.ts requires full evidence)",
      "Expensive verification: selected (custom-worker.ts requires full evidence)",
      `database: reused local evidence from HEAD ${head}; base ${base}`,
      `browser: reused local evidence from HEAD ${head}; base ${base}`,
    ]);

    const laterRepository = createRepository();
    const laterRun = vi.fn((_command, args) => ({
      status: args[1] === "test:browser" ? 9 : 0,
    }));
    const later = localVerification(laterRepository, {
      args: ["--full"],
      run: laterRun,
    });
    expect(later.status).toBe(9);
    expect(commands(later)).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps.slice(0, 4),
    ]);
    expect(reports(later)).toEqual([
      ...scenarios[0].selection,
      ...scenarios[0].fresh,
      ...scenarios[0].executed,
    ]);
    expect(records(later.stdout, "verification-phase").at(-1)).toMatchObject({
      command: ["npm", "run", "test:browser"],
      outcome: { type: "exit", status: 9 },
    });
    expect(records(later.stderr, "verification-failure")).toEqual([
      {
        type: "verification-failure",
        attemptedCommand: ["npm", "run", "test:browser"],
        reproduceGroup: ["npm", "run", "verify", "--", "--browser", "--full"],
      },
    ]);
    expect(
      existsSync(evidenceFile(laterRepository, "success", "database")),
    ).toBe(true);
    expect(
      existsSync(evidenceFile(laterRepository, "success", "browser")),
    ).toBe(false);

    const blockedRepository = createRepository();
    const originalRename = fs.renameSync;
    const denied = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (to.endsWith("browser.attempt.json"))
        throw Object.assign(new Error("fixture denied browser marker"), {
          code: "EACCES",
        });
      return originalRename(from, to);
    });
    try {
      const blocked = localVerification(blockedRepository, {
        args: ["--full"],
      });
      expect(blocked.status).toBe(1);
      expect(commands(blocked)).toEqual(requiredBaselineSteps);
      expect(reports(blocked)).toEqual([
        ...scenarios[0].selection,
        scenarios[0].fresh[0],
      ]);
      expect(
        records(blocked.stdout, "verification-phase").map(
          (phase) => phase.command,
        ),
      ).toEqual(
        requiredBaselineSteps.map(([command, args]) => [command, ...args]),
      );
      expect(records(blocked.stderr, "verification-failure")).toEqual([]);
      expect(records(blocked.stderr, "verification-admission-failure")).toEqual(
        [
          {
            type: "verification-admission-failure",
            group: "browser",
            step: "atomic replacement",
          },
        ],
      );
      for (const group of ["database", "browser"])
        expect(
          existsSync(evidenceFile(blockedRepository, "success", group)),
        ).toBe(false);
    } finally {
      denied.mockRestore();
    }
  }, 60000);

  it("only promises reuse checks for eligible local service plans", () => {
    const cases = [
      {
        args: [],
        environment: {},
        steps: [...requiredBaselineSteps, ...requiredExpensiveSteps],
        promise: true,
      },
      {
        args: ["--database"],
        environment: {},
        steps: requiredDatabaseSteps,
        promise: true,
      },
      {
        args: ["--browser"],
        environment: {},
        steps: requiredBrowserSteps,
        promise: true,
      },
      {
        args: [],
        environment: { CI: "", GITHUB_ACTIONS: "" },
        steps: [...requiredBaselineSteps, ...requiredExpensiveSteps],
        promise: true,
      },
      {
        args: ["--baseline"],
        environment: {},
        steps: requiredBaselineSteps,
        promise: false,
      },
      {
        args: ["--full"],
        environment: {},
        steps: [...requiredBaselineSteps, ...requiredExpensiveSteps],
        promise: false,
      },
      {
        args: ["--database", "--full"],
        environment: {},
        steps: requiredDatabaseSteps,
        promise: false,
      },
      {
        args: ["--browser", "--full"],
        environment: {},
        steps: requiredBrowserSteps,
        promise: false,
      },
      {
        args: ["--baseline", "--full"],
        environment: {},
        steps: requiredBaselineSteps,
        promise: false,
      },
      ...[
        { CI: "true" },
        { CI: "false" },
        { GITHUB_ACTIONS: "true" },
        { GITHUB_ACTIONS: "false" },
      ].flatMap((environment) => [
        {
          args: [],
          environment,
          steps:
            environment.GITHUB_ACTIONS === "true"
              ? requiredCiSteps()
              : [...requiredBaselineSteps, ...requiredExpensiveSteps],
          promise: false,
        },
        {
          args: ["--database"],
          environment,
          steps: requiredDatabaseSteps,
          promise: false,
        },
        {
          args: ["--browser"],
          environment,
          steps:
            environment.GITHUB_ACTIONS === "true"
              ? requiredCiSteps("--browser")
              : requiredBrowserSteps,
          promise: false,
        },
      ]),
    ];
    const markerState = (repository) => {
      const directory = dirname(evidenceFile(repository, "attempt"));
      return existsSync(directory)
        ? fs
            .readdirSync(directory)
            .sort()
            .map((name) => [name, readFileSync(join(directory, name), "utf8")])
        : null;
    };
    const assertPlan = (repository, scenario) => {
      const before = markerState(repository);
      const captureRuntimeContract = vi.fn(runtimeFixture);
      const result = localVerification(repository, {
        args: [...scenario.args, "--plan"],
        environment: scenario.environment,
        captureRuntimeContract,
      });
      expect(result.status).toBe(0);
      expect(result.run).not.toHaveBeenCalled();
      expect(captureRuntimeContract).not.toHaveBeenCalled();
      const lines = result.stdout.mock.calls.flat();
      expect(
        lines.filter((line) => line.includes("reuse eligibility")),
      ).toEqual(
        scenario.promise
          ? ["Local reuse eligibility will be checked during execution."]
          : [],
      );
      expect(
        lines
          .filter((line) => line.startsWith("Planned command: "))
          .map((line) => JSON.parse(line.slice("Planned command: ".length))),
      ).toEqual(scenario.steps.map(([command, args]) => [command, ...args]));
      expect(
        lines.filter((line) => line === "Plan only: no verification ran."),
      ).toEqual(["Plan only: no verification ran."]);
      expect(markerState(repository)).toEqual(before);
    };
    for (const retained of [false, true]) {
      const repository = createRepository();
      commit(repository, "custom-worker.ts", "seed\n");
      if (retained) expect(localVerification(repository).status).toBe(0);
      expect(markerState(repository) !== null).toBe(retained);
      for (const scenario of cases) assertPlan(repository, scenario);
    }
    const unselected = createRepository();
    for (const args of [[], ["--database"], ["--browser"]])
      assertPlan(unselected, {
        args,
        environment: {},
        steps: args.length === 0 ? requiredBaselineSteps : [],
        promise: false,
      });
    expect(markerState(unselected)).toBe(null);
  }, 60000);

  it("reuses only unchanged local groups after classified repairs", () => {
    const repository = createRepository();
    commit(repository, "custom-worker.ts", "export const value = 'seed';\n");
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
    write(repository, "custom-worker.ts", "export const value = 'repaired';\n");
    expect(commands(localVerification(repository))).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
  }, 30000);

  it("ignores only bookkeeping environment changes through production capture", () => {
    const fixture = productionFixture({ browsers: true });
    const bookkeepingKeys = [
      "CLAUDE_CODE_AGENT",
      "CLAUDE_CODE_CHILD_SESSION",
      "CLAUDE_CODE_ENTRYPOINT",
      "CLAUDE_CODE_MESSAGING_SOCKET",
      "CLAUDE_CODE_MESSAGING_TOKEN",
      "CLAUDE_CODE_SESSION_ATTENDED",
      "CLAUDE_CODE_SESSION_ID",
      "CLAUDE_EFFORT",
      "CLAUDE_PID",
      "CODEX_APP_TOOLS_PIPE_PATH",
      "CODEX_SESSION_ID",
      "OLDPWD",
      "RUN_LOG_RERUN_REASON",
      "STARSHIP_SESSION_KEY",
      "_",
    ];
    const initialEnvironment = {
      ...fixture.environment,
      TZ: "Etc/UTC",
      VERIFY_FIXTURE_UNRECOGNIZED_INPUT: "private-unknown-before",
      SSH_AUTH_SOCK: "private-ssh-before",
      CODEX_THREAD_ID: "private-thread-before",
      CLAUDE_CODE_EXECPATH: "private-execpath-before",
      SHLVL: "private-shell-context-before",
      CODEX_SANDBOX_NETWORK_DISABLED: "private-network-mode-before",
      ...Object.fromEntries(
        bookkeepingKeys.map((key) => [key, `private-${key}-before`]),
      ),
    };
    const changedBookkeeping = {
      ...initialEnvironment,
      CODEX_THREAD_ID: "private-thread-after",
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
          if (value === "") continue;
          expect(output).not.toContain(value);
          expect(record).not.toContain(value);
        }
      }
    };
    const freshCommands = [...requiredBaselineSteps, ...requiredExpensiveSteps];
    execute(initialEnvironment, freshCommands, false);
    execute(changedBookkeeping, requiredBaselineSteps, true);
    const changedInput = { ...changedBookkeeping };
    for (const [key, value] of [
      ["TZ", "Pacific/Auckland"],
      ["VERIFY_FIXTURE_UNRECOGNIZED_INPUT", "private-unknown-after"],
      ["SSH_AUTH_SOCK", "private-ssh-after"],
      ["CLAUDE_CODE_EXECPATH", "private-execpath-after"],
      ["SHLVL", "private-shell-context-after"],
      ["CODEX_SANDBOX_NETWORK_DISABLED", "private-network-mode-after"],
    ]) {
      changedInput[key] = value;
      execute(changedInput, freshCommands, false);
    }
    execute(changedInput, requiredBaselineSteps, true);
    changedInput.CODEX_THREAD_ID = "";
    execute(changedInput, freshCommands, false);
    execute(changedInput, requiredBaselineSteps, true);
    delete changedInput.CODEX_THREAD_ID;
    execute(changedInput, freshCommands, false);
    execute(changedInput, requiredBaselineSteps, true);
    changedInput.CODEX_THREAD_ID = "private-thread-restored";
    execute(changedInput, freshCommands, false);
    execute(changedInput, requiredBaselineSteps, true);
  }, 120000);

  it("refuses stale source base and environment evidence", () => {
    const cases = [
      (repository) =>
        commit(repository, "custom-worker.ts", "committed repair\n"),
      (repository) => {
        write(repository, "custom-worker.ts", "staged repair\n");
        git(repository, ["add", "custom-worker.ts"]);
        write(repository, "custom-worker.ts", "seed\n");
      },
      (repository) =>
        write(repository, "custom-worker.ts", "unstaged repair\n"),
      (repository) =>
        write(repository, "open-next.config.ts", "untracked repair\n"),
      (repository) => rmSync(join(repository, "custom-worker.ts")),
      (repository) =>
        renameSync(
          join(repository, "custom-worker.ts"),
          join(repository, "next.config.ts"),
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
        symlinkSync("custom-worker.ts", join(repository, "AGENTS.md"));
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
      commit(repository, "custom-worker.ts", "seed\n");
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
    rmSync(join(linkedRepository, "custom-worker.ts"));
    symlinkSync(externalSource, join(linkedRepository, "custom-worker.ts"));
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
    commit(repository, "custom-worker.ts", "seed\n");
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

  it("keeps forced hosted and planned verification honest", () => {
    const repository = createRepository();
    commit(repository, "custom-worker.ts", "seed\n");
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
    expect(forced.status).toBe(0);
    expect(commands(forced)).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
    expect(readFileSync(marker, "utf8")).not.toBe(oldMarker);
    expect(commands(localVerification(repository))).toEqual(
      requiredBaselineSteps,
    );
    expect(
      commands(localVerification(repository, { args: ["--database"] })),
    ).toEqual([]);
    expect(
      commands(localVerification(repository, { args: ["--browser"] })),
    ).toEqual([]);
  }, 30000);
});
