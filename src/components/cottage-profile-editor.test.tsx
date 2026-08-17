import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/cottage-profile/actions", () => ({
  deleteCottageProfilePhotoAction: vi.fn(),
  previewCottageProfilePhotoAction: vi.fn(),
  saveAdministratorCottageProfileAction: vi.fn(),
  saveOwnerCottageProfileAction: vi.fn(),
  submitCottageProfileAction: vi.fn(),
  uploadCottageProfilePhotoAction: vi.fn(),
}));

import type { CottageProfile } from "@/cottage-profile/cottage-profile";
import { previewCottageProfilePhotoAction } from "@/cottage-profile/actions";
import { CottageProfileEditor } from "./cottage-profile-editor";

const profile: CottageProfile = {
  id: "70000000-0000-4000-8000-000000000001",
  ownerUserId: "10000000-0000-4000-8000-000000000701",
  applicationId: "20000000-0000-4000-8000-000000000701",
  status: "draft",
  version: 2,
  name: "Continued Application Cottage",
  governorate: "Erbil",
  approximateLocation: "Near Shaqlawa",
  exactAddress: "Private exact address",
  exactLatitude: 36.408333,
  exactLongitude: 44.385834,
  privateDirections: "Continue past the orchard gate.",
  capacity: 10,
  bedrooms: 4,
  bathrooms: 3,
  amenities: ["garden", "wifi"],
  sourceLanguage: "en",
  description: "Owner working-copy description",
  houseRules: "Owner working-copy House Rules",
  photos: [],
  submittedSourceRevision: null,
  updatedAt: "2026-08-17T09:00:00.000Z",
};

describe("Cottage Profile editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes the complete structured editor and distinguishes private location data", () => {
    render(
      <CottageProfileEditor
        locale="en"
        profile={profile}
        actor="owner"
        editable
      />,
    );

    expect(screen.getByLabelText("Cottage name")).toHaveValue(
      "Continued Application Cottage",
    );
    expect(screen.getByLabelText("Approximate public location")).toHaveValue(
      "Near Shaqlawa",
    );
    expect(screen.getByLabelText("Exact private address")).toHaveValue(
      "Private exact address",
    );
    expect(screen.getByLabelText("Latitude")).toHaveValue(36.408333);
    expect(screen.getByLabelText("Longitude")).toHaveValue(44.385834);
    expect(
      screen.getByText(
        "Exact address, coordinates and directions stay private and are never shown in the public listing.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save private draft" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Submit for content approval" }),
    ).toBeEnabled();
  });

  it("freezes owner edits after submission and shows the preserved source", () => {
    render(
      <CottageProfileEditor
        locale="en"
        actor="owner"
        editable={false}
        profile={{
          ...profile,
          status: "submitted_for_content_approval",
          version: 3,
          submittedSourceRevision: {
            revision: 1,
            ownerUserId: profile.ownerUserId,
            sourceLanguage: "en",
            description: "Submitted owner description",
            houseRules: "Submitted owner rules",
            submittedAt: "2026-08-17T09:10:00.000Z",
          },
        }}
      />,
    );

    expect(screen.getByText("Submitted for content approval")).toBeVisible();
    expect(screen.getByLabelText("Cottage name")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save private draft" }),
    ).toBeNull();
    expect(screen.getByText("Submitted owner description")).toBeVisible();
    expect(screen.getByText("Submitted owner rules")).toBeVisible();
  });

  it.each([
    ["ar", "denied", "لا يُسمح لك بمعاينة هذه الصورة الخاصة."],
    [
      "ckb",
      "unavailable",
      "پێشبینینی وێنە تایبەتەکە کاتێک بەردەست نییە. دووبارە هەوڵ بدە.",
    ],
  ] as const)(
    "announces a localized %s private-photo preview failure",
    async (locale, status, message) => {
      vi.mocked(previewCottageProfilePhotoAction).mockResolvedValue({ status });
      render(
        <CottageProfileEditor
          locale={locale}
          actor="owner"
          editable
          profile={{
            ...profile,
            photos: [
              {
                id: "71000000-0000-4000-8000-000000000001",
                originalFilename: "private-cottage.webp",
                mediaType: "image/webp",
                sizeBytes: 128,
                state: "ready",
                updatedAt: "2026-08-17T09:05:00.000Z",
              },
            ],
          }}
        />,
      );

      fireEvent.submit(
        screen
          .getByRole("button", { name: /پێشبینین|معاينة/ })
          .closest("form")!,
      );

      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(message),
      );
    },
  );
});
