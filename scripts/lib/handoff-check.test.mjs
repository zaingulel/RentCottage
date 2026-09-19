import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkHandoff } from "./handoff-check.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const VALID_ARCHITECT = [
  "Decision: define one shared handoff validator",
  "Scope: prompt structure only",
  "Discovery: inspect the shared role charters and existing templates",
  "Judgment: keep provider payload mapping outside the validator",
  "Deliverable: a file-level implementation plan",
  "Stop condition: return the complete bounded plan",
].join("\n");

const VALID_BUILDER = [
  "Slice: Validate complete builder handoffs",
  "Claim: malformed readable builder handoffs are rejected",
  "Construction mode: strict-tdd",
  "Working directory: /tmp/rentcottage-issue-310",
  "",
  "Implementation plan:",
  "  1. Add a pure validator.",
  "  2. Prove its public outcomes.",
  "",
  "Files allowed for this claim:",
  "  - scripts/lib/handoff-check.mjs",
  "  - scripts/lib/handoff-check.test.mjs",
  "",
  "Evidence landing with this claim:",
  "  - Node test coverage through checkHandoff.",
  "",
  "Observer: Node's test runner calling the public checkHandoff seam",
  "Independent oracle: issue 310 acceptance criteria",
  "Focused verification: node --test scripts/lib/handoff-check.test.mjs",
  "Stop condition: the focused observer passes and writing stops",
].join("\n");

const ARCHITECT_FIELDS = [
  "Decision",
  "Scope",
  "Discovery",
  "Judgment",
  "Deliverable",
  "Stop condition",
];
const BUILDER_SCALAR_FIELDS = [
  "Slice",
  "Claim",
  "Construction mode",
  "Working directory",
  "Observer",
  "Independent oracle",
  "Focused verification",
  "Stop condition",
];
const BUILDER_MULTILINE_FIELDS = [
  "Implementation plan",
  "Files allowed for this claim",
  "Evidence landing with this claim",
];
function assertRejected(result, expectedReason) {
  assert.equal(result.outcome, "rejected");
  assert.match(result.reason, expectedReason);
}

function replaceScalar(prompt, field, value) {
  return prompt
    .split("\n")
    .map((line) =>
      line.startsWith(`${field}:`)
        ? `${field}:${value === "" ? "" : ` ${value}`}`
        : line,
    )
    .join("\n");
}

function removeScalar(prompt, field) {
  return prompt
    .split("\n")
    .filter((line) => !line.startsWith(`${field}:`))
    .join("\n");
}

function replaceMultiline(prompt, field, continuationLines) {
  const lines = prompt.split("\n");
  const start = lines.indexOf(`${field}:`);
  assert.notEqual(start, -1, `fixture contains ${field}`);
  let end = start + 1;
  while (
    end < lines.length &&
    (lines[end].trim() === "" || /^\s/.test(lines[end]))
  )
    end += 1;
  return [
    ...lines.slice(0, start),
    `${field}:`,
    ...continuationLines,
    ...lines.slice(end),
  ].join("\n");
}

function removeMultiline(prompt, field) {
  const lines = prompt.split("\n");
  const start = lines.indexOf(`${field}:`);
  assert.notEqual(start, -1, `fixture contains ${field}`);
  let end = start + 1;
  while (
    end < lines.length &&
    (lines[end].trim() === "" || /^\s/.test(lines[end]))
  )
    end += 1;
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

function filledTemplate(relativePath, values) {
  const source = readFileSync(resolve(ROOT, relativePath), "utf8");
  const marker = "---8<---";
  const prompt = source
    .slice(source.lastIndexOf(marker) + marker.length)
    .trimStart();
  return prompt.replace(
    /{{([A-Z][A-Z0-9_]*)}}/g,
    (slotText, slot, offset, completePrompt) => {
      assert.ok(Object.hasOwn(values, slot), `fixture supplies ${slotText}`);
      const lineStart = completePrompt.lastIndexOf("\n", offset) + 1;
      const prefix = completePrompt.slice(lineStart, offset);
      const continuationIndent = /^[\t ]*$/.test(prefix) ? prefix : "";
      return String(values[slot]).replaceAll("\n", `\n${continuationIndent}`);
    },
  );
}

test("returns explicit outcomes for guarded and out-of-scope seats", () => {
  assert.deepEqual(
    checkHandoff({ agentType: "architect", prompt: VALID_ARCHITECT }),
    {
      outcome: "validated",
    },
  );
  for (const agentType of ["builder-lite", "builder", "builder-max"]) {
    assert.deepEqual(checkHandoff({ agentType, prompt: VALID_BUILDER }), {
      outcome: "validated",
    });
  }
  assert.deepEqual(
    checkHandoff({
      agentType: "reviewer",
      prompt: "Review the committed diff.",
    }),
    {
      outcome: "out-of-scope",
    },
  );
});

test("unavailable normalized input is explicit while readable empty guarded prompts are rejected", () => {
  for (const input of [
    null,
    undefined,
    {},
    { agentType: 42, prompt: VALID_BUILDER },
  ]) {
    assert.equal(checkHandoff(input).outcome, "unvalidated");
  }
  for (const agentType of [
    "architect",
    "builder-lite",
    "builder",
    "builder-max",
  ]) {
    assert.equal(checkHandoff({ agentType }).outcome, "unvalidated");
    assert.equal(
      checkHandoff({ agentType, prompt: 42 }).outcome,
      "unvalidated",
    );
    assertRejected(checkHandoff({ agentType, prompt: "" }), /required field/i);
  }
});

test("every architect field rejects when missing, empty, repeated, or placeholder-filled", () => {
  for (const field of ARCHITECT_FIELDS) {
    assertRejected(
      checkHandoff({
        agentType: "architect",
        prompt: removeScalar(VALID_ARCHITECT, field),
      }),
      new RegExp(field, "i"),
    );
    assertRejected(
      checkHandoff({
        agentType: "architect",
        prompt: replaceScalar(VALID_ARCHITECT, field, ""),
      }),
      new RegExp(field, "i"),
    );
    assertRejected(
      checkHandoff({
        agentType: "architect",
        prompt: `${VALID_ARCHITECT}\n${field}: repeated`,
      }),
      new RegExp(field, "i"),
    );
    for (const placeholder of [
      "...",
      "<describe this field>",
      "TODO",
      "TBD",
      "{{SLOT}}",
    ]) {
      assertRejected(
        checkHandoff({
          agentType: "architect",
          prompt: replaceScalar(VALID_ARCHITECT, field, placeholder),
        }),
        new RegExp(field, "i"),
      );
    }
  }
});

test("every builder scalar field rejects when missing, empty, repeated, or placeholder-filled", () => {
  for (const field of BUILDER_SCALAR_FIELDS) {
    assertRejected(
      checkHandoff({
        agentType: "builder",
        prompt: removeScalar(VALID_BUILDER, field),
      }),
      new RegExp(field, "i"),
    );
    assertRejected(
      checkHandoff({
        agentType: "builder",
        prompt: replaceScalar(VALID_BUILDER, field, ""),
      }),
      new RegExp(field, "i"),
    );
    assertRejected(
      checkHandoff({
        agentType: "builder",
        prompt: `${VALID_BUILDER}\n${field}: repeated`,
      }),
      new RegExp(field, "i"),
    );
    for (const placeholder of [
      "...",
      "<describe this field>",
      "TODO",
      "TBD",
      "{{SLOT}}",
    ]) {
      assertRejected(
        checkHandoff({
          agentType: "builder",
          prompt: replaceScalar(VALID_BUILDER, field, placeholder),
        }),
        new RegExp(field, "i"),
      );
    }
  }
});

test("every builder multiline field rejects when missing, empty, repeated, or entirely placeholder-filled", () => {
  for (const field of BUILDER_MULTILINE_FIELDS) {
    assertRejected(
      checkHandoff({
        agentType: "builder",
        prompt: removeMultiline(VALID_BUILDER, field),
      }),
      new RegExp(field, "i"),
    );
    assertRejected(
      checkHandoff({
        agentType: "builder",
        prompt: replaceMultiline(VALID_BUILDER, field, []),
      }),
      new RegExp(field, "i"),
    );
    assertRejected(
      checkHandoff({
        agentType: "builder",
        prompt: `${VALID_BUILDER}\n${field}:\n  - repeated`,
      }),
      new RegExp(field, "i"),
    );
    for (const placeholder of [
      "...",
      "<describe this field>",
      "TODO",
      "TBD",
      "{{SLOT}}",
    ]) {
      assertRejected(
        checkHandoff({
          agentType: "builder",
          prompt: replaceMultiline(VALID_BUILDER, field, [
            `  - ${placeholder}`,
          ]),
        }),
        new RegExp(field, "i"),
      );
    }
  }
});

test("multiline placeholder rejection applies to the whole value, not one placeholder line", () => {
  const allPlaceholders = replaceMultiline(
    VALID_BUILDER,
    "Evidence landing with this claim",
    ["  - TODO: name the test", "  - <name the observer>", "  - TBD"],
  );
  assertRejected(
    checkHandoff({ agentType: "builder", prompt: allPlaceholders }),
    /Evidence landing.*placeholder/i,
  );

  const partlyFilled = replaceMultiline(
    VALID_BUILDER,
    "Evidence landing with this claim",
    [
      "  - TODO: add the edge case",
      "  - scripts/lib/handoff-check.test.mjs proves the public outcome",
    ],
  );
  assert.deepEqual(
    checkHandoff({ agentType: "builder", prompt: partlyFilled }),
    { outcome: "validated" },
  );
});

test("multiline fields require indented continuations and protect embedded plan labels", () => {
  for (const field of BUILDER_MULTILINE_FIELDS) {
    const inlineValue = VALID_BUILDER.replace(
      `${field}:`,
      `${field}: content on the label line`,
    );
    assertRejected(
      checkHandoff({ agentType: "builder", prompt: inlineValue }),
      new RegExp(`${field}.*continuation`, "i"),
    );
  }

  const unindented = replaceMultiline(VALID_BUILDER, "Implementation plan", [
    "1. Add the validator.",
  ]);
  assertRejected(
    checkHandoff({ agentType: "builder", prompt: unindented }),
    /Implementation plan.*indent/i,
  );

  const accidentalOuterClaim = replaceMultiline(
    VALID_BUILDER,
    "Implementation plan",
    ["Claim: this looks like another outer claim"],
  );
  const accidentalResult = checkHandoff({
    agentType: "builder",
    prompt: accidentalOuterClaim,
  });
  assertRejected(accidentalResult, /Claim.*repeated|repeated.*Claim/i);

  const embeddedClaims = replaceMultiline(
    VALID_BUILDER,
    "Implementation plan",
    [
      "  Claim 1:",
      "    Add the shared parser and focused test.",
      "  Claim: embedded labels stay inside the plan when indented.",
      "  Focused verification: this embedded label is plan content, not an outer field.",
      "  Claim 2:",
      "    Add runtime adapters in a later slice.",
    ],
  );
  assert.deepEqual(
    checkHandoff({ agentType: "builder-max", prompt: embeddedClaims }),
    {
      outcome: "validated",
    },
  );
});

test("remaining template slots are rejected in scalar, multiline, and incidental prose", () => {
  const scalar = replaceScalar(
    VALID_ARCHITECT,
    "Decision",
    "Keep {{DECISION_DETAIL}} in the decision",
  );
  assertRejected(
    checkHandoff({ agentType: "architect", prompt: scalar }),
    /{{DECISION_DETAIL}}/,
  );

  const multiline = replaceMultiline(VALID_BUILDER, "Implementation plan", [
    "  Implement {{UNFILLED_STEP}} after discovery.",
  ]);
  assertRejected(
    checkHandoff({ agentType: "builder", prompt: multiline }),
    /{{UNFILLED_STEP}}/,
  );

  const incidental = `${VALID_BUILDER}\nStanding contract: report {{FINAL_STATE}}.`;
  assertRejected(
    checkHandoff({ agentType: "builder", prompt: incidental }),
    /{{FINAL_STATE}}/,
  );
});

test("one rejection reports several simultaneous defects", () => {
  let malformed = removeScalar(VALID_BUILDER, "Slice");
  malformed = replaceScalar(malformed, "Construction mode", "vibes");
  malformed = replaceScalar(malformed, "Focused verification", "same as above");
  malformed += "\nStop condition: repeated\nIncidental: {{LEFT_OPEN}}";
  const result = checkHandoff({ agentType: "builder", prompt: malformed });
  assert.equal(result.outcome, "rejected");
  for (const fragment of [
    "Slice",
    "Construction mode",
    "Focused verification",
    "Stop condition",
    "{{LEFT_OPEN}}",
  ]) {
    assert.match(
      result.reason,
      new RegExp(fragment.replace(/[{}]/g, "\\$&"), "i"),
    );
  }
});

test("readable rejections name the applicable repository template exactly once", () => {
  const cases = [
    {
      result: checkHandoff({
        agentType: "architect",
        prompt: removeScalar(VALID_ARCHITECT, "Decision"),
      }),
      template: ".agents/templates/planner-handoff.md",
    },
    {
      result: checkHandoff({
        agentType: "builder",
        prompt: removeScalar(VALID_BUILDER, "Claim"),
      }),
      template: ".agents/templates/builder-handoff.md",
    },
  ];

  for (const { result, template } of cases) {
    assert.equal(result.outcome, "rejected");
    assert.equal(result.reason.split(template).length - 1, 1, template);
  }
});

test("construction mode accepts only the three exact testing-strategy values", () => {
  for (const mode of ["strict-tdd", "evidence-required", "preservation"]) {
    const prompt = replaceScalar(VALID_BUILDER, "Construction mode", mode);
    assert.equal(
      checkHandoff({ agentType: "builder", prompt }).outcome,
      "validated",
    );
  }
  for (const mode of [
    "Strict-TDD",
    "strict-tdd with tests",
    "strict-tdd evidence-required",
    "preserve",
  ]) {
    const prompt = replaceScalar(VALID_BUILDER, "Construction mode", mode);
    assertRejected(
      checkHandoff({ agentType: "builder", prompt }),
      /Construction mode.*exactly/i,
    );
  }
});

test("focused verification accepts concrete direct and run-log observer commands", () => {
  const commands = [
    "node --test scripts/lib/handoff-check.test.mjs",
    "NODE_OPTIONS='--conditions react-server' node --test \"scripts/lib/handoff-check.test.mjs\"",
    "npx vitest run src/example.test.ts --retry=0",
    "CI=1 npx playwright test tests/example.spec.ts --project=desktop --retries=0",
    "npm run run-log -- issue-310-validator -- node --test scripts/lib/handoff-check.test.mjs",
    "CI=1 npm run run-log -- issue 310 validator -- NODE_OPTIONS=--trace-warnings node --test scripts/lib/handoff-check.test.mjs",
  ];
  for (const command of commands) {
    const prompt = replaceScalar(
      VALID_BUILDER,
      "Focused verification",
      command,
    );
    assert.equal(
      checkHandoff({ agentType: "builder", prompt }).outcome,
      "validated",
      command,
    );
  }
});

test("focused verification rejects prose, references, placeholders, and observer commands without arguments", () => {
  const invalid = [
    "same as above",
    "run the focused tests",
    "npm test",
    "node --test",
    "npx vitest run",
    "npx playwright test",
    "npm run run-log -- issue-310-validator -- node --test",
    "<exact command>",
    "TODO",
  ];
  for (const command of invalid) {
    const prompt = replaceScalar(
      VALID_BUILDER,
      "Focused verification",
      command,
    );
    assertRejected(
      checkHandoff({ agentType: "builder", prompt }),
      /Focused verification/i,
    );
  }
});

test("positive builder-owned mutation, revert, or restore testing instructions are rejected", () => {
  const forbidden = [
    "Builder: mutate the validation rule, run the observer, restore the implementation, and rerun it.",
    "Deliberately revert the check and rerun the test before returning.",
    "You must prove mutation sensitivity by changing the implementation.",
    "Perform the mutation test and restore the source.",
  ];
  for (const instruction of forbidden) {
    const result = checkHandoff({
      agentType: "builder-max",
      prompt: `${VALID_BUILDER}\n${instruction}`,
    });
    assertRejected(result, /mutation.*coordinator|coordinator.*mutation/i);
  }
});

test("coordinator-owned, negated, and benign mutation wording remains valid", () => {
  const allowed = [
    "Coordinator-only after the writer stops: mutate one rule, run the observer red, restore it, and rerun green.",
    "Do not mutate, revert, or restore the implementation.",
    "The coordinator owns mutation testing and restoration.",
    "Land a mutation-proven test with the change.",
    "The test must be mutation-proven.",
  ];
  for (const instruction of allowed) {
    const result = checkHandoff({
      agentType: "builder-lite",
      prompt: `${VALID_BUILDER}\n${instruction}`,
    });
    assert.deepEqual(result, { outcome: "validated" }, instruction);
  }
});

test("the real filled planner template validates for architect", () => {
  const prompt = filledTemplate(".agents/templates/planner-handoff.md", {
    DECISION: "choose the shared validator boundary",
    SCOPE: "architect and builder handoff structure",
    DISCOVERY:
      "read the hook payload contracts, role charters, and existing builder template",
    JUDGMENT: "keep provider mapping outside the pure structure validator",
    DELIVERABLE: "a complete implementation plan with bounded claims",
    STOP_CONDITION: "return the full plan without editing",
  });
  assert.deepEqual(checkHandoff({ agentType: "architect", prompt }), {
    outcome: "validated",
  });
});

test("the real filled builder template validates a substantial multi-claim plan for every builder seat", () => {
  const prompt = filledTemplate(".agents/templates/builder-handoff.md", {
    SLICE_TITLE: "Complete handoff enforcement",
    CLAIM:
      "all readable architect and builder handoffs carry complete bounded structure",
    CONSTRUCTION_MODE: "strict-tdd",
    WORKTREE_ROOT: "/tmp/rentcottage issue 310",
    PLAN: [
      "1. Shared validator.",
      "   Claim: validate every required scalar and multiline field.",
      "   Focused verification: exercise the public pure seam.",
      "2. Runtime adapters.",
      "   Claim: preserve validated, rejected, unvalidated, and out-of-scope outcomes.",
      "   Stop condition: provider wrappers never guess at opaque payloads.",
      "3. Instruction ownership.",
      "   Claim: builders receive the whole approved plan after a mailbox handoff.",
      "4. Verification routing.",
      "   Claim: exact hook and configuration paths select full evidence.",
    ].join("\n"),
    FILES: [
      "- scripts/lib/handoff-check.mjs",
      "- scripts/lib/handoff-check.test.mjs",
      "- .agents/templates/planner-handoff.md",
      "- .agents/templates/builder-handoff.md",
    ].join("\n"),
    TEST: [
      "- Every required field is independently removed, emptied, repeated, and placeholder-filled.",
      "- The real filled templates pass through the public seam.",
    ].join("\n"),
    OBSERVER:
      "Node's test runner calling checkHandoff and reading the templates from disk",
    INDEPENDENT_ORACLE:
      "issue 310 acceptance criteria and the testing strategy",
    FOCUSED_TEST_COMMAND:
      "npm run run-log -- issue-310-validator -- node --test scripts/lib/handoff-check.test.mjs",
    STOP_CONDITION:
      "the exact focused observer passes with at least one matched test and writing stops",
  });

  for (const agentType of ["builder-lite", "builder", "builder-max"]) {
    assert.deepEqual(
      checkHandoff({ agentType, prompt }),
      { outcome: "validated" },
      agentType,
    );
  }
});
