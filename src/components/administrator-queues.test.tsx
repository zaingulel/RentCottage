import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  AdministratorQueue,
  AdministratorQueuePage,
  AdministratorQueueRow,
} from "@/administrator-records/administrator-records";

import { AdministratorQueues } from "./administrator-queues";

const reference = "RC-REQ-0123456789ABCDEF";
const rowId = "11111111-1111-4111-8111-111111111111";

const states: Record<AdministratorQueue, string[]> = {
  requests: [
    "pending",
    "processing",
    "payment-required",
    "capture-processing",
    "declined",
    "withdrawn",
    "expired",
    "cancelled",
  ],
  bookings: [
    "confirmed",
    "incident_pending",
    "completed",
    "no_show",
    "cancelled",
  ],
  refunds: ["requested", "processing", "succeeded", "failed", "unknown"],
  incidents: ["incident_pending", "completed", "no_show", "cancelled"],
};

function row(patch: Partial<AdministratorQueueRow>): AdministratorQueueRow {
  return {
    id: rowId,
    at: "2026-09-21T12:30:00.000Z",
    reference,
    state: "pending",
    source: null,
    category: null,
    ...patch,
  };
}

function page(
  queue: AdministratorQueue,
  rows: AdministratorQueueRow[],
  patch: Partial<AdministratorQueuePage> = {},
): AdministratorQueuePage {
  return {
    queue,
    rows,
    total: rows.length,
    stateCounts: Object.fromEntries(states[queue].map((state) => [state, 0])),
    nextCursor: null,
    ...patch,
  };
}

const noFilters = { state: "", from: "", through: "" };

describe("AdministratorQueues", () => {
  const cases = {
    requests: {
      row: row({ state: "payment-required" }),
      en: { queue: "Booking Requests", labels: ["Payment Required"] },
      ar: { queue: "طلبات الحجز", labels: ["الدفع مطلوب"] },
      ckb: { queue: "داواکارییەکانی حجز", labels: ["پارەدان پێویستە"] },
    },
    bookings: {
      row: row({ state: "cancelled" }),
      en: { queue: "Confirmed Bookings", labels: ["Cancelled booking"] },
      ar: { queue: "الحجوزات المؤكدة", labels: ["حجز ملغى"] },
      ckb: { queue: "حجزە پشتڕاستکراوەکان", labels: ["حجزی هەڵوەشاوە"] },
    },
    refunds: {
      row: row({ state: "succeeded", source: "administrator" }),
      en: { queue: "Refunds", labels: ["Returned", "Refund approved"] },
      ar: {
        queue: "الاستردادات",
        labels: ["تم رد المبلغ", "استرداد معتمد"],
      },
      ckb: {
        queue: "گەڕاندنەوەکانی پارە",
        labels: ["پارەکە گەڕێندرایەوە", "گەڕاندنەوەی پارە پەسەند کرا"],
      },
    },
    incidents: {
      row: row({
        state: "no_show",
        source: "lifecycle",
        category: "property_damage",
      }),
      en: {
        queue: "Booking incidents",
        labels: ["No-show", "Booking incident", "Property damage"],
      },
      ar: {
        queue: "وقائع الحجز",
        labels: ["عدم الحضور", "واقعة حجز", "أضرار بالممتلكات"],
      },
      ckb: {
        queue: "ڕووداوەکانی حجز",
        labels: ["ئامادەنەبوون", "ڕووداوی حجز", "زیانی موڵک"],
      },
    },
  } as const;

  it.each(
    (["requests", "bookings", "refunds", "incidents"] as const).flatMap(
      (queue) =>
        (["en", "ar", "ckb"] as const).map(
          (locale) => [queue, locale] as const,
        ),
    ),
  )("shows a %s row in %s with its record link and labels", (queue, locale) => {
    const { container } = render(
      <AdministratorQueues
        locale={locale}
        filters={{ queue, ...noFilters }}
        outcome={{ status: "ready", page: page(queue, [cases[queue].row]) }}
      />,
    );

    const item = screen.getByRole("listitem");
    const link = within(item).getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      `/${locale}/administrator/payments/${reference}`,
    );
    expect(link).toHaveClass("list-row-title");
    expect(link.querySelector("bdi")).toHaveTextContent(reference);
    const meta = item.querySelector(".list-row-meta");
    expect(meta?.querySelector(".status-badge")).toHaveTextContent(
      cases[queue][locale].labels[0],
    );
    expect(meta?.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-09-21T12:30:00.000Z",
    );
    for (const label of cases[queue][locale].labels.slice(1))
      expect(meta).toHaveTextContent(label);
    expect(
      screen.getByRole("button", { name: cases[queue][locale].queue }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll("[aria-pressed=true]")).toHaveLength(1);
  });

  it("labels refund sources and cancellation incidents from their own tables", () => {
    const { rerender } = render(
      <AdministratorQueues
        locale="en"
        filters={{ queue: "refunds", ...noFilters }}
        outcome={{
          status: "ready",
          page: page("refunds", [
            row({ state: "failed", source: "dispute" }),
            row({
              id: "22222222-2222-4222-8222-222222222222",
              state: "unknown",
              source: "cancellation",
            }),
          ]),
        }}
      />,
    );
    const meta = () =>
      screen
        .getAllByRole("listitem")
        .map((item) => item.querySelector(".list-row-meta")?.textContent);
    expect(meta()[0]).toContain(
      "Failed: no funds returned under this approval",
    );
    expect(meta()[0]).toContain("Dispute refund award");
    expect(meta()[1]).toContain("Needs attention: checking the refund");
    expect(meta()[1]).toContain("Cancellation refund requested");

    rerender(
      <AdministratorQueues
        locale="en"
        filters={{ queue: "incidents", ...noFilters }}
        outcome={{
          status: "ready",
          page: page("incidents", [
            row({
              state: "cancelled",
              source: "cancellation",
              category: "serious_operational",
            }),
            row({
              id: "33333333-3333-4333-8333-333333333333",
              state: "incident_pending",
              source: "cancellation",
              category: null,
            }),
          ]),
        }}
      />,
    );
    expect(meta()[0]).toContain("Cancelled booking");
    expect(meta()[0]).toContain("Cancellation incident");
    expect(meta()[0]).toContain("Serious operational issue");
    expect(meta()[1]).toContain("Incident pending");
    expect(meta()[1]).toContain("Cancellation incident");
    expect(meta()[1]).not.toContain("Serious operational issue");
  });

  it("presses only the current queue's toggle and submits the queue by name", () => {
    render(
      <AdministratorQueues
        locale="en"
        filters={{ queue: "refunds", ...noFilters }}
        outcome={{ status: "ready", page: page("refunds", []) }}
      />,
    );
    const toggles = within(
      screen.getByRole("group", { name: "Queue" }),
    ).getAllByRole("button");
    expect(toggles.map((toggle) => toggle.textContent)).toEqual([
      "Booking Requests",
      "Confirmed Bookings",
      "Refunds",
      "Booking incidents",
    ]);
    expect(toggles.map((toggle) => toggle.getAttribute("value"))).toEqual([
      "requests",
      "bookings",
      "refunds",
      "incidents",
    ]);
    expect(toggles.map((toggle) => toggle.getAttribute("name"))).toEqual([
      "queue",
      "queue",
      "queue",
      "queue",
    ]);
    expect(
      toggles.map((toggle) => toggle.getAttribute("aria-pressed")),
    ).toEqual(["false", "false", "true", "false"]);
  });

  it("carries the date window across queues and never the state", () => {
    const { container, rerender } = render(
      <AdministratorQueues
        locale="en"
        filters={{
          queue: "bookings",
          state: "cancelled",
          from: "2026-09-20",
          through: "",
        }}
        outcome={{ status: "ready", page: page("bookings", []) }}
      />,
    );
    const switchForm = () =>
      screen.getByRole("group", { name: "Queue" }).closest("form")!;
    expect(switchForm().querySelectorAll("input[type=hidden]")).toHaveLength(1);
    expect(switchForm().querySelector("input[name=from]")).toHaveAttribute(
      "value",
      "2026-09-20",
    );
    expect(switchForm().querySelector("input[name=state]")).toBeNull();
    expect(switchForm()).toHaveAttribute("action", "/en/administrator/queues");

    rerender(
      <AdministratorQueues
        locale="en"
        filters={{
          queue: "bookings",
          state: "",
          from: "",
          through: "2026-09-21",
        }}
        outcome={{ status: "ready", page: page("bookings", []) }}
      />,
    );
    expect(switchForm().querySelector("input[name=from]")).toBeNull();
    expect(switchForm().querySelector("input[name=through]")).toHaveAttribute(
      "value",
      "2026-09-21",
    );
    expect(container.querySelectorAll("input[name=queue]")).toHaveLength(1);
  });

  it("offers every state of the queue with its count, and the filter values back", () => {
    render(
      <AdministratorQueues
        locale="en"
        filters={{
          queue: "incidents",
          state: "no_show",
          from: "2026-09-20",
          through: "2026-09-21",
        }}
        outcome={{
          status: "ready",
          page: page(
            "incidents",
            [row({ state: "no_show", source: "lifecycle" })],
            {
              total: 1239,
              stateCounts: {
                incident_pending: 1,
                completed: 1234,
                no_show: 3,
                cancelled: 0,
              },
            },
          ),
        }}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Status" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => [option.getAttribute("value"), option.textContent]),
    ).toEqual([
      ["", "All statuses"],
      ["incident_pending", "Incident pending (1)"],
      ["completed", "Completed booking (1,234)"],
      ["no_show", "No-show (3)"],
      ["cancelled", "Cancelled booking (0)"],
    ]);
    expect(select).toHaveValue("no_show");
    expect(screen.getByLabelText("From date (Baghdad)")).toHaveValue(
      "2026-09-20",
    );
    expect(screen.getByLabelText("Through date (Baghdad)")).toHaveValue(
      "2026-09-21",
    );
    expect(
      screen.getByText("Matching records:").closest("p"),
    ).toHaveTextContent("Matching records: 1,239");
    expect(
      screen.getByRole("button", { name: "Apply filters" }),
    ).toHaveAttribute("type", "submit");
    expect(screen.getByRole("link", { name: "Reset filters" })).toHaveAttribute(
      "href",
      "/en/administrator/queues?queue=incidents",
    );
  });

  it("clears the filter controls when the applied filters are reset", () => {
    const outcome = {
      status: "ready" as const,
      page: page("requests", [row({ state: "cancelled" })]),
    };
    const { rerender } = render(
      <AdministratorQueues
        locale="en"
        filters={{
          queue: "requests",
          state: "cancelled",
          from: "2026-09-20",
          through: "2026-09-21",
        }}
        outcome={outcome}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue(
      "cancelled",
    );

    rerender(
      <AdministratorQueues
        locale="en"
        filters={{ queue: "requests", ...noFilters }}
        outcome={outcome}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("");
    expect(screen.getByLabelText("From date (Baghdad)")).toHaveValue("");
    expect(screen.getByLabelText("Through date (Baghdad)")).toHaveValue("");
  });

  it("writes counts with the locale's number format", () => {
    render(
      <AdministratorQueues
        locale="ar"
        filters={{ queue: "refunds", ...noFilters }}
        outcome={{
          status: "ready",
          page: page("refunds", [], {
            stateCounts: {
              requested: 3,
              processing: 0,
              succeeded: 0,
              failed: 0,
              unknown: 0,
            },
          }),
        }}
      />,
    );
    expect(
      screen.getByRole("option", { name: "تم الطلب (3)" }),
    ).toHaveAttribute("value", "requested");
  });

  it("links to the next page with the set filters and the cursor", () => {
    const cursor = {
      at: "2026-09-21T12:00:00.123456+00:00",
      id: "44444444-4444-4444-8444-444444444444",
    };
    const { rerender } = render(
      <AdministratorQueues
        locale="en"
        filters={{
          queue: "bookings",
          state: "cancelled",
          from: "2026-09-20",
          through: "2026-09-21",
        }}
        outcome={{
          status: "ready",
          page: page("bookings", [row({ state: "cancelled" })], {
            total: 30,
            nextCursor: cursor,
          }),
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      "/en/administrator/queues?queue=bookings&state=cancelled&from=2026-09-20&through=2026-09-21&afterAt=2026-09-21T12%3A00%3A00.123456%2B00%3A00&afterId=44444444-4444-4444-8444-444444444444",
    );

    rerender(
      <AdministratorQueues
        locale="ckb"
        filters={{ queue: "requests", ...noFilters }}
        outcome={{
          status: "ready",
          page: page("requests", [row({})], { nextCursor: cursor }),
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "پەڕەی دواتر" })).toHaveAttribute(
      "href",
      "/ckb/administrator/queues?queue=requests&afterAt=2026-09-21T12%3A00%3A00.123456%2B00%3A00&afterId=44444444-4444-4444-8444-444444444444",
    );
  });

  it("shows no next link on the last page", () => {
    render(
      <AdministratorQueues
        locale="en"
        filters={{ queue: "requests", ...noFilters }}
        outcome={{ status: "ready", page: page("requests", [row({})]) }}
      />,
    );
    expect(screen.queryByRole("link", { name: "Next page" })).toBeNull();
  });

  it("shows the empty state, not a list, when no row matches", () => {
    const { container } = render(
      <AdministratorQueues
        locale="en"
        filters={{ queue: "requests", ...noFilters }}
        outcome={{ status: "ready", page: page("requests", []) }}
      />,
    );
    const empty = container.querySelector("div.empty-state")!;
    expect(empty.querySelector("p")).toHaveTextContent(
      "No records match these filters.",
    );
    expect(within(empty as HTMLElement).getByRole("link")).toHaveAttribute(
      "href",
      "/en/administrator/queues?queue=requests",
    );
    expect(screen.queryByRole("list")).toBeNull();
    expect(
      screen.getByText("Matching records:").closest("p"),
    ).toHaveTextContent("Matching records: 0");
  });

  it("shows the invalid message with the filters and no list, total or counts", () => {
    render(
      <AdministratorQueues
        locale="en"
        filters={{
          queue: "requests",
          state: "bogus",
          from: "2026-09-22",
          through: "2026-09-21",
        }}
        outcome={{ status: "invalid" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "These filters are not valid. Check the dates and try again.",
    );
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/Matching records/)).toBeNull();
    expect(
      within(screen.getByRole("combobox", { name: "Status" }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "All statuses",
      "Pending",
      "Processing",
      "Payment Required",
      "Capture processing",
      "Declined",
      "Withdrawn",
      "Expired",
      "Cancelled booking",
    ]);
    expect(screen.getByLabelText("From date (Baghdad)")).toHaveValue(
      "2026-09-22",
    );
  });
});
