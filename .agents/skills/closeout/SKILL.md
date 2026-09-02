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
4. Fetch `origin/main` and confirm the merged pull request is present. Run `npm run verify:board` after authorised
   tracker reconciliation.
5. Remove the exact clean worktree with ordinary `git worktree remove <path>`, delete the exact local branch with
   non-force `git branch -d job/<issue>`, then `git worktree prune`. The remote branch is deleted by the merge
   setting; report it if it remains rather than force-deleting it.
6. Re-read worktrees, branches, issue state, and board verification. Report every retained historical worktree;
   historical cleanup is a separate owner decision.

Stop on missing merge, unknown ownership, failed verification, or any evidence mismatch. Never clean a target to
make it eligible.
