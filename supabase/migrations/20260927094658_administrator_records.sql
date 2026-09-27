-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.get_administrator_record (
  target_kind text,
  target_id   uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.get_administrator_record(text, uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_administrator_record(text, uuid) TO authenticated;

CREATE FUNCTION public.search_administrator_records (
  target_kind     text,
  target_query    text,
  target_status   text,
  target_from     date,
  target_through  date,
  target_owner_id uuid,
  after_at        timestamp with time zone,
  after_id        uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.search_administrator_records(text, text, text, date, date, uuid, timestamp WITH time zone, uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.search_administrator_records(text, text, text, date, date, uuid, timestamp WITH time zone, uuid) TO authenticated;
