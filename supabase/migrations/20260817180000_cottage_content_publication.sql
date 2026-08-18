-- Additive content-review and publication foundation. Production translation and
-- public activation remain disabled until the provider work in issue #46.

alter table public.cottage_profile_photos
  add column is_active boolean not null default true;

create index cottage_profile_photos_active_profile_idx
  on public.cottage_profile_photos (profile_id, created_at, id)
  where is_active;

create table public.cottage_translation_runtime_control (
  singleton boolean primary key default true check (singleton),
  production_ready boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.cottage_translation_runtime_control (singleton)
values (true);

alter table public.cottage_translation_runtime_control enable row level security;
grant select, update on public.cottage_translation_runtime_control to service_role;

create table public.cottage_profile_review_cycles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.owner_application_cottage_profiles (id) on delete restrict,
  owner_user_id uuid not null references public.account_contexts (user_id) on delete restrict,
  source_revision_id uuid not null references public.cottage_profile_source_revisions (id) on delete restrict,
  name text not null,
  governorate text not null,
  approximate_location text not null,
  capacity integer not null,
  bedrooms integer not null,
  bathrooms integer not null,
  amenities text[] not null,
  cycle_number integer not null check (cycle_number >= 1),
  state text not null default 'in_review' check (state in ('in_review', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (profile_id, cycle_number),
  unique (id, source_revision_id),
  constraint cottage_profile_review_cycle_decision_time check (
    (state = 'in_review' and decided_at is null)
    or (state in ('approved', 'rejected') and decided_at is not null)
  )
);

create unique index cottage_profile_one_active_review_cycle
  on public.cottage_profile_review_cycles (profile_id)
  where state = 'in_review';

create table public.cottage_profile_localized_revisions (
  id uuid primary key default gen_random_uuid(),
  review_cycle_id uuid not null references public.cottage_profile_review_cycles (id) on delete restrict,
  locale public.cottage_profile_source_language not null,
  revision integer not null check (revision >= 1),
  origin text not null check (origin in ('owner_source', 'generated', 'administrator_correction')),
  description text not null check (char_length(description) between 1 and 2000),
  house_rules text not null check (char_length(house_rules) between 1 and 1500),
  provider text,
  model text,
  effort text,
  prompt_version text,
  administrator_user_id uuid references auth.users (id) on delete restrict,
  correction_reason text,
  created_at timestamptz not null default now(),
  unique (review_cycle_id, locale, revision),
  constraint cottage_profile_localized_revision_origin check (
    (origin = 'owner_source' and provider is null and model is null and effort is null
      and prompt_version is null and administrator_user_id is null and correction_reason is null)
    or (origin = 'generated' and provider is not null and model is not null and effort is not null
      and prompt_version is not null and administrator_user_id is null and correction_reason is null)
    or (origin = 'administrator_correction' and provider is null and model is null and effort is null
      and prompt_version is null and administrator_user_id is not null
      and char_length(btrim(correction_reason)) between 1 and 1000)
  )
);

create table public.cottage_profile_localized_heads (
  review_cycle_id uuid not null references public.cottage_profile_review_cycles (id) on delete restrict,
  locale public.cottage_profile_source_language not null,
  localized_revision_id uuid not null references public.cottage_profile_localized_revisions (id) on delete restrict,
  primary key (review_cycle_id, locale)
);

create table public.cottage_profile_review_photos (
  review_cycle_id uuid not null references public.cottage_profile_review_cycles (id) on delete restrict,
  photo_id uuid not null references public.cottage_profile_photos (id) on delete restrict,
  position integer not null check (position >= 1),
  primary key (review_cycle_id, photo_id),
  unique (review_cycle_id, position)
);

create table public.cottage_profile_translation_attempts (
  id uuid primary key default gen_random_uuid(),
  review_cycle_id uuid not null,
  source_revision_id uuid not null,
  target_language public.cottage_profile_source_language not null,
  expected_localized_revision_id uuid references public.cottage_profile_localized_revisions (id) on delete restrict,
  attempt_number integer not null check (attempt_number >= 1),
  state text not null default 'pending' check (state in ('pending', 'completed', 'failed', 'superseded')),
  failure_code text,
  provider text,
  model text,
  effort text,
  prompt_version text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (review_cycle_id, source_revision_id)
    references public.cottage_profile_review_cycles (id, source_revision_id) on delete restrict,
  unique (review_cycle_id, target_language, attempt_number),
  constraint cottage_profile_translation_attempt_outcome check (
    (state = 'pending' and failure_code is null and provider is null and completed_at is null)
    or (state = 'completed' and failure_code is null and provider is not null and model is not null
      and effort is not null and prompt_version is not null and completed_at is not null)
    or (state = 'failed' and failure_code is not null and provider is null and completed_at is not null)
    or (state = 'superseded' and failure_code is null and completed_at is not null)
  )
);

create unique index cottage_profile_one_pending_translation
  on public.cottage_profile_translation_attempts (review_cycle_id, target_language)
  where state = 'pending';

create table public.cottage_profile_localized_decisions (
  id uuid primary key default gen_random_uuid(),
  review_cycle_id uuid not null references public.cottage_profile_review_cycles (id) on delete restrict,
  locale public.cottage_profile_source_language not null,
  localized_revision_id uuid not null references public.cottage_profile_localized_revisions (id) on delete restrict,
  administrator_user_id uuid not null references auth.users (id) on delete restrict,
  approved boolean not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  decided_at timestamptz not null default now()
);

create table public.cottage_profile_publication_decisions (
  id uuid primary key default gen_random_uuid(),
  review_cycle_id uuid not null references public.cottage_profile_review_cycles (id) on delete restrict,
  administrator_user_id uuid not null references auth.users (id) on delete restrict,
  approved boolean not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  decided_at timestamptz not null default now()
);

create table public.cottage_publication_snapshots (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.owner_application_cottage_profiles (id) on delete restrict,
  review_cycle_id uuid not null unique references public.cottage_profile_review_cycles (id) on delete restrict,
  publication_number integer not null check (publication_number >= 1),
  name text not null,
  governorate text not null,
  approximate_location text not null,
  capacity integer not null,
  bedrooms integer not null,
  bathrooms integer not null,
  amenities text[] not null,
  published_at timestamptz not null default now(),
  unique (profile_id, publication_number)
);

create table public.cottage_publication_localizations (
  publication_id uuid not null references public.cottage_publication_snapshots (id) on delete restrict,
  locale public.cottage_profile_source_language not null,
  localized_revision_id uuid not null references public.cottage_profile_localized_revisions (id) on delete restrict,
  description text not null,
  house_rules text not null,
  primary key (publication_id, locale)
);

create table public.cottage_publication_media (
  publication_id uuid not null references public.cottage_publication_snapshots (id) on delete restrict,
  photo_id uuid not null references public.cottage_profile_photos (id) on delete restrict,
  opaque_id uuid not null unique default gen_random_uuid(),
  object_path text not null,
  media_type text not null,
  position integer not null check (position >= 1),
  primary key (publication_id, photo_id),
  unique (publication_id, position)
);

alter table public.owner_application_cottage_profiles
  add column current_publication_id uuid references public.cottage_publication_snapshots (id) on delete restrict;

create function public.reject_cottage_publication_history_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.reject_cottage_publication_history_mutation() from public;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'cottage_profile_review_cycles', 'cottage_profile_localized_revisions',
    'cottage_profile_review_photos', 'cottage_profile_translation_attempts',
    'cottage_profile_localized_decisions', 'cottage_profile_publication_decisions',
    'cottage_publication_snapshots', 'cottage_publication_localizations',
    'cottage_publication_media'
  ] loop
    execute format(
      'create trigger reject_%1$s_update before update on public.%1$I for each row execute function public.reject_cottage_publication_history_mutation()',
      table_name
    );
    execute format(
      'create trigger reject_%1$s_delete before delete on public.%1$I for each row execute function public.reject_cottage_publication_history_mutation()',
      table_name
    );
  end loop;
end;
$$;

create function public.create_cottage_profile_review_cycle()
returns trigger language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.create_cottage_profile_review_cycle() from public;

create trigger create_cottage_profile_review_cycle
after update of submitted_source_revision_id on public.owner_application_cottage_profiles
for each row execute function public.create_cottage_profile_review_cycle();

create function public.protect_cottage_profile_source_during_review()
returns trigger language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.protect_cottage_profile_source_during_review() from public;
create trigger protect_cottage_profile_source_during_review
before update on public.owner_application_cottage_profiles
for each row execute function public.protect_cottage_profile_source_during_review();

create function public.begin_cottage_profile_translation(
  target_review_cycle_id uuid,
  target_language public.cottage_profile_source_language
)
returns public.cottage_profile_translation_attempts
language plpgsql security definer set search_path = '' as $$
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
    raise exception 'Production translation is disabled until issue #46' using errcode = 'RC246';
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
revoke all on function public.begin_cottage_profile_translation(uuid, public.cottage_profile_source_language) from public;
grant execute on function public.begin_cottage_profile_translation(uuid, public.cottage_profile_source_language) to service_role;

create function public.complete_cottage_profile_translation(
  target_attempt_id uuid, translated_description text, translated_house_rules text,
  returned_provider text, returned_model text, returned_effort text, returned_prompt_version text
)
returns boolean language plpgsql security definer set search_path = '' as $$
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
    raise exception 'Production translation is disabled until issue #46' using errcode = 'RC246';
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
revoke all on function public.complete_cottage_profile_translation(uuid, text, text, text, text, text, text) from public;
grant execute on function public.complete_cottage_profile_translation(uuid, text, text, text, text, text, text) to service_role;

create function public.fail_cottage_profile_translation(target_attempt_id uuid, target_failure_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Translation service access is required' using errcode = '42501'; end if;
  update public.cottage_profile_translation_attempts
    set state = 'failed', failure_code = btrim(target_failure_code), completed_at = now()
    where id = target_attempt_id and state = 'pending';
end;
$$;
revoke all on function public.fail_cottage_profile_translation(uuid, text) from public;
grant execute on function public.fail_cottage_profile_translation(uuid, text) to service_role;

create function public.correct_cottage_profile_localization(
  target_review_cycle_id uuid, target_locale public.cottage_profile_source_language,
  corrected_description text, corrected_house_rules text, target_reason text
)
returns public.cottage_profile_localized_revisions
language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.correct_cottage_profile_localization(uuid, public.cottage_profile_source_language, text, text, text) from public;
grant execute on function public.correct_cottage_profile_localization(uuid, public.cottage_profile_source_language, text, text, text) to authenticated;

create function public.decide_cottage_profile_localization(
  target_review_cycle_id uuid, target_locale public.cottage_profile_source_language,
  target_approved boolean, target_reason text
)
returns public.cottage_profile_localized_decisions
language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.decide_cottage_profile_localization(uuid, public.cottage_profile_source_language, boolean, text) from public;
grant execute on function public.decide_cottage_profile_localization(uuid, public.cottage_profile_source_language, boolean, text) to authenticated;

create function public.approve_cottage_profile_publication(target_review_cycle_id uuid, target_reason text)
returns public.cottage_publication_snapshots
language plpgsql security definer set search_path = '' as $$
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
    raise exception 'Production translation and publication are disabled until issue #46'
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
revoke all on function public.approve_cottage_profile_publication(uuid, text) from public;
grant execute on function public.approve_cottage_profile_publication(uuid, text) to authenticated;

create function public.reject_cottage_profile_publication(target_review_cycle_id uuid, target_reason text)
returns void language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.reject_cottage_profile_publication(uuid, text) from public;
grant execute on function public.reject_cottage_profile_publication(uuid, text) to authenticated;

create or replace function public.cottage_profile_ready_photo_count(target_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.prepare_cottage_profile_photo_upload(
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

create or replace function public.submit_cottage_profile_for_content_approval(
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

create or replace function public.prepare_cottage_profile_photo_deletion(
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

create or replace function public.block_published_cottage_photo_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.block_published_cottage_photo_deletion() from public;
create trigger block_published_cottage_photo_deletion
before update of state, is_active on public.cottage_profile_photos
for each row execute function public.block_published_cottage_photo_deletion();

create function public.get_current_cottage_publication(
  target_profile_id uuid, target_locale public.cottage_profile_source_language
)
returns table (
  publication_id uuid, name text, governorate text, approximate_location text,
  capacity integer, bedrooms integer, bathrooms integer, amenities text[],
  description text, house_rules text, media_ids uuid[]
)
language sql stable security definer set search_path = '' as $$
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
  group by publications.id, localizations.description, localizations.house_rules;
$$;
revoke all on function public.get_current_cottage_publication(uuid, public.cottage_profile_source_language) from public;
grant execute on function public.get_current_cottage_publication(uuid, public.cottage_profile_source_language) to anon, authenticated;

create function public.resolve_current_cottage_publication_media(target_opaque_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare target_path text;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Publication media service access is required' using errcode = '42501'; end if;
  select media.object_path into target_path
  from public.cottage_publication_media media
  join public.cottage_publication_snapshots publication on publication.id = media.publication_id
  join public.owner_application_cottage_profiles profile
    on profile.id = publication.profile_id and profile.current_publication_id = publication.id
  where media.opaque_id = target_opaque_id;
  if target_path is null then raise exception 'Publication media is unavailable' using errcode = 'RC204'; end if;
  return target_path;
end;
$$;
revoke all on function public.resolve_current_cottage_publication_media(uuid) from public;
grant execute on function public.resolve_current_cottage_publication_media(uuid) to service_role;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'cottage_profile_review_cycles', 'cottage_profile_localized_revisions',
    'cottage_profile_localized_heads', 'cottage_profile_review_photos',
    'cottage_profile_translation_attempts', 'cottage_profile_localized_decisions',
    'cottage_profile_publication_decisions', 'cottage_publication_snapshots',
    'cottage_publication_localizations', 'cottage_publication_media'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;

create policy "Owner or MFA administrator reads Cottage Profile review cycles"
on public.cottage_profile_review_cycles for select to authenticated
using (owner_user_id = (select auth.uid()) or (select public.is_platform_administrator('aal2')));

create policy "Owner or MFA administrator reads Cottage Profile localized history"
on public.cottage_profile_localized_revisions for select to authenticated
using (exists (select 1 from public.cottage_profile_review_cycles cycles
  where cycles.id = review_cycle_id and (cycles.owner_user_id = (select auth.uid())
    or (select public.is_platform_administrator('aal2')))));

create policy "Owner or MFA administrator reads Cottage Profile localized heads"
on public.cottage_profile_localized_heads for select to authenticated
using (exists (select 1 from public.cottage_profile_review_cycles cycles
  where cycles.id = review_cycle_id and (cycles.owner_user_id = (select auth.uid())
    or (select public.is_platform_administrator('aal2')))));

create policy "Owner or MFA administrator reads Cottage Profile review photos"
on public.cottage_profile_review_photos for select to authenticated
using (exists (select 1 from public.cottage_profile_review_cycles cycles
  where cycles.id = review_cycle_id and (cycles.owner_user_id = (select auth.uid())
    or (select public.is_platform_administrator('aal2')))));

create policy "Owner or MFA administrator reads Cottage Profile decisions"
on public.cottage_profile_localized_decisions for select to authenticated
using (exists (select 1 from public.cottage_profile_review_cycles cycles
  where cycles.id = review_cycle_id and (cycles.owner_user_id = (select auth.uid())
    or (select public.is_platform_administrator('aal2')))));

create policy "Owner or MFA administrator reads Cottage Profile publication decisions"
on public.cottage_profile_publication_decisions for select to authenticated
using (exists (select 1 from public.cottage_profile_review_cycles cycles
  where cycles.id = review_cycle_id and (cycles.owner_user_id = (select auth.uid())
    or (select public.is_platform_administrator('aal2')))));

grant select on public.cottage_profile_review_cycles,
  public.cottage_profile_localized_heads, public.cottage_profile_review_photos to authenticated;
grant select (id, review_cycle_id, locale, revision, origin, description, house_rules,
  provider, model, effort, prompt_version, correction_reason, created_at)
  on public.cottage_profile_localized_revisions to authenticated;
grant select (id, review_cycle_id, locale, localized_revision_id, approved, reason, decided_at)
  on public.cottage_profile_localized_decisions to authenticated;
grant select (id, review_cycle_id, approved, reason, decided_at)
  on public.cottage_profile_publication_decisions to authenticated;
grant select on public.cottage_profile_translation_attempts,
  public.cottage_profile_review_cycles, public.cottage_profile_source_revisions,
  public.cottage_publication_snapshots, public.cottage_publication_localizations,
  public.cottage_publication_media to service_role;
