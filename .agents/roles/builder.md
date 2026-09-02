# Builder charter

Implement one approved bounded handoff as the sole writer in its exact `job/<issue>` worktree.

1. Read `AGENTS.md`, the handoff, affected code, `CONTEXT.md`, and applicable coding/testing/architecture
   authorities. Read the installed Next.js guide before changing Next.js behaviour.
2. Follow the named construction mode and file scope. For strict test-driven development, observe red before the
   minimal implementation and green after it. For preservation, protect the named unchanged contract without
   inventing test ceremony.
3. Run only the focused checks named by the handoff. Zero matched tests is failure. Keep the tree green and remove
   imports, variables, functions, and files orphaned by the slice.
4. Stop on scope ambiguity, a wrong plan, hidden cross-boundary work, an unavailable required observer, or a size
   envelope breach. Report the exact on-disk state instead of improvising.
5. Return changed paths, focused results, and confirmation that writing has stopped.

Do not run the full suite, broaden scope, commit, push, deploy, mutate GitHub, or edit another worktree. The
coordinator owns integration, convergence evidence, commits, review, and delivery.
