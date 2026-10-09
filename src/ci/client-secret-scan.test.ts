// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assertNoClientSecret } from "./client-secret-scan";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("client secret scan", () => {
  it("fails when a server credential is present in a client asset", () => {
    const root = mkdtempSync(join(tmpdir(), "rentcottage-secret-scan-"));
    temporaryDirectories.push(root);
    const chunks = join(root, "chunks");
    mkdirSync(chunks);
    writeFileSync(join(chunks, "app.js"), "window.key='server-secret'");

    expect(() => assertNoClientSecret("server-secret", [root])).toThrow(
      /app\.js/,
    );
  });

  it("refuses to scan when given no client asset directory or an empty one", () => {
    const empty = mkdtempSync(join(tmpdir(), "rentcottage-secret-scan-"));
    temporaryDirectories.push(empty);
    const hollow = mkdtempSync(join(tmpdir(), "rentcottage-secret-scan-"));
    temporaryDirectories.push(hollow);
    mkdirSync(join(hollow, "chunks"));

    expect(() => assertNoClientSecret("some-secret", [])).toThrow(
      "Client asset directory is required",
    );
    expect(() => assertNoClientSecret("some-secret", [empty])).toThrow(
      `Client asset directory is empty: ${empty}`,
    );
    expect(() => assertNoClientSecret("some-secret", [hollow])).toThrow(
      `Client asset directory is empty: ${hollow}`,
    );
  });

  it("fails the executable scan when OPENAI_API_KEY reaches a client asset", () => {
    const root = mkdtempSync(join(tmpdir(), "rentcottage-openai-scan-"));
    temporaryDirectories.push(root);
    writeFileSync(join(root, "app.js"), "window.key='openai-server-key'");

    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "src/ci/client-secret-scan.ts", root],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          SUPABASE_SECRET_KEY: "supabase-server-key",
          PRIVILEGED_AUDIT_HMAC_KEY: "audit-server-key",
          OPENAI_API_KEY: "openai-server-key",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Server credential found in client asset/);
    expect(result.stderr).toContain("app.js");
  });
});
