begin;
-- BEGIN PAYMENT EVIDENCE FIXTURE
-- Test arrangement: admission, isolated effect, and explicit recording.

-- END PAYMENT EVIDENCE FIXTURE
select plan(10);

select has_column('public','booking_request_capture_work','payment_required_recorded_at',
  'capture work stores when Customer action became required');
select has_column('public','booking_request_capture_work','payment_required_deadline',
  'capture work stores the fixed Payment Required deadline');
select has_function('public','record_booking_request_capture_failure',array['uuid','bigint','uuid','jsonb'],
  'service boundary records definitive failure');
select has_function('public','record_booking_request_capture_observation',array['uuid','jsonb'],
  'simulator exposes explicit selected Capture outcome without an ambiguous default');
select function_privs_are('public','record_booking_request_capture_failure',array['uuid','bigint','uuid','jsonb'],
  'service_role',array['EXECUTE'], 'service role may record definitive failure');
select function_privs_are('public','record_booking_request_capture_failure',array['uuid','bigint','uuid','jsonb'],
  'authenticated',array[]::text[], 'authenticated users cannot record definitive failure');
select function_privs_are('public','record_booking_request_capture_failure',array['uuid','bigint','uuid','jsonb'],
  'anon',array[]::text[], 'anonymous users cannot record definitive failure');
select table_privs_are('public','booking_request_capture_work','authenticated',array[]::text[],
  'authenticated users cannot inspect private Capture work');
select table_privs_are('public','booking_request_capture_work','anon',array[]::text[],
  'anonymous users cannot inspect private Capture work');
select ok(exists(select 1 from pg_constraint where conrelid='public.booking_request_capture_work'::regclass
  and conname='booking_request_capture_work_state_shape'
  and pg_get_constraintdef(oid) like '%payment_required_deadline%'), 'database constrains the fixed Payment Required deadline');

select * from finish();
rollback;
