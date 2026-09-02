<!-- Fill every slot. Hand one coherent claim to exactly one writer. -->

Slice: {{SLICE_TITLE}}
Claim: {{CLAIM}}
Construction mode: {{CONSTRUCTION_MODE}}
Working directory: {{WORKTREE_ROOT}}

Approved plan:
{{PLAN}}

Files allowed for this claim:
{{FILES}}

Evidence landing with this claim:
{{TEST}}

Observer: {{OBSERVER}}
Independent oracle: {{INDEPENDENT_ORACLE}}
Focused verification: {{FOCUSED_TEST_COMMAND}}
Stop condition: {{STOP_CONDITION}}

Standing contract:

- Work only in the named job worktree and files. You are its sole writer until you return.
- Follow the construction mode and focused verification exactly; zero matched tests is failure.
- Stop on scope ambiguity, a wrong plan, hidden cross-boundary work, or a size envelope breach.
- Keep the tree green, remove orphans created by the slice, and do not run the full suite, commit, push, or
  mutate GitHub.
- Report changed paths, focused results, exact on-disk state, and whether the writer has stopped.
