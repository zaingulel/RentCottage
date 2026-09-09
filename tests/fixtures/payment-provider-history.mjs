// Upgrade observers compare the exact historical ledger shape after its in-place
// cutover. This is read-only test projection; current writes use admission and recording.
export function historicalProviderOperationSource(evidenceInstalled) {
  if (!evidenceInstalled) return "public.simulated_payment_provider_operations";
  return `(select operation.id, operation.claim_id, operation.claim_generation,
    operation.operation_kind, operation.provider, operation.environment,
    operation.merchant_id, operation.terminal_id, operation.provider_idempotency_key,
    operation.request_fingerprint, operation.payment_lifecycle_id,
    operation.logical_operation_id, operation.physical_attempt_id,
    operation.amount_fils, operation.currency, operation.original_outcome,
    operation.current_outcome, operation.provider_request_id,
    operation.provider_reference, operation.movement_reference,
    effect.physical_execution_count, operation.created_at, operation.updated_at,
    operation.capture_execution_permit, operation.recovery_attempt_id,
    operation.authoritative_outcome_at
    from public.payment_provider_operations operation
    left join public.simulated_payment_effects effect on effect.operation_id=operation.id)`;
}
