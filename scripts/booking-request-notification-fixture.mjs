import { readFileSync } from "node:fs";
// One exact fictional request, shared by its SQL, concurrency, upgrade and Worker observers.
export const request = "60000000-0000-4000-8000-000000001001";
export const owner = "10000000-0000-4000-8000-000000001001";
export const customer = "10000000-0000-4000-8000-000000001002";
const source = readFileSync(
  "supabase/tests/database/booking_request_notification.test.sql",
  "utf8",
);
const end = source.indexOf("select no_plan();");
if (end < 0)
  throw new Error("Request notification fixture boundary is missing");
export const fixture = source.slice(0, end);
export const baselineFixture = source.slice(
  0,
  source.indexOf("create function pg_temp.notice_call"),
);
const cleanupSource = readFileSync(
  "scripts/verify-booking-refund-concurrency.mjs",
  "utf8",
);
const template = (name) => {
  const value = cleanupSource.split(`const ${name} = \``)[1]?.split("`;\n")[0];
  if (!value) throw new Error(`Missing refund cleanup ${name}`);
  return value;
};
let sql =
  template("resetRefunds") +
  template("resetCancellation") +
  template("cleanup").replace("${resetCancellation}", "");
for (const [key, value] of Object.entries({
  request,
  owner,
  customer,
  claim: "72000000-0000-4000-8000-000000001001",
}))
  sql = sql.replaceAll(`\${${key}}`, value);
// Request events have no receipt; cleanup follows the actual work identity.
sql = sql.replace(
  "where receipt_id in (select receipt_id",
  "where notification_id in (select notification_id",
);
sql = sql.replace(
  "delete from public.booking_request_payment_history",
  `delete from public.booking_request_release_operations where work_id in (select id from public.booking_request_release_work where booking_request_id='${request}');\ndelete from public.booking_request_release_work where booking_request_id='${request}';\ndelete from public.booking_request_status_notifications where booking_request_id='${request}';\ndelete from public.owner_request_notifications where booking_request_id='${request}';\ndelete from public.booking_request_payment_recovery_operations where recovery_attempt_id in (select id from public.booking_request_payment_recovery_attempts where booking_request_id='${request}');\ndelete from public.booking_request_payment_recovery_attempts where booking_request_id='${request}';\ndelete from public.booking_request_payment_required_expiry_work where booking_request_id='${request}';\ndelete from public.booking_request_payment_history`,
);
export const cleanup = sql;
export const parse = (value) =>
  JSON.parse(value.split("\n").filter(Boolean).at(-1));
export const json = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
export const binding = (lease) =>
  Object.fromEntries(
    Object.entries(lease).filter(
      ([key]) =>
        !["leaseGeneration", "leaseToken", "leaseExpiresAt"].includes(key),
    ),
  );
// Real terminal release evidence, following the existing submission observer.
export const terminalReleaseSql = `
create function pg_temp.finish_terminal_release(target_action text) returns jsonb language plpgsql as $$
declare lease jsonb; declare pending jsonb; declare permit jsonb; declare outcome jsonb; declare release jsonb; declare identity jsonb := '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}';
begin
  perform set_config('role','service_role',true);
  if target_action='expire' then lease:=public.claim_booking_request_expiry('${request}');
  else lease:=public.claim_booking_request_action(case when target_action='withdraw' then '${customer}'::uuid else '${owner}'::uuid end,'${request}',target_action,case when target_action='decline' then 'cottage_unavailable' end); end if;
  if lease->>'status'<>'release-required' then raise exception 'Expected real terminal release work: %',lease; end if;
  pending:=jsonb_set(lease->'paymentSnapshot','{release}',jsonb_build_object('paymentLifecycleId',lease->>'paymentLifecycleId','kind','release','logicalOperationId',(lease->>'paymentLifecycleId')||':release','attemptId',(lease->>'paymentLifecycleId')||':release:attempt-2','status','pending','amountFils',(lease->>'authorizedAmountFils')::bigint,'providerRequestId',null,'providerReference',null,'movementReference',null,'reconciliationRequired',false,'retrySafe',false));
  permit:=public.save_booking_request_release_snapshot((lease->>'workId')::uuid,(lease->>'leaseGeneration')::bigint,(lease->>'leaseToken')::uuid,pending,identity);
  outcome:=pg_temp.payment_fixture_execute('admit_booking_request_provider_operation',jsonb_build_object('providerIdentity',identity,'permitPurpose',permit->>'purpose','idempotencyKey',permit->>'idempotencyKey','requestFingerprint',permit->>'requestFingerprint','notAfter',permit->>'notAfter','paymentLifecycleId',pending->>'paymentLifecycleId','logicalOperationId',pending#>>'{release,logicalOperationId}','physicalAttemptId',pending#>>'{release,attemptId}','operationKind','release','amountFils',(pending#>>'{release,amountFils}')::bigint,'currency','IQD','claimId',null,'claimGeneration',null,'stateRevision',null,'cleanupAttemptId',null,'workId',permit->>'workId','leaseGeneration',(permit->>'leaseGeneration')::bigint,'leaseToken',permit->>'leaseToken','operationId',permit->>'operationId','operationGeneration',(permit->>'operationGeneration')::integer),'succeeded');
  if outcome->>'outcome'<>'succeeded' then raise exception 'Expected successful terminal release: %',outcome; end if;
  release:=pending->'release'||jsonb_build_object('status','succeeded','providerRequestId',outcome->>'providerRequestId','providerReference',outcome->>'providerReference','movementReference',outcome->>'movementReference');
  pending:=jsonb_set(jsonb_set(pending,'{release}',release),'{movements}',pending->'movements'||jsonb_build_array(jsonb_build_object('kind','release','logicalOperationId',release->>'logicalOperationId','attemptId',release->>'attemptId','amountFils',release->'amountFils','movementReference',release->>'movementReference','recordedAt',clock_timestamp())));
  perform public.save_booking_request_release_snapshot((lease->>'workId')::uuid,(lease->>'leaseGeneration')::bigint,(lease->>'leaseToken')::uuid,pending,identity);
  outcome:=public.finalize_booking_request_release((lease->>'workId')::uuid,(lease->>'leaseGeneration')::bigint,(lease->>'leaseToken')::uuid);
  perform set_config('role','none',true);
  return outcome;
end $$;
`;
