-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.get_public_cottage_profile (
  target_locale    public.cottage_profile_source_language,
  target_slug      text,
  requested_search jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare result jsonb;
begin
  perform public.validate_public_cottage_discovery(requested_search);
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
    'inventory', inventory.value
  ) into result
  from target
  cross join lateral (
    select public.resolve_public_cottage_inventory(
      target.schedule_id, (requested_search ->> 'from')::date, (requested_search ->> 'to')::date
    ) as value
  ) inventory;
  return result;
end;
$function$;

CREATE FUNCTION public.resolve_public_cottage_inventory (
  target_schedule_revision_id uuid,
  from_day                    date,
  to_day                      date
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  with units as (
    select shifts.id as unit_id,
      'shift'::public.cottage_inventory_unit_kind as unit_kind,
      shifts.position, shifts.name, shifts.start_time, shifts.end_time
    from public.cottage_shifts shifts
    where shifts.schedule_revision_id = target_schedule_revision_id
    union all
    select schedules.full_day_bundle_id,
      'full_day_bundle'::public.cottage_inventory_unit_kind,
      null::smallint, 'Full-day bundle'::text,
      (select shifts.start_time from public.cottage_shifts shifts
        where shifts.schedule_revision_id = schedules.id order by shifts.position limit 1),
      (select shifts.end_time from public.cottage_shifts shifts
        where shifts.schedule_revision_id = schedules.id order by shifts.position desc limit 1)
    from public.cottage_shift_schedule_revisions schedules
    where schedules.id = target_schedule_revision_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'serviceDay', to_char(days.service_day, 'YYYY-MM-DD'),
    'kind', case units.unit_kind when 'shift'::public.cottage_inventory_unit_kind then 'shift' else 'full-day' end,
    'name', units.name,
    'startTime', to_char(units.start_time, 'HH24:MI'),
    'endTime', to_char(units.end_time, 'HH24:MI'),
    'priceIqd', public.public_cottage_effective_price(
      target_schedule_revision_id, units.unit_kind, units.unit_id, days.service_day::date
    ),
    'available', coalesce(public.public_cottage_unit_is_available(
      target_schedule_revision_id, units.unit_kind, units.unit_id, days.service_day::date
    ), false)
  ) || case when units.position is not null then jsonb_build_object('position', units.position)
    else '{}'::jsonb end
    order by days.service_day, coalesce(units.position, 32767)), '[]'::jsonb)
  from generate_series(from_day::timestamp, to_day::timestamp, interval '1 day') days(service_day)
  cross join units;
$function$;

REVOKE ALL ON FUNCTION public.resolve_public_cottage_inventory(uuid, date, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.search_public_cottages (
  target_locale    public.cottage_profile_source_language,
  requested_search jsonb
)
  RETURNS SETOF jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform public.validate_public_cottage_discovery(requested_search);
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
    select candidates.*, inventory.value as public_inventory
    from candidates
    cross join lateral (
      select public.resolve_public_cottage_inventory(
        candidates.schedule_id, (requested_search ->> 'from')::date, (requested_search ->> 'to')::date
      ) as value
    ) inventory
    where not exists (
      select 1 from generate_series(
        (requested_search ->> 'from')::timestamp,
        (requested_search ->> 'to')::timestamp, interval '1 day'
      ) days(service_day)
      where not exists (
        select 1 from jsonb_array_elements(inventory.value) options(value)
        where value ->> 'serviceDay' = to_char(days.service_day, 'YYYY-MM-DD')
          and (value ->> 'available')::boolean
      )
    ) and not exists (
      select 1 from jsonb_array_elements(coalesce(requested_search -> 'selections', '[]'::jsonb)) filters(value)
      where not exists (
        select 1 from jsonb_array_elements(inventory.value) options(value)
        where options.value ->> 'serviceDay' = filters.value ->> 'serviceDay'
          and options.value ->> 'kind' = filters.value ->> 'kind'
          and (filters.value ->> 'kind' = 'full-day'
            or options.value ->> 'position' = filters.value ->> 'position')
          and (options.value ->> 'available')::boolean
      )
    )
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
    'inventory', matched.public_inventory
  )
  from matched
  order by matched.public_slug;
end;
$function$;

CREATE FUNCTION public.validate_public_cottage_discovery (
  requested_search jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare from_day date;
declare to_day date;
declare selections jsonb;
declare amenities jsonb;
declare selection jsonb;
declare selection_day date;
begin
  if requested_search is null or jsonb_typeof(requested_search) is distinct from 'object' then
    raise exception 'Public Cottage search input is invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(requested_search -> 'from') is distinct from 'string'
    or jsonb_typeof(requested_search -> 'to') is distinct from 'string'
    or jsonb_typeof(requested_search -> 'guests') is distinct from 'number'
    or exists (
      select 1 from jsonb_object_keys(requested_search) keys(key)
      where key not in ('from', 'to', 'selections', 'guests', 'governorate', 'area', 'amenities')
    ) then
    raise exception 'Public Cottage search input is invalid' using errcode = '22023';
  end if;
  selections := coalesce(requested_search -> 'selections', '[]'::jsonb);
  amenities := coalesce(requested_search -> 'amenities', '[]'::jsonb);
  if jsonb_typeof(selections) is distinct from 'array'
    or jsonb_typeof(amenities) is distinct from 'array' then
    raise exception 'Public Cottage search input is invalid' using errcode = '22023';
  end if;
  if requested_search ->> 'from' !~ '^\d{4}-\d{2}-\d{2}$'
    or requested_search ->> 'to' !~ '^\d{4}-\d{2}-\d{2}$'
    or requested_search ->> 'guests' !~ '^\d{1,3}$'
    or jsonb_array_length(selections) > 1200
    or exists (
      select 1 from jsonb_array_elements(amenities) items(value)
      where jsonb_typeof(value) is distinct from 'string'
    )
    or (requested_search ? 'governorate' and (
      jsonb_typeof(requested_search -> 'governorate') is distinct from 'string'
      or char_length(btrim(requested_search ->> 'governorate')) not between 1 and 120
    ))
    or (requested_search ? 'area' and (
      jsonb_typeof(requested_search -> 'area') is distinct from 'string'
      or char_length(btrim(requested_search ->> 'area')) not between 1 and 240
    )) then
    raise exception 'Public Cottage search input is invalid' using errcode = '22023';
  end if;
  if (requested_search ->> 'guests')::integer not between 1 and 100
    or exists (
      select 1 from jsonb_array_elements_text(amenities) items(value)
      where value not in ('garden', 'parking', 'pool', 'air_conditioning', 'wifi', 'outdoor_seating')
    )
    or jsonb_array_length(amenities)
      <> (select count(distinct value) from jsonb_array_elements_text(amenities) items(value)) then
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

  for selection in select value from jsonb_array_elements(selections)
  loop
    if jsonb_typeof(selection) is distinct from 'object' then
      raise exception 'Public Cottage search selection is invalid' using errcode = '22023';
    end if;
    if jsonb_typeof(selection -> 'serviceDay') is distinct from 'string'
      or jsonb_typeof(selection -> 'kind') is distinct from 'string'
      or exists (
        select 1 from jsonb_object_keys(selection) keys(key)
        where key not in ('serviceDay', 'kind', 'position')
      )
      or selection ->> 'serviceDay' !~ '^\d{4}-\d{2}-\d{2}$'
      or selection ->> 'kind' not in ('shift', 'full-day')
      or (selection ->> 'kind' = 'shift' and (
        jsonb_typeof(selection -> 'position') is distinct from 'number'
        or selection ->> 'position' !~ '^[1-3]$'
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
  if (select count(*) from jsonb_array_elements(selections)) <>
    (select count(distinct value) from jsonb_array_elements(selections))
    or exists (
      select 1 from jsonb_array_elements(selections) items(value)
      group by value ->> 'serviceDay'
      having bool_or(value ->> 'kind' = 'full-day') and count(*) <> 1
    ) then
    raise exception 'Public Cottage search contains conflicting selections' using errcode = '22023';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.validate_public_cottage_discovery(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.validate_public_cottage_search (
  requested_search jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare day_cursor date;
begin
  perform public.validate_public_cottage_discovery(requested_search);
  day_cursor := (requested_search ->> 'from')::date;
  while day_cursor <= (requested_search ->> 'to')::date loop
    if not exists (
      select 1 from jsonb_array_elements(coalesce(requested_search -> 'selections', '[]'::jsonb)) selections(value)
      where (value ->> 'serviceDay')::date = day_cursor
    ) then
      raise exception 'Every Service Day requires a Cottage Shift selection' using errcode = '22023';
    end if;
    day_cursor := day_cursor + 1;
  end loop;
end;
$function$;