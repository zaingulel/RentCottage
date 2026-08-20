-- Owner Calendar commitment semantics and explicit public/private read boundaries.

create type public.cottage_inventory_commitment_status as enum (
  'pending_hold',
  'confirmed_booking'
);

alter table public.cottage_inventory_commitments
  add column status public.cottage_inventory_commitment_status;

do $$
begin
  if exists (
    select 1 from public.cottage_inventory_commitments where status is null
  ) then
    raise exception 'Existing Cottage Inventory commitments require explicit status classification';
  end if;
end;
$$;

alter table public.cottage_inventory_commitments
  alter column status set not null;

create function public.lock_cottage_inventory_profiles(target_profile_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform profiles.id
  from public.owner_application_cottage_profiles profiles
  where profiles.id = any(target_profile_ids)
  order by profiles.id
  for update;
end;
$$;

revoke all on function public.lock_cottage_inventory_profiles(uuid[])
  from public, anon, authenticated, service_role;

create function public.lock_cottage_inventory_commitment_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare profile_ids uuid[];
declare target_profile_id uuid;
declare unit_start_time time without time zone;
declare effective_price_iqd bigint;
begin
  select coalesce(array_agg(distinct revisions.profile_id order by revisions.profile_id), '{}')
    into profile_ids
  from public.cottage_shift_schedule_revisions revisions
  where revisions.id in (old.schedule_revision_id, new.schedule_revision_id);
  perform public.lock_cottage_inventory_profiles(profile_ids);
  if tg_op = 'UPDATE'
    and (
      new.schedule_revision_id is distinct from old.schedule_revision_id
      or new.unit_kind is distinct from old.unit_kind
      or new.unit_id is distinct from old.unit_id
      or new.service_day is distinct from old.service_day
      or new.committed_price_iqd is distinct from old.committed_price_iqd
    ) then
    raise exception 'Cottage Inventory commitment snapshots are immutable'
      using errcode = 'RC204';
  end if;
  if tg_op = 'UPDATE'
    and old.status = 'confirmed_booking'::public.cottage_inventory_commitment_status
    and new.status = 'pending_hold'::public.cottage_inventory_commitment_status then
    raise exception 'A Confirmed Booking cannot return to Pending Hold'
      using errcode = 'RC204';
  end if;
  if tg_op = 'UPDATE'
    and new.commitment_reference is distinct from old.commitment_reference
    and not (
      old.status = 'pending_hold'::public.cottage_inventory_commitment_status
      and new.status = 'confirmed_booking'::public.cottage_inventory_commitment_status
    ) then
    raise exception 'A commitment reference can change only when a Pending Hold is confirmed'
      using errcode = 'RC204';
  end if;
  if tg_op = 'INSERT' then
    select revisions.profile_id into target_profile_id
    from public.cottage_shift_schedule_revisions revisions
    where revisions.id = new.schedule_revision_id;
    if target_profile_id is null or not exists (
      select 1
      from public.owner_application_cottage_profiles profiles
      join public.cottage_publication_snapshots publications
        on publications.id = profiles.current_publication_id
        and publications.profile_id = profiles.id
      where profiles.id = target_profile_id
        and profiles.current_shift_schedule_id = new.schedule_revision_id
    ) then
      raise exception 'A Cottage Inventory commitment requires a published current Shift Schedule revision'
        using errcode = 'RC204';
    end if;

    if new.unit_kind = 'shift'::public.cottage_inventory_unit_kind then
      select shifts.start_time into unit_start_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = new.schedule_revision_id
        and shifts.id = new.unit_id;
    else
      select min(shifts.start_time) into unit_start_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = new.schedule_revision_id;
    end if;
    if unit_start_time is null
      or ((new.service_day + unit_start_time) at time zone 'Asia/Baghdad') <= now() then
      raise exception 'A Cottage Inventory commitment requires future inventory'
        using errcode = 'RC204';
    end if;
    select coalesce(
      (
        select prices.price_iqd
        from public.cottage_inventory_date_price_overrides prices
        where prices.schedule_revision_id = new.schedule_revision_id
          and prices.unit_kind = new.unit_kind
          and prices.unit_id = new.unit_id
          and prices.service_day = new.service_day
      ),
      (
        select prices.price_iqd
        from public.cottage_inventory_weekday_price_overrides prices
        where prices.schedule_revision_id = new.schedule_revision_id
          and prices.unit_kind = new.unit_kind
          and prices.unit_id = new.unit_id
          and prices.weekday = extract(dow from new.service_day)::smallint
      ),
      (
        select prices.price_iqd
        from public.cottage_inventory_standard_prices prices
        where prices.schedule_revision_id = new.schedule_revision_id
          and prices.unit_kind = new.unit_kind
          and prices.unit_id = new.unit_id
      )
    ) into effective_price_iqd;
    if not exists (
      select 1
      from public.cottage_inventory_availability availability
      where availability.schedule_revision_id = new.schedule_revision_id
        and availability.unit_kind = new.unit_kind
        and availability.unit_id = new.unit_id
        and availability.service_day = new.service_day
        and availability.state = 'open'::public.cottage_inventory_availability_state
    ) or effective_price_iqd is null
      or new.committed_price_iqd <> effective_price_iqd then
      raise exception 'A Cottage Inventory commitment requires open inventory at its effective price'
        using errcode = 'RC204';
    end if;
    if new.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      and exists (
        select 1
        from public.cottage_shifts shifts
        where shifts.schedule_revision_id = new.schedule_revision_id
          and not public.cottage_inventory_component_is_effectively_available(
            shifts.schedule_revision_id, shifts.id, new.service_day
          )
      ) then
      raise exception 'A Full-Day Bundle commitment requires every component Shift'
        using errcode = 'RC204';
    end if;
    if exists (
      select 1
      from public.cottage_inventory_commitments commitments
      where commitments.schedule_revision_id = new.schedule_revision_id
        and commitments.service_day = new.service_day
        and commitments.id <> new.id
        and (
          (new.unit_kind = 'shift'::public.cottage_inventory_unit_kind
            and commitments.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind)
          or (new.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
            and commitments.unit_kind = 'shift'::public.cottage_inventory_unit_kind)
        )
    ) then
      raise exception 'Overlapping Cottage Inventory is already committed'
        using errcode = 'RC204';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.lock_cottage_inventory_commitment_profile()
  from public;

create trigger lock_cottage_inventory_commitment_profile
before insert or update or delete on public.cottage_inventory_commitments
for each row execute function public.lock_cottage_inventory_commitment_profile();

create function public.cottage_inventory_commitment_end_at(
  target_schedule_revision_id uuid,
  target_unit_kind public.cottage_inventory_unit_kind,
  target_unit_id uuid,
  target_service_day date
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(
    (
      target_service_day
      + shifts.end_time
      + case
          when shifts.end_time < shifts.start_time then interval '1 day'
          else interval '0 days'
        end
    ) at time zone 'Asia/Baghdad'
  )
  from public.cottage_shift_schedule_revisions revisions
  join public.cottage_shifts shifts
    on shifts.schedule_revision_id = revisions.id
  where revisions.id = target_schedule_revision_id
    and (
      (
        target_unit_kind = 'shift'::public.cottage_inventory_unit_kind
        and shifts.id = target_unit_id
      )
      or (
        target_unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
        and revisions.full_day_bundle_id = target_unit_id
      )
    );
$$;

revoke all on function public.cottage_inventory_commitment_end_at(
  uuid, public.cottage_inventory_unit_kind, uuid, date
) from public, anon, authenticated, service_role;

create function public.preserve_committed_cottage_shift_schedule_pointer()
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
      from public.cottage_inventory_commitments commitments
      where commitments.schedule_revision_id = old.current_shift_schedule_id
        and public.cottage_inventory_commitment_end_at(
          commitments.schedule_revision_id,
          commitments.unit_kind,
          commitments.unit_id,
          commitments.service_day
        ) > now()
    ) then
    raise exception 'A Shift Schedule with committed inventory cannot be replaced'
      using errcode = 'RC204';
  end if;
  return new;
end;
$$;

revoke all on function public.preserve_committed_cottage_shift_schedule_pointer()
  from public;

create trigger preserve_committed_cottage_shift_schedule_pointer
before update of current_shift_schedule_id
on public.owner_application_cottage_profiles
for each row execute function public.preserve_committed_cottage_shift_schedule_pointer();

alter function public.save_cottage_inventory_pricing(uuid, uuid, jsonb)
  rename to save_cottage_inventory_pricing_unchecked_dates;

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
    select distinct commitments.service_day, protected.unit_kind, protected.unit_id
    from public.cottage_inventory_commitments commitments
    join public.cottage_shift_schedule_revisions revisions
      on revisions.id = commitments.schedule_revision_id
    cross join lateral (
      select commitments.unit_kind, commitments.unit_id
      union
      select 'full_day_bundle'::public.cottage_inventory_unit_kind,
        revisions.full_day_bundle_id
      where commitments.unit_kind = 'shift'::public.cottage_inventory_unit_kind
      union
      select 'shift'::public.cottage_inventory_unit_kind, shifts.id
      from public.cottage_shifts shifts
      where commitments.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
        and shifts.schedule_revision_id = commitments.schedule_revision_id
    ) protected(unit_kind, unit_id)
    where commitments.schedule_revision_id = target_schedule_revision_id
      and public.cottage_inventory_commitment_end_at(
        commitments.schedule_revision_id,
        commitments.unit_kind,
        commitments.unit_id,
        commitments.service_day
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
      select min(shifts.start_time) into protected_start_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id;
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

revoke all on function public.save_cottage_inventory_pricing(uuid, uuid, jsonb)
  from public;
grant execute on function public.save_cottage_inventory_pricing(uuid, uuid, jsonb)
  to authenticated;
revoke all on function public.save_cottage_inventory_pricing_unchecked_dates(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

alter function public.set_cottage_inventory_availability(uuid, uuid, date, jsonb)
  rename to set_cottage_inventory_availability_changed_units;

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
      and not exists (
        select 1
        from public.cottage_inventory_commitments commitments
        where commitments.schedule_revision_id = target_schedule_revision_id
          and commitments.service_day = target_service_day
          and commitments.unit_kind = 'shift'::public.cottage_inventory_unit_kind
      )
      and exists (
        select 1
        from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
          and (
            not exists (
              select 1
              from public.cottage_inventory_availability availability
              where availability.schedule_revision_id = shifts.schedule_revision_id
                and availability.unit_kind = 'shift'::public.cottage_inventory_unit_kind
                and availability.unit_id = shifts.id
                and availability.service_day = target_service_day
                and availability.state = 'open'::public.cottage_inventory_availability_state
            )
            or not (
              exists (
                select 1 from public.cottage_inventory_date_price_overrides prices
                where prices.schedule_revision_id = shifts.schedule_revision_id
                  and prices.unit_kind = 'shift'::public.cottage_inventory_unit_kind
                  and prices.unit_id = shifts.id
                  and prices.service_day = target_service_day
              ) or exists (
                select 1 from public.cottage_inventory_weekday_price_overrides prices
                where prices.schedule_revision_id = shifts.schedule_revision_id
                  and prices.unit_kind = 'shift'::public.cottage_inventory_unit_kind
                  and prices.unit_id = shifts.id
                  and prices.weekday = extract(dow from target_service_day)::smallint
              ) or exists (
                select 1 from public.cottage_inventory_standard_prices prices
                where prices.schedule_revision_id = shifts.schedule_revision_id
                  and prices.unit_kind = 'shift'::public.cottage_inventory_unit_kind
                  and prices.unit_id = shifts.id
              )
            )
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
declare requested_unit jsonb;
declare current_state public.cottage_inventory_availability_state;
declare changed_states jsonb := '[]'::jsonb;
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
  if jsonb_typeof(requested_states) <> 'array' then
    raise exception 'Cottage Inventory availability input is invalid' using errcode = '22023';
  end if;
  for requested_unit in select value from jsonb_array_elements(requested_states)
  loop
    if jsonb_typeof(requested_unit) <> 'object'
      or (requested_unit ->> 'unitId') !~ '^[0-9a-fA-F-]{36}$'
      or (requested_unit ->> 'unitKind') not in ('shift', 'full_day_bundle')
      or (requested_unit ->> 'state') not in ('open', 'closed', 'private_blocked') then
      raise exception 'Cottage Inventory availability input is invalid' using errcode = '22023';
    end if;
    select availability.state into current_state
    from public.cottage_inventory_availability availability
    where availability.schedule_revision_id = target_schedule_revision_id
      and availability.unit_kind = (requested_unit ->> 'unitKind')::public.cottage_inventory_unit_kind
      and availability.unit_id = (requested_unit ->> 'unitId')::uuid
      and availability.service_day = target_service_day;
    current_state := coalesce(current_state, 'closed'::public.cottage_inventory_availability_state);
    if current_state::text is distinct from requested_unit ->> 'state' then
      changed_states := changed_states || jsonb_build_array(requested_unit);
    end if;
  end loop;
  if jsonb_array_length(changed_states) = 0 then
    return jsonb_build_object(
      'profileId', target_profile_id,
      'scheduleRevisionId', target_schedule_revision_id,
      'serviceDay', target_service_day
    );
  end if;
  return public.set_cottage_inventory_availability_changed_units(
    target_profile_id, target_schedule_revision_id, target_service_day, changed_states
  );
end;
$$;

revoke all on function public.set_cottage_inventory_availability(uuid, uuid, date, jsonb)
  from public;
grant execute on function public.set_cottage_inventory_availability(uuid, uuid, date, jsonb)
  to authenticated;
revoke all on function public.set_cottage_inventory_availability_changed_units(uuid, uuid, date, jsonb)
  from public, anon, authenticated, service_role;

create function public.resolve_cottage_inventory_public_availability(
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
begin
  original := public.resolve_cottage_inventory(
    target_profile_id, target_schedule_revision_id, target_service_day
  );
  return jsonb_build_object(
    'profileId', original -> 'profileId',
    'scheduleRevisionId', original -> 'scheduleRevisionId',
    'serviceDay', original -> 'serviceDay',
    'units', (
      select jsonb_agg(jsonb_build_object(
        'id', unit -> 'id',
        'kind', unit -> 'kind',
        'available', unit -> 'available'
      ))
      from jsonb_array_elements(original -> 'units') unit
    )
  );
end;
$$;

revoke all on function public.resolve_cottage_inventory_public_availability(uuid, uuid, date)
  from public;
grant execute on function public.resolve_cottage_inventory_public_availability(uuid, uuid, date)
  to anon, authenticated, service_role;

create function public.resolve_cottage_inventory_owner_calendar(
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
declare direct_commitment public.cottage_inventory_commitments;
declare bundle_commitment public.cottage_inventory_commitments;
declare component_commitment public.cottage_inventory_commitments;
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
    direct_commitment := null;
    bundle_commitment := null;
    component_commitment := null;
    select * into direct_commitment
    from public.cottage_inventory_commitments commitments
    where commitments.schedule_revision_id = target_schedule_revision_id
      and commitments.unit_kind = (unit ->> 'kind')::public.cottage_inventory_unit_kind
      and commitments.unit_id = (unit ->> 'id')::uuid
      and commitments.service_day = target_service_day;
    if unit ->> 'kind' = 'shift' then
      select * into bundle_commitment
      from public.cottage_inventory_commitments commitments
      where commitments.schedule_revision_id = target_schedule_revision_id
        and commitments.unit_kind = 'full_day_bundle'
        and commitments.service_day = target_service_day;
    else
      select * into component_commitment
      from public.cottage_inventory_commitments commitments
      where commitments.schedule_revision_id = target_schedule_revision_id
        and commitments.unit_kind = 'shift'
        and commitments.service_day = target_service_day
      order by commitments.created_at, commitments.id limit 1;
    end if;

    if direct_commitment.id is not null then
      state := direct_commitment.status::text;
      reference := direct_commitment.commitment_reference;
      editable := false;
    elsif bundle_commitment.id is not null then
      state := bundle_commitment.status::text;
      reference := bundle_commitment.commitment_reference;
      editable := false;
    elsif component_commitment.id is not null then
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

revoke all on function public.resolve_cottage_inventory_owner_calendar(uuid, uuid, date)
  from public;
grant execute on function public.resolve_cottage_inventory_owner_calendar(uuid, uuid, date)
  to authenticated, service_role;

revoke execute on function public.resolve_cottage_inventory(uuid, uuid, date)
  from anon, authenticated;
grant execute on function public.resolve_cottage_inventory(uuid, uuid, date)
  to service_role;

revoke all on public.cottage_inventory_commitments from anon, authenticated;
