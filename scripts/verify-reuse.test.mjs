import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
