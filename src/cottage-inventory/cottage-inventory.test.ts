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
    setAvailability: vi.fn(async (input) => input),
    resolve: vi.fn(async () => ({
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
      inventory.resolve(profileId, revisionId, "2026-02-31"),
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
    expect(store.resolve).not.toHaveBeenCalled();
    expect(store.setAvailability).not.toHaveBeenCalled();
    expect(store.savePricing).not.toHaveBeenCalled();
  });

  it("resolves fresh state after an owner pricing change", async () => {
    let priceIqd = 100000;
    const store: CottageInventoryRepository = {
      loadOwnerEditorState: vi.fn(async () => ({
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: null,
        units: [],
      })),
      savePricing: vi.fn(async (input) => input),
      setAvailability: vi.fn(async (input) => input),
      resolve: vi.fn(async () => ({
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
        units: [
          {
            id: shiftId,
            kind: "shift" as const,
            priceIqd,
            available: true,
            committed: false,
          },
        ],
      })),
    };
    const inventory = createCottageInventory(store);

    const first = await inventory.resolve(profileId, revisionId, "2099-08-20");
    priceIqd = 200000;
    const second = await inventory.resolve(profileId, revisionId, "2099-08-20");

    expect(first).toMatchObject({
      status: "resolved",
      resolution: { units: [{ priceIqd: 100000 }] },
    });
    expect(second).toMatchObject({
      status: "resolved",
      resolution: { units: [{ priceIqd: 200000 }] },
    });
    expect(store.resolve).toHaveBeenCalledTimes(2);
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
