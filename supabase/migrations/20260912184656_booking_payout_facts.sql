-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

ALTER TABLE public.booking_refund_intents
  DROP CONSTRAINT booking_refund_intents_check1;

ALTER TABLE public.booking_refund_intents
  DROP CONSTRAINT booking_refund_intents_source_check;

CREATE FUNCTION public.get_booking_payout_facts (
  target_booking_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare source jsonb; declare commands jsonb; declare disputes jsonb; declare holds jsonb;
begin
  if current_setting('role',true)<>'service_role' and not public.is_platform_administrator('aal2') then
    raise exception 'Payout facts unavailable' using errcode='42501'; end if;
  source:=public.get_booking_refund_facts(target_booking_request_id);
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

REVOKE ALL ON FUNCTION public.get_booking_payout_facts(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_booking_payout_facts(uuid) TO authenticated;

GRANT ALL ON FUNCTION public.get_booking_payout_facts(uuid) TO service_role;

CREATE FUNCTION public.record_booking_payout_command (
  target_booking_request_id uuid,
  target_command_id         uuid,
  target_action             text,
  target_reason             text,
  target_subject_id         uuid,
  target_outcome            text,
  target_allocation         jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.record_booking_payout_command(uuid, uuid, text, text, uuid, text, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_booking_payout_command(uuid, uuid, text, text, uuid, text, jsonb) TO authenticated;

CREATE TABLE public.booking_payout_commands (
  id                       uuid                     NOT NULL,
  booking_request_id       uuid                     NOT NULL,
  capture_operation_id     uuid                     NOT NULL,
  action                   text                     NOT NULL,
  subject_id               uuid,
  outcome                  text,
  booking_price_fils       bigint,
  booking_service_fee_fils bigint,
  actor_user_id            uuid                     NOT NULL,
  reason                   text                     NOT NULL,
  command_fingerprint      text                     NOT NULL,
  occurred_at              timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE FUNCTION public.booking_payout_command_receipt (
  target public.booking_payout_commands
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select jsonb_build_object('status','recorded','bookingRequestId',target.booking_request_id,'commandId',target.id,'occurredAt',target.occurred_at);
$function$;

REVOKE ALL ON FUNCTION public.booking_payout_command_receipt(public.booking_payout_commands) FROM PUBLIC;

ALTER TABLE public.booking_payout_commands
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_action_check CHECK (action = ANY (ARRAY['place_hold'::text, 'release_hold'::text, 'open_dispute'::text, 'resolve_dispute'::text]));

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_actor_fkey FOREIGN KEY (actor_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_booking_price_fils_check CHECK (booking_price_fils >= 0 AND (booking_price_fils % 10::bigint) = 0);

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_booking_service_fee_fils_check CHECK (booking_service_fee_fils >= 0);

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_capture_fkey FOREIGN KEY (capture_operation_id) REFERENCES public.payment_provider_operations(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_check CHECK ((action = ANY (ARRAY['release_hold'::text, 'resolve_dispute'::text])) = (subject_id IS NOT NULL));

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_check1 CHECK ((action = 'resolve_dispute'::text) = (outcome IS NOT NULL));

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_check2 CHECK (((outcome = ANY (ARRAY['customer_won'::text, 'partial_customer_award'::text])) IS TRUE) = (booking_price_fils IS NOT NULL));

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_check3 CHECK ((booking_price_fils IS NULL) = (booking_service_fee_fils IS NULL));

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_check4 CHECK ((booking_price_fils + booking_service_fee_fils) > 0);

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_command_fingerprint_check CHECK (length(command_fingerprint) = 64);

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_outcome_check CHECK (outcome = ANY (ARRAY['owner_won'::text, 'customer_won'::text, 'partial_customer_award'::text]));

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_pkey PRIMARY KEY (id);

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_reason_check CHECK (length(btrim(reason)) >= 1 AND length(btrim(reason)) <= 2000);

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_request_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_payout_commands
  ADD CONSTRAINT booking_payout_commands_subject_fkey FOREIGN KEY (subject_id) REFERENCES public.booking_payout_commands(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX booking_payout_commands_subject_unique ON public.booking_payout_commands (subject_id)
  WHERE subject_id IS NOT NULL;

CREATE INDEX booking_payout_commands_request_history ON public.booking_payout_commands (booking_request_id, occurred_at, id);

CREATE TRIGGER booking_payout_commands_immutable
  BEFORE DELETE OR UPDATE ON public.booking_payout_commands
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_booking_cancellation_fact_change();

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_check2 CHECK (source = 'cancellation'::text AND cancellation_id IS
    NOT NULL AND actor_user_id IS NULL AND reason IS NULL OR (source = ANY (ARRAY['administrator'::text, 'dispute'::text])) AND actor_user_id IS NOT NULL AND reason IS
    NOT NULL AND length(btrim(reason)) >= 1 AND length(btrim(reason)) <= 2000);

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_source_check CHECK (source = ANY (ARRAY['cancellation'::text, 'administrator'::text, 'dispute'::text]));

ALTER TABLE public.booking_refund_intents
  ADD COLUMN dispute_resolution_id uuid;

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_dispute_fkey FOREIGN KEY (dispute_resolution_id) REFERENCES public.booking_payout_commands(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_dispute_resolution_id_key UNIQUE (dispute_resolution_id);

ALTER TABLE public.booking_refund_intents
  ADD CONSTRAINT booking_refund_intents_check1 CHECK ((source = 'dispute'::text) = (dispute_resolution_id IS NOT NULL));
-- Keep API privileges explicit, including environments with legacy defaults.
REVOKE ALL ON TABLE public.booking_payout_commands FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.booking_payout_command_receipt(public.booking_payout_commands),public.get_booking_payout_facts(uuid),public.record_booking_payout_command(uuid,uuid,text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_payout_facts(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_booking_payout_command(uuid,uuid,text,text,uuid,text,jsonb) TO authenticated;
