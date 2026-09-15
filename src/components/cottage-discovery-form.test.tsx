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
  beforeEach(() => push.mockClear());

  it("shows default chips with the helper before a valid range exists", async () => {
    const user = userEvent.setup();
    render(<CottageDiscoveryForm locale="en" facets={facets} />);
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

  it("still blocks submission while any Service Day has an empty effective set", async () => {
    const user = userEvent.setup();
    render(<CottageDiscoveryForm locale="en" facets={facets} />);
    chooseDates(dateLabels.en, "2099-01-01", "2099-01-02");
    await user.click(
      within(screen.getByRole("group", { name: "Thu, Jan 1" })).getByRole(
        "button",
        { name: "Shift 1" },
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "Search available cottages" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose at least one shift for every Service Day.",
    );
    expect(push).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("group", { name: "Fri, Jan 2" })).getByRole(
        "button",
        { name: "Shift 1" },
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("labels Service Days in the active locale", () => {
    render(<CottageDiscoveryForm locale="ar" facets={facets} />);
    chooseDates(dateLabels.ar, "2099-01-01", "2099-01-01");
    expect(
      screen.getByRole("group", { name: "الخميس، 1 كانون الثاني" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "يوم كامل" })).toBeVisible();
  });
});
