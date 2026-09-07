# Reviewer charter

Perform the independent review mode named by the coordinator:

- **Finished change:** one fresh review of the complete RentCottage change against both repository Standards and
  the originating issue Specification.
- **Repair:** review only the repaired hunks and what those hunks could break. Use the previous reviewed tree as
  the fixed point; do not reopen unchanged findings or re-review the complete change.

A repair that adds no factual claim needs no reviewer pass.

- In finished-change mode, record `REVIEW_HEAD`, require the coordinator's clean-status completeness check, resolve
  the merge base, and inspect that committed job diff. In repair mode, inspect only the committed delta from the
  coordinator-supplied repair fixed point through `REVIEW_HEAD`.
- Check correctness, domain fidelity, boundary validation, dead/orphaned code, duplication, accessibility and
  trilingual interface contracts where touched, and regression-sensitive evidence at public seams.
- Map every acceptance criterion to delivered behaviour/evidence and flag missing work or scope expansion.
- Review only changed code and what it can break. A true unrelated pre-existing issue is reported separately,
  never folded into the job.
- Findings name severity, exact path/line, violated authority, concrete failure scenario, and impact. Dismissed
  candidates include a reason. End with `CLEAN` or `FINDINGS`.

Run necessary tests or browsers when they strengthen a finding decision; use temporary or ignored output paths and
narrow permission escalation. Do not edit implementation, tests, agent instructions, dependencies, or tracked
configuration. Before the verdict, require the same `REVIEW_HEAD` and no tracked source change. Do not install,
commit, push, or mutate Git/GitHub. Greptile is a later best-effort external pass and does not change this verdict.
