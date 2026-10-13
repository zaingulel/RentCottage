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
const {
  confirmedBookingCleanup,
  refundReset,
  browserBookingFixtureIdentity,
  bookingFixtureSource,
} = createRequire(import.meta.url)("../scripts/lib/booking-fixture.mjs") as {
  browserBookingFixtureIdentity(
    file: string,
    project: string,
  ): Record<
    | "stem"
    | "owner"
    | "administrator"
    | "request"
    | "reference"
    | "claim"
    | "captureFingerprint",
    string
  >;
  bookingFixtureSource(
    source: string,
    options: { start?: string; end: string; required?: string[] },
  ): string;
  confirmedBookingCleanup(options?: {
    stem?: string;
    administrator?: string;
    completion?: boolean;
    settlement?: boolean;
    terminalRequest?: boolean;
  }): string;
  refundReset(options?: { stem?: string }): string;
};
test("scheduled cancellation refunds and notices settle once through the shared workers", async ({
  baseURL,
}, testInfo) => {
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  const identity = browserBookingFixtureIdentity(
    "refund",
    testInfo.project.name,
  );
  const { request } = identity;
  const source = readFileSync(
    "supabase/tests/database/booking_cancellation.test.sql",
    "utf8",
  );
  const fixture = bookingFixtureSource(source, {
    end: "-- END CANCELLATION FIXTURE",
    required: [
      "00000000100",
      "964750000100",
      "CONFIRMATION-HOLD-1",
      "Confirmation Cottage",
      "confirmation-auth-",
      "10000000-0000-4000-8000-000000003801",
      "cancellation-admin@example.test",
      "RC-REQ-0000000000001001",
      "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
    ],
  })
    .replaceAll("00000000100", `00000000${identity.stem}`)
    .replaceAll("964750000100", `964750000${identity.stem}`)
    .replaceAll("confirmation-auth-", `confirmation-auth-${identity.stem}-`)
    .replaceAll("CONFIRMATION-HOLD-1", `REFUND-HOLD-${identity.stem}`)
    .replaceAll("Confirmation Cottage", `refund ${identity.stem} Cottage`)
    .replaceAll("10000000-0000-4000-8000-000000003801", identity.administrator)
    .replaceAll(
      "cancellation-admin@example.test",
      `refund-${identity.stem}@example.test`,
    )
    .replaceAll(
      "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
      identity.captureFingerprint,
    );
  const cleanup =
    refundReset({ stem: identity.stem }) +
    confirmedBookingCleanup({
      stem: identity.stem,
      administrator: identity.administrator,
    });
  const observe = () =>
    JSON.parse(
      harness.runSql(
        `select jsonb_build_object('capture',(select to_jsonb(capture) from public.payment_provider_operations capture join public.booking_confirmations confirmation on confirmation.capture_operation_id=capture.id where confirmation.booking_request_id='${request}'),'refunds',(select jsonb_agg(to_jsonb(operation) order by operation.id) from public.payment_provider_operations operation where operation.claim_id='${identity.claim}' and operation.operation_kind='refund'),'effects',(select sum(effect.physical_execution_count) from public.simulated_payment_effects effect join public.payment_provider_operations operation on operation.id=effect.operation_id where operation.claim_id='${identity.claim}' and operation.operation_kind='refund'),'returnedEvents',(select count(*) from public.booking_notification_events where booking_request_id='${request}' and event_kind='refund_returned'),'notices',(select jsonb_agg(jsonb_build_object('logicalId',w.logical_id,'receiptId',w.receipt_id,'eventId',w.event_id,'kind',e.event_kind,'recipientRole',w.recipient_role,'state',w.state,'payload',w.payload,'supplierDeliveryReference',w.supplier_delivery_reference) order by w.logical_id) from public.booking_confirmation_notification_work w join public.booking_notification_events e on e.id=w.event_id where w.booking_request_id='${request}'),'notificationEffects',(select count(*) from public.fictional_booking_confirmation_notification_effects where booking_request_id='${request}'));`,
      ),
    );
  try {
    harness.runSql(cleanup);
    harness.runSql(`${fixture} select pg_temp.seed_cancellation_booking('2101-01-01'); set local role authenticated; select set_config('request.jwt.claim.sub','${identity.owner}',true);
      select public.commit_booking_cancellation('${request}','90000000-0000-4000-8000-00000000${identity.stem}4','cottage_owner','Unavailable property',null,jsonb_build_object('revision',public.get_booking_cancellation_facts('${request}','cottage_owner')->>'revision','refundObligation','{"bookingPriceFils":110000000,"bookingServiceFeeFils":5000000}'::jsonb)); commit;`);
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
        `/en/${notice.recipientRole === "customer" ? "booking-requests" : "owner/booking-requests"}/${identity.reference}`,
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
