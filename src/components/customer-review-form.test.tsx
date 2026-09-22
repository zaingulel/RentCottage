import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitReview } = vi.hoisted(() => ({ submitReview: vi.fn() }));

vi.mock("@/customer-review/actions", () => ({
  submitCustomerReview: submitReview,
}));

import { customerReviewMessages } from "@/i18n/customer-review-messages";

import { CustomerReviewForm } from "./customer-review-form";

const bookingRequestReference = "RC-REQ-AAAAAAAAAAAAAAAA";

describe("CustomerReviewForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a rating and sends only mutation facts", async () => {
    submitReview.mockResolvedValue({
      status: "submitted",
      reviewId: "11111111-1111-4111-8111-111111111111",
      submittedAt: "2026-09-21T12:00:00.000Z",
    });
    render(
      <CustomerReviewForm
        locale="en"
        bookingRequestReference={bookingRequestReference}
        initialResult={{
          status: "eligible",
          reviewExpiresAt: "2026-10-05T10:00:00.000Z",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish review" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a rating from 1 to 5.",
    );
    expect(submitReview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    fireEvent.change(screen.getByLabelText("Review text (optional)"), {
      target: { value: "إقامة هادئة وجميلة" },
    });
    fireEvent.change(screen.getByLabelText("Original language"), {
      target: { value: "ar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish review" }));

    await waitFor(() =>
      expect(submitReview).toHaveBeenCalledWith({
        bookingRequestReference,
        rating: 5,
        originalLanguage: "ar",
        originalBody: "إقامة هادئة وجميلة",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your review was published.",
    );
  });

  it("submits database-valid supplementary characters without a native UTF-16 limit", async () => {
    const originalBody = "🏡".repeat(1001);
    submitReview.mockResolvedValue({ status: "ineligible" });
    render(
      <CustomerReviewForm
        locale="en"
        bookingRequestReference={bookingRequestReference}
        initialResult={{
          status: "eligible",
          reviewExpiresAt: "2026-10-05T10:00:00.000Z",
        }}
      />,
    );

    const textarea = screen.getByLabelText("Review text (optional)");
    expect(textarea).not.toHaveAttribute("maxlength");
    fireEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    fireEvent.change(textarea, { target: { value: originalBody } });
    fireEvent.click(screen.getByRole("button", { name: "Publish review" }));

    await waitFor(() =>
      expect(submitReview).toHaveBeenCalledWith({
        bookingRequestReference,
        rating: 5,
        originalLanguage: "en",
        originalBody,
      }),
    );
  });

  it.each(["en", "ar", "ckb"] as const)(
    "renders a visible localized rating and the original literally in %s",
    (locale) => {
      const copy = customerReviewMessages[locale];
      const hostile = "A literal <em>quiet</em> stay & no injected markup";
      render(
        <CustomerReviewForm
          locale={locale}
          bookingRequestReference={bookingRequestReference}
          initialResult={{
            status: "submitted",
            reviewId: "11111111-1111-4111-8111-111111111111",
            rating: 4,
            originalLanguage: "en",
            originalBody: hostile,
            submittedAt: "2026-09-21T12:00:00.000Z",
            moderationState: "unhidden",
          }}
        />,
      );
      const region = screen.getByRole("region", { name: copy.submitted });
      expect(
        within(region).getByText(`${copy.rating}: 4 / 5 ${copy.ratingValue}`),
      ).toBeVisible();
      expect(within(region).getByText(hostile)).toHaveAttribute("dir", "auto");
      expect(within(region).queryByText("quiet")).toBeNull();
      expect(within(region).queryByLabelText(copy.rating)).toBeNull();
      expect(within(region).getByRole("status")).toHaveTextContent(
        copy.published,
      );
      expect(region).toHaveTextContent(copy.visible);
    },
  );

  it("announces a hidden submitted review as hidden, never published or visible", () => {
    render(
      <CustomerReviewForm
        locale="en"
        bookingRequestReference={bookingRequestReference}
        initialResult={{
          status: "submitted",
          reviewId: "11111111-1111-4111-8111-111111111111",
          rating: 3,
          originalLanguage: "en",
          originalBody: null,
          submittedAt: "2026-09-21T12:00:00.000Z",
          moderationState: "hidden",
        }}
      />,
    );
    const region = screen.getByRole("region", { name: "Your review" });
    expect(within(region).getByRole("status")).toHaveTextContent(
      "Hidden by RentCottage",
    );
    expect(region).not.toHaveTextContent("Your review was published.");
    expect(region).not.toHaveTextContent("Visible to visitors");
  });

  it("keeps genuine unavailability distinct from normal ineligibility", () => {
    const { rerender } = render(
      <CustomerReviewForm
        locale="en"
        bookingRequestReference={bookingRequestReference}
        initialResult={{ status: "ineligible" }}
      />,
    );
    expect(
      screen.getByText("A review is not available for this booking."),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <CustomerReviewForm
        locale="en"
        bookingRequestReference={bookingRequestReference}
        initialResult={{ status: "unavailable" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reviews are unavailable. Refresh and try again.",
    );
  });
});
