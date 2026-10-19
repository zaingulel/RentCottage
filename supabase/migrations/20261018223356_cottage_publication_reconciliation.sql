-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.approve_cottage_profile_publication (
  target_review_cycle_id uuid,
  target_reason          text
)
  RETURNS public.cottage_publication_snapshots
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare cycle public.cottage_profile_review_cycles;
declare profile public.owner_application_cottage_profiles;
declare owner_context public.account_contexts;
declare publication public.cottage_publication_snapshots;
declare submitted_source public.cottage_profile_source_revisions;
declare baseline_description text;
declare baseline_house_rules text;
declare approved_description text;
declare approved_house_rules text;
declare reconciled_description text;
declare reconciled_house_rules text;
begin
  if not (select public.is_platform_administrator('aal2')) then raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501'; end if;
  select * into cycle from public.cottage_profile_review_cycles where id = target_review_cycle_id for update;
  if not found or cycle.state <> 'in_review' then raise exception 'Cottage review cycle is unavailable' using errcode = 'RC204'; end if;
  select * into profile from public.owner_application_cottage_profiles where id = cycle.profile_id for update;
  select * into owner_context from public.account_contexts
    where user_id = profile.owner_user_id for update;
  if not found or owner_context.role <> 'cottage_owner'
    or owner_context.owner_approval_state <> 'approved' then
    raise exception 'Approved Cottage Owner access is required' using errcode = '42501';
  end if;
  if not coalesce((
    select production_ready
    from public.cottage_translation_runtime_control
    where singleton
  ), false) then
    raise exception 'Production translation and publication are disabled by runtime control'
      using errcode = 'RC246';
  end if;
  if cycle.name is null or cycle.governorate is null or cycle.approximate_location is null
    or cycle.capacity is null or cycle.bedrooms is null or cycle.bathrooms is null
    or cardinality(cycle.amenities) < 1 then raise exception 'Reviewed public Cottage Profile fields are incomplete' using errcode = 'RC203'; end if;
  if public.reads_as_coordinate_pair(cycle.approximate_location) then raise exception 'Reviewed Approximate Location reads as a coordinate pair' using errcode = 'RC203'; end if;
  if (select count(*) from public.cottage_profile_localized_heads where review_cycle_id = cycle.id) <> 3 then raise exception 'All three localized heads are required' using errcode = 'RC203'; end if;
  if (select count(distinct revisions.locale)
      from public.cottage_profile_localized_revisions revisions
      join public.cottage_profile_source_revisions source on source.id = cycle.source_revision_id
      where revisions.review_cycle_id = cycle.id and revisions.origin = 'generated'
        and revisions.locale <> source.source_language) <> 2 then
    raise exception 'Both non-source languages require generated provenance' using errcode = 'RC203';
  end if;
  if exists (
    select 1 from public.cottage_profile_localized_heads heads
    where heads.review_cycle_id = cycle.id and (
      select decisions.approved
      from public.cottage_profile_localized_decisions decisions
      where decisions.review_cycle_id = heads.review_cycle_id
        and decisions.locale = heads.locale
        and decisions.localized_revision_id = heads.localized_revision_id
      order by decisions.decided_at desc, decisions.id desc
      limit 1
    ) is distinct from true
  ) then raise exception 'Every current localized head requires approval' using errcode = 'RC203'; end if;
  if not exists (select 1 from public.cottage_profile_review_photos where review_cycle_id = cycle.id) then raise exception 'Approved publication photos are required' using errcode = 'RC203'; end if;
  select * into submitted_source from public.cottage_profile_source_revisions
    where id = cycle.source_revision_id and profile_id = profile.id;
  if not found then
    raise exception 'Submitted Cottage source evidence is unavailable' using errcode = 'RC203';
  end if;
  if cycle.remediation_publication_id is null then
    baseline_description := submitted_source.description;
    baseline_house_rules := submitted_source.house_rules;
  else
    select localizations.description, localizations.house_rules
      into baseline_description, baseline_house_rules
    from public.cottage_publication_snapshots snapshots
    join public.cottage_publication_localizations localizations
      on localizations.publication_id = snapshots.id
      and localizations.locale = submitted_source.source_language
    where snapshots.id = cycle.remediation_publication_id and snapshots.profile_id = profile.id;
    if not found then
      raise exception 'Remediation source baseline is unavailable' using errcode = 'RC203';
    end if;
  end if;
  insert into public.cottage_publication_snapshots (
    profile_id, review_cycle_id, publication_number, name, governorate,
    approximate_location, capacity, bedrooms, bathrooms, amenities
  ) values (
    profile.id, cycle.id,
    coalesce((select max(publication_number) from public.cottage_publication_snapshots where profile_id = profile.id), 0) + 1,
    cycle.name, cycle.governorate, cycle.approximate_location,
    cycle.capacity, cycle.bedrooms, cycle.bathrooms, cycle.amenities
  ) returning * into publication;
  insert into public.cottage_publication_localizations (
    publication_id, locale, localized_revision_id, description, house_rules
  ) select publication.id, heads.locale, revisions.id, revisions.description, revisions.house_rules
    from public.cottage_profile_localized_heads heads
    join public.cottage_profile_localized_revisions revisions on revisions.id = heads.localized_revision_id
    where heads.review_cycle_id = cycle.id;
  select description, house_rules into approved_description, approved_house_rules
    from public.cottage_publication_localizations
    where publication_id = publication.id and locale = submitted_source.source_language;
  reconciled_description := profile.description;
  reconciled_house_rules := profile.house_rules;
  if profile.source_language = submitted_source.source_language then
    if profile.description is not distinct from baseline_description then
      reconciled_description := approved_description;
    end if;
    if profile.house_rules is not distinct from baseline_house_rules then
      reconciled_house_rules := approved_house_rules;
    end if;
  end if;
  insert into public.cottage_publication_media (publication_id, photo_id, object_path, media_type, position)
    select publication.id, photos.id, photos.object_path, photos.media_type, review_photos.position
    from public.cottage_profile_review_photos review_photos
    join public.cottage_profile_photos photos on photos.id = review_photos.photo_id
    where review_photos.review_cycle_id = cycle.id and photos.state = 'ready';
  if (select count(*) from public.cottage_publication_media where publication_id = publication.id)
      <> (select count(*) from public.cottage_profile_review_photos where review_cycle_id = cycle.id) then
    raise exception 'Approved publication photos are incomplete' using errcode = 'RC203';
  end if;
  insert into public.cottage_profile_publication_decisions (
    review_cycle_id, administrator_user_id, approved, reason
  ) values (cycle.id, (select auth.uid()), true, btrim(target_reason));
  update public.cottage_profile_review_cycles set state = 'approved', decided_at = now() where id = cycle.id;
  update public.owner_application_cottage_profiles
    set current_publication_id = publication.id, status = 'draft',
      submitted_source_revision_id = null, version = version + 1, updated_at = now()
    where id = profile.id;
  -- Source protection examines OLD.status, so reconciliation follows the draft transition.
  if (reconciled_description, reconciled_house_rules)
      is distinct from (profile.description, profile.house_rules) then
    update public.owner_application_cottage_profiles
      set description = reconciled_description, house_rules = reconciled_house_rules
      where id = profile.id;
  end if;
  return publication;
end;
$function$;