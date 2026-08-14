begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values (
  '00000000-0000-0000-0000-000000000201',
  'authenticated',
  'authenticated',
  '+9647500000201',
  now()
);

insert into public.account_contexts (user_id, role, owner_approval_state)
values (
  '00000000-0000-0000-0000-000000000201',
  'cottage_owner',
  'prospective'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000201","role":"authenticated","aal":"aal1"}',
  true
);

select lives_ok(
  $$select public.save_owner_application(
    'individual', 'Zana Kareem', null, 'licence', null,
    'Garden House', 'Erbil', 'Area', 'Address', 8, 3, 2,
    array['garden'], 'Description', 'Rules'
  )$$,
  'an individual licence draft is saved before evidence is uploaded'
);

select set_config(
  'test.cleanup_application_id',
  (select id::text from public.owner_applications),
  true
);

reset role;

set local role service_role;
select lives_ok(
  $$select set_config(
    'test.racing_cleanup_id',
    public.prepare_owner_verification_document_upload(
      '00000000-0000-0000-0000-000000000201',
      current_setting('test.cleanup_application_id')::uuid,
      'identity',
      '00000000-0000-0000-0000-000000000201/' ||
        current_setting('test.cleanup_application_id') ||
        '/identity/10000000-0000-4000-8000-000000000201.pdf',
      'racing-identity.pdf',
      'application/pdf',
      128
    )::text,
    true
  )$$,
  'identity upload preparation is valid while the applicant is an individual'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000201","role":"authenticated","aal":"aal1"}',
  true
);

select lives_ok(
  $$select public.save_owner_application(
    'company', 'Zana Kareem', 'Cottage Operations Ltd', 'licence', null,
    'Garden House', 'Erbil', 'Area', 'Address', 8, 3, 2,
    array['garden'], 'Description', 'Rules'
  )$$,
  'the applicant can change choices after an upload is prepared'
);

reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select
  'owner-verification',
  '00000000-0000-0000-0000-000000000201/' ||
    current_setting('test.cleanup_application_id') ||
    '/identity/10000000-0000-4000-8000-000000000201.pdf',
  '00000000-0000-0000-0000-000000000201',
  jsonb_build_object('mimetype', 'application/pdf', 'size', 128)
;

set local role service_role;
select throws_ok(
  $$select public.register_owner_verification_document(
    current_setting('test.racing_cleanup_id')::uuid
  )$$,
  'RC205',
  null,
  'registration rejects evidence that is no longer required by locked application choices'
);

select results_eq(
  $$select public.reconcile_owner_verification_document_registration(
    current_setting('test.racing_cleanup_id')::uuid
  ) ->> 'status'$$,
  array['unregistered'::text],
  'reconciliation confirms the rejected object is safe to clean up'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000201","role":"authenticated","aal":"aal1"}',
  true
);

select lives_ok(
  $$select public.save_owner_application(
    'individual', 'Zana Kareem', null, 'licence', null,
    'Garden House', 'Erbil', 'Area', 'Address', 8, 3, 2,
    array['garden'], 'Description', 'Rules'
  )$$,
  'the draft returns to the evidence choices used by the cleanup scenario'
);

reset role;

insert into storage.objects (bucket_id, name, owner_id, metadata)
select
  'owner-verification',
  '00000000-0000-0000-0000-000000000201/' || applications.id || '/' || evidence.kind || '.pdf',
  '00000000-0000-0000-0000-000000000201',
  jsonb_build_object('mimetype', 'application/pdf', 'size', 128)
from public.owner_applications as applications
cross join (
  values ('identity'), ('company_registration'), ('licensing_or_exemption')
) as evidence(kind);

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
  evidence.kind::public.owner_verification_document_kind,
  '00000000-0000-0000-0000-000000000201/' || applications.id || '/' || evidence.kind || '.pdf',
  evidence.kind || '.pdf',
  'application/pdf',
  128
from public.owner_applications as applications
cross join (
  values ('identity'), ('company_registration'), ('licensing_or_exemption')
) as evidence(kind);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000201","role":"authenticated","aal":"aal1"}',
  true
);

select lives_ok(
  $$select public.save_owner_application(
    'company', 'Zana Kareem', 'Cottage Operations Ltd', 'exemption',
    'Recorded municipal exemption', 'Garden House', 'Erbil', 'Area', 'Address',
    8, 3, 2, array['garden'], 'Description', 'Rules'
  )$$,
  'changing applicant and licensing choices queues obsolete evidence cleanup'
);

select results_eq(
  $$select kind::text from public.owner_verification_documents order by kind::text$$,
  array['company_registration'::text],
  'only evidence still relevant to the saved choices remains registered'
);

select throws_ok(
  $$select id from public.owner_verification_document_cleanup$$,
  '42501',
  null,
  'an applicant cannot inspect privileged cleanup work'
);

reset role;

select results_eq(
  $$select kind::text, reason::text, status::text
    from public.owner_verification_document_cleanup
    where reason = 'replaced'
    order by kind::text$$,
  $$values
    ('identity'::text, 'replaced'::text, 'pending'::text),
    ('licensing_or_exemption'::text, 'replaced'::text, 'pending'::text)$$,
  'both obsolete private objects have durable pending cleanup records'
);

set local role service_role;

select throws_ok(
  $$select public.complete_owner_verification_document_cleanup(
    (select id from public.owner_verification_document_cleanup
      where kind = 'identity' and reason = 'replaced')
  )$$,
  'RC205',
  null,
  'cleanup cannot be completed while the private object still exists'
);

reset role;
set local session_replication_role = replica;
delete from storage.objects
where bucket_id = 'owner-verification'
  and name in (
    select object_path from public.owner_verification_document_cleanup
  );
set local session_replication_role = origin;

set local role service_role;

select lives_ok(
  $$select public.complete_owner_verification_document_cleanup(id)
    from public.owner_verification_document_cleanup
    order by kind$$,
  'removed obsolete objects are recorded as completed cleanup'
);

select lives_ok(
  $$select public.complete_owner_verification_document_cleanup(id)
    from public.owner_verification_document_cleanup
    order by kind$$,
  'repeating cleanup completion is idempotent'
);

reset role;

select results_eq(
  $$select action::text, count(*)::bigint
    from public.owner_verification_document_audit
    group by action$$,
  $$values ('deleted'::text, 2::bigint)$$,
  'each obsolete evidence deletion has one durable audit record'
);

select throws_ok(
  $$delete from auth.users
    where id = '00000000-0000-0000-0000-000000000201'$$,
  '23503',
  null,
  'Owner account deletion is restricted until private evidence retention is completed'
);

select results_eq(
  $$select count(*)::bigint from public.owner_applications
    where owner_user_id = '00000000-0000-0000-0000-000000000201'$$,
  array[1::bigint],
  'a blocked account deletion preserves the private application'
);

select results_eq(
  $$select count(*)::bigint
    from public.owner_verification_document_audit
    where actor_user_id = '00000000-0000-0000-0000-000000000201'
      and actor_subject_id = '00000000-0000-0000-0000-000000000201'
      and document_id is null$$,
  array[2::bigint],
  'evidence history retains immutable actor attribution'
);

select * from finish();
rollback;
