# Proportionate verification research

## Decision

Keep RentCottage's existing `npm run verify` entry point, baseline, three GitHub jobs, ready-only aggregate, exact
merge checkout and complete Git history. Make narrow selection follow documented file categories and the complete
Git contribution, and expose the resulting commands through `--plan`. Unknown, mixed, executable, configuration and
runtime changes continue to select full evidence.

This is an extension of the existing command, with no workflow, dependency, path-filter gate or separate planner.
Its maintenance cost is one output branch and focused parity tests in the selector. Remove `--plan` if it stops
preventing surprise verification work, or if the platform supplies an authoritative plan for the same current diff.

## Primary-source findings

- GitHub warns that a workflow skipped by path filtering can leave its required check pending. GitHub also limits
  path-filter evaluation and can force workflows to run when commit or diff limits are exceeded. That makes hosted
  workflow filtering a poor authority for RentCottage's required aggregate; keep all three jobs and select inside
  the repository command. ([Required-check troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks),
  [workflow diff comparisons](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#git-diff-comparisons))
- Strict required checks also require the source branch to be current with its base. PR #243 completed its checks
  but remained `BEHIND`, so delivery now reconciles the branch before starting hosted checks. This prevents a
  foreseeable rerun without changing the repository's protection settings.
  ([GitHub ruleset requirements](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets))
- A `pull_request` workflow can receive a synthetic merge commit. GitHub's security guidance supports keeping the
  read-only `pull_request` boundary rather than checking untrusted code out through `pull_request_target`. The
  selector should therefore validate the expected base/source parents and inspect both the source contribution and
  checked-out merge result. ([Pull request events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request),
  [secure use reference](https://docs.github.com/en/actions/reference/security/secure-use#mitigating-the-risks-of-untrusted-code-checkout))
- Git's two-endpoint diff and three-dot source-contribution forms answer different questions, while `git merge-base
  --all` may return more than one best common ancestor. A unique merge base is required before narrowing; ambiguity
  keeps the full fallback. ([git diff](https://git-scm.com/docs/git-diff),
  [git merge-base](https://git-scm.com/docs/git-merge-base))
- Vitest's related-test selection follows the static import graph and its force-rerun triggers remain configured
  file rules. Playwright describes changed-test selection as a heuristic that can miss affected tests. RentCottage's
  SQL, subprocess and runtime dependencies cross those observable graphs, so related-test selection cannot replace
  the database, Worker and browser groups. ([Vitest related](https://vitest.dev/guide/cli.html#vitest-related),
  [Vitest force rerun triggers](https://vitest.dev/config/forcereruntriggers),
  [Playwright CI guidance](https://playwright.dev/docs/ci#fail-fast))
- Nx affected selection combines Git history with a declared project graph. RentCottage has no complete graph for
  its SQL, subprocess and runtime consumers, so adding Nx would create a second incomplete authority rather than
  justify narrower evidence. ([Nx affected](https://nx.dev/docs/features/ci-features/affected))

## Repository evidence and repaired defects

The selector previously listed individual agent and documentation paths. That list omitted the established
`.codex/agents/builder-max.toml` definition and forced full database and browser evidence for a two-value model
change. Anchored categories now cover current and future regular non-executable definitions while scripts,
TypeScript, JSON, symlinks and executable modes remain full. Documentation Markdown, retained DOCX files and
illustrations are also narrow because the current TypeScript, Worker, database and browser inputs do not consume
them. Conversely, `tsconfig.json` includes TypeScript throughout the repository, so a TypeScript file under an agent
or documentation directory is executable input and remains full. Any new consumer invalidates these premises and
requires re-evaluation.

A second defect compared `base..source` in Continuous Integration (CI). When the target base advanced after the
source branch forked, that endpoint comparison included base-only runtime additions, modifications or deletions and
could falsely select full evidence for a prose-only source contribution. The repaired CI classification unions
`merge-base..source` with `base..merge`: the first preserves every source contribution even when conflict resolution
discards it, and the second preserves every merge-result-only change. Local selection applies the same unique-base
rule and still unions branch, staged, unstaged and untracked changes.

Focused tests construct real temporary Git histories for advanced-base changes, discarded source runtime changes,
merge-only runtime changes and criss-cross multiple merge bases. They inventory the repository's current regular
agent definitions, add future names, inspect untracked mode bits, and compare `--plan` output with injected execution
vectors. The plan path invokes no runner, including the CI Chromium installer, and explicitly states that no
verification ran.

## Tradeoffs and operating boundary

Category rules remove filename drift while retaining a conservative boundary. They can become stale if a prose or
agent file begins feeding code generation, configuration, packaging or runtime behavior; that consumer change must
update the selector and its independent tests. Content heuristics were rejected because file contents cannot prove
the absence of an external consumer. Dependency-graph and workflow-filter alternatives were rejected because they
cannot currently describe the complete repository boundary.

Use unscoped `npm run verify -- --plan` before expensive local convergence and before marking a pull request ready.
It is a read-only preflight for the complete diff, not test evidence. Group-scoped plans describe only their named
group. Reconcile unexpected broad or narrow output against the affected consumers before execution, with `--full`
retained as the safe unresolved fallback.
