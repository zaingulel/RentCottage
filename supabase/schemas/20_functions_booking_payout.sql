SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.booking_payout_command_receipt(target public.booking_payout_commands) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
  select jsonb_build_object('status','recorded','bookingRequestId',target.booking_request_id,'commandId',target.id,'occurredAt',target.occurred_at);
$$;

-- Private factual extraction shared by administrator operations and the
-- already-authorized participant financial reader. As a security-invoker
-- helper it can read these tables only through its SECURITY DEFINER callers.
CREATE OR REPLACE FUNCTION public.booking_payout_command_facts(target_booking_request_id uuid,source jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.get_booking_payout_facts(target_booking_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
  if current_setting('role',true)<>'service_role' and not public.is_platform_administrator('aal2') then
    raise exception 'Payout facts unavailable' using errcode='42501'; end if;
  return public.booking_payout_command_facts(target_booking_request_id,public.get_booking_refund_facts(target_booking_request_id));
end;
$$;

CREATE OR REPLACE FUNCTION public.record_booking_payout_command(target_booking_request_id uuid,target_command_id uuid,target_action text,target_reason text,target_subject_id uuid,target_outcome text,target_allocation jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare source jsonb; declare fingerprint text; declare prior public.booking_payout_commands; declare subject public.booking_payout_commands;
declare price bigint; declare fee bigint; declare intent public.booking_refund_intents;
begin
  if current_setting('role',true)<>'authenticated' or not public.is_platform_administrator('aal2') then
    raise exception 'Payout command unavailable' using errcode='42501'; end if;
  source:=public.get_booking_refund_facts(target_booking_request_id);
  if target_command_id is null or target_action is null or target_action not in ('place_hold','release_hold','open_dispute','resolve_dispute')
    or target_reason is null or length(btrim(target_reason)) not between 1 and 2000
    or ((target_action in ('release_hold','resolve_dispute')) is distinct from (target_subject_id is not null))
    or (target_action='resolve_dispute' and (target_outcome is null or target_outcome not in ('owner_won','customer_won','partial_customer_award')))
    or (target_action<>'resolve_dispute' and target_outcome is not null)
    or ((target_action='resolve_dispute' and target_outcome in ('customer_won','partial_customer_award')) is distinct from (target_allocation is not null)) then
    raise exception 'Payout command content is invalid' using errcode='22023'; end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('bookingRequestId',target_booking_request_id,'actorUserId',(select auth.uid()),
    'action',target_action,'reason',target_reason,'subjectId',target_subject_id,'outcome',target_outcome,
    'allocation',target_allocation)::text,'UTF8'),'sha256'),'hex');
  select * into prior from public.booking_payout_commands where id=target_command_id;
  if found then
    if prior.command_fingerprint is distinct from fingerprint then raise exception 'Payout command identity was reused' using errcode='RC409'; end if;
    return public.booking_payout_command_receipt(prior);
  end if;
  if (target_action='place_hold' and exists(select 1 from public.booking_payout_commands opening
    where opening.booking_request_id=target_booking_request_id and opening.action='place_hold'
      and not exists(select 1 from public.booking_payout_commands release where release.subject_id=opening.id)))
    or (target_action='open_dispute' and exists(select 1 from public.booking_payout_commands opening
      left join public.booking_payout_commands resolution on resolution.subject_id=opening.id
      left join public.booking_refund_intents refund on refund.dispute_resolution_id=resolution.id
      where opening.booking_request_id=target_booking_request_id and opening.action='open_dispute'
        and (resolution.id is null or (resolution.outcome<>'owner_won' and public.booking_refund_intent_state(refund.id)<>'succeeded')))) then
    raise exception 'Payout hold or dispute is already active' using errcode='RC409'; end if;
  if target_subject_id is not null then
    select * into subject from public.booking_payout_commands where id=target_subject_id;
    if subject.booking_request_id is distinct from target_booking_request_id
      or subject.action is distinct from (case target_action when 'release_hold' then 'place_hold' else 'open_dispute' end)
      or exists(select 1 from public.booking_payout_commands where subject_id=target_subject_id) then
      raise exception 'Payout hold or dispute changed' using errcode='RC409'; end if;
  end if;
  if target_allocation is not null and public.booking_settlement_has_unresolved_execution(target_booking_request_id) then
    raise exception 'Settlement must be reconciled before refund' using errcode='RC409'; end if;
  if target_allocation is not null then
    if jsonb_typeof(target_allocation) is distinct from 'object' or target_allocation-array['bookingPriceFils','bookingServiceFeeFils']<>'{}'
      or jsonb_typeof(target_allocation->'bookingPriceFils') is distinct from 'number' or jsonb_typeof(target_allocation->'bookingServiceFeeFils') is distinct from 'number'
      or (target_allocation->>'bookingPriceFils')::numeric<>trunc((target_allocation->>'bookingPriceFils')::numeric)
      or (target_allocation->>'bookingServiceFeeFils')::numeric<>trunc((target_allocation->>'bookingServiceFeeFils')::numeric) then
      raise exception 'Dispute allocation is invalid' using errcode='22023'; end if;
    price:=(target_allocation->>'bookingPriceFils')::bigint; fee:=(target_allocation->>'bookingServiceFeeFils')::bigint;
    if price<0 or fee<0 or price%10<>0 or price+fee<=0 then raise exception 'Dispute allocation is invalid' using errcode='22023'; end if;
    if price>(source#>>'{captured,bookingPriceFils}')::bigint-(source#>>'{refunded,bookingPriceFils}')::bigint-(source#>>'{reserved,bookingPriceFils}')::bigint
      or fee>(source#>>'{captured,bookingServiceFeeFils}')::bigint-(source#>>'{refunded,bookingServiceFeeFils}')::bigint-(source#>>'{reserved,bookingServiceFeeFils}')::bigint
      or (target_outcome='customer_won' and (price,fee) is distinct from (
        (source#>>'{captured,bookingPriceFils}')::bigint-(source#>>'{refunded,bookingPriceFils}')::bigint,
        (source#>>'{captured,bookingServiceFeeFils}')::bigint-(source#>>'{refunded,bookingServiceFeeFils}')::bigint)) then
      raise exception 'Dispute allocation conflicts with remaining capture' using errcode='RC409'; end if;
  end if;
  insert into public.booking_payout_commands(id,booking_request_id,capture_operation_id,action,subject_id,outcome,booking_price_fils,booking_service_fee_fils,actor_user_id,reason,command_fingerprint)
    values(target_command_id,target_booking_request_id,(source->>'captureOperationId')::uuid,target_action,target_subject_id,target_outcome,price,fee,(select auth.uid()),target_reason,fingerprint) returning * into prior;
  if target_allocation is not null then
    insert into public.booking_refund_intents(booking_request_id,capture_operation_id,dispute_resolution_id,command_id,command_fingerprint,source,actor_user_id,reason,booking_price_fils,booking_service_fee_fils)
      values(target_booking_request_id,(source->>'captureOperationId')::uuid,prior.id,target_command_id,fingerprint,'dispute',(select auth.uid()),target_reason,price,fee) returning * into intent;
    perform public.record_booking_refund_notification(intent.id,'refund_requested');
  end if;
  return public.booking_payout_command_receipt(prior);
exception when unique_violation then
  raise exception 'Payout command identity was reused' using errcode='RC409';
end;
$$;

CREATE OR REPLACE FUNCTION public.booking_settlement_projection_facts(target_booking_request_id uuid,source jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.get_booking_settlement_facts(target_booking_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
  return public.booking_settlement_projection_facts(target_booking_request_id,public.get_booking_payout_facts(target_booking_request_id));
end;
$$;

CREATE OR REPLACE FUNCTION public.booking_settlement_admission_is_eligible(facts jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  select ((facts#>>'{maturity,payoutPrerequisiteAvailable}')::boolean
    and facts->'activeHoldIds'='[]'::jsonb and facts->'activeDisputeIds'='[]'::jsonb
    and facts->'reserved'='{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb
    and not exists(select 1 from jsonb_array_elements(facts->'intents') intent where intent->>'state' is distinct from 'succeeded')
    and (facts#>>'{captured,bookingPriceFils}')::bigint>(facts#>>'{refunded,bookingPriceFils}')::bigint) is true;
$$;

CREATE OR REPLACE FUNCTION public.request_booking_settlement(target_booking_request_id uuid,target_command_id uuid,target_reason text,target_revision text,target_amount_fils bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare facts jsonb; declare intent public.booking_settlement_intents; declare fingerprint text; declare remaining bigint;
begin
  if current_setting('role',true)<>'authenticated' or not public.is_platform_administrator('aal2') then raise exception 'Settlement request unavailable' using errcode='42501'; end if;
  facts:=public.get_booking_settlement_facts(target_booking_request_id);
  if target_command_id is null or target_reason is null or length(btrim(target_reason)) not between 1 and 2000 or target_amount_fils is null or target_amount_fils<=0 then
    raise exception 'Settlement attribution is invalid' using errcode='22023'; end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('bookingRequestId',target_booking_request_id,'actorUserId',(select auth.uid()),'commandId',target_command_id,'reason',target_reason,'amountFils',target_amount_fils)::text,'UTF8'),'sha256'),'hex');
  select * into intent from public.booking_settlement_intents where command_id=target_command_id;
  if found then
    if intent.command_fingerprint is distinct from fingerprint then raise exception 'Settlement command identity was reused' using errcode='RC409'; end if;
    return jsonb_build_object('status','requested','intentId',intent.id);
  end if;
  if not public.booking_settlement_admission_is_eligible(facts) then raise exception 'Settlement is not eligible' using errcode='RC409'; end if;
  if facts->>'revision' is distinct from target_revision then return jsonb_build_object('status','stale'); end if;
  remaining:=(facts#>>'{captured,bookingPriceFils}')::bigint-(facts#>>'{refunded,bookingPriceFils}')::bigint;
  if target_amount_fils is distinct from remaining-remaining/10 or facts->'settlement'<>'null'::jsonb then
    raise exception 'Settlement amount or identity is invalid' using errcode='RC409'; end if;
  insert into public.booking_settlement_intents(booking_request_id,capture_operation_id,command_id,command_fingerprint,amount_fils,actor_user_id,reason)
    values(target_booking_request_id,(facts->>'captureOperationId')::uuid,target_command_id,fingerprint,target_amount_fils,(select auth.uid()),target_reason) returning * into intent;
  return jsonb_build_object('status','requested','intentId',intent.id);
exception when unique_violation then raise exception 'Settlement identity already exists' using errcode='RC409';
end;
$$;

CREATE OR REPLACE FUNCTION public.booking_settlement_execution_permit(target public.booking_settlement_attempts) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
  select jsonb_build_object('purpose','booking-settlement','attemptId',target.id,'generation',target.generation,'leaseToken',target.lease_token,
    'idempotencyKey',intent.id::text||':settlement:'||target.generation::text,'notBefore',target.created_at,'notAfter',target.not_after,
    'binding',jsonb_build_object('bookingRequestId',intent.booking_request_id,'settlementIntentId',intent.id,'captureOperationId',capture.id,
      'kind','settlement','paymentLifecycleId',capture.payment_lifecycle_id,'logicalOperationId',intent.id::text||':settlement',
      'attemptId',intent.id::text||':settlement:'||target.generation::text,'amountFils',intent.amount_fils,'currency',capture.currency,
      'requestFingerprint',intent.command_fingerprint,'providerIdentity',jsonb_build_object('provider',capture.provider,'environment',capture.environment,'merchantId',capture.merchant_id,'terminalId',capture.terminal_id)))
    from public.booking_settlement_intents intent join public.payment_provider_operations capture on capture.id=intent.capture_operation_id where intent.id=target.settlement_intent_id;
$$;

CREATE OR REPLACE FUNCTION public.claim_booking_settlement(target_intent_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare intent public.booking_settlement_intents; declare attempt public.booking_settlement_attempts; declare ledger public.payment_provider_operations;
declare permit jsonb; declare facts jsonb; declare remaining bigint; declare next_generation integer;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Settlement work unavailable' using errcode='42501'; end if;
  select * into intent from public.booking_settlement_intents where id=target_intent_id;
  facts:=public.get_booking_settlement_facts(intent.booking_request_id);
  select * into attempt from public.booking_settlement_attempts where settlement_intent_id=intent.id order by generation desc limit 1;
  select * into ledger from public.payment_provider_operations where admission->>'purpose'='booking-settlement' and admission#>>'{permit,attemptId}'=attempt.id::text;
  if ledger.current_outcome='succeeded' then return jsonb_build_object('status','settled'); end if;
  if ledger.id is not null and (ledger.current_outcome is null or ledger.current_outcome='indeterminate') then
    permit:=public.booking_settlement_execution_permit(attempt);
    return jsonb_build_object('status','query','query',((permit->'binding')-array['bookingRequestId','settlementIntentId','captureOperationId','requestFingerprint','providerIdentity'])||
      jsonb_build_object('settlementPermit',permit,'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference));
  end if;
  if ledger.current_outcome='failed' and (public.payment_provider_recorded_result(ledger)->>'retrySafe')::boolean is not true then
    return jsonb_build_object('status','attention-required'); end if;
  remaining:=(facts#>>'{captured,bookingPriceFils}')::bigint-(facts#>>'{refunded,bookingPriceFils}')::bigint;
  if not public.booking_settlement_admission_is_eligible(facts) or intent.amount_fils is distinct from remaining-remaining/10 then
    return jsonb_build_object('status','blocked'); end if;
  if ledger.id is null and attempt.not_after>clock_timestamp() then return jsonb_build_object('status','processing'); end if;
  next_generation:=coalesce(attempt.generation,0)+1;
  insert into public.booking_settlement_attempts(settlement_intent_id,generation,not_after) values(intent.id,next_generation,clock_timestamp()+interval '30 seconds') returning * into attempt;
  permit:=public.booking_settlement_execution_permit(attempt);
  return jsonb_build_object('status','execute','request',((permit->'binding')-array['bookingRequestId','settlementIntentId','captureOperationId','requestFingerprint','providerIdentity'])||jsonb_build_object('executionPermit',permit));
end;
$$;

CREATE OR REPLACE FUNCTION public.admit_booking_settlement(target_permit jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare intent public.booking_settlement_intents; declare attempt public.booking_settlement_attempts; declare capture public.payment_provider_operations;
declare ledger public.payment_provider_operations; declare expected jsonb; declare facts jsonb; declare remaining bigint;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Settlement admission unavailable' using errcode='42501'; end if;
  facts:=public.get_booking_settlement_facts((target_permit#>>'{binding,bookingRequestId}')::uuid);
  select * into attempt from public.booking_settlement_attempts where id=(target_permit->>'attemptId')::uuid;
  select * into intent from public.booking_settlement_intents where id=attempt.settlement_intent_id;
  select * into capture from public.payment_provider_operations where id=intent.capture_operation_id;
  expected:=public.booking_settlement_execution_permit(attempt);
  if attempt.id is null or target_permit is distinct from expected or intent.booking_request_id::text is distinct from facts->>'bookingRequestId'
    or capture.id::text is distinct from facts->>'captureOperationId'
    or expected#>'{binding,providerIdentity}' is distinct from '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb then
    raise exception 'Settlement admission binding is invalid' using errcode='RC409'; end if;
  select * into ledger from public.payment_provider_operations where admission->>'purpose'='booking-settlement' and admission#>>'{permit,attemptId}'=attempt.id::text;
  if found then return public.payment_operation_admission(ledger); end if;
  remaining:=(facts#>>'{captured,bookingPriceFils}')::bigint-(facts#>>'{refunded,bookingPriceFils}')::bigint;
  if attempt.not_after<=clock_timestamp() or exists(select 1 from public.booking_settlement_attempts newer where newer.settlement_intent_id=intent.id and newer.generation>attempt.generation)
    or not public.booking_settlement_admission_is_eligible(facts) or intent.amount_fils is distinct from remaining-remaining/10
    or exists(select 1 from public.payment_provider_operations prior join public.booking_settlement_attempts prior_attempt on prior_attempt.id::text=prior.admission#>>'{permit,attemptId}'
      where prior.admission->>'purpose'='booking-settlement' and prior_attempt.settlement_intent_id=intent.id
        and (prior.current_outcome is null or prior.current_outcome in ('indeterminate','succeeded') or (prior.current_outcome='failed' and (public.payment_provider_recorded_result(prior)->>'retrySafe')::boolean is not true))) then
    return jsonb_build_object('status','not-admitted'); end if;
  insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,admission,evidence_provenance)
    values(gen_random_uuid(),capture.claim_id,capture.claim_generation,'settlement',capture.provider,capture.environment,capture.merchant_id,capture.terminal_id,
      expected->>'idempotencyKey',intent.command_fingerprint,capture.payment_lifecycle_id,expected#>>'{binding,logicalOperationId}',expected#>>'{binding,attemptId}',intent.amount_fils,capture.currency,
      jsonb_build_object('purpose','booking-settlement','permit',expected,'notBefore',attempt.created_at,'notAfter',attempt.not_after),'admitted') returning * into ledger;
  return public.payment_operation_admission(ledger,true);
end;
$$;

CREATE OR REPLACE FUNCTION public.booking_settlement_has_unresolved_execution(target_booking_request_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
  select exists(select 1 from public.payment_provider_operations ledger join public.booking_settlement_attempts attempt on attempt.id::text=ledger.admission#>>'{permit,attemptId}'
    join public.booking_settlement_intents intent on intent.id=attempt.settlement_intent_id
    where intent.booking_request_id=target_booking_request_id and ledger.admission->>'purpose'='booking-settlement' and (ledger.current_outcome is null or ledger.current_outcome='indeterminate'));
$$;

CREATE OR REPLACE FUNCTION public.record_booking_settlement_observation(target_operation_id uuid,target_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare ledger public.payment_provider_operations; declare attempt public.booking_settlement_attempts; declare intent public.booking_settlement_intents; declare facts jsonb; declare was_succeeded boolean;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-settlement']);
  select * into attempt from public.booking_settlement_attempts where id=(ledger.admission#>>'{permit,attemptId}')::uuid;
  select * into intent from public.booking_settlement_intents where id=attempt.settlement_intent_id;
  perform public.lock_booking_refund_source(intent.booking_request_id);
  if intent.id is null or ledger.admission->'permit' is distinct from public.booking_settlement_execution_permit(attempt)
    or ledger.amount_fils is distinct from intent.amount_fils then raise exception 'Settlement observation binding is invalid' using errcode='RC409'; end if;
  facts:=public.get_booking_payout_facts(intent.booking_request_id);
  was_succeeded:=ledger.current_outcome is not distinct from 'succeeded';
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  if ledger.current_outcome='succeeded' and not was_succeeded then
    insert into public.booking_settlement_receipts(settlement_intent_id,operation_id,observation_id,history_sequence,active_hold_ids,active_dispute_ids)
    select intent.id,ledger.id,observation.id,history.sequence,
      array(select value::uuid from jsonb_array_elements_text(facts->'activeHoldIds')),
      array(select value::uuid from jsonb_array_elements_text(facts->'activeDisputeIds'))
    from public.payment_provider_observations observation
      join public.booking_request_payment_history history on history.provider_operation_id=ledger.id and history.source='provider-operation' and history.outcome='succeeded'
    where observation.operation_id=ledger.id and observation.event_id=target_result#>>'{evidence,eventId}'
    order by history.sequence limit 1;
    if not found then raise exception 'Settlement success context is unavailable' using errcode='RC409'; end if;
  end if;
  return public.payment_provider_recorded_result(ledger);
end;
$$;

-- Caller has authorized the participant and locked the booking/capture source.
CREATE OR REPLACE FUNCTION public.booking_settlement_recovery(target_booking_request_id uuid,captured jsonb,refunded jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare intent public.booking_settlement_intents; declare ledger public.payment_provider_operations; declare receipt public.booking_settlement_receipts;
declare entitlement bigint; declare balance bigint; declare blocked boolean; declare later_refund boolean;
begin
  select * into intent from public.booking_settlement_intents where booking_request_id=target_booking_request_id;
  select operation.* into ledger from public.payment_provider_operations operation join public.booking_settlement_attempts attempt on attempt.id::text=operation.admission#>>'{permit,attemptId}'
    where attempt.settlement_intent_id=intent.id and operation.admission->>'purpose'='booking-settlement' and operation.current_outcome='succeeded';
  if ledger.id is null then return '{"status":"unsettled"}'::jsonb; end if;
  select r.* into receipt from public.booking_settlement_receipts r
    join public.payment_provider_observations observation on observation.id=r.observation_id and observation.operation_id=ledger.id and observation.result->>'outcome'='succeeded'
    join public.booking_request_payment_history history on history.sequence=r.history_sequence and history.provider_operation_id=ledger.id and history.outcome='succeeded'
    where r.settlement_intent_id=intent.id and r.operation_id=ledger.id;
  if receipt.settlement_intent_id is null or ledger.amount_fils is distinct from intent.amount_fils then return '{"status":"unavailable"}'::jsonb; end if;
  entitlement:=((captured->>'bookingPriceFils')::bigint-(refunded->>'bookingPriceFils')::bigint)*9/10;
  blocked:=cardinality(receipt.active_hold_ids)>0 or cardinality(receipt.active_dispute_ids)>0;
  -- A completed refund refreshes recovery under #30. Use serialized history order,
  -- never provider occurrence time or potentially equal received timestamps.
  select exists(select 1 from public.booking_request_payment_history history join public.payment_provider_operations operation on operation.id=history.provider_operation_id
    where history.sequence>receipt.history_sequence and history.source='provider-operation' and history.outcome='succeeded' and operation.current_outcome='succeeded' and operation.operation_kind='refund'
    and ((operation.admission->>'purpose'='booking-refund' and operation.admission#>>'{permit,binding,captureOperationId}'=intent.capture_operation_id::text)
      or exists(select 1 from public.booking_request_payment_required_expiry_operations corrective where corrective.capture_provider_operation_id=intent.capture_operation_id
        and (corrective.provider_operation_id=operation.id or (corrective.provider,corrective.environment,corrective.merchant_id,corrective.terminal_id,corrective.provider_idempotency_key)
          =(operation.provider,operation.environment,operation.merchant_id,operation.terminal_id,operation.provider_idempotency_key))))) into later_refund;
  balance:=case when blocked and not later_refund then ledger.amount_fils else greatest(ledger.amount_fils-entitlement,0) end;
  return jsonb_build_object('status','paid','ownerEntitlementFils',entitlement,'paidFils',ledger.amount_fils,'paidWhileBlocked',blocked,
    'recoveryExposureFils',greatest(case when blocked then ledger.amount_fils else 0 end,balance),'recoveryBalanceFils',balance,'automaticOwnerDebitFils',0);
end;
$$;
