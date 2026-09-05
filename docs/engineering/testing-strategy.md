# Testing strategy

This is RentCottage's evidence-selection authority. The selected issue defines the required outcome, `CONTEXT.md` defines domain invariants, accepted architecture decision records define technical boundaries, and this document defines how to prove them. A more specific product, domain, architecture, or issue decision wins on a direct conflict.

## Choose evidence from the claim

1. State the observable behaviour or invariant.
2. Choose the cheapest observer that can genuinely prove it.
3. Add a real-boundary test only when that boundary creates distinct risk.
4. Derive expected values from the requirement, a domain decision, a hand-worked example, a provider contract, or a known-good fixture. Do not copy the implementation's calculation.
5. Assert public contracts and persisted business outcomes, not private calls or page internals.

Test count and coverage percentage are not correctness targets. Functional green does not replace TypeScript, lint, database security, accessibility, build, runtime, or visual evidence when the change touches those evidence classes. Each change applies only the classes needed for its claims. A missing, skipped, unavailable, or unclassified required observation is not a pass.

## Evidence layers

- Run formatting, linting, and TypeScript checks for every code change.
- Use Vitest for pure prices, fees, deadlines, filters, state transitions, configuration boundaries, and application-service outcomes.
- Test complete marketplace actions at the application or service seam shared by the Customer Web App, Owner Backoffice, and administrator surfaces.
- Use real local PostgreSQL and Supabase tests for schema, constraints, Row Level Security, atomic Pending Holds, overlap rejection, and concurrent requests. Mocks cannot prove those claims. `npm run verify:access:database` runs the current database, policy, migration, fixture and concurrency evidence in a disposable local Supabase project. `npm run verify:access:browser` independently prepares a fresh project for the Next.js and Worker access journeys. `npm run verify:access` runs both groups within one shared disposable lifecycle.
- Use supplier contract tests for payment signatures, retries, duplicate and out-of-order events, authorization release, capture, refunds, settlement, and translation failures.
- Use the Cloudflare Workers runtime for server code, bindings, and the production Worker build. A Node.js test does not prove Workers compatibility.
- Use isolated Playwright journeys for critical visible flows. Locate controls by accessible, user-facing names.
- Directly inspect changed mobile, desktop, right-to-left, and accessibility states. Automated functional checks do not prove visual quality.
- Smoke the exact hosted preview before release. A local Worker preview does not prove Cloudflare deployment or Supabase reachability.

## Regression sensitivity

Every distinct material behaviour change needs one regression proof that fails when that behaviour is deliberately broken or reverted, then passes again after restoration. Prove it at the public seam selected for the behaviour; do not repeat mutation ceremony for every assertion, edge case or repair. Unchanged documentation and mechanical preservation work use existing evidence and create no new test or mutation ceremony.

## Construction and convergence

Run focused evidence during construction and the applicable broad suite once at convergence. Another broad run needs a named reason, such as changed evidence, an invalidated environment or an investigated flake. Stop retries when they produce no new information; unavailable required evidence remains unavailable, not a pass.

## Stable commands

- `npm run verify` is the local and continuous-integration gate. It always audits production dependencies, checks formatting, lint and strict TypeScript, runs Vitest, regenerates Cloudflare types and checks their drift. It adds the existing access evidence, Worker build, browser-asset secret scan, browser journeys and preview smoke when any changed path is outside the command's explicit list of existing prose and agent-instruction files. The local selector unions the complete branch change from `origin/main`, staged and unstaged changes, and untracked files. CI classifies both the pull-request source and GitHub's checked-out merge result. Unknown paths, shallow or missing history, malformed Git evidence, symlinks and file-type changes select the full route. Use `npm run verify -- --full` for exhaustive convergence evidence. The full route requires Docker because the access checks start an isolated local Supabase database and prove its policies directly.
- `npm run verify -- --baseline`, `--database`, and `--browser` run independent groups through the same command. Baseline runs the audit, format, lint, type, Vitest and Cloudflare type checks. Database and browser retain the same change selector and support `--full`; approved prose changes report expensive evidence as unselected and exit successfully without starting services. GitHub runs these modes on separate runners, each checking out the same merge revision with complete history. The final ready-only `test` check requires all three jobs to succeed; failed, cancelled, skipped or missing evidence cannot satisfy it. Drafts expose only the explanatory `ci-control-no-test` aggregate.
- Browser verification builds the Worker once with real local Supabase credentials for access and scheduled expiry, then builds it separately with placeholder credentials for the client-secret scan and smoke. Internal Worker journeys select `playwright.worker-prebuilt.config.ts` only after the corresponding build succeeds. Next.js access and shell journeys keep their own normal Next.js builds; OpenNext standalone output is not reused by `next start`. Default browser commands still compile, and all preview configurations refuse existing servers so an occupied port cannot supply stale evidence. The prebuilt configuration accepts only Worker mode.
- `npm run verify:preview -- <https-preview-url>` checks the hosted Arabic shell and live Supabase health boundary, then records the exact Git commit and preview origin. It rejects missing or malformed arguments before network access. Loopback Hypertext Transfer Protocol is allowed only for local diagnosis.
- `npm run verify:board` performs the read-only live Project 4 intake required by `docs/agents/issue-tracker.md`; it is not part of the code-quality gate because it depends on current GitHub planning state.

Agents report exact commands, exit codes, failures, skipped or inapplicable checks, and current screenshots for visible work. Command output is authoritative; prose is interpretation.
