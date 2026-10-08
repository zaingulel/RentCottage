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
      ownerReply: null,
    };
    const ownerReply = {
      originalLanguage: "ar",
      originalBody: "شكراً لزيارتكم",
      submittedAt: "2026-09-22T08:00:00.000Z",
    };
    const repliedItem = {
      reviewId: laterReviewId,
      rating: 5,
      originalLanguage: "en",
      originalBody: "A calm stay.",
      submittedAt: "2026-09-21T10:00:00.000Z",
      ownerReply,
    };
    const client = clientWith({
      status: "success",
      items: [publicItem, repliedItem],
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
      items: [
        {
          reviewId,
          rating: 4,
          originalLanguage: "ckb",
          originalBody: null,
          submittedAt: "2026-09-21T11:00:00.000Z",
          ownerReply: null,
        },
        {
          reviewId: laterReviewId,
          rating: 5,
          originalLanguage: "en",
          originalBody: "A calm stay.",
          submittedAt: "2026-09-21T10:00:00.000Z",
          ownerReply: {
            originalLanguage: "ar",
            originalBody: "شكراً لزيارتكم",
            submittedAt: "2026-09-22T08:00:00.000Z",
          },
        },
      ],
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

    for (const rejectedItem of [
      { ...publicItem, authorUserId: laterReviewId },
      {
        reviewId,
        rating: 4,
        originalLanguage: "ckb",
        originalBody: null,
        submittedAt: "2026-09-21T11:00:00.000Z",
      },
      {
        ...repliedItem,
        ownerReply: { ...ownerReply, authorUserId: laterReviewId },
      },
      {
        ...repliedItem,
        ownerReply: { ...ownerReply, moderationState: "unhidden" },
      },
      { ...repliedItem, ownerReply: { ...ownerReply, originalBody: "" } },
      { ...repliedItem, ownerReply: { ...ownerReply, originalBody: null } },
      {
        ...repliedItem,
        ownerReply: {
          originalLanguage: "ar",
          originalBody: "شكراً لزيارتكم",
        },
      },
      { ...repliedItem, ownerReply: "شكراً لزيارتكم" },
    ]) {
      await expect(
        new SupabaseCustomerReviewRepository(
          clientWith({
            status: "success",
            items: [rejectedItem],
            nextCursor: null,
          }) as never,
        ).listPublic({
          publicSlug: "cottage-00000000000040008000000000000029",
          beforeAt: null,
          beforeId: null,
          limit: 20,
        }),
      ).resolves.toEqual({ status: "unavailable" });
    }
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

  it("reads the owner's view of a review without accepting an actor identifier", async () => {
    const reply = {
      originalLanguage: "ckb",
      originalBody: "سوپاس بۆ سەردانەکەتان",
      submittedAt: "2026-09-22T08:00:00.000Z",
      moderationState: "hidden",
    };
    const reviewed = {
      status: "reviewed",
      rating: 3,
      originalLanguage: "en",
      originalBody: "A calm stay.",
      submittedAt: "2026-09-21T10:00:00.000Z",
      reply,
    };
    const client = clientWith(reviewed);
    const repository = new SupabaseCustomerReviewRepository(client as never);

    await expect(
      repository.getOwnerReview("RC-REQ-0123456789ABCDEF"),
    ).resolves.toEqual({
      status: "reviewed",
      rating: 3,
      originalLanguage: "en",
      originalBody: "A calm stay.",
      submittedAt: "2026-09-21T10:00:00.000Z",
      reply: {
        originalLanguage: "ckb",
        originalBody: "سوپاس بۆ سەردانەکەتان",
        submittedAt: "2026-09-22T08:00:00.000Z",
        moderationState: "hidden",
      },
    });
    expect(client.rpc).toHaveBeenCalledWith("get_owner_customer_review", {
      target_reference: "RC-REQ-0123456789ABCDEF",
    });

    const read = (payload: unknown) =>
      new SupabaseCustomerReviewRepository(
        clientWith(payload) as never,
      ).getOwnerReview("RC-REQ-0123456789ABCDEF");
    await expect(
      read({ ...reviewed, originalBody: null, reply: null }),
    ).resolves.toEqual({
      status: "reviewed",
      rating: 3,
      originalLanguage: "en",
      originalBody: null,
      submittedAt: "2026-09-21T10:00:00.000Z",
      reply: null,
    });
    await expect(read({ status: "review-hidden", reply })).resolves.toEqual({
      status: "review-hidden",
      reply: {
        originalLanguage: "ckb",
        originalBody: "سوپاس بۆ سەردانەکەتان",
        submittedAt: "2026-09-22T08:00:00.000Z",
        moderationState: "hidden",
      },
    });
    await expect(
      read({ status: "review-hidden", reply: null }),
    ).resolves.toEqual({ status: "review-hidden", reply: null });
    await expect(read({ status: "no-review" })).resolves.toEqual({
      status: "no-review",
    });

    for (const malformed of [
      { ...reviewed, reviewId },
      { ...reviewed, authorUserId: "44444444-4444-4444-8444-444444444444" },
      { ...reviewed, rating: 6 },
      {
        status: "reviewed",
        rating: 3,
        originalLanguage: "en",
        originalBody: "A calm stay.",
        submittedAt: "2026-09-21T10:00:00.000Z",
      },
      { ...reviewed, reply: { ...reply, moderationState: "removed" } },
      { ...reviewed, reply: { ...reply, reason: "Hide reason" } },
      { ...reviewed, reply: { ...reply, originalBody: "" } },
      {
        ...reviewed,
        reply: {
          originalLanguage: "ckb",
          originalBody: "سوپاس بۆ سەردانەکەتان",
          submittedAt: "2026-09-22T08:00:00.000Z",
        },
      },
      { status: "review-hidden" },
      { status: "review-hidden", reply, originalBody: "A calm stay." },
      { status: "no-review", reply: null },
      { status: "access-required" },
      null,
    ]) {
      await expect(read(malformed)).resolves.toEqual({ status: "unavailable" });
    }

    const unreached = clientWith(reviewed);
    await expect(
      new SupabaseCustomerReviewRepository(unreached as never).getOwnerReview(
        "not-a-reference",
      ),
    ).resolves.toEqual({ status: "invalid" });
    expect(unreached.rpc).not.toHaveBeenCalled();
  });

  it("replies through the request-authorized RPC and accepts only exact mutation results", async () => {
    const replied = {
      status: "replied",
      reviewId,
      submittedAt: "2026-09-22T08:00:00.000Z",
      affectedPublicSlug,
    };
    const replyInput = {
      bookingRequestReference: "RC-REQ-0123456789ABCDEF",
      originalLanguage: "ar",
      originalBody: "شكراً لزيارتكم",
    } as const;
    const client = clientWith(replied);

    await expect(
      new SupabaseCustomerReviewRepository(client as never).submitReply(
        replyInput,
      ),
    ).resolves.toEqual({
      status: "replied",
      reviewId,
      submittedAt: "2026-09-22T08:00:00.000Z",
      affectedPublicSlug,
    });
    expect(client.rpc).toHaveBeenCalledWith("submit_customer_review_reply", {
      target_reference: "RC-REQ-0123456789ABCDEF",
      target_original_language: "ar",
      target_original_body: "شكراً لزيارتكم",
    });

    const reply = (payload: unknown) =>
      new SupabaseCustomerReviewRepository(
        clientWith(payload) as never,
      ).submitReply(replyInput);
    await expect(
      reply({
        status: "duplicate",
        reviewId,
        submittedAt: "2026-09-22T08:00:00.000Z",
      }),
    ).resolves.toEqual({
      status: "duplicate",
      reviewId,
      submittedAt: "2026-09-22T08:00:00.000Z",
    });

    for (const malformed of [
      { ...replied, affectedPublicSlug: null },
      { ...replied, affectedPublicSlug: "not-a-slug" },
      { ...replied, authorUserId: "44444444-4444-4444-8444-444444444444" },
      { ...replied, status: "submitted" },
      {
        status: "replied",
        reviewId,
        submittedAt: "2026-09-22T08:00:00.000Z",
      },
      {
        status: "duplicate",
        reviewId,
        submittedAt: "2026-09-22T08:00:00.000Z",
        originalBody: "شكراً لزيارتكم",
      },
      { status: "ineligible", reviewId },
      { status: "unavailable" },
      null,
    ]) {
      await expect(reply(malformed)).resolves.toEqual({
        status: "unavailable",
      });
    }

    const unreached = clientWith(replied);
    const unreachedRepository = new SupabaseCustomerReviewRepository(
      unreached as never,
    );
    await expect(
      unreachedRepository.submitReply({ ...replyInput, originalBody: "  " }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      unreachedRepository.submitReply({
        ...replyInput,
        authorUserId: "44444444-4444-4444-8444-444444444444",
      } as never),
    ).resolves.toEqual({ status: "invalid" });
    expect(unreached.rpc).not.toHaveBeenCalled();
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
      reply: null,
    };
    const hiddenReply = {
      authorUserId: "66666666-6666-4666-8666-666666666666",
      originalLanguage: "en",
      originalBody: "Thank you for staying with us.",
      submittedAt: "2026-09-21T09:10:00.000Z",
      moderationState: "hidden",
      hide: {
        administratorUserId: "55555555-5555-4555-8555-555555555555",
        reason: "Reply names another guest",
        hiddenAt: "2026-09-21T09:40:00.000Z",
      },
    };
    const repliedItem = {
      ...item,
      reviewId: laterReviewId,
      moderationState: "unhidden",
      hide: null,
      reply: hiddenReply,
    };
    const client = clientWith({
      status: "success",
      items: [item, repliedItem],
      nextCursor: null,
    });
    const repository = new SupabaseCustomerReviewRepository(client as never);

    await expect(
      repository.listAdministrator({
        beforeAt: "2026-09-22T00:00:00.000Z",
        beforeId: laterReviewId,
        limit: 50,
      }),
    ).resolves.toEqual({
      status: "success",
      items: [
        item,
        {
          reviewId: laterReviewId,
          bookingRequestReference: "RC-REQ-0123456789ABCDEF",
          profileId: "33333333-3333-4333-8333-333333333333",
          authorUserId: "44444444-4444-4444-8444-444444444444",
          rating: 2,
          originalLanguage: "ar",
          originalBody: "مراجعة",
          submittedAt: "2026-09-21T09:00:00.000Z",
          moderationState: "unhidden",
          hide: null,
          reply: {
            authorUserId: "66666666-6666-4666-8666-666666666666",
            originalLanguage: "en",
            originalBody: "Thank you for staying with us.",
            submittedAt: "2026-09-21T09:10:00.000Z",
            moderationState: "hidden",
            hide: {
              administratorUserId: "55555555-5555-4555-8555-555555555555",
              reason: "Reply names another guest",
              hiddenAt: "2026-09-21T09:40:00.000Z",
            },
          },
        },
      ],
      nextCursor: null,
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "list_administrator_customer_reviews",
      {
        target_before_at: "2026-09-22T00:00:00.000Z",
        target_before_id: laterReviewId,
        target_limit: 50,
      },
    );

    const list = (rejectedItem: unknown) =>
      new SupabaseCustomerReviewRepository(
        clientWith({
          status: "success",
          items: [rejectedItem],
          nextCursor: null,
        }) as never,
      ).listAdministrator({ beforeAt: null, beforeId: null, limit: 50 });
    await expect(
      list({
        ...repliedItem,
        reply: { ...hiddenReply, moderationState: "unhidden", hide: null },
      }),
    ).resolves.toMatchObject({ status: "success" });
    for (const rejectedItem of [
      {
        reviewId,
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        profileId: "33333333-3333-4333-8333-333333333333",
        authorUserId: "44444444-4444-4444-8444-444444444444",
        rating: 2,
        originalLanguage: "ar",
        originalBody: "مراجعة",
        submittedAt: "2026-09-21T09:00:00.000Z",
        moderationState: "hidden",
        hide: item.hide,
      },
      { ...repliedItem, reply: { ...hiddenReply, hide: null } },
      {
        ...repliedItem,
        reply: { ...hiddenReply, moderationState: "unhidden" },
      },
      { ...repliedItem, reply: { ...hiddenReply, authorUserId: "owner" } },
      { ...repliedItem, reply: { ...hiddenReply, originalBody: "" } },
      { ...repliedItem, reply: { ...hiddenReply, phone: "+9647500000000" } },
    ]) {
      await expect(list(rejectedItem)).resolves.toEqual({
        status: "unavailable",
      });
    }
  });

  it("validates database review bodies by Unicode code point across every response parser", async () => {
    const acceptedBody = "🏡".repeat(2000);
    const rejectedBody = "🏡".repeat(2001);
    const publicResponse = (originalBody: string) => ({
      status: "success",
      items: [
        {
          reviewId,
          rating: 4,
          originalLanguage: "en",
          originalBody,
          submittedAt: "2026-09-21T11:00:00.000Z",
          ownerReply: {
            originalLanguage: "en",
            originalBody,
            submittedAt: "2026-09-21T12:00:00.000Z",
          },
        },
      ],
      nextCursor: null,
    });
    const ownerResponse = (originalBody: string) => ({
      status: "reviewed",
      rating: 4,
      originalLanguage: "en",
      originalBody,
      submittedAt: "2026-09-21T11:00:00.000Z",
      reply: {
        originalLanguage: "en",
        originalBody,
        submittedAt: "2026-09-21T12:00:00.000Z",
        moderationState: "unhidden",
      },
    });
    const ownResponse = (originalBody: string) => ({
      status: "submitted",
      reviewId,
      rating: 4,
      originalLanguage: "en",
      originalBody,
      submittedAt: "2026-09-21T11:00:00.000Z",
      moderationState: "unhidden",
    });
    const administratorResponse = (originalBody: string) => ({
      status: "success",
      items: [
        {
          reviewId,
          bookingRequestReference: "RC-REQ-0123456789ABCDEF",
          profileId: "33333333-3333-4333-8333-333333333333",
          authorUserId: "44444444-4444-4444-8444-444444444444",
          rating: 4,
          originalLanguage: "en",
          originalBody,
          submittedAt: "2026-09-21T11:00:00.000Z",
          moderationState: "unhidden",
          hide: null,
          reply: {
            authorUserId: "66666666-6666-4666-8666-666666666666",
            originalLanguage: "en",
            originalBody,
            submittedAt: "2026-09-21T12:00:00.000Z",
            moderationState: "unhidden",
            hide: null,
          },
        },
      ],
      nextCursor: null,
    });
    const withShortReviewBody = <
      Item extends Readonly<{ originalBody: string }>,
    >(
      item: Item,
    ) => ({ ...item, originalBody: "A calm stay." });
    const getOwnerReview = (payload: unknown) =>
      new SupabaseCustomerReviewRepository(
        clientWith(payload) as never,
      ).getOwnerReview("RC-REQ-0123456789ABCDEF");
    const listPublicPayload = (payload: unknown) =>
      new SupabaseCustomerReviewRepository(
        clientWith(payload) as never,
      ).listPublic({
        publicSlug: "cottage-00000000000040008000000000000029",
        beforeAt: null,
        beforeId: null,
        limit: 20,
      });
    const listAdministratorPayload = (payload: unknown) =>
      new SupabaseCustomerReviewRepository(
        clientWith(payload) as never,
      ).listAdministrator({ beforeAt: null, beforeId: null, limit: 50 });
    const listPublic = (originalBody: string) =>
      new SupabaseCustomerReviewRepository(
        clientWith(publicResponse(originalBody)) as never,
      ).listPublic({
        publicSlug: "cottage-00000000000040008000000000000029",
        beforeAt: null,
        beforeId: null,
        limit: 20,
      });
    const getOwn = (originalBody: string) =>
      new SupabaseCustomerReviewRepository(
        clientWith(ownResponse(originalBody)) as never,
      ).getOwn("RC-REQ-0123456789ABCDEF");
    const listAdministrator = (originalBody: string) =>
      new SupabaseCustomerReviewRepository(
        clientWith(administratorResponse(originalBody)) as never,
      ).listAdministrator({ beforeAt: null, beforeId: null, limit: 50 });

    expect(Array.from(acceptedBody)).toHaveLength(2000);
    await expect(listPublic(acceptedBody)).resolves.toEqual(
      publicResponse(acceptedBody),
    );
    await expect(getOwn(acceptedBody)).resolves.toEqual(
      ownResponse(acceptedBody),
    );
    await expect(listAdministrator(acceptedBody)).resolves.toEqual(
      administratorResponse(acceptedBody),
    );

    expect(Array.from(rejectedBody)).toHaveLength(2001);
    await expect(listPublic(rejectedBody)).resolves.toEqual({
      status: "unavailable",
    });
    await expect(getOwn(rejectedBody)).resolves.toEqual({
      status: "unavailable",
    });
    await expect(listAdministrator(rejectedBody)).resolves.toEqual({
      status: "unavailable",
    });

    await expect(getOwnerReview(ownerResponse(acceptedBody))).resolves.toEqual(
      ownerResponse(acceptedBody),
    );
    await expect(getOwnerReview(ownerResponse(rejectedBody))).resolves.toEqual({
      status: "unavailable",
    });

    // An oversized reply alone, beside a review body that fits.
    const publicReplyOnly = publicResponse(rejectedBody);
    await expect(
      listPublicPayload({
        ...publicReplyOnly,
        items: publicReplyOnly.items.map(withShortReviewBody),
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      getOwnerReview(withShortReviewBody(ownerResponse(rejectedBody))),
    ).resolves.toEqual({ status: "unavailable" });
    const administratorReplyOnly = administratorResponse(rejectedBody);
    await expect(
      listAdministratorPayload({
        ...administratorReplyOnly,
        items: administratorReplyOnly.items.map(withShortReviewBody),
      }),
    ).resolves.toEqual({ status: "unavailable" });
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

  it("hides a reply through the administrator RPC and retains database attribution", async () => {
    const hidden = {
      status: "hidden",
      reviewId,
      administratorUserId: "55555555-5555-4555-8555-555555555555",
      reason: "Reply names another guest",
      hiddenAt: "2026-09-22T09:30:00.000Z",
      affectedPublicSlug,
      affectedBookingRequestReference: "RC-REQ-FEDCBA9876543210",
    };
    const client = clientWith(hidden);

    await expect(
      new SupabaseCustomerReviewRepository(client as never).hideReply({
        reviewId,
        reason: "Reply names another guest",
      }),
    ).resolves.toEqual({
      status: "hidden",
      reviewId,
      administratorUserId: "55555555-5555-4555-8555-555555555555",
      reason: "Reply names another guest",
      hiddenAt: "2026-09-22T09:30:00.000Z",
      affectedPublicSlug,
      affectedBookingRequestReference: "RC-REQ-FEDCBA9876543210",
    });
    expect(client.rpc).toHaveBeenCalledWith("hide_customer_review_reply", {
      target_review_id: reviewId,
      target_reason: "Reply names another guest",
    });

    const hideReply = (payload: unknown) =>
      new SupabaseCustomerReviewRepository(
        clientWith(payload) as never,
      ).hideReply({
        reviewId,
        reason: "A later reason that must not replace attribution",
      });
    await expect(
      hideReply({
        status: "already-hidden",
        reviewId,
        administratorUserId: "55555555-5555-4555-8555-555555555555",
        reason: "Reply names another guest",
        hiddenAt: "2026-09-22T09:30:00.000Z",
      }),
    ).resolves.toEqual({
      status: "already-hidden",
      reviewId,
      administratorUserId: "55555555-5555-4555-8555-555555555555",
      reason: "Reply names another guest",
      hiddenAt: "2026-09-22T09:30:00.000Z",
    });
    await expect(hideReply({ status: "invalid" })).resolves.toEqual({
      status: "invalid",
    });
    for (const malformed of [
      { ...hidden, affectedBookingRequestReference: null },
      { ...hidden, affectedPublicSlug: "not-a-slug" },
      { ...hidden, authorUserId: "66666666-6666-4666-8666-666666666666" },
      { ...hidden, administratorUserId: "administrator" },
      { status: "unavailable" },
    ]) {
      await expect(hideReply(malformed)).resolves.toEqual({
        status: "unavailable",
      });
    }

    const unreached = clientWith(hidden);
    await expect(
      new SupabaseCustomerReviewRepository(unreached as never).hideReply({
        reviewId: "not-a-uuid",
        reason: " ",
      }),
    ).resolves.toEqual({ status: "invalid" });
    expect(unreached.rpc).not.toHaveBeenCalled();
  });

  it("uses the anonymous or authenticated request client for all eight operations", async () => {
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

    await request?.submit({
      bookingRequestReference: "RC-REQ-0123456789ABCDEF",
      rating: 4,
      originalLanguage: "en",
      originalBody: null,
    });
    await request?.getOwn("RC-REQ-0123456789ABCDEF");
    await request?.listAdministrator({
      beforeAt: null,
      beforeId: null,
      limit: 50,
    });
    await request?.hide({ reviewId, reason: "Moderation reason" });
    await request?.getOwnerReview("RC-REQ-0123456789ABCDEF");
    await request?.submitReply({
      bookingRequestReference: "RC-REQ-0123456789ABCDEF",
      originalLanguage: "en",
      originalBody: "Thank you for staying with us.",
    });
    await request?.hideReply({ reviewId, reason: "Moderation reason" });
    expect(client.rpc.mock.calls.map(([name]) => name)).toEqual([
      "list_public_customer_reviews",
      "submit_customer_review",
      "get_customer_review",
      "list_administrator_customer_reviews",
      "hide_customer_review",
      "get_owner_customer_review",
      "submit_customer_review_reply",
      "hide_customer_review_reply",
    ]);
    expect(createRequestClient).toHaveBeenCalledOnce();

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
    await expect(
      denied.getOwnerReview("RC-REQ-0123456789ABCDEF"),
    ).resolves.toEqual({ status: "access-required" });
    await expect(
      denied.submitReply({
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        originalLanguage: "en",
        originalBody: "Thank you for staying with us.",
      }),
    ).resolves.toEqual({ status: "access-required" });
    await expect(
      denied.hideReply({ reviewId, reason: "Moderation reason" }),
    ).resolves.toEqual({ status: "access-required" });

    const failed = new SupabaseCustomerReviewRepository(
      clientWith(null, { code: "XX000" }) as never,
    );
    await expect(
      failed.getOwnerReview("RC-REQ-0123456789ABCDEF"),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      failed.submitReply({
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        originalLanguage: "en",
        originalBody: "Thank you for staying with us.",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      failed.hideReply({ reviewId, reason: "Moderation reason" }),
    ).resolves.toEqual({ status: "unavailable" });

    for (const status of [
      "invalid",
      "ineligible",
      "prohibited-content",
    ] as const) {
      const repository = new SupabaseCustomerReviewRepository(
        clientWith({ status }) as never,
      );
      await expect(
        repository.submitReply({
          bookingRequestReference: "RC-REQ-0123456789ABCDEF",
          originalLanguage: "en",
          originalBody: "Thank you for staying with us.",
        }),
      ).resolves.toEqual({ status });
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
    await expect(
      repository.getOwnerReview("RC-REQ-0123456789ABCDEF"),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      repository.submitReply({
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        originalLanguage: "en",
        originalBody: "Thank you for staying with us.",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      repository.hideReply({ reviewId, reason: "Moderation reason" }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(client.rpc).toHaveBeenCalledTimes(8);
  });
});
