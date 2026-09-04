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

## Work pick

After ownership and board classification narrow the shortlist, fetch bodies and attributed comments for at most
three credible issues in one aliased GraphQL query using the procedure in `docs/agents/issue-tracker.md`.
An incomplete candidate stays out of recommendations until its named missing evidence is fetched. Report the current branch/worktree,
verification result, owner, outcome, dependencies, risk, route, and whether safe parallel capacity exists.
Recommend one issue and stop for the owner's choice. A yes approves that issue's stated outcome and acceptance
criteria; high-blast-radius work proceeds only through read-only planning until its concrete plan is approved.

## Start the approved job

Freshly fetch `origin/main`. Create one native worktree and `job/<issue>` branch directly from that ref; do not
switch, clean, stash, pull, or synchronize the primary checkout. If the runtime already created the approved job
worktree, verify its branch and exact base instead of creating another.

Assign one writer. Move the issue only under existing tracker authority. Install dependencies in a fresh
worktree, make the route explicit, then plan and build under `AGENTS.md`. Commit each coherent green slice
locally. Delivery waits for the owner-approved pull-request body.
