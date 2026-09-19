import { isAbsolute } from "node:path";

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
    return [];
  }
  if (indexes.length > 1) {
    problems.push(
      `${field}: required outer label is repeated; it must appear exactly once`,
    );
    return [];
  }

  const index = indexes[0];
  if (lines[index] !== prefix) {
    problems.push(
      `${field}: outer label must end after the colon; put its content on indented continuation lines`,
    );
    return [];
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
  return content;
}

function referenceOnlyPlanLine(line) {
  const content = line
    .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .trim()
    .replace(/[.!?]+$/, "")
    .toLowerCase();
  const delegationDirective =
    /^(?:same\s+as|as|use|follow|apply|implement|execute|see|refer\s+to)\b/;
  const missingContextReference =
    /\b(?:above|earlier|prior|preceding|inherited|sibling|architect(?:'s)?|conversation|context)\b/;
  const referencedArtifact =
    /\b(?:plans?|instructions?|materials?|results?|details?|conversation|context)\b/;
  const implicitSameArtifact = /^(?:same\s+as|as)\b/;
  return (
    delegationDirective.test(content) &&
    missingContextReference.test(content) &&
    (referencedArtifact.test(content) || implicitSameArtifact.test(content))
  );
}

function slotProblems(prompt) {
  const slots = [...new Set(prompt.match(TEMPLATE_SLOT_RE) ?? [])];
  return slots.length === 0
    ? []
    : [
        `${slots.length} unfilled template ${slots.length === 1 ? "slot" : "slots"}`,
      ];
}

function commandTokens(command) {
  if (/[\r\n]/.test(command) || command.includes("$(")) return null;
  const tokens = [];
  let token = "";
  let quote = null;
  let escaped = false;

  for (const character of command.trim()) {
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/[;&|<>`]/.test(character)) return null;
    if (/\s/.test(character)) {
      if (token !== "") {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += character;
  }

  if (escaped || quote) return null;
  if (token !== "") tokens.push(token);
  return tokens;
}

function explicitFocusedTarget(target) {
  if (!target || target.startsWith("-") || /[*?{}]/.test(target)) return false;
  const normalized = target.replace(/\/+$/, "");
  return /(?:^|\/)[^/]+\.[^/]+$/.test(normalized);
}

function hasBoundedObserverArguments(tokens, targetIndex) {
  if (!explicitFocusedTarget(tokens[targetIndex])) return false;
  for (let index = targetIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith("-")) continue;
    const previous = tokens[index - 1];
    if (previous.startsWith("-") && !previous.includes("=")) continue;
    if (!explicitFocusedTarget(token)) return false;
  }
  return true;
}

function isFocusedCommand(command) {
  const tokens = commandTokens(command);
  if (!tokens || tokens.slice(0, 4).join(" ") !== "npm run run-log --")
    return false;

  const separator = tokens.indexOf("--", 4);
  if (separator <= 4) return false;

  let cursor = separator + 1;
  while (/^[A-Za-z_][A-Za-z0-9_]*=.+$/.test(tokens[cursor] ?? "")) cursor += 1;

  if (tokens[cursor] === "node" && tokens[cursor + 1] === "--test") {
    cursor += 2;
  } else if (
    tokens[cursor] === "npx" &&
    tokens[cursor + 1] === "vitest" &&
    tokens[cursor + 2] === "run"
  ) {
    cursor += 3;
  } else if (
    tokens[cursor] === "npx" &&
    tokens[cursor + 1] === "playwright" &&
    tokens[cursor + 2] === "test"
  ) {
    cursor += 3;
  } else {
    return false;
  }

  return hasBoundedObserverArguments(tokens, cursor);
}

function assignsBuilderMutationTesting(line) {
  const content = line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "").trim();
  const mutationTask =
    /\bmutation(?:[- ](?:test|testing|proof|cycle|sensitivity))\b/i;
  const mutationActionTarget =
    /\b(?:mutate|mutates|mutating|revert|reverts|reverting|restore|restores|restoring)\b[^.;]{0,120}\b(?:implementation|source|validator|rule|check|change)s?\b/i;
  const assignsMutation =
    mutationTask.test(content) || mutationActionTarget.test(content);
  if (!assignsMutation) return false;

  const turnsPositive = /[;]|\b(?:until|but|however|except)\b/i.test(content);
  const directNegation =
    /^(?:do not|don't|must not|never|without|no need to|not required to)\b/i.test(
      content,
    ) ||
    /^(?:the\s+)?builder(?::|\s+)(?:do(?:es)? not|must not|should not|will not|never)\b/i.test(
      content,
    );
  if (directNegation && !turnsPositive) return false;

  const builderIndex = content.search(/\bbuilder\b/i);
  if (builderIndex !== -1) {
    const builderClause = content.slice(builderIndex);
    if (
      mutationTask.test(builderClause) ||
      mutationActionTarget.test(builderClause)
    ) {
      return true;
    }
  }

  if (/^(?:the\s+)?(?:coordinator|orchestrator)(?:-only)?\b/i.test(content))
    return false;

  return true;
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
  let implementationPlan = [];
  for (const field of BUILDER_MULTILINE_FIELDS) {
    const content = multilineField(lines, field, problems);
    if (field === "Implementation plan") implementationPlan = content;
  }
  problems.push(...slotProblems(prompt));

  if (
    implementationPlan.length > 0 &&
    implementationPlan.every(referenceOnlyPlanLine)
  ) {
    problems.push(
      "Implementation plan: must embed concrete steps instead of delegating to prior context",
    );
  }

  const mode = values.get("Construction mode");
  if (mode && !placeholderOnly(mode) && !CONSTRUCTION_MODES.has(mode)) {
    problems.push(
      "Construction mode: must be exactly strict-tdd, evidence-required, or preservation",
    );
  }
  const workingDirectory = values.get("Working directory");
  if (
    workingDirectory &&
    !placeholderOnly(workingDirectory) &&
    !isAbsolute(workingDirectory)
  ) {
    problems.push("Working directory: must be an absolute path");
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
