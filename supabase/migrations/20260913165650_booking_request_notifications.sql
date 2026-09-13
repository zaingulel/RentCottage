-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

ALTER TABLE public.booking_confirmation_notification_work
  DROP CONSTRAINT booking_confirmation_notification_work_payload;

ALTER TABLE public.booking_notification_events
  DROP CONSTRAINT booking_notification_events_check;

ALTER TABLE public.booking_notification_events
  DROP CONSTRAINT booking_notification_events_event_kind_check;

CREATE OR REPLACE FUNCTION public.booking_notification_event_binding (
  target_event_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select jsonb_build_object('id',event.id,'kind',event.event_kind)||case when event.event_kind='preparation_reminder'
    then jsonb_build_object('dueAt',event.due_at,'firstStartsAt',event.first_starts_at)
    when event.receipt_id is null then jsonb_build_object('sourceId',coalesce(event.owner_request_notification_id,event.request_status_notification_id,event.payment_history_id),'deadlineAt',event.deadline_at)
    else jsonb_build_object('allocation',jsonb_build_object(
      'bookingPriceFils',coalesce(cancelled.refund_booking_price_fils,intent.booking_price_fils),
      'bookingServiceFeeFils',coalesce(cancelled.refund_booking_service_fee_fils,intent.booking_service_fee_fils))) end
  from public.booking_notification_events event left join public.booking_cancellations cancelled on cancelled.id=event.cancellation_id
    left join public.booking_refund_intents intent on intent.id=event.refund_intent_id where event.id=target_event_id;
$function$;

CREATE OR REPLACE FUNCTION public.booking_notification_is_deliverable (
  target public.booking_confirmation_notification_work
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select case when target.event_id is null then public.booking_request_payment_status(request)='paid-confirmed'
    else exists(select 1 from public.booking_notification_events event left join public.booking_receipts receipt on receipt.id=event.receipt_id
      join public.account_contexts context on context.user_id=event.recipient_user_id join auth.users actor on actor.id=context.user_id
      join public.cottage_booking_period_commitments commitment on commitment.id=request.booking_period_commitment_id
      where event.id=target.event_id and event.booking_request_id=request.id and event.receipt_id is not distinct from target.receipt_id
        and event.recipient_user_id=target.recipient_user_id and event.recipient_role=target.recipient_role and event.notice_locale=target.notice_locale
        and ((event.receipt_id is null and public.booking_request_notification_is_current(event)) or (receipt.recipient_user_id=target.recipient_user_id and receipt.recipient_role=target.recipient_role)) and actor.phone_confirmed_at is not null
        and ((event.recipient_role='customer' and request.customer_user_id=actor.id and context.role in ('customer','cottage_owner'))
          or (event.recipient_role='cottage_owner' and request.owner_user_id=actor.id and context.role='cottage_owner' and context.owner_approval_state='approved'))
        and (event.event_kind<>'preparation_reminder' or (public.booking_request_payment_status(request)='paid-confirmed'
          and commitment.status='confirmed_booking' and event.due_at<=clock_timestamp() and clock_timestamp()<event.first_starts_at
          and not exists(select 1 from public.booking_cancellations where booking_request_id=request.id)
          and not exists(select 1 from public.booking_lifecycle_outcomes where booking_request_id=request.id)
          and not exists(select 1 from public.booking_incidents where booking_request_id=request.id)
          and not exists(select 1 from public.booking_request_confirmation_invalidations where booking_request_id=request.id)
          and not exists(select 1 from public.booking_request_payment_required_expiry_work where booking_request_id=request.id and state='quarantined'))))
    end from public.booking_requests request where request.id=target.booking_request_id;
$function$;

CREATE FUNCTION public.booking_request_notification_is_current (
  event public.booking_notification_events
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce(public.booking_request_notification_source_valid(event) and
    case event.event_kind
      when 'request_new' then q.status='pending' and clock_timestamp()<q.response_deadline
      when 'request_accepted' then q.status='accepted' and public.booking_request_payment_status(q)='capture-processing'
      when 'request_payment_required' then q.status='accepted' and public.booking_request_payment_status(q)='payment-required' and clock_timestamp()<event.deadline_at and public.booking_request_payment_recovery_status(q)->>'status' in ('available','retryable')
      when 'request_declined' then q.status='declined'
      when 'request_withdrawn' then q.status='withdrawn'
      when 'request_expired' then q.status='expired'
      else event.recovery_generation=(select max(a.generation) from public.booking_request_payment_recovery_attempts a where a.booking_request_id=q.id)
        and public.booking_request_payment_recovery_status(q)->>'status'=case event.event_kind when 'recovery_processing' then 'processing' when 'recovery_retryable' then 'retryable' when 'recovery_attention' then 'quarantined' end
        and (event.event_kind='recovery_attention' or clock_timestamp()<event.deadline_at)
    end,false) from public.booking_requests q where q.id=event.booking_request_id;
$function$;

REVOKE ALL ON FUNCTION public.booking_request_notification_is_current(public.booking_notification_events) FROM PUBLIC;

CREATE FUNCTION public.booking_request_notification_source_valid (
  event public.booking_notification_events
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce(event.receipt_id is null and event.notice_locale=s.acceptance_locale and
    case
      when event.event_kind='request_new' then event.recipient_role='cottage_owner' and event.recipient_user_id=q.owner_user_id and event.deadline_at=q.response_deadline
        and exists(select 1 from public.owner_request_notifications n where n.id=event.owner_request_notification_id and n.booking_request_id=q.id and n.owner_user_id=event.recipient_user_id and n.created_at=event.created_at)
      when event.request_status_notification_id is not null then
        exists(select 1 from public.booking_request_status_notifications n where n.id=event.request_status_notification_id and n.booking_request_id=q.id and n.recipient_user_id=event.recipient_user_id
          and 'request_'||replace(n.status,'-','_')=event.event_kind and n.created_at=event.created_at)
        and ((event.recipient_role='customer' and event.recipient_user_id=q.customer_user_id) or (event.recipient_role='cottage_owner' and event.recipient_user_id=q.owner_user_id))
        and (event.event_kind<>'request_payment_required' or (event.recipient_role='customer' and event.deadline_at=w.payment_required_deadline))
      when event.payment_history_id is not null then event.recipient_role='customer' and event.recipient_user_id=q.customer_user_id and event.deadline_at=w.payment_required_deadline
        and exists(select 1 from public.booking_request_payment_history h join public.booking_request_payment_recovery_attempts a on a.booking_request_id=q.id and a.generation=event.recovery_generation
          where h.id=event.payment_history_id and h.booking_request_id=q.id and h.payment_lifecycle_id=q.payment_lifecycle_id and h.recorded_at=event.created_at
            and ((event.event_kind='recovery_processing' and h.source='recovery-attempt' and h.recovery_generation=a.generation and h.from_state is null and h.to_state in ('admitted','original_released'))
              or (event.event_kind='recovery_retryable' and h.source='recovery-attempt' and h.recovery_generation=a.generation and h.to_state='safely_failed')
              or (event.event_kind='recovery_attention' and h.source='expiry-work' and h.kind='quarantine' and h.to_state='quarantined' and a.created_at<=h.recorded_at
                and not exists(select 1 from public.booking_request_payment_recovery_attempts later where later.booking_request_id=q.id and later.generation>a.generation and later.created_at<=h.recorded_at))))
      else false end,false)
  from public.booking_requests q join public.booking_snapshots s on s.id=q.booking_snapshot_id left join public.booking_request_capture_work w on w.booking_request_id=q.id
  where q.id=event.booking_request_id;
$function$;

REVOKE ALL ON FUNCTION public.booking_request_notification_source_valid(public.booking_notification_events) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.complete_booking_confirmation_notification_delivery (
  target_receipt_id uuid,
  target_generation bigint,
  target_token      uuid,
  target_binding    jsonb,
  target_effect_id  uuid,
  target_event_id   uuid   DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare e public.fictional_booking_confirmation_notification_effects;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.notification_id=coalesce(target_event_id,target_receipt_id) for update of requests;
  select * into w from public.booking_confirmation_notification_work where notification_id=coalesce(target_event_id,target_receipt_id) for update;
  select * into e from public.fictional_booking_confirmation_notification_effects where id=target_effect_id and notification_id=coalesce(target_event_id,target_receipt_id) for update;
  if w.notification_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id or e.id is null or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() or public.booking_confirmation_notification_binding(w) is distinct from target_binding
    or (e.logical_id,e.booking_request_id,e.booking_request_reference,e.booking_reference,e.recipient_user_id,e.recipient_role,e.notice_locale,e.template_version,e.payload,e.payload_sha256) is distinct from (w.logical_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256)
    then return jsonb_build_object('status','stale'); end if;
  update public.booking_confirmation_notification_work set state='delivered',lease_token=null,lease_expires_at=null,last_outcome='delivered',supplier_delivery_reference=e.supplier_delivery_reference,delivered_at=e.executed_at,updated_at=clock_timestamp() where notification_id=w.notification_id;
  insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome,effect_id) values(w.receipt_id,w.event_id,target_generation,target_token,'complete','delivered',e.id);
  return jsonb_build_object('status','delivered','historical',not public.booking_notification_is_deliverable(w));
end $function$;

CREATE OR REPLACE FUNCTION public.ensure_booking_confirmation_notification_work (
  target_receipt_id uuid,
  target_locale     text,
  target_template   text,
  target_payload    jsonb,
  target_event_id   uuid  DEFAULT NULL::uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare r public.booking_receipts; declare s public.booking_snapshots; declare c public.cottage_booking_period_commitments; declare w public.booking_confirmation_notification_work; declare event public.booking_notification_events; declare target_hash text; declare expected_binding jsonb; declare event_binding jsonb; declare logical_id text; declare recipient uuid; declare recipient_role text; declare booking_reference text;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  if target_event_id is not null then
    select * into event from public.booking_notification_events where id=target_event_id;
    if event.id is null or event.receipt_id is distinct from target_receipt_id then raise exception 'Notification event source is invalid' using errcode='RC409'; end if;
    select * into q from public.booking_requests where id=event.booking_request_id for update;
    recipient:=event.recipient_user_id; recipient_role:=event.recipient_role;
    event_binding:=public.booking_notification_event_binding(event.id);
  else
    select requests.* into q from public.booking_requests requests join public.booking_confirmations x on x.booking_request_id=requests.id join public.booking_receipts receipt on receipt.booking_confirmation_id=x.id where receipt.id=target_receipt_id for update of requests;
  end if;
  select * into s from public.booking_snapshots where id=q.booking_snapshot_id;
  select * into c from public.cottage_booking_period_commitments where id=q.booking_period_commitment_id;
  if target_receipt_id is not null then
    select * into r from public.booking_receipts where id=target_receipt_id;
    if r.id is null or r.booking_snapshot_id is distinct from s.id or not exists(select 1 from public.booking_confirmations x where x.id=r.booking_confirmation_id and x.booking_request_id=q.id) then raise exception 'Unknown booking receipt' using errcode='RC404'; end if;
    recipient:=r.recipient_user_id; recipient_role:=r.recipient_role; booking_reference:=c.commitment_reference;
  elsif event.id is null or public.booking_request_notification_source_valid(event) is not true then
    raise exception 'Request notification source is invalid' using errcode='RC409';
  end if;
  if target_event_id is not null and ((event.recipient_user_id,event.recipient_role,event.notice_locale) is distinct from (recipient,recipient_role,s.acceptance_locale)
      or (event.event_kind='preparation_reminder' and (event.due_at,event.first_starts_at) is distinct from (lower(range_merge(c.access_ranges))-interval '24 hours',lower(range_merge(c.access_ranges)))))
    then raise exception 'Notification event source is invalid' using errcode='RC409'; end if;
  select * into w from public.booking_confirmation_notification_work where notification_id=coalesce(target_event_id,target_receipt_id) for update;
  target_hash:=encode(extensions.digest(convert_to(target_payload::text,'UTF8'),'sha256'),'hex');
  logical_id:=case when target_event_id is null then 'paid-confirmation:'||target_receipt_id else 'booking-event:'||target_event_id end;
  expected_binding:=jsonb_build_object('receiptId',target_receipt_id,'recipientUserId',recipient,'recipientRole',recipient_role,'bookingRequestReference',q.booking_request_reference,'bookingReference',booking_reference,'locale',target_locale,'logicalId',logical_id,'templateVersion',target_template,'payload',target_payload,'payloadSha256',target_hash)||case when target_event_id is null then '{}'::jsonb else jsonb_build_object('event',event_binding) end;
  if w.notification_id is not null then
    if public.booking_confirmation_notification_binding(w) is distinct from expected_binding then raise exception 'Notification binding is immutable' using errcode='RC409'; end if; return;
  end if;
  if q.id is null or (target_event_id is null and public.booking_request_payment_status(q) is distinct from 'paid-confirmed')
    or target_locale is distinct from s.acceptance_locale::text
    or target_template is distinct from (case when target_event_id is null then 'paid-confirmation-v1' else 'booking-event-v1' end)
    or target_payload->>'kind' is distinct from (case when target_event_id is null then 'paid-confirmation' else event.event_kind end)
    or (target_event_id is not null and event.event_kind in ('cancelled','refund_requested','refund_returned','refund_attention') and target_payload->'allocation' is distinct from event_binding->'allocation')
    or (target_event_id is not null and event.event_kind='preparation_reminder' and (target_payload->>'dueAt',target_payload->>'firstStartsAt') is distinct from (event_binding->>'dueAt',event_binding->>'firstStartsAt'))
    or (target_receipt_id is null and (target_payload->>'bookingRequestReference' is distinct from q.booking_request_reference or target_payload->'deadlineAt' is distinct from event_binding->'deadlineAt' or target_payload->'bookingReference' is distinct from 'null'::jsonb))
    or target_payload->>'bookingReference' is distinct from booking_reference
    or target_payload->>'detailsPath' is distinct from ('/'||target_locale||'/'||case when recipient_role='customer' then 'booking-requests/' else 'owner/booking-requests/' end||q.booking_request_reference)
    then raise exception 'Invalid booking notification binding' using errcode='RC409'; end if;
  insert into public.booking_confirmation_notification_work(receipt_id,event_id,booking_request_id,booking_request_reference,booking_reference,recipient_user_id,recipient_role,logical_id,notice_locale,template_version,payload,payload_sha256)
    values(target_receipt_id,target_event_id,q.id,q.booking_request_reference,booking_reference,recipient,recipient_role,logical_id,target_locale::public.cottage_profile_source_language,target_template,target_payload,target_hash);
end $function$;

CREATE FUNCTION public.ensure_booking_request_notification_events (
  target_booking_request_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  insert into public.booking_notification_events(booking_request_id,owner_request_notification_id,event_kind,recipient_user_id,recipient_role,notice_locale,deadline_at,created_at)
    select q.id,n.id,'request_new',n.owner_user_id,'cottage_owner',s.acceptance_locale,q.response_deadline,n.created_at
    from public.owner_request_notifications n join public.booking_requests q on q.id=n.booking_request_id join public.booking_snapshots s on s.id=q.booking_snapshot_id
    where q.id=target_booking_request_id and n.owner_user_id=q.owner_user_id
    on conflict do nothing;
  insert into public.booking_notification_events(booking_request_id,request_status_notification_id,event_kind,recipient_user_id,recipient_role,notice_locale,deadline_at,created_at)
    select q.id,n.id,'request_'||replace(n.status,'-','_'),n.recipient_user_id,case when n.recipient_user_id=q.customer_user_id then 'customer' else 'cottage_owner' end,s.acceptance_locale,
      case when n.status='payment-required' then w.payment_required_deadline end,n.created_at
    from public.booking_request_status_notifications n join public.booking_requests q on q.id=n.booking_request_id join public.booking_snapshots s on s.id=q.booking_snapshot_id
      left join public.booking_request_capture_work w on w.booking_request_id=q.id
    where q.id=target_booking_request_id and n.recipient_user_id in (q.customer_user_id,q.owner_user_id)
      and (n.status<>'payment-required' or (n.recipient_user_id=q.customer_user_id and w.payment_required_deadline is not null))
    on conflict do nothing;
  insert into public.booking_notification_events(booking_request_id,payment_history_id,recovery_generation,event_kind,recipient_user_id,recipient_role,notice_locale,deadline_at,created_at)
    select q.id,h.id,a.generation,case when h.source='recovery-attempt' and h.to_state in ('admitted','original_released') then 'recovery_processing'
      when h.source='recovery-attempt' and h.to_state='safely_failed' then 'recovery_retryable' else 'recovery_attention' end,
      q.customer_user_id,'customer',s.acceptance_locale,w.payment_required_deadline,h.recorded_at
    from public.booking_request_payment_history h join public.booking_requests q on q.id=h.booking_request_id join public.booking_snapshots s on s.id=q.booking_snapshot_id
      join public.booking_request_capture_work w on w.booking_request_id=q.id
      join lateral (select attempt.* from public.booking_request_payment_recovery_attempts attempt where attempt.booking_request_id=q.id
        and ((h.source='recovery-attempt' and attempt.generation=h.recovery_generation)
          or (h.source='expiry-work' and h.to_state='quarantined' and attempt.created_at<=h.recorded_at)) order by attempt.generation desc limit 1) a on true
    where q.id=target_booking_request_id and h.payment_lifecycle_id=q.payment_lifecycle_id and w.payment_required_deadline is not null
      and ((h.source='recovery-attempt' and ((h.to_state in ('admitted','original_released') and h.from_state is null) or h.to_state='safely_failed'))
        or (h.source='expiry-work' and h.kind='quarantine' and h.to_state='quarantined'))
    order by h.sequence on conflict do nothing;
end $function$;

REVOKE ALL ON FUNCTION public.ensure_booking_request_notification_events(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.execute_fictional_booking_confirmation_notification_effect (
  target_receipt_id uuid,
  target_generation bigint,
  target_token      uuid,
  target_binding    jsonb,
  target_event_id   uuid   DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare e public.fictional_booking_confirmation_notification_effects; declare recipient uuid; declare actor auth.users; declare context public.account_contexts;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.notification_id=coalesce(target_event_id,target_receipt_id) for update of requests;
  select work.recipient_user_id into recipient from public.booking_confirmation_notification_work work where work.notification_id=coalesce(target_event_id,target_receipt_id);
  select * into actor from auth.users where id=recipient for share;
  select * into context from public.account_contexts where user_id=recipient for share;
  select * into w from public.booking_confirmation_notification_work where notification_id=coalesce(target_event_id,target_receipt_id) for update;
  select * into e from public.fictional_booking_confirmation_notification_effects where notification_id=coalesce(target_event_id,target_receipt_id) for update;
  if w.notification_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() or public.booking_confirmation_notification_binding(w) is distinct from target_binding then return jsonb_build_object('status','stale'); end if;
  if e.id is not null then return jsonb_build_object('status','delivered','effectId',e.id,'supplierDeliveryReference',e.supplier_delivery_reference,'executedAt',e.executed_at); end if;
  if not public.booking_notification_is_deliverable(w) then
    update public.booking_confirmation_notification_work set state='suppressed',lease_token=null,lease_expires_at=null,last_outcome='suppressed',suppressed_at=clock_timestamp(),updated_at=clock_timestamp() where notification_id=w.notification_id;
    insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome) values(w.receipt_id,w.event_id,target_generation,target_token,'execute','suppressed'); return jsonb_build_object('status','suppressed');
  end if;
  insert into public.fictional_booking_confirmation_notification_effects(supplier,environment,logical_id,receipt_id,event_id,booking_request_id,booking_request_reference,booking_reference,recipient_user_id,recipient_role,notice_locale,template_version,payload,payload_sha256,execution_lease_generation,execution_lease_token,supplier_delivery_reference)
    values('fictional-notifications','local-test',w.logical_id,w.receipt_id,w.event_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256,target_generation,target_token,case when w.event_id is null then 'fictional-confirmation-'||w.receipt_id else 'fictional-booking-event-'||w.event_id end) returning * into e;
  insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome,effect_id) values(w.receipt_id,w.event_id,target_generation,target_token,'execute','delivered',e.id);
  return jsonb_build_object('status','delivered','effectId',e.id,'supplierDeliveryReference',e.supplier_delivery_reference,'executedAt',e.executed_at);
end $function$;

CREATE OR REPLACE FUNCTION public.get_booking_confirmation_notification_status (
  target_receipt_id uuid,
  target_event_id   uuid DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare r public.booking_receipts; declare event public.booking_notification_events; declare role public.account_contexts; declare actor uuid:=(select auth.uid()); declare recipient uuid; declare recipient_role text;
begin
  select * into w from public.booking_confirmation_notification_work where notification_id=coalesce(target_event_id,target_receipt_id);
  if target_event_id is not null then
    select * into event from public.booking_notification_events where id=target_event_id;
    if event.id is null or event.receipt_id is distinct from target_receipt_id then raise exception 'Notification status unavailable' using errcode='42501'; end if;
    select * into q from public.booking_requests where id=event.booking_request_id;
    recipient:=event.recipient_user_id; recipient_role:=event.recipient_role;
  else
    select * into r from public.booking_receipts where id=target_receipt_id;
    select requests.* into q from public.booking_requests requests join public.booking_confirmations x on x.booking_request_id=requests.id where x.id=r.booking_confirmation_id;
    recipient:=r.recipient_user_id; recipient_role:=r.recipient_role;
  end if;
  select * into role from public.account_contexts where user_id=actor;
  if actor is null or role.user_id is null or q.id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null)
    or recipient is distinct from actor or not ((recipient_role='customer' and role.role in ('customer','cottage_owner') and q.customer_user_id=actor) or (recipient_role='cottage_owner' and role.role='cottage_owner' and role.owner_approval_state='approved' and q.owner_user_id=actor))
    or (w.notification_id is not null and (w.receipt_id,w.event_id,w.recipient_user_id,w.recipient_role) is distinct from (target_receipt_id,target_event_id,recipient,recipient_role))
    or (w.notification_id is null and target_event_id is null and public.booking_request_payment_status(q) is distinct from 'paid-confirmed')
    then raise exception 'Notification status unavailable' using errcode='42501'; end if;
  if w.notification_id is null then return jsonb_build_object('receiptId',target_receipt_id,'state','pending','lastOutcome',null,'supplierDeliveryReference',null,'deliveredAt',null,'suppressedAt',null,'historical',false)||case when target_event_id is null then '{}'::jsonb else jsonb_build_object('eventId',target_event_id) end; end if;
  return jsonb_build_object('receiptId',w.receipt_id,'state',w.state,'lastOutcome',w.last_outcome,'supplierDeliveryReference',w.supplier_delivery_reference,'deliveredAt',w.delivered_at,'suppressedAt',w.suppressed_at,'historical',w.state='delivered' and not public.booking_notification_is_deliverable(w))||case when w.event_id is null then '{}'::jsonb else jsonb_build_object('eventId',w.event_id) end;
end $function$;

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
    'notifications',(select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('eventId',e.id,'receiptId',e.receipt_id,'kind',e.event_kind,'dueAt',e.due_at,'recipientRole',e.recipient_role,'state',coalesce(w.state,'pending'),'deliveredAt',w.delivered_at,'outcome',w.last_outcome,'retryAllowed',coalesce(target_actor_role<>'platform_administrator' and w.state='retryable' and public.booking_notification_is_deliverable(w),false))) order by e.created_at,e.id),'[]') from public.booking_notification_events e left join public.booking_confirmation_notification_work w on w.event_id=e.id where e.booking_request_id=request.id and e.event_kind in ('cancelled','refund_requested','refund_returned','refund_attention','preparation_reminder') and (target_actor_role='platform_administrator' or (e.recipient_user_id=(select auth.uid()) and e.recipient_role=target_actor_role))));
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

CREATE FUNCTION public.guard_booking_request_notification_source()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if new.receipt_id is null and public.booking_request_notification_source_valid(new) is not true then raise exception 'Request notification source is invalid' using errcode='RC409'; end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.guard_booking_request_notification_source() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.lease_booking_confirmation_notification_work (
  target_receipt_id uuid,
  target_event_id   uuid DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.notification_id=coalesce(target_event_id,target_receipt_id) for update of requests;
  select * into w from public.booking_confirmation_notification_work where notification_id=coalesce(target_event_id,target_receipt_id) for update;
  if w.notification_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id
    or not (w.state in ('pending','uncertain') or (w.state='processing' and w.lease_expires_at<=clock_timestamp()) or (w.state='retryable' and not public.booking_notification_is_deliverable(w)))
    or exists(select 1 from public.booking_notification_events event where event.id=w.event_id and event.event_kind='preparation_reminder' and event.due_at>clock_timestamp())
    then return null; end if;
  update public.booking_confirmation_notification_work set state='processing',lease_generation=lease_generation+1,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where notification_id=w.notification_id returning * into w;
  return public.booking_confirmation_notification_binding(w)||jsonb_build_object('leaseGeneration',w.lease_generation,'leaseToken',w.lease_token,'leaseExpiresAt',w.lease_expires_at);
end $function$;

CREATE FUNCTION public.list_booking_request_notification_status (
  target_reference  text,
  target_actor_role text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare context public.account_contexts; declare actor uuid:=(select auth.uid());
begin
  select * into q from public.booking_requests where booking_request_reference=target_reference;
  select * into context from public.account_contexts where user_id=actor;
  if q.id is null or actor is null or context.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null)
    or target_actor_role is null or target_actor_role not in ('customer','cottage_owner')
    or not ((target_actor_role='customer' and context.role in ('customer','cottage_owner') and q.customer_user_id=actor)
      or (target_actor_role='cottage_owner' and context.role='cottage_owner' and context.owner_approval_state='approved' and q.owner_user_id=actor))
    then raise exception 'Request notification status unavailable' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(public.get_booking_confirmation_notification_status(null,e.id)||jsonb_build_object('kind',e.event_kind,'createdAt',e.created_at,'retryAllowed',coalesce(w.state='retryable' and public.booking_notification_is_deliverable(w),false)) order by e.created_at,e.id),'[]'::jsonb)
    from public.booking_notification_events e left join public.booking_confirmation_notification_work w on w.event_id=e.id
    where e.booking_request_id=q.id and e.receipt_id is null and e.recipient_user_id=actor and e.recipient_role=target_actor_role);
end $function$;

REVOKE ALL ON FUNCTION public.list_booking_request_notification_status(text, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_booking_request_notification_status(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_due_booking_confirmation_notifications (
  target_limit integer DEFAULT 50
)
  RETURNS SETOF jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  if target_limit is null or target_limit not between 1 and 100 then raise exception 'Invalid notification limit' using errcode='22023'; end if;
  return query select source.candidate from (
    select r.id notification_id,r.created_at,public.booking_request_payment_status(q)='paid-confirmed' eligible,true due,
      jsonb_build_object('receiptId',r.id,'recipientUserId',r.recipient_user_id,'recipientRole',r.recipient_role,'bookingRequestReference',q.booking_request_reference,'bookingReference',c.commitment_reference,'locale',s.acceptance_locale) candidate
    from public.booking_receipts r join public.booking_confirmations x on x.id=r.booking_confirmation_id join public.booking_requests q on q.id=x.booking_request_id
      join public.booking_snapshots s on s.id=r.booking_snapshot_id join public.cottage_booking_period_commitments c on c.id=x.booking_period_commitment_id
    union all
    select event.id,event.created_at,true,event.event_kind<>'preparation_reminder' or event.due_at<=clock_timestamp(),jsonb_build_object('receiptId',event.receipt_id,'recipientUserId',event.recipient_user_id,'recipientRole',event.recipient_role,'bookingRequestReference',q.booking_request_reference,'bookingReference',case when event.receipt_id is not null then c.commitment_reference end,'locale',event.notice_locale,'event',public.booking_notification_event_binding(event.id))
    from public.booking_notification_events event join public.booking_requests q on q.id=event.booking_request_id join public.cottage_booking_period_commitments c on c.id=q.booking_period_commitment_id
  ) source left join public.booking_confirmation_notification_work w on w.notification_id=source.notification_id
  where source.due and ((w.notification_id is null and source.eligible) or w.state in ('pending','uncertain') or (w.state='processing' and w.lease_expires_at<=clock_timestamp()) or (w.state='retryable' and not public.booking_notification_is_deliverable(w)))
  order by coalesce(w.updated_at,source.created_at),source.notification_id limit target_limit;
end $function$;

CREATE FUNCTION public.observe_booking_request_notification_source()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if tg_table_name<>'booking_request_payment_history' then
    perform public.ensure_booking_request_notification_events(new.booking_request_id);
  elsif (new.source='recovery-attempt' and new.to_state in ('admitted','original_released','safely_failed')) or (new.source='expiry-work' and new.to_state='quarantined') then
    perform public.ensure_booking_request_notification_events(new.booking_request_id);
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.observe_booking_request_notification_source() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.query_fictional_booking_confirmation_notification_effect (
  target_receipt_id uuid,
  target_generation bigint,
  target_token      uuid,
  target_binding    jsonb,
  target_event_id   uuid   DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare e public.fictional_booking_confirmation_notification_effects;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.notification_id=coalesce(target_event_id,target_receipt_id) for update of requests;
  select * into w from public.booking_confirmation_notification_work where notification_id=coalesce(target_event_id,target_receipt_id) for update;
  select * into e from public.fictional_booking_confirmation_notification_effects where notification_id=coalesce(target_event_id,target_receipt_id) for update;
  if w.notification_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() or public.booking_confirmation_notification_binding(w) is distinct from target_binding then return jsonb_build_object('status','stale'); end if;
  if e.id is null then insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome) values(w.receipt_id,w.event_id,target_generation,target_token,'query','not-found'); return jsonb_build_object('status','not-found'); end if;
  if (e.logical_id,e.booking_request_id,e.booking_request_reference,e.booking_reference,e.recipient_user_id,e.recipient_role,e.notice_locale,e.template_version,e.payload,e.payload_sha256) is distinct from (w.logical_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256) then raise exception 'Notification effect binding conflict' using errcode='RC409'; end if;
  insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome,effect_id) values(w.receipt_id,w.event_id,target_generation,target_token,'query','delivered',e.id);
  return jsonb_build_object('status','found','effectId',e.id,'supplierDeliveryReference',e.supplier_delivery_reference,'executedAt',e.executed_at);
end $function$;

CREATE OR REPLACE FUNCTION public.record_booking_confirmation_notification_failure (
  target_receipt_id uuid,
  target_generation bigint,
  target_token      uuid,
  target_outcome    text,
  target_event_id   uuid   DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work;
begin
  if current_setting('role',true)<>'service_role' or target_outcome not in ('failed','unknown') then raise exception 'Invalid notification failure' using errcode='42501'; end if;
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.notification_id=coalesce(target_event_id,target_receipt_id) for update of requests;
  select * into w from public.booking_confirmation_notification_work where notification_id=coalesce(target_event_id,target_receipt_id) for update;
  if w.notification_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() then return jsonb_build_object('status','stale'); end if;
  if target_outcome='failed' and exists(select 1 from public.fictional_booking_confirmation_notification_effects where notification_id=w.notification_id) then raise exception 'Delivered effect cannot be failed' using errcode='RC409'; end if;
  update public.booking_confirmation_notification_work set state=case target_outcome when 'failed' then 'retryable' else 'uncertain' end,lease_token=null,lease_expires_at=null,last_outcome=target_outcome,updated_at=clock_timestamp() where notification_id=w.notification_id;
  insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome) values(w.receipt_id,w.event_id,target_generation,target_token,'failure',target_outcome);
  return jsonb_build_object('status',case target_outcome when 'failed' then 'retryable' else 'uncertain' end);
end $function$;

CREATE OR REPLACE FUNCTION public.retry_booking_confirmation_notification (
  target_receipt_id uuid,
  target_event_id   uuid DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare role public.account_contexts; declare actor uuid:=(select auth.uid());
begin
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.notification_id=coalesce(target_event_id,target_receipt_id) for update of requests;
  select * into w from public.booking_confirmation_notification_work where notification_id=coalesce(target_event_id,target_receipt_id) for update;
  select * into role from public.account_contexts where user_id=actor;
  if actor is null or role.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null) or w.notification_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id or w.recipient_user_id is distinct from actor or not ((w.recipient_role='customer' and role.role in ('customer','cottage_owner') and q.customer_user_id=actor) or (w.recipient_role='cottage_owner' and role.role='cottage_owner' and role.owner_approval_state='approved' and q.owner_user_id=actor)) or w.state is distinct from 'retryable' or not public.booking_notification_is_deliverable(w) then raise exception 'Notification retry unavailable' using errcode='42501'; end if;
  update public.booking_confirmation_notification_work set state='pending',last_outcome=null,updated_at=clock_timestamp() where notification_id=w.notification_id;
  insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,action,outcome) values(w.receipt_id,w.event_id,'user-retry','queued');
  return jsonb_build_object('status','queued');
end $function$;

ALTER TABLE public.booking_confirmation_notification_attempts
  ALTER COLUMN receipt_id DROP NOT NULL;

ALTER TABLE public.booking_confirmation_notification_work
  ALTER COLUMN booking_reference DROP NOT NULL;

ALTER TABLE public.booking_confirmation_notification_work
  ALTER COLUMN receipt_id DROP NOT NULL;

ALTER TABLE public.booking_notification_events
  ALTER COLUMN receipt_id DROP NOT NULL;

ALTER TABLE public.fictional_booking_confirmation_notification_effects
  ALTER COLUMN booking_reference DROP NOT NULL;

ALTER TABLE public.fictional_booking_confirmation_notification_effects
  ALTER COLUMN receipt_id DROP NOT NULL;

ALTER TABLE public.booking_confirmation_notification_work
  ADD CONSTRAINT booking_confirmation_notification_work_source_shape CHECK (receipt_id IS NOT NULL AND booking_reference IS NOT NULL OR receipt_id IS NULL AND event_id IS
    NOT NULL AND booking_reference IS NULL AND
    ((payload ->> 'kind'::text) = ANY (ARRAY['request_new'::text, 'request_accepted'::text, 'request_payment_required'::text, 'request_declined'::text, 'request_withdrawn'::text,
    'request_expired'::text, 'recovery_processing'::text, 'recovery_retryable'::text, 'recovery_attention'::text])));

ALTER TABLE public.booking_confirmation_notification_work
  ADD CONSTRAINT booking_confirmation_notification_work_payload
    CHECK
    (jsonb_typeof(payload) = 'object'::text AND payload ?& ARRAY['kind'::text, 'title'::text, 'body'::text, 'bookingReference'::text, 'detailsPath'::text, 'linkLabel'::text,
    'fictional'::text] AND (payload -> 'fictional'::text) = 'true'::jsonb AND (receipt_id IS NULL AND event_id IS
    NOT NULL AND
    ((payload ->> 'kind'::text) = ANY (ARRAY['request_new'::text, 'request_accepted'::text, 'request_payment_required'::text, 'request_declined'::text, 'request_withdrawn'::text,
    'request_expired'::text,
    'recovery_processing'::text,
    'recovery_retryable'::text,
    'recovery_attention'::text])) AND (payload -> 'bookingReference'::text) = 'null'::jsonb AND payload ?& ARRAY['bookingRequestReference'::text,
    'deadlineAt'::text] AND
    (payload - ARRAY['kind'::text, 'title'::text, 'body'::text, 'bookingReference'::text, 'bookingRequestReference'::text, 'deadlineAt'::text, 'detailsPath'::text,
    'linkLabel'::text,
    'fictional'::text]) = '{}'::jsonb OR event_id IS NULL AND (payload ->> 'kind'::text) = 'paid-confirmation'::text AND
    (payload - ARRAY['kind'::text, 'title'::text, 'body'::text, 'bookingReference'::text, 'detailsPath'::text, 'linkLabel'::text, 'fictional'::text]) = '{}'::jsonb OR event_id IS
    NOT NULL AND ((payload ->> 'kind'::text) = ANY (ARRAY['cancelled'::text, 'refund_requested'::text, 'refund_returned'::text, 'refund_attention'::text])) AND payload ?
    'allocation'::text AND
    (payload - ARRAY['kind'::text, 'title'::text, 'body'::text, 'bookingReference'::text, 'detailsPath'::text, 'linkLabel'::text, 'fictional'::text, 'allocation'::text]) =
    '{}'::jsonb OR event_id IS NOT NULL AND (payload ->> 'kind'::text) = 'preparation_reminder'::text AND payload ?& ARRAY['dueAt'::text,
    'firstStartsAt'::text] AND
    (payload - ARRAY['kind'::text, 'title'::text, 'body'::text, 'bookingReference'::text, 'detailsPath'::text, 'linkLabel'::text, 'fictional'::text, 'dueAt'::text,
    'firstStartsAt'::text]) = '{}'::jsonb));

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_event_kind_check
    CHECK
    (event_kind = ANY (ARRAY['cancelled'::text, 'refund_requested'::text, 'refund_returned'::text, 'refund_attention'::text, 'preparation_reminder'::text, 'request_new'::text,
    'request_accepted'::text,
    'request_payment_required'::text,
    'request_declined'::text, 'request_withdrawn'::text, 'request_expired'::text, 'recovery_processing'::text, 'recovery_retryable'::text, 'recovery_attention'::text]));

ALTER TABLE public.booking_notification_events
  ADD COLUMN owner_request_notification_id uuid;

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_owner_source_fkey FOREIGN KEY (owner_request_notification_id) REFERENCES public.owner_request_notifications(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_notification_events
  ADD COLUMN request_status_notification_id uuid;

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_status_source_fkey FOREIGN KEY (request_status_notification_id) REFERENCES public.booking_request_status_notifications(id)
    ON DELETE RESTRICT;

ALTER TABLE public.booking_notification_events
  ADD COLUMN payment_history_id uuid;

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_history_source_fkey FOREIGN KEY (payment_history_id) REFERENCES public.booking_request_payment_history(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_notification_events
  ADD COLUMN recovery_generation bigint;

ALTER TABLE public.booking_notification_events
  ADD COLUMN deadline_at timestamp with time zone;

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_source_shape CHECK (receipt_id IS
    NOT NULL AND owner_request_notification_id IS NULL AND request_status_notification_id IS NULL AND payment_history_id IS NULL AND recovery_generation IS NULL AND deadline_at IS
    NULL AND (event_kind = 'cancelled'::text AND cancellation_id IS
    NOT NULL AND refund_intent_id IS NULL AND due_at IS NULL AND first_starts_at IS NULL OR
    (event_kind = ANY (ARRAY['refund_requested'::text, 'refund_returned'::text, 'refund_attention'::text])) AND cancellation_id IS NULL AND refund_intent_id IS
    NOT NULL AND due_at IS NULL AND first_starts_at IS NULL OR event_kind = 'preparation_reminder'::text AND cancellation_id IS NULL AND refund_intent_id IS NULL AND
    first_starts_at IS NOT NULL AND due_at IS
    NOT NULL AND due_at = (first_starts_at - '24:00:00'::interval)) OR receipt_id IS NULL AND cancellation_id IS NULL AND refund_intent_id IS NULL AND due_at IS NULL AND
    first_starts_at IS NULL AND (event_kind = 'request_new'::text AND owner_request_notification_id IS
    NOT NULL AND request_status_notification_id IS NULL AND payment_history_id IS NULL AND recovery_generation IS NULL AND recipient_role = 'cottage_owner'::text AND deadline_at IS
    NOT NULL OR (event_kind = ANY (ARRAY['request_accepted'::text, 'request_payment_required'::text, 'request_declined'::text, 'request_withdrawn'::text, 'request_expired'::text]))
    AND owner_request_notification_id IS NULL AND request_status_notification_id IS
    NOT NULL AND payment_history_id IS NULL AND recovery_generation IS NULL AND
    (event_kind = 'request_payment_required'::text AND recipient_role = 'customer'::text AND deadline_at IS
    NOT NULL OR event_kind <> 'request_payment_required'::text AND deadline_at IS NULL) OR
    (event_kind = ANY (ARRAY['recovery_processing'::text, 'recovery_retryable'::text, 'recovery_attention'::text])) AND owner_request_notification_id IS NULL AND
    request_status_notification_id IS NULL AND payment_history_id IS NOT NULL AND recovery_generation IS
    NOT NULL AND recovery_generation > 0 AND recipient_role = 'customer'::text AND deadline_at IS NOT NULL));

CREATE UNIQUE INDEX booking_notification_events_owner_source_idx ON public.booking_notification_events (owner_request_notification_id)
  WHERE owner_request_notification_id IS NOT NULL;

CREATE UNIQUE INDEX booking_notification_events_status_source_idx ON public.booking_notification_events (request_status_notification_id)
  WHERE request_status_notification_id IS NOT NULL;

CREATE UNIQUE INDEX booking_notification_events_recovery_source_idx ON public.booking_notification_events (booking_request_id, recovery_generation, event_kind, recipient_role)
  WHERE payment_history_id IS NOT NULL;

CREATE TRIGGER guard_booking_request_notification_source
  BEFORE INSERT ON public.booking_notification_events
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_booking_request_notification_source();

CREATE TRIGGER observe_request_notification_recovery
  AFTER INSERT ON public.booking_request_payment_history
  FOR EACH ROW
  EXECUTE FUNCTION public.observe_booking_request_notification_source();

CREATE TRIGGER observe_request_notification_status
  AFTER INSERT ON public.booking_request_status_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.observe_booking_request_notification_source();

ALTER TABLE public.fictional_booking_confirmation_notification_effects
  ADD CONSTRAINT fictional_booking_confirmation_notification_effects_source_shap CHECK (receipt_id IS NOT NULL AND booking_reference IS
    NOT NULL OR receipt_id IS NULL AND event_id IS
    NOT NULL AND booking_reference IS NULL AND
    ((payload ->> 'kind'::text) = ANY (ARRAY['request_new'::text, 'request_accepted'::text, 'request_payment_required'::text, 'request_declined'::text, 'request_withdrawn'::text,
    'request_expired'::text, 'recovery_processing'::text, 'recovery_retryable'::text, 'recovery_attention'::text])));

CREATE TRIGGER observe_request_notification_new
  AFTER INSERT ON public.owner_request_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.observe_booking_request_notification_source();
-- Data backfill is not represented by declaration diffs. Preserve this statement
-- whenever regenerating the migration: stale sources remain intents until the
-- existing dispatcher suppresses them; recorded recovery history is not invented.
SELECT public.ensure_booking_request_notification_events(id)
FROM public.booking_requests;
