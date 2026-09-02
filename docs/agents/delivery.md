# Delivery authority

## Route

- **Load trigger:** Load this authority only when preparing or executing an owner-approved delivery.
- **Owns:** Delivery commits, push, pull-request creation, current-head review, ready-only Continuous Integration (CI), auto-merge, tracker reconciliation, and closeout routing.
- **Does not own:** Work selection, planning, construction, product acceptance criteria, provider policy or a second progress record.
- **Required inputs:** The owner-approved finished bundle and exact outward actions; issue identity; absolute registered job-worktree path; exact local topic branch; and live stopped-writer ownership evidence.
- **Acquired during delivery:** The committed and pushed Object ID (OID), remote branch and pull-request identity, one current-head internal review round, one settled current-head Greptile attempt, ready-only `test`, merge evidence, tracker reconciliation, and closeout evidence.
- **Stop conditions:** Stop on missing or stale approval, conflicting authority, changed scope, unresolved findings or conversations, failed or stale CI, unknown ownership, mismatched identity, or incomplete evidence.
- **Next route:** A merged delivery proceeds to `closeout`; unfinished or refused work proceeds to `handoff` with the retained target and reason.

Do not load this document during selection-only resume, planning or ordinary construction.

## Owner-approved delivery

Before a delivery commit or outward action, the coordinator presents one delivery packet containing the finished implementation bundle and locally knowable evidence. The same packet progressively gains the evidence acquired during delivery. Completing it does not create a second record or staged manifest, and it requires no second routine owner approval while the original approval remains current.

The packet records the acceptance mapping, changed paths and commits, exact commands and results, current screenshots for visible work, security and privacy classification, migration and rollback notes, known gaps, and the proposed push, pull-request, merge, tracker, hosted-setting, deployment, and cleanup actions. The same packet gains remote evidence during delivery; it is not a second progress record or executable manifest.

Approval authorises only the actions it names. It remains current while the finished bundle and safety evidence remain unchanged. A materially changed bundle, a later unvalidated head, a new unresolved finding, a failed gate, changed ownership, or an owner withdrawal stops delivery and requires fresh direction.

Keep one writer for the ticket. Before outward delivery and again before closeout, confirm the writer has stopped and no replacement task owns the target. Clean Git state is not ownership evidence; `active` or `unknown` retains the worktree.

## Current-head delivery

Follow this bounded sequence after approval:

1. Confirm the exact branch, worktree, clean index, stopped writer, approved diff, and local verification. Commit only the approved finished bundle and record `HEAD` as `CURRENT_PR_HEAD`.
2. Push with `git push origin refs/heads/<LOCAL_TOPIC_BRANCH>:refs/heads/<PR_HEAD_BRANCH>`. Create or update a draft pull request against `main` using the approved body. Re-read `state,isDraft,headRefOid,headRefName,headRepositoryOwner,isCrossRepository,baseRefName,labels`; require the same repository, intended branch, draft state, base `main`, exact `CURRENT_PR_HEAD`, and no external-review label yet.
3. Run `security-code-review` once against the complete current pushed head. Resolve every finding. A repair creates a new head and requires focused verification plus one fresh review round.
4. Add the sole external-review label `independent-review`, then attempt Greptile once for that same current head. Record `COMPLETE` or `UNAVAILABLE` using the evidence below. Reconcile every emitted finding. No paid plan, billing change, purchase, or upgrade is authorised.
5. Re-read the pull request and require the same open draft and exact head, resolved conversations, completed required local evidence, settled Greptile attempt, and no unresolved finding. Mark it ready with `gh pr ready <PR_NUMBER> --repo zaingulel/RentCottage`.
6. GitHub's ready pull-request workflow checks the merge result. Require the current source-bound `test` check to pass under strict current-base protection. Queue the approved squash merge with `gh pr merge <PR_NUMBER> --repo zaingulel/RentCottage --auto --squash --match-head-commit <CURRENT_PR_HEAD>`. Never use `--admin`.

Greptile is the sole external reviewer and the final review step for each pull-request head. The `independent-review` label triggers it. A completed state proves processing finished, not correctness. A push invalidates review, Greptile, conversation, and CI evidence for the old head; repeat the bounded current-head sequence after a genuine repair push.

### Greptile attempt states

Record exactly one settled state for the current head:

| State | Required evidence |
| --- | --- |
| `COMPLETE` | An exact-current-head completion artifact that identifies Greptile's installed GitHub App as actor and source, its provider-produced GitHub artifact URL, complete changed-file coverage, and an evidence-based disposition for every finding. |
| `UNAVAILABLE` | Exactly one reason: `ALLOWANCE_EXHAUSTED`, `PROVIDER_UNAVAILABLE`, or `NO_EXACT_HEAD_COMPLETION`; the attempted and current head; observation time and source; artifact or exact error; and owner/coordinator notice. |

Partial changed-file coverage is `UNAVAILABLE` with reason `NO_EXACT_HEAD_COMPLETION`; name the changed, reviewed, and missing files and disposition every emitted finding. Provider unavailability or exhausted allowance is reportable rather than a merge veto after all mandatory internal review, local verification, ready-only `test`, conversation, ownership, and tracker gates pass. Missing, unknown, stale, self-authored, wrong-provider, or unattributed attempt evidence stops delivery.

## Merge, cutover, and closeout

Re-read the pull request until GitHub reports the exact approved head merged. If merge is pending, blocked, changed, or unknown, retain the worktree and report the state.

Issue #161 has one owner-approved hosted cutover after its reset pull request merges under the old protection path:

1. Atomically replace required `quality` with source-bound `test`, enable strict current-base enforcement, and preserve conversation resolution.
2. Immediately read the ruleset back and verify every required field and source identity.
3. Only after that readback passes, enable repository auto-merge and immediately read that setting back.
4. Exercise the new ready-only pull-request path.

If a hosted mutation or readback fails, stop with merges safely blocked and report the exact state. Do not restore the retired release wrapper. Future changes to these hosted settings require their own owner approval.

After authoritative merge evidence, reconcile only the issue and Project entries named by the approved pull-request body, then run `npm run verify:board`. Unavailable or failing board evidence stops closeout. Run `closeout` for the exact clean job worktree and branch; it owns the ordinary non-force Git commands and refusal rules. Historical cleanup remains a separate owner decision.

Preview or production deployment is a separate owner-approved operation under `.github/workflows/preview.yml`; ordinary code delivery does not imply deployment.

Complete the original delivery packet with the pull request and merged commit, current-head review and Greptile state, source-bound `test`, conversation resolution, hosted-setting readbacks when applicable, tracker reconciliation, board verification, closeout result, every retained target, and every unavailable or skipped observation.

Recurring maintenance is one current-head review round, one best-effort Greptile attempt, ordinary GitHub state reads, and native closeout. There is no release command, cleanup service, or additional workflow state store.
