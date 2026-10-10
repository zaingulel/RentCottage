import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/cottage-shift-schedule/actions", () => ({
  saveCottageShiftScheduleAction: vi.fn(),
}));

import {
  saveCottageShiftScheduleAction,
  type CottageShiftScheduleActionState,
} from "@/cottage-shift-schedule/actions";
import type { CottageShiftSchedule } from "@/cottage-shift-schedule/cottage-shift-schedule";
import { cottageShiftScheduleMessages } from "@/i18n/cottage-shift-schedule-messages";
import { CottageShiftScheduleEditor } from "./cottage-shift-schedule-editor";

const schedule: CottageShiftSchedule = {
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

function renderEditor(current: CottageShiftSchedule | null = schedule) {
  return render(
    <CottageShiftScheduleEditor
      locale="en"
      profileId={schedule.profileId}
      schedule={current}
      editable
    />,
  );
}

function shiftField(identity: "Morning" | "Evening", label: string) {
  return within(screen.getByRole("group", { name: identity })).getByLabelText(
    label,
  );
}

function changeTime(
  identity: "Morning" | "Evening",
  label: "Starts" | "Ends",
  value: string,
) {
  fireEvent.change(shiftField(identity, label), { target: { value } });
}

function confirmAndSave() {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
}

describe("Cottage Shift Schedule editor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("draft read-back and confirmation follow every time edit", () => {
    renderEditor(null);
    expect(shiftField("Morning", "Starts")).toHaveValue("");
    expect(shiftField("Evening", "Ends")).toHaveValue("");
    changeTime("Morning", "Starts", "09:00");
    changeTime("Morning", "Ends", "15:00");
    changeTime("Evening", "Starts", "17:00");
    changeTime("Evening", "Ends", "02:00");

    const access = screen.getByRole("status", { name: "Full-day access" });
    expect(access).toHaveTextContent("09:00 to 02:00 next day");
    expect(access).toHaveTextContent("including the 15:00 to 17:00 gap");
    expect(access).toHaveTextContent(
      "Customers may remain between the two shifts.",
    );
    expect(
      screen.getByText(/All times are Iraq local time/).closest("p"),
    ).toHaveTextContent("UTC+3");
    expect(screen.getByText(/^Morning access:/)).toHaveTextContent(
      "Morning access: 09:00 to 15:00 same day",
    );
    expect(screen.getByText(/^Evening access:/)).toHaveTextContent(
      "Evening access: 17:00 to 02:00 next day",
    );

    for (const [identity, label, value, coverage] of [
      ["Morning", "Starts", "10:00", "10:00 to 02:00 next day"],
      ["Morning", "Ends", "16:00", "10:00 to 02:00 next day"],
      ["Evening", "Starts", "18:00", "10:00 to 02:00 next day"],
      ["Evening", "Ends", "10:00", "10:00 to 10:00 next day"],
    ] as const) {
      fireEvent.click(screen.getByRole("checkbox"));
      expect(screen.getByRole("checkbox")).toBeChecked();
      changeTime(identity, label, value);
      expect(screen.getByRole("checkbox")).not.toBeChecked();
      expect(access).toHaveTextContent(coverage);
    }
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(shiftField("Evening", "Local name (optional)"), {
      target: { value: "Family evening" },
    });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    changeTime("Evening", "Starts", "16:00");
    expect(access).not.toHaveTextContent("including the");
    expect(access).toHaveTextContent("10:00 to 10:00 next day");
  });

  it("invalid draft never shows saved Full-day access", () => {
    renderEditor();
    const access = screen.getByRole("status", { name: "Full-day access" });
    expect(access).toHaveTextContent("08:00 to 02:00 next day");
    fireEvent.click(screen.getByRole("checkbox"));
    changeTime("Morning", "Starts", "");
    expect(access).not.toHaveTextContent("08:00 to 02:00");
    expect(access).toHaveTextContent(
      "Complete both shifts to see Full-day access.",
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(shiftField("Morning", "Starts")).toHaveFocus();
    expect(shiftField("Morning", "Starts")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      document.getElementById(
        shiftField("Morning", "Starts").getAttribute("aria-describedby")!,
      ),
    ).toBe(access);
    expect(saveCottageShiftScheduleAction).not.toHaveBeenCalled();

    changeTime("Morning", "Starts", "08:00");
    changeTime("Evening", "Starts", "11:00");
    expect(access).toHaveTextContent("These recurring shifts overlap.");
    expect(access).not.toHaveTextContent("08:00 to 02:00");
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(shiftField("Morning", "Starts")).toHaveFocus();
    expect(saveCottageShiftScheduleAction).not.toHaveBeenCalled();
  });

  it("a second save uses the validated saved revision and retains its values", async () => {
    const saved: CottageShiftSchedule = {
      ...schedule,
      revision: 3,
      fullDayStartTime: "09:00",
      shifts: schedule.shifts.map((shift, index) =>
        index === 0 ? { ...shift, name: "Morning", startTime: "09:00" } : shift,
      ),
    };
    vi.mocked(saveCottageShiftScheduleAction)
      .mockResolvedValueOnce({ status: "saved", schedule: saved })
      .mockResolvedValueOnce({ status: "committed" })
      .mockResolvedValueOnce({
        status: "saved",
        schedule: { ...saved, revision: 4 },
      });
    renderEditor();
    changeTime("Morning", "Starts", "09:00");
    fireEvent.change(shiftField("Morning", "Local name (optional)"), {
      target: { value: "" },
    });
    confirmAndSave();
    await waitFor(() =>
      expect(screen.getByText("Shift Schedule saved.")).toBeVisible(),
    );
    expect(shiftField("Morning", "Starts")).toHaveValue("09:00");
    expect(shiftField("Morning", "Local name (optional)")).toHaveValue(
      "Morning",
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(
      screen.getByRole("status", { name: "Full-day access" }),
    ).toHaveTextContent("09:00 to 02:00 next day");
    const firstSubmission = vi.mocked(saveCottageShiftScheduleAction).mock
      .calls[0][1];
    expect(firstSubmission.get("expectedRevision")).toBe("2");
    expect(firstSubmission.getAll("shiftStartTime")).toEqual([
      "09:00",
      "18:00",
    ]);
    expect(firstSubmission.getAll("confirmedTimes")).toEqual(["on"]);

    changeTime("Morning", "Ends", "13:00");
    expect(screen.queryByText("Shift Schedule saved.")).not.toBeInTheDocument();
    confirmAndSave();
    await waitFor(() =>
      expect(saveCottageShiftScheduleAction).toHaveBeenCalledTimes(2),
    );
    expect(
      vi
        .mocked(saveCottageShiftScheduleAction)
        .mock.calls[1][1].get("expectedRevision"),
    ).toBe("3");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        cottageShiftScheduleMessages.en.committed,
      ),
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(screen.getByRole("checkbox")).toHaveFocus();
    expect(saveCottageShiftScheduleAction).toHaveBeenCalledTimes(2);
    confirmAndSave();
    await waitFor(() =>
      expect(saveCottageShiftScheduleAction).toHaveBeenCalledTimes(3),
    );
    const retrySubmission = vi.mocked(saveCottageShiftScheduleAction).mock
      .calls[2][1];
    expect(retrySubmission.get("expectedRevision")).toBe("3");
    expect(retrySubmission.getAll("confirmedTimes")).toEqual(["on"]);
    await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeChecked());
  });

  it("pending save disables every schedule field and confirmation", async () => {
    let finish!: (result: CottageShiftScheduleActionState) => void;
    vi.mocked(saveCottageShiftScheduleAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderEditor();
    confirmAndSave();
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    for (const identity of ["Morning", "Evening"] as const) {
      for (const label of ["Starts", "Ends", "Local name (optional)"]) {
        expect(shiftField(identity, label)).toBeDisabled();
      }
    }
    finish({ status: "saved", schedule });
    await waitFor(() => expect(screen.getByRole("button")).toBeEnabled());
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("historical three-shift schedules preserve every row as read-only", () => {
    const legacy = {
      ...schedule,
      fullDayEndTime: "23:00",
      fullDayCrossesMidnight: false,
      shifts: [
        {
          ...schedule.shifts[0],
          name: "Dawn",
          startTime: "06:00",
          endTime: "09:00",
        },
        {
          ...schedule.shifts[1],
          name: "Afternoon",
          startTime: "12:00",
          endTime: "15:00",
          crossesMidnight: false,
        },
        {
          ...schedule.shifts[1],
          id: "80000000-0000-4000-8000-000000000003",
          name: "Late",
          startTime: "20:00",
          endTime: "23:00",
          position: 3,
          crossesMidnight: false,
        },
      ],
      fullDayStartTime: "06:00",
    };
    renderEditor(legacy);
    expect(
      screen.getByText(cottageShiftScheduleMessages.en.legacyRead),
    ).toBeVisible();
    for (const name of ["Dawn", "Afternoon", "Late"]) {
      const row = screen.getByRole("group", { name });
      expect(within(row).getByLabelText("Local name (optional)")).toHaveValue(
        name,
      );
      expect(within(row).getByLabelText("Starts")).toBeDisabled();
      expect(within(row).getByLabelText("Ends")).toBeDisabled();
    }
    expect(
      screen.getByRole("status", { name: "Full-day access" }),
    ).toHaveTextContent("06:00 to 23:00 same day");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("hostile local names remain literal text beside fixed identities", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const { container } = renderEditor({
      ...schedule,
      shifts: [{ ...schedule.shifts[0], name: hostile }, schedule.shifts[1]],
    });
    expect(screen.getByRole("group", { name: "Morning" })).toBeVisible();
    expect(shiftField("Morning", "Local name (optional)")).toHaveValue(hostile);
    expect(screen.getByText(hostile)).toBeVisible();
    expect(screen.getByText(hostile)).toHaveAttribute("dir", "auto");
    expect(container.querySelector("img")).toBeNull();
  });

  it("committed refusals stay honest and a conflict requires reload", async () => {
    vi.mocked(saveCottageShiftScheduleAction)
      .mockResolvedValueOnce({ status: "committed" })
      .mockResolvedValueOnce({ status: "conflict" });
    renderEditor();
    confirmAndSave();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        cottageShiftScheduleMessages.en.committed,
      ),
    );
    expect(screen.queryByText("Shift Schedule saved.")).not.toBeInTheDocument();
    expect(
      screen.queryByText(cottageShiftScheduleMessages.en.unavailable),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    confirmAndSave();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        cottageShiftScheduleMessages.en.conflict,
      ),
    );
    expect(screen.getByRole("button")).toBeDisabled();
    expect(shiftField("Morning", "Starts")).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
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
      screen.getByRole("heading", {
        name: cottageShiftScheduleMessages.ckb.title,
      }),
    ).toBeVisible();
    expect(
      screen.getByText(cottageShiftScheduleMessages.ckb.readOnly),
    ).toBeVisible();
    const morning = screen.getByRole("group", {
      name: cottageShiftScheduleMessages.ckb.morning,
    });
    expect(
      within(morning).getByLabelText(
        cottageShiftScheduleMessages.ckb.localName,
      ),
    ).toBeDisabled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
