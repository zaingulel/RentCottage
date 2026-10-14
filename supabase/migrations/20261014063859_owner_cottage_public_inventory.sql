-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.list_owner_cottage_public_inventory (
  target_profile_ids uuid[],
  target_from        date,
  target_to          date
)
  RETURNS TABLE (
    profile_id uuid,
    inventory  jsonb
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if target_profile_ids is null or cardinality(target_profile_ids) > 100
    or target_from is null or target_to is null
    or target_from > target_to or target_to - target_from + 1 > 31 then
    raise exception 'Owner Cottage public inventory request is invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.account_contexts
    where user_id = (select auth.uid()) and role = 'cottage_owner'
      and owner_approval_state in ('approved', 'expired', 'suspended')
  ) then
    raise exception 'Approved Cottage Owner access is required' using errcode = '42501';
  end if;
  return query
  select profiles.id,
    public.resolve_public_cottage_inventory(profiles.current_shift_schedule_id, target_from, target_to)
  from public.owner_application_cottage_profiles profiles
  where profiles.id = any (target_profile_ids)
    and profiles.owner_user_id = (select auth.uid())
    and public.is_cottage_publicly_discoverable(profiles.id);
end;
$function$;

REVOKE ALL ON FUNCTION public.list_owner_cottage_public_inventory(uuid[],date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_owner_cottage_public_inventory(uuid[],date,date) TO authenticated;
