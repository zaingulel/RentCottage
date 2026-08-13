import { describe, expect, it, vi } from "vitest";
import { main, verificationSteps } from "./verify.mjs";

const requiredSteps = [
  ["npm", ["run", "audit:production"]],
  ["npm", ["run", "format:check"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["test"]],
  ["npm", ["run", "build:worker"]],
  ["npm", ["run", "scan:client-secrets"]],
  ["npm", ["run", "cf-typegen"]],
  [
    "git",
    [
      "diff",
      "--exit-code",
      "--ignore-space-at-eol",
      "--",
      "cloudflare-env.d.ts",
    ],
  ],
  ["npm", ["run", "test:browser"]],
  ["npm", ["run", "smoke:preview"]],
];

describe("repository verification command", () => {
  it("rejects arguments before running an external command", () => {
    const run = vi.fn();
    const stderr = vi.fn();

    expect(main(["unexpected"], { run, stderr })).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith("Usage: npm run verify");
  });

  it("keeps every required check in its approved order", () => {
    expect(verificationSteps).toEqual(requiredSteps);
  });

  it("runs every check with safe test bindings", () => {
    const run = vi.fn(() => ({ status: 0 }));
    const expectedEnvironment = {
      EXISTING: "kept",
      APP_ENVIRONMENT: "test",
      NEXTJS_ENV: "test",
      SUPABASE_PROJECT_REF: "local-test",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-test-publishable",
      SUPABASE_SECRET_KEY: "local-test-secret",
    };

    expect(main([], { environment: { EXISTING: "kept" }, run })).toBe(0);
    expect(run).toHaveBeenCalledTimes(requiredSteps.length);
    for (const call of run.mock.calls) {
      expect(call[2]).toEqual(expectedEnvironment);
    }
  });

  it("stops immediately and preserves a failing exit code", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 7 });

    expect(main([], { run })).toBe(7);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("fails loudly when a verification executable cannot start", () => {
    const stderr = vi.fn();
    const run = vi.fn(() => ({
      error: new Error("executable unavailable"),
      status: null,
    }));

    expect(main([], { run, stderr })).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      "Unable to run npm: executable unavailable",
    );
  });
});
