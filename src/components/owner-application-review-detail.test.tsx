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
      screen.queryByText("10000000-0000-4000-8000-000000000001"),
    ).toBeNull();
  });
});
