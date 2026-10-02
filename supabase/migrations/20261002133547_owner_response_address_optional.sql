-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.respond_to_owner_application_request (
  expected_version         bigint,
  requested_field_values   jsonb,
  confirmed_document_kinds public.owner_verification_document_kind[]
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
        or char_length(btrim(supplied.value #>> '{}'))
          not between case supplied.key when 'exact_address' then 0 else 1 end
          and case supplied.key
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
$function$;