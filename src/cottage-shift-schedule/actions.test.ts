import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, createRequestCottageShiftSchedule } = vi.hoisted(
  () => ({
    revalidatePath: vi.fn(),
    createRequestCottageShiftSchedule: vi.fn(),
  }),
);

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("./request-cottage-shift-schedule", () => ({
  createRequestCottageShiftSchedule,
}));

import { saveCottageShiftScheduleAction } from "./actions";
import type { CottageShiftSchedule } from "./cottage-shift-schedule";

const profileId = "70000000-0000-4000-8000-000000000001";
const savedSchedule: CottageShiftSchedule = {
  profileId,
  revision: 3,
  scheduleRevisionId: "70000000-0000-4000-8000-000000000002",
  fullDayBundleId: "70000000-0000-4000-8000-000000000003",
  fullDayShiftIds: [
    "70000000-0000-4000-8000-000000000004",
    "70000000-0000-4000-8000-000000000005",
  ],
  fullDayStartTime: "08:00",
  fullDayEndTime: "02:00",
  fullDayCrossesMidnight: true,
  shifts: [
    {
      id: "70000000-0000-4000-8000-000000000004",
      name: "Morning",
      startTime: "08:00",
      endTime: "12:00",
      position: 1,
      crossesMidnight: false,
    },
    {
      id: "70000000-0000-4000-8000-000000000005",
      name: "Evening",
      startTime: "18:00",
      endTime: "02:00",
      position: 2,
      crossesMidnight: true,
    },
  ],
};

function confirmedForm() {
  const form = new FormData();
  form.set("locale", "en");
  form.set("profileId", profileId);
  form.set("expectedRevision", "2");
  form.set("confirmedTimes", "on");
  for (const [name, startTime, endTime] of [
    ["Morning", "08:00", "12:00"],
    ["Evening", "18:00", "02:00"],
  ]) {
    form.append("shiftName", name);
    form.append("shiftStartTime", startTime);
    form.append("shiftEndTime", endTime);
  }
  return form;
}

describe("Cottage Shift Schedule action", () => {
  const save = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    save.mockResolvedValue({ status: "saved", schedule: savedSchedule });
    createRequestCottageShiftSchedule.mockResolvedValue({ save });
  });

  it("requires explicit confirmation before saving", async () => {
    for (const value of [
      null,
      "",
      "off",
      "true",
      new File(["on"], "confirmation"),
    ]) {
      const form = confirmedForm();
      if (value === null) form.delete("confirmedTimes");
      else form.set("confirmedTimes", value);
      await expect(
        saveCottageShiftScheduleAction({ status: "idle" }, form),
      ).resolves.toEqual({ status: "invalid", fields: ["confirmedTimes"] });
    }
    const duplicate = confirmedForm();
    duplicate.append("confirmedTimes", "on");
    await expect(
      saveCottageShiftScheduleAction({ status: "idle" }, duplicate),
    ).resolves.toEqual({ status: "invalid", fields: ["confirmedTimes"] });
    expect(createRequestCottageShiftSchedule).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects third or mismatched shift entries before saving", async () => {
    for (const field of ["shiftName", "shiftStartTime", "shiftEndTime"]) {
      for (const entries of [[], ["08:00"], ["08:00", "12:00", "18:00"]]) {
        const form = confirmedForm();
        form.delete(field);
        for (const entry of entries) form.append(field, entry);
        await expect(
          saveCottageShiftScheduleAction({ status: "idle" }, form),
        ).resolves.toEqual({ status: "invalid", fields: [field] });
      }
      const form = confirmedForm();
      const entries = form.getAll(field);
      form.delete(field);
      form.append(field, entries[0]);
      form.append(field, new File(["12:00"], "shift"));
      await expect(
        saveCottageShiftScheduleAction({ status: "idle" }, form),
      ).resolves.toEqual({ status: "invalid", fields: [`${field}.1`] });
    }
    const third = confirmedForm();
    for (const field of ["shiftName", "shiftStartTime", "shiftEndTime"]) {
      third.append(field, "");
    }
    await expect(
      saveCottageShiftScheduleAction({ status: "idle" }, third),
    ).resolves.toEqual({
      status: "invalid",
      fields: ["shiftName", "shiftStartTime", "shiftEndTime"],
    });
    for (const [field, value, errorField] of [
      ["shiftStartTime", "", "shiftStartTime.0"],
      ["shiftEndTime", "08:00", "shiftEndTime.0"],
      ["shiftStartTime", "19:00", "shiftStartTime.1"],
    ]) {
      const form = confirmedForm();
      const last = form.getAll(field)[1];
      form.delete(field);
      form.append(field, value);
      form.append(field, last);
      await expect(
        saveCottageShiftScheduleAction({ status: "idle" }, form),
      ).resolves.toEqual({ status: "invalid", fields: [errorField] });
    }
    expect(createRequestCottageShiftSchedule).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects invalid expected revisions before saving", async () => {
    for (const revision of [
      null,
      "",
      " ",
      "-1",
      "1.5",
      "NaN",
      "Infinity",
      "1e2",
      "0x10",
      "9007199254740993",
      new File(["2"], "revision"),
    ]) {
      const form = confirmedForm();
      if (revision === null) form.delete("expectedRevision");
      else form.set("expectedRevision", revision);
      await expect(
        saveCottageShiftScheduleAction({ status: "idle" }, form),
      ).resolves.toEqual({ status: "invalid", fields: ["expectedRevision"] });
    }
    expect(createRequestCottageShiftSchedule).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("uses translated Morning and Evening for blank optional names", async () => {
    for (const [locale, morning, evening] of [
      ["en", "Morning", "Evening"],
      ["ar", "الفترة الصباحية", "الفترة المسائية"],
      ["ckb", "ماوەی بەیانی", "ماوەی ئێوارە"],
    ]) {
      const form = confirmedForm();
      form.set("locale", locale);
      form.set("expectedRevision", "0");
      form.delete("shiftName");
      form.append("shiftName", "");
      form.append("shiftName", "  ");
      await saveCottageShiftScheduleAction({ status: "idle" }, form);
      expect(save).toHaveBeenLastCalledWith(profileId, 0, {
        shifts: [
          {
            name: morning,
            startTime: "08:00",
            endTime: "12:00",
            position: 1,
            crossesMidnight: false,
          },
          {
            name: evening,
            startTime: "18:00",
            endTime: "02:00",
            position: 2,
            crossesMidnight: true,
          },
        ],
      });
    }
    const named = confirmedForm();
    named.delete("shiftName");
    named.append("shiftName", "Family morning");
    named.append("shiftName", "<b>Family evening</b>");
    await saveCottageShiftScheduleAction({ status: "idle" }, named);
    expect(
      save.mock.lastCall?.[2].shifts.map(({ name }: { name: string }) => name),
    ).toEqual(["Family morning", "<b>Family evening</b>"]);
  });

  it("returns the validated saved schedule for the next edit", async () => {
    await expect(
      saveCottageShiftScheduleAction({ status: "idle" }, confirmedForm()),
    ).resolves.toEqual({ status: "saved", schedule: savedSchedule });
    expect(save).toHaveBeenCalledWith(profileId, 2, {
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
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith(
      `/en/owner/cottages/${profileId}`,
    );
  });

  it("preserves service invalid fields without blaming the profile", async () => {
    save.mockResolvedValue({
      status: "invalid",
      fields: ["schedule"],
    });
    await expect(
      saveCottageShiftScheduleAction({ status: "idle" }, confirmedForm()),
    ).resolves.toEqual({
      status: "invalid",
      fields: ["schedule"],
    });
    expect(save).toHaveBeenCalledOnce();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves a committed refusal without reporting saved", async () => {
    save.mockResolvedValue({ status: "committed" });
    await expect(
      saveCottageShiftScheduleAction({ status: "idle" }, confirmedForm()),
    ).resolves.toEqual({ status: "committed" });
    expect(save).toHaveBeenCalledOnce();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
