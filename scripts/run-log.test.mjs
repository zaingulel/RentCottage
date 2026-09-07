// @vitest-environment node

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const logger = resolve("scripts/run-log.mjs");
const worktrees = [];

function createWorktree() {
  const worktree = mkdtempSync(join(tmpdir(), "rentcottage-run-log-"));
  worktrees.push(worktree);
  return worktree;
}

function receipts(worktree) {
  return readFileSync(join(worktree, ".agent-evidence/runs.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

afterEach(() => {
  for (const worktree of worktrees.splice(0)) {
    rmSync(worktree, { force: true, recursive: true });
  }
});

describe("run receipt command", () => {
  it("runs exact argv without a shell and records a successful receipt", () => {
    const worktree = createWorktree();
    const result = spawnSync(
      process.execPath,
      [
        logger,
        "focused",
        "unit",
        "tests",
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
        "literal;$(not-a-shell)",
      ],
      { cwd: worktree, encoding: "utf8" },
    );

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Run receipt:");
    const [receipt] = receipts(worktree);
    expect(receipt).toMatchObject({
      argv: [
        process.execPath,
        "-e",
        "process.exit(0)",
        "literal;$(not-a-shell)",
      ],
      cwd: realpathSync(worktree),
      label: "focused unit tests",
      result: { kind: "exit", status: 0 },
    });
    expect(Date.parse(receipt.timestamp)).not.toBeNaN();

    const second = spawnSync(
      process.execPath,
      [logger, "second", "run", "--", process.execPath, "-e", ""],
      { cwd: worktree, encoding: "utf8" },
    );
    expect(second.status).toBe(0);
    expect(receipts(worktree)).toHaveLength(2);
  });

  it("propagates a meaningful failing exit status and records it", () => {
    const worktree = createWorktree();
    const result = spawnSync(
      process.execPath,
      [
        logger,
        "expected",
        "red",
        "--",
        process.execPath,
        "-e",
        "process.exit(7)",
      ],
      { cwd: worktree, encoding: "utf8" },
    );

    expect(result.signal).toBeNull();
    expect(result.status).toBe(7);
    expect(receipts(worktree)[0].result).toEqual({ kind: "exit", status: 7 });
  });

  it("distinguishes an executable that cannot start from a meaningful red", () => {
    const worktree = createWorktree();
    const result = spawnSync(
      process.execPath,
      [logger, "missing", "tool", "--", "definitely-not-a-real-command"],
      { cwd: worktree, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unable to start");
    expect(receipts(worktree)[0].result).toMatchObject({
      kind: "spawn-error",
      code: "ENOENT",
    });
  });

  it("records and propagates a child signal", () => {
    const worktree = createWorktree();
    const result = spawnSync(
      process.execPath,
      [
        logger,
        "signalled",
        "run",
        "--",
        process.execPath,
        "-e",
        "process.kill(process.pid, 'SIGTERM')",
      ],
      { cwd: worktree, encoding: "utf8" },
    );

    expect(result.status).toBeNull();
    expect(result.signal).toBe("SIGTERM");
    expect(receipts(worktree)[0].result).toEqual({
      kind: "signal",
      signal: "SIGTERM",
    });
  });

  it("fails loudly when the receipt cannot be saved", () => {
    const worktree = createWorktree();
    writeFileSync(join(worktree, ".agent-evidence"), "blocks directory\n");
    const result = spawnSync(
      process.execPath,
      [logger, "unwritable", "receipt", "--", process.execPath, "-e", ""],
      { cwd: worktree, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unable to save run receipt");

    const failingCommand = spawnSync(
      process.execPath,
      [
        logger,
        "failed command and receipt",
        "--",
        process.execPath,
        "-e",
        "process.exit(7)",
      ],
      { cwd: worktree, encoding: "utf8" },
    );
    expect(failingCommand.status).toBe(7);
  });

  it("propagates a child signal even when its receipt cannot be saved", () => {
    const worktree = createWorktree();
    writeFileSync(join(worktree, ".agent-evidence"), "blocks directory\n");
    const result = spawnSync(
      process.execPath,
      [
        logger,
        "signal and receipt failure",
        "--",
        process.execPath,
        "-e",
        "process.kill(process.pid, 'SIGTERM')",
      ],
      { cwd: worktree, encoding: "utf8" },
    );

    expect(result.stderr).toContain("Unable to save run receipt");
    expect(result.status).toBeNull();
    expect(result.signal).toBe("SIGTERM");
  });

  it("rejects malformed arguments before creating evidence", () => {
    const worktree = createWorktree();
    const result = spawnSync(process.execPath, [logger, "label-only"], {
      cwd: worktree,
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "Usage: node scripts/run-log.mjs <label words> -- <command> [args...]",
    );
    expect(existsSync(join(worktree, ".agent-evidence"))).toBe(false);
  });
});
