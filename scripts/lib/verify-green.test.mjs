import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLAUDE_HOOK = resolve(ROOT, ".claude/hooks/verify-green.sh");
const CODEX_HOOK = resolve(ROOT, ".codex/hooks/verify-green.sh");

function git(dir, ...args) {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}

function withRepository(fn) {
  const scratch = mkdtempSync(join(tmpdir(), "rentcottage-verify-green-"));
  try {
    const root = join(scratch, "repo");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "app.ts"), "export const clean = true;\n");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          lint: 'node -e "const fs=require(\\"fs\\");process.exit(fs.existsSync(\\"src/lint-red\\")?1:0)"',
        },
      }),
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
    fn(root, scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function run(hook, cwd, projectDir, input = "{}") {
  return spawnSync("sh", [hook], {
    cwd,
    encoding: "utf8",
    input,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
}

test("Stop gate: pending src in a linked worktree is linted instead of the clean integration checkout", () => {
  withRepository((root) => {
    const worktree = join(dirname(root), "job");
    git(root, "worktree", "add", "-q", worktree, "-b", "job");
    writeFileSync(join(worktree, "src", "lint-red"), "red\n");
    for (const hook of [CLAUDE_HOOK, CODEX_HOOK]) {
      const result = run(hook, worktree, root);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /npm run lint failed/);
    }
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

test("Stop gate: recursive stop events exit without invoking pending-source lint", () => {
  withRepository((root) => {
    writeFileSync(join(root, "src", "lint-red"), "red\n");
    for (const hook of [CLAUDE_HOOK, CODEX_HOOK]) {
      const result = run(hook, root, root, '{"stop_hook_active":true}');
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
    }
  });
});
