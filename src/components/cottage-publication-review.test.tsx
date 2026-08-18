import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CottagePublicationReview } from "./cottage-publication-review";

vi.mock("@/cottage-publication/actions", () => ({
  correctCottageLocalizationAction: vi.fn(),
  decideCottageLocalizationAction: vi.fn(),
  decideCottagePublicationAction: vi.fn(),
}));

const review = {
  id: "20000000-0000-4000-8000-000000000024",
  state: "in_review" as const,
  productionReady: false,
  localizations: [
    {
      locale: "en" as const,
      origin: "owner_source" as const,
      description: "Quiet cottage",
      houseRules: "No smoking",
      approved: true,
    },
    {
      locale: "ar" as const,
      origin: "generated" as const,
      description: "كوخ هادئ",
      houseRules: "ممنوع التدخين",
      approved: false,
    },
    {
      locale: "ckb" as const,
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
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
});
