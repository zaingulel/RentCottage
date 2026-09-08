import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createCottageInventory,
  createCottagePublication,
  createCottageShiftSchedule,
  loadOwnerCottageAccess,
} = vi.hoisted(() => ({
  createCottageInventory: vi.fn(),
  createCottagePublication: vi.fn(),
  createCottageShiftSchedule: vi.fn(),
  loadOwnerCottageAccess: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/cottage-inventory/request-cottage-inventory", () => ({
  createRequestCottageInventory: createCottageInventory,
}));
vi.mock("@/cottage-publication/request-cottage-publication", () => ({
  createRequestCottagePublication: createCottagePublication,
}));
vi.mock("@/cottage-shift-schedule/request-cottage-shift-schedule", () => ({
  createRequestCottageShiftSchedule: createCottageShiftSchedule,
}));
vi.mock("./request-owner-cottage-access", () => ({
  loadOwnerCottageAccess,
}));

import { loadOwnerCottageEditor } from "./owner-cottage-editor";

const profileId = "70000000-0000-4000-8000-000000000203";
const scheduleRevisionId = "71000000-0000-4000-8000-000000000203";
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
};

const pricing = {
  profileId,
  scheduleRevisionId,
  serviceDay: null,
  units: [
    {
      id: shiftId,
      kind: "shift" as const,
      standardPriceIqd: 125000,
      weekdayOverrides: [],
      dateOverrides: [],
    },
    {
      id: bundleId,
      kind: "full_day_bundle" as const,
      standardPriceIqd: 220000,
      weekdayOverrides: [],
      dateOverrides: [],
    },
  ],
};

describe("loadOwnerCottageEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const cottageProfile = { load: vi.fn().mockResolvedValue(profile) };
    loadOwnerCottageAccess.mockImplementation(async (load) => ({
      status: "ready",
      value: await load(cottageProfile, "approved"),
    }));
    createCottagePublication.mockResolvedValue({
      loadCurrentReview: vi.fn().mockResolvedValue(null),
    });
    createCottageShiftSchedule.mockResolvedValue({
      loadCurrent: vi.fn().mockResolvedValue({ status: "loaded", schedule }),
    });
    createCottageInventory.mockResolvedValue({
      loadOwnerEditorState: vi
        .fn()
        .mockResolvedValue({ status: "loaded", state: pricing }),
    });
  });

  it.each(["access_required", "prospective"] as const)(
    "returns %s before constructing editor resources",
    async (status) => {
      loadOwnerCottageAccess.mockResolvedValue({ status });

      await expect(loadOwnerCottageEditor(profileId)).resolves.toEqual({
        status,
      });

      expect(createCottagePublication).not.toHaveBeenCalled();
      expect(createCottageShiftSchedule).not.toHaveBeenCalled();
      expect(createCottageInventory).not.toHaveBeenCalled();
    },
  );

  it("returns the first factory failure before constructing later resources", async () => {
    const factoryFailure = new Error("publication factory failed");
    createCottagePublication.mockRejectedValue(factoryFailure);

    await expect(loadOwnerCottageEditor(profileId)).resolves.toEqual({
      status: "unavailable",
      error: factoryFailure,
    });
    expect(createCottageShiftSchedule).not.toHaveBeenCalled();
    expect(createCottageInventory).not.toHaveBeenCalled();
  });

  it("assembles the approved editor data from the parallel reads", async () => {
    const result = await loadOwnerCottageEditor(profileId);

    expect(result).toMatchObject({
      status: "ready",
      value: { profile, review: null, schedule, pricing, editable: true },
    });
  });

  it("keeps ready data editable without pricing when no schedule revision exists", async () => {
    const loadOwnerEditorState = vi.fn();
    createCottageShiftSchedule.mockResolvedValue({
      loadCurrent: vi.fn().mockResolvedValue({
        status: "loaded",
        schedule: null,
      }),
    });
    createCottageInventory.mockResolvedValue({ loadOwnerEditorState });

    await expect(loadOwnerCottageEditor(profileId)).resolves.toMatchObject({
      status: "ready",
      value: { schedule: null, pricing: null, editable: true },
    });
    expect(loadOwnerEditorState).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-loaded schedule", { status: "unavailable" }],
    ["a non-loaded inventory", { status: "unavailable" }],
  ])("returns unavailable for %s", async (label, result) => {
    if (label === "a non-loaded schedule") {
      createCottageShiftSchedule.mockResolvedValue({
        loadCurrent: vi.fn().mockResolvedValue(result),
      });
    } else {
      createCottageInventory.mockResolvedValue({
        loadOwnerEditorState: vi.fn().mockResolvedValue(result),
      });
    }

    await expect(loadOwnerCottageEditor(profileId)).resolves.toMatchObject({
      status: "unavailable",
      error: expect.any(Error),
    });
  });

  it("keeps the original failed read as the unavailable error", async () => {
    const readFailure = new Error("profile read failed");
    loadOwnerCottageAccess.mockImplementation(async (load) => ({
      status: "ready",
      value: await load(
        { load: vi.fn().mockRejectedValue(readFailure) },
        "approved",
      ),
    }));

    await expect(loadOwnerCottageEditor(profileId)).resolves.toEqual({
      status: "unavailable",
      error: readFailure,
    });
  });

  it("keeps a missing Cottage Profile ready for the page navigation decision", async () => {
    loadOwnerCottageAccess.mockImplementation(async (load) => ({
      status: "ready",
      value: await load({ load: vi.fn().mockResolvedValue(null) }, "approved"),
    }));

    await expect(loadOwnerCottageEditor(profileId)).resolves.toMatchObject({
      status: "ready",
      value: { profile: null },
    });
  });

  it.each([
    ["the wrong unit count", pricing.units.slice(0, 1)],
    [
      "an unexpected unit id",
      [
        { ...pricing.units[0], id: "72000000-0000-4000-8000-000000000299" },
        pricing.units[1],
      ],
    ],
    [
      "the wrong unit kind",
      [{ ...pricing.units[0], kind: "full_day_bundle" }, pricing.units[1]],
    ],
  ])("returns unavailable for %s", async (_reason, units) => {
    createCottageInventory.mockResolvedValue({
      loadOwnerEditorState: vi.fn().mockResolvedValue({
        status: "loaded",
        state: { ...pricing, units },
      }),
    });

    await expect(loadOwnerCottageEditor(profileId)).resolves.toMatchObject({
      status: "unavailable",
      error: expect.any(Error),
    });
  });
});
