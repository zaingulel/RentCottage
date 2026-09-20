// check-agents.mjs — fail-loud guard for .claude/agents/*.md frontmatter and
// .codex/agents/*.toml agent definitions.
//
// WHY: both harnesses DROP an agent file silently when its definition fails to parse.
// That is how `reviewer` once vanished from the registry for a whole session: an unquoted
// `: ` inside `description:` is invalid YAML, the parse failed, and the review step
// discovered the missing agent only when it tried to spawn it. This guard moves that
// failure to commit time with a named cause.
//
// SCOPE (deliberately targeted, no parser dependency): the failure classes that bite,
// not full format validity.
//   Claude Markdown: frontmatter fence present and closed; every line a `key: value`
//   mapping; no unquoted `: ` or trailing `:` in a plain value; `name` and `description`
//   present; `name` matches the filename; `model` and `effort` from the known sets; no
//   `initialPrompt` key (it never reaches a subagent — the opening instruction belongs in the body).
//   Codex TOML: the restricted project format — simple quoted string fields plus one
//   opened-and-closed `developer_instructions = """ ... """` block; `name` matches the
//   filename.
//   Default CLI run: the Claude and Codex reviewer charters match, the skill sigil aside.
// Model, effort, and turn caps are each agent file's own decision and are not pinned here.
//
// Pure logic exported for scripts/lib/check-agents.test.mjs; CLI at bottom.

import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const KNOWN_MODELS = ["opus", "sonnet", "haiku", "fable", "inherit"];
const KNOWN_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const REQUIRED_KEYS = ["name", "description"];
const CODEX_REQUIRED_FIELDS = [
  "name",
  "description",
  "model",
  "model_reasoning_effort",
];

/** Check one Claude agent file's source. Returns [] when clean, else problem strings. */
export function checkAgentSource(filename, source) {
  const problems = [];
  const lines = source.split("\n");

  if (lines[0] !== "---") {
    return [
      `${filename}: no frontmatter fence on line 1 — the harness will not register this agent`,
    ];
  }
  const closing = lines.indexOf("---", 1);
  if (closing === -1) {
    return [
      `${filename}: frontmatter fence never closes — the harness will not register this agent`,
    ];
  }

  const fields = {};
  let inBlockScalar = false;
  for (let i = 1; i < closing; i++) {
    const line = lines[i];
    if (inBlockScalar) {
      if (line === "" || /^\s/.test(line)) continue;
      inBlockScalar = false;
    }
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const m = line.match(/^([A-Za-z][\w-]*):(?:\s(.*))?$/);
    if (!m) {
      problems.push(
        `${filename}: line ${i + 1} is not a "key: value" mapping — YAML parse fails, agent silently dropped`,
      );
      continue;
    }
    const [, key, rawValue = ""] = m;
    const value = rawValue.trim();
    fields[key] = value;

    if (value === "|" || value === ">" || value === "|-" || value === ">-") {
      inBlockScalar = true;
      continue;
    }
    const quoted = /^(["']).*\1$/.test(value);
    if (!quoted && (/:\s/.test(value) || value.endsWith(":"))) {
      problems.push(
        `${filename}: unquoted colon inside \`${key}:\` value — invalid YAML, the harness drops the agent silently. Quote the value.`,
      );
    }
  }

  for (const key of REQUIRED_KEYS) {
    if (!fields[key])
      problems.push(
        `${filename}: missing required frontmatter key \`${key}:\``,
      );
  }
  const expectedName = basename(filename, ".md");
  if (fields.name && fields.name !== expectedName) {
    problems.push(
      `${filename}: name \`${fields.name}\` != filename \`${expectedName}\` — the agent registers under a name nothing references`,
    );
  }
  if (fields.model && !KNOWN_MODELS.includes(fields.model)) {
    problems.push(
      `${filename}: unknown model \`${fields.model}\` (known: ${KNOWN_MODELS.join(", ")}) — routing would silently not apply`,
    );
  }
  if (fields.effort && !KNOWN_EFFORTS.includes(fields.effort)) {
    problems.push(
      `${filename}: unknown effort \`${fields.effort}\` (known: ${KNOWN_EFFORTS.join(", ")}) — routing would silently not apply`,
    );
  }
  if (Object.hasOwn(fields, "initialPrompt")) {
    problems.push(
      `${filename}: \`initialPrompt\` is sent only when the agent runs as the main session (\`--agent\`), never to a subagent — put the opening instruction at the top of the body`,
    );
  }
  return problems;
}

function quotedStringValue(rawValue) {
  const quote = rawValue[0];
  if (
    !['"', "'"].includes(quote) ||
    rawValue.length < 2 ||
    rawValue.at(-1) !== quote
  )
    return null;
  return rawValue.slice(1, -1);
}

/** Check one restricted-format Codex TOML agent source. Returns [] when clean. */
export function checkCodexAgentSource(filename, source) {
  const problems = [];
  const fields = {};
  const lines = source.split("\n");
  let instructionsOpened = false;
  let instructionsClosed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (instructionsClosed) {
      if (line.trim() !== "" && !line.trimStart().startsWith("#")) {
        problems.push(
          `${filename}: line ${i + 1} has content after the developer_instructions closing delimiter`,
        );
      }
      continue;
    }
    if (instructionsOpened) {
      if (line === '"""') instructionsClosed = true;
      else if (line.includes('"""')) {
        problems.push(
          `${filename}: line ${i + 1} has a developer_instructions delimiter that is not an exact standalone \`"""\` line`,
        );
      }
      continue;
    }
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^developer_instructions\s*=\s*"""\s*$/.test(line)) {
      instructionsOpened = true;
      continue;
    }
    const m = line.match(/^([A-Za-z][\w-]*)\s*=\s*(.*)$/);
    if (!m || !CODEX_REQUIRED_FIELDS.includes(m[1])) {
      problems.push(
        `${filename}: line ${i + 1} is an unrecognized preamble line — use a simple quoted string assignment`,
      );
      continue;
    }
    const [, key, rawValue] = m;
    if (Object.hasOwn(fields, key)) {
      problems.push(`${filename}: duplicate TOML field \`${key}\``);
      continue;
    }
    const value = quotedStringValue(rawValue.trim());
    if (value === null) {
      problems.push(
        `${filename}: line ${i + 1} must be a simple double- or single-quoted TOML string`,
      );
      continue;
    }
    fields[key] = value;
  }

  for (const field of CODEX_REQUIRED_FIELDS) {
    if (!fields[field])
      problems.push(`${filename}: missing required TOML field \`${field}\``);
  }
  if (!instructionsOpened) {
    problems.push(
      `${filename}: missing required TOML field \`developer_instructions = """\``,
    );
  } else if (!instructionsClosed) {
    problems.push(
      `${filename}: developer_instructions triple-quote never closes — the harness will not register this agent`,
    );
  }
  const expectedName = basename(filename, ".toml");
  if (fields.name && fields.name !== expectedName) {
    problems.push(
      `${filename}: name \`${fields.name}\` != filename \`${expectedName}\` — the agent registers under a name nothing references`,
    );
  }
  if (
    fields.model_reasoning_effort &&
    !KNOWN_EFFORTS.includes(fields.model_reasoning_effort)
  ) {
    problems.push(
      `${filename}: unknown model_reasoning_effort \`${fields.model_reasoning_effort}\` (known: ${KNOWN_EFFORTS.join(", ")})`,
    );
  }
  return problems;
}

// The builder seats share one charter from `Workflow:` down; a divergence is a silent stale-instruction
// state, so the gate refuses it rather than trusting the "edit the files together" sentence.
const SHARED_BUILDER_SEATS = ["builder", "builder-max", "builder-lite"];

export function checkBuilderParity(dir, seats = SHARED_BUILDER_SEATS) {
  const bodies = [];
  for (const seat of seats) {
    let source;
    try {
      source = readFileSync(join(dir, `${seat}.md`), "utf8");
    } catch {
      return [
        `${dir}: builder seat \`${seat}.md\` is missing — the shared builder charter cannot be checked`,
      ];
    }
    const at = source.indexOf("\nWorkflow:\n");
    if (at === -1)
      return [
        `${dir}/${seat}.md: no \`Workflow:\` line — the shared builder charter cannot be located`,
      ];
    bodies.push({ seat, body: source.slice(at) });
  }
  const [first, ...rest] = bodies;
  return rest
    .filter(({ body }) => body !== first.body)
    .map(
      ({ seat }) =>
        `${dir}/${seat}.md: shared builder charter (from \`Workflow:\` down) differs from ${first.seat}.md — edit the builder seats together`,
    );
}

// The reviewer seat is the one charter both runtimes run verbatim, so cross-family review means the same
// review; only the skill-invocation sigil differs (`/name` on Claude, `$name` on Codex).
export function checkReviewerParity(claudeDir, codexDir) {
  const claudeFile = join(claudeDir, "reviewer.md");
  const codexFile = join(codexDir, "reviewer.toml");
  let claudeSource;
  let codexSource;
  try {
    claudeSource = readFileSync(claudeFile, "utf8");
  } catch {
    return [
      `${claudeFile}: reviewer charter is missing — cross-runtime reviewer parity cannot be checked`,
    ];
  }
  try {
    codexSource = readFileSync(codexFile, "utf8");
  } catch {
    return [
      `${codexFile}: reviewer charter is missing — cross-runtime reviewer parity cannot be checked`,
    ];
  }

  const claudeLines = claudeSource.split("\n");
  const fence = claudeLines[0] === "---" ? claudeLines.indexOf("---", 1) : -1;
  if (fence === -1)
    return [
      `${claudeFile}: no closed frontmatter fence — the reviewer charter body cannot be located`,
    ];
  const claudeBody = claudeLines.slice(fence + 1);
  if (claudeBody.at(-1) === "") claudeBody.pop();

  const codexLines = codexSource.split("\n");
  const open = codexLines.findIndex((line) =>
    /^developer_instructions\s*=\s*"""\s*$/.test(line),
  );
  const close = open === -1 ? -1 : codexLines.indexOf('"""', open + 1);
  if (close === -1)
    return [
      `${codexFile}: no closed \`developer_instructions = """\` block — the reviewer charter cannot be located`,
    ];
  const codexBody = codexLines
    .slice(open + 1, close)
    .map((line) => line.replace(/`\$([a-z][\w-]*)`/g, "`/$1`"));

  for (let i = 0; i < Math.max(claudeBody.length, codexBody.length); i++) {
    if (claudeBody[i] === codexBody[i]) continue;
    const show = (line) =>
      line === undefined ? "(end of charter)" : JSON.stringify(line);
    return [
      `${claudeFile} line ${fence + 2 + i} differs from ${codexFile} line ${open + 2 + i} (only the \`/\`-vs-\`$\` skill sigil may differ) — reviewer.md: ${show(claudeBody[i])}; reviewer.toml: ${show(codexLines[open + 1 + i])} — edit the reviewer charters together`,
    ];
  }
  return [];
}

/** Check every agent definition in a directory; the file extension picks the checker. */
export function checkAgentsDir(dir) {
  let dirents;
  try {
    dirents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [
      `${dir}: cannot be read — refusing to report success on a directory that was never checked`,
    ];
  }
  const problems = [];
  let checked = 0;
  for (const entry of dirents) {
    const isMd = entry.name.endsWith(".md");
    const isToml = entry.name.endsWith(".toml");
    if (!isMd && !isToml) continue;
    if (!entry.isFile()) {
      problems.push(
        `${dir}: agent definition \`${entry.name}\` must be a regular file`,
      );
      continue;
    }
    const source = readFileSync(join(dir, entry.name), "utf8");
    problems.push(
      ...(isMd
        ? checkAgentSource(entry.name, source)
        : checkCodexAgentSource(entry.name, source)),
    );
    checked++;
  }
  if (checked === 0)
    problems.push(
      `${dir}: contains no .md or .toml agent definitions — refusing to report success on a directory that was never checked`,
    );
  if (dirents.some((entry) => entry.name === "builder.md"))
    problems.push(...checkBuilderParity(dir));
  return problems;
}

// CLI: node scripts/lib/check-agents.mjs [dir ...] — default .claude/agents and .codex/agents.
// Non-zero on any problem (fail loud).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const dirs = process.argv.slice(2);
  const targets = dirs.length ? dirs : [".claude/agents", ".codex/agents"];
  const problems = targets.flatMap((dir) => checkAgentsDir(dir));
  if (!dirs.length)
    problems.push(...checkReviewerParity(".claude/agents", ".codex/agents"));
  if (problems.length) {
    for (const p of problems) console.error(`✖ ${p}`);
    process.exit(1);
  }
  console.log(`✓ agent definitions OK (${targets.join(", ")})`);
}
