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
  CottageInventoryOwnerCalendarSpanUnit,
} from "@/cottage-inventory/cottage-inventory";
import { cottagePricingAvailabilityMessages } from "@/i18n/cottage-pricing-availability-messages";

const { loadSpan } = vi.hoisted(() => ({ loadSpan: vi.fn() }));
vi.mock("@/cottage-inventory/actions", () => ({
  loadCottageInventoryCalendarSpanAction: loadSpan,
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
    unitKeys: units.map(({ id, kind }) => ({ id, kind })),
    days: dates.map((serviceDay, index) => ({
      serviceDay,
      units: units.map(({ id, kind }, unitIndex) => {
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

describe("Cottage Availability Calendar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2028-02-01T00:00:00Z"));
    loadSpan.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("renders every month state in each launch language without daily loading", async () => {
    const Calendar = await component();
    for (const locale of ["en", "ar", "ckb"] as const) {
      loadSpan.mockResolvedValue({ status: "loaded", calendar: calendar() });
      const view = render(<Calendar {...props} locale={locale} />);
      const copy = cottagePricingAvailabilityMessages[locale];
      await screen.findByText("2028-02-29", { selector: "time" });
      const days = screen.getAllByRole("list", { name: /^2028-02-/ });
      expect(days).toHaveLength(29);
      expect(days.map((day) => day.getAttribute("aria-label"))).toEqual(
        february,
      );
      for (const day of days)
        expect(within(day).getAllByRole("listitem")).toHaveLength(4);
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
      for (const [day, expected] of [
        [
          days[0]!,
          [copy.closed, copy.open, copy.privateBlocked, copy.pendingHold],
        ],
        [
          days[1]!,
          [
            copy.confirmedBooking,
            copy.componentUnavailable,
            copy.calendarTemporary,
            copy.closed,
          ],
        ],
      ] as const) {
        const cells = within(day).getAllByRole("listitem");
        expected.forEach((label, index) =>
          expect(
            within(cells[index]!).getByText(label as string),
          ).toBeVisible(),
        );
      }
      const temporary = within(days[1]!).getAllByRole("listitem")[2]!;
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
      expect(loadSpan).toHaveBeenCalledTimes(1);
      const form = loadSpan.mock.calls[0]![1] as FormData;
      expect(Object.fromEntries(form)).toEqual({
        profileId: "profile",
        scheduleRevisionId: "revision",
        from: "2028-02-01",
        to: "2028-02-29",
      });
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
    await screen.findByText("2028-02-29", { selector: "time" });
    expect(
      screen.getByRole("button", { name: "Previous month" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await screen.findByText("2028-03-31", { selector: "time" });
    const previous = screen.getByRole("button", { name: "Previous month" });
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
    fireEvent.change(screen.getByLabelText("Show month containing date"), {
      target: { value: "2028-12-17" },
    });
    await screen.findByText("2028-12-31", { selector: "time" });
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await screen.findByText("2029-01-31", { selector: "time" });
    await user.click(screen.getByRole("button", { name: "Previous month" }));
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
    await screen.findByText("2028-03-31", { selector: "time" });
    expect(
      screen.queryByText("2028-02-29", { selector: "time" }),
    ).not.toBeInTheDocument();
    expect(loadSpan).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Show month containing date")).toHaveAttribute(
      "min",
      "2028-03-01",
    );
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
      screen.getByRole("button", { name: "Previous month" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Show month containing date"), {
      target: { value: "2028-01-15" },
    });
    expect(screen.getByLabelText("Show month containing date")).toHaveValue(
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
    await waitFor(() => expect(loadSpan).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await screen.findByText("2028-03-31", { selector: "time" });
    await act(async () =>
      first.resolve({ status: "loaded", calendar: calendar() }),
    );
    expect(screen.getByText("2028-03-31", { selector: "time" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Show month containing date"), {
      target: { value: "2028-05-16" },
    });
    await screen.findByText("2028-05-31", { selector: "time" });
    expect(screen.getByLabelText("Show month containing date")).toHaveValue(
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
    fireEvent.change(screen.getByLabelText("Show month containing date"), {
      target: { value: "2028-03-15" },
    });
    await screen.findByText("2028-04-30", { selector: "time" });
    expect(screen.getByLabelText("Show month containing date")).toHaveAttribute(
      "min",
      "2028-04-01",
    );
    viewForLast.unmount();
    loadSpan.mockReset();

    vi.setSystemTime(new Date("2028-04-01T00:00:00Z"));
    const hint = deferred<{
      status: "loaded";
      calendar: CottageInventoryOwnerCalendarSpan;
    }>();
    loadSpan.mockReturnValueOnce(hint.promise);
    render(<Calendar {...props} />);
    await waitFor(() => expect(loadSpan).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Show month containing date"), {
      target: { value: "2028-04-16" },
    });
    await act(async () =>
      hint.resolve({
        status: "loaded",
        calendar: calendar("2028-04-01", "2028-04-30", "2028-02-15T09:00:00Z"),
      }),
    );
    await screen.findByText("2028-04-30", { selector: "time" });
    expect(screen.getByLabelText("Show month containing date")).toHaveValue(
      "2028-04-16",
    );
    expect(screen.getByLabelText("Show month containing date")).toHaveAttribute(
      "min",
      "2028-02-01",
    );
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
    await waitFor(() => expect(loadSpan).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading month availability",
    );
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Next month" }));
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
    expect(screen.getByLabelText("Show month containing date")).toHaveAttribute(
      "min",
      "2028-02-01",
    );
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
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await screen.findByText("2028-03-31", { selector: "time" });
    loadSpan
      .mockReturnValueOnce(stalePrevious.promise)
      .mockReturnValueOnce(finalPrevious.promise);
    const previous = screen.getByRole("button", { name: "Previous month" });
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
    render(<Calendar {...props} />);
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
    expect(screen.getByLabelText("Show month containing date")).toHaveFocus();
    await act(async () =>
      cancelled.resolve({ status: "loaded", calendar: calendar() }),
    );
    await screen.findByText("2028-02-29", { selector: "time" });
    expect(screen.getByLabelText("Show month containing date")).toHaveFocus();
  });
});
