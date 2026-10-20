-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DO $suspension_admission$
declare blocked_ids uuid[];
begin
  select array_agg(profile_id order by profile_id) into blocked_ids
  from public.cottage_marketplace_listings where state='suspended';
  if cardinality(blocked_ids)>0 then
    raise exception 'Suspended Cottage listing has no provable former state'
      using errcode='RC409',detail=format('targets=%s count=%s',blocked_ids,cardinality(blocked_ids));
  end if;
  select array_agg(distinct requests.owner_user_id order by requests.owner_user_id)
  into blocked_ids from public.booking_requests requests
  where requests.status='pending' and (
    exists(select 1 from public.account_contexts contexts where contexts.user_id=requests.owner_user_id and contexts.owner_approval_state='suspended')
    or exists(select 1 from public.owner_applications applications where applications.owner_user_id=requests.owner_user_id and applications.status='suspended')
  );
  if cardinality(blocked_ids)>0 then
    raise exception 'Legacy suspended Cottage Owner has unresolved pending requests'
      using errcode='RC409',detail=format('targets=%s count=%s',blocked_ids,cardinality(blocked_ids));
  end if;
end;
$suspension_admission$;

CREATE FUNCTION private.prepare_booking_request_release (
  target_request_id           uuid,
  target_actor_id             uuid,
  requested_action            text,
  target_decline_reason       text,
  target_decline_note         text,
  target_suspension_action_id uuid
)
  RETURNS public.booking_request_release_work
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare target_request public.booking_requests;
declare target_attempt public.booking_request_submission_attempts;
declare action private.marketplace_suspension_actions;
declare work public.booking_request_release_work;
declare evaluated_at timestamptz;
declare effective_action text;
declare outcome text;
declare normalized_note text:=nullif(btrim(target_decline_note),'');
declare fingerprint_payload jsonb;
begin
  select * into target_request from public.booking_requests
  where id=target_request_id for update;
  if not found or target_request.status<>'pending' then
    raise exception 'Pending Booking Request is unavailable' using errcode='RC409';
  end if;
  select * into target_attempt from public.booking_request_submission_attempts
  where booking_request_id=target_request.id for update;
  if not found
    or target_attempt.customer_user_id<>target_request.customer_user_id
    or target_attempt.profile_id<>target_request.profile_id then
    raise exception 'Booking Request release binding is unavailable' using errcode='RC409';
  end if;
  if target_suspension_action_id is not null then
    select * into action from private.marketplace_suspension_actions
    where id=target_suspension_action_id;
    if not found
      or requested_action is distinct from 'suspend'
      or action.action<>'suspend'
      or action.actor_user_id is distinct from target_actor_id
      or target_actor_id is distinct from (select auth.uid())
      or public.is_platform_administrator('aal2') is not true
      or not (
        (action.target_kind='customer' and action.account_user_id=target_request.customer_user_id)
        or (action.target_kind='owner' and action.account_user_id=target_request.owner_user_id)
        or (action.target_kind='cottage' and action.profile_id=target_request.profile_id)
      ) then
      raise exception 'Suspension release scope is invalid' using errcode='42501';
    end if;
  elsif requested_action is null or requested_action not in ('decline','withdraw','expire') then
    raise exception 'Booking Request release action is invalid' using errcode='22023';
  end if;
  evaluated_at:=clock_timestamp();
  effective_action:=case
    when target_suspension_action_id is not null and evaluated_at>=target_request.response_deadline
      then 'expire'
    when requested_action='suspend' then 'decline'
    else requested_action end;
  outcome:=case effective_action when 'decline' then 'declined' when 'withdraw' then 'withdrawn' else 'expired' end;
  if target_suspension_action_id is not null then
    target_decline_reason:='other';
    normalized_note:=null;
  end if;
  fingerprint_payload:=jsonb_build_object(
    'bookingRequestId', target_request.id, 'outcome', outcome,
    'actorUserId', case when effective_action='expire' then null else target_actor_id end,
    'declineReason', case when outcome='declined' then target_decline_reason end,
    'declineNote', case when outcome='declined' then normalized_note end
  );
  if target_suspension_action_id is not null then
    fingerprint_payload:=fingerprint_payload||jsonb_build_object('suspensionActionId', target_suspension_action_id);
  end if;
  insert into public.booking_request_release_work(
    booking_request_id, attempt_id, outcome, actor_user_id, decline_reason,
    decline_note, outcome_fingerprint, created_at, suspension_action_id
  ) values(
    target_request.id, target_attempt.id, outcome,
    case when effective_action='expire' then null else target_actor_id end,
    case when outcome='declined' then target_decline_reason end,
    case when outcome='declined' then normalized_note end,
    encode(extensions.digest(convert_to(fingerprint_payload::text,'UTF8'),'sha256'),'hex'),
    evaluated_at, target_suspension_action_id
  ) returning * into work;
  update public.booking_requests set status='processing',
    outcome_actor_user_id=work.actor_user_id, decline_reason=work.decline_reason,
    decline_note=work.decline_note, outcome_fingerprint=work.outcome_fingerprint
  where id=target_request.id;
  return work;
end;
$function$;

REVOKE ALL ON FUNCTION private.prepare_booking_request_release(uuid, uuid, text, text, text, uuid) FROM PUBLIC;

CREATE FUNCTION private.prepare_owner_application_renewal (
  target_application_id         uuid,
  target_verification_record_id uuid,
  expired_kinds                 public.owner_verification_document_kind[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  insert into public.owner_application_renewal_work(application_id, verification_record_id, requested_document_kinds)
  values(target_application_id, target_verification_record_id, expired_kinds)
  on conflict (application_id) where status in ('open','submitted') do nothing;
  if found then
    insert into public.owner_application_notices(application_id, owner_user_id, kind)
    select applications.id, applications.owner_user_id,'expired'
    from public.owner_applications applications
    where applications.id=target_application_id;
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION private.prepare_owner_application_renewal(uuid, uuid, public.owner_verification_document_kind[]) FROM PUBLIC;

CREATE FUNCTION private.set_marketplace_suspension_core (
  target_kind       text,
  target_id         uuid,
  target_action     text,
  expected_revision bigint,
  target_reason     text,
  target_command_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare administrator public.account_contexts;
declare target public.account_contexts;
declare application public.owner_applications;
declare profile public.owner_application_cottage_profiles;
declare listing public.cottage_marketplace_listings;
declare verification public.owner_application_verification_records;
declare previous private.marketplace_suspension_actions;
declare recorded private.marketplace_suspension_actions;
declare reason text:=regexp_replace(target_reason,'^[[:space:]]+|[[:space:]]+$','','g');
declare request_ids uuid[];
declare request_id uuid;
declare current_revision bigint;
declare from_state text;
declare to_state text;
declare expired_kinds public.owner_verification_document_kind[];
declare target_summary jsonb;
begin
  select * into administrator from public.account_contexts where user_id=(select auth.uid()) for share;
  if not found
    or administrator.role<>'platform_administrator'
    or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    return jsonb_build_object('status','access-required');
  end if;
  if target_kind is null
    or target_kind not in ('customer','owner','cottage')
    or target_id is null
    or target_action is null
    or target_action not in ('suspend','reactivate')
    or expected_revision is null
    or expected_revision<0
    or target_command_id is null
    or reason is null
    or char_length(reason) not between 1 and 1000 then
    return jsonb_build_object('status','invalid');
  end if;
  select * into previous from private.marketplace_suspension_actions where command_id=target_command_id;
  if found then
    if (previous.actor_user_id, previous.target_kind, coalesce(previous.account_user_id, previous.profile_id), previous.action, previous.expected_revision, previous.reason)
      is distinct from (administrator.user_id, target_kind, target_id, target_action, expected_revision, reason) then
      return jsonb_build_object('status','conflict');
    end if;
    return jsonb_build_object('status','completed','actionId', previous.id,'target', public.get_marketplace_suspension(target_kind, target_id));
  end if;
  if target_kind='cottage' then
    select * into profile from public.owner_application_cottage_profiles where id=target_id for update;
    if not found then
      return jsonb_build_object('status','not-found');
    end if;
  else
    if target_kind='owner' then
      select * into application from public.owner_applications where owner_user_id=target_id for update;
      if not found then
        return jsonb_build_object('status','not-found');
      end if;
    end if;
    select * into target from public.account_contexts
    where user_id=target_id and role<>'platform_administrator' for update;
    if not found or target.role='platform_administrator'
      or (target_kind='owner' and target.role<>'cottage_owner') then
      return jsonb_build_object('status','not-found');
    end if;
  end if;
  -- A same-target contender may have committed while this command waited for its target.
  select * into previous from private.marketplace_suspension_actions where command_id=target_command_id;
  if found then
    if (previous.actor_user_id, previous.target_kind, coalesce(previous.account_user_id, previous.profile_id), previous.action, previous.expected_revision, previous.reason)
      is distinct from (administrator.user_id, target_kind, target_id, target_action, expected_revision, reason) then
      return jsonb_build_object('status','conflict');
    end if;
    return jsonb_build_object('status','completed','actionId', previous.id,'target', public.get_marketplace_suspension(target_kind, target_id));
  end if;
  if target_kind='cottage' then
    if profile.status='abandoned' then
      return jsonb_build_object('status','conflict','reason','abandoned-profile');
    end if;
    select * into listing from public.cottage_marketplace_listings where profile_id=target_id for update nowait;
  elsif target_kind='owner' then
    perform 1 from public.owner_application_cottage_profiles profiles
    where profiles.owner_user_id=target_id order by profiles.id for update nowait;
  end if;
  if target_kind='customer' then
    current_revision:=target.customer_suspension_revision;
    from_state:=case when target.customer_suspended then 'suspended' else 'active' end;
    to_state:=case when target_action='suspend' then 'suspended' else 'active' end;
  elsif target_kind='cottage' then
    current_revision:=profile.suspension_revision;
    from_state:=case when profile.business_suspended then 'suspended' else coalesce(listing.state::text,'unpublished') end;
    if (profile.business_suspended and listing.profile_id is not null and listing.state<>'suspended')
      or (not profile.business_suspended and listing.state='suspended')
      or (profile.business_suspended and ((profile.listing_state_before_suspension is null)<>(listing.profile_id is null))) then
      return jsonb_build_object('status','unavailable');
    end if;
    if profile.business_suspended=(target_action='suspend') then
      return jsonb_build_object('status','conflict');
    end if;
    if target_action='suspend' then
      to_state:='suspended';
    else
      target_summary:=public.get_marketplace_suspension(target_kind, target_id);
      if target_summary->>'status'<>'ready' then
        return jsonb_build_object('status','unavailable');
      end if;
      to_state:=target_summary->>'restorationState';
    end if;
  else
    current_revision:=application.version;
    from_state:=application.status::text;
    if target.owner_approval_state::text is distinct from from_state
      and from_state in ('approved','expired','suspended') then
      return jsonb_build_object('status','unavailable');
    end if;
    if target_action='suspend' then
      if from_state not in ('approved','expired') then
        return jsonb_build_object('status','conflict');
      end if;
      to_state:='suspended';
    else
      if from_state<>'suspended' then
        return jsonb_build_object('status','conflict');
      end if;
      select * into verification
      from public.owner_application_verification_records records
      where records.id=application.current_verification_record_id
        and records.application_id=application.id
        and records.decision='approved';
      if not found
        or jsonb_typeof(verification.relevant_expiry_dates) is distinct from 'object'
        or coalesce(cardinality(verification.evidence_version_ids), 0)<1
        or cardinality(verification.evidence_types) is distinct from cardinality(verification.evidence_version_ids) then
        return jsonb_build_object('status','unavailable');
      end if;
      if exists(select 1
      from jsonb_each_text(verification.relevant_expiry_dates) expiry
      where expiry.key not in (select unnest(enum_range(null::public.owner_verification_document_kind))::text)
        or public.owner_application_parse_expiry_date(expiry.value) is null) then
        return jsonb_build_object('status','unavailable');
      end if;
      select array_agg(expiry.key::public.owner_verification_document_kind
      order by expiry.key) into expired_kinds
      from jsonb_each_text(verification.relevant_expiry_dates) expiry
      where public.owner_application_parse_expiry_date(expiry.value)<=current_date;
      to_state:=case when cardinality(expired_kinds)>0 then 'expired' else 'approved' end;
    end if;
  end if;
  if current_revision<>expected_revision or from_state=to_state then
    return jsonb_build_object('status','conflict');
  end if;
  if target_action='suspend' then
    select coalesce(array_agg(selected.id), '{}'::uuid[]) into request_ids
    from (select requests.id
    from public.booking_requests requests
    where requests.status='pending'
      and ((target_kind='customer'
      and requests.customer_user_id=target_id)
      or (target_kind='owner'
      and requests.owner_user_id=target_id)
      or (target_kind='cottage'
      and requests.profile_id=target_id))
    order by requests.id for update nowait) selected;
    perform 1
    from public.booking_request_submission_attempts attempts
    where attempts.booking_request_id=any(request_ids)
    order by attempts.id for update nowait;
    if exists(select 1
    from public.booking_requests requests left join public.booking_request_submission_attempts attempts on attempts.booking_request_id=requests.id
    where requests.id=any(request_ids)
      and (attempts.id is null
      or attempts.state<>'finalized'
      or attempts.customer_user_id<>requests.customer_user_id
      or attempts.profile_id<>requests.profile_id)) then
      return jsonb_build_object('status','unavailable');
    end if;
  end if;
  insert into private.marketplace_suspension_actions(command_id, target_kind, account_user_id, profile_id, actor_user_id, action, expected_revision, resulting_revision, from_state, to_state, reason)
  values(target_command_id, target_kind, case when target_kind<>'cottage' then target_id end, case when target_kind='cottage' then target_id end, administrator.user_id, target_action, expected_revision, expected_revision+1, from_state, to_state, reason)
  on conflict(command_id) do nothing returning * into recorded;
  if not found then
    return jsonb_build_object('status','conflict');
  end if;
  if target_kind='customer' then
    update public.account_contexts set customer_suspended=(target_action='suspend'), customer_suspension_revision=customer_suspension_revision+1, updated_at=clock_timestamp()
    where user_id=target_id;
  elsif target_kind='cottage' then
    update public.owner_application_cottage_profiles
    set business_suspended=(target_action='suspend'), suspension_revision=suspension_revision+1,
      listing_state_before_suspension=case when target_action='suspend' then listing.state else listing_state_before_suspension end,
      updated_at=clock_timestamp()
    where id=target_id;
    if listing.profile_id is not null then
      update public.cottage_marketplace_listings set state=to_state::public.cottage_marketplace_state where profile_id=target_id;
    end if;
  else
    update public.owner_applications set status=to_state::public.owner_application_status, version=version+1, review_due_at=null, review_paused_at=null, updated_at=clock_timestamp()
    where id=application.id;
    update public.account_contexts set owner_approval_state=to_state::public.owner_approval_state, owner_suspension_revision=owner_suspension_revision+1, updated_at=clock_timestamp()
    where user_id=target_id;
    insert into public.owner_application_transitions(application_id, from_status, to_status, application_version, actor_user_id, actor_subject_id, reason) values(application.id, application.status, to_state::public.owner_application_status, application.version+1, administrator.user_id, administrator.user_id::text, reason);
    if target_action='suspend' then
      insert into public.owner_application_notices(application_id, owner_user_id, kind, reason) values(application.id, target_id,'suspended', reason);
    elsif to_state='expired' then
      perform private.prepare_owner_application_renewal(application.id, verification.id, expired_kinds);
    end if;
  end if;
  if target_action='suspend' then
    foreach request_id in array request_ids loop
      perform private.prepare_booking_request_release(request_id, administrator.user_id,'suspend','other', null, recorded.id);
    end loop;
  end if;
  return jsonb_build_object('status','completed','actionId', recorded.id,'target', public.get_marketplace_suspension(target_kind, target_id));
end;
$function$;

REVOKE ALL ON FUNCTION private.set_marketplace_suspension_core(text, uuid, text, bigint, text, uuid) FROM PUBLIC;

CREATE TABLE private.marketplace_suspension_actions (
  id                 uuid                     DEFAULT gen_random_uuid() NOT NULL,
  command_id         uuid                     NOT NULL,
  target_kind        text                     NOT NULL,
  account_user_id    uuid,
  profile_id         uuid,
  actor_user_id      uuid                     NOT NULL,
  action             text                     NOT NULL,
  expected_revision  bigint                   NOT NULL,
  resulting_revision bigint                   NOT NULL,
  from_state         text                     NOT NULL,
  to_state           text                     NOT NULL,
  reason             text                     NOT NULL,
  created_at         timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE private.marketplace_suspension_actions
  ADD CONSTRAINT marketplace_suspension_action_kind CHECK (action = ANY (ARRAY['suspend'::text, 'reactivate'::text]));

ALTER TABLE private.marketplace_suspension_actions
  ADD CONSTRAINT marketplace_suspension_action_reason
    CHECK (reason = regexp_replace(reason, '^[[:space:]]+|[[:space:]]+$'::text, ''::text, 'g'::text) AND char_length(reason) >= 1 AND char_length(reason) <= 1000);

ALTER TABLE private.marketplace_suspension_actions
  ADD CONSTRAINT marketplace_suspension_action_revision CHECK (expected_revision >= 0 AND resulting_revision = (expected_revision + 1));

ALTER TABLE private.marketplace_suspension_actions
  ADD CONSTRAINT marketplace_suspension_action_target CHECK ((target_kind = ANY (ARRAY['customer'::text, 'owner'::text])) AND account_user_id IS
    NOT NULL AND profile_id IS NULL OR target_kind = 'cottage'::text AND profile_id IS NOT NULL AND account_user_id IS NULL);

ALTER TABLE private.marketplace_suspension_actions
  ADD CONSTRAINT marketplace_suspension_actions_account_fkey FOREIGN KEY (account_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;

ALTER TABLE private.marketplace_suspension_actions
  ADD CONSTRAINT marketplace_suspension_actions_command_key UNIQUE (command_id);

ALTER TABLE private.marketplace_suspension_actions
  ADD CONSTRAINT marketplace_suspension_actions_pkey PRIMARY KEY (id);

ALTER TABLE private.marketplace_suspension_actions
  ADD CONSTRAINT marketplace_suspension_actions_profile_fkey FOREIGN KEY (profile_id) REFERENCES public.owner_application_cottage_profiles(id) ON DELETE RESTRICT;

CREATE INDEX marketplace_suspension_actions_profile_history_idx ON private.marketplace_suspension_actions (profile_id, created_at DESC, id DESC)
  WHERE profile_id IS NOT NULL;

CREATE INDEX marketplace_suspension_actions_account_history_idx ON private.marketplace_suspension_actions (account_user_id, target_kind, created_at DESC, id DESC)
  WHERE account_user_id IS NOT NULL;

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
  if profile.business_suspended then
    raise exception 'Cottage publication is unavailable while activity is suspended' using errcode='RC204';
  end if;
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

CREATE OR REPLACE FUNCTION public.claim_booking_request_action (
  target_actor_user_id      uuid,
  target_booking_request_id uuid,
  target_action             text,
  target_decline_reason     text DEFAULT NULL::text,
  target_decline_note       text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare target_request public.booking_requests;
declare actor_context public.account_contexts;
declare target_attempt public.booking_request_submission_attempts;
declare work public.booking_request_release_work;
declare authorization_claim public.booking_request_authorization_claims;
declare effective_action text;
declare evaluated_at timestamptz;
declare normalized_note text := nullif(btrim(target_decline_note), '');
declare fingerprint text;
begin
  if target_actor_user_id is null or target_action is null then
    return jsonb_build_object('status', 'access-required');
  end if;
  select * into target_request from public.booking_requests requests
  where requests.id = target_booking_request_id for update;
  if not found then
    return jsonb_build_object('status', 'access-required'); end if;

  if target_action not in ('accept', 'decline', 'withdraw') then
    return jsonb_build_object('status', 'access-required');
  end if;
  if target_action in ('accept', 'decline') then
    select * into actor_context
    from public.account_contexts contexts
    where contexts.user_id = target_actor_user_id
    for update;
    if not found
      or actor_context.role <> 'cottage_owner'::public.account_role
      or actor_context.owner_approval_state <>
        'approved'::public.owner_approval_state
      or target_request.owner_user_id <> target_actor_user_id then
      return jsonb_build_object('status', 'access-required');
    end if;
  elsif target_request.customer_user_id <> target_actor_user_id then
    return jsonb_build_object('status', 'access-required');
  end if;

  if target_decline_reason is not null and target_decline_reason not in (
    'cottage_unavailable', 'cannot_accommodate_request', 'other'
  ) then
    raise exception 'Booking Request decline reason is invalid'
      using errcode = '22023';
  end if;

  if target_request.status in ('accepted', 'declined', 'withdrawn', 'expired') then
    return jsonb_build_object(
      'status', target_request.status,
      'bookingRequestReference', target_request.booking_request_reference
    );
  end if;
  if target_request.status = 'processing' then
    select * into work from public.booking_request_release_work release_work
    where release_work.booking_request_id = target_request.id;
    return public.lease_booking_request_release_work(work.id);
  end if;

  if target_action = 'accept' then
    select * into target_attempt from public.booking_request_submission_attempts attempts
    where attempts.booking_request_id = target_request.id for update;
    select * into authorization_claim from public.booking_request_authorization_claims claims
    where claims.attempt_id = target_attempt.id and claims.state = 'converted' for update;
    if target_attempt.id is null or target_attempt.state <> 'finalized'
      or authorization_claim.id is null then
      raise exception 'Booking Request capture authorization is unavailable' using errcode = 'RC409';
    end if;
  end if;
  evaluated_at := clock_timestamp();
  effective_action := case
    when evaluated_at >= target_request.response_deadline then 'expire'
    else target_action
  end;
  if effective_action = 'decline' and (
    target_decline_reason is null
    or char_length(coalesce(normalized_note, '')) > 500
    or not public.booking_request_content_is_safe(coalesce(normalized_note, ''))
  ) then
    return jsonb_build_object('status', 'invalid'); end if;

  if effective_action = 'accept' then
    update public.booking_requests set status = 'accepted',
      outcome_actor_user_id = target_actor_user_id, settled_at = evaluated_at
    where id = target_request.id;
    fingerprint := encode(
      extensions.digest(
        convert_to(
          '{"provider":{"provider":' || to_json(authorization_claim.provider)::text
          || ',"environment":' || to_json(authorization_claim.environment)::text
          || ',"merchantId":' || to_json(authorization_claim.merchant_id)::text
          || ',"terminalId":' || to_json(authorization_claim.terminal_id)::text
          || '},"kind":"capture","paymentLifecycleId":'
          || to_json(authorization_claim.payment_lifecycle_id::text)::text
          || ',"logicalOperationId":'
          || to_json((authorization_claim.payment_lifecycle_id::text || ':capture'))::text
          || ',"attemptId":' || to_json((authorization_claim.payment_lifecycle_id::text || ':capture:attempt-2'))::text
          || ',"amountFils":' || authorization_claim.amount_fils::text
          || ',"currency":"IQD"}',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    insert into public.booking_request_capture_work (
      booking_request_id, attempt_id, authorization_claim_id, authorization_claim_generation,
      payment_lifecycle_id, authorization_logical_operation_id, authorization_physical_attempt_id,
      capture_logical_operation_id, capture_physical_attempt_id, amount_fils, currency,
      provider, environment, merchant_id, terminal_id, provider_idempotency_key, request_fingerprint
    ) values (
      target_request.id, target_attempt.id, authorization_claim.id, authorization_claim.generation,
      authorization_claim.payment_lifecycle_id, authorization_claim.logical_operation_id, authorization_claim.physical_attempt_id,
      authorization_claim.payment_lifecycle_id::text || ':capture',
      authorization_claim.payment_lifecycle_id::text || ':capture:attempt-2', authorization_claim.amount_fils, authorization_claim.currency,
      authorization_claim.provider, authorization_claim.environment, authorization_claim.merchant_id, authorization_claim.terminal_id,
      'booking-request-capture:' || target_request.id::text || ':' || authorization_claim.generation::text, fingerprint
    );
    perform public.lock_booking_request_capture_source(target_request.id);
    insert into public.booking_request_status_notifications (
      booking_request_id, recipient_user_id, status, created_at
    ) values
      (target_request.id, target_request.owner_user_id, 'accepted', evaluated_at),
      (target_request.id, target_request.customer_user_id, 'accepted', evaluated_at)
    on conflict do nothing;
    return jsonb_build_object(
      'status', 'accepted',
      'bookingRequestReference', target_request.booking_request_reference
    );
  end if;

  work := private.prepare_booking_request_release(target_request.id,target_actor_user_id,effective_action,target_decline_reason,normalized_note,null);
  return public.lease_booking_request_release_work(work.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_booking_request_expiry (
  target_booking_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare target_request public.booking_requests;
declare work public.booking_request_release_work;
declare evaluated_at timestamptz;
begin
  select * into target_request
  from public.booking_requests requests
  where requests.id = target_booking_request_id
  for update;
  if not found then
    return jsonb_build_object('status', 'access-required'); end if;
  if target_request.status = 'processing' then
    select * into work from public.booking_request_release_work release_work
    where release_work.booking_request_id = target_request.id;
    return public.lease_booking_request_release_work(work.id);
  end if;
  if target_request.status in ('accepted', 'declined', 'withdrawn', 'expired') then
    return jsonb_build_object(
      'status', target_request.status,
      'bookingRequestReference', target_request.booking_request_reference
    );
  end if;
  evaluated_at := clock_timestamp();
  if target_request.status <> 'pending'
      or evaluated_at < target_request.response_deadline then
    return jsonb_build_object('status', 'not-due');
  end if;
  work := private.prepare_booking_request_release(target_request.id,null,'expire',null,null,null);
  return public.lease_booking_request_release_work(work.id);
end;
$function$;

CREATE FUNCTION public.get_marketplace_suspension (
  target_kind       text,
  target_id         uuid,
  before_created_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  before_id         uuid                     DEFAULT NULL::uuid,
  page_size         integer                  DEFAULT 20
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare administrator public.account_contexts;
declare facts record;
declare target public.account_contexts;
declare application public.owner_applications;
declare profile public.owner_application_cottage_profiles;
declare listing public.cottage_marketplace_listings;
declare verification public.owner_application_verification_records;
declare current_state text;
declare current_revision bigint;
declare can_suspend boolean;
declare can_reactivate boolean;
declare restriction_reason text;
declare restoration_state text;
declare restoration_restriction text;
declare verification_valid boolean;
declare verification_expired boolean;
begin
  select * into administrator from public.account_contexts
  where user_id=(select auth.uid()) for share;
  if not found or administrator.role<>'platform_administrator'
    or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    return jsonb_build_object('status','access-required');
  end if;
  if get_marketplace_suspension.target_kind is null
    or get_marketplace_suspension.target_kind not in ('customer','owner','cottage')
    or get_marketplace_suspension.target_id is null or page_size is null or page_size not between 1 and 50
    or (before_created_at is null)<>(before_id is null) then
    return jsonb_build_object('status','invalid');
  end if;
  -- Target, immutable history and release counts share one database snapshot.
  with target_actions as materialized (
    select actions.* from private.marketplace_suspension_actions actions
    where actions.target_kind=get_marketplace_suspension.target_kind
      and ((get_marketplace_suspension.target_kind='cottage' and actions.profile_id=get_marketplace_suspension.target_id)
        or (get_marketplace_suspension.target_kind<>'cottage' and actions.account_user_id=get_marketplace_suspension.target_id))
  ), action_counts as materialized (
    select actions.*, count(work.id) as affected,
      count(work.id) filter(where work.state='complete') as resolved,
      count(work.id) filter(where work.state='processing') as processing,
      count(work.id) filter(where work.state='quarantined') as quarantined
    from target_actions actions
    left join public.booking_request_release_work work on work.suspension_action_id=actions.id
    group by actions.id, actions.command_id, actions.target_kind, actions.account_user_id,
      actions.profile_id, actions.actor_user_id, actions.action, actions.expected_revision,
      actions.resulting_revision, actions.from_state, actions.to_state, actions.reason, actions.created_at
  ), page as materialized (
    select actions.*, row_number() over(order by created_at desc, id desc) as ordinal
    from action_counts actions
    where before_created_at is null or (actions.created_at, actions.id)<(before_created_at, before_id)
    order by actions.created_at desc, actions.id desc limit page_size+1
  )
  select contexts as context, applications as application, profiles as profile,
    listings as listing, records as verification,
    exists(select 1 from public.cottage_publication_snapshots publications
      where publications.id=profiles.current_publication_id and publications.profile_id=profiles.id) as publication_matches,
    exists(select 1 from public.cottage_shift_schedule_revisions schedules
      where schedules.id=profiles.current_shift_schedule_id and schedules.profile_id=profiles.id) as schedule_matches,
    (select jsonb_build_object('affected', coalesce(sum(affected), 0),
      'resolved', coalesce(sum(resolved), 0),'processing', coalesce(sum(processing), 0),
      'quarantined', coalesce(sum(quarantined), 0)) from action_counts) as release_summary,
    (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id,'commandId', command_id,'actorUserId', actor_user_id,'action', action,
      'expectedRevision', expected_revision,'resultingRevision', resulting_revision,
      'fromState', from_state,'toState', to_state,'reason', reason,'createdAt', created_at,
      'affected', affected,'resolved', resolved,'processing', processing,'quarantined', quarantined
    ) order by created_at desc, id desc),'[]'::jsonb) from page where ordinal<=page_size) as actions,
    (select jsonb_build_object('createdAt', created_at,'id', id) from page
      where ordinal=page_size and exists(select 1 from page where ordinal>page_size)) as next_cursor
  into facts
  from (select 1) singleton
  left join public.owner_application_cottage_profiles profiles on get_marketplace_suspension.target_kind='cottage'
    and profiles.id=get_marketplace_suspension.target_id
  left join public.account_contexts contexts
    on contexts.user_id=case when get_marketplace_suspension.target_kind='cottage' then profiles.owner_user_id else get_marketplace_suspension.target_id end
      and contexts.role<>'platform_administrator'
  left join public.owner_applications applications on applications.owner_user_id=contexts.user_id
    and get_marketplace_suspension.target_kind in ('owner','cottage')
  left join public.cottage_marketplace_listings listings on listings.profile_id=profiles.id
  left join public.owner_application_verification_records records
    on records.id=applications.current_verification_record_id
      and records.application_id=applications.id;
  target:=facts.context;
  application:=facts.application;
  profile:=facts.profile;
  listing:=facts.listing;
  verification:=facts.verification;
  if (get_marketplace_suspension.target_kind='cottage' and profile.id is null)
    or (get_marketplace_suspension.target_kind<>'cottage' and target.user_id is null)
    or (get_marketplace_suspension.target_kind='owner' and (application.id is null or target.role<>'cottage_owner')) then
    return jsonb_build_object('status','not-found');
  end if;
  if verification.id is not null and verification.decision='approved'
    and jsonb_typeof(verification.relevant_expiry_dates)='object'
    and coalesce(cardinality(verification.evidence_version_ids), 0)>0
    and cardinality(verification.evidence_types)=cardinality(verification.evidence_version_ids) then
    select not exists(select 1 from jsonb_each_text(verification.relevant_expiry_dates) expiry
      where expiry.key not in (select unnest(enum_range(null::public.owner_verification_document_kind))::text)
        or public.owner_application_parse_expiry_date(expiry.value) is null),
      exists(select 1 from jsonb_each_text(verification.relevant_expiry_dates) expiry
        where public.owner_application_parse_expiry_date(expiry.value)<=current_date)
    into verification_valid, verification_expired;
  else
    verification_valid:=false;
  end if;
  if get_marketplace_suspension.target_kind='customer' then
    current_state:=case when target.customer_suspended then 'suspended' else 'active' end;
    current_revision:=target.customer_suspension_revision;
    can_suspend:=not target.customer_suspended;
    can_reactivate:=target.customer_suspended;
    restoration_state:='active';
  elsif get_marketplace_suspension.target_kind='owner' then
    current_state:=application.status::text;
    current_revision:=application.version;
    can_suspend:=application.status in ('approved','expired');
    can_reactivate:=application.status='suspended';
    if current_state in ('approved','expired','suspended')
      and target.owner_approval_state::text is distinct from current_state then
      return jsonb_build_object('status','unavailable');
    end if;
    if not verification_valid then
      restoration_restriction:='verification-unavailable';
      if can_reactivate then
        can_reactivate:=false;restriction_reason:='verification-unavailable';
      end if;
    else
      restoration_state:=case when verification_expired then 'expired' else 'approved' end;
      if verification_expired then
        restoration_restriction:='verification-expired';
      end if;
    end if;
    if not can_suspend
      and not can_reactivate
      and restriction_reason is null then restriction_reason:='owner-application-ineligible';
    end if;
  else
    current_state:=case when profile.business_suspended then 'suspended' else coalesce(listing.state::text,'unpublished') end;
    current_revision:=profile.suspension_revision;
    can_suspend:=not profile.business_suspended;
    can_reactivate:=profile.business_suspended;
    if profile.status='abandoned' then
      can_suspend:=false;can_reactivate:=false;restriction_reason:='abandoned-profile';
    elsif (profile.business_suspended and listing.profile_id is not null and listing.state<>'suspended')
      or (not profile.business_suspended and listing.state='suspended')
      or (profile.business_suspended and ((profile.listing_state_before_suspension is null)<>(listing.profile_id is null))) then
      return jsonb_build_object('status','unavailable');
    end if;
    if profile.listing_state_before_suspension is null then
      restoration_state:='unpublished';
    elsif profile.listing_state_before_suspension='paused' then
      restoration_state:='paused';restoration_restriction:='previously-paused';
    elsif target.role='cottage_owner' and target.owner_approval_state='approved'
      and application.status='approved' and verification_valid and not verification_expired
      and facts.publication_matches and facts.schedule_matches then
      restoration_state:='published';
    else
      restoration_state:='paused';restoration_restriction:='publication-or-owner-ineligible';
    end if;
  end if;
  return jsonb_build_object('status','ready','targetKind', get_marketplace_suspension.target_kind,'targetId', get_marketplace_suspension.target_id,
    'state', current_state,'revision', current_revision,'applicationId', application.id,
    'canSuspend', can_suspend,'canReactivate', can_reactivate,'restrictionReason', restriction_reason,
    'restorationState', restoration_state,'restorationRestriction', restoration_restriction,
    'releaseSummary', facts.release_summary,'actions', facts.actions,'nextCursor', facts.next_cursor);
end;
$function$;

REVOKE ALL ON FUNCTION public.get_marketplace_suspension(text, uuid, timestamp WITH time zone, uuid, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_marketplace_suspension(text, uuid, timestamp WITH time zone, uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_cottage_publicly_discoverable (
  target_profile_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.owner_application_cottage_profiles profiles
    join public.account_contexts contexts
      on contexts.user_id = profiles.owner_user_id
      and contexts.role = 'cottage_owner'
      and contexts.owner_approval_state = 'approved'
    join public.cottage_marketplace_listings listings
      on listings.profile_id = profiles.id
      and listings.state = 'published'::public.cottage_marketplace_state
    join public.cottage_publication_snapshots publications
      on publications.id = profiles.current_publication_id
      and publications.profile_id = profiles.id
    join public.cottage_shift_schedule_revisions schedules
      on schedules.id = profiles.current_shift_schedule_id
      and schedules.profile_id = profiles.id
    where profiles.id = target_profile_id and not profiles.business_suspended
  );
$function$;

CREATE OR REPLACE FUNCTION public.process_expired_owner_applications()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  candidate record;
  expired_kinds public.owner_verification_document_kind[];
  processed integer := 0;
begin
  if not exists (
    select 1 from public.owner_application_lifecycle_control
    where singleton and expiry_processor_enabled
  ) then
    return 0;
  end if;

  for candidate in
    select applications.*, records.relevant_expiry_dates,
      records.id as verification_record_id
    from public.owner_applications applications
    join public.owner_application_verification_records records
      on records.id = applications.current_verification_record_id
    where applications.status = 'approved'
      and exists (
        select 1 from jsonb_each_text(records.relevant_expiry_dates) expiry
        where public.owner_application_parse_expiry_date(expiry.value) is null
          or public.owner_application_parse_expiry_date(expiry.value) <= current_date
      )
    for update of applications skip locked
  loop
    select array_agg(expiry.key::public.owner_verification_document_kind order by expiry.key)
    into expired_kinds
    from jsonb_each_text(candidate.relevant_expiry_dates) expiry
    where public.owner_application_parse_expiry_date(expiry.value) is null
      or public.owner_application_parse_expiry_date(expiry.value) <= current_date;

    update public.owner_applications
    set status = 'expired', version = version + 1, updated_at = now()
    where id = candidate.id;
    update public.account_contexts
    set owner_approval_state = 'expired', updated_at = now()
    where user_id = candidate.owner_user_id;
    perform private.prepare_owner_application_renewal(candidate.id,candidate.verification_record_id,expired_kinds);
    insert into public.owner_application_transitions (
      application_id, from_status, to_status, application_version, actor_subject_id,
      reason
    ) values (
      candidate.id, 'approved', 'expired', candidate.version + 1,
      'owner-application-expiry-processor', 'Required evidence expired'
    );
    processed := processed + 1;
  end loop;
  return processed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_owner_application (
  target_application_id                uuid,
  expected_version                     bigint,
  requested_action                     text,
  requested_reason                     text,
  requested_fields                     text[],
  requested_document_kinds             public.owner_verification_document_kind[],
  requested_jurisdiction               text,
  requested_licensing_basis            public.owner_licensing_basis,
  requested_licence_or_exemption_basis text,
  requested_expiry_dates               jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  application public.owner_applications;
  previous_status public.owner_application_status;
  verification_record_id uuid;
  evidence_version_ids uuid[];
  evidence_types public.owner_verification_document_kind[];
  result_status public.owner_application_status;
  suspension_result jsonb;
  target_owner_id uuid;
begin
  if not (select public.is_platform_administrator('aal2')) then
    raise exception 'Platform Administrator MFA is required' using errcode = '42501';
  end if;

  if requested_action='suspend' then
    select owner_user_id into target_owner_id from public.owner_applications where id=target_application_id;
    if not found then
    raise exception 'Owner Application was not found' using errcode='RC404'; end if;
    suspension_result:=public.set_marketplace_suspension('owner',target_owner_id,'suspend',expected_version,requested_reason,gen_random_uuid());
    if suspension_result->>'status'='access-required' then
    raise exception 'Platform Administrator MFA is required' using errcode='42501';
    elsif suspension_result->>'status'='invalid' then
    raise exception 'This suspension is invalid' using errcode='RC422';
    elsif suspension_result->>'status'<>'completed' then
    raise exception 'Owner Application changed before this action' using errcode='RC409'; end if;
    select * into application from public.owner_applications where id=target_application_id;
    return jsonb_build_object('application_id',application.id,'status',application.status,'version',application.version,'occurred_at',application.updated_at,'review_due_at',application.review_due_at);
  end if;

  select * into application from public.owner_applications
  where id = target_application_id for update;
  if not found then
    raise exception 'Owner Application was not found' using errcode = 'RC404';
  end if;
  if application.version <> expected_version then
    raise exception 'Owner Application changed before this action' using errcode = 'RC409';
  end if;
  previous_status := application.status;

  if requested_action = 'start_review' then
    if application.status <> 'submitted' then
      raise exception 'This application cannot enter review' using errcode = 'RC422';
    end if;
    result_status := 'under_review';
    update public.owner_applications
    set status = result_status, version = version + 1, updated_at = now()
    where id = application.id returning * into application;
  elsif requested_action = 'request_information' then
    if application.status not in ('submitted', 'under_review')
      or application.review_started_at is null
      or application.review_due_at is null
      or char_length(btrim(coalesce(requested_reason, ''))) not between 1 and 1000
      or cardinality(coalesce(requested_fields, '{}'))
        + cardinality(coalesce(requested_document_kinds, '{}')) < 1
      or not coalesce(requested_fields, '{}') <@ array[
        'legal_name', 'company_name', 'licensing_basis', 'exemption_basis',
        'cottage_name', 'governorate', 'approximate_location', 'exact_address',
        'capacity', 'bedrooms', 'bathrooms', 'amenities', 'description', 'house_rules'
      ]::text[] then
      raise exception 'The missing-information request is invalid' using errcode = 'RC422';
    end if;
    result_status := 'needs_information';
    update public.owner_applications
    set status = result_status,
        review_remaining = greatest(review_due_at - now(), interval '0 seconds'),
        review_due_at = null,
        review_paused_at = now(),
        version = version + 1,
        updated_at = now()
    where id = application.id returning * into application;
    insert into public.owner_application_information_requests (
      application_id, requested_by_user_id, requested_by_subject_id, reason,
      requested_fields, requested_document_kinds
    ) values (
      application.id, (select auth.uid()), (select auth.uid()), btrim(requested_reason),
      coalesce(requested_fields, '{}'), coalesce(requested_document_kinds, '{}')
    );
    insert into public.owner_application_notices (
      application_id, owner_user_id, kind, reason
    ) values (application.id, application.owner_user_id, 'information_requested', btrim(requested_reason));
  elsif requested_action in ('approve', 'reject') then
    if application.status not in ('submitted', 'under_review')
      or char_length(btrim(coalesce(requested_reason, ''))) not between 1 and 1000 then
      raise exception 'This decision is invalid for the application state' using errcode = 'RC422';
    end if;
    result_status := case requested_action
      when 'approve' then 'approved'::public.owner_application_status
      else 'rejected'::public.owner_application_status
    end;
    if requested_action = 'approve' then
      if char_length(btrim(coalesce(requested_jurisdiction, ''))) not between 1 and 120
        or char_length(btrim(coalesce(requested_licence_or_exemption_basis, ''))) not between 1 and 1000
        or requested_licensing_basis is null
        or requested_expiry_dates is null
        or jsonb_typeof(requested_expiry_dates) <> 'object'
        or exists (
          select 1 from jsonb_each_text(requested_expiry_dates) expiry
          where expiry.key not in (
            select unnest(enum_range(null::public.owner_verification_document_kind))::text
          )
          or public.owner_application_parse_expiry_date(expiry.value) is null
          or public.owner_application_parse_expiry_date(expiry.value) <= current_date
        ) then
        raise exception 'The approval record is incomplete' using errcode = 'RC422';
      end if;

      select array_agg(versions.id order by versions.kind::text),
        array_agg(versions.kind order by versions.kind::text)
      into evidence_version_ids, evidence_types
      from public.owner_verification_document_versions versions
      join public.owner_verification_documents documents on documents.id = versions.document_id
      where documents.application_id = application.id
        and versions.object_path = documents.object_path
        and versions.content_digest = documents.content_digest
        and versions.digest_source = 'sha256';

      if coalesce(cardinality(evidence_version_ids), 0) < 1
        or coalesce(cardinality(evidence_version_ids), 0) <> (
        select count(*) from public.owner_verification_documents
        where application_id = application.id
      ) then
        raise exception 'Every reviewed document needs a content-bound version' using errcode = 'RC422';
      end if;

      insert into public.owner_application_verification_records (
        application_id, version, reviewer_user_id, reviewer_subject_id,
        decision, reason, jurisdiction, licensing_basis,
        licence_or_exemption_basis, evidence_version_ids, evidence_types,
        relevant_expiry_dates
      ) values (
        application.id,
        coalesce((select max(version) + 1 from public.owner_application_verification_records
          where application_id = application.id), 1),
        (select auth.uid()), (select auth.uid()), 'approved', btrim(requested_reason),
        btrim(requested_jurisdiction), requested_licensing_basis,
        btrim(requested_licence_or_exemption_basis), evidence_version_ids,
        evidence_types, requested_expiry_dates
      ) returning id into verification_record_id;
    else
      insert into public.owner_application_verification_records (
        application_id, version, reviewer_user_id, reviewer_subject_id,
        decision, reason, jurisdiction, licensing_basis,
        licence_or_exemption_basis, evidence_version_ids, evidence_types
      ) values (
        application.id,
        coalesce((select max(version) + 1 from public.owner_application_verification_records
          where application_id = application.id), 1),
        (select auth.uid()), (select auth.uid()), 'rejected', btrim(requested_reason),
        'Not applicable', application.licensing_basis, 'Rejected before approval',
        '{}', '{}'
      ) returning id into verification_record_id;
    end if;
    update public.owner_applications
    set status = result_status, current_verification_record_id = verification_record_id,
        review_due_at = null, review_paused_at = null, decided_at = now(),
        version = version + 1, updated_at = now()
    where id = application.id returning * into application;
    update public.account_contexts
    set owner_approval_state = case when result_status = 'approved'
        then 'approved'::public.owner_approval_state
        else 'prospective'::public.owner_approval_state end,
      updated_at = now()
    where user_id = application.owner_user_id;
    if requested_action = 'approve' then
      update public.owner_application_renewal_work
      set status = 'completed', completed_at = now()
      where application_id = application.id and status = 'submitted';
    end if;
    insert into public.owner_application_notices (application_id, owner_user_id, kind, reason)
    values (
      application.id,
      application.owner_user_id,
      case requested_action when 'approve' then 'approved' else 'rejected' end,
      btrim(requested_reason)
    );
  else
    raise exception 'Unknown Owner Application review action' using errcode = 'RC422';
  end if;

  insert into public.owner_application_transitions (
    application_id, from_status, to_status, application_version,
    actor_user_id, actor_subject_id, reason
  ) values (
    application.id, previous_status, application.status, application.version,
    (select auth.uid()), (select auth.uid())::text, nullif(btrim(coalesce(requested_reason, '')), '')
  );

  return jsonb_build_object(
    'application_id', application.id, 'status', application.status,
    'version', application.version, 'occurred_at', application.updated_at,
    'review_due_at', application.review_due_at
  );
end;
$function$;

CREATE FUNCTION public.set_marketplace_suspension (
  target_kind       text,
  target_id         uuid,
  target_action     text,
  expected_revision bigint,
  target_reason     text,
  target_command_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  return private.set_marketplace_suspension_core(target_kind, target_id, target_action, expected_revision, target_reason, target_command_id);
exception when lock_not_available then
  return jsonb_build_object('status','retry');
end;
$function$;

REVOKE ALL ON FUNCTION public.set_marketplace_suspension(text, uuid, text, bigint, text, uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_marketplace_suspension(text, uuid, text, bigint, text, uuid) TO authenticated;

ALTER TABLE public.account_contexts
  ADD COLUMN customer_suspended boolean DEFAULT false NOT NULL;

ALTER TABLE public.account_contexts
  ADD COLUMN customer_suspension_revision bigint DEFAULT 0 NOT NULL;

ALTER TABLE public.account_contexts
  ADD COLUMN owner_suspension_revision bigint DEFAULT 0 NOT NULL;

ALTER TABLE public.account_contexts
  ADD CONSTRAINT account_suspension_revisions_nonnegative CHECK (customer_suspension_revision >= 0 AND owner_suspension_revision >= 0);

ALTER TABLE public.booking_request_release_work
  ADD COLUMN suspension_action_id uuid;

ALTER TABLE public.booking_request_release_work
  ADD CONSTRAINT booking_request_release_work_suspension_action_fkey FOREIGN KEY (suspension_action_id) REFERENCES private.marketplace_suspension_actions(id) ON DELETE RESTRICT;

CREATE INDEX booking_request_release_work_suspension_action_idx ON public.booking_request_release_work (suspension_action_id)
  WHERE suspension_action_id IS NOT NULL;

CREATE INDEX booking_requests_pending_profile_idx ON public.booking_requests (profile_id, id)
  WHERE status = 'pending'::text;

ALTER TABLE public.owner_application_cottage_profiles
  ADD COLUMN business_suspended boolean DEFAULT false NOT NULL;

ALTER TABLE public.owner_application_cottage_profiles
  ADD COLUMN suspension_revision bigint DEFAULT 0 NOT NULL;

ALTER TABLE public.owner_application_cottage_profiles
  ADD CONSTRAINT cottage_suspension_revision_nonnegative CHECK (suspension_revision >= 0);

ALTER TABLE public.owner_application_cottage_profiles
  ADD COLUMN listing_state_before_suspension public.cottage_marketplace_state;

ALTER TABLE public.owner_application_cottage_profiles
  ADD CONSTRAINT cottage_suspension_prior_listing_state
    CHECK
    (listing_state_before_suspension IS NULL OR (listing_state_before_suspension = ANY (ARRAY['published'::public.cottage_marketplace_state,
    'paused'::public.cottage_marketplace_state])));
REVOKE ALL ON TABLE private.marketplace_suspension_actions FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.set_marketplace_suspension_core(text,uuid,text,bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.prepare_booking_request_release(uuid,uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.prepare_owner_application_renewal(uuid,uuid,public.owner_verification_document_kind[]) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.set_marketplace_suspension(text,uuid,text,bigint,text,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.get_marketplace_suspension(text,uuid,timestamptz,uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.set_marketplace_suspension(text,uuid,text,bigint,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_marketplace_suspension(text,uuid,timestamptz,uuid,integer) TO authenticated;
