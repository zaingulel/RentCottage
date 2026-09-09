# Delivery authority

## Route

- **Load trigger:** Load this authority only when preparing or executing an owner-approved delivery.
- **Owns:** Push, pull-request creation, ready-only Continuous Integration (CI), auto-merge, tracker reconciliation, and closeout routing.
- **Does not own:** Work selection, planning, construction, product acceptance criteria, provider policy or a second progress record.
- **Required inputs:** The owner-approved committed bundle and exact outward actions; reviewed commit; issue identity; absolute registered job-worktree path; exact local topic branch; and live stopped-writer ownership evidence.
- **Acquired during delivery:** The pushed Object ID (OID), remote branch and pull-request identity, documentation-only classification or one settled current-head Greptile attempt, the applicable required check, merge evidence, tracker reconciliation, and closeout evidence.
- **Stop conditions:** Stop on missing or stale approval, conflicting authority, changed scope, unresolved findings or conversations, failed or stale CI, unknown ownership, mismatched identity, or incomplete evidence.
- **Next route:** A merged delivery proceeds to `closeout`; unfinished or refused work proceeds to `handoff` with the retained target and reason.

Do not load this document during selection-only resume, planning or ordinary construction.

## Owner-approved delivery

Before an outward action, the coordinator presents one delivery packet containing the finished committed implementation bundle and locally knowable evidence. The same packet progressively gains the evidence acquired during delivery. Completing it does not create a second record or staged manifest, and it requires no second routine owner approval while the original approval remains current.

The packet records the acceptance mapping, changed paths and commits, exact commands and results, current screenshots for visible work, security and privacy classification, migration and rollback notes, known gaps, and the proposed push, pull-request, merge, tracker, hosted-setting, deployment, and cleanup actions. The same packet gains remote evidence during delivery; it is not a second progress record or executable manifest.

Approval authorises only the actions it names. It remains current for same-outcome repairs and rebases after the
new head receives fresh focused verification, applicable scoped internal review, full-diff classification,
current-head Greptile handling, and CI. An unresolved finding or failed gate pauses progression until the
same-outcome repair and its required evidence are complete. A material change to product meaning, outcome, scope,
risk or named outward actions; changed ownership; or an owner withdrawal requires fresh direction.

Keep one writer for the ticket. Before outward delivery and again before closeout, confirm the writer has stopped and no replacement task owns the target. Clean Git state is not ownership evidence; `active` or `unknown` retains the worktree.

## Current-head delivery

Follow this bounded sequence after approval:

1. Confirm the exact branch, worktree, clean index, stopped writer, approved committed diff, local verification,
   and completed bounded internal review. Require the reviewed commit to equal `HEAD` and record it as
   `CURRENT_PR_HEAD`.
2. Push with `git push --set-upstream origin refs/heads/<LOCAL_TOPIC_BRANCH>:refs/heads/<PR_HEAD_BRANCH>`. Confirm the local branch now tracks the exact pull-request head remote ref; this retained remote-tracking ref supports ordinary branch deletion after a squash merge. If it later disappears, `closeout` owns the verified exact-head fallback. Create or update a draft pull request against `main` using the approved body. Re-read `state,isDraft,headRefOid,headRefName,headRepositoryOwner,isCrossRepository,baseRefName,labels`; require the same repository, intended branch, draft state, base `main`, exact `CURRENT_PR_HEAD`, and no external-review label yet.
3. Classify the full pull-request diff using the documentation-only exception below. If exempt, record that Greptile is not required and proceed to step 4 without adding a review label or posting a review request. Otherwise check [current allowance](#current-allowance). Confirmed exhaustion records `UNAVAILABLE` and proceeds to step 4 without a request. When credits are available, add `independent-review` as review metadata and request `gh pr comment <PR_NUMBER> --repo zaingulel/RentCottage --body "@greptileai review this draft"`. Record the request URL, time, and exact `CURRENT_PR_HEAD`. Settle the attempt using the evidence below and reconcile every emitted finding before proceeding. No paid plan, billing change, purchase, or upgrade is authorised.
4. Re-read the pull request and require the same open draft and exact head, resolved conversations, completed required local evidence, either the documentation-only classification or a settled Greptile attempt, and no unresolved finding. Mark it ready with `gh pr ready <PR_NUMBER> --repo zaingulel/RentCottage`.
5. GitHub's ready-only workflow checks the merge result. Require the current source-bound `test` check under
   strict current-base protection, then queue
   `gh pr merge <PR_NUMBER> --repo zaingulel/RentCottage --auto --squash --match-head-commit <CURRENT_PR_HEAD>`.

Never use `--admin`.

**Documentation-only exception:** Changes confined to documentation or prose agent instructions skip Greptile to preserve review allowance. Inspect the full pull-request diff: accompanying product code, tests, dependencies, or executable/provider/CI configuration requires Greptile. Record the exemption in the delivery packet. Required local evidence, owner approval, CI and merge protection still apply.

When required, Greptile is the sole external reviewer and the final review step for each pull-request head. `.greptile/config.json` disables automatic reviews; labels are metadata, and the explicit comment starts the review. Marking ready, pushing, and retrying CI must not request another review of an unchanged head.

Before pushing a same-outcome repair or rebase, keep the pull request in draft (`gh pr ready <PR_NUMBER> --repo zaingulel/RentCottage --undo` if already ready). Complete focused verification, commit the change, and complete the scoped local repair review required by `AGENTS.md` before pushing. Any changed head invalidates the old classification, Greptile and CI evidence: record the new head and reassess the full diff. If Greptile is required, request `@greptileai review this draft again; <what changed> in <commit>` and settle it before marking ready. Rebase before the final required Greptile attempt, not between that attempt and CI. An unchanged-head CI retry needs no new review. Return to the owner only when the repair or rebase changes product meaning, outcome, scope, risk, or the named outward actions.

Keep this manual-request configuration, documentation-only exception and review-before-CI ordering consistent with Flow Metrics and copy them when setting up another repository. The GitHub workflow enforces draft versus ready, not proof of the earlier review; the coordinator must verify the classification and any required attempt before changing that state. Greptile documents [manual-only configuration](https://www.greptile.com/docs/code-review/greptile-json-reference) and [explicit draft requests](https://www.greptile.com/docs/code-review/tips-recipes).

### Current allowance

Before requesting a nonexempt review, read current usage from an authoritative provider surface, such as
[Greptile's usage and billing dashboard](https://www.greptile.com/docs/code-review-bot/billing-seats).
Record the source, observation time, and available or exhausted allowance for the intended review in the existing
delivery packet. Use included or already purchased credits; this instruction does not authorize additional spend.
Historical exhaustion or a reported top-up only guides the lookup. Check again for each later delivery or changed-head
request: replenishment or a billing-period reset restores normal review use when current credits are confirmed.

If usage cannot be read, make one read-only retry, then retain the draft and ask only for the missing current-usage
fact, explaining the failed lookup. A queued, running, silent, or partial review likewise remains unresolved: record
the observed state and time, make one follow-up observation, then report the gap and ask only for a necessary missing
fact or new decision. Neither case proves exhaustion or a clean review, and neither reopens approval of the named
delivery actions. Keep the original approval and its covered packet available when resuming; verify current ownership,
head, required evidence, and exact cleanup targets before continuing its remaining actions.

### Greptile attempt states

When Greptile is required, record exactly one settled state for the current head:

| State | Required evidence |
| --- | --- |
| `COMPLETE` | Greptile's completed review for the exact current head, its summary, and an evidence-based disposition for every emitted finding. Read the check status, summary's last-reviewed commit, pull-request reviews, and inline threads; a summary can precede inline findings. A re-review can update the existing summary and its `Reviews (N)` footer in place. |
| `UNAVAILABLE` | Current authoritative exhausted-allowance evidence with source, observation time, and exact head; record that no request was made. Alternatively, the explicit request URL, exact head, observation time, and provider-failure evidence. Report the gap in the delivery packet. A label-only attempt, filtered skip, missing response, or queued/running review does not establish unavailability; follow the unresolved handling above. |

Provider unavailability or exhausted allowance is reportable rather than a merge veto after all mandatory internal review, local verification, ready-only `test`, conversation, ownership, and tracker gates pass. Missing, stale, self-authored, wrong-provider, or unattributed attempt evidence stops delivery.

## Merge and closeout

Re-read the pull request until GitHub reports the exact approved head merged. If merge is pending, blocked, changed, or unknown, retain the worktree and report the state.

After authoritative merge evidence, reconcile only the issue and Project entries named by the approved pull-request body, then run `npm run verify:board`. Unavailable or failing board evidence stops closeout. Run `closeout` for the exact approved job worktree and branch; it owns removal proofs, exact-ref operations, refusal rules, and safe local-main updates. Missed cleanup may reuse existing exact-target closeout approval; historical targets without it require a separate owner decision.

Preview or production deployment is a separate owner-approved operation under `.github/workflows/preview.yml`; ordinary code delivery does not imply deployment.

Complete the original delivery packet with the pull request and merged commit, internal review and current-head Greptile state or documentation-only exemption, source-bound `test`, conversation resolution, hosted-setting readbacks when applicable, tracker reconciliation, board verification, closeout result, every retained target, and every unavailable or skipped observation.

Recurring maintenance is the applicable local review, one best-effort Greptile attempt when required, ordinary GitHub state reads, and native closeout. There is no release command, cleanup service, or additional workflow state store.
