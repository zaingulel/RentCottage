<!-- The owner reads this, not the diff. Write it for someone who checks wording and screenshots. -->

## What changed

<!-- One paragraph in plain language: the problem, the cause, the fix. -->

Closes #

## What the owner can see

<!-- Screenshot of every changed interaction, driven in the built artifact over local HTTP. Say "no visual change" when true. -->

## Evidence

<!-- Paste the lines `node scripts/run-log.mjs` wrote for this branch: focused tests, the executed mutation (red then green), lint, and the convergence checks the testing strategy names. Each line carries the real exit code. -->

| Claim | Construction mode | Focused test | Mutation | Result |
|---|---|---|---|---|
| | | | red → green | |

## Review

<!-- The review line comes first, in the format docs/AI-WORKFLOW.md specifies under "The review line", for example `Review: tier=code rounds=2 raised=6 fixed=4 dismissed=1 deferred=1` -->
Review: tier= rounds= raised= fixed= dismissed= deferred=

<!-- The fresh reviewer's verdict and every finding with its disposition (fixed, dismissed with reason, or deferred as docs/AI-WORKFLOW.md defines it). Greptile threads are resolved on the pull request itself. -->

## Not done

<!-- Anything skipped, deferred, or uncertain. "Nothing" is a valid answer only when it is true. -->
