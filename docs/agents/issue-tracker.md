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

## Project status contract

- `Ready`, `In progress`, and `In review` require an open issue with no open native blocker.
- A closed issue must use `Done`; blocked open work cannot use `Ready`, `In progress`, or `In review`.
- `Backlog` may contain blocked work or deliberately owner-gated unblocked work.
- Give owner-gated work the orthogonal `owner-gated` label. It stays out of the ready list and cannot use an active Status without an approved claim.
- Active Codex task ownership must be checked by the coordinator before selecting or changing an item to `Ready`. It is not inferred by the board verifier.
- Every issue uses an approved existing Project Area. Missing or unknown Area and Status values stop selection.

## Board intake

Run `npm run verify:board` before selecting work and after any issue, dependency, Project membership, field, assignment, or status change. During `/resume`, use `npm run verify:board -- --json`. Project 4 is authoritative for current membership; adding or changing an issue does not require a repository manifest edit.

The command is read-only. It fetches Project 4 fields and up to 100 items in one GraphQL request, continuing only the Project item connection when GitHub reports another page. Labels, assignees, field values, native blockers, `subIssuesSummary { total completed }`, and officially closing pull-request references (`first:20, includeClosedPrs:true`) travel with each item; an incomplete per-item connection fails instead of starting per-card queries. Classification happens once in memory.

The intake verifies the open Project identity, exact `Status` and `Area` options, complete item count, repository issue identity, issue state, labels, assignees, native blockers, lifecycle coherence, duplicates, and pagination. A malformed, archived, draft, pull-request, foreign, duplicate, truncated, or unknown required value exits non-zero. It does not freeze issue titles, acceptance-criteria prose, historical membership, or textual blocker sections.

With complete valid evidence, `--json` returns schema version 3, a `drift` array, and an entry for every open Project issue with its live Status, Area, labels, assignees, open blockers, and one classification: `active-owned`, `blocked`, `owner-gated`, `ready-for-human`, `ready`, `needs-info`, `needs-triage`, `wontfix`, or `drift`. Missing a triage label becomes `needs-triage`; conflicting triage labels fail. Human output groups the same entries and prints every drift finding with issue number, title, reason, and proposed correction. Drift exits non-zero after printing the complete report; malformed or unavailable evidence remains an intake failure.

Drift includes closed/non-Done and open/Done mismatches, open blockers with an unblocked Status, missing active assignees, officially closing merged pull requests on open issues, and open parents whose nonzero native child summary is fully completed. Merged references require owner review of completion or deliberately reopened scope. Completed children require parent acceptance review; the summary does not prove shipment or authorize closure.

An active leaf without an open officially closing pull request is flagged to check local/runtime ownership. Closed unmerged pull requests do not establish ongoing work. Parents with children are excluded from this heuristic. No finding authorizes tracker repair or local cleanup, and drifted issues never appear as ready work.

`active-owned` means the board item has an assignee or an active Project Status; it is not proof that a Codex task is running. The coordinator still checks live task ownership, reads candidate issue bodies and attributed comments, chooses priority, and proves file and behaviour isolation before parallel work.

During `/resume`, overlap this board read with independent Git, open pull-request, and active-runtime ownership reads; inspect every result before shortlisting. Reuse board facts instead of fetching each card again. One board request per page does not promise lower overall resume latency; measure live reads separately from planning and delivery.

For up to three shortlisted issues, send one aliased `gh api graphql` query under `repository(owner: "zaingulel", name: "RentCottage")`, using an alias per `issue(number: N)`. Select `id number state body repository { nameWithOwner }` and `comments(first:100) { totalCount nodes { author { login } authorAssociation body createdAt url } pageInfo { hasNextPage endCursor } }`. Recheck each issue identity and open state against the board, require every alias, and reject GraphQL errors or malformed responses. Preserve comment attribution; a null author is deleted/unknown, not an owner decision. Require comment count to match returned nodes and `hasNextPage` to be false before recommending that candidate. If incomplete, explicitly fetch the missing comment pages with cursors and confirm completeness, or exclude that candidate and report the gap. Retry only the named failed source.

Maintenance is one board query, parser, classifier, formatter, and focused test file. Remove them when Project 4 is retired as the authoritative selection surface or a native replacement supplies the same complete intake.

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
