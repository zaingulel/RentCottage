import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const CODEX_GIT_REGISTRATION = `      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \\"$(dirname \\"$(git rev-parse --path-format=absolute --git-common-dir)\\")/.codex/hooks/block-unsafe-git.mjs\\""
          }
        ]
      },`;

const REVIEW_LINE =
  /^Review: tier=(document|code|sign-off) rounds=([1-9]\d*) raised=(0|[1-9]\d*) fixed=(0|[1-9]\d*) dismissed=(0|[1-9]\d*) deferred=(0|[1-9]\d*)[ \t]*\r?$/;

function visibleReviewLines(body) {
  const withoutComments = body.replace(/<!--[\s\S]*?-->/g, "");
  const visible = [];
  let fence = null;
  for (const line of withoutComments.split("\n")) {
    const marker = line.match(/^\s*(```+|~~~+)/)?.[1];
    if (marker) {
      if (fence === null) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence === null) visible.push(line);
  }
  return visible.filter((line) => REVIEW_LINE.test(line));
}

function reviewLineProblems(body) {
  const lines = visibleReviewLines(body);
  if (lines.length !== 1)
    return [`expected exactly one valid review line, found ${lines.length}`];
  const [, , rounds, raised, fixed, dismissed, deferred] =
    lines[0].match(REVIEW_LINE);
  const counts = [rounds, raised, fixed, dismissed, deferred].map(Number);
  return counts[1] === counts[2] + counts[3] + counts[4]
    ? []
    : ["raised must equal fixed + dismissed + deferred"];
}

test("the Codex Bash registration preserves the reference bytes and exactly one handoff registration", () => {
  const source = readFileSync(resolve(ROOT, ".codex/hooks.json"), "utf8");
  assert.equal(source.split(CODEX_GIT_REGISTRATION).length - 1, 1);
  const config = JSON.parse(source);
  const preToolUse = config.hooks.PreToolUse;
  assert.equal(
    preToolUse.filter((entry) => entry.matcher === "Bash").length,
    1,
  );
  assert.equal(
    preToolUse.filter((entry) => entry.matcher === "collaborationspawn_agent")
      .length,
    1,
  );
});

test("the review line requires six ordered fields and settles every raised finding", () => {
  const valid =
    "## Review\nReview: tier=code rounds=2 raised=6 fixed=4 dismissed=1 deferred=1\n";
  assert.deepEqual(reviewLineProblems(valid), []);
  assert.deepEqual(reviewLineProblems(valid.replace("raised=6", "raised=7")), [
    "raised must equal fixed + dismissed + deferred",
  ]);
  assert.match(
    reviewLineProblems(valid.replace("rounds=2", "rounds=0"))[0],
    /found 0/,
  );
  assert.match(
    reviewLineProblems(
      valid.replace("raised=6 fixed=4", "fixed=4 raised=6"),
    )[0],
    /found 0/,
  );
  assert.match(reviewLineProblems(`${valid}${valid}`)[0], /found 2/);
  assert.match(reviewLineProblems(`\`\`\`md\n${valid}\`\`\`\n`)[0], /found 0/);
  assert.match(reviewLineProblems(`<!-- ${valid} -->\n`)[0], /found 0/);
});

test("closeout removes the linked job worktree before deleting its branch", () => {
  const source = readFileSync(
    resolve(ROOT, ".agents/skills/closeout/SKILL.md"),
    "utf8",
  );
  const start = source.indexOf("5. **Branch and worktree.**");
  const end = source.indexOf("6. **Rulings.**", start);
  assert.notEqual(start, -1, "closeout step 5 must exist");
  assert.notEqual(end, -1, "closeout step 6 must follow step 5");
  const cleanup = source.slice(start, end);
  const remove = cleanup.indexOf("git worktree remove <path>");
  const deleteBranch = cleanup.indexOf("git branch -d job/<issue>");
  assert.notEqual(remove, -1, "step 5 must remove the exact linked worktree");
  assert.notEqual(
    deleteBranch,
    -1,
    "step 5 must delete the ordinary local job branch",
  );
  assert.ok(
    remove < deleteBranch,
    "the linked worktree must be removed before branch deletion is attempted",
  );
  assert.match(cleanup, /cannot leave|ownership uncertain/i);
  assert.match(cleanup, /stop before.*branch deletion/is);
  assert.match(cleanup, /never auto-force/i);
});

test("Git permits job branch deletion only after its linked worktree is removed", () => {
  const root = mkdtempSync(join(tmpdir(), "closeout-order-"));
  const worktree = join(root, "job-worktree");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(root, "base.txt"), "base\n");
    git("add", "base.txt");
    git("commit", "-q", "-m", "base");
    git("worktree", "add", "-q", "-b", "job/314", worktree);

    const linked = spawnSync("git", ["branch", "-d", "job/314"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(linked.status, 0);
    assert.match(`${linked.stdout}${linked.stderr}`, /checked out|worktree/i);

    git("worktree", "remove", worktree);
    const unlinked = spawnSync("git", ["branch", "-d", "job/314"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(unlinked.status, 0, unlinked.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
