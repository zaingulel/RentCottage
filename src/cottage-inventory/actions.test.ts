import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRequestCottageInventory, revalidatePath } = vi.hoisted(() => ({
  createRequestCottageInventory: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("./request-cottage-inventory", () => ({
  createRequestCottageInventory,
}));

import {
  loadCottageInventoryAvailabilityAction,
  saveCottageInventoryPricingAction,
  setCottageInventoryAvailabilityAction,
} from "./actions";

describe("Cottage Inventory actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads authoritative dated owner state before availability can be edited", async () => {
    const resolveOwnerCalendar = vi.fn().mockResolvedValue({
      status: "resolved",
      calendar: {
        profileId: "70000000-0000-4000-8000-000000000001",
        scheduleRevisionId: "71000000-0000-4000-8000-000000000001",
        serviceDay: "2099-08-20",
        units: [
          {
            id: "72000000-0000-4000-8000-000000000001",
            kind: "shift",
            priceIqd: 120000,
            available: false,
            calendarState: "confirmed_booking",
            commitmentReference: "RC-BOOKING-2601",
            editable: false,
          },
        ],
      },
    });
    createRequestCottageInventory.mockResolvedValue({ resolveOwnerCalendar });
    const form = new FormData();
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("scheduleRevisionId", "71000000-0000-4000-8000-000000000001");
    form.set("serviceDay", "2099-08-20");

    await expect(
      loadCottageInventoryAvailabilityAction({ status: "idle" }, form),
    ).resolves.toMatchObject({
      status: "loaded",
      serviceDay: "2099-08-20",
      units: [
        {
          calendarState: "confirmed_booking",
          commitmentReference: "RC-BOOKING-2601",
          editable: false,
        },
      ],
    });
    expect(resolveOwnerCalendar).toHaveBeenCalledWith(
      "70000000-0000-4000-8000-000000000001",
      "71000000-0000-4000-8000-000000000001",
      "2099-08-20",
    );
  });

  it("passes owner prices to the public inventory service seam", async () => {
    const savePricing = vi
      .fn()
      .mockResolvedValue({ status: "saved", value: {} });
    createRequestCottageInventory.mockResolvedValue({ savePricing });
    const form = new FormData();
    form.set("locale", "ar");
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("scheduleRevisionId", "71000000-0000-4000-8000-000000000001");
    form.append("unitId", "72000000-0000-4000-8000-000000000001");
    form.append("unitKind", "shift");
    form.append("standardPriceIqd", "120000");

    await expect(
      saveCottageInventoryPricingAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "saved" });
    expect(savePricing).toHaveBeenCalledWith(
      "70000000-0000-4000-8000-000000000001",
      "71000000-0000-4000-8000-000000000001",
      {
        units: [
          {
            id: "72000000-0000-4000-8000-000000000001",
            kind: "shift",
            standardPriceIqd: 120000,
          },
        ],
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/ar/owner/cottages/70000000-0000-4000-8000-000000000001",
    );
  });

  it("does not turn blank optional override controls into zero prices", async () => {
    const savePricing = vi
      .fn()
      .mockResolvedValue({ status: "saved", value: {} });
    createRequestCottageInventory.mockResolvedValue({ savePricing });
    const form = new FormData();
    form.set("locale", "en");
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("scheduleRevisionId", "71000000-0000-4000-8000-000000000001");
    form.append("unitId", "72000000-0000-4000-8000-000000000001");
    form.append("unitKind", "shift");
    form.append("standardPriceIqd", "120000");
    form.append("weekdayUnitId", "72000000-0000-4000-8000-000000000001");
    form.append("weekdayUnitKind", "shift");
    form.append("weekday", "");
    form.append("weekdayPriceIqd", "");
    form.append("dateUnitId", "72000000-0000-4000-8000-000000000001");
    form.append("dateUnitKind", "shift");
    form.append("serviceDay", "");
    form.append("datePriceIqd", "");

    await expect(
      saveCottageInventoryPricingAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "saved" });
    expect(savePricing.mock.calls[0]?.[2]).toEqual({
      units: [
        {
          id: "72000000-0000-4000-8000-000000000001",
          kind: "shift",
          standardPriceIqd: 120000,
        },
      ],
    });
  });

  it("accepts persisted overrides with their trailing blank add rows unchanged", async () => {
    const savePricing = vi
      .fn()
      .mockResolvedValue({ status: "saved", value: {} });
    createRequestCottageInventory.mockResolvedValue({ savePricing });
    const form = new FormData();
    form.set("locale", "en");
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("scheduleRevisionId", "71000000-0000-4000-8000-000000000001");
    const units = [
      ["72000000-0000-4000-8000-000000000001", "shift", "100000"],
      ["72000000-0000-4000-8000-000000000002", "shift", "120000"],
      ["73000000-0000-4000-8000-000000000001", "full_day_bundle", "210000"],
    ] as const;
    for (const [id, kind, standardPriceIqd] of units) {
      form.append("unitId", id);
      form.append("unitKind", kind);
      form.append("standardPriceIqd", standardPriceIqd);
    }
    for (const [id, kind, weekday, price] of [
      [units[0][0], "shift", "4", "110000"],
      [units[0][0], "shift", "", ""],
      [units[1][0], "shift", "", ""],
      [units[2][0], "full_day_bundle", "", ""],
    ] as const) {
      form.append("weekdayUnitId", id);
      form.append("weekdayUnitKind", kind);
      form.append("weekday", weekday);
      form.append("weekdayPriceIqd", price);
    }
    for (const [id, kind, serviceDay, price] of [
      [units[0][0], "shift", "2099-08-20", "125000"],
      [units[0][0], "shift", "", ""],
      [units[1][0], "shift", "", ""],
      [units[2][0], "full_day_bundle", "", ""],
    ] as const) {
      form.append("dateUnitId", id);
      form.append("dateUnitKind", kind);
      form.append("serviceDay", serviceDay);
      form.append("datePriceIqd", price);
    }

    await expect(
      saveCottageInventoryPricingAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "saved" });
    expect(savePricing).toHaveBeenCalledWith(
      "70000000-0000-4000-8000-000000000001",
      "71000000-0000-4000-8000-000000000001",
      {
        units: [
          {
            id: units[0][0],
            kind: "shift",
            standardPriceIqd: 100000,
            weekdayOverrides: [{ weekday: 4, priceIqd: 110000 }],
            dateOverrides: [{ serviceDay: "2099-08-20", priceIqd: 125000 }],
          },
          {
            id: units[1][0],
            kind: "shift",
            standardPriceIqd: 120000,
          },
          {
            id: units[2][0],
            kind: "full_day_bundle",
            standardPriceIqd: 210000,
          },
        ],
      },
    );
  });

  it.each([
    {
      label: "a cleared hydrated weekday with its retained price",
      weekday: "",
      price: "110000",
    },
    {
      label: "a selected weekday without a price",
      weekday: "4",
      price: "",
    },
  ])(
    "rejects $label before using the inventory service",
    async ({ weekday, price }) => {
      const form = new FormData();
      form.set("locale", "en");
      form.set("profileId", "70000000-0000-4000-8000-000000000001");
      form.set("scheduleRevisionId", "71000000-0000-4000-8000-000000000001");
      form.append("unitId", "72000000-0000-4000-8000-000000000001");
      form.append("unitKind", "shift");
      form.append("standardPriceIqd", "100000");
      form.append("weekdayUnitId", "72000000-0000-4000-8000-000000000001");
      form.append("weekdayUnitKind", "shift");
      form.append("weekday", weekday);
      form.append("weekdayPriceIqd", price);

      await expect(
        saveCottageInventoryPricingAction({ status: "idle" }, form),
      ).resolves.toEqual({ status: "invalid" });
      expect(createRequestCottageInventory).not.toHaveBeenCalled();
    },
  );

  it("rejects mismatched pricing arrays before using the inventory service", async () => {
    const form = new FormData();
    form.set("locale", "en");
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("scheduleRevisionId", "71000000-0000-4000-8000-000000000001");
    form.append("unitId", "72000000-0000-4000-8000-000000000001");
    form.append("unitKind", "shift");
    form.append("unitKind", "full_day_bundle");
    form.append("standardPriceIqd", "120000");

    await expect(
      saveCottageInventoryPricingAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "invalid" });
    expect(createRequestCottageInventory).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "weekday",
      unitIdName: "weekdayUnitId",
      unitKindName: "weekdayUnitKind",
      valueName: "weekday",
      value: "4",
      priceName: "weekdayPriceIqd",
    },
    {
      label: "specific-date",
      unitIdName: "dateUnitId",
      unitKindName: "dateUnitKind",
      valueName: "serviceDay",
      value: "2099-08-20",
      priceName: "datePriceIqd",
    },
  ])(
    "rejects a nonblank $label override for a missing submitted unit",
    async ({ unitIdName, unitKindName, valueName, value, priceName }) => {
      const form = new FormData();
      form.set("locale", "en");
      form.set("profileId", "70000000-0000-4000-8000-000000000001");
      form.set("scheduleRevisionId", "71000000-0000-4000-8000-000000000001");
      form.append("unitId", "72000000-0000-4000-8000-000000000001");
      form.append("unitKind", "shift");
      form.append("standardPriceIqd", "120000");
      form.append(unitIdName, "72000000-0000-4000-8000-000000000099");
      form.append(unitKindName, "shift");
      form.append(valueName, value);
      form.append(priceName, "160000");

      await expect(
        saveCottageInventoryPricingAction({ status: "idle" }, form),
      ).resolves.toEqual({ status: "invalid" });
      expect(createRequestCottageInventory).not.toHaveBeenCalled();
    },
  );

  it("rejects mismatched override arrays before using the inventory service", async () => {
    const form = new FormData();
    form.set("locale", "en");
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("scheduleRevisionId", "71000000-0000-4000-8000-000000000001");
    form.append("unitId", "72000000-0000-4000-8000-000000000001");
    form.append("unitKind", "shift");
    form.append("standardPriceIqd", "120000");
    form.append("weekdayUnitId", "72000000-0000-4000-8000-000000000001");
    form.append("weekdayUnitKind", "shift");
    form.append("weekday", "4");

    await expect(
      saveCottageInventoryPricingAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "invalid" });
    expect(createRequestCottageInventory).not.toHaveBeenCalled();
  });

  it("passes dated owner availability states to the inventory service seam", async () => {
    const setAvailability = vi
      .fn()
      .mockResolvedValue({ status: "saved", value: {} });
    createRequestCottageInventory.mockResolvedValue({ setAvailability });
    const form = new FormData();
    form.set("locale", "ckb");
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("scheduleRevisionId", "71000000-0000-4000-8000-000000000001");
    form.set("serviceDay", "2099-08-20");
    form.append("availabilityUnitId", "72000000-0000-4000-8000-000000000001");
    form.append("availabilityUnitKind", "shift");
    form.append("availabilityState", "private_blocked");

    await expect(
      setCottageInventoryAvailabilityAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "saved" });
    expect(setAvailability).toHaveBeenCalledWith(
      "70000000-0000-4000-8000-000000000001",
      "71000000-0000-4000-8000-000000000001",
      "2099-08-20",
      {
        units: [
          {
            id: "72000000-0000-4000-8000-000000000001",
            kind: "shift",
            state: "private_blocked",
          },
        ],
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/ckb/owner/cottages/70000000-0000-4000-8000-000000000001",
    );
  });

  it.each(["availabilityUnitKind", "availabilityState"])(
    "rejects a surplus %s value before using the inventory service",
    async (surplusName) => {
      const form = new FormData();
      form.set("locale", "en");
      form.set("profileId", "70000000-0000-4000-8000-000000000001");
      form.set("scheduleRevisionId", "71000000-0000-4000-8000-000000000001");
      form.set("serviceDay", "2099-08-20");
      form.append("availabilityUnitId", "72000000-0000-4000-8000-000000000001");
      form.append("availabilityUnitKind", "shift");
      form.append("availabilityState", "private_blocked");
      form.append(
        surplusName,
        surplusName === "availabilityUnitKind" ? "shift" : "closed",
      );

      await expect(
        setCottageInventoryAvailabilityAction({ status: "idle" }, form),
      ).resolves.toEqual({ status: "invalid" });
      expect(createRequestCottageInventory).not.toHaveBeenCalled();
    },
  );
});
