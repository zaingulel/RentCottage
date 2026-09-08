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

CREATE OR REPLACE FUNCTION "public"."activate_owner_application_lifecycle"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  update public.owner_application_lifecycle_control
  set expiry_processor_enabled = true, activated_at = now()
  where singleton;
$$;

ALTER FUNCTION "public"."activate_owner_application_lifecycle"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."complete_owner_verification_document_access"("target_access_grant_id" "uuid", "requested_expires_in_seconds" integer) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  access_grant public.owner_verification_document_access_grants;
begin
  if requested_expires_in_seconds not between 1 and 60 then
    raise exception 'Verification document access expiry is invalid'
      using errcode = 'RC208';
  end if;

  select * into access_grant
  from public.owner_verification_document_access_grants
  where id = target_access_grant_id
  for update;

  if not found then
    raise exception 'Verification document access grant is invalid'
      using errcode = 'RC206';
  end if;

  if access_grant.status = 'completed' then return 'completed'; end if;

  if access_grant.status = 'expired' or access_grant.complete_before <= now() then
    update public.owner_verification_document_access_grants
    set status = 'expired', completed_at = coalesce(completed_at, now())
    where id = access_grant.id;
    return 'expired';
  end if;

  insert into public.owner_verification_document_audit (
    document_id,
    access_grant_id,
    actor_user_id,
    actor_subject_id,
    action,
    object_path,
    access_expires_at
  )
  values (
    access_grant.document_id,
    access_grant.id,
    access_grant.actor_user_id,
    access_grant.actor_subject_id,
    'access_granted',
    access_grant.object_path,
    now() + make_interval(secs => requested_expires_in_seconds)
  );

  update public.owner_verification_document_access_grants
  set status = 'completed', completed_at = now()
  where id = access_grant.id;

  return 'completed';
end;
$$;

ALTER FUNCTION "public"."complete_owner_verification_document_access"("target_access_grant_id" "uuid", "requested_expires_in_seconds" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."complete_owner_verification_document_cleanup"("target_cleanup_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  cleanup public.owner_verification_document_cleanup;
begin
  select * into cleanup
  from public.owner_verification_document_cleanup
  where id = target_cleanup_id
  for update;

  if not found then
    raise exception 'Verification document cleanup is invalid'
      using errcode = 'RC205';
  end if;

  if cleanup.status = 'completed' then return; end if;

  if exists (
    select 1
    from storage.objects
    where bucket_id = public.owner_verification_bucket_name()
      and name = cleanup.object_path
  ) then
    raise exception 'The verification object still requires cleanup'
      using errcode = 'RC205';
  end if;

  if cleanup.reason = 'replaced' then
    insert into public.owner_verification_document_audit (
      document_id,
      actor_user_id,
      actor_subject_id,
      action,
      object_path
    )
    values (
      cleanup.document_id,
      cleanup.actor_user_id,
      cleanup.actor_subject_id,
      'deleted',
      cleanup.object_path
    );
  end if;

  update public.owner_verification_document_cleanup
  set status = 'completed', completed_at = now()
  where id = cleanup.id;
end;
$$;

ALTER FUNCTION "public"."complete_owner_verification_document_cleanup"("target_cleanup_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."install_owner_application_expiry_cron"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
begin
  if not exists (
    select 1 from public.owner_application_lifecycle_control
    where singleton and expiry_processor_enabled
  ) then
    raise exception 'Owner Application lifecycle must be activated first' using errcode = 'RC503';
  end if;
  if to_regnamespace('cron') is null then return false; end if;
  execute $cron$
    select cron.schedule(
      'owner-application-evidence-expiry',
      '15 * * * *',
      'select public.process_expired_owner_applications()'
    )
  $cron$;
  update public.owner_application_lifecycle_control
  set cron_installed_at = now() where singleton;
  return true;
end;
$_$;

ALTER FUNCTION "public"."install_owner_application_expiry_cron"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."is_current_prospective_owner"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'prospective'
  );
$$;

ALTER FUNCTION "public"."is_current_prospective_owner"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."owner_application_active_information_request"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'reason', requests.reason,
    'requested_fields', requests.requested_fields,
    'requested_document_kinds', requests.requested_document_kinds
  )
  from public.owner_application_information_requests requests
  join public.owner_applications applications
    on applications.id = requests.application_id
  where applications.owner_user_id = (select auth.uid())
    and applications.status = 'needs_information'
    and requests.responded_at is null
  order by requests.requested_at desc
  limit 1;
$$;

ALTER FUNCTION "public"."owner_application_active_information_request"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."owner_application_missing_items"() RETURNS "text"[]
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  application public.owner_applications;
  profile public.owner_application_cottage_profiles;
  missing text[] := '{}';
  required_kind public.owner_verification_document_kind;
begin
  select * into application
  from public.owner_applications
  where owner_user_id = (select auth.uid());

  if not found then
    return array['application'];
  end if;

  select * into profile
  from public.owner_application_cottage_profiles
  where application_id = application.id;

  if application.legal_name is null then missing := array_append(missing, 'legal_name'); end if;
  if application.applicant_kind = 'company' and application.company_name is null then
    missing := array_append(missing, 'company_name');
  end if;
  if application.licensing_basis = 'exemption' and application.exemption_basis is null then
    missing := array_append(missing, 'exemption_basis');
  end if;
  if profile.name is null then missing := array_append(missing, 'cottage_name'); end if;
  if profile.governorate is null then missing := array_append(missing, 'governorate'); end if;
  if profile.approximate_location is null then missing := array_append(missing, 'approximate_location'); end if;
  if profile.exact_address is null then missing := array_append(missing, 'exact_address'); end if;
  if profile.capacity is null then missing := array_append(missing, 'capacity'); end if;
  if profile.bedrooms is null then missing := array_append(missing, 'bedrooms'); end if;
  if profile.bathrooms is null then missing := array_append(missing, 'bathrooms'); end if;
  if profile.description is null then missing := array_append(missing, 'description'); end if;
  if profile.house_rules is null then missing := array_append(missing, 'house_rules'); end if;

  for required_kind in
    select required.kind
    from unnest(
      enum_range(null::public.owner_verification_document_kind)
    ) as required(kind)
    where public.owner_verification_kind_is_required(
      application.applicant_kind,
      application.licensing_basis,
      required.kind
    )
  loop
    if not exists (
      select 1
      from public.owner_verification_documents
      join storage.objects
        on objects.bucket_id = public.owner_verification_bucket_name()
        and objects.name = owner_verification_documents.object_path
      where application_id = application.id
        and kind = required_kind
    ) then
      missing := array_append(missing, 'document:' || required_kind::text);
    end if;
  end loop;

  return missing;
end;
$$;

ALTER FUNCTION "public"."owner_application_missing_items"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."owner_application_parse_expiry_date"("value" "text") RETURNS "date"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
declare
  parsed date;
begin
  if value is null or value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  begin
    parsed := value::date;
  exception when others then
    return null;
  end;
  if to_char(parsed, 'YYYY-MM-DD') <> value then
    return null;
  end if;
  return parsed;
end;
$_$;

ALTER FUNCTION "public"."owner_application_parse_expiry_date"("value" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."owner_can_start_new_business"("target_owner_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select auth.uid()) is null
    or ((select auth.uid()) <> target_owner_user_id
      and not (select public.is_platform_administrator('aal2'))) then
    raise exception 'Owner eligibility access is denied' using errcode = '42501';
  end if;

  return exists (
    select 1
    from public.owner_applications applications
    join public.account_contexts contexts on contexts.user_id = applications.owner_user_id
    join public.owner_application_verification_records records
      on records.id = applications.current_verification_record_id
    where applications.owner_user_id = target_owner_user_id
      and applications.status = 'approved'
      and contexts.owner_approval_state = 'approved'
      and not exists (
        select 1 from jsonb_each_text(records.relevant_expiry_dates) expiry
        where public.owner_application_parse_expiry_date(expiry.value) is null
          or public.owner_application_parse_expiry_date(expiry.value) <= current_date
      )
  );
end;
$$;

ALTER FUNCTION "public"."owner_can_start_new_business"("target_owner_user_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."owner_verification_bucket_name"() RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select 'owner-verification'::text;
$$;

ALTER FUNCTION "public"."owner_verification_bucket_name"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."owner_verification_kind_is_required"("applicant_kind" "public"."owner_applicant_kind", "licensing_basis" "public"."owner_licensing_basis", "document_kind" "public"."owner_verification_document_kind") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case document_kind
    when 'identity' then applicant_kind = 'individual'
    when 'company_registration' then applicant_kind = 'company'
    when 'authorised_representative' then applicant_kind = 'company'
    when 'licensing_or_exemption' then licensing_basis = 'licence'
    else true
  end;
$$;

ALTER FUNCTION "public"."owner_verification_kind_is_required"("applicant_kind" "public"."owner_applicant_kind", "licensing_basis" "public"."owner_licensing_basis", "document_kind" "public"."owner_verification_document_kind") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_owner_verification_document_access"("target_document_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  document public.owner_verification_documents;
  access_grant public.owner_verification_document_access_grants;
begin
  if not (select public.is_platform_administrator('aal2')) then
    raise exception 'Verification document access is denied'
      using errcode = 'RC204';
  end if;

  update public.owner_verification_document_access_grants
  set status = 'expired', completed_at = now()
  where status = 'pending'
    and complete_before <= now();

  select owner_verification_documents.* into document
  from public.owner_verification_documents
  join public.owner_applications
    on owner_applications.id = owner_verification_documents.application_id
  where owner_verification_documents.id = target_document_id
    and owner_applications.status = 'submitted';

  if not found then
    raise exception 'Verification document access is denied'
      using errcode = 'RC204';
  end if;

  insert into public.owner_verification_document_access_grants (
    document_id,
    document_subject_id,
    actor_user_id,
    actor_subject_id,
    object_path
  )
  values (
    document.id,
    document.id,
    (select auth.uid()),
    (select auth.uid()),
    document.object_path
  )
  returning * into access_grant;

  return jsonb_build_object(
    'grant_id', access_grant.id,
    'object_path', access_grant.object_path
  );
end;
$$;

ALTER FUNCTION "public"."prepare_owner_verification_document_access"("target_document_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_owner_verification_document_upload"("requested_owner_user_id" "uuid", "requested_application_id" "uuid", "requested_kind" "public"."owner_verification_document_kind", "requested_object_path" "text", "requested_original_filename" "text", "requested_media_type" "text", "requested_size_bytes" integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  application public.owner_applications;
  cleanup_id uuid;
  expected_extension text;
begin
  select * into application
  from public.owner_applications
  where id = requested_application_id
    and owner_user_id = requested_owner_user_id
  for update;

  if not found or application.status <> 'draft' then
    raise exception 'A Draft Owner Application is required'
      using errcode = 'RC202';
  end if;

  if not public.owner_verification_kind_is_required(
    application.applicant_kind,
    application.licensing_basis,
    requested_kind
  ) then
    raise exception 'The verification document is not required for this application'
      using errcode = 'RC205';
  end if;

  if requested_media_type not in ('application/pdf', 'image/jpeg', 'image/png')
    or requested_size_bytes not between 1 and 5242880
    or char_length(btrim(coalesce(requested_original_filename, ''))) not between 1 and 180 then
    raise exception 'The verification document type or size is invalid'
      using errcode = 'RC205';
  end if;

  expected_extension := case requested_media_type
    when 'application/pdf' then 'pdf'
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
  end;

  if requested_object_path !~ (
    '^' || requested_owner_user_id::text || '/' || application.id::text || '/'
    || requested_kind::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.'
    || expected_extension || '$'
  ) then
    raise exception 'The verification object path is invalid'
      using errcode = 'RC205';
  end if;

  insert into public.owner_verification_document_cleanup (
    application_id,
    actor_user_id,
    actor_subject_id,
    reason,
    kind,
    object_path,
    original_filename,
    media_type,
    size_bytes
  )
  values (
    application.id,
    requested_owner_user_id,
    requested_owner_user_id,
    'unregistered_upload',
    requested_kind,
    requested_object_path,
    btrim(requested_original_filename),
    requested_media_type,
    requested_size_bytes
  )
  returning id into cleanup_id;

  return cleanup_id;
end;
$_$;

ALTER FUNCTION "public"."prepare_owner_verification_document_upload"("requested_owner_user_id" "uuid", "requested_application_id" "uuid", "requested_kind" "public"."owner_verification_document_kind", "requested_object_path" "text", "requested_original_filename" "text", "requested_media_type" "text", "requested_size_bytes" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_owner_verification_document_upload_v2"("requested_owner_user_id" "uuid", "requested_application_id" "uuid", "requested_kind" "public"."owner_verification_document_kind", "requested_object_path" "text", "requested_original_filename" "text", "requested_media_type" "text", "requested_size_bytes" integer, "requested_content_digest" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  application public.owner_applications;
  cleanup_id uuid;
  expected_extension text;
  requested_in_active_work boolean;
begin
  select * into application from public.owner_applications
  where id = requested_application_id and owner_user_id = requested_owner_user_id
  for update;
  if not found then
    raise exception 'Owner Application was not found' using errcode = 'RC202';
  end if;

  requested_in_active_work :=
    (
      application.status = 'needs_information'
      and exists (
        select 1 from public.owner_application_information_requests
        where application_id = application.id and responded_at is null
          and requested_kind = any(requested_document_kinds)
      )
    )
    or (
      application.status = 'expired'
      and exists (
        select 1 from public.owner_application_renewal_work
        where application_id = application.id and status = 'open'
          and requested_kind = any(requested_document_kinds)
      )
    );
  if application.status <> 'draft' and not requested_in_active_work then
    raise exception 'The evidence kind is not requested' using errcode = 'RC202';
  end if;
  if application.status = 'draft' and not public.owner_verification_kind_is_required(
    application.applicant_kind, application.licensing_basis, requested_kind
  ) then
    raise exception 'The evidence kind is not required' using errcode = 'RC205';
  end if;
  if requested_content_digest !~ '^[0-9a-f]{64}$'
    or requested_media_type not in ('application/pdf', 'image/jpeg', 'image/png')
    or requested_size_bytes not between 1 and 5242880
    or char_length(btrim(coalesce(requested_original_filename, ''))) not between 1 and 180 then
    raise exception 'The verification document is invalid' using errcode = 'RC205';
  end if;
  expected_extension := case requested_media_type
    when 'application/pdf' then 'pdf'
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
  end;
  if requested_object_path !~ (
    '^' || requested_owner_user_id::text || '/' || application.id::text || '/'
    || requested_kind::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.'
    || expected_extension || '$'
  ) then
    raise exception 'The verification object path is invalid' using errcode = 'RC205';
  end if;

  insert into public.owner_verification_document_cleanup (
    application_id, actor_user_id, actor_subject_id, reason, kind, object_path,
    original_filename, media_type, size_bytes, content_digest, digest_source
  ) values (
    application.id, requested_owner_user_id, requested_owner_user_id,
    'unregistered_upload', requested_kind, requested_object_path,
    btrim(requested_original_filename), requested_media_type,
    requested_size_bytes, requested_content_digest, 'sha256'
  ) returning id into cleanup_id;
  return cleanup_id;
end;
$_$;

ALTER FUNCTION "public"."prepare_owner_verification_document_upload_v2"("requested_owner_user_id" "uuid", "requested_application_id" "uuid", "requested_kind" "public"."owner_verification_document_kind", "requested_object_path" "text", "requested_original_filename" "text", "requested_media_type" "text", "requested_size_bytes" integer, "requested_content_digest" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."process_expired_owner_applications"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  candidate record;
  expired_kinds public.owner_verification_document_kind[];
  processed integer := 0;
begin
  if not exists (
    select 1 from public.owner_application_lifecycle_control
    where singleton and expiry_processor_enabled
  ) then
    return 0;
  end if;

  for candidate in
    select applications.*, records.relevant_expiry_dates,
      records.id as verification_record_id
    from public.owner_applications applications
    join public.owner_application_verification_records records
      on records.id = applications.current_verification_record_id
    where applications.status = 'approved'
      and exists (
        select 1 from jsonb_each_text(records.relevant_expiry_dates) expiry
        where public.owner_application_parse_expiry_date(expiry.value) is null
          or public.owner_application_parse_expiry_date(expiry.value) <= current_date
      )
    for update of applications skip locked
  loop
    select array_agg(expiry.key::public.owner_verification_document_kind order by expiry.key)
    into expired_kinds
    from jsonb_each_text(candidate.relevant_expiry_dates) expiry
    where public.owner_application_parse_expiry_date(expiry.value) is null
      or public.owner_application_parse_expiry_date(expiry.value) <= current_date;

    update public.owner_applications
    set status = 'expired', version = version + 1, updated_at = now()
    where id = candidate.id;
    update public.account_contexts
    set owner_approval_state = 'expired', updated_at = now()
    where user_id = candidate.owner_user_id;
    insert into public.owner_application_renewal_work (
      application_id, verification_record_id, requested_document_kinds
    ) values (candidate.id, candidate.verification_record_id, expired_kinds);
    insert into public.owner_application_transitions (
      application_id, from_status, to_status, application_version, actor_subject_id,
      reason
    ) values (
      candidate.id, 'approved', 'expired', candidate.version + 1,
      'owner-application-expiry-processor', 'Required evidence expired'
    );
    insert into public.owner_application_notices (application_id, owner_user_id, kind)
    values (candidate.id, candidate.owner_user_id, 'expired');
    processed := processed + 1;
  end loop;
  return processed;
end;
$$;

ALTER FUNCTION "public"."process_expired_owner_applications"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reconcile_owner_verification_document_registration"("target_cleanup_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  cleanup public.owner_verification_document_cleanup;
  document public.owner_verification_documents;
  replacement public.owner_verification_document_cleanup;
begin
  select * into cleanup
  from public.owner_verification_document_cleanup
  where id = target_cleanup_id
    and reason = 'unregistered_upload'
  for update;

  if not found then
    raise exception 'The verification upload operation is invalid'
      using errcode = 'RC205';
  end if;

  if cleanup.status = 'pending' then
    return jsonb_build_object('status', 'unregistered');
  end if;

  select * into document
  from public.owner_verification_documents
  where id = cleanup.document_id
    and object_path = cleanup.object_path;

  if not found then
    return jsonb_build_object('status', 'unregistered');
  end if;

  if cleanup.replacement_cleanup_id is not null then
    select * into replacement
    from public.owner_verification_document_cleanup
    where id = cleanup.replacement_cleanup_id;
  end if;

  return jsonb_build_object(
    'status', 'registered',
    'document_id', document.id,
    'previous_object_path', replacement.object_path,
    'previous_cleanup_id', replacement.id
  );
end;
$$;

ALTER FUNCTION "public"."reconcile_owner_verification_document_registration"("target_cleanup_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."record_owner_verification_document_version"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'UPDATE'
    and new.object_path = old.object_path
    and new.content_digest = old.content_digest then
    return new;
  end if;

  insert into public.owner_verification_document_versions (
    document_id, application_id, kind, version, object_path, original_filename,
    media_type, size_bytes, content_digest, digest_source
  )
  values (
    new.id, new.application_id, new.kind,
    coalesce((select max(version) + 1
      from public.owner_verification_document_versions
      where document_id = new.id), 1),
    new.object_path, new.original_filename, new.media_type, new.size_bytes,
    new.content_digest, new.digest_source
  );
  return new;
end;
$$;

ALTER FUNCTION "public"."record_owner_verification_document_version"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."register_owner_verification_document"("target_cleanup_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  cleanup public.owner_verification_document_cleanup;
  application public.owner_applications;
  existing_document public.owner_verification_documents;
  document public.owner_verification_documents;
  action public.owner_verification_document_action := 'uploaded';
  stored_metadata jsonb;
  previous_cleanup_id uuid;
begin
  select * into cleanup
  from public.owner_verification_document_cleanup
  where id = target_cleanup_id
    and reason = 'unregistered_upload'
    and status = 'pending'
  for update;

  if not found then
    raise exception 'The verification upload operation is invalid'
      using errcode = 'RC205';
  end if;

  select * into application
  from public.owner_applications
  where id = cleanup.application_id
  for update;

  if not found or application.status <> 'draft' then
    raise exception 'A Draft Owner Application is required'
      using errcode = 'RC202';
  end if;

  if not public.owner_verification_kind_is_required(
    application.applicant_kind,
    application.licensing_basis,
    cleanup.kind
  ) then
    raise exception 'The verification document is not required for this application'
      using errcode = 'RC205';
  end if;

  select metadata into stored_metadata
  from storage.objects
  where bucket_id = public.owner_verification_bucket_name()
    and name = cleanup.object_path;

  if not found
    or stored_metadata ->> 'mimetype' <> cleanup.media_type
    or coalesce(stored_metadata ->> 'size', '') !~ '^[0-9]+$'
    or (stored_metadata ->> 'size')::integer <> cleanup.size_bytes then
    raise exception 'The uploaded verification object does not match its metadata'
      using errcode = 'RC205';
  end if;

  select * into existing_document
  from public.owner_verification_documents
  where application_id = cleanup.application_id
    and kind = cleanup.kind;

  if found then action := 'replaced'; end if;

  insert into public.owner_verification_documents (
    application_id,
    kind,
    object_path,
    original_filename,
    media_type,
    size_bytes
  )
  values (
    cleanup.application_id,
    cleanup.kind,
    cleanup.object_path,
    cleanup.original_filename,
    cleanup.media_type,
    cleanup.size_bytes
  )
  on conflict (application_id, kind) do update
  set object_path = excluded.object_path,
      original_filename = excluded.original_filename,
      media_type = excluded.media_type,
      size_bytes = excluded.size_bytes,
      updated_at = now()
  returning * into document;

  insert into public.owner_verification_document_audit (
    document_id,
    actor_user_id,
    actor_subject_id,
    action,
    object_path
  )
  values (
    document.id,
    cleanup.actor_user_id,
    cleanup.actor_subject_id,
    action,
    document.object_path
  );

  if existing_document.id is not null then
    insert into public.owner_verification_document_cleanup (
      application_id,
      document_id,
      actor_user_id,
      actor_subject_id,
      reason,
      kind,
      object_path,
      original_filename,
      media_type,
      size_bytes
    )
    values (
      cleanup.application_id,
      document.id,
      cleanup.actor_user_id,
      cleanup.actor_subject_id,
      'replaced',
      existing_document.kind,
      existing_document.object_path,
      existing_document.original_filename,
      existing_document.media_type,
      existing_document.size_bytes
    )
    returning id into previous_cleanup_id;
  end if;

  update public.owner_verification_document_cleanup
  set status = 'completed',
      completed_at = now(),
      document_id = document.id,
      replacement_cleanup_id = previous_cleanup_id
  where id = cleanup.id;

  return jsonb_build_object(
    'document_id', document.id,
    'previous_object_path', existing_document.object_path,
    'previous_cleanup_id', previous_cleanup_id
  );
end;
$_$;

ALTER FUNCTION "public"."register_owner_verification_document"("target_cleanup_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."register_owner_verification_document_v2"("target_cleanup_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  cleanup public.owner_verification_document_cleanup;
  application public.owner_applications;
  existing_document public.owner_verification_documents;
  document public.owner_verification_documents;
  action public.owner_verification_document_action := 'uploaded';
  stored_metadata jsonb;
  previous_cleanup_id uuid;
  requested_in_active_work boolean;
begin
  select * into cleanup from public.owner_verification_document_cleanup
  where id = target_cleanup_id and reason = 'unregistered_upload'
    and status = 'pending' and digest_source = 'sha256'
  for update;
  if not found then
    raise exception 'The verification upload operation is invalid' using errcode = 'RC205';
  end if;
  select * into application from public.owner_applications
  where id = cleanup.application_id for update;

  requested_in_active_work :=
    (
      application.status = 'needs_information'
      and exists (
        select 1 from public.owner_application_information_requests
        where application_id = application.id and responded_at is null
          and cleanup.kind = any(requested_document_kinds)
      )
    )
    or (
      application.status = 'expired'
      and exists (
        select 1 from public.owner_application_renewal_work
        where application_id = application.id and status = 'open'
          and cleanup.kind = any(requested_document_kinds)
      )
    );
  if not found or (application.status <> 'draft' and not requested_in_active_work) then
    raise exception 'The evidence kind is not requested' using errcode = 'RC202';
  end if;

  select metadata into stored_metadata from storage.objects
  where bucket_id = public.owner_verification_bucket_name()
    and name = cleanup.object_path;
  if not found or stored_metadata ->> 'mimetype' <> cleanup.media_type
    or coalesce(stored_metadata ->> 'size', '') !~ '^[0-9]+$'
    or (stored_metadata ->> 'size')::integer <> cleanup.size_bytes then
    raise exception 'The uploaded object does not match its metadata' using errcode = 'RC205';
  end if;

  select * into existing_document from public.owner_verification_documents
  where application_id = cleanup.application_id and kind = cleanup.kind;
  if found then action := 'replaced'; end if;

  insert into public.owner_verification_documents (
    application_id, kind, object_path, original_filename, media_type, size_bytes,
    content_digest, digest_source
  ) values (
    cleanup.application_id, cleanup.kind, cleanup.object_path,
    cleanup.original_filename, cleanup.media_type, cleanup.size_bytes,
    cleanup.content_digest, 'sha256'
  )
  on conflict (application_id, kind) do update set
    object_path = excluded.object_path,
    original_filename = excluded.original_filename,
    media_type = excluded.media_type,
    size_bytes = excluded.size_bytes,
    content_digest = excluded.content_digest,
    digest_source = excluded.digest_source,
    updated_at = now()
  returning * into document;

  insert into public.owner_verification_document_audit (
    document_id, actor_user_id, actor_subject_id, action, object_path
  ) values (
    document.id, cleanup.actor_user_id, cleanup.actor_subject_id, action,
    document.object_path
  );
  if existing_document.id is not null then
    insert into public.owner_verification_document_cleanup (
      application_id, document_id, actor_user_id, actor_subject_id, reason,
      kind, object_path, original_filename, media_type, size_bytes,
      content_digest, digest_source
    ) values (
      cleanup.application_id, document.id, cleanup.actor_user_id,
      cleanup.actor_subject_id, 'replaced', existing_document.kind,
      existing_document.object_path, existing_document.original_filename,
      existing_document.media_type, existing_document.size_bytes,
      existing_document.content_digest, existing_document.digest_source
    ) returning id into previous_cleanup_id;
  end if;
  update public.owner_verification_document_cleanup
  set status = 'completed', completed_at = now(), document_id = document.id,
    replacement_cleanup_id = previous_cleanup_id
  where id = cleanup.id;
  return jsonb_build_object(
    'document_id', document.id,
    'previous_object_path', existing_document.object_path,
    'previous_cleanup_id', previous_cleanup_id
  );
end;
$_$;

ALTER FUNCTION "public"."register_owner_verification_document_v2"("target_cleanup_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_owner_application_history_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  raise exception 'Owner Application history is append-only' using errcode = 'RC405';
end;
$$;

ALTER FUNCTION "public"."reject_owner_application_history_mutation"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."resolve_owner_calendar_without_auth_claim"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare original jsonb;
declare unit jsonb;
declare direct_status text;
declare direct_reference text;
declare bundle_status text;
declare bundle_reference text;
declare component_found boolean;
declare state text;
declare reference text;
declare editable boolean;
declare result jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1
    from public.owner_application_cottage_profiles profiles
    join public.account_contexts contexts on contexts.user_id = profiles.owner_user_id
    where profiles.id = target_profile_id
      and profiles.owner_user_id = (select auth.uid())
      and contexts.role = 'cottage_owner'
      and contexts.owner_approval_state in ('approved', 'expired', 'suspended')
  ) and current_setting('role', true) <> 'service_role' then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;

  original := public.resolve_cottage_inventory(
    target_profile_id, target_schedule_revision_id, target_service_day
  );
  for unit in select value from jsonb_array_elements(original -> 'units')
  loop
    direct_status := null;
    direct_reference := null;
    bundle_status := null;
    bundle_reference := null;
    component_found := false;
    select periods.status::text, periods.commitment_reference
      into direct_status, direct_reference
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
      and selected.unit_kind = (unit ->> 'kind')::public.cottage_inventory_unit_kind
      and selected.unit_id = (unit ->> 'id')::uuid
      and selected.service_day = target_service_day
    limit 1;
    if unit ->> 'kind' = 'shift' then
      select periods.status::text, periods.commitment_reference
        into bundle_status, bundle_reference
      from public.cottage_booking_period_occupancies occupancies
      join public.cottage_booking_period_commitments periods
        on periods.id = occupancies.booking_period_commitment_id
      join public.cottage_inventory_commitments selected
        on selected.booking_period_commitment_id = periods.id
        and selected.service_day = occupancies.service_day
        and selected.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      where occupancies.schedule_revision_id = target_schedule_revision_id
        and occupancies.shift_id = (unit ->> 'id')::uuid
        and occupancies.service_day = target_service_day
        and occupancies.active
      limit 1;
    else
      select exists (
        select 1
        from public.cottage_booking_period_occupancies occupancies
        join public.cottage_inventory_commitments selected
          on selected.booking_period_commitment_id = occupancies.booking_period_commitment_id
          and selected.service_day = occupancies.service_day
          and selected.unit_kind = 'shift'::public.cottage_inventory_unit_kind
          and selected.unit_id = occupancies.shift_id
        where occupancies.schedule_revision_id = target_schedule_revision_id
          and occupancies.service_day = target_service_day
          and occupancies.active
      ) into component_found;
    end if;

    if direct_status is not null then
      state := direct_status;
      reference := direct_reference;
      editable := false;
    elsif bundle_status is not null then
      state := bundle_status;
      reference := bundle_reference;
      editable := false;
    elsif component_found then
      state := 'component_unavailable';
      reference := null;
      editable := false;
    else
      state := unit ->> 'ownerState';
      reference := null;
      editable := true;
    end if;
    result := result || jsonb_build_array(jsonb_build_object(
      'id', unit -> 'id',
      'kind', unit -> 'kind',
      'priceIqd', unit -> 'priceIqd',
      'available', unit -> 'available',
      'calendarState', state,
      'commitmentReference', reference,
      'editable', editable
    ));
  end loop;
  return jsonb_build_object(
    'profileId', original -> 'profileId',
    'scheduleRevisionId', original -> 'scheduleRevisionId',
    'serviceDay', original -> 'serviceDay',
    'units', result
  );
end;
$$;

ALTER FUNCTION "public"."resolve_owner_calendar_without_auth_claim"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."respond_to_owner_application_request"("expected_version" bigint, "requested_field_values" "jsonb", "confirmed_document_kinds" "public"."owner_verification_document_kind"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  application public.owner_applications;
  information_request public.owner_application_information_requests;
  supplied_fields text[];
  supplied_document_kinds public.owner_verification_document_kind[];
begin
  select * into application from public.owner_applications
  where owner_user_id = (select auth.uid()) for update;
  if not found or application.status <> 'needs_information' then
    raise exception 'An active information request is required' using errcode = 'RC422';
  end if;
  if application.version <> expected_version then
    raise exception 'Owner Application changed before this response' using errcode = 'RC409';
  end if;
  select * into information_request from public.owner_application_information_requests
  where application_id = application.id and responded_at is null for update;
  if not found or jsonb_typeof(requested_field_values) <> 'object' then
    raise exception 'The information response is invalid' using errcode = 'RC422';
  end if;
  select coalesce(array_agg(key order by key), '{}') into supplied_fields
  from jsonb_object_keys(requested_field_values) key;
  if supplied_fields <> (
    select coalesce(array_agg(field order by field), '{}')
    from unnest(information_request.requested_fields) field
  ) then
    raise exception 'Only the requested fields may be changed' using errcode = 'RC422';
  end if;

  if exists (
    select 1
    from jsonb_each(requested_field_values) supplied(key, value)
    where case
      when supplied.key in (
        'legal_name', 'cottage_name', 'governorate', 'approximate_location',
        'exact_address', 'description', 'house_rules'
      ) then
        jsonb_typeof(supplied.value) is distinct from 'string'
        or char_length(btrim(supplied.value #>> '{}')) not between 1 and case supplied.key
          when 'legal_name' then 120
          when 'cottage_name' then 120
          when 'governorate' then 120
          when 'approximate_location' then 240
          when 'exact_address' then 240
          when 'description' then 2000
          when 'house_rules' then 1500
        end
      when supplied.key in ('company_name', 'exemption_basis') then
        jsonb_typeof(supplied.value) is distinct from 'string'
        or char_length(btrim(supplied.value #>> '{}')) > case supplied.key
          when 'company_name' then 120 else 1000 end
      when supplied.key = 'licensing_basis' then
        jsonb_typeof(supplied.value) is distinct from 'string'
        or (supplied.value #>> '{}') not in ('licence', 'exemption')
      when supplied.key in ('capacity', 'bedrooms', 'bathrooms') then
        case
          when jsonb_typeof(supplied.value) is distinct from 'number' then true
          when supplied.value::text !~ '^\d+$' then true
          else (supplied.value::text)::numeric not between 1 and case supplied.key
            when 'capacity' then 100 else 50 end
        end
      when supplied.key = 'amenities' then
        case
          when jsonb_typeof(supplied.value) is distinct from 'array' then true
          else jsonb_array_length(supplied.value) > 6
            or exists (
              select 1 from jsonb_array_elements(supplied.value) amenity
              where jsonb_typeof(amenity) is distinct from 'string'
                or (amenity #>> '{}') not in (
                  'garden', 'parking', 'pool', 'air_conditioning', 'wifi', 'outdoor_seating'
                )
            )
        end
      else true
    end
  ) then
    raise exception 'A requested field value is invalid' using errcode = 'RC422';
  end if;

  if (
    select coalesce(array_agg(kind order by kind::text), '{}')
    from unnest(coalesce(confirmed_document_kinds, '{}')) kind
  ) <> (
    select coalesce(array_agg(kind order by kind::text), '{}')
    from unnest(information_request.requested_document_kinds) kind
  ) then
    raise exception 'Every requested evidence kind is required' using errcode = 'RC422';
  end if;

  select coalesce(array_agg(versions.kind order by versions.kind::text), '{}')
  into supplied_document_kinds
  from public.owner_verification_document_versions versions
  join public.owner_verification_documents documents on documents.id = versions.document_id
  where versions.application_id = application.id
    and versions.object_path = documents.object_path
    and versions.content_digest = documents.content_digest
    and versions.digest_source = 'sha256'
    and versions.recorded_at >= information_request.requested_at
    and versions.kind = any(information_request.requested_document_kinds);
  if supplied_document_kinds <> (
    select coalesce(array_agg(kind order by kind::text), '{}')
    from unnest(information_request.requested_document_kinds) kind
  ) then
    raise exception 'Every requested evidence version is required' using errcode = 'RC422';
  end if;

  update public.owner_applications set
    legal_name = case when requested_field_values ? 'legal_name'
      then nullif(btrim(requested_field_values ->> 'legal_name'), '') else legal_name end,
    company_name = case when requested_field_values ? 'company_name'
      then nullif(btrim(requested_field_values ->> 'company_name'), '') else company_name end,
    licensing_basis = case when requested_field_values ? 'licensing_basis'
      then (requested_field_values ->> 'licensing_basis')::public.owner_licensing_basis
      else licensing_basis end,
    exemption_basis = case
      when requested_field_values ->> 'licensing_basis' = 'licence' then null
      when requested_field_values ? 'exemption_basis'
        then nullif(btrim(requested_field_values ->> 'exemption_basis'), '')
      else exemption_basis end,
    updated_at = now()
  where id = application.id returning * into application;

  update public.owner_application_cottage_profiles set
    name = case when requested_field_values ? 'cottage_name'
      then nullif(btrim(requested_field_values ->> 'cottage_name'), '') else name end,
    governorate = case when requested_field_values ? 'governorate'
      then nullif(btrim(requested_field_values ->> 'governorate'), '') else governorate end,
    approximate_location = case when requested_field_values ? 'approximate_location'
      then nullif(btrim(requested_field_values ->> 'approximate_location'), '') else approximate_location end,
    exact_address = case when requested_field_values ? 'exact_address'
      then nullif(btrim(requested_field_values ->> 'exact_address'), '') else exact_address end,
    capacity = case when requested_field_values ? 'capacity'
      then (requested_field_values ->> 'capacity')::smallint else capacity end,
    bedrooms = case when requested_field_values ? 'bedrooms'
      then (requested_field_values ->> 'bedrooms')::smallint else bedrooms end,
    bathrooms = case when requested_field_values ? 'bathrooms'
      then (requested_field_values ->> 'bathrooms')::smallint else bathrooms end,
    amenities = case when requested_field_values ? 'amenities'
      then array(select jsonb_array_elements_text(requested_field_values -> 'amenities')) else amenities end,
    description = case when requested_field_values ? 'description'
      then nullif(btrim(requested_field_values ->> 'description'), '') else description end,
    house_rules = case when requested_field_values ? 'house_rules'
      then nullif(btrim(requested_field_values ->> 'house_rules'), '') else house_rules end,
    updated_at = now()
  where application_id = application.id;

  if cardinality(public.owner_application_missing_items()) > 0
    or (application.applicant_kind = 'individual' and application.company_name is not null)
    or (application.licensing_basis = 'licence' and application.exemption_basis is not null) then
    raise exception 'The Owner Application response is incomplete' using errcode = 'RC422';
  end if;

  update public.owner_applications
  set status = 'under_review', review_due_at = now() + review_remaining,
    review_paused_at = null, version = version + 1, updated_at = now()
  where id = application.id returning * into application;

  update public.owner_application_information_requests
  set responded_at = now(), response_version = application.version
  where id = information_request.id;
  insert into public.owner_application_transitions (
    application_id, from_status, to_status, application_version,
    actor_user_id, actor_subject_id
  ) values (
    application.id, 'needs_information', 'under_review', application.version,
    (select auth.uid()), (select auth.uid())::text
  );
  insert into public.owner_application_notices (application_id, owner_user_id, kind)
  values (application.id, application.owner_user_id, 'response_received');

  return jsonb_build_object(
    'application_id', application.id, 'status', application.status,
    'version', application.version, 'occurred_at', application.updated_at,
    'review_due_at', application.review_due_at
  );
end;
$_$;

ALTER FUNCTION "public"."respond_to_owner_application_request"("expected_version" bigint, "requested_field_values" "jsonb", "confirmed_document_kinds" "public"."owner_verification_document_kind"[]) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."review_owner_application"("target_application_id" "uuid", "expected_version" bigint, "requested_action" "text", "requested_reason" "text", "requested_fields" "text"[], "requested_document_kinds" "public"."owner_verification_document_kind"[], "requested_jurisdiction" "text", "requested_licensing_basis" "public"."owner_licensing_basis", "requested_licence_or_exemption_basis" "text", "requested_expiry_dates" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  application public.owner_applications;
  previous_status public.owner_application_status;
  verification_record_id uuid;
  evidence_version_ids uuid[];
  evidence_types public.owner_verification_document_kind[];
  result_status public.owner_application_status;
begin
  if not (select public.is_platform_administrator('aal2')) then
    raise exception 'Platform Administrator MFA is required' using errcode = '42501';
  end if;

  select * into application from public.owner_applications
  where id = target_application_id for update;
  if not found then
    raise exception 'Owner Application was not found' using errcode = 'RC404';
  end if;
  if application.version <> expected_version then
    raise exception 'Owner Application changed before this action' using errcode = 'RC409';
  end if;
  previous_status := application.status;

  if requested_action = 'start_review' then
    if application.status <> 'submitted' then
      raise exception 'This application cannot enter review' using errcode = 'RC422';
    end if;
    result_status := 'under_review';
    update public.owner_applications
    set status = result_status, version = version + 1, updated_at = now()
    where id = application.id returning * into application;
  elsif requested_action = 'request_information' then
    if application.status not in ('submitted', 'under_review')
      or application.review_started_at is null
      or application.review_due_at is null
      or char_length(btrim(coalesce(requested_reason, ''))) not between 1 and 1000
      or cardinality(coalesce(requested_fields, '{}'))
        + cardinality(coalesce(requested_document_kinds, '{}')) < 1
      or not coalesce(requested_fields, '{}') <@ array[
        'legal_name', 'company_name', 'licensing_basis', 'exemption_basis',
        'cottage_name', 'governorate', 'approximate_location', 'exact_address',
        'capacity', 'bedrooms', 'bathrooms', 'amenities', 'description', 'house_rules'
      ]::text[] then
      raise exception 'The missing-information request is invalid' using errcode = 'RC422';
    end if;
    result_status := 'needs_information';
    update public.owner_applications
    set status = result_status,
        review_remaining = greatest(review_due_at - now(), interval '0 seconds'),
        review_due_at = null,
        review_paused_at = now(),
        version = version + 1,
        updated_at = now()
    where id = application.id returning * into application;
    insert into public.owner_application_information_requests (
      application_id, requested_by_user_id, requested_by_subject_id, reason,
      requested_fields, requested_document_kinds
    ) values (
      application.id, (select auth.uid()), (select auth.uid()), btrim(requested_reason),
      coalesce(requested_fields, '{}'), coalesce(requested_document_kinds, '{}')
    );
    insert into public.owner_application_notices (
      application_id, owner_user_id, kind, reason
    ) values (application.id, application.owner_user_id, 'information_requested', btrim(requested_reason));
  elsif requested_action in ('approve', 'reject') then
    if application.status not in ('submitted', 'under_review')
      or char_length(btrim(coalesce(requested_reason, ''))) not between 1 and 1000 then
      raise exception 'This decision is invalid for the application state' using errcode = 'RC422';
    end if;
    result_status := case requested_action
      when 'approve' then 'approved'::public.owner_application_status
      else 'rejected'::public.owner_application_status
    end;
    if requested_action = 'approve' then
      if char_length(btrim(coalesce(requested_jurisdiction, ''))) not between 1 and 120
        or char_length(btrim(coalesce(requested_licence_or_exemption_basis, ''))) not between 1 and 1000
        or requested_licensing_basis is null
        or requested_expiry_dates is null
        or jsonb_typeof(requested_expiry_dates) <> 'object'
        or exists (
          select 1 from jsonb_each_text(requested_expiry_dates) expiry
          where expiry.key not in (
            select unnest(enum_range(null::public.owner_verification_document_kind))::text
          )
          or public.owner_application_parse_expiry_date(expiry.value) is null
          or public.owner_application_parse_expiry_date(expiry.value) <= current_date
        ) then
        raise exception 'The approval record is incomplete' using errcode = 'RC422';
      end if;

      select array_agg(versions.id order by versions.kind::text),
        array_agg(versions.kind order by versions.kind::text)
      into evidence_version_ids, evidence_types
      from public.owner_verification_document_versions versions
      join public.owner_verification_documents documents on documents.id = versions.document_id
      where documents.application_id = application.id
        and versions.object_path = documents.object_path
        and versions.content_digest = documents.content_digest
        and versions.digest_source = 'sha256';

      if coalesce(cardinality(evidence_version_ids), 0) < 1
        or coalesce(cardinality(evidence_version_ids), 0) <> (
        select count(*) from public.owner_verification_documents
        where application_id = application.id
      ) then
        raise exception 'Every reviewed document needs a content-bound version' using errcode = 'RC422';
      end if;

      insert into public.owner_application_verification_records (
        application_id, version, reviewer_user_id, reviewer_subject_id,
        decision, reason, jurisdiction, licensing_basis,
        licence_or_exemption_basis, evidence_version_ids, evidence_types,
        relevant_expiry_dates
      ) values (
        application.id,
        coalesce((select max(version) + 1 from public.owner_application_verification_records
          where application_id = application.id), 1),
        (select auth.uid()), (select auth.uid()), 'approved', btrim(requested_reason),
        btrim(requested_jurisdiction), requested_licensing_basis,
        btrim(requested_licence_or_exemption_basis), evidence_version_ids,
        evidence_types, requested_expiry_dates
      ) returning id into verification_record_id;
    else
      insert into public.owner_application_verification_records (
        application_id, version, reviewer_user_id, reviewer_subject_id,
        decision, reason, jurisdiction, licensing_basis,
        licence_or_exemption_basis, evidence_version_ids, evidence_types
      ) values (
        application.id,
        coalesce((select max(version) + 1 from public.owner_application_verification_records
          where application_id = application.id), 1),
        (select auth.uid()), (select auth.uid()), 'rejected', btrim(requested_reason),
        'Not applicable', application.licensing_basis, 'Rejected before approval',
        '{}', '{}'
      ) returning id into verification_record_id;
    end if;
    update public.owner_applications
    set status = result_status, current_verification_record_id = verification_record_id,
        review_due_at = null, review_paused_at = null, decided_at = now(),
        version = version + 1, updated_at = now()
    where id = application.id returning * into application;
    update public.account_contexts
    set owner_approval_state = case when result_status = 'approved'
        then 'approved'::public.owner_approval_state
        else 'prospective'::public.owner_approval_state end,
      updated_at = now()
    where user_id = application.owner_user_id;
    if requested_action = 'approve' then
      update public.owner_application_renewal_work
      set status = 'completed', completed_at = now()
      where application_id = application.id and status = 'submitted';
    end if;
    insert into public.owner_application_notices (application_id, owner_user_id, kind, reason)
    values (
      application.id,
      application.owner_user_id,
      case requested_action when 'approve' then 'approved' else 'rejected' end,
      btrim(requested_reason)
    );
  elsif requested_action = 'suspend' then
    if application.status not in ('approved', 'expired')
      or char_length(btrim(coalesce(requested_reason, ''))) not between 1 and 1000 then
      raise exception 'This suspension is invalid' using errcode = 'RC422';
    end if;
    result_status := 'suspended';
    update public.owner_applications
    set status = result_status, review_due_at = null, review_paused_at = null,
      version = version + 1, updated_at = now()
    where id = application.id returning * into application;
    update public.account_contexts set owner_approval_state = 'suspended', updated_at = now()
    where user_id = application.owner_user_id;
    insert into public.owner_application_notices (application_id, owner_user_id, kind, reason)
    values (application.id, application.owner_user_id, 'suspended', btrim(requested_reason));
  else
    raise exception 'Unknown Owner Application review action' using errcode = 'RC422';
  end if;

  insert into public.owner_application_transitions (
    application_id, from_status, to_status, application_version,
    actor_user_id, actor_subject_id, reason
  ) values (
    application.id, previous_status, application.status, application.version,
    (select auth.uid()), (select auth.uid())::text, nullif(btrim(coalesce(requested_reason, '')), '')
  );

  return jsonb_build_object(
    'application_id', application.id, 'status', application.status,
    'version', application.version, 'occurred_at', application.updated_at,
    'review_due_at', application.review_due_at
  );
end;
$$;

ALTER FUNCTION "public"."review_owner_application"("target_application_id" "uuid", "expected_version" bigint, "requested_action" "text", "requested_reason" "text", "requested_fields" "text"[], "requested_document_kinds" "public"."owner_verification_document_kind"[], "requested_jurisdiction" "text", "requested_licensing_basis" "public"."owner_licensing_basis", "requested_licence_or_exemption_basis" "text", "requested_expiry_dates" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."save_owner_application"("requested_applicant_kind" "public"."owner_applicant_kind", "requested_legal_name" "text", "requested_company_name" "text", "requested_licensing_basis" "public"."owner_licensing_basis", "requested_exemption_basis" "text", "requested_cottage_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_description" "text", "requested_house_rules" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  application_status public.owner_application_status;
begin
  if not (select public.is_current_prospective_owner()) then
    raise exception 'Prospective Cottage Owner access is required'
      using errcode = '42501';
  end if;

  select status into application_status
  from public.owner_applications
  where owner_user_id = (select auth.uid())
  for update;

  if found and application_status <> 'draft' then
    raise exception 'Only a Draft Owner Application can be changed'
      using errcode = 'RC202';
  end if;

  return public.save_owner_application_draft_implementation(
    requested_applicant_kind,
    requested_legal_name,
    requested_company_name,
    requested_licensing_basis,
    requested_exemption_basis,
    requested_cottage_name,
    requested_governorate,
    requested_approximate_location,
    requested_exact_address,
    requested_capacity,
    requested_bedrooms,
    requested_bathrooms,
    requested_amenities,
    requested_description,
    requested_house_rules
  );
end;
$$;

ALTER FUNCTION "public"."save_owner_application"("requested_applicant_kind" "public"."owner_applicant_kind", "requested_legal_name" "text", "requested_company_name" "text", "requested_licensing_basis" "public"."owner_licensing_basis", "requested_exemption_basis" "text", "requested_cottage_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_description" "text", "requested_house_rules" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."save_owner_application_draft_implementation"("requested_applicant_kind" "public"."owner_applicant_kind", "requested_legal_name" "text", "requested_company_name" "text", "requested_licensing_basis" "public"."owner_licensing_basis", "requested_exemption_basis" "text", "requested_cottage_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_description" "text", "requested_house_rules" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  application public.owner_applications;
  cleanup_work jsonb := '[]'::jsonb;
  obsolete_document_ids uuid[] := '{}';
begin
  if not (select public.is_current_prospective_owner()) then
    raise exception 'Prospective Cottage Owner access is required'
      using errcode = '42501';
  end if;

  select * into application
  from public.owner_applications
  where owner_user_id = (select auth.uid())
  for update;

  if application.status = 'submitted' then
    raise exception 'A submitted Owner Application cannot be changed'
      using errcode = 'RC202';
  end if;

  if requested_applicant_kind = 'individual'
    and nullif(btrim(coalesce(requested_company_name, '')), '') is not null then
    raise exception 'An individual application cannot include a company name'
      using errcode = '23514';
  end if;

  if char_length(btrim(coalesce(requested_legal_name, ''))) > 120
    or char_length(btrim(coalesce(requested_company_name, ''))) > 120
    or char_length(btrim(coalesce(requested_exemption_basis, ''))) > 1000
    or char_length(btrim(coalesce(requested_cottage_name, ''))) > 120
    or char_length(btrim(coalesce(requested_governorate, ''))) > 120
    or char_length(btrim(coalesce(requested_approximate_location, ''))) > 240
    or char_length(btrim(coalesce(requested_exact_address, ''))) > 240
    or char_length(btrim(coalesce(requested_description, ''))) > 2000
    or char_length(btrim(coalesce(requested_house_rules, ''))) > 1500 then
    raise exception 'An Owner Application field is too long'
      using errcode = '22001';
  end if;

  if not (
    coalesce(requested_amenities, '{}')
    <@ array['garden', 'parking', 'pool', 'air_conditioning', 'wifi', 'outdoor_seating']::text[]
  )
    or cardinality(coalesce(requested_amenities, '{}')) > 6 then
    raise exception 'An Owner Application amenity is invalid'
      using errcode = '23514';
  end if;

  insert into public.owner_applications (
    owner_user_id,
    applicant_kind,
    legal_name,
    company_name,
    licensing_basis,
    exemption_basis
  )
  values (
    (select auth.uid()),
    requested_applicant_kind,
    nullif(btrim(coalesce(requested_legal_name, '')), ''),
    nullif(btrim(coalesce(requested_company_name, '')), ''),
    requested_licensing_basis,
    case when requested_licensing_basis = 'exemption'
      then nullif(btrim(coalesce(requested_exemption_basis, '')), '')
      else null
    end
  )
  on conflict (owner_user_id) do update
  set applicant_kind = excluded.applicant_kind,
      legal_name = excluded.legal_name,
      company_name = excluded.company_name,
      licensing_basis = excluded.licensing_basis,
      exemption_basis = excluded.exemption_basis,
      updated_at = now()
  returning * into application;

  insert into public.owner_application_cottage_profiles (
    application_id,
    name,
    governorate,
    approximate_location,
    exact_address,
    capacity,
    bedrooms,
    bathrooms,
    amenities,
    description,
    house_rules
  )
  values (
    application.id,
    nullif(btrim(coalesce(requested_cottage_name, '')), ''),
    nullif(btrim(coalesce(requested_governorate, '')), ''),
    nullif(btrim(coalesce(requested_approximate_location, '')), ''),
    nullif(btrim(coalesce(requested_exact_address, '')), ''),
    requested_capacity,
    requested_bedrooms,
    requested_bathrooms,
    coalesce(requested_amenities, '{}'),
    nullif(btrim(coalesce(requested_description, '')), ''),
    nullif(btrim(coalesce(requested_house_rules, '')), '')
  )
  on conflict (application_id) do update
  set name = excluded.name,
      governorate = excluded.governorate,
      approximate_location = excluded.approximate_location,
      exact_address = excluded.exact_address,
      capacity = excluded.capacity,
      bedrooms = excluded.bedrooms,
      bathrooms = excluded.bathrooms,
      amenities = excluded.amenities,
      description = excluded.description,
      house_rules = excluded.house_rules,
      updated_at = now();

  select coalesce(array_agg(documents.id), '{}')
  into obsolete_document_ids
  from public.owner_verification_documents as documents
  where documents.application_id = application.id
    and not public.owner_verification_kind_is_required(
      requested_applicant_kind,
      requested_licensing_basis,
      documents.kind
    );

  with queued_cleanup as (
    insert into public.owner_verification_document_cleanup (
      application_id,
      document_id,
      actor_user_id,
      actor_subject_id,
      reason,
      kind,
      object_path,
      original_filename,
      media_type,
      size_bytes
    )
    select
      application.id,
      documents.id,
      (select auth.uid()),
      (select auth.uid()),
      'replaced',
      documents.kind,
      documents.object_path,
      documents.original_filename,
      documents.media_type,
      documents.size_bytes
    from public.owner_verification_documents as documents
    where documents.id = any(obsolete_document_ids)
    returning id, object_path
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'cleanup_id', queued_cleanup.id,
        'object_path', queued_cleanup.object_path
      )
      order by queued_cleanup.object_path
    ),
    '[]'::jsonb
  )
  into cleanup_work
  from queued_cleanup;

  delete from public.owner_verification_documents as documents
  where documents.id = any(obsolete_document_ids);

  return cleanup_work;
end;
$$;

ALTER FUNCTION "public"."save_owner_application_draft_implementation"("requested_applicant_kind" "public"."owner_applicant_kind", "requested_legal_name" "text", "requested_company_name" "text", "requested_licensing_basis" "public"."owner_licensing_basis", "requested_exemption_basis" "text", "requested_cottage_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_description" "text", "requested_house_rules" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."submit_owner_application"() RETURNS "public"."owner_applications"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  application public.owner_applications;
begin
  if not (select public.is_current_prospective_owner()) then
    raise exception 'Prospective Cottage Owner access is required'
      using errcode = '42501';
  end if;

  select * into application
  from public.owner_applications
  where owner_user_id = (select auth.uid())
  for update;

  if application.status = 'submitted' then return application; end if;
  if application.status <> 'draft' then
    raise exception 'A Draft Owner Application is required' using errcode = 'RC202';
  end if;
  if cardinality(public.owner_application_missing_items()) > 0 then
    raise exception 'The Owner Application is incomplete' using errcode = 'RC203';
  end if;

  update public.owner_applications
  set status = 'submitted', submitted_at = now(), review_started_at = now(),
      review_due_at = now() + interval '72 hours',
      review_remaining = interval '72 hours', version = version + 1,
      updated_at = now()
  where id = application.id
  returning * into application;

  insert into public.owner_application_transitions (
    application_id, from_status, to_status, application_version,
    actor_user_id, actor_subject_id
  ) values (
    application.id, 'draft', 'submitted', application.version,
    (select auth.uid()), (select auth.uid())::text
  );
  return application;
end;
$$;

ALTER FUNCTION "public"."submit_owner_application"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."submit_owner_application_renewal"("expected_version" bigint, "confirmed_document_kinds" "public"."owner_verification_document_kind"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  application public.owner_applications;
  renewal public.owner_application_renewal_work;
  current_kinds public.owner_verification_document_kind[];
begin
  select * into application from public.owner_applications
  where owner_user_id = (select auth.uid()) for update;
  if not found or application.status <> 'expired' then
    raise exception 'Open renewal work is required' using errcode = 'RC422';
  end if;
  if application.version <> expected_version then
    raise exception 'Owner Application changed before renewal submission' using errcode = 'RC409';
  end if;
  select * into renewal from public.owner_application_renewal_work
  where application_id = application.id and status = 'open' for update;
  if not found or (
    select array_agg(kind order by kind::text)
    from unnest(coalesce(confirmed_document_kinds, '{}')) kind
  ) <> (
    select array_agg(kind order by kind::text)
    from unnest(renewal.requested_document_kinds) kind
  ) then
    raise exception 'Every renewal evidence kind is required' using errcode = 'RC422';
  end if;
  select array_agg(versions.kind order by versions.kind::text)
  into current_kinds
  from public.owner_verification_document_versions versions
  join public.owner_verification_documents documents on documents.id = versions.document_id
  where versions.application_id = application.id
    and versions.kind = any(renewal.requested_document_kinds)
    and versions.object_path = documents.object_path
    and versions.content_digest = documents.content_digest
    and versions.digest_source = 'sha256'
    and versions.recorded_at >= renewal.created_at;
  if current_kinds <> (
    select array_agg(kind order by kind::text)
    from unnest(renewal.requested_document_kinds) kind
  ) then
    raise exception 'Replacement evidence is required' using errcode = 'RC422';
  end if;

  update public.owner_applications
  set status = 'under_review', review_started_at = now(),
    review_due_at = now() + interval '72 hours',
    review_remaining = interval '72 hours', review_paused_at = null,
    version = version + 1, updated_at = now()
  where id = application.id returning * into application;
  update public.account_contexts
  set owner_approval_state = 'prospective', updated_at = now()
  where user_id = application.owner_user_id;
  update public.owner_application_renewal_work
  set status = 'submitted', submitted_at = now() where id = renewal.id;
  insert into public.owner_application_transitions (
    application_id, from_status, to_status, application_version,
    actor_user_id, actor_subject_id, reason
  ) values (
    application.id, 'expired', 'under_review', application.version,
    (select auth.uid()), (select auth.uid())::text,
    'Replacement evidence submitted'
  );
  insert into public.owner_application_notices (application_id, owner_user_id, kind)
  values (application.id, application.owner_user_id, 'response_received');
  return jsonb_build_object(
    'application_id', application.id, 'status', application.status,
    'version', application.version, 'occurred_at', application.updated_at,
    'review_due_at', application.review_due_at
  );
end;
$$;

ALTER FUNCTION "public"."submit_owner_application_renewal"("expected_version" bigint, "confirmed_document_kinds" "public"."owner_verification_document_kind"[]) OWNER TO "postgres";
