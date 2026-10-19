BEGIN;

-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.get_current_cottage_publication(IN target_profile_id uuid, IN target_locale public.cottage_profile_source_language);

ALTER TABLE public.cottage_profile_administrator_audit
  DROP CONSTRAINT cottage_profile_administrator_audit_event_kind_check;

ALTER TABLE public.cottage_profile_administrator_audit
  DROP CONSTRAINT cottage_profile_administrator_audit_event_shape;

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
  if (select public.is_platform_administrator('aal2')) IS NOT TRUE then raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501'; end if;
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
  if not exists (
    select 1 from public.cottage_profile_review_photos reviewed
    join public.cottage_profile_photos photos on photos.id = reviewed.photo_id
    where reviewed.review_cycle_id = cycle.id and photos.state = 'ready' and not photos.public_hidden
  ) then raise exception 'At least one approved photo must remain visible' using errcode = 'RC203'; end if;
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

CREATE FUNCTION public.get_administrator_cottage_content_visibility (
  target_profile_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare result jsonb;
begin
  if (select public.is_platform_administrator('aal2')) IS NOT TRUE then
    raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501';
  end if;
  if target_profile_id is null then raise exception 'Cottage Profile identity is required' using errcode = '22023'; end if;
  select jsonb_build_object(
    'profileId', profiles.id, 'publicationId', publications.id,
    'publicSlug', listings.public_slug, 'descriptionHidden', profiles.description_hidden,
    'photos', (select jsonb_agg(jsonb_build_object(
      'photoId', photos.id, 'originalFilename', photos.original_filename, 'hidden', photos.public_hidden
    ) order by media.position)
      from public.cottage_publication_media media
      join public.cottage_profile_photos photos on photos.id = media.photo_id
      where media.publication_id = publications.id)
  ) into result
  from public.owner_application_cottage_profiles profiles
  join public.cottage_publication_snapshots publications on publications.id = profiles.current_publication_id
  join public.cottage_marketplace_listings listings on listings.profile_id = profiles.id
  where profiles.id = target_profile_id;
  return result;
end;
$function$;

REVOKE ALL ON FUNCTION public.get_administrator_cottage_content_visibility(uuid) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.get_administrator_cottage_content_visibility(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_confirmed_booking_access (
  target_reference text
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with actor as (
    select case when actor_request.customer_user_id = contexts.user_id then 'customer'::public.account_role else 'cottage_owner'::public.account_role end as role
    from public.booking_requests actor_request
    join public.account_contexts contexts on contexts.user_id = (select auth.uid())
    join auth.users actor_user on actor_user.id = contexts.user_id
    where actor_request.booking_request_reference = target_reference
      and actor_user.phone_confirmed_at is not null
      and (
        (contexts.role in ('customer'::public.account_role, 'cottage_owner'::public.account_role)
          and actor_request.customer_user_id = contexts.user_id)
        or
        (contexts.role = 'cottage_owner'::public.account_role
          and contexts.owner_approval_state = 'approved'::public.owner_approval_state
          and actor_request.owner_user_id = contexts.user_id)
      )
  )
  select jsonb_build_object(
    'receiptId', receipts.id,
    'bookingRequestReference', requests.booking_request_reference,
    'bookingReference', commitments.commitment_reference,
    'confirmedAt', to_char(confirmations.confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'actorRole', actor.role,
    'customerName', requests.customer_name,
    'coverMediaId',(select media.opaque_id
      from public.cottage_publication_media media
      join public.cottage_profile_photos photos on photos.id=media.photo_id and not photos.public_hidden
      where media.publication_id=profiles.current_publication_id
        and public.is_cottage_publicly_discoverable(profiles.id)
      order by media.position limit 1),
    'cottageName', snapshots.quote_payload ->> 'cottageName',
    'bookingPeriod', snapshots.quote_payload -> 'items',
    'partySize', requests.party_size,
    'pricing', case actor.role
      when 'customer'::public.account_role then jsonb_build_object(
        'bookingPriceIqd', (snapshots.quote_payload ->> 'bookingPriceIqd')::bigint,
        'serviceFeeIqd', (snapshots.quote_payload ->> 'serviceFeeIqd')::bigint,
        'customerTotalIqd', (snapshots.quote_payload ->> 'customerTotalIqd')::bigint
      )
      when 'cottage_owner'::public.account_role then jsonb_build_object(
        'bookingPriceIqd', (snapshots.quote_payload ->> 'bookingPriceIqd')::bigint,
        'marketplaceCommissionFils', snapshots.marketplace_commission_amount_fils,
        'ownerNetFils',
          (snapshots.quote_payload ->> 'bookingPriceIqd')::bigint * 1000
            - snapshots.marketplace_commission_amount_fils
      )
    end,
    'houseRules', snapshots.quote_payload ->> 'houseRules',
    'bookingTermsVersion', snapshots.booking_terms_version,
    'bookingTermsBody', snapshots.booking_terms_body,
    'cancellationPolicyVersion', snapshots.cancellation_policy_version,
    'exactAddress', nullif(btrim(profiles.exact_address), ''),
    'privateDirections', nullif(btrim(profiles.private_directions), ''),
    'mapPin', case
      when profiles.exact_latitude is not null and profiles.exact_longitude is not null
        then jsonb_build_object(
          'latitude', profiles.exact_latitude,
          'longitude', profiles.exact_longitude
        )
      else null
    end,
    'customerPhone', case when customer_user.phone_confirmed_at is not null
      then case
        when btrim(customer_user.phone) ~ '^[1-9][0-9]{7,14}$'
          then '+' || btrim(customer_user.phone)
        else nullif(btrim(customer_user.phone), '')
      end end,
    'ownerPhone', case when owner_user.phone_confirmed_at is not null
      then case
        when btrim(owner_user.phone) ~ '^[1-9][0-9]{7,14}$'
          then '+' || btrim(owner_user.phone)
        else nullif(btrim(owner_user.phone), '')
      end end
  )
  from public.booking_requests requests
  join actor on true
  join public.booking_snapshots snapshots
    on snapshots.id = requests.booking_snapshot_id
    and snapshots.customer_user_id = requests.customer_user_id
    and snapshots.profile_id = requests.profile_id
  join public.cottage_booking_period_commitments commitments
    on commitments.id = requests.booking_period_commitment_id
    and commitments.customer_user_id = requests.customer_user_id
    and commitments.profile_id = requests.profile_id
  join public.booking_confirmations confirmations
    on confirmations.booking_request_id = requests.id
    and confirmations.booking_snapshot_id = snapshots.id
    and confirmations.booking_period_commitment_id = commitments.id
  join public.booking_receipts receipts
    on receipts.booking_confirmation_id = confirmations.id
    and receipts.booking_snapshot_id = snapshots.id
    and receipts.recipient_user_id = (select auth.uid())
    and receipts.recipient_role = actor.role::text
  join public.owner_application_cottage_profiles profiles
    on profiles.id = requests.profile_id
    and profiles.owner_user_id = requests.owner_user_id
  join auth.users customer_user on customer_user.id = requests.customer_user_id
  join auth.users owner_user on owner_user.id = requests.owner_user_id
  where requests.booking_request_reference = target_reference
    and public.booking_request_payment_status(requests) = 'paid-confirmed';
$function$;

CREATE FUNCTION public.get_current_cottage_publication (
  target_profile_id uuid,
  target_locale     public.cottage_profile_source_language
)
  RETURNS TABLE (
    publication_id       uuid,
    name                 text,
    governorate          text,
    approximate_location text,
    capacity             integer,
    bedrooms             integer,
    bathrooms            integer,
    amenities            text[],
    description          text,
    house_rules          text,
    media_ids            uuid[],
    description_hidden   boolean
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select publications.id, publications.name, publications.governorate,
    publications.approximate_location, publications.capacity,
    publications.bedrooms, publications.bathrooms, publications.amenities,
    case when profiles.description_hidden then null else localizations.description end, localizations.house_rules,
    coalesce(array_agg(media.opaque_id order by media.position)
      filter (where media.opaque_id is not null), '{}'::uuid[]), profiles.description_hidden
  from public.owner_application_cottage_profiles profiles
  join public.cottage_publication_snapshots publications on publications.id = profiles.current_publication_id
  join public.cottage_publication_localizations localizations
    on localizations.publication_id = publications.id and localizations.locale = target_locale
  left join public.cottage_publication_media media on media.publication_id = publications.id
    and exists (select 1 from public.cottage_profile_photos photos where photos.id = media.photo_id and not photos.public_hidden)
  where profiles.id = target_profile_id
    and public.is_cottage_publicly_discoverable(profiles.id)
  group by publications.id, localizations.description, localizations.house_rules, profiles.description_hidden;
$function$;

REVOKE ALL ON FUNCTION public.get_current_cottage_publication(uuid, public.cottage_profile_source_language) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_current_cottage_publication(uuid, public.cottage_profile_source_language) TO anon;

GRANT ALL ON FUNCTION public.get_current_cottage_publication(uuid, public.cottage_profile_source_language) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_customer_booking_request (
  target_reference text
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select jsonb_build_object('id',requests.id,'bookingRequestReference',requests.booking_request_reference,
    'status',requests.status,'paymentStatus',public.booking_request_payment_status(requests),
    'paymentRequiredWindow',public.booking_request_payment_required_window(requests),
    'paymentRequiredExpiry',public.booking_request_payment_required_expiry_status(requests),
    'paymentRecovery',public.booking_request_payment_recovery_status(requests),
    'coverMediaId',(select media.opaque_id
      from public.owner_application_cottage_profiles profiles
      join public.cottage_publication_media media on media.publication_id=profiles.current_publication_id
      join public.cottage_profile_photos photos on photos.id=media.photo_id and not photos.public_hidden
      where profiles.id=requests.profile_id and public.is_cottage_publicly_discoverable(profiles.id)
      order by media.position limit 1),
    'cottageName',snapshots.quote_payload->>'cottageName','bookingPeriod',snapshots.quote_payload->'items',
    'partySize',requests.party_size,'bookingPriceIqd',(snapshots.quote_payload->>'bookingPriceIqd')::bigint,
    'serviceFeeIqd',(snapshots.quote_payload->>'serviceFeeIqd')::bigint,
    'customerTotalIqd',(snapshots.quote_payload->>'customerTotalIqd')::bigint,
    'responseDeadline',to_char(requests.response_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'declineReason',requests.decline_reason,'declineNote',requests.decline_note,
    'statusNotifications',coalesce((select jsonb_agg(jsonb_build_object('id',receipts.id,'status',receipts.status,
      'createdAt',to_char(receipts.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by receipts.created_at)
      from public.booking_request_status_notifications receipts where receipts.booking_request_id=requests.id
        and receipts.recipient_user_id=(select auth.uid())),'[]'::jsonb))
  from public.booking_requests requests join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id
  where requests.booking_request_reference=target_reference and requests.customer_user_id=(select auth.uid())
    and exists(select 1 from public.account_contexts contexts where contexts.user_id=(select auth.uid()) and contexts.role in ('customer','cottage_owner'));
$function$;

CREATE OR REPLACE FUNCTION public.get_public_cottage_profile (
  target_locale    public.cottage_profile_source_language,
  target_slug      text,
  requested_search jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare result jsonb;
begin
  perform public.validate_public_cottage_discovery(requested_search);
  perform public.validate_public_cottage_discovery_admission(requested_search);
  with target as (
    select listing.public_slug, profile.current_shift_schedule_id as schedule_id,
      publication.*, profile.description_hidden, localization.description, localization.house_rules
    from public.cottage_marketplace_listings listing
    join public.owner_application_cottage_profiles profile on profile.id = listing.profile_id
    join public.cottage_publication_snapshots publication on publication.id = profile.current_publication_id
    join public.cottage_publication_localizations localization
      on localization.publication_id = publication.id and localization.locale = target_locale
    where listing.public_slug = target_slug
      and public.is_cottage_publicly_discoverable(profile.id)
  )
  select jsonb_build_object(
    'slug', target.public_slug,
    'name', target.name,
    'governorate', target.governorate,
    'approximateLocation', target.approximate_location,
    'capacity', target.capacity,
    'bedrooms', target.bedrooms,
    'bathrooms', target.bathrooms,
    'amenities', target.amenities,
    'description', case when target.description_hidden then null else target.description end,
    'descriptionHidden', target.description_hidden,
    'houseRules', target.house_rules,
    'mediaIds', coalesce((
      select jsonb_agg(media.opaque_id order by media.position)
      from public.cottage_publication_media media
      join public.cottage_profile_photos photos on photos.id = media.photo_id and not photos.public_hidden
      where media.publication_id = target.id
    ), '[]'::jsonb),
    'inventory', inventory.value
  ) into result
  from target
  cross join lateral (
    select public.resolve_public_cottage_inventory(
      target.schedule_id, (requested_search ->> 'from')::date, (requested_search ->> 'to')::date
    ) as value
  ) inventory;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_owner_booking_request_notifications()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id',requests.id,'bookingRequestReference',requests.booking_request_reference,
    'status',requests.status,'paymentStatus',public.booking_request_payment_status(requests),
    'paymentRequiredWindow',public.booking_request_payment_required_window(requests),
    'paymentRequiredExpiry',public.booking_request_payment_required_expiry_status(requests),
    'customerName',requests.customer_name,'partySize',requests.party_size,'bookingNote',requests.booking_note,
    'cottageName',snapshots.quote_payload->>'cottageName','bookingPeriod',snapshots.quote_payload->'items',
    'bookingPriceIqd',(snapshots.quote_payload->>'bookingPriceIqd')::bigint,
    'marketplaceCommissionFils',snapshots.marketplace_commission_amount_fils,
    'ownerNetFils',(snapshots.quote_payload->>'bookingPriceIqd')::bigint*1000-snapshots.marketplace_commission_amount_fils,
    'houseRules',snapshots.quote_payload->>'houseRules','bookingTermsVersion',snapshots.booking_terms_version,
    'cancellationPolicyVersion',snapshots.cancellation_policy_version,
    'statusNotifications',coalesce((select jsonb_agg(jsonb_build_object('id',receipts.id,'status',receipts.status,
      'createdAt',to_char(receipts.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by receipts.created_at)
      from public.booking_request_status_notifications receipts where receipts.booking_request_id=requests.id
        and receipts.recipient_user_id=(select auth.uid())),'[]'::jsonb),
    'responseDeadline',to_char(requests.response_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt',to_char(notifications.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'coverMediaId',(select media.opaque_id
      from public.owner_application_cottage_profiles profiles
      join public.cottage_publication_media media on media.publication_id=profiles.current_publication_id
      join public.cottage_profile_photos photos on photos.id=media.photo_id and not photos.public_hidden
      where profiles.id=requests.profile_id and public.is_cottage_publicly_discoverable(profiles.id)
      order by media.position limit 1),
    'databaseNow',to_char(date_trunc('milliseconds',clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by notifications.created_at desc),'[]'::jsonb)
  from public.owner_request_notifications notifications
  join public.booking_requests requests on requests.id=notifications.booking_request_id
  join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id
  where notifications.owner_user_id=(select auth.uid())
    and exists(select 1 from auth.users users where users.id=(select auth.uid()) and users.phone_confirmed_at is not null)
    and exists(select 1 from public.account_contexts contexts
    where contexts.user_id=(select auth.uid()) and contexts.role='cottage_owner' and contexts.owner_approval_state='approved');
$function$;

CREATE OR REPLACE FUNCTION public.resolve_current_cottage_publication_media (
  target_opaque_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare target_path text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Publication media service access is required' using errcode = '42501';
  end if;
  select media.object_path into target_path
  from public.cottage_publication_media media
  join public.cottage_profile_photos photos on photos.id = media.photo_id and not photos.public_hidden
  join public.cottage_publication_snapshots publication on publication.id = media.publication_id
  join public.owner_application_cottage_profiles profile
    on profile.id = publication.profile_id and profile.current_publication_id = publication.id
  where media.opaque_id = target_opaque_id
    and public.is_cottage_publicly_discoverable(profile.id);
  if target_path is null then
    raise exception 'Publication media is unavailable' using errcode = 'RC204';
  end if;
  return target_path;
end;
$function$;

CREATE OR REPLACE FUNCTION public.search_public_cottages (
  target_locale     public.cottage_profile_source_language,
  requested_search  jsonb,
  target_after_slug text,
  target_limit      integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  from_day date;
  to_day date;
  items jsonb;
  next_cursor text;
begin
  perform public.validate_public_cottage_discovery(requested_search);
  perform public.validate_public_cottage_discovery_admission(requested_search);
  if target_limit is null or target_limit < 1 or target_limit > 12
    or target_after_slug !~ '^cottage-[0-9a-f]{32}$' then
    raise exception 'Public Cottage search input is invalid' using errcode = '22023';
  end if;
  from_day := (requested_search ->> 'from')::date;
  to_day := (requested_search ->> 'to')::date;
  with candidates as (
    select profiles.id as profile_id, profiles.current_shift_schedule_id as schedule_id,
      listings.public_slug, publications.*, localizations.description,
      localizations.house_rules
    from public.owner_application_cottage_profiles profiles
    join public.cottage_marketplace_listings listings on listings.profile_id = profiles.id
    join public.cottage_publication_snapshots publications
      on publications.id = profiles.current_publication_id
    join public.cottage_publication_localizations localizations
      on localizations.publication_id = publications.id and localizations.locale = target_locale
    where public.is_cottage_publicly_discoverable(profiles.id)
      and listings.public_slug > coalesce(target_after_slug, '')
      and publications.capacity >= (requested_search ->> 'guests')::integer
      and (not requested_search ? 'governorate'
        or lower(publications.governorate) = lower(btrim(requested_search ->> 'governorate')))
      and (not requested_search ? 'area'
        or lower(publications.approximate_location) = lower(btrim(requested_search ->> 'area')))
      and array(
        select value from jsonb_array_elements_text(coalesce(requested_search -> 'amenities', '[]'::jsonb)) values(value)
      ) <@ publications.amenities
  ), selections as (
    select filters.value ->> 'serviceDay' as service_day, filters.value ->> 'kind' as kind,
      filters.value ->> 'position' as unit_position
    from jsonb_array_elements(coalesce(requested_search -> 'selections', '[]'::jsonb)) filters(value)
  ), page as (
    select ordered.id, ordered.schedule_id, ordered.public_slug, ordered.name, ordered.governorate,
      ordered.approximate_location, ordered.capacity, ordered.amenities
    from (
      select candidates.* from candidates
      -- offset 0 keeps the availability check above candidate assembly and ordering.
      order by candidates.public_slug offset 0
    ) ordered
    where (
      select count(distinct units.service_day) filter (where units.available) = (to_day - from_day + 1)
        and count(*) filter (where units.available and selections.service_day is not null)
          = (select count(*) from selections)
      from public.public_cottage_inventory_units(ordered.schedule_id, from_day, to_day) units
      left join selections
        on selections.service_day = to_char(units.service_day, 'YYYY-MM-DD')
        and selections.kind = case units.unit_kind
          when 'shift'::public.cottage_inventory_unit_kind then 'shift' else 'full-day' end
        and (selections.kind = 'full-day' or selections.unit_position = units.unit_position::text)
    )
    order by ordered.public_slug
    limit target_limit + 1
  ), enumerated as (
    select page.*, row_number() over (order by page.public_slug) as ordinal
    from page
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'slug', enumerated.public_slug,
      'name', enumerated.name,
      'governorate', enumerated.governorate,
      'approximateLocation', enumerated.approximate_location,
      'capacity', enumerated.capacity,
      'amenities', enumerated.amenities,
      'mediaIds', coalesce((
        select jsonb_agg(media.opaque_id order by media.position)
        from public.cottage_publication_media media
        join public.cottage_profile_photos photos on photos.id = media.photo_id and not photos.public_hidden
        where media.publication_id = enumerated.id
      ), '[]'::jsonb),
      'inventory', public.resolve_public_cottage_inventory(enumerated.schedule_id, from_day, to_day)
    ) order by enumerated.public_slug) filter (where enumerated.ordinal <= target_limit), '[]'::jsonb),
    case when count(*) > target_limit
      then max(enumerated.public_slug) filter (where enumerated.ordinal = target_limit) end
  into items, next_cursor
  from enumerated;

  return jsonb_build_object('items', items, 'nextCursor', next_cursor);
end;
$function$;

CREATE FUNCTION public.set_administrator_cottage_description_hidden (
  target_profile_id     uuid,
  target_publication_id uuid,
  requested_hidden      boolean,
  requested_reason      text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare profile public.owner_application_cottage_profiles;
declare normalized_reason text := regexp_replace(requested_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  if (select public.is_platform_administrator('aal2')) IS NOT TRUE then
    raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501';
  end if;
  if target_profile_id is null or target_publication_id is null or requested_hidden is null
    or normalized_reason is null or char_length(normalized_reason) not between 1 and 1000 then
    raise exception 'Visibility identity, state and reason are required' using errcode = '22023';
  end if;
  select * into profile from public.owner_application_cottage_profiles where id = target_profile_id for update;
  if not found or profile.current_publication_id is null then raise exception 'Published Cottage content is unavailable' using errcode = 'RC204'; end if;
  if profile.current_publication_id <> target_publication_id then raise exception 'Cottage publication has changed' using errcode = 'RC409'; end if;
  if profile.description_hidden is distinct from requested_hidden then
    update public.owner_application_cottage_profiles set description_hidden = requested_hidden where id = profile.id;
    insert into public.cottage_profile_administrator_audit (
      profile_id, administrator_user_id, previous_version, resulting_version, changed_fields, event_kind, reason
    ) values (
      profile.id, (select auth.uid()), profile.version, profile.version, array['description'],
      case when requested_hidden then 'description_hidden' else 'description_restored' end, normalized_reason
    );
  end if;
  return public.get_administrator_cottage_content_visibility(profile.id);
end;
$function$;

REVOKE ALL ON FUNCTION public.set_administrator_cottage_description_hidden(uuid, uuid, boolean, text) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.set_administrator_cottage_description_hidden(uuid, uuid, boolean, text) TO authenticated;

CREATE FUNCTION public.set_administrator_cottage_photo_hidden (
  target_profile_id     uuid,
  target_publication_id uuid,
  target_photo_id       uuid,
  requested_hidden      boolean,
  requested_reason      text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare profile public.owner_application_cottage_profiles;
declare photo public.cottage_profile_photos;
declare normalized_reason text := regexp_replace(requested_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  if (select public.is_platform_administrator('aal2')) IS NOT TRUE then
    raise exception 'AAL2 Platform Administrator access is required' using errcode = '42501';
  end if;
  if target_profile_id is null or target_publication_id is null or target_photo_id is null or requested_hidden is null
    or normalized_reason is null or char_length(normalized_reason) not between 1 and 1000 then
    raise exception 'Visibility identity, state and reason are required' using errcode = '22023';
  end if;
  select * into profile from public.owner_application_cottage_profiles where id = target_profile_id for update;
  if not found or profile.current_publication_id is null then raise exception 'Published Cottage content is unavailable' using errcode = 'RC204'; end if;
  if profile.current_publication_id <> target_publication_id then raise exception 'Cottage publication has changed' using errcode = 'RC409'; end if;
  select * into photo from public.cottage_profile_photos photos
    where photos.id = target_photo_id and photos.profile_id = profile.id
      and exists (select 1 from public.cottage_publication_media media
        where media.publication_id = profile.current_publication_id and media.photo_id = photos.id)
    for update;
  if not found then raise exception 'Current published photo is unavailable' using errcode = 'RC204'; end if;
  if photo.public_hidden is distinct from requested_hidden then
    if requested_hidden and (select count(*)
      from public.cottage_publication_media media
      join public.cottage_profile_photos photos on photos.id = media.photo_id
      where media.publication_id = profile.current_publication_id and not photos.public_hidden) <= 1 then
      raise exception 'At least one approved photo must remain visible' using errcode = 'RC203';
    end if;
    update public.cottage_profile_photos set public_hidden = requested_hidden where id = photo.id;
    insert into public.cottage_profile_administrator_audit (
      profile_id, administrator_user_id, previous_version, resulting_version, changed_fields, event_kind, object_path, reason
    ) values (
      profile.id, (select auth.uid()), profile.version, profile.version, array['photos'],
      case when requested_hidden then 'photo_hidden' else 'photo_restored' end, photo.object_path, normalized_reason
    );
  end if;
  return public.get_administrator_cottage_content_visibility(profile.id);
end;
$function$;

REVOKE ALL ON FUNCTION public.set_administrator_cottage_photo_hidden(uuid, uuid, uuid, boolean, text) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.set_administrator_cottage_photo_hidden(uuid, uuid, uuid, boolean, text) TO authenticated;

ALTER TABLE public.cottage_profile_administrator_audit
  ADD CONSTRAINT cottage_profile_administrator_audit_event_kind_check
    CHECK
    (event_kind = ANY (ARRAY['working_copy_updated'::text, 'photo_upload_prepared'::text, 'photo_deletion_prepared'::text, 'photo_deletion_recovered'::text,
    'draft_abandoned'::text, 'draft_restored'::text, 'description_hidden'::text, 'description_restored'::text, 'photo_hidden'::text, 'photo_restored'::text]));

ALTER TABLE public.cottage_profile_administrator_audit
  ADD CONSTRAINT cottage_profile_administrator_audit_event_shape
    CHECK
    (event_kind = 'working_copy_updated'::text AND resulting_version > previous_version AND object_path IS NULL AND lifecycle_reason IS NULL AND previous_status IS NULL AND
    resulting_status IS NULL OR (event_kind = ANY (ARRAY['photo_upload_prepared'::text, 'photo_deletion_prepared'::text, 'photo_deletion_recovered'::text])) AND resulting_version =
    previous_version AND changed_fields = ARRAY['photos'::text] AND object_path IS
    NOT NULL AND lifecycle_reason IS NULL AND previous_status IS NULL AND resulting_status IS NULL OR event_kind = 'draft_abandoned'::text AND resulting_version =
    (previous_version + 1) AND changed_fields = ARRAY['status'::text] AND object_path IS NULL AND lifecycle_reason IS
    NOT NULL AND lifecycle_reason = regexp_replace(lifecycle_reason, '^[[:space:]]+|[[:space:]]+$'::text, ''::text, 'g'::text) AND char_length(btrim(lifecycle_reason)) >= 1 AND
    char_length(btrim(lifecycle_reason)) <= 1000 AND previous_status IS NOT NULL AND resulting_status IS
    NOT NULL AND previous_status = 'draft'::public.cottage_profile_status AND resulting_status = 'abandoned'::public.cottage_profile_status OR event_kind = 'draft_restored'::text
    AND resulting_version = (previous_version + 1) AND changed_fields = ARRAY['status'::text] AND object_path IS NULL AND lifecycle_reason IS
    NOT NULL AND lifecycle_reason = regexp_replace(lifecycle_reason, '^[[:space:]]+|[[:space:]]+$'::text, ''::text, 'g'::text) AND char_length(btrim(lifecycle_reason)) >= 1 AND
    char_length(btrim(lifecycle_reason)) <= 1000 AND previous_status IS NOT NULL AND resulting_status IS
    NOT NULL AND previous_status = 'abandoned'::public.cottage_profile_status AND resulting_status = 'draft'::public.cottage_profile_status OR
    (event_kind = ANY (ARRAY['description_hidden'::text, 'description_restored'::text, 'photo_hidden'::text, 'photo_restored'::text])) AND reason IS
    NOT NULL AND resulting_version = previous_version AND lifecycle_reason IS NULL AND previous_status IS NULL AND resulting_status IS NULL AND
    ((event_kind = ANY (ARRAY['description_hidden'::text, 'description_restored'::text])) AND changed_fields = ARRAY['description'::text] AND object_path IS NULL OR (event_kind =
    ANY (ARRAY['photo_hidden'::text, 'photo_restored'::text])) AND changed_fields = ARRAY['photos'::text] AND object_path IS NOT NULL));

ALTER TABLE public.cottage_profile_photos
  ADD COLUMN public_hidden boolean DEFAULT false NOT NULL;

ALTER TABLE public.owner_application_cottage_profiles
  ADD COLUMN description_hidden boolean DEFAULT false NOT NULL;

ALTER FUNCTION public.get_administrator_cottage_content_visibility(uuid) OWNER TO postgres;
ALTER FUNCTION public.set_administrator_cottage_description_hidden(uuid, uuid, boolean, text) OWNER TO postgres;
ALTER FUNCTION public.set_administrator_cottage_photo_hidden(uuid, uuid, uuid, boolean, text) OWNER TO postgres;
ALTER FUNCTION public.get_current_cottage_publication(uuid, public.cottage_profile_source_language) OWNER TO postgres;

COMMIT;
