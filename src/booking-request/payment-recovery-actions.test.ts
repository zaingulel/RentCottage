import { beforeEach, expect, it, vi } from "vitest";
const { factory, execute, refresh } = vi.hoisted(() => ({
  factory: vi.fn(),
  execute: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./request-booking-request-payment-recovery", () => ({
  createRequestBookingRequestPaymentRecovery: factory,
}));
vi.mock("next/cache", () => ({ refresh }));
import { recoverBookingRequestPayment } from "./payment-recovery-actions";
const input = {
  bookingRequestId: "11111111-1111-4111-8111-111111111111",
  commandKey: "22222222-2222-4222-8222-222222222222",
  locale: "en",
};
beforeEach(() => {
  vi.clearAllMocks();
  factory.mockResolvedValue({ execute });
  execute.mockResolvedValue({ status: "succeeded" });
});
it("passes only request and command identity through authenticated admission and refreshes persisted status", async () => {
  await expect(
    recoverBookingRequestPayment({
      ...input,
      customerUserId: "forged",
      amountFils: 1,
      deadline: "later",
    }),
  ).resolves.toEqual({ status: "succeeded" });
  expect(execute).toHaveBeenCalledExactlyOnceWith({
    bookingRequestId: input.bookingRequestId,
    commandKey: input.commandKey,
  });
  expect(refresh).toHaveBeenCalledOnce();
});
it.each([
  null,
  {},
  { ...input, commandKey: "bad" },
  { ...input, locale: "xx" },
])(
  "rejects malformed input before constructing a payment service",
  async (value) => {
    await expect(recoverBookingRequestPayment(value)).resolves.toEqual({
      status: "invalid",
    });
    expect(factory).not.toHaveBeenCalled();
  },
);
it("does not activate a provider outside the approved test runtime", async () => {
  factory.mockResolvedValue(undefined);
  await expect(recoverBookingRequestPayment(input)).resolves.toEqual({
    status: "unavailable",
  });
  expect(execute).not.toHaveBeenCalled();
});
