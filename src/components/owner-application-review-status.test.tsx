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
  it("shows Sorani dates without Sorani locale data", () => {
    const RealDateTimeFormat = Intl.DateTimeFormat;
    const dateTimeFormat = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(function (locales, options) {
        const first = Array.isArray(locales) ? locales[0] : locales;
        return new RealDateTimeFormat(
          typeof first === "string" && first.startsWith("ckb")
            ? "en-US"
            : locales,
          options,
        );
      });
    const instants = ["2026-10-17T12:34:56Z"];
    try {
      for (const [locale, expected] of [
        ["ckb", ["٢٠٢٦ تشرینی یەکەم ١٧ ٣:٣٤ د.ن"]],
        ["en", ["Oct 17, 2026, 3:34 PM"]],
        ["ar", ["17\u200f/10\u200f/2026، 3:34 م"]],
      ] as const) {
        const { container, unmount } = render(
          <OwnerApplicationReviewStatus
            locale={locale}
            application={application}
            review={{
              ...review,
              notices: [{ ...review.notices[0], createdAt: instants[0] }],
            }}
          />,
        );
        const times = container.querySelectorAll("time");
        expect(times).toHaveLength(instants.length);
        for (const [index, time] of times.entries()) {
          expect(time).toBeVisible();
          expect(time.textContent).toBe(expected[index]);
          expect(time).toHaveAttribute("datetime", instants[index]);
        }
        unmount();
      }
    } finally {
      dateTimeFormat.mockRestore();
    }
  });

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
    expect(
      screen.getByLabelText("Exact private address (optional)"),
    ).toHaveValue("Private road");
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

  it("lets the owner leave a requested exact address blank and requires other requested text", () => {
    render(
      <OwnerApplicationReviewStatus
        locale="en"
        application={application}
        review={{
          ...review,
          activeRequest: {
            reason: "Confirm the address and the governorate.",
            requestedFields: ["exact_address", "governorate", "amenities"],
            requestedDocumentKinds: [],
          },
        }}
      />,
    );

    expect(
      screen.getByLabelText("Exact private address (optional)"),
    ).not.toBeRequired();
    expect(screen.getByLabelText("Governorate")).toBeRequired();
    expect(screen.getByLabelText("Garden").closest("label")).toHaveClass(
      "choice-control",
    );
    expect(screen.getByRole("group", { name: "amenities" })).toHaveClass(
      "option-group",
    );
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
