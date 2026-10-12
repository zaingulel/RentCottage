import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/customer-review/actions", () => ({
  translateCustomerReview: vi.fn(),
  reportCustomerReviewTranslation: vi.fn(),
}));

import type { PublicCustomerReview } from "@/customer-review/customer-review";
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
        translationAccess="none"
        result={{
          status: "success",
          items: [
            {
              reviewId,
              rating: 5,
              originalLanguage: "ckb",
              originalBody: "شوێنێکی ئارام و جوانە",
              submittedAt: "2026-09-21T12:00:00.000Z",
              ownerReply: null,
              translations: [],
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
    expect(screen.queryByText("رد مالك البيت")).toBeNull();
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
          translationAccess="none"
          result={{
            status: "success",
            items: [
              {
                reviewId,
                rating: 4,
                originalLanguage: "en",
                originalBody: hostile,
                submittedAt: "2026-09-21T12:00:00.000Z",
                ownerReply: null,
                translations: [],
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

  it("shows decorative stars beside the unchanged rating text", () => {
    render(
      <PublicCustomerReviews
        locale="en"
        publicSlug={publicSlug}
        translationAccess="none"
        result={{
          status: "success",
          items: [
            {
              reviewId,
              rating: 4,
              originalLanguage: "en",
              originalBody: "A calm place",
              submittedAt: "2026-09-21T12:00:00.000Z",
              ownerReply: null,
              translations: [],
            },
          ],
          nextCursor: null,
        }}
      />,
    );
    const review = screen.getByRole("article");
    expect(within(review).getByText("★★★★☆")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      within(review).getByText(
        `${customerReviewMessages.en.rating}: 4 / 5 ${customerReviewMessages.en.ratingValue}`,
      ),
    ).toBeVisible();
  });

  it.each([
    ["en", "Cottage Owner reply"],
    ["ar", "رد مالك البيت"],
    ["ckb", "وەڵامی خاوەن کۆتێج"],
  ] as const)(
    "shows the Cottage Owner reply under its review in %s",
    (locale, label) => {
      render(
        <PublicCustomerReviews
          locale={locale}
          publicSlug={publicSlug}
          translationAccess="none"
          result={{
            status: "success",
            items: [
              {
                reviewId,
                rating: 5,
                originalLanguage: "ckb",
                originalBody: "شوێنێکی ئارام و جوانە",
                submittedAt: "2026-09-21T12:00:00.000Z",
                ownerReply: {
                  originalLanguage: "ar",
                  originalBody: "شكراً لزيارتكم",
                  submittedAt: "2026-09-22T09:30:00.000Z",
                  translations: [],
                },
                translations: [],
              },
            ],
            nextCursor: null,
          }}
        />,
      );

      const review = screen.getByRole("article");
      expect(within(review).getByText("شوێنێکی ئارام و جوانە")).toBeVisible();
      expect(within(review).getByText(label)).toBeVisible();
      const reply = within(review).getByText("شكراً لزيارتكم");
      expect(reply).toBeVisible();
      expect(reply).toHaveAttribute("lang", "ar");
      expect(reply).toHaveAttribute("dir", "auto");
      expect(
        review.querySelector('time[datetime="2026-09-22T09:30:00.000Z"]'),
      ).not.toBeNull();
    },
  );

  it("renders hostile reply text as text, never markup", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    render(
      <PublicCustomerReviews
        locale="en"
        publicSlug={publicSlug}
        translationAccess="none"
        result={{
          status: "success",
          items: [
            {
              reviewId,
              rating: 5,
              originalLanguage: "en",
              originalBody: "A calm place",
              submittedAt: "2026-09-21T12:00:00.000Z",
              ownerReply: {
                originalLanguage: "en",
                originalBody: hostile,
                submittedAt: "2026-09-22T09:30:00.000Z",
                translations: [],
              },
              translations: [],
            },
          ],
          nextCursor: null,
        }}
      />,
    );

    const review = screen.getByRole("article");
    expect(within(review).getByText(hostile)).toBeVisible();
    expect(review.querySelector("img")).toBeNull();
  });

  const foreign = {
    reviewId,
    rating: 5,
    originalLanguage: "ar",
    originalBody: "مكان هادئ",
    submittedAt: "2026-09-21T12:00:00.000Z",
    ownerReply: {
      originalLanguage: "ckb",
      originalBody: "سوپاس بۆ مانەوەتان",
      submittedAt: "2026-09-22T09:30:00.000Z",
      translations: [],
    },
    translations: [],
  } as const;

  function renderForeign(
    translationAccess: "allowed" | "sign-in" | "none",
    item: PublicCustomerReview = foreign,
  ) {
    return render(
      <PublicCustomerReviews
        locale="en"
        publicSlug={publicSlug}
        translationAccess={translationAccess}
        result={{ status: "success", items: [item], nextCursor: null }}
      />,
    );
  }

  it("shows the stored translation of the review and of the reply for the reader's language only", () => {
    renderForeign("none", {
      ...foreign,
      translations: [
        {
          translationId: "t1",
          targetLanguage: "ckb",
          translatedBody: "Kurdish text",
        },
        {
          translationId: "t2",
          targetLanguage: "en",
          translatedBody: "A quiet place",
        },
      ],
      ownerReply: {
        ...foreign.ownerReply,
        translations: [
          {
            translationId: "t3",
            targetLanguage: "en",
            translatedBody: "Thank you for staying",
          },
        ],
      },
    });

    expect(screen.getByText("A quiet place")).toHaveAttribute("lang", "en");
    expect(screen.queryByText("Kurdish text")).toBeNull();
    expect(screen.queryByText("مكان هادئ")).toBeNull();
    const reply = screen.getByRole("group", { name: "Cottage Owner reply" });
    expect(within(reply).getByText("Thank you for staying")).toHaveAttribute(
      "lang",
      "en",
    );
    expect(within(reply).queryByText("سوپاس بۆ مانەوەتان")).toBeNull();
    expect(screen.getAllByText(/Automatic translation/)).toHaveLength(2);
  });

  it("offers Translate on the review and on the reply to a reader who may act", () => {
    renderForeign("allowed");

    const review = screen.getByRole("article");
    const reply = within(review).getByRole("group", {
      name: "Cottage Owner reply",
    });
    expect(within(reply).getAllByRole("button")).toHaveLength(1);
    expect(
      within(reply).getByRole("button", { name: "Translate" }),
    ).toBeVisible();
    expect(
      within(review).getAllByRole("button", { name: "Translate" }),
    ).toHaveLength(2);
  });

  it.each(["none", "sign-in"] as const)(
    "offers no Translate or Report control when the access is %s",
    (translationAccess) => {
      renderForeign(translationAccess, {
        ...foreign,
        translations: [
          {
            translationId: "t2",
            targetLanguage: "en",
            translatedBody: "A quiet place",
          },
        ],
      });

      expect(screen.queryByRole("button", { name: "Translate" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Report poor translation" }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "View original" }),
      ).toBeVisible();
    },
  );

  it("shows the sign-in link under the title only for a signed-out reader with a foreign-language text", () => {
    const { rerender } = renderForeign("sign-in");
    expect(
      screen.getByRole("link", {
        name: "Sign in to translate or report a translation",
      }),
    ).toHaveAttribute(
      "href",
      `/en/access?returnTo=${encodeURIComponent(`/en/cottages/${publicSlug}`)}`,
    );

    const sameLanguage = {
      ...foreign,
      originalLanguage: "en",
      originalBody: "A quiet place",
      ownerReply: null,
    } as const;
    rerender(
      <PublicCustomerReviews
        locale="en"
        publicSlug={publicSlug}
        translationAccess="sign-in"
        result={{ status: "success", items: [sameLanguage], nextCursor: null }}
      />,
    );
    expect(screen.queryByRole("link", { name: /Sign in/ })).toBeNull();

    rerender(
      <PublicCustomerReviews
        locale="en"
        publicSlug={publicSlug}
        translationAccess="allowed"
        result={{ status: "success", items: [foreign], nextCursor: null }}
      />,
    );
    expect(screen.queryByRole("link", { name: /Sign in/ })).toBeNull();
  });

  it("draws no translation control for a same-language text or a rating-only review", () => {
    renderForeign("allowed", {
      ...foreign,
      originalLanguage: "en",
      originalBody: null,
      ownerReply: {
        ...foreign.ownerReply,
        originalLanguage: "en",
        originalBody: "Thank you for staying",
      },
    });

    expect(screen.getByText("Rating only")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names the reply group by its visible heading and no longer shows the placeholder line", () => {
    renderForeign("none");

    const reply = screen.getByRole("group", { name: "Cottage Owner reply" });
    expect(within(reply).getByText("Cottage Owner reply")).toBeVisible();
    for (const placeholder of [
      "Review translation is not available yet.",
      "ترجمة التقييم غير متاحة حالياً.",
      "وەرگێڕانی هەڵسەنگاندن هێشتا بەردەست نییە.",
    ]) {
      expect(screen.queryByText(placeholder)).toBeNull();
    }
  });

  it("keeps unavailable distinct from an empty successful page", () => {
    const { rerender } = render(
      <PublicCustomerReviews
        locale="en"
        publicSlug={publicSlug}
        translationAccess="none"
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
        translationAccess="none"
        result={{ status: "success", items: [], nextCursor: null }}
      />,
    );
    expect(screen.getByText("No reviews yet.")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
