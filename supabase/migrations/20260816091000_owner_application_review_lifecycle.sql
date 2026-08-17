alter table public.owner_applications
  drop constraint owner_application_submission_time_matches_status;

alter table public.owner_applications
  add column version bigint not null default 1 check (version >= 1),
  add column review_started_at timestamptz,
  add column review_due_at timestamptz,
  add column review_remaining interval not null default interval '72 hours'
    check (review_remaining between interval '0 seconds' and interval '72 hours'),
  add column review_paused_at timestamptz,
  add column decided_at timestamptz;

update public.owner_applications
set review_started_at = submitted_at,
    review_due_at = submitted_at + interval '72 hours'
where status = 'submitted';

alter table public.owner_applications
  add constraint owner_application_submission_time_matches_status check (
    (status = 'draft' and submitted_at is null)
    or (status <> 'draft' and submitted_at is not null)
  ),
  add constraint owner_application_review_clock_matches_status check (
    (status = 'draft' and review_started_at is null and review_due_at is null)
    or (status = 'needs_information' and review_started_at is not null
      and review_due_at is null and review_paused_at is not null)
    or (status = 'submitted' and (
      (review_started_at is null and review_due_at is null and review_paused_at is null)
      or (review_started_at is not null and review_due_at is not null and review_paused_at is null)
    ))
    or (status = 'under_review' and review_started_at is not null
      and review_due_at is not null and review_paused_at is null)
    or (status in ('approved', 'rejected', 'expired', 'suspended')
      and review_started_at is not null and review_due_at is null)
  );

alter table public.owner_verification_documents
  add column content_digest text default repeat('0', 64),
  add column digest_source text not null default 'legacy_metadata'
    check (digest_source in ('legacy_metadata', 'sha256'));

update public.owner_verification_documents
set content_digest = encode(
  extensions.digest(
    convert_to(object_path || ':' || size_bytes::text || ':' || updated_at::text, 'UTF8'),
    'sha256'
  ),
  'hex'
);

alter table public.owner_verification_documents
  alter column content_digest set not null,
  add constraint owner_verification_document_digest_shape check (
    content_digest ~ '^[0-9a-f]{64}$'
  );

alter table public.owner_verification_document_cleanup
  add column content_digest text,
  add column digest_source text check (digest_source in ('legacy_metadata', 'sha256')),
  add constraint owner_verification_cleanup_digest_shape check (
    content_digest is null or content_digest ~ '^[0-9a-f]{64}$'
  );

create table public.owner_verification_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  application_id uuid not null references public.owner_applications (id) on delete restrict,
  kind public.owner_verification_document_kind not null,
  version integer not null check (version >= 1),
  object_path text not null,
  original_filename text not null,
  media_type text not null,
  size_bytes integer not null,
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  digest_source text not null check (digest_source in ('legacy_metadata', 'sha256')),
  recorded_at timestamptz not null default now(),
  unique (document_id, version)
);

insert into public.owner_verification_document_versions (
  document_id, application_id, kind, version, object_path, original_filename,
  media_type, size_bytes, content_digest, digest_source, recorded_at
)
select id, application_id, kind, 1, object_path, original_filename, media_type,
  size_bytes, content_digest, digest_source, updated_at
from public.owner_verification_documents;

create function public.record_owner_verification_document_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.object_path = old.object_path
    and new.content_digest = old.content_digest then
    return new;
  end if;

  insert into public.owner_verification_document_versions (
    document_id, application_id, kind, version, object_path, original_filename,
    media_type, size_bytes, content_digest, digest_source
  )
  values (
    new.id, new.application_id, new.kind,
    coalesce((select max(version) + 1
      from public.owner_verification_document_versions
      where document_id = new.id), 1),
    new.object_path, new.original_filename, new.media_type, new.size_bytes,
    new.content_digest, new.digest_source
  );
  return new;
end;
$$;

revoke all on function public.record_owner_verification_document_version() from public;

create trigger record_owner_verification_document_version
after insert or update of object_path, content_digest
on public.owner_verification_documents
for each row execute function public.record_owner_verification_document_version();

create table public.owner_application_information_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.owner_applications (id) on delete restrict,
  requested_by_user_id uuid references auth.users (id) on delete set null,
  requested_by_subject_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 1000),
  requested_fields text[] not null default '{}',
  requested_document_kinds public.owner_verification_document_kind[] not null default '{}',
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  response_version bigint,
  constraint owner_application_information_request_has_scope check (
    cardinality(requested_fields) + cardinality(requested_document_kinds) > 0
  ),
  constraint owner_application_information_request_completion check (
    (responded_at is null and response_version is null)
    or (responded_at is not null and response_version is not null)
  )
);

create unique index owner_application_one_open_information_request_idx
  on public.owner_application_information_requests (application_id)
  where responded_at is null;

create table public.owner_application_transitions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.owner_applications (id) on delete restrict,
  from_status public.owner_application_status not null,
  to_status public.owner_application_status not null,
  application_version bigint not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_subject_id text not null,
  reason text,
  occurred_at timestamptz not null default now(),
  unique (application_id, application_version)
);

create index owner_application_transitions_history_idx
  on public.owner_application_transitions (application_id, occurred_at, id);

insert into public.owner_application_transitions (
  application_id,
  from_status,
  to_status,
  application_version,
  actor_user_id,
  actor_subject_id,
  occurred_at
)
select
  applications.id,
  'draft',
  'submitted',
  applications.version,
  applications.owner_user_id,
  applications.owner_user_id::text,
  applications.submitted_at
from public.owner_applications applications
where applications.status = 'submitted'
on conflict (application_id, application_version) do nothing;

create table public.owner_application_notices (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.owner_applications (id) on delete restrict,
  owner_user_id uuid not null references public.account_contexts (user_id) on delete restrict,
  kind text not null check (kind in (
    'information_requested', 'response_received', 'approved', 'rejected',
    'expired', 'suspended'
  )),
  reason text,
  created_at timestamptz not null default now()
);

create index owner_application_notices_owner_idx
  on public.owner_application_notices (owner_user_id, created_at desc);

create table public.owner_application_verification_records (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.owner_applications (id) on delete restrict,
  version integer not null check (version >= 1),
  reviewer_user_id uuid references auth.users (id) on delete set null,
  reviewer_subject_id uuid not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text not null check (char_length(reason) between 1 and 1000),
  jurisdiction text not null check (char_length(jurisdiction) between 1 and 120),
  licensing_basis public.owner_licensing_basis not null,
  licence_or_exemption_basis text not null
    check (char_length(licence_or_exemption_basis) between 1 and 1000),
  evidence_version_ids uuid[] not null,
  evidence_types public.owner_verification_document_kind[] not null,
  relevant_expiry_dates jsonb not null default '{}'::jsonb,
  decided_at timestamptz not null default now(),
  unique (application_id, version)
);

alter table public.owner_applications
  add column current_verification_record_id uuid
    references public.owner_application_verification_records (id) on delete restrict;

create table public.owner_application_renewal_work (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.owner_applications (id) on delete restrict,
  verification_record_id uuid not null
    references public.owner_application_verification_records (id) on delete restrict,
  requested_document_kinds public.owner_verification_document_kind[] not null,
  status text not null default 'open' check (status in ('open', 'submitted', 'completed')),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz
);

create unique index owner_application_one_open_renewal_idx
  on public.owner_application_renewal_work (application_id)
  where status in ('open', 'submitted');

create table public.owner_application_lifecycle_control (
  singleton boolean primary key default true check (singleton),
  expiry_processor_enabled boolean not null default false,
  activated_at timestamptz,
  cron_installed_at timestamptz
);

insert into public.owner_application_lifecycle_control (singleton) values (true);

create function public.reject_owner_application_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Owner Application history is append-only' using errcode = 'RC405';
end;
$$;

revoke all on function public.reject_owner_application_history_mutation() from public;

create trigger owner_verification_versions_are_immutable
before update or delete on public.owner_verification_document_versions
for each row execute function public.reject_owner_application_history_mutation();

create trigger owner_verification_records_are_immutable
before update or delete on public.owner_application_verification_records
for each row execute function public.reject_owner_application_history_mutation();

create trigger owner_application_transitions_are_immutable
before update or delete on public.owner_application_transitions
for each row execute function public.reject_owner_application_history_mutation();

alter table public.owner_application_information_requests enable row level security;
alter table public.owner_application_transitions enable row level security;
alter table public.owner_application_notices enable row level security;
alter table public.owner_verification_document_versions enable row level security;
alter table public.owner_application_verification_records enable row level security;
alter table public.owner_application_renewal_work enable row level security;
alter table public.owner_application_lifecycle_control enable row level security;

drop policy "Applicant or MFA administrator reads Owner Applications"
  on public.owner_applications;
create policy "Applicant or MFA administrator reads Owner Applications"
on public.owner_applications for select to authenticated
using (
  owner_user_id = (select auth.uid())
  or (
    status <> 'draft'
    and (select public.is_platform_administrator('aal2'))
  )
);

create policy "MFA administrator reads information requests"
on public.owner_application_information_requests for select to authenticated
using ((select public.is_platform_administrator('aal2')));

create policy "MFA administrator reads transition history"
on public.owner_application_transitions for select to authenticated
using ((select public.is_platform_administrator('aal2')));

create policy "Applicant reads in-product notices"
on public.owner_application_notices for select to authenticated
using (owner_user_id = (select auth.uid()));

create policy "MFA administrator reads evidence versions"
on public.owner_verification_document_versions for select to authenticated
using ((select public.is_platform_administrator('aal2')));

create policy "MFA administrator reads verification records"
on public.owner_application_verification_records for select to authenticated
using ((select public.is_platform_administrator('aal2')));

create policy "Applicant or MFA administrator reads renewal work"
on public.owner_application_renewal_work for select to authenticated
using (
  exists (
    select 1 from public.owner_applications
    where id = application_id and owner_user_id = (select auth.uid())
  )
  or (select public.is_platform_administrator('aal2'))
);

grant select on public.owner_application_information_requests to authenticated;
grant select on public.owner_application_transitions to authenticated;
grant select on public.owner_application_notices to authenticated;
grant select on public.owner_verification_document_versions to authenticated;
grant select on public.owner_application_verification_records to authenticated;
grant select on public.owner_application_renewal_work to authenticated;
grant select on public.owner_application_lifecycle_control to service_role;

create function public.owner_application_active_information_request()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reason', requests.reason,
    'requested_fields', requests.requested_fields,
    'requested_document_kinds', requests.requested_document_kinds
  )
  from public.owner_application_information_requests requests
  join public.owner_applications applications
    on applications.id = requests.application_id
  where applications.owner_user_id = (select auth.uid())
    and applications.status = 'needs_information'
    and requests.responded_at is null
  order by requests.requested_at desc
  limit 1;
$$;

revoke all on function public.owner_application_active_information_request() from public;
grant execute on function public.owner_application_active_information_request() to authenticated;

drop policy "Cottage Owner reads own cottage scope" on public.cottage_ownership;
create policy "Cottage Owner reads own servicing scope"
on public.cottage_ownership for select to authenticated
using (
  owner_user_id = (select auth.uid())
  and exists (
    select 1 from public.account_contexts
    where user_id = (select auth.uid())
      and role = 'cottage_owner'
      and owner_approval_state in ('approved', 'expired', 'suspended')
  )
);

create or replace function public.submit_owner_application()
returns public.owner_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.owner_applications;
begin
  if not (select public.is_current_prospective_owner()) then
    raise exception 'Prospective Cottage Owner access is required'
      using errcode = '42501';
  end if;

  select * into application
  from public.owner_applications
  where owner_user_id = (select auth.uid())
  for update;

  if application.status = 'submitted' then return application; end if;
  if application.status <> 'draft' then
    raise exception 'A Draft Owner Application is required' using errcode = 'RC202';
  end if;
  if cardinality(public.owner_application_missing_items()) > 0 then
    raise exception 'The Owner Application is incomplete' using errcode = 'RC203';
  end if;

  update public.owner_applications
  set status = 'submitted', submitted_at = now(), review_started_at = now(),
      review_due_at = now() + interval '72 hours',
      review_remaining = interval '72 hours', version = version + 1,
      updated_at = now()
  where id = application.id
  returning * into application;

  insert into public.owner_application_transitions (
    application_id, from_status, to_status, application_version,
    actor_user_id, actor_subject_id
  ) values (
    application.id, 'draft', 'submitted', application.version,
    (select auth.uid()), (select auth.uid())::text
  );
  return application;
end;
$$;

create function public.owner_application_parse_expiry_date(value text)
returns date
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  parsed date;
begin
  if value is null or value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  begin
    parsed := value::date;
  exception when others then
    return null;
  end;
  if to_char(parsed, 'YYYY-MM-DD') <> value then
    return null;
  end if;
  return parsed;
end;
$$;

revoke all on function public.owner_application_parse_expiry_date(text) from public;

create function public.review_owner_application(
  target_application_id uuid,
  expected_version bigint,
  requested_action text,
  requested_reason text,
  requested_fields text[],
  requested_document_kinds public.owner_verification_document_kind[],
  requested_jurisdiction text,
  requested_licensing_basis public.owner_licensing_basis,
  requested_licence_or_exemption_basis text,
  requested_expiry_dates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.owner_applications;
  previous_status public.owner_application_status;
  verification_record_id uuid;
  evidence_version_ids uuid[];
  evidence_types public.owner_verification_document_kind[];
  result_status public.owner_application_status;
begin
  if not (select public.is_platform_administrator('aal2')) then
    raise exception 'Platform Administrator MFA is required' using errcode = '42501';
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
  elsif requested_action = 'suspend' then
    if application.status not in ('approved', 'expired')
      or char_length(btrim(coalesce(requested_reason, ''))) not between 1 and 1000 then
      raise exception 'This suspension is invalid' using errcode = 'RC422';
    end if;
    result_status := 'suspended';
    update public.owner_applications
    set status = result_status, review_due_at = null, review_paused_at = null,
      version = version + 1, updated_at = now()
    where id = application.id returning * into application;
    update public.account_contexts set owner_approval_state = 'suspended', updated_at = now()
    where user_id = application.owner_user_id;
    insert into public.owner_application_notices (application_id, owner_user_id, kind, reason)
    values (application.id, application.owner_user_id, 'suspended', btrim(requested_reason));
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
$$;

revoke all on function public.review_owner_application(
  uuid, bigint, text, text, text[], public.owner_verification_document_kind[],
  text, public.owner_licensing_basis, text, jsonb
) from public;
grant execute on function public.review_owner_application(
  uuid, bigint, text, text, text[], public.owner_verification_document_kind[],
  text, public.owner_licensing_basis, text, jsonb
) to authenticated;

create function public.respond_to_owner_application_request(
  expected_version bigint,
  requested_field_values jsonb,
  confirmed_document_kinds public.owner_verification_document_kind[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.owner_applications;
  information_request public.owner_application_information_requests;
  supplied_fields text[];
  supplied_document_kinds public.owner_verification_document_kind[];
begin
  select * into application from public.owner_applications
  where owner_user_id = (select auth.uid()) for update;
  if not found or application.status <> 'needs_information' then
    raise exception 'An active information request is required' using errcode = 'RC422';
  end if;
  if application.version <> expected_version then
    raise exception 'Owner Application changed before this response' using errcode = 'RC409';
  end if;
  select * into information_request from public.owner_application_information_requests
  where application_id = application.id and responded_at is null for update;
  if not found or jsonb_typeof(requested_field_values) <> 'object' then
    raise exception 'The information response is invalid' using errcode = 'RC422';
  end if;
  select coalesce(array_agg(key order by key), '{}') into supplied_fields
  from jsonb_object_keys(requested_field_values) key;
  if supplied_fields <> (
    select coalesce(array_agg(field order by field), '{}')
    from unnest(information_request.requested_fields) field
  ) then
    raise exception 'Only the requested fields may be changed' using errcode = 'RC422';
  end if;

  if exists (
    select 1
    from jsonb_each(requested_field_values) supplied(key, value)
    where case
      when supplied.key in (
        'legal_name', 'cottage_name', 'governorate', 'approximate_location',
        'exact_address', 'description', 'house_rules'
      ) then
        jsonb_typeof(supplied.value) is distinct from 'string'
        or char_length(btrim(supplied.value #>> '{}')) not between 1 and case supplied.key
          when 'legal_name' then 120
          when 'cottage_name' then 120
          when 'governorate' then 120
          when 'approximate_location' then 240
          when 'exact_address' then 240
          when 'description' then 2000
          when 'house_rules' then 1500
        end
      when supplied.key in ('company_name', 'exemption_basis') then
        jsonb_typeof(supplied.value) is distinct from 'string'
        or char_length(btrim(supplied.value #>> '{}')) > case supplied.key
          when 'company_name' then 120 else 1000 end
      when supplied.key = 'licensing_basis' then
        jsonb_typeof(supplied.value) is distinct from 'string'
        or (supplied.value #>> '{}') not in ('licence', 'exemption')
      when supplied.key in ('capacity', 'bedrooms', 'bathrooms') then
        case
          when jsonb_typeof(supplied.value) is distinct from 'number' then true
          when supplied.value::text !~ '^\d+$' then true
          else (supplied.value::text)::numeric not between 1 and case supplied.key
            when 'capacity' then 100 else 50 end
        end
      when supplied.key = 'amenities' then
        case
          when jsonb_typeof(supplied.value) is distinct from 'array' then true
          else jsonb_array_length(supplied.value) > 6
            or exists (
              select 1 from jsonb_array_elements(supplied.value) amenity
              where jsonb_typeof(amenity) is distinct from 'string'
                or (amenity #>> '{}') not in (
                  'garden', 'parking', 'pool', 'air_conditioning', 'wifi', 'outdoor_seating'
                )
            )
        end
      else true
    end
  ) then
    raise exception 'A requested field value is invalid' using errcode = 'RC422';
  end if;

  if (
    select coalesce(array_agg(kind order by kind::text), '{}')
    from unnest(coalesce(confirmed_document_kinds, '{}')) kind
  ) <> (
    select coalesce(array_agg(kind order by kind::text), '{}')
    from unnest(information_request.requested_document_kinds) kind
  ) then
    raise exception 'Every requested evidence kind is required' using errcode = 'RC422';
  end if;

  select coalesce(array_agg(versions.kind order by versions.kind::text), '{}')
  into supplied_document_kinds
  from public.owner_verification_document_versions versions
  join public.owner_verification_documents documents on documents.id = versions.document_id
  where versions.application_id = application.id
    and versions.object_path = documents.object_path
    and versions.content_digest = documents.content_digest
    and versions.digest_source = 'sha256'
    and versions.recorded_at >= information_request.requested_at
    and versions.kind = any(information_request.requested_document_kinds);
  if supplied_document_kinds <> (
    select coalesce(array_agg(kind order by kind::text), '{}')
    from unnest(information_request.requested_document_kinds) kind
  ) then
    raise exception 'Every requested evidence version is required' using errcode = 'RC422';
  end if;

  update public.owner_applications set
    legal_name = case when requested_field_values ? 'legal_name'
      then nullif(btrim(requested_field_values ->> 'legal_name'), '') else legal_name end,
    company_name = case when requested_field_values ? 'company_name'
      then nullif(btrim(requested_field_values ->> 'company_name'), '') else company_name end,
    licensing_basis = case when requested_field_values ? 'licensing_basis'
      then (requested_field_values ->> 'licensing_basis')::public.owner_licensing_basis
      else licensing_basis end,
    exemption_basis = case
      when requested_field_values ->> 'licensing_basis' = 'licence' then null
      when requested_field_values ? 'exemption_basis'
        then nullif(btrim(requested_field_values ->> 'exemption_basis'), '')
      else exemption_basis end,
    updated_at = now()
  where id = application.id returning * into application;

  update public.owner_application_cottage_profiles set
    name = case when requested_field_values ? 'cottage_name'
      then nullif(btrim(requested_field_values ->> 'cottage_name'), '') else name end,
    governorate = case when requested_field_values ? 'governorate'
      then nullif(btrim(requested_field_values ->> 'governorate'), '') else governorate end,
    approximate_location = case when requested_field_values ? 'approximate_location'
      then nullif(btrim(requested_field_values ->> 'approximate_location'), '') else approximate_location end,
    exact_address = case when requested_field_values ? 'exact_address'
      then nullif(btrim(requested_field_values ->> 'exact_address'), '') else exact_address end,
    capacity = case when requested_field_values ? 'capacity'
      then (requested_field_values ->> 'capacity')::smallint else capacity end,
    bedrooms = case when requested_field_values ? 'bedrooms'
      then (requested_field_values ->> 'bedrooms')::smallint else bedrooms end,
    bathrooms = case when requested_field_values ? 'bathrooms'
      then (requested_field_values ->> 'bathrooms')::smallint else bathrooms end,
    amenities = case when requested_field_values ? 'amenities'
      then array(select jsonb_array_elements_text(requested_field_values -> 'amenities')) else amenities end,
    description = case when requested_field_values ? 'description'
      then nullif(btrim(requested_field_values ->> 'description'), '') else description end,
    house_rules = case when requested_field_values ? 'house_rules'
      then nullif(btrim(requested_field_values ->> 'house_rules'), '') else house_rules end,
    updated_at = now()
  where application_id = application.id;

  if cardinality(public.owner_application_missing_items()) > 0
    or (application.applicant_kind = 'individual' and application.company_name is not null)
    or (application.licensing_basis = 'licence' and application.exemption_basis is not null) then
    raise exception 'The Owner Application response is incomplete' using errcode = 'RC422';
  end if;

  update public.owner_applications
  set status = 'under_review', review_due_at = now() + review_remaining,
    review_paused_at = null, version = version + 1, updated_at = now()
  where id = application.id returning * into application;

  update public.owner_application_information_requests
  set responded_at = now(), response_version = application.version
  where id = information_request.id;
  insert into public.owner_application_transitions (
    application_id, from_status, to_status, application_version,
    actor_user_id, actor_subject_id
  ) values (
    application.id, 'needs_information', 'under_review', application.version,
    (select auth.uid()), (select auth.uid())::text
  );
  insert into public.owner_application_notices (application_id, owner_user_id, kind)
  values (application.id, application.owner_user_id, 'response_received');

  return jsonb_build_object(
    'application_id', application.id, 'status', application.status,
    'version', application.version, 'occurred_at', application.updated_at,
    'review_due_at', application.review_due_at
  );
end;
$$;

revoke all on function public.respond_to_owner_application_request(
  bigint, jsonb, public.owner_verification_document_kind[]
) from public;
grant execute on function public.respond_to_owner_application_request(
  bigint, jsonb, public.owner_verification_document_kind[]
) to authenticated;

create function public.owner_can_start_new_business(target_owner_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or ((select auth.uid()) <> target_owner_user_id
      and not (select public.is_platform_administrator('aal2'))) then
    raise exception 'Owner eligibility access is denied' using errcode = '42501';
  end if;

  return exists (
    select 1
    from public.owner_applications applications
    join public.account_contexts contexts on contexts.user_id = applications.owner_user_id
    join public.owner_application_verification_records records
      on records.id = applications.current_verification_record_id
    where applications.owner_user_id = target_owner_user_id
      and applications.status = 'approved'
      and contexts.owner_approval_state = 'approved'
      and not exists (
        select 1 from jsonb_each_text(records.relevant_expiry_dates) expiry
        where public.owner_application_parse_expiry_date(expiry.value) is null
          or public.owner_application_parse_expiry_date(expiry.value) <= current_date
      )
  );
end;
$$;

revoke all on function public.owner_can_start_new_business(uuid) from public;
grant execute on function public.owner_can_start_new_business(uuid) to authenticated;

create function public.activate_owner_application_lifecycle()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.owner_application_lifecycle_control
  set expiry_processor_enabled = true, activated_at = now()
  where singleton;
$$;

revoke all on function public.activate_owner_application_lifecycle() from public;
grant execute on function public.activate_owner_application_lifecycle() to service_role;

create function public.process_expired_owner_applications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
    insert into public.owner_application_renewal_work (
      application_id, verification_record_id, requested_document_kinds
    ) values (candidate.id, candidate.verification_record_id, expired_kinds);
    insert into public.owner_application_transitions (
      application_id, from_status, to_status, application_version, actor_subject_id,
      reason
    ) values (
      candidate.id, 'approved', 'expired', candidate.version + 1,
      'owner-application-expiry-processor', 'Required evidence expired'
    );
    insert into public.owner_application_notices (application_id, owner_user_id, kind)
    values (candidate.id, candidate.owner_user_id, 'expired');
    processed := processed + 1;
  end loop;
  return processed;
end;
$$;

revoke all on function public.process_expired_owner_applications() from public;
grant execute on function public.process_expired_owner_applications() to service_role;

create function public.install_owner_application_expiry_cron()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.owner_application_lifecycle_control
    where singleton and expiry_processor_enabled
  ) then
    raise exception 'Owner Application lifecycle must be activated first' using errcode = 'RC503';
  end if;
  if to_regnamespace('cron') is null then return false; end if;
  execute $cron$
    select cron.schedule(
      'owner-application-evidence-expiry',
      '15 * * * *',
      'select public.process_expired_owner_applications()'
    )
  $cron$;
  update public.owner_application_lifecycle_control
  set cron_installed_at = now() where singleton;
  return true;
end;
$$;

revoke all on function public.install_owner_application_expiry_cron() from public;
grant execute on function public.install_owner_application_expiry_cron() to service_role;

create function public.prepare_owner_verification_document_upload_v2(
  requested_owner_user_id uuid,
  requested_application_id uuid,
  requested_kind public.owner_verification_document_kind,
  requested_object_path text,
  requested_original_filename text,
  requested_media_type text,
  requested_size_bytes integer,
  requested_content_digest text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.owner_applications;
  cleanup_id uuid;
  expected_extension text;
  requested_in_active_work boolean;
begin
  select * into application from public.owner_applications
  where id = requested_application_id and owner_user_id = requested_owner_user_id
  for update;
  if not found then
    raise exception 'Owner Application was not found' using errcode = 'RC202';
  end if;

  requested_in_active_work :=
    (
      application.status = 'needs_information'
      and exists (
        select 1 from public.owner_application_information_requests
        where application_id = application.id and responded_at is null
          and requested_kind = any(requested_document_kinds)
      )
    )
    or (
      application.status = 'expired'
      and exists (
        select 1 from public.owner_application_renewal_work
        where application_id = application.id and status = 'open'
          and requested_kind = any(requested_document_kinds)
      )
    );
  if application.status <> 'draft' and not requested_in_active_work then
    raise exception 'The evidence kind is not requested' using errcode = 'RC202';
  end if;
  if application.status = 'draft' and not public.owner_verification_kind_is_required(
    application.applicant_kind, application.licensing_basis, requested_kind
  ) then
    raise exception 'The evidence kind is not required' using errcode = 'RC205';
  end if;
  if requested_content_digest !~ '^[0-9a-f]{64}$'
    or requested_media_type not in ('application/pdf', 'image/jpeg', 'image/png')
    or requested_size_bytes not between 1 and 5242880
    or char_length(btrim(coalesce(requested_original_filename, ''))) not between 1 and 180 then
    raise exception 'The verification document is invalid' using errcode = 'RC205';
  end if;
  expected_extension := case requested_media_type
    when 'application/pdf' then 'pdf'
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
  end;
  if requested_object_path !~ (
    '^' || requested_owner_user_id::text || '/' || application.id::text || '/'
    || requested_kind::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.'
    || expected_extension || '$'
  ) then
    raise exception 'The verification object path is invalid' using errcode = 'RC205';
  end if;

  insert into public.owner_verification_document_cleanup (
    application_id, actor_user_id, actor_subject_id, reason, kind, object_path,
    original_filename, media_type, size_bytes, content_digest, digest_source
  ) values (
    application.id, requested_owner_user_id, requested_owner_user_id,
    'unregistered_upload', requested_kind, requested_object_path,
    btrim(requested_original_filename), requested_media_type,
    requested_size_bytes, requested_content_digest, 'sha256'
  ) returning id into cleanup_id;
  return cleanup_id;
end;
$$;

revoke all on function public.prepare_owner_verification_document_upload_v2(
  uuid, uuid, public.owner_verification_document_kind, text, text, text, integer, text
) from public;
grant execute on function public.prepare_owner_verification_document_upload_v2(
  uuid, uuid, public.owner_verification_document_kind, text, text, text, integer, text
) to service_role;

create function public.register_owner_verification_document_v2(target_cleanup_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleanup public.owner_verification_document_cleanup;
  application public.owner_applications;
  existing_document public.owner_verification_documents;
  document public.owner_verification_documents;
  action public.owner_verification_document_action := 'uploaded';
  stored_metadata jsonb;
  previous_cleanup_id uuid;
  requested_in_active_work boolean;
begin
  select * into cleanup from public.owner_verification_document_cleanup
  where id = target_cleanup_id and reason = 'unregistered_upload'
    and status = 'pending' and digest_source = 'sha256'
  for update;
  if not found then
    raise exception 'The verification upload operation is invalid' using errcode = 'RC205';
  end if;
  select * into application from public.owner_applications
  where id = cleanup.application_id for update;

  requested_in_active_work :=
    (
      application.status = 'needs_information'
      and exists (
        select 1 from public.owner_application_information_requests
        where application_id = application.id and responded_at is null
          and cleanup.kind = any(requested_document_kinds)
      )
    )
    or (
      application.status = 'expired'
      and exists (
        select 1 from public.owner_application_renewal_work
        where application_id = application.id and status = 'open'
          and cleanup.kind = any(requested_document_kinds)
      )
    );
  if not found or (application.status <> 'draft' and not requested_in_active_work) then
    raise exception 'The evidence kind is not requested' using errcode = 'RC202';
  end if;

  select metadata into stored_metadata from storage.objects
  where bucket_id = public.owner_verification_bucket_name()
    and name = cleanup.object_path;
  if not found or stored_metadata ->> 'mimetype' <> cleanup.media_type
    or coalesce(stored_metadata ->> 'size', '') !~ '^[0-9]+$'
    or (stored_metadata ->> 'size')::integer <> cleanup.size_bytes then
    raise exception 'The uploaded object does not match its metadata' using errcode = 'RC205';
  end if;

  select * into existing_document from public.owner_verification_documents
  where application_id = cleanup.application_id and kind = cleanup.kind;
  if found then action := 'replaced'; end if;

  insert into public.owner_verification_documents (
    application_id, kind, object_path, original_filename, media_type, size_bytes,
    content_digest, digest_source
  ) values (
    cleanup.application_id, cleanup.kind, cleanup.object_path,
    cleanup.original_filename, cleanup.media_type, cleanup.size_bytes,
    cleanup.content_digest, 'sha256'
  )
  on conflict (application_id, kind) do update set
    object_path = excluded.object_path,
    original_filename = excluded.original_filename,
    media_type = excluded.media_type,
    size_bytes = excluded.size_bytes,
    content_digest = excluded.content_digest,
    digest_source = excluded.digest_source,
    updated_at = now()
  returning * into document;

  insert into public.owner_verification_document_audit (
    document_id, actor_user_id, actor_subject_id, action, object_path
  ) values (
    document.id, cleanup.actor_user_id, cleanup.actor_subject_id, action,
    document.object_path
  );
  if existing_document.id is not null then
    insert into public.owner_verification_document_cleanup (
      application_id, document_id, actor_user_id, actor_subject_id, reason,
      kind, object_path, original_filename, media_type, size_bytes,
      content_digest, digest_source
    ) values (
      cleanup.application_id, document.id, cleanup.actor_user_id,
      cleanup.actor_subject_id, 'replaced', existing_document.kind,
      existing_document.object_path, existing_document.original_filename,
      existing_document.media_type, existing_document.size_bytes,
      existing_document.content_digest, existing_document.digest_source
    ) returning id into previous_cleanup_id;
  end if;
  update public.owner_verification_document_cleanup
  set status = 'completed', completed_at = now(), document_id = document.id,
    replacement_cleanup_id = previous_cleanup_id
  where id = cleanup.id;
  return jsonb_build_object(
    'document_id', document.id,
    'previous_object_path', existing_document.object_path,
    'previous_cleanup_id', previous_cleanup_id
  );
end;
$$;

revoke all on function public.register_owner_verification_document_v2(uuid) from public;
grant execute on function public.register_owner_verification_document_v2(uuid) to service_role;

create function public.submit_owner_application_renewal(
  expected_version bigint,
  confirmed_document_kinds public.owner_verification_document_kind[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.owner_applications;
  renewal public.owner_application_renewal_work;
  current_kinds public.owner_verification_document_kind[];
begin
  select * into application from public.owner_applications
  where owner_user_id = (select auth.uid()) for update;
  if not found or application.status <> 'expired' then
    raise exception 'Open renewal work is required' using errcode = 'RC422';
  end if;
  if application.version <> expected_version then
    raise exception 'Owner Application changed before renewal submission' using errcode = 'RC409';
  end if;
  select * into renewal from public.owner_application_renewal_work
  where application_id = application.id and status = 'open' for update;
  if not found or (
    select array_agg(kind order by kind::text)
    from unnest(coalesce(confirmed_document_kinds, '{}')) kind
  ) <> (
    select array_agg(kind order by kind::text)
    from unnest(renewal.requested_document_kinds) kind
  ) then
    raise exception 'Every renewal evidence kind is required' using errcode = 'RC422';
  end if;
  select array_agg(versions.kind order by versions.kind::text)
  into current_kinds
  from public.owner_verification_document_versions versions
  join public.owner_verification_documents documents on documents.id = versions.document_id
  where versions.application_id = application.id
    and versions.kind = any(renewal.requested_document_kinds)
    and versions.object_path = documents.object_path
    and versions.content_digest = documents.content_digest
    and versions.digest_source = 'sha256'
    and versions.recorded_at >= renewal.created_at;
  if current_kinds <> (
    select array_agg(kind order by kind::text)
    from unnest(renewal.requested_document_kinds) kind
  ) then
    raise exception 'Replacement evidence is required' using errcode = 'RC422';
  end if;

  update public.owner_applications
  set status = 'under_review', review_started_at = now(),
    review_due_at = now() + interval '72 hours',
    review_remaining = interval '72 hours', review_paused_at = null,
    version = version + 1, updated_at = now()
  where id = application.id returning * into application;
  update public.account_contexts
  set owner_approval_state = 'prospective', updated_at = now()
  where user_id = application.owner_user_id;
  update public.owner_application_renewal_work
  set status = 'submitted', submitted_at = now() where id = renewal.id;
  insert into public.owner_application_transitions (
    application_id, from_status, to_status, application_version,
    actor_user_id, actor_subject_id, reason
  ) values (
    application.id, 'expired', 'under_review', application.version,
    (select auth.uid()), (select auth.uid())::text,
    'Replacement evidence submitted'
  );
  insert into public.owner_application_notices (application_id, owner_user_id, kind)
  values (application.id, application.owner_user_id, 'response_received');
  return jsonb_build_object(
    'application_id', application.id, 'status', application.status,
    'version', application.version, 'occurred_at', application.updated_at,
    'review_due_at', application.review_due_at
  );
end;
$$;

revoke all on function public.submit_owner_application_renewal(
  bigint, public.owner_verification_document_kind[]
) from public;
grant execute on function public.submit_owner_application_renewal(
  bigint, public.owner_verification_document_kind[]
) to authenticated;

-- Keep the original Draft implementation available only behind a forward-safe
-- lifecycle guard. This replaces the public signature without rewriting the
-- already-deployed Owner Application migration.
alter function public.save_owner_application(
  public.owner_applicant_kind, text, text, public.owner_licensing_basis, text,
  text, text, text, text, integer, integer, integer, text[], text, text
) rename to save_owner_application_draft_implementation;

revoke all on function public.save_owner_application_draft_implementation(
  public.owner_applicant_kind, text, text, public.owner_licensing_basis, text,
  text, text, text, text, integer, integer, integer, text[], text, text
) from public, authenticated;

create function public.save_owner_application(
  requested_applicant_kind public.owner_applicant_kind,
  requested_legal_name text,
  requested_company_name text,
  requested_licensing_basis public.owner_licensing_basis,
  requested_exemption_basis text,
  requested_cottage_name text,
  requested_governorate text,
  requested_approximate_location text,
  requested_exact_address text,
  requested_capacity integer,
  requested_bedrooms integer,
  requested_bathrooms integer,
  requested_amenities text[],
  requested_description text,
  requested_house_rules text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  application_status public.owner_application_status;
begin
  if not (select public.is_current_prospective_owner()) then
    raise exception 'Prospective Cottage Owner access is required'
      using errcode = '42501';
  end if;

  select status into application_status
  from public.owner_applications
  where owner_user_id = (select auth.uid())
  for update;

  if found and application_status <> 'draft' then
    raise exception 'Only a Draft Owner Application can be changed'
      using errcode = 'RC202';
  end if;

  return public.save_owner_application_draft_implementation(
    requested_applicant_kind,
    requested_legal_name,
    requested_company_name,
    requested_licensing_basis,
    requested_exemption_basis,
    requested_cottage_name,
    requested_governorate,
    requested_approximate_location,
    requested_exact_address,
    requested_capacity,
    requested_bedrooms,
    requested_bathrooms,
    requested_amenities,
    requested_description,
    requested_house_rules
  );
end;
$$;

revoke all on function public.save_owner_application(
  public.owner_applicant_kind, text, text, public.owner_licensing_basis, text,
  text, text, text, text, integer, integer, integer, text[], text, text
) from public;

grant execute on function public.save_owner_application(
  public.owner_applicant_kind, text, text, public.owner_licensing_basis, text,
  text, text, text, text, integer, integer, integer, text[], text, text
) to authenticated;
