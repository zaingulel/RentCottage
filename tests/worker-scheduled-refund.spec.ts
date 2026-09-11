import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { triggerScheduled } from "./fixtures/trigger-scheduled";
const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
  };
};
test("scheduled refunds complete a cancellation once and retain the original capture", async ({
  baseURL,
}) => {
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  const request = "60000000-0000-4000-8000-000000001001";
  const source = readFileSync(
    "supabase/tests/database/booking_cancellation.test.sql",
    "utf8",
  );
  const fixture = source.slice(
    0,
    source.indexOf("-- END CANCELLATION FIXTURE"),
  );
  const observerSource = readFileSync(
    "scripts/verify-booking-refund-concurrency.mjs",
    "utf8",
  );
  const template = (name: string) =>
    observerSource.split(`const ${name} = \``)[1].split("`;")[0];
  const reset = template("resetRefunds") + template("resetCancellation");
  let cleanup = reset + template("cleanup").replace("${resetCancellation}", "");
  for (const [key, value] of Object.entries({
    request,
    claim: "72000000-0000-4000-8000-000000001001",
    owner: "10000000-0000-4000-8000-000000001001",
    customer: "10000000-0000-4000-8000-000000001002",
  }))
    cleanup = cleanup.replaceAll(`\${${key}}`, value);
  const observe = () =>
    JSON.parse(
      harness.runSql(
        `select jsonb_build_object('capture',(select to_jsonb(capture) from public.payment_provider_operations capture join public.booking_confirmations confirmation on confirmation.capture_operation_id=capture.id where confirmation.booking_request_id='${request}'),'refunds',(select jsonb_agg(to_jsonb(operation) order by operation.id) from public.payment_provider_operations operation where operation.claim_id='72000000-0000-4000-8000-000000001001' and operation.operation_kind='refund'),'effects',(select sum(effect.physical_execution_count) from public.simulated_payment_effects effect join public.payment_provider_operations operation on operation.id=effect.operation_id where operation.claim_id='72000000-0000-4000-8000-000000001001' and operation.operation_kind='refund'),'returnedEvents',(select count(*) from public.booking_notification_events where booking_request_id='${request}' and event_kind='refund_returned'));`,
      ),
    );
  try {
    harness.runSql(cleanup);
    harness.runSql(`${fixture} select pg_temp.seed_cancellation_booking('2101-01-01'); set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
      select public.commit_booking_cancellation('${request}','90000000-0000-4000-8000-000000003830','cottage_owner','Unavailable property',null,jsonb_build_object('revision',public.get_booking_cancellation_facts('${request}','cottage_owner')->>'revision','refundObligation','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb)); commit;`);
    const before = observe();
    expect(before.refunds).toBeNull();
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    const after = observe();
    expect(after.capture).toEqual(before.capture);
    expect(after.refunds).toHaveLength(1);
    expect(after.refunds[0]).toMatchObject({
      amount_fils: 115000000,
      current_outcome: "succeeded",
      payment_lifecycle_id: before.capture.payment_lifecycle_id,
    });
    expect(after.effects).toBe(1);
    expect(after.returnedEvents).toBe(2);
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    expect(observe()).toEqual(after);
  } finally {
    harness.runSql(cleanup);
  }
});
