import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function git(repo, ...args) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}

function withRepo(fn) {
  const repo = mkdtempSync(join(tmpdir(), "rentcottage-precommit-"));
  try {
    mkdirSync(join(repo, ".githooks"), { recursive: true });
    mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
    mkdirSync(join(repo, ".codex", "agents"), { recursive: true });
    mkdirSync(join(repo, "scripts", "lib"), { recursive: true });
    for (const hook of ["pre-commit", "pre-merge-commit"]) {
      const target = join(repo, ".githooks", hook);
      writeFileSync(
        target,
        readFileSync(join(ROOT, ".githooks", hook), "utf8"),
      );
      chmodSync(target, 0o755);
    }
    writeFileSync(
      join(repo, "scripts", "lib", "check-agents.mjs"),
      readFileSync(join(ROOT, "scripts", "lib", "check-agents.mjs"), "utf8"),
    );
    writeFileSync(
      join(repo, ".claude", "agents", "reviewer.md"),
      '---\nname: reviewer\ndescription: "Fixture reviewer"\nmodel: opus\n---\nReview.\n',
    );
    writeFileSync(
      join(repo, ".codex", "agents", "reviewer.toml"),
      'name = "reviewer"\ndescription = "Fixture reviewer"\nmodel = "gpt-fixture"\nmodel_reasoning_effort = "high"\nsandbox_mode = "read-only"\ndeveloper_instructions = """\nReview.\n"""\n',
    );
    git(repo, "init", "-q", "-b", "main");
    git(repo, "add", "-A");
    git(
      repo,
      "-c",
      "user.email=test@example.test",
      "-c",
      "user.name=Test",
      "commit",
      "-q",
      "-m",
      "base",
    );
    fn(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function run(repo, hook) {
  return spawnSync("sh", [join(repo, ".githooks", hook)], {
    cwd: repo,
    encoding: "utf8",
  });
}

test("pre-commit: the agent guard validates the STAGED charters, not the working tree", () => {
  withRepo((repo) => {
    const claude =
      '---\nname: reviewer\ndescription: "Fixture reviewer"\nmodel: opus\n---\nReview harder.\n';
    const codex = (body) =>
      `name = "reviewer"\ndescription = "Fixture reviewer"\nmodel = "gpt-fixture"\nmodel_reasoning_effort = "high"\nsandbox_mode = "read-only"\ndeveloper_instructions = """\n${body}\n"""\n`;
    writeFileSync(join(repo, ".claude", "agents", "reviewer.md"), claude);
    git(repo, "add", ".claude/agents/reviewer.md");
    writeFileSync(
      join(repo, ".codex", "agents", "reviewer.toml"),
      codex("Review harder."),
    );
    const divergent = run(repo, "pre-commit");
    assert.notEqual(divergent.status, 0);
    assert.match(divergent.stderr, /edit the reviewer charters together/);

    git(repo, "add", ".codex/agents/reviewer.toml");
    writeFileSync(
      join(repo, ".codex", "agents", "reviewer.toml"),
      codex("Review."),
    );
    const matching = run(repo, "pre-commit");
    assert.equal(matching.status, 0, matching.stderr);
  });
});

test("pre-merge-commit delegates to pre-commit and accepts a clean staged agent pair", () => {
  withRepo((repo) => {
    writeFileSync(
      join(repo, ".claude", "agents", "reviewer.md"),
      '---\nname: reviewer\ndescription: "Updated fixture"\nmodel: opus\n---\nReview.\n',
    );
    writeFileSync(
      join(repo, ".codex", "agents", "reviewer.toml"),
      'name = "reviewer"\ndescription = "Updated fixture"\nmodel = "gpt-fixture"\nmodel_reasoning_effort = "high"\nsandbox_mode = "read-only"\ndeveloper_instructions = """\nReview.\n"""\n',
    );
    git(
      repo,
      "add",
      ".claude/agents/reviewer.md",
      ".codex/agents/reviewer.toml",
    );
    const result = run(repo, "pre-merge-commit");
    assert.equal(result.status, 0, result.stderr);
  });
});

test("pre-merge-commit delegates to pre-commit and refuses a divergent staged agent pair", () => {
  withRepo((repo) => {
    writeFileSync(
      join(repo, ".claude", "agents", "reviewer.md"),
      '---\nname: reviewer\ndescription: "Updated fixture"\nmodel: opus\n---\nReview harder.\n',
    );
    git(repo, "add", ".claude/agents/reviewer.md");
    const result = run(repo, "pre-merge-commit");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /edit the reviewer charters together/);
  });
});

test("pre-commit refuses a staged validator deletion beside an agent edit", () => {
  withRepo((repo) => {
    writeFileSync(
      join(repo, ".claude", "agents", "reviewer.md"),
      '---\nname: reviewer\ndescription: "Updated fixture"\nmodel: opus\n---\nReview.\n',
    );
    git(repo, "add", ".claude/agents/reviewer.md");
    git(repo, "rm", "-q", "scripts/lib/check-agents.mjs");
    const result = run(repo, "pre-commit");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /staged for deletion/);
  });
});

test("pre-commit fails before a failed temporary allocation can target the live checkout", () => {
  withRepo((repo) => {
    writeFileSync(
      join(repo, ".claude", "agents", "reviewer.md"),
      '---\nname: reviewer\ndescription: "Updated fixture"\nmodel: opus\n---\nReview.\n',
    );
    writeFileSync(
      join(repo, ".codex", "agents", "reviewer.toml"),
      'name = "reviewer"\ndescription = "Updated fixture"\nmodel = "gpt-fixture"\nmodel_reasoning_effort = "high"\nsandbox_mode = "read-only"\ndeveloper_instructions = """\nReview.\n"""\n',
    );
    git(
      repo,
      "add",
      ".claude/agents/reviewer.md",
      ".codex/agents/reviewer.toml",
    );

    const sentinel = join(repo, "live-checkout-sentinel");
    writeFileSync(sentinel, "preserve the live checkout\n");
    const fakeBin = join(repo, "fake-bin");
    mkdirSync(fakeBin);
    const fakeMktemp = join(fakeBin, "mktemp");
    writeFileSync(
      fakeMktemp,
      '#!/bin/sh\nprintf "%s\\n" "$PRECOMMIT_LIVE_CHECKOUT"\nexit 1\n',
    );
    chmodSync(fakeMktemp, 0o755);

    const result = spawnSync("sh", [join(repo, ".githooks", "pre-commit")], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        PRECOMMIT_LIVE_CHECKOUT: repo,
      },
    });

    assert.notEqual(result.status, 0);
    assert.equal(
      existsSync(repo),
      true,
      "the live checkout must remain intact",
    );
    assert.equal(
      readFileSync(sentinel, "utf8"),
      "preserve the live checkout\n",
    );
  });
});
