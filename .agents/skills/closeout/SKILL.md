---
name: closeout
description: Reconcile and remove one clean merged RentCottage job worktree after its writer stops.
---

# Closeout

Run after an authorised merge. Use only observable Git and GitHub evidence.

1. Confirm the pull request is `MERGED`, record its merged commit and named closing issues, and confirm those
   issues' live state. Reconcile only the issues the approved pull-request body names.
2. Confirm the writer has stopped and no replacement task owns the target. Resolve the exact registered
   `job/<issue>` branch and absolute worktree path.
3. From outside the target, confirm it is not primary, current, detached, foreign, dirty, active, or uncertain.
   Any such target is retained and reported.
4. Fetch `origin/main` without pruning and confirm the merged pull request is present. Confirm the local topic
   branch still tracks the exact pull-request head remote-tracking ref and both resolve to the approved head. This
   retained upstream is the non-force deletion proof after a squash merge. Run `npm run verify:board` after
   authorised tracker reconciliation.
5. Remove the exact clean worktree with ordinary `git worktree remove <path>` and verify that exact path is absent
   from `git worktree list --porcelain`. Delete the exact local branch with non-force `git branch -d job/<issue>`.
   The remote branch is deleted by the merge setting; report it if it remains. Stop if the upstream evidence is
   absent or `git branch -d` refuses; never substitute force deletion.
6. Run `git worktree prune --dry-run --verbose` only to report unrelated stale registrations. Retain every result;
   global pruning is a separate exact-target owner decision. Re-read worktrees, branches, issue state, and board
   verification, then report every retained historical worktree.

Stop on missing merge, unknown ownership, failed verification, or any evidence mismatch. Never clean a target to
make it eligible.
