import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/owner-application/actions", () => ({
  respondToOwnerApplicationAction: vi.fn(),
  submitOwnerApplicationRenewalAction: vi.fn(),
  uploadOwnerDocumentAction: vi.fn(),
}));

import type { OwnerApplicationSnapshot } from "@/owner-application/owner-application";
import type { OwnerApplicationOwnerReview } from "@/owner-application/supabase-owner-application-review";
import { OwnerApplicationReviewStatus } from "./owner-application-review-status";

const application: OwnerApplicationSnapshot = {
  applicationId: "20000000-0000-4000-8000-000000000001",
  ownerUserId: "10000000-0000-4000-8000-000000000001",
  status: "needs_information",
  version: 3,
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
      kind: "licensing_or_exemption",
      originalFilename: "old-licence.pdf",
      mediaType: "application/pdf",
      sizeBytes: 128,
      updatedAt: "2026-08-14T10:00:00.000Z",
    },
  ],
  submittedAt: "2026-08-14T10:00:00.000Z",
  reviewDueAt: null,
};

const review: OwnerApplicationOwnerReview = {
  activeRequest: {
    reason: "Provide the renewed licence and confirm the private address.",
    requestedFields: ["exact_address"],
    requestedDocumentKinds: ["licensing_or_exemption"],
  },
  renewalDocumentKinds: [],
  notices: [
    {
      kind: "information_requested",
      reason: "Provide the renewed licence.",
      createdAt: "2026-08-16T10:00:00.000Z",
    },
  ],
};

describe("Owner Application review status", () => {
  it("shows the durable state and only the exact requested response scope", () => {
    render(
      <OwnerApplicationReviewStatus
        locale="en"
        application={application}
        review={review}
      />,
    );

    expect(screen.getByText("Needs information")).toBeVisible();
    expect(
      screen.getByText(
        "Provide the renewed licence and confirm the private address.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Exact private address")).toHaveValue(
      "Private road",
    );
    expect(screen.queryByLabelText("Legal name")).toBeNull();
    const evidence = screen
      .getByText("Licence or exemption evidence")
      .closest("article");
    expect(evidence).not.toBeNull();
    expect(
      within(evidence as HTMLElement).getByRole("button", {
        name: "Replace document",
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Send requested information" }),
    ).toBeVisible();
  });

  it("renders the approved, rejected, expired and suspended states explicitly", () => {
    const { rerender } = render(
      <OwnerApplicationReviewStatus
        locale="en"
        application={{ ...application, status: "approved" }}
        review={{ ...review, activeRequest: null }}
      />,
    );
    expect(screen.getByText("Approved")).toBeVisible();
    for (const [status, label] of [
      ["rejected", "Rejected"],
      ["expired", "Expired"],
      ["suspended", "Suspended"],
    ] as const) {
      rerender(
        <OwnerApplicationReviewStatus
          locale="en"
          application={{ ...application, status }}
          review={{ ...review, activeRequest: null }}
        />,
      );
      expect(screen.getByText(label)).toBeVisible();
    }
  });
});
