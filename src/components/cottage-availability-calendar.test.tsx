import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CottageInventoryOwnerCalendarSpan,
  CottageInventoryAvailabilityBatchInput,
  CottageInventoryReviewedCell,
  CottageInventoryOwnerCalendarSpanUnit,
} from "@/cottage-inventory/cottage-inventory";
import type { CottageInventoryBatchActionState } from "@/cottage-inventory/actions";
import { cottagePricingAvailabilityMessages } from "@/i18n/cottage-pricing-availability-messages";

const { loadSpan, saveBatch } = vi.hoisted(() => ({
  loadSpan: vi.fn(),
  saveBatch: vi.fn(),
}));
vi.mock("@/cottage-inventory/actions", () => ({
  loadCottageInventoryCalendarSpanAction: loadSpan,
  setCottageInventoryAvailabilityBatchAction: saveBatch,
}));

const hostileName = '<img src=x onerror="alert(1)">';
const units = [
  {
    id: "morning",
    kind: "shift" as const,
    label: `Shift 1: ${hostileName}`,
    identity: "Shift 1",
    localName: hostileName,
    startTime: "06:00",
    endTime: "09:00",
    crossesMidnight: false,
  },
  {
    id: "afternoon",
    kind: "shift" as const,
    label: "Shift 2: Afternoon",
    identity: "Shift 2",
    localName: "Afternoon",
    startTime: "12:00",
    endTime: "15:00",
    crossesMidnight: false,
  },
  {
    id: "late",
    kind: "shift" as const,
    label: "Shift 3: Late",
    identity: "Shift 3",
    localName: "Late",
    startTime: "20:00",
    endTime: "02:00",
    crossesMidnight: true,
  },
  {
    id: "full",
    kind: "full_day_bundle" as const,
    label: "Full-day",
    identity: "Full-day",
    startTime: "06:00",
    endTime: "02:00",
    crossesMidnight: true,
  },
];
const props = {
  locale: "en" as const,
  profileId: "profile",
  scheduleRevisionId: "revision",
  units,
  refreshKey: 0,
  editable: true,
  canOpen: true,
};
const february = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29",
].map((day) => `2028-02-${day}`);
const states: CottageInventoryOwnerCalendarSpanUnit["calendarState"][] = [
  "closed",
  "open",
  "private_blocked",
  "pending_hold",
  "confirmed_booking",
  "component_unavailable",
  null,
];
function calendar(
  from = "2028-02-01",
  to = "2028-02-29",
  asOf = "2028-02-01T00:00:00Z",
  scope = props,
): CottageInventoryOwnerCalendarSpan {
  const count = Number(to.slice(-2));
  const dates =
    from === "2028-02-01"
      ? february
      : Array.from(
          { length: count },
          (_, i) => `${from.slice(0, 8)}${String(i + 1).padStart(2, "0")}`,
        );
  return {
    profileId: scope.profileId,
    scheduleRevisionId: scope.scheduleRevisionId,
    from,
    to,
    asOf,
    unitKeys: scope.units.map(({ id, kind }) => ({ id, kind })),
    days: dates.map((serviceDay, index) => ({
      serviceDay,
      units: scope.units.map(({ id, kind }, unitIndex) => {
        const state = states[(index * 4 + unitIndex) % states.length]!;
        return {
          id,
          kind,
          priceIqd: 100000,
          ownerState: "open",
          available: false,
          calendarState: state,
          commitmentReference:
            state === "confirmed_booking" ? "BOOK-123" : null,
          editable:
            state === "open" ||
            state === "closed" ||
            state === "private_blocked",
          temporarilyUnavailable: state === null,
        };
      }),
    })),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function component(): Promise<
  (typeof import("./cottage-availability-calendar"))["CottageAvailabilityCalendar"]
> {
  const modulePath = "./cottage-availability-calendar";
  return (await import(/* @vite-ignore */ modulePath))
    .CottageAvailabilityCalendar;
}

const batchUnits = units.map((unit, index) => ({
  ...unit,
  id: [
    "72000000-0000-4000-8000-000000000001",
    "72000000-0000-4000-8000-000000000002",
    "72000000-0000-4000-8000-000000000003",
    "73000000-0000-4000-8000-000000000001",
  ][index]!,
}));
const batchProps = {
  ...props,
  profileId: "70000000-0000-4000-8000-000000000001",
  scheduleRevisionId: "71000000-0000-4000-8000-000000000001",
  units: batchUnits,
};
const first = "2028-02-29";
const second = "2028-03-01";
const fullId = "73000000-0000-4000-8000-000000000001";
const morningId = "72000000-0000-4000-8000-000000000001";
const afternoonId = "72000000-0000-4000-8000-000000000002";
const lateId = "72000000-0000-4000-8000-000000000003";
const reviewedCells: CottageInventoryReviewedCell[] = [
  {
    serviceDay: first,
    id: fullId,
    kind: "full_day_bundle",
    expectedOwnerState: "closed",
  },
  {
    serviceDay: first,
    id: morningId,
    kind: "shift",
    expectedOwnerState: "closed",
  },
  {
    serviceDay: first,
    id: afternoonId,
    kind: "shift",
    expectedOwnerState: "closed",
  },
  {
    serviceDay: first,
    id: lateId,
    kind: "shift",
    expectedOwnerState: "private_blocked",
  },
  {
    serviceDay: second,
    id: fullId,
    kind: "full_day_bundle",
    expectedOwnerState: "closed",
  },
  {
    serviceDay: second,
    id: morningId,
    kind: "shift",
    expectedOwnerState: "closed",
  },
  {
    serviceDay: second,
    id: afternoonId,
    kind: "shift",
    expectedOwnerState: "closed",
  },
  {
    serviceDay: second,
    id: lateId,
    kind: "shift",
    expectedOwnerState: "closed",
  },
];
const expectedBatch: CottageInventoryAvailabilityBatchInput = {
  from: first,
  to: second,
  unitKeys: [
    { id: fullId, kind: "full_day_bundle" },
    { id: morningId, kind: "shift" },
    { id: afternoonId, kind: "shift" },
    { id: lateId, kind: "shift" },
  ],
  state: "open",
  mode: "range",
  cells: reviewedCells,
  replacePrivateBlocks: [],
  reviewConfirmed: false,
};
function rangeCalendar(): CottageInventoryOwnerCalendarSpan {
  return {
    profileId: batchProps.profileId,
    scheduleRevisionId: batchProps.scheduleRevisionId,
    from: first,
    to: second,
    asOf: "2028-02-01T00:00:00Z",
    unitKeys: expectedBatch.unitKeys,
    days: [first, second].map((serviceDay) => ({
      serviceDay,
      units: batchUnits.map(({ id, kind }) => ({
        id,
        kind,
        ownerState:
          serviceDay === first && id === lateId ? "private_blocked" : "closed",
        calendarState:
          serviceDay === first && id === afternoonId
            ? "pending_hold"
            : serviceDay === first && id === lateId
              ? "private_blocked"
              : "closed",
        commitmentReference:
          serviceDay === first && id === afternoonId ? "HOLD-<script>" : null,
        available: false,
        editable: !(serviceDay === first && id === afternoonId),
        priceIqd: 100000,
        temporarilyUnavailable: false,
      })),
    })),
  };
}
function loadBatchCalendar(_previous: unknown, form: FormData) {
  return Promise.resolve({
    status: "loaded",
    calendar:
      form.get("from") === first && form.get("to") === second
        ? rangeCalendar()
        : calendar(
            String(form.get("from")),
            String(form.get("to")),
            "2028-02-01T00:00:00Z",
            batchProps,
          ),
  });
}
async function chooseBatch(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByLabelText("From date");
  const panel = within(
    screen.getByRole("region", { name: "Change availability" }),
  );
  fireEvent.change(panel.getByLabelText("From date"), {
    target: { value: first },
  });
  fireEvent.change(panel.getByLabelText("To date"), {
    target: { value: second },
  });
  for (const unit of batchUnits)
    await user.click(panel.getByRole("checkbox", { name: unit.label }));
  await user.selectOptions(panel.getByLabelText("Availability state"), "open");
  await user.click(
    panel.getByRole("button", { name: "Review availability changes" }),
  );
  await panel.findByRole("list", { name: "Included dates and periods" });
}

describe("Cottage Availability Calendar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2028-02-01T00:00:00Z"));
    loadSpan.mockReset();
    saveBatch.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("renders every month state in each launch language without daily loading", async () => {
    const Calendar = await component();
    for (const locale of ["en", "ar", "ckb"] as const) {
      loadSpan.mockResolvedValue({
        status: "loaded",
        calendar: calendar(
          "2028-02-01",
          "2028-02-29",
          "2028-02-01T00:00:00Z",
          batchProps,
        ),
      });
      const view = render(<Calendar {...batchProps} locale={locale} />);
      const copy = cottagePricingAvailabilityMessages[locale];
      await screen.findByText("2028-02-29", { selector: "time" });
      const days = screen.getAllByRole("list", { name: /^2028-02-/ });
      expect(days).toHaveLength(29);
      expect(days.map((day) => day.getAttribute("aria-label"))).toEqual(
        february,
      );
      const dayCells = days.map((day) => within(day).getAllByRole("listitem"));
      for (const cells of dayCells) expect(cells).toHaveLength(4);
      for (const text of [
        copy.closed,
        copy.open,
        copy.privateBlocked,
        copy.pendingHold,
        copy.confirmedBooking,
        copy.componentUnavailable,
        copy.calendarTemporary,
        copy.calendarNotBookable,
      ])
        expect(screen.getAllByText(text as string).length).toBeGreaterThan(0);
      expect(
        screen.getAllByText(hostileName, { selector: 'bdi[dir="auto"]' }),
      ).toHaveLength(29);
      expect(
        screen.getAllByText("BOOK-123", { selector: 'bdi[dir="auto"]' }).length,
      ).toBeGreaterThan(0);
      for (const [cells, expected] of [
        [
          dayCells[0]!,
          [copy.closed, copy.open, copy.privateBlocked, copy.pendingHold],
        ],
        [
          dayCells[1]!,
          [
            copy.confirmedBooking,
            copy.componentUnavailable,
            copy.calendarTemporary,
            copy.closed,
          ],
        ],
      ] as const) {
        expected.forEach((label, index) =>
          expect(
            within(cells[index]!).getByText(label as string),
          ).toBeVisible(),
        );
      }
      const temporary = dayCells[1]![2]!;
      expect(
        within(temporary).queryByText(copy.pendingHold as string),
      ).not.toBeInTheDocument();
      expect(within(temporary).queryByText("BOOK-123")).not.toBeInTheDocument();
      expect(
        screen.getByRole("heading", {
          name: `${copy.calendarWeek} 2028-01-29`,
        }),
      ).toBeVisible();
      expect(view.container.querySelector("img, script")).toBeNull();
      expect(
        view.container.querySelectorAll(".cottage-calendar-week"),
      ).toHaveLength(5);
      expect(
        within(days[0]!).getByText("Late", { selector: "bdi" }),
      ).toBeVisible();
      expect(
        within(days[0]!).getAllByText("02:00", { selector: 'bdi[dir="ltr"]' }),
      ).toHaveLength(2);
      const panel = within(
        screen.getByRole("region", { name: copy.batchHeading as string }),
      );
      expect(
        panel.getByRole("heading", { name: copy.batchHeading as string }),
      ).toBeVisible();
      expect(panel.getByLabelText(copy.batchFrom as string)).toBeVisible();
      expect(panel.getByLabelText(copy.batchTo as string)).toBeVisible();
      expect(
        panel.getByRole("group", { name: copy.batchUnits as string }),
      ).toBeVisible();
      expect(
        view.container.querySelector(".cottage-calendar-batch"),
      ).toHaveAttribute("aria-labelledby");
      expect(loadSpan).toHaveBeenCalledTimes(1);
      const form = loadSpan.mock.calls[0]![1] as FormData;
      expect(Object.fromEntries(form)).toEqual({
        profileId: batchProps.profileId,
        scheduleRevisionId: batchProps.scheduleRevisionId,
        from: "2028-02-01",
        to: "2028-02-29",
      });
      const user = userEvent.setup();
      const single = calendar(
        "2028-02-01",
        "2028-02-29",
        "2028-02-01T00:00:00Z",
        batchProps,
      );
      single.from = "2028-02-01";
      single.to = "2028-02-01";
      single.days = [single.days[0]!];
      single.days[0]!.units[0]!.ownerState = "private_blocked";
      single.days[0]!.units[0]!.calendarState = "private_blocked";
      loadSpan.mockResolvedValueOnce({ status: "loaded", calendar: single });
      await user.click(panel.getByRole("checkbox", { name: units[0]!.label }));
      await user.click(
        panel.getByRole("button", { name: copy.batchReview as string }),
      );
      await panel.findByRole("list", { name: copy.batchIncluded as string });
      expect(panel.getByText(copy.batchConsentHelp as string)).toBeVisible();
      const label = (copy.batchReplace as string)
        .replace("{date}", "2028-02-01")
        .replace("{unit}", units[0]!.label);
      const privateConsent = panel.getByRole("checkbox", { name: label });
      expect(privateConsent).not.toBeChecked();
      await user.click(privateConsent);
      saveBatch.mockResolvedValueOnce({
        status: "refused",
        profileId: batchProps.profileId,
        scheduleRevisionId: batchProps.scheduleRevisionId,
        request: {
          from: single.from,
          to: single.to,
          unitKeys: [{ id: batchUnits[0]!.id, kind: "shift" }],
          state: "closed",
          mode: "range",
          cells: [
            {
              serviceDay: single.from,
              id: batchUnits[0]!.id,
              kind: "shift",
              expectedOwnerState: "private_blocked",
            },
          ],
          replacePrivateBlocks: [
            { serviceDay: single.from, id: batchUnits[0]!.id, kind: "shift" },
          ],
          reviewConfirmed: false,
        },
        conflicts: [
          {
            serviceDay: single.from,
            id: batchUnits[0]!.id,
            kind: "shift",
            reason: "stale_state",
            commitmentReference: null,
          },
        ],
        eligible: [],
        calendar: single,
      });
      await user.click(
        panel.getByRole("button", { name: copy.batchApply as string }),
      );
      expect(await screen.findByText(copy.reasonStale as string)).toBeVisible();
      view.unmount();
      loadSpan.mockClear();
    }
    const wrong = calendar();
    wrong.unitKeys[0]!.id = "another-shift";
    loadSpan.mockResolvedValue({ status: "loaded", calendar: wrong });
    render(<Calendar {...props} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      cottagePricingAvailabilityMessages.en.calendarUnavailable as string,
    );
    expect(
      screen.queryByText("2028-02-29", { selector: "time" }),
    ).not.toBeInTheDocument();
  });
  it("navigates complete Gregorian months using authoritative Baghdad dates", async () => {
    const Calendar = await component();
    loadSpan.mockImplementation(async (_previous, form: FormData) => ({
      status: "loaded",
      calendar: calendar(String(form.get("from")), String(form.get("to"))),
    }));
    const user = userEvent.setup();
    const view = render(<Calendar {...props} />);
    let navigation = within(
      view.container.querySelector<HTMLElement>(
        ".cottage-calendar-navigation",
      )!,
    );
    await screen.findByText("2028-02-29", { selector: "time" });
    expect(
      navigation.getByRole("button", { name: "Previous month" }),
    ).toBeDisabled();
    await user.click(navigation.getByRole("button", { name: "Next month" }));
    await screen.findByText("2028-03-31", { selector: "time" });
    const previous = navigation.getByRole("button", { name: "Previous month" });
    const heading = screen.getByRole("heading", {
      name: "Monthly availability",
    });
    const pending = deferred<{
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    }>();
    loadSpan.mockReturnValueOnce(pending.promise);
    previous.focus();
    await user.keyboard("{Enter}");
    expect(previous).toBeDisabled();
    expect(previous).toHaveAttribute("aria-busy", "true");
    expect(heading).toBeInTheDocument();
    expect(heading).not.toHaveFocus();
    await act(async () =>
      pending.resolve({ status: "loaded", calendar: calendar() }),
    );
    await waitFor(() => expect(heading).toHaveFocus());
    expect(previous).toBeDisabled();
    fireEvent.change(navigation.getByLabelText("Show month containing date"), {
      target: { value: "2028-12-17" },
    });
    await screen.findByText("2028-12-31", { selector: "time" });
    await user.click(navigation.getByRole("button", { name: "Next month" }));
    await screen.findByText("2029-01-31", { selector: "time" });
    await user.click(
      navigation.getByRole("button", { name: "Previous month" }),
    );
    await screen.findByText("2028-12-31", { selector: "time" });
    view.unmount();
    loadSpan.mockReset();

    vi.setSystemTime(new Date("2028-02-29T20:59:59Z"));
    loadSpan.mockImplementation(async (_previous, form: FormData) => ({
      status: "loaded",
      calendar: calendar(
        String(form.get("from")),
        String(form.get("to")),
        "2028-02-29T21:00:00Z",
      ),
    }));
    const midnight = render(<Calendar {...props} />);
    navigation = within(
      midnight.container.querySelector<HTMLElement>(
        ".cottage-calendar-navigation",
      )!,
    );
    await screen.findByText("2028-03-31", { selector: "time" });
    expect(
      screen.queryByText("2028-02-29", { selector: "time" }),
    ).not.toBeInTheDocument();
    expect(loadSpan).toHaveBeenCalledTimes(2);
    expect(
      navigation.getByLabelText("Show month containing date"),
    ).toHaveAttribute("min", "2028-03-01");
    midnight.unmount();
    loadSpan.mockReset();

    vi.setSystemTime(new Date("2028-04-01T00:00:00Z"));
    loadSpan.mockImplementation(async (_previous, form: FormData) => ({
      status: "loaded",
      calendar: calendar(
        String(form.get("from")),
        String(form.get("to")),
        "2028-02-15T09:00:00Z",
      ),
    }));
    const ahead = render(<Calendar {...props} />);
    navigation = within(
      ahead.container.querySelector<HTMLElement>(
        ".cottage-calendar-navigation",
      )!,
    );
    await screen.findByText("2028-02-29", { selector: "time" });
    expect(
      within(
        screen
          .getByRole("list", { name: "2028-02-14" })
          .closest(".cottage-calendar-day")!,
      ).getByText("Past date · read-only"),
    ).toBeVisible();
    const today = screen.getByRole("list", { name: "2028-02-15" });
    expect(
      within(today).getAllByText("Already started · read-only"),
    ).toHaveLength(3);
    expect(
      within(today).queryByText("Past date · read-only"),
    ).not.toBeInTheDocument();
    expect(
      navigation.getByRole("button", { name: "Previous month" }),
    ).toBeDisabled();
    fireEvent.change(navigation.getByLabelText("Show month containing date"), {
      target: { value: "2028-01-15" },
    });
    expect(navigation.getByLabelText("Show month containing date")).toHaveValue(
      "2028-02-01",
    );
    ahead.unmount();
    loadSpan.mockReset();

    vi.setSystemTime(new Date("2028-02-29T20:59:59Z"));
    const first = deferred<{
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    }>();
    loadSpan
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async (_previous, form: FormData) => ({
        status: "loaded",
        calendar: calendar(
          String(form.get("from")),
          String(form.get("to")),
          "2028-02-29T21:00:00Z",
        ),
      }));
    const viewForLast = render(<Calendar {...props} />);
    navigation = within(
      viewForLast.container.querySelector<HTMLElement>(
        ".cottage-calendar-navigation",
      )!,
    );
    await waitFor(() => expect(loadSpan).toHaveBeenCalledTimes(1));
    await user.click(navigation.getByRole("button", { name: "Next month" }));
    await screen.findByText("2028-03-31", { selector: "time" });
    await act(async () =>
      first.resolve({ status: "loaded", calendar: calendar() }),
    );
    expect(screen.getByText("2028-03-31", { selector: "time" })).toBeVisible();
    fireEvent.change(navigation.getByLabelText("Show month containing date"), {
      target: { value: "2028-05-16" },
    });
    await screen.findByText("2028-05-31", { selector: "time" });
    expect(navigation.getByLabelText("Show month containing date")).toHaveValue(
      "2028-05-16",
    );
    loadSpan.mockImplementation(async (_previous, form: FormData) => ({
      status: "loaded",
      calendar: calendar(
        String(form.get("from")),
        String(form.get("to")),
        "2028-03-31T21:00:00Z",
      ),
    }));
    fireEvent.change(navigation.getByLabelText("Show month containing date"), {
      target: { value: "2028-03-15" },
    });
    await screen.findByText("2028-04-30", { selector: "time" });
    expect(
      navigation.getByLabelText("Show month containing date"),
    ).toHaveAttribute("min", "2028-04-01");
    viewForLast.unmount();
    loadSpan.mockReset();

    vi.setSystemTime(new Date("2028-04-01T00:00:00Z"));
    const hint = deferred<{
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    }>();
    loadSpan.mockReturnValueOnce(hint.promise);
    const hintView = render(<Calendar {...props} />);
    navigation = within(
      hintView.container.querySelector<HTMLElement>(
        ".cottage-calendar-navigation",
      )!,
    );
    await waitFor(() => expect(loadSpan).toHaveBeenCalledTimes(1));
    fireEvent.change(navigation.getByLabelText("Show month containing date"), {
      target: { value: "2028-04-16" },
    });
    await act(async () =>
      hint.resolve({
        status: "loaded",
        calendar: calendar("2028-04-01", "2028-04-30", "2028-02-15T09:00:00Z"),
      }),
    );
    await screen.findByText("2028-04-30", { selector: "time" });
    expect(navigation.getByLabelText("Show month containing date")).toHaveValue(
      "2028-04-16",
    );
    expect(
      navigation.getByLabelText("Show month containing date"),
    ).toHaveAttribute("min", "2028-02-01");
  });

  it("ignores stale calendar responses and exposes load failures", async () => {
    const Calendar = await component();
    const user = userEvent.setup();
    type Loaded = {
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    };
    const initial = deferred<Loaded>();
    const next = deferred<Loaded>();
    const profile = deferred<Loaded>();
    const revision = deferred<Loaded>();
    loadSpan
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(next.promise)
      .mockReturnValueOnce(profile.promise)
      .mockReturnValueOnce(revision.promise);
    const view = render(<Calendar {...props} />);
    let navigation = within(
      view.container.querySelector<HTMLElement>(
        ".cottage-calendar-navigation",
      )!,
    );
    await waitFor(() => expect(loadSpan).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading month availability",
    );
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    await user.click(navigation.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(loadSpan).toHaveBeenCalledTimes(2));
    const newProfile = { ...props, profileId: "new-profile" };
    view.rerender(<Calendar {...newProfile} />);
    await waitFor(() => expect(loadSpan).toHaveBeenCalledTimes(3));
    const newRevision = { ...newProfile, scheduleRevisionId: "new-revision" };
    view.rerender(<Calendar {...newRevision} />);
    await waitFor(() => expect(loadSpan).toHaveBeenCalledTimes(4));
    await act(async () =>
      revision.resolve({
        status: "loaded",
        calendar: calendar(
          "2028-02-01",
          "2028-02-29",
          "2028-02-01T00:00:00Z",
          newRevision,
        ),
      }),
    );
    await screen.findByText("2028-02-29", { selector: "time" });
    await act(async () => {
      profile.resolve({
        status: "loaded",
        calendar: calendar(
          "2028-02-01",
          "2028-02-29",
          "2030-04-01T00:00:00Z",
          newProfile,
        ),
      });
      next.resolve({
        status: "loaded",
        calendar: calendar("2028-03-01", "2028-03-31", "2031-04-01T00:00:00Z"),
      });
      initial.resolve({
        status: "loaded",
        calendar: calendar("2028-02-01", "2028-02-29", "2032-04-01T00:00:00Z"),
      });
    });
    expect(screen.getByText("2028-02-29", { selector: "time" })).toBeVisible();
    expect(
      navigation.getByLabelText("Show month containing date"),
    ).toHaveAttribute("min", "2028-02-01");
    expect(loadSpan).toHaveBeenCalledTimes(4);
    const stalePrevious = deferred<Loaded>();
    const finalPrevious = deferred<Loaded>();
    loadSpan.mockResolvedValueOnce({
      status: "loaded",
      calendar: calendar(
        "2028-03-01",
        "2028-03-31",
        "2028-02-01T00:00:00Z",
        newRevision,
      ),
    });
    await user.click(navigation.getByRole("button", { name: "Next month" }));
    await screen.findByText("2028-03-31", { selector: "time" });
    loadSpan
      .mockReturnValueOnce(stalePrevious.promise)
      .mockReturnValueOnce(finalPrevious.promise);
    const previous = navigation.getByRole("button", { name: "Previous month" });
    const heading = screen.getByRole("heading", {
      name: "Monthly availability",
    });
    previous.focus();
    await user.keyboard("{Enter}");
    view.rerender(<Calendar {...newRevision} refreshKey={1} />);
    await waitFor(() => expect(loadSpan).toHaveBeenCalledTimes(7));
    await act(async () =>
      stalePrevious.resolve({
        status: "loaded",
        calendar: calendar(
          "2028-02-01",
          "2028-02-29",
          "2028-02-01T00:00:00Z",
          newRevision,
        ),
      }),
    );
    expect(heading).not.toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading month availability",
    );
    await act(async () =>
      finalPrevious.resolve({
        status: "loaded",
        calendar: calendar(
          "2028-02-01",
          "2028-02-29",
          "2028-02-01T00:00:00Z",
          newRevision,
        ),
      }),
    );
    await waitFor(() => expect(heading).toHaveFocus());
    view.unmount();
    loadSpan.mockReset();

    for (const [failure, expected] of [
      [
        "unavailable",
        "Month availability is temporarily unavailable. Try again.",
      ],
      [
        "conflict",
        "The Shift Schedule changed. Reload this page to see the current schedule.",
      ],
      [
        "denied",
        "You cannot view this cottage’s availability with your current access.",
      ],
      ["invalid", "Choose a valid Gregorian date and try again."],
      ["thrown", "Month availability is temporarily unavailable. Try again."],
    ] as const) {
      if (failure === "thrown")
        loadSpan.mockRejectedValueOnce(new Error("transport"));
      else loadSpan.mockResolvedValueOnce({ status: failure });
      const failed = render(<Calendar {...props} />);
      expect(await screen.findByRole("alert")).toHaveTextContent(expected);
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
      const heading = screen.getByRole("heading", {
        name: "Monthly availability",
      });
      const retry = screen.getByRole("button", {
        name: "Retry month availability",
      });
      const retried = deferred<Loaded>();
      loadSpan.mockReturnValueOnce(retried.promise);
      retry.focus();
      await user.keyboard("{Enter}");
      expect(retry).toBeInTheDocument();
      expect(retry).toBeDisabled();
      expect(retry).toHaveAttribute("aria-busy", "true");
      expect(heading).toBeInTheDocument();
      expect(heading).not.toHaveFocus();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Loading month availability",
      );
      await act(async () =>
        retried.resolve({ status: "loaded", calendar: calendar() }),
      );
      await waitFor(() => expect(heading).toHaveFocus());
      expect(retry).not.toBeInTheDocument();
      expect(
        screen.getByText("2028-02-29", { selector: "time" }),
      ).toBeVisible();
      failed.unmount();
    }
    loadSpan.mockResolvedValueOnce({ status: "unavailable" });
    const finalView = render(<Calendar {...props} />);
    navigation = within(
      finalView.container.querySelector<HTMLElement>(
        ".cottage-calendar-navigation",
      )!,
    );
    let retry = await screen.findByRole("button", {
      name: "Retry month availability",
    });
    loadSpan.mockResolvedValueOnce({ status: "unavailable" });
    retry.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(retry).toBeEnabled());
    expect(retry).toHaveFocus();
    const cancelled = deferred<Loaded>();
    loadSpan.mockReturnValueOnce(cancelled.promise);
    retry = screen.getByRole("button", { name: "Retry month availability" });
    await user.keyboard("{Enter}");
    await user.tab();
    expect(
      navigation.getByLabelText("Show month containing date"),
    ).toHaveFocus();
    await act(async () =>
      cancelled.resolve({ status: "loaded", calendar: calendar() }),
    );
    await screen.findByText("2028-02-29", { selector: "time" });
    expect(
      navigation.getByLabelText("Show month containing date"),
    ).toHaveFocus();
  });
  it("reviews every included cell and requires fresh consent after a refusal", async () => {
    const Calendar = await component();
    const user = userEvent.setup();
    loadSpan.mockImplementation(loadBatchCalendar);
    const view = render(<Calendar {...batchProps} />);
    await screen.findByLabelText("From date");
    let panel = within(
      screen.getByRole("region", { name: "Change availability" }),
    );
    const navigation = within(
      view.container.querySelector<HTMLElement>(
        ".cottage-calendar-navigation",
      )!,
    );
    const initialReads = loadSpan.mock.calls.length;
    await user.click(
      panel.getByRole("button", { name: "Review availability changes" }),
    );
    expect(loadSpan).toHaveBeenCalledTimes(initialReads);
    expect(
      screen.getByText(
        "Check the selected dates and units, then review again.",
      ),
    ).toBeVisible();
    await chooseBatch(user);
    const included = panel.getByRole("list", {
      name: "Included dates and periods",
    });
    const includedCells = within(included).getAllByRole("listitem");
    expect(includedCells).toHaveLength(8);
    for (const day of [first, second])
      for (const unit of batchUnits) {
        const row = includedCells.find(
          (item) =>
            item.textContent?.includes(day) &&
            item.textContent.includes(unit.label),
        );
        expect(row).toBeDefined();
        expect(row).toHaveTextContent("Proposed state: Open");
      }
    expect(
      within(included).getByText("HOLD-<script>", {
        selector: 'bdi[dir="auto"]',
      }),
    ).toBeVisible();
    expect(saveBatch).not.toHaveBeenCalled();
    const consentName = `Replace private block: ${first} · Shift 3: Late`;
    const consent = panel.getByRole("checkbox", { name: consentName });
    expect(consent).not.toBeChecked();
    const apply = panel.getByRole("button", {
      name: "Apply reviewed changes",
    });
    expect(apply).toBeDisabled();
    await user.click(consent);
    const monthCellsBefore = within(
      screen.getByRole("list", { name: first }),
    ).getAllByRole("listitem");
    expect(within(monthCellsBefore[0]!).getByText("Closed")).toBeVisible();
    const oldMarchRead = deferred<{
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    }>();
    const oldFebruaryRead = deferred<{
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    }>();
    loadSpan.mockReturnValueOnce(oldMarchRead.promise);
    await user.click(navigation.getByRole("button", { name: "Next month" }));
    loadSpan.mockReturnValueOnce(oldFebruaryRead.promise);
    await user.click(
      navigation.getByRole("button", { name: "Previous month" }),
    );
    const pendingWrite = deferred<CottageInventoryBatchActionState>();
    saveBatch.mockReturnValueOnce(pendingWrite.promise);
    apply.focus();
    await user.keyboard("{Enter}");
    fireEvent.click(apply);
    expect(saveBatch).toHaveBeenCalledTimes(1);
    expect(apply).toBeInTheDocument();
    expect(apply).toHaveAttribute("aria-busy", "true");
    const heading = panel.getByRole("heading", {
      name: "Change availability",
    });
    expect(heading).not.toHaveFocus();
    const sent = saveBatch.mock.calls[0]![1] as FormData;
    expect([...sent.keys()].sort()).toEqual([
      "batch",
      "locale",
      "profileId",
      "scheduleRevisionId",
    ]);
    expect(sent.get("locale")).toBe("en");
    expect(sent.get("profileId")).toBe(batchProps.profileId);
    expect(sent.get("scheduleRevisionId")).toBe(batchProps.scheduleRevisionId);
    const consentCoordinate = { serviceDay: first, id: lateId, kind: "shift" };
    expect(JSON.parse(String(sent.get("batch")))).toEqual({
      ...expectedBatch,
      replacePrivateBlocks: [consentCoordinate],
    });
    const fresh = rangeCalendar();
    fresh.days[0]!.units[2]!.ownerState = "open";
    fresh.days[0]!.units[0]!.ownerState = "private_blocked";
    fresh.days[0]!.units[0]!.calendarState = "private_blocked";
    const eligible = [
      reviewedCells[2]!,
      reviewedCells[3]!,
      ...reviewedCells.slice(4),
    ];
    const refusal = {
      status: "refused" as const,
      profileId: batchProps.profileId,
      scheduleRevisionId: batchProps.scheduleRevisionId,
      request: {
        ...expectedBatch,
        replacePrivateBlocks: [
          consentCoordinate,
        ] as CottageInventoryAvailabilityBatchInput["replacePrivateBlocks"],
      },
      conflicts: [
        {
          serviceDay: first,
          id: fullId,
          kind: "full_day_bundle" as const,
          reason: "bundle_components_unavailable" as const,
          commitmentReference: null,
        },
        {
          serviceDay: first,
          id: morningId,
          kind: "shift" as const,
          reason: "stale_state" as const,
          commitmentReference: null,
        },
      ],
      eligible,
      calendar: fresh,
    };
    const freshMonth = calendar(
      "2028-02-01",
      "2028-02-29",
      "2028-02-01T00:00:00Z",
      batchProps,
    );
    const externallyBlocked = freshMonth.days
      .find((day) => day.serviceDay === first)!
      .units.find((cell) => cell.id === morningId)!;
    externallyBlocked.ownerState = "private_blocked";
    externallyBlocked.calendarState = "private_blocked";
    const refusalRefresh = deferred<{
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    }>();
    const beforeRefusalReads = loadSpan.mock.calls.length;
    loadSpan.mockReturnValueOnce(refusalRefresh.promise);
    await act(async () => pendingWrite.resolve(refusal));
    await waitFor(() =>
      expect(loadSpan).toHaveBeenCalledTimes(beforeRefusalReads + 1),
    );
    const refreshForm = loadSpan.mock.calls[beforeRefusalReads]![1] as FormData;
    expect(refreshForm.get("from")).toBe("2028-02-01");
    expect(refreshForm.get("to")).toBe("2028-02-29");
    await act(async () => {
      oldFebruaryRead.resolve({
        status: "loaded",
        calendar: calendar(
          "2028-02-01",
          "2028-02-29",
          "2028-02-01T00:00:00Z",
          batchProps,
        ),
      });
      oldMarchRead.resolve({
        status: "loaded",
        calendar: calendar(
          "2028-03-01",
          "2028-03-31",
          "2028-02-01T00:00:00Z",
          batchProps,
        ),
      });
    });
    expect(screen.queryByRole("list", { name: first })).not.toBeInTheDocument();
    expect(screen.getByText("Loading month availability…")).toBeVisible();
    expect(
      panel.getByRole("button", { name: "Review eligible changes" }),
    ).toBeVisible();
    await act(async () =>
      refusalRefresh.resolve({ status: "loaded", calendar: freshMonth }),
    );
    const monthCellsAfter = within(
      await screen.findByRole("list", { name: first }),
    ).getAllByRole("listitem");
    expect(
      within(monthCellsAfter[0]!).getByText("Private block"),
    ).toBeVisible();
    expect(
      within(monthCellsAfter[0]!).queryByText("Closed"),
    ).not.toBeInTheDocument();

    await waitFor(() => expect(heading).toHaveFocus());
    expect(
      screen.getByText("No availability changes were saved."),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Availability changed after your review. Review this selection again.",
      ),
    ).toBeVisible();
    expect(
      panel.getByRole("list", { name: "Eligible dates and periods" }).children,
    ).toHaveLength(6);
    expect(
      panel.getByRole("list", { name: "Excluded dates and periods" }).children,
    ).toHaveLength(2);
    const offer = panel.getByRole("button", {
      name: "Review eligible changes",
    });
    offer.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(heading).toHaveFocus());
    expect(saveBatch).toHaveBeenCalledTimes(1);
    expect(
      panel.getByRole("list", { name: "Included dates and periods" }).children,
    ).toHaveLength(6);
    const confirmation = panel.getByRole("checkbox", {
      name: "I reviewed this smaller batch",
    });
    expect(confirmation).not.toBeChecked();
    expect(
      panel.getByRole("checkbox", { name: consentName }),
    ).not.toBeChecked();
    expect(
      panel.getByRole("button", { name: "Apply reviewed changes" }),
    ).toBeDisabled();
    await user.click(confirmation);
    expect(
      panel.getByRole("button", { name: "Apply reviewed changes" }),
    ).toBeDisabled();
    await user.click(panel.getByRole("checkbox", { name: consentName }));
    view.rerender(<Calendar {...batchProps} locale="ar" />);
    expect(
      panel.getByRole("checkbox", {
        name: cottagePricingAvailabilityMessages.ar.batchConfirm as string,
      }),
    ).not.toBeChecked();
    expect(
      panel.getByRole("button", {
        name: cottagePricingAvailabilityMessages.ar.batchApply as string,
      }),
    ).toBeDisabled();
    view.rerender(<Calendar {...batchProps} />);
    expect(
      panel.getByRole("checkbox", { name: "I reviewed this smaller batch" }),
    ).not.toBeChecked();
    expect(
      panel.getByRole("checkbox", { name: consentName }),
    ).not.toBeChecked();
    await user.click(
      panel.getByRole("checkbox", { name: "I reviewed this smaller batch" }),
    );
    await user.click(panel.getByRole("checkbox", { name: consentName }));
    saveBatch.mockResolvedValueOnce({
      ...refusal,
      request: {
        ...refusal.request,
        mode: "reviewed",
        cells: eligible,
        reviewConfirmed: true,
      },
      conflicts: eligible.map(({ serviceDay, id, kind }) => ({
        serviceDay,
        id,
        kind,
        reason: "stale_state",
        commitmentReference: null,
      })),
      eligible: [],
    });
    await user.click(
      panel.getByRole("button", { name: "Apply reviewed changes" }),
    );
    await screen.findByText(
      "No eligible changes remain. Choose a new range or review again.",
    );
    expect(
      JSON.parse(
        String((saveBatch.mock.calls[1]![1] as FormData).get("batch")),
      ),
    ).toEqual({
      ...expectedBatch,
      mode: "reviewed",
      cells: eligible,
      replacePrivateBlocks: [consentCoordinate],
      reviewConfirmed: true,
    });
    expect(
      panel.queryByRole("button", { name: "Apply reviewed changes" }),
    ).not.toBeInTheDocument();
    for (const status of [
      "invalid",
      "denied",
      "conflict",
      "unavailable",
    ] as const) {
      await user.click(
        panel.getByRole("button", { name: "Review availability changes" }),
      );
      await panel.findByRole("list", { name: "Included dates and periods" });
      await user.click(panel.getByRole("checkbox", { name: consentName }));
      saveBatch.mockResolvedValueOnce(
        status === "invalid" ? { status, fields: ["batch"] } : { status },
      );
      const beforeCalls = saveBatch.mock.calls.length;
      const errorApply = panel.getByRole("button", {
        name: "Apply reviewed changes",
      });
      if (status === "invalid") {
        await act(async () => {
          fireEvent.click(errorApply);
          fireEvent.click(errorApply);
        });
      } else await user.click(errorApply);
      expect(saveBatch).toHaveBeenCalledTimes(beforeCalls + 1);
      await waitFor(() =>
        expect(
          panel.queryByRole("button", { name: "Apply reviewed changes" }),
        ).not.toBeInTheDocument(),
      );
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    }
    await user.click(
      panel.getByRole("button", { name: "Review availability changes" }),
    );
    await panel.findByRole("list", { name: "Included dates and periods" });
    fireEvent.change(panel.getByLabelText("To date"), {
      target: { value: "2028-04-02" },
    });
    expect(
      panel.queryByRole("list", { name: "Included dates and periods" }),
    ).not.toBeInTheDocument();
    const reads = loadSpan.mock.calls.length;
    await user.click(
      panel.getByRole("button", { name: "Review availability changes" }),
    );
    expect(loadSpan).toHaveBeenCalledTimes(reads);
    expect(
      screen.getByText(
        "Check the selected dates and units, then review again.",
      ),
    ).toBeVisible();
    fireEvent.change(panel.getByLabelText("To date"), {
      target: { value: second },
    });
    const staleReview = deferred<{
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    }>();
    loadSpan.mockReturnValueOnce(staleReview.promise);
    await user.click(
      panel.getByRole("button", { name: "Review availability changes" }),
    );
    await user.click(navigation.getByLabelText("Show month containing date"));
    loadSpan.mockResolvedValueOnce({
      status: "loaded",
      calendar: calendar(
        "2028-02-01",
        "2028-02-29",
        "2028-02-02T00:00:00Z",
        batchProps,
      ),
    });
    view.rerender(<Calendar {...batchProps} refreshKey={1} />);
    await screen.findByText("2028-02-02 03:00:00", {
      selector: 'bdi[dir="ltr"]',
    });
    await act(async () =>
      staleReview.resolve({ status: "loaded", calendar: rangeCalendar() }),
    );
    expect(
      screen.getByText("2028-02-02 03:00:00", { selector: 'bdi[dir="ltr"]' }),
    ).toBeVisible();
    expect(screen.getByLabelText("From date")).toHaveAttribute(
      "min",
      "2028-02-02",
    );
    expect(
      navigation.getByLabelText("Show month containing date"),
    ).toHaveFocus();
    expect(
      panel.queryByRole("list", { name: "Included dates and periods" }),
    ).not.toBeInTheDocument();
    await user.click(
      panel.getByRole("button", { name: "Review availability changes" }),
    );
    await panel.findByRole("list", { name: "Included dates and periods" });
    view.rerender(<Calendar {...batchProps} refreshKey={1} canOpen={false} />);
    expect(
      panel.queryByRole("button", { name: "Apply reviewed changes" }),
    ).not.toBeInTheDocument();
    expect(
      panel.getByRole("button", { name: "Review availability changes" }),
    ).toBeDisabled();
    view.rerender(<Calendar {...batchProps} refreshKey={1} />);
    await user.click(
      panel.getByRole("button", { name: "Review availability changes" }),
    );
    await panel.findByRole("list", { name: "Included dates and periods" });
    await user.click(
      panel.getByRole("checkbox", { name: batchUnits[2]!.label }),
    );
    expect(
      panel.queryByRole("list", { name: "Included dates and periods" }),
    ).not.toBeInTheDocument();
    await user.click(
      panel.getByRole("checkbox", { name: batchUnits[2]!.label }),
    );
    const lateRevisionReview = deferred<{
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    }>();
    loadSpan.mockReturnValueOnce(lateRevisionReview.promise);
    await user.click(
      panel.getByRole("button", { name: "Review availability changes" }),
    );
    loadSpan.mockImplementation(async (_previous, form: FormData) => {
      const result = await loadBatchCalendar(_previous, form);
      return {
        ...result,
        calendar: {
          ...result.calendar,
          profileId: String(form.get("profileId")),
          scheduleRevisionId: String(form.get("scheduleRevisionId")),
        },
      };
    });
    const newRevision = {
      ...batchProps,
      scheduleRevisionId: "71000000-0000-4000-8000-000000000002",
    };
    view.rerender(<Calendar {...newRevision} />);
    await waitFor(() =>
      expect(screen.getByLabelText("From date")).toHaveValue("2028-02-01"),
    );
    panel = within(screen.getByRole("region", { name: "Change availability" }));
    await act(async () =>
      lateRevisionReview.resolve({
        status: "loaded",
        calendar: rangeCalendar(),
      }),
    );
    expect(
      panel.queryByRole("list", { name: "Included dates and periods" }),
    ).not.toBeInTheDocument();
    for (const unit of batchUnits)
      expect(
        panel.getByRole("checkbox", { name: unit.label }),
      ).not.toBeChecked();
    const newProfile = {
      ...newRevision,
      profileId: "70000000-0000-4000-8000-000000000002",
    };
    view.rerender(<Calendar {...newProfile} />);
    await waitFor(() =>
      expect(screen.getByLabelText("From date")).toHaveValue("2028-02-01"),
    );
    panel = within(screen.getByRole("region", { name: "Change availability" }));
    expect(
      panel.queryByRole("button", { name: "Apply reviewed changes" }),
    ).not.toBeInTheDocument();
    view.rerender(<Calendar {...newProfile} units={batchUnits.slice(1)} />);
    expect(
      panel.queryByRole("list", { name: "Included dates and periods" }),
    ).not.toBeInTheDocument();
  });
  it("keeps saved outcome when calendar refresh fails", async () => {
    const Calendar = await component();
    const user = userEvent.setup();
    loadSpan.mockImplementation(loadBatchCalendar);
    const view = render(<Calendar {...batchProps} />);
    await chooseBatch(user);
    let panel = within(
      screen.getByRole("region", { name: "Change availability" }),
    );
    const navigation = within(
      view.container.querySelector<HTMLElement>(
        ".cottage-calendar-navigation",
      )!,
    );
    await user.click(
      panel.getByRole("checkbox", {
        name: `Replace private block: ${first} · Shift 3: Late`,
      }),
    );
    const oldMonth = deferred<{
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    }>();
    loadSpan.mockReturnValueOnce(oldMonth.promise);
    await user.click(navigation.getByRole("button", { name: "Next month" }));
    const write = deferred<CottageInventoryBatchActionState>();
    saveBatch.mockReturnValueOnce(write.promise);
    const apply = panel.getByRole("button", {
      name: "Apply reviewed changes",
    });
    apply.focus();
    await user.keyboard("{Enter}");
    expect(saveBatch).toHaveBeenCalledTimes(1);
    expect(apply).toHaveAttribute("aria-busy", "true");
    const oldParentRead = deferred<{
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    }>();
    loadSpan.mockReturnValueOnce(oldParentRead.promise);
    view.rerender(<Calendar {...batchProps} refreshKey={1} />);
    const refresh = deferred<{
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    }>();
    loadSpan.mockReturnValueOnce(refresh.promise);
    const request = JSON.parse(
      String((saveBatch.mock.calls[0]![1] as FormData).get("batch")),
    ) as CottageInventoryAvailabilityBatchInput;
    const coordinates = reviewedCells.map(({ serviceDay, id, kind }) => ({
      serviceDay,
      id,
      kind,
    }));
    await act(async () =>
      write.resolve({
        status: "saved",
        receipt: {
          status: "saved",
          profileId: batchProps.profileId,
          scheduleRevisionId: batchProps.scheduleRevisionId,
          request,
          changed: coordinates,
          unchanged: [],
        },
        refresh: { status: "unavailable" },
      }),
    );
    await screen.findByText("Availability changes saved.");
    expect(screen.getByText("Changed: 8")).toBeVisible();
    expect(screen.getByText("Unchanged: 0")).toBeVisible();
    expect(screen.getByText("Refreshing month availability…")).toBeVisible();
    await waitFor(() =>
      expect(
        panel.getByRole("heading", { name: "Change availability" }),
      ).toHaveFocus(),
    );
    await act(async () => {
      oldMonth.resolve({
        status: "loaded",
        calendar: calendar(
          "2028-03-01",
          "2028-03-31",
          "2028-02-01T00:00:00Z",
          batchProps,
        ),
      });
      oldParentRead.resolve({
        status: "loaded",
        calendar: calendar(
          "2028-03-01",
          "2028-03-31",
          "2028-02-01T00:00:00Z",
          batchProps,
        ),
      });
    });
    expect(screen.getByText("Refreshing month availability…")).toBeVisible();
    await act(async () => refresh.reject(new Error("read transport")));
    expect(
      await screen.findByText(
        "Changes were saved, but month availability could not be refreshed. Retry month availability.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Availability changes saved.")).toBeVisible();
    const retry = deferred<{
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    }>();
    loadSpan.mockReturnValueOnce(retry.promise);
    await user.click(
      screen.getByRole("button", { name: "Retry month availability" }),
    );
    expect(saveBatch).toHaveBeenCalledTimes(1);
    await act(async () =>
      retry.resolve({
        status: "loaded",
        calendar: calendar(
          "2028-03-01",
          "2028-03-31",
          "2028-02-01T00:00:00Z",
          batchProps,
        ),
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Refreshing month availability…"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByText(
        "Changes were saved, but month availability could not be refreshed. Retry month availability.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Availability changes saved.")).toBeVisible();
    expect(
      panel.queryByRole("button", { name: "Apply reviewed changes" }),
    ).not.toBeInTheDocument();

    const allOpen = rangeCalendar();
    for (const day of allOpen.days)
      for (const cell of day.units) {
        cell.ownerState = "open";
        cell.calendarState = "open";
        cell.commitmentReference = null;
        cell.editable = true;
        cell.available = true;
      }
    loadSpan.mockResolvedValueOnce({ status: "loaded", calendar: allOpen });
    await user.click(
      panel.getByRole("button", { name: "Review availability changes" }),
    );
    await panel.findByRole("list", { name: "Included dates and periods" });
    saveBatch.mockImplementationOnce(async (_previous, form: FormData) => ({
      status: "saved",
      receipt: {
        status: "saved",
        profileId: batchProps.profileId,
        scheduleRevisionId: batchProps.scheduleRevisionId,
        request: JSON.parse(String(form.get("batch"))),
        changed: [],
        unchanged: coordinates,
      },
      refresh: { status: "required" },
    }));
    await user.click(
      panel.getByRole("button", { name: "Apply reviewed changes" }),
    );
    expect(await screen.findByText("Changed: 0")).toBeVisible();
    expect(screen.getByText("Unchanged: 8")).toBeVisible();
    expect(saveBatch).toHaveBeenCalledTimes(2);
    loadSpan.mockResolvedValueOnce({ status: "loaded", calendar: allOpen });
    await user.click(
      panel.getByRole("button", { name: "Review availability changes" }),
    );
    await panel.findByRole("list", { name: "Included dates and periods" });
    saveBatch.mockRejectedValueOnce(new Error("write transport"));
    const unknownRefresh = deferred<{
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    }>();
    const readsBeforeUnknown = loadSpan.mock.calls.length;
    loadSpan.mockReturnValueOnce(unknownRefresh.promise);
    await user.click(
      panel.getByRole("button", { name: "Apply reviewed changes" }),
    );
    expect(
      await screen.findByText(
        "The result could not be confirmed. Review availability again before submitting.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("No availability changes were saved."),
    ).not.toBeInTheDocument();
    expect(
      panel.queryByRole("button", { name: "Apply reviewed changes" }),
    ).not.toBeInTheDocument();
    expect(saveBatch).toHaveBeenCalledTimes(3);
    await waitFor(() =>
      expect(loadSpan).toHaveBeenCalledTimes(readsBeforeUnknown + 1),
    );
    await act(async () =>
      unknownRefresh.reject(new Error("unknown outcome read transport")),
    );
    expect(
      screen.getByText(
        "The result could not be confirmed. Review availability again before submitting.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("No availability changes were saved."),
    ).not.toBeInTheDocument();
    expect(saveBatch).toHaveBeenCalledTimes(3);

    loadSpan.mockResolvedValueOnce({ status: "loaded", calendar: allOpen });
    await user.click(
      panel.getByRole("button", { name: "Review availability changes" }),
    );
    await panel.findByRole("list", { name: "Included dates and periods" });
    const late = deferred<CottageInventoryBatchActionState>();
    saveBatch.mockReturnValueOnce(late.promise);
    const lateApply = panel.getByRole("button", {
      name: "Apply reviewed changes",
    });
    lateApply.focus();
    await user.keyboard("{Enter}");
    const replacement = {
      ...batchProps,
      profileId: "70000000-0000-4000-8000-000000000002",
    };
    loadSpan.mockResolvedValueOnce({
      status: "loaded",
      calendar: calendar(
        "2028-02-01",
        "2028-02-29",
        "2028-02-01T00:00:00Z",
        replacement,
      ),
    });
    view.rerender(<Calendar {...replacement} />);
    await screen.findByLabelText("From date");
    panel = within(screen.getByRole("region", { name: "Change availability" }));
    await act(async () =>
      late.resolve({
        status: "saved",
        receipt: {
          status: "saved",
          profileId: batchProps.profileId,
          scheduleRevisionId: batchProps.scheduleRevisionId,
          request,
          changed: coordinates,
          unchanged: [],
        },
        refresh: { status: "required" },
      }),
    );
    expect(
      screen.queryByText("Availability changes saved."),
    ).not.toBeInTheDocument();
    expect(
      panel.getByRole("heading", { name: "Change availability" }),
    ).not.toHaveFocus();
    expect(screen.getByLabelText("From date")).toHaveValue("2028-02-01");
    view.rerender(<Calendar {...replacement} editable={false} />);
    expect(
      screen.queryByRole("button", { name: "Review availability changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Monthly availability" }),
    ).toBeVisible();
  });
});
