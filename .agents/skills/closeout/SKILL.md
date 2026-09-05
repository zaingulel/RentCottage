---
name: closeout
description: Reconcile an approved merged RentCottage job and remove its clean worktree and branch; safely advance local main after merge and retry missed updates during resume.
---

# Closeout

Run in the same session as an authorised merge, or assess a missed closeout found by `resume`.
The approved pull-request body must name the exact branch and absolute worktree path for removal. That approval
covers closeout after the merge without another routine prompt. Historical targets without that authority are
reported with the proposed removal and recovery implications for an exact-target owner decision.

1. Confirm the same-repository pull request is `MERGED`. Record its head branch, head commit, merge commit and
   named closing issues. Confirm those issues' live state; reconcile only the issues the approved body names.
   Run [Update local main](#update-local-main) after confirming the merge, even if job removal must be retained.
2. Resolve the exact local branch and registered worktree from Git, including historical branch names outside
   `job/<issue>`. Confirm the writer has stopped and no replacement task or open pull request owns the branch.
   Retain primary, current, detached, foreign, dirty, active or uncertain worktrees. Check tracked, untracked and
   ignored files; report valuable local files rather than cleaning a target to make it eligible.
3. Run `git fetch --no-prune origin main` and confirm the recorded merge commit is an ancestor of `origin/main`.
   Require the local branch tip to equal the merged pull request's head commit; extra local commits or missing evidence retain the target.
   Run `npm run verify:board` after authorised tracker reconciliation. Resolve failed verification before removal.
4. From outside the target, recheck ownership, cleanliness and the branch tip, then use ordinary
   `git worktree remove <path>`. Verify the exact path is absent from `git worktree list --porcelain` before
   deleting its branch. The same command removes an exact stale registration when its directory is confirmed
   permanently absent, has no active owner, and its removal is approved. A temporarily unavailable or uncertain
   path is retained; a refusal never permits force removal.
5. Prefer `git branch -d <branch>` when Git can prove the branch merged into `origin/main` or its retained exact
   pull-request upstream. After a squash merge with a missing upstream, use
   `git update-ref -d refs/heads/<branch> <approved-head>` only after steps 1–4 prove that exact commit was the
   merged pull-request head and no worktree still checks out the branch. This expected-commit deletion fails if
   the branch moves; it does not depend on a remote-tracking ref surviving. Never substitute `git branch -D` or
   delete a branch with a different tip. Remove that branch's local configuration section after successful ref
   deletion if it remains. Verify the local branch is absent. Check the remote branch separately; if it remains,
   report it for an exact-ref deletion decision rather than deleting a possibly reused branch. If the remote branch
   is absent and its exact remote-tracking ref still equals the approved head, remove only that stale ref with
   `git update-ref -d refs/remotes/origin/<branch> <approved-head>`.
6. Run `git worktree prune --dry-run --verbose` to report other stale registrations. Global pruning cannot bind
   its actual deletion set to an approved snapshot, so leave it report-only. Process an approved missing-directory
   job individually through steps 1–5 using its exact registered path; retain every other result.
7. Re-read worktrees and branches. Report the removed targets and every retained historical target with its
   reason. A retained target means cleanup is incomplete; distinguish it from the confirmed merge.

Stop removal on missing merge, unknown ownership, failed verification or any evidence mismatch. If the session
runs inside the target, move out through a supported runtime
operation and recheck ownership; otherwise report that removal must wait for the session to leave.

## Update local main

After an approved merge, and during resume intake to recover a missed update, advance local `main` automatically
when safe. This standing authority covers only a fast-forward local update; it does not authorise pushes or job
removal. A skipped update does not prevent unrelated job cleanup or work selection.

- Fetch with `git fetch --no-prune origin main`. Record the current `refs/heads/main` and `origin/main` commits.
  If equal, report up to date. If local `main` is missing, ahead, divergent or owned by active work, retain it and
  report why. Require `git merge-base --is-ancestor <local-main> <origin-main>` before any update.
- Inspect `git worktree list --porcelain` and runtime ownership. If any worktree has `main` checked out, update
  only from that exact checkout when it is idle, clean (including untracked files), available, and has no merge,
  rebase or other operation in progress. Recheck its branch and status immediately before
  `git -C <main-worktree> merge --ff-only <recorded-origin-main>`. Git must preserve ignored files too: inspect
  potential incoming-path collisions and use `--no-overwrite-ignore`. Retain uncertain files or ownership.
- If no worktree checks out `main` and no active task owns it, recheck the worktree inventory and use
  `git update-ref refs/heads/main <recorded-origin-main> <recorded-local-main>`. The expected old commit protects
  against concurrent branch movement. This advances the unoccupied branch without touching a primary checkout
  on another branch, including its uncommitted changes.
- Verify local `main` equals the recorded target and, when updated in a checkout, that checkout remains clean.
  Report the old and new commits or the precise skipped/failed reason. Leave conflicts or refusals untouched;
  never switch branches, reset, stash, clean, or discard local commits to make an update possible.
