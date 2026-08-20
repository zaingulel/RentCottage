-- Anonymous Booking Quotes are a current, non-reserving projection. They do
-- not create inventory commitments or persist a quote record.

create function public.get_public_booking_quote(
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
declare target record;
declare booking_price numeric;
declare quoted_items jsonb;
begin
  if target_locale is null then
    raise exception 'Booking Quote locale is required' using errcode = '22023';
  end if;
  if target_slug is null
    or octet_length(target_slug) <> 40
    or target_slug !~ '^cottage-[0-9a-f]{32}$' then
    raise exception 'Invalid public Cottage slug' using errcode = '22023';
  end if;
  if requested_search is null then
    raise exception 'Booking Quote search is required' using errcode = '22023';
  end if;
  perform public.validate_public_cottage_search(requested_search);

  select listings.public_slug, profiles.current_shift_schedule_id as schedule_id,
    publications.name, publications.publication_number,
    localizations.house_rules,
    publications.capacity >= (requested_search ->> 'guests')::integer
      and (not requested_search ? 'governorate'
        or lower(publications.governorate) = lower(btrim(requested_search ->> 'governorate')))
      and (not requested_search ? 'area'
        or lower(publications.approximate_location) = lower(btrim(requested_search ->> 'area')))
      and array(
        select value
        from jsonb_array_elements_text(
          coalesce(requested_search -> 'amenities', '[]'::jsonb)
        ) values(value)
      ) <@ publications.amenities as matches_search,
    public.resolve_public_cottage_selection(
      profiles.current_shift_schedule_id, requested_search
    ) as inventory
  into target
  from public.cottage_marketplace_listings listings
  join public.owner_application_cottage_profiles profiles
    on profiles.id = listings.profile_id
  join public.cottage_publication_snapshots publications
    on publications.id = profiles.current_publication_id
    and publications.profile_id = profiles.id
  join public.cottage_publication_localizations localizations
    on localizations.publication_id = publications.id
    and localizations.locale = target_locale
  where listings.public_slug = target_slug
    and public.is_cottage_publicly_discoverable(profiles.id);

  if not found then
    return jsonb_build_object('status', 'not-found');
  end if;
  if not target.matches_search
    or (target.inventory ->> 'allAvailable')::boolean is not true
    or target.inventory ->> 'totalPriceIqd' is null then
    return jsonb_build_object('status', 'selection-unavailable');
  end if;

  booking_price := (target.inventory ->> 'totalPriceIqd')::numeric;
  if booking_price <= 0
    or booking_price + 5000 > 9007199254740991 then
    raise exception 'Booking Quote money exceeds the safe range'
      using errcode = '22003';
  end if;

  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'serviceDay', item.value ->> 'serviceDay',
    'kind', item.value ->> 'kind',
    'position', (item.value ->> 'position')::smallint,
    'displayName', item.value ->> 'name',
    'startsAt', (item.value ->> 'serviceDay') || 'T'
      || (item.value ->> 'startTime') || ':00+03:00',
    'endsAt', to_char(
      (item.value ->> 'serviceDay')::date
        + case
            when (item.value ->> 'endTime')::time
              < (item.value ->> 'startTime')::time then 1
            else 0
          end,
      'YYYY-MM-DD'
    ) || 'T' || (item.value ->> 'endTime') || ':00+03:00',
    'crossesMidnight', (item.value ->> 'endTime')::time
      < (item.value ->> 'startTime')::time,
    'priceIqd', (item.value ->> 'priceIqd')::bigint
  )) order by item.ordinality)
  into quoted_items
  from jsonb_array_elements(target.inventory -> 'selectedInventory')
    with ordinality as item(value, ordinality);

  return jsonb_build_object(
    'status', 'quoted',
    'slug', target.public_slug,
    'cottageName', target.name,
    'contentVersion', target.publication_number,
    'houseRules', target.house_rules,
    'termsVersion', 'rentcottage-mvp-2026-08-04',
    'items', quoted_items,
    'bookingPriceIqd', booking_price::bigint,
    'serviceFeeIqd', 5000,
    'customerTotalIqd', (booking_price + 5000)::bigint
  );
end;
$$;

revoke all on function public.get_public_booking_quote(
  public.cottage_profile_source_language, text, jsonb
) from public;
grant execute on function public.get_public_booking_quote(
  public.cottage_profile_source_language, text, jsonb
) to anon, authenticated;
