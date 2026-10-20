-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION private.reject_administrator_booking_money_export_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  raise exception 'Administrator money export records are immutable' using errcode='RC409';
end;
$function$;

REVOKE ALL ON FUNCTION private.reject_administrator_booking_money_export_change() FROM PUBLIC;

CREATE TABLE private.administrator_booking_money_exports (
  id                    uuid                     DEFAULT gen_random_uuid() NOT NULL,
  administrator_user_id uuid                     NOT NULL,
  recorded_at           timestamp with time zone NOT NULL,
  filter_state          text,
  filter_from           date,
  filter_through        date,
  booking_request_ids   uuid[]                   NOT NULL
);

ALTER TABLE private.administrator_booking_money_exports
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.administrator_booking_money_exports
  ADD CONSTRAINT administrator_booking_money_exports_dates CHECK (filter_from IS NULL OR filter_through IS NULL OR filter_from <= filter_through);

ALTER TABLE private.administrator_booking_money_exports
  ADD CONSTRAINT administrator_booking_money_exports_ids
    CHECK
    (array_ndims(booking_request_ids) = 1 AND cardinality(booking_request_ids) >= 1 AND cardinality(booking_request_ids) <= 500 AND array_position(booking_request_ids, NULL::uuid)
    IS NULL);

ALTER TABLE private.administrator_booking_money_exports
  ADD CONSTRAINT administrator_booking_money_exports_pkey PRIMARY KEY (id);

ALTER TABLE private.administrator_booking_money_exports
  ADD CONSTRAINT administrator_booking_money_exports_state
    CHECK (filter_state = ANY (ARRAY['confirmed'::text, 'incident_pending'::text, 'completed'::text, 'no_show'::text, 'cancelled'::text]));

CREATE TRIGGER administrator_booking_money_exports_immutable
  BEFORE DELETE OR UPDATE ON private.administrator_booking_money_exports
  FOR EACH ROW
  EXECUTE FUNCTION private.reject_administrator_booking_money_export_change();

CREATE TRIGGER administrator_booking_money_exports_no_truncate
  BEFORE TRUNCATE ON private.administrator_booking_money_exports
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.reject_administrator_booking_money_export_change();

CREATE FUNCTION public.record_administrator_booking_money_export (
  target_state   text,
  target_from    date,
  target_through date
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  selection jsonb;
  export_id uuid;
  recorded_at timestamptz;
begin
  selection:=public.list_administrator_booking_money(target_state,target_from,target_through);
  if selection->>'status'='too_many' then return selection; end if;
  if jsonb_array_length(selection->'bookings')=0 and jsonb_array_length(selection->'missingPaymentEvidence')=0 then
    return jsonb_build_object('status','empty');
  end if;
  insert into private.administrator_booking_money_exports
    (administrator_user_id,recorded_at,filter_state,filter_from,filter_through,booking_request_ids)
  select auth.uid(),statement_timestamp(),target_state,target_from,target_through,
    array_agg(distinct (booking->>'bookingRequestId')::uuid order by (booking->>'bookingRequestId')::uuid)
  from jsonb_array_elements((selection->'bookings')||(selection->'missingPaymentEvidence')) booking
  returning id,administrator_booking_money_exports.recorded_at into export_id,recorded_at;
  return jsonb_build_object('status','recorded','exportId',export_id,
    'recordedAt',to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'),'selection',selection);
end;
$function$;

REVOKE ALL ON FUNCTION public.record_administrator_booking_money_export(text, date, date) FROM PUBLIC;

GRANT ALL ON FUNCTION public.record_administrator_booking_money_export(text, date, date) TO authenticated;
ALTER TABLE private.administrator_booking_money_exports OWNER TO postgres;
ALTER FUNCTION private.reject_administrator_booking_money_export_change() OWNER TO postgres;
ALTER FUNCTION public.record_administrator_booking_money_export(text,date,date) OWNER TO postgres;

REVOKE ALL ON TABLE private.administrator_booking_money_exports FROM PUBLIC,anon,authenticated,service_role;
REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE private.administrator_booking_money_exports FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.reject_administrator_booking_money_export_change(),public.record_administrator_booking_money_export(text,date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_administrator_booking_money_export(text,date,date) TO authenticated;
