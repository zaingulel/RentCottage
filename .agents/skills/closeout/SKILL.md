---
name: closeout
description: Reconcile an approved merged RentCottage job and remove its clean worktree and branch; safely advance local main after merge and retry missed updates during resume.
---

# Closeout

Run in the same session as an authorised merge, or assess a missed closeout found by `resume`.
The approved pull-request body must name the exact branch and absolute worktree path for removal. That approval
covers closeout after the merge without another routine prompt. Verify the exact targets against the original
owner approval and the delivery packet that approval covered; the editable live pull-request body alone is not
approval evidence. If that original evidence is unavailable or the targets differ, retain the targets and report
the proposed removal and recovery implications for renewed exact-target approval.

## Process reconciliation

Run this before normal completion or handoff and after a recoverable interruption. It reconciles process state
without requiring a confirmed merge; worktree and branch removal remain subject to the merged-job procedure
below.

1. Read the existing session evidence for each process launched by the job: job, worktree, command, runtime
   session handle, process identifier, start identity, and relevant parent, group, or port. Re-identify the exact
   process and ownership before acting.
2. Gracefully stop each unneeded confirmed-owned process, then verify its exit. Existing authorization rules govern
   any escalation. Preserve active sibling, foreign, and uncertain processes.
3. Record each stopped, retained, or uncertain process with its identity, reason, responsible owner, and next
   action in existing session evidence. A recoverable interruption is reconciled on the next usable session.

## Merged-job removal

Before resolving a worktree for removal, run [Process reconciliation](#process-reconciliation). Retain the target
when an owned needed or uncertain process still uses it.

1. Confirm the same-repository pull request is `MERGED`. Record its head branch, head commit, merge commit and
   named closing issues. Confirm those issues' live state; reconcile only the issues the approved body names.
   Run [Update local main](#update-local-main) after confirming the merge, even if job removal must be retained.
2. Resolve the exact local branch and registered worktree from Git, including historical branch names outside
   `job/<issue>`. Confirm the writer has stopped and no replacement task or open pull request owns the branch.
   Retain primary, current, detached, foreign, dirty, active or uncertain worktrees. Check tracked, untracked and
   ignored files; report valuable local files rather than cleaning a target to make it eligible.
3. Confirm the recorded `origin/main` target from [Update local main](#update-local-main) contains the merge
   commit.
   Require the local branch tip to equal the merged pull request's head commit; extra local commits or missing evidence retain the target.
   Run `npm run verify:board` after authorised tracker reconciliation from the current verifier checkout selected by
   [Update local main](#update-local-main). If none is available, retain the target; stale verifier code cannot
   permit removal.
4. From outside the target, recheck ownership, cleanliness and the branch tip, then use ordinary
   `git worktree remove <path>`. Verify the exact path is absent from `git worktree list --porcelain` before
   deleting its branch. The same command removes an exact stale registration when its directory is confirmed
   permanently absent, has no active owner, and its removal is approved. A temporarily unavailable or uncertain
   path is retained; a refusal never permits force removal.
5. Try `git branch -d <branch>` after the removal proofs above. Git checks the configured upstream, or current
   `HEAD` when there is no upstream; it does not independently check `origin/main`. If deletion refuses because
   that history cannot prove the merge, use
   `git update-ref -d refs/heads/<branch> <approved-head>` only after steps 1–4 prove that exact commit was the
   merged pull-request head and no worktree still checks out the branch, for either squash or ordinary merges.
   This expected-commit deletion fails if
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

1. Use the caller's just-fetched recorded `origin/main` target when available; otherwise fetch with
   `git fetch --no-prune origin main` and record the fetched commit. Read this procedure, `AGENTS.md`, and `resume`
   from that commit with `git show <recorded-origin-main>:<path>` before applying it; closeout therefore resolves
   the current procedure even when it started from an older root checkout. A failed fetch leaves freshness
   unavailable: preserve local state and stop before board operations.
2. Record `refs/heads/main`, inspect `git worktree list --porcelain` and runtime ownership, and require
   `git merge-base --is-ancestor <recorded-local-main> <recorded-origin-main>`. If local `main` is missing, ahead
   or divergent, retain it and report why. A clean checkout is eligible only when it is also idle, available, has
   no merge, rebase or other operation in progress, and no other task owns it. The coordinating resume or closeout
   session may establish that it is idle when no other owner exists.
3. When `main` is checked out, inspect tracked, untracked, and ignored files for incoming file or directory path
   collisions. Recheck ownership, branch and status immediately before
   `git -C <main-worktree> merge --ff-only --no-overwrite-ignore <recorded-origin-main>`. Preserve active,
   dirty, unavailable, uncertain, or collision-bearing checkouts; never switch, reset, stash or clean one to make
   it eligible.
4. When no worktree checks out `main` and no active task owns it, recheck the inventory and use
   `git update-ref refs/heads/main <recorded-origin-main> <recorded-local-main>`. The expected old commit protects
   against concurrent movement. This advances only an unoccupied branch ref; it does not refresh files in a root
   checkout on another branch, whose verifier checkout is selected in step 5.
5. Verify local `main` equals the recorded target and, when a checkout was updated, that it remains clean; that
   refreshed checkout is the verifier checkout. For every case without a refreshed `main` checkout — dirty, active,
   unavailable, uncertain, collision-bearing, ahead, divergent, missing, or an old topic root — select a verifier
   checkout at the recorded target: use a
   usable existing isolated checkout first, otherwise create a fresh verifier-only worktree without duplicating a
   job. If none is available, report board freshness unavailable and do not execute stale board operations. Reread
   the refreshed files from disk before board checks or decisions. Report the old and new commits, or the precise
   preserved path, branch and reason. Leave conflicts or refusals untouched.
