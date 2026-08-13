begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select has_table(
  'public',
  'privileged_sign_in_attempts',
  'privileged sign-in attempts have a durable audit record'
);

select has_column(
  'public',
  'privileged_sign_in_attempts',
  'actor_user_id',
  'the audit record attributes a known Platform Administrator'
);

select has_column(
  'public',
  'privileged_sign_in_attempts',
  'attempted_at',
  'the audit record timestamps every attempt'
);

select hasnt_column(
  'public',
  'privileged_sign_in_attempts',
  'attempted_email',
  'the audit record never stores the attempted email'
);

insert into auth.users (id, aud, role, email, email_confirmed_at)
values (
  '00000000-0000-0000-0000-000000000005',
  'authenticated',
  'authenticated',
  'audit-admin@example.com',
  now()
);

select public.provision_platform_administrator(
  '00000000-0000-0000-0000-000000000005'
);

insert into public.privileged_sign_in_attempts (
  actor_user_id,
  email_digest,
  stage,
  outcome,
  attempted_at
)
values (
  '00000000-0000-0000-0000-000000000005',
  repeat('f', 64),
  'primary',
  'failed',
  now() - interval '181 days'
);

select lives_ok(
  $$select public.record_privileged_sign_in_attempt('audit-admin@example.com', repeat('a', 64), 'primary', 'failed')$$,
  'a failed administrator password attempt is recorded'
);

select is_empty(
  $$select id from public.privileged_sign_in_attempts where attempted_at < now() - interval '180 days'$$,
  'audit writes enforce the 180-day retention period'
);

select results_eq(
  $$select actor_user_id from public.privileged_sign_in_attempts where stage = 'primary' and outcome = 'failed'$$,
  array['00000000-0000-0000-0000-000000000005'::uuid],
  'a known failed attempt is attributed without exposing the email'
);

select is(
  (select email_digest from public.privileged_sign_in_attempts limit 1),
  repeat('a', 64),
  'the audit stores only the supplied keyed digest'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal2"}',
  true
);

select throws_ok(
  $$select public.record_privileged_sign_in_attempt('audit-admin@example.com', repeat('b', 64), 'primary', 'succeeded')$$,
  '42501',
  null,
  'a browser session cannot write its own privileged audit record'
);

select * from finish();
rollback;
