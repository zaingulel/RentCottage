import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/cottage-shift-schedule/actions", () => ({
  saveCottageShiftScheduleAction: vi.fn(),
}));

import { CottageShiftScheduleEditor } from "./cottage-shift-schedule-editor";

const schedule = {
  profileId: "70000000-0000-4000-8000-000000000001",
  revision: 2,
  fullDayBundleId: "90000000-0000-4000-8000-000000000001",
  fullDayShiftIds: [
    "80000000-0000-4000-8000-000000000001",
    "80000000-0000-4000-8000-000000000002",
  ],
  fullDayStartTime: "08:00",
  fullDayEndTime: "02:00",
  fullDayCrossesMidnight: true,
  shifts: [
    {
      id: "80000000-0000-4000-8000-000000000001",
      name: "Morning",
      startTime: "08:00",
      endTime: "12:00",
      position: 1,
      crossesMidnight: false,
    },
    {
      id: "80000000-0000-4000-8000-000000000002",
      name: "Evening",
      startTime: "18:00",
      endTime: "02:00",
      position: 2,
      crossesMidnight: true,
    },
  ],
};

describe("Cottage Shift Schedule editor", () => {
  it("shows persisted shifts, cross-midnight guidance and the Full-Day Bundle summary", () => {
    render(
      <CottageShiftScheduleEditor
        locale="en"
        profileId={schedule.profileId}
        schedule={schedule}
        editable
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Daily Shift Schedule" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Shift 1 name")).toHaveValue("Morning");
    expect(screen.getByLabelText("Shift 2 end time")).toHaveValue("02:00");
    expect(
      screen.getByText(/belongs to the Service Day on which it starts/),
    ).toBeVisible();
    expect(screen.getByText("08:00 → 02:00 (next day)")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save Shift Schedule" }),
    ).toHaveClass("action", "action-primary");
  });

  it("is localized and read-only during content review", () => {
    render(
      <CottageShiftScheduleEditor
        locale="ckb"
        profileId={schedule.profileId}
        schedule={schedule}
        editable={false}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "خشتەی شیفتە ڕۆژانەکان" }),
    ).toBeVisible();
    expect(screen.getByText(/پێداچوونەوەی ناوەڕۆک/)).toBeVisible();
    expect(screen.getByLabelText("شیفت 1 ناو")).toBeDisabled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
