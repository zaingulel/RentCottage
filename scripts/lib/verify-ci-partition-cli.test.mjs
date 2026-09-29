import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("access verification CLI rejects local partitions and invalid shards", () => {
  const cwd = mkdtempSync(join(tmpdir(), "access-partition-cli-"));
  const entry = resolve("scripts/verify-access.mjs");
  try {
    for (const { env, reason } of [
      {
        env: { VERIFY_CI_PARTITION: "next", VERIFY_CI_SHARD: "1/2" },
        reason: /VERIFY_CI_PARTITION.*GITHUB_ACTIONS=true/,
      },
      {
        env: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "next",
          VERIFY_CI_SHARD: "0/2",
        },
        reason: /VERIFY_CI_SHARD.*1\/2 or 2\/2/,
      },
    ]) {
      const result = spawnSync(
        process.execPath,
        ["--permission", "--allow-fs-read=*", entry, "--browser"],
        { cwd, encoding: "utf8", env: { PATH: "", ...env } },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, reason);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
