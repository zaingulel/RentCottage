import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { Miniflare, Response as NativeResponse } from "miniflare";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { triggerScheduled } from "./fixtures/trigger-scheduled";
import type {
  NotificationEffect,
  NotificationLease,
} from "../src/notification/notification-delivery";
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
test("hosted fictional notification replay retains one final effect", async () => {
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  const testInfo = test.info();
  const { request, owner, baselineFixture, cleanup } =
    browserBookingRequestNotificationFixture(testInfo.project.name);
  const scope = "hosted-demo-yvibcyqtyihpzpmomnzg";
  const localOrigin = new URL(process.env.SUPABASE_URL!);
  expect(localOrigin.protocol).toBe("http:");
  expect(localOrigin.hostname).toBe("127.0.0.1");
  const bindings = {
    APP_ENVIRONMENT: "preview",
    HOSTED_DEMO: "true",
    SUPABASE_PROJECT_REF: "yvibcyqtyihpzpmomnzg",
    SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY!,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY!,
    PRIVILEGED_AUDIT_HMAC_KEY: process.env.PRIVILEGED_AUDIT_HMAC_KEY!,
    DEPLOYMENT_COMMIT: "a".repeat(40),
  };
  const bundled = await build({
    stdin: {
      contents: `import { createClient } from "@supabase/supabase-js";
        import { fictionalSupplierEnvironment } from "./src/booking-request/fictional-supplier-environment-core";
        import { SupabaseNotificationDeliveryRepository } from "./src/notification/supabase-notification-delivery";
        import { FictionalNotificationAdapter } from "./src/notification/fictional-notification-adapter";
        import { bookingRequestNotice } from "./src/notification/booking-request-notice";
        export default { async fetch(request, env) {
          try {
            if (request.method !== "POST") throw new Error("Notification fixture requires POST");
            const { action, input } = await request.json();
            const scope = fictionalSupplierEnvironment(env);
            if (scope !== "hosted-demo-yvibcyqtyihpzpmomnzg") throw new Error("Hosted notification scope is unavailable");
            const client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY,
              { auth: { autoRefreshToken: false, persistSession: false } });
            const repository = new SupabaseNotificationDeliveryRepository(client, scope);
            const adapter = new FictionalNotificationAdapter(repository, env);
            let result;
            switch (action) {
              case "prepare": {
                const candidates = (await repository.listCandidates(50)).filter(candidate =>
                  candidate.receiptId === null && candidate.event.id === input.eventId &&
                  candidate.bookingRequestReference === input.requestReference &&
                  candidate.recipientUserId === input.owner && candidate.recipientRole === "cottage_owner" &&
                  candidate.event.kind === "request_new");
                if (candidates.length !== 1) throw new Error("Expected exactly one owned request notification candidate");
                const candidate = candidates[0];
                await repository.prepare({ ...candidate, logicalId: "booking-event:" + candidate.event.id,
                  templateVersion: "booking-event-v1", payload: bookingRequestNotice(candidate) });
                result = await repository.lease(null, candidate.event.id);
                if (!result) throw new Error("Owned notification lease is unavailable");
                break;
              }
              case "query": result = await adapter.query(input); break;
              case "execute": result = await adapter.execute(input); break;
              case "complete": result = await repository.completeDelivered(input.lease, input.effect); break;
              case "query-local": result = await new SupabaseNotificationDeliveryRepository(client, "local-test").queryEffect(input); break;
              case "execute-local": result = await new SupabaseNotificationDeliveryRepository(client, "local-test").executeEffect(input); break;
              case "complete-local": result = await new SupabaseNotificationDeliveryRepository(client, "local-test").completeDelivered(input.lease, input.effect); break;
              default: throw new Error("Unknown notification fixture action");
            }
            return Response.json(result);
          } catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : "Notification fixture failed" }, { status: 500 });
          }
        } };`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    external: ["node:*", "cloudflare:*"],
  });
  const wrangler = JSON.parse(
    readFileSync("wrangler.jsonc", "utf8").replace(/,\s*([}\]])/g, "$1"),
  );
  const queryPath =
    "/rest/v1/rpc/query_fictional_booking_confirmation_notification_effect";
  let unavailableInquiry = false;
  const unavailablePaths: string[] = [];
  const createWorker = () =>
    new Miniflare({
      host: "127.0.0.1",
      telemetry: { enabled: false },
      workers: [
        {
          config: {
            name: "hosted-request-notification-fixture",
            compatibilityDate: wrangler.compatibility_date,
            compatibilityFlags: wrangler.compatibility_flags,
            manifest: {
              mainModule: "worker.js",
              modules: {
                "worker.js": {
                  type: "esm",
                  contents: bundled.outputFiles[0].text,
                },
              },
            },
            env: Object.fromEntries(
              Object.entries(bindings).map(([name, value]) => [
                name,
                { type: "text" as const, value },
              ]),
            ),
          },
          dev: {
            outboundService: {
              type: "fetcher",
              async handler(request) {
                const url = new URL(request.url);
                if (
                  url.origin !== "https://yvibcyqtyihpzpmomnzg.supabase.co" ||
                  !url.pathname.startsWith("/rest/v1/rpc/")
                )
                  throw new Error(
                    "Unexpected hosted notification fixture outbound request",
                  );
                if (unavailableInquiry) {
                  unavailablePaths.push(url.pathname);
                  if (url.pathname === queryPath)
                    return NativeResponse.json(
                      {
                        message: "Controlled notification inquiry unavailable",
                      },
                      { status: 503 },
                    );
                  throw new Error(
                    "Unexpected RPC during unavailable notification inquiry",
                  );
                }
                const response = await fetch(
                  new URL(url.pathname + url.search, localOrigin),
                  {
                    method: request.method,
                    headers: Object.fromEntries(request.headers),
                    body: await request.arrayBuffer(),
                    redirect: "error",
                  },
                );
                return new NativeResponse(
                  response.body === null
                    ? null
                    : await response.arrayBuffer(),
                  {
                    status: response.status,
                    headers: Object.fromEntries(response.headers),
                  },
                );
              },
            },
          },
        },
      ],
    });
  type Action =
    | "prepare"
    | "query"
    | "execute"
    | "complete"
    | "query-local"
    | "execute-local"
    | "complete-local";
  const invoke = (worker: Miniflare, action: Action, input: unknown) =>
    worker.dispatchFetch("https://notification-fixture.test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, input }),
    });
  const result = async (worker: Miniflare, action: Action, input: unknown) => {
    const response = await invoke(worker, action, input);
    const errorBody = response.status === 200 ? "" : await response.text();
    expect(response.status, `${action}: ${errorBody}`).toBe(200);
    return response.json();
  };
  const observe = () =>
    JSON.parse(
      harness.runSql(`select jsonb_build_object(
    'work',(select coalesce(jsonb_agg(to_jsonb(work) order by work.notification_id),'[]'::jsonb) from public.booking_confirmation_notification_work work where work.booking_request_id='${request}'),
    'effects',(select coalesce(jsonb_agg(to_jsonb(effect) order by effect.id),'[]'::jsonb) from public.fictional_booking_confirmation_notification_effects effect where effect.booking_request_id='${request}'),
    'attempts',(select coalesce(jsonb_agg(to_jsonb(attempt) order by attempt.id),'[]'::jsonb) from public.booking_confirmation_notification_attempts attempt join public.booking_notification_events event on event.id=attempt.event_id where event.booking_request_id='${request}'),
    'requestStatus',(select status from public.booking_requests where id='${request}'),
    'paidReceipts',(select count(*) from public.booking_receipts receipt join public.booking_confirmations confirmation on confirmation.id=receipt.booking_confirmation_id where confirmation.booking_request_id='${request}')
  );`),
    );
  let first: Miniflare | undefined;
  let second: Miniflare | undefined;
  try {
    harness.runSql(cleanup);
    harness.runSql(`${baselineFixture} commit;`);
    const source = JSON.parse(
      harness.runSql(`select jsonb_build_object(
      'reference',request.booking_request_reference,
      'events',(select jsonb_agg(to_jsonb(event) order by event.id) from public.booking_notification_events event
        where event.booking_request_id=request.id and event.event_kind='request_new' and event.recipient_user_id='${owner}')
      ) from public.booking_requests request where request.id='${request}';`),
    );
    expect(source.events).toHaveLength(1);
    const event = source.events[0];
    expect(event).toMatchObject({
      receipt_id: null,
      recipient_user_id: owner,
      recipient_role: "cottage_owner",
      notice_locale: "en",
      event_kind: "request_new",
    });
    expect(event.owner_request_notification_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.deadline_at).toEqual(expect.any(String));
    first = createWorker();
    const lease = (await result(first, "prepare", {
      eventId: event.id,
      requestReference: source.reference,
      owner,
    })) as NotificationLease;
    expect(lease).toMatchObject({
      receiptId: null,
      bookingReference: null,
      recipientUserId: owner,
      recipientRole: "cottage_owner",
      bookingRequestReference: source.reference,
      locale: "en",
      logicalId: `booking-event:${event.id}`,
      templateVersion: "booking-event-v1",
      event: {
        id: event.id,
        kind: "request_new",
        sourceId: event.owner_request_notification_id,
        deadlineAt: event.deadline_at,
      },
      payload: {
        kind: "request_new",
        fictional: true,
        title: "New Booking Request",
        linkLabel: "View Booking Request",
        bookingReference: null,
        bookingRequestReference: source.reference,
        deadlineAt: event.deadline_at,
        detailsPath: `/en/owner/booking-requests/${source.reference}`,
      },
    });
    expect(lease.payload.body).toMatch(
      /^Open your authenticated Booking Request for its current status\./,
    );
    const effect = (await result(
      first,
      "execute",
      lease,
    )) as NotificationEffect & { status: string };
    expect(effect.status).toBe("delivered");
    expect(effect.effectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(effect.supplierDeliveryReference).toBe(
      `fictional-booking-event-${event.id}`,
    );
    expect(Number.isFinite(Date.parse(effect.executedAt))).toBe(true);
    const stored = observe();
    expect(stored.work).toHaveLength(1);
    expect(stored.effects).toHaveLength(1);
    expect(stored.attempts).toHaveLength(1);
    expect(stored.work[0]).toMatchObject({
      event_id: event.id,
      receipt_id: null,
      state: "processing",
      lease_generation: lease.leaseGeneration,
      lease_token: lease.leaseToken,
      lease_expires_at: lease.leaseExpiresAt,
      payload: lease.payload,
      payload_sha256: lease.payloadSha256,
      delivered_at: null,
      supplier_delivery_reference: null,
    });
    expect(
      harness.runSql(
        `select lease_expires_at>clock_timestamp() from public.booking_confirmation_notification_work where event_id='${event.id}';`,
      ),
    ).toBe("t");
    const originalEffect = stored.effects[0];
    expect(originalEffect).toMatchObject({
      id: effect.effectId,
      supplier: "fictional-notifications",
      environment: scope,
      event_id: event.id,
      receipt_id: null,
      notification_id: event.id,
      booking_request_id: request,
      booking_request_reference: source.reference,
      booking_reference: null,
      recipient_user_id: owner,
      recipient_role: "cottage_owner",
      notice_locale: "en",
      logical_id: `booking-event:${event.id}`,
      template_version: "booking-event-v1",
      payload: lease.payload,
      payload_sha256: lease.payloadSha256,
      execution_lease_generation: lease.leaseGeneration,
      execution_lease_token: lease.leaseToken,
      supplier_delivery_reference: effect.supplierDeliveryReference,
      executed_at: effect.executedAt,
    });
    expect(stored.attempts[0]).toMatchObject({
      event_id: event.id,
      receipt_id: null,
      action: "execute",
      outcome: "delivered",
      effect_id: effect.effectId,
      lease_generation: lease.leaseGeneration,
      lease_token: lease.leaseToken,
    });
    expect(stored.requestStatus).toBe("pending");
    expect(stored.paidReceipts).toBe(0);
    expect(
      harness.runSql(
        `select bool_and(payload_sha256=encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')) from public.fictional_booking_confirmation_notification_effects where booking_request_id='${request}';`,
      ),
    ).toBe("t");
    await first.dispose();
    first = undefined;
    second = createWorker();
    for (const action of [
      "query-local",
      "execute-local",
      "complete-local",
    ] as const) {
      expect(
        await result(
          second,
          action,
          action === "complete-local" ? { lease, effect } : lease,
        ),
      ).toEqual({ status: "stale" });
      expect(observe()).toEqual(stored);
    }
    for (const hostileLease of [
      { ...lease, leaseGeneration: lease.leaseGeneration + 1 },
      { ...lease, payload: { ...lease.payload, fictional: false } },
    ]) {
      for (const action of ["query", "execute", "complete"] as const) {
        expect(
          await result(
            second,
            action,
            action === "complete"
              ? { lease: hostileLease, effect }
              : hostileLease,
          ),
        ).toEqual({ status: "stale" });
        expect(observe()).toEqual(stored);
      }
    }
    unavailableInquiry = true;
    try {
      const unavailable = await invoke(second, "query", lease);
      expect(unavailable.ok).toBe(false);
      expect(await unavailable.json()).toEqual({
        error: "Notification effect query is unavailable",
      });
    } finally {
      unavailableInquiry = false;
    }
    expect(unavailablePaths.length).toBeGreaterThan(0);
    expect(new Set(unavailablePaths)).toEqual(new Set([queryPath]));
    expect(observe()).toEqual(stored);
    const queried = await result(second, "query", lease);
    expect(
      queried,
      "fresh Worker inquiry retains the hosted notification scope",
    ).toEqual({
      status: "found",
      effectId: effect.effectId,
      supplierDeliveryReference: effect.supplierDeliveryReference,
      executedAt: effect.executedAt,
    });
    const afterQuery = observe();
    expect(afterQuery.work).toEqual(stored.work);
    expect(afterQuery.effects).toEqual(stored.effects);
    expect(afterQuery.attempts).toHaveLength(2);
    expect(afterQuery.attempts).toEqual(
      expect.arrayContaining(stored.attempts),
    );
    expect(
      afterQuery.attempts.filter(
        (attempt: { action: string }) => attempt.action === "query",
      ),
    ).toEqual([
      expect.objectContaining({
        action: "query",
        outcome: "delivered",
        effect_id: effect.effectId,
        lease_generation: lease.leaseGeneration,
        lease_token: lease.leaseToken,
      }),
    ]);
    expect(await result(second, "execute", lease)).toEqual(effect);
    expect(observe()).toEqual(afterQuery);
    expect(
      await result(second, "complete", { lease, effect: queried }),
    ).toEqual({ status: "delivered", historical: false });
    const completed = observe();
    expect(completed.effects).toEqual(stored.effects);
    expect(completed.work).toEqual([
      {
        ...stored.work[0],
        state: "delivered",
        delivered_at: originalEffect.executed_at,
        supplier_delivery_reference: originalEffect.supplier_delivery_reference,
        lease_token: null,
        lease_expires_at: null,
        last_outcome: "delivered",
        updated_at: expect.any(String),
      },
    ]);
    expect(completed.attempts).toHaveLength(3);
    expect(completed.attempts).toEqual(
      expect.arrayContaining(afterQuery.attempts),
    );
    expect(
      completed.attempts.filter(
        (attempt: { action: string }) => attempt.action === "complete",
      ),
    ).toEqual([
      expect.objectContaining({
        action: "complete",
        outcome: "delivered",
        effect_id: effect.effectId,
        lease_generation: lease.leaseGeneration,
        lease_token: lease.leaseToken,
      }),
    ]);
    expect(completed.requestStatus).toBe("pending");
    expect(completed.paidReceipts).toBe(0);
    expect(
      await result(second, "complete", { lease, effect: queried }),
    ).toEqual({ status: "stale" });
    expect(observe()).toEqual(completed);
  } finally {
    try {
      await first?.dispose();
    } finally {
      try {
        await second?.dispose();
      } finally {
        harness.runSql(cleanup);
      }
    }
  }
});
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
        expect(evidence.hold.state).toBe("released_hold");
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
