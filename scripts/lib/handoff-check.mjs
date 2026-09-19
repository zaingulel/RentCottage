const GUARDED_AGENT_TYPES = new Set([
  "architect",
  "builder-lite",
  "builder",
  "builder-max",
]);
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
const BUILDER_FIELDS = [...BUILDER_SCALAR_FIELDS, ...BUILDER_MULTILINE_FIELDS];
const CONSTRUCTION_MODES = new Set([
  "strict-tdd",
  "evidence-required",
  "preservation",
]);
const TEMPLATE_SLOT_RE = /{{[^{}\r\n]+}}/g;

function placeholderOnly(value) {
  const content = value
    .trim()
    .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .trim();
  return (
    content === "..." ||
    content === "…" ||
    /^<[^>]+>$/.test(content) ||
    /^(?:TODO|TBD)(?:\b.*)?$/i.test(content) ||
    /^{{[^{}\r\n]+}}$/.test(content)
  );
}

function scalarField(lines, field, problems) {
  const prefix = `${field}:`;
  const matches = lines.filter((line) => line.startsWith(prefix));
  if (matches.length === 0) {
    problems.push(
      `${field}: required field must appear exactly once with its value on the same line`,
    );
    return null;
  }
  if (matches.length > 1) {
    problems.push(
      `${field}: required field is repeated; it must appear exactly once`,
    );
    return null;
  }

  const value = matches[0].slice(prefix.length).trim();
  if (value === "") {
    problems.push(
      `${field}: required field is empty; put its value on the same line`,
    );
  } else if (placeholderOnly(value)) {
    problems.push(`${field}: required field is entirely placeholder-filled`);
  }
  return value;
}

function isOuterBuilderField(line) {
  return BUILDER_FIELDS.some((field) => line.startsWith(`${field}:`));
}

function multilineField(lines, field, problems) {
  const prefix = `${field}:`;
  const indexes = lines.flatMap((line, index) =>
    line.startsWith(prefix) ? [index] : [],
  );
  if (indexes.length === 0) {
    problems.push(
      `${field}: required field must appear exactly once as an outer label`,
    );
    return;
  }
  if (indexes.length > 1) {
    problems.push(
      `${field}: required outer label is repeated; it must appear exactly once`,
    );
    return;
  }

  const index = indexes[0];
  if (lines[index] !== prefix) {
    problems.push(
      `${field}: outer label must end after the colon; put its content on indented continuation lines`,
    );
    return;
  }

  const content = [];
  for (
    let cursor = index + 1;
    cursor < lines.length && !isOuterBuilderField(lines[cursor]);
    cursor += 1
  ) {
    const line = lines[cursor];
    if (line.trim() === "" || line === "<!-- prettier-ignore -->") continue;
    if (!/^[\t ]/.test(line)) {
      problems.push(`${field}: every continuation line must be indented`);
      continue;
    }
    content.push(line.trim());
  }

  if (content.length === 0) {
    problems.push(
      `${field}: required field is empty; add indented continuation lines`,
    );
  } else if (content.every(placeholderOnly)) {
    problems.push(`${field}: required field is entirely placeholder-filled`);
  }
}

function slotProblems(prompt) {
  const slots = [...new Set(prompt.match(TEMPLATE_SLOT_RE) ?? [])];
  return slots.length === 0
    ? []
    : [
        `unfilled template ${slots.length === 1 ? "slot" : "slots"}: ${slots.join(", ")}`,
      ];
}

function stripEnvironmentAssignments(command) {
  let remaining = command.trim();
  const assignment =
    /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+)\s+/;
  while (assignment.test(remaining))
    remaining = remaining.replace(assignment, "");
  return remaining;
}

function isFocusedCommand(command) {
  const core = stripEnvironmentAssignments(command);
  const directObserver =
    /^(?:node\s+--test|npx\s+vitest\s+run|npx\s+playwright\s+test)\s+\S[\s\S]*$/;
  if (directObserver.test(core)) return true;
  if (!core.startsWith("npm run run-log -- ")) return false;

  const logged = core.slice("npm run run-log -- ".length);
  const separator = logged.indexOf(" -- ");
  if (separator === -1 || logged.slice(0, separator).trim() === "")
    return false;
  return directObserver.test(
    stripEnvironmentAssignments(logged.slice(separator + 4)),
  );
}

function assignsBuilderMutationTesting(line) {
  if (/\b(?:coordinator|orchestrator)\b/i.test(line)) return false;
  if (
    /\b(?:do not|don't|must not|never|without|no need to|not required to)\b/i.test(
      line,
    )
  )
    return false;
  if (
    /\bmutation-proven\b/i.test(line) &&
    !/\b(?:mutate|revert|restore)\b/i.test(line)
  )
    return false;

  const mutationTask =
    /\bmutation(?:[- ](?:test|testing|proof|cycle|sensitivity))\b/i.test(line);
  const mutationAction =
    /\b(?:mutate|mutating|revert|reverting|restore|restoring)\b/i.test(line);
  const evidenceTarget =
    /\b(?:test|observer|check|verification|proof|rule|implementation|source|change)\b/i.test(
      line,
    );
  return mutationTask || (mutationAction && evidenceTarget);
}

function rejected(problems, template) {
  return {
    outcome: "rejected",
    reason: `Handoff rejected: ${problems.join("; ")}; fill ${template}`,
  };
}

function validateArchitect(prompt) {
  const lines = prompt.split(/\r?\n/);
  const problems = [];
  for (const field of ARCHITECT_FIELDS) scalarField(lines, field, problems);
  problems.push(...slotProblems(prompt));
  return problems.length === 0
    ? { outcome: "validated" }
    : rejected(problems, ".agents/templates/planner-handoff.md");
}

function validateBuilder(prompt) {
  const lines = prompt.split(/\r?\n/);
  const problems = [];
  const values = new Map();
  for (const field of BUILDER_SCALAR_FIELDS)
    values.set(field, scalarField(lines, field, problems));
  for (const field of BUILDER_MULTILINE_FIELDS)
    multilineField(lines, field, problems);
  problems.push(...slotProblems(prompt));

  const mode = values.get("Construction mode");
  if (mode && !placeholderOnly(mode) && !CONSTRUCTION_MODES.has(mode)) {
    problems.push(
      "Construction mode: must be exactly strict-tdd, evidence-required, or preservation",
    );
  }
  const command = values.get("Focused verification");
  if (command && !placeholderOnly(command) && !isFocusedCommand(command)) {
    problems.push(
      "Focused verification: must be an explicit runnable focused repository command, not prose or a reference",
    );
  }
  if (lines.some(assignsBuilderMutationTesting)) {
    problems.push(
      "mutation testing belongs to the coordinator; the builder handoff must not assign mutation, revert, or restore testing",
    );
  }

  return problems.length === 0
    ? { outcome: "validated" }
    : rejected(problems, ".agents/templates/builder-handoff.md");
}

export function checkHandoff(input) {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    typeof input.agentType !== "string"
  ) {
    return {
      outcome: "unvalidated",
      reason: "normalized agent identity is unavailable",
    };
  }
  if (!GUARDED_AGENT_TYPES.has(input.agentType)) {
    return { outcome: "out-of-scope" };
  }
  if (typeof input.prompt !== "string") {
    return {
      outcome: "unvalidated",
      reason: "normalized handoff prompt is unavailable",
    };
  }

  return input.agentType === "architect"
    ? validateArchitect(input.prompt)
    : validateBuilder(input.prompt);
}
