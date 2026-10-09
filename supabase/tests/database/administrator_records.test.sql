\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(78);

-- BEGIN ADMINISTRATOR RECORDS FIXTURE
-- Fictional reserved 250 namespace. The local transaction rolls every row back.
insert into auth.users (id, aud, role, phone, phone_confirmed_at)
select ('25000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', '+964799' || lpad(n::text, 7, '0'),
  case when n = 26 then null::timestamptz else now() end
from generate_series(1, 26) n;
insert into public.account_contexts (user_id, role, created_at)
select ('25000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'customer', '2026-09-01 00:00+00'::timestamptz
from generate_series(1, 26) n;
insert into auth.users (id, aud, role, phone, phone_confirmed_at, email, email_confirmed_at) values
 ('25000000-0000-4000-8000-000000000101','authenticated','authenticated','+9647510000101',now(),null,null),
 ('25000000-0000-4000-8000-000000000102','authenticated','authenticated','+9647510000102',now(),null,null),
 ('25000000-0000-4000-8000-000000000103','authenticated','authenticated','+9647510000103',now(),null,null),
 ('25000000-0000-4000-8000-000000000104','authenticated','authenticated','+9647510000104',now(),null,null),
 ('25000000-0000-4000-8000-000000000105','authenticated','authenticated','+9647510000105',now(),null,null),
 ('25000000-0000-4000-8000-000000000106','authenticated','authenticated','+9647510000106',now(),null,null),
 ('25000000-0000-4000-8000-000000000107','authenticated','authenticated','+9647510000107',now(),null,null),
 ('25000000-0000-4000-8000-000000000108','authenticated','authenticated','+9647510000108',now(),null,null),
 ('25000000-0000-4000-8000-000000000201','authenticated','authenticated',null,null,'admin-250@example.invalid',now()),
 ('25000000-0000-4000-8000-000000000202','authenticated','authenticated',null,null,'removed-250@example.invalid',now());
insert into public.account_contexts (user_id, role, owner_approval_state, created_at) values
 ('25000000-0000-4000-8000-000000000101','cottage_owner','approved','2026-09-02 00:00+00'),
 ('25000000-0000-4000-8000-000000000102','cottage_owner','prospective','2026-09-02 00:00+00'),
 ('25000000-0000-4000-8000-000000000103','cottage_owner','suspended','2026-09-02 00:00+00'),
 ('25000000-0000-4000-8000-000000000104','cottage_owner','expired','2026-09-02 00:00+00'),
 ('25000000-0000-4000-8000-000000000105','cottage_owner','prospective','2026-09-02 00:00+00'),
 ('25000000-0000-4000-8000-000000000106','cottage_owner','prospective','2026-09-02 00:00+00'),
 ('25000000-0000-4000-8000-000000000107','cottage_owner','prospective','2026-09-02 00:00+00'),
 ('25000000-0000-4000-8000-000000000108','cottage_owner','prospective','2026-09-02 00:00+00'),
 ('25000000-0000-4000-8000-000000000201','platform_administrator',null,'2026-09-01 00:00+00');
insert into public.owner_applications
 (id, owner_user_id, applicant_kind, legal_name, status, submitted_at, review_started_at, review_due_at, decided_at, version, created_at, review_paused_at)
values
 ('25000000-0000-4000-8000-000000000302','25000000-0000-4000-8000-000000000102','individual','Fictional Draft Secret','draft',null,null,null,null,1,'2026-09-01 20:00+00',null),
 ('25000000-0000-4000-8000-000000000303','25000000-0000-4000-8000-000000000105','individual','Fictional Queue Owner','submitted','2026-09-01 20:59+00',now(),now()+interval '72 hours',null,1,'2026-09-01 20:00+00',null),
 ('25000000-0000-4000-8000-000000000304','25000000-0000-4000-8000-000000000106','individual','Fictional Under Review','under_review','2026-09-02 20:59+00',now(),now()+interval '72 hours',null,2,'2026-09-02 20:00+00',null),
 ('25000000-0000-4000-8000-000000000305','25000000-0000-4000-8000-000000000101','individual','Fictional Historical Owner','approved','2026-09-03 21:00+00',now(),null,now(),3,'2026-09-03 20:00+00',null),
 ('25000000-0000-4000-8000-000000000306','25000000-0000-4000-8000-000000000107','individual','Fictional Information Owner','needs_information','2026-09-04 21:00+00',now(),null,null,3,'2026-09-04 20:00+00',now()),
 ('25000000-0000-4000-8000-000000000307','25000000-0000-4000-8000-000000000108','individual','Fictional Rejected Owner','rejected','2026-09-05 21:00+00',now(),null,now(),3,'2026-09-05 20:00+00',null);
insert into public.owner_application_transitions
 (application_id, from_status, to_status, application_version, actor_user_id, actor_subject_id, occurred_at)
values
 ('25000000-0000-4000-8000-000000000303','draft','submitted',1,'25000000-0000-4000-8000-000000000105','25000000-0000-4000-8000-000000000105','2026-09-01 20:59+00'),
 ('25000000-0000-4000-8000-000000000304','draft','submitted',1,'25000000-0000-4000-8000-000000000106','25000000-0000-4000-8000-000000000106','2026-09-02 20:59+00'),
 ('25000000-0000-4000-8000-000000000304','submitted','under_review',2,'25000000-0000-4000-8000-000000000201','25000000-0000-4000-8000-000000000201',now()),
 ('25000000-0000-4000-8000-000000000305','draft','submitted',1,'25000000-0000-4000-8000-000000000101','25000000-0000-4000-8000-000000000101','2026-09-03 21:00+00'),
 ('25000000-0000-4000-8000-000000000305','submitted','under_review',2,'25000000-0000-4000-8000-000000000201','25000000-0000-4000-8000-000000000201',now()),
 ('25000000-0000-4000-8000-000000000305','under_review','approved',3,'25000000-0000-4000-8000-000000000201','25000000-0000-4000-8000-000000000201',now()),
 ('25000000-0000-4000-8000-000000000306','draft','submitted',1,'25000000-0000-4000-8000-000000000107','25000000-0000-4000-8000-000000000107','2026-09-04 21:00+00'),
 ('25000000-0000-4000-8000-000000000306','submitted','under_review',2,'25000000-0000-4000-8000-000000000201','25000000-0000-4000-8000-000000000201',now()),
 ('25000000-0000-4000-8000-000000000306','under_review','needs_information',3,'25000000-0000-4000-8000-000000000201','25000000-0000-4000-8000-000000000201',now()),
 ('25000000-0000-4000-8000-000000000307','draft','submitted',1,'25000000-0000-4000-8000-000000000108','25000000-0000-4000-8000-000000000108','2026-09-05 21:00+00'),
 ('25000000-0000-4000-8000-000000000307','submitted','under_review',2,'25000000-0000-4000-8000-000000000201','25000000-0000-4000-8000-000000000201',now()),
 ('25000000-0000-4000-8000-000000000307','under_review','rejected',3,'25000000-0000-4000-8000-000000000201','25000000-0000-4000-8000-000000000201',now());
insert into public.owner_application_cottage_profiles
 (id, application_id, owner_user_id, name, governorate, approximate_location, exact_address,
  exact_latitude, exact_longitude, private_directions, capacity, bedrooms, bathrooms, amenities,
  source_language, description, house_rules)
values
 ('25000000-0000-4000-8000-000000000401','25000000-0000-4000-8000-000000000305',
  '25000000-0000-4000-8000-000000000101','Fictional Historic Snapshot','Baghdad','Karrada',
  'PRIVATE ADDRESS 250',33.3,44.4,'PRIVATE DIRECTIONS 250',4,2,1,array['garden'],'en',
  'Fictional description','Fictional rules'),
 ('25000000-0000-4000-8000-000000000402',null,
  '25000000-0000-4000-8000-000000000101','Fictional Legacy Cottage','Baghdad','Mansour',
  'PRIVATE ADDRESS 251',33.3,44.4,'PRIVATE DIRECTIONS 251',4,2,1,array['garden'],'en',
  'Fictional description','Fictional rules'),
 ('25000000-0000-4000-8000-000000000403','25000000-0000-4000-8000-000000000302',
  '25000000-0000-4000-8000-000000000102',null,'Baghdad','Mansour',
  'PRIVATE ADDRESS 252',33.3,44.4,'PRIVATE DIRECTIONS 252',4,2,1,array['garden'],'en',
  'Fictional description','Fictional rules');
insert into public.cottage_profile_photos
 (id, profile_id, owner_user_id, actor_user_id, object_path, original_filename, media_type, size_bytes, state)
values ('25000000-0000-4000-8000-000000000411','25000000-0000-4000-8000-000000000401',
  '25000000-0000-4000-8000-000000000101','25000000-0000-4000-8000-000000000101',
  'fictional/250/photo.webp','photo.webp','image/webp',128,'ready');
insert into storage.objects (bucket_id, name, owner_id, metadata)
values (public.cottage_profile_photo_bucket_name(),'fictional/250/photo.webp',
  '25000000-0000-4000-8000-000000000101','{"size":128,"mimetype":"image/webp"}'::jsonb);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal1"}',true);
select public.replace_cottage_shift_schedule('25000000-0000-4000-8000-000000000401',0,
  '[{"name":"Day","startTime":"08:00","endTime":"14:00"},{"name":"Evening","startTime":"18:00","endTime":"23:00"}]'::jsonb);
select public.submit_cottage_profile_for_content_approval('25000000-0000-4000-8000-000000000401',1);
reset role;
create temporary table administrator_records_saved_runtime as
select * from public.cottage_translation_runtime_control;
update public.cottage_translation_runtime_control
set production_ready = true,
    approved_evaluation_artifact_digest = repeat('a',64), production_approval_digest = repeat('b',64),
    provider_terms_approval_reference = 'fictional-terms', native_review_approval_reference = 'fictional-review',
    quality_threshold_approval_reference = 'fictional-threshold', ordinary_model = 'fictional-model',
    ordinary_effort = 'none', ordinary_prompt_version = 'v1', stronger_model = 'fictional-stronger',
    stronger_effort = 'none', stronger_prompt_version = 'v1', judge_model = 'fictional-judge',
    judge_effort = 'medium', judge_prompt_version = 'v1', monthly_request_limit = 100,
    monthly_token_limit = 100000, monthly_spend_microusd_limit = 1000000
where singleton;
set local role service_role;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000201","role":"service_role","aal":"aal2"}',true);
select public.begin_cottage_profile_translation_execution(
 (select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and cycle_number=1),'ar','ordinary',50000);
select public.begin_cottage_profile_translation_execution(
 (select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and cycle_number=1),'ckb','ordinary',50000);
select public.complete_cottage_profile_translation_execution(
 (select id from public.cottage_profile_translation_attempts where target_language='ar' and review_cycle_id=(select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and cycle_number=1)),
 (select lease_token from public.cottage_profile_translation_attempts where target_language='ar' and review_cycle_id=(select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and cycle_number=1)),
 'وصف خيالي','قواعد خيالية','fictional-provider','fictional-model','none','v1');
select public.complete_cottage_profile_translation_execution(
 (select id from public.cottage_profile_translation_attempts where target_language='ckb' and review_cycle_id=(select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and cycle_number=1)),
 (select lease_token from public.cottage_profile_translation_attempts where target_language='ckb' and review_cycle_id=(select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and cycle_number=1)),
 'وەسفی خەیاڵی','یاسای خەیاڵی','fictional-provider','fictional-model','none','v1');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000201","role":"authenticated","aal":"aal2"}',true);
select public.decide_cottage_profile_localization((select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and cycle_number=1),'en',true,'Fictional English approval');
select public.decide_cottage_profile_localization((select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and cycle_number=1),'ar',true,'Fictional Arabic approval');
select public.decide_cottage_profile_localization((select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and cycle_number=1),'ckb',true,'Fictional Sorani approval');
select public.approve_cottage_profile_publication((select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and cycle_number=1),'Fictional publication approval');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal1"}',true);
select public.report_current_cottage_translation(
 (select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and cycle_number=1),
 (select localized_revision_id from public.cottage_profile_localized_heads where review_cycle_id=(select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and cycle_number=1) and locale='ar'),
 'Fictional Arabic quality report');
reset role;
delete from public.cottage_translation_runtime_control;
insert into public.cottage_translation_runtime_control select * from administrator_records_saved_runtime;
-- END ADMINISTRATOR RECORDS FIXTURE

select is((select count(*) from public.account_contexts where role in ('customer','cottage_owner')),34::bigint,'fixture has 34 customer-capable accounts');
select is((select count(*) from public.account_contexts where role='cottage_owner'),8::bigint,'fixture has eight coherent owner states');
select is((select count(*) from public.owner_applications where status in ('submitted','under_review')),2::bigint,'fixture has two pending applications');
select is((select count(*) from public.owner_applications where status='needs_information'),1::bigint,'fixture has one paused application');
select is((select count(*) from public.owner_applications where status='rejected'),1::bigint,'fixture has one rejected application');
select is((select count(*) from public.owner_applications where status in ('submitted','under_review') and review_started_at is not null and review_due_at > now()),2::bigint,'pending applications have active review deadlines');
select is((select count(*) from auth.users where id::text like '25000000-%' and phone ~ '^\+964750000000[0-9]$'),0::bigint,'fixture phones avoid the access and booking-history reserved range');
select is((select count(*) from public.cottage_profile_review_cycles where state='approved'),1::bigint,'fixture has historical approved cycle');
select is((select count(*) from public.cottage_profile_review_cycles where state='in_review'),1::bigint,'fixture has remediation cycle');
select is((select count(*) from public.owner_application_cottage_profiles where status='submitted_for_content_approval'),0::bigint,'remediation profile is draft');
select is((select count(*) from public.cottage_profile_localized_decisions where review_cycle_id=(select id from public.cottage_profile_review_cycles where cycle_number=1 and profile_id='25000000-0000-4000-8000-000000000401')),3::bigint,'approved cycle has three localization decisions');
select has_function('public','search_administrator_records',array['text','text','text','date','date','uuid','timestamp with time zone','uuid'],'administrator records require AAL2 and return only the permitted projection');
select has_function('public','get_administrator_record',array['text','uuid'],'administrator detail reader exists');
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000201","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select is((public.search_administrator_records('customers',null,null,null,null,null,null,null)->>'total')::integer,34,'customers include owners but exclude staff');
select is((public.search_administrator_records('owners',null,null,null,null,null,null,null)->>'total')::integer,8,'owners include eight lifecycle states');
select is((public.search_administrator_records('customers',null,null,'2026-09-01','2026-09-01',null,null,null)->>'total')::integer,26,'26 matching customers at Baghdad date boundary');
select is(jsonb_array_length(public.search_administrator_records('customers',null,null,'2026-09-01','2026-09-01',null,null,null)->'rows'),25,'first page is bounded to 25');
select is((public.search_administrator_records('customers',null,null,'2026-09-01','2026-09-01',null,null,null)->'nextCursor') is not null,true,'first page exposes a continuation cursor');
select is(jsonb_array_length((with first_page as (
  select public.search_administrator_records('customers',null,null,'2026-09-01','2026-09-01',null,null,null) result
) select public.search_administrator_records('customers',null,null,'2026-09-01','2026-09-01',null,
  (result->'nextCursor'->>'at')::timestamptz,(result->'nextCursor'->>'id')::uuid)->'rows' from first_page)),1,'second tied-date page contains the remaining customer');
select is((with first_page as (
  select public.search_administrator_records('customers',null,null,'2026-09-01','2026-09-01',null,null,null) result
) select (public.search_administrator_records('customers',null,null,'2026-09-01','2026-09-01',null,
  (result->'nextCursor'->>'at')::timestamptz,(result->'nextCursor'->>'id')::uuid)->>'total')::integer from first_page),26,'continuation retains the full filtered total');
select is((with first_page as (
  select public.search_administrator_records('customers',null,null,'2026-09-01','2026-09-01',null,null,null) result
) select public.search_administrator_records('customers',null,null,'2026-09-01','2026-09-01',null,
  (result->'nextCursor'->>'at')::timestamptz,(result->'nextCursor'->>'id')::uuid)->'nextCursor' from first_page),'null'::jsonb,'last page has no continuation');
select is((public.search_administrator_records('customers',null,null,null,null,null,null,null)->>'pendingApplications')::integer,2,'global pending applications count shares search snapshot');
select is((public.search_administrator_records('customers',null,null,null,null,null,null,null)->>'pendingApprovals')::integer,1,'global pending approvals count uses remediation state');
select is((public.search_administrator_records('customers','25000000-0000-4000-8000-000000000001',null,null,null,null,null,null)->>'total')::integer,1,'exact UUID search');
select is((public.search_administrator_records('customers','+9647990000001',null,null,null,null,null,null)->>'total')::integer,1,'exact verified phone search');
select is((public.search_administrator_records('customers','25000000-0000-4000-8000-000000000026',null,null,null,null,null,null)->'rows'->0->>'maskedPhone'),
  null::text,'unconfirmed phone has no masked projection');
select is((public.search_administrator_records('customers','+9647990000026',null,null,null,null,null,null)->>'total')::integer,
  0,'unconfirmed phone cannot be used for exact search');
select is((public.search_administrator_records('owners','Fictional Draft Secret',null,null,null,null,null,null)->>'total')::integer,0,'draft owner name is excluded');
select is((public.search_administrator_records('owners','Fictional%',null,null,null,null,null,null)->>'total')::integer,0,'percent remains literal search text');
select is((public.search_administrator_records('owners','Fictional_',null,null,null,null,null,null)->>'total')::integer,0,'underscore remains literal search text');
select is((public.search_administrator_records('applications',null,'pending',null,null,null,null,null)->>'total')::integer,2,'pending applications include submitted and under review');
select is((select array_agg(row->>'status' order by row->>'status') from jsonb_array_elements(
  public.search_administrator_records('applications',null,'pending',null,null,null,null,null)->'rows') row),
  array['submitted','under_review'],'pending queue excludes paused and rejected applications');
select is((public.search_administrator_records('approvals',null,'in_review',null,null,null,null,null)->>'total')::integer,1,'approval queue uses review state');
select is((public.search_administrator_records('approvals',null,null,null,null,null,null,null)->>'total')::integer,2,'historical approvals remain searchable');
select is((public.search_administrator_records('applications',null,null,'2026-09-01','2026-09-01',null,null,null)->>'total')::integer,1,'application Baghdad date is inclusive');
select is((public.search_administrator_records('applications',null,null,'2026-09-02','2026-09-02',null,null,null)->>'total')::integer,1,'next Baghdad day excludes earlier application');
select is((public.search_administrator_records('owners',null,'prospective',null,null,null,null,null)->>'total')::integer,5,'owner state filtering is authoritative');
select is((public.search_administrator_records('cottages',null,null,null,null,'25000000-0000-4000-8000-000000000101',null,null)->>'total')::integer,2,'owner cottage filter includes both cottages');
select is((select row->>'label' from jsonb_array_elements(public.search_administrator_records('cottages',
  '25000000-0000-4000-8000-000000000403',null,null,null,null,null,null)->'rows') row),
  '25000000-0000-4000-8000-000000000403','nameless draft cottage has a stable search label');
select is((public.get_administrator_record('approval',(select id from public.cottage_profile_review_cycles where cycle_number=1 and profile_id='25000000-0000-4000-8000-000000000401'))->>'state'),'approved','historic approval detail remains addressable');
select is(jsonb_array_length(public.get_administrator_record('approval',(select id from public.cottage_profile_review_cycles where cycle_number=1 and profile_id='25000000-0000-4000-8000-000000000401'))->'localizedDecisions'),3,'historic decisions remain ordered and complete');
select lives_ok($$select public.decide_cottage_profile_localization(
  (select id from public.cottage_profile_review_cycles where cycle_number=2 and profile_id='25000000-0000-4000-8000-000000000401'),
  'ar',true,'First remediation decision'), public.decide_cottage_profile_localization(
  (select id from public.cottage_profile_review_cycles where cycle_number=2 and profile_id='25000000-0000-4000-8000-000000000401'),
  'ar',true,'Second remediation decision')$$,'the same localized revision can receive two decisions');
select is(jsonb_array_length(public.get_administrator_record('approval',
  (select id from public.cottage_profile_review_cycles where cycle_number=2 and profile_id='25000000-0000-4000-8000-000000000401'))->'localizedDecisions'),2,
  'remediation detail retains both decisions');
select is((select count(distinct decision->>'decisionId') from jsonb_array_elements(
  public.get_administrator_record('approval',(select id from public.cottage_profile_review_cycles where cycle_number=2
  and profile_id='25000000-0000-4000-8000-000000000401'))->'localizedDecisions') decision),2::bigint,
  'each repeated decision has a stable unique identifier');
select is((select count(distinct decision->>'revisionId') from jsonb_array_elements(
  public.get_administrator_record('approval',(select id from public.cottage_profile_review_cycles where cycle_number=2
  and profile_id='25000000-0000-4000-8000-000000000401'))->'localizedDecisions') decision),1::bigint,
  'both decisions refer to the same localized revision');
select ok(public.search_administrator_records('owners',null,null,null,null,null,null,null)::text !~ 'PRIVATE ADDRESS|PRIVATE DIRECTIONS|Fictional Draft Secret','search excludes private and draft data');
select ok(public.get_administrator_record('account','25000000-0000-4000-8000-000000000101')::text !~ 'PRIVATE ADDRESS|PRIVATE DIRECTIONS|\+9647510000101|@','account detail excludes exact location, raw phone and email');
select ok(public.search_administrator_records('customers',null,null,null,null,null,null,null)::text !~ 'PRIVATE ADDRESS|PRIVATE DIRECTIONS|\+9647[0-9]{10}|@|"(exactAddress|privateDirections|email|phone|objectPath|storagePath|signedUrl|documentId)"',
  'customer search excludes private canaries and forbidden fields');
select ok(public.search_administrator_records('cottages',null,null,null,null,null,null,null)::text !~ 'PRIVATE ADDRESS|PRIVATE DIRECTIONS|fictional/250/photo.webp|"(exactAddress|privateDirections|email|phone|objectPath|storagePath|signedUrl|documentId)"',
  'cottage search excludes private canaries and forbidden fields');
select ok(public.search_administrator_records('applications',null,null,null,null,null,null,null)::text !~ 'PRIVATE ADDRESS|PRIVATE DIRECTIONS|fictional/250/photo.webp|"(exactAddress|privateDirections|email|phone|objectPath|storagePath|signedUrl|documentId)"',
  'application search excludes private canaries and forbidden fields');
select ok(public.search_administrator_records('approvals',null,null,null,null,null,null,null)::text !~ 'PRIVATE ADDRESS|PRIVATE DIRECTIONS|fictional/250/photo.webp|"(exactAddress|privateDirections|email|phone|objectPath|storagePath|signedUrl|documentId)"',
  'approval search excludes private canaries and forbidden fields');
select ok(public.get_administrator_record('approval',(select id from public.cottage_profile_review_cycles where cycle_number=1 and profile_id='25000000-0000-4000-8000-000000000401'))::text !~ 'PRIVATE ADDRESS|PRIVATE DIRECTIONS|fictional/250/photo.webp|"(exactAddress|privateDirections|email|phone|objectPath|storagePath|signedUrl|documentId)"',
  'approval detail excludes private canaries and forbidden fields');
select is(public.get_administrator_record('account','25000000-0000-4000-8000-000000009999'::uuid),null::jsonb,'missing permitted account returns null');
select throws_ok($$select public.search_administrator_records('customers','%',null,null,null,null,null,null)$$,'22023',null,'literal wildcard cannot request a broad search');
select throws_ok($$select public.search_administrator_records('customers','25000000-0000-4000-8000-00000000000g',null,null,null,null,null,null)$$,'22023',null,'malformed account UUID is rejected');
select throws_ok($$select public.search_administrator_records('customers',null,null,'2026-09-02','2026-09-01',null,null,null)$$,'22023',null,'reverse date range is denied');
select throws_ok($$select public.search_administrator_records('customers',null,null,null,null,null,now(),null)$$,'22023',null,'partial cursor is denied');
select throws_ok($$select public.search_administrator_records('customers',null,'approved',null,null,null,null,null)$$,'22023',null,'invented customer status is denied');
reset role;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select throws_ok($$select public.search_administrator_records('customers',null,null,null,null,null,null,null)$$,'42501',null,'customer AAL2 cannot search');
select throws_ok($$select public.get_administrator_record('account','25000000-0000-4000-8000-000000000001')$$,'42501',null,'customer cannot read even own detail');
reset role;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select throws_ok($$select public.search_administrator_records('owners',null,null,null,null,null,null,null)$$,'42501',null,'owner AAL2 cannot search');
reset role;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000201","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok($$select public.get_administrator_record('account','25000000-0000-4000-8000-000000000001')$$,'42501',null,'administrator AAL1 cannot inspect');
reset role;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000202","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select throws_ok($$select public.search_administrator_records('customers',null,null,null,null,null,null,null)$$,'42501',null,'removed administrator cannot search');
reset role;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role anon;
select throws_ok($$select public.search_administrator_records('customers',null,null,null,null,null,null,null)$$,'42501',null,'anonymous caller cannot use forged claims');
reset role;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select throws_ok($$select public.search_administrator_booking_queue('requests',null,null,null,null,null)$$,'42501',null,'customer AAL2 cannot read the booking queue');
reset role;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select throws_ok($$select public.search_administrator_booking_queue('requests',null,null,null,null,null)$$,'42501',null,'owner AAL2 cannot read the booking queue');
reset role;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000201","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok($$select public.search_administrator_booking_queue('requests',null,null,null,null,null)$$,'42501',null,'administrator AAL1 cannot read the booking queue');
reset role;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000202","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select throws_ok($$select public.search_administrator_booking_queue('requests',null,null,null,null,null)$$,'42501',null,'removed administrator cannot read the booking queue');
reset role;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000201","role":"authenticated","aal":"aal2"}',true);
set local role anon;
select throws_ok($$select public.search_administrator_booking_queue('requests',null,null,null,null,null)$$,'42501',null,'anonymous caller cannot read the booking queue with forged administrator claims');
reset role;
select ok(not has_function_privilege('anon','public.search_administrator_booking_queue(text,text,date,date,timestamptz,uuid)','EXECUTE'),'anonymous role cannot execute the booking queue reader');
select ok(not has_function_privilege('service_role','public.search_administrator_booking_queue(text,text,date,date,timestamptz,uuid)','EXECUTE'),'service role cannot execute the booking queue reader');
select ok(has_function_privilege('authenticated','public.search_administrator_booking_queue(text,text,date,date,timestamptz,uuid)','EXECUTE'),'authenticated role reaches the booking queue reader and its AAL2 gate');
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000201","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select is(public.search_administrator_booking_queue('requests',null,null,null,null,null)->>'queue','requests','administrator AAL2 reads the Booking Request queue');
select throws_ok($$select public.search_administrator_booking_queue('disputes',null,null,null,null,null)$$,'22023',null,'unknown booking queue is denied');
select throws_ok($$select public.search_administrator_booking_queue('requests','succeeded',null,null,null,null)$$,'22023',null,'a refund state is not a Booking Request queue state');
select throws_ok($$select public.search_administrator_booking_queue('requests',null,'2026-09-02','2026-09-01',null,null)$$,'22023',null,'reverse booking queue date range is denied');
select throws_ok($$select public.search_administrator_booking_queue('requests',null,null,null,now(),null)$$,'22023',null,'partial booking queue cursor is denied');
reset role;
select is((select array[provolatile::text,prosecdef::text] from pg_proc where oid='public.search_administrator_booking_queue(text,text,date,date,timestamptz,uuid)'::regprocedure),array['s','true'],'booking queue reader is a stable privileged read');
select * from finish();
rollback;
