# Testing strategy

This document owns two questions for RentCottage: which evidence a change needs, and the executed bar that
evidence must clear. The board card defines the outcome, `CONTEXT.md` the domain invariants, accepted
architecture decisions the technical boundaries, [CODING-STANDARDS.md](CODING-STANDARDS.md) how code is written
and how test economics are judged, and the `resume` skill the mechanics of when a check runs and how its
receipt is recorded. A more specific product, domain or architecture decision wins on a direct conflict.

## Evidence by change type

A change adds its tests to the existing suites: Vitest files beside the code under `src/`, SQL tests under
`supabase/tests/database/`, Playwright specifications under `tests/`, and the `node --test` suite under
`scripts/lib/`. It never adds a test script, harness or runner, and no database migration needs its own upgrade
program. Each row names the minimum evidence, the cheapest layer that catches the failure, and the ceiling
beyond which further evidence needs a named reason. A mixed change takes every row it touches.

| Change type | Minimum evidence | Cheapest layer | Ceiling |
|---|---|---|---|
| Copy, translation strings and presentation (labels, CSS, layout, right-to-left, accessibility) | The locale formatter or translation table test in Vitest where one exists, covering English, Arabic and Kurdish for a changed date or money display, plus direct inspection of the changed desktop, mobile, right-to-left and accessibility states | Vitest; the existing shell or display Playwright specification when only the rendered result can see the change | The browser group; no database evidence |
| Product logic in TypeScript (prices, fees, deadlines, filters, state transitions, application-service outcomes) | Vitest at the domain function or application-service seam | Vitest | One existing Playwright journey when the change is user-visible |
| A read (new or changed query, view or screen reader) | The domain's SQL test asserting the rows and cardinality the reader returns, plus the Vitest seam that consumes them | SQL test | The database group; a financial display read also proves in SQL that it leaves payment writers free, completes against committed facts while a writer is uncommitted, and reads one consistent snapshot |
| Schema change that moves, rewrites or deletes no existing data (a table, column, index, constraint, trigger, function, view, policy, grant or realtime publication membership added or changed, or an index, constraint, trigger, function, view, policy, grant or publication membership dropped) | The declared-schema edit and its migration, generated or hand-written as Declared schema describes, with the domain's SQL test asserting the object's behaviour and the roles that can and cannot read it; a grant or policy added, changed, dropped or revoked also takes the authentication row | SQL test | The database group, whose drift check already covers the migration chain |
| A migration, function, scheduled task or script that moves, rewrites or deletes existing data | A test asserting the end state every affected row or file must satisfy and the ones the change must leave alone: the domain's SQL test, or Vitest at the application-service seam for a file-storage deletion | SQL test; Vitest for file storage | The database group; running a migration against real or old-shaped data is release-candidate work, not job evidence |
| Integrity Core (a PostgreSQL function, trigger, constraint or lock owning concurrency, deadline, idempotency, fencing, history or receipt) | The domain's SQL test for the invariant and the flow's existing concurrency program under `scripts/verify-*-concurrency.mjs`; a new concurrent invariant extends that program | SQL test for the invariant; the concurrency program for the race | `npm run verify -- --database --full`; a mock never stands in |
| Authentication, authorization, Row Level Security, private or personal data | The domain's `*_rls` or `*_security` SQL test asserting the allowed and the denied outcome for each role the change touches; for a changed user-visible boundary, the existing access journey in `tests/` | SQL test | `npm run verify -- --full` |
| Payments and provider events | Vitest contract tests for signature, replay, duplicate and out-of-order events and the money-changing command; SQL tests for the authoritative facts | Vitest | `npm run verify -- --full` |
| Worker behaviour (server code, bindings, scheduled handlers, headers) | The existing `tests/worker-*.spec.ts` journey for the changed behaviour, in the Workers runtime. Worker compatibility and the client-secret scan are independent evidence classes that a Node.js test does not replace | The Worker journey | The browser group; `npm run verify -- --full` when the change touches provider or Worker trust |
| Credential custody and log content | A new or moved server secret extends `src/ci/client-secret-scan.ts` and the server-environment guard test; a changed log line has a Vitest assertion that it carries no secret or personal data | Vitest | The browser group, which runs the client-secret scan |
| Untrusted content entering markup, SQL, a header or a provider request | Vitest, or the SQL test for SQL, asserting a hostile fixture is escaped, rejected or quoted | Vitest | `npm run verify -- --full` |
| Scripts and workflow tooling under `scripts/` | The `node --test` suite under `scripts/lib/`, updated in the same change when a command contract changes | `npm run test:scripts` | `npm test` |
| Documentation and agent instruction | `npm run lint:docs` and any contract test that pins the text; the fresh review of the final tree replaces the executed mutation | `npm run lint:docs` | The baseline route |
| Test-only repair | The repaired test by its full title. Removing or weakening an assertion that is the named anti-regression test of a security, privacy, authorization or money-changing invariant (for example a denied, unsigned, replayed or duplicate outcome, a hostile fixture escaped, rejected or quoted, a log line free of secrets, or the rows a deletion must leave alone) is not a test-only repair and takes its domain's row | Its own suite | That suite; never the full local check |

## Rules every change follows

- Name the claim: a test protects one observable behaviour or invariant; test count and coverage percentage are
  not targets.
- Keep the oracle independent: expected values come from requirements, `CONTEXT.md`, a hand-worked example, a
  provider contract or a known-good fixture, never a copy of the production calculation.
- Each changed rule is proven by one executed mutation at the cheapest layer that catches it: break the
  implementation, run the focused test with runner retries disabled (`--retries=0` for Playwright, `--retry=0`
  for Vitest) and see red, restore it and see green, both through `scripts/run-log.mjs`. Do not repeat it per
  assertion, edge case or repair. `preservation` claims invent none.
- A security, privacy, authorization or money-changing invariant needs a named anti-regression test in the same
  change.
- Schema, policy, constraint, trigger, concurrency and migration claims need real disposable PostgreSQL evidence;
  Worker claims need the Workers runtime; a Node.js test proves neither.
- Run each new or strengthened test by its full title; zero matches is failed verification. Invoke fail-loud
  scripts directly so their own exit status is authoritative.
- Locate browser controls by accessible name or meaningful scope. A viewport assertion starts with a
  starting-state guard and uses a retrying assertion, never a fixed wait. Name the authoritative clock at every
  time boundary and align fixtures and assertions to it.
- Diagnose a browser or automated-judge failure as a possible oracle defect (selector, wording, timing, stale
  artifact) before treating it as an implementation defect. A runner's automatic retry does not erase the
  original failure; report it with the final result. A missing, skipped or unavailable required observation is
  never a pass.
- Take pass, failure and skip counts from completed command results, skips separate from passes. Command output
  is authoritative; prose is interpretation.

## Construction modes

Each coherent claim receives exactly one mode. Subject matter sets the minimum mode; change shape cannot lower
that floor.

| Mode | Admission and obligation |
|---|---|
| `strict-tdd` | A reproducible defect, or a changed security or domain invariant whose failure would be high consequence. A failing proof at the public seam precedes the implementation, and the same evidence returns green after the change. |
| `evidence-required` | Any other new or changed behaviour or policy. The construction order is flexible, but the change lands with an executed regression proof that fails when the behaviour is broken and passes when restored. |
| `preservation` | Mechanical changes and refactors with no changed behaviour and an unchanged protected contract. Existing evidence protects the named contract; no new test or mutation is created. |

A documentation or agent-instruction change has no executable observer for its meaning. One that changes what a
reader must do is `evidence-required`: `npm run lint:docs` is its mechanical check, and the fresh review of the
final tree is the named alternative to the executed mutation. One that only rewords is `preservation`, and
`npm run lint:docs` staying green is its protected contract.

The architect names the mode and observer per claim; the session owns the executed mutation and the convergence
run, so a builder never pays for broad suites. The builder follows the handed-off mode and cannot reinterpret or
downgrade it. An asserted-but-unexecuted mutation is a review finding.

## Fixtures, preparation and cleanup

- Reuse an existing valid domain fixture or create one through the real production transition, keeping the
  payment, authorization and lifecycle guards intact; validate it through the production reader before a browser
  or Worker journey.
- Validate each new database observer query at the disposable database seam before an expensive journey: qualify
  ambiguous columns and assert row cardinality.
- Keep an expensive fixture alive across related assertions only when isolation is proven and a failure still
  identifies the broken claim; construction-asserting evidence keeps fresh fixtures, per
  [Test economics](CODING-STANDARDS.md#test-economics) in CODING-STANDARDS.md.
- Cleanup belongs to the disposable project teardown that `npm run verify:access` starts and disposes of; a
  journey deletes nothing of its own, a failed attempt keeps its rows until that teardown, and synthetic
  identities carry no credentials or sessions.
- Before running a temporary test configuration, inspect the runner's selected list and correct it before
  execution.

## Declared schema

`supabase/schemas/` declares the complete public schema in dependency order: extensions, types, tables by domain,
functions by domain, constraints, indexes, triggers, policies, privileges and the realtime publication.
`supabase/config.toml` lists the files in `schema_paths`. `supabase/migrations/` stays the applied history and is
never edited after it ships.

To change a function, view, table, index or constraint: edit the object in its schema file, start the local
database, run `npx supabase db diff -f <change-name>`, read the generated migration so it contains only the
intended objects, then commit the schema edit and the migration together. Row Level Security policies, triggers,
grants and data changes are hand-written migrations, because the diff engine does not track every privilege and
policy change; mirror each into the matching schema file so the declaration stays complete. When regenerating an
unshipped migration, compare it with the previous version and preserve those hand-written parts. An orchestration
move under [ADR 0002](adr/0002-database-integrity-application-orchestration.md) changes only the affected flow,
keeps its Integrity Core in the declaration and migration, proves outcome selection with Vitest at the
application-service seam and keeps the real PostgreSQL observers for what stays in the database.

The database group runs `supabase db diff` before the SQL tests and fails on any drift between the declared schema
and the migration chain. Two declarations keep their exact wording for that baseline to stay empty: the migrations
revoke the default `REFERENCES`, `TRIGGER`, `TRUNCATE` and `MAINTAIN` table privileges from the API roles, so
`50_privileges.sql` repeats those revokes explicitly, and `cottage_profile_source_text_lengths` is written in the
migration's `between` form because the diff engine compares constraint text. Direct changes made in Studio, the
SQL editor or `psql` are invisible to the diff; always edit the schema files. `package-lock.json` resolves the
Supabase CLI to 2.114.0, and that resolution must not move until
`20260908120000_booking_request_payment_history.sql` wraps its `lock table` in a transaction: newer releases apply
migrations statement by statement and refuse that lock. Install with `npm ci`, which honours the lockfile.

## The loop

Focused checks run while building and between review rounds, each through
`node scripts/run-log.mjs <label words> -- <command>`; the `resume` skill owns the receipt and rerun mechanics.
The full local check runs once before push: `node scripts/run-log.mjs convergence -- npm run verify`, which selects
its route from the changed paths (`npm run verify -- --plan` prints that route without running it) and may reuse
unchanged database or browser evidence; a receipt claimed as fresh full execution uses `npm run verify -- --full`.
A TypeScript product change selects the baseline route; a database object the database group; a booking or payment
Integrity Core object or concurrency program adds the booking and payment concurrency programs; presentation,
Worker and Playwright paths the browser group; an unlisted path stops the run until it is listed in
`scripts/verify.mjs`. A further broad run needs a named reason: changed evidence, an invalidated environment or an
investigated flake. A repair that touches only tests reruns the repaired test by title and never the full local
check. Continuous integration runs `npm run verify -- --baseline`, `--database` and `--browser` on separate runners
against the merge result once the pull request leaves draft, and the required `test` check passes only when all
three succeed; the database and browser runs select every check, except for a change touching only documentation or
workflow instructions, where they run nothing. The hosted preview is smoked with
`npm run verify:preview -- <https-preview-url>` as a separate owner-approved operation.

## Reviewing tests

Review of test code asks three questions and no others: does it catch the failure (its mutation went red), is
its expected result derived independently of the code under test, and does it leak a secret or personal data.
Any other observation about a test is not a finding.

## What this authority does not do

It sets no coverage target or test quota, imposes no universal red-green-refactor sequence, adds no wall-clock
gate, starts no rewrite or deletion programme, and describes no verification machinery internals:
`scripts/verify.mjs`, `scripts/verify-access.mjs` and `scripts/run-log.mjs` own their own output and record
contracts through their tests under `scripts/lib/`.
