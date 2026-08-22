# Delivery authority

## Route

- **Load trigger:** Load this authority only when preparing or executing an owner-approved delivery.
- **Owns:** Commit, push, pull-request, review, exact-head verification, merge, tracker reconciliation, terminal release, refusal and recovery guidance.
- **Does not own:** Work selection, planning, construction, product acceptance criteria, provider policy or a second progress record.
- **Required inputs:** The approved delivery packet and exact actions authorised by the owner; resolved external-review route and matched rule; issue and pull-request identities; approved full head commit Object ID (OID); absolute registered secondary-worktree path; exact local topic branch; and live writer ownership evidence.
- **Stop conditions:** Stop on missing or stale approval, conflicting authority, unresolved review, non-exact Continuous Integration (CI), unknown ownership, incomplete provider evidence, or any release refusal/failure.
- **Next route:** A terminal delivery returns to `$resume`; a parked or refused delivery returns to `$handoff` with the retained target and reason.

Do not load this document during selection-only resume, planning or ordinary construction.

## Owner-approved delivery

The coordinator presents the finished evidence packet before any outward action.

### Approval scope and persistence

Delivery approval is semantic, contextual, cumulative, and persistent; it requires no prescribed phrase. A clear contextual directive or request authorises the outward actions it names, and a clear affirmative response authorises the exact coordinator-proposed action list. Incidental, hypothetical, or capability-only mentions do not authorise outward action.

The latest clear owner instruction supersedes earlier narrower coordinator wording. The coordinator must not add an exclusion such as `No merge` unless the owner requested it. While approval remains current, perform every authorised action without asking the owner to repeat or restate approval. Time passing and progress between delivery stages do not make approval stale.

Approval becomes stale only when:

- the exact approved head changes or the approved scope changes materially;
- a new unresolved finding appears;
- a required safety, ownership, review, or Continuous Integration gate fails;
- the owner withdraws or narrows approval.

If merge is authorised, after the exact approved pull-request head is verified merged, tracker reconciliation and guarded terminal release continue automatically under the same approval. Release the exact clean secondary worktree and its unchanged local topic branch without a separate cleanup prompt.

### Ownership continuity

Keep one writer for the ticket. The coordinator makes two live ownership observations: once before beginning outward delivery and again immediately before terminal release. Both must establish that the writer has stopped. The coordinator also confirms that no replacement writer or overlapping task has acquired the target, and preserves that exclusivity until the release command returns a terminal result. Git cleanliness or absent lock files are not ownership evidence. `active` and `unknown` ownership stop release.

## External review and exact-head quality

Follow this bounded sequence:

1. **Create draft:** Use Graphite stack management, including `gt submit`, as needed to create or update a draft pull request. Graphite stack management is distinct from Graphite AI review and does not select the external reviewer.
2. **Select route:** Resolve the `AGENTS.md` table before publication and apply exactly one route label: `Greptile only` uses `independent-review`; `Graphite only` uses `graphite-review`.
3. **Publish:** Immediately before marking the pull request ready for review, use GitHub to freshly read its exact label set, draft state, and head. Publish only when it is still a draft, `CURRENT_PR_HEAD` is the intended head, and exactly the selected route label is present. The selected route label is immutable after publication; a change stops delivery instead of switching providers.
4. **Selected external review:** `head=CURRENT_PR_HEAD`; require the selected provider only to finish its exact-head completion, coverage, and findings reconciliation. For Greptile, manually request Greptile's exact-head re-review after every later push; do not rely on automatic new-commit reviews.
5. **Exact-head quality:** `after=Selected external review`; `head=CURRENT_PR_HEAD`; only after the selected external review is complete, explicitly dispatch `quality` from trusted `main` with `gh workflow run ci.yml --ref main -f pull_request_number=<PR> -f expected_head_oid=<CURRENT_PR_HEAD>`.

A provider's completed state proves processing finished, not that the change is correct or approved. Independent review of the finished change and every applicable executable verification must also be complete before merge; external reviewers supplement this evidence and never replace it.

### Selected-provider evidence

**Cross-repository prerequisite:** None. RentCottage delivery stands or stops only on its own repository authority and provider settings.

Each push advances `CURRENT_PR_HEAD`, invalidates the selected provider and Continuous Integration evidence, and restarts the selected review sequence. Record every row for the selected review:

| Packet fields | Complete evidence |
| --- | --- |
| `provider`, `source`, `artifact` | The selected provider only; its installed GitHub App; its GitHub artifact URL. |
| `route`, `matched-rule`, `label` | The exclusive route and resolved `AGENTS.md` rule; exactly `independent-review` for `Greptile only` or `graphite-review` for `Graphite only`. |
| `completion`, `head` | `OBSERVED` only when the selected provider's completion artifact identifies `CURRENT_PR_HEAD`. |
| `changed-files`, `reviewed-files`, `coverage` | The selected provider's count or file summary accounts for every GitHub changed file; coverage is `COMPLETE`. |
| `findings` | Every finding has an evidence-based disposition. |

Every required row must be present. `SKIPPED`, `FAILED`, `STALE`, or `PARTIAL` evidence is incomplete. Zero route labels, both route labels, a changed head, a route-label change after publication, unselected-provider activity, missing or stale selected-provider evidence, and provider filtering that is unavailable or disagrees with this authority stop pull-request publication or delivery. Reconcile repository policy and provider settings before continuing; do not switch routes on a published pull request.

The required dashboard state for RentCottage during the free Graphite Team trial is: Graphite enables RentCottage, includes only `graphite-review`, and keeps draft AI reviews off; Greptile enables RentCottage, includes only `independent-review`, keeps draft reviews off, and keeps automatic new-commit reviews off. The trial ends on 17 September 2026. No paid provider plan is authorised. If the trial ends or either provider cannot preserve these filters, including after a Graphite Hobby downgrade, delivery stops until the owner approves a reconciled RentCottage repository and provider policy.

Before 17 September 2026, recheck and record whether Graphite Hobby preserves the saved `graphite-review` include filter. An unavailable or unverified Hobby result produces `STOP`; reconcile the RentCottage repository authority and RentCottage provider settings before continuing RentCottage delivery.

Interpret Greptile evidence against its current [review anatomy](https://www.greptile.com/docs/code-review/first-pr-review), [GitHub App integration](https://www.greptile.com/docs/integrations/github-gitlab-integration), and [`fileChangeLimit` contract](https://www.greptile.com/docs/code-review/greptile-json-reference). Keep both providers human-observed: repository workflows parse no provider comments, hidden markers, or status prose and define no provider credential, trigger, or merge gate.

Only after the sequence and all other approved evidence are complete may the coordinator perform an authorised merge. GitHub Actions verifies the exact head; the hosted GitHub repository ruleset must require `quality` from the observed GitHub Actions source, application or integration, not the `quality` check name alone, and must also enforce conversation resolution. Changing that hosted ruleset remains an explicit owner-gated action. Reconcile the issue and Project after the merged state is authoritative, then run `npm run verify:board`; unavailable or failing board evidence stops delivery. GitHub's merged-branch setting owns remote topic-branch deletion; this release authority does not add another remote deletion path.

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

The delivery packet retains the universal fields in `AGENTS.md` and additionally records:

- terminal result: `released`, `recovered`, `already-released`, `refused`, `incomplete`, or `failed`;
- whether automatic invocation occurred, or the exact reason it did not;
- retained target and bounded reason for every non-success result;
- whether an ownership observation falsely stopped a safe release;
- any residue remaining after the task; and
- for each of the first five completed deliveries, the release outcome and cleanup observations listed above.

Recurring cost is one bounded GitHub read, one verified remote refresh and local Git checks per delivered pull request, plus maintenance of this authority, one command and one behavioural test surface.

Recurring maintenance is one explicit routing decision, one selected-provider review plus finding reconciliation, a fresh pre-publication state read, and a manual Greptile re-trigger after each later push on the Greptile route. Existing internal review and verification costs remain unchanged.

Reassess or remove this routing layer if the free Graphite Team trial or Greptile allowance ends, either label filter no longer works reliably, selected reviews repeatedly return partial coverage, or representative reviews show no unique material findings beyond the managed reviewers. Replace it only with an independently evidenced control that preserves reviewer diversity at lower cost or higher reliability.

After five completed deliveries, the owner reviews automatic invocations, successful releases, verified no-ops, refusals, false stops and residue. Remove the mechanism if Codex or an existing repository control provides equivalent exact identity, merged-state, ownership, cleanliness, race and post-removal guarantees. Simplify it when a lower-cost control preserves every material guarantee.
