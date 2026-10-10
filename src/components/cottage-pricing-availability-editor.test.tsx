import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CottageShiftSchedule } from "@/cottage-shift-schedule/cottage-shift-schedule";
import type { CottageInventoryOwnerEditorState } from "@/cottage-inventory/cottage-inventory";
import { cottagePricingAvailabilityMessages } from "@/i18n/cottage-pricing-availability-messages";
import { cottageShiftScheduleMessages } from "@/i18n/cottage-shift-schedule-messages";

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

  it("historical three-shift pricing preserves all units without two-shift claims", async () => {
    const hostileName = 'Dawn <img src=x onerror="alert(1)">';
    const thirdId = "72000000-0000-4000-8000-000000000003";
    const historicalSchedule: CottageShiftSchedule = {
      ...schedule,
      shifts: [
        {
          ...schedule.shifts[0]!,
          name: hostileName,
          startTime: "06:00",
          endTime: "09:00",
        },
        {
          ...schedule.shifts[1]!,
          name: "Afternoon",
          startTime: "12:00",
          endTime: "15:00",
        },
        {
          ...schedule.shifts[1]!,
          id: thirdId,
          name: "Late",
          position: 3,
          startTime: "20:00",
          endTime: "23:00",
        },
      ],
      fullDayShiftIds: [...schedule.fullDayShiftIds, thirdId],
      fullDayStartTime: "06:00",
      fullDayEndTime: "23:00",
    };
    const historicalPricing: CottageInventoryOwnerEditorState = {
      ...pricing,
      units: [
        pricing.units[0]!,
        pricing.units[1]!,
        {
          ...pricing.units[1]!,
          id: thirdId,
          standardPriceIqd: 135000,
        },
        pricing.units[2]!,
      ],
    };
    savePricing.mockResolvedValue({ status: "saved" });
    const user = userEvent.setup();
    const view = render(
      <CottagePricingAvailabilityEditor
        locale="en"
        profileId={schedule.profileId}
        schedule={historicalSchedule}
        pricing={historicalPricing}
        editable
        canOpen
      />,
    );

    expect(
      within(screen.getByRole("group", { name: "Pricing and availability" }))
        .getAllByRole("heading", { level: 3 }),
    ).toHaveLength(4);
    for (const [name, range, price] of [
      [`Shift 1: ${hostileName}`, "06:00 to 09:00 (same day)", 125000],
      ["Shift 2: Afternoon", "12:00 to 15:00 (same day)", 115000],
      ["Shift 3: Late", "20:00 to 23:00 (same day)", 135000],
      ["Full-day", "06:00 to 23:00 (same day)", 220000],
    ] as const) {
      const card = screen.getByRole("group", { name });
      expect(card).toHaveTextContent(range);
      expect(within(card).getAllByRole("spinbutton")[0]).toHaveValue(price);
      for (const clock of card.querySelectorAll('bdi[dir="ltr"]')) {
        expect(clock).toBeVisible();
      }
    }
    expect(screen.getByText(hostileName, { selector: "bdi" })).toHaveAttribute(
      "dir",
      "auto",
    );
    expect(view.container.querySelector("img, script")).toBeNull();
    expect(
      screen.queryByText(cottageShiftScheduleMessages.en.fullDayIncludes),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(cottageShiftScheduleMessages.en.fullDayBetweenShifts),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Load availability" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save prices" }));
    await waitFor(() => expect(savePricing).toHaveBeenCalledTimes(1));
    const submission = savePricing.mock.calls[0]?.[1] as FormData;
    expect(submission.getAll("unitId")).toEqual([
      schedule.shifts[0]!.id,
      schedule.shifts[1]!.id,
      thirdId,
      schedule.fullDayBundleId,
    ]);
    expect(submission.getAll("standardPriceIqd")).toEqual([
      "125000",
      "115000",
      "135000",
      "220000",
    ]);
  });

  it.each([
    {
      locale: "en",
      morning: "Morning",
      evening: "Evening",
      fullDay: "Full-day",
      morningRange: "09:00 to 15:00 (same day)",
      eveningRange: "17:00 to 02:00 (next day)",
      fullDayRange: "09:00 to 02:00 (next day)",
    },
    {
      locale: "ar",
      morning: "الفترة الصباحية",
      evening: "الفترة المسائية",
      fullDay: "حجز اليوم الكامل",
      morningRange: "من 09:00 إلى 15:00 (في اليوم نفسه)",
      eveningRange: "من 17:00 إلى 02:00 (اليوم التالي)",
      fullDayRange: "من 09:00 إلى 02:00 (اليوم التالي)",
    },
    {
      locale: "ckb",
      morning: "ماوەی بەیانی",
      evening: "ماوەی ئێوارە",
      fullDay: "حجزکردنی تەواوی ڕۆژ",
      morningRange: "لە 09:00 تا 15:00 (لە هەمان ڕۆژدا)",
      eveningRange: "لە 17:00 تا 02:00 (ڕۆژی دواتر)",
      fullDayRange: "لە 09:00 تا 02:00 (ڕۆژی دواتر)",
    },
  ] as const)(
    "owner pricing identifies the saved shifts and independent Full-day price",
    async ({
      locale,
      morning,
      evening,
      fullDay,
      morningRange,
      eveningRange,
      fullDayRange,
    }) => {
      const copy = cottagePricingAvailabilityMessages[locale];
      const scheduleCopy = cottageShiftScheduleMessages[locale];
      const savedSchedule: CottageShiftSchedule = {
        ...schedule,
        shifts: [
          {
            ...schedule.shifts[0]!,
            name: "صباح AM <img src=x onerror=alert(1)>",
            startTime: "09:00",
            endTime: "15:00",
          },
          {
            ...schedule.shifts[1]!,
            name: "ئێوارە PM <script>alert(2)</script>",
            startTime: "17:00",
            endTime: "02:00",
            crossesMidnight: true,
          },
        ],
        fullDayStartTime: "09:00",
        fullDayEndTime: "02:00",
        fullDayCrossesMidnight: true,
      };
      savePricing.mockResolvedValue({ status: "saved" });
      const user = userEvent.setup();
      const view = render(
        <CottagePricingAvailabilityEditor
          locale={locale}
          profileId={savedSchedule.profileId}
          schedule={savedSchedule}
          pricing={pricing}
          editable
          canOpen
        />,
      );

      expect(screen.getByRole("region")).toHaveAttribute(
        "dir",
        locale === "en" ? "ltr" : "rtl",
      );
      const morningGroup = screen.getByRole("group", {
        name: `${morning}: ${savedSchedule.shifts[0]!.name}`,
      });
      const eveningGroup = screen.getByRole("group", {
        name: `${evening}: ${savedSchedule.shifts[1]!.name}`,
      });
      const fullDayGroup = screen.getByRole("group", { name: fullDay });
      expect(
        within(morningGroup).getByText(
          (_, element) =>
            element?.tagName === "P" && element.textContent === morningRange,
        ),
      ).toBeVisible();
      expect(
        within(eveningGroup).getByText(
          (_, element) =>
            element?.tagName === "P" && element.textContent === eveningRange,
        ),
      ).toBeVisible();
      expect(
        within(fullDayGroup).getByText(
          (_, element) =>
            element?.tagName === "STRONG" &&
            element.textContent === fullDayRange,
        ),
      ).toBeVisible();
      expect(
        within(fullDayGroup).getByText(scheduleCopy.fullDayIncludes),
      ).toBeVisible();
      expect(
        within(fullDayGroup).getByText(scheduleCopy.fullDayBetweenShifts),
      ).toBeVisible();
      expect(screen.getByText(scheduleCopy.independentPrices)).toBeVisible();
      expect(screen.getByText(scheduleCopy.reset)).toBeVisible();
      expect(screen.getByText(scheduleCopy.iraqTimeZone)).toBeVisible();
      expect(screen.getByText(scheduleCopy.clockFormat)).toBeVisible();
      for (const shift of savedSchedule.shifts) {
        const name = screen.getByText(shift.name, { selector: "bdi" });
        expect(name).toHaveAttribute("dir", "auto");
      }
      for (const clock of fullDayGroup.querySelectorAll("bdi")) {
        expect(clock).toHaveAttribute("dir", "ltr");
      }
      expect(view.container.querySelector("img, script")).toBeNull();
      expect(within(morningGroup).getAllByRole("spinbutton")[0]).toHaveValue(
        125000,
      );
      expect(within(eveningGroup).getAllByRole("spinbutton")[0]).toHaveValue(
        115000,
      );
      const bundlePrice = within(fullDayGroup).getAllByRole("spinbutton")[0]!;
      expect(bundlePrice).toHaveValue(220000);
      await user.clear(bundlePrice);
      await user.type(bundlePrice, "230000");
      expect(bundlePrice).toHaveValue(230000);
      await user.click(
        screen.getByRole("button", { name: copy.savePrices as string }),
      );
      await waitFor(() => expect(savePricing).toHaveBeenCalledTimes(1));
      const submission = savePricing.mock.calls[0]?.[1] as FormData;
      expect(submission.get("scheduleRevisionId")).toBe(
        schedule.scheduleRevisionId,
      );
      expect(submission.getAll("unitId")).toEqual([
        schedule.shifts[0]!.id,
        schedule.shifts[1]!.id,
        schedule.fullDayBundleId,
      ]);
      expect(submission.getAll("unitKind")).toEqual([
        "shift",
        "shift",
        "full_day_bundle",
      ]);
      expect(submission.getAll("standardPriceIqd")).toEqual([
        "125000",
        "115000",
        "230000",
      ]);
      expect(submission.getAll("weekday")).toEqual(["4", "", "", ""]);
      expect(submission.getAll("weekdayPriceIqd")).toEqual([
        "160000",
        "",
        "",
        "",
      ]);
      expect(submission.getAll("weekdayUnitId")).toEqual([
        schedule.shifts[0]!.id,
        schedule.shifts[0]!.id,
        schedule.shifts[1]!.id,
        schedule.fullDayBundleId,
      ]);
      expect(submission.getAll("serviceDay")).toEqual([
        "2099-08-27",
        "",
        "",
        "",
      ]);
      expect(submission.getAll("datePriceIqd")).toEqual(["180000", "", "", ""]);
      expect(submission.getAll("dateUnitId")).toEqual([
        schedule.shifts[0]!.id,
        schedule.shifts[0]!.id,
        schedule.shifts[1]!.id,
        schedule.fullDayBundleId,
      ]);
      expect(await screen.findByRole("status")).toHaveTextContent(
        copy.saved as string,
      );
      expect(saveAvailability).not.toHaveBeenCalled();
      expect(loadAvailability).not.toHaveBeenCalled();
    },
  );

  it("Sorani standard-price inputs have a natural accessible name", () => {
    render(
      <CottagePricingAvailabilityEditor
        locale="ckb"
        profileId={schedule.profileId}
        schedule={schedule}
        pricing={pricing}
        editable
        canOpen={false}
      />,
    );

    expect(
      screen.getByRole("spinbutton", {
        name: "نرخی ستاندارد بە دیناری عێراقی بۆ ماوەی بەیانی: Morning",
      }),
    ).toBeEnabled();
    expect(screen.getByRole("region")).toHaveAttribute("dir", "rtl");
  });

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
      screen.getByLabelText(
        "سعر الفترة الصباحية: Morning القياسي بالدينار العراقي",
      ),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "حفظ الأسعار" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "حفظ التوافر" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تحميل التوافر" })).toBeEnabled();
  });

  it.each([
    { locale: "ar", editable: true },
    { locale: "ar", editable: false },
    { locale: "ckb", editable: true },
    { locale: "ckb", editable: false },
    { locale: "en", editable: true },
  ] as const)(
    "isolates and keeps a loaded Service Day together in $locale when editable is $editable",
    async ({ locale, editable }) => {
      const copy = cottagePricingAvailabilityMessages[locale];
      const serviceDayLabel = copy.serviceDay as string;
      const loadAvailabilityLabel = copy.loadAvailability as string;
      const availabilityLabel = copy.availability as string;
      loadAvailability.mockResolvedValue({
        status: "loaded",
        serviceDay: "2099-08-20",
        units: [
          {
            id: schedule.shifts[0]!.id,
            kind: "shift",
            calendarState: "open",
            commitmentReference: null,
            editable: true,
          },
          {
            id: schedule.shifts[1]!.id,
            kind: "shift",
            calendarState: "open",
            commitmentReference: null,
            editable: true,
          },
          {
            id: schedule.fullDayBundleId,
            kind: "full_day_bundle",
            calendarState: "open",
            commitmentReference: null,
            editable: true,
          },
        ],
      });
      const user = userEvent.setup();
      render(
        <CottagePricingAvailabilityEditor
          locale={locale}
          profileId={schedule.profileId}
          schedule={schedule}
          pricing={pricing}
          editable={editable}
          canOpen
        />,
      );

      await user.type(
        screen.getByLabelText(new RegExp(serviceDayLabel), {
          selector: "input",
        }),
        "2099-08-20",
      );
      await user.click(
        screen.getByRole("button", { name: loadAvailabilityLabel }),
      );

      const heading = await screen.findByRole("heading", {
        name: `${availabilityLabel}: 2099-08-20`,
      });
      const serviceDay = heading.querySelector("bdi");
      expect(serviceDay).toHaveAttribute("dir", "ltr");
      expect(serviceDay).toHaveStyle({ whiteSpace: "nowrap" });
      expect(serviceDay).toHaveTextContent("2099-08-20");
    },
  );

  it.each([
    { locale: "ar", editable: true },
    { locale: "ar", editable: false },
    { locale: "ckb", editable: true },
    { locale: "ckb", editable: false },
  ] as const)(
    "isolates a mixed-direction reference in $locale when editable is $editable",
    async ({ locale, editable }) => {
      const copy = cottagePricingAvailabilityMessages[locale];
      const serviceDayLabel = copy.serviceDay as string;
      const loadAvailabilityLabel = copy.loadAvailability as string;
      const bookingReferenceLabel = copy.bookingReference as string;
      const commitmentReference = "REQ-2099-0820-A";
      loadAvailability.mockResolvedValue({
        status: "loaded",
        serviceDay: "2099-08-20",
        units: [
          {
            id: schedule.shifts[0]!.id,
            kind: "shift",
            calendarState: "pending_hold",
            commitmentReference,
            editable: false,
          },
          {
            id: schedule.shifts[1]!.id,
            kind: "shift",
            calendarState: "open",
            commitmentReference: null,
            editable: true,
          },
          {
            id: schedule.fullDayBundleId,
            kind: "full_day_bundle",
            calendarState: "component_unavailable",
            commitmentReference: null,
            editable: false,
          },
        ],
      });
      const user = userEvent.setup();
      render(
        <CottagePricingAvailabilityEditor
          locale={locale}
          profileId={schedule.profileId}
          schedule={schedule}
          pricing={pricing}
          editable={editable}
          canOpen
        />,
      );

      await user.type(
        screen.getByLabelText(new RegExp(serviceDayLabel), {
          selector: "input",
        }),
        "2099-08-20",
      );
      await user.click(
        screen.getByRole("button", { name: loadAvailabilityLabel }),
      );

      const reference = await screen.findByText(commitmentReference, {
        selector: "bdi",
      });
      expect(reference).toHaveAttribute("dir", "auto");
      expect(reference).not.toHaveStyle({ whiteSpace: "nowrap" });
      expect(reference.closest("span")).toHaveTextContent(
        `${bookingReferenceLabel}: ${commitmentReference}`,
      );
    },
  );

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
    expect(
      screen.getAllByRole("heading", { name: "Morning: Morning" }),
    ).toHaveLength(1);
    expect(screen.getAllByRole("heading", { name: "Full-day" })).toHaveLength(
      1,
    );
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
      "Add weekday override for Morning: Morning",
    );
    const addDate = screen.getByLabelText(
      "Add specific-date override for Morning: Morning",
    );
    expect(addWeekday.closest("details")).not.toHaveAttribute("open");
    expect(addDate.closest("details")).not.toHaveAttribute("open");

    await user.click(addWeekday);
    expect(addWeekday.closest("details")).toHaveAttribute("open");
    expect(
      screen.getByLabelText("Morning: Morning new weekday override"),
    ).toBeVisible();
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
      screen.getByLabelText("Morning: Morning standard price in IQD"),
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
          calendarState: "pending_hold",
          commitmentReference: "RC-REQUEST-2601",
          editable: false,
        },
        {
          id: schedule.shifts[1]!.id,
          kind: "shift",
          calendarState: "confirmed_booking",
          commitmentReference: "RC-BOOKING-2601",
          editable: false,
        },
        {
          id: schedule.fullDayBundleId,
          kind: "full_day_bundle",
          calendarState: "component_unavailable",
          commitmentReference: null,
          editable: false,
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
      await screen.findByLabelText("Morning: Morning operational state"),
    ).toHaveTextContent("Pending hold");
    expect(
      screen.getByLabelText("Evening: Evening operational state"),
    ).toHaveTextContent("Confirmed booking");
    expect(
      screen.getByText("RC-REQUEST-2601", { selector: "bdi" }).closest("span"),
    ).toHaveTextContent("Booking reference: RC-REQUEST-2601");
    expect(
      screen.getByText("RC-BOOKING-2601", { selector: "bdi" }).closest("span"),
    ).toHaveTextContent("Booking reference: RC-BOOKING-2601");
    expect(
      screen.getByLabelText("Full-day operational state"),
    ).toHaveTextContent("Unavailable because a component Shift is committed");
    expect(
      screen.getByLabelText("Morning: Morning operational state"),
    ).not.toHaveRole("combobox");
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

    expect(
      screen.getByLabelText("Morning: Morning standard price in IQD"),
    ).toHaveValue(125000);
    expect(
      screen.getByLabelText("Morning: Morning weekday override"),
    ).toHaveValue("4");
    expect(
      screen.getByLabelText(
        "Morning: Morning weekday override standard price in IQD",
      ),
    ).toHaveValue(160000);
    expect(
      screen.getByLabelText("Morning: Morning specific-date override"),
    ).toHaveValue("2099-08-27");
    expect(
      screen.getByLabelText(
        "Morning: Morning specific-date override standard price in IQD",
      ),
    ).toHaveValue(180000);
    expect(
      screen.queryByLabelText("Morning: Morning operational state"),
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

    await user.click(
      screen.getByLabelText("Add weekday override for Morning: Morning"),
    );
    await user.selectOptions(
      screen.getByLabelText("Morning: Morning new weekday override"),
      "4",
    );
    await user.type(
      screen.getByLabelText(
        "Morning: Morning new weekday override standard price in IQD",
      ),
      "110000",
    );
    await user.click(
      screen.getByLabelText("Add specific-date override for Morning: Morning"),
    );
    await user.type(
      screen.getByLabelText("Morning: Morning new specific-date override"),
      "2099-08-20",
    );
    await user.type(
      screen.getByLabelText(
        "Morning: Morning new specific-date override standard price in IQD",
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

    expect(
      screen.getByLabelText("Morning: Morning standard price in IQD"),
    ).toHaveValue(100000);
    expect(
      screen.getByLabelText("Morning: Morning weekday override"),
    ).toHaveValue("4");
    expect(
      screen.getByLabelText(
        "Morning: Morning weekday override standard price in IQD",
      ),
    ).toHaveValue(110000);
    expect(
      screen
        .getByLabelText("Add weekday override for Morning: Morning")
        .closest("details"),
    ).not.toHaveAttribute("open");
    expect(
      screen.getByLabelText("Morning: Morning specific-date override"),
    ).toHaveValue("2099-08-20");
    expect(
      screen.getByLabelText(
        "Morning: Morning specific-date override standard price in IQD",
      ),
    ).toHaveValue(125000);
    expect(
      screen
        .getByLabelText("Add specific-date override for Morning: Morning")
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
          calendarState: "private_blocked",
          commitmentReference: null,
          editable: true,
        },
        {
          id: schedule.shifts[1]!.id,
          kind: "shift",
          calendarState: "open",
          commitmentReference: null,
          editable: true,
        },
        {
          id: schedule.fullDayBundleId,
          kind: "full_day_bundle",
          calendarState: "closed",
          commitmentReference: null,
          editable: true,
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
      await screen.findByLabelText("Morning: Morning operational state"),
    ).toHaveValue("private_blocked");
    expect(
      screen.getByLabelText("Evening: Evening operational state"),
    ).toHaveValue("open");
    expect(screen.getByLabelText("Full-day operational state")).toHaveValue(
      "closed",
    );
    expect(
      screen.getByRole("button", { name: "Save availability" }),
    ).toBeEnabled();
  });
});
