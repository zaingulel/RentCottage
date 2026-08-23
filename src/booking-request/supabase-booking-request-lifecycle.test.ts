import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createPaymentLifecycle } from "@/payment/payment-lifecycle";
import { PaymentSimulator } from "@/payment/payment-simulator";

import { SupabaseBookingRequestLifecycleRepository } from "./supabase-booking-request-lifecycle";

const providerIdentity = {
  provider: "fictional-payments",
  environment: "local-test",
  merchantId: "fictional-merchant",
  terminalId: "fictional-terminal",
};

function repositoryReturning(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  return {
    repository: new SupabaseBookingRequestLifecycleRepository(
      { rpc } as unknown as SupabaseClient,
      providerIdentity,
    ),
    rpc,
  };
}

const action = {
  actor: "owner" as const,
  actorUserId: "00000000-0000-4000-8000-000000000034",
  bookingRequestId: "00000000-0000-4000-8000-000000000033",
  action: "accept" as const,
};

async function releaseRequiredResult() {
  const payment = createPaymentLifecycle(
    {
      paymentLifecycleId: "00000000-0000-4000-8000-000000000035",
      bookingPriceFils: 90_000_000,
      bookingServiceFeeFils: 5_000_000,
    },
    new PaymentSimulator({
      now: () => "2026-08-22T10:00:00.000Z",
      outcomes: ["succeeded"],
    }),
  );
  await payment.authorize();
  return {
    status: "release-required",
    workId: "00000000-0000-4000-8000-000000000036",
    attemptId: "00000000-0000-4000-8000-000000000037",
    leaseGeneration: 1,
    leaseToken: "00000000-0000-4000-8000-000000000038",
    leaseExpiresAt: "2099-08-22T10:01:00.000Z",
    bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
    paymentLifecycleId: "00000000-0000-4000-8000-000000000035",
    authorizedAmountFils: 95_000_000,
    paymentSnapshot: payment.snapshot(),
    paymentProviderIdentity: providerIdentity,
  };
}

describe("Supabase Booking Request lifecycle boundary", () => {
  it("rejects a terminal result with a malformed Booking Request reference", async () => {
    const { repository } = repositoryReturning({
      status: "accepted",
      bookingRequestReference: "private-row-id",
    });

    await expect(repository.claim(action)).rejects.toThrow(
      "Booking Request action is unavailable",
    );
  });

  it("returns a newly allocated exact terminal projection", async () => {
    const raw = {
      status: "declined",
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      customerPhone: "+9647000000000",
      paymentProviderReference: "private-provider-reference",
      unknown: { nested: true },
    };
    const { repository } = repositoryReturning(raw);

    const result = await repository.claim(action);

    expect(result).toEqual({
      status: "declined",
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
    });
    expect(result).not.toBe(raw);
  });

  it.each(["workId", "attemptId"] as const)(
    "rejects a release-required result with a malformed %s before another privileged RPC",
    async (field) => {
      const raw = { ...(await releaseRequiredResult()), [field]: "not-a-uuid" };
      const { repository, rpc } = repositoryReturning(raw);

      await expect(repository.claim(action)).rejects.toThrow(
        "Booking Request action is unavailable",
      );
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("claim_booking_request_action", {
        target_actor_user_id: action.actorUserId,
        target_booking_request_id: action.bookingRequestId,
        target_action: action.action,
        target_decline_reason: null,
        target_decline_note: null,
      });
    },
  );

  it("rejects a self-consistent release-required snapshot with a malformed Payment Lifecycle ID", async () => {
    const raw = await releaseRequiredResult();
    const malformedId = "not-a-uuid";
    const paymentSnapshot = JSON.parse(
      JSON.stringify(raw.paymentSnapshot).replaceAll(
        raw.paymentLifecycleId,
        malformedId,
      ),
    );
    const { repository, rpc } = repositoryReturning({
      ...raw,
      paymentLifecycleId: malformedId,
      paymentSnapshot,
    });

    await expect(repository.claim(action)).rejects.toThrow(
      "Booking Request action is unavailable",
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("returns an exact release-required projection for valid UUIDs and drops extra privileged fields", async () => {
    const raw = {
      ...(await releaseRequiredResult()),
      operationId: "00000000-0000-4000-8000-000000000039",
      customerPhone: "+9647000000000",
    };
    const { repository } = repositoryReturning(raw);

    const result = await repository.claim(action);

    expect(result).toEqual({
      status: raw.status,
      workId: raw.workId,
      attemptId: raw.attemptId,
      leaseGeneration: raw.leaseGeneration,
      leaseToken: raw.leaseToken,
      leaseExpiresAt: raw.leaseExpiresAt,
      bookingRequestReference: raw.bookingRequestReference,
      paymentLifecycleId: raw.paymentLifecycleId,
      authorizedAmountFils: raw.authorizedAmountFils,
      paymentSnapshot: raw.paymentSnapshot,
      paymentProviderIdentity: raw.paymentProviderIdentity,
    });
    expect(result).not.toBe(raw);
    expect(result).not.toHaveProperty("operationId");
    expect(result).not.toHaveProperty("customerPhone");
  });
});
