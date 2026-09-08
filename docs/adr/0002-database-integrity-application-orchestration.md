# ADR 0002: Database integrity and application orchestration

**Status:** Accepted
**Date:** 8 September 2026

## Context

[ADR 0001](0001-cloudflare-workers-supabase-stack.md) selected PostgreSQL as RentCottage's application database.
Its functions protect booking and payment integrity, but some also select and sequence complete multi-step outcomes.
That puts supplier and workflow policy beside constraints that must remain atomic. TypeScript services such as
`src/booking-request/booking-request-capture-processing.ts` and
`src/booking-request/booking-request-payment-recovery.ts` already demonstrate the intended application boundary.

## Decision

PostgreSQL is RentCottage's Integrity Core. It owns constraints, indexes, Row Level Security, privileges, locks,
fencing tokens, authoritative deadlines, durable identifiers, provider idempotency uniqueness, immutable history,
replay protection, and business receipts that must commit with the transition they prove. TypeScript application
services own Orchestration: selecting outcomes and sequencing calls across payment capture, recovery, expiry and
correction flows, including their booking, notification, and supplier boundaries.

| Current boundary | Integrity retained in PostgreSQL |
| --- | --- |
| Pending Hold | `public.create_pending_booking_period_hold` and `public.create_pending_booking_period_hold_without_authorization_claim` remain atomic |
| Booking conflicts | `cottage_booking_period_customer_access_excl` in `30_constraints.sql` and `cottage_booking_period_active_occupancy_unique` in `31_indexes.sql` |
| Data access | Row Level Security in `40_policies.sql` and privileges in `50_privileges.sql` |
| Capture source | Locks and fencing validation in `public.lock_booking_request_capture_source` |
| Provider evidence | Identity, reference, movement, and idempotency uniqueness in `30_constraints.sql` and `31_indexes.sql` |

All schema paths in the table are under `supabase/schemas/`. Notification delivery and sequencing belong in
application services. A durable notification uniqueness claim or receipt that must accompany a business transition
remains in the same database transaction as that transition.

## Migration

This boundary applies prospectively. The next story that changes orchestration inside a shipped PostgreSQL function
moves the affected flow into an application service and reduces the changed function to its Integrity Core. Untouched
functions remain in place. Each migration preserves durable identifiers, authorization checks, locks and fencing,
idempotency, authoritative deadlines, history and replay evidence, and atomic business receipts. It must not split
one required atomic transaction into separate application calls.

The first candidate is the durable payment simulator: `public.execute_simulated_payment_provider_operation`,
`public.query_simulated_payment_provider_operation`, and their capture, recovery, and Payment Required expiry
wrappers (`public.execute_simulated_booking_request_capture`,
`public.query_simulated_booking_request_capture`, `public.execute_simulated_booking_request_payment_recovery`,
`public.query_simulated_booking_request_payment_recovery`,
`public.execute_simulated_booking_request_payment_required_expiry`, and
`public.query_simulated_booking_request_payment_required_expiry`) in `supabase/schemas/20_functions_booking.sql`.
`public.prepare_booking_request_payment_required_expiry` is a mixed example: when its orchestration is next changed,
move its multi-step outcome selection to an application service while retaining its atomic locks, deadline checks,
validations, and mutations in the Integrity Core.

Future database changes continue to follow the declared-schema and migration procedure in the
[testing strategy](../engineering/testing-strategy.md#declared-schema).

## Consequences

- Booking and payment invariants remain enforceable under concurrency, retries, stale work, and partial failure.
- Workflow and supplier policy becomes easier to read, test, and replace in TypeScript.
- Migration happens with product work that touches each flow, without a repository-wide rewrite.
