// verify-green.test.mjs — real-shell tests for both runtime Stop gates.
//
// RentCottage's Stop gate is deliberately lint-only: when pending src exists, it distinguishes
// inapplicable, unavailable, clean, and completed-with-findings outcomes without claiming product,
// database, Worker, or browser convergence. These tests execute both tracked wrappers in isolated
// repositories while preserving Claude's project-directory fallback and Codex's cwd resolution.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLAUDE_HOOK = resolve(ROOT, ".claude/hooks/verify-green.sh");
const CODEX_HOOK = resolve(ROOT, ".codex/hooks/verify-green.sh");
const HOOKS = [CLAUDE_HOOK, CODEX_HOOK];

function git(dir, ...args) {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result;
}

function executable(path, source) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function fakeEslint(path) {
  executable(
    path,
    '#!/bin/sh\nprintf "eslint-status-%s-sentinel\\n" "${FAKE_ESLINT_STATUS:-0}" >&2\nexit "${FAKE_ESLINT_STATUS:-0}"\n',
  );
}

function initRepository(scratch) {
  const root = join(scratch, "repo");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.ts"), "export const clean = true;\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ scripts: { lint: "eslint ." } }),
  );
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(
    root,
    "-c",
    "user.email=test@example.test",
    "-c",
    "user.name=Test",
    "commit",
    "-q",
    "-m",
    "base",
  );
  fakeEslint(join(root, "node_modules", ".bin", "eslint"));
  return root;
}

function makePending(root) {
  writeFileSync(join(root, "src", "app.ts"), "export const clean = false;\n");
}

function commandPath(name) {
  const result = spawnSync("/bin/sh", ["-c", `command -v ${name}`], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `fixture requires ${name}`);
  return result.stdout.trim();
}

function pathWithCommands(scratch, label, commands) {
  const bin = join(scratch, label);
  mkdirSync(bin);
  for (const command of commands)
    symlinkSync(commandPath(command), join(bin, command));
  return bin;
}

function run(hook, cwd, projectDir, { input = "{}", env = {} } = {}) {
  return spawnSync("/bin/sh", [hook], {
    cwd,
    encoding: "utf8",
    input,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...env },
  });
}

function withRepository(fn) {
  const scratch = mkdtempSync(
    join(realpathSync(tmpdir()), "rentcottage-verify-green-"),
  );
  try {
    fn(initRepository(scratch), scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

test("Stop gate: pending src in a linked worktree is linted instead of the clean integration checkout", () => {
  withRepository((root, scratch) => {
    const worktree = join(scratch, "job");
    git(root, "worktree", "add", "-q", worktree, "-b", "job");
    fakeEslint(join(scratch, "node_modules", ".bin", "eslint"));
    makePending(worktree);
    for (const hook of HOOKS) {
      const result = run(hook, worktree, root, {
        env: { FAKE_ESLINT_STATUS: "1" },
      });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /lint completed with findings/);
      assert.match(result.stderr, /eslint-status-1-sentinel/);
    }
    assert.equal(git(root, "status", "--porcelain", "--", "src").stdout, "");
  });
});

test("Stop gate: Claude falls back to CLAUDE_PROJECT_DIR outside a Git worktree", () => {
  withRepository((root, scratch) => {
    const outside = join(scratch, "outside");
    mkdirSync(outside);
    const result = run(CLAUDE_HOOK, outside, root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
  });
});

test("Stop gate: no pending src change is inapplicable and silent", () => {
  withRepository((root) => {
    for (const hook of HOOKS) {
      const result = run(hook, root, root);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
    }
  });
});

test("Stop gate: recursive Stop input is inapplicable and silent", () => {
  withRepository((root) => {
    makePending(root);
    for (const hook of HOOKS) {
      const result = run(hook, root, root, {
        input: '{"stop_hook_active":true}',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
    }
  });
});

test("Stop gate: runnable lint succeeds silently", () => {
  withRepository((root) => {
    makePending(root);
    for (const hook of HOOKS) {
      const result = run(hook, root, root);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
    }
  });
});

test("Stop gate: missing Node makes lint explicitly unavailable", () => {
  withRepository((root, scratch) => {
    makePending(root);
    const path = pathWithCommands(scratch, "bin-without-node", [
      "cat",
      "dirname",
      "git",
      "npm",
    ]);
    for (const hook of HOOKS) {
      const result = run(hook, root, root, { env: { PATH: path } });
      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stderr,
        /node is not on PATH.*lint observation is unavailable/,
      );
    }
  });
});

test("Stop gate: missing npm makes lint explicitly unavailable", () => {
  withRepository((root, scratch) => {
    makePending(root);
    const path = pathWithCommands(scratch, "bin-without-npm", [
      "cat",
      "dirname",
      "git",
      "node",
    ]);
    for (const hook of HOOKS) {
      const result = run(hook, root, root, { env: { PATH: path } });
      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stderr,
        /npm is not on PATH.*lint observation is unavailable/,
      );
    }
  });
});

test("Stop gate: a missing lint script makes lint explicitly unavailable", () => {
  withRepository((root) => {
    makePending(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: {} }));
    for (const hook of HOOKS) {
      const result = run(hook, root, root);
      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stderr,
        /package\.json has no declared lint script.*unavailable/,
      );
    }
  });
});

test("Stop gate: malformed package.json blocks and surfaces the parse failure", () => {
  withRepository((root) => {
    makePending(root);
    writeFileSync(join(root, "package.json"), '{"scripts":');
    for (const hook of HOOKS) {
      const result = run(hook, root, root);
      assert.equal(result.status, 2, result.stderr);
      assert.match(
        result.stderr,
        /package\.json could not be read.*lint cannot be trusted/,
      );
      assert.match(
        result.stderr,
        /Invalid package config|Unexpected end of JSON input/,
      );
    }
  });
});

test("Stop gate: a missing installed ESLint executable makes lint explicitly unavailable", () => {
  withRepository((root) => {
    makePending(root);
    rmSync(join(root, "node_modules", ".bin", "eslint"));
    for (const hook of HOOKS) {
      const result = run(hook, root, root);
      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stderr,
        /ESLint executable is unavailable.*lint observation is unavailable/,
      );
    }
  });
});

test("Stop gate: completed lint findings block with the actual ESLint output", () => {
  withRepository((root) => {
    makePending(root);
    for (const hook of HOOKS) {
      const result = run(hook, root, root, {
        env: { FAKE_ESLINT_STATUS: "1" },
      });
      assert.equal(result.status, 2, result.stderr);
      assert.match(
        result.stderr,
        /lint completed with findings\. Fix before finishing/,
      );
      assert.match(result.stderr, /eslint-status-1-sentinel/);
    }
  });
});

test("Stop gate: lint evaluation or configuration failure blocks with the actual output", () => {
  withRepository((root) => {
    makePending(root);
    for (const hook of HOOKS) {
      const result = run(hook, root, root, {
        env: { FAKE_ESLINT_STATUS: "2" },
      });
      assert.equal(result.status, 2, result.stderr);
      assert.match(
        result.stderr,
        /lint failed with exit 2.*Fix the lint configuration or runtime failure/,
      );
      assert.match(result.stderr, /eslint-status-2-sentinel/);
      assert.doesNotMatch(result.stderr, /verified|observation is unavailable/);
    }
  });
});
