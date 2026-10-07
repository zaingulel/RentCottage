# The life of one change

One card becomes one commit on `main` by the same path every time: an owner pick, an isolated worktree, a plan, bounded
builds with recorded evidence, a fresh review and an owner yes, then a merge the platform performs or, for a change the
repository's own gate admits whole, a push straight to `main`. This page follows that path stage by stage. This page is
part of [the workflow guide](AI-WORKFLOW.md). Related: [The seats](AI-WORKFLOW-seats.md) for who acts at each stage,
[The board](AI-WORKFLOW-board.md) for the columns a card moves through, [The evidence bar](AI-WORKFLOW-evidence.md) for
what a build must prove, and [Enforced or instructed](AI-WORKFLOW-enforcement.md) for the guards named below.

## Mental model

| Stage | What happens | What a machine holds |
|---|---|---|
| Job starts | The card gets its own worktree and branch, the root checkout stays on `main`, and the card moves to In progress | Branch work in the root checkout is refused |
| Build | Bounded slices, every check logging its exit code, and an executed mutation where the testing strategy requires one, before review | An incomplete handoff is refused, and so is a turn that ends on a lint error |
| Review | One fresh review of the final tree, repairs, and a security review when the trust perimeter widens | Nothing: review is instructed |
| Deliver | A draft pull request, an external review where the tier requires it, and checks on the merge result; or, for a change the repository's own gate admits whole, a push straight to `main` | A pull request that is not a draft is refused, and so is an unsafe force push; [the head of `scripts/lib/unsafe-git.mjs`](../scripts/lib/unsafe-git.mjs) lists the exact forms |
| Merge | On the pull request route, the platform merges once the required checks are green, squashed, with the branch deleted | A merge command other than the platform's auto-merge is refused, and the branch rules require the checks |
| After merge | The issue is confirmed closed, the card moves to Done, servers and containers are stopped, and the worktree is removed and local `main` advances where that is provably safe | Nothing: closeout is instructed |

## How it works

```mermaid
flowchart TD
    C[Board card in Ready] --> WP[Work-pick: owner picks a card]
    WP --> WT[Worktree on its own branch, card to In progress]
    WT --> PL[Plan: architect or the session, plan review where the card requires one]
    PL --> BD[Build in bounded slices, evidence through scripts/run-log.mjs]
    BD --> VR[Verify: visual work driven and shown, plus any gate the Surfaces table names]
    VR --> RV[Fresh review of the final tree, repair, one pass scoped to the repair]
    RV --> PA[Push authorisation: card to Awaiting push, owner reads the PR body and screenshot]
    PA --> DR[Draft pull request, card to In review]
    PA -->|every changed path qualifies| FF[Fast-forward push to main, no pull request or CI]
    DR -->|documents, code, agent instruction: no Greptile| RD[Marked ready: CI runs on the merge result]
    DR -->|sign-off tier: explicit Greptile request| GR[Review attempt settled, findings resolved]
    GR --> RD
    RD -->|required checks green| MG[GitHub auto-merge, squash, branch deleted]
    MG --> CO[Closeout: issue closed, card to Done, worktree removed]
    FF --> CO
```

The diagram shows the whole path from a card to a merged commit, including the branch where a qualifying change
goes straight to `main`.

In words: a card in Ready is picked by the owner, gets a worktree on its own branch and moves to In progress. It
is planned by an architect or by the session, with a plan review where the card requires one;
[the `resume` skill](../.agents/skills/resume/SKILL.md) owns that rule under "4. Plan". It is then built in
bounded slices with recorded evidence, verified, and given a fresh review of the final tree with repairs. At push
authorisation the card moves to Awaiting push and the owner reads the pull request body. On the owner's yes a
draft pull request opens and the card moves to In review; a sign-off change first settles an external review, and
every draft is then marked ready so the checks run on the merge result. Once the required checks are green the
platform merges, and closeout confirms the issue closed, moves the card to Done and removes the worktree. A
change whose every path qualifies skips the pull request, is pushed straight to `main`, and is closed out the
same way.

### Stage by stage

- **Intake.** Fetching main and safely selecting current verifier code come first. The manual's instruction-reuse
  rule avoids rereading content whose Git identity and full active context are verified. Independent board, local,
  pull-request, sync and tooling reads then overlap; their results and failures are collected before reconciliation.
  Pull-request summaries identify which continuation bodies matter, and issue details serve selection and planning
  without duplicate fields. Large output is captured once and read completely in bounded portions. Checkout movement
  or conflicting facts invalidate affected evidence. These reduce repeated input and serial waits while retaining
  freshness, complete recommendations, claims, triage authority and both owner gates; they establish no total
  agent-latency guarantee.
- **Isolation.** Every issue gets its own git worktree on its own branch, so two issues in two terminals never
  share a working file. A runtime's own subagent worktree is not that worktree: it branches from `main` rather
  than from the job branch, so builders never run in one. Two slices of one issue with disjoint files can run at
  once, the second in its own worktree cut from the job branch and merged back into it. A generated artifact the
  `generated artifacts` row of the Conventions table in `AGENTS.md` names is never hand-merged, and the hooks keep
  it from landing stale. When a session starts a card it posts a claim comment on the issue, because a job branch
  stays local until push and the comment is what another machine can see. Where the worktree lives on each
  runtime, the commands that create it, the slice branch name, the claim format and what happens to an In
  progress card with nothing behind it are in [the `resume` skill](../.agents/skills/resume/SKILL.md) under
  "1. Find where things stand" and "3. Start the job".
- **Evidence during the build.** Every executed check runs through a logger that writes its real outcome, so the
  pull request body quotes what a script wrote, not what an agent remembers;
  [The evidence bar](AI-WORKFLOW-evidence.md) explains the log. Every green slice is committed on the job branch,
  so a crash costs at most the slice in progress.
- **Verification before review.** Visual work is driven as the Conventions table's `visual verification` row says
  and a current screenshot is shown in chat; any further gate the Surfaces table names runs here.
- **Review in two layers.** One fresh review of the final tree comes before push authorisation, and its depth
  follows the kind of change. Documents are reviewed by the session itself, because the owner is their reader. A
  setting-only seat change gets the same session review, because the owner chose the setting and no instruction
  changed. Code and agent instruction get the `reviewer` charter run by the model family that did not write the
  diff, because a writer's own family shares its blind spots. The highest-consequence surfaces also get an
  external review on the finished draft. [`AGENTS.md`](../AGENTS.md) owns the tiers under "Review and visual
  verification"; [the `resume` skill](../.agents/skills/resume/SKILL.md) owns how each is run, what happens when
  a reviewer cannot be reached, and how repairs are reviewed again, under "5. Build", "6. Verify and review" and
  "8. Deliver".
- **Delivery by GitHub.** On the pull request route, marking the pull request ready, after any required review
  attempt has settled, starts continuous integration, and the merge is always queued as a GitHub auto-merge, which
  GitHub completes only when the checks the repository's branch rules require are green; no agent merges a job's
  pull request directly. After the merge is queued the session waits on one command that only reads the pull
  request's state, and closeout follows a merge. A change `scripts/gates/pre-push-main` admits whole skips the
  pull request and is pushed straight to `main` on the same push authorisation.
  [The `resume` skill](../.agents/skills/resume/SKILL.md) owns the sequence, the waiting command and the direct
  route under "8. Deliver"; [Enforced or instructed](AI-WORKFLOW-enforcement.md) names the checks the branch
  rules require; [`AGENTS.md`](../AGENTS.md) owns how a session waits on a long command under "Runtime notes" and
  what the direct route admits under "Publication and machinery"; the documentation routines' own merge exception
  is in [`docs/DOC-SWEEP.md`](DOC-SWEEP.md) and [`docs/SWEEP-TRIAGE.md`](SWEEP-TRIAGE.md).
- **Closeout.** The moment the merge lands, the same session confirms it, moves the card, updates local `main`, and
  removes the branch and worktree. Local `main` advances only by a provably safe fast-forward, and a checkout that is
  dirty, active or uncertain is preserved. Servers and containers bound to the worktree are stopped, and the job's own
  disposable scratch is removed; when removal cannot be proven safe the worktree is kept and the reason reported. A
  leftover the session finds, another job's artifact or one it cannot prove it created, is investigated to a
  conclusion: dead, it is deleted and reported; live, it is left and reported; unsettled, it is left and the owner is
  asked. `AGENTS.md` owns that rule under "Owner gates", and the `closeout` skill owns the steps. Rulings the owner
  made during the session go to the issue or the manual that owns the topic, never to a new document.

## Where the rules live

- [The `resume` skill](../.agents/skills/resume/SKILL.md): every step from intake to the queued merge, in the order a
  session runs them.
- [The `closeout` skill](../.agents/skills/closeout/SKILL.md): every step after the merge.
- [`AGENTS.md`](../AGENTS.md) under "Owner gates": what work-pick and push authorisation approve, and the cleanup
  rule.
- [`AGENTS.md`](../AGENTS.md) under "Review and visual verification": the review tiers and the visual check.
- [`AGENTS.md`](../AGENTS.md) under "Publication and machinery": the pull request route and the direct route.
- The Surfaces and Conventions tables in [`AGENTS.md`](../AGENTS.md): the repository's own gates, generated
  artifacts and visual verification.
- [The head of `scripts/lib/unsafe-git.mjs`](../scripts/lib/unsafe-git.mjs): the exact command forms the git guard
  refuses at each stage.

## Failure modes

- **A session stops mid-build.** Every green slice is already committed on the job branch, so at most the slice in
  progress is lost.
- **A reviewer cannot be reached.** The review runs on the writing family's own seat and the pull request body
  declares the substitution; an undeclared substitution is a skip.
  [The `resume` skill](../.agents/skills/resume/SKILL.md) owns the route under "6. Verify and review".
- **Two repair rounds still produce true findings.** [The `resume` skill](../.agents/skills/resume/SKILL.md)
  decides between one more round and an owner decision, under "5. Build".
- **A required check fails, or the pull request is blocked or closed.** The waiting command ends with its reason,
  and the session reports it and repairs on the draft, as [the `resume` skill](../.agents/skills/resume/SKILL.md)
  sets out under "8. Deliver".
- **An In progress card has no branch or pull request behind it.** It is shown to the owner with its latest claim
  and returned to Ready only on the owner's say ([the `resume` skill](../.agents/skills/resume/SKILL.md), under
  "1. Find where things stand").

## Key files

- `.agents/skills/resume/SKILL.md` and `.agents/skills/closeout/SKILL.md`: the steps.
- `.github/pull_request_template.md`: the pull request body the owner reads.
- `scripts/run-log.mjs`: the logger every check runs through.
- `scripts/merge-watch.mjs`: the one waiting command after the merge is queued.
- `scripts/gates/pre-push-main`: the repository's own gate for the direct route, where it supplies one.
- `.greptile/config.json`: the external reviewer's configuration.
