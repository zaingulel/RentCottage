alter table "public"."booking_confirmation_notification_attempts" drop constraint "booking_confirmation_notification_attempts_receipt_id_fkey";

alter table "public"."booking_confirmation_notification_work" drop constraint "booking_confirmation_notification_work_binding";

alter table "public"."booking_confirmation_notification_work" drop constraint "booking_confirmation_notification_work_payload";

alter table "public"."fictional_booking_confirmation_notification_effects" drop constraint "fictional_booking_confirmation_notification_effect_identity";

alter table "public"."fictional_booking_confirmation_notification_effects" drop constraint "fictional_booking_confirmation_notification_effects_receipt_id_";

drop function if exists "public"."complete_booking_confirmation_notification_delivery"(target_receipt_id uuid, target_generation bigint, target_token uuid, target_binding jsonb, target_effect_id uuid);

drop function if exists "public"."ensure_booking_confirmation_notification_work"(target_receipt_id uuid, target_locale text, target_template text, target_payload jsonb);

drop function if exists "public"."execute_fictional_booking_confirmation_notification_effect"(target_receipt_id uuid, target_generation bigint, target_token uuid, target_binding jsonb);

drop function if exists "public"."get_booking_confirmation_notification_status"(target_receipt_id uuid);

drop function if exists "public"."lease_booking_confirmation_notification_work"(target_receipt_id uuid);

drop function if exists "public"."query_fictional_booking_confirmation_notification_effect"(target_receipt_id uuid, target_generation bigint, target_token uuid, target_binding jsonb);

drop function if exists "public"."record_booking_confirmation_notification_failure"(target_receipt_id uuid, target_generation bigint, target_token uuid, target_outcome text);

drop function if exists "public"."retry_booking_confirmation_notification"(target_receipt_id uuid);

alter table "public"."booking_confirmation_notification_work" drop constraint "booking_confirmation_notification_work_pkey";

drop index if exists "public"."booking_confirmation_notification_work_pkey";

alter table "public"."booking_confirmation_notification_attempts" add column "event_id" uuid;

alter table "public"."booking_confirmation_notification_attempts" add column "notification_id" uuid not null generated always as (COALESCE(event_id, receipt_id)) stored;

alter table "public"."booking_confirmation_notification_work" add column "event_id" uuid;

alter table "public"."booking_confirmation_notification_work" add column "notification_id" uuid not null generated always as (COALESCE(event_id, receipt_id)) stored;

alter table "public"."fictional_booking_confirmation_notification_effects" add column "event_id" uuid;

alter table "public"."fictional_booking_confirmation_notification_effects" add column "notification_id" uuid not null generated always as (COALESCE(event_id, receipt_id)) stored;

CREATE UNIQUE INDEX booking_confirmation_notification_work_pkey ON public.booking_confirmation_notification_work USING btree (notification_id);

alter table "public"."booking_confirmation_notification_work" add constraint "booking_confirmation_notification_work_pkey" PRIMARY KEY using index "booking_confirmation_notification_work_pkey";

alter table "public"."booking_confirmation_notification_attempts" add constraint "booking_confirmation_notification_attempts_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.booking_notification_events(id) ON DELETE RESTRICT not valid;

alter table "public"."booking_confirmation_notification_attempts" validate constraint "booking_confirmation_notification_attempts_event_id_fkey";

alter table "public"."booking_confirmation_notification_work" add constraint "booking_confirmation_notification_work_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.booking_notification_events(id) ON DELETE RESTRICT not valid;

alter table "public"."booking_confirmation_notification_work" validate constraint "booking_confirmation_notification_work_event_id_fkey";

alter table "public"."fictional_booking_confirmation_notification_effects" add constraint "fictional_booking_confirmation_notification_effects_event_id_fk" FOREIGN KEY (event_id) REFERENCES public.booking_notification_events(id) ON DELETE RESTRICT not valid;

alter table "public"."fictional_booking_confirmation_notification_effects" validate constraint "fictional_booking_confirmation_notification_effects_event_id_fk";

alter table "public"."booking_confirmation_notification_attempts" add constraint "booking_confirmation_notification_attempts_receipt_id_fkey" FOREIGN KEY (notification_id) REFERENCES public.booking_confirmation_notification_work(notification_id) ON DELETE RESTRICT not valid;

alter table "public"."booking_confirmation_notification_attempts" validate constraint "booking_confirmation_notification_attempts_receipt_id_fkey";

alter table "public"."booking_confirmation_notification_work" add constraint "booking_confirmation_notification_work_binding" CHECK (((recipient_role = ANY (ARRAY['customer'::text, 'cottage_owner'::text])) AND (payload_sha256 ~ '^[0-9a-f]{64}$'::text) AND (((event_id IS NULL) AND (logical_id = ('paid-confirmation:'::text || receipt_id)) AND (template_version = 'paid-confirmation-v1'::text)) OR ((event_id IS NOT NULL) AND (logical_id = ('booking-event:'::text || event_id)) AND (template_version = 'booking-event-v1'::text))))) not valid;

alter table "public"."booking_confirmation_notification_work" validate constraint "booking_confirmation_notification_work_binding";

alter table "public"."booking_confirmation_notification_work" add constraint "booking_confirmation_notification_work_payload" CHECK (((jsonb_typeof(payload) = 'object'::text) AND (payload ?& ARRAY['kind'::text, 'title'::text, 'body'::text, 'bookingReference'::text, 'detailsPath'::text, 'linkLabel'::text, 'fictional'::text]) AND ((payload -> 'fictional'::text) = 'true'::jsonb) AND (((event_id IS NULL) AND ((payload ->> 'kind'::text) = 'paid-confirmation'::text) AND ((payload - ARRAY['kind'::text, 'title'::text, 'body'::text, 'bookingReference'::text, 'detailsPath'::text, 'linkLabel'::text, 'fictional'::text]) = '{}'::jsonb)) OR ((event_id IS NOT NULL) AND ((payload ->> 'kind'::text) = ANY (ARRAY['cancelled'::text, 'refund_requested'::text, 'refund_returned'::text, 'refund_attention'::text])) AND (payload ? 'allocation'::text) AND ((payload - ARRAY['kind'::text, 'title'::text, 'body'::text, 'bookingReference'::text, 'detailsPath'::text, 'linkLabel'::text, 'fictional'::text, 'allocation'::text]) = '{}'::jsonb))))) not valid;

alter table "public"."booking_confirmation_notification_work" validate constraint "booking_confirmation_notification_work_payload";

alter table "public"."fictional_booking_confirmation_notification_effects" add constraint "fictional_booking_confirmation_notification_effect_identity" CHECK (((supplier = 'fictional-notifications'::text) AND (environment = 'local-test'::text) AND (recipient_role = ANY (ARRAY['customer'::text, 'cottage_owner'::text])) AND (payload_sha256 ~ '^[0-9a-f]{64}$'::text) AND (execution_lease_generation > 0) AND (((event_id IS NULL) AND (logical_id = ('paid-confirmation:'::text || receipt_id)) AND (template_version = 'paid-confirmation-v1'::text)) OR ((event_id IS NOT NULL) AND (logical_id = ('booking-event:'::text || event_id)) AND (template_version = 'booking-event-v1'::text))))) not valid;

alter table "public"."fictional_booking_confirmation_notification_effects" validate constraint "fictional_booking_confirmation_notification_effect_identity";

alter table "public"."fictional_booking_confirmation_notification_effects" add constraint "fictional_booking_confirmation_notification_effects_receipt_id_" FOREIGN KEY (notification_id) REFERENCES public.booking_confirmation_notification_work(notification_id) ON DELETE RESTRICT not valid;

alter table "public"."fictional_booking_confirmation_notification_effects" validate constraint "fictional_booking_confirmation_notification_effects_receipt_id_";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.booking_notification_event_binding(target_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object('id',event.id,'kind',event.event_kind,'allocation',jsonb_build_object(
    'bookingPriceFils',coalesce(cancelled.refund_booking_price_fils,intent.booking_price_fils),
    'bookingServiceFeeFils',coalesce(cancelled.refund_booking_service_fee_fils,intent.booking_service_fee_fils)))
  from public.booking_notification_events event left join public.booking_cancellations cancelled on cancelled.id=event.cancellation_id
    left join public.booking_refund_intents intent on intent.id=event.refund_intent_id where event.id=target_event_id;
$function$
;

CREATE OR REPLACE FUNCTION public.booking_notification_is_deliverable(target public.booking_confirmation_notification_work)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case when target.event_id is null then public.booking_request_payment_status(request)='paid-confirmed'
    else exists(select 1 from public.booking_notification_events event join public.booking_receipts receipt on receipt.id=event.receipt_id
      join public.account_contexts context on context.user_id=event.recipient_user_id join auth.users actor on actor.id=context.user_id
      where event.id=target.event_id and event.booking_request_id=request.id and event.receipt_id=target.receipt_id
        and event.recipient_user_id=target.recipient_user_id and event.recipient_role=target.recipient_role and event.notice_locale=target.notice_locale
        and receipt.recipient_user_id=target.recipient_user_id and receipt.recipient_role=target.recipient_role and actor.phone_confirmed_at is not null
        and ((event.recipient_role='customer' and request.customer_user_id=actor.id and context.role in ('customer','cottage_owner'))
          or (event.recipient_role='cottage_owner' and request.owner_user_id=actor.id and context.role='cottage_owner' and context.owner_approval_state='approved')))
    end from public.booking_requests request where request.id=target.booking_request_id;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_booking_confirmation_notification_delivery(target_receipt_id uuid, target_generation bigint, target_token uuid, target_binding jsonb, target_effect_id uuid, target_event_id uuid DEFAULT NULL::uuid)
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
  if w.receipt_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id or e.id is null or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() or public.booking_confirmation_notification_binding(w) is distinct from target_binding
    or (e.logical_id,e.booking_request_id,e.booking_request_reference,e.booking_reference,e.recipient_user_id,e.recipient_role,e.notice_locale,e.template_version,e.payload,e.payload_sha256) is distinct from (w.logical_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256)
    then return jsonb_build_object('status','stale'); end if;
  update public.booking_confirmation_notification_work set state='delivered',lease_token=null,lease_expires_at=null,last_outcome='delivered',supplier_delivery_reference=e.supplier_delivery_reference,delivered_at=e.executed_at,updated_at=clock_timestamp() where notification_id=w.notification_id;
  insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome,effect_id) values(w.receipt_id,w.event_id,target_generation,target_token,'complete','delivered',e.id);
  return jsonb_build_object('status','delivered','historical',not public.booking_notification_is_deliverable(w));
end $function$
;

CREATE OR REPLACE FUNCTION public.ensure_booking_confirmation_notification_work(target_receipt_id uuid, target_locale text, target_template text, target_payload jsonb, target_event_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q public.booking_requests; declare r public.booking_receipts; declare s public.booking_snapshots; declare c public.cottage_booking_period_commitments; declare w public.booking_confirmation_notification_work; declare event public.booking_notification_events; declare target_hash text; declare expected_binding jsonb; declare event_binding jsonb; declare logical_id text;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  select * into r from public.booking_receipts where id=target_receipt_id;
  if r.id is null then raise exception 'Unknown booking receipt' using errcode='RC404'; end if;
  select * into s from public.booking_snapshots where id=r.booking_snapshot_id;
  select commitments.* into c from public.cottage_booking_period_commitments commitments join public.booking_confirmations confirmations on confirmations.booking_period_commitment_id=commitments.id where confirmations.id=r.booking_confirmation_id;
  select * into q from public.booking_requests where id=(select booking_request_id from public.booking_confirmations where id=r.booking_confirmation_id) for update;
  if target_event_id is not null then
    select * into event from public.booking_notification_events where id=target_event_id;
    if event.id is null or (event.booking_request_id,event.receipt_id,event.recipient_user_id,event.recipient_role,event.notice_locale) is distinct from (q.id,r.id,r.recipient_user_id,r.recipient_role,s.acceptance_locale) then raise exception 'Notification event source is invalid' using errcode='RC409'; end if;
    event_binding:=public.booking_notification_event_binding(event.id);
  end if;
  select * into w from public.booking_confirmation_notification_work where notification_id=coalesce(target_event_id,r.id) for update;
  target_hash:=encode(extensions.digest(convert_to(target_payload::text,'UTF8'),'sha256'),'hex');
  logical_id:=case when target_event_id is null then 'paid-confirmation:'||r.id else 'booking-event:'||target_event_id end;
  expected_binding:=jsonb_build_object('receiptId',r.id,'recipientUserId',r.recipient_user_id,'recipientRole',r.recipient_role,'bookingRequestReference',q.booking_request_reference,'bookingReference',c.commitment_reference,'locale',target_locale,'logicalId',logical_id,'templateVersion',target_template,'payload',target_payload,'payloadSha256',target_hash)||case when target_event_id is null then '{}'::jsonb else jsonb_build_object('event',event_binding) end;
  if w.receipt_id is not null then
    if public.booking_confirmation_notification_binding(w) is distinct from expected_binding then raise exception 'Notification binding is immutable' using errcode='RC409'; end if; return;
  end if;
  if (target_event_id is null and public.booking_request_payment_status(q) is distinct from 'paid-confirmed')
    or target_locale is distinct from s.acceptance_locale::text
    or target_template is distinct from (case when target_event_id is null then 'paid-confirmation-v1' else 'booking-event-v1' end)
    or target_payload->>'kind' is distinct from (case when target_event_id is null then 'paid-confirmation' else event.event_kind end)
    or (target_event_id is not null and target_payload->'allocation' is distinct from event_binding->'allocation')
    or target_payload->>'bookingReference' is distinct from c.commitment_reference
    or target_payload->>'detailsPath' is distinct from ('/'||target_locale||'/'||case when r.recipient_role='customer' then 'booking-requests/' else 'owner/booking-requests/' end||q.booking_request_reference)
    then raise exception 'Invalid booking notification binding' using errcode='RC409'; end if;
  insert into public.booking_confirmation_notification_work(receipt_id,event_id,booking_request_id,booking_request_reference,booking_reference,recipient_user_id,recipient_role,logical_id,notice_locale,template_version,payload,payload_sha256)
    values(r.id,target_event_id,q.id,q.booking_request_reference,c.commitment_reference,r.recipient_user_id,r.recipient_role,logical_id,target_locale::public.cottage_profile_source_language,target_template,target_payload,target_hash);
end $function$
;

CREATE OR REPLACE FUNCTION public.execute_fictional_booking_confirmation_notification_effect(target_receipt_id uuid, target_generation bigint, target_token uuid, target_binding jsonb, target_event_id uuid DEFAULT NULL::uuid)
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
  if w.receipt_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() or public.booking_confirmation_notification_binding(w) is distinct from target_binding then return jsonb_build_object('status','stale'); end if;
  if e.id is not null then return jsonb_build_object('status','delivered','effectId',e.id,'supplierDeliveryReference',e.supplier_delivery_reference,'executedAt',e.executed_at); end if;
  if not public.booking_notification_is_deliverable(w) then
    update public.booking_confirmation_notification_work set state='suppressed',lease_token=null,lease_expires_at=null,last_outcome='suppressed',suppressed_at=clock_timestamp(),updated_at=clock_timestamp() where notification_id=w.notification_id;
    insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome) values(w.receipt_id,w.event_id,target_generation,target_token,'execute','suppressed'); return jsonb_build_object('status','suppressed');
  end if;
  insert into public.fictional_booking_confirmation_notification_effects(supplier,environment,logical_id,receipt_id,event_id,booking_request_id,booking_request_reference,booking_reference,recipient_user_id,recipient_role,notice_locale,template_version,payload,payload_sha256,execution_lease_generation,execution_lease_token,supplier_delivery_reference)
    values('fictional-notifications','local-test',w.logical_id,w.receipt_id,w.event_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256,target_generation,target_token,case when w.event_id is null then 'fictional-confirmation-'||w.receipt_id else 'fictional-booking-event-'||w.event_id end) returning * into e;
  insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome,effect_id) values(w.receipt_id,w.event_id,target_generation,target_token,'execute','delivered',e.id);
  return jsonb_build_object('status','delivered','effectId',e.id,'supplierDeliveryReference',e.supplier_delivery_reference,'executedAt',e.executed_at);
end $function$
;

CREATE OR REPLACE FUNCTION public.get_booking_confirmation_notification_status(target_receipt_id uuid, target_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare r public.booking_receipts; declare role public.account_contexts; declare actor uuid:=(select auth.uid());
begin
  select * into w from public.booking_confirmation_notification_work where notification_id=coalesce(target_event_id,target_receipt_id);
  select * into r from public.booking_receipts where id=target_receipt_id;
  select requests.* into q from public.booking_requests requests join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id where confirmations.id=r.booking_confirmation_id;
  select * into role from public.account_contexts where user_id=actor;
  if actor is null or role.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null) or r.id is null or (w.receipt_id is not null and w.receipt_id is distinct from target_receipt_id) or (target_event_id is not null and not exists(select 1 from public.booking_notification_events event where event.id=target_event_id and event.receipt_id=r.id)) or r.recipient_user_id is distinct from actor or not ((r.recipient_role='customer' and role.role in ('customer','cottage_owner') and q.customer_user_id=actor) or (r.recipient_role='cottage_owner' and role.role='cottage_owner' and role.owner_approval_state='approved' and q.owner_user_id=actor)) or (w.receipt_id is null and target_event_id is null and public.booking_request_payment_status(q) is distinct from 'paid-confirmed') then raise exception 'Notification status unavailable' using errcode='42501'; end if;
  if w.receipt_id is null then return jsonb_build_object('receiptId',r.id,'state','pending','lastOutcome',null,'supplierDeliveryReference',null,'deliveredAt',null,'suppressedAt',null,'historical',false)||case when target_event_id is null then '{}'::jsonb else jsonb_build_object('eventId',target_event_id) end; end if;
  return jsonb_build_object('receiptId',w.receipt_id,'state',w.state,'lastOutcome',w.last_outcome,'supplierDeliveryReference',w.supplier_delivery_reference,'deliveredAt',w.delivered_at,'suppressedAt',w.suppressed_at,'historical',w.state='delivered' and not public.booking_notification_is_deliverable(w))||case when w.event_id is null then '{}'::jsonb else jsonb_build_object('eventId',w.event_id) end;
end $function$
;

CREATE OR REPLACE FUNCTION public.lease_booking_confirmation_notification_work(target_receipt_id uuid, target_event_id uuid DEFAULT NULL::uuid)
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
  if w.receipt_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id or not (w.state in ('pending','uncertain') or (w.state='processing' and w.lease_expires_at<=clock_timestamp())) then return null; end if;
  update public.booking_confirmation_notification_work set state='processing',lease_generation=lease_generation+1,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where notification_id=w.notification_id returning * into w;
  return public.booking_confirmation_notification_binding(w)||jsonb_build_object('leaseGeneration',w.lease_generation,'leaseToken',w.lease_token,'leaseExpiresAt',w.lease_expires_at);
end $function$
;

CREATE OR REPLACE FUNCTION public.query_fictional_booking_confirmation_notification_effect(target_receipt_id uuid, target_generation bigint, target_token uuid, target_binding jsonb, target_event_id uuid DEFAULT NULL::uuid)
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
  if w.receipt_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() or public.booking_confirmation_notification_binding(w) is distinct from target_binding then return jsonb_build_object('status','stale'); end if;
  if e.id is null then insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome) values(w.receipt_id,w.event_id,target_generation,target_token,'query','not-found'); return jsonb_build_object('status','not-found'); end if;
  if (e.logical_id,e.booking_request_id,e.booking_request_reference,e.booking_reference,e.recipient_user_id,e.recipient_role,e.notice_locale,e.template_version,e.payload,e.payload_sha256) is distinct from (w.logical_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256) then raise exception 'Notification effect binding conflict' using errcode='RC409'; end if;
  insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome,effect_id) values(w.receipt_id,w.event_id,target_generation,target_token,'query','delivered',e.id);
  return jsonb_build_object('status','found','effectId',e.id,'supplierDeliveryReference',e.supplier_delivery_reference,'executedAt',e.executed_at);
end $function$
;

CREATE OR REPLACE FUNCTION public.record_booking_confirmation_notification_failure(target_receipt_id uuid, target_generation bigint, target_token uuid, target_outcome text, target_event_id uuid DEFAULT NULL::uuid)
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
  if w.receipt_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() then return jsonb_build_object('status','stale'); end if;
  if target_outcome='failed' and exists(select 1 from public.fictional_booking_confirmation_notification_effects where notification_id=w.notification_id) then raise exception 'Delivered effect cannot be failed' using errcode='RC409'; end if;
  update public.booking_confirmation_notification_work set state=case target_outcome when 'failed' then 'retryable' else 'uncertain' end,lease_token=null,lease_expires_at=null,last_outcome=target_outcome,updated_at=clock_timestamp() where notification_id=w.notification_id;
  insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,lease_generation,lease_token,action,outcome) values(w.receipt_id,w.event_id,target_generation,target_token,'failure',target_outcome);
  return jsonb_build_object('status',case target_outcome when 'failed' then 'retryable' else 'uncertain' end);
end $function$
;

CREATE OR REPLACE FUNCTION public.retry_booking_confirmation_notification(target_receipt_id uuid, target_event_id uuid DEFAULT NULL::uuid)
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
  if actor is null or role.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null) or w.receipt_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id or w.recipient_user_id is distinct from actor or not ((w.recipient_role='customer' and role.role in ('customer','cottage_owner') and q.customer_user_id=actor) or (w.recipient_role='cottage_owner' and role.role='cottage_owner' and role.owner_approval_state='approved' and q.owner_user_id=actor)) or w.state is distinct from 'retryable' or not public.booking_notification_is_deliverable(w) then raise exception 'Notification retry unavailable' using errcode='42501'; end if;
  update public.booking_confirmation_notification_work set state='pending',last_outcome=null,updated_at=clock_timestamp() where notification_id=w.notification_id;
  insert into public.booking_confirmation_notification_attempts(receipt_id,event_id,action,outcome) values(w.receipt_id,w.event_id,'user-retry','queued');
  return jsonb_build_object('status','queued');
end $function$
;

CREATE OR REPLACE FUNCTION public.booking_confirmation_notification_binding(target public.booking_confirmation_notification_work)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'receiptId',target.receipt_id,'recipientUserId',target.recipient_user_id,'recipientRole',target.recipient_role,
    'bookingRequestReference',target.booking_request_reference,'bookingReference',target.booking_reference,
    'locale',target.notice_locale,'logicalId',target.logical_id,'templateVersion',target.template_version,
    'payload',target.payload,'payloadSha256',target.payload_sha256)||case when target.event_id is null then '{}'::jsonb else jsonb_build_object('event',public.booking_notification_event_binding(target.event_id)) end
$function$
;

CREATE OR REPLACE FUNCTION public.guard_booking_confirmation_notification_work()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if (old.receipt_id,old.event_id,old.booking_request_id,old.booking_request_reference,old.booking_reference,old.recipient_user_id,old.recipient_role,old.logical_id,old.notice_locale,old.template_version,old.payload,old.payload_sha256,old.created_at)
    is distinct from (new.receipt_id,new.event_id,new.booking_request_id,new.booking_request_reference,new.booking_reference,new.recipient_user_id,new.recipient_role,new.logical_id,new.notice_locale,new.template_version,new.payload,new.payload_sha256,new.created_at)
    or old.state in ('delivered','suppressed') then raise exception 'Notification work binding or terminal state is immutable' using errcode='RC409'; end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.list_due_booking_confirmation_notifications(target_limit integer DEFAULT 50)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  if target_limit is null or target_limit not between 1 and 100 then raise exception 'Invalid notification limit' using errcode='22023'; end if;
  return query select source.candidate from (
    select r.id notification_id,r.created_at,public.booking_request_payment_status(q)='paid-confirmed' eligible,
      jsonb_build_object('receiptId',r.id,'recipientUserId',r.recipient_user_id,'recipientRole',r.recipient_role,'bookingRequestReference',q.booking_request_reference,'bookingReference',c.commitment_reference,'locale',s.acceptance_locale) candidate
    from public.booking_receipts r join public.booking_confirmations x on x.id=r.booking_confirmation_id join public.booking_requests q on q.id=x.booking_request_id
      join public.booking_snapshots s on s.id=r.booking_snapshot_id join public.cottage_booking_period_commitments c on c.id=x.booking_period_commitment_id
    union all
    select event.id,event.created_at,true,jsonb_build_object('receiptId',event.receipt_id,'recipientUserId',event.recipient_user_id,'recipientRole',event.recipient_role,'bookingRequestReference',q.booking_request_reference,'bookingReference',c.commitment_reference,'locale',event.notice_locale,'event',public.booking_notification_event_binding(event.id))
    from public.booking_notification_events event join public.booking_requests q on q.id=event.booking_request_id join public.cottage_booking_period_commitments c on c.id=q.booking_period_commitment_id
  ) source left join public.booking_confirmation_notification_work w on w.notification_id=source.notification_id
  where ((w.notification_id is null and source.eligible) or w.state in ('pending','uncertain') or (w.state='processing' and w.lease_expires_at<=clock_timestamp()))
  order by coalesce(w.updated_at,source.created_at),source.notification_id limit target_limit;
end $function$
;



-- Explicit privileges for the extended event-bound signatures.
REVOKE ALL ON FUNCTION public.ensure_booking_confirmation_notification_work(uuid,text,text,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lease_booking_confirmation_notification_work(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.query_fictional_booking_confirmation_notification_effect(uuid,bigint,uuid,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_fictional_booking_confirmation_notification_effect(uuid,bigint,uuid,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_booking_confirmation_notification_delivery(uuid,bigint,uuid,jsonb,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_booking_confirmation_notification_failure(uuid,bigint,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_booking_confirmation_notification_status(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retry_booking_confirmation_notification(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_booking_confirmation_notification_work(uuid,text,text,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lease_booking_confirmation_notification_work(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.query_fictional_booking_confirmation_notification_effect(uuid,bigint,uuid,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_fictional_booking_confirmation_notification_effect(uuid,bigint,uuid,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_booking_confirmation_notification_delivery(uuid,bigint,uuid,jsonb,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_booking_confirmation_notification_failure(uuid,bigint,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_confirmation_notification_status(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_booking_confirmation_notification(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.booking_notification_event_binding(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.booking_notification_is_deliverable(public.booking_confirmation_notification_work) FROM PUBLIC;
