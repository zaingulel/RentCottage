import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CottageShiftSchedule } from "@/cottage-shift-schedule/cottage-shift-schedule";
import type { CottageInventoryOwnerEditorState } from "@/cottage-inventory/cottage-inventory";

vi.mock("server-only", () => ({}));
const { loadAvailability, saveAvailability, savePricing } = vi.hoisted(() => ({
  loadAvailability: vi.fn(),
  saveAvailability: vi.fn(),
  savePricing: vi.fn(),
}));
vi.mock("@/cottage-inventory/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/cottage-inventory/actions")>()),
  loadCottageInventoryAvailabilityAction: loadAvailability,
  saveCottageInventoryPricingAction: savePricing,
  setCottageInventoryAvailabilityAction: saveAvailability,
}));

import { CottagePricingAvailabilityEditor } from "./cottage-pricing-availability-editor";

const schedule: CottageShiftSchedule = {
  profileId: "70000000-0000-4000-8000-000000000001",
  scheduleRevisionId: "71000000-0000-4000-8000-000000000001",
  revision: 1,
  shifts: [
    {
      id: "72000000-0000-4000-8000-000000000001",
      name: "Morning",
      startTime: "08:00",
      endTime: "12:00",
      position: 1,
      crossesMidnight: false,
    },
    {
      id: "72000000-0000-4000-8000-000000000002",
      name: "Evening",
      startTime: "18:00",
      endTime: "22:00",
      position: 2,
      crossesMidnight: false,
    },
  ],
  fullDayBundleId: "73000000-0000-4000-8000-000000000001",
  fullDayShiftIds: [
    "72000000-0000-4000-8000-000000000001",
    "72000000-0000-4000-8000-000000000002",
  ],
  fullDayStartTime: "08:00",
  fullDayEndTime: "22:00",
  fullDayCrossesMidnight: false,
};

const pricing: CottageInventoryOwnerEditorState = {
  profileId: schedule.profileId,
  scheduleRevisionId: schedule.scheduleRevisionId!,
  serviceDay: null,
  units: [
    {
      id: schedule.shifts[0]!.id,
      kind: "shift",
      standardPriceIqd: 125000,
      weekdayOverrides: [{ weekday: 4, priceIqd: 160000 }],
      dateOverrides: [{ serviceDay: "2099-08-27", priceIqd: 180000 }],
    },
    {
      id: schedule.shifts[1]!.id,
      kind: "shift",
      standardPriceIqd: 115000,
      weekdayOverrides: [],
      dateOverrides: [],
    },
    {
      id: schedule.fullDayBundleId,
      kind: "full_day_bundle",
      standardPriceIqd: 220000,
      weekdayOverrides: [],
      dateOverrides: [],
    },
  ],
};

const roundTripPricingBeforeOverride: CottageInventoryOwnerEditorState = {
  ...pricing,
  units: [
    {
      ...pricing.units[0]!,
      standardPriceIqd: 100000,
      weekdayOverrides: [],
      dateOverrides: [],
    },
    { ...pricing.units[1]!, standardPriceIqd: 120000 },
    { ...pricing.units[2]!, standardPriceIqd: 210000 },
  ],
};

const roundTripPricingAfterOverride: CottageInventoryOwnerEditorState = {
  ...roundTripPricingBeforeOverride,
  units: [
    {
      ...roundTripPricingBeforeOverride.units[0]!,
      weekdayOverrides: [{ weekday: 4, priceIqd: 110000 }],
      dateOverrides: [{ serviceDay: "2099-08-20", priceIqd: 125000 }],
    },
    roundTripPricingBeforeOverride.units[1]!,
    roundTripPricingBeforeOverride.units[2]!,
  ],
};

describe("Cottage Pricing and Availability editor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders localized right-to-left pricing and availability controls", () => {
    render(
      <CottagePricingAvailabilityEditor
        locale="ar"
        profileId="70000000-0000-4000-8000-000000000001"
        schedule={schedule}
        pricing={pricing}
        editable
        canOpen={false}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "الأسعار والتوافر" }),
    ).toBeVisible();
    expect(screen.getByRole("region")).toHaveAttribute("dir", "rtl");
    expect(
      screen.getByLabelText("سعر المناوبة 1 القياسي بالدينار العراقي"),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "حفظ الأسعار" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "حفظ التوافر" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تحميل التوافر" })).toBeEnabled();
  });

  it("names the pricing section and each pricing card once", () => {
    render(
      <CottagePricingAvailabilityEditor
        locale="en"
        profileId={schedule.profileId}
        schedule={schedule}
        pricing={pricing}
        editable
        canOpen
      />,
    );

    expect(screen.getAllByText("Pricing and availability")).toHaveLength(1);
    expect(screen.getAllByText("Shift 1")).toHaveLength(1);
    expect(screen.getAllByText("Full-Day Bundle")).toHaveLength(1);
    expect(screen.getAllByText("Standard price in IQD")).toHaveLength(3);
  });

  it("hides blank override rows behind explicit add controls", async () => {
    const user = userEvent.setup();
    render(
      <CottagePricingAvailabilityEditor
        locale="en"
        profileId={schedule.profileId}
        schedule={schedule}
        pricing={pricing}
        editable
        canOpen
      />,
    );

    expect(
      screen.getAllByText("weekday override", { selector: "strong" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByText("specific-date override", { selector: "strong" }),
    ).toHaveLength(1);

    const addWeekday = screen.getByLabelText(
      "Add weekday override for Shift 1",
    );
    const addDate = screen.getByLabelText(
      "Add specific-date override for Shift 1",
    );
    expect(addWeekday.closest("details")).not.toHaveAttribute("open");
    expect(addDate.closest("details")).not.toHaveAttribute("open");

    await user.click(addWeekday);
    expect(addWeekday.closest("details")).toHaveAttribute("open");
    expect(screen.getByLabelText("Shift 1 new weekday override")).toBeVisible();
  });

  it("keeps price configuration available while the editor is read-only", () => {
    render(
      <CottagePricingAvailabilityEditor
        locale="en"
        profileId="70000000-0000-4000-8000-000000000001"
        schedule={schedule}
        pricing={pricing}
        editable={false}
        canOpen
      />,
    );

    expect(
      screen.getByLabelText("Shift 1 standard price in IQD"),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save prices" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/read-only while owner access is unavailable/i),
    ).toBeVisible();
  });

  it("loads authoritative dated state without exposing read-only availability writes", async () => {
    loadAvailability.mockResolvedValue({
      status: "loaded",
      serviceDay: "2099-08-20",
      units: [
        {
          id: schedule.shifts[0]!.id,
          kind: "shift",
          ownerState: "private_blocked",
          committed: false,
          commitmentReference: null,
        },
        {
          id: schedule.shifts[1]!.id,
          kind: "shift",
          ownerState: "open",
          committed: true,
          commitmentReference: "RC-BOOKING-2601",
        },
        {
          id: schedule.fullDayBundleId,
          kind: "full_day_bundle",
          ownerState: "closed",
          committed: false,
          commitmentReference: null,
        },
      ],
    });
    const user = userEvent.setup();
    render(
      <CottagePricingAvailabilityEditor
        locale="en"
        profileId={schedule.profileId}
        schedule={schedule}
        pricing={pricing}
        editable={false}
        canOpen
      />,
    );

    const serviceDay = screen.getByLabelText(/Service Day/, {
      selector: "input",
    });
    expect(serviceDay).toBeEnabled();
    await user.type(serviceDay, "2099-08-20");
    await user.click(screen.getByRole("button", { name: "Load availability" }));

    expect(
      await screen.findByLabelText("Shift 1 operational state"),
    ).toHaveTextContent("Private block");
    expect(
      screen.getByLabelText("Shift 2 operational state"),
    ).toHaveTextContent("Open");
    expect(screen.getByText("Committed: RC-BOOKING-2601")).toBeVisible();
    expect(screen.getByLabelText("Shift 1 operational state")).not.toHaveRole(
      "combobox",
    );
    expect(
      screen.queryByRole("button", { name: "Save availability" }),
    ).not.toBeInTheDocument();
    expect(saveAvailability).not.toHaveBeenCalled();
  });

  it("hydrates every persisted price and never invents an availability state", () => {
    render(
      <CottagePricingAvailabilityEditor
        locale="en"
        profileId={schedule.profileId}
        schedule={schedule}
        pricing={pricing}
        editable
        canOpen
      />,
    );

    expect(screen.getByLabelText("Shift 1 standard price in IQD")).toHaveValue(
      125000,
    );
    expect(screen.getByLabelText("Shift 1 weekday override")).toHaveValue("4");
    expect(
      screen.getByLabelText("Shift 1 weekday override standard price in IQD"),
    ).toHaveValue(160000);
    expect(screen.getByLabelText("Shift 1 specific-date override")).toHaveValue(
      "2099-08-27",
    );
    expect(
      screen.getByLabelText(
        "Shift 1 specific-date override standard price in IQD",
      ),
    ).toHaveValue(180000);
    expect(
      screen.queryByLabelText("Shift 1 operational state"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save availability" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a saved weekday override selected across refresh and unchanged resubmission", async () => {
    savePricing.mockResolvedValue({ status: "saved" });
    const user = userEvent.setup();
    const view = render(
      <CottagePricingAvailabilityEditor
        locale="en"
        profileId={schedule.profileId}
        schedule={schedule}
        pricing={roundTripPricingBeforeOverride}
        editable
        canOpen
      />,
    );

    await user.click(screen.getByLabelText("Add weekday override for Shift 1"));
    await user.selectOptions(
      screen.getByLabelText("Shift 1 new weekday override"),
      "4",
    );
    await user.type(
      screen.getByLabelText(
        "Shift 1 new weekday override standard price in IQD",
      ),
      "110000",
    );
    await user.click(
      screen.getByLabelText("Add specific-date override for Shift 1"),
    );
    await user.type(
      screen.getByLabelText("Shift 1 new specific-date override"),
      "2099-08-20",
    );
    await user.type(
      screen.getByLabelText(
        "Shift 1 new specific-date override standard price in IQD",
      ),
      "125000",
    );
    await user.click(screen.getByRole("button", { name: "Save prices" }));
    await waitFor(() => expect(savePricing).toHaveBeenCalledTimes(1));

    view.rerender(
      <CottagePricingAvailabilityEditor
        locale="en"
        profileId={schedule.profileId}
        schedule={schedule}
        pricing={roundTripPricingAfterOverride}
        editable
        canOpen
      />,
    );

    expect(screen.getByLabelText("Shift 1 standard price in IQD")).toHaveValue(
      100000,
    );
    expect(screen.getByLabelText("Shift 1 weekday override")).toHaveValue("4");
    expect(
      screen.getByLabelText("Shift 1 weekday override standard price in IQD"),
    ).toHaveValue(110000);
    expect(
      screen
        .getByLabelText("Add weekday override for Shift 1")
        .closest("details"),
    ).not.toHaveAttribute("open");
    expect(screen.getByLabelText("Shift 1 specific-date override")).toHaveValue(
      "2099-08-20",
    );
    expect(
      screen.getByLabelText(
        "Shift 1 specific-date override standard price in IQD",
      ),
    ).toHaveValue(125000);
    expect(
      screen
        .getByLabelText("Add specific-date override for Shift 1")
        .closest("details"),
    ).not.toHaveAttribute("open");

    await user.click(screen.getByRole("button", { name: "Save prices" }));
    await waitFor(() => expect(savePricing).toHaveBeenCalledTimes(2));
    const unchangedSubmission = savePricing.mock.calls[1]?.[1] as FormData;
    expect(unchangedSubmission.getAll("weekday")).toEqual(["4", "", "", ""]);
    expect(unchangedSubmission.getAll("weekdayPriceIqd")).toEqual([
      "110000",
      "",
      "",
      "",
    ]);
    expect(unchangedSubmission.getAll("serviceDay")).toEqual([
      "2099-08-20",
      "",
      "",
      "",
    ]);
    expect(unchangedSubmission.getAll("datePriceIqd")).toEqual([
      "125000",
      "",
      "",
      "",
    ]);
  });

  it("shows only the authoritative states returned for the selected Service Day", async () => {
    loadAvailability.mockResolvedValue({
      status: "loaded",
      serviceDay: "2099-08-20",
      units: [
        {
          id: schedule.shifts[0]!.id,
          kind: "shift",
          ownerState: "private_blocked",
          committed: false,
          commitmentReference: null,
        },
        {
          id: schedule.shifts[1]!.id,
          kind: "shift",
          ownerState: "open",
          committed: false,
          commitmentReference: null,
        },
        {
          id: schedule.fullDayBundleId,
          kind: "full_day_bundle",
          ownerState: "closed",
          committed: false,
          commitmentReference: null,
        },
      ],
    });
    const user = userEvent.setup();
    render(
      <CottagePricingAvailabilityEditor
        locale="en"
        profileId={schedule.profileId}
        schedule={schedule}
        pricing={pricing}
        editable
        canOpen
      />,
    );

    await user.type(
      screen.getByLabelText(/Service Day/, { selector: "input" }),
      "2099-08-20",
    );
    await user.click(screen.getByRole("button", { name: "Load availability" }));

    expect(
      await screen.findByLabelText("Shift 1 operational state"),
    ).toHaveValue("private_blocked");
    expect(screen.getByLabelText("Shift 2 operational state")).toHaveValue(
      "open",
    );
    expect(
      screen.getByLabelText("Full-Day Bundle operational state"),
    ).toHaveValue("closed");
    expect(
      screen.getByRole("button", { name: "Save availability" }),
    ).toBeEnabled();
  });
});
