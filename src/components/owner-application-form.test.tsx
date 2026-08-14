import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/owner-application/actions", () => ({
  saveOwnerApplicationAction: vi.fn(),
  uploadOwnerDocumentAction: vi.fn(),
  submitOwnerApplicationAction: vi.fn(),
}));

import type { OwnerApplicationSnapshot } from "@/owner-application/owner-application";
import {
  saveOwnerApplicationAction,
  submitOwnerApplicationAction,
} from "@/owner-application/actions";
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
  beforeEach(() => vi.resetAllMocks());

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

  it("updates required evidence from the current applicant choices", () => {
    render(<OwnerApplicationForm locale="en" application={draft} />);

    fireEvent.change(screen.getByLabelText("Applicant type"), {
      target: { value: "company" },
    });
    fireEvent.change(screen.getByLabelText("Local compliance basis"), {
      target: { value: "exemption" },
    });

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
    expect(
      screen.queryByRole("article", { name: "Licence or exemption evidence" }),
    ).toBeNull();
  });

  it("preserves every submitted value after an invalid save", async () => {
    vi.mocked(saveOwnerApplicationAction).mockImplementation(
      async (_previous, formData) => ({
        status: "invalid",
        fields: ["capacity"],
        values: {
          applicantKind: String(formData.get("applicantKind")),
          legalName: String(formData.get("legalName")),
          companyName: String(formData.get("companyName")),
          licensingBasis: String(formData.get("licensingBasis")),
          exemptionBasis: String(formData.get("exemptionBasis")),
          cottageName: String(formData.get("cottageName")),
          governorate: String(formData.get("governorate")),
          approximateLocation: String(formData.get("approximateLocation")),
          exactAddress: String(formData.get("exactAddress")),
          capacity: String(formData.get("capacity")),
          bedrooms: String(formData.get("bedrooms")),
          bathrooms: String(formData.get("bathrooms")),
          amenities: formData.getAll("amenities").map(String),
          description: String(formData.get("description")),
          houseRules: String(formData.get("houseRules")),
        },
      }),
    );
    render(<OwnerApplicationForm locale="en" application={draft} />);
    fireEvent.change(screen.getByLabelText("Legal name"), {
      target: { value: "Updated Legal Name" },
    });
    fireEvent.change(screen.getByLabelText("Guest capacity"), {
      target: { value: "101" },
    });

    fireEvent.submit(
      screen.getByRole("button", { name: "Save draft" }).closest("form")!,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Check the marked fields and try again."),
      ).toBeVisible(),
    );
    expect(screen.getByLabelText("Legal name")).toHaveValue(
      "Updated Legal Name",
    );
    expect(screen.getByLabelText("Guest capacity")).toHaveValue(101);
    expect(screen.getByLabelText(/Guest capacity/)).toHaveAttribute(
      "aria-describedby",
      "owner-application-capacity-error",
    );
    expect(
      document.getElementById("owner-application-capacity-error"),
    ).toHaveTextContent("Check this field.");
    expect(screen.getByLabelText("Garden")).toBeChecked();
    expect(screen.getByLabelText("Parking")).toBeChecked();
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

  it("names every missing item when submission is incomplete", async () => {
    vi.mocked(submitOwnerApplicationAction).mockResolvedValue({
      status: "incomplete",
      missingItems: ["legal_name", "document:payout_account"],
    });
    render(<OwnerApplicationForm locale="en" application={draft} />);

    fireEvent.submit(
      screen
        .getByRole("button", { name: "Submit application" })
        .closest("form")!,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Complete these items before submitting:"),
      ).toBeVisible(),
    );
    const guidance = screen.getByRole("alert");
    expect(within(guidance).getByText("Legal name")).toBeVisible();
    expect(within(guidance).getByText("Payout-account evidence")).toBeVisible();
  });
});
