-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.commit_booking_completion_maturity (
  target_booking_request_id uuid,
  target_revision           text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_booking_completion_eligibility (
  target_reference  text,
  target_actor_role text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.list_due_booking_completions (
  target_limit integer
)
  RETURNS SETOF jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;