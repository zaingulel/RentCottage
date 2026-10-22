-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.cottage_booking_period_presentation (
  target_schedule_revision_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
begin
  if not exists (
    select 1
    from public.cottage_shift_schedule_revisions schedules
    join public.cottage_shifts morning
      on morning.schedule_revision_id = schedules.id and morning.position = 1
    join public.cottage_shifts evening
      on evening.schedule_revision_id = schedules.id and evening.position = 2
    where schedules.id = target_schedule_revision_id
      and morning.start_time < evening.start_time
      and (select count(*) from public.cottage_shifts shifts
        where shifts.schedule_revision_id = schedules.id) = 2
  ) then
    raise exception 'Current Booking Period presentation is unavailable'
      using errcode = 'RC204';
  end if;
  return 'morning-evening-v1';
end;
$function$;

REVOKE ALL ON FUNCTION public.cottage_booking_period_presentation(uuid) FROM PUBLIC;

CREATE FUNCTION public.get_public_booking_quote_presentation (
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
declare quote jsonb;
declare schedule_revision_id uuid;
begin
  quote := public.get_public_booking_quote_with_fingerprint(
    target_locale, target_slug, requested_search
  );
  if quote ->> 'status' <> 'quoted' then
    return quote;
  end if;
  select profiles.current_shift_schedule_id into schedule_revision_id
  from public.cottage_marketplace_listings listings
  join public.owner_application_cottage_profiles profiles on profiles.id = listings.profile_id
  where listings.public_slug = target_slug
    and public.is_cottage_publicly_discoverable(profiles.id);
  return quote || jsonb_build_object('periodPresentation',
    public.cottage_booking_period_presentation(schedule_revision_id));
end;
$function$;

REVOKE ALL ON FUNCTION public.get_public_booking_quote_presentation(public.cottage_profile_source_language, text, jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_public_booking_quote_presentation(public.cottage_profile_source_language, text, jsonb) TO anon;

GRANT ALL ON FUNCTION public.get_public_booking_quote_presentation(public.cottage_profile_source_language, text, jsonb) TO authenticated;

GRANT ALL ON FUNCTION public.get_public_booking_quote_presentation(public.cottage_profile_source_language, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.cottage_booking_period_presentation(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_public_booking_quote_presentation(public.cottage_profile_source_language, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_booking_quote_presentation(public.cottage_profile_source_language, text, jsonb) TO anon, authenticated, service_role;
