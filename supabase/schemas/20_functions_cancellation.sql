SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.get_booking_cancellation_facts(target_booking_request_id uuid,target_actor_role text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare actor uuid:=(select auth.uid());
declare context public.account_contexts;
declare request public.booking_requests;
declare confirmation public.booking_confirmations;
declare snapshot public.booking_snapshots;
declare commitment public.cottage_booking_period_commitments;
declare capture public.payment_provider_operations;
declare first_start timestamptz;
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
  select * into snapshot from public.booking_snapshots where id=request.booking_snapshot_id;
  select * into commitment from public.cottage_booking_period_commitments where id=request.booking_period_commitment_id for update;
  perform 1 from public.booking_request_capture_work where booking_request_id=request.id for update;
  select * into capture from public.payment_provider_operations where id=confirmation.capture_operation_id for update;
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
  return projected||jsonb_build_object('revision',md5(projected::text),'observedAt',clock_timestamp());
end;
$$;

CREATE OR REPLACE FUNCTION public.booking_cancellation_result(target public.booking_cancellations) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
  select jsonb_build_object('status','cancelled','bookingRequestId',target.booking_request_id,'cancellationId',target.id,'occurredAt',target.occurred_at,
    'refundObligation',jsonb_build_object('bookingPriceFils',target.refund_booking_price_fils,'bookingServiceFeeFils',target.refund_booking_service_fee_fils));
$$;

CREATE OR REPLACE FUNCTION public.commit_booking_cancellation(target_booking_request_id uuid,target_command_id uuid,target_actor_role text,target_reason text,target_category text,target_decision jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare facts jsonb;
declare fingerprint text;
declare cancellation public.booking_cancellations;
declare request public.booking_requests;
declare obligation jsonb;
declare occurred_at timestamptz;
declare first_start timestamptz;
begin
  facts:=public.get_booking_cancellation_facts(target_booking_request_id,target_actor_role);
  if target_command_id IS NULL OR NOT (
    (target_actor_role='customer' AND target_reason IS NULL AND target_category IS NULL) OR
    (target_actor_role='cottage_owner' AND target_reason IS NOT NULL AND length(btrim(target_reason)) BETWEEN 1 AND 2000 AND target_category IS NULL) OR
    (target_actor_role='platform_administrator' AND target_reason IS NOT NULL AND length(btrim(target_reason)) BETWEEN 1 AND 2000 AND target_category IN ('safety','fraud','legal','serious_operational'))
  ) IS TRUE THEN raise exception 'Cancellation attribution is invalid' using errcode='22023'; END IF;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('bookingRequestId',target_booking_request_id,'actorUserId',(select auth.uid()),
    'actorRole',target_actor_role,'reason',target_reason,'category',target_category)::text,'UTF8'),'sha256'),'hex');
  select * into cancellation from public.booking_cancellations where command_id=target_command_id;
  if found then
    if cancellation.command_fingerprint IS DISTINCT FROM fingerprint THEN raise exception 'Cancellation command identity was reused' using errcode='RC409'; END IF;
    return public.booking_cancellation_result(cancellation);
  end if;
  select * into cancellation from public.booking_cancellations where booking_request_id=target_booking_request_id;
  if found then raise exception 'Booking has already been cancelled' using errcode='RC409'; end if;
  if exists(select 1 from public.booking_lifecycle_outcomes where booking_request_id=target_booking_request_id) then
    raise exception 'Booking already has a final lifecycle outcome' using errcode='RC409'; end if;
  first_start:=(facts->>'firstStartsAt')::timestamptz;
  occurred_at:=(facts->>'observedAt')::timestamptz;
  obligation:=CASE WHEN target_actor_role IN ('cottage_owner','platform_administrator') OR
    NOT (public.booking_request_policy_at(first_start,occurred_at)->>'requiresInside48HourNoRefundAcceptance')::boolean
    THEN facts->'captured' ELSE jsonb_build_object('bookingPriceFils',0,'bookingServiceFeeFils',0) END;
  if target_decision IS DISTINCT FROM jsonb_build_object('revision',facts->>'revision','refundObligation',obligation) then
    return jsonb_build_object('status','stale');
  end if;
  select * into request from public.booking_requests where id=target_booking_request_id;
  perform 1 from public.cottage_booking_period_occupancies where booking_period_commitment_id=request.booking_period_commitment_id order by service_day,shift_id for update;
  insert into public.booking_cancellations(booking_request_id,booking_confirmation_id,capture_operation_id,command_id,command_fingerprint,
    actor_user_id,actor_role,reason,category,first_starts_at,occurred_at,refund_booking_price_fils,refund_booking_service_fee_fils)
  values(request.id,(facts->>'confirmationId')::uuid,(facts->>'captureOperationId')::uuid,target_command_id,fingerprint,
    (select auth.uid()),target_actor_role,target_reason,target_category,first_start,occurred_at,
    (obligation->>'bookingPriceFils')::bigint,(obligation->>'bookingServiceFeeFils')::bigint) returning * into cancellation;
  update public.cottage_booking_period_commitments set status='cancelled_booking' where id=request.booking_period_commitment_id;
  update public.cottage_booking_period_occupancies occupancies set active=false
    from public.cottage_shifts shifts where occupancies.booking_period_commitment_id=request.booking_period_commitment_id
      and shifts.id=occupancies.shift_id and shifts.schedule_revision_id=occupancies.schedule_revision_id
      and ((occupancies.service_day+shifts.start_time) at time zone 'Asia/Baghdad')>occurred_at and occupancies.active;
  if target_actor_role IN ('cottage_owner','platform_administrator') then
    insert into public.booking_cancellation_incidents(cancellation_id,recorded_at) values(cancellation.id,occurred_at);
  end if;
  if target_actor_role='platform_administrator' then
    insert into public.booking_cancellation_administrator_audit(cancellation_id,administrator_user_id,recorded_at)
      values(cancellation.id,(select auth.uid()),occurred_at);
  end if;
  insert into public.booking_notification_events(booking_request_id,cancellation_id,receipt_id,event_kind,recipient_user_id,recipient_role,notice_locale,created_at)
    select request.id,cancellation.id,receipts.id,'cancelled',receipts.recipient_user_id,receipts.recipient_role,snapshots.acceptance_locale,occurred_at
    from public.booking_receipts receipts join public.booking_snapshots snapshots on snapshots.id=receipts.booking_snapshot_id
    where receipts.booking_confirmation_id=cancellation.booking_confirmation_id;
  if (select count(*) from public.booking_notification_events where cancellation_id=cancellation.id)<>2 then
    raise exception 'Cancellation notification recipients are incomplete' using errcode='RC409'; end if;
  perform public.append_booking_request_payment_history(request.payment_lifecycle_id,request.id,'state-transition','booking-request','observed',
    target_from_state=>'paid-confirmed',target_to_state=>'cancelled',target_reason_code=>target_actor_role||'-cancellation',
    target_provider_operation_id=>cancellation.capture_operation_id,
    target_amount_fils=>nullif(cancellation.refund_booking_price_fils+cancellation.refund_booking_service_fee_fils,0),target_source_recorded_at=>occurred_at);
  return public.booking_cancellation_result(cancellation);
end;
$$;

CREATE OR REPLACE FUNCTION public.reject_booking_cancellation_fact_change() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
begin
  raise exception 'Booking cancellation facts are immutable' using errcode='RC409';
end;
$$;

CREATE OR REPLACE FUNCTION public.get_booking_financial_view(target_reference text,target_actor_role text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
    'notifications',(select coalesce(jsonb_agg(jsonb_build_object('eventId',e.id,'receiptId',e.receipt_id,'kind',e.event_kind,'state',coalesce(w.state,'pending')) order by e.created_at,e.id),'[]') from public.booking_notification_events e left join public.booking_confirmation_notification_work w on w.event_id=e.id where e.booking_request_id=request.id and e.recipient_user_id=(select auth.uid()) and e.recipient_role=target_actor_role));
  if target_actor_role='platform_administrator' then
    result:=result||jsonb_build_object('audit',jsonb_build_object('cancellation',case when cancellation.id is not null then jsonb_build_object('reason',cancellation.reason,'category',cancellation.category,'actorUserId',cancellation.actor_user_id,'actorRole',cancellation.actor_role) end,
      'refunds',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'reason',reason,'actorUserId',actor_user_id) order by created_at,id),'[]') from public.booking_refund_intents where booking_request_id=request.id and source='administrator')));
  end if;
  return result;
end;
$$;
