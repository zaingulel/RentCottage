-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.create_pending_booking_period_hold_without_authorization_claim (
  target_customer_user_id     uuid,
  target_profile_id           uuid,
  target_commitment_reference text,
  requested_search            jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare target_profile public.owner_application_cottage_profiles;
declare target_schedule_revision_id uuid;
declare selection jsonb;
declare resolved_selection jsonb;
declare resolved_selections jsonb := '[]'::jsonb;
declare selection_day date;
declare target_unit_kind public.cottage_inventory_unit_kind;
declare target_unit_id uuid;
declare target_price_iqd bigint;
declare target_start_time time without time zone;
declare target_end_time time without time zone;
declare target_starts_at timestamptz;
declare target_ends_at timestamptz;
declare access_ranges tstzmultirange := '{}'::tstzmultirange;
declare target_access_range tstzrange;
declare booking_period_commitment_id uuid := gen_random_uuid();
declare booking_price_iqd bigint := 0;
declare selected_item_count integer := 0;
declare occupied_shift_count integer := 0;
declare inserted_occupancy_count integer;
begin
  if target_customer_user_id is null
    or target_profile_id is null
    or target_commitment_reference is null
    or target_commitment_reference <> btrim(target_commitment_reference)
    or target_commitment_reference !~ '^[A-Z0-9][A-Z0-9-]{0,119}$' then
    raise exception 'Pending Hold input is invalid' using errcode = '22023';
  end if;
  perform public.validate_public_cottage_search(requested_search);
  if not exists (
    select 1
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    where contexts.user_id = target_customer_user_id
      and contexts.role in ('customer'::public.account_role, 'cottage_owner'::public.account_role)
      and users.phone_confirmed_at is not null
  ) then
    raise exception 'A verified Customer is required' using errcode = '42501';
  end if;

  select * into target_profile
  from public.owner_application_cottage_profiles profiles
  where profiles.id = target_profile_id
  for update;
  if not found then
    raise exception 'Published Cottage was not found' using errcode = 'RC404';
  end if;
  if target_profile.owner_user_id = target_customer_user_id then
    raise exception 'Self booking is not allowed; use owner availability controls' using errcode = 'RC422';
  end if;
  target_schedule_revision_id := target_profile.current_shift_schedule_id;
  if target_schedule_revision_id is null
    or not public.is_cottage_publicly_discoverable(target_profile_id)
    or not exists (
      select 1
      from public.cottage_publication_snapshots publications
      where publications.id = target_profile.current_publication_id
        and publications.profile_id = target_profile.id
        and publications.capacity >= (requested_search ->> 'guests')::integer
        and (not requested_search ? 'governorate'
          or lower(publications.governorate) = lower(btrim(requested_search ->> 'governorate')))
        and (not requested_search ? 'area'
          or lower(publications.approximate_location) = lower(btrim(requested_search ->> 'area')))
        and array(
          select value
          from jsonb_array_elements_text(
            coalesce(requested_search -> 'amenities', '[]'::jsonb)
          ) values(value)
        ) <@ publications.amenities
    ) then
    raise exception 'Pending Hold selection is unavailable' using errcode = 'RC409';
  end if;

  for selection in
    select value
    from jsonb_array_elements(requested_search -> 'selections') selections(value)
    order by value ->> 'serviceDay', coalesce((value ->> 'position')::integer, 32767)
  loop
    selection_day := (selection ->> 'serviceDay')::date;
    if selection ->> 'kind' = 'shift' then
      target_unit_kind := 'shift'::public.cottage_inventory_unit_kind;
      select shifts.id, shifts.start_time, shifts.end_time
        into target_unit_id, target_start_time, target_end_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id
        and shifts.position = (selection ->> 'position')::smallint;
    else
      target_unit_kind := 'full_day_bundle'::public.cottage_inventory_unit_kind;
      select schedules.full_day_bundle_id,
        (select shifts.start_time from public.cottage_shifts shifts
          where shifts.schedule_revision_id = schedules.id
          order by shifts.position limit 1),
        (select shifts.end_time from public.cottage_shifts shifts
          where shifts.schedule_revision_id = schedules.id
          order by shifts.position desc limit 1)
        into target_unit_id, target_start_time, target_end_time
      from public.cottage_shift_schedule_revisions schedules
      where schedules.id = target_schedule_revision_id;
    end if;
    target_price_iqd := public.public_cottage_effective_price(
      target_schedule_revision_id,
      target_unit_kind,
      target_unit_id,
      selection_day
    );
    if target_unit_id is null
      or target_price_iqd is null
      or not coalesce(public.public_cottage_unit_is_available(
        target_schedule_revision_id,
        target_unit_kind,
        target_unit_id,
        selection_day
      ), false) then
      raise exception 'Pending Hold selection is unavailable' using errcode = 'RC409';
    end if;

    target_starts_at := (selection_day + target_start_time) at time zone 'Asia/Baghdad';
    target_ends_at := (
      selection_day + target_end_time
      + case when target_end_time < target_start_time
          or (target_unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
            and target_end_time = target_start_time)
        then interval '1 day' else interval '0 days' end
    ) at time zone 'Asia/Baghdad';
    if target_unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      and exists (
        select 1
        from jsonb_array_elements(requested_search -> 'selections') next_selection(value)
        where value ->> 'kind' = 'full-day'
          and (value ->> 'serviceDay')::date = selection_day + 1
      ) then
      target_ends_at := (
        selection_day + 1 + target_start_time
      ) at time zone 'Asia/Baghdad';
    end if;
    target_access_range := tstzrange(target_starts_at, target_ends_at, '[)');
    access_ranges := access_ranges + tstzmultirange(target_access_range);
    resolved_selections := resolved_selections || jsonb_build_array(jsonb_build_object(
      'serviceDay', selection_day,
      'unitKind', target_unit_kind,
      'unitId', target_unit_id,
      'priceIqd', target_price_iqd
    ));
    booking_price_iqd := booking_price_iqd + target_price_iqd;
    selected_item_count := selected_item_count + 1;
  end loop;

  begin
    insert into public.cottage_booking_period_commitments (
      id, customer_user_id, profile_id, schedule_revision_id,
      commitment_reference, status, access_ranges
    ) values (
      booking_period_commitment_id,
      target_customer_user_id,
      target_profile_id,
      target_schedule_revision_id,
      target_commitment_reference,
      'pending_hold',
      access_ranges
    );
  exception when exclusion_violation then
    raise exception 'The Customer already has an overlapping active Booking Period'
      using errcode = 'RC409';
  end;

  for resolved_selection in
    select value
    from jsonb_array_elements(resolved_selections) selections(value)
  loop
    selection_day := (resolved_selection ->> 'serviceDay')::date;
    target_unit_kind :=
      (resolved_selection ->> 'unitKind')::public.cottage_inventory_unit_kind;
    target_unit_id := (resolved_selection ->> 'unitId')::uuid;
    target_price_iqd := (resolved_selection ->> 'priceIqd')::bigint;
    insert into public.cottage_inventory_commitments (
      booking_period_commitment_id, unit_kind, unit_id,
      service_day, committed_price_iqd
    ) values (
      booking_period_commitment_id, target_unit_kind, target_unit_id,
      selection_day, target_price_iqd
    );
    begin
      if target_unit_kind = 'shift'::public.cottage_inventory_unit_kind then
        insert into public.cottage_booking_period_occupancies (
          booking_period_commitment_id, schedule_revision_id, shift_id, service_day
        ) values (
          booking_period_commitment_id, target_schedule_revision_id,
          target_unit_id, selection_day
        );
        occupied_shift_count := occupied_shift_count + 1;
      else
        insert into public.cottage_booking_period_occupancies (
          booking_period_commitment_id, schedule_revision_id, shift_id, service_day
        )
        select booking_period_commitment_id, target_schedule_revision_id,
          shifts.id, selection_day
        from public.cottage_shifts shifts
        where shifts.schedule_revision_id = target_schedule_revision_id
        order by shifts.position;
        get diagnostics inserted_occupancy_count = row_count;
        occupied_shift_count := occupied_shift_count + inserted_occupancy_count;
      end if;
    exception when unique_violation then
      raise exception 'Pending Hold selection is unavailable' using errcode = 'RC409';
    end;
  end loop;

  return jsonb_build_object(
    'bookingPeriodCommitmentId', booking_period_commitment_id,
    'commitmentReference', target_commitment_reference,
    'status', 'pending_hold',
    'bookingPriceIqd', booking_price_iqd,
    'selectedItemCount', selected_item_count,
    'occupiedShiftCount', occupied_shift_count
  );
end;
$function$;