-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE SCHEMA private AUTHORIZATION postgres;

GRANT USAGE ON SCHEMA private TO authenticated;

CREATE FUNCTION private.read_owner_cottage_profile_draft_progress (
  target_profile_ids uuid[]
)
  RETURNS TABLE (
    profile_id             uuid,
    profile_version        bigint,
    completed_requirements integer,
    next_requirement       text,
    submission_allowed     boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  owner_context public.account_contexts;
begin
  if target_profile_ids is null
    or coalesce(array_ndims(target_profile_ids), 1) <> 1
    or cardinality(target_profile_ids) > 100
    or exists (select 1 from unnest(target_profile_ids) ids(id) where id is null)
    or (select count(distinct id) from unnest(target_profile_ids) ids(id)) <> cardinality(target_profile_ids) then
    raise exception 'One hundred unique non-null Cottage Profile IDs at most are required' using errcode = '22023';
  end if;
  select * into owner_context from public.account_contexts where user_id = (select auth.uid());
  if not found or owner_context.role <> 'cottage_owner'
    or owner_context.owner_approval_state not in ('approved', 'expired', 'suspended') then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(target_profile_ids) ids(id)
    where not exists (
      select 1 from public.owner_application_cottage_profiles profiles
      where profiles.id = ids.id and profiles.owner_user_id = owner_context.user_id
    )
  ) then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  return query
  select profiles.id, profiles.version,
    count(*) filter (where requirements.complete)::integer,
    (array_agg(requirements.key order by requirements.ordinal) filter (where not requirements.complete))[1],
    owner_context.owner_approval_state = 'approved'
  from public.owner_application_cottage_profiles profiles
  cross join lateral (
    select count(*)::integer as active_count
    from public.cottage_profile_photos photos
    where photos.profile_id = profiles.id and photos.is_active
  ) photos
  cross join lateral (values
    (1, 'name', profiles.name is not null),
    (2, 'governorate', profiles.governorate is not null),
    (3, 'approximateLocation', profiles.approximate_location is not null),
    (4, 'capacity', profiles.capacity is not null),
    (5, 'bedrooms', profiles.bedrooms is not null),
    (6, 'bathrooms', profiles.bathrooms is not null),
    (7, 'amenities', cardinality(profiles.amenities) >= 1),
    (8, 'exactPoint', profiles.exact_latitude is not null and profiles.exact_longitude is not null),
    (9, 'privateDirections', profiles.private_directions is not null),
    (10, 'sourceLanguage', profiles.source_language is not null),
    (11, 'description', profiles.description is not null),
    (12, 'houseRules', profiles.house_rules is not null),
    (13, 'photos', photos.active_count between 1 and 12
      and public.cottage_profile_ready_photo_count(profiles.id) = photos.active_count)
  ) requirements(ordinal, key, complete)
  where profiles.id = any(target_profile_ids)
    and profiles.status = 'draft' and profiles.current_publication_id is null
  group by profiles.id;
end;
$function$;

REVOKE ALL ON FUNCTION private.read_owner_cottage_profile_draft_progress(uuid[]) FROM PUBLIC;

GRANT ALL ON FUNCTION private.read_owner_cottage_profile_draft_progress(uuid[]) TO authenticated;

CREATE FUNCTION public.read_owner_cottage_profile_draft_progress (
  target_profile_ids uuid[]
)
  RETURNS TABLE (
    profile_id             uuid,
    profile_version        bigint,
    completed_requirements integer,
    next_requirement       text,
    submission_allowed     boolean
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select * from private.read_owner_cottage_profile_draft_progress(target_profile_ids);
$function$;

REVOKE ALL ON FUNCTION public.read_owner_cottage_profile_draft_progress(uuid[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.read_owner_cottage_profile_draft_progress(uuid[]) TO authenticated;

REVOKE ALL ON SCHEMA private FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA private TO authenticated;
REVOKE ALL ON FUNCTION private.read_owner_cottage_profile_draft_progress(uuid[]),public.read_owner_cottage_profile_draft_progress(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.read_owner_cottage_profile_draft_progress(uuid[]),public.read_owner_cottage_profile_draft_progress(uuid[]) TO authenticated;
