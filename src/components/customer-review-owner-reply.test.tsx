import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitReply } = vi.hoisted(() => ({ submitReply: vi.fn() }));

vi.mock("@/customer-review/actions", () => ({
  submitCustomerReviewReply: submitReply,
}));

import type {
  OwnerCustomerReviewReply,
  OwnerCustomerReviewResult,
} from "@/customer-review/customer-review";
import type { Locale } from "@/i18n/routing";

import { CustomerReviewOwnerReply } from "./customer-review-owner-reply";

const bookingRequestReference = "RC-REQ-AAAAAAAAAAAAAAAA";
const storedReply: OwnerCustomerReviewReply = {
  originalLanguage: "en",
  originalBody: "Thank you for staying with us",
  submittedAt: "2026-09-22T12:00:00.000Z",
  moderationState: "unhidden",
};
const reviewed = (
  reply: OwnerCustomerReviewReply | null,
): OwnerCustomerReviewResult => ({
  status: "reviewed",
  rating: 4,
  originalLanguage: "en",
  originalBody: "A quiet stay",
  submittedAt: "2026-09-21T12:00:00.000Z",
  reply,
});

function renderReply(
  initialResult: OwnerCustomerReviewResult,
  locale: Locale = "en",
) {
  return render(
    <CustomerReviewOwnerReply
      locale={locale}
      bookingRequestReference={bookingRequestReference}
      initialResult={initialResult}
    />,
  );
}

describe("CustomerReviewOwnerReply", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when the booking has no review", () => {
    const { container } = renderReply({ status: "no-review" });

    expect(container).toBeEmptyDOMElement();
  });

  it("requires a reply body and sends only mutation facts", async () => {
    submitReply.mockResolvedValue({
      status: "replied",
      reviewId: "11111111-1111-4111-8111-111111111111",
      submittedAt: "2026-09-22T12:00:00.000Z",
    });
    renderReply(reviewed(null));
    const region = screen.getByRole("region", { name: "Customer review" });
    expect(within(region).getByText("Rating: 4 / 5 stars")).toBeVisible();
    expect(within(region).getByText("A quiet stay")).toHaveAttribute(
      "dir",
      "auto",
    );

    const textarea = screen.getByLabelText("Public reply");
    expect(textarea).not.toHaveAttribute("maxlength");
    expect(textarea).not.toHaveAttribute("name");
    expect(screen.getByLabelText("Original language")).not.toHaveAttribute(
      "name",
    );
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Publish reply" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Write a reply before publishing.",
    );

    fireEvent.change(textarea, { target: { value: "🏡".repeat(2001) } });
    fireEvent.click(screen.getByRole("button", { name: "Publish reply" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Check the reply and try again.",
    );
    expect(submitReply).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: " شكراً لزيارتكم " } });
    fireEvent.change(screen.getByLabelText("Original language"), {
      target: { value: "ar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish reply" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Your reply was published.",
      ),
    );
    expect(submitReply).toHaveBeenCalledTimes(1);
    expect(submitReply).toHaveBeenCalledWith({
      bookingRequestReference,
      originalLanguage: "ar",
      originalBody: " شكراً لزيارتكم ",
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [
      "en",
      "Customer review",
      "Public reply",
      "Up to 2,000 characters. You can reply once, and a published reply cannot be edited or deleted. Do not include contact details or links.",
      "Original language",
      "Publish reply",
    ],
    [
      "ar",
      "تقييم العميل",
      "الرد العلني",
      "حتى 2000 حرف. يمكنك الرد مرة واحدة، ولا يمكن تعديل الرد المنشور أو حذفه. لا تضف معلومات اتصال أو روابط.",
      "لغة النص الأصلي",
      "نشر الرد",
    ],
    [
      "ckb",
      "هەڵسەنگاندنی کڕیار",
      "وەڵامی گشتی",
      "تا ٢,٠٠٠ پیت. تەنها یەک جار دەتوانیت وەڵام بدەیتەوە، و وەڵامی بڵاوکراوە دەستکاری ناکرێت و ناسڕدرێتەوە. زانیاری پەیوەندی یان بەستەر مەنووسە.",
      "زمانی دەقی ڕەسەن",
      "بڵاوکردنەوەی وەڵام",
    ],
  ] as const)(
    "labels the reply form and states that the reply is public and permanent in %s",
    (locale, title, bodyLabel, help, languageLabel, submitLabel) => {
      renderReply(reviewed(null), locale);

      const region = screen.getByRole("region", { name: title });
      expect(
        within(region).getByRole("textbox", { name: bodyLabel }),
      ).toHaveAccessibleDescription(help);
      expect(
        within(region).getByRole("combobox", { name: languageLabel }),
      ).toHaveValue(locale);
      expect(
        within(region).getByRole("button", { name: submitLabel }),
      ).toHaveAttribute("type", "submit");
    },
  );

  it("shows a published reply and offers no second form", () => {
    renderReply(reviewed(storedReply));

    const region = screen.getByRole("region", { name: "Customer review" });
    expect(
      within(region).getByRole("heading", { name: "Your reply", level: 3 }),
    ).toBeVisible();
    const body = within(region).getByText("Thank you for staying with us");
    expect(body).toHaveAttribute("lang", "en");
    expect(body).toHaveAttribute("dir", "auto");
    expect(
      region.querySelector('time[datetime="2026-09-22T12:00:00.000Z"]'),
    ).not.toBeNull();
    expect(within(region).queryByRole("textbox")).toBeNull();
    expect(within(region).queryByRole("combobox")).toBeNull();
    expect(within(region).queryByRole("button")).toBeNull();
  });

  it.each([
    [
      "en",
      "Customer review",
      "Your reply was published.",
      "Visible to visitors",
    ],
    ["ar", "تقييم العميل", "تم نشر ردّك.", "ظاهر للزوار"],
    [
      "ckb",
      "هەڵسەنگاندنی کڕیار",
      "وەڵامەکەت بڵاوکرایەوە.",
      "بۆ سەردانکەران دیارە",
    ],
  ] as const)(
    "marks a stored reply as published without claiming visitors can see it in %s",
    (locale, title, status, visibleClaim) => {
      renderReply(reviewed(storedReply), locale);

      const region = screen.getByRole("region", { name: title });
      expect(within(region).getByRole("status")).toHaveTextContent(status);
      expect(region).not.toHaveTextContent(visibleClaim);
    },
  );

  it("announces a hidden reply as hidden, never published", () => {
    renderReply(reviewed({ ...storedReply, moderationState: "hidden" }));

    const region = screen.getByRole("region", { name: "Customer review" });
    expect(within(region).getByRole("status")).toHaveTextContent(
      "Hidden by RentCottage",
    );
    expect(region).not.toHaveTextContent("Your reply was published.");
    expect(within(region).queryByRole("textbox")).toBeNull();
  });

  it("says a reply under a hidden review is not shown to visitors", () => {
    renderReply({ status: "review-hidden", reply: storedReply });

    const region = screen.getByRole("region", { name: "Customer review" });
    expect(within(region).getByRole("status")).toHaveTextContent(
      "Your reply is not shown to visitors because the review is hidden.",
    );
    expect(region).not.toHaveTextContent("Your reply was published.");
  });

  it("shows a hidden review without its text and keeps unavailability an alert", () => {
    const { rerender } = renderReply({ status: "review-hidden", reply: null });

    const region = screen.getByRole("region", { name: "Customer review" });
    expect(
      within(region).getByText(
        "This review was hidden by RentCottage and is not shown to visitors.",
      ),
    ).toBeVisible();
    expect(region).not.toHaveTextContent("Rating");
    expect(within(region).queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <CustomerReviewOwnerReply
        locale="en"
        bookingRequestReference={bookingRequestReference}
        initialResult={{ status: "access-required" }}
      />,
    );
    expect(
      screen.getByText(
        "Sign in with the Cottage Owner account for this booking.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <CustomerReviewOwnerReply
        locale="en"
        bookingRequestReference={bookingRequestReference}
        initialResult={{ status: "unavailable" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reviews are unavailable. Refresh and try again.",
    );
  });

  it("maps prohibited, duplicate, ineligible and access outcomes to their own messages", async () => {
    const outcomes = [
      [
        { status: "prohibited-content" },
        "Remove contact details, links, or social handles before publishing.",
      ],
      [
        {
          status: "duplicate",
          reviewId: "11111111-1111-4111-8111-111111111111",
          submittedAt: "2026-09-22T12:00:00.000Z",
        },
        "This review already has a reply. Refresh to see it.",
      ],
      [{ status: "ineligible" }, "A reply is not available for this review."],
      [
        { status: "access-required" },
        "Sign in with the Cottage Owner account for this booking.",
      ],
      [{ status: "invalid" }, "Check the reply and try again."],
      [
        { status: "unavailable", recovery: "refresh-owner-review" },
        "Reviews are unavailable. Refresh and try again.",
      ],
    ] as const;
    renderReply(reviewed(null));
    fireEvent.change(screen.getByLabelText("Public reply"), {
      target: { value: "Thank you" },
    });

    for (const [result, message] of outcomes) {
      submitReply.mockResolvedValue(result);
      fireEvent.click(screen.getByRole("button", { name: "Publish reply" }));
      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(message),
      );
      expect(screen.queryByRole("status")).toBeNull();
    }
    expect(submitReply).toHaveBeenCalledTimes(outcomes.length);
  });
});
