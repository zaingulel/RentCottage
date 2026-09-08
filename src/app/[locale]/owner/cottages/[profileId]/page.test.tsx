import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadOwnerCottageEditor, notFound, unstableRethrow } = vi.hoisted(
  () => ({
    loadOwnerCottageEditor: vi.fn(),
    notFound: vi.fn(),
    unstableRethrow: vi.fn(),
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("@/cottage-profile/owner-cottage-editor", () => ({
  loadOwnerCottageEditor,
}));
vi.mock("next/navigation", () => ({
  notFound,
  unstable_rethrow: unstableRethrow,
}));

import OwnerCottageProfilePage from "./page";

const profileId = "70000000-0000-4000-8000-000000000203";
const shiftId = "72000000-0000-4000-8000-000000000203";
const bundleId = "73000000-0000-4000-8000-000000000203";

const profile = {
  id: profileId,
  ownerUserId: "10000000-0000-4000-8000-000000000203",
  applicationId: null,
  currentPublicationId: null,
  status: "draft" as const,
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
  sourceLanguage: "en" as const,
  description: "Description",
  houseRules: "Rules",
  photos: [],
  submittedSourceRevision: null,
  updatedAt: "2026-09-08T10:00:00.000Z",
};

const schedule = {
  profileId,
  scheduleRevisionId: "71000000-0000-4000-8000-000000000203",
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
};

const pricing = {
  profileId,
  scheduleRevisionId: schedule.scheduleRevisionId,
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
};

function ready(value = {}) {
  return {
    status: "ready" as const,
    value: {
      profile,
      review: null,
      schedule,
      pricing: null,
      editable: true,
      ...value,
    },
  };
}

describe("Cottage Profile owner detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["access_required", "Verify Cottage Owner access", "/en/owner/access"],
    ["prospective", "Open Owner Application", "/en/owner/application"],
  ] as const)("renders the %s owner fallback", async (status, name, href) => {
    loadOwnerCottageEditor.mockResolvedValue({ status });

    render(
      await OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId }),
      }),
    );

    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
  });

  it("renders unavailable data after allowing framework interrupts to escape", async () => {
    const failure = new Error("editor data unavailable");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    loadOwnerCottageEditor.mockResolvedValue({
      status: "unavailable",
      error: failure,
    });

    render(
      await OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId }),
      }),
    );

    expect(unstableRethrow).toHaveBeenCalledWith(failure);
    expect(log).toHaveBeenCalledWith(
      "Owner Cottage Profile editor load failed",
      {
        phase: "owner_cottage_profile_editor_load",
        result: "unavailable",
      },
    );
    expect(
      screen.getByText(
        "Cottage Profiles are temporarily unavailable. Please try again.",
      ),
    ).toBeVisible();
    log.mockRestore();
  });

  it("keeps owner navigation and draft editor controls", async () => {
    loadOwnerCottageEditor.mockResolvedValue(ready());

    render(
      await OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId }),
      }),
    );

    expect(
      screen.getByRole("link", { name: "Back to cottages" }),
    ).toHaveAttribute("href", "/en/owner/cottages");
    expect(screen.getByLabelText("Cottage name")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Save Shift Schedule" }),
    ).toBeEnabled();
  });

  it("keeps price setup editable during review while publication opening stays blocked", async () => {
    loadOwnerCottageEditor.mockResolvedValue(
      ready({
        profile: {
          ...profile,
          status: "submitted_for_content_approval",
          currentPublicationId: null,
        },
        pricing,
      }),
    );

    render(
      await OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId }),
      }),
    );

    expect(screen.getByLabelText("Cottage name")).toBeDisabled();
    expect(
      screen.getByLabelText("Shift 1 standard price in IQD"),
    ).toBeEnabled();
    expect(
      screen.getByText(/configure prices before publication/i),
    ).toBeVisible();
  });

  it("keeps editor controls disabled when the loaded editor is noneditable", async () => {
    loadOwnerCottageEditor.mockResolvedValue(
      ready({ pricing, editable: false }),
    );

    render(
      await OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId }),
      }),
    );

    expect(screen.getByLabelText("Cottage name")).toBeDisabled();
    expect(
      screen.getByLabelText("Shift 1 standard price in IQD"),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save availability" }),
    ).not.toBeInTheDocument();
  });

  it("keeps abandoned Cottage controls disabled", async () => {
    loadOwnerCottageEditor.mockResolvedValue(
      ready({ profile: { ...profile, status: "abandoned" }, pricing }),
    );

    render(
      await OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId }),
      }),
    );

    expect(screen.getByLabelText("Cottage name")).toBeDisabled();
    expect(
      screen.getByLabelText("Shift 1 standard price in IQD"),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save availability" }),
    ).not.toBeInTheDocument();
  });

  it("rethrows a framework interruption instead of rendering unavailable data", async () => {
    const interruption = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
    loadOwnerCottageEditor.mockResolvedValue({
      status: "unavailable",
      error: interruption,
    });
    unstableRethrow.mockImplementation(() => {
      throw interruption;
    });

    await expect(
      OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId }),
      }),
    ).rejects.toBe(interruption);
  });

  it("leaves missing Cottage Profile navigation to Next.js after assembly", async () => {
    const interruption = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
    loadOwnerCottageEditor.mockResolvedValue(ready({ profile: null }));
    notFound.mockImplementation(() => {
      throw interruption;
    });

    await expect(
      OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId }),
      }),
    ).rejects.toBe(interruption);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid locale before loading editor data", async () => {
    const interruption = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
    notFound.mockImplementation(() => {
      throw interruption;
    });

    await expect(
      OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "fr", profileId }),
      }),
    ).rejects.toBe(interruption);
    expect(loadOwnerCottageEditor).not.toHaveBeenCalled();
  });
});
