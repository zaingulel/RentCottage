begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

select ok(
  not has_table_privilege(
    'authenticated', 'public.owner_application_lifecycle_control', 'SELECT'
  ),
  'authenticated users have no lifecycle-control table privilege'
);

select ok(
  has_table_privilege(
    'service_role', 'public.owner_application_lifecycle_control', 'SELECT'
  ),
  'only the service lifecycle has explicit control-table read access'
);

insert into auth.users (id, aud, role, phone, phone_confirmed_at, email, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000401', 'authenticated', 'authenticated', '+9647500000401', now(), null, null),
  ('00000000-0000-0000-0000-000000000402', 'authenticated', 'authenticated', '+9647500000402', now(), null, null),
  ('00000000-0000-0000-0000-000000000404', 'authenticated', 'authenticated', null, null, 'rls-reviewer@example.test', now());

insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000000401', 'cottage_owner', 'prospective'),
  ('00000000-0000-0000-0000-000000000402', 'cottage_owner', 'prospective'),
  ('00000000-0000-0000-0000-000000000404', 'platform_administrator', null);

insert into public.owner_applications (
  id, owner_user_id, applicant_kind, legal_name, licensing_basis, status,
  submitted_at, review_started_at, review_remaining, review_paused_at
)
values
  ('20000000-0000-4000-8000-000000000401', '00000000-0000-0000-0000-000000000401',
    'individual', 'RLS Owner One', 'licence', 'needs_information', now(), now(),
    interval '70 hours', now()),
  ('20000000-0000-4000-8000-000000000402', '00000000-0000-0000-0000-000000000402',
    'individual', 'RLS Owner Two', 'licence', 'needs_information', now(), now(),
    interval '69 hours', now());

insert into public.owner_verification_documents (
  id, application_id, kind, object_path, original_filename, media_type,
  size_bytes, content_digest, digest_source
)
values
  ('40000000-0000-4000-8000-000000000401', '20000000-0000-4000-8000-000000000401',
    'identity', 'owner/rls-one/identity.pdf', 'identity.pdf', 'application/pdf', 128,
    repeat('4', 64), 'sha256'),
  ('40000000-0000-4000-8000-000000000402', '20000000-0000-4000-8000-000000000402',
    'identity', 'owner/rls-two/identity.pdf', 'identity.pdf', 'application/pdf', 128,
    repeat('5', 64), 'sha256');

insert into public.owner_application_information_requests (
  application_id, requested_by_user_id, requested_by_subject_id, reason,
  requested_fields
)
values
  ('20000000-0000-4000-8000-000000000401', '00000000-0000-0000-0000-000000000404',
    '00000000-0000-0000-0000-000000000404', 'Owner one request', array['exact_address']),
  ('20000000-0000-4000-8000-000000000402', '00000000-0000-0000-0000-000000000404',
    '00000000-0000-0000-0000-000000000404', 'Owner two request', array['exact_address']);

insert into public.owner_application_transitions (
  application_id, from_status, to_status, application_version,
  actor_user_id, actor_subject_id
)
values
  ('20000000-0000-4000-8000-000000000401', 'under_review', 'needs_information', 2,
    '00000000-0000-0000-0000-000000000404', '00000000-0000-0000-0000-000000000404'),
  ('20000000-0000-4000-8000-000000000402', 'under_review', 'needs_information', 2,
    '00000000-0000-0000-0000-000000000404', '00000000-0000-0000-0000-000000000404');

insert into public.owner_application_notices (application_id, owner_user_id, kind)
values
  ('20000000-0000-4000-8000-000000000401', '00000000-0000-0000-0000-000000000401', 'information_requested'),
  ('20000000-0000-4000-8000-000000000402', '00000000-0000-0000-0000-000000000402', 'information_requested');

insert into public.owner_application_verification_records (
  id, application_id, version, reviewer_user_id, reviewer_subject_id, decision,
  reason, jurisdiction, licensing_basis, licence_or_exemption_basis,
  evidence_version_ids, evidence_types, relevant_expiry_dates
)
select
  ('50000000-0000-4000-8000-00000000040' || suffix)::uuid,
  application_id, 1, '00000000-0000-0000-0000-000000000404',
  '00000000-0000-0000-0000-000000000404', 'approved', 'Historic verification',
  'Erbil', 'licence', 'Licence', array[version_id], array['identity']::public.owner_verification_document_kind[],
  jsonb_build_object('identity', (current_date + 365)::text)
from (
  select '1' suffix, '20000000-0000-4000-8000-000000000401'::uuid application_id,
    id version_id from public.owner_verification_document_versions
    where application_id = '20000000-0000-4000-8000-000000000401'
  union all
  select '2', '20000000-0000-4000-8000-000000000402'::uuid, id
    from public.owner_verification_document_versions
    where application_id = '20000000-0000-4000-8000-000000000402'
) records;

insert into public.owner_application_renewal_work (
  application_id, verification_record_id, requested_document_kinds
)
values
  ('20000000-0000-4000-8000-000000000401', '50000000-0000-4000-8000-000000000401', array['identity']::public.owner_verification_document_kind[]),
  ('20000000-0000-4000-8000-000000000402', '50000000-0000-4000-8000-000000000402', array['identity']::public.owner_verification_document_kind[]);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000401","role":"authenticated","aal":"aal1"}',
  true
);

select is_empty(
  $$select from public.owner_application_information_requests$$,
  'an owner cannot directly read administrator request identities'
);
select results_eq(
  $$select request ->> 'reason', request -> 'requested_fields'
    from (select public.owner_application_active_information_request() request) safe$$,
  $$values ('Owner one request'::text, '["exact_address"]'::jsonb)$$,
  'the owner-safe request seam returns only their active request scope'
);
select results_eq(
  $$select not (request ?| array[
      'id', 'application_id', 'requested_by_user_id', 'requested_by_subject_id',
      'requested_at', 'responded_at', 'response_version'
    ]) from (select public.owner_application_active_information_request() request) safe$$,
  array[true],
  'the owner-safe request seam omits internal identities and lifecycle metadata'
);
select is_empty($$select from public.owner_application_transitions$$,
  'an owner cannot read transition actor history');
select results_eq($$select count(*)::integer from public.owner_application_notices$$,
  array[1], 'an owner reads only their own notices');
select is_empty(
  $$select from public.owner_application_notices
    where owner_user_id = '00000000-0000-0000-0000-000000000402'$$,
  'an owner cannot read another owner notice'
);
select is_empty($$select from public.owner_verification_document_versions$$,
  'an owner cannot read evidence-version internals');
select is_empty($$select from public.owner_application_verification_records$$,
  'an owner cannot read verification reviewer identities');
select results_eq($$select count(*)::integer from public.owner_application_renewal_work$$,
  array[1], 'an owner reads only their own renewal scope');
select is_empty(
  $$select from public.owner_application_renewal_work
    where application_id = '20000000-0000-4000-8000-000000000402'$$,
  'an owner cannot read another owner renewal scope'
);
select throws_ok($$select * from public.owner_application_lifecycle_control$$,
  '42501', null, 'an owner cannot read lifecycle controls');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000404","role":"authenticated","aal":"aal1"}',
  true
);

select is_empty($$select from public.owner_application_information_requests$$,
  'an AAL1 administrator cannot read information requests');
select is_empty($$select from public.owner_application_transitions$$,
  'an AAL1 administrator cannot read transition history');
select is_empty($$select from public.owner_application_notices$$,
  'an AAL1 administrator cannot read owner notices');
select is_empty($$select from public.owner_verification_document_versions$$,
  'an AAL1 administrator cannot read evidence versions');
select is_empty($$select from public.owner_application_verification_records$$,
  'an AAL1 administrator cannot read verification records');
select is_empty($$select from public.owner_application_renewal_work$$,
  'an AAL1 administrator cannot read renewal work');
select throws_ok($$select * from public.owner_application_lifecycle_control$$,
  '42501', null, 'an AAL1 administrator cannot read lifecycle controls');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000404","role":"authenticated","aal":"aal2"}',
  true
);

select results_eq($$select count(*)::integer from public.owner_application_information_requests$$,
  array[2], 'an AAL2 administrator reads information requests');
select results_eq($$select count(*)::integer from public.owner_application_transitions$$,
  array[2], 'an AAL2 administrator reads transition history');
select is_empty($$select from public.owner_application_notices$$,
  'an administrator has no unnecessary owner-notice read scope');
select results_eq($$select count(*)::integer from public.owner_verification_document_versions$$,
  array[2], 'an AAL2 administrator reads evidence versions');
select results_eq($$select count(*)::integer from public.owner_application_verification_records$$,
  array[2], 'an AAL2 administrator reads verification records');
select results_eq($$select count(*)::integer from public.owner_application_renewal_work$$,
  array[2], 'an AAL2 administrator reads renewal work');
select throws_ok($$select * from public.owner_application_lifecycle_control$$,
  '42501', null, 'an AAL2 administrator cannot read lifecycle controls');

reset role;
set local role service_role;
select results_eq(
  $$select expiry_processor_enabled from public.owner_application_lifecycle_control$$,
  array[false],
  'the service lifecycle alone reads the disabled control flag'
);

select * from finish();
rollback;
