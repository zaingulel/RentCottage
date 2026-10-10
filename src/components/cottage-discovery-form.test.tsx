import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { CottageDiscoveryForm } from "./cottage-discovery-form";

const facets = {
  status: "loaded" as const,
  governorates: ["Erbil"],
  areas: ["Shaqlawa"],
  amenities: ["pool"],
};

const dateLabels = {
  en: { from: "From Service Day", to: "To Service Day" },
  ar: { from: "من تاريخ", to: "إلى تاريخ" },
  ckb: { from: "لە بەرواری", to: "تا بەرواری" },
};

function chooseDates(
  labels: { from: string; to: string },
  from: string,
  to: string,
) {
  fireEvent.change(screen.getByLabelText(labels.from), {
    target: { value: from },
  });
  fireEvent.change(screen.getByLabelText(labels.to), { target: { value: to } });
}

describe("CottageDiscoveryForm booking period picker", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("Sorani discovery distinguishes an approximate area and a full-day bundle", () => {
    render(<CottageDiscoveryForm locale="ckb" facets={facets} />);
    fireEvent.click(
      screen.getByText(
        /Booking Period filters|مرشحات فترة الحجز|پاڵاوتەکانی ماوەی حجز/,
      ),
    );
    expect(
      screen.getByText("پاڵاوتەکانی ماوەی حجز (ئارەزوومەندانە)"),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", {
        name: "ناوچەی نزیکەیی (ئارەزوومەندانە)",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "پاکێجی ڕۆژی تەواو" }),
    ).toBeVisible();

    chooseDates(dateLabels.ckb, "2099-01-01", "2099-01-01");

    expect(screen.getByRole("button", { name: "ڕۆژی تەواو" })).toBeVisible();
  });

  it("shows default chips with the helper before a valid range exists", async () => {
    const user = userEvent.setup();
    render(<CottageDiscoveryForm locale="en" facets={facets} />);
    fireEvent.click(
      screen.getByText(
        /Booking Period filters|مرشحات فترة الحجز|پاڵاوتەکانی ماوەی حجز/,
      ),
    );
    const picker = screen.getByRole("group", {
      name: "Booking Period for each Service Day",
    });
    expect(
      within(picker).getByText(
        "Applies to every Service Day. Choose your dates to set them day by day.",
      ),
    ).toBeVisible();
    const fullDay = within(picker).getByRole("button", {
      name: "Full-day bundle",
    });
    expect(fullDay).toHaveAttribute("aria-pressed", "false");
    await user.click(within(picker).getByRole("button", { name: "Shift 1" }));
    await user.click(fullDay);
    expect(fullDay).toHaveAttribute("aria-pressed", "true");
    expect(
      within(picker).getByRole("button", { name: "Shift 1" }),
    ).toHaveAttribute("aria-pressed", "false");
    await user.click(within(picker).getByRole("button", { name: "Shift 2" }));
    expect(fullDay).toHaveAttribute("aria-pressed", "false");
    chooseDates(dateLabels.en, "2099-01-02", "2099-01-01");
    expect(screen.queryByRole("group", { name: "Fri, Jan 2" })).toBeNull();
    expect(
      within(picker).getByRole("button", { name: "Shift 2" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("applies the default set to every Service Day and submits it materialised", async () => {
    const user = userEvent.setup();
    render(<CottageDiscoveryForm locale="en" facets={facets} />);
    fireEvent.click(
      screen.getByText(
        /Booking Period filters|مرشحات فترة الحجز|پاڵاوتەکانی ماوەی حجز/,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Shift 1" }));
    await user.click(screen.getByRole("button", { name: "Shift 3" }));
    chooseDates(dateLabels.en, "2099-01-01", "2099-01-03");
    expect(screen.queryByText(/Applies to every Service Day/)).toBeNull();
    for (const day of ["Thu, Jan 1", "Fri, Jan 2", "Sat, Jan 3"]) {
      const row = screen.getByRole("group", { name: day });
      expect(
        within(row).getByRole("button", { name: "Shift 1" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        within(row).getByRole("button", { name: "Shift 2" }),
      ).toHaveAttribute("aria-pressed", "false");
      expect(
        within(row).getByRole("button", { name: "Full day" }),
      ).toHaveAttribute("aria-pressed", "false");
    }
    await user.click(
      screen.getByRole("button", { name: "Search available cottages" }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(push).toHaveBeenCalledWith(
      "/en/results?" +
        new URLSearchParams([
          ["from", "2099-01-01"],
          ["to", "2099-01-03"],
          ["selection", "2099-01-01:shift:1"],
          ["selection", "2099-01-01:shift:3"],
          ["selection", "2099-01-02:shift:1"],
          ["selection", "2099-01-02:shift:3"],
          ["selection", "2099-01-03:shift:1"],
          ["selection", "2099-01-03:shift:3"],
          ["guests", "4"],
        ]).toString(),
    );
  });

  it("lets a touched day stop following the defaults while the others keep them", async () => {
    const user = userEvent.setup();
    render(<CottageDiscoveryForm locale="en" facets={facets} />);
    fireEvent.click(
      screen.getByText(
        /Booking Period filters|مرشحات فترة الحجز|پاڵاوتەکانی ماوەی حجز/,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Shift 2" }));
    chooseDates(dateLabels.en, "2099-01-01", "2099-01-02");
    const first = screen.getByRole("group", { name: "Thu, Jan 1" });
    await user.click(within(first).getByRole("button", { name: "Full day" }));
    expect(
      within(first).getByRole("button", { name: "Shift 2" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(screen.getByRole("group", { name: "Fri, Jan 2" })).getByRole(
        "button",
        { name: "Shift 2" },
      ),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(
      screen.getByRole("button", { name: "Search available cottages" }),
    );
    expect(push).toHaveBeenCalledWith(
      "/en/results?" +
        new URLSearchParams([
          ["from", "2099-01-01"],
          ["to", "2099-01-02"],
          ["selection", "2099-01-01:full-day"],
          ["selection", "2099-01-02:shift:2"],
          ["guests", "4"],
        ]).toString(),
    );
  });

  it("submits dates alone and optional partial-day filters without choosing a Booking Period", async () => {
    const user = userEvent.setup();
    render(<CottageDiscoveryForm locale="en" facets={facets} />);
    chooseDates(dateLabels.en, "2099-01-01", "2099-01-02");
    await user.click(
      screen.getByRole("button", { name: "Search available cottages" }),
    );
    expect(push).toHaveBeenLastCalledWith(
      "/en/results?from=2099-01-01&to=2099-01-02&guests=4",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByText("Booking Period filters (optional)"));
    await user.click(
      within(screen.getByRole("group", { name: "Thu, Jan 1" })).getByRole(
        "button",
        { name: "Shift 1" },
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "Search available cottages" }),
    );
    expect(push).toHaveBeenLastCalledWith(
      "/en/results?from=2099-01-01&to=2099-01-02&selection=2099-01-01%3Ashift%3A1&guests=4",
    );
  });

  it("labels Service Days in the active locale", () => {
    render(<CottageDiscoveryForm locale="ar" facets={facets} />);
    fireEvent.click(
      screen.getByText(
        /Booking Period filters|مرشحات فترة الحجز|پاڵاوتەکانی ماوەی حجز/,
      ),
    );
    chooseDates(dateLabels.ar, "2099-01-01", "2099-01-01");
    expect(
      screen.getByRole("group", { name: "الخميس، 1 كانون الثاني" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "يوم كامل" })).toBeVisible();
  });
  it.each([
    ["en", "Search available cottages"],
    ["ar", "ابحث عن البيوت المتاحة"],
    ["ckb", "گەڕان بۆ کۆتێجی بەردەست"],
  ] as const)("submits a day-only search in %s", async (locale, submit) => {
    const user = userEvent.setup();
    render(<CottageDiscoveryForm locale={locale} facets={facets} />);
    chooseDates(dateLabels[locale], "2099-01-01", "2099-01-02");
    await user.click(screen.getByRole("button", { name: submit }));
    expect(push).toHaveBeenCalledWith(
      `/${locale}/results?from=2099-01-01&to=2099-01-02&guests=4`,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rejects an oversized date range through the query parser before navigation", async () => {
    const user = userEvent.setup();
    render(<CottageDiscoveryForm locale="en" facets={facets} />);
    const submitButton = screen.getByRole("button", {
      name: "Search available cottages",
    });
    chooseDates(dateLabels.en, "2099-01-01", "2099-02-01");
    await user.click(submitButton);
    expect(
      screen.getByText(
        "Check your dates and guest count. Choose a range of at most 31 days.",
      ),
    ).toHaveAttribute("role", "alert");
    expect(push).not.toHaveBeenCalled();
  });

  it.each(["en", "ar", "ckb"] as const)(
    "renders its fields, filters and amenities through the shared controls in %s",
    (locale) => {
      const { container } = render(
        <CottageDiscoveryForm locale={locale} facets={facets} />,
      );
      expect(container.querySelectorAll('input[type="date"]')).toHaveLength(2);
      expect(container.querySelectorAll('input[type="number"]')).toHaveLength(
        1,
      );
      expect(container.querySelectorAll("select")).toHaveLength(2);
      const fields = container.querySelectorAll(
        'input[type="date"], input[type="number"], select',
      );
      expect(fields).toHaveLength(5);
      for (const field of fields) expect(field).toHaveClass("form-control");
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes).toHaveLength(1);
      expect(
        checkboxes[0].closest(
          "fieldset.option-group-wrap label.choice-control",
        ),
      ).not.toBeNull();
      expect(
        container.querySelectorAll("details.disclosure > summary"),
      ).toHaveLength(1);
    },
  );
});
