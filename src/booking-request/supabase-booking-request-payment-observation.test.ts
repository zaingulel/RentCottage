import { expect, it, vi } from "vitest";
import {
  paymentFactsFixture,
  paymentOperationFixture,
  recoveryPermitFixture,
} from "../../tests/fixtures/payment-recovery.fixtures";
import type { PaymentExpiryOperationFact } from "./booking-request-payment-observation";
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
const duplicateIds = [
  "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11",
  "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
];
it.each([
  [
    "attempt",
    "attempts",
    (id: string) => ({ ...paymentFactsFixture().attempts[0], id }),
  ],
  ["operation", "operations", (id: string) => paymentOperationFixture({ id })],
  [
    "expiry operation",
    "expiryOperations",
    (id: string): PaymentExpiryOperationFact => {
      const facts = paymentFactsFixture();
      return {
        id,
        owner: "expiry",
        authorizationLifecycleId: facts.originalLifecycleId,
        kind: "refund",
        captureId: facts.originalCaptureId,
        providerOperationId: null,
        valid: true,
        permit: {
          purpose: "booking-request-payment-required-corrective-refund",
          expiryWorkId: facts.bookingRequestId,
          expiryOperationId: id,
          idempotencyKey: "refund:1",
          notBefore: "2026-09-06T12:00:00.000Z",
          binding: {
            bookingRequestId: facts.bookingRequestId,
            captureProviderOperationId: facts.originalCaptureId!,
            paymentLifecycleId: facts.originalLifecycleId,
            captureLogicalOperationId: "capture",
            capturePhysicalAttemptId: "capture:1",
            captureMovementReference: "movement",
            captureOccurredAt: "2026-09-06T12:01:00.000Z",
            refundLogicalOperationId: "refund",
            refundPhysicalAttemptId: "refund:1",
            amountFils: facts.amountFils,
            currency: "IQD",
            providerIdentity: facts.providerIdentity,
          },
        },
      };
    },
  ],
] as const)(
  "rejects case-only duplicate payment %s IDs",
  (_label, collection, entry) => {
    const [lowercase, uppercase, distinct] = duplicateIds.map((id) =>
      entry(id),
    );
    for (const value of [lowercase, uppercase]) {
      expect(
        bookingRequestPaymentFactsFrom(
          paymentFactsFixture({ [collection]: [value] }),
        )[collection],
      ).toEqual([value]);
    }
    expect(
      bookingRequestPaymentFactsFrom(
        paymentFactsFixture({ [collection]: [uppercase, distinct] }),
      )[collection],
    ).toEqual([uppercase, distinct]);
    expect(() =>
      bookingRequestPaymentFactsFrom(
        paymentFactsFixture({ [collection]: [lowercase, uppercase] }),
      ),
    ).toThrow("Payment facts are invalid");
  },
);
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
