import { expect, it, vi } from "vitest";
import { paymentFactsFixture } from "../../tests/fixtures/payment-recovery.fixtures";
import { SupabaseBookingRequestPaymentRequiredExpiryRepository } from "./supabase-booking-request-payment-required-expiry";
const facts = paymentFactsFixture();
it("rejects duplicate due Booking Requests", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: [
      { bookingRequestId: facts.bookingRequestId },
      { bookingRequestId: facts.bookingRequestId },
    ],
    error: null,
  });
  await expect(
    new SupabaseBookingRequestPaymentRequiredExpiryRepository({
      rpc,
    } as never).due(20, facts.providerIdentity),
  ).rejects.toThrow("batch is invalid");
});
it("rejects case-only duplicate due Booking Request IDs", async () => {
  const lowercaseId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const uppercaseId = "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11";
  const distinctId = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const rpc = vi.fn();
  const repository = new SupabaseBookingRequestPaymentRequiredExpiryRepository({
    rpc,
  } as never);
  for (const id of [lowercaseId, uppercaseId]) {
    rpc.mockResolvedValue({
      data: [{ bookingRequestId: id }],
      error: null,
    });
    await expect(repository.due(20, facts.providerIdentity)).resolves.toEqual([
      id,
    ]);
  }
  rpc.mockResolvedValue({
    data: [{ bookingRequestId: uppercaseId }, { bookingRequestId: distinctId }],
    error: null,
  });
  await expect(repository.due(20, facts.providerIdentity)).resolves.toEqual([
    uppercaseId,
    distinctId,
  ]);
  rpc.mockResolvedValue({
    data: [
      { bookingRequestId: lowercaseId },
      { bookingRequestId: uppercaseId },
    ],
    error: null,
  });
  await expect(repository.due(20, facts.providerIdentity)).rejects.toThrow(
    "Payment Required expiry batch is invalid",
  );
});
it("transports the exact application-selected release and stale expectation", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { status: "prepared" }, error: null });
  const command = {
    revision: facts.revision,
    action: "release" as const,
    authorizationLifecycleId: facts.originalLifecycleId,
    recoveryOperationId: null,
  };
  expect(
    await new SupabaseBookingRequestPaymentRequiredExpiryRepository({
      rpc,
    } as never).prepare(
      facts.bookingRequestId,
      facts.providerIdentity,
      command,
    ),
  ).toEqual({ status: "prepared" });
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "prepare_booking_request_payment_required_expiry",
    {
      target_booking_request_id: facts.bookingRequestId,
      target_provider_identity: facts.providerIdentity,
      target_command: command,
    },
  );
});
it("rejects a database-selected instruction on the command response", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { status: "release" }, error: null });
  await expect(
    new SupabaseBookingRequestPaymentRequiredExpiryRepository({
      rpc,
    } as never).prepare(facts.bookingRequestId, facts.providerIdentity, {
      revision: facts.revision,
      action: "refund",
      captureId: facts.originalCaptureId!,
    }),
  ).rejects.toThrow("unavailable");
});
it("loads facts bound to the requested Booking Request", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: facts, error: null });
  const repository = new SupabaseBookingRequestPaymentRequiredExpiryRepository({
    rpc,
  } as never);
  expect(await repository.facts(facts.bookingRequestId)).toEqual(facts);
  await expect(repository.facts("foreign-request")).rejects.toThrow(
    "another Booking Request",
  );
});
it("returns only a bound finalization receipt", async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: { status: "expired", bookingRequestId: facts.bookingRequestId },
    error: null,
  });
  expect(
    await new SupabaseBookingRequestPaymentRequiredExpiryRepository({
      rpc,
    } as never).finalize(facts.bookingRequestId),
  ).toEqual({ status: "expired" });
});
