// @vitest-environment node

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
});
