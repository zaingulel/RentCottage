import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/cottage-profile/actions", () => ({
  abandonOwnerCottageProfileAction: vi.fn(),
  abandonAdministratorCottageProfileAction: vi.fn(),
  restoreAdministratorCottageProfileAction: vi.fn(),
}));

import type { CottageProfile } from "@/cottage-profile/cottage-profile";
import { CottageProfileLifecycleControls } from "./cottage-profile-lifecycle-controls";

const profile = {
  id: "70000000-0000-4000-8000-000000000002",
  ownerUserId: "10000000-0000-4000-8000-000000000701",
  applicationId: null,
  currentPublicationId: null,
  status: "draft",
  version: 1,
  name: "Additional Cottage",
  governorate: "Erbil",
  approximateLocation: "Shaqlawa",
  exactAddress: "Private address",
  exactLatitude: 36.4,
  exactLongitude: 44.3,
  privateDirections: "Private directions",
  capacity: 6,
  bedrooms: 3,
  bathrooms: 2,
  amenities: ["garden"],
  sourceLanguage: "en",
  description: "Description",
  houseRules: "Rules",
  photos: [],
  submittedSourceRevision: null,
  updatedAt: "2026-08-22T09:00:00.000Z",
} satisfies CottageProfile;

describe("Cottage Profile lifecycle controls", () => {
  it("offers owner abandonment only for an eligible additional unpublished draft", () => {
    const { rerender } = render(
      <CottageProfileLifecycleControls
        locale="en"
        actor="owner"
        profile={profile}
        eligible
      />,
    );

    expect(screen.getByRole("button", { name: "Abandon draft" })).toBeEnabled();

    rerender(
      <CottageProfileLifecycleControls
        locale="en"
        actor="owner"
        profile={{
          ...profile,
          applicationId: "20000000-0000-4000-8000-000000000701",
        }}
        eligible
      />,
    );
    expect(screen.queryByRole("button", { name: "Abandon draft" })).toBeNull();
  });

  it("offers an AAL2 administrator a reasoned RTL restore only for an approved owner", () => {
    const { rerender } = render(
      <CottageProfileLifecycleControls
        locale="ckb"
        actor="administrator"
        profile={{ ...profile, status: "abandoned" }}
        eligible
      />,
    );

    expect(screen.getByLabelText("هۆکاری بەڕێوەبەر")).toBeRequired();
    expect(
      screen.getByRole("button", { name: "گەڕاندنەوەی ڕەشنووس" }),
    ).toBeEnabled();

    rerender(
      <CottageProfileLifecycleControls
        locale="ckb"
        actor="administrator"
        profile={{ ...profile, status: "abandoned" }}
        eligible={false}
      />,
    );
    expect(screen.queryByLabelText("هۆکاری بەڕێوەبەر")).toBeNull();
  });
});
