-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.resolve_public_cottage_inventory (
  target_schedule_revision_id uuid,
  from_day                    date,
  to_day                      date
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'serviceDay', to_char(units.service_day, 'YYYY-MM-DD'),
    'kind', case units.unit_kind when 'shift'::public.cottage_inventory_unit_kind then 'shift' else 'full-day' end,
    'name', units.name,
    'startTime', to_char(units.start_time, 'HH24:MI'),
    'endTime', to_char(units.end_time, 'HH24:MI'),
    'priceIqd', units.price_iqd,
    'available', units.available
  ) || case when units.unit_position is not null then jsonb_build_object('position', units.unit_position)
    else '{}'::jsonb end
    order by units.service_day, coalesce(units.unit_position, 32767)), '[]'::jsonb)
  from public.public_cottage_inventory_units(target_schedule_revision_id, from_day, to_day) units;
$function$;

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
declare
  from_day date;
  to_day date;
begin
  perform public.validate_public_cottage_discovery(requested_search);
  from_day := (requested_search ->> 'from')::date;
  to_day := (requested_search ->> 'to')::date;
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
  ), selections as (
    select filters.value ->> 'serviceDay' as service_day, filters.value ->> 'kind' as kind,
      filters.value ->> 'position' as unit_position
    from jsonb_array_elements(coalesce(requested_search -> 'selections', '[]'::jsonb)) filters(value)
  )
  select jsonb_build_object(
    'slug', ordered.public_slug,
    'name', ordered.name,
    'governorate', ordered.governorate,
    'approximateLocation', ordered.approximate_location,
    'capacity', ordered.capacity,
    'amenities', ordered.amenities,
    'mediaIds', coalesce((
      select jsonb_agg(media.opaque_id order by media.position)
      from public.cottage_publication_media media
      where media.publication_id = ordered.id
    ), '[]'::jsonb),
    'inventory', public.resolve_public_cottage_inventory(ordered.schedule_id, from_day, to_day)
  )
  from (
    select candidates.* from candidates
    -- offset 0 keeps the availability check above candidate assembly and ordering.
    order by candidates.public_slug offset 0
  ) ordered
  where (
    select count(distinct units.service_day) filter (where units.available) = (to_day - from_day + 1)
      and count(*) filter (where units.available and selections.service_day is not null)
        = (select count(*) from selections)
    from public.public_cottage_inventory_units(ordered.schedule_id, from_day, to_day) units
    left join selections
      on selections.service_day = to_char(units.service_day, 'YYYY-MM-DD')
      and selections.kind = case units.unit_kind
        when 'shift'::public.cottage_inventory_unit_kind then 'shift' else 'full-day' end
      and (selections.kind = 'full-day' or selections.unit_position = units.unit_position::text)
  )
  order by ordered.public_slug;
end;
$function$;