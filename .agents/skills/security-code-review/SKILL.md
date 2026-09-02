---
name: security-code-review
description: Classify security evidence for a substantive finished RentCottage change, then route to the current managed Standards and Spec review with a configured Security reviewer when required.
---

# Security code review

## Classify the change

Read the complete current change before classification:

- the resolved baseline SHA and commit list from that baseline to `HEAD`;
- the tracked comparison from the baseline through the current index and worktree, including committed, staged, and unstaged changes;
- path and full content for every untracked in-scope file;
- the issue and acceptance criteria, repository standards, relevant tests, and affected architecture, domain, provider, and boundary decisions.

Confirm the baseline directly and require a non-empty change. `HEAD` may equal the baseline during pre-commit review; staged, unstaged, and untracked inputs still make the change reviewable. Missing, ambiguous, unavailable or conflicting evidence is `UNKNOWN`, never an inferred result.

Record `YES`, `NO`, or `UNKNOWN` with concise, non-empty evidence for each group:

1. authentication, session or multi-factor authentication behaviour
2. authorization, roles, Row Level Security or cross-account isolation
3. personal, identity, payment or other sensitive data
4. secrets, credentials or privileged service clients
5. private storage, uploads, downloads or signed access
6. destructive migrations
7. cryptographic or other trust-boundary behaviour

`NO` requires affirmative evidence that the change does not touch the group. Use `UNKNOWN` when evidence is missing, ambiguous, unavailable, or conflicting, and state exactly what evidence is needed.

After classification, report the aggregate `UNKNOWN`, `ANY_YES`, or `ALL_NO` to the coordinator: `UNKNOWN` when any classification is unknown, `ANY_YES` when none is unknown and at least one is yes, and `ALL_NO` when every classification is no.

## Route

- If any classification is `UNKNOWN`, stop before spawning any reviewer. Gather the missing evidence and classify again; if it remains unavailable, report the gap to the coordinator without guessing.
- Read the currently installed managed `code-review` skill at invocation time and use its independent Standards and Specification contracts against the complete current change. Its branch-only preflight must not omit staged, unstaged or untracked content.
- If every classification is `NO`, Standards and Specification are the complete review round.
- If any classification is `YES`, add the configured `security_reviewer` to the same bounded review round. Give Security the acceptance criteria, relevant security and testing standards, affected architecture, domain, provider, and boundary decisions, and all classifications with evidence.

Do not silently fall back if `code-review` or a required `security_reviewer` is unavailable. Stop and report the missing capability.

## Result

Require each routed reviewer prompt to end with its own terminal `CLEAN` or `FINDINGS` verdict. Every Security finding includes severity, file and line, violated requirement or boundary, evidence, and impact. If a required reviewer times out, crashes, or returns no valid terminal verdict, report that lane as `INCOMPLETE` or `UNAVAILABLE` and block delivery approval. Never treat an absent verdict as `CLEAN`. Do not merge or rerank verdicts. The coordinator adjudicates each finding against the repository authorities and approved scope.

This review supplements executable tests, Greptile's current-head findings, and owner approval; it replaces none of them. A completed Greptile review proves only that processing finished, and an unavailable Greptile review never relaxes a required internal review or verification gate.

This skill does not operate Greptile, change provider configuration, or broaden the managed review. Delivery follows `docs/agents/delivery.md`.
