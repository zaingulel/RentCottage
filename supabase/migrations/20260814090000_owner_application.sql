create type public.owner_application_status as enum ('draft', 'submitted');
create type public.owner_applicant_kind as enum ('individual', 'company');
create type public.owner_licensing_basis as enum ('licence', 'exemption');
create type public.owner_verification_document_kind as enum (
  'identity',
  'company_registration',
  'authorised_representative',
  'authority_to_rent',
  'licensing_or_exemption',
  'payout_account'
);
create type public.owner_verification_document_action as enum (
  'uploaded',
  'replaced',
  'access_granted',
  'deleted'
);
create type public.owner_verification_cleanup_reason as enum (
  'unregistered_upload',
  'replaced'
);
create type public.owner_verification_cleanup_status as enum (
  'pending',
  'completed'
);
create type public.owner_verification_access_grant_status as enum (
  'pending',
  'completed',
  'expired'
);

create function public.owner_verification_kind_is_required(
  applicant_kind public.owner_applicant_kind,
  licensing_basis public.owner_licensing_basis,
  document_kind public.owner_verification_document_kind
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case document_kind
    when 'identity' then applicant_kind = 'individual'
    when 'company_registration' then applicant_kind = 'company'
    when 'authorised_representative' then applicant_kind = 'company'
    when 'licensing_or_exemption' then licensing_basis = 'licence'
    else true
  end;
$$;

revoke all on function public.owner_verification_kind_is_required(
  public.owner_applicant_kind,
  public.owner_licensing_basis,
  public.owner_verification_document_kind
) from public;

create table public.owner_applications (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique
    references public.account_contexts (user_id) on delete restrict,
  applicant_kind public.owner_applicant_kind not null,
  legal_name text,
  company_name text,
  licensing_basis public.owner_licensing_basis not null default 'licence',
  exemption_basis text,
  status public.owner_application_status not null default 'draft',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_application_submission_time_matches_status check (
    (status = 'draft' and submitted_at is null)
    or (status = 'submitted' and submitted_at is not null)
  ),
  constraint owner_application_text_lengths check (
    char_length(coalesce(legal_name, '')) <= 120
    and char_length(coalesce(company_name, '')) <= 120
    and char_length(coalesce(exemption_basis, '')) <= 1000
  ),
  constraint owner_application_exemption_basis_matches_choice check (
    (licensing_basis = 'licence' and exemption_basis is null)
    or licensing_basis = 'exemption'
  )
);

create table public.owner_application_cottage_profiles (
  application_id uuid primary key references public.owner_applications (id) on delete cascade,
  name text,
  governorate text,
  approximate_location text,
  exact_address text,
  capacity smallint check (capacity is null or capacity between 1 and 100),
  bedrooms smallint check (bedrooms is null or bedrooms between 1 and 50),
  bathrooms smallint check (bathrooms is null or bathrooms between 1 and 50),
  amenities text[] not null default '{}',
  description text,
  house_rules text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_application_cottage_text_lengths check (
    char_length(coalesce(name, '')) <= 120
    and char_length(coalesce(governorate, '')) <= 120
    and char_length(coalesce(approximate_location, '')) <= 240
    and char_length(coalesce(exact_address, '')) <= 240
    and char_length(coalesce(description, '')) <= 2000
    and char_length(coalesce(house_rules, '')) <= 1500
  ),
  constraint owner_application_amenities_are_known check (
    amenities <@ array[
      'garden', 'parking', 'pool', 'air_conditioning', 'wifi', 'outdoor_seating'
    ]::text[]
    and cardinality(amenities) <= 6
  )
);

create table public.owner_verification_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.owner_applications (id) on delete restrict,
  kind public.owner_verification_document_kind not null,
  object_path text not null unique,
  original_filename text not null,
  media_type text not null check (
    media_type in ('application/pdf', 'image/jpeg', 'image/png')
  ),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, kind)
);

create index owner_verification_documents_application_id_idx
  on public.owner_verification_documents (application_id);

create table public.owner_verification_document_cleanup (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.owner_applications (id)
    on delete set null deferrable initially deferred,
  document_id uuid references public.owner_verification_documents (id)
    on delete set null deferrable initially deferred,
  replacement_cleanup_id uuid references public.owner_verification_document_cleanup (id)
    on delete set null deferrable initially deferred,
  actor_user_id uuid references auth.users (id)
    on delete set null deferrable initially deferred,
  actor_subject_id uuid not null,
  reason public.owner_verification_cleanup_reason not null,
  status public.owner_verification_cleanup_status not null default 'pending',
  kind public.owner_verification_document_kind not null,
  object_path text not null,
  original_filename text not null,
  media_type text not null check (
    media_type in ('application/pdf', 'image/jpeg', 'image/png')
  ),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint owner_verification_cleanup_completion_matches_status check (
    (status = 'pending' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  )
);

create index owner_verification_document_cleanup_pending_idx
  on public.owner_verification_document_cleanup (status, requested_at);

create index owner_verification_document_cleanup_document_id_idx
  on public.owner_verification_document_cleanup (document_id);

create index owner_verification_document_cleanup_application_id_idx
  on public.owner_verification_document_cleanup (application_id);

create table public.owner_verification_document_access_grants (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.owner_verification_documents (id)
    on delete set null deferrable initially deferred,
  document_subject_id uuid not null,
  actor_user_id uuid references auth.users (id)
    on delete set null deferrable initially deferred,
  actor_subject_id uuid not null,
  object_path text not null,
  status public.owner_verification_access_grant_status not null default 'pending',
  prepared_at timestamptz not null default now(),
  complete_before timestamptz not null default now() + interval '2 minutes',
  completed_at timestamptz,
  constraint owner_verification_access_grant_completion_matches_status check (
    (status = 'pending' and completed_at is null)
    or (status in ('completed', 'expired') and completed_at is not null)
  )
);

create index owner_verification_document_access_grants_pending_idx
  on public.owner_verification_document_access_grants (status, complete_before);

create index owner_verification_document_access_grants_document_id_idx
  on public.owner_verification_document_access_grants (document_id);

create table public.owner_verification_document_audit (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.owner_verification_documents (id)
    on delete set null deferrable initially deferred,
  access_grant_id uuid unique
    references public.owner_verification_document_access_grants (id)
    on delete restrict,
  actor_user_id uuid references auth.users (id)
    on delete set null deferrable initially deferred,
  actor_subject_id uuid not null,
  action public.owner_verification_document_action not null,
  object_path text not null,
  access_expires_at timestamptz,
  occurred_at timestamptz not null default now(),
  constraint owner_document_access_expiry_matches_action check (
    (
      action = 'access_granted'
      and access_grant_id is not null
      and access_expires_at is not null
    )
    or (
      action <> 'access_granted'
      and access_grant_id is null
      and access_expires_at is null
    )
  )
);

create index owner_verification_document_audit_document_id_idx
  on public.owner_verification_document_audit (document_id, occurred_at desc);

alter table public.owner_applications enable row level security;
alter table public.owner_application_cottage_profiles enable row level security;
alter table public.owner_verification_documents enable row level security;
alter table public.owner_verification_document_cleanup enable row level security;
alter table public.owner_verification_document_access_grants enable row level security;
alter table public.owner_verification_document_audit enable row level security;

grant select on public.owner_verification_document_cleanup to service_role;
grant select on public.owner_verification_document_access_grants to service_role;

create function public.owner_verification_bucket_name()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'owner-verification'::text;
$$;

revoke all on function public.owner_verification_bucket_name() from public;
grant execute on function public.owner_verification_bucket_name() to authenticated;

create function public.is_current_prospective_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'prospective'
  );
$$;

revoke all on function public.is_current_prospective_owner() from public;
grant execute on function public.is_current_prospective_owner() to authenticated;

create policy "Applicant or MFA administrator reads Owner Applications"
on public.owner_applications
for select
to authenticated
using (
  owner_user_id = (select auth.uid())
  or (
    status = 'submitted'
    and (select public.is_platform_administrator('aal2'))
  )
);

create policy "Applicant or MFA administrator reads private Cottage Profiles"
on public.owner_application_cottage_profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.owner_applications
    where id = application_id
      and owner_user_id = (select auth.uid())
  )
  or (
    (select public.is_platform_administrator('aal2'))
    and exists (
      select 1
      from public.owner_applications
      where id = application_id
    )
  )
);

create policy "Applicant or MFA administrator reads verification metadata"
on public.owner_verification_documents
for select
to authenticated
using (
  exists (
    select 1
    from public.owner_applications
    where id = application_id
      and owner_user_id = (select auth.uid())
  )
  or (
    (select public.is_platform_administrator('aal2'))
    and exists (
      select 1
      from public.owner_applications
      where id = application_id
    )
  )
);

create policy "MFA administrator reads verification audit"
on public.owner_verification_document_audit
for select
to authenticated
using ((select public.is_platform_administrator('aal2')));

grant select on public.owner_applications to authenticated;
grant select on public.owner_application_cottage_profiles to authenticated;
grant select on public.owner_verification_documents to authenticated;
grant select on public.owner_verification_document_audit to authenticated;
grant select on public.owner_verification_document_audit to service_role;

create function public.save_owner_application(
  requested_applicant_kind public.owner_applicant_kind,
  requested_legal_name text,
  requested_company_name text,
  requested_licensing_basis public.owner_licensing_basis,
  requested_exemption_basis text,
  requested_cottage_name text,
  requested_governorate text,
  requested_approximate_location text,
  requested_exact_address text,
  requested_capacity integer,
  requested_bedrooms integer,
  requested_bathrooms integer,
  requested_amenities text[],
  requested_description text,
  requested_house_rules text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.save_owner_application(
  public.owner_applicant_kind,
  text,
  text,
  public.owner_licensing_basis,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer,
  integer,
  text[],
  text,
  text
) from public;
grant execute on function public.save_owner_application(
  public.owner_applicant_kind,
  text,
  text,
  public.owner_licensing_basis,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer,
  integer,
  text[],
  text,
  text
) to authenticated;

create function public.owner_application_missing_items()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
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

revoke all on function public.owner_application_missing_items() from public;
grant execute on function public.owner_application_missing_items() to authenticated;

create function public.submit_owner_application()
returns public.owner_applications
language plpgsql
security definer
set search_path = ''
as $$
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

  if application.status = 'submitted' then
    return application;
  end if;

  if cardinality(public.owner_application_missing_items()) > 0 then
    raise exception 'The Owner Application is incomplete'
      using errcode = 'RC203';
  end if;

  update public.owner_applications
  set status = 'submitted',
      submitted_at = now(),
      updated_at = now()
  where id = application.id
  returning * into application;

  return application;
end;
$$;

revoke all on function public.submit_owner_application() from public;
grant execute on function public.submit_owner_application() to authenticated;

create function public.prepare_owner_verification_document_upload(
  requested_owner_user_id uuid,
  requested_application_id uuid,
  requested_kind public.owner_verification_document_kind,
  requested_object_path text,
  requested_original_filename text,
  requested_media_type text,
  requested_size_bytes integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.prepare_owner_verification_document_upload(
  uuid,
  uuid,
  public.owner_verification_document_kind,
  text,
  text,
  text,
  integer
) from public;
grant execute on function public.prepare_owner_verification_document_upload(
  uuid,
  uuid,
  public.owner_verification_document_kind,
  text,
  text,
  text,
  integer
) to service_role;

create function public.register_owner_verification_document(target_cleanup_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.register_owner_verification_document(uuid) from public;
grant execute on function public.register_owner_verification_document(uuid)
  to service_role;

create function public.reconcile_owner_verification_document_registration(
  target_cleanup_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.reconcile_owner_verification_document_registration(uuid)
  from public;
grant execute on function public.reconcile_owner_verification_document_registration(uuid)
  to service_role;

create function public.prepare_owner_verification_document_access(target_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.prepare_owner_verification_document_access(uuid) from public;
grant execute on function public.prepare_owner_verification_document_access(uuid) to authenticated;

create function public.complete_owner_verification_document_access(
  target_access_grant_id uuid,
  requested_expires_in_seconds integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.complete_owner_verification_document_access(uuid, integer)
  from public;
grant execute on function public.complete_owner_verification_document_access(uuid, integer)
  to service_role;

create function public.complete_owner_verification_document_cleanup(
  target_cleanup_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.complete_owner_verification_document_cleanup(uuid)
  from public;
grant execute on function public.complete_owner_verification_document_cleanup(uuid)
  to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  public.owner_verification_bucket_name(),
  public.owner_verification_bucket_name(),
  false,
  5242880,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
