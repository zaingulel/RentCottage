---
name: security-code-review
description: Classify security evidence for a substantive finished RentCottage change, then route to the current managed Standards and Spec review with a configured Security reviewer when required.
---

# Security code review

## Fix the review bundle

Before classification, capture one fixed, worktree-inclusive bundle:

- the resolved baseline SHA and commit list from that baseline to `HEAD`;
- the tracked comparison from the baseline through the current index and worktree, including committed, staged, and unstaged changes;
- path and full content for every untracked in-scope file;
- the issue and acceptance criteria, repository standards, relevant tests, and affected architecture, domain, provider, and boundary decisions.

Confirm the baseline directly and require a non-empty change bundle. `HEAD` may equal the baseline during pre-commit review; staged, unstaged, and untracked inputs still make that bundle reviewable. Hash the tracked diff and the path-plus-content inputs for untracked files. Recompute both before reporting; if either hash or the in-scope path set changes, stop and restart from bundle capture.

Classify only this fixed bundle before spawning reviewers.

Record `YES`, `NO`, or `UNKNOWN` with concise, non-empty evidence for each group:

1. authentication, session or multi-factor authentication behaviour
2. authorization, roles, Row Level Security or cross-account isolation
3. personal, identity, payment or other sensitive data
4. secrets, credentials or privileged service clients
5. private storage, uploads, downloads or signed access
6. payment authorization, capture, refunds or settlement
7. audit history, retention, deletion or destructive migrations
8. cryptographic or trust-boundary behaviour

`NO` requires affirmative evidence that the change does not touch the group. Use `UNKNOWN` when evidence is missing, ambiguous, unavailable, or conflicting, and state exactly what evidence is needed.

## Route

- If any classification is `UNKNOWN`, stop before spawning any reviewer. Gather the missing evidence and classify again; if it remains unavailable, report the gap to the coordinator without guessing.
- For either review route, read the currently installed managed `code-review` skill at invocation time and use its current Standards and Spec contracts without copying them here. Its branch-only preflight must not redefine or omit the fixed worktree-inclusive bundle. Confirm the resolved baseline and non-empty bundle directly.
- If every classification is `NO`, invoke those managed Standards and Spec contracts unchanged against the fixed bundle.
- If any classification is `YES`, spawn the managed Standards and Spec reviewers together with the configured `security_reviewer` in one bounded parallel review. Give all three the fixed bundle. Give Security the acceptance criteria, relevant security and testing standards, affected architecture, domain, provider, and boundary decisions, and all eight classifications with evidence.

Do not silently fall back if `code-review` or `security_reviewer` is unavailable. Stop and report the missing capability.

## Result

Return separate Standards, Spec, and, when routed, Security verdicts. Security ends with a separate terminal `CLEAN` or `FINDINGS`; every finding includes severity, file and line, violated requirement or boundary, evidence, and impact. Do not merge or rerank verdicts. The coordinator adjudicates each finding against the repository authorities and approved scope.

For representative runtime validation, report child identities, observed latency, and per-child token usage only when each is independently observable. Mark unavailable evidence as unavailable; never infer it or substitute parent usage.

For each representative sensitive delivery, also record whether Security found a material issue that Standards did not. Using the issue authority's evaluation condition, recommend simplifying or removing the Security lane if it adds no unique material findings across the representative deliveries, or if an equivalent independently evidenced review replaces it.

This review supplements executable tests, CodeRabbit, and owner approval; it replaces none of them.
