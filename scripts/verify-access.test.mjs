import { describe, expect, it, vi } from "vitest";

import { main } from "./verify-access.mjs";

const localCredentials = JSON.stringify({
  API_URL: "http://127.0.0.1:54331",
  PUBLISHABLE_KEY: "local-publishable",
  SECRET_KEY: "local-secret",
});

describe("access verification command", () => {
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
        environment: { EXISTING: "kept" },
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
      ["npx", ["supabase", "status", "-o", "json"]],
      ["node", ["scripts/prepare-access-test.mjs"]],
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
        ],
      ],
      ["npx", ["supabase", "stop", "--no-backup"]],
    ]);
    expect(run.mock.calls[4][2].env).toMatchObject({
      EXISTING: "kept",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: "local-secret",
      PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
      SUPABASE_TELEMETRY_DISABLED: "1",
      DO_NOT_TRACK: "1",
    });
    expect(run.mock.calls[5][2].env).toMatchObject({
      ACCESS_FIXTURE_VALIDATE_EXISTING: "1",
    });
    expect(run.mock.calls[6][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      NEXTJS_ENV: "test",
      SUPABASE_PROJECT_REF: "local-test",
    });
    expect(run.mock.calls[7][2].env).toMatchObject({
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
