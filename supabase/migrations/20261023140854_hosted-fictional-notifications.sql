-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

ALTER TABLE public.fictional_booking_confirmation_notification_effects
  DROP CONSTRAINT fictional_booking_confirmation_notification_effect_identity;

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
declare base_binding jsonb; declare effect_environment text := 'local-test'; declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare e public.fictional_booking_confirmation_notification_effects;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  if jsonb_typeof(target_binding) is distinct from 'object' then return jsonb_build_object('status','stale'); end if;
  if target_binding ? 'fictionalEnvironment' then
    if jsonb_typeof(target_binding->'fictionalEnvironment') is distinct from 'string'
      or target_binding->>'fictionalEnvironment' not in ('local-test','hosted-demo-yvibcyqtyihpzpmomnzg') then return jsonb_build_object('status','stale'); end if;
    effect_environment := target_binding->>'fictionalEnvironment';
  end if;
  base_binding := target_binding-'fictionalEnvironment';
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.notification_id=coalesce(target_event_id,target_receipt_id) for update of requests;
  select * into w from public.booking_confirmation_notification_work where notification_id=coalesce(target_event_id,target_receipt_id) for update;
  select * into e from public.fictional_booking_confirmation_notification_effects where id=target_effect_id and notification_id=coalesce(target_event_id,target_receipt_id) for update;
  if e.environment is distinct from effect_environment or w.notification_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id or e.id is null or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() or public.booking_confirmation_notification_binding(w) is distinct from base_binding
    or (e.logical_id,e.booking_request_id,e.booking_request_reference,e.booking_reference,e.recipient_user_id,e.recipient_role,e.notice_locale,e.template_version,e.payload,e.payload_sha256) is distinct from (w.logical_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256)
    then return jsonb_build_object('status','stale'); end if;
  update public.booking_confirmation_notification_work set state='delivered',lease_token=null,lease_expires_at=null,last_outcome='delivered',supplier_delivery_reference=e.supplier_delivery_reference,delivered_at=e.executed_at,updated_at=clock_timestamp() where notification_id=w.notification_id;
  insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome,effect_id) values(w.receipt_id,w.event_id,target_generation,target_token,'complete','delivered',e.id);
  return jsonb_build_object('status','delivered','historical',not public.booking_notification_is_deliverable(w));
end $function$;

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
declare base_binding jsonb; declare effect_environment text := 'local-test'; declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare e public.fictional_booking_confirmation_notification_effects; declare recipient uuid; declare actor auth.users; declare context public.account_contexts;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  if jsonb_typeof(target_binding) is distinct from 'object' then return jsonb_build_object('status','stale'); end if;
  if target_binding ? 'fictionalEnvironment' then
    if jsonb_typeof(target_binding->'fictionalEnvironment') is distinct from 'string'
      or target_binding->>'fictionalEnvironment' not in ('local-test','hosted-demo-yvibcyqtyihpzpmomnzg') then return jsonb_build_object('status','stale'); end if;
    effect_environment := target_binding->>'fictionalEnvironment';
  end if;
  base_binding := target_binding-'fictionalEnvironment';
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.notification_id=coalesce(target_event_id,target_receipt_id) for update of requests;
  select work.recipient_user_id into recipient from public.booking_confirmation_notification_work work where work.notification_id=coalesce(target_event_id,target_receipt_id);
  select * into actor from auth.users where id=recipient for share;
  select * into context from public.account_contexts where user_id=recipient for share;
  select * into w from public.booking_confirmation_notification_work where notification_id=coalesce(target_event_id,target_receipt_id) for update;
  select * into e from public.fictional_booking_confirmation_notification_effects where notification_id=coalesce(target_event_id,target_receipt_id) for update;
  if w.notification_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() or public.booking_confirmation_notification_binding(w) is distinct from base_binding then return jsonb_build_object('status','stale'); end if;
  if e.id is not null and e.environment is distinct from effect_environment then return jsonb_build_object('status','stale'); end if;
  if e.id is not null then return jsonb_build_object('status','delivered','effectId',e.id,'supplierDeliveryReference',e.supplier_delivery_reference,'executedAt',e.executed_at); end if;
  if not public.booking_notification_is_deliverable(w) then
    update public.booking_confirmation_notification_work set state='suppressed',lease_token=null,lease_expires_at=null,last_outcome='suppressed',suppressed_at=clock_timestamp(),updated_at=clock_timestamp() where notification_id=w.notification_id;
    insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome) values(w.receipt_id,w.event_id,target_generation,target_token,'execute','suppressed'); return jsonb_build_object('status','suppressed');
  end if;
  insert into public.fictional_booking_confirmation_notification_effects(supplier,environment,logical_id,receipt_id,event_id,booking_request_id,booking_request_reference,booking_reference,recipient_user_id,recipient_role,notice_locale,template_version,payload,payload_sha256,execution_lease_generation,execution_lease_token,supplier_delivery_reference)
    values('fictional-notifications',effect_environment,w.logical_id,w.receipt_id,w.event_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256,target_generation,target_token,case when w.event_id is null then 'fictional-confirmation-'||w.receipt_id else 'fictional-booking-event-'||w.event_id end) returning * into e;
  insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome,effect_id) values(w.receipt_id,w.event_id,target_generation,target_token,'execute','delivered',e.id);
  return jsonb_build_object('status','delivered','effectId',e.id,'supplierDeliveryReference',e.supplier_delivery_reference,'executedAt',e.executed_at);
end $function$;

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
declare base_binding jsonb; declare effect_environment text := 'local-test'; declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare e public.fictional_booking_confirmation_notification_effects;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  if jsonb_typeof(target_binding) is distinct from 'object' then return jsonb_build_object('status','stale'); end if;
  if target_binding ? 'fictionalEnvironment' then
    if jsonb_typeof(target_binding->'fictionalEnvironment') is distinct from 'string'
      or target_binding->>'fictionalEnvironment' not in ('local-test','hosted-demo-yvibcyqtyihpzpmomnzg') then return jsonb_build_object('status','stale'); end if;
    effect_environment := target_binding->>'fictionalEnvironment';
  end if;
  base_binding := target_binding-'fictionalEnvironment';
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.notification_id=coalesce(target_event_id,target_receipt_id) for update of requests;
  select * into w from public.booking_confirmation_notification_work where notification_id=coalesce(target_event_id,target_receipt_id) for update;
  select * into e from public.fictional_booking_confirmation_notification_effects where notification_id=coalesce(target_event_id,target_receipt_id) for update;
  if w.notification_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() or public.booking_confirmation_notification_binding(w) is distinct from base_binding then return jsonb_build_object('status','stale'); end if;
  if e.id is not null and e.environment is distinct from effect_environment then return jsonb_build_object('status','stale'); end if;
  if e.id is null then insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome) values(w.receipt_id,w.event_id,target_generation,target_token,'query','not-found'); return jsonb_build_object('status','not-found'); end if;
  if (e.logical_id,e.booking_request_id,e.booking_request_reference,e.booking_reference,e.recipient_user_id,e.recipient_role,e.notice_locale,e.template_version,e.payload,e.payload_sha256) is distinct from (w.logical_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256) then raise exception 'Notification effect binding conflict' using errcode='RC409'; end if;
  insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome,effect_id) values(w.receipt_id,w.event_id,target_generation,target_token,'query','delivered',e.id);
  return jsonb_build_object('status','found','effectId',e.id,'supplierDeliveryReference',e.supplier_delivery_reference,'executedAt',e.executed_at);
end $function$;

ALTER TABLE public.fictional_booking_confirmation_notification_effects
  ADD CONSTRAINT fictional_booking_confirmation_notification_effect_identity
    CHECK
    (supplier = 'fictional-notifications'::text AND (environment = ANY (ARRAY['local-test'::text, 'hosted-demo-yvibcyqtyihpzpmomnzg'::text])) AND (recipient_role = ANY
    (ARRAY['customer'::text, 'cottage_owner'::text])) AND payload_sha256 ~ '^[0-9a-f]{64}$'::text AND execution_lease_generation > 0 AND
    (event_id IS NULL AND logical_id = ('paid-confirmation:'::text || receipt_id) AND template_version = 'paid-confirmation-v1'::text OR event_id IS
    NOT NULL AND logical_id = ('booking-event:'::text || event_id) AND template_version = 'booking-event-v1'::text));