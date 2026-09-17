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
- For changed user-facing date or money displays, use the existing locale formatters and add focused regression coverage for English, Arabic, and Kurdish.
- Directly inspect changed mobile, desktop, right-to-left, and accessibility states. Automated functional checks do not prove visual quality.
- Smoke the exact hosted preview before release. A local Worker preview does not prove Cloudflare deployment or Supabase reachability.

For an orchestration migration under [ADR 0002](../adr/0002-database-integrity-application-orchestration.md), prove
outcome selection and sequencing with Vitest at the TypeScript application-service seam. Keep real PostgreSQL observers for
authorization, constraints, locks, fencing, authoritative deadlines, durable identifiers, idempotency, history,
replay protection, and atomic business receipts. The story's changed boundary determines the combined observer;
application tests do not replace database concurrency or security evidence, and database tests do not replace the
application outcome proof.

When a financial display introduces or changes database reads, the plan traces the complete reader dependency
chain for locks and snapshot behaviour before reusing payment-command readers. Name real PostgreSQL observers proving that the
read leaves payment writers free to proceed, completes against committed facts while a writer is uncommitted,
and keeps displayed rows and totals in one consistent snapshot. Preserve command locking and fresh facts after
lock waits when extracting shared readers; verify those affected command boundaries alongside the display.

## Regression sensitivity

Every distinct material behaviour change needs one regression proof that fails when that behaviour is deliberately broken or reverted, then passes again after restoration. Prove it at the public seam selected for the behaviour; do not repeat mutation ceremony for every assertion, edge case or repair. Unchanged documentation and mechanical preservation work use existing evidence and create no new test or mutation ceremony.

## Focused preparation

For database integrity evidence, reuse an existing valid domain fixture or create one through the real
production transition. During fixture setup, keep the payment, authorization and lifecycle guards intact. Validate
the fixture through the production reader before launching its browser or Worker journey.

Before an expensive journey, validate each new database observer query and fixture at its relevant disposable
database seam: qualify ambiguous columns, assert the expected row cardinality, and preserve the public outcome.
Validate each browser selector against its intended rendered state using an accessible name or meaningful scope;
positional selection does not establish identity. Name the authoritative clock at every time boundary and align
fixtures, triggers, and assertions to it without weakening deadline behaviour or reproducing production logic.

Keep expensive fixtures alive across related assertions only when isolation is proven and failures still identify
the broken claim. Prove a process or provider boundary with the smallest representative journey; test ordinary
logic below it without repeatedly starting that boundary. When an interface changes, run its focused observer and
the adjacent tests for affected callers.

When verification commands change, update their contract tests in the same change and run those focused tests
before broad verification.

Before executing a temporary test configuration, inspect the runner's selected test list and confirm it matches
the intended files and cases. Correct unexpected additions or missing targets before running the tests.

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

Before expensive local convergence, run `npm run verify -- --plan` against the complete working tree. Read the Git
comparison, selected and skipped groups, reasons, and exact command vectors before running the same unscoped command.
The plan is a preflight: it runs no verification and supplies no pass evidence. A group-scoped plan such as
`--database --plan` describes only that group and cannot stand in for the complete-diff preflight. Reconcile any
unexpected broad or narrow route against the affected consumers before execution; use `--full` while scope remains
unresolved.

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

When regenerating an unshipped migration, compare it with the previous version and preserve required
hand-written data, policy, trigger and grant changes. Before broad convergence, rerun the affected upgrade
observer from the shipped baseline against the final migration, including existing eligible and ineligible
records; an empty schema diff does not prove a data backfill.

An upgrade proof lives only while an environment can still be behind its migration. Add it with the migration it
proves: a `scripts/verify-<change>-upgrade.mjs` observer, any legacy fixture it seeds, and one invocation in the
database preflight of `scripts/verify-access.mjs`, so the job's own route and its continuous integration run it.
Delete them, and whatever they leave orphaned, at the first weekly refresh under [`docs/demo.md`](../demo.md)
after every environment has moved past that migration, keeping any fixture a surviving proof still reads.

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

- `npm run verify` is the local and continuous-integration gate. It always audits production dependencies, checks formatting, lint and strict TypeScript, runs Vitest, regenerates Cloudflare types and checks their drift. The selector independently names database and browser evidence. Regular non-executable Markdown in the established agent-role, skill and template directories, direct Codex agent TOML definitions, documentation Markdown, retained DOCX documents and documentation illustrations use baseline because their current consumers do not enter the application build, database, Worker or browser runtime. Root manuals, the pull-request template and run-log pair remain exact baseline exceptions. Global presentation CSS, the self-hosted web font files, ordinary bundled images, and the exact shell/display Playwright specifications add browser evidence without database evidence. Executable files, scripts, TypeScript, JSON and other runtime or configuration inputs remain full even when placed under a prose directory, except for the individually named board and git-guard toolkit under `scripts/` and `scripts/lib/`, which is baseline because `npm test` already proves it through the `node --test` suite, apart from `scripts/board-move.mjs`, which is argv parsing over proved helpers. The toolkit's reach is the GitHub API and local Git, never Supabase, the Worker or a browser. That exception is a list of exact paths and never a directory wildcard, because the same directory holds Supabase, Worker and browser fixtures that do need the full route. The self-hosted font unit test and the font licences it reads are a further exact-path baseline exception, because `npm test` is their only observer and neither their content nor its loss can change a rendered page, the Worker's behaviour or the database; the font files themselves change rendering and stay on the browser route. A new consumer or configuration boundary requires this classification to be re-evaluated, and a mixed complete diff takes the strongest route selected by any path. A path that matches no route at all is not a reason to run everything: the selector names those paths, states that the fallback would otherwise be full verification, runs nothing and exits 3, so the route is classified once rather than paid for on every run. An unclassified path outranks every classified route and every full-evidence trigger the diff itself carries, a selector self-change, shared configuration, a symlink and an executable-mode change included: a mixed diff holding one still exits 3 rather than taking the full route, so a missing classification cannot hide behind a route that would have run anyway. Selector self-changes, shared configuration, symlinks and file-type or executable-mode changes take the full fallback once every changed path is classified; shallow or missing history, malformed Git evidence and multiple merge bases take it unconditionally, because they stop classification before it starts. Either way there is no question a human can answer faster. The local selector unions the source contribution from the unique `origin/main` merge base, staged and unstaged changes, and untracked files. CI unions the source contribution from the unique base/source merge base with the checked-out merge result's delta from the current base. `npm run verify -- --full` selects exhaustive convergence evidence. The full route requires Docker because access checks start an isolated local Supabase database and prove its policies directly.
- `npm run verify -- --baseline`, `--database`, and `--browser` run independent groups through the same selector. Baseline runs the audit, format, lint, type, Vitest and Cloudflare type checks; `npm test` chains Vitest with the `node --test` suite under `scripts/lib/`, which `npm run test:scripts` runs alone. Database and browser support `--full`; unselected groups report their reason and exit successfully without starting services. Only `--full` and `--baseline` bypass classification, so on an unclassified path `--database` and `--browser` stop with exit 3 like an unflagged run. GitHub runs these modes on separate runners, each checking out the same merge revision with complete history. The final ready-only `test` check requires all three jobs to succeed; failed, cancelled, skipped or missing evidence cannot satisfy it. Drafts expose only the explanatory `ci-control-no-test` aggregate.
- `npm run verify -- --plan` validates the same arguments and Git evidence as execution, then prints the selected and skipped groups, reasons, comparison identities and exact command vectors from the execution path before exiting without invoking them. An unclassified path stops `--plan` too, with the same report and exit 3 in place of the plan, because there is no settled route to print. Combine it with a group flag or `--full` to inspect that exact scope. Its maintenance cost is the output contract and focused parity tests inside the existing selector; remove the option if it stops preventing unexpected broad work or an authoritative platform surface exposes the same current-diff command plan.
- Browser verification builds the Worker once with real local Supabase credentials for access and scheduled expiry, then builds it separately with placeholder credentials for the client-secret scan and smoke. Internal Worker journeys select `playwright.worker-prebuilt.config.ts` only after the corresponding build succeeds. Next.js access and shell journeys keep their own normal Next.js builds; OpenNext standalone output is not reused by `next start`. Default browser commands still compile, and all preview configurations refuse existing servers so an occupied port cannot supply stale evidence. The prebuilt configuration accepts only Worker mode.
- `npm run verify:preview -- <https-preview-url>` checks the hosted Arabic shell and live Supabase health boundary, then records the exact Git commit and preview origin. It rejects missing or malformed arguments before network access. Loopback Hypertext Transfer Protocol is allowed only for local diagnosis.
- `npm run verify:board` performs the read-only live Project 4 intake required by `docs/agents/issue-tracker.md`; it is not part of the code-quality gate because it depends on current GitHub planning state.
- `npm run run-log -- <label words> -- <command> <args>` runs exact argument vectors without a shell and appends a local `.agent-evidence/runs.jsonl` receipt with the completion time, label, working directory, arguments, and exit, signal, or spawn result. Pass secrets through the environment, never the label or arguments; command output and environment values are not captured. The receipt is ignored and local to the worktree. This small recovery aid should be removed if it stops helping long-session evidence retrieval or duplicates an authoritative platform record.

The logger's maintenance cost is one Node wrapper and its focused command/receipt tests, plus local disk space
for appended receipts. Keep those tests aligned when the command or receipt contract changes.

Agents report exact commands, exit codes, failures, skipped or inapplicable checks, and current screenshots for visible work. Take pass, failure and skip counts from completed command results, keeping skipped cases separate from passes.
The final handoff names significant findings discovered after initial verification or review, their disposition
(repaired or disproved), and the evidence supporting it. Command output is authoritative; prose is interpretation.
