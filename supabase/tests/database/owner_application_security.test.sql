begin;

create extension if not exists pgtap with schema extensions;

select plan(57);

select has_table(
  'public',
  'owner_applications',
  'Owner Applications are persisted behind row-level security'
);

select has_table(
  'public',
  'owner_application_cottage_profiles',
  'the private first Cottage Profile belongs to the Owner Application'
);

select has_table(
  'public',
  'owner_verification_documents',
  'verification-document metadata is private application data'
);

select has_table(
  'public',
  'owner_verification_document_access_grants',
  'document access is prepared as a durable exact-object grant'
);

select has_table(
  'public',
  'owner_verification_document_audit',
  'verification-document access has a durable audit record'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.owner_verification_document_audit',
    'SELECT'
  ),
  'the service audit reader has explicit access to verification history'
);

select has_table(
  'public',
  'owner_verification_document_cleanup',
  'failed and replacement object cleanup has a durable work record'
);

select results_eq(
  $$select public.owner_verification_bucket_name()$$,
  array['owner-verification'::text],
  'the application uses one named private verification bucket'
);

insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000101', 'authenticated', 'authenticated', '+9647500000101', now()),
  ('00000000-0000-0000-0000-000000000102', 'authenticated', 'authenticated', '+9647500000102', now()),
  ('00000000-0000-0000-0000-000000000103', 'authenticated', 'authenticated', '+9647500000103', now()),
  ('00000000-0000-0000-0000-000000000104', 'authenticated', 'authenticated', '+9647500000104', now());

insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000000101', 'cottage_owner', 'prospective'),
  ('00000000-0000-0000-0000-000000000102', 'cottage_owner', 'prospective'),
  ('00000000-0000-0000-0000-000000000103', 'customer', null),
  ('00000000-0000-0000-0000-000000000104', 'platform_administrator', null);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated","aal":"aal1"}',
  true
);

select lives_ok(
  $$select public.save_owner_application(
    'individual',
    'Zana Kareem',
    null,
    'licence',
    null,
    'Garden House',
    'Erbil',
    'Shaqlawa countryside',
    'Near the eastern orchard road',
    8,
    3,
    2,
    array['garden', 'parking'],
    'A quiet family cottage surrounded by fruit trees.',
    'Families only. No amplified music after 10pm.'
  )$$,
  'a prospective Cottage Owner can save a complete private draft'
);

select results_eq(
  $$select status::text from public.owner_applications$$,
  array['draft'::text],
  'the Cottage Owner can read their own draft'
);

select results_eq(
  $$select name from public.owner_application_cottage_profiles$$,
  array['Garden House'::text],
  'the Cottage Owner can read their own private first Cottage Profile'
);

select set_config(
  'test.owner_application_id',
  (select id::text from public.owner_applications),
  true
);

select throws_ok(
  $$select public.save_owner_application(
    'individual', repeat('x', 121), null, 'licence', null,
    'Garden House', 'Erbil', 'Area', 'Address', 8, 3, 2,
    array['garden'], 'Description', 'Rules'
  )$$,
  '22001',
  null,
  'oversized direct-RPC text is rejected'
);

select throws_ok(
  $$select public.save_owner_application(
    'individual', 'Zana Kareem', null, 'licence', null,
    'Garden House', 'Erbil', 'Area', 'Address', 8, 3, 2,
    array['untrusted'], 'Description', 'Rules'
  )$$,
  '23514',
  null,
  'unknown direct-RPC amenities are rejected'
);

select throws_ok(
  $$select public.submit_owner_application()$$,
  'RC203',
  null,
  'submission fails until every required verification document exists'
);

select throws_ok(
  $$select public.prepare_owner_verification_document_upload(
    '00000000-0000-0000-0000-000000000101',
    (select id from public.owner_applications),
    'identity',
    '00000000-0000-0000-0000-000000000101/' ||
      (select id from public.owner_applications) ||
      '/identity/10000000-0000-4000-8000-000000000009.pdf',
    'missing.pdf',
    'application/pdf',
    128
  )$$,
  '42501',
  null,
  'an applicant cannot call the privileged upload-registration path directly'
);

reset role;
set local role service_role;

select lives_ok(
  $$select set_config(
    'test.identity_cleanup_id',
    public.prepare_owner_verification_document_upload(
      '00000000-0000-0000-0000-000000000101',
      current_setting('test.owner_application_id')::uuid,
      'identity',
      '00000000-0000-0000-0000-000000000101/' ||
        current_setting('test.owner_application_id') ||
        '/identity/10000000-0000-4000-8000-000000000001.pdf',
      'identity.pdf',
      'application/pdf',
      128
    )::text,
    true
  )$$,
  'the server records cleanup work before uploading a private object'
);

select throws_ok(
  $$select public.register_owner_verification_document(
    current_setting('test.identity_cleanup_id')::uuid
  )$$,
  'RC205',
  null,
  'metadata cannot be registered for a nonexistent Storage object'
);

reset role;

insert into storage.objects (bucket_id, name, owner_id, metadata)
select
  'owner-verification',
  '00000000-0000-0000-0000-000000000101/' || id ||
    '/identity/10000000-0000-4000-8000-000000000001.pdf',
  '00000000-0000-0000-0000-000000000101',
  jsonb_build_object('mimetype', 'application/pdf', 'size', 128)
from public.owner_applications;

update public.owner_applications
set status = 'submitted', submitted_at = now();

set local role service_role;
select throws_ok(
  $$select public.register_owner_verification_document(
    current_setting('test.identity_cleanup_id')::uuid
  )$$,
  'RC202',
  null,
  'registration rechecks the locked application and cannot mutate a submitted application'
);

reset role;
update public.owner_applications
set status = 'draft', submitted_at = null;

set local role service_role;
select lives_ok(
  $$select public.register_owner_verification_document(
    current_setting('test.identity_cleanup_id')::uuid
  )$$,
  'a valid uploaded object can be registered as verification evidence'
);

select results_eq(
  $$select
      result ->> 'status',
      result -> 'previous_object_path',
      result -> 'previous_cleanup_id'
    from (
      select public.reconcile_owner_verification_document_registration(
        current_setting('test.identity_cleanup_id')::uuid
      ) as result
    ) as registration$$,
  $$values ('registered'::text, 'null'::jsonb, 'null'::jsonb)$$,
  'a committed registration without a replacement returns explicit null cleanup fields'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated","aal":"aal1"}',
  true
);

select is_empty(
  $$select name from storage.objects where bucket_id = 'owner-verification'$$,
  'an applicant cannot directly fetch even their own verification object'
);

select is_empty(
  $$select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and ('authenticated' = any(roles) or 'public' = any(roles))
      and cmd in ('ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE')$$,
  'no authenticated Storage policy permits raw object access or mutation'
);

select is_empty(
  $$select id from public.owner_verification_document_audit$$,
  'an applicant cannot read raw verification audit records or administrator identifiers'
);

reset role;
set local role service_role;

select lives_ok(
  $$select set_config(
    'test.replacement_cleanup_id',
    public.prepare_owner_verification_document_upload(
      '00000000-0000-0000-0000-000000000101',
      current_setting('test.owner_application_id')::uuid,
      'identity',
      '00000000-0000-0000-0000-000000000101/' ||
        current_setting('test.owner_application_id') ||
        '/identity/10000000-0000-4000-8000-000000000002.pdf',
      'new-identity.pdf',
      'application/pdf',
      128
    )::text,
    true
  )$$,
  'replacement cleanup is prepared before the replacement object upload'
);

reset role;

insert into storage.objects (bucket_id, name, owner_id, metadata)
select
  'owner-verification',
  '00000000-0000-0000-0000-000000000101/' || id ||
    '/identity/10000000-0000-4000-8000-000000000002.pdf',
  null,
  jsonb_build_object('mimetype', 'application/pdf', 'size', 128)
from public.owner_applications;

set local role service_role;

select lives_ok(
  $$select public.register_owner_verification_document(
    current_setting('test.replacement_cleanup_id')::uuid
  )$$,
  'replacement registration persists deletion work before returning'
);

reset role;

select results_eq(
  $$select reason::text, status::text
    from public.owner_verification_document_cleanup
    where object_path like '%000000000001.pdf'
      and reason = 'replaced'$$,
  $$values ('replaced'::text, 'pending'::text)$$,
  'the old private object has a durable pending record before deletion'
);

insert into storage.objects (bucket_id, name, owner_id, metadata)
select
  'owner-verification',
  '00000000-0000-0000-0000-000000000101/' || applications.id || '/' || required.kind || '.pdf',
  '00000000-0000-0000-0000-000000000101',
  jsonb_build_object('mimetype', 'application/pdf', 'size', 128)
from public.owner_applications as applications
cross join (
  values
    ('authority_to_rent'),
    ('licensing_or_exemption'),
    ('payout_account')
) as required(kind)
where applications.owner_user_id = '00000000-0000-0000-0000-000000000101';

insert into public.owner_verification_documents (
  application_id,
  kind,
  object_path,
  original_filename,
  media_type,
  size_bytes
)
select
  applications.id,
  required.kind::public.owner_verification_document_kind,
  '00000000-0000-0000-0000-000000000101/' || applications.id || '/' || required.kind || '.pdf',
  required.kind || '.pdf',
  'application/pdf',
  128
from public.owner_applications as applications
cross join (
  values
    ('authority_to_rent'),
    ('licensing_or_exemption'),
    ('payout_account')
) as required(kind)
where applications.owner_user_id = '00000000-0000-0000-0000-000000000101';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated","aal":"aal1"}',
  true
);

select lives_ok(
  $$select public.submit_owner_application()$$,
  'a complete Owner Application can be submitted'
);

select results_eq(
  $$select status::text from public.owner_applications$$,
  array['submitted'::text],
  'submission changes the applicant-visible status'
);

select ok(
  (select submitted_at is not null from public.owner_applications),
  'submission records when the three-day review target starts'
);

select throws_ok(
  $$select public.save_owner_application(
    'individual', 'Changed Name', null, 'licence', null, 'Changed Cottage', 'Erbil',
    'Changed area', 'Changed address', 8, 3, 2, array['garden'],
    'Changed description', 'Changed rules'
  )$$,
  'RC202',
  null,
  'a submitted application cannot be silently rewritten'
);

select results_eq(
  $$select count(*)::bigint from public.owner_verification_documents$$,
  array[4::bigint],
  'the applicant can see the metadata for their submitted evidence'
);

select throws_ok(
  $$select public.prepare_owner_verification_document_access(
    (select id from public.owner_verification_documents where kind = 'identity')
  )$$,
  'RC204',
  null,
  'an applicant cannot bypass administrator-only audited document access'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000102","role":"authenticated","aal":"aal1"}',
  true
);

select is_empty(
  $$select id from public.owner_applications$$,
  'another Cottage Owner cannot read the application'
);

select is_empty(
  $$select id from public.owner_verification_documents$$,
  'another Cottage Owner cannot read document metadata'
);

select is_empty(
  $$select name from storage.objects where bucket_id = 'owner-verification'$$,
  'another Cottage Owner cannot fetch private objects'
);

select throws_ok(
  $$select public.prepare_owner_verification_document_access(
    (select id from public.owner_verification_documents where kind = 'identity')
  )$$,
  'RC204',
  null,
  'another Cottage Owner cannot create a document access record'
);

select lives_ok(
  $$select public.save_owner_application(
    'company', 'Ari Hassan', 'Cottage Operations Ltd', 'exemption',
    'Recorded municipal exemption for this jurisdiction',
    'Company Cottage', 'Erbil', 'Area', 'Address', 6, 2, 2,
    array['parking'], 'Description', 'Rules'
  )$$,
  'a company can record an exemption basis instead of licence evidence'
);

select results_eq(
  $$select unnest(public.owner_application_missing_items())$$,
  array[
    'document:company_registration'::text,
    'document:authorised_representative'::text,
    'document:authority_to_rent'::text,
    'document:payout_account'::text
  ],
  'a company requires company and representative evidence but no licence file for an exemption'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000103","role":"authenticated","aal":"aal1"}',
  true
);

select throws_ok(
  $$select public.save_owner_application(
    'individual', 'Customer', null, 'licence', null, 'Customer Cottage', 'Erbil',
    'Area', 'Address', 2, 1, 1, array['garden'], 'Description', 'Rules'
  )$$,
  '42501',
  null,
  'a Customer cannot create an Owner Application'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000104","role":"authenticated","aal":"aal1"}',
  true
);

select is_empty(
  $$select id from public.owner_verification_documents$$,
  'a Platform Administrator without MFA cannot read verification documents'
);

select throws_ok(
  $$select public.prepare_owner_verification_document_access(
    (select id from public.owner_verification_documents limit 1)
  )$$,
  'RC204',
  null,
  'a Platform Administrator without MFA cannot create document access'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000104","role":"authenticated","aal":"aal2"}',
  true
);

select results_eq(
  $$select count(*)::bigint from public.owner_verification_documents$$,
  array[4::bigint],
  'an MFA-authenticated Platform Administrator can read verification documents'
);

select is_empty(
  $$select name from storage.objects where bucket_id = 'owner-verification'$$,
  'an MFA administrator cannot bypass the audited signed-link path'
);

reset role;
create temporary table prepared_owner_document_access (grant_data jsonb);
grant select, insert on prepared_owner_document_access to authenticated, service_role;
set local role authenticated;

select lives_ok(
  $$insert into prepared_owner_document_access
  select public.prepare_owner_verification_document_access(
    (select id from public.owner_verification_documents where kind = 'identity')
  )$$,
  'an MFA administrator can prepare a time-limited document grant'
);

select results_eq(
  $$select count(*)::bigint from public.owner_verification_document_audit
    where action = 'access_granted'$$,
  array[0::bigint],
  'authorization alone does not falsely record document access as granted'
);

select throws_ok(
  $$select public.complete_owner_verification_document_access(
    (select (grant_data ->> 'grant_id')::uuid from prepared_owner_document_access),
    60
  )$$,
  '42501',
  null,
  'an MFA administrator cannot directly complete a document grant'
);

reset role;
update public.owner_verification_documents
set object_path = object_path || '.replacement'
where kind = 'identity';
update public.owner_verification_document_access_grants
set prepared_at = now() - interval '30 seconds'
where id = (
  select (grant_data ->> 'grant_id')::uuid
  from prepared_owner_document_access
);
set local role service_role;

select lives_ok(
  $$select public.complete_owner_verification_document_access(
    (select (grant_data ->> 'grant_id')::uuid from prepared_owner_document_access),
    60
  )$$,
  'the trusted service can complete a delayed prepared grant after link creation'
);

reset role;

select results_eq(
  $$select access_grant_id::text || ':' || object_path
    from public.owner_verification_document_audit
    where action = 'access_granted'$$,
  $$select (grant_data ->> 'grant_id') || ':' || (grant_data ->> 'object_path')
    from prepared_owner_document_access$$,
  'the audit is bound to the prepared grant and exact signed object path'
);

select isnt(
  (select object_path from public.owner_verification_document_audit
    where action = 'access_granted'),
  (select object_path from public.owner_verification_documents
    where kind = 'identity'),
  'a concurrent metadata replacement cannot change the audited object path'
);

select results_eq(
  $$select actor_user_id from public.owner_verification_document_audit
    where action = 'access_granted'$$,
  array['00000000-0000-0000-0000-000000000104'::uuid],
  'document access is attributed to the administrator'
);

select ok(
  (
    select access_expires_at between occurred_at + interval '59 seconds'
      and occurred_at + interval '61 seconds'
    from public.owner_verification_document_audit
    where action = 'access_granted'
  ),
  'document access expires after 60 seconds'
);

select lives_ok(
  $$delete from public.owner_verification_documents where kind = 'identity'$$,
  'retention cleanup can remove evidence metadata after a completed grant'
);

select ok(
  (
    select document_id is null
      and document_subject_id is not null
      and status = 'completed'
    from public.owner_verification_document_access_grants
    where id = (
      select (grant_data ->> 'grant_id')::uuid
      from prepared_owner_document_access
    )
  ),
  'a completed grant retains immutable document attribution after cleanup'
);

create temporary table failed_owner_document_access (grant_data jsonb);
grant select, insert on failed_owner_document_access to authenticated, service_role;
set local role authenticated;

select lives_ok(
  $$insert into failed_owner_document_access
  select public.prepare_owner_verification_document_access(
    (select id from public.owner_verification_documents
      where kind = 'authority_to_rent')
  )$$,
  'a later failed link attempt leaves a durable pending grant'
);

reset role;
update public.owner_verification_document_access_grants
set complete_before = now() - interval '1 second'
where id = (
  select (grant_data ->> 'grant_id')::uuid
  from failed_owner_document_access
);

set local role service_role;
select results_eq(
  $$select public.complete_owner_verification_document_access(
    (select (grant_data ->> 'grant_id')::uuid from failed_owner_document_access),
    60
  )$$,
  array['expired'::text],
  'a failed link completion makes its pending grant terminal'
);
reset role;

select lives_ok(
  $$delete from public.owner_verification_documents
    where kind = 'authority_to_rent'$$,
  'retention cleanup can remove evidence metadata after an expired pending grant'
);

select ok(
  (
    select document_id is null
      and document_subject_id is not null
      and status = 'expired'
    from public.owner_verification_document_access_grants
    where id = (
      select (grant_data ->> 'grant_id')::uuid
      from failed_owner_document_access
    )
  ),
  'an expired grant retains immutable document attribution after cleanup'
);

select * from finish();
rollback;
