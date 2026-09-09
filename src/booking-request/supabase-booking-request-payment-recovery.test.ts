import { recoveryPredecessorStates } from "./booking-request-payment-observation";
import { describe, expect, it, vi } from "vitest";
import { SupabaseBookingRequestPaymentRecoveryRepository } from "./supabase-booking-request-payment-recovery";
import { recoveryPermitFixture } from "../../tests/fixtures/payment-recovery.fixtures";

const attemptId = "11111111-1111-4111-8111-111111111111";
describe("Supabase Booking Request payment recovery", () => {
  it.each([
    ["original-release", "release"],
    ["replacement-authorization", "authorization"],
    ["replacement-capture", "capture"],
    ["replacement-release", "release"],
  ] as const)(
    "constructs the %s request with operation kind %s",
    async (step, kind) => {
      const permit = recoveryPermitFixture(step);
      const service = {
        rpc: vi.fn().mockResolvedValue({
          data: { status: "leased", permit, binding: permit.binding },
          error: null,
        }),
      };
      const repository = new SupabaseBookingRequestPaymentRecoveryRepository(
        {} as never,
        service as never,
      );
      await expect(
        repository.lease(attemptId, step, recoveryPredecessorStates[step]),
      ).resolves.toMatchObject({
        status: "leased",
        binding: { kind },
      });
    },
  );
  it("admits through the authenticated client and leases through the private client", async () => {
    const customer = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          status: "processing",
          attemptId,
          deadline: "2026-09-06T12:20:00.000Z",
        },
        error: null,
      }),
    };
    const service = {
      rpc: vi
        .fn()
        .mockResolvedValue({ data: { status: "succeeded" }, error: null }),
    };
    const repository = new SupabaseBookingRequestPaymentRecoveryRepository(
      customer as never,
      service as never,
    );
    await expect(
      repository.admit({ bookingRequestId: attemptId, commandKey: attemptId }),
    ).resolves.toMatchObject({ attemptId });
    await expect(
      repository.lease(attemptId, "original-release", "admitted"),
    ).resolves.toEqual({
      status: "succeeded",
    });
    expect(customer.rpc).toHaveBeenCalledWith(
      "claim_customer_booking_request_payment_recovery",
      expect.any(Object),
    );
    expect(service.rpc).toHaveBeenCalledWith(
      "lease_booking_request_payment_recovery_step",
      {
        target_attempt_id: attemptId,
        target_step: "original-release",
        target_expected_state: "admitted",
      },
    );
  });
});
