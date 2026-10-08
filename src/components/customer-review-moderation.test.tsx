import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hideReview, hideReply } = vi.hoisted(() => ({
  hideReview: vi.fn(),
  hideReply: vi.fn(),
}));

vi.mock("@/customer-review/actions", () => ({
  hideCustomerReview: hideReview,
  hideCustomerReviewReply: hideReply,
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
  reply: null,
};

const reply = {
  originalLanguage: "ckb" as const,
  originalBody: "سوپاس بۆ سەردانەکەت",
  submittedAt: "2026-09-22T09:00:00.000Z",
  moderationState: "unhidden" as const,
  authorUserId: "55555555-5555-4555-8555-555555555555",
  hide: null,
};

const replyHidden = {
  status: "hidden" as const,
  reviewId: review.reviewId,
  administratorUserId: "22222222-2222-4222-8222-222222222222",
  reason: "Reply names a competitor",
  hiddenAt: "2026-09-22T10:00:00.000Z",
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

  it("moves focus to the error when a hide reason is missing", () => {
    render(
      <CustomerReviewModeration
        locale="en"
        result={{ status: "success", items: [review], nextCursor: null }}
      />,
    );
    const card = screen.getByRole("article");
    fireEvent.click(within(card).getByRole("button", { name: "Hide review" }));
    expect(
      within(card).getByRole("alert").closest('[tabindex="-1"]'),
    ).toHaveFocus();
  });

  it("requires a reason for a reply, sends only mutation facts, and retains committed attribution", async () => {
    hideReply.mockResolvedValue(replyHidden);
    render(
      <CustomerReviewModeration
        locale="en"
        result={{
          status: "success",
          items: [{ ...review, reply }],
          nextCursor: null,
        }}
      />,
    );
    const section = within(screen.getByRole("article")).getByRole("region", {
      name: "Cottage Owner reply",
    });
    expect(section).toHaveTextContent(
      "Reply author UUID: 55555555-5555-4555-8555-555555555555",
    );
    expect(within(section).getByText("سوپاس بۆ سەردانەکەت")).toHaveAttribute(
      "lang",
      "ckb",
    );
    expect(within(section).getByText("سوپاس بۆ سەردانەکەت")).toHaveAttribute(
      "dir",
      "auto",
    );
    fireEvent.click(
      within(section).getByRole("button", { name: "Hide reply" }),
    );
    const alert = within(section).getByRole("alert");
    expect(alert).toHaveTextContent("Enter a reason before hiding this reply.");
    expect(alert.closest('[tabindex="-1"]')).toHaveFocus();
    expect(hideReply).not.toHaveBeenCalled();
    fireEvent.change(
      within(section).getByLabelText("Reason for hiding the reply"),
      { target: { value: "Reply names a competitor" } },
    );
    fireEvent.click(
      within(section).getByRole("button", { name: "Hide reply" }),
    );
    await waitFor(() =>
      expect(hideReply).toHaveBeenCalledWith({
        reviewId: review.reviewId,
        reason: "Reply names a competitor",
      }),
    );
    expect(within(section).getByRole("status")).toHaveTextContent(
      "The reply was hidden.",
    );
    expect(section).toHaveTextContent("Reply names a competitor");
    expect(section).toHaveTextContent("22222222-2222-4222-8222-222222222222");
    expect(within(section).getByText("سوپاس بۆ سەردانەکەت")).toBeVisible();
  });

  it("reports a rejected reply hide action as unavailable and keeps the form", async () => {
    hideReply.mockRejectedValue(new Error("network down"));
    render(
      <CustomerReviewModeration
        locale="en"
        result={{
          status: "success",
          items: [{ ...review, reply }],
          nextCursor: null,
        }}
      />,
    );
    const section = within(screen.getByRole("article")).getByRole("region", {
      name: "Cottage Owner reply",
    });
    fireEvent.change(
      within(section).getByLabelText("Reason for hiding the reply"),
      { target: { value: "Reply names a competitor" } },
    );
    fireEvent.click(
      within(section).getByRole("button", { name: "Hide reply" }),
    );
    await waitFor(() =>
      expect(within(section).getByRole("alert")).toHaveTextContent(
        "Reviews are unavailable. Refresh and try again.",
      ),
    );
    expect(
      within(section).getByRole("button", { name: "Hide reply" }),
    ).toBeEnabled();
    expect(section).not.toHaveTextContent("Reply names a competitor");
  });

  it("keeps the review hide and the reply hide independent", async () => {
    hideReply.mockResolvedValue(replyHidden);
    hideReview.mockResolvedValue({
      status: "hidden",
      reviewId: review.reviewId,
      administratorUserId: "66666666-6666-4666-8666-666666666666",
      reason: "Contains a prohibited contact detail",
      hiddenAt: "2026-09-22T11:00:00.000Z",
    });
    render(
      <CustomerReviewModeration
        locale="en"
        result={{
          status: "success",
          items: [{ ...review, reply }],
          nextCursor: null,
        }}
      />,
    );
    const card = screen.getByRole("article");
    const section = within(card).getByRole("region", {
      name: "Cottage Owner reply",
    });
    fireEvent.change(
      within(section).getByLabelText("Reason for hiding the reply"),
      { target: { value: "Reply names a competitor" } },
    );
    fireEvent.click(
      within(section).getByRole("button", { name: "Hide reply" }),
    );
    await waitFor(() =>
      expect(within(section).getByRole("status")).toHaveTextContent(
        "The reply was hidden.",
      ),
    );
    expect(hideReply).toHaveBeenCalledTimes(1);
    expect(hideReview).not.toHaveBeenCalled();
    expect(within(section).queryByRole("button")).toBeNull();
    expect(card).not.toHaveTextContent("The review was hidden.");

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
    await waitFor(() =>
      expect(card).toHaveTextContent("The review was hidden."),
    );
    expect(hideReply).toHaveBeenCalledTimes(1);
    expect(card).toHaveTextContent("66666666-6666-4666-8666-666666666666");
    expect(section).not.toHaveTextContent(
      "66666666-6666-4666-8666-666666666666",
    );
    expect(section).toHaveTextContent("Reply names a competitor");
  });

  it.each([
    [
      "en",
      "Cottage Owner reply",
      "Reply author UUID",
      "Reason for hiding the reply",
      "Hide reply",
    ],
    [
      "ar",
      "رد مالك البيت",
      "معرّف مالك البيت UUID",
      "سبب إخفاء الرد",
      "إخفاء الرد",
    ],
    [
      "ckb",
      "وەڵامی خاوەن کۆتێج",
      "UUIDی خاوەن کۆتێج",
      "هۆکاری شاردنەوەی وەڵام",
      "شاردنەوەی وەڵام",
    ],
  ] as const)(
    "labels reply moderation in %s",
    (locale, sectionName, authorLabel, reasonLabel, hideLabel) => {
      render(
        <CustomerReviewModeration
          locale={locale}
          result={{
            status: "success",
            items: [{ ...review, reply }],
            nextCursor: null,
          }}
        />,
      );
      const section = screen.getByRole("region", { name: sectionName });
      expect(section).toHaveTextContent(
        `${authorLabel}: 55555555-5555-4555-8555-555555555555`,
      );
      expect(within(section).getByLabelText(reasonLabel)).toHaveAttribute(
        "name",
        "reason",
      );
      expect(
        within(section).getByRole("button", { name: hideLabel }),
      ).toBeEnabled();
    },
  );

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
