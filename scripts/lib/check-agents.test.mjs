// check-agents.test.mjs — the silent-drop classes the agent-definition guard catches.
// Each blocking case goes green if its rule is removed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAgentSource, checkCodexAgentSource, checkAgentsDir, checkBuilderParity, checkReviewerParity } from './check-agents.mjs';

const GOOD_MD = `---
name: reviewer
description: "Adversarial pre-merge review: correctness, honesty, dead code."
model: opus
effort: xhigh
maxTurns: 90
tools: Read, Glob, Grep, Bash
---
You review the diff.
`;

const GOOD_TOML = `name = "reviewer"
description = "Adversarial pre-merge review"
model = "gpt-5.6-sol"
model_reasoning_effort = "xhigh"
sandbox_mode = "read-only"
developer_instructions = """
You review the diff.
"""
`;

test('a well-formed Claude agent is clean', () => {
  assert.deepEqual(checkAgentSource('reviewer.md', GOOD_MD), []);
});

test('a missing or unclosed frontmatter fence is a named problem', () => {
  assert.match(checkAgentSource('reviewer.md', GOOD_MD.replace(/^---\n/, ''))[0], /no frontmatter fence/);
  assert.match(checkAgentSource('reviewer.md', GOOD_MD.replace(/\n---\nYou/, '\nYou'))[0], /never closes/);
});

test('an unquoted colon inside a plain scalar is the reviewer-vanished bug class', () => {
  const bad = GOOD_MD.replace('description: "Adversarial pre-merge review: correctness, honesty, dead code."', 'description: Adversarial review: correctness');
  assert.match(checkAgentSource('reviewer.md', bad).join('\n'), /unquoted colon/);
});

test('a block scalar may contain colons freely, and a plain key after it is still parsed', () => {
  const block = GOOD_MD.replace('description: "Adversarial pre-merge review: correctness, honesty, dead code."\n', 'description: |\n  Read: the diff first.\n  Then: never review against the description.\ncolor: purple\n');
  assert.deepEqual(checkAgentSource('reviewer.md', block), []);
  // The same colon lines outside a block scalar are the silent-drop class.
  const plain = GOOD_MD.replace('description: "Adversarial pre-merge review: correctness, honesty, dead code."', 'description: Read: the diff first.');
  assert.match(checkAgentSource('reviewer.md', plain).join('\n'), /unquoted colon inside `description:`/);
});

test('an initialPrompt frontmatter key is a named problem: it never reaches a subagent', () => {
  const bad = GOOD_MD.replace('model: opus\n', 'model: opus\ninitialPrompt: "Read the diff first."\n');
  assert.match(checkAgentSource('reviewer.md', bad).join('\n'), /initialPrompt.*never to a subagent/);
});

test('missing required keys, a mismatched name, and unknown model or effort are named', () => {
  assert.match(checkAgentSource('reviewer.md', GOOD_MD.replace('description: "Adversarial pre-merge review: correctness, honesty, dead code."\n', '')).join('\n'), /missing required frontmatter key `description:`/);
  assert.match(checkAgentSource('critic.md', GOOD_MD).join('\n'), /name `reviewer` != filename `critic`/);
  assert.match(checkAgentSource('reviewer.md', GOOD_MD.replace('model: opus', 'model: gpt-9')).join('\n'), /unknown model `gpt-9`/);
  assert.match(checkAgentSource('reviewer.md', GOOD_MD.replace('effort: xhigh', 'effort: extreme')).join('\n'), /unknown effort `extreme`/);
});

test('a well-formed Codex agent is clean', () => {
  assert.deepEqual(checkCodexAgentSource('reviewer.toml', GOOD_TOML), []);
});

test('Codex format failures are named: unclosed block, missing field, bad name, sandbox, unrecognized line', () => {
  assert.match(checkCodexAgentSource('reviewer.toml', GOOD_TOML.replace(/\n"""\n$/, '\n')).join('\n'), /never closes/);
  assert.match(checkCodexAgentSource('reviewer.toml', GOOD_TOML.replace('model = "gpt-5.6-sol"\n', '')).join('\n'), /missing required TOML field `model`/);
  assert.match(checkCodexAgentSource('critic.toml', GOOD_TOML).join('\n'), /name `reviewer` != filename `critic`/);
  assert.match(checkCodexAgentSource('reviewer.toml', `color = "red"\n${GOOD_TOML}`).join('\n'), /unrecognized preamble line/);
  assert.match(checkCodexAgentSource('reviewer.toml', GOOD_TOML.replace('model_reasoning_effort = "xhigh"', 'model_reasoning_effort = "extreme"')).join('\n'), /unknown model_reasoning_effort/);
  assert.match(checkCodexAgentSource('reviewer.toml', GOOD_TOML.replace('sandbox_mode = "read-only"', 'sandbox_mode = "danger-full-access"')).join('\n'), /unknown sandbox_mode/);
  assert.match(checkCodexAgentSource('reviewer.toml', GOOD_TOML.replace('sandbox_mode = "read-only"\n', '')).join('\n'), /missing required TOML field `sandbox_mode`/);
});

test('checkAgentsDir picks the checker by extension and refuses an unchecked directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'check-agents-'));
  try {
    const claude = join(root, 'claude');
    const codex = join(root, 'codex');
    const empty = join(root, 'empty');
    mkdirSync(claude); mkdirSync(codex); mkdirSync(empty);
    writeFileSync(join(claude, 'reviewer.md'), GOOD_MD);
    writeFileSync(join(claude, 'broken.md'), 'no fence here');
    writeFileSync(join(codex, 'reviewer.toml'), GOOD_TOML);
    assert.match(checkAgentsDir(claude).join('\n'), /broken\.md: no frontmatter fence/);
    assert.deepEqual(checkAgentsDir(codex), []);
    assert.match(checkAgentsDir(empty)[0], /contains no \.md or \.toml agent definitions/);
    assert.match(checkAgentsDir(join(root, 'missing'))[0], /cannot be read/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the live registries in this repository are clean', () => {
  assert.deepEqual(checkAgentsDir('.claude/agents'), []);
  assert.deepEqual(checkAgentsDir('.codex/agents'), []);
});

test('live runtime seats pin read-only non-writers, writable builders, and Claude plan mode only for planners', () => {
  const readOnly = ['architect', 'explorer', 'plan-reviewer', 'oracle', 'reviewer', 'security-reviewer'];
  const builders = ['builder-lite', 'builder', 'builder-max'];
  for (const seat of readOnly) {
    const codex = readFileSync(join('.codex/agents', `${seat}.toml`), 'utf8');
    assert.match(codex, /^sandbox_mode = "read-only"$/m, `${seat} must be read-only in Codex`);
  }
  for (const seat of builders) {
    const codex = readFileSync(join('.codex/agents', `${seat}.toml`), 'utf8');
    assert.match(codex, /^sandbox_mode = "workspace-write"$/m, `${seat} must be writable in Codex`);
  }

  const claudeSeats = [...readOnly, ...builders];
  const planMode = new Set(['architect', 'explorer', 'plan-reviewer', 'oracle']);
  for (const seat of claudeSeats) {
    const claude = readFileSync(join('.claude/agents', `${seat}.md`), 'utf8');
    const hasPlan = /^permissionMode: plan$/m.test(claude);
    assert.equal(hasPlan, planMode.has(seat), `${seat} Claude permissionMode`);
  }
});

test('oracle and security-reviewer retain the owner\'s 90-turn cap', () => {
  for (const seat of ['oracle', 'security-reviewer']) {
    const claude = readFileSync(join('.claude/agents', `${seat}.md`), 'utf8');
    assert.match(claude, /^maxTurns: 90$/m, `${seat} turn cap`);
  }
});

// The three builder seats share one body from `Workflow:` down. Mutation: drop the parity call from
// checkAgentsDir (or the function's comparison) and a diverged seat passes the gate silently.
test('the builder seats must share one charter from Workflow: down', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-parity-'));
  const seat = (name, tail) => `---\nname: ${name}\ndescription: x\n---\nintro for ${name}\n\nWorkflow:\n1. shared\n${tail}`;
  writeFileSync(join(dir, 'builder.md'), seat('builder', ''));
  writeFileSync(join(dir, 'builder-max.md'), seat('builder-max', ''));
  writeFileSync(join(dir, 'builder-lite.md'), seat('builder-lite', ''));
  assert.deepEqual(checkBuilderParity(dir), []);
  assert.deepEqual(checkAgentsDir(dir), []);
  writeFileSync(join(dir, 'builder-lite.md'), seat('builder-lite', '2. only here\n'));
  assert.match(checkBuilderParity(dir).join('\n'), /builder-lite\.md: shared builder charter .* differs from builder\.md/);
  assert.equal(checkAgentsDir(dir).length, 1, 'the directory gate carries the parity problem');
  writeFileSync(join(dir, 'builder-lite.md'), '---\nname: builder-lite\ndescription: x\n---\nno workflow marker\n');
  assert.match(checkBuilderParity(dir).join('\n'), /no .Workflow:. line/);
});

test('the real builder seats share one charter', () => {
  assert.deepEqual(checkBuilderParity('.claude/agents'), []);
});

// Both runtimes run one reviewer charter; only the skill sigil differs. Mutation: drop the sigil
// normalisation (the clean pair goes red) or the line comparison (the diverged pair passes silently).
test('the reviewer charter must match across runtimes, sigil aside', () => {
  const root = mkdtempSync(join(tmpdir(), 'reviewer-parity-'));
  try {
    const claude = join(root, 'claude');
    const codex = join(root, 'codex');
    mkdirSync(claude); mkdirSync(codex);
    const body = (sigil, last) => `You review the diff.\n- If math changed, flag that \`${sigil}check-figures\` must run.\n${last}\n`;
    writeFileSync(join(claude, 'reviewer.md'), `---\nname: reviewer\ndescription: x\n---\n${body('/', 'Report findings.')}`);
    writeFileSync(join(codex, 'reviewer.toml'), `name = "reviewer"\ndeveloper_instructions = """\n${body('$', 'Report findings.')}"""\n`);
    assert.deepEqual(checkReviewerParity(claude, codex), []);
    writeFileSync(join(codex, 'reviewer.toml'), `name = "reviewer"\ndeveloper_instructions = """\n${body('$', 'Fix findings.')}"""\n`);
    const [problem, ...rest] = checkReviewerParity(claude, codex);
    assert.deepEqual(rest, []);
    assert.match(problem, /reviewer\.md line 7 differs from .*reviewer\.toml line 5/);
    assert.match(problem, /"Report findings\."; reviewer\.toml: "Fix findings\."/);
    rmSync(join(codex, 'reviewer.toml'));
    assert.match(checkReviewerParity(claude, codex)[0], /reviewer\.toml: reviewer charter is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real reviewer charters match across runtimes', () => {
  assert.deepEqual(checkReviewerParity('.claude/agents', '.codex/agents'), []);
});

// Price tag: recurring cost is two spawned CLI runs over a tiny fixture; retire it if the CLI stops being
// the pre-commit hook's entry point.
// Mutation: drop the CLI's default-run parity call and the diverged run exits 0.
test('the default CLI run refuses diverged reviewer charters', () => {
  const cli = join(dirname(fileURLToPath(import.meta.url)), 'check-agents.mjs');
  const root = mkdtempSync(join(tmpdir(), 'reviewer-cli-'));
  try {
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(root, '.codex', 'agents'), { recursive: true });
    writeFileSync(join(root, '.claude', 'agents', 'reviewer.md'), GOOD_MD.replace('You review the diff.', 'You review the diff.\nRun `/check-figures`.'));
    const codex = (line) => GOOD_TOML.replace('You review the diff.', `${line}\nRun \`$check-figures\`.`);
    writeFileSync(join(root, '.codex', 'agents', 'reviewer.toml'), codex('You review the diff.'));
    assert.equal(spawnSync('node', [cli], { cwd: root, encoding: 'utf8' }).status, 0);
    writeFileSync(join(root, '.codex', 'agents', 'reviewer.toml'), codex('You rewrite the diff.'));
    const diverged = spawnSync('node', [cli], { cwd: root, encoding: 'utf8' });
    assert.equal(diverged.status, 1);
    assert.match(diverged.stderr, /edit the reviewer charters together/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
