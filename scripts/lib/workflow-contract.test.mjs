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

test("the real repository review line has one specified format and the template and skills point at it", () => {
  // Hand-written from the owner-approved format and slot, never extracted from a repo file, so
  // drift in the manual's example or the template cannot silently redefine what the test accepts.
  const REVIEW_LINE =
    /^Review: tier=(document|code|sign-off) rounds=([1-9]\d*) raised=(0|[1-9]\d*) fixed=(0|[1-9]\d*) dismissed=(0|[1-9]\d*) deferred=(0|[1-9]\d*)\s*$/;
  const REVIEW_SLOT =
    "Review: tier= rounds= raised= fixed= dismissed= deferred=";
  const assertValidLine = (line, where) => {
    const match = REVIEW_LINE.exec(line ?? "");
    assert.ok(
      match,
      `${where}: example review line ${JSON.stringify(line)} no longer matches the approved format`,
    );
    assert.equal(
      Number(match[3]),
      Number(match[4]) + Number(match[5]) + Number(match[6]),
      `${where}: example review line has raised not equal to fixed plus dismissed plus deferred`,
    );
  };

  const manual = readFileSync(
    resolve(ROOT, "docs/AI-WORKFLOW.md"),
    "utf8",
  ).split("\n");
  const heading = manual.indexOf("## The review line");
  assert.ok(
    heading >= 0,
    'docs/AI-WORKFLOW.md lost its "## The review line" section',
  );
  const next = manual.findIndex(
    (line, index) => index > heading && line.startsWith("## "),
  );
  const section = manual.slice(heading, next === -1 ? undefined : next);
  const fence = section.indexOf("```");
  assert.ok(
    fence >= 0,
    "the review line section in docs/AI-WORKFLOW.md lost its fenced example",
  );
  assertValidLine(section[fence + 1], "docs/AI-WORKFLOW.md");

  const template = readFileSync(
    resolve(ROOT, ".github/pull_request_template.md"),
    "utf8",
  );
  assertValidLine(
    /for example `([^`]*)`/.exec(template)?.[1],
    ".github/pull_request_template.md",
  );
  assert.deepEqual(
    template.split("\n").filter((line) => REVIEW_LINE.test(line)),
    [],
    "the pull request template has a line a parser would read as a real review line",
  );
  assert.equal(
    template.split("\n").filter((line) => line.trimEnd() === REVIEW_SLOT)
      .length,
    1,
    `the pull request template's review line slot "${REVIEW_SLOT}" is missing, duplicated or reshaped`,
  );
  assert.ok(
    template.includes("docs/AI-WORKFLOW.md"),
    "the pull request template no longer names docs/AI-WORKFLOW.md for the review line format",
  );

  for (const skill of [
    ".agents/skills/resume/SKILL.md",
    ".agents/skills/closeout/SKILL.md",
  ]) {
    assert.ok(
      readFileSync(resolve(ROOT, skill), "utf8").includes(
        "docs/AI-WORKFLOW.md#the-review-line",
      ),
      `${skill} no longer links to docs/AI-WORKFLOW.md#the-review-line`,
    );
  }
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

test("handoff requires explicit owner authorization before remote publication", () => {
  // This assertion comes from the owner-gate rule in AGENTS.md: pushing and pull-request
  // mutations are outward actions, so a request merely to park unfinished work cannot imply them.
  const source = readFileSync(
    resolve(ROOT, ".agents/skills/handoff/SKILL.md"),
    "utf8",
  );
  const publication = source.indexOf("**Push the branch**");
  assert.notEqual(
    publication,
    -1,
    "handoff must retain its branch publication step",
  );

  const authorization = source.search(
    /(?:explicit owner authori[sz]ation|owner explicitly authori[sz]es)[\s\S]{0,240}push[\s\S]{0,240}draft[ -]pull request[\s\S]{0,240}(?:create|update)/i,
  );
  assert.notEqual(
    authorization,
    -1,
    "handoff must require explicit owner authorization for pushing and creating or updating a draft pull request",
  );
  assert.ok(
    authorization < publication,
    "handoff must require publication authorization before pushing the branch",
  );
  assert.match(
    source,
    /bare[\s\S]{0,120}(?:handoff|park)[\s\S]{0,160}only[\s\S]{0,160}(?:local preparation|commit)/i,
    "a bare handoff or park request must be limited to local preparation and commit",
  );
  assert.match(
    source,
    /(?:invocation|request)[\s\S]{0,120}explicitly nam(?:es|ing)[\s\S]{0,160}push[\s\S]{0,160}draft[\s\S]{0,160}satisf(?:ies|y)/i,
    "an invocation that explicitly names push and draft publication must satisfy the authorization gate",
  );

  const resume = readFileSync(
    resolve(ROOT, ".agents/skills/resume/SKILL.md"),
    "utf8",
  );
  const parkingStart = resume.indexOf("## Parking");
  assert.notEqual(parkingStart, -1, "resume must retain its Parking section");
  const parking = resume.slice(parkingStart);
  assert.doesNotMatch(
    parking,
    /commit what exists,\s*push the branch/i,
    "Parking must not retain the unconditional commit-and-push shortcut",
  );
  assert.match(
    parking,
    /bare[\s\S]{0,120}(?:handoff|park)[\s\S]{0,160}does not authori[sz]e remote publication/i,
    "Parking must limit a bare handoff or park request to non-publication work",
  );
  assert.match(
    parking,
    /handoff skill[\s\S]{0,160}explicit publication.authori[sz]ation gate[\s\S]{0,160}before[\s\S]{0,160}(?:push|draft pull-request)/i,
    "Parking must route push and draft pull-request publication through handoff's explicit authorization gate",
  );
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

test("card size is judged by the owner and epics are never picked", () => {
  // These assertions come from card #328's acceptance criteria.
  const read = (path) => readFileSync(resolve(ROOT, path), "utf8");
  const toIssues = read(".agents/skills/to-issues/SKILL.md");
  const resume = read(".agents/skills/resume/SKILL.md");

  assert.match(
    toIssues,
    /one-sentence outcome and its count of outcome or invariant[\s\S]{0,20}statements, flagging any count above five/,
    "every to-issues proposal must show its outcome and statement count",
  );
  assert.match(
    toIssues,
    /single[\s\S]{0,20}captured idea is presented here too/,
    "a single captured idea must be presented to the owner too",
  );
  assert.match(
    toIssues,
    /`type:epic` parent holds no acceptance criteria of its own;[\s\S]{0,40}whole-journey[\s\S]{0,40}end-to-end check becomes its last child,[\s\S]{0,20}blocked by the others/,
    "an epic must hold no criteria and put its whole-journey check in its last child",
  );
  assert.match(
    toIssues,
    /Never name a builder[\s\S]{0,20}seat: the plan chooses one per slice/,
    "to-issues must never name a builder seat",
  );

  assert.match(
    resume,
    /open `type:epic` parent is never a candidate row; its next unblocked child is,\s+and\s+a\s+child\s+with\s+an\s+open\s+blocker\s+is\s+not\s+offered/,
    "work-pick must offer an epic's next unblocked child, never the parent",
  );
  assert.match(
    resume,
    /fragment Card on Issue \{[^}]*parent \{ number \} blockedBy\(first:\d+\) \{ nodes \{ number state \} \}/,
    "the work-pick Card fragment must read each card's parent and blockers",
  );
  assert.match(
    resume,
    /more than three builder slices,[\s\S]{0,20}envelope above about[\s\S]{0,20}1,500 changed lines, goes to the owner[\s\S]{0,20}as a split proposal/,
    "resume must send a plan past the split threshold to the owner",
  );
  assert.match(
    resume,
    /builder handoff's stop condition carries no numeric line cap/,
    "resume must forbid a numeric line cap in builder handoffs",
  );

  assert.match(
    read(".agents/templates/planner-handoff.md"),
    /architect judges too big,[\s\S]{0,20}plan past the split threshold[\s\S]{0,120}goes to the[\s\S]{0,20}owner as a split proposal and is never narrowed or finished inline/,
    "the planner handoff must route an oversized card to the owner",
  );

  for (const path of [
    ".claude/agents/architect.md",
    ".codex/agents/architect.toml",
  ]) {
    assert.match(
      read(path),
      /\*\*build seat\*\*, chosen per builder handoff and stated once when all handoffs share it/,
      `${path} must choose the build seat per builder handoff`,
    );
  }

  assert.match(
    read(".claude/templates/builder-handoff.md"),
    /stop condition never carries a numeric line cap: the builder charter's "roughly doubles the envelope" is[\s\S]{0,20}only size stop/,
    "the builder handoff template must forbid a numeric line cap",
  );
});
