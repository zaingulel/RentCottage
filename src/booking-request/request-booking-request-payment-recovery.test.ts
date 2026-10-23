import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { customer, createClient } = vi.hoisted(() => ({
  customer: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: customer,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
import { createRequestBookingRequestPaymentRecovery } from "./request-booking-request-payment-recovery";
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("APP_ENVIRONMENT", "test");
  vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:15331");
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
  vi.stubEnv("HOSTED_DEMO", undefined);
});
afterEach(() => vi.unstubAllEnvs());
it("returns unavailable before constructing clients in ordinary preview", async () => {
  vi.stubEnv("APP_ENVIRONMENT", "preview");
  await expect(
    createRequestBookingRequestPaymentRecovery(),
  ).resolves.toBeUndefined();
  expect(customer).not.toHaveBeenCalled();
  expect(createClient).not.toHaveBeenCalled();
});
it("uses the request authenticated client for admission and stops on denial before private payment work", async () => {
  const admit = vi
    .fn()
    .mockResolvedValue({ data: null, error: { code: "RC404" } });
  const privileged = vi.fn();
  customer.mockResolvedValue({ rpc: admit });
  createClient.mockReturnValue({ rpc: privileged });
  const recovery = await createRequestBookingRequestPaymentRecovery();
  await expect(
    recovery!.execute({
      bookingRequestId: "11111111-1111-4111-8111-111111111111",
      commandKey: "22222222-2222-4222-8222-222222222222",
    }),
  ).rejects.toThrow("unavailable");
  expect(admit).toHaveBeenCalledOnce();
  expect(privileged).not.toHaveBeenCalled();
});
