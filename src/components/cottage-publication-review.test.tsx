import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CottagePublicationReview } from "./cottage-publication-review";

vi.mock("@/cottage-publication/actions", () => ({
  correctCottageLocalizationAction: vi.fn(),
  decideCottageLocalizationAction: vi.fn(),
  decideCottagePublicationAction: vi.fn(),
  generateCottageTranslationAction: vi.fn(),
  reportCottageTranslationAction: vi.fn(),
  routeCottageTranslationToHumanReviewAction: vi.fn(),
}));

const review = {
  id: "20000000-0000-4000-8000-000000000024",
  state: "in_review" as const,
  productionReady: false,
  localizations: [
    {
      locale: "en" as const,
      revisionId: "30000000-0000-4000-8000-000000000021",
      origin: "owner_source" as const,
      description: "Quiet cottage",
      houseRules: "No smoking",
      approved: true,
    },
    {
      locale: "ar" as const,
      revisionId: "30000000-0000-4000-8000-000000000022",
      origin: "generated" as const,
      description: "كوخ هادئ",
      houseRules: "ممنوع التدخين",
      approved: false,
    },
    {
      locale: "ckb" as const,
      revisionId: "30000000-0000-4000-8000-000000000023",
      origin: "administrator_correction" as const,
      description: "کۆتێجێکی ئارام",
      houseRules: "جگەرەکێشان قەدەغەیە",
      approved: false,
    },
  ],
};

describe("Cottage publication review", () => {
  it("shows a truthful trilingual moderation state without claiming production readiness", () => {
    render(
      <CottagePublicationReview
        locale="en"
        review={review}
        actor="administrator"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Language review" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Production translation and publication are disabled until the approved adapter is available.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("AI-generated draft")).toBeInTheDocument();
    expect(
      screen.getAllByRole("textbox", { name: "Description" }),
    ).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Publish all three languages" }),
    ).toBeDisabled();
  });

  it("shows owners the review result without administrator controls", () => {
    render(
      <CottagePublicationReview
        locale="ckb"
        review={{ ...review, state: "rejected" }}
        actor="owner"
      />,
    );

    expect(screen.getByText("ڕەتکرایەوە")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "پەسەندکردنی زمان" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "پاشەکەوتکردنی ڕاستکردنەوە" }),
    ).not.toBeInTheDocument();
  });

  it("keeps page-locale moderation controls outside target-language direction", () => {
    render(
      <CottagePublicationReview
        locale="ar"
        review={review}
        actor="administrator"
      />,
    );

    const descriptions = screen.getAllByRole("textbox", {
      name: "الوصف",
    });
    const englishDescription = descriptions[0];
    expect(englishDescription).toHaveAttribute("lang", "en");
    expect(englishDescription).toHaveAttribute("dir", "ltr");
    expect(englishDescription.closest("article")).not.toHaveAttribute("lang");
    expect(englishDescription.closest("article")).not.toHaveAttribute("dir");
    expect(
      screen.getAllByRole("button", { name: "حفظ التصحيح" })[0],
    ).not.toHaveAttribute("lang");

    const arabicDescription = descriptions[1];
    expect(arabicDescription).toHaveAttribute("lang", "ar");
    expect(arabicDescription).toHaveAttribute("dir", "rtl");
  });

  it("lets the owner report only a visible generated revision and preserves the source label", () => {
    render(
      <CottagePublicationReview
        locale="en"
        review={{
          ...review,
          sourceLanguage: "en",
          localizations: review.localizations.map((item) => ({
            ...item,
            revisionId: `${item.locale}0000000-0000-4000-8000-000000000024`,
          })),
        }}
        actor="owner"
      />,
    );

    expect(screen.getByText("Source language: English")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Report translation" }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("textbox", { name: "Report reason" }),
    ).toHaveLength(1);
  });

  it("shows original text and a human-review control for a generated target", () => {
    render(
      <CottagePublicationReview
        locale="en"
        review={{
          ...review,
          sourceLanguage: "en",
          localizations: review.localizations.map((item) =>
            item.locale === "ar"
              ? {
                  ...item,
                  revisionId: undefined,
                  origin: "source_fallback" as const,
                  contentLanguage: "en" as const,
                  description: "Quiet cottage",
                  houseRules: "No smoking",
                  humanReviewRequired: true,
                }
              : item,
          ),
        }}
        actor="administrator"
      />,
    );

    expect(
      screen.getByText("Showing original while unavailable"),
    ).toBeVisible();
    expect(screen.getByText("Human review required")).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "Save correction" }),
    ).toHaveLength(2);
    const arabic = screen
      .getByRole("heading", { name: "العربية" })
      .closest("article");
    expect(arabic).not.toBeNull();
    expect(within(arabic!).getByText("Quiet cottage")).toHaveAttribute(
      "lang",
      "en",
    );
    expect(within(arabic!).getByText("Quiet cottage")).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  it("localizes approved internal failure codes", () => {
    render(
      <CottagePublicationReview
        locale="en"
        review={{
          ...review,
          localizations: review.localizations.map((item) =>
            item.locale === "ar"
              ? {
                  ...item,
                  origin: "source_fallback" as const,
                  contentLanguage: "en" as const,
                  revisionId: undefined,
                  failureCode: "provider_timeout" as const,
                }
              : item,
          ),
        }}
        actor="administrator"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Translation provider timed out. The original text is shown.",
    );
    expect(screen.queryByText("provider_timeout")).not.toBeInTheDocument();
  });

  it("offers only gate-bound ordinary generation and stronger reprocessing", () => {
    const localizations = review.localizations.map((item) =>
      item.locale === "ar"
        ? {
            ...item,
            revisionId: undefined,
            origin: "source_fallback" as const,
            contentLanguage: "en" as const,
            description: "Quiet cottage",
            houseRules: "No smoking",
          }
        : item.locale === "ckb"
          ? { ...item, origin: "generated" as const }
          : item,
    );
    const { rerender } = render(
      <CottagePublicationReview
        locale="en"
        review={{ ...review, localizations }}
        actor="administrator"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Generate العربية" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Reprocess کوردی سۆرانی" }),
    ).toBeDisabled();

    rerender(
      <CottagePublicationReview
        locale="en"
        review={{ ...review, productionReady: true, localizations }}
        actor="administrator"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Generate العربية" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Reprocess کوردی سۆرانی" }),
    ).toBeEnabled();
  });

  it("exposes a published owner report with Terra and human remediation actions", () => {
    render(
      <CottagePublicationReview
        locale="en"
        review={{
          ...review,
          productionReady: true,
          localizations: review.localizations.map((item) =>
            item.locale === "ar"
              ? {
                  ...item,
                  qualityReportReason:
                    "The published Arabic meaning is incorrect",
                }
              : item,
          ),
        }}
        actor="administrator"
      />,
    );

    const arabic = screen
      .getByRole("heading", { name: "العربية" })
      .closest("article");
    expect(arabic).not.toBeNull();
    expect(
      within(arabic!).getByText(
        "Owner report: The published Arabic meaning is incorrect",
      ),
    ).toBeVisible();
    expect(
      within(arabic!).getByRole("button", {
        name: "Reprocess with Terra العربية",
      }),
    ).toBeEnabled();
    expect(
      within(arabic!).getByRole("button", { name: "Route to human review" }),
    ).toBeVisible();
  });

  it("shows the AAL2 administrator the approved gate and bounded monthly usage", () => {
    render(
      <CottagePublicationReview
        locale="en"
        review={review}
        actor="administrator"
        administration={{
          productionReady: false,
          providerTermsApproved: true,
          nativeReviewApproved: true,
          qualityThresholdApproved: true,
          ordinaryModel: "gpt-5.6-luna",
          ordinaryEffort: "none",
          strongerModel: "gpt-5.6-terra",
          strongerEffort: "none",
          judgeModel: "gpt-5.6-sol",
          judgeEffort: "medium",
          monthlyRequestLimit: 100,
          monthlyTokenLimit: 100000,
          monthlySpendMicrousdLimit: 500000,
          monthRequests: 3,
          monthReservedTokens: 1200,
          monthReservedMicrousd: 4000,
          monthActualMicrousd: 1200,
          qualityReportCount: 2,
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Translation controls" }),
    ).toBeVisible();
    expect(screen.getByText("3 / 100 requests reserved")).toBeVisible();
    expect(screen.getByText("2 quality reports")).toBeVisible();
    expect(screen.getByText("1200 microusd used")).toBeVisible();
    expect(screen.getByText(/gpt-5.6-luna/)).toBeVisible();
  });
});
