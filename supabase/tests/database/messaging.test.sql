begin;
select no_plan();

select has_table('public','messaging_conversations','booking journeys have a durable conversation identity');
select has_table('public','messaging_conversation_booking_requests','conversation and Booking Request associations are durable facts');
select has_table('public','messaging_send_attempts','message commands have one durable outcome receipt');
select has_table('public','messaging_messages','admitted message originals are durable private history');
select has_table('public','messaging_translations','authorized generated variants are immutable cached facts');
select has_table('public','messaging_translation_reports','poor-translation reports bind an immutable saved output');
select has_column('public','messaging_messages','contact_protected','message originals retain their admission-time contact-protection state');
select has_column('public','booking_request_submission_attempts','conversation_id','submission attempts preserve the inquiry they continue');
select has_function('public','create_messaging_conversation',array['uuid','uuid','uuid'],'conversation creation is an authoritative database boundary');
select has_function('public','create_messaging_conversation_for_cottage',array['uuid','text','uuid'],'public cottage entry resolves the private profile only inside the database');
select has_function('public','open_messaging_conversation_for_booking',array['uuid','text','uuid'],'existing bookings open messaging only through their retained originating attempt');
select has_function('public','admit_messaging_message',array['uuid','uuid','uuid','cottage_profile_source_language','text'],'message admission is an authoritative database boundary');
select has_function('public','list_messaging_conversations',array['timestamp with time zone','uuid','integer','text'],'the private inbox is an authenticated nonlocking projection with an optional cottage scope');
select has_function('public','get_messaging_conversation',array['uuid','bigint','integer'],'one private journey has an authenticated bounded nonlocking projection');
select has_function('public','prepare_messaging_translation',array['uuid','uuid','cottage_profile_source_language','text','text','text'],'translation generation begins with exact-message participant authorization');
select has_function('public','save_messaging_translation',array['uuid','uuid','cottage_profile_source_language','text','text','text','text'],'translation cache admission rechecks exact-message participant authorization');
select has_function('public','report_messaging_translation',array['uuid','uuid','uuid','text'],'translation reports bind an authorized reporter to a saved output');
select has_function('public','get_messaging_moderation',array['timestamp with time zone','uuid','text','integer'],'support has one bounded paged read-only moderation projection');
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
  'public.messaging_messages'::regclass,
  'public.messaging_translations'::regclass,
  'public.messaging_translation_reports'::regclass
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
select is(
  public.create_messaging_conversation_for_cottage(
    '36000000-0000-4000-8000-000000000002',
    'cottage-36100000000040008000000000000001',
    '36200000-0000-4000-8000-000000000001'
  )->>'conversationId',(select result->>'conversationId' from created_conversation),
  'a public cottage entry starts an enquiry without exposing a private profile identifier'
);
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
set local role service_role;
select is(public.admit_messaging_message('36000000-0000-4000-8000-000000000002',(select (result->>'conversationId')::uuid from created_conversation),'36300000-0000-4000-8000-000000000013','en','email customer @ example . com')->>'status','blocked','a repeated contact bypass attempt creates a separate body-free moderation fact');
reset role;
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='messaging_send_attempts' and column_name in('body','original_body','text')),'moderation receipts have no column capable of retaining rejected text');
set local role service_role;
select is(public.admit_messaging_message('36000000-0000-4000-8000-000000000002',(select (result->>'conversationId')::uuid from created_conversation),'36300000-0000-4000-8000-000000000001','en','Could we use the garden?'),(select result from safe_message),'an accepted command replays the original sent receipt');
select is(public.admit_messaging_message('36000000-0000-4000-8000-000000000002',(select (result->>'conversationId')::uuid from created_conversation),'36300000-0000-4000-8000-000000000001','ckb','Could we use the garden?')->>'status','invalid','an accepted command cannot be replayed with a different language');
select is(public.admit_messaging_message('36000000-0000-4000-8000-000000000002',(select (result->>'conversationId')::uuid from created_conversation),'36300000-0000-4000-8000-000000000001','en','Changed text')->>'status','invalid','an accepted command cannot be replayed with a different body');
select is(public.admit_messaging_message(
  '36000000-0000-4000-8000-000000000002',
  (select (result->>'conversationId')::uuid from created_conversation),
  '36300000-0000-4000-8000-000000000012','ckb','دووەم پرسیار'
)->>'status','sent','a later original is admitted to the same journey');
create temp table prepared_translation as select public.prepare_messaging_translation(
  '36000000-0000-4000-8000-000000000002',
  (select (result->>'messageId')::uuid from safe_message),
  'ar','fictional-local-test','deterministic-pairs-v1','message-pairs-v1'
) result;
select ok(
  (select result->>'status' from prepared_translation)='prepared'
  and (select result->>'originalBody' from prepared_translation)='Could we use the garden?'
  and (select result->>'originalLanguage' from prepared_translation)='en',
  'translation preparation returns only the authorized immutable source'
);
create temp table saved_translation as select public.save_messaging_translation(
  '36000000-0000-4000-8000-000000000002',
  (select (result->>'messageId')::uuid from safe_message),
  'ar','fictional-local-test','deterministic-pairs-v1','message-pairs-v1',
  'هل يمكننا استخدام الحديقة؟'
) result;
select is((select result->>'status' from saved_translation),'translated','a known fictional output is saved with its actual provenance');
select is(
  public.prepare_messaging_translation(
    '36000000-0000-4000-8000-000000000002',
    (select (result->>'messageId')::uuid from safe_message),
    'ar','fictional-local-test','deterministic-pairs-v1','message-pairs-v1'
  )->>'translationId',
  (select result->>'translationId' from saved_translation),
  'the immutable exact-provenance cache is reused without regeneration'
);
select is(
  public.save_messaging_translation(
    '36000000-0000-4000-8000-000000000002',
    (select (result->>'messageId')::uuid from safe_message),
    'ckb','fictional-local-test','deterministic-pairs-v1','message-pairs-v1',
    'پەیوەندی ٠٧٥٠ ١٢٣ ٤٥٦٧'
  )->>'status','blocked',
  'a generated contact-bearing variant of an originally protected message is rejected'
);
select is(
  public.prepare_messaging_translation(
    '36000000-0000-4000-8000-000000000005',
    (select (result->>'messageId')::uuid from safe_message),
    'ckb','fictional-local-test','deterministic-pairs-v1','message-pairs-v1'
  )->>'status','access-required',
  'support cannot trigger translation generation'
);
create temp table translation_report as select public.report_messaging_translation(
  '36000000-0000-4000-8000-000000000002',
  (select (result->>'translationId')::uuid from saved_translation),
  '36400000-0000-4000-8000-000000000001','incorrect'
) result;
select is((select result->>'status' from translation_report),'reported','an authorized participant can report the exact saved output');
select is(
  public.report_messaging_translation(
    '36000000-0000-4000-8000-000000000001',
    (select (result->>'translationId')::uuid from saved_translation),
    '36400000-0000-4000-8000-000000000003','unclear'
  )->>'status','reported',
  'the currently approved cottage owner can report the exact saved output'
);
select is(
  public.report_messaging_translation(
    '36000000-0000-4000-8000-000000000002',
    (select (result->>'translationId')::uuid from saved_translation),
    '36400000-0000-4000-8000-000000000001','incorrect'
  ),
  (select result from translation_report),
  'a report retry returns its original receipt without duplication'
);
select ok(
  public.prepare_messaging_translation(
    '36000000-0000-4000-8000-000000000002',
    (select (result->>'messageId')::uuid from safe_message),
    null,null,null,null
  )->>'status'='invalid'
  and public.save_messaging_translation(
    '36000000-0000-4000-8000-000000000002',
    (select (result->>'messageId')::uuid from safe_message),
    null,null,null,null,'text'
  )->>'status'='invalid'
  and public.report_messaging_translation(
    '36000000-0000-4000-8000-000000000002',
    (select (result->>'translationId')::uuid from saved_translation),
    '36400000-0000-4000-8000-000000000004',null
  )->>'status'='invalid',
  'translation boundaries reject null language, provenance and report category'
);
select is(
  public.report_messaging_translation(
    '36000000-0000-4000-8000-000000000002',
    (select (result->>'translationId')::uuid from saved_translation),
    '36400000-0000-4000-8000-000000000001','unclear'
  )->>'status','invalid',
  'a report command cannot be replayed with a different category'
);
select is(
  public.report_messaging_translation(
    '36000000-0000-4000-8000-000000000005',
    (select (result->>'translationId')::uuid from saved_translation),
    '36400000-0000-4000-8000-000000000002','incorrect'
  )->>'status','access-required',
  'support cannot create translation reports'
);
select is(public.admit_messaging_message('36000000-0000-4000-8000-000000000005',(select (result->>'conversationId')::uuid from created_conversation),'36300000-0000-4000-8000-000000000003','en','Support cannot send this')->>'status','access-required','support cannot send messages');
create temp table second_conversation as select public.create_messaging_conversation(
  '36000000-0000-4000-8000-000000000002','36100000-0000-4000-8000-000000000001','36200000-0000-4000-8000-000000000011') result;
reset role;
grant select on second_conversation to authenticated;

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
select ok((select count(*) from public.messaging_conversations)=2 and (select count(*) from public.messaging_conversation_booking_requests)=0 and (select count(*) from public.messaging_messages)=2 and (select count(*) from public.messaging_send_attempts)=0 and (select count(*) from public.messaging_translations)=1 and (select count(*) from public.messaging_translation_reports)=1,'the customer reads their conversations, originals, saved translations and own report but no unlinked request or moderation audit');
select ok(
  jsonb_array_length(public.list_messaging_conversations(null,null,1,null)->'items')=1
  and public.list_messaging_conversations(null,null,1,null)#>>'{items,0,conversationId}'=(select result->>'conversationId' from second_conversation)
  and public.list_messaging_conversations(null,null,1,null)->'nextCursor' is not null,
  'the inbox returns a stable newest-first page and an explicit continuation cursor'
);
select is(
  (
    with first_page as (
      select public.list_messaging_conversations(null,null,1,null) result
    )
    select public.list_messaging_conversations(
      (result#>>'{nextCursor,activityAt}')::timestamptz,
      (result#>>'{nextCursor,conversationId}')::uuid,
      1,null
    )#>>'{items,0,conversationId}'
    from first_page
  ),
  (select result->>'conversationId' from created_conversation),
  'the inbox continuation returns the next journey without a duplicate'
);
reset role;
insert into public.messaging_conversations(
  customer_user_id,profile_id,owner_user_id,creation_command_id,created_at
)
select '36000000-0000-4000-8000-000000000002',
  '36100000-0000-4000-8000-000000000002',
  '36000000-0000-4000-8000-000000000004',md5(series::text)::uuid,
  clock_timestamp() + series * interval '1 second'
from generate_series(1,21) series;
set local role authenticated;
select is(
  public.list_messaging_conversations(
    null,null,1,'cottage-36100000000040008000000000000001'
  )#>>'{items,0,cottage,publicSlug}',
  'cottage-36100000000040008000000000000001',
  'cottage selection filters before pagination despite twenty-one newer unrelated journeys'
);
select ok(
  public.get_messaging_conversation(
    (select (result->>'conversationId')::uuid from created_conversation),null,1
  )#>>'{messages,0,originalBody}'='دووەم پرسیار'
  and public.get_messaging_conversation(
    (select (result->>'conversationId')::uuid from created_conversation),null,1
  )#>>'{booking,writingClosed}' is null
  and (public.get_messaging_conversation(
    (select (result->>'conversationId')::uuid from created_conversation),null,1
  )->>'canContinueBookingRequest')::boolean,
  'the private journey reader returns the newest bounded original and does not invent booking dates or a deadline'
);
select is(
  (
    with first_page as (
      select public.get_messaging_conversation(
        (select (result->>'conversationId')::uuid from created_conversation),
        null,1
      ) result
    )
    select public.get_messaging_conversation(
      (select (result->>'conversationId')::uuid from created_conversation),
      (result->>'nextMessageCursor')::bigint,1
    )#>>'{messages,0,originalBody}' from first_page
  ),
  'Could we use the garden?',
  'the message cursor retrieves the older original without truncating history'
);
select set_config('request.jwt.claim.sub','36000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"36000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
select ok((select count(*) from public.messaging_conversations)=2 and (select count(*) from public.messaging_conversation_booking_requests)=0 and (select count(*) from public.messaging_messages)=2 and (select count(*) from public.messaging_send_attempts)=0 and (select count(*) from public.messaging_translations)=1 and (select count(*) from public.messaging_translation_reports)=1,'the current owner reads the same originals, saved output and own report without another participant report or moderation audit');
select set_config('request.jwt.claim.sub','36000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"36000000-0000-4000-8000-000000000003","aal":"aal1"}',true);
select ok((select count(*) from public.messaging_conversations)=0 and (select count(*) from public.messaging_conversation_booking_requests)=0 and (select count(*) from public.messaging_messages)=0 and (select count(*) from public.messaging_send_attempts)=0 and (select count(*) from public.messaging_translations)=0 and (select count(*) from public.messaging_translation_reports)=0,'a stranger reads no conversation, links, originals, translations, reports or moderation facts');
select set_config('request.jwt.claim.sub','36000000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"36000000-0000-4000-8000-000000000004","aal":"aal1"}',true);
select ok((select count(*) from public.messaging_conversations)=21 and (select count(*) from public.messaging_conversation_booking_requests)=0 and (select count(*) from public.messaging_messages)=0 and (select count(*) from public.messaging_send_attempts)=0 and (select count(*) from public.messaging_translations)=0 and (select count(*) from public.messaging_translation_reports)=0,'another owner reads only their own cottage conversations and no foreign originals, translations, reports or moderation facts');
select set_config('request.jwt.claim.sub','36000000-0000-4000-8000-000000000005',true);
select set_config('request.jwt.claims','{"sub":"36000000-0000-4000-8000-000000000005","aal":"aal1"}',true);
select ok((select count(*) from public.messaging_conversations)=0 and (select count(*) from public.messaging_conversation_booking_requests)=0 and (select count(*) from public.messaging_messages)=0 and (select count(*) from public.messaging_send_attempts)=0 and (select count(*) from public.messaging_translations)=0 and (select count(*) from public.messaging_translation_reports)=0,'support with first-factor assurance reads no messaging facts');
select throws_ok($$select public.get_messaging_moderation(null,null,null,50)$$,'42501',null,'support with first-factor assurance cannot use the moderation projection');
select set_config('request.jwt.claims','{"sub":"36000000-0000-4000-8000-000000000005","aal":"aal2"}',true);
select ok((select count(*) from public.messaging_conversations)=23 and (select count(*) from public.messaging_conversation_booking_requests)=0 and (select count(*) from public.messaging_messages)=2 and (select count(*) from public.messaging_send_attempts)=4 and (select count(*) from public.messaging_translations)=1 and (select count(*) from public.messaging_translation_reports)=2,'support with multi-factor assurance reads originals, saved translations, reports and moderation facts');
select ok(jsonb_array_length(public.get_messaging_moderation(null,null,null,3)->'items')=3 and public.get_messaging_moderation(null,null,null,3)->'nextCursor' is not null and exists(select 1 from jsonb_array_elements(public.get_messaging_moderation(null,null,null,3)->'items') item where item->>'type'='blocked' and item->>'actorRole'='customer' and (item->>'conversationBlockedAttemptCount')::integer=2),'support review is bounded, paged and gives body-free actor and repeated-attempt context');
reset role;

update public.account_contexts set owner_approval_state='expired' where user_id='36000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','36000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"36000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
set local role authenticated;
select ok((select count(*) from public.messaging_conversations)=0 and (select count(*) from public.messaging_conversation_booking_requests)=0 and (select count(*) from public.messaging_messages)=0 and (select count(*) from public.messaging_send_attempts)=0 and (select count(*) from public.messaging_translations)=0 and (select count(*) from public.messaging_translation_reports)=0,'an expired owner loses every messaging read capability including their prior translation report');
reset role;
set local role service_role;
select is(public.admit_messaging_message('36000000-0000-4000-8000-000000000001',(select (result->>'conversationId')::uuid from created_conversation),'36300000-0000-4000-8000-000000000010','en','Owner cannot send')->>'status','access-required','an expired owner loses the send capability');
reset role;

select * from finish();
rollback;
