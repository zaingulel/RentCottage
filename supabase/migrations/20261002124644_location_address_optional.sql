-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.cottage_profile_required_data_is_complete (
  target_profile_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.owner_application_cottage_profiles profiles
    where profiles.id = target_profile_id
      and profiles.name is not null
      and profiles.governorate is not null
      and profiles.approximate_location is not null
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
$function$;

CREATE OR REPLACE FUNCTION public.owner_application_missing_items()
  RETURNS text[]
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;