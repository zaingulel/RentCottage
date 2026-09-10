-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.complete_booking_confirmation_notification_delivery (
  target_receipt_id uuid,
  target_generation bigint,
  target_token      uuid,
  target_binding    jsonb,
  target_effect_id  uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare e public.fictional_booking_confirmation_notification_effects;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.receipt_id=target_receipt_id for update of requests;
  select * into w from public.booking_confirmation_notification_work where receipt_id=target_receipt_id for update;
  select * into e from public.fictional_booking_confirmation_notification_effects where id=target_effect_id and receipt_id=target_receipt_id for update;
  if w.receipt_id is null or e.id is null or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() or public.booking_confirmation_notification_binding(w) is distinct from target_binding
    or (e.logical_id,e.booking_request_id,e.booking_request_reference,e.booking_reference,e.recipient_user_id,e.recipient_role,e.notice_locale,e.template_version,e.payload,e.payload_sha256) is distinct from (w.logical_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256)
    then return jsonb_build_object('status','stale'); end if;
  update public.booking_confirmation_notification_work set state='delivered',lease_token=null,lease_expires_at=null,last_outcome='delivered',supplier_delivery_reference=e.supplier_delivery_reference,delivered_at=e.executed_at,updated_at=clock_timestamp() where receipt_id=w.receipt_id;
  insert into public.booking_confirmation_notification_attempts(receipt_id,lease_generation,lease_token,action,outcome,effect_id) values(w.receipt_id,target_generation,target_token,'complete','delivered',e.id);
  return jsonb_build_object('status','delivered','historical',public.booking_request_payment_status(q)<>'paid-confirmed');
end $function$;

REVOKE ALL ON FUNCTION public.complete_booking_confirmation_notification_delivery(uuid, bigint, uuid, jsonb, uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.complete_booking_confirmation_notification_delivery(uuid, bigint, uuid, jsonb, uuid) TO service_role;

CREATE FUNCTION public.ensure_booking_confirmation_notification_work (
  target_receipt_id uuid,
  target_locale     text,
  target_template   text,
  target_payload    jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare r public.booking_receipts; declare s public.booking_snapshots; declare c public.cottage_booking_period_commitments; declare w public.booking_confirmation_notification_work; declare target_hash text;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  select * into r from public.booking_receipts where id=target_receipt_id;
  if r.id is null then raise exception 'Unknown booking receipt' using errcode='RC404'; end if;
  select * into s from public.booking_snapshots where id=r.booking_snapshot_id;
  select commitments.* into c from public.cottage_booking_period_commitments commitments join public.booking_confirmations confirmations on confirmations.booking_period_commitment_id=commitments.id where confirmations.id=r.booking_confirmation_id;
  select * into q from public.booking_requests where id=(select booking_request_id from public.booking_confirmations where id=r.booking_confirmation_id) for update;
  select * into w from public.booking_confirmation_notification_work where receipt_id=r.id for update;
  target_hash:=encode(extensions.digest(convert_to(target_payload::text,'UTF8'),'sha256'),'hex');
  if w.receipt_id is not null then
    if public.booking_confirmation_notification_binding(w) is distinct from jsonb_build_object('receiptId',r.id,'recipientUserId',r.recipient_user_id,'recipientRole',r.recipient_role,'bookingRequestReference',q.booking_request_reference,'bookingReference',c.commitment_reference,'locale',target_locale,'logicalId','paid-confirmation:'||r.id,'templateVersion',target_template,'payload',target_payload,'payloadSha256',target_hash)
      then raise exception 'Notification binding is immutable' using errcode='RC409'; end if; return;
  end if;
  if public.booking_request_payment_status(q) is distinct from 'paid-confirmed' or target_locale is distinct from s.acceptance_locale::text or target_template is distinct from 'paid-confirmation-v1'
    or target_payload->>'bookingReference' is distinct from c.commitment_reference or target_payload->>'detailsPath' is distinct from ('/'||target_locale||'/'||case when r.recipient_role='customer' then 'booking-requests/' else 'owner/booking-requests/' end||q.booking_request_reference)
    then raise exception 'Invalid paid confirmation notification binding' using errcode='RC409'; end if;
  insert into public.booking_confirmation_notification_work(receipt_id,booking_request_id,booking_request_reference,booking_reference,recipient_user_id,recipient_role,logical_id,notice_locale,template_version,payload,payload_sha256)
    values(r.id,q.id,q.booking_request_reference,c.commitment_reference,r.recipient_user_id,r.recipient_role,'paid-confirmation:'||r.id,target_locale::public.cottage_profile_source_language,target_template,target_payload,target_hash);
end $function$;

REVOKE ALL ON FUNCTION public.ensure_booking_confirmation_notification_work(uuid, text, text, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.ensure_booking_confirmation_notification_work(uuid, text, text, jsonb) TO service_role;

CREATE FUNCTION public.execute_fictional_booking_confirmation_notification_effect (
  target_receipt_id uuid,
  target_generation bigint,
  target_token      uuid,
  target_binding    jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare e public.fictional_booking_confirmation_notification_effects;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.receipt_id=target_receipt_id for update of requests;
  select * into w from public.booking_confirmation_notification_work where receipt_id=target_receipt_id for update;
  select * into e from public.fictional_booking_confirmation_notification_effects where receipt_id=target_receipt_id for update;
  if w.receipt_id is null or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() or public.booking_confirmation_notification_binding(w) is distinct from target_binding then return jsonb_build_object('status','stale'); end if;
  if e.id is not null then return jsonb_build_object('status','delivered','effectId',e.id,'supplierDeliveryReference',e.supplier_delivery_reference,'executedAt',e.executed_at); end if;
  if public.booking_request_payment_status(q)<>'paid-confirmed' then
    update public.booking_confirmation_notification_work set state='suppressed',lease_token=null,lease_expires_at=null,last_outcome='suppressed',suppressed_at=clock_timestamp(),updated_at=clock_timestamp() where receipt_id=w.receipt_id;
    insert into public.booking_confirmation_notification_attempts(receipt_id,lease_generation,lease_token,action,outcome) values(w.receipt_id,target_generation,target_token,'execute','suppressed'); return jsonb_build_object('status','suppressed');
  end if;
  insert into public.fictional_booking_confirmation_notification_effects(supplier,environment,logical_id,receipt_id,booking_request_id,booking_request_reference,booking_reference,recipient_user_id,recipient_role,notice_locale,template_version,payload,payload_sha256,execution_lease_generation,execution_lease_token,supplier_delivery_reference)
    values('fictional-notifications','local-test',w.logical_id,w.receipt_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256,target_generation,target_token,'fictional-confirmation-'||w.receipt_id) returning * into e;
  insert into public.booking_confirmation_notification_attempts(receipt_id,lease_generation,lease_token,action,outcome,effect_id) values(w.receipt_id,target_generation,target_token,'execute','delivered',e.id);
  return jsonb_build_object('status','delivered','effectId',e.id,'supplierDeliveryReference',e.supplier_delivery_reference,'executedAt',e.executed_at);
end $function$;

REVOKE ALL ON FUNCTION public.execute_fictional_booking_confirmation_notification_effect(uuid, bigint, uuid, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.execute_fictional_booking_confirmation_notification_effect(uuid, bigint, uuid, jsonb) TO service_role;

CREATE FUNCTION public.get_booking_confirmation_notification_status (
  target_receipt_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare role public.account_contexts; declare actor uuid:=(select auth.uid());
begin
  select * into w from public.booking_confirmation_notification_work where receipt_id=target_receipt_id;
  select * into q from public.booking_requests where id=w.booking_request_id;
  select * into role from public.account_contexts where user_id=actor;
  if actor is null or role.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null) or w.receipt_id is null or w.recipient_user_id is distinct from actor or role.role::text is distinct from w.recipient_role or (w.recipient_role='cottage_owner' and role.owner_approval_state::text is distinct from 'approved') then raise exception 'Notification status unavailable' using errcode='42501'; end if;
  return jsonb_build_object('receiptId',w.receipt_id,'state',w.state,'lastOutcome',w.last_outcome,'supplierDeliveryReference',w.supplier_delivery_reference,'deliveredAt',w.delivered_at,'suppressedAt',w.suppressed_at,'historical',w.state='delivered' and public.booking_request_payment_status(q)<>'paid-confirmed');
end $function$;

REVOKE ALL ON FUNCTION public.get_booking_confirmation_notification_status(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_booking_confirmation_notification_status(uuid) TO authenticated;

CREATE FUNCTION public.guard_booking_confirmation_notification_work()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if (old.receipt_id,old.booking_request_id,old.booking_request_reference,old.booking_reference,old.recipient_user_id,old.recipient_role,old.logical_id,old.notice_locale,old.template_version,old.payload,old.payload_sha256,old.created_at)
    is distinct from (new.receipt_id,new.booking_request_id,new.booking_request_reference,new.booking_reference,new.recipient_user_id,new.recipient_role,new.logical_id,new.notice_locale,new.template_version,new.payload,new.payload_sha256,new.created_at)
    or old.state in ('delivered','suppressed') then raise exception 'Notification work binding or terminal state is immutable' using errcode='RC409'; end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION public.guard_booking_confirmation_notification_work() FROM PUBLIC;

CREATE FUNCTION public.lease_booking_confirmation_notification_work (
  target_receipt_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.receipt_id=target_receipt_id for update of requests;
  select * into w from public.booking_confirmation_notification_work where receipt_id=target_receipt_id for update;
  if w.receipt_id is null or not (w.state in ('pending','uncertain') or (w.state='processing' and w.lease_expires_at<=clock_timestamp())) then return null; end if;
  update public.booking_confirmation_notification_work set state='processing',lease_generation=lease_generation+1,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where receipt_id=w.receipt_id returning * into w;
  return public.booking_confirmation_notification_binding(w)||jsonb_build_object('leaseGeneration',w.lease_generation,'leaseToken',w.lease_token,'leaseExpiresAt',w.lease_expires_at);
end $function$;

REVOKE ALL ON FUNCTION public.lease_booking_confirmation_notification_work(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.lease_booking_confirmation_notification_work(uuid) TO service_role;

CREATE FUNCTION public.list_due_booking_confirmation_notifications (
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
  return query select jsonb_build_object(
    'receiptId',r.id,'recipientUserId',r.recipient_user_id,'recipientRole',r.recipient_role,
    'bookingRequestReference',q.booking_request_reference,'bookingReference',c.commitment_reference,
    'locale',s.acceptance_locale)
  from public.booking_receipts r
  join public.booking_confirmations x on x.id=r.booking_confirmation_id
  join public.booking_requests q on q.id=x.booking_request_id
  join public.booking_snapshots s on s.id=r.booking_snapshot_id
  join public.cottage_booking_period_commitments c on c.id=x.booking_period_commitment_id
  left join public.booking_confirmation_notification_work w on w.receipt_id=r.id
  where ((w.receipt_id is null and public.booking_request_payment_status(q)='paid-confirmed')
    or w.state in ('pending','uncertain') or (w.state='processing' and w.lease_expires_at<=clock_timestamp()))
  order by coalesce(w.updated_at,r.created_at),r.id limit target_limit;
end $function$;

REVOKE ALL ON FUNCTION public.list_due_booking_confirmation_notifications(integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_due_booking_confirmation_notifications(integer) TO service_role;

CREATE FUNCTION public.query_fictional_booking_confirmation_notification_effect (
  target_receipt_id uuid,
  target_generation bigint,
  target_token      uuid,
  target_binding    jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare e public.fictional_booking_confirmation_notification_effects;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.receipt_id=target_receipt_id for update of requests;
  select * into w from public.booking_confirmation_notification_work where receipt_id=target_receipt_id for update;
  select * into e from public.fictional_booking_confirmation_notification_effects where receipt_id=target_receipt_id for update;
  if w.receipt_id is null or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() or public.booking_confirmation_notification_binding(w) is distinct from target_binding then return jsonb_build_object('status','stale'); end if;
  if e.id is null then insert into public.booking_confirmation_notification_attempts(receipt_id,lease_generation,lease_token,action,outcome) values(w.receipt_id,target_generation,target_token,'query','not-found'); return jsonb_build_object('status','not-found'); end if;
  if (e.logical_id,e.booking_request_id,e.booking_request_reference,e.booking_reference,e.recipient_user_id,e.recipient_role,e.notice_locale,e.template_version,e.payload,e.payload_sha256) is distinct from (w.logical_id,w.booking_request_id,w.booking_request_reference,w.booking_reference,w.recipient_user_id,w.recipient_role,w.notice_locale,w.template_version,w.payload,w.payload_sha256) then raise exception 'Notification effect binding conflict' using errcode='RC409'; end if;
  insert into public.booking_confirmation_notification_attempts(receipt_id,lease_generation,lease_token,action,outcome,effect_id) values(w.receipt_id,target_generation,target_token,'query','delivered',e.id);
  return jsonb_build_object('status','found','effectId',e.id,'supplierDeliveryReference',e.supplier_delivery_reference,'executedAt',e.executed_at);
end $function$;

REVOKE ALL ON FUNCTION public.query_fictional_booking_confirmation_notification_effect(uuid, bigint, uuid, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.query_fictional_booking_confirmation_notification_effect(uuid, bigint, uuid, jsonb) TO service_role;

CREATE FUNCTION public.record_booking_confirmation_notification_failure (
  target_receipt_id uuid,
  target_generation bigint,
  target_token      uuid,
  target_outcome    text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work;
begin
  if current_setting('role',true)<>'service_role' or target_outcome not in ('failed','unknown') then raise exception 'Invalid notification failure' using errcode='42501'; end if;
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.receipt_id=target_receipt_id for update of requests;
  select * into w from public.booking_confirmation_notification_work where receipt_id=target_receipt_id for update;
  if w.receipt_id is null or w.state is distinct from 'processing' or w.lease_generation is distinct from target_generation or w.lease_token is distinct from target_token or w.lease_expires_at is null or w.lease_expires_at<=clock_timestamp() then return jsonb_build_object('status','stale'); end if;
  if target_outcome='failed' and exists(select 1 from public.fictional_booking_confirmation_notification_effects where receipt_id=w.receipt_id) then raise exception 'Delivered effect cannot be failed' using errcode='RC409'; end if;
  update public.booking_confirmation_notification_work set state=case target_outcome when 'failed' then 'retryable' else 'uncertain' end,lease_token=null,lease_expires_at=null,last_outcome=target_outcome,updated_at=clock_timestamp() where receipt_id=w.receipt_id;
  insert into public.booking_confirmation_notification_attempts(receipt_id,lease_generation,lease_token,action,outcome) values(w.receipt_id,target_generation,target_token,'failure',target_outcome);
  return jsonb_build_object('status',case target_outcome when 'failed' then 'retryable' else 'uncertain' end);
end $function$;

REVOKE ALL ON FUNCTION public.record_booking_confirmation_notification_failure(uuid, bigint, uuid, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_booking_confirmation_notification_failure(uuid, bigint, uuid, text) TO service_role;

CREATE FUNCTION public.retry_booking_confirmation_notification (
  target_receipt_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare role public.account_contexts; declare actor uuid:=(select auth.uid());
begin
  select requests.* into q from public.booking_requests requests join public.booking_confirmation_notification_work work on work.booking_request_id=requests.id where work.receipt_id=target_receipt_id for update of requests;
  select * into w from public.booking_confirmation_notification_work where receipt_id=target_receipt_id for update;
  select * into role from public.account_contexts where user_id=actor;
  if actor is null or role.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null) or w.receipt_id is null or w.recipient_user_id is distinct from actor or role.role::text is distinct from w.recipient_role or (w.recipient_role='cottage_owner' and role.owner_approval_state::text is distinct from 'approved') or w.state is distinct from 'retryable' or public.booking_request_payment_status(q) is distinct from 'paid-confirmed' then raise exception 'Notification retry unavailable' using errcode='42501'; end if;
  update public.booking_confirmation_notification_work set state='pending',last_outcome=null,updated_at=clock_timestamp() where receipt_id=w.receipt_id;
  insert into public.booking_confirmation_notification_attempts(receipt_id,action,outcome) values(w.receipt_id,'user-retry','queued');
  return jsonb_build_object('status','queued');
end $function$;

REVOKE ALL ON FUNCTION public.retry_booking_confirmation_notification(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.retry_booking_confirmation_notification(uuid) TO authenticated;

CREATE TABLE public.booking_confirmation_notification_attempts (
  id               uuid                     DEFAULT gen_random_uuid() NOT NULL,
  receipt_id       uuid                     NOT NULL,
  lease_generation bigint,
  lease_token      uuid,
  action           text                     NOT NULL,
  outcome          text                     NOT NULL,
  effect_id        uuid,
  recorded_at      timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.booking_confirmation_notification_attempts
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_confirmation_notification_attempts
  ADD CONSTRAINT booking_confirmation_notification_attempt_action
    CHECK (action = ANY (ARRAY['query'::text, 'execute'::text, 'complete'::text, 'failure'::text, 'user-retry'::text]));

ALTER TABLE public.booking_confirmation_notification_attempts
  ADD CONSTRAINT booking_confirmation_notification_attempt_lease CHECK ((lease_generation IS NULL) = (lease_token IS NULL));

ALTER TABLE public.booking_confirmation_notification_attempts
  ADD CONSTRAINT booking_confirmation_notification_attempt_outcome
    CHECK (outcome = ANY (ARRAY['not-found'::text, 'delivered'::text, 'failed'::text, 'unknown'::text, 'suppressed'::text, 'queued'::text]));

ALTER TABLE public.booking_confirmation_notification_attempts
  ADD CONSTRAINT booking_confirmation_notification_attempts_pkey PRIMARY KEY (id);

CREATE INDEX booking_confirmation_notification_attempts_receipt_idx ON public.booking_confirmation_notification_attempts (receipt_id, recorded_at, id);

CREATE TRIGGER reject_booking_confirmation_notification_attempt_change
  BEFORE DELETE OR UPDATE ON public.booking_confirmation_notification_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_booking_confirmation_change();

CREATE TABLE public.booking_confirmation_notification_work (
  receipt_id                  uuid                                   NOT NULL,
  booking_request_id          uuid                                   NOT NULL,
  booking_request_reference   text                                   NOT NULL,
  booking_reference           text                                   NOT NULL,
  recipient_user_id           uuid                                   NOT NULL,
  recipient_role              text                                   NOT NULL,
  logical_id                  text                                   NOT NULL,
  notice_locale               public.cottage_profile_source_language NOT NULL,
  template_version            text                                   NOT NULL,
  payload                     jsonb                                  NOT NULL,
  payload_sha256              text                                   NOT NULL,
  state                       text                                   DEFAULT 'pending'::text NOT NULL,
  lease_generation            bigint                                 DEFAULT 0 NOT NULL,
  lease_token                 uuid,
  lease_expires_at            timestamp with time zone,
  last_outcome                text,
  supplier_delivery_reference text,
  delivered_at                timestamp with time zone,
  suppressed_at               timestamp with time zone,
  created_at                  timestamp with time zone               DEFAULT clock_timestamp() NOT NULL,
  updated_at                  timestamp with time zone               DEFAULT clock_timestamp() NOT NULL
);

CREATE FUNCTION public.booking_confirmation_notification_binding (
  target public.booking_confirmation_notification_work
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select jsonb_build_object(
    'receiptId',target.receipt_id,'recipientUserId',target.recipient_user_id,'recipientRole',target.recipient_role,
    'bookingRequestReference',target.booking_request_reference,'bookingReference',target.booking_reference,
    'locale',target.notice_locale,'logicalId',target.logical_id,'templateVersion',target.template_version,
    'payload',target.payload,'payloadSha256',target.payload_sha256)
$function$;

REVOKE ALL ON FUNCTION public.booking_confirmation_notification_binding(public.booking_confirmation_notification_work) FROM PUBLIC;

ALTER TABLE public.booking_confirmation_notification_work
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_confirmation_notification_work
  ADD CONSTRAINT booking_confirmation_notification_work_binding
    CHECK
    ((recipient_role = ANY (ARRAY['customer'::text, 'cottage_owner'::text])) AND logical_id = ('paid-confirmation:'::text || receipt_id::text) AND template_version =
    'paid-confirmation-v1'::text AND payload_sha256 ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE public.booking_confirmation_notification_work
  ADD CONSTRAINT booking_confirmation_notification_work_booking_request_id_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_confirmation_notification_work
  ADD CONSTRAINT booking_confirmation_notification_work_logical_id_key UNIQUE (logical_id);

ALTER TABLE public.booking_confirmation_notification_work
  ADD CONSTRAINT booking_confirmation_notification_work_payload
    CHECK
    (jsonb_typeof(payload) = 'object'::text AND payload ?& ARRAY['kind'::text, 'title'::text, 'body'::text, 'bookingReference'::text, 'detailsPath'::text, 'linkLabel'::text,
    'fictional'::text] AND (payload - ARRAY['kind'::text, 'title'::text, 'body'::text, 'bookingReference'::text, 'detailsPath'::text, 'linkLabel'::text, 'fictional'::text]) =
    '{}'::jsonb AND (payload ->> 'kind'::text) = 'paid-confirmation'::text AND (payload -> 'fictional'::text) = 'true'::jsonb);

ALTER TABLE public.booking_confirmation_notification_work
  ADD CONSTRAINT booking_confirmation_notification_work_pkey PRIMARY KEY (receipt_id);

ALTER TABLE public.booking_confirmation_notification_attempts
  ADD CONSTRAINT booking_confirmation_notification_attempts_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.booking_confirmation_notification_work(receipt_id)
    ON DELETE RESTRICT;

ALTER TABLE public.booking_confirmation_notification_work
  ADD CONSTRAINT booking_confirmation_notification_work_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.booking_receipts(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_confirmation_notification_work
  ADD CONSTRAINT booking_confirmation_notification_work_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;

ALTER TABLE public.booking_confirmation_notification_work
  ADD CONSTRAINT booking_confirmation_notification_work_state
    CHECK (state = ANY (ARRAY['pending'::text, 'processing'::text, 'retryable'::text, 'uncertain'::text, 'delivered'::text, 'suppressed'::text]));

ALTER TABLE public.booking_confirmation_notification_work
  ADD CONSTRAINT booking_confirmation_notification_work_state_shape
    CHECK
    (state = 'pending'::text AND lease_token IS NULL AND lease_expires_at IS NULL AND last_outcome IS NULL AND supplier_delivery_reference IS NULL AND delivered_at IS NULL AND
    suppressed_at IS NULL OR state = 'processing'::text AND lease_generation > 0 AND lease_token IS NOT NULL AND lease_expires_at IS
    NOT NULL AND delivered_at IS NULL AND suppressed_at IS NULL OR state = 'retryable'::text AND lease_token IS NULL AND lease_expires_at IS NULL AND last_outcome = 'failed'::text
    AND supplier_delivery_reference IS NULL AND delivered_at IS NULL AND suppressed_at IS NULL OR state = 'uncertain'::text AND lease_token IS NULL AND lease_expires_at IS NULL AND
    last_outcome = 'unknown'::text AND delivered_at IS NULL AND suppressed_at IS NULL OR state = 'delivered'::text AND lease_token IS NULL AND lease_expires_at IS NULL AND
    last_outcome = 'delivered'::text AND supplier_delivery_reference IS NOT NULL AND delivered_at IS
    NOT NULL AND suppressed_at IS NULL OR state = 'suppressed'::text AND lease_token IS NULL AND lease_expires_at IS NULL AND last_outcome = 'suppressed'::text AND
    supplier_delivery_reference IS NULL AND delivered_at IS NULL AND suppressed_at IS NOT NULL);

CREATE INDEX booking_confirmation_notification_work_due_idx ON public.booking_confirmation_notification_work (updated_at, receipt_id)
  WHERE state = ANY (ARRAY['pending'::text, 'processing'::text, 'uncertain'::text]);

CREATE TRIGGER guard_booking_confirmation_notification_work
  BEFORE DELETE OR UPDATE ON public.booking_confirmation_notification_work
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_booking_confirmation_notification_work();

CREATE TABLE public.fictional_booking_confirmation_notification_effects (
  id                          uuid                                   DEFAULT gen_random_uuid() NOT NULL,
  supplier                    text                                   NOT NULL,
  environment                 text                                   NOT NULL,
  logical_id                  text                                   NOT NULL,
  receipt_id                  uuid                                   NOT NULL,
  booking_request_id          uuid                                   NOT NULL,
  booking_request_reference   text                                   NOT NULL,
  booking_reference           text                                   NOT NULL,
  recipient_user_id           uuid                                   NOT NULL,
  recipient_role              text                                   NOT NULL,
  notice_locale               public.cottage_profile_source_language NOT NULL,
  template_version            text                                   NOT NULL,
  payload                     jsonb                                  NOT NULL,
  payload_sha256              text                                   NOT NULL,
  execution_lease_generation  bigint                                 NOT NULL,
  execution_lease_token       uuid                                   NOT NULL,
  supplier_delivery_reference text                                   NOT NULL,
  executed_at                 timestamp with time zone               DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.fictional_booking_confirmation_notification_effects
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fictional_booking_confirmation_notification_effects
  ADD CONSTRAINT fictional_booking_confirmation_notification_effect_identity
    CHECK
    (supplier = 'fictional-notifications'::text AND environment = 'local-test'::text AND logical_id = ('paid-confirmation:'::text || receipt_id::text) AND (recipient_role = ANY
    (ARRAY['customer'::text, 'cottage_owner'::text])) AND template_version = 'paid-confirmation-v1'::text AND payload_sha256 ~ '^[0-9a-f]{64}$'::text AND execution_lease_generation
    > 0);

ALTER TABLE public.fictional_booking_confirmation_notification_effects
  ADD CONSTRAINT fictional_booking_confirmation_notification_effects_booking_req FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id) ON DELETE RESTRICT;

ALTER TABLE public.fictional_booking_confirmation_notification_effects
  ADD CONSTRAINT fictional_booking_confirmation_notification_effects_identity_ke UNIQUE (supplier, environment, logical_id);

ALTER TABLE public.fictional_booking_confirmation_notification_effects
  ADD CONSTRAINT fictional_booking_confirmation_notification_effects_pkey PRIMARY KEY (id);

ALTER TABLE public.booking_confirmation_notification_attempts
  ADD CONSTRAINT booking_confirmation_notification_attempts_effect_id_fkey FOREIGN KEY (effect_id) REFERENCES public.fictional_booking_confirmation_notification_effects(id)
    ON DELETE RESTRICT;

ALTER TABLE public.fictional_booking_confirmation_notification_effects
  ADD CONSTRAINT fictional_booking_confirmation_notification_effects_receipt_id_ FOREIGN KEY (receipt_id) REFERENCES public.booking_confirmation_notification_work(receipt_id)
    ON DELETE RESTRICT;

ALTER TABLE public.fictional_booking_confirmation_notification_effects
  ADD CONSTRAINT fictional_booking_confirmation_notification_effects_recipient_u FOREIGN KEY (recipient_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;

ALTER TABLE public.fictional_booking_confirmation_notification_effects
  ADD CONSTRAINT fictional_booking_confirmation_notification_effects_reference_k UNIQUE (supplier_delivery_reference);

CREATE TRIGGER reject_fictional_booking_confirmation_notification_effect_chang
  BEFORE DELETE OR UPDATE ON public.fictional_booking_confirmation_notification_effects
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_booking_confirmation_change();
