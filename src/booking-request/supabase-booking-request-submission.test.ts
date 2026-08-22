import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createPaymentLifecycle } from "@/payment/payment-lifecycle";
import { PaymentSimulator } from "@/payment/payment-simulator";
import type { PaymentLifecycleSnapshot } from "@/payment/payment-contract";

import {
  BookingRequestAuthorizationClaimNotPersisted,
  type SubmissionInput,
} from "./booking-request-submission";
import { bookingRequestAcceptanceEvidence } from "./booking-request-policy";
import { SupabaseBookingRequestSubmissionRepository } from "./supabase-booking-request-submission";

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
    termsVersion: "fictional-local-test-2026-08-22-v1",
    bookingPriceIqd: 100_003,
    serviceFeeIqd: 5_000,
    customerTotalIqd: 105_003,
    firstStartsAt: "2099-08-21T20:00:00+03:00",
  },
  customerName: "Ava Hassan",
  partySize: 4,
  bookingNote: "Garden seating, please.",
  acceptedHouseRules: true,
  acceptedCancellationPolicy: true,
  acceptedMarketplaceTerms: true,
  acceptedInside48HourNoRefund: false,
  acceptanceEvidence: bookingRequestAcceptanceEvidence({
    locale: "en",
    termsVersion: "fictional-local-test-2026-08-22-v1",
    requiresInside48HourNoRefundAcceptance: false,
  }),
};

function clientWith(result: unknown) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
  } as unknown as SupabaseClient;
}

interface MutablePaymentSnapshot {
  authorization: Record<string, unknown>;
  movements: Record<string, unknown>[];
  financials: Record<string, unknown>;
}

describe("Supabase Booking Request submission repository", () => {
  it("atomically begins authorization and returns the durable provider permit", async () => {
    let pendingSnapshot: PaymentLifecycleSnapshot | undefined;
    const provider = new PaymentSimulator({
      now: () => "2099-08-21T17:00:00.000Z",
      outcomes: ["succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "33333333-3333-4333-8333-333333333333",
        bookingPriceFils: 100_003_000,
        bookingServiceFeeFils: 5_000_000,
      },
      provider,
      {
        save: async (snapshot) => {
          pendingSnapshot = snapshot;
          throw new Error("captured-before-provider");
        },
      },
    );
    await expect(payment.authorize()).rejects.toThrow(
      "captured-before-provider",
    );
    expect(pendingSnapshot).toBeDefined();
    const data = {
      status: "ready",
      executionPermit: {
        claimId: "44444444-4444-4444-8444-444444444444",
        generation: 1,
        idempotencyKey:
          "booking-request:44444444-4444-4444-8444-444444444444:1",
        notAfter: "2099-08-22T00:00:00.000Z",
      },
    };
    const client = clientWith({ data, error: null });
    const repository = new SupabaseBookingRequestSubmissionRepository(client);

    await expect(
      repository.savePaymentSnapshot(
        "22222222-2222-4222-8222-222222222222",
        pendingSnapshot!,
        provider.identity,
      ),
    ).resolves.toEqual(data.executionPermit);
    expect(client.rpc).toHaveBeenCalledWith(
      "begin_booking_request_authorization_claim",
      expect.objectContaining({
        target_attempt_id: "22222222-2222-4222-8222-222222222222",
        target_provider_identity: provider.identity,
      }),
    );
    expect(provider.requests).toHaveLength(0);
  });

  it("classifies an absent rolled-back claim before reporting persistence loss", async () => {
    let pendingSnapshot: PaymentLifecycleSnapshot | undefined;
    const provider = new PaymentSimulator({
      now: () => "2099-08-21T17:00:00.000Z",
      outcomes: ["succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "33333333-3333-4333-8333-333333333333",
        bookingPriceFils: 100_003_000,
        bookingServiceFeeFils: 5_000_000,
      },
      provider,
      {
        save: async (snapshot) => {
          pendingSnapshot = snapshot;
          throw new Error("captured-before-provider");
        },
      },
    );
    await expect(payment.authorize()).rejects.toThrow(
      "captured-before-provider",
    );
    const rpc = vi.fn(async (name: string) =>
      name === "begin_booking_request_authorization_claim"
        ? { data: null, error: { message: "response lost" } }
        : name === "classify_booking_request_authorization_claim_persistence"
          ? { data: { status: "absent" }, error: null }
          : { data: null, error: { message: "unexpected RPC" } },
    );
    const repository = new SupabaseBookingRequestSubmissionRepository({
      rpc,
    } as unknown as SupabaseClient);

    await expect(
      repository.savePaymentSnapshot(
        "22222222-2222-4222-8222-222222222222",
        pendingSnapshot!,
        provider.identity,
      ),
    ).rejects.toBeInstanceOf(BookingRequestAuthorizationClaimNotPersisted);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "classify_booking_request_authorization_claim_persistence",
      { target_attempt_id: "22222222-2222-4222-8222-222222222222" },
    );
    expect(provider.requests).toHaveLength(0);
  });

  it("claims a customer-scoped attempt with separate quote and intent bindings", async () => {
    const client = clientWith({
      data: {
        status: "ready",
        attemptId: "22222222-2222-4222-8222-222222222222",
        paymentLifecycleId: "33333333-3333-4333-8333-333333333333",
        paymentSnapshot: null,
        providerIdentity: null,
      },
      error: null,
    });
    const repository = new SupabaseBookingRequestSubmissionRepository(client);

    await expect(repository.prepare(input)).resolves.toEqual({
      status: "ready",
      attempt: {
        id: "22222222-2222-4222-8222-222222222222",
        paymentLifecycleId: "33333333-3333-4333-8333-333333333333",
        paymentSnapshot: null,
        paymentProviderIdentity: null,
      },
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "prepare_booking_request_submission",
      {
        target_customer_user_id: input.customerUserId,
        target_idempotency_key: input.idempotencyKey,
        target_submission: expect.objectContaining({
          quoteFingerprint: "a".repeat(64),
          intent: expect.objectContaining({
            customerName: "Ava Hassan",
            cancellationPolicyVersion: "rentcottage-mvp-2026-08-04",
            acceptanceEvidence: input.acceptanceEvidence,
          }),
        }),
      },
    );
  });

  it("fails closed for malformed database outcomes", async () => {
    const repository = new SupabaseBookingRequestSubmissionRepository(
      clientWith({
        data: {
          status: "pending",
          bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
          responseDeadline: "not-a-date",
          phone: "+9647500000000",
        },
        error: null,
      }),
    );
    await expect(repository.prepare(input)).rejects.toThrow(
      /invalid Booking Request submission result/i,
    );
  });

  it("returns the pinned provider identity with a recovered payment snapshot", async () => {
    const paymentLifecycleId = "33333333-3333-4333-8333-333333333333";
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId,
        bookingPriceFils: 100_003_000,
        bookingServiceFeeFils: 5_000_000,
      },
      new PaymentSimulator({
        now: () => "2099-08-21T17:00:00.000Z",
        outcomes: ["succeeded"],
      }),
    );
    await payment.authorize();
    const providerIdentity = {
      provider: "fictitious-payments",
      environment: "sandbox",
      merchantId: "merchant-test-only",
      terminalId: "terminal-test-only",
    };
    const repository = new SupabaseBookingRequestSubmissionRepository(
      clientWith({
        data: {
          status: "ready",
          attemptId: "22222222-2222-4222-8222-222222222222",
          paymentLifecycleId,
          paymentSnapshot: payment.snapshot(),
          providerIdentity,
        },
        error: null,
      }),
    );

    await expect(repository.prepare(input)).resolves.toMatchObject({
      status: "ready",
      attempt: { paymentProviderIdentity: providerIdentity },
    });
  });

  it("surfaces an authoritative lookup failure for structured diagnostics", async () => {
    const repository = new SupabaseBookingRequestSubmissionRepository(
      clientWith({ data: null, error: { message: "database unavailable" } }),
    );

    await expect(
      repository.lookup("22222222-2222-4222-8222-222222222222"),
    ).rejects.toThrow(/lookup is unavailable/i);
  });

  it.each([
    [
      "operation kind",
      (snapshot: MutablePaymentSnapshot) =>
        (snapshot.authorization.kind = "release"),
    ],
    [
      "logical operation",
      (snapshot: MutablePaymentSnapshot) =>
        (snapshot.authorization.logicalOperationId = "forged"),
    ],
    [
      "attempt identity",
      (snapshot: MutablePaymentSnapshot) =>
        (snapshot.authorization.attemptId = "forged"),
    ],
    [
      "movement identity",
      (snapshot: MutablePaymentSnapshot) =>
        (snapshot.movements[0].attemptId = "forged"),
    ],
    [
      "financial invariant",
      (snapshot: MutablePaymentSnapshot) =>
        (snapshot.financials.marketplaceCommissionFils = 1),
    ],
    [
      "unexpected field",
      (snapshot: MutablePaymentSnapshot) =>
        (snapshot.authorization.secret = "leak"),
    ],
  ])(
    "rejects an untrusted payment snapshot with forged %s",
    async (_name, mutate) => {
      const paymentLifecycleId = "33333333-3333-4333-8333-333333333333";
      const payment = createPaymentLifecycle(
        {
          paymentLifecycleId,
          bookingPriceFils: 100_003_000,
          bookingServiceFeeFils: 5_000_000,
        },
        new PaymentSimulator({
          now: () => "2099-08-21T17:00:00.000Z",
          outcomes: ["succeeded"],
        }),
      );
      await payment.authorize();
      const snapshot = structuredClone(
        payment.snapshot(),
      ) as unknown as MutablePaymentSnapshot;
      mutate(snapshot);
      const repository = new SupabaseBookingRequestSubmissionRepository(
        clientWith({
          data: {
            status: "ready",
            attemptId: "22222222-2222-4222-8222-222222222222",
            paymentLifecycleId,
            paymentSnapshot: snapshot,
            providerIdentity: {
              provider: "fictitious-payments",
              environment: "sandbox",
              merchantId: "merchant-test-only",
              terminalId: "terminal-test-only",
            },
          },
          error: null,
        }),
      );

      await expect(repository.prepare(input)).rejects.toThrow(
        /invalid Booking Request submission result/i,
      );
    },
  );
});
