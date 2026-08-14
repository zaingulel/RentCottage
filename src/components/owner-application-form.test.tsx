import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/owner-application/actions", () => ({
  saveOwnerApplicationAction: vi.fn(),
  uploadOwnerDocumentAction: vi.fn(),
  submitOwnerApplicationAction: vi.fn(),
}));

import type { OwnerApplicationSnapshot } from "@/owner-application/owner-application";
import { OwnerApplicationForm } from "./owner-application-form";

const draft: OwnerApplicationSnapshot = {
  applicationId: "20000000-0000-4000-8000-000000000001",
  ownerUserId: "10000000-0000-4000-8000-000000000001",
  status: "draft",
  applicantKind: "individual",
  legalName: "Zana Kareem",
  companyName: "",
  licensingBasis: "licence",
  exemptionBasis: "",
  cottage: {
    name: "Garden House",
    governorate: "Erbil",
    approximateLocation: "Shaqlawa countryside",
    exactAddress: "Eastern orchard road",
    capacity: 8,
    bedrooms: 3,
    bathrooms: 2,
    amenities: ["garden", "parking"],
    description: "A quiet family cottage.",
    houseRules: "Families only.",
  },
  documents: [
    {
      id: "40000000-0000-4000-8000-000000000001",
      kind: "identity",
      originalFilename: "passport.pdf",
      mediaType: "application/pdf",
      sizeBytes: 128,
      updatedAt: "2026-08-14T10:00:00.000Z",
    },
  ],
  submittedAt: null,
};

describe("Owner Application form", () => {
  it("shows every application section and allows a partial draft", () => {
    render(<OwnerApplicationForm locale="en" application={null} />);

    expect(screen.getByRole("heading", { name: "Your details" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Your first private cottage" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Private verification documents" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Prepare your Owner Application",
      }),
    ).toBeVisible();
    expect(screen.getByText(/Save the draft before uploading/)).toBeVisible();
  });

  it("requires distinct company and authorised-representative evidence", () => {
    render(
      <OwnerApplicationForm
        locale="en"
        application={{ ...draft, applicantKind: "company" }}
      />,
    );

    expect(
      screen.getByRole("article", { name: "Company evidence" }),
    ).toBeVisible();
    expect(
      screen.getByRole("article", {
        name: "Authorised-representative evidence",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("article", { name: "Identity evidence" }),
    ).toBeNull();
  });

  it("shows saved document metadata without exposing a download action", () => {
    render(<OwnerApplicationForm locale="en" application={draft} />);

    expect(screen.getByText("passport.pdf")).toBeVisible();
    expect(screen.queryByRole("link", { name: /secure link/i })).toBeNull();
    expect(screen.getByLabelText("Legal name")).toHaveValue("Zana Kareem");
  });

  it("locks the application after submission", () => {
    render(
      <OwnerApplicationForm
        locale="en"
        application={{
          ...draft,
          status: "submitted",
          submittedAt: "2026-08-14T10:30:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("Submitted for review")).toBeVisible();
    expect(screen.getByLabelText("Legal name")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Submit application" }),
    ).toBeNull();
  });
});
