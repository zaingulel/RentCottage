import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadAdministratorQueue, notFound } = vi.hoisted(() => ({
  loadAdministratorQueue: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/administrator-records/supabase-administrator-records", () => ({
  loadAdministratorQueue,
}));

import AdministratorQueuesPage from "./page";

const notFoundSignal = new Error("NEXT_NOT_FOUND");
const emptyPage = {
  queue: "requests",
  rows: [],
  total: 0,
  stateCounts: {
    pending: 0,
    processing: 0,
    "payment-required": 0,
    "capture-processing": 0,
    declined: 0,
    withdrawn: 0,
    expired: 0,
    cancelled: 0,
  },
  nextCursor: null,
};

function renderPage(
  searchParams: Record<string, string | string[] | undefined> = {},
  locale = "en",
) {
  return AdministratorQueuesPage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(searchParams),
  });
}

describe("AdministratorQueuesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notFound.mockImplementation(() => {
      throw notFoundSignal;
    });
  });

  it.each([
    ["an unknown locale", { locale: "xx", query: {} }],
    ["an unknown key", { locale: "en", query: { sort: "asc" } }],
    ["a repeated value", { locale: "en", query: { state: ["a", "b"] } }],
    ["an unset value", { locale: "en", query: { state: undefined } }],
  ])("answers not found for %s without reading a queue", async (_, input) => {
    await expect(renderPage(input.query, input.locale)).rejects.toBe(
      notFoundSignal,
    );
    expect(loadAdministratorQueue).not.toHaveBeenCalled();
  });

  it("shows the access message and neither navigation nor form when access is required", async () => {
    loadAdministratorQueue.mockResolvedValue({ status: "access_required" });

    const { container } = render(await renderPage({ queue: "refunds" }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Booking queues",
    );
    expect(
      screen.getByText(
        "Administrator access with authenticator verification is required.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Complete administrator access" }),
    ).toHaveAttribute("href", "/en/administrator/access");
    expect(container.querySelector(".access-required-card")).not.toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows only the alert when the queue is unavailable", async () => {
    loadAdministratorQueue.mockResolvedValue({ status: "unavailable" });

    const { container } = render(await renderPage());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Records are temporarily unavailable. Please try again.",
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Booking queues",
    );
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });

  it.each([
    ["ready", { status: "ready", page: emptyPage }],
    ["invalid", { status: "invalid" }],
  ])(
    "shows the navigation with the queues destination current when the outcome is %s",
    async (_, outcome) => {
      loadAdministratorQueue.mockResolvedValue(outcome);

      const { container } = render(await renderPage());

      const navigation = screen.getByRole("navigation", {
        name: "Platform administration",
      });
      expect(container.querySelector("main")?.firstElementChild).toBe(
        navigation,
      );
      expect(
        within(navigation).getByRole("link", { name: "Booking queues" }),
      ).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Booking queues",
      );
      expect(container.querySelectorAll("form")).toHaveLength(2);
    },
  );

  it("hands the raw query to the loader and shows its values back", async () => {
    const query = {
      queue: "bookings",
      state: "cancelled",
      from: "2026-09-20",
      through: "2026-09-21",
      afterAt: "2026-09-21T12:00:00.000Z",
      afterId: "11111111-1111-4111-8111-111111111111",
    };
    loadAdministratorQueue.mockResolvedValue({
      status: "ready",
      page: { ...emptyPage, queue: "bookings", stateCounts: {} },
    });

    render(await renderPage(query));

    expect(loadAdministratorQueue).toHaveBeenCalledWith(query);
    expect(
      screen.getByRole("button", { name: "Confirmed Bookings" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("From date (Baghdad)")).toHaveValue(
      "2026-09-20",
    );
    expect(screen.getByLabelText("Through date (Baghdad)")).toHaveValue(
      "2026-09-21",
    );
  });

  it("falls back to the Booking Requests queue for a queue the address does not name", async () => {
    loadAdministratorQueue.mockResolvedValue({ status: "invalid" });

    render(await renderPage({ queue: "payouts", state: "x" }));

    expect(
      screen.getByRole("button", { name: "Booking Requests" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "These filters are not valid. Check the dates and try again.",
    );
  });

  it.each([
    ["ar", "طوابير الحجوزات"],
    ["ckb", "ڕیزەکانی حجز"],
  ])("shows the %s title", async (locale, title) => {
    loadAdministratorQueue.mockResolvedValue({
      status: "ready",
      page: emptyPage,
    });

    render(await renderPage({}, locale));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
  });
});
