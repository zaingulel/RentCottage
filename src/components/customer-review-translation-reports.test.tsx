import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  CustomerReviewTranslationReport,
  CustomerReviewTranslationReportListResult,
} from "@/customer-review/customer-review";
import { administratorQueuesMessages } from "@/i18n/administrator-queues-messages";
import { administratorRecordsMessages } from "@/i18n/administrator-records-messages";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import { customerReviewMessages } from "@/i18n/customer-review-messages";
import { formatIraqDateTime } from "@/i18n/format";

import { CustomerReviewTranslationReports } from "./customer-review-translation-reports";

const report: CustomerReviewTranslationReport = {
  reportId: "11111111-1111-4111-8111-111111111111",
  bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
  subject: "review",
  originalLanguage: "ar",
  originalBody: "مكان هادئ ونظيف",
  targetLanguage: "en",
  translatedBody: "A quiet and clean place",
  provider: "local-test-provider",
  model: "local-test-model",
  promptVersion: "review-translation-v1",
  reportedAt: "2026-10-12T11:00:00.000Z",
};

const success = (
  items: readonly CustomerReviewTranslationReport[],
  nextCursor: { reportedAt: string; reportId: string } | null = null,
): CustomerReviewTranslationReportListResult => ({
  status: "success",
  items,
  nextCursor,
});

function renderReports(
  result: CustomerReviewTranslationReportListResult,
  locale: "en" | "ar" | "ckb" = "en",
) {
  return render(
    <CustomerReviewTranslationReports locale={locale} result={result} />,
  );
}

describe("CustomerReviewTranslationReports", () => {
  it("shows each fact of a reported review translation beside its original", () => {
    renderReports(success([report]));
    const copy = customerReviewMessages.en;

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: copy.translationReportsTitle,
      }),
    ).toBeVisible();
    const card = screen.getByRole("article");
    expect(
      within(card).getByRole("heading", { name: copy.translatedReviewText }),
    ).toBeVisible();
    expect(
      within(card).getByText(report.bookingRequestReference),
    ).toBeVisible();
    expect(
      within(card).getByText(formatIraqDateTime(report.reportedAt, "en")),
    ).toHaveAttribute("datetime", report.reportedAt);
    expect(within(card).getByText(copy.translationReportedAt)).toBeVisible();
    expect(within(card).getByText(copy.translationSource)).toBeVisible();
    expect(within(card).getByText("local-test-provider")).toBeVisible();
    expect(within(card).getByText("local-test-model")).toBeVisible();
    expect(within(card).getByText("review-translation-v1")).toBeVisible();
    expect(
      within(card).getByText(
        `${copy.automaticTranslation} · ${copy.fictionalTranslation}`,
      ),
    ).toBeVisible();
  });

  it("names a reported owner reply by its reply heading", () => {
    renderReports(success([{ ...report, subject: "reply" }]));

    const card = screen.getByRole("article");
    expect(
      within(card).getByRole("heading", {
        name: customerReviewMessages.en.ownerReply,
      }),
    ).toBeVisible();
    expect(
      within(card).queryByText(customerReviewMessages.en.translatedReviewText),
    ).toBeNull();
  });

  it("gives the original and the generated text each their own language and direction", () => {
    renderReports(
      success([
        report,
        {
          ...report,
          reportId: "22222222-2222-4222-8222-222222222222",
          originalLanguage: "en",
          originalBody: "A calm place",
          targetLanguage: "ckb",
          translatedBody: "شوێنێکی ئارام",
        },
      ]),
    );

    const [first, second] = screen.getAllByRole("article");
    const original = within(first).getByText(report.originalBody);
    expect(original).toHaveAttribute("lang", "ar");
    expect(original).toHaveAttribute("dir", "auto");
    const generated = within(first).getByText(report.translatedBody);
    expect(generated).toHaveAttribute("lang", "en");
    expect(generated).toHaveAttribute("dir", "ltr");
    const secondOriginal = within(second).getByText("A calm place");
    expect(secondOriginal).toHaveAttribute("lang", "en");
    expect(secondOriginal).toHaveAttribute("dir", "auto");
    const secondGenerated = within(second).getByText("شوێنێکی ئارام");
    expect(secondGenerated).toHaveAttribute("lang", "ckb");
    expect(secondGenerated).toHaveAttribute("dir", "rtl");
  });

  it("renders a hostile reported translation and its original as text, never markup", () => {
    const { container } = renderReports(
      success([
        {
          ...report,
          originalLanguage: "en",
          originalBody: "<img src=y onerror=alert(2)>",
          targetLanguage: "en",
          translatedBody: "<img src=x onerror=alert(1)>",
        },
      ]),
    );

    const card = screen.getByRole("article");
    expect(
      within(card).getByText("<img src=x onerror=alert(1)>"),
    ).toBeVisible();
    expect(
      within(card).getByText("<img src=y onerror=alert(2)>"),
    ).toBeVisible();
    expect(card.querySelector("img")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("the translation reports screen shows the administrator navigation, Queues current and nested, only after access is confirmed", () => {
    for (const locale of ["en", "ar", "ckb"] as const) {
      const navName = cottageProfileMessages[locale].adminEyebrow;
      const queues = administratorQueuesMessages[locale].title;

      const { unmount } = renderReports(success([report]), locale);
      const navigation = screen.getByRole("navigation", { name: navName });
      expect(screen.getByRole("main").firstElementChild).toBe(navigation);
      expect(
        within(navigation).getByRole("link", { name: queues }),
      ).toHaveAttribute("aria-current", "true");
      unmount();

      const empty = renderReports(success([]), locale);
      expect(screen.getByRole("main").firstElementChild).toBe(
        screen.getByRole("navigation", { name: navName }),
      );
      empty.unmount();
    }

    for (const status of [
      "access-required",
      "unavailable",
      "invalid",
    ] as const) {
      const { unmount } = renderReports({ status });
      expect(
        screen.queryByRole("navigation", {
          name: cottageProfileMessages.en.adminEyebrow,
        }),
      ).toBeNull();
      unmount();
    }
  });

  it("shows an empty state with a way back to Review moderation", () => {
    renderReports(success([]));
    const copy = customerReviewMessages.en;

    expect(screen.getByText(copy.translationReportsEmpty)).toBeVisible();
    expect(screen.queryByRole("article")).toBeNull();
    expect(
      screen.getByRole("link", { name: copy.administratorTitle }),
    ).toHaveAttribute("href", "/en/administrator/reviews");
  });

  it("links to older reports from the cursor and shows no link on the last page", () => {
    const cursor = {
      reportedAt: "2026-10-12T10:00:00.000Z",
      reportId: "33333333-3333-4333-8333-333333333333",
    };
    const next = administratorRecordsMessages.en.next;
    const { unmount } = renderReports(success([report], cursor));

    const link = screen.getByRole("link", { name: next });
    expect(link).toHaveAttribute(
      "href",
      `/en/administrator/reviews/translation-reports?beforeAt=${encodeURIComponent(cursor.reportedAt)}&beforeId=${cursor.reportId}`,
    );
    expect(link.closest("nav")).toHaveClass("results-paging");
    unmount();

    renderReports(success([report]));
    expect(screen.queryByRole("link", { name: next })).toBeNull();
  });

  it("sends an account without administrator access to recovery and shows no report", () => {
    renderReports({ status: "access-required" }, "ar");

    expect(
      screen.getByText(customerReviewMessages.ar.administratorAccessRequired),
    ).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: customerReviewMessages.ar.administratorAccessAction,
      }),
    ).toHaveAttribute(
      "href",
      `/ar/administrator/access?returnTo=${encodeURIComponent("/ar/administrator/reviews")}`,
    );
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("announces an unavailable list and an invalid request", () => {
    const { unmount } = renderReports({ status: "unavailable" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      customerReviewMessages.en.unavailable,
    );
    unmount();

    renderReports({ status: "invalid" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      customerReviewMessages.en.invalid,
    );
  });
});
