import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/owner-application/review-actions", () => ({
  reviewOwnerApplicationAction: vi.fn(),
}));
vi.mock("@/owner-application/actions", () => ({
  createOwnerDocumentAccessAction: vi.fn(),
}));

import type { OwnerApplicationReviewDetail } from "@/owner-application/supabase-owner-application-review";
import { OwnerApplicationReviewDetailView } from "./owner-application-review-detail";

const detail: OwnerApplicationReviewDetail = {
  applicationId: "20000000-0000-4000-8000-000000000001",
  version: 2,
  status: "submitted",
  submittedAt: "2026-08-16T10:00:00.000Z",
  reviewDueAt: "2026-08-19T10:00:00.000Z",
  applicantKind: "individual",
  legalName: "Synthetic Owner",
  companyName: "",
  licensingBasis: "licence",
  exemptionBasis: "",
  cottage: {
    name: "Garden House",
    governorate: "Erbil",
    approximateLocation: "Shaqlawa",
    exactAddress: "Private road",
    capacity: 8,
    bedrooms: 3,
    bathrooms: 2,
    amenities: ["garden"],
    description: "Description",
    houseRules: "Rules",
  },
  documents: [
    {
      id: "40000000-0000-4000-8000-000000000001",
      kind: "identity",
      originalFilename: "identity.pdf",
      mediaType: "application/pdf",
      sizeBytes: 128,
      updatedAt: "2026-08-16T09:00:00.000Z",
    },
    {
      id: "40000000-0000-4000-8000-000000000002",
      kind: "licensing_or_exemption",
      originalFilename: "licence.pdf",
      mediaType: "application/pdf",
      sizeBytes: 128,
      updatedAt: "2026-08-16T09:00:00.000Z",
    },
  ],
  activeInformationRequest: null,
  transitions: [],
};

describe("Owner Application review detail", () => {
  it("shows the private profile, evidence and every legal submitted action", () => {
    render(<OwnerApplicationReviewDetailView locale="en" detail={detail} />);

    expect(screen.getByText("Private road")).toBeVisible();
    expect(screen.getByText("identity.pdf")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start review" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Request missing information" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Approve Owner Application" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Reject Owner Application" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Suspend Owner Application" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Expiry date: Licence or exemption evidence"),
    ).not.toBeRequired();
  });

  it.each([
    ["en", "Individual"],
    ["ar", "فرد"],
    ["ckb", "تاک"],
  ] as const)("localizes the applicant kind in %s", (locale, label) => {
    render(
      <OwnerApplicationReviewDetailView locale={locale} detail={detail} />,
    );

    expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByText("individual")).not.toBeInTheDocument();
  });

  it("uses localized placeholders instead of empty numeric details", () => {
    render(
      <OwnerApplicationReviewDetailView
        locale="en"
        detail={{
          ...detail,
          cottage: {
            ...detail.cottage,
            capacity: null,
            bedrooms: null,
            bathrooms: null,
          },
        }}
      />,
    );

    expect(screen.getAllByText("Not provided")).toHaveLength(3);
  });

  it("keeps lifecycle transition order explicit in a right-to-left locale", () => {
    const { container } = render(
      <OwnerApplicationReviewDetailView
        locale="ar"
        detail={{
          ...detail,
          status: "under_review",
          transitions: [
            {
              fromStatus: "submitted",
              toStatus: "under_review",
              occurredAt: "2026-08-16T11:00:00.000Z",
              reason: "بدأت المراجعة",
            },
          ],
        }}
      />,
    );

    const transition = container.querySelector(".review-transition");
    expect(transition).toHaveAttribute("dir", "ltr");
    expect(transition?.textContent).toBe("أُرسل للمراجعة → قيد المراجعة");
  });

  it("shows only decision actions while under review", () => {
    render(
      <OwnerApplicationReviewDetailView
        locale="en"
        detail={{ ...detail, status: "under_review" }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Start review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Request missing information" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Approve Owner Application" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Reject Owner Application" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Suspend Owner Application" }),
    ).not.toBeInTheDocument();
  });

  it("shows only suspension for an approved application", () => {
    render(
      <OwnerApplicationReviewDetailView
        locale="en"
        detail={{ ...detail, status: "approved" }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Suspend Owner Application" }),
    ).toBeVisible();
    for (const name of [
      "Start review",
      "Request missing information",
      "Approve Owner Application",
      "Reject Owner Application",
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});
