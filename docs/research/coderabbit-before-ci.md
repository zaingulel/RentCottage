# CodeRabbit review before GitHub Actions CI

Research date: 13 August 2026

## Conclusion

Yes, RentCottage can run CodeRabbit first and allocate a GitHub-hosted runner for full CI only after CodeRabbit considers the current pull request head approved.

The reliable gate is a CodeRabbit `APPROVED` pull request review, not the green `CodeRabbit` commit status. Enable CodeRabbit's Request Changes Workflow, disable its GitHub Checks reader to remove the opposite dependency, and run the full CI job only for a current-head approval submitted by `coderabbitai[bot]`.

CodeRabbit does not document a setting that directly starts GitHub Actions when a review becomes clean. GitHub Actions must consume CodeRabbit's structured review event.

## What RentCottage does today

The open [PR #53](https://github.com/zaingulel/RentCottage/pull/53) introduces a `CI` workflow triggered by both `pull_request` and `workflow_dispatch`. Therefore its `quality` job starts at the same time as CodeRabbit on every pull request update.

Direct GitHub API inspection showed that CodeRabbit currently publishes a legacy commit status context, not a Checks API check run:

| Producer | GitHub object | Exact name | Observed states/conclusions | Meaning |
|---|---|---|---|---|
| CodeRabbit | Commit status (`StatusContext`) | `CodeRabbit` | `pending`, then `success` | Descriptions observed were `Review queued`, `Review in progress`, and `Review completed` |
| GitHub Actions | Check run | `quality` | GitHub check-run conclusions such as `success`, `failure`, `cancelled` | The CI job |
| GitHub Actions | Check run | `preview` | Usually `skipped` for pull request runs because the job is manual-only | The preview deployment job |

The exact status history is visible through GitHub's [commit-status API for an earlier PR head](https://api.github.com/repos/zaingulel/RentCottage/commits/c22ca82d573d8e5b9f1fae1ac20e27bc69135648/statuses). That head received `CodeRabbit: success` with description `Review completed`, although CodeRabbit's [submitted review](https://api.github.com/repos/zaingulel/RentCottage/pulls/53/reviews) was `COMMENTED` and reported 12 actionable comments. Therefore:

> `CodeRabbit: success` means that review processing finished. It does not mean that the review found no problems.

This is the most important constraint. A workflow gated only on `github.event.context == 'CodeRabbit' && github.event.state == 'success'` would run CI after any completed review, including a review with findings.

At research time, [repository rulesets](https://api.github.com/repos/zaingulel/RentCottage/rulesets) were empty and the [main branch protection endpoint](https://api.github.com/repos/zaingulel/RentCottage/branches/main/protection) reported that the branch was not protected. Sequencing alone therefore does not stop someone from merging without CodeRabbit or CI.

## Recommended design

### 1. Make CodeRabbit's approval the clean-review signal

Enable:

```yaml
reviews:
  request_changes_workflow: true
```

CodeRabbit documents that this setting is `false` by default and that it automatically approves a pull request once its comments are resolved and no blocking pre-merge checks are failing. When findings exist, its Request Changes Workflow submits `REQUEST_CHANGES`; when the findings are resolved and blocking pre-merge checks pass, it submits `APPROVED`. See the official [configuration reference](https://docs.coderabbit.ai/reference/configuration) and [Request Changes Workflow definition](https://docs.coderabbit.ai/reference/glossary#request-changes-workflow).

This is stronger than the commit status because an approval represents CodeRabbit's pull-request-level clean state, including unresolved findings and blocking pre-merge checks.

Two configuration details matter:

- Set `reviews.auto_review.auto_pause_after_reviewed_commits: 0` if every push must be reviewed automatically. CodeRabbit's current default is 5 reviewed commits, after which automatic incremental reviews pause until manually resumed. See [Automatic review controls](https://docs.coderabbit.ai/configuration/auto-review#auto-pause-after-reviewed-commits).
- Classify must-pass pre-merge checks as `error`, and turn irrelevant checks `off`. `warning` is deliberately non-blocking, so an approval does not necessarily mean that every warning shown in the walkthrough disappeared. CodeRabbit documents the enforcement modes under [Pre-Merge Checks](https://docs.coderabbit.ai/pr-reviews/pre-merge-checks#enforcement-modes).

CodeRabbit comments can also be manually resolved or overridden by authorized people. If “green” must be fail-closed, restrict pre-merge overrides with `reviews.pre_merge_checks.override_requested_reviewers_only: true`, require conversation resolution in GitHub, and keep an audit expectation that findings are fixed rather than merely marked resolved.

### 2. Remove CodeRabbit's dependency on CI

CodeRabbit's GitHub Checks integration is enabled by default. It waits for GitHub checks and reads their failures into the review. That is the reverse ordering from the requested design. Disable it:

```yaml
reviews:
  tools:
    github-checks:
      enabled: false
```

This avoids a circular or delayed dependency in which CodeRabbit waits for CI while CI waits for CodeRabbit. The tradeoff is intentional: CodeRabbit will no longer analyze CI failure logs during the same review. See CodeRabbit's official [GitHub Checks documentation](https://docs.coderabbit.ai/tools/github-checks).

### 3. Give only the qualifying review a `quality` check

GitHub Actions supports `pull_request_review` with activity type `submitted`, and exposes the review state as `github.event.review.state`. GitHub's official example gates a job on `approved`; see [Running a workflow when a pull request is approved](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#running-a-workflow-when-a-pull-request-is-approved).

Use that event in a workflow whose job condition is equivalent to:

```yaml
if: >-
  github.event.review.user.login == 'coderabbitai[bot]' &&
  github.event.review.user.id == 136622811 &&
  github.event.review.state == 'approved' &&
  github.event.review.commit_id == github.event.pull_request.head.sha &&
  github.event.pull_request.head.repo.full_name == github.repository
```

The conditions prevent a human approval, a CodeRabbit comment or request-changes review, a stale approval for an older commit, or a fork ref from starting full CI. The current REST payload confirms the CodeRabbit service login is exactly `coderabbitai[bot]`, its numeric user ID is `136622811`, and reviews carry a `commit_id`.

GitHub creates a lightweight workflow record for each submitted review because event triggers cannot filter by reviewer and state in the `on` block. Non-matching jobs are skipped before a runner is allocated.

The job display name must be dynamic from the same predicate:

- `quality` when the predicate is true; and
- `review-router` when the predicate is false.

This naming is important because GitHub treats skipped required jobs as successful. A fixed job name of `quality` would let a skipped human-review event satisfy the future required check. With a dynamic name, non-qualifying reviews create only a skipped `review-router`; the required `quality` check remains absent until genuine CodeRabbit approval.

The qualifying `quality` job must:

- query the live pull request and stop if its current head no longer equals the dispatched reviewed SHA;
- check out the exact input SHA with persisted credentials disabled;
- use read-only repository and pull-request permissions;
- cancel older runs for the same pull request; and
- only then install dependencies and run the expensive checks.

The manual preview path must remain a separate `workflow_dispatch` workflow. It must not provide a manual escape hatch into `quality`.

### 4. Enforce the sequence at merge time

Protect `main` with, at minimum:

- pull requests required;
- the uniquely named `quality` check required;
- stale approvals dismissed when the head changes;
- conversation resolution required if unresolved review threads must block merge; and
- no routine administrator bypass if the policy is meant to be universal.

When `quality` has not run because CodeRabbit has not approved, the required check remains absent and merge is blocked. GitHub advises keeping job names unique across workflows because duplicate required-check names can create ambiguous results and block merging. See [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#about-branch-protection-rules).

CodeRabbit describes its Request Changes Workflow as suitable for use as a required reviewer. This should still be verified on one test pull request before relying on it, because the repository currently has no protected-branch evidence showing how the CodeRabbit GitHub App's approval is counted in this repository.

### 5. Bootstrap in a safe order

Do not enable a required `quality` check before the approval-triggered workflow has proved that it can report that check. GitHub only allows a status check to be selected as required after it has completed successfully in the repository during the previous seven days; see [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

The lowest-risk rollout is:

1. Land the CodeRabbit configuration, approval-triggered CI workflow, and separate preview workflow without making `quality` required.
2. Use a same-repository test pull request to prove the exact CodeRabbit `APPROVED` event, bot identity, latest-head comparison, dynamic job name, and one successful `quality` check on the reviewed commit.
3. Enable branch protection requiring `quality`, stale-approval dismissal, and the chosen review/conversation rules.
4. Open one more test pull request with an intentional CodeRabbit finding and prove that no CI runner starts until the finding is resolved and CodeRabbit approves the same head SHA.

If the workflow and CodeRabbit configuration are introduced through the currently open feature pull request, treat that as bootstrap only. The existing parallel `pull_request` CI trigger must remain available until the new event path is installed and demonstrated, or the repository risks a gate that cannot create its own first required check.

## Other event designs considered

| Design | Viable? | Assessment |
|---|---|---|
| `status` event on context `CodeRabbit` | Technically yes, semantically insufficient alone | GitHub Actions can run when a commit status changes and exposes `github.event.context`, `state`, and `sha`. However, RentCottage's observed `success` only means `Review completed`, including reviews with findings. A safe version would also query current-head reviews and unresolved CodeRabbit threads, which recreates CodeRabbit's approval logic and needs a gate runner. Also note that `GITHUB_SHA` is the default-branch commit for this event, so code must use `github.event.sha` to locate the reviewed commit. See GitHub's [`status` event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#status) and [status webhook payload](https://docs.github.com/en/webhooks/webhook-events-and-payloads#status). |
| `check_run` completed | No for the present integration | RentCottage receives CodeRabbit as a commit status named `CodeRabbit`; there is no CodeRabbit check run to match. GitHub supports `check_run` types including `completed`, but this trigger would currently see the Actions checks, not CodeRabbit. GitHub also suppresses recursive check-run workflows for suites created by GitHub Actions. See [`check_run`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#check_run). |
| Fixed-name `quality` job on CodeRabbit `pull_request_review` | No | Every later submitted review can create a new failing or skipped check with the required `quality` name. GitHub treats skipped required jobs as successful. |
| Dynamic-name conditional job | Yes, recommended | Exact CodeRabbit approval names and runs the job as `quality`. Non-matching reviews name the skipped job `review-router`, allocate no runner, and cannot satisfy or overwrite the required `quality` check. This also works in the pull request that introduces the workflow. |
| `workflow_run` | Not directly | `workflow_run` follows another GitHub Actions workflow. CodeRabbit is an external GitHub App, not an Actions workflow, so there is no CodeRabbit workflow name to follow. A separate gate workflow could be inserted, but this adds an unnecessary run and complexity. GitHub warns that a downstream `workflow_run` can access secrets and write tokens even if the upstream workflow could not, and warns against running untrusted code in that context. See [`workflow_run`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run). |
| Parse CodeRabbit comments | Possible but unsafe | CodeRabbit edits its walkthrough issue comment, so `issue_comment: edited` can fire. The prose and hidden HTML markers are not a documented machine contract. More importantly, “No actionable comments were generated in the recent review” can coexist with older unresolved findings in the overall review. Use the structured approval instead. GitHub documents that `issue_comment` covers both issues and pull requests and runs in the default-branch context. See [`issue_comment`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issue_comment). |
| Completion label | Possible only with a separate actor | CodeRabbit documents labels as automatic-review filters, not as a clean-review completion signal. A human, GitHub App, or gate workflow could add a dedicated label, but that adds state that can become stale. If a workflow uses its normal `GITHUB_TOKEN` to add the label, GitHub normally suppresses the resulting workflow trigger; a GitHub App token or personal access token would be required for most chained events. See [Triggering a workflow from a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow). |
| `workflow_dispatch` or `repository_dispatch` | Technically possible, not preferred | Chained dispatch adds permissions and a bootstrap problem because a manually dispatched workflow must already exist on the default branch. A manually callable `quality` workflow would also be a policy bypass unless it independently revalidated CodeRabbit. See [`workflow_dispatch`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch) and [`repository_dispatch`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#repository_dispatch). |

## Fork and security limitations

- GitHub sends `pull_request_review` events for fork pull requests to the base repository. For fork-originated workflows, secrets other than `GITHUB_TOKEN` are withheld and the token is read-only. First-time public contributors may need a maintainer to approve the workflow run. Dependabot pull requests receive the same restrictions. See GitHub's [forked pull-request review workflow rules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflows-in-forked-repositories).
- The proposed `quality` job does not need repository secrets and should retain `contents: read`. Do not move it to `pull_request_target` and then execute or check out untrusted pull-request code. GitHub explicitly warns that this can expose write privileges or secrets; see [`pull_request_target`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target).
- Use concurrency keyed by pull request and cancel older runs. This avoids spending CI minutes on an approved commit after a newer commit makes that approval stale.
- Check the exact reviewed head before starting. Approval state alone is not enough because updates can race with event delivery.

## Hosted validation outcome

PR [#53](https://github.com/zaingulel/RentCottage/pull/53) validated both directions of the gate on 13 August 2026:

1. CodeRabbit submitted `CHANGES_REQUESTED` on heads `28e67a85` and `c64ea6e`; the workflow created only skipped, non-`quality` records and allocated no full CI runner.
2. After every current and historical CodeRabbit thread was resolved, CodeRabbit submitted `APPROVED` on exact head `c8ef4b8`.
3. That approval created and ran the job named exactly `quality`. The run completed successfully before merge.
4. PR #53 then merged as `8f2ae28`.

The current docstring check is disabled because blanket docstring coverage is not an established TypeScript/Next.js requirement in this repository. Automatic review pausing is disabled so long repair cycles continue to receive incremental review.

One enforcement task remains separate: `main` had no branch protection or ruleset at validation time. The sequencing is implemented and proven, but repository settings must require the `quality` check if merges are to be technically blocked before that result exists. Fork policy also remains to be chosen; the current exact predicate deliberately does not run this quality path for fork heads.
