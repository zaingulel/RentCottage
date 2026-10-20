import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { triggerScheduled } from "./fixtures/trigger-scheduled";
const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
  };
};
const { browserBookingRequestNotificationFixture } = createRequire(
  import.meta.url,
)("../scripts/booking-request-notification-fixture.mjs") as {
  browserBookingRequestNotificationFixture(project: string): {
    request: string;
    owner: string;
    customer: string;
    baselineFixture: string;
    cleanup: string;
  };
};
test.describe.configure({ mode: "serial" });
for (const [action, expected] of [
  ["decline", "declined"],
  ["withdraw", "withdrawn"],
  ["expire", "expired"],
  ["suspend", "declined"],
] as const) {
  test(`scheduled Worker delivers new-request and ${expected} notices once from committed facts${action === "suspend" ? " after suspension" : ""}`, async ({
    baseURL,
  }, testInfo) => {
    const { request, owner, customer, baselineFixture, cleanup } =
      browserBookingRequestNotificationFixture(testInfo.project.name);
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
    let retainSuspensionGraph = false;
    let replaySuspension: (() => unknown) | undefined;
    const releaseEvidence = () =>
      JSON.parse(
        harness.runSql(`select jsonb_build_object(
      'work',(select to_jsonb(work) from public.booking_request_release_work work where booking_request_id='${request}'),
      'hold',(select jsonb_build_object('id',commitments.id,'state',commitments.status) from public.cottage_booking_period_commitments commitments join public.booking_requests requests on requests.booking_period_commitment_id=commitments.id where requests.id='${request}'),
      'operations',(select coalesce(jsonb_agg(to_jsonb(operations) order by operations.id),'[]') from public.payment_provider_operations operations join public.booking_requests requests on requests.payment_lifecycle_id=operations.payment_lifecycle_id where requests.id='${request}' and operations.operation_kind='release'),
      'effects',(select coalesce(jsonb_agg(to_jsonb(effects) order by effects.id),'[]') from public.fictional_booking_confirmation_notification_effects effects where booking_request_id='${request}'),
      'occupancies',(select jsonb_agg(to_jsonb(occupancies) order by occupancies.service_day,occupancies.shift_id) from public.cottage_booking_period_occupancies occupancies join public.booking_requests requests on requests.booking_period_commitment_id=occupancies.booking_period_commitment_id where requests.id='${request}')
    );`),
      );
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
        if (action === "suspend") {
          const privileged = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SECRET_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } },
          );
          const administrator = await privileged.auth.admin.createUser({
            email: `scheduled-suspension-${randomUUID()}@rentcottage.test`,
            password: "Local-test-password-2026",
            email_confirm: true,
          });
          expect(administrator.error).toBeNull();
          const actorId = administrator.data.user!.id;
          const provisioned = await privileged.rpc(
            "provision_platform_administrator",
            { target_user_id: actorId },
          );
          expect(provisioned.error).toBeNull();
          const commandId = randomUUID();
          replaySuspension = () =>
            JSON.parse(
              harness.runSql(`begin; set local role authenticated;
            set local request.jwt.claims='{"sub":"${actorId}","role":"authenticated","aal":"aal2"}';
            select public.set_marketplace_suspension('customer','${customer}','suspend',0,'Fictional scheduled suspension','${commandId}'); commit;`),
            );
          const restricted = replaySuspension() as {
            status: string;
            actionId: string;
          };
          if (restricted.status === "completed") retainSuspensionGraph = true;
          expect(restricted.status).toBe("completed");
          const pending = releaseEvidence();
          expect(pending.work).toMatchObject({
            booking_request_id: request,
            state: "processing",
            suspension_action_id: restricted.actionId,
            outcome: "declined",
          });
          expect(pending.hold.state).toBe("pending_hold");
          expect(pending.operations).toEqual([]);
          expect(
            pending.occupancies.every((row: { active: boolean }) => row.active),
          ).toBe(true);
          expect(replaySuspension()).toMatchObject({
            status: "completed",
            actionId: restricted.actionId,
          });
          expect(releaseEvidence()).toEqual(pending);
        } else
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
      if (action === "suspend") {
        const evidence = releaseEvidence();
        expect(evidence.work).toMatchObject({
          booking_request_id: request,
          state: "complete",
          outcome: "declined",
        });
        expect(evidence.work.suspension_action_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(evidence.hold.state).toBe("released");
        expect(
          evidence.occupancies.every((row: { active: boolean }) => !row.active),
        ).toBe(true);
        expect(evidence.operations).toHaveLength(1);
        expect(evidence.operations[0]).toMatchObject({
          provider: "fictional-payments",
          environment: "local-test",
          operation_kind: "release",
          current_outcome: "succeeded",
        });
        expect(evidence.operations[0].movement_reference).toEqual(
          expect.any(String),
        );
        for (const effect of evidence.effects)
          expect(effect).toMatchObject({
            supplier: "fictional-notifications",
            environment: "local-test",
          });
        expect(replaySuspension!()).toMatchObject({
          status: "completed",
          actionId: evidence.work.suspension_action_id,
        });
        expect(releaseEvidence()).toEqual(evidence);
        const suspensionRetainedScheduledGraphPath = testInfo.outputPath(
          "suspension-retained-scheduled-graph.json",
        );
        await writeFile(
          suspensionRetainedScheduledGraphPath,
          JSON.stringify({ request, owner, customer, evidence }),
        );
        await testInfo.attach("suspension-retained-scheduled-graph", {
          path: suspensionRetainedScheduledGraphPath,
          contentType: "application/json",
        });
      }
    } finally {
      // The final suspension case keeps its immutable audit-linked graph until project disposal.
      if (!retainSuspensionGraph) harness.runSql(cleanup);
    }
  });
}
