begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

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

select has_table(
  'public',
  'account_names',
  'first names are persisted behind row-level security'
);

insert into auth.users (id, aud, role, email, email_confirmed_at, phone, phone_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', null, null, '+9647500000000', now()),
  ('00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', null, null, '+9647500000001', now()),
  ('00000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', null, null, '+9647500000002', now()),
  -- A confirmed phone keeps the role claim below on the administrator guard instead of the verified phone guard.
  ('00000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'admin@example.com', now(), '+9647500000004', now()),
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

insert into public.account_names (user_id, first_name)
values
  ('00000000-0000-0000-0000-000000000002', 'Avan'),
  ('00000000-0000-0000-0000-000000000003', 'Dara');

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

select is_empty(
  $$select first_name from public.account_names$$,
  'a Customer cannot read another account first name'
);

select lives_ok(
  $$select public.save_account_name('Zana')$$,
  'a Customer saves their own first name'
);

select results_eq(
  $$select user_id, first_name::text from public.account_names$$,
  $$values ('00000000-0000-0000-0000-000000000001'::uuid, 'Zana'::text)$$,
  'a Customer reads only their own first name'
);

select lives_ok(
  $$select public.save_account_name('Rebin')$$,
  'a Customer changes their own first name'
);

select results_eq(
  $$select user_id, first_name::text from public.account_names$$,
  $$values ('00000000-0000-0000-0000-000000000001'::uuid, 'Rebin'::text)$$,
  'a Customer reads the changed first name and nobody else'
);

select throws_ok(
  $$insert into public.account_names (user_id, first_name) values ('00000000-0000-0000-0000-000000000001', 'Zana')$$,
  '42501',
  null,
  'a Customer cannot change a first name directly'
);

select throws_ok(
  $$update public.account_names set first_name = 'Zana' where user_id = '00000000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'a Customer cannot update a first name directly'
);

select throws_ok(
  $$select public.save_account_name(' Zana')$$,
  '23514',
  null,
  'a first name that breaks the stored shape is refused'
);

select throws_ok(
  $$select public.save_account_name(repeat('a', 51))$$,
  '23514',
  null,
  'a first name over 50 characters is refused'
);

select throws_ok(
  $$select public.save_account_name(E'Za\tna')$$,
  '23514',
  null,
  'a first name with a control character is refused'
);

select results_eq(
  $$select user_id, role::text, owner_approval_state::text from public.claim_marketplace_role('cottage_owner')$$,
  $$values ('00000000-0000-0000-0000-000000000001'::uuid, 'cottage_owner', 'prospective')$$,
  'explicit owner enrollment preserves customer identity and requires approval'
);
select results_eq(
  $$select user_id, role::text, owner_approval_state::text from public.claim_marketplace_role('customer')$$,
  $$values ('00000000-0000-0000-0000-000000000001'::uuid, 'cottage_owner', 'prospective')$$,
  'shared sign in retains owner enrollment and customer capability'
);
select throws_ok($$select public.claim_marketplace_role('platform_administrator')$$, '42501', null, 'public claims cannot grant administration');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}',
  true
);

select results_eq(
  $$select user_id, role::text, owner_approval_state::text from public.claim_marketplace_role('customer')$$,
  $$values ('00000000-0000-0000-0000-000000000002'::uuid, 'cottage_owner', 'approved')$$,
  'shared sign in preserves existing owner approval'
);
select lives_ok(
  $$select public.save_account_name('Avin')$$,
  'a Cottage Owner saves their own first name'
);
select results_eq(
  $$select user_id, first_name::text from public.account_names$$,
  $$values ('00000000-0000-0000-0000-000000000002'::uuid, 'Avin'::text)$$,
  'a Cottage Owner reads only their own first name'
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

select throws_ok(
  $$update public.account_contexts set owner_approval_state = 'approved' where user_id = '00000000-0000-0000-0000-000000000005'$$,
  '42501',
  null,
  'a prospective Cottage Owner cannot approve their own account'
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

select throws_ok(
  $$select public.save_account_name('Sara')$$,
  '42501',
  null,
  'a Platform Administrator before two-step sign-in cannot save a first name'
);

select is_empty(
  $$select first_name from public.account_names$$,
  'a Platform Administrator before two-step sign-in reads no first name'
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

select lives_ok(
  $$select public.save_account_name('Sara')$$,
  'a Platform Administrator with two-step sign-in saves their own first name'
);

select results_eq(
  $$select user_id, first_name::text from public.account_names$$,
  $$values ('00000000-0000-0000-0000-000000000004'::uuid, 'Sara'::text)$$,
  'a Platform Administrator with two-step sign-in reads only their own first name'
);

select throws_ok(
  $$update public.account_contexts set role = 'platform_administrator' where user_id = '00000000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'an MFA-authenticated Platform Administrator cannot mutate another account context'
);

select throws_ok(
  $$select public.claim_marketplace_role('cottage_owner')$$,
  'RC001',
  'This identity already has a different marketplace role',
  'a Platform Administrator cannot claim a marketplace role'
);

reset role;

-- User 1 owns no cottage, so deleting the context is not blocked by an ownership reference.
delete from public.account_contexts where user_id = '00000000-0000-0000-0000-000000000001';

select is_empty(
  $$select first_name from public.account_names where user_id = '00000000-0000-0000-0000-000000000001'$$,
  'a first name is deleted with its account'
);

set local role service_role;

select throws_ok(
  $$insert into public.account_names (user_id, first_name) values ('00000000-0000-0000-0000-000000000005', 'Hana')$$,
  '42501',
  null,
  'the service role cannot write a first name directly'
);

select throws_ok(
  $$select user_id from public.account_names$$,
  '42501',
  null,
  'the service role cannot read first names'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$select user_id from public.account_names$$,
  '42501',
  null,
  'a signed-out visitor cannot read first names'
);

select throws_ok(
  $$select public.save_account_name('Hana')$$,
  '42501',
  null,
  'a signed-out visitor cannot save a first name'
);

reset role;

select ok(not has_function_privilege('anon','public.save_account_name(text)','EXECUTE'),'anon cannot save a first name');
select ok(not has_function_privilege('service_role','public.save_account_name(text)','EXECUTE'),'the service role cannot save a first name');
select ok(not has_table_privilege('authenticated','public.account_names','INSERT'),'authenticated cannot insert first names directly');
select ok(not has_table_privilege('authenticated','public.account_names','UPDATE'),'authenticated cannot update first names directly');
select ok(not has_table_privilege('authenticated','public.account_names','DELETE'),'authenticated cannot delete first names directly');

select * from finish();
rollback;
