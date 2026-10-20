import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPaymentLifecycle } from "@/payment/payment-lifecycle";
import { PaymentSimulator } from "@/payment/payment-simulator";

import type { RecoverableSubmissionAttempt } from "./booking-request-submission";

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
vi.mock("@/payment/durable-payment-simulator-core", () => ({
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
          name === "pending_booking_request_authorization_observations" ||
          name === "due_booking_request_submission_recoveries"
            ? []
            : 1,
        error: null,
      })),
    };
    vi.stubEnv("APP_ENVIRONMENT", "test");
    vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54331");
    getServerEnvironment.mockReturnValue({
      name: "test",
      supabase: {
        projectRef: "local-test",
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
    name: "test",
    supabase: {
      projectRef: "local-test",
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
            : name === "due_booking_request_submission_recoveries"
              ? []
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
    "due_booking_request_submission_recoveries",
  ]);
});

it("isolates hostile per-candidate recovery and marking failures while continuing the next candidate and ordinary submission with safe diagnostics", async () => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv("APP_ENVIRONMENT", "test");
  vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54331");
  getServerEnvironment.mockReturnValue({
    name: "test",
    supabase: {
      projectRef: "local-test",
      url: "http://127.0.0.1:54331",
      secretKey: "test-service-role-key",
    },
  });
  const provider = new PaymentSimulator({
    now: () => "2099-08-21T17:00:00.000Z",
    outcomes: ["succeeded", "succeeded"],
    identity: durablePaymentProvider.identity,
  });
  const candidates: RecoverableSubmissionAttempt[] = [];
  for (const [id, paymentLifecycleId] of [
    [
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ],
    [
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ],
  ]) {
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId,
        bookingPriceFils: 100_003_000,
        bookingServiceFeeFils: 5_000_000,
      },
      provider,
    );
    await payment.authorize();
    candidates.push({
      id,
      paymentLifecycleId,
      bookingPriceFils: 100_003_000,
      bookingServiceFeeFils: 5_000_000,
      paymentSnapshot: payment.snapshot(),
      paymentProviderIdentity: durablePaymentProvider.identity,
    });
  }
  const hostile =
    "SYNTHETIC_SECRET_810 contact-810@example.invalid +9647599999810";
  const recoverAuthorized = vi
    .fn()
    .mockRejectedValueOnce(
      Object.assign(new Error(hostile), { code: "RC409", detail: hostile }),
    )
    .mockResolvedValueOnce({ status: "reconciliation-required" });
  const submit = vi.fn().mockResolvedValue({ status: "pending" });
  createSubmission.mockReturnValue({ recoverAuthorized, submit });
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === "due_booking_request_submission_recoveries"
        ? candidates
        : name === "pending_booking_request_authorization_observations"
          ? []
          : 1,
    error:
      name === "mark_booking_request_reconciliation_required"
        ? { code: "RC500", message: hostile, details: hostile }
        : null,
  }));
  createClient.mockReturnValue({ rpc });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const service = await createRequestBookingRequestSubmission();
    expect(recoverAuthorized.mock.calls).toEqual([
      [candidates[0]],
      [candidates[1]],
    ]);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "pending_booking_request_authorization_observations",
      "expire_booking_request_authorization_claims",
      "due_booking_request_submission_recoveries",
      "mark_booking_request_reconciliation_required",
    ]);
    await expect(service?.submit({} as never)).resolves.toEqual({
      status: "pending",
    });
    expect(log.mock.calls).toEqual([
      [
        "Booking Request submission failed",
        {
          phase: "recovery",
          code: "booking_request_recovery_failed",
          sqlstate: "RC409",
          attemptId: "22222222-2222-4222-8222-222222222222",
        },
      ],
      [
        "Booking Request submission failed",
        {
          phase: "reconciliation",
          code: "booking_request_reconciliation_marker_failed",
          attemptId: "22222222-2222-4222-8222-222222222222",
        },
      ],
    ]);
    const logged = JSON.stringify(log.mock.calls);
    for (const marker of [
      "SYNTHETIC_SECRET_810",
      "contact-810@example.invalid",
      "+9647599999810",
      "test-service-role-key",
    ])
      expect(logged).not.toContain(marker);
  } finally {
    log.mockRestore();
  }
});
