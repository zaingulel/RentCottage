import { expect, test } from "@playwright/test";
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
const { request, owner, customer, baselineFixture, cleanup } = createRequire(
  import.meta.url,
)("../scripts/booking-request-notification-fixture.mjs") as {
  request: string;
  owner: string;
  customer: string;
  baselineFixture: string;
  cleanup: string;
};
test.describe.configure({ mode: "serial" });
for (const [action, expected] of [
  ["decline", "declined"],
  ["withdraw", "withdrawn"],
  ["expire", "expired"],
] as const) {
  test(`scheduled Worker delivers new-request and ${expected} notices once from committed facts`, async ({
    baseURL,
  }) => {
    const harness = createLocalSupabaseConcurrencyHarness();
    harness.guardDisposableLocalDatabase();
    const observe = () =>
      JSON.parse(
        harness.runSql(
          `select jsonb_build_object('status',(select status from public.booking_requests where id='${request}'),'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.event_kind,'recipient',e.recipient_user_id,'role',e.recipient_role,'locale',e.notice_locale,'state',w.state,'payload',w.payload) order by e.event_kind,e.recipient_role),'[]') from public.booking_notification_events e left join public.booking_confirmation_notification_work w on w.event_id=e.id where e.booking_request_id='${request}'),'effects',(select count(*) from public.fictional_booking_confirmation_notification_effects where booking_request_id='${request}'),'receipts',(select count(*) from public.booking_receipts r join public.booking_confirmations c on c.id=r.booking_confirmation_id where c.booking_request_id='${request}'))`,
        ),
      ) as {
        status: string;
        events: Array<{
          id: string;
          kind: string;
          recipient: string;
          role: string;
          locale: string;
          state: string;
          payload: Record<string, unknown>;
        }>;
        effects: number;
        receipts: number;
      };
    try {
      harness.runSql(cleanup);
      const seed =
        action === "expire"
          ? baselineFixture.replace(
              "statement_timestamp()+interval '4 hours',statement_timestamp(),null",
              "statement_timestamp()-interval '1 second',statement_timestamp()-interval '4 hours 1 second',null",
            )
          : baselineFixture;
      harness.runSql(`${seed} commit;`);
      if (action !== "expire") {
        const tick = await triggerScheduled(baseURL, "/__scheduled");
        expect(tick.ok, await tick.text()).toBe(true);
        const initial = observe();
        expect(initial.events).toHaveLength(1);
        expect(initial.effects).toBe(1);
        expect(initial.events[0]).toMatchObject({
          kind: "request_new",
          recipient: owner,
          role: "cottage_owner",
          locale: "en",
          state: "delivered",
          payload: {
            bookingReference: null,
            kind: "request_new",
            fictional: true,
          },
        });
        harness.runSql(
          `set role service_role; select public.claim_booking_request_action('${action === "withdraw" ? customer : owner}','${request}','${action}',${action === "decline" ? "'cottage_unavailable'" : "null"}); reset role; update public.booking_request_release_work set lease_expires_at=clock_timestamp()-interval '1 second' where booking_request_id='${request}';`,
        );
      }
      // Sources may commit alongside a notification drain; the next tick must
      // pick them up without losing or duplicating an effect.
      for (let tick = 0; tick < 2; tick++) {
        const result = await triggerScheduled(baseURL, "/__scheduled");
        expect(result.ok, await result.text()).toBe(true);
      }
      const delivered = observe();
      expect(delivered.status).toBe(expected);
      expect(delivered.receipts).toBe(0);
      const terminal = delivered.events.filter(
        (event) => event.kind === `request_${expected}`,
      );
      expect(terminal).toHaveLength(2);
      expect(terminal.map((e) => [e.role, e.recipient])).toEqual([
        ["cottage_owner", owner],
        ["customer", customer],
      ]);
      for (const event of terminal) {
        expect(event.state).toBe("delivered");
        expect(event.payload).toMatchObject({
          bookingReference: null,
          kind: `request_${expected}`,
          fictional: true,
        });
        expect(event.payload).not.toHaveProperty("allocation");
        expect(event.payload.body).not.toMatch(
          /refund|returned|paid|confirmed/i,
        );
      }
      expect(delivered.effects).toBe(action === "expire" ? 2 : 3);
      const repeated = await triggerScheduled(baseURL, "/__scheduled");
      expect(repeated.ok, await repeated.text()).toBe(true);
      expect(observe()).toEqual(delivered);
    } finally {
      harness.runSql(cleanup);
    }
  });
}
