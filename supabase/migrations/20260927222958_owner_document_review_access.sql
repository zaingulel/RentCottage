-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.prepare_owner_verification_document_access (
  target_document_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
    and owner_applications.status in ('submitted', 'under_review');

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
$function$;