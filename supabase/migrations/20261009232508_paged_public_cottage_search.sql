-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.search_public_cottages(target_locale public.cottage_profile_source_language, requested_search jsonb);

CREATE FUNCTION public.search_public_cottages (
  target_locale     public.cottage_profile_source_language,
  requested_search  jsonb,
  target_after_slug text,
  target_limit      integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  from_day date;
  to_day date;
  items jsonb;
  next_cursor text;
begin
  perform public.validate_public_cottage_discovery(requested_search);
  if target_limit is null or target_limit < 1 or target_limit > 12
    or target_after_slug !~ '^cottage-[0-9a-f]{32}$' then
    raise exception 'Public Cottage search input is invalid' using errcode = '22023';
  end if;
  from_day := (requested_search ->> 'from')::date;
  to_day := (requested_search ->> 'to')::date;
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
      and listings.public_slug > coalesce(target_after_slug, '')
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
  ), page as (
    select ordered.id, ordered.schedule_id, ordered.public_slug, ordered.name, ordered.governorate,
      ordered.approximate_location, ordered.capacity, ordered.amenities
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
    order by ordered.public_slug
    limit target_limit + 1
  ), enumerated as (
    select page.*, row_number() over (order by page.public_slug) as ordinal
    from page
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'slug', enumerated.public_slug,
      'name', enumerated.name,
      'governorate', enumerated.governorate,
      'approximateLocation', enumerated.approximate_location,
      'capacity', enumerated.capacity,
      'amenities', enumerated.amenities,
      'mediaIds', coalesce((
        select jsonb_agg(media.opaque_id order by media.position)
        from public.cottage_publication_media media
        where media.publication_id = enumerated.id
      ), '[]'::jsonb),
      'inventory', public.resolve_public_cottage_inventory(enumerated.schedule_id, from_day, to_day)
    ) order by enumerated.public_slug) filter (where enumerated.ordinal <= target_limit), '[]'::jsonb),
    case when count(*) > target_limit
      then max(enumerated.public_slug) filter (where enumerated.ordinal = target_limit) end
  into items, next_cursor
  from enumerated;

  return jsonb_build_object('items', items, 'nextCursor', next_cursor);
end;
$function$;

REVOKE ALL ON FUNCTION public.search_public_cottages(public.cottage_profile_source_language, jsonb, text, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.search_public_cottages(public.cottage_profile_source_language, jsonb, text, integer) TO anon;

GRANT ALL ON FUNCTION public.search_public_cottages(public.cottage_profile_source_language, jsonb, text, integer) TO authenticated;