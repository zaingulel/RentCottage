import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  localCredentials,
  mainWithPreparedProject,
  ownedRun,
  stopCommand,
  successfulRun,
} from "./verify-access-command-doubles.mjs";
import { observeInterruptedAccessVerification } from "./verify-access-interruption-observer.mjs";

describe("access verification command", () => {
  it("bounds a hung cleanup command and reports the retained owned service", async () => {
    await observeInterruptedAccessVerification(undefined, {
      hangCleanup: true,
    });
  }, 20_000);

  it.each([
    { cleanupCommandLimitMs: undefined, expectedLimitMs: 30_000 },
    { cleanupCommandLimitMs: 2_000, expectedLimitMs: 2_000 },
  ])(
    "uses a $expectedLimitMs ms limit only for cleanup inspection and stop",
    async ({ cleanupCommandLimitMs, expectedLimitMs }) => {
      const run = successfulRun({ workdir: "/tmp/access-state/project" });

      expect(
        await mainWithPreparedProject(["--fixture-contract"], {
          cleanupCommandLimitMs,
          environment: {},
          makeTemp: () => "/tmp/access-state",
          removeTemp: vi.fn(),
          run,
        }),
      ).toBe(0);

      const cleanupInspection = run.mock.calls.filter(
        ([command]) => command === "docker",
      )[1];
      const cleanupStop = run.mock.calls.find(
        ([command, args]) =>
          command === "npx" &&
          args.slice(0, 3).join(" ") === "supabase stop --no-backup",
      );
      expect(cleanupInspection[2]).toMatchObject({
        lifecycleLimit: expectedLimitMs,
      });
      expect(cleanupStop[2]).toMatchObject({
        lifecycleLimit: expectedLimitMs,
      });
      expect(run.mock.calls[1][0]).toBe("docker");
      expect(run.mock.calls[1][2].lifecycleLimit).toBeUndefined();
      expect(
        run.mock.calls
          .filter((call) => call !== cleanupInspection && call !== cleanupStop)
          .every(([, , options]) => options.lifecycleLimit === undefined),
      ).toBe(true);
    },
  );

  it("preserves a database failure when cleanup also fails", async () => {
    const run = ownedRun((command, args) => {
      const invocation = [command, ...args].join(" ");
      return {
        status:
          invocation === "node scripts/verify-booking-request-concurrency.mjs"
            ? 9
            : invocation.startsWith("npx supabase stop --no-backup ")
              ? 6
              : 0,
        stdout: invocation.startsWith("npx supabase status -o json ")
          ? localCredentials
          : "",
      };
    });
    const removeTemp = vi.fn();

    expect(
      await mainWithPreparedProject(["--database"], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
      }),
    ).toBe(9);
    expect(run.mock.calls.at(-1).slice(0, 2)).toEqual(stopCommand);
    expect(
      run.mock.calls.filter(
        ([command, args]) =>
          command === "npx" &&
          args.slice(0, 3).join(" ") === "supabase stop --no-backup",
      ),
    ).toHaveLength(1);
    expect(
      run.mock.calls.some(
        ([, args]) =>
          args[0] === "playwright" && args.includes("--project=mobile"),
      ),
    ).toBe(false);
    expect(removeTemp).not.toHaveBeenCalled();
  });

  it.each([
    { stage: "cleanup inspection", signal: "SIGTERM", status: 143 },
    { stage: "cleanup stop", signal: "SIGINT", status: 130 },
  ])(
    "finishes exact cleanup when $signal arrives during $stage",
    async ({ signal, stage, status }) => {
      let inspections = 0;
      let stops = 0;
      const run = vi.fn((command, args, options) => {
        if (command === "docker" && args[0] === "inspect") {
          inspections += 1;
          if (stage === "cleanup inspection" && inspections === 2) {
            process.emit(signal);
          }
          return {
            status: 0,
            stdout: `rentcottage-verification|${options.env.SUPABASE_LOCAL_WORKDIR}\n`,
            stderr: "",
          };
        }
        if (
          command === "npx" &&
          args.slice(0, 3).join(" ") === "supabase stop --no-backup"
        ) {
          stops += 1;
          if (stage === "cleanup stop") process.emit(signal);
        }
        return {
          status: 0,
          stdout:
            command === "npx" &&
            args.slice(0, 4).join(" ") === "supabase status -o json"
              ? localCredentials
              : "",
        };
      });
      const removeTemp = vi.fn();

      expect(
        await mainWithPreparedProject(["--fixture-contract"], {
          environment: {},
          makeTemp: () => "/tmp/access-docker",
          removeTemp,
          run,
          stderr: vi.fn(),
        }),
      ).toBe(status);
      expect(inspections).toBe(2);
      expect(stops).toBe(1);
      expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
    },
  );

  it("fails when the local services cannot be stopped cleanly", async () => {
    const run = ownedRun((command, args) => ({
      status:
        command === "npx" &&
        args.slice(0, 3).join(" ") === "supabase stop --no-backup"
          ? 6
          : 0,
      stdout:
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));
    const stderr = vi.fn();
    const removeTemp = vi.fn();

    expect(
      await mainWithPreparedProject([], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
        stderr,
      }),
    ).toBe(6);
    expect(stderr).toHaveBeenCalledWith("Local Supabase cleanup failed.");
    expect(removeTemp).not.toHaveBeenCalled();
  });

  it("finishes access timing after cleanup and preserves failed or retained teardown", async () => {
    for (const scenario of [
      "passed",
      "cleanup-failure",
      "primary-and-cleanup-failure",
      "ownership-change",
      "ownership-spawn-failure",
      "startup-interrupted",
      "child-interrupted",
      "spawn-failure",
      "preparation-failure",
    ]) {
      let tick = 100;
      let inspections = 0;
      const lines = [];
      const removeTemp = vi.fn(() => {
        tick += 3;
      });
      const baseRun = successfulRun();
      const run = vi.fn((command, args, options) => {
        tick += args[1] === "stop" ? 41 : 7;
        if (command === "docker") {
          inspections += 1;
          if (scenario === "ownership-spawn-failure")
            return {
              error: Object.assign(new Error("inspection unavailable"), {
                code: "EACCES",
              }),
            };
          if (scenario === "ownership-change" && inspections === 2)
            return { status: 0, stdout: "foreign-project|foreign-workdir\n" };
        }
        if (args[1] === "stop" && scenario.includes("cleanup-failure"))
          return { status: 6 };
        if (args[0] === "scripts/verify-access-fixture-contract.mjs") {
          if (scenario === "primary-and-cleanup-failure") return { status: 9 };
          if (scenario === "child-interrupted") process.emit("SIGTERM");
          if (scenario === "ownership-spawn-failure")
            expect(
              lines.find((line) => line.name === "startup-ownership").outcome,
            ).toEqual({ type: "spawn-failure", code: "EACCES" });
          if (scenario === "spawn-failure")
            return {
              error: Object.assign(new Error("no child"), { code: "ENOENT" }),
            };
        }
        if (args[1] === "start" && scenario === "startup-interrupted")
          process.emit("SIGTERM");
        return baseRun(command, args, options);
      });
      const expected =
        scenario === "passed"
          ? 0
          : scenario === "cleanup-failure"
            ? 6
            : scenario === "primary-and-cleanup-failure"
              ? 9
              : scenario.includes("interrupted")
                ? 143
                : 1;
      expect(
        await mainWithPreparedProject(["--fixture-contract"], {
          environment: {},
          makeTemp: () => "/tmp/access-timing",
          removeTemp,
          run,
          prepareProject: ({ stateRoot }) => {
            tick += 11;
            if (scenario === "preparation-failure")
              throw new Error("preparation failed");
            return join(stateRoot, "project");
          },
          stderr: vi.fn(),
          stdout: (line) => lines.push(JSON.parse(line)),
          monotonicNow: () => tick,
          utcNow: () => new Date(Date.UTC(2026, 0, 1) + tick).toISOString(),
        }),
      ).toBe(expected);
      const retained = [
        "cleanup-failure",
        "primary-and-cleanup-failure",
        "ownership-change",
        "ownership-spawn-failure",
        "startup-interrupted",
      ].includes(scenario);
      const cleanup = lines.find((line) => line.name === "outer-cleanup");
      const summary = lines.at(-1);
      expect(cleanup).toMatchObject({
        type: "access-phase",
        name: "outer-cleanup",
        scope: "shared-cleanup",
        inclusive: true,
        outcome: { type: "exit", status: retained ? 1 : 0 },
      });
      expect(summary).toMatchObject({
        type: "access-lifecycle",
        inclusive: true,
        durationMs: tick - 100,
        completedAt: new Date(Date.UTC(2026, 0, 1) + tick).toISOString(),
        cleanupMs: retained ? null : cleanup.durationMs,
        cleanupReason: retained
          ? "Exact cleanup could not be completed; resources may be retained."
          : null,
        outcome: scenario.includes("interrupted")
          ? { type: "signal", signal: "SIGTERM" }
          : { type: "exit", status: expected },
      });
      expect(removeTemp).toHaveBeenCalledTimes(retained ? 0 : 1);
      const stop = lines.find((line) => line.name === "supabase-stop");
      if (
        [
          "ownership-change",
          "ownership-spawn-failure",
          "startup-interrupted",
          "preparation-failure",
        ].includes(scenario)
      ) {
        expect(stop).toBeUndefined();
      } else {
        expect(stop.durationMs).toBe(41);
        expect(Date.parse(summary.completedAt)).toBeGreaterThanOrEqual(
          Date.parse(stop.completedAt),
        );
        expect(stop.outcome).toEqual({
          type: "exit",
          status: scenario.includes("cleanup-failure") ? 6 : 0,
        });
      }
      const diagnostics = lines.filter(
        (line) => line.type === "verification-failure",
      );
      expect(
        diagnostics.every(
          (line) =>
            line.reproduceGroup.join(" ") ===
            "node scripts/verify-access.mjs --fixture-contract",
        ),
      ).toBe(true);
      if (scenario === "spawn-failure")
        expect(
          lines.find(
            (line) =>
              line.name === "scripts/verify-access-fixture-contract.mjs",
          ).outcome,
        ).toEqual({ type: "spawn-failure", code: "ENOENT" });
    }
    for (const failure of ["temporary-state", "preparation-cleanup"]) {
      let tick = 100;
      const lines = [];
      const run = vi.fn();
      const removeTemp = vi.fn(() => {
        tick += 13;
        throw new Error("cleanup failed");
      });
      await expect(
        mainWithPreparedProject([], {
          environment: {},
          run,
          removeTemp,
          makeTemp: () => {
            tick += 5;
            if (failure === "temporary-state")
              throw new Error("temporary state failed");
            return "/tmp/access-timing";
          },
          prepareProject: () => {
            tick += 11;
            throw new Error("preparation failed");
          },
          stdout: (line) => lines.push(JSON.parse(line)),
          stderr: vi.fn(),
          monotonicNow: () => tick,
          utcNow: () => new Date(Date.UTC(2026, 0, 1) + tick).toISOString(),
        }),
      ).rejects.toThrow(
        failure === "temporary-state"
          ? "temporary state failed"
          : "cleanup failed",
      );
      expect(run).not.toHaveBeenCalled();
      expect(removeTemp).toHaveBeenCalledTimes(
        failure === "temporary-state" ? 0 : 1,
      );
      expect(lines.at(-1)).toMatchObject({
        type: "access-lifecycle",
        durationMs: tick - 100,
        cleanupMs: null,
        cleanupReason:
          failure === "temporary-state"
            ? "Cleanup was not entered because temporary project state was not created."
            : "Exact cleanup could not be completed; resources may be retained.",
        outcome: { type: "exit", status: 1 },
      });
    }
    await observeInterruptedAccessVerification("SIGTERM", {
      observeTiming: (lines) => {
        const summary = lines.at(-1);
        expect(summary).toMatchObject({
          type: "access-lifecycle",
          cleanupReason: null,
          outcome: { type: "signal", signal: "SIGTERM" },
        });
        expect(summary.cleanupMs).toBeGreaterThanOrEqual(0);
        const stopped = lines.find((line) => line.name === "supabase-stop");
        expect(stopped.outcome).toEqual({ type: "exit", status: 0 });
        expect(Date.parse(summary.completedAt)).toBeGreaterThanOrEqual(
          Date.parse(stopped.completedAt),
        );
        expect(
          lines.find((line) => line.name === "supabase-db-reset").outcome,
        ).toEqual({ type: "signal", signal: "SIGTERM" });
      },
    });
  }, 15_000);
});
