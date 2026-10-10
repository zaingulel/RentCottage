BEGIN;

LOCK TABLE public.owner_application_cottage_profiles IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.cottage_shift_schedule_revisions IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.cottage_shifts IN ACCESS EXCLUSIVE MODE;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT revisions.id
    FROM public.cottage_shift_schedule_revisions revisions
    LEFT JOIN public.cottage_shifts shifts
      ON shifts.schedule_revision_id = revisions.id
    GROUP BY revisions.id
    HAVING count(shifts.id) = 3
  ) THEN
    RAISE EXCEPTION 'Migration blocked: a current or historical three-shift revision exists; no rows rewritten; owner decision required'
      USING ERRCODE = 'RC205';
  END IF;
  IF EXISTS (
    SELECT revisions.id
    FROM public.cottage_shift_schedule_revisions revisions
    LEFT JOIN public.cottage_shifts shifts
      ON shifts.schedule_revision_id = revisions.id
    GROUP BY revisions.id
    HAVING count(shifts.id) NOT BETWEEN 2 AND 3
  ) THEN
    RAISE EXCEPTION 'Migration blocked: an invalid Shift Schedule revision count exists; no rows rewritten; owner decision required'
      USING ERRCODE = 'RC205';
  END IF;
END;
$guard$;

-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.replace_cottage_shift_schedule (
  target_profile_id        uuid,
  target_expected_revision integer,
  requested_shifts         jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
  if jsonb_typeof(requested_shifts) is distinct from 'array' then
    raise exception 'A Shift Schedule requires exactly two Cottage Shifts'
      using errcode = 'RC205';
  end if;
  if jsonb_array_length(requested_shifts) <> 2 then
    raise exception 'A Shift Schedule requires exactly two Cottage Shifts'
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
    if jsonb_typeof(requested_shift) is distinct from 'object'
      or jsonb_typeof(requested_shift -> 'name') is distinct from 'string'
      or jsonb_typeof(requested_shift -> 'startTime') is distinct from 'string'
      or jsonb_typeof(requested_shift -> 'endTime') is distinct from 'string' then
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

  if requested_starts[1] >= requested_starts[2] then
    raise exception 'Morning must start before Evening' using errcode = 'RC205';
  end if;

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
  select saved_revision.id, requested.position::smallint,
    requested.name, requested.start_time, requested.end_time
  from unnest(requested_names, requested_starts, requested_ends) with ordinality
    as requested(name, start_time, end_time, position)
  order by requested.position;

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
$function$;

COMMIT;
