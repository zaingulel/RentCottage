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
    else exists(select 1 from public.booking_notification_events event join public.booking_receipts receipt on receipt.id=event.receipt_id
      join public.account_contexts context on context.user_id=event.recipient_user_id join auth.users actor on actor.id=context.user_id
      join public.cottage_booking_period_commitments commitment on commitment.id=request.booking_period_commitment_id
      where event.id=target.event_id and event.booking_request_id=request.id and event.receipt_id=target.receipt_id
        and event.recipient_user_id=target.recipient_user_id and event.recipient_role=target.recipient_role and event.notice_locale=target.notice_locale
        and receipt.recipient_user_id=target.recipient_user_id and receipt.recipient_role=target.recipient_role and actor.phone_confirmed_at is not null
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
    if event.id is null or (event.booking_request_id,event.receipt_id,event.recipient_user_id,event.recipient_role,event.notice_locale) is distinct from (q.id,r.id,r.recipient_user_id,r.recipient_role,s.acceptance_locale)
      or (event.event_kind='preparation_reminder' and (event.due_at,event.first_starts_at) is distinct from (lower(range_merge(c.access_ranges))-interval '24 hours',lower(range_merge(c.access_ranges))))
    then raise exception 'Notification event source is invalid' using errcode='RC409'; end if;
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
    or (target_event_id is not null and event.event_kind<>'preparation_reminder' and target_payload->'allocation' is distinct from event_binding->'allocation')
    or (target_event_id is not null and event.event_kind='preparation_reminder' and (target_payload->>'dueAt',target_payload->>'firstStartsAt') is distinct from (event_binding->>'dueAt',event_binding->>'firstStartsAt'))
    or target_payload->>'bookingReference' is distinct from c.commitment_reference
    or target_payload->>'detailsPath' is distinct from ('/'||target_locale||'/'||case when r.recipient_role='customer' then 'booking-requests/' else 'owner/booking-requests/' end||q.booking_request_reference)
    then raise exception 'Invalid booking notification binding' using errcode='RC409'; end if;
  insert into public.booking_confirmation_notification_work(receipt_id,event_id,booking_request_id,booking_request_reference,booking_reference,recipient_user_id,recipient_role,logical_id,notice_locale,template_version,payload,payload_sha256)
    values(r.id,target_event_id,q.id,q.booking_request_reference,c.commitment_reference,r.recipient_user_id,r.recipient_role,logical_id,target_locale::public.cottage_profile_source_language,target_template,target_payload,target_hash);
end $function$;

CREATE FUNCTION public.ensure_booking_preparation_reminder_events (
  target_booking_request_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare x public.booking_confirmations; declare s public.booking_snapshots; declare c public.cottage_booking_period_commitments; declare first_start timestamptz;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Notification service role required' using errcode='42501'; end if;
  select * into q from public.booking_requests where id=target_booking_request_id for update;
  select * into x from public.booking_confirmations where booking_request_id=q.id;
  select * into s from public.booking_snapshots where id=q.booking_snapshot_id;
  select * into c from public.cottage_booking_period_commitments where id=q.booking_period_commitment_id;
  first_start:=lower(range_merge(c.access_ranges));
  if q.id is null or x.id is null or (x.booking_snapshot_id,x.booking_period_commitment_id) is distinct from (s.id,c.id)
    or c.status<>'confirmed_booking' or public.booking_request_payment_status(q)<>'paid-confirmed'
    or (select count(*) from public.booking_receipts where booking_confirmation_id=x.id)<>2
  then raise exception 'Preparation reminder source is incomplete' using errcode='RC409'; end if;
  insert into public.booking_notification_events(booking_request_id,receipt_id,event_kind,recipient_user_id,recipient_role,notice_locale,due_at,first_starts_at,created_at)
    select q.id,r.id,'preparation_reminder',r.recipient_user_id,r.recipient_role,s.acceptance_locale,first_start-interval '24 hours',first_start,clock_timestamp()
    from public.booking_receipts r where r.booking_confirmation_id=x.id
    on conflict(receipt_id) where event_kind='preparation_reminder' do nothing;
  if (select count(*) from public.booking_notification_events e join public.booking_receipts r on r.id=e.receipt_id
      where e.booking_request_id=q.id and e.event_kind='preparation_reminder' and r.booking_confirmation_id=x.id
        and (e.recipient_user_id,e.recipient_role,e.notice_locale,e.due_at,e.first_starts_at)=(r.recipient_user_id,r.recipient_role,s.acceptance_locale,first_start-interval '24 hours',first_start))<>2
  then raise exception 'Preparation reminder binding is incomplete' using errcode='RC409'; end if;
end $function$;

REVOKE ALL ON FUNCTION public.ensure_booking_preparation_reminder_events(uuid) FROM PUBLIC;

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
  select receipts.recipient_user_id into recipient from public.booking_receipts receipts where receipts.id=target_receipt_id;
  select requests.* into q from public.booking_requests requests join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id join public.booking_receipts receipts on receipts.booking_confirmation_id=confirmations.id where receipts.id=target_receipt_id for update of requests;
  select * into actor from auth.users where id=recipient for share;
  select * into context from public.account_contexts where user_id=recipient for share;
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
end $function$;

CREATE OR REPLACE FUNCTION public.finalize_booking_request_confirmation (
  target_booking_request_id uuid,
  target_capture_snapshot   jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare capture_result jsonb;
declare target_request public.booking_requests;
declare target_attempt public.booking_request_submission_attempts;
declare target_claim public.booking_request_authorization_claims;
declare target_snapshot public.booking_snapshots;
declare target_commitment public.cottage_booking_period_commitments;
declare target_capture public.payment_provider_operations;
declare existing_confirmation public.booking_confirmations;
declare customer_receipt public.booking_receipts;
declare owner_receipt public.booking_receipts;
declare created_confirmation public.booking_confirmations;
declare outcome_time timestamptz;
begin
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  if current_setting('role', true) <> 'service_role' then
    raise exception 'Booking Request confirmation is unavailable' using errcode = '42501';
  end if;
  if exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=target_booking_request_id) then return jsonb_build_object('status','correction-required'); end if;
  if target_capture_snapshot ->> 'purpose' = 'booking-request-payment-recovery' then
    target_capture_snapshot := public.validate_booking_request_payment_recovery_confirmation(
      target_booking_request_id, target_capture_snapshot
    );
  else
    capture_result := public.complete_booking_request_capture(
      target_booking_request_id, null, null, null
    );
    if capture_result -> 'snapshot' is distinct from target_capture_snapshot then
      raise exception 'Booking Request confirmation Capture evidence is invalid'
        using errcode = 'RC409';
    end if;
  end if;

  select * into target_request from public.booking_requests requests
  where requests.id = target_booking_request_id;
  select * into target_attempt from public.booking_request_submission_attempts attempts
  where attempts.id = (target_capture_snapshot ->> 'submissionAttemptId')::uuid;
  select * into target_claim from public.booking_request_authorization_claims claims
  where claims.id = (target_capture_snapshot ->> 'authorizationClaimId')::uuid;
  select * into target_snapshot from public.booking_snapshots snapshots
  where snapshots.id = target_request.booking_snapshot_id;
  select * into target_commitment from public.cottage_booking_period_commitments commitments
  where commitments.id = target_request.booking_period_commitment_id
  for update of commitments;
  select * into target_capture from public.payment_provider_operations operations
  where operations.claim_id = target_claim.id
    and operations.claim_generation = target_claim.generation
    and operations.operation_kind = 'capture'
    and operations.physical_attempt_id = target_capture_snapshot ->> 'capturePhysicalAttemptId'
  for update of operations;
  perform 1 from public.cottage_inventory_commitments inventory
  where inventory.booking_period_commitment_id = target_commitment.id
  order by inventory.service_day, inventory.unit_kind, inventory.unit_id
  for update of inventory;
  perform 1 from public.cottage_booking_period_occupancies occupancies
  where occupancies.booking_period_commitment_id = target_commitment.id
  order by occupancies.service_day, occupancies.shift_id
  for update of occupancies;

  if target_request.id is null
    or target_request.status <> 'accepted'
    or target_attempt.id is null
    or target_attempt.booking_request_id is distinct from target_request.id
    or target_claim.id is null
    or target_claim.attempt_id is distinct from target_attempt.id
    or target_snapshot.id is null
    or (target_snapshot.customer_user_id, target_snapshot.profile_id,
      target_snapshot.quote_fingerprint, target_snapshot.intent_fingerprint,
      target_snapshot.quote_payload, target_snapshot.intent_payload) is distinct from
      (target_request.customer_user_id, target_request.profile_id,
      target_attempt.quote_fingerprint, target_attempt.intent_fingerprint,
      target_attempt.quote_payload, target_attempt.intent_payload)
    or target_commitment.id is null
    or (target_commitment.customer_user_id, target_commitment.profile_id,
      target_commitment.schedule_revision_id) is distinct from
      (target_request.customer_user_id, target_request.profile_id,
      target_claim.schedule_revision_id)
    or target_claim.customer_user_id is distinct from target_request.customer_user_id
    or target_claim.profile_id is distinct from target_request.profile_id
    or target_claim.access_ranges is distinct from target_commitment.access_ranges
    or target_request.owner_user_id is distinct from (
      select profiles.owner_user_id
      from public.owner_application_cottage_profiles profiles
      where profiles.id = target_request.profile_id
    )
    or (target_snapshot.quote_payload ->> 'bookingPriceIqd')::bigint * 1000
      is distinct from (target_attempt.payment_snapshot ->> 'bookingPriceFils')::bigint
    or (target_snapshot.quote_payload ->> 'customerTotalIqd')::bigint * 1000
      is distinct from (target_capture_snapshot ->> 'amountFils')::bigint
    or (target_attempt.payment_snapshot ->> 'customerTotalFils')::bigint
      is distinct from (target_capture_snapshot ->> 'amountFils')::bigint
    or target_capture.id is null
    or target_capture.movement_reference
      is distinct from target_capture_snapshot #>> '{capture,movementReference}'
    or not exists (
      select 1 from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
    )
    or not exists (
      select 1 from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
    )
    or exists (
      select claim_items.unit_kind, claim_items.unit_id,
        claim_items.service_day, claim_items.price_iqd
      from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
      except
      select inventory.unit_kind, inventory.unit_id,
        inventory.service_day, inventory.committed_price_iqd
      from public.cottage_inventory_commitments inventory
      where inventory.booking_period_commitment_id = target_commitment.id
    )
    or exists (
      select inventory.unit_kind, inventory.unit_id,
        inventory.service_day, inventory.committed_price_iqd
      from public.cottage_inventory_commitments inventory
      where inventory.booking_period_commitment_id = target_commitment.id
      except
      select claim_items.unit_kind, claim_items.unit_id,
        claim_items.service_day, claim_items.price_iqd
      from public.booking_request_authorization_claim_items claim_items
      where claim_items.claim_id = target_claim.id
    )
    or exists (
      select claim_occupancies.schedule_revision_id,
        claim_occupancies.shift_id, claim_occupancies.service_day
      from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
      except
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
    )
    or exists (
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
      except
      select claim_occupancies.schedule_revision_id,
        claim_occupancies.shift_id, claim_occupancies.service_day
      from public.booking_request_authorization_claim_occupancies claim_occupancies
      where claim_occupancies.claim_id = target_claim.id
    )
    or exists (
      select target_claim.schedule_revision_id, expected.shift_id,
        claim_items.service_day
      from public.booking_request_authorization_claim_items claim_items
      cross join lateral (
        select claim_items.unit_id as shift_id
        where claim_items.unit_kind = 'shift'
        union all
        select shifts.id
        from public.cottage_shifts shifts
        where claim_items.unit_kind = 'full_day_bundle'
          and shifts.schedule_revision_id = target_claim.schedule_revision_id
      ) expected
      where claim_items.claim_id = target_claim.id
      except
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
    )
    or exists (
      select occupancies.schedule_revision_id,
        occupancies.shift_id, occupancies.service_day
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and occupancies.active
      except
      select target_claim.schedule_revision_id, expected.shift_id,
        claim_items.service_day
      from public.booking_request_authorization_claim_items claim_items
      cross join lateral (
        select claim_items.unit_id as shift_id
        where claim_items.unit_kind = 'shift'
        union all
        select shifts.id
        from public.cottage_shifts shifts
        where claim_items.unit_kind = 'full_day_bundle'
          and shifts.schedule_revision_id = target_claim.schedule_revision_id
      ) expected
      where claim_items.claim_id = target_claim.id
    )
    or exists (
      select 1 from public.cottage_booking_period_occupancies occupancies
      where occupancies.booking_period_commitment_id = target_commitment.id
        and not occupancies.active
    )
    or exists (
      select 1 from public.booking_request_release_work release_work
      where release_work.booking_request_id = target_request.id
    ) then
    raise exception 'Booking Request confirmation source graph is invalid'
      using errcode = 'RC409';
  end if;

  select * into existing_confirmation from public.booking_confirmations confirmations
  where confirmations.booking_request_id = target_request.id
  for update of confirmations;
  if existing_confirmation.id is not null then
    select * into customer_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'customer';
    select * into owner_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'cottage_owner';
    if (existing_confirmation.booking_snapshot_id,
      existing_confirmation.booking_period_commitment_id,
      existing_confirmation.capture_operation_id) is distinct from
      (target_snapshot.id, target_commitment.id, target_capture.id)
      or target_commitment.status <> 'confirmed_booking'
      or customer_receipt.id is null
      or owner_receipt.id is null
      or (customer_receipt.booking_snapshot_id, customer_receipt.recipient_user_id,
        customer_receipt.created_at) is distinct from
        (target_snapshot.id, target_request.customer_user_id,
        existing_confirmation.confirmed_at)
      or (owner_receipt.booking_snapshot_id, owner_receipt.recipient_user_id,
        owner_receipt.created_at) is distinct from
        (target_snapshot.id, target_request.owner_user_id,
        existing_confirmation.confirmed_at)
      or (select count(*) from public.booking_receipts receipts
        where receipts.booking_confirmation_id = existing_confirmation.id) <> 2 then
      raise exception 'Stored Booking Request confirmation is incomplete'
        using errcode = 'RC409';
    end if;
  else
    if target_commitment.status <> 'pending_hold' then
      raise exception 'Booking Request confirmation commitment is invalid'
        using errcode = 'RC409';
    end if;
    outcome_time := clock_timestamp();
    insert into public.booking_confirmations (
      booking_request_id, booking_snapshot_id, booking_period_commitment_id,
      capture_operation_id, confirmed_at
    ) values (
      target_request.id, target_snapshot.id, target_commitment.id,
      target_capture.id, outcome_time
    ) returning * into created_confirmation;
    update public.cottage_booking_period_commitments commitments
    set status = 'confirmed_booking'
    where commitments.id = target_commitment.id;
    insert into public.booking_receipts (
      booking_confirmation_id, booking_snapshot_id, recipient_role,
      recipient_user_id, created_at
    ) values
      (created_confirmation.id, target_snapshot.id, 'customer',
        target_request.customer_user_id, outcome_time),
      (created_confirmation.id, target_snapshot.id, 'cottage_owner',
        target_request.owner_user_id, outcome_time);
    existing_confirmation := created_confirmation;
    select * into customer_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'customer';
    select * into owner_receipt from public.booking_receipts receipts
    where receipts.booking_confirmation_id = existing_confirmation.id
      and receipts.recipient_role = 'cottage_owner';
  end if;

  perform public.ensure_booking_preparation_reminder_events(target_request.id);

  return jsonb_build_object(
    'bookingRequestId', target_request.id,
    'commitmentId', target_commitment.id,
    'bookingReference', target_commitment.commitment_reference,
    'confirmedAt', to_char(existing_confirmation.confirmed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'capturePhysicalAttemptId', target_capture.physical_attempt_id,
    'captureMovementReference', target_capture.movement_reference,
    'receipts', jsonb_build_object(
      'customer', jsonb_build_object(
        'id', customer_receipt.id, 'recipientId', customer_receipt.recipient_user_id
      ),
      'cottageOwner', jsonb_build_object(
        'id', owner_receipt.id, 'recipientId', owner_receipt.recipient_user_id
      )
    )
  );
end;
$function$;

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
    'notifications',(select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('eventId',e.id,'receiptId',e.receipt_id,'kind',e.event_kind,'dueAt',e.due_at,'recipientRole',e.recipient_role,'state',coalesce(w.state,'pending'),'deliveredAt',w.delivered_at,'outcome',w.last_outcome,'retryAllowed',coalesce(target_actor_role<>'platform_administrator' and w.state='retryable' and public.booking_notification_is_deliverable(w),false))) order by e.created_at,e.id),'[]') from public.booking_notification_events e left join public.booking_confirmation_notification_work w on w.event_id=e.id where e.booking_request_id=request.id and (target_actor_role='platform_administrator' or (e.recipient_user_id=(select auth.uid()) and e.recipient_role=target_actor_role))));
  if target_actor_role='platform_administrator' then
    result:=result||jsonb_build_object('audit',jsonb_build_object('cancellation',case when cancellation.id is not null then jsonb_build_object('reason',cancellation.reason,'category',cancellation.category,'actorUserId',cancellation.actor_user_id,'actorRole',cancellation.actor_role) end,
      'refunds',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'reason',reason,'actorUserId',actor_user_id) order by created_at,id),'[]') from public.booking_refund_intents where booking_request_id=request.id and source='administrator')));
  end if;
  result:=result||jsonb_build_object('lifecycle',public.get_booking_lifecycle(target_reference,target_actor_role),'eligibility',public.get_booking_completion_eligibility(target_reference,target_actor_role));
  return result;
end;
$function$;

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
  if w.receipt_id is null or w.receipt_id is distinct from target_receipt_id or w.event_id is distinct from target_event_id
    or not (w.state in ('pending','uncertain') or (w.state='processing' and w.lease_expires_at<=clock_timestamp()) or (w.state='retryable' and not public.booking_notification_is_deliverable(w)))
    or exists(select 1 from public.booking_notification_events event where event.id=w.event_id and event.event_kind='preparation_reminder' and event.due_at>clock_timestamp())
    then return null; end if;
  update public.booking_confirmation_notification_work set state='processing',lease_generation=lease_generation+1,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where notification_id=w.notification_id returning * into w;
  return public.booking_confirmation_notification_binding(w)||jsonb_build_object('leaseGeneration',w.lease_generation,'leaseToken',w.lease_token,'leaseExpiresAt',w.lease_expires_at);
end $function$;

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
    select event.id,event.created_at,true,event.event_kind<>'preparation_reminder' or event.due_at<=clock_timestamp(),jsonb_build_object('receiptId',event.receipt_id,'recipientUserId',event.recipient_user_id,'recipientRole',event.recipient_role,'bookingRequestReference',q.booking_request_reference,'bookingReference',c.commitment_reference,'locale',event.notice_locale,'event',public.booking_notification_event_binding(event.id))
    from public.booking_notification_events event join public.booking_requests q on q.id=event.booking_request_id join public.cottage_booking_period_commitments c on c.id=q.booking_period_commitment_id
  ) source left join public.booking_confirmation_notification_work w on w.notification_id=source.notification_id
  where source.due and ((w.notification_id is null and source.eligible) or w.state in ('pending','uncertain') or (w.state='processing' and w.lease_expires_at<=clock_timestamp()) or (w.state='retryable' and not public.booking_notification_is_deliverable(w)))
  order by coalesce(w.updated_at,source.created_at),source.notification_id limit target_limit;
end $function$;

ALTER TABLE public.booking_confirmation_notification_work
  ADD CONSTRAINT booking_confirmation_notification_work_payload
    CHECK
    (jsonb_typeof(payload) = 'object'::text AND payload ?& ARRAY['kind'::text, 'title'::text, 'body'::text, 'bookingReference'::text, 'detailsPath'::text, 'linkLabel'::text,
    'fictional'::text] AND (payload -> 'fictional'::text) = 'true'::jsonb AND
    (event_id IS NULL AND (payload ->> 'kind'::text) = 'paid-confirmation'::text AND (payload - ARRAY['kind'::text, 'title'::text, 'body'::text, 'bookingReference'::text,
    'detailsPath'::text,
    'linkLabel'::text,
    'fictional'::text]) = '{}'::jsonb OR event_id IS
    NOT NULL AND ((payload ->> 'kind'::text) = ANY (ARRAY['cancelled'::text, 'refund_requested'::text, 'refund_returned'::text, 'refund_attention'::text])) AND payload ?
    'allocation'::text AND
    (payload - ARRAY['kind'::text, 'title'::text, 'body'::text, 'bookingReference'::text, 'detailsPath'::text, 'linkLabel'::text, 'fictional'::text, 'allocation'::text]) =
    '{}'::jsonb OR event_id IS NOT NULL AND (payload ->> 'kind'::text) = 'preparation_reminder'::text AND payload ?& ARRAY['dueAt'::text,
    'firstStartsAt'::text] AND
    (payload - ARRAY['kind'::text, 'title'::text, 'body'::text, 'bookingReference'::text, 'detailsPath'::text, 'linkLabel'::text, 'fictional'::text, 'dueAt'::text,
    'firstStartsAt'::text]) = '{}'::jsonb));

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_event_kind_check
    CHECK (event_kind = ANY (ARRAY['cancelled'::text, 'refund_requested'::text, 'refund_returned'::text, 'refund_attention'::text, 'preparation_reminder'::text]));

ALTER TABLE public.booking_notification_events
  ADD COLUMN due_at timestamp with time zone;

ALTER TABLE public.booking_notification_events
  ADD COLUMN first_starts_at timestamp with time zone;

ALTER TABLE public.booking_notification_events
  ADD CONSTRAINT booking_notification_events_check CHECK (event_kind = 'cancelled'::text AND cancellation_id IS
    NOT NULL AND refund_intent_id IS NULL AND due_at IS NULL AND first_starts_at IS NULL OR
    (event_kind = ANY (ARRAY['refund_requested'::text, 'refund_returned'::text, 'refund_attention'::text])) AND cancellation_id IS NULL AND refund_intent_id IS
    NOT NULL AND due_at IS NULL AND first_starts_at IS NULL OR event_kind = 'preparation_reminder'::text AND cancellation_id IS NULL AND refund_intent_id IS NULL AND
    first_starts_at IS NOT NULL AND due_at = (first_starts_at - '24:00:00'::interval));

CREATE UNIQUE INDEX booking_notification_events_preparation_receipt_idx ON public.booking_notification_events (receipt_id)
  WHERE event_kind = 'preparation_reminder'::text;
-- Data backfill is migration-only: preserve this block when regenerating schema DDL.
-- Existing future paid stays need intents, including stays already inside 24 hours.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.booking_confirmations confirmation
    JOIN public.booking_requests request ON request.id=confirmation.booking_request_id
    JOIN public.cottage_booking_period_commitments commitment ON commitment.id=confirmation.booking_period_commitment_id
    WHERE commitment.status='confirmed_booking' AND lower(range_merge(commitment.access_ranges))>clock_timestamp()
      AND public.booking_request_payment_status(request)='paid-confirmed'
      AND NOT EXISTS(SELECT 1 FROM public.booking_cancellations WHERE booking_request_id=request.id)
      AND NOT EXISTS(SELECT 1 FROM public.booking_lifecycle_outcomes WHERE booking_request_id=request.id)
      AND NOT EXISTS(SELECT 1 FROM public.booking_incidents WHERE booking_request_id=request.id)
      AND NOT EXISTS(SELECT 1 FROM public.booking_request_confirmation_invalidations WHERE booking_request_id=request.id)
      AND NOT EXISTS(SELECT 1 FROM public.booking_request_payment_required_expiry_work WHERE booking_request_id=request.id AND state='quarantined')
      AND (SELECT count(*) FROM public.booking_receipts WHERE booking_confirmation_id=confirmation.id)<>2
  ) THEN RAISE EXCEPTION 'Preparation reminder backfill found incomplete receipt cardinality' USING ERRCODE='RC409'; END IF;

  INSERT INTO public.booking_notification_events(booking_request_id,receipt_id,event_kind,recipient_user_id,recipient_role,notice_locale,due_at,first_starts_at,created_at)
  SELECT request.id,receipt.id,'preparation_reminder',receipt.recipient_user_id,receipt.recipient_role,snapshot.acceptance_locale,
    lower(range_merge(commitment.access_ranges))-interval '24 hours',lower(range_merge(commitment.access_ranges)),clock_timestamp()
  FROM public.booking_confirmations confirmation
  JOIN public.booking_requests request ON request.id=confirmation.booking_request_id
  JOIN public.booking_snapshots snapshot ON snapshot.id=confirmation.booking_snapshot_id
  JOIN public.cottage_booking_period_commitments commitment ON commitment.id=confirmation.booking_period_commitment_id
  JOIN public.booking_receipts receipt ON receipt.booking_confirmation_id=confirmation.id
  WHERE commitment.status='confirmed_booking' AND lower(range_merge(commitment.access_ranges))>clock_timestamp()
    AND public.booking_request_payment_status(request)='paid-confirmed'
    AND NOT EXISTS(SELECT 1 FROM public.booking_cancellations WHERE booking_request_id=request.id)
    AND NOT EXISTS(SELECT 1 FROM public.booking_lifecycle_outcomes WHERE booking_request_id=request.id)
    AND NOT EXISTS(SELECT 1 FROM public.booking_incidents WHERE booking_request_id=request.id)
    AND NOT EXISTS(SELECT 1 FROM public.booking_request_confirmation_invalidations WHERE booking_request_id=request.id)
    AND NOT EXISTS(SELECT 1 FROM public.booking_request_payment_required_expiry_work WHERE booking_request_id=request.id AND state='quarantined')
  ON CONFLICT(receipt_id) WHERE event_kind='preparation_reminder' DO NOTHING;
END $$;
