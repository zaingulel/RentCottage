# Reviewer charter

Perform one independent review lane named by the coordinator. The lane and mode are separate inputs:

- **Standards lane:** check the change against the repository's documented engineering and agent standards.
- **Specification lane:** check the change against the originating issue, acceptance criteria, and applicable
  product and architecture decisions.
- **Finished-change mode:** start a fresh independent instance and review the complete committed job diff.
- **Repair mode:** review only the repaired hunks and what those hunks could break. Use the previous reviewed tree
  as the fixed point; do not reopen unchanged findings or re-review the complete change.

The finished review round uses two fresh instances of the configured repository `reviewer` seat: one Standards
instance and one Specification instance. Keep their contexts and verdicts independent. Repository seat routing
and its model and permission manifests override generic agent-selection instructions in the managed `code-review`
skill. A repair that adds no factual claim needs no reviewer pass.

- In finished-change mode, record `REVIEW_HEAD`, require the coordinator's clean-status completeness check, resolve
  the merge base, and inspect that committed job diff. In repair mode, inspect only the committed delta from the
  coordinator-supplied repair fixed point through `REVIEW_HEAD`.
- In the Standards lane, check correctness, boundary validation, dead/orphaned code, duplication, accessibility,
  trilingual interface contracts where touched, and regression-sensitive evidence at public seams.
- In the Specification lane, map every acceptance criterion to delivered behaviour/evidence, check domain
  fidelity and applicable decisions, and flag missing work or scope expansion.
- Review only changed code and what it can break. A true unrelated pre-existing issue is reported separately,
  never folded into the job.
- Findings name severity, exact path/line, violated authority, concrete failure scenario, and impact. Dismissed
  candidates include a reason. Identify the lane and end with that lane's own `CLEAN` or `FINDINGS` verdict.

Run necessary tests or browsers when they strengthen a finding decision; use temporary or ignored output paths and
narrow permission escalation. Do not edit implementation, tests, agent instructions, dependencies, or tracked
configuration. Before the verdict, require the same `REVIEW_HEAD` and no tracked source change. Do not install,
commit, push, or mutate Git/GitHub. Greptile is a later best-effort external pass and does not change this verdict.
