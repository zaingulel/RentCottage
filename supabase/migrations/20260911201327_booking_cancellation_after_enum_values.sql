-- Migration unit 2: after_enum_values
-- Transaction mode: transactional
-- Boundary reason: enum_value_visibility

SET check_function_bodies = false;

CREATE FUNCTION public.commit_booking_cancellation (
  target_booking_request_id uuid,
  target_command_id         uuid,
  target_actor_role         text,
  target_reason             text,
  target_category           text,
  target_decision           jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.commit_booking_cancellation(uuid, uuid, text, text, text, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.commit_booking_cancellation(uuid, uuid, text, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_cottage_booking_period_commitment_transition()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if new.customer_user_id is distinct from old.customer_user_id
    or new.profile_id is distinct from old.profile_id
    or new.schedule_revision_id is distinct from old.schedule_revision_id
    or new.access_ranges is distinct from old.access_ranges
    or new.created_at is distinct from old.created_at then
    raise exception 'Booking Period commitment snapshots are immutable'
      using errcode = 'RC204';
  end if;
  if new.status is distinct from old.status and not (
    (old.status='confirmed_booking' and new.status='pending_hold'
      and exists(select 1 from public.booking_request_confirmation_invalidations invalidation
        join public.booking_requests requests on requests.id=invalidation.booking_request_id
        join public.booking_request_payment_required_expiry_work expiry on expiry.id=invalidation.expiry_work_id
        where requests.booking_period_commitment_id=old.id and expiry.state in ('processing','quarantined')))
    or (old.status='confirmed_booking' and new.status='cancelled_booking'
      and exists(select 1 from public.booking_cancellations cancellations
        join public.booking_requests requests on requests.id=cancellations.booking_request_id
        where requests.booking_period_commitment_id=old.id))
    or (
    old.status = 'pending_hold'::public.cottage_inventory_commitment_status
    and new.status in (
      'confirmed_booking'::public.cottage_inventory_commitment_status,
      'released_hold'::public.cottage_inventory_commitment_status
    )
  )) then
    raise exception 'A Booking Period commitment cannot move backwards'
      using errcode = 'RC204';
  end if;
  if new.commitment_reference is distinct from old.commitment_reference
    and not (
      old.status = 'pending_hold'::public.cottage_inventory_commitment_status
      and new.status = 'confirmed_booking'::public.cottage_inventory_commitment_status
    ) then
    raise exception 'A Booking Period reference can change only when its Pending Hold is confirmed'
      using errcode = 'RC204';
  end if;
  return new;
end;
$function$;

CREATE FUNCTION public.get_booking_cancellation_facts (
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
$function$;

REVOKE ALL ON FUNCTION public.get_booking_cancellation_facts(uuid, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_booking_cancellation_facts(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_confirmed_booking_history()
  RETURNS SETOF jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid:=(select auth.uid()); declare context public.account_contexts;
begin
  select * into context from public.account_contexts where user_id=actor;
  if actor is null or context.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null) or context.role not in ('customer','cottage_owner') then raise exception 'Booking History unavailable' using errcode='42501'; end if;
  return query select jsonb_build_object('receiptId',receipts.id,'bookingRequestReference',requests.booking_request_reference,'bookingReference',commitments.commitment_reference,'cottageName',snapshots.quote_payload->>'cottageName','confirmedAt',confirmations.confirmed_at,'actorRole',receipts.recipient_role)
  from public.booking_receipts receipts join public.booking_confirmations confirmations on confirmations.id=receipts.booking_confirmation_id join public.booking_requests requests on requests.id=confirmations.booking_request_id join public.booking_snapshots snapshots on snapshots.id=receipts.booking_snapshot_id join public.cottage_booking_period_commitments commitments on commitments.id=confirmations.booking_period_commitment_id
  where receipts.recipient_user_id=actor and ((receipts.recipient_role='customer' and requests.customer_user_id=actor and context.role in ('customer','cottage_owner')) or (receipts.recipient_role='cottage_owner' and requests.owner_user_id=actor and context.role='cottage_owner' and context.owner_approval_state='approved')) and (public.booking_request_payment_status(requests)='paid-confirmed' or exists(select 1 from public.booking_cancellations cancellations where cancellations.booking_request_id=requests.id)) order by confirmations.confirmed_at desc,receipts.id;
end $function$;

CREATE FUNCTION public.reject_booking_cancellation_fact_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  raise exception 'Booking cancellation facts are immutable' using errcode='RC409';
end;
$function$;

REVOKE ALL ON FUNCTION public.reject_booking_cancellation_fact_change() FROM PUBLIC;

CREATE TABLE public.booking_cancellation_administrator_audit (
  cancellation_id       uuid                     NOT NULL,
  administrator_user_id uuid                     NOT NULL,
  recorded_at           timestamp with time zone NOT NULL
);

ALTER TABLE public.booking_cancellation_administrator_audit
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_cancellation_administrator_audit
  ADD CONSTRAINT booking_cancellation_administrator_audit_administrator_user_id_ FOREIGN KEY (administrator_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;

ALTER TABLE public.booking_cancellation_administrator_audit
  ADD CONSTRAINT booking_cancellation_administrator_audit_pkey PRIMARY KEY (cancellation_id);

CREATE TRIGGER reject_booking_cancellation_administrator_audit_change
  BEFORE DELETE OR UPDATE ON public.booking_cancellation_administrator_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_booking_cancellation_fact_change();

CREATE TABLE public.booking_cancellation_incidents (
  id              uuid                     DEFAULT gen_random_uuid() NOT NULL,
  cancellation_id uuid                     NOT NULL,
  recorded_at     timestamp with time zone NOT NULL
);

ALTER TABLE public.booking_cancellation_incidents
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_cancellation_incidents
  ADD CONSTRAINT booking_cancellation_incidents_cancellation_id_key UNIQUE (cancellation_id);

ALTER TABLE public.booking_cancellation_incidents
  ADD CONSTRAINT booking_cancellation_incidents_pkey PRIMARY KEY (id);

CREATE TRIGGER reject_booking_cancellation_incidents_change
  BEFORE DELETE OR UPDATE ON public.booking_cancellation_incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_booking_cancellation_fact_change();

CREATE TABLE public.booking_cancellations (
  id                              uuid                     DEFAULT gen_random_uuid() NOT NULL,
  booking_request_id              uuid                     NOT NULL,
  booking_confirmation_id         uuid                     NOT NULL,
  capture_operation_id            uuid                     NOT NULL,
  command_id                      uuid                     NOT NULL,
  command_fingerprint             text                     NOT NULL,
  actor_user_id                   uuid                     NOT NULL,
  actor_role                      text                     NOT NULL,
  reason                          text,
  category                        text,
  first_starts_at                 timestamp with time zone NOT NULL,
  occurred_at                     timestamp with time zone NOT NULL,
  refund_booking_price_fils       bigint                   NOT NULL,
  refund_booking_service_fee_fils bigint                   NOT NULL
);

CREATE FUNCTION public.booking_cancellation_result (
  target public.booking_cancellations
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select jsonb_build_object('status','cancelled','bookingRequestId',target.booking_request_id,'cancellationId',target.id,'occurredAt',target.occurred_at,
    'refundObligation',jsonb_build_object('bookingPriceFils',target.refund_booking_price_fils,'bookingServiceFeeFils',target.refund_booking_service_fee_fils));
$function$;

REVOKE ALL ON FUNCTION public.booking_cancellation_result(public.booking_cancellations) FROM PUBLIC;

ALTER TABLE public.booking_cancellations
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_cancellations
  ADD CONSTRAINT booking_cancellation_reason CHECK (actor_role = 'customer'::text AND reason IS NULL AND category IS NULL OR actor_role = 'cottage_owner'::text AND reason IS
    NOT NULL AND length(btrim(reason)) >= 1 AND length(btrim(reason)) <= 2000 AND category IS NULL OR actor_role = 'platform_administrator'::text AND reason IS
    NOT NULL AND length(btrim(reason)) >= 1 AND length(btrim(reason)) <= 2000 AND category IS
    NOT NULL AND (category = ANY (ARRAY['safety'::text, 'fraud'::text, 'legal'::text, 'serious_operational'::text])));

ALTER TABLE public.booking_cancellations
  ADD CONSTRAINT booking_cancellations_actor_role_check CHECK (actor_role = ANY (ARRAY['customer'::text, 'cottage_owner'::text, 'platform_administrator'::text]));

ALTER TABLE public.booking_cancellations
  ADD CONSTRAINT booking_cancellations_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;

ALTER TABLE public.booking_cancellations
  ADD CONSTRAINT booking_cancellations_booking_confirmation_id_fkey FOREIGN KEY (booking_confirmation_id) REFERENCES public.booking_confirmations(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_cancellations
  ADD CONSTRAINT booking_cancellations_booking_confirmation_id_key UNIQUE (booking_confirmation_id);

ALTER TABLE public.booking_cancellations
  ADD CONSTRAINT booking_cancellations_booking_request_id_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_cancellations
  ADD CONSTRAINT booking_cancellations_booking_request_id_key UNIQUE (booking_request_id);

ALTER TABLE public.booking_cancellations
  ADD CONSTRAINT booking_cancellations_capture_operation_id_fkey FOREIGN KEY (capture_operation_id) REFERENCES public.payment_provider_operations(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_cancellations
  ADD CONSTRAINT booking_cancellations_command_fingerprint_check CHECK (command_fingerprint ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE public.booking_cancellations
  ADD CONSTRAINT booking_cancellations_command_id_key UNIQUE (command_id);

ALTER TABLE public.booking_cancellations
  ADD CONSTRAINT booking_cancellations_pkey PRIMARY KEY (id);

ALTER TABLE public.booking_cancellation_administrator_audit
  ADD CONSTRAINT booking_cancellation_administrator_audit_cancellation_id_fkey FOREIGN KEY (cancellation_id) REFERENCES public.booking_cancellations(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_cancellation_incidents
  ADD CONSTRAINT booking_cancellation_incidents_cancellation_id_fkey FOREIGN KEY (cancellation_id) REFERENCES public.booking_cancellations(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_cancellations
  ADD CONSTRAINT booking_cancellations_refund_booking_price_fils_check CHECK (refund_booking_price_fils >= 0 AND (refund_booking_price_fils % 10::bigint) = 0);

ALTER TABLE public.booking_cancellations
  ADD CONSTRAINT booking_cancellations_refund_booking_service_fee_fils_check CHECK (refund_booking_service_fee_fils >= 0);

CREATE TRIGGER reject_booking_cancellations_change
  BEFORE DELETE OR UPDATE ON public.booking_cancellations
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_booking_cancellation_fact_change();

CREATE TABLE public.booking_notification_events (
  id                 uuid                                   DEFAULT gen_random_uuid() NOT NULL,
  booking_request_id uuid                                   NOT NULL,
  cancellation_id    uuid                                   NOT NULL,
  receipt_id         uuid                                   NOT NULL,
  event_kind         text                                   NOT NULL,
  recipient_user_id  uuid                                   NOT NULL,
  recipient_role     text                                   NOT NULL,
  notice_locale      public.cottage_profile_source_language NOT NULL,
  created_at         timestamp with time zone               NOT NULL
);

ALTER TABLE public.booking_notification_events
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_booking_request_id_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_cancellation_id_fkey FOREIGN KEY (cancellation_id) REFERENCES public.booking_cancellations(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_cancellation_id_recipient_role_key UNIQUE (cancellation_id, recipient_role);

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_event_kind_check CHECK (event_kind = 'cancelled'::text);

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_pkey PRIMARY KEY (id);

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.booking_receipts(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_recipient_role_check CHECK (recipient_role = ANY (ARRAY['customer'::text, 'cottage_owner'::text]));

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;

CREATE TRIGGER reject_booking_notification_events_change
  BEFORE DELETE OR UPDATE ON public.booking_notification_events
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_booking_cancellation_fact_change();

-- Explicit application-role privileges accompany the generated objects.
REVOKE ALL ON TABLE public.booking_cancellations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.booking_cancellation_incidents FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.booking_cancellation_administrator_audit FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.booking_notification_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_booking_cancellation_facts(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.commit_booking_cancellation(uuid,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.booking_cancellation_result(public.booking_cancellations) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_booking_cancellation_fact_change() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_cancellation_facts(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_booking_cancellation(uuid,uuid,text,text,text,jsonb) TO authenticated;
