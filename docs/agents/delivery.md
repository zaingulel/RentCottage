# Delivery authority

## Route

- **Load trigger:** Load this authority only when preparing or executing an owner-approved delivery.
- **Owns:** Commits made as part of delivery, push, pull-request, review, exact-head verification, merge, tracker reconciliation, terminal release, refusal and recovery guidance.
- **Does not own:** Work selection, planning, construction, product acceptance criteria, provider policy or a second progress record.
- **Required inputs at start:** The owner-approved finished bundle and exact authorised actions; issue identity; absolute registered secondary-worktree path; exact local topic branch; and live stopped-writer ownership evidence.
- **Acquired during delivery:** The materialized commit Object ID (OID); current pushed-head Object ID; remote branch metadata; pull-request identity and state; settled exact-head Greptile attempt; fresh exact-head internal reviews; exact-head quality; merge evidence; tracker reconciliation; and terminal release evidence.
- **Stop conditions:** Stop on missing or stale approval, conflicting authority, unresolved internal or completed Greptile findings, non-exact Continuous Integration (CI), unknown ownership, incomplete Greptile evidence, or any release refusal/failure.
- **Next route:** A terminal delivery returns to `$resume`; a parked or refused delivery returns to `$handoff` with the retained target and reason.

Do not load this document during selection-only resume, planning or ordinary construction.

## Owner-approved delivery

Before a delivery commit or outward action, the coordinator presents one delivery packet containing the finished implementation bundle and locally knowable evidence. The same packet progressively gains the evidence acquired during delivery. Completing it does not create a second record or staged manifest, and it requires no second routine owner approval while the original approval remains current.

### Approval scope and persistence

Delivery approval is semantic, contextual, cumulative, and persistent; it requires no prescribed phrase. A clear contextual directive or request authorises the outward actions it names, and a clear affirmative response authorises the exact coordinator-proposed action list. Incidental, hypothetical, or capability-only mentions do not authorise outward action.

The latest clear owner instruction supersedes earlier narrower coordinator wording. The coordinator must not add an exclusion such as `No merge` unless the owner requested it. While approval remains current, perform every authorised action without asking the owner to repeat or restate approval. Time passing and progress between delivery stages do not make approval stale.

An ordinary commit made during delivery for the unchanged approved finished bundle does not make approval stale. The resulting committed head is `CURRENT_PR_HEAD`; a materially altered bundle or any later head not freshly validated against the approved finished bundle makes approval stale and stops delivery.

Approval becomes stale only when:

- the approved finished bundle or scope changes materially;
- a later head has not been freshly validated against the approved finished bundle;
- a new unresolved finding appears;
- a required safety, ownership, review, or Continuous Integration gate fails;
- the owner withdraws or narrows approval.

If merge is authorised, after the exact approved pull-request head is verified merged, tracker reconciliation and guarded terminal release continue automatically under the same approval. Release the exact clean secondary worktree and its unchanged local topic branch without a separate cleanup prompt.

### Ownership continuity

Keep one writer for the ticket. The coordinator makes two live ownership observations: once before beginning outward delivery and again immediately before terminal release. Both must establish that the writer has stopped. The coordinator also confirms that no replacement writer or overlapping task has acquired the target, and preserves that exclusivity until the release command returns a terminal result. Git cleanliness or absent lock files are not ownership evidence. `active` and `unknown` ownership stop release.

## External review and exact-head quality

Follow this bounded sequence:

1. **Create draft:** After approval, require the exact approved finished bundle to be committed on the local topic branch. Create an ordinary commit only for approved changes that remain uncommitted, then record the resulting `HEAD` as `CURRENT_PR_HEAD`. Push with `git push origin refs/heads/<LOCAL_TOPIC_BRANCH>:refs/heads/<PR_HEAD_BRANCH>` and record the exact pushed commit OID. Then create the pull request with `gh pr create --repo zaingulel/RentCottage --draft --base main --head zaingulel:<PR_HEAD_BRANCH> --title <TITLE> --body-file /absolute/path/to/approved-pr-body.md --label independent-review`. Freshly read and record the exact pushed head and current remote branch metadata; a mismatch stops delivery.
2. **Publish:** Immediately before publication, freshly read the pull request with `gh pr view <PR_NUMBER> --repo zaingulel/RentCottage --json state,isDraft,headRefOid,headRefName,headRepositoryOwner,isCrossRepository,baseRefName,labels` and require the same repository with `isCrossRepository=false`, draft state, base `main`, exact head `CURRENT_PR_HEAD`, intended remote head branch, and exactly `independent-review` among external-review labels. Publish only with `gh pr ready <PR_NUMBER> --repo zaingulel/RentCottage` while every value remains current.
3. **Attempt Greptile:** `head=CURRENT_PR_HEAD`; request an exact-head Greptile review and settle the attempt as `COMPLETE` or `UNAVAILABLE` using the evidence below. No paid plan, billing change, purchase, or upgrade is authorised.
4. **Fresh exact-head internal review:** `after=settled Greptile attempt`; run `security-code-review` against the complete exact pushed head bundle. `UNKNOWN` stops. Use entirely fresh Standards and Specification reviewers, plus a fresh Security reviewer when the aggregate is `ANY_YES`; every required verdict and finding disposition must be current for `CURRENT_PR_HEAD`. Pre-outward review verdicts are ineligible for exact-head quality.
5. **Exact-head quality:** `after=fresh exact-head internal review`; `head=CURRENT_PR_HEAD`; only after the fresh required reviews, required local verification, and every finding emitted by a completed or unavailable Greptile attempt has an evidence-based disposition, explicitly dispatch `quality` from trusted `main` with `gh workflow run ci.yml --repo zaingulel/RentCottage --ref main -f pull_request_number=<PR_NUMBER> -f expected_head_oid=<CURRENT_PR_HEAD>`.

Greptile is the sole external reviewer. The `independent-review` label is its trigger and evidence label, not a route selector. Greptile supplements independent internal review and executable checks and never replaces them. A completed state proves only that processing finished, not that the change is correct or approved.

### Greptile attempt states

Record exactly one settled state for the current head:

| State | Required evidence |
| --- | --- |
| `COMPLETE` | An exact-current-head completion artifact that identifies Greptile's installed GitHub App as actor and source, its provider-produced GitHub artifact URL, complete changed-file coverage, and an evidence-based disposition for every finding. |
| `UNAVAILABLE` | Exactly one reason: `ALLOWANCE_EXHAUSTED`, `PROVIDER_UNAVAILABLE`, or `NO_EXACT_HEAD_COMPLETION`; the attempted and current head; observation time and source; artifact or exact error; and owner/coordinator notice. |

Partial or incomplete exact-head coverage is `UNAVAILABLE` with reason `NO_EXACT_HEAD_COMPLETION`. Its record must name the changed, reviewed, and missing files and include dispositions for every finding that was emitted. Exhausted allowance or provider unavailability is reportable, but it is not a merge veto after all mandatory pre-merge gates are green: internal reviews, local verification, exact-head quality, conversation resolution and ownership. Post-merge tracker reconciliation, board verification, ownership and guarded release remain mandatory.

Missing, unknown, stale, or unattributed attempt evidence stops delivery. Self-authored, wrong-provider, missing, untrusted, or unattributed artifacts cannot be `COMPLETE` and stop delivery. A push invalidates Greptile, internal-review, and Continuous Integration evidence. Every repair uses an ordinary Git commit and `git push origin refs/heads/<LOCAL_TOPIC_BRANCH>:refs/heads/<PR_HEAD_BRANCH>`. A repair push receives a fresh exact-head Greptile attempt when allowance permits, or a new exact-head `UNAVAILABLE` record otherwise. It then restarts the exact-head Greptile attempt, `security-code-review` classification, entirely new internal reviewers, and exact-head quality. Never carry any of this evidence across heads.

Before merge, run `gh pr view <PR_NUMBER> --repo zaingulel/RentCottage --json state,isDraft,headRefOid,headRefName,headRepositoryOwner,isCrossRepository,baseRefName,labels,reviewDecision,statusCheckRollup`, freshly read conversation resolution, and require `OPEN`, ready for review, the same repository with `isCrossRepository=false`, base `main`, exact head `CURRENT_PR_HEAD`, intended remote head branch, `independent-review`, no other external-review label, all conversations resolved, and current source-bound `quality` for that head. Merge only with `gh pr merge <PR_NUMBER> --repo zaingulel/RentCottage --squash --match-head-commit <CURRENT_PR_HEAD>`. Do not use `--admin`.

GitHub Actions verifies the exact head; the hosted GitHub repository ruleset must require `quality` from the observed GitHub Actions source, application or integration, not the `quality` check name alone, and must also enforce conversation resolution. Changing that hosted ruleset remains an explicit owner-gated action. Reconcile the issue and Project after the merged state is authoritative, then run `npm run verify:board`; unavailable or failing board evidence stops delivery. GitHub's merged-branch setting owns remote topic-branch deletion; this release authority does not add another remote deletion path.

## Terminal release

Automatic invocation is part of the owning coordinator task. After the second ownership observation and exact merge evidence, run:

```sh
npm run release:delivery -- \
  --worktree /absolute/registered/secondary-worktree \
  --branch exact/local-topic-branch \
  --head 40-character-approved-head-oid \
  --pull-request 123 \
  --writer-state stopped
```

The stable command is `release:delivery`; its implementation is `scripts/release-delivery.mjs` and its public-boundary tests are `scripts/release-delivery.test.mjs`.

The command treats `--writer-state` as a coordinator assertion, not as discovered filesystem truth. It validates all arguments before external work, reads bounded same-repository GitHub evidence, refreshes the verified default branch, repeats local identity and cleanliness checks, removes only allowed generated output plus the exact worktree without force, compare-deletes only the exact unchanged branch, and verifies both identities are absent. It never sweeps historical residue or uses a committed candidate roster.

Provider evidence is pinned to the `zaingulel/RentCottage` repository on `github.com`. A repository rename, transfer, fork or alternate host must be reviewed and updated in the command contract before release can proceed.

The single-line JSON result is bounded and names the target and reason:

- Exit `0`: `released`, `recovered`, or `already-released`.
- Exit `2`: invalid input rejected before external work.
- Exit `3`: safety refusal; retain the target.
- Exit `4`: incomplete local, GitHub or merge evidence; retain the target.
- Exit `5`: mutation failed or remained incomplete; inspect the named retained identity before retrying.

`recovered` is the restartable branch-only continuation after a prior exact worktree removal. `already-released` is a verified no-op when both local identities are absent and immutable GitHub head evidence still matches. Any other partial state is retained. On refusal or failure, do not improvise deletion or use force: record the bounded reason, re-establish current evidence, then rerun the same exact interface or hand off.

Historical residue is considered only one target at a time from a fresh complete `git worktree list` inventory, live coordinator ownership observations and exact pull-request proof. Age, naming or a previous list is never deletion authority.

## Delivery packet and maintenance evidence

The same delivery packet is progressively completed. It retains the universal fields in `AGENTS.md` and additionally records:

- terminal result: `released`, `recovered`, `already-released`, `refused`, `incomplete`, or `failed`;
- whether automatic invocation occurred, or the exact reason it did not;
- retained target and bounded reason for every non-success result;
- whether an ownership observation falsely stopped a safe release;
- any residue remaining after the task; and
- for each of the first five completed deliveries, the release outcome and cleanup observations listed above.

Recurring cost is one bounded GitHub read, one verified remote refresh and local Git checks per delivered pull request, plus maintenance of this authority, one command and one behavioural test surface.

Recurring maintenance is one best-effort exact-head Greptile attempt plus finding reconciliation and fresh pre-publication and pre-merge state reads. Existing internal review and verification costs remain unchanged.

After five completed deliveries, the owner reviews automatic invocations, successful releases, verified no-ops, refusals, false stops and residue. Remove the mechanism if Codex or an existing repository control provides equivalent exact identity, merged-state, ownership, cleanliness, race and post-removal guarantees. Simplify it when a lower-cost control preserves every material guarantee.
