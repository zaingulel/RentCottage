SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.reject_booking_completion_fact_change() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
begin
  raise exception 'Booking lifecycle facts are immutable' using errcode='RC409';
end;
$$;

CREATE OR REPLACE FUNCTION public.booking_completion_is_due(effective_period_end timestamptz,observed_at timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  select effective_period_end is not null and observed_at is not null and observed_at>=effective_period_end;
$$;

CREATE OR REPLACE FUNCTION public.booking_review_is_available(effective_period_end timestamptz,review_expires_at timestamptz,observed_at timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  select coalesce(review_expires_at=effective_period_end+interval '14 days' and observed_at>=effective_period_end and observed_at<review_expires_at,false);
$$;

CREATE OR REPLACE FUNCTION public.booking_completion_source(target_booking_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare request public.booking_requests;
declare confirmation public.booking_confirmations;
declare commitment public.cottage_booking_period_commitments;
declare effective_end timestamptz;
declare projected jsonb;
begin
  select * into request from public.booking_requests where id=target_booking_request_id for update;
  select * into confirmation from public.booking_confirmations where booking_request_id=request.id;
  select * into commitment from public.cottage_booking_period_commitments where id=request.booking_period_commitment_id for update;
  effective_end:=upper(range_merge(commitment.access_ranges));
  if request.id is null or confirmation.id is null or commitment.id is null or effective_end is null or
    confirmation.booking_snapshot_id is distinct from request.booking_snapshot_id or
    confirmation.booking_period_commitment_id is distinct from commitment.id or
    commitment.customer_user_id is distinct from request.customer_user_id or
    commitment.profile_id is distinct from request.profile_id or
    not ((commitment.status='confirmed_booking' and public.booking_request_payment_status(request)='paid-confirmed') or
      (commitment.status='cancelled_booking' and exists(select 1 from public.booking_cancellations where booking_request_id=request.id))) or
    exists(select 1 from public.booking_request_confirmation_invalidations where booking_request_id=request.id) or
    exists(select 1 from public.booking_request_payment_required_expiry_work where booking_request_id=request.id and state='quarantined')
  then raise exception 'Confirmed booking source is invalid' using errcode='RC409'; end if;
  projected:=jsonb_build_object('bookingRequestId',request.id,'confirmationId',confirmation.id,
    'bookingPeriodCommitmentId',commitment.id,'effectivePeriodEnd',effective_end);
  return projected||jsonb_build_object('revision',md5(projected::text),'observedAt',clock_timestamp());
end;
$$;

CREATE OR REPLACE FUNCTION public.list_due_booking_completions(target_limit integer) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
begin
  if current_setting('role',true)<>'service_role' or target_limit is null or target_limit<1 or target_limit>50 then
    raise exception 'Booking completion processing is unavailable' using errcode='42501'; end if;
  return query
  with candidates as (
    select requests.id booking_request_id,confirmations.id confirmation_id,commitments.id commitment_id,
      upper(range_merge(commitments.access_ranges)) effective_end,
      case when outcomes.id is not null then 'assess_maturity'
        when cancellations.id is not null then 'assess_maturity' else 'complete' end action,
      outcomes.id lifecycle_outcome_id,cancellations.id cancellation_id
    from public.booking_requests requests
    join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id
    join public.cottage_booking_period_commitments commitments on commitments.id=requests.booking_period_commitment_id
    left join public.booking_lifecycle_outcomes outcomes on outcomes.booking_request_id=requests.id
    left join public.booking_cancellations cancellations on cancellations.booking_request_id=requests.id
    left join public.booking_completion_maturity maturity on maturity.booking_request_id=requests.id
    where maturity.booking_request_id is null and public.booking_completion_is_due(upper(range_merge(commitments.access_ranges)),clock_timestamp())
      and ((public.booking_request_payment_status(requests)='paid-confirmed' and commitments.status='confirmed_booking') or
        (cancellations.id is not null and commitments.status='cancelled_booking'))
      and not exists(select 1 from public.booking_request_confirmation_invalidations where booking_request_id=requests.id)
      and not exists(select 1 from public.booking_request_payment_required_expiry_work where booking_request_id=requests.id and state='quarantined')
      and (
        (outcomes.id is null and cancellations.id is null and not exists(select 1 from public.booking_incidents incidents where incidents.booking_request_id=requests.id)) or
        outcomes.outcome='no_show' or
        (cancellations.actor_role='customer' and cancellations.refund_booking_price_fils=0 and cancellations.refund_booking_service_fee_fils=0
          and not exists(select 1 from public.booking_incidents incidents where incidents.booking_request_id=requests.id
            and incidents.recorded_at<=cancellations.occurred_at))
      )
    order by effective_end,requests.id limit target_limit
  ), projected as (
    select candidates.*,jsonb_build_object('bookingRequestId',booking_request_id,'confirmationId',confirmation_id,
      'bookingPeriodCommitmentId',commitment_id,'effectivePeriodEnd',effective_end,'action',action,
      'lifecycleOutcomeId',lifecycle_outcome_id,'cancellationId',cancellation_id) revision_source
    from candidates
  )
  select jsonb_build_object('bookingRequestId',booking_request_id,'action',action,'effectivePeriodEnd',effective_end,
    'observedAt',clock_timestamp(),'revision',md5(revision_source::text)) from projected;
end;
$$;

CREATE OR REPLACE FUNCTION public.commit_booking_completion(target_booking_request_id uuid,target_revision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare source jsonb; declare revision_source jsonb; declare outcome record; declare recorded timestamptz;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Booking completion processing is unavailable' using errcode='42501'; end if;
  source:=public.booking_completion_source(target_booking_request_id);
  revision_source:=jsonb_build_object('bookingRequestId',source->'bookingRequestId','confirmationId',source->'confirmationId',
    'bookingPeriodCommitmentId',source->'bookingPeriodCommitmentId','effectivePeriodEnd',source->'effectivePeriodEnd','action','complete',
    'lifecycleOutcomeId',null,'cancellationId',null);
  select * into outcome from public.booking_lifecycle_outcomes where booking_request_id=target_booking_request_id;
  if outcome.id is not null then
    if outcome.outcome='completed' then return jsonb_build_object('status','completed','bookingRequestId',outcome.booking_request_id,
      'effectivePeriodEnd',outcome.effective_period_end,'completedAt',outcome.recorded_at); end if;
    return jsonb_build_object('status','ineligible','bookingRequestId',target_booking_request_id);
  end if;
  if md5(revision_source::text) is distinct from target_revision or not public.booking_completion_is_due((source->>'effectivePeriodEnd')::timestamptz,clock_timestamp()) or
    exists(select 1 from public.booking_cancellations where booking_request_id=target_booking_request_id) or
    exists(select 1 from public.booking_incidents where booking_request_id=target_booking_request_id)
  then return jsonb_build_object('status','ineligible','bookingRequestId',target_booking_request_id); end if;
  recorded:=clock_timestamp();
  insert into public.booking_lifecycle_outcomes(booking_request_id,booking_confirmation_id,booking_period_commitment_id,outcome,effective_period_end,recorded_at)
  values(target_booking_request_id,(source->>'confirmationId')::uuid,(source->>'bookingPeriodCommitmentId')::uuid,'completed',(source->>'effectivePeriodEnd')::timestamptz,recorded) returning * into outcome;
  insert into public.booking_completion_maturity(booking_request_id,lifecycle_outcome_id,outcome,effective_period_end,assessed_at,review_expires_at,payout_prerequisite_at)
  values(target_booking_request_id,outcome.id,'completed',outcome.effective_period_end,recorded,outcome.effective_period_end+interval '14 days',outcome.effective_period_end);
  return jsonb_build_object('status','completed','bookingRequestId',outcome.booking_request_id,'effectivePeriodEnd',outcome.effective_period_end,'completedAt',outcome.recorded_at);
end;
$$;

CREATE OR REPLACE FUNCTION public.commit_booking_completion_maturity(target_booking_request_id uuid,target_revision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare source jsonb; declare lifecycle record; declare cancellation public.booking_cancellations;
declare existing record; declare action_outcome text; declare source_id uuid; declare projected jsonb; declare assessed timestamptz;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Booking maturity processing is unavailable' using errcode='42501'; end if;
  source:=public.booking_completion_source(target_booking_request_id);
  select * into cancellation from public.booking_cancellations where booking_request_id=target_booking_request_id;
  -- Both event times are recorded under the shared request lock; equal-time evidence fails closed.
  -- Revalidate before replay so a previously incorrect maturity is not endorsed again.
  if cancellation.id is not null and exists(select 1 from public.booking_incidents incidents
    where incidents.booking_request_id=target_booking_request_id and incidents.recorded_at<=cancellation.occurred_at)
  then return jsonb_build_object('status','ineligible','bookingRequestId',target_booking_request_id); end if;
  select * into existing from public.booking_completion_maturity where booking_request_id=target_booking_request_id;
  if existing.booking_request_id is not null then return jsonb_build_object('status','matured','bookingRequestId',existing.booking_request_id,
    'effectivePeriodEnd',existing.effective_period_end,'assessedAt',existing.assessed_at); end if;
  select * into lifecycle from public.booking_lifecycle_outcomes where booking_request_id=target_booking_request_id;
  if lifecycle.outcome='no_show' then action_outcome:='no_show'; source_id:=lifecycle.id;
  elsif cancellation.actor_role='customer' and cancellation.refund_booking_price_fils=0 and cancellation.refund_booking_service_fee_fils=0 then action_outcome:='late_customer_cancellation'; source_id:=cancellation.id;
  else return jsonb_build_object('status','ineligible','bookingRequestId',target_booking_request_id); end if;
  projected:=jsonb_build_object('bookingRequestId',source->'bookingRequestId','confirmationId',source->'confirmationId',
    'bookingPeriodCommitmentId',source->'bookingPeriodCommitmentId','effectivePeriodEnd',source->'effectivePeriodEnd','action','assess_maturity',
    'lifecycleOutcomeId',case when action_outcome='no_show' then to_jsonb(source_id) else null end,
    'cancellationId',case when action_outcome='late_customer_cancellation' then to_jsonb(source_id) else null end);
  if md5(projected::text) is distinct from target_revision or not public.booking_completion_is_due((source->>'effectivePeriodEnd')::timestamptz,clock_timestamp()) then
    return jsonb_build_object('status','ineligible','bookingRequestId',target_booking_request_id); end if;
  assessed:=clock_timestamp();
  insert into public.booking_completion_maturity(booking_request_id,lifecycle_outcome_id,cancellation_id,outcome,effective_period_end,assessed_at,review_expires_at,payout_prerequisite_at)
  values(target_booking_request_id,case when action_outcome='no_show' then source_id end,case when action_outcome='late_customer_cancellation' then source_id end,
    action_outcome,(source->>'effectivePeriodEnd')::timestamptz,assessed,null,(source->>'effectivePeriodEnd')::timestamptz);
  return jsonb_build_object('status','matured','bookingRequestId',target_booking_request_id,'effectivePeriodEnd',source->'effectivePeriodEnd','assessedAt',assessed);
end;
$$;

CREATE OR REPLACE FUNCTION public.get_booking_no_show_facts(target_booking_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare source jsonb; declare first_start timestamptz; declare snapshot public.booking_snapshots; declare existing record; declare projected jsonb;
begin
  if public.is_platform_administrator('aal2') is not true then raise exception 'Booking no-show is unavailable' using errcode='42501'; end if;
  source:=public.booking_completion_source(target_booking_request_id);
  select * into existing from public.booking_lifecycle_outcomes where booking_request_id=target_booking_request_id;
  select snapshots.* into snapshot from public.booking_requests requests join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id where requests.id=target_booking_request_id;
  first_start:=(snapshot.quote_payload#>>'{items,0,startsAt}')::timestamptz;
  if first_start is null or first_start is distinct from lower(range_merge((select access_ranges from public.cottage_booking_period_commitments where id=(source->>'bookingPeriodCommitmentId')::uuid))) or
    (existing.id is null and (clock_timestamp()<first_start or exists(select 1 from public.booking_cancellations where booking_request_id=target_booking_request_id) or exists(select 1 from public.booking_incidents where booking_request_id=target_booking_request_id))) or
    (existing.id is not null and existing.outcome<>'no_show')
  then raise exception 'Booking cannot be recorded as a no-show' using errcode='RC409'; end if;
  projected:=jsonb_build_object('bookingRequestId',source->'bookingRequestId','confirmationId',source->'confirmationId','bookingPeriodCommitmentId',source->'bookingPeriodCommitmentId',
    'firstStartsAt',first_start,'effectivePeriodEnd',source->'effectivePeriodEnd','captured',jsonb_build_object('bookingPriceFils',(snapshot.quote_payload->>'bookingPriceIqd')::bigint*1000,'bookingServiceFeeFils',(snapshot.quote_payload->>'serviceFeeIqd')::bigint*1000));
  return projected||jsonb_build_object('revision',md5(projected::text),'observedAt',coalesce(existing.recorded_at,clock_timestamp()));
end;
$$;

CREATE OR REPLACE FUNCTION public.commit_booking_no_show(target_booking_request_id uuid,target_command_id uuid,target_reason text,target_decision jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare facts jsonb; declare fingerprint text; declare existing record; declare recorded timestamptz;
begin
  facts:=public.get_booking_no_show_facts(target_booking_request_id);
  if target_command_id is null or target_reason is null or length(btrim(target_reason)) not between 1 and 2000 then raise exception 'No-show attribution is invalid' using errcode='22023'; end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('bookingRequestId',target_booking_request_id,'actorUserId',(select auth.uid()),'reason',target_reason)::text,'UTF8'),'sha256'),'hex');
  select * into existing from public.booking_lifecycle_outcomes where command_id=target_command_id;
  if found then
    if existing.command_fingerprint is distinct from fingerprint then raise exception 'No-show command identity was reused' using errcode='RC409'; end if;
    return jsonb_build_object('status','no_show','bookingRequestId',existing.booking_request_id,'noShowId',existing.id,'occurredAt',existing.recorded_at,'refundObligation',jsonb_build_object('bookingPriceFils',0,'bookingServiceFeeFils',0));
  end if;
  select * into existing from public.booking_lifecycle_outcomes where booking_request_id=target_booking_request_id;
  if found then raise exception 'Booking already has a final lifecycle outcome' using errcode='RC409'; end if;
  if exists(select 1 from public.booking_cancellations where booking_request_id=target_booking_request_id) or exists(select 1 from public.booking_incidents where booking_request_id=target_booking_request_id) then raise exception 'Booking cannot be recorded as a no-show' using errcode='RC409'; end if;
  if target_decision is distinct from jsonb_build_object('revision',facts->>'revision','refundObligation',jsonb_build_object('bookingPriceFils',0,'bookingServiceFeeFils',0)) then return jsonb_build_object('status','stale'); end if;
  recorded:=(facts->>'observedAt')::timestamptz;
  insert into public.booking_lifecycle_outcomes(booking_request_id,booking_confirmation_id,booking_period_commitment_id,outcome,command_id,command_fingerprint,actor_user_id,reason,effective_period_end,recorded_at)
  values(target_booking_request_id,(facts->>'confirmationId')::uuid,(facts->>'bookingPeriodCommitmentId')::uuid,'no_show',target_command_id,fingerprint,(select auth.uid()),btrim(target_reason),(facts->>'effectivePeriodEnd')::timestamptz,recorded) returning * into existing;
  return jsonb_build_object('status','no_show','bookingRequestId',existing.booking_request_id,'noShowId',existing.id,'occurredAt',existing.recorded_at,'refundObligation',jsonb_build_object('bookingPriceFils',0,'bookingServiceFeeFils',0));
end;
$$;

CREATE OR REPLACE FUNCTION public.record_booking_incident(target_booking_request_id uuid,target_command_id uuid,target_actor_role text,target_category text,target_narrative text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare actor uuid:=(select auth.uid()); declare context public.account_contexts; declare request public.booking_requests; declare confirmation public.booking_confirmations; declare existing record; declare fingerprint text; declare recorded timestamptz;
begin
  select * into context from public.account_contexts where user_id=actor;
  select * into request from public.booking_requests where id=target_booking_request_id for update;
  if actor is null or request.id is null or target_command_id is null or target_category not in ('safety','property_damage','conduct','other') or target_narrative is null or length(btrim(target_narrative)) not between 1 and 2000 or not (
    (target_actor_role='platform_administrator' and public.is_platform_administrator('aal2')) or
    (target_actor_role='cottage_owner' and context.role='cottage_owner' and context.owner_approval_state='approved' and request.owner_user_id=actor and exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null))
  ) is true then raise exception 'Booking incident is unavailable' using errcode='42501'; end if;
  select * into confirmation from public.booking_confirmations where booking_request_id=request.id;
  if confirmation.id is null then raise exception 'Confirmed booking source is invalid' using errcode='RC409'; end if;
  fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('bookingRequestId',request.id,'actorUserId',actor,'actorRole',target_actor_role,'category',target_category,'narrative',target_narrative)::text,'UTF8'),'sha256'),'hex');
  select * into existing from public.booking_incidents where command_id=target_command_id;
  if found then
    if existing.command_fingerprint is distinct from fingerprint then raise exception 'Incident command identity was reused' using errcode='RC409'; end if;
    return jsonb_build_object('status','recorded','bookingRequestId',existing.booking_request_id,'incidentId',existing.id,'recordedAt',existing.recorded_at);
  end if;
  recorded:=clock_timestamp();
  insert into public.booking_incidents(booking_request_id,booking_confirmation_id,customer_user_id,owner_user_id,profile_id,command_id,command_fingerprint,actor_user_id,actor_role,category,narrative,recorded_at)
  values(request.id,confirmation.id,request.customer_user_id,request.owner_user_id,request.profile_id,target_command_id,fingerprint,actor,target_actor_role,target_category,btrim(target_narrative),recorded) returning * into existing;
  return jsonb_build_object('status','recorded','bookingRequestId',existing.booking_request_id,'incidentId',existing.id,'recordedAt',existing.recorded_at);
end;
$$;

CREATE OR REPLACE FUNCTION public.get_booking_lifecycle(target_reference text,target_actor_role text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare actor uuid:=(select auth.uid()); declare context public.account_contexts; declare request public.booking_requests; declare lifecycle record; declare result jsonb;
begin
  select * into context from public.account_contexts where user_id=actor;
  select * into request from public.booking_requests where booking_request_reference=target_reference;
  if request.id is null or actor is null or not (
    (target_actor_role='platform_administrator' and public.is_platform_administrator('aal2')) or
    (target_actor_role='customer' and context.role in ('customer','cottage_owner') and request.customer_user_id=actor) or
    (target_actor_role='cottage_owner' and context.role='cottage_owner' and context.owner_approval_state='approved' and request.owner_user_id=actor)
  ) is true then raise exception 'Booking lifecycle is unavailable' using errcode='42501'; end if;
  if not exists(select 1 from public.booking_confirmations where booking_request_id=request.id) then raise exception 'Confirmed booking source is invalid' using errcode='RC409'; end if;
  select * into lifecycle from public.booking_lifecycle_outcomes where booking_request_id=request.id;
  result:=jsonb_build_object('bookingRequestId',request.id,'status',case when lifecycle.id is not null then lifecycle.outcome when exists(select 1 from public.booking_cancellations where booking_request_id=request.id) then 'cancelled' when exists(select 1 from public.booking_incidents where booking_request_id=request.id) then 'incident_pending' else 'confirmed' end);
  if target_actor_role='platform_administrator' then
    result:=result||jsonb_build_object('noShow',case when lifecycle.outcome='no_show' then jsonb_build_object('actorUserId',lifecycle.actor_user_id,'reason',lifecycle.reason,'recordedAt',lifecycle.recorded_at) end);
    result:=result||jsonb_build_object('incidents',(
      select coalesce(jsonb_agg(incident order by recorded_at,id),'[]') from (
        select incidents.id,incidents.recorded_at,jsonb_build_object('id',incidents.id,'source','lifecycle',
          'category',incidents.category,'narrative',incidents.narrative,'actorUserId',incidents.actor_user_id,
          'actorRole',incidents.actor_role,'recordedAt',incidents.recorded_at) incident
        from public.booking_incidents incidents where incidents.booking_request_id=request.id
        union all
        select incidents.id,incidents.recorded_at,jsonb_build_object('id',incidents.id,'source','cancellation',
          'cancellationId',cancellations.id,'category',cancellations.category,'narrative',cancellations.reason,
          'actorUserId',cancellations.actor_user_id,'actorRole',cancellations.actor_role,'recordedAt',incidents.recorded_at)
        from public.booking_cancellation_incidents incidents
        join public.booking_cancellations cancellations on cancellations.id=incidents.cancellation_id
        where cancellations.booking_request_id=request.id
      ) incident_sources));
  end if;
  return result;
end;
$$;

CREATE OR REPLACE FUNCTION public.get_booking_completion_eligibility(target_reference text,target_actor_role text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare lifecycle jsonb; declare request_id uuid; declare maturity record; declare observed timestamptz:=clock_timestamp();
begin
  lifecycle:=public.get_booking_lifecycle(target_reference,target_actor_role); request_id:=(lifecycle->>'bookingRequestId')::uuid;
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
$$;
