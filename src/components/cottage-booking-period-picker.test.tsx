import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseCottageDiscoveryQuery,
  type CottageDiscoveryQuery,
} from "@/cottage-discovery/discovery-query";
import type { PublicCottageInventoryUnit } from "@/cottage-discovery/supabase-cottage-discovery";
import { CottageBookingPeriodPicker } from "./cottage-booking-period-picker";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const query: CottageDiscoveryQuery = {
  from: "2030-01-12",
  to: "2030-01-13",
  guests: 4,
  selections: [],
  governorate: "Erbil",
  area: "Shaqlawa",
  amenities: ["pool", "wifi"],
};
const inventory: PublicCottageInventoryUnit[] = [
  {
    serviceDay: "2030-01-12",
    kind: "shift",
    position: 1,
    name: "Morning",
    startTime: "08:00",
    endTime: "14:00",
    priceIqd: 60000,
    available: true,
  },
  {
    serviceDay: "2030-01-12",
    kind: "shift",
    position: 2,
    name: "Evening",
    startTime: "18:00",
    endTime: "23:00",
    priceIqd: 80000,
    available: false,
  },
  {
    serviceDay: "2030-01-12",
    kind: "full-day",
    name: "Full day",
    startTime: "08:00",
    endTime: "23:00",
    priceIqd: 110000,
    available: false,
  },
  {
    serviceDay: "2030-01-13",
    kind: "shift",
    position: 1,
    name: "Morning",
    startTime: "08:00",
    endTime: "14:00",
    priceIqd: 65000,
    available: true,
  },
  {
    serviceDay: "2030-01-13",
    kind: "shift",
    position: 2,
    name: "Evening",
    startTime: "18:00",
    endTime: "23:00",
    priceIqd: 90000,
    available: true,
  },
  {
    serviceDay: "2030-01-13",
    kind: "full-day",
    name: "Full day",
    startTime: "08:00",
    endTime: "23:00",
    priceIqd: 120000,
    available: true,
  },
];

// The router boundary supplies the next server query after navigation.
function ProfileNavigation({
  initialQuery = query,
  units = inventory,
}: {
  initialQuery?: CottageDiscoveryQuery;
  units?: PublicCottageInventoryUnit[];
}) {
  const [current, setCurrent] = useState(initialQuery);
  replace.mockImplementation((href: string) => {
    const params = new URL(href, "https://example.test").searchParams;
    const parsed = parseCottageDiscoveryQuery({
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      guests: params.get("guests") ?? undefined,
      selection: params.getAll("selection"),
      governorate: params.get("governorate") ?? undefined,
      area: params.get("area") ?? undefined,
      amenity: params.getAll("amenity"),
    });
    if (parsed.status !== "loaded")
      throw new Error("Navigation lost the accepted query");
    setCurrent(parsed.query);
  });
  return (
    <CottageBookingPeriodPicker
      locale="en"
      slug="garden-house"
      query={current}
      inventory={units}
    />
  );
}

const suffix =
  "&guests=4&governorate=Erbil&area=Shaqlawa&amenity=pool&amenity=wifi";

describe("CottageBookingPeriodPicker", () => {
  beforeEach(() => {
    replace.mockReset();
  });

  it("marks cross-midnight and 24-hour Full-day endings in every locale", () => {
    const cases = [
      [inventory[0], "08:00–14:00", false],
      [
        { ...inventory[0], startTime: "17:00", endTime: "02:00" },
        "17:00–02:00",
        true,
      ],
      [inventory[2], "08:00–23:00", false],
      [
        { ...inventory[2], startTime: "09:00", endTime: "02:00" },
        "09:00–02:00",
        true,
      ],
      [
        { ...inventory[2], startTime: "09:00", endTime: "09:00" },
        "09:00–09:00",
        true,
      ],
      [
        { ...inventory[0], startTime: "09:00", endTime: "09:00" },
        "09:00–09:00",
        false,
      ],
    ] as const;
    for (const [locale, nextDay] of [
      ["en", "next day"],
      ["ar", "اليوم التالي"],
      ["ckb", "ڕۆژی دواتر"],
    ] as const) {
      for (const [unit, clock, endsNextDay] of cases) {
        const { unmount } = render(
          <CottageBookingPeriodPicker
            locale={locale}
            slug="garden-house"
            query={query}
            inventory={[unit]}
          />,
        );
        const row = screen.getByRole("listitem");
        const times = within(row).getByText(clock);
        expect(times).toBeVisible();
        expect(times.tagName).toBe("BDI");
        expect(times).toHaveAttribute("dir", "ltr");
        expect(times.textContent).toBe(clock);
        if (endsNextDay) {
          expect(row).toHaveTextContent(`${clock} ${nextDay}`);
        } else {
          expect(row).not.toHaveTextContent(nextDay);
        }
        unmount();
      }
    }
  });

  it("keeps no selection until the customer chooses every Service Day", async () => {
    const user = userEvent.setup();
    render(<ProfileNavigation />);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Get exact quote" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Message this cottage" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Choose at least one available option for every Service Day.",
      ),
    ).toBeVisible();
    const first = screen.getByRole("group", { name: "Sat, Jan 12" });
    const second = screen.getByRole("group", { name: "Sun, Jan 13" });
    await user.click(within(first).getByRole("button", { name: "Morning" }));
    expect(
      within(first).getByRole("button", { name: "Morning" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Get exact quote" }),
    ).toBeDisabled();
    await user.click(within(second).getByRole("button", { name: "Morning" }));
    expect(
      within(second).getByRole("button", { name: "Morning" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("link", { name: "Get exact quote" }),
    ).toHaveAttribute(
      "href",
      "/en/request/garden-house?from=2030-01-12&to=2030-01-13&selection=2030-01-12%3Ashift%3A1&selection=2030-01-13%3Ashift%3A1" +
        suffix,
    );
    expect(
      screen.getByRole("link", { name: "Message this cottage" }),
    ).toHaveAttribute(
      "href",
      "/en/messages?cottage=garden-house&from=2030-01-12&to=2030-01-13&selection=2030-01-12%3Ashift%3A1&selection=2030-01-13%3Ashift%3A1" +
        suffix,
    );
  });
  it("replaces only same-day alternatives and preserves the query", async () => {
    const user = userEvent.setup();
    render(
      <ProfileNavigation
        initialQuery={{
          ...query,
          selections: [
            { serviceDay: "2030-01-12", kind: "shift", position: 1 },
            { serviceDay: "2030-01-13", kind: "shift", position: 1 },
          ],
        }}
      />,
    );
    const day = screen.getByRole("group", { name: "Sun, Jan 13" });
    await user.click(
      within(day).getByRole("button", { name: "Full-day bundle" }),
    );
    expect(replace).toHaveBeenLastCalledWith(
      "/en/cottages/garden-house?from=2030-01-12&to=2030-01-13&selection=2030-01-12%3Ashift%3A1&selection=2030-01-13%3Afull-day" +
        suffix,
      { scroll: false },
    );
    expect(
      within(day).getByRole("button", { name: "Morning" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(day).getByRole("button", { name: "Full-day bundle" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(within(day).getByRole("button", { name: "Evening" }));
    expect(replace).toHaveBeenLastCalledWith(
      "/en/cottages/garden-house?from=2030-01-12&to=2030-01-13&selection=2030-01-12%3Ashift%3A1&selection=2030-01-13%3Ashift%3A2" +
        suffix,
      { scroll: false },
    );
    expect(
      within(day).getByRole("button", { name: "Full-day bundle" }),
    ).toHaveAttribute("aria-pressed", "false");
    await user.click(within(day).getByRole("button", { name: "Morning" }));
    expect(replace).toHaveBeenLastCalledWith(
      "/en/cottages/garden-house?from=2030-01-12&to=2030-01-13&selection=2030-01-12%3Ashift%3A1&selection=2030-01-13%3Ashift%3A1&selection=2030-01-13%3Ashift%3A2" +
        suffix,
      { scroll: false },
    );
    await user.click(within(day).getByRole("button", { name: "Evening" }));
    expect(
      within(day).getByRole("button", { name: "Morning" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(day).getByRole("button", { name: "Evening" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(screen.getByRole("group", { name: "Sat, Jan 12" })).getByRole(
        "button",
        { name: "Morning" },
      ),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("lets the customer remove unavailable or missing selected periods", async () => {
    const user = userEvent.setup();
    render(
      <ProfileNavigation
        initialQuery={{
          ...query,
          selections: [
            { serviceDay: "2030-01-12", kind: "shift", position: 2 },
            { serviceDay: "2030-01-13", kind: "shift", position: 3 },
          ],
        }}
      />,
    );
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A selected option is no longer available. Remove it and choose again.",
    );
    expect(
      screen.getByText(
        "A selected period is no longer offered. Clear that day's selection and choose again.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Get exact quote" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Message this cottage" }),
    ).toBeVisible();
    const first = screen.getByRole("group", { name: "Sat, Jan 12" });
    const second = screen.getByRole("group", { name: "Sun, Jan 13" });
    expect(
      within(first).getByRole("button", { name: "Evening" }),
    ).toBeEnabled();
    expect(
      within(first).getByRole("button", { name: "Full-day bundle" }),
    ).toBeDisabled();
    await user.click(
      within(first).getByRole("button", { name: "Full-day bundle" }),
    );
    expect(replace).not.toHaveBeenCalled();
    await user.click(within(first).getByRole("button", { name: "Evening" }));
    expect(
      within(first).getByRole("button", { name: "Evening" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(first).getByRole("button", { name: "Morning" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Message this cottage" }),
    ).toBeDisabled();
    await user.click(
      within(second).getByRole("button", { name: "Clear selection" }),
    );
    expect(replace).toHaveBeenLastCalledWith(
      "/en/cottages/garden-house?from=2030-01-12&to=2030-01-13" + suffix,
      { scroll: false },
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByText(
        "A selected period is no longer offered. Clear that day's selection and choose again.",
      ),
    ).toBeNull();
    for (const button of screen.getAllByRole("button", { pressed: false }))
      expect(button).toHaveAttribute("aria-pressed", "false");
  });
});
