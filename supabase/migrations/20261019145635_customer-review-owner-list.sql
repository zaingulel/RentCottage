-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.list_owner_customer_reviews (
  target_before_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  target_before_id uuid                     DEFAULT NULL::uuid,
  target_limit     integer                  DEFAULT 20
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor uuid:=(select auth.uid());
  actor_context public.account_contexts;
  entry record;
  items jsonb:='[]'::jsonb;
  next_cursor jsonb:=null;
  last_cursor jsonb;
begin
  select * into actor_context from public.account_contexts where user_id=actor;
  if actor is null
    or actor_context.role is distinct from 'cottage_owner'
    or actor_context.owner_approval_state is distinct from 'approved'
    or not exists(select 1 from auth.users users
      where users.id=actor and users.phone_confirmed_at is not null)
  then
    raise exception 'Customer review reply access is unavailable' using errcode='42501';
  end if;
  if (target_before_at is null) <> (target_before_id is null)
    or target_limit is null or target_limit < 1 or target_limit > 50
  then
    raise exception 'Customer review cursor is invalid' using errcode='22023';
  end if;

  for entry in
    select reviews.id,reviews.submitted_at,requests.booking_request_reference,
      snapshots.quote_payload->'cottageName' cottage_name
    from public.customer_reviews reviews
    join public.booking_requests requests
      on requests.id=reviews.booking_request_id and requests.profile_id=reviews.profile_id
    join public.owner_application_cottage_profiles profiles
      on profiles.id=requests.profile_id and profiles.owner_user_id=requests.owner_user_id
    join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id
    where requests.owner_user_id=actor
      and (target_before_at is null
        or (reviews.submitted_at,reviews.id)<(target_before_at,target_before_id))
    order by reviews.submitted_at desc,reviews.id desc
    limit target_limit+1
  loop
    if jsonb_array_length(items)=target_limit then
      next_cursor:=last_cursor;
      exit;
    end if;
    if jsonb_typeof(entry.cottage_name) is distinct from 'string' then
      return jsonb_build_object('status','unavailable');
    end if;
    items:=items||jsonb_build_array(jsonb_build_object(
      'reviewId',entry.id,'submittedAt',entry.submitted_at,
      'bookingRequestReference',entry.booking_request_reference,
      'cottageName',entry.cottage_name,
      'review',public.get_owner_customer_review(entry.booking_request_reference)
    ));
    last_cursor:=jsonb_build_object('submittedAt',entry.submitted_at,'reviewId',entry.id);
  end loop;
  return jsonb_build_object('status','success','items',items,'nextCursor',next_cursor);
end;
$function$;

ALTER FUNCTION public.list_owner_customer_reviews(timestamptz,uuid,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_owner_customer_reviews(timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_owner_customer_reviews(timestamptz,uuid,integer) TO authenticated;
