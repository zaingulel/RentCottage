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
- Give ordinary owner-gated work the orthogonal `owner-gated` label. It stays out of the dependency frontier and cannot use an active Status without an approved claim.
- Active Codex task ownership must be checked by the coordinator before selecting or changing an item to `Ready`. It is not inferred by the board verifier.
- Protected foundation and D01 through D33 Areas are contract-driven. An ordinary issue uses an explicitly approved existing Project Area; adding it does not require a manifest edit. Missing or unknown Area and Status values stop selection.

## Board verification

Run `npm run verify:board` before selecting work and after ticket publication, dependency changes, Project reconciliation, or field changes. Project 4 is authoritative for current membership: adding a repository issue does not require updating a checked-in list. The verifier checks that required foundation items remain present and validates every current item for Area, Status, issue state, native blockers, duplicates, drafts, foreign content, missing data, and pagination. It also preserves the detailed D01 through D33 title, label, acceptance-criteria, blocker, and Area contract.

Historical issues #2 through #17 are the retired pre-map issue range: they must remain closed and excluded from Project 4, but are not required current membership.

The verifier requires GitHub CLI 2.48.0 or newer and checks this before querying GitHub.

The script is intentionally read-only. An unavailable API, unknown field, missing required item, malformed item, duplicate, foreign item, or truncated response exits non-zero. Update the detailed contract only when a protected foundation ticket or the D01 through D33 delivery graph changes; ordinary new Project issues need no repository edit. Remove the verifier only when Project 4 is formally retired as an authoritative selection surface or an equivalent deterministic guard replaces it.

## Tracker reconciliation

`npm run reconcile:board` is the read-only drift audit. It reads the protected repository contract and fresh GitHub Issues, native dependencies, pull-request links, and Project 4 state. Ordinary repository issues discovered on Project 4 need no checked-in membership entry: the audit validates their fields, blocker section, native dependency agreement, lifecycle state, and eligibility alongside protected issues. It reports the eligible unassigned dependency frontier but never chooses priority or safe parallelism.

Explicit lifecycle dry-runs are:

- `npm run reconcile:board -- --intent publish --issue <number> --area "<existing Project Area>"`
- `npm run reconcile:board -- --intent claim --issue <number> --assignee <login>`
- `npm run reconcile:board -- --intent review --issue <number> --pull-request <number>`
- `npm run reconcile:board -- --intent closeout --issue <number> --pull-request <number>`

`claim`, `review`, and `closeout` work for any well-formed repository issue already on Project 4. Ordinary `publish` requires `--area`, exactly one standard triage label, and exactly one canonical `## Blocked by` section. It preserves the live title and labels, treats that blocker text as the desired native dependency set, adds missing Project membership, and starts the item in `Backlog`. Only a fully evidenced ordinary issue whose sole triage label is `ready-for-agent` can enter the dependency frontier. A protected issue likewise requires its Project membership and complete contract title, acceptance criteria, Area, Status, labels, exactly one canonical `## Blocked by` section, blocker text, and native dependency evidence. Protected issues may omit `--area`; if supplied, it must match their contract Area.

Dry-run is the default. A write requires `--apply --plan-id <fingerprint>` using the exact SHA-256 fingerprint from the current dry-run. Apply mode re-reads before the first write, resolves fresh Project item, field, and option identifiers, applies one ordered mutation at a time, and authoritatively re-reads after every write or timeout. Each re-read must produce exactly the previously approved remaining operations in the same order; otherwise apply stops and requires a new dry-run. Reconciliation and the standalone verifier share the same 60-second GitHub subprocess timeout and bounded, normalized, redacted failure diagnostics without stdout. GraphQL semantic failures retain only their operation context, error count, and safe provider codes rather than raw response messages. The `errors` entry is absent when no errors occurred and must be an array whenever present; malformed shapes fail closed. Apply finishes by running `npm run verify:board`, so final verification uses that same provider boundary. The global audit never accepts `--apply`.

Exit statuses are `0` for a successful apply, `5` for a verified no-op, `2` for invalid arguments, `3` when a dry-run has proposed changes, `4` for incomplete or contradictory evidence, and `1` for an execution or final-verification failure. Output is bounded JSON and never contains credentials.

Run reconciliation through the lifecycle commands above using the operator's authenticated GitHub CLI session. `/resume` runs the independent verifier before work selection. After tracker publication or reconciliation, including claim, dependency, Project-field, review, and closeout changes, run `npm run verify:board`; unavailable or failing evidence stops work selection. No GitHub Actions workflow or persistent Project credential is required.

Maintenance is limited to this command, its focused tests, and provider-schema changes. Remove the reconciler when Project 4 is formally retired or an equivalent independently verified native transition mechanism replaces it; keep the read-only verifier until an equivalent guard replaces that oracle.

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
