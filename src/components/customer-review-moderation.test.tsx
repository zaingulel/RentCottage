import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hideReview } = vi.hoisted(() => ({ hideReview: vi.fn() }));

vi.mock("@/customer-review/actions", () => ({
  hideCustomerReview: hideReview,
}));

import { customerReviewMessages } from "@/i18n/customer-review-messages";

import { CustomerReviewModeration } from "./customer-review-moderation";

const review = {
  reviewId: "11111111-1111-4111-8111-111111111111",
  bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
  profileId: "33333333-3333-4333-8333-333333333333",
  authorUserId: "44444444-4444-4444-8444-444444444444",
  rating: 4,
  originalLanguage: "ar" as const,
  originalBody: "نص التقييم الأصلي",
  submittedAt: "2026-09-21T12:00:00.000Z",
  moderationState: "unhidden" as const,
  hide: null,
};

describe("CustomerReviewModeration", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["en", "ar", "ckb"] as const)(
    "carries the exact %s moderation queue into access recovery",
    (locale) => {
      render(
        <CustomerReviewModeration
          locale={locale}
          result={{ status: "access-required" }}
        />,
      );

      expect(
        screen.getByRole("link", {
          name: customerReviewMessages[locale].administratorAccessAction,
        }),
      ).toHaveAttribute(
        "href",
        `/${locale}/administrator/access?returnTo=${encodeURIComponent(`/${locale}/administrator/reviews`)}`,
      );
    },
  );

  it("requires a reason, sends only mutation facts, and retains committed attribution", async () => {
    hideReview.mockResolvedValue({
      status: "hidden",
      reviewId: review.reviewId,
      administratorUserId: "22222222-2222-4222-8222-222222222222",
      reason: "Contains a prohibited contact detail",
      hiddenAt: "2026-09-21T13:00:00.000Z",
    });
    render(
      <CustomerReviewModeration
        locale="en"
        result={{ status: "success", items: [review], nextCursor: null }}
      />,
    );
    const card = screen.getByRole("article");
    fireEvent.click(within(card).getByRole("button", { name: "Hide review" }));
    expect(within(card).getByRole("alert")).toHaveTextContent(
      "Enter a reason before hiding this review.",
    );
    fireEvent.change(within(card).getByLabelText("Reason for hiding"), {
      target: { value: "Contains a prohibited contact detail" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Hide review" }));
    await waitFor(() =>
      expect(hideReview).toHaveBeenCalledWith({
        reviewId: review.reviewId,
        reason: "Contains a prohibited contact detail",
      }),
    );
    expect(within(card).getByRole("status")).toHaveTextContent(
      "The review was hidden.",
    );
    expect(card).toHaveTextContent("Contains a prohibited contact detail");
    expect(card).toHaveTextContent("22222222-2222-4222-8222-222222222222");
  });

  it.each(["en", "ar", "ckb"] as const)(
    "renders localized visible rating text and the original literally in %s",
    (locale) => {
      const copy = customerReviewMessages[locale];
      const hostile = "Literal <em>audit</em> & <svg>not markup</svg>";
      render(
        <CustomerReviewModeration
          locale={locale}
          result={{
            status: "success",
            items: [
              { ...review, originalLanguage: "en", originalBody: hostile },
            ],
            nextCursor: null,
          }}
        />,
      );
      const card = screen.getByRole("article");
      expect(
        within(card).getByText(`${copy.rating}: 4 / 5 ${copy.ratingValue}`),
      ).toBeVisible();
      expect(within(card).getByText(hostile)).toHaveAttribute("dir", "auto");
      expect(within(card).queryByText("audit")).toBeNull();
      expect(within(card).queryByLabelText(copy.rating)).toBeNull();
    },
  );
});
