import assert from "node:assert/strict";
import { test } from "node:test";

import { checkHandoff } from "./handoff-check.mjs";
import {
  checkClaudeHandoff,
  checkCodexHandoff,
  mapClaudeHandoff,
  mapCodexHandoff,
} from "./handoff-hook-adapters.mjs";

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
  "Focused verification: npm run run-log -- issue-310-adapters -- node --test scripts/lib/handoff-hook-adapters.test.mjs",
  "Stop condition: focused evidence passes and writing stops",
].join("\n");

test("Claude maps only subagent_type and prompt without rewriting prompt text", () => {
  const prompt = `${VALID_BUILDER}\nopaque-looking prose remains byte-for-byte: gAAAAAshort`;
  assert.deepEqual(
    mapClaudeHandoff({
      tool_input: {
        subagent_type: "builder",
        prompt,
        ignored: "provider-only",
      },
      ignored: "top-level",
    }),
    { agentType: "builder", prompt },
  );
});

test("Codex maps only agent_type and message without rewriting prompt text", () => {
  const prompt = `${VALID_ARCHITECT}\nAdditional bounded detail.`;
  assert.deepEqual(
    mapCodexHandoff({
      tool_input: {
        agent_type: "architect",
        message: prompt,
        prompt: "wrong provider field",
      },
    }),
    { agentType: "architect", prompt },
  );
});

test("both adapters preserve every shared validator outcome and rejection reason", () => {
  const providers = [
    {
      check: checkClaudeHandoff,
      payload: (agentType, prompt) => ({
        tool_input: { subagent_type: agentType, prompt },
      }),
    },
    {
      check: checkCodexHandoff,
      payload: (agentType, prompt) => ({
        tool_input: { agent_type: agentType, message: prompt },
      }),
    },
  ];

  for (const { check, payload } of providers) {
    for (const [agentType, prompt] of [
      ["architect", VALID_ARCHITECT],
      ["builder-lite", VALID_BUILDER],
      ["builder", VALID_BUILDER],
      ["builder-max", VALID_BUILDER],
      ["reviewer", "Review the committed diff."],
      ["builder", ""],
    ]) {
      assert.deepEqual(
        check(payload(agentType, prompt)),
        checkHandoff({ agentType, prompt }),
        agentType,
      );
    }
  }
});

test("blank or unavailable identity and unavailable prompt are unvalidated", () => {
  const cases = [
    checkClaudeHandoff(null),
    checkClaudeHandoff([]),
    checkClaudeHandoff({}),
    checkClaudeHandoff({
      tool_input: { subagent_type: "  ", prompt: VALID_BUILDER },
    }),
    checkClaudeHandoff({ tool_input: { subagent_type: "builder" } }),
    checkClaudeHandoff({
      tool_input: { subagent_type: "builder", prompt: 42 },
    }),
    checkCodexHandoff(null),
    checkCodexHandoff({
      tool_input: { agent_type: "", message: VALID_BUILDER },
    }),
    checkCodexHandoff({ tool_input: { agent_type: "architect" } }),
  ];
  for (const result of cases) {
    assert.equal(result.outcome, "unvalidated");
    assert.match(result.reason, /unavailable/i);
  }
});

test("only anchored newline-free sufficiently long Fernet-shaped guarded prompts are opaque", () => {
  const opaque = `gAAAAA${"A".repeat(90)}==`;
  for (const check of [checkClaudeHandoff, checkCodexHandoff]) {
    const payload =
      check === checkClaudeHandoff
        ? { tool_input: { subagent_type: "builder", prompt: opaque } }
        : { tool_input: { agent_type: "builder", message: opaque } };
    const result = check(payload);
    assert.equal(result.outcome, "unvalidated");
    assert.match(result.reason, /opaque/i);
    assert.doesNotMatch(result.reason, new RegExp(opaque));
  }

  for (const prompt of [
    "gAAAAAshort",
    `${opaque}\n`,
    `${opaque}\nsecond-line`,
    `prefix-${opaque}`,
  ]) {
    const result = checkCodexHandoff({
      tool_input: { agent_type: "builder", message: prompt },
    });
    assert.equal(result.outcome, "rejected", prompt.slice(0, 20));
  }

  assert.deepEqual(
    checkCodexHandoff({
      tool_input: { agent_type: "reviewer", message: opaque },
    }),
    { outcome: "out-of-scope" },
  );
});
