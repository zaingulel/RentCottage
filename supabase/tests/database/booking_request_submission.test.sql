begin;
-- BEGIN PAYMENT EVIDENCE FIXTURE
-- Test arrangement: admission, isolated effect, and explicit recording.
create or replace function pg_temp.payment_fixture_result(admission jsonb, outcome text, failure_retry_safe boolean default false) returns jsonb language plpgsql as $$
declare effect_binding jsonb:=admission-array['purpose','binding','mode'];
declare observed jsonb;
declare proposed jsonb;
declare recorder text;
declare operation_id text:=admission->>'operationId';
begin
  if admission->>'status'='not-admitted' then return jsonb_build_object('outcome','not-executed'); end if;
  if operation_id is null then return admission; end if;
  proposed:=jsonb_build_object('outcome',outcome,'providerRequestId','fixture-request-'||operation_id,'providerReference','fixture-reference-'||operation_id,
    'evidence',jsonb_build_object('operationId',operation_id,'eventId','fixture-'||operation_id||'-'||outcome,'provenance','fictional-provider',
      'originalOutcome',outcome,'executedAt',clock_timestamp(),'occurredAt',case when outcome<>'indeterminate' then clock_timestamp() end,'closedAt',null))
    ||case when outcome='failed' then jsonb_build_object('retrySafe',failure_retry_safe) else jsonb_build_object('movementReference','fixture-movement-'||operation_id) end;
  if admission->>'mode'='execute' then observed:=public.persist_simulated_payment_effect(effect_binding,proposed);
  else
    observed:=public.seal_simulated_payment_absence(effect_binding);
    if observed->>'outcome'='indeterminate' and outcome<>'indeterminate' then
      proposed:=jsonb_set(proposed,'{evidence,originalOutcome}',observed#>'{evidence,originalOutcome}');
      proposed:=jsonb_set(proposed,'{evidence,executedAt}',observed#>'{evidence,executedAt}');
      proposed:=proposed||jsonb_build_object('providerRequestId',observed->>'providerRequestId','providerReference',observed->>'providerReference');
      if outcome='succeeded' then proposed:=proposed||jsonb_build_object('movementReference',observed->>'movementReference'); end if;
      observed:=public.resolve_simulated_payment_effect(effect_binding,observed#>>'{evidence,eventId}',proposed);
    end if;
  end if;
  recorder:=case admission->>'purpose' when 'booking-request-capture' then 'record_booking_request_capture_observation'
    when 'booking-request-payment-recovery' then 'record_booking_request_payment_recovery_observation'
    when 'booking-request-payment-required-expiry' then 'record_booking_request_payment_required_expiry_observation'
    when 'booking-request-payment-required-corrective-refund' then 'record_booking_request_payment_required_expiry_observation'
    else 'record_booking_request_provider_operation_observation' end;
  if admission->>'purpose'='booking-request-release' then
    observed:=public.record_booking_request_release_observation(operation_id::uuid,observed,
      observed->>'outcome'='failed' and observed->'retrySafe'='false'::jsonb);
  else
    execute format('select public.%I($1,$2)',recorder) into observed using operation_id::uuid,observed;
  end if;
  return observed-'evidence';
end;
$$;
create or replace function pg_temp.payment_fixture_execute(routine text,permit jsonb,outcome text,failure_retry_safe boolean default false) returns jsonb language plpgsql as $$
declare prior_role text:=current_setting('role'); declare admission jsonb; declare result jsonb;
begin
  if prior_role='none' then perform set_config('role','service_role',true); end if;
  execute format('select public.%I($1)',routine) into admission using permit;
  result:=pg_temp.payment_fixture_result(admission,outcome,failure_retry_safe);
  perform set_config('role',prior_role,true);
  return result;
end;
$$;
create or replace function pg_temp.payment_execute(operation jsonb,outcome text,failure_retry_safe boolean default false) returns jsonb language sql as $$
  select pg_temp.payment_fixture_execute('admit_booking_request_provider_operation',operation,outcome,failure_retry_safe);
$$;
create or replace function pg_temp.payment_query(operation jsonb,request_id text,reference text,outcome text) returns jsonb language plpgsql as $$
declare prior_role text:=current_setting('role'); declare result jsonb;
begin
  if prior_role='none' then perform set_config('role','service_role',true); end if;
  result:=pg_temp.payment_fixture_result(public.reload_booking_request_payment_operation(operation-array['permitPurpose','claimId','claimGeneration','notAfter','idempotencyKey','cleanupAttemptId','workId','leaseGeneration','leaseToken','stateRevision','operationId','operationGeneration'],request_id,reference),outcome);
  perform set_config('role',prior_role,true);
  return result;
end;
$$;
-- END PAYMENT EVIDENCE FIXTURE

create or replace function pg_temp.preparation_money_counts() returns jsonb language sql as $$
  select jsonb_build_array(
    (select count(*) from public.booking_request_authorization_claims),
    (select count(*) from public.payment_provider_operations),
    (select count(*) from public.booking_requests),
    (select count(*) from public.cottage_booking_period_commitments),
    (select count(*) from public.booking_request_payment_history));
$$;

create or replace function pg_temp.assert_restriction_stale_preparation_replacement(
  original_attempt public.booking_request_submission_attempts,
  result jsonb,
  expected_key uuid,
  submission jsonb,
  counts_before jsonb
) returns void language plpgsql as $$
declare replacement public.booking_request_submission_attempts;
declare replay jsonb;
begin
  select * into strict replacement from public.booking_request_submission_attempts where id=(result->>'attemptId')::uuid;
  if replacement.id=original_attempt.id or replacement.payment_lifecycle_id=original_attempt.payment_lifecycle_id
    or replacement.idempotency_key<>expected_key
    or replacement.intent_payload is distinct from original_attempt.intent_payload
    or replacement.intent_fingerprint is distinct from original_attempt.intent_fingerprint
    or replacement.quote_payload is distinct from original_attempt.quote_payload
    or replacement.quote_fingerprint is distinct from original_attempt.quote_fingerprint
    or replacement.state<>'authorizing' or not replacement.intent_dedupe_active
    or replacement.payment_snapshot is not null or replacement.booking_request_id is not null
    or row(replacement.customer_suspension_revision,replacement.owner_suspension_revision,replacement.cottage_suspension_revision)
      is distinct from (select row(customer.customer_suspension_revision,owner_context.owner_suspension_revision,profiles.suspension_revision)
        from public.account_contexts customer
        join public.owner_application_cottage_profiles profiles on profiles.id=replacement.profile_id
        join public.account_contexts owner_context on owner_context.user_id=profiles.owner_user_id
        where customer.user_id=replacement.customer_user_id)
  then raise exception 'Replacement lost fresh identity, current tuple or immutable intent/quote'; end if;
  if (select to_jsonb(attempts)-array['state','intent_dedupe_active','updated_at'] from public.booking_request_submission_attempts attempts where id=original_attempt.id)
      is distinct from to_jsonb(original_attempt)-array['state','intent_dedupe_active','updated_at']
    or not exists(select 1 from public.booking_request_submission_attempts where id=original_attempt.id and state='expired' and not intent_dedupe_active and updated_at>original_attempt.updated_at)
    or not public.messaging_submission_attempt_is_resolved(original_attempt.id)
    or (select count(*) from public.booking_request_submission_attempts where customer_user_id=original_attempt.customer_user_id and intent_fingerprint=original_attempt.intent_fingerprint and intent_dedupe_active)<>1
  then raise exception 'Retirement changed immutable attempt or failed to free exactly one intent'; end if;
  replay:=public.prepare_booking_request_submission(original_attempt.customer_user_id,replacement.idempotency_key,submission);
  if replay is distinct from result then raise exception 'Replacement replay changed identity: %',replay; end if;
  replay:=public.prepare_booking_request_submission(original_attempt.customer_user_id,original_attempt.idempotency_key,submission);
  if replay is distinct from '{"status":"unavailable"}'::jsonb then raise exception 'Retired old key revived: %',replay; end if;
  if pg_temp.preparation_money_counts() is distinct from counts_before
    or (select count(*) from public.booking_request_submission_attempts where customer_user_id=original_attempt.customer_user_id)<>2
  then raise exception 'Preparation retirement created money, claim, request, hold or extra attempts'; end if;
end;
$$;

create or replace function pg_temp.booking_submission_graph() returns jsonb language sql as $$
  select jsonb_build_object(
  'booking_request_submission_attempts',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_submission_attempts rows),
  'booking_request_authorization_claims',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_authorization_claims rows),
  'booking_request_authorization_reconciliation_outbox',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_authorization_reconciliation_outbox rows),
  'booking_request_authorization_claim_occupancies',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_authorization_claim_occupancies rows),
  'cottage_booking_period_occupancies',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.cottage_booking_period_occupancies rows),
  'payment_provider_operations',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.payment_provider_operations rows),
  'cottage_booking_period_commitments',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.cottage_booking_period_commitments rows),
  'booking_request_payment_history',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_payment_history rows),
  'booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_requests rows),
  'messaging_conversation_booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.messaging_conversation_booking_requests rows)
);
$$;

select plan(449);

set local role anon;
select throws_ok(
  $$select public.retire_unusable_prepared_booking_request_submission('11111111-1111-4111-8111-111111113709'::uuid)$$,
  '42501', 'permission denied for function retire_unusable_prepared_booking_request_submission',
  'anon cannot invoke internal prepared-attempt retirement'
);
reset role;
set local role authenticated;
select throws_ok(
  $$select public.retire_unusable_prepared_booking_request_submission('11111111-1111-4111-8111-111111113709'::uuid)$$,
  '42501', 'permission denied for function retire_unusable_prepared_booking_request_submission',
  'authenticated cannot invoke internal prepared-attempt retirement'
);
reset role;
set local role service_role;
select throws_ok(
  $$select public.retire_unusable_prepared_booking_request_submission('11111111-1111-4111-8111-111111113709'::uuid)$$,
  '42501', 'permission denied for function retire_unusable_prepared_booking_request_submission',
  'service_role cannot invoke internal prepared-attempt retirement'
);
reset role;

select has_function(
  'public', 'prepare_booking_request_submission', array['uuid', 'uuid', 'jsonb'],
  'Booking Request submission claims one durable attempt before payment'
);
select ok(
  has_function_privilege('service_role',
    'public.claim_booking_request_action(uuid,uuid,text,text,text)', 'execute')
  and not has_function_privilege('anon',
    'public.claim_booking_request_action(uuid,uuid,text,text,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.claim_booking_request_action(uuid,uuid,text,text,text)', 'execute'),
  'only the service role can claim an actor-authorized lifecycle action'
);
select ok(
  has_function_privilege('service_role',
    'public.claim_booking_request_expiry(uuid)', 'execute')
  and not has_function_privilege('anon',
    'public.claim_booking_request_expiry(uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'public.claim_booking_request_expiry(uuid)', 'execute'),
  'only the service role can claim an internal Booking Request expiry'
);
select ok(
  has_function_privilege('service_role',
    'public.claim_due_booking_request_releases(integer)', 'execute')
  and not has_function_privilege('anon',
    'public.claim_due_booking_request_releases(integer)', 'execute')
  and not has_function_privilege('authenticated',
    'public.claim_due_booking_request_releases(integer)', 'execute'),
  'only the service role can run the bounded lifecycle drain'
);
select ok(
  has_function_privilege('service_role',
    'public.save_booking_request_release_snapshot(uuid,bigint,uuid,jsonb,jsonb)', 'execute')
  and not has_function_privilege('anon',
    'public.save_booking_request_release_snapshot(uuid,bigint,uuid,jsonb,jsonb)', 'execute')
  and not has_function_privilege('authenticated',
    'public.save_booking_request_release_snapshot(uuid,bigint,uuid,jsonb,jsonb)', 'execute'),
  'only the service role can save lifecycle payment-release evidence'
);
select ok(
  has_function_privilege('service_role',
    'public.finalize_booking_request_release(uuid,bigint,uuid)', 'execute')
  and not has_function_privilege('anon',
    'public.finalize_booking_request_release(uuid,bigint,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'public.finalize_booking_request_release(uuid,bigint,uuid)', 'execute'),
  'only the service role can finalize a Booking Request release'
);
select ok(
  not has_function_privilege('anon',
    'public.booking_request_acceptance_evidence(public.cottage_profile_source_language,boolean)', 'execute')
  and not has_function_privilege('authenticated',
    'public.booking_request_acceptance_evidence(public.cottage_profile_source_language,boolean)', 'execute')
  and not has_function_privilege('service_role',
    'public.booking_request_acceptance_evidence(public.cottage_profile_source_language,boolean)', 'execute'),
  'no API role can call the acceptance evidence builder directly'
);
select has_column(
  'public', 'booking_request_submission_attempts', 'intent_dedupe_active',
  'only active Booking Request intents participate in submission deduplication'
);
select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.booking_request_release_operations'::regclass),
  'the release operation ledger has row-level security enabled'
);
select ok(
  not has_table_privilege(
    'anon', 'public.booking_request_release_operations', 'select'
  )
  and not has_table_privilege(
    'anon', 'public.booking_request_release_operations', 'insert'
  )
  and not has_table_privilege(
    'anon', 'public.booking_request_release_operations', 'update'
  )
  and not has_table_privilege(
    'anon', 'public.booking_request_release_operations', 'delete'
  )
  and not has_table_privilege(
    'authenticated', 'public.booking_request_release_operations', 'select'
  )
  and not has_table_privilege(
    'authenticated', 'public.booking_request_release_operations', 'insert'
  )
  and not has_table_privilege(
    'authenticated', 'public.booking_request_release_operations', 'update'
  )
  and not has_table_privilege(
    'authenticated', 'public.booking_request_release_operations', 'delete'
  )
  and not has_table_privilege('service_role',
    'public.booking_request_release_operations', 'select')
  and not has_table_privilege('service_role',
    'public.booking_request_release_operations', 'insert'),
  'no application role has direct release-ledger access'
);
select is(
  (select count(*)::integer from pg_constraint
    where conrelid = 'public.booking_request_release_operations'::regclass
      and contype = 'f'
      and array_length(conkey, 1) = 2),
  2,
  'the release ledger is composite-linked to its work, attempt, and lifecycle'
);
select has_function(
  'public', 'admit_booking_request_provider_operation',
  array['jsonb'],
  'the fictional provider executes through a durable PostgreSQL ledger'
);
select has_function(
  'public', 'reload_booking_request_payment_operation',
  array['jsonb', 'text', 'text'],
  'the fictional provider reconciles through the same durable ledger'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.admit_booking_request_provider_operation(jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.admit_booking_request_provider_operation(jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.admit_booking_request_provider_operation(jsonb)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.expire_booking_request_authorization_claims()',
    'execute'
  )
  and not has_function_privilege(
    'anon', 'public.expire_booking_request_authorization_claims()', 'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.expire_booking_request_authorization_claims()',
    'execute'
  ),
  'only the service role can execute a fictional provider operation'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.dequeue_booking_request_authorization_reconciliation()',
    'execute'
  )
  and not has_function_privilege(
    'anon', 'public.dequeue_booking_request_authorization_reconciliation()', 'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.dequeue_booking_request_authorization_reconciliation()',
    'execute'
  ),
  'only the least-privilege backend worker role can dequeue provider work'
);
select has_function(
  'public', 'booking_request_policy_at', array['timestamptz', 'timestamptz'],
  'Booking Request timing policy has one deterministic database seam'
);
select has_function(
  'public', 'finalize_booking_request_submission', array['uuid', 'jsonb'],
  'Booking Request finalization is one PostgreSQL transaction'
);
select has_function(
  'public', 'dequeue_booking_request_authorization_reconciliation', array[]::text[],
  'an independent worker can discover reconciliation work through a deployed interface'
);
select has_function(
  'public', 'complete_booking_request_authorization_reconciliation',
  array['uuid', 'integer', 'bigint', 'uuid', 'jsonb', 'jsonb'],
  'reconciliation completion is lease, generation, and revision compare-and-set'
);
select has_function(
  'public', 'classify_booking_request_authorization_claim_persistence', array['uuid'],
  'a lost initial claim response has an authoritative persistence classifier'
);
select results_eq(
  $$select state::text,
      public.booking_request_claim_state_is_active(state),
      public.booking_request_claim_state_is_reconcilable(state),
      public.booking_request_claim_state_is_terminal(state),
      public.booking_request_claim_state_allows_authorization(state)
    from unnest(enum_range(null::public.booking_request_authorization_claim_state)) state$$,
  $$values
      ('starting'::text, true, true, false, true),
      ('not_started'::text, false, false, true, false),
      ('failed'::text, false, false, true, false),
      ('reconciliation_required'::text, true, true, false, true),
      ('authorized'::text, true, true, false, false),
      ('releasing'::text, true, true, false, false),
      ('released'::text, false, false, true, false),
      ('expired'::text, false, false, true, false),
      ('converted'::text, false, false, true, false)$$,
  'every claim state has one exhaustive active, reconcilable, terminal, and authorization classification'
);
select results_eq(
  $$select public.booking_request_claim_state_after_payment(
      current_state, next_attempt_state, has_request, release_status
    )::text
    from (values
      ('starting'::public.booking_request_authorization_claim_state, 'authorized', true, null::text),
      ('starting', 'authorization_failed', false, null),
      ('starting', 'authorization_failed', true, null),
      ('authorized', 'releasing', true, 'pending'),
      ('releasing', 'releasing', true, 'failed'),
      ('releasing', 'released', true, 'succeeded'),
      ('expired', 'authorized', true, null),
      ('converted', 'reconciliation_required', true, null)
    ) cases(current_state, next_attempt_state, has_request, release_status)$$,
  $$values ('authorized'::text), ('not_started'), ('failed'), ('releasing'),
      ('reconciliation_required'), ('released'), ('expired'), ('converted')$$,
  'claim payment transitions are exhaustive and terminal states cannot regress'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_class relations
    where relations.oid in (
      'public.booking_request_submission_attempts'::regclass,
      'public.booking_request_provider_operation_identities'::regclass,
      'public.booking_request_authorization_claims'::regclass,
      'public.booking_request_authorization_claim_items'::regclass,
      'public.booking_request_authorization_claim_occupancies'::regclass,
      'public.booking_request_authorization_reconciliation_outbox'::regclass,
      'public.payment_provider_operations'::regclass,
      'public.booking_snapshots'::regclass,
      'public.booking_requests'::regclass,
      'public.owner_request_notifications'::regclass,
      'public.booking_request_release_work'::regclass,
      'public.booking_request_release_operations'::regclass,
      'public.booking_request_status_notifications'::regclass
    ) and relations.relrowsecurity
  ),
  13::bigint,
  'all private Booking Request tables have Row Level Security enabled'
);
select ok(
  not exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
    cross join (values
      ('public.booking_request_submission_attempts'),
      ('public.booking_request_provider_operation_identities'),
      ('public.booking_request_authorization_claims'),
      ('public.booking_request_authorization_claim_items'),
      ('public.booking_request_authorization_claim_occupancies'),
      ('public.booking_request_authorization_reconciliation_outbox'),
      ('public.payment_provider_operations'),
      ('public.booking_snapshots'),
      ('public.booking_requests'),
      ('public.owner_request_notifications'),
      ('public.booking_request_release_work'),
      ('public.booking_request_release_operations'),
      ('public.booking_request_status_notifications')
    ) relations(table_name)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) privileges(privilege_name)
    where has_table_privilege(roles.role_name, relations.table_name, privileges.privilege_name)
  ),
  'application roles cannot bypass the Booking Request interfaces'
);

insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values
  (
    '00000000-0000-0000-0000-000000003201', 'authenticated', 'authenticated',
    '+9647500003201', now()
  ),
  (
    '00000000-0000-0000-0000-000000003202', 'authenticated', 'authenticated',
    '+9647500003202', now()
  ),
  (
    '00000000-0000-0000-0000-000000003203', 'authenticated', 'authenticated',
    '+9647500003203', now()
  ),
  (
    '00000000-0000-0000-0000-000000003204', 'authenticated', 'authenticated',
    '+9647500003204', now()
  ),
  (
    '00000000-0000-0000-0000-000000003205', 'authenticated', 'authenticated',
    '+9647500003205', null
  );
insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('00000000-0000-0000-0000-000000003201', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000003202', 'cottage_owner', 'suspended'),
  ('00000000-0000-0000-0000-000000003203', 'customer', null),
  ('00000000-0000-0000-0000-000000003204', 'cottage_owner', 'approved'),
  ('00000000-0000-0000-0000-000000003205', 'customer', null);

insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, amenities, source_language, description,
  house_rules, status
) values (
  '30000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003201',
  'Submission Cottage', 'Baghdad', 'Karrada', 'Private address',
  8, 3, 2, array['pool'], 'en', 'Description', 'No smoking', 'draft'
);
insert into public.cottage_shift_schedule_revisions (
  id, profile_id, revision, full_day_bundle_id
) values (
  '60000000-0000-4000-8000-000000003201',
  '30000000-0000-4000-8000-000000003201', 1,
  '61000000-0000-4000-8000-000000003201'
);
select set_config(
  'rentcottage.shift_schedule_write_revision_id',
  '60000000-0000-4000-8000-000000003201', true
);
insert into public.cottage_shifts (
  id, schedule_revision_id, position, name, start_time, end_time
) values
  (
    '62000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201', 1, 'Morning', '08:00', '12:00'
  ),
  (
    '62000000-0000-4000-8000-000000003202',
    '60000000-0000-4000-8000-000000003201', 2, 'Evening', '17:00', '23:00'
  );
select set_config('rentcottage.shift_schedule_write_revision_id', '', true);
update public.owner_application_cottage_profiles
set current_shift_schedule_id = '60000000-0000-4000-8000-000000003201'
where id = '30000000-0000-4000-8000-000000003201';

insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules, revision
) values (
  '63000000-0000-4000-8000-000000003201',
  '30000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003201',
  'en', 'Description', 'No smoking', 1
);
insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
) values (
  '64000000-0000-4000-8000-000000003201',
  '30000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003201',
  '63000000-0000-4000-8000-000000003201',
  'Submission Cottage', 'Baghdad', 'Karrada', 8, 3, 2,
  array['pool'], 1, 'approved', now()
);
insert into public.cottage_profile_localized_revisions (
  id, review_cycle_id, locale, revision, origin, description, house_rules
) values (
  '65000000-0000-4000-8000-000000003201',
  '64000000-0000-4000-8000-000000003201',
  'en', 1, 'owner_source', 'Description', 'No smoking'
);
insert into public.cottage_profile_publication_decisions (
  review_cycle_id, administrator_user_id, approved, reason
) values (
  '64000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003203', true, 'Approved fixture'
);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
) values (
  '66000000-0000-4000-8000-000000003201',
  '30000000-0000-4000-8000-000000003201',
  '64000000-0000-4000-8000-000000003201',
  1, 'Submission Cottage', 'Baghdad', 'Karrada', 8, 3, 2, array['pool']
);
insert into public.cottage_publication_localizations (
  publication_id, locale, localized_revision_id, description, house_rules
) values (
  '66000000-0000-4000-8000-000000003201', 'en',
  '65000000-0000-4000-8000-000000003201', 'Description', 'No smoking'
);
update public.owner_application_cottage_profiles
set current_publication_id = '66000000-0000-4000-8000-000000003201'
where id = '30000000-0000-4000-8000-000000003201';

insert into public.cottage_inventory_standard_prices (
  schedule_revision_id, unit_kind, unit_id, price_iqd
) values
  (
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003201', 100000
  ),
  (
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003202', 110000
  ),
  (
    '60000000-0000-4000-8000-000000003201', 'full_day_bundle',
    '61000000-0000-4000-8000-000000003201', 190000
  );
insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select schedule_revision_id, unit_kind, unit_id, service_day, 'open'
from public.cottage_inventory_standard_prices
cross join (values ('2099-08-21'::date), ('2099-08-22'::date)) days(service_day)
where schedule_revision_id = '60000000-0000-4000-8000-000000003201';

-- Stands in for the search limit being lowered after an attempt was admitted.
create function pg_temp.lower_search_admission_limit() returns void language plpgsql as $$
begin
  execute $admission$
    create or replace function public.validate_public_cottage_discovery_admission(requested_search jsonb)
      returns void language plpgsql stable set search_path to ''
    as $body$
    begin
      raise exception 'Public Cottage search input is invalid' using errcode = '22023';
    end;
    $body$
  $admission$;
end;
$$;

create temporary table submission_fixture as
select
  '{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":2}]}'::jsonb as search,
  public.get_public_booking_quote_with_fingerprint(
    'en', 'cottage-30000000000040008000000000003201',
    '{"from":"2099-08-21","to":"2099-08-21","guests":4,"selections":[{"serviceDay":"2099-08-21","kind":"shift","position":2}]}'::jsonb
  ) as quote;
grant select on submission_fixture to service_role;

create temporary table valid_submission as
select jsonb_build_object(
  'locale', 'en',
  'publicSlug', 'cottage-30000000000040008000000000003201',
  'discoveryQuery', search,
  'quoteFingerprint', quote ->> 'quoteFingerprint',
  'contentVersion', 1,
  'termsVersion', 'fictional-local-test-2026-08-22-v1',
  'bookingPriceIqd', 110000,
  'serviceFeeIqd', 5000,
  'customerTotalIqd', 115000,
  'firstStartsAt', '2099-08-21T17:00:00+03:00',
  'intent', jsonb_build_object(
    'customerName', 'Ava Hassan',
    'partySize', 4,
    'bookingNote', 'Please prepare the garden seating.',
    'acceptedHouseRules', true,
    'acceptedCancellationPolicy', true,
    'acceptedMarketplaceTerms', true,
    'acceptedInside48HourNoRefund', false,
    'cancellationPolicyVersion', 'rentcottage-mvp-2026-08-04',
    'acceptanceEvidence', jsonb_build_object(
      'locale', 'en',
      'cancellationPolicy', 'Cancel at least 48 hours before the first shift for a full refund. Cancellation inside 48 hours and no-shows receive no refund.',
      'cancellationAcceptance', 'I accept the cancellation policy.',
      'marketplaceTermsAcceptance', 'I accept the marketplace booking terms.',
      'inside48Warning', null,
      'inside48Acceptance', null
    )
  )
) as submission
from submission_fixture;
grant select on valid_submission to service_role;

savepoint search_limit_edges;
insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select schedule_revision_id, unit_kind, unit_id, service_day::date, 'open'
from public.cottage_inventory_standard_prices
cross join generate_series('2099-08-23'::date, '2099-09-21'::date, interval '1 day') days(service_day)
where schedule_revision_id = '60000000-0000-4000-8000-000000003201';
create temporary table long_search as
select jsonb_build_object('from', '2099-08-21', 'to', '2099-09-21', 'guests', 4, 'selections', (
  select jsonb_agg(jsonb_build_object(
    'serviceDay', to_char(service_day, 'YYYY-MM-DD'), 'kind', 'shift', 'position', 2
  ))
  from generate_series('2099-08-21'::date, '2099-09-21'::date, interval '1 day') service_day
)) as search;
grant select on long_search to service_role;
select is(
  public.resolve_booking_quote_with_fingerprint(
    'en', 'cottage-30000000000040008000000000003201', (select search from long_search), false
  ) ->> 'bookingPriceIqd',
  '3520000',
  'a stored search of 32 Service Days is still quoted in full'
);
set local role service_role;
select throws_ok(
  $$select public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113231',
    jsonb_set((select submission from valid_submission),
      '{discoveryQuery}', (select search from long_search))
  )$$,
  '22023', 'Public Cottage search input is invalid',
  'Booking Request admission refuses a search of 32 Service Days'
);
reset role;
rollback to savepoint search_limit_edges;

select matches(
  (select quote ->> 'quoteFingerprint' from submission_fixture),
  '^[0-9a-f]{64}$',
  'the displayed Booking Quote has a canonical fingerprint'
);
select ok(
  not public.booking_request_content_is_safe('+964 750 123 4567')
  and not public.booking_request_content_is_safe('0750[123][4567]')
  and not public.booking_request_content_is_safe('٠٧٥٠ ١٢٣ ٤٥٦٧')
  and not public.booking_request_content_is_safe('٠٧٥٠[١٢٣][٤٥٦٧]')
  and not public.booking_request_content_is_safe('۰۷۵۰-۱۲۳-۴۵۶۷')
  and not public.booking_request_content_is_safe('۰۷۵۰—۱۲۳—۴۵۶۷')
  and not public.booking_request_content_is_safe('٠٧٥٠–١٢٣–٤٥٦٧')
  and not public.booking_request_content_is_safe('0750‑123‑4567')
  and not public.booking_request_content_is_safe('۰۷۵۰[۱۲۳][۴۵۶۷]')
  and not public.booking_request_content_is_safe('ava@example.com')
  and not public.booking_request_content_is_safe('name @ example . com')
  and not public.booking_request_content_is_safe('name @ example . uk')
  and not public.booking_request_content_is_safe('name at example dot uk')
  and not public.booking_request_content_is_safe('z a i n at g m a i l dot c o m')
  and not public.booking_request_content_is_safe('example.dev')
  and not public.booking_request_content_is_safe('0a7a5a0a1a2a3a4a5a6')
  and not public.booking_request_content_is_safe('0a7b5c0d1e2f3g4h5i6')
  and not public.booking_request_content_is_safe('0a 7b 5c 0d 1e 2f 3g 4h 5i 6')
  and not public.booking_request_content_is_safe('٠a ٧b ٥c ٠d ١e ٢f ٣g ٤h ٥i ٦')
  and not public.booking_request_content_is_safe('۰a ۷b ۵c ۰d ۱e ۲f ۳g ۴h ۵i ۶')
  and not public.booking_request_content_is_safe('०७५०१२३४५६७')
  and not public.booking_request_content_is_safe('https://example.com/ava')
  and not public.booking_request_content_is_safe('Telegram @ava_hassan')
  and not public.booking_request_content_is_safe('contact:@ava_hassan'),
  'the database blocks common contact formats across supported digit scripts'
);
select ok(
  not public.booking_request_content_is_safe('0750​123​4567')
  and not public.booking_request_content_is_safe('۰۷۵۰​۱۲۳​۴۵۶۷'),
  'the database neutralizes zero-width formatting characters in readable phone numbers'
);
select ok(
  not public.booking_request_content_is_safe('zero seven five zero one two three four five six seven')
  and not public.booking_request_content_is_safe('ava at example dot com')
  and not public.booking_request_content_is_safe('صفر سبعة خمسة صفر واحد اثنان ثلاثة أربعة خمسة ستة سبعة')
  and not public.booking_request_content_is_safe('ava ات example نقطة com')
  and not public.booking_request_content_is_safe('سفر حەوت پێنج سفر یەک دوو سێ چوار پێنج شەش حەوت')
  and not public.booking_request_content_is_safe('ava ئەت example دۆت com')
  and public.booking_request_content_is_safe('One guest will arrive at the garden after seven.')
  and public.booking_request_content_is_safe('یەک میوان دوای حەوت دەگات.')
  and public.booking_request_content_is_safe('سنصل بعد سبع ساعات مع ضيف واحد.'),
  'the database blocks only structured word-obfuscated contact across launch languages'
);
select is(
  public.booking_request_policy_at(
    '2099-08-22T00:00:00Z', '2099-08-21T18:00:00Z'
  ) ->> 'insideCutoff',
  'false', 'exactly six hours remains requestable'
);
select is(
  public.booking_request_policy_at(
    '2099-08-22T00:00:00Z', '2099-08-21T18:00:00.001Z'
  ) ->> 'insideCutoff',
  'true', 'just inside six hours is after the Booking Request Cut-Off'
);
select is(
  public.booking_request_policy_at(
    '2099-08-22T00:00:00Z', '2099-08-20T00:00:00Z'
  ) ->> 'requiresInside48HourNoRefundAcceptance',
  'false', 'exactly 48 hours does not require the inside-48-hour acceptance'
);
select is(
  public.booking_request_policy_at(
    '2099-08-22T00:00:00Z', '2099-08-20T00:00:00.001Z'
  ) ->> 'requiresInside48HourNoRefundAcceptance',
  'true', 'just inside 48 hours requires the no-refund acceptance'
);

savepoint suspension_fences_prepare;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select lives_ok($test$
do $body$
declare prepared jsonb;
declare result jsonb;
declare submission jsonb := (select valid.submission from valid_submission valid);
declare before_operations bigint := (select count(*) from public.payment_provider_operations);
declare before_requests bigint := (select count(*) from public.booking_requests);
declare before_holds bigint := (select count(*) from public.cottage_booking_period_commitments);
begin
  prepared := public.prepare_booking_request_submission('00000000-0000-0000-0000-000000003202','11111111-1111-4111-8111-111111113790',submission);
  if prepared->>'status' is distinct from 'ready' then raise exception 'Fresh suspension fixture did not prepare: %',prepared; end if;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result := public.set_marketplace_suspension('customer','00000000-0000-0000-0000-000000003202','suspend',0,'Fictional admission restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Customer suspension failed: %',result; end if;
  result := public.prepare_booking_request_submission('00000000-0000-0000-0000-000000003202','11111111-1111-4111-8111-111111113791',jsonb_set(submission,'{intent,customerName}','"Suspended Customer"'));
  if result->>'status' is distinct from 'customer-suspended' then raise exception 'Fresh customer suspension admitted: %',result; end if;
  result := public.prepare_booking_request_submission('00000000-0000-0000-0000-000000003202','11111111-1111-4111-8111-111111113790',submission);
  if result->>'status' is distinct from 'customer-suspended' then raise exception 'Null snapshot replay bypassed suspension: %',result; end if;
  result := public.set_marketplace_suspension('customer','00000000-0000-0000-0000-000000003202','reactivate',1,'Prospective customer restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Customer restoration failed: %',result; end if;
  result := public.prepare_booking_request_submission('00000000-0000-0000-0000-000000003202','11111111-1111-4111-8111-111111113790',submission);
  if result->>'status' is distinct from 'quote-stale' then raise exception 'Reactivation revived stale preparation: %',result; end if;
  if (select count(*) from public.payment_provider_operations)<>before_operations
    or (select count(*) from public.booking_requests)<>before_requests
    or (select count(*) from public.cottage_booking_period_commitments)<>before_holds
  then raise exception 'Rejected preparation created provider operation, request or hold'; end if;
end;
$body$;
$test$,'suspension_fences_prepared_and_issued_authorizations: fresh and null-snapshot replay');
rollback to savepoint suspension_fences_prepare;

create temp table self_booking_before as select
  (select count(*) from public.booking_request_submission_attempts) attempts,
  (select count(*) from public.cottage_booking_period_commitments) holds,
  (select count(*) from public.cottage_booking_period_occupancies) occupancies;
set local role service_role;
select is(public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003201',
  '12141214-1214-4214-8214-121412141214',
  (select submission from valid_submission)
)->>'status', 'self-booking-not-allowed', 'owners cannot start payment work for their own cottage');
reset role;
select throws_ok($$select public.create_pending_booking_period_hold_without_authorization_claim(
  '00000000-0000-0000-0000-000000003201',
  '30000000-0000-4000-8000-000000003201',
  'SELF-BOOKING-214',
  (select submission->'discoveryQuery' from valid_submission)
)$$, 'RC422', null, 'self-booking is denied at the hold boundary');
reset role;
select ok((select count(*) from public.booking_request_submission_attempts)=(select attempts from self_booking_before), 'self-booking creates no attempt or payment work');
select ok((select count(*) from public.cottage_booking_period_commitments)=(select holds from self_booking_before) and (select count(*) from public.cottage_booking_period_occupancies)=(select occupancies from self_booking_before), 'self-booking creates no hold or occupancy');

set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113299',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"Email ava@example.com"'::jsonb)
  ) ->> 'status',
  'invalid',
  'contact protection cannot be bypassed through the database interface'
);
select ok(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113293',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"name @ example . com"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113292',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"0a7a5a0a1a2a3a4a5a6"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113286',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"z a i n at g m a i l dot c o m"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113285',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"०७५०१२३४५६७"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113289',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"0a 7b 5c 0d 1e 2f 3g 4h 5i 6"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113288',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"٠a ٧b ٥c ٠d ١e ٢f ٣g ٤h ٥i ٦"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113287',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"۰a ۷b ۵c ۰d ۱e ۲f ۳g ۴h ۵i ۶"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113291',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"name at example dot uk"'::jsonb)
  ) ->> 'status' = 'invalid'
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113290',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"0a7b5c0d1e2f3g4h5i6"'::jsonb)
  ) ->> 'status' = 'invalid',
  'TLD-independent email and mixed-letter phone obfuscation cannot reach the owner projection'
);
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113294',
    jsonb_set((select submission from valid_submission),
      '{intent,bookingNote}', '"0750​123​4567"'::jsonb)
  ) ->> 'status',
  'invalid',
  'zero-width contact obfuscation is rejected before owner projection'
);
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003205',
    '11111111-1111-4111-8111-111111113298',
    (select submission from valid_submission)
  ) ->> 'status',
  'access-required',
  'an authenticated but phone-unverified Customer is denied'
);
reset role;

set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113295',
    (select jsonb_set(
      submission,
      '{intent}',
      (submission -> 'intent') - 'acceptanceEvidence'
    ) from valid_submission)
  ) ->> 'status',
  'invalid',
  'missing acceptance evidence is rejected before Payment Authorization'
);
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113284',
    (select jsonb_set(
      submission,
      '{intent,acceptanceEvidence,marketplaceTermsAcceptance}',
      '"I accept the marketplace booking terms. (fictional-local-test-2026-08-22-v1)"'::jsonb
    ) from valid_submission)
  ) ->> 'status',
  'invalid',
  'an acceptance sentence that differs from the database wording is refused before Payment Authorization'
);
reset role;

set local role service_role;
create temporary table submission_conversation as
select public.create_messaging_conversation(
  '00000000-0000-0000-0000-000000003202',
  '30000000-0000-4000-8000-000000003201',
  '36000000-0000-4000-8000-000000003201'
) result;
reset role;

insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, amenities, source_language, description,
  house_rules, status
) values (
  '30000000-0000-4000-8000-000000003204',
  '00000000-0000-0000-0000-000000003204',
  'Other Submission Cottage', 'Baghdad', 'Mansour', 'Private address',
  6, 2, 1, array['parking'], 'en', 'Description', 'No smoking', 'draft'
);
insert into public.cottage_marketplace_listings (profile_id, public_slug, state)
values (
  '30000000-0000-4000-8000-000000003204',
  'cottage-30000000000040008000000000003204', 'published'
);
set local role service_role;
create temporary table other_submission_conversation as
select public.create_messaging_conversation(
  '00000000-0000-0000-0000-000000003202',
  '30000000-0000-4000-8000-000000003204',
  '36000000-0000-4000-8000-000000003204'
) result;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003203',
    '11111111-1111-4111-8111-111111113203',
    (select jsonb_set(
      submission || jsonb_build_object(
        'conversationId',
        (select result->>'conversationId' from submission_conversation)
      ),
      '{intent,conversationId}',
      to_jsonb((select result->>'conversationId' from submission_conversation))
    ) from valid_submission)
  ) ->> 'status',
  'invalid',
  'a Customer cannot bind another Customer conversation to their submission'
);
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113204',
    (select jsonb_set(
      submission || jsonb_build_object(
        'conversationId',
        (select result->>'conversationId' from other_submission_conversation)
      ),
      '{intent,conversationId}',
      to_jsonb((select result->>'conversationId' from other_submission_conversation))
    ) from valid_submission)
  ) ->> 'status',
  'invalid',
  'a conversation for another cottage cannot bind to the displayed quote'
);
reset role;
select is(
  (select count(*) from public.booking_request_submission_attempts), 0::bigint,
  'rejected conversation bindings create no payment attempt'
);
create temporary table journey_submission as
select jsonb_set(
  submission || jsonb_build_object(
    'conversationId',
    (select result->>'conversationId' from submission_conversation)
  ),
  '{intent,conversationId}',
  to_jsonb((select result->>'conversationId' from submission_conversation))
) submission
from valid_submission;
grant select on submission_conversation to service_role,authenticated;
grant select on journey_submission to service_role;

set local role service_role;
create temporary table prepared_submission as
select public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202',
  '11111111-1111-4111-8111-111111113201',
  (select submission from journey_submission)
) as result;
reset role;

select is(
  (select result ->> 'status' from prepared_submission), 'ready',
  'a verified Customer claims one submission attempt before authorization'
);

set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    (select submission from journey_submission)
  ) ->> 'status',
  'ready',
  'a pre-provider crash resumes the same durable Payment Lifecycle'
);
reset role;


savepoint suspension_revision_hostile_input;
select lives_ok($test$
do $body$
declare target_attempt uuid := (select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
declare original_attempt jsonb;
declare revision_column text;
declare invalid_value text;
declare actual_state text;
declare actual_constraint text;
declare expected_state text;
begin
  select to_jsonb(attempts) into strict original_attempt
  from public.booking_request_submission_attempts attempts where attempts.id=target_attempt;
  foreach revision_column in array array['customer_suspension_revision','owner_suspension_revision','cottage_suspension_revision'] loop
    foreach invalid_value in array array[null::text,'-1','not-a-revision'] loop
      expected_state:=case when invalid_value is null then '23502' when invalid_value='-1' then '23514' else '22P02' end;
      actual_state:=null;
      actual_constraint:=null;
      begin
        execute format('update public.booking_request_submission_attempts set %I=%L::bigint where id=%L::uuid',revision_column,invalid_value,target_attempt);
      exception when not_null_violation or check_violation or invalid_text_representation then
        get stacked diagnostics actual_state=returned_sqlstate,actual_constraint=constraint_name;
      end;
      if actual_state is distinct from expected_state
        or (invalid_value='-1' and actual_constraint is distinct from 'booking_request_submission_suspension_revisions_check')
      then raise exception 'Persisted % accepted or misclassified invalid revision %: % / %',revision_column,invalid_value,actual_state,actual_constraint; end if;
    end loop;
  end loop;
  if (select to_jsonb(attempts) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt) is distinct from original_attempt
    or exists(select 1 from public.booking_request_authorization_claims)
    or exists(select 1 from public.payment_provider_operations)
    or exists(select 1 from public.booking_requests)
    or exists(select 1 from public.cottage_booking_period_commitments)
  then raise exception 'Rejected persisted revisions changed attempt or created authorization/request/hold'; end if;
end;
$body$;
$test$,'suspension_fences_prepared_and_issued_authorizations: persisted revisions reject null negative and malformed values');
rollback to savepoint suspension_revision_hostile_input;

create temporary table usable_replacement_quote as
select public.get_public_booking_quote_with_fingerprint(
  'en', 'cottage-30000000000040008000000000003201',
  '{"from":"2099-08-22","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-22","kind":"shift","position":2}]}'::jsonb
) as quote;
select is((select quote->>'status' from usable_replacement_quote), 'quoted',
  'a different-day replacement has a real current quote while preparation remains usable');
create temporary table usable_replacement_submission as
select submission || jsonb_build_object(
  'discoveryQuery', '{"from":"2099-08-22","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-22","kind":"shift","position":2}]}'::jsonb,
  'quoteFingerprint', quote->>'quoteFingerprint',
  'contentVersion', quote->'contentVersion', 'termsVersion', quote->'termsVersion',
  'bookingPriceIqd', quote->'bookingPriceIqd', 'serviceFeeIqd', quote->'serviceFeeIqd',
  'customerTotalIqd', quote->'customerTotalIqd', 'firstStartsAt', quote#>>'{items,0,startsAt}'
) as submission
from journey_submission cross join usable_replacement_quote;
grant select on usable_replacement_submission to service_role;

savepoint stale_price_preparation;
create temporary table stale_preparation_before as
select to_jsonb(attempts) as record
from public.booking_request_submission_attempts attempts
where attempts.id = (select (result->>'attemptId')::uuid from prepared_submission);
set local role service_role;
select is(public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202', '11111111-1111-4111-8111-111111113708',
  (select submission from usable_replacement_submission)
)->>'status', 'invalid', 'a usable preparation refuses a fresh different-intent replacement in its conversation');
reset role;
select results_eq(
  $$select to_jsonb(attempts) = baseline.record,
      not public.messaging_submission_attempt_is_resolved(attempts.id)
    from public.booking_request_submission_attempts attempts cross join stale_preparation_before baseline
    where attempts.id = (select (result->>'attemptId')::uuid from prepared_submission)$$,
  $$values (true,true)$$,
  'a refused replacement retains the usable preparation exactly unchanged and unresolved'
);
select results_eq(
  $$select
      (select count(*)::integer from public.booking_request_submission_attempts
        where customer_user_id = '00000000-0000-0000-0000-000000003202'),
      (select count(*)::integer from public.booking_request_authorization_claims
        where customer_user_id = '00000000-0000-0000-0000-000000003202'),
      (select count(*)::integer from public.payment_provider_operations operations
        where operations.payment_lifecycle_id in (
          select attempts.payment_lifecycle_id from public.booking_request_submission_attempts attempts
          where attempts.customer_user_id = '00000000-0000-0000-0000-000000003202'
        )),
      (select count(*)::integer from public.booking_requests
        where customer_user_id = '00000000-0000-0000-0000-000000003202'),
      (select count(*)::integer from public.cottage_booking_period_commitments
        where customer_user_id = '00000000-0000-0000-0000-000000003202')$$,
  $$values (1,0,0,0,0)$$,
  'usable preparation refusal retains one attempt and creates no claim, provider call, request or hold'
);
set local role service_role;
select is(public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202',
  '11111111-1111-4111-8111-111111113201',
  jsonb_set((select submission from journey_submission), '{bookingPriceIqd}', '120000'::jsonb)
)->>'status', 'invalid', 'forged submitted quote fields cannot retire a valid preparation');
reset role;
select results_eq(
  $$select to_jsonb(attempts) = baseline.record
    from public.booking_request_submission_attempts attempts cross join stale_preparation_before baseline
    where attempts.id = (select (result->>'attemptId')::uuid from prepared_submission)$$,
  $$values (true)$$,
  'a forged quote leaves the valid prepared attempt unchanged'
);
set local role service_role;
select is(public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202', '11111111-1111-4111-8111-111111113709',
  jsonb_set((select submission from journey_submission), '{conversationId}', '"not-a-uuid"'::jsonb)
)->>'status', 'invalid', 'malformed conversation binding cannot retire another prepared attempt');
reset role;
select results_eq(
  $$select to_jsonb(attempts) = baseline.record
    from public.booking_request_submission_attempts attempts cross join stale_preparation_before baseline
    where attempts.id = (select (result->>'attemptId')::uuid from prepared_submission)$$,
  $$values (true)$$,
  'malformed conversation binding retains the prepared attempt unchanged'
);
update public.cottage_inventory_standard_prices
set price_iqd = 120000
where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
  and unit_id = '62000000-0000-4000-8000-000000003202';
set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    (select submission from journey_submission)
  ) ->> 'status',
  'quote-stale',
  'a pre-provider crash cannot resume against a stale price quote'
);
reset role;
create temporary table stale_price_replacement as
select submission || jsonb_build_object(
  'discoveryQuery', submission->'discoveryQuery',
  'quoteFingerprint', quote->>'quoteFingerprint',
  'contentVersion', quote->'contentVersion', 'termsVersion', quote->'termsVersion',
  'bookingPriceIqd', quote->'bookingPriceIqd', 'serviceFeeIqd', quote->'serviceFeeIqd',
  'customerTotalIqd', quote->'customerTotalIqd', 'firstStartsAt', quote#>>'{items,0,startsAt}'
) as submission
from journey_submission
cross join lateral (select public.get_public_booking_quote_with_fingerprint(
  'en', 'cottage-30000000000040008000000000003201', submission->'discoveryQuery'
) as quote) current_quote;
grant select on stale_price_replacement to service_role;
set local role service_role;
create temporary table stale_price_replacement_result as
select public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202', '11111111-1111-4111-8111-111111113709', (select submission from stale_price_replacement)
) result;
select is(
  (select result->>'status' from stale_price_replacement_result), 'ready',
  'an unusable prepared attempt permits a replacement in the same conversation without payment'
);
select is(public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202', '11111111-1111-4111-8111-111111113201', (select submission from journey_submission)
)->>'status', 'unavailable', 'retired same-key preparation replays its terminal unavailable result');
select ok(
  (select result->>'attemptId' from stale_price_replacement_result) is not null
  and public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202', '11111111-1111-4111-8111-111111113709', (select submission from stale_price_replacement)
  )->>'attemptId' = (select result->>'attemptId' from stale_price_replacement_result),
  'replacement replay retains its own new attempt identity'
);
reset role;
select results_eq(
  $$select attempts.state::text, attempts.intent_dedupe_active,
      public.messaging_submission_attempt_is_resolved(attempts.id)
    from public.booking_request_submission_attempts attempts where attempts.id = (select (result->>'attemptId')::uuid from prepared_submission)$$,
  $$values ('expired'::text, false, true)$$,
  'unusable preparation is expired, deduplication inactive and the conversation attempt resolved'
);
select results_eq(
  $$select to_jsonb(attempts) - array['state','intent_dedupe_active','updated_at']
      = baseline.record - array['state','intent_dedupe_active','updated_at']
    from public.booking_request_submission_attempts attempts
    cross join stale_preparation_before baseline
    where attempts.id = (select (result->>'attemptId')::uuid from prepared_submission)$$,
  $$values (true)$$,
  'retirement preserves the original preparation identity, search, quote, intent and creation time'
);
select results_eq(
  $$select count(*)::integer,
      count(*) filter (where conversation_id = (select (result->>'conversationId')::uuid from submission_conversation))::integer
    from public.booking_request_submission_attempts$$,
  $$values (2,2)$$,
  'the conversation retains the retired preparation and exactly one fresh replacement'
);
select results_eq(
  $$select
      (select count(*)::integer from public.booking_request_authorization_claims),
      (select count(*)::integer from public.payment_provider_operations),
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments),
      (select count(*)::integer from public.booking_request_payment_history history
        where history.payment_lifecycle_id in (
          select attempts.payment_lifecycle_id
          from public.booking_request_submission_attempts attempts
          where attempts.customer_user_id = '00000000-0000-0000-0000-000000003202'
        )),
      (select count(*)::integer from public.booking_request_submission_attempts
        where payment_snapshot is not null
          or num_nulls(authorization_provider,authorization_environment,authorization_merchant_id,
            authorization_terminal_id,authorization_provider_request_id,authorization_provider_reference,
            authorization_movement_reference,release_provider_request_id,release_provider_reference,
            release_movement_reference) <> 10)$$,
  $$values (0,0,0,0,0,0)$$,
  'stale preparation retirement and replacement create no payment, request, hold or financial history'
);
rollback to savepoint stale_price_preparation;

savepoint stale_availability_preparation;
update public.cottage_inventory_availability
set state = 'closed'
where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
  and unit_kind = 'shift'
  and unit_id = '62000000-0000-4000-8000-000000003202'
  and service_day = '2099-08-21';
savepoint stale_availability_retry;
set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    (select submission from journey_submission)
  ) ->> 'status',
  'quote-stale',
  'a pre-provider crash cannot resume after availability closes'
);
reset role;
rollback to savepoint stale_availability_retry;
set local role service_role;
select is(public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202', '11111111-1111-4111-8111-111111113709', (select submission from usable_replacement_submission)
)->>'status', 'ready', 'a direct replacement retires unavailable preparation without requiring a stale retry');
reset role;
select results_eq(
  $$select attempts.state::text, attempts.intent_dedupe_active,
      public.messaging_submission_attempt_is_resolved(attempts.id)
    from public.booking_request_submission_attempts attempts where attempts.id = (select (result->>'attemptId')::uuid from prepared_submission)$$,
  $$values ('expired'::text, false, true)$$,
  'direct replacement resolves only the unusable old preparation'
);
select results_eq(
  $$select
      (select count(*)::integer from public.booking_request_authorization_claims),
      (select count(*)::integer from public.payment_provider_operations),
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments),
      (select count(*)::integer from public.booking_request_payment_history history
        where history.payment_lifecycle_id in (
          select attempts.payment_lifecycle_id
          from public.booking_request_submission_attempts attempts
          where attempts.customer_user_id = '00000000-0000-0000-0000-000000003202'
        )),
      (select count(*)::integer from public.booking_request_submission_attempts
        where payment_snapshot is not null
          or num_nulls(authorization_provider,authorization_environment,authorization_merchant_id,
            authorization_terminal_id,authorization_provider_request_id,authorization_provider_reference,
            authorization_movement_reference,release_provider_request_id,release_provider_reference,
            release_movement_reference) <> 10)$$,
  $$values (0,0,0,0,0,0)$$,
  'direct replacement creates no claim, provider call, Pending Hold or financial history'
);
rollback to savepoint stale_availability_preparation;
select is(
  (select count(*) from public.booking_request_submission_attempts),
  1::bigint,
  'customer-scoped idempotency persists only one attempt'
);

set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    jsonb_set(
      (select submission from journey_submission),
      '{intent,customerName}', '"Different Customer"'::jsonb
    )
  ) ->> 'status',
  'invalid',
  'an idempotency key cannot be rebound to a different immutable intent'
);
reset role;

savepoint corrupt_preparation_search;
update public.booking_request_submission_attempts
set requested_search = '[]'::jsonb
where id = (select (result->>'attemptId')::uuid from prepared_submission);
create temporary table corrupt_preparation_before as
select to_jsonb(attempts) record from public.booking_request_submission_attempts attempts
where attempts.id = (select (result->>'attemptId')::uuid from prepared_submission);
set local role service_role;
select throws_ok(
  $$select public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202', '11111111-1111-4111-8111-111111113709',
    jsonb_set((select submission from journey_submission), '{intent,bookingNote}', '"A replacement request."'::jsonb)
  )$$,
  '22023', 'Public Cottage search input is invalid',
  'corrupt stored search fails explicitly instead of silently retiring preparation'
);
reset role;
select results_eq(
  $$select to_jsonb(attempts) = baseline.record,
      not public.messaging_submission_attempt_is_resolved(attempts.id),
      (select count(*)::integer from public.booking_request_submission_attempts)
    from public.booking_request_submission_attempts attempts cross join corrupt_preparation_before baseline
    where attempts.id = (select (result->>'attemptId')::uuid from prepared_submission)$$,
  $$values (true,true,1)$$,
  'corrupt preparation remains unchanged and unresolved with no replacement'
);
select results_eq(
  $$select
      (select count(*)::integer from public.booking_request_authorization_claims),
      (select count(*)::integer from public.payment_provider_operations),
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments),
      (select count(*)::integer from public.booking_request_payment_history history
        where history.payment_lifecycle_id in (
          select attempts.payment_lifecycle_id
          from public.booking_request_submission_attempts attempts
          where attempts.customer_user_id = '00000000-0000-0000-0000-000000003202'
        )),
      (select count(*)::integer from public.booking_request_submission_attempts
        where payment_snapshot is not null
          or num_nulls(authorization_provider,authorization_environment,authorization_merchant_id,
            authorization_terminal_id,authorization_provider_request_id,authorization_provider_reference,
            authorization_movement_reference,release_provider_request_id,release_provider_reference,
            release_movement_reference) <> 10)$$,
  $$values (0,0,0,0,0,0)$$,
  'corrupt persisted input creates no payment, request or hold'
);
rollback to savepoint corrupt_preparation_search;

create temporary table authorized_payment as
select jsonb_build_object(
  'paymentLifecycleId', result ->> 'paymentLifecycleId',
  'currency', 'IQD',
  'bookingPriceFils', 110000000,
  'bookingServiceFeeFils', 5000000,
  'customerTotalFils', 115000000,
  'authorization', jsonb_build_object(
    'paymentLifecycleId', result ->> 'paymentLifecycleId',
    'kind', 'authorization',
    'logicalOperationId', (result ->> 'paymentLifecycleId') || ':authorization',
    'attemptId', (result ->> 'paymentLifecycleId') || ':authorization:attempt-1',
    'status', 'succeeded',
    'amountFils', 115000000,
    'providerRequestId', 'provider-request-3201',
    'providerReference', 'provider-reference-3201',
    'movementReference', 'movement-reference-3201',
    'reconciliationRequired', false,
    'retrySafe', false
  ),
  'capture', null,
  'release', null,
  'refunds', jsonb_build_array(),
  'financials', jsonb_build_object(
    'refundedBookingPriceFils', 0,
    'refundedBookingServiceFeeFils', 0,
    'remainingBookingPriceFils', 110000000,
    'remainingBookingServiceFeeFils', 5000000,
    'marketplaceCommissionFils', 11000000,
    'ownerEntitlementFils', 99000000
  ),
  'payout', jsonb_build_object(
    'status', 'not_eligible', 'eligibleFils', 99000000,
    'paidFils', 0, 'providerFeeFils', 0, 'providerReserveFils', 0,
    'recoveryExposureFils', 0, 'recoveryBalanceFils', 0,
    'automaticOwnerDebitFils', 0, 'paidWhileBlocked', false,
    'settlement', null
  ),
  'holds', jsonb_build_object('administrator', false, 'dispute', false),
  'dispute', null,
  'audits', jsonb_build_array(),
  'movements', jsonb_build_array(jsonb_build_object(
    'kind', 'authorization',
    'logicalOperationId', (result ->> 'paymentLifecycleId') || ':authorization',
    'attemptId', (result ->> 'paymentLifecycleId') || ':authorization:attempt-1',
    'amountFils', 115000000,
    'movementReference', 'movement-reference-3201',
    'recordedAt', '2099-08-21T14:00:00.000Z'
  ))
) as snapshot
from prepared_submission;
grant select on authorized_payment to service_role;

create temporary table pending_authorization_payment as
select snapshot
  #- '{authorization,providerRequestId}'
  #- '{authorization,providerReference}'
  #- '{authorization,movementReference}'
  || jsonb_build_object(
    'authorization', (snapshot -> 'authorization') || jsonb_build_object(
      'status', 'pending', 'providerRequestId', null,
      'providerReference', null, 'movementReference', null
    ),
    'movements', jsonb_build_array()
  ) as snapshot
from authorized_payment;
grant select on pending_authorization_payment to service_role;

savepoint suspension_customer_direct_replacement;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select lives_ok($test$
do $body$
declare original_attempt public.booking_request_submission_attempts;
declare result jsonb;
declare counts_before jsonb;
begin
  select * into strict original_attempt from public.booking_request_submission_attempts
  where id=(select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
  counts_before:=pg_temp.preparation_money_counts();
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result:=public.set_marketplace_suspension('customer',original_attempt.customer_user_id,'suspend',0,'Fictional preparation restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension failed: %',result; end if;
  result:=public.set_marketplace_suspension('customer',original_attempt.customer_user_id,'reactivate',1,'Prospective preparation restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Reactivation failed: %',result; end if;
  result:=public.prepare_booking_request_submission(original_attempt.customer_user_id,'11111111-1111-4111-8111-111111113710',(select submission from journey_submission));
  if result->>'status' is distinct from 'ready' then raise exception 'Direct fresh key cannot replace restored customer preparation: %',result; end if;
  perform pg_temp.assert_restriction_stale_preparation_replacement(
    original_attempt,result,'11111111-1111-4111-8111-111111113710'::uuid,(select submission from journey_submission),counts_before);
end;
$body$;
$test$,'restriction_stale_preparation_replacement: customer direct fresh key');
rollback to savepoint suspension_customer_direct_replacement;

savepoint suspension_owner_direct_replacement;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
insert into public.owner_applications(id,owner_user_id,applicant_kind,legal_name,status,submitted_at,review_started_at,review_due_at)
values('20000000-0000-4000-8000-000000003290','00000000-0000-0000-0000-000000003201','individual','Fictional Admission Owner','submitted',now(),now(),now()+interval '72 hours');
insert into public.owner_verification_documents(id,application_id,kind,object_path,original_filename,media_type,size_bytes)
values('42000000-0000-4000-8000-000000003290','20000000-0000-4000-8000-000000003290','identity','fictional/pending/identity.pdf','identity.pdf','application/pdf',128);
update public.owner_verification_documents set content_digest=repeat('e',64),digest_source='sha256' where id='42000000-0000-4000-8000-000000003290';
select public.review_owner_application('20000000-0000-4000-8000-000000003290',1,'approve','Fictional content-bound evidence accepted','{}','{}','Baghdad','licence','Fictional licence',jsonb_build_object('identity',(current_date+365)::text));
select lives_ok($test$
do $body$
declare original_attempt public.booking_request_submission_attempts;
declare result jsonb;
declare counts_before jsonb;
begin
  select * into strict original_attempt from public.booking_request_submission_attempts
  where id=(select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
  counts_before:=pg_temp.preparation_money_counts();
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result:=public.set_marketplace_suspension('owner',(select owner_user_id from public.owner_application_cottage_profiles where id=original_attempt.profile_id),'suspend',2,'Fictional preparation restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension failed: %',result; end if;
  result:=public.set_marketplace_suspension('owner',(select owner_user_id from public.owner_application_cottage_profiles where id=original_attempt.profile_id),'reactivate',3,'Prospective preparation restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Reactivation failed: %',result; end if;
  result:=public.prepare_booking_request_submission(original_attempt.customer_user_id,'11111111-1111-4111-8111-111111113710',(select submission from journey_submission));
  if result->>'status' is distinct from 'ready' then raise exception 'Direct fresh key cannot replace restored owner preparation: %',result; end if;
  perform pg_temp.assert_restriction_stale_preparation_replacement(
    original_attempt,result,'11111111-1111-4111-8111-111111113710'::uuid,(select submission from journey_submission),counts_before);
end;
$body$;
$test$,'restriction_stale_preparation_replacement: owner direct fresh key');
rollback to savepoint suspension_owner_direct_replacement;

savepoint suspension_cottage_direct_replacement;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
insert into public.owner_applications(id,owner_user_id,applicant_kind,legal_name,status,submitted_at,review_started_at,review_due_at)
values('20000000-0000-4000-8000-000000003290','00000000-0000-0000-0000-000000003201','individual','Fictional Admission Owner','submitted',now(),now(),now()+interval '72 hours');
insert into public.owner_verification_documents(id,application_id,kind,object_path,original_filename,media_type,size_bytes)
values('42000000-0000-4000-8000-000000003290','20000000-0000-4000-8000-000000003290','identity','fictional/pending/identity.pdf','identity.pdf','application/pdf',128);
update public.owner_verification_documents set content_digest=repeat('e',64),digest_source='sha256' where id='42000000-0000-4000-8000-000000003290';
select public.review_owner_application('20000000-0000-4000-8000-000000003290',1,'approve','Fictional content-bound evidence accepted','{}','{}','Baghdad','licence','Fictional licence',jsonb_build_object('identity',(current_date+365)::text));
select lives_ok($test$
do $body$
declare original_attempt public.booking_request_submission_attempts;
declare result jsonb;
declare counts_before jsonb;
begin
  select * into strict original_attempt from public.booking_request_submission_attempts
  where id=(select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
  counts_before:=pg_temp.preparation_money_counts();
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result:=public.set_marketplace_suspension('cottage',original_attempt.profile_id,'suspend',0,'Fictional preparation restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension failed: %',result; end if;
  result:=public.set_marketplace_suspension('cottage',original_attempt.profile_id,'reactivate',1,'Prospective preparation restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Reactivation failed: %',result; end if;
  result:=public.prepare_booking_request_submission(original_attempt.customer_user_id,'11111111-1111-4111-8111-111111113710',(select submission from journey_submission));
  if result->>'status' is distinct from 'ready' then raise exception 'Direct fresh key cannot replace restored cottage preparation: %',result; end if;
  perform pg_temp.assert_restriction_stale_preparation_replacement(
    original_attempt,result,'11111111-1111-4111-8111-111111113710'::uuid,(select submission from journey_submission),counts_before);
end;
$body$;
$test$,'restriction_stale_preparation_replacement: cottage direct fresh key');
rollback to savepoint suspension_cottage_direct_replacement;

savepoint suspension_begin_replacement;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select lives_ok($test$
do $body$
declare original_attempt public.booking_request_submission_attempts;
declare result jsonb;
declare counts_before jsonb;
begin
  select * into strict original_attempt from public.booking_request_submission_attempts
  where id=(select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
  counts_before:=pg_temp.preparation_money_counts();
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result:=public.set_marketplace_suspension('customer',original_attempt.customer_user_id,'suspend',0,'Fictional preparation restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension failed: %',result; end if;
  result:=public.set_marketplace_suspension('customer',original_attempt.customer_user_id,'reactivate',1,'Prospective preparation restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Reactivation failed: %',result; end if;
  result:=public.begin_booking_request_authorization_claim(original_attempt.id,(select snapshot from pending_authorization_payment),'{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb);
  if result is distinct from '{"status":"quote-stale"}'::jsonb then raise exception 'Fresh begin did not refuse stale revision: %',result; end if;
  if not exists(select 1 from public.booking_request_submission_attempts where id=original_attempt.id and state='expired' and not intent_dedupe_active)
  then raise exception 'Fresh begin refusal did not retire untouched restriction-stale preparation'; end if;
  result:=public.prepare_booking_request_submission(original_attempt.customer_user_id,'11111111-1111-4111-8111-111111113710',(select submission from journey_submission));
  if result->>'status' is distinct from 'ready' then raise exception 'Direct fresh key cannot replace begin-retired preparation: %',result; end if;
  perform pg_temp.assert_restriction_stale_preparation_replacement(
    original_attempt,result,'11111111-1111-4111-8111-111111113710'::uuid,(select submission from journey_submission),counts_before);
end;
$body$;
$test$,'restriction_stale_preparation_replacement: begin claim retirement');
rollback to savepoint suspension_begin_replacement;

savepoint suspension_owner_fresh;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
insert into public.owner_applications(id,owner_user_id,applicant_kind,legal_name,status,submitted_at,review_started_at,review_due_at)
values('20000000-0000-4000-8000-000000003290','00000000-0000-0000-0000-000000003201','individual','Fictional Admission Owner','submitted',now(),now(),now()+interval '72 hours');
insert into public.owner_verification_documents(id,application_id,kind,object_path,original_filename,media_type,size_bytes)
values('42000000-0000-4000-8000-000000003290','20000000-0000-4000-8000-000000003290','identity','fictional/pending/identity.pdf','identity.pdf','application/pdf',128);
update public.owner_verification_documents set content_digest=repeat('e',64),digest_source='sha256' where id='42000000-0000-4000-8000-000000003290';
select public.review_owner_application('20000000-0000-4000-8000-000000003290',1,'approve','Fictional content-bound evidence accepted','{}','{}','Baghdad','licence','Fictional licence',jsonb_build_object('identity',(current_date+365)::text));
select lives_ok($test$
do $body$
declare original_revisions jsonb;
declare result jsonb;
declare target_attempt uuid := (select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
declare snapshot jsonb := (select payment.snapshot from pending_authorization_payment payment);
declare identity jsonb := '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}';
begin
  original_revisions:=(select jsonb_build_array(attempts.customer_suspension_revision,attempts.owner_suspension_revision,attempts.cottage_suspension_revision) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt);
  if not public.owner_can_start_new_business('00000000-0000-0000-0000-000000003201')
    or not public.is_cottage_publicly_discoverable('30000000-0000-4000-8000-000000003201')
  then raise exception 'Restoration did not restore ordinary owner/cottage eligibility'; end if;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result := public.set_marketplace_suspension('owner','00000000-0000-0000-0000-000000003201','suspend',2,'Fictional fresh claim restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension failed: %',result; end if;
  result:=public.prepare_booking_request_submission('00000000-0000-0000-0000-000000003202','11111111-1111-4111-8111-111111113201',(select journey.submission from journey_submission journey));
  if result->>'status' is distinct from 'quote-stale' then raise exception 'Old preparation revived after owner transition: %',result; end if;
  result := public.begin_booking_request_authorization_claim(target_attempt,snapshot,identity);
  if result->>'status' is distinct from 'quote-stale' then raise exception 'Fresh claim bypassed suspension: %',result; end if;
  result := public.set_marketplace_suspension('owner','00000000-0000-0000-0000-000000003201','reactivate',3,'Prospective restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Reactivation failed: %',result; end if;
  if not public.owner_can_start_new_business('00000000-0000-0000-0000-000000003201')
    or not public.is_cottage_publicly_discoverable('30000000-0000-4000-8000-000000003201')
  then raise exception 'Restoration did not restore ordinary owner/cottage eligibility'; end if;
  if (select jsonb_build_array(customer.customer_suspension_revision,owner_context.owner_suspension_revision,profiles.suspension_revision)
      from public.booking_request_submission_attempts attempts
      join public.account_contexts customer on customer.user_id=attempts.customer_user_id
      join public.owner_application_cottage_profiles profiles on profiles.id=attempts.profile_id
      join public.account_contexts owner_context on owner_context.user_id=profiles.owner_user_id
      where attempts.id=target_attempt)
      is distinct from jsonb_set(original_revisions,'{1}',to_jsonb((original_revisions->>1)::bigint+2))
  then raise exception 'owner restoration did not isolate exactly its changed revision'; end if;
  result:=public.prepare_booking_request_submission('00000000-0000-0000-0000-000000003202','11111111-1111-4111-8111-111111113201',(select journey.submission from journey_submission journey));
  if result->>'status' is distinct from 'unavailable' then raise exception 'Retired old preparation did not remain terminal after owner restoration: %',result; end if;
  result := public.begin_booking_request_authorization_claim(target_attempt,snapshot,identity);
  if result->>'status' is distinct from 'quote-stale' then raise exception 'Fresh claim revived old revision: %',result; end if;
  if exists(select 1 from public.booking_request_authorization_claims where attempt_id=target_attempt)
    or exists(select 1 from public.payment_provider_operations)
    or exists(select 1 from public.booking_requests)
    or exists(select 1 from public.cottage_booking_period_commitments)
  then raise exception 'Rejected fresh claim created authorization, request or hold'; end if;
  if (select jsonb_build_array(attempts.customer_suspension_revision,attempts.owner_suspension_revision,attempts.cottage_suspension_revision) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt) is distinct from original_revisions then raise exception 'owner fresh rebased stored attempt revisions'; end if;
end;
$body$;
$test$,'suspension_fences_prepared_and_issued_authorizations: owner fresh restoration');
rollback to savepoint suspension_owner_fresh;

savepoint suspension_cottage_fresh;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
insert into public.owner_applications(id,owner_user_id,applicant_kind,legal_name,status,submitted_at,review_started_at,review_due_at)
values('20000000-0000-4000-8000-000000003290','00000000-0000-0000-0000-000000003201','individual','Fictional Admission Owner','submitted',now(),now(),now()+interval '72 hours');
insert into public.owner_verification_documents(id,application_id,kind,object_path,original_filename,media_type,size_bytes)
values('42000000-0000-4000-8000-000000003290','20000000-0000-4000-8000-000000003290','identity','fictional/pending/identity.pdf','identity.pdf','application/pdf',128);
update public.owner_verification_documents set content_digest=repeat('e',64),digest_source='sha256' where id='42000000-0000-4000-8000-000000003290';
select public.review_owner_application('20000000-0000-4000-8000-000000003290',1,'approve','Fictional content-bound evidence accepted','{}','{}','Baghdad','licence','Fictional licence',jsonb_build_object('identity',(current_date+365)::text));
select lives_ok($test$
do $body$
declare original_revisions jsonb;
declare result jsonb;
declare target_attempt uuid := (select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
declare snapshot jsonb := (select payment.snapshot from pending_authorization_payment payment);
declare identity jsonb := '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}';
begin
  original_revisions:=(select jsonb_build_array(attempts.customer_suspension_revision,attempts.owner_suspension_revision,attempts.cottage_suspension_revision) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt);
  if not public.owner_can_start_new_business('00000000-0000-0000-0000-000000003201')
    or not public.is_cottage_publicly_discoverable('30000000-0000-4000-8000-000000003201')
  then raise exception 'Restoration did not restore ordinary owner/cottage eligibility'; end if;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result := public.set_marketplace_suspension('cottage','30000000-0000-4000-8000-000000003201','suspend',0,'Fictional fresh claim restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension failed: %',result; end if;
  result:=public.prepare_booking_request_submission('00000000-0000-0000-0000-000000003202','11111111-1111-4111-8111-111111113201',(select journey.submission from journey_submission journey));
  if result->>'status' is distinct from 'quote-stale' then raise exception 'Old preparation revived after cottage transition: %',result; end if;
  result := public.begin_booking_request_authorization_claim(target_attempt,snapshot,identity);
  if result->>'status' is distinct from 'quote-stale' then raise exception 'Fresh claim bypassed suspension: %',result; end if;
  result := public.set_marketplace_suspension('cottage','30000000-0000-4000-8000-000000003201','reactivate',1,'Prospective restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Reactivation failed: %',result; end if;
  if not public.owner_can_start_new_business('00000000-0000-0000-0000-000000003201')
    or not public.is_cottage_publicly_discoverable('30000000-0000-4000-8000-000000003201')
  then raise exception 'Restoration did not restore ordinary owner/cottage eligibility'; end if;
  if (select jsonb_build_array(customer.customer_suspension_revision,owner_context.owner_suspension_revision,profiles.suspension_revision)
      from public.booking_request_submission_attempts attempts
      join public.account_contexts customer on customer.user_id=attempts.customer_user_id
      join public.owner_application_cottage_profiles profiles on profiles.id=attempts.profile_id
      join public.account_contexts owner_context on owner_context.user_id=profiles.owner_user_id
      where attempts.id=target_attempt)
      is distinct from jsonb_set(original_revisions,'{2}',to_jsonb((original_revisions->>2)::bigint+2))
  then raise exception 'cottage restoration did not isolate exactly its changed revision'; end if;
  result:=public.prepare_booking_request_submission('00000000-0000-0000-0000-000000003202','11111111-1111-4111-8111-111111113201',(select journey.submission from journey_submission journey));
  if result->>'status' is distinct from 'unavailable' then raise exception 'Retired old preparation did not remain terminal after cottage restoration: %',result; end if;
  result := public.begin_booking_request_authorization_claim(target_attempt,snapshot,identity);
  if result->>'status' is distinct from 'quote-stale' then raise exception 'Fresh claim revived old revision: %',result; end if;
  if exists(select 1 from public.booking_request_authorization_claims where attempt_id=target_attempt)
    or exists(select 1 from public.payment_provider_operations)
    or exists(select 1 from public.booking_requests)
    or exists(select 1 from public.cottage_booking_period_commitments)
  then raise exception 'Rejected fresh claim created authorization, request or hold'; end if;
  if (select jsonb_build_array(attempts.customer_suspension_revision,attempts.owner_suspension_revision,attempts.cottage_suspension_revision) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt) is distinct from original_revisions then raise exception 'cottage fresh rebased stored attempt revisions'; end if;
end;
$body$;
$test$,'suspension_fences_prepared_and_issued_authorizations: cottage fresh restoration');
rollback to savepoint suspension_cottage_fresh;

savepoint suspension_fresh_claim;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select lives_ok($test$
do $body$
declare result jsonb;
declare target_attempt uuid := (select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
declare snapshot jsonb := (select payment.snapshot from pending_authorization_payment payment);
declare identity jsonb := '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}';
begin
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result := public.set_marketplace_suspension('customer','00000000-0000-0000-0000-000000003202','suspend',0,'Fictional fresh claim restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension failed: %',result; end if;
  result := public.begin_booking_request_authorization_claim(target_attempt,snapshot,identity);
  if result->>'status' is distinct from 'customer-suspended' then raise exception 'Fresh claim bypassed suspension: %',result; end if;
  result := public.set_marketplace_suspension('customer','00000000-0000-0000-0000-000000003202','reactivate',1,'Prospective restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Reactivation failed: %',result; end if;
  result := public.begin_booking_request_authorization_claim(target_attempt,snapshot,identity);
  if result->>'status' is distinct from 'quote-stale' then raise exception 'Fresh claim revived old revision: %',result; end if;
  if exists(select 1 from public.booking_request_authorization_claims where attempt_id=target_attempt)
    or exists(select 1 from public.payment_provider_operations)
    or exists(select 1 from public.booking_requests)
    or exists(select 1 from public.cottage_booking_period_commitments)
  then raise exception 'Rejected fresh claim created authorization, request or hold'; end if;
end;
$body$;
$test$,'suspension_fences_prepared_and_issued_authorizations: fresh claim');
rollback to savepoint suspension_fresh_claim;

savepoint suspension_issued_claim;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select lives_ok($test$
do $body$
declare result jsonb;
declare target_attempt uuid := (select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
declare snapshot jsonb := (select payment.snapshot from pending_authorization_payment payment);
declare identity jsonb := '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}';
declare original_attempt jsonb;
declare original_graph jsonb;
declare original_claim jsonb;
declare original_outbox jsonb;
begin
  result := public.begin_booking_request_authorization_claim(target_attempt,snapshot,identity);
  if result->>'status' is distinct from 'ready' then raise exception 'Issued claim fixture failed: %',result; end if;
  select to_jsonb(attempts) into original_attempt
  from public.booking_request_submission_attempts attempts where attempts.id=target_attempt;
  select to_jsonb(claims) into original_claim
  from public.booking_request_authorization_claims claims where claims.attempt_id=target_attempt;
  select to_jsonb(outbox) into original_outbox
  from public.booking_request_authorization_reconciliation_outbox outbox
  where outbox.claim_id=(original_claim->>'id')::uuid;
  if original_attempt->'payment_snapshot' is null
    or original_claim is null or original_outbox is null
  then raise exception 'Issued claim fixture lacks durable reconciliation evidence'; end if;
  original_graph:=pg_temp.booking_submission_graph();
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result := public.set_marketplace_suspension('customer','00000000-0000-0000-0000-000000003202','suspend',0,'Fictional issued claim restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension failed: %',result; end if;
  result := public.begin_booking_request_authorization_claim(target_attempt,snapshot,identity);
  if result->>'status' is distinct from 'customer-suspended' then raise exception 'Issued claim replay bypassed suspension: %',result; end if;
  result := public.set_marketplace_suspension('customer','00000000-0000-0000-0000-000000003202','reactivate',1,'Prospective issued claim restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Reactivation failed: %',result; end if;
  result := public.begin_booking_request_authorization_claim(target_attempt,snapshot,identity);
  if result->>'status' is distinct from 'quote-stale' then raise exception 'Issued claim replay revived old revision: %',result; end if;
  if (select to_jsonb(attempts) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt)
      is distinct from original_attempt
    or (select to_jsonb(claims) from public.booking_request_authorization_claims claims where claims.attempt_id=target_attempt)
      is distinct from original_claim
    or (select to_jsonb(outbox) from public.booking_request_authorization_reconciliation_outbox outbox where outbox.claim_id=(original_claim->>'id')::uuid)
      is distinct from original_outbox
  then raise exception 'Rejected issued claim replay changed durable reconciliation evidence'; end if;
  if (select count(*) from public.booking_request_authorization_claims where attempt_id=target_attempt)<>1
    or exists(select 1 from public.payment_provider_operations)
    or exists(select 1 from public.booking_requests)
    or exists(select 1 from public.cottage_booking_period_commitments)
  then raise exception 'Rejected issued claim replay created authorization, request or hold'; end if;
  if public.retire_unusable_prepared_booking_request_submission(target_attempt)
    or pg_temp.booking_submission_graph() is distinct from original_graph
  then raise exception 'Issued claim refusal changed attempt snapshot claim occupancy operation outbox or financial history'; end if;

end;
$body$;
$test$,'suspension_fences_prepared_and_issued_authorizations: issued claim replay');
rollback to savepoint suspension_issued_claim;

savepoint stale_claim_preparation;
update public.cottage_inventory_standard_prices set price_iqd = 120000
where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
  and unit_id = '62000000-0000-4000-8000-000000003202';
set local role service_role;
select is(public.begin_booking_request_authorization_claim(
  (select (result->>'attemptId')::uuid from prepared_submission), (select snapshot from pending_authorization_payment), '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
)->>'status', 'quote-stale', 'claim start retains its explicit stale-quote refusal');
reset role;
select results_eq(
  $$select attempts.state::text, attempts.intent_dedupe_active,
      public.messaging_submission_attempt_is_resolved(attempts.id)
    from public.booking_request_submission_attempts attempts where attempts.id = (select (result->>'attemptId')::uuid from prepared_submission)$$,
  $$values ('expired'::text, false, true)$$,
  'stale claim start retires preparation before any payment claim is created'
);
select results_eq(
  $$select
      (select count(*)::integer from public.booking_request_authorization_claims),
      (select count(*)::integer from public.payment_provider_operations),
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments),
      (select count(*)::integer from public.booking_request_payment_history history
        where history.payment_lifecycle_id in (
          select attempts.payment_lifecycle_id
          from public.booking_request_submission_attempts attempts
          where attempts.customer_user_id = '00000000-0000-0000-0000-000000003202'
        )),
      (select count(*)::integer from public.booking_request_submission_attempts
        where payment_snapshot is not null
          or num_nulls(authorization_provider,authorization_environment,authorization_merchant_id,
            authorization_terminal_id,authorization_provider_request_id,authorization_provider_reference,
            authorization_movement_reference,release_provider_request_id,release_provider_reference,
            release_movement_reference) <> 10)$$,
  $$values (0,0,0,0,0,0)$$,
  'stale claim-start retirement creates no payment or product hold'
);
rollback to savepoint stale_claim_preparation;

savepoint historical_overlimit_preparation;
create temporary table current_quote_definitions as
select pg_get_functiondef('public.get_public_booking_quote(public.cottage_profile_source_language,text,jsonb)'::regprocedure) as quote,
  pg_get_functiondef('public.get_public_booking_quote_with_fingerprint(public.cottage_profile_source_language,text,jsonb)'::regprocedure) as fingerprint;
-- Exact production declarations at fcd5c07ad5aaad740b483966ab7e11afdd751fd3,
-- supabase/schemas/20_functions_booking.sql:4058-4196, solely for historical preparation.
CREATE OR REPLACE FUNCTION "public"."get_public_booking_quote"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare target record;
declare booking_price numeric;
declare quoted_items jsonb;
begin
  if target_locale is null then
    raise exception 'Booking Quote locale is required' using errcode = '22023';
  end if;
  if target_slug is null
    or octet_length(target_slug) <> 40
    or target_slug !~ '^cottage-[0-9a-f]{32}$' then
    raise exception 'Invalid public Cottage slug' using errcode = '22023';
  end if;
  if requested_search is null then
    raise exception 'Booking Quote search is required' using errcode = '22023';
  end if;
  perform public.validate_public_cottage_search(requested_search);

  select listings.public_slug, profiles.current_shift_schedule_id as schedule_id,
    publications.name, publications.publication_number,
    localizations.house_rules,
    publications.capacity >= (requested_search ->> 'guests')::integer
      and (not requested_search ? 'governorate'
        or lower(publications.governorate) = lower(btrim(requested_search ->> 'governorate')))
      and (not requested_search ? 'area'
        or lower(publications.approximate_location) = lower(btrim(requested_search ->> 'area')))
      and array(
        select value
        from jsonb_array_elements_text(
          coalesce(requested_search -> 'amenities', '[]'::jsonb)
        ) values(value)
      ) <@ publications.amenities as matches_search,
    public.resolve_public_cottage_selection(
      profiles.current_shift_schedule_id, requested_search
    ) as inventory
  into target
  from public.cottage_marketplace_listings listings
  join public.owner_application_cottage_profiles profiles
    on profiles.id = listings.profile_id
  join public.cottage_publication_snapshots publications
    on publications.id = profiles.current_publication_id
    and publications.profile_id = profiles.id
  join public.cottage_publication_localizations localizations
    on localizations.publication_id = publications.id
    and localizations.locale = target_locale
  where listings.public_slug = target_slug
    and public.is_cottage_publicly_discoverable(profiles.id);

  if not found then
    return jsonb_build_object('status', 'not-found');
  end if;
  if not target.matches_search
    or (target.inventory ->> 'allAvailable')::boolean is not true
    or target.inventory ->> 'totalPriceIqd' is null then
    return jsonb_build_object('status', 'selection-unavailable');
  end if;

  booking_price := (target.inventory ->> 'totalPriceIqd')::numeric;
  if booking_price <= 0
    or booking_price + 5000 > 9007199254740991 then
    raise exception 'Booking Quote money exceeds the safe range'
      using errcode = '22003';
  end if;

  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'serviceDay', item.value ->> 'serviceDay',
    'kind', item.value ->> 'kind',
    'position', (item.value ->> 'position')::smallint,
    'displayName', item.value ->> 'name',
    'startsAt', (item.value ->> 'serviceDay') || 'T'
      || (item.value ->> 'startTime') || ':00+03:00',
    'endsAt', to_char(
      (item.value ->> 'serviceDay')::date
        + case
            when (item.value ->> 'endTime')::time
              < (item.value ->> 'startTime')::time then 1
            else 0
          end,
      'YYYY-MM-DD'
    ) || 'T' || (item.value ->> 'endTime') || ':00+03:00',
    'crossesMidnight', (item.value ->> 'endTime')::time
      < (item.value ->> 'startTime')::time,
    'priceIqd', (item.value ->> 'priceIqd')::bigint
  )) order by item.ordinality)
  into quoted_items
  from jsonb_array_elements(target.inventory -> 'selectedInventory')
    with ordinality as item(value, ordinality);

  return jsonb_build_object(
    'status', 'quoted',
    'slug', target.public_slug,
    'cottageName', target.name,
    'contentVersion', target.publication_number,
    'houseRules', target.house_rules,
    'termsVersion', 'rentcottage-mvp-2026-08-04',
    'items', quoted_items,
    'bookingPriceIqd', booking_price::bigint,
    'serviceFeeIqd', 5000,
    'customerTotalIqd', (booking_price + 5000)::bigint
  );
end;
$_$;

ALTER FUNCTION "public"."get_public_booking_quote"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_public_booking_quote_with_fingerprint"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare quote jsonb;
declare fingerprint text;
declare marketplace_terms jsonb;
begin
  quote := public.get_public_booking_quote(
    target_locale, target_slug, requested_search
  );
  if quote ->> 'status' <> 'quoted' then
    return quote;
  end if;
  marketplace_terms := public.booking_request_marketplace_terms(target_locale);
  quote := quote || jsonb_build_object(
    'termsVersion', marketplace_terms ->> 'version',
    'marketplaceTerms', marketplace_terms
  );
  fingerprint := encode(
    extensions.digest(
      convert_to((quote - 'status')::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  return quote || jsonb_build_object('quoteFingerprint', fingerprint);
end;
$$;

ALTER FUNCTION "public"."get_public_booking_quote_with_fingerprint"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") OWNER TO "postgres";
insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select schedule_revision_id, unit_kind, unit_id, service_day::date, 'open'
from public.cottage_inventory_standard_prices
cross join generate_series('2099-08-23'::date, '2099-09-21'::date, interval '1 day') days(service_day)
where schedule_revision_id = '60000000-0000-4000-8000-000000003201';
create temporary table historical_search as
select jsonb_build_object('from','2099-08-21','to','2099-09-21','guests',4,'selections', (
  select jsonb_agg(jsonb_build_object(
    'serviceDay',to_char(service_day,'YYYY-MM-DD'),'kind','shift','position',2
  ) order by service_day)
  from generate_series('2099-08-21'::date,'2099-09-21'::date,interval '1 day') service_day
)) search;
grant select on historical_search to service_role;
set local role service_role;
create temporary table historical_conversation as
select public.create_messaging_conversation(
  '00000000-0000-0000-0000-000000003202',
  '30000000-0000-4000-8000-000000003201',
  '36000000-0000-4000-8000-000000003709'
) result;
reset role;
create temporary table historical_conversation_submission as
select jsonb_set(submission || jsonb_build_object(
  'conversationId',(select result->>'conversationId' from historical_conversation)
),'{intent,conversationId}',to_jsonb((select result->>'conversationId' from historical_conversation))) submission
from valid_submission;
create temporary table historical_submission as
select submission || jsonb_build_object(
  'discoveryQuery', (select search from historical_search),
  'quoteFingerprint', quote->>'quoteFingerprint',
  'contentVersion', quote->'contentVersion', 'termsVersion', quote->'termsVersion',
  'bookingPriceIqd', quote->'bookingPriceIqd', 'serviceFeeIqd', quote->'serviceFeeIqd',
  'customerTotalIqd', quote->'customerTotalIqd', 'firstStartsAt', quote#>>'{items,0,startsAt}'
) as submission
from historical_conversation_submission
cross join lateral (select public.get_public_booking_quote_with_fingerprint(
  'en', 'cottage-30000000000040008000000000003201', (select search from historical_search)
) as quote) current_quote;
grant select on historical_submission to service_role;
set local role service_role;
create temporary table historical_preparation as
select public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202', '11111111-1111-4111-8111-111111113732', (select submission from historical_submission)
) result;
reset role;
do $$
begin
  execute (select quote from current_quote_definitions);
  execute (select fingerprint from current_quote_definitions);
  if (select result->>'status' from historical_preparation) is distinct from 'ready' then
    raise exception 'Historical production preparation fixture was not admitted';
  end if;
  if public.resolve_booking_quote_with_fingerprint(
    'en','cottage-30000000000040008000000000003201',(select search from historical_search),false
  ) - 'status' is distinct from (
    select attempts.quote_payload from public.booking_request_submission_attempts attempts
    where attempts.id = (select (result->>'attemptId')::uuid from historical_preparation)
  ) then
    raise exception 'Historical quote fixture does not match current unlimited resolution';
  end if;
end;
$$;
select results_eq(
  $$select result->>'status',
      (select count(*)::integer from public.booking_request_submission_attempts attempts
        where attempts.id = (result->>'attemptId')::uuid
          and attempts.conversation_id = (select (result->>'conversationId')::uuid from historical_conversation))
    from historical_preparation$$,
  $$values ('ready'::text,1)$$,
  'historical production preparation creates one real conversation-bound attempt'
);
select results_eq(
  $$select (quote_payload->>'bookingPriceIqd')::bigint,
      (quote_payload->>'serviceFeeIqd')::bigint,
      (quote_payload->>'customerTotalIqd')::bigint,
      jsonb_array_length(quote_payload->'items')
    from public.booking_request_submission_attempts attempts
    where attempts.id = (select (result->>'attemptId')::uuid from historical_preparation)$$,
  $$values (3520000::bigint,5000::bigint,3525000::bigint,32)$$,
  'historical 32-day preparation preserves every selected shift and the full hand-calculated IQD total'
);
select ok(
  (select pg_get_functiondef('public.get_public_booking_quote(public.cottage_profile_source_language,text,jsonb)'::regprocedure) = quote
    and pg_get_functiondef('public.get_public_booking_quote_with_fingerprint(public.cottage_profile_source_language,text,jsonb)'::regprocedure) = fingerprint
    from current_quote_definitions),
  'both current production quote definitions are restored before historical observations'
);
create temporary table historical_preparation_before as
select to_jsonb(attempts) record from public.booking_request_submission_attempts attempts
where attempts.id = (select (result->>'attemptId')::uuid from historical_preparation);
-- Claim-start compatibility is observed separately from replacement retirement.
savepoint historical_claim_compatibility;
create temporary table historical_pending_payment as
select snapshot || jsonb_build_object(
  'paymentLifecycleId',result->>'paymentLifecycleId',
  'bookingPriceFils',3520000000::bigint,'customerTotalFils',3525000000::bigint,
  'authorization',(snapshot->'authorization') || jsonb_build_object(
    'paymentLifecycleId',result->>'paymentLifecycleId',
    'logicalOperationId',(result->>'paymentLifecycleId')||':authorization',
    'attemptId',(result->>'paymentLifecycleId')||':authorization:attempt-1',
    'amountFils',3525000000::bigint
  ),
  'financials',(snapshot->'financials') || jsonb_build_object(
    'remainingBookingPriceFils',3520000000::bigint,'marketplaceCommissionFils',352000000::bigint,
    'ownerEntitlementFils',3168000000::bigint
  ),
  'payout',(snapshot->'payout') || jsonb_build_object('eligibleFils',3168000000::bigint)
) snapshot from pending_authorization_payment cross join historical_preparation;
grant select on historical_pending_payment to service_role;
set local role service_role;
select is(public.begin_booking_request_authorization_claim(
  (select (result->>'attemptId')::uuid from historical_preparation),
  (select snapshot from historical_pending_payment), '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
)->'executionPermit'->>'purpose', 'booking-request-authorization',
  'a valid historical 32-day preparation can still begin its Authorization Claim');
reset role;
rollback to savepoint historical_claim_compatibility;
set local role service_role;
select throws_ok(
  $$select public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202', '11111111-1111-4111-8111-111111113732', (select submission from historical_submission)
  )$$,
  '22023','Public Cottage search input is invalid',
  'historical 32-day preparation retry retains the current admission refusal'
);
reset role;
create temporary table historical_replacement as
select submission || jsonb_build_object(
  'discoveryQuery', submission->'discoveryQuery',
  'quoteFingerprint', quote->>'quoteFingerprint',
  'contentVersion', quote->'contentVersion', 'termsVersion', quote->'termsVersion',
  'bookingPriceIqd', quote->'bookingPriceIqd', 'serviceFeeIqd', quote->'serviceFeeIqd',
  'customerTotalIqd', quote->'customerTotalIqd', 'firstStartsAt', quote#>>'{items,0,startsAt}'
) as submission
from historical_conversation_submission
cross join lateral (select public.get_public_booking_quote_with_fingerprint(
  'en', 'cottage-30000000000040008000000000003201', submission->'discoveryQuery'
) as quote) current_quote;
grant select on historical_replacement to service_role;
set local role service_role;
select is(public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202', '11111111-1111-4111-8111-111111113709', (select submission from historical_replacement)
)->>'status', 'ready', 'a shorter replacement succeeds in the historical over-limit preparation conversation');
create temporary table historical_terminal_replay (result jsonb);
select lives_ok(
  $$insert into historical_terminal_replay
    select public.prepare_booking_request_submission(
      '00000000-0000-0000-0000-000000003202', '11111111-1111-4111-8111-111111113732',
      (select submission from historical_submission)
    )$$,
  'retired historical key replays without raising the current admission refusal'
);
select is((select result->>'status' from historical_terminal_replay), 'unavailable',
  'retired historical key replays terminal unavailable without re-admitting 32 days');
reset role;
select results_eq(
  $$select attempts.state::text, attempts.intent_dedupe_active,
      public.messaging_submission_attempt_is_resolved(attempts.id)
    from public.booking_request_submission_attempts attempts where attempts.id = (select (result->>'attemptId')::uuid from historical_preparation)$$,
  $$values ('expired'::text, false, true)$$,
  'replacement resolves historical over-limit preparation without payment'
);
select results_eq(
  $$select to_jsonb(attempts) - array['state','intent_dedupe_active','updated_at']
      = baseline.record - array['state','intent_dedupe_active','updated_at']
    from public.booking_request_submission_attempts attempts
    cross join historical_preparation_before baseline
    where attempts.id = (select (result->>'attemptId')::uuid from historical_preparation)$$,
  $$values (true)$$,
  'historical retirement preserves all original identifiers, selections, quote and immutable intent'
);
select results_eq(
  $$select
      (select count(*)::integer from public.booking_request_authorization_claims),
      (select count(*)::integer from public.payment_provider_operations),
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments),
      (select count(*)::integer from public.booking_request_payment_history history
        where history.payment_lifecycle_id in (
          select attempts.payment_lifecycle_id
          from public.booking_request_submission_attempts attempts
          where attempts.customer_user_id = '00000000-0000-0000-0000-000000003202'
        )),
      (select count(*)::integer from public.booking_request_submission_attempts
        where payment_snapshot is not null
          or num_nulls(authorization_provider,authorization_environment,authorization_merchant_id,
            authorization_terminal_id,authorization_provider_request_id,authorization_provider_reference,
            authorization_movement_reference,release_provider_request_id,release_provider_reference,
            release_movement_reference) <> 10)$$,
  $$values (0,0,0,0,0,0)$$,
  'historical replacement retirement creates no money movement, provider call, request or hold'
);
rollback to savepoint historical_overlimit_preparation;

savepoint authorization_null_input_audit;
create temporary table authorization_null_baseline as
select to_jsonb(attempts) as attempt_record,
  (select count(*)::integer from public.booking_request_authorization_claims)
    as claim_count,
  (select count(*)::integer
    from public.booking_request_authorization_reconciliation_outbox) as outbox_count,
  (select count(*)::integer from public.payment_provider_operations)
    as provider_count
from public.booking_request_submission_attempts attempts
where attempts.id = (
  select (result ->> 'attemptId')::uuid from prepared_submission
);
grant select on authorization_null_baseline to service_role;
create temporary table authorization_null_results (
  case_name text,
  status text
);
grant select, insert on authorization_null_results to service_role;
set local role service_role;
insert into authorization_null_results
select required_key,
  public.begin_booking_request_authorization_claim(
    (select (result ->> 'attemptId')::uuid from prepared_submission),
    jsonb_set(snapshot, array['authorization', required_key], 'null'::jsonb),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status'
from pending_authorization_payment
cross join (values
  ('paymentLifecycleId'), ('kind'), ('logicalOperationId'), ('attemptId'),
  ('status'), ('amountFils'), ('reconciliationRequired'), ('retrySafe')
) required(required_key);
select results_eq(
  $$select count(*)::integer, bool_and(status = 'invalid')
    from authorization_null_results$$,
  $$values (8::integer, true)$$,
  'the authorization issuer rejects every required pending-operation binding when JSON null'
);
reset role;
truncate authorization_null_results;
set local role service_role;
insert into authorization_null_results values
  ('sql-null-snapshot', public.begin_booking_request_authorization_claim(
    (select (result ->> 'attemptId')::uuid from prepared_submission),
    null,
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status'),
  ('json-null-snapshot', public.begin_booking_request_authorization_claim(
    (select (result ->> 'attemptId')::uuid from prepared_submission),
    'null'::jsonb,
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status'),
  ('json-null-authorization', public.begin_booking_request_authorization_claim(
    (select (result ->> 'attemptId')::uuid from prepared_submission),
    jsonb_set((select snapshot from pending_authorization_payment),
      '{authorization}', 'null'::jsonb),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status'),
  ('json-null-provider', public.begin_booking_request_authorization_claim(
    (select (result ->> 'attemptId')::uuid from prepared_submission),
    (select snapshot from pending_authorization_payment), 'null'::jsonb
  ) ->> 'status'),
  ('json-null-provider-environment',
    public.begin_booking_request_authorization_claim(
      (select (result ->> 'attemptId')::uuid from prepared_submission),
      (select snapshot from pending_authorization_payment),
      '{"provider":"fictional-payments","environment":null,"merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    ) ->> 'status');
select results_eq(
  $$select count(*)::integer, bool_and(status = 'invalid')
    from authorization_null_results$$,
  $$values (5::integer, true)$$,
  'the authorization issuer rejects null or non-object snapshot and provider inputs'
);
reset role;
select results_eq(
  $$select to_jsonb(attempts) = baseline.attempt_record,
      (select count(*)::integer from public.booking_request_authorization_claims)
        = baseline.claim_count,
      (select count(*)::integer
        from public.booking_request_authorization_reconciliation_outbox)
        = baseline.outbox_count,
      (select count(*)::integer from public.payment_provider_operations)
        = baseline.provider_count
    from authorization_null_baseline baseline
    join public.booking_request_submission_attempts attempts
      on attempts.id = (select (result ->> 'attemptId')::uuid from prepared_submission)$$,
  $$values (true, true, true, true)$$,
  'invalid authorization inputs create no claim, outbox, provider row, or attempt mutation'
);
set local role service_role;
create temporary table authorization_after_null_audit as
select public.begin_booking_request_authorization_claim(
  (select (result ->> 'attemptId')::uuid from prepared_submission),
  (select snapshot from pending_authorization_payment),
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as result;
select is(
  (select result -> 'executionPermit' ->> 'purpose'
    from authorization_after_null_audit),
  'booking-request-authorization',
  'authorization-purpose issuance remains available after fail-closed null attempts'
);
reset role;
rollback to savepoint authorization_null_input_audit;

set local role service_role;
select is(
  public.classify_booking_request_authorization_claim_persistence(
    (select (result ->> 'attemptId')::uuid from prepared_submission)
  ) ->> 'status',
  'absent',
  'an initial claim transaction that left no claim, outbox, or snapshot is safely retryable'
);
reset role;

savepoint lowered_search_limit_claim;
select pg_temp.lower_search_admission_limit();
set local role service_role;
select throws_ok(
  format(
    'select public.prepare_booking_request_submission(%L::uuid, %L::uuid, %L::jsonb)',
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    (select submission::text from journey_submission)
  ),
  '22023', 'Public Cottage search input is invalid',
  'a prepared attempt with no Authorization Claim is refused on retry once the search limit is lowered'
);
select is(
  public.begin_booking_request_authorization_claim(
    (select (result ->> 'attemptId')::uuid from prepared_submission),
    (select snapshot from pending_authorization_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) -> 'executionPermit' ->> 'purpose',
  'booking-request-authorization',
  'an attempt admitted before the search limit was lowered still begins its Authorization Claim'
);
reset role;
rollback to savepoint lowered_search_limit_claim;

savepoint independent_reconciliation;
set local role service_role;
select lives_ok(
  format(
    'select public.begin_booking_request_authorization_claim(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from pending_authorization_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'a crash-safe reconciliation claim is durably available to an independent consumer'
);
reset role;
create temporary table definitely_not_started_work (result jsonb);
grant select, insert on definitely_not_started_work to service_role;
set local role service_role;
insert into definitely_not_started_work
select public.dequeue_booking_request_authorization_reconciliation();
select is(
  (select result ->> 'status' from definitely_not_started_work),
  'work',
  'the deployed worker interface discovers persisted reconciliation work independently'
);
select ok(
  not ((select result from definitely_not_started_work) ?| array[
    'customerUserId', 'customerName', 'bookingNote', 'phone', 'publicSlug',
    'profileId', 'intentPayload', 'quotePayload', 'requestedSearch'
  ]),
  'dequeued provider work exposes no customer, profile, quote, intent, or contact data'
);
select is(
  public.dequeue_booking_request_authorization_reconciliation() ->> 'status',
  'empty',
  'a second worker cannot dequeue work while the first worker owns its lease'
);
reset role;
select is(
  (select lease_expires_at - updated_at
    from public.booking_request_authorization_reconciliation_outbox),
  interval '30 seconds',
  'a reconciliation worker owns an exact thirty-second technical lease'
);
update public.booking_request_authorization_reconciliation_outbox
set lease_expires_at = clock_timestamp() - interval '1 second';
create temporary table recovered_not_started_work (result jsonb);
grant select, insert on recovered_not_started_work to service_role;
set local role service_role;
insert into recovered_not_started_work
select public.dequeue_booking_request_authorization_reconciliation();
select results_eq(
  $$select
      recovered.result ->> 'status',
      recovered.result ->> 'claimId' = original.result ->> 'claimId',
      recovered.result ->> 'generation' = original.result ->> 'generation',
      recovered.result ->> 'stateRevision' = original.result ->> 'stateRevision',
      recovered.result ->> 'leaseToken' <> original.result ->> 'leaseToken'
    from recovered_not_started_work recovered
    cross join definitely_not_started_work original$$,
  $$values ('work'::text, true, true, true, true)$$,
  'an expired crashed-worker lease is retried with the same CAS identity and a new lease token'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from recovered_not_started_work))::uuid,
    ((select result ->> 'generation' from recovered_not_started_work))::integer,
    ((select result ->> 'stateRevision' from recovered_not_started_work))::bigint,
    ((select result ->> 'leaseToken' from recovered_not_started_work))::uuid,
    (select snapshot || jsonb_build_object(
      'authorization', (snapshot -> 'authorization') || jsonb_build_object(
        'status', 'failed', 'reconciliationRequired', false, 'retrySafe', false
      )
    ) from pending_authorization_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status',
  'applied',
  'independent reconciliation records provider-confirmed non-execution'
);
reset role;
select results_eq(
  $$select claims.state::text, occupancies.active, outbox.state
    from public.booking_request_authorization_claims claims
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('not_started'::text, false, 'complete'::text)$$,
  'definite non-execution terminally frees the private occupancy and completes the outbox'
);
select is(
  public.public_cottage_unit_is_available(
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003202', '2099-08-21'
  ),
  true,
  'definite non-execution restores public availability without a customer retry'
);
set local role service_role;
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from recovered_not_started_work))::uuid,
    ((select result ->> 'generation' from recovered_not_started_work))::integer,
    ((select result ->> 'stateRevision' from recovered_not_started_work))::bigint,
    ((select result ->> 'leaseToken' from recovered_not_started_work))::uuid,
    (select snapshot || jsonb_build_object(
      'authorization', (snapshot -> 'authorization') || jsonb_build_object(
        'status', 'failed', 'reconciliationRequired', false, 'retrySafe', false
      )
    ) from pending_authorization_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status',
  'conflict',
  'a duplicate independent reconciliation query cannot reapply terminal evidence'
);
reset role;
select results_eq(
  $$select
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)$$,
  $$values (0::integer, 0::integer)$$,
  'definite non-execution creates neither a Request nor a product Pending Hold'
);
rollback to savepoint independent_reconciliation;

set local role service_role;
select lives_ok(
  format(
    'select public.begin_booking_request_authorization_claim(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from pending_authorization_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'the internal Authorization Claim and pending Payment Lifecycle are created atomically'
);
reset role;
select is(
  (select reconciliation_expires_at - created_at
    from public.booking_request_authorization_claims),
  interval '5 minutes',
  'unfinished pre-finalization work has an exact five-minute recovery window'
);
savepoint claimed_preparation_null_snapshot;
update public.booking_request_submission_attempts
set state='authorizing', payment_snapshot=null
where id=(select (result->>'attemptId')::uuid from prepared_submission);
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
do $fixture$
declare result jsonb;
begin
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result:=public.set_marketplace_suspension('customer','00000000-0000-0000-0000-000000003202','suspend',0,'Fictional hostile claim probe',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Hostile claim fixture suspension failed: %',result; end if;
end;
$fixture$;
create temporary table claimed_null_snapshot_before as select pg_temp.booking_submission_graph() record;
select is(public.retire_unusable_prepared_booking_request_submission(
  (select (result->>'attemptId')::uuid from prepared_submission)),false,
  'restriction_stale_preparation_replacement: a real claim protects hostile null snapshot preparation');
select is(pg_temp.booking_submission_graph(),(select record from claimed_null_snapshot_before),
  'claimed null snapshot refusal preserves exact attempt claim outbox occupancy operation request hold link and history');
rollback to savepoint claimed_preparation_null_snapshot;

savepoint claim_started_replacement_guard;
create temporary table claim_started_history_before as select jsonb_build_object(
  'booking_request_submission_attempts',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_submission_attempts rows),
  'booking_request_authorization_claims',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_authorization_claims rows),
  'payment_provider_operations',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.payment_provider_operations rows),
  'cottage_booking_period_commitments',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.cottage_booking_period_commitments rows),
  'booking_request_payment_history',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_payment_history rows),
  'booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_requests rows),
  'messaging_conversation_booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.messaging_conversation_booking_requests rows)
) record;
create temporary table claim_started_replacement as
select submission || jsonb_build_object(
  'discoveryQuery', '{"from":"2099-08-22","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-22","kind":"shift","position":2}]}'::jsonb,
  'quoteFingerprint', quote->>'quoteFingerprint',
  'contentVersion', quote->'contentVersion', 'termsVersion', quote->'termsVersion',
  'bookingPriceIqd', quote->'bookingPriceIqd', 'serviceFeeIqd', quote->'serviceFeeIqd',
  'customerTotalIqd', quote->'customerTotalIqd', 'firstStartsAt', quote#>>'{items,0,startsAt}'
) as submission
from journey_submission
cross join lateral (select public.get_public_booking_quote_with_fingerprint(
  'en', 'cottage-30000000000040008000000000003201', '{"from":"2099-08-22","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-22","kind":"shift","position":2}]}'::jsonb
) as quote) current_quote;
grant select on claim_started_replacement to service_role;
set local role service_role;
select is(public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202', '11111111-1111-4111-8111-111111113709', (select submission from claim_started_replacement)
)->>'status', 'invalid', 'claim started preparation cannot be replaced with a valid disjoint-day quote');
reset role;
select is(jsonb_build_object(
  'booking_request_submission_attempts',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_submission_attempts rows),
  'booking_request_authorization_claims',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_authorization_claims rows),
  'payment_provider_operations',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.payment_provider_operations rows),
  'cottage_booking_period_commitments',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.cottage_booking_period_commitments rows),
  'booking_request_payment_history',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_payment_history rows),
  'booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_requests rows),
  'messaging_conversation_booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.messaging_conversation_booking_requests rows)
), (select record from claim_started_history_before),
  'claim started replacement refusal preserves the exact attempt, claim, provider, request, hold, link and payment history');
rollback to savepoint claim_started_replacement_guard;

create temporary table simulated_authorization_operation as
select jsonb_build_object(
  'providerIdentity', jsonb_build_object(
    'provider', claims.provider,
    'environment', claims.environment,
    'merchantId', claims.merchant_id,
    'terminalId', claims.terminal_id
  ),
  'permitPurpose', 'booking-request-authorization',
  'idempotencyKey', claims.provider_idempotency_key,
  'notAfter', to_char(claims.not_after at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'requestFingerprint', repeat('a', 64),
  'paymentLifecycleId', claims.payment_lifecycle_id,
  'logicalOperationId', claims.logical_operation_id,
  'physicalAttemptId', claims.physical_attempt_id,
  'operationKind', 'authorization',
  'amountFils', claims.amount_fils,
  'currency', claims.currency,
  'claimId', claims.id,
  'claimGeneration', claims.generation,
  'stateRevision', null,
  'cleanupAttemptId', null,
  'workId', null,
  'leaseGeneration', null,
  'leaseToken', null,
  'operationId', null,
  'operationGeneration', null
) as operation
from public.booking_request_authorization_claims claims;
grant select on simulated_authorization_operation to service_role;

savepoint suspension_owner_issued;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
insert into public.owner_applications(id,owner_user_id,applicant_kind,legal_name,status,submitted_at,review_started_at,review_due_at)
values('20000000-0000-4000-8000-000000003290','00000000-0000-0000-0000-000000003201','individual','Fictional Admission Owner','submitted',now(),now(),now()+interval '72 hours');
insert into public.owner_verification_documents(id,application_id,kind,object_path,original_filename,media_type,size_bytes)
values('42000000-0000-4000-8000-000000003290','20000000-0000-4000-8000-000000003290','identity','fictional/pending/identity.pdf','identity.pdf','application/pdf',128);
update public.owner_verification_documents set content_digest=repeat('e',64),digest_source='sha256' where id='42000000-0000-4000-8000-000000003290';
select public.review_owner_application('20000000-0000-4000-8000-000000003290',1,'approve','Fictional content-bound evidence accepted','{}','{}','Baghdad','licence','Fictional licence',jsonb_build_object('identity',(current_date+365)::text));
select lives_ok($test$
do $body$
declare target_attempt uuid := (select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
declare operation jsonb := (select original.operation from simulated_authorization_operation original);
declare original_attempt jsonb;
declare original_graph jsonb;
declare original_claim jsonb;
declare original_revisions jsonb;
declare result jsonb;
declare denied boolean;
begin
  original_revisions:=(select jsonb_build_array(attempts.customer_suspension_revision,attempts.owner_suspension_revision,attempts.cottage_suspension_revision) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt);
  if not public.owner_can_start_new_business('00000000-0000-0000-0000-000000003201')
    or not public.is_cottage_publicly_discoverable('30000000-0000-4000-8000-000000003201')
  then raise exception 'Restoration did not restore ordinary owner/cottage eligibility'; end if;
  select to_jsonb(attempts) into strict original_attempt from public.booking_request_submission_attempts attempts where attempts.id=target_attempt;
  select to_jsonb(claims) into strict original_claim from public.booking_request_authorization_claims claims where claims.attempt_id=target_attempt;
  original_graph:=pg_temp.booking_submission_graph();
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result:=public.set_marketplace_suspension('owner','00000000-0000-0000-0000-000000003201','suspend',2,'Fictional direct admission restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension failed: %',result; end if;
  result:=public.begin_booking_request_authorization_claim(target_attempt,(select payments.snapshot from pending_authorization_payment payments),operation->'providerIdentity');
  if result->>'status' is distinct from 'quote-stale' then raise exception 'Issued claim revived after owner transition: %',result; end if;
  denied:=false;
  perform set_config('role','service_role',true);
  begin
    result:=public.admit_booking_request_provider_operation(operation);
  exception when sqlstate 'RC409' then denied:=true;
  end;
  perform set_config('role','none',true);
  if not denied then raise exception 'Direct authorization admission bypassed owner suspension: %',result; end if;
  result:=public.set_marketplace_suspension('owner','00000000-0000-0000-0000-000000003201','reactivate',3,'Prospective direct admission restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Reactivation failed: %',result; end if;
  if not public.owner_can_start_new_business('00000000-0000-0000-0000-000000003201')
    or not public.is_cottage_publicly_discoverable('30000000-0000-4000-8000-000000003201')
  then raise exception 'Restoration did not restore ordinary owner/cottage eligibility'; end if;
  if (select jsonb_build_array(customer.customer_suspension_revision,owner_context.owner_suspension_revision,profiles.suspension_revision)
      from public.booking_request_submission_attempts attempts
      join public.account_contexts customer on customer.user_id=attempts.customer_user_id
      join public.owner_application_cottage_profiles profiles on profiles.id=attempts.profile_id
      join public.account_contexts owner_context on owner_context.user_id=profiles.owner_user_id
      where attempts.id=target_attempt)
      is distinct from jsonb_set(original_revisions,'{1}',to_jsonb((original_revisions->>1)::bigint+2))
  then raise exception 'owner restoration did not isolate exactly its changed revision'; end if;
  result:=public.begin_booking_request_authorization_claim(target_attempt,(select payments.snapshot from pending_authorization_payment payments),operation->'providerIdentity');
  if result->>'status' is distinct from 'quote-stale' then raise exception 'Issued claim revived after owner transition: %',result; end if;
  denied:=false;
  perform set_config('role','service_role',true);
  begin
    result:=public.admit_booking_request_provider_operation(operation);
  exception when sqlstate 'RC409' then denied:=true;
  end;
  perform set_config('role','none',true);
  if not denied then raise exception 'Direct authorization admission revived old owner revision: %',result; end if;
  perform set_config('role','service_role',true);
  result:=public.prepare_booking_request_submission('00000000-0000-0000-0000-000000003202','11111111-1111-4111-8111-111111113201',(select journey.submission from journey_submission journey));
  perform set_config('role','none',true);
  if result->>'status' is distinct from 'reconciliation-required' then raise exception 'Issued snapshot recovery was hidden: %',result; end if;
  if (select to_jsonb(attempts) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt) is distinct from original_attempt
    or (select to_jsonb(claims) from public.booking_request_authorization_claims claims where claims.attempt_id=target_attempt) is distinct from original_claim
    or exists(select 1 from public.payment_provider_operations)
    or exists(select 1 from public.booking_requests)
    or exists(select 1 from public.cottage_booking_period_commitments)
  then raise exception 'Denied direct admission changed original attempt, claim or created provider/request/hold rows'; end if;
  if (select jsonb_build_array(attempts.customer_suspension_revision,attempts.owner_suspension_revision,attempts.cottage_suspension_revision) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt) is distinct from original_revisions then raise exception 'owner issued rebased stored attempt revisions'; end if;
  if public.retire_unusable_prepared_booking_request_submission(target_attempt)
    or pg_temp.booking_submission_graph() is distinct from original_graph
  then raise exception 'Issued claim refusal changed attempt snapshot claim occupancy operation outbox or financial history'; end if;

end;
$body$;
$test$,'suspension_fences_prepared_and_issued_authorizations: owner issued restoration');
rollback to savepoint suspension_owner_issued;

savepoint suspension_cottage_issued;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
insert into public.owner_applications(id,owner_user_id,applicant_kind,legal_name,status,submitted_at,review_started_at,review_due_at)
values('20000000-0000-4000-8000-000000003290','00000000-0000-0000-0000-000000003201','individual','Fictional Admission Owner','submitted',now(),now(),now()+interval '72 hours');
insert into public.owner_verification_documents(id,application_id,kind,object_path,original_filename,media_type,size_bytes)
values('42000000-0000-4000-8000-000000003290','20000000-0000-4000-8000-000000003290','identity','fictional/pending/identity.pdf','identity.pdf','application/pdf',128);
update public.owner_verification_documents set content_digest=repeat('e',64),digest_source='sha256' where id='42000000-0000-4000-8000-000000003290';
select public.review_owner_application('20000000-0000-4000-8000-000000003290',1,'approve','Fictional content-bound evidence accepted','{}','{}','Baghdad','licence','Fictional licence',jsonb_build_object('identity',(current_date+365)::text));
select lives_ok($test$
do $body$
declare target_attempt uuid := (select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
declare operation jsonb := (select original.operation from simulated_authorization_operation original);
declare original_attempt jsonb;
declare original_graph jsonb;
declare original_claim jsonb;
declare original_revisions jsonb;
declare result jsonb;
declare denied boolean;
begin
  original_revisions:=(select jsonb_build_array(attempts.customer_suspension_revision,attempts.owner_suspension_revision,attempts.cottage_suspension_revision) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt);
  if not public.owner_can_start_new_business('00000000-0000-0000-0000-000000003201')
    or not public.is_cottage_publicly_discoverable('30000000-0000-4000-8000-000000003201')
  then raise exception 'Restoration did not restore ordinary owner/cottage eligibility'; end if;
  select to_jsonb(attempts) into strict original_attempt from public.booking_request_submission_attempts attempts where attempts.id=target_attempt;
  select to_jsonb(claims) into strict original_claim from public.booking_request_authorization_claims claims where claims.attempt_id=target_attempt;
  original_graph:=pg_temp.booking_submission_graph();
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result:=public.set_marketplace_suspension('cottage','30000000-0000-4000-8000-000000003201','suspend',0,'Fictional direct admission restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension failed: %',result; end if;
  result:=public.begin_booking_request_authorization_claim(target_attempt,(select payments.snapshot from pending_authorization_payment payments),operation->'providerIdentity');
  if result->>'status' is distinct from 'quote-stale' then raise exception 'Issued claim revived after cottage transition: %',result; end if;
  denied:=false;
  perform set_config('role','service_role',true);
  begin
    result:=public.admit_booking_request_provider_operation(operation);
  exception when sqlstate 'RC409' then denied:=true;
  end;
  perform set_config('role','none',true);
  if not denied then raise exception 'Direct authorization admission bypassed cottage suspension: %',result; end if;
  result:=public.set_marketplace_suspension('cottage','30000000-0000-4000-8000-000000003201','reactivate',1,'Prospective direct admission restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Reactivation failed: %',result; end if;
  if not public.owner_can_start_new_business('00000000-0000-0000-0000-000000003201')
    or not public.is_cottage_publicly_discoverable('30000000-0000-4000-8000-000000003201')
  then raise exception 'Restoration did not restore ordinary owner/cottage eligibility'; end if;
  if (select jsonb_build_array(customer.customer_suspension_revision,owner_context.owner_suspension_revision,profiles.suspension_revision)
      from public.booking_request_submission_attempts attempts
      join public.account_contexts customer on customer.user_id=attempts.customer_user_id
      join public.owner_application_cottage_profiles profiles on profiles.id=attempts.profile_id
      join public.account_contexts owner_context on owner_context.user_id=profiles.owner_user_id
      where attempts.id=target_attempt)
      is distinct from jsonb_set(original_revisions,'{2}',to_jsonb((original_revisions->>2)::bigint+2))
  then raise exception 'cottage restoration did not isolate exactly its changed revision'; end if;
  result:=public.begin_booking_request_authorization_claim(target_attempt,(select payments.snapshot from pending_authorization_payment payments),operation->'providerIdentity');
  if result->>'status' is distinct from 'quote-stale' then raise exception 'Issued claim revived after cottage transition: %',result; end if;
  denied:=false;
  perform set_config('role','service_role',true);
  begin
    result:=public.admit_booking_request_provider_operation(operation);
  exception when sqlstate 'RC409' then denied:=true;
  end;
  perform set_config('role','none',true);
  if not denied then raise exception 'Direct authorization admission revived old cottage revision: %',result; end if;
  perform set_config('role','service_role',true);
  result:=public.prepare_booking_request_submission('00000000-0000-0000-0000-000000003202','11111111-1111-4111-8111-111111113201',(select journey.submission from journey_submission journey));
  perform set_config('role','none',true);
  if result->>'status' is distinct from 'reconciliation-required' then raise exception 'Issued snapshot recovery was hidden: %',result; end if;
  if (select to_jsonb(attempts) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt) is distinct from original_attempt
    or (select to_jsonb(claims) from public.booking_request_authorization_claims claims where claims.attempt_id=target_attempt) is distinct from original_claim
    or exists(select 1 from public.payment_provider_operations)
    or exists(select 1 from public.booking_requests)
    or exists(select 1 from public.cottage_booking_period_commitments)
  then raise exception 'Denied direct admission changed original attempt, claim or created provider/request/hold rows'; end if;
  if (select jsonb_build_array(attempts.customer_suspension_revision,attempts.owner_suspension_revision,attempts.cottage_suspension_revision) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt) is distinct from original_revisions then raise exception 'cottage issued rebased stored attempt revisions'; end if;
  if public.retire_unusable_prepared_booking_request_submission(target_attempt)
    or pg_temp.booking_submission_graph() is distinct from original_graph
  then raise exception 'Issued claim refusal changed attempt snapshot claim occupancy operation outbox or financial history'; end if;

end;
$body$;
$test$,'suspension_fences_prepared_and_issued_authorizations: cottage issued restoration');
rollback to savepoint suspension_cottage_issued;

savepoint suspension_direct_admission;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select lives_ok($test$
do $body$
declare target_attempt uuid := (select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
declare operation jsonb := (select original.operation from simulated_authorization_operation original);
declare original_attempt jsonb;
declare original_graph jsonb;
declare original_claim jsonb;
declare result jsonb;
declare denied boolean;
begin
  select to_jsonb(attempts) into strict original_attempt from public.booking_request_submission_attempts attempts where attempts.id=target_attempt;
  select to_jsonb(claims) into strict original_claim from public.booking_request_authorization_claims claims where claims.attempt_id=target_attempt;
  original_graph:=pg_temp.booking_submission_graph();
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result:=public.set_marketplace_suspension('customer','00000000-0000-0000-0000-000000003202','suspend',0,'Fictional direct admission restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension failed: %',result; end if;
  denied:=false;
  perform set_config('role','service_role',true);
  begin
    result:=public.admit_booking_request_provider_operation(operation);
  exception when sqlstate 'RC409' then denied:=true;
  end;
  perform set_config('role','none',true);
  if not denied then raise exception 'Direct authorization admission bypassed customer suspension: %',result; end if;
  result:=public.set_marketplace_suspension('customer','00000000-0000-0000-0000-000000003202','reactivate',1,'Prospective direct admission restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Reactivation failed: %',result; end if;
  denied:=false;
  perform set_config('role','service_role',true);
  begin
    result:=public.admit_booking_request_provider_operation(operation);
  exception when sqlstate 'RC409' then denied:=true;
  end;
  perform set_config('role','none',true);
  if not denied then raise exception 'Direct authorization admission revived old customer revision: %',result; end if;
  if (select to_jsonb(attempts) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt) is distinct from original_attempt
    or (select to_jsonb(claims) from public.booking_request_authorization_claims claims where claims.attempt_id=target_attempt) is distinct from original_claim
    or exists(select 1 from public.payment_provider_operations)
    or exists(select 1 from public.booking_requests)
    or exists(select 1 from public.cottage_booking_period_commitments)
  then raise exception 'Denied direct admission changed original attempt, claim or created provider/request/hold rows'; end if;
  if public.retire_unusable_prepared_booking_request_submission(target_attempt)
    or pg_temp.booking_submission_graph() is distinct from original_graph
  then raise exception 'Issued claim refusal changed attempt snapshot claim occupancy operation outbox or financial history'; end if;

end;
$body$;
$test$,'suspension_fences_prepared_and_issued_authorizations: direct authorization admission');
rollback to savepoint suspension_direct_admission;


savepoint suspension_inflight_authorization;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select lives_ok($test$
do $body$
declare target_attempt uuid := (select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
declare operation jsonb := (select original.operation from simulated_authorization_operation original);
declare snapshot jsonb := (select payments.snapshot from authorized_payment payments);
declare original_attempt jsonb;
declare original_graph jsonb;
declare original_operations jsonb;
declare original_history jsonb;
declare admission jsonb;
declare observation jsonb;
declare result jsonb;
declare permit jsonb;
declare denied boolean:=false;
begin
  select to_jsonb(attempts) into strict original_attempt from public.booking_request_submission_attempts attempts where attempts.id=target_attempt;
  perform set_config('role','service_role',true);
  admission:=public.admit_booking_request_provider_operation(operation);
  perform set_config('role','none',true);
  if admission->>'mode' is distinct from 'execute' then raise exception 'Inflight fixture was not admitted: %',admission; end if;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result:=public.set_marketplace_suspension('customer','00000000-0000-0000-0000-000000003202','suspend',0,'Fictional inflight restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Inflight suspension failed: %',result; end if;
  perform set_config('role','service_role',true);
  result:=public.admit_booking_request_provider_operation(operation);
  if result->>'operationId' is distinct from admission->>'operationId' or result->>'mode' is distinct from 'reconcile'
  then raise exception 'Existing admitted operation was hidden or readmitted: %',result; end if;
  observation:=pg_temp.payment_fixture_result(admission,'succeeded');
  if observation->>'outcome' is distinct from 'succeeded' then raise exception 'Inflight observation was lost: %',observation; end if;
  result:=pg_temp.payment_query(operation,null,null,'succeeded');
  if result is distinct from observation then raise exception 'Inflight authorization was not exactly reconcilable: %',result; end if;
  snapshot:=snapshot||jsonb_build_object(
    'authorization',(snapshot->'authorization')||jsonb_build_object(
      'providerRequestId',observation->>'providerRequestId','providerReference',observation->>'providerReference','movementReference',observation->>'movementReference'),
    'movements',jsonb_build_array(jsonb_build_object('kind','authorization',
      'logicalOperationId',snapshot#>>'{authorization,logicalOperationId}',
      'attemptId',snapshot#>>'{authorization,attemptId}','amountFils',115000000,
      'movementReference',observation->>'movementReference','recordedAt',clock_timestamp())));
  perform public.save_booking_request_payment_snapshot(target_attempt,snapshot,operation->'providerIdentity');
  result:=public.prepare_booking_request_submission('00000000-0000-0000-0000-000000003202','11111111-1111-4111-8111-111111113201',(select journey.submission from journey_submission journey));
  if result->>'status' is distinct from 'ready' or result->'paymentSnapshot' is distinct from snapshot
  then raise exception 'Restriction hid the admitted successful snapshot from cleanup: %',result; end if;
  perform set_config('role','none',true);
  select jsonb_agg(to_jsonb(operations) order by operations.id) into original_operations from public.payment_provider_operations operations;
  select jsonb_agg(to_jsonb(history) order by history.id) into original_history from public.booking_request_payment_history history;
  original_graph:=pg_temp.booking_submission_graph();
  begin
    result:=public.finalize_booking_request_submission(target_attempt,snapshot);
  exception when sqlstate 'RC409' then denied:=true;
  end;
  if not denied or public.lookup_booking_request_submission(target_attempt)->>'status' is distinct from 'absent'
    or (select jsonb_agg(to_jsonb(operations) order by operations.id) from public.payment_provider_operations operations) is distinct from original_operations
    or (select jsonb_agg(to_jsonb(history) order by history.id) from public.booking_request_payment_history history) is distinct from original_history
  then raise exception 'Inflight authorization created a request or lost authoritative evidence: %',result; end if;
  if public.retire_unusable_prepared_booking_request_submission(target_attempt)
    or pg_temp.booking_submission_graph() is distinct from original_graph
  then raise exception 'Admitted authorization refusal changed durable evidence or occupancy'; end if;
  perform set_config('role','service_role',true);
  result:=public.reload_booking_request_payment_operation(operation-array['permitPurpose','claimId','claimGeneration','notAfter','idempotencyKey','cleanupAttemptId','workId','leaseGeneration','leaseToken','stateRevision','operationId','operationGeneration'],null,null);
  if result->>'operationId' is distinct from original_operations->0->>'id'
  then raise exception 'Restricted admitted authorization is no longer queryable: %',result; end if;
  snapshot:=snapshot||jsonb_build_object('release',jsonb_build_object(
    'paymentLifecycleId',snapshot->>'paymentLifecycleId','kind','release',
    'logicalOperationId',(snapshot->>'paymentLifecycleId')||':release',
    'attemptId',(snapshot->>'paymentLifecycleId')||':release:attempt-1',
    'status','pending','amountFils',115000000,'providerRequestId',null,
    'providerReference',null,'movementReference',null,'reconciliationRequired',false,'retrySafe',false));
  result:=public.begin_booking_request_submission_cleanup_release(target_attempt,snapshot,operation->'providerIdentity');
  if result->>'status' is distinct from 'ready' then raise exception 'Restricted authorization cleanup is unreachable: %',result; end if;
  permit:=result->'executionPermit';
  result:=public.admit_booking_request_provider_operation(operation||jsonb_build_object(
    'permitPurpose',permit->>'purpose','idempotencyKey',permit->>'idempotencyKey',
    'notAfter',permit->>'notAfter','requestFingerprint',permit->>'requestFingerprint',
    'logicalOperationId',snapshot#>>'{release,logicalOperationId}',
    'physicalAttemptId',snapshot#>>'{release,attemptId}','operationKind','release',
    'claimId',permit->>'claimId','claimGeneration',permit->'generation',
    'stateRevision',permit->'stateRevision','cleanupAttemptId',permit->>'attemptId'));
  perform set_config('role','none',true);
  if result->>'mode' is distinct from 'execute'
    or (select count(*) from public.payment_provider_operations)<>2
    or exists(select 1 from public.booking_requests)
    or exists(select 1 from public.cottage_booking_period_commitments)
    or (select jsonb_build_array(attempts.customer_suspension_revision,attempts.owner_suspension_revision,attempts.cottage_suspension_revision)
      from public.booking_request_submission_attempts attempts where attempts.id=target_attempt)
      is distinct from jsonb_build_array(original_attempt->'customer_suspension_revision',original_attempt->'owner_suspension_revision',original_attempt->'cottage_suspension_revision')
  then raise exception 'Restricted cleanup was not admitted exactly or rewrote the attempt revisions: %',result; end if;
end;
$body$;
$test$,'suspension_fences_prepared_and_issued_authorizations: admitted authorization observed after restriction remains recoverable');
rollback to savepoint suspension_inflight_authorization;

savepoint provider_query_null_input_audit;
create temporary table provider_query_null_baseline as
select to_jsonb(claims) as claim_record,
  (select count(*)::integer from public.payment_provider_operations)
    as provider_count
from public.booking_request_authorization_claims claims;
create function pg_temp.assert_null_query_bindings_rejected(target_operation jsonb)
returns void
language plpgsql
as $$
declare required_key text;
declare invalid_operation jsonb;
begin
  foreach required_key in array array[
    'provider', 'environment', 'merchantId', 'terminalId'
  ] loop
    invalid_operation := jsonb_set(
      target_operation, array['providerIdentity', required_key], 'null'::jsonb
    );
    begin
      perform pg_temp.payment_query(
        invalid_operation, null, null, 'succeeded'
      );
      raise exception 'provider query accepted null binding %', required_key
        using errcode = 'P0001';
    exception when sqlstate '22023' or sqlstate 'RC409' then null;
    end;
  end loop;
  foreach required_key in array array[
    'requestFingerprint', 'paymentLifecycleId', 'logicalOperationId',
    'physicalAttemptId', 'operationKind', 'amountFils', 'currency'
  ] loop
    invalid_operation := jsonb_set(
      target_operation, array[required_key], 'null'::jsonb
    );
    begin
      perform pg_temp.payment_query(
        invalid_operation, null, null, 'succeeded'
      );
      raise exception 'provider query accepted null binding %', required_key
        using errcode = 'P0001';
    exception when sqlstate '22023' or sqlstate 'RC409' then null;
    end;
  end loop;
end;
$$;
create function pg_temp.assert_query_objects_rejected(target_operation jsonb)
returns void
language plpgsql
as $$
begin
  begin
    perform pg_temp.payment_query(
      null, null, null, 'succeeded'
    );
    raise exception 'provider query accepted SQL null operation' using errcode='P0001';
  exception when sqlstate '22023' or sqlstate 'RC409' then null;
  end;
  begin
    perform pg_temp.payment_query(
      'null'::jsonb, null, null, 'succeeded'
    );
    raise exception 'provider query accepted JSON null operation' using errcode='P0001';
  exception when sqlstate '22023' or sqlstate 'RC409' then null;
  end;
  begin
    perform pg_temp.payment_query(
      jsonb_set(target_operation, '{providerIdentity}', 'null'::jsonb),
      null, null, 'succeeded'
    );
    raise exception 'provider query accepted JSON null provider' using errcode='P0001';
  exception when sqlstate '22023' or sqlstate 'RC409' then null;
  end;
end;
$$;
grant select on provider_query_null_baseline to service_role;
set local role service_role;
select lives_ok(
  format(
    'select pg_temp.assert_null_query_bindings_rejected(%L::jsonb)',
    (select operation::text from simulated_authorization_operation)
  ),
  'provider query rejects every required authorization binding when JSON null'
);
select lives_ok(
  format(
    'select pg_temp.assert_query_objects_rejected(%L::jsonb)',
    (select operation::text from simulated_authorization_operation)
  ),
  'provider inquiry rejects null operation and provider object inputs'
);
reset role;
select results_eq(
  $$select to_jsonb(claims) = baseline.claim_record,
      (select count(*)::integer from public.payment_provider_operations)
        = baseline.provider_count
    from provider_query_null_baseline baseline
    join public.booking_request_authorization_claims claims
      on claims.id = (baseline.claim_record ->> 'id')::uuid$$,
  $$values (true, true)$$,
  'invalid provider queries mutate neither authorization state nor provider ledger'
);
rollback to savepoint provider_query_null_input_audit;

savepoint absent_execution_expires;
update public.booking_request_submission_attempts
set state = 'reconciliation_required',
  payment_snapshot = (select snapshot from pending_authorization_payment),
  authorization_provider_request_id = null,
  authorization_provider_reference = null,
  authorization_movement_reference = null;
update public.booking_request_authorization_claims
set state = 'reconciliation_required',
  reconciliation_expires_at = clock_timestamp() - interval '1 second',
  state_revision = state_revision + 1;
update public.booking_request_authorization_reconciliation_outbox
set state = 'pending', observed_state_revision = (
    select state_revision from public.booking_request_authorization_claims
  ), lease_token = null, lease_expires_at = null;
set local role service_role;
select is(
  public.expire_booking_request_authorization_claims(),
  1,
  'an expired claim without any provider admission is safely terminalized'
);
reset role;
select results_eq(
  $$select attempts.state, claims.state::text, occupancies.active, outbox.state,
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('expired'::text, 'expired'::text, false, 'complete'::text,
    0::integer, 0::integer)$$,
  'an evidenced unexecuted expiry frees inventory without creating product records'
);
create temporary table expired_reconciliation_baseline on commit drop as
select attempts.id as attempt_id,
    attempts.state as attempt_state,
    attempts.payment_snapshot,
    attempts.updated_at as attempt_updated_at,
    claims.state as claim_state,
    claims.state_revision as claim_state_revision,
    claims.updated_at as claim_updated_at,
    outbox.state as outbox_state,
    outbox.observed_state_revision,
    outbox.lease_token,
    outbox.lease_expires_at,
    outbox.updated_at as outbox_updated_at
  from public.booking_request_submission_attempts attempts
  join public.booking_request_authorization_claims claims
    on claims.attempt_id = attempts.id
  join public.booking_request_authorization_reconciliation_outbox outbox
    on outbox.claim_id = claims.id;
grant select on expired_reconciliation_baseline to service_role;
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    (select attempt_id from expired_reconciliation_baseline),
    (select payment_snapshot::text from expired_reconciliation_baseline),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'RC409', null,
  'an identical stale reconciliation snapshot cannot regress an expired attempt'
);
select public.mark_booking_request_reconciliation_required(
  (select attempt_id from expired_reconciliation_baseline)
);
reset role;
select results_eq(
  $$select attempts.state, attempts.payment_snapshot, attempts.updated_at,
      claims.state, claims.state_revision, claims.updated_at,
      outbox.state, outbox.observed_state_revision,
      outbox.lease_token, outbox.lease_expires_at, outbox.updated_at
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$select attempt_state, payment_snapshot, attempt_updated_at,
      claim_state, claim_state_revision, claim_updated_at,
      outbox_state, observed_state_revision,
      lease_token, lease_expires_at, outbox_updated_at
    from expired_reconciliation_baseline$$,
  'stale same-snapshot save and marker preserve expired payment, claim, audit, and outbox state'
);
select is(
  public.public_cottage_unit_is_available(
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003202', '2099-08-21'
  ),
  true,
  'authoritative absence restores public availability without a recovery runner'
);
rollback to savepoint absent_execution_expires;

create temporary table simulated_authorization_results (result jsonb);
grant select, insert on simulated_authorization_results to service_role;
set local role service_role;
insert into simulated_authorization_results
select pg_temp.payment_execute(
  (select operation from simulated_authorization_operation), 'indeterminate'
);
insert into simulated_authorization_results
select pg_temp.payment_execute(
  (select operation from simulated_authorization_operation), 'succeeded'
);
select results_eq(
  $$select count(*)::integer, count(distinct result ->> 'providerRequestId')::integer,
      count(distinct result ->> 'providerReference')::integer
    from simulated_authorization_results$$,
  $$values (2::integer, 1::integer, 1::integer)$$,
  'fresh callers receive the same fictional provider identity for one idempotency key'
);
reset role;
select results_eq(
  $$select count(*)::integer, sum((select effects.physical_execution_count from public.simulated_payment_effects effects where effects.operation_id=payment_provider_operations.id))::integer
    from public.payment_provider_operations$$,
  $$values (1::integer, 1::integer)$$,
  'the durable ledger records exactly one physical fictional authorization'
);
set local role service_role;
select is(
  pg_temp.payment_query(
    (select operation from simulated_authorization_operation),
    (select result ->> 'providerRequestId'
      from simulated_authorization_results limit 1),
    (select result ->> 'providerReference'
      from simulated_authorization_results limit 1),
    'succeeded'
  ) ->> 'outcome',
  'succeeded',
  'reconciliation resolves the same physical fictional authorization'
);
select is(
  pg_temp.payment_query(
    (select operation from simulated_authorization_operation),
    null,
    null,
    'succeeded'
  ) ->> 'outcome',
  'succeeded',
  'reconciliation discovers the immutable operation when a crash lost provider identifiers'
);
select throws_ok(
  $$select pg_temp.payment_query(
    jsonb_set((select operation from simulated_authorization_operation),
      '{requestFingerprint}',to_jsonb(repeat('c',64))),null,null,'succeeded')$$,
  'RC409',null,
  'inquiry rejects a mismatched fingerprint without fabricating absence'
);
select throws_ok(
  format(
    'select pg_temp.payment_execute(%L::jsonb, %L)',
    (select jsonb_set(operation, '{requestFingerprint}', to_jsonb(repeat('b', 64)))::text
      from simulated_authorization_operation),
    'succeeded'
  ),
  'RC409', null,
  'reusing an idempotency key with a different request fingerprint fails closed'
);
reset role;
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_provider_operations'
      and column_name in (
        'customer_user_id', 'customer_name', 'phone', 'booking_note',
        'profile_id', 'public_slug', 'quote_payload', 'intent_payload'
      )
  ),
  'the fictional provider ledger has no personal or cottage data columns'
);
set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    (select submission from journey_submission)
  ) ->> 'status',
  'reconciliation-required',
  'refresh after a potentially sent claim delegates recovery to the independent outbox'
);
select lives_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from authorized_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'the exact successful Payment Lifecycle snapshot is persisted before finalization'
);
reset role;
select is(
  (select state from public.booking_request_authorization_claims),
  'authorized',
  'successful authorization advances the same durable claim'
);
select results_eq(
  $$select count(*)::integer,
      count(*) filter (where active)::integer
    from public.booking_request_authorization_claim_occupancies$$,
  $$values (1::integer, 1::integer)$$,
  'one private active occupancy protects the selected Cottage Shift'
);
select is(
  (select state from public.booking_request_authorization_reconciliation_outbox),
  'pending',
  'independent reconciliation remains queued until conversion or definitive absence'
);

savepoint provider_started_replacement_guard;
create temporary table provider_started_history_before as select jsonb_build_object(
  'booking_request_submission_attempts',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_submission_attempts rows),
  'booking_request_authorization_claims',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_authorization_claims rows),
  'payment_provider_operations',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.payment_provider_operations rows),
  'cottage_booking_period_commitments',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.cottage_booking_period_commitments rows),
  'booking_request_payment_history',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_payment_history rows),
  'booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_requests rows),
  'messaging_conversation_booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.messaging_conversation_booking_requests rows)
) record;
create temporary table provider_started_replacement as
select submission || jsonb_build_object(
  'discoveryQuery', '{"from":"2099-08-22","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-22","kind":"shift","position":2}]}'::jsonb,
  'quoteFingerprint', quote->>'quoteFingerprint',
  'contentVersion', quote->'contentVersion', 'termsVersion', quote->'termsVersion',
  'bookingPriceIqd', quote->'bookingPriceIqd', 'serviceFeeIqd', quote->'serviceFeeIqd',
  'customerTotalIqd', quote->'customerTotalIqd', 'firstStartsAt', quote#>>'{items,0,startsAt}'
) as submission
from journey_submission
cross join lateral (select public.get_public_booking_quote_with_fingerprint(
  'en', 'cottage-30000000000040008000000000003201', '{"from":"2099-08-22","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-22","kind":"shift","position":2}]}'::jsonb
) as quote) current_quote;
grant select on provider_started_replacement to service_role;
set local role service_role;
select is(public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202', '11111111-1111-4111-8111-111111113709', (select submission from provider_started_replacement)
)->>'status', 'invalid', 'provider started preparation cannot be replaced with a valid disjoint-day quote');
reset role;
select is(jsonb_build_object(
  'booking_request_submission_attempts',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_submission_attempts rows),
  'booking_request_authorization_claims',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_authorization_claims rows),
  'payment_provider_operations',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.payment_provider_operations rows),
  'cottage_booking_period_commitments',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.cottage_booking_period_commitments rows),
  'booking_request_payment_history',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_payment_history rows),
  'booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_requests rows),
  'messaging_conversation_booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.messaging_conversation_booking_requests rows)
), (select record from provider_started_history_before),
  'provider started replacement refusal preserves the exact attempt, claim, provider, request, hold, link and payment history');
rollback to savepoint provider_started_replacement_guard;

savepoint authorized_after_cutoff_releases;
update public.booking_request_submission_attempts
set quote_payload = jsonb_set(
  quote_payload,
  '{items,0,startsAt}',
  to_jsonb(to_char(
    (clock_timestamp() + interval '5 hours') at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ))
);
update public.booking_request_authorization_claims
set reconciliation_expires_at = clock_timestamp() - interval '1 second';
update public.booking_request_authorization_reconciliation_outbox
set lease_token = gen_random_uuid(),
  lease_expires_at = clock_timestamp() + interval '30 seconds';
create temporary table cutoff_stale_lease as
select claims.id as claim_id, claims.generation, claims.state_revision,
  outbox.lease_token
from public.booking_request_authorization_claims claims
join public.booking_request_authorization_reconciliation_outbox outbox
  on outbox.claim_id = claims.id;
grant select on cutoff_stale_lease to service_role;
set local role service_role;
select lives_ok(
  $$select public.expire_booking_request_authorization_claims()$$,
  'expiry does not retry illegal finalization after the six-hour cut-off'
);
reset role;
select results_eq(
  $$select attempts.state, claims.state::text, occupancies.active, outbox.state,
      attempts.payment_snapshot -> 'release' ->> 'status',
      outbox.lease_token is null,
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('releasing'::text, 'releasing'::text, true, 'pending'::text,
    'pending'::text, true, 0::integer, 0::integer)$$,
  'cut-off expiry durably prepares a release while retaining inventory and product absence'
);
create temporary table cutoff_release_work as
select public.dequeue_booking_request_authorization_reconciliation() as result;
grant select on cutoff_release_work to service_role;
set local role service_role;
select results_eq(
  $$select result ->> 'status', result ->> 'operationKind',
      result ->> 'recoveryAction'
    from cutoff_release_work$$,
  $$values ('work'::text, 'release'::text, 'execute'::text)$$,
  'the independent worker discovers the cut-off release instead of finalization'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    (select claim_id from cutoff_stale_lease),
    (select generation from cutoff_stale_lease),
    (select state_revision from cutoff_stale_lease),
    (select lease_token from cutoff_stale_lease),
    (select snapshot from authorized_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status',
  'conflict',
  'a stale pre-cut-off lease cannot overwrite the durable release transition'
);
reset role;
rollback to savepoint authorized_after_cutoff_releases;

savepoint expired_pre_finalization_availability;
update public.booking_request_authorization_claims
set reconciliation_expires_at = clock_timestamp() - interval '1 second';
update public.booking_request_authorization_reconciliation_outbox
set lease_token = gen_random_uuid(),
  lease_expires_at = clock_timestamp() + interval '30 seconds';
create temporary table expiry_stale_lease as
select claims.id as claim_id, claims.generation, claims.state_revision,
  outbox.lease_token
from public.booking_request_authorization_claims claims
join public.booking_request_authorization_reconciliation_outbox outbox
  on outbox.claim_id = claims.id;
grant select on expiry_stale_lease to service_role;
set local role service_role;
select is(
  public.expire_booking_request_authorization_claims(),
  1,
  'the expiry boundary reconciles a succeeded durable authorization without the recovery runner'
);
reset role;
select is(
  public.public_cottage_unit_is_available(
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003202', '2099-08-21'
  ),
  false,
  'a reconciled authorization keeps inventory reserved through its Pending Hold'
);
-- A prepared statement outlives the savepoint rollbacks, so the later comparisons reuse it.
prepare inventory_units_from_helpers as
  with units as (
    select shifts.id as unit_id,
      'shift'::public.cottage_inventory_unit_kind as unit_kind,
      shifts.position, shifts.name, shifts.start_time, shifts.end_time
    from public.cottage_shifts shifts
    where shifts.schedule_revision_id = '60000000-0000-4000-8000-000000003201'
    union all
    select schedules.full_day_bundle_id,
      'full_day_bundle'::public.cottage_inventory_unit_kind,
      null::smallint, 'Full-day bundle'::text,
      (select shifts.start_time from public.cottage_shifts shifts
        where shifts.schedule_revision_id = schedules.id order by shifts.position limit 1),
      (select shifts.end_time from public.cottage_shifts shifts
        where shifts.schedule_revision_id = schedules.id order by shifts.position desc limit 1)
    from public.cottage_shift_schedule_revisions schedules
    where schedules.id = '60000000-0000-4000-8000-000000003201'
  )
  select days.service_day::date, units.unit_kind, units.position, units.name,
    units.start_time, units.end_time,
    public.public_cottage_effective_price(
      '60000000-0000-4000-8000-000000003201', units.unit_kind, units.unit_id,
      days.service_day::date
    ),
    coalesce(public.public_cottage_unit_is_available(
      '60000000-0000-4000-8000-000000003201', units.unit_kind, units.unit_id,
      days.service_day::date
    ), false)
  from generate_series(
    '2099-08-20'::timestamp, '2099-08-22'::timestamp, interval '1 day'
  ) days(service_day)
  cross join units;
select set_eq(
  $$select * from public.public_cottage_inventory_units(
    '60000000-0000-4000-8000-000000003201', '2099-08-20', '2099-08-22'
  )$$,
  'inventory_units_from_helpers',
  'set-based inventory unit rows match the unit helpers while a Pending Hold occupies the unit'
);
select results_eq(
  $$select attempts.state, claims.state::text, occupancies.active, outbox.state,
      outbox.lease_token is null, outbox.lease_expires_at is null,
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('finalized'::text, 'converted'::text, false, 'complete'::text,
    true, true, 1::integer, 1::integer)$$,
  'expiry finalizes exactly one authorized Request and Pending Hold while invalidating the stale lease'
);
set local role service_role;
select is(
  public.complete_booking_request_authorization_reconciliation(
    (select claim_id from expiry_stale_lease),
    (select generation from expiry_stale_lease),
    (select state_revision from expiry_stale_lease),
    (select lease_token from expiry_stale_lease),
    (select snapshot from authorized_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status',
  'conflict',
  'a stale recovery lease cannot overwrite ledger-driven expiry finalization'
);
reset role;
rollback to savepoint expired_pre_finalization_availability;

savepoint indeterminate_expiry_remains_protected;
delete from public.booking_request_provider_operation_identities;
update public.payment_provider_operations
set current_outcome = 'indeterminate';
update public.booking_request_submission_attempts
set state = 'reconciliation_required',
  payment_snapshot = (select snapshot from pending_authorization_payment),
  authorization_provider_request_id = null,
  authorization_provider_reference = null,
  authorization_movement_reference = null;
update public.booking_request_authorization_claims
set state = 'reconciliation_required',
  reconciliation_expires_at = clock_timestamp() - interval '1 second',
  state_revision = state_revision + 1;
update public.booking_request_authorization_reconciliation_outbox
set state = 'pending', observed_state_revision = (
    select state_revision from public.booking_request_authorization_claims
  ),
  lease_token = gen_random_uuid(),
  lease_expires_at = clock_timestamp() + interval '30 seconds';
set local role service_role;
select is(
  public.expire_booking_request_authorization_claims(),
  0,
  'expiry does not orphan an indeterminate durable provider movement'
);
reset role;
select results_eq(
  $$select claims.state::text, occupancies.active, outbox.state,
      outbox.lease_token is not null,
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)
    from public.booking_request_authorization_claims claims
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('reconciliation_required'::text, true, 'pending'::text,
    true, 0::integer, 0::integer)$$,
  'indeterminate ledger evidence remains recoverable and fail-closed'
);
rollback to savepoint indeterminate_expiry_remains_protected;



savepoint authorized_finalization_recovery;
create temporary table authorized_finalization_work (result jsonb);
grant select, insert on authorized_finalization_work to service_role;
set local role service_role;
insert into authorized_finalization_work
select public.dequeue_booking_request_authorization_reconciliation();
select results_eq(
  $$select result ->> 'status', result ->> 'operationKind',
      result -> 'paymentSnapshot' = (select snapshot from authorized_payment)
    from authorized_finalization_work$$,
  $$values ('work'::text, 'finalization'::text, true)$$,
  'an authorized claim remains recoverable through the independent outbox'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from authorized_finalization_work))::uuid,
    ((select result ->> 'generation' from authorized_finalization_work))::integer,
    ((select result ->> 'stateRevision' from authorized_finalization_work))::bigint,
    ((select result ->> 'leaseToken' from authorized_finalization_work))::uuid,
    (select snapshot from authorized_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'claimState',
  'converted',
  'authorized outbox recovery finalizes the request instead of reauthorizing'
);
reset role;
select results_eq(
  $$select count(*)::integer,
      (select count(*)::integer from public.cottage_booking_period_commitments),
      min(response_deadline - created_at)
    from public.booking_requests$$,
  $$values (1::integer, 1::integer, interval '4 hours')$$,
  'recovered finalization creates one Pending Hold for the four-hour owner deadline'
);
rollback to savepoint authorized_finalization_recovery;

savepoint lowered_search_limit_recovery;
select pg_temp.lower_search_admission_limit();
create temporary table lowered_limit_finalization_work (result jsonb);
grant select, insert on lowered_limit_finalization_work to service_role;
set local role service_role;
select throws_ok(
  format(
    'select public.get_public_booking_quote_with_fingerprint(''en'', ''cottage-30000000000040008000000000003201'', %L::jsonb)',
    (select search::text from submission_fixture)
  ),
  '22023', 'Public Cottage search input is invalid',
  'the lowered search limit refuses the authorized search as new input'
);
insert into lowered_limit_finalization_work
select public.dequeue_booking_request_authorization_reconciliation();
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from lowered_limit_finalization_work))::uuid,
    ((select result ->> 'generation' from lowered_limit_finalization_work))::integer,
    ((select result ->> 'stateRevision' from lowered_limit_finalization_work))::bigint,
    ((select result ->> 'leaseToken' from lowered_limit_finalization_work))::uuid,
    (select snapshot from authorized_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'claimState',
  'converted',
  'an authorized request admitted before the search limit was lowered completes recovery'
);
reset role;
select results_eq(
  $$select count(*)::integer,
      (select count(*)::integer from public.cottage_booking_period_commitments)
    from public.booking_requests$$,
  $$values (1::integer, 1::integer)$$,
  'recovery under the lowered search limit creates one Booking Request and one Pending Hold'
);
rollback to savepoint lowered_search_limit_recovery;

savepoint lost_release_response;
create temporary table pending_release_payment as
select snapshot || jsonb_build_object(
  'release', jsonb_build_object(
    'paymentLifecycleId', snapshot ->> 'paymentLifecycleId',
    'kind', 'release',
    'logicalOperationId', (snapshot ->> 'paymentLifecycleId') || ':release',
    'attemptId', (snapshot ->> 'paymentLifecycleId') || ':release:attempt-1',
    'status', 'pending', 'amountFils', 115000000,
    'providerRequestId', null, 'providerReference', null,
    'movementReference', null, 'reconciliationRequired', false,
    'retrySafe', false
  )
) as snapshot
from authorized_payment;
grant select on pending_release_payment to service_role;

savepoint cleanup_issuer_null_input_audit;
create temporary table cleanup_issuer_null_baseline as
select to_jsonb(attempts) as attempt_record, to_jsonb(claims) as claim_record,
  (select count(*)::integer
    from public.booking_request_authorization_reconciliation_outbox) as outbox_count,
  (select count(*)::integer from public.payment_provider_operations)
    as provider_count,
  (select count(*)::integer from public.booking_request_release_work) as work_count
from public.booking_request_submission_attempts attempts
join public.booking_request_authorization_claims claims
  on claims.attempt_id = attempts.id
where attempts.id = (
  select (result ->> 'attemptId')::uuid from prepared_submission
);
create function pg_temp.assert_null_cleanup_bindings_rejected(
  target_attempt_id uuid,
  target_snapshot jsonb,
  target_provider jsonb
)
returns void
language plpgsql
as $$
declare required_key text;
declare invalid_snapshot jsonb;
declare invalid_provider jsonb;
begin
  foreach required_key in array array[
    'paymentLifecycleId', 'kind', 'logicalOperationId', 'attemptId',
    'status', 'amountFils', 'reconciliationRequired', 'retrySafe'
  ] loop
    invalid_snapshot := jsonb_set(
      target_snapshot, array['release', required_key], 'null'::jsonb
    );
    begin
      perform public.begin_booking_request_submission_cleanup_release(
        target_attempt_id, invalid_snapshot, target_provider
      );
      raise exception 'cleanup issuer accepted null binding %', required_key
        using errcode = 'P0001';
    exception when sqlstate 'RC409' then null;
    end;
  end loop;
  foreach required_key in array array[
    'provider', 'environment', 'merchantId', 'terminalId'
  ] loop
    invalid_provider := jsonb_set(
      target_provider, array[required_key], 'null'::jsonb
    );
    begin
      perform public.begin_booking_request_submission_cleanup_release(
        target_attempt_id, target_snapshot, invalid_provider
      );
      raise exception 'cleanup issuer accepted null provider %', required_key
        using errcode = 'P0001';
    exception when sqlstate 'RC409' then null;
    end;
  end loop;
end;
$$;
create function pg_temp.assert_cleanup_objects_rejected(
  target_attempt_id uuid,
  target_snapshot jsonb,
  target_provider jsonb
)
returns void
language plpgsql
as $$
begin
  begin
    perform public.begin_booking_request_submission_cleanup_release(
      null, target_snapshot, target_provider
    );
    raise exception 'cleanup issuer accepted null attempt' using errcode='P0001';
  exception when sqlstate 'RC409' then null;
  end;
  begin
    perform public.begin_booking_request_submission_cleanup_release(
      target_attempt_id, 'null'::jsonb, target_provider
    );
    raise exception 'cleanup issuer accepted JSON null snapshot' using errcode='P0001';
  exception when sqlstate 'RC409' then null;
  end;
  begin
    perform public.begin_booking_request_submission_cleanup_release(
      target_attempt_id,
      jsonb_set(target_snapshot, '{release}', 'null'::jsonb), target_provider
    );
    raise exception 'cleanup issuer accepted JSON null release' using errcode='P0001';
  exception when sqlstate 'RC409' then null;
  end;
  begin
    perform public.begin_booking_request_submission_cleanup_release(
      target_attempt_id,
      jsonb_set(target_snapshot, '{authorization}', 'null'::jsonb), target_provider
    );
    raise exception 'cleanup issuer accepted JSON null authorization' using errcode='P0001';
  exception when sqlstate 'RC409' then null;
  end;
  begin
    perform public.begin_booking_request_submission_cleanup_release(
      target_attempt_id, target_snapshot, 'null'::jsonb
    );
    raise exception 'cleanup issuer accepted JSON null provider' using errcode='P0001';
  exception when sqlstate 'RC409' then null;
  end;
end;
$$;
grant select on cleanup_issuer_null_baseline to service_role;
set local role service_role;
select lives_ok(
  format(
    'select pg_temp.assert_null_cleanup_bindings_rejected(%L::uuid,%L::jsonb,%L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from pending_release_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'cleanup issuer rejects every required release and provider binding when JSON null'
);
select lives_ok(
  format(
    'select pg_temp.assert_cleanup_objects_rejected(%L::uuid,%L::jsonb,%L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from pending_release_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'cleanup issuer rejects null attempt, snapshot, payment operation, and provider objects'
);
reset role;
select results_eq(
  $$select to_jsonb(attempts) = baseline.attempt_record,
      to_jsonb(claims) = baseline.claim_record,
      (select count(*)::integer
        from public.booking_request_authorization_reconciliation_outbox)
        = baseline.outbox_count,
      (select count(*)::integer from public.payment_provider_operations)
        = baseline.provider_count,
      (select count(*)::integer from public.booking_request_release_work)
        = baseline.work_count
    from cleanup_issuer_null_baseline baseline
    join public.booking_request_submission_attempts attempts
      on attempts.id = (baseline.attempt_record ->> 'id')::uuid
    join public.booking_request_authorization_claims claims
      on claims.id = (baseline.claim_record ->> 'id')::uuid$$,
  $$values (true, true, true, true, true)$$,
  'invalid cleanup inputs mutate no attempt, claim, outbox, provider, or release work'
);
set local role service_role;
create temporary table cleanup_release_permit as
select public.begin_booking_request_submission_cleanup_release(
  ((select result ->> 'attemptId' from prepared_submission))::uuid,
  (select snapshot from pending_release_payment),
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as result;
grant select on cleanup_release_permit to service_role;
select is(
  (select result -> 'executionPermit' ->> 'purpose' from cleanup_release_permit),
  'booking-request-submission-cleanup',
  'a release that is about to execute is durably persisted with its cleanup permit'
);
create temporary table reissued_cleanup_release_permit as
select public.begin_booking_request_submission_cleanup_release(
  ((select result ->> 'attemptId' from prepared_submission))::uuid,
  (select snapshot from pending_release_payment),
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as result;
select is(
  (select result -> 'executionPermit' from reissued_cleanup_release_permit),
  (select result -> 'executionPermit' from cleanup_release_permit),
  'reissuing the same pending cleanup returns the byte-equivalent permit window'
);
reset role;
savepoint absent_release_evidence_expiry;
update public.booking_request_authorization_claims
set reconciliation_expires_at = clock_timestamp() - interval '1 second';
set local role service_role;
select is(
  public.expire_booking_request_authorization_claims(),
  0,
  'expiry retains a release whose durable provider execution is still absent'
);
reset role;
select results_eq(
  $$select attempts.state, claims.state::text, occupancies.active, outbox.state,
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('releasing'::text, 'releasing'::text, true, 'pending'::text,
    0::integer, 0::integer)$$,
  'absent release evidence keeps inventory and reconciliation work active'
);
rollback to savepoint absent_release_evidence_expiry;

savepoint failed_release_recovery;
create temporary table failed_release_operation as
select jsonb_build_object(
  'providerIdentity', jsonb_build_object(
    'provider', claims.provider,
    'environment', claims.environment,
    'merchantId', claims.merchant_id,
    'terminalId', claims.terminal_id
  ),
  'permitPurpose', permit.result -> 'executionPermit' ->> 'purpose',
  'idempotencyKey', permit.result -> 'executionPermit' ->> 'idempotencyKey',
  'requestFingerprint', permit.result -> 'executionPermit' ->> 'requestFingerprint',
  'notAfter', permit.result -> 'executionPermit' ->> 'notAfter',
  'paymentLifecycleId', claims.payment_lifecycle_id,
  'logicalOperationId', payments.snapshot -> 'release' ->> 'logicalOperationId',
  'physicalAttemptId', payments.snapshot -> 'release' ->> 'attemptId',
  'operationKind', 'release',
  'amountFils', claims.amount_fils,
  'currency', claims.currency,
  'claimId', permit.result -> 'executionPermit' ->> 'claimId',
  'claimGeneration', (permit.result -> 'executionPermit' ->> 'generation')::integer,
  'stateRevision', (permit.result -> 'executionPermit' ->> 'stateRevision')::bigint,
  'cleanupAttemptId', permit.result -> 'executionPermit' ->> 'attemptId',
  'workId', null, 'leaseGeneration', null, 'leaseToken', null,
  'operationId', null, 'operationGeneration', null
) as operation
from public.booking_request_authorization_claims claims
cross join pending_release_payment payments
cross join cleanup_release_permit permit;
grant select on failed_release_operation to service_role;
create temporary table failed_release_result (result jsonb);
grant select, insert on failed_release_result to service_role;
set local role service_role;
insert into failed_release_result
select pg_temp.payment_execute(
  (select operation from failed_release_operation), 'failed'
);
select results_eq(
  $$select result ->> 'outcome', (result ->> 'retrySafe')::boolean,
      result ? 'movementReference'
    from failed_release_result$$,
  $$values ('failed'::text, true, false)$$,
  'the local provider proves a definitive failed release safe for a fresh attempt'
);
create temporary table failed_release_work as
select public.dequeue_booking_request_authorization_reconciliation() as result;
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from failed_release_work))::uuid,
    ((select result ->> 'generation' from failed_release_work))::integer,
    ((select result ->> 'stateRevision' from failed_release_work))::bigint,
    ((select result ->> 'leaseToken' from failed_release_work))::uuid,
    (select snapshot || jsonb_build_object(
      'release', (snapshot -> 'release') || jsonb_build_object(
        'status', 'failed',
        'providerRequestId', provider.result ->> 'providerRequestId',
        'providerReference', provider.result ->> 'providerReference',
        'movementReference', null,
        'reconciliationRequired', false,
        'retrySafe', true
      )
    )
    from pending_release_payment
    cross join failed_release_result provider),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'claimState',
  'reconciliation_required',
  'a failed release remains active instead of terminalizing its authorization claim'
);
reset role;
select results_eq(
  $$select attempts.state, claims.state::text, occupancies.active, outbox.state,
      attempts.release_provider_request_id,
      count(operations.id) filter (where operations.operation_kind = 'release')::integer,
      count(operations.id) filter (where operations.operation_kind = 'release'
        and operations.current_outcome = 'failed')::integer
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id
    left join public.payment_provider_operations operations
      on operations.claim_id = claims.id
    group by attempts.state, claims.state, occupancies.active, outbox.state,
      attempts.release_provider_request_id$$,
  $$values ('reconciliation_required'::text, 'reconciliation_required'::text,
    true, 'pending'::text, null::text, 1::integer, 1::integer)$$,
  'failed release evidence is retained without freeing inventory or completing the outbox'
);
set local role service_role;
create temporary table first_release_retry_work as
select public.dequeue_booking_request_authorization_reconciliation() as result;
select results_eq(
  $$select result ->> 'status', result ->> 'operationKind',
      result ->> 'recoveryAction', result ->> 'physicalAttemptId',
      result -> 'paymentSnapshot' -> 'release' ->> 'status'
    from first_release_retry_work$$,
  $$values ('work'::text, 'release'::text, 'execute'::text,
    (select (snapshot -> 'release' ->> 'logicalOperationId') || ':attempt-2'
      from pending_release_payment), 'pending'::text)$$,
  'dequeue durably prepares exactly one fresh physical release attempt before execution'
);
reset role;
update public.booking_request_authorization_reconciliation_outbox
set lease_expires_at = clock_timestamp() - interval '1 second';
set local role service_role;
create temporary table recovered_release_retry_work as
select public.dequeue_booking_request_authorization_reconciliation() as result;
select results_eq(
  $$select recovered.result ->> 'physicalAttemptId',
      recovered.result ->> 'leaseToken' <> original.result ->> 'leaseToken'
    from recovered_release_retry_work recovered
    cross join first_release_retry_work original$$,
  $$values ((select result ->> 'physicalAttemptId' from first_release_retry_work), true)$$,
  'a crashed retry worker receives a new lease for the same persisted physical attempt'
);
create temporary table retry_cleanup_release_permit as
select public.begin_booking_request_submission_cleanup_release(
  ((select result ->> 'attemptId' from prepared_submission))::uuid,
  recovered.result -> 'paymentSnapshot',
  recovered.result -> 'providerIdentity'
) as result
from recovered_release_retry_work recovered;
select results_eq(
  $$select retry.result -> 'executionPermit' ->> 'purpose',
      retry.result -> 'executionPermit' ->> 'stateRevision'
        <> first.result -> 'executionPermit' ->> 'stateRevision',
      retry.result -> 'executionPermit' ->> 'idempotencyKey'
        <> first.result -> 'executionPermit' ->> 'idempotencyKey'
    from retry_cleanup_release_permit retry
    cross join cleanup_release_permit first$$,
  $$values ('booking-request-submission-cleanup'::text, true, true)$$,
  'a distinct cleanup retry receives a new revision-bound provider identity'
);
create temporary table successful_release_retry_result as
select pg_temp.payment_execute(
  jsonb_build_object(
    'providerIdentity', recovered.result -> 'providerIdentity',
    'permitPurpose', permit.result -> 'executionPermit' ->> 'purpose',
    'idempotencyKey', permit.result -> 'executionPermit' ->> 'idempotencyKey',
    'requestFingerprint', permit.result -> 'executionPermit' ->> 'requestFingerprint',
    'notAfter', permit.result -> 'executionPermit' ->> 'notAfter',
    'paymentLifecycleId', recovered.result ->> 'paymentLifecycleId',
    'logicalOperationId', recovered.result ->> 'logicalOperationId',
    'physicalAttemptId', recovered.result ->> 'physicalAttemptId',
    'operationKind', 'release',
    'amountFils', (recovered.result ->> 'amountFils')::bigint,
    'currency', recovered.result ->> 'currency',
    'claimId', permit.result -> 'executionPermit' ->> 'claimId',
    'claimGeneration',
      (permit.result -> 'executionPermit' ->> 'generation')::integer,
    'stateRevision',
      (permit.result -> 'executionPermit' ->> 'stateRevision')::bigint,
    'cleanupAttemptId', permit.result -> 'executionPermit' ->> 'attemptId',
    'workId', null, 'leaseGeneration', null, 'leaseToken', null,
    'operationId', null, 'operationGeneration', null
  ), 'succeeded'
) as result
from recovered_release_retry_work recovered
cross join retry_cleanup_release_permit permit;
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from first_release_retry_work))::uuid,
    ((select result ->> 'generation' from first_release_retry_work))::integer,
    ((select result ->> 'stateRevision' from first_release_retry_work))::bigint,
    ((select result ->> 'leaseToken' from first_release_retry_work))::uuid,
    (select result -> 'paymentSnapshot' from first_release_retry_work),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status',
  'conflict',
  'a stale release worker cannot overwrite the recovered retry lease'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from recovered_release_retry_work))::uuid,
    ((select result ->> 'generation' from recovered_release_retry_work))::integer,
    ((select result ->> 'stateRevision' from recovered_release_retry_work))::bigint,
    ((select result ->> 'leaseToken' from recovered_release_retry_work))::uuid,
    (select work.result -> 'paymentSnapshot' || jsonb_build_object(
      'release', (work.result -> 'paymentSnapshot' -> 'release') || jsonb_build_object(
        'status', 'succeeded',
        'providerRequestId', provider.result ->> 'providerRequestId',
        'providerReference', provider.result ->> 'providerReference',
        'movementReference', provider.result ->> 'movementReference',
        'reconciliationRequired', false,
        'retrySafe', false
      ),
      'movements', (work.result -> 'paymentSnapshot' -> 'movements') ||
        jsonb_build_array(jsonb_build_object(
          'kind', 'release',
          'logicalOperationId', work.result ->> 'logicalOperationId',
          'attemptId', work.result ->> 'physicalAttemptId',
          'amountFils', (work.result ->> 'amountFils')::bigint,
          'movementReference', provider.result ->> 'movementReference',
          'recordedAt', '2099-08-21T14:02:00.000Z'
        ))
    )
    from recovered_release_retry_work work
    cross join successful_release_retry_result provider),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'claimState',
  'released',
  'the recovered retry closes only after authoritative successful release evidence'
);
reset role;
select results_eq(
  $$select claims.state::text, occupancies.active, outbox.state,
      (select count(*)::integer from public.payment_provider_operations),
      (select count(*)::integer from public.payment_provider_operations
        where operation_kind = 'release' and current_outcome = 'failed'),
      (select count(*)::integer from public.payment_provider_operations
        where operation_kind = 'release' and current_outcome = 'succeeded')
    from public.booking_request_authorization_claims claims
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('released'::text, false, 'complete'::text,
    3::integer, 1::integer, 1::integer)$$,
  'successful retry frees inventory while retaining authorization and both release attempts'
);
rollback to savepoint failed_release_recovery;

savepoint ledger_evidenced_release_expiry;
create temporary table simulated_release_operation as
select jsonb_build_object(
  'providerIdentity', jsonb_build_object(
    'provider', claims.provider,
    'environment', claims.environment,
    'merchantId', claims.merchant_id,
    'terminalId', claims.terminal_id
  ),
  'permitPurpose', permit.result -> 'executionPermit' ->> 'purpose',
  'idempotencyKey', permit.result -> 'executionPermit' ->> 'idempotencyKey',
  'requestFingerprint', permit.result -> 'executionPermit' ->> 'requestFingerprint',
  'notAfter', permit.result -> 'executionPermit' ->> 'notAfter',
  'paymentLifecycleId', claims.payment_lifecycle_id,
  'logicalOperationId', payments.snapshot -> 'release' ->> 'logicalOperationId',
  'physicalAttemptId', payments.snapshot -> 'release' ->> 'attemptId',
  'operationKind', 'release',
  'amountFils', claims.amount_fils,
  'currency', claims.currency,
  'claimId', permit.result -> 'executionPermit' ->> 'claimId',
  'claimGeneration',
    (permit.result -> 'executionPermit' ->> 'generation')::integer,
  'stateRevision',
    (permit.result -> 'executionPermit' ->> 'stateRevision')::bigint,
  'cleanupAttemptId', permit.result -> 'executionPermit' ->> 'attemptId',
  'workId', null, 'leaseGeneration', null, 'leaseToken', null,
  'operationId', null, 'operationGeneration', null
) as operation
from public.booking_request_authorization_claims claims
cross join pending_release_payment payments
cross join cleanup_release_permit permit;
grant select on simulated_release_operation to service_role;
set local role service_role;
select lives_ok(
  format(
    'select pg_temp.payment_execute(%L::jsonb, %L)',
    (select operation::text from simulated_release_operation),
    'succeeded'
  ),
  'the fictional ledger records a definitive authorization release'
);
reset role;
update public.booking_request_authorization_claims
set reconciliation_expires_at = clock_timestamp() - interval '1 second';
update public.booking_request_authorization_reconciliation_outbox
set lease_token = gen_random_uuid(),
  lease_expires_at = clock_timestamp() + interval '30 seconds';
set local role service_role;
select is(
  public.expire_booking_request_authorization_claims(),
  1,
  'expiry frees inventory only after consulting definitive durable release evidence'
);
reset role;
select results_eq(
  $$select attempts.state, claims.state::text, occupancies.active, outbox.state,
      outbox.lease_token is null,
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments),
      (select count(*)::integer from public.payment_provider_operations)
    from public.booking_request_submission_attempts attempts
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('released'::text, 'released'::text, false, 'complete'::text,
    true, 0::integer, 0::integer, 2::integer)$$,
  'evidenced release preserves both ledger movements and creates no product records'
);
rollback to savepoint ledger_evidenced_release_expiry;
create temporary table lost_release_operation as
select jsonb_build_object(
  'providerIdentity', jsonb_build_object(
    'provider', claims.provider,
    'environment', claims.environment,
    'merchantId', claims.merchant_id,
    'terminalId', claims.terminal_id
  ),
  'permitPurpose', permit.result -> 'executionPermit' ->> 'purpose',
  'idempotencyKey', permit.result -> 'executionPermit' ->> 'idempotencyKey',
  'requestFingerprint', permit.result -> 'executionPermit' ->> 'requestFingerprint',
  'notAfter', permit.result -> 'executionPermit' ->> 'notAfter',
  'paymentLifecycleId', claims.payment_lifecycle_id,
  'logicalOperationId', payments.snapshot -> 'release' ->> 'logicalOperationId',
  'physicalAttemptId', payments.snapshot -> 'release' ->> 'attemptId',
  'operationKind', 'release',
  'amountFils', claims.amount_fils,
  'currency', claims.currency,
  'claimId', permit.result -> 'executionPermit' ->> 'claimId',
  'claimGeneration',
    (permit.result -> 'executionPermit' ->> 'generation')::integer,
  'stateRevision',
    (permit.result -> 'executionPermit' ->> 'stateRevision')::bigint,
  'cleanupAttemptId', permit.result -> 'executionPermit' ->> 'attemptId',
  'workId', null, 'leaseGeneration', null, 'leaseToken', null,
  'operationId', null, 'operationGeneration', null
) as operation
from public.booking_request_authorization_claims claims
cross join pending_release_payment payments
cross join cleanup_release_permit permit;
grant select on lost_release_operation to service_role;
create temporary table lost_release_result (result jsonb);
grant select, insert on lost_release_result to service_role;
set local role service_role;
insert into lost_release_result
select pg_temp.payment_execute(
  (select operation from lost_release_operation), 'indeterminate'
);
reset role;
create temporary table first_release_work (result jsonb);
grant select, insert on first_release_work to service_role;
set local role service_role;
insert into first_release_work
select public.dequeue_booking_request_authorization_reconciliation();
select is(
  (select (result ->> 'operationKind') || ':' || (result ->> 'recoveryAction')
    from first_release_work),
  'release:execute',
  'a lost response re-executes only the idempotent persisted release binding'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from first_release_work))::uuid,
    ((select result ->> 'generation' from first_release_work))::integer,
    ((select result ->> 'stateRevision' from first_release_work))::bigint,
    ((select result ->> 'leaseToken' from first_release_work))::uuid,
    (select snapshot || jsonb_build_object(
      'release', (snapshot -> 'release') || jsonb_build_object(
        'providerRequestId', provider.result ->> 'providerRequestId',
        'providerReference', provider.result ->> 'providerReference',
        'movementReference', provider.result ->> 'movementReference',
        'reconciliationRequired', true
      )
    ) from pending_release_payment
    cross join lost_release_result provider),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'claimState',
  'reconciliation_required',
  'an unknown release outcome retains its claim, occupancy, and reconciliation work'
);
reset role;
select results_eq(
  $$select claims.state::text, occupancies.active, outbox.state
    from public.booking_request_authorization_claims claims
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('reconciliation_required'::text, true, 'pending'::text)$$,
  'unknown release evidence cannot prematurely free the protected period'
);
create temporary table retried_release_work (result jsonb);
grant select, insert on retried_release_work to service_role;
set local role service_role;
insert into retried_release_work
select public.dequeue_booking_request_authorization_reconciliation();
select is(
  (select (result ->> 'operationKind') || ':' || (result ->> 'recoveryAction')
    from retried_release_work),
  'release:query',
  'a lost release response queries the durable release before any retry'
);
create temporary table reconciled_release_result (result jsonb);
grant select, insert on reconciled_release_result to service_role;
insert into reconciled_release_result
select pg_temp.payment_query(
  (select operation from lost_release_operation),
  (select result ->> 'providerRequestId' from lost_release_result),
  (select result ->> 'providerReference' from lost_release_result),
  'succeeded'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    ((select result ->> 'claimId' from retried_release_work))::uuid,
    ((select result ->> 'generation' from retried_release_work))::integer,
    ((select result ->> 'stateRevision' from retried_release_work))::bigint,
    ((select result ->> 'leaseToken' from retried_release_work))::uuid,
    (select snapshot || jsonb_build_object(
      'release', (snapshot -> 'release') || jsonb_build_object(
        'status', 'succeeded',
        'providerRequestId', provider.result ->> 'providerRequestId',
        'providerReference', provider.result ->> 'providerReference',
        'movementReference', provider.result ->> 'movementReference',
        'reconciliationRequired', false
      ),
      'movements', (snapshot -> 'movements') || jsonb_build_array(
        jsonb_build_object(
          'kind', 'release',
          'logicalOperationId', snapshot -> 'release' ->> 'logicalOperationId',
          'attemptId', snapshot -> 'release' ->> 'attemptId',
          'amountFils', 115000000,
          'movementReference', provider.result ->> 'movementReference',
          'recordedAt', '2099-08-21T14:01:00.000Z'
        )
      )
    ) from pending_release_payment
    cross join reconciled_release_result provider),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'claimState',
  'released',
  'a recovered successful release terminally closes the claim'
);
reset role;
select results_eq(
  $$select claims.state::text, occupancies.active, outbox.state,
      outbox.lease_token is null
    from public.booking_request_authorization_claims claims
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('released'::text, false, 'complete'::text, true)$$,
  'definitive release evidence deactivates claim, occupancy, lease, and outbox'
);
set local role service_role;
select is(
  public.dequeue_booking_request_authorization_reconciliation() ->> 'status',
  'empty',
  'terminal release evidence cannot be rediscovered or reauthorized'
);
reset role;
select is(
  public.public_cottage_unit_is_available(
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003202', '2099-08-21'
  ),
  true,
  'definitive release automatically restores public availability'
);
select results_eq(
  $$select
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)$$,
  $$values (0::integer, 0::integer)$$,
  'release reconciliation creates neither a Request nor a product Pending Hold'
);
rollback to savepoint lost_release_response;

select results_eq(
  $$select
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.cottage_booking_period_commitments)$$,
  $$values (0::integer, 0::integer)$$,
  'authorization claim and successful authorization create neither Request nor product Pending Hold'
);
create temporary table authorization_claim_observer as
select id, generation, state_revision
from public.booking_request_authorization_claims;
grant select on authorization_claim_observer to service_role;
select is(
  public.public_cottage_unit_is_available(
    '60000000-0000-4000-8000-000000003201', 'shift',
    '62000000-0000-4000-8000-000000003202', '2099-08-21'
  ),
  false,
  'the private claim removes its unit from public availability without becoming a product hold'
);
select set_eq(
  $$select * from public.public_cottage_inventory_units(
    '60000000-0000-4000-8000-000000003201', '2099-08-20', '2099-08-22'
  )$$,
  'inventory_units_from_helpers',
  'set-based inventory unit rows match the unit helpers while a live authorization claim occupies the unit'
);
set local role service_role;
select results_eq(
  $$select unit ->> 'calendarState', (unit ->> 'editable')::boolean,
      unit ->> 'commitmentReference'
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000003201',
      '60000000-0000-4000-8000-000000003201', '2099-08-21'
    ) -> 'units') unit
    where unit ->> 'id' = '62000000-0000-4000-8000-000000003202'$$,
  $$values ('unavailable'::text, false, null::text)$$,
  'owner calendar exposes only generic unavailability without private claim metadata'
);
select is(
  public.complete_booking_request_authorization_reconciliation(
    (select id from authorization_claim_observer),
    (select generation from authorization_claim_observer),
    0,
    gen_random_uuid(),
    (select snapshot from authorized_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) ->> 'status',
  'conflict',
  'stale reconciliation completion loses the claim state-revision compare-and-set'
);
select throws_ok(
  format(
    'select public.create_pending_booking_period_hold(%L::uuid, %L::uuid, %L, %L::jsonb)',
    '00000000-0000-0000-0000-000000003203',
    '30000000-0000-4000-8000-000000003201', 'RC-CLAIM-CONTENDER',
    (select (submission -> 'discoveryQuery')::text from valid_submission)
  ),
  'RC409', null,
  'a product Pending Hold cannot overlap active authorization-claimed inventory'
);
reset role;
select throws_ok(
  $$update public.cottage_inventory_standard_prices
    set price_iqd = price_iqd + 1
    where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
      and unit_kind = 'shift'
      and unit_id = '62000000-0000-4000-8000-000000003202'$$,
  'RC204', null,
  'an owner price mutation cannot change authorization-claimed inventory'
);
select throws_ok(
  $$update public.cottage_inventory_availability
    set state = 'closed'
    where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
      and unit_kind = 'shift'
      and unit_id = '62000000-0000-4000-8000-000000003202'
      and service_day = '2099-08-21'$$,
  'RC204', null,
  'an owner availability mutation cannot change authorization-claimed inventory'
);
select throws_ok(
  $$update public.owner_application_cottage_profiles
    set current_publication_id = null
    where id = '30000000-0000-4000-8000-000000003201'$$,
  'RC204', null,
  'an owner publication pointer cannot change while authorization is claim-protected'
);
set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    (select submission from journey_submission)
  ) -> 'providerIdentity',
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb,
  'recovery returns the immutable provider identity with payment evidence'
);
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from authorized_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"changed-merchant","terminalId":"fictional-terminal"}'
  ),
  'RC409', null,
  'a provider configuration change cannot move an authorization uniqueness namespace'
);
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select jsonb_set(snapshot, '{movements}', (snapshot -> 'movements') || jsonb_build_array(jsonb_build_object(
      'kind', 'authorization',
      'logicalOperationId', snapshot -> 'authorization' ->> 'logicalOperationId',
      'attemptId', snapshot -> 'authorization' ->> 'attemptId',
      'amountFils', 115000000,
      'movementReference', 'invented-extra-movement',
      'recordedAt', '2099-08-21T14:00:01.000Z'
    )))::text from authorized_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  '22023', null,
  'an authorization-only snapshot rejects invented extra movements'
);
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select jsonb_set(snapshot, '{authorization,logicalOperationId}', '"forged"'::jsonb)::text from authorized_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  '22023', null,
  'the database rejects a forged successful authorization snapshot'
);
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select jsonb_set(snapshot, '{release}', jsonb_build_object(
      'paymentLifecycleId', snapshot ->> 'paymentLifecycleId',
      'kind', 'release',
      'logicalOperationId', 'forged',
      'attemptId', (snapshot ->> 'paymentLifecycleId') || ':release:attempt-1',
      'status', 'pending',
      'amountFils', 115000000,
      'providerRequestId', null,
      'providerReference', null,
      'movementReference', null,
      'reconciliationRequired', false,
      'retrySafe', false
    ))::text from authorized_payment),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  '22023', null,
  'the database rejects a forged release operation before changing attempt state'
);
reset role;
update public.booking_request_submission_attempts
set payment_snapshot = jsonb_set(
  payment_snapshot,
  '{movements}',
  (payment_snapshot -> 'movements') || jsonb_build_array(jsonb_build_object(
    'kind', 'authorization',
    'logicalOperationId', payment_snapshot -> 'authorization' ->> 'logicalOperationId',
    'attemptId', payment_snapshot -> 'authorization' ->> 'attemptId',
    'amountFils', 115000000,
    'movementReference', 'tampered-retained-movement',
    'recordedAt', '2099-08-21T14:00:02.000Z'
  ))
)
where id = (select (result ->> 'attemptId')::uuid from prepared_submission);
create temporary table tampered_payment as
select payment_snapshot as snapshot
from public.booking_request_submission_attempts
where id = (select (result ->> 'attemptId')::uuid from prepared_submission);
grant select on tampered_payment to service_role;
set local role service_role;
select throws_ok(
  format(
    'select public.finalize_booking_request_submission(%L::uuid, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from tampered_payment)
  ),
  '22023', null,
  'finalization revalidates exact retained payment evidence'
);
reset role;
update public.booking_request_submission_attempts
set payment_snapshot = (select snapshot from authorized_payment),
  state = 'authorized'
where id = (select (result ->> 'attemptId')::uuid from prepared_submission);
update public.booking_request_submission_attempts
set intent_payload = jsonb_set(
  intent_payload,
  '{acceptanceEvidence,cancellationPolicy}',
  '"changed after acceptance"'::jsonb
)
where id = (select (result ->> 'attemptId')::uuid from prepared_submission);
set local role service_role;
select throws_ok(
  format(
    'select public.finalize_booking_request_submission(%L::uuid, %L::jsonb)',
    (select result ->> 'attemptId' from prepared_submission),
    (select snapshot::text from authorized_payment)
  ),
  'RC409', null,
  'finalization rejects changed localized acceptance evidence under its lock'
);
reset role;
update public.booking_request_submission_attempts
set intent_payload = jsonb_set(
  intent_payload,
  '{acceptanceEvidence,cancellationPolicy}',
  '"Cancel at least 48 hours before the first shift for a full refund. Cancellation inside 48 hours and no-shows receive no refund."'::jsonb
)
where id = (select (result ->> 'attemptId')::uuid from prepared_submission);
savepoint suspension_owner_finalization;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
insert into public.owner_applications(id,owner_user_id,applicant_kind,legal_name,status,submitted_at,review_started_at,review_due_at)
values('20000000-0000-4000-8000-000000003290','00000000-0000-0000-0000-000000003201','individual','Fictional Admission Owner','submitted',now(),now(),now()+interval '72 hours');
insert into public.owner_verification_documents(id,application_id,kind,object_path,original_filename,media_type,size_bytes)
values('42000000-0000-4000-8000-000000003290','20000000-0000-4000-8000-000000003290','identity','fictional/pending/identity.pdf','identity.pdf','application/pdf',128);
update public.owner_verification_documents set content_digest=repeat('e',64),digest_source='sha256' where id='42000000-0000-4000-8000-000000003290';
select public.review_owner_application('20000000-0000-4000-8000-000000003290',1,'approve','Fictional content-bound evidence accepted','{}','{}','Baghdad','licence','Fictional licence',jsonb_build_object('identity',(current_date+365)::text));
select lives_ok($test$
do $body$
declare target_attempt uuid := (select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
declare snapshot jsonb := (select payments.snapshot from authorized_payment payments);
declare original_attempt jsonb;
declare original_claim jsonb;
declare original_operations jsonb;
declare original_history jsonb;
declare original_revisions jsonb;
declare result jsonb;
declare denied boolean;
begin
  original_revisions:=(select jsonb_build_array(attempts.customer_suspension_revision,attempts.owner_suspension_revision,attempts.cottage_suspension_revision) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt);
  if not public.owner_can_start_new_business('00000000-0000-0000-0000-000000003201')
    or not public.is_cottage_publicly_discoverable('30000000-0000-4000-8000-000000003201')
  then raise exception 'Restoration did not restore ordinary owner/cottage eligibility'; end if;
  select to_jsonb(attempts) into strict original_attempt from public.booking_request_submission_attempts attempts where attempts.id=target_attempt;
  select to_jsonb(claims) into strict original_claim from public.booking_request_authorization_claims claims where claims.attempt_id=target_attempt;
  select jsonb_agg(to_jsonb(operations) order by operations.id) into original_operations from public.payment_provider_operations operations;
  select jsonb_agg(to_jsonb(history) order by history.id) into original_history from public.booking_request_payment_history history;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result:=public.set_marketplace_suspension('owner','00000000-0000-0000-0000-000000003201','suspend',2,'Fictional direct finalization restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension failed: %',result; end if;
  denied:=false;
  begin
    result:=public.finalize_booking_request_submission(target_attempt,snapshot);
  exception when sqlstate 'RC409' then denied:=true;
  end;
  if not denied then raise exception 'Direct finalization bypassed owner suspension: %',result; end if;
  result:=public.set_marketplace_suspension('owner','00000000-0000-0000-0000-000000003201','reactivate',3,'Prospective finalization restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Reactivation failed: %',result; end if;
  if not public.owner_can_start_new_business('00000000-0000-0000-0000-000000003201')
    or not public.is_cottage_publicly_discoverable('30000000-0000-4000-8000-000000003201')
  then raise exception 'Restoration did not restore ordinary owner/cottage eligibility'; end if;
  if (select jsonb_build_array(customer.customer_suspension_revision,owner_context.owner_suspension_revision,profiles.suspension_revision)
      from public.booking_request_submission_attempts attempts
      join public.account_contexts customer on customer.user_id=attempts.customer_user_id
      join public.owner_application_cottage_profiles profiles on profiles.id=attempts.profile_id
      join public.account_contexts owner_context on owner_context.user_id=profiles.owner_user_id
      where attempts.id=target_attempt)
      is distinct from jsonb_set(original_revisions,'{1}',to_jsonb((original_revisions->>1)::bigint+2))
  then raise exception 'owner restoration did not isolate exactly its changed revision'; end if;
  denied:=false;
  begin
    result:=public.finalize_booking_request_submission(target_attempt,snapshot);
  exception when sqlstate 'RC409' then denied:=true;
  end;
  if not denied then raise exception 'Direct finalization revived old owner revision: %',result; end if;
  if (select to_jsonb(attempts) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt) is distinct from original_attempt
    or (select to_jsonb(claims) from public.booking_request_authorization_claims claims where claims.attempt_id=target_attempt) is distinct from original_claim
    or (select jsonb_agg(to_jsonb(operations) order by operations.id) from public.payment_provider_operations operations) is distinct from original_operations
    or (select jsonb_agg(to_jsonb(history) order by history.id) from public.booking_request_payment_history history) is distinct from original_history
    or exists(select 1 from public.booking_requests)
    or exists(select 1 from public.cottage_booking_period_commitments)
  then raise exception 'Denied finalization changed immutable evidence or created request/hold'; end if;
  if (select jsonb_build_array(attempts.customer_suspension_revision,attempts.owner_suspension_revision,attempts.cottage_suspension_revision) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt) is distinct from original_revisions then raise exception 'owner finalization rebased stored attempt revisions'; end if;
end;
$body$;
$test$,'suspension_fences_prepared_and_issued_authorizations: owner finalization restoration');
rollback to savepoint suspension_owner_finalization;

savepoint suspension_cottage_finalization;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
insert into public.owner_applications(id,owner_user_id,applicant_kind,legal_name,status,submitted_at,review_started_at,review_due_at)
values('20000000-0000-4000-8000-000000003290','00000000-0000-0000-0000-000000003201','individual','Fictional Admission Owner','submitted',now(),now(),now()+interval '72 hours');
insert into public.owner_verification_documents(id,application_id,kind,object_path,original_filename,media_type,size_bytes)
values('42000000-0000-4000-8000-000000003290','20000000-0000-4000-8000-000000003290','identity','fictional/pending/identity.pdf','identity.pdf','application/pdf',128);
update public.owner_verification_documents set content_digest=repeat('e',64),digest_source='sha256' where id='42000000-0000-4000-8000-000000003290';
select public.review_owner_application('20000000-0000-4000-8000-000000003290',1,'approve','Fictional content-bound evidence accepted','{}','{}','Baghdad','licence','Fictional licence',jsonb_build_object('identity',(current_date+365)::text));
select lives_ok($test$
do $body$
declare target_attempt uuid := (select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
declare snapshot jsonb := (select payments.snapshot from authorized_payment payments);
declare original_attempt jsonb;
declare original_claim jsonb;
declare original_operations jsonb;
declare original_history jsonb;
declare original_revisions jsonb;
declare result jsonb;
declare denied boolean;
begin
  original_revisions:=(select jsonb_build_array(attempts.customer_suspension_revision,attempts.owner_suspension_revision,attempts.cottage_suspension_revision) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt);
  if not public.owner_can_start_new_business('00000000-0000-0000-0000-000000003201')
    or not public.is_cottage_publicly_discoverable('30000000-0000-4000-8000-000000003201')
  then raise exception 'Restoration did not restore ordinary owner/cottage eligibility'; end if;
  select to_jsonb(attempts) into strict original_attempt from public.booking_request_submission_attempts attempts where attempts.id=target_attempt;
  select to_jsonb(claims) into strict original_claim from public.booking_request_authorization_claims claims where claims.attempt_id=target_attempt;
  select jsonb_agg(to_jsonb(operations) order by operations.id) into original_operations from public.payment_provider_operations operations;
  select jsonb_agg(to_jsonb(history) order by history.id) into original_history from public.booking_request_payment_history history;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result:=public.set_marketplace_suspension('cottage','30000000-0000-4000-8000-000000003201','suspend',0,'Fictional direct finalization restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension failed: %',result; end if;
  denied:=false;
  begin
    result:=public.finalize_booking_request_submission(target_attempt,snapshot);
  exception when sqlstate 'RC409' then denied:=true;
  end;
  if not denied then raise exception 'Direct finalization bypassed cottage suspension: %',result; end if;
  result:=public.set_marketplace_suspension('cottage','30000000-0000-4000-8000-000000003201','reactivate',1,'Prospective finalization restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Reactivation failed: %',result; end if;
  if not public.owner_can_start_new_business('00000000-0000-0000-0000-000000003201')
    or not public.is_cottage_publicly_discoverable('30000000-0000-4000-8000-000000003201')
  then raise exception 'Restoration did not restore ordinary owner/cottage eligibility'; end if;
  if (select jsonb_build_array(customer.customer_suspension_revision,owner_context.owner_suspension_revision,profiles.suspension_revision)
      from public.booking_request_submission_attempts attempts
      join public.account_contexts customer on customer.user_id=attempts.customer_user_id
      join public.owner_application_cottage_profiles profiles on profiles.id=attempts.profile_id
      join public.account_contexts owner_context on owner_context.user_id=profiles.owner_user_id
      where attempts.id=target_attempt)
      is distinct from jsonb_set(original_revisions,'{2}',to_jsonb((original_revisions->>2)::bigint+2))
  then raise exception 'cottage restoration did not isolate exactly its changed revision'; end if;
  denied:=false;
  begin
    result:=public.finalize_booking_request_submission(target_attempt,snapshot);
  exception when sqlstate 'RC409' then denied:=true;
  end;
  if not denied then raise exception 'Direct finalization revived old cottage revision: %',result; end if;
  if (select to_jsonb(attempts) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt) is distinct from original_attempt
    or (select to_jsonb(claims) from public.booking_request_authorization_claims claims where claims.attempt_id=target_attempt) is distinct from original_claim
    or (select jsonb_agg(to_jsonb(operations) order by operations.id) from public.payment_provider_operations operations) is distinct from original_operations
    or (select jsonb_agg(to_jsonb(history) order by history.id) from public.booking_request_payment_history history) is distinct from original_history
    or exists(select 1 from public.booking_requests)
    or exists(select 1 from public.cottage_booking_period_commitments)
  then raise exception 'Denied finalization changed immutable evidence or created request/hold'; end if;
  if (select jsonb_build_array(attempts.customer_suspension_revision,attempts.owner_suspension_revision,attempts.cottage_suspension_revision) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt) is distinct from original_revisions then raise exception 'cottage finalization rebased stored attempt revisions'; end if;
end;
$body$;
$test$,'suspension_fences_prepared_and_issued_authorizations: cottage finalization restoration');
rollback to savepoint suspension_cottage_finalization;

savepoint suspension_direct_finalization;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select lives_ok($test$
do $body$
declare target_attempt uuid := (select (prepared_submission.result->>'attemptId')::uuid from prepared_submission);
declare snapshot jsonb := (select payments.snapshot from authorized_payment payments);
declare operation jsonb := (select original.operation from simulated_authorization_operation original);
declare original_attempt jsonb;
declare original_claim jsonb;
declare original_operations jsonb;
declare original_history jsonb;
declare result jsonb;
declare permit jsonb;
declare denied boolean;
begin
  select to_jsonb(attempts) into strict original_attempt from public.booking_request_submission_attempts attempts where attempts.id=target_attempt;
  select to_jsonb(claims) into strict original_claim from public.booking_request_authorization_claims claims where claims.attempt_id=target_attempt;
  select jsonb_agg(to_jsonb(operations) order by operations.id) into original_operations from public.payment_provider_operations operations;
  select jsonb_agg(to_jsonb(history) order by history.id) into original_history from public.booking_request_payment_history history;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result:=public.set_marketplace_suspension('customer','00000000-0000-0000-0000-000000003202','suspend',0,'Fictional direct finalization restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension failed: %',result; end if;
  denied:=false;
  begin
    result:=public.finalize_booking_request_submission(target_attempt,snapshot);
  exception when sqlstate 'RC409' then denied:=true;
  end;
  if not denied then raise exception 'Direct finalization bypassed customer suspension: %',result; end if;
  result:=public.set_marketplace_suspension('customer','00000000-0000-0000-0000-000000003202','reactivate',1,'Prospective finalization restoration',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Reactivation failed: %',result; end if;
  denied:=false;
  begin
    result:=public.finalize_booking_request_submission(target_attempt,snapshot);
  exception when sqlstate 'RC409' then denied:=true;
  end;
  if not denied then raise exception 'Direct finalization revived old customer revision: %',result; end if;
  if (select to_jsonb(attempts) from public.booking_request_submission_attempts attempts where attempts.id=target_attempt) is distinct from original_attempt
    or (select to_jsonb(claims) from public.booking_request_authorization_claims claims where claims.attempt_id=target_attempt) is distinct from original_claim
    or (select jsonb_agg(to_jsonb(operations) order by operations.id) from public.payment_provider_operations operations) is distinct from original_operations
    or (select jsonb_agg(to_jsonb(history) order by history.id) from public.booking_request_payment_history history) is distinct from original_history
    or exists(select 1 from public.booking_requests)
    or exists(select 1 from public.cottage_booking_period_commitments)
  then raise exception 'Denied finalization changed immutable evidence or created request/hold'; end if;
  result:=public.set_marketplace_suspension('customer','00000000-0000-0000-0000-000000003202','suspend',2,'Fictional cleanup under restriction',gen_random_uuid());
  if result->>'status' is distinct from 'completed' then raise exception 'Cleanup restriction failed: %',result; end if;
  perform set_config('role','service_role',true);
  result:=public.reload_booking_request_payment_operation(operation-array['permitPurpose','claimId','claimGeneration','notAfter','idempotencyKey','cleanupAttemptId','workId','leaseGeneration','leaseToken','stateRevision','operationId','operationGeneration'],null,null);
  if result->>'operationId' is distinct from original_operations->0->>'id'
  then raise exception 'Restricted admitted authorization is no longer queryable: %',result; end if;
  snapshot:=snapshot||jsonb_build_object('release',jsonb_build_object(
    'paymentLifecycleId',snapshot->>'paymentLifecycleId','kind','release',
    'logicalOperationId',(snapshot->>'paymentLifecycleId')||':release',
    'attemptId',(snapshot->>'paymentLifecycleId')||':release:attempt-1',
    'status','pending','amountFils',115000000,'providerRequestId',null,
    'providerReference',null,'movementReference',null,'reconciliationRequired',false,'retrySafe',false));
  result:=public.begin_booking_request_submission_cleanup_release(target_attempt,snapshot,operation->'providerIdentity');
  if result->>'status' is distinct from 'ready' then raise exception 'Restricted authorization cleanup is unreachable: %',result; end if;
  permit:=result->'executionPermit';
  result:=public.admit_booking_request_provider_operation(operation||jsonb_build_object(
    'permitPurpose',permit->>'purpose','idempotencyKey',permit->>'idempotencyKey',
    'notAfter',permit->>'notAfter','requestFingerprint',permit->>'requestFingerprint',
    'logicalOperationId',snapshot#>>'{release,logicalOperationId}',
    'physicalAttemptId',snapshot#>>'{release,attemptId}','operationKind','release',
    'claimId',permit->>'claimId','claimGeneration',permit->'generation',
    'stateRevision',permit->'stateRevision','cleanupAttemptId',permit->>'attemptId'));
  perform set_config('role','none',true);
  if result->>'mode' is distinct from 'execute'
    or (select count(*) from public.payment_provider_operations)<>2
    or exists(select 1 from public.booking_requests)
    or exists(select 1 from public.cottage_booking_period_commitments)
    or (select jsonb_build_array(attempts.customer_suspension_revision,attempts.owner_suspension_revision,attempts.cottage_suspension_revision)
      from public.booking_request_submission_attempts attempts where attempts.id=target_attempt)
      is distinct from jsonb_build_array(original_attempt->'customer_suspension_revision',original_attempt->'owner_suspension_revision',original_attempt->'cottage_suspension_revision')
  then raise exception 'Restricted cleanup was not admitted exactly or rewrote the attempt revisions: %',result; end if;
end;
$body$;
$test$,'suspension_fences_prepared_and_issued_authorizations: direct finalization and retained cleanup');
rollback to savepoint suspension_direct_finalization;

create temporary table finalized_submission as
select public.finalize_booking_request_submission(
  (select result ->> 'attemptId' from prepared_submission)::uuid,
  (select snapshot from authorized_payment)
) as result;
reset role;
grant select on finalized_submission to service_role;

select is(
  (select result ->> 'status' from finalized_submission), 'pending',
  'successful authorization finalizes one Pending Booking Request'
);
set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113205',
    (select jsonb_set(
      submission,
      '{intent,bookingNote}',
      '"A distinct future request."'::jsonb
    ) from journey_submission)
  ) ->> 'status',
  'invalid',
  'a conversation already bound to a Booking Request cannot be rebound'
);
reset role;
savepoint pending_hold_replacement_guard;
create temporary table pending_hold_history_before as select jsonb_build_object(
  'booking_request_submission_attempts',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_submission_attempts rows),
  'booking_request_authorization_claims',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_authorization_claims rows),
  'payment_provider_operations',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.payment_provider_operations rows),
  'cottage_booking_period_commitments',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.cottage_booking_period_commitments rows),
  'booking_request_payment_history',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_payment_history rows),
  'booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_requests rows),
  'messaging_conversation_booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.messaging_conversation_booking_requests rows)
) record;
create temporary table pending_hold_replacement as
select submission || jsonb_build_object(
  'discoveryQuery', '{"from":"2099-08-22","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-22","kind":"shift","position":2}]}'::jsonb,
  'quoteFingerprint', quote->>'quoteFingerprint',
  'contentVersion', quote->'contentVersion', 'termsVersion', quote->'termsVersion',
  'bookingPriceIqd', quote->'bookingPriceIqd', 'serviceFeeIqd', quote->'serviceFeeIqd',
  'customerTotalIqd', quote->'customerTotalIqd', 'firstStartsAt', quote#>>'{items,0,startsAt}'
) as submission
from journey_submission
cross join lateral (select public.get_public_booking_quote_with_fingerprint(
  'en', 'cottage-30000000000040008000000000003201', '{"from":"2099-08-22","to":"2099-08-22","guests":4,"selections":[{"serviceDay":"2099-08-22","kind":"shift","position":2}]}'::jsonb
) as quote) current_quote;
grant select on pending_hold_replacement to service_role;
set local role service_role;
select is(public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202', '11111111-1111-4111-8111-111111113709', (select submission from pending_hold_replacement)
)->>'status', 'invalid', 'pending hold preparation cannot be replaced with a valid disjoint-day quote');
reset role;
select is(jsonb_build_object(
  'booking_request_submission_attempts',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_submission_attempts rows),
  'booking_request_authorization_claims',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_authorization_claims rows),
  'payment_provider_operations',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.payment_provider_operations rows),
  'cottage_booking_period_commitments',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.cottage_booking_period_commitments rows),
  'booking_request_payment_history',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_request_payment_history rows),
  'booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.booking_requests rows),
  'messaging_conversation_booking_requests',(select coalesce(jsonb_agg(to_jsonb(rows) order by to_jsonb(rows)::text),'[]'::jsonb) from public.messaging_conversation_booking_requests rows)
), (select record from pending_hold_history_before),
  'pending hold replacement refusal preserves the exact attempt, claim, provider, request, hold, link and payment history');
rollback to savepoint pending_hold_replacement_guard;

select ok((select attempts.conversation_id=links.conversation_id
    and attempts.id=links.submission_attempt_id
    and attempts.booking_request_id=links.booking_request_id
  from public.booking_request_submission_attempts attempts
  join public.messaging_conversation_booking_requests links
    on links.submission_attempt_id=attempts.id
  where attempts.id=(select (result->>'attemptId')::uuid from prepared_submission)),
  'inquiry, attempt and finalized request link atomically'
);
select results_eq(
  $$select
      (select count(*)::integer from public.booking_requests),
      (select count(*)::integer from public.booking_snapshots),
      (select count(*)::integer from public.cottage_booking_period_commitments),
      (select count(*)::integer from public.owner_request_notifications)$$,
  $$values (1::integer, 1::integer, 1::integer, 1::integer)$$,
  'request, immutable snapshot, complete Pending Hold and owner notice commit atomically'
);
select results_eq(
  $$select claims.state::text, occupancies.active, outbox.state
    from public.booking_request_authorization_claims claims
    join public.booking_request_authorization_claim_occupancies occupancies
      on occupancies.claim_id = claims.id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = claims.id$$,
  $$values ('converted'::text, false, 'complete'::text)$$,
  'successful finalization atomically consumes the private claim into the product Pending Hold'
);
select results_eq(
  $$select claim_items.service_day, claim_items.unit_kind::text,
      claim_items.unit_id, claim_items.price_iqd
    from public.booking_request_authorization_claim_items claim_items$$,
  $$select commitments.service_day, commitments.unit_kind::text,
      commitments.unit_id, commitments.committed_price_iqd
    from public.cottage_inventory_commitments commitments$$,
  'the first real Pending Hold exactly preserves every claimed priced item'
);
select is(
  (
    select response_deadline - created_at
    from public.booking_requests
  ),
  interval '4 hours',
  'the owner receives the exact four-hour Response Deadline'
);
select results_eq(
  $$select marketplace_commission_rate_basis_points,
      marketplace_commission_amount_fils
    from public.booking_snapshots$$,
  $$values (1000::smallint, 11000000::bigint)$$,
  'the immutable Booking Snapshot preserves the exact ten-percent commission'
);

create temporary table booking_request_lifecycle_target as
select id, owner_user_id, customer_user_id, booking_request_reference
from public.booking_requests limit 1;
grant select on booking_request_lifecycle_target to service_role, authenticated;

savepoint suspension_pending_preparation;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select lives_ok($test$
do $body$
declare request_before public.booking_requests;
declare hold_before jsonb;
declare snapshot_before jsonb;
declare provider_before jsonb;
declare result jsonb;
declare action_id uuid;
declare lease jsonb;
declare work_id uuid;
declare work_before jsonb;
declare history_before jsonb;
declare occupancies_before jsonb;
declare prior_role text:=current_setting('role');
begin
  select * into request_before from public.booking_requests where id=(select id from booking_request_lifecycle_target);
  select to_jsonb(holds) into hold_before from public.cottage_booking_period_commitments holds where id=request_before.booking_period_commitment_id;
  select to_jsonb(snapshots) into snapshot_before from public.booking_snapshots snapshots where id=request_before.booking_snapshot_id;
  select coalesce(jsonb_agg(to_jsonb(operations) order by operations.id),'[]') into provider_before from public.payment_provider_operations operations;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
  result:=public.set_marketplace_suspension('customer',request_before.customer_user_id,'suspend',0,'Private platform reason','00000000-0000-4000-8000-000000003291');
  if result->>'status' is distinct from 'completed' then raise exception 'Suspension did not complete: %',result; end if;
  action_id:=(result->>'actionId')::uuid;
  if result#>'{target,releaseSummary}' is distinct from '{"affected":1,"resolved":0,"processing":1,"quarantined":0}'::jsonb
    or not exists(select 1 from jsonb_array_elements(result#>'{target,actions}') action where (action->>'id')::uuid=action_id and action->'affected'='1'::jsonb and action->'resolved'='0'::jsonb and action->'processing'='1'::jsonb and action->'quarantined'='0'::jsonb)
  then raise exception 'Reader release counts do not match the one persisted processing case'; end if;
  if not exists(select 1 from public.booking_requests where id=request_before.id and status='processing' and outcome_actor_user_id='00000000-0000-4000-8000-000000003290' and decline_reason='other' and decline_note is null) then raise exception 'Pending request did not enter actor-neutral release processing'; end if;
  if not exists(select 1 from public.booking_request_release_work where booking_request_id=request_before.id and suspension_action_id=action_id and state='processing' and lease_generation=0 and lease_token is null and outcome='declined' and decline_note is null) then raise exception 'Suspension did not prepare exactly unleased work'; end if;
  if (select count(*) from public.booking_request_release_operations)<>0 or (select count(*) from public.booking_request_status_notifications where booking_request_id=request_before.id)<>0 then raise exception 'Preparation leased work or notified recipient under authority locks'; end if;
  if (select to_jsonb(holds) from public.cottage_booking_period_commitments holds where id=request_before.booking_period_commitment_id) is distinct from hold_before or (select to_jsonb(snapshots) from public.booking_snapshots snapshots where id=request_before.booking_snapshot_id) is distinct from snapshot_before or (select coalesce(jsonb_agg(to_jsonb(operations) order by operations.id),'[]') from public.payment_provider_operations operations) is distinct from provider_before then raise exception 'Preparation changed authoritative payment, hold or snapshot facts'; end if;
  select jsonb_agg(to_jsonb(occupancies) order by to_jsonb(occupancies)::text) into occupancies_before from public.cottage_booking_period_occupancies occupancies where booking_period_commitment_id=request_before.booking_period_commitment_id;
  select id into work_id from public.booking_request_release_work where booking_request_id=request_before.id;
  lease:=public.lease_booking_request_release_work(work_id);
  select to_jsonb(work) into work_before from public.booking_request_release_work work where booking_request_id=request_before.id;
  select jsonb_agg(to_jsonb(history) order by id) into history_before from public.booking_request_payment_history history;
  if lease->>'status' is distinct from 'release-required' then raise exception 'Prepared suspension work could not be leased'; end if;
  perform set_config('role','service_role',true);
  result:=public.finalize_booking_request_release((lease->>'workId')::uuid,(lease->>'leaseGeneration')::bigint,(lease->>'leaseToken')::uuid);
  perform set_config('role',prior_role,true);
  if result->>'status' is distinct from 'processing'
    or not exists(select 1 from public.booking_requests where id=request_before.id and status='processing')
    or (select to_jsonb(work) from public.booking_request_release_work work where booking_request_id=request_before.id) is distinct from work_before
    or (select to_jsonb(holds) from public.cottage_booking_period_commitments holds where id=request_before.booking_period_commitment_id) is distinct from hold_before
    or (select jsonb_agg(to_jsonb(occupancies) order by to_jsonb(occupancies)::text) from public.cottage_booking_period_occupancies occupancies where booking_period_commitment_id=request_before.booking_period_commitment_id) is distinct from occupancies_before
    or (select to_jsonb(snapshots) from public.booking_snapshots snapshots where id=request_before.booking_snapshot_id) is distinct from snapshot_before
    or (select coalesce(jsonb_agg(to_jsonb(operations) order by operations.id),'[]') from public.payment_provider_operations operations) is distinct from provider_before
    or (select jsonb_agg(to_jsonb(history) order by id) from public.booking_request_payment_history history) is distinct from history_before
    or exists(select 1 from public.booking_request_status_notifications where booking_request_id=request_before.id)
  then raise exception 'Suspension finalized without authoritative successful release or changed retained facts: result %, work %, hold %, snapshot %, provider %, history %, occupancies %',
    result,
    (select to_jsonb(work) from public.booking_request_release_work work where booking_request_id=request_before.id) is not distinct from work_before,
    (select to_jsonb(holds) from public.cottage_booking_period_commitments holds where id=request_before.booking_period_commitment_id) is not distinct from hold_before,
    (select to_jsonb(snapshots) from public.booking_snapshots snapshots where id=request_before.booking_snapshot_id) is not distinct from snapshot_before,
    (select coalesce(jsonb_agg(to_jsonb(operations) order by operations.id),'[]') from public.payment_provider_operations operations) is not distinct from provider_before,
    (select jsonb_agg(to_jsonb(history) order by id) from public.booking_request_payment_history history) is not distinct from history_before,
    (select jsonb_agg(to_jsonb(occupancies) order by to_jsonb(occupancies)::text) from public.cottage_booking_period_occupancies occupancies where booking_period_commitment_id=request_before.booking_period_commitment_id) is not distinct from occupancies_before;
  end if;
end;
$body$;
$test$,'suspension_release_never_precedes_provider_truth');
rollback to savepoint suspension_pending_preparation;

savepoint legacy_owner_suspension_pending;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
insert into public.owner_applications(id,owner_user_id,applicant_kind,legal_name,status,submitted_at,review_started_at,review_due_at)
select '20000000-0000-4000-8000-000000003290',owner_user_id,'individual','Fictional Pending Owner','submitted',now(),now(),now()+interval '72 hours' from booking_request_lifecycle_target;
insert into public.owner_verification_documents(id,application_id,kind,object_path,original_filename,media_type,size_bytes)
values('42000000-0000-4000-8000-000000003290','20000000-0000-4000-8000-000000003290','identity','fictional/pending/identity.pdf','identity.pdf','application/pdf',128);
update public.owner_verification_documents set content_digest=repeat('e',64),digest_source='sha256' where id='42000000-0000-4000-8000-000000003290';
select public.review_owner_application('20000000-0000-4000-8000-000000003290',1,'approve','Fictional content-bound evidence accepted','{}','{}','Baghdad','licence','Fictional licence',jsonb_build_object('identity',(current_date+365)::text));
select lives_ok($test$
do $body$
declare request_before public.booking_requests;
declare result jsonb;
declare action private.marketplace_suspension_actions;
declare replay jsonb;
declare hold_before jsonb;
declare snapshot_before jsonb;
begin
  select * into request_before from public.booking_requests where id=(select id from booking_request_lifecycle_target);
  select to_jsonb(holds) into hold_before from public.cottage_booking_period_commitments holds where id=request_before.booking_period_commitment_id;
  select to_jsonb(snapshots) into snapshot_before from public.booking_snapshots snapshots where id=request_before.booking_snapshot_id;
  result:=public.review_owner_application('20000000-0000-4000-8000-000000003290',2,'suspend','Fictional legacy restriction','{}','{}',null,null,null,'{}'::jsonb);
  select * into strict action from private.marketplace_suspension_actions where target_kind='owner' and account_user_id=request_before.owner_user_id;
  if result->>'status'<>'suspended' or (result->>'version')::integer<>3 or action.actor_user_id<>'00000000-0000-4000-8000-000000003290'
    or not exists(select 1 from public.booking_requests where id=request_before.id and status='processing' and decline_reason='other' and decline_note is null)
    or not exists(select 1 from public.booking_request_release_work where booking_request_id=request_before.id and suspension_action_id=action.id and lease_generation=0 and lease_token is null and outcome='declined')
  then raise exception 'Legacy owner suspension did not use the pending case'; end if;
  replay:=public.set_marketplace_suspension('owner',request_before.owner_user_id,'suspend',2,'Fictional legacy restriction',action.command_id);
  if replay->>'status' is distinct from 'completed' or (replay->>'actionId')::uuid<>action.id
    or (select count(*) from private.marketplace_suspension_actions where target_kind='owner' and account_user_id=request_before.owner_user_id)<>1
    or (select count(*) from public.owner_application_transitions where application_id=(result->>'application_id')::uuid and to_status='suspended')<>1
    or (select count(*) from public.owner_application_notices where application_id=(result->>'application_id')::uuid and kind='suspended')<>1
    or (select count(*) from public.booking_request_release_work where booking_request_id=request_before.id)<>1
  then raise exception 'Legacy replay duplicated attributed state'; end if;
  if (select to_jsonb(holds) from public.cottage_booking_period_commitments holds where id=request_before.booking_period_commitment_id) is distinct from hold_before
    or (select to_jsonb(snapshots) from public.booking_snapshots snapshots where id=request_before.booking_snapshot_id) is distinct from snapshot_before
    or exists(select 1 from public.booking_request_status_notifications where booking_request_id=request_before.id)
  then raise exception 'Legacy preparation changed retained facts or notified before release'; end if;
end;
$body$;
$test$,'legacy_owner_suspend_uses_pending_case');
rollback to savepoint legacy_owner_suspension_pending;

savepoint cottage_suspension_deadline;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
update public.booking_requests set created_at=due.deadline-interval '4 hours',response_deadline=due.deadline
from (select clock_timestamp()-interval '1 second' as deadline) due
where id=(select id from booking_request_lifecycle_target);
select lives_ok($test$
do $body$
declare result jsonb;
declare request_before public.booking_requests;
begin
  select * into request_before from public.booking_requests where id=(select id from booking_request_lifecycle_target);
  result:=public.set_marketplace_suspension('cottage',request_before.profile_id,'suspend',0,'Fictional deadline case',gen_random_uuid());
  if result->>'status' is distinct from 'completed'
    or not exists(select 1 from public.booking_request_release_work where booking_request_id=request_before.id and suspension_action_id=(result->>'actionId')::uuid and outcome='expired' and actor_user_id is null and decline_reason is null and decline_note is null and lease_generation=0)
    or not exists(select 1 from public.booking_requests where id=request_before.id and status='processing' and outcome_actor_user_id is null and response_deadline=request_before.response_deadline and created_at=request_before.created_at)
  then raise exception 'Cottage suspension reinterpreted the expired deadline'; end if;
end;
$body$;
$test$,'suspension_preserves_authoritative_expired_deadline');
rollback to savepoint cottage_suspension_deadline;


savepoint booking_request_null_withdraw_actor;
set local role service_role;
select is(
  public.claim_booking_request_action(
    null, (select id from booking_request_lifecycle_target),
    'withdraw', null, null
  ) ->> 'status',
  'access-required',
  'a null actor cannot withdraw a Booking Request'
);
reset role;
rollback to savepoint booking_request_null_withdraw_actor;

savepoint booking_request_null_accept_actor;
set local role service_role;
select is(
  public.claim_booking_request_action(
    null, (select id from booking_request_lifecycle_target),
    'accept', null, null
  ) ->> 'status',
  'access-required',
  'a null actor cannot accept a Booking Request'
);
reset role;
rollback to savepoint booking_request_null_accept_actor;

savepoint booking_request_null_decline_actor;
set local role service_role;
select is(
  public.claim_booking_request_action(
    null, (select id from booking_request_lifecycle_target),
    'decline', 'other', null
  ) ->> 'status',
  'access-required',
  'a null actor cannot decline a Booking Request'
);
reset role;
rollback to savepoint booking_request_null_decline_actor;

savepoint booking_request_null_action;
set local role service_role;
select is(
  public.claim_booking_request_action(
    (select customer_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target), null, null, null
  ) ->> 'status',
  'access-required',
  'a null action cannot mutate a Booking Request'
);
reset role;
rollback to savepoint booking_request_null_action;

select results_eq(
  $$select requests.status,
      claims.state,
      count(distinct work.id)::integer,
      count(distinct provider.id)::integer,
      count(distinct notifications.id)::integer
    from public.booking_requests requests
    join public.booking_request_submission_attempts attempts
      on attempts.booking_request_id = requests.id
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    left join public.booking_request_release_work work
      on work.attempt_id = attempts.id
    left join public.booking_request_release_operations operations
      on operations.work_id = work.id
    left join public.payment_provider_operations provider
      on provider.provider_idempotency_key = operations.provider_idempotency_key
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    where requests.id = (select id from booking_request_lifecycle_target)
    group by requests.status, claims.state$$,
  $$values ('pending'::text, 'converted'::public.booking_request_authorization_claim_state,
      0::integer, 0::integer, 0::integer)$$,
  'null action inputs create no release work, provider operation, hold change, or notification'
);

savepoint booking_request_premature_expiry;
set local role service_role;
select is(
  public.claim_booking_request_expiry(
    (select id from booking_request_lifecycle_target)
  ) ->> 'status',
  'not-due',
  'the internal expiry claim independently rejects a pre-deadline request'
);
reset role;
select results_eq(
  $$select requests.status, count(notifications.id)::integer
    from public.booking_requests requests
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    where requests.id = (select id from booking_request_lifecycle_target)
    group by requests.status$$,
  $$values ('pending'::text, 0::integer)$$,
  'a premature expiry claim cannot accept the request or notify either party'
);
rollback to savepoint booking_request_premature_expiry;

savepoint booking_request_cross_party_authorization;
set local role service_role;
select is(
  public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003204',
    (select id from booking_request_lifecycle_target), 'accept', null, null
  ) ->> 'status', 'access-required',
  'a different Cottage Owner cannot inspect or act on a pending Booking Request'
);
select is(
  public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003203',
    (select id from booking_request_lifecycle_target), 'withdraw', null, null
  ) ->> 'status', 'access-required',
  'a different Customer cannot inspect or withdraw a pending Booking Request'
);
reset role;
update public.booking_requests set status = 'processing';
set local role service_role;
select is(
  public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003204',
    (select id from booking_request_lifecycle_target), 'decline', 'other', null
  ) ->> 'status', 'access-required',
  'a different Cottage Owner cannot inspect processing release work'
);
select is(
  public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003203',
    (select id from booking_request_lifecycle_target), 'withdraw', null, null
  ) ->> 'status', 'access-required',
  'a different Customer cannot inspect processing release work'
);
reset role;
update public.booking_requests set status = 'declined';
set local role service_role;
select is(
  public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003204',
    (select id from booking_request_lifecycle_target), 'accept', null, null
  ) ->> 'status', 'access-required',
  'a different Cottage Owner cannot inspect a terminal Booking Request'
);
select is(
  public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003203',
    (select id from booking_request_lifecycle_target), 'withdraw', null, null
  ) ->> 'status', 'access-required',
  'a different Customer cannot inspect a terminal Booking Request'
);
reset role;
rollback to savepoint booking_request_cross_party_authorization;

savepoint booking_request_current_owner_authorization;
create temporary table current_owner_authorization_results (
  category text,
  action text,
  status text
);
grant select, insert on current_owner_authorization_results to service_role;
set local role service_role;
insert into current_owner_authorization_results values
  ('wrong', 'accept', public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003204',
    (select id from booking_request_lifecycle_target), 'accept', null, null
  ) ->> 'status'),
  ('wrong', 'decline', public.claim_booking_request_action(
    '00000000-0000-0000-0000-000000003204',
    (select id from booking_request_lifecycle_target), 'decline', 'other', null
  ) ->> 'status');
reset role;
update public.account_contexts set owner_approval_state = 'suspended'
where user_id = (select owner_user_id from booking_request_lifecycle_target);
set local role service_role;
insert into current_owner_authorization_results values
  ('suspended', 'accept', public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target), 'accept', null, null
  ) ->> 'status'),
  ('suspended', 'decline', public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target), 'decline', 'other', null
  ) ->> 'status');
reset role;
update public.account_contexts set owner_approval_state = 'expired'
where user_id = (select owner_user_id from booking_request_lifecycle_target);
set local role service_role;
insert into current_owner_authorization_results values
  ('expired', 'accept', public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target), 'accept', null, null
  ) ->> 'status'),
  ('expired', 'decline', public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target), 'decline', 'other', null
  ) ->> 'status');
reset role;
update public.account_contexts set owner_approval_state = 'prospective'
where user_id = (select owner_user_id from booking_request_lifecycle_target);
set local role service_role;
insert into current_owner_authorization_results values
  ('revoked', 'accept', public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target), 'accept', null, null
  ) ->> 'status'),
  ('revoked', 'decline', public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target), 'decline', 'other', null
  ) ->> 'status');
reset role;
select results_eq(
  $$select category, action, status
    from current_owner_authorization_results order by category, action$$,
  $$values
    ('expired'::text, 'accept'::text, 'access-required'::text),
    ('expired', 'decline', 'access-required'),
    ('revoked', 'accept', 'access-required'),
    ('revoked', 'decline', 'access-required'),
    ('suspended', 'accept', 'access-required'),
    ('suspended', 'decline', 'access-required'),
    ('wrong', 'accept', 'access-required'),
    ('wrong', 'decline', 'access-required')$$,
  'only the currently approved owning Cottage Owner can accept or decline'
);
select results_eq(
  $$select requests.status, commitments.status::text,
      bool_and(occupancies.active),
      count(distinct work.id)::integer,
      count(distinct notifications.id)::integer
    from public.booking_requests requests
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = commitments.id
    left join public.booking_request_release_work work
      on work.booking_request_id = requests.id
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    where requests.id = (select id from booking_request_lifecycle_target)
    group by requests.status, commitments.status$$,
  $$values ('pending'::text, 'pending_hold'::text, true, 0::integer, 0::integer)$$,
  'unauthorised Owner decisions cause zero lifecycle, inventory, or notification mutation'
);
rollback to savepoint booking_request_current_owner_authorization;

savepoint booking_request_expiry_ignores_owner_approval;
update public.account_contexts set owner_approval_state = 'prospective'
where user_id = (select owner_user_id from booking_request_lifecycle_target);
update public.booking_requests
set response_deadline = due.deadline,
  created_at = due.deadline - interval '4 hours'
from (select clock_timestamp() - interval '1 millisecond' as deadline) due;
set local role service_role;
select is(
  public.claim_booking_request_expiry(
    (select id from booking_request_lifecycle_target)
  ) ->> 'status',
  'release-required',
  'direct expiry claims overdue work without an Owner action or approval state'
);
reset role;
select results_eq(
  $$select work.outcome, work.actor_user_id is null,
      contexts.owner_approval_state::text
    from public.booking_request_release_work work
    join public.booking_requests requests on requests.id = work.booking_request_id
    join public.account_contexts contexts
      on contexts.user_id = requests.owner_user_id$$,
  $$values ('expired'::text, true, 'prospective'::text)$$,
  'expiry records a system-owned outcome while leaving Owner approval untouched'
);
rollback to savepoint booking_request_expiry_ignores_owner_approval;

savepoint booking_request_owner_acceptance;
set local role service_role;
select is(
  public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target),
    'accept', null, null
  ) ->> 'status',
  'accepted',
  'the authorised Cottage Owner accepts the complete request atomically'
);
reset role;
select results_eq(
  $$select requests.status, commitments.status::text,
      bool_and(occupancies.active), count(notifications.id)::integer
    from public.booking_requests requests
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = commitments.id
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    group by requests.status, commitments.status$$,
  $$values ('accepted'::text, 'pending_hold'::text, true, 2::integer)$$,
  'acceptance retains the Payment Authorisation and active Pending Hold while notifying both parties once'
);
set local role service_role;
select is(public.admit_messaging_message(
  (select customer_user_id from booking_request_lifecycle_target),
  (select (result->>'conversationId')::uuid from submission_conversation),
  '36000000-0000-4000-8000-000000003202','en','Call 0750 123 4567'
)->>'status','blocked','owner acceptance without captured payment cannot permit contact details');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select is(
  jsonb_array_length(public.list_owner_booking_request_notifications() -> 0
    -> 'statusNotifications')::text || ':' ||
    (public.list_owner_booking_request_notifications() -> 0
      -> 'statusNotifications' -> 0 ->> 'status'),
  '1:accepted',
  'the owning Cottage Owner reads exactly one scoped acceptance notification receipt'
);
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003202"}', true);
select is(
  jsonb_array_length(public.get_customer_booking_request(
    (select booking_request_reference from booking_request_lifecycle_target)
  ) -> 'statusNotifications')::text || ':' ||
    (public.get_customer_booking_request(
      (select booking_request_reference from booking_request_lifecycle_target)
    ) -> 'statusNotifications' -> 0 ->> 'status'),
  '1:accepted',
  'the owning Customer reads exactly one scoped acceptance notification receipt'
);
reset role;

savepoint suspension_preserves_acceptance;
insert into auth.users(id,aud,role,email,email_confirmed_at) values('00000000-0000-4000-8000-000000003290','authenticated','authenticated','suspension-3290@example.invalid',now());
insert into public.account_contexts(user_id,role) values('00000000-0000-4000-8000-000000003290','platform_administrator');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000003290","role":"authenticated","aal":"aal2"}',true);
insert into public.owner_applications(id,owner_user_id,applicant_kind,legal_name,status,submitted_at,review_started_at,review_due_at)
select '20000000-0000-4000-8000-000000003290',owner_user_id,'individual','Fictional Pending Owner','submitted',now(),now(),now()+interval '72 hours' from booking_request_lifecycle_target;
insert into public.owner_verification_documents(id,application_id,kind,object_path,original_filename,media_type,size_bytes)
values('42000000-0000-4000-8000-000000003290','20000000-0000-4000-8000-000000003290','identity','fictional/pending/identity.pdf','identity.pdf','application/pdf',128);
update public.owner_verification_documents set content_digest=repeat('e',64),digest_source='sha256' where id='42000000-0000-4000-8000-000000003290';
select public.review_owner_application('20000000-0000-4000-8000-000000003290',1,'approve','Fictional content-bound evidence accepted','{}','{}','Baghdad','licence','Fictional licence',jsonb_build_object('identity',(current_date+365)::text));
select lives_ok($test$
do $body$
declare request_before public.booking_requests;
declare attempt_before jsonb;
declare capture_before jsonb;
declare hold_before jsonb;
declare provider_before jsonb;
declare notices_before jsonb;
declare kind text;
declare result jsonb;
begin
  select * into request_before from public.booking_requests where id=(select id from booking_request_lifecycle_target);
  if request_before.status<>'accepted' then raise exception 'Accepted fixture is missing'; end if;
  select to_jsonb(attempts) into attempt_before from public.booking_request_submission_attempts attempts where booking_request_id=request_before.id;
  select to_jsonb(work) into capture_before from public.booking_request_capture_work work where booking_request_id=request_before.id;
  select to_jsonb(holds) into hold_before from public.cottage_booking_period_commitments holds where id=request_before.booking_period_commitment_id;
  select jsonb_agg(to_jsonb(operations) order by id) into provider_before from public.payment_provider_operations operations;
  select jsonb_agg(to_jsonb(notices) order by id) into notices_before from public.booking_request_status_notifications notices;
  foreach kind in array array['customer','owner','cottage'] loop
    result:=public.set_marketplace_suspension(kind,case kind when 'customer' then request_before.customer_user_id when 'owner' then request_before.owner_user_id else request_before.profile_id end,'suspend',case when kind='owner' then 2 else 0 end,'Accepted obligations remain authoritative',gen_random_uuid());
    if result->>'status' is distinct from 'completed' then raise exception 'Restriction failed for %: %',kind,result; end if;
  end loop;
  if (select to_jsonb(requests) from public.booking_requests requests where id=request_before.id) is distinct from to_jsonb(request_before)
    or (select to_jsonb(attempts) from public.booking_request_submission_attempts attempts where booking_request_id=request_before.id) is distinct from attempt_before
    or (select to_jsonb(work) from public.booking_request_capture_work work where booking_request_id=request_before.id) is distinct from capture_before
    or (select to_jsonb(holds) from public.cottage_booking_period_commitments holds where id=request_before.booking_period_commitment_id) is distinct from hold_before
    or (select jsonb_agg(to_jsonb(operations) order by id) from public.payment_provider_operations operations) is distinct from provider_before
    or (select jsonb_agg(to_jsonb(notices) order by id) from public.booking_request_status_notifications notices) is distinct from notices_before
    or exists(select 1 from public.booking_request_release_work where booking_request_id=request_before.id)
  then raise exception 'Suspension rewrote the accepted obligation or started a release'; end if;
end;
$body$;
$test$,'suspension_preserves_accepted_payment_obligation');
rollback to savepoint suspension_preserves_acceptance;

rollback to savepoint booking_request_owner_acceptance;

savepoint booking_request_malformed_decline_reason;
set local role service_role;
select throws_ok(
  format(
    'select public.claim_booking_request_action(%L::uuid, %L::uuid, %L, %L, null)',
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target),
    'decline',
    'invented_reason'
  ),
  '22023', null,
  'an unknown decline reason fails loudly at the database boundary'
);
reset role;
rollback to savepoint booking_request_malformed_decline_reason;

savepoint booking_request_decline_claim;
set local role service_role;
select is(
  public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target),
    'decline', 'cottage_unavailable', 'Fictional maintenance is required.'
  ) ->> 'status',
  'release-required',
  'decline freezes unsuccessful intent and returns authoritative release work'
);
reset role;
select results_eq(
  $$select requests.status, work.outcome, work.decline_reason,
      work.decline_note, work.outcome_fingerprint = requests.outcome_fingerprint
    from public.booking_requests requests
    join public.booking_request_release_work work
      on work.booking_request_id = requests.id$$,
  $$values (
    'processing'::text, 'declined'::text, 'cottage_unavailable'::text,
    'Fictional maintenance is required.'::text, true
  )$$,
  'the immutable decline reason, normalized note and fingerprint are frozen before provider execution'
);
select results_eq(
  $$select commitments.status::text, bool_and(occupancies.active),
      count(notifications.id)::integer
    from public.booking_requests requests
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = commitments.id
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    group by commitments.status$$,
  $$values ('pending_hold'::text, true, 0::integer)$$,
  'inventory stays held and no terminal status notification is sent before release succeeds'
);
set local role service_role;
select is(
  public.claim_booking_request_action(
    (select customer_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target),
    'withdraw', null, null
  ) ->> 'status',
  'processing',
  'a competing withdrawal cannot replace or reclaim the live decline lease'
);
reset role;
rollback to savepoint booking_request_decline_claim;

savepoint booking_request_withdrawal_release;
set local role service_role;
select public.claim_booking_request_action(
  (select customer_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),
  'withdraw', null, null
);
reset role;
create temporary table withdrawal_release_snapshots as
select attempts.id as attempt_id, work.id as work_id,
  work.lease_generation, work.lease_token,
  jsonb_set(
    attempts.payment_snapshot,
    '{release}',
    jsonb_build_object(
      'paymentLifecycleId', attempts.payment_lifecycle_id,
      'kind', 'release',
      'logicalOperationId', attempts.payment_lifecycle_id::text || ':release',
      'attemptId', attempts.payment_lifecycle_id::text || ':release:attempt-2',
      'status', 'pending',
      'amountFils', (attempts.quote_payload ->> 'customerTotalIqd')::bigint * 1000,
      'providerRequestId', null,
      'providerReference', null,
      'movementReference', null,
      'reconciliationRequired', false,
      'retrySafe', false
    )
  ) as pending_snapshot
from public.booking_request_submission_attempts attempts
join public.booking_request_release_work work on work.attempt_id = attempts.id;
alter table withdrawal_release_snapshots add column succeeded_snapshot jsonb;
update withdrawal_release_snapshots snapshots
set succeeded_snapshot = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        snapshots.pending_snapshot,
        '{release,status}', '"succeeded"'::jsonb
      ),
      '{release,providerRequestId}', '"lifecycle-withdraw-request"'::jsonb
    ),
    '{release,providerReference}', '"lifecycle-withdraw-reference"'::jsonb
  ),
  '{release,movementReference}', '"lifecycle-withdraw-movement"'::jsonb
);
update withdrawal_release_snapshots snapshots
set succeeded_snapshot = jsonb_set(
  snapshots.succeeded_snapshot,
  '{movements}',
  (snapshots.succeeded_snapshot -> 'movements') || jsonb_build_array(
    jsonb_build_object(
      'kind', 'release',
      'logicalOperationId', snapshots.succeeded_snapshot -> 'release' ->> 'logicalOperationId',
      'attemptId', snapshots.succeeded_snapshot -> 'release' ->> 'attemptId',
      'amountFils', (snapshots.succeeded_snapshot -> 'release' ->> 'amountFils')::bigint,
      'movementReference', 'lifecycle-withdraw-movement',
      'recordedAt', '2099-08-21T17:00:00.000Z'
    )
  )
);
grant select, update on withdrawal_release_snapshots to service_role;
set local role service_role;
create temporary table withdrawal_release_permit as
select public.save_booking_request_release_snapshot(
  work_id, lease_generation, lease_token, pending_snapshot,
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as permit from withdrawal_release_snapshots;
grant select on withdrawal_release_permit to service_role;
create temporary table withdrawal_provider_result as
select pg_temp.payment_execute(
    jsonb_build_object(
      'providerIdentity', jsonb_build_object(
        'provider', 'fictional-payments', 'environment', 'local-test',
        'merchantId', 'fictional-merchant', 'terminalId', 'fictional-terminal'
      ),
      'permitPurpose', permit ->> 'purpose',
      'idempotencyKey', permit ->> 'idempotencyKey',
      'requestFingerprint', permit ->> 'requestFingerprint',
      'notAfter', permit ->> 'notAfter',
      'paymentLifecycleId', pending_snapshot ->> 'paymentLifecycleId',
      'logicalOperationId', pending_snapshot -> 'release' ->> 'logicalOperationId',
      'physicalAttemptId', pending_snapshot -> 'release' ->> 'attemptId',
      'operationKind', 'release',
      'amountFils', (pending_snapshot -> 'release' ->> 'amountFils')::bigint,
      'currency', 'IQD', 'claimId', null, 'claimGeneration', null,
      'stateRevision', null, 'cleanupAttemptId', null,
      'workId', permit ->> 'workId',
      'leaseGeneration', (permit ->> 'leaseGeneration')::bigint,
      'leaseToken', permit ->> 'leaseToken',
      'operationId', permit ->> 'operationId',
      'operationGeneration', (permit ->> 'operationGeneration')::integer
    ),
    'succeeded'
  ) as result
from withdrawal_release_snapshots, withdrawal_release_permit;
select is(
  (select result ->> 'outcome' from withdrawal_provider_result),
  'succeeded',
  'a converted authorization claim remains authoritative for terminal release execution'
) ;
update withdrawal_release_snapshots snapshots
set succeeded_snapshot = jsonb_set(jsonb_set(jsonb_set(
  succeeded_snapshot,
  '{release,providerRequestId}', to_jsonb(results.result ->> 'providerRequestId')
), '{release,providerReference}', to_jsonb(results.result ->> 'providerReference')),
'{release,movementReference}', to_jsonb(results.result ->> 'movementReference'))
from withdrawal_provider_result results;
update withdrawal_release_snapshots snapshots
set succeeded_snapshot = jsonb_set(
  succeeded_snapshot, '{movements,1,movementReference}',
  to_jsonb(results.result ->> 'movementReference')
) from withdrawal_provider_result results;
select public.save_booking_request_release_snapshot(
  work_id, lease_generation, lease_token, succeeded_snapshot,
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) from withdrawal_release_snapshots;
create temporary table withdrawal_release_result as
select public.finalize_booking_request_release(
  work_id, lease_generation, lease_token
) as result
from withdrawal_release_snapshots;
reset role;
select results_eq(
  $$select result ->> 'status' from withdrawal_release_result$$,
  $$values ('withdrawn'::text)$$,
  'authoritative release persistence moves a processing withdrawal to withdrawn'
);
savepoint unresolved_journey_reuse;
update public.booking_request_authorization_reconciliation_outbox
set state='pending'
where claim_id=(select id from public.booking_request_authorization_claims);
set local role service_role;
select is(public.prepare_booking_request_submission(
  (select customer_user_id from booking_request_lifecycle_target),
  '36000000-0000-4000-8000-000000003203',
  (select submission from journey_submission)
)->>'status','invalid','a terminal request cannot hide unresolved authorization reconciliation when reusing its inquiry');
reset role;
rollback to savepoint unresolved_journey_reuse;
set local role service_role;
select is(public.prepare_booking_request_submission(
  (select customer_user_id from booking_request_lifecycle_target),
  '36000000-0000-4000-8000-000000003204',
  (select submission from journey_submission)
)->>'status','ready','a fully released unpaid request permits a new attempt in the same inquiry');
reset role;
insert into public.booking_snapshots (
  id, customer_user_id, profile_id, quote_fingerprint, intent_fingerprint,
  quote_payload, intent_payload, booking_terms_version, booking_terms_locale,
  booking_terms_body, booking_terms_sha256, cancellation_policy_version,
  acceptance_locale, acceptance_evidence, acceptance_evidence_fingerprint,
  marketplace_commission_rate_basis_points, marketplace_commission_amount_fils,
  created_at
)
select '40000000-0000-4000-8000-000000003204', customer_user_id, profile_id,
  quote_fingerprint, intent_fingerprint, quote_payload, intent_payload,
  booking_terms_version, booking_terms_locale, booking_terms_body,
  booking_terms_sha256, cancellation_policy_version, acceptance_locale,
  acceptance_evidence, acceptance_evidence_fingerprint,
  marketplace_commission_rate_basis_points, marketplace_commission_amount_fils,
  clock_timestamp()
from public.booking_snapshots limit 1;
insert into public.cottage_booking_period_commitments (
  id, customer_user_id, profile_id, schedule_revision_id,
  commitment_reference, status, access_ranges, created_at
)
select '50000000-0000-4000-8000-000000003204', customer_user_id, profile_id,
  schedule_revision_id, 'SECOND-JOURNEY-HOLD-3204', 'pending_hold',
  access_ranges, clock_timestamp()
from public.cottage_booking_period_commitments limit 1;
with prepared as (
  select *
  from public.booking_request_submission_attempts attempts
  where attempts.idempotency_key = '36000000-0000-4000-8000-000000003204'
), timed as (select clock_timestamp() created_at)
insert into public.booking_requests (
  id, booking_request_reference, customer_user_id, owner_user_id, profile_id,
  booking_snapshot_id, booking_period_commitment_id, payment_lifecycle_id,
  customer_name, party_size, booking_note, status, response_deadline, created_at
)
select '60000000-0000-4000-8000-000000003204',
  'RC-REQ-0000000000003204', prepared.customer_user_id,
  (select owner_user_id from booking_request_lifecycle_target),
  prepared.profile_id, '40000000-0000-4000-8000-000000003204',
  '50000000-0000-4000-8000-000000003204', prepared.payment_lifecycle_id,
  prepared.intent_payload->>'customerName',
  (prepared.intent_payload->>'partySize')::smallint,
  prepared.intent_payload->>'bookingNote', 'pending',
  timed.created_at + interval '4 hours', timed.created_at
from prepared cross join timed;
update public.booking_request_submission_attempts attempts
set booking_request_id = '60000000-0000-4000-8000-000000003204',
  state = 'finalized', intent_dedupe_active = false,
  updated_at = clock_timestamp()
where attempts.idempotency_key = '36000000-0000-4000-8000-000000003204';
insert into public.messaging_conversation_booking_requests (
  conversation_id, booking_request_id, submission_attempt_id, linked_at
)
select attempts.conversation_id, attempts.booking_request_id, attempts.id,
  clock_timestamp()
from public.booking_request_submission_attempts attempts
where attempts.idempotency_key = '36000000-0000-4000-8000-000000003204';
select set_config(
  'request.jwt.claim.sub',
  (select customer_user_id::text from booking_request_lifecycle_target), true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select customer_user_id from booking_request_lifecycle_target),
    'aal', 'aal1'
  )::text, true
);
set local role authenticated;
select ok(
  public.get_messaging_conversation(
    (select (result->>'conversationId')::uuid from submission_conversation),null,50
  )#>>'{booking,bookingRequestReference}' = 'RC-REQ-0000000000003204'
  and jsonb_array_length(public.get_messaging_conversation(
    (select (result->>'conversationId')::uuid from submission_conversation),null,50
  )->'bookingHistory') = 2
  and public.get_messaging_conversation(
    (select (result->>'conversationId')::uuid from submission_conversation),null,50
  )#>>'{bookingHistory,0,requestStatus}' = 'withdrawn',
  'the reader selects the latest linked request and retains the earlier terminal outcome'
);
reset role;
rollback to savepoint booking_request_withdrawal_release;

savepoint booking_request_postexpiry_admission_rejected;
set local role service_role;
select public.claim_booking_request_action(
  (select customer_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),
  'withdraw', null, null
);
reset role;
create temporary table postexpiry_release_snapshot as
select work.id as work_id, work.lease_generation, work.lease_token,
  jsonb_set(attempts.payment_snapshot, '{release}', jsonb_build_object(
    'paymentLifecycleId', attempts.payment_lifecycle_id,
    'kind', 'release',
    'logicalOperationId', attempts.payment_lifecycle_id::text || ':release',
    'attemptId', attempts.payment_lifecycle_id::text || ':release:attempt-2',
    'status', 'pending', 'amountFils', claims.amount_fils,
    'providerRequestId', null, 'providerReference', null,
    'movementReference', null, 'reconciliationRequired', false,
    'retrySafe', false
  )) as pending_snapshot
from public.booking_request_submission_attempts attempts
join public.booking_request_authorization_claims claims
  on claims.attempt_id = attempts.id
join public.booking_request_release_work work on work.attempt_id = attempts.id
where attempts.booking_request_id = (select id from booking_request_lifecycle_target);
grant select on postexpiry_release_snapshot to service_role;
set local role service_role;
create temporary table postexpiry_release_permit as
select public.save_booking_request_release_snapshot(
  work_id, lease_generation, lease_token, pending_snapshot,
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as permit
from postexpiry_release_snapshot;
reset role;
create temporary table postexpiry_provider_operation as
select jsonb_build_object(
  'providerIdentity', jsonb_build_object(
    'provider', 'fictional-payments', 'environment', 'local-test',
    'merchantId', 'fictional-merchant', 'terminalId', 'fictional-terminal'
  ),
  'permitPurpose', permit ->> 'purpose',
  'idempotencyKey', permit ->> 'idempotencyKey',
  'requestFingerprint', permit ->> 'requestFingerprint',
  'notAfter', permit ->> 'notAfter',
  'paymentLifecycleId', pending_snapshot ->> 'paymentLifecycleId',
  'logicalOperationId', pending_snapshot -> 'release' ->> 'logicalOperationId',
  'physicalAttemptId', pending_snapshot -> 'release' ->> 'attemptId',
  'operationKind', 'release',
  'amountFils', (pending_snapshot -> 'release' ->> 'amountFils')::bigint,
  'currency', 'IQD', 'claimId', null, 'claimGeneration', null,
  'stateRevision', null, 'cleanupAttemptId', null,
  'workId', permit ->> 'workId',
  'leaseGeneration', (permit ->> 'leaseGeneration')::bigint,
  'leaseToken', permit ->> 'leaseToken',
  'operationId', permit ->> 'operationId',
  'operationGeneration', (permit ->> 'operationGeneration')::integer
) as operation
from postexpiry_release_snapshot, postexpiry_release_permit;
grant select on postexpiry_provider_operation to service_role;
update public.booking_request_release_work
set lease_expires_at = clock_timestamp() - interval '1 millisecond'
where id = (select work_id from postexpiry_release_snapshot);
set local role service_role;
select throws_ok(
  format(
    'select pg_temp.payment_execute(%L::jsonb,%L)',
    (select operation::text from postexpiry_provider_operation), 'succeeded'
  ),
  'RC409', null,
  'a generation-one provider call first presented after lease expiry is rejected'
);
reset role;
select results_eq(
  $$select operations.state,
      count(provider.id)::integer
    from public.booking_request_release_operations operations
    left join public.payment_provider_operations provider
      on provider.provider_idempotency_key = operations.provider_idempotency_key
    group by operations.state$$,
  $$values ('executing'::text, 0::integer)$$,
  'post-expiry rejection records no fictional provider execution'
);
set local role service_role;
create temporary table postexpiry_reclaimed_work as
select public.claim_booking_request_action(
  (select customer_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),
  'withdraw', null, null
) as result;
reset role;
select results_eq(
  $$select (reclaimed.result ->> 'leaseGeneration')::bigint,
      reclaimed.result ->> 'leaseToken' <> original.lease_token::text,
      operations.state
    from postexpiry_reclaimed_work reclaimed
    cross join postexpiry_release_snapshot original
    cross join public.booking_request_release_operations operations$$,
  $$select lease_generation + 1, true, 'reconcile_required'::text
    from postexpiry_release_snapshot$$,
  'reclaim rotates generation and requires reconciliation of N before any retry'
);
set local role service_role;
create temporary table postexpiry_absence_result as
select pg_temp.payment_query(
  jsonb_build_object(
    'providerIdentity', jsonb_build_object(
      'provider', 'fictional-payments', 'environment', 'local-test',
      'merchantId', 'fictional-merchant', 'terminalId', 'fictional-terminal'
    ),
    'requestFingerprint', null,
    'paymentLifecycleId', pending_snapshot ->> 'paymentLifecycleId',
    'logicalOperationId', pending_snapshot -> 'release' ->> 'logicalOperationId',
    'physicalAttemptId', pending_snapshot -> 'release' ->> 'attemptId',
    'operationKind', 'release',
    'amountFils', (pending_snapshot -> 'release' ->> 'amountFils')::bigint,
    'currency', 'IQD'
  ), null, null, 'succeeded'
) as result
from postexpiry_release_snapshot;
select is(
  (select result ->> 'outcome' from postexpiry_absence_result),
  'not-executed',
  'reconciliation proves the expired operation was never admitted'
);
reset role;
select results_eq(
  $$select state, provider_outcome, retry_safe,
      provider_request_id is null, provider_reference is null,
      movement_reference is null
    from public.booking_request_release_operations$$,
  $$values ('retryable'::text, 'not_executed'::text, true, true, true, true)$$,
  'provider absence becomes durable release-only retry permission'
);
rollback to savepoint booking_request_postexpiry_admission_rejected;

savepoint booking_request_preexpiry_admission_reconcile;
set local role service_role;
create temporary table preexpiry_release_claim as
select public.claim_booking_request_action(
  (select customer_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),
  'withdraw', null, null
) as result;
reset role;
create temporary table preexpiry_release_snapshot as
select attempts.id as attempt_id, work.id as work_id,
  work.lease_generation, work.lease_token,
  jsonb_set(attempts.payment_snapshot, '{release}', jsonb_build_object(
    'paymentLifecycleId', attempts.payment_lifecycle_id,
    'kind', 'release',
    'logicalOperationId', attempts.payment_lifecycle_id::text || ':release',
    'attemptId', attempts.payment_lifecycle_id::text || ':release:attempt-2',
    'status', 'pending', 'amountFils', claims.amount_fils,
    'providerRequestId', null, 'providerReference', null,
    'movementReference', null, 'reconciliationRequired', false,
    'retrySafe', false
  )) as pending_snapshot
from public.booking_request_submission_attempts attempts
join public.booking_request_authorization_claims claims
  on claims.attempt_id = attempts.id
join public.booking_request_release_work work on work.attempt_id = attempts.id
where attempts.booking_request_id = (select id from booking_request_lifecycle_target);
grant select on preexpiry_release_snapshot to service_role;

savepoint booking_request_release_save_null_generation;
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_release_snapshot(%L::uuid,null,%L::uuid,%L::jsonb,%L::jsonb)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_token from preexpiry_release_snapshot),
    (select pending_snapshot::text from preexpiry_release_snapshot),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'RC409', null,
  'release snapshot save rejects a null lease generation'
);
reset role;
rollback to savepoint booking_request_release_save_null_generation;

savepoint booking_request_release_save_null_token;
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,null,%L::jsonb,%L::jsonb)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_generation from preexpiry_release_snapshot),
    (select pending_snapshot::text from preexpiry_release_snapshot),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'RC409', null,
  'release snapshot save rejects a null lease token'
);
reset role;
rollback to savepoint booking_request_release_save_null_token;

savepoint booking_request_release_save_null_lease;
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_release_snapshot(%L::uuid,null,null,%L::jsonb,%L::jsonb)',
    (select work_id from preexpiry_release_snapshot),
    (select pending_snapshot::text from preexpiry_release_snapshot),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'RC409', null,
  'release snapshot save rejects a null lease generation and token'
);
reset role;
rollback to savepoint booking_request_release_save_null_lease;

select results_eq(
  $$select attempts.state, requests.status, claims.state,
      count(distinct operations.id)::integer,
      count(distinct provider.id)::integer,
      count(distinct notifications.id)::integer
    from public.booking_requests requests
    join public.booking_request_submission_attempts attempts
      on attempts.booking_request_id = requests.id
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    left join public.booking_request_release_work work
      on work.attempt_id = attempts.id
    left join public.booking_request_release_operations operations
      on operations.work_id = work.id
    left join public.payment_provider_operations provider
      on provider.provider_idempotency_key = operations.provider_idempotency_key
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    where requests.id = (select id from booking_request_lifecycle_target)
    group by attempts.state, requests.status, claims.state$$,
  $$values ('finalized'::text,
      'processing'::text, 'converted'::public.booking_request_authorization_claim_state,
      0::integer, 0::integer, 0::integer)$$,
  'null release-save lease inputs issue no permit and mutate no operation, provider, or product state'
);

savepoint booking_request_pending_release_movement_invention;
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_generation from preexpiry_release_snapshot),
    (select lease_token from preexpiry_release_snapshot),
    (select jsonb_set(
      pending_snapshot,
      '{movements}',
      (pending_snapshot -> 'movements') || jsonb_build_array(jsonb_build_object(
        'kind', 'release',
        'logicalOperationId', 'invented-release',
        'attemptId', 'invented-attempt',
        'amountFils', 1,
        'movementReference', 'invented-movement',
        'recordedAt', '2099-08-21T18:00:00.000Z'
      ))
    )::text from preexpiry_release_snapshot),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  '22023', null,
  'a pending release cannot invent movement evidence'
);
reset role;
rollback to savepoint booking_request_pending_release_movement_invention;

set local role service_role;
create temporary table preexpiry_release_permit as
select public.save_booking_request_release_snapshot(
  work_id, lease_generation, lease_token, pending_snapshot,
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as permit
from preexpiry_release_snapshot;
select is(
  (select permit ->> 'purpose' from preexpiry_release_permit),
  'booking-request-release',
  'generation one durably binds the release before provider admission'
);
create temporary table preexpiry_provider_operation as
select jsonb_build_object(
  'providerIdentity', jsonb_build_object(
    'provider', 'fictional-payments', 'environment', 'local-test',
    'merchantId', 'fictional-merchant', 'terminalId', 'fictional-terminal'
  ),
  'permitPurpose', permit ->> 'purpose',
  'idempotencyKey', permit ->> 'idempotencyKey',
  'requestFingerprint', permit ->> 'requestFingerprint',
  'notAfter', permit ->> 'notAfter',
  'paymentLifecycleId', pending_snapshot ->> 'paymentLifecycleId',
  'logicalOperationId', pending_snapshot -> 'release' ->> 'logicalOperationId',
  'physicalAttemptId', pending_snapshot -> 'release' ->> 'attemptId',
  'operationKind', 'release',
  'amountFils', (pending_snapshot -> 'release' ->> 'amountFils')::bigint,
  'currency', 'IQD', 'claimId', null, 'claimGeneration', null,
  'stateRevision', null, 'cleanupAttemptId', null,
  'workId', permit ->> 'workId',
  'leaseGeneration', (permit ->> 'leaseGeneration')::bigint,
  'leaseToken', permit ->> 'leaseToken',
  'operationId', permit ->> 'operationId',
  'operationGeneration', (permit ->> 'operationGeneration')::integer
) as operation
from preexpiry_release_snapshot, preexpiry_release_permit;
grant select on preexpiry_provider_operation to service_role;

create function pg_temp.assert_null_release_bindings_rejected(target_operation jsonb)
returns void
language plpgsql
as $$
declare required_path text[];
declare required_key text;
declare invalid_operation jsonb;
begin
  foreach required_key in array array[
    'provider', 'environment', 'merchantId', 'terminalId'
  ] loop
    required_path := array['providerIdentity', required_key];
    invalid_operation := jsonb_set(target_operation, required_path, 'null'::jsonb);
    begin
      perform pg_temp.payment_execute(
        invalid_operation, 'succeeded'
      );
      raise exception 'provider accepted null required binding at %', required_path
        using errcode = 'P0001';
    exception
      when sqlstate '22023' or sqlstate 'RC409' then null;
    end;
  end loop;
  foreach required_key in array array[
    'requestFingerprint', 'paymentLifecycleId', 'logicalOperationId',
    'physicalAttemptId', 'operationKind', 'amountFils', 'currency',
    'permitPurpose', 'idempotencyKey', 'notAfter', 'workId', 'operationId',
    'operationGeneration'
  ] loop
    required_path := array[required_key];
    invalid_operation := jsonb_set(target_operation, required_path, 'null'::jsonb);
    begin
      perform pg_temp.payment_execute(
        invalid_operation, 'succeeded'
      );
      raise exception 'provider accepted null required binding at %', required_path
        using errcode = 'P0001';
    exception
      when sqlstate '22023' or sqlstate 'RC409' then null;
    end;
  end loop;
end;
$$;

savepoint booking_request_provider_null_generation;
select throws_ok(
  format(
    'select pg_temp.payment_execute(%L::jsonb,%L)',
    (select jsonb_set(operation, '{leaseGeneration}', 'null'::jsonb)::text
      from preexpiry_provider_operation),
    'succeeded'
  ),
  '22023', null,
  'provider admission rejects a JSON null lease generation before casting'
);
rollback to savepoint booking_request_provider_null_generation;

savepoint booking_request_provider_null_token;
select throws_ok(
  format(
    'select pg_temp.payment_execute(%L::jsonb,%L)',
    (select jsonb_set(operation, '{leaseToken}', 'null'::jsonb)::text
      from preexpiry_provider_operation),
    'succeeded'
  ),
  '22023', null,
  'provider admission rejects a JSON null lease token before casting'
);
rollback to savepoint booking_request_provider_null_token;

savepoint booking_request_provider_null_lease;
select throws_ok(
  format(
    'select pg_temp.payment_execute(%L::jsonb,%L)',
    (select jsonb_set(
      jsonb_set(operation, '{leaseGeneration}', 'null'::jsonb),
      '{leaseToken}', 'null'::jsonb
    )::text from preexpiry_provider_operation),
    'succeeded'
  ),
  '22023', null,
  'provider admission rejects JSON null lease generation and token before casting'
);
rollback to savepoint booking_request_provider_null_lease;

select lives_ok(
  format(
    'select pg_temp.assert_null_release_bindings_rejected(%L::jsonb)',
    (select operation::text from preexpiry_provider_operation)
  ),
  'provider admission rejects every required lifecycle release binding when JSON null'
);
select throws_ok(
  format(
    'select pg_temp.payment_execute(%L::jsonb,null)',
    (select operation::text from preexpiry_provider_operation)
  ),
  'RC409', null,
  'provider evidence rejects a null proposed outcome'
);
reset role;
select is(
  (select count(*)::integer from public.payment_provider_operations),
  1,
  'null lifecycle release bindings persist no provider execution'
);

savepoint booking_request_reconcile_movement_invention;
set local role service_role;
create temporary table preexpiry_indeterminate_provider_result as
select pg_temp.payment_execute(
  operation, 'indeterminate'
) as result
from preexpiry_provider_operation;
create temporary table preexpiry_invalid_reconcile_snapshot as
select snapshots.pending_snapshot || jsonb_build_object(
  'release', (snapshots.pending_snapshot -> 'release') || jsonb_build_object(
    'providerRequestId', provider.result ->> 'providerRequestId',
    'providerReference', provider.result ->> 'providerReference',
    'movementReference', provider.result ->> 'movementReference',
    'reconciliationRequired', true
  ),
  'movements', (snapshots.pending_snapshot -> 'movements') ||
    jsonb_build_array(jsonb_build_object(
      'kind', 'release', 'logicalOperationId', 'invented-release',
      'attemptId', 'invented-attempt', 'amountFils', 1,
      'movementReference', 'invented-movement',
      'recordedAt', '2099-08-21T18:00:00.000Z'
    ))
) as invalid_snapshot
from preexpiry_release_snapshot snapshots
cross join preexpiry_indeterminate_provider_result provider;
select throws_ok(
  format(
    'select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_generation from preexpiry_release_snapshot),
    (select lease_token from preexpiry_release_snapshot),
    (select invalid_snapshot::text from preexpiry_invalid_reconcile_snapshot),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  '22023', null,
  'a reconciliation-required release preserves the existing movement array exactly'
);
rollback to savepoint booking_request_reconcile_movement_invention;

set local role service_role;
create temporary table preexpiry_provider_result as
select pg_temp.payment_execute(
  operation, 'succeeded'
) as result
from preexpiry_provider_operation;
select is(
  (select result ->> 'outcome' from preexpiry_provider_result),
  'succeeded',
  'the provider admits generation one before its database lease expires'
);
reset role;
create temporary table preexpiry_release_success as
select snapshots.pending_snapshot || jsonb_build_object(
  'release', (snapshots.pending_snapshot -> 'release') || jsonb_build_object(
    'status', 'succeeded',
    'providerRequestId', provider.result ->> 'providerRequestId',
    'providerReference', provider.result ->> 'providerReference',
    'movementReference', provider.result ->> 'movementReference',
    'reconciliationRequired', false, 'retrySafe', false
  ),
  'movements', (snapshots.pending_snapshot -> 'movements') ||
    jsonb_build_array(jsonb_build_object(
      'kind', 'release',
      'logicalOperationId', snapshots.pending_snapshot -> 'release' ->> 'logicalOperationId',
      'attemptId', snapshots.pending_snapshot -> 'release' ->> 'attemptId',
      'amountFils', (snapshots.pending_snapshot -> 'release' ->> 'amountFils')::bigint,
      'movementReference', provider.result ->> 'movementReference',
      'recordedAt', '2099-08-21T18:00:00.000Z'
    ))
) as succeeded_snapshot
from preexpiry_release_snapshot snapshots
cross join preexpiry_provider_result provider;
grant select on preexpiry_release_success to service_role;

create temporary table preexpiry_release_state_before_invalid_evidence as
select
  (select to_jsonb(attempts) from public.booking_request_submission_attempts attempts
    where attempts.id = snapshots.attempt_id) as attempt_row,
  (select to_jsonb(work) from public.booking_request_release_work work
    where work.id = snapshots.work_id) as work_row,
  (select to_jsonb(operations) from public.booking_request_release_operations operations
    where operations.work_id = snapshots.work_id) as operation_row,
  (select to_jsonb(requests) from public.booking_requests requests
    join public.booking_request_submission_attempts attempts
      on attempts.booking_request_id = requests.id
    where attempts.id = snapshots.attempt_id) as request_row,
  (select to_jsonb(commitments) from public.cottage_booking_period_commitments commitments
    join public.booking_requests requests
      on requests.booking_period_commitment_id = commitments.id
    join public.booking_request_submission_attempts attempts
      on attempts.booking_request_id = requests.id
    where attempts.id = snapshots.attempt_id) as commitment_row,
  (select to_jsonb(provider_operations)
    from public.payment_provider_operations provider_operations
    join public.booking_request_release_operations operations
      on operations.provider_idempotency_key = provider_operations.provider_idempotency_key
    where operations.work_id = snapshots.work_id) as provider_row
from preexpiry_release_snapshot snapshots;

create temporary table preexpiry_invalid_release_movements (
  case_name text primary key,
  invalid_snapshot jsonb not null
);
insert into preexpiry_invalid_release_movements (case_name, invalid_snapshot)
select 'omits the actual release movement',
  jsonb_set(succeeded_snapshot, '{movements}',
    (succeeded_snapshot -> 'movements') - 1)
from preexpiry_release_success
union all
select 'appends invented movement evidence',
  jsonb_set(succeeded_snapshot, '{movements}',
    (succeeded_snapshot -> 'movements') || jsonb_build_array(jsonb_build_object(
      'kind', 'release', 'logicalOperationId', 'invented-release',
      'attemptId', 'invented-attempt', 'amountFils', 1,
      'movementReference', 'invented-movement',
      'recordedAt', '2099-08-21T18:00:00.000Z'
    )))
from preexpiry_release_success
union all
select 'alters the prior authorization movement',
  jsonb_set(succeeded_snapshot, '{movements,0,amountFils}', '1'::jsonb)
from preexpiry_release_success
union all
select 'changes the release movement kind',
  jsonb_set(succeeded_snapshot, '{movements,1,kind}', '"authorization"'::jsonb)
from preexpiry_release_success
union all
select 'changes the release movement amount',
  jsonb_set(succeeded_snapshot, '{movements,1,amountFils}', '1'::jsonb)
from preexpiry_release_success
union all
select 'changes the release movement logical operation',
  jsonb_set(succeeded_snapshot, '{movements,1,logicalOperationId}', '"invented-release"'::jsonb)
from preexpiry_release_success
union all
select 'changes the release movement physical attempt',
  jsonb_set(succeeded_snapshot, '{movements,1,attemptId}', '"invented-attempt"'::jsonb)
from preexpiry_release_success
union all
select 'changes the release movement provider reference',
  jsonb_set(succeeded_snapshot, '{movements,1,movementReference}', '"invented-movement"'::jsonb)
from preexpiry_release_success
union all
select 'changes the release provider request identifier',
  jsonb_set(succeeded_snapshot, '{release,providerRequestId}', '"invented-request"'::jsonb)
from preexpiry_release_success
union all
select 'changes the release provider operation reference',
  jsonb_set(succeeded_snapshot, '{release,providerReference}', '"invented-reference"'::jsonb)
from preexpiry_release_success;
grant select on preexpiry_invalid_release_movements to service_role;

create function pg_temp.assert_release_result_evidence_rejected(
  target_snapshot jsonb
) returns void
language plpgsql
as $$
begin
  begin
    perform public.save_booking_request_release_snapshot(
      (select work_id from preexpiry_release_snapshot),
      (select lease_generation from preexpiry_release_snapshot),
      (select lease_token from preexpiry_release_snapshot),
      target_snapshot,
      '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    );
    raise exception 'release save accepted invalid movement evidence'
      using errcode = 'P0001';
  exception
    when sqlstate '22023' then null;
  end;
end;
$$;

set local role service_role;
select lives_ok(
  format(
    'select pg_temp.assert_release_result_evidence_rejected(%L::jsonb)',
    invalid_snapshot::text
  ),
  'successful release snapshot ' || case_name
)
from preexpiry_invalid_release_movements
order by case_name;
reset role;

select results_eq(
  $$select
      to_jsonb(attempts), to_jsonb(work), to_jsonb(operations),
      to_jsonb(requests), to_jsonb(commitments), to_jsonb(provider_operations)
    from preexpiry_release_snapshot snapshots
    join public.booking_request_submission_attempts attempts
      on attempts.id = snapshots.attempt_id
    join public.booking_request_release_work work on work.id = snapshots.work_id
    join public.booking_request_release_operations operations
      on operations.work_id = snapshots.work_id
    join public.booking_requests requests
      on requests.id = attempts.booking_request_id
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.payment_provider_operations provider_operations
      on provider_operations.provider_idempotency_key = operations.provider_idempotency_key$$,
  $$select attempt_row, work_row, operation_row, request_row, commitment_row, provider_row
    from preexpiry_release_state_before_invalid_evidence$$,
  'invalid release movement evidence mutates no attempt, work, operation, request, hold, or provider row'
);

savepoint booking_request_finalize_null_lease_inputs;
select public.save_booking_request_release_snapshot(
  snapshots.work_id, snapshots.lease_generation, snapshots.lease_token,
  succeeded.succeeded_snapshot,
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
)
from preexpiry_release_snapshot snapshots
cross join preexpiry_release_success succeeded;

savepoint booking_request_finalize_null_generation;
select throws_ok(
  format(
    'select public.finalize_booking_request_release(%L::uuid,null,%L::uuid)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_token from preexpiry_release_snapshot)
  ),
  'RC409', null,
  'release finalization rejects a null lease generation'
);
rollback to savepoint booking_request_finalize_null_generation;

savepoint booking_request_finalize_null_token;
select throws_ok(
  format(
    'select public.finalize_booking_request_release(%L::uuid,%L::bigint,null)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_generation from preexpiry_release_snapshot)
  ),
  'RC409', null,
  'release finalization rejects a null lease token'
);
rollback to savepoint booking_request_finalize_null_token;

savepoint booking_request_finalize_null_lease;
select throws_ok(
  format(
    'select public.finalize_booking_request_release(%L::uuid,null,null)',
    (select work_id from preexpiry_release_snapshot)
  ),
  'RC409', null,
  'release finalization rejects a null lease generation and token'
);
rollback to savepoint booking_request_finalize_null_lease;

select results_eq(
  $$select requests.status, work.state, claims.state,
      commitments.status, bool_and(occupancies.active),
      count(distinct notifications.id)::integer
    from public.booking_requests requests
    join public.booking_request_submission_attempts attempts
      on attempts.booking_request_id = requests.id
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    join public.booking_request_release_work work on work.attempt_id = attempts.id
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = commitments.id
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    where requests.id = (select id from booking_request_lifecycle_target)
    group by requests.status, work.state, claims.state, commitments.status$$,
  $$values ('processing'::text, 'processing'::text,
      'converted'::public.booking_request_authorization_claim_state,
      'pending_hold'::public.cottage_inventory_commitment_status,
      true, 0::integer)$$,
  'null finalize lease inputs change no request, release work, hold, occupancy, or notice'
);
rollback to savepoint booking_request_finalize_null_lease_inputs;

update public.booking_request_release_work
set lease_expires_at = clock_timestamp() - interval '1 millisecond'
where id = (select work_id from preexpiry_release_snapshot);
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_generation from preexpiry_release_snapshot),
    (select lease_token from preexpiry_release_snapshot),
    (select succeeded_snapshot::text from preexpiry_release_success),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'RC409', null,
  'an admitted generation-one result cannot save after lease expiry'
);
select throws_ok(
  format(
    'select public.finalize_booking_request_release(%L::uuid,%L::bigint,%L::uuid)',
    (select work_id from preexpiry_release_snapshot),
    (select lease_generation from preexpiry_release_snapshot),
    (select lease_token from preexpiry_release_snapshot)
  ),
  'RC409', null,
  'an expired generation cannot finalize product state'
);
create temporary table preexpiry_reclaimed_work as
select public.claim_booking_request_action(
  (select customer_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),
  'withdraw', null, null
) as result;
select results_eq(
  $$select reclaimed.result ->> 'status',
      (reclaimed.result ->> 'leaseGeneration')::bigint,
      reclaimed.result ->> 'leaseToken' <> original.lease_token::text
    from preexpiry_reclaimed_work reclaimed
    cross join preexpiry_release_snapshot original$$,
  $$select 'release-required'::text, lease_generation + 1, true
    from preexpiry_release_snapshot$$,
  'generation two receives a new token while retaining the same release work'
);
reset role;
select results_eq(
  $$select operations.state, operations.provider_outcome,
      attempts.payment_snapshot -> 'release' ->> 'attemptId',
      (attempts.payment_snapshot -> 'release' ->> 'reconciliationRequired')::boolean,
      requests.status, commitments.status::text,
      bool_and(occupancies.active), count(notifications.id)::integer
    from public.booking_request_release_operations operations
    join public.booking_request_release_work work on work.id = operations.work_id
    join public.booking_request_submission_attempts attempts on attempts.id = work.attempt_id
    join public.booking_requests requests on requests.id = work.booking_request_id
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = commitments.id
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    group by operations.state, operations.provider_outcome,
      attempts.payment_snapshot, requests.status, commitments.status$$,
  $$select 'reconcile_required'::text, 'unknown'::text,
      pending_snapshot -> 'release' ->> 'attemptId', true,
      'processing'::text, 'pending_hold'::text, true, 0::integer
    from preexpiry_release_snapshot$$,
  'reclaim fences stale writes without treating lease expiry as provider cancellation'
);

set local role service_role;
create temporary table preexpiry_reconciled_result as
select pg_temp.payment_query(
  jsonb_build_object(
    'providerIdentity', jsonb_build_object(
      'provider', 'fictional-payments', 'environment', 'local-test',
      'merchantId', 'fictional-merchant', 'terminalId', 'fictional-terminal'
    ),
    'requestFingerprint', null,
    'paymentLifecycleId', pending_snapshot ->> 'paymentLifecycleId',
    'logicalOperationId', pending_snapshot -> 'release' ->> 'logicalOperationId',
    'physicalAttemptId', pending_snapshot -> 'release' ->> 'attemptId',
    'operationKind', 'release',
    'amountFils', (pending_snapshot -> 'release' ->> 'amountFils')::bigint,
    'currency', 'IQD'
  ),
  provider.result ->> 'providerRequestId',
  provider.result ->> 'providerReference',
  'succeeded'
) as result
from preexpiry_release_snapshot
cross join preexpiry_provider_result provider;
select is(
  (select result ->> 'outcome' from preexpiry_reconciled_result),
  'succeeded',
  'generation two reconciles the exact admitted generation-one provider binding'
);
select public.save_booking_request_release_snapshot(
  (select work_id from preexpiry_release_snapshot),
  ((select result ->> 'leaseGeneration' from preexpiry_reclaimed_work))::bigint,
  ((select result ->> 'leaseToken' from preexpiry_reclaimed_work))::uuid,
  (select succeeded_snapshot from preexpiry_release_success),
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
);
create temporary table preexpiry_finalized as
select public.finalize_booking_request_release(
  (select work_id from preexpiry_release_snapshot),
  ((select result ->> 'leaseGeneration' from preexpiry_reclaimed_work))::bigint,
  ((select result ->> 'leaseToken' from preexpiry_reclaimed_work))::uuid
) as result;
select is(
  (select result ->> 'status' from preexpiry_finalized),
  'withdrawn',
  'only the current generation finalizes the reconciled release'
);
reset role;
select results_eq(
  $$select requests.status, work.state, commitments.status::text,
      bool_and(not occupancies.active), count(distinct notifications.id)::integer,
      count(distinct operations.id)::integer,
      count(distinct provider.id)::integer,
      jsonb_array_length(attempts.payment_snapshot -> 'movements')
    from public.booking_requests requests
    join public.booking_request_release_work work on work.booking_request_id = requests.id
    join public.booking_request_submission_attempts attempts on attempts.id = work.attempt_id
    join public.cottage_booking_period_commitments commitments
      on commitments.id = requests.booking_period_commitment_id
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.booking_period_commitment_id = commitments.id
    join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    join public.booking_request_release_operations operations on operations.work_id = work.id
    join public.payment_provider_operations provider
      on provider.payment_lifecycle_id = attempts.payment_lifecycle_id
      and provider.operation_kind = 'release'
    group by requests.status, work.state, commitments.status, attempts.payment_snapshot$$,
  $$values ('withdrawn'::text, 'complete'::text, 'released_hold'::text,
    true, 2::integer, 1::integer, 1::integer, 2::integer)$$,
  'reconciliation produces one release, released hold, terminal outcome, and notice pair'
);
select set_eq(
  $$select * from public.public_cottage_inventory_units(
    '60000000-0000-4000-8000-000000003201', '2099-08-20', '2099-08-22'
  )$$,
  'inventory_units_from_helpers',
  'set-based inventory unit rows match the unit helpers after the Pending Hold is released'
);

set local role anon;
select results_eq(
  $$select unit ->> 'kind', (unit ->> 'available')::boolean
    from jsonb_array_elements(public.resolve_cottage_inventory_public_availability(
      '30000000-0000-4000-8000-000000003201',
      '60000000-0000-4000-8000-000000003201', '2099-08-21'
    ) -> 'units') unit
    where unit ->> 'id' in (
      '62000000-0000-4000-8000-000000003202',
      '61000000-0000-4000-8000-000000003201'
    ) order by unit ->> 'kind'$$,
  $$values ('full_day_bundle'::text, true), ('shift'::text, true)$$,
  'a successful Shift release restores its Shift and derived Full-Day public availability'
);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select results_eq(
  $$select unit ->> 'kind', unit ->> 'calendarState',
      unit ->> 'commitmentReference', (unit ->> 'editable')::boolean
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000003201',
      '60000000-0000-4000-8000-000000003201', '2099-08-21'
    ) -> 'units') unit
    where unit ->> 'id' in (
      '62000000-0000-4000-8000-000000003202',
      '61000000-0000-4000-8000-000000003201'
    ) order by unit ->> 'kind'$$,
  $$values
    ('full_day_bundle'::text, 'open'::text, null::text, true),
    ('shift'::text, 'open'::text, null::text, true)$$,
  'the Owner Calendar treats released Shift history as open and editable'
);
select lives_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201', '2099-08-21',
    '[{"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003202","state":"closed"},{"unitKind":"full_day_bundle","unitId":"61000000-0000-4000-8000-000000003201","state":"closed"}]'::jsonb
  )$$,
  'released occupancy history does not block changed-state Owner writes'
);
select throws_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201', '2099-08-21',
    '[{"unitKind":"full_day_bundle","unitId":"61000000-0000-4000-8000-000000003201","state":"open"}]'::jsonb
  )$$,
  'RC205', null,
  'a released occupancy cannot hide a closed component when reopening its Full-Day Bundle'
);
reset role;
select results_eq(
  $$select
      count(*) filter (where availability.state = 'closed')::integer,
      count(*) filter (where not occupancies.active)::integer
    from public.cottage_inventory_availability availability
    cross join public.cottage_booking_period_occupancies occupancies
    where availability.schedule_revision_id = '60000000-0000-4000-8000-000000003201'
      and availability.service_day = '2099-08-21'
      and availability.unit_id in (
        '62000000-0000-4000-8000-000000003202',
        '61000000-0000-4000-8000-000000003201'
      )
      and occupancies.booking_period_commitment_id = (
        select booking_period_commitment_id from public.booking_requests limit 1
      )$$,
  $$values (2::integer, 2::integer)$$,
  'failed Bundle reopening mutates no availability and preserves inactive occupancy history'
);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select lives_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201', '2099-08-21',
    '[{"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003202","state":"open"},{"unitKind":"full_day_bundle","unitId":"61000000-0000-4000-8000-000000003201","state":"open"}]'::jsonb
  )$$,
  'the Owner can restore a released Shift and its Full-Day Bundle together'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select lives_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201',
    '{"units":[
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003201","standardPriceIqd":100000},
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003202","standardPriceIqd":110000,"dateOverrides":[{"serviceDay":"2099-08-21","priceIqd":111000}]},
      {"unitKind":"full_day_bundle","unitId":"61000000-0000-4000-8000-000000003201","standardPriceIqd":190000}
    ]}'::jsonb
  )$$,
  'released Shift history permits a direct future specific-date price change'
);
reset role;
select results_eq(
  $$select
      (select price_iqd from public.cottage_inventory_date_price_overrides
        where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
          and unit_kind = 'shift'::public.cottage_inventory_unit_kind
          and unit_id = '62000000-0000-4000-8000-000000003202'
          and service_day = '2099-08-21'),
      (select committed_price_iqd from public.cottage_inventory_commitments items
        join public.booking_requests requests
          on requests.booking_period_commitment_id = items.booking_period_commitment_id
        where items.unit_kind = 'shift'::public.cottage_inventory_unit_kind
          and items.unit_id = '62000000-0000-4000-8000-000000003202'
          and items.service_day = '2099-08-21'),
      (select count(*)::integer from public.cottage_booking_period_occupancies occupancies
        join public.booking_requests requests
          on requests.booking_period_commitment_id = occupancies.booking_period_commitment_id
        where occupancies.shift_id = '62000000-0000-4000-8000-000000003202'
          and occupancies.service_day = '2099-08-21'
          and not occupancies.active)$$,
  $$values (111000::bigint, 110000::bigint, 1::integer)$$,
  'released Shift pricing retains its committed price and inactive occupancy history'
);

insert into public.cottage_booking_period_commitments (
  id, customer_user_id, profile_id, schedule_revision_id,
  commitment_reference, status, access_ranges
) values (
  '70000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003203',
  '30000000-0000-4000-8000-000000003201',
  '60000000-0000-4000-8000-000000003201',
  'RC-RELEASED-BUNDLE-3201', 'released_hold',
  tstzmultirange(tstzrange('2099-08-22 05:00+00', '2099-08-22 20:00+00', '[)'))
);
insert into public.cottage_inventory_commitments (
  booking_period_commitment_id, unit_kind, unit_id, service_day, committed_price_iqd
) values (
  '70000000-0000-4000-8000-000000003201', 'full_day_bundle',
  '61000000-0000-4000-8000-000000003201', '2099-08-22', 190000
);
insert into public.cottage_booking_period_occupancies (
  booking_period_commitment_id, schedule_revision_id, shift_id, service_day, active
)
select '70000000-0000-4000-8000-000000003201',
  '60000000-0000-4000-8000-000000003201', shifts.id, '2099-08-22', false
from public.cottage_shifts shifts
where shifts.schedule_revision_id = '60000000-0000-4000-8000-000000003201';

set local role anon;
select results_eq(
  $$select count(*)::integer
    from jsonb_array_elements(public.resolve_cottage_inventory_public_availability(
      '30000000-0000-4000-8000-000000003201',
      '60000000-0000-4000-8000-000000003201', '2099-08-22'
    ) -> 'units') unit
    where (unit ->> 'available')::boolean$$,
  $$values (3::integer)$$,
  'released Full-Day history restores its direct Bundle and both derived Shifts publicly'
);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select results_eq(
  $$select count(*)::integer
    from jsonb_array_elements(public.resolve_cottage_inventory_owner_calendar(
      '30000000-0000-4000-8000-000000003201',
      '60000000-0000-4000-8000-000000003201', '2099-08-22'
    ) -> 'units') unit
    where unit ->> 'calendarState' = 'open'
      and unit ->> 'commitmentReference' is null
      and (unit ->> 'editable')::boolean$$,
  $$values (3::integer)$$,
  'the Owner Calendar ignores direct and bundle-derived released Full-Day history'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select lives_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201',
    '{"units":[
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003201","standardPriceIqd":100000},
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003202","standardPriceIqd":110000},
      {"unitKind":"full_day_bundle","unitId":"61000000-0000-4000-8000-000000003201","standardPriceIqd":190000,"dateOverrides":[{"serviceDay":"2099-08-22","priceIqd":191000}]}
    ]}'::jsonb
  )$$,
  'released Full-Day history permits a direct future specific-date price change'
);
reset role;
select results_eq(
  $$select
      (select price_iqd from public.cottage_inventory_date_price_overrides
        where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
          and unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
          and unit_id = '61000000-0000-4000-8000-000000003201'
          and service_day = '2099-08-22'),
      (select committed_price_iqd from public.cottage_inventory_commitments
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003201'),
      (select count(*) filter (where not active)::integer
        from public.cottage_booking_period_occupancies
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003201')$$,
  $$values (191000::bigint, 190000::bigint, 2::integer)$$,
  'released Full-Day pricing preserves its committed price and both inactive component occupancies'
);

insert into public.cottage_shift_schedule_revisions (
  id, profile_id, revision, full_day_bundle_id
) values (
  '60000000-0000-4000-8000-000000003202',
  '30000000-0000-4000-8000-000000003201', 2,
  '61000000-0000-4000-8000-000000003202'
);

savepoint booking_request_active_confirmed_inventory_control;
insert into public.cottage_booking_period_commitments (
  id, customer_user_id, profile_id, schedule_revision_id,
  commitment_reference, status, access_ranges
) values (
  '70000000-0000-4000-8000-000000003202',
  '00000000-0000-0000-0000-000000003203',
  '30000000-0000-4000-8000-000000003201',
  '60000000-0000-4000-8000-000000003201',
  'RC-ACTIVE-CONFIRMED-3201', 'confirmed_booking',
  tstzmultirange(tstzrange('2099-08-22 05:00+00', '2099-08-22 09:00+00', '[)'))
);
insert into public.cottage_inventory_commitments (
  booking_period_commitment_id, unit_kind, unit_id, service_day, committed_price_iqd
) values (
  '70000000-0000-4000-8000-000000003202', 'shift',
  '62000000-0000-4000-8000-000000003201', '2099-08-22', 100000
);
insert into public.cottage_booking_period_occupancies (
  booking_period_commitment_id, schedule_revision_id, shift_id, service_day
) values (
  '70000000-0000-4000-8000-000000003202',
  '60000000-0000-4000-8000-000000003201',
  '62000000-0000-4000-8000-000000003201', '2099-08-22'
);
set local role anon;
select results_eq(
  $$select unit ->> 'kind', (unit ->> 'available')::boolean
    from jsonb_array_elements(public.resolve_cottage_inventory_public_availability(
      '30000000-0000-4000-8000-000000003201',
      '60000000-0000-4000-8000-000000003201', '2099-08-22'
    ) -> 'units') unit
    where unit ->> 'id' in (
      '62000000-0000-4000-8000-000000003201',
      '61000000-0000-4000-8000-000000003201'
    ) order by unit ->> 'kind'$$,
  $$values ('full_day_bundle'::text, false), ('shift'::text, false)$$,
  'an active Confirmed Booking still blocks its Shift and derived Full-Day Bundle'
);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select throws_ok(
  $$select public.set_cottage_inventory_availability(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201', '2099-08-22',
    '[{"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003201","state":"closed"}]'::jsonb
  )$$,
  'RC204', null,
  'an active Confirmed Booking still blocks changed-state Owner writes'
);
reset role;
select results_eq(
  $$select availability.state::text, occupancies.active
    from public.cottage_inventory_availability availability
    join public.cottage_booking_period_occupancies occupancies
      on occupancies.schedule_revision_id = availability.schedule_revision_id
      and occupancies.shift_id = availability.unit_id
      and occupancies.service_day = availability.service_day
    where occupancies.booking_period_commitment_id =
      '70000000-0000-4000-8000-000000003202'$$,
  $$values ('open'::text, true)$$,
  'a blocked active-Booking write mutates neither inventory nor occupancy'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select throws_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201',
    '{"units":[
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003201","standardPriceIqd":100000,"dateOverrides":[{"serviceDay":"2099-08-22","priceIqd":101000}]},
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003202","standardPriceIqd":110000},
      {"unitKind":"full_day_bundle","unitId":"61000000-0000-4000-8000-000000003201","standardPriceIqd":190000}
    ]}'::jsonb
  )$$,
  'RC204', null,
  'an active Confirmed Shift Booking rejects a direct specific-date price change'
);
reset role;
select results_eq(
  $$select
      (select count(*)::integer from public.cottage_inventory_date_price_overrides
        where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
          and unit_kind = 'shift'::public.cottage_inventory_unit_kind
          and unit_id = '62000000-0000-4000-8000-000000003201'
          and service_day = '2099-08-22'),
      (select committed_price_iqd from public.cottage_inventory_commitments
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003202'),
      (select active from public.cottage_booking_period_occupancies
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003202')$$,
  $$values (0::integer, 100000::bigint, true)$$,
  'a rejected active Shift price change leaves pricing and committed occupancy unchanged'
);

insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select schedule_revision_id, unit_kind, unit_id, '2099-08-23', 'open'
from public.cottage_inventory_standard_prices
where schedule_revision_id = '60000000-0000-4000-8000-000000003201';
insert into public.cottage_booking_period_commitments (
  id, customer_user_id, profile_id, schedule_revision_id,
  commitment_reference, status, access_ranges
) values (
  '70000000-0000-4000-8000-000000003203',
  '00000000-0000-0000-0000-000000003202',
  '30000000-0000-4000-8000-000000003201',
  '60000000-0000-4000-8000-000000003201',
  'RC-ACTIVE-FULL-DAY-3201', 'confirmed_booking',
  tstzmultirange(tstzrange('2099-08-23 05:00+00', '2099-08-23 20:00+00', '[)'))
);
insert into public.cottage_inventory_commitments (
  booking_period_commitment_id, unit_kind, unit_id, service_day, committed_price_iqd
) values (
  '70000000-0000-4000-8000-000000003203', 'full_day_bundle',
  '61000000-0000-4000-8000-000000003201', '2099-08-23', 190000
);
insert into public.cottage_booking_period_occupancies (
  booking_period_commitment_id, schedule_revision_id, shift_id, service_day
)
select '70000000-0000-4000-8000-000000003203',
  '60000000-0000-4000-8000-000000003201', shifts.id, '2099-08-23'
from public.cottage_shifts shifts
where shifts.schedule_revision_id = '60000000-0000-4000-8000-000000003201';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
select throws_ok(
  $$select public.save_cottage_inventory_pricing(
    '30000000-0000-4000-8000-000000003201',
    '60000000-0000-4000-8000-000000003201',
    '{"units":[
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003201","standardPriceIqd":100000},
      {"unitKind":"shift","unitId":"62000000-0000-4000-8000-000000003202","standardPriceIqd":110000},
      {"unitKind":"full_day_bundle","unitId":"61000000-0000-4000-8000-000000003201","standardPriceIqd":190000,"dateOverrides":[{"serviceDay":"2099-08-23","priceIqd":191000}]}
    ]}'::jsonb
  )$$,
  'RC204', null,
  'an active Confirmed Full-Day Booking rejects a direct specific-date price change'
);
reset role;
select results_eq(
  $$select
      (select count(*)::integer from public.cottage_inventory_date_price_overrides
        where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
          and unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
          and unit_id = '61000000-0000-4000-8000-000000003201'
          and service_day = '2099-08-23'),
      (select committed_price_iqd from public.cottage_inventory_commitments
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003203'),
      (select count(*) filter (where active)::integer
        from public.cottage_booking_period_occupancies
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003203')$$,
  $$values (0::integer, 190000::bigint, 2::integer)$$,
  'a rejected active Full-Day price change leaves pricing and both committed occupancies unchanged'
);

select throws_ok(
  $$update public.owner_application_cottage_profiles
    set current_shift_schedule_id = '60000000-0000-4000-8000-000000003202'
    where id = '30000000-0000-4000-8000-000000003201'$$,
  'RC204', null,
  'an active Booking prevents replacement of its current Shift Schedule'
);
select results_eq(
  $$select
      (select current_shift_schedule_id from public.owner_application_cottage_profiles
        where id = '30000000-0000-4000-8000-000000003201'),
      (select count(*)::integer from public.cottage_shift_schedule_revisions
        where id = '60000000-0000-4000-8000-000000003201'),
      (select count(*)::integer from public.cottage_inventory_commitments
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003203'),
      (select count(*) filter (where active)::integer
        from public.cottage_booking_period_occupancies
        where booking_period_commitment_id = '70000000-0000-4000-8000-000000003203')$$,
  $$values ('60000000-0000-4000-8000-000000003201'::uuid, 1::integer, 1::integer, 2::integer)$$,
  'a rejected active schedule replacement preserves its pointer, revision, commitment, and occupancy audit'
);
rollback to savepoint booking_request_active_confirmed_inventory_control;

select lives_ok(
  $$update public.owner_application_cottage_profiles
    set current_shift_schedule_id = '60000000-0000-4000-8000-000000003202'
    where id = '30000000-0000-4000-8000-000000003201'$$,
  'released future inventory permits replacement of its current Shift Schedule'
);
select results_eq(
  $$select
      (select current_shift_schedule_id from public.owner_application_cottage_profiles
        where id = '30000000-0000-4000-8000-000000003201'),
      (select count(*)::integer from public.cottage_shift_schedule_revisions
        where id = '60000000-0000-4000-8000-000000003201'),
      (select count(*)::integer from public.cottage_booking_period_commitments periods
        join public.booking_requests requests
          on requests.booking_period_commitment_id = periods.id),
      (select count(*)::integer from public.cottage_inventory_commitments items
        join public.booking_requests requests
          on requests.booking_period_commitment_id = items.booking_period_commitment_id),
      (select count(*)::integer from public.cottage_booking_period_occupancies occupancies
        join public.booking_requests requests
          on requests.booking_period_commitment_id = occupancies.booking_period_commitment_id
        where not occupancies.active)$$,
  $$values ('60000000-0000-4000-8000-000000003202'::uuid, 1::integer, 1::integer, 1::integer, 1::integer)$$,
  'released schedule replacement preserves its old revision, commitment, item, and inactive occupancy audit'
);
rollback to savepoint booking_request_preexpiry_admission_reconcile;

create or replace function pg_temp.ordinary_release_quarantine_case(target_outcome text)
returns text language plpgsql security invoker as $case$
declare prior_role text:=current_setting('role');
begin
  create temporary table quarantine_snapshots as
  select attempts.id as attempt_id, work.id as work_id,
    work.lease_generation, work.lease_token,
    jsonb_set(attempts.payment_snapshot, '{release}', jsonb_build_object(
      'paymentLifecycleId', attempts.payment_lifecycle_id,
      'kind', 'release',
      'logicalOperationId', attempts.payment_lifecycle_id::text || ':release',
      'attemptId', attempts.payment_lifecycle_id::text || ':release:attempt-2',
      'status', 'pending',
      'amountFils', claims.amount_fils,
      'providerRequestId', null, 'providerReference', null,
      'movementReference', null, 'reconciliationRequired', false,
      'retrySafe', false
    )) as pending_one
  from public.booking_request_submission_attempts attempts
  join public.booking_request_authorization_claims claims
    on claims.payment_lifecycle_id = attempts.payment_lifecycle_id
  join public.booking_request_release_work work on work.attempt_id = attempts.id
  where attempts.booking_request_id = (select id from booking_request_lifecycle_target);
  grant select on quarantine_snapshots to service_role;
  perform set_config('role','service_role',true);
  create temporary table quarantine_permit as
  select public.save_booking_request_release_snapshot(
    work_id, lease_generation, lease_token, pending_one,
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  ) as permit
  from quarantine_snapshots;
  create temporary table quarantine_request as
  select jsonb_build_object(
      'providerIdentity', jsonb_build_object(
        'provider', 'fictional-payments', 'environment', 'local-test',
        'merchantId', 'fictional-merchant', 'terminalId', 'fictional-terminal'
      ),
      'permitPurpose', permit ->> 'purpose',
      'idempotencyKey', permit ->> 'idempotencyKey',
      'requestFingerprint', permit ->> 'requestFingerprint',
      'notAfter', permit ->> 'notAfter',
      'paymentLifecycleId', pending_one ->> 'paymentLifecycleId',
      'logicalOperationId', pending_one -> 'release' ->> 'logicalOperationId',
      'physicalAttemptId', pending_one -> 'release' ->> 'attemptId',
      'operationKind', 'release',
      'amountFils', (pending_one -> 'release' ->> 'amountFils')::bigint,
      'currency', 'IQD', 'claimId', null, 'claimGeneration', null,
      'stateRevision', null, 'cleanupAttemptId', null,
      'workId', permit ->> 'workId',
      'leaseGeneration', (permit ->> 'leaseGeneration')::bigint,
      'leaseToken', permit ->> 'leaseToken',
      'operationId', permit ->> 'operationId',
      'operationGeneration', (permit ->> 'operationGeneration')::integer
    ) as request
  from quarantine_snapshots, quarantine_permit;
  grant select on quarantine_request to service_role;
  create temporary table quarantine_result as
  select pg_temp.payment_execute(request, 'failed', false) as result from quarantine_request;
  perform set_config('role',prior_role,true);
  return results_eq(
    $$select work.state, to_jsonb(work)->>'quarantine_reason',
        (to_jsonb(work)->>'quarantined_at') is not null,
        work.completed_at is null, work.lease_token is null, work.lease_expires_at is null,
        requests.status, commitments.status::text,
        (select bool_and(occupancies.active) from public.cottage_booking_period_occupancies occupancies
          where occupancies.booking_period_commitment_id = commitments.id),
        attempts.state, attempts.payment_snapshot#>>'{release,status}',
        attempts.payment_snapshot#>'{release,retrySafe}', attempts.payment_snapshot#>'{release,reconciliationRequired}',
        attempts.payment_snapshot#>'{release,movementReference}',
        (select count(*) from jsonb_array_elements(attempts.payment_snapshot->'movements') movement where movement->>'kind'='release'),
        (select count(*) from public.booking_request_status_notifications notifications where notifications.booking_request_id=requests.id),
        (select count(*) from public.booking_request_payment_history history where history.booking_request_id=requests.id and history.kind='quarantine' and history.source='release-work')
      from public.booking_request_release_work work
      join public.booking_requests requests on requests.id=work.booking_request_id
      join public.booking_request_submission_attempts attempts on attempts.id=work.attempt_id
      join public.cottage_booking_period_commitments commitments on commitments.id=requests.booking_period_commitment_id
      where work.id=(select work_id from quarantine_snapshots)$$,
    $$values ('quarantined'::text,'failed-release-observation'::text,true,true,true,true,
      'processing'::text,'pending_hold'::text,true,'reconciliation_required'::text,'failed'::text,
      'false'::jsonb,'false'::jsonb,'null'::jsonb,0::bigint,0::bigint,1::bigint)$$,
    'ordinary release refusal is durably quarantined and never re-leased: ' || target_outcome
  );
end;
$case$;

savepoint ordinary_release_quarantine;
set local role service_role;
select public.claim_booking_request_action(
  (select customer_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),
  'withdraw', null, null
);
reset role;
-- Distinguish the creation instant from actual refusal detection without waiting.
update public.booking_request_release_work set created_at=now()-interval '1 day'
where booking_request_id=(select id from booking_request_lifecycle_target);
select pg_temp.ordinary_release_quarantine_case('withdraw');
insert into auth.users (id,aud,role,phone,phone_confirmed_at)
values ('00000000-0000-0000-0000-000000006220','authenticated','authenticated','+9647500006220',now());
insert into public.account_contexts (user_id,role)
values ('00000000-0000-0000-0000-000000006220','platform_administrator');
create temporary table quarantine_history_expected as
select requests.booking_request_reference,requests.customer_name,requests.customer_user_id,
  work.quarantined_at,work.created_at
from public.booking_request_release_work work
join public.booking_requests requests on requests.id=work.booking_request_id
where work.id=(select work_id from quarantine_snapshots);
grant select on quarantine_history_expected to authenticated;
savepoint suspension_preserves_quarantine;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000006220","role":"authenticated","aal":"aal2"}',true);
select lives_ok($test$
do $body$
declare request_before public.booking_requests;
declare work_before jsonb;
declare attempt_before jsonb;
declare hold_before jsonb;
declare history_before jsonb;
declare notices_before jsonb;
declare kind text;
declare target_id uuid;
declare result jsonb;
begin
  select * into request_before from public.booking_requests where id=(select id from booking_request_lifecycle_target);
  select to_jsonb(work) into work_before from public.booking_request_release_work work where booking_request_id=request_before.id;
  if work_before->>'state'<>'quarantined' then raise exception 'Definitively refused release fixture is missing'; end if;
  select to_jsonb(attempts) into attempt_before from public.booking_request_submission_attempts attempts where booking_request_id=request_before.id;
  select to_jsonb(holds) into hold_before from public.cottage_booking_period_commitments holds where id=request_before.booking_period_commitment_id;
  select jsonb_agg(to_jsonb(history) order by id) into history_before from public.booking_request_payment_history history;
  select jsonb_agg(to_jsonb(notices) order by id) into notices_before from public.booking_request_status_notifications notices;
  foreach kind in array array['customer','cottage'] loop
    target_id:=case kind when 'customer' then request_before.customer_user_id else request_before.profile_id end;
    result:=public.set_marketplace_suspension(kind,target_id,'suspend',0,'Fictional quarantined request restriction',gen_random_uuid());
    if result->>'status' is distinct from 'completed' then raise exception 'Quarantine restriction unavailable: %',result; end if;
    result:=public.set_marketplace_suspension(kind,target_id,'reactivate',1,'Prospective restoration cannot resume quarantine',gen_random_uuid());
    if result->>'status' is distinct from 'completed' then raise exception 'Prospective restoration unavailable: %',result; end if;
  end loop;
  if (select to_jsonb(requests) from public.booking_requests requests where id=request_before.id) is distinct from to_jsonb(request_before)
    or (select to_jsonb(work) from public.booking_request_release_work work where booking_request_id=request_before.id) is distinct from work_before
    or (select to_jsonb(attempts) from public.booking_request_submission_attempts attempts where booking_request_id=request_before.id) is distinct from attempt_before
    or (select to_jsonb(holds) from public.cottage_booking_period_commitments holds where id=request_before.booking_period_commitment_id) is distinct from hold_before
    or (select jsonb_agg(to_jsonb(history) order by id) from public.booking_request_payment_history history) is distinct from history_before
    or (select jsonb_agg(to_jsonb(notices) order by id) from public.booking_request_status_notifications notices) is distinct from notices_before
  then raise exception 'Restriction/restoration changed quarantined facts or invented completion'; end if;
end;
$body$;
$test$,'suspension_and_reactivation_never_resume_quarantined_release');
rollback to savepoint suspension_preserves_quarantine;

select ok((select created_at<>quarantined_at from quarantine_history_expected),
  'ordinary release quarantine history fixture distinguishes creation from quarantine');
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000006220","aal":"aal2"}',true);
set local role authenticated;
create temporary table quarantine_support_history as
select public.get_administrator_booking_request_payment_history(booking_request_reference) as result
from quarantine_history_expected;
reset role;
select results_eq(
  $$select event->>'kind',event->>'source',event->>'provenance',event->>'operationKind',
      event->>'fromState',event->>'toState',event->>'outcome',event->>'reasonCode',
      (event->>'sourceRecordedAt')::timestamptz=expected.quarantined_at,
      event-array['id','kind','source','provenance','operationKind','operationGeneration',
        'fromState','toState','outcome','reasonCode','recordedAt','sourceRecordedAt']='{}'::jsonb,
      support.result::text !~ 'fixture-(request|reference|movement)-|providerIdentity|rawPayload|signedPayload|customerName|customerUserId|bookingNote|exactAddress|phone|email',
      position(expected.customer_name in support.result::text)=0,
      position(expected.customer_user_id::text in support.result::text)=0,
      position('Private address' in support.result::text)=0
    from quarantine_support_history support,quarantine_history_expected expected,
      jsonb_array_elements(support.result->'events') event
    where event->>'kind'='quarantine' and event->>'source'='release-work'$$,
  $$values ('quarantine'::text,'release-work'::text,'observed'::text,'release'::text,
    'processing'::text,'quarantined'::text,'withdrawn'::text,'failed-release-observation'::text,
    true,true,true,true,true,true)$$,
  'ordinary release quarantine history exposes only its reason and quarantine time'
);
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003203","aal":"aal2"}',true);
set local role authenticated;
select throws_ok(
  $$select public.get_administrator_booking_request_payment_history(
    (select booking_request_reference from quarantine_history_expected))$$,
  '42501','AAL2 Platform Administrator access is required',
  'a customer cannot read ordinary release quarantine support history'
);
reset role;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201","aal":"aal2"}',true);
set local role authenticated;
select throws_ok(
  $$select public.get_administrator_booking_request_payment_history(
    (select booking_request_reference from quarantine_history_expected))$$,
  '42501','AAL2 Platform Administrator access is required',
  'a Cottage Owner cannot read ordinary release quarantine support history'
);
reset role;
create temporary table quarantine_observation as
select ledger.id as operation_id, observations.result
from public.payment_provider_operations ledger
join public.payment_provider_observations observations on observations.operation_id=ledger.id
where ledger.admission#>>'{permit,workId}'=(select work_id::text from quarantine_snapshots);
grant select on quarantine_observation, quarantine_snapshots, quarantine_result to service_role;
select results_eq(
  $$with binding as (
      select ledger,operations as operation
      from quarantine_observation observation
      join public.payment_provider_operations ledger on ledger.id=observation.operation_id
      join public.booking_request_release_operations operations
        on operations.id=(ledger.admission#>>'{permit,operationId}')::uuid
    )
    select variant.ordinal,(select count(*) from binding)=1,
      public.booking_request_release_binding_matches(binding.ledger,
        jsonb_populate_record(binding.operation,variant.patch))
    from binding
    cross join lateral (values
      (0,'{}'::jsonb),
      (1,jsonb_build_object('provider',(binding.ledger).provider||'-binding-provider')),
      (2,jsonb_build_object('environment',(binding.ledger).environment||'-binding-environment')),
      (3,jsonb_build_object('merchant_id',(binding.ledger).merchant_id||'-binding-merchant')),
      (4,jsonb_build_object('terminal_id',(binding.ledger).terminal_id||'-binding-terminal')),
      (5,jsonb_build_object('provider_idempotency_key',(binding.ledger).provider_idempotency_key||'-binding-idempotency')),
      (6,jsonb_build_object('request_fingerprint',(binding.ledger).request_fingerprint||'-binding-fingerprint')),
      (7,jsonb_build_object('payment_lifecycle_id',case
        when (binding.ledger).payment_lifecycle_id='11111111-1111-4111-8111-111111111111'::uuid
        then '22222222-2222-4222-8222-222222222222'::uuid
        else '11111111-1111-4111-8111-111111111111'::uuid end)),
      (8,jsonb_build_object('logical_operation_id',(binding.ledger).logical_operation_id||'-binding-logical')),
      (9,jsonb_build_object('physical_attempt_id',(binding.ledger).physical_attempt_id||'-binding-attempt')),
      (10,jsonb_build_object('amount_fils',(binding.ledger).amount_fils+1)),
      (11,jsonb_build_object('currency','USD'))
    ) as variant(ordinal,patch)
    order by variant.ordinal$$,
  $$values (0,true,true),(1,true,false),(2,true,false),(3,true,false),
    (4,true,false),(5,true,false),(6,true,false),(7,true,false),
    (8,true,false),(9,true,false),(10,true,false),(11,true,false)$$,
  'release binding requires every retained identity, amount and currency field'
);
create temporary table quarantine_saved as
select to_jsonb(work) as work, to_jsonb(attempts) as attempt
from public.booking_request_release_work work
join public.booking_request_submission_attempts attempts on attempts.id=work.attempt_id
where work.id=(select work_id from quarantine_snapshots);
set local role service_role;
select is(
  public.claim_booking_request_action(
    (select customer_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target),'withdraw',null,null)->>'status',
  'processing','manual action cannot revive quarantined ordinary release work'
);
select is(public.claim_booking_request_expiry((select id from booking_request_lifecycle_target))->>'status',
  'processing','expiry cannot revive quarantined ordinary release work');
select is(public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target),'decline','other',null)->>'status',
  'processing','owner decline cannot revive quarantined ordinary release work');
select ok(not exists (
  select 1
  from jsonb_array_elements(public.claim_due_booking_request_releases(50)) as claimed_release
  where claimed_release ->> 'bookingRequestReference' =
    (select booking_request_reference from booking_request_lifecycle_target)
), 'automatic due claims never return quarantined ordinary release work');
select throws_ok((select format('select public.finalize_booking_request_release(%L::uuid,%L::bigint,%L::uuid)',
  work_id,lease_generation,lease_token) from quarantine_snapshots),
  'RC409',null,'a stale worker cannot finalize quarantined ordinary release work');
select throws_ok((select format('select public.finalize_booking_request_release(%L::uuid,%L::bigint,null)',
  work_id,lease_generation) from quarantine_snapshots),
  'RC409',null,'null lease identity never finalizes quarantine');
select throws_ok((select format('select public.admit_booking_request_provider_operation(%L::jsonb)',request) from quarantine_request),
  'RC409',null,'a stale admitted permit cannot execute quarantined ordinary release work');
select is((select public.reload_booking_request_payment_operation(
  jsonb_set(request-array['permitPurpose','claimId','claimGeneration','notAfter','idempotencyKey','cleanupAttemptId','workId','leaseGeneration','leaseToken','stateRevision','operationId','operationGeneration'],
    '{requestFingerprint}','null'::jsonb),null,null)->>'status' from quarantine_request),
  'not-admitted','quarantine refuses inquiry admission for its retained operation');
select is((select public.record_booking_request_release_observation(operation_id,result,true)->'retrySafe' from quarantine_observation),
  'false'::jsonb,'duplicate refusal recording preserves canonical false provider safety');
select is((select public.record_booking_request_release_observation(operation_id,
  jsonb_set(result,'{evidence,eventId}','"later-same-refusal"'),true)->'retrySafe' from quarantine_observation),
  'false'::jsonb,'a later matching refusal remains historical evidence');
select throws_ok((select format('select public.record_booking_request_release_observation(%L::uuid,%L::jsonb,false)',operation_id,result)
  from quarantine_observation),'RC409',null,'a refusal cannot omit its explicit quarantine consequence');
select throws_ok((select format('select public.record_booking_request_release_observation(%L::uuid,%L::jsonb,null)',operation_id,result)
  from quarantine_observation),'RC409',null,'a refusal cannot omit the boolean consequence');
select throws_ok((select format('select public.record_booking_request_release_observation(%L::uuid,%L::jsonb,true)',operation_id,
  jsonb_set(result,'{evidence,operationId}','"11111111-1111-4111-8111-111111111111"')) from quarantine_observation),
  'RC409',null,'foreign provider evidence cannot quarantine an operation');
select throws_ok((select format('select public.record_booking_request_release_observation(null,%L::jsonb,true)',result) from quarantine_observation),
  'RC409',null,'null provider operation identity cannot quarantine work');
select throws_ok((select format('select public.record_booking_request_release_observation(%L::uuid,%L::jsonb,false)',operation_id,
  jsonb_set(jsonb_set(result,'{retrySafe}','true'),'{evidence,eventId}','"contradictory-safety"')) from quarantine_observation),
  'RC409',null,'a new event cannot change the accepted definitive refusal into safe failure');
select throws_ok((select format('select public.record_booking_request_release_observation(%L::uuid,%L::jsonb,true)',operation_id,
  jsonb_set(result,'{providerReference}','"hostile-reference"')) from quarantine_observation),
  'RC409',null,'hostile provider references cannot replace accepted refusal identity');
reset role;
select results_eq(
  $$select to_jsonb(work),to_jsonb(attempts) from public.booking_request_release_work work
    join public.booking_request_submission_attempts attempts on attempts.id=work.attempt_id
    where work.id=(select work_id from quarantine_snapshots)$$,
  $$select work,attempt from quarantine_saved$$,
  'duplicate and rejected late events never rewrite quarantine or payment snapshot'
);
select is((select count(*) from public.booking_request_payment_history history
  where history.booking_request_id=(select id from booking_request_lifecycle_target) and history.kind='quarantine' and history.source='release-work'),
  1::bigint,'repeated refusal creates exactly one durable quarantine event');
select ok(binding.signature is not null
  and not has_function_privilege('anon',binding.signature,'EXECUTE')
  and not has_function_privilege('authenticated',binding.signature,'EXECUTE')
  and not has_function_privilege('service_role',binding.signature,'EXECUTE'),
  'release binding predicate exists without an API execute grant')
from (select to_regprocedure('public.booking_request_release_binding_matches(public.payment_provider_operations,public.booking_request_release_operations)') as signature) binding;
select ok(not has_function_privilege('anon','public.record_booking_request_release_observation(uuid,jsonb,boolean)','EXECUTE')
  and not has_function_privilege('authenticated','public.record_booking_request_release_observation(uuid,jsonb,boolean)','EXECUTE')
  and has_function_privilege('service_role','public.record_booking_request_release_observation(uuid,jsonb,boolean)','EXECUTE')
  and not has_function_privilege('service_role','public.quarantine_booking_request_release_work(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.quarantine_booking_request_release_work(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.quarantine_booking_request_release_work(uuid)','EXECUTE'),
  'only the service recorder exposes quarantine and the safety helper has no API grant');
set local role anon;
select throws_ok($$select public.record_booking_request_release_observation(null,'{}',true)$$,'42501',null,
  'anonymous callers cannot record release quarantine');
set local role authenticated;
select throws_ok($$select public.record_booking_request_release_observation(null,'{}',true)$$,'42501',null,
  'authenticated callers cannot record release quarantine');
set local role service_role;
select throws_ok($$select public.quarantine_booking_request_release_work(null)$$,'42501',null,
  'service callers cannot invoke the internal quarantine safety helper');
reset role;
set local role anon;
select throws_ok($$select public.booking_request_release_binding_matches(
  null::public.payment_provider_operations,null::public.booking_request_release_operations)$$,'42501',null,
  'anonymous callers cannot invoke release binding');
set local role authenticated;
select throws_ok($$select public.booking_request_release_binding_matches(
  null::public.payment_provider_operations,null::public.booking_request_release_operations)$$,'42501',null,
  'authenticated callers cannot invoke release binding');
set local role service_role;
select throws_ok($$select public.booking_request_release_binding_matches(
  null::public.payment_provider_operations,null::public.booking_request_release_operations)$$,'42501',null,
  'service callers cannot invoke release binding');
reset role;
-- Explicit historical arrangement: retain the accepted false receipt while reproducing
-- the former true snapshot/terminal operation shape. This is not a new-flow fixture.
savepoint ordinary_release_legacy_shape;
update public.booking_request_release_work set state='processing',quarantined_at=null,quarantine_reason=null,
  lease_token=(select lease_token from quarantine_snapshots),
  lease_expires_at=(select (permit->>'notAfter')::timestamptz from quarantine_permit)
where id=(select work_id from quarantine_snapshots);
update public.booking_request_release_operations set state='retryable',retry_safe=true
where id=(select (permit->>'operationId')::uuid from quarantine_permit);
update public.booking_request_submission_attempts set payment_snapshot=jsonb_set(payment_snapshot,'{release,retrySafe}','true')
where id=(select attempt_id from quarantine_snapshots);
create temporary table legacy_saved as
select to_jsonb(operations) as operation,attempts.payment_snapshot as snapshot
from public.booking_request_release_operations operations
join public.booking_request_submission_attempts attempts on attempts.id=operations.attempt_id
where operations.id=(select (permit->>'operationId')::uuid from quarantine_permit);
set local role service_role;
select throws_ok((select format('select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
  work_id,lease_generation,lease_token,
  jsonb_set(pending_one,'{release,attemptId}',to_jsonb((pending_one->>'paymentLifecycleId')||':release:attempt-3')),
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')
  from quarantine_snapshots),'RC409',null,'retained unsafe evidence rejects a new physical attempt despite historical true safety');
select ok(not exists(select 1 from jsonb_array_elements(public.claim_due_booking_request_releases(50)) item
  where item->>'status'='release-required' and item->>'workId'=(select work_id::text from quarantine_snapshots)),
  'a due claim atomically quarantines historical unsafe evidence without returning an execution permit');
reset role;
select results_eq(
  $$select work.state,to_jsonb(operations),attempts.payment_snapshot
    from public.booking_request_release_work work
    join public.booking_request_release_operations operations on operations.id=work.active_operation_id
    join public.booking_request_submission_attempts attempts on attempts.id=work.attempt_id
    where work.id=(select work_id from quarantine_snapshots)$$,
  $$select 'quarantined'::text,operation,snapshot from legacy_saved$$,
  'historical true safety is quarantined without rewriting its terminal operation or snapshot'
);
rollback to savepoint ordinary_release_legacy_shape;

savepoint ordinary_release_legacy_later_attempt;
update public.booking_request_release_work set state='processing',quarantined_at=null,quarantine_reason=null,
  lease_token=(select lease_token from quarantine_snapshots),
  lease_expires_at=(select (permit->>'notAfter')::timestamptz from quarantine_permit)
where id=(select work_id from quarantine_snapshots);
update public.booking_request_release_operations set state='retryable',retry_safe=true
where id=(select (permit->>'operationId')::uuid from quarantine_permit);
create temporary table legacy_later_operation as
with inserted as (
  insert into public.booking_request_release_operations(work_id,attempt_id,operation_generation,payment_lifecycle_id,
    logical_operation_id,physical_attempt_id,amount_fils,currency,provider,environment,merchant_id,terminal_id,
    provider_idempotency_key,request_fingerprint,state,provider_outcome,execution_started_at)
  select work_id,attempt_id,operation_generation+1,payment_lifecycle_id,logical_operation_id,
    payment_lifecycle_id::text||':release:attempt-3',amount_fils,currency,provider,environment,merchant_id,terminal_id,
    'booking-request-release:'||work_id::text||':2',
    public.booking_request_release_fingerprint(provider,environment,merchant_id,terminal_id,payment_lifecycle_id,
      logical_operation_id,payment_lifecycle_id::text||':release:attempt-3',amount_fils,currency),
    'executing','unknown',clock_timestamp()
  from public.booking_request_release_operations where id=(select (permit->>'operationId')::uuid from quarantine_permit)
  returning *
) select * from inserted;
update public.booking_request_release_work set active_operation_id=(select id from legacy_later_operation)
where id=(select work_id from quarantine_snapshots);
update public.booking_request_submission_attempts set payment_snapshot=jsonb_set(
  (select pending_one from quarantine_snapshots),'{release,attemptId}',
  to_jsonb((select physical_attempt_id from legacy_later_operation)))
where id=(select attempt_id from quarantine_snapshots);
create temporary table legacy_later_snapshot as select payment_snapshot
from public.booking_request_submission_attempts where id=(select attempt_id from quarantine_snapshots);
create temporary table legacy_later_request as
select request||jsonb_build_object('operationId',operations.id,'operationGeneration',operations.operation_generation,
  'idempotencyKey',operations.provider_idempotency_key,'requestFingerprint',operations.request_fingerprint,
  'physicalAttemptId',operations.physical_attempt_id) as request
from quarantine_request,legacy_later_operation operations;
grant select on legacy_later_request,legacy_later_snapshot to service_role;
set local role service_role;
create temporary table legacy_later_admission as select public.admit_booking_request_provider_operation(request) as admission from legacy_later_request;
create temporary table legacy_later_effect as
select public.persist_simulated_payment_effect(admission-array['purpose','binding','mode'],jsonb_build_object(
  'outcome','succeeded','providerRequestId','late-success-request','providerReference','late-success-reference',
  'movementReference','late-success-movement','evidence',jsonb_build_object('operationId',admission->>'operationId',
    'eventId','late-success-event','provenance','fictional-provider','originalOutcome','succeeded',
    'executedAt',observed_at,'occurredAt',observed_at,'closedAt',null))) as result
from legacy_later_admission cross join (select clock_timestamp() as observed_at) clock;
savepoint ordinary_release_success_backed_control;
select public.record_booking_request_release_observation((admission->>'operationId')::uuid,result,false)
from legacy_later_admission,legacy_later_effect;
reset role;
select is(public.quarantine_booking_request_release_work((select work_id from quarantine_snapshots)),false,
  'an accepted successful release prevents a legacy false receipt from inventing quarantine');
select is((select state from public.booking_request_release_work where id=(select work_id from quarantine_snapshots)),
  'processing','success-backed processing work remains unchanged by the safety guard');
rollback to savepoint ordinary_release_success_backed_control;
select is(public.claim_booking_request_expiry((select id from booking_request_lifecycle_target))->>'status',
  'processing','earlier retained refusal fences a later unresolved attempt before its live lease is reused');
select is((select public.record_booking_request_release_observation((admission->>'operationId')::uuid,result,false)->>'outcome'
  from legacy_later_admission,legacy_later_effect),'succeeded',
  'an already executed later success is retained as authoritative historical evidence');
select is(public.claim_booking_request_action((select customer_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),'withdraw',null,null)->>'status','processing',
  'a late authoritative success cannot automatically resolve quarantine');
select throws_ok((select format('select public.finalize_booking_request_release(%L::uuid,%L::bigint,%L::uuid)',
  work_id,lease_generation,lease_token) from quarantine_snapshots),'RC409',null,
  'late authoritative evidence cannot bypass the terminal quarantine lease fence');
reset role;
select results_eq(
  $$select work.state,operations.state,attempts.payment_snapshot,
    (select count(*) from jsonb_array_elements(attempts.payment_snapshot->'movements') movement where movement->>'kind'='release'),
    (select count(*) from public.booking_request_status_notifications notifications where notifications.booking_request_id=work.booking_request_id)
    from public.booking_request_release_work work
    join public.booking_request_release_operations operations on operations.id=work.active_operation_id
    join public.booking_request_submission_attempts attempts on attempts.id=work.attempt_id
    where work.id=(select work_id from quarantine_snapshots)$$,
  $$select 'quarantined'::text,'executing'::text,payment_snapshot,0::bigint,0::bigint from legacy_later_snapshot$$,
  'quarantine preserves a later unresolved identity and invents no business completion after late success'
);
rollback to savepoint ordinary_release_legacy_later_attempt;
rollback to savepoint ordinary_release_quarantine;
savepoint ordinary_release_quarantine;
set local role service_role;
select public.claim_booking_request_action(
  (select owner_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),
  'decline', 'other', null
);
reset role;
select pg_temp.ordinary_release_quarantine_case('decline');
rollback to savepoint ordinary_release_quarantine;
savepoint ordinary_release_quarantine;
update public.booking_requests set created_at = due.deadline - interval '4 hours',
  response_deadline = due.deadline
from (select clock_timestamp() - interval '1 minute' as deadline) due
where id = (select id from booking_request_lifecycle_target);
set local role service_role;
select public.claim_booking_request_expiry((select id from booking_request_lifecycle_target));
reset role;
select pg_temp.ordinary_release_quarantine_case('expiry');
rollback to savepoint ordinary_release_quarantine;
savepoint booking_request_failed_release_retry;
set local role service_role;
select public.claim_booking_request_action(
  (select customer_user_id from booking_request_lifecycle_target),
  (select id from booking_request_lifecycle_target),
  'withdraw', null, null
);
reset role;
create temporary table failed_release_retry_snapshots as
select attempts.id as attempt_id, work.id as work_id,
  work.lease_generation, work.lease_token,
  jsonb_set(attempts.payment_snapshot, '{release}', jsonb_build_object(
    'paymentLifecycleId', attempts.payment_lifecycle_id,
    'kind', 'release',
    'logicalOperationId', attempts.payment_lifecycle_id::text || ':release',
    'attemptId', attempts.payment_lifecycle_id::text || ':release:attempt-2',
    'status', 'pending',
    'amountFils', claims.amount_fils,
    'providerRequestId', null, 'providerReference', null,
    'movementReference', null, 'reconciliationRequired', false,
    'retrySafe', false
  )) as pending_one
from public.booking_request_submission_attempts attempts
join public.booking_request_authorization_claims claims
  on claims.payment_lifecycle_id = attempts.payment_lifecycle_id
join public.booking_request_release_work work on work.attempt_id = attempts.id
where attempts.booking_request_id = (select id from booking_request_lifecycle_target);
alter table failed_release_retry_snapshots
  add column failed_one jsonb,
  add column pending_two jsonb;
grant select, update on failed_release_retry_snapshots to service_role;
set local role service_role;
create temporary table failed_release_retry_permit as
select public.save_booking_request_release_snapshot(
  work_id, lease_generation, lease_token, pending_one,
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
) as permit
from failed_release_retry_snapshots;
select is(
  (select permit ->> 'purpose' from failed_release_retry_permit),
  'booking-request-release',
  'a first physical release attempt is durably claimed'
);
reset role;
select throws_ok(
  $$update public.booking_request_release_operations
    set amount_fils = amount_fils + 1$$,
  'RC204', null,
  'release-operation amount and provider bindings are immutable'
);
select throws_ok(
  $$update public.booking_request_release_operations
    set state = 'retryable'$$,
  'RC204', null,
  'a release operation cannot become retryable without its required output shape'
);
select throws_ok(
  $$insert into public.booking_request_release_operations (
      id, work_id, attempt_id, operation_generation, payment_lifecycle_id,
      logical_operation_id, physical_attempt_id, amount_fils, currency,
      provider, environment, merchant_id, terminal_id,
      provider_idempotency_key, request_fingerprint, state,
      provider_outcome, execution_started_at
    )
    select gen_random_uuid(), work_id, attempt_id, operation_generation + 100,
      payment_lifecycle_id, logical_operation_id, physical_attempt_id || '-invalid',
      amount_fils, currency, provider, environment, merchant_id, terminal_id,
      provider_idempotency_key || '-invalid', request_fingerprint,
      'executing', 'failed', clock_timestamp()
    from public.booking_request_release_operations$$,
  'RC204', null,
  'invalid release-operation output shapes fail on insertion as well as update'
);
set local role service_role;
select throws_ok(
  (select format(
    'select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    work_id, lease_generation, lease_token,
    jsonb_set(pending_one, '{release,attemptId}',
      to_jsonb((pending_one ->> 'paymentLifecycleId') || ':release:attempt-3')),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ) from failed_release_retry_snapshots),
  'RC409', null,
  'operation N plus one cannot start before N is durably retryable'
);
create temporary table failed_release_retry_request as
select jsonb_build_object(
    'providerIdentity', jsonb_build_object(
      'provider', 'fictional-payments', 'environment', 'local-test',
      'merchantId', 'fictional-merchant', 'terminalId', 'fictional-terminal'
    ),
    'permitPurpose', permit ->> 'purpose',
    'idempotencyKey', permit ->> 'idempotencyKey',
    'requestFingerprint', permit ->> 'requestFingerprint',
    'notAfter', permit ->> 'notAfter',
    'paymentLifecycleId', pending_one ->> 'paymentLifecycleId',
    'logicalOperationId', pending_one -> 'release' ->> 'logicalOperationId',
    'physicalAttemptId', pending_one -> 'release' ->> 'attemptId',
    'operationKind', 'release',
    'amountFils', (pending_one -> 'release' ->> 'amountFils')::bigint,
    'currency', 'IQD', 'claimId', null, 'claimGeneration', null,
    'stateRevision', null, 'cleanupAttemptId', null,
    'workId', permit ->> 'workId',
    'leaseGeneration', (permit ->> 'leaseGeneration')::bigint,
    'leaseToken', permit ->> 'leaseToken',
    'operationId', permit ->> 'operationId',
    'operationGeneration', (permit ->> 'operationGeneration')::integer
  ) as request
from failed_release_retry_snapshots, failed_release_retry_permit;
grant select on failed_release_retry_request to service_role;
savepoint ordinary_release_retry_safety;
create temporary table ordinary_release_refusal as
select pg_temp.payment_execute(request, 'failed') as result
from failed_release_retry_request;
grant select on ordinary_release_refusal to service_role;
reset role;
create temporary table ordinary_release_refusal_observation as
select observations.operation_id, observations.result
from public.payment_provider_observations observations
join public.payment_provider_operations operations on operations.id = observations.operation_id
where operations.admission #>> '{permit,operationId}' =
  (select permit ->> 'operationId' from failed_release_retry_permit);
grant select on ordinary_release_refusal_observation to service_role;
select results_eq(
  $$select refusal.result -> 'retrySafe', observation.result -> 'retrySafe'
    from ordinary_release_refusal refusal, ordinary_release_refusal_observation observation$$,
  $$values ('false'::jsonb, 'false'::jsonb)$$,
  'ordinary release recording preserves provider retry safety'
);
set local role service_role;
select throws_ok(
  (select format('select public.record_booking_request_provider_operation_observation(%L::uuid,%L::jsonb)',
    operation_id, jsonb_set(result, '{retrySafe}', 'true'::jsonb))
    from ordinary_release_refusal_observation),
  'RC409', null,
  'the same ordinary release event cannot change accepted retry safety'
);
select throws_ok(
  (select format('select public.record_booking_request_provider_operation_observation(%L::uuid,%L::jsonb)',
    operation_id, jsonb_set(jsonb_set(result, '{retrySafe}', 'true'::jsonb),
      '{evidence,eventId}', '"changed-safety-event"'::jsonb))
    from ordinary_release_refusal_observation),
  'RC409', null,
  'a later ordinary release event cannot change accepted retry safety'
);
select throws_ok(
  (select format('select public.record_booking_request_provider_operation_observation(%L::uuid,%L::jsonb)',
    operation_id, jsonb_set(result, '{retrySafe}', safety))
    from ordinary_release_refusal_observation),
  'RC409', null,
  'ordinary release observation rejects ' || label || ' retry safety'
)
from (values ('null'::jsonb, 'null'), ('"true"'::jsonb, 'string')) malformed(safety, label);
savepoint ordinary_release_snapshot_safety;
select lives_ok(
  (select format('select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    work_id, lease_generation, lease_token,
    jsonb_set(pending_one, '{release}',
      (pending_one -> 'release') || jsonb_build_object(
        'status', 'failed', 'providerRequestId', result ->> 'providerRequestId',
        'providerReference', result ->> 'providerReference', 'retrySafe', 'false'::jsonb)),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')
    from failed_release_retry_snapshots, ordinary_release_refusal),
  'an unsafe recorded ordinary release permits only its canonical false snapshot replay'
);
rollback to savepoint ordinary_release_snapshot_safety;
savepoint ordinary_release_snapshot_safety;
select throws_ok(
  (select format('select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    work_id, lease_generation, lease_token,
    jsonb_set(pending_one, '{release}',
      (pending_one -> 'release') || jsonb_build_object(
        'status', 'failed', 'providerRequestId', result ->> 'providerRequestId',
        'providerReference', result ->> 'providerReference', 'retrySafe', 'null'::jsonb)),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')
    from failed_release_retry_snapshots, ordinary_release_refusal),
  '22023', null,
  'an unsafe recorded ordinary release cannot become retryable with null snapshot safety'
);
rollback to savepoint ordinary_release_snapshot_safety;
savepoint ordinary_release_snapshot_safety;
select throws_ok(
  (select format('select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    work_id, lease_generation, lease_token,
    jsonb_set(pending_one, '{release}',
      (pending_one -> 'release') || jsonb_build_object(
        'status', 'failed', 'providerRequestId', result ->> 'providerRequestId',
        'providerReference', result ->> 'providerReference', 'retrySafe', '"true"'::jsonb)),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')
    from failed_release_retry_snapshots, ordinary_release_refusal),
  '22023', null,
  'an unsafe recorded ordinary release cannot become retryable with string snapshot safety'
);
rollback to savepoint ordinary_release_snapshot_safety;
savepoint ordinary_release_snapshot_safety;
select throws_ok(
  (select format('select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    work_id, lease_generation, lease_token,
    jsonb_set(pending_one, '{release}',
      (pending_one -> 'release') || jsonb_build_object(
        'status', 'failed', 'providerRequestId', result ->> 'providerRequestId',
        'providerReference', result ->> 'providerReference', 'retrySafe', 'true'::jsonb)),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')
    from failed_release_retry_snapshots, ordinary_release_refusal),
  'RC409', null,
  'an unsafe recorded ordinary release cannot become retryable with forged true snapshot safety'
);
rollback to savepoint ordinary_release_snapshot_safety;
rollback to savepoint ordinary_release_retry_safety;
create temporary table failed_release_retry_provider_result as
select pg_temp.payment_execute(request, 'failed', true) as result
from failed_release_retry_request;
select results_eq(
  $$select result ->> 'outcome', result -> 'retrySafe' from failed_release_retry_provider_result$$,
  $$values ('failed'::text, 'true'::jsonb)$$,
  'the provider ledger proves attempt N failed safely before retry is allowed'
);
update failed_release_retry_snapshots snapshots set failed_one =
  jsonb_set(jsonb_set(jsonb_set(jsonb_set(pending_one,
    '{release,status}', '"failed"'::jsonb),
    '{release,providerRequestId}', to_jsonb(results.result ->> 'providerRequestId')),
    '{release,providerReference}', to_jsonb(results.result ->> 'providerReference')),
    '{release,retrySafe}', 'true'::jsonb)
from failed_release_retry_provider_result results;
update failed_release_retry_snapshots set pending_two =
  jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(failed_one,
    '{release,status}', '"pending"'::jsonb),
    '{release,attemptId}', to_jsonb((failed_one ->> 'paymentLifecycleId') || ':release:attempt-3')),
    '{release,providerRequestId}', 'null'::jsonb),
    '{release,providerReference}', 'null'::jsonb),
    '{release,retrySafe}', 'false'::jsonb);

savepoint booking_request_retryable_release_movement_invention;
select throws_ok(
  (select format(
    'select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    work_id, lease_generation, lease_token,
    jsonb_set(
      failed_one,
      '{movements}',
      (failed_one -> 'movements') || jsonb_build_array(jsonb_build_object(
        'kind', 'release', 'logicalOperationId', 'invented-release',
        'attemptId', 'invented-attempt', 'amountFils', 1,
        'movementReference', 'invented-movement',
        'recordedAt', '2099-08-21T18:00:00.000Z'
      ))
    ),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ) from failed_release_retry_snapshots),
  '22023', null,
  'a retryable failed release preserves the existing movement array exactly'
);
rollback to savepoint booking_request_retryable_release_movement_invention;
set local role service_role;
select lives_ok(
  (select format('select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    work_id, lease_generation, lease_token, failed_one,
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')
  from failed_release_retry_snapshots),
  'a definitive retry-safe release failure is durably retained'
);
reset role;
select throws_ok(
  $$update public.booking_request_release_operations
    set updated_at = clock_timestamp()$$,
  'RC204', null,
  'a retryable release operation is terminal and cannot be rewritten'
);
set local role service_role;
select lives_ok(
  (select format('select public.save_booking_request_release_snapshot(%L::uuid,%L::bigint,%L::uuid,%L::jsonb,%L::jsonb)',
    work_id, lease_generation, lease_token, pending_two,
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')
  from failed_release_retry_snapshots),
  'the same logical release starts the next physical attempt'
);
reset role;
select results_eq(
  $$select attempts.state, attempts.payment_snapshot -> 'release' ->> 'status',
      attempts.payment_snapshot -> 'release' ->> 'attemptId'
    from public.booking_request_submission_attempts attempts
    where attempts.booking_request_id = (select id from booking_request_lifecycle_target)$$,
  $$select 'releasing'::text, 'pending'::text,
      pending_two -> 'release' ->> 'attemptId'
    from failed_release_retry_snapshots$$,
  'retry recovery holds inventory while attempt N+1 awaits provider settlement'
);
reset role;
select is(public.quarantine_booking_request_release_work((select work_id from failed_release_retry_snapshots)),false,
  'a retry-safe failure never triggers ordinary release quarantine');
create temporary table safe_retry_success_request as
select request||jsonb_build_object('operationId',operations.id,'operationGeneration',operations.operation_generation,
  'idempotencyKey',operations.provider_idempotency_key,'requestFingerprint',operations.request_fingerprint,
  'physicalAttemptId',operations.physical_attempt_id) as request
from failed_release_retry_request
join public.booking_request_release_operations operations on operations.id=(
  select active_operation_id from public.booking_request_release_work where id=(select work_id from failed_release_retry_snapshots));
grant select on safe_retry_success_request to service_role;
set local role service_role;
create temporary table safe_retry_success_result as
select pg_temp.payment_execute(request,'succeeded') as result from safe_retry_success_request;
select public.save_booking_request_release_snapshot(work_id,lease_generation,lease_token,
  jsonb_set(jsonb_set(pending_two,'{release}',(pending_two->'release')||jsonb_build_object('status','succeeded',
    'providerRequestId',result->>'providerRequestId','providerReference',result->>'providerReference',
    'movementReference',result->>'movementReference')),'{movements}',(pending_two->'movements')||jsonb_build_array(
      jsonb_build_object('kind','release','logicalOperationId',pending_two#>>'{release,logicalOperationId}',
        'attemptId',pending_two#>>'{release,attemptId}','amountFils',(pending_two#>>'{release,amountFils}')::bigint,
        'movementReference',result->>'movementReference','recordedAt',clock_timestamp()))),
  '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')
from failed_release_retry_snapshots,safe_retry_success_result;
select public.finalize_booking_request_release(work_id,lease_generation,lease_token) from failed_release_retry_snapshots;
select public.finalize_booking_request_release(work_id,lease_generation,lease_token) from failed_release_retry_snapshots;
reset role;
select results_eq(
  $$select requests.status,work.state,commitments.status::text,
      (select bool_and(not active) from public.cottage_booking_period_occupancies where booking_period_commitment_id=commitments.id),
      (select count(*) from jsonb_array_elements(attempts.payment_snapshot->'movements') movement where movement->>'kind'='release'),
      (select count(*) from public.booking_request_status_notifications where booking_request_id=requests.id),
      (select count(*) from public.booking_request_release_operations operations where operations.work_id=work.id),
      work.quarantined_at is null
    from public.booking_request_release_work work
    join public.booking_requests requests on requests.id=work.booking_request_id
    join public.booking_request_submission_attempts attempts on attempts.id=work.attempt_id
    join public.cottage_booking_period_commitments commitments on commitments.id=requests.booking_period_commitment_id
    where work.id=(select work_id from failed_release_retry_snapshots)$$,
  $$values ('withdrawn'::text,'complete'::text,'released_hold'::text,true,1::bigint,2::bigint,2::bigint,true)$$,
  'safe release retry then success completes once with one movement and one notification pair'
);
select is(public.quarantine_booking_request_release_work((select work_id from failed_release_retry_snapshots)),false,
  'complete ordinary release work remains complete under the quarantine safety guard');
rollback to savepoint booking_request_failed_release_retry;

savepoint booking_request_deadline_overdue;
update public.booking_requests
set created_at = timed.deadline - interval '4 hours',
  response_deadline = timed.deadline
from (select clock_timestamp() - interval '1 millisecond' as deadline) timed;
set local role service_role;
select is(
  public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target),
    'accept', null, null
  ) ->> 'status',
  'release-required',
  'an overdue Response Deadline belongs to expiry even when the Owner submits acceptance'
);
reset role;
select is(
  (select outcome from public.booking_request_release_work limit 1),
  'expired',
  'the database clock records expiry as the winning outcome after the Response Deadline'
);
rollback to savepoint booking_request_deadline_overdue;

savepoint booking_request_deadline_equality;
update public.booking_requests
set created_at = timed.deadline - interval '4 hours',
  response_deadline = timed.deadline
from (select clock_timestamp() as deadline) timed;
-- Pin both the action decision and extracted preparation clock at the Response Deadline;
-- the savepoint rollback restores the real clocks.
do $$begin execute replace(pg_get_functiondef('public.claim_booking_request_action(uuid,uuid,text,text,text)'::regprocedure),
  'clock_timestamp()','target_request.response_deadline');end$$;
do $$begin execute replace(pg_get_functiondef('private.prepare_booking_request_release(uuid,uuid,text,text,text,uuid)'::regprocedure),
  'clock_timestamp()','target_request.response_deadline');end$$;
set local role service_role;
select is(
  public.claim_booking_request_action(
    (select owner_user_id from booking_request_lifecycle_target),
    (select id from booking_request_lifecycle_target),
    'accept', null, null
  ) ->> 'status',
  'release-required',
  'acceptance evaluated at the exact Response Deadline is refused and expiry wins'
);
reset role;
select results_eq(
  $$select work.outcome, work.created_at = requests.response_deadline
    from public.booking_request_release_work work
    join public.booking_requests requests on requests.id = work.booking_request_id
    where requests.id = (select id from booking_request_lifecycle_target)$$,
  $$values ('expired'::text, true)$$,
  'expiry is recorded as evaluated at the exact instant of the Response Deadline'
);
rollback to savepoint booking_request_deadline_equality;

savepoint booking_request_automatic_expiry;
update public.booking_requests
set created_at = due.deadline - interval '4 hours',
  response_deadline = due.deadline
from (select clock_timestamp() as deadline) due;
set local role service_role;
select throws_ok(
  'select public.claim_due_booking_request_releases(null)',
  '22023', null,
  'the bounded internal runner rejects a null claim limit'
);
reset role;
select results_eq(
  $$select requests.status, claims.state,
      count(distinct work.id)::integer,
      count(distinct notifications.id)::integer
    from public.booking_requests requests
    join public.booking_request_submission_attempts attempts
      on attempts.booking_request_id = requests.id
    join public.booking_request_authorization_claims claims
      on claims.attempt_id = attempts.id
    left join public.booking_request_release_work work
      on work.attempt_id = attempts.id
    left join public.booking_request_status_notifications notifications
      on notifications.booking_request_id = requests.id
    where requests.id = (select id from booking_request_lifecycle_target)
    group by requests.status, claims.state$$,
  $$values ('pending'::text, 'converted'::public.booking_request_authorization_claim_state,
      0::integer, 0::integer)$$,
  'a null due-runner limit leases no release work and changes no product state'
);
set local role service_role;
select is(
  public.claim_due_booking_request_releases(20) -> 0 ->> 'status',
  'release-required',
  'the bounded internal runner claims an unanswered request for expiry without a user expire action'
);
reset role;
rollback to savepoint booking_request_automatic_expiry;

savepoint booking_request_terminal_rebooking;
update public.booking_requests set status = 'declined';
update public.booking_request_submission_attempts
set intent_dedupe_active = false;
update public.cottage_booking_period_commitments
set status = 'released_hold';
update public.cottage_booking_period_occupancies set active = false;
set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113201',
    (select submission from journey_submission)
  ) ->> 'status',
  'declined',
  'the original idempotency key projects the real terminal request status'
);
create temporary table terminal_rebooking as
select public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003202',
  '11111111-1111-4111-8111-111111113299',
  (select submission from valid_submission)
) as result;
reset role;
select results_eq(
  $$select (select result ->> 'status' from terminal_rebooking),
      (select count(*)::integer
        from public.booking_request_submission_attempts)$$,
  $$values ('ready'::text, 2::integer)$$,
  'a new idempotency key can create the same intent after unsuccessful terminal release'
);
rollback to savepoint booking_request_terminal_rebooking;

select results_eq(
  $$select booking_terms_version, booking_terms_locale::text,
      booking_terms_sha256,
      booking_terms_sha256 = encode(
        extensions.digest(convert_to(booking_terms_body, 'UTF8'), 'sha256'
      ), 'hex'),
      booking_terms_body like 'FICTIONAL LOCAL TEST TERMS — NOT A LEGAL AGREEMENT%'
    from public.booking_snapshots$$,
  $$values (
      'fictional-local-test-2026-08-22-v1'::text,
      'en'::text,
      '54c3ef684633e5308baf6511318fcfc422842239c22776f81d655c230ecd107d'::text,
      true,
      true
    )$$,
  'the immutable snapshot preserves the complete fictional terms identity and body'
);
select results_eq(
  $$select acceptance_locale::text, acceptance_evidence,
      acceptance_evidence_fingerprint = encode(
        extensions.digest(convert_to(acceptance_evidence::text, 'UTF8'), 'sha256'
      ), 'hex')
    from public.booking_snapshots$$,
  $$values ('en'::text, jsonb_build_object(
      'locale', 'en',
      'cancellationPolicy', 'Cancel at least 48 hours before the first shift for a full refund. Cancellation inside 48 hours and no-shows receive no refund.',
      'cancellationAcceptance', 'I accept the cancellation policy.',
      'marketplaceTermsAcceptance', 'I accept the marketplace booking terms.',
      'inside48Warning', null,
      'inside48Acceptance', null
    ), true)$$,
  'the immutable snapshot preserves and fingerprints the exact shown acceptance wording'
);

set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113297',
    (select submission from journey_submission)
  ) ->> 'bookingRequestReference',
  (select result ->> 'bookingRequestReference' from finalized_submission),
  'a fresh page key for the unchanged immutable intent returns the same request'
);
reset role;
select is(
  (select count(*) from public.booking_request_submission_attempts),
  1::bigint,
  'an unchanged intent cannot create a second durable attempt after refresh'
);

update public.cottage_inventory_standard_prices
set price_iqd = 120000
where schedule_revision_id = '60000000-0000-4000-8000-000000003201'
  and unit_id = '62000000-0000-4000-8000-000000003202';
set local role service_role;
select is(
  public.prepare_booking_request_submission(
    '00000000-0000-0000-0000-000000003202',
    '11111111-1111-4111-8111-111111113296',
    (select submission from journey_submission)
  ) ->> 'bookingRequestReference',
  (select result ->> 'bookingRequestReference' from finalized_submission),
  'a finalized attempt returns its original result before current-quote rejection'
);
reset role;

set local role service_role;
select is(
  public.finalize_booking_request_submission(
    (select result ->> 'attemptId' from prepared_submission)::uuid,
    (select snapshot from authorized_payment)
  ) ->> 'bookingRequestReference',
  (select result ->> 'bookingRequestReference' from finalized_submission),
  'a finalization retry returns the same Booking Request'
);
reset role;
select results_eq(
  $$select count(*)::integer,
      (select count(*)::integer from public.owner_request_notifications)
    from public.booking_requests$$,
  $$values (1::integer, 1::integer)$$,
  'a finalization retry cannot duplicate the request or owner notice'
);

savepoint terminal_reconciliation_markers_are_monotonic;
create temporary table terminal_marker_cases (
  case_name text primary key,
  attempt_id uuid not null,
  claim_id uuid not null,
  idempotency_key uuid not null,
  payment_lifecycle_id uuid not null,
  attempt_state text not null,
  claim_state public.booking_request_authorization_claim_state not null,
  intent_fingerprint text not null
) on commit drop;
insert into terminal_marker_cases values
  ('finalized',
    '45000000-0000-4000-8000-000000003201',
    '45300000-0000-4000-8000-000000003201',
    '45100000-0000-4000-8000-000000003201',
    '45200000-0000-4000-8000-000000003201',
    'finalized', 'converted', repeat('1', 64)),
  ('released',
    '45000000-0000-4000-8000-000000003202',
    '45300000-0000-4000-8000-000000003202',
    '45100000-0000-4000-8000-000000003202',
    '45200000-0000-4000-8000-000000003202',
    'released', 'released', repeat('2', 64)),
  ('authorization_failed',
    '45000000-0000-4000-8000-000000003203',
    '45300000-0000-4000-8000-000000003203',
    '45100000-0000-4000-8000-000000003203',
    '45200000-0000-4000-8000-000000003203',
    'authorization_failed', 'failed', repeat('3', 64));
insert into public.booking_request_submission_attempts (
  id, customer_user_id, idempotency_key, payment_lifecycle_id, profile_id,
  locale, public_slug, requested_search, quote_fingerprint, quote_payload,
  intent_fingerprint, intent_payload, payment_snapshot, state,
  created_at, updated_at
)
select cases.attempt_id, source.customer_user_id, cases.idempotency_key,
  cases.payment_lifecycle_id, source.profile_id, source.locale,
  source.public_slug, source.requested_search, source.quote_fingerprint,
  source.quote_payload, cases.intent_fingerprint,
  source.intent_payload || jsonb_build_object('terminalMarkerCase', cases.case_name),
  source.payment_snapshot || jsonb_build_object('terminalMarkerCase', cases.case_name),
  cases.attempt_state, source.created_at,
  clock_timestamp() - interval '5 minutes'
from terminal_marker_cases cases
cross join public.booking_request_submission_attempts source
where source.id = (select (result ->> 'attemptId')::uuid from prepared_submission);
insert into public.booking_request_authorization_claims (
  id, attempt_id, generation, state_revision, state, customer_user_id,
  profile_id, schedule_revision_id, payment_lifecycle_id,
  logical_operation_id, physical_attempt_id, amount_fils, currency,
  provider, environment, merchant_id, terminal_id, provider_idempotency_key,
  quote_fingerprint, intent_fingerprint, access_ranges, not_after,
  reconciliation_expires_at, created_at, updated_at
)
select cases.claim_id, cases.attempt_id, source.generation,
  source.state_revision + 10, cases.claim_state, source.customer_user_id,
  source.profile_id, source.schedule_revision_id, cases.payment_lifecycle_id,
  cases.payment_lifecycle_id::text || ':authorization',
  cases.payment_lifecycle_id::text || ':authorization:attempt-1',
  source.amount_fils, source.currency, source.provider, source.environment,
  source.merchant_id, source.terminal_id,
  'terminal-marker-' || cases.case_name, source.quote_fingerprint,
  cases.intent_fingerprint, source.access_ranges, source.not_after,
  source.reconciliation_expires_at, source.created_at,
  clock_timestamp() - interval '4 minutes'
from terminal_marker_cases cases
cross join public.booking_request_authorization_claims source
where source.attempt_id = (
  select (result ->> 'attemptId')::uuid from prepared_submission
);
insert into public.booking_request_authorization_reconciliation_outbox (
  claim_id, claim_generation, observed_state_revision, state,
  lease_token, lease_expires_at, created_at, updated_at
)
select claims.id, claims.generation, claims.state_revision, 'complete',
  null, null, claims.created_at, clock_timestamp() - interval '3 minutes'
from public.booking_request_authorization_claims claims
join terminal_marker_cases cases on cases.claim_id = claims.id;
create temporary table terminal_marker_baselines on commit drop as
select cases.case_name, cases.attempt_id, cases.claim_id,
  to_jsonb(attempts) as attempt_record,
  to_jsonb(claims) as claim_record,
  to_jsonb(outbox) as outbox_record
from terminal_marker_cases cases
join public.booking_request_submission_attempts attempts
  on attempts.id = cases.attempt_id
join public.booking_request_authorization_claims claims
  on claims.id = cases.claim_id
join public.booking_request_authorization_reconciliation_outbox outbox
  on outbox.claim_id = cases.claim_id;
grant select on terminal_marker_cases to service_role;
set local role service_role;
select public.mark_booking_request_reconciliation_required(attempt_id)
from terminal_marker_cases
order by case_name;
reset role;
select results_eq(
  $$select baselines.case_name,
      to_jsonb(attempts) = baselines.attempt_record,
      to_jsonb(claims) = baselines.claim_record,
      to_jsonb(outbox) = baselines.outbox_record
    from terminal_marker_baselines baselines
    join public.booking_request_submission_attempts attempts
      on attempts.id = baselines.attempt_id
    join public.booking_request_authorization_claims claims
      on claims.id = baselines.claim_id
    join public.booking_request_authorization_reconciliation_outbox outbox
      on outbox.claim_id = baselines.claim_id
    order by baselines.case_name$$,
  $$values
      ('authorization_failed'::text, true, true, true),
      ('finalized'::text, true, true, true),
      ('released'::text, true, true, true)$$,
  'stale reconciliation markers preserve every terminal attempt, claim, audit, token, and outbox field'
);
rollback to savepoint terminal_reconciliation_markers_are_monotonic;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003202"}',
  true
);
select ok(
  projection.result ? 'coverMediaId'
    and projection.result -> 'coverMediaId' = 'null'::jsonb,
  'Customer current public cover is explicit null without media'
) from (
  select public.get_customer_booking_request(
    (select booking_request_reference from booking_request_lifecycle_target)
  ) as result
) projection;
reset role;
savepoint customer_cover_without_publication;
update public.owner_application_cottage_profiles set current_publication_id = null
where id = '30000000-0000-4000-8000-000000003201';
set local role authenticated;
select ok(
  projection.result ? 'coverMediaId'
    and projection.result -> 'coverMediaId' = 'null'::jsonb,
  'Customer current public cover is explicit null without a publication'
) from (
  select public.get_customer_booking_request(
    (select booking_request_reference from booking_request_lifecycle_target)
  ) as result
) projection;
reset role;
rollback to savepoint customer_cover_without_publication;

insert into public.cottage_profile_photos (
  id, profile_id, owner_user_id, actor_user_id, object_path,
  original_filename, media_type, size_bytes, state
) values (
  '40000000-0000-4000-8000-000000003201',
  '30000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003201',
  '00000000-0000-0000-0000-000000003201',
  'private/submission/cover-3201.webp', 'cover-3201.webp', 'image/webp', 128, 'ready'
), (
  '40000000-0000-4000-8000-000000003202',
  '30000000-0000-4000-8000-000000003201',
  '00000000-0000-0000-0000-000000003201',
  '00000000-0000-0000-0000-000000003201',
  'private/submission/cover-3202.webp', 'cover-3202.webp', 'image/webp', 128, 'ready'
);
-- Position 2 is inserted first so the projection must order by position to return position 1.
insert into public.cottage_publication_media (
  publication_id, photo_id, opaque_id, object_path, media_type, position
) values (
  '66000000-0000-4000-8000-000000003201',
  '40000000-0000-4000-8000-000000003201',
  '41000000-0000-4000-8000-000000003201',
  'private/submission/cover-3201.webp', 'image/webp', 2
);
insert into public.cottage_publication_media (
  publication_id, photo_id, opaque_id, object_path, media_type, position
) values (
  '66000000-0000-4000-8000-000000003201',
  '40000000-0000-4000-8000-000000003202',
  '41000000-0000-4000-8000-000000003202',
  'private/submission/cover-3202.webp', 'image/webp', 1
);


select jsonb_build_object(
  'snapshots', (select jsonb_agg(to_jsonb(s) order by s.id) from public.booking_snapshots s
    join public.booking_requests r on r.booking_snapshot_id=s.id where r.id=(select id from booking_request_lifecycle_target)),
  'submission', (select result from finalized_submission),
  'reference', (select booking_request_reference from booking_request_lifecycle_target),
  'descriptionBefore', (select description from public.owner_application_cottage_profiles where id='30000000-0000-4000-8000-000000003201')
) as proof
\gset job628_before_
savepoint job628_booking_preservation;
insert into auth.users(id,aud,role,phone,phone_confirmed_at)
values ('00000000-0000-4000-8000-000000006628','authenticated','authenticated','+9647500006628',now());
insert into public.account_contexts(user_id,role)
values ('00000000-0000-4000-8000-000000006628','platform_administrator');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006628', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000006628","aal":"aal2"}', true);
set local role authenticated;

select public.update_administrator_cottage_profile(
  id, version, name, governorate, approximate_location, exact_address, exact_latitude, exact_longitude,
  private_directions, capacity, bedrooms, bathrooms, amenities, source_language,
  description || ' Preservation edit.', house_rules, 'Verify booked snapshot preservation'
) from public.owner_application_cottage_profiles where id='30000000-0000-4000-8000-000000003201';
reset role;
set local role service_role;
select public.finalize_booking_request_submission(
    (select (result->>'attemptId')::uuid from prepared_submission), (select snapshot from authorized_payment)) as result
\gset job628_edit_replay_
reset role;
select jsonb_build_object(
  'snapshots', (select jsonb_agg(to_jsonb(s) order by s.id) from public.booking_snapshots s
    join public.booking_requests r on r.booking_snapshot_id=s.id where r.id=(select id from booking_request_lifecycle_target)),
  'submission', :'job628_edit_replay_result'::jsonb,
  'description', (select description from public.owner_application_cottage_profiles where id='30000000-0000-4000-8000-000000003201'),
  'descriptionHidden', (select description_hidden from public.owner_application_cottage_profiles where id='30000000-0000-4000-8000-000000003201'),
  'photoHidden', (select public_hidden from public.cottage_profile_photos where id='40000000-0000-4000-8000-000000003202')
) as proof
\gset job628_edit_
reset role;
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006628', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000006628","aal":"aal2"}', true);
set local role authenticated;
select public.set_administrator_cottage_description_hidden('30000000-0000-4000-8000-000000003201', '66000000-0000-4000-8000-000000003201', true, 'Verify description job628_hidden');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006628', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000006628","aal":"aal2"}', true);
set local role authenticated;
select public.set_administrator_cottage_photo_hidden('30000000-0000-4000-8000-000000003201', '66000000-0000-4000-8000-000000003201', '40000000-0000-4000-8000-000000003202', true, 'Verify photo job628_hidden');
reset role;
set local role service_role;
select public.finalize_booking_request_submission(
    (select (result->>'attemptId')::uuid from prepared_submission), (select snapshot from authorized_payment)) as result
\gset job628_hidden_replay_
reset role;
select jsonb_build_object(
  'snapshots', (select jsonb_agg(to_jsonb(s) order by s.id) from public.booking_snapshots s
    join public.booking_requests r on r.booking_snapshot_id=s.id where r.id=(select id from booking_request_lifecycle_target)),
  'submission', :'job628_hidden_replay_result'::jsonb,
  'description', (select description from public.owner_application_cottage_profiles where id='30000000-0000-4000-8000-000000003201'),
  'descriptionHidden', (select description_hidden from public.owner_application_cottage_profiles where id='30000000-0000-4000-8000-000000003201'),
  'photoHidden', (select public_hidden from public.cottage_profile_photos where id='40000000-0000-4000-8000-000000003202')
) as proof
\gset job628_hidden_
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003202', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003202"}', true);
set local role authenticated;
select public.get_customer_booking_request((select booking_request_reference from booking_request_lifecycle_target)) as result
\gset job628_customer_
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003201', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}', true);
set local role authenticated;
select public.list_owner_booking_request_notifications() -> 0 as result
\gset job628_owner_
reset role;
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006628', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000006628","aal":"aal2"}', true);
set local role authenticated;
select public.set_administrator_cottage_description_hidden('30000000-0000-4000-8000-000000003201', '66000000-0000-4000-8000-000000003201', false, 'Verify description job628_restored');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006628', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000006628","aal":"aal2"}', true);
set local role authenticated;
select public.set_administrator_cottage_photo_hidden('30000000-0000-4000-8000-000000003201', '66000000-0000-4000-8000-000000003201', '40000000-0000-4000-8000-000000003202', false, 'Verify photo job628_restored');
reset role;
set local role service_role;
select public.finalize_booking_request_submission(
    (select (result->>'attemptId')::uuid from prepared_submission), (select snapshot from authorized_payment)) as result
\gset job628_restored_replay_
reset role;
select jsonb_build_object(
  'snapshots', (select jsonb_agg(to_jsonb(s) order by s.id) from public.booking_snapshots s
    join public.booking_requests r on r.booking_snapshot_id=s.id where r.id=(select id from booking_request_lifecycle_target)),
  'submission', :'job628_restored_replay_result'::jsonb,
  'description', (select description from public.owner_application_cottage_profiles where id='30000000-0000-4000-8000-000000003201'),
  'descriptionHidden', (select description_hidden from public.owner_application_cottage_profiles where id='30000000-0000-4000-8000-000000003201'),
  'photoHidden', (select public_hidden from public.cottage_profile_photos where id='40000000-0000-4000-8000-000000003202')
) as proof
\gset job628_restored_
reset role;
reset role;
rollback to savepoint job628_booking_preservation;
release savepoint job628_booking_preservation;
select ok(jsonb_array_length(:'job628_before_proof'::jsonb -> 'snapshots')=1
  and :'job628_before_proof'::jsonb #>> '{submission,status}'='pending'
  and :'job628_before_proof'::jsonb #>> '{submission,bookingRequestReference}'=:'job628_before_proof'::jsonb ->> 'reference',
  'visibility preservation starts with a real nonempty finalized pending snapshot and submission result');
select ok(:'job628_edit_proof'::jsonb -> 'snapshots'=:'job628_before_proof'::jsonb -> 'snapshots'
  and :'job628_hidden_proof'::jsonb -> 'snapshots'=:'job628_before_proof'::jsonb -> 'snapshots'
  and :'job628_restored_proof'::jsonb -> 'snapshots'=:'job628_before_proof'::jsonb -> 'snapshots',
  'reasoned edit hide and restore preserve the complete booked snapshot rows');
select ok(:'job628_edit_proof'::jsonb -> 'submission'=:'job628_before_proof'::jsonb -> 'submission'
  and :'job628_hidden_proof'::jsonb -> 'submission'=:'job628_before_proof'::jsonb -> 'submission'
  and :'job628_restored_proof'::jsonb -> 'submission'=:'job628_before_proof'::jsonb -> 'submission',
  'finalized submission replay returns its original nonempty result after edit hide and restore');
select ok(:'job628_edit_proof'::jsonb ->> 'description'=(:'job628_before_proof'::jsonb ->> 'descriptionBefore') || ' Preservation edit.'
  and :'job628_edit_proof'::jsonb @> '{"descriptionHidden":false,"photoHidden":false}',
  'preservation evidence observes the actual reasoned working-copy edit');
select ok(:'job628_hidden_proof'::jsonb -> 'description'=:'job628_edit_proof'::jsonb -> 'description'
  and :'job628_hidden_proof'::jsonb @> '{"descriptionHidden":true,"photoHidden":true}',
  'preservation evidence observes both actual hidden states');
select ok(:'job628_restored_proof'::jsonb -> 'description'=:'job628_edit_proof'::jsonb -> 'description'
  and :'job628_restored_proof'::jsonb @> '{"descriptionHidden":false,"photoHidden":false}',
  'preservation evidence observes explicit restoration without erasing the edit');
select ok(not exists(select 1 from auth.users where id='00000000-0000-4000-8000-000000006628')
  and not exists(select 1 from public.account_contexts where user_id='00000000-0000-4000-8000-000000006628'),
  'the isolated preservation participant is absent after rollback');
select is(:'job628_customer_result'::jsonb ->> 'coverMediaId', '41000000-0000-4000-8000-000000003201',
  'Customer booking request cover skips a hidden first public photo');
select is(:'job628_owner_result'::jsonb ->> 'coverMediaId', '41000000-0000-4000-8000-000000003201',
  'Owner booking notification cover skips a hidden first public photo');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}',
  true
);
create temporary table owner_projection_clock as
select clock_timestamp() as before_call, null::timestamptz as after_call;
create temporary table owner_projection as
select public.list_owner_booking_request_notifications() as result;
update owner_projection_clock set after_call = clock_timestamp();
reset role;
select is(
  jsonb_array_length((select result from owner_projection)), 1,
  'the Cottage Owner receives one immediate in-product notice'
);
select ok(
  not ((select result -> 0 from owner_projection) ?| array[
    'phone', 'contact', 'paymentLifecycleId', 'providerRequestId', 'providerReference'
  ]),
  'the owner projection excludes contact and payment-provider metadata'
);
select ok(
  (select result -> 0 -> 'bookingPeriod' -> 0 ?& array['kind', 'displayName']
    from owner_projection)
  and (select result -> 0 ?& array[
    'houseRules', 'bookingTermsVersion', 'cancellationPolicyVersion',
    'marketplaceCommissionFils', 'ownerNetFils', 'statusNotifications'
  ] from owner_projection),
  'the Owner card receives the complete immutable Booking Snapshot and scoped notification receipt shape'
);
select is(
  (select result -> 0 ->> 'coverMediaId' from owner_projection),
  '41000000-0000-4000-8000-000000003202',
  'the owner projection carries the first photo Customers see for a publicly discoverable Cottage'
);
select ok(
  (select (projection.result -> 0 ->> 'databaseNow')::timestamptz
      between date_trunc('milliseconds', clock.before_call) and clock.after_call
    from owner_projection projection cross join owner_projection_clock clock),
  'the owner projection carries the database clock beside the Response Deadline'
);
savepoint owner_projection_paused_cottage;
update public.cottage_marketplace_listings set state = 'paused'
where profile_id = '30000000-0000-4000-8000-000000003201';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003201"}',
  true
);
select is(
  public.list_owner_booking_request_notifications() #> '{0,coverMediaId}',
  'null'::jsonb,
  'the owner projection carries no photo identifier once the Cottage is paused'
);
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003202"}',
  true
);
select is(
  public.get_customer_booking_request(
    (select booking_request_reference from booking_request_lifecycle_target)
  ) -> 'coverMediaId',
  'null'::jsonb,
  'Customer current public cover is null while paused'
);
reset role;
rollback to savepoint owner_projection_paused_cottage;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003204"}',
  true
);
select is(
  jsonb_array_length(public.list_owner_booking_request_notifications()),
  0,
  'a second approved Cottage Owner cannot see an unrelated request'
);
reset role;

select ok(
  has_function_privilege(
    'authenticated', 'public.get_customer_booking_request(text)', 'execute'
  )
  and not has_function_privilege(
    'anon', 'public.get_customer_booking_request(text)', 'execute'
  ),
  'only authenticated users can request a Customer Booking Request projection'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003202"}',
  true
);
create temporary table customer_projection as
select public.get_customer_booking_request(
  (select booking_request_reference from booking_request_lifecycle_target)
) as result;
reset role;
select ok(
  (select result ->> 'status' from customer_projection) = 'pending'
  and not ((select result from customer_projection) ?| array[
    'ownerUserId', 'customerName', 'bookingNote', 'phone', 'email',
    'exactAddress', 'paymentLifecycleId', 'providerReference'
  ]),
  'the owning Customer receives a constrained status projection without private Owner or payment data'
);
select is(
  (select result ->> 'coverMediaId' from customer_projection),
  '41000000-0000-4000-8000-000000003202',
  'current public cover follows publication visibility'
);
savepoint customer_cover_replaced_publication;
insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
)
select '64000000-0000-4000-8000-000000003202', profile_id, owner_user_id,
  source_revision_id, name, governorate, approximate_location, capacity,
  bedrooms, bathrooms, amenities, 2, state, decided_at
from public.cottage_profile_review_cycles
where id = '64000000-0000-4000-8000-000000003201';
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
)
select '66000000-0000-4000-8000-000000003202', profile_id,
  '64000000-0000-4000-8000-000000003202', 2, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
from public.cottage_publication_snapshots
where id = '66000000-0000-4000-8000-000000003201';
insert into public.cottage_publication_media (
  publication_id, photo_id, opaque_id, object_path, media_type, position
) values (
  '66000000-0000-4000-8000-000000003202',
  '40000000-0000-4000-8000-000000003201',
  '41000000-0000-4000-8000-000000003203',
  'private/submission/cover-3201.webp', 'image/webp', 1
);
update public.owner_application_cottage_profiles
set current_publication_id = '66000000-0000-4000-8000-000000003202'
where id = '30000000-0000-4000-8000-000000003201';
set local role authenticated;
select is(
  public.get_customer_booking_request(
    (select booking_request_reference from booking_request_lifecycle_target)
  ) ->> 'coverMediaId',
  '41000000-0000-4000-8000-000000003203',
  'Customer current public cover follows a replacement publication instead of old media'
);
reset role;
rollback to savepoint customer_cover_replaced_publication;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000003203"}',
  true
);
select is(
  public.get_customer_booking_request(
    (select booking_request_reference from booking_request_lifecycle_target)
  ),
  null::jsonb,
  'a different Customer cannot discover another Customer Booking Request'
);
reset role;

select throws_ok(
  $$insert into public.booking_request_submission_attempts (
      id, customer_user_id, idempotency_key, payment_lifecycle_id, profile_id,
      locale, public_slug, requested_search, quote_fingerprint, quote_payload,
      intent_fingerprint, intent_payload, state,
      authorization_provider, authorization_environment,
      authorization_merchant_id, authorization_terminal_id,
      authorization_provider_request_id, authorization_provider_reference,
      authorization_movement_reference
    ) select
      gen_random_uuid(), customer_user_id, gen_random_uuid(), gen_random_uuid(),
      profile_id, locale, public_slug, requested_search, repeat('b', 64),
      quote_payload, repeat('c', 64), intent_payload || '{"distinct":true}'::jsonb,
      'authorized', authorization_provider, authorization_environment,
      authorization_merchant_id, authorization_terminal_id,
      authorization_provider_request_id, authorization_provider_reference,
      authorization_movement_reference
    from public.booking_request_submission_attempts limit 1$$,
  '23505', null,
  'one provider authorization identity cannot be attached to two attempts'
);

insert into public.booking_request_submission_attempts (
  id, customer_user_id, idempotency_key, payment_lifecycle_id, profile_id,
  locale, public_slug, requested_search, quote_fingerprint, quote_payload,
  intent_fingerprint, intent_payload, state
)
select fixtures.attempt_id, '00000000-0000-0000-0000-000000003203',
  fixtures.idempotency_key, fixtures.payment_lifecycle_id,
  source.profile_id, source.locale, source.public_slug, source.requested_search,
  fixtures.intent_fingerprint, source.quote_payload,
  fixtures.intent_fingerprint,
  source.intent_payload || jsonb_build_object('releaseReplayFixture', fixtures.suffix),
  'authorizing'
from public.booking_request_submission_attempts source
cross join (values
  ('42000000-0000-4000-8000-000000003201'::uuid,
    '42100000-0000-4000-8000-000000003201'::uuid,
    '42200000-0000-4000-8000-000000003201'::uuid, repeat('d', 64), 'one'),
  ('42000000-0000-4000-8000-000000003202'::uuid,
    '42100000-0000-4000-8000-000000003202'::uuid,
    '42200000-0000-4000-8000-000000003202'::uuid, repeat('e', 64), 'two')
) fixtures(attempt_id, idempotency_key, payment_lifecycle_id, intent_fingerprint, suffix)
where source.id = (select (result ->> 'attemptId')::uuid from prepared_submission);

create temporary table released_payments as
select attempts.id as attempt_id,
  (authorized.snapshot || jsonb_build_object(
    'paymentLifecycleId', attempts.payment_lifecycle_id,
    'authorization', jsonb_build_object(
      'paymentLifecycleId', attempts.payment_lifecycle_id,
      'kind', 'authorization',
      'logicalOperationId', attempts.payment_lifecycle_id::text || ':authorization',
      'attemptId', attempts.payment_lifecycle_id::text || ':authorization:attempt-1',
      'status', 'succeeded', 'amountFils', 115000000,
      'providerRequestId', 'replay-auth-request-' || attempts.id,
      'providerReference', 'replay-auth-reference-' || attempts.id,
      'movementReference', 'replay-auth-movement-' || attempts.id,
      'reconciliationRequired', false, 'retrySafe', false
    ),
    'release', jsonb_build_object(
      'paymentLifecycleId', attempts.payment_lifecycle_id,
      'kind', 'release',
      'logicalOperationId', attempts.payment_lifecycle_id::text || ':release',
      'attemptId', attempts.payment_lifecycle_id::text || ':release:attempt-1',
      'status', 'succeeded', 'amountFils', 115000000,
      'providerRequestId', 'shared-release-request',
      'providerReference', 'shared-release-reference',
      'movementReference', 'shared-release-movement',
      'reconciliationRequired', false, 'retrySafe', false
    ),
    'movements', jsonb_build_array(
      jsonb_build_object(
        'kind', 'authorization',
        'logicalOperationId', attempts.payment_lifecycle_id::text || ':authorization',
        'attemptId', attempts.payment_lifecycle_id::text || ':authorization:attempt-1',
        'amountFils', 115000000,
        'movementReference', 'replay-auth-movement-' || attempts.id,
        'recordedAt', '2099-08-21T15:00:00.000Z'
      ),
      jsonb_build_object(
        'kind', 'release',
        'logicalOperationId', attempts.payment_lifecycle_id::text || ':release',
        'attemptId', attempts.payment_lifecycle_id::text || ':release:attempt-1',
        'amountFils', 115000000,
        'movementReference', 'shared-release-movement',
        'recordedAt', '2099-08-21T15:01:00.000Z'
      )
    )
  )) as snapshot
from public.booking_request_submission_attempts attempts
cross join authorized_payment authorized
where attempts.id in (
  '42000000-0000-4000-8000-000000003201',
  '42000000-0000-4000-8000-000000003202'
);
grant select on released_payments to service_role;

set local role service_role;
select lives_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    '42000000-0000-4000-8000-000000003201',
    (select snapshot::text from released_payments where attempt_id = '42000000-0000-4000-8000-000000003201'),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'a successful release persists its typed provider identities'
);
reset role;
select results_eq(
  $$select release_provider_request_id, release_provider_reference,
      release_movement_reference
    from public.booking_request_submission_attempts
    where id = '42000000-0000-4000-8000-000000003201'$$,
  $$values ('shared-release-request'::text, 'shared-release-reference'::text,
    'shared-release-movement'::text)$$,
  'the release replay boundary retains all typed external identities'
);
set local role service_role;
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    '42000000-0000-4000-8000-000000003202',
    (select jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(snapshot, '{release}', 'null'::jsonb),
            '{authorization,providerRequestId}', '"shared-release-request"'::jsonb
          ),
          '{authorization,providerReference}', '"shared-release-reference"'::jsonb
        ),
        '{authorization,movementReference}', '"shared-release-movement"'::jsonb
      ),
      '{movements}', jsonb_build_array(jsonb_set(
        snapshot -> 'movements' -> 0,
        '{movementReference}', '"shared-release-movement"'::jsonb
      ))
    )::text from released_payments
      where attempt_id = '42000000-0000-4000-8000-000000003202'),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  '23505', null,
  'a release identity cannot be replayed as an authorization on another attempt'
);
do $$
begin
  perform public.save_booking_request_payment_snapshot(
    '42000000-0000-4000-8000-000000003202',
    (
      select jsonb_set(
        jsonb_set(snapshot, '{release}', 'null'::jsonb),
        '{movements}', jsonb_build_array(snapshot -> 'movements' -> 0)
      )
      from released_payments
      where attempt_id = '42000000-0000-4000-8000-000000003202'
    ),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
  );
end;
$$;
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    '42000000-0000-4000-8000-000000003202',
    (select jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(snapshot, '{release,providerRequestId}', '"provider-request-3201"'::jsonb),
          '{release,providerReference}', '"provider-reference-3201"'::jsonb
        ),
        '{release,movementReference}', '"movement-reference-3201"'::jsonb
      ),
      '{movements,1,movementReference}', '"movement-reference-3201"'::jsonb
    )::text from released_payments
      where attempt_id = '42000000-0000-4000-8000-000000003202'),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  '23505', null,
  'an authorization identity cannot be replayed as a release on another attempt'
);
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    '42000000-0000-4000-8000-000000003202',
    (select snapshot::text from released_payments where attempt_id = '42000000-0000-4000-8000-000000003202'),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  '23505', null,
  'one external release identity cannot mark two attempts released'
);
select throws_ok(
  format(
    'select public.save_booking_request_payment_snapshot(%L::uuid, %L::jsonb, %L::jsonb)',
    '42000000-0000-4000-8000-000000003201',
    (select (snapshot - 'release' || jsonb_build_object('release', null, 'movements', jsonb_build_array(snapshot -> 'movements' -> 0)))::text
      from released_payments where attempt_id = '42000000-0000-4000-8000-000000003201'),
    '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'
  ),
  'RC409', null,
  'a released snapshot cannot be overwritten by stale authorization-only evidence'
);
select public.mark_booking_request_reconciliation_required(
  '42000000-0000-4000-8000-000000003201'
);
reset role;
select is(
  (select state from public.booking_request_submission_attempts
    where id = '42000000-0000-4000-8000-000000003201'),
  'released',
  'a reconciliation marker cannot regress a successful release'
);

delete from public.booking_request_provider_operation_identities
where attempt_id in (
  '42000000-0000-4000-8000-000000003201',
  '42000000-0000-4000-8000-000000003202'
);
delete from public.booking_request_submission_attempts
where id in (
  '42000000-0000-4000-8000-000000003201',
  '42000000-0000-4000-8000-000000003202'
);
select results_eq(
  $$select result -> 0 ->> 'customerName',
      (result -> 0 ->> 'partySize')::integer,
      result -> 0 ->> 'bookingNote'
    from owner_projection$$,
  $$values ('Ava Hassan'::text, 4::integer, 'Please prepare the garden seating.'::text)$$,
  'the owner projection contains only the required Customer request details'
);

select throws_ok(
  $$update public.booking_snapshots set quote_payload = '{}'::jsonb$$,
  'RC204', null,
  'a Booking Snapshot cannot be changed after submission'
);

insert into auth.users (id, aud, role, phone, phone_confirmed_at)
values (
  '00000000-0000-0000-0000-000000003206', 'authenticated', 'authenticated',
  '+9647500003206', now()
);
insert into public.account_contexts (user_id, role, owner_approval_state)
values ('00000000-0000-0000-0000-000000003206', 'customer', null);

insert into public.owner_application_cottage_profiles (
  id, owner_user_id, name, governorate, approximate_location, exact_address,
  capacity, bedrooms, bathrooms, amenities, source_language, description,
  house_rules, status
) values (
  '30000000-0000-4000-8000-000000003206',
  '00000000-0000-0000-0000-000000003201',
  '24-hour Claim Cottage', 'Baghdad', 'Karrada', 'Private address',
  8, 3, 2, array['pool'], 'en', 'Description', 'Rules', 'draft'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003201","role":"authenticated","aal":"aal1"}',
  true
);
select public.replace_cottage_shift_schedule(
  '30000000-0000-4000-8000-000000003206', 0,
  '[{"name":"Morning","startTime":"09:00","endTime":"15:00"},
    {"name":"Evening","startTime":"17:00","endTime":"09:00"}]'
);
reset role;
insert into public.cottage_profile_source_revisions (
  id, profile_id, owner_user_id, source_language, description, house_rules, revision
) values (
  '63000000-0000-4000-8000-000000003206',
  '30000000-0000-4000-8000-000000003206',
  '00000000-0000-0000-0000-000000003201',
  'en', 'Description', 'Rules', 1
);
insert into public.cottage_profile_review_cycles (
  id, profile_id, owner_user_id, source_revision_id, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities,
  cycle_number, state, decided_at
) values (
  '64000000-0000-4000-8000-000000003206',
  '30000000-0000-4000-8000-000000003206',
  '00000000-0000-0000-0000-000000003201',
  '63000000-0000-4000-8000-000000003206',
  '24-hour Claim Cottage', 'Baghdad', 'Karrada', 8, 3, 2,
  array['pool'], 1, 'approved', now()
);
insert into public.cottage_profile_localized_revisions (
  id, review_cycle_id, locale, revision, origin, description, house_rules
) values (
  '65000000-0000-4000-8000-000000003206',
  '64000000-0000-4000-8000-000000003206',
  'en', 1, 'owner_source', 'Description', 'Rules'
);
insert into public.cottage_profile_publication_decisions (
  review_cycle_id, administrator_user_id, approved, reason
) values (
  '64000000-0000-4000-8000-000000003206',
  '00000000-0000-0000-0000-000000003203',
  true, 'Approved fixture'
);
insert into public.cottage_publication_snapshots (
  id, profile_id, review_cycle_id, publication_number, name, governorate,
  approximate_location, capacity, bedrooms, bathrooms, amenities
) values (
  '66000000-0000-4000-8000-000000003206',
  '30000000-0000-4000-8000-000000003206',
  '64000000-0000-4000-8000-000000003206',
  1, '24-hour Claim Cottage', 'Baghdad', 'Karrada', 8, 3, 2, array['pool']
);
insert into public.cottage_publication_localizations (
  publication_id, locale, localized_revision_id, description, house_rules
) values (
  '66000000-0000-4000-8000-000000003206',
  'en', '65000000-0000-4000-8000-000000003206', 'Description', 'Rules'
);
update public.owner_application_cottage_profiles
set current_publication_id = '66000000-0000-4000-8000-000000003206'
where id = '30000000-0000-4000-8000-000000003206';

insert into public.cottage_inventory_standard_prices (
  schedule_revision_id, unit_kind, unit_id, price_iqd
)
select schedules.id, 'shift'::public.cottage_inventory_unit_kind, shifts.id,
  case shifts.position when 1 then 100000 else 110000 end
from public.cottage_shift_schedule_revisions schedules
join public.cottage_shifts shifts on shifts.schedule_revision_id = schedules.id
where schedules.profile_id = '30000000-0000-4000-8000-000000003206'
union all
select id, 'full_day_bundle'::public.cottage_inventory_unit_kind, full_day_bundle_id, 190000
from public.cottage_shift_schedule_revisions
where profile_id = '30000000-0000-4000-8000-000000003206';
insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select prices.schedule_revision_id, prices.unit_kind, prices.unit_id,
  '2099-08-23'::date, 'open'
from public.cottage_inventory_standard_prices prices
join public.cottage_shift_schedule_revisions schedules
  on schedules.id = prices.schedule_revision_id
where schedules.profile_id = '30000000-0000-4000-8000-000000003206';

insert into public.cottage_inventory_availability (
  schedule_revision_id, unit_kind, unit_id, service_day, state
)
select schedule_revision_id, unit_kind, unit_id, '2099-08-24'::date, 'open'
from public.cottage_inventory_standard_prices
where schedule_revision_id = '60000000-0000-4000-8000-000000003201';

create temporary table full_day_submission_fixture as
select
  '{"from":"2099-08-23","to":"2099-08-23","guests":4,"selections":[{"serviceDay":"2099-08-23","kind":"full-day"}]}'::jsonb as search,
  public.get_public_booking_quote_with_fingerprint(
    'en', 'cottage-30000000000040008000000000003206',
    '{"from":"2099-08-23","to":"2099-08-23","guests":4,"selections":[{"serviceDay":"2099-08-23","kind":"full-day"}]}'::jsonb
  ) as quote;
grant select on full_day_submission_fixture to service_role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temporary table full_day_conversation as
select public.create_messaging_conversation(
  '00000000-0000-0000-0000-000000003206',
  '30000000-0000-4000-8000-000000003206',
  '36000000-0000-4000-8000-000000003206'
) result;
reset role;
create temporary table full_day_submission as
select jsonb_set(
  submission || jsonb_build_object(
    'publicSlug', 'cottage-30000000000040008000000000003206',
    'discoveryQuery', fixture.search,
    'quoteFingerprint', fixture.quote ->> 'quoteFingerprint',
    'contentVersion', fixture.quote -> 'contentVersion',
    'termsVersion', fixture.quote ->> 'termsVersion',
    'bookingPriceIqd', 190000,
    'serviceFeeIqd', 5000,
    'customerTotalIqd', 195000,
    'firstStartsAt', fixture.quote -> 'items' -> 0 ->> 'startsAt',
    'conversationId', conversation.result ->> 'conversationId'
  ),
  '{intent,conversationId}', to_jsonb(conversation.result ->> 'conversationId')
) submission
from valid_submission
cross join full_day_submission_fixture fixture
cross join full_day_conversation conversation;
grant select on full_day_submission to service_role;
set local role service_role;
create temporary table full_day_prepared_submission as
select public.prepare_booking_request_submission(
  '00000000-0000-0000-0000-000000003206',
  '11111111-1111-4111-8111-111111113206',
  (select submission from full_day_submission)
) as result;
select is(
  (select result ->> 'status' from full_day_prepared_submission), 'ready',
  'a 24-hour Full-day production quote prepares a submission before authorization'
);
reset role;

-- Fictional pending-payment input; no provider authorization is executed.
create temporary table full_day_pending_payment as
select jsonb_build_object(
  'paymentLifecycleId', result ->> 'paymentLifecycleId',
  'currency', 'IQD',
  'bookingPriceFils', 190000000,
  'bookingServiceFeeFils', 5000000,
  'customerTotalFils', 195000000,
  'authorization', jsonb_build_object(
    'paymentLifecycleId', result ->> 'paymentLifecycleId',
    'kind', 'authorization',
    'logicalOperationId', (result ->> 'paymentLifecycleId') || ':authorization',
    'attemptId', (result ->> 'paymentLifecycleId') || ':authorization:attempt-1',
    'status', 'pending',
    'amountFils', 195000000,
    'providerRequestId', null,
    'providerReference', null,
    'movementReference', null,
    'reconciliationRequired', false,
    'retrySafe', false
  ),
  'capture', null,
  'release', null,
  'refunds', jsonb_build_array(),
  'financials', jsonb_build_object(
    'refundedBookingPriceFils', 0,
    'refundedBookingServiceFeeFils', 0,
    'remainingBookingPriceFils', 190000000,
    'remainingBookingServiceFeeFils', 5000000,
    'marketplaceCommissionFils', 19000000,
    'ownerEntitlementFils', 171000000
  ),
  'payout', jsonb_build_object(
    'status', 'not_eligible', 'eligibleFils', 171000000,
    'paidFils', 0, 'providerFeeFils', 0, 'providerReserveFils', 0,
    'recoveryExposureFils', 0, 'recoveryBalanceFils', 0,
    'automaticOwnerDebitFils', 0, 'paidWhileBlocked', false,
    'settlement', null
  ),
  'holds', jsonb_build_object('administrator', false, 'dispute', false),
  'dispute', null,
  'audits', jsonb_build_array(),
  'movements', jsonb_build_array()
) as snapshot
from full_day_prepared_submission;
grant select on full_day_pending_payment to service_role;
create temporary table full_day_authorization_claim (result jsonb);
grant select, insert on full_day_authorization_claim to service_role;
set local role service_role;
select lives_ok(
  $$insert into full_day_authorization_claim
    select public.begin_booking_request_authorization_claim(
      (select (result ->> 'attemptId')::uuid from full_day_prepared_submission),
      (select snapshot from full_day_pending_payment),
      '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
    )$$,
  'a 24-hour Full-day authorization claim is accepted through the production boundary'
);
reset role;
select results_eq(
  $$select lower(access_range), upper(access_range),
      (select result ->> 'status' from full_day_authorization_claim),
      claims.amount_fils,
      (select price_iqd from public.booking_request_authorization_claim_items items
        where items.claim_id = claims.id),
      (select array_agg(occupancies.shift_id order by occupancies.shift_id)
        from public.booking_request_authorization_claim_occupancies occupancies
        where occupancies.claim_id = claims.id)
        = (select array_agg(shifts.id order by shifts.id)
          from public.cottage_shifts shifts
          where shifts.schedule_revision_id = claims.schedule_revision_id),
      (select count(*) from public.booking_request_authorization_claim_occupancies occupancies
        where occupancies.claim_id = claims.id)
    from public.booking_request_authorization_claims claims
    cross join lateral unnest(claims.access_ranges) access_range
    where claims.attempt_id = (
      select (result ->> 'attemptId')::uuid from full_day_prepared_submission
    )$$,
  $$values (
    '2099-08-23 06:00:00+00'::timestamptz,
    '2099-08-24 06:00:00+00'::timestamptz,
    'ready'::text, 195000000::bigint, 190000::bigint, true, 2::bigint
  )$$,
  'a 24-hour Full-day authorization claim persists next-day access and both components'
);
set local role service_role;
select throws_ok(
  $$select public.create_pending_booking_period_hold(
    '00000000-0000-0000-0000-000000003206',
    '30000000-0000-4000-8000-000000003201',
    'RC-FULL-DAY-CLAIM-CONFLICT-3206',
    '{"from":"2099-08-24","to":"2099-08-24","guests":4,"selections":[{"serviceDay":"2099-08-24","kind":"shift","position":1}]}'::jsonb
  )$$,
  'RC409', null,
  'a 24-hour Full-day authorization claim blocks overlapping access'
);
reset role;

select * from finish();
rollback;
