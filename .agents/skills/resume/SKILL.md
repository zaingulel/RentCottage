---
name: resume
description: Resume work in this repository from durable state. Use when the owner starts or continues a work session, returns to unfinished work, or asks what to work on next.
effort: medium
---

# Resume

Git is the state. A branch is a job; a draft pull request is its handoff; the board says what is planned.

## Before intake

Fetch `origin/main` with `git fetch --no-prune origin main` and record the fetched commit. If fetching fails,
report freshness unavailable and do not select work from stale board evidence. Read `AGENTS.md`, this skill, and
[Update local main](../closeout/SKILL.md#update-local-main) from that commit with
`git show <recorded-origin-main>:<path>`, then apply that fetched procedure to the actual `main` checkout. The
coordinating resume session may update it when no other task owns it. After a successful update, verify the
recorded target and reread the files from disk. If the checkout is retained, report its path, branch and reason;
continue from fetched instructions read-only and choose verifier code at the recorded target: use a usable existing
isolated checkout first, otherwise create a fresh verifier-only worktree without duplicating a job. A verifier-only
worktree this run created is removed at the end of the same run, after board operations, with
`git worktree remove <path>`; a reused existing checkout is left alone. If no current verifier checkout is
available, report board freshness unavailable rather than presenting stale local code as current evidence.

## 1. Find where things stand

- Start `node scripts/board.mjs`, `git status`, `git branch --show-current`, `git worktree list`, and
  `gh pr list --author @me --state open` only after the refresh above. Capture the board output to a file so its
  paged walk overlaps the remaining reads. That one command lists the board and judges it from the same read:
  exit 1 with drift rows is a reconciliation to do before work-pick, not a failed command, while a
  `board: failed to read` line on stderr is a failed read, so report board freshness unavailable.
- Run `node scripts/factory-sync.mjs --check` in the same refreshed checkout and report its result at work-pick in
  one advisory line: exit 0 is in sync; exit 1 is lag, naming the paths it lists, which a sync card resolves;
  exit 2 is lag unknown with its stated cause, never reported as in sync. The result never blocks work-pick.
- A branch with an open draft pull request is unfinished work. Read its body: the "Not done" section says
  where to pick up.
- The board output for planned work. Prefer `Ready` work matching the owner's latest objective;
  `Backlog` remains eligible. `Ready` means startable in the next session with no missing owner decision,
  external dependency, or scheduled date; a card waiting on any of those goes to `Backlog` with its trigger
  named in a comment. A card in `In progress` with no branch or pull request behind it is stale: return it to
  `Ready`.
- If the Conventions table in `AGENTS.md` marks the documentation routines active, intake sweep-triage cards
  as `docs/SWEEP-TRIAGE.md` describes: the day-after triage routine files issues it cannot card. Before
  work-pick, list them with
  `gh issue list --state open --author @me --limit 100 --json number,body --jq '.[] | select(.body | contains("Sweep triage: source #")) | .number'`
  and, for each the board output does not show, card it with
  `node scripts/board-add.mjs <issue> Backlog <Workstream>`, the Workstream the issue body names, only when the
  owner-authored verdict comment on the sweep pull request its marker cites lists that issue number; otherwise
  report it at work-pick and card nothing. For every marker issue that verdict comment lists, whether or not it is
  already on the board, while its body still carries a `Blocked by:` line, create each link with
  `gh issue edit <issue> --add-blocked-by <n>`, then remove the line from the body, so the link is the only
  record.

## 2. Work-pick (owner gate one)

Read the candidate cards' bodies and comments in one call, one alias per issue, never one `gh issue view`
per card.

```sh
gh api graphql -F owner='{owner}' -F name='{repo}' -f query='query($owner:String!,$name:String!){ repository(owner:$owner,name:$name) { CANDIDATE_1_ALIAS: issue(number:CANDIDATE_1_NUMBER) { ...Card } CANDIDATE_2_ALIAS: issue(number:CANDIDATE_2_NUMBER) { ...Card } } } fragment Card on Issue { number title body parent { number } blockedBy(first:50) { nodes { number state } } comments(last:20) { nodes { body } } }' --jq '.data.repository[] | "===== #\(.number) \(.title)\nparent: \(if .parent then "#\(.parent.number)" else "none" end); open blockers: \([.blockedBy.nodes[] | select(.state == "OPEN") | "#\(.number)"] | join(" ") | if . == "" then "none" else . end)\n\(.body)\n--- comments:\n\(.comments.nodes | map(.body) | join("\n---\n"))"'
```

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

- After selection, fetch `origin/main` again with `git fetch --no-prune origin main` and record the new target.
- On Claude Code: `git worktree add .claude/worktrees/job-<issue> -b job/<issue> <recorded-origin-main>`, then
  enter it with `EnterWorktree`. That is the one location a session may enter without the owner approving the move:
  Claude Code asks whenever a session takes its working directory to a path outside the repository's
  `.claude/worktrees/`. `EnterWorktree` isolates the session, so the runtime refuses what it cannot verify stays
  inside this worktree: a git command redirected by `git -C`, `--git-dir` or a leading `cd`, for example, or one
  whose shape is too complex for it to judge. Plain, separate git commands run from the worktree are the working
  form.
- On Codex: a Codex-managed worktree per chat, or
  `git worktree add ../jobs/<issue> -b job/<issue> <recorded-origin-main>`.
- On Herdr: `herdr worktree create --branch job/<issue> --cwd "$PWD" --path ".claude/worktrees/job-<issue>"`
  opens the job as a worktree workspace at that same location. The Workspace Manager plugin then runs `npm ci`
  in that workspace and starts a Claude in it, so the job needs no install step or launch by hand; the
  Worktrunk plugin's picker (prefix, then shift+g) does the same for a start by hand. Herdr's agent manual
  forbids creating a worktree unless the user asked for that topology; this line is that request, so no
  further confirmation is needed.
- Before edits in any newly created runtime worktree, require `git rev-parse HEAD` to equal that newly recorded
  commit. Preserve and report a mismatch before edits.
- Builders work inside the job worktree, one at a time. Two slices with disjoint files may run at once: from the
  job worktree, give the second its own branch and worktree with
  `git worktree add -b slice/<issue>-<name> <path> job/<issue>`, since git refuses to check the job branch out in a
  second worktree. Once that slice is green and committed there, run `git merge --no-edit slice/<issue>-<name>` in
  the job worktree, then `git worktree remove <path>` and `git branch -d slice/<issue>-<name>`. A runtime's own
  subagent worktree branches from `main`, not the job branch, so it is not used for builders.
- Move the card to `In progress`: `node scripts/board-move.mjs <issue> "In progress"`, and claim it with
  `gh issue edit <issue> --add-assignee @me` — active work with no assignee is reported as drift. Run `npm ci`
  in a fresh checkout, then confirm `git config --get core.hooksPath` prints `.githooks`; when it does not, run
  `git config core.hooksPath .githooks` and report it.

## 4. Plan

- Plan-first surfaces are the Surfaces table's `plan-first` row. They get an `architect` plan and one read-only
  `plan-reviewer` pass before any build. Any other card with design choices still open after work-pick gets an
  `architect` plan. Everything else gets a short plan in the pull request body.
- Every `architect` dispatch is a filled copy of `.agents/templates/planner-handoff.md`.
- A plan names its scope: the files each slice changes and the claim each slice proves, never a line estimate.
  Size is the owner's judgment before work-pick, through the `to-issues` size signals; after work-pick no seat
  splits, stops or replans work for its estimated or actual size. An architect's finding that the card holds more
  than one independently demonstrable outcome goes to the owner as a split proposal before any build, and the
  session never narrows such a plan inline or merges slices to fit. A card that came out of a split is never split
  again on a session's own judgment; only the owner starts another split. A parser, state machine, or general
  framework the outcome did not name is a scope change and goes back to the owner before it is built.
- Discovery wider than a couple of files, while planning or building, goes to the `explorer` seat, so its
  conclusion reaches the main thread and its file dumps do not.
- Every coherent claim gets one construction mode from `docs/TESTING-STRATEGY.md`.

## 5. Build

- Every edit goes to `builder-lite`, `builder`, or `builder-max` through `.claude/templates/builder-handoff.md`;
  the session never builds (AGENTS.md, Runtime notes). Builders never run the full suite, never commit.
- Commit on the job branch after every green slice. Uncommitted files survive a crash but not a stray checkout,
  and the next session reads the branch, not the worktree, to see what was already green. A local commit needs
  no authorisation; only the push does. Commit green work before any stop, handoff, replan or split proposal as
  well, so nothing green waits uncommitted in the worktree.
- Wrap every executed check in `node scripts/run-log.mjs <label words> -- <command>` (plain unquoted label,
  then a bare `--`) so the exit code is recorded by a script, not asserted: focused tests, the one executed mutation per claim (red, restore, green), lint,
  and the convergence checks `docs/TESTING-STRATEGY.md` names. The log lives at `.claude/worklog/<branch>.md`.
- When two repair-and-re-review cycles still produce true findings, new or repeated, judge them. If each is bounded
  and verifiable, run one more round that fixes all of them. Bring the owner the choice, with a recommendation, only
  when a finding needs an unsettled design, owner judgment or evidence that cannot be bounded, or when that round
  still does not converge. Findings are never ignored.
- Regenerate any artifact the Conventions table's `generated artifacts` row names and commit it with its source;
  the Stop and pre-commit hooks enforce it.

## 6. Verify and review

- Drive visual work as the Conventions table's `visual verification` row says, and display the screenshot inline
  in chat. No push authorisation is requested without it.
- Run every check the Surfaces table's rows name for a surface the diff touches.
- One fresh review of the final tree, by tier. **Documents** (`docs/`, the root readme, `CONTEXT.md`): the session
  itself. **Code and agent instruction**, everything else, the manual, `CLAUDE.md`, the rules, skills and seat
  files included: the `reviewer` charter run by the model family that did not write the diff, through
  `cross-review`; an instruction that misreads a gate has cost more than most code. When the other family's seat
  cannot be reached, its provider out of usage, unauthenticated or failing, the branch does not wait: run the
  same `reviewer` charter on this family's own seat, and record in the pull request body which family reviewed,
  which was unavailable and how that was established, and that the cross-family gate was therefore not met. That
  recording is the whole of the exception: a substitution the body does not declare is a skip, and a skip is
  neither unavailability nor a clean review. **Sign-off**: sign-off surfaces are the Surfaces table's `sign-off`
  row; this tier covers them and any diff where material uncertainty remains
  after that pass: the same cross-family pass, its unavailability route included, then Greptile on the draft
  in section 8. A sign-off diff whose other family is unavailable and whose Greptile attempt settles as
  `UNAVAILABLE` by either of the routes section 8 establishes proceeds on the substituted pass plus that record,
  both declared in the pull request body, because there is no further reviewer to wait for. Risk and uncertainty
  override category and line count, and a mixed diff is assessed whole, so a one-line change to a
  sign-off surface is sign-off tier. `security-reviewer` only when a change widens a surface in the Surfaces
  table's `security review` row. The pull request body names the tier
  and one sentence why; a Greptile review not requested on tier grounds is neither `UNAVAILABLE` nor a clean
  review. Fix true findings, dismiss false ones with a reason, then one pass scoped to the repaired hunks and
  what they can break, by the same reviewer with its context intact or by the session. No further pass when a
  repair adds no factual claim. Record the review in the pull request body's review line, in the format
  [the workflow manual](../../../docs/AI-WORKFLOW.md#the-review-line) specifies.

## 7. Push authorisation (owner gate two)

Move the card to `Awaiting push`: `node scripts/board-move.mjs <issue> "Awaiting push"`. Fill
`.github/pull_request_template.md` as the pull request body and show it to the owner with the screenshot.
The owner's yes, or any instruction to push, covers every step of section 8: the push, the draft pull request,
the `@greptileai` comments, repairs on the same branch, rebasing onto `main`, marking ready, and the auto-merge.
Nothing in section 8 stops to ask again; a public comment there is delivery, not a new action. Push only after
it.

## 8. Deliver

1. Rebase onto `origin/main`, then settle each convergence check the testing strategy names: reuse its latest
   worklog receipt for the same command when that receipt reads `exit 0`, its `head=` is exactly the current
   `git rev-parse HEAD`, its `tree=` is `clean`, and `git status --porcelain --untracked-files=normal` still prints
   nothing; otherwise run the check again. A no-op rebase leaves `HEAD` unchanged and keeps the evidence; a rebase
   onto a moved `main` changes `HEAD` and needs the rerun, as does a dirty tree or a missing, failed or `unknown`
   receipt. The pre-push hook still runs its own gates on every push. Then push;
   `gh pr create --draft --body-file <body>` with `Closes #<issue>` in the body. Greptile is requested only for the
   sign-off tier in section 6; the other tiers go straight to step 3. Move the card to `In review`.
2. Read the current allowance first on Greptile's usage page: Greptile is metered from one pool shared by every
   adopter. Record the source, the observation time and the credits left in the pull request body; confirmed
   exhaustion is the `UNAVAILABLE` evidence below and skips the request. Then read the open draft's `headRefOid`
   and request the final review once for that commit: `gh pr comment <pr> --body "@greptileai review this draft"`.
   Record the request URL, time and exact head. `.greptile/config.json` disables automatic reviews; labels are
   metadata. `COMPLETE` requires Greptile's completed review for that exact head, its summary, and disposition of
   every finding. Read its check status, the summary's last-reviewed commit, pull-request reviews and inline
   threads: a summary can precede findings. Greptile's summary is a `greptile-apps[bot]` comment whose footer names
   the exact requested head as `Last reviewed commit`, and the `Greptile Review` check turning green is a second
   signal; its heading is an image, so a watcher keys on that footer, never on heading text. Fix true findings,
   complete focused tests and the applicable scoped local repair review before pushing, reply with the fix commit,
   resolve the thread, and dismiss false findings with evidence. Update the review line's Greptile fields after
   each Greptile review; a pull request Greptile never reviewed, because its tier requests no Greptile review or
   every attempt was `UNAVAILABLE`, records `greptile_rounds=0`. For the new head, request
   `@greptileai review this draft again; <what changed> in <commit>`. A re-review can edit the existing summary and
   raise its `Reviews (N)` footer; check the reviewed commit, not just the count or a new comment. `UNAVAILABLE`
   requires, reported in the pull-request body, either the allowance observation above showing exhaustion, with the
   head it would have covered, or the explicit request URL, head, observation time and provider-failure evidence.
   This best-effort exception permits CI after all mandatory local evidence and finding dispositions pass. A
   filtered skip, missing response, or queued/running review is unresolved: retain draft and report it for owner
   direction rather than declaring unavailability.
3. Re-read the open draft and require current local evidence, every finding/thread resolved, and a review line
   that matches the rounds actually run and the findings actually raised and settled. For the sign-off tier, also
   require the same reviewed head and a settled `COMPLETE` or `UNAVAILABLE` attempt. If a rebase is needed, do it
   while draft, reverify under the step 1 reuse rule and push. Repeat step 2 only when the change requires
   Greptile and `git range-diff <old-base>..<reviewed-head> <new-base>..<new-head>` shows any `!`, `<` or `>` row,
   where the bases are the `main` commits the reviewed head and the new head sit on. A `!` from context drift
   alone still counts; it costs one review attempt and never skips one. When every job commit lines up as `=`,
   the recorded `COMPLETE` attempt stands and only CI reruns. Then `gh pr ready <pr>` starts CI, and
   `gh pr merge --auto --squash --delete-branch <pr>` queues the merge for GitHub once `test` passes.
   Never any other merge form; the hook refuses it. If CI needs a repair, use `gh pr ready <pr> --undo` before
   pushing, complete local repair evidence, and reassess the full pull-request diff against the section 6 tiers;
   repeat step 2 only when Greptile is required. An unchanged-head CI retry needs no new review.
4. Watch it land with one waiting command. On Codex the whole watch runs in one `exec` cell whose first line is
   `// @exec: {"yield_time_ms": 3600000}`: the cell starts the command with `tools.exec_command`, which yields after
   at most 30 seconds, polls the returned `session_id` with
   `tools.write_stdin({ session_id, chars: "", yield_time_ms: 300000 })` until `exit_code` is set, and returns once;
   if the cell yields early, the session calls `wait` on its cell ID with the same `yield_time_ms`, and never polls
   by hand. On Claude Code it runs through `Bash` with `run_in_background: true`, which re-invokes the session
   when it exits. Every pass reads the pull request and its required checks together, so it
   stops the moment a check fails, the merge is blocked, or the state is `MERGED`, whichever comes first, and it
   exits non-zero the moment `gh` itself fails. It first reads the full required set from the base branch's
   classic protection and every page of its rules, because `gh pr checks --required` lists a check only once GitHub
   has created its run; only a required check still pending or not yet reported keeps it waiting, `BLOCKED` means
   nothing until every one has finished, and a branch that requires no checks stops on `BLOCKED` at once; a ruleset
   that requires workflows or code-scanning results names no checks, so the command stops and says so.

   ```sh
   base=$(gh pr view <pr> --json baseRefName --jq .baseRefName) || exit 1
   classic=$(gh api "repos/{owner}/{repo}/branches/$base" --jq '.protection.required_status_checks.contexts // []') || exit 1
   rules=$(gh api --paginate "repos/{owner}/{repo}/rules/branches/$base" --jq '.[] | select(.type == "required_status_checks" or .type == "workflows" or .type == "code_scanning") | if .type == "required_status_checks" then .parameters.required_status_checks[].context else {unnamed: .type} end | @json') || exit 1
   ruled="[$(printf '%s\n' "$rules" | paste -sd, -)]"
   case "$ruled" in *'{"unnamed":'*) echo "a ruleset requires checks it does not name, so the full required set is unknown: $ruled"; exit 1 ;; esac
   while :; do
     view=$(gh pr view <pr> --json state,mergeStateStatus --jq '.state + " " + .mergeStateStatus') || exit 1
     if ! checks=$(gh pr checks <pr> --required --json name,bucket --jq "(($classic + $ruled) - [.[].name] | map(\"unreported\")) + [.[].bucket] | join(\" \")" 2>&1); then
       case "$checks" in
         *"checks reported on the"*) case "$classic$ruled" in "[][]") checks= ;; *) checks=unreported ;; esac ;;
         *) echo "$checks"; exit 1 ;;
       esac
     fi
     case " $view $checks " in
       " MERGED "*) echo "merged"; exit 0 ;;
       " CLOSED "*) echo "closed without merging"; exit 1 ;;
       *" fail"*) echo "a required check failed: $checks"; exit 1 ;;
       *" DIRTY "*|*" BEHIND "*) echo "merge blocked: $view"; exit 1 ;;
       *" BLOCKED "*) case " $checks " in *" pending "*|*" unreported "*) ;; *) echo "merge blocked with every required check finished: $view $checks"; exit 1 ;; esac ;;
     esac
     sleep 30
   done
   ```

   Merged: run `closeout` in the same session; the owner's yes already covers it. Failed, blocked or closed:
   report the printed reason and repair per step 3.

Greptile is metered from one pool shared by every adopter: one organisation, one developer seat, the included
credits per billing period plus the owner's overage. There is no per-repository split; the tiers ration the pool,
every adopter spends from it, and once it is exhausted every adopter records `UNAVAILABLE` until the period resets.
So the shape of the rule is one shared policy, and a change to it lands in every adopter: risk and
uncertainty override category and line count, a skip is neither `UNAVAILABLE` nor a clean review, the allowance
is read before a request, reviews are requested by hand, and the sequence is draft → Greptile → ready → CI. Each
repository sends only its own Surfaces `sign-off` row. CI enforces draft
versus ready, not the earlier review; the session verifies that evidence before marking ready. Provider references: [manual-only configuration](https://www.greptile.com/docs/code-review/greptile-json-reference)
and [draft requests](https://www.greptile.com/docs/code-review/tips-recipes).

## Parking

`handoff` when the work is genuinely unfinished: commit what exists and prepare the draft pull-request body
locally. A bare `handoff` or `park` request does not authorize remote publication. Follow the handoff skill's
explicit publication-authorization gate before pushing the branch or creating or updating a draft pull request.
After authorized publication, keep **Not done** current and return the card to `Ready`. The next session finds it
in step 1.
