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

1. Create each GitHub issue with its approved title, detailed acceptance criteria, D marker, and configured labels.
2. Add the approved textual blocker references and matching native GitHub dependency edges.
3. Add the issue to Project 4 and set its approved `Area` and dependency-safe `Status`.
4. Re-read issues, native dependencies, Project membership, and Project fields from GitHub after the writes. Never verify from the request payload or cached local mapping.
5. Run `npm run verify:board` and require exit status zero.

Do not describe work as "published and verified" if any step is missing, unavailable, truncated, unclassified, or failing. A partial write is an incomplete publication, not success.

## Project status contract

- `Ready`, `In progress`, and `In review` require an open issue with no open native blocker.
- A blocked or closed issue cannot use `Ready`, `In progress`, or `In review`.
- `Backlog` may contain blocked work or deliberately owner-gated unblocked work.
- Active Codex task ownership must be checked by the coordinator before selecting or changing an item to `Ready`. It is not inferred by the board verifier.
- `Area` is manifest-driven. Missing or unknown Area and Status values stop selection.

## Board verification

Run `npm run verify:board` before selecting work and after ticket publication, dependency changes, Project reconciliation, or field changes. The verifier checks exact membership, D01 through D33 mapping, titles, Areas, labels, acceptance criteria, issue state and Status consistency, blocker text, native dependencies, duplicates, drafts, foreign items, missing data, and pagination.

The verifier requires GitHub CLI 2.48.0 or newer and checks this before querying GitHub.

The script is intentionally read-only. An unavailable API, unknown field, missing item, unexpected item, duplicate, or truncated response exits non-zero. Update its manifest only when the approved delivery graph or Area classification changes. Remove it only when Project 4 is formally retired as an authoritative selection surface or an equivalent deterministic guard replaces it.

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
