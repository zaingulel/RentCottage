import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { main, prepareIsolatedSupabaseWorkdir } from "./verify-access.mjs";
import {
  browserCommands,
  commands,
  databaseCheckCommands,
  databasePreflightCommands,
  declaredSchemaDiffCommand,
  emptyDeclaredSchemaDiff,
  localCredentials,
  mainWithPreparedProject,
  ownedRun,
  ownershipCommand,
  resetCommand,
  startCommand,
  statusCommand,
  stopCommand,
  successfulRun,
} from "./verify-access-command-doubles.mjs";
import {
  assertProcessObserverReady,
  observeInterruptedAccessVerification,
  processIsAlive,
  stopExactFixtureProcess,
  waitForChildExit,
  waitForCondition,
} from "./verify-access-interruption-observer.mjs";

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

  it("uses real isolated preparation by default without changing the source config", async () => {
    const stateRoot = mkdtempSync(
      join(tmpdir(), "rentcottage-default-verifier-"),
    );
    const sourcePath = join(process.cwd(), "supabase/config.toml");
    const sourceConfig = readFileSync(sourcePath, "utf8");
    const workdir = realpathSync(stateRoot) + "/project";
    const run = vi.fn((command, args) => {
      if (command === "docker")
        return {
          status: 0,
          stdout: `rentcottage-verification|${workdir}\n`,
          stderr: "",
        };
      if (command === "npx" && args[1] === "start") {
        expect(existsSync(join(workdir, "supabase/config.toml"))).toBe(true);
        expect(
          readFileSync(join(workdir, "supabase/config.toml"), "utf8"),
        ).toContain('project_id = "rentcottage-verification"');
      }
      return {
        status: 0,
        stdout:
          command === "npx" && args[1] === "status"
            ? localCredentials
            : command === "npx" && args[2] === "diff"
              ? emptyDeclaredSchemaDiff
              : "",
      };
    });
    try {
      expect(
        await main([], {
          environment: {},
          makeTemp: () => stateRoot,
          run,
        }),
      ).toBe(0);
      for (const [command, args] of run.mock.calls) {
        if (command === "npx" && args[0] === "supabase")
          expect(args.slice(-2)).toEqual(["--workdir", workdir]);
      }
      const concurrency = run.mock.calls.find(
        ([command, args]) =>
          command === "node" &&
          args[0] === "scripts/verify-account-access-concurrency.mjs",
      );
      expect(concurrency).toBeDefined();
      expect(concurrency[2].env).toMatchObject({
        SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-verification",
        SUPABASE_LOCAL_WORKDIR: workdir,
      });
      const browser = run.mock.calls.find(
        ([command, args]) => command === "npx" && args[0] === "playwright",
      );
      expect(browser).toBeDefined();
      expect(browser[2].env).toMatchObject({
        SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-verification",
        SUPABASE_LOCAL_WORKDIR: workdir,
      });
      expect(run.mock.calls.at(-1)[1]).toEqual([
        "supabase",
        "stop",
        "--no-backup",
        "--project-id",
        "rentcottage-verification",
        "--workdir",
        workdir,
      ]);
      expect(existsSync(stateRoot)).toBe(false);
      expect(readFileSync(sourcePath, "utf8")).toBe(sourceConfig);
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it("rejects the root project before any preparation or subprocess", async () => {
    const makeTemp = vi.fn(() => "/tmp/forbidden-root-state");
    const prepareProject = vi.fn(() => "/tmp/forbidden-root-state/project");
    const removeTemp = vi.fn();
    const run = vi.fn(() => ({ status: 1 }));
    expect(
      await main([], {
        environment: { SUPABASE_LOCAL_PROJECT: "rentcottage" },
        makeTemp,
        prepareProject,
        removeTemp,
        run,
        stderr: vi.fn(),
      }),
    ).toBe(2);
    expect(makeTemp).not.toHaveBeenCalled();
    expect(prepareProject).not.toHaveBeenCalled();
    expect(removeTemp).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("cleans the real isolated Supabase workdir on success and retains it after uncertain startup failure", async () => {
    const workingDirectory = process.cwd();
    const sourceConfigPath = join(workingDirectory, "supabase", "config.toml");
    const sourceConfig = readFileSync(sourceConfigPath, "utf8");
    const directState = mkdtempSync(
      join(tmpdir(), "rentcottage-access-workdir-direct-"),
    );
    try {
      const workdir = prepareIsolatedSupabaseWorkdir({
        localProject: "rentcottage-issue-32-constructor",
        stateRoot: directState,
        workingDirectory,
      });
      const generatedConfig = readFileSync(
        join(workdir, "supabase", "config.toml"),
        "utf8",
      );

      expect(generatedConfig).toContain(
        'project_id = "rentcottage-issue-32-constructor"',
      );
      for (const value of [
        "port = 55331",
        "port = 55332",
        "shadow_port = 55330",
        "port = 55339",
        "port = 55333",
        "port = 55334",
        "inspector_port = 8183",
        "port = 55337",
      ]) {
        expect(generatedConfig).toContain(value);
      }
      const generatedOtpSection = generatedConfig.match(
        /\[auth\.sms\.test_otp\]\n([\s\S]*?)(?=\n\[|$)/,
      );
      expect(generatedOtpSection).not.toBeNull();
      const generatedJourneyPhones = [
        ...generatedOtpSection[1].matchAll(/^(96477\d+) = "123456"$/gm),
      ].map((match) => match[1]);
      expect(generatedJourneyPhones).toHaveLength(360);
      expect(new Set(generatedJourneyPhones)).toHaveLength(360);
      expect(generatedJourneyPhones).toContain("9647700000000");
      expect(generatedJourneyPhones).toContain("9647700207104");
      expect(readlinkSync(join(workdir, "supabase", "migrations"))).toBe(
        join(workingDirectory, "supabase", "migrations"),
      );
      expect(readlinkSync(join(workdir, "supabase", "schemas"))).toBe(
        join(workingDirectory, "supabase", "schemas"),
      );
      expect(readlinkSync(join(workdir, "supabase", "tests"))).toBe(
        join(workingDirectory, "supabase", "tests"),
      );
      expect(readFileSync(sourceConfigPath, "utf8")).toBe(sourceConfig);
    } finally {
      rmSync(directState, { recursive: true, force: true });
    }

    for (const startStatus of [0, 7]) {
      const stateRoot = mkdtempSync(
        join(tmpdir(), `rentcottage-access-workdir-${startStatus}-`),
      );
      const run = ownedRun(
        (command, args) => ({
          status: command === "npx" && args[1] === "start" ? startStatus : 0,
          stdout:
            command === "npx" && args.includes("status")
              ? localCredentials
              : "",
        }),
        {
          project: "rentcottage-issue-32-constructor",
          workdir: () => realpathSync(join(stateRoot, "project")),
        },
      );

      try {
        expect(
          await mainWithPreparedProject([], {
            environment: {
              SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-constructor",
            },
            makeTemp: () => stateRoot,
            prepareProject: prepareIsolatedSupabaseWorkdir,
            run,
            workingDirectory,
          }),
        ).toBe(startStatus);
        expect(existsSync(stateRoot)).toBe(startStatus !== 0);
        if (startStatus !== 0)
          expect(
            readFileSync(
              join(stateRoot, "project/supabase/config.toml"),
              "utf8",
            ),
          ).toContain('project_id = "rentcottage-issue-32-constructor"');
        expect(readFileSync(sourceConfigPath, "utf8")).toBe(sourceConfig);
      } finally {
        rmSync(stateRoot, { recursive: true, force: true });
      }
    }
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

  it("reports a public command spawn failure without tracking an invalid process group", async () => {
    const emptyPath = mkdtempSync(join(tmpdir(), "rentcottage-empty-path-"));
    const stderr = [];
    try {
      const wrapper = spawn(
        process.execPath,
        [resolve(process.cwd(), "scripts/verify-access.mjs"), "--database"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PATH: emptyPath,
            SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
            TMPDIR: emptyPath,
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      wrapper.stderr.on("data", (chunk) => stderr.push(String(chunk)));

      expect(await waitForChildExit(wrapper, "spawn-failure wrapper")).toEqual({
        code: 1,
        signal: null,
      });
      expect(stderr.join("")).toContain("Unable to run npx: spawn npx ENOENT");
    } finally {
      rmSync(emptyPath, { recursive: true, force: true });
    }
  });

  it("preserves split UTF-8 command diagnostics", async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "rentcottage-utf8-output-"));
    const npx = join(stateRoot, "npx");
    writeFileSync(
      npx,
      `#!${process.execPath}
process.stdout.write(Buffer.from([0xe2]));
process.stderr.write(Buffer.from([0xd8]));
setTimeout(() => {
  process.stdout.write(Buffer.from([0x82, 0xac, 0x0a]));
  process.stderr.write(Buffer.from([0xb9, 0x0a]));
  process.exit(7);
}, 20);
`,
    );
    chmodSync(npx, 0o755);
    const stderr = [];
    try {
      const wrapper = spawn(
        process.execPath,
        [resolve(process.cwd(), "scripts/verify-access.mjs"), "--database"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PATH: stateRoot,
            SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
            TMPDIR: stateRoot,
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      wrapper.stderr.on("data", (chunk) => stderr.push(String(chunk)));

      expect(await waitForChildExit(wrapper, "UTF-8 wrapper")).toEqual({
        code: 7,
        signal: null,
      });
      expect(stderr.join("")).toContain("€");
      expect(stderr.join("")).toContain("ع");
      expect(stderr.join("")).not.toContain("�");
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it("bounds captured public command output and cleans that exact process", async () => {
    assertProcessObserverReady();
    const stateRoot = mkdtempSync(join(tmpdir(), "rentcottage-output-bound-"));
    const token = basename(stateRoot);
    const npx = join(stateRoot, `npx-${token}`);
    const ready = join(stateRoot, "output.ready");
    writeFileSync(
      npx,
      `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(process.env.OUTPUT_READY, JSON.stringify({ pid: process.pid, token: process.env.OUTPUT_TOKEN }));
process.stdout.write(Buffer.alloc(1024 * 1024 + 1, 97));
setInterval(() => {}, 1000);
`,
    );
    chmodSync(npx, 0o755);
    symlinkSync(npx, join(stateRoot, "npx"));
    const stderr = [];
    try {
      const wrapper = spawn(
        process.execPath,
        [resolve(process.cwd(), "scripts/verify-access.mjs"), "--database"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            OUTPUT_READY: ready,
            OUTPUT_TOKEN: token,
            PATH: stateRoot,
            SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
            TMPDIR: stateRoot,
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      wrapper.stderr.on("data", (chunk) => stderr.push(String(chunk)));

      await waitForCondition(
        () => existsSync(ready),
        "output fixture readiness",
      );
      expect(await waitForChildExit(wrapper, "output-bound wrapper")).toEqual({
        code: 1,
        signal: null,
      });
      const identity = JSON.parse(readFileSync(ready, "utf8"));
      expect(processIsAlive(identity.pid)).toBe(false);
      expect(stderr.join("")).toContain("spawn output exceeded maxBuffer");
    } finally {
      if (existsSync(ready)) {
        await stopExactFixtureProcess(JSON.parse(readFileSync(ready, "utf8")));
      }
      rmSync(stateRoot, { recursive: true, force: true });
    }
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
      const grep =
        phase === "retry-proof"
          ? "a Cottage Owner saves, resumes and submits a complete private application$"
          : "(?:shared sign-in from the homepage returns a prospective owner to their private application|a Cottage Owner saves, resumes and submits a complete private application|Owner Application keeps evidence controls aligned and accessible in every locale|one account returns to customer bookings, enrolls explicitly and signs out only this device)$";
      const retries = phase === "retry-proof" ? "--retries=1" : "--retries=0";
      expect(commands(run)).toEqual([
        startCommand,
        ownershipCommand,
        resetCommand,
        statusCommand,
        ...databaseCheckCommands.slice(0, 2),
        ...browserCommands.slice(0, 2),
        [
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
        ...browserCommands.slice(3, 6),
        [
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

  it("partitions hosted checks without losing setup, coverage or cleanup", async () => {
    const cases = [
      ["--database", "database-core"],
      ["--database", "booking-request"],
      ["--database", "booking-capture"],
      ["--database", "payment-required-expiry"],
      ["--browser", "next", "1/2"],
      ["--browser", "next", "2/2"],
      ["--browser", "worker", "1/2"],
      ["--browser", "worker", "2/2"],
      ["--browser", "scheduled"],
    ];
    const observed = new Map();
    for (const [mode, partition, shard] of cases) {
      const run = successfulRun();
      const removeTemp = vi.fn();
      const output = vi.fn();
      const prepareProject = vi.fn(({ stateRoot }) =>
        join(stateRoot, "project"),
      );
      expect(
        await mainWithPreparedProject([mode], {
          environment: {
            GITHUB_ACTIONS: "true",
            VERIFY_CI_PARTITION: partition,
            ...(shard ? { VERIFY_CI_SHARD: shard } : {}),
          },
          makeTemp: () => "/tmp/access-partition",
          prepareProject,
          removeTemp,
          run,
          stdout: output,
        }),
      ).toBe(0);
      const actual = commands(run);
      expect(actual.slice(0, 3)).toEqual([
        startCommand,
        ownershipCommand,
        resetCommand,
      ]);
      expect(actual.at(-2)).toEqual(ownershipCommand);
      expect(actual.at(-1)).toEqual(stopCommand);
      expect(prepareProject).toHaveBeenCalledWith({
        localProject: "rentcottage-verification",
        stateRoot: "/tmp/access-partition",
        workingDirectory: process.cwd(),
      });
      expect(removeTemp).toHaveBeenCalledWith("/tmp/access-partition");
      expect(
        output.mock.calls.some(([line]) => {
          const record = JSON.parse(line);
          return (
            record.type === "access-partition" &&
            record.evidence === "partial" &&
            record.partition === partition &&
            record.shard === (shard ?? null)
          );
        }),
      ).toBe(true);
      const playwright = run.mock.calls.find(
        ([, args]) =>
          args[0] === "playwright" &&
          args.includes("tests/booking-request-access.spec.ts"),
      );
      if (playwright) {
        expect(playwright[2].env.PLAYWRIGHT_SERVER).toBe(
          partition === "worker" ? "worker" : "next",
        );
        expect(playwright[2].env.NEXTJS_ENV).toBe("test");
      }
      const selectedProgram = run.mock.calls.find(
        ([, args]) =>
          args[0] === "scripts/verify-booking-request-capture-concurrency.mjs",
      );
      if (selectedProgram) {
        expect(selectedProgram[2].env.SUPABASE_SECRET_KEY).toBe("local-secret");
      }
      if (partition === "booking-request") {
        const preparation = run.mock.calls.find(
          ([command, args]) =>
            command === "node" &&
            args.join(" ") ===
              "scripts/prepare-access-test.mjs create mobile worker",
        );
        expect(preparation?.[2].env).toMatchObject({
          APP_ENVIRONMENT: "test",
          SUPABASE_URL: "http://127.0.0.1:54331",
          SUPABASE_PUBLISHABLE_KEY: "local-publishable",
          SUPABASE_SECRET_KEY: "local-secret",
        });
        expect(preparation?.[2].stdio).toBe("inherit");
        const concurrency = run.mock.calls.find(
          ([command, args]) =>
            command === "node" &&
            args[0] === "scripts/verify-booking-request-concurrency.mjs",
        );
        expect(concurrency?.[2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
      }
      for (const [, args, options] of run.mock.calls) {
        if (args[0] === "supabase") {
          expect(args.slice(-2)).toEqual([
            "--workdir",
            "/tmp/access-partition/project",
          ]);
        }
        if (
          args[0] === "playwright" ||
          args[0] === "scripts/prepare-access-test.mjs"
        ) {
          expect(options.stdio).toBe("inherit");
        }
      }
      observed.set(`${partition}:${shard ?? ""}`, actual.slice(3, -2));
    }

    const mobileFixture = [
      "node",
      ["scripts/prepare-access-test.mjs", "create", "mobile"],
    ];
    const bookingRequestFixture = [
      "node",
      ["scripts/prepare-access-test.mjs", "create", "mobile", "worker"],
    ];
    const longPrograms = new Map([
      ["booking-request", "scripts/verify-booking-request-concurrency.mjs"],
      [
        "booking-capture",
        "scripts/verify-booking-request-capture-concurrency.mjs",
      ],
      [
        "payment-required-expiry",
        "scripts/verify-booking-request-payment-required-expiry-concurrency.mjs",
      ],
    ]);
    expect(observed.get("database-core:")).toEqual([
      ...databasePreflightCommands,
      statusCommand,
      ...databaseCheckCommands.filter(
        ([, args]) => ![...longPrograms.values()].includes(args[0]),
      ),
    ]);
    for (const [partition, script] of longPrograms) {
      expect(observed.get(`${partition}:`)).toEqual([
        statusCommand,
        partition === "booking-request" ? bookingRequestFixture : mobileFixture,
        ["node", [script]],
      ]);
    }
    const failedBookingRequestPreparation = ownedRun((command, args) => ({
      status:
        command === "node" &&
        args.join(" ") ===
          "scripts/prepare-access-test.mjs create mobile worker"
          ? 7
          : 0,
      stdout:
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));
    const removeFailedBookingRequestTemp = vi.fn();
    expect(
      await mainWithPreparedProject(["--database"], {
        environment: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "booking-request",
        },
        makeTemp: () => "/tmp/access-booking-request-prerequisite",
        removeTemp: removeFailedBookingRequestTemp,
        run: failedBookingRequestPreparation,
        stderr: vi.fn(),
      }),
    ).toBe(7);
    expect(commands(failedBookingRequestPreparation).at(-3)).toEqual(
      bookingRequestFixture,
    );
    expect(commands(failedBookingRequestPreparation).at(-2)).toEqual(
      ownershipCommand,
    );
    expect(commands(failedBookingRequestPreparation).at(-1)).toEqual(
      stopCommand,
    );
    expect(removeFailedBookingRequestTemp).toHaveBeenCalledWith(
      "/tmp/access-booking-request-prerequisite",
    );
    expect(
      commands(failedBookingRequestPreparation).some(
        ([, args]) =>
          args[0] === "scripts/verify-booking-request-concurrency.mjs",
      ),
    ).toBe(false);
    const databaseUnion = [
      ...observed
        .get("database-core:")
        .slice(databasePreflightCommands.length + 1),
      ...[...longPrograms.keys()].map((partition) =>
        observed.get(`${partition}:`).at(-1),
      ),
    ];
    expect(databaseUnion).toHaveLength(databaseCheckCommands.length);
    expect(
      new Set(databaseUnion.map((entry) => JSON.stringify(entry))),
    ).toEqual(
      new Set(databaseCheckCommands.map((entry) => JSON.stringify(entry))),
    );

    for (const shard of ["1/2", "2/2"]) {
      expect(observed.get(`next:${shard}`)).toEqual([
        statusCommand,
        ...browserCommands.slice(0, 2),
        ["npx", [...browserCommands[2][1], "--list"]],
        ["npx", [...browserCommands[2][1], `--shard=${shard}`]],
      ]);
      expect(observed.get(`worker:${shard}`)).toEqual([
        statusCommand,
        ...browserCommands.slice(3, 6),
        ["npx", [...browserCommands[6][1], "--list"]],
        ["npx", [...browserCommands[6][1], `--shard=${shard}`]],
      ]);
    }
    expect(observed.get("scheduled:")).toEqual([
      statusCommand,
      ...browserCommands.slice(3, 6),
      ...browserCommands.slice(7),
    ]);
    for (const [mode, partition, failedScript] of [
      [
        "--database",
        "booking-capture",
        "scripts/verify-booking-request-capture-concurrency.mjs",
      ],
      [
        "--browser",
        "scheduled",
        "scripts/verify-booking-request-scheduled-expiry.mjs",
      ],
    ]) {
      const run = ownedRun((command, args) => ({
        status: args[0] === failedScript ? 7 : 0,
        stdout:
          command === "npx" &&
          args.slice(0, 4).join(" ") === "supabase status -o json"
            ? localCredentials
            : "",
      }));
      expect(
        await mainWithPreparedProject([mode], {
          environment: {
            GITHUB_ACTIONS: "true",
            VERIFY_CI_PARTITION: partition,
          },
          run,
          stderr: vi.fn(),
        }),
      ).toBe(7);
      expect(commands(run).at(-1)).toEqual(stopCommand);
      expect(commands(run).some(([, args]) => args[0] === failedScript)).toBe(
        true,
      );
    }
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
        browserCommands.at(-2),
        browserCommands.at(-1),
        ownershipCommand,
        stopCommand,
      ]);
      expect(
        lines.filter((line) => line.type === "verification-failure"),
      ).toEqual([
        {
          type: "verification-failure",
          attemptedCommand: ["npx", ...browserCommands.at(-2)[1]],
          reproduceGroup: ["npm", "run", "verify:access:browser"],
        },
      ]);
    }
  });

  it("rejects empty hosted journey selections before sharding and cleans up", async () => {
    for (const partition of ["next", "worker"]) {
      for (const shard of ["1/2", "2/2"]) {
        const run = ownedRun((command, args) => ({
          status:
            command === "npx" &&
            args[0] === "playwright" &&
            args.includes("--list")
              ? 1
              : 0,
          stdout:
            command === "npx" &&
            args.slice(0, 4).join(" ") === "supabase status -o json"
              ? localCredentials
              : "",
        }));
        const removeTemp = vi.fn();
        const stdout = vi.fn();
        expect(
          await mainWithPreparedProject(["--browser"], {
            environment: {
              GITHUB_ACTIONS: "true",
              VERIFY_CI_PARTITION: partition,
              VERIFY_CI_SHARD: shard,
            },
            makeTemp: () => "/tmp/empty-hosted-journeys",
            removeTemp,
            run,
            stdout,
          }),
        ).toBe(1);
        const listed = commands(run).filter(
          ([command, args]) => command === "npx" && args.includes("--list"),
        );
        const journey =
          partition === "next" ? browserCommands[2] : browserCommands[6];
        expect(listed).toEqual([["npx", [...journey[1], "--list"]]]);
        expect(
          commands(run).some(([, args]) => args.includes(`--shard=${shard}`)),
        ).toBe(false);
        expect(commands(run).at(-2)).toEqual(ownershipCommand);
        expect(commands(run).at(-1)).toEqual(stopCommand);
        expect(removeTemp).toHaveBeenCalledWith("/tmp/empty-hosted-journeys");
        expect(stdout).toHaveBeenCalledWith(
          expect.stringContaining('"type":"verification-failure"'),
        );
        expect(stdout).toHaveBeenCalledWith(
          expect.stringContaining('"--list"'),
        );
      }
    }
  });

  it("rejects invalid hosted partition controls before side effects", async () => {
    const cases = [
      {
        args: ["--browser"],
        env: { VERIFY_CI_PARTITION: "next", VERIFY_CI_SHARD: "1/2" },
        reason: "GITHUB_ACTIONS",
      },
      {
        args: [],
        env: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "next",
          VERIFY_CI_SHARD: "1/2",
        },
        reason: "VERIFY_CI_PARTITION",
      },
      {
        args: ["--browser"],
        env: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "next",
          VERIFY_CI_SHARD: "0/2",
        },
        reason: "VERIFY_CI_SHARD",
      },
      {
        args: ["--browser"],
        env: { GITHUB_ACTIONS: "true", VERIFY_CI_PARTITION: "next" },
        reason: "VERIFY_CI_SHARD",
      },
      {
        args: ["--browser"],
        env: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "scheduled",
          VERIFY_CI_SHARD: "1/2",
        },
        reason: "VERIFY_CI_SHARD",
      },
      {
        args: ["--database"],
        env: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "next",
          VERIFY_CI_SHARD: "1/2",
        },
        reason: "VERIFY_CI_PARTITION",
      },
      {
        args: ["--browser"],
        env: { GITHUB_ACTIONS: "true", VERIFY_CI_PARTITION: "unknown" },
        reason: "VERIFY_CI_PARTITION",
      },
      {
        args: ["--browser"],
        env: { GITHUB_ACTIONS: "true", VERIFY_CI_SHARD: "1/2" },
        reason: "VERIFY_CI_PARTITION",
      },
    ];
    for (const { args, env, reason } of cases) {
      const makeTemp = vi.fn();
      const prepareProject = vi.fn();
      const run = vi.fn();
      const stderr = vi.fn();
      expect(
        await main(args, {
          environment: env,
          makeTemp,
          prepareProject,
          run,
          stderr,
        }),
      ).toBe(2);
      expect(stderr.mock.calls.flat().join("\n")).toContain(reason);
      expect(makeTemp).not.toHaveBeenCalled();
      expect(prepareProject).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("refuses to reset, modify, browse, or stop a foreign local project", async () => {
    const run = vi.fn((command, args) => ({
      status: 0,
      stdout:
        command === "docker" && args[0] === "inspect"
          ? "rentcottage-verification|/tmp/another-checkout\n"
          : "",
    }));
    const removeTemp = vi.fn();
    const stderr = vi.fn();

    expect(
      await mainWithPreparedProject(["--browser"], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
        stderr,
        workingDirectory: "/tmp/this-checkout",
      }),
    ).toBe(1);
    expect(commands(run)).toEqual([
      [
        "npx",
        [
          "supabase",
          "start",
          "-x",
          "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
          "--workdir",
          "/tmp/access-docker/project",
        ],
      ],
      [
        "docker",
        [
          "inspect",
          "supabase_db_rentcottage-verification",
          "--format",
          '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
        ],
      ],
    ]);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        "does not belong to this disposable local checkout",
      ),
    );
    expect(removeTemp).not.toHaveBeenCalled();
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
      ...databaseCheckCommands.slice(0, 2),
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

  it("rejects a malformed local project before creating temp state or starting a subprocess", async () => {
    const makeTemp = vi.fn();
    const prepareProject = vi.fn();
    const run = vi.fn();
    const stderr = vi.fn();

    expect(
      await mainWithPreparedProject([], {
        environment: {
          SUPABASE_LOCAL_PROJECT: "rentcottage;docker-rm",
        },
        makeTemp,
        prepareProject,
        run,
        stderr,
      }),
    ).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      "SUPABASE_LOCAL_PROJECT must name a disposable RentCottage local project.",
    );
    expect(makeTemp).not.toHaveBeenCalled();
    expect(prepareProject).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
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
        run.mock.calls.some(([, args]) =>
          args.includes("--config=playwright.worker-prebuilt.config.ts"),
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
    const builds = run.mock.calls.filter(([command]) => command === "npm");
    const workers = run.mock.calls.filter(([, args]) =>
      args.includes("--project=worker"),
    );
    expect(builds).toHaveLength(1);
    expect(builds[0].slice(0, 2)).toEqual(["npm", ["run", "build:worker"]]);
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

  it("derives the guarded database container from an isolated local project override", async () => {
    const isolatedWorkdir = "/tmp/access-state/project";
    const prepareProject = vi.fn(() => isolatedWorkdir);
    const removeTemp = vi.fn();
    const run = ownedRun(
      (command, args) => ({
        status: 0,
        stdout:
          command === "npx" && args[0] === "supabase" && args.includes("status")
            ? localCredentials
            : "",
      }),
      {
        project: "rentcottage-issue-32-v3",
        workdir: isolatedWorkdir,
      },
    );

    expect(
      await mainWithPreparedProject([], {
        environment: {
          SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-v3",
        },
        makeTemp: () => "/tmp/access-state",
        prepareProject,
        removeTemp,
        run,
      }),
    ).toBe(0);

    const supabaseCalls = run.mock.calls.filter(
      ([command, args]) => command === "npx" && args[0] === "supabase",
    );
    expect(supabaseCalls.length).toBeGreaterThan(0);
    expect(supabaseCalls.every(([, args]) => args.includes("--workdir"))).toBe(
      true,
    );
    expect(
      supabaseCalls.every(([, args]) => args.includes(isolatedWorkdir)),
    ).toBe(true);
    expect(commands(run)).toContainEqual([
      "docker",
      [
        "inspect",
        "supabase_db_rentcottage-issue-32-v3",
        "--format",
        '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
      ],
    ]);
    const accountConcurrency = run.mock.calls.find(
      ([command, args]) =>
        command === "node" &&
        args[0] === "scripts/verify-account-access-concurrency.mjs",
    );
    expect(accountConcurrency).toBeDefined();
    expect(accountConcurrency[2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-issue-32-v3",
      SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-v3",
      SUPABASE_LOCAL_WORKDIR: isolatedWorkdir,
    });
    const nextBrowser = run.mock.calls.find(
      ([command, args]) =>
        command === "npx" &&
        args.includes("playwright") &&
        args.includes("--project=mobile"),
    );
    expect(nextBrowser[2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-issue-32-v3",
      SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-v3",
      SUPABASE_LOCAL_WORKDIR: isolatedWorkdir,
    });
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-state");
  });

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

  it("fails and retains the project when ownership changes before cleanup", async () => {
    let inspections = 0;
    const run = vi.fn((command, args, options) => {
      if (command === "docker" && args[0] === "inspect") {
        inspections += 1;
        return {
          status: 0,
          stdout:
            inspections === 1
              ? `rentcottage-verification|${options.env.SUPABASE_LOCAL_WORKDIR}\n`
              : `foreign-project|${process.cwd()}\n`,
          stderr: "",
        };
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
    const stderr = vi.fn();

    expect(
      await mainWithPreparedProject(["--fixture-contract"], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
        stderr,
      }),
    ).toBe(1);
    expect(inspections).toBe(2);
    expect(
      run.mock.calls.some(
        ([command, args]) =>
          command === "npx" &&
          args.slice(0, 3).join(" ") === "supabase stop --no-backup",
      ),
    ).toBe(false);
    expect(removeTemp).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        "Unable to reverify disposable local Supabase ownership before cleanup",
      ),
    );
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("Retained local Supabase project rentcottage"),
    );
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

  it("prints captured command output when startup fails", async () => {
    const run = vi.fn().mockReturnValue({
      status: 7,
      stdout: "startup details\n",
      stderr: "docker details\n",
    });
    const stderr = vi.fn();

    expect(
      await mainWithPreparedProject([], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp: vi.fn(),
        run,
        stderr,
      }),
    ).toBe(7);
    expect(stderr).toHaveBeenCalledWith("startup details");
    expect(stderr).toHaveBeenCalledWith("docker details");
  });

  it("rejects malformed Supabase credentials before spawning a browser", async () => {
    const run = ownedRun((command, args) => ({
      status: 0,
      stdout:
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? JSON.stringify({
              API_URL: {},
              PUBLISHABLE_KEY: [],
              SECRET_KEY: true,
            })
          : "",
    }));
    const stderr = vi.fn();

    expect(
      await mainWithPreparedProject([], { environment: {}, run, stderr }),
    ).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      "Supabase did not return valid local test credentials.",
    );
    expect(run.mock.calls.some(([, args]) => args[0] === "playwright")).toBe(
      false,
    );
    expect(
      run.mock.calls.some(
        ([command, args]) =>
          command === "node" && args[0] === "scripts/prepare-access-test.mjs",
      ),
    ).toBe(false);
  });

  it("rejects unreadable Supabase credential output", async () => {
    const run = ownedRun((command, args) => ({
      status: 0,
      stdout:
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? "not-json"
          : "",
    }));
    const stderr = vi.fn();

    expect(
      await mainWithPreparedProject([], { environment: {}, run, stderr }),
    ).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      "Supabase returned unreadable local test credentials.",
    );
    expect(run.mock.calls.some(([, args]) => args[0] === "playwright")).toBe(
      false,
    );
  });

  it("rejects a non-loopback Supabase API URL", async () => {
    const run = ownedRun((command, args) => ({
      status: 0,
      stdout:
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? JSON.stringify({
              API_URL: "https://supabase.example.com",
              PUBLISHABLE_KEY: "local-publishable",
              SECRET_KEY: "local-secret",
            })
          : "",
    }));
    const stderr = vi.fn();

    expect(
      await mainWithPreparedProject([], { environment: {}, run, stderr }),
    ).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      "Supabase did not return valid local test credentials.",
    );
    expect(run.mock.calls.some(([, args]) => args[0] === "playwright")).toBe(
      false,
    );
    expect(
      run.mock.calls.some(
        ([command, args]) =>
          command === "node" && args[0] === "scripts/prepare-access-test.mjs",
      ),
    ).toBe(false);
  });

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
  it("reports shared access phase costs and the authoritative failing child group", async () => {
    const captureCommand = [
      "node",
      "scripts/verify-booking-request-capture-concurrency.mjs",
    ];
    const nextCommand = [browserCommands[2][0], ...browserCommands[2][1]];
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
          ...databaseCheckCommands.slice(0, 11),
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
          ...browserCommands.slice(0, 3),
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
          databaseCheckCommands[0],
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
