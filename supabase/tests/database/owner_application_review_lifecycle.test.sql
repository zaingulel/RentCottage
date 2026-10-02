begin;

create extension if not exists pgtap with schema extensions;

select plan(82);

select has_table('public', 'owner_application_transitions', 'application transitions are durable');
select has_table('public', 'owner_application_information_requests', 'scoped information requests are durable');
select has_table('public', 'owner_application_notices', 'Owner Backoffice notices are durable');
select has_table('public', 'owner_verification_document_versions', 'verification evidence is versioned');
select has_table('public', 'owner_application_verification_records', 'decisions bind an immutable verification record');
select has_table('public', 'owner_application_renewal_work', 'evidence expiry creates renewal work');
select hasnt_column('public', 'owner_application_notices', 'read_at',
  'notices do not imply unimplemented read acknowledgement');

insert into auth.users (id, aud, role, phone, phone_confirmed_at, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000301', 'authenticated', 'authenticated', '+9647500000301', now(), null, null),
  ('00000000-0000-0000-0000-000000000304', 'authenticated', 'authenticated', null, null, 'reviewer@example.test', now()),
  ('00000000-0000-0000-0000-000000000305', 'authenticated', 'authenticated', '+9647500000305', now(), null, null),
  ('00000000-0000-0000-0000-000000000306', 'authenticated', 'authenticated', '+9647500000306', now(), null, null);

insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000000301', 'cottage_owner', 'prospective'),
  ('00000000-0000-0000-0000-000000000304', 'platform_administrator', null),
  ('00000000-0000-0000-0000-000000000305', 'cottage_owner', 'prospective'),
  ('00000000-0000-0000-0000-000000000306', 'cottage_owner', 'prospective');

insert into public.owner_applications (
  id, owner_user_id, applicant_kind, legal_name, licensing_basis, status,
  submitted_at, review_started_at, review_due_at
)
values (
  '20000000-0000-4000-8000-000000000305',
  '00000000-0000-0000-0000-000000000305',
  'individual', 'Migrated Submitted Owner', 'licence', 'submitted',
  now() - interval '1 day', now() - interval '1 day',
  now() + interval '2 days'
);

insert into public.owner_application_transitions (
  application_id, from_status, to_status, application_version,
  actor_user_id, actor_subject_id, occurred_at
)
select
  applications.id, 'draft', 'submitted', applications.version,
  applications.owner_user_id, applications.owner_user_id::text,
  applications.submitted_at
from public.owner_applications applications
where applications.status = 'submitted'
on conflict (application_id, application_version) do nothing;

insert into public.owner_application_transitions (
  application_id, from_status, to_status, application_version,
  actor_user_id, actor_subject_id, occurred_at
)
select
  applications.id, 'draft', 'submitted', applications.version,
  applications.owner_user_id, applications.owner_user_id::text,
  applications.submitted_at
from public.owner_applications applications
where applications.status = 'submitted'
on conflict (application_id, application_version) do nothing;

select results_eq(
  $$select count(*)::integer from public.owner_application_transitions
    where application_id = '20000000-0000-4000-8000-000000000305'$$,
  array[1],
  'the submitted-row history backfill is deterministic and collision-safe'
);

select results_eq(
  $$select
      from_status::text,
      to_status::text,
      application_version,
      actor_user_id = owner_user_id,
      actor_subject_id = owner_user_id::text,
      occurred_at = submitted_at
    from public.owner_application_transitions transitions
    join public.owner_applications applications
      on applications.id = transitions.application_id
    where applications.id = '20000000-0000-4000-8000-000000000305'$$,
  $$values ('draft'::text, 'submitted'::text, 1::bigint, true, true, true)$$,
  'the backfill preserves submitted attribution, version, and occurrence time'
);

insert into public.owner_applications (
  id, owner_user_id, applicant_kind, legal_name, licensing_basis, status,
  submitted_at, review_started_at, review_due_at
)
values (
  '20000000-0000-4000-8000-000000000301',
  '00000000-0000-0000-0000-000000000301',
  'individual', 'Lifecycle Owner', 'licence', 'submitted', now(), now(),
  now() + interval '72 hours'
);

insert into public.owner_application_cottage_profiles (
  application_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, description, house_rules
)
values (
  '20000000-0000-4000-8000-000000000301', 'Lifecycle Cottage', 'Erbil',
  'Shaqlawa', 'Private road', 8, 3, 2, 'Description', 'Rules'
);

insert into public.owner_verification_documents (
  id, application_id, kind, object_path, original_filename, media_type, size_bytes
)
values
  ('40000000-0000-4000-8000-000000000301', '20000000-0000-4000-8000-000000000301', 'identity', 'owner/review/identity.pdf', 'identity.pdf', 'application/pdf', 128),
  ('40000000-0000-4000-8000-000000000302', '20000000-0000-4000-8000-000000000301', 'authority_to_rent', 'owner/review/authority.pdf', 'authority.pdf', 'application/pdf', 128),
  ('40000000-0000-4000-8000-000000000303', '20000000-0000-4000-8000-000000000301', 'licensing_or_exemption', 'owner/review/licence.pdf', 'licence.pdf', 'application/pdf', 128),
  ('40000000-0000-4000-8000-000000000304', '20000000-0000-4000-8000-000000000301', 'payout_account', 'owner/review/payout.pdf', 'payout.pdf', 'application/pdf', 128);

update public.owner_verification_documents
set digest_source = 'sha256', content_digest = encode(
  extensions.digest(convert_to(id::text, 'UTF8'), 'sha256'), 'hex'
)
where application_id = '20000000-0000-4000-8000-000000000301';

create function pg_temp.non_draft_save_sqlstate(
  requested_status public.owner_application_status
) returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.owner_applications
  set status = requested_status,
    review_due_at = case when requested_status in ('submitted', 'under_review')
      then now() + interval '72 hours' else null end,
    review_paused_at = case when requested_status = 'needs_information'
      then now() else null end
  where id = '20000000-0000-4000-8000-000000000301';

  begin
    perform public.save_owner_application(
      'individual', 'Bypassed lifecycle', null, 'licence', null,
      'Changed cottage', 'Erbil', 'Shaqlawa', 'Changed address',
      10, 4, 3, array['wifi'], 'Changed description', 'Changed rules'
    );
    return 'NO_ERROR';
  exception when others then
    return sqlstate;
  end;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","role":"authenticated","aal":"aal1"}',
  true
);

select results_eq(
  $$select state::text, pg_temp.non_draft_save_sqlstate(state)
    from unnest(array[
      'submitted', 'needs_information', 'under_review', 'approved',
      'rejected', 'expired', 'suspended'
    ]::public.owner_application_status[]) state$$,
  $$values
    ('submitted'::text, 'RC202'::text),
    ('needs_information'::text, 'RC202'::text),
    ('under_review'::text, 'RC202'::text),
    ('approved'::text, 'RC202'::text),
    ('rejected'::text, 'RC202'::text),
    ('expired'::text, 'RC202'::text),
    ('suspended'::text, 'RC202'::text)$$,
  'the legacy save seam denies every non-draft lifecycle state'
);

select throws_ok(
  $$select public.save_owner_application_draft_implementation(
    'individual', 'Bypassed lifecycle', null, 'licence', null,
    'Changed cottage', 'Erbil', 'Shaqlawa', 'Changed address',
    10, 4, 3, array['wifi'], 'Changed description', 'Changed rules'
  )$$,
  '42501', null, 'the guarded historical implementation is not directly callable'
);

reset role;
select results_eq(
  $$select legal_name, owner_applications.version, name, exact_address
    from public.owner_applications
    join public.owner_application_cottage_profiles
      on application_id = owner_applications.id
    where owner_applications.id = '20000000-0000-4000-8000-000000000301'$$,
  $$values ('Lifecycle Owner'::text, 1::bigint, 'Lifecycle Cottage'::text, 'Private road'::text)$$,
  'denied saves cannot bypass versioning or mutate application data'
);

select is_empty(
  $$select from public.owner_application_transitions
    where application_id = '20000000-0000-4000-8000-000000000301'$$,
  'denied saves cannot bypass lifecycle history'
);

update public.owner_applications
set status = 'submitted', review_due_at = now() + interval '72 hours',
  review_paused_at = null
where id = '20000000-0000-4000-8000-000000000301';

create temporary table review_document_access (grant_data jsonb);
grant select, insert on review_document_access to authenticated, service_role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal1"}',
  true
);

select throws_ok(
  $$select public.review_owner_application(
    '20000000-0000-4000-8000-000000000301', 1, 'start_review', null,
    '{}', '{}', null, null, null, '{}'::jsonb
  )$$,
  '42501', null, 'AAL1 administrator access cannot change lifecycle state'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal2"}',
  true
);

select lives_ok(
  $$insert into review_document_access
    select public.prepare_owner_verification_document_access(
      '40000000-0000-4000-8000-000000000301'
    )$$,
  'Submitted permits an attributed grant for original current evidence'
);

select results_eq(
  $$select grant_data ->> 'object_path' from review_document_access$$,
  array['owner/review/identity.pdf'::text],
  'the original grant targets the owned identity path'
);

reset role;
select results_eq(
  $$select document_id::text, actor_user_id::text, actor_subject_id::text,
      object_path, status::text
    from public.owner_verification_document_access_grants
    where id = (select (grant_data ->> 'grant_id')::uuid from review_document_access)$$,
  $$values ('40000000-0000-4000-8000-000000000301'::text,
    '00000000-0000-0000-0000-000000000304'::text,
    '00000000-0000-0000-0000-000000000304'::text,
    'owner/review/identity.pdf'::text, 'pending'::text)$$,
  'preparation binds current object and administrator attribution'
);

set local role service_role;
select lives_ok(
  $$select public.complete_owner_verification_document_access(
    (select (grant_data ->> 'grant_id')::uuid from review_document_access), 60
  )$$,
  'the trusted service completes the original 60-second access grant'
);

reset role;
select results_eq(
  $$select document_id::text, actor_user_id::text, object_path,
      access_grant_id::text
    from public.owner_verification_document_audit
    where action = 'access_granted'
      and access_grant_id = (select (grant_data ->> 'grant_id')::uuid
        from review_document_access)$$,
  $$select '40000000-0000-4000-8000-000000000301'::text,
      '00000000-0000-0000-0000-000000000304'::text,
      'owner/review/identity.pdf'::text, grant_data ->> 'grant_id'
    from review_document_access$$,
  'completion audits the exact original document, path, actor and grant'
);

select ok(
  (select access_expires_at between occurred_at + interval '59 seconds'
      and occurred_at + interval '61 seconds'
    from public.owner_verification_document_audit
    where access_grant_id = (select (grant_data ->> 'grant_id')::uuid
      from review_document_access)),
  'the completed link expires after 60 seconds'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal2"}',
  true
);

select lives_ok(
  $$select public.review_owner_application(
    '20000000-0000-4000-8000-000000000301', 1, 'start_review', null,
    '{}', '{}', null, null, null, '{}'::jsonb
  )$$,
  'an MFA administrator starts review atomically'
);

select results_eq(
  $$select status::text, version, review_due_at - review_started_at
    from public.owner_applications
    where id = '20000000-0000-4000-8000-000000000301'$$,
  $$values ('under_review'::text, 2::bigint, interval '72 hours')$$,
  'submission owns one exact 72-hour elapsed review clock'
);

select results_eq(
  $$select public.prepare_owner_verification_document_access(
      '40000000-0000-4000-8000-000000000301'
    ) ->> 'object_path'$$,
  array['owner/review/identity.pdf'::text],
  'review-stage document access follows current evidence'
);

select throws_ok(
  $$select public.prepare_owner_verification_document_access(null)$$,
  'RC204', null, 'a null document identifier cannot create a grant'
);

select throws_ok(
  $$select public.prepare_owner_verification_document_access(
    '40000000-0000-4000-8000-000000000399'
  )$$,
  'RC204', null, 'a nonexistent document identifier cannot create a grant'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal1"}',
  true
);
select throws_ok(
  $$select public.prepare_owner_verification_document_access(
    '40000000-0000-4000-8000-000000000301'
  )$$,
  'RC204', null, 'an AAL1 administrator cannot prepare review-stage document access'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select public.prepare_owner_verification_document_access(
    '40000000-0000-4000-8000-000000000301'
  )$$,
  'RC204', null, 'a Cottage Owner cannot prepare review-stage document access'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal2"}',
  true
);

select throws_ok(
  $$select public.review_owner_application(
    '20000000-0000-4000-8000-000000000301', 1, 'reject', 'stale',
    '{}', '{}', null, null, null, '{}'::jsonb
  )$$,
  'RC409', null, 'a stale administrator action is rejected'
);

reset role;
alter table public.owner_applications
  drop constraint owner_application_review_clock_matches_status;
create function pg_temp.request_information_sqlstate()
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.review_owner_application(
    '20000000-0000-4000-8000-000000000301', 2, 'request_information',
    'Provide the renewed licence.', array['exact_address'], '{}',
    null, null, null, '{}'::jsonb
  );
  raise exception 'unexpected success';
exception when others then
  if sqlstate = 'P0001' then return 'NO_ERROR'; end if;
  return sqlstate;
end;
$$;
update public.owner_applications
set review_due_at = null
where id = '20000000-0000-4000-8000-000000000301';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal2"}',
  true
);
select results_eq(
  $$select pg_temp.request_information_sqlstate()$$,
  array['RC422'::text],
  'missing information cannot pause a null review deadline'
);

reset role;
update public.owner_applications
set review_started_at = null, review_due_at = now() + interval '70 hours'
where id = '20000000-0000-4000-8000-000000000301';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal2"}',
  true
);
select results_eq(
  $$select pg_temp.request_information_sqlstate()$$,
  array['RC422'::text],
  'missing information cannot pause an unstarted review clock'
);

reset role;
update public.owner_applications
set review_started_at = now() - interval '2 hours',
  review_due_at = now() + interval '70 hours'
where id = '20000000-0000-4000-8000-000000000301';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal2"}',
  true
);

select lives_ok(
  $$select public.review_owner_application(
    '20000000-0000-4000-8000-000000000301', 2, 'request_information',
    'Provide the renewed licence.', array['exact_address', 'governorate', 'approximate_location', 'capacity', 'amenities'],
    array['licensing_or_exemption']::public.owner_verification_document_kind[],
    null, null, null, '{}'::jsonb
  )$$,
  'a scoped missing-information request pauses review'
);

select results_eq(
  $$select status::text, review_remaining, review_due_at
    from public.owner_applications
    where id = '20000000-0000-4000-8000-000000000301'$$,
  $$values ('needs_information'::text, interval '70 hours', null::timestamptz)$$,
  'the exact unspent target is retained while paused'
);

select throws_ok(
  $$select public.prepare_owner_verification_document_access(
    '40000000-0000-4000-8000-000000000301'
  )$$,
  'RC204', null, 'Needs information denies new document grants'
);

select results_eq(
  $$select requested_fields, requested_document_kinds::text[]
    from public.owner_application_information_requests$$,
  $$values (array['exact_address', 'governorate', 'approximate_location', 'capacity', 'amenities']::text[], array['licensing_or_exemption']::text[])$$,
  'the request records only the information RentCottage needs'
);

reset role;
update public.owner_verification_documents
set content_digest = repeat('b', 64), digest_source = 'sha256',
  object_path = 'owner/review/licence-response.pdf'
where application_id = '20000000-0000-4000-8000-000000000301'
  and kind = 'licensing_or_exemption';

insert into storage.objects (bucket_id, name, owner_id, metadata)
select
  public.owner_verification_bucket_name(), object_path,
  '00000000-0000-0000-0000-000000000301',
  jsonb_build_object('size', size_bytes, 'mimetype', media_type)
from public.owner_verification_documents
where application_id = '20000000-0000-4000-8000-000000000301';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","role":"authenticated","aal":"aal1"}',
  true
);

select results_eq(
  $$select kind::text from public.owner_application_notices order by created_at$$,
  array['information_requested'::text],
  'the applicant receives a durable in-product request notice'
);

select throws_ok(
  $$select public.respond_to_owner_application_request(
    3, '{"legal_name":"Changed"}'::jsonb,
    array['licensing_or_exemption']::public.owner_verification_document_kind[]
  )$$,
  'RC422', null, 'the applicant cannot change an unrequested field'
);

select throws_ok(
  $$select public.respond_to_owner_application_request(
    3, '{"exact_address":"Renewed private address", "governorate":" ", "approximate_location":"Shaqlawa hills", "capacity":8, "amenities":["wifi"]}'::jsonb,
    array['licensing_or_exemption']::public.owner_verification_document_kind[]
  )$$,
  'RC422', null, 'an empty requested text value cannot resume review'
);

select throws_ok(
  $$select public.respond_to_owner_application_request(
    3, '{"exact_address":"Renewed private address", "governorate":"Erbil", "approximate_location":"Shaqlawa hills", "capacity":"eight", "amenities":["wifi"]}'::jsonb,
    array['licensing_or_exemption']::public.owner_verification_document_kind[]
  )$$,
  'RC422', null, 'a malformed requested numeric value cannot resume review'
);

select throws_ok(
  $$select public.respond_to_owner_application_request(
    3, '{"exact_address":"Renewed private address", "governorate":"Erbil", "approximate_location":"Shaqlawa hills", "capacity":8, "amenities":{"wifi":true}}'::jsonb,
    array['licensing_or_exemption']::public.owner_verification_document_kind[]
  )$$,
  'RC422', null, 'a malformed requested JSON value cannot resume review'
);

select throws_ok(
  $$select public.respond_to_owner_application_request(
    3, '{"exact_address":"Renewed private address", "governorate":"Erbil", "approximate_location":"36.408333, 44.385834", "capacity":8, "amenities":["wifi"]}'::jsonb,
    array['licensing_or_exemption']::public.owner_verification_document_kind[]
  )$$,
  'RC422', 'A requested field value is invalid',
  'the information response refuses a bare coordinate pair as the Approximate Location'
);

select results_eq(
  $$select owner_applications.status::text, owner_applications.version,
      exact_address, capacity, amenities
    from public.owner_applications
    join public.owner_application_cottage_profiles
      on application_id = owner_applications.id
    where owner_applications.id = '20000000-0000-4000-8000-000000000301'$$,
  $$values ('needs_information'::text, 3::bigint, 'Private road'::text,
    8::smallint, '{}'::text[])$$,
  'invalid responses atomically preserve state, clock version, and stored values'
);

select lives_ok(
  $$select public.respond_to_owner_application_request(
    3, '{"exact_address":" ", "governorate":"Erbil", "approximate_location":"Shaqlawa, 12 km north of Erbil", "capacity":8, "amenities":["wifi"]}'::jsonb,
    array['licensing_or_exemption']::public.owner_verification_document_kind[]
  )$$,
  'the applicant can answer exactly the requested fields and evidence, leaving the exact address blank'
);

select results_eq(
  $$select exact_address, amenities
    from public.owner_application_cottage_profiles
    where application_id = '20000000-0000-4000-8000-000000000301'$$,
  $$values (null::text, array['wifi']::text[])$$,
  'a blank exact address response is stored as no address beside the other answers'
);

select results_eq(
  $$select approximate_location
    from public.owner_application_cottage_profiles
    where application_id = '20000000-0000-4000-8000-000000000301'$$,
  array['Shaqlawa, 12 km north of Erbil'::text],
  'the information response stores area words that contain a number as the Approximate Location'
);

select results_eq(
  $$select status::text, version, review_due_at - now()
    from public.owner_applications
    where id = '20000000-0000-4000-8000-000000000301'$$,
  $$values ('under_review'::text, 4::bigint, interval '70 hours')$$,
  'the same review target resumes from the exact pause point'
);

reset role;
select results_eq(
  $$select distinct object_path from public.owner_verification_document_versions
    where document_id = '40000000-0000-4000-8000-000000000303'
    order by object_path$$,
  $$values ('owner/review/licence-response.pdf'::text),
    ('owner/review/licence.pdf'::text)$$,
  'the response retains the historical version and records its new current path'
);

create temporary table historical_review_document as
select id from public.owner_verification_document_versions
where document_id = '40000000-0000-4000-8000-000000000303'
  and version = 1;
grant select on historical_review_document to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal2"}',
  true
);

select results_eq(
  $$select public.prepare_owner_verification_document_access(
      '40000000-0000-4000-8000-000000000303'
    ) ->> 'object_path'$$,
  array['owner/review/licence-response.pdf'::text],
  'a requested replacement response permits only the current licence path'
);

select throws_ok(
  $$select public.prepare_owner_verification_document_access(
    (select id from historical_review_document)
  )$$,
  'RC204', null, 'a historical version identifier cannot prepare access'
);

select throws_ok(
  $$select public.review_owner_application(
    '20000000-0000-4000-8000-000000000301', 4, 'approve',
    'Evidence meets the verification standard.', '{}', '{}',
    'Erbil Governorate', 'licence', 'Tourism licence 2026-41',
    '{"licensing_or_exemption":"2027-02-30"}'::jsonb
  )$$,
  'RC422', null, 'an impossible calendar expiry date is rejected'
);

select throws_ok(
  format(
    $$select public.review_owner_application(
      '20000000-0000-4000-8000-000000000301', 4, 'approve',
      'Evidence meets the verification standard.', '{}', '{}',
      'Erbil Governorate', 'licence', 'Tourism licence 2026-41', %L::jsonb
    )$$,
    jsonb_build_object('licensing_or_exemption', (current_date - 1)::text)::text
  ),
  'RC422', null, 'an already-expired decision date is rejected by database time'
);

select results_eq(
  $$select status::text, version from public.owner_applications
    where id = '20000000-0000-4000-8000-000000000301'$$,
  $$values ('under_review'::text, 4::bigint)$$,
  'invalid expiry dates leave the decision state unchanged'
);

select lives_ok(
  format(
    $$select public.review_owner_application(
      '20000000-0000-4000-8000-000000000301', 4, 'approve',
      'Evidence meets the verification standard.', '{}', '{}',
      'Erbil Governorate', 'licence', 'Tourism licence 2026-41', %L::jsonb
    )$$,
    jsonb_build_object('licensing_or_exemption', (current_date + 365)::text)::text
  ),
  'an authorised approval records its complete verification basis'
);

select results_eq(
  $$select status::text, owner_approval_state::text
    from public.owner_applications
    join public.account_contexts on user_id = owner_user_id
    where owner_applications.id = '20000000-0000-4000-8000-000000000301'$$,
  $$values ('approved'::text, 'approved'::text)$$,
  'approval synchronizes the account projection without publishing a cottage'
);

select throws_ok(
  $$select public.prepare_owner_verification_document_access(
    '40000000-0000-4000-8000-000000000303'
  )$$,
  'RC204', null, 'Approved denies new document grants'
);

select results_eq(
  $$select jurisdiction, licensing_basis::text, licence_or_exemption_basis,
      cardinality(evidence_version_ids)
    from public.owner_application_verification_records$$,
  $$values ('Erbil Governorate'::text, 'licence'::text,
    'Tourism licence 2026-41'::text, 4)$$,
  'the append-only verification record binds the reviewed evidence versions'
);

reset role;
insert into public.owner_applications (
  id, owner_user_id, applicant_kind, legal_name, licensing_basis, status,
  submitted_at, review_started_at, review_due_at
) values (
  '20000000-0000-4000-8000-000000000306',
  '00000000-0000-0000-0000-000000000306',
  'individual', 'No Evidence Owner', 'licence', 'under_review',
  now(), now(), now() + interval '72 hours'
);
insert into public.owner_application_cottage_profiles (
  application_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, description, house_rules
) values (
  '20000000-0000-4000-8000-000000000306', 'No Evidence Cottage', 'Erbil',
  'Shaqlawa', 'Private road', 8, 3, 2, 'Description', 'Rules'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select public.review_owner_application(
    '20000000-0000-4000-8000-000000000306', 1, 'approve',
    'No evidence must not be approved.', '{}', '{}',
    'Erbil Governorate', 'licence', 'Tourism licence 2026-99', '{}'::jsonb
  )$$,
  'RC422', null, 'approval without content-bound evidence is intentionally invalid'
);

reset role;
select throws_ok(
  $$update public.owner_application_verification_records set reason = 'rewrite'$$,
  'RC405', null, 'a verification decision cannot be rewritten'
);

select throws_ok(
  $$delete from public.owner_verification_document_versions$$,
  'RC405', null, 'an evidence version cannot be deleted'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","role":"authenticated","aal":"aal1"}',
  true
);

select results_eq(
  $$select public.owner_can_start_new_business(
    '00000000-0000-0000-0000-000000000301'
  )$$,
  array[true],
  'an approved owner may check their own new-business eligibility'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000305","role":"authenticated","aal":"aal1"}',
  true
);
select throws_ok(
  $$select public.owner_can_start_new_business(
    '00000000-0000-0000-0000-000000000301'
  )$$,
  '42501', null, 'an owner cannot inspect another owner eligibility'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal1"}',
  true
);
select throws_ok(
  $$select public.owner_can_start_new_business(
    '00000000-0000-0000-0000-000000000301'
  )$$,
  '42501', null, 'an AAL1 administrator cannot inspect owner eligibility'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal2"}',
  true
);
select results_eq(
  $$select public.owner_can_start_new_business(
    '00000000-0000-0000-0000-000000000301'
  )$$,
  array[true],
  'an AAL2 administrator may inspect owner eligibility'
);

reset role;
set local session_replication_role = replica;
update public.owner_application_verification_records
set relevant_expiry_dates = jsonb_build_object(
  'licensing_or_exemption', (current_date - 1)::text
);
set local session_replication_role = origin;

set local role service_role;
select results_eq(
  $$select public.process_expired_owner_applications()$$,
  array[0::integer],
  'the expiry processor is revoked until lifecycle activation'
);

select lives_ok(
  $$select public.activate_owner_application_lifecycle()$$,
  'explicit internal activation is separately available for delivery'
);

select results_eq(
  $$select public.process_expired_owner_applications()$$,
  array[1::integer],
  'the activated processor expires eligible approvals once'
);

select results_eq(
  $$select public.process_expired_owner_applications()$$,
  array[0::integer],
  'expiry processing is idempotent'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","role":"authenticated","aal":"aal1"}',
  true
);
select results_eq(
  $$select status::text, owner_approval_state::text
    from public.owner_applications
    join public.account_contexts on user_id = owner_user_id
    where owner_applications.id = '20000000-0000-4000-8000-000000000301'$$,
  $$values ('expired'::text, 'expired'::text)$$,
  'expiry synchronizes the owner projection'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select public.prepare_owner_verification_document_access(
    '40000000-0000-4000-8000-000000000303'
  )$$,
  'RC204', null, 'Expired denies new document grants'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","role":"authenticated","aal":"aal1"}',
  true
);

select results_eq(
  $$select status::text, requested_document_kinds::text[]
    from public.owner_application_renewal_work$$,
  $$values ('open'::text, array['licensing_or_exemption']::text[])$$,
  'expiry creates bounded renewal work for the expired evidence'
);

select results_eq(
  $$select public.owner_can_start_new_business(
    '00000000-0000-0000-0000-000000000301'
  )$$,
  array[false],
  'an expired owner fails closed for publication and new Booking Requests'
);

reset role;
update public.owner_verification_documents
set content_digest = repeat('c', 64), digest_source = 'sha256',
  object_path = 'owner/review/licence-renewal.pdf'
where application_id = '20000000-0000-4000-8000-000000000301'
  and kind = 'licensing_or_exemption';

insert into storage.objects (bucket_id, name, owner_id, metadata)
select public.owner_verification_bucket_name(), object_path,
  '00000000-0000-0000-0000-000000000301',
  jsonb_build_object('size', size_bytes, 'mimetype', media_type)
from public.owner_verification_documents
where id = '40000000-0000-4000-8000-000000000303';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","role":"authenticated","aal":"aal1"}',
  true
);

select lives_ok(
  $$select public.submit_owner_application_renewal(
    6, array['licensing_or_exemption']::public.owner_verification_document_kind[]
  )$$,
  'replacement evidence moves an Expired application back to review'
);

select results_eq(
  $$select status::text, version, owner_approval_state::text
    from public.owner_applications
    join public.account_contexts on user_id = owner_user_id
    where owner_applications.id = '20000000-0000-4000-8000-000000000301'$$,
  $$values ('under_review'::text, 7::bigint, 'prospective'::text)$$,
  'renewal review remains fail-closed until a new decision'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal2"}',
  true
);

select results_eq(
  $$select public.prepare_owner_verification_document_access(
      '40000000-0000-4000-8000-000000000303'
    ) ->> 'object_path'$$,
  array['owner/review/licence-renewal.pdf'::text],
  'a renewal submission permits the latest current licence path'
);

select lives_ok(
  format(
    $$select public.review_owner_application(
      '20000000-0000-4000-8000-000000000301', 7, 'approve',
      'Renewed evidence meets the verification standard.', '{}', '{}',
      'Erbil Governorate', 'licence', 'Renewed tourism licence 2027-41', %L::jsonb
    )$$,
    jsonb_build_object('licensing_or_exemption', (current_date + 365)::text)::text
  ),
  'an authorised renewal approval restores Approved state'
);

select results_eq(
  $$select status::text, owner_approval_state::text
    from public.owner_applications
    join public.account_contexts on user_id = owner_user_id
    where owner_applications.id = '20000000-0000-4000-8000-000000000301'$$,
  $$values ('approved'::text, 'approved'::text)$$,
  'renewal approval restores the account projection'
);

select results_eq(
  $$select status from public.owner_application_renewal_work$$,
  array['completed'::text],
  'renewal work closes only after authorised approval'
);

select results_eq(
  $$select public.owner_can_start_new_business(
    '00000000-0000-0000-0000-000000000301'
  )$$,
  array[true],
  'renewal approval restores new-business privileges'
);

select lives_ok(
  $$select public.review_owner_application(
    '20000000-0000-4000-8000-000000000301', 8, 'suspend',
    'Administrator-imposed safety suspension.', '{}', '{}',
    null, null, null, '{}'::jsonb
  )$$,
  'Suspended remains a separate administrator-imposed state'
);

select results_eq(
  $$select status::text, owner_approval_state::text,
      public.owner_can_start_new_business(owner_user_id)
    from public.owner_applications
    join public.account_contexts on user_id = owner_user_id
    where owner_applications.id = '20000000-0000-4000-8000-000000000301'$$,
  $$values ('suspended'::text, 'suspended'::text, false)$$,
  'suspension blocks new business without conflating evidence expiry'
);

select throws_ok(
  $$select public.prepare_owner_verification_document_access(
    '40000000-0000-4000-8000-000000000303'
  )$$,
  'RC204', null, 'Suspended denies new document grants'
);

reset role;
update public.owner_applications set status = 'rejected'
where id = '20000000-0000-4000-8000-000000000301';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000304","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select public.prepare_owner_verification_document_access(
    '40000000-0000-4000-8000-000000000303'
  )$$,
  'RC204', null,
  'Rejected denies new document grants'
);

reset role;
set local role service_role;
select lives_ok(
  $$select public.install_owner_application_expiry_cron()$$,
  'hosted Cron installation remains a separate delivery action'
);

select * from finish();
rollback;
