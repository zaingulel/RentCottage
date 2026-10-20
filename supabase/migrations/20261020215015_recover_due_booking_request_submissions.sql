-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.due_booking_request_submission_recoveries (
  target_provider_identity jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Booking Request recovery unavailable' using errcode='42501'; end if;
  if jsonb_typeof(target_provider_identity) is distinct from 'object' then
    raise exception 'Invalid payment provider identity' using errcode='22023';
  end if;
  if (select count(*) from jsonb_object_keys(target_provider_identity))<>4
    or not target_provider_identity ?& array['provider','environment','merchantId','terminalId']
    or exists(select 1 from jsonb_each(target_provider_identity) entry
      where jsonb_typeof(entry.value)<>'string' or entry.value='""'::jsonb) then
    raise exception 'Invalid payment provider identity' using errcode='22023';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id',due.id,'paymentLifecycleId',due.payment_lifecycle_id,
      'bookingPriceFils',due.booking_price_fils,'bookingServiceFeeFils',due.booking_service_fee_fils,
      'paymentSnapshot',due.payment_snapshot,
      'paymentProviderIdentity',jsonb_build_object('provider',due.provider,'environment',due.environment,
        'merchantId',due.merchant_id,'terminalId',due.terminal_id)
    ) order by due.updated_at,due.id),'[]'::jsonb)
    from (select attempts.id,attempts.payment_lifecycle_id,attempts.payment_snapshot,attempts.updated_at,
        (attempts.quote_payload->>'bookingPriceIqd')::bigint*1000 as booking_price_fils,
        (attempts.quote_payload->>'serviceFeeIqd')::bigint*1000 as booking_service_fee_fils,
        claims.provider,claims.environment,claims.merchant_id,claims.terminal_id
      from public.booking_request_submission_attempts attempts
      join public.booking_request_authorization_claims claims
        on claims.attempt_id=attempts.id and claims.payment_lifecycle_id=attempts.payment_lifecycle_id
      where claims.state in ('authorized','releasing')
        and claims.reconciliation_expires_at<=statement_timestamp()
        and attempts.booking_request_id is null
        and attempts.payment_snapshot->'authorization'->>'status'='succeeded'
        and attempts.payment_snapshot->'authorization'->'reconciliationRequired'='false'::jsonb
        and claims.provider=target_provider_identity->>'provider'
        and claims.environment=target_provider_identity->>'environment'
        and claims.merchant_id=target_provider_identity->>'merchantId'
        and claims.terminal_id=target_provider_identity->>'terminalId'
        and attempts.authorization_provider=claims.provider
        and attempts.authorization_environment=claims.environment
        and attempts.authorization_merchant_id=claims.merchant_id
        and attempts.authorization_terminal_id=claims.terminal_id
      order by attempts.updated_at,attempts.id limit 50) due);
end;
$function$;

REVOKE ALL ON FUNCTION public.due_booking_request_submission_recoveries(jsonb) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.due_booking_request_submission_recoveries(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_booking_request_authorization_claims()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;