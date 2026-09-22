import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { customerReviewMessages } from "@/i18n/customer-review-messages";

import { PublicCustomerReviews } from "./public-customer-reviews";

const publicSlug = "cottage-11111111111111111111111111111111";
const reviewId = "11111111-1111-4111-8111-111111111111";

describe("PublicCustomerReviews", () => {
  it("renders only the unchanged public projection and deterministic continuation", () => {
    render(
      <PublicCustomerReviews
        locale="ar"
        publicSlug={publicSlug}
        result={{
          status: "success",
          items: [
            {
              reviewId,
              rating: 5,
              originalLanguage: "ckb",
              originalBody: "شوێنێکی ئارام و جوانە",
              submittedAt: "2026-09-21T12:00:00.000Z",
            },
          ],
          nextCursor: {
            submittedAt: "2026-09-21T12:00:00.000Z",
            reviewId,
          },
        }}
      />,
    );

    const original = screen.getByText("شوێنێکی ئارام و جوانە");
    expect(original).toHaveAttribute("lang", "ckb");
    expect(original).toHaveAttribute("dir", "auto");
    expect(screen.getByText("عميل RentCottage")).toBeVisible();
    expect(
      screen.queryByText(/author|booking|moderation|11111111/i),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "التقييمات التالية" }),
    ).toHaveAttribute(
      "href",
      `/ar/cottages/${publicSlug}/reviews?beforeAt=2026-09-21T12%3A00%3A00.000Z&beforeId=${reviewId}`,
    );
  });

  it.each(["en", "ar", "ckb"] as const)(
    "renders localized rating text and escaped original markup in %s",
    (locale) => {
      const copy = customerReviewMessages[locale];
      const hostile = "Literal <em>calm</em> & <svg>not markup</svg>";
      render(
        <PublicCustomerReviews
          locale={locale}
          publicSlug={publicSlug}
          result={{
            status: "success",
            items: [
              {
                reviewId,
                rating: 4,
                originalLanguage: "en",
                originalBody: hostile,
                submittedAt: "2026-09-21T12:00:00.000Z",
              },
            ],
            nextCursor: null,
          }}
        />,
      );
      const review = screen.getByRole("article");
      expect(
        within(review).getByText(`${copy.rating}: 4 / 5 ${copy.ratingValue}`),
      ).toBeVisible();
      expect(within(review).getByText(hostile)).toHaveAttribute("dir", "auto");
      expect(within(review).queryByText("calm")).toBeNull();
      expect(within(review).queryByLabelText(copy.rating)).toBeNull();
    },
  );

  it("keeps unavailable distinct from an empty successful page", () => {
    const { rerender } = render(
      <PublicCustomerReviews
        locale="en"
        publicSlug={publicSlug}
        result={{ status: "unavailable" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reviews are unavailable. Refresh and try again.",
    );
    expect(screen.queryByText("No reviews yet.")).toBeNull();

    rerender(
      <PublicCustomerReviews
        locale="en"
        publicSlug={publicSlug}
        result={{ status: "success", items: [], nextCursor: null }}
      />,
    );
    expect(screen.getByText("No reviews yet.")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
