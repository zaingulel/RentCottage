---
name: to-issues
description: Turn work into properly-formed board issues — either decompose a plan/spec/Epic into tracer-bullet vertical slices, or capture a single bug, feature idea, or suggestion as one well-formed issue.
---

# To Issues

Two shapes, one publish pipeline: **decompose** a plan/spec/Epic into ordered, bounded, shippable vertical slices
(tracer bullets), or **capture** a single bug, feature idea, or suggestion as one issue (slicing collapses to one;
routing, body shape, publish, and verify are identical).

Codex or Claude may invoke this skill, but Step 4 (owner approval) is a HARD gate on every ordinary model-invoked
proposal: create NOTHING on the board until the owner approves. The exceptions are a follow-up card, in `Backlog`,
for work an approved job surfaces and genuinely cannot finish under the "Owner gates" rule in `AGENTS.md`, and a
card the inactive documentation triage routine may create only after its external authority is configured. An
exception skips the Step 4 approval gate, not the native-link, board-field, or verification rules.

Read [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md) before drafting or publishing. It owns
the tracker commands, native dependency rules, Project 4 fields, special Booking and Payment acceptance shape, and
authoritative read-back checks.

## Process

### 1. Gather context

Work from the plan/spec/Epic in the conversation. If the owner passes an issue number, fetch it first:

```bash
gh issue view 310 --repo zaingulel/RentCottage --json title,body,comments --jq '.title, .body, (.comments[] | "--- comment by \(.author.login) (\(.authorAssociation)) ---", .body)'
```

Never rely on a comments-only read: an issue with no comments can otherwise hide the body while exiting zero.
Preserve attributed owner decisions and distinguish them from other comments.

### 2. Explore the codebase (optional)

Read enough relevant code, `CONTEXT.md`, accepted architecture decisions, and engineering authorities to ground the
breakdown in real seams and project vocabulary. If a slice needs groundwork first, that prefactor is its own slice,
ordered first. A named reference implementation is normative: preserve its structure and behaviour and adapt only
the repository-specific names, paths, fixtures, provider payloads, and configuration the approved work allows.

### 3. Draft vertical slices

Single bug/idea → one issue in the Step-7 shape, route it (Step 5), then Step 4. Otherwise break the plan into
tracer-bullet issues: each a thin vertical slice cutting through every required layer end-to-end, never a
horizontal database/API/interface/test layer. Each slice is demonstrable or verifiable on its own and sized to a
bounded builder handoff; an open-ended "build the whole feature" splits further. Native blockers represent genuine
start constraints, not a preferred order. Parallel candidacy additionally requires independent files, product
seams, tests, migrations/providers, and verification capacity.

Size signals, judged once by the owner at Step 4, apply to a single captured idea as much as to a breakdown: the
outcome fits one sentence a reviewer could demonstrate, and more than five distinct outcome or invariant
statements, checkbox or bullet, is a signal to make the work a `type:epic` parent with native child slices. No
later seat stops, replans or refuses work on these signals; after work-pick the only size gate is the plan's, in
the `resume` skill's Plan section.

### 4. Quiz the owner

Present the proposed issue or numbered breakdown showing per slice: **Title**, **Outcome**, **Blocked by**,
**Workstream**, and **Required capabilities**, and flag any slice with more than five outcome or invariant
statements. An instruction to file an issue approves the idea, not a proposal the owner has not seen, so a single
captured idea is presented here too. Ask whether the granularity and dependencies are correct and whether
anything should merge or split. Iterate until the owner approves; create nothing until they do.

### 5. Route each slice

- **Required capabilities:** the planning, review, or specialist capability the slice needs. Never name a builder
  seat: the plan chooses one per slice under the routing rule in `AGENTS.md`. Do not record model names or
  reasoning settings.
- Use the sensitive-surface classification in `AGENTS.md` to name any required Security review.
- Choose one Project 4 Workstream from `scripts/lib/board-config.mjs` and only configured labels that describe the
  issue's real tracker role. A parent wrapper with native sub-issues gets `type:epic`.

### 6. Publish to the board, in dependency order

Publish blockers first: a blocker must exist before a later issue can link to it. If you CREATED a new parent
Epic, it is a board item too — run a-b for it and link every child as a native sub-issue (step c). Every item gets
a Workstream.

**a. Create:**

```bash
gh issue create --repo zaingulel/RentCottage \
  --title "..." \
  --label "<approved configured labels>" \
  --blocked-by <N>[,<N>...] \
  --body "..."
```

`--blocked-by` takes each owner-approved blocker and needs gh 2.94 or later; omit it when the slice has none. A
blocker and a parent live only in GitHub's built-in links, never in the body. The link is a second call after
creation, so step 8 reads it back. A blocker added after creation uses `gh issue edit <N> --add-blocked-by <M>`.
Because gh creates the issue before it adds the links, a failed create carrying `--blocked-by` may already have
made the issue without printing its number: find it by exact title before retrying,
`gh issue list --repo zaingulel/RentCottage --state all --author @me --limit 20 --json number,title --jq '.[] | select(.title == "<title>") | .number'`,
and add the missing link with `gh issue edit <N> --add-blocked-by <M>` instead of creating again.

**b. Board, with Status and Workstream, in one idempotent step (once per issue):**

```bash
node scripts/board-add.mjs <ISSUE_N> Backlog <Workstream>
```

Use `board-move.mjs` only to move an existing card, never to create one.

**c. Link each child to its parent Epic as a native sub-issue** (a markdown checklist is NOT a sub-issue):

```bash
PARENT=$(gh issue view <EPIC_N> --repo zaingulel/RentCottage --json id --jq .id)
CHILD=$(gh issue view <CHILD_N> --repo zaingulel/RentCottage --json id --jq .id)
gh api graphql \
  -f query='mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){subIssue{number}}}' \
  -f p="$PARENT" -f c="$CHILD"
```

New backlog items go to **Backlog** until the owner promotes them.

<workstream-convention>

The Workstream options are the `ROUTING_OPTIONS` in `scripts/lib/board-config.mjs`. Product
feature/booking/payment/engineering → **Product**; GTM/launch/legal/promo, including the owner's own content →
**Go-to-market**; tooling/infra/dev-experience/process machinery → **Platform**.

</workstream-convention>

### 7. Issue body shape

Keep file paths and code snippets OUT of the body; point to the relevant doc, since the builder rereads the real
code at handoff time.

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

The planning, review, or specialist capabilities required, provider-neutral; never a builder seat.

## Preservation and out of scope

The existing contracts that remain unchanged and adjacent work excluded from this issue.

## Documentation impact

Choose exactly one honest outcome:

- `No documentation change: <reason>.`
- `Update <authoritative doc>: <what changes>.`

</issue-template>

For a new or substantially rewritten Booking or Payment story, use the acceptance structure required by
`docs/agents/issue-tracker.md`. Testing mode, observers, commands, and mutations belong to the architect's later
plan unless the owner or normative reference already fixed them.

Do not close or edit a source or parent Epic unless the owner approved that exact mutation.

### 8. Verify the publish (fail loud, do not skip)

Run the shared verifier once with the Epic followed by every child (a standalone issue takes one number):

```bash
node scripts/verify-issue-publish.mjs <EPIC_N> <CHILD_N...>
```

Report its three results: board presence, Statuses and Workstreams, native child count. On failure, read WHICH
failure: `absent from the board` means the publication genuinely failed — fix before reporting ready; `is archived
on the board` means unarchive that card, never add a second; `is on the board but not in this board read` and
`is not on this board read` mean the read lagged — re-run the verifier, never add again; `could not confirm
whether` means fix the named cause. A silent skip here is the exact failure this skill already made once.

Then read every published issue's blockers back from GitHub and report them against the owner-approved list; a
missing or extra link is a failure to fix before reporting ready:

```bash
gh api repos/zaingulel/RentCottage/issues/<N>/dependencies/blocked_by --jq '.[].number'
```

Re-read each issue body and its native parent relationship, compare every surface with the approved proposal,
then run `npm run verify:board`. Missing, extra, unavailable, truncated, or failing read-back evidence is incomplete
publication; fix only the approved target and never create a duplicate as a retry.

## Example

Decomposing a booking Epic: first slice any genuine authorization or persistence prefactor, then one vertical issue
per demonstrable journey, never "the database", "the API", "the interface", and "the tests" as separate issues.
