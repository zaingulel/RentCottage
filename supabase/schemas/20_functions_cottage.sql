SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
SET default_tablespace = '';
SET default_table_access_method = "heap";

CREATE OR REPLACE FUNCTION "public"."abandon_administrator_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_reason" "text") RETURNS "public"."owner_application_cottage_profiles"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.change_administrator_cottage_profile_draft_lifecycle(
    target_profile_id, target_expected_version, requested_reason, 'abandoned'
  );
$$;

ALTER FUNCTION "public"."abandon_administrator_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_reason" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."abandon_owner_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint) RETURNS "public"."owner_application_cottage_profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare profile public.owner_application_cottage_profiles;
declare owner_context public.account_contexts;
begin
  if target_expected_version is null or target_expected_version < 1 then
    raise exception 'A positive Cottage Profile version is required'
      using errcode = '22023';
  end if;
  select * into owner_context from public.account_contexts
  where user_id = (select auth.uid()) for update;
  if not found or owner_context.role <> 'cottage_owner'
    or owner_context.owner_approval_state <> 'approved' then
    raise exception 'Approved Cottage Owner access is required' using errcode = '42501';
  end if;
  select * into profile from public.owner_application_cottage_profiles
  where id = target_profile_id for update;
  if not found or profile.owner_user_id <> owner_context.user_id then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if profile.version <> target_expected_version then
    raise exception 'The Cottage Profile changed before abandonment' using errcode = 'RC409';
  end if;
  if profile.application_id is not null or profile.current_publication_id is not null
    or profile.status <> 'draft' then
    raise exception 'Only an additional unpublished draft can be abandoned'
      using errcode = 'RC202';
  end if;
  if exists (
    select 1 from public.cottage_profile_photos photos
    where photos.profile_id = profile.id and photos.state <> 'ready'
  ) then
    raise exception 'Pending Cottage Profile photo work must finish before abandonment'
      using errcode = 'RC202';
  end if;
  update public.owner_application_cottage_profiles
  set status = 'abandoned', version = version + 1,
      updated_at = statement_timestamp(), abandoned_at = statement_timestamp()
  where id = profile.id returning * into profile;
  return profile;
end;
$$;

ALTER FUNCTION "public"."abandon_owner_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."apply_cottage_profile_working_copy"("target_profile_id" "uuid", "requested_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_exact_latitude" numeric, "requested_exact_longitude" numeric, "requested_private_directions" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_source_language" "public"."cottage_profile_source_language", "requested_description" "text", "requested_house_rules" "text") RETURNS "public"."owner_application_cottage_profiles"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  update public.owner_application_cottage_profiles
  set name = nullif(btrim(coalesce(requested_name, '')), ''),
      governorate = nullif(btrim(coalesce(requested_governorate, '')), ''),
      approximate_location = nullif(btrim(coalesce(requested_approximate_location, '')), ''),
      exact_address = nullif(btrim(coalesce(requested_exact_address, '')), ''),
      exact_latitude = requested_exact_latitude,
      exact_longitude = requested_exact_longitude,
      private_directions = nullif(btrim(coalesce(requested_private_directions, '')), ''),
      capacity = requested_capacity,
      bedrooms = requested_bedrooms,
      bathrooms = requested_bathrooms,
      amenities = coalesce(requested_amenities, '{}'),
      source_language = requested_source_language,
      description = nullif(btrim(coalesce(requested_description, '')), ''),
      house_rules = nullif(btrim(coalesce(requested_house_rules, '')), ''),
      version = version + 1,
      updated_at = now()
  where id = target_profile_id
  returning *;
$$;

ALTER FUNCTION "public"."apply_cottage_profile_working_copy"("target_profile_id" "uuid", "requested_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_exact_latitude" numeric, "requested_exact_longitude" numeric, "requested_private_directions" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_source_language" "public"."cottage_profile_source_language", "requested_description" "text", "requested_house_rules" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."approve_cottage_profile_publication"("target_review_cycle_id" "uuid", "target_reason" "text") RETURNS "public"."cottage_publication_snapshots"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare cycle public.cottage_profile_review_cycles;
declare profile public.owner_application_cottage_profiles;
declare owner_context public.account_contexts;
declare publication public.cottage_publication_snapshots;
begin
  if not (select public.is_platform_administrator('aal2')) then raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501'; end if;
  select * into cycle from public.cottage_profile_review_cycles where id = target_review_cycle_id for update;
  if not found or cycle.state <> 'in_review' then raise exception 'Cottage review cycle is unavailable' using errcode = 'RC204'; end if;
  select * into profile from public.owner_application_cottage_profiles where id = cycle.profile_id for update;
  select * into owner_context from public.account_contexts
    where user_id = profile.owner_user_id for update;
  if not found or owner_context.role <> 'cottage_owner'
    or owner_context.owner_approval_state <> 'approved' then
    raise exception 'Approved Cottage Owner access is required' using errcode = '42501';
  end if;
  if not coalesce((
    select production_ready
    from public.cottage_translation_runtime_control
    where singleton
  ), false) then
    raise exception 'Production translation and publication are disabled by runtime control'
      using errcode = 'RC246';
  end if;
  if cycle.name is null or cycle.governorate is null or cycle.approximate_location is null
    or cycle.capacity is null or cycle.bedrooms is null or cycle.bathrooms is null
    or cardinality(cycle.amenities) < 1 then raise exception 'Reviewed public Cottage Profile fields are incomplete' using errcode = 'RC203'; end if;
  if (select count(*) from public.cottage_profile_localized_heads where review_cycle_id = cycle.id) <> 3 then raise exception 'All three localized heads are required' using errcode = 'RC203'; end if;
  if (select count(distinct revisions.locale)
      from public.cottage_profile_localized_revisions revisions
      join public.cottage_profile_source_revisions source on source.id = cycle.source_revision_id
      where revisions.review_cycle_id = cycle.id and revisions.origin = 'generated'
        and revisions.locale <> source.source_language) <> 2 then
    raise exception 'Both non-source languages require generated provenance' using errcode = 'RC203';
  end if;
  if exists (
    select 1 from public.cottage_profile_localized_heads heads
    where heads.review_cycle_id = cycle.id and (
      select decisions.approved
      from public.cottage_profile_localized_decisions decisions
      where decisions.review_cycle_id = heads.review_cycle_id
        and decisions.locale = heads.locale
        and decisions.localized_revision_id = heads.localized_revision_id
      order by decisions.decided_at desc, decisions.id desc
      limit 1
    ) is distinct from true
  ) then raise exception 'Every current localized head requires approval' using errcode = 'RC203'; end if;
  if not exists (select 1 from public.cottage_profile_review_photos where review_cycle_id = cycle.id) then raise exception 'Approved publication photos are required' using errcode = 'RC203'; end if;
  insert into public.cottage_publication_snapshots (
    profile_id, review_cycle_id, publication_number, name, governorate,
    approximate_location, capacity, bedrooms, bathrooms, amenities
  ) values (
    profile.id, cycle.id,
    coalesce((select max(publication_number) from public.cottage_publication_snapshots where profile_id = profile.id), 0) + 1,
    cycle.name, cycle.governorate, cycle.approximate_location,
    cycle.capacity, cycle.bedrooms, cycle.bathrooms, cycle.amenities
  ) returning * into publication;
  insert into public.cottage_publication_localizations (
    publication_id, locale, localized_revision_id, description, house_rules
  ) select publication.id, heads.locale, revisions.id, revisions.description, revisions.house_rules
    from public.cottage_profile_localized_heads heads
    join public.cottage_profile_localized_revisions revisions on revisions.id = heads.localized_revision_id
    where heads.review_cycle_id = cycle.id;
  insert into public.cottage_publication_media (publication_id, photo_id, object_path, media_type, position)
    select publication.id, photos.id, photos.object_path, photos.media_type, review_photos.position
    from public.cottage_profile_review_photos review_photos
    join public.cottage_profile_photos photos on photos.id = review_photos.photo_id
    where review_photos.review_cycle_id = cycle.id and photos.state = 'ready';
  if (select count(*) from public.cottage_publication_media where publication_id = publication.id)
      <> (select count(*) from public.cottage_profile_review_photos where review_cycle_id = cycle.id) then
    raise exception 'Approved publication photos are incomplete' using errcode = 'RC203';
  end if;
  insert into public.cottage_profile_publication_decisions (
    review_cycle_id, administrator_user_id, approved, reason
  ) values (cycle.id, (select auth.uid()), true, btrim(target_reason));
  update public.cottage_profile_review_cycles set state = 'approved', decided_at = now() where id = cycle.id;
  update public.owner_application_cottage_profiles
    set current_publication_id = publication.id, status = 'draft',
      submitted_source_revision_id = null, version = version + 1, updated_at = now()
    where id = profile.id;
  return publication;
end;
$$;

ALTER FUNCTION "public"."approve_cottage_profile_publication"("target_review_cycle_id" "uuid", "target_reason" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."assert_cottage_inventory_commitment_unit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare target_schedule_revision_id uuid;
begin
  select commitments.schedule_revision_id into target_schedule_revision_id
  from public.cottage_booking_period_commitments commitments
  where commitments.id = new.booking_period_commitment_id;
  if target_schedule_revision_id is null then
    raise exception 'The Booking Period commitment was not found' using errcode = '23503';
  end if;
  if new.unit_kind = 'shift'::public.cottage_inventory_unit_kind then
    if not exists (
      select 1 from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id
        and shifts.id = new.unit_id
    ) then
      raise exception 'The Cottage Inventory unit is not part of the Shift Schedule revision'
        using errcode = 'RC205';
    end if;
  elsif not exists (
    select 1 from public.cottage_shift_schedule_revisions revisions
    where revisions.id = target_schedule_revision_id
      and revisions.full_day_bundle_id = new.unit_id
  ) then
    raise exception 'The Cottage Inventory unit is not part of the Shift Schedule revision'
      using errcode = 'RC205';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."assert_cottage_inventory_commitment_unit"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."assert_cottage_inventory_unit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.unit_kind = 'shift'::public.cottage_inventory_unit_kind then
    if not exists (
      select 1
      from public.cottage_shifts shifts
      where shifts.id = new.unit_id
        and shifts.schedule_revision_id = new.schedule_revision_id
    ) then
      raise exception 'The Cottage Inventory unit is not part of the Shift Schedule revision'
        using errcode = 'RC205';
    end if;
  elsif not exists (
    select 1
    from public.cottage_shift_schedule_revisions revisions
    where revisions.id = new.schedule_revision_id
      and revisions.full_day_bundle_id = new.unit_id
  ) then
    raise exception 'The Cottage Inventory unit is not part of the Shift Schedule revision'
      using errcode = 'RC205';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."assert_cottage_inventory_unit"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."assign_owner_application_cottage_profile_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.owner_user_id is null and new.application_id is not null then
    select owner_user_id into new.owner_user_id
    from public.owner_applications
    where id = new.application_id;
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."assign_owner_application_cottage_profile_owner"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."begin_cottage_profile_translation"("target_review_cycle_id" "uuid", "target_language" "public"."cottage_profile_source_language") RETURNS "public"."cottage_profile_translation_attempts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare cycle public.cottage_profile_review_cycles;
declare source public.cottage_profile_source_revisions;
declare attempt public.cottage_profile_translation_attempts;
declare expected_head uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  if not coalesce((select production_ready from public.cottage_translation_runtime_control
      where singleton for share), false) then
    raise exception 'Production translation is disabled by runtime control' using errcode = 'RC246';
  end if;
  select * into cycle from public.cottage_profile_review_cycles
    where id = target_review_cycle_id for update;
  if not found or cycle.state <> 'in_review' then
    raise exception 'Cottage review cycle is unavailable' using errcode = 'RC204';
  end if;
  select * into source from public.cottage_profile_source_revisions where id = cycle.source_revision_id;
  if target_language = source.source_language then
    raise exception 'The source language does not require translation' using errcode = '22023';
  end if;
  select * into attempt from public.cottage_profile_translation_attempts attempts
    where attempts.review_cycle_id = cycle.id
      and attempts.target_language = begin_cottage_profile_translation.target_language
      and attempts.state = 'pending';
  if found then return attempt; end if;
  select localized_revision_id into expected_head
    from public.cottage_profile_localized_heads
    where review_cycle_id = cycle.id and locale = target_language;
  insert into public.cottage_profile_translation_attempts (
    review_cycle_id, source_revision_id, target_language,
    expected_localized_revision_id, attempt_number
  ) values (
    cycle.id, source.id, target_language, expected_head,
    coalesce((select max(attempt_number) from public.cottage_profile_translation_attempts
      where review_cycle_id = cycle.id
        and cottage_profile_translation_attempts.target_language = begin_cottage_profile_translation.target_language), 0) + 1
  ) returning * into attempt;
  return attempt;
end;
$$;

ALTER FUNCTION "public"."begin_cottage_profile_translation"("target_review_cycle_id" "uuid", "target_language" "public"."cottage_profile_source_language") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."begin_cottage_profile_translation_execution"("target_review_cycle_id" "uuid", "target_language" "public"."cottage_profile_source_language", "target_route" "text", "target_lease_milliseconds" integer) RETURNS "public"."cottage_profile_translation_attempts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare cycle public.cottage_profile_review_cycles;
declare source public.cottage_profile_source_revisions;
declare attempt public.cottage_profile_translation_attempts;
declare expected_head uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  if target_route not in ('ordinary', 'stronger_model') then
    raise exception 'Translation route is invalid' using errcode = '22023';
  end if;
  if target_lease_milliseconds not between 1000 and 900000 then
    raise exception 'Translation execution lease is invalid' using errcode = '22023';
  end if;
  if not coalesce((
    select production_ready
    from public.cottage_translation_runtime_control
    where singleton for share
  ), false) then
    raise exception 'Production translation is disabled' using errcode = 'RC246';
  end if;
  select * into cycle
  from public.cottage_profile_review_cycles
  where id = target_review_cycle_id
  for update;
  if not found or cycle.state <> 'in_review' then
    raise exception 'Cottage review cycle is unavailable' using errcode = 'RC204';
  end if;
  select * into source
  from public.cottage_profile_source_revisions
  where id = cycle.source_revision_id;
  if target_language = source.source_language then
    raise exception 'The source language does not require translation' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.cottage_profile_translation_human_reviews reviews
    where reviews.review_cycle_id = cycle.id
      and reviews.locale = target_language
      and reviews.state = 'active'
  ) then
    raise exception 'The current localization is routed to human review' using errcode = 'RC204';
  end if;
  select * into attempt
  from public.cottage_profile_translation_attempts attempts
  where attempts.review_cycle_id = cycle.id
    and attempts.target_language = begin_cottage_profile_translation_execution.target_language
    and attempts.state = 'pending'
  for update;
  if found and attempt.lease_expires_at > now() then
    raise exception 'Translation execution is already leased' using errcode = 'RC409';
  end if;
  if found then
    update public.cottage_profile_translation_attempts
    set state = 'superseded', completed_at = now()
    where id = attempt.id;
  end if;
  select localized_revision_id into expected_head
  from public.cottage_profile_localized_heads
  where review_cycle_id = cycle.id and locale = target_language;
  insert into public.cottage_profile_translation_attempts (
    review_cycle_id, source_revision_id, target_language,
    expected_localized_revision_id, attempt_number, route,
    lease_token, lease_expires_at
  ) values (
    cycle.id, source.id, target_language, expected_head,
    coalesce((
      select max(attempt_number)
      from public.cottage_profile_translation_attempts existing
      where existing.review_cycle_id = cycle.id
        and existing.target_language = begin_cottage_profile_translation_execution.target_language
    ), 0) + 1,
    target_route, gen_random_uuid(),
    now() + target_lease_milliseconds * interval '1 millisecond'
  ) returning * into attempt;
  return attempt;
end;
$$;

ALTER FUNCTION "public"."begin_cottage_profile_translation_execution"("target_review_cycle_id" "uuid", "target_language" "public"."cottage_profile_source_language", "target_route" "text", "target_lease_milliseconds" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."block_published_cottage_photo_deletion"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.is_active and not old.is_active then
    raise exception 'Retained Cottage Profile media cannot rejoin the working copy'
      using errcode = 'RC210';
  end if;
  if (new.state is distinct from old.state or new.is_active is distinct from old.is_active)
    and exists (
      select 1
      from public.cottage_profile_review_photos review_photos
      join public.cottage_profile_review_cycles cycles
        on cycles.id = review_photos.review_cycle_id
      where review_photos.photo_id = old.id and cycles.state = 'in_review'
    ) then
    raise exception 'Active review media membership is immutable' using errcode = 'RC210';
  end if;
  if new.state = 'deletion_pending' and old.state is distinct from new.state and (
    exists (select 1 from public.cottage_profile_review_photos where photo_id = old.id)
    or exists (select 1 from public.cottage_publication_media where photo_id = old.id)
  ) then
    raise exception 'Reviewed Cottage Profile media is retained' using errcode = 'RC210';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."block_published_cottage_photo_deletion"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."change_administrator_cottage_profile_draft_lifecycle"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_reason" "text", "requested_status" "public"."cottage_profile_status") RETURNS "public"."owner_application_cottage_profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare profile public.owner_application_cottage_profiles;
declare owner_context public.account_contexts;
declare reason text := regexp_replace(
  coalesce(requested_reason, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'
);
declare previous_status public.cottage_profile_status;
begin
  if not (select public.is_platform_administrator('aal2')) then
    raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501';
  end if;
  if target_expected_version is null or target_expected_version < 1 then
    raise exception 'A positive Cottage Profile version is required' using errcode = '22023';
  end if;
  if char_length(reason) not between 1 and 1000 then
    raise exception 'An administrator lifecycle reason is required' using errcode = '22023';
  end if;
  if requested_status not in ('draft', 'abandoned') then
    raise exception 'The requested Cottage Profile lifecycle is invalid' using errcode = '22023';
  end if;

  select * into profile from public.owner_application_cottage_profiles
  where id = target_profile_id;
  if not found then
    raise exception 'Cottage Profile was not found' using errcode = 'RC204';
  end if;
  select * into owner_context from public.account_contexts
  where user_id = profile.owner_user_id for update;
  select * into profile from public.owner_application_cottage_profiles
  where id = target_profile_id for update;

  if owner_context.role <> 'cottage_owner'
    or owner_context.owner_approval_state <> 'approved' then
    raise exception 'The Cottage Owner must be approved' using errcode = 'RC202';
  end if;
  if profile.version <> target_expected_version then
    raise exception 'The Cottage Profile changed before lifecycle action' using errcode = 'RC409';
  end if;
  if profile.application_id is not null or profile.current_publication_id is not null then
    raise exception 'Only an additional unpublished draft can change lifecycle'
      using errcode = 'RC202';
  end if;
  if requested_status = 'abandoned' and profile.status <> 'draft' then
    raise exception 'Only a draft can be abandoned' using errcode = 'RC202';
  end if;
  if requested_status = 'draft' and profile.status <> 'abandoned' then
    raise exception 'Only an abandoned draft can be restored' using errcode = 'RC202';
  end if;
  if exists (
    select 1 from public.cottage_profile_photos photos
    where photos.profile_id = profile.id and photos.state <> 'ready'
  ) then
    raise exception 'Pending Cottage Profile photo work must finish before lifecycle action'
      using errcode = 'RC202';
  end if;
  if requested_status = 'draft' and (
    select count(*) from public.owner_application_cottage_profiles profiles
    where profiles.owner_user_id = owner_context.user_id
      and profiles.current_publication_id is null
      and profiles.status <> 'abandoned'
  ) >= 20 then
    raise exception 'A Cottage Owner can have at most 20 open unpublished Cottage Profiles'
      using errcode = 'RC420';
  end if;

  previous_status := profile.status;
  update public.owner_application_cottage_profiles
  set status = requested_status, version = version + 1,
      updated_at = statement_timestamp(),
      abandoned_at = case when requested_status = 'abandoned'
        then statement_timestamp() else null end
  where id = profile.id returning * into profile;

  insert into public.cottage_profile_administrator_audit (
    profile_id, administrator_user_id, previous_version, resulting_version,
    changed_fields, event_kind, lifecycle_reason, previous_status, resulting_status
  ) values (
    profile.id, (select auth.uid()), target_expected_version, profile.version,
    array['status'],
    case when requested_status = 'abandoned' then 'draft_abandoned' else 'draft_restored' end,
    reason, previous_status, profile.status
  );
  return profile;
end;
$_$;

ALTER FUNCTION "public"."change_administrator_cottage_profile_draft_lifecycle"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_reason" "text", "requested_status" "public"."cottage_profile_status") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."complete_cottage_profile_photo_deletion"("target_photo_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  photo public.cottage_profile_photos;
begin
  select * into photo
  from public.cottage_profile_photos
  where id = target_photo_id
  for update;

  if not found then return; end if;
  if photo.state <> 'deletion_pending' then
    raise exception 'Cottage Profile photo deletion is not prepared'
      using errcode = 'RC205';
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = public.cottage_profile_photo_bucket_name()
      and name = photo.object_path
  ) then
    raise exception 'The Cottage Profile photo still requires storage deletion'
      using errcode = 'RC205';
  end if;

  delete from public.cottage_profile_photos where id = photo.id;
end;
$$;

ALTER FUNCTION "public"."complete_cottage_profile_photo_deletion"("target_photo_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."complete_cottage_profile_translation"("target_attempt_id" "uuid", "translated_description" "text", "translated_house_rules" "text", "returned_provider" "text", "returned_model" "text", "returned_effort" "text", "returned_prompt_version" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare attempt public.cottage_profile_translation_attempts;
declare localized_id uuid;
declare cycle public.cottage_profile_review_cycles;
declare current_head uuid;
declare cycle_available boolean;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  if not coalesce((select production_ready from public.cottage_translation_runtime_control
      where singleton for share), false) then
    raise exception 'Production translation is disabled by runtime control' using errcode = 'RC246';
  end if;
  select * into attempt from public.cottage_profile_translation_attempts where id = target_attempt_id for update;
  if not found or attempt.state <> 'pending' then return false; end if;
  select * into cycle from public.cottage_profile_review_cycles
    where id = attempt.review_cycle_id for update;
  cycle_available := found;
  select localized_revision_id into current_head
    from public.cottage_profile_localized_heads
    where review_cycle_id = attempt.review_cycle_id
      and locale = attempt.target_language;
  if not cycle_available or cycle.state <> 'in_review'
    or current_head is distinct from attempt.expected_localized_revision_id
    or exists (select 1 from public.cottage_profile_translation_attempts newer
      where newer.review_cycle_id = attempt.review_cycle_id and newer.target_language = attempt.target_language
        and newer.attempt_number > attempt.attempt_number) then
    update public.cottage_profile_translation_attempts set state = 'superseded', completed_at = now()
      where id = attempt.id;
    return false;
  end if;
  if char_length(btrim(coalesce(translated_description, ''))) not between 1 and 2000
    or char_length(btrim(coalesce(translated_house_rules, ''))) not between 1 and 1500
    or char_length(btrim(coalesce(returned_provider, ''))) < 1
    or char_length(btrim(coalesce(returned_model, ''))) < 1
    or char_length(btrim(coalesce(returned_effort, ''))) < 1
    or char_length(btrim(coalesce(returned_prompt_version, ''))) < 1 then
    raise exception 'Translation result is invalid' using errcode = '22023';
  end if;
  insert into public.cottage_profile_localized_revisions (
    review_cycle_id, locale, revision, origin, description, house_rules,
    provider, model, effort, prompt_version
  ) values (
    attempt.review_cycle_id, attempt.target_language,
    coalesce((select max(revision) from public.cottage_profile_localized_revisions
      where review_cycle_id = attempt.review_cycle_id and locale = attempt.target_language), 0) + 1,
    'generated', btrim(translated_description), btrim(translated_house_rules),
    btrim(returned_provider), btrim(returned_model), btrim(returned_effort), btrim(returned_prompt_version)
  ) returning id into localized_id;
  insert into public.cottage_profile_localized_heads (review_cycle_id, locale, localized_revision_id)
  values (attempt.review_cycle_id, attempt.target_language, localized_id)
  on conflict (review_cycle_id, locale) do update set localized_revision_id = excluded.localized_revision_id;
  update public.cottage_profile_translation_attempts set state = 'completed',
    provider = btrim(returned_provider), model = btrim(returned_model), effort = btrim(returned_effort),
    prompt_version = btrim(returned_prompt_version), completed_at = now() where id = attempt.id;
  return true;
end;
$$;

ALTER FUNCTION "public"."complete_cottage_profile_translation"("target_attempt_id" "uuid", "translated_description" "text", "translated_house_rules" "text", "returned_provider" "text", "returned_model" "text", "returned_effort" "text", "returned_prompt_version" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."complete_cottage_profile_translation_execution"("target_attempt_id" "uuid", "target_lease_token" "uuid", "translated_description" "text", "translated_house_rules" "text", "returned_provider" "text", "returned_model" "text", "returned_effort" "text", "returned_prompt_version" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare attempt public.cottage_profile_translation_attempts;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  select * into attempt
  from public.cottage_profile_translation_attempts
  where id = target_attempt_id
  for update;
  if not found or attempt.state <> 'pending'
    or attempt.lease_token <> target_lease_token then return false; end if;
  if attempt.lease_expires_at <= now() or exists (
    select 1 from public.cottage_profile_translation_human_reviews reviews
    where reviews.review_cycle_id = attempt.review_cycle_id
      and reviews.locale = attempt.target_language
      and reviews.state = 'active'
  ) then
    update public.cottage_profile_translation_attempts
    set state = 'superseded', completed_at = now()
    where id = attempt.id;
    return false;
  end if;
  return public.complete_cottage_profile_translation(
    target_attempt_id, translated_description, translated_house_rules,
    returned_provider, returned_model, returned_effort, returned_prompt_version
  );
end;
$$;

ALTER FUNCTION "public"."complete_cottage_profile_translation_execution"("target_attempt_id" "uuid", "target_lease_token" "uuid", "translated_description" "text", "translated_house_rules" "text", "returned_provider" "text", "returned_model" "text", "returned_effort" "text", "returned_prompt_version" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."correct_cottage_profile_localization"("target_review_cycle_id" "uuid", "target_locale" "public"."cottage_profile_source_language", "corrected_description" "text", "corrected_house_rules" "text", "target_reason" "text") RETURNS "public"."cottage_profile_localized_revisions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare revision public.cottage_profile_localized_revisions;
declare cycle public.cottage_profile_review_cycles;
declare source public.cottage_profile_source_revisions;
declare current_revision public.cottage_profile_localized_revisions;
begin
  if not (select public.is_platform_administrator('aal2')) then raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501'; end if;
  select * into cycle from public.cottage_profile_review_cycles
    where id = target_review_cycle_id for update;
  if not found or cycle.state <> 'in_review' then raise exception 'Cottage review cycle is unavailable' using errcode = 'RC204'; end if;
  select * into source from public.cottage_profile_source_revisions where id = cycle.source_revision_id;
  select revisions.* into current_revision
    from public.cottage_profile_localized_heads heads
    join public.cottage_profile_localized_revisions revisions on revisions.id = heads.localized_revision_id
    where heads.review_cycle_id = target_review_cycle_id and heads.locale = target_locale;
  if not found or (target_locale <> source.source_language and not exists (
    select 1 from public.cottage_profile_localized_revisions generated
    where generated.review_cycle_id = target_review_cycle_id
      and generated.locale = target_locale and generated.origin = 'generated'
  )) then
    raise exception 'A generated localized revision is required before correction' using errcode = 'RC204';
  end if;
  insert into public.cottage_profile_localized_revisions (
    review_cycle_id, locale, revision, origin, description, house_rules,
    administrator_user_id, correction_reason
  ) values (
    target_review_cycle_id, target_locale,
    coalesce((select max(localized.revision) from public.cottage_profile_localized_revisions localized
      where localized.review_cycle_id = target_review_cycle_id and localized.locale = target_locale), 0) + 1,
    'administrator_correction', btrim(corrected_description), btrim(corrected_house_rules),
    (select auth.uid()), btrim(target_reason)
  ) returning * into revision;
  insert into public.cottage_profile_localized_heads (review_cycle_id, locale, localized_revision_id)
  values (target_review_cycle_id, target_locale, revision.id)
  on conflict (review_cycle_id, locale) do update set localized_revision_id = excluded.localized_revision_id;
  return revision;
end;
$$;

ALTER FUNCTION "public"."correct_cottage_profile_localization"("target_review_cycle_id" "uuid", "target_locale" "public"."cottage_profile_source_language", "corrected_description" "text", "corrected_house_rules" "text", "target_reason" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."cottage_inventory_commitment_end_at"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."cottage_inventory_commitment_end_at"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."cottage_inventory_component_available_without_auth_claim"("target_schedule_revision_id" "uuid", "target_shift_id" "uuid", "target_service_day" "date") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.cottage_shifts shifts
    join public.cottage_inventory_availability availability
      on availability.schedule_revision_id = shifts.schedule_revision_id
      and availability.unit_kind = 'shift'::public.cottage_inventory_unit_kind
      and availability.unit_id = shifts.id
      and availability.service_day = target_service_day
      and availability.state = 'open'::public.cottage_inventory_availability_state
    where shifts.schedule_revision_id = target_schedule_revision_id
      and shifts.id = target_shift_id
      and public.public_cottage_effective_price(
        shifts.schedule_revision_id, 'shift'::public.cottage_inventory_unit_kind,
        shifts.id, target_service_day
      ) is not null
      and not exists (
        select 1 from public.cottage_booking_period_occupancies occupancies
        where occupancies.schedule_revision_id = shifts.schedule_revision_id
          and occupancies.shift_id = shifts.id
          and occupancies.service_day = target_service_day
          and occupancies.active
      )
  );
$$;

ALTER FUNCTION "public"."cottage_inventory_component_available_without_auth_claim"("target_schedule_revision_id" "uuid", "target_shift_id" "uuid", "target_service_day" "date") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."cottage_inventory_component_is_effectively_available"("target_schedule_revision_id" "uuid", "target_shift_id" "uuid", "target_service_day" "date") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.cottage_inventory_component_available_without_auth_claim(
    target_schedule_revision_id, target_shift_id, target_service_day
  ) and not public.booking_request_active_claim_conflicts_unit(
    target_schedule_revision_id,
    'shift'::public.cottage_inventory_unit_kind,
    target_shift_id,
    target_service_day
  );
$$;

ALTER FUNCTION "public"."cottage_inventory_component_is_effectively_available"("target_schedule_revision_id" "uuid", "target_shift_id" "uuid", "target_service_day" "date") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."cottage_profile_photo_bucket_name"() RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select 'cottage-profile-photos'::text;
$$;

ALTER FUNCTION "public"."cottage_profile_photo_bucket_name"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."cottage_profile_ready_photo_count"("target_profile_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
  select count(*)::integer
  from public.cottage_profile_photos photos
  where photos.profile_id = target_profile_id
    and photos.is_active
    and photos.state = 'ready'
    and exists (
      select 1
      from storage.objects objects
      where objects.bucket_id = public.cottage_profile_photo_bucket_name()
        and objects.name = photos.object_path
        and objects.metadata ->> 'mimetype' = photos.media_type
        and coalesce(objects.metadata ->> 'size', '') ~ '^[0-9]+$'
        and (objects.metadata ->> 'size')::integer = photos.size_bytes
    );
$_$;

ALTER FUNCTION "public"."cottage_profile_ready_photo_count"("target_profile_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."cottage_profile_required_data_is_complete"("target_profile_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.owner_application_cottage_profiles profiles
    where profiles.id = target_profile_id
      and profiles.name is not null
      and profiles.governorate is not null
      and profiles.approximate_location is not null
      and profiles.exact_address is not null
      and profiles.exact_latitude is not null
      and profiles.exact_longitude is not null
      and profiles.private_directions is not null
      and profiles.capacity is not null
      and profiles.bedrooms is not null
      and profiles.bathrooms is not null
      and cardinality(profiles.amenities) >= 1
      and profiles.source_language is not null
      and profiles.description is not null
      and profiles.house_rules is not null
  );
$$;

ALTER FUNCTION "public"."cottage_profile_required_data_is_complete"("target_profile_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_cottage_profile_review_cycle"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare cycle public.cottage_profile_review_cycles;
declare source public.cottage_profile_source_revisions;
declare localized_id uuid;
begin
  if new.status <> 'submitted_for_content_approval'
    or new.submitted_source_revision_id is null
    or new.submitted_source_revision_id is not distinct from old.submitted_source_revision_id then
    return new;
  end if;
  select * into source from public.cottage_profile_source_revisions
    where id = new.submitted_source_revision_id;
  insert into public.cottage_profile_review_cycles (
    profile_id, owner_user_id, source_revision_id, name, governorate,
    approximate_location, capacity, bedrooms, bathrooms, amenities, cycle_number
  ) values (
    new.id, new.owner_user_id, source.id, new.name, new.governorate,
    new.approximate_location, new.capacity, new.bedrooms, new.bathrooms,
    new.amenities,
    coalesce((select max(cycle_number) from public.cottage_profile_review_cycles where profile_id = new.id), 0) + 1
  ) returning * into cycle;
  insert into public.cottage_profile_localized_revisions (
    review_cycle_id, locale, revision, origin, description, house_rules
  ) values (cycle.id, source.source_language, 1, 'owner_source', source.description, source.house_rules)
  returning id into localized_id;
  insert into public.cottage_profile_localized_heads (review_cycle_id, locale, localized_revision_id)
  values (cycle.id, source.source_language, localized_id);
  insert into public.cottage_profile_review_photos (review_cycle_id, photo_id, position)
  select cycle.id, id, row_number() over (order by created_at, id)::integer
  from public.cottage_profile_photos
  where profile_id = new.id and state = 'ready' and is_active;
  return new;
end;
$$;

ALTER FUNCTION "public"."create_cottage_profile_review_cycle"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_owner_cottage_profile_draft"() RETURNS "public"."owner_application_cottage_profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  profile public.owner_application_cottage_profiles;
  owner_context public.account_contexts;
begin
  select * into owner_context
  from public.account_contexts
  where user_id = (select auth.uid())
  for update;

  if not found or owner_context.role <> 'cottage_owner'
    or owner_context.owner_approval_state <> 'approved' then
    raise exception 'Approved Cottage Owner access is required'
      using errcode = '42501';
  end if;
  if (
    select count(*)
    from public.owner_application_cottage_profiles profiles
    where profiles.owner_user_id = owner_context.user_id
      and profiles.current_publication_id is null
      and profiles.status <> 'abandoned'
  ) >= 20 then
    raise exception 'A Cottage Owner can have at most 20 open unpublished Cottage Profiles'
      using errcode = 'RC420';
  end if;
  if (
    select count(*)
    from public.owner_application_cottage_profiles profiles
    where profiles.owner_user_id = owner_context.user_id
      and profiles.application_id is null
      and profiles.created_at > now() - interval '24 hours'
  ) >= 20 then
    raise exception 'A Cottage Owner can create at most 20 additional Cottage Profiles in 24 hours'
      using errcode = 'RC429';
  end if;

  insert into public.owner_application_cottage_profiles (owner_user_id)
  values (owner_context.user_id)
  returning * into profile;
  return profile;
end;
$$;

ALTER FUNCTION "public"."create_owner_cottage_profile_draft"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."decide_cottage_profile_localization"("target_review_cycle_id" "uuid", "target_locale" "public"."cottage_profile_source_language", "target_approved" boolean, "target_reason" "text") RETURNS "public"."cottage_profile_localized_decisions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare head public.cottage_profile_localized_heads;
declare decision public.cottage_profile_localized_decisions;
declare cycle public.cottage_profile_review_cycles;
begin
  if not (select public.is_platform_administrator('aal2')) then raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501'; end if;
  select * into cycle from public.cottage_profile_review_cycles
    where id = target_review_cycle_id for update;
  select * into head from public.cottage_profile_localized_heads
    where review_cycle_id = target_review_cycle_id and locale = target_locale;
  if not found or cycle.state <> 'in_review' then raise exception 'Current localized content is unavailable' using errcode = 'RC204'; end if;
  insert into public.cottage_profile_localized_decisions (
    review_cycle_id, locale, localized_revision_id, administrator_user_id, approved, reason
  ) values (target_review_cycle_id, target_locale, head.localized_revision_id, (select auth.uid()), target_approved, btrim(target_reason))
  returning * into decision;
  return decision;
end;
$$;

ALTER FUNCTION "public"."decide_cottage_profile_localization"("target_review_cycle_id" "uuid", "target_locale" "public"."cottage_profile_source_language", "target_approved" boolean, "target_reason" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."fail_cottage_profile_translation"("target_attempt_id" "uuid", "target_failure_code" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Translation service access is required' using errcode = '42501'; end if;
  update public.cottage_profile_translation_attempts
    set state = 'failed', failure_code = btrim(target_failure_code), completed_at = now()
    where id = target_attempt_id and state = 'pending';
end;
$$;

ALTER FUNCTION "public"."fail_cottage_profile_translation"("target_attempt_id" "uuid", "target_failure_code" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."fail_cottage_profile_translation_execution"("target_attempt_id" "uuid", "target_lease_token" "uuid", "target_failure_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  if target_failure_code not in (
    'adapter_unavailable', 'configuration_unavailable',
    'unsupported_content', 'invalid_input', 'usage_limit_reached',
    'provider_timeout', 'provider_unavailable',
    'invalid_provider_response', 'cache_unavailable',
    'usage_accounting_unavailable', 'provider_failure'
  ) then
    raise exception 'Translation failure is invalid' using errcode = '22023';
  end if;
  update public.cottage_profile_translation_attempts
  set state = 'failed', failure_code = btrim(target_failure_code), completed_at = now()
  where id = target_attempt_id and state = 'pending'
    and lease_token = target_lease_token and lease_expires_at > now();
  return found;
end;
$$;

ALTER FUNCTION "public"."fail_cottage_profile_translation_execution"("target_attempt_id" "uuid", "target_lease_token" "uuid", "target_failure_code" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_cottage_translation_administration"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare control public.cottage_translation_runtime_control;
declare month_start date := date_trunc('month', now())::date;
begin
  if not (select public.is_platform_administrator('aal2')) then
    raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501';
  end if;
  select * into control
  from public.cottage_translation_runtime_control
  where singleton;
  if not found then
    raise exception 'Translation runtime control is unavailable' using errcode = 'RC246';
  end if;
  return jsonb_build_object(
    'productionReady', control.production_ready,
    'approvedEvaluationArtifactDigest', control.approved_evaluation_artifact_digest,
    'productionApprovalDigest', control.production_approval_digest,
    'providerTermsApproved', control.provider_terms_approval_reference is not null,
    'nativeReviewApproved', control.native_review_approval_reference is not null,
    'qualityThresholdApproved', control.quality_threshold_approval_reference is not null,
    'ordinaryModel', control.ordinary_model,
    'ordinaryEffort', control.ordinary_effort,
    'strongerModel', control.stronger_model,
    'strongerEffort', control.stronger_effort,
    'judgeModel', control.judge_model,
    'judgeEffort', control.judge_effort,
    'monthlyRequestLimit', control.monthly_request_limit,
    'monthlyTokenLimit', control.monthly_token_limit,
    'monthlySpendMicrousdLimit', control.monthly_spend_microusd_limit,
    'monthRequests', (
      select count(*) from public.cottage_translation_usage_reservations usage
      where usage.billing_month = month_start
    ),
    'monthReservedTokens', (
      select coalesce(sum(usage.reserved_tokens), 0)
      from public.cottage_translation_usage_reservations usage
      where usage.billing_month = month_start
    ),
    'monthReservedMicrousd', (
      select coalesce(sum(usage.reserved_microusd), 0)
      from public.cottage_translation_usage_reservations usage
      where usage.billing_month = month_start
    ),
    'monthActualMicrousd', (
      select coalesce(sum(results.actual_microusd), 0)
      from public.cottage_translation_usage_results results
      join public.cottage_translation_usage_reservations usage
        on usage.id = results.reservation_id
      where usage.billing_month = month_start
    ),
    'qualityReportCount', (select count(*) from public.cottage_translation_quality_reports)
  );
end;
$$;

ALTER FUNCTION "public"."get_cottage_translation_administration"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_current_cottage_publication"("target_profile_id" "uuid", "target_locale" "public"."cottage_profile_source_language") RETURNS TABLE("publication_id" "uuid", "name" "text", "governorate" "text", "approximate_location" "text", "capacity" integer, "bedrooms" integer, "bathrooms" integer, "amenities" "text"[], "description" "text", "house_rules" "text", "media_ids" "uuid"[])
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."get_current_cottage_publication"("target_profile_id" "uuid", "target_locale" "public"."cottage_profile_source_language") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_default_public_cottage_search"("target_slug" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."get_default_public_cottage_search"("target_slug" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_public_cottage_facets"("target_locale" "public"."cottage_profile_source_language") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."get_public_cottage_facets"("target_locale" "public"."cottage_profile_source_language") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_public_cottage_profile"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."get_public_cottage_profile"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."is_cottage_publicly_discoverable"("target_profile_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."is_cottage_publicly_discoverable"("target_profile_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_owner_cottage_profiles"("target_after_updated_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "target_after_id" "uuid" DEFAULT NULL::"uuid", "target_limit" integer DEFAULT 100) RETURNS SETOF "public"."owner_application_cottage_profiles"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (target_after_updated_at is null) <> (target_after_id is null) then
    raise exception 'Cottage Profile owner cursor is invalid'
      using errcode = '22023';
  end if;
  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'Cottage Profile owner page size is invalid'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state in ('approved', 'expired', 'suspended')
  ) then
    raise exception 'Approved Cottage Owner access is required'
      using errcode = '42501';
  end if;

  return query
  select profiles.*
  from public.owner_application_cottage_profiles profiles
  where profiles.owner_user_id = (select auth.uid())
    and (
      target_after_updated_at is null
      or (profiles.updated_at, profiles.id) <
        (target_after_updated_at, target_after_id)
    )
  order by profiles.updated_at desc, profiles.id desc
  limit target_limit;
end;
$$;

ALTER FUNCTION "public"."list_owner_cottage_profiles"("target_after_updated_at" timestamp with time zone, "target_after_id" "uuid", "target_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."load_cottage_inventory_owner_editor_state"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare profile public.owner_application_cottage_profiles;
declare unit record;
declare raw_state public.cottage_inventory_availability_state;
declare standard_price bigint;
declare weekday_overrides jsonb;
declare date_overrides jsonb;
declare item jsonb;
declare result jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1
    from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state in ('approved', 'expired', 'suspended')
  ) then
    raise exception 'Established Cottage Owner access is required' using errcode = '42501';
  end if;

  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id;
  if not found or profile.owner_user_id <> (select auth.uid()) then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if profile.current_shift_schedule_id is distinct from target_schedule_revision_id then
    raise exception 'The Shift Schedule revision is no longer current' using errcode = 'RC409';
  end if;

  for unit in
    select shifts.id as unit_id,
      'shift'::public.cottage_inventory_unit_kind as unit_kind,
      shifts.position as unit_position,
      shifts.start_time as unit_start_time
    from public.cottage_shifts shifts
    where shifts.schedule_revision_id = target_schedule_revision_id
    union all
    select revisions.full_day_bundle_id,
      'full_day_bundle'::public.cottage_inventory_unit_kind,
      2147483647,
      (
        select min(shifts.start_time)
        from public.cottage_shifts shifts
        where shifts.schedule_revision_id = revisions.id
      )
    from public.cottage_shift_schedule_revisions revisions
    where revisions.id = target_schedule_revision_id
    order by unit_position, unit_id
  loop
    select prices.price_iqd into standard_price
    from public.cottage_inventory_standard_prices prices
    where prices.schedule_revision_id = target_schedule_revision_id
      and prices.unit_kind = unit.unit_kind
      and prices.unit_id = unit.unit_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'weekday', prices.weekday,
      'priceIqd', prices.price_iqd
    ) order by prices.weekday), '[]'::jsonb) into weekday_overrides
    from public.cottage_inventory_weekday_price_overrides prices
    where prices.schedule_revision_id = target_schedule_revision_id
      and prices.unit_kind = unit.unit_kind
      and prices.unit_id = unit.unit_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'serviceDay', prices.service_day,
      'priceIqd', prices.price_iqd
    ) order by prices.service_day), '[]'::jsonb) into date_overrides
    from public.cottage_inventory_date_price_overrides prices
    where prices.schedule_revision_id = target_schedule_revision_id
      and prices.unit_kind = unit.unit_kind
      and prices.unit_id = unit.unit_id
      and ((prices.service_day + unit.unit_start_time) at time zone 'Asia/Baghdad') > now();

    item := jsonb_build_object(
      'id', unit.unit_id,
      'kind', unit.unit_kind,
      'standardPriceIqd', standard_price,
      'weekdayOverrides', weekday_overrides,
      'dateOverrides', date_overrides
    );
    if target_service_day is not null then
      select availability.state into raw_state
      from public.cottage_inventory_availability availability
      where availability.schedule_revision_id = target_schedule_revision_id
        and availability.unit_kind = unit.unit_kind
        and availability.unit_id = unit.unit_id
        and availability.service_day = target_service_day;
      item := item || jsonb_build_object(
        'ownerState', coalesce(
          raw_state,
          'closed'::public.cottage_inventory_availability_state
        )
      );
    end if;
    result := result || jsonb_build_array(item);
  end loop;

  return jsonb_build_object(
    'profileId', target_profile_id,
    'scheduleRevisionId', target_schedule_revision_id,
    'serviceDay', target_service_day,
    'units', result
  );
end;
$$;

ALTER FUNCTION "public"."load_cottage_inventory_owner_editor_state"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."lock_cottage_inventory_profiles"("target_profile_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform profiles.id
  from public.owner_application_cottage_profiles profiles
  where profiles.id = any(target_profile_ids)
  order by profiles.id
  for update;
end;
$$;

ALTER FUNCTION "public"."lock_cottage_inventory_profiles"("target_profile_ids" "uuid"[]) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_cottage_profile_photo_deletion"("target_photo_id" "uuid") RETURNS "public"."cottage_profile_photos"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  photo public.cottage_profile_photos;
  profile public.owner_application_cottage_profiles;
  actor_is_administrator boolean := (
    select public.is_platform_administrator('aal2')
  );
  retained_in_history boolean;
begin
  select * into photo
  from public.cottage_profile_photos
  where id = target_photo_id
  for update;

  if not found then
    raise exception 'Cottage Profile photo was not found' using errcode = 'RC204';
  end if;
  select * into profile
  from public.owner_application_cottage_profiles
  where id = photo.profile_id
  for update;

  if not actor_is_administrator and not (
    photo.owner_user_id = (select auth.uid())
    and profile.status = 'draft'
    and exists (
      select 1 from public.account_contexts
      where user_id = (select auth.uid())
        and role = 'cottage_owner'
        and owner_approval_state = 'approved'
    )
  ) then
    raise exception 'Cottage Profile photo deletion is denied'
      using errcode = '42501';
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
        changed_fields, event_kind, object_path
      ) values (
        profile.id, (select auth.uid()), profile.version, profile.version,
        array['photos'], 'photo_deletion_recovered', photo.object_path
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
      changed_fields, event_kind, object_path
    ) values (
      profile.id, (select auth.uid()), profile.version, profile.version,
      array['photos'], 'photo_deletion_prepared', photo.object_path
    );
  end if;

  return photo;
end;
$$;

ALTER FUNCTION "public"."prepare_cottage_profile_photo_deletion"("target_photo_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_cottage_profile_photo_preview"("target_photo_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  photo public.cottage_profile_photos;
begin
  select * into photo
  from public.cottage_profile_photos
  where id = target_photo_id;

  if not found or photo.state <> 'ready' then
    raise exception 'Cottage Profile photo preview is unavailable'
      using errcode = 'RC204';
  end if;
  if not (select public.is_platform_administrator('aal2')) and not (
    photo.owner_user_id = (select auth.uid())
    and exists (
      select 1 from public.account_contexts
      where user_id = (select auth.uid())
        and role = 'cottage_owner'
        and owner_approval_state in ('approved', 'expired', 'suspended')
    )
  ) then
    raise exception 'Cottage Profile photo preview is denied'
      using errcode = '42501';
  end if;

  return photo.object_path;
end;
$$;

ALTER FUNCTION "public"."prepare_cottage_profile_photo_preview"("target_photo_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_cottage_profile_photo_upload"("target_profile_id" "uuid", "requested_original_filename" "text", "requested_media_type" "text", "requested_size_bytes" integer) RETURNS "public"."cottage_profile_photos"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  profile public.owner_application_cottage_profiles;
  photo public.cottage_profile_photos;
  extension text;
  actor_is_administrator boolean := (
    select public.is_platform_administrator('aal2')
  );
begin
  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id
  for update;

  if not found then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if not actor_is_administrator and not (
    profile.owner_user_id = (select auth.uid())
    and profile.status = 'draft'
    and exists (
      select 1 from public.account_contexts
      where user_id = (select auth.uid())
        and role = 'cottage_owner'
        and owner_approval_state = 'approved'
    )
  ) then
    raise exception 'Cottage Profile photo access is denied'
      using errcode = '42501';
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
      changed_fields, event_kind, object_path
    ) values (
      profile.id, (select auth.uid()), profile.version, profile.version,
      array['photos'], 'photo_upload_prepared', photo.object_path
    );
  end if;

  return photo;
end;
$$;

ALTER FUNCTION "public"."prepare_cottage_profile_photo_upload"("target_profile_id" "uuid", "requested_original_filename" "text", "requested_media_type" "text", "requested_size_bytes" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."preserve_committed_cottage_shift_schedule_pointer"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.current_shift_schedule_id is distinct from old.current_shift_schedule_id
    and old.current_shift_schedule_id is not null
    and exists (
      select 1
      from public.cottage_booking_period_commitments commitments
      join public.cottage_booking_period_occupancies occupancies
        on occupancies.booking_period_commitment_id = commitments.id
        and occupancies.schedule_revision_id = commitments.schedule_revision_id
      cross join lateral unnest(commitments.access_ranges) access_range
      where commitments.schedule_revision_id = old.current_shift_schedule_id
        and occupancies.active
        and upper(access_range) > now()
    ) then
    raise exception 'A Shift Schedule with committed inventory cannot be replaced'
      using errcode = 'RC204';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."preserve_committed_cottage_shift_schedule_pointer"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."protect_abandoned_cottage_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if old.status = 'abandoned' or new.status = 'abandoned' then
    if new.version <> old.version + 1
      or new.updated_at <= old.updated_at
      or (
        to_jsonb(new) - array['status', 'version', 'updated_at', 'abandoned_at']
        is distinct from
        to_jsonb(old) - array['status', 'version', 'updated_at', 'abandoned_at']
      )
      or not (
        (
          old.status = 'draft'
          and old.abandoned_at is null
          and new.status = 'abandoned'
          and new.abandoned_at = new.updated_at
        ) or (
          old.status = 'abandoned'
          and old.abandoned_at is not null
          and new.status = 'draft'
          and new.abandoned_at is null
        )
      ) then
      raise exception 'An abandoned Cottage Profile is read-only'
        using errcode = 'RC202';
    end if;
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."protect_abandoned_cottage_profile"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."protect_cottage_profile_source_during_review"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if old.status = 'submitted_for_content_approval' and (
    new.source_language is distinct from old.source_language
    or new.description is distinct from old.description
    or new.house_rules is distinct from old.house_rules
  ) then
    raise exception 'Active review source must change through localized history' using errcode = 'RC208';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."protect_cottage_profile_source_during_review"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."protect_cottage_translation_human_review"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'UPDATE' and old.state = 'active'
    and new.state in ('resolved', 'superseded')
    and (to_jsonb(new) - array['state', 'resolved_at'])
      = (to_jsonb(old) - array['state', 'resolved_at']) then
    return new;
  end if;
  raise exception 'Translation human-review history is immutable' using errcode = 'RC208';
end;
$$;

ALTER FUNCTION "public"."protect_cottage_translation_human_review"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."public_cottage_effective_price"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."public_cottage_effective_price"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."public_cottage_unit_is_available"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.public_cottage_unit_is_available_without_authorization_claim(
    target_schedule_revision_id, target_unit_kind, target_unit_id,
    target_service_day
  ) and not public.booking_request_active_claim_conflicts_unit(
    target_schedule_revision_id, target_unit_kind, target_unit_id,
    target_service_day
  );
$$;

ALTER FUNCTION "public"."public_cottage_unit_is_available"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."public_cottage_unit_is_available_without_authorization_claim"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
      select 1
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.schedule_revision_id = target_schedule_revision_id
        and occupancies.service_day = target_service_day
        and occupancies.active
        and (
          target_unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
          or occupancies.shift_id = target_unit_id
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
            select shifts.start_time from public.cottage_shifts shifts
            where shifts.schedule_revision_id = schedules.id
            order by shifts.position limit 1
          )) at time zone 'Asia/Baghdad') > now()
      )
    end;
$$;

ALTER FUNCTION "public"."public_cottage_unit_is_available_without_authorization_claim"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."record_cottage_translation_usage"("target_reservation_id" "uuid", "actual_input_tokens" bigint, "actual_output_tokens" bigint, "actual_total_tokens" bigint, "actual_microusd" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare reservation public.cottage_translation_usage_reservations;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  select * into reservation
  from public.cottage_translation_usage_reservations
  where id = target_reservation_id
  for share;
  if not found then
    raise exception 'Translation reservation is unavailable' using errcode = 'RC204';
  end if;
  if actual_input_tokens < 0 or actual_output_tokens < 0
    or actual_total_tokens <> actual_input_tokens + actual_output_tokens
    or actual_total_tokens > reservation.reserved_tokens
    or actual_microusd < 0 or actual_microusd > reservation.reserved_microusd then
    raise exception 'Translation usage is invalid' using errcode = '22023';
  end if;
  insert into public.cottage_translation_usage_results (
    reservation_id, input_tokens, output_tokens, total_tokens, actual_microusd
  ) values (
    reservation.id, actual_input_tokens, actual_output_tokens,
    actual_total_tokens, actual_microusd
  );
end;
$$;

ALTER FUNCTION "public"."record_cottage_translation_usage"("target_reservation_id" "uuid", "actual_input_tokens" bigint, "actual_output_tokens" bigint, "actual_total_tokens" bigint, "actual_microusd" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."register_cottage_marketplace_listing"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."register_cottage_marketplace_listing"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."register_cottage_profile_photo"("target_photo_id" "uuid") RETURNS "public"."cottage_profile_photos"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  photo public.cottage_profile_photos;
  stored_metadata jsonb;
begin
  select * into photo
  from public.cottage_profile_photos
  where id = target_photo_id
  for update;

  if not found then
    raise exception 'Cottage Profile photo registration is invalid'
      using errcode = 'RC205';
  end if;
  if photo.state = 'ready' then return photo; end if;
  if photo.state <> 'pending' then
    raise exception 'Cottage Profile photo registration is invalid'
      using errcode = 'RC205';
  end if;

  select metadata into stored_metadata
  from storage.objects
  where bucket_id = public.cottage_profile_photo_bucket_name()
    and name = photo.object_path;

  if not found
    or stored_metadata ->> 'mimetype' <> photo.media_type
    or coalesce(stored_metadata ->> 'size', '') !~ '^[0-9]+$'
    or (stored_metadata ->> 'size')::integer <> photo.size_bytes then
    raise exception 'The uploaded Cottage Profile photo does not match its metadata'
      using errcode = 'RC205';
  end if;

  update public.cottage_profile_photos
  set state = 'ready', updated_at = now()
  where id = photo.id
  returning * into photo;

  return photo;
end;
$_$;

ALTER FUNCTION "public"."register_cottage_profile_photo"("target_photo_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_abandoned_cottage_profile_child_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare target_profile_id uuid;
begin
  if tg_table_name = 'cottage_profile_photos' then
    target_profile_id := case when tg_op = 'DELETE' then old.profile_id else new.profile_id end;
  elsif tg_table_name = 'cottage_shift_schedule_revisions' then
    target_profile_id := case when tg_op = 'DELETE' then old.profile_id else new.profile_id end;
  else
    select revisions.profile_id into target_profile_id
    from public.cottage_shift_schedule_revisions revisions
    where revisions.id = case
      when tg_op = 'DELETE' then old.schedule_revision_id
      else new.schedule_revision_id
    end;
  end if;

  if exists (
    select 1 from public.owner_application_cottage_profiles profiles
    where profiles.id = target_profile_id and profiles.status = 'abandoned'
  ) then
    raise exception 'An abandoned Cottage Profile is read-only'
      using errcode = 'RC202';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

ALTER FUNCTION "public"."reject_abandoned_cottage_profile_child_mutation"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_active_cottage_translation_human_review"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exists (
    select 1
    from public.cottage_profile_translation_human_reviews reviews
    where reviews.review_cycle_id = new.review_cycle_id
      and reviews.state = 'active'
  ) then
    raise exception 'Active translation human review must be resolved first'
      using errcode = 'RC409';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."reject_active_cottage_translation_human_review"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_authorization_claim_profile_or_shift_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare target_profile_id uuid;
declare target_schedule_id uuid;
begin
  if current_setting('role', true) = 'service_role' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_table_name = 'owner_application_cottage_profiles' then
    target_profile_id := coalesce(new.id, old.id);
    if (new.current_publication_id is distinct from old.current_publication_id
        or new.current_shift_schedule_id is distinct from old.current_shift_schedule_id)
      and exists (
        select 1 from public.booking_request_authorization_claims claims
        where claims.profile_id = target_profile_id
	          and public.booking_request_claim_state_is_active(claims.state)
      ) then
      raise exception 'Authorization-claimed Cottage Profile cannot change'
        using errcode = 'RC204';
    end if;
  else
    if tg_op = 'DELETE' then
      target_schedule_id := old.schedule_revision_id;
    else
      target_schedule_id := new.schedule_revision_id;
    end if;
    if exists (
      select 1 from public.booking_request_authorization_claims claims
      where claims.schedule_revision_id = target_schedule_id
	        and public.booking_request_claim_state_is_active(claims.state)
    ) then
      raise exception 'Authorization-claimed Shift Schedule cannot change'
        using errcode = 'RC204';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

ALTER FUNCTION "public"."reject_authorization_claim_profile_or_shift_mutation"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_cottage_inventory_commitment_snapshot_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'Cottage Inventory commitment snapshots are immutable'
    using errcode = 'RC204';
end;
$$;

ALTER FUNCTION "public"."reject_cottage_inventory_commitment_snapshot_update"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_cottage_profile_publication"("target_review_cycle_id" "uuid", "target_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare cycle public.cottage_profile_review_cycles;
begin
  if not (select public.is_platform_administrator('aal2')) then raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501'; end if;
  select * into cycle from public.cottage_profile_review_cycles where id = target_review_cycle_id for update;
  if not found or cycle.state <> 'in_review' then raise exception 'Cottage review cycle is unavailable' using errcode = 'RC204'; end if;
  insert into public.cottage_profile_publication_decisions (review_cycle_id, administrator_user_id, approved, reason)
    values (cycle.id, (select auth.uid()), false, btrim(target_reason));
  update public.cottage_profile_review_cycles set state = 'rejected', decided_at = now() where id = cycle.id;
  update public.owner_application_cottage_profiles set status = 'draft', submitted_source_revision_id = null,
    version = version + 1, updated_at = now() where id = cycle.profile_id;
end;
$$;

ALTER FUNCTION "public"."reject_cottage_profile_publication"("target_review_cycle_id" "uuid", "target_reason" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_cottage_profile_source_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'Submitted Cottage Profile source is immutable'
    using errcode = 'RC208';
end;
$$;

ALTER FUNCTION "public"."reject_cottage_profile_source_mutation"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_cottage_publication_history_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'UPDATE' and tg_table_name = 'cottage_profile_review_cycles'
    and to_jsonb(old) ->> 'state' = 'in_review'
    and to_jsonb(new) ->> 'state' in ('approved', 'rejected')
    and (to_jsonb(new) - array['state', 'decided_at'])
      = (to_jsonb(old) - array['state', 'decided_at']) then
    return new;
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'cottage_profile_translation_attempts'
    and to_jsonb(old) ->> 'state' = 'pending'
    and to_jsonb(new) ->> 'state' in ('completed', 'failed', 'superseded')
    and (to_jsonb(new) - array['state', 'failure_code', 'provider', 'model', 'effort', 'prompt_version', 'completed_at'])
      = (to_jsonb(old) - array['state', 'failure_code', 'provider', 'model', 'effort', 'prompt_version', 'completed_at']) then
    return new;
  end if;
  raise exception 'Cottage publication history is immutable' using errcode = 'RC208';
end;
$$;

ALTER FUNCTION "public"."reject_cottage_publication_history_mutation"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_cottage_shift_schedule_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'Cottage Shift Schedule history is immutable'
    using errcode = 'RC208';
end;
$$;

ALTER FUNCTION "public"."reject_cottage_shift_schedule_mutation"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."replace_cottage_shift_schedule"("target_profile_id" "uuid", "target_expected_revision" integer, "requested_shifts" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare profile public.owner_application_cottage_profiles;
declare current_revision public.cottage_shift_schedule_revisions;
declare saved_revision public.cottage_shift_schedule_revisions;
declare requested_shift jsonb;
declare requested_name text;
declare requested_start_text text;
declare requested_end_text text;
declare requested_names text[] := '{}';
declare requested_starts time without time zone[] := '{}';
declare requested_ends time without time zone[] := '{}';
declare saved_shifts jsonb;
begin
  if target_expected_revision is null or target_expected_revision < 0 then
    raise exception 'A non-negative Shift Schedule revision is required'
      using errcode = '22023';
  end if;
  if jsonb_typeof(requested_shifts) <> 'array'
    or jsonb_array_length(requested_shifts) not between 2 and 3 then
    raise exception 'A Shift Schedule requires exactly two or three Cottage Shifts'
      using errcode = 'RC205';
  end if;
  if not exists (
    select 1 from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required'
      using errcode = '42501';
  end if;

  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id
  for update;

  if not found or profile.owner_user_id <> (select auth.uid()) then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if profile.status <> 'draft' then
    raise exception 'A submitted Cottage Profile Shift Schedule is read-only'
      using errcode = 'RC202';
  end if;

  if profile.current_shift_schedule_id is not null then
    select * into current_revision
    from public.cottage_shift_schedule_revisions
    where id = profile.current_shift_schedule_id;
  end if;
  if (target_expected_revision = 0 and current_revision.id is not null)
    or (target_expected_revision > 0 and (
      current_revision.id is null
      or current_revision.revision <> target_expected_revision
    )) then
    raise exception 'The Shift Schedule changed before this save'
      using errcode = 'RC409';
  end if;

  for requested_shift in select value from jsonb_array_elements(requested_shifts)
  loop
    if jsonb_typeof(requested_shift) <> 'object' then
      raise exception 'The Cottage Shift is invalid' using errcode = 'RC205';
    end if;
    requested_name := btrim(coalesce(requested_shift ->> 'name', ''));
    requested_start_text := coalesce(requested_shift ->> 'startTime', '');
    requested_end_text := coalesce(requested_shift ->> 'endTime', '');
    if requested_name = ''
      or requested_start_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or requested_end_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or requested_start_text = requested_end_text then
      raise exception 'The Cottage Shift is invalid' using errcode = 'RC205';
    end if;
    requested_names := array_append(requested_names, requested_name);
    requested_starts := array_append(requested_starts, requested_start_text::time);
    requested_ends := array_append(requested_ends, requested_end_text::time);
  end loop;

  insert into public.cottage_shift_schedule_revisions (profile_id, revision)
  values (profile.id, coalesce(current_revision.revision, 0) + 1)
  returning * into saved_revision;

  perform set_config(
    'rentcottage.shift_schedule_write_revision_id',
    saved_revision.id::text,
    true
  );

  insert into public.cottage_shifts (
    schedule_revision_id, position, name, start_time, end_time
  )
  select saved_revision.id, row_number() over (order by requested.start_time)::smallint,
    requested.name, requested.start_time, requested.end_time
  from unnest(requested_names, requested_starts, requested_ends)
    as requested(name, start_time, end_time)
  order by requested.start_time;

  perform set_config(
    'rentcottage.shift_schedule_write_revision_id', '', true
  );

  update public.owner_application_cottage_profiles
  set current_shift_schedule_id = saved_revision.id
  where id = profile.id;

  select jsonb_agg(jsonb_build_object(
    'id', shifts.id,
    'name', shifts.name,
    'startTime', to_char(shifts.start_time, 'HH24:MI'),
    'endTime', to_char(shifts.end_time, 'HH24:MI'),
    'position', shifts.position,
    'crossesMidnight', shifts.end_time < shifts.start_time
  ) order by shifts.position) into saved_shifts
  from public.cottage_shifts shifts
  where shifts.schedule_revision_id = saved_revision.id;

  return jsonb_build_object(
    'profileId', saved_revision.profile_id,
    'revision', saved_revision.revision,
    'fullDayBundleId', saved_revision.full_day_bundle_id,
    'shifts', saved_shifts
  );
end;
$_$;

ALTER FUNCTION "public"."replace_cottage_shift_schedule"("target_profile_id" "uuid", "target_expected_revision" integer, "requested_shifts" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."report_current_cottage_translation"("target_review_cycle_id" "uuid", "target_localized_revision_id" "uuid", "target_reason" "text") RETURNS "public"."cottage_translation_quality_reports"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare cycle public.cottage_profile_review_cycles;
declare revision public.cottage_profile_localized_revisions;
declare report public.cottage_translation_quality_reports;
declare profile public.owner_application_cottage_profiles;
declare publication public.cottage_publication_snapshots;
declare remediation public.cottage_profile_review_cycles;
declare current_head_visible boolean;
declare published_visible boolean;
begin
  if char_length(btrim(coalesce(target_reason, ''))) not between 1 and 1000 then
    raise exception 'A translation report reason is required' using errcode = '22023';
  end if;
  select * into cycle
  from public.cottage_profile_review_cycles
  where id = target_review_cycle_id
  for update;
  if not found or cycle.owner_user_id <> (select auth.uid())
    or not exists (
      select 1 from public.account_contexts contexts
      where contexts.user_id = (select auth.uid())
        and contexts.role = 'cottage_owner'
        and contexts.owner_approval_state = 'approved'
    ) then
    raise exception 'Cottage translation report access is denied' using errcode = '42501';
  end if;
  select * into revision
  from public.cottage_profile_localized_revisions
  where id = target_localized_revision_id
    and review_cycle_id = cycle.id
  for share;
  if not found or revision.origin <> 'generated' then
    raise exception 'A generated localization is required' using errcode = 'RC204';
  end if;
  select * into profile
  from public.owner_application_cottage_profiles
  where id = cycle.profile_id
  for update;
  current_head_visible := cycle.state = 'in_review' and exists (
    select 1 from public.cottage_profile_localized_heads heads
    where heads.review_cycle_id = cycle.id
      and heads.locale = revision.locale
      and heads.localized_revision_id = revision.id
  );
  select snapshots.* into publication
  from public.cottage_publication_snapshots snapshots
  where snapshots.id = profile.current_publication_id
    and snapshots.profile_id = profile.id;
  published_visible := found and exists (
    select 1 from public.cottage_publication_localizations localizations
    where localizations.publication_id = publication.id
      and localizations.locale = revision.locale
      and localizations.localized_revision_id = revision.id
  );
  if not current_head_visible and not published_visible then
    raise exception 'The generated localization is no longer current' using errcode = 'RC409';
  end if;

  select * into report
  from public.cottage_translation_quality_reports reports
  where reports.localized_revision_id = revision.id
    and reports.reporter_user_id = (select auth.uid());
  if found then return report; end if;

  if published_visible then
    select * into remediation
    from public.cottage_profile_review_cycles cycles
    where cycles.profile_id = profile.id and cycles.state = 'in_review'
    for update;
    if found and remediation.remediation_publication_id is distinct from publication.id then
      raise exception 'A different Cottage review cycle is already active' using errcode = 'RC409';
    end if;
    if not found then
      insert into public.cottage_profile_review_cycles (
        profile_id, owner_user_id, source_revision_id, name, governorate,
        approximate_location, capacity, bedrooms, bathrooms, amenities,
        cycle_number, remediation_publication_id
      ) values (
        profile.id, cycle.owner_user_id, cycle.source_revision_id,
        publication.name, publication.governorate,
        publication.approximate_location, publication.capacity,
        publication.bedrooms, publication.bathrooms, publication.amenities,
        coalesce((
          select max(cycles.cycle_number)
          from public.cottage_profile_review_cycles cycles
          where cycles.profile_id = profile.id
        ), 0) + 1,
        publication.id
      ) returning * into remediation;

      insert into public.cottage_profile_localized_revisions (
        review_cycle_id, locale, revision, origin, description, house_rules,
        provider, model, effort, prompt_version,
        administrator_user_id, correction_reason
      )
      select remediation.id, localizations.locale, 1, published.origin,
        localizations.description, localizations.house_rules,
        published.provider, published.model, published.effort,
        published.prompt_version, published.administrator_user_id,
        published.correction_reason
      from public.cottage_publication_localizations localizations
      join public.cottage_profile_localized_revisions published
        on published.id = localizations.localized_revision_id
      where localizations.publication_id = publication.id;

      insert into public.cottage_profile_localized_heads (
        review_cycle_id, locale, localized_revision_id
      )
      select remediation.id, localized.locale, localized.id
      from public.cottage_profile_localized_revisions localized
      where localized.review_cycle_id = remediation.id;

      insert into public.cottage_profile_review_photos (
        review_cycle_id, photo_id, position
      )
      select remediation.id, media.photo_id, media.position
      from public.cottage_publication_media media
      where media.publication_id = publication.id;
    end if;
  else
    remediation := cycle;
  end if;

  insert into public.cottage_translation_quality_reports (
    review_cycle_id, remediation_review_cycle_id, localized_revision_id,
    locale, reporter_user_id, reason
  ) values (
    cycle.id, remediation.id, revision.id, revision.locale,
    (select auth.uid()), btrim(target_reason)
  ) returning * into report;
  return report;
end;
$$;

ALTER FUNCTION "public"."report_current_cottage_translation"("target_review_cycle_id" "uuid", "target_localized_revision_id" "uuid", "target_reason" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."require_complete_cottage_shift_schedule"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare shift_count integer;
begin
  select count(*)::integer into shift_count
  from public.cottage_shifts shifts
  where shifts.schedule_revision_id = new.id;
  if shift_count not between 2 and 3 then
    raise exception 'A Shift Schedule requires exactly two or three Cottage Shifts'
      using errcode = 'RC205';
  end if;
  return null;
end;
$$;

ALTER FUNCTION "public"."require_complete_cottage_shift_schedule"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."require_current_shift_schedule_for_publication"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.current_publication_id is distinct from old.current_publication_id
    and new.current_publication_id is not null
    and new.current_shift_schedule_id is null then
    raise exception 'A current valid Shift Schedule is required for publication'
      using errcode = 'RC205';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."require_current_shift_schedule_for_publication"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reserve_cottage_translation_usage"("target_cache_key" "text", "target_model" "text", "target_effort" "text", "target_prompt_version" "text", "target_reserved_tokens" bigint, "target_reserved_microusd" bigint, "expected_production_approval_digest" "text", "application_monthly_request_limit" bigint, "application_monthly_token_limit" bigint, "application_monthly_spend_microusd_limit" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  control public.cottage_translation_runtime_control;
  month_start date := date_trunc('month', now())::date;
  request_count bigint;
  reserved_tokens numeric;
  reserved_microusd numeric;
  reservation_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  if target_cache_key !~ '^[0-9a-f]{64}$'
    or target_effort not in ('none', 'low', 'medium', 'high', 'xhigh', 'max')
    or char_length(btrim(coalesce(target_model, ''))) < 1
    or char_length(btrim(coalesce(target_prompt_version, ''))) < 1
    or target_reserved_tokens <= 0
    or target_reserved_microusd <= 0
    or application_monthly_request_limit <= 0
    or application_monthly_token_limit <= 0
    or application_monthly_spend_microusd_limit <= 0 then
    raise exception 'Translation reservation is invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cottage-translation-usage-' || month_start::text, 0));
  select * into control
  from public.cottage_translation_runtime_control
  where singleton
  for share;
  if not found or not control.production_ready
    or control.production_approval_digest is distinct from expected_production_approval_digest then
    raise exception 'Production translation is not approved' using errcode = 'RC246';
  end if;

  select count(*), coalesce(sum(usage.reserved_tokens), 0),
    coalesce(sum(usage.reserved_microusd), 0)
  into request_count, reserved_tokens, reserved_microusd
  from public.cottage_translation_usage_reservations usage
  where usage.billing_month = month_start;

  if request_count + 1 > least(control.monthly_request_limit, application_monthly_request_limit)
    or reserved_tokens + target_reserved_tokens
      > least(control.monthly_token_limit, application_monthly_token_limit)
    or reserved_microusd + target_reserved_microusd
      > least(control.monthly_spend_microusd_limit, application_monthly_spend_microusd_limit) then
    return jsonb_build_object('granted', false);
  end if;

  insert into public.cottage_translation_usage_reservations (
    cache_key, model, effort, prompt_version, reserved_tokens,
    reserved_microusd, billing_month
  ) values (
    target_cache_key, btrim(target_model), target_effort,
    btrim(target_prompt_version), target_reserved_tokens,
    target_reserved_microusd, month_start
  ) returning id into reservation_id;

  return jsonb_build_object('granted', true, 'reservation_id', reservation_id);
end;
$_$;

ALTER FUNCTION "public"."reserve_cottage_translation_usage"("target_cache_key" "text", "target_model" "text", "target_effort" "text", "target_prompt_version" "text", "target_reserved_tokens" bigint, "target_reserved_microusd" bigint, "expected_production_approval_digest" "text", "application_monthly_request_limit" bigint, "application_monthly_token_limit" bigint, "application_monthly_spend_microusd_limit" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."resolve_cottage_inventory"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare profile public.owner_application_cottage_profiles;
declare unit record;
declare raw_state public.cottage_inventory_availability_state;
declare effective_price bigint;
declare committed_price bigint;
declare commitment_reference text;
declare committed boolean;
declare component_unavailable boolean;
declare owner_view boolean;
declare service_view boolean;
declare privileged_view boolean;
declare result jsonb := '[]'::jsonb;
declare item jsonb;
begin
  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id;
  if not found then
    raise exception 'Cottage Profile was not found' using errcode = '42501';
  end if;
  service_view := current_setting('role', true) = 'service_role';
  owner_view := profile.owner_user_id = (select auth.uid())
    and exists (
      select 1 from public.account_contexts contexts
      where contexts.user_id = (select auth.uid())
        and contexts.role = 'cottage_owner'
        and contexts.owner_approval_state in ('approved', 'expired', 'suspended')
    );
  privileged_view := owner_view or service_view;
  if not exists (
    select 1 from public.cottage_shift_schedule_revisions revisions
    where revisions.id = target_schedule_revision_id
      and revisions.profile_id = target_profile_id
  ) then
    raise exception 'The Shift Schedule revision does not belong to the Cottage Profile'
      using errcode = '42501';
  end if;
  if not owner_view and not service_view and profile.current_publication_id is null then
    raise exception 'Cottage Profile availability is not public' using errcode = '42501';
  end if;
  if profile.current_shift_schedule_id is distinct from target_schedule_revision_id
    and not service_view then
    raise exception 'The Shift Schedule revision is no longer current' using errcode = 'RC409';
  end if;

  for unit in
    select shifts.id as unit_id,
      'shift'::public.cottage_inventory_unit_kind as unit_kind,
      shifts.position
    from public.cottage_shifts shifts
    where shifts.schedule_revision_id = target_schedule_revision_id
    union all
    select revisions.full_day_bundle_id,
      'full_day_bundle'::public.cottage_inventory_unit_kind,
      32767::smallint
    from public.cottage_shift_schedule_revisions revisions
    where revisions.id = target_schedule_revision_id
    order by position
  loop
    select availability.state into raw_state
    from public.cottage_inventory_availability availability
    where availability.schedule_revision_id = target_schedule_revision_id
      and availability.unit_kind = unit.unit_kind
      and availability.unit_id = unit.unit_id
      and availability.service_day = target_service_day;
    raw_state := coalesce(raw_state, 'closed'::public.cottage_inventory_availability_state);
    effective_price := public.public_cottage_effective_price(
      target_schedule_revision_id, unit.unit_kind, unit.unit_id, target_service_day
    );
    committed := false;
    committed_price := null;
    commitment_reference := null;

    select selected.committed_price_iqd, periods.commitment_reference
      into committed_price, commitment_reference
    from public.cottage_inventory_commitments selected
    join public.cottage_booking_period_commitments periods
      on periods.id = selected.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = periods.id
      and occupancies.schedule_revision_id = periods.schedule_revision_id
      and occupancies.service_day = selected.service_day
      and occupancies.active
      and (
        selected.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
        or occupancies.shift_id = selected.unit_id
      )
    where periods.schedule_revision_id = target_schedule_revision_id
      and selected.unit_kind = unit.unit_kind
      and selected.unit_id = unit.unit_id
      and selected.service_day = target_service_day
    order by selected.created_at, selected.id
    limit 1;
    committed := found;

    if not committed and unit.unit_kind = 'shift'::public.cottage_inventory_unit_kind then
      select selected.committed_price_iqd, periods.commitment_reference
        into committed_price, commitment_reference
      from public.cottage_booking_period_occupancies occupancies
      join public.cottage_booking_period_commitments periods
        on periods.id = occupancies.booking_period_commitment_id
      join public.cottage_inventory_commitments selected
        on selected.booking_period_commitment_id = periods.id
        and selected.service_day = occupancies.service_day
        and selected.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      where occupancies.schedule_revision_id = target_schedule_revision_id
        and occupancies.shift_id = unit.unit_id
        and occupancies.service_day = target_service_day
        and occupancies.active
      limit 1;
      committed := found;
    elsif not committed and unit.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind then
      select selected.committed_price_iqd, periods.commitment_reference
        into committed_price, commitment_reference
      from public.cottage_booking_period_occupancies occupancies
      join public.cottage_booking_period_commitments periods
        on periods.id = occupancies.booking_period_commitment_id
      join public.cottage_inventory_commitments selected
        on selected.booking_period_commitment_id = periods.id
        and selected.service_day = occupancies.service_day
        and selected.unit_kind = 'shift'::public.cottage_inventory_unit_kind
        and selected.unit_id = occupancies.shift_id
      where occupancies.schedule_revision_id = target_schedule_revision_id
        and occupancies.service_day = target_service_day
        and occupancies.active
      order by selected.created_at, selected.id
      limit 1;
      committed := found;
    end if;
    if committed and privileged_view then effective_price := committed_price; end if;
    component_unavailable := unit.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      and exists (
        select 1 from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
          and not public.cottage_inventory_component_is_effectively_available(
            shifts.schedule_revision_id, shifts.id, target_service_day
          )
      );
    item := jsonb_build_object(
      'id', unit.unit_id,
      'kind', unit.unit_kind,
      'priceIqd', effective_price,
      'available', (
        not committed
        and not component_unavailable
        and raw_state = 'open'::public.cottage_inventory_availability_state
        and effective_price is not null
      )
    );
    if privileged_view then
      item := item || jsonb_build_object(
        'ownerState', raw_state,
        'committed', committed,
        'commitmentReference', commitment_reference
      );
    end if;
    result := result || jsonb_build_array(item);
  end loop;
  return jsonb_build_object(
    'profileId', target_profile_id,
    'scheduleRevisionId', target_schedule_revision_id,
    'serviceDay', target_service_day,
    'units', result
  );
end;
$$;

ALTER FUNCTION "public"."resolve_cottage_inventory"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."resolve_cottage_inventory_owner_calendar"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare original jsonb;
declare unit jsonb;
declare result jsonb := '[]'::jsonb;
begin
  original := public.resolve_owner_calendar_without_auth_claim(
    target_profile_id, target_schedule_revision_id, target_service_day
  );
  for unit in select value from jsonb_array_elements(original -> 'units')
  loop
    if public.booking_request_active_claim_conflicts_unit(
      target_schedule_revision_id,
      (unit ->> 'kind')::public.cottage_inventory_unit_kind,
      (unit ->> 'id')::uuid,
      target_service_day
    ) then
      unit := unit || jsonb_build_object(
        'available', false,
        'calendarState', 'unavailable',
        'commitmentReference', null,
        'editable', false
      );
    end if;
    result := result || jsonb_build_array(unit);
  end loop;
  return original || jsonb_build_object('units', result);
end;
$$;

ALTER FUNCTION "public"."resolve_cottage_inventory_owner_calendar"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."resolve_cottage_inventory_public_availability"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."resolve_cottage_inventory_public_availability"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."resolve_cottage_translation_human_review"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.origin = 'administrator_correction' then
    update public.cottage_profile_translation_human_reviews
    set state = 'resolved', resolved_at = now()
    where review_cycle_id = new.review_cycle_id
      and locale = new.locale and state = 'active';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."resolve_cottage_translation_human_review"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."resolve_current_cottage_publication_media"("target_opaque_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."resolve_current_cottage_publication_media"("target_opaque_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."resolve_public_cottage_selection"("target_schedule_revision_id" "uuid", "requested_search" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."resolve_public_cottage_selection"("target_schedule_revision_id" "uuid", "requested_search" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."restore_administrator_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_reason" "text") RETURNS "public"."owner_application_cottage_profiles"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.change_administrator_cottage_profile_draft_lifecycle(
    target_profile_id, target_expected_version, requested_reason, 'draft'
  );
$$;

ALTER FUNCTION "public"."restore_administrator_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_reason" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."route_current_cottage_translation_to_human_review"("target_review_cycle_id" "uuid", "target_locale" "public"."cottage_profile_source_language", "target_reason" "text") RETURNS "public"."cottage_profile_translation_human_reviews"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare cycle public.cottage_profile_review_cycles;
declare source public.cottage_profile_source_revisions;
declare revision public.cottage_profile_localized_revisions;
declare routed public.cottage_profile_translation_human_reviews;
begin
  if not (select public.is_platform_administrator('aal2')) then
    raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(target_reason, ''))) not between 1 and 1000 then
    raise exception 'A human-review reason is required' using errcode = '22023';
  end if;
  select * into cycle
  from public.cottage_profile_review_cycles
  where id = target_review_cycle_id
  for update;
  if not found or cycle.state <> 'in_review' then
    raise exception 'Cottage review cycle is unavailable' using errcode = 'RC204';
  end if;
  select * into source
  from public.cottage_profile_source_revisions
  where id = cycle.source_revision_id;
  if target_locale = source.source_language then
    raise exception 'The owner source cannot be routed for translation' using errcode = '22023';
  end if;
  select revisions.* into revision
  from public.cottage_profile_localized_heads heads
  join public.cottage_profile_localized_revisions revisions
    on revisions.id = heads.localized_revision_id
  where heads.review_cycle_id = cycle.id and heads.locale = target_locale
  for update of revisions;
  if not found or revision.origin <> 'generated' then
    raise exception 'A current generated localization is required' using errcode = 'RC204';
  end if;
  select * into routed
  from public.cottage_profile_translation_human_reviews reviews
  where reviews.review_cycle_id = cycle.id
    and reviews.locale = target_locale
    and reviews.state = 'active'
  for update;
  if found and routed.generated_revision_id = revision.id then return routed; end if;
  if found then
    update public.cottage_profile_translation_human_reviews
    set state = 'superseded', resolved_at = now()
    where id = routed.id;
  end if;
  update public.cottage_profile_translation_attempts
  set state = 'superseded', completed_at = now()
  where review_cycle_id = cycle.id and target_language = target_locale and state = 'pending';
  insert into public.cottage_profile_translation_human_reviews (
    review_cycle_id, locale, generated_revision_id,
    administrator_user_id, reason
  ) values (
    cycle.id, target_locale, revision.id, (select auth.uid()), btrim(target_reason)
  ) returning * into routed;
  return routed;
end;
$$;

ALTER FUNCTION "public"."route_current_cottage_translation_to_human_review"("target_review_cycle_id" "uuid", "target_locale" "public"."cottage_profile_source_language", "target_reason" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."save_cottage_inventory_pricing"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "requested_prices" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exists (
    select 1 from public.owner_application_cottage_profiles profiles
    where profiles.id = target_profile_id and profiles.status = 'abandoned'
  ) then
    raise exception 'An abandoned Cottage Profile is read-only' using errcode = 'RC202';
  end if;
  return public.save_cottage_inventory_pricing_active_profile(
    target_profile_id, target_schedule_revision_id, requested_prices
  );
end;
$$;

ALTER FUNCTION "public"."save_cottage_inventory_pricing"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "requested_prices" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."save_cottage_inventory_pricing_active_profile"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "requested_prices" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    select distinct items.service_day, protected.unit_kind, protected.unit_id
    from public.cottage_inventory_commitments items
    join public.cottage_booking_period_commitments periods
      on periods.id = items.booking_period_commitment_id
    join public.cottage_shift_schedule_revisions revisions
      on revisions.id = periods.schedule_revision_id
    cross join lateral (
      select items.unit_kind, items.unit_id
      union
      select 'full_day_bundle'::public.cottage_inventory_unit_kind,
        revisions.full_day_bundle_id
      where items.unit_kind = 'shift'::public.cottage_inventory_unit_kind
      union
      select 'shift'::public.cottage_inventory_unit_kind, shifts.id
      from public.cottage_shifts shifts
      where items.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
        and shifts.schedule_revision_id = periods.schedule_revision_id
    ) protected(unit_kind, unit_id)
    where periods.schedule_revision_id = target_schedule_revision_id
      and public.cottage_inventory_commitment_end_at(
        periods.schedule_revision_id,
        items.unit_kind,
        items.unit_id,
        items.service_day
      ) > now()
      and (
        (
          items.unit_kind = 'shift'::public.cottage_inventory_unit_kind
          and exists (
            select 1
            from public.cottage_booking_period_occupancies occupancies
            where occupancies.booking_period_commitment_id = periods.id
              and occupancies.schedule_revision_id = periods.schedule_revision_id
              and occupancies.shift_id = items.unit_id
              and occupancies.service_day = items.service_day
              and occupancies.active
          )
        )
        or (
          items.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
          and exists (
            select 1
            from public.cottage_booking_period_occupancies occupancies
            where occupancies.booking_period_commitment_id = periods.id
              and occupancies.schedule_revision_id = periods.schedule_revision_id
              and occupancies.service_day = items.service_day
              and occupancies.active
          )
        )
      )
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
      select shifts.start_time into protected_start_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id
      order by shifts.position limit 1;
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

ALTER FUNCTION "public"."save_cottage_inventory_pricing_active_profile"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "requested_prices" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."save_cottage_inventory_pricing_unchecked_dates"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "requested_prices" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare profile public.owner_application_cottage_profiles;
declare requested_unit jsonb;
declare requested_override jsonb;
declare requested_unit_id uuid;
declare requested_kind public.cottage_inventory_unit_kind;
declare requested_price bigint;
declare standard_price bigint;
declare requested_weekday smallint;
declare requested_day date;
declare unit_start_time time without time zone;
declare seen_unit_ids uuid[] := '{}';
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
  if jsonb_typeof(requested_prices) <> 'object'
    or jsonb_typeof(requested_prices -> 'units') <> 'array' then
    raise exception 'Cottage Inventory pricing input is invalid' using errcode = '22023';
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

  for requested_unit in
    select value from jsonb_array_elements(requested_prices -> 'units')
  loop
    if jsonb_typeof(requested_unit) <> 'object'
      or (requested_unit ->> 'unitId') !~ '^[0-9a-fA-F-]{36}$'
      or (requested_unit ->> 'unitKind') not in ('shift', 'full_day_bundle')
      or jsonb_typeof(requested_unit -> 'standardPriceIqd') <> 'number' then
      raise exception 'Cottage Inventory pricing input is invalid' using errcode = '22023';
    end if;
    requested_unit_id := (requested_unit ->> 'unitId')::uuid;
    requested_kind := (requested_unit ->> 'unitKind')::public.cottage_inventory_unit_kind;
    requested_price := (requested_unit ->> 'standardPriceIqd')::bigint;
    if requested_price <= 0
      or (requested_unit ->> 'standardPriceIqd')::numeric <> requested_price then
        raise exception 'Cottage Inventory prices must be positive whole IQD amounts'
        using errcode = '22023';
    end if;
    standard_price := requested_price;
    if requested_unit_id = any(seen_unit_ids) then
      raise exception 'Cottage Inventory pricing contains a duplicate unit'
        using errcode = '22023';
    end if;
    seen_unit_ids := array_append(seen_unit_ids, requested_unit_id);

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

    delete from public.cottage_inventory_weekday_price_overrides
    where schedule_revision_id = target_schedule_revision_id
      and unit_kind = requested_kind
      and unit_id = requested_unit_id;
    delete from public.cottage_inventory_date_price_overrides prices
    where schedule_revision_id = target_schedule_revision_id
      and unit_kind = requested_kind
      and unit_id = requested_unit_id
      and ((prices.service_day + unit_start_time) at time zone 'Asia/Baghdad') > now();

    for requested_override in
      select value from jsonb_array_elements(coalesce(requested_unit -> 'weekdayOverrides', '[]'::jsonb))
    loop
      if jsonb_typeof(requested_override) <> 'object'
        or (requested_override ->> 'weekday') !~ '^[0-6]$'
        or jsonb_typeof(requested_override -> 'priceIqd') <> 'number' then
        raise exception 'Cottage Inventory weekday pricing input is invalid'
          using errcode = '22023';
      end if;
      requested_weekday := (requested_override ->> 'weekday')::smallint;
      requested_price := (requested_override ->> 'priceIqd')::bigint;
      if requested_price <= 0
        or (requested_override ->> 'priceIqd')::numeric <> requested_price then
        raise exception 'Cottage Inventory prices must be positive whole IQD amounts'
          using errcode = '22023';
      end if;
      insert into public.cottage_inventory_weekday_price_overrides (
        schedule_revision_id, unit_kind, unit_id, weekday, price_iqd
      ) values (
        target_schedule_revision_id, requested_kind, requested_unit_id,
        requested_weekday, requested_price
      );
    end loop;

    for requested_override in
      select value from jsonb_array_elements(coalesce(requested_unit -> 'dateOverrides', '[]'::jsonb))
    loop
      if jsonb_typeof(requested_override) <> 'object'
        or (requested_override ->> 'serviceDay') !~ '^\d{4}-\d{2}-\d{2}$'
        or jsonb_typeof(requested_override -> 'priceIqd') <> 'number' then
        raise exception 'Cottage Inventory date pricing input is invalid'
          using errcode = '22023';
      end if;
      requested_day := (requested_override ->> 'serviceDay')::date;
      requested_price := (requested_override ->> 'priceIqd')::bigint;
      if requested_price <= 0
        or (requested_override ->> 'priceIqd')::numeric <> requested_price then
        raise exception 'Cottage Inventory prices must be positive whole IQD amounts'
          using errcode = '22023';
      end if;
      if ((requested_day + unit_start_time) at time zone 'Asia/Baghdad') <= now() then
        raise exception 'Only future Cottage Inventory can be changed'
          using errcode = 'RC204';
      end if;
      insert into public.cottage_inventory_date_price_overrides (
        schedule_revision_id, unit_kind, unit_id, service_day, price_iqd
      ) values (
        target_schedule_revision_id, requested_kind, requested_unit_id,
        requested_day, requested_price
      );
    end loop;

    insert into public.cottage_inventory_standard_prices (
      schedule_revision_id, unit_kind, unit_id, price_iqd
    ) values (
      target_schedule_revision_id, requested_kind, requested_unit_id, standard_price
    ) on conflict (schedule_revision_id, unit_kind, unit_id)
    do update set price_iqd = excluded.price_iqd;
  end loop;

  delete from public.cottage_inventory_standard_prices
  where schedule_revision_id = target_schedule_revision_id
    and not (unit_kind, unit_id) in (
      select (value ->> 'unitKind')::public.cottage_inventory_unit_kind,
        (value ->> 'unitId')::uuid
      from jsonb_array_elements(requested_prices -> 'units')
    );
  delete from public.cottage_inventory_weekday_price_overrides
  where schedule_revision_id = target_schedule_revision_id
    and not (unit_kind, unit_id) in (
      select (value ->> 'unitKind')::public.cottage_inventory_unit_kind,
        (value ->> 'unitId')::uuid
      from jsonb_array_elements(requested_prices -> 'units')
    );
  delete from public.cottage_inventory_date_price_overrides prices
  where prices.schedule_revision_id = target_schedule_revision_id
    and not (prices.unit_kind, prices.unit_id) in (
      select (value ->> 'unitKind')::public.cottage_inventory_unit_kind,
        (value ->> 'unitId')::uuid
      from jsonb_array_elements(requested_prices -> 'units')
    )
    and ((
      prices.service_day + case prices.unit_kind
        when 'shift'::public.cottage_inventory_unit_kind then (
          select shifts.start_time
          from public.cottage_shifts shifts
          where shifts.schedule_revision_id = prices.schedule_revision_id
            and shifts.id = prices.unit_id
        )
        when 'full_day_bundle'::public.cottage_inventory_unit_kind then (
          select min(shifts.start_time)
          from public.cottage_shifts shifts
          where shifts.schedule_revision_id = prices.schedule_revision_id
        )
      end
    ) at time zone 'Asia/Baghdad') > now();

  return jsonb_build_object(
    'profileId', target_profile_id,
    'scheduleRevisionId', target_schedule_revision_id
  );
end;
$_$;

ALTER FUNCTION "public"."save_cottage_inventory_pricing_unchecked_dates"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "requested_prices" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."search_public_cottages"("target_locale" "public"."cottage_profile_source_language", "requested_search" "jsonb") RETURNS SETOF "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."search_public_cottages"("target_locale" "public"."cottage_profile_source_language", "requested_search" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."set_cottage_inventory_availability"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date", "requested_states" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exists (
    select 1 from public.owner_application_cottage_profiles profiles
    where profiles.id = target_profile_id and profiles.status = 'abandoned'
  ) then
    raise exception 'An abandoned Cottage Profile is read-only' using errcode = 'RC202';
  end if;
  return public.set_cottage_inventory_availability_active_profile(
    target_profile_id, target_schedule_revision_id, target_service_day, requested_states
  );
end;
$$;

ALTER FUNCTION "public"."set_cottage_inventory_availability"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date", "requested_states" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."set_cottage_inventory_availability_active_profile"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date", "requested_states" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;

ALTER FUNCTION "public"."set_cottage_inventory_availability_active_profile"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date", "requested_states" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."set_cottage_inventory_availability_changed_units"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date", "requested_states" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare profile public.owner_application_cottage_profiles;
declare requested_unit jsonb;
declare requested_unit_id uuid;
declare requested_kind public.cottage_inventory_unit_kind;
declare requested_state public.cottage_inventory_availability_state;
declare unit_start_time time without time zone;
begin
  if not exists (
    select 1 from public.account_contexts
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
      select shifts.start_time into unit_start_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id
      order by shifts.position limit 1;
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
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.schedule_revision_id = target_schedule_revision_id
        and occupancies.service_day = target_service_day
        and occupancies.active
        and (
          requested_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
          or occupancies.shift_id = requested_unit_id
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
        select 1 from public.cottage_booking_period_occupancies occupancies
        where occupancies.schedule_revision_id = target_schedule_revision_id
          and occupancies.service_day = target_service_day
          and occupancies.active
      )
      and exists (
        select 1
        from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
          and not public.cottage_inventory_component_is_effectively_available(
            shifts.schedule_revision_id, shifts.id, target_service_day
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
$_$;

ALTER FUNCTION "public"."set_cottage_inventory_availability_changed_units"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date", "requested_states" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."submit_cottage_profile_for_content_approval"("target_profile_id" "uuid", "target_expected_version" bigint) RETURNS "public"."owner_application_cottage_profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  profile public.owner_application_cottage_profiles;
  source_revision public.cottage_profile_source_revisions;
  photo_count integer;
  ready_object_count integer;
begin
  if not exists (
    select 1 from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required'
      using errcode = '42501';
  end if;
  if target_expected_version is null or target_expected_version < 1 then
    raise exception 'A positive Cottage Profile version is required'
      using errcode = '22023';
  end if;

  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id
  for update;

  if not found or profile.owner_user_id <> (select auth.uid()) then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if profile.status = 'submitted_for_content_approval' then
    return profile;
  end if;
  if profile.version <> target_expected_version then
    raise exception 'The Cottage Profile changed before submission'
      using errcode = 'RC409';
  end if;
  if not public.cottage_profile_required_data_is_complete(profile.id) then
    raise exception 'The Cottage Profile is incomplete' using errcode = 'RC203';
  end if;

  select count(*)::integer into photo_count
  from public.cottage_profile_photos photos
  where photos.profile_id = profile.id and photos.is_active;
  ready_object_count := public.cottage_profile_ready_photo_count(profile.id);

  if photo_count not between 1 and 12 or ready_object_count <> photo_count then
    raise exception 'One to twelve ready Cottage Profile photos are required'
      using errcode = 'RC203';
  end if;

  insert into public.cottage_profile_source_revisions (
    profile_id, owner_user_id, source_language, description, house_rules,
    revision
  ) values (
    profile.id, profile.owner_user_id, profile.source_language,
    profile.description, profile.house_rules,
    coalesce((
      select max(revision) from public.cottage_profile_source_revisions
      where profile_id = profile.id
    ), 0) + 1
  ) returning * into source_revision;

  update public.owner_application_cottage_profiles
  set submitted_source_revision_id = source_revision.id,
      status = 'submitted_for_content_approval',
      version = version + 1,
      updated_at = now()
  where id = profile.id
  returning * into profile;

  return profile;
end;
$$;

ALTER FUNCTION "public"."submit_cottage_profile_for_content_approval"("target_profile_id" "uuid", "target_expected_version" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."supersede_human_review_after_publication_rejection"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if old.state = 'in_review' and new.state = 'rejected' then
    update public.cottage_profile_translation_human_reviews
    set state = 'superseded', resolved_at = now()
    where review_cycle_id = new.id and state = 'active';
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."supersede_human_review_after_publication_rejection"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."update_administrator_cottage_profile"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_exact_latitude" numeric, "requested_exact_longitude" numeric, "requested_private_directions" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_source_language" "public"."cottage_profile_source_language", "requested_description" "text", "requested_house_rules" "text") RETURNS "public"."owner_application_cottage_profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  profile public.owner_application_cottage_profiles;
  previous_profile public.owner_application_cottage_profiles;
  ready_photo_count integer;
  changed_fields text[];
begin
  if not (select public.is_platform_administrator('aal2')) then
    raise exception 'AAL2 Platform Administrator access is required'
      using errcode = '42501';
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
    changed_fields
  ) values (
    profile.id, (select auth.uid()), target_expected_version, profile.version,
    changed_fields
  );

  return profile;
end;
$$;

ALTER FUNCTION "public"."update_administrator_cottage_profile"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_exact_latitude" numeric, "requested_exact_longitude" numeric, "requested_private_directions" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_source_language" "public"."cottage_profile_source_language", "requested_description" "text", "requested_house_rules" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."update_owner_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_exact_latitude" numeric, "requested_exact_longitude" numeric, "requested_private_directions" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_source_language" "public"."cottage_profile_source_language", "requested_description" "text", "requested_house_rules" "text") RETURNS "public"."owner_application_cottage_profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  profile public.owner_application_cottage_profiles;
begin
  if not exists (
    select 1
    from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  ) then
    raise exception 'Approved Cottage Owner access is required'
      using errcode = '42501';
  end if;
  if target_expected_version is null or target_expected_version < 1 then
    raise exception 'A positive Cottage Profile version is required'
      using errcode = '22023';
  end if;

  select * into profile
  from public.owner_application_cottage_profiles
  where id = target_profile_id
  for update;

  if not found or profile.owner_user_id <> (select auth.uid()) then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if profile.status <> 'draft' then
    raise exception 'A submitted Cottage Profile cannot be changed by its owner'
      using errcode = 'RC202';
  end if;
  if profile.version <> target_expected_version then
    raise exception 'The Cottage Profile changed before this save'
      using errcode = 'RC409';
  end if;

  select * into profile
  from public.apply_cottage_profile_working_copy(
    profile.id, requested_name, requested_governorate,
    requested_approximate_location, requested_exact_address,
    requested_exact_latitude, requested_exact_longitude,
    requested_private_directions, requested_capacity, requested_bedrooms,
    requested_bathrooms, requested_amenities, requested_source_language,
    requested_description, requested_house_rules
  );

  return profile;
end;
$$;

ALTER FUNCTION "public"."update_owner_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_exact_latitude" numeric, "requested_exact_longitude" numeric, "requested_private_directions" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_source_language" "public"."cottage_profile_source_language", "requested_description" "text", "requested_house_rules" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."validate_cottage_shift_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare new_start integer;
declare new_end integer;
begin
  -- A shift belongs to the immutable revision created in this transaction.
  -- Only the atomic replacement function opens this narrow insert window.
  if current_setting('rentcottage.shift_schedule_write_revision_id', true)
    is distinct from new.schedule_revision_id::text then
    raise exception 'Cottage Shift Schedule history is immutable'
      using errcode = 'RC208';
  end if;

  new_start := extract(epoch from new.start_time)::integer / 60;
  new_end := extract(epoch from new.end_time)::integer / 60;
  if new_end < new_start then new_end := new_end + 1440; end if;

  if exists (
    select 1
    from public.cottage_shifts shifts
    cross join lateral (
      select extract(epoch from shifts.start_time)::integer / 60 as starts,
        extract(epoch from shifts.end_time)::integer / 60
          + case when shifts.end_time < shifts.start_time then 1440 else 0 end
          as ends
    ) interval
    cross join (values (-1440), (0), (1440)) offsets(minutes)
    where shifts.schedule_revision_id = new.schedule_revision_id
      and new_start < interval.ends + offsets.minutes
      and interval.starts + offsets.minutes < new_end
  ) then
    raise exception 'Cottage Shifts cannot overlap on the recurring schedule'
      using errcode = 'RC207';
  end if;

  return new;
end;
$$;

ALTER FUNCTION "public"."validate_cottage_shift_insert"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."validate_public_cottage_search"("requested_search" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;

ALTER FUNCTION "public"."validate_public_cottage_search"("requested_search" "jsonb") OWNER TO "postgres";
