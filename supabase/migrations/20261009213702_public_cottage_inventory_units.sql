-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.public_cottage_inventory_units (
  target_schedule_revision_id uuid,
  from_day                    date,
  to_day                      date
)
  RETURNS TABLE (
    service_day   date,
    unit_kind     public.cottage_inventory_unit_kind,
    unit_position smallint,
    name          text,
    start_time    time without time zone,
    end_time      time without time zone,
    price_iqd     bigint,
    available     boolean
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  with shifts as (
    select shifts.id, shifts.position, shifts.name, shifts.start_time, shifts.end_time
    from public.cottage_shifts shifts
    where shifts.schedule_revision_id = target_schedule_revision_id
  ), units as (
    select shifts.id as unit_id,
      'shift'::public.cottage_inventory_unit_kind as unit_kind,
      shifts.position as unit_position, shifts.name, shifts.start_time, shifts.end_time
    from shifts
    union all
    select schedules.full_day_bundle_id,
      'full_day_bundle'::public.cottage_inventory_unit_kind,
      null::smallint, 'Full-day bundle'::text,
      (select shifts.start_time from shifts order by shifts.position limit 1),
      (select shifts.end_time from shifts order by shifts.position desc limit 1)
    from public.cottage_shift_schedule_revisions schedules
    where schedules.id = target_schedule_revision_id
  ), unit_days as (
    select days.service_day, units.unit_kind, units.unit_position, units.name,
      units.start_time, units.end_time,
      coalesce(date_prices.price_iqd, weekday_prices.price_iqd, standard_prices.price_iqd) as price_iqd,
      -- Every occupancy names a shift of its schedule, so the bundle's occupancy rule is its shifts all being free.
      coalesce(date_prices.price_iqd, weekday_prices.price_iqd, standard_prices.price_iqd) is not null
        and availability.unit_id is not null
        and not exists (
          select 1 from public.cottage_booking_period_occupancies occupancies
          where occupancies.schedule_revision_id = target_schedule_revision_id
            and occupancies.shift_id = units.unit_id
            and occupancies.service_day = days.service_day
            and occupancies.active
        )
        and not exists (
          select 1 from public.booking_request_authorization_claim_occupancies occupancies
          where occupancies.schedule_revision_id = target_schedule_revision_id
            and occupancies.shift_id = units.unit_id
            and occupancies.service_day = days.service_day
            and occupancies.active
        ) as free
    from (
      select days.service_day::date as service_day
      from generate_series(from_day::timestamp, to_day::timestamp, interval '1 day') days(service_day)
    ) days
    cross join units
    left join public.cottage_inventory_date_price_overrides date_prices
      on date_prices.schedule_revision_id = target_schedule_revision_id
      and date_prices.unit_kind = units.unit_kind and date_prices.unit_id = units.unit_id
      and date_prices.service_day = days.service_day
    left join public.cottage_inventory_weekday_price_overrides weekday_prices
      on weekday_prices.schedule_revision_id = target_schedule_revision_id
      and weekday_prices.unit_kind = units.unit_kind and weekday_prices.unit_id = units.unit_id
      and weekday_prices.weekday = extract(dow from days.service_day)::smallint
    left join public.cottage_inventory_standard_prices standard_prices
      on standard_prices.schedule_revision_id = target_schedule_revision_id
      and standard_prices.unit_kind = units.unit_kind and standard_prices.unit_id = units.unit_id
    left join public.cottage_inventory_availability availability
      on availability.schedule_revision_id = target_schedule_revision_id
      and availability.unit_kind = units.unit_kind and availability.unit_id = units.unit_id
      and availability.service_day = days.service_day
      and availability.state = 'open'::public.cottage_inventory_availability_state
  )
  select unit_days.service_day, unit_days.unit_kind, unit_days.unit_position, unit_days.name,
    unit_days.start_time, unit_days.end_time, unit_days.price_iqd,
    coalesce(
      unit_days.free
      and (
        unit_days.unit_kind = 'shift'::public.cottage_inventory_unit_kind
        or bool_and(unit_days.free)
          filter (where unit_days.unit_kind = 'shift'::public.cottage_inventory_unit_kind)
          over (partition by unit_days.service_day)
      )
      and ((unit_days.service_day + unit_days.start_time) at time zone 'Asia/Baghdad') > now(),
      false
    )
  from unit_days;
$function$;

REVOKE ALL ON FUNCTION public.public_cottage_inventory_units(uuid, date, date) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.public_cottage_inventory_units(uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;
