-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.get_administrator_booking_request_payment_history (
  target_reference text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare request public.booking_requests;
declare events jsonb;
declare expiry public.booking_request_payment_required_expiry_work;
begin
  if public.is_platform_administrator('aal2') is not true then
    raise exception 'AAL2 Platform Administrator access is required' using errcode='42501';
  end if;
  select * into request from public.booking_requests requests where requests.booking_request_reference=target_reference;
  if request.id is null then return null; end if;
  select * into expiry from public.booking_request_payment_required_expiry_work work where work.booking_request_id=request.id;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id',history.id,'kind',history.kind,'source',history.source,'provenance',history.provenance,
    'operationKind',history.operation_kind,'logicalOperationId',case when history.logical_operation_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(authorization|capture|release|original-release|replacement-authorization|replacement-capture|replacement-release(:[1-9][0-9]*)?|corrective-refund:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then history.logical_operation_id when history.logical_operation_id is not null then 'reference-unavailable' end,
    'physicalAttemptId',case when history.physical_attempt_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:((authorization|capture|release):attempt-[1-9][0-9]*|(original-release|replacement-authorization|replacement-capture|replacement-release(:[1-9][0-9]*)?|corrective-refund:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):[1-9][0-9]*)$' then history.physical_attempt_id when history.physical_attempt_id is not null then 'reference-unavailable' end,'operationGeneration',history.operation_generation,
    'recoveryGeneration',history.recovery_generation,'fromState',history.from_state,'toState',history.to_state,
    'outcome',history.outcome,
    'reasonCode',case when history.reason_code in ('customer-cancellation','cottage_owner-cancellation','platform_administrator-cancellation','replacement-capture-succeeded','source-evidence-invalid','capture-occurrence-unknown','original-capture-unresolved','recovery-evidence-invalid','unexplained-recovery-provider-operation','recovery-operation-indeterminate','corrective-capture-invalid','unexplained-provider-operation','original-release-indeterminate','original-release-failed','replacement-authorization-invalid','replacement-release-indeterminate','replacement-release-failed','expiry-evidence-invalid','expiry-release-failed','expiry-release-indeterminate','expiry-refund-failed','expiry-refund-indeterminate','inventory-evidence-invalid','legacy-unresolved-money','legacy-confirmation-evidence-invalid','unsafe-recovery-original-release-indeterminate','unsafe-recovery-original-release-failed','unsafe-recovery-replacement-authorization-indeterminate','unsafe-recovery-replacement-capture-indeterminate','unsafe-recovery-replacement-release-indeterminate','unsafe-recovery-replacement-release-failed','cottage_unavailable','cannot_accommodate_request','other','capture-failed','payment-required-expired','late-capture','conflicting-evidence','unresolved-evidence','conflicting-provider-observation','unresolved-provider-observation','failed-release-observation','failed-refund-observation','malformed-provider-observation') then history.reason_code when history.reason_code is not null then 'unclassified-evidence' end,
    'providerOperationId',history.provider_operation_id,
    'providerRequestId',case when history.provider_request_id ~ '^sim(-capture|-recovery|-expiry)?-request-([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then history.provider_request_id when history.provider_request_id is not null and exists(select 1 from public.payment_provider_observations accepted where accepted.operation_id=support_operation.id and accepted.result->>'providerRequestId'=history.provider_request_id) then 'internal-request:'||support_operation.id when history.provider_request_id is not null then 'reference-unavailable' end,
    'providerReference',case when history.provider_reference ~ '^sim(-capture|-recovery|-expiry)?-reference-([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then history.provider_reference when history.provider_reference is not null and exists(select 1 from public.payment_provider_observations accepted where accepted.operation_id=support_operation.id and accepted.result->>'providerReference'=history.provider_reference) then 'internal-reference:'||support_operation.id when history.provider_reference is not null then 'reference-unavailable' end,
    'movementReference',case when history.movement_reference ~ '^sim(-capture|-recovery|-expiry)?-movement-([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then history.movement_reference when history.movement_reference is not null and exists(select 1 from public.payment_provider_observations accepted where accepted.operation_id=support_operation.id and accepted.result->>'movementReference'=history.movement_reference) then 'internal-movement:'||support_operation.id when history.movement_reference is not null then 'reference-unavailable' end,
    'amountFils',history.amount_fils::text,'currency',case when history.amount_fils is not null then 'IQD' end,
    'providerOccurredAt',history.provider_occurred_at,'receivedAt',history.received_at,
    'sourceRecordedAt',history.source_recorded_at,'recordedAt',history.recorded_at
  )) order by history.sequence),'[]'::jsonb) into events
  from public.booking_request_payment_history history
  left join public.payment_provider_operations support_operation on support_operation.id=history.provider_operation_id
    and (history.booking_request_id is null or history.booking_request_id=request.id)
    and exists(select 1 from public.booking_request_authorization_claims claim
      join public.booking_request_submission_attempts attempt on attempt.id=claim.attempt_id
      where claim.id=support_operation.claim_id and attempt.booking_request_id=request.id)
  where history.payment_lifecycle_id=request.payment_lifecycle_id and history.source<>'history-boundary';
  return jsonb_build_object(
    'bookingRequestReference',request.booking_request_reference,'simulated',true,
    'current',jsonb_build_object('requestStatus',request.status,'paymentStatus',case when exists(select 1 from public.booking_cancellations cancellation where cancellation.booking_request_id=request.id) then 'cancelled' else public.booking_request_payment_status(request) end,
      'expiryStatus',expiry.state,'reasonCode',case when coalesce(expiry.quarantine_reason,expiry.diagnostic_reason) in ('replacement-capture-succeeded','source-evidence-invalid','capture-occurrence-unknown','original-capture-unresolved','recovery-evidence-invalid','unexplained-recovery-provider-operation','recovery-operation-indeterminate','corrective-capture-invalid','unexplained-provider-operation','original-release-indeterminate','original-release-failed','replacement-authorization-invalid','replacement-release-indeterminate','replacement-release-failed','expiry-evidence-invalid','expiry-release-failed','expiry-release-indeterminate','expiry-refund-failed','expiry-refund-indeterminate','inventory-evidence-invalid','legacy-unresolved-money','legacy-confirmation-evidence-invalid','unsafe-recovery-original-release-indeterminate','unsafe-recovery-original-release-failed','unsafe-recovery-replacement-authorization-indeterminate','unsafe-recovery-replacement-capture-indeterminate','unsafe-recovery-replacement-release-indeterminate','unsafe-recovery-replacement-release-failed','cottage_unavailable','cannot_accommodate_request','other','capture-failed','payment-required-expired','late-capture','conflicting-evidence','unresolved-evidence','conflicting-provider-observation','unresolved-provider-observation','failed-release-observation','failed-refund-observation','malformed-provider-observation') then coalesce(expiry.quarantine_reason,expiry.diagnostic_reason) when coalesce(expiry.quarantine_reason,expiry.diagnostic_reason) is not null then 'unclassified-evidence' end,
      'paymentRequiredDeadline',to_jsonb((select work from public.booking_request_capture_work work where work.booking_request_id=request.id))->>'payment_required_deadline'),
    'historyCoverage',case when exists(select 1 from public.booking_request_payment_history history where history.payment_lifecycle_id=request.payment_lifecycle_id and history.source='history-boundary' and history.provenance='imported') then 'retained-evidence-only' else 'complete' end,
    'events',events
  );
end;
$function$;