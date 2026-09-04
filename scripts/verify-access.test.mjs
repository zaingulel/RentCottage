import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { main, prepareIsolatedSupabaseWorkdir } from "./verify-access.mjs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const localCredentials = JSON.stringify({
  API_URL: "http://127.0.0.1:54331",
  PUBLISHABLE_KEY: "local-publishable",
  SECRET_KEY: "local-secret",
});

describe("local Supabase concurrency harness", () => {
  it("fails closed before Docker when the local project identity is invalid", () => {
    const spawnSyncProcess = vi.fn();
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_elsewhere",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).toThrow(
      "The guarded local Supabase database identity is invalid.",
    );
    expect(spawnSyncProcess).not.toHaveBeenCalled();
  });

  it("fails closed when the guarded database container is unavailable", () => {
    const spawnSyncProcess = vi.fn().mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "container unavailable",
    });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).toThrow(
      "The guarded local Supabase database container is unavailable.",
    );
    expect(spawnSyncProcess).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Docker reports a different Supabase project", () => {
    const spawnSyncProcess = vi.fn().mockReturnValue({
      status: 0,
      stdout: "foreign-project|/tmp/rentcottage-worktree\n",
      stderr: "",
    });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).toThrow(
      "The Supabase database container does not belong to this disposable local checkout.",
    );
    expect(spawnSyncProcess).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Docker reports a different Supabase worktree", () => {
    const spawnSyncProcess = vi.fn().mockReturnValue({
      status: 0,
      stdout: "rentcottage|/tmp/foreign-worktree\n",
      stderr: "",
    });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).toThrow(
      "The Supabase database container does not belong to this disposable local checkout.",
    );
    expect(spawnSyncProcess).toHaveBeenCalledTimes(1);
  });

  it("guards the project and worktree before running exact local psql", () => {
    const spawnSyncProcess = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "rentcottage|/tmp/rentcottage-worktree\n",
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: "1\n", stderr: "" });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    harness.guardDisposableLocalDatabase();
    expect(harness.runSql("select 1;")).toBe("1");
    expect(spawnSyncProcess).toHaveBeenNthCalledWith(
      2,
      "docker",
      [
        "exec",
        "-i",
        "supabase_db_rentcottage",
        "psql",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
      expect.objectContaining({ encoding: "utf8", input: "select 1;\n" }),
    );
  });

  it("guards an isolated RentCottage project against its exact container and worktree", () => {
    const spawnSyncProcess = vi.fn().mockReturnValue({
      status: 0,
      stdout: "rentcottage-issue-32-v3|/tmp/rentcottage-issue-32-worktree\n",
      stderr: "",
    });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-issue-32-v3",
        SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-v3",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-issue-32-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).not.toThrow();
    expect(spawnSyncProcess).toHaveBeenCalledWith(
      "docker",
      [
        "inspect",
        "supabase_db_rentcottage-issue-32-v3",
        "--format",
        '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
      ],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });
});

describe("access verification command", () => {
  it("constructs and cleans the real isolated Supabase workdir on success and failure", () => {
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
      expect(readlinkSync(join(workdir, "supabase", "migrations"))).toBe(
        join(workingDirectory, "supabase", "migrations"),
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
      const run = vi.fn((command, args) => ({
        status: command === "npx" && args[1] === "start" ? startStatus : 0,
        stdout:
          command === "npx" && args.includes("status") ? localCredentials : "",
      }));

      expect(
        main([], {
          environment: {
            SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-constructor",
          },
          makeTemp: () => stateRoot,
          prepareProject: prepareIsolatedSupabaseWorkdir,
          run,
          workingDirectory,
        }),
      ).toBe(startStatus);
      expect(existsSync(stateRoot)).toBe(false);
      expect(readFileSync(sourceConfigPath, "utf8")).toBe(sourceConfig);
    }
  });

  it("rejects Cottage Profile verifier arguments before authentication or database access", () => {
    const verifier = resolve(
      process.cwd(),
      "scripts/verify-cottage-profile-draft-concurrency.mjs",
    );
    const result = spawnSync(process.execPath, [verifier, "--unexpected"], {
      encoding: "utf8",
      env: {},
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Usage: node scripts/verify-cottage-profile-draft-concurrency.mjs [--verify-migration-preflight]",
    );
    expect(result.stderr).not.toContain("SUPABASE_URL");
    expect(result.stderr).not.toContain("Docker");
  });

  it("rejects arguments before starting Docker or Supabase", () => {
    const run = vi.fn();
    const stderr = vi.fn();

    expect(main(["unexpected"], { run, stderr })).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs only the public Worker fixture contract in focused disposable mode", () => {
    const run = vi.fn((command, args) => ({
      status: 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));
    const removeTemp = vi.fn();

    expect(
      main(["--fixture-contract"], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
      }),
    ).toBe(0);

    expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      [
        "npx",
        [
          "supabase",
          "start",
          "-x",
          "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
        ],
      ],
      ["npx", ["supabase", "db", "reset", "--local"]],
      ["npx", ["supabase", "status", "-o", "json"]],
      ["node", ["scripts/verify-access-fixture-contract.mjs"]],
      ["npx", ["supabase", "stop", "--no-backup"]],
    ]);
    expect(run.mock.calls[3][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
  });

  it("rejects a malformed local project before creating temp state or starting a subprocess", () => {
    const makeTemp = vi.fn();
    const prepareProject = vi.fn();
    const run = vi.fn();
    const stderr = vi.fn();

    expect(
      main([], {
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

  it("runs database and browser evidence with local credentials then stops", () => {
    const run = vi.fn((command, args) => ({
      status: 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));
    const removeTemp = vi.fn();

    expect(
      main([], {
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

    expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      [
        "npx",
        [
          "supabase",
          "start",
          "-x",
          "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
        ],
      ],
      ["npx", ["supabase", "db", "reset", "--local"]],
      ["npx", ["supabase", "test", "db"]],
      [
        "node",
        [
          "scripts/verify-cottage-profile-draft-concurrency.mjs",
          "--verify-migration-preflight",
        ],
      ],
      [
        "node",
        [
          "scripts/verify-booking-period-hold-concurrency.mjs",
          "--verify-migration-preflight",
        ],
      ],
      ["node", ["scripts/verify-booking-request-lifecycle-upgrade.mjs"]],
      ["node", ["scripts/verify-booking-request-capture-work-upgrade.mjs"]],
      ["npx", ["supabase", "status", "-o", "json"]],
      ["node", ["scripts/verify-access-fixture-contract.mjs"]],
      ["node", ["scripts/prepare-access-test.mjs", "create", "mobile"]],
      ["node", ["scripts/verify-cottage-profile-draft-concurrency.mjs"]],
      ["node", ["scripts/verify-cottage-shift-schedule-concurrency.mjs"]],
      ["node", ["scripts/verify-cottage-inventory-concurrency.mjs"]],
      ["node", ["scripts/verify-booking-period-hold-concurrency.mjs"]],
      [
        "node",
        ["scripts/prepare-access-test.mjs", "create", "mobile", "desktop"],
      ],
      [
        "node",
        ["scripts/prepare-access-test.mjs", "validate", "mobile", "desktop"],
      ],
      [
        "npx",
        [
          "playwright",
          "test",
          "tests/access.spec.ts",
          "tests/booking-request-access.spec.ts",
          "--project=mobile",
          "--project=desktop",
          "--workers=1",
          "--output=playwright-report/access-next",
        ],
      ],
      ["node", ["scripts/prepare-access-test.mjs", "create", "worker"]],
      ["node", ["scripts/prepare-access-test.mjs", "validate", "worker"]],
      [
        "npx",
        [
          "playwright",
          "test",
          "tests/access.spec.ts",
          "tests/booking-request-access.spec.ts",
          "--project=worker",
          "--workers=1",
          "--output=playwright-report/access-worker",
        ],
      ],
      [
        "node",
        ["scripts/verify-booking-request-scheduled-expiry.mjs", "--seed"],
      ],
      [
        "npx",
        [
          "playwright",
          "test",
          "tests/worker-scheduled-expiry.spec.ts",
          "--project=worker",
          "--workers=1",
          "--output=playwright-report/scheduled-expiry-worker",
        ],
      ],
      [
        "node",
        ["scripts/verify-booking-request-scheduled-expiry.mjs", "--verify"],
      ],
      ["node", ["scripts/verify-booking-request-concurrency.mjs"]],
      ["node", ["scripts/verify-booking-request-lifecycle-concurrency.mjs"]],
      ["npx", ["supabase", "stop", "--no-backup"]],
    ]);
    expect(run.mock.calls[8][2].env).toMatchObject({
      EXISTING: "kept",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: "local-secret",
      PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
      SUPABASE_TELEMETRY_DISABLED: "1",
      DO_NOT_TRACK: "1",
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[9][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: "local-secret",
    });
    expect(run.mock.calls[10][2].env).toMatchObject({
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[10][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[3][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[3][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[4][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[4][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[12][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[12][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[13][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[13][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[14][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
    });
    expect(run.mock.calls[15][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
    });
    expect(run.mock.calls[16][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      NEXTJS_ENV: "test",
      SUPABASE_PROJECT_REF: "local-test",
    });
    expect(run.mock.calls[17][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
    });
    expect(run.mock.calls[18][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
    });
    expect(run.mock.calls[19][2].env).toMatchObject({
      PLAYWRIGHT_SERVER: "worker",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: "local-secret",
      PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
    });
    expect(run.mock.calls[20][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[20][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[21][2].env).toMatchObject({
      PLAYWRIGHT_SERVER: "worker",
      SUPABASE_SECRET_KEY: "local-secret",
    });
    expect(run.mock.calls[22][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[22][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
  });

  it("creates the mobile Cottage Owner identity before its concurrency proof", () => {
    let mobileIdentityCreated = false;
    const run = vi.fn((command, args) => {
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
        stdout:
          invocation === "npx supabase status -o json" ? localCredentials : "",
      };
    });

    expect(main([], { environment: {}, run })).toBe(0);
    expect(mobileIdentityCreated).toBe(true);
  });

  it("creates and validates project-scoped browser fixtures at each runtime boundary", () => {
    const run = vi.fn((command, args) => ({
      status: 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));

    expect(main([], { environment: {}, run })).toBe(0);

    const commands = run.mock.calls.map(([command, args]) =>
      [command, ...args].join(" "),
    );
    const fixtureContract = commands.indexOf(
      "node scripts/verify-access-fixture-contract.mjs",
    );
    const createNext = commands.indexOf(
      "node scripts/prepare-access-test.mjs create mobile desktop",
    );
    const validateNext = commands.indexOf(
      "node scripts/prepare-access-test.mjs validate mobile desktop",
    );
    const nextBrowser = commands.indexOf(
      "npx playwright test tests/access.spec.ts tests/booking-request-access.spec.ts --project=mobile --project=desktop --workers=1 --output=playwright-report/access-next",
    );
    const createWorker = commands.indexOf(
      "node scripts/prepare-access-test.mjs create worker",
    );
    const validateWorker = commands.indexOf(
      "node scripts/prepare-access-test.mjs validate worker",
    );
    const workerBrowser = commands.indexOf(
      "npx playwright test tests/access.spec.ts tests/booking-request-access.spec.ts --project=worker --workers=1 --output=playwright-report/access-worker",
    );

    expect(fixtureContract).toBeGreaterThan(-1);
    expect(fixtureContract).toBeLessThan(createNext);
    expect(createNext).toBeLessThan(validateNext);
    expect(validateNext).toBeLessThan(nextBrowser);
    expect(nextBrowser).toBeLessThan(createWorker);
    expect(createWorker).toBeLessThan(validateWorker);
    expect(validateWorker).toBeLessThan(workerBrowser);
  });

  it("blocks Worker journeys when their scoped fixture validation fails and still cleans up", () => {
    const removeTemp = vi.fn();
    const run = vi.fn((command, args) => ({
      status:
        command === "node" &&
        args.join(" ") === "scripts/prepare-access-test.mjs validate worker"
          ? 7
          : 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));

    expect(
      main([], {
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
    expect(run.mock.calls.at(-1).slice(0, 2)).toEqual([
      "npx",
      ["supabase", "stop", "--no-backup"],
    ]);
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
  });

  it("derives the guarded database container from an isolated local project override", () => {
    const isolatedWorkdir = "/tmp/access-state/project";
    const prepareProject = vi.fn(() => isolatedWorkdir);
    const removeTemp = vi.fn();
    const run = vi.fn((command, args) => ({
      status: 0,
      stdout:
        command === "npx" && args[0] === "supabase" && args.includes("status")
          ? localCredentials
          : "",
    }));

    expect(
      main([], {
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
    expect(run.mock.calls[3][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-issue-32-v3",
      SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-v3",
      SUPABASE_LOCAL_WORKDIR: isolatedWorkdir,
    });
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-state");
  });

  it("stops and cleans up after a failed verification step", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 0, stdout: "" })
      .mockReturnValueOnce({ status: 9, stdout: "" })
      .mockReturnValue({ status: 0, stdout: "" });
    const removeTemp = vi.fn();

    expect(
      main([], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
      }),
    ).toBe(9);
    expect(run.mock.calls.at(-1).slice(0, 2)).toEqual([
      "npx",
      ["supabase", "stop", "--no-backup"],
    ]);
    expect(removeTemp).toHaveBeenCalled();
  });

  it("prints captured command output when startup fails", () => {
    const run = vi.fn().mockReturnValue({
      status: 7,
      stdout: "startup details\n",
      stderr: "docker details\n",
    });
    const stderr = vi.fn();

    expect(
      main([], {
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

  it("rejects malformed Supabase credentials before spawning a browser", () => {
    const run = vi.fn((command, args) => ({
      status: 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? JSON.stringify({
              API_URL: {},
              PUBLISHABLE_KEY: [],
              SECRET_KEY: true,
            })
          : "",
    }));
    const stderr = vi.fn();

    expect(main([], { environment: {}, run, stderr })).toBe(1);
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

  it("rejects unreadable Supabase credential output", () => {
    const run = vi.fn((command, args) => ({
      status: 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? "not-json"
          : "",
    }));
    const stderr = vi.fn();

    expect(main([], { environment: {}, run, stderr })).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      "Supabase returned unreadable local test credentials.",
    );
    expect(run.mock.calls.some(([, args]) => args[0] === "playwright")).toBe(
      false,
    );
  });

  it("rejects a non-loopback Supabase API URL", () => {
    const run = vi.fn((command, args) => ({
      status: 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? JSON.stringify({
              API_URL: "https://supabase.example.com",
              PUBLISHABLE_KEY: "local-publishable",
              SECRET_KEY: "local-secret",
            })
          : "",
    }));
    const stderr = vi.fn();

    expect(main([], { environment: {}, run, stderr })).toBe(1);
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

  it("fails when the local services cannot be stopped cleanly", () => {
    const run = vi.fn((command, args) => ({
      status:
        command === "npx" && args.join(" ") === "supabase stop --no-backup"
          ? 6
          : 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));
    const stderr = vi.fn();

    expect(main([], { environment: {}, run, stderr })).toBe(6);
    expect(stderr).toHaveBeenCalledWith("Local Supabase cleanup failed.");
  });
});
