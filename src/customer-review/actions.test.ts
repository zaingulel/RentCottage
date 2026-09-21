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

import { hideCustomerReview, submitCustomerReview } from "./actions";

const validSubmission = {
  locale: "ckb",
  publicSlug: "cottage-00000000000040008000000000000029",
  bookingRequestReference: "RC-REQ-0123456789ABCDEF",
  rating: 5,
  originalLanguage: "ckb",
  originalBody: null,
} as const;

describe("Customer review Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid, unknown, and supplied-actor input before request work", async () => {
    await expect(
      submitCustomerReview({ ...validSubmission, locale: "ku" }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      submitCustomerReview({
        ...validSubmission,
        actorUserId: "77777777-7777-4777-8777-777777777777",
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      hideCustomerReview({
        locale: "en",
        publicSlug: "cottage-00000000000040008000000000000029",
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        reviewId: "11111111-1111-4111-8111-111111111111",
        reason: "Reason",
        administratorUserId: "55555555-5555-4555-8555-555555555555",
      }),
    ).resolves.toEqual({ status: "invalid" });
    expect(createRequestReview).not.toHaveBeenCalled();
  });

  it("rechecks session identity and revalidates only affected locale paths after submission", async () => {
    const authenticatedUserId = vi
      .fn()
      .mockResolvedValue("77777777-7777-4777-8777-777777777777");
    const submit = vi.fn().mockResolvedValue({
      status: "submitted",
      reviewId: "11111111-1111-4111-8111-111111111111",
      submittedAt: "2026-09-21T12:00:00.000Z",
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
    expect(revalidatePath.mock.calls).toEqual([
      ["/ckb/booking-requests/RC-REQ-0123456789ABCDEF"],
      ["/ckb/cottages/cottage-00000000000040008000000000000029/reviews"],
      ["/ckb/administrator/reviews"],
    ]);
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
    });
    createRequestReview.mockResolvedValue({ authenticatedUserId, hide });

    await expect(
      hideCustomerReview({
        locale: "en",
        publicSlug: "cottage-00000000000040008000000000000029",
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        reviewId: "11111111-1111-4111-8111-111111111111",
        reason: "Contains personal contact details",
      }),
    ).resolves.toMatchObject({ status: "hidden" });
    expect(hide).toHaveBeenCalledWith({
      reviewId: "11111111-1111-4111-8111-111111111111",
      reason: "Contains personal contact details",
    });
    expect(revalidatePath.mock.calls).toEqual([
      ["/en/booking-requests/RC-REQ-0123456789ABCDEF"],
      ["/en/cottages/cottage-00000000000040008000000000000029/reviews"],
      ["/en/administrator/reviews"],
    ]);
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
        locale: "en",
        publicSlug: "cottage-00000000000040008000000000000029",
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        reviewId: "11111111-1111-4111-8111-111111111111",
        reason: "Later reason",
      }),
    ).resolves.toMatchObject({ status: "already-hidden", reason: "Original reason" });
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
    expect(diagnostic).toHaveBeenCalledWith("customer-review-submit-unavailable");
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("secret review text");

    hide.mockResolvedValueOnce({ status: "unavailable" });
    await expect(
      hideCustomerReview({
        locale: "en",
        publicSlug: "cottage-00000000000040008000000000000029",
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        reviewId: "11111111-1111-4111-8111-111111111111",
        reason: "Later reason",
      }),
    ).resolves.toEqual({
      status: "unavailable",
      recovery: "reload-administrator-reviews",
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
      }),
    });
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("framework-interruption");
    });

    await expect(submitCustomerReview(validSubmission)).rejects.toThrow(
      "framework-interruption",
    );
  });
});
