---
name: closeout
description: "Reconcile a merged RentCottage pull request: board, issues, branches, and worktrees. Runs as soon as the agent sees the merge land; the owner can also invoke it."
---

# closeout

Runs in the same session the moment the merge lands, under the push authorisation that covered the merge;
no further ask. Everything here is observable from git and GitHub; nothing is inferred from chat.

1. **Confirm the merge.** `gh pr view <pr> --json state,mergedAt,mergeCommit` shows `MERGED`. If not, stop.
2. **Issues.** `Closes #` in the body closed them at merge; confirm with `gh issue view <n> --json state`. An
   issue the pull request resolved but did not name is reported to the owner, never closed unasked: only the
   issues the approved body names are within this run's authorisation.
3. **Main.** Run [Update local main](#update-local-main). A session inside the job worktree is retained until its
   runtime can leave it; on the Claude desktop app, the directory tool moves the session to the root checkout, so
   step 5 finishes in the same run. This does not require switching the root checkout. Stop closeout if no current
   verifier checkout is available.
4. **Board.** From the current verifier checkout selected by Update local main, run
   `node scripts/board-move.mjs --batch <issue>:Done ...` for every closed issue. Done is the board's only
   terminal column, so a card closed as superseded or not planned also moves there. Then run
   `node scripts/board.mjs --closeout` (strict: it fails on an unreadable card or a non-advisory drift row) and
   reconcile anything it reports.
5. **Branch and worktree.** Delete the local branch (`git branch -d job/<issue>`; the remote branch is deleted
   by the merge setting or `git push origin --delete <branch>`) and the worktree (`git worktree remove <path>`).
   `git worktree prune`.
6. **Rulings.** Anything the owner settled this session that should outlive it goes where it belongs: a comment
   on the issue, or the manual or rule that owns the topic. Never as a new document.

Report what was confirmed, what was moved, and anything left for the owner.

## Update local main

After a merge, and during resume intake to recover a missed update, advance local `main` automatically when safe.
This standing authority covers only a fast-forward local update and removal of the verifier-only worktree it
creates; it does not authorise pushes or any other branch or worktree removal. A skipped update does not block
independent cleanup or work selection.

1. Use the caller's just-fetched recorded `origin/main` target when available; otherwise fetch with
   `git fetch --no-prune origin main` and record the fetched commit. Read this procedure, `AGENTS.md`, and `resume`
   from that commit with `git show <recorded-origin-main>:<path>` before applying it. A failed fetch leaves
   freshness unavailable: preserve local state and stop before board operations.
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
   checkout at the recorded target: use a usable existing isolated checkout first, otherwise create a fresh
   verifier-only worktree without duplicating a job. If none is available, report board freshness unavailable and
   do not execute stale board operations. Reread the refreshed files from disk before board checks or decisions.
   A verifier-only worktree this run created is removed at the end of the same run, after board operations, with
   `git worktree remove <path>`; a reused existing checkout is left alone. Report the old and new commits, or the
   precise preserved path, branch and reason. Leave conflicts or refusals untouched.
