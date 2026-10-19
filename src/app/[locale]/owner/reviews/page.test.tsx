import { cleanup, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const { listOwner, createReviews, requireAccount } = vi.hoisted(() => ({
  listOwner: vi.fn(),
  createReviews: vi.fn(),
  requireAccount: vi.fn(),
}));
vi.mock("@/customer-review/request-customer-review", () => ({
  createRequestCustomerReview: createReviews,
}));
vi.mock("@/access/request-account-context", () => ({
  requireRequestAccount: requireAccount,
}));
vi.mock("@/access/actions", () => ({ signOutAccount: vi.fn() }));
vi.mock("@/customer-review/actions", () => ({
  submitCustomerReviewReply: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  unstable_rethrow: vi.fn(),
}));
import ReviewsPage from "./page";

const approved = {
  role: "cottage_owner",
  userId: "owner",
  approvalState: "approved",
};
const first = {
  reviewId: "10000000-0000-4000-8000-000000000001",
  submittedAt: "2026-10-18T12:00:00Z",
  bookingRequestReference: "RC-REQ-0000000000000001",
  cottageName: "Garden cottage",
  review: {
    status: "reviewed",
    rating: 5,
    originalLanguage: "en",
    originalBody: "A peaceful garden.",
    submittedAt: "2026-10-18T12:00:00Z",
    reply: null,
  },
};
const page = (
  locale = "en",
  query: Record<string, string | string[] | undefined> = {},
) =>
  ReviewsPage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(query),
  });
beforeEach(() => {
  listOwner
    .mockReset()
    .mockResolvedValue({ status: "success", items: [first], nextCursor: null });
  createReviews.mockReset().mockResolvedValue({ listOwner });
  requireAccount
    .mockReset()
    .mockResolvedValue({ status: "authenticated", context: approved });
});
it("Reviews permits only approved owners and renders the bounded reader", async () => {
  for (const [locale, title, reviewTitle] of [
    ["en", "Reviews", "Customer review"],
    ["ar", "التقييمات", "تقييم العميل"],
    ["ckb", "هەڵسەنگاندنەکان", "هەڵسەنگاندنی کڕیار"],
  ]) {
    render(await page(locale));
    expect(
      screen.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Garden cottage" }),
    ).toHaveAttribute(
      "href",
      `/${locale}/owner/booking-requests/RC-REQ-0000000000000001`,
    );
    expect(screen.getByRole("link", { name: title })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(requireAccount).toHaveBeenLastCalledWith(
      locale,
      `/${locale}/owner/reviews`,
    );
    expect(listOwner).toHaveBeenLastCalledWith({
      beforeAt: null,
      beforeId: null,
      limit: 20,
    });
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: `${reviewTitle}: Garden cottage`,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", {
        name: `${reviewTitle}: Garden cottage`,
      }),
    ).toBeVisible();
    expect(screen.getByText("A peaceful garden.")).toHaveAttribute(
      "dir",
      "auto",
    );
    cleanup();
  }
  for (const account of [
    { status: "unavailable" },
    { status: "authenticated", context: null },
    ...["customer", "platform_administrator"].map((role) => ({
      status: "authenticated",
      context: { ...approved, role },
    })),
    ...["prospective", "expired", "suspended"].map((approvalState) => ({
      status: "authenticated",
      context: { ...approved, approvalState },
    })),
  ]) {
    createReviews.mockClear();
    requireAccount.mockResolvedValue(account);
    render(await page());
    expect(screen.getByRole("alert")).toHaveTextContent(
      account.status === "unavailable"
        ? "Account access is unavailable. Please try again."
        : "This booking is not available to this account.",
    );
    expect(createReviews).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("Garden cottage")).toBeNull();
    cleanup();
  }
  requireAccount.mockClear();
  await expect(page("invalid")).rejects.toThrow("not found");
  for (const query of [
    { beforeAt: first.submittedAt },
    { beforeId: first.reviewId },
    { beforeAt: [first.submittedAt], beforeId: first.reviewId },
    { beforeAt: "invalid", beforeId: first.reviewId },
    { beforeAt: first.submittedAt, beforeId: "invalid" },
    { extra: "private" },
    { beforeAt: undefined },
  ])
    await expect(page("en", query)).rejects.toThrow("not found");
  expect(requireAccount).not.toHaveBeenCalled();
});

it("Reviews preserves locale, hidden state, paging and visible failures", async () => {
  const cursor = {
    submittedAt: "2026-10-17T10:00:00+03:00",
    reviewId: "10000000-0000-4000-8000-000000000002",
  };
  const reply = {
    originalLanguage: "ar",
    originalBody: "شكراً لزيارتكم",
    submittedAt: "2026-10-18T13:00:00Z",
    moderationState: "hidden",
  };
  for (const [
    locale,
    noReply,
    replied,
    empty,
    exhausted,
    newest,
    next,
    unavailable,
    retry,
  ] of [
    [
      "en",
      "No reply yet",
      "Replied",
      "Your cottages have no reviews yet.",
      "There are no more reviews on this page.",
      "Newest reviews",
      "Next reviews",
      "Reviews are unavailable. Refresh and try again.",
      "Try again",
    ],
    [
      "ar",
      "لم يتم الرد بعد",
      "تم الرد",
      "لا توجد تقييمات لأكواخك بعد.",
      "لا توجد تقييمات أخرى في هذه الصفحة.",
      "أحدث التقييمات",
      "التقييمات التالية",
      "التقييمات غير متاحة. حدّث الصفحة وحاول مرة أخرى.",
      "حاول مجددًا",
    ],
    [
      "ckb",
      "هێشتا وەڵام نەدراوەتەوە",
      "وەڵام دراوەتەوە",
      "هێشتا کۆتێجەکانت هیچ هەڵسەنگاندنێکیان نییە.",
      "هیچ هەڵسەنگاندنێکی تر لەم پەڕەیەدا نییە.",
      "نوێترین هەڵسەنگاندنەکان",
      "هەڵسەنگاندنەکانی دواتر",
      "هەڵسەنگاندنەکان بەردەست نین. پەڕەکە نوێ بکەرەوە و دووبارە هەوڵ بدەوە.",
      "دووبارە هەوڵ بدەوە",
    ],
  ]) {
    listOwner.mockResolvedValue({
      status: "success",
      items: [
        first,
        {
          ...first,
          reviewId: cursor.reviewId,
          review: { status: "review-hidden", reply },
        },
      ],
      nextCursor: cursor,
    });
    render(await page(locale));
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText(noReply)).toBeVisible();
    expect(within(rows[1]).getByText(replied)).toBeVisible();
    expect(within(rows[1]).queryByText("A peaceful garden.")).toBeNull();
    expect(within(rows[1]).getByText(reply.originalBody)).toHaveAttribute(
      "lang",
      "ar",
    );
    expect(within(rows[1]).queryByRole("textbox")).toBeNull();
    expect(within(rows[0]).getByRole("textbox")).toHaveAttribute(
      "id",
      "owner-review-10000000-0000-4000-8000-000000000001-reply-body",
    );
    expect(within(rows[1]).getByRole("heading", { level: 2 })).toHaveAttribute(
      "id",
      "owner-review-10000000-0000-4000-8000-000000000002-owner-heading",
    );
    expect(screen.getByRole("link", { name: next })).toHaveAttribute(
      "href",
      `/${locale}/owner/reviews?beforeAt=2026-10-17T10%3A00%3A00%2B03%3A00&beforeId=10000000-0000-4000-8000-000000000002`,
    );
    expect(screen.queryByRole("link", { name: newest })).toBeNull();
    cleanup();
    listOwner.mockResolvedValue({
      status: "success",
      items: [],
      nextCursor: null,
    });
    render(await page(locale));
    expect(screen.getByText(empty)).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    render(
      await page(locale, {
        beforeAt: cursor.submittedAt,
        beforeId: cursor.reviewId,
      }),
    );
    expect(listOwner).toHaveBeenLastCalledWith({
      beforeAt: cursor.submittedAt,
      beforeId: cursor.reviewId,
      limit: 20,
    });
    expect(screen.getByText(exhausted)).toBeVisible();
    expect(screen.queryByText(empty)).toBeNull();
    expect(screen.getByRole("link", { name: newest })).toHaveAttribute(
      "href",
      `/${locale}/owner/reviews`,
    );
    expect(screen.queryByRole("link", { name: next })).toBeNull();
    cleanup();
    for (const outcome of ["unavailable", "invalid", "throw", "missing"]) {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        if (outcome === "throw")
          listOwner.mockRejectedValueOnce(
            new Error("private database diagnostic"),
          );
        else if (outcome === "missing")
          createReviews.mockResolvedValueOnce(undefined);
        else listOwner.mockResolvedValueOnce({ status: outcome });
        render(await page(locale));
        if (outcome === "throw")
          expect(errorLog.mock.calls).toEqual([
            ["customer-review-owner-list-unavailable"],
          ]);
        else expect(errorLog).not.toHaveBeenCalled();
        expect(screen.getByRole("alert")).toHaveTextContent(unavailable);
        expect(screen.getByRole("link", { name: retry })).toHaveAttribute(
          "href",
          `/${locale}/owner/reviews`,
        );
        expect(screen.queryByText(empty)).toBeNull();
        expect(screen.queryByText("private database diagnostic")).toBeNull();
        expect(screen.queryByText("Garden cottage")).toBeNull();
        cleanup();
      } finally {
        errorLog.mockRestore();
      }
    }
  }
  listOwner.mockResolvedValueOnce({ status: "access-required" });
  render(await page());
  expect(screen.getByRole("alert")).toHaveTextContent(
    "This booking is not available to this account.",
  );
  cleanup();
  const hostile = '<img src="x" onerror="private()">';
  listOwner.mockResolvedValue({
    status: "success",
    items: [
      {
        ...first,
        cottageName: hostile,
        review: { ...first.review, originalBody: hostile },
      },
    ],
    nextCursor: null,
  });
  const { container } = render(await page());
  expect(screen.getByRole("link", { name: hostile })).toBeVisible();
  expect(screen.getAllByText(hostile)).toHaveLength(2);
  expect(container.querySelector("img, script")).toBeNull();
});
