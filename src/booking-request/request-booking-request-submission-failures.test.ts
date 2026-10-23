import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PaymentOperationAdmission } from "@/payment/payment-operation-execution";

const { createClient, durablePaymentProvider } = vi.hoisted(() => ({
  createClient: vi.fn(),
  durablePaymentProvider: {
    identity: {
      provider: "fictional-payments",
      environment: "local-test",
      merchantId: "fictional-merchant",
      terminalId: "fictional-terminal",
    },
    execute: vi.fn(),
    query: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("@/payment/durable-payment-simulator-core", () => ({
  DurablePaymentSimulator: vi.fn(function DurablePaymentSimulator() {
    return durablePaymentProvider;
  }),
}));

const admission: PaymentOperationAdmission = {
  operationId: "11111111-1111-4111-8111-111111111111",
  purpose: "booking-request-authorization",
  providerIdentity: durablePaymentProvider.identity,
  idempotencyKey: "original-authorization",
  requestFingerprint: "a".repeat(64),
  binding: {
    kind: "authorization",
    paymentLifecycleId: "lifecycle",
    logicalOperationId: "authorization",
    attemptId: "authorization:attempt-1",
    amountFils: 1000,
    currency: "IQD",
  },
  notBefore: null,
  notAfter: "2099-01-01T00:00:00Z",
  mode: "reconcile",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("APP_ENVIRONMENT", "test");
  vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54331");
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-service-role-key");
  vi.stubEnv("HOSTED_DEMO", undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("preserves recovery preparation failures and stops before later phases", async () => {
  const privatePayload = {
    secret: "test-service-role-key",
    contact: "private-customer@example.test",
  };
  const pending = "pending_booking_request_authorization_observations";
  const expiry = "expire_booking_request_authorization_claims";
  const due = "due_booking_request_submission_recoveries";
  const dueArguments = {
    target_provider_identity: durablePaymentProvider.identity,
  };
  const cases = [
    {
      name: "pending RPC error",
      routine: pending,
      response: { data: [admission], error: privatePayload },
      calls: [[pending]],
      diagnostic: "Booking Request provider inquiry selection failed",
    },
    {
      name: "malformed pending list",
      routine: pending,
      response: { data: [admission, privatePayload], error: null },
      calls: [[pending]],
      diagnostic: "Booking Request provider inquiry selection failed",
    },
    {
      name: "resolved expiry error",
      routine: expiry,
      response: { data: 1, error: privatePayload },
      calls: [[pending], [expiry]],
      diagnostic: "Booking Request expiry reconciliation failed",
    },
    {
      name: "due RPC error",
      routine: due,
      response: { data: [], error: privatePayload },
      calls: [[pending], [expiry], [due, dueArguments]],
      diagnostic: "Booking Request recovery selection failed",
    },
    {
      name: "malformed due list",
      routine: due,
      response: { data: [privatePayload], error: null },
      calls: [[pending], [expiry], [due, dueArguments]],
      diagnostic: "Booking Request recovery selection failed",
    },
  ];
  const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
  const { createRequestBookingRequestSubmission } =
    await import("./request-booking-request-submission");

  for (const scenario of cases) {
    vi.clearAllMocks();
    const rpc = vi.fn(async (name: string) =>
      name === scenario.routine
        ? scenario.response
        : { data: name === expiry ? 1 : [], error: null },
    );
    createClient.mockReturnValue({ rpc });

    await expect(
      createRequestBookingRequestSubmission(),
      scenario.name,
    ).resolves.toBeUndefined();
    expect(rpc.mock.calls, scenario.name).toEqual(scenario.calls);
    expect(durablePaymentProvider.query, scenario.name).not.toHaveBeenCalled();
    expect(
      durablePaymentProvider.execute,
      scenario.name,
    ).not.toHaveBeenCalled();
    expect(diagnostic.mock.calls, scenario.name).toEqual([
      [scenario.diagnostic],
    ]);
  }
});

it("continues expiry after an unresolved pending inquiry result", async () => {
  const calls: string[] = [];
  const rpc = vi.fn(async (name: string) => {
    calls.push(name);
    return {
      data:
        name === "pending_booking_request_authorization_observations"
          ? [admission]
          : name === "reload_booking_request_payment_operation"
            ? admission
            : name === "due_booking_request_submission_recoveries"
              ? []
              : 1,
      error: null,
    };
  });
  createClient.mockReturnValue({ rpc });
  durablePaymentProvider.query.mockImplementationOnce(async () => {
    calls.push("provider inquiry");
    throw new Error("Provider inquiry unavailable");
  });
  const { createRequestBookingRequestSubmission } =
    await import("./request-booking-request-submission");

  const submission = await createRequestBookingRequestSubmission();

  expect(durablePaymentProvider.query).toHaveBeenCalledExactlyOnceWith({
    ...admission.binding,
    providerRequestId: null,
    providerReference: null,
    admission,
  });
  expect(durablePaymentProvider.execute).not.toHaveBeenCalled();
  expect(calls).toEqual([
    "pending_booking_request_authorization_observations",
    "reload_booking_request_payment_operation",
    "provider inquiry",
    "expire_booking_request_authorization_claims",
    "due_booking_request_submission_recoveries",
  ]);
  expect(submission).toEqual({
    submit: expect.any(Function),
    recoverAuthorized: expect.any(Function),
  });
});
