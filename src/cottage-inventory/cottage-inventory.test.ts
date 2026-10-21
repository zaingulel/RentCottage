import { describe, expect, it, vi } from "vitest";

import {
  createCottageInventory,
  type CottageInventoryRepository,
} from "./cottage-inventory";

const profileId = "70000000-0000-4000-8000-000000000001";
const revisionId = "71000000-0000-4000-8000-000000000001";
const shiftId = "72000000-0000-4000-8000-000000000001";

function repository(): CottageInventoryRepository {
  return {
    loadOwnerEditorState: vi.fn(async () => ({
      profileId,
      scheduleRevisionId: revisionId,
      serviceDay: null,
      units: [],
    })),
    savePricing: vi.fn(async (input) => input),
    setAvailabilityBatch:
      vi.fn<CottageInventoryRepository["setAvailabilityBatch"]>(),
    setAvailability: vi.fn(async (input) => input),
    resolvePublicAvailability: vi.fn(async () => ({
      profileId,
      scheduleRevisionId: revisionId,
      serviceDay: "2099-08-20",
      units: [],
    })),
    resolveOwnerCalendarSpan: vi.fn(async (input) => ({
      ...input,
      asOf: "2099-01-01T00:00:00Z",
      unitKeys: [],
      days: [],
    })),
    resolveOwnerCalendar: vi.fn(async () => ({
      profileId,
      scheduleRevisionId: revisionId,
      serviceDay: "2099-08-20",
      units: [],
    })),
  };
}

describe("Cottage Inventory", () => {
  it("loads persisted owner editor state and validates the requested Service Day", async () => {
    const store = repository();
    vi.mocked(store.loadOwnerEditorState).mockResolvedValue({
      profileId,
      scheduleRevisionId: revisionId,
      serviceDay: "2099-08-20",
      units: [
        {
          id: shiftId,
          kind: "shift",
          standardPriceIqd: 125000,
          weekdayOverrides: [{ weekday: 4, priceIqd: 160000 }],
          dateOverrides: [{ serviceDay: "2099-08-27", priceIqd: 180000 }],
          ownerState: "private_blocked",
        },
      ],
    });
    const inventory = createCottageInventory(store);

    await expect(
      inventory.loadOwnerEditorState(profileId, revisionId, "2099-08-20"),
    ).resolves.toMatchObject({
      status: "loaded",
      state: {
        units: [
          {
            standardPriceIqd: 125000,
            ownerState: "private_blocked",
          },
        ],
      },
    });
    await expect(
      inventory.loadOwnerEditorState(profileId, revisionId, "2026-02-31"),
    ).resolves.toEqual({ status: "invalid", fields: ["serviceDay"] });
    expect(store.loadOwnerEditorState).toHaveBeenCalledTimes(1);
  });

  it("rejects zero IQD pricing before persistence", async () => {
    const store = repository();
    const inventory = createCottageInventory(store);

    await expect(
      inventory.savePricing(profileId, revisionId, {
        units: [
          {
            id: shiftId,
            kind: "shift",
            standardPriceIqd: 0,
          },
        ],
      }),
    ).resolves.toEqual({
      status: "invalid",
      fields: ["units.0.standardPriceIqd"],
    });
    expect(store.savePricing).not.toHaveBeenCalled();
  });

  it("rejects impossible ISO Service Days before using the repository", async () => {
    const store = repository();
    const inventory = createCottageInventory(store);

    await expect(
      inventory.resolvePublicAvailability(profileId, revisionId, "2026-02-31"),
    ).resolves.toEqual({ status: "invalid", fields: ["resolution"] });
    await expect(
      inventory.setAvailability(profileId, revisionId, "2026-02-31", {
        units: [{ id: shiftId, kind: "shift", state: "closed" }],
      }),
    ).resolves.toEqual({ status: "invalid", fields: ["availability"] });
    await expect(
      inventory.savePricing(profileId, revisionId, {
        units: [
          {
            id: shiftId,
            kind: "shift",
            standardPriceIqd: 100000,
            dateOverrides: [{ serviceDay: "2026-02-31", priceIqd: 120000 }],
          },
        ],
      }),
    ).resolves.toEqual({
      status: "invalid",
      fields: ["units.0.dateOverrides.0"],
    });
    expect(store.resolvePublicAvailability).not.toHaveBeenCalled();
    expect(store.setAvailability).not.toHaveBeenCalled();
    expect(store.savePricing).not.toHaveBeenCalled();
  });

  it("keeps the public result limited to availability identity", async () => {
    const store: CottageInventoryRepository = {
      loadOwnerEditorState: vi.fn(async () => ({
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: null,
        units: [],
      })),
      savePricing: vi.fn(async (input) => input),
      setAvailabilityBatch:
        vi.fn<CottageInventoryRepository["setAvailabilityBatch"]>(),
      setAvailability: vi.fn(async (input) => input),
      resolvePublicAvailability: vi.fn(async () => ({
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
        units: [
          {
            id: shiftId,
            kind: "shift" as const,
            available: true,
          },
        ],
      })),
      resolveOwnerCalendarSpan: vi.fn(async (input) => ({
        ...input,
        asOf: "2099-01-01T00:00:00Z",
        unitKeys: [],
        days: [],
      })),
      resolveOwnerCalendar: vi.fn(async () => ({
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
        units: [],
      })),
    };
    const inventory = createCottageInventory(store);

    await expect(
      inventory.resolvePublicAvailability(profileId, revisionId, "2099-08-20"),
    ).resolves.toEqual({
      status: "resolved",
      resolution: {
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
        units: [{ id: shiftId, kind: "shift", available: true }],
      },
    });
    expect(store.resolvePublicAvailability).toHaveBeenCalledTimes(1);
  });

  it("keeps weekday and specific-date overrides in the pricing write", async () => {
    const store = repository();
    const inventory = createCottageInventory(store);

    await expect(
      inventory.savePricing(profileId, revisionId, {
        units: [
          {
            id: shiftId,
            kind: "shift",
            standardPriceIqd: 100000,
            weekdayOverrides: [{ weekday: 4, priceIqd: 150000 }],
            dateOverrides: [{ serviceDay: "2099-08-20", priceIqd: 180000 }],
          },
        ],
      }),
    ).resolves.toMatchObject({ status: "saved" });
    expect(store.savePricing).toHaveBeenCalledWith({
      profileId,
      scheduleRevisionId: revisionId,
      pricing: {
        units: [
          {
            id: shiftId,
            kind: "shift",
            standardPriceIqd: 100000,
            weekdayOverrides: [{ weekday: 4, priceIqd: 150000 }],
            dateOverrides: [{ serviceDay: "2099-08-20", priceIqd: 180000 }],
          },
        ],
      },
    });
  });
});

it("validates bounded owner calendar spans before persistence", async () => {
  const store = repository();
  const resolveOwnerCalendarSpan = vi.fn<
    CottageInventoryRepository["resolveOwnerCalendarSpan"]
  >(async (input) => ({
    ...input,
    asOf: "2099-01-01T00:00:00Z",
    unitKeys: [],
    days: [],
  }));
  const inventory = createCottageInventory({
    ...store,
    resolveOwnerCalendarSpan,
  });
  for (const [profile, revision, from, to] of [
    ["foreign", revisionId, "2099-01-01", "2099-01-01"],
    [profileId, "bad", "2099-01-01", "2099-01-01"],
    [profileId, revisionId, "2099-02-29", "2099-03-01"],
    [profileId, revisionId, "2099-01-02", "2099-01-01"],
    [profileId, revisionId, "2099-01-01", "2099-02-01"],
    [profileId, revisionId, "infinity", "2099-01-01"],
    [profileId, revisionId, "0000-01-01", "0000-01-01"],
  ]) {
    await expect(
      inventory.resolveOwnerCalendarSpan(profile!, revision!, from!, to!),
    ).resolves.toEqual({ status: "invalid", fields: ["calendar"] });
  }
  expect(resolveOwnerCalendarSpan).not.toHaveBeenCalled();
  for (const [from, to] of [
    ["2099-01-01", "2099-01-01"],
    ["2099-01-20", "2099-02-19"],
    ["2100-02-28", "2100-03-01"],
    ["2096-02-29", "2096-03-01"],
  ]) {
    await expect(
      inventory.resolveOwnerCalendarSpan(profileId, revisionId, from!, to!),
    ).resolves.toMatchObject({ status: "resolved" });
  }
  expect(resolveOwnerCalendarSpan).toHaveBeenCalledTimes(4);
  resolveOwnerCalendarSpan
    .mockRejectedValueOnce({ code: "42501" })
    .mockRejectedValueOnce({ code: "RC409" })
    .mockRejectedValueOnce(new Error("offline"));
  for (const status of ["denied", "conflict", "unavailable"]) {
    await expect(
      inventory.resolveOwnerCalendarSpan(
        profileId,
        revisionId,
        "2099-01-01",
        "2099-01-01",
      ),
    ).resolves.toEqual({ status });
  }
});

it("rejects invalid owner calendar batches before persistence", async () => {
  const store = repository();
  const setAvailabilityBatch = vi.fn().mockResolvedValue({ status: "saved" });
  const inventory = createCottageInventory({ ...store, setAvailabilityBatch });
  const batch = {
    from: "2096-01-31",
    to: "2096-02-01",
    unitKeys: [{ id: shiftId, kind: "shift" }],
    state: "closed",
    mode: "range",
    reviewConfirmed: false,
    replacePrivateBlocks: [],
    cells: ["2096-02-01", "2096-01-31"].map((serviceDay) => ({
      serviceDay,
      id: shiftId,
      kind: "shift",
      expectedOwnerState: "open",
    })),
  };
  const invalid = [
    null,
    [],
    {},
    { ...batch, extra: true },
    { ...batch, from: "2096-02-30" },
    { ...batch, from: "0000-01-01" },
    { ...batch, from: "2096-02-02" },
    { ...batch, to: "2096-03-02" },
    { ...batch, reviewConfirmed: "false" },
    { ...batch, reviewConfirmed: true },
    { ...batch, mode: "reviewed", reviewConfirmed: true },
    { ...batch, cells: [] },
    { ...batch, cells: [batch.cells[0], batch.cells[0]] },
    { ...batch, unitKeys: [batch.unitKeys[0], batch.unitKeys[0]] },
    { ...batch, unitKeys: [] },
    { ...batch, unitKeys: [{ id: "bad", kind: "shift" }] },
    { ...batch, state: "pending_hold" },
    { ...batch, cells: [{ ...batch.cells[0], extra: true }] },
    { ...batch, cells: [{ ...batch.cells[0], expectedOwnerState: null }] },
    { ...batch, cells: [{ ...batch.cells[0], serviceDay: "2096-02-02" }] },
    {
      ...batch,
      replacePrivateBlocks: [
        { serviceDay: "2096-01-31", id: shiftId, kind: "shift" },
      ],
    },
  ];
  for (const input of invalid) {
    await expect(
      inventory.setAvailabilityBatch(profileId, revisionId, input),
    ).resolves.toEqual({ status: "invalid", fields: ["batch"] });
  }
  expect(setAvailabilityBatch).not.toHaveBeenCalled();
  await inventory.setAvailabilityBatch(profileId, revisionId, batch);
  expect(setAvailabilityBatch).toHaveBeenLastCalledWith({
    profileId,
    scheduleRevisionId: revisionId,
    batch: { ...batch, cells: [...batch.cells].reverse() },
  });
  const reviewed = {
    ...batch,
    mode: "reviewed",
    reviewConfirmed: true,
    cells: [batch.cells[0]],
  };
  await inventory.setAvailabilityBatch(profileId, revisionId, reviewed);
  expect(setAvailabilityBatch).toHaveBeenLastCalledWith({
    profileId,
    scheduleRevisionId: revisionId,
    batch: reviewed,
  });
  for (const [code, status] of [
    ["22023", "invalid"],
    ["RC409", "conflict"],
    ["42501", "denied"],
    ["RC202", "denied"],
    ["offline", "unavailable"],
  ]) {
    setAvailabilityBatch.mockRejectedValueOnce({ cause: { code } });
    await expect(
      inventory.setAvailabilityBatch(profileId, revisionId, batch),
    ).resolves.toEqual(
      status === "invalid" ? { status, fields: ["batch"] } : { status },
    );
  }
});
