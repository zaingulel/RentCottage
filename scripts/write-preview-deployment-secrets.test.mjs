import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  main,
  writePreviewDeploymentSecrets,
} from "./write-preview-deployment-secrets.mjs";

const temporaryDirectories = [];

function targetPath() {
  const directory = mkdtempSync(join(tmpdir(), "muntajaa-preview-secrets-"));
  temporaryDirectories.push(directory);
  return join(directory, "secrets.json");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("preview deployment secret file", () => {
  it("writes only the required JSON secrets with owner-only permissions", () => {
    const target = targetPath();

    writePreviewDeploymentSecrets(target, {
      SUPABASE_SECRET_KEY: 'secret-with-"quotes"',
      PRIVILEGED_AUDIT_HMAC_KEY: "line-one\nline-two-with-32-characters",
    });

    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({
      SUPABASE_SECRET_KEY: 'secret-with-"quotes"',
      PRIVILEGED_AUDIT_HMAC_KEY: "line-one\nline-two-with-32-characters",
    });
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it("fails closed before writing when either secret is absent", () => {
    const target = targetPath();

    expect(() =>
      writePreviewDeploymentSecrets(target, {
        SUPABASE_SECRET_KEY: "present",
        PRIVILEGED_AUDIT_HMAC_KEY: "",
      }),
    ).toThrow("required preview deployment secret is absent");
    expect(() => readFileSync(target)).toThrow();
  });

  it("rejects whitespace-only secrets and an undersized audit key", () => {
    expect(() =>
      writePreviewDeploymentSecrets(targetPath(), {
        SUPABASE_SECRET_KEY: "   ",
        PRIVILEGED_AUDIT_HMAC_KEY: "a".repeat(32),
      }),
    ).toThrow("required preview deployment secret is absent");

    expect(() =>
      writePreviewDeploymentSecrets(targetPath(), {
        SUPABASE_SECRET_KEY: "present",
        PRIVILEGED_AUDIT_HMAC_KEY: "too-short",
      }),
    ).toThrow("audit key must be at least 32 characters");
  });

  it("rejects surrounding whitespace instead of deploying malformed secrets", () => {
    expect(() =>
      writePreviewDeploymentSecrets(targetPath(), {
        SUPABASE_SECRET_KEY: "server-secret\n",
        PRIVILEGED_AUDIT_HMAC_KEY: "a".repeat(32),
      }),
    ).toThrow("must not contain surrounding whitespace");

    expect(() =>
      writePreviewDeploymentSecrets(targetPath(), {
        SUPABASE_SECRET_KEY: "server-secret",
        PRIVILEGED_AUDIT_HMAC_KEY: ` ${"a".repeat(32)}`,
      }),
    ).toThrow("must not contain surrounding whitespace");
  });

  it("reports failure without printing secret values", () => {
    const stderr = vi.fn();
    expect(
      main([targetPath()], {
        source: {
          SUPABASE_SECRET_KEY: "token=secret",
          PRIVILEGED_AUDIT_HMAC_KEY: "",
        },
        stderr,
      }),
    ).toBe(1);
    expect(JSON.stringify(stderr.mock.calls)).not.toContain("token=secret");
  });
});
