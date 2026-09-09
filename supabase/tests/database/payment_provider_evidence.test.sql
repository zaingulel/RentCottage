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
set local role authenticated;
select throws_ok($$select public.seal_simulated_payment_absence((select binding from effect_binding))$$,'42501',null,'customer cannot access provider effect coordination');
reset role;
select * from finish();
rollback;
