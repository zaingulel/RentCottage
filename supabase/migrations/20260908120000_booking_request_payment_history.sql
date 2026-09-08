-- Private, append-only support history for the simulated Booking Request payment lifecycle.
create table public.booking_request_payment_history (
  sequence bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  payment_lifecycle_id uuid not null,
  -- Canonical request metadata only: history must not add request-row locks to source writes.
  booking_request_id uuid,
  kind text not null check (kind in ('logical-operation','physical-attempt','retry','receipt-observation','state-transition','terminal-outcome','quarantine')),
  source text not null check (source in ('history-boundary','authorization-claim','provider-operation','release-work','release-operation','capture-work','recovery-attempt','recovery-operation','expiry-work','expiry-operation','booking-request','confirmation','confirmation-invalidation','provider-receipt')),
  provenance text not null check (provenance in ('observed','imported')),
  operation_kind text check (operation_kind in ('authorization','capture','release','refund','original-release','replacement-authorization','replacement-capture','replacement-release','expiry','confirmation','invalidation')),
  logical_operation_id text,
  physical_attempt_id text,
  operation_generation bigint,
  recovery_generation bigint,
  from_state text,
  to_state text,
  outcome text,
  reason_code text,
  provider_operation_id uuid,
  provider_request_id text,
  provider_reference text,
  movement_reference text,
  amount_fils bigint check (amount_fils is null or amount_fils > 0),
  provider_occurred_at timestamptz,
  received_at timestamptz,
  source_recorded_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp()
);

create index booking_request_payment_history_root_sequence_idx
  on public.booking_request_payment_history (payment_lifecycle_id, sequence);

alter table public.booking_request_payment_history enable row level security;
revoke all on public.booking_request_payment_history from public, anon, authenticated, service_role;
revoke all on sequence public.booking_request_payment_history_sequence_seq from public, anon, authenticated, service_role;

create function public.reject_booking_request_payment_history_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Booking Request payment history is immutable' using errcode = 'RC204';
end;
$$;
revoke all on function public.reject_booking_request_payment_history_change() from public, anon, authenticated, service_role;
create trigger reject_booking_request_payment_history_change
before update or delete on public.booking_request_payment_history
for each row execute function public.reject_booking_request_payment_history_change();
create function public.append_booking_request_payment_history(
  target_payment_lifecycle_id uuid,
  target_booking_request_id uuid,
  target_kind text,
  target_source text,
  target_provenance text,
  target_operation_kind text default null,
  target_logical_operation_id text default null,
  target_physical_attempt_id text default null,
  target_operation_generation bigint default null,
  target_recovery_generation bigint default null,
  target_from_state text default null,
  target_to_state text default null,
  target_outcome text default null,
  target_reason_code text default null,
  target_provider_operation_id uuid default null,
  target_provider_request_id text default null,
  target_provider_reference text default null,
  target_movement_reference text default null,
  target_amount_fils bigint default null,
  target_provider_occurred_at timestamptz default null,
  target_received_at timestamptz default null,
  target_source_recorded_at timestamptz default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.booking_request_payment_history(
    payment_lifecycle_id, booking_request_id, kind, source, provenance, operation_kind,
    logical_operation_id, physical_attempt_id, operation_generation, recovery_generation,
    from_state, to_state, outcome, reason_code, provider_operation_id, provider_request_id,
    provider_reference, movement_reference, amount_fils, provider_occurred_at, received_at,
    source_recorded_at
  ) values(
    target_payment_lifecycle_id, target_booking_request_id, target_kind, target_source,
    target_provenance, target_operation_kind, target_logical_operation_id,
    target_physical_attempt_id, target_operation_generation, target_recovery_generation,
    target_from_state, target_to_state, target_outcome, target_reason_code,
    target_provider_operation_id, target_provider_request_id, target_provider_reference,
    target_movement_reference, target_amount_fils, target_provider_occurred_at,
    target_received_at, target_source_recorded_at
  );
end;
$$;
revoke all on function public.append_booking_request_payment_history(uuid,uuid,text,text,text,text,text,text,bigint,bigint,text,text,text,text,uuid,text,text,text,bigint,timestamptz,timestamptz,timestamptz) from public, anon, authenticated, service_role;

create function public.observe_booking_request_payment_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare current_row jsonb := to_jsonb(new);
declare prior_row jsonb := case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
declare lifecycle_id uuid;
declare request_id uuid;
declare source_name text;
declare event_kind text := 'state-transition';
declare operation_name text;
declare current_state text;
declare prior_state text;
declare current_outcome text;
declare prior_outcome text;
declare reason text;
declare source_time timestamptz;
declare occurrence_time timestamptz;
declare provider_row public.simulated_payment_provider_operations;
begin
  source_name := case tg_table_name
    when 'booking_request_authorization_claims' then 'authorization-claim'
    when 'simulated_payment_provider_operations' then 'provider-operation'
    when 'booking_request_release_work' then 'release-work'
    when 'booking_request_release_operations' then 'release-operation'
    when 'booking_request_capture_work' then 'capture-work'
    when 'booking_request_payment_recovery_attempts' then 'recovery-attempt'
    when 'booking_request_payment_recovery_operations' then 'recovery-operation'
    when 'booking_request_payment_required_expiry_work' then 'expiry-work'
    when 'booking_request_payment_required_expiry_operations' then 'expiry-operation'
    when 'booking_requests' then 'booking-request'
    when 'booking_confirmations' then 'confirmation'
    when 'booking_request_confirmation_invalidations' then 'confirmation-invalidation'
    when 'booking_request_payment_correction_observations' then 'provider-receipt'
  end;
  request_id := nullif(current_row->>'booking_request_id','')::uuid;
  lifecycle_id := nullif(coalesce(current_row->>'payment_lifecycle_id', current_row->>'authorization_payment_lifecycle_id'),'')::uuid;
  if tg_table_name='booking_requests' then
    request_id := (current_row->>'id')::uuid;
  elsif tg_table_name='simulated_payment_provider_operations' then
    select claims.payment_lifecycle_id into lifecycle_id from public.booking_request_authorization_claims claims where claims.id=(current_row->>'claim_id')::uuid;
  elsif tg_table_name='booking_request_release_work' then
    select attempts.payment_lifecycle_id into lifecycle_id from public.booking_request_submission_attempts attempts where attempts.id=(current_row->>'attempt_id')::uuid;
  elsif tg_table_name='booking_request_payment_recovery_operations' then
    select requests.id, requests.payment_lifecycle_id into request_id,lifecycle_id
      from public.booking_request_payment_recovery_attempts attempts join public.booking_requests requests on requests.id=attempts.booking_request_id
      where attempts.id=(current_row->>'recovery_attempt_id')::uuid;
  elsif tg_table_name='booking_request_payment_correction_observations' then
    select requests.payment_lifecycle_id into lifecycle_id from public.booking_requests requests where requests.id=request_id;
  end if;
  if request_id is null and lifecycle_id is not null then
    select requests.id into request_id from public.booking_requests requests where requests.payment_lifecycle_id=lifecycle_id;
  end if;
  if request_id is not null then
    select requests.payment_lifecycle_id into lifecycle_id from public.booking_requests requests where requests.id=request_id;
  end if;
  if lifecycle_id is null then raise exception 'Payment history source has no original lifecycle' using errcode='RC409'; end if;

  -- One insert records one physical execution. Query/correction updates retain
  -- meaningful evidence changes as transitions of that same execution.
  if tg_table_name='simulated_payment_provider_operations' and tg_op='UPDATE'
    and (current_row->>'current_outcome',current_row->>'authoritative_outcome_at',current_row->>'movement_reference')
      is not distinct from (prior_row->>'current_outcome',prior_row->>'authoritative_outcome_at',prior_row->>'movement_reference') then
    return new;
  end if;

  current_state := coalesce(current_row->>'state', current_row->>'status');
  prior_state := coalesce(prior_row->>'state', prior_row->>'status');
  current_outcome := coalesce(current_row->>'current_outcome', current_row->>'provider_outcome', current_row->>'outcome');
  prior_outcome := coalesce(prior_row->>'current_outcome', prior_row->>'provider_outcome', prior_row->>'outcome');
  operation_name := coalesce(current_row->>'operation_kind', current_row->>'step',
    case source_name when 'capture-work' then 'capture' when 'release-work' then 'release'
      when 'release-operation' then 'release' when 'authorization-claim' then 'authorization'
      when 'expiry-work' then 'expiry' when 'confirmation' then 'confirmation'
      when 'confirmation-invalidation' then 'invalidation' end);
  reason := coalesce(current_row->>'quarantine_reason', current_row->>'diagnostic_reason', current_row->>'reason', current_row->>'decline_reason');
  source_time := nullif(coalesce(current_row->>'completed_at',current_row->>'result_recorded_at',current_row->>'settled_at',current_row->>'invalidated_at',current_row->>'confirmed_at',current_row->>'updated_at',current_row->>'created_at'),'')::timestamptz;
  occurrence_time := nullif(current_row->>'authoritative_outcome_at','')::timestamptz;

  if tg_table_name='simulated_payment_provider_operations' then
    if tg_op='INSERT' then event_kind:='physical-attempt';
    else prior_state:=prior_outcome; current_state:=current_outcome; end if;
  end if;
  if tg_table_name in ('booking_request_release_work','booking_request_capture_work') then event_kind:='logical-operation'; end if;
  if tg_table_name in ('booking_confirmations','booking_request_confirmation_invalidations') then event_kind:='terminal-outcome'; end if;
  if tg_table_name='booking_confirmations' then
    current_state := 'confirmed'; current_outcome := 'succeeded';
  elsif tg_table_name='booking_request_confirmation_invalidations' then
    current_state := 'invalidated';
  end if;
  if tg_op='UPDATE' and tg_table_name in ('booking_request_release_work','booking_request_capture_work')
    and (current_row->>'lease_generation')::bigint > (prior_row->>'lease_generation')::bigint
    and (prior_row->>'lease_generation')::bigint > 0 then
    event_kind := 'retry';
  end if;
  if tg_table_name='booking_request_payment_correction_observations' then
    select * into strict provider_row from public.simulated_payment_provider_operations where id=(current_row->>'provider_operation_id')::uuid;
    operation_name := provider_row.operation_kind;
    current_row := current_row || jsonb_build_object('logical_operation_id',provider_row.logical_operation_id,
      'physical_attempt_id',provider_row.physical_attempt_id,'provider_request_id',provider_row.provider_request_id,
      'provider_reference',provider_row.provider_reference,'movement_reference',provider_row.movement_reference,
      'amount_fils',provider_row.amount_fils);
    event_kind := 'receipt-observation';
    current_outcome := case when (current_row->>'conflict')::boolean then 'conflicting' else current_row#>>'{payload,outcome}' end;
    reason := case when (current_row->>'conflict')::boolean then 'conflicting-provider-observation' end;
    occurrence_time := case when not (current_row->>'conflict')::boolean and current_row#>>'{payload,occurredAt}' is not null then (current_row#>>'{payload,occurredAt}')::timestamptz end;
  end if;
  if coalesce(current_state,'') in ('quarantined','blocked') then event_kind:='quarantine'; end if;
  if tg_op='UPDATE' and tg_table_name<>'simulated_payment_provider_operations'
    and (current_state,current_outcome,reason,current_row->>'lease_generation',current_row->>'generation',current_row->>'provider_operation_id')
    is not distinct from (prior_state,prior_outcome,coalesce(prior_row->>'quarantine_reason',prior_row->>'diagnostic_reason',prior_row->>'reason',prior_row->>'decline_reason'),prior_row->>'lease_generation',prior_row->>'generation',prior_row->>'provider_operation_id') then
    return new;
  end if;
  perform public.append_booking_request_payment_history(
    lifecycle_id, request_id, event_kind, source_name, 'observed', operation_name,
    coalesce(current_row->>'logical_operation_id',current_row->>'release_logical_operation_id',current_row->>'capture_logical_operation_id'),
    coalesce(current_row->>'physical_attempt_id',current_row->>'release_physical_attempt_id',current_row->>'capture_physical_attempt_id'),
    nullif(coalesce(current_row->>'operation_generation',current_row->>'lease_generation',
      case when tg_table_name='booking_request_authorization_claims' then current_row->>'generation' end),'')::bigint,
    case when tg_table_name='booking_request_payment_recovery_attempts' then nullif(current_row->>'generation','')::bigint end,
    prior_state, current_state, current_outcome, reason,
    nullif(coalesce(current_row->>'provider_operation_id',case when tg_table_name='simulated_payment_provider_operations' then current_row->>'id' end),'')::uuid,
    current_row->>'provider_request_id',current_row->>'provider_reference',current_row->>'movement_reference',
    nullif(current_row->>'amount_fils','')::bigint,occurrence_time,
    nullif(current_row->>'received_at','')::timestamptz,source_time
  );
  return new;
end;
$$;
revoke all on function public.observe_booking_request_payment_history() from public, anon, authenticated, service_role;

-- Lock all observed sources so installation and retained-evidence import have no write gap.
lock table public.booking_request_submission_attempts,
  public.booking_request_authorization_claims,
  public.simulated_payment_provider_operations,
  public.booking_request_release_work,
  public.booking_request_release_operations,
  public.booking_request_capture_work,
  public.booking_request_payment_recovery_attempts,
  public.booking_request_payment_recovery_operations,
  public.booking_request_payment_required_expiry_work,
  public.booking_request_payment_required_expiry_operations,
  public.booking_requests,
  public.booking_confirmations,
  public.booking_request_confirmation_invalidations,
  public.booking_request_payment_correction_observations in share row exclusive mode;

create temporary table payment_history_import on commit drop as
select * from public.booking_request_payment_history with no data;
alter table payment_history_import add column source_identity text;

insert into payment_history_import(
  payment_lifecycle_id,booking_request_id,kind,source,provenance,source_recorded_at,source_identity
)
select roots.payment_lifecycle_id,requests.id,'state-transition','history-boundary','imported',null,roots.payment_lifecycle_id::text
from (
  select payment_lifecycle_id from public.booking_request_submission_attempts
  union select payment_lifecycle_id from public.booking_request_authorization_claims
  union select payment_lifecycle_id from public.booking_requests
) roots left join public.booking_requests requests using(payment_lifecycle_id);

insert into payment_history_import(
  payment_lifecycle_id,booking_request_id,kind,source,provenance,operation_kind,
  logical_operation_id,physical_attempt_id,outcome,provider_operation_id,
  provider_request_id,provider_reference,movement_reference,amount_fils,
  provider_occurred_at,source_recorded_at,source_identity
)
select claims.payment_lifecycle_id,requests.id,'physical-attempt','provider-operation','imported',operations.operation_kind,
  operations.logical_operation_id,operations.physical_attempt_id,operations.original_outcome,operations.id,
  operations.provider_request_id,operations.provider_reference,operations.movement_reference,operations.amount_fils,
  case when operations.original_outcome=operations.current_outcome then operations.authoritative_outcome_at end,operations.created_at,operations.id::text
from public.simulated_payment_provider_operations operations
join public.booking_request_authorization_claims claims on claims.id=operations.claim_id
left join public.booking_requests requests on requests.payment_lifecycle_id=claims.payment_lifecycle_id
order by operations.created_at,operations.id;

insert into payment_history_import(
  payment_lifecycle_id,booking_request_id,kind,source,provenance,operation_kind,
  logical_operation_id,physical_attempt_id,from_state,to_state,outcome,provider_operation_id,
  provider_request_id,provider_reference,movement_reference,amount_fils,
  provider_occurred_at,source_recorded_at,source_identity
)
select claims.payment_lifecycle_id,requests.id,'state-transition','provider-operation','imported',operations.operation_kind,
  operations.logical_operation_id,operations.physical_attempt_id,operations.original_outcome,operations.current_outcome,operations.current_outcome,operations.id,
  operations.provider_request_id,operations.provider_reference,operations.movement_reference,operations.amount_fils,
  operations.authoritative_outcome_at,operations.updated_at,operations.id::text
from public.simulated_payment_provider_operations operations
join public.booking_request_authorization_claims claims on claims.id=operations.claim_id
left join public.booking_requests requests on requests.payment_lifecycle_id=claims.payment_lifecycle_id
where operations.current_outcome is distinct from operations.original_outcome
order by operations.created_at,operations.id;

insert into payment_history_import(
  payment_lifecycle_id,booking_request_id,kind,source,provenance,to_state,outcome,source_recorded_at,source_identity
)
select requests.payment_lifecycle_id,requests.id,'state-transition','booking-request','imported',requests.status,null,requests.created_at,requests.id::text
from public.booking_requests requests
order by requests.created_at,requests.id;

insert into payment_history_import(
  payment_lifecycle_id,booking_request_id,kind,source,provenance,operation_kind,
  logical_operation_id,physical_attempt_id,operation_generation,recovery_generation,
  to_state,outcome,reason_code,provider_operation_id,provider_occurred_at,
  received_at,source_recorded_at,source_identity
)
select imported.payment_lifecycle_id,imported.booking_request_id,imported.kind,imported.source,
  'imported',imported.operation_kind,imported.logical_operation_id,
  imported.physical_attempt_id,imported.operation_generation,
  imported.recovery_generation,imported.to_state,imported.outcome,
  imported.reason_code,imported.provider_operation_id,
  imported.provider_occurred_at,imported.received_at,imported.source_recorded_at,imported.stable_id::text
from (
  select claims.payment_lifecycle_id,requests.id booking_request_id,'state-transition' kind,
    'authorization-claim' source,'authorization' operation_kind,
    claims.logical_operation_id,claims.physical_attempt_id,claims.generation::bigint operation_generation,
    null::bigint recovery_generation,claims.state::text to_state,
    null::text outcome,null::text reason_code,null::uuid provider_operation_id,
    null::timestamptz provider_occurred_at,null::timestamptz received_at,
    claims.created_at source_recorded_at,1 precedence,claims.id stable_id
  from public.booking_request_authorization_claims claims
  left join public.booking_requests requests on requests.payment_lifecycle_id=claims.payment_lifecycle_id
  union all
  select requests.payment_lifecycle_id,requests.id,'logical-operation','release-work',null,
    null,null,work.lease_generation,null,work.state,work.outcome,work.decline_reason,null,
    null,null,coalesce(work.completed_at,work.created_at),2,work.id
  from public.booking_request_release_work work join public.booking_requests requests on requests.id=work.booking_request_id
  union all
  select requests.payment_lifecycle_id,requests.id,'logical-operation','release-operation','release',
    operations.logical_operation_id,operations.physical_attempt_id,operations.operation_generation,null,
    operations.state,operations.provider_outcome,null,null,null,null,
    coalesce(operations.result_recorded_at,operations.execution_started_at),3,operations.id
  from public.booking_request_release_operations operations
  join public.booking_request_release_work work on work.id=operations.work_id
  join public.booking_requests requests on requests.id=work.booking_request_id
  union all
  select requests.payment_lifecycle_id,requests.id,'logical-operation','capture-work','capture',
    work.capture_logical_operation_id,work.capture_physical_attempt_id,work.lease_generation,null,
    work.state,work.outcome,null,null,null,null,coalesce(work.completed_at,work.created_at),4,requests.id
  from public.booking_request_capture_work work join public.booking_requests requests on requests.id=work.booking_request_id
  union all
  select requests.payment_lifecycle_id,requests.id,
    case when attempts.state='blocked' then 'quarantine' else 'state-transition' end,
    'recovery-attempt',null,null,null,null,attempts.generation,attempts.state,null,
    coalesce(to_jsonb(attempts)->>'reason',to_jsonb(attempts)->>'failure_reason'),null,null,null,
    coalesce(nullif(to_jsonb(attempts)->>'completed_at','')::timestamptz,attempts.created_at),5,attempts.id
  from public.booking_request_payment_recovery_attempts attempts join public.booking_requests requests on requests.id=attempts.booking_request_id
  union all
  select requests.payment_lifecycle_id,requests.id,'receipt-observation','recovery-operation',operations.step,
    ledger.logical_operation_id,ledger.physical_attempt_id,null,attempts.generation,attempts.state,
    operations.outcome,null,operations.provider_operation_id,operations.authoritative_outcome_at,null,
    coalesce(operations.authoritative_outcome_at,ledger.created_at),6,operations.id
  from public.booking_request_payment_recovery_operations operations
  join public.booking_request_payment_recovery_attempts attempts on attempts.id=operations.recovery_attempt_id
  join public.booking_requests requests on requests.id=attempts.booking_request_id
  join public.simulated_payment_provider_operations ledger on ledger.id=operations.provider_operation_id
  union all
  select requests.payment_lifecycle_id,requests.id,
    case when work.state='quarantined' then 'quarantine' else 'state-transition' end,
    'expiry-work','expiry',null,null,null,null,work.state,null,
    coalesce(work.quarantine_reason,to_jsonb(work)->>'diagnostic_reason'),null,null,null,
    coalesce(work.completed_at,work.created_at),7,work.id
  from public.booking_request_payment_required_expiry_work work join public.booking_requests requests on requests.id=work.booking_request_id
  union all
  select requests.payment_lifecycle_id,requests.id,'logical-operation','expiry-operation',operations.operation_kind,
    operations.release_logical_operation_id,operations.release_physical_attempt_id,null,null,null,
    null,null,operations.provider_operation_id,null,null,
    operations.created_at,8,operations.id
  from public.booking_request_payment_required_expiry_operations operations join public.booking_requests requests on requests.id=operations.booking_request_id
  union all
  select requests.payment_lifecycle_id,requests.id,'terminal-outcome','confirmation','confirmation',
    null,null,null,null,'confirmed','succeeded',null,confirmations.capture_operation_id,null,null,
    confirmations.confirmed_at,9,confirmations.id
  from public.booking_confirmations confirmations join public.booking_requests requests on requests.id=confirmations.booking_request_id
  union all
  select requests.payment_lifecycle_id,requests.id,'terminal-outcome','confirmation-invalidation','invalidation',
    null,null,null,null,'invalidated',null,invalidations.reason,invalidations.provider_operation_id,null,null,
    invalidations.invalidated_at,10,invalidations.confirmation_id
  from public.booking_request_confirmation_invalidations invalidations join public.booking_requests requests on requests.id=invalidations.booking_request_id
  union all
  select requests.payment_lifecycle_id,requests.id,'receipt-observation','provider-receipt',ledger.operation_kind,
    ledger.logical_operation_id,ledger.physical_attempt_id,null,null,null,
    case when observations.conflict then 'conflicting' else observations.payload->>'outcome' end,
    case when observations.conflict then 'conflicting-provider-observation' end,
    observations.provider_operation_id,
    case when not observations.conflict and observations.payload->>'occurredAt' is not null then (observations.payload->>'occurredAt')::timestamptz end,
    observations.received_at,observations.received_at,11,observations.id
  from public.booking_request_payment_correction_observations observations
  join public.booking_requests requests on requests.id=observations.booking_request_id
  join public.simulated_payment_provider_operations ledger on ledger.id=observations.provider_operation_id
) imported
order by imported.source_recorded_at,imported.precedence,imported.stable_id;

insert into public.booking_request_payment_history(payment_lifecycle_id,booking_request_id,kind,source,provenance,operation_kind,logical_operation_id,physical_attempt_id,operation_generation,recovery_generation,from_state,to_state,outcome,reason_code,provider_operation_id,provider_request_id,provider_reference,movement_reference,amount_fils,provider_occurred_at,received_at,source_recorded_at)
select payment_lifecycle_id,booking_request_id,kind,source,provenance,operation_kind,logical_operation_id,physical_attempt_id,operation_generation,recovery_generation,from_state,to_state,outcome,reason_code,provider_operation_id,provider_request_id,provider_reference,movement_reference,amount_fils,provider_occurred_at,received_at,source_recorded_at from payment_history_import
order by source_recorded_at nulls first,
  array_position(array['history-boundary','authorization-claim','provider-operation','release-work','release-operation','capture-work','recovery-attempt','recovery-operation','expiry-work','expiry-operation','booking-request','confirmation','confirmation-invalidation','provider-receipt'],source),
  source_identity,kind;

create trigger observe_payment_history_authorization_claim after insert or update on public.booking_request_authorization_claims for each row execute function public.observe_booking_request_payment_history();
create trigger observe_payment_history_provider_operation after insert or update on public.simulated_payment_provider_operations for each row execute function public.observe_booking_request_payment_history();
create trigger observe_payment_history_release_work after insert or update on public.booking_request_release_work for each row execute function public.observe_booking_request_payment_history();
create trigger observe_payment_history_release_operation after insert or update on public.booking_request_release_operations for each row execute function public.observe_booking_request_payment_history();
create trigger observe_payment_history_capture_work after insert or update on public.booking_request_capture_work for each row execute function public.observe_booking_request_payment_history();
create trigger observe_payment_history_recovery_attempt after insert or update on public.booking_request_payment_recovery_attempts for each row execute function public.observe_booking_request_payment_history();
create trigger observe_payment_history_recovery_operation after insert or update on public.booking_request_payment_recovery_operations for each row execute function public.observe_booking_request_payment_history();
create trigger observe_payment_history_expiry_work after insert or update on public.booking_request_payment_required_expiry_work for each row execute function public.observe_booking_request_payment_history();
create trigger observe_payment_history_expiry_operation after insert or update on public.booking_request_payment_required_expiry_operations for each row execute function public.observe_booking_request_payment_history();
create trigger observe_payment_history_request after insert or update on public.booking_requests for each row execute function public.observe_booking_request_payment_history();
create trigger observe_payment_history_confirmation after insert on public.booking_confirmations for each row execute function public.observe_booking_request_payment_history();
create trigger observe_payment_history_invalidation after insert on public.booking_request_confirmation_invalidations for each row execute function public.observe_booking_request_payment_history();
create trigger observe_payment_history_provider_receipt after insert on public.booking_request_payment_correction_observations for each row execute function public.observe_booking_request_payment_history();

create or replace function public.observe_booking_request_payment_correction(target_booking_request_id uuid,target_provider_operation_id uuid,target_receipt jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare work public.booking_request_capture_work;
declare ledger public.simulated_payment_provider_operations;
declare expected jsonb;
declare conflicting boolean;
declare observed_at timestamptz;
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
    perform public.append_booking_request_payment_history(
      work.payment_lifecycle_id, work.booking_request_id,
      'receipt-observation', 'provider-receipt', 'observed',
      target_operation_kind => ledger.operation_kind,
      target_logical_operation_id => ledger.logical_operation_id,
      target_physical_attempt_id => ledger.physical_attempt_id,
      target_outcome => 'malformed',
      target_reason_code => 'malformed-provider-observation',
      target_provider_operation_id => ledger.id,
      target_provider_request_id => ledger.provider_request_id,
      target_provider_reference => ledger.provider_reference,
      target_movement_reference => ledger.movement_reference,
      target_amount_fils => ledger.amount_fils,
      target_received_at => clock_timestamp()
    );
    return public.quarantine_booking_request_payment(target_booking_request_id,'malformed-provider-observation'); end if;
  if exists(select 1 from public.booking_request_payment_correction_observations observations
    where observations.provider_operation_id=ledger.id and observations.receipt_identity=target_receipt->>'receiptId' and observations.payload=target_receipt) then
    perform public.append_booking_request_payment_history(
      work.payment_lifecycle_id, work.booking_request_id,
      'receipt-observation', 'provider-receipt', 'observed',
      target_operation_kind => ledger.operation_kind,
      target_logical_operation_id => ledger.logical_operation_id,
      target_physical_attempt_id => ledger.physical_attempt_id,
      target_outcome => 'duplicate',
      target_provider_operation_id => ledger.id,
      target_provider_request_id => ledger.provider_request_id,
      target_provider_reference => ledger.provider_reference,
      target_movement_reference => ledger.movement_reference,
      target_amount_fils => ledger.amount_fils,
      target_received_at => clock_timestamp()
    );
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
    values(target_booking_request_id,ledger.id,target_receipt->>'receiptId',target_receipt,coalesce(conflicting,true));
  if conflicting is not false then return public.quarantine_booking_request_payment(target_booking_request_id,'conflicting-provider-observation'); end if;
  if target_receipt->>'outcome'='indeterminate' then return public.quarantine_booking_request_payment(target_booking_request_id,'unresolved-provider-observation'); end if;
  if public.booking_request_payment_quarantined(target_booking_request_id) then return jsonb_build_object('status','quarantined'); end if;
  if ledger.current_outcome='indeterminate' and target_receipt->>'outcome'<>'indeterminate' then
    update public.simulated_payment_provider_operations set current_outcome=target_receipt->>'outcome',authoritative_outcome_at=observed_at,
      movement_reference=target_receipt->>'movementReference',updated_at=clock_timestamp() where id=ledger.id returning * into ledger;
    update public.booking_request_payment_recovery_operations set outcome=ledger.current_outcome,authoritative_outcome_at=observed_at,updated_at=clock_timestamp()
      where provider_operation_id=ledger.id;
  end if;
  -- A delayed receipt finishes its pending step without rewinding later recovery.
  if ledger.recovery_attempt_id is not null and exists(
    select 1 from public.booking_request_payment_recovery_attempts attempts
    join public.booking_request_payment_recovery_operations operations on operations.recovery_attempt_id=attempts.id
    where attempts.id=ledger.recovery_attempt_id and operations.provider_operation_id=ledger.id
      and (attempts.state='blocked' or attempts.state=case operations.step
        when 'original-release' then 'admitted' when 'replacement-capture' then 'replacement_authorized'
        when 'replacement-release' then 'capture_failed' end)
  ) then perform public.record_booking_request_recovery_outcome(ledger.recovery_attempt_id,
    (select operations.step from public.booking_request_payment_recovery_operations operations where operations.provider_operation_id=ledger.id),ledger,work.payment_required_deadline); end if;
  if ledger.operation_kind in ('release','refund') and ledger.current_outcome='failed' then
    return public.quarantine_booking_request_payment(target_booking_request_id,'failed-'||ledger.operation_kind||'-observation'); end if;
  if ledger.operation_kind='capture' and ledger.current_outcome='succeeded' and observed_at >= work.payment_required_deadline then
    insert into public.booking_request_payment_required_expiry_work(booking_request_id,payment_required_deadline)
      values(work.booking_request_id,work.payment_required_deadline) on conflict do nothing;
    perform public.invalidate_booking_request_payment_confirmation(work.booking_request_id,ledger.id,'late-capture');
  end if;
  return jsonb_build_object('status','recorded');
end;
$$;

create function public.get_administrator_booking_request_payment_history(target_reference text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare request public.booking_requests;
declare events jsonb;
declare expiry public.booking_request_payment_required_expiry_work;
begin
  if public.is_platform_administrator('aal2') is not true then
    raise exception 'AAL2 Platform Administrator access is required' using errcode='42501';
  end if;
  select * into request from public.booking_requests requests where requests.booking_request_reference=target_reference;
  if request.id is null then return null; end if;
  select * into expiry from public.booking_request_payment_required_expiry_work work where work.booking_request_id=request.id;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id',history.id,'kind',history.kind,'source',history.source,'provenance',history.provenance,
    'operationKind',history.operation_kind,'logicalOperationId',case when history.logical_operation_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(authorization|capture|release|original-release|replacement-authorization|replacement-capture|replacement-release(:[1-9][0-9]*)?|corrective-refund:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then history.logical_operation_id when history.logical_operation_id is not null then 'reference-unavailable' end,
    'physicalAttemptId',case when history.physical_attempt_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:((authorization|capture|release):attempt-[1-9][0-9]*|(original-release|replacement-authorization|replacement-capture|replacement-release(:[1-9][0-9]*)?|corrective-refund:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):[1-9][0-9]*)$' then history.physical_attempt_id when history.physical_attempt_id is not null then 'reference-unavailable' end,'operationGeneration',history.operation_generation,
    'recoveryGeneration',history.recovery_generation,'fromState',history.from_state,'toState',history.to_state,
    'outcome',history.outcome,
    'reasonCode',case when history.reason_code in ('replacement-capture-succeeded','source-evidence-invalid','capture-occurrence-unknown','original-capture-unresolved','recovery-evidence-invalid','unexplained-recovery-provider-operation','recovery-operation-indeterminate','corrective-capture-invalid','unexplained-provider-operation','original-release-indeterminate','original-release-failed','replacement-authorization-invalid','replacement-release-indeterminate','replacement-release-failed','expiry-evidence-invalid','expiry-release-failed','expiry-release-indeterminate','expiry-refund-failed','expiry-refund-indeterminate','inventory-evidence-invalid','legacy-unresolved-money','legacy-confirmation-evidence-invalid','unsafe-recovery-original-release-indeterminate','unsafe-recovery-original-release-failed','unsafe-recovery-replacement-authorization-indeterminate','unsafe-recovery-replacement-capture-indeterminate','unsafe-recovery-replacement-release-indeterminate','unsafe-recovery-replacement-release-failed','cottage_unavailable','cannot_accommodate_request','other','capture-failed','payment-required-expired','late-capture','conflicting-evidence','unresolved-evidence','conflicting-provider-observation','unresolved-provider-observation','failed-release-observation','failed-refund-observation','malformed-provider-observation') then history.reason_code when history.reason_code is not null then 'unclassified-evidence' end,
    'providerOperationId',history.provider_operation_id,
    'providerRequestId',case when history.provider_request_id ~ '^sim(-capture|-recovery|-expiry)?-request-([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then history.provider_request_id when history.provider_request_id is not null then 'reference-unavailable' end,
    'providerReference',case when history.provider_reference ~ '^sim(-capture|-recovery|-expiry)?-reference-([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then history.provider_reference when history.provider_reference is not null then 'reference-unavailable' end,
    'movementReference',case when history.movement_reference ~ '^sim(-capture|-recovery|-expiry)?-movement-([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then history.movement_reference when history.movement_reference is not null then 'reference-unavailable' end,
    'amountFils',history.amount_fils::text,'currency',case when history.amount_fils is not null then 'IQD' end,
    'providerOccurredAt',history.provider_occurred_at,'receivedAt',history.received_at,
    'sourceRecordedAt',history.source_recorded_at,'recordedAt',history.recorded_at
  )) order by history.sequence),'[]'::jsonb) into events
  from public.booking_request_payment_history history where history.payment_lifecycle_id=request.payment_lifecycle_id and history.source<>'history-boundary';
  return jsonb_build_object(
    'bookingRequestReference',request.booking_request_reference,'simulated',true,
    'current',jsonb_build_object('requestStatus',request.status,'paymentStatus',public.booking_request_payment_status(request),
      'expiryStatus',expiry.state,'reasonCode',case when coalesce(expiry.quarantine_reason,expiry.diagnostic_reason) in ('replacement-capture-succeeded','source-evidence-invalid','capture-occurrence-unknown','original-capture-unresolved','recovery-evidence-invalid','unexplained-recovery-provider-operation','recovery-operation-indeterminate','corrective-capture-invalid','unexplained-provider-operation','original-release-indeterminate','original-release-failed','replacement-authorization-invalid','replacement-release-indeterminate','replacement-release-failed','expiry-evidence-invalid','expiry-release-failed','expiry-release-indeterminate','expiry-refund-failed','expiry-refund-indeterminate','inventory-evidence-invalid','legacy-unresolved-money','legacy-confirmation-evidence-invalid','unsafe-recovery-original-release-indeterminate','unsafe-recovery-original-release-failed','unsafe-recovery-replacement-authorization-indeterminate','unsafe-recovery-replacement-capture-indeterminate','unsafe-recovery-replacement-release-indeterminate','unsafe-recovery-replacement-release-failed','cottage_unavailable','cannot_accommodate_request','other','capture-failed','payment-required-expired','late-capture','conflicting-evidence','unresolved-evidence','conflicting-provider-observation','unresolved-provider-observation','failed-release-observation','failed-refund-observation','malformed-provider-observation') then coalesce(expiry.quarantine_reason,expiry.diagnostic_reason) when coalesce(expiry.quarantine_reason,expiry.diagnostic_reason) is not null then 'unclassified-evidence' end,
      'paymentRequiredDeadline',to_jsonb((select work from public.booking_request_capture_work work where work.booking_request_id=request.id))->>'payment_required_deadline'),
    'historyCoverage',case when exists(select 1 from public.booking_request_payment_history history where history.payment_lifecycle_id=request.payment_lifecycle_id and history.source='history-boundary' and history.provenance='imported') then 'retained-evidence-only' else 'complete' end,
    'events',events
  );
end;
$$;
revoke all on function public.get_administrator_booking_request_payment_history(text) from public, anon, authenticated, service_role;
grant execute on function public.get_administrator_booking_request_payment_history(text) to authenticated;
