import { withRecordedProviderResults } from "../../tests/fixtures/payment-operation-execution.fixtures";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  createPaymentLifecycle,
  rehydratePaymentAuthorizationLifecycle,
} from "@/payment/payment-lifecycle";
import { PaymentSimulator } from "@/payment/payment-simulator";
import type { PaymentLifecycleSnapshot } from "@/payment/payment-contract";

import {
  BookingRequestAuthorizationClaimNotPersisted,
  BookingRequestPreAuthorizationRejected,
  createBookingRequestSubmission,
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
  it("reads exact-provider due recoveries with persisted fractional-Iraqi-dinar amounts and a validated authorization snapshot", async () => {
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
    );
    await payment.authorize();
    const attempt = {
      id: "22222222-2222-4222-8222-222222222222",
      paymentLifecycleId: "33333333-3333-4333-8333-333333333333",
      bookingPriceFils: 100_003_000,
      bookingServiceFeeFils: 5_000_000,
      paymentSnapshot: payment.snapshot(),
      paymentProviderIdentity: provider.identity,
    };
    const client = clientWith({ data: [attempt], error: null });
    const repository = new SupabaseBookingRequestSubmissionRepository(client);
    await expect(
      repository.dueAuthorizedRecoveries(provider.identity),
    ).resolves.toEqual([attempt]);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith(
      "due_booking_request_submission_recoveries",
      { target_provider_identity: provider.identity },
    );
    expect(provider.requests).toHaveLength(1);
  });

  it("rejects a malformed, foreign, duplicate or excess due recovery batch before any recovery or provider effect", async () => {
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
    );
    await payment.authorize();
    const attempt = {
      id: "22222222-2222-4222-8222-222222222222",
      paymentLifecycleId: "33333333-3333-4333-8333-333333333333",
      bookingPriceFils: 100_003_000,
      bookingServiceFeeFils: 5_000_000,
      paymentSnapshot: payment.snapshot(),
      paymentProviderIdentity: provider.identity,
    };
    const unresolved = structuredClone(payment.snapshot()) as unknown as {
      authorization: Record<string, unknown>;
    };
    unresolved.authorization.reconciliationRequired = true;
    const hostile = "SYNTHETIC_SECRET_810 contact-810@example.invalid";
    for (const data of [
      null,
      { ...attempt },
      [{ ...attempt, extra: true }],
      [{ ...attempt, id: "not-a-uuid" }],
      [
        {
          ...attempt,
          paymentProviderIdentity: {
            ...provider.identity,
            environment: "production",
          },
        },
      ],
      [{ ...attempt, bookingPriceFils: 100_003_000.5 }],
      [{ ...attempt, bookingServiceFeeFils: 0 }],
      [{ ...attempt, bookingPriceFils: Number.MAX_SAFE_INTEGER }],
      [{ ...attempt, bookingPriceFils: 100_000_000 }],
      [
        {
          ...attempt,
          paymentLifecycleId: "55555555-5555-4555-8555-555555555555",
        },
      ],
      [{ ...attempt, paymentSnapshot: unresolved }],
      [attempt, attempt],
      Array.from({ length: 51 }, () => attempt),
    ]) {
      const client = clientWith({ data, error: null });
      await expect(
        new SupabaseBookingRequestSubmissionRepository(
          client,
        ).dueAuthorizedRecoveries(provider.identity),
      ).rejects.toThrow("Invalid Booking Request recovery batch");
    }
    const failing = clientWith({
      data: null,
      error: { code: "RC500", message: hostile, details: hostile },
    });
    await expect(
      new SupabaseBookingRequestSubmissionRepository(
        failing,
      ).dueAuthorizedRecoveries(provider.identity),
    ).rejects.toThrow(
      new Error("Booking Request recovery selection is unavailable"),
    );
    const unqueried = clientWith({ data: [], error: null });
    await expect(
      new SupabaseBookingRequestSubmissionRepository(
        unqueried,
      ).dueAuthorizedRecoveries({ ...provider.identity, terminalId: "" }),
    ).rejects.toThrow("Invalid recovery provider identity");
    expect(unqueried.rpc).not.toHaveBeenCalled();
    expect(provider.requests).toHaveLength(1);
  });

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
        purpose: "booking-request-authorization",
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
        "authorization-claim",
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

  it("preserves authorization persistence classification after an indeterminate provider execution", async () => {
    const provider = new PaymentSimulator({
      now: () => "2099-08-21T17:00:00.000Z",
    });
    const execute = vi
      .spyOn(provider, "execute")
      .mockRejectedValue(new Error("provider response unavailable"));
    const query = vi.spyOn(provider, "query");
    const executionPermit = {
      purpose: "booking-request-authorization",
      claimId: "44444444-4444-4444-8444-444444444444",
      generation: 1,
      idempotencyKey:
        "booking-request:44444444-4444-4444-8444-444444444444:1",
      notAfter: "2099-08-22T00:00:00.000Z",
    };
    let authorizationClaims = 0;
    const rpc = vi.fn(async (name: string) => {
      if (name === "prepare_booking_request_submission") {
        return {
          data: {
            status: "ready",
            attemptId: "22222222-2222-4222-8222-222222222222",
            paymentLifecycleId: "33333333-3333-4333-8333-333333333333",
            paymentSnapshot: null,
            providerIdentity: null,
          },
          error: null,
        };
      }
      if (name === "begin_booking_request_authorization_claim") {
        authorizationClaims += 1;
        return {
          data:
            authorizationClaims === 1
              ? { status: "ready", executionPermit }
              : { status: "invalid" },
          error: null,
        };
      }
      if (name === "save_booking_request_payment_snapshot") {
        return {
          data: null,
          error: {
            code: "22023",
            message: "Pending Payment Authorization evidence is invalid",
          },
        };
      }
      return { data: null, error: { message: "unexpected RPC" } };
    });
    const repository = new SupabaseBookingRequestSubmissionRepository({
      rpc,
    } as unknown as SupabaseClient);

    await expect(
      createBookingRequestSubmission(
        withRecordedProviderResults({ repository, paymentProvider: provider }),
      ).submit(input),
    ).resolves.toEqual({ status: "invalid" });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "prepare_booking_request_submission",
      "begin_booking_request_authorization_claim",
      "begin_booking_request_authorization_claim",
    ]);
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "begin_booking_request_authorization_claim",
      expect.objectContaining({
        target_attempt_id: "22222222-2222-4222-8222-222222222222",
        target_payment_snapshot: expect.objectContaining({
          authorization: expect.objectContaining({
            status: "pending",
            providerRequestId: null,
            providerReference: null,
            movementReference: null,
            reconciliationRequired: true,
          }),
          release: null,
        }),
        target_provider_identity: provider.identity,
      }),
    );
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "authorization", executionPermit }),
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects an exact customer-suspended authorization claim before provider execution", async () => {
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
    const client = clientWith({
      data: { status: "customer-suspended" },
      error: null,
    });
    const repository = new SupabaseBookingRequestSubmissionRepository(client);
    const result = repository.savePaymentSnapshot(
      "22222222-2222-4222-8222-222222222222",
      pendingSnapshot!,
      provider.identity,
      "authorization-claim",
    );

    await expect(result).rejects.toBeInstanceOf(
      BookingRequestPreAuthorizationRejected,
    );
    await expect(result).rejects.toMatchObject({
      status: "customer-suspended",
    });
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith(
      "begin_booking_request_authorization_claim",
      {
        target_attempt_id: "22222222-2222-4222-8222-222222222222",
        target_payment_snapshot: pendingSnapshot,
        target_provider_identity: provider.identity,
      },
    );
    expect(provider.requests).toHaveLength(0);
  });

  it("rejects an extra-key customer-suspended authorization outcome as an invalid permit", async () => {
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
    const client = clientWith({
      data: { status: "customer-suspended", ready: true },
      error: null,
    });
    const repository = new SupabaseBookingRequestSubmissionRepository(client);
    const result = repository.savePaymentSnapshot(
      "22222222-2222-4222-8222-222222222222",
      pendingSnapshot!,
      provider.identity,
      "authorization-claim",
    );

    await expect(result).rejects.toThrow(
      "Database returned an invalid provider execution permit",
    );
    await expect(result).rejects.not.toBeInstanceOf(
      BookingRequestPreAuthorizationRejected,
    );
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith(
      "begin_booking_request_authorization_claim",
      {
        target_attempt_id: "22222222-2222-4222-8222-222222222222",
        target_payment_snapshot: pendingSnapshot,
        target_provider_identity: provider.identity,
      },
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
        "authorization-claim",
      ),
    ).rejects.toBeInstanceOf(BookingRequestAuthorizationClaimNotPersisted);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "classify_booking_request_authorization_claim_persistence",
      { target_attempt_id: "22222222-2222-4222-8222-222222222222" },
    );
    expect(provider.requests).toHaveLength(0);
  });

  it("atomically persists a pending cleanup release and returns its exact cleanup permit", async () => {
    const provider = new PaymentSimulator({
      now: () => "2099-08-21T17:00:00.000Z",
      outcomes: ["succeeded"],
    });
    const input = {
      paymentLifecycleId: "33333333-3333-4333-8333-333333333333",
      bookingPriceFils: 100_003_000,
      bookingServiceFeeFils: 5_000_000,
    };
    const authorized = createPaymentLifecycle(input, provider);
    await authorized.authorize();
    let pendingSnapshot: PaymentLifecycleSnapshot | undefined;
    const cleanup = rehydratePaymentAuthorizationLifecycle(
      input,
      provider,
      authorized.snapshot(),
      {
        save: async (snapshot) => {
          pendingSnapshot = snapshot;
          throw new Error("captured-before-provider");
        },
      },
    );
    await expect(cleanup.release(105_003_000)).rejects.toThrow(
      "captured-before-provider",
    );
    const permit = {
      purpose: "booking-request-submission-cleanup",
      attemptId: "22222222-2222-4222-8222-222222222222",
      claimId: "44444444-4444-4444-8444-444444444444",
      generation: 1,
      stateRevision: 4,
      idempotencyKey:
        "booking-request-submission-cleanup:22222222-2222-4222-8222-222222222222:4",
      requestFingerprint: "b".repeat(64),
      notAfter: "2099-08-21T17:00:30.000Z",
    };
    const client = clientWith({
      data: { status: "ready", executionPermit: permit },
      error: null,
    });
    const repository = new SupabaseBookingRequestSubmissionRepository(client);

    await expect(
      repository.savePaymentSnapshot(
        permit.attemptId,
        pendingSnapshot!,
        provider.identity,
        "cleanup-release",
      ),
    ).resolves.toEqual(permit);
    expect(client.rpc).toHaveBeenCalledWith(
      "begin_booking_request_submission_cleanup_release",
      expect.objectContaining({
        target_attempt_id: permit.attemptId,
        target_payment_snapshot: pendingSnapshot,
        target_provider_identity: provider.identity,
      }),
    );
  });

  it("passes the exact cleanup permit through submission after authoritative absence", async () => {
    const provider = new PaymentSimulator({
      now: () => "2099-08-21T17:00:00.000Z",
      outcomes: ["succeeded", "succeeded"],
    });
    const authorizationPermit = {
      purpose: "booking-request-authorization",
      claimId: "44444444-4444-4444-8444-444444444444",
      generation: 1,
      idempotencyKey:
        "booking-request:44444444-4444-4444-8444-444444444444:1",
      notAfter: "2099-08-22T00:00:00.000Z",
    };
    const cleanupPermit = {
      purpose: "booking-request-submission-cleanup",
      attemptId: "22222222-2222-4222-8222-222222222222",
      claimId: "44444444-4444-4444-8444-444444444444",
      generation: 1,
      stateRevision: 4,
      idempotencyKey:
        "booking-request-submission-cleanup:22222222-2222-4222-8222-222222222222:4",
      requestFingerprint: "b".repeat(64),
      notAfter: "2099-08-21T17:00:30.000Z",
    };
    const rpc = vi.fn(async (name: string) => {
      if (name === "prepare_booking_request_submission") {
        return {
          data: {
            status: "ready",
            attemptId: "22222222-2222-4222-8222-222222222222",
            paymentLifecycleId: "33333333-3333-4333-8333-333333333333",
            paymentSnapshot: null,
            providerIdentity: null,
          },
          error: null,
        };
      }
      if (name === "begin_booking_request_authorization_claim") {
        return {
          data: { status: "ready", executionPermit: authorizationPermit },
          error: null,
        };
      }
      if (name === "save_booking_request_payment_snapshot") {
        return { data: null, error: null };
      }
      if (name === "finalize_booking_request_submission") {
        return { data: null, error: { message: "finalization unavailable" } };
      }
      if (name === "lookup_booking_request_submission") {
        return { data: { status: "absent" }, error: null };
      }
      if (name === "begin_booking_request_submission_cleanup_release") {
        expect(provider.requests.map((request) => request.kind)).toEqual([
          "authorization",
        ]);
        return {
          data: { status: "ready", executionPermit: cleanupPermit },
          error: null,
        };
      }
      return { data: null, error: { message: "unexpected RPC" } };
    });
    const repository = new SupabaseBookingRequestSubmissionRepository({
      rpc,
    } as unknown as SupabaseClient);

    await expect(
      createBookingRequestSubmission(
        withRecordedProviderResults({ repository, paymentProvider: provider }),
      ).submit(input),
    ).resolves.toEqual({ status: "unavailable" });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "prepare_booking_request_submission",
      "begin_booking_request_authorization_claim",
      "save_booking_request_payment_snapshot",
      "finalize_booking_request_submission",
      "lookup_booking_request_submission",
      "begin_booking_request_submission_cleanup_release",
      "save_booking_request_payment_snapshot",
    ]);
    expect(rpc).toHaveBeenNthCalledWith(
      6,
      "begin_booking_request_submission_cleanup_release",
      expect.objectContaining({
        target_attempt_id: cleanupPermit.attemptId,
        target_payment_snapshot: expect.objectContaining({
          paymentLifecycleId: "33333333-3333-4333-8333-333333333333",
          authorization: expect.objectContaining({ status: "succeeded" }),
          release: expect.objectContaining({
            kind: "release",
            status: "pending",
            amountFils: 105_003_000,
            providerRequestId: null,
            providerReference: null,
            movementReference: null,
          }),
        }),
        target_provider_identity: provider.identity,
      }),
    );
    expect(provider.requests.map((request) => request.kind)).toEqual([
      "authorization",
      "release",
    ]);
    expect(provider.requests[1]?.amountFils).toBe(105_003_000);
    expect(provider.requests[1]?.executionPermit).toEqual(cleanupPermit);
    expect(provider.queries).toHaveLength(0);
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

  it("keeps the legacy submission payload unchanged when no conversation is continued", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: "ready",
        attemptId: "22222222-2222-4222-8222-222222222222",
        paymentLifecycleId: "33333333-3333-4333-8333-333333333333",
        paymentSnapshot: null,
        providerIdentity: null,
      },
      error: null,
    });
    const client = { rpc };

    await new SupabaseBookingRequestSubmissionRepository(
      client as unknown as SupabaseClient,
    ).prepare(input);

    const submission = rpc.mock.calls[0]?.[1]?.target_submission;
    expect(submission).not.toHaveProperty("conversationId");
    expect(submission.intent).not.toHaveProperty("conversationId");
  });

  it("binds an explicitly continued inquiry in both submission and fingerprinted intent", async () => {
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
    const conversationId = "44444444-4444-4444-8444-444444444444";

    await new SupabaseBookingRequestSubmissionRepository(client).prepare({
      ...input,
      conversationId,
    });

    expect(client.rpc).toHaveBeenCalledWith(
      "prepare_booking_request_submission",
      expect.objectContaining({
        target_submission: expect.objectContaining({
          conversationId,
          intent: expect.objectContaining({ conversationId }),
        }),
      }),
    );
  });

  it("decodes customer suspension only as an exact finite failure", async () => {
    const repository = new SupabaseBookingRequestSubmissionRepository(
      clientWith({ data: { status: "customer-suspended" }, error: null }),
    );
    await expect(repository.prepare(input)).resolves.toEqual({
      status: "customer-suspended",
    });
    const malformed = new SupabaseBookingRequestSubmissionRepository(
      clientWith({
        data: { status: "customer-suspended", ready: true },
        error: null,
      }),
    );
    await expect(malformed.prepare(input)).rejects.toThrow(
      /invalid Booking Request submission result/i,
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

  it("projects the real status for an idempotent retry of an existing request", async () => {
    const repository = new SupabaseBookingRequestSubmissionRepository(
      clientWith({
        data: {
          status: "declined",
          bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
          responseDeadline: "2099-08-21T21:00:00.000Z",
        },
        error: null,
      }),
    );

    await expect(repository.prepare(input)).resolves.toEqual({
      status: "declined",
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      responseDeadline: "2099-08-21T21:00:00.000Z",
    });
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
