# Testing strategy

This is RentCottage's evidence-selection authority. The selected issue defines the required outcome, `CONTEXT.md` defines domain invariants, accepted architecture decision records define technical boundaries, and this document defines how to prove them. A more specific product, domain, architecture, or issue decision wins on a direct conflict.

## Choose evidence from the claim

1. State the observable behaviour or invariant.
2. Choose the cheapest observer that can genuinely prove it.
3. Add a real-boundary test only when that boundary creates distinct risk.
4. Derive expected values from the requirement, a domain decision, a hand-worked example, a provider contract, or a known-good fixture. Do not copy the implementation's calculation.
5. Assert public contracts and persisted business outcomes, not private calls or page internals.

Test count and coverage percentage are not correctness targets. Functional green does not replace TypeScript, lint, database security, accessibility, build, runtime, or visual evidence when the change touches those evidence classes. Each change applies only the classes needed for its claims. A missing, skipped, unavailable, or unclassified required observation is not a pass.

## Construction modes

- **`strict-tdd`:** start with a failing public-seam proof for a reproducible defect. Also use
  this floor for a changed security or domain invariant whose failure would be high consequence.
- **`evidence-required`:** other changed behaviour may be built in the clearest order, but lands with an executed
  regression proof that fails when the behaviour is broken and passes when restored.
- **`preservation`:** documentation, mechanical changes, and refactors with no changed behaviour protect the named
  unchanged contract using existing evidence, without new test or mutation ceremony.

The architect names the mode and observer. The builder runs focused construction evidence. The coordinator owns
the deliberate mutation proof and convergence route, so a builder does not repeatedly pay for broad suites.

## Evidence layers

- Run formatting, linting, and TypeScript checks for every code change.
- Use Vitest for pure prices, fees, deadlines, filters, state transitions, configuration boundaries, and application-service outcomes.
- Test complete marketplace actions at the application or service seam shared by the Customer Web App, Owner Backoffice, and administrator surfaces.
- Use real local PostgreSQL and Supabase tests for schema, constraints, Row Level Security, atomic Pending Holds, overlap rejection, and concurrent requests. Mocks cannot prove those claims. `npm run verify:access:database` runs the current database, policy, migration, fixture and concurrency evidence in a disposable local Supabase project. `npm run verify:access:browser` independently prepares a fresh project for the Next.js and Worker access journeys. `npm run verify:access` runs both groups within one shared disposable lifecycle.
- Change functions, views, tables, indexes and constraints by editing the declared schema under `supabase/schemas/` and generating the migration; see [Declared schema](#declared-schema).
- Use supplier contract tests for payment signatures, retries, duplicate and out-of-order events, authorization release, capture, refunds, settlement, and translation failures.
- Use the Cloudflare Workers runtime for server code, bindings, and the production Worker build. A Node.js test does not prove Workers compatibility.
- Use isolated Playwright journeys for critical visible flows. Locate controls by accessible, user-facing names.
- Directly inspect changed mobile, desktop, right-to-left, and accessibility states. Automated functional checks do not prove visual quality.
- Smoke the exact hosted preview before release. A local Worker preview does not prove Cloudflare deployment or Supabase reachability.

For an orchestration migration under [ADR 0002](../adr/0002-database-integrity-application-orchestration.md), prove
outcome selection and sequencing with Vitest at the TypeScript application-service seam. Keep real PostgreSQL observers for
authorization, constraints, locks, fencing, authoritative deadlines, durable identifiers, idempotency, history,
replay protection, and atomic business receipts. The story's changed boundary determines the combined observer;
application tests do not replace database concurrency or security evidence, and database tests do not replace the
application outcome proof.

## Regression sensitivity

Every distinct material behaviour change needs one regression proof that fails when that behaviour is deliberately broken or reverted, then passes again after restoration. Prove it at the public seam selected for the behaviour; do not repeat mutation ceremony for every assertion, edge case or repair. Unchanged documentation and mechanical preservation work use existing evidence and create no new test or mutation ceremony.

## Focused preparation

Before an expensive journey, validate each new database observer query and fixture at its relevant disposable
database seam: qualify ambiguous columns, assert the expected row cardinality, and preserve the public outcome.
Validate each browser selector against its intended rendered state using an accessible name or meaningful scope;
positional selection does not establish identity. Name the authoritative clock at every time boundary and align
fixtures, triggers, and assertions to it without weakening deadline behaviour or reproducing production logic.

Keep expensive fixtures alive across related assertions only when isolation is proven and failures still identify
the broken claim. Prove a process or provider boundary with the smallest representative journey; test ordinary
logic below it without repeatedly starting that boundary. When an interface changes, run its focused observer and
the adjacent tests for affected callers.

## Construction and convergence

Run focused evidence during construction and the applicable broad suite once at convergence. Distinguish a test
runner's configured automatic retries within one command from an agent starting another command. An automatic
retry may classify a test as flaky when it passes on retry, as described by Playwright's
[test-retry contract](https://playwright.dev/docs/test-retries), but it does not erase the original unexpected
failure: diagnose and report that failure and the final command result. An agent-initiated rerun needs a diagnosed
cause or new evidence; another broad run needs a named reason, such as changed evidence, an invalidated environment
or an investigated flake. Stop reruns when they produce no new information.

For a deliberate red/restored-green mutation proof, execute the named observer with runner retries disabled so
the red result cannot be masked: pass `--retries=0` to Playwright or `--retry=0` to Vitest. Require the target to
match and execute at least one test; zero matched tests is failure. Restore the implementation, run the same
retry-disabled observer green, and record both commands and exit statuses. Report an intentional red proof, an
unexpected failure, and unavailable evidence as distinct states; unavailable required evidence remains
unavailable, not a pass. Default runner retry configuration and every applicable product, database, concurrency,
migration, permissions, browser, and Worker gate remain unchanged for ordinary verification.

Run focused checks, intentional red/restored green proofs, and convergence through `npm run run-log -- <label>
-- <command> <args>`. Quote its recorded results in delivery evidence. Wrap each top-level check once; its nested
commands retain their normal output and failure handling.

## Declared schema

`supabase/schemas/` declares the complete public schema in dependency order: extensions, types, tables by domain,
functions by domain, constraints, indexes, triggers, policies, privileges and the realtime publication.
`supabase/config.toml` lists the files in `schema_paths`. `supabase/migrations/` stays the applied history and is never
edited after it ships.

To change a function, view, table, index or constraint: edit the object in its schema file, start the local
database, run `npx supabase db diff -f <change-name>`, read the generated migration in `supabase/migrations/` so it
contains only the intended objects, then commit the schema edit and the migration together. Generated function
definitions carry the whole body because PostgreSQL replaces functions whole; the reviewed diff is the schema-file
edit. Row Level Security policies, triggers, grants and data changes are hand-written migrations, because the diff
engine does not track every privilege and policy change; mirror each such migration into the matching schema file so
the declaration stays complete.

An orchestration migration follows the same declared-schema rule. Change only the affected flow, preserve its
Integrity Core in the schema declaration and generated migration, and prove that no required atomic transaction was
split across application calls.

The database evidence group runs `supabase db diff` before the SQL tests and fails on any drift between the declared
schema and the migration chain. Two declarations must keep their exact wording for that baseline to stay empty:
the migrations revoke the default `REFERENCES`, `TRIGGER`, `TRUNCATE` and `MAINTAIN` table privileges from the
API roles, so `50_privileges.sql` repeats those revokes explicitly, and `cottage_profile_source_text_lengths` is
written in the migration's `between` form because the diff engine compares constraint text. Direct changes made in
Studio, the SQL editor or `psql` are invisible to the diff; always edit the schema files.

`package-lock.json` resolves the Supabase CLI to 2.114.0, and that resolution must not move until
`20260908120000_booking_request_payment_history.sql` wraps its `lock table` in a transaction: newer releases apply
migrations statement by statement and refuse that lock. Install with `npm ci`, which honours the lockfile.

## Stable commands

- `npm run verify` is the local and continuous-integration gate. It always audits production dependencies, checks formatting, lint and strict TypeScript, runs Vitest, regenerates Cloudflare types and checks their drift. The selector independently names database and browser evidence. Reviewed workflow/prose changes use baseline only; global presentation CSS, ordinary bundled images, and the exact shell/display Playwright specifications add browser evidence without database evidence. Other paths require full evidence until their affected behaviour is investigated; unresolved scope, selector self-changes, shared configuration, shallow or missing history, malformed Git evidence, symlinks and file-type changes take the full fallback. The local selector unions the complete branch change from `origin/main`, staged and unstaged changes, and untracked files. CI classifies both the pull-request source and GitHub's checked-out merge result. `npm run verify -- --full` selects exhaustive convergence evidence. The full route requires Docker because access checks start an isolated local Supabase database and prove its policies directly.
- `npm run verify -- --baseline`, `--database`, and `--browser` run independent groups through the same selector. Baseline runs the audit, format, lint, type, Vitest and Cloudflare type checks. Database and browser support `--full`; unselected groups report their reason and exit successfully without starting services. GitHub runs these modes on separate runners, each checking out the same merge revision with complete history. The final ready-only `test` check requires all three jobs to succeed; failed, cancelled, skipped or missing evidence cannot satisfy it. Drafts expose only the explanatory `ci-control-no-test` aggregate.
- Browser verification builds the Worker once with real local Supabase credentials for access and scheduled expiry, then builds it separately with placeholder credentials for the client-secret scan and smoke. Internal Worker journeys select `playwright.worker-prebuilt.config.ts` only after the corresponding build succeeds. Next.js access and shell journeys keep their own normal Next.js builds; OpenNext standalone output is not reused by `next start`. Default browser commands still compile, and all preview configurations refuse existing servers so an occupied port cannot supply stale evidence. The prebuilt configuration accepts only Worker mode.
- `npm run verify:preview -- <https-preview-url>` checks the hosted Arabic shell and live Supabase health boundary, then records the exact Git commit and preview origin. It rejects missing or malformed arguments before network access. Loopback Hypertext Transfer Protocol is allowed only for local diagnosis.
- `npm run verify:board` performs the read-only live Project 4 intake required by `docs/agents/issue-tracker.md`; it is not part of the code-quality gate because it depends on current GitHub planning state.
- `npm run run-log -- <label words> -- <command> <args>` runs exact argument vectors without a shell and appends a local `.agent-evidence/runs.jsonl` receipt with the completion time, label, working directory, arguments, and exit, signal, or spawn result. Pass secrets through the environment, never the label or arguments; command output and environment values are not captured. The receipt is ignored and local to the worktree. This small recovery aid should be removed if it stops helping long-session evidence retrieval or duplicates an authoritative platform record.

The logger's maintenance cost is one Node wrapper and its focused command/receipt tests, plus local disk space
for appended receipts. Keep those tests aligned when the command or receipt contract changes.

Agents report exact commands, exit codes, failures, skipped or inapplicable checks, and current screenshots for visible work. Command output is authoritative; prose is interpretation.
