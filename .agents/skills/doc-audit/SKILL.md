---
name: doc-audit
description: Audit the repo's agent-consumed prose (CLAUDE.md, AGENTS.md, docs/, the `.claude/` and `.agents/` workflow, skill, rule, and agent files, script header comments) for stale facts, redundancy, broken references, and obsolete files — then report a manifest of proposed changes for the owner to approve. Sweep it periodically, not every session; propose it proactively when CLAUDE.md, AGENTS.md, or anything under `.agents/skills/resume/` has grown ~20%+ since the last audit.
---

Audit the docs for drift. Anchor every "shipped / done / next" claim to `git log` + `npm test`, never to another
doc. Scale effort to the ask, but the two always-loaded contracts, `CLAUDE.md` and `AGENTS.md`, are in scope on
EVERY invocation. This is periodic maintenance — say so if invoked too soon after a clean pass.

**Standing trigger: propose the sweep unasked** when `CLAUDE.md`, `AGENTS.md`, or anything under
`.agents/skills/resume/` has grown ~20%+ since the last audit, at the next natural boundary.

## 1. Inventory + churn

List every tracked `.md` (`git ls-files "*.md"`) with size and last-touched (`git log -1 --format=%cd -- <f>`).
The sweep is repo-wide and provider-neutral: the shared skills (`.agents/skills/`, reached from
`.claude/skills/` by symlink), the Claude surfaces (`CLAUDE.md`, `.claude/hooks/`, `.claude/settings.json`,
`.claude/agents/`, `.claude/templates/`) and the Codex surfaces (`AGENTS.md`, `.agents/templates/`, `.codex/agents/` TOMLs — add the TOMLs explicitly; their
`developer_instructions` are agent-consumed prose `git ls-files` cannot find). Weight the two always-loaded
contracts first.

**Mechanical first:** run `node scripts/doc-lint.mjs`; hand its hits to the readers and spend the sweep on
what the script can't catch.

**Always skip:** the external memory directory; it is not repository prose.

`docs/AI-WORKFLOW.md` is the workflow teaching authority: preserve its deliberate owner framing while checking its
factual claims and references.

## 2. Fan out readers per cluster (Workflow)

Use the **Workflow** tool, one reader per cluster: always-loaded contracts · architecture and scoped rules ·
record docs (SPEC/PLAN/RESEARCH/REVIEW) · remaining docs (the AI-WORKFLOW doc, README, ADMIN, PRIVACY, tours,
desktop-shell, every other tracked `.md`) · a determinism reader · a skills reader (the Claude and Codex surfaces
from §1). Readers run on **Opus at `medium`**; the §3 verify pass runs on **Opus at `high`**, earning its keep
through independence. Re-run a reader that returns a stub summary.

**Every rule below describes what to PROPOSE — a reader edits nothing.** Each returns structured findings and, for
its files:

- Cross-check shipped/done/next prose against `git log` and the suite.
- Spot-check named facts against the code; prefer version-free phrasing over a number that will rot.
- Strip inline date/time stamps that annotate a rule or decision; keep the rule, delete the stamp.
- Strip backstory rationale; keep boundary rationale, compressed to the shortest phrasing. Test: does the reason
  change what the agent does at an edge? No → cut.
- Strip issue/PR IDs except where the ID is the sole pointer to why a counterintuitive rule exists.
- None of the three strip rules applies to a record file — in SPEC, PLAN, RESEARCH, and REVIEW files the dates,
  IDs, and lineage ARE the content.
- For the two always-loaded contracts, apply the keep-or-cut test line by line: could new work that passes every
  existing test and hook still break this rule? If not, the line restates something the repo enforces, so cut it or
  shrink it to a pointer naming the guard. A line that binds work no check can see stays.
- Grade the file against the agent-writing standard (`.agents/skills/writing-great-skills/SKILL.md`): a pointer whose
  wording won't fire, an always-loaded line that belongs behind a pointer, a no-op, sediment, a prohibition where a
  positive target would do, an environment fact cached in prose.
- Flag redundancy, dangling references, and obsolete files (point-in-time snapshots whose backlog shipped — DELETE
  candidates, but first confirm any still-open finding is on the board).
- Provider mirrors are deliberate duplicates, not redundancy: flag divergence in substance between a pair and
  leave the mirroring intact.

The **skills reader** additionally checks each skill's invocation mode and disclosure structure, reads the skills
against each other for cross-skill single-sourcing and leading-word collapses, and flags retirement candidates — a
capability patch current models may have outgrown; preference and process rules are not candidates.

**Improvement channel (every reader, same pass).** Alongside drift findings, each reader returns improvement
proposals limited to: a single-sourcing win (one rule restated across N files) and a structural clarity win (a
table or leading word that collapses a passage). Report a shortlist of the highest-value proposals, ranked by
always-loaded token cost or drift risk saved. Skip anything recorded as won't-do on the board.

## 3. Adversarially verify every proposal before reporting it

A second reader pass (**Opus at `high`**) over the proposed edits: would any durable decision, constraint,
threshold, seam, or "do-not-re-propose" guardrail be dropped (versus merely compressed)? Any broken reference
introduced? Any stale fact survive? Compare each proposed edit against the file on disk. Acceptable losses:
date/time stamps, non-load-bearing issue/PR IDs, rationale for why a rule exists, statements of what a rule does
not change or affect, hedging about how weak or coarse a control is, cost/price/retirement clauses, and a
restatement of another file's rule replaced by a pointer. NOT acceptable: losing a decision, a step an agent
performs, an exact command, a stop condition or escalation trigger, or a rule that prose alone enforces. Verify
the audit's own fix suggestions arithmetically. Improvement proposals pass this same gate; drop any premised on a
misread.

## 4. Report a manifest — the audit proposes, the owner applies

The audit never applies its own findings and never commits; nothing lands until the owner approves the manifest,
and any commit or push is separately authorised per CLAUDE.md's Publication. Keep three sections separate; never
fold a deletion or a record-document edit into the bulk trim list:

- **Proposed trims, de-duplications, and relocations**, grouped by file, including any reference-map update.
- **Proposed deletions and record-document edits** — one entry per file naming the file, the exact text at risk,
  and why it is not a record; capture any still-open finding on the board and grep for path references first.
- **Findings needing a board item rather than an edit**, including code-level drift.

Improvement proposals are report-only: present them as a separate ranked shortlist after the audit report. For
each accepted, capture via `/to-issues` (its owner gate applies); for each declined, propose a one-line won't-do
board record so the next sweep does not re-pitch it.
