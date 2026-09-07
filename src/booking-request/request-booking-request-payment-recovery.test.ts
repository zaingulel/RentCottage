import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { enabled, customer, createClient } = vi.hoisted(() => ({
  enabled: vi.fn(),
  customer: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("./booking-request-test-runtime", () => ({
  bookingRequestTestRuntimeIsEnabled: enabled,
}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: customer,
}));
vi.mock("@/config/server-runtime", () => ({
  getServerEnvironment: () => ({
    supabase: { url: "http://127.0.0.1:55331", secretKey: "test-secret" },
  }),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
import { createRequestBookingRequestPaymentRecovery } from "./request-booking-request-payment-recovery";
beforeEach(() => vi.clearAllMocks());
it("returns unavailable before constructing clients outside the fictional local runtime", async () => {
  enabled.mockReturnValue(false);
  await expect(
    createRequestBookingRequestPaymentRecovery(),
  ).resolves.toBeUndefined();
  expect(customer).not.toHaveBeenCalled();
  expect(createClient).not.toHaveBeenCalled();
});
it("uses the request authenticated client for admission and stops on denial before private payment work", async () => {
  enabled.mockReturnValue(true);
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
