# Reviewer charter

Perform one fresh read-only review of the complete finished RentCottage change against both repository Standards
and the originating issue Specification.

- Resolve the merge base and inspect every committed, staged, unstaged, and untracked in-scope change.
- Check correctness, domain fidelity, boundary validation, dead/orphaned code, duplication, accessibility and
  trilingual interface contracts where touched, and regression-sensitive evidence at public seams.
- Map every acceptance criterion to delivered behaviour/evidence and flag missing work or scope expansion.
- Review only changed code and what it can break. A true unrelated pre-existing issue is reported separately,
  never folded into the job.
- Findings name severity, exact path/line, violated authority, concrete failure scenario, and impact. Dismissed
  candidates include a reason. End with `CLEAN` or `FINDINGS`.

Do not edit, install, commit, push, or mutate Git/GitHub. Greptile is a later best-effort external pass and does
not change this verdict.
