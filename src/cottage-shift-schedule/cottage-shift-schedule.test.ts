import { describe, expect, it, vi } from "vitest";

import {
  createCottageShiftSchedule,
  readCottageShiftSchedule,
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
  it("keeps Morning and Evening identity instead of sorting", async () => {
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
          { name: "Morning", startTime: "08:00", endTime: "12:00" },
          { name: "Evening", startTime: "18:00", endTime: "02:00" },
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
    const save = vi.spyOn(repository, "save");
    for (const eveningStart of ["07:00", "08:00"]) {
      await expect(
        createCottageShiftSchedule(repository).save(profileId, 0, {
          shifts: [
            { name: "Morning", startTime: "08:00", endTime: "12:00" },
            { name: "Evening", startTime: eveningStart, endTime: "07:30" },
          ],
        }),
      ).resolves.toEqual({ status: "invalid", fields: ["shifts.1.startTime"] });
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("requires exactly two shifts before persistence", async () => {
    const store = repository();
    const save = vi.spyOn(store, "save");

    await expect(
      createCottageShiftSchedule(store).save(profileId, 0, {
        shifts: [
          { name: "Morning", startTime: "08:00", endTime: "12:00" },
          { name: "Afternoon", startTime: "13:00", endTime: "17:00" },
          { name: "Evening", startTime: "18:00", endTime: "22:00" },
        ],
      }),
    ).resolves.toEqual({ status: "invalid", fields: ["shifts"] });
    expect(save).not.toHaveBeenCalled();
  });

  it("shares validated 17-hour and 24-hour Full-day previews with saved readback", async () => {
    for (const endTime of ["02:00", "09:00"]) {
      const input = {
        shifts: [
          { name: " Morning ", startTime: "09:00", endTime: "15:00" },
          { name: "Evening", startTime: "17:00", endTime },
        ],
      };
      const coverage = {
        fullDayStartTime: "09:00",
        fullDayEndTime: endTime,
        fullDayCrossesMidnight: true,
      };

      expect(readCottageShiftSchedule(input)).toEqual({
        status: "valid",
        shifts: [
          {
            name: "Morning",
            startTime: "09:00",
            endTime: "15:00",
            position: 1,
            crossesMidnight: false,
          },
          {
            name: "Evening",
            startTime: "17:00",
            endTime,
            position: 2,
            crossesMidnight: true,
          },
        ],
        ...coverage,
      });
      await expect(
        createCottageShiftSchedule(repository()).save(profileId, 0, input),
      ).resolves.toMatchObject({ status: "saved", schedule: coverage });
    }

    for (const input of [null, 42, [], { shifts: null }, { shifts: [] }]) {
      expect(readCottageShiftSchedule(input)).toMatchObject({
        status: "invalid",
      });
    }
    const morning = { name: "Morning", startTime: "09:00", endTime: "15:00" };
    const evening = { name: "Evening", startTime: "17:00", endTime: "02:00" };
    for (const input of [
      { shifts: [morning] },
      {
        shifts: [
          morning,
          evening,
          { name: "Third", startTime: "03:00", endTime: "05:00" },
        ],
      },
      { shifts: [evening, morning] },
      { shifts: [null, evening] },
      { shifts: [{ ...morning, name: 12 }, evening] },
      { shifts: [{ ...morning, startTime: 9 }, evening] },
      { shifts: [{ ...morning, startTime: "9:00" }, evening] },
      { shifts: [{ ...morning, endTime: "09:00" }, evening] },
    ]) {
      expect(readCottageShiftSchedule(input)).toMatchObject({
        status: "invalid",
      });
    }
    expect(
      readCottageShiftSchedule({
        shifts: [morning, { ...evening, startTime: "14:00" }],
      }),
    ).toEqual({ status: "overlap" });
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
        { name: "Early", startTime: "01:00", endTime: "04:00" },
        { name: "Night", startTime: "23:00", endTime: "02:00" },
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
