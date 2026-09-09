-- Coordinated nonproduction payment-evidence cutover. Stop payment writers before applying.
-- Generated with supabase db diff; destructive rename inference replaced with identity-preserving DDL.
BEGIN;
SET check_function_bodies = false;

ALTER TABLE public.simulated_payment_provider_operations RENAME TO payment_provider_operations;

CREATE OR REPLACE FUNCTION "public"."booking_request_payment_required_expiry_permit"("target" "public"."booking_request_payment_required_expiry_operations", "deadline" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select case when target.operation_kind='refund' then jsonb_build_object(
    'purpose','booking-request-payment-required-corrective-refund','expiryWorkId',target.expiry_work_id,
    'expiryOperationId',target.id,'idempotencyKey',target.provider_idempotency_key,
    'notBefore',to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'binding',jsonb_build_object('bookingRequestId',target.booking_request_id,'captureProviderOperationId',target.capture_provider_operation_id,
      'paymentLifecycleId',target.authorization_payment_lifecycle_id,
      'captureLogicalOperationId',(select ledger.logical_operation_id from public.payment_provider_operations ledger where ledger.id=target.capture_provider_operation_id),
      'capturePhysicalAttemptId',(select ledger.physical_attempt_id from public.payment_provider_operations ledger where ledger.id=target.capture_provider_operation_id),
      'captureMovementReference',(select ledger.movement_reference from public.payment_provider_operations ledger where ledger.id=target.capture_provider_operation_id),
      'captureOccurredAt',to_char(target.capture_occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'refundLogicalOperationId',target.release_logical_operation_id,'refundPhysicalAttemptId',target.release_physical_attempt_id,
      'amountFils',target.amount_fils,'currency',target.currency,'providerIdentity',jsonb_build_object('provider',target.provider,
        'environment',target.environment,'merchantId',target.merchant_id,'terminalId',target.terminal_id)))
  else jsonb_build_object(
    'purpose','booking-request-payment-required-expiry','expiryWorkId',target.expiry_work_id,
    'expiryOperationId',target.id,'idempotencyKey',target.provider_idempotency_key,
    'notBefore',to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'binding',jsonb_build_object(
      'bookingRequestId',target.booking_request_id,
      'authorizationClaimId',target.authorization_claim_id,
      'authorizationClaimGeneration',target.authorization_claim_generation,
      'authorizationPaymentLifecycleId',target.authorization_payment_lifecycle_id,
      'authorizationLogicalOperationId',target.authorization_logical_operation_id,
      'authorizationPhysicalAttemptId',target.authorization_physical_attempt_id,
      'predecessorMovementReference',target.predecessor_movement_reference,
      'predecessorOutcomeAt',to_char(target.predecessor_outcome_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'releaseLogicalOperationId',target.release_logical_operation_id,
      'releasePhysicalAttemptId',target.release_physical_attempt_id,
      'amountFils',target.amount_fils,'currency',target.currency,
      'requestFingerprint',target.request_fingerprint,
      'providerIdentity',jsonb_build_object('provider',target.provider,'environment',target.environment,
        'merchantId',target.merchant_id,'terminalId',target.terminal_id))) end;
$$;

ALTER TABLE public.payment_provider_operations DISABLE TRIGGER observe_payment_history_provider_operation;

ALTER TABLE public.payment_provider_operations ALTER COLUMN original_outcome DROP NOT NULL;

ALTER TABLE public.payment_provider_operations ALTER COLUMN current_outcome DROP NOT NULL;

ALTER TABLE public.payment_provider_operations ALTER COLUMN provider_request_id DROP NOT NULL;

ALTER TABLE public.payment_provider_operations ALTER COLUMN provider_reference DROP NOT NULL;

ALTER TABLE public.payment_provider_operations ADD COLUMN admission jsonb;

ALTER TABLE public.payment_provider_operations ADD COLUMN original_outcome_at timestamptz;

ALTER TABLE public.payment_provider_operations ADD COLUMN executed_at timestamptz;

ALTER TABLE public.payment_provider_operations ADD COLUMN recorded_at timestamptz;

ALTER TABLE public.payment_provider_operations ADD COLUMN evidence_provenance text;

UPDATE public.payment_provider_operations ledger SET
 admission=jsonb_build_object('purpose',coalesce(
   ledger.capture_execution_permit->>'purpose',
   (SELECT operations.execution_permit->>'purpose' FROM public.booking_request_payment_recovery_operations operations WHERE operations.provider_operation_id=ledger.id),
   (SELECT CASE WHEN operations.operation_kind='refund' THEN 'booking-request-payment-required-corrective-refund' ELSE 'booking-request-payment-required-expiry' END FROM public.booking_request_payment_required_expiry_operations operations WHERE operations.provider_operation_id=ledger.id AND operations.owner='expiry'),
   CASE WHEN ledger.operation_kind='authorization' THEN 'booking-request-authorization'
        WHEN EXISTS(SELECT 1 FROM public.booking_request_release_operations operations WHERE operations.provider_idempotency_key=ledger.provider_idempotency_key) THEN 'booking-request-release'
        ELSE 'booking-request-submission-cleanup' END),
   'permit',coalesce(ledger.capture_execution_permit,
     (SELECT operations.execution_permit FROM public.booking_request_payment_recovery_operations operations WHERE operations.provider_operation_id=ledger.id),
     (SELECT public.booking_request_payment_required_expiry_permit(operations,work.payment_required_deadline) FROM public.booking_request_payment_required_expiry_operations operations JOIN public.booking_request_payment_required_expiry_work work ON work.id=operations.expiry_work_id WHERE operations.provider_operation_id=ledger.id AND operations.owner='expiry')),
   'notBefore',null,'notAfter',null),
 original_outcome_at=CASE WHEN ledger.original_outcome<>'indeterminate' THEN ledger.created_at END,
 executed_at=ledger.created_at,recorded_at=ledger.updated_at,evidence_provenance='legacy-simulated';

UPDATE public.payment_provider_operations SET admission=admission||jsonb_build_object(
 'notBefore',coalesce(admission#>>'{permit,notBefore}',admission#>>'{permit,binding,predecessorOutcomeAt}'),
 'notAfter',CASE WHEN admission#>>'{permit,step}' IS DISTINCT FROM 'replacement-release' THEN admission#>>'{permit,notAfter}' END);

ALTER TABLE public.payment_provider_operations ALTER COLUMN admission SET NOT NULL;

ALTER TABLE public.payment_provider_operations ALTER COLUMN evidence_provenance SET NOT NULL;

CREATE TABLE IF NOT EXISTS "public"."payment_provider_observations" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "operation_id" uuid NOT NULL,
    "provider" text NOT NULL,
    "environment" text NOT NULL,
    "merchant_id" text NOT NULL,
    "terminal_id" text NOT NULL,
    "event_id" text NOT NULL,
    "result" jsonb NOT NULL,
    "occurred_at" timestamp with time zone,
    "received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    "provenance" text NOT NULL,
    CONSTRAINT "payment_provider_observation_identity" CHECK ((length(event_id) BETWEEN 1 AND 200 AND jsonb_typeof(result)='object' AND provenance IN ('fictional-provider','provider-event','legacy-simulated')))
);
ALTER TABLE "public"."payment_provider_observations" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."simulated_payment_effects" (
    "operation_id" uuid NOT NULL,
    "provider" text NOT NULL,
    "environment" text NOT NULL,
    "merchant_id" text NOT NULL,
    "terminal_id" text NOT NULL,
    "idempotency_key" text NOT NULL,
    "binding" jsonb NOT NULL,
    "state" text NOT NULL,
    "result" jsonb,
    "physical_execution_count" smallint NOT NULL,
    "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "simulated_payment_effect_scope" CHECK ((length(provider)>0 AND environment='local-test' AND length(merchant_id)>0 AND length(terminal_id)>0)),
    CONSTRAINT "simulated_payment_effect_state" CHECK ((((state='reserved' AND result IS NULL AND physical_execution_count=0) OR (state='closed-not-executed' AND result->>'outcome'='not-executed' AND physical_execution_count=0) OR (state='executed' AND result->>'outcome' IN ('succeeded','failed','indeterminate') AND physical_execution_count=1))) IS TRUE)
);
ALTER TABLE "public"."simulated_payment_effects" OWNER TO "postgres";

INSERT INTO public.payment_provider_observations(operation_id,provider,environment,merchant_id,terminal_id,event_id,result,occurred_at,received_at,provenance)
 SELECT ledger.id,ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,'legacy-simulated-'||ledger.id,
 jsonb_build_object('outcome',ledger.current_outcome,'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
   'evidence',jsonb_build_object('operationId',ledger.id,'eventId','legacy-simulated-'||ledger.id,'provenance','legacy-simulated',
     'originalOutcome',ledger.original_outcome,'executedAt',ledger.executed_at,'occurredAt',ledger.authoritative_outcome_at,'closedAt',null))
 || CASE WHEN ledger.current_outcome='failed' THEN jsonb_build_object('retrySafe',false) ELSE jsonb_build_object('movementReference',ledger.movement_reference) END,
 ledger.authoritative_outcome_at,ledger.updated_at,'legacy-simulated' FROM public.payment_provider_operations ledger;
INSERT INTO public.simulated_payment_effects(operation_id,provider,environment,merchant_id,terminal_id,idempotency_key,binding,state,result,physical_execution_count,created_at,updated_at)
 SELECT ledger.id,ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,ledger.provider_idempotency_key,
 jsonb_build_object('operationId',ledger.id,'providerIdentity',jsonb_build_object('provider',ledger.provider,'environment',ledger.environment,'merchantId',ledger.merchant_id,'terminalId',ledger.terminal_id),
   'idempotencyKey',ledger.provider_idempotency_key,'requestFingerprint',ledger.request_fingerprint,'notBefore',ledger.admission->'notBefore','notAfter',ledger.admission->'notAfter'),
 'executed',observations.result,ledger.physical_execution_count,ledger.created_at,ledger.updated_at
 FROM public.payment_provider_operations ledger JOIN public.payment_provider_observations observations ON observations.operation_id=ledger.id;
ALTER TABLE public.payment_provider_operations DROP COLUMN physical_execution_count;

ALTER TABLE public.payment_provider_operations ADD CONSTRAINT "payment_provider_admission_shape" CHECK ((jsonb_typeof(admission) = 'object' AND admission ?& array['purpose','permit','notBefore','notAfter']));

ALTER TABLE public.payment_provider_operations ADD CONSTRAINT "payment_provider_evidence_provenance" CHECK ((evidence_provenance IN ('admitted','fictional-provider','provider-event','legacy-simulated')));

ALTER TABLE public.payment_provider_operations ADD CONSTRAINT "payment_provider_pending_evidence" CHECK (((current_outcome IS NULL AND original_outcome IS NULL AND recorded_at IS NULL AND provider_request_id IS NULL AND provider_reference IS NULL AND movement_reference IS NULL AND authoritative_outcome_at IS NULL AND evidence_provenance='admitted') OR (current_outcome IS NOT NULL AND original_outcome IS NOT NULL AND recorded_at IS NOT NULL AND evidence_provenance<>'admitted')));

ALTER TABLE public.payment_provider_operations ADD CONSTRAINT "payment_provider_result_references" CHECK (((current_outcome IS NULL OR (current_outcome='not-executed' AND provider_request_id IS NULL AND provider_reference IS NULL AND movement_reference IS NULL AND authoritative_outcome_at IS NULL) OR (current_outcome IN ('succeeded','failed','indeterminate') AND length(provider_request_id)>0 AND length(provider_reference)>0 AND ((current_outcome='failed' AND movement_reference IS NULL) OR (current_outcome<>'failed' AND length(movement_reference)>0))))) IS TRUE);

ALTER TABLE public.payment_provider_operations DROP CONSTRAINT "simulated_payment_provider_operations_current_outcome_check";

ALTER TABLE public.payment_provider_operations ADD CONSTRAINT "simulated_payment_provider_operations_current_outcome_check" CHECK (("current_outcome" = ANY (ARRAY['succeeded'::"text", 'failed'::"text", 'indeterminate'::"text", 'not-executed'::"text"])));

ALTER TABLE public.payment_provider_operations DROP CONSTRAINT "simulated_payment_provider_operations_environment_check";

ALTER TABLE public.payment_provider_operations ADD CONSTRAINT "simulated_payment_provider_operations_environment_check" CHECK ((length(btrim("environment")) > 0));

ALTER TABLE public.payment_provider_operations DROP CONSTRAINT "simulated_payment_provider_operations_original_outcome_check";

ALTER TABLE public.payment_provider_operations ADD CONSTRAINT "simulated_payment_provider_operations_original_outcome_check" CHECK (("original_outcome" = ANY (ARRAY['succeeded'::"text", 'failed'::"text", 'indeterminate'::"text", 'not-executed'::"text"])));

DROP FUNCTION "public"."execute_simulated_booking_request_capture"("target_permit" "jsonb");

DROP FUNCTION "public"."execute_simulated_booking_request_capture"("target_permit" "jsonb", "target_outcome" "text");

DROP FUNCTION "public"."execute_simulated_booking_request_payment_recovery"("target_permit" "jsonb", "target_outcome" "text");

DROP FUNCTION "public"."execute_simulated_booking_request_payment_required_expiry"("target_permit" "jsonb", "target_outcome" "text");

DROP FUNCTION "public"."execute_simulated_payment_provider_operation"("target_operation" "jsonb", "target_outcome" "text");

DROP FUNCTION "public"."query_simulated_booking_request_capture"("target_operation" "jsonb", "target_provider_request_id" "text", "target_provider_reference" "text");

DROP FUNCTION "public"."query_simulated_booking_request_payment_recovery"("target_permit" "jsonb", "target_provider_request_id" "text", "target_provider_reference" "text", "target_outcome" "text");

DROP FUNCTION "public"."query_simulated_booking_request_payment_required_expiry"("target_permit" "jsonb", "target_provider_request_id" "text", "target_provider_reference" "text", "target_outcome" "text");

DROP FUNCTION "public"."query_simulated_payment_provider_operation"("target_operation" "jsonb", "target_provider_request_id" "text", "target_provider_reference" "text", "target_outcome" "text");



CREATE OR REPLACE FUNCTION "public"."booking_request_payment_status"("target_request" "public"."booking_requests") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select case when target_request.status = 'accepted' then case
      when exists (
        select 1 from public.booking_confirmations confirmations
        join public.cottage_booking_period_commitments commitments on commitments.id = confirmations.booking_period_commitment_id
        join public.booking_request_capture_work capture_work on capture_work.booking_request_id = confirmations.booking_request_id
        where confirmations.booking_request_id = target_request.id
            and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=target_request.id)
          and not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=target_request.id and expiry.state='quarantined')
          and confirmations.booking_snapshot_id = target_request.booking_snapshot_id
          and confirmations.booking_period_commitment_id = target_request.booking_period_commitment_id
          and commitments.status = 'confirmed_booking' and (capture_work.state = 'complete' or (
            capture_work.state='payment_required' and exists (
              select 1 from public.booking_request_payment_recovery_attempts attempts
              join public.booking_request_payment_recovery_operations operations on operations.recovery_attempt_id=attempts.id
                and operations.step='replacement-capture' and operations.outcome='succeeded'
              join public.payment_provider_operations ledger on ledger.id=operations.provider_operation_id
              where attempts.booking_request_id=target_request.id and attempts.state='succeeded'
                and operations.provider_operation_id=confirmations.capture_operation_id
                and ledger.current_outcome='succeeded' and ledger.recovery_attempt_id=attempts.id
                and ledger.authoritative_outcome_at=operations.authoritative_outcome_at
                and ledger.authoritative_outcome_at < capture_work.payment_required_deadline
            )))
      ) then 'paid-confirmed'
      when exists (select 1 from public.booking_request_capture_work capture_work
        where capture_work.booking_request_id = target_request.id and capture_work.state = 'payment_required')
        then 'payment-required'
      when exists (select 1 from public.booking_request_capture_work capture_work where capture_work.booking_request_id = target_request.id)
        then 'capture-processing'
      end end;
$$;

CREATE OR REPLACE FUNCTION "public"."booking_request_recovery_execution_permit"("target_attempt" "public"."booking_request_payment_recovery_attempts", "target_work" "public"."booking_request_capture_work", "target_payment_snapshot" "jsonb", "target_step" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare previous public.booking_request_payment_recovery_operations;
declare previous_attempt public.booking_request_payment_recovery_attempts;
declare previous_ledger public.payment_provider_operations;
declare predecessor text;
declare predecessor_time timestamptz;
declare previous_step text;
declare operation_identity text := target_attempt.id::text||':'||target_step;
declare binding jsonb;
begin
  if target_step='original-release' then
    predecessor := target_payment_snapshot#>>'{authorization,movementReference}';
    predecessor_time := (target_payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz;
  else
    previous_step := case target_step when 'replacement-authorization' then 'original-release'
      when 'replacement-capture' then 'replacement-authorization'
      when 'replacement-release' then 'replacement-authorization' end;
    if previous_step is null then raise exception 'Recovery step is invalid' using errcode='RC409'; end if;
    select operations.* into previous
    from public.booking_request_payment_recovery_operations operations
    join public.booking_request_payment_recovery_attempts attempts on attempts.id=operations.recovery_attempt_id
    where attempts.booking_request_id=target_attempt.booking_request_id
      and operations.step=previous_step and operations.outcome='succeeded'
      and (previous_step='original-release' or attempts.id=target_attempt.id)
    order by attempts.generation limit 1 for update of operations,attempts;
    select * into previous_attempt from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=previous.recovery_attempt_id;
    previous_ledger := public.validate_booking_request_recovery_operation(previous,
      public.booking_request_recovery_execution_permit(previous_attempt,target_work,target_payment_snapshot,previous_step));
    if previous_ledger.current_outcome is distinct from 'succeeded'
      or previous_ledger.authoritative_outcome_at is null then
      raise exception 'Recovery predecessor is unresolved' using errcode='RC409';
    end if;
    predecessor := previous_ledger.movement_reference;
    predecessor_time := previous_ledger.authoritative_outcome_at;
  end if;
  if predecessor is null then raise exception 'Recovery predecessor is missing' using errcode='RC409'; end if;
  binding := jsonb_build_object('bookingRequestId',target_attempt.booking_request_id,
    'recoveryAttemptId',target_attempt.id,'generation',target_attempt.generation,'step',target_step,
    'authorizationClaimId',target_work.authorization_claim_id,
    'authorizationClaimGeneration',target_work.authorization_claim_generation,
    'predecessorMovementReference',predecessor,
    'predecessorOutcomeAt',to_char(predecessor_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'paymentLifecycleId',case when target_step='original-release' then target_work.payment_lifecycle_id else target_attempt.id end,
    'logicalOperationId',operation_identity,'physicalAttemptId',operation_identity||':1',
    'amountFils',target_work.amount_fils,'currency',target_work.currency,
    'requestFingerprint',target_work.request_fingerprint,
    'providerIdentity',jsonb_build_object('provider',target_work.provider,'environment',target_work.environment,
      'merchantId',target_work.merchant_id,'terminalId',target_work.terminal_id));
  return jsonb_build_object('purpose','booking-request-payment-recovery','attemptId',target_attempt.id,
    'generation',target_attempt.generation,'step',target_step,'operationId',operation_identity,
    'idempotencyKey',operation_identity||':1','binding',binding,
    'notAfter',to_char(target_work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;

CREATE OR REPLACE FUNCTION "public"."claim_due_booking_request_captures"("target_limit" integer, "target_provider_identity" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare candidate record;
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.payment_provider_operations;
declare claimed_at timestamptz;
declare results jsonb := '[]'::jsonb;
begin
  if target_limit is null or target_limit < 1 or target_limit > 50
    or target_provider_identity is null
    or jsonb_typeof(target_provider_identity) <> 'object'
    or not target_provider_identity ?& array['provider','environment','merchantId','terminalId']
    or target_provider_identity - array['provider','environment','merchantId','terminalId'] <> '{}'::jsonb
    or exists (select 1 from jsonb_each(target_provider_identity) fields
      where jsonb_typeof(fields.value) <> 'string' or btrim(fields.value #>> '{}') = '') then
    raise exception 'Capture recovery selection is invalid' using errcode = 'RC409';
  end if;
  for candidate in
    select requests.id from public.booking_requests requests
    join public.booking_request_capture_work capture_work on capture_work.booking_request_id = requests.id
    where not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=capture_work.booking_request_id and expiry.state='quarantined') and requests.status = 'accepted'
      and capture_work.provider = target_provider_identity ->> 'provider'
      and capture_work.environment = target_provider_identity ->> 'environment'
      and capture_work.merchant_id = target_provider_identity ->> 'merchantId'
      and capture_work.terminal_id = target_provider_identity ->> 'terminalId'
      and (capture_work.state = 'complete' or (capture_work.state = 'processing' and capture_work.lease_expires_at <= clock_timestamp()))
      and not exists (select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id = requests.id)
    -- Existing execution evidence must progress beyond unavailable crash-window rows.
    order by case when capture_work.state = 'complete' or exists (
      select 1 from public.payment_provider_operations operations
      where (operations.provider, operations.environment, operations.merchant_id, operations.terminal_id,
        operations.provider_idempotency_key, operations.claim_id, operations.claim_generation,
        operations.payment_lifecycle_id, operations.logical_operation_id, operations.physical_attempt_id,
        operations.operation_kind, operations.request_fingerprint, operations.amount_fils, operations.currency) =
        (capture_work.provider, capture_work.environment, capture_work.merchant_id, capture_work.terminal_id,
        capture_work.provider_idempotency_key, capture_work.authorization_claim_id, capture_work.authorization_claim_generation,
        capture_work.payment_lifecycle_id, capture_work.capture_logical_operation_id, capture_work.capture_physical_attempt_id,
        'capture', capture_work.request_fingerprint, capture_work.amount_fils, capture_work.currency)
    ) then 0 else 1 end, capture_work.created_at, requests.id
    limit target_limit for update of requests skip locked
  loop
    select * into source from public.lock_booking_request_capture_source(candidate.id);
    work := source.work;
    ledger := source.ledger;
    claimed_at := date_trunc('milliseconds', clock_timestamp());
    if exists (select 1 from public.booking_confirmations where booking_request_id = candidate.id) then continue; end if;
    if work.state = 'complete' then
      results := results || jsonb_build_array(public.complete_booking_request_capture(candidate.id, null, null, null));
      continue;
    end if;
    if work.state <> 'processing' or work.lease_expires_at > claimed_at then continue; end if;
    if ledger.id is null then
      results := results || jsonb_build_array(jsonb_build_object('status', 'unavailable'));
      continue;
    end if;
    if (work.recovery_operation_id is null and (
        work.lease_generation is distinct from (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint
        or work.lease_token::text is distinct from ledger.capture_execution_permit ->> 'leaseToken'))
      or (work.recovery_operation_id is not null and (
        work.recovery_operation_id <> ledger.id
        or work.lease_generation <= (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint))
      or (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint < 1
      or (ledger.capture_execution_permit ->> 'leaseToken')::uuid is null
      or ledger.executed_at >= (ledger.capture_execution_permit ->> 'notAfter')::timestamptz
      or ledger.executed_at < (source.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz then
      raise exception 'Capture recovery execution evidence is invalid' using errcode = 'RC409';
    end if;
    update public.booking_request_capture_work capture_work
    set lease_generation = capture_work.lease_generation + 1, lease_token = gen_random_uuid(),
      lease_expires_at = claimed_at + interval '30 seconds', recovery_operation_id = ledger.id
    where capture_work.booking_request_id = candidate.id returning * into work;
    results := results || jsonb_build_array(jsonb_build_object('status', 'reconcile', 'lease', source.binding || jsonb_build_object(
      'workId', work.booking_request_id, 'leaseGeneration', work.lease_generation,
      'leaseToken', work.lease_token,
      'notAfter', to_char(work.lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'recoveryOperationId', work.recovery_operation_id,
      'providerResult', jsonb_build_object('providerRequestId', ledger.provider_request_id,
        'providerReference', ledger.provider_reference) || case when ledger.original_outcome = 'succeeded'
          then jsonb_build_object('movementReference', ledger.movement_reference) else '{}'::jsonb end
    )));
  end loop;
  return results;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."complete_booking_request_capture"("target_booking_request_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_provider_result" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.payment_provider_operations;
declare capture_identity public.booking_request_provider_operation_identities;
declare expected_permit jsonb;
declare expected_result jsonb;
declare capture_operation jsonb;
declare capture_movement jsonb;
declare movements jsonb;
declare captured_at text;
declare finalized_at timestamptz;
begin
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  if not found then raise exception 'Booking Request capture work is unavailable' using errcode = 'RC409'; end if;
  work := source.work;
  ledger := source.ledger;
  if ledger.id is null then raise exception 'Booking Request capture provider evidence is missing' using errcode = 'RC409'; end if;
  if ledger.original_outcome is distinct from 'succeeded'
    or ledger.current_outcome is distinct from 'succeeded'
    or ledger.movement_reference is null then
    raise exception 'Booking Request successful Capture evidence is invalid' using errcode = 'RC409';
  end if;
  expected_result := jsonb_build_object('outcome', 'succeeded',
    'providerRequestId', ledger.provider_request_id, 'providerReference', ledger.provider_reference,
    'movementReference', ledger.movement_reference);
  if not (
    (work.state = 'complete' and target_lease_generation is null and target_lease_token is null and target_provider_result is null)
    or (target_lease_generation is not null and target_lease_token is not null
      and target_lease_generation = work.lease_generation
      and (
        (work.recovery_operation_id is null
          and target_lease_generation = (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint
          and target_lease_token::text = ledger.capture_execution_permit ->> 'leaseToken')
        or (work.state = 'processing' and work.recovery_operation_id = ledger.id
          and target_lease_token = work.lease_token
          and work.lease_generation > (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint)
      )
      and target_provider_result is not distinct from expected_result)
  ) then
    raise exception 'Booking Request capture lease or result is invalid' using errcode = 'RC409';
  end if;
  if work.state = 'processing' then
    expected_permit := source.binding || jsonb_build_object(
      'purpose', 'booking-request-capture', 'workId', work.booking_request_id,
      'leaseGeneration', work.lease_generation, 'leaseToken', work.lease_token,
      'notAfter', to_char(work.lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
    if work.recovery_operation_id is null and ledger.capture_execution_permit is distinct from expected_permit then
      raise exception 'Booking Request capture lease is stale' using errcode = 'RC409';
    end if;
  elsif work.state <> 'complete' then
    raise exception 'Booking Request capture work is not processing' using errcode = 'RC409';
  end if;
  if (work.recovery_operation_id is null and (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint is distinct from work.lease_generation)
    or (work.recovery_operation_id is not null and (work.recovery_operation_id <> ledger.id
      or work.lease_generation <= (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint))
    or (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint < 1
    or (ledger.capture_execution_permit ->> 'leaseToken')::uuid is null
    or ledger.executed_at >= (ledger.capture_execution_permit ->> 'notAfter')::timestamptz
    or ledger.executed_at < (source.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz then
    raise exception 'Booking Request capture occurrence is invalid' using errcode = 'RC409';
  end if;
  captured_at := to_char(ledger.executed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  capture_operation := jsonb_build_object(
    'paymentLifecycleId', work.payment_lifecycle_id, 'kind', 'capture',
    'logicalOperationId', work.capture_logical_operation_id,
    'attemptId', work.capture_physical_attempt_id, 'status', 'succeeded',
    'amountFils', work.amount_fils, 'providerRequestId', ledger.provider_request_id,
    'providerReference', ledger.provider_reference, 'movementReference', ledger.movement_reference,
    'reconciliationRequired', false, 'retrySafe', false
  );
  capture_movement := jsonb_build_object(
    'kind', 'capture', 'logicalOperationId', work.capture_logical_operation_id,
    'attemptId', work.capture_physical_attempt_id, 'amountFils', work.amount_fils,
    'movementReference', ledger.movement_reference, 'recordedAt', captured_at
  );
  movements := jsonb_build_array(source.payment_snapshot #> '{movements,0}', capture_movement);
  select * into capture_identity from public.booking_request_provider_operation_identities identities
  where identities.attempt_id = work.attempt_id and identities.operation_kind = 'capture'
  for update of identities;
  if work.state = 'complete' then
    if source.payment_snapshot -> 'capture' is distinct from capture_operation
      or source.payment_snapshot -> 'movements' is distinct from movements
      or capture_identity.attempt_id is null
      or (capture_identity.provider, capture_identity.environment, capture_identity.merchant_id,
        capture_identity.terminal_id, capture_identity.provider_request_id,
        capture_identity.provider_reference, capture_identity.movement_reference) is distinct from
        (work.provider, work.environment, work.merchant_id, work.terminal_id,
        ledger.provider_request_id, ledger.provider_reference, ledger.movement_reference) then
      raise exception 'Completed Booking Request capture evidence is invalid' using errcode = 'RC409';
    end if;
  else
    insert into public.booking_request_provider_operation_identities (
      attempt_id, operation_kind, provider, environment, merchant_id, terminal_id,
      provider_request_id, provider_reference, movement_reference
    ) values (work.attempt_id, 'capture', work.provider, work.environment, work.merchant_id,
      work.terminal_id, ledger.provider_request_id, ledger.provider_reference, ledger.movement_reference);
    finalized_at := clock_timestamp();
    -- The existing work trigger validates uncaptured Authorization; both writes commit atomically.
    update public.booking_request_capture_work capture_work
    set state = 'complete', outcome = 'succeeded', completed_at = finalized_at,
      lease_token = null, lease_expires_at = null
    where capture_work.booking_request_id = work.booking_request_id;
    update public.booking_request_submission_attempts attempts
    set payment_snapshot = source.payment_snapshot || jsonb_build_object('capture', capture_operation, 'movements', movements),
      updated_at = finalized_at
    where attempts.id = work.attempt_id;
  end if;
  return jsonb_build_object('status', 'complete',
    'snapshot', source.binding || jsonb_build_object(
      'authorization', source.payment_snapshot -> 'authorization', 'capture', capture_operation, 'movements', movements),
    'expectation', source.binding || jsonb_build_object(
      'authorizationProviderResult', jsonb_build_object(
        'providerRequestId', source.payment_snapshot #>> '{authorization,providerRequestId}',
        'providerReference', source.payment_snapshot #>> '{authorization,providerReference}',
        'movementReference', source.payment_snapshot #>> '{authorization,movementReference}'),
      'captureProviderResult', expected_result - 'outcome',
      'authorizationRecordedAt', source.payment_snapshot #>> '{movements,0,recordedAt}',
      'captureRecordedAt', captured_at)
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."expire_booking_request_authorization_claims"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare candidate record;
declare attempt public.booking_request_submission_attempts;
declare claim public.booking_request_authorization_claims;
declare authorization_ledger public.payment_provider_operations;
declare release_ledger public.payment_provider_operations;
declare authorization_found boolean;
declare release_found boolean;
declare authorization_snapshot jsonb;
declare release_snapshot jsonb;
declare reconciled_snapshot jsonb;
declare provider_identity jsonb;
declare recorded_at text;
declare expired_count integer := 0;
begin
  for candidate in
    select attempts.id as attempt_id, claims.id as claim_id
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    where public.booking_request_claim_state_is_active(claims.state)
      and claims.reconciliation_expires_at <= statement_timestamp()
    order by attempts.id
    for update of attempts skip locked
  loop
    select * into attempt
    from public.booking_request_submission_attempts attempts
    where attempts.id = candidate.attempt_id
    for update;
    select * into claim
    from public.booking_request_authorization_claims claims
    where claims.id = candidate.claim_id
      and public.booking_request_claim_state_is_active(claims.state)
      and claims.reconciliation_expires_at <= statement_timestamp()
    for update;
    if not found then continue; end if;

    authorization_snapshot := attempt.payment_snapshot -> 'authorization';
    release_snapshot := nullif(attempt.payment_snapshot -> 'release', 'null'::jsonb);
    provider_identity := jsonb_build_object(
      'provider', claim.provider,
      'environment', claim.environment,
      'merchantId', claim.merchant_id,
      'terminalId', claim.terminal_id
    );
    select * into authorization_ledger
    from public.payment_provider_operations operations
    where operations.claim_id = claim.id
      and operations.claim_generation = claim.generation
      and operations.operation_kind = 'authorization'
    for update;
    authorization_found := found;

    if authorization_found and authorization_ledger.current_outcome is null then continue; end if;
    if not authorization_found or authorization_ledger.current_outcome='not-executed' then
      if claim.state in ('starting', 'reconciliation_required')
        and authorization_snapshot ->> 'status' = 'pending'
        and authorization_snapshot -> 'providerRequestId' = 'null'::jsonb
        and authorization_snapshot -> 'providerReference' = 'null'::jsonb
        and release_snapshot is null then
        update public.booking_request_submission_attempts attempts
        set state = 'expired', updated_at = statement_timestamp()
        where attempts.id = claim.attempt_id;
        update public.booking_request_authorization_claims claims
        set state = 'expired', state_revision = state_revision + 1,
          updated_at = statement_timestamp()
        where claims.id = claim.id;
        update public.booking_request_authorization_claim_occupancies occupancies
        set active = false
        where occupancies.claim_id = claim.id and occupancies.active;
        update public.booking_request_authorization_reconciliation_outbox outbox
        set state = 'complete', observed_state_revision = claim.state_revision + 1,
          lease_token = null, lease_expires_at = null,
          updated_at = statement_timestamp()
        where outbox.claim_id = claim.id;
        expired_count := expired_count + 1;
      end if;
      continue;
    end if;

    if authorization_ledger.provider <> claim.provider
      or authorization_ledger.environment <> claim.environment
      or authorization_ledger.merchant_id <> claim.merchant_id
      or authorization_ledger.terminal_id <> claim.terminal_id
      or authorization_ledger.payment_lifecycle_id <> claim.payment_lifecycle_id
      or authorization_ledger.logical_operation_id <> claim.logical_operation_id
      or authorization_ledger.physical_attempt_id <> claim.physical_attempt_id
      or authorization_ledger.amount_fils <> claim.amount_fils
      or authorization_ledger.currency <> claim.currency
      or authorization_ledger.current_outcome = 'indeterminate' then
      continue;
    end if;

    if authorization_ledger.current_outcome = 'failed' then
      if authorization_snapshot ->> 'status' = 'pending'
        and release_snapshot is null then
        reconciled_snapshot := attempt.payment_snapshot || jsonb_build_object(
          'authorization', authorization_snapshot || jsonb_build_object(
            'status', 'failed',
            'providerRequestId', authorization_ledger.provider_request_id,
            'providerReference', authorization_ledger.provider_reference,
            'movementReference', null,
            'reconciliationRequired', false,
            'retrySafe', false
          ),
          'movements', '[]'::jsonb
        );
        perform public.save_booking_request_payment_snapshot(
          claim.attempt_id, reconciled_snapshot, provider_identity
        );
        expired_count := expired_count + 1;
      end if;
      continue;
    end if;

    if authorization_ledger.movement_reference is null then
      continue;
    end if;
    if authorization_snapshot ->> 'status' <> 'succeeded' then
      if authorization_snapshot ->> 'status' <> 'pending'
        or release_snapshot is not null then
        continue;
      end if;
      recorded_at := to_char(
        authorization_ledger.updated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      );
      reconciled_snapshot := attempt.payment_snapshot || jsonb_build_object(
        'authorization', authorization_snapshot || jsonb_build_object(
          'status', 'succeeded',
          'providerRequestId', authorization_ledger.provider_request_id,
          'providerReference', authorization_ledger.provider_reference,
          'movementReference', authorization_ledger.movement_reference,
          'reconciliationRequired', false,
          'retrySafe', false
        ),
        'movements', jsonb_build_array(jsonb_build_object(
          'kind', 'authorization',
          'logicalOperationId', authorization_snapshot ->> 'logicalOperationId',
          'attemptId', authorization_snapshot ->> 'attemptId',
          'amountFils', claim.amount_fils,
          'movementReference', authorization_ledger.movement_reference,
          'recordedAt', recorded_at
        ))
      );
      perform public.save_booking_request_payment_snapshot(
        claim.attempt_id, reconciled_snapshot, provider_identity
      );
      select * into attempt
      from public.booking_request_submission_attempts attempts
      where attempts.id = claim.attempt_id;
      select * into claim
      from public.booking_request_authorization_claims claims
      where claims.id = claim.id;
      authorization_snapshot := attempt.payment_snapshot -> 'authorization';
      release_snapshot := nullif(attempt.payment_snapshot -> 'release', 'null'::jsonb);
    end if;

    if release_snapshot is null then
      if (public.booking_request_policy_at(
        (attempt.quote_payload -> 'items' -> 0 ->> 'startsAt')::timestamptz,
        clock_timestamp()
      ) ->> 'insideCutoff')::boolean then
        reconciled_snapshot := attempt.payment_snapshot || jsonb_build_object(
          'release', jsonb_build_object(
            'paymentLifecycleId', claim.payment_lifecycle_id,
            'kind', 'release',
            'logicalOperationId', claim.payment_lifecycle_id::text || ':release',
            'attemptId', claim.payment_lifecycle_id::text || ':release:attempt-1',
            'status', 'pending',
            'amountFils', claim.amount_fils,
            'providerRequestId', null,
            'providerReference', null,
            'movementReference', null,
            'reconciliationRequired', false,
            'retrySafe', false
          )
        );
        perform public.save_booking_request_payment_snapshot(
          claim.attempt_id, reconciled_snapshot, provider_identity
        );
        continue;
      end if;
      perform public.finalize_booking_request_submission(
        claim.attempt_id, attempt.payment_snapshot
      );
      expired_count := expired_count + 1;
      continue;
    end if;

    select * into release_ledger
    from public.payment_provider_operations operations
    where operations.claim_id = claim.id
      and operations.claim_generation = claim.generation
      and operations.operation_kind = 'release'
      and operations.logical_operation_id = release_snapshot ->> 'logicalOperationId'
      and operations.physical_attempt_id = release_snapshot ->> 'attemptId'
    for update;
    release_found := found;
    if not release_found
      or release_ledger.current_outcome <> 'succeeded'
      or release_ledger.movement_reference is null
      or release_ledger.provider <> claim.provider
      or release_ledger.environment <> claim.environment
      or release_ledger.merchant_id <> claim.merchant_id
      or release_ledger.terminal_id <> claim.terminal_id
      or release_ledger.payment_lifecycle_id <> claim.payment_lifecycle_id
      or release_ledger.logical_operation_id
        <> claim.payment_lifecycle_id::text || ':release'
      or release_ledger.amount_fils <> claim.amount_fils
      or release_ledger.currency <> claim.currency then
      continue;
    end if;
    recorded_at := to_char(
      release_ledger.updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    reconciled_snapshot := attempt.payment_snapshot || jsonb_build_object(
      'release', release_snapshot || jsonb_build_object(
        'status', 'succeeded',
        'providerRequestId', release_ledger.provider_request_id,
        'providerReference', release_ledger.provider_reference,
        'movementReference', release_ledger.movement_reference,
        'reconciliationRequired', false,
        'retrySafe', false
      ),
      'movements', (attempt.payment_snapshot -> 'movements') ||
        jsonb_build_array(jsonb_build_object(
          'kind', 'release',
          'logicalOperationId', release_snapshot ->> 'logicalOperationId',
          'attemptId', release_snapshot ->> 'attemptId',
          'amountFils', claim.amount_fils,
          'movementReference', release_ledger.movement_reference,
          'recordedAt', recorded_at
        ))
    );
    perform public.save_booking_request_payment_snapshot(
      claim.attempt_id, reconciled_snapshot, provider_identity
    );
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."finalize_booking_request_confirmation"("target_booking_request_id" "uuid", "target_capture_snapshot" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare capture_result jsonb;
declare target_request public.booking_requests;
declare target_attempt public.booking_request_submission_attempts;
declare target_claim public.booking_request_authorization_claims;
declare target_snapshot public.booking_snapshots;
declare target_commitment public.cottage_booking_period_commitments;
declare target_capture public.payment_provider_operations;
declare existing_confirmation public.booking_confirmations;
declare customer_receipt public.booking_receipts;
declare owner_receipt public.booking_receipts;
declare created_confirmation public.booking_confirmations;
declare outcome_time timestamptz;
begin
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  if current_setting('role', true) <> 'service_role' then
    raise exception 'Booking Request confirmation is unavailable' using errcode = '42501';
  end if;
  if exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=target_booking_request_id) then return jsonb_build_object('status','correction-required'); end if;
  if target_capture_snapshot ->> 'purpose' = 'booking-request-payment-recovery' then
    target_capture_snapshot := public.validate_booking_request_payment_recovery_confirmation(
      target_booking_request_id, target_capture_snapshot
    );
  else
    capture_result := public.complete_booking_request_capture(
      target_booking_request_id, null, null, null
    );
    if capture_result -> 'snapshot' is distinct from target_capture_snapshot then
      raise exception 'Booking Request confirmation Capture evidence is invalid'
        using errcode = 'RC409';
    end if;
  end if;

  select * into target_request from public.booking_requests requests
  where requests.id = target_booking_request_id;
  select * into target_attempt from public.booking_request_submission_attempts attempts
  where attempts.id = (target_capture_snapshot ->> 'submissionAttemptId')::uuid;
  select * into target_claim from public.booking_request_authorization_claims claims
  where claims.id = (target_capture_snapshot ->> 'authorizationClaimId')::uuid;
  select * into target_snapshot from public.booking_snapshots snapshots
  where snapshots.id = target_request.booking_snapshot_id;
  select * into target_commitment from public.cottage_booking_period_commitments commitments
  where commitments.id = target_request.booking_period_commitment_id
  for update of commitments;
  select * into target_capture from public.payment_provider_operations operations
  where operations.claim_id = target_claim.id
    and operations.claim_generation = target_claim.generation
    and operations.operation_kind = 'capture'
    and operations.physical_attempt_id = target_capture_snapshot ->> 'capturePhysicalAttemptId'
  for update of operations;
  perform 1 from public.cottage_inventory_commitments inventory
  where inventory.booking_period_commitment_id = target_commitment.id
  order by inventory.service_day, inventory.unit_kind, inventory.unit_id
  for update of inventory;
  perform 1 from public.cottage_booking_period_occupancies occupancies
  where occupancies.booking_period_commitment_id = target_commitment.id
  order by occupancies.service_day, occupancies.shift_id
  for update of occupancies;

  if target_request.id is null
    or target_request.status <> 'accepted'
    or target_attempt.id is null
    or target_attempt.booking_request_id is distinct from target_request.id
    or target_claim.id is null
    or target_claim.attempt_id is distinct from target_attempt.id
    or target_snapshot.id is null
    or (target_snapshot.customer_user_id, target_snapshot.profile_id,
      target_snapshot.quote_fingerprint, target_snapshot.intent_fingerprint,
      target_snapshot.quote_payload, target_snapshot.intent_payload) is distinct from
      (target_request.customer_user_id, target_request.profile_id,
      target_attempt.quote_fingerprint, target_attempt.intent_fingerprint,
      target_attempt.quote_payload, target_attempt.intent_payload)
    or target_commitment.id is null
    or (target_commitment.customer_user_id, target_commitment.profile_id,
      target_commitment.schedule_revision_id) is distinct from
      (target_request.customer_user_id, target_request.profile_id,
      target_claim.schedule_revision_id)
    or target_claim.customer_user_id is distinct from target_request.customer_user_id
    or target_claim.profile_id is distinct from target_request.profile_id
    or target_claim.access_ranges is distinct from target_commitment.access_ranges
    or target_request.owner_user_id is distinct from (
      select profiles.owner_user_id
      from public.owner_application_cottage_profiles profiles
      where profiles.id = target_request.profile_id
    )
    or (target_snapshot.quote_payload ->> 'bookingPriceIqd')::bigint * 1000
      is distinct from (target_attempt.payment_snapshot ->> 'bookingPriceFils')::bigint
    or (target_snapshot.quote_payload ->> 'customerTotalIqd')::bigint * 1000
      is distinct from (target_capture_snapshot ->> 'amountFils')::bigint
    or (target_attempt.payment_snapshot ->> 'customerTotalFils')::bigint
      is distinct from (target_capture_snapshot ->> 'amountFils')::bigint
    or target_capture.id is null
    or target_capture.movement_reference
      is distinct from target_capture_snapshot #>> '{capture,movementReference}'
    or not exists (
      select 1 from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
    )
    or not exists (
      select 1 from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
    )
    or exists (
      select claim_items.unit_kind, claim_items.unit_id,
        claim_items.service_day, claim_items.price_iqd
      from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
      except
      select inventory.unit_kind, inventory.unit_id,
        inventory.service_day, inventory.committed_price_iqd
      from public.cottage_inventory_commitments inventory
      where inventory.booking_period_commitment_id = target_commitment.id
    )
    or exists (
      select inventory.unit_kind, inventory.unit_id,
        inventory.service_day, inventory.committed_price_iqd
      from public.cottage_inventory_commitments inventory
      where inventory.booking_period_commitment_id = target_commitment.id
      except
      select claim_items.unit_kind, claim_items.unit_id,
        claim_items.service_day, claim_items.price_iqd
      from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
    )
    or exists (
      select claim_occupancies.schedule_revision_id,
        claim_occupancies.shift_id, claim_occupancies.service_day
      from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
      except
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
    )
    or exists (
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
      except
      select claim_occupancies.schedule_revision_id,
        claim_occupancies.shift_id, claim_occupancies.service_day
      from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
    )
    or exists (
      select target_claim.schedule_revision_id, expected.shift_id,
        claim_items.service_day
      from public.booking_request_authorization_claim_items claim_items
      cross join lateral (
        select claim_items.unit_id as shift_id
        where claim_items.unit_kind = 'shift'
        union all
        select shifts.id
        from public.cottage_shifts shifts
        where claim_items.unit_kind = 'full_day_bundle'
          and shifts.schedule_revision_id = target_claim.schedule_revision_id
      ) expected
      where claim_items.claim_id = target_claim.id
      except
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
    )
    or exists (
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
      except
      select target_claim.schedule_revision_id, expected.shift_id,
        claim_items.service_day
      from public.booking_request_authorization_claim_items claim_items
      cross join lateral (
        select claim_items.unit_id as shift_id
        where claim_items.unit_kind = 'shift'
        union all
        select shifts.id
        from public.cottage_shifts shifts
        where claim_items.unit_kind = 'full_day_bundle'
          and shifts.schedule_revision_id = target_claim.schedule_revision_id
      ) expected
      where claim_items.claim_id = target_claim.id
    )
    or exists (
      select 1 from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and not occupancies.active
    )
    or exists (
      select 1 from public.booking_request_release_work release_work
      where release_work.booking_request_id = target_request.id
    ) then
    raise exception 'Booking Request confirmation source graph is invalid'
      using errcode = 'RC409';
  end if;

  select * into existing_confirmation from public.booking_confirmations confirmations
  where confirmations.booking_request_id = target_request.id
  for update of confirmations;
  if existing_confirmation.id is not null then
    select * into customer_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'customer';
    select * into owner_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'cottage_owner';
    if (existing_confirmation.booking_snapshot_id,
      existing_confirmation.booking_period_commitment_id,
      existing_confirmation.capture_operation_id) is distinct from
      (target_snapshot.id, target_commitment.id, target_capture.id)
      or target_commitment.status <> 'confirmed_booking'
      or customer_receipt.id is null
      or owner_receipt.id is null
      or (customer_receipt.booking_snapshot_id, customer_receipt.recipient_user_id,
        customer_receipt.created_at) is distinct from
        (target_snapshot.id, target_request.customer_user_id,
        existing_confirmation.confirmed_at)
      or (owner_receipt.booking_snapshot_id, owner_receipt.recipient_user_id,
        owner_receipt.created_at) is distinct from
        (target_snapshot.id, target_request.owner_user_id,
        existing_confirmation.confirmed_at)
      or (select count(*) from public.booking_receipts receipts
        where receipts.booking_confirmation_id = existing_confirmation.id) <> 2 then
      raise exception 'Stored Booking Request confirmation is incomplete'
        using errcode = 'RC409';
    end if;
  else
    if target_commitment.status <> 'pending_hold' then
      raise exception 'Booking Request confirmation commitment is invalid'
        using errcode = 'RC409';
    end if;
    outcome_time := clock_timestamp();
    insert into public.booking_confirmations (
      booking_request_id, booking_snapshot_id, booking_period_commitment_id,
      capture_operation_id, confirmed_at
    ) values (
      target_request.id, target_snapshot.id, target_commitment.id,
      target_capture.id, outcome_time
    ) returning * into created_confirmation;
    update public.cottage_booking_period_commitments commitments
    set status = 'confirmed_booking'
    where commitments.id = target_commitment.id;
    insert into public.booking_receipts (
      booking_confirmation_id, booking_snapshot_id, recipient_role,
      recipient_user_id, created_at
    ) values
      (created_confirmation.id, target_snapshot.id, 'customer',
        target_request.customer_user_id, outcome_time),
      (created_confirmation.id, target_snapshot.id, 'cottage_owner',
        target_request.owner_user_id, outcome_time);
    existing_confirmation := created_confirmation;
    select * into customer_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'customer';
    select * into owner_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'cottage_owner';
  end if;

  return jsonb_build_object(
    'bookingRequestId', target_request.id,
    'commitmentId', target_commitment.id,
    'bookingReference', target_commitment.commitment_reference,
    'confirmedAt', to_char(existing_confirmation.confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'capturePhysicalAttemptId', target_capture.physical_attempt_id,
    'captureMovementReference', target_capture.movement_reference,
    'receipts', jsonb_build_object(
      'customer', jsonb_build_object(
        'id', customer_receipt.id, 'recipientId', customer_receipt.recipient_user_id
      ),
      'cottageOwner', jsonb_build_object(
        'id', owner_receipt.id, 'recipientId', owner_receipt.recipient_user_id
      )
    )
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_administrator_booking_request_payment_history"("target_reference" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
    'reasonCode',case when history.reason_code in ('replacement-capture-succeeded','source-evidence-invalid','capture-occurrence-unknown','original-capture-unresolved','recovery-evidence-invalid','unexplained-recovery-provider-operation','recovery-operation-indeterminate','corrective-capture-invalid','unexplained-provider-operation','original-release-indeterminate','original-release-failed','replacement-authorization-invalid','replacement-release-indeterminate','replacement-release-failed','expiry-evidence-invalid','expiry-release-failed','expiry-release-indeterminate','expiry-refund-failed','expiry-refund-indeterminate','inventory-evidence-invalid','legacy-unresolved-money','legacy-confirmation-evidence-invalid','unsafe-recovery-original-release-indeterminate','unsafe-recovery-original-release-failed','unsafe-recovery-replacement-authorization-indeterminate','unsafe-recovery-replacement-capture-indeterminate','unsafe-recovery-replacement-release-indeterminate','unsafe-recovery-replacement-release-failed','cottage_unavailable','cannot_accommodate_request','other','capture-failed','payment-required-expired','late-capture','conflicting-evidence','unresolved-evidence','conflicting-provider-observation','unresolved-provider-observation','failed-release-observation','failed-refund-observation','malformed-provider-observation') then history.reason_code when history.reason_code is not null then 'unclassified-evidence' end,
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
    'current',jsonb_build_object('requestStatus',request.status,'paymentStatus',public.booking_request_payment_status(request),
      'expiryStatus',expiry.state,'reasonCode',case when coalesce(expiry.quarantine_reason,expiry.diagnostic_reason) in ('replacement-capture-succeeded','source-evidence-invalid','capture-occurrence-unknown','original-capture-unresolved','recovery-evidence-invalid','unexplained-recovery-provider-operation','recovery-operation-indeterminate','corrective-capture-invalid','unexplained-provider-operation','original-release-indeterminate','original-release-failed','replacement-authorization-invalid','replacement-release-indeterminate','replacement-release-failed','expiry-evidence-invalid','expiry-release-failed','expiry-release-indeterminate','expiry-refund-failed','expiry-refund-indeterminate','inventory-evidence-invalid','legacy-unresolved-money','legacy-confirmation-evidence-invalid','unsafe-recovery-original-release-indeterminate','unsafe-recovery-original-release-failed','unsafe-recovery-replacement-authorization-indeterminate','unsafe-recovery-replacement-capture-indeterminate','unsafe-recovery-replacement-release-indeterminate','unsafe-recovery-replacement-release-failed','cottage_unavailable','cannot_accommodate_request','other','capture-failed','payment-required-expired','late-capture','conflicting-evidence','unresolved-evidence','conflicting-provider-observation','unresolved-provider-observation','failed-release-observation','failed-refund-observation','malformed-provider-observation') then coalesce(expiry.quarantine_reason,expiry.diagnostic_reason) when coalesce(expiry.quarantine_reason,expiry.diagnostic_reason) is not null then 'unclassified-evidence' end,
      'paymentRequiredDeadline',to_jsonb((select work from public.booking_request_capture_work work where work.booking_request_id=request.id))->>'payment_required_deadline'),
    'historyCoverage',case when exists(select 1 from public.booking_request_payment_history history where history.payment_lifecycle_id=request.payment_lifecycle_id and history.source='history-boundary' and history.provenance='imported') then 'retained-evidence-only' else 'complete' end,
    'events',events
  );
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."get_booking_request_payment_recovery_confirmation_evidence"("target_attempt_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare evidence jsonb;
begin
  select jsonb_build_object(
    'purpose','booking-request-payment-recovery','bookingRequestId',attempts.booking_request_id,
    'recoveryAttemptId',attempts.id,'capturePhysicalAttemptId',ledger.physical_attempt_id,
    'capture',jsonb_build_object('movementReference',ledger.movement_reference)) into evidence
  from public.booking_request_payment_recovery_attempts attempts
  join public.booking_request_payment_recovery_operations operations on operations.recovery_attempt_id=attempts.id
    and operations.step='replacement-capture'
  join public.payment_provider_operations ledger on ledger.id=operations.provider_operation_id
  where attempts.id=target_attempt_id;
  if current_setting('role',true) <> 'service_role' or evidence is null then
    raise exception 'Recovery confirmation evidence is unavailable' using errcode='RC409'; end if;
  return evidence;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."lease_booking_request_payment_recovery_step"("target_attempt_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record;
declare attempt public.booking_request_payment_recovery_attempts;
declare previous public.booking_request_payment_recovery_operations;
declare ledger public.payment_provider_operations;
declare step text;
declare permit jsonb;
begin
  if public.booking_request_payment_quarantined((select attempts.booking_request_id from public.booking_request_payment_recovery_attempts attempts where attempts.id=target_attempt_id)) then return jsonb_build_object('status','quarantined'); end if;
  if current_setting('role',true) <> 'service_role' then
    raise exception 'Recovery processing is unavailable' using errcode='42501'; end if;
  if public.booking_request_payment_required_expiry_completed((
    select attempts.booking_request_id from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=target_attempt_id
  )) then return jsonb_build_object('status','deadline-elapsed'); end if;
  select * into source from public.lock_booking_request_payment_recovery_source(target_attempt_id);
  attempt := source.attempt;
  select * into ledger from public.payment_provider_operations operations where operations.recovery_attempt_id=attempt.id
    and operations.current_outcome is null order by operations.created_at,operations.id for update of operations limit 1;
  if found then
    permit:=ledger.admission->'permit';
    return jsonb_build_object('status','reconcile','permit',permit,'binding',permit->'binding',
      'providerRequestId',null,'providerReference',null);
  end if;
  if attempt.state='blocked' then
    select * into previous from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=attempt.id and operations.outcome='indeterminate';
    if previous.id is null then return jsonb_build_object('status','blocked'); end if;
    permit := public.booking_request_recovery_execution_permit(attempt,source.work,source.payment_snapshot,previous.step);
    ledger := public.validate_booking_request_recovery_operation(previous,permit);
    return jsonb_build_object('status','reconcile','permit',permit,'binding',permit->'binding',
      'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference);
  end if;
  if attempt.state in ('safely_failed','succeeded','late_succeeded') then
    return jsonb_build_object('status',case when attempt.state='safely_failed' then 'retryable'
      else replace(attempt.state,'_','-') end);
  end if;
  step := case attempt.state when 'admitted' then 'original-release'
    when 'original_released' then 'replacement-authorization'
    when 'replacement_authorized' then 'replacement-capture'
    when 'capture_failed' then 'replacement-release' end;
  permit := public.booking_request_recovery_execution_permit(attempt,source.work,source.payment_snapshot,step);
  if exists(
    select 1 from public.booking_request_payment_required_expiry_operations expiry_operations
    where expiry_operations.booking_request_id=attempt.booking_request_id
      and expiry_operations.owner='expiry'
      and expiry_operations.authorization_payment_lifecycle_id=
        (permit#>>'{binding,paymentLifecycleId}')::uuid
      and expiry_operations.predecessor_movement_reference=
        permit#>>'{binding,predecessorMovementReference}'
  ) then return jsonb_build_object('status','deadline-elapsed'); end if;
  -- Check the clock after every source, recovery and expiry-ownership lock.
  if step <> 'replacement-release' and clock_timestamp() >= (source.work).payment_required_deadline then
    return jsonb_build_object('status','deadline-elapsed'); end if;
  return jsonb_build_object('status','leased','permit',permit,'binding',permit->'binding');
end;
$$;

CREATE OR REPLACE FUNCTION "public"."lock_booking_request_capture_source"("target_booking_request_id" "uuid") RETURNS TABLE("work" "public"."booking_request_capture_work", "payment_snapshot" "jsonb", "binding" "jsonb", "ledger" "public"."payment_provider_operations")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare target_request public.booking_requests;
declare target_attempt public.booking_request_submission_attempts;
declare target_claim public.booking_request_authorization_claims;
declare authorization_identity public.booking_request_provider_operation_identities;
declare expected_fingerprint text;
declare expected_authorization jsonb;
declare expected_movement jsonb;
begin
  select * into target_request from public.booking_requests requests
  where requests.id = target_booking_request_id for update of requests;
  select * into work from public.booking_request_capture_work capture_work
  where capture_work.booking_request_id = target_booking_request_id for update of capture_work;
  if work.booking_request_id is null then return; end if;
  select * into target_attempt from public.booking_request_submission_attempts attempts
  where attempts.id = work.attempt_id for update of attempts;
  select * into target_claim from public.booking_request_authorization_claims claims
  where claims.id = work.authorization_claim_id for update of claims;
  expected_fingerprint := encode(
    extensions.digest(
      convert_to(
        '{"provider":{"provider":' || to_json(work.provider)::text
        || ',"environment":' || to_json(work.environment)::text
        || ',"merchantId":' || to_json(work.merchant_id)::text
        || ',"terminalId":' || to_json(work.terminal_id)::text
        || '},"kind":"capture","paymentLifecycleId":'
        || to_json(work.payment_lifecycle_id::text)::text
        || ',"logicalOperationId":'
        || to_json(work.capture_logical_operation_id)::text
        || ',"attemptId":' || to_json(work.capture_physical_attempt_id)::text
        || ',"amountFils":' || work.amount_fils::text
        || ',"currency":"IQD"}',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if target_request.id is null
    or target_request.status <> 'accepted'
    or target_request.payment_lifecycle_id <> work.payment_lifecycle_id
    or target_attempt.id is null
    or target_attempt.state <> 'finalized'
    or target_attempt.booking_request_id is distinct from target_request.id
    or target_attempt.payment_lifecycle_id <> work.payment_lifecycle_id
    or target_attempt.authorization_provider is distinct from work.provider
    or target_attempt.authorization_environment is distinct from work.environment
    or target_attempt.authorization_merchant_id is distinct from work.merchant_id
    or target_attempt.authorization_terminal_id is distinct from work.terminal_id
    or target_attempt.payment_snapshot ->> 'paymentLifecycleId'
      is distinct from work.payment_lifecycle_id::text
    or target_attempt.payment_snapshot -> 'authorization' ->> 'paymentLifecycleId'
      is distinct from work.payment_lifecycle_id::text
    or target_attempt.payment_snapshot -> 'authorization' ->> 'kind'
      is distinct from 'authorization'
    or target_attempt.payment_snapshot -> 'authorization' ->> 'status'
      is distinct from 'succeeded'
    or target_attempt.payment_snapshot -> 'authorization' ->> 'logicalOperationId'
      is distinct from work.authorization_logical_operation_id
    or target_attempt.payment_snapshot -> 'authorization' ->> 'attemptId'
      is distinct from work.authorization_physical_attempt_id
    or (target_attempt.payment_snapshot -> 'authorization' ->> 'amountFils')::bigint
      is distinct from work.amount_fils
    or target_attempt.authorization_provider_request_id is null
    or target_attempt.authorization_provider_reference is null
    or target_attempt.authorization_movement_reference is null
    or target_attempt.payment_snapshot -> 'authorization'
      ->> 'providerRequestId'
      is distinct from target_attempt.authorization_provider_request_id
    or target_attempt.payment_snapshot -> 'authorization'
      ->> 'providerReference'
      is distinct from target_attempt.authorization_provider_reference
    or target_attempt.payment_snapshot -> 'authorization'
      ->> 'movementReference'
      is distinct from target_attempt.authorization_movement_reference
    or target_attempt.payment_snapshot -> 'release'
      is distinct from 'null'::jsonb
    or target_claim.id is null
    or target_claim.attempt_id <> target_attempt.id
    or target_claim.generation <> work.authorization_claim_generation
    or target_claim.state <> 'converted'
    or target_claim.payment_lifecycle_id <> work.payment_lifecycle_id
    or target_claim.logical_operation_id
      <> work.authorization_logical_operation_id
    or target_claim.physical_attempt_id
      <> work.authorization_physical_attempt_id
    or target_claim.amount_fils <> work.amount_fils
    or target_claim.currency <> work.currency
    or target_claim.provider <> work.provider
    or target_claim.environment <> work.environment
    or target_claim.merchant_id <> work.merchant_id
    or target_claim.terminal_id <> work.terminal_id
    or work.capture_logical_operation_id
      <> work.payment_lifecycle_id::text || ':capture'
    or work.capture_physical_attempt_id
      <> work.capture_logical_operation_id || ':attempt-2'
    or work.capture_logical_operation_id = work.authorization_logical_operation_id
    or work.capture_physical_attempt_id = work.authorization_physical_attempt_id
    or work.provider_idempotency_key
      <> 'booking-request-capture:' || work.booking_request_id::text
        || ':' || work.authorization_claim_generation::text
    or work.request_fingerprint <> expected_fingerprint then
    raise exception 'Booking Request capture-work binding is invalid'
      using errcode = 'RC409';
  end if;

  select * into ledger from public.payment_provider_operations operations
  where operations.provider = work.provider and operations.environment = work.environment
    and operations.merchant_id = work.merchant_id and operations.terminal_id = work.terminal_id
    and operations.provider_idempotency_key = work.provider_idempotency_key
  for update of operations;
  -- The held submission-attempt lock serializes normalized Authorization writes.
  select * into authorization_identity from public.booking_request_provider_operation_identities identities
  where identities.attempt_id = target_attempt.id and identities.operation_kind = 'authorization';
  expected_authorization := jsonb_build_object(
    'paymentLifecycleId', work.payment_lifecycle_id, 'kind', 'authorization',
    'logicalOperationId', work.authorization_logical_operation_id,
    'attemptId', work.authorization_physical_attempt_id, 'status', 'succeeded',
    'amountFils', work.amount_fils,
    'providerRequestId', target_attempt.authorization_provider_request_id,
    'providerReference', target_attempt.authorization_provider_reference,
    'movementReference', target_attempt.authorization_movement_reference,
    'reconciliationRequired', false, 'retrySafe', false
  );
  expected_movement := jsonb_build_object(
    'kind', 'authorization', 'logicalOperationId', work.authorization_logical_operation_id,
    'attemptId', work.authorization_physical_attempt_id, 'amountFils', work.amount_fils,
    'movementReference', target_attempt.authorization_movement_reference,
    'recordedAt', target_attempt.payment_snapshot #>> '{movements,0,recordedAt}'
  );
  if target_attempt.payment_snapshot -> 'authorization' is distinct from expected_authorization
    or target_attempt.payment_snapshot #> '{movements,0}' is distinct from expected_movement
    or (target_attempt.payment_snapshot #>> '{movements,0,recordedAt}') is null
    or (target_attempt.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz is null
    or target_attempt.payment_snapshot ->> 'currency' is distinct from work.currency
    or (target_attempt.payment_snapshot ->> 'customerTotalFils')::bigint is distinct from work.amount_fils
    or authorization_identity.attempt_id is null
    or (authorization_identity.provider, authorization_identity.environment,
      authorization_identity.merchant_id, authorization_identity.terminal_id,
      authorization_identity.provider_request_id, authorization_identity.provider_reference,
      authorization_identity.movement_reference) is distinct from
      (work.provider, work.environment, work.merchant_id, work.terminal_id,
       target_attempt.authorization_provider_request_id, target_attempt.authorization_provider_reference,
       target_attempt.authorization_movement_reference)
    or (work.state <> 'complete' and (
      target_attempt.payment_snapshot -> 'capture' is distinct from 'null'::jsonb
      or jsonb_array_length(target_attempt.payment_snapshot -> 'movements') <> 1
    )) then
    raise exception 'Booking Request capture Authorization evidence is invalid' using errcode = 'RC409';
  end if;
  payment_snapshot := target_attempt.payment_snapshot;
  binding := jsonb_build_object(
    'bookingRequestId', work.booking_request_id, 'submissionAttemptId', work.attempt_id,
    'authorizationClaimId', work.authorization_claim_id,
    'authorizationClaimGeneration', work.authorization_claim_generation,
    'paymentLifecycleId', work.payment_lifecycle_id,
    'authorizationLogicalOperationId', work.authorization_logical_operation_id,
    'authorizationPhysicalAttemptId', work.authorization_physical_attempt_id,
    'captureLogicalOperationId', work.capture_logical_operation_id,
    'capturePhysicalAttemptId', work.capture_physical_attempt_id,
    'amountFils', work.amount_fils, 'currency', work.currency,
    'providerIdentity', jsonb_build_object('provider', work.provider,
      'environment', work.environment, 'merchantId', work.merchant_id, 'terminalId', work.terminal_id),
    'idempotencyKey', work.provider_idempotency_key, 'requestFingerprint', work.request_fingerprint
  );
  if ledger.id is not null and (
    (ledger.claim_id, ledger.claim_generation, ledger.operation_kind,
      ledger.payment_lifecycle_id, ledger.logical_operation_id, ledger.physical_attempt_id,
      ledger.amount_fils, ledger.currency, ledger.request_fingerprint) is distinct from
      (work.authorization_claim_id, work.authorization_claim_generation, 'capture'::text,
      work.payment_lifecycle_id, work.capture_logical_operation_id, work.capture_physical_attempt_id,
      work.amount_fils, work.currency, work.request_fingerprint)
    or not (
      (ledger.current_outcome is null and ledger.evidence_provenance='admitted')
      or (ledger.current_outcome='not-executed')
      or (ledger.original_outcome = 'succeeded' and ledger.current_outcome = 'succeeded'
        and ledger.movement_reference is not null)
      or (ledger.original_outcome = 'failed' and ledger.current_outcome = 'failed'
        and ledger.movement_reference is null)
    )
    or ledger.capture_execution_permit - array['purpose', 'workId', 'leaseGeneration', 'leaseToken', 'notAfter']
      is distinct from binding
    or ledger.capture_execution_permit ->> 'purpose' is distinct from 'booking-request-capture'
    or ledger.capture_execution_permit ->> 'workId' is distinct from work.booking_request_id::text
  ) then
    raise exception 'Booking Request capture provider ledger is invalid' using errcode = 'RC409';
  end if;
  return next;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."observe_booking_request_payment_correction"("target_booking_request_id" "uuid", "target_provider_operation_id" "uuid", "target_receipt" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare work public.booking_request_capture_work;
declare ledger public.payment_provider_operations;
declare expected jsonb;
declare conflicting boolean;
declare observed_at timestamptz;
declare provider_result jsonb;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Payment observation unavailable' using errcode='42501'; end if;
  select * into work from public.booking_request_capture_work capture where capture.booking_request_id=target_booking_request_id;
  select * into ledger from public.payment_provider_operations operations where operations.id=target_provider_operation_id;
  if ledger.claim_id is distinct from work.authorization_claim_id then raise exception 'Payment observation source is invalid' using errcode='RC409'; end if;
  ledger:=public.lock_payment_observation_source(target_provider_operation_id,
    array['booking-request-capture','booking-request-payment-recovery','booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund']);
  select * into work from public.booking_request_capture_work capture where capture.booking_request_id=target_booking_request_id for update of capture;
  if work.payment_required_deadline is null or ledger.id is null or ledger.operation_kind not in ('capture','release','refund')
    or ledger.claim_id is distinct from work.authorization_claim_id then raise exception 'Payment observation source is invalid' using errcode='RC409'; end if;
  if target_receipt is null or jsonb_typeof(target_receipt)<>'object'
    or target_receipt ?& array['receiptId','bookingRequestId','providerOperationId','providerIdentity','paymentLifecycleId','logicalOperationId','physicalAttemptId','kind','amountFils','currency','providerRequestId','providerReference','movementReference','outcome','occurredAt'] is not true
    or target_receipt-array['receiptId','bookingRequestId','providerOperationId','providerIdentity','paymentLifecycleId','logicalOperationId','physicalAttemptId','kind','amountFils','currency','providerRequestId','providerReference','movementReference','outcome','occurredAt','evidence']<>'{}'
    or jsonb_typeof(target_receipt->'receiptId')<>'string' or length(target_receipt->>'receiptId') not between 1 and 200 then
    perform public.append_booking_request_payment_history(
      work.payment_lifecycle_id, work.booking_request_id,
      'receipt-observation', 'provider-receipt', 'observed',
      target_operation_kind => ledger.operation_kind,
      target_logical_operation_id => ledger.logical_operation_id,
      target_physical_attempt_id => ledger.physical_attempt_id,
      target_outcome => 'malformed',
      target_reason_code => 'malformed-provider-observation',
      target_provider_operation_id => ledger.id,
      target_provider_request_id => ledger.provider_request_id,
      target_provider_reference => ledger.provider_reference,
      target_movement_reference => ledger.movement_reference,
      target_amount_fils => ledger.amount_fils,
      target_received_at => clock_timestamp()
    );
    return public.quarantine_booking_request_payment(target_booking_request_id,'malformed-provider-observation'); end if;
  if exists(select 1 from public.booking_request_payment_correction_observations observations
    where observations.provider_operation_id=ledger.id and observations.receipt_identity=target_receipt->>'receiptId' and observations.payload=target_receipt) then
    perform public.append_booking_request_payment_history(
      work.payment_lifecycle_id, work.booking_request_id,
      'receipt-observation', 'provider-receipt', 'observed',
      target_operation_kind => ledger.operation_kind,
      target_logical_operation_id => ledger.logical_operation_id,
      target_physical_attempt_id => ledger.physical_attempt_id,
      target_outcome => 'duplicate',
      target_provider_operation_id => ledger.id,
      target_provider_request_id => ledger.provider_request_id,
      target_provider_reference => ledger.provider_reference,
      target_movement_reference => ledger.movement_reference,
      target_amount_fils => ledger.amount_fils,
      target_received_at => clock_timestamp()
    );
    return jsonb_build_object('status','duplicate'); end if;
  expected := jsonb_build_object('bookingRequestId',target_booking_request_id,'providerOperationId',ledger.id,
    'providerIdentity',jsonb_build_object('provider',ledger.provider,'environment',ledger.environment,'merchantId',ledger.merchant_id,'terminalId',ledger.terminal_id),
    'paymentLifecycleId',ledger.payment_lifecycle_id,'logicalOperationId',ledger.logical_operation_id,'physicalAttemptId',ledger.physical_attempt_id,
    'kind',ledger.operation_kind,'amountFils',ledger.amount_fils,'currency',ledger.currency,'providerRequestId',coalesce(ledger.provider_request_id,target_receipt->>'providerRequestId'),'providerReference',coalesce(ledger.provider_reference,target_receipt->>'providerReference'));
  conflicting := (ledger.claim_generation,ledger.amount_fils,ledger.currency,ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id)
      is distinct from (work.authorization_claim_generation,work.amount_fils,work.currency,work.provider,work.environment,work.merchant_id,work.terminal_id)
    or target_receipt-array['receiptId','movementReference','outcome','occurredAt','evidence'] is distinct from expected
    or target_receipt->>'outcome' not in ('succeeded','failed','indeterminate')
    or (ledger.current_outcome is null and not (target_receipt ? 'evidence'))
    or jsonb_typeof(target_receipt->'outcome') is distinct from 'string'
    or (ledger.current_outcome is not null and ledger.current_outcome<>'indeterminate' and target_receipt->>'outcome' is distinct from ledger.current_outcome)
    or (ledger.current_outcome is not null and target_receipt->>'outcome'<>'failed' and target_receipt->>'movementReference' is distinct from ledger.movement_reference)
    or (target_receipt->>'outcome'='failed' and target_receipt->'movementReference' is distinct from 'null'::jsonb)
    or exists(select 1 from public.booking_request_payment_correction_observations observations where observations.provider_operation_id=ledger.id
      and (observations.receipt_identity=target_receipt->>'receiptId' or observations.payload-'receiptId' is distinct from target_receipt-'receiptId'));
  begin
    observed_at := (target_receipt->>'occurredAt')::timestamptz;
    if (target_receipt->>'outcome'='indeterminate') is distinct from (observed_at is null)
      or not isfinite(observed_at) or observed_at > clock_timestamp() or (ledger.evidence_provenance<>'legacy-simulated' and observed_at < ledger.executed_at)
      or (ledger.authoritative_outcome_at is not null and ledger.authoritative_outcome_at is distinct from observed_at)
      then conflicting := true; end if;
  exception when invalid_datetime_format or datetime_field_overflow then conflicting:=true; end;
  if conflicting is false then
    begin
      provider_result:=jsonb_build_object('outcome',target_receipt->>'outcome','providerRequestId',target_receipt->>'providerRequestId','providerReference',target_receipt->>'providerReference',
          'evidence',coalesce(target_receipt->'evidence',jsonb_build_object('operationId',ledger.id,'eventId',target_receipt->>'receiptId',
            'provenance',ledger.evidence_provenance,'originalOutcome',ledger.original_outcome,'executedAt',ledger.executed_at,
            'occurredAt',observed_at,'closedAt',null)))
        ||case when target_receipt->>'outcome'='failed' then jsonb_build_object('retrySafe',false)
          else jsonb_build_object('movementReference',target_receipt->>'movementReference') end;
      perform public.validate_payment_provider_observation(provider_result,ledger.id);
      if (provider_result#>>'{evidence,occurredAt}')::timestamptz is distinct from observed_at then
        raise exception 'Correction occurrence conflicts with provider evidence' using errcode='RC409'; end if;
      case ledger.admission->>'purpose'
        when 'booking-request-payment-recovery' then perform public.record_booking_request_payment_recovery_observation(ledger.id,provider_result);
        when 'booking-request-capture' then perform public.record_booking_request_capture_observation(ledger.id,provider_result);
        else perform public.record_booking_request_payment_required_expiry_observation(ledger.id,provider_result);
      end case;
      select * into ledger from public.payment_provider_operations operations where operations.id=ledger.id;
    exception when sqlstate 'RC409' then conflicting:=true;
    end;
  end if;
  insert into public.booking_request_payment_correction_observations(booking_request_id,provider_operation_id,receipt_identity,payload,conflict)
    values(target_booking_request_id,ledger.id,target_receipt->>'receiptId',target_receipt,coalesce(conflicting,true));
  if conflicting is not false then return public.quarantine_booking_request_payment(target_booking_request_id,'conflicting-provider-observation'); end if;
  if target_receipt->>'outcome'='indeterminate' then return public.quarantine_booking_request_payment(target_booking_request_id,'unresolved-provider-observation'); end if;
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  if ledger.operation_kind in ('release','refund') and ledger.current_outcome='failed' then
    return public.quarantine_booking_request_payment(target_booking_request_id,'failed-'||ledger.operation_kind||'-observation'); end if;
  if ledger.operation_kind='capture' and ledger.current_outcome='succeeded' and observed_at >= work.payment_required_deadline then
    insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline)
      values(work.booking_request_id,work.payment_required_deadline) on conflict do nothing;
    perform public.invalidate_booking_request_payment_confirmation(work.booking_request_id,ledger.id,'late-capture');
  end if;
  return jsonb_build_object('status','recorded');
end;
$$;

CREATE OR REPLACE FUNCTION "public"."observe_booking_request_payment_history"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare current_row jsonb := to_jsonb(new);
declare prior_row jsonb := case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
declare lifecycle_id uuid;
declare request_id uuid;
declare source_name text;
declare event_kind text := 'state-transition';
declare operation_name text;
declare current_state text;
declare prior_state text;
declare current_outcome text;
declare prior_outcome text;
declare reason text;
declare source_time timestamptz;
declare occurrence_time timestamptz;
declare provider_row public.payment_provider_operations;
begin
  source_name := case tg_table_name
    when 'booking_request_authorization_claims' then 'authorization-claim'
    when 'payment_provider_operations' then 'provider-operation'
    when 'booking_request_release_work' then 'release-work'
    when 'booking_request_release_operations' then 'release-operation'
    when 'booking_request_capture_work' then 'capture-work'
    when 'booking_request_payment_recovery_attempts' then 'recovery-attempt'
    when 'booking_request_payment_recovery_operations' then 'recovery-operation'
    when 'booking_request_payment_required_expiry_work' then 'expiry-work'
    when 'booking_request_payment_required_expiry_operations' then 'expiry-operation'
    when 'booking_requests' then 'booking-request'
    when 'booking_confirmations' then 'confirmation'
    when 'booking_request_confirmation_invalidations' then 'confirmation-invalidation'
    when 'booking_request_payment_correction_observations' then 'provider-receipt'
  end;
  request_id := nullif(current_row->>'booking_request_id','')::uuid;
  lifecycle_id := nullif(coalesce(current_row->>'payment_lifecycle_id', current_row->>'authorization_payment_lifecycle_id'),'')::uuid;
  if tg_table_name='booking_requests' then
    request_id := (current_row->>'id')::uuid;
  elsif tg_table_name='payment_provider_operations' then
    select claims.payment_lifecycle_id into lifecycle_id from public.booking_request_authorization_claims claims where claims.id=(current_row->>'claim_id')::uuid;
  elsif tg_table_name='booking_request_release_work' then
    select attempts.payment_lifecycle_id into lifecycle_id from public.booking_request_submission_attempts attempts where attempts.id=(current_row->>'attempt_id')::uuid;
  elsif tg_table_name='booking_request_payment_recovery_operations' then
    select requests.id, requests.payment_lifecycle_id into request_id,lifecycle_id
      from public.booking_request_payment_recovery_attempts attempts join public.booking_requests requests on requests.id=attempts.booking_request_id
      where attempts.id=(current_row->>'recovery_attempt_id')::uuid;
  elsif tg_table_name='booking_request_payment_correction_observations' then
    select requests.payment_lifecycle_id into lifecycle_id from public.booking_requests requests where requests.id=request_id;
  end if;
  if request_id is null and lifecycle_id is not null then
    select requests.id into request_id from public.booking_requests requests where requests.payment_lifecycle_id=lifecycle_id;
  end if;
  if request_id is not null then
    select requests.payment_lifecycle_id into lifecycle_id from public.booking_requests requests where requests.id=request_id;
  end if;
  if lifecycle_id is null then raise exception 'Payment history source has no original lifecycle' using errcode='RC409'; end if;

  -- Admission alone has no execution or payment history. The first accepted
  -- executed observation records the physical attempt; later results retain its identity.
  if tg_table_name='payment_provider_operations' and current_row->>'current_outcome' is null then return new; end if;
  if tg_table_name='payment_provider_operations' and tg_op='UPDATE'
    and (current_row->>'current_outcome',current_row->>'authoritative_outcome_at',current_row->>'movement_reference')
      is not distinct from (prior_row->>'current_outcome',prior_row->>'authoritative_outcome_at',prior_row->>'movement_reference') then
    return new;
  end if;

  current_state := coalesce(current_row->>'state', current_row->>'status');
  prior_state := coalesce(prior_row->>'state', prior_row->>'status');
  current_outcome := coalesce(current_row->>'current_outcome', current_row->>'provider_outcome', current_row->>'outcome');
  prior_outcome := coalesce(prior_row->>'current_outcome', prior_row->>'provider_outcome', prior_row->>'outcome');
  operation_name := coalesce(current_row->>'operation_kind', current_row->>'step',
    case source_name when 'capture-work' then 'capture' when 'release-work' then 'release'
      when 'release-operation' then 'release' when 'authorization-claim' then 'authorization'
      when 'expiry-work' then 'expiry' when 'confirmation' then 'confirmation'
      when 'confirmation-invalidation' then 'invalidation' end);
  reason := coalesce(current_row->>'quarantine_reason', current_row->>'diagnostic_reason', current_row->>'reason', current_row->>'decline_reason');
  source_time := nullif(coalesce(current_row->>'completed_at',current_row->>'result_recorded_at',current_row->>'settled_at',current_row->>'invalidated_at',current_row->>'confirmed_at',current_row->>'updated_at',current_row->>'created_at'),'')::timestamptz;
  occurrence_time := nullif(current_row->>'authoritative_outcome_at','')::timestamptz;

  if tg_table_name='payment_provider_operations' then
    if (tg_op='INSERT' or prior_row->>'current_outcome' is null) and current_row->>'current_outcome'<>'not-executed' then event_kind:='physical-attempt';
    else prior_state:=prior_outcome; current_state:=current_outcome; end if;
  end if;
  if tg_table_name in ('booking_request_release_work','booking_request_capture_work') then event_kind:='logical-operation'; end if;
  if tg_table_name in ('booking_confirmations','booking_request_confirmation_invalidations') then event_kind:='terminal-outcome'; end if;
  if tg_table_name='booking_confirmations' then
    current_state := 'confirmed'; current_outcome := 'succeeded';
  elsif tg_table_name='booking_request_confirmation_invalidations' then
    current_state := 'invalidated';
  end if;
  if tg_op='UPDATE' and tg_table_name in ('booking_request_release_work','booking_request_capture_work')
    and (current_row->>'lease_generation')::bigint > (prior_row->>'lease_generation')::bigint
    and (prior_row->>'lease_generation')::bigint > 0 then
    event_kind := 'retry';
  end if;
  if tg_table_name='booking_request_payment_correction_observations' then
    select * into strict provider_row from public.payment_provider_operations where id=(current_row->>'provider_operation_id')::uuid;
    operation_name := provider_row.operation_kind;
    current_row := current_row || jsonb_build_object('logical_operation_id',provider_row.logical_operation_id,
      'physical_attempt_id',provider_row.physical_attempt_id,'provider_request_id',provider_row.provider_request_id,
      'provider_reference',provider_row.provider_reference,'movement_reference',provider_row.movement_reference,
      'amount_fils',provider_row.amount_fils);
    event_kind := 'receipt-observation';
    current_outcome := case when (current_row->>'conflict')::boolean then 'conflicting' else current_row#>>'{payload,outcome}' end;
    reason := case when (current_row->>'conflict')::boolean then 'conflicting-provider-observation' end;
    occurrence_time := case when not (current_row->>'conflict')::boolean and current_row#>>'{payload,occurredAt}' is not null then (current_row#>>'{payload,occurredAt}')::timestamptz end;
  end if;
  if coalesce(current_state,'') in ('quarantined','blocked') then event_kind:='quarantine'; end if;
  if tg_op='UPDATE' and tg_table_name<>'payment_provider_operations'
    and (current_state,current_outcome,reason,current_row->>'lease_generation',current_row->>'generation',current_row->>'provider_operation_id')
    is not distinct from (prior_state,prior_outcome,coalesce(prior_row->>'quarantine_reason',prior_row->>'diagnostic_reason',prior_row->>'reason',prior_row->>'decline_reason'),prior_row->>'lease_generation',prior_row->>'generation',prior_row->>'provider_operation_id') then
    return new;
  end if;
  perform public.append_booking_request_payment_history(
    lifecycle_id, request_id, event_kind, source_name, 'observed', operation_name,
    coalesce(current_row->>'logical_operation_id',current_row->>'release_logical_operation_id',current_row->>'capture_logical_operation_id'),
    coalesce(current_row->>'physical_attempt_id',current_row->>'release_physical_attempt_id',current_row->>'capture_physical_attempt_id'),
    nullif(coalesce(current_row->>'operation_generation',current_row->>'lease_generation',
      case when tg_table_name='booking_request_authorization_claims' then current_row->>'generation' end),'')::bigint,
    case when tg_table_name='booking_request_payment_recovery_attempts' then nullif(current_row->>'generation','')::bigint end,
    prior_state, current_state, current_outcome, reason,
    nullif(coalesce(current_row->>'provider_operation_id',case when tg_table_name='payment_provider_operations' then current_row->>'id' end),'')::uuid,
    current_row->>'provider_request_id',current_row->>'provider_reference',current_row->>'movement_reference',
    nullif(current_row->>'amount_fils','')::bigint,occurrence_time,
    nullif(current_row->>'received_at','')::timestamptz,source_time
  );
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."prepare_booking_request_corrective_refund"("target_booking_request_id" "uuid", "target_capture_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record;
declare expiry public.booking_request_payment_required_expiry_work;
declare capture public.payment_provider_operations;
declare authorization_ledger public.payment_provider_operations;
declare recovery public.booking_request_payment_recovery_attempts;
declare logical_id text;
declare authorization_logical text;
declare authorization_physical text;
declare predecessor text;
declare predecessor_at timestamptz;
begin
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  select * into expiry from public.booking_request_payment_required_expiry_work work where work.booking_request_id=target_booking_request_id for update of work;
  select * into capture from public.payment_provider_operations ledger where ledger.id=target_capture_id for update of ledger;
  if capture.operation_kind is distinct from 'capture' or capture.current_outcome is distinct from 'succeeded'
    or capture.authoritative_outcome_at is null or capture.authoritative_outcome_at < (source.work).payment_required_deadline
    or capture.original_outcome='failed' or capture.amount_fils<>(source.work).amount_fils
    or capture.currency<>(source.work).currency or capture.claim_id<>(source.work).authorization_claim_id
    or capture.recorded_at is null or capture.movement_reference is null then
    raise exception 'Corrective capture evidence is invalid' using errcode='RC409'; end if;
  if capture.payment_lifecycle_id=(source.work).payment_lifecycle_id then
    authorization_logical := (source.work).authorization_logical_operation_id;
    authorization_physical := (source.work).authorization_physical_attempt_id;
    predecessor := source.payment_snapshot#>>'{authorization,movementReference}';
    predecessor_at := (source.payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz;
  else
    select * into recovery from public.booking_request_payment_recovery_attempts attempts where attempts.id=capture.recovery_attempt_id and attempts.booking_request_id=target_booking_request_id;
    select ledger.* into authorization_ledger from public.booking_request_payment_recovery_operations operations
      join public.payment_provider_operations ledger on ledger.id=operations.provider_operation_id
      where operations.recovery_attempt_id=recovery.id and operations.step='replacement-authorization';
    if authorization_ledger.current_outcome is distinct from 'succeeded' or authorization_ledger.authoritative_outcome_at is null then
      raise exception 'Corrective authorization evidence is invalid' using errcode='RC409'; end if;
    authorization_logical:=authorization_ledger.logical_operation_id; authorization_physical:=authorization_ledger.physical_attempt_id;
    predecessor:=authorization_ledger.movement_reference; predecessor_at:=authorization_ledger.authoritative_outcome_at;
  end if;
  logical_id:=expiry.id::text||':corrective-refund:'||capture.id::text;
  insert into public.booking_request_payment_required_expiry_operations(
    expiry_work_id,booking_request_id,owner,authorization_claim_id,authorization_claim_generation,authorization_payment_lifecycle_id,
    authorization_logical_operation_id,authorization_physical_attempt_id,predecessor_movement_reference,predecessor_outcome_at,
    release_logical_operation_id,release_physical_attempt_id,provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
    request_fingerprint,operation_kind,capture_provider_operation_id,capture_occurred_at)
  values(expiry.id,target_booking_request_id,'expiry',(source.work).authorization_claim_id,(source.work).authorization_claim_generation,
    capture.payment_lifecycle_id,authorization_logical,authorization_physical,predecessor,predecessor_at,
    logical_id,logical_id||':1',logical_id||':1',(source.work).amount_fils,(source.work).currency,(source.work).provider,(source.work).environment,
    (source.work).merchant_id,(source.work).terminal_id,(source.work).request_fingerprint,'refund',capture.id,capture.authoritative_outcome_at)
    on conflict do nothing;
  if not exists(select 1 from public.booking_request_payment_required_expiry_operations operations
    where operations.expiry_work_id=expiry.id and operations.capture_provider_operation_id=capture.id and operations.operation_kind='refund') then
    raise exception 'Captured authorization has conflicting release ownership' using errcode='RC409'; end if;
  perform public.invalidate_booking_request_payment_confirmation(target_booking_request_id,capture.id,'late-capture');
end;
$$;

CREATE OR REPLACE FUNCTION "public"."prepare_booking_request_payment_required_expiry"("target_booking_request_id" "uuid", "target_provider_identity" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record;
declare expiry public.booking_request_payment_required_expiry_work;
declare recovery record;
declare recovery_attempt public.booking_request_payment_recovery_attempts;
declare release_operation public.booking_request_payment_recovery_operations;
declare release_ledger public.payment_provider_operations;
declare authorization_ledger public.payment_provider_operations;
declare expected_permit jsonb;
declare unresolved_reason text;
declare target public.booking_request_payment_required_expiry_operations;
declare instruction jsonb;
declare request public.booking_requests;
declare capture_work public.booking_request_capture_work;
declare captured record;
begin
  if current_setting('role',true) <> 'service_role' or target_booking_request_id is null then
    raise exception 'Payment Required expiry preparation is unavailable' using errcode='42501';
  end if;
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  if public.booking_request_payment_required_expiry_completed(target_booking_request_id) then
    return jsonb_build_object('status','expired','bookingRequestId',target_booking_request_id);
  end if;
  select * into request from public.booking_requests requests where requests.id=target_booking_request_id;
  select * into capture_work from public.booking_request_capture_work work where work.booking_request_id=target_booking_request_id;
  if request.status is distinct from 'accepted' or capture_work.state is distinct from 'payment_required'
    or public.booking_request_payment_required_expiry_provider_matches(capture_work,target_provider_identity) is not true then
    raise exception 'Payment Required expiry source is invalid' using errcode='RC409'; end if;
  begin
    select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  exception when sqlstate 'RC409' or invalid_text_representation or numeric_value_out_of_range then
    if clock_timestamp() < capture_work.payment_required_deadline then
      return jsonb_build_object('status','not-due'); end if;
    insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline,
      state,diagnostic_reason) values(target_booking_request_id,capture_work.payment_required_deadline,
        'attention_required','source-evidence-invalid')
      on conflict(booking_request_id) do update set state='attention_required',
        diagnostic_reason='source-evidence-invalid',last_evaluated_at=clock_timestamp();
    return public.quarantine_booking_request_payment(target_booking_request_id,'source-evidence-invalid');
  end;
  if not found or (source.work).state <> 'payment_required'
    or not public.booking_request_payment_required_expiry_provider_matches(source.work,target_provider_identity) then
    raise exception 'Payment Required expiry source is invalid' using errcode='RC409';
  end if;
  for captured in select operations.* from public.payment_provider_operations operations
    where operations.claim_id=(source.work).authorization_claim_id and operations.current_outcome is null
      and operations.admission->>'purpose' in ('booking-request-payment-recovery','booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund')
    order by operations.created_at,operations.id for update of operations
  loop
    expected_permit:=captured.admission->'permit';
    return jsonb_build_object('status',case when captured.admission->>'purpose'='booking-request-payment-recovery' then 'reconcile-recovery' else 'reconcile-expiry' end,
      'permit',expected_permit,'binding',expected_permit->'binding','providerRequestId',null,'providerReference',null);
  end loop;
  for captured in select ledger.* from public.payment_provider_operations ledger
    where ledger.claim_id=(source.work).authorization_claim_id and ledger.operation_kind='capture' and ledger.current_outcome='succeeded'
    order by ledger.created_at,ledger.id
  loop
    if captured.authoritative_outcome_at is null then
      return public.quarantine_booking_request_payment(target_booking_request_id,'capture-occurrence-unknown');
    elsif captured.authoritative_outcome_at >= (source.work).payment_required_deadline then
      insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline)
        values(target_booking_request_id,(source.work).payment_required_deadline) on conflict do nothing;
      perform public.invalidate_booking_request_payment_confirmation(target_booking_request_id,captured.id,'late-capture');
    end if;
  end loop;
  if exists(select 1 from public.booking_confirmations confirmations
    where confirmations.booking_request_id=target_booking_request_id and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=target_booking_request_id)) then
    return jsonb_build_object('status','confirmed');
  end if;
  if clock_timestamp() < (source.work).payment_required_deadline then
    return jsonb_build_object('status','not-due','deadline',
      to_char((source.work).payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;
  insert into public.booking_request_payment_required_expiry_work(
    booking_request_id,payment_required_deadline
  ) values(target_booking_request_id,(source.work).payment_required_deadline)
  on conflict(booking_request_id) do nothing;
  select * into expiry from public.booking_request_payment_required_expiry_work work
    where work.booking_request_id=target_booking_request_id for update of work;
  if expiry.payment_required_deadline is distinct from (source.work).payment_required_deadline then
    raise exception 'Payment Required expiry deadline binding is invalid' using errcode='RC409';
  end if;
  if expiry.state='complete' then
    return jsonb_build_object('status','expired','expiryWorkId',expiry.id);
  end if;

  if (source.ledger).current_outcome='succeeded' and (source.ledger).original_outcome<>'failed'
    and (source.ledger).authoritative_outcome_at >= (source.work).payment_required_deadline then
    perform public.prepare_booking_request_corrective_refund(target_booking_request_id,(source.ledger).id);
  elsif (source.ledger).id is null or (source.ledger).operation_kind <> 'capture'
    or (source.ledger).current_outcome <> 'failed'
    or (source.ledger).movement_reference is not null
    or (source.ledger).original_outcome <> 'failed' then
    unresolved_reason := 'original-capture-unresolved';
  end if;

  if unresolved_reason is null then
    for recovery in
      select attempts as attempt,operations as operation
      from public.booking_request_payment_recovery_attempts attempts
      join public.booking_request_payment_recovery_operations operations
        on operations.recovery_attempt_id=attempts.id
      where attempts.booking_request_id=target_booking_request_id
      order by attempts.generation,
        case operations.step when 'original-release' then 1
          when 'replacement-authorization' then 2 when 'replacement-capture' then 3 else 4 end
    loop
      begin
        expected_permit := public.booking_request_recovery_execution_permit(
          recovery.attempt,source.work,source.payment_snapshot,(recovery.operation).step
        );
        perform public.validate_booking_request_recovery_operation(
          recovery.operation,expected_permit
        );
      exception when sqlstate 'RC409' then
        unresolved_reason := 'recovery-evidence-invalid';
      end;
      exit when unresolved_reason is not null;
    end loop;
  end if;

  if unresolved_reason is null and exists(
    select 1
    from public.payment_provider_operations ledger
    join public.booking_request_payment_recovery_attempts attempts
      on attempts.id=ledger.recovery_attempt_id
    where attempts.booking_request_id=target_booking_request_id
      and not exists(
        select 1 from public.booking_request_payment_recovery_operations operations
        where operations.provider_operation_id=ledger.id
          and operations.recovery_attempt_id=attempts.id
      )
  ) then unresolved_reason := 'unexplained-recovery-provider-operation'; end if;

  if unresolved_reason is null and exists(
    select 1 from public.booking_request_payment_recovery_operations operations
    join public.booking_request_payment_recovery_attempts attempts
      on attempts.id=operations.recovery_attempt_id
    where attempts.booking_request_id=target_booking_request_id
      and operations.step in ('replacement-authorization','replacement-capture')
      and operations.outcome='indeterminate'
  ) then unresolved_reason := 'recovery-operation-indeterminate'; end if;

  if unresolved_reason is null then
    for captured in select ledger.* from public.booking_request_payment_recovery_operations operations
      join public.booking_request_payment_recovery_attempts attempts on attempts.id=operations.recovery_attempt_id
      join public.payment_provider_operations ledger on ledger.id=operations.provider_operation_id
      where attempts.booking_request_id=target_booking_request_id and operations.step='replacement-capture' and ledger.current_outcome='succeeded'
      order by attempts.generation,ledger.id
    loop
      if captured.authoritative_outcome_at is null then unresolved_reason:='capture-occurrence-unknown'; exit;
      elsif captured.authoritative_outcome_at < (source.work).payment_required_deadline then
        return jsonb_build_object('status','processing');
      else
        begin perform public.prepare_booking_request_corrective_refund(target_booking_request_id,captured.id);
        exception when sqlstate 'RC409' then unresolved_reason:='corrective-capture-invalid'; end;
      end if;
    end loop;
  end if;

  if unresolved_reason is null and exists(
    select 1 from public.payment_provider_operations ledger
    where (ledger.claim_id=(source.work).authorization_claim_id
      or ledger.payment_lifecycle_id=(source.work).payment_lifecycle_id
      or exists(select 1 from public.booking_request_payment_recovery_attempts attempts
        where attempts.booking_request_id=target_booking_request_id and attempts.id=ledger.payment_lifecycle_id))
      and ledger.id is distinct from (source.ledger).id
      and not exists(select 1 from public.booking_request_payment_recovery_operations operations
        join public.booking_request_payment_recovery_attempts attempts on attempts.id=operations.recovery_attempt_id
        where attempts.booking_request_id=target_booking_request_id and operations.provider_operation_id=ledger.id)
      and ledger.current_outcome is distinct from 'not-executed'
      and ledger.operation_kind in ('authorization','capture','release','refund','settlement')
      and not exists(select 1 from public.booking_request_payment_required_expiry_operations owned
        where owned.expiry_work_id=expiry.id and owned.provider_operation_id=ledger.id)
      and not (ledger.operation_kind='authorization'
        and (ledger.payment_lifecycle_id,ledger.logical_operation_id,ledger.physical_attempt_id,
          ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,
          ledger.amount_fils,ledger.currency,ledger.provider_request_id,ledger.provider_reference,ledger.movement_reference)
          is not distinct from
        ((source.work).payment_lifecycle_id,(source.work).authorization_logical_operation_id,
          (source.work).authorization_physical_attempt_id,(source.work).provider,(source.work).environment,
          (source.work).merchant_id,(source.work).terminal_id,(source.work).amount_fils,(source.work).currency,
          source.payment_snapshot#>>'{authorization,providerRequestId}',
          source.payment_snapshot#>>'{authorization,providerReference}',
          source.payment_snapshot#>>'{authorization,movementReference}')
        and ledger.current_outcome='succeeded' and ledger.original_outcome in ('succeeded','indeterminate')
        and ledger.recorded_at is not null)
  ) then unresolved_reason := 'unexplained-provider-operation'; end if;

  if unresolved_reason is null and not exists(select 1 from public.booking_request_payment_required_expiry_operations owned
    where owned.expiry_work_id=expiry.id and owned.authorization_payment_lifecycle_id=(source.work).payment_lifecycle_id and owned.operation_kind='refund') then
    select operations.* into release_operation
    from public.booking_request_payment_recovery_operations operations
    join public.booking_request_payment_recovery_attempts attempts
      on attempts.id=operations.recovery_attempt_id
    where attempts.booking_request_id=target_booking_request_id
      and operations.step='original-release'
    order by attempts.generation limit 1;
    if release_operation.id is not null then
      select * into recovery_attempt
      from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=release_operation.recovery_attempt_id;
      expected_permit := public.booking_request_recovery_execution_permit(
        recovery_attempt,source.work,source.payment_snapshot,'original-release'
      );
      release_ledger := public.validate_booking_request_recovery_operation(
        release_operation,expected_permit
      );
      insert into public.booking_request_payment_required_expiry_operations(
        expiry_work_id,booking_request_id,owner,recovery_operation_id,provider_operation_id,
        authorization_claim_id,authorization_claim_generation,
        authorization_payment_lifecycle_id,authorization_logical_operation_id,
        authorization_physical_attempt_id,predecessor_movement_reference,
        predecessor_outcome_at,release_logical_operation_id,release_physical_attempt_id,
        provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
        request_fingerprint
      ) values(expiry.id,target_booking_request_id,'recovery',release_operation.id,release_ledger.id,
        (source.work).authorization_claim_id,(source.work).authorization_claim_generation,
        (source.work).payment_lifecycle_id,(source.work).authorization_logical_operation_id,
        (source.work).authorization_physical_attempt_id,
        source.payment_snapshot#>>'{authorization,movementReference}',
        (source.payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz,
        release_ledger.logical_operation_id,release_ledger.physical_attempt_id,
        release_ledger.provider_idempotency_key,(source.work).amount_fils,(source.work).currency,
        (source.work).provider,(source.work).environment,(source.work).merchant_id,
        (source.work).terminal_id,(source.work).request_fingerprint)
      on conflict do nothing;
      if release_ledger.current_outcome <> 'succeeded' then
        unresolved_reason := case when release_ledger.current_outcome='indeterminate'
          then 'original-release-indeterminate' else 'original-release-failed' end;
      end if;
    else
      insert into public.booking_request_payment_required_expiry_operations(
        expiry_work_id,booking_request_id,owner,
        authorization_claim_id,authorization_claim_generation,
        authorization_payment_lifecycle_id,authorization_logical_operation_id,
        authorization_physical_attempt_id,predecessor_movement_reference,
        predecessor_outcome_at,release_logical_operation_id,release_physical_attempt_id,
        provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
        request_fingerprint
      ) values(
        expiry.id,target_booking_request_id,'expiry',(source.work).authorization_claim_id,
        (source.work).authorization_claim_generation,(source.work).payment_lifecycle_id,
        (source.work).authorization_logical_operation_id,(source.work).authorization_physical_attempt_id,
        source.payment_snapshot#>>'{authorization,movementReference}',
        (source.payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz,
        expiry.id::text||':original-release',expiry.id::text||':original-release:1',
        expiry.id::text||':original-release:1',(source.work).amount_fils,(source.work).currency,
        (source.work).provider,(source.work).environment,(source.work).merchant_id,(source.work).terminal_id,
        (source.work).request_fingerprint
      ) on conflict do nothing;
    end if;
  end if;

  if unresolved_reason is null then
    for recovery in
      select attempts as attempt,operations as operation
      from public.booking_request_payment_recovery_attempts attempts
      join public.booking_request_payment_recovery_operations operations
        on operations.recovery_attempt_id=attempts.id
      where attempts.booking_request_id=target_booking_request_id
        and operations.step='replacement-authorization'
        and operations.outcome='succeeded'
        and not exists(select 1 from public.booking_request_payment_required_expiry_operations owned where owned.expiry_work_id=expiry.id and owned.authorization_payment_lifecycle_id=attempts.id and owned.operation_kind='refund')
      order by attempts.generation
    loop
      expected_permit := public.booking_request_recovery_execution_permit(
        recovery.attempt,source.work,source.payment_snapshot,'replacement-authorization'
      );
      authorization_ledger := public.validate_booking_request_recovery_operation(
        recovery.operation,expected_permit
      );
      if authorization_ledger.current_outcome <> 'succeeded' then
        unresolved_reason := 'replacement-authorization-invalid';
        exit;
      end if;
      select operations.* into release_operation
      from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=(recovery.attempt).id
        and operations.step='replacement-release';
      if release_operation.id is not null then
        expected_permit := public.booking_request_recovery_execution_permit(
          recovery.attempt,source.work,source.payment_snapshot,'replacement-release'
        );
        release_ledger := public.validate_booking_request_recovery_operation(
          release_operation,expected_permit
        );
        insert into public.booking_request_payment_required_expiry_operations(
          expiry_work_id,booking_request_id,owner,recovery_operation_id,provider_operation_id,
          authorization_claim_id,authorization_claim_generation,
          authorization_payment_lifecycle_id,authorization_logical_operation_id,
          authorization_physical_attempt_id,predecessor_movement_reference,
          predecessor_outcome_at,release_logical_operation_id,release_physical_attempt_id,
          provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
          request_fingerprint
        ) values(expiry.id,target_booking_request_id,'recovery',release_operation.id,release_ledger.id,
          authorization_ledger.claim_id,authorization_ledger.claim_generation,
          authorization_ledger.payment_lifecycle_id,authorization_ledger.logical_operation_id,
          authorization_ledger.physical_attempt_id,authorization_ledger.movement_reference,
          authorization_ledger.authoritative_outcome_at,release_ledger.logical_operation_id,
          release_ledger.physical_attempt_id,release_ledger.provider_idempotency_key,
          authorization_ledger.amount_fils,authorization_ledger.currency,
          authorization_ledger.provider,authorization_ledger.environment,
          authorization_ledger.merchant_id,authorization_ledger.terminal_id,
          authorization_ledger.request_fingerprint)
        on conflict do nothing;
        if release_ledger.current_outcome <> 'succeeded' then
          unresolved_reason := case when release_ledger.current_outcome='indeterminate'
            then 'replacement-release-indeterminate' else 'replacement-release-failed' end;
          exit;
        end if;
      else
        insert into public.booking_request_payment_required_expiry_operations(
          expiry_work_id,booking_request_id,owner,
          authorization_claim_id,authorization_claim_generation,
          authorization_payment_lifecycle_id,authorization_logical_operation_id,
          authorization_physical_attempt_id,predecessor_movement_reference,
          predecessor_outcome_at,release_logical_operation_id,release_physical_attempt_id,
          provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
          request_fingerprint
        ) values(expiry.id,target_booking_request_id,'expiry',authorization_ledger.claim_id,
          authorization_ledger.claim_generation,authorization_ledger.payment_lifecycle_id,
          authorization_ledger.logical_operation_id,authorization_ledger.physical_attempt_id,
          authorization_ledger.movement_reference,authorization_ledger.authoritative_outcome_at,
          expiry.id::text||':replacement-release:'||(recovery.attempt).generation::text,
          expiry.id::text||':replacement-release:'||(recovery.attempt).generation::text||':1',
          expiry.id::text||':replacement-release:'||(recovery.attempt).generation::text||':1',
          authorization_ledger.amount_fils,authorization_ledger.currency,
          authorization_ledger.provider,authorization_ledger.environment,
          authorization_ledger.merchant_id,authorization_ledger.terminal_id,
          authorization_ledger.request_fingerprint)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  if unresolved_reason is null then
    for target in select operations.* from public.booking_request_payment_required_expiry_operations operations
      where operations.expiry_work_id=expiry.id order by operations.created_at,operations.id
    loop
      begin
        release_ledger := public.validate_booking_request_payment_required_expiry_target(target,source.work,source.payment_snapshot);
      exception when sqlstate 'RC409' then unresolved_reason := 'expiry-evidence-invalid'; end;
      exit when unresolved_reason is not null;
      if release_ledger.id is null then
        if instruction is null then
          expected_permit := public.booking_request_payment_required_expiry_permit(target,expiry.payment_required_deadline);
          instruction := jsonb_build_object('status',case target.operation_kind when 'refund' then 'refund' else 'release' end,'permit',expected_permit,'binding',expected_permit->'binding');
        end if;
      elsif release_ledger.current_outcome='failed' then
        unresolved_reason := 'expiry-release-failed'; exit;
      elsif release_ledger.current_outcome='indeterminate' then
        unresolved_reason := 'expiry-release-indeterminate';
        exit;
      end if;
    end loop;
  end if;
  if unresolved_reason is not null then
    return public.quarantine_booking_request_payment(target_booking_request_id,unresolved_reason);
  end if;
  update public.booking_request_payment_required_expiry_work set state='processing',diagnostic_reason=null,last_evaluated_at=clock_timestamp()
    where id=expiry.id;
  return coalesce(instruction,jsonb_build_object('status','ready'));

end;
$$;

CREATE OR REPLACE FUNCTION "public"."quarantine_booking_request_payment"("target_booking_request_id" "uuid", "target_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare work public.booking_request_capture_work;
declare capture_id uuid;
begin
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  select * into work from public.booking_request_capture_work capture where capture.booking_request_id=target_booking_request_id for update of capture;
  if work.payment_required_deadline is null then raise exception 'Payment Required quarantine source is invalid' using errcode='RC409'; end if;
  insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline)
    values(target_booking_request_id,work.payment_required_deadline) on conflict do nothing;
  update public.booking_request_payment_required_expiry_work set state='quarantined',diagnostic_reason=target_reason,last_evaluated_at=clock_timestamp()
    where booking_request_id=target_booking_request_id;
  select ledger.id into capture_id from public.payment_provider_operations ledger
    where ledger.claim_id=work.authorization_claim_id and ledger.operation_kind='capture' order by exists(select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id=target_booking_request_id and confirmations.capture_operation_id=ledger.id) desc,ledger.created_at desc,ledger.id limit 1;
  if capture_id is not null then perform public.invalidate_booking_request_payment_confirmation(target_booking_request_id,capture_id,'conflicting-evidence'); end if;
  return jsonb_build_object('status','quarantined');
end;
$$;

CREATE OR REPLACE FUNCTION "public"."record_booking_request_capture_failure"("target_booking_request_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_provider_result" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record;
declare target_request public.booking_requests;
declare work public.booking_request_capture_work;
declare target_attempt public.booking_request_submission_attempts;
declare target_claim public.booking_request_authorization_claims;
declare ledger public.payment_provider_operations;
declare target_commitment public.cottage_booking_period_commitments;
declare recorded_at timestamptz;
begin
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  if not found then raise exception 'Booking Request definitive Capture failure evidence is invalid' using errcode='RC409'; end if;
  work := source.work;
  ledger := source.ledger;
  select * into target_request from public.booking_requests requests
  where requests.id = target_booking_request_id;
  select * into target_attempt from public.booking_request_submission_attempts attempts
  where attempts.id = work.attempt_id;
  select * into target_claim from public.booking_request_authorization_claims claims
  where claims.id = work.authorization_claim_id;
  select * into target_commitment from public.cottage_booking_period_commitments commitments
  where commitments.id = target_request.booking_period_commitment_id for update of commitments;
  perform 1 from public.cottage_inventory_commitments inventory
  where inventory.booking_period_commitment_id = target_commitment.id
  order by inventory.service_day, inventory.unit_kind, inventory.unit_id for update of inventory;
  perform 1 from public.cottage_booking_period_occupancies occupancies
  where occupancies.booking_period_commitment_id = target_commitment.id
  order by occupancies.service_day, occupancies.shift_id for update of occupancies;

  if ledger.id is null or ledger.original_outcome is distinct from 'failed'
    or ledger.current_outcome is distinct from 'failed' or ledger.movement_reference is not null
    or (ledger.capture_execution_permit->>'leaseGeneration')::bigint < 1
    or (ledger.capture_execution_permit->>'leaseToken')::uuid is null
    or ledger.executed_at >= (ledger.capture_execution_permit ->> 'notAfter')::timestamptz
    or ledger.executed_at < (target_attempt.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz then
    raise exception 'Booking Request definitive Capture failure evidence is invalid' using errcode = 'RC409';
  end if;
  if work.state = 'payment_required' then
    if target_lease_generation is distinct from work.lease_generation
      or target_lease_token is distinct from work.lease_token
      or target_provider_result is distinct from jsonb_build_object('outcome','failed',
        'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,'retrySafe',false) then
      raise exception 'Payment Required replay evidence is invalid' using errcode = 'RC409';
    end if;
    return jsonb_build_object('status','payment-required','paymentRequiredWindow',jsonb_build_object(
      'recordedAt',to_char(work.payment_required_recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deadline',to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  end if;

  if target_request.id is null or target_request.status <> 'accepted'
    or work.state <> 'processing' or target_attempt.id is null or target_claim.id is null
    or target_lease_generation is distinct from work.lease_generation
    or target_lease_token is distinct from work.lease_token
    or clock_timestamp() >= work.lease_expires_at
    or (ledger.claim_id,ledger.claim_generation,ledger.operation_kind,ledger.payment_lifecycle_id,
      ledger.logical_operation_id,ledger.physical_attempt_id,ledger.amount_fils,ledger.currency,
      ledger.request_fingerprint) is distinct from
      (work.authorization_claim_id,work.authorization_claim_generation,'capture'::text,work.payment_lifecycle_id,
      work.capture_logical_operation_id,work.capture_physical_attempt_id,work.amount_fils,work.currency,
      work.request_fingerprint)
    or (work.recovery_operation_id is null and (
      work.lease_generation is distinct from (ledger.capture_execution_permit->>'leaseGeneration')::bigint
      or work.lease_token::text is distinct from ledger.capture_execution_permit->>'leaseToken'
      or ledger.capture_execution_permit is distinct from source.binding || jsonb_build_object(
        'purpose','booking-request-capture','workId',work.booking_request_id,
        'leaseGeneration',work.lease_generation,'leaseToken',work.lease_token,
        'notAfter',to_char(work.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
    or (work.recovery_operation_id is not null and (
      work.recovery_operation_id <> ledger.id
      or work.lease_generation <= (ledger.capture_execution_permit->>'leaseGeneration')::bigint))
    or target_provider_result is distinct from jsonb_build_object('outcome','failed',
      'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,'retrySafe',false)
    or target_attempt.booking_request_id is distinct from target_request.id
    or not target_attempt.intent_dedupe_active
    or target_attempt.payment_snapshot -> 'capture' is distinct from 'null'::jsonb
    or jsonb_array_length(target_attempt.payment_snapshot -> 'movements') <> 1
    or target_claim.attempt_id <> target_attempt.id or target_claim.state <> 'converted'
    or target_commitment.id is null or target_commitment.status <> 'pending_hold'
    or exists (select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id = target_request.id)
    or exists (select 1 from public.booking_request_provider_operation_identities identities
      where identities.attempt_id = target_attempt.id and identities.operation_kind = 'capture')
    or (select count(*) from public.payment_provider_operations operations
      where operations.payment_lifecycle_id = work.payment_lifecycle_id
        and operations.logical_operation_id = work.capture_logical_operation_id) <> 1
    or not exists (
      select 1 from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
    )
    or not exists (
      select 1 from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
    )
    or exists (
      select claim_items.unit_kind, claim_items.unit_id, claim_items.service_day, claim_items.price_iqd
      from public.booking_request_authorization_claim_items claim_items where claim_items.claim_id = target_claim.id
      except
      select inventory.unit_kind, inventory.unit_id, inventory.service_day, inventory.committed_price_iqd
      from public.cottage_inventory_commitments inventory where inventory.booking_period_commitment_id = target_commitment.id)
    or exists (
      select inventory.unit_kind, inventory.unit_id, inventory.service_day, inventory.committed_price_iqd
      from public.cottage_inventory_commitments inventory where inventory.booking_period_commitment_id = target_commitment.id
      except
      select claim_items.unit_kind, claim_items.unit_id, claim_items.service_day, claim_items.price_iqd
      from public.booking_request_authorization_claim_items claim_items where claim_items.claim_id = target_claim.id)
    or exists (
      select claim_occupancies.schedule_revision_id, claim_occupancies.shift_id, claim_occupancies.service_day
      from public.booking_request_authorization_claim_occupancies claim_occupancies where claim_occupancies.claim_id = target_claim.id
      except
      select occupancies.schedule_revision_id, occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id and occupancies.active)
    or exists (
      select occupancies.schedule_revision_id, occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id and occupancies.active
      except
      select claim_occupancies.schedule_revision_id, claim_occupancies.shift_id, claim_occupancies.service_day
      from public.booking_request_authorization_claim_occupancies claim_occupancies where claim_occupancies.claim_id = target_claim.id)
    or exists (
      select target_claim.schedule_revision_id, expected.shift_id,
        claim_items.service_day
      from public.booking_request_authorization_claim_items claim_items
      cross join lateral (
        select claim_items.unit_id as shift_id
        where claim_items.unit_kind = 'shift'
        union all
        select shifts.id
        from public.cottage_shifts shifts
        where claim_items.unit_kind = 'full_day_bundle'
          and shifts.schedule_revision_id = target_claim.schedule_revision_id
      ) expected
      where claim_items.claim_id = target_claim.id
      except
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
    )
    or exists (
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
      except
      select target_claim.schedule_revision_id, expected.shift_id,
        claim_items.service_day
      from public.booking_request_authorization_claim_items claim_items
      cross join lateral (
        select claim_items.unit_id as shift_id
        where claim_items.unit_kind = 'shift'
        union all
        select shifts.id
        from public.cottage_shifts shifts
        where claim_items.unit_kind = 'full_day_bundle'
          and shifts.schedule_revision_id = target_claim.schedule_revision_id
      ) expected
      where claim_items.claim_id = target_claim.id
    )
    or exists (select 1 from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id and not occupancies.active) then
    raise exception 'Booking Request definitive Capture failure evidence is invalid' using errcode = 'RC409';
  end if;

  recorded_at := date_trunc('milliseconds', clock_timestamp());
  update public.booking_request_capture_work capture_work
  set state = 'payment_required', outcome = 'failed', completed_at = recorded_at,
    payment_required_recorded_at = recorded_at,
    payment_required_deadline = recorded_at + interval '20 minutes'
  where capture_work.booking_request_id = work.booking_request_id returning * into work;
  insert into public.booking_request_status_notifications(
    booking_request_id, recipient_user_id, status, created_at
  ) values (target_request.id, target_request.customer_user_id, 'payment-required', recorded_at)
  on conflict do nothing;
  return jsonb_build_object('status','payment-required','paymentRequiredWindow',jsonb_build_object(
    'recordedAt',to_char(work.payment_required_recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deadline',to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
end;
$$;

CREATE OR REPLACE FUNCTION "public"."record_booking_request_recovery_outcome"("target_attempt_id" "uuid", "target_step" "text", "target_ledger" "public"."payment_provider_operations", "target_deadline" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare next_state text;
declare request_id uuid;
begin
  select attempts.booking_request_id into request_id from public.booking_request_payment_recovery_attempts attempts where attempts.id=target_attempt_id;
  perform 1 from public.booking_requests requests where requests.id=request_id for update of requests;
  next_state := case
    when target_ledger.current_outcome='indeterminate' then 'blocked'
    when target_step='original-release' and target_ledger.current_outcome='succeeded' then 'original_released'
    when target_step='original-release' then 'blocked'
    when target_step='replacement-authorization' and target_ledger.current_outcome='succeeded' then 'replacement_authorized'
    when target_step='replacement-authorization' then 'safely_failed'
    when target_step='replacement-capture' and target_ledger.current_outcome='succeeded'
      and target_ledger.authoritative_outcome_at < target_deadline then 'succeeded'
    when target_step='replacement-capture' and target_ledger.current_outcome='succeeded' then 'late_succeeded'
    when target_step='replacement-capture' then 'capture_failed'
    when target_step='replacement-release' and target_ledger.current_outcome='succeeded' then 'safely_failed'
    else 'blocked' end;
  update public.booking_request_payment_recovery_attempts attempts set state=next_state,updated_at=clock_timestamp()
    where attempts.id=target_attempt_id;
  if target_ledger.current_outcome='indeterminate'
    or (target_step in ('original-release','replacement-release') and target_ledger.current_outcome='failed') then
    perform public.quarantine_booking_request_payment(request_id,'unsafe-recovery-'||target_step||'-'||target_ledger.current_outcome);
  end if;
  return jsonb_strip_nulls(jsonb_build_object('outcome',target_ledger.current_outcome,
    'providerRequestId',target_ledger.provider_request_id,'providerReference',target_ledger.provider_reference,
    'movementReference',target_ledger.movement_reference,'retrySafe',next_state='safely_failed'));
end;
$$;

CREATE OR REPLACE FUNCTION "public"."save_booking_request_release_snapshot"("target_work_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare work public.booking_request_release_work;
declare attempt public.booking_request_submission_attempts;
declare claim public.booking_request_authorization_claims;
declare operation public.booking_request_release_operations;
declare provider_operation public.payment_provider_operations;
declare next_release jsonb := nullif(target_payment_snapshot -> 'release', 'null'::jsonb);
declare existing_release jsonb;
declare expected_total bigint;
declare expected_generation integer;
declare expected_attempt_number integer;
declare expected_logical_id text;
declare expected_physical_id text;
declare expected_idempotency_key text;
declare expected_fingerprint text;
declare recorded_at timestamptz := clock_timestamp();
declare next_state text;
declare existing_movements jsonb;
declare release_movement jsonb;
begin
  if target_work_id is null
    or target_lease_generation is null
    or target_lease_token is null then
    raise exception 'Booking Request release lease is stale or expired'
      using errcode = 'RC409';
  end if;
  if target_payment_snapshot is null
    or coalesce(jsonb_typeof(target_payment_snapshot), '') <> 'object'
    or not target_payment_snapshot ? 'movements'
    or coalesce(jsonb_typeof(target_payment_snapshot -> 'movements'), '') <> 'array'
    or target_provider_identity is null
    or coalesce(jsonb_typeof(target_provider_identity), '') <> 'object'
    or next_release is null
    or coalesce(jsonb_typeof(next_release), '') <> 'object'
    or not (next_release ?& array[
      'paymentLifecycleId', 'kind', 'logicalOperationId', 'attemptId', 'status',
      'amountFils', 'providerRequestId', 'providerReference',
      'movementReference', 'reconciliationRequired', 'retrySafe'
    ])
    or next_release -> 'paymentLifecycleId' = 'null'::jsonb
    or next_release -> 'kind' = 'null'::jsonb
    or next_release -> 'logicalOperationId' = 'null'::jsonb
    or next_release -> 'attemptId' = 'null'::jsonb
    or next_release -> 'status' = 'null'::jsonb
    or next_release -> 'amountFils' = 'null'::jsonb
    or next_release -> 'reconciliationRequired' = 'null'::jsonb
    or next_release -> 'retrySafe' = 'null'::jsonb then
    raise exception 'Booking Request release evidence is invalid'
      using errcode = '22023';
  end if;
  select * into work from public.booking_request_release_work release_work
  where release_work.id = target_work_id for update;
  if not found then raise exception 'Booking Request release work is unavailable'
    using errcode = 'RC404'; end if;
  select * into attempt from public.booking_request_submission_attempts attempts
  where attempts.id = work.attempt_id for update;
  select * into claim from public.booking_request_authorization_claims claims
  where claims.attempt_id = attempt.id for update;
  if work.state <> 'processing'
    or work.lease_generation <> target_lease_generation
    or work.lease_token <> target_lease_token
    or recorded_at >= work.lease_expires_at then
    raise exception 'Booking Request release lease is stale or expired'
      using errcode = 'RC409';
  end if;
  if work.active_operation_id is not null then
    select * into operation from public.booking_request_release_operations operations
    where operations.id = work.active_operation_id
      and operations.work_id = work.id
      and operations.attempt_id = attempt.id
    for update;
    select * into provider_operation
    from public.payment_provider_operations provider_operations
    where provider_operations.provider = operation.provider
      and provider_operations.environment = operation.environment
      and provider_operations.merchant_id = operation.merchant_id
      and provider_operations.terminal_id = operation.terminal_id
      and provider_operations.provider_idempotency_key =
        operation.provider_idempotency_key
    for update;
  end if;
  expected_total := claim.amount_fils;
  expected_logical_id := attempt.payment_lifecycle_id::text || ':release';
  existing_release := nullif(attempt.payment_snapshot -> 'release', 'null'::jsonb);
  existing_movements := attempt.payment_snapshot -> 'movements';
  if coalesce(jsonb_typeof(existing_movements), '') <> 'array' then
    raise exception 'Stored Booking Request payment movements are invalid'
      using errcode = 'RC409';
  end if;
  release_movement := target_payment_snapshot -> 'movements'
    -> jsonb_array_length(existing_movements);
  if claim.id is null
    or claim.payment_lifecycle_id <> attempt.payment_lifecycle_id
    or claim.amount_fils <> expected_total
    or claim.state <> 'converted'
    or attempt.payment_snapshot -> 'authorization' ->> 'status' <> 'succeeded'
    or attempt.payment_snapshot -> 'capture' <> 'null'::jsonb
    or target_payment_snapshot -> 'authorization'
      is distinct from attempt.payment_snapshot -> 'authorization'
    or target_payment_snapshot - 'release' - 'movements'
      is distinct from attempt.payment_snapshot - 'release' - 'movements'
    or target_provider_identity is distinct from jsonb_build_object(
      'provider', attempt.authorization_provider,
      'environment', attempt.authorization_environment,
      'merchantId', attempt.authorization_merchant_id,
      'terminalId', attempt.authorization_terminal_id
    )
    or next_release is null
    or next_release ->> 'paymentLifecycleId' <> attempt.payment_lifecycle_id::text
    or next_release ->> 'kind' <> 'release'
    or next_release ->> 'logicalOperationId' <> expected_logical_id
    or (next_release ->> 'amountFils')::bigint <> expected_total then
    raise exception 'Booking Request release evidence is invalid'
      using errcode = '22023';
  end if;
  if next_release ->> 'status' <> 'succeeded'
    and target_payment_snapshot -> 'movements'
      is distinct from existing_movements then
    raise exception 'Booking Request release movement evidence is invalid'
      using errcode = '22023';
  end if;

  if next_release ->> 'status' = 'pending'
    and next_release -> 'providerRequestId' = 'null'::jsonb
    and next_release -> 'providerReference' = 'null'::jsonb
    and next_release -> 'movementReference' = 'null'::jsonb
    and not (next_release ->> 'reconciliationRequired')::boolean
    and not (next_release ->> 'retrySafe')::boolean then
    if operation.id is not null and operation.state <> 'retryable' then
      raise exception 'Prior Booking Request release operation is not retryable'
        using errcode = 'RC409';
    end if;
    if operation.id is null and existing_release is not null then
      raise exception 'Booking Request release operation linkage is invalid'
        using errcode = 'RC409';
    end if;
    if operation.id is not null and (
      existing_release ->> 'status' <> 'failed'
      or not (existing_release ->> 'retrySafe')::boolean
    ) then
      raise exception 'Prior Booking Request release evidence is not retryable'
        using errcode = 'RC409';
    end if;
    expected_generation := coalesce(operation.operation_generation + 1, 1);
    expected_attempt_number :=
      split_part(claim.physical_attempt_id, ':attempt-', 2)::integer
      + expected_generation;
    expected_physical_id := expected_logical_id || ':attempt-'
      || expected_attempt_number::text;
    expected_idempotency_key := 'booking-request-release:' || work.id::text
      || ':' || expected_generation::text;
    expected_fingerprint := public.booking_request_release_fingerprint(
      claim.provider, claim.environment, claim.merchant_id, claim.terminal_id,
      attempt.payment_lifecycle_id, expected_logical_id, expected_physical_id,
      expected_total, claim.currency
    );
    if next_release ->> 'attemptId' <> expected_physical_id then
      raise exception 'Booking Request release generation does not match its attempt'
        using errcode = 'RC409';
    end if;
    insert into public.booking_request_release_operations (
      work_id, attempt_id, operation_generation, payment_lifecycle_id,
      logical_operation_id, physical_attempt_id, amount_fils, currency,
      provider, environment, merchant_id, terminal_id,
      provider_idempotency_key, request_fingerprint,
      state, provider_outcome, execution_started_at, updated_at
    ) values (
      work.id, attempt.id, expected_generation, attempt.payment_lifecycle_id,
      expected_logical_id, expected_physical_id, expected_total, claim.currency,
      claim.provider, claim.environment, claim.merchant_id, claim.terminal_id,
      expected_idempotency_key, expected_fingerprint,
      'executing', 'unknown', recorded_at, recorded_at
    ) returning * into operation;
    update public.booking_request_release_work
    set active_operation_id = operation.id where id = work.id;
    update public.booking_request_submission_attempts
    set payment_snapshot = target_payment_snapshot,
      state = 'releasing', updated_at = recorded_at
    where id = attempt.id;
    return jsonb_build_object(
      'purpose', 'booking-request-release',
      'workId', work.id,
      'leaseGeneration', work.lease_generation,
      'leaseToken', work.lease_token,
      'operationId', operation.id,
      'operationGeneration', operation.operation_generation,
      'idempotencyKey', operation.provider_idempotency_key,
      'requestFingerprint', operation.request_fingerprint,
      'notAfter', to_char(work.lease_expires_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  end if;

  if operation.id is null
    or next_release ->> 'attemptId' <> operation.physical_attempt_id
    or next_release ->> 'logicalOperationId' <> operation.logical_operation_id
    or (next_release ->> 'amountFils')::bigint <> operation.amount_fils then
    raise exception 'Booking Request release result does not match its active operation'
      using errcode = 'RC409';
  end if;
  if next_release ->> 'status' = 'succeeded'
    and coalesce(next_release ->> 'providerRequestId', '') <> ''
    and coalesce(next_release ->> 'providerReference', '') <> ''
    and coalesce(next_release ->> 'movementReference', '') <> ''
    and not (next_release ->> 'reconciliationRequired')::boolean
    and not (next_release ->> 'retrySafe')::boolean
    and operation.state in ('executing', 'reconcile_required')
    and provider_operation.current_outcome = 'succeeded'
    and provider_operation.request_fingerprint = operation.request_fingerprint
    and provider_operation.payment_lifecycle_id = operation.payment_lifecycle_id
    and provider_operation.logical_operation_id = operation.logical_operation_id
    and provider_operation.physical_attempt_id = operation.physical_attempt_id
    and provider_operation.amount_fils = operation.amount_fils
    and provider_operation.currency = operation.currency
    and provider_operation.provider_request_id = next_release ->> 'providerRequestId'
    and provider_operation.provider_reference = next_release ->> 'providerReference'
    and provider_operation.movement_reference = next_release ->> 'movementReference'
    and coalesce(release_movement ->> 'recordedAt', '') <> ''
    and target_payment_snapshot -> 'movements' is not distinct from
      existing_movements || jsonb_build_array(jsonb_build_object(
        'kind', 'release',
        'logicalOperationId', next_release ->> 'logicalOperationId',
        'attemptId', next_release ->> 'attemptId',
        'amountFils', expected_total,
        'movementReference', next_release ->> 'movementReference',
        'recordedAt', release_movement ->> 'recordedAt'
      )) then
    next_state := 'released';
    update public.booking_request_release_operations set
      state = 'succeeded', provider_outcome = 'succeeded',
      provider_request_id = next_release ->> 'providerRequestId',
      provider_reference = next_release ->> 'providerReference',
      movement_reference = next_release ->> 'movementReference',
      retry_safe = false, result_recorded_at = recorded_at, updated_at = recorded_at
    where id = operation.id;
  elsif next_release ->> 'status' = 'failed'
    and (next_release ->> 'retrySafe')::boolean
    and not (next_release ->> 'reconciliationRequired')::boolean
    and next_release -> 'movementReference' = 'null'::jsonb
    and next_release -> 'providerRequestId' = 'null'::jsonb
    and next_release -> 'providerReference' = 'null'::jsonb
    and provider_operation.current_outcome='not-executed'
    and operation.state = 'retryable'
    and operation.provider_outcome = 'not_executed'
    and operation.retry_safe then
    next_state := 'reconciliation_required';
  elsif next_release ->> 'status' = 'failed'
    and (next_release ->> 'retrySafe')::boolean
    and not (next_release ->> 'reconciliationRequired')::boolean
    and next_release -> 'movementReference' = 'null'::jsonb
    and operation.state in ('executing', 'reconcile_required')
    and provider_operation.current_outcome = 'failed'
    and provider_operation.request_fingerprint = operation.request_fingerprint
    and provider_operation.payment_lifecycle_id = operation.payment_lifecycle_id
    and provider_operation.logical_operation_id = operation.logical_operation_id
    and provider_operation.physical_attempt_id = operation.physical_attempt_id
    and provider_operation.amount_fils = operation.amount_fils
    and provider_operation.currency = operation.currency
    and provider_operation.provider_request_id = next_release ->> 'providerRequestId'
    and provider_operation.provider_reference = next_release ->> 'providerReference' then
    next_state := 'reconciliation_required';
    update public.booking_request_release_operations set
      state = 'retryable', provider_outcome = 'failed',
      provider_request_id = next_release ->> 'providerRequestId',
      provider_reference = next_release ->> 'providerReference',
      movement_reference = null, retry_safe = true,
      result_recorded_at = recorded_at, updated_at = recorded_at
    where id = operation.id;
  elsif next_release ->> 'status' = 'pending'
    and (next_release ->> 'reconciliationRequired')::boolean
    and operation.state in ('executing', 'reconcile_required')
    and (
      (next_release -> 'providerRequestId' = 'null'::jsonb
        and next_release -> 'providerReference' = 'null'::jsonb
        and next_release -> 'movementReference' = 'null'::jsonb
        and provider_operation.current_outcome is null
        and operation.state = 'reconcile_required')
      or
      (provider_operation.current_outcome = 'indeterminate'
        and provider_operation.request_fingerprint = operation.request_fingerprint
        and provider_operation.payment_lifecycle_id = operation.payment_lifecycle_id
        and provider_operation.logical_operation_id = operation.logical_operation_id
        and provider_operation.physical_attempt_id = operation.physical_attempt_id
        and provider_operation.amount_fils = operation.amount_fils
        and provider_operation.currency = operation.currency
        and provider_operation.provider_request_id = next_release ->> 'providerRequestId'
        and provider_operation.provider_reference = next_release ->> 'providerReference'
        and provider_operation.movement_reference = next_release ->> 'movementReference')
    ) then
    next_state := 'reconciliation_required';
    update public.booking_request_release_operations set
      state = 'reconcile_required',
      provider_outcome = case
        when next_release -> 'providerRequestId' = 'null'::jsonb then 'unknown'
        else 'indeterminate' end,
      provider_request_id = nullif(next_release ->> 'providerRequestId', ''),
      provider_reference = nullif(next_release ->> 'providerReference', ''),
      movement_reference = nullif(next_release ->> 'movementReference', ''),
      retry_safe = false,
      result_recorded_at = case
        when next_release -> 'providerRequestId' = 'null'::jsonb then null
        else recorded_at end,
      updated_at = recorded_at
    where id = operation.id;
  else
    raise exception 'Booking Request release result shape is invalid'
      using errcode = '22023';
  end if;
  update public.booking_request_submission_attempts
  set payment_snapshot = target_payment_snapshot,
    state = next_state,
    release_provider_request_id = case when next_state = 'released'
      then next_release ->> 'providerRequestId' else release_provider_request_id end,
    release_provider_reference = case when next_state = 'released'
      then next_release ->> 'providerReference' else release_provider_reference end,
    release_movement_reference = case when next_state = 'released'
      then next_release ->> 'movementReference' else release_movement_reference end,
    updated_at = recorded_at
  where id = attempt.id;
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."validate_booking_request_payment_recovery_confirmation"("target_booking_request_id" "uuid", "target_evidence" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record;
declare attempt public.booking_request_payment_recovery_attempts;
declare work public.booking_request_capture_work;
declare operation public.booking_request_payment_recovery_operations;
declare capture public.payment_provider_operations;
declare permit jsonb;
begin
  select * into source from public.lock_booking_request_payment_recovery_source((target_evidence->>'recoveryAttemptId')::uuid);
  attempt := source.attempt; work := source.work;
  permit := public.booking_request_recovery_execution_permit(attempt,work,source.payment_snapshot,'replacement-capture');
  select * into operation from public.booking_request_payment_recovery_operations operations
    where operations.recovery_attempt_id=attempt.id and operations.step='replacement-capture';
  capture := public.validate_booking_request_recovery_operation(operation,permit);
  if attempt.booking_request_id is distinct from target_booking_request_id or attempt.state <> 'succeeded'
    or capture.current_outcome <> 'succeeded' or capture.authoritative_outcome_at is null
    or capture.authoritative_outcome_at >= work.payment_required_deadline
    or target_evidence is distinct from jsonb_build_object(
      'purpose','booking-request-payment-recovery','bookingRequestId',work.booking_request_id,
      'recoveryAttemptId',attempt.id,'capturePhysicalAttemptId',capture.physical_attempt_id,
      'capture',jsonb_build_object('movementReference',capture.movement_reference)) then
    raise exception 'Recovery confirmation evidence is invalid' using errcode='RC409'; end if;
  return jsonb_build_object('submissionAttemptId',work.attempt_id,'authorizationClaimId',work.authorization_claim_id,
    'amountFils',work.amount_fils,'capturePhysicalAttemptId',capture.physical_attempt_id,
    'capture',jsonb_build_object('movementReference',capture.movement_reference));
end;
$$;

CREATE OR REPLACE FUNCTION "public"."validate_booking_request_payment_required_expiry_target"("target" "public"."booking_request_payment_required_expiry_operations", "work" "public"."booking_request_capture_work", "payment_snapshot" "jsonb") RETURNS "public"."payment_provider_operations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare capture_evidence public.payment_provider_operations;
declare authorization_evidence public.payment_provider_operations;
declare ledger public.payment_provider_operations;
declare recovery public.booking_request_payment_recovery_attempts;
declare operation public.booking_request_payment_recovery_operations;
declare predecessor text;
declare predecessor_time timestamptz;
declare logical_identity text;
declare physical_identity text;
declare release_identity text;
begin
  if target.authorization_payment_lifecycle_id=work.payment_lifecycle_id then
    predecessor := payment_snapshot#>>'{authorization,movementReference}';
    predecessor_time := (payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz;
    logical_identity := work.authorization_logical_operation_id;
    physical_identity := work.authorization_physical_attempt_id;
    release_identity := target.expiry_work_id::text||':original-release';
  else
    select * into recovery from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=target.authorization_payment_lifecycle_id
        and attempts.booking_request_id=work.booking_request_id;
    select * into operation from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=recovery.id and operations.step='replacement-authorization';
    authorization_evidence := public.validate_booking_request_recovery_operation(operation,
      public.booking_request_recovery_execution_permit(recovery,work,payment_snapshot,'replacement-authorization'));
    if authorization_evidence.current_outcome is distinct from 'succeeded' then
      raise exception 'Expiry authorisation is invalid' using errcode='RC409'; end if;
    predecessor := authorization_evidence.movement_reference;
    predecessor_time := authorization_evidence.authoritative_outcome_at;
    logical_identity := authorization_evidence.logical_operation_id;
    physical_identity := authorization_evidence.physical_attempt_id;
    release_identity := target.expiry_work_id::text||':replacement-release:'||recovery.generation::text;
  end if;
  if (target.booking_request_id,target.authorization_claim_id,target.authorization_claim_generation,
      target.authorization_logical_operation_id,target.authorization_physical_attempt_id,
      target.predecessor_movement_reference,target.predecessor_outcome_at,
      target.amount_fils,target.currency,target.provider,target.environment,target.merchant_id,target.terminal_id,
      target.request_fingerprint) is distinct from
    (work.booking_request_id,work.authorization_claim_id,work.authorization_claim_generation,
      logical_identity,physical_identity,predecessor,predecessor_time,
      work.amount_fils,work.currency,work.provider,work.environment,work.merchant_id,work.terminal_id,
      work.request_fingerprint)
    or predecessor is null or predecessor_time is null
    or not exists(select 1 from public.booking_request_payment_required_expiry_work expiry
      where expiry.id=target.expiry_work_id and expiry.booking_request_id=work.booking_request_id
        and expiry.payment_required_deadline=work.payment_required_deadline) then
    raise exception 'Expiry release target is invalid' using errcode='RC409'; end if;
  if target.operation_kind='refund' then
    select * into capture_evidence from public.payment_provider_operations operations where operations.id=target.capture_provider_operation_id for update of operations;
    if capture_evidence.current_outcome is distinct from 'succeeded' or capture_evidence.original_outcome='failed'
      or capture_evidence.operation_kind is distinct from 'capture' or capture_evidence.movement_reference is null
      or capture_evidence.authoritative_outcome_at is distinct from target.capture_occurred_at
      or target.capture_occurred_at < work.payment_required_deadline
      or (capture_evidence.payment_lifecycle_id,capture_evidence.claim_id,capture_evidence.claim_generation,capture_evidence.amount_fils,
          capture_evidence.currency,capture_evidence.provider,capture_evidence.environment,capture_evidence.merchant_id,capture_evidence.terminal_id)
        is distinct from (target.authorization_payment_lifecycle_id,target.authorization_claim_id,target.authorization_claim_generation,target.amount_fils,
          target.currency,target.provider,target.environment,target.merchant_id,target.terminal_id)
      or capture_evidence.recorded_at is null then raise exception 'Corrective refund capture is invalid' using errcode='RC409'; end if;
    release_identity:=target.expiry_work_id::text||':corrective-refund:'||capture_evidence.id::text;
  end if;
  if target.owner='recovery' then
    select * into operation from public.booking_request_payment_recovery_operations operations
      where operations.id=target.recovery_operation_id;
    select * into recovery from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=operation.recovery_attempt_id and attempts.booking_request_id=work.booking_request_id;
    if operation.step is distinct from (case when target.authorization_payment_lifecycle_id=work.payment_lifecycle_id
      then 'original-release' else 'replacement-release' end) then
      raise exception 'Expiry recovery release is invalid' using errcode='RC409'; end if;
    ledger := public.validate_booking_request_recovery_operation(operation,
      public.booking_request_recovery_execution_permit(recovery,work,payment_snapshot,operation.step));
  else
    if target.release_logical_operation_id is distinct from release_identity
      or target.release_physical_attempt_id is distinct from release_identity||':1'
      or target.provider_idempotency_key is distinct from release_identity||':1'
      or target.recovery_operation_id is not null then
      raise exception 'Expiry release identity is invalid' using errcode='RC409'; end if;
    if target.provider_operation_id is null then return null; end if;
    select * into ledger from public.payment_provider_operations operations
      where operations.id=target.provider_operation_id for update of operations;
    if ledger.recovery_attempt_id is not null or ledger.capture_execution_permit is not null
      or ledger.executed_at < work.payment_required_deadline then
      raise exception 'Expiry provider ownership is invalid' using errcode='RC409'; end if;
  end if;
  if ledger.id is null or ledger.id is distinct from target.provider_operation_id
    or (ledger.operation_kind,ledger.claim_id,ledger.claim_generation,ledger.payment_lifecycle_id,
      ledger.logical_operation_id,ledger.physical_attempt_id,ledger.provider_idempotency_key,
      ledger.amount_fils,ledger.currency,ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,
      ledger.request_fingerprint) is distinct from
    (target.operation_kind,target.authorization_claim_id,target.authorization_claim_generation,target.authorization_payment_lifecycle_id,
      target.release_logical_operation_id,target.release_physical_attempt_id,target.provider_idempotency_key,
      target.amount_fils,target.currency,target.provider,target.environment,target.merchant_id,target.terminal_id,
      target.request_fingerprint)
    or ledger.recorded_at is null
    or (ledger.original_outcome <> 'indeterminate' and ledger.current_outcome <> ledger.original_outcome)
    or (ledger.current_outcome='indeterminate') is distinct from (ledger.authoritative_outcome_at is null)
    or (ledger.current_outcome='failed') is distinct from (ledger.movement_reference is null)
    or ledger.authoritative_outcome_at < ledger.executed_at
    or ledger.executed_at < predecessor_time then
    raise exception 'Expiry provider evidence is invalid' using errcode='RC409'; end if;
  return ledger;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."validate_booking_request_recovery_operation"("target_operation" "public"."booking_request_payment_recovery_operations", "target_permit" "jsonb") RETURNS "public"."payment_provider_operations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare ledger public.payment_provider_operations;
declare binding jsonb := target_permit->'binding';
begin
  select * into ledger from public.payment_provider_operations operations
    where operations.id=target_operation.provider_operation_id for update of operations;
  if target_operation.id is null or ledger.id is null
    or target_operation.execution_permit is distinct from target_permit
    or target_operation.recovery_attempt_id::text is distinct from target_permit->>'attemptId'
    or target_operation.step is distinct from target_permit->>'step'
    or (ledger.recovery_attempt_id::text,ledger.claim_id::text,ledger.claim_generation,
      ledger.operation_kind,ledger.payment_lifecycle_id::text,ledger.logical_operation_id,
      ledger.physical_attempt_id,ledger.amount_fils,ledger.currency,
      ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,
      ledger.provider_idempotency_key,ledger.request_fingerprint) is distinct from
      (target_permit->>'attemptId',binding->>'authorizationClaimId',
      (binding->>'authorizationClaimGeneration')::integer,
      case target_permit->>'step' when 'replacement-authorization' then 'authorization'
        when 'replacement-capture' then 'capture' else 'release' end,
      binding->>'paymentLifecycleId',binding->>'logicalOperationId',binding->>'physicalAttemptId',
      (binding->>'amountFils')::bigint,binding->>'currency',
      binding#>>'{providerIdentity,provider}',binding#>>'{providerIdentity,environment}',
      binding#>>'{providerIdentity,merchantId}',binding#>>'{providerIdentity,terminalId}',
      target_permit->>'idempotencyKey',binding->>'requestFingerprint')
    or ledger.recorded_at is null
    or ledger.current_outcome is distinct from target_operation.outcome
    or (ledger.original_outcome <> 'indeterminate' and ledger.current_outcome <> ledger.original_outcome)
    or ledger.authoritative_outcome_at is distinct from target_operation.authoritative_outcome_at
    or (ledger.current_outcome='indeterminate') is distinct from (ledger.authoritative_outcome_at is null)
    or (ledger.current_outcome='failed') is distinct from (ledger.movement_reference is null)
    or ledger.authoritative_outcome_at < ledger.executed_at
    or ledger.executed_at < (binding->>'predecessorOutcomeAt')::timestamptz
    or ledger.capture_execution_permit is distinct from
      (case when ledger.operation_kind='capture' then target_permit end) then
    raise exception 'Recovery provider evidence is invalid' using errcode='RC409';
  end if;
  return ledger;
end;
$$;

CREATE OR REPLACE FUNCTION public.payment_operation_admission(target public.payment_provider_operations, execute_allowed boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  select jsonb_build_object('operationId',target.id,'purpose',target.admission->>'purpose',
    'providerIdentity',jsonb_build_object('provider',target.provider,'environment',target.environment,'merchantId',target.merchant_id,'terminalId',target.terminal_id),
    'idempotencyKey',target.provider_idempotency_key,'requestFingerprint',target.request_fingerprint,
    'binding',jsonb_build_object('kind',target.operation_kind,'paymentLifecycleId',target.payment_lifecycle_id,
      'logicalOperationId',target.logical_operation_id,'attemptId',target.physical_attempt_id,'amountFils',target.amount_fils,'currency',target.currency),
    'notBefore',target.admission->'notBefore','notAfter',target.admission->'notAfter','mode',case when execute_allowed then 'execute' else 'reconcile' end);
$$;

CREATE OR REPLACE FUNCTION public.validate_payment_provider_observation(target_result jsonb,target_operation_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare evidence jsonb := target_result->'evidence';
declare occurrence timestamptz;
declare closure timestamptz;
begin
  if target_result is null or jsonb_typeof(target_result)<>'object' or evidence is null or jsonb_typeof(evidence)<>'object'
    or evidence ?& array['operationId','eventId','provenance','originalOutcome','executedAt','occurredAt','closedAt'] is not true
    or evidence-array['operationId','eventId','provenance','originalOutcome','executedAt','occurredAt','closedAt']<>'{}'
    or evidence->>'operationId' is distinct from target_operation_id::text
    or jsonb_typeof(evidence->'eventId') is distinct from 'string' or length(evidence->>'eventId') not between 1 and 200
    or (evidence->>'provenance' in ('fictional-provider','provider-event','legacy-simulated')) is not true then
    raise exception 'Payment observation identity is invalid' using errcode='RC409'; end if;
  occurrence := (evidence->>'occurredAt')::timestamptz;
  closure := (evidence->>'closedAt')::timestamptz;
  if (occurrence is not null and (not isfinite(occurrence) or occurrence>clock_timestamp()))
    or (closure is not null and (not isfinite(closure) or closure>clock_timestamp())) then
    raise exception 'Payment observation clock is invalid' using errcode='RC409'; end if;
  if target_result->>'outcome'='not-executed' then
    if target_result-array['outcome','evidence']<>'{}' or occurrence is not null or closure is null
      or evidence->'originalOutcome' is distinct from 'null'::jsonb or evidence->'executedAt' is distinct from 'null'::jsonb then
      raise exception 'Payment absence receipt is invalid' using errcode='RC409'; end if;
  elsif target_result->>'outcome' in ('succeeded','failed','indeterminate') then
    if closure is not null
      or coalesce(evidence->>'originalOutcome','') not in ('succeeded','failed','indeterminate')
      or ((evidence->>'executedAt')::timestamptz is null and evidence->>'provenance'<>'legacy-simulated')
      or (evidence->>'executedAt')::timestamptz>clock_timestamp()
      or jsonb_typeof(target_result->'providerRequestId') is distinct from 'string'
      or length(target_result->>'providerRequestId')=0 or jsonb_typeof(target_result->'providerReference') is distinct from 'string'
      or length(target_result->>'providerReference')=0
      or (target_result->>'outcome'='indeterminate' and occurrence is not null)
      or (target_result->>'outcome'<>'indeterminate' and occurrence is null and evidence->>'provenance'<>'legacy-simulated') then
      raise exception 'Payment observation references or occurrence are invalid' using errcode='RC409'; end if;
    if target_result->>'outcome'='failed' then
      if target_result-array['outcome','providerRequestId','providerReference','retrySafe','evidence']<>'{}'
        or jsonb_typeof(target_result->'retrySafe') is distinct from 'boolean' then
        raise exception 'Failed payment observation is invalid' using errcode='RC409'; end if;
    elsif target_result-array['outcome','providerRequestId','providerReference','movementReference','evidence']<>'{}'
      or jsonb_typeof(target_result->'movementReference') is distinct from 'string' or length(target_result->>'movementReference')=0 then
      raise exception 'Payment movement observation is invalid' using errcode='RC409'; end if;
  else raise exception 'Payment observation outcome is invalid' using errcode='RC409'; end if;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
  raise exception 'Payment observation is invalid' using errcode='RC409';
end;
$$;

CREATE OR REPLACE FUNCTION public.validate_simulated_payment_binding(target_binding jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Fictional effect unavailable' using errcode='42501'; end if;
  if target_binding is null or jsonb_typeof(target_binding)<>'object'
    or target_binding ?& array['operationId','providerIdentity','idempotencyKey','requestFingerprint','notBefore','notAfter'] is not true
    or target_binding-array['operationId','providerIdentity','idempotencyKey','requestFingerprint','notBefore','notAfter']<>'{}'
    or target_binding->'providerIdentity' is distinct from '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    or (target_binding->>'operationId')::uuid is null or coalesce(length(target_binding->>'idempotencyKey'),0)=0
    or coalesce(target_binding->>'requestFingerprint','') !~ '^[0-9a-f]{64}$'
    or (target_binding->>'notBefore' is not null and not isfinite((target_binding->>'notBefore')::timestamptz))
    or (target_binding->>'notAfter' is not null and not isfinite((target_binding->>'notAfter')::timestamptz)) then
    raise exception 'Fictional effect binding is invalid' using errcode='RC409'; end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.simulated_payment_absence_receipt(target_binding jsonb,closed_at timestamptz) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  select jsonb_build_object('outcome','not-executed','evidence',jsonb_build_object(
    'operationId',target_binding->>'operationId','eventId','sim-closed-'||(target_binding->>'operationId'),
    'provenance','fictional-provider','originalOutcome',null,'executedAt',null,'occurredAt',null,'closedAt',closed_at));
$$;

CREATE OR REPLACE FUNCTION public.persist_simulated_payment_effect(target_binding jsonb,target_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare winner public.simulated_payment_effects;
declare inserted_id uuid;
declare checked_at timestamptz;
declare proposed jsonb;
begin
  perform public.validate_simulated_payment_binding(target_binding);
  -- Host clocks describe a fictional proposal; only the database stamps the effect.
  if jsonb_typeof(target_result#>'{evidence,executedAt}') is distinct from 'string'
    or isfinite((target_result#>>'{evidence,executedAt}')::timestamptz) is not true
    or (target_result->>'outcome'<>'indeterminate' and (
      jsonb_typeof(target_result#>'{evidence,occurredAt}') is distinct from 'string'
      or isfinite((target_result#>>'{evidence,occurredAt}')::timestamptz) is not true))
    or (target_result->>'outcome'='indeterminate' and target_result#>'{evidence,occurredAt}' is distinct from 'null'::jsonb) then
    raise exception 'Fictional proposal clock shape is invalid' using errcode='RC409'; end if;
  proposed:=jsonb_set(jsonb_set(target_result,'{evidence,executedAt}',to_jsonb(clock_timestamp())),
    '{evidence,occurredAt}',case when target_result->>'outcome'='indeterminate' then 'null'::jsonb else to_jsonb(clock_timestamp()) end);
  perform public.validate_payment_provider_observation(proposed,(target_binding->>'operationId')::uuid);
  if target_result->>'outcome'='not-executed' or target_result#>>'{evidence,provenance}'<>'fictional-provider'
    or target_result#>>'{evidence,originalOutcome}' is distinct from target_result->>'outcome' then
    raise exception 'Fictional execution proposal is invalid' using errcode='RC409'; end if;
  insert into public.simulated_payment_effects(operation_id,provider,environment,merchant_id,terminal_id,idempotency_key,binding,state,physical_execution_count)
    values((target_binding->>'operationId')::uuid,target_binding#>>'{providerIdentity,provider}',target_binding#>>'{providerIdentity,environment}',
      target_binding#>>'{providerIdentity,merchantId}',target_binding#>>'{providerIdentity,terminalId}',target_binding->>'idempotencyKey',target_binding,'reserved',0)
    on conflict(provider,environment,merchant_id,terminal_id,idempotency_key) do nothing returning operation_id into inserted_id;
  select * into winner from public.simulated_payment_effects effects where
    (effects.provider,effects.environment,effects.merchant_id,effects.terminal_id,effects.idempotency_key)=
    (target_binding#>>'{providerIdentity,provider}',target_binding#>>'{providerIdentity,environment}',target_binding#>>'{providerIdentity,merchantId}',target_binding#>>'{providerIdentity,terminalId}',target_binding->>'idempotencyKey')
    for update of effects;
  if not found then raise exception 'Fictional arbitration winner unavailable' using errcode='55P03'; end if;
  if winner.binding is distinct from target_binding then raise exception 'Fictional effect binding changed' using errcode='RC409'; end if;
  if inserted_id is null then
    if winner.state='reserved' then raise exception 'Fictional effect unresolved' using errcode='55P03'; end if;
    return winner.result;
  end if;
  -- Contention has ended. Only this clock may authorize the new fictional effect.
  checked_at := clock_timestamp();
  if checked_at >= (target_binding->>'notAfter')::timestamptz then
    update public.simulated_payment_effects set state='closed-not-executed',result=public.simulated_payment_absence_receipt(target_binding,checked_at),updated_at=checked_at
      where operation_id=winner.operation_id returning * into winner;
  elsif checked_at < (target_binding->>'notBefore')::timestamptz then
    raise exception 'Fictional effect is not yet admitted' using errcode='RC409';
  else
    proposed:=jsonb_set(jsonb_set(target_result,'{evidence,executedAt}',to_jsonb(checked_at)),
      '{evidence,occurredAt}',case when target_result->>'outcome'='indeterminate' then 'null'::jsonb else to_jsonb(checked_at) end);
    perform public.validate_payment_provider_observation(proposed,winner.operation_id);
    update public.simulated_payment_effects set state='executed',physical_execution_count=1,
      result=proposed,updated_at=checked_at
      where operation_id=winner.operation_id returning * into winner;
  end if;
  return winner.result;
exception when unique_violation then raise exception 'Fictional operation identity changed' using errcode='RC409';
  when invalid_datetime_format or datetime_field_overflow then raise exception 'Fictional proposal clock is invalid' using errcode='RC409';
end;
$$;

CREATE OR REPLACE FUNCTION public.seal_simulated_payment_absence(target_binding jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare winner public.simulated_payment_effects;
begin
  perform public.validate_simulated_payment_binding(target_binding);
  insert into public.simulated_payment_effects(operation_id,provider,environment,merchant_id,terminal_id,idempotency_key,binding,state,result,physical_execution_count)
    values((target_binding->>'operationId')::uuid,target_binding#>>'{providerIdentity,provider}',target_binding#>>'{providerIdentity,environment}',
      target_binding#>>'{providerIdentity,merchantId}',target_binding#>>'{providerIdentity,terminalId}',target_binding->>'idempotencyKey',target_binding,
      'closed-not-executed',public.simulated_payment_absence_receipt(target_binding,clock_timestamp()),0)
    on conflict(provider,environment,merchant_id,terminal_id,idempotency_key) do nothing;
  select * into winner from public.simulated_payment_effects effects where
    (effects.provider,effects.environment,effects.merchant_id,effects.terminal_id,effects.idempotency_key)=
    (target_binding#>>'{providerIdentity,provider}',target_binding#>>'{providerIdentity,environment}',target_binding#>>'{providerIdentity,merchantId}',target_binding#>>'{providerIdentity,terminalId}',target_binding->>'idempotencyKey')
    for update of effects;
  if not found or winner.state='reserved' then raise exception 'Fictional arbitration winner unavailable' using errcode='55P03'; end if;
  if winner.binding is distinct from target_binding then raise exception 'Fictional effect binding changed' using errcode='RC409'; end if;
  return winner.result;
exception when unique_violation then raise exception 'Fictional operation identity changed' using errcode='RC409';
end;
$$;

CREATE OR REPLACE FUNCTION public.resolve_simulated_payment_effect(target_binding jsonb,target_event_id text,target_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare winner public.simulated_payment_effects;
declare checked_at timestamptz;
declare proposed jsonb;
begin
  perform public.validate_simulated_payment_binding(target_binding);
  select * into winner from public.simulated_payment_effects effects where effects.operation_id=(target_binding->>'operationId')::uuid for update of effects;
  if not found or winner.binding is distinct from target_binding then raise exception 'Fictional resolution binding is invalid' using errcode='RC409'; end if;
  if winner.state='closed-not-executed' or winner.result->>'outcome'<>'indeterminate' then return winner.result; end if;
  if winner.result#>>'{evidence,eventId}' is distinct from target_event_id then return winner.result; end if;
  if jsonb_typeof(target_result#>'{evidence,occurredAt}') is distinct from 'string'
    or isfinite((target_result#>>'{evidence,occurredAt}')::timestamptz) is not true then
    raise exception 'Fictional resolution clock shape is invalid' using errcode='RC409'; end if;
  -- Original execution is immutable; this resolution's occurrence is database-owned.
  proposed:=jsonb_set(target_result,'{evidence,occurredAt}',to_jsonb(clock_timestamp()));
  perform public.validate_payment_provider_observation(proposed,winner.operation_id);
  if target_result->>'outcome' not in ('succeeded','failed') or target_result#>>'{evidence,provenance}'<>'fictional-provider'
    or target_result#>'{evidence,originalOutcome}' is distinct from winner.result#>'{evidence,originalOutcome}'
    or target_result#>'{evidence,executedAt}' is distinct from winner.result#>'{evidence,executedAt}'
    or (target_result->>'providerRequestId',target_result->>'providerReference') is distinct from
      (winner.result->>'providerRequestId',winner.result->>'providerReference')
    or (target_result->>'outcome'='succeeded' and target_result->>'movementReference' is distinct from winner.result->>'movementReference') then
    raise exception 'Fictional resolution result is invalid' using errcode='RC409'; end if;
  checked_at:=clock_timestamp();
  proposed:=jsonb_set(target_result,'{evidence,occurredAt}',to_jsonb(checked_at));
  perform public.validate_payment_provider_observation(proposed,winner.operation_id);
  update public.simulated_payment_effects set result=proposed,updated_at=checked_at
    where operation_id=winner.operation_id returning * into winner;
  return winner.result;
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'Fictional resolution clock is invalid' using errcode='RC409';
end;
$$;

CREATE OR REPLACE FUNCTION "public"."admit_booking_request_provider_operation"("target_operation" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare provider_identity jsonb := target_operation -> 'providerIdentity';
declare permit_purpose text := target_operation ->> 'permitPurpose';
declare claim public.booking_request_authorization_claims;
declare attempt public.booking_request_submission_attempts;
declare work public.booking_request_release_work;
declare release_operation public.booking_request_release_operations;
declare operation_id uuid := gen_random_uuid();
declare effective_idempotency_key text;
declare expected_fingerprint text;
declare expected_not_after timestamptz;
declare stored public.payment_provider_operations;
begin
  if current_setting('role', true) <> 'service_role'
    or target_operation is null
    or coalesce(jsonb_typeof(target_operation), '') <> 'object' then
    raise exception 'Payment admission operation is invalid' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(target_operation)) <> 20
    or not (target_operation ?& array[
      'providerIdentity', 'requestFingerprint', 'paymentLifecycleId',
      'logicalOperationId', 'physicalAttemptId', 'operationKind',
      'amountFils', 'currency', 'permitPurpose', 'idempotencyKey', 'notAfter',
      'claimId', 'claimGeneration', 'stateRevision', 'cleanupAttemptId',
      'workId', 'leaseGeneration', 'leaseToken', 'operationId',
      'operationGeneration'
    ])
    or provider_identity is null
    or coalesce(jsonb_typeof(provider_identity), '') <> 'object'
    or (select count(*) from jsonb_object_keys(provider_identity)) <> 4
    or coalesce(btrim(provider_identity ->> 'environment'),'') = ''
    or coalesce(provider_identity ->> 'provider', '') = ''
    or coalesce(provider_identity ->> 'merchantId', '') = ''
    or coalesce(provider_identity ->> 'terminalId', '') = ''
    or coalesce(target_operation ->> 'paymentLifecycleId', '') = ''
    or coalesce(target_operation ->> 'logicalOperationId', '') = ''
    or coalesce(target_operation ->> 'physicalAttemptId', '') = ''
    or coalesce(target_operation ->> 'operationKind', '')
      not in ('authorization', 'release')
    or target_operation -> 'amountFils' = 'null'::jsonb
    or coalesce(target_operation ->> 'currency', '') <> 'IQD'
    or coalesce(target_operation ->> 'permitPurpose', '') = ''
    or coalesce(target_operation ->> 'idempotencyKey', '') = ''
    or coalesce(target_operation ->> 'notAfter', '') = ''
    or coalesce(target_operation ->> 'requestFingerprint', '')
      !~ '^[0-9a-f]{64}$' then
    raise exception 'Payment admission operation is invalid' using errcode = '22023';
  end if;

  if permit_purpose = 'booking-request-submission-cleanup' then
    if target_operation -> 'cleanupAttemptId' = 'null'::jsonb
      or target_operation -> 'claimId' = 'null'::jsonb
      or target_operation -> 'claimGeneration' = 'null'::jsonb
      or target_operation -> 'stateRevision' = 'null'::jsonb then
      raise exception 'Payment admission operation is invalid' using errcode = '22023';
    end if;
    if target_operation ->> 'operationKind' is distinct from 'release'
      or target_operation -> 'workId' is distinct from 'null'::jsonb
      or target_operation -> 'leaseGeneration' is distinct from 'null'::jsonb
      or target_operation -> 'leaseToken' is distinct from 'null'::jsonb
      or target_operation -> 'operationId' is distinct from 'null'::jsonb
      or target_operation -> 'operationGeneration' is distinct from 'null'::jsonb then
      raise exception 'Payment cleanup permit has foreign-purpose fields'
        using errcode = 'RC409';
    end if;
    select * into attempt from public.booking_request_submission_attempts attempts
    where attempts.id = (target_operation ->> 'cleanupAttemptId')::uuid
    for update;
    select * into claim from public.booking_request_authorization_claims claims
    where claims.attempt_id = attempt.id for update;
    expected_not_after := date_trunc(
      'milliseconds', claim.updated_at + interval '30 seconds'
    );
    expected_fingerprint := public.booking_request_submission_cleanup_fingerprint(
      attempt.id, claim.id, claim.generation, claim.state_revision,
      claim.provider, claim.environment, claim.merchant_id, claim.terminal_id,
      claim.payment_lifecycle_id, target_operation ->> 'logicalOperationId',
      target_operation ->> 'physicalAttemptId', claim.amount_fils, claim.currency
    );
    effective_idempotency_key := 'booking-request-submission-cleanup:'
      || attempt.id::text || ':' || claim.state_revision::text;
    if attempt.id is null or claim.id is null
      or attempt.booking_request_id is not null
      or exists (select 1 from public.booking_requests requests
        where requests.payment_lifecycle_id = attempt.payment_lifecycle_id)
      or exists (select 1 from public.booking_request_release_work release_work
        where release_work.attempt_id = attempt.id)
      or claim.state <> 'releasing'
      or claim.state = 'converted'
      or claim.id <> (target_operation ->> 'claimId')::uuid
      or claim.generation <> (target_operation ->> 'claimGeneration')::integer
      or claim.state_revision <> (target_operation ->> 'stateRevision')::bigint
      or claim.payment_lifecycle_id <> attempt.payment_lifecycle_id
      or claim.payment_lifecycle_id <>
        (target_operation ->> 'paymentLifecycleId')::uuid
      or claim.logical_operation_id = target_operation ->> 'logicalOperationId'
      or target_operation ->> 'logicalOperationId'
        <> claim.payment_lifecycle_id::text || ':release'
      or target_operation ->> 'physicalAttemptId'
        <> attempt.payment_snapshot -> 'release' ->> 'attemptId'
      or attempt.payment_snapshot -> 'release' ->> 'status' <> 'pending'
      or attempt.payment_snapshot -> 'authorization' ->> 'status' <> 'succeeded'
      or attempt.payment_snapshot -> 'capture' <> 'null'::jsonb
      or claim.amount_fils <> (target_operation ->> 'amountFils')::bigint
      or claim.currency <> target_operation ->> 'currency'
      or claim.provider <> provider_identity ->> 'provider'
      or claim.environment <> provider_identity ->> 'environment'
      or claim.merchant_id <> provider_identity ->> 'merchantId'
      or claim.terminal_id <> provider_identity ->> 'terminalId'
      or target_operation ->> 'idempotencyKey' <> effective_idempotency_key
      or target_operation ->> 'requestFingerprint' <> expected_fingerprint
      or (target_operation ->> 'notAfter')::timestamptz <> expected_not_after
      or clock_timestamp() >= expected_not_after then
      raise exception 'Payment cleanup permit is invalid or expired'
        using errcode = 'RC409';
    end if;
  elsif permit_purpose = 'booking-request-release' then
    if target_operation -> 'workId' = 'null'::jsonb
      or target_operation -> 'leaseGeneration' = 'null'::jsonb
      or target_operation -> 'leaseToken' = 'null'::jsonb
      or target_operation -> 'operationId' = 'null'::jsonb
      or target_operation -> 'operationGeneration' = 'null'::jsonb then
      raise exception 'Payment admission operation is invalid' using errcode = '22023';
    end if;
    if target_operation ->> 'operationKind' is distinct from 'release'
      or target_operation -> 'claimId' is distinct from 'null'::jsonb
      or target_operation -> 'claimGeneration' is distinct from 'null'::jsonb
      or target_operation -> 'stateRevision' is distinct from 'null'::jsonb
      or target_operation -> 'cleanupAttemptId' is distinct from 'null'::jsonb then
      raise exception 'Payment lifecycle permit has foreign-purpose fields'
        using errcode = 'RC409';
    end if;
    select * into work from public.booking_request_release_work release_work
    where release_work.id = (target_operation ->> 'workId')::uuid
    for update;
    select * into attempt from public.booking_request_submission_attempts attempts
    where attempts.id = work.attempt_id for update;
    select * into claim from public.booking_request_authorization_claims claims
    where claims.attempt_id = attempt.id for update;
    select * into release_operation
    from public.booking_request_release_operations operations
    where operations.id = (target_operation ->> 'operationId')::uuid
      and operations.work_id = work.id
    for update;
    expected_fingerprint := public.booking_request_release_fingerprint(
      release_operation.provider, release_operation.environment,
      release_operation.merchant_id, release_operation.terminal_id,
      release_operation.payment_lifecycle_id,
      release_operation.logical_operation_id,
      release_operation.physical_attempt_id,
      release_operation.amount_fils, release_operation.currency
    );
    effective_idempotency_key := release_operation.provider_idempotency_key;
    if work.id is null or attempt.id is null or claim.id is null
      or release_operation.id is null
      or work.state <> 'processing'
      or work.lease_generation <> (target_operation ->> 'leaseGeneration')::bigint
      or work.lease_token <> (target_operation ->> 'leaseToken')::uuid
      or work.lease_expires_at <> (target_operation ->> 'notAfter')::timestamptz
      or clock_timestamp() >= work.lease_expires_at
      or work.active_operation_id <> release_operation.id
      or release_operation.state <> 'executing'
      or release_operation.operation_generation <>
        (target_operation ->> 'operationGeneration')::integer
      or release_operation.attempt_id <> attempt.id
      or release_operation.payment_lifecycle_id <> attempt.payment_lifecycle_id
      or release_operation.payment_lifecycle_id <> claim.payment_lifecycle_id
      or release_operation.logical_operation_id <>
        target_operation ->> 'logicalOperationId'
      or release_operation.physical_attempt_id <>
        target_operation ->> 'physicalAttemptId'
      or release_operation.amount_fils <>
        (target_operation ->> 'amountFils')::bigint
      or release_operation.currency <> target_operation ->> 'currency'
      or release_operation.provider <> provider_identity ->> 'provider'
      or release_operation.environment <> provider_identity ->> 'environment'
      or release_operation.merchant_id <> provider_identity ->> 'merchantId'
      or release_operation.terminal_id <> provider_identity ->> 'terminalId'
      or release_operation.provider_idempotency_key <>
        target_operation ->> 'idempotencyKey'
      or release_operation.request_fingerprint <> expected_fingerprint
      or target_operation ->> 'requestFingerprint' <> expected_fingerprint
      or attempt.payment_snapshot -> 'authorization' ->> 'status' <> 'succeeded'
      or attempt.payment_snapshot -> 'capture' <> 'null'::jsonb then
      raise exception 'Payment lifecycle release permit is invalid or expired'
        using errcode = 'RC409';
    end if;
  elsif permit_purpose = 'booking-request-authorization' then
    if target_operation -> 'claimId' = 'null'::jsonb
      or target_operation -> 'claimGeneration' = 'null'::jsonb then
      raise exception 'Payment admission operation is invalid' using errcode = '22023';
    end if;
    if target_operation ->> 'operationKind' is distinct from 'authorization'
      or target_operation -> 'stateRevision' is distinct from 'null'::jsonb
      or target_operation -> 'cleanupAttemptId' is distinct from 'null'::jsonb
      or target_operation -> 'workId' is distinct from 'null'::jsonb
      or target_operation -> 'leaseGeneration' is distinct from 'null'::jsonb
      or target_operation -> 'leaseToken' is distinct from 'null'::jsonb
      or target_operation -> 'operationId' is distinct from 'null'::jsonb
      or target_operation -> 'operationGeneration' is distinct from 'null'::jsonb then
      raise exception 'Payment authorization permit has foreign-purpose fields'
        using errcode = 'RC409';
    end if;
    select * into claim from public.booking_request_authorization_claims claims
    where claims.id = (target_operation ->> 'claimId')::uuid for update;
    effective_idempotency_key := claim.provider_idempotency_key;
    if claim.id is null
      or claim.generation <> (target_operation ->> 'claimGeneration')::integer
      or claim.payment_lifecycle_id <>
        (target_operation ->> 'paymentLifecycleId')::uuid
      or claim.logical_operation_id <> target_operation ->> 'logicalOperationId'
      or claim.physical_attempt_id <> target_operation ->> 'physicalAttemptId'
      or claim.amount_fils <> (target_operation ->> 'amountFils')::bigint
      or claim.currency <> target_operation ->> 'currency'
      or claim.provider <> provider_identity ->> 'provider'
      or claim.environment <> provider_identity ->> 'environment'
      or claim.merchant_id <> provider_identity ->> 'merchantId'
      or claim.terminal_id <> provider_identity ->> 'terminalId'
      or target_operation ->> 'idempotencyKey' <> effective_idempotency_key
      or (target_operation ->> 'notAfter')::timestamptz <> claim.not_after
      or not public.booking_request_claim_state_allows_authorization(claim.state)
      or clock_timestamp() >= claim.not_after then
      raise exception 'Payment authorization permit is invalid or expired'
        using errcode = 'RC409';
    end if;
  else
    raise exception 'Payment admission permit purpose is invalid'
      using errcode = 'RC409';
  end if;

  insert into public.payment_provider_operations (
    id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,admission,evidence_provenance
  ) values(operation_id,claim.id,claim.generation,target_operation->>'operationKind',
    claim.provider,claim.environment,claim.merchant_id,claim.terminal_id,effective_idempotency_key,target_operation->>'requestFingerprint',
    claim.payment_lifecycle_id,target_operation->>'logicalOperationId',target_operation->>'physicalAttemptId',claim.amount_fils,claim.currency,
    jsonb_build_object('purpose',permit_purpose,'permit',target_operation,'notBefore',null,'notAfter',target_operation->>'notAfter'),'admitted')
  on conflict(provider,environment,merchant_id,terminal_id,provider_idempotency_key) do nothing;

  select * into stored
  from public.payment_provider_operations operations
  where operations.provider = claim.provider
    and operations.environment = claim.environment
    and operations.merchant_id = claim.merchant_id
    and operations.terminal_id = claim.terminal_id
    and operations.provider_idempotency_key = effective_idempotency_key
  for update;
  if stored.request_fingerprint <> target_operation ->> 'requestFingerprint'
    or stored.claim_id <> claim.id
    or stored.claim_generation <> claim.generation
    or stored.operation_kind <> target_operation ->> 'operationKind'
    or stored.payment_lifecycle_id <> claim.payment_lifecycle_id
    or stored.logical_operation_id <> target_operation ->> 'logicalOperationId'
    or stored.physical_attempt_id <> target_operation ->> 'physicalAttemptId'
    or stored.amount_fils <> claim.amount_fils
    or stored.currency <> claim.currency then
    raise exception 'Payment admission idempotency binding changed'
      using errcode = 'RC409';
  end if;
  return public.payment_operation_admission(stored,stored.id=operation_id);
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."admit_booking_request_capture"("target_permit" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.payment_provider_operations;
declare expected_permit jsonb;
declare executed_at timestamptz;
declare execution_id uuid;
begin
  if public.booking_request_payment_quarantined((target_permit->>'bookingRequestId')::uuid) then return jsonb_build_object('outcome','not-executed'); end if;
  select * into source from public.lock_booking_request_capture_source(
    (target_permit ->> 'bookingRequestId')::uuid
  );
  if not found then raise exception 'Booking Request capture permit is invalid' using errcode = 'RC409'; end if;
  work := source.work;
  ledger := source.ledger;
  expected_permit := source.binding || jsonb_build_object(
    'purpose', 'booking-request-capture', 'workId', work.booking_request_id,
    'leaseGeneration', work.lease_generation, 'leaseToken', work.lease_token,
    'notAfter', to_char(work.lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  if work.state <> 'processing' or target_permit is distinct from expected_permit

    or (ledger.id is not null and ledger.capture_execution_permit is distinct from target_permit) then
    raise exception 'Booking Request capture permit is invalid' using errcode = 'RC409';
  end if;
  executed_at := clock_timestamp();
  if executed_at >= work.lease_expires_at then
    return jsonb_build_object('outcome', 'not-executed');
  end if;
  if ledger.id is null then
    execution_id:=gen_random_uuid();
    insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
      provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,
      capture_execution_permit,admission,evidence_provenance)
    values(execution_id,work.authorization_claim_id,work.authorization_claim_generation,'capture',work.provider,work.environment,work.merchant_id,work.terminal_id,
      work.provider_idempotency_key,work.request_fingerprint,work.payment_lifecycle_id,work.capture_logical_operation_id,work.capture_physical_attempt_id,work.amount_fils,work.currency,
      target_permit,jsonb_build_object('purpose','booking-request-capture','permit',target_permit,
        'notBefore',source.payment_snapshot#>>'{movements,0,recordedAt}','notAfter',target_permit->>'notAfter'),'admitted') returning * into ledger;
  end if;
  return public.payment_operation_admission(ledger,ledger.id=execution_id);
end;
$$;

CREATE OR REPLACE FUNCTION public.admit_booking_request_payment_recovery(target_permit jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare source record;
declare expected jsonb;
declare dispatched jsonb;
declare ledger public.payment_provider_operations;
declare operation_id uuid:=gen_random_uuid();
declare recovery_step text:=target_permit->>'step';
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Recovery admission unavailable' using errcode='42501'; end if;
  select * into ledger from public.payment_provider_operations operations
    where operations.recovery_attempt_id=(target_permit->>'attemptId')::uuid and operations.logical_operation_id=target_permit->>'operationId';
  if found then
    ledger:=public.lock_payment_observation_source(ledger.id,array['booking-request-payment-recovery']);
    if ledger.admission->'permit' is distinct from target_permit then raise exception 'Recovery admission binding changed' using errcode='RC409'; end if;
    if public.booking_request_payment_quarantined((ledger.admission#>>'{permit,binding,bookingRequestId}')::uuid) then return jsonb_build_object('status','not-admitted'); end if;
    return public.payment_operation_admission(ledger);
  end if;
  select * into source from public.lock_booking_request_payment_recovery_source((target_permit->>'attemptId')::uuid);
  expected:=public.booking_request_recovery_execution_permit(source.attempt,source.work,source.payment_snapshot,recovery_step);
  if target_permit is distinct from expected then raise exception 'Recovery admission permit is invalid' using errcode='RC409'; end if;
  select * into ledger from public.payment_provider_operations operations
    where operations.recovery_attempt_id=(source.attempt).id and operations.logical_operation_id=expected->>'operationId' for update of operations;
  if found then
    if ledger.admission->'permit' is distinct from target_permit then raise exception 'Recovery admission binding changed' using errcode='RC409'; end if;
    return public.payment_operation_admission(ledger);
  end if;
  if public.booking_request_payment_quarantined((source.work).booking_request_id)
    or public.booking_request_payment_required_expiry_completed((source.work).booking_request_id)
    or exists(select 1 from public.booking_request_payment_required_expiry_operations operations
      where operations.booking_request_id=(source.work).booking_request_id and operations.owner='expiry'
        and operations.authorization_payment_lifecycle_id=(expected#>>'{binding,paymentLifecycleId}')::uuid
        and operations.predecessor_movement_reference=expected#>>'{binding,predecessorMovementReference}') then
    return jsonb_build_object('status','not-admitted'); end if;
  dispatched:=public.lease_booking_request_payment_recovery_step((source.attempt).id);
  if dispatched->>'status'<>'leased' or dispatched->'permit' is distinct from expected
    or (recovery_step<>'replacement-release' and clock_timestamp()>=(source.work).payment_required_deadline) then
    return jsonb_build_object('status','not-admitted'); end if;
  insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,
    recovery_attempt_id,capture_execution_permit,admission,evidence_provenance)
  values(operation_id,(source.work).authorization_claim_id,(source.work).authorization_claim_generation,
    case recovery_step when 'replacement-authorization' then 'authorization' when 'replacement-capture' then 'capture' else 'release' end,
    (source.work).provider,(source.work).environment,(source.work).merchant_id,(source.work).terminal_id,
    expected->>'idempotencyKey',(source.work).request_fingerprint,(expected#>>'{binding,paymentLifecycleId}')::uuid,
    expected->>'operationId',expected#>>'{binding,physicalAttemptId}',(source.work).amount_fils,(source.work).currency,
    (source.attempt).id,case when recovery_step='replacement-capture' then expected end,
    jsonb_build_object('purpose','booking-request-payment-recovery','permit',expected,
      'notBefore',expected#>>'{binding,predecessorOutcomeAt}','notAfter',case when recovery_step<>'replacement-release' then expected->>'notAfter' end),'admitted')
    returning * into ledger;
  return public.payment_operation_admission(ledger,true);
end;
$$;

CREATE OR REPLACE FUNCTION public.admit_booking_request_payment_required_expiry(target_permit jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare source record;
declare target public.booking_request_payment_required_expiry_operations;
declare expected jsonb;
declare prepared jsonb;
declare ledger public.payment_provider_operations;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Expiry admission unavailable' using errcode='42501'; end if;
  select * into source from public.lock_booking_request_payment_required_expiry_source((target_permit#>>'{binding,bookingRequestId}')::uuid);
  select * into target from public.booking_request_payment_required_expiry_operations operations
    where operations.id=(target_permit->>'expiryOperationId')::uuid and operations.expiry_work_id=(source.expiry).id for update of operations;
  expected:=public.booking_request_payment_required_expiry_permit(target,(source.expiry).payment_required_deadline);
  if target.id is null or target.owner<>'expiry' or target_permit is distinct from expected then raise exception 'Expiry admission permit is invalid' using errcode='RC409'; end if;
  perform public.validate_booking_request_payment_required_expiry_target(target,source.work,source.payment_snapshot);
  if public.booking_request_payment_quarantined((source.work).booking_request_id) then return jsonb_build_object('status','not-admitted'); end if;
  select * into ledger from public.payment_provider_operations operations where
    (operations.provider,operations.environment,operations.merchant_id,operations.terminal_id,operations.provider_idempotency_key)=
    (target.provider,target.environment,target.merchant_id,target.terminal_id,target.provider_idempotency_key) for update of operations;
  if found then
    if ledger.admission->'permit' is distinct from target_permit then raise exception 'Expiry admission binding changed' using errcode='RC409'; end if;
    return public.payment_operation_admission(ledger);
  end if;
  if public.booking_request_payment_quarantined((source.work).booking_request_id) or (source.expiry).state='complete'
    or clock_timestamp()<(source.work).payment_required_deadline then raise exception 'Expiry admission is not allowed' using errcode='RC409'; end if;
  prepared:=public.prepare_booking_request_payment_required_expiry((source.work).booking_request_id,expected#>'{binding,providerIdentity}');
  if prepared->>'status' not in ('release','refund') or prepared->'permit' is distinct from expected then raise exception 'Expiry admission has lost ownership' using errcode='RC409'; end if;
  insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,admission,evidence_provenance)
  values(gen_random_uuid(),target.authorization_claim_id,target.authorization_claim_generation,target.operation_kind,target.provider,target.environment,target.merchant_id,target.terminal_id,
    target.provider_idempotency_key,target.request_fingerprint,target.authorization_payment_lifecycle_id,target.release_logical_operation_id,target.release_physical_attempt_id,target.amount_fils,target.currency,
    jsonb_build_object('purpose',expected->>'purpose','permit',expected,'notBefore',expected->>'notBefore','notAfter',null),'admitted') returning * into ledger;
  return public.payment_operation_admission(ledger,true);
end;
$$;

CREATE OR REPLACE FUNCTION public.reload_booking_request_payment_operation(target_operation jsonb,target_provider_request_id text,target_provider_reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare ledger public.payment_provider_operations;
declare expected jsonb;
declare release_operation public.booking_request_release_operations;
declare work public.booking_request_release_work;
declare attempt public.booking_request_submission_attempts;
declare claim public.booking_request_authorization_claims;
declare cutoff timestamptz;
declare release_ids uuid[];
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Payment inquiry unavailable' using errcode='42501'; end if;
  select * into ledger from public.payment_provider_operations operations where
    (operations.provider,operations.environment,operations.merchant_id,operations.terminal_id,operations.payment_lifecycle_id::text,operations.logical_operation_id,operations.physical_attempt_id,operations.operation_kind)=
    (target_operation#>>'{providerIdentity,provider}',target_operation#>>'{providerIdentity,environment}',target_operation#>>'{providerIdentity,merchantId}',target_operation#>>'{providerIdentity,terminalId}',
      target_operation->>'paymentLifecycleId',target_operation->>'logicalOperationId',target_operation->>'physicalAttemptId',target_operation->>'operationKind');
  if ledger.id is null and target_operation->>'operationKind'='release'
    and target_provider_request_id is null and target_provider_reference is null then
    -- A crashed caller may have persisted its business intent before shared admission.
    -- Reconstruct only that exact relinquished intent, with no executable window.
    select array_agg(operations.id) into release_ids from public.booking_request_release_operations operations where
      (operations.provider,operations.environment,operations.merchant_id,operations.terminal_id,operations.payment_lifecycle_id::text,operations.logical_operation_id,operations.physical_attempt_id)=
      (target_operation#>>'{providerIdentity,provider}',target_operation#>>'{providerIdentity,environment}',target_operation#>>'{providerIdentity,merchantId}',target_operation#>>'{providerIdentity,terminalId}',
        target_operation->>'paymentLifecycleId',target_operation->>'logicalOperationId',target_operation->>'physicalAttemptId');
    if cardinality(release_ids)>1 then raise exception 'Payment inquiry release identity is ambiguous' using errcode='RC409'; end if;
    if cardinality(release_ids)=1 then
      select * into release_operation from public.booking_request_release_operations operations where operations.id=release_ids[1];
      select * into work from public.booking_request_release_work release_work where release_work.id=release_operation.work_id for update;
      select * into attempt from public.booking_request_submission_attempts attempts where attempts.id=work.attempt_id for update;
      select * into claim from public.booking_request_authorization_claims claims where claims.attempt_id=attempt.id for update;
      select * into release_operation from public.booking_request_release_operations operations where operations.id=release_operation.id for update;
      -- Ordinary admission may have won while this reader waited for source locks.
      select * into ledger from public.payment_provider_operations operations where
        (operations.provider,operations.environment,operations.merchant_id,operations.terminal_id,operations.provider_idempotency_key)=
        (release_operation.provider,release_operation.environment,release_operation.merchant_id,release_operation.terminal_id,release_operation.provider_idempotency_key) for update;
      if ledger.id is null then
        if work.id is null or attempt.id is null or claim.id is null or work.state<>'processing'
          or work.active_operation_id is distinct from release_operation.id or release_operation.state<>'reconcile_required'
          or release_operation.provider_outcome<>'unknown' or release_operation.provider_request_id is not null or release_operation.provider_reference is not null
          or release_operation.attempt_id is distinct from attempt.id
          or release_operation.payment_lifecycle_id is distinct from attempt.payment_lifecycle_id
          or release_operation.payment_lifecycle_id is distinct from claim.payment_lifecycle_id
          or (release_operation.amount_fils,release_operation.currency,release_operation.provider,release_operation.environment,release_operation.merchant_id,release_operation.terminal_id)
            is distinct from (claim.amount_fils,claim.currency,claim.provider,claim.environment,claim.merchant_id,claim.terminal_id)
          or release_operation.amount_fils is distinct from (target_operation->>'amountFils')::bigint
          or release_operation.currency is distinct from target_operation->>'currency'
          or release_operation.request_fingerprint is distinct from public.booking_request_release_fingerprint(release_operation.provider,release_operation.environment,
            release_operation.merchant_id,release_operation.terminal_id,release_operation.payment_lifecycle_id,release_operation.logical_operation_id,
            release_operation.physical_attempt_id,release_operation.amount_fils,release_operation.currency)
          or release_operation.provider_idempotency_key is distinct from 'booking-request-release:'||work.id::text||':'||release_operation.operation_generation::text
          or attempt.payment_snapshot#>>'{authorization,status}' is distinct from 'succeeded' or attempt.payment_snapshot->'capture' is distinct from 'null'::jsonb then
          raise exception 'Payment inquiry does not match a relinquished release intent' using errcode='RC409'; end if;
        cutoff:=date_trunc('milliseconds',clock_timestamp());
        insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
          provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,admission,evidence_provenance)
        values(gen_random_uuid(),claim.id,claim.generation,'release',release_operation.provider,release_operation.environment,release_operation.merchant_id,release_operation.terminal_id,
          release_operation.provider_idempotency_key,release_operation.request_fingerprint,release_operation.payment_lifecycle_id,release_operation.logical_operation_id,
          release_operation.physical_attempt_id,release_operation.amount_fils,release_operation.currency,
          jsonb_build_object('purpose','booking-request-release','reconciliationOnly',true,'permit',jsonb_build_object('workId',work.id,'operationId',release_operation.id),
            'notBefore',null,'notAfter',cutoff),'admitted') returning * into ledger;
      end if;
    end if;
  end if;
  if ledger.id is null or (target_provider_request_id is null)<>(target_provider_reference is null)
    or (target_provider_request_id is not null and (ledger.provider_request_id,ledger.provider_reference) is distinct from (target_provider_request_id,target_provider_reference))
    or (target_operation->>'requestFingerprint' is not null and target_operation->>'requestFingerprint' is distinct from ledger.request_fingerprint)
    or (target_operation->>'requestFingerprint' is null and ledger.operation_kind not in ('release','refund'))
    or (ledger.admission->>'purpose'='booking-request-capture' and (
      ledger.admission->'permit' is distinct from ledger.capture_execution_permit
      or coalesce((ledger.capture_execution_permit->>'leaseGeneration')::bigint,0)<1
      or ledger.capture_execution_permit->>'leaseToken' is null))
    or ledger.amount_fils is distinct from (target_operation->>'amountFils')::bigint or ledger.currency is distinct from target_operation->>'currency' then
    raise exception 'Payment inquiry does not match an admitted operation' using errcode='RC409'; end if;
  expected:=jsonb_build_object('providerIdentity',(public.payment_operation_admission(ledger))->'providerIdentity',
    'requestFingerprint',target_operation->'requestFingerprint','paymentLifecycleId',ledger.payment_lifecycle_id,
    'logicalOperationId',ledger.logical_operation_id,'physicalAttemptId',ledger.physical_attempt_id,
    'operationKind',ledger.operation_kind,'amountFils',ledger.amount_fils,'currency',ledger.currency);
  if expected is distinct from target_operation then raise exception 'Payment inquiry binding is invalid' using errcode='RC409'; end if;
  if ledger.admission->>'purpose' in ('booking-request-payment-recovery','booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund')
    and public.booking_request_payment_quarantined((ledger.admission#>>'{permit,binding,bookingRequestId}')::uuid) then
    return jsonb_build_object('status','not-admitted');
  end if;
  return public.payment_operation_admission(ledger);
end;
$$;

CREATE OR REPLACE FUNCTION public.accept_payment_provider_observation(target_operation_id uuid,target_result jsonb) RETURNS public.payment_provider_operations
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare ledger public.payment_provider_operations;
declare accepted public.payment_provider_observations;
declare evidence jsonb:=target_result->'evidence';
declare execution_time timestamptz;
declare occurrence_time timestamptz;
declare closure_time timestamptz;
begin
  select * into ledger from public.payment_provider_operations operations where operations.id=target_operation_id for update of operations;
  if not found then raise exception 'Payment admission is missing' using errcode='RC409'; end if;
  perform public.validate_payment_provider_observation(target_result,ledger.id);
  select * into accepted from public.payment_provider_observations observations where
    (observations.provider,observations.environment,observations.merchant_id,observations.terminal_id,observations.event_id)=
    (ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,evidence->>'eventId');
  if found then
    if accepted.operation_id<>ledger.id or accepted.result is distinct from target_result then
      raise exception 'Payment event conflicts with accepted evidence' using errcode='RC409'; end if;
    return ledger;
  end if;
  if evidence->>'provenance'='legacy-simulated' and (ledger.current_outcome is null or ledger.evidence_provenance<>'legacy-simulated') then raise exception 'Historical evidence cannot be invented' using errcode='RC409'; end if;
  execution_time:=(evidence->>'executedAt')::timestamptz;
  occurrence_time:=(evidence->>'occurredAt')::timestamptz;
  closure_time:=(evidence->>'closedAt')::timestamptz;
  if ledger.evidence_provenance<>'legacy-simulated' and ((execution_time is not null and (not isfinite(execution_time) or execution_time<ledger.created_at
      or execution_time<(ledger.admission->>'notBefore')::timestamptz
      or execution_time>=(ledger.admission->>'notAfter')::timestamptz))
    or occurrence_time<execution_time or closure_time<ledger.created_at
    or (target_result->>'outcome'<>'not-executed' and evidence->>'originalOutcome'<>'indeterminate'
      and (evidence->>'originalOutcome' is distinct from target_result->>'outcome' or occurrence_time is distinct from execution_time))) then
    raise exception 'Payment observation violates its admitted execution window' using errcode='RC409'; end if;
  if ledger.current_outcome is not null and (
    (ledger.current_outcome<>'indeterminate' and ledger.current_outcome is distinct from target_result->>'outcome')
    or ledger.original_outcome is distinct from coalesce(evidence->>'originalOutcome','not-executed')
    or ledger.executed_at is distinct from execution_time
    or (ledger.provider_request_id,ledger.provider_reference) is distinct from
      (target_result->>'providerRequestId',target_result->>'providerReference')
    or (target_result->>'outcome' in ('succeeded','indeterminate') and ledger.movement_reference is distinct from target_result->>'movementReference')
    or (ledger.authoritative_outcome_at is not null and ledger.authoritative_outcome_at is distinct from occurrence_time)
  ) then raise exception 'Payment observation conflicts with admitted evidence' using errcode='RC409'; end if;
  insert into public.payment_provider_observations(operation_id,provider,environment,merchant_id,terminal_id,event_id,result,occurred_at,provenance)
    values(ledger.id,ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,evidence->>'eventId',target_result,occurrence_time,evidence->>'provenance')
    on conflict(provider,environment,merchant_id,terminal_id,event_id) do nothing returning * into accepted;
  if not found then
    select * into accepted from public.payment_provider_observations observations where
      (observations.provider,observations.environment,observations.merchant_id,observations.terminal_id,observations.event_id)=
      (ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,evidence->>'eventId');
    if accepted.operation_id is distinct from ledger.id or accepted.result is distinct from target_result then
      raise exception 'Payment event conflicts with accepted evidence' using errcode='RC409'; end if;
    return ledger;
  end if;
  update public.payment_provider_operations operations set
    original_outcome=coalesce(operations.original_outcome,evidence->>'originalOutcome','not-executed'),
    original_outcome_at=case when operations.current_outcome is null and evidence->>'originalOutcome'<>'indeterminate' then execution_time else operations.original_outcome_at end,
    executed_at=execution_time,current_outcome=target_result->>'outcome',provider_request_id=target_result->>'providerRequestId',
    provider_reference=target_result->>'providerReference',movement_reference=target_result->>'movementReference',
    authoritative_outcome_at=occurrence_time,recorded_at=accepted.received_at,updated_at=accepted.received_at,evidence_provenance=evidence->>'provenance'
    where operations.id=ledger.id returning * into ledger;
  return ledger;
end;
$$;

CREATE OR REPLACE FUNCTION public.payment_provider_recorded_result(target public.payment_provider_operations) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  select observations.result from public.payment_provider_observations observations where observations.operation_id=target.id
    and observations.result->>'outcome'=target.current_outcome
    and (observations.result->>'providerRequestId',observations.result->>'providerReference',observations.result->>'movementReference',observations.occurred_at)
      is not distinct from (target.provider_request_id,target.provider_reference,target.movement_reference,target.authoritative_outcome_at)
    and observations.provenance=target.evidence_provenance
    order by observations.id limit 1;
$$;

CREATE OR REPLACE FUNCTION public.lock_payment_observation_source(target_operation_id uuid,target_purposes text[]) RETURNS public.payment_provider_operations
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare ledger public.payment_provider_operations;
declare submission public.booking_request_submission_attempts;
declare request_id uuid;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Payment recording unavailable' using errcode='42501'; end if;
  select * into ledger from public.payment_provider_operations operations where operations.id=target_operation_id;
  if not found or ledger.admission->>'purpose'=any(target_purposes) is not true then
    raise exception 'Payment recording purpose is invalid' using errcode='RC409'; end if;
  select attempts.* into submission from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims on claims.attempt_id=attempts.id where claims.id=ledger.claim_id;
  request_id:=submission.booking_request_id;
  if ledger.admission->>'purpose' in ('booking-request-capture','booking-request-payment-recovery','booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund') then
    perform 1 from public.booking_requests requests where requests.id=request_id for update of requests;
    perform 1 from public.booking_request_capture_work work where work.booking_request_id=request_id for update of work;
  elsif ledger.admission->>'purpose'='booking-request-release' then
    perform 1 from public.booking_request_release_work work where work.id=(ledger.admission#>>'{permit,workId}')::uuid for update of work;
  end if;
  perform 1 from public.booking_request_submission_attempts attempts where attempts.id=submission.id for update of attempts;
  perform 1 from public.booking_request_authorization_claims claims where claims.id=ledger.claim_id for update of claims;
  if ledger.recovery_attempt_id is not null then
    perform 1 from public.booking_request_payment_recovery_attempts attempts where attempts.id=ledger.recovery_attempt_id for update of attempts;
  end if;
  if ledger.admission->>'purpose'='booking-request-release' then
    perform 1 from public.booking_request_release_operations operations where operations.id=(ledger.admission#>>'{permit,operationId}')::uuid for update of operations;
  elsif ledger.admission->>'purpose' in ('booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund') then
    perform 1 from public.booking_request_payment_required_expiry_work work where work.booking_request_id=request_id for update of work;
    perform 1 from public.booking_request_payment_required_expiry_operations operations where operations.id=(ledger.admission#>>'{permit,expiryOperationId}')::uuid for update of operations;
  end if;
  select * into ledger from public.payment_provider_operations operations where operations.id=target_operation_id for update of operations;
  return ledger;
end;
$$;

CREATE OR REPLACE FUNCTION public.record_booking_request_provider_operation_observation(target_operation_id uuid,target_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare ledger public.payment_provider_operations;
declare result jsonb;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-request-authorization','booking-request-submission-cleanup','booking-request-release']);
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  if ledger.admission->>'purpose'='booking-request-release' and ledger.current_outcome='not-executed' then
    update public.booking_request_release_operations operations set state='retryable',provider_outcome='not_executed',retry_safe=true,
      result_recorded_at=clock_timestamp(),updated_at=clock_timestamp()
      where operations.id=(ledger.admission#>>'{permit,operationId}')::uuid
        and operations.state in ('executing','reconcile_required');
  end if;
  result:=public.payment_provider_recorded_result(ledger);
  if ledger.current_outcome='failed' then result:=result||jsonb_build_object('retrySafe',ledger.operation_kind='release'); end if;
  return result;
end;
$$;

CREATE OR REPLACE FUNCTION public.record_booking_request_capture_observation(target_operation_id uuid,target_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare ledger public.payment_provider_operations;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-request-capture']);
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  return public.payment_provider_recorded_result(ledger);
end;
$$;

CREATE OR REPLACE FUNCTION public.record_booking_request_payment_recovery_observation(target_operation_id uuid,target_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare ledger public.payment_provider_operations;
declare attempt public.booking_request_payment_recovery_attempts;
declare work public.booking_request_capture_work;
declare recovery_step text;
declare result jsonb;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-request-payment-recovery']);
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  select * into attempt from public.booking_request_payment_recovery_attempts attempts where attempts.id=ledger.recovery_attempt_id;
  select * into work from public.booking_request_capture_work capture_work where capture_work.booking_request_id=attempt.booking_request_id;
  recovery_step:=ledger.admission#>>'{permit,step}';
  -- A closed admission is evidence, not an executed recovery operation.
  if ledger.current_outcome<>'not-executed' then
    insert into public.booking_request_payment_recovery_operations(recovery_attempt_id,step,provider_operation_id,outcome,authoritative_outcome_at,execution_permit)
      values(attempt.id,recovery_step,ledger.id,ledger.current_outcome,ledger.authoritative_outcome_at,ledger.admission->'permit')
      on conflict(recovery_attempt_id,step,operation_generation) do update set outcome=excluded.outcome,authoritative_outcome_at=excluded.authoritative_outcome_at,updated_at=clock_timestamp()
        where booking_request_payment_recovery_operations.provider_operation_id=excluded.provider_operation_id
          and (booking_request_payment_recovery_operations.outcome,booking_request_payment_recovery_operations.authoritative_outcome_at)
            is distinct from (excluded.outcome,excluded.authoritative_outcome_at);
    if not exists(select 1 from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=attempt.id and operations.step=recovery_step and operations.operation_generation=1 and operations.provider_operation_id=ledger.id) then
      raise exception 'Recovery observation targets another operation' using errcode='RC409'; end if;
    if not public.booking_request_payment_quarantined(work.booking_request_id) and (attempt.state='blocked' or attempt.state=(case recovery_step when 'original-release' then 'admitted'
      when 'replacement-authorization' then 'original_released' when 'replacement-capture' then 'replacement_authorized' when 'replacement-release' then 'capture_failed' end)) then
      perform public.record_booking_request_recovery_outcome(attempt.id,recovery_step,ledger,work.payment_required_deadline);
    end if;
    if ledger.operation_kind='capture' and ledger.current_outcome='succeeded' and ledger.authoritative_outcome_at>=work.payment_required_deadline then
      perform public.invalidate_booking_request_payment_confirmation(work.booking_request_id,ledger.id,'late-capture');
    end if;
  end if;
  result:=public.payment_provider_recorded_result(ledger);
  if ledger.current_outcome='failed' then result:=result||jsonb_build_object('retrySafe',exists(select 1 from public.booking_request_payment_recovery_attempts attempts where attempts.id=attempt.id and attempts.state='safely_failed')); end if;
  return result;
end;
$$;

CREATE OR REPLACE FUNCTION public.record_booking_request_payment_required_expiry_observation(target_operation_id uuid,target_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare ledger public.payment_provider_operations;
declare target public.booking_request_payment_required_expiry_operations;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-request-payment-required-expiry','booking-request-payment-required-corrective-refund']);
  select * into target from public.booking_request_payment_required_expiry_operations operations where operations.id=(ledger.admission#>>'{permit,expiryOperationId}')::uuid;
  if target.id is null or (target.provider_operation_id is not null and target.provider_operation_id<>ledger.id) then
    raise exception 'Expiry observation targets another operation' using errcode='RC409'; end if;
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  update public.booking_request_payment_required_expiry_operations operations set provider_operation_id=ledger.id where operations.id=target.id;
  if ledger.current_outcome<>'succeeded' then
    perform public.quarantine_booking_request_payment(target.booking_request_id,'expiry-'||target.operation_kind||'-'||ledger.current_outcome);
  end if;
  return public.payment_provider_recorded_result(ledger);
end;
$$;

CREATE OR REPLACE FUNCTION public.guard_payment_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
  if tg_op='DELETE' or tg_table_name='payment_provider_observations' then
    raise exception 'Accepted payment evidence is immutable' using errcode='RC409'; end if;
  if (to_jsonb(new)-array['original_outcome','current_outcome','provider_request_id','provider_reference','movement_reference','original_outcome_at','executed_at','recorded_at','authoritative_outcome_at','updated_at','evidence_provenance'])
      is distinct from (to_jsonb(old)-array['original_outcome','current_outcome','provider_request_id','provider_reference','movement_reference','original_outcome_at','executed_at','recorded_at','authoritative_outcome_at','updated_at','evidence_provenance'])
    or (old.current_outcome is not null and (new.original_outcome,new.original_outcome_at,new.executed_at,new.provider_request_id,new.provider_reference)
      is distinct from (old.original_outcome,old.original_outcome_at,old.executed_at,old.provider_request_id,old.provider_reference)) then
    raise exception 'Payment admission identity is immutable' using errcode='RC409'; end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.pending_booking_request_authorization_observations() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Payment inquiry unavailable' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(public.payment_operation_admission(pending) order by pending.created_at,pending.id),'[]'::jsonb)
    from (select operations.* from public.payment_provider_operations operations
      join public.booking_request_authorization_claims claims on claims.id=operations.claim_id
      where public.booking_request_claim_state_is_active(claims.state) and claims.reconciliation_expires_at<=clock_timestamp()
        and operations.admission->>'purpose' in ('booking-request-authorization','booking-request-submission-cleanup')
        and (operations.current_outcome is null or operations.current_outcome='indeterminate')
      order by operations.created_at,operations.id limit 50) pending);
end;
$$;

ALTER TABLE ONLY "public"."payment_provider_observations" ADD CONSTRAINT "payment_provider_observations_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."payment_provider_observations" ADD CONSTRAINT "payment_provider_observations_operation_fkey" FOREIGN KEY (operation_id) REFERENCES public.payment_provider_operations(id) ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."payment_provider_observations" ADD CONSTRAINT "payment_provider_observations_event_key" UNIQUE (provider,environment,merchant_id,terminal_id,event_id);

ALTER TABLE ONLY "public"."simulated_payment_effects" ADD CONSTRAINT "simulated_payment_effects_pkey" PRIMARY KEY (operation_id);

ALTER TABLE ONLY "public"."simulated_payment_effects" ADD CONSTRAINT "simulated_payment_effects_idempotency_key" UNIQUE (provider,environment,merchant_id,terminal_id,idempotency_key);

CREATE INDEX payment_provider_observations_operation_idx ON public.payment_provider_observations USING btree (operation_id,received_at,id);

CREATE OR REPLACE TRIGGER guard_payment_provider_admission BEFORE UPDATE OR DELETE ON public.payment_provider_operations FOR EACH ROW EXECUTE FUNCTION public.guard_payment_evidence();

CREATE OR REPLACE TRIGGER guard_payment_provider_observation BEFORE UPDATE OR DELETE ON public.payment_provider_observations FOR EACH ROW EXECUTE FUNCTION public.guard_payment_evidence();

ALTER TABLE "public"."payment_provider_observations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."simulated_payment_effects" ENABLE ROW LEVEL SECURITY;

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_provider_operations" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_provider_operations" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_provider_operations" FROM "service_role";

REVOKE ALL ON FUNCTION "public"."record_booking_request_recovery_outcome"("target_attempt_id" "uuid", "target_step" "text", "target_ledger" "public"."payment_provider_operations", "target_deadline" timestamp with time zone) FROM PUBLIC;

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_provider_observations" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_provider_observations" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_provider_observations" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."simulated_payment_effects" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."simulated_payment_effects" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."simulated_payment_effects" FROM "service_role";

REVOKE ALL ON FUNCTION public.payment_operation_admission(public.payment_provider_operations,boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.validate_payment_provider_observation(jsonb,uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.validate_simulated_payment_binding(jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.simulated_payment_absence_receipt(jsonb,timestamptz) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.persist_simulated_payment_effect(jsonb,jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.persist_simulated_payment_effect(jsonb,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.seal_simulated_payment_absence(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.seal_simulated_payment_absence(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_simulated_payment_effect(jsonb,text,jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_simulated_payment_effect(jsonb,text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.admit_booking_request_provider_operation(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admit_booking_request_provider_operation(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.admit_booking_request_capture(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admit_booking_request_capture(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.admit_booking_request_payment_recovery(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admit_booking_request_payment_recovery(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.admit_booking_request_payment_required_expiry(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admit_booking_request_payment_required_expiry(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.reload_booking_request_payment_operation(jsonb,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reload_booking_request_payment_operation(jsonb,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.accept_payment_provider_observation(uuid,jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.payment_provider_recorded_result(public.payment_provider_operations) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.lock_payment_observation_source(uuid,text[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.record_booking_request_provider_operation_observation(uuid,jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_booking_request_provider_operation_observation(uuid,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.record_booking_request_capture_observation(uuid,jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_booking_request_capture_observation(uuid,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.record_booking_request_payment_recovery_observation(uuid,jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_booking_request_payment_recovery_observation(uuid,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.record_booking_request_payment_required_expiry_observation(uuid,jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_booking_request_payment_required_expiry_observation(uuid,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.guard_payment_evidence() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.pending_booking_request_authorization_observations() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.pending_booking_request_authorization_observations() TO service_role;

ALTER TABLE public.payment_provider_operations ENABLE TRIGGER observe_payment_history_provider_operation;
COMMIT;
