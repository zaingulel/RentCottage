-- Production translation controls extend the immutable Cottage publication
-- history without rewriting existing source, localization, or publication rows.

alter table public.cottage_translation_runtime_control
  add column approved_evaluation_artifact_digest text,
  add column production_approval_digest text,
  add column provider_terms_approval_reference text,
  add column native_review_approval_reference text,
  add column quality_threshold_approval_reference text,
  add column ordinary_model text,
  add column ordinary_effort text,
  add column ordinary_prompt_version text,
  add column stronger_model text,
  add column stronger_effort text,
  add column stronger_prompt_version text,
  add column judge_model text,
  add column judge_effort text,
  add column judge_prompt_version text,
  add column monthly_request_limit bigint check (monthly_request_limit > 0),
  add column monthly_token_limit bigint check (monthly_token_limit > 0),
  add column monthly_spend_microusd_limit bigint
    check (monthly_spend_microusd_limit > 0),
  add constraint cottage_translation_runtime_launch_gate check (
    not production_ready or coalesce((
      approved_evaluation_artifact_digest ~ '^[0-9a-f]{64}$'
      and production_approval_digest ~ '^[0-9a-f]{64}$'
      and char_length(btrim(provider_terms_approval_reference)) > 0
      and char_length(btrim(native_review_approval_reference)) > 0
      and char_length(btrim(quality_threshold_approval_reference)) > 0
      and char_length(btrim(ordinary_model)) > 0
      and ordinary_effort in ('none', 'low', 'medium', 'high', 'xhigh', 'max')
      and char_length(btrim(ordinary_prompt_version)) > 0
      and char_length(btrim(stronger_model)) > 0
      and stronger_effort in ('none', 'low', 'medium', 'high', 'xhigh', 'max')
      and char_length(btrim(stronger_prompt_version)) > 0
      and char_length(btrim(judge_model)) > 0
      and judge_effort in ('none', 'low', 'medium', 'high', 'xhigh', 'max')
      and char_length(btrim(judge_prompt_version)) > 0
      and monthly_request_limit > 0
      and monthly_token_limit > 0
      and monthly_spend_microusd_limit > 0
    ), false)
  );

create table public.cottage_translation_cache (
  cache_key text primary key check (cache_key ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);

create table public.cottage_translation_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  model text not null check (char_length(btrim(model)) > 0),
  effort text not null check (effort in ('none', 'low', 'medium', 'high', 'xhigh', 'max')),
  prompt_version text not null check (char_length(btrim(prompt_version)) > 0),
  reserved_tokens bigint not null check (reserved_tokens > 0),
  reserved_microusd bigint not null check (reserved_microusd > 0),
  billing_month date not null,
  reserved_at timestamptz not null default now()
);

create index cottage_translation_usage_reservation_month_idx
  on public.cottage_translation_usage_reservations (billing_month, reserved_at);

create table public.cottage_translation_usage_results (
  reservation_id uuid primary key references public.cottage_translation_usage_reservations (id) on delete restrict,
  input_tokens bigint not null check (input_tokens >= 0),
  output_tokens bigint not null check (output_tokens >= 0),
  total_tokens bigint not null check (total_tokens = input_tokens + output_tokens),
  actual_microusd bigint not null check (actual_microusd >= 0),
  recorded_at timestamptz not null default now()
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'cottage_translation_cache',
    'cottage_translation_usage_reservations',
    'cottage_translation_usage_results'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
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

grant select, insert on public.cottage_translation_cache to service_role;
grant select on public.cottage_translation_usage_reservations,
  public.cottage_translation_usage_results to service_role;

create function public.reserve_cottage_translation_usage(
  target_cache_key text,
  target_model text,
  target_effort text,
  target_prompt_version text,
  target_reserved_tokens bigint,
  target_reserved_microusd bigint,
  expected_production_approval_digest text,
  application_monthly_request_limit bigint,
  application_monthly_token_limit bigint,
  application_monthly_spend_microusd_limit bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  control public.cottage_translation_runtime_control;
  month_start date := date_trunc('month', now())::date;
  request_count bigint;
  reserved_tokens numeric;
  reserved_microusd numeric;
  reservation_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  if target_cache_key !~ '^[0-9a-f]{64}$'
    or target_effort not in ('none', 'low', 'medium', 'high', 'xhigh', 'max')
    or char_length(btrim(coalesce(target_model, ''))) < 1
    or char_length(btrim(coalesce(target_prompt_version, ''))) < 1
    or target_reserved_tokens <= 0
    or target_reserved_microusd <= 0
    or application_monthly_request_limit <= 0
    or application_monthly_token_limit <= 0
    or application_monthly_spend_microusd_limit <= 0 then
    raise exception 'Translation reservation is invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cottage-translation-usage-' || month_start::text, 0));
  select * into control
  from public.cottage_translation_runtime_control
  where singleton
  for share;
  if not found or not control.production_ready
    or control.production_approval_digest is distinct from expected_production_approval_digest then
    raise exception 'Production translation is not approved' using errcode = 'RC246';
  end if;

  select count(*), coalesce(sum(usage.reserved_tokens), 0),
    coalesce(sum(usage.reserved_microusd), 0)
  into request_count, reserved_tokens, reserved_microusd
  from public.cottage_translation_usage_reservations usage
  where usage.billing_month = month_start;

  if request_count + 1 > least(control.monthly_request_limit, application_monthly_request_limit)
    or reserved_tokens + target_reserved_tokens
      > least(control.monthly_token_limit, application_monthly_token_limit)
    or reserved_microusd + target_reserved_microusd
      > least(control.monthly_spend_microusd_limit, application_monthly_spend_microusd_limit) then
    return jsonb_build_object('granted', false);
  end if;

  insert into public.cottage_translation_usage_reservations (
    cache_key, model, effort, prompt_version, reserved_tokens,
    reserved_microusd, billing_month
  ) values (
    target_cache_key, btrim(target_model), target_effort,
    btrim(target_prompt_version), target_reserved_tokens,
    target_reserved_microusd, month_start
  ) returning id into reservation_id;

  return jsonb_build_object('granted', true, 'reservation_id', reservation_id);
end;
$$;

revoke all on function public.reserve_cottage_translation_usage(
  text, text, text, text, bigint, bigint, text, bigint, bigint, bigint
) from public;
grant execute on function public.reserve_cottage_translation_usage(
  text, text, text, text, bigint, bigint, text, bigint, bigint, bigint
) to service_role;

create function public.record_cottage_translation_usage(
  target_reservation_id uuid,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  actual_total_tokens bigint,
  actual_microusd bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare reservation public.cottage_translation_usage_reservations;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  select * into reservation
  from public.cottage_translation_usage_reservations
  where id = target_reservation_id
  for share;
  if not found then
    raise exception 'Translation reservation is unavailable' using errcode = 'RC204';
  end if;
  if actual_input_tokens < 0 or actual_output_tokens < 0
    or actual_total_tokens <> actual_input_tokens + actual_output_tokens
    or actual_total_tokens > reservation.reserved_tokens
    or actual_microusd < 0 or actual_microusd > reservation.reserved_microusd then
    raise exception 'Translation usage is invalid' using errcode = '22023';
  end if;
  insert into public.cottage_translation_usage_results (
    reservation_id, input_tokens, output_tokens, total_tokens, actual_microusd
  ) values (
    reservation.id, actual_input_tokens, actual_output_tokens,
    actual_total_tokens, actual_microusd
  );
end;
$$;

revoke all on function public.record_cottage_translation_usage(uuid, bigint, bigint, bigint, bigint) from public;
grant execute on function public.record_cottage_translation_usage(uuid, bigint, bigint, bigint, bigint) to service_role;

alter table public.cottage_profile_translation_attempts
  add column route text not null default 'ordinary'
    check (route in ('ordinary', 'stronger_model')),
  add column lease_token uuid not null default gen_random_uuid(),
  add column lease_expires_at timestamptz not null default (now() + interval '5 minutes');

alter table public.cottage_profile_translation_attempts
  add constraint cottage_profile_translation_attempt_failure_code check (
    failure_code is null or failure_code in (
      'adapter_unavailable', 'configuration_unavailable',
      'unsupported_content', 'invalid_input', 'usage_limit_reached',
      'provider_timeout', 'provider_unavailable',
      'invalid_provider_response', 'cache_unavailable',
      'usage_accounting_unavailable', 'provider_failure'
    )
  );

alter table public.cottage_profile_review_cycles
  add column remediation_publication_id uuid
    references public.cottage_publication_snapshots (id) on delete restrict;

create unique index cottage_profile_one_active_publication_remediation
  on public.cottage_profile_review_cycles (remediation_publication_id)
  where remediation_publication_id is not null and state = 'in_review';

create table public.cottage_profile_translation_human_reviews (
  id uuid primary key default gen_random_uuid(),
  review_cycle_id uuid not null references public.cottage_profile_review_cycles (id) on delete restrict,
  locale public.cottage_profile_source_language not null,
  generated_revision_id uuid not null references public.cottage_profile_localized_revisions (id) on delete restrict,
  administrator_user_id uuid not null references auth.users (id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  state text not null default 'active' check (state in ('active', 'resolved', 'superseded')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint cottage_profile_translation_human_review_state check (
    (state = 'active' and resolved_at is null)
    or (state in ('resolved', 'superseded') and resolved_at is not null)
  )
);

create unique index cottage_profile_one_active_human_review
  on public.cottage_profile_translation_human_reviews (review_cycle_id, locale)
  where state = 'active';

create function public.protect_cottage_translation_human_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.state = 'active'
    and new.state in ('resolved', 'superseded')
    and (to_jsonb(new) - array['state', 'resolved_at'])
      = (to_jsonb(old) - array['state', 'resolved_at']) then
    return new;
  end if;
  raise exception 'Translation human-review history is immutable' using errcode = 'RC208';
end;
$$;

revoke all on function public.protect_cottage_translation_human_review() from public;
create trigger protect_cottage_translation_human_review_update
before update on public.cottage_profile_translation_human_reviews
for each row execute function public.protect_cottage_translation_human_review();
create trigger protect_cottage_translation_human_review_delete
before delete on public.cottage_profile_translation_human_reviews
for each row execute function public.protect_cottage_translation_human_review();

alter table public.cottage_profile_translation_human_reviews enable row level security;
create policy "Owner or MFA administrator reads Cottage translation human review"
on public.cottage_profile_translation_human_reviews for select to authenticated
using (exists (
  select 1 from public.cottage_profile_review_cycles cycles
  where cycles.id = review_cycle_id
    and (cycles.owner_user_id = (select auth.uid())
      or (select public.is_platform_administrator('aal2')))
));
grant select (id, review_cycle_id, locale, generated_revision_id, state, created_at, resolved_at)
  on public.cottage_profile_translation_human_reviews to authenticated;
grant select on public.cottage_profile_translation_human_reviews to service_role;

create function public.reject_active_cottage_translation_human_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.cottage_profile_translation_human_reviews reviews
    where reviews.review_cycle_id = new.review_cycle_id
      and reviews.state = 'active'
  ) then
    raise exception 'Active translation human review must be resolved first'
      using errcode = 'RC409';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_active_cottage_translation_human_review() from public;
create trigger reject_active_human_review_localization_decision
before insert on public.cottage_profile_localized_decisions
for each row execute function public.reject_active_cottage_translation_human_review();
create trigger reject_active_human_review_publication
before insert on public.cottage_publication_snapshots
for each row execute function public.reject_active_cottage_translation_human_review();

create function public.supersede_human_review_after_publication_rejection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state = 'in_review' and new.state = 'rejected' then
    update public.cottage_profile_translation_human_reviews
    set state = 'superseded', resolved_at = now()
    where review_cycle_id = new.id and state = 'active';
  end if;
  return new;
end;
$$;

revoke all on function public.supersede_human_review_after_publication_rejection() from public;
create trigger supersede_human_review_after_publication_rejection
after update of state on public.cottage_profile_review_cycles
for each row execute function public.supersede_human_review_after_publication_rejection();

create or replace function public.begin_cottage_profile_translation(
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
    raise exception 'Production translation is disabled by runtime control' using errcode = 'RC246';
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

create or replace function public.complete_cottage_profile_translation(
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
    raise exception 'Production translation is disabled by runtime control' using errcode = 'RC246';
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

create or replace function public.approve_cottage_profile_publication(target_review_cycle_id uuid, target_reason text)
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
    raise exception 'Production translation and publication are disabled by runtime control'
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

create function public.begin_cottage_profile_translation_execution(
  target_review_cycle_id uuid,
  target_language public.cottage_profile_source_language,
  target_route text,
  target_lease_milliseconds integer
)
returns public.cottage_profile_translation_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare cycle public.cottage_profile_review_cycles;
declare source public.cottage_profile_source_revisions;
declare attempt public.cottage_profile_translation_attempts;
declare expected_head uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  if target_route not in ('ordinary', 'stronger_model') then
    raise exception 'Translation route is invalid' using errcode = '22023';
  end if;
  if target_lease_milliseconds not between 1000 and 900000 then
    raise exception 'Translation execution lease is invalid' using errcode = '22023';
  end if;
  if not coalesce((
    select production_ready
    from public.cottage_translation_runtime_control
    where singleton for share
  ), false) then
    raise exception 'Production translation is disabled' using errcode = 'RC246';
  end if;
  select * into cycle
  from public.cottage_profile_review_cycles
  where id = target_review_cycle_id
  for update;
  if not found or cycle.state <> 'in_review' then
    raise exception 'Cottage review cycle is unavailable' using errcode = 'RC204';
  end if;
  select * into source
  from public.cottage_profile_source_revisions
  where id = cycle.source_revision_id;
  if target_language = source.source_language then
    raise exception 'The source language does not require translation' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.cottage_profile_translation_human_reviews reviews
    where reviews.review_cycle_id = cycle.id
      and reviews.locale = target_language
      and reviews.state = 'active'
  ) then
    raise exception 'The current localization is routed to human review' using errcode = 'RC204';
  end if;
  select * into attempt
  from public.cottage_profile_translation_attempts attempts
  where attempts.review_cycle_id = cycle.id
    and attempts.target_language = begin_cottage_profile_translation_execution.target_language
    and attempts.state = 'pending'
  for update;
  if found and attempt.lease_expires_at > now() then
    raise exception 'Translation execution is already leased' using errcode = 'RC409';
  end if;
  if found then
    update public.cottage_profile_translation_attempts
    set state = 'superseded', completed_at = now()
    where id = attempt.id;
  end if;
  select localized_revision_id into expected_head
  from public.cottage_profile_localized_heads
  where review_cycle_id = cycle.id and locale = target_language;
  insert into public.cottage_profile_translation_attempts (
    review_cycle_id, source_revision_id, target_language,
    expected_localized_revision_id, attempt_number, route,
    lease_token, lease_expires_at
  ) values (
    cycle.id, source.id, target_language, expected_head,
    coalesce((
      select max(attempt_number)
      from public.cottage_profile_translation_attempts existing
      where existing.review_cycle_id = cycle.id
        and existing.target_language = begin_cottage_profile_translation_execution.target_language
    ), 0) + 1,
    target_route, gen_random_uuid(),
    now() + target_lease_milliseconds * interval '1 millisecond'
  ) returning * into attempt;
  return attempt;
end;
$$;

revoke all on function public.begin_cottage_profile_translation_execution(uuid, public.cottage_profile_source_language, text, integer) from public;
grant execute on function public.begin_cottage_profile_translation_execution(uuid, public.cottage_profile_source_language, text, integer) to service_role;

create function public.complete_cottage_profile_translation_execution(
  target_attempt_id uuid,
  target_lease_token uuid,
  translated_description text,
  translated_house_rules text,
  returned_provider text,
  returned_model text,
  returned_effort text,
  returned_prompt_version text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare attempt public.cottage_profile_translation_attempts;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  select * into attempt
  from public.cottage_profile_translation_attempts
  where id = target_attempt_id
  for update;
  if not found or attempt.state <> 'pending'
    or attempt.lease_token <> target_lease_token then return false; end if;
  if attempt.lease_expires_at <= now() or exists (
    select 1 from public.cottage_profile_translation_human_reviews reviews
    where reviews.review_cycle_id = attempt.review_cycle_id
      and reviews.locale = attempt.target_language
      and reviews.state = 'active'
  ) then
    update public.cottage_profile_translation_attempts
    set state = 'superseded', completed_at = now()
    where id = attempt.id;
    return false;
  end if;
  return public.complete_cottage_profile_translation(
    target_attempt_id, translated_description, translated_house_rules,
    returned_provider, returned_model, returned_effort, returned_prompt_version
  );
end;
$$;

revoke all on function public.complete_cottage_profile_translation_execution(uuid, uuid, text, text, text, text, text, text) from public;
grant execute on function public.complete_cottage_profile_translation_execution(uuid, uuid, text, text, text, text, text, text) to service_role;

create function public.fail_cottage_profile_translation_execution(
  target_attempt_id uuid,
  target_lease_token uuid,
  target_failure_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Translation service access is required' using errcode = '42501';
  end if;
  if target_failure_code not in (
    'adapter_unavailable', 'configuration_unavailable',
    'unsupported_content', 'invalid_input', 'usage_limit_reached',
    'provider_timeout', 'provider_unavailable',
    'invalid_provider_response', 'cache_unavailable',
    'usage_accounting_unavailable', 'provider_failure'
  ) then
    raise exception 'Translation failure is invalid' using errcode = '22023';
  end if;
  update public.cottage_profile_translation_attempts
  set state = 'failed', failure_code = btrim(target_failure_code), completed_at = now()
  where id = target_attempt_id and state = 'pending'
    and lease_token = target_lease_token and lease_expires_at > now();
  return found;
end;
$$;

revoke all on function public.fail_cottage_profile_translation_execution(uuid, uuid, text) from public;
grant execute on function public.fail_cottage_profile_translation_execution(uuid, uuid, text) to service_role;

-- The issue #17 entry points do not enforce exclusive execution ownership.
-- Keep them as internal implementation details for the guarded wrappers only.
revoke execute on function public.begin_cottage_profile_translation(uuid, public.cottage_profile_source_language) from service_role;
revoke execute on function public.complete_cottage_profile_translation(uuid, text, text, text, text, text, text) from service_role;
revoke execute on function public.fail_cottage_profile_translation(uuid, text) from service_role;

create function public.route_current_cottage_translation_to_human_review(
  target_review_cycle_id uuid,
  target_locale public.cottage_profile_source_language,
  target_reason text
)
returns public.cottage_profile_translation_human_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare cycle public.cottage_profile_review_cycles;
declare source public.cottage_profile_source_revisions;
declare revision public.cottage_profile_localized_revisions;
declare routed public.cottage_profile_translation_human_reviews;
begin
  if not (select public.is_platform_administrator('aal2')) then
    raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(target_reason, ''))) not between 1 and 1000 then
    raise exception 'A human-review reason is required' using errcode = '22023';
  end if;
  select * into cycle
  from public.cottage_profile_review_cycles
  where id = target_review_cycle_id
  for update;
  if not found or cycle.state <> 'in_review' then
    raise exception 'Cottage review cycle is unavailable' using errcode = 'RC204';
  end if;
  select * into source
  from public.cottage_profile_source_revisions
  where id = cycle.source_revision_id;
  if target_locale = source.source_language then
    raise exception 'The owner source cannot be routed for translation' using errcode = '22023';
  end if;
  select revisions.* into revision
  from public.cottage_profile_localized_heads heads
  join public.cottage_profile_localized_revisions revisions
    on revisions.id = heads.localized_revision_id
  where heads.review_cycle_id = cycle.id and heads.locale = target_locale
  for update of revisions;
  if not found or revision.origin <> 'generated' then
    raise exception 'A current generated localization is required' using errcode = 'RC204';
  end if;
  select * into routed
  from public.cottage_profile_translation_human_reviews reviews
  where reviews.review_cycle_id = cycle.id
    and reviews.locale = target_locale
    and reviews.state = 'active'
  for update;
  if found and routed.generated_revision_id = revision.id then return routed; end if;
  if found then
    update public.cottage_profile_translation_human_reviews
    set state = 'superseded', resolved_at = now()
    where id = routed.id;
  end if;
  update public.cottage_profile_translation_attempts
  set state = 'superseded', completed_at = now()
  where review_cycle_id = cycle.id and target_language = target_locale and state = 'pending';
  insert into public.cottage_profile_translation_human_reviews (
    review_cycle_id, locale, generated_revision_id,
    administrator_user_id, reason
  ) values (
    cycle.id, target_locale, revision.id, (select auth.uid()), btrim(target_reason)
  ) returning * into routed;
  return routed;
end;
$$;

revoke all on function public.route_current_cottage_translation_to_human_review(uuid, public.cottage_profile_source_language, text) from public;
grant execute on function public.route_current_cottage_translation_to_human_review(uuid, public.cottage_profile_source_language, text) to authenticated;

create function public.resolve_cottage_translation_human_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origin = 'administrator_correction' then
    update public.cottage_profile_translation_human_reviews
    set state = 'resolved', resolved_at = now()
    where review_cycle_id = new.review_cycle_id
      and locale = new.locale and state = 'active';
  end if;
  return new;
end;
$$;

revoke all on function public.resolve_cottage_translation_human_review() from public;
create trigger resolve_cottage_translation_human_review
after insert on public.cottage_profile_localized_revisions
for each row execute function public.resolve_cottage_translation_human_review();

create table public.cottage_translation_quality_reports (
  id uuid primary key default gen_random_uuid(),
  review_cycle_id uuid not null references public.cottage_profile_review_cycles (id) on delete restrict,
  remediation_review_cycle_id uuid not null references public.cottage_profile_review_cycles (id) on delete restrict,
  localized_revision_id uuid not null references public.cottage_profile_localized_revisions (id) on delete restrict,
  locale public.cottage_profile_source_language not null,
  reporter_user_id uuid not null references auth.users (id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  reported_at timestamptz not null default now(),
  unique (localized_revision_id, reporter_user_id)
);

alter table public.cottage_translation_quality_reports enable row level security;
create policy "Owner reads own Cottage translation quality reports"
on public.cottage_translation_quality_reports for select to authenticated
using (reporter_user_id = (select auth.uid()));
create policy "MFA administrator reads Cottage translation quality reports"
on public.cottage_translation_quality_reports for select to authenticated
using ((select public.is_platform_administrator('aal2')));
grant select (id, review_cycle_id, remediation_review_cycle_id,
  localized_revision_id, locale, reason, reported_at)
  on public.cottage_translation_quality_reports to authenticated;
grant select on public.cottage_translation_quality_reports to service_role;
create trigger reject_cottage_translation_quality_reports_update
before update on public.cottage_translation_quality_reports
for each row execute function public.reject_cottage_publication_history_mutation();
create trigger reject_cottage_translation_quality_reports_delete
before delete on public.cottage_translation_quality_reports
for each row execute function public.reject_cottage_publication_history_mutation();

create function public.report_current_cottage_translation(
  target_review_cycle_id uuid,
  target_localized_revision_id uuid,
  target_reason text
)
returns public.cottage_translation_quality_reports
language plpgsql
security definer
set search_path = ''
as $$
declare cycle public.cottage_profile_review_cycles;
declare revision public.cottage_profile_localized_revisions;
declare report public.cottage_translation_quality_reports;
declare profile public.owner_application_cottage_profiles;
declare publication public.cottage_publication_snapshots;
declare remediation public.cottage_profile_review_cycles;
declare current_head_visible boolean;
declare published_visible boolean;
begin
  if char_length(btrim(coalesce(target_reason, ''))) not between 1 and 1000 then
    raise exception 'A translation report reason is required' using errcode = '22023';
  end if;
  select * into cycle
  from public.cottage_profile_review_cycles
  where id = target_review_cycle_id
  for update;
  if not found or cycle.owner_user_id <> (select auth.uid())
    or not exists (
      select 1 from public.account_contexts contexts
      where contexts.user_id = (select auth.uid())
        and contexts.role = 'cottage_owner'
        and contexts.owner_approval_state = 'approved'
    ) then
    raise exception 'Cottage translation report access is denied' using errcode = '42501';
  end if;
  select * into revision
  from public.cottage_profile_localized_revisions
  where id = target_localized_revision_id
    and review_cycle_id = cycle.id
  for share;
  if not found or revision.origin <> 'generated' then
    raise exception 'A generated localization is required' using errcode = 'RC204';
  end if;
  select * into profile
  from public.owner_application_cottage_profiles
  where id = cycle.profile_id
  for update;
  current_head_visible := cycle.state = 'in_review' and exists (
    select 1 from public.cottage_profile_localized_heads heads
    where heads.review_cycle_id = cycle.id
      and heads.locale = revision.locale
      and heads.localized_revision_id = revision.id
  );
  select snapshots.* into publication
  from public.cottage_publication_snapshots snapshots
  where snapshots.id = profile.current_publication_id
    and snapshots.profile_id = profile.id;
  published_visible := found and exists (
    select 1 from public.cottage_publication_localizations localizations
    where localizations.publication_id = publication.id
      and localizations.locale = revision.locale
      and localizations.localized_revision_id = revision.id
  );
  if not current_head_visible and not published_visible then
    raise exception 'The generated localization is no longer current' using errcode = 'RC409';
  end if;

  select * into report
  from public.cottage_translation_quality_reports reports
  where reports.localized_revision_id = revision.id
    and reports.reporter_user_id = (select auth.uid());
  if found then return report; end if;

  if published_visible then
    select * into remediation
    from public.cottage_profile_review_cycles cycles
    where cycles.profile_id = profile.id and cycles.state = 'in_review'
    for update;
    if found and remediation.remediation_publication_id is distinct from publication.id then
      raise exception 'A different Cottage review cycle is already active' using errcode = 'RC409';
    end if;
    if not found then
      insert into public.cottage_profile_review_cycles (
        profile_id, owner_user_id, source_revision_id, name, governorate,
        approximate_location, capacity, bedrooms, bathrooms, amenities,
        cycle_number, remediation_publication_id
      ) values (
        profile.id, cycle.owner_user_id, cycle.source_revision_id,
        publication.name, publication.governorate,
        publication.approximate_location, publication.capacity,
        publication.bedrooms, publication.bathrooms, publication.amenities,
        coalesce((
          select max(cycles.cycle_number)
          from public.cottage_profile_review_cycles cycles
          where cycles.profile_id = profile.id
        ), 0) + 1,
        publication.id
      ) returning * into remediation;

      insert into public.cottage_profile_localized_revisions (
        review_cycle_id, locale, revision, origin, description, house_rules,
        provider, model, effort, prompt_version,
        administrator_user_id, correction_reason
      )
      select remediation.id, localizations.locale, 1, published.origin,
        localizations.description, localizations.house_rules,
        published.provider, published.model, published.effort,
        published.prompt_version, published.administrator_user_id,
        published.correction_reason
      from public.cottage_publication_localizations localizations
      join public.cottage_profile_localized_revisions published
        on published.id = localizations.localized_revision_id
      where localizations.publication_id = publication.id;

      insert into public.cottage_profile_localized_heads (
        review_cycle_id, locale, localized_revision_id
      )
      select remediation.id, localized.locale, localized.id
      from public.cottage_profile_localized_revisions localized
      where localized.review_cycle_id = remediation.id;

      insert into public.cottage_profile_review_photos (
        review_cycle_id, photo_id, position
      )
      select remediation.id, media.photo_id, media.position
      from public.cottage_publication_media media
      where media.publication_id = publication.id;
    end if;
  else
    remediation := cycle;
  end if;

  insert into public.cottage_translation_quality_reports (
    review_cycle_id, remediation_review_cycle_id, localized_revision_id,
    locale, reporter_user_id, reason
  ) values (
    cycle.id, remediation.id, revision.id, revision.locale,
    (select auth.uid()), btrim(target_reason)
  ) returning * into report;
  return report;
end;
$$;

revoke all on function public.report_current_cottage_translation(uuid, uuid, text) from public;
grant execute on function public.report_current_cottage_translation(uuid, uuid, text) to authenticated;

create function public.get_cottage_translation_administration()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare control public.cottage_translation_runtime_control;
declare month_start date := date_trunc('month', now())::date;
begin
  if not (select public.is_platform_administrator('aal2')) then
    raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501';
  end if;
  select * into control
  from public.cottage_translation_runtime_control
  where singleton;
  if not found then
    raise exception 'Translation runtime control is unavailable' using errcode = 'RC246';
  end if;
  return jsonb_build_object(
    'productionReady', control.production_ready,
    'approvedEvaluationArtifactDigest', control.approved_evaluation_artifact_digest,
    'productionApprovalDigest', control.production_approval_digest,
    'providerTermsApproved', control.provider_terms_approval_reference is not null,
    'nativeReviewApproved', control.native_review_approval_reference is not null,
    'qualityThresholdApproved', control.quality_threshold_approval_reference is not null,
    'ordinaryModel', control.ordinary_model,
    'ordinaryEffort', control.ordinary_effort,
    'strongerModel', control.stronger_model,
    'strongerEffort', control.stronger_effort,
    'judgeModel', control.judge_model,
    'judgeEffort', control.judge_effort,
    'monthlyRequestLimit', control.monthly_request_limit,
    'monthlyTokenLimit', control.monthly_token_limit,
    'monthlySpendMicrousdLimit', control.monthly_spend_microusd_limit,
    'monthRequests', (
      select count(*) from public.cottage_translation_usage_reservations usage
      where usage.billing_month = month_start
    ),
    'monthReservedTokens', (
      select coalesce(sum(usage.reserved_tokens), 0)
      from public.cottage_translation_usage_reservations usage
      where usage.billing_month = month_start
    ),
    'monthReservedMicrousd', (
      select coalesce(sum(usage.reserved_microusd), 0)
      from public.cottage_translation_usage_reservations usage
      where usage.billing_month = month_start
    ),
    'monthActualMicrousd', (
      select coalesce(sum(results.actual_microusd), 0)
      from public.cottage_translation_usage_results results
      join public.cottage_translation_usage_reservations usage
        on usage.id = results.reservation_id
      where usage.billing_month = month_start
    ),
    'qualityReportCount', (select count(*) from public.cottage_translation_quality_reports)
  );
end;
$$;

revoke all on function public.get_cottage_translation_administration() from public;
grant execute on function public.get_cottage_translation_administration() to authenticated;
