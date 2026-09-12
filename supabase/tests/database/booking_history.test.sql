begin;
select plan(14);

select has_function('public','list_booking_history',array['text'],'history requires an explicit workspace');
select ok((select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.list_booking_history(text)'::regprocedure),'history owns its authenticated database boundary');

set session_replication_role=replica;
insert into auth.users(id,aud,role,phone,phone_confirmed_at) values
  ('10000000-0000-4000-8000-000000003701','authenticated','authenticated','+9647500003701',now()),
  ('10000000-0000-4000-8000-000000003702','authenticated','authenticated','+9647500003702',now()),
  ('10000000-0000-4000-8000-000000003703','authenticated','authenticated','+9647500003703',now());
insert into public.account_contexts(user_id,role,owner_approval_state) values
  ('10000000-0000-4000-8000-000000003701','cottage_owner','approved'),
  ('10000000-0000-4000-8000-000000003702','cottage_owner','approved'),
  ('10000000-0000-4000-8000-000000003703','customer',null);
insert into public.booking_snapshots(id,customer_user_id,profile_id,quote_fingerprint,intent_fingerprint,quote_payload,intent_payload,booking_terms_version,booking_terms_locale,booking_terms_body,booking_terms_sha256,cancellation_policy_version,acceptance_locale,acceptance_evidence,acceptance_evidence_fingerprint,marketplace_commission_rate_basis_points,marketplace_commission_amount_fils,created_at) values
  ('40000000-0000-4000-8000-000000003701','10000000-0000-4000-8000-000000003701','20000000-0000-4000-8000-000000003702',repeat('a',64),repeat('b',64),'{"cottageName":"Original owner two cottage","bookingPriceIqd":1000}'::jsonb,'{}','history-v1','en','Fictional terms',repeat('c',64),'fictional-v1','en','{}',repeat('d',64),1000,100000,'2100-12-20 10:00+00'),
  ('40000000-0000-4000-8000-000000003702','10000000-0000-4000-8000-000000003703','20000000-0000-4000-8000-000000003701',repeat('e',64),repeat('f',64),'{"cottageName":"Original dual owner cottage","bookingPriceIqd":2000}'::jsonb,'{}','history-v1','en','Fictional terms',repeat('1',64),'fictional-v1','en','{}',repeat('2',64),1000,200000,'2100-12-21 10:00+00');
insert into public.cottage_booking_period_commitments(id,customer_user_id,profile_id,schedule_revision_id,commitment_reference,status,access_ranges,created_at) values
  ('50000000-0000-4000-8000-000000003701','10000000-0000-4000-8000-000000003701','20000000-0000-4000-8000-000000003702','30000000-0000-4000-8000-000000003701','REQUEST-37-A','pending_hold','{["2101-01-02 05:00+00","2101-01-02 09:00+00"),["2101-01-03 20:00+00","2101-01-04 02:00+00")}'::tstzmultirange,'2100-12-20 10:00+00'),
  ('50000000-0000-4000-8000-000000003702','10000000-0000-4000-8000-000000003703','20000000-0000-4000-8000-000000003701','30000000-0000-4000-8000-000000003702','REQUEST-37-B','released_hold','{["2101-02-01 05:00+00","2101-02-01 09:00+00")}'::tstzmultirange,'2100-12-21 10:00+00');
insert into public.booking_requests(id,booking_request_reference,customer_user_id,owner_user_id,profile_id,booking_snapshot_id,booking_period_commitment_id,payment_lifecycle_id,customer_name,party_size,status,response_deadline,created_at,settled_at) values
  ('60000000-0000-4000-8000-000000003701','RC-REQ-0000000000003701','10000000-0000-4000-8000-000000003701','10000000-0000-4000-8000-000000003702','20000000-0000-4000-8000-000000003702','40000000-0000-4000-8000-000000003701','50000000-0000-4000-8000-000000003701','73000000-0000-4000-8000-000000003701','Fictional dual user',2,'pending','2100-12-20 14:00+00','2100-12-20 10:00+00',null),
  ('60000000-0000-4000-8000-000000003702','RC-REQ-0000000000003702','10000000-0000-4000-8000-000000003703','10000000-0000-4000-8000-000000003701','20000000-0000-4000-8000-000000003701','40000000-0000-4000-8000-000000003702','50000000-0000-4000-8000-000000003702','73000000-0000-4000-8000-000000003702','Fictional other customer',2,'declined','2100-12-21 14:00+00','2100-12-21 10:00+00','2100-12-21 11:00+00');
insert into public.owner_request_notifications(id,booking_request_id,owner_user_id,created_at) values
  ('90000000-0000-4000-8000-000000003702','60000000-0000-4000-8000-000000003702','10000000-0000-4000-8000-000000003701','2100-12-21 10:00+00');
set session_replication_role=origin;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000003701',true);
set local role authenticated;
create temp table customer_history as select public.list_booking_history('customer') value;
create temp table owner_history as select public.list_booking_history('cottage_owner') value;
select is(jsonb_array_length((select value from customer_history)),1,'customer workspace includes only actual customer participation');
select is(jsonb_array_length((select value from owner_history)),1,'owner workspace includes only actual owner participation');
select is((select value#>>'{0,status}' from customer_history),'pending','unconfirmed pending request is truthful');
select is((select value#>>'{0,status}' from owner_history),'declined','owner sees the durable declined outcome');
select is((select value#>>'{0,cottageName}' from customer_history),'Original owner two cottage','history uses the original Cottage snapshot');
select is((select value#>>'{0,firstStartsAt}' from customer_history),'2101-01-02T05:00:00+00:00','history preserves the first requested shift');
select is((select value#>>'{0,lastEndsAt}' from customer_history),'2101-01-04T02:00:00+00:00','history preserves the final requested shift across a multi-range period');
select ok(not ((select value->0 from customer_history) ?| array['receiptId','bookingReference','confirmedAt']),'unconfirmed history manufactures no paid receipt or confirmation');
select is((select value#>>'{0,actorRole}' from customer_history),'customer','customer workspace binds the returned role');
select is((select value#>>'{0,actorRole}' from owner_history),'cottage_owner','owner workspace binds the returned role');
select is(public.list_owner_booking_request_notifications()#>>'{0,customerName}','Fictional other customer','verified approved owner retains unpaid request details');
reset role;
set session_replication_role=replica;
update auth.users set phone_confirmed_at=null where id='10000000-0000-4000-8000-000000003701';
set session_replication_role=origin;
set local role authenticated;
select is(public.list_owner_booking_request_notifications(),'[]'::jsonb,'revoked phone verification denies unpaid request details');

select * from finish();
rollback;
