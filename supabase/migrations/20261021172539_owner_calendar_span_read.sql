-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.resolve_cottage_inventory_owner_calendar_span (
  target_profile_id           uuid,
  target_schedule_revision_id uuid,
  target_from                 date,
  target_to                   date
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare profile public.owner_application_cottage_profiles;
declare unit_keys jsonb;
declare unit_count integer;
declare distinct_unit_count integer;
declare invalid_facts boolean;
declare resolved_days jsonb;
declare observed_at timestamptz := statement_timestamp();
begin
  select * into profile from public.owner_application_cottage_profiles
  where id = target_profile_id;
  if not found or profile.owner_user_id is distinct from (select auth.uid())
    or not exists (
      select 1 from public.account_contexts contexts
      where contexts.user_id = (select auth.uid()) and contexts.role = 'cottage_owner'
        and contexts.owner_approval_state in ('approved', 'expired', 'suspended')
    ) then
    raise exception 'Cottage Profile access is denied' using errcode = '42501';
  end if;
  if target_from is null or target_to is null
    or not isfinite(target_from) or not isfinite(target_to)
    or target_from < date '0001-01-01' or target_to > date '9999-12-31'
    or target_to < target_from or target_to - target_from > 30 then
    raise exception 'Owner Calendar span must contain 1 to 31 Gregorian days' using errcode = '22023';
  end if;
  if profile.current_shift_schedule_id is distinct from target_schedule_revision_id
    or target_schedule_revision_id is null then
    raise exception 'The Shift Schedule revision is no longer current' using errcode = 'RC409';
  end if;
  if not exists (
    select 1 from public.cottage_shift_schedule_revisions revisions
    where revisions.id = target_schedule_revision_id and revisions.profile_id = target_profile_id
  ) then
    raise exception 'Owner Calendar revision is invalid' using errcode = 'RC204';
  end if;
  select jsonb_agg(jsonb_build_object('id', id, 'kind', kind) order by position),
    count(*), count(distinct id)
    into unit_keys, unit_count, distinct_unit_count
  from (
    select shifts.id, 'shift'::text as kind, shifts.position::integer as position
    from public.cottage_shifts shifts where shifts.schedule_revision_id = target_schedule_revision_id
    union all
    select revisions.full_day_bundle_id, 'full_day_bundle', 32767
    from public.cottage_shift_schedule_revisions revisions where revisions.id = target_schedule_revision_id
  ) revision_units;
  if unit_count not in (3, 4) or distinct_unit_count <> unit_count
    or (select array_agg(shifts.position::integer order by shifts.position)
      from public.cottage_shifts shifts where shifts.schedule_revision_id = target_schedule_revision_id)
      <> (case unit_count when 3 then array[1, 2] else array[1, 2, 3] end) then
    raise exception 'Owner Calendar units are invalid' using errcode = 'RC204';
  end if;

  with units as (
    select (entry ->> 'id')::uuid as unit_id,
      (entry ->> 'kind')::public.cottage_inventory_unit_kind as unit_kind, position
    from jsonb_array_elements(unit_keys) with ordinality keys(entry, position)
  ), cells as (
    select target_from + offset_day as service_day, units.*
    from generate_series(0, target_to - target_from) offset_day cross join units
  ), facts as (
    select cells.*,
      coalesce(availability.state, 'closed'::public.cottage_inventory_availability_state) as owner_state,
      direct.id as direct_id, direct.status as direct_status, direct.commitment_reference as direct_reference,
      inherited.id as inherited_id, inherited.status as inherited_status, inherited.commitment_reference as inherited_reference,
      component.id as component_id,
      coalesce(direct.committed_price_iqd, inherited.committed_price_iqd, component.committed_price_iqd,
        public.public_cottage_effective_price(target_schedule_revision_id, cells.unit_kind, cells.unit_id, cells.service_day)) as price_iqd,
      public.booking_request_active_claim_conflicts_unit(
        target_schedule_revision_id, cells.unit_kind, cells.unit_id, cells.service_day) as temporarily_unavailable,
      cells.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind and exists (
        select 1 from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
          and not public.cottage_inventory_component_is_effectively_available(
            target_schedule_revision_id, shifts.id, cells.service_day)
      ) as component_unavailable,
      (direct.id is not null and (direct.status not in ('pending_hold', 'confirmed_booking')
        or direct.committed_price_iqd is null or coalesce(btrim(direct.commitment_reference), '') = ''))
      or (inherited.id is not null and (inherited.status not in ('pending_hold', 'confirmed_booking')
        or inherited.committed_price_iqd is null or coalesce(btrim(inherited.commitment_reference), '') = ''))
      or (component.id is not null and (component.status not in ('pending_hold', 'confirmed_booking')
        or component.committed_price_iqd is null or coalesce(btrim(component.commitment_reference), '') = '')) as invalid
    from cells
    left join public.cottage_inventory_availability availability
      on availability.schedule_revision_id = target_schedule_revision_id
      and availability.unit_kind = cells.unit_kind and availability.unit_id = cells.unit_id
      and availability.service_day = cells.service_day
    left join lateral (
      select selected.id, selected.committed_price_iqd, periods.status::text as status, periods.commitment_reference
      from public.cottage_inventory_commitments selected
      join public.cottage_booking_period_commitments periods on periods.id = selected.booking_period_commitment_id
      join public.cottage_booking_period_occupancies occupancies
        on occupancies.booking_period_commitment_id = periods.id
        and occupancies.schedule_revision_id = periods.schedule_revision_id
        and occupancies.service_day = selected.service_day and occupancies.active
        and (selected.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind or occupancies.shift_id = selected.unit_id)
      where periods.schedule_revision_id = target_schedule_revision_id
        and selected.unit_kind = cells.unit_kind and selected.unit_id = cells.unit_id
        and selected.service_day = cells.service_day
      order by selected.created_at, selected.id limit 1
    ) direct on true
    left join lateral (
      select selected.id, selected.committed_price_iqd, periods.status::text as status, periods.commitment_reference
      from public.cottage_booking_period_occupancies occupancies
      join public.cottage_booking_period_commitments periods on periods.id = occupancies.booking_period_commitment_id
      join public.cottage_inventory_commitments selected on selected.booking_period_commitment_id = periods.id
        and selected.service_day = occupancies.service_day and selected.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      where cells.unit_kind = 'shift'::public.cottage_inventory_unit_kind and direct.id is null
        and occupancies.schedule_revision_id = target_schedule_revision_id
        and occupancies.shift_id = cells.unit_id and occupancies.service_day = cells.service_day and occupancies.active
      limit 1
    ) inherited on true
    left join lateral (
      select selected.id, selected.committed_price_iqd, periods.status::text as status, periods.commitment_reference
      from public.cottage_booking_period_occupancies occupancies
      join public.cottage_booking_period_commitments periods on periods.id = occupancies.booking_period_commitment_id
      join public.cottage_inventory_commitments selected on selected.booking_period_commitment_id = periods.id
        and selected.service_day = occupancies.service_day and selected.unit_kind = 'shift'::public.cottage_inventory_unit_kind
        and selected.unit_id = occupancies.shift_id
      where cells.unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind and direct.id is null
        and occupancies.schedule_revision_id = target_schedule_revision_id
        and occupancies.service_day = cells.service_day and occupancies.active
      order by selected.created_at, selected.id limit 1
    ) component on true
  ), day_projection as (
    select service_day, bool_or(invalid) as invalid,
      jsonb_agg(jsonb_build_object('id', unit_id, 'kind', unit_kind, 'ownerState', owner_state,
        'priceIqd', price_iqd,
        'calendarState', case when temporarily_unavailable then null
          when direct_id is not null then direct_status
          when inherited_id is not null then inherited_status
          when component_id is not null then 'component_unavailable' else owner_state::text end,
        'commitmentReference', case when temporarily_unavailable then null
          when direct_id is not null then direct_reference
          when inherited_id is not null then inherited_reference else null end,
        'available', not temporarily_unavailable and direct_id is null and inherited_id is null and component_id is null
          and not component_unavailable and owner_state = 'open'::public.cottage_inventory_availability_state and price_iqd is not null,
        'editable', not temporarily_unavailable and direct_id is null and inherited_id is null and component_id is null,
        'temporarilyUnavailable', temporarily_unavailable
      ) order by position) as units
    from facts group by service_day
  )
  select jsonb_agg(jsonb_build_object('serviceDay', service_day, 'units', units) order by service_day), bool_or(invalid)
    into resolved_days, invalid_facts
  from day_projection;
  if invalid_facts then
    raise exception 'Owner Calendar commitment is invalid' using errcode = 'RC204';
  end if;
  return jsonb_build_object('profileId', target_profile_id, 'scheduleRevisionId', target_schedule_revision_id,
    'from', target_from, 'to', target_to, 'asOf', observed_at, 'unitKeys', unit_keys, 'days', resolved_days);
end;
$function$;

REVOKE ALL ON FUNCTION public.resolve_cottage_inventory_owner_calendar_span(uuid, uuid, date, date) FROM PUBLIC;

GRANT ALL ON FUNCTION public.resolve_cottage_inventory_owner_calendar_span(uuid, uuid, date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_cottage_inventory_owner_calendar_span(uuid, uuid, date, date) FROM anon, service_role;
