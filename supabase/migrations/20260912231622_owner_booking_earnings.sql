-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.booking_payout_command_facts (
  target_booking_request_id uuid,
  source                    jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare commands jsonb; declare disputes jsonb; declare holds jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('commandId',id,'action',action,'subjectId',subject_id,'outcome',outcome,
    'allocation',case when booking_price_fils is not null then jsonb_build_object('bookingPriceFils',booking_price_fils,'bookingServiceFeeFils',booking_service_fee_fils) end,
    'actorUserId',actor_user_id,'reason',reason,'occurredAt',occurred_at) order by occurred_at,id),'[]') into commands
    from public.booking_payout_commands where booking_request_id=target_booking_request_id;
  select coalesce(jsonb_agg(opening.id order by opening.occurred_at,opening.id),'[]') into holds
    from public.booking_payout_commands opening where opening.booking_request_id=target_booking_request_id and opening.action='place_hold'
      and not exists(select 1 from public.booking_payout_commands release where release.subject_id=opening.id and release.action='release_hold');
  select coalesce(jsonb_agg(jsonb_build_object('id',opening.id,'resolutionId',resolution.id,'refundIntentId',refund.id,
    'state',case when resolution.id is null then 'open' when resolution.outcome='owner_won' or public.booking_refund_intent_state(refund.id)='succeeded' then 'resolved' else 'resolving' end)
    order by opening.occurred_at,opening.id),'[]') into disputes
    from public.booking_payout_commands opening left join public.booking_payout_commands resolution on resolution.subject_id=opening.id and resolution.action='resolve_dispute'
      left join public.booking_refund_intents refund on refund.dispute_resolution_id=resolution.id
    where opening.booking_request_id=target_booking_request_id and opening.action='open_dispute';
  return source||jsonb_build_object('commands',commands,'activeHoldIds',holds,'disputes',disputes,
    'activeDisputeIds',(select coalesce(jsonb_agg(dispute->'id'),'[]') from jsonb_array_elements(disputes) dispute where dispute->>'state'<>'resolved'));
end;
$function$;

REVOKE ALL ON FUNCTION public.booking_payout_command_facts(uuid, jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.booking_settlement_projection_facts (
  target_booking_request_id uuid,
  source                    jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
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
  projected:=source||jsonb_build_object('recovery',public.booking_settlement_recovery(target_booking_request_id,source->'captured',source->'refunded'),'maturity',public.booking_completion_eligibility(target_booking_request_id),
    'settlement',case when intent.id is not null then jsonb_build_object('id',intent.id,'commandId',intent.command_id,'amountFils',intent.amount_fils,'actorUserId',intent.actor_user_id,'reason',intent.reason,'requestedAt',intent.created_at,
      'receipt',(select jsonb_build_object('observationId',r.observation_id,'historySequence',r.history_sequence,'recordedAt',o.received_at,'activeHoldIds',to_jsonb(r.active_hold_ids),'activeDisputeIds',to_jsonb(r.active_dispute_ids)) from public.booking_settlement_receipts r join public.payment_provider_observations o on o.id=r.observation_id where r.settlement_intent_id=intent.id),
      'state',case when ledger.id is null then 'requested' else coalesce(ledger.current_outcome,'processing') end,
      'retrySafe',coalesce((public.payment_provider_recorded_result(ledger)->>'retrySafe')::boolean,false)) end);
  return projected||jsonb_build_object('revision',md5(projected::text));
end;
$function$;

REVOKE ALL ON FUNCTION public.booking_settlement_projection_facts(uuid, jsonb) FROM PUBLIC,anon,authenticated,service_role;

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
declare owner_projection jsonb; declare owner_earnings jsonb;
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
    begin
      owner_projection:=public.booking_payout_command_facts(request.id,
        facts||totals||jsonb_build_object(
          'obligation',jsonb_build_object('bookingPriceFils',coalesce(cancellation.refund_booking_price_fils,0),'bookingServiceFeeFils',coalesce(cancellation.refund_booking_service_fee_fils,0)),
          'intents',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'state',public.booking_refund_intent_state(id),'automatic',source='cancellation') order by created_at,id),'[]') from public.booking_refund_intents where booking_request_id=request.id)));
      owner_projection:=public.booking_settlement_projection_facts(request.id,owner_projection);
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
          'refunds',(select coalesce(jsonb_agg(jsonb_build_object('state',public.booking_refund_intent_state(id),'allocation',jsonb_build_object('bookingPriceFils',booking_price_fils,'bookingServiceFeeFils',booking_service_fee_fils)) order by created_at,id),'[]') from public.booking_refund_intents where booking_request_id=request.id),
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
    result:=result||jsonb_build_object('ownerEarnings',owner_earnings);
  end if;
  if target_actor_role in ('cottage_owner','platform_administrator') then result:=result||jsonb_build_object('ownerPayout',public.booking_settlement_recovery(request.id,facts->'captured',totals->'refunded')); end if;
  result:=result||jsonb_build_object('lifecycle',public.get_booking_lifecycle(target_reference,target_actor_role),'eligibility',public.get_booking_completion_eligibility(target_reference,target_actor_role));
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_booking_payout_facts (
  target_booking_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if current_setting('role',true)<>'service_role' and not public.is_platform_administrator('aal2') then
    raise exception 'Payout facts unavailable' using errcode='42501'; end if;
  return public.booking_payout_command_facts(target_booking_request_id,public.get_booking_refund_facts(target_booking_request_id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_booking_settlement_facts (
  target_booking_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  return public.booking_settlement_projection_facts(target_booking_request_id,public.get_booking_payout_facts(target_booking_request_id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_booking_history (
  target_actor_role text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=(select auth.uid()); declare context public.account_contexts;
declare booking record; declare financial jsonb; declare earnings_by_request jsonb:='{}'::jsonb;
begin
  select * into context from public.account_contexts where user_id=actor;
  if actor is null or context.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null)
    or target_actor_role not in ('customer','cottage_owner')
    or (target_actor_role='customer' and context.role not in ('customer','cottage_owner'))
    or (target_actor_role='cottage_owner' and (context.role<>'cottage_owner' or context.owner_approval_state<>'approved'))
  then raise exception 'Booking History unavailable' using errcode='42501'; end if;
  if target_actor_role='cottage_owner' then
    -- Establish one deterministic lock order before the per-booking financial
    -- readers lock their capture/refund sources.
    perform requests.id from public.booking_requests requests
      where requests.owner_user_id=actor order by requests.id for update;
    for booking in
      select requests.id,requests.booking_request_reference
      from public.booking_requests requests
      join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id
      where requests.owner_user_id=actor
        and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=requests.id)
        and not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=requests.id and expiry.state='quarantined')
        and (public.booking_request_payment_status(requests)='paid-confirmed' or exists(select 1 from public.booking_cancellations cancellation where cancellation.booking_request_id=requests.id))
      order by requests.id
    loop
      financial:=public.get_booking_financial_view(booking.booking_request_reference,'cottage_owner');
      earnings_by_request:=earnings_by_request||jsonb_build_object(booking.id::text,coalesce(financial->'ownerEarnings','{"status":"unavailable"}'::jsonb));
    end loop;
  end if;
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
          then coalesce(earnings_by_request->requests.id::text,'{"status":"unavailable"}'::jsonb)
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
