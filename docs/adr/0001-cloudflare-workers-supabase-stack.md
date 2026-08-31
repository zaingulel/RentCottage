# ADR 0001: Cloudflare Workers and Supabase delivery stack

**Status:** Accepted
**Date:** 2 August 2026

## Context

RentCottage needs a mobile-first marketplace that handles multilingual content, owner verification documents, shift availability, payment state, and overlapping booking requests. The implementation tickets must share one production baseline so that deployment, database behaviour, security, and testing are not decided independently in each feature.

The earlier cost plan compared Cloudflare Workers with D1 against Vercel with Supabase. That split did not reflect the strongest combined option for this product. Cloudflare Workers provides a low-cost edge runtime, while Supabase provides PostgreSQL, authentication, private file storage, row-level security, and managed backups.

## Decision

The RentCottage MVP will use:

- TypeScript, React, and Next.js;
- Cloudflare Workers through the OpenNext adapter for hosting and server-side execution;
- Supabase PostgreSQL for application data;
- Supabase Auth for customer, owner, and administrator identities;
- Supabase Storage for private owner verification documents and public cottage media;
- Supabase row-level security for role and ownership boundaries;
- Supavisor transaction pooling for serverless database access;
- Vitest for unit and service-level tests;
- Playwright for browser journeys;
- GitHub Actions for continuous integration at launch;
- ordinary Git and GitHub pull-request handling, with Greptile as the sole best-effort external reviewer.

Blacksmith is not part of the initial baseline. It may replace GitHub-hosted runners later if measured continuous-integration demand justifies it.

Pull-request handling, Greptile review, GitHub Actions, and GitHub repository rules remain separate authorities. Greptile is attempted against the exact current head without authorising paid service, and its settled unavailable state does not weaken any mandatory internal, executable, Continuous Integration, conversation, ownership, tracker, merge or release gate. A completed state means processing finished only; the coordinator reconciles every current-head finding before explicitly dispatching exact-head `quality` from trusted `main`. Every push invalidates the earlier review and Continuous Integration evidence. GitHub Actions performs executable verification. The hosted GitHub repository ruleset must require `quality` from the observed GitHub Actions source, application or integration, not the `quality` check name alone, and must enforce conversation resolution; changing that hosted ruleset remains an explicit owner-gated action.

Payment, AI translation, and notification suppliers will sit behind narrow application interfaces. Qi Card is the first payment candidate to validate, but no payment provider is selected until it demonstrates the complete required flow in a sandbox and contract. Automatic Translation uses `gpt-5.6-luna` as the cost-efficient default, with `gpt-5.6-terra` or human review as the escalation path; model names and prompts remain replaceable configuration. The translation adapter sends only the text and minimum language context required, and production use requires approval of the provider's user-content processing, retention and deletion terms.

## Required implementation constraints

- Booking and hold conflicts must be enforced by PostgreSQL transactions and database constraints, not only by page-level checks.
- Every customer, owner, and administrator data path must be protected by tested row-level security policies.
- Service-role credentials and payment secrets must remain server-side and must never be exposed to a browser.
- Owner identity, ownership, and licensing files must use private storage, time-limited access, and an access audit record.
- Production behaviour must be tested in a Cloudflare `workerd` preview, not only in a local Node.js process.
- Payment webhooks must be signed, replay-safe, and idempotent before they can change booking or refund state.
- The payment provider must prove authorisation, later capture, release, refunds, dispute evidence, and lawful owner settlement before public launch.
- Static interface translations require human review. AI translation of dynamic content must preserve the original text, fall back to it on failure, exclude verification documents, cache results by source/language/model/prompt version and use a replaceable service boundary.

## Consequences

- The monthly infrastructure allowance is Cloudflare Workers plus Supabase Pro rather than either of the earlier alternatives.
- Delivery tickets can refer to one shared runtime, database, security, and test baseline.
- Provider-specific code remains replaceable while Iraqi payment suppliers and Arabic/Sorani AI translation quality are validated.
- The team accepts the operational responsibility of using two infrastructure suppliers and testing the difference between local Node.js behaviour and the Cloudflare production runtime.
