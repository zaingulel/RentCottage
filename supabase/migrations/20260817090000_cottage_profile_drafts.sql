create type public.cottage_profile_status as enum (
  'draft',
  'submitted_for_content_approval'
);

create type public.cottage_profile_source_language as enum ('ar', 'ckb', 'en');

alter table public.owner_applications
  add constraint owner_applications_id_owner_user_id_key
  unique (id, owner_user_id);

alter table public.owner_application_cottage_profiles
  add column id uuid default gen_random_uuid(),
  add column owner_user_id uuid references public.account_contexts (user_id)
    on delete restrict,
  add column exact_latitude numeric(9, 6),
  add column exact_longitude numeric(9, 6),
  add column private_directions text,
  add column source_language public.cottage_profile_source_language,
  add column status public.cottage_profile_status not null default 'draft',
  add column version bigint not null default 1 check (version >= 1);

update public.owner_application_cottage_profiles profiles
set owner_user_id = applications.owner_user_id
from public.owner_applications applications
where applications.id = profiles.application_id;

alter table public.owner_application_cottage_profiles
  drop constraint owner_application_cottage_profiles_pkey,
  drop constraint owner_application_cottage_profiles_application_id_fkey,
  alter column application_id drop not null,
  alter column id set not null,
  alter column owner_user_id set not null,
  add constraint owner_application_cottage_profiles_pkey primary key (id),
  add constraint owner_application_cottage_profiles_application_id_key
    unique (application_id),
  add constraint owner_application_cottage_profiles_application_owner_fkey
    foreign key (application_id, owner_user_id)
    references public.owner_applications (id, owner_user_id) on delete restrict,
  add constraint cottage_profile_private_location_pair check (
    (exact_latitude is null and exact_longitude is null)
    or (
      exact_latitude is not null
      and exact_longitude is not null
      and exact_latitude between -90 and 90
      and exact_longitude between -180 and 180
    )
  ),
  add constraint cottage_profile_private_directions_length check (
    char_length(coalesce(private_directions, '')) <= 1000
  );

create index owner_application_cottage_profiles_owner_user_id_idx
  on public.owner_application_cottage_profiles (owner_user_id, created_at, id);

create function public.assign_owner_application_cottage_profile_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_user_id is null and new.application_id is not null then
    select owner_user_id into new.owner_user_id
    from public.owner_applications
    where id = new.application_id;
  end if;
  return new;
end;
$$;

revoke all on function public.assign_owner_application_cottage_profile_owner()
  from public;

create trigger assign_owner_application_cottage_profile_owner
before insert on public.owner_application_cottage_profiles
for each row execute function public.assign_owner_application_cottage_profile_owner();

drop policy "Applicant or MFA administrator reads private Cottage Profiles"
  on public.owner_application_cottage_profiles;

create policy "Owner or MFA administrator reads private Cottage Profiles"
on public.owner_application_cottage_profiles
for select
to authenticated
using (
  owner_user_id = (select auth.uid())
  or (select public.is_platform_administrator('aal2'))
);

create function public.list_owner_cottage_profiles()
returns setof public.owner_application_cottage_profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
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
  where profiles.owner_user_id = (select auth.uid());
end;
$$;

revoke all on function public.list_owner_cottage_profiles() from public;
grant execute on function public.list_owner_cottage_profiles() to authenticated;

create function public.create_owner_cottage_profile_draft()
returns public.owner_application_cottage_profiles
language plpgsql
security definer
set search_path = ''
as $$
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

  insert into public.owner_application_cottage_profiles (owner_user_id)
  values ((select auth.uid()))
  returning * into profile;

  return profile;
end;
$$;

revoke all on function public.create_owner_cottage_profile_draft() from public;
grant execute on function public.create_owner_cottage_profile_draft()
  to authenticated;

create function public.apply_cottage_profile_working_copy(
  target_profile_id uuid,
  requested_name text,
  requested_governorate text,
  requested_approximate_location text,
  requested_exact_address text,
  requested_exact_latitude numeric,
  requested_exact_longitude numeric,
  requested_private_directions text,
  requested_capacity integer,
  requested_bedrooms integer,
  requested_bathrooms integer,
  requested_amenities text[],
  requested_source_language public.cottage_profile_source_language,
  requested_description text,
  requested_house_rules text
)
returns public.owner_application_cottage_profiles
language sql
security definer
set search_path = ''
as $$
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

revoke all on function public.apply_cottage_profile_working_copy(
  uuid, text, text, text, text, numeric, numeric, text,
  integer, integer, integer, text[], public.cottage_profile_source_language,
  text, text
) from public, authenticated, anon;

create function public.update_owner_cottage_profile_draft(
  target_profile_id uuid,
  target_expected_version bigint,
  requested_name text,
  requested_governorate text,
  requested_approximate_location text,
  requested_exact_address text,
  requested_exact_latitude numeric,
  requested_exact_longitude numeric,
  requested_private_directions text,
  requested_capacity integer,
  requested_bedrooms integer,
  requested_bathrooms integer,
  requested_amenities text[],
  requested_source_language public.cottage_profile_source_language,
  requested_description text,
  requested_house_rules text
)
returns public.owner_application_cottage_profiles
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.update_owner_cottage_profile_draft(
  uuid, bigint, text, text, text, text, numeric, numeric, text,
  integer, integer, integer, text[], public.cottage_profile_source_language,
  text, text
) from public;
grant execute on function public.update_owner_cottage_profile_draft(
  uuid, bigint, text, text, text, text, numeric, numeric, text,
  integer, integer, integer, text[], public.cottage_profile_source_language,
  text, text
) to authenticated;

create type public.cottage_profile_photo_state as enum (
  'pending',
  'ready',
  'deletion_pending'
);

alter table public.owner_application_cottage_profiles
  add constraint cottage_profiles_id_owner_user_id_key
  unique (id, owner_user_id);

create table public.cottage_profile_photos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  owner_user_id uuid not null,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  object_path text not null unique,
  original_filename text not null,
  media_type text not null check (
    media_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  state public.cottage_profile_photo_state not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cottage_profile_photo_profile_owner_fkey
    foreign key (profile_id, owner_user_id)
    references public.owner_application_cottage_profiles (id, owner_user_id)
    on delete restrict,
  constraint cottage_profile_photo_filename_length check (
    char_length(btrim(original_filename)) between 1 and 180
  )
);

create index cottage_profile_photos_profile_id_idx
  on public.cottage_profile_photos (profile_id, created_at, id);

alter table public.cottage_profile_photos enable row level security;

create policy "Owner or MFA administrator reads private Cottage Profile photos"
on public.cottage_profile_photos
for select
to authenticated
using (
  owner_user_id = (select auth.uid())
  or (select public.is_platform_administrator('aal2'))
);

grant select on public.cottage_profile_photos to authenticated, service_role;

create function public.cottage_profile_photo_bucket_name()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'cottage-profile-photos'::text;
$$;

revoke all on function public.cottage_profile_photo_bucket_name() from public;
grant execute on function public.cottage_profile_photo_bucket_name()
  to authenticated, service_role;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  public.cottage_profile_photo_bucket_name(),
  public.cottage_profile_photo_bucket_name(),
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create function public.prepare_cottage_profile_photo_upload(
  target_profile_id uuid,
  requested_original_filename text,
  requested_media_type text,
  requested_size_bytes integer
)
returns public.cottage_profile_photos
language plpgsql
security definer
set search_path = ''
as $$
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
    where profile_id = profile.id
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

revoke all on function public.prepare_cottage_profile_photo_upload(
  uuid, text, text, integer
) from public;
grant execute on function public.prepare_cottage_profile_photo_upload(
  uuid, text, text, integer
) to authenticated;

create function public.register_cottage_profile_photo(target_photo_id uuid)
returns public.cottage_profile_photos
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.register_cottage_profile_photo(uuid) from public;
grant execute on function public.register_cottage_profile_photo(uuid)
  to service_role;

create function public.cottage_profile_required_data_is_complete(
  target_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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

revoke all on function public.cottage_profile_required_data_is_complete(uuid)
  from public, authenticated, anon;

create function public.cottage_profile_ready_photo_count(target_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.cottage_profile_photos photos
  where photos.profile_id = target_profile_id
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
$$;

revoke all on function public.cottage_profile_ready_photo_count(uuid)
  from public, authenticated, anon;

create table public.cottage_profile_source_revisions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null
    references public.owner_application_cottage_profiles (id) on delete restrict,
  owner_user_id uuid not null references public.account_contexts (user_id)
    on delete restrict,
  source_language public.cottage_profile_source_language not null,
  description text not null,
  house_rules text not null,
  revision integer not null check (revision >= 1),
  submitted_at timestamptz not null default now(),
  unique (profile_id, revision),
  constraint cottage_profile_source_text_lengths check (
    char_length(description) between 1 and 2000
    and char_length(house_rules) between 1 and 1500
  )
);

alter table public.cottage_profile_source_revisions enable row level security;

create policy "Owner or MFA administrator reads Cottage Profile source"
on public.cottage_profile_source_revisions
for select
to authenticated
using (
  owner_user_id = (select auth.uid())
  or (select public.is_platform_administrator('aal2'))
);

grant select on public.cottage_profile_source_revisions to authenticated;

alter table public.owner_application_cottage_profiles
  add column submitted_source_revision_id uuid
    references public.cottage_profile_source_revisions (id) on delete restrict,
  add constraint cottage_profile_submission_source_matches_status check (
    (status = 'draft' and submitted_source_revision_id is null)
    or (
      status = 'submitted_for_content_approval'
      and submitted_source_revision_id is not null
    )
  );

create function public.reject_cottage_profile_source_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Submitted Cottage Profile source is immutable'
    using errcode = 'RC208';
end;
$$;

revoke all on function public.reject_cottage_profile_source_mutation()
  from public;

create trigger reject_cottage_profile_source_update
before update on public.cottage_profile_source_revisions
for each row execute function public.reject_cottage_profile_source_mutation();

create trigger reject_cottage_profile_source_delete
before delete on public.cottage_profile_source_revisions
for each row execute function public.reject_cottage_profile_source_mutation();

create function public.submit_cottage_profile_for_content_approval(
  target_profile_id uuid,
  target_expected_version bigint
)
returns public.owner_application_cottage_profiles
language plpgsql
security definer
set search_path = ''
as $$
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
  where photos.profile_id = profile.id;
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

revoke all on function public.submit_cottage_profile_for_content_approval(
  uuid, bigint
) from public;
grant execute on function public.submit_cottage_profile_for_content_approval(
  uuid, bigint
) to authenticated;

create table public.cottage_profile_administrator_audit (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null
    references public.owner_application_cottage_profiles (id) on delete restrict,
  administrator_user_id uuid not null references auth.users (id) on delete restrict,
  previous_version bigint not null check (previous_version >= 1),
  resulting_version bigint not null check (resulting_version >= previous_version),
  changed_fields text[] not null,
  event_kind text not null default 'working_copy_updated' check (
    event_kind in (
      'working_copy_updated', 'photo_upload_prepared',
      'photo_deletion_prepared'
    )
  ),
  object_path text,
  occurred_at timestamptz not null default now(),
  constraint cottage_profile_administrator_audit_event_shape check (
    (
      event_kind = 'working_copy_updated'
      and resulting_version > previous_version
      and object_path is null
    ) or (
      event_kind in ('photo_upload_prepared', 'photo_deletion_prepared')
      and resulting_version = previous_version
      and changed_fields = array['photos']::text[]
      and object_path is not null
    )
  )
);

create index cottage_profile_administrator_audit_profile_id_idx
  on public.cottage_profile_administrator_audit (profile_id, occurred_at desc);

alter table public.cottage_profile_administrator_audit enable row level security;

create policy "MFA administrator reads Cottage Profile edit audit"
on public.cottage_profile_administrator_audit
for select
to authenticated
using ((select public.is_platform_administrator('aal2')));

grant select on public.cottage_profile_administrator_audit to authenticated;

create function public.update_administrator_cottage_profile(
  target_profile_id uuid,
  target_expected_version bigint,
  requested_name text,
  requested_governorate text,
  requested_approximate_location text,
  requested_exact_address text,
  requested_exact_latitude numeric,
  requested_exact_longitude numeric,
  requested_private_directions text,
  requested_capacity integer,
  requested_bedrooms integer,
  requested_bathrooms integer,
  requested_amenities text[],
  requested_source_language public.cottage_profile_source_language,
  requested_description text,
  requested_house_rules text
)
returns public.owner_application_cottage_profiles
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.update_administrator_cottage_profile(
  uuid, bigint, text, text, text, text, numeric, numeric, text,
  integer, integer, integer, text[], public.cottage_profile_source_language,
  text, text
) from public;
grant execute on function public.update_administrator_cottage_profile(
  uuid, bigint, text, text, text, text, numeric, numeric, text,
  integer, integer, integer, text[], public.cottage_profile_source_language,
  text, text
) to authenticated;

create function public.prepare_cottage_profile_photo_preview(
  target_photo_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
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

revoke all on function public.prepare_cottage_profile_photo_preview(uuid)
  from public;
grant execute on function public.prepare_cottage_profile_photo_preview(uuid)
  to authenticated;

create function public.prepare_cottage_profile_photo_deletion(
  target_photo_id uuid
)
returns public.cottage_profile_photos
language plpgsql
security definer
set search_path = ''
as $$
declare
  photo public.cottage_profile_photos;
  profile public.owner_application_cottage_profiles;
  actor_is_administrator boolean := (
    select public.is_platform_administrator('aal2')
  );
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
  if photo.state = 'deletion_pending' then return photo; end if;
  if profile.status = 'submitted_for_content_approval'
    and photo.state = 'ready'
    and public.cottage_profile_ready_photo_count(profile.id) <= 1 then
    raise exception 'The submitted Cottage Profile must retain a ready photo'
      using errcode = 'RC203';
  end if;

  update public.cottage_profile_photos
  set state = 'deletion_pending',
      actor_user_id = (select auth.uid()),
      updated_at = now()
  where id = photo.id
  returning * into photo;

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

revoke all on function public.prepare_cottage_profile_photo_deletion(uuid)
  from public;
grant execute on function public.prepare_cottage_profile_photo_deletion(uuid)
  to authenticated;

create function public.complete_cottage_profile_photo_deletion(
  target_photo_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.complete_cottage_profile_photo_deletion(uuid)
  from public;
grant execute on function public.complete_cottage_profile_photo_deletion(uuid)
  to service_role;
