-- BEGIN HISTORY BROWSER FIXTURE
insert into auth.users (id, aud, role, phone, phone_confirmed_at) values
('10000000-0000-4000-8000-000000001371','authenticated','authenticated','+9647500001371',now()),
('10000000-0000-4000-8000-000000001372','authenticated','authenticated','+9647500001372',now());
insert into public.account_contexts (user_id, role, owner_approval_state) values
('10000000-0000-4000-8000-000000001371','cottage_owner','approved'),
('10000000-0000-4000-8000-000000001372','customer',null);
insert into public.owner_application_cottage_profiles
(id,owner_user_id,name,governorate,approximate_location,exact_address,capacity,bedrooms,bathrooms,amenities,source_language,description,house_rules,status)
values ('20000000-0000-4000-8000-000000001371','10000000-0000-4000-8000-000000001371','History Cottage','Baghdad','Karrada','Sensitive exact address',8,3,2,array['garden'],'en','Fixture description','Fixture rules','draft');
insert into public.cottage_shift_schedule_revisions (id,profile_id,revision,full_day_bundle_id)
values ('30000000-0000-4000-8000-000000001371','20000000-0000-4000-8000-000000001371',1,'31000000-0000-4000-8000-000000001371');
select set_config('rentcottage.shift_schedule_write_revision_id','30000000-0000-4000-8000-000000001371',true);
insert into public.cottage_shifts (id,schedule_revision_id,position,name,start_time,end_time)
values
('32000000-0000-4000-8000-000000001371','30000000-0000-4000-8000-000000001371',1,'Morning','08:00','12:00'),
('32000000-0000-4000-8000-000000001372','30000000-0000-4000-8000-000000001371',2,'Evening','14:00','18:00');
select set_config('rentcottage.shift_schedule_write_revision_id','',true);
insert into public.booking_snapshots
(id,customer_user_id,profile_id,quote_fingerprint,intent_fingerprint,quote_payload,intent_payload,booking_terms_version,booking_terms_locale,booking_terms_body,booking_terms_sha256,cancellation_policy_version,acceptance_locale,acceptance_evidence,acceptance_evidence_fingerprint,marketplace_commission_rate_basis_points,marketplace_commission_amount_fils,created_at)
values ('40000000-0000-4000-8000-000000001371','10000000-0000-4000-8000-000000001372','20000000-0000-4000-8000-000000001371',repeat('a',64),repeat('b',64),
'{"bookingPriceIqd":100000,"serviceFeeIqd":5000,"customerTotalIqd":105000,"items":[{"serviceDay":"2101-01-01","kind":"shift","position":1}]}'::jsonb,
'{"customerName":"Sensitive Customer","partySize":4}'::jsonb,'history-test-v1','en','Fictional terms',repeat('c',64),'fictional-cancellation-v1','en','{}'::jsonb,repeat('d',64),1000,10000000,'2100-12-31 12:00+00');
insert into public.cottage_booking_period_commitments
(id,customer_user_id,profile_id,schedule_revision_id,commitment_reference,status,access_ranges,created_at)
values ('50000000-0000-4000-8000-000000001371','10000000-0000-4000-8000-000000001372','20000000-0000-4000-8000-000000001371','30000000-0000-4000-8000-000000001371','HISTORY-HOLD-137','pending_hold','{["2101-01-01 05:00+00","2101-01-01 09:00+00")}'::tstzmultirange,'2100-12-31 11:59:59+00');
insert into public.cottage_inventory_commitments
(id,unit_kind,unit_id,service_day,committed_price_iqd,booking_period_commitment_id)
values ('51000000-0000-4000-8000-000000001371','shift','32000000-0000-4000-8000-000000001371','2101-01-01',100000,'50000000-0000-4000-8000-000000001371');
insert into public.cottage_booking_period_occupancies
(booking_period_commitment_id,schedule_revision_id,shift_id,service_day,active)
values ('50000000-0000-4000-8000-000000001371','30000000-0000-4000-8000-000000001371','32000000-0000-4000-8000-000000001371','2101-01-01',true);
insert into public.booking_requests
(id,booking_request_reference,customer_user_id,owner_user_id,profile_id,booking_snapshot_id,booking_period_commitment_id,payment_lifecycle_id,customer_name,party_size,status,response_deadline,created_at)
values ('60000000-0000-4000-8000-000000001371','RC-REQ-0000000000000137','10000000-0000-4000-8000-000000001372','10000000-0000-4000-8000-000000001371','20000000-0000-4000-8000-000000001371','40000000-0000-4000-8000-000000001371','50000000-0000-4000-8000-000000001371','73000000-0000-4000-8000-000000001371','Sensitive Customer',4,'pending','2100-12-31 16:00+00','2100-12-31 12:00+00');

select public.append_booking_request_payment_history(