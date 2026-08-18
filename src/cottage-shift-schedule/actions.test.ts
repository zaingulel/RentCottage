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

describe("Cottage Shift Schedule action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes two required and one completed optional shift to the deep-module seam", async () => {
    const save = vi.fn().mockResolvedValue({ status: "saved", schedule: {} });
    createRequestCottageShiftSchedule.mockResolvedValue({ save });
    const form = new FormData();
    form.set("locale", "en");
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("expectedRevision", "2");
    for (const [name, startTime, endTime] of [
      ["Morning", "08:00", "12:00"],
      ["Evening", "18:00", "23:00"],
      ["Night", "23:00", "02:00"],
    ]) {
      form.append("shiftName", name);
      form.append("shiftStartTime", startTime);
      form.append("shiftEndTime", endTime);
    }

    await expect(
      saveCottageShiftScheduleAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "saved" });
    expect(save).toHaveBeenCalledWith(
      "70000000-0000-4000-8000-000000000001",
      2,
      {
        shifts: [
          { name: "Morning", startTime: "08:00", endTime: "12:00" },
          { name: "Evening", startTime: "18:00", endTime: "23:00" },
          { name: "Night", startTime: "23:00", endTime: "02:00" },
        ],
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/en/owner/cottages/70000000-0000-4000-8000-000000000001",
    );
  });

  it("omits a completely blank optional third shift", async () => {
    const save = vi.fn().mockResolvedValue({ status: "overlap" });
    createRequestCottageShiftSchedule.mockResolvedValue({ save });
    const form = new FormData();
    form.set("locale", "ckb");
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("expectedRevision", "0");
    for (const value of ["Day", "Night", ""]) form.append("shiftName", value);
    for (const value of ["08:00", "18:00", ""])
      form.append("shiftStartTime", value);
    for (const value of ["12:00", "23:00", ""])
      form.append("shiftEndTime", value);

    await expect(
      saveCottageShiftScheduleAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "overlap" });
    expect(save).toHaveBeenCalledWith(expect.any(String), 0, {
      shifts: [
        { name: "Day", startTime: "08:00", endTime: "12:00" },
        { name: "Night", startTime: "18:00", endTime: "23:00" },
      ],
    });
    expect(save.mock.calls[0][2].shifts).toHaveLength(2);
  });
});
