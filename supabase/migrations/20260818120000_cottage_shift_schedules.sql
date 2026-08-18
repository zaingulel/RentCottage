-- Additive recurring Cottage Shift Schedule history. Pricing and dated
-- availability intentionally remain outside this schema.

create table public.cottage_shift_schedule_revisions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null
    references public.owner_application_cottage_profiles (id) on delete restrict,
  revision integer not null check (revision >= 1),
  full_day_bundle_id uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  unique (profile_id, revision),
  unique (id, profile_id)
);

create table public.cottage_shifts (
  id uuid primary key default gen_random_uuid(),
  schedule_revision_id uuid not null
    references public.cottage_shift_schedule_revisions (id) on delete restrict,
  position smallint not null check (position between 1 and 3),
  name text not null check (char_length(btrim(name)) >= 1),
  start_time time without time zone not null,
  end_time time without time zone not null,
  created_at timestamptz not null default now(),
  unique (schedule_revision_id, position),
  check (start_time <> end_time)
);

alter table public.owner_application_cottage_profiles
  add column current_shift_schedule_id uuid,
  add constraint cottage_profile_current_shift_schedule_fkey
    foreign key (current_shift_schedule_id, id)
    references public.cottage_shift_schedule_revisions (id, profile_id)
    on delete restrict;

create function public.reject_cottage_shift_schedule_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Cottage Shift Schedule history is immutable'
    using errcode = 'RC208';
end;
$$;

revoke all on function public.reject_cottage_shift_schedule_mutation()
  from public;

create trigger reject_cottage_shift_schedule_revision_update
before update on public.cottage_shift_schedule_revisions
for each row execute function public.reject_cottage_shift_schedule_mutation();

create trigger reject_cottage_shift_schedule_revision_delete
before delete on public.cottage_shift_schedule_revisions
for each row execute function public.reject_cottage_shift_schedule_mutation();

create trigger reject_cottage_shift_update
before update on public.cottage_shifts
for each row execute function public.reject_cottage_shift_schedule_mutation();

create trigger reject_cottage_shift_delete
before delete on public.cottage_shifts
for each row execute function public.reject_cottage_shift_schedule_mutation();

create function public.validate_cottage_shift_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.validate_cottage_shift_insert() from public;

create trigger validate_cottage_shift_insert
before insert on public.cottage_shifts
for each row execute function public.validate_cottage_shift_insert();

create function public.require_complete_cottage_shift_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.require_complete_cottage_shift_schedule()
  from public;

create constraint trigger require_complete_cottage_shift_schedule
after insert on public.cottage_shift_schedule_revisions
deferrable initially deferred
for each row execute function public.require_complete_cottage_shift_schedule();

alter table public.cottage_shift_schedule_revisions enable row level security;
alter table public.cottage_shifts enable row level security;

create policy "Owner or MFA administrator reads Shift Schedule revisions"
on public.cottage_shift_schedule_revisions
for select
to authenticated
using (
  exists (
    select 1
    from public.owner_application_cottage_profiles profiles
    where profiles.id = profile_id
      and (
        profiles.owner_user_id = (select auth.uid())
        or (select public.is_platform_administrator('aal2'))
      )
  )
);

create policy "Owner or MFA administrator reads Cottage Shifts"
on public.cottage_shifts
for select
to authenticated
using (
  exists (
    select 1
    from public.cottage_shift_schedule_revisions revisions
    join public.owner_application_cottage_profiles profiles
      on profiles.id = revisions.profile_id
    where revisions.id = schedule_revision_id
      and (
        profiles.owner_user_id = (select auth.uid())
        or (select public.is_platform_administrator('aal2'))
      )
  )
);

revoke all on public.cottage_shift_schedule_revisions, public.cottage_shifts
  from anon, authenticated;
grant select on public.cottage_shift_schedule_revisions, public.cottage_shifts
  to authenticated;

create function public.replace_cottage_shift_schedule(
  target_profile_id uuid,
  target_expected_revision integer,
  requested_shifts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.replace_cottage_shift_schedule(uuid, integer, jsonb)
  from public;
grant execute on function public.replace_cottage_shift_schedule(uuid, integer, jsonb)
  to authenticated;

create function public.require_current_shift_schedule_for_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.require_current_shift_schedule_for_publication()
  from public;

create trigger require_current_shift_schedule_for_publication
before update of current_publication_id
on public.owner_application_cottage_profiles
for each row execute function public.require_current_shift_schedule_for_publication();
