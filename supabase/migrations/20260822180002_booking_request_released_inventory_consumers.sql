-- Released occupancies remain immutable audit history, but only active
-- occupancies block public availability or Owner inventory operations.

create or replace function public.resolve_cottage_inventory(
  target_profile_id uuid,
  target_schedule_revision_id uuid,
  target_service_day date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare profile public.owner_application_cottage_profiles;
declare unit record;
declare raw_state public.cottage_inventory_availability_state;
declare effective_price bigint;
declare committed_price bigint;
declare commitment_reference text;
declare committed boolean;
declare component_unavailable boolean;
declare owner_view boolean;
declare service_view boolean;
declare privileged_view boolean;
declare result jsonb := '[]'::jsonb;
declare item jsonb;
begin
  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id;
  if not found then
    raise exception 'Cottage Profile was not found' using errcode = '42501';
  end if;
  service_view := current_setting('role', true) = 'service_role';
  owner_view := profile.owner_user_id = (select auth.uid())
    and exists (
      select 1 from public.account_contexts contexts
      where contexts.user_id = (select auth.uid())
        and contexts.role = 'cottage_owner'
        and contexts.owner_approval_state in ('approved', 'expired', 'suspended')
    );
  privileged_view := owner_view or service_view;
  if not exists (
    select 1 from public.cottage_shift_schedule_revisions revisions
    where revisions.id = target_schedule_revision_id
      and revisions.profile_id = target_profile_id
  ) then
    raise exception 'The Shift Schedule revision does not belong to the Cottage Profile'
      using errcode = '42501';
  end if;
  if not owner_view and not service_view and profile.current_publication_id is null then
    raise exception 'Cottage Profile availability is not public' using errcode = '42501';
  end if;
  if profile.current_shift_schedule_id is distinct from target_schedule_revision_id
    and not service_view then
    raise exception 'The Shift Schedule revision is no longer current' using errcode = 'RC409';
  end if;

  for unit in
    select shifts.id as unit_id,
      'shift'::public.cottage_inventory_unit_kind as unit_kind,
      shifts.position
    from public.cottage_shifts shifts
    where shifts.schedule_revision_id = target_schedule_revision_id
    union all
    select revisions.full_day_bundle_id,
      'full_day_bundle'::public.cottage_inventory_unit_kind,
      32767::smallint
    from public.cottage_shift_schedule_revisions revisions
    where revisions.id = target_schedule_revision_id
    order by position
  loop
    select availability.state into raw_state
    from public.cottage_inventory_availability availability
    where availability.schedule_revision_id = target_schedule_revision_id
      and availability.unit_kind = unit.unit_kind
      and availability.unit_id = unit.unit_id
      and availability.service_day = target_service_day;
    raw_state := coalesce(raw_state, 'closed'::public.cottage_inventory_availability_state);
    effective_price := public.public_cottage_effective_price(
      target_schedule_revision_id, unit.unit_kind, unit.unit_id, target_service_day
    );
    committed := false;
    committed_price := null;
    commitment_reference := null;

    select selected.committed_price_iqd, periods.commitment_reference
      into committed_price, commitment_reference
    from public.cottage_inventory_commitments selected
    join public.cottage_booking_period_commitments periods
      on periods.id = selected.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = periods.id
      and occupancies.schedule_revision_id = periods.schedule_revision_id
      and occupancies.service_day = selected.service_day
      and occupancies.active
      and (
        selected.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
        or occupancies.shift_id = selected.unit_id
      )
    where periods.schedule_revision_id = target_schedule_revision_id
      and selected.unit_kind = unit.unit_kind
      and selected.unit_id = unit.unit_id
      and selected.service_day = target_service_day
    order by selected.created_at, selected.id
    limit 1;
    committed := found;

    if not committed and unit.unit_kind = 'shift'::public.cottage_inventory_unit_kind then
      select selected.committed_price_iqd, periods.commitment_reference
        into committed_price, commitment_reference
      from public.cottage_booking_period_occupancies occupancies
      join public.cottage_booking_period_commitments periods
        on periods.id = occupancies.booking_period_commitment_id
      join public.cottage_inventory_commitments selected
        on selected.booking_period_commitment_id = periods.id
        and selected.service_day = occupancies.service_day
        and selected.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      where occupancies.schedule_revision_id = target_schedule_revision_id
        and occupancies.shift_id = unit.unit_id
        and occupancies.service_day = target_service_day
        and occupancies.active
      limit 1;
      committed := found;
    elsif not committed and unit.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind then
      select selected.committed_price_iqd, periods.commitment_reference
        into committed_price, commitment_reference
      from public.cottage_booking_period_occupancies occupancies
      join public.cottage_booking_period_commitments periods
        on periods.id = occupancies.booking_period_commitment_id
      join public.cottage_inventory_commitments selected
        on selected.booking_period_commitment_id = periods.id
        and selected.service_day = occupancies.service_day
        and selected.unit_kind = 'shift'::public.cottage_inventory_unit_kind
        and selected.unit_id = occupancies.shift_id
      where occupancies.schedule_revision_id = target_schedule_revision_id
        and occupancies.service_day = target_service_day
        and occupancies.active
      order by selected.created_at, selected.id
      limit 1;
      committed := found;
    end if;
    if committed and privileged_view then effective_price := committed_price; end if;
    component_unavailable := unit.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      and exists (
        select 1 from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
          and not public.cottage_inventory_component_is_effectively_available(
            shifts.schedule_revision_id, shifts.id, target_service_day
          )
      );
    item := jsonb_build_object(
      'id', unit.unit_id,
      'kind', unit.unit_kind,
      'priceIqd', effective_price,
      'available', (
        not committed
        and not component_unavailable
        and raw_state = 'open'::public.cottage_inventory_availability_state
        and effective_price is not null
      )
    );
    if privileged_view then
      item := item || jsonb_build_object(
        'ownerState', raw_state,
        'committed', committed,
        'commitmentReference', commitment_reference
      );
    end if;
    result := result || jsonb_build_array(item);
  end loop;
  return jsonb_build_object(
    'profileId', target_profile_id,
    'scheduleRevisionId', target_schedule_revision_id,
    'serviceDay', target_service_day,
    'units', result
  );
end;
$$;

create or replace function public.set_cottage_inventory_availability_changed_units(
  target_profile_id uuid,
  target_schedule_revision_id uuid,
  target_service_day date,
  requested_states jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare profile public.owner_application_cottage_profiles;
declare requested_unit jsonb;
declare requested_unit_id uuid;
declare requested_kind public.cottage_inventory_unit_kind;
declare requested_state public.cottage_inventory_availability_state;
declare unit_start_time time without time zone;
begin
  if not exists (
    select 1 from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required' using errcode = '42501';
  end if;
  if jsonb_typeof(requested_states) <> 'array' then
    raise exception 'Cottage Inventory availability input is invalid' using errcode = '22023';
  end if;
  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id
  for update;
  if not found or profile.owner_user_id <> (select auth.uid()) then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if profile.current_shift_schedule_id is distinct from target_schedule_revision_id then
    raise exception 'The Shift Schedule revision is no longer current' using errcode = 'RC409';
  end if;

  for requested_unit in select value from jsonb_array_elements(requested_states)
  loop
    if jsonb_typeof(requested_unit) <> 'object'
      or (requested_unit ->> 'unitId') !~ '^[0-9a-fA-F-]{36}$'
      or (requested_unit ->> 'unitKind') not in ('shift', 'full_day_bundle')
      or (requested_unit ->> 'state') not in ('open', 'closed', 'private_blocked') then
      raise exception 'Cottage Inventory availability input is invalid' using errcode = '22023';
    end if;
    requested_unit_id := (requested_unit ->> 'unitId')::uuid;
    requested_kind := (requested_unit ->> 'unitKind')::public.cottage_inventory_unit_kind;
    requested_state := (requested_unit ->> 'state')::public.cottage_inventory_availability_state;
    if requested_kind = 'shift'::public.cottage_inventory_unit_kind then
      select shifts.start_time into unit_start_time
      from public.cottage_shifts shifts
      where shifts.id = requested_unit_id
        and shifts.schedule_revision_id = target_schedule_revision_id;
    else
      select shifts.start_time into unit_start_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id
      order by shifts.position limit 1;
    end if;
    if unit_start_time is null then
      raise exception 'The Cottage Inventory unit is not part of the Shift Schedule revision'
        using errcode = 'RC205';
    end if;
    if ((target_service_day + unit_start_time) at time zone 'Asia/Baghdad') <= now() then
      raise exception 'Only future Cottage Inventory can be changed' using errcode = 'RC204';
    end if;
    if requested_state = 'open'::public.cottage_inventory_availability_state
      and profile.current_publication_id is null then
      raise exception 'A Cottage must be published before inventory can open'
        using errcode = 'RC203';
    end if;
    if exists (
      select 1
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.schedule_revision_id = target_schedule_revision_id
        and occupancies.service_day = target_service_day
        and occupancies.active
        and (
          requested_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
          or occupancies.shift_id = requested_unit_id
        )
    ) then
      raise exception 'Committed Cottage Inventory cannot be changed by its owner'
        using errcode = 'RC204';
    end if;
  end loop;

  for requested_unit in select value from jsonb_array_elements(requested_states)
  loop
    insert into public.cottage_inventory_availability (
      schedule_revision_id, unit_kind, unit_id, service_day, state
    ) values (
      target_schedule_revision_id,
      (requested_unit ->> 'unitKind')::public.cottage_inventory_unit_kind,
      (requested_unit ->> 'unitId')::uuid,
      target_service_day,
      (requested_unit ->> 'state')::public.cottage_inventory_availability_state
    ) on conflict (schedule_revision_id, unit_kind, unit_id, service_day)
    do update set state = excluded.state;
  end loop;

  if exists (
    select 1
    from public.cottage_inventory_availability bundles
    where bundles.schedule_revision_id = target_schedule_revision_id
      and bundles.service_day = target_service_day
      and bundles.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      and bundles.state = 'open'::public.cottage_inventory_availability_state
      and not exists (
        select 1 from public.cottage_booking_period_occupancies occupancies
        where occupancies.schedule_revision_id = target_schedule_revision_id
          and occupancies.service_day = target_service_day
          and occupancies.active
      )
      and exists (
        select 1
        from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
          and not public.cottage_inventory_component_is_effectively_available(
            shifts.schedule_revision_id, shifts.id, target_service_day
          )
      )
  ) then
    raise exception 'A Full-Day Bundle requires every component Cottage Shift to be open'
      using errcode = 'RC205';
  end if;
  return jsonb_build_object(
    'profileId', target_profile_id,
    'scheduleRevisionId', target_schedule_revision_id,
    'serviceDay', target_service_day
  );
end;
$$;

create or replace function public.resolve_owner_calendar_without_auth_claim(
  target_profile_id uuid,
  target_schedule_revision_id uuid,
  target_service_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare original jsonb;
declare unit jsonb;
declare direct_status text;
declare direct_reference text;
declare bundle_status text;
declare bundle_reference text;
declare component_found boolean;
declare state text;
declare reference text;
declare editable boolean;
declare result jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1
    from public.owner_application_cottage_profiles profiles
    join public.account_contexts contexts on contexts.user_id = profiles.owner_user_id
    where profiles.id = target_profile_id
      and profiles.owner_user_id = (select auth.uid())
      and contexts.role = 'cottage_owner'
      and contexts.owner_approval_state in ('approved', 'expired', 'suspended')
  ) and current_setting('role', true) <> 'service_role' then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;

  original := public.resolve_cottage_inventory(
    target_profile_id, target_schedule_revision_id, target_service_day
  );
  for unit in select value from jsonb_array_elements(original -> 'units')
  loop
    direct_status := null;
    direct_reference := null;
    bundle_status := null;
    bundle_reference := null;
    component_found := false;
    select periods.status::text, periods.commitment_reference
      into direct_status, direct_reference
    from public.cottage_inventory_commitments selected
    join public.cottage_booking_period_commitments periods
      on periods.id = selected.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = periods.id
      and occupancies.schedule_revision_id = periods.schedule_revision_id
      and occupancies.service_day = selected.service_day
      and occupancies.active
      and (
        selected.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
        or occupancies.shift_id = selected.unit_id
      )
    where periods.schedule_revision_id = target_schedule_revision_id
      and selected.unit_kind = (unit ->> 'kind')::public.cottage_inventory_unit_kind
      and selected.unit_id = (unit ->> 'id')::uuid
      and selected.service_day = target_service_day
    limit 1;
    if unit ->> 'kind' = 'shift' then
      select periods.status::text, periods.commitment_reference
        into bundle_status, bundle_reference
      from public.cottage_booking_period_occupancies occupancies
      join public.cottage_booking_period_commitments periods
        on periods.id = occupancies.booking_period_commitment_id
      join public.cottage_inventory_commitments selected
        on selected.booking_period_commitment_id = periods.id
        and selected.service_day = occupancies.service_day
        and selected.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      where occupancies.schedule_revision_id = target_schedule_revision_id
        and occupancies.shift_id = (unit ->> 'id')::uuid
        and occupancies.service_day = target_service_day
        and occupancies.active
      limit 1;
    else
      select exists (
        select 1
        from public.cottage_booking_period_occupancies occupancies
        join public.cottage_inventory_commitments selected
          on selected.booking_period_commitment_id = occupancies.booking_period_commitment_id
          and selected.service_day = occupancies.service_day
          and selected.unit_kind = 'shift'::public.cottage_inventory_unit_kind
          and selected.unit_id = occupancies.shift_id
        where occupancies.schedule_revision_id = target_schedule_revision_id
          and occupancies.service_day = target_service_day
          and occupancies.active
      ) into component_found;
    end if;

    if direct_status is not null then
      state := direct_status;
      reference := direct_reference;
      editable := false;
    elsif bundle_status is not null then
      state := bundle_status;
      reference := bundle_reference;
      editable := false;
    elsif component_found then
      state := 'component_unavailable';
      reference := null;
      editable := false;
    else
      state := unit ->> 'ownerState';
      reference := null;
      editable := true;
    end if;
    result := result || jsonb_build_array(jsonb_build_object(
      'id', unit -> 'id',
      'kind', unit -> 'kind',
      'priceIqd', unit -> 'priceIqd',
      'available', unit -> 'available',
      'calendarState', state,
      'commitmentReference', reference,
      'editable', editable
    ));
  end loop;
  return jsonb_build_object(
    'profileId', original -> 'profileId',
    'scheduleRevisionId', original -> 'scheduleRevisionId',
    'serviceDay', original -> 'serviceDay',
    'units', result
  );
end;
$$;
