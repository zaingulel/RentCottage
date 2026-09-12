-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.due_booking_refunds(target_limit integer);

CREATE FUNCTION public.claim_due_booking_refunds (
  target_limit integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare scheduled_at timestamptz:=clock_timestamp(); declare claimed jsonb;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Refund batch unavailable' using errcode='42501'; end if;
  if target_limit is null or target_limit<1 or target_limit>50 then raise exception 'Refund batch size is invalid' using errcode='22023'; end if;
  with candidates as materialized (
    select requests.id,greatest(coalesce(requests.refund_last_scheduled_at,due.due_since),due.due_since) as priority
    from public.booking_requests requests
    cross join lateral (
      select min(work.due_since) as due_since from (
        select intent.created_at as due_since from public.booking_refund_intents intent
        where intent.booking_request_id=requests.id and public.booking_refund_intent_state(intent.id) in ('requested','processing','unknown')
        union all
        select cancelled.occurred_at from public.booking_cancellations cancelled
        where cancelled.booking_request_id=requests.id and cancelled.refund_booking_price_fils+cancelled.refund_booking_service_fee_fils>0
          and not exists(select 1 from public.booking_refund_intents intent where intent.booking_request_id=requests.id and intent.source='cancellation' and public.booking_refund_intent_state(intent.id)='failed')
          and (select coalesce(sum(intent.booking_price_fils+intent.booking_service_fee_fils),0) from public.booking_refund_intents intent where intent.booking_request_id=requests.id and public.booking_refund_intent_state(intent.id)='succeeded')
            <cancelled.refund_booking_price_fils+cancelled.refund_booking_service_fee_fils
      ) work
    ) due
    where due.due_since is not null
    order by priority,requests.id limit target_limit for update of requests skip locked
  ), scheduled as (
    update public.booking_requests requests set refund_last_scheduled_at=scheduled_at
    from candidates where requests.id=candidates.id returning requests.id
  )
  select coalesce(jsonb_agg(scheduled.id order by candidates.priority,scheduled.id),'[]'::jsonb) into claimed
    from scheduled join candidates on candidates.id=scheduled.id;
  return claimed;
end;
$function$;

REVOKE ALL ON FUNCTION public.claim_due_booking_refunds(integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.claim_due_booking_refunds(integer) TO service_role;

ALTER TABLE public.booking_requests
  ADD COLUMN refund_last_scheduled_at timestamp with time zone;