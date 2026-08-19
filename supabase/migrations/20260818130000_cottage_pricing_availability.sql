-- Revision-scoped owner pricing and future inventory operations. Every row is
-- tied to one immutable Shift Schedule revision; replacement revisions start
-- without copied pricing or availability.

create type public.cottage_inventory_unit_kind as enum (
  'shift',
  'full_day_bundle'
);

create type public.cottage_inventory_availability_state as enum (
  'open',
  'closed',
  'private_blocked'
);

alter table public.cottage_shifts
  add constraint cottage_shifts_revision_id_id_key
    unique (schedule_revision_id, id);

alter table public.cottage_shift_schedule_revisions
  add constraint cottage_shift_schedule_revisions_id_bundle_key
    unique (id, full_day_bundle_id);

create table public.cottage_inventory_standard_prices (
  schedule_revision_id uuid not null
    references public.cottage_shift_schedule_revisions (id) on delete restrict,
  unit_kind public.cottage_inventory_unit_kind not null,
  unit_id uuid not null,
  price_iqd bigint not null check (price_iqd > 0),
  primary key (schedule_revision_id, unit_kind, unit_id)
);

create table public.cottage_inventory_weekday_price_overrides (
  schedule_revision_id uuid not null
    references public.cottage_shift_schedule_revisions (id) on delete restrict,
  unit_kind public.cottage_inventory_unit_kind not null,
  unit_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  price_iqd bigint not null check (price_iqd > 0),
  primary key (schedule_revision_id, unit_kind, unit_id, weekday)
);

create table public.cottage_inventory_date_price_overrides (
  schedule_revision_id uuid not null
    references public.cottage_shift_schedule_revisions (id) on delete restrict,
  unit_kind public.cottage_inventory_unit_kind not null,
  unit_id uuid not null,
  service_day date not null,
  price_iqd bigint not null check (price_iqd > 0),
  primary key (schedule_revision_id, unit_kind, unit_id, service_day)
);

create table public.cottage_inventory_availability (
  schedule_revision_id uuid not null
    references public.cottage_shift_schedule_revisions (id) on delete restrict,
  unit_kind public.cottage_inventory_unit_kind not null,
  unit_id uuid not null,
  service_day date not null,
  state public.cottage_inventory_availability_state not null,
  primary key (schedule_revision_id, unit_kind, unit_id, service_day)
);

create table public.cottage_inventory_commitments (
  id uuid primary key default gen_random_uuid(),
  schedule_revision_id uuid not null
    references public.cottage_shift_schedule_revisions (id) on delete restrict,
  unit_kind public.cottage_inventory_unit_kind not null,
  unit_id uuid not null,
  service_day date not null,
  commitment_reference text not null
    check (char_length(btrim(commitment_reference)) between 1 and 120),
  committed_price_iqd bigint not null check (committed_price_iqd > 0),
  created_at timestamptz not null default now(),
  unique (schedule_revision_id, unit_kind, unit_id, service_day)
);

create function public.assert_cottage_inventory_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unit_kind = 'shift'::public.cottage_inventory_unit_kind then
    if not exists (
      select 1
      from public.cottage_shifts shifts
      where shifts.id = new.unit_id
        and shifts.schedule_revision_id = new.schedule_revision_id
    ) then
      raise exception 'The Cottage Inventory unit is not part of the Shift Schedule revision'
        using errcode = 'RC205';
    end if;
  elsif not exists (
    select 1
    from public.cottage_shift_schedule_revisions revisions
    where revisions.id = new.schedule_revision_id
      and revisions.full_day_bundle_id = new.unit_id
  ) then
    raise exception 'The Cottage Inventory unit is not part of the Shift Schedule revision'
      using errcode = 'RC205';
  end if;
  return new;
end;
$$;

revoke all on function public.assert_cottage_inventory_unit() from public;

create trigger assert_cottage_inventory_standard_price_unit
before insert or update on public.cottage_inventory_standard_prices
for each row execute function public.assert_cottage_inventory_unit();

create trigger assert_cottage_inventory_weekday_price_unit
before insert or update on public.cottage_inventory_weekday_price_overrides
for each row execute function public.assert_cottage_inventory_unit();

create trigger assert_cottage_inventory_date_price_unit
before insert or update on public.cottage_inventory_date_price_overrides
for each row execute function public.assert_cottage_inventory_unit();

create trigger assert_cottage_inventory_availability_unit
before insert or update on public.cottage_inventory_availability
for each row execute function public.assert_cottage_inventory_unit();

create trigger assert_cottage_inventory_commitment_unit
before insert or update on public.cottage_inventory_commitments
for each row execute function public.assert_cottage_inventory_unit();

alter table public.cottage_inventory_standard_prices enable row level security;
alter table public.cottage_inventory_weekday_price_overrides enable row level security;
alter table public.cottage_inventory_date_price_overrides enable row level security;
alter table public.cottage_inventory_availability enable row level security;
alter table public.cottage_inventory_commitments enable row level security;

revoke all on public.cottage_inventory_standard_prices,
  public.cottage_inventory_weekday_price_overrides,
  public.cottage_inventory_date_price_overrides,
  public.cottage_inventory_availability,
  public.cottage_inventory_commitments
from anon, authenticated;

create function public.save_cottage_inventory_pricing(
  target_profile_id uuid,
  target_schedule_revision_id uuid,
  requested_prices jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare profile public.owner_application_cottage_profiles;
declare requested_unit jsonb;
declare requested_override jsonb;
declare requested_unit_id uuid;
declare requested_kind public.cottage_inventory_unit_kind;
declare requested_price bigint;
declare standard_price bigint;
declare requested_weekday smallint;
declare requested_day date;
declare unit_start_time time without time zone;
declare seen_unit_ids uuid[] := '{}';
begin
  if not exists (
    select 1
    from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required' using errcode = '42501';
  end if;
  if jsonb_typeof(requested_prices) <> 'object'
    or jsonb_typeof(requested_prices -> 'units') <> 'array' then
    raise exception 'Cottage Inventory pricing input is invalid' using errcode = '22023';
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

  for requested_unit in
    select value from jsonb_array_elements(requested_prices -> 'units')
  loop
    if jsonb_typeof(requested_unit) <> 'object'
      or (requested_unit ->> 'unitId') !~ '^[0-9a-fA-F-]{36}$'
      or (requested_unit ->> 'unitKind') not in ('shift', 'full_day_bundle')
      or jsonb_typeof(requested_unit -> 'standardPriceIqd') <> 'number' then
      raise exception 'Cottage Inventory pricing input is invalid' using errcode = '22023';
    end if;
    requested_unit_id := (requested_unit ->> 'unitId')::uuid;
    requested_kind := (requested_unit ->> 'unitKind')::public.cottage_inventory_unit_kind;
    requested_price := (requested_unit ->> 'standardPriceIqd')::bigint;
    if requested_price <= 0
      or (requested_unit ->> 'standardPriceIqd')::numeric <> requested_price then
        raise exception 'Cottage Inventory prices must be positive whole IQD amounts'
        using errcode = '22023';
    end if;
    standard_price := requested_price;
    if requested_unit_id = any(seen_unit_ids) then
      raise exception 'Cottage Inventory pricing contains a duplicate unit'
        using errcode = '22023';
    end if;
    seen_unit_ids := array_append(seen_unit_ids, requested_unit_id);

    if requested_kind = 'shift'::public.cottage_inventory_unit_kind then
      select shifts.start_time into unit_start_time
      from public.cottage_shifts shifts
      where shifts.id = requested_unit_id
        and shifts.schedule_revision_id = target_schedule_revision_id;
    else
      select min(shifts.start_time) into unit_start_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id;
    end if;
    if unit_start_time is null then
      raise exception 'The Cottage Inventory unit is not part of the Shift Schedule revision'
        using errcode = 'RC205';
    end if;

    delete from public.cottage_inventory_weekday_price_overrides
    where schedule_revision_id = target_schedule_revision_id
      and unit_kind = requested_kind
      and unit_id = requested_unit_id;
    delete from public.cottage_inventory_date_price_overrides prices
    where schedule_revision_id = target_schedule_revision_id
      and unit_kind = requested_kind
      and unit_id = requested_unit_id
      and ((prices.service_day + unit_start_time) at time zone 'Asia/Baghdad') > now();

    for requested_override in
      select value from jsonb_array_elements(coalesce(requested_unit -> 'weekdayOverrides', '[]'::jsonb))
    loop
      if jsonb_typeof(requested_override) <> 'object'
        or (requested_override ->> 'weekday') !~ '^[0-6]$'
        or jsonb_typeof(requested_override -> 'priceIqd') <> 'number' then
        raise exception 'Cottage Inventory weekday pricing input is invalid'
          using errcode = '22023';
      end if;
      requested_weekday := (requested_override ->> 'weekday')::smallint;
      requested_price := (requested_override ->> 'priceIqd')::bigint;
      if requested_price <= 0
        or (requested_override ->> 'priceIqd')::numeric <> requested_price then
        raise exception 'Cottage Inventory prices must be positive whole IQD amounts'
          using errcode = '22023';
      end if;
      insert into public.cottage_inventory_weekday_price_overrides (
        schedule_revision_id, unit_kind, unit_id, weekday, price_iqd
      ) values (
        target_schedule_revision_id, requested_kind, requested_unit_id,
        requested_weekday, requested_price
      );
    end loop;

    for requested_override in
      select value from jsonb_array_elements(coalesce(requested_unit -> 'dateOverrides', '[]'::jsonb))
    loop
      if jsonb_typeof(requested_override) <> 'object'
        or (requested_override ->> 'serviceDay') !~ '^\d{4}-\d{2}-\d{2}$'
        or jsonb_typeof(requested_override -> 'priceIqd') <> 'number' then
        raise exception 'Cottage Inventory date pricing input is invalid'
          using errcode = '22023';
      end if;
      requested_day := (requested_override ->> 'serviceDay')::date;
      requested_price := (requested_override ->> 'priceIqd')::bigint;
      if requested_price <= 0
        or (requested_override ->> 'priceIqd')::numeric <> requested_price then
        raise exception 'Cottage Inventory prices must be positive whole IQD amounts'
          using errcode = '22023';
      end if;
      if ((requested_day + unit_start_time) at time zone 'Asia/Baghdad') <= now() then
        raise exception 'Only future Cottage Inventory can be changed'
          using errcode = 'RC204';
      end if;
      insert into public.cottage_inventory_date_price_overrides (
        schedule_revision_id, unit_kind, unit_id, service_day, price_iqd
      ) values (
        target_schedule_revision_id, requested_kind, requested_unit_id,
        requested_day, requested_price
      );
    end loop;

    insert into public.cottage_inventory_standard_prices (
      schedule_revision_id, unit_kind, unit_id, price_iqd
    ) values (
      target_schedule_revision_id, requested_kind, requested_unit_id, standard_price
    ) on conflict (schedule_revision_id, unit_kind, unit_id)
    do update set price_iqd = excluded.price_iqd;
  end loop;

  delete from public.cottage_inventory_standard_prices
  where schedule_revision_id = target_schedule_revision_id
    and not (unit_kind, unit_id) in (
      select (value ->> 'unitKind')::public.cottage_inventory_unit_kind,
        (value ->> 'unitId')::uuid
      from jsonb_array_elements(requested_prices -> 'units')
    );
  delete from public.cottage_inventory_weekday_price_overrides
  where schedule_revision_id = target_schedule_revision_id
    and not (unit_kind, unit_id) in (
      select (value ->> 'unitKind')::public.cottage_inventory_unit_kind,
        (value ->> 'unitId')::uuid
      from jsonb_array_elements(requested_prices -> 'units')
    );
  delete from public.cottage_inventory_date_price_overrides prices
  where prices.schedule_revision_id = target_schedule_revision_id
    and not (prices.unit_kind, prices.unit_id) in (
      select (value ->> 'unitKind')::public.cottage_inventory_unit_kind,
        (value ->> 'unitId')::uuid
      from jsonb_array_elements(requested_prices -> 'units')
    )
    and ((
      prices.service_day + case prices.unit_kind
        when 'shift'::public.cottage_inventory_unit_kind then (
          select shifts.start_time
          from public.cottage_shifts shifts
          where shifts.schedule_revision_id = prices.schedule_revision_id
            and shifts.id = prices.unit_id
        )
        when 'full_day_bundle'::public.cottage_inventory_unit_kind then (
          select min(shifts.start_time)
          from public.cottage_shifts shifts
          where shifts.schedule_revision_id = prices.schedule_revision_id
        )
      end
    ) at time zone 'Asia/Baghdad') > now();

  return jsonb_build_object(
    'profileId', target_profile_id,
    'scheduleRevisionId', target_schedule_revision_id
  );
end;
$$;

revoke all on function public.save_cottage_inventory_pricing(uuid, uuid, jsonb)
  from public;
grant execute on function public.save_cottage_inventory_pricing(uuid, uuid, jsonb)
  to authenticated;

create function public.load_cottage_inventory_owner_editor_state(
  target_profile_id uuid,
  target_schedule_revision_id uuid,
  target_service_day date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare profile public.owner_application_cottage_profiles;
declare unit record;
declare raw_state public.cottage_inventory_availability_state;
declare standard_price bigint;
declare weekday_overrides jsonb;
declare date_overrides jsonb;
declare item jsonb;
declare result jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1
    from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state in ('approved', 'expired', 'suspended')
  ) then
    raise exception 'Established Cottage Owner access is required' using errcode = '42501';
  end if;

  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id;
  if not found or profile.owner_user_id <> (select auth.uid()) then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if profile.current_shift_schedule_id is distinct from target_schedule_revision_id then
    raise exception 'The Shift Schedule revision is no longer current' using errcode = 'RC409';
  end if;

  for unit in
    select shifts.id as unit_id,
      'shift'::public.cottage_inventory_unit_kind as unit_kind,
      shifts.position as unit_position,
      shifts.start_time as unit_start_time
    from public.cottage_shifts shifts
    where shifts.schedule_revision_id = target_schedule_revision_id
    union all
    select revisions.full_day_bundle_id,
      'full_day_bundle'::public.cottage_inventory_unit_kind,
      2147483647,
      (
        select min(shifts.start_time)
        from public.cottage_shifts shifts
        where shifts.schedule_revision_id = revisions.id
      )
    from public.cottage_shift_schedule_revisions revisions
    where revisions.id = target_schedule_revision_id
    order by unit_position, unit_id
  loop
    select prices.price_iqd into standard_price
    from public.cottage_inventory_standard_prices prices
    where prices.schedule_revision_id = target_schedule_revision_id
      and prices.unit_kind = unit.unit_kind
      and prices.unit_id = unit.unit_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'weekday', prices.weekday,
      'priceIqd', prices.price_iqd
    ) order by prices.weekday), '[]'::jsonb) into weekday_overrides
    from public.cottage_inventory_weekday_price_overrides prices
    where prices.schedule_revision_id = target_schedule_revision_id
      and prices.unit_kind = unit.unit_kind
      and prices.unit_id = unit.unit_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'serviceDay', prices.service_day,
      'priceIqd', prices.price_iqd
    ) order by prices.service_day), '[]'::jsonb) into date_overrides
    from public.cottage_inventory_date_price_overrides prices
    where prices.schedule_revision_id = target_schedule_revision_id
      and prices.unit_kind = unit.unit_kind
      and prices.unit_id = unit.unit_id
      and ((prices.service_day + unit.unit_start_time) at time zone 'Asia/Baghdad') > now();

    item := jsonb_build_object(
      'id', unit.unit_id,
      'kind', unit.unit_kind,
      'standardPriceIqd', standard_price,
      'weekdayOverrides', weekday_overrides,
      'dateOverrides', date_overrides
    );
    if target_service_day is not null then
      select availability.state into raw_state
      from public.cottage_inventory_availability availability
      where availability.schedule_revision_id = target_schedule_revision_id
        and availability.unit_kind = unit.unit_kind
        and availability.unit_id = unit.unit_id
        and availability.service_day = target_service_day;
      item := item || jsonb_build_object(
        'ownerState', coalesce(
          raw_state,
          'closed'::public.cottage_inventory_availability_state
        )
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

revoke all on function public.load_cottage_inventory_owner_editor_state(uuid, uuid, date)
  from public;
grant execute on function public.load_cottage_inventory_owner_editor_state(uuid, uuid, date)
  to authenticated;

create function public.cottage_inventory_component_is_effectively_available(
  target_schedule_revision_id uuid,
  target_shift_id uuid,
  target_service_day date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.cottage_shifts shifts
    join public.cottage_inventory_availability availability
      on availability.schedule_revision_id = shifts.schedule_revision_id
      and availability.unit_kind = 'shift'::public.cottage_inventory_unit_kind
      and availability.unit_id = shifts.id
      and availability.service_day = target_service_day
      and availability.state = 'open'::public.cottage_inventory_availability_state
    where shifts.schedule_revision_id = target_schedule_revision_id
      and shifts.id = target_shift_id
      and (
        exists (
          select 1
          from public.cottage_inventory_date_price_overrides prices
          where prices.schedule_revision_id = shifts.schedule_revision_id
            and prices.unit_kind = 'shift'::public.cottage_inventory_unit_kind
            and prices.unit_id = shifts.id
            and prices.service_day = target_service_day
        )
        or exists (
          select 1
          from public.cottage_inventory_weekday_price_overrides prices
          where prices.schedule_revision_id = shifts.schedule_revision_id
            and prices.unit_kind = 'shift'::public.cottage_inventory_unit_kind
            and prices.unit_id = shifts.id
            and prices.weekday = extract(dow from target_service_day)::smallint
        )
        or exists (
          select 1
          from public.cottage_inventory_standard_prices prices
          where prices.schedule_revision_id = shifts.schedule_revision_id
            and prices.unit_kind = 'shift'::public.cottage_inventory_unit_kind
            and prices.unit_id = shifts.id
        )
      )
      and not exists (
        select 1
        from public.cottage_inventory_commitments commitments
        where commitments.schedule_revision_id = shifts.schedule_revision_id
          and commitments.unit_kind = 'shift'::public.cottage_inventory_unit_kind
          and commitments.unit_id = shifts.id
          and commitments.service_day = target_service_day
      )
  );
$$;

revoke all on function public.cottage_inventory_component_is_effectively_available(uuid, uuid, date)
  from public, anon, authenticated, service_role;

create function public.set_cottage_inventory_availability(
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
    select 1
    from public.account_contexts
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
      select min(shifts.start_time) into unit_start_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id;
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
      from public.cottage_inventory_commitments commitments
      where commitments.schedule_revision_id = target_schedule_revision_id
        and commitments.service_day = target_service_day
        and (
          (requested_kind = 'shift'::public.cottage_inventory_unit_kind
            and commitments.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind)
          or (requested_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
            and commitments.unit_kind = 'shift'::public.cottage_inventory_unit_kind)
          or commitments.unit_kind = requested_kind and commitments.unit_id = requested_unit_id
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
      and exists (
        select 1
        from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
          and not public.cottage_inventory_component_is_effectively_available(
            shifts.schedule_revision_id,
            shifts.id,
            target_service_day
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

revoke all on function public.set_cottage_inventory_availability(uuid, uuid, date, jsonb)
  from public;
grant execute on function public.set_cottage_inventory_availability(uuid, uuid, date, jsonb)
  to authenticated;

create function public.resolve_cottage_inventory(
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
declare direct_committed_price bigint;
declare direct_commitment_reference text;
declare related_committed_price bigint;
declare related_commitment_reference text;
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
      select 1
      from public.account_contexts contexts
      where contexts.user_id = (select auth.uid())
        and contexts.role = 'cottage_owner'
        and contexts.owner_approval_state in ('approved', 'expired', 'suspended')
    );
  privileged_view := owner_view or service_view;
  if not exists (
    select 1
    from public.cottage_shift_schedule_revisions revisions
    where revisions.id = target_schedule_revision_id
      and revisions.profile_id = target_profile_id
  ) then
    raise exception 'The Shift Schedule revision does not belong to the Cottage Profile'
      using errcode = '42501';
  end if;
  if not owner_view
    and not service_view
    and profile.current_publication_id is null then
    raise exception 'Cottage Profile availability is not public' using errcode = '42501';
  end if;
  if profile.current_shift_schedule_id is distinct from target_schedule_revision_id
    and not service_view then
    raise exception 'The Shift Schedule revision is no longer current' using errcode = 'RC409';
  end if;

  for unit in
    select shifts.id as unit_id,
      'shift'::public.cottage_inventory_unit_kind as unit_kind,
      shifts.start_time as start_time
    from public.cottage_shifts shifts
    where shifts.schedule_revision_id = target_schedule_revision_id
    union all
    select revisions.full_day_bundle_id,
      'full_day_bundle'::public.cottage_inventory_unit_kind,
      (select min(shifts.start_time)
       from public.cottage_shifts shifts
       where shifts.schedule_revision_id = revisions.id)
    from public.cottage_shift_schedule_revisions revisions
    where revisions.id = target_schedule_revision_id
    order by unit_kind, unit_id
  loop
    select availability.state into raw_state
    from public.cottage_inventory_availability availability
    where availability.schedule_revision_id = target_schedule_revision_id
      and availability.unit_kind = unit.unit_kind
      and availability.unit_id = unit.unit_id
      and availability.service_day = target_service_day;
    raw_state := coalesce(raw_state, 'closed'::public.cottage_inventory_availability_state);

    select prices.price_iqd into effective_price
    from public.cottage_inventory_date_price_overrides prices
    where prices.schedule_revision_id = target_schedule_revision_id
      and prices.unit_kind = unit.unit_kind
      and prices.unit_id = unit.unit_id
      and prices.service_day = target_service_day;
    if effective_price is null then
      select prices.price_iqd into effective_price
      from public.cottage_inventory_weekday_price_overrides prices
      where prices.schedule_revision_id = target_schedule_revision_id
        and prices.unit_kind = unit.unit_kind
        and prices.unit_id = unit.unit_id
        and prices.weekday = extract(dow from target_service_day)::smallint;
    end if;
    if effective_price is null then
      select prices.price_iqd into effective_price
      from public.cottage_inventory_standard_prices prices
      where prices.schedule_revision_id = target_schedule_revision_id
        and prices.unit_kind = unit.unit_kind
        and prices.unit_id = unit.unit_id;
    end if;

    committed := false;
    committed_price := null;
    commitment_reference := null;
    select commitments.committed_price_iqd, commitments.commitment_reference
      into direct_committed_price, direct_commitment_reference
    from public.cottage_inventory_commitments commitments
    where commitments.schedule_revision_id = target_schedule_revision_id
      and commitments.unit_kind = unit.unit_kind
      and commitments.unit_id = unit.unit_id
      and commitments.service_day = target_service_day;
    if found and direct_committed_price is not null then
      committed_price := direct_committed_price;
      commitment_reference := direct_commitment_reference;
      committed := true;
    end if;

    if unit.unit_kind = 'shift'::public.cottage_inventory_unit_kind then
      select commitments.committed_price_iqd, commitments.commitment_reference
        into related_committed_price, related_commitment_reference
      from public.cottage_inventory_commitments commitments
      where commitments.schedule_revision_id = target_schedule_revision_id
        and commitments.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
        and commitments.service_day = target_service_day
      limit 1;
      if found and related_committed_price is not null then
        committed_price := related_committed_price;
        commitment_reference := related_commitment_reference;
        committed := true;
      end if;
    else
      select commitments.committed_price_iqd, commitments.commitment_reference
        into related_committed_price, related_commitment_reference
      from public.cottage_inventory_commitments commitments
      where commitments.schedule_revision_id = target_schedule_revision_id
        and commitments.unit_kind = 'shift'::public.cottage_inventory_unit_kind
        and commitments.service_day = target_service_day
      order by commitments.created_at, commitments.id
      limit 1;
      if found and related_committed_price is not null then
        committed_price := related_committed_price;
        commitment_reference := related_commitment_reference;
        committed := true;
      end if;
    end if;
    if committed and privileged_view then effective_price := committed_price; end if;

    component_unavailable := false;
    if unit.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind then
      select exists (
        select 1
        from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
          and not public.cottage_inventory_component_is_effectively_available(
            shifts.schedule_revision_id,
            shifts.id,
            target_service_day
          )
      ) into component_unavailable;
    end if;

    item := jsonb_build_object(
      'id', unit.unit_id,
      'kind', unit.unit_kind,
      'priceIqd', effective_price,
      'available', (not committed
        and not component_unavailable
        and raw_state = 'open'::public.cottage_inventory_availability_state
        and effective_price is not null)
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

revoke all on function public.resolve_cottage_inventory(uuid, uuid, date)
  from public;
grant execute on function public.resolve_cottage_inventory(uuid, uuid, date)
  to authenticated, service_role;
