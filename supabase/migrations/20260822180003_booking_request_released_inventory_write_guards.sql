-- Released Booking Period history remains immutable, but only active
-- occupancies protect future pricing and Shift Schedule writes.

create or replace function public.save_cottage_inventory_pricing_active_profile(
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
      and (
        (
          items.unit_kind = 'shift'::public.cottage_inventory_unit_kind
          and exists (
            select 1
            from public.cottage_booking_period_occupancies occupancies
            where occupancies.booking_period_commitment_id = periods.id
              and occupancies.schedule_revision_id = periods.schedule_revision_id
              and occupancies.shift_id = items.unit_id
              and occupancies.service_day = items.service_day
              and occupancies.active
          )
        )
        or (
          items.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
          and exists (
            select 1
            from public.cottage_booking_period_occupancies occupancies
            where occupancies.booking_period_commitment_id = periods.id
              and occupancies.schedule_revision_id = periods.schedule_revision_id
              and occupancies.service_day = items.service_day
              and occupancies.active
          )
        )
      )
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
      join public.cottage_booking_period_occupancies occupancies
        on occupancies.booking_period_commitment_id = commitments.id
        and occupancies.schedule_revision_id = commitments.schedule_revision_id
      cross join lateral unnest(commitments.access_ranges) access_range
      where commitments.schedule_revision_id = old.current_shift_schedule_id
        and occupancies.active
        and upper(access_range) > now()
    ) then
    raise exception 'A Shift Schedule with committed inventory cannot be replaced'
      using errcode = 'RC204';
  end if;
  return new;
end;
$$;
