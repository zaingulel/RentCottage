---
name: resume
description: Resume work in this repository from durable state. Use when the owner starts or continues a work session, returns to unfinished work, or asks what to work on next.
effort: medium
---

# Resume

Git is the state. A branch is a job; a draft pull request is its handoff; the board says what is planned.

## Before intake

Check first that this runtime is running the repository's hooks: one it has not loaded or trusted does nothing,
and no notice from the runtime can be relied on to reach the owner. Run `git commit --no-verify --dry-run` as one
command on its own; it commits nothing. The git guard is running only when the result is the guard's own
refusal, carrying the words `Blocked: git commit`; then say nothing about hooks and continue. Any other result,
whether git's output, a permission prompt or a refusal in other words, means it is not running. Tell the owner so
before anything else, in plain words: this session's git guard is off, the turn-end check may be off with it, and
the fix for this runtime. On Codex the owner has Codex trust the project, removes any `hooks = false` or
`codex_hooks = false` under `[features]` in the Codex `config.toml`, then runs `/hooks` in the Codex command line
at the repository root and trusts the repository's hooks; on Windows add the Codex shell-command limit
`docs/AI-WORKFLOW-runtimes.md` names, which trust does not lift. On Claude Code, which has no hook trust step, the owner
starts the session at the repository root or a job worktree root with `disableAllHooks` turned on in no settings
file or start option; `/hooks` there lists the hooks that session has configured. When the result itself reports
that a hook failed to start, name that failure and its remedy in place of the fix above, such as restoring Node
to the command path. Run the command again when the owner reports the fix done. A refusal shows the git guard
alone, because Codex trusts each hook separately: never report the handoff check or the turn-end check as
verified.

Fetch `origin/main` with `git fetch --no-prune origin main` and record the fetched commit. If fetching fails,
report freshness unavailable and do not select work from stale board evidence. Load `AGENTS.md`, this skill, and
[Update local main](../closeout/SKILL.md#update-local-main) from that commit under the Instruction reuse rule
below, then apply that fetched procedure to the actual `main` checkout. The coordinating resume session may update
it when no other task owns it. After a successful update, verify the recorded target and cleanliness before using
verifier code. If the checkout is retained, report its path, branch and reason;
continue from fetched instructions read-only and choose verifier code at the recorded target: use a usable existing
isolated checkout first, otherwise create a fresh verifier-only worktree without duplicating a job. A verifier-only
worktree this run created is removed at the end of the same run, after board operations, with
`git worktree remove <path>`; a reused existing checkout is left alone. If no current verifier checkout is
available, report board freshness unavailable rather than presenting stale local code as current evidence.

**Instruction reuse.** Record the fetched target commit and required instruction paths. Reuse previously read text only
when its full content remains in active context and its exact read Git revision is known: both
`git rev-parse <read-revision>:<path>` and `git rev-parse <target>:<path>` must succeed and return identical blob IDs.
Otherwise read the required content from the recorded target with `git show <target>:<path>`. Missing objects, failed
commands, or failed or truncated content reads are unavailable evidence, never permission to reuse. Autoloaded text
without verified read provenance, summaries and dirty disk content establish no identity. Retain provenance only in this
session, with no cache or tracked state; apply the rule whenever the target changes, including the post-selection fetch.
Instruction identity does not waive verifier target, cleanliness or ownership checks.

## 1. Find where things stand

- After the refresh barrier, use existing runtime parallel or background calls to overlap `node scripts/board.mjs`,
  local inventory (`git status`, `git branch --show-current`, `git worktree list`), pull-request summaries
  (`gh pr list --author @me --state open --json number,title,headRefName,isDraft,url`), the factory lag check,
  tooling counts and conditional sweep discovery below. Run verifier commands only from a checkout verified clean
  at the recorded target. Collect every exit status and stderr and finish the reads before reconciliation writes.
  The board command lists and judges the same complete paginated read: exit 1 with drift rows is reconciliation
  to do before work-pick, while `board: failed to read` on stderr means board freshness unavailable.
- Capture large responses once with native stdout redirection to session-owned scratch, including board output
  and issue details. Check each authoritative outcome, including board drift, then read non-overlapping bounded
  character ranges until all required
  fields are exposed, including very long lines. Never refetch because display truncated or assume omitted detail;
  unreadable or incomplete output is unavailable evidence. This is ephemeral output handling, not a reusable cache.
- After the batch, recheck verifier `HEAD` and cleanliness. Movement invalidates affected checkout-derived evidence;
  use Before intake's verifier-selection procedure again before verifier operations. GitHub reads are observations
  at their recorded times, not an atomic snapshot: conflicting facts or reconciliation writes require refreshing
  only the affected evidence before decisions.
- During intake, from the root checkout, inspect another job's worktree with `git -C <path>`, never by `cd`. On
  Claude Code, `EnterWorktree` records the shell's current folder as the one `ExitWorktree` later returns to, and
  a sibling job's closeout may remove that folder, leaving this session unable to leave its own worktree.
- Run `node scripts/factory-sync.mjs --check` in the same refreshed checkout and report its result at work-pick in
  one advisory line: exit 0 is in sync; exit 1 is lag, naming the paths it lists, reported as information: an
  ordinary shared change opens no sync card, and a sync card is opened only on the owner's decision, when one sync
  job clears every listed path at once (`AGENTS.md`, Shared workflow adoption, and the
  [`sync-job`](../sync-job/SKILL.md) skill); exit 2 is lag unknown with its stated cause, never reported as in sync. The
  result never blocks work-pick.
- Report in one advisory line, with no threshold, the size of the workflow tooling (scripts, tools and hooks, their
  tests counted apart) and its time-limit declarations, each a test or suite setting its own time limit on one line,
  at the recorded `origin/main` commit and at the newest `main` commit at least 30 days old,
  `git rev-list -1 --before=30.days.ago origin/main` (the machinery rule under "4. Plan"). For each of the two
  commits `<rev>`, size prints tooling files, tooling lines, test files and test lines:
  `git grep -c -e '^' <rev> -- scripts tools .claude/hooks .codex/hooks .githooks | awk -F: '{ if ($(NF-1) ~ /\.test\./) { tf++; tl+=$NF } else { f++; l+=$NF } } END { print f+0, l+0, tf+0, tl+0 }'`
  and the declaration count is
  `git grep -c -E 'test\.setTimeout\(|test\.slow\(|[Ii]nfo(\(\))?\.(setTimeout|slow)\(|describe\.configure\(\{[^}]*timeout|^[[:space:]]*(test|it|describe)\([^;]*\{[[:space:]]*timeout:' <rev> -- tests scripts tools | awk -F: '{ s+=$NF } END { print s+0 }'`.
  A directory absent from a tree counts zero. When `rev-list` prints nothing or `git cat-file -e <rev>` fails, that
  commit's half is reported unavailable, never as zero.
- A branch with an open draft pull request is unfinished work. Use the summaries to identify relevant unfinished
  jobs, then read only their bodies: the "Not done" section says where to pick up.
- The board output for planned work. Prefer `Ready` work matching the owner's latest objective;
  `Backlog` remains eligible. `Ready` means startable in the next session with no missing owner decision,
  external dependency, or scheduled date; a card waiting on any of those goes to `Backlog` with its trigger
  named in a comment. A card in `In progress` with no branch or pull request behind it may be another machine's or
  session's job, since a job branch stays local until push: never return it to `Ready` on the session's own
  judgment and never offer it as a candidate row. Show it to the owner at work-pick with its latest comment
  starting `Claim:`, or say it has none, and return it to `Ready` only on the owner's say.
- If the Conventions table in `.agents/REPOSITORY.md` marks the documentation routines active, intake sweep-triage cards
  as `docs/SWEEP-TRIAGE.md` describes: the day-after triage routine files issues it cannot card. Before
  work-pick, list them with
  `gh issue list --state open --author @me --limit 100 --json number,body --jq '[.[] | select(.body | contains("Sweep triage: source #"))]'`
  and retain those bodies for the detail batch below, requesting only still-missing fields. Complete that batch
  before triage writes. For each the board output does not show, card it with
  `node scripts/board-add.mjs <issue> Backlog <Workstream>`, the Workstream the issue body names, only when the
  owner-authored verdict comment on the sweep pull request its marker cites lists that issue number; otherwise
  report it at work-pick and card nothing. For every marker issue that verdict comment lists, whether or not it is
  already on the board, while its body still carries a `Blocked by:` line, create each link with
  `gh issue edit <issue> --add-blocked-by <n>`, then remove the line from the body, so the link is the only
  record.

## 2. Work-pick (owner gate one)

Keep every worthwhile Ready or Backlog recommendation, with no arbitrary shortlist. Read needed issue details
in the initial aliased batch, including candidates, unbacked In-progress claims and sweep-triage needs; request
each needed field or page once per intake observation and reuse discovery fields already read. Preserve bodies, parent, blocker states
and comments, including the latest `Claim:`. Reuse these details for planning after selection unless changed
evidence invalidates them. Never issue one `gh issue view` per card.

Capture the full response from this query, replacing the example aliases and numbers with needed issues and
omitting only fields already read for an issue. Require command success, no GraphQL errors, and every requested
issue identity present and non-null before consuming its details. Partial errors, missing issues or unreadable
scratch are unavailable details; unresolved required facts prevent presenting the affected choice as startable.
Set `intake_scratch` to this session's own scratch directory and read the captured response fully through the
bounded-output procedure above.

```sh
gh api graphql -F owner='{owner}' -F name='{repo}' -f query='query($owner:String!,$name:String!){ repository(owner:$owner name:$name) { CANDIDATE_1_ALIAS: issue(number:CANDIDATE_1_NUMBER) { ...Card } CANDIDATE_2_ALIAS: issue(number:CANDIDATE_2_NUMBER) { ...Card } } } fragment Card on Issue { number title body parent { number } blockedBy(first:50) { nodes { number state } } comments(last:20) { nodes { body } pageInfo { hasPreviousPage startCursor } } }' > "$intake_scratch/candidate-details.json"
```

For a required Claim, inspect each comment page in reverse chronological order. If no `Claim:` is found and
`hasPreviousPage` is true, fetch the preceding page with `comments(last:20, before:<startCursor>)` and continue
until the first Claim or exhausted history. Say no Claim only after exhaustion; a failed or missing page leaves
that fact unavailable. Every continuation retains command-success, GraphQL-error, issue-identity and bounded
capture checks above. Never refetch an already-read page merely for display.

State the session's own model in one line, then always present this table, even for one candidate:

| # | Card | Outcome for the user | Why now, and the risk | Gates it triggers | Route and why | Startable now? |
|---|---|---|---|---|---|---|

An open `type:epic` parent is never a candidate row; its next unblocked child is, and a child with an open blocker
is not offered. Gates are read off AGENTS.md, Owner gates and Review: owner direction, sign-off, architect plan,
screenshot, security review, Greptile, and any further gate the Surfaces table in `AGENTS.md` names. Route names
the build seat (`builder-max`, `builder`, or `builder-lite`), whether the architect runs, and the reason from
residual judgment, uncertainty, failure consequence, and verification strength. Close with one line recommending
a row number, then stop; no acceptance-criteria list is presented. The owner's pick of any row is the work-pick approval of that card's
outcome and acceptance criteria as written, and it starts the job with no further confirmation; planning
proceeds autonomously after it. One issue per branch. Two issues may run in parallel only when their files are
disjoint.

## 3. Start the job

- After selection, fetch `origin/main` again with `git fetch --no-prune origin main` and record the new target;
  load its required instructions under the Instruction reuse rule in "Before intake" before proceeding.
- On Claude Code, the coordinating session is started at the root checkout, never with the desktop app's worktree
  option: auto-archive removes that worktree at merge, before closeout can leave it. Confirm with `pwd` that the
  shell is in the root checkout, because `EnterWorktree` records the shell's current folder as the one
  `ExitWorktree` returns to; immediately after, run
  `git worktree add .claude/worktrees/job-<issue> -b job/<issue> <recorded-origin-main>` and enter it with
  `EnterWorktree`. `.claude/worktrees/` is the one location a session may enter without the owner approving the move:
  Claude Code asks whenever a session takes its working directory to a path outside the repository's
  `.claude/worktrees/`. `EnterWorktree` isolates the session, so the runtime refuses what it cannot verify stays
  inside this worktree: a git command redirected by `git -C`, `--git-dir` or a leading `cd`, for example, or one
  whose shape is too complex for it to judge. Plain, separate git commands run from the worktree are the working
  form. The same check can take the letters `git` inside a longer word or a file path for a git command and refuse
  a command that runs none. Such a refusal is that check, not a git problem: the file is never renamed or left out
  of a run, and the command is rerun in the form the repository's `docs/TESTING-STRATEGY.md` names for a focused
  run in a job worktree.
- On Codex: a Codex-managed worktree per chat, or
  `git worktree add ../jobs/<issue> -b job/<issue> <recorded-origin-main>`.
- Before edits in any newly created runtime worktree, require `git rev-parse HEAD` to equal that newly recorded
  commit. Preserve and report a mismatch before edits.
- Keep scratch files, plans, and local draft or review prompts inside the job worktree where possible;
  the existing gitignored .claude/worklog area is suitable. Retain artifacts needed for unfinished work or
  handoff. Apply routine scratch cleanup through [closeout step 5](../closeout/SKILL.md) under `AGENTS.md`'s
  Disposable job cleanup authority.
- Builders work inside the job worktree, one at a time. Two slices with disjoint files may run at once: from the
  job worktree, give the second its own branch and worktree with
  `git worktree add -b slice/<issue>-<name> <path> job/<issue>`, since git refuses to check the job branch out in a
  second worktree. Once that slice is green and committed there, run `git merge --no-edit slice/<issue>-<name>` in
  the job worktree, then `git worktree remove <path>` and `git branch -d slice/<issue>-<name>`. A runtime's own
  subagent worktree branches from `main`, not the job branch, so it is not used for builders.
- Move the card to `In progress`: `node scripts/board-move.mjs <issue> "In progress"`, and claim it with
  `gh issue edit <issue> --add-assignee @me` — active work with no assignee is reported as drift. Then post the
  claim where every machine can see it, with `gh issue comment <issue> --body "Claim: <machine>, <runtime>, <time>"`:
  the machine is what `hostname` prints, the runtime is Claude Code or Codex, and the time is what
  `date -u +%Y-%m-%dT%H:%MZ` prints, each read first and typed in as a literal. Run `npm ci`
  in a fresh checkout, then confirm `git config --get core.hooksPath` prints `.githooks`; when it does not, run
  `git config core.hooksPath .githooks` and report it.

## 4. Plan

- Plan-first surfaces are the Surfaces table's `plan-first` row. They get an `architect` plan and one read-only
  plan review before any build. Any other card with design choices still open after work-pick gets an
  `architect` plan. Everything else gets a short plan in the pull request body.
- The plan review runs the `plan-reviewer` charter on the Codex seat, Sol at extra-high effort, on both runtimes.
  A Claude session reaches it through `cross-review` section 4, which runs that charter through the Codex command
  line, read-only, with the card and the plan inlined; a Codex session dispatches its own seat. When the Codex
  seat cannot be reached, its provider out of usage, unauthenticated or failing, the plan does not wait: the
  Claude `plan-reviewer` seat, Opus at high effort, reviews instead by the fallback route of that section, and the
  pull request body records which seat reviewed the plan, that Codex was unavailable and how that was established,
  and that the Sol extra-high plan review was therefore not met. As in section 6, that recording is the whole of
  the exception: a substitution the body does not declare is a skip. A plan review that failed or was capped for
  any other reason is run again, never substituted.
- Every plan follows `docs/CODING-STANDARDS.md`, the session's own short plan for a card without an architect
  included, because a builder cannot change a plan once it arrives.
- Every plan, the architect's and the session's own short plan alike, first considers doing less or a native feature,
  then weighs a mechanism's recurring run time and upkeep against the failure it prevents, states that cost for any
  new or extended test or tooling, and names existing machinery the change makes unnecessary. The build-seat choice
  keeps its own rule: cost and latency break only equal-reliability ties. Use `builder` for bounded substantive
  implementation, `builder-max` from the outset when uncertainty or failure consequence warrants deeper reasoning, and
  `builder-lite` only for mechanical edits with strong verification and no remaining judgment.
- Before dispatching an `architect`, the coordinating session runs `explorer` first when discovery exceeds a
  couple of files. Each explorer writes its completed findings with `file:line` references and explicit
  unresolved gaps to its own distinct named findings file, such as `.claude/worklog/<branch>-discovery-<name>.md`;
  the handoff's `Discovery:` line carries every findings file path. For discovery confined to a couple of files, the line carries the
  session's own completed findings with the same references and gaps. Discovery is never a list of places to
  search. On an unplanned Discovery return, the coordinating session completes the missing discovery under this
  rule, then redispatches the architect; that return is exempt from the bounded non-delivery rule.
- Every `architect` dispatch is a filled copy of `.agents/templates/planner-handoff.md`.
- A plan names its scope: the files each slice changes and the claim each slice proves, never a line estimate.
  Size is the owner's judgment before work-pick, through the `to-issues` size signals; after work-pick no seat
  splits, stops or replans work for its estimated or actual size. An architect's finding that the card holds more
  than one independently demonstrable outcome goes to the owner as a split proposal before any build, and the
  session never narrows such a plan inline or merges slices to fit. A card that came out of a split is never split
  again on a session's own judgment; only the owner starts another split. A parser, state machine, or general
  framework the outcome did not name is a scope change and goes back to the owner before it is built.
- Every coherent claim gets one construction mode from `docs/TESTING-STRATEGY.md`.
- **Machinery rule.** New executable machinery in the workflow itself, including test scripts, harnesses, runners, and
  test-only tools (product code and ordinary tests added to existing suites are exempt), needs one of: a control failure
  a sentence in `AGENTS.md` or in a skill could not prevent twice, the same measurable friction across three independent
  jobs, a required new runtime or provider integration, or externally imposed security or platform drift. The friction
  route admits machinery only after the card's What to build names the friction and what doing less was tried first:
  fewer checks, deleted work, or a native feature. A store, cache, capture, retry, route, tracked input or repeated run
  added to existing machinery meets the same bar as new machinery. This rule is the one home for how machinery leaves: a
  job that removes a friction another way deletes the machinery that friction admitted, and a card that rewrites a
  testing strategy, a coding standard or the workflow text of `AGENTS.md` lists the machinery it keeps and settles keep,
  shrink or delete for each.

## 5. Build

- Every edit goes to `builder-lite`, `builder`, or `builder-max` through `.claude/templates/builder-handoff.md`;
  the session never builds (AGENTS.md, Runtime notes). Builders never run the full suite, never commit.
- Commit on the job branch after every green slice. Uncommitted files survive a crash but not a stray checkout,
  and the next session reads the branch, not the worktree, to see what was already green. A local commit needs
  no authorisation; only the push does. Commit green work before any stop, handoff, replan or split proposal as
  well, so nothing green waits uncommitted in the worktree.
- Wrap every executed check in `node scripts/run-log.mjs <label words> -- <command>` (plain unquoted label,
  then a bare `--`) so the exit code is recorded by a script, not asserted: focused tests, the one executed mutation per behaviour (red, restore, green), lint,
  and the convergence checks `docs/TESTING-STRATEGY.md` names. The log lives at `.claude/worklog/<branch>.md`.
  On every agent-initiated rerun, supply a nonblank diagnosed reason through `RUN_LOG_RERUN_REASON`; for example,
  `RUN_LOG_RERUN_REASON='Changed the failing assertion' node scripts/run-log.mjs focused -- npm run lint`.
- When two repair-and-re-review cycles still produce true findings, new or repeated, judge them. If each is bounded
  and verifiable, run one more round that fixes all of them. Bring the owner the choice, with a recommendation, only
  when a finding needs an unsettled design, owner judgment or evidence that cannot be bounded, or when that round
  still does not converge. Findings are never ignored.
- Regenerate any artifact the Conventions table's `generated artifacts` row names and commit it with its source;
  the Stop and pre-commit hooks enforce it.
- **Waiting.** A Codex session waiting on a helper calls `wait_agent` with `timeout_ms: 3600000`, the maximum: the call
  returns the moment a helper finishes, so a shorter timeout only adds wake-ups, and the session never sleeps and checks
  in a loop. A command that runs for minutes on Codex runs in one `exec` cell whose first line is
  `// @exec: {"yield_time_ms": 3600000}`; inside it `tools.exec_command` yields after at most 30 seconds, so the cell
  polls the returned `session_id` with `tools.write_stdin({ session_id, chars: "", yield_time_ms: 300000 })` until
  `exit_code` is set and returns once, and if the cell yields early the session calls `wait` on its cell ID with the
  same `yield_time_ms`. On Claude Code the same command runs through `Bash` with `run_in_background: true`, which
  re-invokes the session when it exits.

## 6. Verify and review

- Drive visual work as the Conventions table's `visual verification` row says, and display the screenshot inline
  in chat. No push authorisation is requested without it. Use representative views to demonstrate the changed
  interaction and its relevant visual risks, with at most ten screenshots total per pull request and fewer when
  sufficient. Reuse captures from required verification; do not rerun tests solely to collect screenshots. Visual
  verification coverage does not require an image for every screen, state, language or viewport.
- Run every check the Surfaces table's rows name for a surface the diff touches.
- Before dispatching the review, find in the worklog the failing run each `strict-tdd` claim logged before its fix.
  A claim with none goes to the owner, before the review runs, as a decision on accepting it without that red run;
  the mutation's red run, logged after the fix, never stands in for it.
- One fresh review of the final tree, at the tier two questions choose. Both are asked of every change: can it be
  undone, and how far does the damage reach if it is wrong. Each repository says what the two questions mean for it in
  the `hard to undo` and `wide reach` rows of its Surfaces table.
  - **Hard to undo** is judged looking forward: once the change is published or adopted, could it be put right by a
    known correction under the repository's own control? A change that could not is hard to undo, and the
    `hard to undo` row names what could not, which in one repository or another is a release, a GitHub setting or
    ruleset, a data migration, a leaked secret, or anything an adopter would have to repair itself. That git can
    revert the commit never makes a change easy to undo. That an adopter has already copied it never makes one hard
    to undo, because at review time none has.
  - **Wide reach** is a shared file, which is a file the manifest lists, or a file that directs every later session in
    the repository, which the `wide reach` row names.
  - An answer the two rows do not settle is taken as hard to undo, or as wide in reach. A mixed diff is assessed whole
    and takes the heaviest tier any part of it takes, and line count never lowers a tier.
- The two answers choose one of three tiers, each recorded in the review line under its name.
  - **`document`: the session reviews its own work.** The lightest tier is anchored, never judged: it is exactly the
    change the repository's gate for the direct route admits whole. On the committed final tree, record
    `git merge-base origin/main HEAD` as `<base>` and `git rev-parse HEAD` as `<head>`, check the gate with
    `test -x scripts/gates/pre-push-main`, then run `scripts/gates/pre-push-main <base> <head>`. Exit 0 is this tier.
    Any other exit is not, and neither is a gate that is missing or not executable, so a repository without the gate
    has no such tier. The guard rule below wins over the gate's exit: a change that touches the gate, its classifier
    or anything else the guard rule names is never this tier. A refusal from the gate at deliver withdraws this tier:
    the change returns to this section at the `code` tier before the pull request opens. Where the gate judges
    changed lines it admits a **setting-only seat change**, the one change to a shared file that stays at this tier. A
    seat change is setting-only when each changed seat file differs only in model, effort or turn-limit lines of its
    settings block (`model`, `effort` or `maxTurns` in a Claude seat's frontmatter, changed, added or removed; `model`
    or `model_reasoning_effort` above a Codex seat's `developer_instructions`, changed in value only), and the manifest
    differs only in the hash recorded for each such file.
  - **`code`: cross-family review.** Every other change below the `sign-off` tier: one easy to undo but wide in reach,
    one hard to undo but narrow in reach, and one easy to undo and narrow in reach that the gate does not admit, so a
    small test in a file only one repository has is reviewed here. `AGENTS.md`, `CLAUDE.md`, `.agents/REPOSITORY.md`,
    the rules, skills and every other seat-file change (instructions, tools, permissions, or any other line) are
    included. The `reviewer` charter is run by the model family that did not write the diff, through `cross-review`;
    an instruction that misreads a gate has cost more than most code. When the other family's seat cannot be reached,
    its provider out of usage, unauthenticated or failing, the branch does not wait: run the same `reviewer` charter
    on this family's own seat, and record in the pull request body which family reviewed, which was unavailable and
    how that was established, and that the cross-family gate was therefore not met. That recording is the whole of
    the exception: a substitution the body does not declare is a skip, and a skip is neither unavailability nor a
    clean review.
  - **`sign-off`: cross-family review, then Greptile.** A change that is both hard to undo and wide in reach: the same
    cross-family pass, its unavailability route included, then Greptile on the draft in section 8. A `sign-off` tier
    diff whose other family is unavailable and whose Greptile attempt settles as `UNAVAILABLE` by either of the routes
    section 8 step 2 points to proceeds on the substituted pass plus that record, both declared in the pull request
    body, because there is no further reviewer to wait for.
- A guard keeps the heaviest tier in both directions. The rule covers a guard, which is a hook, a permission rule or a
  ruleset that refuses an action, a gate a guard runs, and its classifier, with every surface in the Surfaces table's
  `sign-off` row: a change to any of them is `sign-off` tier whether it loosens or tightens and whatever the two
  answers or the gate's exit give, so a one-line change there is `sign-off` tier. The manifest is in this rule by
  what an entry names: adding or removing the entry of a guard, a gate, a classifier or a hook configuration is a
  change to that guard, while a hash line `node scripts/factory-sync.mjs --write` re-records for a file the same
  change edits takes that file's tier. A guard that has no file, a ruleset or other GitHub setting, is changed only
  with its read-back: before the change the owner signs off the planned state; after it, the commit that records the
  applied state in the repository's record carries the setting read through `gh api`, bypass list included, and that
  commit is the diff the `sign-off` tier reviews, whatever the gate says of its paths.
- `security-reviewer` only when a change widens a surface in the Surfaces table's `security review` row.
- Under the review line, the pull request body records both answers and why: a line beginning `Undo:` that reads
  `easy` or `hard` with one sentence of reason, a line beginning `Reach:` that reads `narrow` or `wide` with one
  sentence of reason, and one sentence more where the gate's exit or the guard rule set the tier. A Greptile review
  not requested on tier grounds is neither `UNAVAILABLE` nor a clean review.
- Fix each true finding by the cheapest valid fix it names. A true finding whose every fix costs more than it is worth
  goes to the owner as a plain-language decision, and the owner may set it aside as deferred; a finding is dismissed,
  with a reason, only when it is false. Then one pass scoped to the repaired hunks and what they can break, by the
  same reviewer with its context intact or by the session. No further pass when a repair adds no factual claim. Record
  the review in the pull request body's review line, in the format
  [the workflow manual](../../../docs/AI-WORKFLOW.md#the-review-line) specifies.

## 7. Push authorisation (owner gate two)

Move the card to `Awaiting push`: `node scripts/board-move.mjs <issue> "Awaiting push"`. Fill
`.github/pull_request_template.md` as the pull request body and show it to the owner with the screenshot.
The owner still sees that same filled body in chat, with the review line at tier `document`; on the direct
route section 8 describes, that shown body becomes the squash commit's message, since there is no pull request
to hold it. The job's own `Closes #<issue>` line is the only closing word in a pull request body or a
direct-route commit message: GitHub closes, as completed, any issue whose link follows close, fix or resolve in any
tense, another repository's `owner/repo#N` included. Every other mention, such as a covered sync card or the
canonical repository's card for a deferred finding, which `to-issues` step 6 says how to file, keeps those words
from directly before its link. The owner's yes, or any instruction to push, covers every step of section 8: the
push, the draft pull request, the `@greptileai` comments, repairs on the same branch, rebasing onto `main`, marking
ready, and the auto-merge. Nothing in section 8 stops to ask again; a public comment there is delivery, not a new
action. Push only after it.

## 8. Deliver

After the rebase in step 1, the session checks eligibility for the direct route: record `git rev-parse origin/main`
as `<origin-main>` and `git rev-parse HEAD` as `<head>`, then check the gate with `test -x
scripts/gates/pre-push-main`. A repository where that gate is missing or not executable has no direct route: the gate
is not run and the job takes the pull request route below. Otherwise run `scripts/gates/pre-push-main <origin-main>
<head>`; exit 0 means the whole change qualifies for the direct route, any other exit means the pull request route
below. A change section 6 places above the `document` tier takes the pull request route whatever the gate's exit.
On the direct route: settle the convergence checks exactly as step 1 names on `<head>`, so their receipts carry
`head=<head>` except a marked check's receipt reused under step 1, and those receipts replace any the approved body quoted
for an earlier head; disclose any reused receipt's head and documentation-only difference in that body, and nothing
else in that body changes. Then squash the job with `git reset --soft <origin-main>` and `git commit` into one commit whose
message is the pull-request title, a blank line, the same filled body shown to the owner with its review line and
receipts so replaced, a blank line, `Closes #<issue>`, and the attribution lines. Before pushing, confirm `git
rev-parse HEAD^{tree}` equals `git rev-parse <head>^{tree}`, so the pushed commit carries exactly the content the
receipts checked; a mismatch stops the route and the checks are settled again. Then push with `git push origin
HEAD:main`, whose pre-push hook re-runs the gate and refuses a change that does not qualify. The draft, Greptile, ready,
auto-merge and merge-watch steps below are skipped, and `closeout` runs. A refusal from the gate means the pull
request route, never a workaround.

1. Rebase onto `origin/main`, then settle each convergence check the testing strategy names: reuse its latest
   worklog receipt for the same command when that receipt reads `exit 0`, its `head=` is exactly the current
   `git rev-parse HEAD`, its `tree=` is `clean`, and `git status --porcelain --untracked-files=normal` still prints
   nothing; otherwise run the check again. A no-op rebase leaves `HEAD` unchanged and keeps the evidence; a rebase
   onto a moved `main` changes `HEAD` and normally needs the rerun, as does a dirty tree or a missing, failed or `unknown`
   receipt. Exception: a convergence check the repository's testing strategy marks for receipt reuse across a
   documentation-only difference may reuse its latest same-command receipt from a different
   known head only when it reads `exit 0` and `tree=clean`, the current worktree is still clean, the repository has an
   executable `scripts/gates/pre-push-main`, and a successful complete
   `git diff --name-only --no-renames <receipt-head> <current-head>` lists only documentation paths under that gate's
   existing path definition, excluding its setting-only seat and manifest exceptions; missing commits, unavailable
   classification, or any other changed path require the full rerun, a check the strategy does not so mark (every
   check where it marks none) still requires the current head, and the pull request body names the reused receipt's
   head and the documentation-only difference. Second exception,
   on the pull request route only, because the direct route has no hosted check: after a rebase onto a moved `main`,
   any convergence check, marked or not, may reuse its latest same-command receipt from a different known head when all
   of these hold. The receipt reads `exit 0` and `tree=clean`, and the current worktree is still clean. The
   repository's testing strategy records that the hosted required check runs that check; a check it does not so record
   still reruns on the current head. No commit of the job changed: with `<old-base>` as
   `git merge-base <receipt-head> origin/main` and `<new-base>` as `git merge-base HEAD origin/main`,
   `git range-diff <old-base>..<receipt-head> <new-base>..HEAD` succeeds and every row is `=`, and, because
   `range-diff` compares no merge commit, `git rev-list --merges <old-base>..<receipt-head>` and
   `git rev-list --merges <new-base>..HEAD` both succeed and print nothing. The incoming changes do not overlap the
   job's: `git diff --name-only --no-renames <old-base> <new-base>` and
   `git diff --name-only --no-renames <new-base> HEAD` both succeed and no path appears in both lists. A missing
   commit, a failed command, any `!`, `<` or `>` row, a merge commit in either range, or a shared path requires the
   rerun. The comparison is always against the receipt's own head, however many times `main` moved since. The hosted
   required check on the rebased head is then the proof for that head, and the pull request body names the reused
   receipt's head, the current head and both comparisons. The pre-push hook still runs its own gates on every push. Then push;
   `gh pr create --draft --body-file <body>` with `Closes #<issue>` in the body. Greptile is requested only for the
   sign-off tier in section 6; the other tiers go straight to step 3. Move the card to `In review`.
2. For the sign-off tier, read the [`greptile`](../greptile/SKILL.md) skill and follow it on the open draft; it owns how
   the review attempt is made and settled.
3. Re-read the open draft and require current local evidence, every finding/thread resolved, and a review line
   that matches the rounds actually run and the findings actually raised and settled. For the sign-off tier, also
   require the same reviewed head and a settled `COMPLETE` or `UNAVAILABLE` attempt. If a rebase is needed, do it
   while draft, reverify under the step 1 reuse rule and push. Repeat step 2 only when the change requires
   Greptile and the skill it points to says the rebased head needs a new attempt. Then `gh pr ready <pr>` starts CI, and
   `gh pr merge --auto --squash --delete-branch <pr>` queues the merge for GitHub once `test` passes.
   Never any other merge form; the hook refuses it. If CI needs a repair, use `gh pr ready <pr> --undo` before
   pushing, complete local repair evidence, and reassess the full pull-request diff against the section 6 tiers;
   repeat step 2 only when Greptile is required. An unchanged-head CI retry needs no new review.
4. Watch it land with one waiting command, run as the Waiting rule under "5. Build" says for a command that runs for
   minutes, and the session never polls by hand.
   `<pr>` is the pull request number, typed as a literal. The command only reads GitHub, exits 0
   only when the pull request has merged, and otherwise exits 1 with its reason as the last line of output: closed,
   a failed required check, blocked or behind, an unknown required set, or a `gh` failure. Once the pull request state
   is `MERGED` or `CLOSED`, the watch ends before reading check statuses; only an `OPEN` pull request needs that read.

   ```sh
   node scripts/merge-watch.mjs <pr>
   ```

   Merged: run `closeout` in the same session; the owner's yes already covers it. Failed, blocked or closed:
   report the printed reason and repair per step 3.

## Parking

`handoff` when the work is genuinely unfinished: commit what exists and prepare the draft pull-request body
locally. A bare `handoff` or `park` request does not authorize remote publication. Follow the handoff skill's
explicit publication-authorization gate before pushing the branch or creating or updating a draft pull request.
After authorized publication, keep **Not done** current and return the card to `Ready`. The next session finds it
in step 1.
