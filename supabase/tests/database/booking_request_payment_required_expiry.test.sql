begin;

select plan(12);

select has_table(
  'public', 'booking_request_payment_required_expiry_work',
  'Payment Required expiry work is durable'
);
select has_table(
  'public', 'booking_request_payment_required_expiry_operations',
  'Payment Required expiry release ownership is durable'
);
select has_function(
  'public', 'claim_due_booking_request_payment_required_expiries', array['integer', 'jsonb'],
  'service processing has a bounded due interface'
);
select has_function(
  'public', 'prepare_booking_request_payment_required_expiry', array['uuid', 'jsonb'],
  'service processing has a complete-evidence preparation interface'
);
select function_privs_are(
  'public', 'claim_due_booking_request_payment_required_expiries', array['integer', 'jsonb'],
  'service_role', array['EXECUTE'],
  'only the service role receives due processing access'
);
select function_privs_are(
  'public', 'claim_due_booking_request_payment_required_expiries', array['integer', 'jsonb'],
  'authenticated', array[]::text[],
  'authenticated callers cannot claim expiry work'
);
select function_privs_are(
  'public', 'prepare_booking_request_payment_required_expiry', array['uuid', 'jsonb'],
  'service_role', array['EXECUTE'],
  'only the service role receives preparation access'
);
select function_privs_are(
  'public', 'prepare_booking_request_payment_required_expiry', array['uuid', 'jsonb'],
  'authenticated', array[]::text[],
  'authenticated callers cannot inspect expiry evidence'
);
select table_privs_are(
  'public', 'booking_request_payment_required_expiry_work', 'service_role', array[]::text[],
  'service callers use the narrow expiry functions instead of private rows'
);
select table_privs_are(
  'public', 'booking_request_payment_required_expiry_operations', 'service_role', array[]::text[],
  'service callers use the narrow release functions instead of private rows'
);
select ok(
  coalesce((select classes.relrowsecurity from pg_class classes
    join pg_namespace namespaces on namespaces.oid = classes.relnamespace
    where namespaces.nspname = 'public'
      and classes.relname = 'booking_request_payment_required_expiry_work'), false),
  'expiry work has Row Level Security enabled'
);
select ok(
  coalesce((select classes.relrowsecurity from pg_class classes
    join pg_namespace namespaces on namespaces.oid = classes.relnamespace
    where namespaces.nspname = 'public'
      and classes.relname = 'booking_request_payment_required_expiry_operations'), false),
  'expiry operations have Row Level Security enabled'
);

select * from finish();
rollback;
