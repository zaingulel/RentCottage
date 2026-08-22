alter table public.owner_application_cottage_profiles
  add column abandoned_at timestamptz,
  drop constraint cottage_profile_submission_source_matches_status,
  add constraint cottage_profile_submission_source_matches_status check (
    (status in ('draft', 'abandoned') and submitted_source_revision_id is null)
    or (
      status = 'submitted_for_content_approval'
      and submitted_source_revision_id is not null
    )
  ),
  add constraint cottage_profile_abandonment_shape check (
    (
      status = 'abandoned'
      and abandoned_at is not null
      and application_id is null
      and current_publication_id is null
      and submitted_source_revision_id is null
    ) or (
      status <> 'abandoned'
      and abandoned_at is null
    )
  );

create index cottage_profile_open_capacity_idx
  on public.owner_application_cottage_profiles (owner_user_id, status)
  where current_publication_id is null and status <> 'abandoned';

create index cottage_profile_additional_creation_rate_idx
  on public.owner_application_cottage_profiles (owner_user_id, created_at)
  where application_id is null;

alter table public.cottage_profile_administrator_audit
  drop constraint cottage_profile_administrator_audit_event_kind_check,
  drop constraint cottage_profile_administrator_audit_event_shape,
  add column lifecycle_reason text,
  add column previous_status public.cottage_profile_status,
  add column resulting_status public.cottage_profile_status,
  add constraint cottage_profile_administrator_audit_event_kind_check check (
    event_kind in (
      'working_copy_updated', 'photo_upload_prepared',
      'photo_deletion_prepared', 'photo_deletion_recovered',
      'draft_abandoned', 'draft_restored'
    )
  ),
  add constraint cottage_profile_administrator_audit_event_shape check (
    (
      event_kind = 'working_copy_updated'
      and resulting_version > previous_version
      and object_path is null
      and lifecycle_reason is null
      and previous_status is null
      and resulting_status is null
    ) or (
      event_kind in (
        'photo_upload_prepared', 'photo_deletion_prepared',
        'photo_deletion_recovered'
      )
      and resulting_version = previous_version
      and changed_fields = array['photos']::text[]
      and object_path is not null
      and lifecycle_reason is null
      and previous_status is null
      and resulting_status is null
    ) or (
      event_kind = 'draft_abandoned'
      and resulting_version = previous_version + 1
      and changed_fields = array['status']::text[]
      and object_path is null
      and lifecycle_reason is not null
      and lifecycle_reason = regexp_replace(
        lifecycle_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'
      )
      and char_length(btrim(lifecycle_reason)) between 1 and 1000
      and previous_status is not null
      and resulting_status is not null
      and previous_status = 'draft'
      and resulting_status = 'abandoned'
    ) or (
      event_kind = 'draft_restored'
      and resulting_version = previous_version + 1
      and changed_fields = array['status']::text[]
      and object_path is null
      and lifecycle_reason is not null
      and lifecycle_reason = regexp_replace(
        lifecycle_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'
      )
      and char_length(btrim(lifecycle_reason)) between 1 and 1000
      and previous_status is not null
      and resulting_status is not null
      and previous_status = 'abandoned'
      and resulting_status = 'draft'
    )
  );

create function public.protect_abandoned_cottage_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.protect_abandoned_cottage_profile() from public;

create trigger protect_abandoned_cottage_profile
before update on public.owner_application_cottage_profiles
for each row execute function public.protect_abandoned_cottage_profile();

create function public.reject_abandoned_cottage_profile_child_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.reject_abandoned_cottage_profile_child_mutation()
  from public;

create trigger reject_abandoned_cottage_profile_photo_mutation
before insert or update or delete on public.cottage_profile_photos
for each row execute function public.reject_abandoned_cottage_profile_child_mutation();

create trigger reject_abandoned_cottage_shift_schedule_mutation
before insert on public.cottage_shift_schedule_revisions
for each row execute function public.reject_abandoned_cottage_profile_child_mutation();

create trigger reject_abandoned_cottage_standard_price_mutation
before insert or update or delete on public.cottage_inventory_standard_prices
for each row execute function public.reject_abandoned_cottage_profile_child_mutation();

create trigger reject_abandoned_cottage_weekday_price_mutation
before insert or update or delete on public.cottage_inventory_weekday_price_overrides
for each row execute function public.reject_abandoned_cottage_profile_child_mutation();

create trigger reject_abandoned_cottage_date_price_mutation
before insert or update or delete on public.cottage_inventory_date_price_overrides
for each row execute function public.reject_abandoned_cottage_profile_child_mutation();

create trigger reject_abandoned_cottage_availability_mutation
before insert or update or delete on public.cottage_inventory_availability
for each row execute function public.reject_abandoned_cottage_profile_child_mutation();

create or replace function public.create_owner_cottage_profile_draft()
returns public.owner_application_cottage_profiles
language plpgsql
security definer
set search_path = ''
as $$
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

create function public.abandon_owner_cottage_profile_draft(
  target_profile_id uuid,
  target_expected_version bigint
)
returns public.owner_application_cottage_profiles
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.abandon_owner_cottage_profile_draft(uuid, bigint)
  from public;
grant execute on function public.abandon_owner_cottage_profile_draft(uuid, bigint)
  to authenticated;

create function public.change_administrator_cottage_profile_draft_lifecycle(
  target_profile_id uuid,
  target_expected_version bigint,
  requested_reason text,
  requested_status public.cottage_profile_status
)
returns public.owner_application_cottage_profiles
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.change_administrator_cottage_profile_draft_lifecycle(
  uuid, bigint, text, public.cottage_profile_status
) from public, authenticated, anon;

create function public.abandon_administrator_cottage_profile_draft(
  target_profile_id uuid,
  target_expected_version bigint,
  requested_reason text
)
returns public.owner_application_cottage_profiles
language sql
security definer
set search_path = ''
as $$
  select public.change_administrator_cottage_profile_draft_lifecycle(
    target_profile_id, target_expected_version, requested_reason, 'abandoned'
  );
$$;

create function public.restore_administrator_cottage_profile_draft(
  target_profile_id uuid,
  target_expected_version bigint,
  requested_reason text
)
returns public.owner_application_cottage_profiles
language sql
security definer
set search_path = ''
as $$
  select public.change_administrator_cottage_profile_draft_lifecycle(
    target_profile_id, target_expected_version, requested_reason, 'draft'
  );
$$;

revoke all on function public.abandon_administrator_cottage_profile_draft(uuid, bigint, text)
  from public;
revoke all on function public.restore_administrator_cottage_profile_draft(uuid, bigint, text)
  from public;
grant execute on function public.abandon_administrator_cottage_profile_draft(uuid, bigint, text)
  to authenticated;
grant execute on function public.restore_administrator_cottage_profile_draft(uuid, bigint, text)
  to authenticated;

alter function public.save_cottage_inventory_pricing(uuid, uuid, jsonb)
  rename to save_cottage_inventory_pricing_active_profile;

revoke all on function public.save_cottage_inventory_pricing_active_profile(uuid, uuid, jsonb)
  from public, anon, authenticated;

create function public.save_cottage_inventory_pricing(
  target_profile_id uuid,
  target_schedule_revision_id uuid,
  requested_prices jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.save_cottage_inventory_pricing(uuid, uuid, jsonb)
  from public;
grant execute on function public.save_cottage_inventory_pricing(uuid, uuid, jsonb)
  to authenticated;

alter function public.set_cottage_inventory_availability(uuid, uuid, date, jsonb)
  rename to set_cottage_inventory_availability_active_profile;

revoke all on function public.set_cottage_inventory_availability_active_profile(uuid, uuid, date, jsonb)
  from public, anon, authenticated;

create function public.set_cottage_inventory_availability(
  target_profile_id uuid,
  target_schedule_revision_id uuid,
  target_service_day date,
  requested_states jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.set_cottage_inventory_availability(uuid, uuid, date, jsonb)
  from public;
grant execute on function public.set_cottage_inventory_availability(uuid, uuid, date, jsonb)
  to authenticated;
