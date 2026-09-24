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
3. Add the issue to Project 4 and set its approved `Workstream` and dependency-safe `Status`.
4. Re-read each issue body, its native dependencies and parent relationship, Project membership, and Project fields from GitHub after the writes, and compare every surface with the approved proposal. Never verify from the request payload or cached local mapping.
5. Run `npm run verify:board` and require exit status zero.

Do not describe work as "published and verified" if any step is missing, unavailable, truncated, unclassified, or failing. A partial write is an incomplete publication, not success. Fix only the approved target and never create a duplicate as a retry.

## Workstream convention

The Workstream options are the `ROUTING_OPTIONS` in `scripts/lib/board-config.mjs`. Product
feature/booking/payment/engineering → **Product**; GTM/launch/legal/promo, including the owner's own content →
**Go-to-market**; tooling/infra/dev-experience/process machinery → **Platform**.

## Issue body sections

Every issue body carries this section after the `to-issues` template's own.

### Preservation and out of scope

The existing contracts that remain unchanged and adjacent work excluded from this issue.

A new or substantially rewritten Booking or Payment story also shapes its acceptance criteria as
[Booking and payment story acceptance criteria](#booking-and-payment-story-acceptance-criteria) sets out. Testing
mode, observers, commands, and mutations belong to the architect's later plan unless the owner or normative
reference already fixed them.

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
[`docs/TESTING-STRATEGY.md`](TESTING-STRATEGY.md). Select evidence from the story's actual
claims. For new or rewritten Booking or Payment stories, this replaces the all-evidence-class template used for
[#34](https://github.com/zaingulel/RentCottage/issues/34) children; existing issue-specific acceptance remains
binding.

## Project status contract

The board is GitHub Project 4. [`scripts/lib/board-config.mjs`](../scripts/lib/board-config.mjs) is the single
home for its strings: the project identity, the Status columns, the columns work is picked from, the terminal
column, and the `Workstream` routing field with its approved options. A rename or a new option is one edit
there, except that renaming `Backlog` or `Done` also means editing the two Project automations below that
name them.

- Status columns, in board order: `Backlog`, `Ready`, `In progress`, `Awaiting push`, `In review`, `Done`.
- `Awaiting push` holds a card whose filled pull-request body is waiting for delivery approval; it waits on the
  owner, not on a session.
- Work is picked from `Backlog` and `Ready`. Readiness is the column an issue sits in, not a label: nothing about
  an issue's availability is inferred from its labels or its prose.
- `Done` is the only terminal column, so a card closed as superseded or not planned moves there too.
- Every card carries a Status and a `Workstream` from the approved option list. A card missing either is drift.
- A closed issue belongs in `Done` and an open issue does not.
- Active Codex task ownership is checked by the coordinator before moving an item into an in-flight column. The
  board verifier does not infer it.

The built-in Project automations below are enabled; `Auto-close issue`, `Pull request linked
to issue` and `Pull request merged` stay disabled. They have no create or update API, only
`deleteProjectV2Workflow`, so the owner sets them in the Projects UI. The `workflows` GraphQL field reads back
each automation's name and enabled state; the triggers and effects below are readable only on the workflow's own
page in that UI.

| Automation | Trigger | Effect |
|---|---|---|
| `Auto-add sub-issues to project` | an item in the project gains sub-issues | adds them to the project |
| `Auto-add to project` | a `RentCottage` item matching `is:issue is:open` is created or updated | adds it to the project |
| `Auto-archive items` | an item matching `is:issue,pr is:closed updated:<@today-2w` | archives the card |
| `Item added to project` | an issue or pull request is added | sets Status `Backlog` |
| `Item closed` | an issue or pull request closes | sets Status `Done` |

Three consequences the scan and the skills depend on:

- `Item added to project` sets Status alone, so an auto-added card carries no `Workstream` and rule 9 reports it
  as drift until one is set. Auto-add puts an issue on the board; it does not do `board-add.mjs`'s whole job.
- `Item closed` writes `Done`, but `closeout` moves the card explicitly anyway, so a silently failed `Item closed`
  is invisible rather than drift. A failed `Item added to project` is caught, because rule 9 sees the absent
  Status.
- An archived card leaves the `items` connection the reader walks, so the scan stops seeing it. Rule 1 in
  particular cannot flag a closed card left outside `Done` once that card goes two weeks without an update. The
  workflow's own page states that the `updated` operator makes the archive run every 12 hours.

## Board intake

One command reads the board and judges it from the same read, so the listing can never disagree with the verdict
printed under it. Run it before selecting work and after any issue, dependency, Project membership, field,
assignment, or status change.

| Command | Use |
|---|---|
| `npm run verify:board` | the pickable candidates grouped by `Workstream`, then the scan. `--all` shows every column, `--status=<name>` one column |
| `npm run verify:board -- --json` | the same normalized selection on stdout for `/resume`, with the scan on stderr |
| `node scripts/board.mjs --closeout` | the strict proof gate after a merge: the scan alone, sparing the advisory rows |

`npm run verify:board` is `node scripts/board.mjs`; the two spellings are one program.

The read is read-only and fetches Project 4's fields and every item through one paginated GraphQL walk. Labels,
assignees, field values, native blockers, `subIssuesSummary { total completed }`, and officially closing
pull-request references travel with each item, and every rule is answered off those pages. It is fail-loud: a `gh`
error, malformed JSON, or a zero-item read exits non-zero rather than printing an empty "nothing to pick" and
returning success. Drift also exits non-zero after printing the complete report.

Writes go through two commands, never a raw `gh project item-add`, which leaves a card with no Status and no
`Workstream`, or a raw `item-edit`, which takes hand-fetched ids and checks no Status name against the board's
options:

| Command | Use |
|---|---|
| `node scripts/board-add.mjs <issue#> <Status> <Workstream>` | put an issue on the board with both fields set |
| `node scripts/board-move.mjs <issue#> <Status>`, or `--batch <issue>:<Status> ...` | move one card or many, resolving the shared field id once |

The scan reports these findings. An advisory row informs the next pick; every other row also fails `--closeout`:

| # | Finding | Severity |
|---|---|---|
| 1 | issue closed but its card sits in a non-terminal column | gate |
| 2 | issue open but its card sits in `Done` | gate |
| 3 | open native blockers on a card outside `Backlog` and `Done` | advisory |
| 4 | an in-flight card with no assignee | advisory |
| 5 | a merged officially closing pull request over an open issue | gate |
| 6 | an in-flight card with no closing pull request at all, merged or draft; `Awaiting push` and epics are exempt | advisory |
| 7 | an open epic whose every child issue is closed | gate |
| 8 | an epic claimed in-flight with no children | advisory |
| 9 | cards missing Status or `Workstream`; a mass outage summarises to one field-schema line instead of per-card blame | gate |

Rules 3 and 5 read GitHub's native dependencies and officially closing references only. A pull request that merely
mentions an issue is not proof of shipment, and a textual blocker section is not a contract. No finding authorises
creating, applying, renaming, or removing a label, repairing the tracker, or local cleanup, and drifted issues
never appear as ready work.

Rules 7 and 8 key off the `type:epic` label. Apply it to an issue that exists to wrap native sub-issues, so the
scan can tell a finished wrapper from an unstarted one.

During `/resume`, overlap this board read with independent Git, open pull-request, and active-runtime ownership
reads; inspect every result before shortlisting. Reuse board facts instead of fetching each card again.

## Candidate fetch

For up to three shortlisted issues, send one aliased `gh api graphql` query under `repository(owner: "zaingulel", name: "RentCottage")`, using an alias per `issue(number: N)`. Select `id number state body repository { nameWithOwner }` and `comments(first:100) { totalCount nodes { author { login } authorAssociation body createdAt url } pageInfo { hasNextPage endCursor } }`. Recheck each issue identity and open state against the board, require every alias, and reject GraphQL errors or malformed responses. Preserve comment attribution; a null author is deleted/unknown, not an owner decision. Require comment count to match returned nodes and `hasNextPage` to be false before recommending that candidate. If incomplete, explicitly fetch the missing comment pages with cursors and confirm completeness, or exclude that candidate and report the gap. Retry only the named failed source.

## Tracker changes

Use GitHub's native issue, dependency, assignment, pull-request, and Project operations under the applicable owner authority. Read the exact target before a write, make only the intended mutation, read it back, then run `npm run verify:board`. Unavailable or failing evidence stops selection or closeout. There is no local publication manifest, fingerprint transaction, mutable reconciler, or persistent Project credential.

Changing a single-select field's option list with `updateProjectV2Field` replaces every option with a new id and
blanks that field on every card. Snapshot each card's value first, then restore it against the new ids and diff the
read-back against the snapshot before touching anything else.

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
