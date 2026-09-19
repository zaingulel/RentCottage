import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLAUDE_WRAPPER = ".claude/hooks/check-builder-handoff.mjs";
const CODEX_WRAPPER = ".codex/hooks/check-builder-handoff.mjs";

const VALID_ARCHITECT = [
  "Decision: define the runtime hook boundary",
  "Scope: handoff dispatches only",
  "Discovery: inspect current provider payload contracts",
  "Judgment: keep provider mapping outside the validator",
  "Deliverable: a complete bounded implementation plan",
  "Stop condition: return the plan without editing",
].join("\n");

const VALID_BUILDER = [
  "Slice: Enforce runtime handoffs",
  "Claim: both provider wrappers preserve validator outcomes",
  "Construction mode: strict-tdd",
  "Working directory: /tmp/job 310",
  "",
  "Implementation plan:",
  "  Claim 1: map provider fields without rewriting the prompt.",
  "  Claim 2: preserve validator outcomes at the wrapper boundary.",
  "",
  "Files allowed for this claim:",
  "  - scripts/lib/handoff-hook-adapters.mjs",
  "  - .codex/hooks/check-builder-handoff.mjs",
  "",
  "Evidence landing with this claim:",
  "  - Process tests execute both real wrappers.",
  "",
  "Observer: Node's test runner at the public process boundary",
  "Independent oracle: issue 310 and provider hook contracts",
  "Focused verification: node --test scripts/lib/handoff-hooks.test.mjs",
  "Stop condition: focused evidence passes and writing stops",
].join("\n");

const PROVIDERS = [
  {
    name: "Claude",
    script: CLAUDE_WRAPPER,
    payload: (agentType, prompt) => ({
      tool_input: { subagent_type: agentType, prompt },
    }),
  },
  {
    name: "Codex",
    script: CODEX_WRAPPER,
    payload: (agentType, prompt) => ({
      tool_input: { agent_type: agentType, message: prompt },
    }),
  },
];

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(ROOT, relativePath), "utf8"));
}

function runNodeWrapper(relativePath, input) {
  return spawnSync(process.execPath, [resolve(ROOT, relativePath)], {
    cwd: ROOT,
    encoding: "utf8",
    input: typeof input === "string" ? input : JSON.stringify(input),
  });
}

function assertNotValidated(result, secret = "") {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /^Handoff contract NOT validated: /,
  );
  if (secret) {
    assert.doesNotMatch(result.stdout, new RegExp(secret));
    assert.doesNotMatch(result.stderr, new RegExp(secret));
  }
}

test("both real wrappers pass every valid guarded seat without a false success claim", () => {
  for (const provider of PROVIDERS) {
    for (const [agentType, prompt] of [
      ["architect", VALID_ARCHITECT],
      ["builder-lite", VALID_BUILDER],
      ["builder", VALID_BUILDER],
      ["builder-max", VALID_BUILDER],
    ]) {
      const result = runNodeWrapper(
        provider.script,
        provider.payload(agentType, prompt),
      );
      assert.equal(
        result.status,
        0,
        `${provider.name} ${agentType}: ${result.stderr}`,
      );
      assert.equal(result.stdout, "", `${provider.name} ${agentType} stdout`);
      assert.equal(result.stderr, "", `${provider.name} ${agentType} stderr`);
    }
  }
});

test("both real wrappers block readable invalid and empty guarded handoffs without echoing prompts", () => {
  const secret = "PRIVATE-HANDOFF-CONTENT";
  for (const provider of PROVIDERS) {
    for (const prompt of [`Claim: ${secret}`, ""]) {
      const result = runNodeWrapper(
        provider.script,
        provider.payload("builder", prompt),
      );
      assert.equal(result.status, 2, provider.name);
      assert.match(result.stderr, /Handoff rejected:/);
      assert.match(result.stderr, /.agents\/templates\/builder-handoff\.md/);
      assert.equal(result.stdout, "");
      assert.doesNotMatch(result.stderr, new RegExp(secret));
    }
  }
});

test("both real wrappers leave named non-target seats out of scope", () => {
  for (const provider of PROVIDERS) {
    const result = runNodeWrapper(
      provider.script,
      provider.payload("reviewer", "Review the committed diff."),
    );
    assert.equal(result.status, 0, provider.name);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  }
});

test("malformed or structurally unavailable inputs are visibly unvalidated", () => {
  for (const provider of PROVIDERS) {
    const unavailable = [
      "{",
      "null",
      "[]",
      "{}",
      JSON.stringify({ tool_input: {} }),
      JSON.stringify(
        provider.name === "Claude"
          ? { tool_input: { prompt: "secret" } }
          : { tool_input: { message: "secret" } },
      ),
      JSON.stringify(
        provider.name === "Claude"
          ? { tool_input: { subagent_type: "builder" } }
          : { tool_input: { agent_type: "builder" } },
      ),
    ];
    for (const input of unavailable)
      assertNotValidated(runNodeWrapper(provider.script, input), "secret");
  }
});

test("opaque guarded prompts are unvalidated without token echo while short lookalikes are readable rejects", () => {
  const opaque = `gAAAAA${"A".repeat(90)}==`;
  const short = "gAAAAAshort-private-token";
  for (const provider of PROVIDERS) {
    assertNotValidated(
      runNodeWrapper(provider.script, provider.payload("builder", opaque)),
      opaque,
    );

    const readable = runNodeWrapper(
      provider.script,
      provider.payload("builder", short),
    );
    assert.equal(readable.status, 2, provider.name);
    assert.match(readable.stderr, /Handoff rejected:/);
    assert.doesNotMatch(readable.stderr, new RegExp(short));
    assert.equal(readable.stdout, "");
  }
});

test("registrations use exact current synchronous matchers and preserve Claude's existing guard", () => {
  const claude = readJson(".claude/settings.json");
  assert.deepEqual(claude.permissions.allow, [
    "Bash(node scripts/board.mjs *)",
    "Bash(node scripts/board-move.mjs *)",
    "Bash(node scripts/board-add.mjs *)",
    "Bash(npm run verify:board *)",
  ]);
  const claudeGroups = claude.hooks.PreToolUse;
  const bash = claudeGroups.find(({ matcher }) => matcher === "Bash");
  assert.deepEqual(bash, {
    matcher: "Bash",
    hooks: [
      {
        type: "command",
        command:
          'node "$CLAUDE_PROJECT_DIR/.claude/hooks/block-unsafe-git.mjs"',
      },
    ],
  });
  const claudeAgent = claudeGroups.find(({ matcher }) => matcher === "^Agent$");
  assert.equal(claudeAgent.hooks.length, 1);
  assert.equal(claudeAgent.hooks[0].type, "command");
  assert.equal(claudeAgent.hooks[0].async, undefined);
  assert.equal(
    claudeAgent.hooks[0].command,
    'node "$CLAUDE_PROJECT_DIR/.claude/hooks/check-builder-handoff.mjs"',
  );
  assert.equal(new RegExp(claudeAgent.matcher).test("Agent"), true);
  assert.equal(new RegExp(claudeAgent.matcher).test("spawn_agent"), false);

  const codex = readJson(".codex/hooks.json");
  const codexAgent = codex.hooks.PreToolUse.find(
    ({ matcher }) => matcher === "^(spawn_agent|Agent)$",
  );
  assert.equal(codexAgent.hooks.length, 1);
  assert.equal(codexAgent.hooks[0].type, "command");
  assert.equal(codexAgent.hooks[0].async, undefined);
  assert.equal(
    codexAgent.hooks[0].command,
    'node "$(git rev-parse --show-toplevel)/.codex/hooks/check-builder-handoff.mjs"',
  );
  const matcher = new RegExp(codexAgent.matcher);
  assert.equal(matcher.test("spawn_agent"), true);
  assert.equal(matcher.test("Agent"), true);
  assert.equal(matcher.test("collaborationspawn_agent"), false);
  assert.doesNotMatch(JSON.stringify(codex), /collaborationspawn_agent/);
});

test("configured commands execute the real wrappers from a temporary Git checkout whose path contains spaces", () => {
  const checkout = mkdtempSync(
    join(tmpdir(), "rentcottage hook repo with spaces "),
  );
  assert.match(checkout, / /);
  try {
    for (const relativePath of [
      CLAUDE_WRAPPER,
      CODEX_WRAPPER,
      "scripts/lib/handoff-hook-adapters.mjs",
      "scripts/lib/handoff-check.mjs",
    ]) {
      const destination = resolve(checkout, relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(resolve(ROOT, relativePath), destination);
      chmodSync(destination, 0o755);
    }
    const init = spawnSync("git", ["init", "--quiet"], {
      cwd: checkout,
      encoding: "utf8",
    });
    assert.equal(init.status, 0, init.stderr);

    const claudeCommand = readJson(
      ".claude/settings.json",
    ).hooks.PreToolUse.find(({ matcher }) => matcher === "^Agent$").hooks[0]
      .command;
    const codexCommand =
      readJson(".codex/hooks.json").hooks.PreToolUse[0].hooks[0].command;
    const cases = [
      {
        command: claudeCommand,
        env: { ...process.env, CLAUDE_PROJECT_DIR: checkout },
        payload: {
          tool_input: { subagent_type: "architect", prompt: VALID_ARCHITECT },
        },
      },
      {
        command: codexCommand,
        env: process.env,
        payload: {
          tool_input: { agent_type: "architect", message: VALID_ARCHITECT },
        },
      },
    ];
    for (const fixture of cases) {
      const result = spawnSync(fixture.command, [], {
        cwd: checkout,
        encoding: "utf8",
        env: fixture.env,
        input: JSON.stringify(fixture.payload),
        shell: true,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    }
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});
