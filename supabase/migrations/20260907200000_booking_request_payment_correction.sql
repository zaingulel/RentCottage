-- Payment Required correction keeps money evidence and confirmation history immutable.
alter table public.booking_request_payment_required_expiry_work
  drop constraint booking_request_payment_required_expiry_work_state_check,
  add constraint booking_request_payment_required_expiry_work_state_check check (state in ('processing','attention_required','quarantined','complete')),
  add column quarantined_at timestamptz,
  add column quarantine_reason text,
  add constraint payment_quarantine_shape check (
    (state='quarantined' and quarantined_at is not null and quarantine_reason is not null and length(btrim(quarantine_reason)) between 1 and 120)
    or (state<>'quarantined' and quarantined_at is null and quarantine_reason is null));
alter table public.booking_request_payment_required_expiry_operations
  add column operation_kind text not null default 'release' check (operation_kind in ('release','refund')),
  add column capture_provider_operation_id uuid unique references public.simulated_payment_provider_operations(id) on delete restrict,
  add column capture_occurred_at timestamptz,
  add constraint expiry_corrective_capture_binding check (
    (operation_kind='release' and capture_provider_operation_id is null and capture_occurred_at is null)
    or (operation_kind='refund' and capture_provider_operation_id is not null and capture_occurred_at is not null and owner='expiry'));
alter table public.simulated_payment_provider_operations
  drop constraint simulated_payment_provider_operations_operation_kind_check,
  add constraint simulated_payment_provider_operations_operation_kind_check check (operation_kind in ('authorization','capture','release','refund'));

create table public.booking_request_payment_correction_observations (
  id uuid primary key default gen_random_uuid(),
  booking_request_id uuid not null references public.booking_requests(id) on delete restrict,
  provider_operation_id uuid not null references public.simulated_payment_provider_operations(id) on delete restrict,
  receipt_identity text not null check (length(receipt_identity) between 1 and 200),
  payload jsonb not null,
  conflict boolean not null,
  received_at timestamptz not null default clock_timestamp(),
  unique (provider_operation_id,receipt_identity,payload)
);
create table public.booking_request_confirmation_invalidations (
  booking_request_id uuid primary key references public.booking_requests(id) on delete restrict,
  confirmation_id uuid not null unique references public.booking_confirmations(id) on delete restrict,
  expiry_work_id uuid not null references public.booking_request_payment_required_expiry_work(id) on delete restrict,
  provider_operation_id uuid not null references public.simulated_payment_provider_operations(id) on delete restrict,
  reason text not null check (reason in ('late-capture','conflicting-evidence','unresolved-evidence')),
  invalidated_at timestamptz not null default clock_timestamp()
);
alter table public.booking_request_payment_correction_observations enable row level security;
alter table public.booking_request_confirmation_invalidations enable row level security;
revoke all on public.booking_request_payment_correction_observations,public.booking_request_confirmation_invalidations from public,anon,authenticated,service_role;
create trigger reject_payment_correction_observation_change before update or delete on public.booking_request_payment_correction_observations
for each row execute function public.reject_booking_confirmation_change();
create trigger reject_booking_confirmation_invalidation_change before update or delete on public.booking_request_confirmation_invalidations
for each row execute function public.reject_booking_confirmation_change();


create or replace function public.reject_booking_request_payment_required_expiry_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'booking_request_payment_required_expiry_work' then
    if old.id is distinct from new.id
      or old.booking_request_id is distinct from new.booking_request_id
      or old.payment_required_deadline is distinct from new.payment_required_deadline
      or old.created_at is distinct from new.created_at
      or (old.state = 'complete' and new.state <> 'quarantined')
      or old.quarantined_at is not null
      or (old.state,new.state) not in (
        ('processing','processing'),('processing','attention_required'),
        ('attention_required','attention_required'),('attention_required','processing'),
        ('processing','complete'),('attention_required','complete'),
        ('processing','quarantined'),('attention_required','quarantined'),('complete','quarantined')
      ) then
      raise exception 'Payment Required expiry work is immutable' using errcode='RC204';
    end if;
  elsif old is distinct from new and not (
    old.owner='expiry' and old.provider_operation_id is null and new.provider_operation_id is not null
    and to_jsonb(old)-'provider_operation_id'=to_jsonb(new)-'provider_operation_id'
  ) then
    raise exception 'Payment Required expiry operation is immutable' using errcode='RC204';
  end if;
  if tg_table_name = 'booking_request_payment_required_expiry_work' then
    if new.state='quarantined' then
      new.quarantined_at := clock_timestamp(); new.quarantine_reason := new.diagnostic_reason;
      new.completed_at := null;
    elsif new.quarantined_at is not null or new.quarantine_reason is not null then
      raise exception 'Quarantine identity is invalid' using errcode='RC204';
    end if;
  end if;
  return new;
end;
$$;

create function public.booking_request_payment_quarantined(target_booking_request_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.booking_requests requests where requests.id=target_booking_request_id for update of requests;
  return exists(select 1 from public.booking_request_payment_required_expiry_work expiry
    where expiry.booking_request_id=target_booking_request_id and expiry.state='quarantined');
end;
$$;
revoke all on function public.booking_request_payment_quarantined(uuid) from public,anon,authenticated,service_role;

create function public.invalidate_booking_request_payment_confirmation(target_booking_request_id uuid,target_provider_operation_id uuid,target_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare request public.booking_requests;
declare confirmation public.booking_confirmations;
declare expiry public.booking_request_payment_required_expiry_work;
begin
  select * into request from public.booking_requests requests where requests.id=target_booking_request_id for update of requests;
  select * into confirmation from public.booking_confirmations confirmations where confirmations.booking_request_id=request.id;
  if confirmation.id is null then return; end if;
  select * into expiry from public.booking_request_payment_required_expiry_work work where work.booking_request_id=request.id;
  insert into public.booking_request_confirmation_invalidations(booking_request_id,confirmation_id,expiry_work_id,provider_operation_id,reason)
    values(request.id,confirmation.id,expiry.id,target_provider_operation_id,target_reason) on conflict do nothing;
  update public.cottage_booking_period_commitments set status='pending_hold'
    where id=request.booking_period_commitment_id and status='confirmed_booking';
end;
$$;
revoke all on function public.invalidate_booking_request_payment_confirmation(uuid,uuid,text) from public,anon,authenticated,service_role;

create function public.quarantine_booking_request_payment(target_booking_request_id uuid,target_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare work public.booking_request_capture_work;
declare capture_id uuid;
begin
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  select * into work from public.booking_request_capture_work capture where capture.booking_request_id=target_booking_request_id for update of capture;
  if work.payment_required_deadline is null then raise exception 'Payment Required quarantine source is invalid' using errcode='RC409'; end if;
  insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline)
    values(target_booking_request_id,work.payment_required_deadline) on conflict do nothing;
  update public.booking_request_payment_required_expiry_work set state='quarantined',diagnostic_reason=target_reason,last_evaluated_at=clock_timestamp()
    where booking_request_id=target_booking_request_id;
  select ledger.id into capture_id from public.simulated_payment_provider_operations ledger
    where ledger.claim_id=work.authorization_claim_id and ledger.operation_kind='capture' order by exists(select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id=target_booking_request_id and confirmations.capture_operation_id=ledger.id) desc,ledger.created_at desc,ledger.id limit 1;
  if capture_id is not null then perform public.invalidate_booking_request_payment_confirmation(target_booking_request_id,capture_id,'conflicting-evidence'); end if;
  return jsonb_build_object('status','quarantined');
end;
$$;
revoke all on function public.quarantine_booking_request_payment(uuid,text) from public,anon,authenticated,service_role;


create or replace function public.enforce_cottage_booking_period_commitment_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create function public.observe_booking_request_payment_correction(target_booking_request_id uuid,target_provider_operation_id uuid,target_receipt jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare work public.booking_request_capture_work;
declare ledger public.simulated_payment_provider_operations;
declare expected jsonb;
declare conflicting boolean;
declare observed_at timestamptz;
declare receipt_id uuid;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Payment observation unavailable' using errcode='42501'; end if;
  perform 1 from public.booking_requests requests where requests.id=target_booking_request_id for update of requests;
  select * into work from public.booking_request_capture_work capture where capture.booking_request_id=target_booking_request_id for update of capture;
  select * into ledger from public.simulated_payment_provider_operations operations where operations.id=target_provider_operation_id for update of operations;
  if work.payment_required_deadline is null or ledger.id is null or ledger.operation_kind not in ('capture','release','refund')
    or ledger.claim_id is distinct from work.authorization_claim_id then raise exception 'Payment observation source is invalid' using errcode='RC409'; end if;
  if target_receipt is null or jsonb_typeof(target_receipt)<>'object'
    or target_receipt ?& array['receiptId','bookingRequestId','providerOperationId','providerIdentity','paymentLifecycleId','logicalOperationId','physicalAttemptId','kind','amountFils','currency','providerRequestId','providerReference','movementReference','outcome','occurredAt'] is not true
    or target_receipt-array['receiptId','bookingRequestId','providerOperationId','providerIdentity','paymentLifecycleId','logicalOperationId','physicalAttemptId','kind','amountFils','currency','providerRequestId','providerReference','movementReference','outcome','occurredAt']<>'{}'
    or jsonb_typeof(target_receipt->'receiptId')<>'string' or length(target_receipt->>'receiptId') not between 1 and 200 then
    return public.quarantine_booking_request_payment(target_booking_request_id,'malformed-provider-observation'); end if;
  if exists(select 1 from public.booking_request_payment_correction_observations observations
    where observations.provider_operation_id=ledger.id and observations.receipt_identity=target_receipt->>'receiptId' and observations.payload=target_receipt) then
    return jsonb_build_object('status','duplicate'); end if;
  expected := jsonb_build_object('bookingRequestId',target_booking_request_id,'providerOperationId',ledger.id,
    'providerIdentity',jsonb_build_object('provider',ledger.provider,'environment',ledger.environment,'merchantId',ledger.merchant_id,'terminalId',ledger.terminal_id),
    'paymentLifecycleId',ledger.payment_lifecycle_id,'logicalOperationId',ledger.logical_operation_id,'physicalAttemptId',ledger.physical_attempt_id,
    'kind',ledger.operation_kind,'amountFils',ledger.amount_fils,'currency',ledger.currency,'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference);
  conflicting := (ledger.claim_generation,ledger.amount_fils,ledger.currency,ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id)
      is distinct from (work.authorization_claim_generation,work.amount_fils,work.currency,work.provider,work.environment,work.merchant_id,work.terminal_id)
    or target_receipt-array['receiptId','movementReference','outcome','occurredAt'] is distinct from expected
    or target_receipt->>'outcome' not in ('succeeded','failed','indeterminate')
    or jsonb_typeof(target_receipt->'outcome') is distinct from 'string'
    or (ledger.current_outcome<>'indeterminate' and target_receipt->>'outcome' is distinct from ledger.current_outcome)
    or (target_receipt->>'outcome'<>'failed' and target_receipt->>'movementReference' is distinct from ledger.movement_reference)
    or (target_receipt->>'outcome'='failed' and target_receipt->'movementReference' is distinct from 'null'::jsonb)
    or exists(select 1 from public.booking_request_payment_correction_observations observations where observations.provider_operation_id=ledger.id
      and (observations.receipt_identity=target_receipt->>'receiptId' or observations.payload-'receiptId' is distinct from target_receipt-'receiptId'));
  begin
    observed_at := (target_receipt->>'occurredAt')::timestamptz;
    if (target_receipt->>'outcome'='indeterminate') is distinct from (observed_at is null)
      or not isfinite(observed_at) or observed_at > clock_timestamp()
      or (ledger.authoritative_outcome_at is not null and ledger.authoritative_outcome_at is distinct from observed_at)
      then conflicting := true; end if;
  exception when invalid_datetime_format or datetime_field_overflow then conflicting:=true; end;
  insert into public.booking_request_payment_correction_observations(booking_request_id,provider_operation_id,receipt_identity,payload,conflict)
    values(target_booking_request_id,ledger.id,target_receipt->>'receiptId',target_receipt,coalesce(conflicting,true)) returning id into receipt_id;
  if conflicting is not false then return public.quarantine_booking_request_payment(target_booking_request_id,'conflicting-provider-observation'); end if;
  if target_receipt->>'outcome'='indeterminate' then return public.quarantine_booking_request_payment(target_booking_request_id,'unresolved-provider-observation'); end if;
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  if ledger.current_outcome='indeterminate' and target_receipt->>'outcome'<>'indeterminate' then
    update public.simulated_payment_provider_operations set current_outcome=target_receipt->>'outcome',authoritative_outcome_at=observed_at,
      movement_reference=target_receipt->>'movementReference',updated_at=clock_timestamp() where id=ledger.id returning * into ledger;
    update public.booking_request_payment_recovery_operations set outcome=ledger.current_outcome,authoritative_outcome_at=observed_at,updated_at=clock_timestamp()
      where provider_operation_id=ledger.id;
    if ledger.recovery_attempt_id is not null then perform public.record_booking_request_recovery_outcome(ledger.recovery_attempt_id,
      (select operations.step from public.booking_request_payment_recovery_operations operations where operations.provider_operation_id=ledger.id),ledger,work.payment_required_deadline); end if;
  end if;
  if ledger.operation_kind='capture' and ledger.current_outcome='succeeded' and observed_at >= work.payment_required_deadline then
    insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline)
      values(work.booking_request_id,work.payment_required_deadline) on conflict do nothing;
    perform public.invalidate_booking_request_payment_confirmation(work.booking_request_id,ledger.id,'late-capture');
  end if;
  return jsonb_build_object('status','recorded');
end;
$$;

revoke all on function public.observe_booking_request_payment_correction(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.observe_booking_request_payment_correction(uuid,uuid,jsonb) to service_role;


create function public.prepare_booking_request_corrective_refund(target_booking_request_id uuid,target_capture_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare source record;
declare expiry public.booking_request_payment_required_expiry_work;
declare capture public.simulated_payment_provider_operations;
declare authorization_ledger public.simulated_payment_provider_operations;
declare recovery public.booking_request_payment_recovery_attempts;
declare logical_id text;
declare authorization_logical text;
declare authorization_physical text;
declare predecessor text;
declare predecessor_at timestamptz;
begin
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  select * into expiry from public.booking_request_payment_required_expiry_work work where work.booking_request_id=target_booking_request_id for update of work;
  select * into capture from public.simulated_payment_provider_operations ledger where ledger.id=target_capture_id for update of ledger;
  if capture.operation_kind is distinct from 'capture' or capture.current_outcome is distinct from 'succeeded'
    or capture.authoritative_outcome_at is null or capture.authoritative_outcome_at < (source.work).payment_required_deadline
    or capture.original_outcome='failed' or capture.amount_fils<>(source.work).amount_fils
    or capture.currency<>(source.work).currency or capture.claim_id<>(source.work).authorization_claim_id
    or capture.physical_execution_count<>1 or capture.movement_reference is null then
    raise exception 'Corrective capture evidence is invalid' using errcode='RC409'; end if;
  if capture.payment_lifecycle_id=(source.work).payment_lifecycle_id then
    authorization_logical := (source.work).authorization_logical_operation_id;
    authorization_physical := (source.work).authorization_physical_attempt_id;
    predecessor := source.payment_snapshot#>>'{authorization,movementReference}';
    predecessor_at := (source.payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz;
  else
    select * into recovery from public.booking_request_payment_recovery_attempts attempts where attempts.id=capture.recovery_attempt_id and attempts.booking_request_id=target_booking_request_id;
    select ledger.* into authorization_ledger from public.booking_request_payment_recovery_operations operations
      join public.simulated_payment_provider_operations ledger on ledger.id=operations.provider_operation_id
      where operations.recovery_attempt_id=recovery.id and operations.step='replacement-authorization';
    if authorization_ledger.current_outcome is distinct from 'succeeded' or authorization_ledger.authoritative_outcome_at is null then
      raise exception 'Corrective authorization evidence is invalid' using errcode='RC409'; end if;
    authorization_logical:=authorization_ledger.logical_operation_id; authorization_physical:=authorization_ledger.physical_attempt_id;
    predecessor:=authorization_ledger.movement_reference; predecessor_at:=authorization_ledger.authoritative_outcome_at;
  end if;
  logical_id:=expiry.id::text||':corrective-refund:'||capture.id::text;
  insert into public.booking_request_payment_required_expiry_operations(
    expiry_work_id,booking_request_id,owner,authorization_claim_id,authorization_claim_generation,authorization_payment_lifecycle_id,
    authorization_logical_operation_id,authorization_physical_attempt_id,predecessor_movement_reference,predecessor_outcome_at,
    release_logical_operation_id,release_physical_attempt_id,provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
    request_fingerprint,operation_kind,capture_provider_operation_id,capture_occurred_at)
  values(expiry.id,target_booking_request_id,'expiry',(source.work).authorization_claim_id,(source.work).authorization_claim_generation,
    capture.payment_lifecycle_id,authorization_logical,authorization_physical,predecessor,predecessor_at,
    logical_id,logical_id||':1',logical_id||':1',(source.work).amount_fils,(source.work).currency,(source.work).provider,(source.work).environment,
    (source.work).merchant_id,(source.work).terminal_id,(source.work).request_fingerprint,'refund',capture.id,capture.authoritative_outcome_at)
    on conflict do nothing;
  if not exists(select 1 from public.booking_request_payment_required_expiry_operations operations
    where operations.expiry_work_id=expiry.id and operations.capture_provider_operation_id=capture.id and operations.operation_kind='refund') then
    raise exception 'Captured authorization has conflicting release ownership' using errcode='RC409'; end if;
  perform public.invalidate_booking_request_payment_confirmation(target_booking_request_id,capture.id,'late-capture');
end;
$$;
revoke all on function public.prepare_booking_request_corrective_refund(uuid,uuid) from public,anon,authenticated,service_role;


create or replace function public.booking_request_payment_required_expiry_permit(
  target public.booking_request_payment_required_expiry_operations,
  deadline timestamptz
)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when target.operation_kind='refund' then jsonb_build_object(
    'purpose','booking-request-payment-required-corrective-refund','expiryWorkId',target.expiry_work_id,
    'expiryOperationId',target.id,'idempotencyKey',target.provider_idempotency_key,
    'notBefore',to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'binding',jsonb_build_object('bookingRequestId',target.booking_request_id,'captureProviderOperationId',target.capture_provider_operation_id,
      'paymentLifecycleId',target.authorization_payment_lifecycle_id,
      'captureLogicalOperationId',(select ledger.logical_operation_id from public.simulated_payment_provider_operations ledger where ledger.id=target.capture_provider_operation_id),
      'capturePhysicalAttemptId',(select ledger.physical_attempt_id from public.simulated_payment_provider_operations ledger where ledger.id=target.capture_provider_operation_id),
      'captureMovementReference',(select ledger.movement_reference from public.simulated_payment_provider_operations ledger where ledger.id=target.capture_provider_operation_id),
      'captureOccurredAt',to_char(target.capture_occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'refundLogicalOperationId',target.release_logical_operation_id,'refundPhysicalAttemptId',target.release_physical_attempt_id,
      'amountFils',target.amount_fils,'currency',target.currency,'providerIdentity',jsonb_build_object('provider',target.provider,
        'environment',target.environment,'merchantId',target.merchant_id,'terminalId',target.terminal_id)))
  else jsonb_build_object(
    'purpose','booking-request-payment-required-expiry','expiryWorkId',target.expiry_work_id,
    'expiryOperationId',target.id,'idempotencyKey',target.provider_idempotency_key,
    'notBefore',to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'binding',jsonb_build_object(
      'bookingRequestId',target.booking_request_id,
      'authorizationClaimId',target.authorization_claim_id,
      'authorizationClaimGeneration',target.authorization_claim_generation,
      'authorizationPaymentLifecycleId',target.authorization_payment_lifecycle_id,
      'authorizationLogicalOperationId',target.authorization_logical_operation_id,
      'authorizationPhysicalAttemptId',target.authorization_physical_attempt_id,
      'predecessorMovementReference',target.predecessor_movement_reference,
      'predecessorOutcomeAt',to_char(target.predecessor_outcome_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'releaseLogicalOperationId',target.release_logical_operation_id,
      'releasePhysicalAttemptId',target.release_physical_attempt_id,
      'amountFils',target.amount_fils,'currency',target.currency,
      'requestFingerprint',target.request_fingerprint,
      'providerIdentity',jsonb_build_object('provider',target.provider,'environment',target.environment,
        'merchantId',target.merchant_id,'terminalId',target.terminal_id))) end;
$$;

create or replace function public.validate_booking_request_payment_required_expiry_target(
  target public.booking_request_payment_required_expiry_operations,
  work public.booking_request_capture_work,payment_snapshot jsonb
)
returns public.simulated_payment_provider_operations
language plpgsql security definer set search_path = '' as $$
declare capture_evidence public.simulated_payment_provider_operations;
declare authorization_evidence public.simulated_payment_provider_operations;
declare ledger public.simulated_payment_provider_operations;
declare recovery public.booking_request_payment_recovery_attempts;
declare operation public.booking_request_payment_recovery_operations;
declare predecessor text;
declare predecessor_time timestamptz;
declare logical_identity text;
declare physical_identity text;
declare release_identity text;
begin
  if target.authorization_payment_lifecycle_id=work.payment_lifecycle_id then
    predecessor := payment_snapshot#>>'{authorization,movementReference}';
    predecessor_time := (payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz;
    logical_identity := work.authorization_logical_operation_id;
    physical_identity := work.authorization_physical_attempt_id;
    release_identity := target.expiry_work_id::text||':original-release';
  else
    select * into recovery from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=target.authorization_payment_lifecycle_id
        and attempts.booking_request_id=work.booking_request_id;
    select * into operation from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=recovery.id and operations.step='replacement-authorization';
    authorization_evidence := public.validate_booking_request_recovery_operation(operation,
      public.booking_request_recovery_execution_permit(recovery,work,payment_snapshot,'replacement-authorization'));
    if authorization_evidence.current_outcome is distinct from 'succeeded' then
      raise exception 'Expiry authorisation is invalid' using errcode='RC409'; end if;
    predecessor := authorization_evidence.movement_reference;
    predecessor_time := authorization_evidence.authoritative_outcome_at;
    logical_identity := authorization_evidence.logical_operation_id;
    physical_identity := authorization_evidence.physical_attempt_id;
    release_identity := target.expiry_work_id::text||':replacement-release:'||recovery.generation::text;
  end if;
  if (target.booking_request_id,target.authorization_claim_id,target.authorization_claim_generation,
      target.authorization_logical_operation_id,target.authorization_physical_attempt_id,
      target.predecessor_movement_reference,target.predecessor_outcome_at,
      target.amount_fils,target.currency,target.provider,target.environment,target.merchant_id,target.terminal_id,
      target.request_fingerprint) is distinct from
    (work.booking_request_id,work.authorization_claim_id,work.authorization_claim_generation,
      logical_identity,physical_identity,predecessor,predecessor_time,
      work.amount_fils,work.currency,work.provider,work.environment,work.merchant_id,work.terminal_id,
      work.request_fingerprint)
    or predecessor is null or predecessor_time is null
    or not exists(select 1 from public.booking_request_payment_required_expiry_work expiry
      where expiry.id=target.expiry_work_id and expiry.booking_request_id=work.booking_request_id
        and expiry.payment_required_deadline=work.payment_required_deadline) then
    raise exception 'Expiry release target is invalid' using errcode='RC409'; end if;
  if target.operation_kind='refund' then
    select * into capture_evidence from public.simulated_payment_provider_operations operations where operations.id=target.capture_provider_operation_id for update of operations;
    if capture_evidence.current_outcome is distinct from 'succeeded' or capture_evidence.original_outcome='failed'
      or capture_evidence.operation_kind is distinct from 'capture' or capture_evidence.movement_reference is null
      or capture_evidence.authoritative_outcome_at is distinct from target.capture_occurred_at
      or target.capture_occurred_at < work.payment_required_deadline
      or (capture_evidence.payment_lifecycle_id,capture_evidence.claim_id,capture_evidence.claim_generation,capture_evidence.amount_fils,
          capture_evidence.currency,capture_evidence.provider,capture_evidence.environment,capture_evidence.merchant_id,capture_evidence.terminal_id)
        is distinct from (target.authorization_payment_lifecycle_id,target.authorization_claim_id,target.authorization_claim_generation,target.amount_fils,
          target.currency,target.provider,target.environment,target.merchant_id,target.terminal_id)
      or capture_evidence.physical_execution_count<>1 then raise exception 'Corrective refund capture is invalid' using errcode='RC409'; end if;
    release_identity:=target.expiry_work_id::text||':corrective-refund:'||capture_evidence.id::text;
  end if;
  if target.owner='recovery' then
    select * into operation from public.booking_request_payment_recovery_operations operations
      where operations.id=target.recovery_operation_id;
    select * into recovery from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=operation.recovery_attempt_id and attempts.booking_request_id=work.booking_request_id;
    if operation.step is distinct from (case when target.authorization_payment_lifecycle_id=work.payment_lifecycle_id
      then 'original-release' else 'replacement-release' end) then
      raise exception 'Expiry recovery release is invalid' using errcode='RC409'; end if;
    ledger := public.validate_booking_request_recovery_operation(operation,
      public.booking_request_recovery_execution_permit(recovery,work,payment_snapshot,operation.step));
  else
    if target.release_logical_operation_id is distinct from release_identity
      or target.release_physical_attempt_id is distinct from release_identity||':1'
      or target.provider_idempotency_key is distinct from release_identity||':1'
      or target.recovery_operation_id is not null then
      raise exception 'Expiry release identity is invalid' using errcode='RC409'; end if;
    if target.provider_operation_id is null then return null; end if;
    select * into ledger from public.simulated_payment_provider_operations operations
      where operations.id=target.provider_operation_id for update of operations;
    if ledger.recovery_attempt_id is not null or ledger.capture_execution_permit is not null
      or ledger.created_at < work.payment_required_deadline then
      raise exception 'Expiry provider ownership is invalid' using errcode='RC409'; end if;
  end if;
  if ledger.id is null or ledger.id is distinct from target.provider_operation_id
    or (ledger.operation_kind,ledger.claim_id,ledger.claim_generation,ledger.payment_lifecycle_id,
      ledger.logical_operation_id,ledger.physical_attempt_id,ledger.provider_idempotency_key,
      ledger.amount_fils,ledger.currency,ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,
      ledger.request_fingerprint) is distinct from
    (target.operation_kind,target.authorization_claim_id,target.authorization_claim_generation,target.authorization_payment_lifecycle_id,
      target.release_logical_operation_id,target.release_physical_attempt_id,target.provider_idempotency_key,
      target.amount_fils,target.currency,target.provider,target.environment,target.merchant_id,target.terminal_id,
      target.request_fingerprint)
    or ledger.physical_execution_count <> 1
    or (ledger.original_outcome <> 'indeterminate' and ledger.current_outcome <> ledger.original_outcome)
    or (ledger.current_outcome='indeterminate') is distinct from (ledger.authoritative_outcome_at is null)
    or (ledger.current_outcome='failed') is distinct from (ledger.movement_reference is null)
    or ledger.authoritative_outcome_at < ledger.created_at
    or ledger.created_at < predecessor_time then
    raise exception 'Expiry provider evidence is invalid' using errcode='RC409'; end if;
  return ledger;
end;
$$;

create or replace function public.prepare_booking_request_payment_required_expiry(
  target_booking_request_id uuid,target_provider_identity jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare expiry public.booking_request_payment_required_expiry_work;
declare recovery record;
declare recovery_attempt public.booking_request_payment_recovery_attempts;
declare release_operation public.booking_request_payment_recovery_operations;
declare release_ledger public.simulated_payment_provider_operations;
declare authorization_ledger public.simulated_payment_provider_operations;
declare expected_permit jsonb;
declare unresolved_reason text;
declare target public.booking_request_payment_required_expiry_operations;
declare instruction jsonb;
declare request public.booking_requests;
declare capture_work public.booking_request_capture_work;
declare captured record;
declare capture_id uuid;
begin
  if current_setting('role',true) <> 'service_role' or target_booking_request_id is null then
    raise exception 'Payment Required expiry preparation is unavailable' using errcode='42501';
  end if;
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  if public.booking_request_payment_required_expiry_completed(target_booking_request_id) then
    return jsonb_build_object('status','expired','bookingRequestId',target_booking_request_id);
  end if;
  select * into request from public.booking_requests requests where requests.id=target_booking_request_id;
  select * into capture_work from public.booking_request_capture_work work where work.booking_request_id=target_booking_request_id;
  if request.status is distinct from 'accepted' or capture_work.state is distinct from 'payment_required'
    or public.booking_request_payment_required_expiry_provider_matches(capture_work,target_provider_identity) is not true then
    raise exception 'Payment Required expiry source is invalid' using errcode='RC409'; end if;
  begin
    select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  exception when sqlstate 'RC409' or invalid_text_representation or numeric_value_out_of_range then
    if clock_timestamp() < capture_work.payment_required_deadline then
      return jsonb_build_object('status','not-due'); end if;
    insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline,
      state,diagnostic_reason) values(target_booking_request_id,capture_work.payment_required_deadline,
        'attention_required','source-evidence-invalid')
      on conflict(booking_request_id) do update set state='attention_required',
        diagnostic_reason='source-evidence-invalid',last_evaluated_at=clock_timestamp();
    return public.quarantine_booking_request_payment(target_booking_request_id,'source-evidence-invalid');
  end;
  if not found or (source.work).state <> 'payment_required'
    or not public.booking_request_payment_required_expiry_provider_matches(source.work,target_provider_identity) then
    raise exception 'Payment Required expiry source is invalid' using errcode='RC409';
  end if;
  for captured in select ledger.* from public.simulated_payment_provider_operations ledger
    where ledger.claim_id=(source.work).authorization_claim_id and ledger.operation_kind='capture' and ledger.current_outcome='succeeded'
    order by ledger.created_at,ledger.id
  loop
    if captured.authoritative_outcome_at is null then
      return public.quarantine_booking_request_payment(target_booking_request_id,'capture-occurrence-unknown');
    elsif captured.authoritative_outcome_at >= (source.work).payment_required_deadline then
      insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline)
        values(target_booking_request_id,(source.work).payment_required_deadline) on conflict do nothing;
      perform public.invalidate_booking_request_payment_confirmation(target_booking_request_id,captured.id,'late-capture');
    end if;
  end loop;
  if exists(select 1 from public.booking_confirmations confirmations
    where confirmations.booking_request_id=target_booking_request_id and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=target_booking_request_id)) then
    return jsonb_build_object('status','confirmed');
  end if;
  if clock_timestamp() < (source.work).payment_required_deadline then
    return jsonb_build_object('status','not-due','deadline',
      to_char((source.work).payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;
  insert into public.booking_request_payment_required_expiry_work(
    booking_request_id,payment_required_deadline
  ) values(target_booking_request_id,(source.work).payment_required_deadline)
  on conflict(booking_request_id) do nothing;
  select * into expiry from public.booking_request_payment_required_expiry_work work
    where work.booking_request_id=target_booking_request_id for update of work;
  if expiry.payment_required_deadline is distinct from (source.work).payment_required_deadline then
    raise exception 'Payment Required expiry deadline binding is invalid' using errcode='RC409';
  end if;
  if expiry.state='complete' then
    return jsonb_build_object('status','expired','expiryWorkId',expiry.id);
  end if;

  if (source.ledger).current_outcome='succeeded' and (source.ledger).original_outcome<>'failed'
    and (source.ledger).authoritative_outcome_at >= (source.work).payment_required_deadline then
    perform public.prepare_booking_request_corrective_refund(target_booking_request_id,(source.ledger).id);
  elsif (source.ledger).id is null or (source.ledger).operation_kind <> 'capture'
    or (source.ledger).current_outcome <> 'failed'
    or (source.ledger).movement_reference is not null
    or (source.ledger).original_outcome <> 'failed' then
    unresolved_reason := 'original-capture-unresolved';
  end if;

  if unresolved_reason is null then
    for recovery in
      select attempts as attempt,operations as operation
      from public.booking_request_payment_recovery_attempts attempts
      join public.booking_request_payment_recovery_operations operations
        on operations.recovery_attempt_id=attempts.id
      where attempts.booking_request_id=target_booking_request_id
      order by attempts.generation,
        case operations.step when 'original-release' then 1
          when 'replacement-authorization' then 2 when 'replacement-capture' then 3 else 4 end
    loop
      begin
        expected_permit := public.booking_request_recovery_execution_permit(
          recovery.attempt,source.work,source.payment_snapshot,(recovery.operation).step
        );
        perform public.validate_booking_request_recovery_operation(
          recovery.operation,expected_permit
        );
      exception when sqlstate 'RC409' then
        unresolved_reason := 'recovery-evidence-invalid';
      end;
      exit when unresolved_reason is not null;
    end loop;
  end if;

  if unresolved_reason is null and exists(
    select 1
    from public.simulated_payment_provider_operations ledger
    join public.booking_request_payment_recovery_attempts attempts
      on attempts.id=ledger.recovery_attempt_id
    where attempts.booking_request_id=target_booking_request_id
      and not exists(
        select 1 from public.booking_request_payment_recovery_operations operations
        where operations.provider_operation_id=ledger.id
          and operations.recovery_attempt_id=attempts.id
      )
  ) then unresolved_reason := 'unexplained-recovery-provider-operation'; end if;

  if unresolved_reason is null and exists(
    select 1 from public.booking_request_payment_recovery_operations operations
    join public.booking_request_payment_recovery_attempts attempts
      on attempts.id=operations.recovery_attempt_id
    where attempts.booking_request_id=target_booking_request_id
      and operations.step in ('replacement-authorization','replacement-capture')
      and operations.outcome='indeterminate'
  ) then unresolved_reason := 'recovery-operation-indeterminate'; end if;

  if unresolved_reason is null then
    for captured in select ledger.* from public.booking_request_payment_recovery_operations operations
      join public.booking_request_payment_recovery_attempts attempts on attempts.id=operations.recovery_attempt_id
      join public.simulated_payment_provider_operations ledger on ledger.id=operations.provider_operation_id
      where attempts.booking_request_id=target_booking_request_id and operations.step='replacement-capture' and ledger.current_outcome='succeeded'
      order by attempts.generation,ledger.id
    loop
      if captured.authoritative_outcome_at is null then unresolved_reason:='capture-occurrence-unknown'; exit;
      elsif captured.authoritative_outcome_at < (source.work).payment_required_deadline then
        return jsonb_build_object('status','processing');
      else
        begin perform public.prepare_booking_request_corrective_refund(target_booking_request_id,captured.id);
        exception when sqlstate 'RC409' then unresolved_reason:='corrective-capture-invalid'; end;
      end if;
    end loop;
  end if;

  if unresolved_reason is null and exists(
    select 1 from public.simulated_payment_provider_operations ledger
    where (ledger.claim_id=(source.work).authorization_claim_id
      or ledger.payment_lifecycle_id=(source.work).payment_lifecycle_id
      or exists(select 1 from public.booking_request_payment_recovery_attempts attempts
        where attempts.booking_request_id=target_booking_request_id and attempts.id=ledger.payment_lifecycle_id))
      and ledger.id is distinct from (source.ledger).id
      and not exists(select 1 from public.booking_request_payment_recovery_operations operations
        join public.booking_request_payment_recovery_attempts attempts on attempts.id=operations.recovery_attempt_id
        where attempts.booking_request_id=target_booking_request_id and operations.provider_operation_id=ledger.id)
      and ledger.operation_kind in ('authorization','capture','release','refund','settlement')
      and not exists(select 1 from public.booking_request_payment_required_expiry_operations owned
        where owned.expiry_work_id=expiry.id and owned.provider_operation_id=ledger.id)
      and not (ledger.operation_kind='authorization'
        and (ledger.payment_lifecycle_id,ledger.logical_operation_id,ledger.physical_attempt_id,
          ledger.provider,ledger.environment,ledger.merchant_id,ledger.terminal_id,
          ledger.amount_fils,ledger.currency,ledger.provider_request_id,ledger.provider_reference,ledger.movement_reference)
          is not distinct from
        ((source.work).payment_lifecycle_id,(source.work).authorization_logical_operation_id,
          (source.work).authorization_physical_attempt_id,(source.work).provider,(source.work).environment,
          (source.work).merchant_id,(source.work).terminal_id,(source.work).amount_fils,(source.work).currency,
          source.payment_snapshot#>>'{authorization,providerRequestId}',
          source.payment_snapshot#>>'{authorization,providerReference}',
          source.payment_snapshot#>>'{authorization,movementReference}')
        and ledger.current_outcome='succeeded' and ledger.original_outcome in ('succeeded','indeterminate')
        and ledger.physical_execution_count=1)
  ) then unresolved_reason := 'unexplained-provider-operation'; end if;

  if unresolved_reason is null and not exists(select 1 from public.booking_request_payment_required_expiry_operations owned
    where owned.expiry_work_id=expiry.id and owned.authorization_payment_lifecycle_id=(source.work).payment_lifecycle_id and owned.operation_kind='refund') then
    select operations.* into release_operation
    from public.booking_request_payment_recovery_operations operations
    join public.booking_request_payment_recovery_attempts attempts
      on attempts.id=operations.recovery_attempt_id
    where attempts.booking_request_id=target_booking_request_id
      and operations.step='original-release'
    order by attempts.generation limit 1;
    if release_operation.id is not null then
      select * into recovery_attempt
      from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=release_operation.recovery_attempt_id;
      expected_permit := public.booking_request_recovery_execution_permit(
        recovery_attempt,source.work,source.payment_snapshot,'original-release'
      );
      release_ledger := public.validate_booking_request_recovery_operation(
        release_operation,expected_permit
      );
      insert into public.booking_request_payment_required_expiry_operations(
        expiry_work_id,booking_request_id,owner,recovery_operation_id,provider_operation_id,
        authorization_claim_id,authorization_claim_generation,
        authorization_payment_lifecycle_id,authorization_logical_operation_id,
        authorization_physical_attempt_id,predecessor_movement_reference,
        predecessor_outcome_at,release_logical_operation_id,release_physical_attempt_id,
        provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
        request_fingerprint
      ) values(expiry.id,target_booking_request_id,'recovery',release_operation.id,release_ledger.id,
        (source.work).authorization_claim_id,(source.work).authorization_claim_generation,
        (source.work).payment_lifecycle_id,(source.work).authorization_logical_operation_id,
        (source.work).authorization_physical_attempt_id,
        source.payment_snapshot#>>'{authorization,movementReference}',
        (source.payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz,
        release_ledger.logical_operation_id,release_ledger.physical_attempt_id,
        release_ledger.provider_idempotency_key,(source.work).amount_fils,(source.work).currency,
        (source.work).provider,(source.work).environment,(source.work).merchant_id,
        (source.work).terminal_id,(source.work).request_fingerprint)
      on conflict do nothing;
      if release_ledger.current_outcome <> 'succeeded' then
        unresolved_reason := case when release_ledger.current_outcome='indeterminate'
          then 'original-release-indeterminate' else 'original-release-failed' end;
      end if;
    else
      insert into public.booking_request_payment_required_expiry_operations(
        expiry_work_id,booking_request_id,owner,
        authorization_claim_id,authorization_claim_generation,
        authorization_payment_lifecycle_id,authorization_logical_operation_id,
        authorization_physical_attempt_id,predecessor_movement_reference,
        predecessor_outcome_at,release_logical_operation_id,release_physical_attempt_id,
        provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
        request_fingerprint
      ) values(
        expiry.id,target_booking_request_id,'expiry',(source.work).authorization_claim_id,
        (source.work).authorization_claim_generation,(source.work).payment_lifecycle_id,
        (source.work).authorization_logical_operation_id,(source.work).authorization_physical_attempt_id,
        source.payment_snapshot#>>'{authorization,movementReference}',
        (source.payment_snapshot#>>'{movements,0,recordedAt}')::timestamptz,
        expiry.id::text||':original-release',expiry.id::text||':original-release:1',
        expiry.id::text||':original-release:1',(source.work).amount_fils,(source.work).currency,
        (source.work).provider,(source.work).environment,(source.work).merchant_id,(source.work).terminal_id,
        (source.work).request_fingerprint
      ) on conflict do nothing;
    end if;
  end if;

  if unresolved_reason is null then
    for recovery in
      select attempts as attempt,operations as operation
      from public.booking_request_payment_recovery_attempts attempts
      join public.booking_request_payment_recovery_operations operations
        on operations.recovery_attempt_id=attempts.id
      where attempts.booking_request_id=target_booking_request_id
        and operations.step='replacement-authorization'
        and operations.outcome='succeeded'
        and not exists(select 1 from public.booking_request_payment_required_expiry_operations owned where owned.expiry_work_id=expiry.id and owned.authorization_payment_lifecycle_id=attempts.id and owned.operation_kind='refund')
      order by attempts.generation
    loop
      expected_permit := public.booking_request_recovery_execution_permit(
        recovery.attempt,source.work,source.payment_snapshot,'replacement-authorization'
      );
      authorization_ledger := public.validate_booking_request_recovery_operation(
        recovery.operation,expected_permit
      );
      if authorization_ledger.current_outcome <> 'succeeded' then
        unresolved_reason := 'replacement-authorization-invalid';
        exit;
      end if;
      select operations.* into release_operation
      from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=(recovery.attempt).id
        and operations.step='replacement-release';
      if release_operation.id is not null then
        expected_permit := public.booking_request_recovery_execution_permit(
          recovery.attempt,source.work,source.payment_snapshot,'replacement-release'
        );
        release_ledger := public.validate_booking_request_recovery_operation(
          release_operation,expected_permit
        );
        insert into public.booking_request_payment_required_expiry_operations(
          expiry_work_id,booking_request_id,owner,recovery_operation_id,provider_operation_id,
          authorization_claim_id,authorization_claim_generation,
          authorization_payment_lifecycle_id,authorization_logical_operation_id,
          authorization_physical_attempt_id,predecessor_movement_reference,
          predecessor_outcome_at,release_logical_operation_id,release_physical_attempt_id,
          provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
          request_fingerprint
        ) values(expiry.id,target_booking_request_id,'recovery',release_operation.id,release_ledger.id,
          authorization_ledger.claim_id,authorization_ledger.claim_generation,
          authorization_ledger.payment_lifecycle_id,authorization_ledger.logical_operation_id,
          authorization_ledger.physical_attempt_id,authorization_ledger.movement_reference,
          authorization_ledger.authoritative_outcome_at,release_ledger.logical_operation_id,
          release_ledger.physical_attempt_id,release_ledger.provider_idempotency_key,
          authorization_ledger.amount_fils,authorization_ledger.currency,
          authorization_ledger.provider,authorization_ledger.environment,
          authorization_ledger.merchant_id,authorization_ledger.terminal_id,
          authorization_ledger.request_fingerprint)
        on conflict do nothing;
        if release_ledger.current_outcome <> 'succeeded' then
          unresolved_reason := case when release_ledger.current_outcome='indeterminate'
            then 'replacement-release-indeterminate' else 'replacement-release-failed' end;
          exit;
        end if;
      else
        insert into public.booking_request_payment_required_expiry_operations(
          expiry_work_id,booking_request_id,owner,
          authorization_claim_id,authorization_claim_generation,
          authorization_payment_lifecycle_id,authorization_logical_operation_id,
          authorization_physical_attempt_id,predecessor_movement_reference,
          predecessor_outcome_at,release_logical_operation_id,release_physical_attempt_id,
          provider_idempotency_key,amount_fils,currency,provider,environment,merchant_id,terminal_id,
          request_fingerprint
        ) values(expiry.id,target_booking_request_id,'expiry',authorization_ledger.claim_id,
          authorization_ledger.claim_generation,authorization_ledger.payment_lifecycle_id,
          authorization_ledger.logical_operation_id,authorization_ledger.physical_attempt_id,
          authorization_ledger.movement_reference,authorization_ledger.authoritative_outcome_at,
          expiry.id::text||':replacement-release:'||(recovery.attempt).generation::text,
          expiry.id::text||':replacement-release:'||(recovery.attempt).generation::text||':1',
          expiry.id::text||':replacement-release:'||(recovery.attempt).generation::text||':1',
          authorization_ledger.amount_fils,authorization_ledger.currency,
          authorization_ledger.provider,authorization_ledger.environment,
          authorization_ledger.merchant_id,authorization_ledger.terminal_id,
          authorization_ledger.request_fingerprint)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  if unresolved_reason is null then
    for target in select operations.* from public.booking_request_payment_required_expiry_operations operations
      where operations.expiry_work_id=expiry.id order by operations.created_at,operations.id
    loop
      begin
        release_ledger := public.validate_booking_request_payment_required_expiry_target(target,source.work,source.payment_snapshot);
      exception when sqlstate 'RC409' then unresolved_reason := 'expiry-evidence-invalid'; end;
      exit when unresolved_reason is not null;
      if release_ledger.id is null then
        if instruction is null then
          expected_permit := public.booking_request_payment_required_expiry_permit(target,expiry.payment_required_deadline);
          instruction := jsonb_build_object('status',case target.operation_kind when 'refund' then 'refund' else 'release' end,'permit',expected_permit,'binding',expected_permit->'binding');
        end if;
      elsif release_ledger.current_outcome='failed' then
        unresolved_reason := 'expiry-release-failed'; exit;
      elsif release_ledger.current_outcome='indeterminate' then
        unresolved_reason := 'expiry-release-indeterminate';
        exit;
      end if;
    end loop;
  end if;
  if unresolved_reason is not null then
    return public.quarantine_booking_request_payment(target_booking_request_id,unresolved_reason);
  end if;
  update public.booking_request_payment_required_expiry_work set state='processing',diagnostic_reason=null,last_evaluated_at=clock_timestamp()
    where id=expiry.id;
  return coalesce(instruction,jsonb_build_object('status','ready'));

end;
$$;

create or replace function public.execute_simulated_booking_request_payment_required_expiry(target_permit jsonb,target_outcome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare target public.booking_request_payment_required_expiry_operations;
declare ledger public.simulated_payment_provider_operations;
declare expected jsonb;
declare prepared jsonb;
declare operation_id uuid := gen_random_uuid();
declare outcome_time timestamptz;
begin
  if current_setting('role',true) <> 'service_role' or target_outcome is null
    or target_outcome not in ('succeeded','failed','indeterminate') then
    raise exception 'Expiry execution is unavailable' using errcode='42501'; end if;
  if public.booking_request_payment_quarantined((target_permit#>>'{binding,bookingRequestId}')::uuid) then return jsonb_build_object('outcome','not-executed'); end if;
  select * into source from public.lock_booking_request_payment_required_expiry_source((target_permit#>>'{binding,bookingRequestId}')::uuid);
  select * into target from public.booking_request_payment_required_expiry_operations operations
    where operations.id=(target_permit->>'expiryOperationId')::uuid
      and operations.expiry_work_id=(source.expiry).id for update of operations;
  expected := public.booking_request_payment_required_expiry_permit(target,(source.expiry).payment_required_deadline);
  if target.id is null or target.owner <> 'expiry' or target_permit is distinct from expected then
    raise exception 'Expiry permit is invalid' using errcode='RC409'; end if;
  ledger := public.validate_booking_request_payment_required_expiry_target(target,source.work,source.payment_snapshot);
  if ledger.id is null then
    if (source.expiry).state='complete' or clock_timestamp() < (source.work).payment_required_deadline then
      return jsonb_build_object('outcome','not-executed'); end if;
    prepared := public.prepare_booking_request_payment_required_expiry((source.work).booking_request_id,
      expected#>'{binding,providerIdentity}');
    if prepared->>'status' not in ('release','refund') or prepared->'permit' is distinct from expected then
      return jsonb_build_object('outcome','not-executed'); end if;
    outcome_time := clock_timestamp();
    if outcome_time < (source.work).payment_required_deadline then
      return jsonb_build_object('outcome','not-executed'); end if;
    insert into public.simulated_payment_provider_operations(
      id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
      provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,physical_attempt_id,
      amount_fils,currency,original_outcome,current_outcome,provider_request_id,provider_reference,
      movement_reference,authoritative_outcome_at,created_at,updated_at
    ) values(operation_id,target.authorization_claim_id,target.authorization_claim_generation,target.operation_kind,
      target.provider,target.environment,target.merchant_id,target.terminal_id,target.provider_idempotency_key,
      target.request_fingerprint,target.authorization_payment_lifecycle_id,target.release_logical_operation_id,
      target.release_physical_attempt_id,target.amount_fils,target.currency,target_outcome,target_outcome,
      'sim-expiry-request-'||operation_id,'sim-expiry-reference-'||operation_id,
      case when target_outcome='failed' then null else 'sim-expiry-movement-'||operation_id end,
      case when target_outcome='indeterminate' then null else outcome_time end,outcome_time,outcome_time)
      returning * into ledger;
    update public.booking_request_payment_required_expiry_operations operations set provider_operation_id=ledger.id
      where operations.id=target.id;
  end if;
  if ledger.current_outcome<>'succeeded' then perform public.quarantine_booking_request_payment((source.work).booking_request_id,'expiry-'||target.operation_kind||'-'||ledger.current_outcome); end if;
  return jsonb_strip_nulls(jsonb_build_object('outcome',ledger.current_outcome,
    'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
    'movementReference',ledger.movement_reference,'retrySafe',false));
end;
$$;

create or replace function public.query_simulated_booking_request_payment_required_expiry(
  target_permit jsonb,target_provider_request_id text,target_provider_reference text,target_outcome text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare target public.booking_request_payment_required_expiry_operations;
declare ledger public.simulated_payment_provider_operations;
declare expected jsonb;
declare outcome_time timestamptz;
begin
  if current_setting('role',true) <> 'service_role' or target_outcome is null
    or target_outcome not in ('succeeded','failed','indeterminate') then
    raise exception 'Expiry query is unavailable' using errcode='42501'; end if;
  if public.booking_request_payment_quarantined((target_permit#>>'{binding,bookingRequestId}')::uuid) then return jsonb_build_object('outcome','not-executed'); end if;
  select * into source from public.lock_booking_request_payment_required_expiry_source((target_permit#>>'{binding,bookingRequestId}')::uuid);
  select * into target from public.booking_request_payment_required_expiry_operations operations
    where operations.id=(target_permit->>'expiryOperationId')::uuid
      and operations.expiry_work_id=(source.expiry).id for update of operations;
  expected := public.booking_request_payment_required_expiry_permit(target,(source.expiry).payment_required_deadline);
  if target.id is null or target.owner <> 'expiry' or target_permit is distinct from expected then
    raise exception 'Expiry query binding is invalid' using errcode='RC409'; end if;
  ledger := public.validate_booking_request_payment_required_expiry_target(target,source.work,source.payment_snapshot);
  if ledger.id is null or ledger.provider_request_id is distinct from target_provider_request_id
    or ledger.provider_reference is distinct from target_provider_reference then
    raise exception 'Expiry query binding is invalid' using errcode='RC409'; end if;
  if ledger.current_outcome='indeterminate' and target_outcome <> 'indeterminate' then
    if (source.expiry).state='complete' then raise exception 'Completed expiry evidence is invalid' using errcode='RC409'; end if;
    outcome_time := clock_timestamp();
    update public.simulated_payment_provider_operations operations set current_outcome=target_outcome,
      authoritative_outcome_at=outcome_time,updated_at=outcome_time,
      movement_reference=case when target_outcome='failed' then null else ledger.movement_reference end
      where operations.id=ledger.id returning * into ledger;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('outcome',ledger.current_outcome,
    'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
    'movementReference',ledger.movement_reference,'retrySafe',false));
end;
$$;

create or replace function public.finalize_booking_request_payment_required_expiry(target_booking_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare request public.booking_requests;
declare work public.booking_request_capture_work;
declare claim public.booking_request_authorization_claims;
declare commitment public.cottage_booking_period_commitments;
declare snapshot public.booking_snapshots;
declare attempt public.booking_request_submission_attempts;
declare prepared jsonb;
declare finalized_at timestamptz;
begin
  if current_setting('role',true) <> 'service_role' or target_booking_request_id is null then
    raise exception 'Expiry finalization is unavailable' using errcode='42501'; end if;
  if public.booking_request_payment_required_expiry_completed(target_booking_request_id) then
    return jsonb_build_object('status','expired','bookingRequestId',target_booking_request_id); end if;
  select * into work from public.booking_request_capture_work capture_work where capture_work.booking_request_id=target_booking_request_id;
  prepared := public.prepare_booking_request_payment_required_expiry(target_booking_request_id,
    jsonb_build_object('provider',work.provider,'environment',work.environment,'merchantId',work.merchant_id,'terminalId',work.terminal_id));
  if prepared->>'status' <> 'ready' then
    return jsonb_build_object('status',case when prepared->>'status' in ('release','refund') then 'processing'
      when prepared->>'status' in ('reconcile-expiry','reconcile-recovery') then 'attention-required'
      else prepared->>'status' end,'bookingRequestId',target_booking_request_id);
  end if;
  select * into request from public.booking_requests requests where requests.id=target_booking_request_id;
  select * into claim from public.booking_request_authorization_claims claims where claims.id=work.authorization_claim_id;
  select * into attempt from public.booking_request_submission_attempts attempts where attempts.id=work.attempt_id;
  select * into snapshot from public.booking_snapshots snapshots where snapshots.id=request.booking_snapshot_id;
  select * into commitment from public.cottage_booking_period_commitments commitments
    where commitments.id=request.booking_period_commitment_id for update of commitments;
  perform 1 from public.cottage_inventory_commitments inventory where inventory.booking_period_commitment_id=commitment.id
    order by inventory.service_day,inventory.unit_kind,inventory.unit_id for update of inventory;
  perform 1 from public.cottage_booking_period_occupancies occupancies where occupancies.booking_period_commitment_id=commitment.id
    order by occupancies.service_day,occupancies.shift_id for update of occupancies;
  if request.status is distinct from 'accepted' or commitment.status is distinct from 'pending_hold'
    or not attempt.intent_dedupe_active
    or (commitment.customer_user_id,commitment.profile_id,commitment.schedule_revision_id,commitment.access_ranges)
      is distinct from (request.customer_user_id,request.profile_id,claim.schedule_revision_id,claim.access_ranges)
    or (claim.customer_user_id,claim.profile_id) is distinct from (request.customer_user_id,request.profile_id)
    or request.owner_user_id is distinct from (select profiles.owner_user_id from public.owner_application_cottage_profiles profiles where profiles.id=request.profile_id)
    or snapshot.id is null or (snapshot.customer_user_id,snapshot.profile_id,snapshot.quote_fingerprint,snapshot.intent_fingerprint,
      snapshot.quote_payload,snapshot.intent_payload) is distinct from
      (request.customer_user_id,request.profile_id,attempt.quote_fingerprint,attempt.intent_fingerprint,attempt.quote_payload,attempt.intent_payload)
    or not exists(select 1 from public.booking_request_authorization_claim_items items where items.claim_id=claim.id)
    or not exists(select 1 from public.booking_request_authorization_claim_occupancies occupancies where occupancies.claim_id=claim.id)
    or exists(
      (select unit_kind,unit_id,service_day,price_iqd from public.booking_request_authorization_claim_items where claim_id=claim.id
       except select unit_kind,unit_id,service_day,committed_price_iqd from public.cottage_inventory_commitments where booking_period_commitment_id=commitment.id)
      union all
      (select unit_kind,unit_id,service_day,committed_price_iqd from public.cottage_inventory_commitments where booking_period_commitment_id=commitment.id
       except select unit_kind,unit_id,service_day,price_iqd from public.booking_request_authorization_claim_items where claim_id=claim.id)
    )
    or exists(
      (select schedule_revision_id,shift_id,service_day from public.booking_request_authorization_claim_occupancies where claim_id=claim.id
       except select schedule_revision_id,shift_id,service_day from public.cottage_booking_period_occupancies where booking_period_commitment_id=commitment.id and active)
      union all
      (select schedule_revision_id,shift_id,service_day from public.cottage_booking_period_occupancies where booking_period_commitment_id=commitment.id and active
       except select schedule_revision_id,shift_id,service_day from public.booking_request_authorization_claim_occupancies where claim_id=claim.id)
    ) then
    perform public.quarantine_booking_request_payment(request.id,'inventory-evidence-invalid');
    return jsonb_build_object('status','quarantined','bookingRequestId',request.id);
  end if;
  finalized_at := clock_timestamp();
  if finalized_at < work.payment_required_deadline then
    return jsonb_build_object('status','not-due','bookingRequestId',request.id); end if;
  update public.cottage_booking_period_commitments set status='released_hold' where id=commitment.id;
  update public.cottage_booking_period_occupancies set active=false where booking_period_commitment_id=commitment.id and active;
  update public.booking_requests set status='expired',settled_at=finalized_at where id=request.id;
  update public.booking_request_submission_attempts set intent_dedupe_active=false,updated_at=finalized_at where id=attempt.id;
  update public.booking_request_payment_required_expiry_work set state='complete',diagnostic_reason=null,
    completed_at=finalized_at,last_evaluated_at=finalized_at where booking_request_id=request.id;
  insert into public.booking_request_status_notifications(booking_request_id,recipient_user_id,status,created_at)
    values(request.id,request.customer_user_id,'expired',finalized_at),(request.id,request.owner_user_id,'expired',finalized_at)
    on conflict do nothing;
  return jsonb_build_object('status','expired','bookingRequestId',request.id);
end;
$$;

create or replace function public.booking_request_payment_required_expiry_completed(target_booking_request_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare request public.booking_requests;
declare expiry public.booking_request_payment_required_expiry_work;
begin
  select * into request from public.booking_requests requests
    where requests.id=target_booking_request_id for update of requests;
  select * into expiry from public.booking_request_payment_required_expiry_work work
    where work.booking_request_id=target_booking_request_id;
  return request.id is not null and request.status='expired' and expiry.state='complete'
    and request.settled_at=expiry.completed_at
    and exists(select 1 from public.booking_request_capture_work work
      where work.booking_request_id=request.id and work.state='payment_required'
        and work.payment_required_deadline=expiry.payment_required_deadline
        and expiry.completed_at >= work.payment_required_deadline)
    and exists(select 1 from public.cottage_booking_period_commitments commitment
      where commitment.id=request.booking_period_commitment_id and commitment.status='released_hold')
    and not exists(select 1 from public.cottage_booking_period_occupancies occupancy
      where occupancy.booking_period_commitment_id=request.booking_period_commitment_id and occupancy.active)
    and not exists(select 1 from public.booking_confirmations confirmation where confirmation.booking_request_id=request.id and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=request.id));
end;
$$;

create or replace function public.claim_customer_booking_request_payment_recovery(
  target_booking_request_id uuid,
  target_command_key uuid,
  target_replacement_method text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
declare request public.booking_requests;
declare work public.booking_request_capture_work;
declare existing public.booking_request_payment_recovery_attempts;
declare created public.booking_request_payment_recovery_attempts;
declare next_generation integer;
declare initial_state text;
begin
  if actor is null or target_booking_request_id is null or target_command_key is null
    or target_replacement_method <> 'simulated-replacement'
    or not exists (select 1 from public.account_contexts contexts
      where contexts.user_id = actor and contexts.role = 'customer') then
    raise exception 'Booking Request payment recovery is unavailable' using errcode = 'RC404';
  end if;

  select * into request from public.booking_requests requests
  where requests.id = target_booking_request_id
    and requests.customer_user_id = actor
  for update of requests;
  if request.id is null then
    raise exception 'Booking Request payment recovery is unavailable' using errcode = 'RC404';
  end if;

  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined','bookingRequestId',target_booking_request_id); end if;
  select * into work from public.booking_request_capture_work capture_work
  where capture_work.booking_request_id = request.id
  for update of capture_work;

  select * into existing from public.booking_request_payment_recovery_attempts attempts
  where attempts.booking_request_id = request.id
    and attempts.command_key = target_command_key;
  if existing.id is not null then
    return jsonb_build_object('status', case when existing.state = 'safely_failed' then 'retryable'
      when existing.state in ('succeeded','late_succeeded') then replace(existing.state,'_','-') else 'processing' end,
      'attemptId', existing.id, 'deadline', to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;

  if request.status <> 'accepted' or work.booking_request_id is null
    or work.state <> 'payment_required'
    or exists (select 1 from public.booking_confirmations confirmations
      where confirmations.booking_request_id = request.id)
    or exists (select 1 from public.booking_request_payment_required_expiry_work expiry
      where expiry.booking_request_id=request.id)
    or clock_timestamp() >= work.payment_required_deadline then
    raise exception 'Booking Request payment recovery is unavailable' using errcode = 'RC409';
  end if;
  if exists (select 1 from public.booking_request_payment_recovery_attempts attempts
    where attempts.booking_request_id = request.id
      and attempts.state not in ('safely_failed')) then
    raise exception 'Booking Request payment recovery is already processing' using errcode = 'RC409';
  end if;

  select coalesce(max(attempts.generation), 0) + 1 into next_generation
  from public.booking_request_payment_recovery_attempts attempts
  where attempts.booking_request_id = request.id;
  initial_state := case when exists (
    select 1 from public.booking_request_payment_recovery_operations operations
    join public.booking_request_payment_recovery_attempts attempts
      on attempts.id = operations.recovery_attempt_id
    where attempts.booking_request_id = request.id
      and operations.step = 'original-release' and operations.outcome = 'succeeded'
  ) then 'original_released' else 'admitted' end;
  insert into public.booking_request_payment_recovery_attempts(
    booking_request_id, command_key, generation, replacement_method, state
  ) values (request.id, target_command_key, next_generation,
    target_replacement_method, initial_state)
  returning * into created;
  return jsonb_build_object('status','processing','attemptId',created.id,
    'deadline',to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;

create or replace function public.lease_booking_request_payment_recovery_step(target_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare attempt public.booking_request_payment_recovery_attempts;
declare previous public.booking_request_payment_recovery_operations;
declare ledger public.simulated_payment_provider_operations;
declare step text;
declare permit jsonb;
begin
  if public.booking_request_payment_quarantined((select attempts.booking_request_id from public.booking_request_payment_recovery_attempts attempts where attempts.id=target_attempt_id)) then return jsonb_build_object('status','quarantined'); end if;
  if current_setting('role',true) <> 'service_role' then
    raise exception 'Recovery processing is unavailable' using errcode='42501'; end if;
  if public.booking_request_payment_required_expiry_completed((
    select attempts.booking_request_id from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=target_attempt_id
  )) then return jsonb_build_object('status','deadline-elapsed'); end if;
  select * into source from public.lock_booking_request_payment_recovery_source(target_attempt_id);
  attempt := source.attempt;
  if attempt.state='blocked' then
    select * into previous from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=attempt.id and operations.outcome='indeterminate';
    if previous.id is null then return jsonb_build_object('status','blocked'); end if;
    permit := public.booking_request_recovery_execution_permit(attempt,source.work,source.payment_snapshot,previous.step);
    ledger := public.validate_booking_request_recovery_operation(previous,permit);
    return jsonb_build_object('status','reconcile','permit',permit,'binding',permit->'binding',
      'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference);
  end if;
  if attempt.state in ('safely_failed','succeeded','late_succeeded') then
    return jsonb_build_object('status',case when attempt.state='safely_failed' then 'retryable'
      else replace(attempt.state,'_','-') end);
  end if;
  step := case attempt.state when 'admitted' then 'original-release'
    when 'original_released' then 'replacement-authorization'
    when 'replacement_authorized' then 'replacement-capture'
    when 'capture_failed' then 'replacement-release' end;
  permit := public.booking_request_recovery_execution_permit(attempt,source.work,source.payment_snapshot,step);
  if exists(
    select 1 from public.booking_request_payment_required_expiry_operations expiry_operations
    where expiry_operations.booking_request_id=attempt.booking_request_id
      and expiry_operations.owner='expiry'
      and expiry_operations.authorization_payment_lifecycle_id=
        (permit#>>'{binding,paymentLifecycleId}')::uuid
      and expiry_operations.predecessor_movement_reference=
        permit#>>'{binding,predecessorMovementReference}'
  ) then return jsonb_build_object('status','deadline-elapsed'); end if;
  -- Check the clock after every source, recovery and expiry-ownership lock.
  if step <> 'replacement-release' and clock_timestamp() >= (source.work).payment_required_deadline then
    return jsonb_build_object('status','deadline-elapsed'); end if;
  return jsonb_build_object('status','leased','permit',permit,'binding',permit->'binding');
end;
$$;

create or replace function public.execute_simulated_booking_request_payment_recovery(
  target_permit jsonb,target_outcome text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare work public.booking_request_capture_work;
declare attempt public.booking_request_payment_recovery_attempts;
declare previous public.booking_request_payment_recovery_operations;
declare ledger public.simulated_payment_provider_operations;
declare expected jsonb;
declare dispatched jsonb;
declare operation_id uuid := gen_random_uuid();
declare outcome_time timestamptz;
declare recovery_step text := target_permit->>'step';
begin
  if public.booking_request_payment_quarantined((target_permit#>>'{binding,bookingRequestId}')::uuid) then return jsonb_build_object('outcome','not-executed'); end if;
  if current_setting('role',true) <> 'service_role'
    or target_outcome is null or target_outcome not in ('succeeded','failed','indeterminate') then
    raise exception 'Recovery execution is unavailable' using errcode='42501'; end if;
  if public.booking_request_payment_required_expiry_completed((
    select attempts.booking_request_id from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=(target_permit->>'attemptId')::uuid
  )) then
    select * into attempt from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=(target_permit->>'attemptId')::uuid;
    select * into source from public.lock_booking_request_payment_required_expiry_source(attempt.booking_request_id);
    work := source.work;
    expected := public.booking_request_recovery_execution_permit(attempt,work,source.payment_snapshot,recovery_step);
    if target_permit is distinct from expected then raise exception 'Recovery permit is invalid' using errcode='RC409'; end if;
    select * into previous from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=attempt.id and operations.step=recovery_step;
    if previous.id is null then return jsonb_build_object('outcome','not-executed'); end if;
    ledger := public.validate_booking_request_recovery_operation(previous,expected);
    if ledger.current_outcome='indeterminate' then raise exception 'Completed expiry evidence is invalid' using errcode='RC409'; end if;
    return jsonb_strip_nulls(jsonb_build_object('outcome',ledger.current_outcome,
      'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
      'movementReference',ledger.movement_reference,'retrySafe',attempt.state='safely_failed'));
  end if;
  select * into source from public.lock_booking_request_payment_recovery_source((target_permit->>'attemptId')::uuid);
  work := source.work; attempt := source.attempt;
  expected := public.booking_request_recovery_execution_permit(attempt,work,source.payment_snapshot,recovery_step);
  if target_permit is distinct from expected then
    raise exception 'Recovery permit is invalid' using errcode='RC409'; end if;
  select * into previous from public.booking_request_payment_recovery_operations operations
    where operations.recovery_attempt_id=attempt.id and operations.step=recovery_step;
  if previous.id is not null then
    ledger := public.validate_booking_request_recovery_operation(previous,expected);
    return jsonb_strip_nulls(jsonb_build_object('outcome',ledger.current_outcome,
      'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
      'movementReference',ledger.movement_reference,'retrySafe',attempt.state='safely_failed'));
  end if;
  -- Revalidate ownership and the deadline while still holding the request-first source lock.
  if exists(
    select 1 from public.booking_request_payment_required_expiry_operations expiry_operations
    where expiry_operations.booking_request_id=attempt.booking_request_id
      and expiry_operations.owner='expiry'
      and expiry_operations.authorization_payment_lifecycle_id=
        (expected#>>'{binding,paymentLifecycleId}')::uuid
      and expiry_operations.predecessor_movement_reference=
        expected#>>'{binding,predecessorMovementReference}'
  ) or (recovery_step <> 'replacement-release' and clock_timestamp() >= work.payment_required_deadline) then
    return jsonb_build_object('outcome','not-executed');
  end if;
  dispatched := public.lease_booking_request_payment_recovery_step(attempt.id);
  if dispatched->>'status' <> 'leased' or dispatched->'permit' is distinct from expected then
    return jsonb_build_object('outcome','not-executed'); end if;
  outcome_time := clock_timestamp();
  if recovery_step <> 'replacement-release' and outcome_time >= work.payment_required_deadline then
    return jsonb_build_object('outcome','not-executed'); end if;
  insert into public.simulated_payment_provider_operations(
    id,claim_id,claim_generation,operation_kind,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,payment_lifecycle_id,logical_operation_id,
    physical_attempt_id,amount_fils,currency,original_outcome,current_outcome,
    provider_request_id,provider_reference,movement_reference,recovery_attempt_id,
    authoritative_outcome_at,capture_execution_permit,created_at,updated_at
  ) values(operation_id,work.authorization_claim_id,work.authorization_claim_generation,
    case recovery_step when 'replacement-authorization' then 'authorization' when 'replacement-capture' then 'capture' else 'release' end,
    work.provider,work.environment,work.merchant_id,work.terminal_id,expected->>'idempotencyKey',work.request_fingerprint,
    (expected#>>'{binding,paymentLifecycleId}')::uuid,expected->>'operationId',expected#>>'{binding,physicalAttemptId}',
    work.amount_fils,work.currency,target_outcome,target_outcome,'sim-recovery-request-'||operation_id,
    'sim-recovery-reference-'||operation_id,case when target_outcome='failed' then null else 'sim-recovery-movement-'||operation_id end,
    attempt.id,case when target_outcome='indeterminate' then null else outcome_time end,
    case when recovery_step='replacement-capture' then expected end,outcome_time,outcome_time) returning * into ledger;
  insert into public.booking_request_payment_recovery_operations(recovery_attempt_id,step,provider_operation_id,
    outcome,authoritative_outcome_at,execution_permit)
  values(attempt.id,recovery_step,ledger.id,ledger.current_outcome,ledger.authoritative_outcome_at,expected);
  return public.record_booking_request_recovery_outcome(attempt.id,recovery_step,ledger,work.payment_required_deadline);
end;
$$;

create or replace function public.query_simulated_booking_request_payment_recovery(
  target_permit jsonb,target_provider_request_id text,target_provider_reference text,target_outcome text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare previous public.booking_request_payment_recovery_operations;
declare ledger public.simulated_payment_provider_operations;
declare expected jsonb;
declare outcome_time timestamptz;
declare request_id uuid;
declare replay_attempt public.booking_request_payment_recovery_attempts;
declare replay_source record;
begin
  if public.booking_request_payment_quarantined((target_permit#>>'{binding,bookingRequestId}')::uuid) then return jsonb_build_object('outcome','not-executed'); end if;
  if current_setting('role',true) <> 'service_role' or target_outcome is null
    or target_outcome not in ('succeeded','failed','indeterminate') then
    raise exception 'Recovery query is unavailable' using errcode='42501'; end if;
  select attempts.booking_request_id into request_id from public.booking_request_payment_recovery_attempts attempts
    where attempts.id=(target_permit->>'attemptId')::uuid;
  if public.booking_request_payment_required_expiry_completed(request_id) then
    select * into replay_source from public.lock_booking_request_payment_required_expiry_source(request_id);
    select * into replay_attempt from public.booking_request_payment_recovery_attempts attempts
      where attempts.id=(target_permit->>'attemptId')::uuid for update of attempts;
    expected := public.booking_request_recovery_execution_permit(replay_attempt,replay_source.work,
      replay_source.payment_snapshot,target_permit->>'step');
    select * into previous from public.booking_request_payment_recovery_operations operations
      where operations.recovery_attempt_id=replay_attempt.id and operations.step=target_permit->>'step';
    ledger := public.validate_booking_request_recovery_operation(previous,expected);
    if target_permit is distinct from expected or ledger.current_outcome='indeterminate'
      or ledger.provider_request_id is distinct from target_provider_request_id
      or ledger.provider_reference is distinct from target_provider_reference then
      raise exception 'Recovery query binding is invalid' using errcode='RC409'; end if;
    return jsonb_strip_nulls(jsonb_build_object('outcome',ledger.current_outcome,
      'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
      'movementReference',ledger.movement_reference,'retrySafe',replay_attempt.state='safely_failed'));
  end if;
  select * into source from public.lock_booking_request_payment_recovery_source((target_permit->>'attemptId')::uuid);
  expected := public.booking_request_recovery_execution_permit(source.attempt,source.work,source.payment_snapshot,target_permit->>'step');
  select * into previous from public.booking_request_payment_recovery_operations operations
    where operations.recovery_attempt_id=(source.attempt).id and operations.step=target_permit->>'step';
  ledger := public.validate_booking_request_recovery_operation(previous,expected);
  if target_permit is distinct from expected
    or ledger.provider_request_id is distinct from target_provider_request_id
    or ledger.provider_reference is distinct from target_provider_reference then
    raise exception 'Recovery query binding is invalid' using errcode='RC409'; end if;
  if ledger.current_outcome='indeterminate' and target_outcome <> 'indeterminate' then
    -- This simulator resolves a new provider event now. Delayed provider events use observe_booking_request_payment_correction with their occurrence time.
    outcome_time := clock_timestamp();
    update public.simulated_payment_provider_operations operations set current_outcome=target_outcome,
      authoritative_outcome_at=outcome_time,updated_at=outcome_time,
      movement_reference=case when target_outcome='failed' then null else ledger.movement_reference end
      where operations.id=ledger.id returning * into ledger;
    update public.booking_request_payment_recovery_operations operations set outcome=ledger.current_outcome,
      authoritative_outcome_at=ledger.authoritative_outcome_at,updated_at=outcome_time where operations.id=previous.id;
    return public.record_booking_request_recovery_outcome((source.attempt).id,previous.step,ledger,(source.work).payment_required_deadline);
  end if;
  update public.booking_request_payment_recovery_attempts attempts set updated_at=clock_timestamp()
    where attempts.id=(source.attempt).id and attempts.state='blocked' and ledger.current_outcome='indeterminate';
  return jsonb_strip_nulls(jsonb_build_object('outcome',ledger.current_outcome,
    'providerRequestId',ledger.provider_request_id,'providerReference',ledger.provider_reference,
    'movementReference',ledger.movement_reference,'retrySafe',(source.attempt).state='safely_failed'));
end;
$$;

create or replace function public.complete_booking_request_capture(
  target_booking_request_id uuid, target_lease_generation bigint,
  target_lease_token uuid, target_provider_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.simulated_payment_provider_operations;
declare capture_identity public.booking_request_provider_operation_identities;
declare expected_permit jsonb;
declare expected_result jsonb;
declare capture_operation jsonb;
declare capture_movement jsonb;
declare movements jsonb;
declare captured_at text;
declare finalized_at timestamptz;
begin
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  if not found then raise exception 'Booking Request capture work is unavailable' using errcode = 'RC409'; end if;
  work := source.work;
  ledger := source.ledger;
  if ledger.id is null then raise exception 'Booking Request capture provider evidence is missing' using errcode = 'RC409'; end if;
  if ledger.original_outcome is distinct from 'succeeded'
    or ledger.current_outcome is distinct from 'succeeded'
    or ledger.movement_reference is null then
    raise exception 'Booking Request successful Capture evidence is invalid' using errcode = 'RC409';
  end if;
  expected_result := jsonb_build_object('outcome', 'succeeded',
    'providerRequestId', ledger.provider_request_id, 'providerReference', ledger.provider_reference,
    'movementReference', ledger.movement_reference);
  if not (
    (work.state = 'complete' and target_lease_generation is null and target_lease_token is null and target_provider_result is null)
    or (target_lease_generation is not null and target_lease_token is not null
      and target_lease_generation = work.lease_generation
      and (
        (work.recovery_operation_id is null
          and target_lease_generation = (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint
          and target_lease_token::text = ledger.capture_execution_permit ->> 'leaseToken')
        or (work.state = 'processing' and work.recovery_operation_id = ledger.id
          and target_lease_token = work.lease_token
          and work.lease_generation > (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint)
      )
      and target_provider_result is not distinct from expected_result)
  ) then
    raise exception 'Booking Request capture lease or result is invalid' using errcode = 'RC409';
  end if;
  if work.state = 'processing' then
    expected_permit := source.binding || jsonb_build_object(
      'purpose', 'booking-request-capture', 'workId', work.booking_request_id,
      'leaseGeneration', work.lease_generation, 'leaseToken', work.lease_token,
      'notAfter', to_char(work.lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
    if work.recovery_operation_id is null and ledger.capture_execution_permit is distinct from expected_permit then
      raise exception 'Booking Request capture lease is stale' using errcode = 'RC409';
    end if;
  elsif work.state <> 'complete' then
    raise exception 'Booking Request capture work is not processing' using errcode = 'RC409';
  end if;
  if (work.recovery_operation_id is null and (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint is distinct from work.lease_generation)
    or (work.recovery_operation_id is not null and (work.recovery_operation_id <> ledger.id
      or work.lease_generation <= (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint))
    or (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint < 1
    or (ledger.capture_execution_permit ->> 'leaseToken')::uuid is null
    or ledger.created_at >= (ledger.capture_execution_permit ->> 'notAfter')::timestamptz
    or ledger.created_at < (source.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz then
    raise exception 'Booking Request capture occurrence is invalid' using errcode = 'RC409';
  end if;
  captured_at := to_char(ledger.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  capture_operation := jsonb_build_object(
    'paymentLifecycleId', work.payment_lifecycle_id, 'kind', 'capture',
    'logicalOperationId', work.capture_logical_operation_id,
    'attemptId', work.capture_physical_attempt_id, 'status', 'succeeded',
    'amountFils', work.amount_fils, 'providerRequestId', ledger.provider_request_id,
    'providerReference', ledger.provider_reference, 'movementReference', ledger.movement_reference,
    'reconciliationRequired', false, 'retrySafe', false
  );
  capture_movement := jsonb_build_object(
    'kind', 'capture', 'logicalOperationId', work.capture_logical_operation_id,
    'attemptId', work.capture_physical_attempt_id, 'amountFils', work.amount_fils,
    'movementReference', ledger.movement_reference, 'recordedAt', captured_at
  );
  movements := jsonb_build_array(source.payment_snapshot #> '{movements,0}', capture_movement);
  select * into capture_identity from public.booking_request_provider_operation_identities identities
  where identities.attempt_id = work.attempt_id and identities.operation_kind = 'capture'
  for update of identities;
  if work.state = 'complete' then
    if source.payment_snapshot -> 'capture' is distinct from capture_operation
      or source.payment_snapshot -> 'movements' is distinct from movements
      or capture_identity.attempt_id is null
      or (capture_identity.provider, capture_identity.environment, capture_identity.merchant_id,
        capture_identity.terminal_id, capture_identity.provider_request_id,
        capture_identity.provider_reference, capture_identity.movement_reference) is distinct from
        (work.provider, work.environment, work.merchant_id, work.terminal_id,
        ledger.provider_request_id, ledger.provider_reference, ledger.movement_reference) then
      raise exception 'Completed Booking Request capture evidence is invalid' using errcode = 'RC409';
    end if;
  else
    insert into public.booking_request_provider_operation_identities (
      attempt_id, operation_kind, provider, environment, merchant_id, terminal_id,
      provider_request_id, provider_reference, movement_reference
    ) values (work.attempt_id, 'capture', work.provider, work.environment, work.merchant_id,
      work.terminal_id, ledger.provider_request_id, ledger.provider_reference, ledger.movement_reference);
    finalized_at := clock_timestamp();
    -- The existing work trigger validates uncaptured Authorization; both writes commit atomically.
    update public.booking_request_capture_work capture_work
    set state = 'complete', outcome = 'succeeded', completed_at = finalized_at,
      lease_token = null, lease_expires_at = null
    where capture_work.booking_request_id = work.booking_request_id;
    update public.booking_request_submission_attempts attempts
    set payment_snapshot = source.payment_snapshot || jsonb_build_object('capture', capture_operation, 'movements', movements),
      updated_at = finalized_at
    where attempts.id = work.attempt_id;
  end if;
  return jsonb_build_object('status', 'complete',
    'snapshot', source.binding || jsonb_build_object(
      'authorization', source.payment_snapshot -> 'authorization', 'capture', capture_operation, 'movements', movements),
    'expectation', source.binding || jsonb_build_object(
      'authorizationProviderResult', jsonb_build_object(
        'providerRequestId', source.payment_snapshot #>> '{authorization,providerRequestId}',
        'providerReference', source.payment_snapshot #>> '{authorization,providerReference}',
        'movementReference', source.payment_snapshot #>> '{authorization,movementReference}'),
      'captureProviderResult', expected_result - 'outcome',
      'authorizationRecordedAt', source.payment_snapshot #>> '{movements,0,recordedAt}',
      'captureRecordedAt', captured_at)
  );
end;
$$;

create or replace function public.lease_booking_request_capture_work(
  target_booking_request_id uuid, target_provider_identity jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record; declare work public.booking_request_capture_work; declare leased_at timestamptz;
begin
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  select * into source from public.lock_booking_request_capture_source(target_booking_request_id);
  if not found then return jsonb_build_object('status','unavailable'); end if;
  work := source.work;
  if target_provider_identity is distinct from source.binding -> 'providerIdentity' then
    raise exception 'Booking Request capture provider is invalid' using errcode = 'RC409';
  end if;
  if work.state = 'payment_required' then
    return jsonb_build_object('status','payment-required','paymentRequiredWindow',jsonb_build_object(
      'recordedAt',to_char(work.payment_required_recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deadline',to_char(work.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  end if;
  if work.state = 'complete' then return public.complete_booking_request_capture(target_booking_request_id,null,null,null); end if;
  leased_at := date_trunc('milliseconds',clock_timestamp());
  if work.state = 'processing' then
    return jsonb_build_object('status',case when leased_at < work.lease_expires_at then 'processing' else 'expired' end);
  end if;
  update public.booking_request_capture_work capture_work
  set state='processing',lease_generation=1,lease_token=gen_random_uuid(),lease_expires_at=leased_at+interval '30 seconds'
  where capture_work.booking_request_id=work.booking_request_id returning * into work;
  return jsonb_build_object('status','leased','permit',source.binding || jsonb_build_object(
    'purpose','booking-request-capture','workId',work.booking_request_id,'leaseGeneration',work.lease_generation,
    'leaseToken',work.lease_token,'notAfter',to_char(work.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
end;
$$;

create or replace function public.query_simulated_booking_request_capture(
  target_operation jsonb, target_provider_request_id text, target_provider_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare request_id uuid;
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.simulated_payment_provider_operations;
declare expected_operation jsonb;
begin
  if public.booking_request_payment_quarantined((select capture_source.booking_request_id from public.booking_request_capture_work capture_source where capture_source.payment_lifecycle_id=(target_operation->>'paymentLifecycleId')::uuid)) then return jsonb_build_object('outcome','not-executed'); end if;
  select booking_request_id into request_id from public.booking_request_capture_work
  where payment_lifecycle_id::text = target_operation ->> 'paymentLifecycleId';
  select * into source from public.lock_booking_request_capture_source(request_id);
  if not found then raise exception 'Capture query binding is invalid' using errcode = 'RC409'; end if;
  work := source.work;
  ledger := source.ledger;
  expected_operation := jsonb_build_object(
    'providerIdentity', source.binding -> 'providerIdentity', 'requestFingerprint', work.request_fingerprint,
    'paymentLifecycleId', work.payment_lifecycle_id, 'logicalOperationId', work.capture_logical_operation_id,
    'physicalAttemptId', work.capture_physical_attempt_id, 'operationKind', 'capture',
    'amountFils', work.amount_fils, 'currency', work.currency
  );
  if target_operation is distinct from expected_operation or ledger.id is null
    or target_provider_request_id is distinct from ledger.provider_request_id
    or target_provider_reference is distinct from ledger.provider_reference
    or (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint < 1
    or (ledger.capture_execution_permit ->> 'leaseToken')::uuid is null
    or ledger.created_at >= (ledger.capture_execution_permit ->> 'notAfter')::timestamptz
    or ledger.created_at < (source.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz then
    raise exception 'Capture query evidence is invalid' using errcode = 'RC409';
  end if;
  if ledger.original_outcome = 'failed' then
    return jsonb_build_object('outcome', 'failed', 'providerRequestId', ledger.provider_request_id,
      'providerReference', ledger.provider_reference, 'retrySafe', false);
  end if;
  return jsonb_build_object('outcome', 'succeeded', 'providerRequestId', ledger.provider_request_id,
    'providerReference', ledger.provider_reference, 'movementReference', ledger.movement_reference);
end;
$$;

create or replace function public.finalize_booking_request_confirmation(
  target_booking_request_id uuid,
  target_capture_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare capture_result jsonb;
declare target_request public.booking_requests;
declare target_attempt public.booking_request_submission_attempts;
declare target_claim public.booking_request_authorization_claims;
declare target_snapshot public.booking_snapshots;
declare target_commitment public.cottage_booking_period_commitments;
declare target_capture public.simulated_payment_provider_operations;
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
  select * into target_capture from public.simulated_payment_provider_operations operations
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
$$;

create or replace function public.claim_due_booking_request_payment_required_expiries(
  target_limit integer,target_provider_identity jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role',true) <> 'service_role'
    or target_limit is null or target_limit < 1 or target_limit > 50 then
    raise exception 'Payment Required expiry batch is unavailable' using errcode='42501';
  end if;
  if target_provider_identity is null
    or jsonb_typeof(target_provider_identity) <> 'object'
    or target_provider_identity ?& array['provider','environment','merchantId','terminalId'] is not true
    or target_provider_identity - array['provider','environment','merchantId','terminalId'] <> '{}'::jsonb
    or exists(select 1 from jsonb_each(target_provider_identity) entry
      where jsonb_typeof(entry.value) <> 'string' or btrim(entry.value#>>'{}')='')
  then
    raise exception 'Payment Required expiry provider is invalid' using errcode='RC409';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'bookingRequestId',due.booking_request_id,'deadline',
    to_char(due.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) order by due.payment_required_deadline,due.booking_request_id),'[]'::jsonb)
  from (
    select work.booking_request_id,work.payment_required_deadline,
      coalesce(expiry.last_evaluated_at,work.payment_required_deadline) evaluation_order
    from public.booking_request_capture_work work
    join public.booking_requests requests on requests.id=work.booking_request_id
    left join public.booking_request_payment_required_expiry_work expiry
      on expiry.booking_request_id=work.booking_request_id
    where work.state='payment_required'
      and requests.status='accepted'
      and work.payment_required_deadline <= clock_timestamp()
      and public.booking_request_payment_required_expiry_provider_matches(work,target_provider_identity)
      and not exists(select 1 from public.booking_confirmations confirmations
        where confirmations.booking_request_id=work.booking_request_id and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=work.booking_request_id))
      and coalesce(expiry.state,'processing') not in ('complete','quarantined')
    order by evaluation_order,work.payment_required_deadline,work.booking_request_id
    limit target_limit
    for update of requests skip locked
  ) due);
end;
$$;

create or replace function public.due_booking_request_payment_recoveries(target_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role',true) <> 'service_role' or target_limit is null or target_limit < 1 or target_limit > 50 then
    raise exception 'Recovery batch is unavailable' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(id),'[]'::jsonb) from (
    select attempts.id from public.booking_request_payment_recovery_attempts attempts
    join public.booking_requests requests on requests.id=attempts.booking_request_id
    where not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=attempts.booking_request_id and expiry.state='quarantined') and requests.status='accepted' and
      (attempts.state='succeeded' or attempts.state='capture_failed'
      or (attempts.state='blocked' and exists(select 1 from public.booking_request_payment_recovery_operations operations
        where operations.recovery_attempt_id=attempts.id and operations.outcome='indeterminate'))
      or (attempts.state in ('admitted','original_released','replacement_authorized')
        and exists(select 1 from public.booking_request_capture_work work
          where work.booking_request_id=attempts.booking_request_id and clock_timestamp() < work.payment_required_deadline)))
      and not exists(select 1 from public.booking_confirmations confirmations
        where confirmations.booking_request_id=attempts.booking_request_id)
    order by attempts.updated_at,attempts.id limit target_limit) due);
end;
$$;

create or replace function public.claim_due_booking_request_captures(target_limit integer, target_provider_identity jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare candidate record;
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.simulated_payment_provider_operations;
declare claimed_at timestamptz;
declare results jsonb := '[]'::jsonb;
begin
  if target_limit is null or target_limit < 1 or target_limit > 50
    or target_provider_identity is null
    or jsonb_typeof(target_provider_identity) <> 'object'
    or not target_provider_identity ?& array['provider','environment','merchantId','terminalId']
    or target_provider_identity - array['provider','environment','merchantId','terminalId'] <> '{}'::jsonb
    or exists (select 1 from jsonb_each(target_provider_identity) fields
      where jsonb_typeof(fields.value) <> 'string' or btrim(fields.value #>> '{}') = '') then
    raise exception 'Capture recovery selection is invalid' using errcode = 'RC409';
  end if;
  for candidate in
    select requests.id from public.booking_requests requests
    join public.booking_request_capture_work capture_work on capture_work.booking_request_id = requests.id
    where not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=capture_work.booking_request_id and expiry.state='quarantined') and requests.status = 'accepted'
      and capture_work.provider = target_provider_identity ->> 'provider'
      and capture_work.environment = target_provider_identity ->> 'environment'
      and capture_work.merchant_id = target_provider_identity ->> 'merchantId'
      and capture_work.terminal_id = target_provider_identity ->> 'terminalId'
      and (capture_work.state = 'complete' or (capture_work.state = 'processing' and capture_work.lease_expires_at <= clock_timestamp()))
      and not exists (select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id = requests.id)
    -- Existing execution evidence must progress beyond unavailable crash-window rows.
    order by case when capture_work.state = 'complete' or exists (
      select 1 from public.simulated_payment_provider_operations operations
      where (operations.provider, operations.environment, operations.merchant_id, operations.terminal_id,
        operations.provider_idempotency_key, operations.claim_id, operations.claim_generation,
        operations.payment_lifecycle_id, operations.logical_operation_id, operations.physical_attempt_id,
        operations.operation_kind, operations.request_fingerprint, operations.amount_fils, operations.currency) =
        (capture_work.provider, capture_work.environment, capture_work.merchant_id, capture_work.terminal_id,
        capture_work.provider_idempotency_key, capture_work.authorization_claim_id, capture_work.authorization_claim_generation,
        capture_work.payment_lifecycle_id, capture_work.capture_logical_operation_id, capture_work.capture_physical_attempt_id,
        'capture', capture_work.request_fingerprint, capture_work.amount_fils, capture_work.currency)
    ) then 0 else 1 end, capture_work.created_at, requests.id
    limit target_limit for update of requests skip locked
  loop
    select * into source from public.lock_booking_request_capture_source(candidate.id);
    work := source.work;
    ledger := source.ledger;
    claimed_at := date_trunc('milliseconds', clock_timestamp());
    if exists (select 1 from public.booking_confirmations where booking_request_id = candidate.id) then continue; end if;
    if work.state = 'complete' then
      results := results || jsonb_build_array(public.complete_booking_request_capture(candidate.id, null, null, null));
      continue;
    end if;
    if work.state <> 'processing' or work.lease_expires_at > claimed_at then continue; end if;
    if ledger.id is null then
      results := results || jsonb_build_array(jsonb_build_object('status', 'unavailable'));
      continue;
    end if;
    if (work.recovery_operation_id is null and (
        work.lease_generation is distinct from (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint
        or work.lease_token::text is distinct from ledger.capture_execution_permit ->> 'leaseToken'))
      or (work.recovery_operation_id is not null and (
        work.recovery_operation_id <> ledger.id
        or work.lease_generation <= (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint))
      or (ledger.capture_execution_permit ->> 'leaseGeneration')::bigint < 1
      or (ledger.capture_execution_permit ->> 'leaseToken')::uuid is null
      or ledger.created_at >= (ledger.capture_execution_permit ->> 'notAfter')::timestamptz
      or ledger.created_at < (source.payment_snapshot #>> '{movements,0,recordedAt}')::timestamptz then
      raise exception 'Capture recovery execution evidence is invalid' using errcode = 'RC409';
    end if;
    update public.booking_request_capture_work capture_work
    set lease_generation = capture_work.lease_generation + 1, lease_token = gen_random_uuid(),
      lease_expires_at = claimed_at + interval '30 seconds', recovery_operation_id = ledger.id
    where capture_work.booking_request_id = candidate.id returning * into work;
    results := results || jsonb_build_array(jsonb_build_object('status', 'reconcile', 'lease', source.binding || jsonb_build_object(
      'workId', work.booking_request_id, 'leaseGeneration', work.lease_generation,
      'leaseToken', work.lease_token,
      'notAfter', to_char(work.lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'recoveryOperationId', work.recovery_operation_id,
      'providerResult', jsonb_build_object('providerRequestId', ledger.provider_request_id,
        'providerReference', ledger.provider_reference) || case when ledger.original_outcome = 'succeeded'
          then jsonb_build_object('movementReference', ledger.movement_reference) else '{}'::jsonb end
    )));
  end loop;
  return results;
end;
$$;

create or replace function public.booking_request_payment_status(target_request public.booking_requests)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case when target_request.status = 'accepted' then case
      when exists (
        select 1 from public.booking_confirmations confirmations
        join public.cottage_booking_period_commitments commitments on commitments.id = confirmations.booking_period_commitment_id
        join public.booking_request_capture_work capture_work on capture_work.booking_request_id = confirmations.booking_request_id
        where confirmations.booking_request_id = target_request.id
            and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=target_request.id)
          and not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=target_request.id and expiry.state='quarantined')
          and confirmations.booking_snapshot_id = target_request.booking_snapshot_id
          and confirmations.booking_period_commitment_id = target_request.booking_period_commitment_id
          and commitments.status = 'confirmed_booking' and (capture_work.state = 'complete' or (
            capture_work.state='payment_required' and exists (
              select 1 from public.booking_request_payment_recovery_attempts attempts
              join public.booking_request_payment_recovery_operations operations on operations.recovery_attempt_id=attempts.id
                and operations.step='replacement-capture' and operations.outcome='succeeded'
              join public.simulated_payment_provider_operations ledger on ledger.id=operations.provider_operation_id
              where attempts.booking_request_id=target_request.id and attempts.state='succeeded'
                and operations.provider_operation_id=confirmations.capture_operation_id
                and ledger.current_outcome='succeeded' and ledger.recovery_attempt_id=attempts.id
                and ledger.authoritative_outcome_at=operations.authoritative_outcome_at
                and ledger.authoritative_outcome_at < capture_work.payment_required_deadline
            )))
      ) then 'paid-confirmed'
      when exists (select 1 from public.booking_request_capture_work capture_work
        where capture_work.booking_request_id = target_request.id and capture_work.state = 'payment_required')
        then 'payment-required'
      when exists (select 1 from public.booking_request_capture_work capture_work where capture_work.booking_request_id = target_request.id)
        then 'capture-processing'
      end end;
$$;

create or replace function public.booking_request_payment_recovery_status(target_request public.booking_requests)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when target_request.status='accepted' and work.state='payment_required' then
    jsonb_build_object('status',case
      when exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=target_request.id and expiry.state='quarantined') then 'quarantined'
      when confirmation.id is not null then 'confirmed'
      when attempt.state='succeeded' then 'processing'
      when clock_timestamp() >= work.payment_required_deadline then 'deadline-elapsed'
      when attempt.state='safely_failed' then 'retryable'
      when attempt.state in ('blocked','admitted','original_released','replacement_authorized','capture_failed') then 'processing'
      when attempt.state='late_succeeded' then 'deadline-elapsed'
      else 'available' end)
  end
  from public.booking_request_capture_work work
  left join lateral (select attempts.* from public.booking_request_payment_recovery_attempts attempts
    where attempts.booking_request_id=target_request.id order by attempts.generation desc limit 1) attempt on true
  left join public.booking_confirmations confirmation on confirmation.booking_request_id=target_request.id and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=target_request.id)
  where work.booking_request_id=target_request.id;
$$;

create or replace function public.booking_request_payment_required_expiry_status(target_request public.booking_requests)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when capture.state='payment_required'
    and expiry.payment_required_deadline=capture.payment_required_deadline
    and not exists(select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id=target_request.id and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=target_request.id))
    and ((target_request.status='accepted' and expiry.state in ('processing','attention_required','quarantined'))
      or (target_request.status='expired' and expiry.state in ('complete','quarantined')))
  then jsonb_build_object('status',case expiry.state when 'complete' then case when exists(select 1 from public.booking_request_payment_required_expiry_operations operations where operations.expiry_work_id=expiry.id and operations.operation_kind='refund') then 'refunded-expired' else 'expired' end
    when 'quarantined' then case when target_request.status='expired' then 'quarantined-released' else 'quarantined' end
    when 'attention_required' then 'attention-required' else case when exists(select 1 from public.booking_request_payment_required_expiry_operations operations where operations.expiry_work_id=expiry.id and operations.operation_kind='refund') then 'refunding' else 'processing' end end,
    'deadline',to_char(capture.payment_required_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end
  from public.booking_request_capture_work capture
  join public.booking_request_payment_required_expiry_work expiry on expiry.booking_request_id=capture.booking_request_id
  where capture.booking_request_id=target_request.id;
$$;

do $$
declare target record;
begin
  for target in select work.booking_request_id,expiry.state from public.booking_request_capture_work work
    left join public.booking_request_payment_required_expiry_work expiry on expiry.booking_request_id=work.booking_request_id
    where work.payment_required_deadline is not null order by work.booking_request_id
  loop
    if target.state='attention_required' and exists(select 1 from public.simulated_payment_provider_operations ledger
      join public.booking_request_capture_work work on work.authorization_claim_id=ledger.claim_id
      where work.booking_request_id=target.booking_request_id and (ledger.current_outcome='indeterminate'
        or (ledger.operation_kind='release' and ledger.current_outcome='failed'))) then
      perform public.quarantine_booking_request_payment(target.booking_request_id,'legacy-unresolved-money');
    end if;
    if exists(select 1 from public.booking_confirmations confirmations where confirmations.booking_request_id=target.booking_request_id)
      and exists(select 1 from public.simulated_payment_provider_operations ledger join public.booking_request_capture_work work on work.authorization_claim_id=ledger.claim_id
        where work.booking_request_id=target.booking_request_id and ledger.operation_kind='capture' and ledger.current_outcome='succeeded'
          and (ledger.authoritative_outcome_at is null or ledger.authoritative_outcome_at>=work.payment_required_deadline)) then
      perform public.quarantine_booking_request_payment(target.booking_request_id,'legacy-confirmation-evidence-invalid');
    end if;
  end loop;
end;
$$;


create or replace function public.execute_simulated_booking_request_capture(
  target_permit jsonb, target_outcome text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source record;
declare work public.booking_request_capture_work;
declare ledger public.simulated_payment_provider_operations;
declare expected_permit jsonb;
declare executed_at timestamptz;
declare execution_id uuid;
begin
  if public.booking_request_payment_quarantined((target_permit->>'bookingRequestId')::uuid) then return jsonb_build_object('outcome','not-executed'); end if;
  if target_outcome is null or target_outcome not in ('succeeded', 'failed') then
    raise exception 'Booking Request capture outcome is invalid' using errcode = 'RC409';
  end if;
  select * into source from public.lock_booking_request_capture_source(
    (target_permit ->> 'bookingRequestId')::uuid
  );
  if not found then raise exception 'Booking Request capture permit is invalid' using errcode = 'RC409'; end if;
  work := source.work;
  ledger := source.ledger;
  expected_permit := source.binding || jsonb_build_object(
    'purpose', 'booking-request-capture', 'workId', work.booking_request_id,
    'leaseGeneration', work.lease_generation, 'leaseToken', work.lease_token,
    'notAfter', to_char(work.lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  if work.state <> 'processing' or target_permit is distinct from expected_permit
    or expected_permit -> 'providerIdentity' is distinct from
      '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    or (ledger.id is not null and ledger.capture_execution_permit is distinct from target_permit) then
    raise exception 'Booking Request capture permit is invalid' using errcode = 'RC409';
  end if;
  executed_at := clock_timestamp();
  if executed_at >= work.lease_expires_at then
    return jsonb_build_object('outcome', 'not-executed');
  end if;
  if ledger.id is null then
    execution_id := gen_random_uuid();
    insert into public.simulated_payment_provider_operations (
      id, claim_id, claim_generation, operation_kind, provider, environment, merchant_id, terminal_id,
      provider_idempotency_key, request_fingerprint, payment_lifecycle_id, logical_operation_id,
      physical_attempt_id, amount_fils, currency, original_outcome, current_outcome,
      provider_request_id, provider_reference, movement_reference,
      capture_execution_permit, created_at, updated_at
    ) values (
      execution_id, work.authorization_claim_id, work.authorization_claim_generation, 'capture',
      work.provider, work.environment, work.merchant_id, work.terminal_id,
      work.provider_idempotency_key, work.request_fingerprint, work.payment_lifecycle_id,
      work.capture_logical_operation_id, work.capture_physical_attempt_id, work.amount_fils,
      work.currency, target_outcome, target_outcome,
      'sim-capture-request-' || execution_id::text, 'sim-capture-reference-' || execution_id::text,
      case when target_outcome = 'succeeded' then 'sim-capture-movement-' || execution_id::text end,
      target_permit, executed_at, executed_at
    ) returning * into ledger;
  end if;
  if ledger.original_outcome = 'failed' then
    return jsonb_build_object('outcome', 'failed', 'providerRequestId', ledger.provider_request_id,
      'providerReference', ledger.provider_reference, 'retrySafe', false);
  end if;
  return jsonb_build_object('outcome', 'succeeded', 'providerRequestId', ledger.provider_request_id,
    'providerReference', ledger.provider_reference, 'movementReference', ledger.movement_reference);
end;
$$;
