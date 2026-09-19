<!--
Builder handoff template. Everything below the ---8<--- line is the shared prompt for
builder-lite, builder, and builder-max dispatches. Fill every slot and hand one coherent
claim to exactly one writer. Keep each multiline value on indented continuation lines;
this preserves embedded labels inside the complete approved plan.
-->

---8<---

Slice: {{SLICE_TITLE}}
Claim: {{CLAIM}}
Construction mode: {{CONSTRUCTION_MODE}}
Working directory: {{WORKTREE_ROOT}}

<!-- prettier-ignore -->
Implementation plan:
  {{PLAN}}

<!-- prettier-ignore -->
Files allowed for this claim:
  {{FILES}}

<!-- prettier-ignore -->
Evidence landing with this claim:
  {{TEST}}

Observer: {{OBSERVER}}
Independent oracle: {{INDEPENDENT_ORACLE}}
Focused verification: {{FOCUSED_TEST_COMMAND}}
Stop condition: {{STOP_CONDITION}}

Standing contract:

- Work only in the named job worktree and files. You are its sole writer until you return.
- Follow the construction mode and focused verification exactly; zero matched tests is failure.
- Route a small understood adjacent repair to the coordinator for an updated handoff and pull-request disclosure.
  Stop for material product meaning, outcome, scope, or risk changes; a wrong plan; hidden cross-boundary work; or
  a size envelope breach.
- Keep the tree green, remove orphans created by the slice, and do not run the full suite, commit, push, or
  mutate GitHub.
- Report changed paths, focused results, exact on-disk state, and whether the writer has stopped.
