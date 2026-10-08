import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRequestReview, revalidatePath } = vi.hoisted(() => ({
  createRequestReview: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("./request-customer-review", () => ({
  createRequestCustomerReview: createRequestReview,
}));

import {
  hideCustomerReview,
  hideCustomerReviewReply,
  submitCustomerReview,
  submitCustomerReviewReply,
} from "./actions";

const affectedPublicSlug = "cottage-deadbeefdeadbeefdeadbeefdead0029";
const affectedBookingReference = "RC-REQ-FEDCBA9876543210";
const distractorPublicSlug = "cottage-00000000000040008000000000000029";

const validSubmission = {
  bookingRequestReference: "RC-REQ-0123456789ABCDEF",
  rating: 5,
  originalLanguage: "ckb",
  originalBody: null,
} as const;

const validReply = {
  bookingRequestReference: "RC-REQ-0123456789ABCDEF",
  originalLanguage: "ar",
  originalBody: "شكراً لزيارتكم",
} as const;

describe("Customer review Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid, unknown, and supplied-actor input before request work", async () => {
    await expect(
      submitCustomerReview({ ...validSubmission, locale: "en" }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      submitCustomerReview({
        ...validSubmission,
        actorUserId: "77777777-7777-4777-8777-777777777777",
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      submitCustomerReview({
        ...validSubmission,
        publicSlug: distractorPublicSlug,
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      submitCustomerReview({
        ...validSubmission,
        affectedPublicSlug,
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      hideCustomerReview({
        reviewId: "11111111-1111-4111-8111-111111111111",
        reason: "Reason",
        locale: "en",
        administratorUserId: "55555555-5555-4555-8555-555555555555",
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      hideCustomerReview({
        reviewId: "11111111-1111-4111-8111-111111111111",
        reason: "Reason",
        publicSlug: distractorPublicSlug,
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        affectedPublicSlug,
        affectedBookingRequestReference: affectedBookingReference,
      }),
    ).resolves.toEqual({ status: "invalid" });
    expect(createRequestReview).not.toHaveBeenCalled();
  });

  it("rechecks session identity and revalidates affected review paths after submission", async () => {
    const authenticatedUserId = vi
      .fn()
      .mockResolvedValue("77777777-7777-4777-8777-777777777777");
    const submit = vi.fn().mockResolvedValue({
      status: "submitted",
      reviewId: "11111111-1111-4111-8111-111111111111",
      submittedAt: "2026-09-21T12:00:00.000Z",
      affectedPublicSlug,
    });
    createRequestReview.mockResolvedValue({ authenticatedUserId, submit });

    await expect(submitCustomerReview(validSubmission)).resolves.toEqual({
      status: "submitted",
      reviewId: "11111111-1111-4111-8111-111111111111",
      submittedAt: "2026-09-21T12:00:00.000Z",
    });
    expect(authenticatedUserId).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith({
      bookingRequestReference: "RC-REQ-0123456789ABCDEF",
      rating: 5,
      originalLanguage: "ckb",
      originalBody: null,
    });
    expect(revalidatePath).toHaveBeenCalledTimes(12);
    expect(revalidatePath.mock.calls).toContainEqual([
      "/ckb/booking-requests/RC-REQ-0123456789ABCDEF",
    ]);
    expect(revalidatePath.mock.calls).toContainEqual([
      `/ckb/cottages/${affectedPublicSlug}/reviews`,
    ]);
    expect(revalidatePath.mock.calls).toContainEqual([
      "/ckb/administrator/reviews",
    ]);
    expect(revalidatePath.mock.calls.flat()).not.toContain(
      `/ckb/cottages/${distractorPublicSlug}/reviews`,
    );
  });

  it("accepts a review body whose supplementary characters fit the database limit", async () => {
    const originalBody = "🏡".repeat(1001);
    const submit = vi.fn().mockResolvedValue({ status: "ineligible" });
    createRequestReview.mockResolvedValue({
      authenticatedUserId: vi.fn().mockResolvedValue("user-id"),
      submit,
    });

    await expect(
      submitCustomerReview({ ...validSubmission, originalBody }),
    ).resolves.toEqual({ status: "ineligible" });
    expect(originalBody).toHaveLength(2002);
    expect(submit).toHaveBeenCalledWith({
      ...validSubmission,
      originalBody,
    });
  });

  it("rejects a review body above the database character limit", async () => {
    await expect(
      submitCustomerReview({
        ...validSubmission,
        originalBody: "🏡".repeat(2001),
      }),
    ).resolves.toEqual({ status: "invalid" });
    expect(createRequestReview).not.toHaveBeenCalled();
  });

  it("rechecks administrator identity and revalidates only after a new hide", async () => {
    const authenticatedUserId = vi
      .fn()
      .mockResolvedValue("55555555-5555-4555-8555-555555555555");
    const hide = vi.fn().mockResolvedValue({
      status: "hidden",
      reviewId: "11111111-1111-4111-8111-111111111111",
      administratorUserId: "55555555-5555-4555-8555-555555555555",
      reason: "Contains personal contact details",
      hiddenAt: "2026-09-21T12:30:00.000Z",
      affectedPublicSlug,
      affectedBookingRequestReference: affectedBookingReference,
    });
    createRequestReview.mockResolvedValue({ authenticatedUserId, hide });

    await expect(
      hideCustomerReview({
        reviewId: "11111111-1111-4111-8111-111111111111",
        reason: "Contains personal contact details",
      }),
    ).resolves.toEqual({
      status: "hidden",
      reviewId: "11111111-1111-4111-8111-111111111111",
      administratorUserId: "55555555-5555-4555-8555-555555555555",
      reason: "Contains personal contact details",
      hiddenAt: "2026-09-21T12:30:00.000Z",
    });
    expect(hide).toHaveBeenCalledWith({
      reviewId: "11111111-1111-4111-8111-111111111111",
      reason: "Contains personal contact details",
    });
    expect(revalidatePath).toHaveBeenCalledTimes(12);
    expect(revalidatePath.mock.calls).toContainEqual([
      `/en/booking-requests/${affectedBookingReference}`,
    ]);
    expect(revalidatePath.mock.calls).toContainEqual([
      `/en/cottages/${affectedPublicSlug}/reviews`,
    ]);
    expect(revalidatePath.mock.calls).toContainEqual([
      "/en/administrator/reviews",
    ]);
    expect(revalidatePath.mock.calls.flat()).not.toContain(
      `/en/cottages/${distractorPublicSlug}/reviews`,
    );
  });

  it("preserves access, duplicate, prohibited, already-hidden, and unavailable recovery outcomes", async () => {
    const authenticatedUserId = vi
      .fn()
      .mockResolvedValue("77777777-7777-4777-8777-777777777777");
    const submit = vi
      .fn()
      .mockResolvedValueOnce({
        status: "duplicate",
        reviewId: "11111111-1111-4111-8111-111111111111",
        submittedAt: "2026-09-21T12:00:00.000Z",
      })
      .mockResolvedValueOnce({ status: "ineligible" })
      .mockResolvedValue({ status: "prohibited-content" });
    const hide = vi.fn().mockResolvedValue({
      status: "already-hidden",
      reviewId: "11111111-1111-4111-8111-111111111111",
      administratorUserId: "55555555-5555-4555-8555-555555555555",
      reason: "Original reason",
      hiddenAt: "2026-09-21T12:30:00.000Z",
    });
    createRequestReview.mockResolvedValue({
      authenticatedUserId,
      submit,
      hide,
    });

    await expect(submitCustomerReview(validSubmission)).resolves.toMatchObject({
      status: "duplicate",
    });
    await expect(submitCustomerReview(validSubmission)).resolves.toEqual({
      status: "ineligible",
    });
    await expect(submitCustomerReview(validSubmission)).resolves.toEqual({
      status: "prohibited-content",
    });
    await expect(
      hideCustomerReview({
        reviewId: "11111111-1111-4111-8111-111111111111",
        reason: "Later reason",
      }),
    ).resolves.toMatchObject({
      status: "already-hidden",
      reason: "Original reason",
    });
    expect(revalidatePath).not.toHaveBeenCalled();

    authenticatedUserId.mockResolvedValueOnce(undefined);
    await expect(submitCustomerReview(validSubmission)).resolves.toEqual({
      status: "access-required",
    });

    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    createRequestReview.mockRejectedValueOnce(
      new Error("secret review text and bearer-token-value"),
    );
    await expect(submitCustomerReview(validSubmission)).resolves.toEqual({
      status: "unavailable",
      recovery: "refresh-own-review",
    });
    expect(diagnostic).toHaveBeenCalledWith(
      "customer-review-submit-unavailable",
    );
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(
      "secret review text",
    );

    hide.mockResolvedValueOnce({ status: "unavailable" });
    await expect(
      hideCustomerReview({
        reviewId: "11111111-1111-4111-8111-111111111111",
        reason: "Later reason",
      }),
    ).resolves.toEqual({
      status: "unavailable",
      recovery: "reload-administrator-reviews",
    });
    diagnostic.mockRestore();
  });

  it("rechecks owner identity and revalidates only after a new reply", async () => {
    const authenticatedUserId = vi
      .fn()
      .mockResolvedValue("88888888-8888-4888-8888-888888888888");
    const submitReply = vi.fn().mockResolvedValue({
      status: "replied",
      reviewId: "11111111-1111-4111-8111-111111111111",
      submittedAt: "2026-09-22T08:00:00.000Z",
      affectedPublicSlug,
    });
    createRequestReview.mockResolvedValue({ authenticatedUserId, submitReply });

    await expect(
      submitCustomerReviewReply({
        ...validReply,
        authorUserId: "88888888-8888-4888-8888-888888888888",
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      submitCustomerReviewReply({ ...validReply, originalBody: " \n " }),
    ).resolves.toEqual({ status: "invalid" });
    expect(createRequestReview).not.toHaveBeenCalled();

    await expect(submitCustomerReviewReply(validReply)).resolves.toEqual({
      status: "replied",
      reviewId: "11111111-1111-4111-8111-111111111111",
      submittedAt: "2026-09-22T08:00:00.000Z",
    });
    expect(authenticatedUserId).toHaveBeenCalledOnce();
    expect(submitReply).toHaveBeenCalledWith({
      bookingRequestReference: "RC-REQ-0123456789ABCDEF",
      originalLanguage: "ar",
      originalBody: "شكراً لزيارتكم",
    });
    expect(revalidatePath).toHaveBeenCalledTimes(12);
    expect(revalidatePath.mock.calls).toContainEqual([
      "/ar/owner/booking-requests/RC-REQ-0123456789ABCDEF",
    ]);
    expect(revalidatePath.mock.calls).toContainEqual([
      `/ar/cottages/${affectedPublicSlug}/reviews`,
    ]);

    revalidatePath.mockClear();
    authenticatedUserId.mockResolvedValueOnce(undefined);
    await expect(submitCustomerReviewReply(validReply)).resolves.toEqual({
      status: "access-required",
    });
    expect(submitReply).toHaveBeenCalledOnce();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves reply access, duplicate, prohibited, ineligible and unavailable recovery outcomes", async () => {
    const authenticatedUserId = vi
      .fn()
      .mockResolvedValue("88888888-8888-4888-8888-888888888888");
    const submitReply = vi
      .fn()
      .mockResolvedValueOnce({ status: "access-required" })
      .mockResolvedValueOnce({
        status: "duplicate",
        reviewId: "11111111-1111-4111-8111-111111111111",
        submittedAt: "2026-09-22T08:00:00.000Z",
      })
      .mockResolvedValueOnce({ status: "prohibited-content" })
      .mockResolvedValueOnce({ status: "ineligible" })
      .mockResolvedValue({ status: "unavailable" });
    const hideReply = vi
      .fn()
      .mockResolvedValueOnce({
        status: "already-hidden",
        reviewId: "11111111-1111-4111-8111-111111111111",
        administratorUserId: "55555555-5555-4555-8555-555555555555",
        reason: "Original reason",
        hiddenAt: "2026-09-22T09:30:00.000Z",
      })
      .mockResolvedValueOnce({ status: "access-required" })
      .mockResolvedValue({ status: "unavailable" });
    createRequestReview.mockResolvedValue({
      authenticatedUserId,
      submitReply,
      hideReply,
    });

    await expect(submitCustomerReviewReply(validReply)).resolves.toEqual({
      status: "access-required",
    });
    await expect(submitCustomerReviewReply(validReply)).resolves.toEqual({
      status: "duplicate",
      reviewId: "11111111-1111-4111-8111-111111111111",
      submittedAt: "2026-09-22T08:00:00.000Z",
    });
    await expect(submitCustomerReviewReply(validReply)).resolves.toEqual({
      status: "prohibited-content",
    });
    await expect(submitCustomerReviewReply(validReply)).resolves.toEqual({
      status: "ineligible",
    });
    await expect(submitCustomerReviewReply(validReply)).resolves.toEqual({
      status: "unavailable",
      recovery: "refresh-owner-review",
    });

    const replyHide = {
      reviewId: "11111111-1111-4111-8111-111111111111",
      reason: "Later reason",
    };
    await expect(hideCustomerReviewReply(replyHide)).resolves.toEqual({
      status: "already-hidden",
      reviewId: "11111111-1111-4111-8111-111111111111",
      administratorUserId: "55555555-5555-4555-8555-555555555555",
      reason: "Original reason",
      hiddenAt: "2026-09-22T09:30:00.000Z",
    });
    await expect(hideCustomerReviewReply(replyHide)).resolves.toEqual({
      status: "access-required",
    });
    await expect(hideCustomerReviewReply(replyHide)).resolves.toEqual({
      status: "unavailable",
      recovery: "reload-administrator-reviews",
    });
    await expect(
      hideCustomerReviewReply({ ...replyHide, locale: "en" }),
    ).resolves.toEqual({ status: "invalid" });
    expect(hideReply).toHaveBeenCalledTimes(3);
    expect(revalidatePath).not.toHaveBeenCalled();

    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    createRequestReview.mockRejectedValueOnce(
      new Error("secret reply text and bearer-token-value"),
    );
    await expect(submitCustomerReviewReply(validReply)).resolves.toEqual({
      status: "unavailable",
      recovery: "refresh-owner-review",
    });
    createRequestReview.mockRejectedValueOnce(
      new Error("secret reply text and bearer-token-value"),
    );
    await expect(hideCustomerReviewReply(replyHide)).resolves.toEqual({
      status: "unavailable",
      recovery: "reload-administrator-reviews",
    });
    expect(diagnostic.mock.calls).toEqual([
      ["customer-review-reply-submit-unavailable"],
      ["customer-review-reply-hide-unavailable"],
    ]);

    createRequestReview.mockResolvedValueOnce(undefined);
    await expect(submitCustomerReviewReply(validReply)).resolves.toEqual({
      status: "unavailable",
      recovery: "refresh-owner-review",
    });
    diagnostic.mockRestore();
  });

  it("does not contain framework interruptions raised during revalidation", async () => {
    createRequestReview.mockResolvedValue({
      authenticatedUserId: vi.fn().mockResolvedValue("user-id"),
      submit: vi.fn().mockResolvedValue({
        status: "submitted",
        reviewId: "11111111-1111-4111-8111-111111111111",
        submittedAt: "2026-09-21T12:00:00.000Z",
        affectedPublicSlug,
      }),
    });
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("framework-interruption");
    });

    await expect(submitCustomerReview(validSubmission)).rejects.toThrow(
      "framework-interruption",
    );
  });

  it("revalidates the exact affected paths in every launch locale after each new mutation", async () => {
    const authenticatedUserId = vi
      .fn()
      .mockResolvedValue("77777777-7777-4777-8777-777777777777");
    const submit = vi.fn().mockResolvedValue({
      status: "submitted",
      reviewId: "11111111-1111-4111-8111-111111111111",
      submittedAt: "2026-09-21T12:00:00.000Z",
      affectedPublicSlug,
    });
    const hide = vi.fn().mockResolvedValue({
      status: "hidden",
      reviewId: "11111111-1111-4111-8111-111111111111",
      administratorUserId: "55555555-5555-4555-8555-555555555555",
      reason: "Required reason",
      hiddenAt: "2026-09-21T12:30:00.000Z",
      affectedPublicSlug,
      affectedBookingRequestReference: affectedBookingReference,
    });
    const submitReply = vi.fn().mockResolvedValue({
      status: "replied",
      reviewId: "11111111-1111-4111-8111-111111111111",
      submittedAt: "2026-09-22T08:00:00.000Z",
      affectedPublicSlug,
    });
    const hideReply = vi.fn().mockResolvedValue({
      status: "hidden",
      reviewId: "11111111-1111-4111-8111-111111111111",
      administratorUserId: "55555555-5555-4555-8555-555555555555",
      reason: "Required reason",
      hiddenAt: "2026-09-22T09:30:00.000Z",
      affectedPublicSlug,
      affectedBookingRequestReference: affectedBookingReference,
    });
    createRequestReview.mockResolvedValue({
      authenticatedUserId,
      submit,
      hide,
      submitReply,
      hideReply,
    });
    const pathsForSubmittedReference = [
      "/en/booking-requests/RC-REQ-0123456789ABCDEF",
      "/en/owner/booking-requests/RC-REQ-0123456789ABCDEF",
      "/en/cottages/cottage-deadbeefdeadbeefdeadbeefdead0029/reviews",
      "/en/administrator/reviews",
      "/ar/booking-requests/RC-REQ-0123456789ABCDEF",
      "/ar/owner/booking-requests/RC-REQ-0123456789ABCDEF",
      "/ar/cottages/cottage-deadbeefdeadbeefdeadbeefdead0029/reviews",
      "/ar/administrator/reviews",
      "/ckb/booking-requests/RC-REQ-0123456789ABCDEF",
      "/ckb/owner/booking-requests/RC-REQ-0123456789ABCDEF",
      "/ckb/cottages/cottage-deadbeefdeadbeefdeadbeefdead0029/reviews",
      "/ckb/administrator/reviews",
    ];
    const pathsForDatabaseReference = [
      "/en/booking-requests/RC-REQ-FEDCBA9876543210",
      "/en/owner/booking-requests/RC-REQ-FEDCBA9876543210",
      "/en/cottages/cottage-deadbeefdeadbeefdeadbeefdead0029/reviews",
      "/en/administrator/reviews",
      "/ar/booking-requests/RC-REQ-FEDCBA9876543210",
      "/ar/owner/booking-requests/RC-REQ-FEDCBA9876543210",
      "/ar/cottages/cottage-deadbeefdeadbeefdeadbeefdead0029/reviews",
      "/ar/administrator/reviews",
      "/ckb/booking-requests/RC-REQ-FEDCBA9876543210",
      "/ckb/owner/booking-requests/RC-REQ-FEDCBA9876543210",
      "/ckb/cottages/cottage-deadbeefdeadbeefdeadbeefdead0029/reviews",
      "/ckb/administrator/reviews",
    ];
    const revalidated = () =>
      revalidatePath.mock.calls.map(([path]) => path).sort();

    await submitCustomerReview(validSubmission);
    expect(revalidated()).toEqual([...pathsForSubmittedReference].sort());
    expect(revalidatePath.mock.calls.flat()).not.toContain(
      `/en/cottages/${distractorPublicSlug}/reviews`,
    );

    revalidatePath.mockClear();
    await hideCustomerReview({
      reviewId: "11111111-1111-4111-8111-111111111111",
      reason: "Required reason",
    });
    expect(revalidated()).toEqual([...pathsForDatabaseReference].sort());

    revalidatePath.mockClear();
    await submitCustomerReviewReply(validReply);
    expect(revalidated()).toEqual([...pathsForSubmittedReference].sort());

    revalidatePath.mockClear();
    await hideCustomerReviewReply({
      reviewId: "11111111-1111-4111-8111-111111111111",
      reason: "Required reason",
    });
    expect(revalidated()).toEqual([...pathsForDatabaseReference].sort());
    expect(hide).toHaveBeenCalledOnce();
    expect(hideReply).toHaveBeenCalledOnce();
  });
});
