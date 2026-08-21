import { describe, expect, it, vi } from "vitest";

import { PaymentSimulator } from "@/payment/payment-simulator";

import {
  createBookingRequestSubmission,
  BookingRequestAuthorizationClaimNotPersisted,
  BookingRequestPreAuthorizationRejected,
  type BookingRequestSubmissionRepository,
  type SubmissionAttempt,
  type SubmissionInput,
} from "./booking-request-submission";
import { bookingRequestAcceptanceEvidence } from "./booking-request-policy";

const input: SubmissionInput = {
  customerUserId: "00000000-0000-4000-8000-000000000032",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  locale: "en",
  publicSlug: "cottage-00000000000040008000000000000029",
  discoveryQuery: {
    from: "2099-08-21",
    to: "2099-08-21",
    guests: 4,
    amenities: [],
    selections: [{ serviceDay: "2099-08-21", kind: "shift", position: 2 }],
  },
  displayedQuote: {
    fingerprint: "a".repeat(64),
    contentVersion: 2,
    termsVersion: "rentcottage-mvp-2026-08-04",
    bookingPriceIqd: 100_003,
    serviceFeeIqd: 5_000,
    customerTotalIqd: 105_003,
    firstStartsAt: "2099-08-21T20:00:00+03:00",
  },
  customerName: "Ava Hassan",
  partySize: 4,
  bookingNote: "Please prepare the garden seating.",
  acceptedHouseRules: true,
  acceptedCancellationPolicy: true,
  acceptedMarketplaceTerms: true,
  acceptedInside48HourNoRefund: false,
  acceptanceEvidence: bookingRequestAcceptanceEvidence({
    locale: "en",
    termsVersion: "rentcottage-mvp-2026-08-04",
    requiresInside48HourNoRefundAcceptance: false,
  }),
};

function readyAttempt(): SubmissionAttempt {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    paymentLifecycleId: "33333333-3333-4333-8333-333333333333",
    paymentSnapshot: null,
    paymentProviderIdentity: null,
  };
}

function repositoryReturning(
  attempt: SubmissionAttempt = readyAttempt(),
): BookingRequestSubmissionRepository & {
  savedSnapshots: unknown[];
} {
  const savedSnapshots: unknown[] = [];
  return {
    savedSnapshots,
    prepare: async () => ({ status: "ready", attempt }),
    savePaymentSnapshot: async (_attemptId, snapshot) => {
      savedSnapshots.push(snapshot);
      return snapshot.authorization?.status === "pending" && !snapshot.release
        ? {
            claimId: "44444444-4444-4444-8444-444444444444",
            generation: 1,
            idempotencyKey:
              "booking-request:44444444-4444-4444-8444-444444444444:1",
            notAfter: "2099-08-22T00:00:00.000Z",
          }
        : undefined;
    },
    finalize: async () => ({
      status: "pending",
      bookingRequestReference: "RC-REQ-20990821-0001",
      responseDeadline: "2099-08-21T21:00:00.000Z",
    }),
    lookup: async () => ({ status: "absent" }),
    markReconciliationRequired: async () => undefined,
  };
}

function repositoryWithFinalizationFailure(
  lookup: BookingRequestSubmissionRepository["lookup"],
) {
  const repository = repositoryReturning();
  return {
    ...repository,
    finalize: async () => {
      throw new Error("database response was lost");
    },
    lookup,
  } satisfies BookingRequestSubmissionRepository;
}

describe("BookingRequestSubmission", () => {
  it("retries the same intent safely after a rolled-back claim response loss", async () => {
    const baseline = repositoryReturning();
    const savePaymentSnapshot = vi
      .fn<BookingRequestSubmissionRepository["savePaymentSnapshot"]>()
      .mockRejectedValueOnce(new BookingRequestAuthorizationClaimNotPersisted())
      .mockImplementation(baseline.savePaymentSnapshot);
    const markReconciliationRequired = vi.fn(async () => undefined);
    const repository = {
      ...baseline,
      prepare: vi.fn(async () => ({
        status: "ready" as const,
        attempt: readyAttempt(),
      })),
      savePaymentSnapshot,
      markReconciliationRequired,
    } satisfies BookingRequestSubmissionRepository;
    const provider = new PaymentSimulator({
      now: () => "2099-08-21T17:00:00.000Z",
      outcomes: ["succeeded"],
    });
    const submission = createBookingRequestSubmission({
      repository,
      paymentProvider: provider,
    });

    await expect(submission.submit(input)).resolves.toEqual({
      status: "unavailable",
    });
    await expect(submission.submit(input)).resolves.toMatchObject({
      status: "pending",
    });
    expect(provider.requests).toHaveLength(1);
    expect(repository.prepare).toHaveBeenCalledTimes(2);
    expect(markReconciliationRequired).not.toHaveBeenCalled();
  });

  it.each(["quote-stale", "too-late", "invalid"] as const)(
    "never calls Payment Authorization when fresh preparation returns %s",
    async (status) => {
      const repository = {
        ...repositoryReturning(),
        prepare: vi.fn().mockResolvedValue({ status }),
      } satisfies BookingRequestSubmissionRepository;
      const provider = new PaymentSimulator({
        now: () => "2099-08-21T17:00:00.000Z",
      });

      await expect(
        createBookingRequestSubmission({
          repository,
          paymentProvider: provider,
        }).submit(input),
      ).resolves.toEqual({ status });
      expect(provider.requests).toHaveLength(0);
      expect(repository.savedSnapshots).toHaveLength(0);
    },
  );

  it.each(["quote-stale", "too-late", "invalid", "unavailable"] as const)(
    "never starts Payment Authorization when the atomic claim returns %s",
    async (status) => {
      const repository = {
        ...repositoryReturning(),
        savePaymentSnapshot: vi.fn(async () => {
          throw new BookingRequestPreAuthorizationRejected(status);
        }),
      } satisfies BookingRequestSubmissionRepository;
      const provider = new PaymentSimulator({
        now: () => "2099-08-21T17:00:00.000Z",
        outcomes: ["succeeded"],
      });

      await expect(
        createBookingRequestSubmission({
          repository,
          paymentProvider: provider,
        }).submit(input),
      ).resolves.toEqual({ status });
      expect(provider.requests).toHaveLength(0);
    },
  );

  it("authorises the exact Customer Total before returning one Pending Booking Request", async () => {
    const repository = repositoryReturning();
    const provider = new PaymentSimulator({
      now: () => "2099-08-21T17:00:00.000Z",
      outcomes: ["succeeded"],
    });
    const submission = createBookingRequestSubmission({
      repository,
      paymentProvider: provider,
    });

    await expect(submission.submit(input)).resolves.toEqual({
      status: "pending",
      bookingRequestReference: "RC-REQ-20990821-0001",
      responseDeadline: "2099-08-21T21:00:00.000Z",
    });
    expect(provider.requests).toEqual([
      expect.objectContaining({
        kind: "authorization",
        amountFils: 105_003_000,
        paymentLifecycleId: "33333333-3333-4333-8333-333333333333",
      }),
    ]);
    expect(repository.savedSnapshots).toHaveLength(2);
  });

  it("rehydrates an indeterminate Payment Authorization and reconciles it without another movement", async () => {
    const repository = repositoryReturning();
    const firstProvider = new PaymentSimulator({
      now: () => "2099-08-21T17:00:00.000Z",
      outcomes: ["indeterminate"],
    });
    const firstSubmission = createBookingRequestSubmission({
      repository,
      paymentProvider: firstProvider,
    });

    await expect(firstSubmission.submit(input)).resolves.toEqual({
      status: "reconciliation-required",
    });
    const persisted = repository.savedSnapshots.at(-1);
    expect(persisted).toBeDefined();

    const retryRepository = repositoryReturning({
      ...readyAttempt(),
      paymentSnapshot: persisted as SubmissionAttempt["paymentSnapshot"],
      paymentProviderIdentity: firstProvider.identity,
    });
    const retryProvider = new PaymentSimulator({
      now: () => "2099-08-21T17:01:00.000Z",
      reconciliationOutcomes: ["succeeded"],
    });

    await expect(
      createBookingRequestSubmission({
        repository: retryRepository,
        paymentProvider: retryProvider,
      }).submit(input),
    ).resolves.toEqual({
      status: "pending",
      bookingRequestReference: "RC-REQ-20990821-0001",
      responseDeadline: "2099-08-21T21:00:00.000Z",
    });
    expect(retryProvider.requests).toHaveLength(0);
    expect(retryProvider.queries).toEqual([
      expect.objectContaining({
        kind: "authorization",
        amountFils: 105_003_000,
      }),
    ]);
  });

  it("fails closed before rehydration when the durable provider identity changed", async () => {
    const repository = repositoryReturning();
    const firstProvider = new PaymentSimulator({
      now: () => "2099-08-21T17:00:00.000Z",
      outcomes: ["indeterminate"],
    });
    await createBookingRequestSubmission({
      repository,
      paymentProvider: firstProvider,
    }).submit(input);
    const markReconciliationRequired = vi.fn().mockResolvedValue(undefined);
    const retryRepository = {
      ...repositoryReturning({
        ...readyAttempt(),
        paymentSnapshot: repository.savedSnapshots.at(
          -1,
        ) as SubmissionAttempt["paymentSnapshot"],
        paymentProviderIdentity: firstProvider.identity,
      }),
      markReconciliationRequired,
    } satisfies BookingRequestSubmissionRepository;
    const changedProvider = new PaymentSimulator({
      now: () => "2099-08-21T17:01:00.000Z",
      identity: { merchantId: "changed-merchant" },
      reconciliationOutcomes: ["succeeded"],
    });
    const record = vi.fn();

    await expect(
      createBookingRequestSubmission({
        repository: retryRepository,
        paymentProvider: changedProvider,
        diagnostics: { record },
      }).submit(input),
    ).resolves.toEqual({ status: "reconciliation-required" });
    expect(changedProvider.requests).toHaveLength(0);
    expect(changedProvider.queries).toHaveLength(0);
    expect(markReconciliationRequired).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith({
      code: "booking_request_provider_identity_mismatch",
      attemptId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("looks up an ambiguous finalization and never releases when the request may have committed", async () => {
    const repository = repositoryWithFinalizationFailure(async () => ({
      status: "unknown",
    }));
    const provider = new PaymentSimulator({
      now: () => "2099-08-21T17:00:00.000Z",
      outcomes: ["succeeded", "succeeded"],
    });

    await expect(
      createBookingRequestSubmission({
        repository,
        paymentProvider: provider,
      }).submit(input),
    ).resolves.toEqual({ status: "reconciliation-required" });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.kind).toBe("authorization");
  });

  it("records safe structured diagnostics for an ambiguous finalization", async () => {
    const record = vi.fn();
    const repository = repositoryWithFinalizationFailure(async () => ({
      status: "unknown",
    }));
    await createBookingRequestSubmission({
      repository,
      paymentProvider: new PaymentSimulator({
        now: () => "2099-08-21T17:00:00.000Z",
        outcomes: ["succeeded"],
      }),
      diagnostics: { record },
    }).submit(input);

    expect(record).toHaveBeenCalledWith({
      code: "booking_request_finalization_failed",
      attemptId: "22222222-2222-4222-8222-222222222222",
    });
    expect(record).toHaveBeenCalledWith({
      code: "booking_request_lookup_unknown",
      attemptId: "22222222-2222-4222-8222-222222222222",
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain("Ava Hassan");
  });

  it("releases the exact authorization only after an authoritative absence", async () => {
    const repository = repositoryWithFinalizationFailure(async () => ({
      status: "absent",
    }));
    const provider = new PaymentSimulator({
      now: () => "2099-08-21T17:00:00.000Z",
      outcomes: ["succeeded", "succeeded"],
    });

    await expect(
      createBookingRequestSubmission({
        repository,
        paymentProvider: provider,
      }).submit(input),
    ).resolves.toEqual({ status: "unavailable" });
    expect(provider.requests.map((request) => request.kind)).toEqual([
      "authorization",
      "release",
    ]);
    expect(provider.requests[1]?.amountFils).toBe(105_003_000);
  });

  it("requires the no-refund acceptance inside 48 hours and stops inside the six-hour cut-off", async () => {
    const repository = {
      ...repositoryReturning(),
      prepare: vi
        .fn()
        .mockResolvedValueOnce({ status: "invalid" })
        .mockResolvedValueOnce({ status: "too-late" }),
    } satisfies BookingRequestSubmissionRepository;
    const provider = new PaymentSimulator({
      now: () => "2099-08-21T17:00:00.000Z",
    });
    const submission = createBookingRequestSubmission({
      repository,
      paymentProvider: provider,
    });
    const inside48Hours = {
      ...input,
      displayedQuote: {
        ...input.displayedQuote,
        firstStartsAt: "2099-08-21T20:00:00+03:00",
      },
    };

    await expect(submission.submit(inside48Hours)).resolves.toEqual({
      status: "invalid",
    });
    await expect(
      submission.submit({
        ...inside48Hours,
        displayedQuote: {
          ...inside48Hours.displayedQuote,
          firstStartsAt: "2099-08-21T08:59:59+03:00",
        },
        acceptedInside48HourNoRefund: true,
      }),
    ).resolves.toEqual({ status: "too-late" });
    expect(provider.requests).toHaveLength(0);
  });

  it("lets the repository recover an existing result before applying fresh quote timing", async () => {
    const prepare = vi.fn().mockResolvedValue({
      status: "pending",
      bookingRequestReference: "RC-REQ-20990821-0001",
      responseDeadline: "2099-08-21T21:00:00.000Z",
    });
    const repository = { ...repositoryReturning(), prepare };
    const submission = createBookingRequestSubmission({
      repository,
      paymentProvider: new PaymentSimulator({
        now: () => "2099-08-22T00:00:00.000Z",
      }),
    });

    await expect(submission.submit(input)).resolves.toEqual({
      status: "pending",
      bookingRequestReference: "RC-REQ-20990821-0001",
      responseDeadline: "2099-08-21T21:00:00.000Z",
    });
    expect(prepare).toHaveBeenCalledOnce();
  });
});
