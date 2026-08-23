import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, getRequest } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getRequest: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("./customer-booking-request", () => ({
  getCustomerBookingRequest: getRequest,
}));
import { loadCustomerBookingRequest } from "./request-customer-booking-request";

describe("Customer Booking Request status boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("lets an unauthenticated read fail through request-scoped RLS without privileged due effects", async () => {
    vi.stubEnv("APP_ENVIRONMENT", "test");
    vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54331");
    createClient.mockResolvedValue({ authenticated: false });
    getRequest.mockResolvedValue(undefined);
    await loadCustomerBookingRequest("RC-REQ-AAAAAAAAAAAAAAAA");
    expect(getRequest).toHaveBeenCalledWith(
      { authenticated: false },
      "RC-REQ-AAAAAAAAAAAAAAAA",
    );
  });
});
