import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { main } from "./verify-access.mjs";
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
});

describe("access verification command", () => {
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
      ["npx", ["supabase", "status", "-o", "json"]],
      ["node", ["scripts/prepare-access-test.mjs"]],
      ["node", ["scripts/verify-cottage-profile-draft-concurrency.mjs"]],
      ["node", ["scripts/verify-cottage-shift-schedule-concurrency.mjs"]],
      ["node", ["scripts/verify-cottage-inventory-concurrency.mjs"]],
      ["node", ["scripts/verify-booking-period-hold-concurrency.mjs"]],
      ["node", ["scripts/prepare-access-test.mjs"]],
      [
        "npx",
        [
          "playwright",
          "test",
          "tests/access.spec.ts",
          "--project=mobile",
          "--project=desktop",
          "--workers=1",
          "--output=playwright-report/access-next",
        ],
      ],
      [
        "npx",
        [
          "playwright",
          "test",
          "tests/access.spec.ts",
          "--project=worker",
          "--workers=1",
          "--output=playwright-report/access-worker",
        ],
      ],
      ["npx", ["supabase", "stop", "--no-backup"]],
    ]);
    expect(run.mock.calls[6][2].env).toMatchObject({
      EXISTING: "kept",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: "local-secret",
      PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
      SUPABASE_TELEMETRY_DISABLED: "1",
      DO_NOT_TRACK: "1",
    });
    expect(run.mock.calls[11][2].env).toMatchObject({
      ACCESS_FIXTURE_VALIDATE_EXISTING: "1",
    });
    expect(run.mock.calls[7][2].env).toMatchObject({
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[7][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
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
    expect(run.mock.calls[9][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[9][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[10][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[10][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[12][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      NEXTJS_ENV: "test",
      SUPABASE_PROJECT_REF: "local-test",
    });
    expect(run.mock.calls[13][2].env).toMatchObject({
      PLAYWRIGHT_SERVER: "worker",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: "local-secret",
      PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
    });
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
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

    expect(main([], { run, stderr })).toBe(1);
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

    expect(main([], { run, stderr })).toBe(1);
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

    expect(main([], { run, stderr })).toBe(1);
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

    expect(main([], { run, stderr })).toBe(6);
    expect(stderr).toHaveBeenCalledWith("Local Supabase cleanup failed.");
  });
});
