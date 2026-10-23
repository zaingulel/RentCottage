begin;
select no_plan();
select has_table('public', 'payment_provider_operations', 'payment evidence is provider independent');
select has_table('public', 'payment_provider_observations', 'provider observations are append-only evidence');
select has_table('public', 'simulated_payment_effects', 'fictional effects have isolated persistence');
select hasnt_table('public', 'simulated_payment_provider_operations', 'the old simulator ledger is retired');
select has_function('public', 'persist_simulated_payment_effect', array['jsonb','jsonb'], 'effect arbitration is available');
select has_function('public', 'seal_simulated_payment_absence', array['jsonb'], 'inquiry durably closes an unused attempt');

create temporary table effect_binding as select jsonb_build_object(
  'operationId','91000000-0000-4000-8000-000000000001',
  'providerIdentity',jsonb_build_object('provider','fictional-payments','environment','local-test','merchantId','fictional-merchant','terminalId','fictional-terminal'),
  'idempotencyKey','payment-evidence-test-1','requestFingerprint',repeat('a',64),'notBefore',null,'notAfter',clock_timestamp()+interval '10 minutes'
) as binding;
create temporary table proposed_effect as select jsonb_build_object(
  'outcome','succeeded','providerRequestId','fiction-request-1','providerReference','fiction-reference-1','movementReference','fiction-movement-1',
  'evidence',jsonb_build_object('operationId','91000000-0000-4000-8000-000000000001','eventId','fiction-event-1','provenance','fictional-provider','originalOutcome','succeeded','executedAt',clock_timestamp(),'occurredAt',clock_timestamp(),'closedAt',null)
) as result;
select throws_ok($$select public.validate_payment_provider_observation(jsonb_set((select result from proposed_effect),'{evidence,provenance}','null'), '91000000-0000-4000-8000-000000000001')$$,
  'RC409',null,'normalized provider evidence must reject null provenance');
grant select on effect_binding,proposed_effect to service_role;
grant select on effect_binding to authenticated;
set local role service_role;
select lives_ok($$select public.seal_simulated_payment_absence((select binding from effect_binding))$$,
  'an inquiry without references durably closes the original attempt');
reset role;
select is((select state from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000001'),
  'closed-not-executed','absence is a durable terminal coordination state');
select is((select physical_execution_count::integer from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000001'),
  0,'absence has no physical execution');
set local role service_role;
select is(public.persist_simulated_payment_effect((select binding from effect_binding),(select result from proposed_effect))->>'outcome',
  'not-executed','a delayed executor cannot reopen the sealed attempt');
select throws_ok($$select public.persist_simulated_payment_effect((select binding || '{"requestFingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}' from effect_binding),(select result from proposed_effect))$$,
  'RC409',null,'a reused idempotency key cannot replace immutable binding');
reset role;
select is((select physical_execution_count::integer from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000001'),0,'closure replay remains zero executions');
select ok((select result#>>'{evidence,closedAt}' is not null and result#>>'{evidence,occurredAt}' is null
  and not result ?| array['providerRequestId','providerReference','movementReference'] from public.simulated_payment_effects
  where operation_id='91000000-0000-4000-8000-000000000001'),'absence has closure time without fabricated movement or occurrence');
update effect_binding set binding=binding || jsonb_build_object('operationId','91000000-0000-4000-8000-000000000002','idempotencyKey','payment-evidence-test-2');
update proposed_effect set result=jsonb_set(result,'{evidence,operationId}','"91000000-0000-4000-8000-000000000002"');
set local role service_role;
select is(public.persist_simulated_payment_effect((select binding from effect_binding),(select result from proposed_effect))->>'outcome','succeeded','an admitted fictional effect executes once');
select is(public.seal_simulated_payment_absence((select binding from effect_binding))->>'outcome','succeeded','inquiry cannot overwrite an executed effect with absence');
reset role;
select is((select physical_execution_count::integer from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000002'),1,'executed result retains exactly one physical attempt');
update effect_binding set binding=binding || jsonb_build_object('operationId','91000000-0000-4000-8000-000000000003','idempotencyKey','payment-evidence-test-3','notAfter',clock_timestamp()-interval '1 second');
update proposed_effect set result=jsonb_set(result,'{evidence,operationId}','"91000000-0000-4000-8000-000000000003"');
set local role service_role;
select is(public.persist_simulated_payment_effect((select binding from effect_binding),(select result from proposed_effect))->>'outcome','not-executed','database deadline prevents execution without a prior inquiry');
reset role;
select is((select physical_execution_count::integer from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000003'),0,'deadline closure creates no money movement');
-- Fictional proposals carry host clock values; the database owns effect occurrence.
update effect_binding set binding=binding || jsonb_build_object('operationId','91000000-0000-4000-8000-000000000004','idempotencyKey','payment-evidence-test-4','notAfter',clock_timestamp()+interval '10 minutes');
update proposed_effect set result=jsonb_set(jsonb_set(jsonb_set(result,'{evidence,operationId}','"91000000-0000-4000-8000-000000000004"'),'{evidence,executedAt}',to_jsonb(clock_timestamp()+interval '1 minute')),'{evidence,occurredAt}',to_jsonb(clock_timestamp()+interval '1 minute'));
set local role service_role;
select throws_ok($$select public.persist_simulated_payment_effect((select binding from effect_binding),(select jsonb_set(result,'{evidence,executedAt}','"invalid-host-clock"') from proposed_effect))$$,'RC409',null,'fictional host clock independence still rejects malformed proposal timestamps');
select throws_ok($$select public.persist_simulated_payment_effect((select binding from effect_binding),(select jsonb_set(result,'{providerReference}','null') from proposed_effect))$$,'RC409',null,'fictional host clock independence still rejects malformed proposal references');
reset role;
select throws_ok($$select public.validate_payment_provider_observation((select result from proposed_effect),'91000000-0000-4000-8000-000000000004')$$,'RC409',null,'trusted provider observations still reject future occurrence');
set local role service_role;
select lives_ok($$select public.persist_simulated_payment_effect((select binding from effect_binding),(select result from proposed_effect))$$,'fictional execution uses its own post-lock database clock despite a future host proposal');
reset role;
select ok((select (result#>>'{evidence,executedAt}')::timestamptz<=clock_timestamp() and result#>'{evidence,executedAt}'=result#>'{evidence,occurredAt}' from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000004'),'fictional proposal timestamps never become provider occurrence');
set local role service_role;
select lives_ok($$select public.persist_simulated_payment_effect((select binding from effect_binding),(select result from proposed_effect))$$,'existing effect replay is independent of the retrier host clock');
reset role;
update effect_binding set binding=(select binding from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000001');
update proposed_effect set result=jsonb_set(result,'{evidence,operationId}','"91000000-0000-4000-8000-000000000001"');
set local role service_role;
select lives_ok($$select public.persist_simulated_payment_effect((select binding from effect_binding),(select result from proposed_effect))$$,'closed attempt replay is independent of the delayed executor host clock');
reset role;
select is((select physical_execution_count::integer from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000001'),0,'future proposal replay cannot reopen a closure');
update effect_binding set binding=binding || jsonb_build_object('operationId','91000000-0000-4000-8000-000000000005','idempotencyKey','payment-evidence-test-5','notAfter',clock_timestamp()+interval '10 minutes');
update proposed_effect set result=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(result,'{evidence,operationId}','"91000000-0000-4000-8000-000000000005"'),'{outcome}','"indeterminate"'),'{evidence,originalOutcome}','"indeterminate"'),'{evidence,executedAt}',to_jsonb(clock_timestamp())),'{evidence,occurredAt}','null');
set local role service_role;
create temp table initial_uncertain_effect as select public.persist_simulated_payment_effect((select binding from effect_binding),(select result from proposed_effect)) result;
reset role;
update proposed_effect set result=(select jsonb_set(jsonb_set(jsonb_set(result,'{outcome}','"succeeded"'),'{evidence,eventId}','"fiction-event-resolved"'),'{evidence,occurredAt}',to_jsonb(clock_timestamp()+interval '1 minute')) from initial_uncertain_effect);
set local role service_role;
select lives_ok($$select public.resolve_simulated_payment_effect((select binding from effect_binding),(select result#>>'{evidence,eventId}' from initial_uncertain_effect),(select result from proposed_effect))$$,'fictional resolution uses database occurrence without rejecting the host proposal clock');
reset role;
select ok((select effect.result->>'outcome'='succeeded' and effect.result#>'{evidence,executedAt}'=initial.result#>'{evidence,executedAt}' and (effect.result#>>'{evidence,occurredAt}')::timestamptz<=clock_timestamp() from public.simulated_payment_effects effect cross join initial_uncertain_effect initial where effect.operation_id='91000000-0000-4000-8000-000000000005'),'resolution preserves the original execution while stamping its own occurrence');
create temporary table hosted_effect_binding as select jsonb_build_object(
  'operationId','91000000-0000-4000-8000-000000000101',
  'providerIdentity',jsonb_build_object('provider','fictional-payments','environment','hosted-demo-yvibcyqtyihpzpmomnzg','merchantId','fictional-merchant','terminalId','fictional-terminal'),
  'idempotencyKey','payment-evidence-hosted-101','requestFingerprint',repeat('a',64),'notBefore',null,'notAfter',clock_timestamp()+interval '10 minutes'
) as binding;
grant select on hosted_effect_binding to service_role;
set local role service_role;
select lives_ok($$select public.seal_simulated_payment_absence((select binding from hosted_effect_binding))$$,
  'approved hosted fictional effect binding is admitted');
reset role;
select is((select environment from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000101'),
  'hosted-demo-yvibcyqtyihpzpmomnzg','hosted absence retains the approved environment');
select is((select state from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000101'),
  'closed-not-executed','hosted absence is a durable terminal coordination state');
select is((select physical_execution_count::integer from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000101'),
  0,'hosted absence has no physical execution');
select is((select binding from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000101'),
  (select binding from hosted_effect_binding),'hosted absence preserves the original full binding');
create temporary table hosted_proposed_effect as select jsonb_build_object(
  'outcome','succeeded','providerRequestId','hosted-request-101','providerReference','hosted-reference-101','movementReference','hosted-movement-101',
  'evidence',jsonb_build_object('operationId','91000000-0000-4000-8000-000000000101','eventId','hosted-event-101','provenance','fictional-provider','originalOutcome','succeeded','executedAt',clock_timestamp()+interval '1 minute','occurredAt',clock_timestamp()+interval '1 minute','closedAt',null)
) as result;
grant select on hosted_proposed_effect to service_role;
set local role service_role;
select lives_ok($$select public.persist_simulated_payment_effect((select binding from hosted_effect_binding),(select result from hosted_proposed_effect))$$,
  'a hosted late executor cannot reopen durable absence');
reset role;
select ok((select state='closed-not-executed' and physical_execution_count=0 and result->>'outcome'='not-executed'
  and result#>'{evidence,executedAt}'='null'::jsonb and result#>'{evidence,occurredAt}'='null'::jsonb
  and (result#>>'{evidence,closedAt}')::timestamptz<=clock_timestamp()
  and not result ?| array['providerRequestId','providerReference','movementReference']
  from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000101'),
  'hosted absence retains database closure without execution or fabricated movement');

update hosted_effect_binding set binding=binding || jsonb_build_object('operationId','91000000-0000-4000-8000-000000000102','idempotencyKey','payment-evidence-hosted-102');
update hosted_proposed_effect set result=jsonb_set(result,'{evidence,operationId}','"91000000-0000-4000-8000-000000000102"');
set local role service_role;
select lives_ok($$select public.persist_simulated_payment_effect((select binding from hosted_effect_binding),(select result from hosted_proposed_effect))$$,
  'approved hosted fictional execution persists successfully');
reset role;
select is((select count(*)::integer from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000102'),1,
  'hosted execution has one authoritative effect row');
select is((select jsonb_build_object('provider',provider,'environment',environment,'merchantId',merchant_id,'terminalId',terminal_id)
  from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000102'),
  '{"provider":"fictional-payments","environment":"hosted-demo-yvibcyqtyihpzpmomnzg","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb,
  'hosted execution stores the exact complete supplier identity');
select is((select binding from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000102'),
  (select binding from hosted_effect_binding),'hosted execution stores its original complete binding');
select ok((select state='executed' and physical_execution_count=1 and result->>'outcome'='succeeded'
  and (result#>>'{evidence,executedAt}')::timestamptz<=clock_timestamp()
  and result#>'{evidence,executedAt}'=result#>'{evidence,occurredAt}'
  and (result#>>'{evidence,executedAt}')::timestamptz=updated_at
  from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000102'),
  'hosted execution occurs once at the authoritative database timestamp');
create temporary table hosted_original_effect as select result from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000102';
set local role service_role;
select lives_ok($$select public.persist_simulated_payment_effect((select binding from hosted_effect_binding),(select result from hosted_proposed_effect))$$,
  'hosted execution replays through the original durable binding');
select lives_ok($$select public.seal_simulated_payment_absence((select binding from hosted_effect_binding))$$,
  'hosted inquiry preserves an already executed effect');
select throws_ok($$select public.seal_simulated_payment_absence((select jsonb_set(binding,'{requestFingerprint}',to_jsonb(repeat('b',64))) from hosted_effect_binding))$$,
  'RC409','Fictional effect binding changed','hosted replay refuses a conflicting immutable fingerprint');
select throws_ok($$select public.seal_simulated_payment_absence((select jsonb_set(binding,'{operationId}','"91000000-0000-4000-8000-000000000109"') from hosted_effect_binding))$$,
  'RC409','Fictional effect binding changed','hosted idempotency cannot be rebound to another operation');
reset role;
select is((select result from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000102'),
  (select result from hosted_original_effect),'hosted replay and inquiry preserve the original receipt');
select is((select physical_execution_count::integer from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000102'),1,
  'hosted replay and inquiry retain one physical execution');

update hosted_effect_binding set binding=binding || jsonb_build_object('operationId','91000000-0000-4000-8000-000000000103','idempotencyKey','payment-evidence-hosted-103');
update hosted_proposed_effect set result=jsonb_set(jsonb_set(jsonb_set(result-'movementReference','{outcome}','"failed"'),'{evidence,originalOutcome}','"failed"'),'{evidence,operationId}','"91000000-0000-4000-8000-000000000103"') || '{"retrySafe":false}'::jsonb;
set local role service_role;
select lives_ok($$select public.persist_simulated_payment_effect((select binding from hosted_effect_binding),(select result from hosted_proposed_effect))$$,
  'hosted fictional failure persists without inventing a successful movement');
reset role;
select ok((select physical_execution_count=1 and state='executed' and result->>'outcome'='failed'
  and result->'retrySafe'='false'::jsonb and not result ? 'movementReference'
  and (result#>>'{evidence,executedAt}')::timestamptz<=clock_timestamp()
  and result#>'{evidence,executedAt}'=result#>'{evidence,occurredAt}'
  and binding=(select binding from hosted_effect_binding)
  from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000103'),
  'hosted failure retains its binding, retry safety and database execution evidence');

update hosted_effect_binding set binding=binding || jsonb_build_object('operationId','91000000-0000-4000-8000-000000000104','idempotencyKey','payment-evidence-hosted-104');
update hosted_proposed_effect set result=jsonb_set(jsonb_set(jsonb_set(jsonb_set(result-'retrySafe','{outcome}','"indeterminate"'),'{evidence,originalOutcome}','"indeterminate"'),'{evidence,operationId}','"91000000-0000-4000-8000-000000000104"'),'{evidence,occurredAt}','null') || '{"movementReference":"hosted-movement-104"}'::jsonb;
set local role service_role;
select lives_ok($$select public.persist_simulated_payment_effect((select binding from hosted_effect_binding),(select result from hosted_proposed_effect))$$,
  'hosted indeterminate execution retains durable inquiry evidence');
reset role;
select ok((select physical_execution_count=1 and result->>'outcome'='indeterminate'
  and result#>'{evidence,occurredAt}'='null'::jsonb
  and (result#>>'{evidence,executedAt}')::timestamptz<=clock_timestamp()
  from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000104'),
  'hosted indeterminate evidence distinguishes execution from known occurrence');
create temporary table hosted_initial_uncertain_effect as select result from public.simulated_payment_effects where operation_id='91000000-0000-4000-8000-000000000104';
grant select on hosted_initial_uncertain_effect to service_role;
update hosted_proposed_effect set result=(select jsonb_set(jsonb_set(jsonb_set(result,'{outcome}','"succeeded"'),'{evidence,eventId}','"hosted-event-resolved"'),'{evidence,occurredAt}',to_jsonb(clock_timestamp()+interval '1 minute')) from hosted_initial_uncertain_effect);
set local role service_role;
select lives_ok($$select public.resolve_simulated_payment_effect((select binding from hosted_effect_binding),(select result#>>'{evidence,eventId}' from hosted_initial_uncertain_effect),(select result from hosted_proposed_effect))$$,
  'hosted inquiry resolution preserves execution and stamps database occurrence');
reset role;
select ok((select effect.physical_execution_count=1 and effect.result->>'outcome'='succeeded'
  and effect.result#>>'{evidence,originalOutcome}'='indeterminate'
  and effect.result#>'{evidence,executedAt}'=initial.result#>'{evidence,executedAt}'
  and effect.result-array['outcome','evidence']=initial.result-array['outcome','evidence']
  and (effect.result#>>'{evidence,occurredAt}')::timestamptz=effect.updated_at
  and effect.updated_at<=clock_timestamp() and effect.binding=(select binding from hosted_effect_binding)
  from public.simulated_payment_effects effect cross join hosted_initial_uncertain_effect initial
  where effect.operation_id='91000000-0000-4000-8000-000000000104'),
  'hosted resolution retains original references, movement, binding and execution timestamp');

set local role service_role;
select throws_ok(format('select public.seal_simulated_payment_absence(%L::jsonb)',invalid.binding),
  'RC409','Fictional effect binding is invalid',invalid.description)
from (select binding-'providerIdentity' binding,'hosted effect refuses missing identity' description from hosted_effect_binding
  union all select jsonb_set(binding,'{providerIdentity}','null'),'hosted effect refuses null identity' from hosted_effect_binding
  union all select jsonb_set(binding,'{providerIdentity}','"invalid"'),'hosted effect refuses non-object identity' from hosted_effect_binding
  union all select jsonb_set(binding,'{providerIdentity,environment}','"unknown"'),'hosted effect refuses unknown environment' from hosted_effect_binding
  union all select jsonb_set(binding,'{providerIdentity,environment}','null'),'hosted effect refuses null environment' from hosted_effect_binding
  union all select jsonb_set(binding,'{providerIdentity,provider}','"foreign-provider"'),'hosted effect refuses foreign provider' from hosted_effect_binding
  union all select jsonb_set(binding,'{providerIdentity,merchantId}','"foreign-merchant"'),'hosted effect refuses foreign merchant' from hosted_effect_binding
  union all select jsonb_set(binding,'{providerIdentity,terminalId}','"foreign-terminal"'),'hosted effect refuses foreign terminal' from hosted_effect_binding
  union all select jsonb_set(binding,'{providerIdentity,extra}','true'),'hosted effect refuses extra identity fields' from hosted_effect_binding
  union all select binding || '{"extra":true}'::jsonb,'hosted effect refuses extra binding fields' from hosted_effect_binding) invalid;
reset role;
select throws_ok($$insert into public.simulated_payment_effects(operation_id,provider,environment,merchant_id,terminal_id,idempotency_key,binding,state,physical_execution_count)
  select '91000000-0000-4000-8000-000000000105','fictional-payments','hosted-demo-yvibcyqtyihpzpmomnzg','foreign-merchant','fictional-terminal','payment-evidence-hosted-105',
    jsonb_set(binding || '{"operationId":"91000000-0000-4000-8000-000000000105","idempotencyKey":"payment-evidence-hosted-105"}'::jsonb,'{providerIdentity,merchantId}','"foreign-merchant"'),
    'reserved',0 from hosted_effect_binding$$,
  '23514','new row for relation "simulated_payment_effects" violates check constraint "simulated_payment_effect_scope"',
  'the hosted table constraint independently refuses a foreign merchant');
select lives_ok($$insert into public.simulated_payment_effects(operation_id,provider,environment,merchant_id,terminal_id,idempotency_key,binding,state,physical_execution_count)
  values('91000000-0000-4000-8000-000000000106','other-local-provider','local-test','other-local-merchant','other-local-terminal','payment-evidence-local-106','{}','reserved',0)$$,
  'the local table constraint preserves its existing nonempty supplier scope');
set local role anon;
select throws_ok($$select public.seal_simulated_payment_absence('{"operationId":"91000000-0000-4000-8000-000000000107","providerIdentity":{"provider":"fictional-payments","environment":"hosted-demo-yvibcyqtyihpzpmomnzg","merchantId":"fictional-merchant","terminalId":"fictional-terminal"},"idempotencyKey":"payment-evidence-hosted-107","requestFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","notBefore":null,"notAfter":null}')$$,
  '42501',null,'anonymous callers cannot inquire into hosted effects');
select throws_ok($$select public.persist_simulated_payment_effect('{}','{}')$$,'42501',null,'anonymous callers cannot execute hosted effects');
select throws_ok($$select public.resolve_simulated_payment_effect('{}','event','{}')$$,'42501',null,'anonymous callers cannot resolve hosted effects');
reset role;
set local role authenticated;
select throws_ok($$select public.seal_simulated_payment_absence('{"operationId":"91000000-0000-4000-8000-000000000107","providerIdentity":{"provider":"fictional-payments","environment":"hosted-demo-yvibcyqtyihpzpmomnzg","merchantId":"fictional-merchant","terminalId":"fictional-terminal"},"idempotencyKey":"payment-evidence-hosted-107","requestFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","notBefore":null,"notAfter":null}')$$,
  '42501',null,'authenticated callers cannot inquire into hosted effects');
select throws_ok($$select public.persist_simulated_payment_effect('{}','{}')$$,'42501',null,'authenticated callers cannot execute hosted effects');
select throws_ok($$select public.resolve_simulated_payment_effect('{}','event','{}')$$,'42501',null,'authenticated callers cannot resolve hosted effects');
reset role;
set local role authenticated;
select throws_ok($$select public.seal_simulated_payment_absence((select binding from effect_binding))$$,'42501',null,'customer cannot access provider effect coordination');
reset role;
select * from finish();
rollback;
