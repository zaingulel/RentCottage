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
test("scheduled cancellation refunds and notices settle once through the shared workers", async ({
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
        `select jsonb_build_object('capture',(select to_jsonb(capture) from public.payment_provider_operations capture join public.booking_confirmations confirmation on confirmation.capture_operation_id=capture.id where confirmation.booking_request_id='${request}'),'refunds',(select jsonb_agg(to_jsonb(operation) order by operation.id) from public.payment_provider_operations operation where operation.claim_id='72000000-0000-4000-8000-000000001001' and operation.operation_kind='refund'),'effects',(select sum(effect.physical_execution_count) from public.simulated_payment_effects effect join public.payment_provider_operations operation on operation.id=effect.operation_id where operation.claim_id='72000000-0000-4000-8000-000000001001' and operation.operation_kind='refund'),'returnedEvents',(select count(*) from public.booking_notification_events where booking_request_id='${request}' and event_kind='refund_returned'),'notices',(select jsonb_agg(jsonb_build_object('logicalId',w.logical_id,'receiptId',w.receipt_id,'eventId',w.event_id,'kind',e.event_kind,'recipientRole',w.recipient_role,'state',w.state,'payload',w.payload,'supplierDeliveryReference',w.supplier_delivery_reference) order by w.logical_id) from public.booking_confirmation_notification_work w join public.booking_notification_events e on e.id=w.event_id where w.booking_request_id='${request}'),'notificationEffects',(select count(*) from public.fictional_booking_confirmation_notification_effects where booking_request_id='${request}'));`,
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
    const settled = observe();
    expect(settled.capture).toEqual(before.capture);
    expect(settled.refunds).toEqual(after.refunds);
    expect(settled.effects).toBe(1);
    expect(settled.notices).toHaveLength(6);
    expect(settled.notificationEffects).toBe(6);
    const identities = new Set<string>();
    for (const notice of settled.notices) {
      identities.add(notice.logicalId);
      expect(notice.state).toBe("delivered");
      expect(notice.logicalId).toBe(`booking-event:${notice.eventId}`);
      expect(notice.supplierDeliveryReference).toBe(
        `fictional-booking-event-${notice.eventId}`,
      );
      expect(notice.payload.allocation).toEqual({
        bookingPriceFils: 110000000,
        bookingServiceFeeFils: 5000000,
      });
      expect(notice.payload.detailsPath).toBe(
        `/en/${notice.recipientRole === "customer" ? "booking-requests" : "owner/booking-requests"}/RC-REQ-0000000000001001`,
      );
      expect(JSON.stringify(notice.payload)).not.toContain(
        "Unavailable property",
      );
      if (notice.kind === "refund_requested")
        expect(notice.payload.body).toContain(
          "was requested. View your booking for its current status.",
        );
      if (notice.kind === "refund_returned")
        expect(notice.payload.body).toContain("has been verified as returned");
    }
    expect(identities.size).toBe(6);
    expect(
      settled.notices.map((notice: { kind: string }) => notice.kind).sort(),
    ).toEqual([
      "cancelled",
      "cancelled",
      "refund_requested",
      "refund_requested",
      "refund_returned",
      "refund_returned",
    ]);
    // Refund and notification drains intentionally run concurrently. This next
    // explicit tick must be an idempotent repeat after both have settled.
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    expect(observe()).toEqual(settled);
  } finally {
    harness.runSql(cleanup);
  }
});
