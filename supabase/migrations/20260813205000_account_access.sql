create type public.account_role as enum (
  'customer',
  'cottage_owner',
  'platform_administrator'
);

create type public.owner_approval_state as enum ('prospective', 'approved');

create table public.account_contexts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.account_role not null,
  owner_approval_state public.owner_approval_state,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_approval_matches_role check (
    (role = 'cottage_owner' and owner_approval_state is not null)
    or (role <> 'cottage_owner' and owner_approval_state is null)
  )
);

create table public.cottage_ownership (
  cottage_id uuid primary key,
  owner_user_id uuid not null references public.account_contexts (user_id),
  created_at timestamptz not null default now()
);

create index cottage_ownership_owner_user_id_idx
  on public.cottage_ownership (owner_user_id);

alter table public.account_contexts enable row level security;
alter table public.cottage_ownership enable row level security;

create function public.is_platform_administrator(required_assurance text default 'aal2')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.jwt() ->> 'aal') = required_assurance
    and exists (
      select 1
      from public.account_contexts
      where user_id = (select auth.uid())
        and role = 'platform_administrator'
    );
$$;

revoke all on function public.is_platform_administrator(text) from public;
grant execute on function public.is_platform_administrator(text) to authenticated;

create policy "Account holder reads own context"
on public.account_contexts
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "MFA administrator reads account contexts"
on public.account_contexts
for select
to authenticated
using ((select public.is_platform_administrator('aal2')));

create policy "Cottage Owner reads own cottage scope"
on public.cottage_ownership
for select
to authenticated
using (
  owner_user_id = (select auth.uid())
  and exists (
    select 1
    from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state = 'approved'
  )
);

create policy "MFA administrator reads cottage scopes"
on public.cottage_ownership
for select
to authenticated
using ((select public.is_platform_administrator('aal2')));

grant select on public.account_contexts to authenticated;
grant select on public.cottage_ownership to authenticated;

create function public.claim_marketplace_role(requested_role public.account_role)
returns public.account_contexts
language plpgsql
security definer
set search_path = ''
as $$
declare
  context public.account_contexts;
begin
  if requested_role not in ('customer', 'cottage_owner') then
    raise exception 'Only Customer or Cottage Owner access can be claimed publicly'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = (select auth.uid())
      and phone_confirmed_at is not null
  ) then
    raise exception 'A verified phone identity is required'
      using errcode = '42501';
  end if;

  insert into public.account_contexts (user_id, role, owner_approval_state)
  values (
    (select auth.uid()),
    requested_role,
    case
      when requested_role = 'cottage_owner' then 'prospective'::public.owner_approval_state
      else null
    end
  )
  on conflict (user_id) do nothing;

  select * into context
  from public.account_contexts
  where user_id = (select auth.uid());

  if context.role <> requested_role then
    raise exception 'This identity already has a different marketplace role'
      using errcode = '42501';
  end if;

  return context;
end;
$$;

revoke all on function public.claim_marketplace_role(public.account_role) from public;
grant execute on function public.claim_marketplace_role(public.account_role) to authenticated;

create function public.provision_platform_administrator(target_user_id uuid)
returns public.account_contexts
language plpgsql
security definer
set search_path = ''
as $$
declare
  context public.account_contexts;
begin
  if not exists (
    select 1
    from auth.users
    where id = target_user_id
      and email_confirmed_at is not null
      and email is not null
  ) then
    raise exception 'A confirmed email identity is required'
      using errcode = '23514';
  end if;

  insert into public.account_contexts (user_id, role)
  values (target_user_id, 'platform_administrator')
  returning * into context;

  return context;
end;
$$;

revoke all on function public.provision_platform_administrator(uuid) from public;
grant execute on function public.provision_platform_administrator(uuid) to service_role;

create function public.send_test_sms(event jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if event -> 'user' ->> 'phone' is null then
    raise exception 'Phone is required';
  end if;
end;
$$;

revoke all on function public.send_test_sms(jsonb) from public;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.send_test_sms(jsonb) to supabase_auth_admin;

create extension if not exists pgcrypto with schema extensions;

create table public.privileged_sign_in_attempts (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  email_digest text not null check (length(email_digest) = 64),
  stage text not null check (stage in ('primary', 'mfa')),
  outcome text not null check (outcome in ('succeeded', 'failed')),
  attempted_at timestamptz not null default now()
);

create index privileged_sign_in_attempts_actor_user_id_idx
  on public.privileged_sign_in_attempts (actor_user_id, attempted_at desc);

alter table public.privileged_sign_in_attempts enable row level security;

revoke all on table public.privileged_sign_in_attempts from public;
revoke all on table public.privileged_sign_in_attempts from anon, authenticated;
grant select on table public.privileged_sign_in_attempts to service_role;

create function public.record_privileged_sign_in_attempt(
  attempted_email text,
  attempt_stage text,
  attempt_outcome text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(attempted_email, '')));
  administrator_user_id uuid;
begin
  if attempt_stage not in ('primary', 'mfa') then
    raise exception 'Unknown privileged sign-in stage'
      using errcode = '22023';
  end if;

  if attempt_outcome not in ('succeeded', 'failed') then
    raise exception 'Unknown privileged sign-in outcome'
      using errcode = '22023';
  end if;

  select account_contexts.user_id
  into administrator_user_id
  from public.account_contexts
  join auth.users on auth.users.id = account_contexts.user_id
  where account_contexts.role = 'platform_administrator'
    and lower(auth.users.email) = normalized_email
  limit 1;

  insert into public.privileged_sign_in_attempts (
    actor_user_id,
    email_digest,
    stage,
    outcome
  )
  values (
    administrator_user_id,
    encode(extensions.digest(convert_to(normalized_email, 'UTF8'), 'sha256'), 'hex'),
    attempt_stage,
    attempt_outcome
  );
end;
$$;

revoke all on function public.record_privileged_sign_in_attempt(text, text, text)
  from public;
revoke all on function public.record_privileged_sign_in_attempt(text, text, text)
  from anon, authenticated;
grant execute on function public.record_privileged_sign_in_attempt(text, text, text)
  to service_role;
