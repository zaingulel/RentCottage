begin;
select plan(12);

select has_table('public', 'booking_confirmation_notification_work', 'one work row owns each receipt delivery');
select has_table('public', 'booking_confirmation_notification_attempts', 'application attempts are durable history');
select has_table('public', 'fictional_booking_confirmation_notification_effects', 'fictional supplier effects are independent evidence');
select has_function('public', 'list_due_booking_confirmation_notifications', array['integer'], 'service lists bounded candidates');
select has_function('public', 'ensure_booking_confirmation_notification_work', array['uuid', 'text', 'text', 'jsonb'], 'service freezes the first complete binding');
select has_function('public', 'lease_booking_confirmation_notification_work', array['uuid'], 'service claims a database-clock lease');
select has_function('public', 'query_fictional_booking_confirmation_notification_effect', array['uuid', 'bigint', 'uuid', 'jsonb'], 'fictional adapter queries independent effects');
select has_function('public', 'execute_fictional_booking_confirmation_notification_effect', array['uuid', 'bigint', 'uuid', 'jsonb'], 'fictional adapter executes behind the paid and lease guard');
select has_function('public', 'complete_booking_confirmation_notification_delivery', array['uuid', 'bigint', 'uuid', 'jsonb', 'uuid'], 'application completion requires exact effect evidence');
select has_function('public', 'record_booking_confirmation_notification_failure', array['uuid', 'bigint', 'uuid', 'text'], 'application records failed or unknown outcomes');
select has_function('public', 'get_booking_confirmation_notification_status', array['uuid'], 'participants read only their delivery status');
select has_function('public', 'retry_booking_confirmation_notification', array['uuid'], 'participants retry only their own safe failure');

select * from finish();
rollback;
