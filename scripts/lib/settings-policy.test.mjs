// settings-policy.test.mjs — the agent-shell permission policy in .claude/settings.json.
//
// The allow list is a security policy: every entry runs without a prompt. It must stay the
// three read-mostly board scripts, and the hook set must stay exactly the guards this
// repository documents. A widening lands red here instead of green (security review on #1122).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const settings = JSON.parse(
  readFileSync(resolve(ROOT, ".claude/settings.json"), "utf8"),
);

test("only the board scripts are auto-approved, and nothing is denied by omission", () => {
  assert.deepEqual(settings.permissions.allow, [
    "Bash(node scripts/board.mjs *)",
    "Bash(node scripts/board-move.mjs *)",
    "Bash(node scripts/board-add.mjs *)",
  ]);
  assert.equal(settings.permissions.deny, undefined);
});

test("the hook set is exactly the documented guards", () => {
  const commands = (event, matcher) =>
    (settings.hooks[event] ?? [])
      .filter((h) =>
        matcher === undefined ? h.matcher === undefined : h.matcher === matcher,
      )
      .flatMap((h) => h.hooks.map((hook) => hook.command));
  assert.deepEqual(commands("PreToolUse", "Bash"), [
    'node "$CLAUDE_PROJECT_DIR/.claude/hooks/block-unsafe-git.mjs"',
    'node "$CLAUDE_PROJECT_DIR/.claude/hooks/filter-test-output.mjs"',
  ]);
  assert.deepEqual(commands("PreToolUse", "Agent"), [
    'node "$CLAUDE_PROJECT_DIR/.claude/hooks/check-builder-handoff.mjs"',
  ]);
  assert.deepEqual(commands("Stop"), [
    'sh "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-green.sh"',
  ]);
  assert.deepEqual(Object.keys(settings.hooks).sort(), ["PreToolUse", "Stop"]);
});
