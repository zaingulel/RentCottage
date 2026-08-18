import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClient,
  createCottageProfile,
  createCottagePublication,
  createCottageShiftSchedule,
  resolveContext,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  createCottageProfile: vi.fn(),
  createCottagePublication: vi.fn(),
  createCottageShiftSchedule: vi.fn(),
  resolveContext: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("@/access/supabase-account-access", () => ({
  SupabaseAccountContextStore: class {
    resolve() {
      return resolveContext();
    }
  },
}));
vi.mock("@/cottage-profile/request-cottage-profile", () => ({
  createRequestCottageProfile: createCottageProfile,
}));
vi.mock("@/cottage-publication/request-cottage-publication", () => ({
  createRequestCottagePublication: createCottagePublication,
}));
vi.mock("@/cottage-shift-schedule/request-cottage-shift-schedule", () => ({
  createRequestCottageShiftSchedule: createCottageShiftSchedule,
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

import OwnerCottageProfilePage from "./page";

describe("Cottage Profile owner detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({});
  });

  it("directs a prospective owner back to their Owner Application", async () => {
    resolveContext.mockResolvedValue({
      role: "cottage_owner",
      approvalState: "prospective",
    });

    render(
      await OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId: "not-owned" }),
      }),
    );

    expect(
      screen.getByText(
        /Continue your first Cottage Profile in Owner Application/,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open Owner Application" }),
    ).toHaveAttribute("href", "/en/owner/application");
  });

  it("directs a non-owner to the dedicated owner access action", async () => {
    resolveContext.mockResolvedValue({ role: "customer" });

    render(
      await OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId: "not-owned" }),
      }),
    );

    expect(
      screen.getByRole("link", { name: "Verify Cottage Owner access" }),
    ).toHaveAttribute("href", "/en/owner/access");
    expect(
      screen.queryByRole("link", { name: "Open Owner Application" }),
    ).not.toBeInTheDocument();
  });

  it("loads the current Shift Schedule into a separate owner editor", async () => {
    const profileId = "70000000-0000-4000-8000-000000000001";
    resolveContext.mockResolvedValue({
      role: "cottage_owner",
      approvalState: "approved",
    });
    createCottageProfile.mockResolvedValue({
      load: vi.fn().mockResolvedValue({
        id: profileId,
        ownerUserId: "10000000-0000-4000-8000-000000000701",
        applicationId: null,
        status: "draft",
        version: 1,
        name: "Cottage",
        governorate: "Erbil",
        approximateLocation: "Shaqlawa",
        exactAddress: "Private",
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
        updatedAt: "2026-08-18T10:00:00.000Z",
      }),
    });
    createCottagePublication.mockResolvedValue({
      loadCurrentReview: vi.fn().mockResolvedValue(null),
    });
    const loadCurrent = vi.fn().mockResolvedValue({
      status: "loaded",
      schedule: null,
    });
    createCottageShiftSchedule.mockResolvedValue({ loadCurrent });

    render(
      await OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId }),
      }),
    );

    expect(loadCurrent).toHaveBeenCalledWith(profileId);
    expect(
      screen.getByRole("heading", { name: "Daily Shift Schedule" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save Shift Schedule" }),
    ).toBeEnabled();
  });
});
