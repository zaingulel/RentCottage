---
name: security-code-review
description: Classify a finished RentCottage change, then route one bounded Standards and Specification review round with Security only when required.
---

# Security code review

## Classify the change

Classify the complete committed job change after construction verification and the coordinator's status
completeness check:

- the resolved baseline SHA and commit list from that baseline to `HEAD`;
- the tracked comparison from that baseline through the recorded review `HEAD`;
- the issue and acceptance criteria, repository standards, relevant tests, and affected architecture, domain, provider, and boundary decisions.

Confirm the baseline and review `HEAD` directly and require a non-empty committed change. Intended staged,
unstaged, or untracked source stops classification until it is either committed into the job or excluded by the
coordinator as generated or unrelated state. Missing, ambiguous, unavailable or conflicting evidence is
`UNKNOWN`, never an inferred result.

Record `YES`, `NO`, or `UNKNOWN` with concise, non-empty evidence for each group:

1. authentication, session or multi-factor authentication behaviour
2. authorization, roles, Row Level Security or cross-account isolation
3. personal, identity, payment or other sensitive data
4. secrets, credentials or privileged service clients
5. private storage, uploads, downloads or signed access
6. destructive migrations
7. payment operations, security-relevant audit, retention or deletion controls, cryptographic or other trust-boundary behaviour

`NO` requires affirmative evidence that the change does not touch the group. Use `UNKNOWN` when evidence is missing, ambiguous, unavailable, or conflicting, and state exactly what evidence is needed.

After classification, report the aggregate `UNKNOWN`, `ANY_YES`, or `ALL_NO` to the coordinator: `UNKNOWN` when any classification is unknown, `ANY_YES` when none is unknown and at least one is yes, and `ALL_NO` when every classification is no.

## Route

- If any classification is `UNKNOWN`, stop before spawning any reviewer. Gather the missing evidence and classify again; if it remains unavailable, report the gap to the coordinator without guessing.
- Read the currently installed managed `code-review` skill at invocation time and use its independent Standards and Specification contracts against the recorded committed job diff.
- If every classification is `NO`, Standards and Specification are the complete review round.
- If any classification is `YES`, add the configured `security-reviewer` to the same bounded review round. Give Security the acceptance criteria, relevant security and testing standards, affected architecture, domain, provider, and boundary decisions, and all classifications with evidence.

Do not silently fall back if `code-review` or a required `security-reviewer` is unavailable. Stop and report the missing capability.

## Result

Require each routed reviewer prompt to end with its own terminal `CLEAN` or `FINDINGS` verdict. Every Security finding includes severity, file and line, violated requirement or boundary, evidence, and impact. If a required reviewer times out, crashes, or returns no valid terminal verdict, report that lane as `INCOMPLETE` or `UNAVAILABLE` and block delivery approval. Never treat an absent verdict as `CLEAN`. Do not merge or rerank verdicts. The coordinator adjudicates each finding against the repository authorities and approved scope.

This is the one bounded internal review round for the finished change. It supplements executable tests and owner approval; it replaces neither. Confirm the recorded review `HEAD` and tracked source are unchanged before accepting verdicts, then keep that commit as the repair fixed point. A bounded factual repair is verified and committed, followed only by the implicated reviewer lane in repair mode against that fixed point; do not invoke another complete `code-review` round. A repair that adds no factual claim needs no review. After two non-converging repair-and-scoped-review cycles, return to the owner.

This skill does not operate Greptile, change hosted configuration, add review lanes, or broaden scope. Delivery follows `docs/agents/delivery.md`.
