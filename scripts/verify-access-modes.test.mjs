import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { main } from "./verify-access.mjs";
import { accessStepPlan } from "./verify-access-plan.mjs";
import {
  browserCommands,
  clientSecretScanCommand,
  commands,
  databaseCheckCommands,
  databasePreflightCommands,
  declaredSchemaDiffCommand,
  declaredSchemaDiffStep,
  fixtureContractCommands,
  inGroup,
  localCredentials,
  mainWithPreparedProject,
  nextFixtureCommands,
  ownedRun,
  ownershipCommand,
  plannedCommands,
  prebuiltNextJourneyCommand,
  resetCommand,
  scheduledExpiryVerifyCommand,
  scheduledJourneyCommand,
  sqlTestsCommand,
  sqlTestsStep,
  startCommand,
  statusCommand,
  stopCommand,
  successfulRun,
  workerBuildCommand,
  workerPreparationCommands,
} from "./verify-access-command-doubles.mjs";

function ownedJourneyCommands(phase) {
  const grep =
    phase === "retry-proof"
      ? "a Cottage Owner saves, resumes and submits a complete private application$"
      : "(?:shared sign-in from the homepage returns a prospective owner to their private application|a Cottage Owner saves, resumes and submits a complete private application|Owner Application keeps evidence controls aligned and accessible in every locale|one account returns to customer bookings, enrolls explicitly and signs out only this device)$";
  const retries = phase === "retry-proof" ? "--retries=1" : "--retries=0";
  return {
    next: [
      "npx",
      [
        "playwright",
        "test",
        "tests/access.spec.ts",
        "--project=mobile",
        "--project=desktop",
        "--workers=1",
        retries,
        "--grep",
        grep,
        `--output=playwright-report/owned-next-${phase}`,
      ],
    ],
    worker: [
      "npx",
      [
        "playwright",
        "test",
        "tests/access.spec.ts",
        "--project=worker",
        "--config=playwright.worker-prebuilt.config.ts",
        "--workers=1",
        retries,
        "--grep",
        grep,
        `--output=playwright-report/owned-worker-${phase}`,
      ],
    ],
  };
}

describe("access verification command", () => {
  it("skips reset without a claimed place only for a proven fresh GitHub-hosted start", async () => {
    const hosted = {
      GITHUB_ACTIONS: "true",
      RUNNER_ENVIRONMENT: "github-hosted",
    };
    const inventoryCommands = [
      ["docker", ["container", "ls", "--all", "--quiet"]],
      ["docker", ["volume", "ls", "--quiet"]],
    ];
    for (const scenario of [
      { name: "empty hosted", environment: hosted, reset: false },
      {
        name: "whitespace-only hosted",
        environment: hosted,
        containers: " \n",
        volumes: "\n",
        reset: false,
      },
      {
        name: "stopped container",
        environment: hosted,
        containers: "stopped-container-id\n",
        reset: true,
      },
      {
        name: "retained volume only",
        environment: hosted,
        volumes: "retained-volume\n",
        reset: true,
      },
      { name: "local", environment: {}, reset: true },
      { name: "CI-only", environment: { CI: "true" }, reset: true },
      {
        name: "self-hosted",
        environment: {
          GITHUB_ACTIONS: "true",
          RUNNER_ENVIRONMENT: "self-hosted",
        },
        reset: true,
      },
      {
        name: "GitHub identity alone",
        environment: { GITHUB_ACTIONS: "true" },
        reset: true,
      },
    ]) {
      const baseRun = successfulRun();
      const run = vi.fn((command, args, options) => {
        if (command === "docker" && args[1] === "ls")
          return {
            status: 0,
            stdout:
              args[0] === "container"
                ? (scenario.containers ?? "")
                : (scenario.volumes ?? ""),
          };
        return baseRun(command, args, options);
      });
      const stderr = vi.fn();
      expect(
        await mainWithPreparedProject(["--fixture-contract"], {
          environment: scenario.environment,
          run,
          stderr,
          stdout: vi.fn(),
        }),
        scenario.name,
      ).toBe(0);
      const inventories = run.mock.calls.filter(
        ([command, args]) => command === "docker" && args[1] === "ls",
      );
      expect(inventories.map(([command, args]) => [command, args])).toEqual(
        scenario.environment === hosted ? inventoryCommands : [],
      );
      for (const [, , options] of inventories)
        expect(options).toMatchObject({ encoding: "utf8", stdio: "pipe" });
      const startupOffset = inventories.length;
      expect(commands(run).slice(0, startupOffset + 2)).toEqual([
        ...inventories.map(([command, args]) => [command, args]),
        startCommand,
        ownershipCommand,
      ]);
      const resets = run.mock.calls.filter(
        ([command, args]) =>
          command === "npx" && args[1] === "db" && args[2] === "reset",
      );
      expect(resets, scenario.name).toHaveLength(scenario.reset ? 1 : 0);
      if (scenario.reset)
        expect(commands(run)[startupOffset + 2]).toEqual(resetCommand);
      expect(stderr).not.toHaveBeenCalled();
    }

    for (const [inventoryIndex, resource] of [
      [0, "container"],
      [1, "volume"],
    ]) {
      for (const failure of [
        { status: 0 },
        { status: 0, stdout: null },
        { status: 0, stdout: { ids: [] } },
        { status: 7, stdout: "", stderr: "Docker daemon unavailable" },
        { status: null, error: new Error("Docker executable unavailable") },
      ]) {
        const baseRun = successfulRun();
        const run = vi.fn((command, args, options) => {
          if (command === "docker" && args[0] === resource) return failure;
          return baseRun(command, args, options);
        });
        const stderr = vi.fn();
        const removeTemp = vi.fn();
        expect(
          await mainWithPreparedProject(["--database"], {
            environment: hosted,
            makeTemp: () => "/tmp/access-fresh-start",
            removeTemp,
            run,
            stderr,
            stdout: vi.fn(),
          }),
        ).toBe(failure.status || 1);
        expect(commands(run)).toEqual(
          inventoryCommands.slice(0, inventoryIndex + 1),
        );
        expect(stderr).toHaveBeenCalledWith(
          `Unable to verify Docker ${resource} inventory. Check Docker daemon access before retrying hosted verification.`,
        );
        expect(removeTemp).toHaveBeenCalledWith("/tmp/access-fresh-start");
      }
    }

    for (const scenario of [
      { name: "empty diff", exit: 0 },
      {
        name: "stale diff",
        diff: JSON.stringify({
          diff: "ALTER TABLE public.booking_requests DROP COLUMN party_size;",
        }),
        exit: 1,
        diagnostic: "Declared schema drifts from the migration chain:",
      },
      {
        name: "unreadable diff",
        diff: "not json",
        exit: 1,
        diagnostic: "Supabase returned an unreadable declared schema diff.",
      },
      {
        name: "SQL failure",
        sqlFailure: true,
        exit: 9,
        diagnostic: "SQL invariant failed",
      },
    ]) {
      const baseRun = successfulRun();
      const run = ownedRun((command, args, options) => {
        if (args[1] === "db" && args[2] === "diff" && scenario.diff)
          return { status: 0, stdout: scenario.diff };
        if (args[1] === "test" && args[2] === "db" && scenario.sqlFailure)
          return { status: 9, stderr: "SQL invariant failed" };
        return baseRun(command, args, options);
      });
      const stderr = vi.fn();
      expect(
        await mainWithPreparedProject(["--database"], {
          environment: {
            ...hosted,
            VERIFY_CI_PARTITION: scenario.sqlFailure
              ? "database-core"
              : "booking-request",
          },
          run,
          stderr,
          stdout: vi.fn(),
        }),
        scenario.name,
      ).toBe(scenario.exit);
      const preflight = commands(run).filter(
        ([command, args]) =>
          command === "npx" &&
          ((args[1] === "db" && args[2] === "diff") ||
            (args[1] === "test" && args[2] === "db")),
      );
      const expectedPreflight = scenario.sqlFailure
        ? sqlTestsCommand
        : declaredSchemaDiffCommand;
      expect(preflight).toEqual([expectedPreflight]);
      expect(commands(run).slice(0, 5)).toEqual([
        ...inventoryCommands,
        startCommand,
        ownershipCommand,
        expectedPreflight,
      ]);
      expect(run.mock.calls.some(([, args]) => args[2] === "reset")).toBe(
        false,
      );
      if (scenario.diagnostic) {
        expect(stderr).toHaveBeenCalledWith(scenario.diagnostic);
        expect(run.mock.calls.some(([, args]) => args[1] === "status")).toBe(
          false,
        );
        if (scenario.diff && scenario.name === "stale diff")
          expect(stderr).toHaveBeenCalledWith(
            "ALTER TABLE public.booking_requests DROP COLUMN party_size;",
          );
        if (scenario.sqlFailure)
          expect(stderr).toHaveBeenCalledWith(
            expect.stringContaining("Failed: npx supabase test db"),
          );
      } else {
        expect(stderr).not.toHaveBeenCalled();
      }
    }
  });

  it("does not blame Docker access when hosted inventory is cancelled", async () => {
    const inventoryCommands = [
      ["docker", ["container", "ls", "--all", "--quiet"]],
      ["docker", ["volume", "ls", "--quiet"]],
    ];
    for (const [inventoryIndex, resource] of [
      [0, "container"],
      [1, "volume"],
    ]) {
      for (const [signal, status] of [
        ["SIGINT", 130],
        ["SIGTERM", 143],
      ]) {
        const run = vi.fn((command, args) => {
          if (command === "docker" && args[0] === resource)
            process.emit(signal);
          return { status: 0, stdout: "" };
        });
        const stderr = vi.fn();
        const removeTemp = vi.fn();
        const stdout = vi.fn();
        expect(
          await mainWithPreparedProject(["--database"], {
            environment: {
              GITHUB_ACTIONS: "true",
              RUNNER_ENVIRONMENT: "github-hosted",
            },
            makeTemp: () => "/tmp/access-inventory-cancellation",
            removeTemp,
            run,
            stderr,
            stdout,
          }),
        ).toBe(status);
        expect(stderr).not.toHaveBeenCalled();
        expect(commands(run)).toEqual(
          inventoryCommands.slice(0, inventoryIndex + 1),
        );
        expect(removeTemp).toHaveBeenCalledWith(
          "/tmp/access-inventory-cancellation",
        );
        expect(JSON.parse(stdout.mock.calls.at(-1)[0])).toMatchObject({
          type: "access-lifecycle",
          outcome: { type: "signal", signal },
        });
      }
    }
  });

  it("declares homogeneous concurrency checks serial without changing their command order", () => {
    const checks = [
      "verify-account-access-concurrency",
      "verify-cottage-profile-draft-concurrency",
      "verify-cottage-shift-schedule-concurrency",
      "verify-cottage-inventory-concurrency",
      "verify-booking-period-hold-concurrency",
      "verify-booking-request-lifecycle-concurrency",
      "verify-booking-confirmation-notification-concurrency",
      "verify-booking-preparation-reminder-concurrency",
      "verify-booking-cancellation-concurrency",
      "verify-messaging-concurrency",
      "verify-booking-completion-concurrency",
      "verify-customer-review-concurrency",
      "verify-booking-refund-concurrency",
    ];
    for (const check of checks) {
      const source = readFileSync(`scripts/${check}.mjs`, "utf8");
      expect(source, check).toMatch(
        new RegExp(
          `timing: \\s*\\{\\s*check: \\s*"${check}",\\s*isolation: \\s*"serial",?\\s*\\}`,
        ),
      );
    }
  });

  it("exposes stable standalone database and browser aliases", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

    expect(packageJson.scripts["verify:access"]).toBe(
      "node scripts/verify-access.mjs",
    );
    expect(packageJson.scripts["verify:access:database"]).toBe(
      "node scripts/verify-access.mjs --database",
    );
    expect(packageJson.scripts["verify:access:database-tests"]).toBe(
      "node scripts/verify-access.mjs --database-tests",
    );
    expect(packageJson.scripts["verify:access:browser"]).toBe(
      "node scripts/verify-access.mjs --browser",
    );
  });

  it("rejects arguments before starting Docker or Supabase", async () => {
    const run = vi.fn();
    const stderr = vi.fn();

    expect(await mainWithPreparedProject(["unexpected"], { run, stderr })).toBe(
      2,
    );
    expect(run).not.toHaveBeenCalled();

    expect(
      await mainWithPreparedProject(["--database", "--browser"], {
        run,
        stderr,
      }),
    ).toBe(2);
    expect(
      await mainWithPreparedProject(["--database", "--database"], {
        run,
        stderr,
      }),
    ).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("loads reused messaging cancellation templates before rejecting invalid database identity", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts/verify-messaging-concurrency.mjs")],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SUPABASE_LOCAL_PROJECT: "invalid",
          SUPABASE_DB_CONTAINER: "invalid",
          PATH: "",
        },
        encoding: "utf8",
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "The guarded local Supabase database identity is invalid.",
    );
    expect(result.stderr).not.toMatch(
      /Missing .*template|Duplicate .*template|unresolved interpolation/,
    );
    const summaries = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((record) => record.type === "concurrency-summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      check: "verify-messaging-concurrency",
      isolation: "serial",
      outcome: "failed",
      executionMs: null,
      cleanupMs: null,
      phaseReasons: {
        execution: "Phase was not reached.",
        cleanup: "Phase was not reached.",
      },
    });
    expect(Number.isFinite(summaries[0].setupMs)).toBe(true);
    expect(summaries[0].setupMs).toBeGreaterThanOrEqual(0);
  });

  it.each(["forward", "reverse", "retry-proof", undefined])(
    "runs only the finite owned journey vectors for phase %s after real readiness",
    async (suppliedPhase) => {
      const phase = suppliedPhase ?? "forward";
      const run = successfulRun();
      const environment =
        suppliedPhase === undefined
          ? {}
          : { ACCESS_JOURNEY_PHASE: suppliedPhase };
      expect(
        await mainWithPreparedProject(["--owned-journeys"], {
          environment,
          run,
        }),
      ).toBe(0);
      const owned = ownedJourneyCommands(phase);
      expect(commands(run)).toEqual([
        startCommand,
        ownershipCommand,
        resetCommand,
        statusCommand,
        ...fixtureContractCommands,
        ...nextFixtureCommands,
        owned.next,
        ...workerPreparationCommands,
        owned.worker,
        ownershipCommand,
        stopCommand,
      ]);
      for (const [, args, options] of run.mock.calls) {
        expect(options.env.ACCESS_JOURNEY_PHASE).toBe(
          args[0] === "scripts/verify-access-fixture-contract.mjs" ||
            args.includes("--config=scripts/access-journey-fixture.config.ts")
            ? "boundary"
            : phase,
        );
      }
      const build = run.mock.calls.find(([command]) => command === "npm");
      const worker = run.mock.calls.find(([, args]) =>
        args.includes("--project=worker"),
      );
      expect(worker[2].env).toEqual(build[2].env);
      expect(run.mock.calls.indexOf(build)).toBeLessThan(
        run.mock.calls.indexOf(worker),
      );
    },
  );

  it.each([
    { args: ["--owned-journeys"], phase: "ordinary" },
    { args: ["--owned-journeys"], phase: "boundary" },
    { args: ["--owned-journeys"], phase: "unknown" },
    { args: ["--owned-journeys"], phase: "" },
    { args: [], phase: "forward" },
    { args: ["--browser"], phase: "reverse" },
    { args: ["--database"], phase: "retry-proof" },
    { args: ["--fixture-contract"], phase: "forward" },
  ])(
    "rejects phase $phase for $args before creating state or running commands",
    async ({ args, phase }) => {
      const makeTemp = vi.fn();
      const prepareProject = vi.fn();
      const run = vi.fn();
      expect(
        await main(args, {
          environment: { ACCESS_JOURNEY_PHASE: phase },
          makeTemp,
          prepareProject,
          run,
          stderr: vi.fn(),
        }),
      ).toBe(2);
      expect(makeTemp).not.toHaveBeenCalled();
      expect(prepareProject).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it.each(["readiness", "worker build"])(
    "propagates failed owned %s without running its consumers",
    async (stage) => {
      const run = ownedRun((command, args) => ({
        status:
          (stage === "readiness" &&
            args.includes(
              "--config=scripts/access-journey-fixture.config.ts",
            )) ||
          (stage === "worker build" && command === "npm")
            ? 7
            : 0,
        stdout:
          args.slice(0, 4).join(" ") === "supabase status -o json"
            ? localCredentials
            : "",
      }));
      const removeTemp = vi.fn();
      expect(
        await mainWithPreparedProject(["--owned-journeys"], {
          environment: {},
          makeTemp: () => "/tmp/access-docker",
          removeTemp,
          run,
        }),
      ).toBe(7);
      expect(
        run.mock.calls.some(([, args]) => args.includes("--project=worker")),
      ).toBe(false);
      if (stage === "readiness") {
        expect(
          run.mock.calls.some(([, args]) => args.includes("--project=mobile")),
        ).toBe(false);
      }
      expect(run.mock.calls.at(-1).slice(0, 2)).toEqual(stopCommand);
      expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
    },
  );

  it("runs complete database evidence without browser work", async () => {
    const run = successfulRun();

    expect(
      await mainWithPreparedProject(["--database"], { environment: {}, run }),
    ).toBe(0);

    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      ...databasePreflightCommands,
      statusCommand,
      ...databaseCheckCommands,
      ownershipCommand,
      stopCommand,
    ]);
  });

  it("runs the steps of the plan it is given between startup and cleanup", async () => {
    const run = successfulRun();
    const stepPlan = vi.fn(() => ({
      preflight: [
        {
          group: "database",
          command: "npx",
          args: ["supabase", "inspect", "db"],
          environment: "supabase",
        },
      ],
      checks: [
        {
          group: "database",
          command: "node",
          args: ["scripts/unlisted-check.mjs"],
          environment: "database",
        },
      ],
    }));

    expect(
      await mainWithPreparedProject(["--database"], {
        environment: {},
        run,
        stepPlan,
      }),
    ).toBe(0);

    expect(stepPlan).toHaveBeenCalledWith({
      mode: "--database",
      phase: "ordinary",
      partition: undefined,
      shard: undefined,
    });
    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      ["npx", ["supabase", "inspect", "db", "--workdir", expect.any(String)]],
      statusCommand,
      ["node", ["scripts/unlisted-check.mjs"]],
      ownershipCommand,
      stopCommand,
    ]);
  });

  it("refuses a planned step whose environment the runner does not provide", async () => {
    const run = successfulRun();
    const removeTemp = vi.fn();
    const stderr = vi.fn();
    const lines = [];

    expect(
      await mainWithPreparedProject(["--database"], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
        stderr,
        stdout: (line) => lines.push(JSON.parse(line)),
        stepPlan: () => ({
          preflight: [],
          checks: [
            {
              group: "database",
              command: "node",
              args: ["scripts/unlisted-check.mjs"],
              environment: "inherited",
            },
          ],
        }),
      }),
    ).toBe(1);

    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("unknown environment inherited"),
    );
    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      statusCommand,
      ownershipCommand,
      stopCommand,
    ]);
    expect(
      lines.filter((line) => line.type === "verification-failure"),
    ).toEqual([
      {
        type: "verification-failure",
        attemptedCommand: ["node", "scripts/unlisted-check.mjs"],
        reproduceGroup: ["npm", "run", "verify:access:database"],
      },
    ]);
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
  });

  it("runs the database tests without the booking and payment concurrency programs", async () => {
    const run = successfulRun();

    expect(
      await mainWithPreparedProject(["--database-tests"], {
        environment: {},
        run,
      }),
    ).toBe(0);

    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      ...databasePreflightCommands,
      statusCommand,
      ...databaseCheckCommands.filter(
        ([, [script]]) => !script.startsWith("scripts/verify-booking-"),
      ),
      ownershipCommand,
      stopCommand,
    ]);
  });

  it.each([
    {
      name: "a non-empty declared schema diff",
      stdout: JSON.stringify({
        diff: "ALTER TABLE public.booking_requests DROP COLUMN party_size;",
        dropStatements: [],
      }),
      diagnostic: "ALTER TABLE public.booking_requests DROP COLUMN party_size;",
    },
    {
      name: "an unreadable declared schema diff",
      stdout: "not json",
      diagnostic: "unreadable declared schema diff",
    },
  ])(
    "fails database evidence on $name before running SQL tests and cleans up",
    async ({ stdout, diagnostic }) => {
      const errors = vi.fn();
      const run = ownedRun((command, args) => ({
        status: 0,
        stdout:
          command === "npx" &&
          args.slice(0, 6).join(" ") ===
            "supabase db diff --local --output-format json"
            ? stdout
            : command === "npx" &&
                args.slice(0, 4).join(" ") === "supabase status -o json"
              ? localCredentials
              : "",
      }));

      expect(
        await mainWithPreparedProject(["--database"], {
          environment: {},
          run,
          stderr: errors,
        }),
      ).toBe(1);

      expect(commands(run)).toEqual([
        startCommand,
        ownershipCommand,
        resetCommand,
        declaredSchemaDiffCommand,
        ownershipCommand,
        stopCommand,
      ]);
      expect(errors.mock.calls.flat().join("\n")).toContain(diagnostic);
    },
  );

  it.each([{ mode: [] }, { mode: ["--database"] }])(
    "propagates Capture concurrency failure in mode $mode and cleans up",
    async ({ mode }) => {
      const run = ownedRun((command, args) => ({
        status:
          command === "node" &&
          args[0] === "scripts/verify-booking-request-capture-concurrency.mjs"
            ? 7
            : 0,
        stdout:
          command === "npx" &&
          args.slice(0, 4).join(" ") === "supabase status -o json"
            ? localCredentials
            : "",
      }));
      expect(
        await mainWithPreparedProject(mode, {
          environment: {},
          run,
          stderr: vi.fn(),
        }),
      ).toBe(7);
      expect(run.mock.calls.at(-1).slice(0, 2)).toEqual(stopCommand);
      expect(
        run.mock.calls.some(
          ([, args]) =>
            args[0] === "playwright" && args.includes("--project=mobile"),
        ),
      ).toBe(false);
    },
  );

  it("runs complete browser evidence from fresh fixtures without database checks", async () => {
    const run = successfulRun();

    expect(
      await mainWithPreparedProject(["--browser"], { environment: {}, run }),
    ).toBe(0);

    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      statusCommand,
      ...browserCommands,
      ownershipCommand,
      stopCommand,
    ]);
  });

  it("runs the final scheduled expiry check after a failed scheduled test and keeps the test failure authoritative", async () => {
    for (const verifyStatus of [0, 7]) {
      const run = ownedRun((command, args) => ({
        status: args.includes("tests/worker-scheduled-expiry.spec.ts")
          ? 5
          : args.at(-1) === "--verify"
            ? verifyStatus
            : 0,
        stdout:
          command === "npx" &&
          args.slice(0, 4).join(" ") === "supabase status -o json"
            ? localCredentials
            : "",
      }));
      const lines = [];
      expect(
        await mainWithPreparedProject(["--browser"], {
          environment: {
            GITHUB_ACTIONS: "true",
            VERIFY_CI_PARTITION: "scheduled",
          },
          run,
          stderr: vi.fn(),
          stdout: (line) => lines.push(JSON.parse(line)),
        }),
      ).toBe(5);
      expect(commands(run).slice(-4)).toEqual([
        scheduledJourneyCommand,
        scheduledExpiryVerifyCommand,
        ownershipCommand,
        stopCommand,
      ]);
      expect(
        lines.filter((line) => line.type === "verification-failure"),
      ).toEqual([
        {
          type: "verification-failure",
          attemptedCommand: ["npx", ...scheduledJourneyCommand[1]],
          reproduceGroup: ["npm", "run", "verify:access:browser"],
        },
      ]);
    }
  });

  it("runs only the public Worker fixture contract in focused disposable mode", async () => {
    const run = ownedRun((command, args) => ({
      status: 0,
      stdout:
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));
    const removeTemp = vi.fn();

    expect(
      await mainWithPreparedProject(["--fixture-contract"], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
      }),
    ).toBe(0);

    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      statusCommand,
      ...fixtureContractCommands,
      ownershipCommand,
      stopCommand,
    ]);
    expect(run.mock.calls[4][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-verification",
      SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
    });
    expect(run.mock.calls[5][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-verification",
      SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
    });
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
  });

  it("runs database and browser evidence with local credentials then stops", async () => {
    const run = ownedRun((command, args) => ({
      status: 0,
      stdout:
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));
    const removeTemp = vi.fn();

    expect(
      await mainWithPreparedProject([], {
        environment: {
          EXISTING: "kept",
          SUPABASE_URL: "http://127.0.0.1:59999",
          SUPABASE_PUBLISHABLE_KEY: "stale-publishable",
          SUPABASE_SECRET_KEY: "inherited-secret",
        },
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
      }),
    ).toBe(0);

    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      ...databasePreflightCommands,
      statusCommand,
      ...databaseCheckCommands,
      ...browserCommands,
      ownershipCommand,
      stopCommand,
    ]);
    const optionsFor = (command, args) => {
      const calls = run.mock.calls.filter(
        ([actualCommand, actualArgs]) =>
          actualCommand === command &&
          actualArgs.length === args.length &&
          actualArgs.every((argument, index) => argument === args[index]),
      );
      expect(calls, `${command} ${args.join(" ")}`).toHaveLength(1);
      return calls[0][2];
    };
    const localEnvironment = {
      EXISTING: "kept",
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: "local-secret",
      PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
      SUPABASE_TELEMETRY_DISABLED: "1",
      DO_NOT_TRACK: "1",
    };
    const databaseIdentity = {
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-verification",
      SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
    };
    // Startup remains the first public command, as asserted by the full sequence above.
    expect(run.mock.calls[0][2].env).toMatchObject({
      DOCKER_CONFIG: "/tmp/access-docker",
      DO_NOT_TRACK: "1",
      EXISTING: "kept",
      SUPABASE_TELEMETRY_DISABLED: "1",
    });
    const ownershipCalls = run.mock.calls.filter(
      ([command]) => command === "docker",
    );
    expect(ownershipCalls).toHaveLength(2);
    for (const [, , options] of ownershipCalls) {
      expect(options).toMatchObject({
        encoding: "utf8",
        env: {
          ACCESS_JOURNEY_PHASE: "ordinary",
          DOCKER_CONFIG: "/tmp/access-docker",
          DO_NOT_TRACK: "1",
          EXISTING: "kept",
          ...databaseIdentity,
          SUPABASE_TELEMETRY_DISABLED: "1",
        },
        maxBuffer: 1024 * 1024,
      });
      expect(options).toHaveProperty("input", undefined);
      expect(options.env).not.toHaveProperty("SUPABASE_URL");
      expect(options.env).not.toHaveProperty("SUPABASE_PUBLISHABLE_KEY");
      expect(options.env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    }
    expect(
      optionsFor("node", ["scripts/verify-access-fixture-contract.mjs"]).env,
    ).toMatchObject({ ...localEnvironment, ...databaseIdentity });

    for (const [command, args] of [
      ["node", ["scripts/verify-account-access-concurrency.mjs"]],
      [
        "node",
        ["scripts/verify-booking-request-scheduled-expiry.mjs", "--verify"],
      ],
    ]) {
      const { env } = optionsFor(command, args);
      expect(env).toMatchObject(databaseIdentity);
      expect(env).not.toHaveProperty("SUPABASE_URL");
      expect(env).not.toHaveProperty("SUPABASE_PUBLISHABLE_KEY");
      expect(env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    }
    for (const script of [
      "verify-cottage-profile-draft-concurrency",
      "verify-cottage-inventory-concurrency",
      "verify-booking-period-hold-concurrency",
      "verify-booking-request-concurrency",
      "verify-booking-request-payment-recovery-concurrency",
      "verify-booking-request-payment-history-concurrency",
      "verify-booking-confirmation-notification-concurrency",
      "verify-booking-event-notification-concurrency",
      "verify-booking-request-notification-concurrency",
      "verify-booking-preparation-reminder-concurrency",
      "verify-booking-cancellation-concurrency",
      "verify-messaging-concurrency",
      "verify-booking-completion-concurrency",
      "verify-customer-review-concurrency",
      "verify-booking-refund-concurrency",
      "verify-booking-payout-concurrency",
      "verify-booking-request-payment-required-expiry-concurrency",
    ]) {
      const { env } = optionsFor("node", [`scripts/${script}.mjs`]);
      expect(env).toMatchObject({
        ...databaseIdentity,
        SUPABASE_URL: localEnvironment.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: localEnvironment.SUPABASE_PUBLISHABLE_KEY,
      });
      expect(env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    }
    const scheduleEnvironment = optionsFor("node", [
      "scripts/verify-cottage-shift-schedule-concurrency.mjs",
    ]).env;
    expect(scheduleEnvironment).toMatchObject({
      SUPABASE_URL: localEnvironment.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: localEnvironment.SUPABASE_PUBLISHABLE_KEY,
    });
    expect(scheduleEnvironment).not.toHaveProperty("SUPABASE_SECRET_KEY");
    for (const script of [
      "verify-booking-request-lifecycle-concurrency",
      "verify-booking-request-capture-concurrency",
    ]) {
      expect(optionsFor("node", [`scripts/${script}.mjs`]).env).toMatchObject({
        ...localEnvironment,
        ...databaseIdentity,
      });
    }
    expect(
      optionsFor("node", [
        "scripts/prepare-access-test.mjs",
        "create",
        "mobile",
      ]).env,
    ).toMatchObject(localEnvironment);
    for (const [command, args] of browserCommands) {
      if (args[0] === "scripts/prepare-access-test.mjs") {
        expect(optionsFor(command, args).env).toMatchObject(localEnvironment);
      } else if (command === "npm" || args[0] === "playwright") {
        expect(optionsFor(command, args).env).toMatchObject({
          ...localEnvironment,
          ...databaseIdentity,
          NEXTJS_ENV: "test",
          SUPABASE_PROJECT_REF: "local-test",
          PLAYWRIGHT_SERVER: args.includes("--project=mobile")
            ? "next"
            : "worker",
        });
      }
    }
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
  });

  it.each([
    { status: 7 },
    { status: null, signal: "SIGTERM" },
    { status: null, error: new Error("build unavailable") },
  ])(
    "blocks prebuilt Worker journeys on a failed build and still cleans up: %j",
    async (failure) => {
      const removeTemp = vi.fn();
      const run = ownedRun((command, args) => {
        if (command === "npm" && args.join(" ") === "run build:worker")
          return failure;
        return {
          status: 0,
          stdout:
            args.slice(0, 4).join(" ") === "supabase status -o json"
              ? localCredentials
              : "",
        };
      });
      expect(
        await mainWithPreparedProject(["--browser"], {
          environment: {},
          makeTemp: () => "/tmp/access-docker",
          removeTemp,
          run,
          stderr: vi.fn(),
        }),
      ).toBe(failure.status ?? 1);
      expect(
        run.mock.calls.some(
          ([, args]) =>
            args.includes("--config=playwright.worker-prebuilt.config.ts") ||
            args.includes("--config=playwright.next-prebuilt.config.ts") ||
            args.join(" ") === "run scan:client-secrets",
        ),
      ).toBe(false);
      expect(run.mock.calls.at(-1).slice(0, 2)).toEqual(stopCommand);
      expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
    },
  );

  it("builds Worker access and scheduled expiry once with the same real local bindings", async () => {
    const run = successfulRun();
    expect(
      await mainWithPreparedProject(["--browser"], { environment: {}, run }),
    ).toBe(0);
    const builds = run.mock.calls.filter(
      ([command, args]) =>
        command === "npm" && args.join(" ") === "run build:worker",
    );
    const workers = run.mock.calls.filter(([, args]) =>
      args.includes("--project=worker"),
    );
    const nextJourneys = run.mock.calls.filter(([, args]) =>
      args.includes("--project=mobile"),
    );
    expect(builds).toHaveLength(1);
    expect(nextJourneys).toHaveLength(1);
    expect(nextJourneys[0][1]).toContain(
      "--config=playwright.next-prebuilt.config.ts",
    );
    expect(run.mock.calls.indexOf(builds[0])).toBeLessThan(
      run.mock.calls.indexOf(nextJourneys[0]),
    );
    expect(workers).toHaveLength(2);
    for (const worker of workers) {
      expect(worker[1]).toContain(
        "--config=playwright.worker-prebuilt.config.ts",
      );
      expect(worker[2].env).toEqual(builds[0][2].env);
      expect(run.mock.calls.indexOf(builds[0])).toBeLessThan(
        run.mock.calls.indexOf(worker),
      );
    }
    expect(builds[0][2].env).toMatchObject({
      SUPABASE_SECRET_KEY: "local-secret",
      NEXTJS_ENV: "test",
      PLAYWRIGHT_SERVER: "worker",
    });
  });

  it("scans the build the run uses for the secret that build was given", async () => {
    const assetRoots = [".next/static", ".open-next/assets"];
    for (const planted of [...assetRoots, undefined]) {
      const buildRoot = mkdtempSync(join(tmpdir(), "access-scan-"));
      try {
        // A scan that ran before the build would pass on these.
        for (const root of assetRoots) {
          mkdirSync(join(buildRoot, root), { recursive: true });
          writeFileSync(join(buildRoot, root, "stale.js"), "stale");
        }
        const baseRun = successfulRun();
        const run = vi.fn((command, args, options) => {
          const invocation = [command, ...args].join(" ");
          if (invocation === "npm run build:worker") {
            const secret = options.env.SUPABASE_SECRET_KEY;
            expect(secret).toBe("local-secret");
            for (const root of assetRoots) {
              writeFileSync(
                join(buildRoot, root, "app.js"),
                root === planted ? `const key = "${secret}";` : "clean",
              );
            }
            return { status: 0 };
          }
          if (invocation === "npm run scan:client-secrets") {
            const [runner, flag, script, ...roots] = JSON.parse(
              readFileSync("package.json", "utf8"),
            ).scripts["scan:client-secrets"].split(" ");
            expect([runner, flag, script]).toEqual([
              "node",
              "--experimental-strip-types",
              "src/ci/client-secret-scan.ts",
            ]);
            const scanned = spawnSync(
              process.execPath,
              [flag, resolve(process.cwd(), script), ...roots],
              { cwd: buildRoot, encoding: "utf8", env: options.env },
            );
            return { status: scanned.status, stderr: scanned.stderr };
          }
          return baseRun(command, args, options);
        });
        const removeTemp = vi.fn();
        const output = [];
        const status = await mainWithPreparedProject(["--browser"], {
          environment: {},
          makeTemp: () => "/tmp/access-docker",
          removeTemp,
          run,
          stderr: (line) => output.push(line),
          stdout: (line) => output.push(line),
        });

        const calls = commands(run).map(([command, args]) =>
          [command, ...args].join(" "),
        );
        const build = calls.indexOf("npm run build:worker");
        const scan = calls.indexOf("npm run scan:client-secrets");
        const firstJourney = calls.findIndex((call) =>
          call.startsWith("npx playwright test"),
        );
        expect(build, String(planted)).toBeGreaterThan(-1);
        expect(scan, String(planted)).toBeGreaterThan(build);
        expect(run.mock.calls[scan][2].env).toEqual(
          run.mock.calls[build][2].env,
        );
        if (planted) {
          expect(status).toBe(1);
          expect(firstJourney).toBe(-1);
          expect(output.join("\n")).toContain(
            `Server credential found in client asset: ${planted}/app.js`,
          );
        } else {
          expect(status).toBe(0);
          expect(firstJourney).toBeGreaterThan(scan);
          expect(calls[firstJourney]).toContain("--project=mobile");
        }
        expect(output.join("\n")).not.toContain("local-secret");
        expect(run.mock.calls.at(-1).slice(0, 2)).toEqual(stopCommand);
        expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
      } finally {
        rmSync(buildRoot, { recursive: true });
      }
    }
  });

  it("creates the mobile Cottage Owner identity before its concurrency proof", async () => {
    let mobileIdentityCreated = false;
    const run = ownedRun((command, args) => {
      const invocation = [command, ...args].join(" ");
      if (invocation === "node scripts/prepare-access-test.mjs create mobile") {
        mobileIdentityCreated = true;
      }
      return {
        status:
          invocation ===
            "node scripts/verify-cottage-profile-draft-concurrency.mjs" &&
          !mobileIdentityCreated
            ? 9
            : 0,
        stdout: invocation.startsWith("npx supabase status -o json ")
          ? localCredentials
          : "",
      };
    });

    expect(await mainWithPreparedProject([], { environment: {}, run })).toBe(0);
    expect(mobileIdentityCreated).toBe(true);
  });

  it("blocks Worker journeys when browser fixture validation fails and still cleans up", async () => {
    const removeTemp = vi.fn();
    const run = ownedRun((command, args) => ({
      status:
        command === "node" &&
        args.join(" ") === "scripts/prepare-access-test.mjs validate worker"
          ? 7
          : 0,
      stdout:
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));

    expect(
      await mainWithPreparedProject(["--browser"], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
      }),
    ).toBe(7);
    expect(
      run.mock.calls.some(
        ([command, args]) =>
          command === "npx" &&
          args.includes("playwright") &&
          args.includes("--project=worker"),
      ),
    ).toBe(false);
    expect(run.mock.calls.at(-1).slice(0, 2)).toEqual(stopCommand);
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
  });

  it("reports shared access phase costs and the authoritative failing child group", async () => {
    const captureCommand = [
      "node",
      "scripts/verify-booking-request-capture-concurrency.mjs",
    ];
    const nextCommand = [
      prebuiltNextJourneyCommand[0],
      ...prebuiltNextJourneyCommand[1],
    ];
    const fixtureCommand = [
      "node",
      "scripts/verify-access-fixture-contract.mjs",
    ];
    const scenarios = [
      {
        args: [],
        failure: captureCommand,
        recipe: ["npm", "run", "verify:access:database"],
        before: [
          startCommand,
          ownershipCommand,
          resetCommand,
          ...databasePreflightCommands,
          statusCommand,
          ...databaseCheckCommands.slice(
            0,
            databaseCheckCommands.findIndex(
              ([, args]) => args[0] === captureCommand[1],
            ) + 1,
          ),
        ],
      },
      {
        args: [],
        failure: nextCommand,
        recipe: ["npm", "run", "verify:access:browser"],
        before: [
          startCommand,
          ownershipCommand,
          resetCommand,
          ...databasePreflightCommands,
          statusCommand,
          ...databaseCheckCommands,
          ...nextFixtureCommands,
          workerBuildCommand,
          clientSecretScanCommand,
          prebuiltNextJourneyCommand,
        ],
      },
      {
        args: ["--fixture-contract"],
        failure: fixtureCommand,
        recipe: ["node", "scripts/verify-access.mjs", "--fixture-contract"],
        before: [
          startCommand,
          ownershipCommand,
          resetCommand,
          statusCommand,
          fixtureContractCommands[0],
        ],
      },
      {
        args: [],
        credentials: "secret-invalid-json",
        recipe: ["npm", "run", "verify:access"],
        before: [
          startCommand,
          ownershipCommand,
          resetCommand,
          ...databasePreflightCommands,
          statusCommand,
        ],
      },
      {
        args: [],
        credentials: JSON.stringify({
          API_URL: {},
          PUBLISHABLE_KEY: [],
          SECRET_KEY: true,
        }),
        recipe: ["npm", "run", "verify:access"],
        before: [
          startCommand,
          ownershipCommand,
          resetCommand,
          ...databasePreflightCommands,
          statusCommand,
        ],
      },
      {
        args: [],
        schema: "secret-schema-invalid-json",
        recipe: ["npm", "run", "verify:access:database"],
        before: [
          startCommand,
          ownershipCommand,
          resetCommand,
          declaredSchemaDiffCommand,
        ],
      },
      {
        args: ["--browser"],
        failure: ["npx", "supabase", "db", "reset", "--local"],
        prefix: true,
        recipe: ["npm", "run", "verify:access:browser"],
        before: [startCommand, ownershipCommand, resetCommand],
      },
    ];
    for (const scenario of scenarios) {
      let tick = 100;
      const timestamp = () =>
        new Date(Date.UTC(2026, 0, 1) + tick).toISOString();
      const lines = [];
      const baseRun = successfulRun();
      const run = vi.fn((command, args, options) => {
        // Advance time in actual work, including ownership inspections.
        tick += 7;
        const vector = [command, ...args];
        if (
          scenario.failure &&
          (scenario.prefix
            ? vector.slice(0, scenario.failure.length).join("|") ===
              scenario.failure.join("|")
            : vector.join("|") === scenario.failure.join("|"))
        )
          return { status: 9 };
        if (args[1] === "status" && scenario.credentials !== undefined)
          return { status: 0, stdout: scenario.credentials };
        if (
          args[1] === "db" &&
          args[2] === "diff" &&
          scenario.schema !== undefined
        )
          return { status: 0, stdout: scenario.schema };
        return baseRun(command, args, options);
      });
      expect(
        await mainWithPreparedProject(scenario.args, {
          environment: { HIDDEN_VALUE: "hidden-environment-value" },
          makeTemp: () => "/tmp/access-timing",
          prepareProject: ({ stateRoot }) => {
            tick += 11;
            return join(stateRoot, "project");
          },
          removeTemp: () => {
            tick += 3;
          },
          run,
          stderr: vi.fn(),
          stdout: (line) => lines.push(JSON.parse(line)),
          monotonicNow: () => tick,
          utcNow: timestamp,
        }),
      ).toBe(scenario.failure ? 9 : 1);
      expect(commands(run)).toEqual([
        ...scenario.before,
        ownershipCommand,
        stopCommand,
      ]);
      const records = lines.filter((line) => line.type === "access-phase");
      expect(records[0]).toMatchObject({
        name: "project-preparation",
        command: null,
        scope: "shared-setup",
        durationMs: 11,
        inclusive: false,
        startedAt: "2026-01-01T00:00:00.100Z",
        completedAt: "2026-01-01T00:00:00.111Z",
      });
      const commandRecords = records.filter((line) => line.command !== null);
      expect(
        commandRecords.map((line) => [line.command[0], line.command.slice(1)]),
      ).toEqual(commands(run));
      for (const record of commandRecords) {
        expect(record.durationMs).toBe(7);
        expect(
          Date.parse(record.completedAt) - Date.parse(record.startedAt),
        ).toBe(7);
      }
      expect(
        lines.filter((line) => line.type === "verification-failure"),
      ).toEqual([
        {
          type: "verification-failure",
          attemptedCommand: commandRecords.at(-3).command,
          reproduceGroup: scenario.recipe,
        },
      ]);
      const summary = lines.at(-1);
      expect(summary).toMatchObject({
        type: "access-lifecycle",
        inclusive: true,
        durationMs: 11 + commands(run).length * 7 + 3,
        cleanupMs: 17,
        cleanupReason: null,
        outcome: { type: "exit", status: scenario.failure ? 9 : 1 },
      });
      expect(summary.sharedSetupMs).toBe(
        records
          .filter((line) => line.scope === "shared-setup")
          .reduce((sum, line) => sum + line.durationMs, 0),
      );
      expect(summary.checksMs).toBe(
        records
          .filter((line) => line.scope === "check")
          .reduce((sum, line) => sum + line.durationMs, 0),
      );
      expect(summary.sharedSetupMs + summary.checksMs + summary.cleanupMs).toBe(
        summary.durationMs,
      );
      expect(JSON.stringify(lines)).not.toMatch(
        /hidden-environment-value|local-secret|local-publishable|secret-invalid-json|secret-schema-invalid-json/,
      );
      if (scenario.failure)
        expect(commandRecords.at(-3).outcome).toEqual({
          type: "exit",
          status: 9,
        });
    }
  });

  it("plans the checks for every mode without starting a process", () => {
    const databasePreflight = inGroup("database", [
      declaredSchemaDiffStep,
      sqlTestsStep,
    ]);
    const modePlans = [
      {
        mode: undefined,
        phase: "ordinary",
        preflight: databasePreflight,
        checks: [
          ...inGroup("database", databaseCheckCommands),
          ...inGroup("browser", browserCommands),
        ],
      },
      {
        mode: "--database",
        phase: "ordinary",
        preflight: databasePreflight,
        checks: inGroup("database", databaseCheckCommands),
      },
      {
        mode: "--database-tests",
        phase: "ordinary",
        preflight: databasePreflight,
        checks: inGroup(
          "database",
          databaseCheckCommands.filter(
            ([, [script]]) => !script.startsWith("scripts/verify-booking-"),
          ),
        ),
      },
      {
        mode: "--browser",
        phase: "ordinary",
        preflight: [],
        checks: inGroup("browser", browserCommands),
      },
      {
        mode: "--fixture-contract",
        phase: "ordinary",
        preflight: [],
        checks: inGroup("fixture", fixtureContractCommands),
      },
      ...["forward", "reverse", "retry-proof"].map((phase) => {
        const owned = ownedJourneyCommands(phase);
        return {
          mode: "--owned-journeys",
          phase,
          preflight: [],
          checks: [
            ...inGroup("shared-setup", fixtureContractCommands),
            ...inGroup("browser", [
              ...nextFixtureCommands,
              owned.next,
              ...workerPreparationCommands,
              owned.worker,
            ]),
          ],
        };
      }),
    ];
    for (const { mode, phase, preflight, checks } of modePlans) {
      const plan = accessStepPlan({
        mode,
        phase,
        partition: undefined,
        shard: undefined,
      });
      expect(plannedCommands(plan.preflight), `${mode} ${phase}`).toEqual(
        preflight,
      );
      expect(plannedCommands(plan.checks), `${mode} ${phase}`).toEqual(checks);
    }
  });
});
