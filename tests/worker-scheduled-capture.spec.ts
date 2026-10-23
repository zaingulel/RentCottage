import { triggerScheduled } from "./fixtures/trigger-scheduled";

// SQL arrangement mirrors admission, isolated effect, and explicit recording.
const paymentEvidenceSql =
  "-- BEGIN PAYMENT EVIDENCE FIXTURE\n" +
  readFileSync("supabase/fixtures/payment-evidence.sql", "utf8") +
  "\n-- END PAYMENT EVIDENCE FIXTURE\n";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { Miniflare, Response as NativeResponse } from "miniflare";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type {
  BookingRequestCaptureExecutionPermit,
  ProviderOperationRequest,
} from "../src/payment/payment-contract";

type SqlSession = { stdout: string };

const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
    startSession(sql: string): SqlSession;
    waitForMarker(session: SqlSession, marker: string): Promise<void>;
    finishSession(
      session: SqlSession,
      options: { action: string },
    ): Promise<void>;
  };
};
const { captureCleanup, browserBookingFixtureIdentity, bookingFixtureSource } =
  createRequire(import.meta.url)("../scripts/lib/booking-fixture.mjs") as {
    browserBookingFixtureIdentity(
      file: string,
      project: string,
    ): Record<
      | "stem"
      | "owner"
      | "customer"
      | "request"
      | "reference"
      | "commitment"
      | "operation"
      | "paymentLifecycle",
      string
    >;
    bookingFixtureSource(
      source: string,
      options: { start?: string; end: string; required?: string[] },
    ): string;
    captureCleanup(options?: {
      stem?: string;
      paymentRecovery?: boolean;
      releaseOperations?: boolean;
      publishedCottage?: boolean;
    }): string;
  };

function pendingCaptureSeed(
  identity: ReturnType<typeof browserBookingFixtureIdentity>,
): string {
  const source = bookingFixtureSource(
    readFileSync(
      "supabase/tests/database/booking_request_confirmation.test.sql",
      "utf8",
    ),
    {
      start: "-- BEGIN CAPTURE RECOVERY SOURCE",
      end: "-- END CAPTURE RECOVERY SOURCE",
    },
  );
  return bookingFixtureSource(source, {
    end: "insert into public.booking_request_capture_work",
    required: [
      "00000000100",
      "964750000100",
      "RC-REQ-0000000000001001",
      "confirmation-auth-",
      "CONFIRMATION-HOLD-1",
      "Confirmation Cottage",
    ],
  })
    .replaceAll("00000000100", `00000000${identity.stem}`)
    .replaceAll("964750000100", `964750000${identity.stem}`)
    .replaceAll("confirmation-auth-", `confirmation-auth-${identity.stem}-`)
    .replaceAll("CONFIRMATION-HOLD-1", `CAPTURE-HOLD-${identity.stem}`)
    .replaceAll("Confirmation Cottage", `capture ${identity.stem} Cottage`);
}

test("hosted fictional payments survive fresh Worker instances", async () => {
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  const testInfo = test.info();
  const identity = browserBookingFixtureIdentity(
    "capture",
    testInfo.project.name,
  );
  const providerIdentity = {
    provider: "fictional-payments",
    environment: "hosted-demo-yvibcyqtyihpzpmomnzg",
    merchantId: "fictional-merchant",
    terminalId: "fictional-terminal",
  };
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        provider: providerIdentity,
        kind: "capture",
        paymentLifecycleId: identity.paymentLifecycle,
        logicalOperationId: `${identity.paymentLifecycle}:capture`,
        attemptId: `${identity.paymentLifecycle}:capture:attempt-2`,
        amountFils: 115000000,
        currency: "IQD",
      }),
      "utf8",
    )
    .digest("hex");
  expect(fingerprint).toBe(
    "f6d5f0d4cac345c4a6848a084f38328e735870447765dc06e7dd15f27aecc6cf",
  );
  const fixture = bookingFixtureSource(
    readFileSync(
      "supabase/tests/database/booking_request_confirmation.test.sql",
      "utf8",
    ),
    {
      start: "-- BEGIN CAPTURE RECOVERY SOURCE",
      end: "-- END CAPTURE RECOVERY SOURCE",
      required: [
        "00000000100",
        "964750000100",
        "RC-REQ-0000000000001001",
        "confirmation-auth-",
        "CONFIRMATION-HOLD-1",
        "Confirmation Cottage",
        "insert into public.booking_request_capture_work",
        "local-test",
        "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
      ],
    },
  )
    .replaceAll("RC-REQ-0000000000001001", identity.reference)
    .replaceAll("00000000100", `00000000${identity.stem}`)
    .replaceAll("964750000100", `964750000${identity.stem}`)
    .replaceAll("confirmation-auth-", `confirmation-auth-${identity.stem}-`)
    .replaceAll("CONFIRMATION-HOLD-1", `HOSTED-CAPTURE-${identity.stem}`)
    .replaceAll(
      "Confirmation Cottage",
      `hosted capture ${identity.stem} Cottage`,
    )
    .replaceAll("local-test", providerIdentity.environment)
    .replaceAll(
      "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
      fingerprint,
    );
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
            name: "hosted-payment-capture-fixture",
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
  const cleanup = captureCleanup({
    stem: identity.stem,
    paymentRecovery: true,
  });
  const observe = () =>
    JSON.parse(
      harness.runSql(`select jsonb_build_object(
    'operations',(select coalesce(jsonb_agg(to_jsonb(operation) order by operation.id),'[]'::jsonb) from public.payment_provider_operations operation where operation.payment_lifecycle_id='${identity.paymentLifecycle}' and operation.operation_kind='capture'),
    'effects',(select coalesce(jsonb_agg(to_jsonb(effect) order by effect.operation_id),'[]'::jsonb) from public.simulated_payment_effects effect join public.payment_provider_operations operation on operation.id=effect.operation_id where operation.payment_lifecycle_id='${identity.paymentLifecycle}' and operation.operation_kind='capture'),
    'observations',(select coalesce(jsonb_agg(to_jsonb(observation) order by observation.id),'[]'::jsonb) from public.payment_provider_observations observation join public.payment_provider_operations operation on operation.id=observation.operation_id where operation.payment_lifecycle_id='${identity.paymentLifecycle}' and operation.operation_kind='capture')
  );`),
    );
  let first: Miniflare | undefined;
  let second: Miniflare | undefined;
  try {
    harness.runSql(cleanup);
    harness.runSql(`begin; ${fixture} commit;`);
    first = createWorker();
    await first.ready;
    const leased = JSON.parse(
      harness.runSql(`begin; set local role service_role;
      select public.lease_booking_request_capture_work('${identity.request}','${JSON.stringify(providerIdentity)}'::jsonb); commit;`),
    ) as {
      status: string;
      permit: BookingRequestCaptureExecutionPermit;
    };
    expect(leased.status).toBe("leased");
    const permit = leased.permit;
    const request: ProviderOperationRequest = {
      kind: "capture",
      paymentLifecycleId: permit.paymentLifecycleId,
      logicalOperationId: permit.captureLogicalOperationId,
      attemptId: permit.capturePhysicalAttemptId,
      amountFils: permit.amountFils,
      currency: permit.currency,
      executionPermit: permit,
    };
    const executed = await invoke(first, "execute", request);
    expect(executed).toMatchObject({
      status: "recorded",
      result: { outcome: "succeeded" },
    });
    const stored = observe();
    expect(stored.operations).toHaveLength(1);
    expect(stored.effects).toHaveLength(1);
    expect(stored.observations).toHaveLength(1);
    const operation = stored.operations[0];
    const effect = stored.effects[0];
    expect(operation).toMatchObject({
      claim_id: "72000000-0000-4000-8000-000000008721",
      claim_generation: 1,
      provider: providerIdentity.provider,
      environment: providerIdentity.environment,
      merchant_id: providerIdentity.merchantId,
      terminal_id: providerIdentity.terminalId,
      payment_lifecycle_id: identity.paymentLifecycle,
      logical_operation_id: `${identity.paymentLifecycle}:capture`,
      physical_attempt_id: `${identity.paymentLifecycle}:capture:attempt-2`,
      operation_kind: "capture",
      amount_fils: 115000000,
      currency: "IQD",
      provider_idempotency_key:
        "booking-request-capture:60000000-0000-4000-8000-000000008721:1",
      request_fingerprint: fingerprint,
      current_outcome: "succeeded",
      evidence_provenance: "fictional-provider",
      capture_execution_permit: permit,
    });
    expect(effect).toMatchObject({
      operation_id: operation.id,
      provider: providerIdentity.provider,
      environment: providerIdentity.environment,
      merchant_id: providerIdentity.merchantId,
      terminal_id: providerIdentity.terminalId,
      state: "executed",
      physical_execution_count: 1,
      binding: {
        operationId: operation.id,
        providerIdentity,
        idempotencyKey: operation.provider_idempotency_key,
        requestFingerprint: fingerprint,
        notBefore: operation.admission.notBefore,
        notAfter: operation.admission.notAfter,
      },
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
    });
    expect(effect.result).toEqual(stored.observations[0].result);
    expect(executed).toEqual({ status: "recorded", result: effect.result });
    expect(Date.parse(operation.executed_at)).toBe(
      Date.parse(effect.result.evidence.executedAt),
    );
    expect(operation.recorded_at).toBeTruthy();
    await first.dispose();
    first = undefined;
    second = createWorker();
    const { executionPermit, ...binding } = request;
    // A fresh inquiry receives no admission or capture permit from Worker 1.
    const queried = await invoke(second, "query", {
      ...binding,
      providerRequestId: operation.provider_request_id,
      providerReference: operation.provider_reference,
    });
    expect(
      queried,
      "fresh Worker inquiry preserves the hosted capture scope",
    ).toEqual(executed);
    const replays = await Promise.all([
      invoke(second, "execute", { ...binding, executionPermit }),
      invoke(second, "execute", { ...binding, executionPermit }),
    ]);
    for (const replay of replays) expect(replay).toEqual(executed);
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
});

test("the actual Worker settles overlapping capture despite expiry failure and repeated scheduling preserves one paid booking", async ({
  baseURL,
}, testInfo) => {
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  const identity = browserBookingFixtureIdentity(
    "capture",
    testInfo.project.name,
  );
  const id = identity.request;
  const pending = pendingCaptureSeed(identity);
  const expiryDefinition = harness.runSql(
    paymentEvidenceSql +
      "select pg_get_functiondef('public.claim_due_booking_request_releases(integer)'::regprocedure);",
  );
  const observe = () =>
    JSON.parse(
      harness.runSql(
        paymentEvidenceSql +
          `select jsonb_build_object(
    'work', (select to_jsonb(work) from public.booking_request_capture_work work where booking_request_id = '${id}'),
    'execution', (select pg_temp.payment_fixture_operation_json(operation) from public.payment_provider_operations operation where payment_lifecycle_id = '${identity.paymentLifecycle}' and operation_kind = 'capture'),
    'confirmation', (select to_jsonb(confirmation) from public.booking_confirmations confirmation where booking_request_id = '${id}'),
    'receipts', (select jsonb_agg(to_jsonb(receipt) order by receipt.id) from public.booking_receipts receipt join public.booking_confirmations confirmation on confirmation.id = receipt.booking_confirmation_id where confirmation.booking_request_id = '${id}'),
    'occupancies', (select jsonb_agg(to_jsonb(occupancy) order by shift_id, service_day) from public.cottage_booking_period_occupancies occupancy where booking_period_commitment_id = '${identity.commitment}'),
    'commitment', (select to_jsonb(commitment) from public.cottage_booking_period_commitments commitment where id = '${identity.commitment}')
  );`,
      ),
    );
  let seeded = false;
  let holder: SqlSession | undefined;
  const scheduled: Promise<PromiseSettledResult<Response>>[] = [];
  try {
    harness.runSql(
      paymentEvidenceSql +
        `begin; ${pending}
      update public.booking_requests set status = 'pending', settled_at = null where id = '${id}';
      set local role service_role;
      select public.claim_booking_request_action('${identity.owner}', '${id}', 'accept'); commit;`,
    );
    seeded = true;
    const before = observe();
    expect(before.work.state).toBe("queued");
    expect(before.execution).toBeNull();
    expect(before.confirmation).toBeNull();
    harness.runSql(
      paymentEvidenceSql +
        `create or replace function public.claim_due_booking_request_releases(target_limit integer)
      returns jsonb language plpgsql security definer set search_path = '' as $$ begin raise exception 'Injected local expiry failure'; end; $$;`,
    );
    holder = harness.startSession(`begin;
      set application_name = 'worker_scheduled_capture_holder';
      select pg_backend_pid();
      select id from public.booking_requests where id = '${id}' for update;
      select 'CAPTURE_HELD';`);
    await harness.waitForMarker(holder, "CAPTURE_HELD");
    expect(holder.stdout).toContain(id);
    const holderPid = Number(holder.stdout.split("\n")[0]);
    const blockedCaptures = () =>
      Number(
        harness.runSql(`with recursive blocked(pid) as (
          select ${holderPid}::integer
          union
          select waiting.pid from pg_stat_activity waiting join blocked
            on blocked.pid = any(pg_blocking_pids(waiting.pid))
        )
        select count(*) from pg_stat_activity
        where pid in (select pid from blocked) and wait_event_type = 'Lock'
          and query like '%lease_booking_request_capture_work%';`),
      );
    // Observe both complete handlers at the same row lock before either can capture.
    for (let invocation = 1; invocation <= 2; invocation++) {
      scheduled.push(
        triggerScheduled(baseURL, "/__scheduled").then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        ),
      );
      await expect.poll(blockedCaptures).toBe(invocation);
    }
    await harness.finishSession(holder, { action: "rollback" });
    holder = undefined;
    for (const response of await Promise.all(scheduled)) {
      if (response.status === "rejected") throw response.reason;
      expect(response.value.ok).toBe(false);
    }
    const confirmed = observe();
    expect(confirmed.work.state).toBe("complete");
    expect(confirmed.execution.physical_execution_count).toBe(1);
    expect(confirmed.execution.amount_fils).toBe(115000000);
    expect(confirmed.confirmation.booking_request_id).toBe(id);
    expect(confirmed.receipts).toHaveLength(2);
    expect(confirmed.occupancies).toEqual(before.occupancies);
    expect(confirmed.occupancies).toHaveLength(5);
    expect(confirmed.commitment.status).toBe("confirmed_booking");
    harness.runSql(paymentEvidenceSql + expiryDefinition);
    for (let replay = 0; replay < 2; replay++)
      expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    expect(observe()).toEqual(confirmed);
  } finally {
    if (holder) await harness.finishSession(holder, { action: "rollback" });
    await Promise.allSettled(scheduled);
    harness.runSql(paymentEvidenceSql + expiryDefinition);
    if (seeded)
      harness.runSql(
        paymentEvidenceSql +
          captureCleanup({ stem: identity.stem, paymentRecovery: true }),
      );
  }
});

test("the actual Worker recovers a persisted definitive failure into one fixed Payment Required window", async ({
  baseURL,
}, testInfo) => {
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  const identity = browserBookingFixtureIdentity(
    "capture",
    testInfo.project.name,
  );
  const id = identity.request;
  const pending = pendingCaptureSeed(identity);
  const observe = () =>
    JSON.parse(
      harness.runSql(
        paymentEvidenceSql +
          `select jsonb_build_object(
        'work',(select to_jsonb(work) from public.booking_request_capture_work work where booking_request_id='${id}'),
        'execution',(select pg_temp.payment_fixture_operation_json(operation) from public.payment_provider_operations operation where operation_kind='capture' and payment_lifecycle_id='${identity.paymentLifecycle}'),
        'recoveryAttempt',(select to_jsonb(attempt) from public.booking_request_payment_recovery_attempts attempt where booking_request_id='${id}'),
        'providerOperations',(select coalesce(jsonb_agg(pg_temp.payment_fixture_operation_json(operation) order by operation.id),'[]') from public.payment_provider_operations operation where recovery_attempt_id in (select id from public.booking_request_payment_recovery_attempts where booking_request_id='${id}')),
        'confirmation',(select to_jsonb(confirmation) from public.booking_confirmations confirmation where booking_request_id='${id}'),
        'paymentRequiredNotifications',(select count(*) from public.booking_request_status_notifications notification where booking_request_id='${id}' and status='payment-required'),
        'commitment',(select to_jsonb(commitment) from public.cottage_booking_period_commitments commitment where id='${identity.commitment}'),
        'occupancies',(select jsonb_agg(to_jsonb(occupancy) order by shift_id,service_day) from public.cottage_booking_period_occupancies occupancy where booking_period_commitment_id='${identity.commitment}'),
        'intentActive',(select intent_dedupe_active from public.booking_request_submission_attempts where booking_request_id='${id}')
      );`,
      ),
    );
  const unsettledNotificationEvents = () =>
    JSON.parse(
      harness.runSql(
        `select count(*) from public.booking_notification_events event
      left join public.booking_confirmation_notification_work work on work.event_id = event.id
      where event.booking_request_id = '${id}'
        and (work.event_id is null or work.state not in ('delivered', 'suppressed'));`,
      ),
    ) as number;
  let seeded = false;
  try {
    harness.runSql(
      paymentEvidenceSql +
        `begin; ${pending}
      update public.booking_requests set status='pending',settled_at=null where id='${id}';
      set local role service_role;
      select public.claim_booking_request_action('${identity.owner}','${id}','accept'); commit;`,
    );
    seeded = true;
    harness.runSql(
      paymentEvidenceSql +
        `set role service_role;
      with leased as (select public.lease_booking_request_capture_work('${id}',
        '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb) result)
      select pg_temp.capture_execute(result->'permit','failed') from leased;
      reset role;`,
    );
    // The capture claim skips a request row a sibling drain holds, so the
    // accepted notices settle while the lease still fences recovery.
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    expect(unsettledNotificationEvents()).toBe(0);
    harness.runSql(
      `update public.booking_request_capture_work set lease_expires_at=clock_timestamp()-interval '1 second' where booking_request_id='${id}';`,
    );
    const before = observe();
    expect(before.execution.original_outcome).toBe("failed");
    expect(before.execution.movement_reference).toBeNull();
    expect(before.work.state).toBe("processing");
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    const paymentRequired = observe();
    expect(paymentRequired.work.state).toBe("payment_required");
    expect(
      Date.parse(paymentRequired.work.payment_required_deadline) -
        Date.parse(paymentRequired.work.payment_required_recorded_at),
    ).toBe(1_200_000);
    expect(paymentRequired.paymentRequiredNotifications).toBe(1);
    expect(paymentRequired.confirmation).toBeNull();
    expect(paymentRequired.commitment.status).toBe("pending_hold");
    expect(paymentRequired.occupancies).toEqual(before.occupancies);
    expect(paymentRequired.occupancies).toHaveLength(5);
    expect(paymentRequired.intentActive).toBe(true);
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    expect(observe()).toEqual(paymentRequired);
    const admitted = JSON.parse(
      harness
        .runSql(
          paymentEvidenceSql +
            `select set_config('request.jwt.claim.sub','${identity.customer}',false);
      set role authenticated; select public.claim_customer_booking_request_payment_recovery('${id}','${identity.operation}','simulated-replacement');`,
        )
        .split("\n")
        .at(-1)!,
    );
    harness.runSql(
      paymentEvidenceSql +
        `set role service_role;select pg_temp.recovery_execute(
      public.lease_booking_request_payment_recovery_step('${admitted.attemptId}','original-release','admitted')->'permit','succeeded','original_released');`,
    );
    const originalReleased = observe();
    expect(originalReleased.recoveryAttempt.state).toBe("original_released");
    expect(originalReleased.providerOperations).toHaveLength(1);
    expect(originalReleased.providerOperations[0]).toMatchObject({
      operation_kind: "release",
      current_outcome: "succeeded",
      physical_execution_count: 1,
    });
    expect(originalReleased.confirmation).toBeNull();
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    const recovered = observe();
    expect(recovered.work).toEqual(paymentRequired.work);
    expect(recovered.execution).toEqual(paymentRequired.execution);
    expect(recovered.confirmation.booking_request_id).toBe(id);
    expect(recovered.commitment.status).toBe("confirmed_booking");
    expect(recovered.occupancies).toEqual(paymentRequired.occupancies);
    expect(recovered.recoveryAttempt.state).toBe("succeeded");
    expect(recovered.providerOperations).toHaveLength(3);
    expect(
      recovered.providerOperations.map(
        (operation: {
          operation_kind: string;
          current_outcome: string;
          physical_execution_count: number;
        }) => ({
          operationKind: operation.operation_kind,
          outcome: operation.current_outcome,
          physicalEffects: operation.physical_execution_count,
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        { operationKind: "release", outcome: "succeeded", physicalEffects: 1 },
        {
          operationKind: "authorization",
          outcome: "succeeded",
          physicalEffects: 1,
        },
        { operationKind: "capture", outcome: "succeeded", physicalEffects: 1 },
      ]),
    );
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    expect(observe()).toEqual(recovered);
  } finally {
    if (seeded)
      harness.runSql(
        paymentEvidenceSql +
          captureCleanup({ stem: identity.stem, paymentRecovery: true }),
      );
  }
});
