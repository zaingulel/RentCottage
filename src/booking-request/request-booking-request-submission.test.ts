import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClient,
  createSubmission,
  durablePaymentProvider,
  DurablePaymentSimulator,
  getServerEnvironment,
} = vi.hoisted(() => {
  const durablePaymentProvider = {
    identity: {
      provider: "fictional-payments",
      environment: "local-test",
      merchantId: "fictional-merchant",
      terminalId: "fictional-terminal",
    },
    query: vi.fn(),
  };
  return {
    createClient: vi.fn(),
    createSubmission: vi.fn(),
    durablePaymentProvider,
    DurablePaymentSimulator: vi.fn(function DurablePaymentSimulator() {
      return durablePaymentProvider;
    }),
    getServerEnvironment: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("@/config/server-runtime", () => ({ getServerEnvironment }));
vi.mock("@/payment/durable-payment-simulator", () => ({
  DurablePaymentSimulator,
}));
vi.mock("./booking-request-submission", () => ({
  createBookingRequestSubmission: createSubmission,
}));

async function createRequestBookingRequestSubmission() {
  return (
    await import("./request-booking-request-submission")
  ).createRequestBookingRequestSubmission();
}

describe("request Booking Request submission factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("refuses a forbidden runtime before reading privileged configuration or constructing providers", async () => {
    vi.stubEnv("APP_ENVIRONMENT", "preview");
    vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54331");

    await expect(
      createRequestBookingRequestSubmission(),
    ).resolves.toBeUndefined();
    expect(getServerEnvironment).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it("uses the durable service-role simulator in the guarded local test runtime", async () => {
    const client = {
      rpc: vi.fn(async (name: string) => ({
        data:
          name === "pending_booking_request_authorization_observations"
            ? []
            : 1,
        error: null,
      })),
    };
    vi.stubEnv("APP_ENVIRONMENT", "test");
    vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54331");
    getServerEnvironment.mockReturnValue({
      supabase: {
        url: "http://127.0.0.1:54331",
        secretKey: "test-service-role-key",
      },
    });
    createClient.mockReturnValue(client);
    createSubmission.mockReturnValue({ submit: vi.fn() });

    await createRequestBookingRequestSubmission();

    expect(DurablePaymentSimulator).toHaveBeenCalledWith({
      effects: expect.objectContaining({ client }),
      now: expect.any(Function),
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "expire_booking_request_authorization_claims",
    );
    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ paymentProvider: durablePaymentProvider }),
    );
  });
});

it("records inquiry evidence for pending authorizations before the database expiry pass", async () => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv("APP_ENVIRONMENT", "test");
  vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54331");
  getServerEnvironment.mockReturnValue({
    supabase: {
      url: "http://127.0.0.1:54331",
      secretKey: "test-service-role-key",
    },
  });
  const admission = {
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
  const observed = {
    outcome: "not-executed",
    evidence: {
      operationId: admission.operationId,
      eventId: "closed-original",
      provenance: "fictional-provider",
      originalOutcome: null,
      executedAt: null,
      occurredAt: null,
      closedAt: "2026-09-01T00:00:00Z",
    },
  };
  let releaseInquiry!: () => void;
  let inquiryStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    inquiryStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseInquiry = resolve;
  });
  durablePaymentProvider.query.mockImplementation(async () => {
    inquiryStarted();
    await released;
    return observed;
  });
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === "pending_booking_request_authorization_observations"
        ? [admission]
        : name === "reload_booking_request_payment_operation"
          ? admission
          : name === "record_booking_request_provider_operation_observation"
            ? observed
            : 1,
    error: null,
  }));
  createClient.mockReturnValue({ rpc });
  const running = createRequestBookingRequestSubmission();
  await started;
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "pending_booking_request_authorization_observations",
    "reload_booking_request_payment_operation",
  ]);
  releaseInquiry();
  await running;
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "pending_booking_request_authorization_observations",
    "reload_booking_request_payment_operation",
    "record_booking_request_provider_operation_observation",
    "expire_booking_request_authorization_claims",
  ]);
});
