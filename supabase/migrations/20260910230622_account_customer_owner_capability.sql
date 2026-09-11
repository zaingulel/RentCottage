-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.claim_customer_booking_request_payment_recovery (
  target_booking_request_id uuid,
  target_command_key        uuid,
  target_replacement_method text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
      where contexts.user_id = actor and contexts.role in ('customer', 'cottage_owner')) then
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
$function$;

CREATE OR REPLACE FUNCTION public.claim_marketplace_role (
  requested_role public.account_role
)
  RETURNS public.account_contexts
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  context public.account_contexts;
begin
  if requested_role is null or requested_role not in ('customer', 'cottage_owner') then
    raise exception 'Only Customer or Cottage Owner access can be claimed publicly'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = (select auth.uid())
      and phone_confirmed_at is not null
  ) then
    raise exception 'A verified phone identity is required'
      using errcode = '42501';
  end if;

  -- The auth identity exists before either first-time claim, so it serializes enrollment even with no context row yet.
  perform 1 from auth.users where id = (select auth.uid()) for update;

  insert into public.account_contexts (user_id, role, owner_approval_state)
  values (
    (select auth.uid()),
    requested_role,
    case
      when requested_role = 'cottage_owner' then 'prospective'::public.owner_approval_state
      else null
    end
  )
  on conflict (user_id) do nothing;

  select * into context
  from public.account_contexts
  where user_id = (select auth.uid())
  for update;

  if context.role = 'platform_administrator' then
    raise exception 'This identity already has a different marketplace role'
      using errcode = 'RC001';
  end if;

  if requested_role = 'cottage_owner' and context.role = 'customer' then
    update public.account_contexts
    set role = 'cottage_owner', owner_approval_state = 'prospective'
    where user_id = context.user_id
    returning * into context;
  end if;

  return context;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_pending_booking_period_hold_without_authorization_claim (
  target_customer_user_id     uuid,
  target_profile_id           uuid,
  target_commitment_reference text,
  requested_search            jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare target_profile public.owner_application_cottage_profiles;
declare target_schedule_revision_id uuid;
declare selection jsonb;
declare resolved_selection jsonb;
declare resolved_selections jsonb := '[]'::jsonb;
declare selection_day date;
declare target_unit_kind public.cottage_inventory_unit_kind;
declare target_unit_id uuid;
declare target_price_iqd bigint;
declare target_start_time time without time zone;
declare target_end_time time without time zone;
declare target_starts_at timestamptz;
declare target_ends_at timestamptz;
declare access_ranges tstzmultirange := '{}'::tstzmultirange;
declare target_access_range tstzrange;
declare booking_period_commitment_id uuid := gen_random_uuid();
declare booking_price_iqd bigint := 0;
declare selected_item_count integer := 0;
declare occupied_shift_count integer := 0;
declare inserted_occupancy_count integer;
begin
  if target_customer_user_id is null
    or target_profile_id is null
    or target_commitment_reference is null
    or target_commitment_reference <> btrim(target_commitment_reference)
    or target_commitment_reference !~ '^[A-Z0-9][A-Z0-9-]{0,119}$' then
    raise exception 'Pending Hold input is invalid' using errcode = '22023';
  end if;
  perform public.validate_public_cottage_search(requested_search);
  if not exists (
    select 1
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    where contexts.user_id = target_customer_user_id
      and contexts.role in ('customer'::public.account_role, 'cottage_owner'::public.account_role)
      and users.phone_confirmed_at is not null
  ) then
    raise exception 'A verified Customer is required' using errcode = '42501';
  end if;

  select * into target_profile
  from public.owner_application_cottage_profiles profiles
  where profiles.id = target_profile_id
  for update;
  if not found then
    raise exception 'Published Cottage was not found' using errcode = 'RC404';
  end if;
  if target_profile.owner_user_id = target_customer_user_id then
    raise exception 'Self booking is not allowed; use owner availability controls' using errcode = 'RC422';
  end if;
  target_schedule_revision_id := target_profile.current_shift_schedule_id;
  if target_schedule_revision_id is null
    or not public.is_cottage_publicly_discoverable(target_profile_id)
    or not exists (
      select 1
      from public.cottage_publication_snapshots publications
      where publications.id = target_profile.current_publication_id
        and publications.profile_id = target_profile.id
        and publications.capacity >= (requested_search ->> 'guests')::integer
        and (not requested_search ? 'governorate'
          or lower(publications.governorate) = lower(btrim(requested_search ->> 'governorate')))
        and (not requested_search ? 'area'
          or lower(publications.approximate_location) = lower(btrim(requested_search ->> 'area')))
        and array(
          select value
          from jsonb_array_elements_text(
            coalesce(requested_search -> 'amenities', '[]'::jsonb)
          ) values(value)
        ) <@ publications.amenities
    ) then
    raise exception 'Pending Hold selection is unavailable' using errcode = 'RC409';
  end if;

  for selection in
    select value
    from jsonb_array_elements(requested_search -> 'selections') selections(value)
    order by value ->> 'serviceDay', coalesce((value ->> 'position')::integer, 32767)
  loop
    selection_day := (selection ->> 'serviceDay')::date;
    if selection ->> 'kind' = 'shift' then
      target_unit_kind := 'shift'::public.cottage_inventory_unit_kind;
      select shifts.id, shifts.start_time, shifts.end_time
        into target_unit_id, target_start_time, target_end_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id
        and shifts.position = (selection ->> 'position')::smallint;
    else
      target_unit_kind := 'full_day_bundle'::public.cottage_inventory_unit_kind;
      select schedules.full_day_bundle_id,
        (select shifts.start_time from public.cottage_shifts shifts
          where shifts.schedule_revision_id = schedules.id
          order by shifts.position limit 1),
        (select shifts.end_time from public.cottage_shifts shifts
          where shifts.schedule_revision_id = schedules.id
          order by shifts.position desc limit 1)
        into target_unit_id, target_start_time, target_end_time
      from public.cottage_shift_schedule_revisions schedules
      where schedules.id = target_schedule_revision_id;
    end if;
    target_price_iqd := public.public_cottage_effective_price(
      target_schedule_revision_id,
      target_unit_kind,
      target_unit_id,
      selection_day
    );
    if target_unit_id is null
      or target_price_iqd is null
      or not coalesce(public.public_cottage_unit_is_available(
        target_schedule_revision_id,
        target_unit_kind,
        target_unit_id,
        selection_day
      ), false) then
      raise exception 'Pending Hold selection is unavailable' using errcode = 'RC409';
    end if;

    target_starts_at := (selection_day + target_start_time) at time zone 'Asia/Baghdad';
    target_ends_at := (
      selection_day + target_end_time
      + case when target_end_time < target_start_time then interval '1 day' else interval '0 days' end
    ) at time zone 'Asia/Baghdad';
    if target_unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      and exists (
        select 1
        from jsonb_array_elements(requested_search -> 'selections') next_selection(value)
        where value ->> 'kind' = 'full-day'
          and (value ->> 'serviceDay')::date = selection_day + 1
      ) then
      target_ends_at := (
        selection_day + 1 + target_start_time
      ) at time zone 'Asia/Baghdad';
    end if;
    target_access_range := tstzrange(target_starts_at, target_ends_at, '[)');
    access_ranges := access_ranges + tstzmultirange(target_access_range);
    resolved_selections := resolved_selections || jsonb_build_array(jsonb_build_object(
      'serviceDay', selection_day,
      'unitKind', target_unit_kind,
      'unitId', target_unit_id,
      'priceIqd', target_price_iqd
    ));
    booking_price_iqd := booking_price_iqd + target_price_iqd;
    selected_item_count := selected_item_count + 1;
  end loop;

  begin
    insert into public.cottage_booking_period_commitments (
      id, customer_user_id, profile_id, schedule_revision_id,
      commitment_reference, status, access_ranges
    ) values (
      booking_period_commitment_id,
      target_customer_user_id,
      target_profile_id,
      target_schedule_revision_id,
      target_commitment_reference,
      'pending_hold',
      access_ranges
    );
  exception when exclusion_violation then
    raise exception 'The Customer already has an overlapping active Booking Period'
      using errcode = 'RC409';
  end;

  for resolved_selection in
    select value
    from jsonb_array_elements(resolved_selections) selections(value)
  loop
    selection_day := (resolved_selection ->> 'serviceDay')::date;
    target_unit_kind :=
      (resolved_selection ->> 'unitKind')::public.cottage_inventory_unit_kind;
    target_unit_id := (resolved_selection ->> 'unitId')::uuid;
    target_price_iqd := (resolved_selection ->> 'priceIqd')::bigint;
    insert into public.cottage_inventory_commitments (
      booking_period_commitment_id, unit_kind, unit_id,
      service_day, committed_price_iqd
    ) values (
      booking_period_commitment_id, target_unit_kind, target_unit_id,
      selection_day, target_price_iqd
    );
    begin
      if target_unit_kind = 'shift'::public.cottage_inventory_unit_kind then
        insert into public.cottage_booking_period_occupancies (
          booking_period_commitment_id, schedule_revision_id, shift_id, service_day
        ) values (
          booking_period_commitment_id, target_schedule_revision_id,
          target_unit_id, selection_day
        );
        occupied_shift_count := occupied_shift_count + 1;
      else
        insert into public.cottage_booking_period_occupancies (
          booking_period_commitment_id, schedule_revision_id, shift_id, service_day
        )
        select booking_period_commitment_id, target_schedule_revision_id,
          shifts.id, selection_day
        from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
        order by shifts.position;
        get diagnostics inserted_occupancy_count = row_count;
        occupied_shift_count := occupied_shift_count + inserted_occupancy_count;
      end if;
    exception when unique_violation then
      raise exception 'Pending Hold selection is unavailable' using errcode = 'RC409';
    end;
  end loop;

  return jsonb_build_object(
    'bookingPeriodCommitmentId', booking_period_commitment_id,
    'commitmentReference', target_commitment_reference,
    'status', 'pending_hold',
    'bookingPriceIqd', booking_price_iqd,
    'selectedItemCount', selected_item_count,
    'occupiedShiftCount', occupied_shift_count
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_booking_confirmation_notification_status (
  target_receipt_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare q public.booking_requests; declare w public.booking_confirmation_notification_work; declare r public.booking_receipts; declare role public.account_contexts; declare actor uuid:=(select auth.uid());
begin
  select * into w from public.booking_confirmation_notification_work where receipt_id=target_receipt_id;
  select * into r from public.booking_receipts where id=target_receipt_id;
  select requests.* into q from public.booking_requests requests join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id where confirmations.id=r.booking_confirmation_id;
  select * into role from public.account_contexts where user_id=actor;
  if actor is null or role.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null) or r.id is null or r.recipient_user_id is distinct from actor or not ((r.recipient_role='customer' and role.role in ('customer','cottage_owner') and q.customer_user_id=actor) or (r.recipient_role='cottage_owner' and role.role='cottage_owner' and role.owner_approval_state='approved' and q.owner_user_id=actor)) or (w.receipt_id is null and public.booking_request_payment_status(q) is distinct from 'paid-confirmed') then raise exception 'Notification status unavailable' using errcode='42501'; end if;
  if w.receipt_id is null then return jsonb_build_object('receiptId',r.id,'state','pending','lastOutcome',null,'supplierDeliveryReference',null,'deliveredAt',null,'suppressedAt',null,'historical',false); end if;
  return jsonb_build_object('receiptId',w.receipt_id,'state',w.state,'lastOutcome',w.last_outcome,'supplierDeliveryReference',w.supplier_delivery_reference,'deliveredAt',w.delivered_at,'suppressedAt',w.suppressed_at,'historical',w.state='delivered' and public.booking_request_payment_status(q)<>'paid-confirmed');
end $function$;

CREATE OR REPLACE FUNCTION public.get_confirmed_booking_access (
  target_reference text
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with actor as (
    select case when actor_request.customer_user_id = contexts.user_id then 'customer'::public.account_role else 'cottage_owner'::public.account_role end as role
    from public.booking_requests actor_request
    join public.account_contexts contexts on contexts.user_id = (select auth.uid())
    join auth.users actor_user on actor_user.id = contexts.user_id
    where actor_request.booking_request_reference = target_reference
      and actor_user.phone_confirmed_at is not null
      and (
        (contexts.role in ('customer'::public.account_role, 'cottage_owner'::public.account_role)
          and actor_request.customer_user_id = contexts.user_id)
        or
        (contexts.role = 'cottage_owner'::public.account_role
          and contexts.owner_approval_state = 'approved'::public.owner_approval_state
          and actor_request.owner_user_id = contexts.user_id)
      )
  )
  select jsonb_build_object(
    'receiptId', receipts.id,
    'bookingRequestReference', requests.booking_request_reference,
    'bookingReference', commitments.commitment_reference,
    'confirmedAt', to_char(confirmations.confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'actorRole', actor.role,
    'customerName', requests.customer_name,
    'cottageName', snapshots.quote_payload ->> 'cottageName',
    'bookingPeriod', snapshots.quote_payload -> 'items',
    'partySize', requests.party_size,
    'pricing', case actor.role
      when 'customer'::public.account_role then jsonb_build_object(
        'bookingPriceIqd', (snapshots.quote_payload ->> 'bookingPriceIqd')::bigint,
        'serviceFeeIqd', (snapshots.quote_payload ->> 'serviceFeeIqd')::bigint,
        'customerTotalIqd', (snapshots.quote_payload ->> 'customerTotalIqd')::bigint
      )
      when 'cottage_owner'::public.account_role then jsonb_build_object(
        'bookingPriceIqd', (snapshots.quote_payload ->> 'bookingPriceIqd')::bigint,
        'marketplaceCommissionFils', snapshots.marketplace_commission_amount_fils,
        'ownerNetFils',
          (snapshots.quote_payload ->> 'bookingPriceIqd')::bigint * 1000
            - snapshots.marketplace_commission_amount_fils
      )
    end,
    'houseRules', snapshots.quote_payload ->> 'houseRules',
    'bookingTermsVersion', snapshots.booking_terms_version,
    'bookingTermsBody', snapshots.booking_terms_body,
    'cancellationPolicyVersion', snapshots.cancellation_policy_version,
    'exactAddress', nullif(btrim(profiles.exact_address), ''),
    'privateDirections', nullif(btrim(profiles.private_directions), ''),
    'mapPin', case
      when profiles.exact_latitude is not null and profiles.exact_longitude is not null
        then jsonb_build_object(
          'latitude', profiles.exact_latitude,
          'longitude', profiles.exact_longitude
        )
      else null
    end,
    'customerPhone', case when customer_user.phone_confirmed_at is not null
      then case
        when btrim(customer_user.phone) ~ '^[1-9][0-9]{7,14}$'
          then '+' || btrim(customer_user.phone)
        else nullif(btrim(customer_user.phone), '')
      end end,
    'ownerPhone', case when owner_user.phone_confirmed_at is not null
      then case
        when btrim(owner_user.phone) ~ '^[1-9][0-9]{7,14}$'
          then '+' || btrim(owner_user.phone)
        else nullif(btrim(owner_user.phone), '')
      end end
  )
  from public.booking_requests requests
  join actor on true
  join public.booking_snapshots snapshots
    on snapshots.id = requests.booking_snapshot_id
    and snapshots.customer_user_id = requests.customer_user_id
    and snapshots.profile_id = requests.profile_id
  join public.cottage_booking_period_commitments commitments
    on commitments.id = requests.booking_period_commitment_id
    and commitments.customer_user_id = requests.customer_user_id
    and commitments.profile_id = requests.profile_id
  join public.booking_confirmations confirmations
    on confirmations.booking_request_id = requests.id
    and confirmations.booking_snapshot_id = snapshots.id
    and confirmations.booking_period_commitment_id = commitments.id
  join public.booking_receipts receipts
    on receipts.booking_confirmation_id = confirmations.id
    and receipts.booking_snapshot_id = snapshots.id
    and receipts.recipient_user_id = (select auth.uid())
    and receipts.recipient_role = actor.role::text
  join public.owner_application_cottage_profiles profiles
    on profiles.id = requests.profile_id
    and profiles.owner_user_id = requests.owner_user_id
  join auth.users customer_user on customer_user.id = requests.customer_user_id
  join auth.users owner_user on owner_user.id = requests.owner_user_id
  where requests.booking_request_reference = target_reference
    and public.booking_request_payment_status(requests) = 'paid-confirmed';
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_booking_request (
  target_reference text
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select jsonb_build_object('id',requests.id,'bookingRequestReference',requests.booking_request_reference,
    'status',requests.status,'paymentStatus',public.booking_request_payment_status(requests),
    'paymentRequiredWindow',public.booking_request_payment_required_window(requests),
    'paymentRequiredExpiry',public.booking_request_payment_required_expiry_status(requests),
    'paymentRecovery',public.booking_request_payment_recovery_status(requests),
    'cottageName',snapshots.quote_payload->>'cottageName','bookingPeriod',snapshots.quote_payload->'items',
    'partySize',requests.party_size,'bookingPriceIqd',(snapshots.quote_payload->>'bookingPriceIqd')::bigint,
    'serviceFeeIqd',(snapshots.quote_payload->>'serviceFeeIqd')::bigint,
    'customerTotalIqd',(snapshots.quote_payload->>'customerTotalIqd')::bigint,
    'responseDeadline',to_char(requests.response_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'declineReason',requests.decline_reason,'declineNote',requests.decline_note,
    'statusNotifications',coalesce((select jsonb_agg(jsonb_build_object('id',receipts.id,'status',receipts.status,
      'createdAt',to_char(receipts.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by receipts.created_at)
      from public.booking_request_status_notifications receipts where receipts.booking_request_id=requests.id
        and receipts.recipient_user_id=(select auth.uid())),'[]'::jsonb))
  from public.booking_requests requests join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id
  where requests.booking_request_reference=target_reference and requests.customer_user_id=(select auth.uid())
    and exists(select 1 from public.account_contexts contexts where contexts.user_id=(select auth.uid()) and contexts.role in ('customer','cottage_owner'));
$function$;

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
  where receipts.recipient_user_id=actor and ((receipts.recipient_role='customer' and requests.customer_user_id=actor and context.role in ('customer','cottage_owner')) or (receipts.recipient_role='cottage_owner' and requests.owner_user_id=actor and context.role='cottage_owner' and context.owner_approval_state='approved')) and public.booking_request_payment_status(requests)='paid-confirmed' order by confirmations.confirmed_at desc,receipts.id;
end $function$;

CREATE OR REPLACE FUNCTION public.prepare_booking_request_submission (
  target_customer_user_id uuid,
  target_idempotency_key  uuid,
  target_submission       jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare target_locale public.cottage_profile_source_language;
declare target_slug text;
declare target_search jsonb;
declare displayed_fingerprint text;
declare current_quote jsonb;
declare current_profile_id uuid;
declare first_starts_at timestamptz;
declare policy_evaluated_at timestamptz;
declare policy jsonb;
declare expected_acceptance_evidence jsonb;
declare intent jsonb;
declare target_intent_fingerprint text;
declare existing_attempt public.booking_request_submission_attempts;
declare key_attempt public.booking_request_submission_attempts;
declare inserted_attempt public.booking_request_submission_attempts;
declare existing_projection jsonb;
begin
  if target_customer_user_id is null
    or target_idempotency_key is null
    or target_submission is null
    or jsonb_typeof(target_submission) <> 'object' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not exists (
    select 1
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    where contexts.user_id = target_customer_user_id
      and contexts.role in ('customer'::public.account_role, 'cottage_owner'::public.account_role)
      and users.phone_confirmed_at is not null
  ) then
    return jsonb_build_object('status', 'access-required');
  end if;

  begin
    target_locale := (target_submission ->> 'locale')::public.cottage_profile_source_language;
    target_slug := target_submission ->> 'publicSlug';
    target_search := target_submission -> 'discoveryQuery';
    displayed_fingerprint := target_submission ->> 'quoteFingerprint';
    intent := target_submission -> 'intent';
    if target_slug is null
      or target_search is null
      or intent is null
      or jsonb_typeof(intent) <> 'object'
      or displayed_fingerprint !~ '^[0-9a-f]{64}$'
      or intent ->> 'customerName' <> btrim(intent ->> 'customerName')
      or char_length(intent ->> 'customerName') not between 2 and 120
      or not public.booking_request_content_is_safe(intent ->> 'customerName')
      or (intent ->> 'partySize')::integer not between 1 and 1000
      or (intent ->> 'partySize')::integer <> (target_search ->> 'guests')::integer
      or (intent ? 'bookingNote' and (
        intent ->> 'bookingNote' is null
        or intent ->> 'bookingNote' <> btrim(intent ->> 'bookingNote')
        or char_length(intent ->> 'bookingNote') not between 1 and 500
        or not public.booking_request_content_is_safe(intent ->> 'bookingNote')
      ))
      or (intent ->> 'acceptedHouseRules')::boolean is not true
      or (intent ->> 'acceptedCancellationPolicy')::boolean is not true
      or (intent ->> 'acceptedMarketplaceTerms')::boolean is not true
      or intent ->> 'cancellationPolicyVersion' <> 'rentcottage-mvp-2026-08-04'
      or jsonb_typeof(intent -> 'acceptanceEvidence') is distinct from 'object' then
      return jsonb_build_object('status', 'invalid');
    end if;
  exception when others then
    return jsonb_build_object('status', 'invalid');
  end;

  if exists (
    select 1 from public.cottage_marketplace_listings listings
    join public.owner_application_cottage_profiles profiles on profiles.id = listings.profile_id
    where listings.public_slug = target_slug and profiles.owner_user_id = target_customer_user_id
  ) then
    return jsonb_build_object('status', 'self-booking-not-allowed');
  end if;

  intent := intent || jsonb_build_object(
    'customerUserId', target_customer_user_id,
    'publicSlug', target_slug,
    'locale', target_locale,
    'discoveryQuery', target_search,
    'quoteFingerprint', displayed_fingerprint,
    'contentVersion', target_submission -> 'contentVersion',
    'termsVersion', target_submission -> 'termsVersion',
    'bookingPriceIqd', target_submission -> 'bookingPriceIqd',
    'serviceFeeIqd', target_submission -> 'serviceFeeIqd',
    'customerTotalIqd', target_submission -> 'customerTotalIqd',
    'firstStartsAt', target_submission -> 'firstStartsAt'
  );
  target_intent_fingerprint := encode(
    extensions.digest(convert_to(intent::text, 'UTF8'), 'sha256'),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_customer_user_id::text || ':' || target_intent_fingerprint, 0
    )
  );

  select * into key_attempt
  from public.booking_request_submission_attempts attempts
  where attempts.customer_user_id = target_customer_user_id
    and attempts.idempotency_key = target_idempotency_key
  for update;
  if found and (
    key_attempt.intent_fingerprint <> target_intent_fingerprint
    or key_attempt.intent_payload <> intent
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if key_attempt.id is not null then
    existing_projection := public.project_existing_booking_request_submission_attempt(
      key_attempt, target_intent_fingerprint, intent, false
    );
    if existing_projection ->> 'status' <> 'continue' then
      return existing_projection;
    end if;
  end if;

  select * into existing_attempt
  from public.booking_request_submission_attempts attempts
  where attempts.customer_user_id = target_customer_user_id
    and attempts.intent_fingerprint = target_intent_fingerprint
    and attempts.intent_dedupe_active
  for update;
  if found then
    existing_projection := public.project_existing_booking_request_submission_attempt(
      existing_attempt, target_intent_fingerprint, intent, false
    );
    if existing_projection ->> 'status' <> 'continue' then
      return existing_projection;
    end if;
  end if;

  select profiles.id into current_profile_id
  from public.cottage_marketplace_listings listings
  join public.owner_application_cottage_profiles profiles
    on profiles.id = listings.profile_id
  where listings.public_slug = target_slug
  for update of profiles;
  if current_profile_id is null then
    return jsonb_build_object('status', 'quote-stale');
  end if;
  policy_evaluated_at := clock_timestamp();

  current_quote := public.get_public_booking_quote_with_fingerprint(
    target_locale, target_slug, target_search
  );
  if current_quote ->> 'status' <> 'quoted'
    or current_quote ->> 'quoteFingerprint' <> displayed_fingerprint
    or (current_quote ->> 'contentVersion')::integer
      <> (target_submission ->> 'contentVersion')::integer
    or current_quote ->> 'termsVersion' <> target_submission ->> 'termsVersion'
    or (current_quote ->> 'bookingPriceIqd')::bigint
      <> (target_submission ->> 'bookingPriceIqd')::bigint
    or (current_quote ->> 'serviceFeeIqd')::bigint
      <> (target_submission ->> 'serviceFeeIqd')::bigint
    or (current_quote ->> 'customerTotalIqd')::bigint
      <> (target_submission ->> 'customerTotalIqd')::bigint
    or current_quote -> 'items' -> 0 ->> 'startsAt'
      <> target_submission ->> 'firstStartsAt' then
    return jsonb_build_object('status', 'quote-stale');
  end if;
  first_starts_at := (current_quote -> 'items' -> 0 ->> 'startsAt')::timestamptz;
  policy := public.booking_request_policy_at(
    first_starts_at, policy_evaluated_at
  );
  if (policy ->> 'insideCutoff')::boolean then
    return jsonb_build_object('status', 'too-late');
  end if;
  expected_acceptance_evidence := public.booking_request_acceptance_evidence(
    target_locale,
    current_quote ->> 'termsVersion',
    (policy ->> 'requiresInside48HourNoRefundAcceptance')::boolean
  );
  if intent -> 'acceptanceEvidence' is distinct from expected_acceptance_evidence then
    return jsonb_build_object('status', 'invalid');
  end if;
  if (policy ->> 'requiresInside48HourNoRefundAcceptance')::boolean
    and (intent ->> 'acceptedInside48HourNoRefund')::boolean is not true then
    return jsonb_build_object('status', 'invalid');
  end if;

  if existing_attempt.id is not null then
    if existing_attempt.profile_id <> current_profile_id
      or existing_attempt.quote_payload <> current_quote - 'status' then
      return jsonb_build_object('status', 'quote-stale');
    end if;
    return public.project_existing_booking_request_submission_attempt(
      existing_attempt, target_intent_fingerprint, intent, true
    );
  end if;

  insert into public.booking_request_submission_attempts (
    customer_user_id, idempotency_key, payment_lifecycle_id,
    profile_id, locale, public_slug, requested_search,
    quote_fingerprint, quote_payload, intent_fingerprint, intent_payload,
    state
  ) values (
    target_customer_user_id, target_idempotency_key, gen_random_uuid(),
    current_profile_id, target_locale, target_slug, target_search,
    displayed_fingerprint, current_quote - 'status', target_intent_fingerprint, intent,
    'authorizing'
  )
  on conflict do nothing
  returning * into inserted_attempt;

  if inserted_attempt.id is not null then
    return jsonb_build_object(
      'status', 'ready',
      'attemptId', inserted_attempt.id,
      'paymentLifecycleId', inserted_attempt.payment_lifecycle_id,
      'paymentSnapshot', null,
      'providerIdentity', null
    );
  end if;

  select * into existing_attempt
  from public.booking_request_submission_attempts attempts
  where attempts.customer_user_id = target_customer_user_id
    and (
      attempts.intent_fingerprint = target_intent_fingerprint
        and attempts.intent_dedupe_active
      or attempts.idempotency_key = target_idempotency_key
    )
  for update;
  if existing_attempt.quote_payload <> current_quote - 'status' then
    return jsonb_build_object('status', 'invalid');
  end if;
  return public.project_existing_booking_request_submission_attempt(
    existing_attempt, target_intent_fingerprint, intent, true
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.retry_booking_confirmation_notification (
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
  if actor is null or role.user_id is null or not exists(select 1 from auth.users where id=actor and phone_confirmed_at is not null) or w.receipt_id is null or w.recipient_user_id is distinct from actor or not ((w.recipient_role='customer' and role.role in ('customer','cottage_owner') and q.customer_user_id=actor) or (w.recipient_role='cottage_owner' and role.role='cottage_owner' and role.owner_approval_state='approved' and q.owner_user_id=actor)) or w.state is distinct from 'retryable' or public.booking_request_payment_status(q) is distinct from 'paid-confirmed' then raise exception 'Notification retry unavailable' using errcode='42501'; end if;
  update public.booking_confirmation_notification_work set state='pending',last_outcome=null,updated_at=clock_timestamp() where receipt_id=w.receipt_id;
  insert into public.booking_confirmation_notification_attempts(receipt_id,action,outcome) values(w.receipt_id,'user-retry','queued');
  return jsonb_build_object('status','queued');
end $function$;

ALTER TABLE public.booking_requests
  ADD CONSTRAINT booking_requests_distinct_participants CHECK (customer_user_id <> owner_user_id);