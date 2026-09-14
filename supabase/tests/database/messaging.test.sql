begin;
select no_plan();

select has_table('public','messaging_conversations','booking journeys have a durable conversation identity');
select has_table('public','messaging_conversation_booking_requests','conversation and Booking Request associations are durable facts');
select has_table('public','messaging_send_attempts','message commands have one durable outcome receipt');
select has_table('public','messaging_messages','admitted message originals are durable private history');
select has_column('public','messaging_messages','contact_protected','message originals retain their admission-time contact-protection state');
select has_column('public','booking_request_submission_attempts','conversation_id','submission attempts preserve the inquiry they continue');
select has_function('public','create_messaging_conversation',array['uuid','uuid','uuid'],'conversation creation is an authoritative database boundary');
select has_function('public','admit_messaging_message',array['uuid','uuid','uuid','cottage_profile_source_language','text'],'message admission is an authoritative database boundary');
select has_function('public','contact_protection_text_is_safe',array['text'],'contact protection is shared across Booking Requests and messages');
select ok(public.booking_request_content_is_safe('Please prepare the garden.') and not public.booking_request_content_is_safe('+964 750 123 4567'),'the preserved Booking Request contact wrapper retains its behavior');
select ok(public.contact_protection_text_is_safe('Could we use the pool?')
  and not public.contact_protection_text_is_safe('seven five zero 123 4567')
  and not public.contact_protection_text_is_safe('٠٧٥٠ ١٢٣ ٤٥٦٧')
  and not public.contact_protection_text_is_safe('۰۷۵۰ ۱۲۳ ۴۵۶۷'),
  'the shared filter preserves English, Arabic and Persian digit protection');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.messaging_conversations'::regclass,
  'public.messaging_conversation_booking_requests'::regclass,
  'public.messaging_send_attempts'::regclass,
  'public.messaging_messages'::regclass
)),'all private messaging facts have Row Level Security enabled');
select ok(not has_table_privilege('anon','public.messaging_conversations','SELECT')
  and not has_table_privilege('service_role','public.messaging_conversations','SELECT')
  and not has_function_privilege('authenticated','public.create_messaging_conversation(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.admit_messaging_message(uuid,uuid,uuid,public.cottage_profile_source_language,text)','EXECUTE'),
  'browser and service API roles receive only their narrow messaging capabilities');

insert into auth.users(id,aud,role,phone,phone_confirmed_at,email,email_confirmed_at) values
('36000000-0000-4000-8000-000000000001','authenticated','authenticated','+9647500003601',clock_timestamp(),null,null),
('36000000-0000-4000-8000-000000000002','authenticated','authenticated','+9647500003602',clock_timestamp(),null,null),
('36000000-0000-4000-8000-000000000003','authenticated','authenticated','+9647500003603',clock_timestamp(),null,null),
('36000000-0000-4000-8000-000000000004','authenticated','authenticated','+9647500003604',clock_timestamp(),null,null),
('36000000-0000-4000-8000-000000000005','authenticated','authenticated',null,null,'message-admin@example.test',clock_timestamp()),
('36000000-0000-4000-8000-000000000006','authenticated','authenticated','+9647500003606',null,null,null),
('36000000-0000-4000-8000-000000000007','authenticated','authenticated','+9647500003607',clock_timestamp(),null,null);
insert into public.account_contexts(user_id,role,owner_approval_state) values
('36000000-0000-4000-8000-000000000001','cottage_owner','approved'),
('36000000-0000-4000-8000-000000000002','customer',null),
('36000000-0000-4000-8000-000000000003','customer',null),
('36000000-0000-4000-8000-000000000004','cottage_owner','approved'),
('36000000-0000-4000-8000-000000000005','platform_administrator',null),
('36000000-0000-4000-8000-000000000006','customer',null),
('36000000-0000-4000-8000-000000000007','cottage_owner','suspended');
insert into public.owner_application_cottage_profiles(id,owner_user_id,name,governorate,approximate_location,exact_address,capacity,bedrooms,bathrooms,amenities,source_language,description,house_rules,status) values
('36100000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000001','Messaging Cottage','Baghdad','Karrada','Private',8,3,2,array['garden'],'en','Description','Rules','draft'),
('36100000-0000-4000-8000-000000000002','36000000-0000-4000-8000-000000000004','Other Cottage','Baghdad','Mansour','Private',6,2,1,array['parking'],'en','Description','Rules','draft'),
('36100000-0000-4000-8000-000000000003','36000000-0000-4000-8000-000000000007','Suspended Cottage','Baghdad','Adhamiya','Private',4,2,1,array['wifi'],'en','Description','Rules','draft');
insert into public.cottage_marketplace_listings(profile_id,public_slug,state) values
('36100000-0000-4000-8000-000000000001','cottage-36100000000040008000000000000001','published'),
('36100000-0000-4000-8000-000000000002','cottage-36100000000040008000000000000002','published'),
('36100000-0000-4000-8000-000000000003','cottage-36100000000040008000000000000003','published');

set local role authenticated;
select throws_ok($$select public.create_messaging_conversation('36000000-0000-4000-8000-000000000002','36100000-0000-4000-8000-000000000001','36200000-0000-4000-8000-000000000001')$$,'42501',null,'authenticated callers cannot bypass the server conversation boundary');
reset role;
set local role service_role;
create temp table created_conversation as select public.create_messaging_conversation(
  '36000000-0000-4000-8000-000000000002','36100000-0000-4000-8000-000000000001','36200000-0000-4000-8000-000000000001') result;
reset role;
grant select on created_conversation to service_role,authenticated;
select is((select result->>'status' from created_conversation),'created','a verified customer can start an inquiry with a current published owner');
set local role service_role;
select is(public.create_messaging_conversation('36000000-0000-4000-8000-000000000002','36100000-0000-4000-8000-000000000001','36200000-0000-4000-8000-000000000001')->>'conversationId',(select result->>'conversationId' from created_conversation),'a retried creation command returns the original conversation');
select is(public.create_messaging_conversation('36000000-0000-4000-8000-000000000002','36100000-0000-4000-8000-000000000002','36200000-0000-4000-8000-000000000001')->>'status','invalid','a creation command cannot be replayed for a different cottage');
select is(public.create_messaging_conversation('36000000-0000-4000-8000-000000000006','36100000-0000-4000-8000-000000000001','36200000-0000-4000-8000-000000000002')->>'status','access-required','conversation creation requires a verified phone');
select is(public.create_messaging_conversation('36000000-0000-4000-8000-000000000005','36100000-0000-4000-8000-000000000001','36200000-0000-4000-8000-000000000003')->>'status','access-required','support cannot create a customer conversation');
select is(public.create_messaging_conversation('36000000-0000-4000-8000-000000000001','36100000-0000-4000-8000-000000000001','36200000-0000-4000-8000-000000000004')->>'status','access-required','an owner cannot open an inquiry with their own cottage');
select is(public.create_messaging_conversation('36000000-0000-4000-8000-000000000002','36100000-0000-4000-8000-000000000003','36200000-0000-4000-8000-000000000005')->>'status','access-required','a suspended owner cannot receive a new inquiry');
create temp table safe_message as select public.admit_messaging_message('36000000-0000-4000-8000-000000000002',(select (result->>'conversationId')::uuid from created_conversation),'36300000-0000-4000-8000-000000000001','en','Could we use the garden?') result;
reset role;
grant select on safe_message to service_role,authenticated;
select is((select result->>'status' from safe_message),'sent','safe inquiry text is admitted before payment');
select ok((select contact_protected from public.messaging_messages where send_attempt_id=(select id from public.messaging_send_attempts where command_id='36300000-0000-4000-8000-000000000001')),'a pre-payment message permanently records that generated variants must remain contact protected');
set local role service_role;
create temp table blocked_message as select public.admit_messaging_message('36000000-0000-4000-8000-000000000002',(select (result->>'conversationId')::uuid from created_conversation),'36300000-0000-4000-8000-000000000002','ar','اتصل ٠٧٥٠ ١٢٣ ٤٥٦٧') result;
select is(public.admit_messaging_message('36000000-0000-4000-8000-000000000002',(select (result->>'conversationId')::uuid from created_conversation),'36300000-0000-4000-8000-000000000002','ar','اتصل ٠٧٥٠ ١٢٣ ٤٥٦٧'),(select result from blocked_message),'a blocked command replays one stable rejection receipt');
reset role;
grant select on blocked_message to service_role,authenticated;
select is((select result from blocked_message),'{"status":"blocked","reason":"contact-restricted"}'::jsonb,'contact text is rejected without returning or retaining its body');
select is((select count(*) from public.messaging_send_attempts where command_id='36300000-0000-4000-8000-000000000002'),1::bigint,'a blocked retry creates one moderation fact');
select is((select blocked_category from public.messaging_send_attempts where command_id='36300000-0000-4000-8000-000000000002'),'contact','the moderation fact preserves only the blocked category');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='messaging_send_attempts' and column_name in('body','original_body','text')),'moderation receipts have no column capable of retaining rejected text');
set local role service_role;
select is(public.admit_messaging_message('36000000-0000-4000-8000-000000000002',(select (result->>'conversationId')::uuid from created_conversation),'36300000-0000-4000-8000-000000000001','en','Could we use the garden?'),(select result from safe_message),'an accepted command replays the original sent receipt');
select is(public.admit_messaging_message('36000000-0000-4000-8000-000000000002',(select (result->>'conversationId')::uuid from created_conversation),'36300000-0000-4000-8000-000000000001','ckb','Could we use the garden?')->>'status','invalid','an accepted command cannot be replayed with a different language');
select is(public.admit_messaging_message('36000000-0000-4000-8000-000000000002',(select (result->>'conversationId')::uuid from created_conversation),'36300000-0000-4000-8000-000000000001','en','Changed text')->>'status','invalid','an accepted command cannot be replayed with a different body');
select is(public.admit_messaging_message('36000000-0000-4000-8000-000000000005',(select (result->>'conversationId')::uuid from created_conversation),'36300000-0000-4000-8000-000000000003','en','Support cannot send this')->>'status','access-required','support cannot send messages');
reset role;

select ok(not public.messaging_writing_is_closed(
  '2026-09-14 11:00:00+00', '2026-10-14 10:59:59.999999+00'
),'writing remains available one microsecond before the thirty-day cutoff');
select ok(public.messaging_writing_is_closed(
  '2026-09-14 11:00:00+00', '2026-10-14 11:00:00+00'
),'writing stops at exact equality with the thirty-day cutoff');
set local timezone='America/New_York';
select ok(not public.messaging_writing_is_closed(
  '2026-03-01 12:00:00+00', '2026-03-31 11:59:59.999999+00'
) and public.messaging_writing_is_closed(
  '2026-03-01 12:00:00+00', '2026-03-31 12:00:00+00'
),'the elapsed thirty-day boundary is invariant across a daylight-saving transition');
set local timezone='UTC';

select throws_ok($$update public.messaging_messages set original_body='Changed'$$,'RC204',null,'stored message originals are immutable');
select throws_ok($$delete from public.messaging_send_attempts$$,'RC204',null,'moderation and admission audit facts cannot be removed');

select set_config('request.jwt.claim.sub','36000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"36000000-0000-4000-8000-000000000002","aal":"aal1"}',true);
set local role authenticated;
select ok((select count(*) from public.messaging_conversations)=1 and (select count(*) from public.messaging_conversation_booking_requests)=0 and (select count(*) from public.messaging_messages)=1 and (select count(*) from public.messaging_send_attempts)=0,'the customer reads their conversation and originals but no unlinked request or moderation audit');
select set_config('request.jwt.claim.sub','36000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"36000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
select ok((select count(*) from public.messaging_conversations)=1 and (select count(*) from public.messaging_conversation_booking_requests)=0 and (select count(*) from public.messaging_messages)=1 and (select count(*) from public.messaging_send_attempts)=0,'the current owner reads the same private history without moderation audit');
select set_config('request.jwt.claim.sub','36000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"36000000-0000-4000-8000-000000000003","aal":"aal1"}',true);
select ok((select count(*) from public.messaging_conversations)=0 and (select count(*) from public.messaging_conversation_booking_requests)=0 and (select count(*) from public.messaging_messages)=0 and (select count(*) from public.messaging_send_attempts)=0,'a stranger reads no conversation, links, originals or moderation facts');
select set_config('request.jwt.claim.sub','36000000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"36000000-0000-4000-8000-000000000004","aal":"aal1"}',true);
select ok((select count(*) from public.messaging_conversations)=0 and (select count(*) from public.messaging_conversation_booking_requests)=0 and (select count(*) from public.messaging_messages)=0 and (select count(*) from public.messaging_send_attempts)=0,'another owner reads no conversation, links, originals or moderation facts');
select set_config('request.jwt.claim.sub','36000000-0000-4000-8000-000000000005',true);
select set_config('request.jwt.claims','{"sub":"36000000-0000-4000-8000-000000000005","aal":"aal1"}',true);
select ok((select count(*) from public.messaging_conversations)=0 and (select count(*) from public.messaging_conversation_booking_requests)=0 and (select count(*) from public.messaging_messages)=0 and (select count(*) from public.messaging_send_attempts)=0,'support with first-factor assurance reads no messaging facts');
select set_config('request.jwt.claims','{"sub":"36000000-0000-4000-8000-000000000005","aal":"aal2"}',true);
select ok((select count(*) from public.messaging_conversations)=1 and (select count(*) from public.messaging_conversation_booking_requests)=0 and (select count(*) from public.messaging_messages)=1 and (select count(*) from public.messaging_send_attempts)=2,'support with multi-factor assurance reads originals and moderation facts only');
reset role;

update public.account_contexts set owner_approval_state='expired' where user_id='36000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','36000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"36000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
set local role authenticated;
select ok((select count(*) from public.messaging_conversations)=0 and (select count(*) from public.messaging_conversation_booking_requests)=0 and (select count(*) from public.messaging_messages)=0 and (select count(*) from public.messaging_send_attempts)=0,'an expired owner loses every messaging read capability');
reset role;
set local role service_role;
select is(public.admit_messaging_message('36000000-0000-4000-8000-000000000001',(select (result->>'conversationId')::uuid from created_conversation),'36300000-0000-4000-8000-000000000010','en','Owner cannot send')->>'status','access-required','an expired owner loses the send capability');
reset role;

select * from finish();
rollback;
