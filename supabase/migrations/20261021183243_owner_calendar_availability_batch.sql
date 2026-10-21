-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.set_cottage_inventory_availability_batch (
  target_profile_id           uuid,
  target_schedule_revision_id uuid,
  requested_batch             jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare profile public.owner_application_cottage_profiles;
declare first_day date;
declare last_day date;
declare target_state text;
declare item jsonb;
declare coord jsonb;
declare request jsonb;
declare keys jsonb := '[]';
declare cells jsonb := '[]';
declare consent jsonb := '[]';
declare conflicts jsonb := '[]';
declare candidates jsonb := '[]';
declare eligible jsonb;
declare changed jsonb;
declare unchanged jsonb;
declare calendar jsonb;
declare current_unit jsonb;
declare current_day jsonb;
declare bundle jsonb;
declare component jsonb;
declare cell_day date;
declare unit_start time;
declare reason text;
declare reference text;
declare proposed_state text;
declare proposed_bundle text;
declare invalid_components boolean;
declare day_changed boolean;
declare day_row record;
begin
  perform public.lock_cottage_inventory_profiles(array[target_profile_id]);
  select * into profile from public.owner_application_cottage_profiles where id = target_profile_id;
  if not found or profile.owner_user_id is distinct from (select auth.uid()) or not exists (
    select 1 from public.account_contexts contexts where contexts.user_id = (select auth.uid())
      and contexts.role = 'cottage_owner' and contexts.owner_approval_state = 'approved'
  ) then raise exception 'Approved Cottage Owner access is required' using errcode = '42501'; end if;
  if profile.status = 'abandoned' then raise exception 'An abandoned Cottage Profile is read-only' using errcode = 'RC202'; end if;
  if target_schedule_revision_id is null or profile.current_shift_schedule_id is distinct from target_schedule_revision_id then
    raise exception 'The Shift Schedule revision is no longer current' using errcode = 'RC409';
  end if;
  begin
    if jsonb_typeof(requested_batch) is distinct from 'object' then
      raise exception 'Batch input is invalid' using errcode = '22023';
    end if;
    if (select count(*) from jsonb_object_keys(requested_batch)) <> 8
      or not requested_batch ?& array['from','to','unitKeys','state','mode','cells','replacePrivateBlocks','reviewConfirmed']
      or jsonb_typeof(requested_batch -> 'from') is distinct from 'string'
      or jsonb_typeof(requested_batch -> 'to') is distinct from 'string'
      or (requested_batch ->> 'from') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (requested_batch ->> 'to') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(requested_batch ->> 'state', '') not in ('open','closed','private_blocked')
      or coalesce(requested_batch ->> 'mode', '') not in ('range','reviewed')
      or jsonb_typeof(requested_batch -> 'reviewConfirmed') is distinct from 'boolean'
      or (requested_batch ->> 'reviewConfirmed')::boolean <> (requested_batch ->> 'mode' = 'reviewed')
      or jsonb_typeof(requested_batch -> 'unitKeys') is distinct from 'array'
      or jsonb_typeof(requested_batch -> 'cells') is distinct from 'array'
      or jsonb_typeof(requested_batch -> 'replacePrivateBlocks') is distinct from 'array' then
      raise exception 'Batch input is invalid' using errcode = '22023';
    end if;
    first_day := (requested_batch ->> 'from')::date; last_day := (requested_batch ->> 'to')::date;
    target_state := requested_batch ->> 'state';
    if first_day < date '0001-01-01' or last_day > date '9999-12-31' or last_day < first_day or last_day - first_day > 30
      or jsonb_array_length(requested_batch -> 'unitKeys') not between 1 and 4
      or jsonb_array_length(requested_batch -> 'cells') not between 1 and 124
      or jsonb_array_length(requested_batch -> 'replacePrivateBlocks') > 124 then
      raise exception 'Batch input is invalid' using errcode = '22023';
    end if;
    for item in select value from jsonb_array_elements(requested_batch -> 'unitKeys') loop
      if jsonb_typeof(item) is distinct from 'object' then raise exception 'Batch unit is invalid' using errcode = '22023'; end if;
      if (select count(*) from jsonb_object_keys(item)) <> 2 or not item ?& array['id','kind']
        or coalesce(item ->> 'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(item ->> 'kind','') not in ('shift','full_day_bundle') then
        raise exception 'Batch unit is invalid' using errcode = '22023';
      end if;
      coord := jsonb_build_object('id', (item ->> 'id')::uuid, 'kind', item ->> 'kind');
      if keys @> jsonb_build_array(coord) then raise exception 'Duplicate batch unit' using errcode = '22023'; end if;
      keys := keys || jsonb_build_array(coord);
    end loop;
    for item in select value from jsonb_array_elements(requested_batch -> 'cells') loop
      if jsonb_typeof(item) is distinct from 'object' then raise exception 'Batch cell is invalid' using errcode = '22023'; end if;
      if (select count(*) from jsonb_object_keys(item)) <> 4 or not item ?& array['serviceDay','id','kind','expectedOwnerState']
        or coalesce(item ->> 'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(item ->> 'kind','') not in ('shift','full_day_bundle')
        or coalesce(item ->> 'expectedOwnerState','') not in ('open','closed','private_blocked')
        or coalesce(item ->> 'serviceDay','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Batch cell is invalid' using errcode = '22023';
      end if;
      cell_day := (item ->> 'serviceDay')::date;
      coord := jsonb_build_object('serviceDay', cell_day, 'id', (item ->> 'id')::uuid, 'kind', item ->> 'kind');
      if cell_day < first_day or cell_day > last_day
        or not keys @> jsonb_build_array(coord - 'serviceDay') or cells @> jsonb_build_array(coord) then
        raise exception 'Batch cell is outside scope or duplicated' using errcode = '22023';
      end if;
      cells := cells || jsonb_build_array(coord || jsonb_build_object('expectedOwnerState', item ->> 'expectedOwnerState'));
    end loop;
    if (requested_batch ->> 'mode' = 'range' and jsonb_array_length(cells) <> (last_day - first_day + 1) * jsonb_array_length(keys))
      or (requested_batch ->> 'mode' = 'reviewed' and jsonb_array_length(cells) >= (last_day - first_day + 1) * jsonb_array_length(keys)) then
      raise exception 'Batch selection does not match its review mode' using errcode = '22023';
    end if;
    for item in select value from jsonb_array_elements(requested_batch -> 'replacePrivateBlocks') loop
      if jsonb_typeof(item) is distinct from 'object' then raise exception 'Batch consent is invalid' using errcode = '22023'; end if;
      if (select count(*) from jsonb_object_keys(item)) <> 3 or not item ?& array['serviceDay','id','kind']
        or coalesce(item ->> 'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(item ->> 'kind','') not in ('shift','full_day_bundle')
        or coalesce(item ->> 'serviceDay','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Batch consent is invalid' using errcode = '22023';
      end if;
      coord := jsonb_build_object('serviceDay', (item ->> 'serviceDay')::date, 'id', (item ->> 'id')::uuid, 'kind', item ->> 'kind');
      if target_state = 'private_blocked' or consent @> jsonb_build_array(coord)
        or not cells @> jsonb_build_array(coord || '{"expectedOwnerState":"private_blocked"}'::jsonb) then
        raise exception 'Batch consent does not match an included Private Block' using errcode = '22023';
      end if;
      consent := consent || jsonb_build_array(coord);
    end loop;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise exception 'Batch input is invalid' using errcode = '22023';
  end;
  select jsonb_agg(value order by value ->> 'kind' collate "C", value ->> 'id' collate "C") into keys from jsonb_array_elements(keys);
  select jsonb_agg(value order by value ->> 'serviceDay' collate "C", value ->> 'kind' collate "C", value ->> 'id' collate "C") into cells from jsonb_array_elements(cells);
  select coalesce(jsonb_agg(value order by value ->> 'serviceDay' collate "C", value ->> 'kind' collate "C", value ->> 'id' collate "C"), '[]') into consent from jsonb_array_elements(consent);
  request := jsonb_build_object('from', first_day, 'to', last_day, 'unitKeys', keys, 'state', target_state,
    'mode', requested_batch -> 'mode', 'cells', cells, 'replacePrivateBlocks', consent, 'reviewConfirmed', requested_batch -> 'reviewConfirmed');
  calendar := public.resolve_cottage_inventory_owner_calendar_span(target_profile_id, target_schedule_revision_id, first_day, last_day);
  if exists (select 1 from jsonb_array_elements(keys) k where not (calendar -> 'unitKeys') @> jsonb_build_array(k)) then
    raise exception 'Batch unit is not part of the current revision' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(cells) loop
    coord := item - 'expectedOwnerState'; reason := null; reference := null;
    select u into current_unit from jsonb_array_elements(calendar -> 'days') d
      cross join lateral jsonb_array_elements(d -> 'units') u
      where d ->> 'serviceDay' = item ->> 'serviceDay' and u ->> 'id' = item ->> 'id' and u ->> 'kind' = item ->> 'kind';
    if (current_unit ->> 'temporarilyUnavailable')::boolean then reason := 'temporary_unavailable';
    elsif current_unit ->> 'calendarState' in ('pending_hold','confirmed_booking','component_unavailable') then
      reason := current_unit ->> 'calendarState';
      if reason in ('pending_hold','confirmed_booking') then reference := current_unit ->> 'commitmentReference'; end if;
    elsif current_unit ->> 'ownerState' <> item ->> 'expectedOwnerState' then reason := 'stale_state';
    elsif current_unit ->> 'ownerState' = 'private_blocked' and target_state <> 'private_blocked' and not consent @> jsonb_build_array(coord) then
      reason := 'private_block_consent_required';
    elsif current_unit ->> 'ownerState' <> target_state then
      if item ->> 'kind' = 'shift' then
        select start_time into unit_start from public.cottage_shifts where schedule_revision_id = target_schedule_revision_id and id = (item ->> 'id')::uuid;
      else
        select start_time into unit_start from public.cottage_shifts where schedule_revision_id = target_schedule_revision_id order by position limit 1;
      end if;
      if (((item ->> 'serviceDay')::date + unit_start) at time zone 'Asia/Baghdad') <= now() then reason := 'started';
      elsif target_state = 'open' and profile.current_publication_id is null then reason := 'publication_required'; end if;
    end if;
    if reason is null then candidates := candidates || jsonb_build_array(item);
    else conflicts := conflicts || jsonb_build_array(coord || jsonb_build_object('reason', reason, 'commitmentReference', reference)); end if;
  end loop;
  for current_day in select value from jsonb_array_elements(calendar -> 'days') loop
    select exists (select 1 from jsonb_array_elements(candidates) c
      where c ->> 'serviceDay' = current_day ->> 'serviceDay' and c ->> 'expectedOwnerState' <> target_state) into day_changed;
    if not day_changed then continue; end if;
    select u into bundle from jsonb_array_elements(current_day -> 'units') u where u ->> 'kind' = 'full_day_bundle';
    proposed_bundle := case when candidates @> jsonb_build_array(jsonb_build_object('serviceDay', current_day -> 'serviceDay', 'id', bundle -> 'id', 'kind', 'full_day_bundle'))
      then target_state else bundle ->> 'ownerState' end;
    if proposed_bundle <> 'open' or exists (select 1 from public.cottage_booking_period_occupancies o
      where o.schedule_revision_id = target_schedule_revision_id and o.service_day = (current_day ->> 'serviceDay')::date and o.active) then continue; end if;
    invalid_components := false;
    for component in select u from jsonb_array_elements(current_day -> 'units') u where u ->> 'kind' = 'shift' loop
      proposed_state := case when candidates @> jsonb_build_array(jsonb_build_object('serviceDay', current_day -> 'serviceDay', 'id', component -> 'id', 'kind', 'shift'))
        then target_state else component ->> 'ownerState' end;
      if proposed_state <> 'open' or component -> 'priceIqd' = 'null'::jsonb
        or public.booking_request_active_claim_conflicts_unit(target_schedule_revision_id, 'shift', (component ->> 'id')::uuid, (current_day ->> 'serviceDay')::date) then
        invalid_components := true;
      end if;
    end loop;
    if invalid_components then
      if target_state = 'open' and bundle ->> 'ownerState' <> 'open' then
        conflicts := conflicts || jsonb_build_array(jsonb_build_object('serviceDay', current_day -> 'serviceDay',
          'id', bundle -> 'id', 'kind', 'full_day_bundle', 'reason', 'bundle_components_unavailable', 'commitmentReference', null));
      else
        select conflicts || jsonb_agg((c - 'expectedOwnerState') || jsonb_build_object('reason', 'open_bundle_dependency', 'commitmentReference', null)
          order by c ->> 'kind' collate "C", c ->> 'id' collate "C") into conflicts
        from jsonb_array_elements(candidates) c where c ->> 'serviceDay' = current_day ->> 'serviceDay' and c ->> 'expectedOwnerState' <> target_state;
      end if;
    end if;
  end loop;
  select coalesce(jsonb_agg(c order by c ->> 'serviceDay' collate "C", c ->> 'kind' collate "C", c ->> 'id' collate "C"), '[]') into eligible
    from jsonb_array_elements(cells) c where not exists (select 1 from jsonb_array_elements(conflicts) f where (f - array['reason','commitmentReference']) = (c - 'expectedOwnerState'));
  if jsonb_array_length(conflicts) > 0 then
    select jsonb_agg(c order by c ->> 'serviceDay' collate "C", c ->> 'kind' collate "C", c ->> 'id' collate "C") into conflicts from jsonb_array_elements(conflicts) c;
    return jsonb_build_object('status', 'refused', 'profileId', target_profile_id, 'scheduleRevisionId', target_schedule_revision_id,
      'request', request, 'conflicts', conflicts, 'eligible', eligible, 'calendar', calendar);
  end if;
  select coalesce(jsonb_agg(c - 'expectedOwnerState' order by c ->> 'serviceDay' collate "C", c ->> 'kind' collate "C", c ->> 'id' collate "C") filter (where c ->> 'expectedOwnerState' <> target_state), '[]'),
    coalesce(jsonb_agg(c - 'expectedOwnerState' order by c ->> 'serviceDay' collate "C", c ->> 'kind' collate "C", c ->> 'id' collate "C") filter (where c ->> 'expectedOwnerState' = target_state), '[]')
    into changed, unchanged from jsonb_array_elements(cells) c;
  for day_row in select (c ->> 'serviceDay') collate "C" as service_day,
    jsonb_agg(jsonb_build_object('unitId', c -> 'id', 'unitKind', c -> 'kind', 'state', target_state) order by c ->> 'kind' collate "C", c ->> 'id' collate "C") as states
    from jsonb_array_elements(changed) c group by (c ->> 'serviceDay') collate "C" order by (c ->> 'serviceDay') collate "C"
  loop
    perform public.set_cottage_inventory_availability(target_profile_id, target_schedule_revision_id, day_row.service_day::date, day_row.states);
  end loop;
  return jsonb_build_object('status', 'saved', 'profileId', target_profile_id, 'scheduleRevisionId', target_schedule_revision_id,
    'request', request, 'changed', changed, 'unchanged', unchanged);
end;
$function$;

REVOKE ALL ON FUNCTION public.set_cottage_inventory_availability_batch(uuid, uuid, jsonb) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.set_cottage_inventory_availability_batch(uuid, uuid, jsonb) TO authenticated;