---
name: handoff
description: Park genuinely unfinished RentCottage work so the next session can pick it up from git.
disable-model-invocation: true
---

# handoff

Owner-invoked to park unfinished work. Completed work uses `closeout`.

1. **Commit what exists** on the job branch with a message that says it is work in progress. Run the slice's
   focused evidence and any applicable generated-type or declared-schema checks first; incomplete required
   evidence is named in the draft rather than presented as green.
2. **Push the branch** and open or update a draft pull request (`gh pr create --draft`) whose body fills
   `.github/pull_request_template.md`. Write the **Not done** section for a reader with no memory of this
   session: what is finished, what is not, the next concrete step, and any decision the owner still owes.
3. **Board.** `node scripts/board-move.mjs <issue> Ready`, so the card is startable by the next session.
4. **Leave the worktree in place.** The next session finds the branch in `resume` step 1.

Report the branch, the pull request number, and the one-line next step.
