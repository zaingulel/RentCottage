import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
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

const startCommand = [
  "npx",
  [
    "supabase",
    "start",
    "-x",
    "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
  ],
];
const ownershipCommand = [
  "docker",
  [
    "inspect",
    "supabase_db_rentcottage",
    "--format",
    '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
  ],
];
const resetCommand = ["npx", ["supabase", "db", "reset", "--local"]];
const statusCommand = ["npx", ["supabase", "status", "-o", "json"]];
const stopCommand = ["npx", ["supabase", "stop", "--no-backup"]];
const databasePreflightCommands = [
  ["npx", ["supabase", "test", "db"]],
  [
    "node",
    [
      "scripts/verify-cottage-profile-draft-concurrency.mjs",
      "--verify-migration-preflight",
      "--defer-successful-restore",
    ],
  ],
  [
    "node",
    [
      "scripts/verify-booking-period-hold-concurrency.mjs",
      "--verify-migration-preflight",
    ],
  ],
  [
    "node",
    [
      "scripts/verify-booking-request-lifecycle-upgrade.mjs",
      "--defer-successful-restore",
    ],
  ],
  ["node", ["scripts/verify-booking-request-capture-work-upgrade.mjs"]],
];
const databaseCheckCommands = [
  ["node", ["scripts/verify-access-fixture-contract.mjs"]],
  ["node", ["scripts/prepare-access-test.mjs", "create", "mobile"]],
  ["node", ["scripts/verify-cottage-profile-draft-concurrency.mjs"]],
  ["node", ["scripts/verify-cottage-shift-schedule-concurrency.mjs"]],
  ["node", ["scripts/verify-cottage-inventory-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-period-hold-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-request-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-request-lifecycle-concurrency.mjs"]],
];
const browserCommands = [
  ["node", ["scripts/prepare-access-test.mjs", "create", "mobile", "desktop"]],
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
  ["npm", ["run", "build:worker"]],
  [
    "npx",
    [
      "playwright",
      "test",
      "tests/access.spec.ts",
      "tests/booking-request-access.spec.ts",
      "--project=worker",
      "--config=playwright.worker-prebuilt.config.ts",
      "--workers=1",
      "--output=playwright-report/access-worker",
    ],
  ],
  ["node", ["scripts/verify-booking-request-scheduled-expiry.mjs", "--seed"]],
  [
    "npx",
    [
      "playwright",
      "test",
      "tests/worker-scheduled-expiry.spec.ts",
      "--project=worker",
      "--config=playwright.worker-prebuilt.config.ts",
      "--workers=1",
      "--output=playwright-report/scheduled-expiry-worker",
    ],
  ],
  ["node", ["scripts/verify-booking-request-scheduled-expiry.mjs", "--verify"]],
];

function runUpgradeVerifier(
  script,
  args,
  { failPriorReset = false, failProof = false } = {},
) {
  const fakeBin = mkdtempSync(join(tmpdir(), "rentcottage-upgrade-verifier-"));
  const commandLog = join(fakeBin, "commands.log");
  const npxPath = join(fakeBin, "npx");
  const dockerPath = join(fakeBin, "docker");
  writeFileSync(
    npxPath,
    `#!/bin/sh
printf 'npx %s\\n' "$*" >> "$COMMAND_LOG"
case "$FAIL_PRIOR_RESET:$*" in
  1:*--version*) printf 'forced prior reset failure\\n' >&2; exit 7 ;;
esac
`,
  );
  writeFileSync(
    dockerPath,
    `#!/bin/sh
printf 'docker %s\\n' "$*" >> "$COMMAND_LOG"
if [ "$1" = "inspect" ]; then
  printf '%s|%s\\n' "$SUPABASE_LOCAL_PROJECT" "$PWD"
  exit 0
fi
sql=$(cat)
if [ "$FAIL_PROOF" = "1" ]; then
  case "$sql" in
    *"select max(version)"*|*"owner_application_cottage_profiles where owner_user_id"*)
      printf 'forced proof failure\\n' >&2
      exit 8
      ;;
  esac
fi
case "$sql" in
  *"select max(version)"*) printf '20260822090100\\n' ;;
  *"bool_and(name = 'Preserved private cottage'"*) printf '1|t|1|2\\n' ;;
  *"owner_application_cottage_profiles where owner_user_id"*) printf '21|Preserved private cottage|Private orchard gate|Turn after the old bridge|Preserved description|Preserved rules|1|2\\n' ;;
  *"begin_booking_request_authorization_claim"*) printf '%s\\n' '{"status":"ready","executionPermit":{"claimId":"96000000-0000-4000-8000-000000000633","generation":1,"idempotencyKey":"booking-request:96000000-0000-4000-8000-000000000633:1","notAfter":"2101-01-01T00:00:00.000Z","purpose":"booking-request-authorization"}}' ;;
  *"query_simulated_payment_provider_operation"*"missing-request"*) printf 'RC409\\n' >&2; exit 1 ;;
  *"query_simulated_payment_provider_operation"*) printf '%s\\n' '{"outcome":"not-executed"}' ;;
  *"execute_simulated_payment_provider_operation"*) printf '%s\\n' '{"outcome":"succeeded","providerRequestId":"request","providerReference":"reference","movementReference":"movement","retrySafe":false}' ;;
  *"VERBOSITY verbose"*"create_owner_cottage_profile_draft"*|*"VERBOSITY verbose"*"restore_administrator_cottage_profile_draft"*) printf 'RC420\\n' >&2; exit 1 ;;
esac
`,
  );
  chmodSync(npxPath, 0o755);
  chmodSync(dockerPath, 0o755);

  try {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts", script), ...args],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          COMMAND_LOG: commandLog,
          FAIL_PRIOR_RESET: failPriorReset ? "1" : "0",
          FAIL_PROOF: failProof ? "1" : "0",
          PATH: `${fakeBin}:${process.env.PATH}`,
          SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-verifier-test",
          SUPABASE_LOCAL_PROJECT: "rentcottage-verifier-test",
        },
      },
    );
    return {
      commands: existsSync(commandLog) ? readFileSync(commandLog, "utf8") : "",
      result,
    };
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
}

function ownedRun(
  implementation,
  { project = "rentcottage", workdir = process.cwd() } = {},
) {
  return vi.fn((command, args, options) => {
    if (command === "docker" && args[0] === "inspect") {
      const ownedWorkdir = typeof workdir === "function" ? workdir() : workdir;
      return { status: 0, stdout: `${project}|${ownedWorkdir}\n`, stderr: "" };
    }
    return implementation(command, args, options);
  });
}

function successfulRun({
  project = "rentcottage",
  workdir = process.cwd(),
} = {}) {
  return ownedRun(
    (command, args) => ({
      status: 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }),
    { project, workdir },
  );
}

function commands(run) {
  return run.mock.calls.map(([command, args]) => [command, args]);
}

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
  it("exposes stable standalone database and browser aliases", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

    expect(packageJson.scripts["verify:access"]).toBe(
      "node scripts/verify-access.mjs",
    );
    expect(packageJson.scripts["verify:access:database"]).toBe(
      "node scripts/verify-access.mjs --database",
    );
    expect(packageJson.scripts["verify:access:browser"]).toBe(
      "node scripts/verify-access.mjs --browser",
    );
  });

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
      "Usage: node scripts/verify-cottage-profile-draft-concurrency.mjs [--verify-migration-preflight [--defer-successful-restore]]",
    );
    expect(result.stderr).not.toContain("SUPABASE_URL");
    expect(result.stderr).not.toContain("Docker");
  });

  it.each([
    [
      "verify-cottage-profile-draft-concurrency.mjs",
      ["--defer-successful-restore"],
    ],
    ["verify-booking-request-lifecycle-upgrade.mjs", ["--unexpected"]],
  ])(
    "rejects invalid restore deferral arguments before subprocess work in %s",
    (script, args) => {
      const { commands, result } = runUpgradeVerifier(script, args);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Usage: node scripts/");
      expect(commands).toBe("");
    },
  );

  it.each([
    [
      "verify-cottage-profile-draft-concurrency.mjs",
      ["--verify-migration-preflight"],
    ],
    ["verify-booking-request-lifecycle-upgrade.mjs", []],
  ])(
    "restores the current schema by default after %s succeeds",
    (script, args) => {
      const { commands, result } = runUpgradeVerifier(script, args);

      expect(result.status, result.stderr).toBe(0);
      expect(commands).toContain("npx supabase db reset --local --version");
      expect(commands.match(/npx supabase db reset --local\n/g)).toHaveLength(
        1,
      );
    },
  );

  it.each([
    [
      "verify-cottage-profile-draft-concurrency.mjs",
      ["--verify-migration-preflight", "--defer-successful-restore"],
    ],
    [
      "verify-booking-request-lifecycle-upgrade.mjs",
      ["--defer-successful-restore"],
    ],
  ])(
    "defers only the successful current-schema restore for %s",
    (script, args) => {
      const { commands, result } = runUpgradeVerifier(script, args);

      expect(result.status, result.stderr).toBe(0);
      expect(commands).toContain("npx supabase db reset --local --version");
      expect(commands).not.toMatch(/npx supabase db reset --local\n/);
    },
  );

  it.each([
    [
      "verify-cottage-profile-draft-concurrency.mjs",
      ["--verify-migration-preflight", "--defer-successful-restore"],
    ],
    [
      "verify-booking-request-lifecycle-upgrade.mjs",
      ["--defer-successful-restore"],
    ],
  ])(
    "restores the current schema after %s fails with deferral requested",
    (script, args) => {
      for (const failure of [
        { failPriorReset: true, message: "forced prior reset failure" },
        { failProof: true, message: "forced proof failure" },
      ]) {
        const { commands, result } = runUpgradeVerifier(script, args, failure);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(failure.message);
        expect(commands.match(/npx supabase db reset --local\n/g)).toHaveLength(
          1,
        );
      }
    },
  );

  it("rejects arguments before starting Docker or Supabase", () => {
    const run = vi.fn();
    const stderr = vi.fn();

    expect(main(["unexpected"], { run, stderr })).toBe(2);
    expect(run).not.toHaveBeenCalled();

    expect(main(["--database", "--browser"], { run, stderr })).toBe(2);
    expect(main(["--database", "--database"], { run, stderr })).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs complete database evidence without browser work", () => {
    const run = successfulRun();

    expect(main(["--database"], { environment: {}, run })).toBe(0);

    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      ...databasePreflightCommands,
      statusCommand,
      ...databaseCheckCommands,
      stopCommand,
    ]);
  });

  it("runs complete browser evidence from fresh fixtures without database checks", () => {
    const run = successfulRun();

    expect(main(["--browser"], { environment: {}, run })).toBe(0);

    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      statusCommand,
      ...browserCommands,
      stopCommand,
    ]);
  });

  it("refuses to reset, modify, browse, or stop a foreign local project", () => {
    const run = vi.fn((command, args) => ({
      status: 0,
      stdout:
        command === "docker" && args[0] === "inspect"
          ? "rentcottage|/tmp/another-checkout\n"
          : "",
    }));
    const removeTemp = vi.fn();
    const stderr = vi.fn();

    expect(
      main(["--browser"], {
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
        ],
      ],
      [
        "docker",
        [
          "inspect",
          "supabase_db_rentcottage",
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
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
  });

  it("runs only the public Worker fixture contract in focused disposable mode", () => {
    const run = ownedRun((command, args) => ({
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

    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      statusCommand,
      databaseCheckCommands[0],
      stopCommand,
    ]);
    expect(run.mock.calls[4][2].env).toMatchObject({
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
    const run = ownedRun((command, args) => ({
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

    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      ...databasePreflightCommands,
      statusCommand,
      ...databaseCheckCommands,
      ...browserCommands,
      stopCommand,
    ]);
    expect(run.mock.calls[0][2].env).toMatchObject({
      DOCKER_CONFIG: "/tmp/access-docker",
      DO_NOT_TRACK: "1",
      EXISTING: "kept",
      SUPABASE_TELEMETRY_DISABLED: "1",
    });
    expect(run.mock.calls[1][2]).toMatchObject({
      encoding: "utf8",
      env: {
        DOCKER_CONFIG: "/tmp/access-docker",
        DO_NOT_TRACK: "1",
        EXISTING: "kept",
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
        SUPABASE_TELEMETRY_DISABLED: "1",
      },
      maxBuffer: 1024 * 1024,
    });
    expect(run.mock.calls[1][2]).toHaveProperty("input", undefined);
    expect(run.mock.calls[1][2].env.DOCKER_CONFIG).toBe(
      run.mock.calls[0][2].env.DOCKER_CONFIG,
    );
    expect(run.mock.calls[1][2].env).not.toHaveProperty("SUPABASE_URL");
    expect(run.mock.calls[1][2].env).not.toHaveProperty(
      "SUPABASE_PUBLISHABLE_KEY",
    );
    expect(run.mock.calls[1][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[9][2].env).toMatchObject({
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
    expect(run.mock.calls[10][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: "local-secret",
    });
    expect(run.mock.calls[11][2].env).toMatchObject({
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[11][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[4][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[4][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[5][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[5][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[13][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[13][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[14][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[14][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[15][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[15][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[16][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
      SUPABASE_SECRET_KEY: "local-secret",
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
      APP_ENVIRONMENT: "test",
      NEXTJS_ENV: "test",
      SUPABASE_PROJECT_REF: "local-test",
    });
    expect(run.mock.calls[20][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
    });
    expect(run.mock.calls[21][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
    });
    expect(run.mock.calls[23][2].env).toMatchObject({
      PLAYWRIGHT_SERVER: "worker",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: "local-secret",
      PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
    });
    expect(run.mock.calls[24][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[24][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[25][2].env).toMatchObject({
      PLAYWRIGHT_SERVER: "worker",
      SUPABASE_SECRET_KEY: "local-secret",
    });
    expect(run.mock.calls[26][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[26][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
  });

  it.each([
    { status: 7 },
    { status: null, signal: "SIGTERM" },
    { status: null, error: new Error("build unavailable") },
  ])(
    "blocks prebuilt Worker journeys on a failed build and still cleans up: %j",
    (failure) => {
      const removeTemp = vi.fn();
      const run = ownedRun((command, args) => {
        if (command === "npm" && args.join(" ") === "run build:worker")
          return failure;
        return {
          status: 0,
          stdout:
            args.join(" ") === "supabase status -o json"
              ? localCredentials
              : "",
        };
      });
      expect(
        main(["--browser"], {
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

  it("builds Worker access and scheduled expiry once with the same real local bindings", () => {
    const run = successfulRun();
    expect(main(["--browser"], { environment: {}, run })).toBe(0);
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

  it("creates the mobile Cottage Owner identity before its concurrency proof", () => {
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
        stdout:
          invocation === "npx supabase status -o json" ? localCredentials : "",
      };
    });

    expect(main([], { environment: {}, run })).toBe(0);
    expect(mobileIdentityCreated).toBe(true);
  });

  it("blocks Worker journeys when browser fixture validation fails and still cleans up", () => {
    const removeTemp = vi.fn();
    const run = ownedRun((command, args) => ({
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
      main(["--browser"], {
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
    expect(commands(run)).toContainEqual([
      "docker",
      [
        "inspect",
        "supabase_db_rentcottage-issue-32-v3",
        "--format",
        '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
      ],
    ]);
    expect(run.mock.calls[4][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-issue-32-v3",
      SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-v3",
      SUPABASE_LOCAL_WORKDIR: isolatedWorkdir,
    });
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-state");
  });

  it("preserves a database failure when cleanup also fails", () => {
    const run = ownedRun((command, args) => {
      const invocation = [command, ...args].join(" ");
      return {
        status:
          invocation === "node scripts/verify-booking-request-concurrency.mjs"
            ? 9
            : invocation === "npx supabase stop --no-backup"
              ? 6
              : 0,
        stdout:
          invocation === "npx supabase status -o json" ? localCredentials : "",
      };
    });
    const removeTemp = vi.fn();

    expect(
      main(["--database"], {
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
    expect(
      run.mock.calls.filter(
        ([command, args]) =>
          command === "npx" && args.join(" ") === "supabase stop --no-backup",
      ),
    ).toHaveLength(1);
    expect(run.mock.calls.some(([, args]) => args[0] === "playwright")).toBe(
      false,
    );
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
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
    const run = ownedRun((command, args) => ({
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
    const run = ownedRun((command, args) => ({
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
    const run = ownedRun((command, args) => ({
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
    const run = ownedRun((command, args) => ({
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
