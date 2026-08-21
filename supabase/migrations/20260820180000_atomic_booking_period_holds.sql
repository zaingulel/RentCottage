-- Atomic Booking Period commitments. One parent owns customer-visible state,
-- selected priced items remain immutable snapshots, and physical Shift
-- occupancy is the database-enforced cottage conflict boundary.

do $$
begin
  if exists (select 1 from public.cottage_inventory_commitments) then
    raise exception 'Existing Cottage Inventory commitments require an explicit Booking Period migration';
  end if;
end;
$$;

create extension if not exists btree_gist with schema extensions;

create table public.cottage_booking_period_commitments (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null
    references public.account_contexts (user_id) on delete restrict,
  profile_id uuid not null
    references public.owner_application_cottage_profiles (id) on delete restrict,
  schedule_revision_id uuid not null,
  commitment_reference text not null unique
    check (
      commitment_reference = btrim(commitment_reference)
      and commitment_reference ~ '^[A-Z0-9][A-Z0-9-]{0,119}$'
    ),
  status public.cottage_inventory_commitment_status not null,
  access_ranges tstzmultirange not null check (not isempty(access_ranges)),
  created_at timestamptz not null default now(),
  unique (id, schedule_revision_id),
  foreign key (schedule_revision_id, profile_id)
    references public.cottage_shift_schedule_revisions (id, profile_id)
    on delete restrict,
  constraint cottage_booking_period_customer_access_excl exclude using gist (
    customer_user_id with =,
    access_ranges with &&
  ) where (status in ('pending_hold', 'confirmed_booking'))
);

create function public.enforce_cottage_booking_period_commitment_transition()
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
  if new.status is distinct from old.status
    and not (
      old.status = 'pending_hold'::public.cottage_inventory_commitment_status
      and new.status = 'confirmed_booking'::public.cottage_inventory_commitment_status
    ) then
    raise exception 'Only a Pending Hold can become a Confirmed Booking'
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

revoke all on function public.enforce_cottage_booking_period_commitment_transition()
  from public, anon, authenticated, service_role;

create trigger enforce_cottage_booking_period_commitment_transition
before update on public.cottage_booking_period_commitments
for each row execute function public.enforce_cottage_booking_period_commitment_transition();

drop trigger lock_cottage_inventory_commitment_profile
  on public.cottage_inventory_commitments;
drop function public.lock_cottage_inventory_commitment_profile();
drop trigger assert_cottage_inventory_commitment_unit
  on public.cottage_inventory_commitments;

alter table public.cottage_inventory_commitments
  drop constraint cottage_inventory_commitments_schedule_revision_id_unit_kin_key,
  drop constraint cottage_inventory_commitments_schedule_revision_id_fkey,
  drop constraint cottage_inventory_commitments_commitment_reference_check,
  drop column schedule_revision_id,
  drop column commitment_reference,
  drop column status,
  add column booking_period_commitment_id uuid not null,
  add constraint cottage_inventory_commitments_booking_period_fkey
    foreign key (booking_period_commitment_id)
    references public.cottage_booking_period_commitments (id)
    on delete cascade,
  add constraint cottage_inventory_commitments_selected_unit_key
    unique (booking_period_commitment_id, service_day, unit_kind, unit_id);

create function public.assert_cottage_inventory_commitment_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_schedule_revision_id uuid;
begin
  select commitments.schedule_revision_id into target_schedule_revision_id
  from public.cottage_booking_period_commitments commitments
  where commitments.id = new.booking_period_commitment_id;
  if target_schedule_revision_id is null then
    raise exception 'The Booking Period commitment was not found' using errcode = '23503';
  end if;
  if new.unit_kind = 'shift'::public.cottage_inventory_unit_kind then
    if not exists (
      select 1 from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id
        and shifts.id = new.unit_id
    ) then
      raise exception 'The Cottage Inventory unit is not part of the Shift Schedule revision'
        using errcode = 'RC205';
    end if;
  elsif not exists (
    select 1 from public.cottage_shift_schedule_revisions revisions
    where revisions.id = target_schedule_revision_id
      and revisions.full_day_bundle_id = new.unit_id
  ) then
    raise exception 'The Cottage Inventory unit is not part of the Shift Schedule revision'
      using errcode = 'RC205';
  end if;
  return new;
end;
$$;

revoke all on function public.assert_cottage_inventory_commitment_unit()
  from public, anon, authenticated, service_role;

create trigger assert_cottage_inventory_commitment_unit
before insert or update on public.cottage_inventory_commitments
for each row execute function public.assert_cottage_inventory_commitment_unit();

create function public.reject_cottage_inventory_commitment_snapshot_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Cottage Inventory commitment snapshots are immutable'
    using errcode = 'RC204';
end;
$$;

revoke all on function public.reject_cottage_inventory_commitment_snapshot_update()
  from public, anon, authenticated, service_role;

create trigger reject_cottage_inventory_commitment_snapshot_update
before update on public.cottage_inventory_commitments
for each row execute function public.reject_cottage_inventory_commitment_snapshot_update();

create table public.cottage_booking_period_occupancies (
  booking_period_commitment_id uuid not null,
  schedule_revision_id uuid not null,
  shift_id uuid not null,
  service_day date not null,
  created_at timestamptz not null default now(),
  primary key (booking_period_commitment_id, shift_id, service_day),
  foreign key (booking_period_commitment_id, schedule_revision_id)
    references public.cottage_booking_period_commitments (id, schedule_revision_id)
    on delete cascade,
  foreign key (schedule_revision_id, shift_id)
    references public.cottage_shifts (schedule_revision_id, id)
    on delete restrict,
  unique (schedule_revision_id, shift_id, service_day)
);

create function public.reject_cottage_booking_period_occupancy_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Booking Period occupancy snapshots are immutable'
    using errcode = 'RC204';
end;
$$;

revoke all on function public.reject_cottage_booking_period_occupancy_update()
  from public, anon, authenticated, service_role;

create trigger reject_cottage_booking_period_occupancy_update
before update on public.cottage_booking_period_occupancies
for each row execute function public.reject_cottage_booking_period_occupancy_update();

alter table public.cottage_booking_period_commitments enable row level security;
alter table public.cottage_booking_period_occupancies enable row level security;

revoke all on public.cottage_booking_period_commitments,
  public.cottage_inventory_commitments,
  public.cottage_booking_period_occupancies
from anon, authenticated, service_role;

create or replace function public.preserve_committed_cottage_shift_schedule_pointer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_shift_schedule_id is distinct from old.current_shift_schedule_id
    and old.current_shift_schedule_id is not null
    and exists (
      select 1
      from public.cottage_booking_period_commitments commitments
      cross join lateral unnest(commitments.access_ranges) access_range
      where commitments.schedule_revision_id = old.current_shift_schedule_id
        and upper(access_range) > now()
    ) then
    raise exception 'A Shift Schedule with committed inventory cannot be replaced'
      using errcode = 'RC204';
  end if;
  return new;
end;
$$;

create or replace function public.cottage_inventory_component_is_effectively_available(
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
      and public.public_cottage_effective_price(
        shifts.schedule_revision_id,
        'shift'::public.cottage_inventory_unit_kind,
        shifts.id,
        target_service_day
      ) is not null
      and not exists (
        select 1
        from public.cottage_booking_period_occupancies occupancies
        where occupancies.schedule_revision_id = shifts.schedule_revision_id
          and occupancies.shift_id = shifts.id
          and occupancies.service_day = target_service_day
      )
  );
$$;

create or replace function public.public_cottage_unit_is_available(
  target_schedule_revision_id uuid,
  target_unit_kind public.cottage_inventory_unit_kind,
  target_unit_id uuid,
  target_service_day date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.public_cottage_effective_price(
      target_schedule_revision_id, target_unit_kind, target_unit_id, target_service_day
    ) is not null
    and exists (
      select 1 from public.cottage_inventory_availability availability
      where availability.schedule_revision_id = target_schedule_revision_id
        and availability.unit_kind = target_unit_kind
        and availability.unit_id = target_unit_id
        and availability.service_day = target_service_day
        and availability.state = 'open'::public.cottage_inventory_availability_state
    )
    and not exists (
      select 1
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.schedule_revision_id = target_schedule_revision_id
        and occupancies.service_day = target_service_day
        and (
          target_unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
          or occupancies.shift_id = target_unit_id
        )
    )
    and case target_unit_kind
      when 'shift'::public.cottage_inventory_unit_kind then exists (
        select 1 from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
          and shifts.id = target_unit_id
          and ((target_service_day + shifts.start_time) at time zone 'Asia/Baghdad') > now()
      )
      else exists (
        select 1 from public.cottage_shift_schedule_revisions schedules
        where schedules.id = target_schedule_revision_id
          and schedules.full_day_bundle_id = target_unit_id
          and not exists (
            select 1 from public.cottage_shifts shifts
            where shifts.schedule_revision_id = schedules.id
              and not public.cottage_inventory_component_is_effectively_available(
                schedules.id, shifts.id, target_service_day
              )
          )
          and ((target_service_day + (
            select shifts.start_time from public.cottage_shifts shifts
            where shifts.schedule_revision_id = schedules.id
            order by shifts.position limit 1
          )) at time zone 'Asia/Baghdad') > now()
      )
    end;
$$;

create or replace function public.save_cottage_inventory_pricing(
  target_profile_id uuid,
  target_schedule_revision_id uuid,
  requested_prices jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare commitment record;
declare requested_unit jsonb;
declare requested_override text;
declare requested_price bigint;
declare requested_effective_price bigint;
declare stored_price bigint;
declare protected_start_time time without time zone;
begin
  perform public.lock_cottage_inventory_profiles(array[target_profile_id]);
  if not exists (
    select 1
    from public.owner_application_cottage_profiles profiles
    join public.account_contexts contexts on contexts.user_id = profiles.owner_user_id
    where profiles.id = target_profile_id
      and profiles.owner_user_id = (select auth.uid())
      and profiles.current_shift_schedule_id = target_schedule_revision_id
      and contexts.role = 'cottage_owner'
      and contexts.owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required' using errcode = '42501';
  end if;
  if jsonb_typeof(requested_prices) <> 'object'
    or jsonb_typeof(requested_prices -> 'units') <> 'array' then
    raise exception 'Cottage Inventory pricing input is invalid' using errcode = '22023';
  end if;

  for commitment in
    select distinct items.service_day, protected.unit_kind, protected.unit_id
    from public.cottage_inventory_commitments items
    join public.cottage_booking_period_commitments periods
      on periods.id = items.booking_period_commitment_id
    join public.cottage_shift_schedule_revisions revisions
      on revisions.id = periods.schedule_revision_id
    cross join lateral (
      select items.unit_kind, items.unit_id
      union
      select 'full_day_bundle'::public.cottage_inventory_unit_kind,
        revisions.full_day_bundle_id
      where items.unit_kind = 'shift'::public.cottage_inventory_unit_kind
      union
      select 'shift'::public.cottage_inventory_unit_kind, shifts.id
      from public.cottage_shifts shifts
      where items.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
        and shifts.schedule_revision_id = periods.schedule_revision_id
    ) protected(unit_kind, unit_id)
    where periods.schedule_revision_id = target_schedule_revision_id
      and public.cottage_inventory_commitment_end_at(
        periods.schedule_revision_id,
        items.unit_kind,
        items.unit_id,
        items.service_day
      ) > now()
  loop
    requested_unit := null;
    requested_price := null;
    requested_effective_price := null;
    requested_override := null;
    stored_price := null;
    protected_start_time := null;
    select unit into requested_unit
    from jsonb_array_elements(requested_prices -> 'units') unit
    where (unit ->> 'unitKind')::public.cottage_inventory_unit_kind = commitment.unit_kind
      and (unit ->> 'unitId')::uuid = commitment.unit_id
    limit 1;
    if requested_unit is null then
      raise exception 'Pricing for committed or overlapping Cottage Inventory cannot be omitted'
        using errcode = 'RC204';
    end if;
    select override ->> 'priceIqd' into requested_override
    from jsonb_array_elements(coalesce(requested_unit -> 'dateOverrides', '[]'::jsonb)) override
    where (override ->> 'serviceDay')::date = commitment.service_day;
    if requested_override is not null then
      requested_price := requested_override::bigint;
    end if;
    select prices.price_iqd into stored_price
    from public.cottage_inventory_date_price_overrides prices
    where prices.schedule_revision_id = target_schedule_revision_id
      and prices.unit_kind = commitment.unit_kind
      and prices.unit_id = commitment.unit_id
      and prices.service_day = commitment.service_day;
    if commitment.unit_kind = 'shift'::public.cottage_inventory_unit_kind then
      select shifts.start_time into protected_start_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id
        and shifts.id = commitment.unit_id;
    else
      select shifts.start_time into protected_start_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id
      order by shifts.position limit 1;
    end if;
    if ((commitment.service_day + protected_start_time) at time zone 'Asia/Baghdad') > now()
      and requested_price is distinct from stored_price then
      raise exception 'Specific-date prices for committed Cottage Inventory cannot change'
        using errcode = 'RC204';
    end if;
    select coalesce(
      requested_price,
      (
        select (override ->> 'priceIqd')::bigint
        from jsonb_array_elements(
          coalesce(requested_unit -> 'weekdayOverrides', '[]'::jsonb)
        ) override
        where (override ->> 'weekday')::smallint =
          extract(dow from commitment.service_day)::smallint
        limit 1
      ),
      (requested_unit ->> 'standardPriceIqd')::bigint
    ) into requested_effective_price;
    if requested_effective_price is null then
      raise exception 'Committed or overlapping Cottage Inventory must remain priced'
        using errcode = 'RC204';
    end if;
  end loop;

  return public.save_cottage_inventory_pricing_unchecked_dates(
    target_profile_id, target_schedule_revision_id, requested_prices
  );
end;
$$;

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

create or replace function public.resolve_cottage_inventory_owner_calendar(
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

create function public.create_pending_booking_period_hold(
  target_customer_user_id uuid,
  target_profile_id uuid,
  target_commitment_reference text,
  requested_search jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
      and contexts.role = 'customer'::public.account_role
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
$$;

revoke all on function public.create_pending_booking_period_hold(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_pending_booking_period_hold(uuid, uuid, text, jsonb)
  to service_role;
