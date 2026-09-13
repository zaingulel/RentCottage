-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.booking_cancellation_source_facts (
  target_booking_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare request public.booking_requests;
declare confirmation public.booking_confirmations;
declare snapshot public.booking_snapshots;
declare commitment public.cottage_booking_period_commitments;
declare capture public.payment_provider_operations;
declare first_start timestamptz;
declare projected jsonb;
begin
  select * into request from public.booking_requests where id=target_booking_request_id;
  select * into confirmation from public.booking_confirmations where booking_request_id=request.id;
  select * into snapshot from public.booking_snapshots where id=request.booking_snapshot_id;
  select * into commitment from public.cottage_booking_period_commitments where id=request.booking_period_commitment_id;
  select * into capture from public.payment_provider_operations where id=confirmation.capture_operation_id;
  if confirmation.id IS NULL OR snapshot.id IS NULL OR commitment.id IS NULL OR capture.id IS NULL OR
    (confirmation.booking_snapshot_id,confirmation.booking_period_commitment_id) IS DISTINCT FROM (snapshot.id,commitment.id) OR
    (snapshot.customer_user_id,snapshot.profile_id,commitment.customer_user_id,commitment.profile_id) IS DISTINCT FROM
      (request.customer_user_id,request.profile_id,request.customer_user_id,request.profile_id) OR
    capture.operation_kind IS DISTINCT FROM 'capture' OR capture.current_outcome IS DISTINCT FROM 'succeeded' OR capture.recorded_at IS NULL OR
    capture.amount_fils IS DISTINCT FROM ((snapshot.quote_payload->>'bookingPriceIqd')::bigint+(snapshot.quote_payload->>'serviceFeeIqd')::bigint)*1000 OR
    (public.booking_request_payment_status(request) IS DISTINCT FROM 'paid-confirmed' AND NOT EXISTS(select 1 from public.booking_cancellations where booking_request_id=request.id))
  THEN raise exception 'Confirmed booking source is invalid' using errcode='RC409'; END IF;
  first_start:=(snapshot.quote_payload#>>'{items,0,startsAt}')::timestamptz;
  if first_start IS NULL OR first_start IS DISTINCT FROM lower(range_merge(commitment.access_ranges)) THEN
    raise exception 'Purchased first shift is invalid' using errcode='RC409'; END IF;
  projected:=jsonb_build_object('bookingRequestId',request.id,'confirmationId',confirmation.id,'captureOperationId',capture.id,
    'firstStartsAt',first_start,'captured',jsonb_build_object('bookingPriceFils',(snapshot.quote_payload->>'bookingPriceIqd')::bigint*1000,
      'bookingServiceFeeFils',(snapshot.quote_payload->>'serviceFeeIqd')::bigint*1000));
  return projected;
end;
$function$;

REVOKE ALL ON FUNCTION public.booking_cancellation_source_facts(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.booking_capture_refund_totals_facts (
  target_capture_id uuid,
  target_captured   jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare capture public.payment_provider_operations;
declare owned record;
declare state text;
declare refunded_price bigint:=0; declare refunded_fee bigint:=0;
declare reserved_price bigint:=0; declare reserved_fee bigint:=0;
begin
  select * into capture from public.payment_provider_operations where id=target_capture_id;
  if capture.id is null or capture.operation_kind<>'capture' or capture.current_outcome<>'succeeded'
    or capture.amount_fils<>(target_captured->>'bookingPriceFils')::bigint+(target_captured->>'bookingServiceFeeFils')::bigint then
    raise exception 'Refund capacity capture is invalid' using errcode='RC409'; end if;
  for owned in select * from public.booking_refund_intents where capture_operation_id=capture.id order by created_at,id loop
    state:=public.booking_refund_intent_state(owned.id);
    if state='succeeded' then refunded_price:=refunded_price+owned.booking_price_fils; refunded_fee:=refunded_fee+owned.booking_service_fee_fils;
    elsif state<>'failed' then reserved_price:=reserved_price+owned.booking_price_fils; reserved_fee:=reserved_fee+owned.booking_service_fee_fils; end if;
  end loop;
  for owned in select corrective.*,ledger.current_outcome from public.booking_request_payment_required_expiry_operations corrective
    left join public.payment_provider_operations ledger on ledger.id=corrective.provider_operation_id
      or (corrective.provider_operation_id is null and ledger.provider_idempotency_key=corrective.provider_idempotency_key
        and (ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id)=(corrective.provider,corrective.environment,corrective.merchant_id,corrective.terminal_id))
    where corrective.capture_provider_operation_id=capture.id and corrective.operation_kind='refund' loop
    if owned.amount_fils<>capture.amount_fils then raise exception 'Corrective refund allocation is invalid' using errcode='RC409'; end if;
    if owned.current_outcome='succeeded' then
      refunded_price:=refunded_price+(target_captured->>'bookingPriceFils')::bigint; refunded_fee:=refunded_fee+(target_captured->>'bookingServiceFeeFils')::bigint;
    elsif owned.current_outcome is null or owned.current_outcome='indeterminate' then
      reserved_price:=reserved_price+(target_captured->>'bookingPriceFils')::bigint; reserved_fee:=reserved_fee+(target_captured->>'bookingServiceFeeFils')::bigint;
    end if;
  end loop;
  if refunded_price+reserved_price>(target_captured->>'bookingPriceFils')::bigint or refunded_fee+reserved_fee>(target_captured->>'bookingServiceFeeFils')::bigint then
    raise exception 'Refund allocations exceed the captured components' using errcode='RC409'; end if;
  return jsonb_build_object('refunded',jsonb_build_object('bookingPriceFils',refunded_price,'bookingServiceFeeFils',refunded_fee),
    'reserved',jsonb_build_object('bookingPriceFils',reserved_price,'bookingServiceFeeFils',reserved_fee));
end;
$function$;

REVOKE ALL ON FUNCTION public.booking_capture_refund_totals_facts(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.booking_capture_refund_totals (
  target_capture_id uuid,
  target_captured   jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform 1 from public.payment_provider_operations where id=target_capture_id for update;
  return public.booking_capture_refund_totals_facts(target_capture_id,target_captured);
end;
$function$;

CREATE FUNCTION public.booking_completion_eligibility_at (
  target_request_id uuid,
  observed          timestamp with time zone
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare request_id uuid:=target_request_id; declare maturity record;
begin
  select * into maturity from public.booking_completion_maturity where booking_request_id=request_id;
  if maturity.booking_request_id is null
    or exists(select 1 from public.booking_request_confirmation_invalidations where booking_request_id=request_id)
    or exists(select 1 from public.booking_request_payment_required_expiry_work where booking_request_id=request_id and state='quarantined')
    or (maturity.outcome='late_customer_cancellation' and exists(
      select 1 from public.booking_cancellations cancellations join public.booking_incidents incidents using(booking_request_id)
      where cancellations.id=maturity.cancellation_id and cancellations.booking_request_id=request_id
        and incidents.recorded_at<=cancellations.occurred_at))
  then return jsonb_build_object('status','unavailable','reviewAvailable',false,'payoutPrerequisiteAvailable',false); end if;
  return jsonb_build_object('status',maturity.outcome,'effectivePeriodEnd',maturity.effective_period_end,'assessedAt',maturity.assessed_at,
    'reviewExpiresAt',maturity.review_expires_at,'reviewAvailable',public.booking_review_is_available(maturity.effective_period_end,maturity.review_expires_at,observed),
    'payoutPrerequisiteAt',maturity.payout_prerequisite_at,'payoutPrerequisiteAvailable',observed>=maturity.payout_prerequisite_at);
end;
$function$;

REVOKE ALL ON FUNCTION public.booking_completion_eligibility_at(uuid, timestamp WITH time zone) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.booking_completion_eligibility (
  target_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  return public.booking_completion_eligibility_at(target_request_id,clock_timestamp());
end;
$function$;

CREATE FUNCTION public.booking_owner_earnings_facts (
  target_booking_request_id uuid,
  observed_at               timestamp with time zone
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare facts jsonb; declare totals jsonb; declare snapshot public.booking_snapshots;
declare cancellation public.booking_cancellations; declare owner_projection jsonb; declare owner_earnings jsonb;
begin
  facts:=public.booking_cancellation_source_facts(target_booking_request_id);
  perform public.booking_refund_source_facts(target_booking_request_id);
  totals:=public.booking_capture_refund_totals_facts((facts->>'captureOperationId')::uuid,facts->'captured');
  select snapshots.* into snapshot from public.booking_snapshots snapshots
    join public.booking_requests request on request.booking_snapshot_id=snapshots.id where request.id=target_booking_request_id;
  select * into cancellation from public.booking_cancellations where booking_request_id=target_booking_request_id;
  begin
    owner_projection:=public.booking_payout_command_facts(target_booking_request_id,
      facts||totals||jsonb_build_object(
        'obligation',jsonb_build_object('bookingPriceFils',coalesce(cancellation.refund_booking_price_fils,0),'bookingServiceFeeFils',coalesce(cancellation.refund_booking_service_fee_fils,0)),
        'intents',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'state',public.booking_refund_intent_state(id),'automatic',source='cancellation') order by created_at,id),'[]') from public.booking_refund_intents where booking_request_id=target_booking_request_id)));
    owner_projection:=public.booking_settlement_projection_facts_at(target_booking_request_id,owner_projection,observed_at);
    if owner_projection->'captured' is null or owner_projection->'refunded' is null or owner_projection->'reserved' is null
      or owner_projection->'obligation' is null or owner_projection->'maturity' is null or owner_projection->'recovery' is null
      or owner_projection#>>'{recovery,status}'='unavailable'
      or ((owner_projection#>>'{settlement,state}' is not distinct from 'succeeded') is distinct from
        (owner_projection#>>'{recovery,status}'='paid' and owner_projection#>'{settlement,receipt}' is not null and owner_projection#>'{settlement,receipt}'<>'null'::jsonb))
      or (owner_projection#>'{settlement,receipt}' is not null and owner_projection#>'{settlement,receipt}'<>'null'::jsonb and owner_projection#>>'{settlement,state}'<>'succeeded')
    then
      owner_earnings:='{"status":"unavailable"}'::jsonb;
    else
      owner_earnings:=jsonb_build_object(
        'status','captured','captured',owner_projection->'captured','refunded',owner_projection->'refunded','reserved',owner_projection->'reserved','obligation',owner_projection->'obligation',
        'marketplaceCommissionRateBasisPoints',snapshot.marketplace_commission_rate_basis_points,'marketplaceCommissionAmountFils',snapshot.marketplace_commission_amount_fils,
        'refunds',(select coalesce(jsonb_agg(jsonb_build_object('state',public.booking_refund_intent_state(id),'allocation',jsonb_build_object('bookingPriceFils',booking_price_fils,'bookingServiceFeeFils',booking_service_fee_fils)) order by created_at,id),'[]') from public.booking_refund_intents where booking_request_id=target_booking_request_id),
        'maturity',owner_projection->'maturity','administratorHoldActive',jsonb_array_length(owner_projection->'activeHoldIds')>0,
        'disputes',(select coalesce(jsonb_agg(jsonb_build_object('state',dispute->>'state','outcome',(select command->'outcome' from jsonb_array_elements(owner_projection->'commands') command where command->>'commandId'=dispute->>'resolutionId'))),'[]') from jsonb_array_elements(owner_projection->'disputes') dispute),
        'settlement',case when owner_projection->'settlement' is not null and owner_projection->'settlement'<>'null'::jsonb then jsonb_build_object(
          'amountFils',owner_projection#>'{settlement,amountFils}','state',owner_projection#>'{settlement,state}','retrySafe',owner_projection#>'{settlement,retrySafe}',
          'receipt',case when owner_projection#>'{settlement,receipt}' is not null and owner_projection#>'{settlement,receipt}'<>'null'::jsonb then jsonb_build_object('paidFils',owner_projection#>'{settlement,amountFils}','recordedAt',owner_projection#>'{settlement,receipt,recordedAt}') end) end,
        'recovery',owner_projection->'recovery');
    end if;
  exception when sqlstate 'RC409' or data_exception or integrity_constraint_violation then
    owner_earnings:='{"status":"unavailable"}'::jsonb;
  end;
  return owner_earnings;
exception when sqlstate 'RC409' then
  return '{"status":"unavailable"}'::jsonb;
end;
$function$;

REVOKE ALL ON FUNCTION public.booking_owner_earnings_facts(uuid, timestamp WITH time zone) FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.booking_payout_command_facts(uuid, jsonb) STABLE;

CREATE FUNCTION public.booking_refund_source_facts (
  target_booking_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare request public.booking_requests;
declare confirmation public.booking_confirmations;
declare snapshot public.booking_snapshots;
declare capture public.payment_provider_operations;
begin
  select * into request from public.booking_requests where id=target_booking_request_id;
  select * into confirmation from public.booking_confirmations where booking_request_id=request.id;
  select * into snapshot from public.booking_snapshots where id=request.booking_snapshot_id;
  select * into capture from public.payment_provider_operations where id=confirmation.capture_operation_id;
  if request.id is null or confirmation.id is null or snapshot.id is null or capture.id is null
    or capture.operation_kind is distinct from 'capture' or capture.current_outcome is distinct from 'succeeded'
    or capture.recorded_at is null or capture.movement_reference is null or capture.authoritative_outcome_at is null
    or (confirmation.booking_snapshot_id,confirmation.booking_period_commitment_id) is distinct from (snapshot.id,request.booking_period_commitment_id)
    or capture.amount_fils is distinct from ((snapshot.quote_payload->>'bookingPriceIqd')::bigint+(snapshot.quote_payload->>'serviceFeeIqd')::bigint)*1000
    or exists(select 1 from public.booking_request_confirmation_invalidations where booking_request_id=request.id)
    or exists(select 1 from public.booking_request_payment_required_expiry_work where booking_request_id=request.id and state='quarantined') then
    raise exception 'Refund capture source is invalid' using errcode='RC409'; end if;
  return jsonb_build_object('bookingRequestId',request.id,'captureOperationId',capture.id,
    'captured',jsonb_build_object('bookingPriceFils',(snapshot.quote_payload->>'bookingPriceIqd')::bigint*1000,'bookingServiceFeeFils',(snapshot.quote_payload->>'serviceFeeIqd')::bigint*1000));
end;
$function$;

REVOKE ALL ON FUNCTION public.booking_refund_source_facts(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.booking_settlement_projection_facts_at (
  target_booking_request_id uuid,
  source                    jsonb,
  observed_at               timestamp with time zone
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare projected jsonb; declare snapshot public.booking_snapshots;
declare intent public.booking_settlement_intents; declare attempt public.booking_settlement_attempts; declare ledger public.payment_provider_operations;
begin
  select snapshots.* into snapshot from public.booking_snapshots snapshots join public.booking_requests request on request.booking_snapshot_id=snapshots.id where request.id=target_booking_request_id;
  if snapshot.marketplace_commission_rate_basis_points is distinct from 1000
    or snapshot.marketplace_commission_amount_fils is distinct from (source#>>'{captured,bookingPriceFils}')::bigint/10
    or (source#>>'{captured,bookingPriceFils}')::bigint%10<>0 then
    raise exception 'Original settlement allocation is unavailable' using errcode='RC409'; end if;
  select * into intent from public.booking_settlement_intents where booking_request_id=target_booking_request_id;
  select * into attempt from public.booking_settlement_attempts where settlement_intent_id=intent.id order by generation desc limit 1;
  select * into ledger from public.payment_provider_operations where admission->>'purpose'='booking-settlement' and admission#>>'{permit,attemptId}'=attempt.id::text;
  projected:=source||jsonb_build_object('recovery',public.booking_settlement_recovery(target_booking_request_id,source->'captured',source->'refunded'),'maturity',public.booking_completion_eligibility_at(target_booking_request_id,observed_at),
    'settlement',case when intent.id is not null then jsonb_build_object('id',intent.id,'commandId',intent.command_id,'amountFils',intent.amount_fils,'actorUserId',intent.actor_user_id,'reason',intent.reason,'requestedAt',intent.created_at,
      'receipt',(select jsonb_build_object('observationId',r.observation_id,'historySequence',r.history_sequence,'recordedAt',o.received_at,'activeHoldIds',to_jsonb(r.active_hold_ids),'activeDisputeIds',to_jsonb(r.active_dispute_ids)) from public.booking_settlement_receipts r join public.payment_provider_observations o on o.id=r.observation_id where r.settlement_intent_id=intent.id),
      'state',case when ledger.id is null then 'requested' else coalesce(ledger.current_outcome,'processing') end,
      'retrySafe',coalesce((public.payment_provider_recorded_result(ledger)->>'retrySafe')::boolean,false)) end);
  return projected||jsonb_build_object('revision',md5(projected::text));
end;
$function$;

REVOKE ALL ON FUNCTION public.booking_settlement_projection_facts_at(uuid, jsonb, timestamp WITH time zone) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.booking_settlement_projection_facts (
  target_booking_request_id uuid,
  source                    jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  return public.booking_settlement_projection_facts_at(target_booking_request_id,source,clock_timestamp());
end;
$function$;

ALTER FUNCTION public.booking_settlement_recovery(uuid, jsonb, jsonb) STABLE;

CREATE OR REPLACE FUNCTION public.get_booking_cancellation_facts (
  target_booking_request_id uuid,
  target_actor_role         text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=(select auth.uid());
declare context public.account_contexts;
declare request public.booking_requests;
declare confirmation public.booking_confirmations;
declare projected jsonb;
begin
  select * into context from public.account_contexts where user_id=actor;
  select * into request from public.booking_requests where id=target_booking_request_id for update;
  if actor IS NULL OR request.id IS NULL OR context.user_id IS NULL OR NOT (
    (target_actor_role='platform_administrator' AND public.is_platform_administrator('aal2')) OR
    (exists(select 1 from auth.users where id=actor and phone_confirmed_at IS NOT NULL) AND (
      (target_actor_role='customer' AND context.role IN ('customer','cottage_owner') AND request.customer_user_id=actor) OR
      (target_actor_role='cottage_owner' AND context.role='cottage_owner' AND context.owner_approval_state='approved' AND request.owner_user_id=actor)
    ))
  ) IS TRUE THEN raise exception 'Booking cancellation is unavailable' using errcode='42501'; END IF;
  select * into confirmation from public.booking_confirmations where booking_request_id=request.id;
  perform 1 from public.cottage_booking_period_commitments where id=request.booking_period_commitment_id for update;
  perform 1 from public.booking_request_capture_work where booking_request_id=request.id for update;
  perform 1 from public.payment_provider_operations where id=confirmation.capture_operation_id for update;
  projected:=public.booking_cancellation_source_facts(target_booking_request_id);
  return projected||jsonb_build_object('revision',md5(projected::text),'observedAt',clock_timestamp());
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_booking_financial_view (
  target_reference  text,
  target_actor_role text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare request public.booking_requests; declare snapshot public.booking_snapshots; declare commitment public.cottage_booking_period_commitments;
declare cancellation public.booking_cancellations; declare facts jsonb; declare totals jsonb; declare result jsonb;
begin
  select * into request from public.booking_requests where booking_request_reference=target_reference;
  if request.id is null or not exists(select 1 from public.booking_confirmations where booking_request_id=request.id)
    or (public.booking_request_payment_status(request) is distinct from 'paid-confirmed' and not exists(select 1 from public.booking_cancellations where booking_request_id=request.id)) then return null; end if;
  -- Reuse the same role, participant, approval and administrator MFA authority as cancellation.
  facts:=public.get_booking_cancellation_facts(request.id,target_actor_role);
  perform public.lock_booking_refund_source(request.id);
  totals:=public.booking_capture_refund_totals((facts->>'captureOperationId')::uuid,facts->'captured');
  select * into snapshot from public.booking_snapshots where id=request.booking_snapshot_id;
  select * into commitment from public.cottage_booking_period_commitments where id=request.booking_period_commitment_id;
  select * into cancellation from public.booking_cancellations where booking_request_id=request.id;
  result:=jsonb_build_object('bookingRequestId',request.id,'bookingRequestReference',request.booking_request_reference,'bookingReference',commitment.commitment_reference,
    'actorRole',target_actor_role,'cottageName',snapshot.quote_payload->>'cottageName','firstStartsAt',facts->'firstStartsAt','bookingTermsBody',snapshot.booking_terms_body,
    'captured',facts->'captured','refunded',totals->'refunded','reserved',totals->'reserved',
    'cancellation',case when cancellation.id is not null then jsonb_build_object('occurredAt',cancellation.occurred_at,'obligation',jsonb_build_object('bookingPriceFils',cancellation.refund_booking_price_fils,'bookingServiceFeeFils',cancellation.refund_booking_service_fee_fils)) end,
    'refunds',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'occurredAt',created_at,'source',source,'state',public.booking_refund_intent_state(id),'allocation',jsonb_build_object('bookingPriceFils',booking_price_fils,'bookingServiceFeeFils',booking_service_fee_fils)) order by created_at,id),'[]') from public.booking_refund_intents where booking_request_id=request.id),
    'notifications',(select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('eventId',e.id,'receiptId',e.receipt_id,'kind',e.event_kind,'dueAt',e.due_at,'recipientRole',e.recipient_role,'state',coalesce(w.state,'pending'),'deliveredAt',w.delivered_at,'outcome',w.last_outcome,'retryAllowed',coalesce(target_actor_role<>'platform_administrator' and w.state='retryable' and public.booking_notification_is_deliverable(w),false))) order by e.created_at,e.id),'[]') from public.booking_notification_events e left join public.booking_confirmation_notification_work w on w.event_id=e.id where e.booking_request_id=request.id and (target_actor_role='platform_administrator' or (e.recipient_user_id=(select auth.uid()) and e.recipient_role=target_actor_role))));
  if target_actor_role='platform_administrator' then
    result:=result||jsonb_build_object('payout',public.get_booking_settlement_facts(request.id),'audit',jsonb_build_object('cancellation',case when cancellation.id is not null then jsonb_build_object('reason',cancellation.reason,'category',cancellation.category,'actorUserId',cancellation.actor_user_id,'actorRole',cancellation.actor_role) end,
      'refunds',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'reason',reason,'actorUserId',actor_user_id) order by created_at,id),'[]') from public.booking_refund_intents where booking_request_id=request.id and source='administrator')));
  end if;
  if target_actor_role='cottage_owner' then
    result:=result||jsonb_build_object('ownerEarnings',public.booking_owner_earnings_facts(request.id,clock_timestamp()));
  end if;
  if target_actor_role in ('cottage_owner','platform_administrator') then result:=result||jsonb_build_object('ownerPayout',public.booking_settlement_recovery(request.id,facts->'captured',totals->'refunded')); end if;
  result:=result||jsonb_build_object('lifecycle',public.get_booking_lifecycle(target_reference,target_actor_role),'eligibility',public.get_booking_completion_eligibility(target_reference,target_actor_role));
  return result;
end;
$function$;

ALTER FUNCTION public.get_booking_lifecycle(text, text) STABLE;

CREATE OR REPLACE FUNCTION public.get_booking_payout_facts (
  target_booking_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare source jsonb;
begin
  if current_setting('role',true)<>'service_role' and not public.is_platform_administrator('aal2') then
    raise exception 'Payout facts unavailable' using errcode='42501'; end if;
  source:=public.get_booking_refund_facts(target_booking_request_id);
  return public.booking_payout_command_facts(target_booking_request_id,source);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_booking_history (
  target_actor_role text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=(select auth.uid()); declare context public.account_contexts;
begin
  select * into context from public.account_contexts where user_id=actor;
  if actor is null or context.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null)
    or target_actor_role not in ('customer','cottage_owner')
    or (target_actor_role='customer' and context.role not in ('customer','cottage_owner'))
    or (target_actor_role='cottage_owner' and (context.role<>'cottage_owner' or context.owner_approval_state<>'approved'))
  then raise exception 'Booking History unavailable' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(source.item order by source.created_at desc,source.booking_request_id,source.actor_role),'[]'::jsonb) from (
    select requests.created_at,requests.id booking_request_id,target_actor_role actor_role,
      jsonb_strip_nulls(jsonb_build_object(
        'bookingRequestId',requests.id,'bookingRequestReference',requests.booking_request_reference,
        'bookingReference',case when access.paid_access then commitments.commitment_reference end,
        'receiptId',case when access.paid_access then receipts.id end,'cottageName',snapshots.quote_payload->>'cottageName','createdAt',requests.created_at,
        'confirmedAt',case when access.paid_access then confirmations.confirmed_at end,'firstStartsAt',(select min(lower(period)) from unnest(commitments.access_ranges) period),
        'lastEndsAt',(select max(upper(period)) from unnest(commitments.access_ranges) period),'actorRole',target_actor_role,
        'status',case when access.paid_access
          then public.get_booking_lifecycle(requests.booking_request_reference,target_actor_role)->>'status'
          else coalesce(public.booking_request_payment_status(requests),requests.status) end))
        ||case when target_actor_role='cottage_owner' then jsonb_build_object('ownerEarnings',case when access.paid_access
          then public.booking_owner_earnings_facts(requests.id,statement_timestamp())
          when confirmations.id is not null or public.booking_request_payment_status(requests) in ('capture-processing','payment-required','paid-confirmed')
          then '{"status":"unavailable"}'::jsonb else '{"status":"not-captured"}'::jsonb end) else '{}'::jsonb end item
    from public.booking_requests requests
    join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id
    join public.cottage_booking_period_commitments commitments on commitments.id=requests.booking_period_commitment_id
    left join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id
    left join public.booking_receipts receipts on receipts.booking_confirmation_id=confirmations.id and receipts.recipient_role=target_actor_role
    cross join lateral (select confirmations.id is not null
      and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=requests.id)
      and not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=requests.id and expiry.state='quarantined')
      and (public.booking_request_payment_status(requests)='paid-confirmed' or exists(select 1 from public.booking_cancellations cancellation where cancellation.booking_request_id=requests.id)) paid_access) access
    where (target_actor_role='customer' and requests.customer_user_id=actor)
      or (target_actor_role='cottage_owner' and requests.owner_user_id=actor)
  ) source);
end $function$;

CREATE OR REPLACE FUNCTION public.lock_booking_refund_source (
  target_booking_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare request public.booking_requests;
begin
  select * into request from public.booking_requests where id=target_booking_request_id for update;
  perform 1 from public.booking_request_capture_work where booking_request_id=request.id for update;
  perform capture.id from public.payment_provider_operations capture
    join public.booking_confirmations confirmation on confirmation.capture_operation_id=capture.id
    where confirmation.booking_request_id=request.id for update of capture;
  -- A separate statement refreshes the read snapshot after any lock wait.
  return public.booking_refund_source_facts(target_booking_request_id);
end;
$function$;

ALTER FUNCTION public.payment_provider_recorded_result(public.payment_provider_operations) STABLE;