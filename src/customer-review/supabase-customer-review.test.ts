import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRequestClient, runtimeEnabled } = vi.hoisted(() => ({
  createRequestClient: vi.fn(),
  runtimeEnabled: vi.fn(() => true),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createRequestClient,
}));
vi.mock("@/booking-request/booking-request-test-runtime", () => ({
  bookingRequestTestRuntimeIsEnabled: runtimeEnabled,
}));

import { createRequestCustomerReview } from "./request-customer-review";
import { SupabaseCustomerReviewRepository } from "./supabase-customer-review";

const reviewId = "11111111-1111-4111-8111-111111111111";
const laterReviewId = "22222222-2222-4222-8222-222222222222";
const affectedPublicSlug = "cottage-deadbeefdeadbeefdeadbeefdead0029";

function clientWith(data: unknown, error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) };
}

describe("Supabase Customer review repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeEnabled.mockReturnValue(true);
  });
  it("submits the original review through the request-authorized RPC", async () => {
    const client = clientWith({
      status: "submitted",
      reviewId,
      submittedAt: "2026-09-21T12:00:00.000Z",
      affectedPublicSlug,
    });
    const repository = new SupabaseCustomerReviewRepository(client as never);

    await expect(
      repository.submit({
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        rating: 5,
        originalLanguage: "ar",
        originalBody: "إقامة هادئة وجميلة",
      }),
    ).resolves.toEqual({
      status: "submitted",
      reviewId,
      submittedAt: "2026-09-21T12:00:00.000Z",
      affectedPublicSlug,
    });
    expect(client.rpc).toHaveBeenCalledWith("submit_customer_review", {
      target_reference: "RC-REQ-0123456789ABCDEF",
      target_rating: 5,
      target_original_language: "ar",
      target_original_body: "إقامة هادئة وجميلة",
    });
  });

  it("accepts only exact authoritative targets on newly committed mutations", async () => {
    const submitted = {
      status: "submitted",
      reviewId,
      submittedAt: "2026-09-21T12:00:00.000Z",
      affectedPublicSlug,
    };
    const submitInput = {
      bookingRequestReference: "RC-REQ-0123456789ABCDEF",
      rating: 5,
      originalLanguage: "en",
      originalBody: null,
    } as const;
    for (const malformed of [
      { ...submitted, affectedPublicSlug: null },
      { ...submitted, affectedPublicSlug: "not-a-slug" },
      { ...submitted, extra: "private" },
      {
        status: "submitted",
        reviewId,
        submittedAt: submitted.submittedAt,
      },
    ]) {
      await expect(
        new SupabaseCustomerReviewRepository(
          clientWith(malformed) as never,
        ).submit(submitInput),
      ).resolves.toEqual({ status: "unavailable" });
    }

    const hidden = {
      status: "hidden",
      reviewId,
      administratorUserId: "55555555-5555-4555-8555-555555555555",
      reason: "Required reason",
      hiddenAt: "2026-09-21T12:30:00.000Z",
      affectedPublicSlug,
      affectedBookingRequestReference: "RC-REQ-FEDCBA9876543210",
    };
    await expect(
      new SupabaseCustomerReviewRepository(clientWith(hidden) as never).hide({
        reviewId,
        reason: "Required reason",
      }),
    ).resolves.toEqual(hidden);
    for (const malformed of [
      { ...hidden, affectedPublicSlug: null },
      { ...hidden, affectedPublicSlug: "not-a-slug" },
      { ...hidden, affectedBookingRequestReference: null },
      { ...hidden, affectedBookingRequestReference: "not-a-reference" },
      { ...hidden, extra: "private" },
      {
        status: "hidden",
        reviewId,
        administratorUserId: hidden.administratorUserId,
        reason: hidden.reason,
        hiddenAt: hidden.hiddenAt,
      },
    ]) {
      await expect(
        new SupabaseCustomerReviewRepository(
          clientWith(malformed) as never,
        ).hide({ reviewId, reason: "Required reason" }),
      ).resolves.toEqual({ status: "unavailable" });
    }
  });

  it("lists only the fixed public projection and rejects private-field payloads", async () => {
    const publicItem = {
      reviewId,
      rating: 4,
      originalLanguage: "ckb",
      originalBody: null,
      submittedAt: "2026-09-21T11:00:00.000Z",
    };
    const client = clientWith({
      status: "success",
      items: [publicItem],
      nextCursor: {
        submittedAt: publicItem.submittedAt,
        reviewId: laterReviewId,
      },
    });
    const repository = new SupabaseCustomerReviewRepository(client as never);

    await expect(
      repository.listPublic({
        publicSlug: "cottage-00000000000040008000000000000029",
        beforeAt: null,
        beforeId: null,
        limit: 20,
      }),
    ).resolves.toEqual({
      status: "success",
      items: [publicItem],
      nextCursor: {
        submittedAt: publicItem.submittedAt,
        reviewId: laterReviewId,
      },
    });
    expect(client.rpc).toHaveBeenCalledWith("list_public_customer_reviews", {
      target_slug: "cottage-00000000000040008000000000000029",
      target_before_at: null,
      target_before_id: null,
      target_limit: 20,
    });

    const leakingClient = clientWith({
      status: "success",
      items: [{ ...publicItem, authorUserId: laterReviewId }],
      nextCursor: null,
    });
    await expect(
      new SupabaseCustomerReviewRepository(leakingClient as never).listPublic({
        publicSlug: "cottage-00000000000040008000000000000029",
        beforeAt: null,
        beforeId: null,
        limit: 20,
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("reads the caller's review without accepting an actor identifier", async () => {
    const submitted = {
      status: "submitted",
      reviewId,
      rating: 3,
      originalLanguage: "en",
      originalBody: "A calm stay.",
      submittedAt: "2026-09-21T10:00:00.000Z",
      moderationState: "hidden",
    };
    const client = clientWith(submitted);
    const repository = new SupabaseCustomerReviewRepository(client as never);

    await expect(repository.getOwn("RC-REQ-0123456789ABCDEF")).resolves.toEqual(
      submitted,
    );
    expect(client.rpc).toHaveBeenCalledWith("get_customer_review", {
      target_reference: "RC-REQ-0123456789ABCDEF",
    });

    const eligibleClient = clientWith({
      status: "eligible",
      reviewExpiresAt: "2026-10-05T10:00:00.000Z",
    });
    await expect(
      new SupabaseCustomerReviewRepository(eligibleClient as never).getOwn(
        "RC-REQ-0123456789ABCDEF",
      ),
    ).resolves.toEqual({
      status: "eligible",
      reviewExpiresAt: "2026-10-05T10:00:00.000Z",
    });
  });

  it("lists the fixed administrator projection through the aal2 RPC", async () => {
    const item = {
      reviewId,
      bookingRequestReference: "RC-REQ-0123456789ABCDEF",
      profileId: "33333333-3333-4333-8333-333333333333",
      authorUserId: "44444444-4444-4444-8444-444444444444",
      rating: 2,
      originalLanguage: "ar",
      originalBody: "مراجعة",
      submittedAt: "2026-09-21T09:00:00.000Z",
      moderationState: "hidden",
      hide: {
        administratorUserId: "55555555-5555-4555-8555-555555555555",
        reason: "Contains personal contact details",
        hiddenAt: "2026-09-21T09:30:00.000Z",
      },
    };
    const client = clientWith({
      status: "success",
      items: [item],
      nextCursor: null,
    });
    const repository = new SupabaseCustomerReviewRepository(client as never);

    await expect(
      repository.listAdministrator({
        beforeAt: "2026-09-22T00:00:00.000Z",
        beforeId: laterReviewId,
        limit: 50,
      }),
    ).resolves.toEqual({ status: "success", items: [item], nextCursor: null });
    expect(client.rpc).toHaveBeenCalledWith(
      "list_administrator_customer_reviews",
      {
        target_before_at: "2026-09-22T00:00:00.000Z",
        target_before_id: laterReviewId,
        target_limit: 50,
      },
    );
  });

  it("hides through the administrator RPC and retains database attribution", async () => {
    const hidden = {
      status: "already-hidden",
      reviewId,
      administratorUserId: "55555555-5555-4555-8555-555555555555",
      reason: "First moderation reason",
      hiddenAt: "2026-09-21T09:30:00.000Z",
    };
    const client = clientWith(hidden);
    const repository = new SupabaseCustomerReviewRepository(client as never);

    await expect(
      repository.hide({
        reviewId,
        reason: "A later reason that must not replace attribution",
      }),
    ).resolves.toEqual(hidden);
    expect(client.rpc).toHaveBeenCalledWith("hide_customer_review", {
      target_review_id: reviewId,
      target_reason: "A later reason that must not replace attribution",
    });
  });

  it("uses the anonymous or authenticated request client for all five operations", async () => {
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "66666666-6666-4666-8666-666666666666" } },
          error: null,
        }),
      },
      rpc: vi.fn().mockResolvedValue({
        data: { status: "not-found" },
        error: null,
      }),
    };
    createRequestClient.mockResolvedValue(client);

    const request = await createRequestCustomerReview();
    expect(request).toBeDefined();
    await expect(request?.authenticatedUserId()).resolves.toBe(
      "66666666-6666-4666-8666-666666666666",
    );
    await expect(
      request?.listPublic({
        publicSlug: "cottage-00000000000040008000000000000028",
        beforeAt: null,
        beforeId: null,
        limit: 20,
      }),
    ).resolves.toEqual({ status: "not-found" });
    expect(createRequestClient).toHaveBeenCalledOnce();
    expect(client.rpc).toHaveBeenCalledWith(
      "list_public_customer_reviews",
      expect.any(Object),
    );

    runtimeEnabled.mockReturnValue(false);
    await expect(createRequestCustomerReview()).resolves.toBeUndefined();
  });

  it("rejects malformed UUID, date, integer, body, reference, and cursor inputs before RPC", async () => {
    const client = clientWith({ status: "invalid" });
    const repository = new SupabaseCustomerReviewRepository(client as never);

    await expect(
      repository.submit({
        bookingRequestReference: "not-a-reference",
        rating: 3.5,
        originalLanguage: "en",
        originalBody: "x".repeat(2001),
      } as never),
    ).resolves.toEqual({ status: "invalid" });
    await expect(repository.getOwn("not-a-reference")).resolves.toEqual({
      status: "invalid",
    });
    await expect(
      repository.listPublic({
        publicSlug: "not-a-slug",
        beforeAt: "not-a-date",
        beforeId: reviewId,
        limit: 0,
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      repository.listAdministrator({
        beforeAt: null,
        beforeId: reviewId,
        limit: 51,
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      repository.hide({ reviewId: "not-a-uuid", reason: " " }),
    ).resolves.toEqual({ status: "invalid" });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("maps database denials and exact outcomes without treating empty or malformed as success", async () => {
    const denied = new SupabaseCustomerReviewRepository(
      clientWith(null, { code: "42501" }) as never,
    );
    await expect(
      denied.submit({
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        rating: 4,
        originalLanguage: "en",
        originalBody: null,
      }),
    ).resolves.toEqual({ status: "access-required" });
    await expect(
      denied.listAdministrator({ beforeAt: null, beforeId: null, limit: 50 }),
    ).resolves.toEqual({ status: "access-required" });

    for (const status of [
      "invalid",
      "ineligible",
      "prohibited-content",
    ] as const) {
      const repository = new SupabaseCustomerReviewRepository(
        clientWith({ status }) as never,
      );
      await expect(
        repository.submit({
          bookingRequestReference: "RC-REQ-0123456789ABCDEF",
          rating: 4,
          originalLanguage: "en",
          originalBody: null,
        }),
      ).resolves.toEqual({ status });
    }

    const empty = new SupabaseCustomerReviewRepository(
      clientWith({ status: "success", items: [], nextCursor: null }) as never,
    );
    await expect(
      empty.listPublic({
        publicSlug: "cottage-00000000000040008000000000000029",
        beforeAt: null,
        beforeId: null,
        limit: 20,
      }),
    ).resolves.toEqual({ status: "success", items: [], nextCursor: null });

    const malformed = new SupabaseCustomerReviewRepository(
      clientWith({
        status: "submitted",
        reviewId,
        submittedAt: "yesterday",
      }) as never,
    );
    await expect(
      malformed.submit({
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        rating: 4,
        originalLanguage: "en",
        originalBody: null,
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("maps a lost response to unavailable for every RPC operation", async () => {
    const client = {
      rpc: vi.fn().mockRejectedValue(new Error("network lost")),
    };
    const repository = new SupabaseCustomerReviewRepository(client as never);

    await expect(
      repository.submit({
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        rating: 4,
        originalLanguage: "en",
        originalBody: null,
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      repository.listPublic({
        publicSlug: "cottage-00000000000040008000000000000029",
        beforeAt: null,
        beforeId: null,
        limit: 20,
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(repository.getOwn("RC-REQ-0123456789ABCDEF")).resolves.toEqual(
      { status: "unavailable" },
    );
    await expect(
      repository.listAdministrator({
        beforeAt: null,
        beforeId: null,
        limit: 50,
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      repository.hide({ reviewId, reason: "Moderation reason" }),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
