# Coding standards

This is RentCottage's detailed coding authority. `AGENTS.md` governs delivery workflow, `CONTEXT.md` governs domain language, accepted architecture decision records govern architecture, and the selected GitHub issue governs ticket scope. A more specific authority wins on a direct conflict.

These standards apply prospectively. They do not authorize repository-wide renaming, abstraction, typing, documentation, or comment cleanup.

## Design and naming

- Use the canonical terms from `CONTEXT.md`. Prefer precise role and capability names over generic names such as Manager, Engine, Handler, Helper, or Utils.
- Prefer cohesion over size limits. Extract code when doing so centralizes a business rule, creates a meaningful test seam, separates calculation from effects, or reduces what callers must know.
- Keep calculations, deadlines, booking transitions, authorization decisions, and complete marketplace actions out of page components and route handlers. Put them behind named domain or application-service interfaces.
- Keep payment, translation, notification, storage, and identity suppliers behind narrow replaceable interfaces. Supplier Software Development Kit types must not enter domain logic.
- Do not build speculative abstractions or configuration for one use.

## Types and boundaries

- Keep TypeScript `strict` enabled. Model domain states explicitly and handle them exhaustively.
- Validate untrusted values at Hypertext Transfer Protocol, database, environment, file, and provider-webhook boundaries. Internal code receives validated types.
- Use `unknown` plus validation for untrusted values. Do not use unvalidated `any`.
- Fail loudly. Unavailable or unknown information must not become a plausible zero, empty result, or success.

## Interfaces and content

- Treat accessibility, Arabic and Sorani right-to-left layout, translation fallbacks, responsive behaviour, and accurate accessible names as interface contracts.
- Let code explain what happens. Comments preserve only the shortest load-bearing reason for a non-obvious invariant, external quirk, unit, side effect, exception, or test-validity trap.
- Match the surrounding naming, idioms, and comment density. Remove imports, variables, functions, and files orphaned by the current change.

## Security and privacy

- Keep service-role credentials, payment credentials, and private verification files server-side.
- Give every customer, Cottage Owner, and Platform Administrator path the minimum necessary authorization.
- Log structured diagnostic context without secrets or unnecessary personal data.
- Validate signed provider events before processing them, and make money-changing operations replay-safe and idempotent.

## Agent-facing commands

- Commands must be deterministic, non-interactive, and bounded in normal output.
- Validate arguments before network access or other external work.
- Distinguish success, valid zero, no-op, incomplete evidence, and failure through authoritative exit status.
- Keep stable commands in `package.json`; continuous integration must call the same verification interface used locally.
