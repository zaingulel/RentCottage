---
name: to-issues
description: Turn work into properly-formed board issues — either decompose a plan/spec/Epic into tracer-bullet vertical slices, or capture a single bug, feature idea, or suggestion as one well-formed issue.
---

# To Issues

Two shapes, one publish pipeline: **decompose** a plan/spec/Epic into ordered, bounded, shippable vertical slices
(tracer bullets), or **capture** a single bug, feature idea, or suggestion as one issue (slicing collapses to one;
routing, body shape, publish, and verify are identical).

Codex or Claude may invoke this skill, but Step 4 (owner approval) is a HARD gate on every ordinary model-invoked
proposal: create NOTHING on the board until the owner approves. The exception is a follow-up issue, in `Backlog`,
for work an approved job surfaces and genuinely cannot finish, filed under the "Owner gates" rule in `AGENTS.md`.
That exception skips the Step 4 approval gate, not the native-links or verification rules.

Read [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md) before drafting or publishing. It owns
the tracker commands, native dependency rules, Project 4 fields, special Booking and Payment acceptance shape, and
authoritative read-back checks.

## Process

### 1. Gather context

Work from the plan/spec/Epic in the conversation. If the owner passes an issue number, fetch its body and comments
first:

```bash
gh issue view 310 --repo zaingulel/RentCottage --json title,body,comments --jq '.title, .body, (.comments[] | "--- comment by \(.author.login) (\(.authorAssociation)) ---", .body)'
```

Never rely on a comments-only read: an issue with no comments can otherwise hide the body while exiting zero.
Preserve attributed owner decisions and distinguish them from other comments.

### 2. Explore the codebase (optional)

Read enough relevant code, `CONTEXT.md`, accepted architecture decisions, and engineering evidence to ground the
breakdown in real seams and project vocabulary. If a slice needs groundwork first, that prefactor is its own
slice, ordered first.

A named reference implementation is normative. Inspect its current source before drafting. Preserve its structure
and behaviour, and adapt only names, paths, fixtures, provider payloads, and repository configuration. Stronger
validation, extra abstractions, or another runtime layer are material scope changes. If the requested outcome and
the reference conflict, stop with the exact conflict for the owner.

### 3. Draft vertical slices

Single bug/idea → one issue in the Step-7 shape, route it (Step 5), then Step 4. Otherwise break the plan into
tracer-bullet issues: each a thin vertical slice cutting through every required layer end-to-end, never a
horizontal data/API/UI/test layer. Each slice is demonstrable or verifiable on its own and sized to a bounded
builder handoff; an open-ended "build the whole feature" splits further. Native blockers represent genuine start
constraints, not a preferred order.

### 4. Quiz the owner

Present the proposed issue or numbered breakdown showing per slice: **Title**, **Outcome**, **Blocked by**,
**Workstream**, and **Required capabilities**. Ask whether the granularity and dependencies are correct and whether
anything should merge or split. Iterate until the owner approves; create nothing until they do.

### 5. Route each slice

- **Required capabilities:** the planning, build, review, or specialist capability the slice needs (`builder-lite`,
  `builder`, or `builder-max`, per the routing rule in `AGENTS.md`). Do not record model names or reasoning settings.
- Use the sensitive-surface classification in `AGENTS.md` to name any required Security review.
- Choose one Project 4 Workstream from `scripts/lib/board-config.mjs`.

### 6. Publish to the board, in dependency order

Publish blockers first: a blocker must exist before a later issue can link to it. If you create a new parent Epic,
it is a board item too—run a-b for it and link every child as a native sub-issue (Step c). Every item gets a
Workstream.

**a. Create:**

```bash
gh issue create --repo zaingulel/RentCottage \
  --title "..." \
  --blocked-by <N>[,<N>...] \
  --body "..."
```

Omit `--blocked-by` when the issue has none. Blockers and parents live in GitHub's native links, never only in the
body. Because GitHub creates the issue before adding dependency links, a failed create may already have made the
issue without printing its number. Find it by exact title before retrying, then add only the missing approved link
instead of creating a duplicate.

**b. Board, with Status and Workstream, in one idempotent step (once per issue):**

```bash
node scripts/board-add.mjs <ISSUE_N> Backlog <Workstream>
```

Use `board-move.mjs` only to move an existing card, never to create one. New items stay in `Backlog` until the
owner promotes them.

**c. Link each child to its parent Epic as a native sub-issue** (a Markdown checklist is not a sub-issue):

```bash
PARENT=$(gh issue view <EPIC_N> --repo zaingulel/RentCottage --json id --jq .id)
CHILD=$(gh issue view <CHILD_N> --repo zaingulel/RentCottage --json id --jq .id)
gh api graphql \
  -f query='mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){subIssue{number}}}' \
  -f p="$PARENT" -f c="$CHILD"
```

<workstream-convention>

The Workstream options are the `ROUTING_OPTIONS` in `scripts/lib/board-config.mjs`. Product behaviour and product
engineering → **Product**; launch, legal, supplier, promotion, and owner content → **Go-to-market**; tooling,
infrastructure, developer experience, and process machinery → **Platform**.

</workstream-convention>

### 7. Issue body shape

Keep implementation file paths and code snippets out of the body unless a prototype encodes an approved decision
more precisely than prose; the planner and builder inspect current code at handoff time.

<issue-template>
## Problem

What's missing or broken, in one or two sentences.

## What to build

The complete observable outcome of this slice. When a named reference applies, identify it as the normative design
and name only the permitted repository-specific adaptations.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Required capabilities

The planning, build, review, or specialist capabilities required, provider-neutral.

## Preservation and out of scope

The existing contracts that remain unchanged and adjacent work excluded from this issue.

## Documentation impact

Choose exactly one honest outcome:

- `No documentation change: <reason>.`
- `Update <authoritative document>: <what changes>.`
</issue-template>

For a new or substantially rewritten Booking or Payment story, use the acceptance structure required by
`docs/agents/issue-tracker.md`. Testing mode, observers, commands, and mutations belong to the architect's later
plan unless the owner or normative reference already fixed them.

Do not close or edit a source or parent Epic unless the owner approved that exact mutation.

### 8. Verify the publish (fail loud, do not skip)

Re-read every published issue body, native blocker and parent relationship, Project membership, Status, and
Workstream from GitHub. Compare each read to the owner-approved proposal, then run:

```bash
npm run verify:board
```

Missing, extra, unavailable, truncated, or failing read-back evidence is incomplete publication. Fix only the
approved target and repeat the authoritative read; never create a duplicate as a retry.

## Example

Decomposing a booking Epic: first slice any genuine authorization or persistence prefactor, then one vertical issue
per demonstrable journey, never "the database", "the API", "the UI", and "the tests" as separate issues.
