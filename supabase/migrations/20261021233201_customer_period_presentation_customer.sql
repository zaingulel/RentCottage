-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.get_customer_booking_request_presentation (
  target_reference text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare projection jsonb;
begin
  projection := public.get_customer_booking_request(target_reference);
  if projection is null then return null; end if;
  return projection || jsonb_build_object('periodPresentation', (
    select coalesce(snapshots.period_presentation, 'original-names')
    from public.booking_requests requests
    join public.booking_snapshots snapshots on snapshots.id = requests.booking_snapshot_id
    where requests.booking_request_reference = target_reference
  ));
end;
$function$;

REVOKE ALL ON FUNCTION public.get_customer_booking_request_presentation(text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_customer_booking_request_presentation(text) TO authenticated;

REVOKE ALL ON FUNCTION "public"."get_customer_booking_request_presentation"("target_reference" "text") FROM PUBLIC, "anon", "service_role";
GRANT EXECUTE ON FUNCTION "public"."get_customer_booking_request_presentation"("target_reference" "text") TO "authenticated";
