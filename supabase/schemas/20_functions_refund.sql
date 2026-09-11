SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.lock_booking_refund_source(target_booking_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare request public.booking_requests;
declare confirmation public.booking_confirmations;
declare snapshot public.booking_snapshots;
declare capture public.payment_provider_operations;
begin
  select * into request from public.booking_requests where id=target_booking_request_id for update;
  perform 1 from public.booking_request_capture_work where booking_request_id=request.id for update;
  select * into confirmation from public.booking_confirmations where booking_request_id=request.id;
  select * into snapshot from public.booking_snapshots where id=request.booking_snapshot_id;
  select * into capture from public.payment_provider_operations where id=confirmation.capture_operation_id for update;
  if request.id is null or confirmation.id is null or snapshot.id is null or capture.id is null
    or capture.operation_kind is distinct from 'capture' or capture.current_outcome is distinct from 'succeeded'
    or capture.recorded_at is null or capture.movement_reference is null or capture.authoritative_outcome_at is null
    or (confirmation.booking_snapshot_id,confirmation.booking_period_commitment_id) is distinct from (snapshot.id,request.booking_period_commitment_id)
    or capture.amount_fils is distinct from ((snapshot.quote_payload->>'bookingPriceIqd')::bigint+(snapshot.quote_payload->>'serviceFeeIqd')::bigint)*1000
    or exists(select 1 from public.booking_request_confirmation_invalidations where booking_request_id=request.id)
    or public.booking_request_payment_quarantined(request.id) then
    raise exception 'Refund capture source is invalid' using errcode='RC409'; end if;
  return jsonb_build_object('bookingRequestId',request.id,'captureOperationId',capture.id,
    'captured',jsonb_build_object('bookingPriceFils',(snapshot.quote_payload->>'bookingPriceIqd')::bigint*1000,'bookingServiceFeeFils',(snapshot.quote_payload->>'serviceFeeIqd')::bigint*1000));
end;
$$;

CREATE OR REPLACE FUNCTION public.booking_refund_intent_state(target_intent_id uuid) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
  select coalesce((select case ledger.current_outcome when 'succeeded' then 'succeeded' when 'failed' then 'failed'
      when 'indeterminate' then 'unknown' when 'not-executed' then 'requested' else case when ledger.id is null then 'requested' else 'processing' end end
    from public.booking_refund_attempts attempts left join public.payment_provider_operations ledger
      on ledger.admission#>>'{permit,attemptId}'=attempts.id::text and ledger.admission->>'purpose'='booking-refund'
    where attempts.refund_intent_id=target_intent_id order by attempts.generation desc limit 1),'requested');
$$;

-- All callers acquire the booking source lock before this capture lock. Capacity is
-- derived from immutable allocations and shared evidence, never a mutable balance.
CREATE OR REPLACE FUNCTION public.booking_capture_refund_totals(target_capture_id uuid,target_captured jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare capture public.payment_provider_operations;
declare owned record;
declare state text;
declare refunded_price bigint:=0; declare refunded_fee bigint:=0;
declare reserved_price bigint:=0; declare reserved_fee bigint:=0;
begin
  select * into capture from public.payment_provider_operations where id=target_capture_id for update;
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
$$;

CREATE OR REPLACE FUNCTION public.get_booking_refund_facts(target_booking_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare source jsonb; declare cancellation public.booking_cancellations; declare projected jsonb;
begin
  if current_setting('role',true)<>'service_role' and not public.is_platform_administrator('aal2') then raise exception 'Refund facts unavailable' using errcode='42501'; end if;
  source:=public.lock_booking_refund_source(target_booking_request_id);
  select * into cancellation from public.booking_cancellations where booking_request_id=target_booking_request_id;
  projected:=source||public.booking_capture_refund_totals((source->>'captureOperationId')::uuid,source->'captured')||jsonb_build_object(
    'obligation',jsonb_build_object('bookingPriceFils',coalesce(cancellation.refund_booking_price_fils,0),'bookingServiceFeeFils',coalesce(cancellation.refund_booking_service_fee_fils,0)),
    'intents',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'state',public.booking_refund_intent_state(id),'automatic',intents.source='cancellation') order by created_at,id),'[]') from public.booking_refund_intents intents where booking_request_id=target_booking_request_id));
  return projected||jsonb_build_object('revision',md5(projected::text));
end;
$$;

CREATE OR REPLACE FUNCTION public.record_booking_refund_notification(target_intent_id uuid,target_event_kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare intent public.booking_refund_intents;
begin
  select * into intent from public.booking_refund_intents where id=target_intent_id;
  if intent.id is null or target_event_kind not in ('refund_requested','refund_returned','refund_attention') then raise exception 'Refund notification fact is invalid' using errcode='RC409'; end if;
  insert into public.booking_notification_events(booking_request_id,refund_intent_id,receipt_id,event_kind,recipient_user_id,recipient_role,notice_locale,created_at)
    select intent.booking_request_id,intent.id,receipts.id,target_event_kind,receipts.recipient_user_id,receipts.recipient_role,snapshots.acceptance_locale,clock_timestamp()
      from public.booking_receipts receipts join public.booking_snapshots snapshots on snapshots.id=receipts.booking_snapshot_id join public.booking_confirmations confirmations on confirmations.id=receipts.booking_confirmation_id
      where confirmations.booking_request_id=intent.booking_request_id on conflict(refund_intent_id,event_kind,recipient_role) do nothing;
  if (select count(*) from public.booking_notification_events where refund_intent_id=intent.id and event_kind=target_event_kind)<>2 then
    raise exception 'Refund recipient facts are incomplete' using errcode='RC409'; end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.request_booking_refund_exception(target_booking_request_id uuid,target_command_id uuid,target_reason text,target_allocation jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare facts jsonb; declare fingerprint text; declare intent public.booking_refund_intents;
declare price bigint; declare fee bigint;
begin
  if not public.is_platform_administrator('aal2') then raise exception 'Refund exception unavailable' using errcode='42501'; end if;
  facts:=public.get_booking_refund_facts(target_booking_request_id);
  if target_command_id is null or target_reason is null or length(btrim(target_reason)) not between 1 and 2000
    or jsonb_typeof(target_allocation) is distinct from 'object' or target_allocation-array['bookingPriceFils','bookingServiceFeeFils']<>'{}'
    or jsonb_typeof(target_allocation->'bookingPriceFils') is distinct from 'number' or jsonb_typeof(target_allocation->'bookingServiceFeeFils') is distinct from 'number'
    or (target_allocation->>'bookingPriceFils')::numeric<>trunc((target_allocation->>'bookingPriceFils')::numeric)
    or (target_allocation->>'bookingServiceFeeFils')::numeric<>trunc((target_allocation->>'bookingServiceFeeFils')::numeric) then
    raise exception 'Refund exception attribution or allocation is invalid' using errcode='22023'; end if;
  price:=(target_allocation->>'bookingPriceFils')::bigint; fee:=(target_allocation->>'bookingServiceFeeFils')::bigint;
  if price<0 or fee<0 or price%10<>0 or price+fee<=0 then raise exception 'Refund allocation is invalid' using errcode='22023'; end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('bookingRequestId',target_booking_request_id,'actorUserId',(select auth.uid()),'reason',target_reason,'allocation',target_allocation)::text,'UTF8'),'sha256'),'hex');
  select * into intent from public.booking_refund_intents where command_id=target_command_id;
  if found then
    if intent.command_fingerprint is distinct from fingerprint then raise exception 'Refund command identity was reused' using errcode='RC409'; end if;
    return jsonb_build_object('status','requested','intentId',intent.id);
  end if;
  if price>(facts#>>'{captured,bookingPriceFils}')::bigint-(facts#>>'{refunded,bookingPriceFils}')::bigint-(facts#>>'{reserved,bookingPriceFils}')::bigint
    or fee>(facts#>>'{captured,bookingServiceFeeFils}')::bigint-(facts#>>'{refunded,bookingServiceFeeFils}')::bigint-(facts#>>'{reserved,bookingServiceFeeFils}')::bigint then
    raise exception 'Refund allocation exceeds available capacity' using errcode='RC409'; end if;
  insert into public.booking_refund_intents(booking_request_id,capture_operation_id,command_id,command_fingerprint,source,actor_user_id,reason,booking_price_fils,booking_service_fee_fils)
    values(target_booking_request_id,(facts->>'captureOperationId')::uuid,target_command_id,fingerprint,'administrator',(select auth.uid()),target_reason,price,fee) returning * into intent;
  perform public.record_booking_refund_notification(intent.id,'refund_requested');
  return jsonb_build_object('status','requested','intentId',intent.id);
end;
$$;

CREATE OR REPLACE FUNCTION public.request_automatic_booking_refund(target_booking_request_id uuid,target_revision text,target_allocation jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare facts jsonb; declare expected jsonb; declare intent public.booking_refund_intents;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Automatic refund unavailable' using errcode='42501'; end if;
  facts:=public.get_booking_refund_facts(target_booking_request_id);
  if facts->>'revision' is distinct from target_revision then return jsonb_build_object('status','stale'); end if;
  expected:=jsonb_build_object('bookingPriceFils',greatest(0,(facts#>>'{obligation,bookingPriceFils}')::bigint-(facts#>>'{refunded,bookingPriceFils}')::bigint),
    'bookingServiceFeeFils',greatest(0,(facts#>>'{obligation,bookingServiceFeeFils}')::bigint-(facts#>>'{refunded,bookingServiceFeeFils}')::bigint));
  if target_allocation is distinct from expected or (expected->>'bookingPriceFils')::bigint+(expected->>'bookingServiceFeeFils')::bigint=0
    or facts->'reserved'<>'{"bookingPriceFils":0,"bookingServiceFeeFils":0}'::jsonb
    or exists(select 1 from public.booking_refund_intents where booking_request_id=target_booking_request_id and source='cancellation' and public.booking_refund_intent_state(id)='failed') then
    raise exception 'Automatic refund selection is invalid' using errcode='RC409'; end if;
  insert into public.booking_refund_intents(booking_request_id,capture_operation_id,cancellation_id,command_id,command_fingerprint,source,booking_price_fils,booking_service_fee_fils)
    select target_booking_request_id,(facts->>'captureOperationId')::uuid,id,gen_random_uuid(),encode(extensions.digest(convert_to(facts::text,'UTF8'),'sha256'),'hex'),'cancellation',
      (expected->>'bookingPriceFils')::bigint,(expected->>'bookingServiceFeeFils')::bigint from public.booking_cancellations where booking_request_id=target_booking_request_id returning * into intent;
  if intent.id is null then raise exception 'Cancellation obligation is missing' using errcode='RC409'; end if;
  perform public.record_booking_refund_notification(intent.id,'refund_requested');
  return jsonb_build_object('status','requested');
end;
$$;

CREATE OR REPLACE FUNCTION public.booking_refund_execution_permit(target public.booking_refund_attempts) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
  select jsonb_build_object('purpose','booking-refund','attemptId',target.id,'generation',target.generation,'leaseToken',target.lease_token,
    'idempotencyKey',intent.id::text||':refund:'||target.generation::text,'notBefore',target.created_at,'notAfter',target.not_after,
    'binding',jsonb_build_object('bookingRequestId',intent.booking_request_id,'refundIntentId',intent.id,'captureOperationId',capture.id,
      'kind','refund','paymentLifecycleId',capture.payment_lifecycle_id,'logicalOperationId',intent.id::text||':refund',
      'attemptId',intent.id::text||':refund:'||target.generation::text,'amountFils',intent.booking_price_fils+intent.booking_service_fee_fils,'currency',capture.currency,
      'requestFingerprint',intent.command_fingerprint,'providerIdentity',jsonb_build_object('provider',capture.provider,'environment',capture.environment,'merchantId',capture.merchant_id,'terminalId',capture.terminal_id)))
    from public.booking_refund_intents intent join public.payment_provider_operations capture on capture.id=intent.capture_operation_id where intent.id=target.refund_intent_id;
$$;

CREATE OR REPLACE FUNCTION public.claim_booking_refund(target_intent_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare intent public.booking_refund_intents; declare attempt public.booking_refund_attempts;
declare ledger public.payment_provider_operations; declare permit jsonb; declare source jsonb; declare next_generation integer;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Refund work unavailable' using errcode='42501'; end if;
  select * into intent from public.booking_refund_intents where id=target_intent_id;
  source:=public.lock_booking_refund_source(intent.booking_request_id);
  perform public.booking_capture_refund_totals(intent.capture_operation_id,source->'captured');
  select * into attempt from public.booking_refund_attempts where refund_intent_id=intent.id order by generation desc limit 1;
  select * into ledger from public.payment_provider_operations where admission->>'purpose'='booking-refund' and admission#>>'{permit,attemptId}'=attempt.id::text;
  if ledger.current_outcome in ('succeeded','failed') then return jsonb_build_object('status','stale'); end if;
  if ledger.id is not null and ledger.current_outcome is distinct from 'not-executed' then
    permit:=public.booking_refund_execution_permit(attempt);
    return jsonb_build_object('status','query','query',((permit->'binding')-array['bookingRequestId','refundIntentId','captureOperationId','requestFingerprint','providerIdentity'])||
      jsonb_build_object('refundPermit',permit,'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference));
  end if;
  if ledger.id is null and attempt.not_after>clock_timestamp() then return jsonb_build_object('status','processing'); end if;
  next_generation:=coalesce(attempt.generation,0)+1;
  insert into public.booking_refund_attempts(refund_intent_id,generation,not_after) values(intent.id,next_generation,clock_timestamp()+interval '30 seconds') returning * into attempt;
  permit:=public.booking_refund_execution_permit(attempt);
  return jsonb_build_object('status','execute','request',((permit->'binding')-array['bookingRequestId','refundIntentId','captureOperationId','requestFingerprint','providerIdentity'])||jsonb_build_object('executionPermit',permit));
end;
$$;

CREATE OR REPLACE FUNCTION public.admit_booking_refund(target_permit jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare intent public.booking_refund_intents; declare attempt public.booking_refund_attempts; declare capture public.payment_provider_operations;
declare ledger public.payment_provider_operations; declare expected jsonb; declare source jsonb;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Refund admission unavailable' using errcode='42501'; end if;
  source:=public.lock_booking_refund_source((target_permit#>>'{binding,bookingRequestId}')::uuid);
  select * into attempt from public.booking_refund_attempts where id=(target_permit->>'attemptId')::uuid;
  select * into intent from public.booking_refund_intents where id=attempt.refund_intent_id;
  select * into capture from public.payment_provider_operations where id=intent.capture_operation_id;
  expected:=public.booking_refund_execution_permit(attempt);
  if attempt.id is null or target_permit is distinct from expected or intent.booking_request_id::text<>source->>'bookingRequestId'
    or capture.id::text<>source->>'captureOperationId'
    or expected#>'{binding,providerIdentity}' is distinct from '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb then
    raise exception 'Refund admission binding is invalid' using errcode='RC409'; end if;
  select * into ledger from public.payment_provider_operations where admission->>'purpose'='booking-refund' and admission#>>'{permit,attemptId}'=attempt.id::text;
  if found then return public.payment_operation_admission(ledger); end if;
  if attempt.not_after<=clock_timestamp() or exists(select 1 from public.booking_refund_attempts newer where newer.refund_intent_id=intent.id and newer.generation>attempt.generation) then
    return jsonb_build_object('status','not-admitted'); end if;
  perform public.booking_capture_refund_totals(capture.id,source->'captured');
  insert into public.payment_provider_operations(id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,amount_fils,currency,admission,evidence_provenance)
    values(gen_random_uuid(),capture.claim_id,capture.claim_generation,'refund',capture.provider,capture.environment,capture.merchant_id,capture.terminal_id,
      expected->>'idempotencyKey',intent.command_fingerprint,capture.payment_lifecycle_id,expected#>>'{binding,logicalOperationId}',expected#>>'{binding,attemptId}',
      intent.booking_price_fils+intent.booking_service_fee_fils,capture.currency,
      jsonb_build_object('purpose','booking-refund','permit',expected,'notBefore',attempt.created_at,'notAfter',attempt.not_after),'admitted') returning * into ledger;
  return public.payment_operation_admission(ledger,true);
end;
$$;

CREATE OR REPLACE FUNCTION public.record_booking_refund_observation(target_operation_id uuid,target_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare ledger public.payment_provider_operations; declare attempt public.booking_refund_attempts; declare intent public.booking_refund_intents;
begin
  ledger:=public.lock_payment_observation_source(target_operation_id,array['booking-refund']);
  select * into attempt from public.booking_refund_attempts where id=(ledger.admission#>>'{permit,attemptId}')::uuid;
  select * into intent from public.booking_refund_intents where id=attempt.refund_intent_id;
  perform public.lock_booking_refund_source(intent.booking_request_id);
  if intent.id is null or ledger.admission->'permit' is distinct from public.booking_refund_execution_permit(attempt)
    or ledger.amount_fils<>intent.booking_price_fils+intent.booking_service_fee_fils then raise exception 'Refund observation binding is invalid' using errcode='RC409'; end if;
  ledger:=public.accept_payment_provider_observation(ledger.id,target_result);
  if ledger.current_outcome='succeeded' then perform public.record_booking_refund_notification(intent.id,'refund_returned');
  elsif ledger.current_outcome in ('failed','indeterminate') then perform public.record_booking_refund_notification(intent.id,'refund_attention'); end if;
  return public.payment_provider_recorded_result(ledger);
end;
$$;

CREATE OR REPLACE FUNCTION public.due_booking_refunds(target_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Refund batch unavailable' using errcode='42501'; end if;
  if target_limit<1 or target_limit>50 then raise exception 'Refund batch size is invalid' using errcode='22023'; end if;
  return (select coalesce(jsonb_agg(candidate.id),'[]') from (
    select requests.id from public.booking_requests requests where
      exists(select 1 from public.booking_refund_intents intent where intent.booking_request_id=requests.id and public.booking_refund_intent_state(intent.id) in ('requested','processing','unknown'))
      or (exists(select 1 from public.booking_cancellations cancelled where cancelled.booking_request_id=requests.id and cancelled.refund_booking_price_fils+cancelled.refund_booking_service_fee_fils>0)
        and not exists(select 1 from public.booking_refund_intents intent where intent.booking_request_id=requests.id and intent.source='cancellation' and public.booking_refund_intent_state(intent.id)='failed')
        and (select coalesce(sum(intent.booking_price_fils+intent.booking_service_fee_fils),0) from public.booking_refund_intents intent where intent.booking_request_id=requests.id and public.booking_refund_intent_state(intent.id)='succeeded')
          <(select cancelled.refund_booking_price_fils+cancelled.refund_booking_service_fee_fils from public.booking_cancellations cancelled where cancelled.booking_request_id=requests.id))
    order by requests.created_at,requests.id limit target_limit) candidate);
end;
$$;
