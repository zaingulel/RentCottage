import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  BookingMoneyFigures,
  BookingMoneyRow,
} from "@/administrator-records/administrator-booking-money";
import type { OwnerBookingEarningsFacts } from "@/booking-request/owner-booking-earnings";

import { administratorBookingMoneyExportMessages } from "@/i18n/administrator-booking-money-export-messages";
import { administratorTotalsMessages } from "@/i18n/administrator-totals-messages";

import { AdministratorBookingMoney } from "./administrator-booking-money";

type Outcome = ComponentProps<typeof AdministratorBookingMoney>["outcome"];
type Ready = Extract<Outcome, { status: "ready" }>;

const zero = { bookingPriceFils: 0, bookingServiceFeeFils: 0 };
const refundId = "43000000-0000-4000-8000-000000000900";
const payoutId = "43000000-0000-4000-8000-000000000801";
const noFilters = { state: "", from: "", through: "" };
const noCursor = {
  state: null,
  from: null,
  through: null,
  afterAt: null,
  afterId: null,
};

// Price 100,000 IQD and fee 5,000 IQD, paid out at 90,000 IQD, then 10,000 IQD of price refunded.
const paidThenRefunded: OwnerBookingEarningsFacts = {
  status: "captured",
  captured: { bookingPriceFils: 100_000_000, bookingServiceFeeFils: 5_000_000 },
  refunded: { bookingPriceFils: 10_000_000, bookingServiceFeeFils: 0 },
  reserved: zero,
  obligation: zero,
  marketplaceCommissionRateBasisPoints: 1_000,
  marketplaceCommissionAmountFils: 10_000_000,
  refunds: [
    {
      state: "succeeded",
      allocation: { bookingPriceFils: 10_000_000, bookingServiceFeeFils: 0 },
    },
  ],
  maturity: {
    status: "completed",
    effectivePeriodEnd: "2101-01-01T12:00:00Z",
    assessedAt: "2101-01-01T12:00:01Z",
    reviewExpiresAt: "2101-01-15T12:00:00Z",
    reviewAvailable: true,
    payoutPrerequisiteAt: "2101-01-01T12:00:00Z",
    payoutPrerequisiteAvailable: true,
  },
  administratorHoldActive: false,
  disputes: [],
  settlement: {
    amountFils: 90_000_000,
    state: "succeeded",
    retrySafe: false,
    receipt: { paidFils: 90_000_000, recordedAt: "2101-01-02T12:00:00Z" },
  },
  recovery: {
    status: "paid",
    paidFils: 90_000_000,
    ownerEntitlementFils: 81_000_000,
    paidWhileBlocked: false,
    recoveryExposureFils: 9_000_000,
    recoveryBalanceFils: 9_000_000,
    automaticOwnerDebitFils: 0,
  },
};
const bookingRow = (
  n: number,
  change: Partial<BookingMoneyRow> = {},
): BookingMoneyRow => ({
  bookingRequestId: `43000000-0000-4000-8000-${n.toString().padStart(12, "0")}`,
  reference: `RC-REQ-${n.toString(16).toUpperCase().padStart(16, "0")}`,
  confirmedAt: `2026-10-01T00:00:0${n}.123456+00:00`,
  state: "completed",
  earnings: paidThenRefunded,
  refundRecords: [
    {
      id: refundId,
      source: "administrator",
      state: "succeeded",
      bookingPriceFils: 10_000_000,
      bookingServiceFeeFils: 0,
      requestedAt: "2026-10-02T09:00:00.000001+00:00",
    },
  ],
  settlementIntentId: payoutId,
  ...change,
});
// The fixture booking worked by hand, in fils.
const totals: BookingMoneyFigures = {
  bookingPriceFils: 100_000_000,
  bookingServiceFeeFils: 5_000_000,
  customerTotalFils: 105_000_000,
  commissionAtCaptureFils: 10_000_000,
  refundedBookingPriceFils: 10_000_000,
  refundedBookingServiceFeeFils: 0,
  pendingRefundFils: 0,
  commissionAfterRefundsFils: 9_000_000,
  ownerShareAtCaptureFils: 90_000_000,
  ownerShareAfterRefundsFils: 81_000_000,
  ownerShareReductionFils: 9_000_000,
  paidPayoutFils: 90_000_000,
  expectedUnpaidPayoutFils: 0,
  toRecoverFils: 9_000_000,
};
const ready = (change: Partial<Ready> = {}): Ready => ({
  status: "ready",
  search: noCursor,
  summary: {
    bookingCount: 1,
    flagged: [],
    totals: { status: "available", figures: totals },
  },
  page: { rows: [bookingRow(1)], nextCursor: null },
  ...change,
});

function show(
  outcome: Outcome,
  locale: ComponentProps<typeof AdministratorBookingMoney>["locale"] = "en",
  filters = noFilters,
) {
  return render(
    <AdministratorBookingMoney
      locale={locale}
      filters={filters}
      outcome={outcome}
    />,
  );
}

function expectFact(section: string, label: string, amount: string) {
  const fact = within(screen.getByRole("region", { name: section })).getByText(
    label,
  );
  expect(fact.tagName).toBe("DT");
  expect(fact.nextElementSibling?.textContent).toBe(amount);
}

const labelledAmounts = [
  [
    "en",
    [
      ["Captured from customers", "Booking Price", "IQD 100,000"],
      ["Captured from customers", "Booking Service Fees", "IQD 5,000"],
      ["Captured from customers", "Customer Total", "IQD 105,000"],
      [
        "Captured from customers",
        "Marketplace Commission at capture",
        "IQD 10,000",
      ],
      ["Refunds", "Booking Price refunded", "IQD 10,000"],
      ["Refunds", "Booking Service Fees refunded", "IQD 0"],
      ["Refunds", "Refunds not yet completed", "IQD 0"],
      [
        "After completed refunds",
        "Marketplace Commission after refunds",
        "IQD 9,000",
      ],
      ["After completed refunds", "Owner share at capture", "IQD 90,000"],
      ["After completed refunds", "Owner share after refunds", "IQD 81,000"],
      [
        "After completed refunds",
        "Reduction in owner share from refunds",
        "IQD 9,000",
      ],
      ["Owner Payouts", "Paid to owners", "IQD 90,000"],
      ["Owner Payouts", "Expected, not yet paid", "IQD 0"],
      ["Owner Payouts", "To recover from owners already paid", "IQD 9,000"],
    ],
  ],
  [
    "ar",
    [
      ["المحصل من العملاء", "سعر الحجز", "IQD 100,000"],
      ["المحصل من العملاء", "إجمالي العميل", "IQD 105,000"],
      ["دفعات المالك", "المدفوع للمالكين", "IQD 90,000"],
    ],
  ],
  [
    "ckb",
    [
      ["وەرگیراو لە کڕیاران", "نرخی حجز", "IQD ١٠٠٬٠٠٠"],
      ["وەرگیراو لە کڕیاران", "کۆی کڕیار", "IQD ١٠٥٬٠٠٠"],
      ["پارەدانەکانی خاوەن", "پێدراو بە خاوەنەکان", "IQD ٩٠٬٠٠٠"],
    ],
  ],
] as const;

describe("AdministratorBookingMoney", () => {
  it("shows Sorani counts without Sorani locale data", () => {
    const RealNumberFormat = Intl.NumberFormat;
    const numberFormat = vi
      .spyOn(Intl, "NumberFormat")
      .mockImplementation(function (locales, options) {
        const first = Array.isArray(locales) ? locales[0] : locales;
        return new RealNumberFormat(
          typeof first === "string" && first.startsWith("ckb")
            ? "en-US"
            : locales,
          options,
        );
      });
    try {
      for (const [locale, label, count, flagged, limit] of [
        [
          "ckb",
          "حجزە لیستکراوەکان (لەگەڵ نیشانکراوەکان)",
          "١٬٢٣٤",
          "چونکە ٢ لەم",
          "زیاتر لە ٥٠٠ حجز",
        ],
        [
          "en",
          "Listed bookings (including flagged)",
          "1,234",
          "because 2 of these",
          "More than 500 bookings",
        ],
        [
          "ar",
          "الحجوزات المدرجة (بما فيها المعلّمة)",
          "1,234",
          "لأن 2 من هذه",
          "أكثر من 500 حجز",
        ],
      ] as const) {
        const { unmount } = show(
          ready({
            summary: {
              bookingCount: 1234,
              flagged: [bookingRow(1), bookingRow(2)],
              totals: { status: "unavailable" },
            },
            page: { rows: [], nextCursor: null },
          }),
          locale,
        );
        expect(
          screen.getByText(`${label}:`).querySelector("strong"),
        ).toHaveTextContent(count);
        expect(screen.getByRole("alert")).toHaveTextContent(flagged);
        unmount();

        const limited = show(
          { status: "too_many", search: noCursor, limit: 500 },
          locale,
        );
        expect(screen.getByRole("alert")).toHaveTextContent(limit);
        limited.unmount();
      }
    } finally {
      numberFormat.mockRestore();
    }
  });

  it("shows each total as a labelled amount in English, Arabic and Sorani", () => {
    for (const [locale, facts] of labelledAmounts) {
      const { unmount } = show(ready(), locale);
      for (const [section, label, amount] of facts)
        expectFact(section, label, amount);
      unmount();
    }
  });

  it("shows no money figure when totals are unavailable and names the flagged bookings", () => {
    const flaggedRow = bookingRow(2, {
      earnings: { status: "unavailable" },
      refundRecords: [],
      settlementIntentId: null,
    });
    show(
      ready({
        summary: {
          bookingCount: 2,
          flagged: [
            {
              bookingRequestId: "43000000-0000-4000-8000-000000000003",
              reference: "RC-REQ-0000000000000003",
              confirmedAt: "2026-10-01T00:00:03.123456+00:00",
            },
            {
              bookingRequestId: flaggedRow.bookingRequestId,
              reference: flaggedRow.reference,
              confirmedAt: flaggedRow.confirmedAt,
            },
          ],
          totals: { status: "unavailable" },
        },
        page: { rows: [flaggedRow], nextCursor: null },
      }),
    );

    expect(
      screen.getByText("Listed bookings (including flagged):"),
    ).toHaveTextContent("Listed bookings (including flagged): 2");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Money totals are not shown because 2 of these bookings lack consistent payment evidence. Open each one below to review it.",
    );
    expect(
      screen
        .getAllByRole("region")
        .map((region) => region.querySelector("h2")?.textContent),
    ).toEqual([
      "Bookings with missing or inconsistent evidence",
      "Bookings in these totals",
    ]);
    expect(document.body).not.toHaveTextContent("IQD");
    const flagged = within(
      screen.getByRole("region", {
        name: "Bookings with missing or inconsistent evidence",
      }),
    );
    expect(
      flagged.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual([
      "/en/administrator/payments/RC-REQ-0000000000000003",
      "/en/administrator/payments/RC-REQ-0000000000000002",
    ]);
    expect(flagged.getAllByText("Payment evidence unavailable")).toHaveLength(
      2,
    );
  });

  it("links every contributing booking to its payment detail", () => {
    show(
      ready({
        summary: {
          bookingCount: 2,
          flagged: [],
          totals: { status: "available", figures: totals },
        },
        page: { rows: [bookingRow(2), bookingRow(1)], nextCursor: null },
      }),
    );

    const rows = within(
      screen.getByRole("region", { name: "Bookings in these totals" }),
    ).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(
      rows.map((row) => [
        within(row).getAllByRole("link").length,
        within(row).getByRole("link").getAttribute("href"),
        within(row).getByRole("link").textContent,
      ]),
    ).toEqual([
      [
        1,
        "/en/administrator/payments/RC-REQ-0000000000000002",
        "RC-REQ-0000000000000002",
      ],
      [
        1,
        "/en/administrator/payments/RC-REQ-0000000000000001",
        "RC-REQ-0000000000000001",
      ],
    ]);
    expect(rows[0]).toHaveTextContent("Completed");
    expect(
      within(rows[0])
        .getByText(/Customer Total:/)
        .querySelector("bdi")?.textContent,
    ).toBe("IQD 105,000");
  });

  it("lists refund and payout record identifiers inside the booking disclosure", () => {
    const { container } = show(ready());

    const disclosure = container.querySelector("details")!;
    expect(within(disclosure).getByText("Money for this booking").tagName).toBe(
      "SUMMARY",
    );
    const refund = within(disclosure).getByText("Refund record");
    expect(refund.nextElementSibling).toHaveTextContent(
      `${refundId}Refund approvedReturned`,
    );
    const payout = within(disclosure).getByText("Owner Payout record");
    expect(payout.nextElementSibling).toHaveTextContent(payoutId);
    expect(
      within(disclosure).getByText("Owner share after refunds"),
    ).toBeInTheDocument();
    expect(
      within(disclosure).getByText("Owner share after refunds")
        .nextElementSibling?.textContent,
    ).toBe("IQD 81,000");
  });

  it("asks to narrow the filter when too many bookings match", () => {
    show({ status: "too_many", search: noCursor, limit: 500 }, "en", {
      state: "completed",
      from: "2026-10-01",
      through: "",
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "More than 500 bookings match. Narrow the date range or choose one status.",
    );
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue(
      "completed",
    );
    expect(screen.getByLabelText("From date (Baghdad)")).toHaveValue(
      "2026-10-01",
    );
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows the empty state without totals", () => {
    show(
      ready({
        summary: {
          bookingCount: 0,
          flagged: [],
          totals: {
            status: "available",
            figures: Object.fromEntries(
              Object.keys(totals).map((key) => [key, 0]),
            ) as BookingMoneyFigures,
          },
        },
        page: { rows: [], nextCursor: null },
      }),
    );

    expect(screen.getByText("No records match these filters.")).toBeVisible();
    expect(
      screen.getByText("Listed bookings (including flagged):"),
    ).toHaveTextContent("Listed bookings (including flagged): 0");
    expect(screen.queryByRole("region")).toBeNull();
    expect(document.body).not.toHaveTextContent("IQD");
  });

  it("states that the screen does not replace accounting software or tax reporting", () => {
    show(ready());

    expect(
      screen.getByText(
        "Simple totals of Confirmed Bookings for operational follow-up. They do not replace accounting software or tax reporting, and they do not set or optimise prices.",
      ),
    ).toBeVisible();
    expect(document.body).not.toHaveTextContent(/ledger|revenue|finance/i);
  });

  it("links back to the first results on a continued page", () => {
    const cursor = {
      afterAt: "2026-10-01T00:00:02.123456+00:00",
      afterId: "43000000-0000-4000-8000-000000000002",
    };
    const filters = { state: "completed", from: "2026-10-01", through: "" };
    const { unmount } = show(
      ready({
        search: {
          ...noCursor,
          state: "completed",
          from: "2026-10-01",
          ...cursor,
        },
        page: { rows: [bookingRow(1)], nextCursor: cursor },
      }),
      "en",
      filters,
    );

    const paging = screen.getByRole("navigation", {
      name: "More bookings in these totals",
    });
    expect(
      within(paging)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      [
        "Back to first results",
        "/en/administrator/totals?state=completed&from=2026-10-01",
      ],
      [
        "Next page",
        "/en/administrator/totals?state=completed&from=2026-10-01&afterAt=2026-10-01T00%3A00%3A02.123456%2B00%3A00&afterId=43000000-0000-4000-8000-000000000002",
      ],
    ]);

    unmount();
    show(ready({ page: { rows: [bookingRow(1)], nextCursor: cursor } }));
    expect(
      screen.queryByRole("link", { name: "Back to first results" }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Next page" })).toBeVisible();
  });
});

it("exports applied filters across all locales without exporting the page cursor", () => {
  for (const locale of ["en", "ar", "ckb"] as const) {
    const copy = administratorBookingMoneyExportMessages[locale];
    const search = {
      state: "completed" as const,
      from: "2026-10-01",
      through: "2026-10-03",
      afterAt: "2026-10-01T00:00:01.123456+00:00",
      afterId: bookingRow(1).bookingRequestId,
    };
    const view = show(
      ready({ search, page: { rows: [], nextCursor: null } }),
      locale,
    );
    const button = screen.getByRole("button", { name: copy.export });
    const form = button.closest("form")!;
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute(
      "action",
      `/${locale}/administrator/totals/export`,
    );
    expect(button).toHaveAccessibleDescription(
      `${copy.help} ${copy.applyHelp}`,
    );
    expect(Array.from(new FormData(form).entries())).toEqual([
      ["state", "completed"],
      ["from", "2026-10-01"],
      ["through", "2026-10-03"],
    ]);
    fireEvent.change(
      view.container.querySelector('form[method="get"] input[name="from"]')!,
      { target: { value: "2026-12-01" } },
    );
    expect(new FormData(form).get("from")).toBe("2026-10-01");
    view.unmount();

    const flagged = show(
      ready({
        summary: {
          bookingCount: 1,
          flagged: [
            {
              bookingRequestId: bookingRow(1).bookingRequestId,
              reference: bookingRow(1).reference,
              confirmedAt: bookingRow(1).confirmedAt,
            },
          ],
          totals: {
            status: "available",
            figures: { ...totals, bookingPriceFils: 0 },
          },
        },
        page: { rows: [], nextCursor: null },
      }),
      locale,
    );
    expect(screen.getByRole("button", { name: copy.export })).toBeVisible();
    flagged.unmount();

    for (const outcome of [
      ready({
        summary: {
          bookingCount: 0,
          flagged: [],
          totals: { status: "available", figures: totals },
        },
        page: { rows: [], nextCursor: null },
      }),
      { status: "invalid" as const },
      { status: "too_many" as const, limit: 500 as const, search: noCursor },
    ]) {
      const hidden = show(outcome, locale);
      expect(
        screen.queryByRole("button", { name: copy.export }),
      ).not.toBeInTheDocument();
      hidden.unmount();
    }
    for (const exportError of [
      "invalid",
      "access_required",
      "empty",
      "too_many",
      "unavailable",
    ] as const) {
      const props = {
        locale,
        filters: noFilters,
        outcome: ready(),
        exportError,
      };
      const error = render(<AdministratorBookingMoney {...props} />);
      const expected =
        exportError === "access_required"
          ? copy.accessRequired
          : exportError === "too_many"
            ? administratorTotalsMessages[locale].tooMany.replace(
                "{limit}",
                locale === "ckb" ? "٥٠٠" : "500",
              )
            : copy[exportError];
      expect(screen.getByRole("alert")).toHaveTextContent(expected);
      error.unmount();
    }
    const duplicateProps = {
      locale,
      filters: noFilters,
      outcome: { status: "invalid" as const },
      exportError: "invalid" as const,
    };
    const duplicate = render(<AdministratorBookingMoney {...duplicateProps} />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    duplicate.unmount();
  }
});
