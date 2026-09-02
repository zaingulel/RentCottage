---
name: handoff
description: Park unfinished RentCottage work in a local green commit and draft pull request for a later session.
disable-model-invocation: true
---

# Handoff

Use this only for genuinely unfinished work. Finished work proceeds to delivery and `closeout`.

1. Run the focused checks that describe the current slice. Commit the coherent green state locally on the exact
   `job/<issue>` branch with a work-in-progress message. Broken or ambiguous state is reported, not called green.
2. Fill `.github/pull_request_template.md`. In `Not done`, name what is finished, what remains, the next concrete
   step, known failing or unavailable evidence, and any owner decision still needed.
3. If outward delivery is already authorised, push the exact branch and create or update its draft pull request.
   Otherwise present the filled body and request delivery approval; a local commit is not a substitute for a
   draft pull request.
4. Leave the worktree registered and untouched. Keep the issue startable under the tracker procedure.

Report the branch, commit, worktree, draft pull request when created, and one-line next step.
