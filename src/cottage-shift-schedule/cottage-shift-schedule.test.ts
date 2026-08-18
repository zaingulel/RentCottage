import { describe, expect, it, vi } from "vitest";

import {
  createCottageShiftSchedule,
  type CottageShiftScheduleRepository,
} from "./cottage-shift-schedule";

const profileId = "70000000-0000-4000-8000-000000000001";

function repository(): CottageShiftScheduleRepository {
  return {
    loadCurrent: async () => null,
    save: async (input) => ({
      profileId,
      revision: input.expectedRevision + 1,
      fullDayBundleId: "90000000-0000-4000-8000-000000000001",
      shifts: input.shifts.map((shift, index) => ({
        id: `80000000-0000-4000-8000-00000000000${index + 1}`,
        ...shift,
      })),
    }),
  };
}

describe("Cottage Shift Schedule", () => {
  it("saves shifts in canonical local start-time order through the public seam", async () => {
    let savedInput: Parameters<CottageShiftScheduleRepository["save"]>[0];
    const repository: CottageShiftScheduleRepository = {
      loadCurrent: async () => null,
      save: async (input) => {
        savedInput = input;
        return {
          profileId,
          revision: 1,
          fullDayBundleId: "90000000-0000-4000-8000-000000000001",
          fullDayStartTime: "08:00",
          fullDayEndTime: "02:00",
          fullDayCrossesMidnight: true,
          shifts: input.shifts.map((shift, index) => ({
            id: `80000000-0000-4000-8000-00000000000${index + 1}`,
            ...shift,
          })),
        };
      },
    };

    const result = await createCottageShiftSchedule(repository).save(
      profileId,
      0,
      {
        shifts: [
          { name: "Evening", startTime: "18:00", endTime: "02:00" },
          { name: "Morning", startTime: "08:00", endTime: "12:00" },
        ],
      },
    );

    expect(result).toMatchObject({
      status: "saved",
      schedule: {
        revision: 1,
        fullDayStartTime: "08:00",
        fullDayEndTime: "02:00",
        fullDayCrossesMidnight: true,
        fullDayShiftIds: [
          "80000000-0000-4000-8000-000000000001",
          "80000000-0000-4000-8000-000000000002",
        ],
        shifts: [
          { name: "Morning", startTime: "08:00", crossesMidnight: false },
          { name: "Evening", startTime: "18:00", crossesMidnight: true },
        ],
      },
    });
    expect(savedInput!).toEqual({
      profileId,
      expectedRevision: 0,
      shifts: [
        {
          name: "Morning",
          startTime: "08:00",
          endTime: "12:00",
          position: 1,
          crossesMidnight: false,
        },
        {
          name: "Evening",
          startTime: "18:00",
          endTime: "02:00",
          position: 2,
          crossesMidnight: true,
        },
      ],
    });
  });

  it.each([
    [
      "same-day overlap",
      [
        { name: "One", startTime: "08:00", endTime: "13:00" },
        { name: "Two", startTime: "12:00", endTime: "16:00" },
      ],
    ],
    [
      "prior-day cross-midnight overlap",
      [
        { name: "Night", startTime: "23:00", endTime: "02:00" },
        { name: "Early", startTime: "01:00", endTime: "04:00" },
      ],
    ],
  ])("rejects %s before persistence", async (_, shifts) => {
    const store = repository();
    const save = vi.spyOn(store, "save");

    await expect(
      createCottageShiftSchedule(store).save(profileId, 0, { shifts }),
    ).resolves.toEqual({ status: "overlap" });
    expect(save).not.toHaveBeenCalled();
  });

  it("allows touching endpoints, arbitrary gaps and duplicate case-variant names", async () => {
    const result = await createCottageShiftSchedule(repository()).save(
      profileId,
      0,
      {
        shifts: [
          { name: "day", startTime: "01:00", endTime: "04:00" },
          { name: "DAY", startTime: "23:00", endTime: "01:00" },
        ],
      },
    );

    expect(result).toMatchObject({
      status: "saved",
      schedule: {
        fullDayStartTime: "01:00",
        fullDayEndTime: "01:00",
        fullDayCrossesMidnight: true,
        shifts: [{ name: "day" }, { name: "DAY" }],
      },
    });
  });

  it.each([
    [
      { shifts: [{ name: "Only", startTime: "08:00", endTime: "12:00" }] },
      ["shifts"],
    ],
    [
      {
        shifts: [
          { name: "", startTime: "08:00", endTime: "12:00" },
          { name: "Night", startTime: "18:00", endTime: "18:00" },
        ],
      },
      ["shifts.0.name", "shifts.1.endTime"],
    ],
  ])(
    "reports invalid input fields without calling persistence",
    async (input, fields) => {
      const store = repository();
      const save = vi.spyOn(store, "save");

      await expect(
        createCottageShiftSchedule(store).save(profileId, 0, input),
      ).resolves.toEqual({ status: "invalid", fields });
      expect(save).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["RC409", "conflict"],
    ["42501", "denied"],
    ["RC202", "denied"],
    ["PGRST000", "unavailable"],
  ] as const)("maps provider %s failures honestly", async (code, status) => {
    const store = repository();
    store.save = async () => {
      throw Object.assign(new Error("provider failure"), { code });
    };

    await expect(
      createCottageShiftSchedule(store).save(profileId, 0, {
        shifts: [
          { name: "Day", startTime: "08:00", endTime: "12:00" },
          { name: "Night", startTime: "18:00", endTime: "23:00" },
        ],
      }),
    ).resolves.toEqual({ status });
  });
});
