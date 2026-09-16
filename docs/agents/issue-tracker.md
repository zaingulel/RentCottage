# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

GitHub Issues, native dependencies, and [Project 4](https://github.com/users/zaingulel/projects/4) are one tracker. None is a complete planning surface by itself.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Publication is complete only when all applicable tracker surfaces agree:

1. Create each GitHub issue with its approved title, detailed acceptance criteria, and configured labels.
2. Add its approved native GitHub dependency edges.
3. Add the issue to Project 4 and set its approved `Area` and dependency-safe `Status`.
4. Re-read issues, native dependencies, Project membership, and Project fields from GitHub after the writes. Never verify from the request payload or cached local mapping.
5. Run `npm run verify:board` and require exit status zero.

Do not describe work as "published and verified" if any step is missing, unavailable, truncated, unclassified, or failing. A partial write is an incomplete publication, not success.

## Booking and payment story acceptance criteria

Use this compact structure for each new or substantially rewritten Booking or Payment story:

```md
## Acceptance criteria

- Observable outcome: <the public behaviour or persisted business result>
- Integrity invariants: <the authorization, concurrency, deadline, identity, idempotency, history, replay, or receipt guarantees this story must preserve>
- Preservation and out of scope: <the named unchanged contracts and excluded product behaviour>
- Evidence: <architect-selected construction mode> with <the cheapest observer that proves the outcome and each changed boundary>
```

The architect selects the construction mode and observers under
[`docs/engineering/testing-strategy.md`](../engineering/testing-strategy.md). Select evidence from the story's actual
claims. For new or rewritten Booking or Payment stories, this replaces the all-evidence-class template used for
[#34](https://github.com/zaingulel/RentCottage/issues/34) children; existing issue-specific acceptance remains
binding.

## Project status contract

The board is GitHub Project 4. [`scripts/lib/board-config.mjs`](../../scripts/lib/board-config.mjs) is the single
home for its strings: the project identity, the Status columns, the columns work is picked from, the terminal
column, and the `Area` routing field with its approved options. A rename or a new option is one edit there.

- Status columns, in board order: `Backlog`, `Ready`, `In progress`, `In review`, `Done`.
- Work is picked from `Backlog` and `Ready`. Readiness is the column an issue sits in, not a label: nothing about
  an issue's availability is inferred from its labels or its prose.
- `Done` is the only terminal column, so a card closed as superseded or not planned moves there too.
- Every card carries a Status and an `Area` from the approved option list. A card missing either is drift.
- A closed issue belongs in `Done` and an open issue does not.
- Active Codex task ownership is checked by the coordinator before moving an item into an in-flight column. The
  board verifier does not infer it.

## Board intake

One command reads the board and judges it from the same read, so the listing can never disagree with the verdict
printed under it. Run it before selecting work and after any issue, dependency, Project membership, field,
assignment, or status change.

| Command | Use |
|---|---|
| `npm run verify:board` | the pickable candidates grouped by `Area`, then the scan. `--all` shows every column, `--status=<name>` one column |
| `npm run verify:board -- --json` | the same normalized selection on stdout for `/resume`, with the scan on stderr |
| `node scripts/board.mjs --closeout` | the strict proof gate after a merge: the scan alone, sparing the advisory rows |

The read is read-only and fetches Project 4's fields and every item through one paginated GraphQL walk. Labels,
assignees, field values, native blockers, `subIssuesSummary { total completed }`, and officially closing
pull-request references travel with each item, and every rule is answered off those pages. It is fail-loud: a `gh`
error, malformed JSON, or a zero-item read exits non-zero rather than printing an empty "nothing to pick" and
returning success. Drift also exits non-zero after printing the complete report.

Writes go through two commands, never a raw `gh project item-add` or `item-edit`, which leave a card with no
Status and no `Area`:

| Command | Use |
|---|---|
| `node scripts/board-add.mjs <issue#> <Status> <Area>` | put an issue on the board with both fields set |
| `node scripts/board-move.mjs <issue#> <Status>`, or `--batch <issue>:<Status> ...` | move one card or many, resolving the shared field id once |

The scan reports these findings. An advisory row informs the next pick; every other row also fails `--closeout`:

| # | Finding | Severity |
|---|---|---|
| 1 | issue closed but its card sits in a non-terminal column | gate |
| 2 | issue open but its card sits in `Done` | gate |
| 3 | open native blockers on a card outside `Backlog` and `Done` | advisory |
| 4 | an in-flight card with no assignee | advisory |
| 5 | a merged officially closing pull request over an open issue | gate |
| 6 | an in-flight card with no closing pull request at all, merged or draft | advisory |
| 7 | an open epic whose every child issue is closed | gate |
| 8 | an epic claimed in-flight with no children | gate |
| 9 | cards missing Status or `Area`; a mass outage summarises to one field-schema line instead of per-card blame | gate |

Rules 3 and 5 read GitHub's native dependencies and officially closing references only. A pull request that merely
mentions an issue is not proof of shipment, and a textual blocker section is not a contract. No finding authorises
creating, applying, renaming, or removing a label, repairing the tracker, or local cleanup, and drifted issues
never appear as ready work.

Rules 7 and 8 key off an epic label. RentCottage decomposes through native sub-issues and has no epic label, so
`EPIC_LABELS` is empty and both rules stay inert until one exists.

During `/resume`, overlap this board read with independent Git, open pull-request, and active-runtime ownership
reads; inspect every result before shortlisting. Reuse board facts instead of fetching each card again.


## Tracker changes

Use GitHub's native issue, dependency, assignment, pull-request, and Project operations under the applicable owner authority. Read the exact target before a write, make only the intended mutation, read it back, then run `npm run verify:board`. Unavailable or failing evidence stops selection or closeout. There is no local publication manifest, fingerprint transaction, mutable reconciler, or persistent Project credential.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
