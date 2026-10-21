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
  loadCottageInventoryCalendarSpanAction,
  saveCottageInventoryPricingAction,
  setCottageInventoryAvailabilityAction,
  setCottageInventoryAvailabilityBatchAction,
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

  it("loads one authenticated calendar span without per-day calls", async () => {
    const calendar = {
      profileId: "70000000-0000-4000-8000-000000000001",
      scheduleRevisionId: "71000000-0000-4000-8000-000000000001",
      from: "2099-08-01",
      to: "2099-08-31",
      asOf: "2099-08-01T00:00:00Z",
      unitKeys: [],
      days: [],
    };
    const resolveOwnerCalendarSpan = vi
      .fn()
      .mockResolvedValue({ status: "resolved", calendar });
    const resolveOwnerCalendar = vi.fn();
    createRequestCottageInventory.mockResolvedValue({
      resolveOwnerCalendarSpan,
      resolveOwnerCalendar,
    });
    const form = new FormData();
    for (const key of [
      "profileId",
      "scheduleRevisionId",
      "from",
      "to",
    ] as const)
      form.set(key, calendar[key]);
    form.set("ownerUserId", "hostile-client-identity");
    await expect(
      loadCottageInventoryCalendarSpanAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "loaded", calendar });
    expect(createRequestCottageInventory).toHaveBeenCalledTimes(1);
    expect(resolveOwnerCalendarSpan).toHaveBeenCalledExactlyOnceWith(
      calendar.profileId,
      calendar.scheduleRevisionId,
      calendar.from,
      calendar.to,
    );
    expect(resolveOwnerCalendar).not.toHaveBeenCalled();
    for (const status of ["denied", "conflict", "invalid", "unavailable"]) {
      resolveOwnerCalendarSpan.mockResolvedValueOnce({ status });
      await expect(
        loadCottageInventoryCalendarSpanAction({ status: "idle" }, form),
      ).resolves.toEqual({ status });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("preserves saved batch evidence when refresh is unavailable", async () => {
    const profileId = "70000000-0000-4000-8000-000000000001";
    const scheduleRevisionId = "71000000-0000-4000-8000-000000000001";
    const coordinate = {
      serviceDay: "2099-08-20",
      id: "72000000-0000-4000-8000-000000000001",
      kind: "shift",
    };
    const batch = {
      from: "2099-08-20",
      to: "2099-08-20",
      unitKeys: [{ id: coordinate.id, kind: coordinate.kind }],
      state: "closed",
      mode: "range",
      cells: [{ ...coordinate, expectedOwnerState: "open" }],
      replacePrivateBlocks: [],
      reviewConfirmed: false,
    };
    const receipt = {
      status: "saved",
      profileId,
      scheduleRevisionId,
      request: batch,
      changed: [coordinate],
      unchanged: [],
    };
    const setAvailabilityBatch = vi.fn().mockResolvedValue(receipt);
    const resolveOwnerCalendarSpan = vi.fn();
    createRequestCottageInventory.mockResolvedValue({
      setAvailabilityBatch,
      resolveOwnerCalendarSpan,
    });
    const form = new FormData();
    for (const [key, value] of Object.entries({
      locale: "ar",
      profileId,
      scheduleRevisionId,
      batch: JSON.stringify(batch),
    }))
      form.set(key, value);
    form.set("ownerUserId", "hostile");
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("refresh failed");
    });
    await expect(
      setCottageInventoryAvailabilityBatchAction({ status: "idle" }, form),
    ).resolves.toEqual({
      status: "saved",
      receipt,
      refresh: { status: "unavailable" },
    });
    expect(setAvailabilityBatch).toHaveBeenCalledExactlyOnceWith(
      profileId,
      scheduleRevisionId,
      batch,
    );
    expect(resolveOwnerCalendarSpan).not.toHaveBeenCalled();
    await expect(
      setCottageInventoryAvailabilityBatchAction({ status: "idle" }, form),
    ).resolves.toEqual({
      status: "saved",
      receipt,
      refresh: { status: "required" },
    });
    expect(revalidatePath).toHaveBeenLastCalledWith(
      `/ar/owner/cottages/${profileId}`,
    );
    for (const status of ["refused", "denied", "conflict", "unavailable"]) {
      const unitKeys = [
        batch.unitKeys[0],
        { id: "72000000-0000-4000-8000-000000000002", kind: "shift" },
        { id: "73000000-0000-4000-8000-000000000001", kind: "full_day_bundle" },
      ];
      const failure =
        status === "refused"
          ? {
              status,
              profileId,
              scheduleRevisionId,
              request: batch,
              conflicts: [
                {
                  ...coordinate,
                  reason: "stale_state",
                  commitmentReference: null,
                },
              ],
              eligible: [],
              calendar: {
                profileId,
                scheduleRevisionId,
                from: batch.from,
                to: batch.to,
                asOf: "2099-08-19T12:00:00.000Z",
                unitKeys,
                days: [
                  {
                    serviceDay: batch.from,
                    units: unitKeys.map((unit) => ({
                      ...unit,
                      ownerState: "closed",
                      calendarState: "closed",
                      priceIqd: null,
                      commitmentReference: null,
                      available: false,
                      editable: true,
                      temporarilyUnavailable: false,
                    })),
                  },
                ],
              },
            }
          : { status };
      setAvailabilityBatch.mockResolvedValueOnce(failure);
      revalidatePath.mockClear();
      await expect(
        setCottageInventoryAvailabilityBatchAction({ status: "idle" }, form),
      ).resolves.toEqual(failure);
      expect(revalidatePath).not.toHaveBeenCalled();
    }
    for (const field of [
      "locale",
      "profileId",
      "scheduleRevisionId",
      "batch",
    ]) {
      for (const variant of ["duplicate", "missing", "non-string"]) {
        const invalid = new FormData();
        for (const [key, value] of form.entries()) invalid.append(key, value);
        if (variant === "duplicate")
          invalid.append(field, field === "locale" ? "ar" : "duplicate");
        else if (variant === "missing") invalid.delete(field);
        else
          invalid.set(
            field,
            new Blob(["invalid"], { type: "text/plain" }),
            "invalid.txt",
          );
        setAvailabilityBatch.mockClear();
        await expect(
          setCottageInventoryAvailabilityBatchAction(
            { status: "idle" },
            invalid,
          ),
        ).resolves.toEqual({ status: "invalid", fields: [field] });
        expect(setAvailabilityBatch).not.toHaveBeenCalled();
      }
    }
    setAvailabilityBatch.mockRejectedValueOnce(
      new Error("Unknown mutation outcome"),
    );
    revalidatePath.mockClear();
    await expect(
      setCottageInventoryAvailabilityBatchAction({ status: "idle" }, form),
    ).rejects.toThrow("Unknown mutation outcome");
    expect(revalidatePath).not.toHaveBeenCalled();
    for (const invalid of ["{", "null", "[]", '"object"']) {
      form.set("batch", invalid);
      setAvailabilityBatch.mockClear();
      await expect(
        setCottageInventoryAvailabilityBatchAction({ status: "idle" }, form),
      ).resolves.toEqual({ status: "invalid", fields: ["batch"] });
      expect(setAvailabilityBatch).not.toHaveBeenCalled();
    }
  });
});
