import { expect, it, vi } from "vitest";
import {
  paymentFactsFixture,
  paymentOperationFixture,
  recoveryPermitFixture,
} from "../../tests/fixtures/payment-recovery.fixtures";
import {
  bookingRequestPaymentFactsFrom,
  SupabaseBookingRequestPaymentObservationRepository,
} from "./supabase-booking-request-payment-observation";
it("validates complete facts independently of JSON key order", () => {
  const facts = paymentFactsFixture();
  expect(
    bookingRequestPaymentFactsFrom(
      Object.fromEntries(Object.entries(facts).reverse()),
    ),
  ).toEqual(facts);
});
it.each([
  undefined,
  {},
  { ...paymentFactsFixture(), operations: null },
  { ...paymentFactsFixture(), deadline: "unknown" },
  { ...paymentFactsFixture(), amountFils: 0 },
  { ...paymentFactsFixture(), sourceValid: undefined },
  {
    ...paymentFactsFixture(),
    operations: [
      paymentOperationFixture({
        permit: {
          ...recoveryPermitFixture(),
          binding: { ...recoveryPermitFixture().binding, amountFils: -1 },
        },
      }),
    ],
  },
])("rejects incomplete or malformed database facts", (facts) => {
  expect(() => bookingRequestPaymentFactsFrom(facts)).toThrow("invalid");
});
it("transports one selected atomic observation and retains stale as a reload signal", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { status: "stale" }, error: null });
  const repository = new SupabaseBookingRequestPaymentObservationRepository({
    rpc,
  } as never);
  const command = {
    revision: "a".repeat(32),
    recoveryState: null,
    correctiveCaptureId: null,
    quarantineReason: null,
  };
  const result = { outcome: "not-executed" as const };
  expect(
    await repository.record(paymentOperationFixture().id, result, command),
  ).toBe("stale");
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "record_booking_request_payment_observation",
    {
      target_operation_id: paymentOperationFixture().id,
      target_result: result,
      target_command: command,
    },
  );
});
