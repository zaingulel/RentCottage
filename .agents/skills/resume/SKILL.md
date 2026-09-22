---
name: resume
description: Resume RentCottage work from durable state. Use when the owner starts or continues a work session, returns to unfinished work, or asks what to work on next.
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
- A branch with an open draft pull request is unfinished work. Read its body: the "Not done" section says
  where to pick up.
- The board output for planned work. Prefer `Ready` work matching the owner's latest objective;
  `Backlog` remains eligible. `Ready` means startable in the next session with no missing owner decision,
  external dependency, or scheduled date; a card waiting on any of those goes to `Backlog` with its trigger
  named in a comment. A card in `In progress` with no branch or pull request behind it is stale: return it to
  `Ready`.
- Documentation sweep and triage artifacts participate in intake only after their separately authorised external
  environment, hosted protection and schedules are active. Until then, treat `docs/DOC-SWEEP.md` and
  `docs/SWEEP-TRIAGE.md` as inactive bounded contracts and never infer tracker state from them.

## 2. Work-pick (owner gate one)

Read the candidate cards' bodies and comments in one call, one alias per issue, never one `gh issue view`
per card.

```sh
gh api graphql -f query='{ repository(owner:"zaingulel", name:"RentCottage") { CANDIDATE_1_ALIAS: issue(number:CANDIDATE_1_NUMBER) { ...Card } CANDIDATE_2_ALIAS: issue(number:CANDIDATE_2_NUMBER) { ...Card } } } fragment Card on Issue { number title body comments(last:20) { nodes { body } } }' --jq '.data.repository[] | "===== #\(.number) \(.title)\n\(.body)\n--- comments:\n\(.comments.nodes | map(.body) | join("\n---\n"))"'
```

State the session's own model in one line, then always present this table, even for one candidate:

| #   | Card | Outcome for the user | Why now, and the risk | Gates it triggers | Route and why | Startable now? |
| --- | ---- | -------------------- | --------------------- | ----------------- | ------------- | -------------- |

Gates are read off AGENTS.md, Owner gates and Review: owner direction, sign-off, architect plan, screenshot,
database/provider/browser evidence, security review, Greptile. Route names the build seat (`builder-max`, `builder`, or
`builder-lite`), whether the architect runs, and the reason from residual judgment, uncertainty,
failure consequence, and verification strength. Close with one line recommending a row number, then stop; no
acceptance-criteria list is presented. The owner's pick of any row is the work-pick approval of that card's
outcome and acceptance criteria as written, and it starts the job with no further confirmation; planning
proceeds autonomously after it. One issue per branch. Two issues may run in parallel only when their files are
disjoint.

## 3. Start the job

- After selection, fetch `origin/main` again with `git fetch --no-prune origin main` and record the new target.
- On either runtime, create one native sibling worktree:
  `git worktree add ../RentCottage-<issue> -b job/<issue> <recorded-origin-main>`. A Codex-managed worktree is
  acceptable when Codex owns its lifecycle. Start the session inside that exact directory; never create a
  worktree inside a worktree.
- Before edits in any newly created runtime worktree, require `git rev-parse HEAD` to equal that newly recorded
  commit. Preserve and report a mismatch before edits.
- Builders work inside the job worktree, one at a time. Other agents are read-only unless the coordinator
  explicitly transfers the sole-writer role and waits for the prior writer to stop.
- Move the card to `In progress`: `node scripts/board-move.mjs <issue> "In progress"`, and claim it with
  `gh issue edit <issue> --add-assignee @me` — active work with no assignee is reported as drift. Run `npm ci`
  in a fresh checkout.

## 4. Plan

- Plan-first surfaces (authentication, authorization, payments, personal data, schema/migrations, Row Level
  Security, provider/Worker trust, destructive data changes, and unsettled user-facing behaviour) get an
  `architect` plan and one read-only `plan-reviewer` pass before any build. Any other card with
  design choices still open after work-pick gets an `architect` plan. Everything else gets a short plan in the
  pull request body.
- Every `architect` dispatch is a filled copy of `.agents/templates/planner-handoff.md`.
- A plan states its size envelope. A parser, state machine, or general framework the outcome did not name is a
  scope change and goes back to the owner before it is built.
- Discovery wider than a couple of files, while planning or building, goes to the `explorer` seat, so its
  conclusion reaches the main thread and its file dumps do not.
- Every coherent claim gets one construction mode from `docs/engineering/testing-strategy.md`.

## 5. Build

- Every edit goes to `builder-lite`, `builder`, or `builder-max` through `.claude/templates/builder-handoff.md`;
  the session never builds (AGENTS.md, Runtime notes). Builders never run the full suite, never commit.
- Commit on the job branch after every green slice. Uncommitted files survive a crash but not a stray checkout,
  and the next session reads the branch, not the worktree, to see what was already green. A local commit needs
  no authorisation; only the push does.
- Wrap every executed check in `node scripts/run-log.mjs <label words> -- <command>` (plain unquoted label,
  then a bare `--`) so the exit code is recorded by a script, not asserted: focused tests, the one executed mutation per claim (red, restore, green), lint,
  the focused checks and applicable convergence commands. The log lives at `.claude/worklog/<branch>.md`.
- After two repair-and-re-review cycles that still produce new true findings, stop and replan or split. Findings
  are never ignored; the work is restructured.
- When a declared database object changes, edit `supabase/schemas/`, generate and inspect the matching migration,
  and commit them together. When Next.js behaviour changes, read the installed version guide first.

## 6. Verify and review

- Visual work: run the applicable isolated Next.js or Worker journey, drive the changed interaction across the
  required desktop, mobile, right-to-left and accessibility states, and display current screenshots inline in
  chat. No push authorisation is requested without them.
- One fresh review of the final tree, by tier. **Documents** (product and engineering documentation plus `CONTEXT.md`): the session
  itself. **Code and agent instruction**, everything else, the manual, `CLAUDE.md`, the rules, skills and seat
  files included: the `reviewer` charter run by the model family that did not write the diff, through
  `cross-review`; an instruction that misreads a gate has cost more than most code. When the other family's seat
  cannot be reached, its provider out of usage, unauthenticated or failing, the branch does not wait: run the
  same `reviewer` charter on this family's own seat, and record in the pull request body which family reviewed,
  which was unavailable and how that was established, and that the cross-family gate was therefore not met. That
  recording is the whole of the exception: a substitution the body does not declare is a skip, and a skip is
  neither unavailability nor a clean review. **Sign-off**, the surfaces that need owner sign-off (authentication,
  authorization, payments, personal data, schema/migrations, Row Level Security, provider/Worker trust, and the
  public/private data perimeter) and any diff where material uncertainty remains
  after that pass: the same cross-family pass, its unavailability route included, then Greptile on the draft
  in section 8. A sign-off diff whose other family is unavailable and whose Greptile attempt settles as
  `UNAVAILABLE` by either of the routes section 8 establishes proceeds on the substituted pass plus that record,
  both declared in the pull request body, because there is no further reviewer to wait for. Risk and uncertainty
  override category and line count, and a mixed diff is assessed whole, so a one-line resolver change is
  sign-off tier. `security-reviewer` only when the trust perimeter widens. The pull request body names the tier
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

1. Rebase onto `origin/main`, rerunning the applicable focused and convergence evidence, then push;
   `gh pr create --draft --body-file <body>` with `Closes #<issue>` in the body. Greptile is requested only for
   the sign-off tier in section 6; the other tiers go straight to step 3. Move the card to `In review`.
2. Read the current allowance first: Greptile's usage page for the `flowgauge` organisation, which RentCottage
   draws on too. Record the source, the observation time and the credits left in the pull request body;
   confirmed exhaustion is the `UNAVAILABLE` evidence below and skips the request. Then read the open draft's
   `headRefOid` and request the final review once for that commit:
   `gh pr comment <pr> --body "@greptileai review this draft"`. Record the request URL, time and exact head.
   `.greptile/config.json` disables automatic reviews; labels are metadata. `COMPLETE` requires Greptile's
   completed review for that exact head, its summary, and disposition of every finding. Read its check status,
   the summary's last-reviewed commit, pull-request reviews and inline threads: a summary can precede findings.
   Greptile's summary is a `greptile-apps[bot]` comment whose footer names the exact requested head as
   `Last reviewed commit`, and the `Greptile Review` check turning green is a second signal; its heading
   is an image, so a watcher keys on that footer, never on heading text.
   Fix true findings, complete focused tests and the applicable scoped local repair review before pushing,
   reply with the fix commit, resolve the thread, and dismiss false findings with evidence. Update the review line
   after each Greptile review. For the new head, request
   `@greptileai review this draft again; <what changed> in <commit>`. A re-review can edit the existing
   summary and raise its `Reviews (N)` footer; check the reviewed commit, not just the count or a new comment.
   `UNAVAILABLE` requires, reported in the pull-request body, either the allowance observation above showing
   exhaustion, with the head it would have covered, or the explicit request URL, head, observation time and
   provider-failure evidence. This best-effort exception permits CI after all mandatory local evidence and
   finding dispositions pass. A filtered skip, missing response, or queued/running
   review is unresolved: retain draft and report it for owner direction rather than declaring unavailability.
3. Re-read the open draft and require current local evidence, every finding/thread resolved, and a review line
   that matches the rounds actually run and the findings actually raised and settled. For the sign-off tier, also
   require the same reviewed head and a settled `COMPLETE` or `UNAVAILABLE` attempt. If a rebase is needed, do it
   while draft, verify the result and push. Repeat step 2 only when the change requires Greptile and
   `git range-diff <old-base>..<reviewed-head> <new-base>..<new-head>` shows any `!`, `<` or `>` row, where the
   bases are the `main` commits the reviewed head and the new head sit on. A `!` from context drift alone still
   counts; it costs one review attempt and never skips one. When every job commit lines up as `=`, the recorded
   `COMPLETE` attempt stands and only CI reruns. Then `gh pr ready <pr>` starts CI, and
   `gh pr merge --auto --squash --delete-branch <pr>` queues the merge for GitHub once `test` passes.
   Never any other merge form; the hook refuses it. If CI needs a repair, use `gh pr ready <pr> --undo` before
   pushing, complete local repair evidence, and reassess the full pull-request diff against the section 6 tiers;
   repeat step 2 only when Greptile is required. An unchanged-head CI retry needs no new review.
4. Watch it land: every 30 seconds read `gh pr checks <pr>` and `gh pr view <pr> --json state`, and stop the
   moment a check fails, the merge is blocked, or the state is `MERGED`. Merged: run `closeout` in the same
   session; the owner's yes already covers it. Failed or blocked: report it and repair per step 3.

The Greptile allowance is one pool shared with Flowgauge and RentCottage: one organisation, one developer seat, the included
credits per billing period plus the owner's overage. There is no per-repository split; the tiers ration the pool,
either repository spends from it, and once it is exhausted both record `UNAVAILABLE` until the period resets. So
the shape of the rule is one policy stated in both manuals, and a change to it lands in both: risk and
uncertainty override category and line count, a skip is neither `UNAVAILABLE` nor a clean review, the allowance
is read before a request, reviews are requested by hand, and the sequence is draft → Greptile → ready → CI. What
each repository sends to Greptile is its own list: RentCottage's section 6 tiers here and Flowgauge's own
selection rules. CI enforces draft versus ready, not the earlier review; the session verifies that
evidence before marking ready. Provider references: [manual-only configuration](https://www.greptile.com/docs/code-review/greptile-json-reference)
and [draft requests](https://www.greptile.com/docs/code-review/tips-recipes).

## Parking

`handoff` when the work is genuinely unfinished: commit what exists and prepare the draft pull-request body
locally. A bare `handoff` or `park` request does not authorize remote publication. Follow the handoff skill's
explicit publication-authorization gate before pushing the branch or creating or updating a draft pull request.
After authorized publication, keep **Not done** current and return the card to `Ready`. The next session finds it
in step 1.
