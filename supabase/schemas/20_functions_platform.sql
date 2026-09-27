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
  if requested_role is null or requested_role not in ('customer', 'cottage_owner') then
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

  -- The auth identity exists before either first-time claim, so it serializes enrollment even with no context row yet.
  perform 1 from auth.users where id = (select auth.uid()) for update;

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
  where user_id = (select auth.uid())
  for update;

  if context.role = 'platform_administrator' then
    raise exception 'This identity already has a different marketplace role'
      using errcode = 'RC001';
  end if;

  if requested_role = 'cottage_owner' and context.role = 'customer' then
    update public.account_contexts
    set role = 'cottage_owner', owner_approval_state = 'prospective'
    where user_id = context.user_id
    returning * into context;
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

CREATE OR REPLACE FUNCTION public.search_administrator_records(
  target_kind text, target_query text, target_status text, target_from date,
  target_through date, target_owner_id uuid, after_at timestamptz, after_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
declare
  query_text text := btrim(coalesce(target_query, ''));
  query_uuid uuid;
  query_phone text;
  result jsonb;
begin
  if public.is_platform_administrator('aal2') is not true then
    raise exception 'Platform Administrator AAL2 access required' using errcode = '42501';
  end if;
  if target_kind is null or target_kind not in ('customers','owners','cottages','applications','approvals') then
    raise exception 'Invalid administrator record kind' using errcode = '22023';
  end if;
  if target_status is not null and not (
    (target_kind = 'owners' and target_status in ('prospective','approved','suspended','expired')) or
    (target_kind = 'cottages' and target_status in ('draft','submitted_for_content_approval','abandoned')) or
    (target_kind = 'applications' and target_status in ('pending','submitted','under_review','needs_information','approved','rejected','expired','suspended')) or
    (target_kind = 'approvals' and target_status in ('in_review','approved','rejected'))
  ) then
    raise exception 'Invalid administrator record status' using errcode = '22023';
  end if;
  if target_owner_id is not null and target_kind not in ('cottages','applications','approvals') then
    raise exception 'Owner filter is not valid for this kind' using errcode = '22023';
  end if;
  if target_from is not null and target_through is not null and target_from > target_through then
    raise exception 'Date range is reversed' using errcode = '22023';
  end if;
  if (after_at is null) <> (after_id is null) then
    raise exception 'Cursor requires date and identifier' using errcode = '22023';
  end if;
  if query_text <> '' then
    if query_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      query_uuid := query_text::uuid;
    elsif query_text ~* '^[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}$' then
      raise exception 'Invalid account identifier' using errcode = '22023';
    elsif query_text ~ '^\+?964[0-9]{10}$' then
      query_phone := regexp_replace(query_text, '^\+', '');
    elsif length(query_text) < 2 or length(query_text) > 120 then
      raise exception 'Search text must have 2 to 120 characters' using errcode = '22023';
    end if;
  end if;

  with pending_counts as (
    select
      (select count(*) from public.owner_applications where status in ('submitted','under_review')) as applications,
      (select count(*) from public.cottage_profile_review_cycles where state = 'in_review') as approvals
  ),
  candidates as (
    select 'customers'::text kind, contexts.user_id id, contexts.user_id owner_id,
      null::uuid profile_id, application.id application_id,
      contexts.user_id::text label, contexts.role::text status,
      contexts.created_at at, null::integer cycle_number,
      case when users.phone_confirmed_at is not null and users.phone is not null
        then '•••' || right(users.phone, 4) end masked_phone,
      users.phone verified_phone
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    left join lateral (
      select id from public.owner_applications applications
      where applications.owner_user_id = contexts.user_id and applications.status <> 'draft'
      order by applications.submitted_at desc, applications.id desc limit 1
    ) application on true
    where target_kind = 'customers' and contexts.role in ('customer','cottage_owner')
    union all
    select 'owners', contexts.user_id, contexts.user_id, null::uuid, application.id,
      coalesce(application.name, contexts.user_id::text), contexts.owner_approval_state::text,
      contexts.created_at, null::integer,
      case when users.phone_confirmed_at is not null and users.phone is not null
        then '•••' || right(users.phone, 4) end, users.phone
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    left join lateral (
      select applications.id, coalesce(applications.legal_name, applications.company_name) name
      from public.owner_applications applications
      where applications.owner_user_id = contexts.user_id and applications.status <> 'draft'
      order by applications.submitted_at desc, applications.id desc limit 1
    ) application on true
    where target_kind = 'owners' and contexts.role = 'cottage_owner'
    union all
    select 'cottages', profiles.id, profiles.owner_user_id, profiles.id, profiles.application_id,
      coalesce(profiles.name, profiles.id::text), profiles.status::text, profiles.created_at, null::integer,
      null::text, null::text
    from public.owner_application_cottage_profiles profiles
    where target_kind = 'cottages'
    union all
    select 'applications', applications.id, applications.owner_user_id, null::uuid, applications.id,
      coalesce(applications.legal_name, applications.company_name), applications.status::text,
      applications.submitted_at, null::integer, null::text, null::text
    from public.owner_applications applications
    where target_kind = 'applications' and applications.status <> 'draft'
    union all
    select 'approvals', cycles.id, cycles.owner_user_id, cycles.profile_id, null::uuid,
      cycles.name, cycles.state, cycles.created_at, cycles.cycle_number,
      null::text, null::text
    from public.cottage_profile_review_cycles cycles
    where target_kind = 'approvals'
  ),
  filtered as (
    select * from candidates c
    where (target_owner_id is null or c.owner_id = target_owner_id)
      and (target_status is null or c.status = target_status
        or (target_kind = 'applications' and target_status = 'pending' and c.status in ('submitted','under_review')))
      and (target_from is null or c.at >= (target_from::timestamp at time zone 'Asia/Baghdad'))
      and (target_through is null or c.at < ((target_through + 1)::timestamp at time zone 'Asia/Baghdad'))
      and (query_text = '' or
        (query_uuid is not null and (c.id = query_uuid or
          (target_kind in ('cottages','applications','approvals') and c.owner_id = query_uuid) or
          (target_kind = 'approvals' and c.profile_id = query_uuid))) or
        (query_phone is not null and target_kind in ('customers','owners') and
          regexp_replace(c.verified_phone, '^\+', '') = query_phone and c.masked_phone is not null) or
        (query_uuid is null and query_phone is null and target_kind <> 'customers' and
          strpos(lower(coalesce(c.label,'')), lower(query_text)) > 0))
  ),
  total as (select count(*) value from filtered),
  page as (
    select *, row_number() over (order by at desc, id desc) position
    from filtered
    where after_at is null or (at, id) < (after_at, after_id)
    order by at desc, id desc limit 26
  ),
  page_data as (
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'kind', kind, 'id', id, 'ownerId', owner_id, 'profileId', profile_id,
      'applicationId', application_id, 'label', label, 'status', status,
      'at', at, 'cycleNumber', cycle_number, 'maskedPhone', masked_phone
    )) order by at desc, id desc) filter (where position <= 25), '[]'::jsonb) rows,
      count(*) > 25 has_more,
      max(at) filter (where position = 25) cursor_at,
      (max(id::text) filter (where position = 25))::uuid cursor_id
    from page
  )
  select jsonb_build_object(
    'rows', page_data.rows, 'total', total.value,
    'pendingApplications', pending_counts.applications,
    'pendingApprovals', pending_counts.approvals,
    'nextCursor', case when page_data.has_more then
      jsonb_build_object('at', page_data.cursor_at, 'id', page_data.cursor_id)
      else null end
  ) into result
  from page_data cross join total cross join pending_counts;
  return result;
end;
$$;
ALTER FUNCTION public.search_administrator_records(text,text,text,date,date,uuid,timestamptz,uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_administrator_record(target_kind text, target_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
declare result jsonb;
begin
  if public.is_platform_administrator('aal2') is not true then
    raise exception 'Platform Administrator AAL2 access required' using errcode = '42501';
  end if;
  if target_kind not in ('account','approval') or target_kind is null or target_id is null then
    raise exception 'Invalid administrator record target' using errcode = '22023';
  end if;
  if target_kind = 'account' then
    select jsonb_strip_nulls(jsonb_build_object(
      'kind', 'account', 'id', contexts.user_id, 'marketplaceRole', contexts.role,
      'customerCapability', true, 'ownerApprovalState', contexts.owner_approval_state,
      'createdAt', contexts.created_at, 'applicationId', application.id,
      'maskedPhone', case when users.phone_confirmed_at is not null and users.phone is not null
        then '•••' || right(users.phone, 4) end
    )) into result
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    left join lateral (
      select id from public.owner_applications applications
      where applications.owner_user_id = contexts.user_id and applications.status <> 'draft'
      order by applications.submitted_at desc, applications.id desc limit 1
    ) application on true
    where contexts.user_id = target_id and contexts.role in ('customer','cottage_owner');
  else
    select jsonb_build_object(
      'kind', 'approval', 'id', cycles.id, 'profileId', cycles.profile_id,
      'ownerId', cycles.owner_user_id, 'name', cycles.name,
      'approximateLocation', cycles.approximate_location,
      'state', cycles.state, 'cycleNumber', cycles.cycle_number,
      'createdAt', cycles.created_at, 'decidedAt', cycles.decided_at,
      'publicationDecision', (select jsonb_build_object(
        'approved', decisions.approved, 'reason', decisions.reason,
        'administratorId', decisions.administrator_user_id,
        'decidedAt', decisions.decided_at
      ) from public.cottage_profile_publication_decisions decisions
      where decisions.review_cycle_id = cycles.id),
      'localizedDecisions', coalesce((select jsonb_agg(jsonb_build_object(
        'decisionId', decisions.id, 'locale', decisions.locale, 'revisionId', decisions.localized_revision_id,
        'approved', decisions.approved, 'reason', decisions.reason,
        'administratorId', decisions.administrator_user_id,
        'decidedAt', decisions.decided_at
      ) order by decisions.decided_at, decisions.id)
      from public.cottage_profile_localized_decisions decisions
      where decisions.review_cycle_id = cycles.id), '[]'::jsonb)
    ) into result
    from public.cottage_profile_review_cycles cycles
    where cycles.id = target_id;
  end if;
  return result;
end;
$$;
ALTER FUNCTION public.get_administrator_record(text,uuid) OWNER TO postgres;
