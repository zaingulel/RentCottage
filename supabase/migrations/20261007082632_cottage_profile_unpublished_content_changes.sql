-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.list_cottage_profile_unpublished_content_changes (
  target_profile_ids uuid[]
)
  RETURNS TABLE (
    profile_id                     uuid,
    has_unpublished_content_change boolean,
    profile_version                bigint,
    ready_photo_ids                uuid[]
  )
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
begin
  if target_profile_ids is null or cardinality(target_profile_ids) > 100 then
    raise exception 'Cottage Profile unpublished Content Change request is invalid'
      using errcode = '22023';
  end if;

  return query
  select
    profiles.id,
    (profiles.name, profiles.governorate, profiles.approximate_location,
      profiles.capacity, profiles.bedrooms, profiles.bathrooms)
      is distinct from
      (cycles.name, cycles.governorate, cycles.approximate_location,
        cycles.capacity, cycles.bedrooms, cycles.bathrooms)
    or not (profiles.amenities <@ cycles.amenities and profiles.amenities @> cycles.amenities)
    or profiles.source_language is distinct from sources.source_language
    or (profiles.description, profiles.house_rules)
      is distinct from (revisions.description, revisions.house_rules)
    or exists (
      select 1
      from public.cottage_profile_photos photos
      where photos.profile_id = profiles.id
        and photos.is_active
        and photos.state = 'ready'::public.cottage_profile_photo_state
        and not exists (
          select 1
          from public.cottage_profile_review_photos review_photos
          where review_photos.review_cycle_id = cycles.id
            and review_photos.photo_id = photos.id
        )
    )
    or exists (
      select 1
      from public.cottage_profile_review_photos review_photos
      where review_photos.review_cycle_id = cycles.id
        and not exists (
          select 1
          from public.cottage_profile_photos photos
          where photos.id = review_photos.photo_id
            and photos.is_active
            and photos.state = 'ready'::public.cottage_profile_photo_state
        )
    ),
    profiles.version,
    coalesce(
      (
        select array_agg(ready_photos.id order by ready_photos.id)
        from public.cottage_profile_photos ready_photos
        where ready_photos.profile_id = profiles.id
          and ready_photos.is_active
          and ready_photos.state = 'ready'::public.cottage_profile_photo_state
      ),
      '{}'::uuid[]
    )
  from public.owner_application_cottage_profiles profiles
  join public.cottage_profile_review_cycles cycles
    on cycles.profile_id = profiles.id
    and cycles.state = 'approved'
    and cycles.cycle_number = (
      select max(approved_cycles.cycle_number)
      from public.cottage_profile_review_cycles approved_cycles
      where approved_cycles.profile_id = profiles.id
        and approved_cycles.state = 'approved'
    )
  join public.cottage_profile_source_revisions sources
    on sources.id = cycles.source_revision_id
  join public.cottage_profile_localized_heads heads
    on heads.review_cycle_id = cycles.id
    and heads.locale = sources.source_language
  join (
    select id, description, house_rules
    from public.cottage_profile_localized_revisions
  ) revisions
    on revisions.id = heads.localized_revision_id
  where profiles.id = any (target_profile_ids);
end;
$function$;

REVOKE ALL ON FUNCTION public.list_cottage_profile_unpublished_content_changes(uuid[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_cottage_profile_unpublished_content_changes(uuid[]) TO authenticated;