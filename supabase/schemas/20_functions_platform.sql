SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
SET default_tablespace = '';
SET default_table_access_method = "heap";

CREATE OR REPLACE FUNCTION "public"."claim_marketplace_role"("requested_role" "public"."account_role") RETURNS "public"."account_contexts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
      using errcode = 'RC001';
  end if;

  return context;
end;
$$;

ALTER FUNCTION "public"."claim_marketplace_role"("requested_role" "public"."account_role") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."is_platform_administrator"("required_assurance" "text" DEFAULT 'aal2'::"text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    (select auth.jwt() ->> 'aal') = required_assurance
    and exists (
      select 1
      from public.account_contexts
      where user_id = (select auth.uid())
        and role = 'platform_administrator'
    );
$$;

ALTER FUNCTION "public"."is_platform_administrator"("required_assurance" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."provision_platform_administrator"("target_user_id" "uuid") RETURNS "public"."account_contexts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

ALTER FUNCTION "public"."provision_platform_administrator"("target_user_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."record_privileged_sign_in_attempt"("attempted_email" "text", "attempted_email_digest" "text", "attempt_stage" "text", "attempt_outcome" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  normalized_email text := lower(trim(coalesce(attempted_email, '')));
  administrator_user_id uuid;
begin
  if attempted_email_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Privileged sign-in email digest is invalid'
      using errcode = '22023';
  end if;

  if attempt_stage not in ('primary', 'mfa') then
    raise exception 'Unknown privileged sign-in stage'
      using errcode = '22023';
  end if;

  if attempt_outcome not in ('succeeded', 'failed') then
    raise exception 'Unknown privileged sign-in outcome'
      using errcode = '22023';
  end if;

  delete from public.privileged_sign_in_attempts
  where attempted_at < now() - interval '180 days';

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
    attempted_email_digest,
    attempt_stage,
    attempt_outcome
  );
end;
$_$;

ALTER FUNCTION "public"."record_privileged_sign_in_attempt"("attempted_email" "text", "attempted_email_digest" "text", "attempt_stage" "text", "attempt_outcome" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_authorization_claim_inventory_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare candidate_schedule_revision_id uuid;
declare candidate_unit_kind public.cottage_inventory_unit_kind;
declare candidate_unit_id uuid;
declare candidate_service_day date;
declare candidate_weekday smallint;
begin
  if current_setting('role', true) = 'service_role' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then
    candidate_schedule_revision_id := old.schedule_revision_id;
    candidate_unit_kind := old.unit_kind;
    candidate_unit_id := old.unit_id;
    if tg_table_name in (
      'cottage_inventory_date_price_overrides', 'cottage_inventory_availability'
    ) then candidate_service_day := old.service_day; end if;
    if tg_table_name = 'cottage_inventory_weekday_price_overrides'
      then candidate_weekday := old.weekday; end if;
  else
    candidate_schedule_revision_id := new.schedule_revision_id;
    candidate_unit_kind := new.unit_kind;
    candidate_unit_id := new.unit_id;
    if tg_table_name in (
      'cottage_inventory_date_price_overrides', 'cottage_inventory_availability'
    ) then candidate_service_day := new.service_day; end if;
    if tg_table_name = 'cottage_inventory_weekday_price_overrides'
      then candidate_weekday := new.weekday; end if;
  end if;
  if tg_table_name = 'cottage_inventory_standard_prices'
    and exists (
      select 1
      from public.booking_request_authorization_claim_items items
      join public.booking_request_authorization_claims claims
        on claims.id = items.claim_id
	      where public.booking_request_claim_state_is_active(claims.state)
        and claims.schedule_revision_id = candidate_schedule_revision_id
        and items.unit_kind = candidate_unit_kind
        and items.unit_id = candidate_unit_id
    ) then
    raise exception 'Authorization-claimed Cottage Inventory cannot change'
      using errcode = 'RC204';
  elsif tg_table_name = 'cottage_inventory_weekday_price_overrides'
    and exists (
      select 1
      from public.booking_request_authorization_claim_items items
      join public.booking_request_authorization_claims claims
        on claims.id = items.claim_id
	      where public.booking_request_claim_state_is_active(claims.state)
        and claims.schedule_revision_id = candidate_schedule_revision_id
        and items.unit_kind = candidate_unit_kind
        and items.unit_id = candidate_unit_id
        and extract(dow from items.service_day)::smallint = candidate_weekday
    ) then
    raise exception 'Authorization-claimed Cottage Inventory cannot change'
      using errcode = 'RC204';
  elsif tg_table_name in (
      'cottage_inventory_date_price_overrides', 'cottage_inventory_availability'
    ) and public.booking_request_active_claim_conflicts_unit(
      candidate_schedule_revision_id, candidate_unit_kind,
      candidate_unit_id, candidate_service_day
    ) then
    raise exception 'Authorization-claimed Cottage Inventory cannot change'
      using errcode = 'RC204';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

ALTER FUNCTION "public"."reject_authorization_claim_inventory_mutation"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."send_test_sms"("event" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if event -> 'user' ->> 'phone' is null then
    raise exception 'Phone is required';
  end if;
end;
$$;

ALTER FUNCTION "public"."send_test_sms"("event" "jsonb") OWNER TO "postgres";
