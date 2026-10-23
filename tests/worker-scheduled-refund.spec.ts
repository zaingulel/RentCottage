import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { Miniflare, Response as NativeResponse } from "miniflare";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { ProviderOperationRequest } from "../src/payment/payment-contract";
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
    | "paymentLifecycle"
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

test("hosted fictional refund and settlement survive fresh Worker instances", async () => {
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  const identity = browserBookingFixtureIdentity("refund", "worker");
  const providerIdentity = {
    provider: "fictional-payments",
    environment: "hosted-demo-yvibcyqtyihpzpmomnzg",
    merchantId: "fictional-merchant",
    terminalId: "fictional-terminal",
  };
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
      contents: `import { createPaymentOperations } from "./src/booking-request/payment-operations";
        export default { async fetch(request, env) {
          const { action, input } = await request.json();
          const payment = createPaymentOperations(env);
          if (!payment) throw new Error("Hosted payment composition is unavailable");
          return Response.json(await payment.operations[action](input));
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
  const createWorker = () =>
    new Miniflare({
      host: "127.0.0.1",
      telemetry: { enabled: false },
      workers: [
        {
          config: {
            name: "hosted-payment-intent-fixture",
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
                    "Unexpected hosted payment fixture outbound request",
                  );
                const response = await fetch(
                  new URL(url.pathname + url.search, localOrigin),
                  {
                    method: request.method,
                    headers: Object.fromEntries(request.headers),
                    body: await request.arrayBuffer(),
                    redirect: "error",
                  },
                );
                return new NativeResponse(await response.arrayBuffer(), {
                  status: response.status,
                  headers: Object.fromEntries(response.headers),
                });
              },
            },
          },
        },
      ],
    });
  const invoke = async (worker: Miniflare, action: string, input: unknown) => {
    const response = await worker.dispatchFetch(
      "https://payment-fixture.test/",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, input }),
      },
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  const cleanup =
    refundReset({ stem: identity.stem }) +
    confirmedBookingCleanup({
      stem: identity.stem,
      administrator: identity.administrator,
      completion: true,
      settlement: true,
    });
  for (const kind of ["refund", "settlement"] as const) {
    let first: Miniflare | undefined;
    let second: Miniflare | undefined;
    try {
      harness.runSql(cleanup);
      const amountFils = kind === "refund" ? 115000000 : 105000000;
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            provider: providerIdentity,
            kind: "capture",
            paymentLifecycleId: identity.paymentLifecycle,
            logicalOperationId: `${identity.paymentLifecycle}:capture`,
            attemptId: `${identity.paymentLifecycle}:capture:attempt-2`,
            amountFils,
            currency: "IQD",
          }),
          "utf8",
        )
        .digest("hex");
      expect(fingerprint).toBe(
        kind === "refund"
          ? "9259651ab9136451be5f587e15b6e0023a74f730d66a8e0d393a4858c140456b"
          : "8fee500515606b72254e60fbbbbc44508458735a9b420de9a6466dc21e2b703b",
      );
      const oldFingerprint =
        kind === "refund"
          ? "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d"
          : "28d4ab70479df702acf9bb25ad91c2ddcd118bd75507dde1c874e0b015b7ac84";
      const fixture = bookingFixtureSource(
        readFileSync(
          `supabase/tests/database/booking_${kind}.test.sql`,
          "utf8",
        ),
        {
          end:
            kind === "refund"
              ? "-- END CANCELLATION FIXTURE"
              : "-- END COMPLETION FIXTURE",
          required: [
            "00000000100",
            "964750000100",
            "RC-REQ-0000000000001001",
            "confirmation-auth-",
            "CONFIRMATION-HOLD-1",
            "Confirmation Cottage",
            "10000000-0000-4000-8000-000000003801",
            "cancellation-admin@example.test",
            "local-test",
            oldFingerprint,
          ],
        },
      )
        .replaceAll("00000000100", `00000000${identity.stem}`)
        .replaceAll("964750000100", `964750000${identity.stem}`)
        .replaceAll("confirmation-auth-", `confirmation-auth-${identity.stem}-`)
        .replaceAll("CONFIRMATION-HOLD-1", `HOSTED-${kind}-${identity.stem}`)
        .replaceAll(
          "Confirmation Cottage",
          `hosted ${kind} ${identity.stem} Cottage`,
        )
        .replaceAll(
          "10000000-0000-4000-8000-000000003801",
          identity.administrator,
        )
        .replaceAll(
          "cancellation-admin@example.test",
          `hosted-${kind}-${identity.stem}@example.test`,
        )
        .replaceAll("local-test", providerIdentity.environment)
        .replaceAll(oldFingerprint, fingerprint);
      const actor = `set local role authenticated;
        select set_config('request.jwt.claim.sub','${identity.administrator}',true);
        select set_config('request.jwt.claims','{"sub":"${identity.administrator}","role":"authenticated","aal":"aal2"}',true);`;
      const arrangement =
        kind === "refund"
          ? `select pg_temp.seed_cancellation_booking('2101-01-01','${providerIdentity.environment}');
          ${actor}
          create temp table hosted_intent as select public.request_booking_refund_exception(
            '${identity.request}','90000000-0000-4000-8000-00000000${identity.stem}9','Hosted compensation',
            '{"bookingPriceFils":30000000,"bookingServiceFeeFils":1000000}') result;`
          : `select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-3,true,'${providerIdentity.environment}');
          set local role service_role;
          select public.commit_booking_completion('${identity.request}',
            (select value->>'revision' from public.list_due_booking_completions(50) value where value->>'bookingRequestId'='${identity.request}'));
          ${actor}
          create temp table hosted_intent as select public.request_booking_settlement(
            '${identity.request}','90000000-0000-4000-8000-00000000${identity.stem}9','Hosted settlement',
            public.get_booking_settlement_facts('${identity.request}')->>'revision',90000000) result;`;
      const claim = JSON.parse(
        harness
          .runSql(
            `${fixture} ${arrangement}
          grant select on hosted_intent to service_role;
          set local role service_role;
          select public.claim_booking_${kind}((result->>'intentId')::uuid) from hosted_intent;
          commit;`,
          )
          .split("\n")
          .filter(Boolean)
          .at(-1)!,
      ) as { status: string; request: ProviderOperationRequest };
      expect(claim.status).toBe("execute");
      const request = claim.request;
      expect(request).toMatchObject({
        kind,
        amountFils: kind === "refund" ? 31000000 : 90000000,
      });
      expect(request.executionPermit).toMatchObject({
        binding: { providerIdentity },
      });
      const observe = () =>
        JSON.parse(
          harness.runSql(`select jsonb_build_object(
        'capture',(select to_jsonb(operation) from public.payment_provider_operations operation where operation.payment_lifecycle_id='${identity.paymentLifecycle}' and operation.operation_kind='capture'),
        'operations',(select coalesce(jsonb_agg(to_jsonb(operation) order by operation.id),'[]'::jsonb) from public.payment_provider_operations operation where operation.payment_lifecycle_id='${identity.paymentLifecycle}' and operation.operation_kind='${kind}'),
        'effects',(select coalesce(jsonb_agg(to_jsonb(effect) order by effect.operation_id),'[]'::jsonb) from public.simulated_payment_effects effect join public.payment_provider_operations operation on operation.id=effect.operation_id where operation.payment_lifecycle_id='${identity.paymentLifecycle}' and operation.operation_kind='${kind}'),
        'observations',(select coalesce(jsonb_agg(to_jsonb(observation) order by observation.id),'[]'::jsonb) from public.payment_provider_observations observation join public.payment_provider_operations operation on operation.id=observation.operation_id where operation.payment_lifecycle_id='${identity.paymentLifecycle}' and operation.operation_kind='${kind}'),
        'history',(select coalesce(jsonb_agg(to_jsonb(history) order by history.sequence),'[]'::jsonb) from public.booking_request_payment_history history where history.booking_request_id='${identity.request}' and history.operation_kind='${kind}' and history.outcome='succeeded'),
        'receipts',(select jsonb_agg(to_jsonb(receipt) order by receipt.id) from public.booking_receipts receipt join public.booking_confirmations confirmation on confirmation.id=receipt.booking_confirmation_id where confirmation.booking_request_id='${identity.request}'),
        'settlementReceipts',(select coalesce(jsonb_agg(to_jsonb(receipt) order by receipt.operation_id),'[]'::jsonb) from public.booking_settlement_receipts receipt join public.payment_provider_operations operation on operation.id=receipt.operation_id where operation.payment_lifecycle_id='${identity.paymentLifecycle}')
      );`),
        );
      const before = observe();
      expect(before.capture).toMatchObject({
        environment: providerIdentity.environment,
        request_fingerprint: fingerprint,
        amount_fils: amountFils,
      });
      expect(before.operations).toHaveLength(0);
      first = createWorker();
      const executed = await invoke(first, "execute", request);
      expect(executed).toMatchObject({
        status: "recorded",
        result: { outcome: "succeeded" },
      });
      const duplicateResults = await Promise.all([
        invoke(first, "execute", request),
        invoke(first, "execute", request),
      ]);
      const stored = observe();
      expect(stored.operations).toHaveLength(1);
      expect(stored.effects).toHaveLength(1);
      const operation = stored.operations[0];
      const effect = stored.effects[0];
      expect(operation).toMatchObject({
        provider: providerIdentity.provider,
        environment: providerIdentity.environment,
        merchant_id: providerIdentity.merchantId,
        terminal_id: providerIdentity.terminalId,
        payment_lifecycle_id: identity.paymentLifecycle,
        operation_kind: kind,
        amount_fils: kind === "refund" ? 31000000 : 90000000,
        current_outcome: "succeeded",
        evidence_provenance: "fictional-provider",
        admission: { permit: request.executionPermit },
      });
      expect(effect).toMatchObject({
        operation_id: operation.id,
        provider: providerIdentity.provider,
        environment: providerIdentity.environment,
        merchant_id: providerIdentity.merchantId,
        terminal_id: providerIdentity.terminalId,
        state: "executed",
        physical_execution_count: 1,
        result: {
          outcome: "succeeded",
          providerRequestId: operation.provider_request_id,
          providerReference: operation.provider_reference,
          movementReference: operation.movement_reference,
          evidence: {
            operationId: operation.id,
            provenance: "fictional-provider",
            originalOutcome: "succeeded",
            closedAt: null,
          },
        },
        binding: {
          operationId: operation.id,
          providerIdentity,
          idempotencyKey: operation.provider_idempotency_key,
          requestFingerprint: operation.request_fingerprint,
          notBefore: operation.admission.notBefore,
          notAfter: operation.admission.notAfter,
        },
      });
      expect(operation.id).not.toBe(stored.capture.id);
      expect(stored.observations).toHaveLength(1);
      expect(effect.result).toEqual(stored.observations[0].result);
      expect(executed).toEqual({ status: "recorded", result: effect.result });
      expect(stored.history).toHaveLength(1);
      expect(stored.capture).toEqual(before.capture);
      expect(stored.receipts).toEqual(before.receipts);
      expect(stored.receipts).toHaveLength(2);
      expect(Date.parse(operation.executed_at)).toBe(
        Date.parse(effect.result.evidence.executedAt),
      );
      expect(operation.recorded_at).toBeTruthy();
      expect(stored.settlementReceipts).toHaveLength(
        kind === "settlement" ? 1 : 0,
      );
      if (kind === "settlement")
        expect(stored.settlementReceipts[0]).toMatchObject({
          operation_id: operation.id,
          observation_id: stored.observations[0].id,
          history_sequence: stored.history[0].sequence,
          active_hold_ids: [],
          active_dispute_ids: [],
        });
      await first.dispose();
      first = undefined;
      second = createWorker();
      const { executionPermit, ...binding } = request;
      const queried = await invoke(second, "query", {
        ...binding,
        providerRequestId: operation.provider_request_id,
        providerReference: operation.provider_reference,
        ...(kind === "refund"
          ? { refundPermit: executionPermit }
          : { settlementPermit: executionPermit }),
      });
      expect(
        queried,
        `${kind} fresh Worker inquiry preserves the hosted scope`,
      ).toEqual(executed);
      for (const result of duplicateResults) expect(result).toEqual(executed);
      expect(await invoke(second, "execute", request)).toEqual(executed);
      expect(observe()).toEqual(stored);
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
  }
});
