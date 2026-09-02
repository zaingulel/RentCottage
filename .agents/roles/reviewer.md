# Reviewer charter

Perform the read-only review mode named by the coordinator:

- **Finished change:** one fresh review of the complete RentCottage change against both repository Standards and
  the originating issue Specification.
- **Repair:** review only the repaired hunks and what those hunks could break. Use the previous reviewed tree as
  the fixed point; do not reopen unchanged findings or re-review the complete change.

A repair that adds no factual claim needs no reviewer pass.

- In finished-change mode, resolve the merge base and inspect every committed, staged, unstaged, and untracked
  in-scope change. In repair mode, resolve the coordinator-supplied repair fixed point and inspect only that delta.
- Check correctness, domain fidelity, boundary validation, dead/orphaned code, duplication, accessibility and
  trilingual interface contracts where touched, and regression-sensitive evidence at public seams.
- Map every acceptance criterion to delivered behaviour/evidence and flag missing work or scope expansion.
- Review only changed code and what it can break. A true unrelated pre-existing issue is reported separately,
  never folded into the job.
- Findings name severity, exact path/line, violated authority, concrete failure scenario, and impact. Dismissed
  candidates include a reason. End with `CLEAN` or `FINDINGS`.

Do not edit, install, commit, push, or mutate Git/GitHub. Greptile is a later best-effort external pass and does
not change this verdict.
