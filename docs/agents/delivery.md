# Delivery authority

## Route

- **Load trigger:** Load this authority only when preparing or executing an owner-approved delivery.
- **Owns:** Commit, push, pull-request, review, exact-head verification, merge, tracker reconciliation, terminal release, refusal and recovery guidance.
- **Does not own:** Work selection, planning, construction, product acceptance criteria, provider policy or a second progress record.
- **Required inputs:** The approved delivery packet and exact actions authorised by the owner; issue and pull-request identities; approved full head commit Object ID (OID); absolute registered secondary-worktree path; exact local topic branch; and live writer ownership evidence.
- **Stop conditions:** Stop on missing or stale approval, conflicting authority, unresolved review, non-exact Continuous Integration (CI), unknown ownership, incomplete provider evidence, or any release refusal/failure.
- **Next route:** A terminal delivery returns to `$resume`; a parked or refused delivery returns to `$handoff` with the retained target and reason.

Do not load this document during selection-only resume, planning or ordinary construction.

## Owner-approved delivery

The coordinator presents the finished evidence packet before any outward action. Delivery approval names the exact commit, push, pull request, merge and deployment actions it covers. If merge is approved, it must also state this automatic consequence: after the exact approved pull-request head is verified merged, release the exact clean secondary worktree and its unchanged local topic branch. That consequence uses the same approval; it does not create a separate cleanup prompt.

Keep one writer for the ticket. The coordinator makes two live ownership observations: once before beginning outward delivery and again immediately before terminal release. Both must establish that the writer has stopped. The coordinator also confirms that no replacement writer or overlapping task has acquired the target, and preserves that exclusivity until the release command returns a terminal result. Git cleanliness or absent lock files are not ownership evidence. `active` and `unknown` ownership stop release.

Follow the existing review order: exact-head CodeRabbit approval and resolved findings first, then exact-head `quality` CI, then an authorised merge. Reconcile the issue and Project after the merged state is authoritative. GitHub's merged-branch setting owns remote topic-branch deletion; this release authority does not add another remote deletion path.

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

Separately, when a delivery is one of the next five substantial planned tickets in the `AGENTS.md` plan-review experiment, record that experiment's revision or owner-decision outcome, latency and token usage. The two five-item populations do not have to be the same tickets.

Recurring cost is one bounded GitHub read, one verified remote refresh and local Git checks per delivered pull request, plus maintenance of this authority, one command and one behavioural test surface.

After five completed deliveries, the owner reviews automatic invocations, successful releases, verified no-ops, refusals, false stops and residue. Remove the mechanism if Codex or an existing repository control provides equivalent exact identity, merged-state, ownership, cleanliness, race and post-removal guarantees. Simplify it when a lower-cost control preserves every material guarantee.
