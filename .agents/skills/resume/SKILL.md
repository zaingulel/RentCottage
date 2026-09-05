---
name: resume
description: Resume RentCottage from Git, GitHub Issues, Project 4, pull requests, and native worktrees when the owner starts or continues a work session.
---

# Resume

Git is shipped and in-flight state. GitHub Issues and Project 4 are planned state.

## Reconcile once

Start these independent reads together and await every result in one bounded intake:

- `git status --short --branch`, recent `origin/main` history, remotes, and `git worktree list --porcelain`;
- `npm run verify:board -- --json`, one authoritative board snapshot and classification;
- open pull requests and their draft/ready state;
- active task ownership supplied by the runtime.

Inspect every source before shortlisting. A nonzero board result with a drift report needs the proposed corrections
reviewed by the owner; malformed or incomplete evidence stops selection. Keep drifted items out of recommendations.
Retry only a named failed source. A branch with a draft pull request is unfinished work; read its `Not done`
section before considering new work. Leave foreign work unchanged.

For remaining local job branches and worktrees, check their matching merged pull requests and run
`git worktree prune --dry-run --verbose`. Use [closeout](../closeout/SKILL.md) to assess missed cleanup before
shortlisting. Complete only exact targets covered by existing closeout authority; otherwise report the proposed
targets and why they remain. Keep unfinished and active work excluded from cleanup. A historical cleanup decision
does not prevent selecting unrelated work. Also assess and retry [safe local-main updates](../closeout/SKILL.md#update-local-main)
under that procedure; report skipped updates with their reason.

## Work pick

After ownership and board classification narrow the shortlist, fetch bodies and attributed comments for at most
three credible issues in one aliased GraphQL query using the procedure in `docs/agents/issue-tracker.md`.
An incomplete candidate stays out of recommendations until its named missing evidence is fetched.
Present the options in a concise Markdown table with one issue per row and columns: Issue, Outcome,
Dependencies / owner, Risk, and Builder route. Link each issue, put the recommended option first, and mark it
**Recommended**. Keep cells short for scanning; give the recommendation's reason and the current branch/worktree,
verification result, and safe parallel capacity in brief prose outside the table.
End with a question naming the recommended issue and stop for the owner's choice. A yes to that question
approves the named issue's stated outcome and acceptance criteria; high-blast-radius work proceeds only
through read-only planning until its concrete plan is approved.

## Start the approved job

Freshly fetch `origin/main`. Create one native worktree and `job/<issue>` branch directly from that ref; do not
switch, clean, stash, or pull the primary checkout to start a job. Safe local-main updates belong to the initial
reconciliation above. If the runtime already created the approved job
worktree, verify its branch and exact base instead of creating another.

Assign one writer. Move the issue only under existing tracker authority. Install dependencies in a fresh
worktree, make the route explicit, then plan and build under `AGENTS.md`. Commit each coherent green slice
locally. Delivery waits for the owner-approved pull-request body.

## Finish the approved job

Include the exact branch and absolute worktree path in the filled pull-request body's proposed closeout actions.
After delivery approval, follow `docs/agents/delivery.md` and watch the approved merge until it lands or reports a
failure or blocker. When GitHub confirms `MERGED`, run [closeout](../closeout/SKILL.md) in the same session under
that existing exact-target approval. Report the confirmed merge and cleanup result, including retained targets.
A queued merge is still pending; do not close out its worktree. Park genuinely unfinished work with `handoff`.
