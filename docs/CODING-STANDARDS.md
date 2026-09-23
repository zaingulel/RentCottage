# Coding standards

This is RentCottage's detailed coding authority. `AGENTS.md` governs delivery workflow, `CONTEXT.md` governs domain language, accepted architecture decision records govern architecture, and the selected GitHub issue governs ticket scope. A more specific authority wins on a direct conflict.

These standards apply prospectively. They do not authorize repository-wide renaming, abstraction, typing, documentation, or comment cleanup.

## Design and naming

- Use the canonical terms from `CONTEXT.md`. Prefer precise role and capability names over generic names such as Manager, Engine, Handler, Helper, or Utils.
- Prefer cohesion over size limits. Extract code when doing so centralizes a business rule, creates a meaningful test seam, separates calculation from effects, or reduces what callers must know.
- Keep calculations, deadlines, booking transitions, authorization decisions, and complete marketplace actions out of page components and route handlers. Put them behind named domain or application-service interfaces.
- Keep payment, translation, notification, storage, and identity suppliers behind narrow replaceable interfaces. Supplier Software Development Kit types must not enter domain logic.
- Do not build speculative abstractions or configuration for one use.
- Keep first-party code free of dead paths, redundant guards, leftover scaffolding, and needless duplication.

## Database and application boundary

Follow [ADR 0002](adr/0002-database-integrity-application-orchestration.md): TypeScript application services own
Orchestration, while PostgreSQL keeps the atomic Integrity Core. When a story changes orchestration inside a shipped
PostgreSQL function, move that affected orchestration and leave untouched flows in place.

## Types and boundaries

- Keep TypeScript `strict` enabled. Model domain states explicitly and handle them exhaustively.
- Validate untrusted values at Hypertext Transfer Protocol, database, environment, file, and provider-webhook boundaries. Internal code receives validated types.
- Use `unknown` plus validation for untrusted values. Do not use unvalidated `any`.
- Fail loudly. Unavailable or unknown information must not become a plausible zero, empty result, or success.

## Interfaces and content

- Treat accessibility, Arabic and Sorani right-to-left layout, translation fallbacks, responsive behaviour, and accurate accessible names as interface contracts.
- Let code explain what happens. Comments preserve only the shortest load-bearing reason for a non-obvious invariant, external quirk, unit, side effect, exception, or test-validity trap.
- Match the surrounding naming, idioms, and comment density. Remove imports, variables, functions, and files orphaned by the current change.
- Keep static checks authoritative across browser, Node.js, and Worker code. A locally justified lint exception stays
  at its site with the shortest load-bearing reason; code is not distorted to appease a wrong lint rule.
- Preserve byte-significant fixtures and shared copied files, use their declared identity checks, and respect the
  exact formatting exclusions that protect their bytes.

## Security and privacy

- Keep service-role credentials, payment credentials, and private verification files server-side.
- Give every customer, Cottage Owner, and Platform Administrator path the minimum necessary authorization.
- Log structured diagnostic context without secrets or unnecessary personal data.
- Validate signed provider events before processing them, and make money-changing operations replay-safe and idempotent.

## Agent-facing commands

These requirements apply only when an agent-facing command is already part of the approved work. They do not authorise adding a command, guard, script, hook, gate or workflow subsystem.

- Commands must be deterministic, non-interactive, and bounded in normal output.
- Validate arguments before network access or other external work.
- Distinguish success, valid zero, no-op, incomplete evidence, and failure through authoritative exit status.
- Keep stable commands in `package.json`; continuous integration must call the same verification interface used locally.
- Agent command receipts may record exact arguments and result metadata, but never environment values or command output. Put secrets in the environment rather than arguments or labels.

## Test economics

- Reuse expensive fixtures only when isolation and semantic equivalence are demonstrated. Construction-asserting
  and origin-sensitive evidence keeps fresh fixtures.
- Prefer injected execution seams for external-command doubles. When the real subprocess is the subject, keep the
  smallest representative positive and negative wire proofs so a wrapper that never calls the logic cannot pass.
- Split a test file expected to dominate the suite's critical path by concern at birth. This is an advisory budget,
  not a wall-clock gate.
- New harness machinery declares its recurring cost and a legitimate consolidation or retirement condition.
