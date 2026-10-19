-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.prepare_cottage_profile_photo_deletion(target_photo_id uuid);

DROP FUNCTION public.prepare_cottage_profile_photo_upload(target_profile_id uuid, requested_original_filename text, requested_media_type text, requested_size_bytes integer);

DROP FUNCTION
  public.update_administrator_cottage_profile(target_profile_id uuid, target_expected_version bigint, requested_name text, requested_governorate text,
  requested_approximate_location text,
  requested_exact_address text,
  requested_exact_latitude numeric,
  requested_exact_longitude numeric,
  requested_private_directions text,
  requested_capacity integer,
  requested_bedrooms integer,
  requested_bathrooms integer, requested_amenities text[], requested_source_language public.cottage_profile_source_language, requested_description text, requested_house_rules text);

CREATE FUNCTION public.prepare_cottage_profile_photo_deletion (
  target_photo_id  uuid,
  requested_reason text DEFAULT NULL::text
)
  RETURNS public.cottage_profile_photos
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  photo public.cottage_profile_photos;
  profile public.owner_application_cottage_profiles;
  actor_is_administrator boolean := (
    select public.is_platform_administrator('aal2') IS TRUE
  );
  normalized_reason text := regexp_replace(requested_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  retained_in_history boolean;
  target_profile_id uuid;
begin
  select profile_id into target_profile_id
  from public.cottage_profile_photos
  where id = target_photo_id;

  if not found then
    raise exception 'Cottage Profile photo was not found' using errcode = 'RC204';
  end if;
  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id
  for update;

  select * into photo
  from public.cottage_profile_photos
  where id = target_photo_id and profile_id = profile.id
  for update;
  if not found then
    raise exception 'Cottage Profile photo was not found' using errcode = 'RC204';
  end if;

  if not actor_is_administrator and (
    photo.owner_user_id = (select auth.uid())
    and profile.status = 'draft'
    and exists (
      select 1 from public.account_contexts
      where user_id = (select auth.uid())
        and role = 'cottage_owner'
        and owner_approval_state = 'approved'
    )
  ) IS NOT TRUE then
    raise exception 'Cottage Profile photo deletion is denied'
      using errcode = '42501';
  end if;
  if actor_is_administrator and (normalized_reason is null or char_length(normalized_reason) not between 1 and 1000) then
    raise exception 'An administrator reason of 1 to 1000 characters is required'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.cottage_profile_review_photos review_photos
    join public.cottage_profile_review_cycles cycles
      on cycles.id = review_photos.review_cycle_id
    where review_photos.photo_id = photo.id and cycles.state = 'in_review'
  ) then
    raise exception 'Active review media membership is immutable'
      using errcode = 'RC210';
  end if;
  if not photo.is_active then return photo; end if;
  if photo.state = 'deletion_pending' then
    if actor_is_administrator and not exists (
      select 1
      from public.cottage_profile_administrator_audit audit
      where audit.profile_id = profile.id
        and audit.administrator_user_id = (select auth.uid())
        and audit.event_kind = 'photo_deletion_recovered'
        and audit.object_path = photo.object_path
    ) then
      insert into public.cottage_profile_administrator_audit (
        profile_id, administrator_user_id, previous_version, resulting_version,
        changed_fields, event_kind, object_path, reason
      ) values (
        profile.id, (select auth.uid()), profile.version, profile.version,
        array['photos'], 'photo_deletion_recovered', photo.object_path, normalized_reason
      );
    end if;
    return photo;
  end if;

  retained_in_history :=
    exists (select 1 from public.cottage_profile_review_photos where photo_id = photo.id)
    or exists (select 1 from public.cottage_publication_media where photo_id = photo.id);

  if retained_in_history then
    update public.cottage_profile_photos
    set is_active = false,
        actor_user_id = (select auth.uid()),
        updated_at = now()
    where id = photo.id
    returning * into photo;
  else
    update public.cottage_profile_photos
    set state = 'deletion_pending',
        actor_user_id = (select auth.uid()),
        updated_at = now()
    where id = photo.id
    returning * into photo;
  end if;

  if actor_is_administrator then
    insert into public.cottage_profile_administrator_audit (
      profile_id, administrator_user_id, previous_version, resulting_version,
      changed_fields, event_kind, object_path, reason
    ) values (
      profile.id, (select auth.uid()), profile.version, profile.version,
      array['photos'], 'photo_deletion_prepared', photo.object_path, normalized_reason
    );
  end if;

  return photo;
end;
$function$;

REVOKE ALL ON FUNCTION public.prepare_cottage_profile_photo_deletion(uuid, text) FROM PUBLIC, anon, service_role;

GRANT ALL ON FUNCTION public.prepare_cottage_profile_photo_deletion(uuid, text) TO authenticated;

CREATE FUNCTION public.prepare_cottage_profile_photo_upload (
  target_profile_id           uuid,
  requested_original_filename text,
  requested_media_type        text,
  requested_size_bytes        integer,
  requested_reason            text    DEFAULT NULL::text
)
  RETURNS public.cottage_profile_photos
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  profile public.owner_application_cottage_profiles;
  photo public.cottage_profile_photos;
  extension text;
  actor_is_administrator boolean := (
    select public.is_platform_administrator('aal2') IS TRUE
  );
  normalized_reason text := regexp_replace(requested_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id
  for update;

  if not found then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if not actor_is_administrator and (
    profile.owner_user_id = (select auth.uid())
    and profile.status = 'draft'
    and exists (
      select 1 from public.account_contexts
      where user_id = (select auth.uid())
        and role = 'cottage_owner'
        and owner_approval_state = 'approved'
    )
  ) IS NOT TRUE then
    raise exception 'Cottage Profile photo access is denied'
      using errcode = '42501';
  end if;
  if actor_is_administrator and (normalized_reason is null or char_length(normalized_reason) not between 1 and 1000) then
    raise exception 'An administrator reason of 1 to 1000 characters is required'
      using errcode = '22023';
  end if;
  if requested_media_type not in ('image/jpeg', 'image/png', 'image/webp')
    or requested_size_bytes not between 1 and 5242880
    or char_length(btrim(coalesce(requested_original_filename, '')))
      not between 1 and 180 then
    raise exception 'The Cottage Profile photo is invalid'
      using errcode = 'RC205';
  end if;
  if (
    select count(*) from public.cottage_profile_photos
    where profile_id = profile.id and is_active
  ) >= 12 then
    raise exception 'A Cottage Profile can contain at most 12 photos'
      using errcode = 'RC205';
  end if;

  extension := case requested_media_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
  end;

  insert into public.cottage_profile_photos (
    profile_id, owner_user_id, actor_user_id, object_path,
    original_filename, media_type, size_bytes
  ) values (
    profile.id, profile.owner_user_id, (select auth.uid()),
    profile.owner_user_id::text || '/' || profile.id::text || '/'
      || gen_random_uuid()::text || '.' || extension,
    btrim(requested_original_filename), requested_media_type,
    requested_size_bytes
  ) returning * into photo;

  if actor_is_administrator then
    insert into public.cottage_profile_administrator_audit (
      profile_id, administrator_user_id, previous_version, resulting_version,
      changed_fields, event_kind, object_path, reason
    ) values (
      profile.id, (select auth.uid()), profile.version, profile.version,
      array['photos'], 'photo_upload_prepared', photo.object_path, normalized_reason
    );
  end if;

  return photo;
end;
$function$;

REVOKE ALL ON FUNCTION public.prepare_cottage_profile_photo_upload(uuid, text, text, integer, text) FROM PUBLIC, anon, service_role;

GRANT ALL ON FUNCTION public.prepare_cottage_profile_photo_upload(uuid, text, text, integer, text) TO authenticated;

CREATE FUNCTION public.update_administrator_cottage_profile (
  target_profile_id              uuid,
  target_expected_version        bigint,
  requested_name                 text,
  requested_governorate          text,
  requested_approximate_location text,
  requested_exact_address        text,
  requested_exact_latitude       numeric,
  requested_exact_longitude      numeric,
  requested_private_directions   text,
  requested_capacity             integer,
  requested_bedrooms             integer,
  requested_bathrooms            integer,
  requested_amenities            text[],
  requested_source_language      public.cottage_profile_source_language,
  requested_description          text,
  requested_house_rules          text,
  requested_reason               text                                   DEFAULT NULL::text
)
  RETURNS public.owner_application_cottage_profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  profile public.owner_application_cottage_profiles;
  previous_profile public.owner_application_cottage_profiles;
  ready_photo_count integer;
  changed_fields text[];
  normalized_reason text := regexp_replace(requested_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  if (select public.is_platform_administrator('aal2')) IS NOT TRUE then
    raise exception 'AAL2 Platform Administrator access is required'
      using errcode = '42501';
  end if;
  if normalized_reason is null or char_length(normalized_reason) not between 1 and 1000 then
    raise exception 'An administrator reason of 1 to 1000 characters is required'
      using errcode = '22023';
  end if;
  if target_expected_version is null or target_expected_version < 1 then
    raise exception 'A positive Cottage Profile version is required'
      using errcode = '22023';
  end if;

  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id
  for update;

  if not found then
    raise exception 'Cottage Profile was not found' using errcode = 'RC204';
  end if;
  if profile.version <> target_expected_version then
    raise exception 'The Cottage Profile changed before this administrator edit'
      using errcode = 'RC409';
  end if;
  previous_profile := profile;

  select * into profile
  from public.apply_cottage_profile_working_copy(
    profile.id, requested_name, requested_governorate,
    requested_approximate_location, requested_exact_address,
    requested_exact_latitude, requested_exact_longitude,
    requested_private_directions, requested_capacity, requested_bedrooms,
    requested_bathrooms, requested_amenities, requested_source_language,
    requested_description, requested_house_rules
  );

  if profile.status = 'submitted_for_content_approval' then
    ready_photo_count := public.cottage_profile_ready_photo_count(profile.id);
    if not public.cottage_profile_required_data_is_complete(profile.id)
      or ready_photo_count not between 1 and 12 then
      raise exception 'The submitted Cottage Profile must remain complete'
        using errcode = 'RC203';
    end if;
  end if;

  changed_fields := array_remove(array[
    case when profile.name is distinct from previous_profile.name
      then 'name' end,
    case when profile.governorate is distinct from previous_profile.governorate
      then 'governorate' end,
    case when profile.approximate_location
      is distinct from previous_profile.approximate_location
      then 'approximate_location' end,
    case when profile.exact_address is distinct from previous_profile.exact_address
      then 'exact_address' end,
    case when profile.exact_latitude is distinct from previous_profile.exact_latitude
      then 'exact_latitude' end,
    case when profile.exact_longitude is distinct from previous_profile.exact_longitude
      then 'exact_longitude' end,
    case when profile.private_directions
      is distinct from previous_profile.private_directions
      then 'private_directions' end,
    case when profile.capacity is distinct from previous_profile.capacity
      then 'capacity' end,
    case when profile.bedrooms is distinct from previous_profile.bedrooms
      then 'bedrooms' end,
    case when profile.bathrooms is distinct from previous_profile.bathrooms
      then 'bathrooms' end,
    case when profile.amenities is distinct from previous_profile.amenities
      then 'amenities' end,
    case when profile.source_language
      is distinct from previous_profile.source_language
      then 'source_language' end,
    case when profile.description is distinct from previous_profile.description
      then 'description' end,
    case when profile.house_rules is distinct from previous_profile.house_rules
      then 'house_rules' end
  ]::text[], null);

  insert into public.cottage_profile_administrator_audit (
    profile_id, administrator_user_id, previous_version, resulting_version,
    changed_fields, reason
  ) values (
    profile.id, (select auth.uid()), target_expected_version, profile.version,
    changed_fields, normalized_reason
  );

  return profile;
end;
$function$;

REVOKE ALL ON FUNCTION
  public.update_administrator_cottage_profile(uuid, bigint, text, text, text, text, numeric, numeric, text, integer, integer, integer, text[],
  public.cottage_profile_source_language, text, text, text) FROM PUBLIC, anon, service_role;

GRANT ALL ON FUNCTION
  public.update_administrator_cottage_profile(uuid, bigint, text, text, text, text, numeric, numeric, text, integer, integer, integer, text[],
  public.cottage_profile_source_language, text, text, text) TO authenticated;

ALTER TABLE public.cottage_profile_administrator_audit
  ADD COLUMN reason text;

ALTER TABLE public.cottage_profile_administrator_audit
  ADD CONSTRAINT cottage_profile_administrator_audit_reason_check
    CHECK (reason IS NULL OR reason = regexp_replace(reason, '^[[:space:]]+|[[:space:]]+$'::text, ''::text, 'g'::text) AND char_length(reason) >= 1 AND char_length(reason) <= 1000);
ALTER FUNCTION "public"."prepare_cottage_profile_photo_deletion"("target_photo_id" "uuid", "requested_reason" "text") OWNER TO "postgres";

ALTER FUNCTION "public"."prepare_cottage_profile_photo_upload"("target_profile_id" "uuid", "requested_original_filename" "text", "requested_media_type" "text", "requested_size_bytes" integer, "requested_reason" "text") OWNER TO "postgres";

ALTER FUNCTION "public"."update_administrator_cottage_profile"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_exact_latitude" numeric, "requested_exact_longitude" numeric, "requested_private_directions" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_source_language" "public"."cottage_profile_source_language", "requested_description" "text", "requested_house_rules" "text", "requested_reason" "text") OWNER TO "postgres";
