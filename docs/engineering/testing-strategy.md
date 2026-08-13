# Testing strategy

This is RentCottage's evidence-selection authority. The selected issue defines the required outcome, `CONTEXT.md` defines domain invariants, accepted architecture decision records define technical boundaries, and this document defines how to prove them. A more specific product, domain, architecture, or issue decision wins on a direct conflict.

## Choose evidence from the claim

1. State the observable behaviour or invariant.
2. Choose the cheapest observer that can genuinely prove it.
3. Add a real-boundary test only when that boundary creates distinct risk.
4. Derive expected values from the requirement, a domain decision, a hand-worked example, a provider contract, or a known-good fixture. Do not copy the implementation's calculation.
5. Assert public contracts and persisted business outcomes, not private calls or page internals.

Test count and coverage percentage are not correctness targets. Functional green does not replace TypeScript, lint, database security, accessibility, build, runtime, or visual evidence. A missing, skipped, unavailable, or unclassified required observation is not a pass.

## Evidence layers

- Run formatting, linting, and TypeScript checks for every code change.
- Use Vitest for pure prices, fees, deadlines, filters, state transitions, configuration boundaries, and application-service outcomes.
- Test complete marketplace actions at the application or service seam shared by the Customer Web App, Owner Backoffice, and administrator surfaces.
- Use real local PostgreSQL and Supabase tests for schema, constraints, Row Level Security, atomic Pending Holds, overlap rejection, and concurrent requests. Mocks cannot prove those claims. Add this command with the first slice that introduces a database schema or policy; #19 introduced configuration only, so no database suite exists yet.
- Use supplier contract tests for payment signatures, retries, duplicate and out-of-order events, authorization release, capture, refunds, settlement, and translation failures.
- Use the Cloudflare Workers runtime for server code, bindings, and the production Worker build. A Node.js test does not prove Workers compatibility.
- Use isolated Playwright journeys for critical visible flows. Locate controls by accessible, user-facing names.
- Directly inspect changed mobile, desktop, right-to-left, and accessibility states. Automated functional checks do not prove visual quality.
- Smoke the exact hosted preview before release. A local Worker preview does not prove Cloudflare deployment or Supabase reachability.

## Regression sensitivity

Every non-trivial behaviour change needs a regression test that fails when the relevant behaviour is deliberately broken or reverted, then passes again after restoration. Prove this at the public seam selected for the behaviour. Unchanged documentation and mechanical preservation work do not invent test ceremony.

## Stable commands

- `npm run verify` is the local and continuous-integration gate. It audits production dependencies, checks formatting, lint and strict TypeScript, runs Vitest, builds and smoke-tests the Worker, scans browser assets for secrets, verifies generated Cloudflare types, and runs the current browser journeys. Docker is required because the access checks start an isolated local Supabase database and prove its policies directly.
- `npm run verify:preview -- <https-preview-url>` checks the hosted Arabic shell and live Supabase health boundary, then records the exact Git commit and preview origin. It rejects missing or malformed arguments before network access. Loopback Hypertext Transfer Protocol is allowed only for local diagnosis.
- `npm run verify:board` independently verifies the live tracker and is required by `docs/agents/issue-tracker.md`; it is not part of the code-quality gate because it depends on current GitHub planning state.

Agents report exact commands, exit codes, failures, skipped or inapplicable checks, and current screenshots for visible work. Command output is authoritative; prose is interpretation.
