import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/cottage-profile/actions", () => ({
  createCottageProfileDraftAction: vi.fn(),
}));

import type { CottageProfile } from "@/cottage-profile/cottage-profile";
import { createCottageProfileDraftAction } from "@/cottage-profile/actions";
import { CottageProfileOverview } from "./cottage-profile-overview";

const profile = {
  id: "70000000-0000-4000-8000-000000000001",
  ownerUserId: "10000000-0000-4000-8000-000000000701",
  applicationId: "20000000-0000-4000-8000-000000000701",
  currentPublicationId: null,
  status: "draft",
  version: 1,
  name: "Application Cottage",
  governorate: "Erbil",
  approximateLocation: "Near Shaqlawa",
  exactAddress: "Private address",
  exactLatitude: null,
  exactLongitude: null,
  privateDirections: "",
  capacity: 8,
  bedrooms: 3,
  bathrooms: 2,
  amenities: ["garden"],
  sourceLanguage: "en",
  description: "Description",
  houseRules: "Rules",
  photos: [],
  submittedSourceRevision: null,
  updatedAt: "2026-08-17T09:00:00.000Z",
} satisfies CottageProfile;

describe("Cottage Profile overview", () => {
  it("shows the continued application profile and allows approved owners to add another draft", () => {
    render(
      <CottageProfileOverview
        locale="en"
        actor="owner"
        profiles={[profile]}
        canCreate
      />,
    );

    expect(screen.getByText("Started in Owner Application")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open Cottage Profile" }),
    ).toHaveAttribute(
      "href",
      "/en/owner/cottages/70000000-0000-4000-8000-000000000001",
    );
    expect(
      screen.getByRole("button", { name: "Create another cottage draft" }),
    ).toBeEnabled();
  });

  it("announces localized feedback when draft creation is denied", async () => {
    vi.mocked(createCottageProfileDraftAction).mockResolvedValue({
      status: "denied",
    });
    render(
      <CottageProfileOverview
        locale="ar"
        actor="owner"
        profiles={[profile]}
        canCreate
      />,
    );

    fireEvent.submit(
      screen
        .getByRole("button", { name: "إنشاء مسودة كوخ أخرى" })
        .closest("form")!,
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "لا يمكن لحساب المالك هذا إنشاء مسودة كوخ أخرى.",
      ),
    );
  });

  it.each([
    [
      "capacity_limit",
      "You can have up to 20 open unpublished Cottage Profiles.",
    ],
    [
      "rate_limit",
      "You can create up to 20 additional Cottage Profiles in 24 hours.",
    ],
  ] as const)("announces the distinct %s outcome", async (status, message) => {
    vi.mocked(createCottageProfileDraftAction).mockResolvedValue({ status });
    render(
      <CottageProfileOverview
        locale="en"
        actor="owner"
        profiles={[profile]}
        canCreate
      />,
    );

    fireEvent.submit(
      screen
        .getByRole("button", { name: "Create another cottage draft" })
        .closest("form")!,
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(message),
    );
  });

  it("keeps lifecycle controls out of the overview where owner eligibility is unavailable", () => {
    render(
      <CottageProfileOverview
        locale="en"
        actor="owner"
        profiles={[
          profile,
          {
            ...profile,
            id: "70000000-0000-4000-8000-000000000002",
            applicationId: null,
          },
        ]}
        canCreate
      />,
    );

    expect(screen.queryByRole("button", { name: "Abandon draft" })).toBeNull();
  });

  it("labels an abandoned administrator profile without offering an ungrounded lifecycle control", () => {
    render(
      <CottageProfileOverview
        locale="ckb"
        actor="administrator"
        profiles={[{ ...profile, applicationId: null, status: "abandoned" }]}
      />,
    );

    expect(screen.getByText("وازهێنراو")).toBeVisible();
    expect(screen.queryByLabelText("هۆکاری بەڕێوەبەر")).toBeNull();
  });

  it("shows a localized administrator continuation link", () => {
    render(
      <CottageProfileOverview
        locale="ar"
        actor="administrator"
        profiles={[profile]}
        continuationHref="/ar/administrator/cottages?afterProfileId=next"
      />,
    );

    expect(
      screen.getByRole("link", { name: "ملفات الأكواخ التالية" }),
    ).toHaveAttribute("href", "/ar/administrator/cottages?afterProfileId=next");
  });
});
