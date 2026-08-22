import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClient,
  createSubmission,
  durablePaymentProvider,
  DurablePaymentSimulator,
  getServerEnvironment,
} = vi.hoisted(() => {
  const durablePaymentProvider = { identity: "durable-simulator" };
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

import { createRequestBookingRequestSubmission } from "./request-booking-request-submission";

describe("request Booking Request submission factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      rpc: vi.fn().mockResolvedValue({ data: 1, error: null }),
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
      client,
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
