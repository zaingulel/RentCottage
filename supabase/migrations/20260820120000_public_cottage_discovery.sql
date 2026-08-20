-- Public Cottage discovery is projected only from immutable approved content,
-- the current Shift Schedule, and current dated inventory.

create type public.cottage_marketplace_state as enum (
  'published',
  'paused',
  'suspended'
);

create table public.cottage_marketplace_listings (
  profile_id uuid primary key
    references public.owner_application_cottage_profiles (id) on delete cascade,
  public_slug text not null unique
    check (public_slug ~ '^cottage-[0-9a-f]{32}$'),
  state public.cottage_marketplace_state not null,
  updated_at timestamptz not null default now()
);

alter table public.cottage_marketplace_listings enable row level security;
revoke all on public.cottage_marketplace_listings from anon, authenticated;

insert into public.cottage_marketplace_listings (profile_id, public_slug, state)
select profiles.id,
  'cottage-' || replace(profiles.id::text, '-', ''),
  'published'::public.cottage_marketplace_state
from public.owner_application_cottage_profiles profiles
join public.cottage_publication_snapshots publications
  on publications.id = profiles.current_publication_id
  and publications.profile_id = profiles.id
order by profiles.id;

create function public.register_cottage_marketplace_listing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_publication_id is not null
    and new.current_publication_id is distinct from old.current_publication_id
    and exists (
      select 1 from public.cottage_publication_snapshots publications
      where publications.id = new.current_publication_id
        and publications.profile_id = new.id
    ) then
    insert into public.cottage_marketplace_listings (profile_id, public_slug, state)
    values (
      new.id,
      'cottage-' || replace(new.id::text, '-', ''),
      'published'::public.cottage_marketplace_state
    ) on conflict (profile_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.register_cottage_marketplace_listing() from public;

create trigger register_cottage_marketplace_listing
after update of current_publication_id
on public.owner_application_cottage_profiles
for each row execute function public.register_cottage_marketplace_listing();

create function public.is_cottage_publicly_discoverable(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.owner_application_cottage_profiles profiles
    join public.account_contexts contexts
      on contexts.user_id = profiles.owner_user_id
      and contexts.role = 'cottage_owner'
      and contexts.owner_approval_state = 'approved'
    join public.cottage_marketplace_listings listings
      on listings.profile_id = profiles.id
      and listings.state = 'published'::public.cottage_marketplace_state
    join public.cottage_publication_snapshots publications
      on publications.id = profiles.current_publication_id
      and publications.profile_id = profiles.id
    join public.cottage_shift_schedule_revisions schedules
      on schedules.id = profiles.current_shift_schedule_id
      and schedules.profile_id = profiles.id
    where profiles.id = target_profile_id
  );
$$;

revoke all on function public.is_cottage_publicly_discoverable(uuid)
  from public, anon, authenticated, service_role;

create function public.validate_public_cottage_search(requested_search jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare from_day date;
declare to_day date;
declare selection jsonb;
declare selection_day date;
declare day_cursor date;
begin
  if jsonb_typeof(requested_search) <> 'object'
    or exists (
      select 1 from jsonb_object_keys(requested_search) keys(key)
      where key not in ('from', 'to', 'selections', 'guests', 'governorate', 'area', 'amenities')
    )
    or coalesce(requested_search ->> 'from', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(requested_search ->> 'to', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or jsonb_typeof(requested_search -> 'selections') <> 'array'
    or jsonb_array_length(requested_search -> 'selections') not between 1 and 1200
    or jsonb_typeof(requested_search -> 'guests') <> 'number'
    or (requested_search ->> 'guests') !~ '^\d{1,3}$'
    or (requested_search ->> 'guests')::integer not between 1 and 100
    or jsonb_typeof(coalesce(requested_search -> 'amenities', '[]'::jsonb)) <> 'array'
    or exists (
      select 1 from jsonb_array_elements_text(coalesce(requested_search -> 'amenities', '[]'::jsonb)) amenities(value)
      where value not in ('garden', 'parking', 'pool', 'air_conditioning', 'wifi', 'outdoor_seating')
    )
    or jsonb_array_length(coalesce(requested_search -> 'amenities', '[]'::jsonb))
      <> (select count(distinct value) from jsonb_array_elements_text(coalesce(requested_search -> 'amenities', '[]'::jsonb)) amenities(value))
    or (requested_search ? 'governorate' and (
      jsonb_typeof(requested_search -> 'governorate') <> 'string'
      or char_length(btrim(requested_search ->> 'governorate')) not between 1 and 120
    ))
    or (requested_search ? 'area' and (
      jsonb_typeof(requested_search -> 'area') <> 'string'
      or char_length(btrim(requested_search ->> 'area')) not between 1 and 240
    )) then
    raise exception 'Public Cottage search input is invalid' using errcode = '22023';
  end if;

  begin
    from_day := (requested_search ->> 'from')::date;
    to_day := (requested_search ->> 'to')::date;
  exception when others then
    raise exception 'Public Cottage search input is invalid' using errcode = '22023';
  end;
  if from_day > to_day or to_day - from_day + 1 > 400 then
    raise exception 'Public Cottage search input is invalid' using errcode = '22023';
  end if;

  for selection in select value from jsonb_array_elements(requested_search -> 'selections')
  loop
    if jsonb_typeof(selection) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(selection) keys(key)
        where key not in ('serviceDay', 'kind', 'position')
      )
      or coalesce(selection ->> 'serviceDay', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(selection ->> 'kind', '') not in ('shift', 'full-day')
      or (selection ->> 'kind' = 'shift' and (
        jsonb_typeof(selection -> 'position') <> 'number'
        or (selection ->> 'position') !~ '^[1-3]$'
      ))
      or (selection ->> 'kind' = 'full-day' and selection ? 'position') then
      raise exception 'Public Cottage search selection is invalid' using errcode = '22023';
    end if;
    begin
      selection_day := (selection ->> 'serviceDay')::date;
    exception when others then
      raise exception 'Public Cottage search selection is invalid' using errcode = '22023';
    end;
    if selection_day < from_day or selection_day > to_day then
      raise exception 'Public Cottage search selection is outside its Booking Period' using errcode = '22023';
    end if;
  end loop;

  if (select count(*) from jsonb_array_elements(requested_search -> 'selections')) <>
    (select count(distinct value) from jsonb_array_elements(requested_search -> 'selections'))
    or exists (
      select 1
      from jsonb_array_elements(requested_search -> 'selections') selections(value)
      group by value ->> 'serviceDay'
      having bool_or(value ->> 'kind' = 'full-day') and count(*) <> 1
    ) then
    raise exception 'Public Cottage search contains conflicting selections' using errcode = '22023';
  end if;
  day_cursor := from_day;
  while day_cursor <= to_day loop
    if not exists (
      select 1 from jsonb_array_elements(requested_search -> 'selections') selections(value)
      where (value ->> 'serviceDay')::date = day_cursor
    ) then
      raise exception 'Every Service Day requires a Cottage Shift selection' using errcode = '22023';
    end if;
    day_cursor := day_cursor + 1;
  end loop;
end;
$$;

revoke all on function public.validate_public_cottage_search(jsonb)
  from public, anon, authenticated, service_role;

create function public.public_cottage_effective_price(
  target_schedule_revision_id uuid,
  target_unit_kind public.cottage_inventory_unit_kind,
  target_unit_id uuid,
  target_service_day date
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select prices.price_iqd from public.cottage_inventory_date_price_overrides prices
      where prices.schedule_revision_id = target_schedule_revision_id
        and prices.unit_kind = target_unit_kind and prices.unit_id = target_unit_id
        and prices.service_day = target_service_day),
    (select prices.price_iqd from public.cottage_inventory_weekday_price_overrides prices
      where prices.schedule_revision_id = target_schedule_revision_id
        and prices.unit_kind = target_unit_kind and prices.unit_id = target_unit_id
        and prices.weekday = extract(dow from target_service_day)::smallint),
    (select prices.price_iqd from public.cottage_inventory_standard_prices prices
      where prices.schedule_revision_id = target_schedule_revision_id
        and prices.unit_kind = target_unit_kind and prices.unit_id = target_unit_id)
  );
$$;

revoke all on function public.public_cottage_effective_price(uuid, public.cottage_inventory_unit_kind, uuid, date)
  from public, anon, authenticated, service_role;

create function public.public_cottage_unit_is_available(
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
      select 1 from public.cottage_inventory_commitments commitments
      where commitments.schedule_revision_id = target_schedule_revision_id
        and commitments.service_day = target_service_day
        and (
          commitments.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
          or target_unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
          or (commitments.unit_kind = target_unit_kind and commitments.unit_id = target_unit_id)
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
            select min(shifts.start_time) from public.cottage_shifts shifts
            where shifts.schedule_revision_id = schedules.id
          )) at time zone 'Asia/Baghdad') > now()
      )
    end;
$$;

revoke all on function public.public_cottage_unit_is_available(uuid, public.cottage_inventory_unit_kind, uuid, date)
  from public, anon, authenticated, service_role;

create function public.resolve_public_cottage_selection(
  target_schedule_revision_id uuid,
  requested_search jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'totalPriceIqd', case
      when count(selected.price_iqd) = count(*) then sum(selected.price_iqd)::bigint
      else null
    end,
    'selectedInventory', jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'serviceDay', selected.service_day,
      'kind', selected.kind,
      'position', selected.position,
      'name', selected.name,
      'startTime', to_char(selected.start_time, 'HH24:MI'),
      'endTime', to_char(selected.end_time, 'HH24:MI'),
      'priceIqd', selected.price_iqd,
      'available', selected.available
    )) order by selected.service_day, coalesce(selected.position, 32767)),
    'allAvailable', bool_and(selected.unit_id is not null and selected.available)
  )
  from (
    select selection.value ->> 'serviceDay' as service_day,
      selection.value ->> 'kind' as kind, units.unit_id, units.position,
      units.name, units.start_time, units.end_time,
      public.public_cottage_effective_price(
        target_schedule_revision_id, units.unit_kind, units.unit_id,
        (selection.value ->> 'serviceDay')::date
      ) as price_iqd,
      coalesce(public.public_cottage_unit_is_available(
        target_schedule_revision_id, units.unit_kind, units.unit_id,
        (selection.value ->> 'serviceDay')::date
      ), false) as available
    from jsonb_array_elements(requested_search -> 'selections') selection(value)
    left join lateral (
      select shifts.id as unit_id,
        'shift'::public.cottage_inventory_unit_kind as unit_kind,
        shifts.position, shifts.name, shifts.start_time, shifts.end_time
      from public.cottage_shifts shifts
      where selection.value ->> 'kind' = 'shift'
        and shifts.schedule_revision_id = target_schedule_revision_id
        and shifts.position = (selection.value ->> 'position')::smallint
      union all
      select schedules.full_day_bundle_id,
        'full_day_bundle'::public.cottage_inventory_unit_kind,
        null::smallint, 'Full-day bundle'::text,
        (select shifts.start_time from public.cottage_shifts shifts
          where shifts.schedule_revision_id = schedules.id order by shifts.position limit 1),
        (select shifts.end_time from public.cottage_shifts shifts
          where shifts.schedule_revision_id = schedules.id order by shifts.position desc limit 1)
      from public.cottage_shift_schedule_revisions schedules
      where selection.value ->> 'kind' = 'full-day'
        and schedules.id = target_schedule_revision_id
    ) units on true
  ) selected;
$$;

revoke all on function public.resolve_public_cottage_selection(uuid, jsonb)
  from public, anon, authenticated, service_role;

create function public.search_public_cottages(
  target_locale public.cottage_profile_source_language,
  requested_search jsonb
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.validate_public_cottage_search(requested_search);
  return query
  with candidates as (
    select profiles.id as profile_id, profiles.current_shift_schedule_id as schedule_id,
      listings.public_slug, publications.*, localizations.description,
      localizations.house_rules
    from public.owner_application_cottage_profiles profiles
    join public.cottage_marketplace_listings listings on listings.profile_id = profiles.id
    join public.cottage_publication_snapshots publications
      on publications.id = profiles.current_publication_id
    join public.cottage_publication_localizations localizations
      on localizations.publication_id = publications.id and localizations.locale = target_locale
    where public.is_cottage_publicly_discoverable(profiles.id)
      and publications.capacity >= (requested_search ->> 'guests')::integer
      and (not requested_search ? 'governorate'
        or lower(publications.governorate) = lower(btrim(requested_search ->> 'governorate')))
      and (not requested_search ? 'area'
        or lower(publications.approximate_location) = lower(btrim(requested_search ->> 'area')))
      and array(
        select value from jsonb_array_elements_text(coalesce(requested_search -> 'amenities', '[]'::jsonb)) values(value)
      ) <@ publications.amenities
  ), matched as (
    select candidates.*,
      (selection_totals.value ->> 'totalPriceIqd')::bigint as total_price_iqd,
      selection_totals.value -> 'selectedInventory' as selected_inventory
    from candidates
    cross join lateral (
      select public.resolve_public_cottage_selection(
        candidates.schedule_id, requested_search
      ) as value
    ) selection_totals
    where (selection_totals.value ->> 'allAvailable')::boolean
  )
  select jsonb_build_object(
    'slug', matched.public_slug,
    'name', matched.name,
    'governorate', matched.governorate,
    'approximateLocation', matched.approximate_location,
    'capacity', matched.capacity,
    'amenities', matched.amenities,
    'mediaIds', coalesce((
      select jsonb_agg(media.opaque_id order by media.position)
      from public.cottage_publication_media media
      where media.publication_id = matched.id
    ), '[]'::jsonb),
    'totalPriceIqd', matched.total_price_iqd,
    'selectedInventory', matched.selected_inventory
  )
  from matched
  order by matched.public_slug;
end;
$$;

revoke all on function public.search_public_cottages(public.cottage_profile_source_language, jsonb) from public;
grant execute on function public.search_public_cottages(public.cottage_profile_source_language, jsonb)
  to anon, authenticated;

create function public.get_public_cottage_facets(
  target_locale public.cottage_profile_source_language
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'governorates', coalesce((select jsonb_agg(value order by value) from (
      select distinct publications.governorate as value
      from public.owner_application_cottage_profiles profiles
      join public.cottage_publication_snapshots publications on publications.id = profiles.current_publication_id
      join public.cottage_publication_localizations localizations
        on localizations.publication_id = publications.id and localizations.locale = target_locale
      where public.is_cottage_publicly_discoverable(profiles.id)
    ) values), '[]'::jsonb),
    'areas', coalesce((select jsonb_agg(value order by value) from (
      select distinct publications.approximate_location as value
      from public.owner_application_cottage_profiles profiles
      join public.cottage_publication_snapshots publications on publications.id = profiles.current_publication_id
      join public.cottage_publication_localizations localizations
        on localizations.publication_id = publications.id and localizations.locale = target_locale
      where public.is_cottage_publicly_discoverable(profiles.id)
    ) values), '[]'::jsonb),
    'amenities', coalesce((select jsonb_agg(value order by value) from (
      select distinct unnest(publications.amenities) as value
      from public.owner_application_cottage_profiles profiles
      join public.cottage_publication_snapshots publications on publications.id = profiles.current_publication_id
      join public.cottage_publication_localizations localizations
        on localizations.publication_id = publications.id and localizations.locale = target_locale
      where public.is_cottage_publicly_discoverable(profiles.id)
    ) values), '[]'::jsonb)
  );
$$;

revoke all on function public.get_public_cottage_facets(public.cottage_profile_source_language) from public;
grant execute on function public.get_public_cottage_facets(public.cottage_profile_source_language)
  to anon, authenticated;

create function public.get_default_public_cottage_search(target_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare profile public.owner_application_cottage_profiles;
declare service_day date := (now() at time zone 'Asia/Baghdad')::date;
declare selections jsonb;
declare day_offset integer;
begin
  select profiles.* into profile
  from public.cottage_marketplace_listings listings
  join public.owner_application_cottage_profiles profiles on profiles.id = listings.profile_id
  where listings.public_slug = target_slug
    and public.is_cottage_publicly_discoverable(profiles.id);
  if not found then return null; end if;
  for day_offset in 0..1 loop
    select jsonb_agg(jsonb_build_object(
      'serviceDay', to_char(service_day + day_offset, 'YYYY-MM-DD'),
      'kind', 'shift',
      'position', shifts.position
    ) order by shifts.position) into selections
    from public.cottage_shifts shifts
    where shifts.schedule_revision_id = profile.current_shift_schedule_id
      and (day_offset = 1
        or ((service_day + shifts.start_time) at time zone 'Asia/Baghdad') > now());
    if selections is not null then
      return jsonb_build_object(
        'from', to_char(service_day + day_offset, 'YYYY-MM-DD'),
        'to', to_char(service_day + day_offset, 'YYYY-MM-DD'),
        'selections', selections,
        'guests', 1,
        'amenities', jsonb_build_array()
      );
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.get_default_public_cottage_search(text) from public;
grant execute on function public.get_default_public_cottage_search(text) to anon, authenticated;

create function public.get_public_cottage_profile(
  target_locale public.cottage_profile_source_language,
  target_slug text,
  requested_search jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  perform public.validate_public_cottage_search(requested_search);
  with target as (
    select listing.public_slug, profile.current_shift_schedule_id as schedule_id,
      publication.*, localization.description, localization.house_rules
    from public.cottage_marketplace_listings listing
    join public.owner_application_cottage_profiles profile on profile.id = listing.profile_id
    join public.cottage_publication_snapshots publication on publication.id = profile.current_publication_id
    join public.cottage_publication_localizations localization
      on localization.publication_id = publication.id and localization.locale = target_locale
    where listing.public_slug = target_slug
      and public.is_cottage_publicly_discoverable(profile.id)
  )
  select jsonb_build_object(
    'slug', target.public_slug,
    'name', target.name,
    'governorate', target.governorate,
    'approximateLocation', target.approximate_location,
    'capacity', target.capacity,
    'bedrooms', target.bedrooms,
    'bathrooms', target.bathrooms,
    'amenities', target.amenities,
    'description', target.description,
    'houseRules', target.house_rules,
    'mediaIds', coalesce((
      select jsonb_agg(media.opaque_id order by media.position)
      from public.cottage_publication_media media
      where media.publication_id = target.id
    ), '[]'::jsonb),
    'totalPriceIqd', (inventory.value ->> 'totalPriceIqd')::bigint,
    'selectedInventory', inventory.value -> 'selectedInventory'
  ) into result
  from target
  cross join lateral (
    select public.resolve_public_cottage_selection(
      target.schedule_id, requested_search
    ) as value
  ) inventory;
  return result;
end;
$$;

revoke all on function public.get_public_cottage_profile(public.cottage_profile_source_language, text, jsonb) from public;
grant execute on function public.get_public_cottage_profile(public.cottage_profile_source_language, text, jsonb)
  to anon, authenticated;

create or replace function public.resolve_cottage_inventory_public_availability(
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
  if not public.is_cottage_publicly_discoverable(target_profile_id)
    or not exists (
      select 1 from public.owner_application_cottage_profiles profiles
      where profiles.id = target_profile_id
        and profiles.current_shift_schedule_id = target_schedule_revision_id
    ) then
    raise exception 'Public Cottage inventory is unavailable' using errcode = 'RC204';
  end if;
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

create or replace function public.get_current_cottage_publication(
  target_profile_id uuid, target_locale public.cottage_profile_source_language
)
returns table (
  publication_id uuid, name text, governorate text, approximate_location text,
  capacity integer, bedrooms integer, bathrooms integer, amenities text[],
  description text, house_rules text, media_ids uuid[]
)
language sql stable security definer set search_path = '' as $$
  select publications.id, publications.name, publications.governorate,
    publications.approximate_location, publications.capacity,
    publications.bedrooms, publications.bathrooms, publications.amenities,
    localizations.description, localizations.house_rules,
    coalesce(array_agg(media.opaque_id order by media.position)
      filter (where media.opaque_id is not null), '{}'::uuid[])
  from public.owner_application_cottage_profiles profiles
  join public.cottage_publication_snapshots publications on publications.id = profiles.current_publication_id
  join public.cottage_publication_localizations localizations
    on localizations.publication_id = publications.id and localizations.locale = target_locale
  left join public.cottage_publication_media media on media.publication_id = publications.id
  where profiles.id = target_profile_id
    and public.is_cottage_publicly_discoverable(profiles.id)
  group by publications.id, localizations.description, localizations.house_rules;
$$;

revoke all on function public.get_current_cottage_publication(uuid, public.cottage_profile_source_language) from public;
grant execute on function public.get_current_cottage_publication(uuid, public.cottage_profile_source_language)
  to anon, authenticated;

create or replace function public.resolve_current_cottage_publication_media(target_opaque_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare target_path text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Publication media service access is required' using errcode = '42501';
  end if;
  select media.object_path into target_path
  from public.cottage_publication_media media
  join public.cottage_publication_snapshots publication on publication.id = media.publication_id
  join public.owner_application_cottage_profiles profile
    on profile.id = publication.profile_id and profile.current_publication_id = publication.id
  where media.opaque_id = target_opaque_id
    and public.is_cottage_publicly_discoverable(profile.id);
  if target_path is null then
    raise exception 'Publication media is unavailable' using errcode = 'RC204';
  end if;
  return target_path;
end;
$$;

revoke all on function public.resolve_current_cottage_publication_media(uuid) from public;
grant execute on function public.resolve_current_cottage_publication_media(uuid) to service_role;
