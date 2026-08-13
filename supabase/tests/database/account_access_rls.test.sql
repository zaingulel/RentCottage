begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_table(
  'public',
  'account_contexts',
  'account contexts are persisted behind row-level security'
);

select has_table(
  'public',
  'cottage_ownership',
  'cottage ownership anchors cross-cottage authorization'
);

insert into auth.users (id, aud, role, email, email_confirmed_at, phone, phone_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', null, null, '+9647500000000', now()),
  ('00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', null, null, '+9647500000001', now()),
  ('00000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', null, null, '+9647500000002', now()),
  ('00000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'admin@example.com', now(), null, null),
  ('00000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', null, null, '+9647500000003', now());

insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000000001', 'customer', null),
  ('00000000-0000-0000-0000-000000000002', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000000003', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000000004', 'platform_administrator', null),
  ('00000000-0000-0000-0000-000000000005', 'cottage_owner', 'prospective');

insert into public.cottage_ownership (cottage_id, owner_user_id)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000005');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',
  true
);

select results_eq(
  $$select role::text from public.account_contexts order by role::text$$,
  array['customer'::text],
  'a customer can read only their own account context'
);

select is_empty(
  $$select cottage_id from public.cottage_ownership$$,
  'a customer cannot read any Cottage Owner scope'
);

select throws_ok(
  $$insert into public.account_contexts (user_id, role) values ('00000000-0000-0000-0000-000000000001', 'platform_administrator')$$,
  '42501',
  null,
  'an authenticated user cannot grant Platform Administrator access'
);

select throws_ok(
  $$update public.account_contexts set role = 'platform_administrator' where user_id = '00000000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'an authenticated user cannot promote their existing account context'
);

select throws_ok(
  $$select public.claim_marketplace_role('cottage_owner')$$,
  'RC001',
  null,
  'a conflicting marketplace role has a stable domain error code'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}',
  true
);

select results_eq(
  $$select cottage_id from public.cottage_ownership order by cottage_id$$,
  array['10000000-0000-0000-0000-000000000001'::uuid],
  'a Cottage Owner can read their own cottage scope but not another Cottage Owner scope'
);

select throws_ok(
  $$update public.cottage_ownership set owner_user_id = '00000000-0000-0000-0000-000000000002' where cottage_id = '10000000-0000-0000-0000-000000000002'$$,
  '42501',
  null,
  'a Cottage Owner has no permission to take another Cottage Owner cottage scope'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal1"}',
  true
);

select is_empty(
  $$select cottage_id from public.cottage_ownership$$,
  'a prospective Cottage Owner cannot read approved-owner cottage scope'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1"}',
  true
);

select results_eq(
  $$select count(*)::bigint from public.account_contexts$$,
  array[1::bigint],
  'a Platform Administrator at assurance level 1 has only self access'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',
  true
);

select results_eq(
  $$select count(*)::bigint from public.account_contexts$$,
  array[5::bigint],
  'a Platform Administrator at assurance level 2 can read protected account contexts'
);

select * from finish();
rollback;
