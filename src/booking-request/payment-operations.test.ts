import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { DurablePaymentSimulator } from "@/payment/durable-payment-simulator-core";
import type { PaymentOperationAdmission } from "@/payment/payment-operation-execution";
import type { ProviderOperationResult } from "@/payment/payment-contract";

import { preparePaymentOperations } from "./payment-operations";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

it("hosted payment composition preserves its durable identity", async () => {
  createClient.mockClear();
  const environment = {
    APP_ENVIRONMENT: "preview",
    HOSTED_DEMO: "true",
    SUPABASE_PROJECT_REF: "yvibcyqtyihpzpmomnzg",
    SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
    SUPABASE_SECRET_KEY: "fixture-secret",
    PRIVILEGED_AUDIT_HMAC_KEY: "fixture-audit-key-with-at-least-32-characters",
    DEPLOYMENT_COMMIT: "cccccccccccccccccccccccccccccccccccccccc",
  };
  const identity = {
    provider: "fictional-payments",
    environment: "hosted-demo-yvibcyqtyihpzpmomnzg",
    merchantId: "fictional-merchant",
    terminalId: "fictional-terminal",
  };
  const binding = {
    kind: "release" as const,
    paymentLifecycleId: "lifecycle",
    logicalOperationId: "release",
    attemptId: "attempt-1",
    amountFils: 1000,
    currency: "IQD" as const,
  };
  const admission: PaymentOperationAdmission = {
    purpose: "booking-request-release",
    operationId: "11111111-1111-4111-8111-111111111111",
    providerIdentity: identity,
    idempotencyKey: "original-key",
    requestFingerprint: "a".repeat(64),
    binding,
    notBefore: null,
    notAfter: "2099-01-01T00:00:00Z",
    mode: "execute",
  };
  let result: ProviderOperationResult | undefined;
  const rpc = vi.fn(
    async (
      _name: string,
      arguments_: {
        target_result?: ProviderOperationResult;
      },
    ) => {
      result ??= arguments_.target_result;
      return { data: result, error: null };
    },
  );
  const client = { rpc };
  createClient.mockReturnValue(client);

  const prepare = preparePaymentOperations(environment);
  expect(prepare).toBeTypeOf("function");
  expect(createClient).not.toHaveBeenCalled();
  const composed = prepare!();
  expect(composed.serviceClient).toBe(client);
  expect(composed.provider.identity).toEqual(identity);
  expect(createClient).toHaveBeenCalledExactlyOnceWith(
    "https://yvibcyqtyihpzpmomnzg.supabase.co",
    "fixture-secret",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const executed = await composed.provider.execute({
    ...binding,
    executionPermit: null,
    admission,
  });
  const effectBinding = {
    operationId: admission.operationId,
    providerIdentity: identity,
    idempotencyKey: "original-key",
    requestFingerprint: "a".repeat(64),
    notBefore: null,
    notAfter: "2099-01-01T00:00:00Z",
  };
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "persist_simulated_payment_effect",
    {
      target_binding: effectBinding,
      target_result: executed,
    },
  );
  const fresh = prepare!();
  expect(
    await fresh.provider.query({
      ...binding,
      providerRequestId: null,
      providerReference: null,
      admission,
    }),
  ).toEqual(executed);
  expect(rpc).toHaveBeenLastCalledWith("seal_simulated_payment_absence", {
    target_binding: effectBinding,
  });

  rpc.mockClear();
  for (const changed of [
    undefined,
    {
      ...admission,
      providerIdentity: { ...identity, environment: "local-test" },
    },
    {
      ...admission,
      providerIdentity: { ...identity, environment: "production" },
    },
    { ...admission, binding: { ...binding, amountFils: 99 } },
  ]) {
    await expect(
      composed.provider.execute({
        ...binding,
        executionPermit: null,
        admission: changed,
      }),
    ).rejects.toThrow("admission");
    await expect(
      composed.provider.query({
        ...binding,
        providerRequestId: null,
        providerReference: null,
        admission: changed,
      }),
    ).rejects.toThrow("admission");
  }
  expect(rpc).not.toHaveBeenCalled();
  expect(
    () =>
      new DurablePaymentSimulator({
        effects: {
          executeOnce: vi.fn(),
          queryAndSealAbsent: vi.fn(),
          resolve: vi.fn(),
        },
        now: () => "2098-01-01T00:00:00Z",
        environment: "production" as "local-test",
      }),
  ).toThrow("environment");
});

it("validates the hosted capture selector before client construction and composes lifecycle-specific durable effects", async () => {
  createClient.mockClear();
  const environment = {
    APP_ENVIRONMENT: "preview",
    HOSTED_DEMO: "true",
    SUPABASE_PROJECT_REF: "yvibcyqtyihpzpmomnzg",
    SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
    SUPABASE_SECRET_KEY: "fixture-secret",
    PRIVILEGED_AUDIT_HMAC_KEY: "fixture-audit-key-with-at-least-32-characters",
    DEPLOYMENT_COMMIT: "c".repeat(40),
    HOSTED_DEMO_FAILED_CAPTURE_LIFECYCLE_ID:
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
  for (const patch of [
    { HOSTED_DEMO_FAILED_CAPTURE_LIFECYCLE_ID: "" },
    { HOSTED_DEMO_FAILED_CAPTURE_LIFECYCLE_ID: "malformed" },
    {
      HOSTED_DEMO_FAILED_CAPTURE_LIFECYCLE_ID:
        "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    },
    { HOSTED_DEMO: undefined },
    { APP_ENVIRONMENT: "production" },
    {
      SUPABASE_PROJECT_REF: "other-project",
      SUPABASE_URL: "https://other-project.supabase.co",
    },
    {
      APP_ENVIRONMENT: "test",
      HOSTED_DEMO: undefined,
      SUPABASE_PROJECT_REF: "local-test",
      SUPABASE_URL: "http://127.0.0.1:54331",
    },
  ]) {
    expect(() =>
      preparePaymentOperations({ ...environment, ...patch }),
    ).toThrow();
  }
  expect(createClient).not.toHaveBeenCalled();
  const stored = new Map<string, ProviderOperationResult>();
  const rpc = vi.fn(
    async (
      _name: string,
      args: {
        target_binding: { operationId: string };
        target_result: ProviderOperationResult;
      },
    ) => {
      const id = args.target_binding.operationId;
      if (!stored.has(id)) stored.set(id, args.target_result);
      return { data: stored.get(id), error: null };
    },
  );
  createClient.mockReturnValue({ rpc });
  const prepare = preparePaymentOperations(environment);
  expect(prepare).toBeTypeOf("function");
  expect(createClient).not.toHaveBeenCalled();
  const { provider } = prepare!();
  const cases: readonly [
    PaymentOperationAdmission["purpose"],
    string,
    string,
    "failed" | "succeeded",
  ][] = [
    [
      "booking-request-capture",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "11111111-1111-4111-8111-111111111111",
      "failed",
    ],
    [
      "booking-request-payment-recovery",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "22222222-2222-4222-8222-222222222222",
      "succeeded",
    ],
    [
      "booking-request-capture",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "33333333-3333-4333-8333-333333333333",
      "succeeded",
    ],
  ];
  for (const [purpose, paymentLifecycleId, operationId, outcome] of cases) {
    const binding = {
      kind: "capture" as const,
      paymentLifecycleId,
      logicalOperationId: operationId,
      attemptId: operationId,
      amountFils: 1000,
      currency: "IQD" as const,
    };
    const result = await provider.execute({
      ...binding,
      executionPermit: null,
      admission: {
        purpose,
        operationId,
        providerIdentity: provider.identity,
        binding,
        idempotencyKey: operationId,
        requestFingerprint: "a".repeat(64),
        notBefore: null,
        notAfter: "2099-01-01T00:00:00Z",
        mode: "execute",
      },
    });
    expect(result.outcome).toBe(outcome);
    expect(stored.get(operationId)).toEqual(result);
    expect(rpc).toHaveBeenLastCalledWith("persist_simulated_payment_effect", {
      target_binding: expect.objectContaining({
        operationId,
        idempotencyKey: operationId,
      }),
      target_result: result,
    });
  }
  expect(stored.size).toBe(3);
});

it("preserves payment operation admission for the exact local test runtime", () => {
  const localEnvironment = {
    APP_ENVIRONMENT: "test",
    SUPABASE_PROJECT_REF: "local-test",
    SUPABASE_URL: "http://127.0.0.1:54331",
    SUPABASE_SECRET_KEY: "fictional-test-secret",
  };
  const forbiddenEnvironments = [
    { APP_ENVIRONMENT: "production" },
    { APP_ENVIRONMENT: "preview" },
    { SUPABASE_PROJECT_REF: "another-project" },
    { SUPABASE_URL: "https://fictional-project.supabase.co" },
    { SUPABASE_URL: "http://fictional-project.example:54331" },
    { SUPABASE_URL: "not-a-url" },
    { APP_ENVIRONMENT: undefined },
    { SUPABASE_SECRET_KEY: undefined },
  ];

  expect(preparePaymentOperations(localEnvironment)).toBeTypeOf("function");
  for (const environment of forbiddenEnvironments) {
    expect(
      preparePaymentOperations({ ...localEnvironment, ...environment }),
      JSON.stringify(environment),
    ).toBeUndefined();
  }
});

const sources = [
  ...readdirSync(join(process.cwd(), "src"), { recursive: true })
    .map((file) => `src/${String(file).replaceAll("\\", "/")}`)
    .filter((file) => /(?<!\.test)\.tsx?$/.test(file)),
  "custom-worker.ts",
]
  .sort()
  .map((file) => ({
    file,
    source: readFileSync(join(process.cwd(), file), "utf8"),
  }));

function filesReferencing(symbol: RegExp) {
  return sources
    .filter(({ source }) => symbol.test(source))
    .map(({ file }) => file);
}

const requestCallers = [
  "src/booking-request/request-booking-request-lifecycle.ts",
  "src/booking-request/request-booking-request-payment-recovery.ts",
  "src/booking-request/request-booking-request-submission.ts",
  "src/booking-request/request-booking-settlement.ts",
];

const scheduleCallers = [
  "src/booking-request/booking-refund-schedule.ts",
  "src/booking-request/booking-request-capture-schedule.ts",
  "src/booking-request/booking-request-expiry-schedule.ts",
];

function callerSource(caller: string) {
  const match = sources.find(({ file }) => file === caller);
  if (!match) throw new Error(`Payment operation caller ${caller} is missing`);
  return match.source;
}

describe("payment operations boundary", () => {
  it("assembles the payment provider adapter, operation execution and payment service client only in the payment operations module", () => {
    expect(filesReferencing(/\bDurablePaymentSimulator\b/)).toEqual([
      "src/booking-request/payment-operations.ts",
      "src/payment/durable-payment-simulator-core.ts",
    ]);
    expect(filesReferencing(/\bcreatePaymentOperationExecution\b/)).toEqual([
      "src/booking-request/payment-operations.ts",
      "src/payment/payment-operation-execution.ts",
    ]);

    for (const caller of requestCallers) {
      expect(callerSource(caller), caller).toMatch(
        /from "\.\/request-payment-operations"/,
      );
    }
    for (const caller of scheduleCallers) {
      expect(callerSource(caller), caller).toMatch(
        /from "\.\/payment-operations"/,
      );
    }
    for (const caller of [...requestCallers, ...scheduleCallers]) {
      expect(callerSource(caller), caller).not.toMatch(
        /\bcreateClient\b|SUPABASE_SECRET_KEY|secretKey/,
      );
    }
  });
});
