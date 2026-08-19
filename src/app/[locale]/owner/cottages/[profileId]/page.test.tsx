import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClient,
  createCottageProfile,
  createCottagePublication,
  createCottageInventory,
  createCottageShiftSchedule,
  resolveContext,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  createCottageProfile: vi.fn(),
  createCottagePublication: vi.fn(),
  createCottageInventory: vi.fn(),
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
vi.mock("@/cottage-inventory/request-cottage-inventory", () => ({
  createRequestCottageInventory: createCottageInventory,
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
    createCottageInventory.mockResolvedValue({
      loadOwnerEditorState: vi.fn(),
    });

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

  it("keeps operational pricing editable during content review but blocks opening before publication", async () => {
    const profileId = "70000000-0000-4000-8000-000000000002";
    resolveContext.mockResolvedValue({
      role: "cottage_owner",
      approvalState: "approved",
    });
    createCottageProfile.mockResolvedValue({
      load: vi.fn().mockResolvedValue({
        id: profileId,
        ownerUserId: "10000000-0000-4000-8000-000000000702",
        applicationId: null,
        currentPublicationId: null,
        status: "submitted_for_content_approval",
        version: 2,
        name: "Submitted Cottage",
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
        submittedSourceRevision: {
          revision: 1,
          ownerUserId: "10000000-0000-0000-0000-000000000702",
          sourceLanguage: "en",
          description: "Description",
          houseRules: "Rules",
          submittedAt: "2026-08-18T10:00:00.000Z",
        },
        updatedAt: "2026-08-18T10:00:00.000Z",
      }),
    });
    createCottagePublication.mockResolvedValue({
      loadCurrentReview: vi.fn().mockResolvedValue(null),
    });
    createCottageShiftSchedule.mockResolvedValue({
      loadCurrent: vi.fn().mockResolvedValue({
        status: "loaded",
        schedule: {
          profileId,
          scheduleRevisionId: "71000000-0000-4000-8000-000000000002",
          revision: 2,
          shifts: [
            {
              id: "72000000-0000-4000-8000-000000000003",
              name: "Morning",
              startTime: "08:00",
              endTime: "12:00",
              position: 1,
              crossesMidnight: false,
            },
            {
              id: "72000000-0000-4000-8000-000000000004",
              name: "Evening",
              startTime: "18:00",
              endTime: "22:00",
              position: 2,
              crossesMidnight: false,
            },
          ],
          fullDayBundleId: "73000000-0000-4000-8000-000000000002",
          fullDayShiftIds: [
            "72000000-0000-4000-8000-000000000003",
            "72000000-0000-4000-8000-000000000004",
          ],
          fullDayStartTime: "08:00",
          fullDayEndTime: "22:00",
          fullDayCrossesMidnight: false,
        },
      }),
    });
    const loadOwnerEditorState = vi.fn().mockResolvedValue({
      status: "loaded",
      state: {
        profileId,
        scheduleRevisionId: "71000000-0000-4000-8000-000000000002",
        serviceDay: null,
        units: [
          {
            id: "72000000-0000-4000-8000-000000000003",
            kind: "shift",
            standardPriceIqd: 125000,
            weekdayOverrides: [{ weekday: 4, priceIqd: 160000 }],
            dateOverrides: [{ serviceDay: "2099-08-20", priceIqd: 180000 }],
          },
          {
            id: "72000000-0000-4000-8000-000000000004",
            kind: "shift",
            standardPriceIqd: 115000,
            weekdayOverrides: [],
            dateOverrides: [],
          },
          {
            id: "73000000-0000-4000-8000-000000000002",
            kind: "full_day_bundle",
            standardPriceIqd: 220000,
            weekdayOverrides: [],
            dateOverrides: [],
          },
        ],
      },
    });
    createCottageInventory.mockResolvedValue({ loadOwnerEditorState });

    render(
      await OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Pricing and availability" }),
    ).toBeVisible();
    expect(loadOwnerEditorState).toHaveBeenCalledWith(
      profileId,
      "71000000-0000-4000-8000-000000000002",
    );
    expect(
      screen.queryByText(
        "Pricing and availability are temporarily unavailable. Please try again.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Shift 1 standard price in IQD")).toHaveValue(
      125000,
    );
    expect(screen.getByLabelText("Shift 1 weekday override")).toHaveValue("4");
    expect(
      screen.getByLabelText("Shift 1 weekday override standard price in IQD"),
    ).toHaveValue(160000);
    expect(screen.getByLabelText("Shift 1 specific-date override")).toHaveValue(
      "2099-08-20",
    );
    expect(
      screen.getByLabelText(
        "Shift 1 specific-date override standard price in IQD",
      ),
    ).toHaveValue(180000);
    expect(screen.getByLabelText("Cottage name")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save availability" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/configure prices before publication/i),
    ).toBeVisible();
  });

  it.each(["expired", "suspended"] as const)(
    "renders persisted inventory read-only for an %s Cottage Owner",
    async (approvalState) => {
      const profileId = "70000000-0000-4000-8000-000000000003";
      const scheduleRevisionId = "71000000-0000-4000-8000-000000000003";
      const shiftId = "72000000-0000-4000-8000-000000000005";
      const bundleId = "73000000-0000-4000-8000-000000000003";
      resolveContext.mockResolvedValue({
        role: "cottage_owner",
        approvalState,
      });
      createCottageProfile.mockResolvedValue({
        load: vi.fn().mockResolvedValue({
          id: profileId,
          ownerUserId: "10000000-0000-4000-8000-000000000703",
          applicationId: null,
          currentPublicationId: null,
          status: "draft",
          version: 1,
          name: "Read-only Cottage",
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
      createCottageShiftSchedule.mockResolvedValue({
        loadCurrent: vi.fn().mockResolvedValue({
          status: "loaded",
          schedule: {
            profileId,
            scheduleRevisionId,
            revision: 1,
            shifts: [
              {
                id: shiftId,
                name: "Morning",
                startTime: "08:00",
                endTime: "12:00",
                position: 1,
                crossesMidnight: false,
              },
            ],
            fullDayBundleId: bundleId,
            fullDayShiftIds: [shiftId],
            fullDayStartTime: "08:00",
            fullDayEndTime: "12:00",
            fullDayCrossesMidnight: false,
          },
        }),
      });
      const loadOwnerEditorState = vi.fn().mockResolvedValue({
        status: "loaded",
        state: {
          profileId,
          scheduleRevisionId,
          serviceDay: null,
          units: [
            {
              id: shiftId,
              kind: "shift",
              standardPriceIqd: 125000,
              weekdayOverrides: [],
              dateOverrides: [],
            },
            {
              id: bundleId,
              kind: "full_day_bundle",
              standardPriceIqd: 220000,
              weekdayOverrides: [],
              dateOverrides: [],
            },
          ],
        },
      });
      createCottageInventory.mockResolvedValue({ loadOwnerEditorState });

      render(
        await OwnerCottageProfilePage({
          params: Promise.resolve({ locale: "en", profileId }),
        }),
      );

      expect(loadOwnerEditorState).toHaveBeenCalledWith(
        profileId,
        scheduleRevisionId,
      );
      expect(
        screen.getByLabelText("Shift 1 standard price in IQD"),
      ).toHaveValue(125000);
      expect(
        screen.getByLabelText("Shift 1 standard price in IQD"),
      ).toBeDisabled();
      expect(
        screen.getByText(/pricing and availability are read-only/i),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Save prices" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByLabelText(/Service Day/, { selector: "input" }),
      ).toBeEnabled();
      expect(
        screen.getByRole("button", { name: "Load availability" }),
      ).toBeEnabled();
      expect(
        screen.queryByRole("button", { name: "Save availability" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          "Pricing and availability are temporarily unavailable. Please try again.",
        ),
      ).not.toBeInTheDocument();
    },
  );
});
