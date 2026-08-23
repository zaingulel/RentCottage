import { describe, expect, it, vi } from "vitest";

import { createPaymentLifecycle } from "@/payment/payment-lifecycle";
import { PaymentSimulator } from "@/payment/payment-simulator";
import type {
  PaymentLifecycleSnapshot,
  PaymentProviderAdapter,
} from "@/payment/payment-contract";

import {
  createBookingRequestLifecycle,
  type BookingRequestLifecycleRepository,
} from "./booking-request-lifecycle";

const requestId = "00000000-0000-4000-8000-000000000033";
const actorId = "00000000-0000-4000-8000-000000000034";
const releaseLease = {
  leaseGeneration: 1,
  leaseToken: "00000000-0000-4000-8000-000000000038",
  leaseExpiresAt: "2099-08-22T10:01:00.000Z",
} as const;

async function authorizedSnapshot(provider: PaymentSimulator) {
  const payment = createPaymentLifecycle(
    {
      paymentLifecycleId: "00000000-0000-4000-8000-000000000035",
      bookingPriceFils: 90_000_000,
      bookingServiceFeeFils: 5_000_000,
    },
    provider,
  );
  await payment.authorize();
  return payment.snapshot();
}

describe("Booking Request lifecycle", () => {
  it("finalizes a decline only after its Payment Authorisation is released", async () => {
    const provider = new PaymentSimulator({
      now: () => "2026-08-22T10:00:00.000Z",
      outcomes: ["succeeded", "succeeded"],
    });
    const snapshot = await authorizedSnapshot(provider);
    const finalize = vi.fn().mockResolvedValue({
      status: "declined",
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
    });
    const repository: BookingRequestLifecycleRepository = {
      claim: vi.fn().mockResolvedValue({
        status: "release-required",
        workId: "00000000-0000-4000-8000-000000000036",
        attemptId: "00000000-0000-4000-8000-000000000037",
        ...releaseLease,
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
        paymentLifecycleId: snapshot.paymentLifecycleId,
        authorizedAmountFils: 95_000_000,
        paymentSnapshot: snapshot,
        paymentProviderIdentity: provider.identity,
      }),
      savePaymentSnapshot: vi.fn(),
      finalize,
      claimDue: vi.fn(),
    };
    const lifecycle = createBookingRequestLifecycle({ repository, provider });

    await expect(
      lifecycle.act({
        actor: "owner",
        actorUserId: actorId,
        bookingRequestId: requestId,
        action: "decline",
        declineReason: "cottage_unavailable",
        declineNote: "Family maintenance is required.",
      }),
    ).resolves.toEqual({
      status: "declined",
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
    });

    expect(provider.requests.at(-1)).toMatchObject({
      kind: "release",
      amountFils: 95_000_000,
    });
    expect(finalize).toHaveBeenCalledOnce();
    expect(finalize.mock.invocationCallOrder[0]).toBeGreaterThan(
      (
        repository.savePaymentSnapshot as ReturnType<typeof vi.fn>
      ).mock.invocationCallOrder.at(-1) ?? 0,
    );
  });

  it("keeps inventory processing when release is indeterminate and never finalizes", async () => {
    const provider = new PaymentSimulator({
      now: () => "2026-08-22T10:00:00.000Z",
      outcomes: ["succeeded", "indeterminate"],
    });
    const snapshot = await authorizedSnapshot(provider);
    const finalize = vi.fn();
    const repository: BookingRequestLifecycleRepository = {
      claim: vi.fn().mockResolvedValue({
        status: "release-required",
        workId: "00000000-0000-4000-8000-000000000036",
        attemptId: "00000000-0000-4000-8000-000000000037",
        ...releaseLease,
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
        paymentLifecycleId: snapshot.paymentLifecycleId,
        authorizedAmountFils: 95_000_000,
        paymentSnapshot: snapshot,
        paymentProviderIdentity: provider.identity,
      }),
      savePaymentSnapshot: vi.fn(),
      finalize,
      claimDue: vi.fn(),
    };

    await expect(
      createBookingRequestLifecycle({ repository, provider }).act({
        actor: "customer",
        actorUserId: actorId,
        bookingRequestId: requestId,
        action: "withdraw",
      }),
    ).resolves.toEqual({
      status: "processing",
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
    });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("rejects a contact-bearing decline note before repository or provider work", async () => {
    const repository = {
      claim: vi.fn(),
      claimDue: vi.fn(),
      savePaymentSnapshot: vi.fn(),
      finalize: vi.fn(),
    } satisfies BookingRequestLifecycleRepository;
    const provider = new PaymentSimulator({
      now: () => "2026-08-22T10:00:00.000Z",
    });
    await expect(
      createBookingRequestLifecycle({ repository, provider }).act({
        actor: "owner",
        actorUserId: actorId,
        bookingRequestId: requestId,
        action: "decline",
        declineReason: "other",
        declineNote: "Email owner@example.com",
      }),
    ).resolves.toEqual({ status: "invalid" });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it("retries a definitively failed retry-safe release with the same logical operation and a new physical attempt", async () => {
    const provider = new PaymentSimulator({
      now: () => "2026-08-22T10:00:00.000Z",
      outcomes: ["succeeded", "failed", "succeeded"],
      failureRetrySafety: [true],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "00000000-0000-4000-8000-000000000035",
        bookingPriceFils: 90_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      provider,
    );
    await payment.authorize();
    await payment.release(95_000_000);
    const snapshot = payment.snapshot();
    const repository: BookingRequestLifecycleRepository = {
      claim: vi.fn().mockResolvedValue({
        status: "release-required",
        workId: "00000000-0000-4000-8000-000000000036",
        attemptId: "00000000-0000-4000-8000-000000000037",
        ...releaseLease,
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
        paymentLifecycleId: snapshot.paymentLifecycleId,
        authorizedAmountFils: 95_000_000,
        paymentSnapshot: snapshot,
        paymentProviderIdentity: provider.identity,
      }),
      savePaymentSnapshot: vi.fn(),
      finalize: vi.fn().mockResolvedValue({
        status: "withdrawn",
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      }),
      claimDue: vi.fn(),
    };

    await expect(
      createBookingRequestLifecycle({ repository, provider }).act({
        actor: "customer",
        actorUserId: actorId,
        bookingRequestId: requestId,
        action: "withdraw",
      }),
    ).resolves.toMatchObject({ status: "withdrawn" });
    expect(provider.requests.at(-1)).toMatchObject({
      logicalOperationId: `${snapshot.paymentLifecycleId}:release`,
      attemptId: `${snapshot.paymentLifecycleId}:release:attempt-3`,
    });
    const saved = (
      repository.savePaymentSnapshot as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[1] as PaymentLifecycleSnapshot;
    expect(
      saved.movements.filter((movement) => movement.kind === "release"),
    ).toHaveLength(1);
  });

  it("refuses corrupted snapshot money before calling the provider", async () => {
    const provider = new PaymentSimulator({
      now: () => "2026-08-22T10:00:00.000Z",
      outcomes: ["succeeded"],
    });
    const snapshot = await authorizedSnapshot(provider);
    const providerCalls = provider.requests.length;
    const repository: BookingRequestLifecycleRepository = {
      claim: vi.fn().mockResolvedValue({
        status: "release-required",
        workId: "00000000-0000-4000-8000-000000000036",
        attemptId: "00000000-0000-4000-8000-000000000037",
        ...releaseLease,
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
        paymentLifecycleId: snapshot.paymentLifecycleId,
        authorizedAmountFils: 96_000_000,
        paymentSnapshot: snapshot,
        paymentProviderIdentity: provider.identity,
      }),
      savePaymentSnapshot: vi.fn(),
      finalize: vi.fn(),
      claimDue: vi.fn(),
    };

    await expect(
      createBookingRequestLifecycle({ repository, provider }).act({
        actor: "customer",
        actorUserId: actorId,
        bookingRequestId: requestId,
        action: "withdraw",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(provider.requests).toHaveLength(providerCalls);
    expect(repository.savePaymentSnapshot).not.toHaveBeenCalled();
  });

  it("safely retries a release after reconciliation proves pre-ledger execution never started", async () => {
    const authorizer = new PaymentSimulator({
      now: () => "2026-08-22T10:00:00.000Z",
      outcomes: ["succeeded"],
    });
    let snapshot = await authorizedSnapshot(authorizer);
    const execute = vi
      .fn<PaymentProviderAdapter["execute"]>()
      .mockRejectedValueOnce(new Error("ledger insert failed"))
      .mockResolvedValueOnce({
        outcome: "succeeded",
        providerRequestId: "release-request-2",
        providerReference: "release-reference-2",
        movementReference: "release-movement-2",
      });
    const query = vi
      .fn<PaymentProviderAdapter["query"]>()
      .mockResolvedValue({ outcome: "not-executed" });
    const provider: PaymentProviderAdapter = {
      identity: authorizer.identity,
      execute,
      query,
      verifySignedEvent: vi.fn().mockReturnValue(false),
    };
    let finalized = false;
    const releaseWork = () => ({
      status: "release-required" as const,
      workId: "00000000-0000-4000-8000-000000000036",
      attemptId: "00000000-0000-4000-8000-000000000037",
      ...releaseLease,
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      paymentLifecycleId: snapshot.paymentLifecycleId,
      authorizedAmountFils: 95_000_000,
      paymentSnapshot: snapshot,
      paymentProviderIdentity: provider.identity,
    });
    const finalize = vi.fn().mockImplementation(async () => {
      finalized = true;
      return {
        status: "withdrawn" as const,
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      };
    });
    const repository: BookingRequestLifecycleRepository = {
      claim: vi.fn().mockImplementation(async () => releaseWork()),
      claimDue: vi.fn().mockImplementation(async () =>
        finalized
          ? [
              {
                status: "withdrawn" as const,
                bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
              },
            ]
          : [releaseWork()],
      ),
      savePaymentSnapshot: vi.fn().mockImplementation(async (_, saved) => {
        snapshot = saved;
      }),
      finalize,
    };
    const lifecycle = createBookingRequestLifecycle({ repository, provider });

    await expect(
      lifecycle.act({
        actor: "customer",
        actorUserId: actorId,
        bookingRequestId: requestId,
        action: "withdraw",
      }),
    ).resolves.toMatchObject({ status: "processing" });
    expect(snapshot.release).toMatchObject({
      status: "pending",
      providerRequestId: null,
      providerReference: null,
      reconciliationRequired: true,
    });

    await expect(lifecycle.processDue()).resolves.toEqual([
      {
        status: "withdrawn",
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      },
    ]);
    await expect(lifecycle.processDue()).resolves.toEqual([
      {
        status: "withdrawn",
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      },
    ]);

    expect(query).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      logicalOperationId: `${snapshot.paymentLifecycleId}:release`,
      attemptId: `${snapshot.paymentLifecycleId}:release:attempt-3`,
    });
    expect(finalize).toHaveBeenCalledOnce();
    expect(
      snapshot.movements.filter((movement) => movement.kind === "release"),
    ).toHaveLength(1);
  });

  it("reconciles an indeterminate existing release without starting a duplicate", async () => {
    const provider = new PaymentSimulator({
      now: () => "2026-08-22T10:00:00.000Z",
      outcomes: ["succeeded", "indeterminate"],
      reconciliationOutcomes: ["succeeded"],
    });
    let snapshot = await authorizedSnapshot(provider);
    let finalized = false;
    const releaseWork = () => ({
      status: "release-required" as const,
      workId: "00000000-0000-4000-8000-000000000036",
      attemptId: "00000000-0000-4000-8000-000000000037",
      ...releaseLease,
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      paymentLifecycleId: snapshot.paymentLifecycleId,
      authorizedAmountFils: 95_000_000,
      paymentSnapshot: snapshot,
      paymentProviderIdentity: provider.identity,
    });
    const finalize = vi.fn().mockImplementation(async () => {
      finalized = true;
      return {
        status: "expired" as const,
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      };
    });
    const repository: BookingRequestLifecycleRepository = {
      claim: vi.fn().mockImplementation(async () => releaseWork()),
      claimDue: vi.fn().mockImplementation(async () =>
        finalized
          ? [
              {
                status: "expired" as const,
                bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
              },
            ]
          : [releaseWork()],
      ),
      savePaymentSnapshot: vi.fn().mockImplementation(async (_, saved) => {
        snapshot = saved;
      }),
      finalize,
    };
    const lifecycle = createBookingRequestLifecycle({ repository, provider });

    await expect(lifecycle.processDue()).resolves.toEqual([
      {
        status: "processing",
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      },
    ]);
    await expect(lifecycle.processDue()).resolves.toEqual([
      {
        status: "expired",
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      },
    ]);
    await lifecycle.processDue();

    expect(provider.requests).toHaveLength(2);
    expect(
      provider.requests.filter((request) => request.kind === "release"),
    ).toHaveLength(1);
    expect(provider.queries).toHaveLength(1);
    expect(finalize).toHaveBeenCalledOnce();
    expect(
      snapshot.movements.filter((movement) => movement.kind === "release"),
    ).toHaveLength(1);
  });
});
